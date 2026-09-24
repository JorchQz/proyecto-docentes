/*
	Examen del trimestre y alumno dado de alta tarde (decisión de Jorge 10, 2026-09-24),
	de punta a punta en el motor de calificación:
	  - un examen aplicado antes del alta de un alumno, que no contestó, no le cuenta: el
	    rubro de examen queda sin datos y su peso se reparte (no reprueba por un examen
	    que nunca se le aplicó);
	  - si lo contestó, sí cuenta (es evidencia de que lo presentó);
	  - un examen aplicado después de su alta cuenta aunque no lo contestara;
	  - a los alumnos de siempre no les cambia nada;
	  - solo cuentan los exámenes DEL GRUPO (una maestra con dos grupos del mismo grado
	    no mezcla exámenes).

	node pruebas/examen-alta-tarde.test.js
*/

global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
const M = require("../js/motor-calificacion.js");
const A = window.AlcanceHoy;

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

// ── La regla sola ──────────────────────────────────────────────────────────────
const ALTA = "2026-09-24T11:04:45Z";
ok("de siempre (alta null): cuenta", A.examenCuentaDesdeAlta(null, ALTA, "2026-09-24T10:30:00Z", false), true);
ok("aplicado antes del alta, sin contestar: no cuenta", A.examenCuentaDesdeAlta("2026-09-24", ALTA, "2026-09-24T10:30:00Z", false), false);
ok("aplicado antes del alta, contestado: cuenta", A.examenCuentaDesdeAlta("2026-09-24", ALTA, "2026-09-24T10:30:00Z", true), true);
ok("aplicado después del alta: cuenta", A.examenCuentaDesdeAlta("2026-09-24", ALTA, "2026-09-30T15:00:00Z", false), true);
ok("sin fecha de examen: cuenta (no se esconde nada)", A.examenCuentaDesdeAlta("2026-09-24", ALTA, null, false), true);

// ── Supabase falso que SÍ aplica los filtros eq / in / order / range ─────────────
const MAESTRO = "m";
const DATOS = {
	maestro_ajustes: [],
	grupos: [{ id: "g1", created_at: "2026-08-01T15:00:00+00:00" }, { id: "g2", created_at: "2026-08-01T15:00:00+00:00" }],
	proyectos: [{ id: "proy", maestro_id: MAESTRO, grupo_id: "g1", trimestre: 1 }],
	sesiones: [{ id: "s1", proyecto_id: "proy", fecha: "2026-09-10", campo_formativo: "Lenguajes" }],
	productos_sesion: [
		{ id: "t1", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["4"], fecha_entrega: null, activo: true },
	],
	calificaciones: [
		{ alumno_id: "siempre", producto_sesion_id: "t1", maestro_id: MAESTRO, proyecto_id: "proy", tipo: "tarea", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-10" },
	],
	registro_diario: [],
	asistencias: [],
	examenes: [
		// Examen del grupo 1, aplicado el 24 a las 10:30 (antes del alta de "tarde")
		{ id: "ex1", maestro_id: MAESTRO, grupo_id: "g1", trimestre: 1, grado: 4, preguntas_ids: ["p1", "p2"], valor_total: 10, total_preguntas: 2, created_at: "2026-09-20T10:00:00+00:00" },
		// Examen de OTRO grupo del mismo grado, más reciente: no debe mezclarse
		{ id: "exOtro", maestro_id: MAESTRO, grupo_id: "g2", trimestre: 1, grado: 4, preguntas_ids: ["p1", "p2"], valor_total: 10, total_preguntas: 2, created_at: "2026-09-22T10:00:00+00:00" },
	],
	banco_preguntas: [{ id: "p1", campo_formativo: "Lenguajes" }, { id: "p2", campo_formativo: "Saberes y Pensamiento Científico" }],
	respuestas_examen: [
		{ id: "r1", examen_id: "ex1", alumno_id: "siempre", pregunta_id: "p1", puntos_obtenidos: 5, created_at: "2026-09-24T10:30:52+00:00" },
		{ id: "r2", examen_id: "ex1", alumno_id: "siempre", pregunta_id: "p2", puntos_obtenidos: 0, created_at: "2026-09-24T10:31:00+00:00" },
		{ id: "r3", examen_id: "ex1", alumno_id: "contesto", pregunta_id: "p1", puntos_obtenidos: 5, created_at: "2026-09-24T12:00:00+00:00" },
		{ id: "r4", examen_id: "ex1", alumno_id: "contesto", pregunta_id: "p2", puntos_obtenidos: 5, created_at: "2026-09-24T12:00:00+00:00" },
		{ id: "r9", examen_id: "exOtro", alumno_id: "otroGrupo", pregunta_id: "p1", puntos_obtenidos: 5, created_at: "2026-09-23T10:00:00+00:00" },
	],
	alumnos: [
		{ id: "siempre", created_at: "2026-08-20T15:00:00+00:00" },
		// Alta el 24 a las 11:04 UTC (mismo día que el examen, pero después)
		{ id: "tarde", created_at: "2026-09-24T11:04:45+00:00" },
		{ id: "contesto", created_at: "2026-09-24T11:04:45+00:00" },
	],
};
function consulta(tabla) {
	const filtros = [];
	let orden = null, desde = 0, hasta = Infinity;
	const q = {
		select() { return q; },
		eq(c, v) { filtros.push((f) => String(f[c]) === String(v)); return q; },
		in(c, vs) { const s = vs.map(String); filtros.push((f) => s.indexOf(String(f[c])) !== -1); return q; },
		gte(c, v) { filtros.push((f) => f[c] >= v); return q; },
		lte(c, v) { filtros.push((f) => f[c] <= v); return q; },
		order(c, o) { orden = { c, asc: !(o && o.ascending === false) }; return q; },
		range(a, b) { desde = a; hasta = b; return q.resolver(); },
		maybeSingle() { return Promise.resolve({ data: null, error: null }); },
		resolver() {
			let filas = (DATOS[tabla] || []).filter((f) => filtros.every((fn) => fn(f)));
			if (orden) filas = filas.slice().sort((x, y) => (x[orden.c] < y[orden.c] ? -1 : x[orden.c] > y[orden.c] ? 1 : 0) * (orden.asc ? 1 : -1));
			return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
		},
		then(bien, mal) { return q.resolver().then(bien, mal); },
	};
	return q;
}
const sb = {
	from: consulta,
	rpc(nombre, args) { return Promise.resolve({ data: args.p_porcentajes.map((p) => (p >= 60 ? 8 : 5)), error: null }); },
};

(async () => {
	const r = await M.cargarYCalcularGrupo(sb, {
		maestroId: MAESTRO, grupoId: "g1", trimestre: 1,
		alumnos: [{ id: "siempre", grado: 4 }, { id: "tarde", grado: 4 }, { id: "contesto", grado: 4 }],
	});
	const ex = (id, c) => { const x = r.porAlumno[id].porCampo[c].rubros.examen; return [x.obtenido, x.maximo]; };

	// De siempre: examen del grupo 1 (no el del grupo 2, más reciente): LEN 5/5, SAB 0/5
	ok("de siempre: examen LEN del grupo propio", ex("siempre", "LEN"), [1, 1]);
	ok("de siempre: examen SAB del grupo propio", ex("siempre", "SAB"), [0, 1]);

	// Alta tarde sin contestar: sin examen en ningún campo (antes: 0 de 1 en los cuatro)
	["LEN", "SAB", "ETI", "DHL"].forEach((c) => ok("alta tarde sin contestar: " + c + " sin examen", ex("tarde", c), [0, 0]));
	ok("alta tarde sin contestar: SAB sin datos, no reprobado", r.porAlumno.tarde.porCampo.SAB.porcentaje, null);
	ok("alta tarde sin contestar: sin propuesta en SAB", r.porAlumno.tarde.porCampo.SAB.calificacionPropuesta, null);

	// Alta tarde que sí lo contestó: cuenta
	ok("alta tarde que contestó: LEN", ex("contesto", "LEN"), [1, 1]);
	ok("alta tarde que contestó: SAB", ex("contesto", "SAB"), [1, 1]);

	// Examen aplicado después del alta: cuenta aunque no lo contestara
	DATOS.respuestas_examen = DATOS.respuestas_examen.map((x) => x.examen_id === "ex1" ? Object.assign({}, x, { created_at: "2026-09-25T10:00:00+00:00" }) : x);
	const r2 = await M.cargarYCalcular(sb, { maestroId: MAESTRO, grupoId: "g1", alumnoId: "tarde", grado: 4, trimestre: 1 });
	ok("examen aplicado después del alta: cuenta (0 de 1)", [r2.porCampo.SAB.rubros.examen.obtenido, r2.porCampo.SAB.rubros.examen.maximo], [0, 1]);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODO OK");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
