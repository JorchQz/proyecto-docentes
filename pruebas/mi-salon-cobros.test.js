/*
	Cobros de Mi Salón (b22, spec de Jorge 2026-09-26 §3, §5.2, §6, §7 y §8): reglas del cliente y
	del camino del pago, sin red ni base.

	- tienda/js/mi-salon-compra.js: "Tu acceso será válido hasta el [fecha]", compra tardía
	  ("Incluye también el segundo trimestre sin costo extra"), cobertura, lugares, renglones de
	  precio (fundador, cupón), mensajes del cupón, título Renovar/Comprar y opción inicial.
	- js/mi-salon-acceso.js: pago pendiente (OXXO con referencia), aviso del día y su enlace; el
	  botón de compra lleva a la compra.
	- tienda/js/conoce-mi-salon.js: precios desde la tabla, "Quedan N lugares" y beneficio de los
	  compradores de la tienda.
	- tienda/js/admin-mi-salon-cobros.js: estado de cada pago, métricas, textos de WhatsApp,
	  validación de precios y ciclo nuevo.
	- tienda/js/login.js: con Mi Salón abierto, quien no lo usa llega a la tienda con un aviso.
	- supabase/functions/_shared/pagos.ts + mi-salon-pagos.ts (TypeScript cargado en Node): una
	  orden de la TIENDA sigue exactamente su camino de siempre (la única lectura nueva es la de
	  mi_salon_ordenes, al principio); una de Mi Salón va entera a la base (mi_salon_aplicar_pago).
	- Textos: "docente", sin "maestra/maestro" y sin urgencia falsa; ninguna fecha de aviso escrita
	  en el código.
	Las reglas de la base (cobertura con fechas, precio, idempotencia, avisos) se prueban en
	pruebas/sql/mi-salon-cobros.sql (proyecto de pruebas, dentro de una transacción).

	node pruebas/mi-salon-cobros.test.js
*/
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

(async () => {
	// ── 1. Página de compra ──────────────────────────────────────────────────────
	const C = require(path.join(RAIZ, "tienda/js/mi-salon-compra.js"));
	const cot23 = { producto: "trimestre", ciclo: "2026-2027", disponible: true, compra_tardia: true, siguiente: { ciclo: "2026-2027", periodo: "T2", cargado: true },
		cobertura: [{ ciclo: "2026-2027", periodos: ["T1", "T2"] }], vence: "2027-04-09", vence_acceso: "2027-04-09", precio_lista: 299, precio_fundador: 199, precio_final: 199, tipo_precio: "fundador", motivo_fundador: "cupo", lugares_fundador: 37 };
	ok("validez en grande (compra del 23-oct): válida hasta el 9 de abril e incluye el segundo trimestre", C.textoValidez(cot23),
		{ principal: "Tu acceso será válido hasta el 9 de abril de 2027", extras: ["Incluye también el segundo trimestre sin costo extra."] });
	const cot22 = Object.assign({}, cot23, { compra_tardia: false, siguiente: null, cobertura: [{ ciclo: "2026-2027", periodos: ["T1"] }], vence: "2026-12-18", vence_acceso: "2026-12-18" });
	ok("validez (compra del 22-oct): hasta el 18 de diciembre, sin extras", C.textoValidez(cot22), { principal: "Tu acceso será válido hasta el 18 de diciembre de 2026", extras: [] });
	const cotT3 = Object.assign({}, cot23, { siguiente: { ciclo: "2027-2028", periodo: "T1", cargado: false }, provisional: true, vence_acceso: "2027-07-30",
		cobertura: [{ ciclo: "2026-2027", periodos: ["T3"] }, { ciclo: "2027-2028", periodos: ["T1"] }] });
	ok("validez (T3 tardío, 2027-2028 sin cargar): provisional y se extiende solo", C.textoValidez(cotT3), { principal: "Tu acceso será válido hasta el 30 de julio de 2027",
		extras: ["Incluye también el primer trimestre del ciclo 2027-2028 sin costo extra.", "Cuando se publique el calendario del ciclo 2027-2028, tu acceso se extiende solo hasta el final de ese periodo."] });
	ok("sin cotización no hay texto de validez", C.textoValidez(null), null);
	ok("cobertura en palabras", [C.textoCobertura(cot23.cobertura), C.textoCobertura(cotT3.cobertura), C.textoCobertura([{ ciclo: "2026-2027", periodos: ["T1", "T2", "T3"] }])],
		["T1 y T2 del ciclo 2026-2027", "T3 del ciclo 2026-2027 y T1 del ciclo 2027-2028", "T1, T2 y T3 del ciclo 2026-2027"]);
	ok("lugares: contador real (nada con 0)", [C.textoLugares(37), C.textoLugares(1), C.textoLugares(0), C.textoLugares(null)], ["Quedan 37 lugares con precio fundador", "Queda 1 lugar con precio fundador", null, null]);
	ok("renglones: lista y descuento fundador", C.renglones(cot23), [{ etiqueta: "Precio de lista", monto: 299, tipo: "base" }, { etiqueta: "Precio fundador", monto: -100, tipo: "descuento" }]);
	ok("renglones: comprador de la tienda", C.renglones(Object.assign({}, cot23, { motivo_fundador: "tienda" }))[1].etiqueta, "Precio fundador (compraste en la tienda)");
	ok("renglones: con cupón", C.renglones(Object.assign({}, cot23, { tipo_precio: "cupon", cupon_codigo: "ANA10", precio_final: 149 }))[1], { etiqueta: "Cupón ANA10", monto: -150, tipo: "descuento" });
	ok("renglones: precio de lista, sin descuento", C.renglones(Object.assign({}, cot23, { tipo_precio: "lista", precio_final: 299 })).length, 1);
	ok("cupón: aplicado / fundador más bajo / inexistente", [
		C.mensajeCupon({ cupon: { aplicado: true, codigo: "ANA10" } }).tipo,
		C.mensajeCupon({ cupon: { aplicado: false, motivo: "fundador_mejor", mensaje: "Tu precio fundador ya es igual o más bajo..." } }).tipo,
		C.mensajeCupon({ cupon: { aplicado: false, motivo: "inexistente", mensaje: "Ese cupón no existe o ya no está disponible." } }).tipo,
		C.mensajeCupon({}),
	], ["ok", "info", "error", null]);
	ok("título: Renovar si ya tuvo acceso; si no, Tu acceso", [C.titulo({ tiene_acceso: true }), C.titulo({ tiene_acceso: false }), C.titulo(null)],
		["Renovar tu acceso a Mi Salón", "Tu acceso a Mi Salón", "Tu acceso a Mi Salón"]);
	ok("estado actual en una línea", [C.textoEstado({ vigente: true, vence: "2026-12-18", origen: "gratis_t1" }), C.textoEstado({ vigente: false, vence: "2026-12-18" }), C.textoEstado({ vigente: false })],
		["Tu acceso actual (primer trimestre gratis) es válido hasta el 18 de diciembre de 2026.", "Tu acceso terminó el 18 de diciembre de 2026. Tus datos están guardados.", "Todavía no tienes un acceso a Mi Salón."]);
	const prods = [{ producto: "trimestre", disponible: false, motivo: "ya_cubierto" }, { producto: "resto_ciclo", disponible: true }];
	ok("opción inicial: la pedida si se puede; si no, la primera disponible", [C.elegirInicial(prods, "trimestre"), C.elegirInicial(prods, "resto_ciclo"), C.elegirInicial(prods, null), C.elegirInicial([], "x")],
		["resto_ciclo", "resto_ciclo", "resto_ciclo", null]);
	ok("motivos en palabras", [C.motivoTexto("ya_cubierto"), C.motivoTexto("fuera_de_venta"), C.motivoTexto("otro")],
		["Ya tienes acceso a esos periodos.", "Ya no está a la venta en este periodo.", "No está disponible por ahora."]);
	// No se vende lo que no agrega periodos, y se explica (decisión de Jorge del 2026-09-26)
	const cubiertoT1 = { motivo: "ya_cubierto", producto: "trimestre", periodo: "T1", ciclo: "2026-2027", compra_tardia: false, compra_tardia_desde: "2026-10-23", vence_acceso: "2026-12-18" };
	ok("ya cubierto antes de la compra tardía: explica desde cuándo la compra agrega el siguiente trimestre",
		C.explicarNoDisponible(cubiertoT1, { vence: "2026-12-18" }, "2026-10-12"),
		"Ya tienes acceso hasta el 18 de diciembre de 2026; desde el 23 de octubre de 2026 esta compra incluye también el segundo trimestre.");
	ok("ya cubierto sin nada que agregar: lo dice y no se vende",
		C.explicarNoDisponible({ motivo: "ya_cubierto", producto: "resto_ciclo", periodo: "T1", ciclo: "2026-2027", vence_acceso: "2027-07-30" }, { vence: "2027-07-30" }, "2026-10-12"),
		"Ya tienes acceso hasta el 30 de julio de 2027: esta opción no agregaría ningún periodo, así que no se vende.");
	ok("otro motivo: el texto corto de siempre", C.explicarNoDisponible({ motivo: "fuera_de_venta" }, null, "2027-03-10"), "Ya no está a la venta en este periodo.");
	ok("la lista de opciones y el aviso de 'nada que comprar' usan la explicación completa",
		(leer("tienda/js/mi-salon-compra.js").match(/M\.explicarNoDisponible\(p, datos\.estado, datos\.hoy\)/g) || []).length, 2);
	ok("b22: la cobertura manda compra_tardia_desde (para explicarlo)", /'compra_tardia_desde', P\.compra_tardia_desde/.test(leer("supabase/mi_salon_b22_cobros_2026-09.sql")), true);
	const b22 = leer("supabase/mi_salon_b22_cobros_2026-09.sql").replace(/\r\n/g, "\n");
	ok("b22: en empate entre cupón y fundador gana el cupón (decisión de Jorge del 2026-09-26)",
		/if v_cupon_precio < v_final or \(v_cupon_precio = v_final and v_tipo = 'fundador'\) then/.test(b22), true);
	ok("b22: los compradores de la tienda no ocupan lugar del cupo (motivo 'tienda' fuera del conteo y primero en el motivo)",
		[/m\.motivo_fundador is distinct from 'tienda'/.test(b22),
			b22.indexOf("mi_salon_comprador_tienda(p_uid) then return 'tienda'") < b22.indexOf("return 'previo';")], [true, true]);
	ok("método del pago pendiente", [C.metodoTexto({ metodo: "oxxo", tipo_metodo: "ticket" }), C.metodoTexto({ tipo_metodo: "bank_transfer" }), C.metodoTexto(null)], ["en efectivo en OXXO", "por transferencia SPEI", ""]);
	const js = leer("tienda/js/mi-salon-compra.js");
	ok("la página NO calcula precios: los pide a la base (mi_salon_opciones) y paga con la Edge (comprar-mi-salon), sin mandar precio",
		[/rpc\("mi_salon_opciones"/.test(js), /\/comprar-mi-salon"/.test(js), /JSON\.stringify\(\{ producto: c\.producto, cupon: cupon, acepta_terminos: true, nuevo: nuevoPago \}\)/.test(js)], [true, true, true]);
	ok("la página no redirige si el importe del servidor difiere del mostrado", /Number\(data\.precio\) !== Number\(precioMostrado\)/.test(js), true);
	const html = leer("tienda/mi-salon-compra.html");
	ok("página: noindex, tarjeta, SPEI y OXXO, términos, y la validez en grande", [/name="robots" content="noindex, nofollow"/.test(html), /Tarjeta o cuenta Mercado Pago/.test(html),
		/Transferencia SPEI/.test(html), /OXXO/.test(html), /id="aceptaTerminos"/.test(html), /id="msVigenciaTexto"/.test(html)], [true, true, true, true, true, true]);

	// ── 2. Mi Salón en la app ────────────────────────────────────────────────────
	const MS = require(path.join(RAIZ, "js/mi-salon-acceso.js"));
	ok("el botón Renovar lleva a la compra (desde la raíz y desde la app instalable)", [MS.COMPRA, MS.urlCompra("/dashboard.html"), MS.urlCompra("/salon/dashboard")],
		["tienda/mi-salon-compra.html", "tienda/mi-salon-compra.html", "/tienda/mi-salon-compra.html"]);
	const conPend = { vigente: true, pago_pendiente: { monto: 199, nombre: "Trimestre", metodo: "oxxo", tipo_metodo: "ticket", referencia: "4455", ticket_url: "https://www.mercadopago.com.mx/payments/1/ticket" } };
	ok("pago pendiente: texto con monto y referencia", MS.textoPendiente(conPend), { titulo: "Pago pendiente",
		texto: "Tu pago en OXXO de $199 (Trimestre) todavía no se refleja. Cuando se acredite, tu acceso se activa solo.", referencia: "4455", ticket_url: "https://www.mercadopago.com.mx/payments/1/ticket" });
	ok("pago pendiente: una ficha que no es https no se enlaza", MS.textoPendiente({ pago_pendiente: { monto: 1, ticket_url: "javascript:alert(1)" } }).ticket_url, null);
	ok("sin pago pendiente → null", [MS.textoPendiente({}), MS.textoPendiente(null)], [null, null]);
	const conAviso = { aviso: { clave: "gratis_precios", fecha: "2026-11-30", asunto: "Cómo seguir", texto: "Tu acceso gratis termina el 18 de diciembre.", boton_texto: "Ver opciones", boton_ruta: "/tienda/mi-salon-compra" } };
	ok("aviso del día", MS.textoAviso(conAviso), { clave: "gratis_precios:2026-11-30", titulo: "Cómo seguir", texto: "Tu acceso gratis termina el 18 de diciembre.", boton: "Ver opciones", ruta: "/tienda/mi-salon-compra" });
	ok("enlace del aviso: tienda (fuera de la app) o página de Mi Salón (relativa); nada raro", [
		MS.urlAviso("/tienda/mi-salon-compra", "/dashboard.html"), MS.urlAviso("/tienda/mi-salon-compra", "/salon/dashboard"),
		MS.urlAviso("/reportes", "/salon/dashboard"), MS.urlAviso("javascript:alert(1)", "/"), MS.urlAviso("//malo.com", "/")],
		["tienda/mi-salon-compra", "/tienda/mi-salon-compra", "reportes.html", null, null]);
	ok("el banner de solo lectura sigue igual (con acceso vigente, sin banner de solo lectura)", MS.textoBanner({ vigente: true }), null);

	// ── 3. Presentación: precios de la tabla ─────────────────────────────────────
	const { ConoceMiSalon, PRECIOS_MI_SALON } = require(path.join(RAIZ, "tienda/js/conoce-mi-salon.js"));
	const pub = { abierto: true, ciclo: "2026-2027", periodo: "T1", lugares_fundador: 63, cupo_fundador: 100, productos: [
		{ producto: "trimestre", nombre: "Trimestre", precio_lista: 299, precio_fundador: 199, vende_ahora: true },
		{ producto: "resto_ciclo", nombre: "Resto del ciclo", precio_lista: 549, precio_fundador: 399, vende_ahora: true },
		{ producto: "ciclo", nombre: "Ciclo completo", precio_lista: 749, precio_fundador: 549, vende_ahora: false }] };
	const cards = ConoceMiSalon.planesDeTabla(pub);
	ok("tarjetas de la tabla: solo lo que se vende hoy, con precio fundador y el de lista tachado, y botón a la compra",
		cards.map((c) => [c.clave, c.texto, c.lista, c.fundador, c.compra]),
		[["trimestre", "$199", "$299", true, "mi-salon-compra.html?producto=trimestre"], ["resto_ciclo", "$399", "$549", true, "mi-salon-compra.html?producto=resto_ciclo"]]);
	ok("sin lugares: precio de lista, sin tachar", ConoceMiSalon.planesDeTabla(Object.assign({}, pub, { lugares_fundador: 0 })).map((c) => [c.texto, c.lista, c.fundador]), [["$299", null, false], ["$549", null, false]]);
	ok("\"Quedan N lugares\" y nada con 0", [ConoceMiSalon.textoLugares(pub), ConoceMiSalon.textoLugares(Object.assign({}, pub, { lugares_fundador: 0 }))], ["Quedan 63 lugares con precio fundador.", null]);
	ok("beneficio de los compradores de la tienda (fundador aunque no queden lugares)", ConoceMiSalon.beneficioTabla(pub), "Si compraste planeaciones en Jissez antes de que abriera Mi Salón, tienes precio fundador aunque ya no queden lugares, y no ocupas uno de ellos.");
	ok("Mi Salón apagado: sin tabla, como antes (Precio por anunciar)", [ConoceMiSalon.planesDeTabla({ abierto: false }), ConoceMiSalon.planes(PRECIOS_MI_SALON, false)[0].texto], [[], "Precio por anunciar"]);
	ok("la presentación lee la tabla solo con Mi Salón abierto", /miSalonAbierto\(\)\.then\(function \(si\) \{\s*if \(!si\) return null;\s*return window\.sb\.rpc\("mi_salon_precios_publicos"\)/.test(leer("tienda/js/conoce-mi-salon.js")), true);

	// ── 4. Panel ─────────────────────────────────────────────────────────────────
	const A = require(path.join(RAIZ, "tienda/js/admin-mi-salon-cobros.js"));
	const pagos = [
		{ estado: "pagado", monto: 199, tipo_precio: "fundador", email: "a@x", cobertura: [{ ciclo: "2026-2027", periodos: ["T1", "T2"] }] },
		{ estado: "pagado", monto: 269, tipo_precio: "cupon", email: "b@x", cobertura: [{ ciclo: "2026-2027", periodos: ["T3"] }] },
		{ estado: "pagado", monto: 199, tipo_precio: "fundador", email: "a@x", cobertura: [{ ciclo: "2026-2027", periodos: ["T2", "T3"] }] },
		{ estado: "pendiente", pago_id: "9", metodo: "oxxo", tipo_metodo: "ticket", referencia: "4455", monto: 399 },
		{ estado: "pendiente", pago_id: null, monto: 199 },
		{ estado: "reembolsado", monto: 199 },
	];
	ok("métricas: aprobados, cobrado, pagaron el T2 (docentes distintas) y pendientes", A.metricas(pagos), { aprobados: 3, cobrado: 667, pendientes: 1, pagaron_t2: 1, fundador: 2, cupon: 1 });
	ok("estado de cada pago", pagos.map((p) => A.estadoPago(p).texto), ["Pagado", "Pagado", "Pagado", "Pago pendiente (OXXO) · ref. 4455", "Sin pagar (no terminó el pago)", "Reembolsado"]);
	ok("filtro de pendientes: solo los que tienen un pago de MP en espera", A.filtrarPagos(pagos, "pendiente").length, 1);
	ok("WhatsApp: {url} → la compra del sitio", A.textoWhatsApp({ texto: "Renueva cuando quieras.\n{url}" }, "https://jissez.com/"), "Renueva cuando quieras.\nhttps://jissez.com/tienda/mi-salon-compra");
	ok("WhatsApp: lista con nombre, correo y teléfono", A.listaWhatsApp({ docentes: [{ nombre: "Ana", email: "a@x", telefono: null }, { nombre: "Luis", email: "l@x", telefono: "+52 1" }] }), "Ana\ta@x\t\nLuis\tl@x\t+52 1");
	ok("precios: validación", [A.validarPrecio({ ciclo: "2026-2027", producto: "trimestre", precio_lista: 299, precio_fundador: 199 }),
		A.validarPrecio({ ciclo: "2026-2027", producto: "trimestre", precio_lista: 0, precio_fundador: null }),
		A.validarPrecio({ ciclo: "2026-2027", producto: "trimestre", precio_lista: 299, precio_fundador: 399 })],
		[null, "Trimestre 2026-2027: el precio de lista debe ser mayor que cero.", "Trimestre 2026-2027: el precio fundador debe ser mayor que cero y no más que el de lista."]);
	ok("ciclo nuevo: copia los precios del último ciclo", A.preciosCicloNuevo([{ ciclo: "2026-2027", producto: "trimestre", precio_lista: 299, precio_fundador: 199, activo: true }, { ciclo: "2025-2026", producto: "trimestre", precio_lista: 1 }], "2027-2028")
		.map((p) => [p.ciclo, p.producto, p.precio_lista]), [["2027-2028", "trimestre", 299]]);
	const adminHtml = leer("tienda/admin.html");
	ok("panel: lanzamiento, precios, cupo, pagos y WhatsApp; el script de cobros cargado", [/id="msLanzamientoBtn"/.test(adminHtml), /id="msPreciosTabla"/.test(adminHtml), /id="msCupo"/.test(adminHtml),
		/id="msPagos"/.test(adminHtml), /id="msWhats"/.test(adminHtml), /<script src="js\/admin-mi-salon-cobros\.js"><\/script>/.test(adminHtml)], [true, true, true, true, true, true]);

	// ── 5. Llegada tras el login con Mi Salón abierto ────────────────────────────
	const L = require(path.join(RAIZ, "tienda/js/login.js"));
	const abierto = (extra) => ({ data: Object.assign({ activo_saas: false, mi_salon: { visible: true, abierto: true, vigente: true, origen: "gratis_t1", vence: "2026-12-18", piloto: false } }, extra || {}) });
	const sinGrupos = { data: [] }, conGrupo = { data: [{ id: 1 }] };
	ok("comprador de la tienda (ve Mi Salón solo porque está abierto, sin grupo ni última sección): NO usa Mi Salón → tienda", L.usaMiSalon(abierto(), null, sinGrupos), false);
	ok("ya usa Mi Salón: con grupo, con activo_saas, con piloto o con última sección Mi Salón o Sala", [
		L.usaMiSalon(abierto(), null, conGrupo), L.usaMiSalon(abierto({ activo_saas: true }), null, sinGrupos),
		L.usaMiSalon({ data: { activo_saas: false, mi_salon: { visible: true, piloto: true } } }, null, sinGrupos),
		L.usaMiSalon(abierto(), "salon", null), L.usaMiSalon(abierto(), "sala", null)], [true, true, true, true, true]);
	ok("si la consulta de grupos falla, se conserva lo de antes (sí lo usa)", L.usaMiSalon(abierto(), null, { error: { message: "x" } }), true);
	ok("aviso discreto de la tienda: con el T1 gratis y su fecha; sin él, genérico", [L.textoLlegada(abierto()), L.textoLlegada({ data: { mi_salon: { vigente: false } } })],
		["Mi Salón ya está disponible para docentes: tu primer trimestre es gratis hasta el 18 de diciembre.", "Mi Salón ya está disponible para docentes."]);
	ok("login: a la tienda con el aviso (sessionStorage) antes de decidir la última sección", /!LoginDestino\.usaMiSalon\(perf, ultima, grupos\)\) \{\s*try \{ sessionStorage\.setItem\("jissez\.llegadaMiSalon"/.test(leer("tienda/js/login.js")), true);
	ok("tienda: el aviso de llegada solo con Mi Salón abierto (dentro de enlazarMiSalon)", /if \(!si\) \{ return; \}[\s\S]*jissez\.llegadaMiSalon[\s\S]*function revelar/.test(leer("tienda/js/tienda-common.js")), true);
	ok("Sala de Maestros sigue oculta: la tienda no enlaza conoce-sala", /conoce-sala/.test(leer("tienda/js/tienda-common.js")), false);

	// ── 6. El camino del pago (TypeScript de las Edge Functions, en Node) ────────
	globalThis.Deno = { env: { get: () => undefined } };
	const pagos_ts = await import(pathToFileURL(path.join(RAIZ, "supabase/functions/_shared/pagos.ts")).href);
	const ms_ts = await import(pathToFileURL(path.join(RAIZ, "supabase/functions/_shared/mi-salon-pagos.ts")).href);
	function falso(respuestas) {
		const log = [];
		const cadena = (tabla) => {
			const q = { tabla, op: "select", args: null };
			const api = {
				select() { if (q.op === "select") q.op = "select"; return api; },
				insert(v) { q.op = "insert"; q.args = v; return api; },
				upsert(v) { q.op = "upsert"; q.args = v; return api; },
				update(v) { q.op = "update"; q.args = v; return api; },
				delete() { q.op = "delete"; return api; },
				eq() { return api; }, neq() { return api; }, in() { return api; }, is() { return api; }, lt() { return api; }, order() { return api; }, limit() { return api; },
				maybeSingle() { q.uno = true; return api; }, single() { q.uno = true; return api; },
				then(res, rej) { log.push(tabla + ":" + q.op); return Promise.resolve(respuestas(tabla, q.op, q)).then(res, rej); },
			};
			return api;
		};
		return {
			log,
			from: cadena,
			rpc: (n, a) => { log.push("rpc:" + n); return Promise.resolve(respuestas("rpc:" + n, "rpc", { args: a })); },
			auth: { admin: { getUserById: () => { log.push("auth:getUserById"); return Promise.resolve({ data: { user: { email: "a@x" } } }); } } },
		};
	}
	// Orden de la TIENDA aprobada
	let upsertAccesos = null;
	const tienda = falso((t, op, q) => {
		if (t === "mi_salon_ordenes") return { data: null, error: null };
		if (t === "marketplace_ordenes" && op === "select") return { data: { id: "o1", estado: "pendiente", user_id: "u1", monto_total: 100 }, error: null };
		if (t === "marketplace_orden_items") return { data: [{ producto_id: "p1", tipo: "pdf", marketplace_productos: { tipo_paquete: "trimestre" } }], error: null };
		if (t === "marketplace_accesos" && op === "upsert") { upsertAccesos = q.args; return { error: null }; }
		if (t === "marketplace_pedidos") return { data: [], error: null };
		return { data: null, error: null };
	});
	const rTienda = await pagos_ts.procesarPago(tienda, { id: 55, external_reference: "o1", status: "approved", transaction_amount: 100, currency_id: "MXN" }, {});
	ok("tienda aprobada: mismo camino de siempre (se agregan la lectura de mi_salon_ordenes al principio y la de sus renglones antes de marcarla pagada, R27b)", tienda.log,
		["mi_salon_ordenes:select", "marketplace_ordenes:select", "marketplace_orden_items:select", "marketplace_ordenes:update", "marketplace_orden_items:select", "marketplace_accesos:upsert", "marketplace_pedidos:select", "rpc:marketplace_aplicar_precios"]);
	// R27b: una orden de la tienda SIN renglones no se marca pagada (queda pendiente, sin accesos)
	const tiendaVacia = falso((t, op) => t === "marketplace_ordenes" && op === "select" ? { data: { id: "o1", estado: "pendiente", user_id: "u1", monto_total: 100 }, error: null } : (t === "marketplace_orden_items" ? { data: [], error: null } : { data: null, error: null }));
	const rVacia = await pagos_ts.procesarPago(tiendaVacia, { id: 58, external_reference: "o1", status: "approved", transaction_amount: 100, currency_id: "MXN" }, {});
	ok("tienda aprobada SIN renglones: no se marca pagada ni entrega nada (pendiente, ok=false)", [rVacia.ok, rVacia.estado, tiendaVacia.log.includes("marketplace_ordenes:update"), tiendaVacia.log.includes("marketplace_accesos:upsert")], [false, "pendiente", false, false]);
	ok("tienda aprobada: mismo resultado y mismos accesos (PDF + anexos)", [rTienda.estado, rTienda.accesos, (upsertAccesos || []).map((a) => a.tipo)], ["pagado", 2, ["pdf", "anexos"]]);
	const tiendaPend = falso((t, op) => t === "marketplace_ordenes" && op === "select" ? { data: { id: "o1", estado: "pendiente", user_id: "u1", monto_total: 100 } } : { data: null });
	const rPend = await pagos_ts.procesarPago(tiendaPend, { id: 56, external_reference: "o1", status: "pending", status_detail: "pending_waiting_payment" }, {});
	ok("tienda pendiente (OXXO): igual que antes", [tiendaPend.log, rPend.estado], [["mi_salon_ordenes:select", "marketplace_ordenes:select", "marketplace_ordenes:update"], "pendiente"]);
	const sinTabla = (codigo) => falso((t, op) => t === "mi_salon_ordenes" ? { data: null, error: { message: "relation does not exist", code: codigo } } : (t === "marketplace_ordenes" && op === "select" ? { data: { id: "o1", estado: "pagado", user_id: "u1", monto_total: 100 } } : { data: null }));
	const rSinTabla = await pagos_ts.procesarPago(sinTabla("42P01"), { id: 57, external_reference: "o1", status: "approved" }, {});
	const rSinTabla2 = await pagos_ts.procesarPago(sinTabla("PGRST205"), { id: 57, external_reference: "o1", status: "approved" }, {});
	ok("si la base aún no tiene mi_salon_ordenes (42P01 o PGRST205), la tienda sigue igual", [rSinTabla.estado, rSinTabla.yaProcesada, rSinTabla2.estado, rSinTabla2.yaProcesada], ["pagado", true, "pagado", true]);
	// R27b: cualquier OTRA falla al leer mi_salon_ordenes (timeout, 503) se lanza: la orden no se toca
	// (queda pendiente) y confirmar-pago o el siguiente aviso la reparan
	const pasajera = falso((t, op) => t === "mi_salon_ordenes" ? { data: null, error: { message: "503 Service Unavailable" } } : (t === "marketplace_ordenes" && op === "select" ? { data: { id: "o2", estado: "pendiente", user_id: "u2", monto_total: 199 } } : { data: [] }));
	let lanzo = null;
	try { await pagos_ts.procesarPago(pasajera, { id: 59, external_reference: "o2", status: "approved", transaction_amount: 199, currency_id: "MXN" }, {}); } catch (e) { lanzo = e.message; }
	ok("falla pasajera al leer mi_salon_ordenes: se lanza y no se toca la orden (no se va por la tienda)", [!!lanzo && /No se pudo saber si la orden o2 es de Mi Salón/.test(lanzo), pasajera.log], [true, ["mi_salon_ordenes:select"]]);
	// Orden de MI SALÓN
	let argsMs = null;
	const salon = falso((t, op, q) => {
		if (t === "mi_salon_ordenes") return { data: { orden_id: "o2" }, error: null };
		if (t === "rpc:mi_salon_aplicar_pago") { argsMs = q.args; return { data: { ok: true, estado: "pendiente", docente_id: "u2" }, error: null }; }
		return { data: null, error: null };
	});
	const pagoOxxo = { id: 9001, external_reference: "o2", status: "pending", status_detail: "pending_waiting_payment", transaction_amount: 199, currency_id: "MXN",
		payment_method_id: "oxxo", payment_type_id: "ticket", transaction_details: { payment_method_reference_id: "4455667788", external_resource_url: "https://www.mercadopago.com.mx/payments/9001/ticket" } };
	const rSalon = await pagos_ts.procesarPago(salon, pagoOxxo, {});
	ok("orden de Mi Salón: todo en la base (mi_salon_aplicar_pago); no toca marketplace_ordenes ni accesos de la tienda", salon.log, ["mi_salon_ordenes:select", "rpc:mi_salon_aplicar_pago"]);
	ok("los datos del pago que llegan a la base (referencia y ficha de OXXO)", [argsMs.p_orden_id, argsMs.p_pago.id, argsMs.p_pago.status, argsMs.p_pago.referencia, argsMs.p_pago.ticket_url, rSalon.estado],
		["o2", "9001", "pending", "4455667788", "https://www.mercadopago.com.mx/payments/9001/ticket", "pendiente"]);
	ok("webhook repetido de Mi Salón: sin correo (ya_procesada)", await (async () => {
		const s = falso((t) => t === "mi_salon_ordenes" ? { data: { orden_id: "o2" } } : (t === "rpc:mi_salon_aplicar_pago" ? { data: { ok: true, estado: "pagado", ya_procesada: true, accesos_creados: 0, docente_id: "u2" } } : { data: null }));
		const r = await pagos_ts.procesarPago(s, Object.assign({}, pagoOxxo, { status: "approved" }), { resendKey: "re_x", siteUrl: "https://jissez.com" });
		return [r.yaProcesada, s.log.includes("auth:getUserById"), s.log.includes("mi_salon_correos:upsert")];
	})(), [true, false, false]);
	ok("helpers del correo", [ms_ts.fechaLarga("2027-04-09"), ms_ts.pesos(199), ms_ts.pesos(199.5), ms_ts.nombrePeriodo({ ciclo: "2027-2028", periodo: "T1" }, "2026-2027"), ms_ts.textoCobertura([{ ciclo: "2026-2027", periodos: ["T1", "T2"] }])],
		["9 de abril de 2027", "$199", "$199.50", "primer trimestre del ciclo 2027-2028", "T1 y T2 del ciclo 2026-2027"]);
	const correo = ms_ts.htmlConfirmacion({ nombre: "Trimestre", monto: 199, tipo_precio: "fundador", vence: "2027-04-09", compra_tardia: true, siguiente: { ciclo: "2026-2027", periodo: "T2" },
		cobertura: [{ ciclo: "2026-2027", periodos: ["T1", "T2"] }], extendida: true, vence_antes: "2026-12-18" }, "https://jissez.com");
	ok("correo de confirmación: producto, monto, vigencia, compra tardía, se suma y enlace a Mi Salón", [/válido hasta el <strong>9 de abril de 2027<\/strong>/.test(correo), /Incluye también el segundo trimestre sin costo extra/.test(correo),
		/Producto: Trimestre \(T1 y T2 del ciclo 2026-2027\)/.test(correo), /Monto: \$199 MXN · precio fundador/.test(correo), /antes tu acceso terminaba el 18 de diciembre de 2026/.test(correo), /https:\/\/jissez\.com\/dashboard/.test(correo)],
		[true, true, true, true, true, true]);

	// ── 7. Edge Functions y SQL: lo que no debe pasar ────────────────────────────
	const comprar = leer("supabase/functions/comprar-mi-salon/index.ts");
	ok("comprar-mi-salon: el precio sale de la base, pago único (preferencia), 12 mensualidades, sin suscripción", [/rpc\("mi_salon_registrar_orden"/.test(comprar), /checkout\/preferences/.test(comprar),
		/installments: MAX_MENSUALIDADES/.test(comprar), /preapproval|auto_recurring/.test(comprar), /unit_price: precio/.test(comprar), /body\.(precio|monto)/.test(comprar)], [true, true, true, false, true, false]);
	ok("comprar-mi-salon: exige los Términos", /acepta_terminos !== true/.test(comprar), true);
	ok("webhook y confirmar-pago de la tienda: sin cambios (el despacho vive en pagos.ts)", [leer("supabase/functions/webhook-mercadopago/index.ts").includes("mi_salon"), leer("supabase/functions/confirmar-pago/index.ts").includes("mi_salon")], [false, false]);
	const sql = leer("supabase/mi_salon_b22_cobros_2026-09.sql");
	// R27b: una orden 'pagado' que nunca se aplicó (aprobado_en null) sí se aplica; esOrdenMiSalon solo da false sin la tabla
	ok("mi_salon_aplicar_pago: 'ya procesada' solo si está pagada Y aplicada (aprobado_en); esOrdenMiSalon lanza salvo 42P01/PGRST205",
		[/if o\.estado = 'pagado' and m\.aprobado_en is not null then/.test(sql), /if o\.estado = 'pagado' then/.test(sql),
			/TABLA_NO_EXISTE = new Set\(\["42P01", "PGRST205"\]\)/.test(leer("supabase/functions/_shared/mi-salon-pagos.ts")), /if \(error\) return false;/.test(leer("supabase/functions/_shared/mi-salon-pagos.ts"))],
		[true, false, true, false]);
	const avisosTs = leer("supabase/functions/avisos-mi-salon/index.ts");
	const sinComentarios = (t) => t.split("\n").filter((l) => !/^\s*(\/\/|--)/.test(l)).join("\n");
	ok("ninguna fecha de aviso escrita en el código (salen de mi_salon_periodos)", [/2026-11-06|2026-11-30|2026-12-1[179]/.test(sql), /20\d\d-\d\d-\d\d/.test(sinComentarios(avisosTs))], [false, false]);
	const textos = [leer("tienda/mi-salon-compra.html"), js, leer("tienda/js/admin-mi-salon-cobros.js"), avisosTs, leer("supabase/functions/_shared/mi-salon-pagos.ts"),
		sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")].join("\n");
	ok("lenguaje: docente, sin \"maestra/maestro\" y sin urgencia falsa", [/\bmaestr[ao]s?\b/i.test(textos), /última oportunidad|¡|date prisa|apúrate/i.test(textos)], [false, false]);
	ok("la venta respeta el interruptor: sin Mi Salón abierto solo la ve quien ya ve Mi Salón (activo_saas o piloto)",
		/mi_salon_venta_abierta_para[\s\S]*mi_salon_abierto[\s\S]*activo_saas[\s\S]*'piloto'/.test(sql), true);
	ok("Mis compras: las órdenes de Mi Salón no salen entre las de la tienda", /filter\(function \(o\) \{ return !o\.mi_salon_ordenes; \}\)/.test(leer("tienda/js/mis-compras.js")), true);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
