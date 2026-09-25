/*
	La cola de "Hoy" guardada en el dispositivo (js/bandeja-salida.js; fase 2.5 de
	docs/PWA-MI-SALON.md, §9.3), contra un Supabase falso que imita las llaves únicas de la base:
	asistencias (grupo, alumno, fecha), registro_diario (maestro, alumno, fecha) y el índice
	único parcial de calificaciones (maestro, alumno, producto), y RLS (cada sesión ve y escribe
	solo lo de su cuenta).

	- Guardar sin red, "recargar" (otra bandeja sobre el mismo almacén) y reenviar: todo llega
	  UNA sola vez, con el último valor de cada llave.
	- Reenviar lo mismo no duplica.
	- Un error que no es de red (403, CHECK, 409) se avisa en español y sale de la cola: no se
	  reintenta. Un lote del cierre con una fila mala se manda de una en una. 5xx se reintenta.
	- Concurrencia optimista (dos dispositivos): sin cambios en la base se escribe; si otro
	  dispositivo la cambió o la creó, NO se pisa, se avisa y sale de la cola; retirar un
	  cierre que otro cambió no lo borra; no depende del reloj del aparato.
	- Una versión vieja en camino no borra la nueva ni la vuelve "conflicto".
	- El mismo dispositivo (R12): un doble toque mientras se refresca la sesión con la respuesta
	  perdida, y otra ventana que envía lo que capturó esta, no dan avisos falsos; una captura
	  superada por otra más nueva del dispositivo no la pisa; un solo aviso por dato; el orden es el
	  de captura del dispositivo, no el reloj.
	- La cola es de la cuenta que capturó: con la sesión de otra cuenta no se envía nada.
	- Sesión vencida se refresca y se reintenta; sin sesión se espera.

	node pruebas/bandeja-salida.test.js [ruta de otra versión de bandeja-salida.js]
*/
const path = require("path");
const B = require(process.argv[2] ? path.resolve(process.argv[2]) : "../js/bandeja-salida.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
// Un caso que puede lanzar con otra versión del código: la excepción cuenta como falla
async function caso(nombre, fn) {
	try { await fn(); } catch (e) { fallos++; console.log("FALLA " + nombre + " → excepción: " + (e && e.message)); }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera a que la cola se vacíe, con tope (una versión con fallas podría no vaciarla nunca)
function vacia(b, ms) { return Promise.race([b.vacia(), dormir(ms || 1500)]); }

// ── Supabase falso ───────────────────────────────────────────────────────────
function crearBD() {
	return { asistencias: [], registro_diario: [], calificaciones: [], siguiente: 1 };
}
const UNICAS = {
	asistencias: ["grupo_id", "alumno_id", "fecha"],
	registro_diario: ["maestro_id", "alumno_id", "fecha"],
	calificaciones: ["maestro_id", "alumno_id", "producto_sesion_id"],
};

/*
	cliente(bd, modo, sesion) → { from, auth, peticiones, modo, sesion }
	  modo.red = true            → toda petición falla como sin red (status 0)
	  modo.rechazo = { tabla, status, code, message, si(fila) } → escrituras rechazadas
	  modo.jwt = n               → las siguientes n escrituras responden 401 (JWT expired)
	  modo.e500 = n              → las siguientes n escrituras responden 500
	  modo.demora = ms           → cada petición tarda
	  modo.perder = n            → las siguientes n escrituras SÍ se aplican pero la respuesta se pierde
	  sesion: la sesión del dispositivo ({ user: { id } } o null); RLS: solo se ve y escribe lo de esa cuenta
*/
function cliente(bd, modo, sesion) {
	modo = modo || {};
	const c = { peticiones: [], modo, sesion: sesion === undefined ? { user: { id: "m1" } } : sesion };
	const uid = () => (c.sesion && c.sesion.user ? c.sesion.user.id : null);
	function coincide(fila, filtros) {
		return filtros.every(([col, op, v]) => (op === "is" ? fila[col] === null || fila[col] === undefined : fila[col] === v));
	}
	function cumpleOr(fila, expr) {
		if (!expr) return true;
		return expr.split(",").some((parte) => {
			const m = parte.match(/^(\w+)\.(is|lte)\.(.+)$/);
			if (!m) throw new Error("or no soportado: " + parte);
			if (m[2] === "is") return fila[m[1]] === null || fila[m[1]] === undefined;
			return fila[m[1]] !== null && fila[m[1]] !== undefined && fila[m[1]] <= m[3];
		});
	}
	function proyectar(fila, cols) {
		if (!cols || cols === "*") return Object.assign({}, fila);
		const o = {};
		cols.split(",").map((s) => s.trim()).forEach((k) => { o[k] = fila[k] === undefined ? null : fila[k]; });
		return o;
	}
	function ejecutar(tabla, q) {
		c.peticiones.push(tabla + ":" + q.op + (q.ignorar ? "-ignorar" : ""));
		if (modo.red) return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };
		const escribe = q.op !== "select";
		if (escribe && modo.jwt > 0) { modo.jwt--; return { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 }; }
		if (escribe && modo.e500 > 0) { modo.e500--; return { data: null, error: { message: "error interno", code: "XX000" }, status: 500 }; }
		const filas = q.filas || (q.fila && q.op === "insert" ? [q.fila] : []);
		const r = modo.rechazo;
		if (escribe && r && r.tabla === tabla && (!r.si || filas.some(r.si) || q.op === "update" || q.op === "delete")) {
			return { data: null, error: { message: r.message || "rechazado", code: r.code || "" }, status: r.status || 400 };
		}
		const yo = uid();
		if (!yo) return { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 };
		const t = bd[tabla];
		const visibles = t.filter((x) => x.maestro_id === yo);
		const respuesta = (data, status) => {
			if (escribe && modo.perder > 0) { modo.perder--; return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }; }
			return { data, error: null, status };
		};
		if (q.op === "insert" || q.op === "upsert") {
			if (filas.some((f) => f.maestro_id !== yo)) {
				return { data: null, error: { message: "new row violates row-level security policy", code: "42501" }, status: 403 };
			}
			const puestas = [];
			for (const f of filas) {
				const previa = t.find((x) => UNICAS[tabla].every((k) => x[k] === f[k]));
				if (previa) {
					if (q.op === "upsert" && q.ignorar) continue;
					if (q.op === "upsert") { Object.assign(previa, f); puestas.push(previa); continue; }
					return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, status: 409 };
				}
				const nueva = Object.assign({ id: "id" + bd.siguiente++ }, f);
				t.push(nueva);
				puestas.push(nueva);
			}
			const data = q.devolver ? puestas.map((x) => proyectar(x, q.cols)) : null;
			return respuesta(q.uno ? data && data[0] : data, 201);
		}
		const elegidas = visibles.filter((x) => coincide(x, q.filtros) && cumpleOr(x, q.or));
		if (q.op === "update") {
			elegidas.forEach((x) => Object.assign(x, q.fila));
			return respuesta(q.devolver ? elegidas.map((x) => proyectar(x, q.cols)) : null, 200);
		}
		if (q.op === "delete") {
			bd[tabla] = t.filter((x) => !elegidas.includes(x));
			return respuesta(q.devolver ? elegidas.map((x) => proyectar(x, q.cols)) : null, 200);
		}
		if (q.uno) return { data: elegidas[0] ? proyectar(elegidas[0], q.cols) : null, error: null, status: 200 };
		return { data: elegidas.map((x) => proyectar(x, q.cols)), error: null, status: 200 };
	}
	function from(tabla) {
		const q = { op: "select", filtros: [], or: null, cols: "*" };
		const api = {
			select(cols) { if (q.op !== "select") q.devolver = true; q.cols = cols || "*"; return api; },
			insert(f) { q.op = "insert"; q.fila = f; q.filas = [].concat(f); return api; },
			upsert(f, o) { q.op = "upsert"; q.filas = [].concat(f); q.ignorar = !!(o && o.ignoreDuplicates); return api; },
			update(f) { q.op = "update"; q.fila = f; return api; },
			delete() { q.op = "delete"; return api; },
			eq(col, v) { q.filtros.push([col, "eq", v]); return api; },
			is(col, v) { q.filtros.push([col, "is", v]); return api; },
			or(s) { q.or = s; return api; },
			single() { q.uno = true; return api; },
			maybeSingle() { q.uno = true; return api; },
			then(res, rej) {
				const correr = () => ejecutar(tabla, q);
				const p = modo.demora ? dormir(modo.demora).then(correr) : Promise.resolve().then(correr);
				return p.then(res, rej);
			},
		};
		return api;
	}
	c.from = from;
	c.auth = { getSession: async () => ({ data: { session: c.sesion }, error: null }) };
	return c;
}

function bandeja(sb, almacen, extra) {
	const eventos = { rechazos: [], conflictos: [], guardadas: [], cambios: [] };
	const b = B.crear(Object.assign({
		sb, auth: sb.auth, maestroId: "m1", almacen, esperaMax: 40,
		alCambiar: (e) => eventos.cambios.push(e),
		alGuardar: (it, r) => eventos.guardadas.push([it.clave, r]),
		alRechazar: (it, x, info) => eventos.rechazos.push([it.descripcion, x, info]),
		alConflicto: (it, info) => eventos.conflictos.push([it.descripcion, info]),
	}, extra || {}));
	b.eventos = eventos;
	return b;
}

function calif(alumno, producto, cambios, id) {
	return {
		id: id || null, fecha: "2026-09-25",
		fila: Object.assign({
			maestro_id: "m1", alumno_id: alumno, grupo_id: "g1", producto_sesion_id: producto,
			estado_entrega: null, nivel: null, puntaje: null, retroalimentacion: null,
		}, cambios),
	};
}
const F = "2026-09-25";
const asis = (alumno, estado) => ({ grupo_id: "g1", alumno_id: alumno, fecha: F, estado });
const reg = (alumno, p, c) => ({ alumno_id: alumno, fecha: F, participacion: p, conducta: c });
const vCal = (o) => Object.assign({ estado_entrega: null, nivel: null, puntaje: null, retroalimentacion: null }, o);

(async function () {
	// ── Reglas puras ─────────────────────────────────────────────────────────────
	ok("sin respuesta (status 0) → red", B.tipoDeFallo({ status: 0, message: "TypeError: Failed to fetch" }), "red");
	ok("fetch que lanza sin status → red", B.tipoDeFallo(new TypeError("Failed to fetch")), "red");
	ok("503 y 429 → red", [B.tipoDeFallo({ status: 503 }), B.tipoDeFallo({ status: 429 })], ["red", "red"]);
	ok("401 / JWT → sesión", [B.tipoDeFallo({ status: 401 }), B.tipoDeFallo({ status: 400, message: "JWT expired" })], ["sesion", "sesion"]);
	ok("400, 403, 404, 409 → rechazo", [400, 403, 404, 409].map((s) => B.tipoDeFallo({ status: s, code: "x" })), ["rechazo", "rechazo", "rechazo", "rechazo"]);
	ok("error de Postgres sin status (trigger) → rechazo", B.tipoDeFallo({ code: "P0001", message: "boleta cerrada" }), "rechazo");
	ok("excepción que no se entiende → red (nunca se descarta a ciegas)", B.tipoDeFallo(new Error("algo raro")), "red");
	ok("explicación de un 403", /no lo permitió/.test(B.explicar({ status: 403, code: "42501" })), true);
	ok("explicación de un trigger: su mensaje", B.explicar({ code: "P0001", message: "La boleta ya está cerrada" }), "La boleta ya está cerrada");
	const x409 = B.explicar({ status: 409, code: "23505", message: "duplicate key value violates unique constraint" });
	ok("409: explicación en español, sin el texto técnico en inglés", [/duplicate|constraint/i.test(x409), /otro dispositivo/.test(x409)], [false, true]);
	ok("error desconocido: sin el texto técnico", /violates|syntax/i.test(B.explicar({ status: 400, code: "42601", message: "syntax error at or near" })), false);
	ok("llave de la asistencia: grupo, alumno y fecha", B.clave("asistencia", "m1", { grupo_id: "g", alumno_id: "a", fecha: "f" }), "asistencia|g|a|f");
	ok("cierre y retirar el cierre comparten llave",
		B.clave("registro", "m1", { alumno_id: "a", fecha: "f" }) === B.clave("registro_borrar", "m1", { alumno_id: "a", fecha: "f" }), true);

	// ── 1. Sin red: se guarda en el dispositivo ──────────────────────────────────
	const bd = crearBD();
	const almacen = B.almacenMemoria(); // el mismo objeto en las dos "cargas" = el dispositivo
	const sinRed = cliente(bd, { red: true });
	const b1 = bandeja(sinRed, almacen);
	b1.iniciar();
	await b1.agregar("asistencia", asis("a1", "presente"), "Asistencia de A1");
	await b1.agregar("asistencia", asis("a2", "presente"), "Asistencia de A2");
	await b1.agregar("asistencia", asis("a1", "ausente"), "Asistencia de A1");
	await b1.agregar("calificacion", calif("a1", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de A1");
	await dormir(5);
	await b1.agregar("calificacion", calif("a1", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de A1");
	await b1.agregar("registro", reg("a1", 2, 1), "Cierre de A1");
	await b1.agregar("registro", reg("a2", 1, 1), "Cierre de A2");
	await b1.agregar("registro_borrar", { alumno_id: "a2", fecha: F }, "Cierre de A2");
	await dormir(30);
	ok("sin red: una captura por llave (5 pendientes)", b1.pendientes(), 5);
	ok("sin red: el estado es 'red'", b1.estado(), "red");
	ok("sin red: el aviso dice cuántas y que es la red", b1.eventos.cambios.slice(-1)[0].pendientes + "/" + b1.eventos.cambios.slice(-1)[0].estado, "5/red");
	ok("sin red: nada llegó a la base", [bd.asistencias.length, bd.calificaciones.length, bd.registro_diario.length], [0, 0, 0]);
	ok("sin red: nada se descartó", b1.eventos.rechazos.length, 0);
	const antes = sinRed.peticiones.length;
	await dormir(150);
	ok("sin red: se reintenta con espera (siguió intentando)", sinRed.peticiones.length > antes, true);
	await caso("sin red: esperarEnvio no se queda colgado", async () => {
		ok("sin red: esperarEnvio responde 'red' (Trabajar hoy no se cuelga)", await Promise.race([b1.esperarEnvio(), dormir(300).then(() => "colgado")]), "red");
	});

	// ── 2. "Recargar" con red: otra bandeja sobre el mismo dispositivo ───────────
	const conRed = cliente(bd, {});
	const b2 = bandeja(conRed, almacen);
	ok("al recargar, lo pendiente sigue en el dispositivo", (await b2.lista()).length, 5);
	await b2.iniciar();
	await vacia(b2);
	ok("con red: la cola quedó vacía", b2.pendientes(), 0);
	ok("asistencia: una fila por alumno y el último valor",
		bd.asistencias.map((a) => a.alumno_id + ":" + a.asistencia_estado).sort(), ["a1:ausente", "a2:presente"]);
	ok("calificación: una sola fila, con el último valor", bd.calificaciones.map((c) => c.alumno_id + ":" + c.nivel), ["a1:en_proceso"]);
	ok("cierre: el de A1 guardado y el de A2 nunca se escribió", bd.registro_diario.map((r) => r.alumno_id + ":" + r.participacion), ["a1:2"]);
	ok("calificación: un solo insert (sin duplicados)", conRed.peticiones.filter((p) => p === "calificaciones:insert").length, 1);
	ok("el id de la calificación nueva se entrega a la pantalla",
		b2.eventos.guardadas.some(([c, r]) => c === "calificacion|m1|a1|p1" && r.id === bd.calificaciones[0].id), true);
	ok("'Todo guardado': el último aviso es 0 pendientes", b2.eventos.cambios.slice(-1)[0].pendientes, 0);
	ok("sin conflictos ni rechazos en el uso normal", [b2.eventos.conflictos.length, b2.eventos.rechazos.length], [0, 0]);

	// Reenviar lo mismo (otra pestaña, o una respuesta que no llegó) no duplica ni es conflicto
	await b2.agregar("asistencia", asis("a1", "ausente"), "Asistencia de A1", null);
	await b2.agregar("calificacion", calif("a1", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de A1", null);
	await vacia(b2);
	ok("reenviar: siguen 2 asistencias y 1 calificación", [bd.asistencias.length, bd.calificaciones.length], [2, 1]);
	ok("reenviar lo mismo no es conflicto", b2.eventos.conflictos.length, 0);

	// ── 3. Error que no es de red: se avisa y NO se reintenta ────────────────────
	const bd3 = crearBD();
	const rechaza = cliente(bd3, { rechazo: { tabla: "asistencias", status: 403, code: "42501", message: "new row violates row-level security policy" } });
	const b3 = bandeja(rechaza, B.almacenMemoria());
	b3.iniciar();
	await b3.agregar("asistencia", asis("a9", "presente"), "Asistencia de A9");
	await b3.agregar("registro", reg("a1", 1, 1), "Cierre de A1");
	await vacia(b3);
	await dormir(200);
	ok("rechazo: se intentó una sola vez", rechaza.peticiones.filter((p) => /^asistencias:(upsert|insert|update)/.test(p)).length, 1);
	ok("rechazo: se avisó con su explicación", b3.eventos.rechazos.map((r) => r[0] + " — " + /no lo permitió/.test(r[1])), ["Asistencia de A9 — true"]);
	ok("rechazo: salió de la cola y lo demás sí se guardó", [b3.pendientes(), bd3.registro_diario.length], [0, 1]);
	ok("rechazo: la pantalla recibe lo que hay en la base (nada)", b3.eventos.rechazos.map((r) => r[2] && r[2].actual), [null]);

	// Lote del cierre con una fila que viola un CHECK: se manda de una en una y solo esa sale
	const bd4 = crearBD();
	const check = cliente(bd4, { rechazo: { tabla: "registro_diario", status: 400, code: "23514", message: "violates check constraint", si: (f) => f.participacion > 2 } });
	const b4 = bandeja(check, B.almacenMemoria());
	await b4.agregar("registro", reg("a1", 1, 1), "Cierre de A1");
	await b4.agregar("registro", reg("a2", 7, 1), "Cierre de A2");
	await b4.agregar("registro", reg("a3", 0, 2), "Cierre de A3");
	b4.iniciar();
	await vacia(b4);
	ok("lote con una fila mala: las buenas se guardan", bd4.registro_diario.map((r) => r.alumno_id).sort(), ["a1", "a3"]);
	ok("lote con una fila mala: solo esa se avisa", b4.eventos.rechazos.map((r) => r[0] + ": " + r[1]), ["Cierre de A2: un valor capturado no es válido"]);

	// 500 del servidor: se reintenta y el estado NO es "sin señal"
	await caso("500: estado servidor", async () => {
		const bd4b = crearBD();
		const s500 = cliente(bd4b, { e500: 2 });
		const b4b = bandeja(s500, B.almacenMemoria(), { esperaMax: 30 });
		b4b.iniciar();
		await b4b.agregar("asistencia", asis("a1", "presente"), "A1");
		await dormir(5);
		const estados = b4b.eventos.cambios.map((e) => e.estado);
		await vacia(b4b);
		ok("500: el estado es 'servidor' (no 'sin señal')", estados.indexOf("servidor") !== -1 && estados.indexOf("red") === -1, true);
		ok("500: se reintenta y al final llega una vez", bd4b.asistencias.map((a) => a.asistencia_estado), ["presente"]);
	});

	// ── 4. Concurrencia optimista: dos dispositivos, la misma maestra ────────────
	// 4a. Sin cambios en la base: se escribe
	await caso("4a", async () => {
		const bdA = crearBD();
		bdA.asistencias.push({ id: "x1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		bdA.registro_diario.push({ id: "x2", maestro_id: "m1", alumno_id: "a1", fecha: F, participacion: 1, conducta: 1 });
		bdA.calificaciones.push({ id: "x3", maestro_id: "m1", alumno_id: "a1", producto_sesion_id: "p1", nivel: "logrado", estado_entrega: "entregado", puntaje: 8, retroalimentacion: "Bien" });
		const bA = bandeja(cliente(bdA, {}), B.almacenMemoria());
		bA.iniciar();
		await bA.agregar("asistencia", asis("a1", "justificada"), "Asistencia de A1", { estado: "presente" });
		await bA.agregar("registro", reg("a1", 2, 1), "Cierre de A1", { participacion: 1, conducta: 1 });
		await bA.agregar("calificacion", calif("a1", "p1", { nivel: "en_proceso", estado_entrega: "entregado", puntaje: 7, retroalimentacion: "Revisa" }), "Calificación de A1",
			vCal({ nivel: "logrado", estado_entrega: "entregado", puntaje: 8, retroalimentacion: "Bien" }));
		await vacia(bA);
		ok("sin cambios en la base: se escribe (asistencia, cierre, calificación)",
			[bdA.asistencias[0].asistencia_estado, bdA.registro_diario[0].participacion, bdA.calificaciones[0].nivel + "/" + bdA.calificaciones[0].puntaje + "/" + bdA.calificaciones[0].retroalimentacion],
			["justificada", 2, "en_proceso/7/Revisa"]);
		ok("sin cambios: sin conflictos", bA.eventos.conflictos.length, 0);
		ok("sin cambios: la pantalla recibe el valor que quedó", bA.eventos.guardadas.map(([c, r]) => c.split("|")[0] + ":" + JSON.stringify(r.valor)),
			['asistencia:{"estado":"justificada"}', 'registro:{"participacion":2,"conducta":1}',
				'calificacion:{"estado_entrega":"entregado","nivel":"en_proceso","puntaje":7,"retroalimentacion":"Revisa"}']);
	});

	// 4b. Cambiado en otro lado: no se pisa y se avisa (r11: A sin red antes, B con red después)
	await caso("4b", async () => {
		const bdB = crearBD();
		const alm = B.almacenMemoria();
		const semilla = { nivel: "logrado", estado_entrega: "entregado", puntaje: null, retroalimentacion: null };
		["p1", "p2", "p3", "p4"].forEach((p) => bdB.calificaciones.push(Object.assign({ id: "c" + p, maestro_id: "m1", alumno_id: "a1", producto_sesion_id: p }, semilla)));
		bdB.asistencias.push({ id: "x1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		bdB.registro_diario.push({ id: "x2", maestro_id: "m1", alumno_id: "a1", fecha: F, participacion: 1, conducta: 1 });
		// A, sin red, captura sobre lo que vio
		const sA = cliente(bdB, { red: true });
		const bA = bandeja(sA, alm);
		bA.iniciar();
		await bA.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", { estado: "presente" });
		await bA.agregar("registro", reg("a1", 0, 1), "Cierre del día de Ana", { participacion: 1, conducta: 1 });
		await bA.agregar("calificacion", calif("a1", "p1", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Semáforo de Ana", vCal(semilla));
		await bA.agregar("calificacion", calif("a1", "p2", { nivel: null, estado_entrega: "no_entregado" }), "Entrega de Ana", vCal(semilla));
		await bA.agregar("calificacion", calif("a1", "p3", Object.assign({}, semilla, { puntaje: 6 })), "Puntaje de Ana", vCal(semilla));
		await bA.agregar("calificacion", calif("a1", "p4", Object.assign({}, semilla, { retroalimentacion: "Mejorar letra" })), "Retro de Ana", vCal(semilla));
		// B, con red, cambia lo mismo después
		bdB.asistencias[0].asistencia_estado = "ausente";
		bdB.registro_diario[0].participacion = 2;
		bdB.calificaciones[0].nivel = "en_proceso";
		bdB.calificaciones[1].estado_entrega = "incompleto";
		bdB.calificaciones[2].puntaje = 9;
		bdB.calificaciones[3].retroalimentacion = "Excelente";
		// Vuelve la red en A
		sA.modo.red = false;
		const desde = sA.peticiones.length;
		await bA.procesar();
		await vacia(bA);
		ok("otro dispositivo cambió: lo de B se conserva (asistencia, cierre, semáforo, entrega, puntaje, retro)",
			[bdB.asistencias[0].asistencia_estado, bdB.registro_diario[0].participacion, bdB.calificaciones[0].nivel,
				bdB.calificaciones[1].estado_entrega, bdB.calificaciones[2].puntaje, bdB.calificaciones[3].retroalimentacion],
			["ausente", 2, "en_proceso", "incompleto", 9, "Excelente"]);
		ok("se avisa cada una y salen de la cola", [bA.eventos.conflictos.length, bA.pendientes()], [6, 0]);
		const asisC = bA.eventos.conflictos.find((c) => c[0] === "Asistencia de Ana");
		ok("el aviso dice el alumno, lo que quedó y lo que no se aplicó",
			asisC && /^Asistencia de Ana: .*quedó: Falta.*tu captura \(Justificada\) no se aplicó/.test(asisC[1].texto), true);
		ok("la pantalla recibe lo que quedó en la base", asisC && asisC[1].actual, { estado: "ausente" });
		ok("un solo intento condicional por captura; el conflicto no se reintenta",
			sA.peticiones.slice(desde).filter((p) => !/:select$/.test(p)).length, 6);
	});

	// 4c. "No existía y ahora existe" es conflicto
	await caso("4c", async () => {
		const bdC = crearBD();
		const sC = cliente(bdC, { red: true });
		const bC = bandeja(sC, B.almacenMemoria());
		bC.iniciar();
		await bC.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", null);
		await bC.agregar("registro", reg("a1", 0, 1), "Cierre de Ana", null);
		await bC.agregar("calificacion", calif("a1", "p1", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Calificación de Ana", null);
		bdC.asistencias.push({ id: "y1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		bdC.registro_diario.push({ id: "y2", maestro_id: "m1", alumno_id: "a1", fecha: F, participacion: 2, conducta: 2 });
		bdC.calificaciones.push({ id: "y3", maestro_id: "m1", alumno_id: "a1", producto_sesion_id: "p1", nivel: "logrado", estado_entrega: "entregado", puntaje: null, retroalimentacion: null });
		sC.modo.red = false;
		const desdeC = sC.peticiones.length;
		await bC.procesar();
		await vacia(bC);
		ok("calificación que esperó en la cola: se mira antes de insertar (sin 409)",
			sC.peticiones.slice(desdeC).filter((x) => x === "calificaciones:insert").length, 0);
		ok("no existía y otro la creó: se conserva la de la base",
			[bdC.asistencias.map((a) => a.asistencia_estado), bdC.registro_diario.map((r) => r.participacion + "/" + r.conducta), bdC.calificaciones.map((c) => c.nivel)],
			[["presente"], ["2/2"], ["logrado"]]);
		ok("no existía y otro la creó: es conflicto (se avisa, sale de la cola)", [bC.eventos.conflictos.map((c) => c[0]).sort(), bC.pendientes()],
			[["Asistencia de Ana", "Calificación de Ana", "Cierre de Ana"], 0]);
	});

	// 4d. Retirar el cierre: si otro dispositivo lo cambió, no se borra
	await caso("4d", async () => {
		const bdD = crearBD();
		bdD.registro_diario.push({ id: "z1", maestro_id: "m1", alumno_id: "a1", fecha: F, participacion: 2, conducta: 1 });
		bdD.registro_diario.push({ id: "z2", maestro_id: "m1", alumno_id: "a2", fecha: F, participacion: 1, conducta: 1 });
		const bD = bandeja(cliente(bdD, {}), B.almacenMemoria());
		bD.iniciar();
		await bD.agregar("registro_borrar", { alumno_id: "a1", fecha: F }, "Cierre de A1", { participacion: 1, conducta: 1 });
		await bD.agregar("registro_borrar", { alumno_id: "a2", fecha: F }, "Cierre de A2", { participacion: 1, conducta: 1 });
		await vacia(bD);
		ok("retiro de cierre con conflicto: el cierre que otro cambió sigue; el que no, se retira",
			bdD.registro_diario.map((r) => r.alumno_id + ":" + r.participacion), ["a1:2"]);
		ok("retiro de cierre con conflicto: se avisa", bD.eventos.conflictos.map((c) => c[0] + " → " + JSON.stringify(c[1].actual)),
			['Cierre de A1 → {"participacion":2,"conducta":1}']);
	});

	// 4e. La calificación "borrada en otro lado" no se vuelve a crear a ciegas
	await caso("4e", async () => {
		const bdE = crearBD();
		const bE = bandeja(cliente(bdE, {}), B.almacenMemoria());
		bE.iniciar();
		await bE.agregar("calificacion", calif("a2", "p1", { nivel: "logrado" }, "c6"), "Calificación de A2", vCal({ nivel: "en_proceso" }));
		await vacia(bE);
		ok("fila que ya no existe: conflicto, no se inserta de nuevo", [bdE.calificaciones.length, bE.eventos.conflictos.length], [0, 1]);
	});

	// 4f. Relojes desfasados (r23): no bloquean una corrección real
	await caso("4f", async () => {
		const bdF = crearBD();
		// B con el reloj 10 min adelantado (Date.now y new Date())
		const DateReal = global.Date;
		const adelanto = 10 * 60 * 1000;
		class DateAdelantada extends DateReal {
			constructor(...a) { if (a.length) super(...a); else super(DateReal.now() + adelanto); }
			static now() { return DateReal.now() + adelanto; }
		}
		global.Date = DateAdelantada;
		const bB = bandeja(cliente(bdF, {}), B.almacenMemoria());
		bB.iniciar();
		await bB.agregar("calificacion", calif("a3", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de Beto", null);
		await vacia(bB);
		global.Date = DateReal;
		// A (reloj correcto) abre Hoy después y corrige sobre lo que ve
		const bA = bandeja(cliente(bdF, {}), B.almacenMemoria());
		bA.iniciar();
		await bA.agregar("calificacion", calif("a3", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", vCal({ nivel: "en_proceso", estado_entrega: "entregado" }));
		await vacia(bA);
		ok("reloj adelantado en otro aparato: la corrección real sí se guarda", [bdF.calificaciones.map((c) => c.nivel), bA.eventos.conflictos.length], [["logrado"], 0]);
	});

	// ── 5. El mismo dispositivo: versiones en camino y respuestas perdidas ───────
	const bd6 = crearBD();
	const lento = cliente(bd6, { demora: 60 });
	const alm6 = B.almacenMemoria();
	const b6 = bandeja(lento, alm6);
	b6.iniciar();
	b6.agregar("asistencia", asis("a1", "presente"), "A1", null);
	await dormir(20); // la primera ya va en camino
	await b6.agregar("asistencia", asis("a1", "justificada"), "A1", null); // la pantalla aún no sabe que llegó
	await vacia(b6);
	ok("en camino: al final la base tiene el último valor", bd6.asistencias.map((a) => a.asistencia_estado), ["justificada"]);
	ok("en camino: la versión propia en la base no es conflicto", b6.eventos.conflictos.length, 0);

	await caso("5b respuesta perdida", async () => {
		const bd7 = crearBD();
		bd7.asistencias.push({ id: "w1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		const s7 = cliente(bd7, { perder: 1 });
		const alm7 = B.almacenMemoria();
		const b7 = bandeja(s7, alm7, { esperaMax: 10000 }); // no reintenta solo durante la prueba
		b7.iniciar();
		await b7.agregar("asistencia", asis("a1", "ausente"), "A1", { estado: "presente" });
		await dormir(30);
		ok("respuesta perdida: la base sí cambió y la captura sigue pendiente", [bd7.asistencias[0].asistencia_estado, b7.pendientes()], ["ausente", 1]);
		// "Recargar": la pantalla lee "ausente"... pero la maestra ya había tocado otra vez sin red
		await b7.agregar("asistencia", asis("a1", "justificada"), "A1", { estado: "presente" });
		await b7.procesar();
		await vacia(b7);
		ok("respuesta perdida y otra captura: lo propio no es conflicto y queda el último valor",
			[bd7.asistencias[0].asistencia_estado, b7.eventos.conflictos.length], ["justificada", 0]);
	});

	// 5d. (R12 a) Doble toque con el token por refrescar y la respuesta perdida: procesar() leyó la
	// cola y espera getSession; la maestra vuelve a tocar el mismo dato en ese hueco. Lo que este
	// dispositivo envió cuenta como propio aunque la captura vieja no llegara a marcarse
	await caso("5d doble toque con sesión lenta y respuesta perdida", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "r1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		const sR = cliente(bdR, { perder: 1 });
		const orig = sR.auth.getSession;
		sR.auth.getSession = async () => { await dormir(30); return orig(); }; // refresco del token con poca señal
		const bR = bandeja(sR, B.almacenMemoria());
		await bR.iniciar();
		bR.agregar("asistencia", asis("a1", "ausente"), "Asistencia de Ana", { estado: "presente" }); // Falta
		await dormir(5);
		bR.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", { estado: "presente" }); // se corrige: Justificada
		await vacia(bR, 2500);
		ok("doble toque, sesión lenta y respuesta perdida: queda el último toque, sin aviso falso",
			[bdR.asistencias.map((a) => a.asistencia_estado), bR.eventos.conflictos.length, bR.pendientes()], [["justificada"], 0, 0]);
	});

	// 5e. (R12 b) Dos ventanas de Hoy en el mismo dispositivo (app instalada + pestaña) comparten la
	// cola: si la otra ventana envía lo que capturó esta, la siguiente corrección de esta no es
	// conflicto aunque su pantalla no se haya enterado (su base sigue "sin fila")
	await caso("5e otra ventana envía", async () => {
		const bdV = crearBD();
		const compartido = B.almacenMemoria(); // la cola del dispositivo (IndexedDB)
		const s1 = cliente(bdV, { red: true }); // la ventana 1 captura sin señal
		const v1 = bandeja(s1, compartido, { esperaMax: 10000 });
		v1.iniciar();
		await v1.agregar("asistencia", asis("a1", "presente"), "Asistencia de Ana", null);
		await v1.agregar("calificacion", calif("a2", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", null);
		await v1.agregar("registro", reg("a3", 1, 1), "Cierre de Caro", null);
		await dormir(20);
		const v2 = bandeja(cliente(bdV, {}), compartido); // la ventana 2 recibe "online" y envía la cola
		await v2.iniciar();
		await vacia(v2);
		ok("la otra ventana envió todo", [bdV.asistencias.length, bdV.calificaciones.length, bdV.registro_diario.length, v2.pendientes()], [1, 1, 1, 0]);
		s1.modo.red = false;
		// La maestra corrige en la ventana 1, que sigue creyendo que no había fila
		await v1.agregar("asistencia", asis("a1", "ausente"), "Asistencia de Ana", null);
		await v1.agregar("calificacion", calif("a2", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de Beto", null);
		await v1.agregar("registro_borrar", { alumno_id: "a3", fecha: F }, "Cierre de Caro", null); // faltó: se retira el cierre
		await v1.procesar();
		await vacia(v1);
		ok("otra ventana envió: la corrección se aplica (asistencia, calificación, retiro del cierre)",
			[bdV.asistencias.map((a) => a.asistencia_estado), bdV.calificaciones.map((c) => c.nivel), bdV.registro_diario.length], [["ausente"], ["en_proceso"], 0]);
		ok("otra ventana envió: sin avisos falsos", [v1.eventos.conflictos.length, v2.eventos.conflictos.length], [0, 0]);
		// Y entre aparatos sigue igual: un valor que puso OTRO aparato, que este nunca envió, es conflicto
		bdV.asistencias[0].asistencia_estado = "presente"; // otro aparato (este ya había enviado "presente", pero lo olvidó al confirmar "ausente")
		bdV.calificaciones[0].nivel = "requiere_apoyo";   // otro aparato; este nunca envió ese valor
		await v2.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", null);
		await v2.agregar("calificacion", calif("a2", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", vCal({ nivel: "logrado", estado_entrega: "entregado" }));
		await vacia(v2);
		ok("otro aparato cambió: sigue siendo conflicto (no se pisa)",
			[bdV.asistencias.map((a) => a.asistencia_estado), bdV.calificaciones.map((c) => c.nivel), v2.eventos.conflictos.map((c) => c[0]).sort()],
			[["presente"], ["requiere_apoyo"], ["Asistencia de Ana", "Calificación de Beto"]]);
	});

	// 5f. Una ventana con la cola leída de antes envía una captura que ya se reemplazó y que la otra
	// ventana ya escribió con el valor nuevo: la vieja no pisa la nueva ni avisa conflicto
	await caso("5f captura superada", async () => {
		const bdS = crearBD();
		bdS.asistencias.push({ id: "s1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		const compartido = B.almacenMemoria();
		const vieja = { clave: "asistencia|g1|a1|" + F, tipo: "asistencia", maestro_id: "m1", seq: 1, orden: 1, capturado_en: new Date().toISOString(),
			datos: asis("a1", "ausente"), descripcion: "Asistencia de Ana", base: { estado: "presente" }, propias: [] };
		// La otra ventana ya envió una más nueva (orden 2, Justificada) y llegó; esta aún trae la vieja
		await compartido.poner(vieja);
		if (compartido.anotar) await compartido.anotar([{ clave: vieja.clave, maestro_id: "m1", valor: { estado: "justificada" }, seq: 2, orden: 2 }]);
		bdS.asistencias[0].asistencia_estado = "justificada";
		const s = cliente(bdS, {});
		const bS = bandeja(s, compartido);
		await bS.iniciar();
		await vacia(bS);
		ok("captura superada por una más nueva de este dispositivo: no se escribe ni es conflicto",
			[bdS.asistencias[0].asistencia_estado, bS.eventos.conflictos.length, s.peticiones.filter((p) => !/:select$/.test(p)).length, bS.pendientes()],
			["justificada", 0, 0, 0]);
	});

	// 5g. (R12 menor 2) Dos toques seguidos sobre un dato que otro aparato ya cambió, ANTES del
	// aviso: un solo aviso (con el último toque) y ninguno se aplica. Un toque DESPUÉS del aviso
	// (la pantalla ya muestra lo de la base) se escribe normalmente
	await caso("5g un aviso por dato", async () => {
		const bdG = crearBD();
		bdG.asistencias.push({ id: "g1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "ausente" }); // otro aparato
		const bG = bandeja(cliente(bdG, { demora: 20 }), B.almacenMemoria());
		await bG.iniciar();
		bG.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", { estado: "presente" });
		await dormir(30); // la primera ya va en camino
		bG.agregar("asistencia", asis("a1", "presente"), "Asistencia de Ana", { estado: "presente" });
		await vacia(bG, 2000);
		ok("dos toques antes del aviso: un solo aviso, con el último toque, y se conserva lo de la base",
			[bdG.asistencias.map((a) => a.asistencia_estado), bG.eventos.conflictos.length,
				bG.eventos.conflictos.map((c) => /tu captura \(Presente\)/.test(c[1].texto) && c[1].sigue === false)[0], bG.pendientes()],
			[["ausente"], 1, true, 0]);
		const actual = bG.eventos.conflictos[0] ? bG.eventos.conflictos[0][1].actual : null; // lo que ahora muestra la pantalla
		await bG.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", actual);
		await vacia(bG, 2000);
		ok("toque después del aviso: se escribe normalmente", [bdG.asistencias.map((a) => a.asistencia_estado), bG.eventos.conflictos.length], [["justificada"], 1]);
	});

	// 5h. Lo "propio" y "lo más nuevo" van por el orden de captura del dispositivo, no por el reloj
	// (r23 d y e): un reloj adelantado que luego se corrige, o uno atrasado, no desordena nada
	await caso("5h orden sin reloj", async () => {
		const bdH = crearBD();
		const compartido = B.almacenMemoria();
		const DateReal = global.Date;
		const conDesfase = (ms) => {
			global.Date = class extends DateReal {
				constructor(...a) { if (a.length) super(...a); else super(DateReal.now() + ms); }
				static now() { return DateReal.now() + ms; }
			};
		};
		try {
			conDesfase(15 * 3600 * 1000); // reloj 15 h adelantado
			const d1 = bandeja(cliente(bdH, {}), compartido);
			await d1.iniciar();
			await d1.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Dani", null);
			await vacia(d1);
			global.Date = DateReal; // se corrige el reloj; otra ventana del mismo aparato, con la vista vieja
			const d2 = bandeja(cliente(bdH, {}), compartido);
			await d2.iniciar();
			await d2.agregar("asistencia", asis("a1", "presente"), "Asistencia de Dani", null);
			await vacia(d2);
			ok("reloj corregido: la corrección posterior se escribe (no queda 'superada' por el reloj)",
				[bdH.asistencias.map((a) => a.asistencia_estado), d2.eventos.conflictos.length, d2.pendientes()], [["presente"], 0, 0]);
			// Reloj 5 h atrasado; otro aparato cambia el dato: es conflicto (ni gana por reloj ni se descarta en silencio)
			conDesfase(-5 * 3600 * 1000);
			const s3 = cliente(bdH, { red: true });
			const d3 = bandeja(s3, compartido, { esperaMax: 10000 });
			d3.iniciar();
			await d3.agregar("asistencia", asis("a1", "ausente"), "Asistencia de Dani", { estado: "presente" });
			bdH.asistencias[0].asistencia_estado = "justificada"; // otro aparato
			s3.modo.red = false;
			await d3.procesar();
			await vacia(d3);
			ok("reloj atrasado y otro aparato cambió: conflicto avisado, se conserva lo de la base",
				[bdH.asistencias.map((a) => a.asistencia_estado), d3.eventos.conflictos.length], [["justificada"], 1]);
		} finally {
			global.Date = DateReal;
		}
	});

	// Una captura vieja de otra versión (sin base): no pisa lo que ya hay
	await caso("5c sin base", async () => {
		const bd8 = crearBD();
		bd8.asistencias.push({ id: "v1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "ausente" });
		const alm8 = B.almacenMemoria();
		await alm8.poner({ clave: "asistencia|g1|a1|" + F, tipo: "asistencia", maestro_id: "m1", seq: 1, capturado_en: new Date().toISOString(), datos: asis("a1", "presente"), descripcion: "A1" });
		const b8 = bandeja(cliente(bd8, {}), alm8);
		await b8.iniciar();
		await vacia(b8);
		ok("captura sin base (de antes de esta regla) sobre una fila existente: conflicto, no pisa",
			[bd8.asistencias[0].asistencia_estado, b8.eventos.conflictos.length], ["ausente", 1]);
	});

	// ── 6. Cuentas y sesión ──────────────────────────────────────────────────────
	const bd9 = crearBD();
	const alm9 = B.almacenMemoria();
	const ajena = B.crear({ sb: cliente(bd9, { red: true }), maestroId: "otra", almacen: alm9, esperaMax: 40 });
	await ajena.agregar("asistencia", { grupo_id: "g2", alumno_id: "z1", fecha: F, estado: "presente" }, "Z1");
	const s9 = cliente(bd9, { jwt: 1 });
	const b9 = bandeja(s9, alm9);
	await b9.agregar("asistencia", asis("a1", "presente"), "A1");
	await b9.iniciar();
	await vacia(b9);
	ok("equipo compartido: lo de otra cuenta no se envía ni se cuenta", [bd9.asistencias.map((a) => a.alumno_id), b9.pendientes(), (await alm9.todos()).length], [["a1"], 0, 1]);
	ok("sesión vencida (401): se refresca y se reintenta", s9.peticiones.filter((p) => /^asistencias:(upsert|insert)/.test(p)).length, 2);
	const s10 = cliente(crearBD(), { jwt: 99 }, null);
	const b10 = bandeja(s10, B.almacenMemoria());
	b10.iniciar();
	await b10.agregar("asistencia", asis("a1", "presente"), "A1");
	await dormir(100);
	ok("sin sesión: espera (estado 'sesion') y no borra nada", [b10.estado(), b10.pendientes(), b10.eventos.rechazos.length], ["sesion", 1, 0]);

	// La cola es de la cuenta que capturó: la sesión cambió de cuenta sin cerrar sesión (r18)
	await caso("6b cuenta dueña", async () => {
		const bd11 = crearBD();
		bd11.asistencias.push({ id: "u1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente" });
		const alm11 = B.almacenMemoria();
		const s11 = cliente(bd11, { red: true });
		const b11 = bandeja(s11, alm11);
		b11.iniciar();
		await b11.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", { estado: "presente" });
		await b11.agregar("calificacion", calif("a1", "p1", { nivel: "logrado" }), "Calificación de Ana", null);
		s11.sesion = { user: { id: "m2" } }; // otra maestra entró en el mismo dispositivo
		s11.modo.red = false;
		const antes11 = s11.peticiones.length;
		await b11.procesar();
		await dormir(50);
		ok("sesión de otra cuenta: no se envía nada", s11.peticiones.slice(antes11).length, 0);
		ok("sesión de otra cuenta: las capturas esperan a su dueña (estado 'cuenta')", [b11.estado(), b11.pendientes(), b11.eventos.rechazos.length, b11.eventos.conflictos.length], ["cuenta", 2, 0, 0]);
		ok("sesión de otra cuenta: la base no cambió", [bd11.asistencias[0].asistencia_estado, bd11.calificaciones.length], ["presente", 0]);
		s11.sesion = { user: { id: "m1" } }; // vuelve la dueña
		await b11.procesar();
		await vacia(b11);
		ok("vuelve la dueña: se envían", [bd11.asistencias[0].asistencia_estado, bd11.calificaciones.length, b11.pendientes()], ["justificada", 1, 0]);
	});

	// Si la cuenta cambia a media escritura, un 403 no borra la captura
	await caso("6c 403 con otra cuenta", async () => {
		const bd12 = crearBD();
		const s12 = cliente(bd12, {});
		const b12 = bandeja(s12, B.almacenMemoria());
		const orig = s12.auth.getSession;
		let n = 0;
		s12.auth.getSession = async () => { n++; if (n >= 2) s12.sesion = { user: { id: "m2" } }; return orig(); };
		b12.iniciar();
		await b12.agregar("asistencia", asis("a1", "presente"), "A1", null);
		await dormir(50);
		ok("cambió la cuenta a media escritura: no se descarta", [b12.pendientes(), b12.eventos.rechazos.length, b12.estado()], [1, 0, "cuenta"]);
	});

	// ── 7. Sin habilitar no se envía (la pantalla primero pinta lo pendiente) ────
	const bd13 = crearBD();
	const b13 = bandeja(cliente(bd13, {}), B.almacenMemoria());
	await b13.agregar("asistencia", asis("a1", "presente"), "A1");
	await dormir(20);
	ok("antes de iniciar(): se guarda pero no se envía", [b13.pendientes(), bd13.asistencias.length], [1, 0]);
	await b13.iniciar();
	await vacia(b13);
	ok("después de iniciar(): se envía", bd13.asistencias.length, 1);

	// ── 8. Cerrar sesión: de quién es la sesión guardada ─────────────────────────
	await caso("8 cuenta guardada", async () => {
		const ls = { _: { "otra-cosa": "1", "sb-raoxdxwgsxbqlzdnndly-auth-token": JSON.stringify({ access_token: "x", user: { id: "m7" } }) } };
		ls.key = (i) => Object.keys(ls._)[i];
		ls.getItem = (k) => ls._[k];
		Object.defineProperty(ls, "length", { get: () => Object.keys(ls._).length });
		ok("la cuenta de la sesión guardada se lee sin red", B.cuentaGuardada(ls), "m7");
	});

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
