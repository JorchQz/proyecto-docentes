/*
	Webhook de Mercado Pago: código de respuesta según el tipo de error (R29, decisión de Jorge del
	2026-09-26). Corre la Edge Function REAL (supabase/functions/webhook-mercadopago/index.ts, con
	_shared/pagos.ts y _shared/mi-salon-pagos.ts) en Node, con la base y Mercado Pago simulados:
	sin red, sin base, sin Resend.

	- Falla pasajera (la base no respondió: lectura de mi_salon_ordenes o de la orden fallida, RPC de
	  Mi Salón con error, renglones que no se pudieron leer, accesos o estado que no se pudieron
	  escribir) → 503, para que Mercado Pago reintente solo. La orden NO queda pagada.
	- Definitivo (firma inválida → 401; orden desconocida, ya procesada, rechazado, pendiente, monto
	  parcial, orden sin renglones, reglas de Mi Salón → 200 como siempre).
	- Tienda: los accesos van ANTES de marcar la orden pagada y solo UNA llamada la marca (update
	  condicionado): la que llega segunda responde ya procesada y no manda otro correo.

	node pruebas/webhook-transitorio.test.js
*/
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { register } = require("module");
const { pathToFileURL } = require("url");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	process.stdout.write((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")") + "\n");
}

// supabase-js por URL (esm.sh) → un createClient que devuelve la base simulada del caso en curso
register("data:text/javascript," + encodeURIComponent(
	"export async function resolve(e, c, s) { if (e.startsWith('https://esm.sh/@supabase/supabase-js')) " +
	"return { url: 'data:text/javascript,export function createClient() { return globalThis.__baseFalsa; }', shortCircuit: true }; return s(e, c); }"));

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", MP_ACCESS_TOKEN: "TEST-nunca-real", SITE_URL: "https://jissez.com", RESEND_API_KEY: "re_simulado" };
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };

// Mercado Pago y Resend simulados: nada sale a internet
const pagosMP = {};
const correos = [];
const red = [];
globalThis.fetch = async (url, init) => {
	const u = String(url);
	const m = /^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\w+)$/.exec(u);
	if (m) return new Response(JSON.stringify(pagosMP[m[1]] || { message: "not found" }), { status: pagosMP[m[1]] ? 200 : 404 });
	if (u === "https://api.resend.com/emails") { correos.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "re-" + correos.length })); }
	red.push(u);
	throw new Error("RED BLOQUEADA en la prueba: " + u);
};

/** Base simulada: `respuestas(tabla, op, q)` decide qué devuelve cada consulta; `log` guarda el orden. */
function base(respuestas) {
	const log = [];
	const cadena = (tabla) => {
		const q = { tabla, op: "select", args: null, filtros: [] };
		const api = {
			select() { return api; },
			insert(v) { q.op = "insert"; q.args = v; return api; },
			upsert(v) { q.op = "upsert"; q.args = v; return api; },
			update(v) { q.op = "update"; q.args = v; return api; },
			delete() { q.op = "delete"; return api; },
			eq(c, v) { q.filtros.push(c + "=" + v); return api; }, neq(c, v) { q.filtros.push(c + "<>" + v); return api; },
			in() { return api; }, is() { return api; }, lt() { return api; }, order() { return api; }, limit() { return api; },
			maybeSingle() { return api; }, single() { return api; },
			then(res, rej) { log.push(tabla + ":" + q.op); return Promise.resolve(respuestas(tabla, q.op, q) || { data: null, error: null }).then(res, rej); },
		};
		return api;
	};
	return {
		log,
		from: cadena,
		rpc: (n, a) => { log.push("rpc:" + n); return Promise.resolve(respuestas("rpc:" + n, "rpc", { args: a }) || { data: null, error: null }); },
		auth: { admin: { getUserById: () => { log.push("auth:getUserById"); return Promise.resolve({ data: { user: { email: "docente@ejemplo.mx" } } }); } } },
	};
}
const FALLA = { data: null, error: { message: "503 Service Unavailable (PostgREST)" } };
const ordenTienda = (estado) => ({ data: { id: "t1", estado, user_id: "u1", monto_total: 249 }, error: null });
const renglon = { data: [{ id: "i1", producto_id: "p1", tipo: "pdf", marketplace_productos: { tipo_paquete: "trimestre", titulo: "Paquete" } }], error: null };

/** Tienda aprobada; `falla` elige qué paso de la base falla. */
function tienda(opts = {}) {
	return (t, op) => {
		if (t === "mi_salon_ordenes") return opts.falla === "esOrden" ? FALLA : { data: null, error: null };
		if (t === "marketplace_ordenes" && op === "select") return opts.falla === "orden" ? FALLA : (opts.desconocida ? { data: null, error: null } : ordenTienda(opts.estado || "pendiente"));
		if (t === "marketplace_orden_items") return opts.falla === "renglones" ? FALLA : (opts.sinRenglones ? { data: [], error: null } : renglon);
		if (t === "marketplace_accesos" && op === "upsert") return opts.falla === "accesos" ? FALLA : { data: null, error: null };
		if (t === "marketplace_ordenes" && op === "update") return opts.falla === "marcar" ? FALLA : { data: opts.otraGano ? [] : [{ id: "t1" }], error: null };
		if (t === "marketplace_pedidos") return { data: [], error: null };
		return { data: null, error: null };
	};
}
/** Mi Salón; `falla` elige qué paso de la base falla; `r` es lo que devuelve mi_salon_aplicar_pago. */
function salon(opts = {}) {
	return (t) => {
		if (t === "mi_salon_ordenes") return opts.falla === "esOrden" ? FALLA : { data: { orden_id: "m1" }, error: null };
		if (t === "rpc:mi_salon_aplicar_pago") return opts.falla === "rpc" ? FALLA : { data: opts.r, error: null };
		if (t === "mi_salon_correos") return { data: [{ docente_id: "u2" }], error: null };
		return { data: null, error: null };
	};
}

let nPago = 100;
function pago(orden, o = {}) {
	const id = String(++nPago);
	pagosMP[id] = { id: Number(id), external_reference: orden, status: o.status || "approved", status_detail: o.status === "rejected" ? "cc_rejected_other_reason" : "accredited",
		transaction_amount: o.monto != null ? o.monto : 249, currency_id: "MXN", date_approved: new Date().toISOString(), payment_method_id: "visa", payment_type_id: "credit_card" };
	return id;
}
async function avisar(db, id, cabeceras) {
	globalThis.__baseFalsa = db;
	const r = await handler(new Request("https://x.supabase.co/functions/v1/webhook-mercadopago?data.id=" + id + "&type=payment",
		{ method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, cabeceras || {}), body: JSON.stringify({ type: "payment", data: { id } }) }));
	let data = null; try { data = await r.json(); } catch (_) { /* sin cuerpo */ }
	return { status: r.status, data };
}

(async () => {
	const errores = console.error, registros = console.log;
	console.error = console.log = () => {}; // los registros del webhook no ensucian la salida
	try {
		await import(pathToFileURL(path.join(RAIZ, "supabase/functions/webhook-mercadopago/index.ts")).href);
		if (!handler) throw new Error("no se capturó el handler del webhook");

		// ── 1. Fallas pasajeras → 503, la orden no se marca pagada ──────────────────
		let db = base(salon({ falla: "esOrden" }));
		let r = await avisar(db, pago("m1"));
		ok("Mi Salón: la lectura de mi_salon_ordenes falla → 503 (transitorio) y no se toca nada más", [r.status, r.data.transitorio, db.log], [503, true, ["mi_salon_ordenes:select"]]);
		db = base(salon({ falla: "rpc" }));
		r = await avisar(db, pago("m1"));
		ok("Mi Salón: mi_salon_aplicar_pago responde con error (timeout, 5xx) → 503, sin correo", [r.status, r.data.transitorio, db.log.includes("auth:getUserById")], [503, true, false]);
		db = base(tienda({ falla: "esOrden" }));
		r = await avisar(db, pago("t1"));
		ok("tienda: la lectura de mi_salon_ordenes falla → 503 y la orden de la tienda no se toca", [r.status, db.log], [503, ["mi_salon_ordenes:select"]]);
		db = base(tienda({ falla: "orden" }));
		r = await avisar(db, pago("t1"));
		ok("tienda: la lectura de la orden falla → 503 (antes: 'Orden no encontrada' con 200 y el aviso se perdía)", [r.status, r.data.transitorio, r.data.error], [503, true, "No se pudo leer la orden"]);
		db = base(tienda({ falla: "renglones" }));
		r = await avisar(db, pago("t1"));
		ok("tienda: los renglones no se pudieron leer → 503, sin marcarla pagada", [r.status, db.log.includes("marketplace_ordenes:update")], [503, false]);
		db = base(tienda({ falla: "accesos" }));
		r = await avisar(db, pago("t1"));
		ok("tienda: el upsert de accesos falla → 503 y la orden NO se marca pagada (sigue pendiente para el reintento), sin correo",
			[r.status, r.data.estado, db.log.includes("marketplace_ordenes:update"), correos.length], [503, "pendiente", false, 0]);
		db = base(tienda({ falla: "marcar" }));
		r = await avisar(db, pago("t1"));
		ok("tienda: marcar la orden pagada falla → 503, sin correo (el reintento la marca; los accesos no se duplican: upsert)", [r.status, correos.length], [503, 0]);
		db = base((t, op, q) => (t === "marketplace_ordenes" && op === "update" ? FALLA : tienda()(t, op, q)));
		r = await avisar(db, pago("t1", { status: "refunded" }));
		ok("tienda: el reembolso no se pudo registrar → 503 (el reintento quita el acceso)", [r.status, r.data.transitorio], [503, true]);

		// ── 2. El reintento (tras la falla) entrega UNA vez ─────────────────────────
		const idR = pago("t1");
		db = base(tienda({ falla: "accesos" }));
		const r1 = await avisar(db, idR);
		const c0 = correos.length;
		db = base(tienda());
		const r2 = await avisar(db, idR);
		ok("tienda: 503 y el reintento da 200 'pagado' con sus accesos y UN correo", [r1.status, r2.status, r2.data.estado, r2.data.accesos, correos.length - c0], [503, 200, "pagado", 2, 1]);
		db = base(tienda({ estado: "pagado" }));
		const r3 = await avisar(db, idR);
		ok("tienda: un aviso más después: 200 ya procesada, sin accesos ni correo", [r3.status, r3.data.yaProcesada, db.log.includes("marketplace_accesos:upsert"), correos.length - c0], [200, true, false, 1]);
		db = base(tienda({ otraGano: true }));
		const r4 = await avisar(db, pago("t1"));
		ok("tienda: si otra llamada la marcó pagada al mismo tiempo (update con 0 filas): 200 ya procesada y sin segundo correo",
			[r4.status, r4.data.yaProcesada, db.log.includes("auth:getUserById"), correos.length - c0], [200, true, false, 1]);
		const idS = pago("m1", { monto: 199 });
		db = base(salon({ falla: "rpc" }));
		const s1 = await avisar(db, idS);
		db = base(salon({ r: { ok: true, estado: "pagado", ya_procesada: false, accesos_creados: 1, docente_id: "u2", vence: "2026-12-18", cobertura: [] } }));
		const s2 = await avisar(db, idS);
		ok("Mi Salón: 503 y el reintento da 200 'pagado' con 1 acceso y 1 correo", [s1.status, s2.status, s2.data.estado, s2.data.accesos, correos.length - c0], [503, 200, "pagado", 1, 2]);

		// ── 3. Respuestas definitivas: siguen en 200 (401 la firma) ─────────────────
		db = base(tienda({ desconocida: true }));
		r = await avisar(db, pago("t9"));
		ok("orden desconocida: 200 (ok=false, sin transitorio)", [r.status, r.data.ok, r.data.error, r.data.transitorio], [200, false, "Orden no encontrada", undefined]);
		db = base(tienda({ estado: "pagado" }));
		r = await avisar(db, pago("t1"));
		ok("ya procesada: 200", [r.status, r.data.yaProcesada], [200, true]);
		db = base(tienda());
		r = await avisar(db, pago("t1", { status: "rejected" }));
		ok("pago rechazado: 200 'fallido'", [r.status, r.data.estado], [200, "fallido"]);
		db = base(tienda());
		r = await avisar(db, pago("t1", { status: "pending" }));
		ok("pago pendiente (OXXO): 200 'pendiente'", [r.status, r.data.estado], [200, "pendiente"]);
		db = base(tienda());
		r = await avisar(db, pago("t1", { monto: 100 }));
		ok("tienda: monto parcial → 200 ok=false, sin accesos", [r.status, r.data.ok, r.data.transitorio, db.log.includes("marketplace_accesos:upsert")], [200, false, undefined, false]);
		db = base(tienda({ sinRenglones: true }));
		r = await avisar(db, pago("t1"));
		ok("tienda: orden sin renglones → 200 ok=false (definitivo)", [r.status, r.data.ok, r.data.transitorio], [200, false, undefined]);
		db = base(salon({ r: { ok: false, estado: "pendiente", error: "El importe o la moneda del pago no coinciden con la orden" } }));
		r = await avisar(db, pago("m1", { monto: 50 }));
		ok("Mi Salón: monto parcial (regla de la base, ok=false dentro de la respuesta) → 200", [r.status, r.data.ok, r.data.transitorio], [200, false, undefined]);
		db = base(salon({ r: { ok: true, estado: "pagado", ya_procesada: true, accesos_creados: 0 } }));
		r = await avisar(db, pago("m1", { monto: 199 }));
		ok("Mi Salón: ya procesada → 200", [r.status, r.data.yaProcesada], [200, true]);
		r = await avisar(base(tienda()), "999999");
		ok("pago que Mercado Pago no devuelve → 200 (como siempre)", r.status, 200);
		ENV.MP_WEBHOOK_SECRET = "secreto-de-prueba";
		const idF = pago("t1");
		r = await avisar(base(tienda()), idF, { "x-signature": "ts=1,v1=" + "0".repeat(64), "x-request-id": "r1" });
		const ts = String(Date.now());
		const v1 = crypto.createHmac("sha256", ENV.MP_WEBHOOK_SECRET).update("id:" + idF + ";request-id:r2;ts:" + ts + ";").digest("hex");
		const rFirmado = await avisar(base(tienda({ falla: "orden" })), idF, { "x-signature": "ts=" + ts + ",v1=" + v1, "x-request-id": "r2" });
		delete ENV.MP_WEBHOOK_SECRET;
		ok("firma inválida → 401; firmado y con falla pasajera → 503", [r.status, rFirmado.status], [401, 503]);

		// ── 4. El código: dónde sale cada status ────────────────────────────────────
		const hook = leer("supabase/functions/webhook-mercadopago/index.ts");
		ok("webhook: 503 solo por falla pasajera (excepción de procesarPago o resultado.transitorio); firma 401; el catch general sigue en 200",
			[(hook.match(/, 503\)/g) || []).length, /resultado = await procesarPago\([^)]*\);\s*\} catch \(err\) \{[\s\S]*?, 503\);/.test(hook), /if \(resultado\.transitorio\) \{[\s\S]*?return jsonResponse\(resultado, 503\);/.test(hook),
				/jsonResponse\(\{ error: "Firma inválida" \}, 401\)/.test(hook), /jsonResponse\(\{ error: mensajeError\(err\) \}, 200\);\s*\}\s*\}\);\s*$/.test(hook)],
			[3, true, true, true, true]);
		const pagosTs = leer("supabase/functions/_shared/pagos.ts");
		ok("pagos.ts: 'transitorio: true' solo en fallas de la base, nunca en las reglas (orden no encontrada, importe, sin renglones leídos bien)",
			[/if \(errOrden\) \{[\s\S]{0,200}transitorio: true/.test(pagosTs), /error: "Orden no encontrada" \}/.test(pagosTs), /"El importe o la moneda del pago no coinciden con la orden",\s*\};/.test(pagosTs),
				/transitorio: errRenglones \? true : undefined/.test(pagosTs)], [true, true, true, true]);
		ok("pagos.ts: accesos ANTES de marcar pagada, y el update condicionado (neq estado pagado) decide quién manda el correo",
			pagosTs.indexOf("otorgarAccesosDeOrden(admin, ordenId, orden.user_id)") < pagosTs.indexOf('.update({ estado: "pagado", referencia_pago: paymentId })') &&
			/\.update\(\{ estado: "pagado", referencia_pago: paymentId \}\)\s*\.eq\("id", ordenId\)\s*\.neq\("estado", "pagado"\)\s*\.neq\("estado", "reembolsado"\)\s*\.select\("id"\)/.test(pagosTs), true);
		ok("mi-salon-pagos.ts: error de la RPC → transitorio; esOrdenMiSalon sigue lanzando salvo 42P01/PGRST205",
			[/if \(error \|\| !data\) \{[\s\S]{0,700}transitorio: true/.test(leer("supabase/functions/_shared/mi-salon-pagos.ts")), /throw new Error\("No se pudo saber si la orden/.test(leer("supabase/functions/_shared/mi-salon-pagos.ts"))], [true, true]);
		ok("nada salió a internet (Mercado Pago y Resend simulados)", red, []);
	} finally {
		console.error = errores; console.log = registros;
	}
	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
