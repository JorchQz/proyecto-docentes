/*
	Pagos: integración con una base EN MEMORIA que falla a propósito (decisión de Jorge del 2026-10-02,
	retoma de R29). Corre las Edge Functions REALES (webhook-mercadopago y confirmar-pago, con
	_shared/pagos.ts y _shared/mi-salon-pagos.ts) en Node. Mercado Pago, Resend y la base son simulados:
	sin red. A diferencia de pruebas/webhook-transitorio.test.js (respuestas fijas por consulta), aquí la
	base TIENE ESTADO (órdenes, accesos con su índice único, pedidos, correos) y cada consulta cede el
	turno, así que dos llamadas simultáneas se intercalan de verdad.

	Se comprueba, para cada paso de la base que puede fallar y para los reintentos y las llamadas
	simultáneas (webhook + webhook, webhook + confirmar-pago):
	  - ninguna falla pasajera deja la orden "pagado" sin sus accesos ni sin sus pedidos activados;
	  - el reintento deja 1 solo marcado de pagada, 0 accesos duplicados y 1 solo correo por destinatario;
	  - Mi Salón: mi_salon_aplicar_pago idempotente (1 acceso, 1 correo);
	  - confirmar-pago ante una falla pasajera responde 200 con transitorio (no un 500 final).

	node pruebas/pagos-integracion.test.js
*/
const path = require("path");
const { register } = require("module");
const { pathToFileURL } = require("url");

const RAIZ = path.join(__dirname, "..");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	process.stdout.write((bien ? "OK   " : "FALLA ") + nombre + " -> " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")") + "\n");
}

register("data:text/javascript," + encodeURIComponent(
	"export async function resolve(e, c, s) { if (e.startsWith('https://esm.sh/@supabase/supabase-js')) " +
	"return { url: 'data:text/javascript,export function createClient() { return globalThis.__baseFalsa; }', shortCircuit: true }; return s(e, c); }"));

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", MP_ACCESS_TOKEN: "TEST-nunca-real", SITE_URL: "https://jissez.com", RESEND_API_KEY: "re_simulado", MAIL_ADMIN: "admin@ejemplo.mx" };
const handlers = [];
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handlers.push(h); } };

// ── Mercado Pago y Resend simulados ──────────────────────────────────────────
const pagosMP = {};
let correos = [];
const red = [];
const mpFalla = []; // cada consulta a Mercado Pago consume una: "red", "timeout", 500, 503, 429
globalThis.fetch = async (url, init) => {
	const u = String(url);
	if (u.startsWith("https://api.mercadopago.com/") && mpFalla.length) {
		const f = mpFalla.shift();
		if (f === "red") throw new TypeError("fetch failed");
		if (f === "timeout") { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; }
		if (f === "cuerpo") return new Response(new ReadableStream({ start(c) { c.error(new Error("socket hang up")); } }), { status: 200 });
		return new Response("{}", { status: f });
	}
	let m = /^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\w+)$/.exec(u);
	if (m) return new Response(JSON.stringify(pagosMP[m[1]] || {}), { status: pagosMP[m[1]] ? 200 : 404 });
	m = /^https:\/\/api\.mercadopago\.com\/v1\/payments\/search\?.*external_reference=(\w+)/.exec(u);
	if (m) return new Response(JSON.stringify({ results: Object.values(pagosMP).filter((p) => p.external_reference === m[1]) }));
	if (u === "https://api.resend.com/emails") { const b = JSON.parse(init.body); correos.push({ a: [].concat(b.to)[0], asunto: b.subject }); return new Response(JSON.stringify({ id: "re" })); }
	red.push(u);
	throw new Error("RED BLOQUEADA: " + u);
};

// ── Base en memoria con fallas inyectables ───────────────────────────────────
const cede = () => new Promise((r) => setImmediate(r));
let bd = null;

function nuevaBD() {
	return {
		t: {
			marketplace_ordenes: [], marketplace_orden_items: [], marketplace_accesos: [], marketplace_pedidos: [],
			mi_salon_ordenes: [], mi_salon_correos: [], mi_salon_pagos: [],
		},
		fallas: [], // { t, op, veces }
		marcados: [], // ordenes que pasaron a pagado (una entrada por marcado real)
		log: [],
	};
}
function falla(db, t, op) {
	const f = db.fallas.find((x) => x.t === t && x.op === op && x.veces > 0);
	if (f) { f.veces--; return true; }
	return false;
}
const ERR = { message: "503 Service Unavailable (PostgREST)" };

function crearCliente(db) {
	const from = (t) => {
		const q = { op: "select", payload: null, f: [], ret: false, uno: false, opts: null };
		const api = {
			select() { if (q.op !== "select") q.ret = true; return api; },
			insert(v) { q.op = "insert"; q.payload = v; return api; },
			upsert(v, o) { q.op = "upsert"; q.payload = v; q.opts = o; return api; },
			update(v) { q.op = "update"; q.payload = v; return api; },
			delete() { q.op = "delete"; return api; },
			eq(c, v) { q.f.push((r) => r[c] === v); return api; },
			neq(c, v) { q.f.push((r) => r[c] !== v); return api; },
			order() { return api; }, limit() { return api; },
			maybeSingle() { q.uno = true; return api; }, single() { q.uno = true; return api; },
			then(res, rej) { return ejecutar().then(res, rej); },
		};
		async function ejecutar() {
			await cede();
			db.log.push(t + ":" + q.op);
			if (falla(db, t, q.op)) return { data: null, error: ERR };
			const filas = db.t[t] || [];
			const coincide = () => filas.filter((r) => q.f.every((fn) => fn(r)));
			if (q.op === "select") {
				let rows = coincide().map((r) => Object.assign({}, r));
				if (t === "marketplace_orden_items") rows = rows.map((r) => Object.assign(r, { marketplace_productos: { tipo_paquete: "trimestre", titulo: "Paquete" } }));
				return { data: q.uno ? rows[0] || null : rows, error: null };
			}
			if (q.op === "update") {
				const rows = coincide();
				rows.forEach((r) => Object.assign(r, q.payload));
				if (t === "marketplace_ordenes" && q.payload.estado === "pagado") rows.forEach((r) => db.marcados.push(r.id));
				return { data: q.ret ? rows.map((r) => ({ id: r.id })) : null, error: null };
			}
			if (q.op === "delete") {
				const rows = coincide();
				db.t[t] = filas.filter((r) => !rows.includes(r));
				return { data: null, error: null };
			}
			// insert / upsert (con índice único para accesos y correos)
			const claves = { marketplace_accesos: ["user_id", "producto_id", "tipo"], mi_salon_correos: ["docente_id", "tipo"] }[t];
			const nuevas = [];
			for (const v of [].concat(q.payload)) {
				if (claves && filas.some((r) => claves.every((k) => r[k] === v[k]))) continue;
				filas.push(Object.assign({ id: t + filas.length }, v));
				nuevas.push(v);
			}
			return { data: q.ret ? nuevas.map(() => ({ docente_id: "u2" })) : null, error: null };
		}
		return api;
	};
	return {
		from,
		rpc: async (n, a) => {
			await cede();
			db.log.push("rpc:" + n);
			if (falla(db, "rpc:" + n, "rpc")) return { data: null, error: ERR };
			if (n === "mi_salon_aplicar_pago") {
				// Una transacción: atómica e idempotente por (pago, orden), como mi_salon_aplicar_pago (b22)
				if (a.p_pago.status === "refunded") {
					db.t.marketplace_ordenes.forEach((o) => { if (o.id === a.p_orden_id) o.estado = "reembolsado"; });
					return { data: { ok: true, estado: "reembolsado", docente_id: "u2" }, error: null };
				}
				const clave = a.p_orden_id + ":" + a.p_pago.id;
				const ya = db.t.mi_salon_pagos.includes(clave);
				if (!ya) db.t.mi_salon_pagos.push(clave);
				// La base aplicó el pago pero la respuesta se pierde (timeout de la llamada): el reintento ve ya_procesada
				if (!ya && falla(db, "rpc:mi_salon_aplicar_pago", "rpc-perdida")) return { data: null, error: ERR };
				return { data: { ok: true, estado: "pagado", ya_procesada: ya, accesos_creados: ya ? 0 : 1, docente_id: "u2", vence: "2026-12-18", cobertura: [] }, error: null };
			}
			return { data: null, error: null };
		},
		auth: {
			admin: { getUserById: async () => { await cede(); return { data: { user: { email: "docente@ejemplo.mx" } } }; } },
			getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
		},
	};
}

// ── Escenarios ───────────────────────────────────────────────────────────────
let nPago = 500;
function pago(orden, o = {}) {
	const id = String(++nPago);
	pagosMP[id] = { id: Number(id), external_reference: orden, status: o.status || "approved", status_detail: "accredited", transaction_amount: o.monto != null ? o.monto : 249, currency_id: "MXN", date_approved: new Date().toISOString(), payment_method_id: "visa", payment_type_id: "credit_card" };
	return id;
}
function sembrarTienda({ pedido } = {}) {
	bd = nuevaBD();
	bd.t.marketplace_ordenes.push({ id: "t1", estado: "pendiente", user_id: "u1", monto_total: 249 });
	bd.t.marketplace_orden_items.push({ id: "i1", orden_id: "t1", producto_id: "p1", tipo: "pdf" });
	if (pedido) bd.t.marketplace_pedidos.push({ id: "pe1", orden_id: "t1", estado: "pendiente_pago", numero_pedido: "PZ-1", nombre_cliente: "Docente", precio: 249 });
	correos = [];
	return bd;
}
function sembrarSalon() {
	bd = nuevaBD();
	bd.t.marketplace_ordenes.push({ id: "m1", estado: "pendiente", user_id: "u1", monto_total: 199 });
	bd.t.mi_salon_ordenes.push({ orden_id: "m1" });
	correos = [];
	return bd;
}
const resumen = () => ({ pagadas: bd.marcados.length, accesos: bd.t.marketplace_accesos.length, correos: correos.length });

async function webhook(id) {
	globalThis.__baseFalsa = crearCliente(bd);
	const r = await handlers[0](new Request("https://x.supabase.co/functions/v1/webhook-mercadopago?data.id=" + id + "&type=payment",
		{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "payment", data: { id } }) }));
	let data = null; try { data = await r.json(); } catch (_) { /* sin cuerpo */ }
	return { status: r.status, data };
}
async function confirmar(cuerpo) {
	globalThis.__baseFalsa = crearCliente(bd);
	const r = await handlers[1](new Request("https://x.supabase.co/functions/v1/confirmar-pago",
		{ method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }));
	let data = null; try { data = await r.json(); } catch (_) { /* sin cuerpo */ }
	return { status: r.status, data };
}

(async () => {
	const errores = console.error, registros = console.log;
	const callar = () => { console.error = console.log = () => {}; };
	const hablar = () => { console.error = errores; console.log = registros; };
	callar();
	try {
		await import(pathToFileURL(path.join(RAIZ, "supabase/functions/webhook-mercadopago/index.ts")).href);
		await import(pathToFileURL(path.join(RAIZ, "supabase/functions/confirmar-pago/index.ts")).href);
		if (handlers.length !== 2) throw new Error("no se capturaron los dos handlers");
		const salida = [];
		const reg = (...a) => salida.push(a);

		// 1. Tienda: cada paso de la base falla UNA vez; el reintento deja todo en su sitio
		const pasosTienda = [
			["mi_salon_ordenes", "select", "no se pudo saber si es de Mi Salón"],
			["marketplace_ordenes", "select", "lectura de la orden"],
			["marketplace_orden_items", "select", "renglones"],
			["marketplace_accesos", "upsert", "escritura de accesos"],
			["marketplace_ordenes", "update", "marcar pagada"],
		];
		for (const [t, op, que] of pasosTienda) {
			sembrarTienda();
			bd.fallas.push({ t, op, veces: 1 });
			const id = pago("t1");
			const a = await webhook(id);
			const tras = { estado: bd.t.marketplace_ordenes[0].estado, accesos: bd.t.marketplace_accesos.length, correos: correos.length };
			const b = await webhook(id);
			const c = await webhook(id);
			reg("tienda: falla en " + que + ": 1er aviso 503 sin correo y la orden nunca queda pagada sin accesos; el reintento 200 pagado; el siguiente 200 ya procesada",
				{ a: a.status, sinCorreo: tras.correos === 0, nuncaPagadaSinAccesos: tras.estado !== "pagado" || tras.accesos === 2, b: b.status + ":" + b.data.estado, c: c.status + ":" + !!c.data.yaProcesada, final: resumen() },
				{ a: 503, sinCorreo: true, nuncaPagadaSinAccesos: true, b: "200:pagado", c: "200:true", final: { pagadas: 1, accesos: 2, correos: 1 } });
		}

		// 2. Dos avisos simultaneos del MISMO pago
		sembrarTienda();
		let id = pago("t1");
		let rs = await Promise.all([webhook(id), webhook(id)]);
		reg("tienda: dos webhooks simultaneos: 1 solo marcado, 2 accesos, 1 correo", { st: rs.map((x) => x.status), r: resumen() }, { st: [200, 200], r: { pagadas: 1, accesos: 2, correos: 1 } });

		// 3. Webhook + confirmar-pago a la vez
		sembrarTienda();
		id = pago("t1");
		const [w, c] = await Promise.all([webhook(id), confirmar({ payment_id: id })]);
		reg("tienda: webhook + confirmar-pago simultaneos: 1 marcado, 2 accesos, 1 correo", { w: w.status, c: c.status, r: resumen() }, { w: 200, c: 200, r: { pagadas: 1, accesos: 2, correos: 1 } });

		// 4. Fallas pasajeras con una falla simultanea (webhook falla, confirmar entrega)
		sembrarTienda();
		bd.fallas.push({ t: "marketplace_accesos", op: "upsert", veces: 1 });
		id = pago("t1");
		rs = await Promise.all([webhook(id), confirmar({ payment_id: id })]);
		const otro = await webhook(id);
		reg("tienda: el acceso falla en una de dos llamadas simultaneas; al final 1 marcado, 2 accesos, 1 correo",
			{ r: resumen(), ultimo: otro.status }, { r: { pagadas: 1, accesos: 2, correos: 1 }, ultimo: 200 });

		// 5. Pedido personalizado: leer los pedidos falla DESPUES de marcar pagada
		sembrarTienda({ pedido: true });
		bd.fallas.push({ t: "marketplace_pedidos", op: "select", veces: 1 });
		id = pago("t1");
		const p1 = await webhook(id);
		const tras5 = { orden: bd.t.marketplace_ordenes[0].estado, pedido: bd.t.marketplace_pedidos[0].estado };
		const p2 = await webhook(id);
		const p3 = await webhook(id);
		reg("tienda con pedido: la lectura de pedidos falla tras marcar pagada -> 503 (orden pagada, pedido aun por activar); el reintento lo activa; el tercero no repite",
			{ p1: p1.status, tras5, p2: p2.status, pedido: bd.t.marketplace_pedidos[0].estado, p3: p3.status, correos: correos.map((x) => x.a).sort() },
			{ p1: 503, tras5: { orden: "pagado", pedido: "pendiente_pago" }, p2: 200, pedido: "pendiente", p3: 200, correos: ["admin@ejemplo.mx", "docente@ejemplo.mx", "docente@ejemplo.mx"] });
		sembrarTienda({ pedido: true });
		id = pago("t1");
		rs = await Promise.all([webhook(id), webhook(id), confirmar({ payment_id: id })]);
		reg("tienda con pedido: tres llamadas simultaneas: el pedido se activa una vez (2 correos del pedido + 1 de compra)",
			{ pedido: bd.t.marketplace_pedidos[0].estado, r: resumen() }, { pedido: "pendiente", r: { pagadas: 1, accesos: 2, correos: 3 } });

		// 6. Mi Salon
		for (const [t, op, que] of [["mi_salon_ordenes", "select", "saber si es de Mi Salon"], ["rpc:mi_salon_aplicar_pago", "rpc", "mi_salon_aplicar_pago"]]) {
			sembrarSalon();
			bd.fallas.push({ t, op, veces: 1 });
			id = pago("m1", { monto: 199 });
			const a = await webhook(id);
			const b = await webhook(id);
			const c2 = await webhook(id);
			reg("Mi Salon: falla en " + que + ": 503; reintento 200 pagado con 1 acceso y 1 correo; el siguiente ya procesada",
				{ a: a.status, b: b.status + ":" + b.data.accesos, c: c2.status + ":" + !!c2.data.yaProcesada, pagos: bd.t.mi_salon_pagos.length, correos: correos.length },
				{ a: 503, b: "200:1", c: "200:true", pagos: 1, correos: 1 });
		}
		sembrarSalon();
		id = pago("m1", { monto: 199 });
		rs = await Promise.all([webhook(id), webhook(id), confirmar({ payment_id: id })].map((p) => p));
		reg("Mi Salon: tres llamadas simultaneas del mismo pago: 1 acceso aplicado y 1 correo", { pagos: bd.t.mi_salon_pagos.length, correos: correos.length }, { pagos: 1, correos: 1 });

		// 7. confirmar-pago ante una falla pasajera: 200 con transitorio (nunca 500)
		sembrarSalon();
		bd.fallas.push({ t: "mi_salon_ordenes", op: "select", veces: 1 }); // procesarPago LANZA
		id = pago("m1", { monto: 199 });
		let cf = await confirmar({ payment_id: id });
		const r0 = cf.data.resultados && cf.data.resultados[0];
		reg("confirmar-pago: procesarPago lanza (no se pudo saber si es de Mi Salon) -> 200 transitorio pendiente, no un 500",
			{ st: cf.status, tr: r0 && r0.transitorio, est: r0 && r0.estado }, { st: 200, tr: true, est: "pendiente" });
		cf = await confirmar({ payment_id: id });
		reg("confirmar-pago: el reintento del comprador da pagado", { st: cf.status, est: cf.data.resultados[0].estado, transitorio: !!cf.data.resultados[0].transitorio }, { st: 200, est: "pagado", transitorio: false });
		sembrarTienda();
		bd.fallas.push({ t: "marketplace_accesos", op: "upsert", veces: 1 });
		id = pago("t1");
		cf = await confirmar({ orden_id: "t1" });
		const r1 = cf.data.resultados[0];
		reg("confirmar-pago por orden: falla de accesos -> 200 transitorio y la orden sigue pendiente (no 'pagado' sin accesos)",
			{ st: cf.status, tr: r1.transitorio, est: bd.t.marketplace_ordenes[0].estado, accesos: bd.t.marketplace_accesos.length }, { st: 200, tr: true, est: "pendiente", accesos: 0 });
		cf = await confirmar({ orden_id: "t1" });
		reg("confirmar-pago por orden: reintento -> pagado, 2 accesos, 1 correo", { est: cf.data.resultados[0].estado, r: resumen() }, { est: "pagado", r: { pagadas: 1, accesos: 2, correos: 1 } });

		// 8. Reembolso con falla a medias: el reintento termina de retirar el acceso
		sembrarTienda();
		id = pago("t1");
		await webhook(id);
		const idR = pago("t1", { status: "refunded" });
		bd.fallas.push({ t: "marketplace_accesos", op: "delete", veces: 1 });
		const f1 = await webhook(idR);
		const f2 = await webhook(idR);
		reg("tienda: reembolso con falla al quitar el acceso -> 503; el reintento lo retira (0 accesos, orden reembolsada)",
			{ f1: f1.status, f2: f2.status, accesos: bd.t.marketplace_accesos.length, estado: bd.t.marketplace_ordenes[0].estado }, { f1: 503, f2: 200, accesos: 0, estado: "reembolsado" });

		// 9. Lo definitivo no pide reintento
		sembrarTienda();
		let d = await webhook(pago("zzz"));
		reg("definitivo: orden desconocida -> 200", d.status, 200);
		sembrarTienda();
		d = await webhook(pago("t1", { monto: 10 }));
		reg("definitivo: monto parcial -> 200 sin accesos", { st: d.status, a: bd.t.marketplace_accesos.length }, { st: 200, a: 0 });
		sembrarTienda();
		d = await webhook(pago("t1", { status: "rejected" }));
		reg("definitivo: rechazado -> 200 fallido", { st: d.status, e: d.data.estado }, { st: 200, e: "fallido" });
		sembrarTienda();
		bd.t.marketplace_ordenes[0].estado = "pagado";
		d = await webhook(pago("t1"));
		reg("definitivo: ya procesada -> 200", { st: d.status, y: d.data.yaProcesada }, { st: 200, y: true });
		// 10. Falla pasajera al consultar a Mercado Pago (red, timeout, 429, 5xx): 503 sin escribir; 404 definitivo
		for (const f of ["red", "timeout", 503, 500, 429]) {
			sembrarTienda();
			id = pago("t1");
			mpFalla.push(f);
			const a = await webhook(id);
			const escrituras = bd.log.filter((x) => !x.endsWith(":select")).length;
			const b = await webhook(id);
			reg("MP falla al consultar (" + f + "): 503 sin escribir nada; el reintento da 200 pagado, 2 accesos, 1 correo",
				{ a: a.status, escrituras, b: b.status + ":" + b.data.estado, r: resumen() }, { a: 503, escrituras: 0, b: "200:pagado", r: { pagadas: 1, accesos: 2, correos: 1 } });
		}
		sembrarSalon();
		id = pago("m1", { monto: 199 });
		mpFalla.push("red");
		let m1 = await webhook(id);
		let m2 = await webhook(id);
		reg("Mi Salon: falla de red al consultar a MP: 503 y luego 200 pagado con 1 acceso y 1 correo", { a: m1.status, b: m2.status + ":" + m2.data.accesos, pagos: bd.t.mi_salon_pagos.length, correos: correos.length }, { a: 503, b: "200:1", pagos: 1, correos: 1 });
		sembrarTienda();
		d = await webhook("999999");
		reg("MP responde 404 (pago inexistente): 200 definitivo, sin 503", d.status, 200);
		sembrarTienda();
		id = pago("t1");
		mpFalla.push("red");
		cf = await confirmar({ payment_id: id });
		reg("confirmar-pago con payment_id: falla de red de MP -> 200 transitorio (no error)", { st: cf.status, tr: cf.data.resultados[0].transitorio, est: cf.data.resultados[0].estado }, { st: 200, tr: true, est: "pendiente" });
		cf = await confirmar({ payment_id: id });
		reg("confirmar-pago: el reintento da pagado", { est: cf.data.resultados[0].estado, r: resumen() }, { est: "pagado", r: { pagadas: 1, accesos: 2, correos: 1 } });
		sembrarTienda();
		bd.t.marketplace_ordenes[0].created_at = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
		id = pago("t1");
		mpFalla.push(503);
		cf = await confirmar({ orden_id: "t1" });
		reg("confirmar-pago por orden: MP 503 al buscar el pago -> transitorio y la orden vieja NO se descarta como abandonada",
			{ st: cf.status, tr: cf.data.resultados[0].transitorio, est: bd.t.marketplace_ordenes[0].estado }, { st: 200, tr: true, est: "pendiente" });

		// 11. Un approved viejo NO revive una orden reembolsada (ni entrega, ni correo)
		sembrarTienda();
		id = pago("t1");
		await webhook(id);
		const idRef = pago("t1", { status: "refunded" });
		await webhook(idRef);
		const antes = { c: correos.length, m: bd.marcados.length };
		const viejo = await webhook(id);
		const viejos = await Promise.all([webhook(id), webhook(id), confirmar({ payment_id: id })]);
		reg("tienda: reembolso y despues un approved viejo (solo y simultaneos): 200, sigue reembolsada, 0 accesos, 0 correos ni marcados nuevos",
			{ st: [viejo.status, ...viejos.map((x) => x.status)], estado: bd.t.marketplace_ordenes[0].estado, accesos: bd.t.marketplace_accesos.length, nuevos: { c: correos.length - antes.c, m: bd.marcados.length - antes.m } },
			{ st: [200, 200, 200, 200], estado: "reembolsado", accesos: 0, nuevos: { c: 0, m: 0 } });
		for (const orden of ["interleavings"]) {
			// aprobado y reembolso a la vez sobre una orden pendiente: pase lo que pase, termina reembolsada y sin accesos
			sembrarTienda();
			const ia = pago("t1");
			const ir = pago("t1", { status: "refunded" });
			await Promise.all([webhook(ia), webhook(ir), webhook(ia)]);
			reg("tienda: approved y refunded simultaneos sobre una orden pendiente: termina reembolsada con 0 accesos",
				{ estado: bd.t.marketplace_ordenes[0].estado, accesos: bd.t.marketplace_accesos.length }, { estado: "reembolsado", accesos: 0 });
		}
		sembrarSalon();
		id = pago("m1", { monto: 199 });
		await webhook(id);
		const idRs = pago("m1", { status: "refunded", monto: 199 });
		await webhook(idRs);
		const llamadas = bd.log.filter((x) => x === "rpc:mi_salon_aplicar_pago").length;
		const c0 = correos.length, p0 = bd.t.mi_salon_pagos.length;
		const mv = await Promise.all([webhook(id), webhook(id)]);
		reg("Mi Salon: reembolso y despues un approved viejo: 200, orden reembolsada, mi_salon_aplicar_pago NO corre, 0 correos ni pagos nuevos",
			{ st: mv.map((x) => x.status), estado: bd.t.marketplace_ordenes[0].estado, rpcNuevas: bd.log.filter((x) => x === "rpc:mi_salon_aplicar_pago").length - llamadas, nuevos: { c: correos.length - c0, p: bd.t.mi_salon_pagos.length - p0 } },
			{ st: [200, 200], estado: "reembolsado", rpcNuevas: 0, nuevos: { c: 0, p: 0 } });
		// 12. approved y pending simultaneos: queda pagada y 1 solo correo
		// el pending llega con distinto retraso respecto al approved (0 a 14 turnos): siempre queda pagada, 1 correo
		const malos = [];
		for (let retraso = 0; retraso <= 14; retraso++) {
			sembrarTienda();
			const ap = pago("t1");
			const pe = pago("t1", { status: "pending" });
			await Promise.all([webhook(ap), (async () => { for (let i = 0; i < retraso; i++) await cede(); return webhook(pe); })()]);
			const r = resumen();
			if (bd.t.marketplace_ordenes[0].estado !== "pagado" || r.pagadas !== 1 || r.accesos !== 2 || r.correos !== 1) malos.push({ retraso, estado: bd.t.marketplace_ordenes[0].estado, r });
		}
		reg("tienda: approved y pending simultaneos con 15 retrasos distintos del pending: siempre queda pagada, 2 accesos y 1 correo", malos, []);
		sembrarTienda();
		bd.t.marketplace_ordenes[0].estado = "pagado";
		cf = await confirmar({ orden_id: "t1", accion: "cancelar" });
		reg("confirmar-pago: cancelar una orden pagada -> 409 y sigue pagada", { st: cf.status, estado: bd.t.marketplace_ordenes[0].estado }, { st: 409, estado: "pagado" });

		// 13. Corte al LEER el cuerpo de Mercado Pago = pasajero
		sembrarTienda();
		id = pago("t1");
		mpFalla.push("cuerpo");
		let cu = await webhook(id);
		const esc13 = bd.log.filter((x) => !x.endsWith(":select")).length;
		const cu2 = await webhook(id);
		reg("MP corta al leer el cuerpo: 503 sin escribir; el reintento da 200 pagado con 1 correo", { a: cu.status, escrituras: esc13, b: cu2.status + ":" + cu2.data.estado, r: resumen() }, { a: 503, escrituras: 0, b: "200:pagado", r: { pagadas: 1, accesos: 2, correos: 1 } });
		sembrarTienda();
		id = pago("t1");
		mpFalla.push("cuerpo");
		cf = await confirmar({ payment_id: id });
		reg("confirmar-pago: corte al leer el cuerpo -> 200 transitorio", { st: cf.status, tr: cf.data.resultados[0].transitorio }, { st: 200, tr: true });
		sembrarTienda();
		bd.t.marketplace_ordenes[0].created_at = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
		id = pago("t1");
		mpFalla.push("cuerpo");
		cf = await confirmar({ orden_id: "t1" });
		reg("confirmar-pago por orden: corte al leer la busqueda -> transitorio y la orden no se descarta", { tr: cf.data.resultados[0].transitorio, est: bd.t.marketplace_ordenes[0].estado }, { tr: true, est: "pendiente" });

		// 14. Reparacion simultanea de pedidos: orden ya pagada con un pedido sin activar y tres llamadas a la vez
		sembrarTienda({ pedido: true });
		bd.t.marketplace_ordenes[0].estado = "pagado";
		id = pago("t1");
		rs = await Promise.all([webhook(id), webhook(id), confirmar({ payment_id: id })]);
		reg("tienda ya pagada con un pedido sin activar, tres llamadas simultaneas: el pedido se activa una vez y hay 2 correos (cliente y admin)",
			{ st: rs.map((x) => x.status), pedido: bd.t.marketplace_pedidos[0].estado, correos: correos.map((x) => x.a).sort() },
			{ st: [200, 200, 200], pedido: "pendiente", correos: ["admin@ejemplo.mx", "docente@ejemplo.mx"] });

		// 15. Mi Salon: la base aplico el pago pero la respuesta se perdio; el reintento manda el correo (una vez)
		sembrarSalon();
		bd.fallas.push({ t: "rpc:mi_salon_aplicar_pago", op: "rpc-perdida", veces: 1 });
		id = pago("m1", { monto: 199 });
		const l1 = await webhook(id);
		const trasPerdida = { pagos: bd.t.mi_salon_pagos.length, correos: correos.length };
		const l2 = await webhook(id);
		const l3s = await Promise.all([webhook(id), webhook(id), confirmar({ payment_id: id })]);
		reg("Mi Salon: respuesta perdida de la RPC: 503 sin correo; el reintento (ya_procesada) manda el correo; los demas, simultaneos o no, no lo repiten",
			{ l1: l1.status, trasPerdida, l2: l2.status + ":" + !!l2.data.yaProcesada, otros: l3s.map((x) => x.status), pagos: bd.t.mi_salon_pagos.length, correos: correos.length },
			{ l1: 503, trasPerdida: { pagos: 1, correos: 0 }, l2: "200:true", otros: [200, 200, 200], pagos: 1, correos: 1 });
		reg("nada salio a internet", red, []);

		hablar();
		for (const [nombre, real, esperado] of salida) ok(nombre, real, esperado);
	} finally {
		hablar();
	}
	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
