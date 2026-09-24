/*
	La calificación propuesta sale del MISMO porcentaje que se ve y se guarda: truncado a 2
	decimales, nunca redondeado (revisión R3 del cierre, 2026-09-24).

	Caso real de borde: 49.9964 % se ve "49.9 %" y se guarda 49.99. Si el motor mandaba
	50.00 (redondeado) a calcular_calificaciones_boleta, en Fase 4 salía un 6 que acredita
	junto a "49.9 %"; con 49.99 sale 5. El nivel (semáforo) usa el mismo valor.

	node pruebas/porcentaje-truncado.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
const M = require("../js/motor-calificacion.js");

// Pesos de fábrica sin conducta (28/28/6/33; la conducta ya no pondera, decisión de Jorge
// del 2026-09-24). Tarea con puntaje 5.1956, trabajo en "requiere apoyo" (0.4) y 8 días de
// participación (uno en 0), sin examen: (28 × 0.51956 + 28 × 0.4 + 6 × 0.875) / 62
// = 49.9962... % en Lenguajes. La conducta de esos días (casi toda en 0) no mueve nada.
const fechas = [];
for (let i = 1; i <= 8; i++) fechas.push("2026-09-" + String(i).padStart(2, "0"));
const DATOS = {
	maestro_ajustes: [],
	grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }],
	proyectos: [{ id: "proy" }],
	sesiones: fechas.map((f, i) => ({ id: "s" + i, fecha: f, campo_formativo: "Lenguajes" })),
	productos_sesion: [
		{ id: "t1", sesion_id: "s0", tipo: "tarea", campo: "LEN", grados: ["3"], fecha_entrega: null, activo: true },
		{ id: "w1", sesion_id: "s2", tipo: "trabajo", campo: "LEN", grados: ["3"], fecha_entrega: null, activo: true },
	],
	calificaciones: [
		{ producto_sesion_id: "t1", tipo: "tarea", estado_entrega: "entregado", puntaje: 5.1956 },
		{ producto_sesion_id: "w1", tipo: "trabajo", estado_entrega: "entregado", nivel: "requiere_apoyo" },
	].map((c) => Object.assign({ alumno_id: "a", proyecto_id: "proy", fecha: "2026-09-01" }, c)),
	registro_diario: fechas.map((f, i) => ({ alumno_id: "a", fecha: f,
		participacion: i === 0 ? 0 : 1, conducta: i === 7 ? null : (i === 1 ? 1 : 0) })),
	asistencias: [],
	examenes: [],
	alumnos: [{ id: "a", created_at: "2026-08-01T15:00:00+00:00" }],
};
function consulta(tabla) {
	const q = {
		select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
		range() { return Promise.resolve({ data: DATOS[tabla] || [], error: null }); },
		maybeSingle() { return Promise.resolve({ data: null, error: null }); },
		then(ok_, err) { return Promise.resolve({ data: DATOS[tabla] || [], error: null }).then(ok_, err); },
	};
	return q;
}
let enviados = null;
const sb = {
	from: consulta,
	// Imita a calcular_calificaciones_boleta en Fase 4: menos de 50 es 5
	rpc(nombre, args) {
		enviados = args.p_porcentajes.slice();
		return Promise.resolve({ data: args.p_porcentajes.map((p) => (p < 50 ? 5 : 6)), error: null });
	},
};

(async () => {
	const r = await M.cargarYCalcularGrupo(sb, {
		maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN"], alumnos: [{ id: "a", grado: 3 }],
	});
	const len = r.porAlumno.a.porCampo.LEN;
	ok("el caso es de borde: porcentaje exacto entre 49.99 y 50", len.porcentaje > 49.99 && len.porcentaje < 50, true);
	ok("a la función SQL va el porcentaje truncado a 2 decimales (49.99, no 50)", enviados, [49.99]);
	ok("calificación propuesta: 5, la misma que corresponde a lo que se ve (49.9 %)", len.calificacionPropuesta, 5);
	ok("el nivel usa el mismo valor", len.nivel, "requiere_apoyo");

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
