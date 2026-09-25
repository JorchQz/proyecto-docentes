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
	- La cola es de la cuenta que capturó: con la sesión de otra cuenta no se envía nada.
	- Sesión vencida se refresca y se reintenta; sin sesión se espera.
	- §9 Marca por captura (docs/PWA-MI-SALON.md §9.8): los escenarios de R12 (r91, r92, r93) y R13
	  (t20, t21, t31), campos por separado, relleno del cierre, otra pantalla, una escritura por
	  toque, capturas del formato anterior, base sin la columna y retiro del cierre. Con 421cd57
	  y con eadbe09 (git show <commit>:js/bandeja-salida.js) fallan; con el código nuevo pasan.

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
	El esquema de la base con el que se prueba cada versión del código:
	  "campo"   (código nuevo): una marca por grupo de campos y el trigger de
	            supabase/mi_salon_b12_captura_id_2026-09.sql (en un update, el grupo que cambió sin
	            marca nueva recibe una marca del servidor; en un insert, cada marca nula también);
	  "fila"    (80a4375): una captura_id por fila; un update sin marca nueva la deja en null;
	  "ninguno" (421cd57, el publicado): sin columnas de marca.
*/
const ESQUEMA = typeof B.columnasMarca === "function" ? "campo" : typeof B.baseDeFila === "function" ? "fila" : "ninguno";
const GRUPOS_BD = {
	asistencias: [["captura_id", ["asistencia_estado"]]],
	registro_diario: [["captura_participacion", ["participacion"]], ["captura_conducta", ["conducta"]]],
	calificaciones: [["captura_semaforo", ["estado_entrega", "nivel"]], ["captura_puntaje", ["puntaje"]], ["captura_retroalimentacion", ["retroalimentacion"]]],
};
let marcasServidor = 0;
const marcaServidor = () => "srv-" + ++marcasServidor;

/*
	cliente(bd, modo, sesion) → { from, auth, peticiones, modo, sesion }
	  modo.red = true            → toda petición falla como sin red (status 0)
	  modo.rechazo = { tabla, status, code, message, si(fila) } → escrituras rechazadas
	  modo.jwt = n               → las siguientes n escrituras responden 401 (JWT expired)
	  modo.e500 = n              → las siguientes n escrituras responden 500
	  modo.demora = ms           → cada petición tarda
	  modo.perder = n            → las siguientes n escrituras SÍ se aplican pero la respuesta se pierde
	  modo.sinMarca = true       → la base aún no tiene las columnas de marca (400 si se usan)
	  modo.sesionLenta = ms      → getSession tarda (refresco del token con señal débil)
	  sesion: la sesión del dispositivo ({ user: { id } } o null); RLS: solo se ve y escribe lo de esa cuenta
	Marcas: según ESQUEMA (arriba). Una columna captura_* que la tabla no tiene responde 400, como
	PostgREST.
*/
function cliente(bd, modo, sesion) {
	modo = modo || {};
	const c = { peticiones: [], escrituras: [], modo, sesion: sesion === undefined ? { user: { id: "m1" } } : sesion };
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
		if (escribe) c.escrituras.push(tabla + ":" + q.op + " " + JSON.stringify(q.fila || q.filas || null) + " " + JSON.stringify(q.filtros));
		// Columnas de marca que la tabla no tiene (según el esquema, o ninguna con modo.sinMarca)
		const existen = modo.sinMarca || ESQUEMA === "ninguno" ? [] : ESQUEMA === "fila" ? ["captura_id"] : GRUPOS_BD[tabla].map((g) => g[0]);
		const falta = (c) => /^captura_/.test(c) && existen.indexOf(c) === -1;
		const enFila = [].concat(q.filas || [], q.fila ? [q.fila] : []).map((f) => Object.keys(f || {}).find(falta)).find(Boolean);
		if (enFila) return { data: null, error: { message: "Could not find the '" + enFila + "' column of '" + tabla + "' in the schema cache", code: "PGRST204" }, status: 400 };
		const enConsulta = q.filtros.map((f) => f[0]).concat((q.cols || "").split(",").map((s) => s.trim())).find(falta);
		if (enConsulta) return { data: null, error: { message: "column " + tabla + "." + enConsulta + " does not exist", code: "42703" }, status: 400 };
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
		// El trigger de marcas en un update: x es la fila, cambios lo que llega
		const actualizar = (x, cambios) => {
			const antes = Object.assign({}, x);
			Object.assign(x, cambios);
			if (ESQUEMA === "fila" && !("captura_id" in cambios)) x.captura_id = null; // 80a4375: sin marca nueva, sin marca
			if (ESQUEMA === "campo") {
				GRUPOS_BD[tabla].forEach(([col, campos]) => {
					const cambio = campos.some((c) => (antes[c] === undefined ? null : antes[c]) !== (x[c] === undefined ? null : x[c]));
					if (cambio && (antes[col] === undefined ? null : antes[col]) === (x[col] === undefined ? null : x[col])) x[col] = marcaServidor();
				});
			}
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
					if (q.op === "upsert") { actualizar(previa, f); puestas.push(previa); continue; }
					return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, status: 409 };
				}
				const nueva = Object.assign({ id: "id" + bd.siguiente++ }, f);
				// El trigger de marcas en un insert: cada marca nula recibe una del servidor
				if (ESQUEMA === "campo") GRUPOS_BD[tabla].forEach(([col]) => { if (nueva[col] === null || nueva[col] === undefined) nueva[col] = marcaServidor(); });
				t.push(nueva);
				puestas.push(nueva);
			}
			const data = q.devolver ? puestas.map((x) => proyectar(x, q.cols)) : null;
			return respuesta(q.uno ? data && data[0] : data, 201);
		}
		const elegidas = visibles.filter((x) => coincide(x, q.filtros) && cumpleOr(x, q.or));
		if (q.op === "update") {
			elegidas.forEach((x) => actualizar(x, q.fila));
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
	c.auth = {
		getSession: async () => {
			if (modo.sesionLenta) { const ms = modo.sesionLenta; modo.sesionLenta = 0; await dormir(ms); }
			return { data: { session: c.sesion }, error: null };
		},
	};
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

	// ── 9. Marca por captura (R12 y R13) ─────────────────────────────────────────
	// La base que vio la pantalla: con la marca en el código nuevo; por contenido en las versiones
	// anteriores (3d48d1a, eadbe09), para que cada una se pruebe con lo que entiende
	const NUEVO = ESQUEMA !== "ninguno"; // con marcas (80a4375 o el nuevo)
	const COLS = { asistencia: ["captura_id"], registro: ["captura_participacion", "captura_conducta"], calificacion: ["captura_semaforo", "captura_puntaje", "captura_retroalimentacion"] };
	const COL_DE = { estado: "captura_id", participacion: "captura_participacion", conducta: "captura_conducta", nivel: "captura_semaforo", estado_entrega: "captura_semaforo", puntaje: "captura_puntaje", retroalimentacion: "captura_retroalimentacion" };
	const tipoDe = (v) => ("estado" in v ? "asistencia" : "participacion" in v || "conducta" in v ? "registro" : "calificacion");
	// Una fila sembrada con la misma marca en todos sus grupos (y captura_id, para 80a4375)
	const M = (tipo, id) => { const o = { captura_id: id }; if (ESQUEMA === "campo") COLS[tipo].forEach((c) => { o[c] = id; }); return o; };
	// Otro aparato escribió el campo: su marca (en el esquema de 80a4375, la de la fila)
	const otro = (campo, id) => (ESQUEMA === "campo" ? { [COL_DE[campo]]: id } : { captura_id: id });
	// La versión que vio la pantalla de una fila con la misma marca en todos sus grupos
	const vista = (valor, marcaVista, tipo) => {
		if (valor === null) return null;
		const m = marcaVista === undefined ? null : marcaVista;
		if (ESQUEMA === "campo") { const marcas = {}; COLS[tipo || tipoDe(valor)].forEach((c) => { marcas[c] = m; }); return { marcas, valor }; }
		return ESQUEMA === "fila" ? { captura_id: m, valor } : valor;
	};
	// La versión que vio la pantalla al leer una fila de la base (como js/hoy.js)
	const valorLocal = (tipo, f) => (tipo === "asistencia" ? { estado: f.asistencia_estado } : tipo === "registro" ? { participacion: f.participacion, conducta: f.conducta } : vCalDe(f));
	const vistaFila = (tipo, f) => (!f ? null : ESQUEMA === "campo" ? B.baseDeFila(tipo, f) : ESQUEMA === "fila" ? { captura_id: f.captura_id || null, valor: valorLocal(tipo, f) } : valorLocal(tipo, f));
	const marcaDe = (fila) => (fila ? fila.captura_id || null : null);
	const asisDe = (bdX, al) => bdX.asistencias.find((a) => a.alumno_id === al);
	const regDe = (bdX, al) => bdX.registro_diario.find((r) => r.alumno_id === al);
	const calDe = (bdX, al, p) => bdX.calificaciones.find((x) => x.alumno_id === al && x.producto_sesion_id === p);
	const vReg = (r) => (r ? { participacion: r.participacion, conducta: r.conducta } : null);
	const vCalDe = (x) => (x ? vCal({ estado_entrega: x.estado_entrega, nivel: x.nivel, puntaje: x.puntaje === undefined ? null : x.puntaje, retroalimentacion: x.retroalimentacion || null }) : null);
	const C = (lista) => ({ campos: lista });
	const RELLENO = { relleno: true };
	const esperarTodas = (bs, ms) => Promise.all(bs.map((b) => vacia(b, ms || 1500)));

	// R12-r91: doble toque con el token vencido (refresco lento) y la respuesta del primero perdida
	await caso("r91 doble toque con token lento", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const s = cliente(bdR, { perder: 1, sesionLenta: 60 });
		const b = bandeja(s, B.almacenMemoria(), { esperaMax: 20 });
		b.iniciar();
		b.agregar("asistencia", asis("a1", "ausente"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await dormir(20); // la maestra corrige mientras se refresca la sesión
		await b.agregar("asistencia", asis("a1", "justificada"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await vacia(b, 2000);
		ok("r91: queda el último toque (Justificada) y sin aviso falso", [asisDe(bdR, "a1").asistencia_estado, b.eventos.conflictos.length, b.pendientes()], ["justificada", 0, 0]);
	});

	// Respuesta perdida y otro toque después (la pantalla no se enteró): lo propio no es conflicto
	await caso("respuesta perdida con marca", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "a1", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const s = cliente(bdR, { perder: 1 });
		const b = bandeja(s, B.almacenMemoria(), { esperaMax: 10000 });
		b.iniciar();
		await b.agregar("asistencia", asis("a1", "ausente"), "A1", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await dormir(30);
		await b.agregar("asistencia", asis("a1", "justificada"), "A1", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await b.procesar();
		await vacia(b);
		ok("respuesta perdida + otro toque: último valor, sin aviso", [asisDe(bdR, "a1").asistencia_estado, b.eventos.conflictos.length], ["justificada", 0]);
	});

	// R12-r93: dos ventanas del mismo aparato (la app y una pestaña) comparten la cola; la 2 envía lo
	// de la 1, que no se entera, y la maestra corrige en la 1
	await caso("r93 otra ventana envía", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, { red: true });
		const v1 = bandeja(s1, alm, { esperaMax: 20 });
		const v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar();
		await v1.agregar("asistencia", asis("a1", "presente"), "Asistencia de Ana", null, C(["estado"]));
		await v1.agregar("calificacion", calif("a2", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", null, C(["nivel", "estado_entrega"]));
		await dormir(20);
		await v2.iniciar();
		await vacia(v2);
		// La ventana 1 sigue creyendo que no hay filas
		await v1.agregar("asistencia", asis("a1", "ausente"), "Asistencia de Ana", null, C(["estado"]));
		await v1.agregar("calificacion", calif("a2", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de Beto", null, C(["nivel", "estado_entrega"]));
		s1.modo.red = false;
		await v1.procesar();
		await esperarTodas([v1, v2]);
		ok("r93: la corrección de la ventana 1 se guarda sin aviso falso",
			[asisDe(bdR, "a1").asistencia_estado, calDe(bdR, "a2", "p1").nivel, v1.eventos.conflictos.length + v2.eventos.conflictos.length, bdR.calificaciones.length],
			["ausente", "en_proceso", 0, 1]);
	});

	// R12-r92: doble toque rápido en la ventana 1 mientras la ventana 2 también envía
	await caso("r92 dos ventanas procesan", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const v1 = bandeja(cliente(bdR, { demora: 8 }), alm);
		const v2 = bandeja(cliente(bdR, { demora: 5 }), alm);
		v1.iniciar(); v2.iniciar();
		const finales = [];
		for (let i = 0; i < 5; i++) {
			const x = i % 2 ? "presente" : "justificada", y = i % 2 ? "justificada" : "presente";
			const base = asisDe(bdR, "a3") ? null : null; // la ventana no se entera de lo que envió la otra
			v1.agregar("asistencia", asis("a3", x), "Asistencia de Dani", base, C(["estado"]));
			setTimeout(() => v1.agregar("asistencia", asis("a3", y), "Asistencia de Dani", base, C(["estado"])), 3);
			setTimeout(() => v2.procesar(), 4);
			await dormir(20);
			await esperarTodas([v1, v2]);
			finales.push(asisDe(bdR, "a3") && asisDe(bdR, "a3").asistencia_estado === y);
		}
		ok("r92: cada ronda queda el último toque, sin avisos falsos",
			[finales.every(Boolean), v1.eventos.conflictos.length + v2.eventos.conflictos.length, bdR.asistencias.length], [true, 0, 1]);
	});

	// R12-r92 (el aviso falso que se vio en navegador): el cierre de Dani lo capturó la ventana 1 sin
	// señal y lo envió la 2; después se marca Justificada en la 1 y se retira el cierre
	await caso("r92 retiro del cierre", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, { red: true });
		const v1 = bandeja(s1, alm, { esperaMax: 20 });
		const v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar();
		await v1.agregar("registro", reg("dani", 1, 1), "Cierre de Dani", null, RELLENO);
		await dormir(15);
		await v2.iniciar();
		await vacia(v2);
		s1.modo.red = false;
		// La ventana 1 no se enteró: para ella Dani no tenía fila
		await v1.agregar("asistencia", asis("dani", "justificada"), "Asistencia de Dani", null, C(["estado"]));
		await v1.agregar("registro_borrar", { alumno_id: "dani", fecha: F }, "Cierre de Dani", null);
		await v1.procesar();
		await esperarTodas([v1, v2]);
		ok("r92: se retira el cierre por defecto de quien faltó, sin aviso falso",
			[bdR.registro_diario.length, v1.eventos.conflictos.length + v2.eventos.conflictos.length], [0, 0]);
	});

	// R13-t20: ventana vieja del mismo aparato toca OTRO campo del mismo dato; su relleno del
	// cierre no pisa lo que capturó la otra ventana
	await caso("t20 ventana vieja", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const v1 = bandeja(cliente(bdR, {}), alm);
		const v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar(); v2.iniciar();
		await v1.agregar("calificacion", calif("ana", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Ana", null, C(["nivel", "estado_entrega"]));
		await v1.agregar("registro", reg("caro", 2, 1), "Cierre de Caro", null, C(["participacion"]));
		for (const al of ["ana", "beto", "dani"]) await v1.agregar("registro", reg(al, 1, 1), "Cierre de " + al, null, RELLENO);
		await vacia(v1);
		// La ventana 2 (abierta antes, no sabe nada) pone puntaje 7 a Ana y conducta 0 a Dani
		await v2.agregar("calificacion", calif("ana", "p1", { puntaje: 7 }), "Calificación de Ana", null, C(["puntaje"]));
		await v2.agregar("registro", reg("dani", 1, 0), "Cierre de Dani", null, C(["conducta"]));
		for (const al of ["ana", "beto", "caro"]) await v2.agregar("registro", reg(al, 1, 1), "Cierre de " + al, null, RELLENO);
		await esperarTodas([v1, v2]);
		const cal = calDe(bdR, "ana", "p1");
		ok("t20: se conserva el semáforo de Ana (ventana 1) y se aplica su puntaje (ventana 2)", [cal.nivel, cal.estado_entrega, cal.puntaje], ["logrado", "entregado", 7]);
		ok("t20: se conserva la participación 2 de Caro y se aplica la conducta 0 de Dani",
			[vReg(regDe(bdR, "caro")), vReg(regDe(bdR, "dani")), vReg(regDe(bdR, "beto"))],
			[{ participacion: 2, conducta: 1 }, { participacion: 1, conducta: 0 }, { participacion: 1, conducta: 1 }]);
		ok("t20: sin avisos falsos", v1.eventos.conflictos.length + v2.eventos.conflictos.length, 0);
	});

	// R13-t21: dos ventanas, subida lenta en la 1: Presente → Falta (se envía por la 2) → Presente otra vez
	await caso("t21 ABA dos ventanas", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, { red: true });
		const v1 = bandeja(s1, alm, { esperaMax: 20 });
		const v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar();
		await v1.agregar("asistencia", asis("ana", "ausente"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await dormir(15);
		s1.modo.red = false;
		s1.modo.demora = 150; // la petición de la ventana 1 llega tarde a la base
		v1.procesar();
		await dormir(10);
		await v2.iniciar(); // la ventana 2 envía la cola compartida
		await dormir(30);
		// La maestra corrige en la ventana 1 (que aún cree que hay "presente" con la marca vieja)
		await v1.agregar("asistencia", asis("ana", "presente"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await v2.procesar();
		await dormir(400);
		await esperarTodas([v1, v2], 2000);
		ok("t21: queda el último toque (Presente): la petición vieja que llegó tarde no lo pisa",
			[asisDe(bdR, "ana").asistencia_estado, v1.eventos.conflictos.length + v2.eventos.conflictos.length], ["presente", 0]);
	});

	// R13-t31: otro aparato pone el MISMO valor que este escribió en la mañana: no es "propio"
	await caso("t31 anotada vieja", async () => {
		const bdR = crearBD();
		const sA = cliente(bdR, {}), sB = cliente(bdR, {});
		const A = bandeja(sA, B.almacenMemoria()), Bb = bandeja(sB, B.almacenMemoria(), { esperaMax: 20 });
		A.iniciar(); Bb.iniciar();
		await Bb.agregar("asistencia", asis("beto", "justificada"), "Asistencia de Beto", null, C(["estado"]));
		await Bb.agregar("calificacion", calif("beto", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de Beto", null, C(["nivel", "estado_entrega"]));
		await vacia(Bb);
		let fa = asisDe(bdR, "beto"), fc = calDe(bdR, "beto", "p1");
		await A.agregar("asistencia", asis("beto", "presente"), "Asistencia de Beto", vistaFila("asistencia", fa), C(["estado"]));
		await A.agregar("calificacion", calif("beto", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", vistaFila("calificacion", fc), C(["nivel", "estado_entrega"]));
		await vacia(A);
		// B recarga (ve lo de A), se queda sin señal y toca Falta y Requiere apoyo
		fa = asisDe(bdR, "beto"); fc = calDe(bdR, "beto", "p1");
		const baseBa = vistaFila("asistencia", fa), baseBc = vistaFila("calificacion", fc);
		sB.modo.red = true;
		await Bb.agregar("asistencia", asis("beto", "ausente"), "Asistencia de Beto", baseBa, C(["estado"]));
		await Bb.agregar("calificacion", calif("beto", "p1", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Calificación de Beto", baseBc, C(["nivel", "estado_entrega"]));
		await dormir(20);
		// A (en línea, después) pone lo mismo que B escribió en la mañana
		await A.agregar("asistencia", asis("beto", "justificada"), "Asistencia de Beto", baseBa, C(["estado"]));
		await A.agregar("calificacion", calif("beto", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de Beto", baseBc, C(["nivel", "estado_entrega"]));
		await vacia(A);
		sB.modo.red = false;
		await Bb.procesar();
		await vacia(Bb);
		ok("t31: se conserva lo nuevo del otro aparato y B avisa las dos",
			[asisDe(bdR, "beto").asistencia_estado, calDe(bdR, "beto", "p1").nivel, Bb.eventos.conflictos.length], ["justificada", "en_proceso", 2]);
	});

	// Otro aparato cambió OTRO campo: se aplica el tocado sin pisar el otro, sin aviso; el MISMO campo, aviso
	await caso("campos por separado", async () => {
		const bdR = crearBD();
		bdR.calificaciones.push({ id: "k1", maestro_id: "m1", alumno_id: "ana", producto_sesion_id: "p1", nivel: "logrado", estado_entrega: "entregado", puntaje: null, retroalimentacion: null, ...M("calificacion", "m0") });
		bdR.calificaciones.push({ id: "k2", maestro_id: "m1", alumno_id: "ana", producto_sesion_id: "p2", nivel: "logrado", estado_entrega: "entregado", puntaje: null, retroalimentacion: null, ...M("calificacion", "n0") });
		bdR.registro_diario.push({ id: "k3", maestro_id: "m1", alumno_id: "ana", fecha: F, participacion: 1, conducta: 1, ...M("registro", "r0") });
		const s = cliente(bdR, { red: true });
		const b = bandeja(s, B.almacenMemoria(), { esperaMax: 20 });
		b.iniciar();
		const semilla = vCal({ nivel: "logrado", estado_entrega: "entregado" });
		await b.agregar("calificacion", calif("ana", "p1", Object.assign({}, semilla, { puntaje: 8 })), "Calificación de Ana en P1", vista(semilla, "m0"), C(["puntaje"]));
		await b.agregar("calificacion", calif("ana", "p2", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Calificación de Ana en P2", vista(semilla, "n0"), C(["nivel", "estado_entrega"]));
		await b.agregar("registro", reg("ana", 2, 1), "Cierre de Ana", vista({ participacion: 1, conducta: 1 }, "r0"), C(["participacion"]));
		// Otro aparato: en P1 cambia el semáforo; en P2 también el semáforo; en el cierre, la conducta
		Object.assign(calDe(bdR, "ana", "p1"), { nivel: "en_proceso" }, otro("nivel", "m1x"));
		Object.assign(calDe(bdR, "ana", "p2"), { nivel: "en_proceso" }, otro("nivel", "n1x"));
		Object.assign(regDe(bdR, "ana"), { conducta: 0 }, otro("conducta", "r1x"));
		s.modo.red = false;
		await b.procesar();
		await vacia(b);
		const p1 = calDe(bdR, "ana", "p1"), p2 = calDe(bdR, "ana", "p2");
		ok("otro campo: se aplica el puntaje y se conserva el semáforo del otro aparato", [p1.nivel, p1.puntaje], ["en_proceso", 8]);
		ok("otro campo: se aplica la participación y se conserva la conducta del otro aparato", vReg(regDe(bdR, "ana")), { participacion: 2, conducta: 0 });
		ok("mismo campo: se conserva lo del otro aparato", p2.nivel, "en_proceso");
		const avisos = b.eventos.conflictos.map((c) => c[0]);
		ok("solo avisa el mismo campo", avisos, ["Calificación de Ana en P2"]);
		const texto = (b.eventos.conflictos[0] || [null, {}])[1].texto || "";
		ok("el aviso habla del semáforo (quedó En proceso; tu Requiere apoyo)", /quedó: En proceso\)/.test(texto) && /tu captura \(Requiere apoyo\)/.test(texto), true);
	});

	// El relleno del Cierre del día solo inserta donde no hay fila (sin marca) y nunca avisa
	await caso("relleno solo inserta", async () => {
		const bdR = crearBD();
		bdR.registro_diario.push({ id: "k1", maestro_id: "m1", alumno_id: "caro", fecha: F, participacion: 2, conducta: 1, ...M("registro", "otro") });
		const s = cliente(bdR, {});
		const b = bandeja(s, B.almacenMemoria());
		b.iniciar();
		for (const al of ["ana", "caro"]) await b.agregar("registro", reg(al, 1, 1), "Cierre de " + al, null, RELLENO);
		await vacia(b);
		ok("relleno: no pisa la fila que ya había ni avisa; inserta la que faltaba",
			[vReg(regDe(bdR, "caro")), vReg(regDe(bdR, "ana")), b.eventos.conflictos.length, s.escrituras.filter((e) => /update/.test(e)).length],
			[{ participacion: 2, conducta: 1 }, { participacion: 1, conducta: 1 }, 0, 0]);
		const gAna = b.eventos.guardadas.find(([c]) => /|ana|/.test(c));
		ok("relleno: pide la fila de vuelta; la pantalla conoce su versión (sus marcas)",
			ESQUEMA === "campo" ? [!!regDe(bdR, "ana").captura_conducta, gAna && gAna[1].base && gAna[1].base.marcas.captura_conducta === regDe(bdR, "ana").captura_conducta] : [true, true], [true, true]);
	});

	// Otra pantalla (Asistencia) cambió la fila: el trigger le quitó la marca → se compara por contenido
	await caso("otra pantalla", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const s = cliente(bdR, { red: true });
		const b = bandeja(s, B.almacenMemoria(), { esperaMax: 20 });
		b.iniciar();
		await b.agregar("asistencia", asis("ana", "justificada"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		Object.assign(asisDe(bdR, "ana"), { asistencia_estado: "ausente", captura_id: ESQUEMA === "campo" ? marcaServidor() : null });
		s.modo.red = false;
		await b.procesar();
		await vacia(b);
		ok("otra pantalla cambió el dato: se conserva y se avisa", [asisDe(bdR, "ana").asistencia_estado, b.eventos.conflictos.length], ["ausente", 1]);
	});

	// En línea: un toque = una sola escritura, sin lecturas, y deja su marca
	await caso("una escritura por toque", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const s = cliente(bdR, {});
		const b = bandeja(s, B.almacenMemoria());
		b.iniciar();
		await b.agregar("asistencia", asis("ana", "ausente"), "A", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await vacia(b);
		const marca1 = marcaDe(asisDe(bdR, "ana"));
		const base1 = NUEVO ? b.eventos.guardadas[0][1].base : { estado: "ausente" };
		await b.agregar("asistencia", asis("ana", "justificada"), "A", base1, C(["estado"]));
		await vacia(b);
		ok("en línea: una petición por toque (sin lecturas)", s.peticiones, ["asistencias:update", "asistencias:update"]);
		ok("en línea: cada toque deja una marca nueva", NUEVO ? [!!marca1, marca1 !== "m0", marcaDe(asisDe(bdR, "ana")) !== marca1] : [true, true, true], [true, true, true]);
	});

	// Una captura guardada por la versión publicada (formato 3d48d1a) se envía bien tras actualizar
	await caso("capturas del formato anterior", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente", captura_id: null });
		bdR.registro_diario.push({ id: "q2", maestro_id: "m1", alumno_id: "beto", fecha: F, participacion: 1, conducta: 1, ...M("registro", "zz") });
		const alm = B.almacenMemoria();
		const ahora = Date.now() * 1000;
		await alm.poner({ clave: "asistencia|g1|ana|" + F, tipo: "asistencia", maestro_id: "m1", seq: ahora - 3, capturado_en: new Date().toISOString(),
			datos: asis("ana", "ausente"), descripcion: "Asistencia de Ana", base: { estado: "presente" }, propias: [], intentado: false });
		await alm.poner({ clave: "registro|m1|beto|" + F, tipo: "registro", maestro_id: "m1", seq: ahora - 2, capturado_en: new Date().toISOString(),
			datos: reg("beto", 2, 1), descripcion: "Cierre de Beto", base: { participacion: 1, conducta: 1 }, propias: [], intentado: true });
		await alm.poner({ clave: "calificacion|m1|caro|p1", tipo: "calificacion", maestro_id: "m1", seq: ahora - 1, capturado_en: new Date().toISOString(),
			datos: calif("caro", "p1", { nivel: "logrado", estado_entrega: "entregado" }), descripcion: "Calificación de Caro", base: null, propias: [], intentado: false });
		const b = bandeja(cliente(bdR, {}), alm);
		await b.iniciar();
		await vacia(b);
		ok("formato anterior: las tres llegan, sin avisos",
			[asisDe(bdR, "ana").asistencia_estado, vReg(regDe(bdR, "beto")), calDe(bdR, "caro", "p1") && calDe(bdR, "caro", "p1").nivel, b.eventos.conflictos.length, b.pendientes()],
			["ausente", { participacion: 2, conducta: 1 }, "logrado", 0, 0]);
	});

	// El frontend nuevo antes que la migración: sin la columna, se usa la regla por contenido
	await caso("sin la columna captura_id", async () => {
		if (NUEVO) B.marcaDisponible(null);
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente" });
		bdR.asistencias.push({ id: "q2", maestro_id: "m1", grupo_id: "g1", alumno_id: "beto", fecha: F, asistencia_estado: "presente" });
		const s = cliente(bdR, { red: true, sinMarca: true });
		const b = bandeja(s, B.almacenMemoria(), { esperaMax: 20 });
		b.iniciar();
		await b.agregar("asistencia", asis("ana", "justificada"), "Asistencia de Ana", vista({ estado: "presente" }, null), C(["estado"]));
		await b.agregar("asistencia", asis("beto", "justificada"), "Asistencia de Beto", vista({ estado: "presente" }, null), C(["estado"]));
		await b.agregar("calificacion", calif("caro", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Caro", null, C(["nivel", "estado_entrega"]));
		asisDe(bdR, "beto").asistencia_estado = "ausente"; // otro aparato
		s.modo.red = false;
		await b.procesar();
		await vacia(b);
		ok("sin la columna: se guarda por contenido y se avisa el conflicto, sin rechazos",
			[asisDe(bdR, "ana").asistencia_estado, asisDe(bdR, "beto").asistencia_estado, calDe(bdR, "caro", "p1") && calDe(bdR, "caro", "p1").nivel,
				b.eventos.conflictos.map((c) => c[0]), b.eventos.rechazos.length],
			["justificada", "ausente", "logrado", ["Asistencia de Beto"], 0]);
		if (NUEVO) ok("sin la columna: la bandeja lo recuerda", B.marcaDisponible(), false);
		if (NUEVO) B.marcaDisponible(true);
	});

	// Retirar el cierre (falta después del cierre): borra el relleno propio; no el que otro cambió
	await caso("retiro con marca", async () => {
		const bdR = crearBD();
		const s = cliente(bdR, {});
		const b = bandeja(s, B.almacenMemoria());
		b.iniciar();
		for (const al of ["ana", "beto"]) await b.agregar("registro", reg(al, 1, 1), "Cierre de " + al, null, RELLENO);
		await vacia(b);
		const baseAna = vistaFila("registro", regDe(bdR, "ana"));
		const baseBeto = vistaFila("registro", regDe(bdR, "beto"));
		Object.assign(regDe(bdR, "beto"), { participacion: 2 }, otro("participacion", "otro"));
		await b.agregar("registro_borrar", { alumno_id: "ana", fecha: F }, "Cierre de Ana", baseAna);
		await b.agregar("registro_borrar", { alumno_id: "beto", fecha: F }, "Cierre de Beto", baseBeto);
		await vacia(b);
		ok("retiro: se quita el de Ana; el de Beto (cambiado en otro aparato) se queda y se avisa",
			[bdR.registro_diario.map((r) => r.alumno_id), b.eventos.conflictos.map((c) => c[0])], [["beto"], ["Cierre de Beto"]]);
	});

	// ── 10. Marca por campo (R14) ────────────────────────────────────────────────
	// Las llaves de la bandeja y la última versión que una bandeja confirmó de una llave (lo que su
	// pantalla ve después de guardar)
	const KA = (al) => "asistencia|g1|" + al + "|" + F;
	const KR = (al) => "registro|m1|" + al + "|" + F;
	const KC = (al, p) => "calificacion|m1|" + al + "|" + p;
	const ultimaBase = (b, k) => { const g = b.eventos.guardadas.filter(([c]) => c === k).pop(); return g ? g[1].base : null; };
	const estadoBeto = (bdX) => [asisDe(bdX, "beto").asistencia_estado, calDe(bdX, "beto", "p1").nivel, vReg(regDe(bdX, "beto"))];

	/*
		R14-FAIL 1: el OTRO aparato (A) cambia un dato y lo regresa al valor que vio B (A → B → A)
		mientras B, sin señal, ya había capturado otro valor sobre esa versión.
		  "hoy":      A usa Hoy: Justificada / En proceso / 2 y luego Presente / Logrado / 1
		  "retoque":  A solo vuelve a tocar Presente y participación 1 (lo que ya había)
		  "pantalla": A usa la pantalla Asistencia (upsert sin marca): Justificada y luego Presente
	*/
	async function abaOtroAparato(variante) {
		const bdR = crearBD();
		const sA = cliente(bdR, {}), sB = cliente(bdR, {});
		const A = bandeja(sA, B.almacenMemoria()), Bb = bandeja(sB, B.almacenMemoria(), { esperaMax: 20 });
		A.iniciar(); Bb.iniciar();
		// 0) A deja a Beto en Presente / Logrado / cierre 1 y 1
		await A.agregar("asistencia", asis("beto", "presente"), "Asistencia de Beto", null, C(["estado"]));
		await A.agregar("calificacion", calif("beto", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Beto", null, C(["nivel", "estado_entrega"]));
		await A.agregar("registro", reg("beto", 1, 1), "Cierre del día de Beto", null, RELLENO);
		await vacia(A);
		// 1) B abre Hoy (lee la base) y, sin señal, captura Falta, Requiere apoyo y participación 0
		const bA = vistaFila("asistencia", asisDe(bdR, "beto")), bC = vistaFila("calificacion", calDe(bdR, "beto", "p1")), bR = vistaFila("registro", regDe(bdR, "beto"));
		sB.modo.red = true;
		await Bb.agregar("asistencia", asis("beto", "ausente"), "Asistencia de Beto", bA, C(["estado"]));
		await Bb.agregar("calificacion", calif("beto", "p1", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Calificación de Beto", bC, C(["nivel", "estado_entrega"]));
		await Bb.agregar("registro", reg("beto", 0, 1), "Cierre del día de Beto", bR, C(["participacion"]));
		await dormir(20);
		// 2) A, en línea y DESPUÉS, sobre lo que su pantalla ve
		const toque = async (tipo, datos, clave, campos) => { await A.agregar(tipo, datos, "A", ultimaBase(A, clave), C(campos)); await vacia(A); };
		if (variante === "hoy") {
			await toque("asistencia", asis("beto", "justificada"), KA("beto"), ["estado"]);
			await toque("calificacion", calif("beto", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), KC("beto", "p1"), ["nivel", "estado_entrega"]);
			await toque("registro", reg("beto", 2, 1), KR("beto"), ["participacion"]);
			await toque("asistencia", asis("beto", "presente"), KA("beto"), ["estado"]);
			await toque("calificacion", calif("beto", "p1", { nivel: "logrado", estado_entrega: "entregado" }), KC("beto", "p1"), ["nivel", "estado_entrega"]);
			await toque("registro", reg("beto", 1, 1), KR("beto"), ["participacion"]);
		} else if (variante === "retoque") {
			await toque("asistencia", asis("beto", "presente"), KA("beto"), ["estado"]);
			await toque("registro", reg("beto", 1, 1), KR("beto"), ["participacion"]);
		} else {
			// La pantalla Asistencia (js/asistencia.js): upsert sin marca, dos veces
			for (const e of ["justificada", "presente"]) {
				await sA.from("asistencias").upsert({ maestro_id: "m1", grupo_id: "g1", alumno_id: "beto", fecha: F, asistencia_estado: e }, { onConflict: "grupo_id,alumno_id,fecha" });
			}
		}
		const deA = estadoBeto(bdR);
		// 3) Vuelve la señal a B
		sB.modo.red = false;
		await Bb.procesar();
		await vacia(Bb);
		return { deA, fin: estadoBeto(bdR), avisos: Bb.eventos.conflictos.map((c) => c[0].split(" de ")[0]).sort(), cola: Bb.pendientes() };
	}
	await caso("R14-FAIL 1 (A usa Hoy)", async () => {
		const r = await abaOtroAparato("hoy");
		ok("FAIL 1 hoy: se conserva lo último de A (Presente, Logrado, 1 y 1)", r.fin, r.deA);
		ok("FAIL 1 hoy: B avisa los tres datos y su cola queda vacía", [r.avisos, r.cola], [["Asistencia", "Calificación", "Cierre del día"], 0]);
	});
	await caso("R14-FAIL 1 (A solo vuelve a tocar)", async () => {
		const r = await abaOtroAparato("retoque");
		ok("FAIL 1 retoque: se conserva lo que A volvió a tocar; la calificación (que A no tocó) sí se aplica",
			r.fin, ["presente", "requiere_apoyo", { participacion: 1, conducta: 1 }]);
		ok("FAIL 1 retoque: B avisa asistencia y cierre", r.avisos, ["Asistencia", "Cierre del día"]);
	});
	await caso("R14-FAIL 1 (A usa la pantalla Asistencia)", async () => {
		const r = await abaOtroAparato("pantalla");
		ok("FAIL 1 pantalla: se conserva lo de la pantalla Asistencia (Presente); lo demás de B se aplica",
			r.fin, ["presente", "requiere_apoyo", { participacion: 0, conducta: 1 }]);
		ok("FAIL 1 pantalla: B avisa la asistencia", r.avisos, ["Asistencia"]);
	});

	/*
		R14-FAIL 2: MISMO aparato, dos ventanas que comparten la cola y las marcas propias.
		  1) v1 guarda el cierre (relleno) y pone conducta 2 a Dani;
		  2) v1 pone participación 2: el PATCH llega a la base, pero la respuesta se pierde;
		  3) v2 (que se abrió antes y no vio nada, o cuya lectura llegó tarde) pone conducta 0.
		  "perdida": v1 reintenta antes del toque de v2 (encuentra su propia marca);
		  "cerrada": v1 se cerró: su captura sigue en la cola compartida y v2 la hereda;
		  "tardia":  la pantalla de v2 tiene la versión del relleno (su lectura salió antes de lo de v1).
		Esperado: Dani 2/0 (gana el último toque), sin avisos, cola vacía.
	*/
	async function perdidaVentanaVieja(variante) {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, {}), s2 = cliente(bdR, {});
		const v1 = bandeja(s1, alm, { esperaMax: 10000 }), v2 = bandeja(s2, alm, { esperaMax: 10000 });
		v1.iniciar(); v2.iniciar();
		for (const al of ["ana", "dani"]) await v1.agregar("registro", reg(al, 1, 1), "Cierre del día de " + al, null, RELLENO);
		await vacia(v1);
		const baseVieja = ultimaBase(v1, KR("dani"));
		await v1.agregar("registro", reg("dani", 1, 2), "Cierre del día de Dani", baseVieja, C(["conducta"]));
		await vacia(v1);
		s1.modo.perder = 1;
		await v1.agregar("registro", reg("dani", 2, 2), "Cierre del día de Dani", ultimaBase(v1, KR("dani")), C(["participacion"]));
		await dormir(30);
		const trasV1 = [vReg(regDe(bdR, "dani")), (await alm.todos()).length];
		if (variante !== "cerrada") { await v1.procesar(); await vacia(v1); }
		await v2.agregar("registro", reg("dani", 1, 0), "Cierre del día de Dani", variante === "tardia" ? baseVieja : null, C(["conducta"]));
		await v2.procesar();
		await vacia(v2);
		return { trasV1, fin: vReg(regDe(bdR, "dani")), avisos: v1.eventos.conflictos.length + v2.eventos.conflictos.length, cola: (await alm.todos()).length };
	}
	for (const variante of ["perdida", "cerrada", "tardia"]) {
		await caso("R14-FAIL 2 (" + variante + ")", async () => {
			const r = await perdidaVentanaVieja(variante);
			ok("FAIL 2 " + variante + ": el PATCH llegó y la respuesta se perdió (2/2, sigue en la cola)", r.trasV1, [{ participacion: 2, conducta: 2 }, 1]);
			ok("FAIL 2 " + variante + ": gana el último toque (2/0), sin aviso falso, cola vacía", [r.fin, r.avisos, r.cola], [{ participacion: 2, conducta: 0 }, 0, 0]);
		});
	}

	// Dos aparatos ponen lo mismo: listo sin aviso (aunque la marca sea de otro)
	await caso("dos aparatos, el mismo valor", async () => {
		const bdR = crearBD();
		bdR.asistencias.push({ id: "q1", maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente", captura_id: "m0" });
		const sB = cliente(bdR, { red: true });
		const A = bandeja(cliente(bdR, {}), B.almacenMemoria()), Bb = bandeja(sB, B.almacenMemoria(), { esperaMax: 20 });
		A.iniciar(); Bb.iniciar();
		await Bb.agregar("asistencia", asis("ana", "ausente"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await A.agregar("asistencia", asis("ana", "ausente"), "Asistencia de Ana", vista({ estado: "presente" }, "m0"), C(["estado"]));
		await vacia(A);
		sB.modo.red = false;
		await Bb.procesar();
		await vacia(Bb);
		ok("el mismo valor desde dos aparatos: queda, sin aviso", [asisDe(bdR, "ana").asistencia_estado, Bb.eventos.conflictos.length, Bb.pendientes()], ["ausente", 0, 0]);
	});

	// Una marca ajena que este aparato ya vio (otra ventana capturó sobre ella lo mismo que había):
	// la ventana vieja, después, sí escribe (gana el último toque del aparato)
	await caso("marca ajena vista por otra ventana", async () => {
		const bdR = crearBD();
		bdR.calificaciones.push({ id: "k1", maestro_id: "m1", alumno_id: "ana", producto_sesion_id: "p1", nivel: "logrado", estado_entrega: "entregado", puntaje: 5, retroalimentacion: null, ...M("calificacion", "s0") });
		const alm = B.almacenMemoria();
		const v1 = bandeja(cliente(bdR, {}), alm), v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar(); v2.iniciar();
		const vieja = vistaFila("calificacion", calDe(bdR, "ana", "p1")); // lo que vio la ventana 1
		// Otro aparato: semáforo En proceso y puntaje 9
		Object.assign(calDe(bdR, "ana", "p1"), { nivel: "en_proceso", puntaje: 9 }, otro("nivel", "f1"), ESQUEMA === "campo" ? { captura_puntaje: "h1" } : {});
		// La ventana 2 ve el semáforo nuevo pero el puntaje viejo, y captura En proceso (lo que ya hay) y puntaje 9
		const mezcla = vistaFila("calificacion", Object.assign({}, calDe(bdR, "ana", "p1"), { puntaje: 5 }, ESQUEMA === "campo" ? { captura_puntaje: "s0" } : {}));
		await v2.agregar("calificacion", calif("ana", "p1", { nivel: "en_proceso", estado_entrega: "entregado", puntaje: 9 }), "Calificación de Ana", mezcla, C(["nivel", "estado_entrega", "puntaje"]));
		await vacia(v2);
		// La ventana 1 (vieja) toca Requiere apoyo después
		await v1.agregar("calificacion", calif("ana", "p1", { nivel: "requiere_apoyo", estado_entrega: "entregado" }), "Calificación de Ana", vieja, C(["nivel", "estado_entrega"]));
		await vacia(v1);
		ok("marca ajena que el aparato ya vio: gana el último toque, sin aviso; el puntaje del otro aparato queda",
			[calDe(bdR, "ana", "p1").nivel, calDe(bdR, "ana", "p1").puntaje, v1.eventos.conflictos.length + v2.eventos.conflictos.length], ["requiere_apoyo", 9, 0]);
	});

	// Sin canal: una ventana vieja no pone el relleno 1 y 1 a quien otra ventana marcó con falta
	await caso("relleno y falta en otra ventana", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const v1 = bandeja(cliente(bdR, {}), alm), v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar(); v2.iniciar();
		await v1.agregar("asistencia", asis("dani", "ausente"), "Asistencia de Dani", null, C(["estado"]));
		await vacia(v1);
		// La ventana 2 no se enteró: guarda el cierre de todos
		for (const al of ["ana", "dani"]) await v2.agregar("registro", Object.assign(reg(al, 1, 1), { grupo_id: "g1" }), "Cierre del día de " + al, null, RELLENO);
		await vacia(v2);
		const gDani = v2.eventos.guardadas.find(([c]) => c === KR("dani"));
		ok("relleno: sí a Ana; no a Dani (este aparato la marcó con falta), sin avisos",
			[bdR.registro_diario.map((r) => r.alumno_id), v2.eventos.conflictos.length, v2.pendientes()], [["ana"], 0, 0]);
		ok("relleno omitido: la pantalla sabe que Dani no tiene cierre", gDani ? gDani[1].fila : "sin aviso a la pantalla", false);
	});

	// El relleno propio con la respuesta perdida: tocar después a ese alumno no da aviso falso
	await caso("relleno con respuesta perdida", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, { perder: 1 });
		const v1 = bandeja(s1, alm, { esperaMax: 10000 }), v2 = bandeja(cliente(bdR, {}), alm);
		v1.iniciar();
		await v1.agregar("registro", reg("dani", 1, 1), "Cierre del día de Dani", null, RELLENO);
		await dormir(30);
		await v2.agregar("registro", reg("dani", 1, 0), "Cierre del día de Dani", null, C(["conducta"]));
		await v2.iniciar();
		await vacia(v2);
		ok("relleno con respuesta perdida y luego conducta 0 en otra ventana: se aplica, sin aviso",
			[vReg(regDe(bdR, "dani")), v2.eventos.conflictos.length, (await alm.todos()).length], [{ participacion: 1, conducta: 0 }, 0, 0]);
	});

	// La marca inicial (dos aparatos, R13-t20 "dos"): B crea la calificación de Ana solo con el semáforo
	// y guarda el cierre (relleno); A, que no veía esas filas, pone puntaje 7 a Ana y conducta 0 a
	// Dani. Nadie había escrito esos grupos: se aplican sin aviso y lo de B se conserva
	await caso("marca inicial: dos aparatos sin avisos falsos", async () => {
		const bdR = crearBD();
		const sA = cliente(bdR, { red: true });
		const A = bandeja(sA, B.almacenMemoria(), { esperaMax: 20 }), Bb = bandeja(cliente(bdR, {}), B.almacenMemoria());
		A.iniciar(); Bb.iniciar();
		await A.agregar("calificacion", calif("ana", "p1", { puntaje: 7 }), "Calificación de Ana", null, C(["puntaje"]));
		await A.agregar("registro", reg("dani", 1, 0), "Cierre del día de Dani", null, C(["conducta"]));
		await Bb.agregar("calificacion", calif("ana", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Ana", null, C(["nivel", "estado_entrega"]));
		await Bb.agregar("registro", reg("dani", 1, 1), "Cierre del día de Dani", null, RELLENO);
		await vacia(Bb);
		sA.modo.red = false;
		await A.procesar();
		await vacia(A);
		const c = calDe(bdR, "ana", "p1");
		ok("marca inicial: el semáforo de B y el puntaje de A; conducta 0 de A sobre el relleno de B; sin avisos",
			[c.nivel, c.puntaje, vReg(regDe(bdR, "dani")), A.eventos.conflictos.length], ["logrado", 7, { participacion: 1, conducta: 0 }, 0]);
	});

	// Ida y vuelta sobre un grupo que tenía la marca inicial: B puso puntaje 5 y luego lo quitó; A (que
	// no veía la fila) captura puntaje 3 → conflicto, se conserva lo de B
	await caso("marca inicial: la ida y vuelta se nota", async () => {
		const bdR = crearBD();
		const sA = cliente(bdR, { red: true });
		const A = bandeja(sA, B.almacenMemoria(), { esperaMax: 20 }), Bb = bandeja(cliente(bdR, {}), B.almacenMemoria());
		A.iniciar(); Bb.iniciar();
		await A.agregar("calificacion", calif("ana", "p1", { puntaje: 3 }), "Calificación de Ana", null, C(["puntaje"]));
		await Bb.agregar("calificacion", calif("ana", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de Ana", null, C(["nivel", "estado_entrega"]));
		await vacia(Bb);
		for (const p of [5, null]) {
			await Bb.agregar("calificacion", calif("ana", "p1", { nivel: "logrado", estado_entrega: "entregado", puntaje: p }), "Calificación de Ana", ultimaBase(Bb, KC("ana", "p1")), C(["puntaje"]));
			await vacia(Bb);
		}
		sA.modo.red = false;
		await A.procesar();
		await vacia(A);
		ok("marca inicial y luego ida y vuelta de otro aparato: conflicto, se conserva lo de B (sin puntaje)",
			[calDe(bdR, "ana", "p1").puntaje, A.eventos.conflictos.map((x) => x[0])], [null, ["Calificación de Ana"]]);
	});

	// Una falta vieja anotada en este aparato que ya se corrigió en otra pantalla no impide el relleno
	await caso("relleno: la falta anotada se confirma con la base", async () => {
		const bdR = crearBD();
		const alm = B.almacenMemoria();
		const s1 = cliente(bdR, {});
		const v1 = bandeja(s1, alm);
		v1.iniciar();
		await v1.agregar("asistencia", asis("ana", "ausente"), "Asistencia de Ana", null, C(["estado"]));
		await vacia(v1);
		// La pantalla Asistencia la corrige a Presente (sin marca: el trigger pone una del servidor)
		await s1.from("asistencias").upsert({ maestro_id: "m1", grupo_id: "g1", alumno_id: "ana", fecha: F, asistencia_estado: "presente" }, { onConflict: "grupo_id,alumno_id,fecha" });
		await v1.agregar("registro", Object.assign(reg("ana", 1, 1), { grupo_id: "g1" }), "Cierre del día de Ana", null, RELLENO);
		await vacia(v1);
		ok("falta anotada pero corregida en la base: el relleno sí se pone", vReg(regDe(bdR, "ana")), { participacion: 1, conducta: 1 });
	});

	ok("un error de la base sin su código técnico", /PGRST|código|\(error/.test(B.explicar({ status: 404, code: "PGRST205", message: "Could not find the table" })), false);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
