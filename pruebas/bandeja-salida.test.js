/*
	La cola de "Hoy" guardada en el dispositivo (js/bandeja-salida.js; fase 2.5 de
	docs/PWA-MI-SALON.md), contra un Supabase falso que imita las llaves únicas de la base:
	asistencias (grupo, alumno, fecha), registro_diario (maestro, alumno, fecha) y el índice
	único parcial de calificaciones (maestro, alumno, producto).

	- Guardar sin red, "recargar" (otra bandeja sobre el mismo almacén) y reenviar: todo llega
	  UNA sola vez, con el último valor de cada llave.
	- Reenviar lo mismo no duplica.
	- Un error que no es de red (403, CHECK) se avisa con su explicación y sale de la cola: no
	  se reintenta. Un lote del cierre con una fila mala se manda de una en una.
	- La calificación más reciente gana (evaluado_en = momento de la captura); una captura
	  vieja no pisa una nueva de otro dispositivo; si ya existía la fila, se adopta.
	- Una versión vieja en camino no borra la nueva de la misma llave.
	- Solo se envía lo de la cuenta con sesión; sesión vencida se refresca y se reintenta.

	node pruebas/bandeja-salida.test.js
*/
const B = require("../js/bandeja-salida.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Supabase falso ───────────────────────────────────────────────────────────
function crearBD() {
	return { asistencias: [], registro_diario: [], calificaciones: [], siguiente: 1 };
}

/*
	cliente(bd, opciones) → { from, auth, peticiones, modo }
	  modo.red = true           → toda petición falla como sin red (status 0)
	  modo.rechazo = { tabla, status, code, message, si(fila) } → escrituras rechazadas
	  modo.jwt = n              → las siguientes n escrituras responden 401 (JWT expired)
	  modo.demora = ms          → cada petición tarda
*/
function cliente(bd, modo, sesion) {
	modo = modo || {};
	const peticiones = [];
	function coincide(fila, filtros) {
		return filtros.every(([c, v]) => fila[c] === v);
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
	function ejecutar(tabla, q) {
		peticiones.push(tabla + ":" + q.op);
		if (modo.red) return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };
		const escribe = q.op !== "select";
		if (escribe && modo.jwt > 0) { modo.jwt--; return { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 }; }
		const filas = q.filas || (q.fila ? [q.fila] : []);
		const r = modo.rechazo;
		if (escribe && r && r.tabla === tabla && (!r.si || filas.some(r.si) || q.op === "update" || q.op === "delete")) {
			return { data: null, error: { message: r.message || "rechazado", code: r.code || "" }, status: r.status || 400 };
		}
		const t = bd[tabla];
		if (q.op === "upsert") {
			filas.forEach((f) => {
				const previa = t.find((x) => q.conflicto.every((c) => x[c] === f[c]));
				if (previa) Object.assign(previa, f);
				else t.push(Object.assign({ id: "id" + bd.siguiente++ }, f));
			});
			return { data: null, error: null, status: 201 };
		}
		if (q.op === "insert") {
			const f = q.fila;
			if (tabla === "calificaciones" && t.some((x) => x.maestro_id === f.maestro_id && x.alumno_id === f.alumno_id && x.producto_sesion_id === f.producto_sesion_id)) {
				return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, status: 409 };
			}
			const nueva = Object.assign({ id: "id" + bd.siguiente++ }, f);
			t.push(nueva);
			return { data: q.uno ? { id: nueva.id } : [{ id: nueva.id }], error: null, status: 201 };
		}
		const elegidas = t.filter((x) => coincide(x, q.filtros) && cumpleOr(x, q.or));
		if (q.op === "update") {
			elegidas.forEach((x) => Object.assign(x, q.fila));
			return { data: q.devolver ? elegidas.map((x) => ({ id: x.id })) : null, error: null, status: 200 };
		}
		if (q.op === "delete") {
			bd[tabla] = t.filter((x) => !elegidas.includes(x));
			return { data: null, error: null, status: 204 };
		}
		if (q.uno) return { data: elegidas[0] ? Object.assign({}, elegidas[0]) : null, error: null, status: 200 };
		return { data: elegidas.map((x) => Object.assign({}, x)), error: null, status: 200 };
	}
	function from(tabla) {
		const q = { op: "select", filtros: [], or: null };
		const api = {
			select() { if (q.op !== "select") q.devolver = true; return api; },
			insert(f) { q.op = "insert"; q.fila = f; return api; },
			upsert(f, o) { q.op = "upsert"; q.filas = [].concat(f); q.conflicto = o.onConflict.split(","); return api; },
			update(f) { q.op = "update"; q.fila = f; return api; },
			delete() { q.op = "delete"; return api; },
			eq(c, v) { q.filtros.push([c, v]); return api; },
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
	const auth = {
		getSession: async () => ({ data: { session: sesion === undefined ? { user: { id: "m1" } } : sesion }, error: null }),
	};
	return { from, auth, peticiones, modo };
}

function bandeja(sb, almacen, extra) {
	const eventos = { rechazos: [], superadas: [], guardadas: [], cambios: [] };
	const b = B.crear(Object.assign({
		sb, auth: sb.auth, maestroId: "m1", almacen, esperaMax: 40,
		alCambiar: (e) => eventos.cambios.push(e),
		alGuardar: (it, r) => eventos.guardadas.push([it.clave, r]),
		alRechazar: (it, x) => eventos.rechazos.push([it.descripcion, x]),
		alSuperar: (it) => eventos.superadas.push(it.descripcion),
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
	ok("llave de la asistencia: grupo, alumno y fecha", B.clave("asistencia", "m1", { grupo_id: "g", alumno_id: "a", fecha: "f" }), "asistencia|g|a|f");
	ok("cierre y retirar el cierre comparten llave",
		B.clave("registro", "m1", { alumno_id: "a", fecha: "f" }) === B.clave("registro_borrar", "m1", { alumno_id: "a", fecha: "f" }), true);

	// ── 1. Sin red: se guarda en el dispositivo ──────────────────────────────────
	const bd = crearBD();
	const almacen = B.almacenMemoria(); // el mismo objeto en las dos "cargas" = el dispositivo
	const sinRed = cliente(bd, { red: true });
	const b1 = bandeja(sinRed, almacen);
	b1.iniciar();
	await b1.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "presente" }, "Asistencia de A1");
	await b1.agregar("asistencia", { grupo_id: "g1", alumno_id: "a2", fecha: "2026-09-25", estado: "presente" }, "Asistencia de A2");
	await b1.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "ausente" }, "Asistencia de A1");
	await b1.agregar("calificacion", calif("a1", "p1", { nivel: "logrado", estado_entrega: "entregado" }), "Calificación de A1");
	await dormir(5);
	await b1.agregar("calificacion", calif("a1", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de A1");
	await b1.agregar("registro", { alumno_id: "a1", fecha: "2026-09-25", participacion: 2, conducta: 1 }, "Cierre de A1");
	await b1.agregar("registro", { alumno_id: "a2", fecha: "2026-09-25", participacion: 1, conducta: 1 }, "Cierre de A2");
	await b1.agregar("registro_borrar", { alumno_id: "a2", fecha: "2026-09-25" }, "Cierre de A2");
	await dormir(30);
	ok("sin red: una captura por llave (5 pendientes)", b1.pendientes(), 5);
	ok("sin red: el estado es 'red'", b1.estado(), "red");
	ok("sin red: el aviso dice cuántas y que es la red", b1.eventos.cambios.slice(-1)[0].pendientes + "/" + b1.eventos.cambios.slice(-1)[0].estado, "5/red");
	ok("sin red: nada llegó a la base", [bd.asistencias.length, bd.calificaciones.length, bd.registro_diario.length], [0, 0, 0]);
	ok("sin red: nada se descartó", b1.eventos.rechazos.length, 0);
	const antes = sinRed.peticiones.length;
	await dormir(150);
	ok("sin red: se reintenta con espera (siguió intentando)", sinRed.peticiones.length > antes, true);

	// ── 2. "Recargar" con red: otra bandeja sobre el mismo dispositivo ───────────
	const conRed = cliente(bd, {});
	const b2 = bandeja(conRed, almacen);
	ok("al recargar, lo pendiente sigue en el dispositivo", (await b2.lista()).length, 5);
	await b2.iniciar();
	await b2.vacia();
	ok("con red: la cola quedó vacía", b2.pendientes(), 0);
	ok("asistencia: una fila por alumno y el último valor",
		bd.asistencias.map((a) => a.alumno_id + ":" + a.asistencia_estado).sort(), ["a1:ausente", "a2:presente"]);
	ok("calificación: una sola fila, con el último valor", bd.calificaciones.map((c) => c.alumno_id + ":" + c.nivel), ["a1:en_proceso"]);
	ok("calificación: evaluado_en es el momento de la captura", /^\d{4}-\d\d-\d\dT/.test(bd.calificaciones[0].evaluado_en), true);
	ok("cierre: el de A1 guardado y el de A2 retirado", bd.registro_diario.map((r) => r.alumno_id + ":" + r.participacion), ["a1:2"]);
	ok("calificación: un solo insert (sin duplicados)", conRed.peticiones.filter((p) => p === "calificaciones:insert").length, 1);
	ok("el id de la calificación nueva se entrega a la pantalla",
		b2.eventos.guardadas.some(([c, r]) => c === "calificacion|m1|a1|p1" && r.id === bd.calificaciones[0].id), true);
	ok("'Todo guardado': el último aviso es 0 pendientes", b2.eventos.cambios.slice(-1)[0].pendientes, 0);

	// Reenviar lo mismo (otra pestaña, o una respuesta que no llegó) no duplica
	await b2.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "ausente" }, "Asistencia de A1");
	await b2.agregar("calificacion", calif("a1", "p1", { nivel: "en_proceso", estado_entrega: "entregado" }), "Calificación de A1");
	await b2.vacia();
	ok("reenviar: siguen 2 asistencias y 1 calificación", [bd.asistencias.length, bd.calificaciones.length], [2, 1]);
	ok("reenviar sin id: el insert choca (23505), se adopta la fila y se actualiza", conRed.peticiones.filter((p) => p === "calificaciones:insert").length, 2);

	// ── 3. Error que no es de red: se avisa y NO se reintenta ────────────────────
	const bd3 = crearBD();
	const rechaza = cliente(bd3, { rechazo: { tabla: "asistencias", status: 403, code: "42501", message: "new row violates row-level security policy" } });
	const b3 = bandeja(rechaza, B.almacenMemoria());
	b3.iniciar();
	await b3.agregar("asistencia", { grupo_id: "g1", alumno_id: "a9", fecha: "2026-09-25", estado: "presente" }, "Asistencia de A9");
	await b3.agregar("registro", { alumno_id: "a1", fecha: "2026-09-25", participacion: 1, conducta: 1 }, "Cierre de A1");
	await b3.vacia();
	await dormir(200);
	ok("rechazo: se intentó una sola vez", rechaza.peticiones.filter((p) => p === "asistencias:upsert").length, 1);
	ok("rechazo: se avisó con su explicación", b3.eventos.rechazos.map((r) => r[0] + " — " + /no lo permitió/.test(r[1])), ["Asistencia de A9 — true"]);
	ok("rechazo: salió de la cola y lo demás sí se guardó", [b3.pendientes(), bd3.registro_diario.length], [0, 1]);

	// Lote del cierre con una fila que viola un CHECK: se manda de una en una y solo esa sale
	const bd4 = crearBD();
	const check = cliente(bd4, { rechazo: { tabla: "registro_diario", status: 400, code: "23514", message: "violates check constraint", si: (f) => f.participacion > 2 } });
	const b4 = bandeja(check, B.almacenMemoria());
	await b4.agregar("registro", { alumno_id: "a1", fecha: "2026-09-25", participacion: 1, conducta: 1 }, "Cierre de A1");
	await b4.agregar("registro", { alumno_id: "a2", fecha: "2026-09-25", participacion: 7, conducta: 1 }, "Cierre de A2");
	await b4.agregar("registro", { alumno_id: "a3", fecha: "2026-09-25", participacion: 0, conducta: 2 }, "Cierre de A3");
	b4.iniciar();
	await b4.vacia();
	ok("lote con una fila mala: las buenas se guardan", bd4.registro_diario.map((r) => r.alumno_id).sort(), ["a1", "a3"]);
	ok("lote con una fila mala: solo esa se avisa", b4.eventos.rechazos.map((r) => r[0] + ": " + r[1]), ["Cierre de A2: un valor capturado no es válido"]);

	// ── 4. La captura más reciente gana ──────────────────────────────────────────
	const bd5 = crearBD();
	bd5.calificaciones.push({ id: "c5", maestro_id: "m1", alumno_id: "a1", producto_sesion_id: "p1", nivel: "logrado", evaluado_en: "2999-01-01T00:00:00.000Z" });
	const s5 = cliente(bd5, {});
	const b5 = bandeja(s5, B.almacenMemoria());
	b5.iniciar();
	await b5.agregar("calificacion", calif("a1", "p1", { nivel: "requiere_apoyo" }, "c5"), "Calificación de A1 en Cartel");
	await b5.vacia();
	ok("una captura vieja no pisa una más nueva de otro dispositivo", bd5.calificaciones[0].nivel, "logrado");
	ok("y se avisa que se conservó la más reciente", b5.eventos.superadas, ["Calificación de A1 en Cartel"]);
	// Sin id y la fila ya existe (vieja): se adopta y se actualiza
	bd5.calificaciones.push({ id: "c6", maestro_id: "m1", alumno_id: "a2", producto_sesion_id: "p1", nivel: "logrado", evaluado_en: "2020-01-01T00:00:00.000Z" });
	await b5.agregar("calificacion", calif("a2", "p1", { nivel: "en_proceso" }), "Calificación de A2");
	await b5.vacia();
	ok("sin id: adopta la fila existente (más vieja) y la actualiza, sin duplicar",
		bd5.calificaciones.filter((c) => c.alumno_id === "a2").map((c) => c.id + ":" + c.nivel), ["c6:en_proceso"]);
	// La fila se borró en la base: se vuelve a insertar
	bd5.calificaciones = bd5.calificaciones.filter((c) => c.id !== "c6");
	await b5.agregar("calificacion", calif("a2", "p1", { nivel: "logrado" }, "c6"), "Calificación de A2");
	await b5.vacia();
	ok("con id de una fila que ya no existe: se inserta de nuevo", bd5.calificaciones.filter((c) => c.alumno_id === "a2").map((c) => c.nivel), ["logrado"]);

	// ── 5. Una versión vieja en camino no borra la nueva ─────────────────────────
	const bd6 = crearBD();
	const lento = cliente(bd6, { demora: 60 });
	const alm6 = B.almacenMemoria();
	const b6 = bandeja(lento, alm6);
	b6.iniciar();
	b6.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "presente" }, "A1");
	await dormir(20); // la primera ya va en camino
	await b6.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "justificada" }, "A1");
	await b6.vacia();
	ok("en camino: al final la base tiene el último valor", bd6.asistencias.map((a) => a.asistencia_estado), ["justificada"]);
	ok("en camino: la nueva no se borró sin enviarse (2 envíos)", lento.peticiones.filter((p) => p === "asistencias:upsert").length, 2);

	// ── 6. Cuentas y sesión ──────────────────────────────────────────────────────
	const bd7 = crearBD();
	const alm7 = B.almacenMemoria();
	const ajena = B.crear({ sb: cliente(bd7, { red: true }), maestroId: "otra", almacen: alm7, esperaMax: 40 });
	await ajena.agregar("asistencia", { grupo_id: "g2", alumno_id: "z1", fecha: "2026-09-25", estado: "presente" }, "Z1");
	const s7 = cliente(bd7, { jwt: 1 });
	const b7 = bandeja(s7, alm7);
	await b7.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "presente" }, "A1");
	await b7.iniciar();
	await b7.vacia();
	ok("equipo compartido: lo de otra cuenta no se envía ni se cuenta", [bd7.asistencias.map((a) => a.alumno_id), b7.pendientes(), (await alm7.todos()).length], [["a1"], 0, 1]);
	ok("sesión vencida (401): se refresca y se reintenta", s7.peticiones.filter((p) => p === "asistencias:upsert").length, 2);
	const s8 = cliente(crearBD(), { jwt: 99 }, null);
	const b8 = bandeja(s8, B.almacenMemoria());
	b8.iniciar();
	await b8.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "presente" }, "A1");
	await dormir(100);
	ok("sin sesión: espera (estado 'sesion') y no borra nada", [b8.estado(), b8.pendientes(), b8.eventos.rechazos.length], ["sesion", 1, 0]);

	// ── 7. Sin habilitar no se envía (la pantalla primero pinta lo pendiente) ────
	const bd9 = crearBD();
	const b9 = bandeja(cliente(bd9, {}), B.almacenMemoria());
	await b9.agregar("asistencia", { grupo_id: "g1", alumno_id: "a1", fecha: "2026-09-25", estado: "presente" }, "A1");
	await dormir(20);
	ok("antes de iniciar(): se guarda pero no se envía", [b9.pendientes(), bd9.asistencias.length], [1, 0]);
	await b9.iniciar();
	await b9.vacia();
	ok("después de iniciar(): se envía", bd9.asistencias.length, 1);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
