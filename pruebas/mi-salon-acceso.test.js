/*
	Acceso a Mi Salón en el cliente (b21, spec de Jorge 2026-09-26 §5; supabase/mi_salon_b21_acceso_2026-09.sql).
	La regla la pone el servidor; sus pruebas (vencimiento calculado, gratis del T1, piloto,
	interruptor, candado en CADA tabla y tolerancia de 48 h) están en pruebas/sql/mi-salon-acceso.sql
	y corren en el proyecto de pruebas (.qa-al/sql-prueba.js). Aquí, lo del cliente:

	- js/mi-salon-acceso.js: fechas, solo lectura, textos del banner, de Mi cuenta y del aviso,
	  error de solo lectura, a dónde lleva "Renovar" (también dentro de /salon/).
	- Textos: "docente"/tú, sin "maestra"/"maestro", sin urgencia falsa y sin "prueba de 14 días"
	  (decisión de Jorge 2026-09-26: no hay prueba).
	- El candado (js/saas-guard.js) con el interruptor: activo_saas o perfiles.mi_salon.visible;
	  sin acceso vigente pasa en solo lectura (clase y estado); base sin la columna → solo activo_saas.
	- Login (LoginDestino.tieneSaas) y tienda (Tienda.veMiSalon, Tienda.miSalonAbierto).
	- La cola (js/bandeja-salida.js): cada envío lleva x-capturado-en; lo que la base rechaza por
	  solo lectura NO sale de la cola (estado "acceso", sin descartarse en silencio) y se envía al
	  renovar; una captura de antes del vencimiento entra y la de después no (48 h, del lado del
	  servidor falso: la regla real está en SQL).
	- Panel (tienda/js/admin-mi-salon.js): filtro, métricas, Excel y validación del calendario.
	- El Inicio y Mi cuenta tienen su lugar; las páginas de captura marcan sus controles.

	node pruebas/mi-salon-acceso.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");
let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. js/mi-salon-acceso.js (reglas puras) ─────────────────────────────────────
const MS = require(path.join(RAIZ, "js/mi-salon-acceso.js"));
const vencido = { vigente: false, vence: "2026-12-18", solo_lectura_desde: "2026-12-19", origen: "gratis_t1", tiene_acceso: true };
const sinAcceso = { vigente: false, vence: null, solo_lectura_desde: null, origen: null, tiene_acceso: false };
const vigente = { vigente: true, vence: "2027-07-30", solo_lectura_desde: "2027-07-31", origen: "piloto", tiene_acceso: true };

ok("fecha larga sin husos horarios", [MS.fechaLarga("2026-12-18"), MS.fechaLarga("2027-01-01"), MS.fechaLarga("")], ["18 de diciembre de 2026", "1 de enero de 2027", ""]);
ok("fecha corta", MS.fechaCorta("2026-12-18"), "18 de diciembre");
ok("solo lectura: solo si el servidor dice vigente=false", [MS.soloLectura(vencido), MS.soloLectura(sinAcceso), MS.soloLectura(vigente), MS.soloLectura(null), MS.soloLectura({})], [true, true, false, false, false]);
ok("banner de Inicio: el texto de la spec con la fecha",
	MS.textoBanner(vencido), { titulo: "Tu acceso terminó el 18 de diciembre de 2026.", texto: "Tus datos están guardados. Renueva para seguir capturando.", boton: "Renovar mi acceso" });
ok("banner: cuenta que nunca tuvo acceso (creada después del T1) → invitación, sin 'terminó'", /terminó/.test(MS.textoBanner(sinAcceso).titulo) === false && /solo lectura/.test(MS.textoBanner(sinAcceso).titulo), true);
ok("banner: con acceso vigente no hay banner", MS.textoBanner(vigente), null);
ok("aviso corto: dice que puede ver, imprimir y exportar", /ver, imprimir y exportar/.test(MS.textoCorto(vencido)) && /19 de diciembre de 2026/.test(MS.textoCorto(vencido)), true);
ok("Mi cuenta vigente: hasta cuándo y desde cuándo sería solo lectura", MS.textoCuenta(vigente).titulo + " | " + MS.textoCuenta(vigente).detalle,
	"Tu acceso está activo | Acceso completo hasta el 30 de julio de 2027. Desde el 31 de julio de 2027 tu cuenta pasa a solo lectura si no renuevas; tus datos se quedan guardados.");
ok("Mi cuenta: el origen en palabras", [MS.textoCuenta(vigente).origen, MS.textoCuenta(vencido).origen], ["Piloto de Mi Salón", "Primer trimestre gratis"]);
ok("Mi cuenta vencida: solo lectura con la fecha", [MS.textoCuenta(vencido).solo, /terminó el 18 de diciembre de 2026/.test(MS.textoCuenta(vencido).detalle)], [true, true]);
ok("Mi cuenta sin estado (base sin migrar): nada", MS.textoCuenta(null), null);
ok("error de solo lectura: por la pista o el mensaje", [
	MS.esErrorSoloLectura({ hint: "mi_salon_solo_lectura" }),
	MS.esErrorSoloLectura({ message: "x mi_salon_solo_lectura" }),
	MS.esErrorSoloLectura({ code: "42501", message: "new row violates row-level security policy" }),
	MS.esErrorSoloLectura(null)], [true, true, false, false]);
ok("Renovar lleva a la presentación (mientras no hay compra); dentro de /salon/ sale de la app",
	[MS.urlCompra("/dashboard.html"), MS.urlCompra("/salon/dashboard")], ["tienda/mi-salon-compra.html", "/tienda/mi-salon-compra.html"]);

// Textos (spec §7 y memoria de lenguaje): docente, tú, sin género, sin urgencia, sin prueba de 14 días
const textos = [MS.textoBanner(vencido), MS.textoBanner(sinAcceso), MS.textoCorto(vencido), MS.textoCorto(sinAcceso),
	MS.textoBloqueo(vencido), MS.textoBloqueo(sinAcceso), MS.textoCuenta(vigente), MS.textoCuenta(vencido), MS.textoCuenta(sinAcceso)].map((t) => JSON.stringify(t)).join(" ");
const B = require(path.join(RAIZ, "js/bandeja-salida.js"));
const todos = textos + " " + B.TEXTO_ACCESO + " " + B.TEXTO_ACCESO_PANTALLA;
ok("textos: sin 'maestra'/'maestro', sin '¡', sin 'última oportunidad'", [/maestr[ao]/i.test(todos), /¡/.test(todos), /última oportunidad/i.test(todos)], [false, false, false]);
ok("textos: sin adjetivos con género sobre la persona (bienvenida, lista, segura)", /\b(bienvenid[ao]|list[ao] para|segur[ao] de)\b/i.test(todos), false);
const archivosB21 = ["js/mi-salon-acceso.js", "js/saas-guard.js", "tienda/js/admin-mi-salon.js", "supabase/functions/bienvenida-mi-salon/index.ts",
	"supabase/mi_salon_b21_acceso_2026-09.sql", "tienda/js/login.js", "tienda/js/conoce-mi-salon.js", "tienda/admin.html"];
ok("ningún archivo de b21 habla de una prueba de 14 días (decisión de Jorge: no hay)",
	archivosB21.filter((f) => /14 d[ií]as|prueba gratis|periodo de prueba|origen[^\n]{0,20}'prueba'/i.test(leer(f).replace(/sin prueba de 14 días|Sin prueba de 14 días|no hay prueba de 14 días|NO hay prueba de 14 días|sin prueba de 14 d/gi, ""))), []);
const bienvenida = leer("supabase/functions/bienvenida-mi-salon/index.ts");
ok("correo de bienvenida: el texto de la spec, con 'Te damos la bienvenida' y la fecha de la tabla",
	[/Te damos la bienvenida a Mi Salón/.test(bienvenida), /Tu primer trimestre es gratis: tienes acceso completo hasta el \$\{hasta\}/.test(bienvenida),
		/Empieza con “Ponte al día” para capturar lo que ya llevas/.test(bienvenida), /mi_salon_periodos/.test(bienvenida), /18 de diciembre/.test(bienvenida)],
	[true, true, true, true, false]);
ok("correo de bienvenida: solo con Mi Salón abierto e idempotente (aparta la fila antes de enviar)",
	[/mi_salon_abierto/.test(bienvenida), /ignoreDuplicates: true/.test(bienvenida), bienvenida.indexOf("mi_salon_correos") < bienvenida.indexOf("enviarCorreo(resendKey")], [true, true, true]);

// ── 2. El candado (js/saas-guard.js) con el interruptor ─────────────────────────
async function candado(respuestas, pathname) {
	const r = { cols: [], expulsado: null, clases: [] };
	const clases = new Set();
	const almacen = {};
	const ventana = {
		location: { pathname: pathname || "/dashboard.html", search: "", hash: "", replace: (u) => { r.expulsado = u; } },
		sessionStorage: { getItem: (k) => almacen[k] || null, setItem: (k, v) => { almacen[k] = v; } },
		localStorage: { getItem: (k) => almacen[k] || null, setItem: (k, v) => { almacen[k] = v; }, removeItem: (k) => { delete almacen[k]; } },
		sb: {
			auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
			from: () => ({ select: (c) => { r.cols.push(c); return { eq: () => ({ maybeSingle: async () => respuestas.shift() }) }; } }),
		},
	};
	const doc = {
		documentElement: { style: {}, classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } },
		body: { children: [], appendChild() {} },
		addEventListener() {},
		createElement: () => ({ setAttribute() {}, style: {} }),
	};
	ventana.document = doc;
	const ctx = { window: ventana, document: doc, Promise, console, setTimeout };
	vm.createContext(ctx);
	vm.runInContext(leer("js/saas-guard.js"), ctx);
	const estado = await Promise.race([ventana.saasEstado, dormir(60).then(() => "sin resolver")]);
	r.estado = estado;
	r.clases = Array.from(clases);
	r.visible = doc.documentElement.style.visibility;
	return r;
}
(async () => {
	let r = await candado([{ data: { activo_saas: true, mi_salon: vigente }, error: null }]);
	ok("candado: lee activo_saas y el estado en UNA consulta", r.cols, ["activo_saas, mi_salon"]);
	ok("candado: piloto (activo_saas) pasa con su estado vigente, sin solo lectura", [r.expulsado, r.estado && r.estado.origen, r.clases.includes("ms-solo-lectura")], [null, "piloto", false]);
	r = await candado([{ data: { activo_saas: false, mi_salon: Object.assign({}, vigente, { origen: "gratis_t1", visible: false }) }, error: null }]);
	ok("candado: interruptor APAGADO, cuenta con gratis y sin activo_saas → a la tienda", r.expulsado, "tienda/catalogo.html");
	r = await candado([{ data: { activo_saas: false, mi_salon: Object.assign({}, vigente, { origen: "gratis_t1", visible: true }) }, error: null }]);
	ok("candado: interruptor ENCENDIDO (visible) → pasa", [r.expulsado, r.estado && r.estado.vigente], [null, true]);
	r = await candado([{ data: { activo_saas: false, mi_salon: Object.assign({}, vencido, { visible: true }) }, error: null }]);
	ok("candado: sin acceso vigente pasa en SOLO LECTURA (clase antes de mostrar la página)", [r.expulsado, r.clases.includes("ms-solo-lectura"), r.estado.vence], [null, true, "2026-12-18"]);
	r = await candado([{ data: { activo_saas: false, mi_salon: { visible: true, vigente: false, piloto: true } }, error: null }]);
	ok("candado: acceso piloto sin activo_saas (sumado desde el panel) → pasa", r.expulsado, null);
	r = await candado([{ data: null, error: { code: "42703", message: "column perfiles.mi_salon does not exist" } }, { data: { activo_saas: true }, error: null }]);
	ok("candado: base sin la columna → vuelve a leer solo activo_saas y pasa sin estado", [r.cols, r.expulsado, r.estado], [["activo_saas, mi_salon", "activo_saas"], null, null]);
	r = await candado([{ data: null, error: { code: "PGRST204", message: "Could not find the 'mi_salon' column of 'perfiles' in the schema cache" } }, { data: { activo_saas: false }, error: null }]);
	ok("candado: base sin la columna y sin activo_saas → a la tienda", r.expulsado, "tienda/catalogo.html");
	r = await candado([{ data: { activo_saas: "true", mi_salon: { visible: "true" } }, error: null }]);
	ok("candado: valores que no son booleanos no abren", r.expulsado, "tienda/catalogo.html");

	// ── 3. Login y tienda ──────────────────────────────────────────────────────────
	const L = require(path.join(RAIZ, "tienda/js/login.js"));
	ok("login: activo_saas o mi_salon.visible", [
		L.tieneSaas({ data: { activo_saas: true }, error: null }),
		L.tieneSaas({ data: { activo_saas: false, mi_salon: { visible: true } }, error: null }),
		L.tieneSaas({ data: { activo_saas: false, mi_salon: { visible: false } }, error: null }),
		L.tieneSaas({ data: { activo_saas: false, mi_salon: null }, error: null }),
		L.tieneSaas({ data: null, error: { message: "x" } })], [true, true, false, false, false]);
	ok("login: con Mi Salón abierto una cuenta nueva va a Mi Salón", L.porPerfil({ data: { activo_saas: false, mi_salon: { visible: true } }, error: null }, "onboarding.html"), "../onboarding.html");

	function tienda(respuestas) {
		const lecturas = [];
		const sb = { from: (t) => ({ select: (c) => ({ eq: () => ({ maybeSingle: async () => { lecturas.push(t + ":" + c); return respuestas.shift(); } }) }) }) };
		const ctx = { window: { sb, matchMedia: () => ({ matches: false }) }, sessionStorage: { getItem: () => null, setItem() {} }, console };
		ctx.window.window = ctx.window;
		vm.createContext(ctx);
		vm.runInContext(leer("tienda/js/tienda-common.js"), ctx);
		return { T: ctx.window.Tienda, lecturas };
	}
	let t = tienda([{ data: { activo_saas: false, mi_salon: { visible: true } }, error: null }]);
	ok("tienda: con Mi Salón abierto ofrece el selector", await t.T.tieneSaas({ user: { id: "u1" } }), true);
	t = tienda([{ data: null, error: { code: "42703", message: "column perfiles.mi_salon does not exist" } }, { data: { activo_saas: true }, error: null }]);
	ok("tienda: base sin la columna → solo activo_saas", [await t.T.tieneSaas({ user: { id: "u1" } }), t.lecturas], [true, ["perfiles:activo_saas, mi_salon", "perfiles:activo_saas"]]);
	t = tienda([{ data: { mi_salon_abierto: true }, error: null }]);
	ok("tienda: interruptor encendido", [await t.T.miSalonAbierto(), await t.T.miSalonAbierto(), t.lecturas.length], [true, true, 1]);
	t = tienda([{ data: { mi_salon_abierto: false }, error: null }]);
	ok("tienda: interruptor apagado", await t.T.miSalonAbierto(), false);
	t = tienda([{ data: null, error: { message: "caída" } }]);
	ok("tienda: lectura fallida → como apagado (sin enlaces)", await t.T.miSalonAbierto(), false);

	const { ConoceMiSalon } = require(path.join(RAIZ, "tienda/js/conoce-mi-salon.js"));
	const d = (s) => new Date(s);
	ok("presentación: gratis hasta el 18-dic (hora del centro); el 19 ya no",
		[ConoceMiSalon.gratisVigente("2026-12-18", d("2026-10-12T15:00:00Z")), ConoceMiSalon.gratisVigente("2026-12-18", d("2026-12-19T05:30:00Z")),
			ConoceMiSalon.gratisVigente("2026-12-18", d("2026-12-19T06:30:00Z")), ConoceMiSalon.gratisVigente(null, d("2026-10-12T15:00:00Z"))], [true, true, false, false]);
	ok("presentación: texto con la fecha de la tabla", ConoceMiSalon.textoGratis("2026-12-18"), "Crea tu cuenta y tendrás acceso completo a Mi Salón hasta el 18 de diciembre, sin tarjeta.");

	// ── 4. La cola: x-capturado-en y lo rechazado por solo lectura se conserva ─────────
	ok("cola: tipo de fallo 'acceso' con la pista (no 'rechazo')", [
		B.tipoDeFallo({ status: 403, code: "42501", hint: "mi_salon_solo_lectura", message: "Mi Salón está en modo solo lectura" }),
		B.tipoDeFallo({ status: 403, code: "42501", message: "new row violates row-level security policy" })], ["acceso", "rechazo"]);
	ok("cola: la hora de un lote es la más reciente", B.capturaDeLote([{ capturado_en: "2026-12-18T10:00:00.000Z" }, { capturado_en: "2026-12-18T12:00:00.000Z" }, { capturado_en: "x" }]), "2026-12-18T12:00:00.000Z");
	const conSetHeader = { from: () => ({ upsert: () => ({ h: {}, setHeader(k, v) { this.h[k] = v; return this; } }) }) };
	ok("cola: conCaptura pone la cabecera con setHeader", B.conCaptura(conSetHeader, "2026-12-18T10:00:00.000Z").from("asistencias").upsert({}).h, { "x-capturado-en": "2026-12-18T10:00:00.000Z" });
	const conHeaders = { from: () => ({ insert: () => ({ headers: {} }) }) };
	ok("cola: con un cliente viejo (sin setHeader) usa sus cabeceras", B.conCaptura(conHeaders, "2026-12-18T10:00:00.000Z").from("x").insert({}).headers["x-capturado-en"], "2026-12-18T10:00:00.000Z");
	ok("cola: sin hora, el mismo cliente", B.conCaptura(conSetHeader, null) === conSetHeader, true);

	// Servidor falso: asistencias con marca por fila; sin acceso vigente acepta solo x-capturado-en < fin
	const srv = { filas: [], fin: null, cerrado: false, cabeceras: [], n: 1 };
	function sbFalso() {
		function from(tabla) {
			const q = { op: "select", filtros: [], cols: "*", h: {} };
			const api = {
				select(c) { if (q.op !== "select") q.devolver = true; q.cols = c || "*"; return api; },
				insert(f) { q.op = "insert"; q.filas = [].concat(f); return api; },
				upsert(f, o) { q.op = "upsert"; q.filas = [].concat(f); q.ignorar = !!(o && o.ignoreDuplicates); return api; },
				update(f) { q.op = "update"; q.fila = f; return api; },
				delete() { q.op = "delete"; return api; },
				eq(c, v) { q.filtros.push([c, v]); return api; },
				is(c) { q.filtros.push([c, null]); return api; },
				or() { return api; },
				maybeSingle() { q.uno = true; return api; },
				single() { q.uno = true; return api; },
				setHeader(k, v) { q.h[k] = v; return api; },
				then(res, rej) {
					return Promise.resolve().then(() => {
						if (q.op !== "select") {
							srv.cabeceras.push(q.h["x-capturado-en"] || null);
							const cap = q.h["x-capturado-en"] ? Date.parse(q.h["x-capturado-en"]) : null;
							const pasa = !srv.cerrado || (srv.fin !== null && cap !== null && cap < srv.fin);
							if (!pasa) return { data: null, error: { code: "42501", message: "Mi Salón está en modo solo lectura: tu acceso terminó. Tus datos están guardados.", hint: "mi_salon_solo_lectura" }, status: 403 };
						}
						const coincide = (x) => q.filtros.every(([c, v]) => (v === null ? x[c] == null : x[c] === v));
						const proy = (x) => { if (q.cols === "*") return Object.assign({}, x); const o = {}; q.cols.split(",").map((s) => s.trim()).forEach((k) => { o[k] = x[k] === undefined ? null : x[k]; }); return o; };
						if (q.op === "insert" || q.op === "upsert") {
							const puestas = [];
							q.filas.forEach((f) => {
								const previa = srv.filas.find((x) => x.alumno_id === f.alumno_id && x.fecha === f.fecha);
								if (previa) { if (!q.ignorar) Object.assign(previa, f); return; }
								const nueva = Object.assign({ id: "id" + srv.n++ }, f);
								if (!nueva.captura_id) nueva.captura_id = "srv-" + srv.n;
								srv.filas.push(nueva); puestas.push(nueva);
							});
							return { data: q.devolver ? puestas.map(proy) : null, error: null, status: 201 };
						}
						const el = srv.filas.filter(coincide);
						if (q.op === "update") { el.forEach((x) => Object.assign(x, q.fila)); return { data: q.devolver ? el.map(proy) : null, error: null, status: 200 }; }
						if (q.op === "delete") { srv.filas = srv.filas.filter((x) => !el.includes(x)); return { data: el.map(proy), error: null, status: 200 }; }
						return q.uno ? { data: el[0] ? proy(el[0]) : null, error: null, status: 200 } : { data: el.map(proy), error: null, status: 200 };
					}).then(res, rej);
				},
			};
			return api;
		}
		return { from, auth: { getSession: async () => ({ data: { session: { user: { id: "m1" } } }, error: null }) } };
	}
	const sb = sbFalso();
	const ev = { rechazos: [], bloqueos: [], cambios: [] };
	const b = B.crear({
		sb, auth: sb.auth, maestroId: "m1", almacen: B.almacenMemoria(), esperaMax: 40, canal: false, cerrojo: false,
		alCambiar: (e) => ev.cambios.push(e.estado + ":" + e.pendientes),
		alRechazar: (it) => ev.rechazos.push(it.descripcion),
		alBloquear: (it) => ev.bloqueos.push(it.descripcion),
	});
	const asis = (a, e) => ({ grupo_id: "g1", alumno_id: a, fecha: "2026-12-18", estado: e });
	// Sin señal: la A se captura ANTES del vencimiento y la B DESPUÉS
	srv.cerrado = true; srv.fin = null; // todavía no llega nada: sin acceso y sin hora válida → se conserva
	await b.agregar("asistencia", asis("a1", "presente"), "Asistencia de A", null, { campos: ["estado"] });
	await dormir(15);
	srv.fin = Date.now();
	await dormir(15);
	await b.agregar("asistencia", asis("a2", "ausente"), "Asistencia de B", null, { campos: ["estado"] });
	b.iniciar();
	await dormir(120);
	ok("cola (dentro de 48 h): la captura de ANTES del vencimiento se guardó", srv.filas.map((f) => f.alumno_id + ":" + f.asistencia_estado), ["a1:presente"]);
	ok("cola: la de DESPUÉS se conserva en el aparato (no se descarta)", (await b.lista()).map((x) => x.descripcion), ["Asistencia de B"]);
	ok("cola: estado 'acceso' con 1 pendiente, y se avisó", [b.estado(), b.pendientes(), ev.bloqueos.includes("Asistencia de B")], ["acceso", 1, true]);
	ok("cola: no se trató como rechazo (nada salió de la cola)", ev.rechazos, []);
	ok("cola: cada envío llevó su hora de captura", srv.cabeceras.every((h) => typeof h === "string" && !isNaN(Date.parse(h))), true);
	const intentos = srv.cabeceras.length;
	await dormir(150);
	ok("cola: en estado 'acceso' no se reintenta sola en bucle", srv.cabeceras.length, intentos);
	// Fuera de las 48 h: tampoco entra nada (el servidor ya no acepta ninguna hora)
	srv.fin = 0;
	await b.procesar();
	await dormir(60);
	ok("cola (fuera de 48 h): sigue guardada con aviso", [b.pendientes(), b.estado()], [1, "acceso"]);
	// Renueva: al volver a intentar (abrir la página, volver la red o a primer plano) se envía sola
	srv.cerrado = false;
	await b.procesar();
	await Promise.race([b.vacia(), dormir(500)]);
	ok("cola: al renovar se envía y la cola queda vacía", [srv.filas.map((f) => f.alumno_id).sort(), b.pendientes(), b.estado()], [["a1", "a2"], 0, "ok"]);

	// Los avisos de la cola en pantalla hablan del acceso
	ok("Hoy y Exámenes muestran el estado 'acceso'", [/e\.estado === "acceso"/.test(leer("js/hoy.js")), /e\.estado === "acceso"/.test(leer("js/examen.js")), /ultimo\.estado === "acceso"/.test(leer("js/bandeja-salida.js"))], [true, true, true]);

	// ── 5. Panel de administración (reglas puras) ───────────────────────────────────
	const A = require(path.join(RAIZ, "tienda/js/admin-mi-salon.js"));
	const docentes = [
		{ id: "1", email: "ana@x.mx", nombre: "Ana Pérez", estado: "vigente", origen: "gratis_t1", periodos: ["T1"], vence: "2026-12-18", creada: "2026-10-13T10:00:00Z", grupos: 1, ponte_al_dia: true, boleta_gratis: true, boleta_gratis_cerrada: false, accesos: [{ origen: "gratis_t1", periodos: ["T1"] }] },
		{ id: "2", email: "luis@x.mx", nombre: "Luis Núñez", estado: "por_vencer", origen: "pago", periodos: ["T2"], vence: "2027-04-09", precio_pagado: 199, tipo_precio: "fundador", creada: "2026-09-01T10:00:00Z", grupos: 2, ponte_al_dia: false, boleta_gratis: true, boleta_gratis_cerrada: true, accesos: [{ origen: "pago", periodos: ["T2"] }] },
		{ id: "3", email: "sin@x.mx", nombre: null, estado: "solo_lectura", origen: null, periodos: null, vence: null, creada: "2026-12-20T10:00:00Z", grupos: 0, accesos: [] },
	];
	ok("panel: fecha corta", A.fecha("2026-12-18"), "18 dic 2026");
	ok("panel: filtro por estado", A.filtrar(docentes, "solo_lectura", "").map((d) => d.id), ["3"]);
	ok("panel: búsqueda sin acentos ni mayúsculas", A.filtrar(docentes, "", "NUNEZ").map((d) => d.id), ["2"]);
	const m = A.metricas(docentes, { mi_salon_abierto_desde: "2026-10-12T15:00:00Z" });
	ok("panel: métricas", [m.cuentas, m.nuevas, m.con_grupo, m.ponte_al_dia, m.boleta, m.boleta_cerrada, m.pagaron_t2, m.vigente, m.por_vencer, m.solo_lectura], [3, 2, 2, 1, 2, 1, 1, 1, 1, 1]);
	const x = A.filasExcel(docentes);
	ok("panel: Excel con origen, periodos, vence, monto y tipo de precio", [x[1].Origen, x[1].Periodos, x[1].Vence, x[1]["Monto pagado"], x[1]["Tipo de precio"], x[2]["Monto pagado"]], ["Pago", "T2", "2027-04-09", 199, "Fundador", ""]);
	ok("panel: nombre del archivo por estado", [A.nombreArchivo("por_vencer", "2026-12-01"), A.nombreArchivo("", "2026-12-01")], ["mi-salon-docentes-por-vencer-2026-12-01.xlsx", "mi-salon-docentes-todos-2026-12-01.xlsx"]);
	const T1 = { ciclo: "2026-2027", periodo: "T1", venta_desde: "2026-08-31", compra_tardia_desde: "2026-10-23", registro_calificaciones: "2026-11-13", boletas_fin: "2026-11-26", vence: "2026-12-18" };
	ok("panel: el calendario de la spec es válido", A.validarPeriodo(T1), null);
	ok("panel: vence antes de las boletas se rechaza", /no puede ir antes/.test(A.validarPeriodo(Object.assign({}, T1, { vence: "2026-11-20" }))), true);
	ok("panel: fechas vacías se rechazan", /faltan fechas/.test(A.validarPeriodo(Object.assign({}, T1, { vence: "" }))), true);

	// ── 6. Páginas ─────────────────────────────────────────────────────────────────
	const conCandado = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && /src="js\/saas-guard\.js"/.test(leer(f)) && f !== "sala-maestros.html" && f !== "portal.html");
	const sinAcceso2 = conCandado.filter((f) => { const h = leer(f); const g = h.indexOf('src="js/saas-guard.js"'), a = h.indexOf('src="js/mi-salon-acceso.js"'); return !(a > g); });
	ok("las " + conCandado.length + " páginas de Mi Salón cargan js/mi-salon-acceso.js después del candado", sinAcceso2, []);
	ok("Inicio tiene el lugar del banner y Mi cuenta el del estado", [/id="avisoAcceso"/.test(leer("dashboard.html")), /id="estadoAcceso"/.test(leer("mi-cuenta.html"))], [true, true]);
	const captura = ["hoy", "ponte-al-dia", "asistencia", "mi-grupo", "onboarding", "actividades", "examen", "listas", "incidencias", "calendario", "ajustes", "evaluacion_diagnostica", "evaluacion_formativa", "reportes", "planeacion", "crear_proyecto", "tareas"];
	ok("las páginas de captura marcan sus controles (data-captura)", captura.filter((p) => !/data-captura/.test(leer(p + ".html"))), []);
	ok("Ajustes: borrar la cuenta NO queda bloqueado", /id="(showDeleteFormBtn|confirmDeleteBtn)"[^>]*data-captura/.test(leer("ajustes.html")), false);
	// R27a: el selector de trimestre de Mi grupo en solo lectura se ve deshabilitado, dice por qué y
	// no ofrece "Intenta de nuevo" (reintentar no sirve)
	const mg = leer("js/mi-grupo.js");
	ok("Mi grupo: el trimestre en solo lectura queda deshabilitado, con explicación y sin 'Intenta de nuevo'", [
		/<select id="trimestreActualSelect" data-captura/.test(leer("mi-grupo.html")),
		/trimestreSelect\.disabled = guardandoTrimestre \|\| solo;/.test(mg),
		/if \(solo\) mensajeTrimestre\("lectura", TEXTO_TRIMESTRE_SOLO_LECTURA\)/.test(mg),
		/TEXTO_TRIMESTRE_SOLO_LECTURA = "Solo lectura:[^"]*no se puede cambiar/.test(mg) && !/TEXTO_TRIMESTRE_SOLO_LECTURA = "[^"]*Intenta/.test(mg),
		/esErrorSoloLectura\(error\)\) \{[\s\S]{0,200}return;/.test(mg),
		/window\.saasEstado\.then\(function \(\) \{ renderTrimestreActual\(\); \}/.test(mg),
		/if \(t !== sug\.trimestre && !solo\)/.test(mg),
	], [true, true, true, true, true, true, true]);
	const rep = leer("js/reportes.js");
	const guardarTextos = (rep.match(/\n\tasync function guardarTextosPropuestos\([\s\S]*?\n\t\}/) || [""])[0];
	ok("Boleta: la propuesta no se guarda en solo lectura (se ve e imprime)",
		[/upserts\.length && !soloLecturaMS\(\)/.test(rep), /window\.MiSalonAcceso && window\.MiSalonAcceso\.soloLectura\(\)\) return null;/.test(guardarTextos)], [true, true]);
	ok("redactar-boleta revisa el acceso vigente antes de la API", /rpc\("mi_salon_puede_escribir"\)/.test(leer("supabase/functions/redactar-boleta/index.ts")), true);
	ok("js/supabase.js avisa de un 403 de solo lectura sin tocar la respuesta", /jissez:solo-lectura/.test(leer("js/supabase.js")) && /return resp;/.test(leer("js/supabase.js")), true);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
