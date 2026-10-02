/*
	Fase 2 de Hoy (Jorge, 2026-09-29): faltas derivadas, "No entregó" que pasa a revisión, "Terminar sesión"
	y el visor de anexos y libros.

	  - CalendarioSEP.diaDeClaseN y las funciones puras de js/alcance-hoy.js (regresoDe, venceFalta,
	    estadoPorAsistencia, pendientesPorFalta, estadoPlazo), con casos por fecha: falta en lunes y regreso
	    en miércoles, festivo y CTE de por medio, dos faltas seguidas, justificar días después y ausente otra
	    vez el día de la revisión.
	  - El motor: una falta sin justificar vale No entregó (0) sin tocar lo demás; la justificada no cuenta
	    mientras esté pendiente; una calificación del docente siempre manda; lo histórico no se deriva.
	  - AlcanceHoy.cambiosIncompleta con "No entregó" en clase.
	  - SesionTerminar.enCurso y su corte; VisorRecursos.urlEmbebible; los enlaces a libros de la secuencia.

	node pruebas/faltas-fase2.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

global.window = {};
require("../js/campos-formativos.js");
const C = require("../js/calendario-sep.js");
window.CalendarioSEP = C;
const A = require("../js/alcance-hoy.js");
window.AlcanceHoy = A;
const M = require("../js/motor-calificacion.js");
const ST = require("../js/sesion-terminar.js");
const V = require("../js/visor-recursos.js");
const S = require("../js/secuencia-sesion.js");

// ── 1. diaDeClaseN ───────────────────────────────────────────────────────────
// 2026-09-30 es miércoles; 2026-10-05 lunes
ok("día de la semana de referencia (miércoles 30 sep)", C.diaSemana("2026-09-30"), 3);
ok("regresa el miércoles: jueves (1), viernes (2) y lunes (3)", C.diaDeClaseN("2026-09-30", 3, []), "2026-10-05");
ok("n = 1 es el siguiente día de clase", C.diaDeClaseN("2026-09-30", 1, []), C.siguienteDiaDeClase("2026-09-30", []));
ok("n = 0 devuelve la misma fecha", C.diaDeClaseN("2026-09-30", 0, []), "2026-09-30");
// 29 oct (jueves): 30 oct es CTE, 2 nov es festivo (Día de Muertos): martes 3 (1), miércoles 4 (2), jueves 5 (3)
ok("festivo y CTE de por medio: desde el jueves 29 oct, 3 días de clase → jueves 5 nov", C.diaDeClaseN("2026-10-29", 3, []), "2026-11-05");
ok("un ajuste del grupo (suspensión el lunes 5 oct) recorre el plazo", C.diaDeClaseN("2026-09-30", 3, [{ fecha: "2026-10-05", tipo: "suspension", motivo: "x" }]), "2026-10-06");
ok("desde un sábado, cuenta desde el lunes", C.diaDeClaseN("2026-10-03", 3, []), "2026-10-07");
ok("fecha inválida: null", C.diaDeClaseN("hola", 3, []), null);

// ── 2. Funciones puras de faltas ─────────────────────────────────────────────
function asis(filas) {
	return A.indiceAsistencias(filas.map(function (f) {
		return { alumno_id: "a", fecha: f[0], asistencia_estado: f[1], updated_at: f[2] || (f[0] + "T15:00:00+00:00") };
	})).a;
}
// Falta el lunes 28 sep (justificada), regresa el miércoles 30
let g = asis([["2026-09-28", "justificada"], ["2026-09-29", "justificada"], ["2026-09-30", "presente"], ["2026-10-01", "presente"]]);
ok("regresoDe: el primer Presente después de la falta", A.regresoDe(g, "2026-09-28"), "2026-09-30");
ok("dos faltas seguidas: la segunda regresa el mismo día", A.regresoDe(g, "2026-09-29"), "2026-09-30");
ok("falta el lunes y regreso el miércoles: se revisa el lunes 5 oct", A.venceFalta(g, "2026-09-28", []), "2026-10-05");
ok("dos faltas seguidas vencen el mismo día", A.venceFalta(g, "2026-09-29", []), "2026-10-05");
ok("aún no regresa: sin plazo", A.venceFalta(asis([["2026-09-28", "justificada"]]), "2026-09-28", []), null);
g = asis([["2026-10-28", "justificada"], ["2026-10-29", "presente"]]);
ok("festivo y CTE de por medio: falta el 28 oct, regreso el 29 → vence el 5 nov", A.venceFalta(g, "2026-10-28", []), "2026-11-05");
// Faltó sin justificar el 28, regresó el 29 y se justificó el jueves 1 oct (updated_at): el plazo cuenta desde ahí
g = asis([["2026-09-28", "justificada", "2026-10-01T18:00:00+00:00"], ["2026-09-29", "presente"], ["2026-09-30", "presente"]]);
ok("se justificó días después del regreso: cuenta desde la justificación (1 oct → martes 6 oct)", A.venceFalta(g, "2026-09-28", []), "2026-10-06");
ok("el día de la justificación se toma en hora de México (madrugada UTC del 2 = noche del 1)", A.indiceAsistencias([{ alumno_id: "a", fecha: "2026-09-28", asistencia_estado: "justificada", updated_at: "2026-10-02T03:00:00+00:00" }]).a["2026-09-28"].actualizada, "2026-10-01");
g = asis([["2026-09-28", "justificada", "2026-09-28T20:00:00+00:00"], ["2026-09-29", "presente"]]);
ok("justificada el mismo día de la falta: cuenta desde el regreso", A.venceFalta(g, "2026-09-28", []), "2026-10-02");
// Ausente otra vez el día de la revisión: sigue pendiente; el plazo no lo mueve el calendario
g = asis([["2026-09-28", "justificada"], ["2026-09-30", "presente"], ["2026-10-05", "ausente"]]);
ok("ausente otra vez el día de la revisión: el plazo sigue siendo el 5 oct", A.venceFalta(g, "2026-09-28", []), "2026-10-05");
ok("estadoPlazo: vigente hasta el día de la revisión (incluido)", [A.estadoPlazo("2026-10-05", "2026-10-05"), A.estadoPlazo("2026-10-05", "2026-10-06"), A.estadoPlazo(null, "2026-10-06")], ["vigente", "vencido", "sin_regreso"]);

// estadoPorAsistencia
const trabajo = { id: "t1", tipo: "trabajo", sesion_id: "s1", grados: ["1"] };
const tarea = { id: "ta1", tipo: "tarea", sesion_id: "s1", grados: ["1"] };
g = asis([["2026-09-28", "ausente"], ["2026-09-29", "presente"]]);
ok("estadoPorAsistencia: falta el día de la sesión → ausente", A.estadoPorAsistencia(trabajo, "2026-09-28", g, []), { estado: "ausente", fecha: "2026-09-28" });
ok("estadoPorAsistencia: presente ese día → nada", A.estadoPorAsistencia(trabajo, "2026-09-29", g, []), null);
ok("estadoPorAsistencia: la tarea que se dejó ese día", A.estadoPorAsistencia(tarea, "2026-09-28", g, []), { estado: "ausente", fecha: "2026-09-28" });
g = asis([["2026-09-28", "presente"], ["2026-09-29", "justificada"]]);
ok("estadoPorAsistencia: la tarea que VENCÍA el día que faltó con justificante (dejada el 28, vence el 29)", A.estadoPorAsistencia(tarea, "2026-09-28", g, []), { estado: "justificada", fecha: "2026-09-29" });
ok("estadoPorAsistencia: el trabajo de ese día NO se ve afectado por la falta del día siguiente", A.estadoPorAsistencia(trabajo, "2026-09-28", g, []), null);
g = asis([["2026-09-28", "ausente"], ["2026-09-29", "justificada"]]);
ok("estadoPorAsistencia: si toca dos días con estados distintos, la justificada manda", A.estadoPorAsistencia(tarea, "2026-09-28", g, []).estado, "justificada");
ok("estadoPorAsistencia: sin fecha de sesión usa la de entrega", A.estadoPorAsistencia({ id: "x", tipo: "trabajo", fecha_entrega: "2026-09-28" }, null, asis([["2026-09-28", "ausente"]]), []), { estado: "ausente", fecha: "2026-09-28" });

// sinCalificar: una calificación del docente siempre manda
ok("sinCalificar: sin fila, fila vacía, con nivel, con estado, con puntaje 0",
	[A.sinCalificar(null), A.sinCalificar({ nivel: null, estado_entrega: null, puntaje: null }), A.sinCalificar({ nivel: "logrado" }), A.sinCalificar({ estado_entrega: "justificado" }), A.sinCalificar({ puntaje: 0 })],
	[true, true, false, false, false]);

// pendientesPorFalta
const alumnosP = [{ id: "a", grado: 1, num_lista: 1, alta: null }, { id: "b", grado: 2, num_lista: 2, alta: null }];
const prodsP = [
	{ id: "t1", tipo: "trabajo", sesion_id: "s1", grados: ["1", "2"], sesion: { fecha: "2026-09-28" } },
	{ id: "ta1", tipo: "tarea", sesion_id: "s1", grados: ["1"], sesion: { fecha: "2026-09-28" } },
	{ id: "h1", tipo: "trabajo", sesion_id: "s1", grados: ["1"], es_historico: true, sesion: { fecha: "2026-09-28" } },
	{ id: "o1", tipo: "trabajo", sesion_id: "s2", grados: ["1"], sesion: { fecha: "2026-09-29" } },
];
const asisP = A.indiceAsistencias([
	{ alumno_id: "a", fecha: "2026-09-28", asistencia_estado: "justificada", updated_at: "2026-09-28T16:00:00+00:00" },
	{ alumno_id: "a", fecha: "2026-09-29", asistencia_estado: "presente", updated_at: "2026-09-29T16:00:00+00:00" },
	{ alumno_id: "b", fecha: "2026-09-28", asistencia_estado: "ausente", updated_at: "2026-09-28T16:00:00+00:00" },
]);
let pend = A.pendientesPorFalta({ alumnos: alumnosP, productos: prodsP, calificaciones: {}, asignaciones: {}, asistencias: asisP, ajustes: [] });
ok("pendientesPorFalta: lo de la sesión de ese día y la tarea, no lo histórico ni lo de otro día ni la falta sin justificar",
	pend.map((x) => x.alumno.id + ":" + x.producto.id), ["a:t1", "a:ta1"]);
ok("pendientesPorFalta: la falta, el regreso y el plazo", pend[0].fechaFalta + " " + pend[0].regreso + " " + pend[0].vence, "2026-09-28 2026-09-29 2026-10-02");
pend = A.pendientesPorFalta({ alumnos: alumnosP, productos: prodsP, calificaciones: { "a|t1": { nivel: "logrado" } }, asignaciones: {}, asistencias: asisP, ajustes: [] });
ok("pendientesPorFalta: con calificación del docente ya no es pendiente", pend.map((x) => x.producto.id), ["ta1"]);
pend = A.pendientesPorFalta({ alumnos: alumnosP, productos: prodsP, calificaciones: {}, asignaciones: { t1: { a: "excluir" } }, asistencias: asisP, ajustes: [] });
ok("pendientesPorFalta: solo lo que recibe (excluido no)", pend.map((x) => x.producto.id), ["ta1"]);
ok("pendientesPorFalta: si nadie tiene justificada, nada", A.pendientesPorFalta({ alumnos: alumnosP, productos: prodsP, calificaciones: {}, asignaciones: {}, asistencias: A.indiceAsistencias([]), ajustes: [] }), []);

// ── 3. "No entregó" en clase pasa a revisión ─────────────────────────────────
const ajC = [];
let cam = A.cambiosIncompleta("no_entregado", { hoy: "2026-09-29", ajustes: ajC });
ok("No entregó en clase: no_entregado + incompleta + revisar el siguiente día de clase", cam,
	{ estado_entrega: "no_entregado", nivel: null, estado_en_clase: "incompleta", revisar_en: "2026-09-30", completado_en: null });
ok("No entregó el viernes: se revisa el lunes", A.cambiosIncompleta("no_entregado", { hoy: "2026-10-02", ajustes: ajC }).revisar_en, "2026-10-05");
ok("No entregó en un día histórico: definitivo, sin revisión", A.cambiosIncompleta("no_entregado", { hoy: "2026-09-29", historico: true }),
	{ estado_entrega: "no_entregado", nivel: null, estado_en_clase: null, revisar_en: null, completado_en: null });
ok("La entregó + nivel: entregado, completada", A.cambiosIncompleta("completo", { hoy: "2026-09-30", nivel: "en_proceso" }),
	{ estado_entrega: "entregado", nivel: "en_proceso", estado_en_clase: "completada", completado_en: "2026-09-30" });
ok("Sigue sin entregar: sigue valiendo 0 (no pasa a incompleto)", A.cambiosIncompleta("sigue_sin_entregar", { hoy: "2026-09-30" }),
	{ estado_entrega: "no_entregado", nivel: null, estado_en_clase: "sigue_incompleta", completado_en: "2026-09-30" });
ok("Deshacer la revisión de un No entregó vuelve a No entregó pendiente", A.cambiosIncompleta("pendiente_no_entregado", {}),
	{ estado_entrega: "no_entregado", nivel: null, estado_en_clase: "incompleta", completado_en: null });
ok("Incompleta sigue igual", A.cambiosIncompleta("marcar", { hoy: "2026-09-29", ajustes: ajC }).estado_entrega, "incompleto");
ok("un No entregó pendiente toca revisar el día que llega", A.tocaRevisar({ estado_en_clase: "incompleta", revisar_en: "2026-09-30" }, "2026-09-30"), true);
{
	const h = leer("js/hoy.js");
	ok("Hoy: el chip No entregó de la clase usa cambiosIncompleta(\"no_entregado\")", /cambiosIncompleta\("no_entregado", \{ hoy: hoy, ajustes: ajustesCal,/.test(h), true);
	ok("Hoy: la revisión ofrece «La entregó» y «Sigue sin entregar»", /La entregó:/.test(h) && /data-accion='sigue_sin_entregar'/.test(h) && /Sigue sin entregar/.test(h), true);
	ok("Hoy: la tarea de «Tareas por revisar» sigue con su No entregó definitivo (ya venció)", /ENTREGA_TAREA = \[[\s\S]{0,400}valor: "no_entregado"/.test(h) && !/data-tarea[^\n]{0,200}cambiosIncompleta\("no_entregado"/.test(h), true);
}

// ── 4. El motor: falta sin justificar = No entregó ───────────────────────────
function fabricarSb(datos) {
	function consulta(tabla) {
		const q = {
			select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
			range() { return Promise.resolve({ data: datos[tabla] || [], error: null }); },
			maybeSingle() { return Promise.resolve({ data: null, error: null }); },
			then(a, b) { return Promise.resolve({ data: datos[tabla] || [], error: null }).then(a, b); },
		};
		return q;
	}
	return { from: consulta, rpc(n, args) { return Promise.resolve({ data: args.p_porcentajes.map(() => 8), error: null }); } };
}
const BASE = () => ({
	maestro_ajustes: [],
	grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }],
	proyectos: [{ id: "proy" }],
	sesiones: [
		{ id: "s1", fecha: "2026-09-28", campo_formativo: "Lenguajes" },
		{ id: "s2", fecha: "2026-09-29", campo_formativo: "Lenguajes" },
		{ id: "s3", fecha: "2026-09-30", campo_formativo: "Lenguajes" },
	],
	productos_sesion: [
		{ id: "p1", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["1"], fecha_entrega: null, activo: true, es_historico: false, created_at: "2026-09-28T16:00:00+00:00" },
		{ id: "p2", sesion_id: "s2", tipo: "trabajo", campo: "LEN", grados: ["1"], fecha_entrega: null, activo: true, es_historico: false, created_at: "2026-09-29T16:00:00+00:00" },
		{ id: "p3", sesion_id: "s3", tipo: "trabajo", campo: "LEN", grados: ["1"], fecha_entrega: null, activo: true, es_historico: false, created_at: "2026-09-30T16:00:00+00:00" },
	],
	calificaciones: [], registro_diario: [], examenes: [], alumnos: [],
	asistencias: [], calendario_ajustes: [],
});
async function motor(datos, alumnos, detalle) {
	return M.cargarYCalcularGrupo(fabricarSb(datos), { maestroId: "m", grupoId: "g", trimestre: 1, alumnos: alumnos, detalle: !!detalle });
}
const pc = (r, id) => r.porAlumno[id].porCampo.LEN;
const califs = (id, lista) => lista.map((x) => ({ alumno_id: id, producto_sesion_id: x[0], estado_entrega: x[1], nivel: x[2] || null, puntaje: null, tipo: "trabajo", proyecto_id: "proy", fecha: "2026-09-29" }));
const fila = (fecha, estado, upd) => ({ alumno_id: "x", fecha: fecha, asistencia_estado: estado, updated_at: upd || (fecha + "T16:00:00+00:00") });

(async () => {
	const alumnos = [{ id: "x", grado: 1, created_at: "2026-08-01T15:00:00+00:00" }, { id: "y", grado: 1, created_at: "2026-08-01T15:00:00+00:00" }];
	// Antes (nadie falta): x logró p2 y p3 → 100 %
	let d = BASE();
	d.calificaciones = califs("x", [["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	let r = await motor(d, alumnos);
	ok("sin faltas: p1 sin calificar no cuenta (como siempre) → 100 %", pc(r, "x").porcentaje, 100);

	// Falta sin justificar el 28: p1 vale 0 → 2 de 3
	d = BASE();
	d.calificaciones = califs("x", [["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	d.asistencias = [fila("2026-09-28", "ausente"), fila("2026-09-29", "presente")];
	r = await motor(d, alumnos);
	ok("Falta sin justificar: lo de ese día vale No entregó (0): 2 de 3", Math.round(pc(r, "x").rubros.trabajos.fraccion * 1000) / 1000, 0.667);
	ok("Falta: cuenta como no entregado en la entrega del rubro", pc(r, "x").rubros.trabajos.entrega.esperados + "/" + pc(r, "x").rubros.trabajos.entrega.entregados, "3/2");
	ok("Falta: el otro alumno (sin faltas) no cambia", pc(r, "y").porcentaje, null);

	// Justificada: no cuenta mientras esté pendiente
	d.asistencias = [fila("2026-09-28", "justificada"), fila("2026-09-29", "presente")];
	r = await motor(d, alumnos);
	ok("Justificada: lo pendiente no cuenta (queda 100 %)", pc(r, "x").porcentaje, 100);

	// Una calificación del docente siempre manda
	d.asistencias = [fila("2026-09-28", "ausente")];
	d.calificaciones = califs("x", [["p1", "entregado", "logrado"], ["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	r = await motor(d, alumnos);
	ok("Con Falta pero con calificación del docente: manda la calificación (100 %)", pc(r, "x").porcentaje, 100);
	d.calificaciones = califs("x", [["p1", "justificado"], ["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	r = await motor(d, alumnos);
	ok("Con Falta pero el docente lo marcó Justificado: sigue fuera del máximo (100 %)", pc(r, "x").porcentaje, 100);

	// Histórico: no se deriva
	d = BASE();
	d.productos_sesion[0].es_historico = true;
	d.calificaciones = califs("x", [["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	d.asistencias = [fila("2026-09-28", "ausente")];
	r = await motor(d, alumnos);
	ok("Lo histórico (Ponte al día) no se deriva de la falta", pc(r, "x").porcentaje, 100);

	// La tarea que vencía el día de la falta
	d = BASE();
	d.productos_sesion[0].tipo = "tarea";
	d.calificaciones = califs("x", [["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	d.asistencias = [fila("2026-09-28", "presente"), fila("2026-09-29", "ausente")]; // vence el 29: falta ese día
	r = await motor(d, alumnos);
	ok("La tarea que vencía el día de la falta sin justificar vale 0 (tareas: 0 de 1)", pc(r, "x").rubros.tareas.fraccion, 0);

	// Detalle para Qué le falta
	d = BASE();
	d.calificaciones = califs("x", [["p2", "entregado", "logrado"], ["p3", "entregado", "logrado"]]);
	d.asistencias = [fila("2026-09-28", "justificada"), fila("2026-09-29", "presente"), fila("2026-09-30", "presente")];
	r = await motor(d, alumnos, true);
	ok("detalle.porFalta: justificada con su regreso y su plazo", r.porAlumno.x.detalle.porFalta.p1, { estado: "justificada", fecha: "2026-09-28", regreso: "2026-09-29", vence: "2026-10-02" });
	ok("detalle.calificaciones NO trae la calificación derivada", Object.keys(r.porAlumno.x.detalle.calificaciones).sort(), ["p2", "p3"]);

	// La asistencia de referencia sigue contando solo el rango de las sesiones
	d.asistencias = [fila("2026-09-28", "presente"), fila("2026-09-30", "ausente"), fila("2026-10-05", "presente")];
	r = await motor(d, alumnos);
	ok("asistencia de referencia: no cuenta lo posterior a la última sesión", r.porAlumno.x.asistencia.total, 2);

	// ── Qué le falta con lo derivado ──
	const Q = require("../js/que-le-falta.js");
	const det = (porFalta) => ({ sesiones: [{ id: "s1", numero_sesion: 1, fecha: "2026-09-28", campo_formativo: "Lenguajes", sesiones_pda: [] }],
		productos: [{ id: "p1", sesion_id: "s1", tipo: "trabajo", campo: "LEN", nombre: "Cartel", orden: 1 }], calificaciones: {}, alta: null, porFalta: porFalta });
	let q = Q.calcular({ alumno: { id: "x", grado: 1 }, porCampo: {}, detalle: det({ p1: { estado: "ausente", fecha: "2026-09-28" } }), avancePda: [], calificacion: {}, hoy: "2026-09-30" });
	ok("Qué le falta: la falta sin justificar es «Entregar…: faltó ese día»", q.campos.LEN.productos[0].estado + " | " + Q.frases(q.campos.LEN).filter((f) => f.tipo !== "sin_evidencias")[0].texto,
		"no_entregado | Entregar «Cartel» (sesión 1): faltó ese día (28 de septiembre).");
	q = Q.calcular({ alumno: { id: "x", grado: 1 }, porCampo: {}, detalle: det({ p1: { estado: "justificada", fecha: "2026-09-28", regreso: "2026-09-29", vence: "2026-10-02" } }), avancePda: [], calificacion: {}, hoy: "2026-09-30" });
	ok("Qué le falta: la justificada con su plazo, y es pendiente del alumno (no «por revisar»)", q.campos.LEN.productos.length + " " + q.campos.LEN.porRevisar.length + " | " + Q.frases(q.campos.LEN).filter((f) => f.tipo !== "sin_evidencias")[0].texto,
		"1 0 | Entregar «Cartel» (sesión 1): faltó el 28 de septiembre con justificante; entrega a más tardar el viernes 2 de octubre.");
	q = Q.calcular({ alumno: { id: "x", grado: 1 }, porCampo: {}, detalle: det({ p1: { estado: "justificada", fecha: "2026-09-28", regreso: "2026-09-29", vence: "2026-10-02" } }), avancePda: [], calificacion: {}, hoy: "2026-10-05" });
	ok("Qué le falta: plazo vencido sigue pendiente («el plazo era…»)", Q.frases(q.campos.LEN).filter((f) => f.tipo !== "sin_evidencias")[0].texto, "Entregar «Cartel» (sesión 1): faltó el 28 de septiembre con justificante; el plazo era el viernes 2 de octubre.");
	q = Q.calcular({ alumno: { id: "x", grado: 1 }, porCampo: {}, detalle: det({ p1: { estado: "justificada", fecha: "2026-09-28", regreso: null, vence: null } }), avancePda: [], calificacion: {}, hoy: "2026-09-30" });
	ok("Qué le falta: aún no regresa", Q.frases(q.campos.LEN).filter((f) => f.tipo !== "sin_evidencias")[0].texto, "Entregar «Cartel» (sesión 1): faltó el 28 de septiembre con justificante; se entrega a su regreso, con 3 días de clase.");

	// ── 5. Terminar sesión: enCurso y su corte ──
	ok("CORTE_EN_CURSO es el miércoles 30 sep (primer día de clase después de publicar)", ST.CORTE_EN_CURSO + " " + C.diaSemana(ST.CORTE_EN_CURSO), "2026-09-30 3");
	ok("enCurso: sesión con fecha del corte y sin terminar", ST.enCurso({ fecha: "2026-09-30", estado_sesion: "activa" }), true);
	ok("enCurso: las anteriores al corte cuentan como terminadas (no se escribe nada)", ST.enCurso({ fecha: "2026-09-29", estado_sesion: "activa" }), false);
	ok("enCurso: la completada no", ST.enCurso({ fecha: "2026-10-01", estado_sesion: "completada" }), false);
	ok("enCurso: sin fecha no se ha empezado", ST.enCurso({ fecha: null, estado_sesion: "pendiente" }), false);
	ok("enCurso: con otro corte", ST.enCurso({ fecha: "2026-09-29", estado_sesion: "activa" }, "2026-09-28"), true);
	const ses = [
		{ id: "a", proyecto_id: "p", numero_sesion: 5, fecha: "2026-10-01", estado_sesion: "activa" },
		{ id: "b", proyecto_id: "p", numero_sesion: 4, fecha: "2026-09-30", estado_sesion: "activa" },
		{ id: "c", proyecto_id: "q", numero_sesion: 1, fecha: "2026-10-01", estado_sesion: "completada" },
		{ id: "d", proyecto_id: "p", numero_sesion: 6, fecha: null, estado_sesion: "pendiente" },
	];
	ok("enCursoDe: por proyecto y por número", ST.enCursoDe(ses, "p").map((s) => s.id), ["b", "a"]);
	ok("bloqueaSiguiente: el proyecto con una sesión sin terminar sí, el otro no", [ST.bloqueaSiguiente(ses, "p"), ST.bloqueaSiguiente(ses, "q")], [true, false]);
	ok("etiquetaEmpezo: «Empezó el 29 sep» solo de un día anterior", [ST.etiquetaEmpezo("2026-09-29", "2026-10-01"), ST.etiquetaEmpezo("2026-10-01", "2026-10-01"), ST.etiquetaEmpezo(null, "2026-10-01")], ["Empezó el 29 sep", "", ""]);
	ok("textoSinCalificar", [ST.textoSinCalificar(0), ST.textoSinCalificar(1), ST.textoSinCalificar(3), ST.textoSinCalificar(null)],
		["Todo lo de esta sesión está calificado.", "Queda 1 sin calificar. Puedes terminar la sesión y calificarlas después.", "Quedan 3 sin calificar. Puedes terminar la sesión y calificarlas después.", ""]);
	// terminar(): marca completada y, si ya no quedan, completa el proyecto
	const escrito = [], filtros = [];
	function sbT(quedan) {
		return { from(t) {
			const q = {
				update(x) { escrito.push([t, x]); return q; }, select() { return q; }, eq() { return q; }, neq() { return q; }, is() { return q; }, upsert(x) { escrito.push([t, x]); return q; }, or(f) { filtros.push(f); return q; },
				then(a, b) { return Promise.resolve(t === "sesiones" && escrito.length && !q.contando ? { error: null, data: null, count: quedan } : { error: null, count: quedan }).then(a, b); },
			};
			return q;
		} };
	}
	// Fase 5b: terminar también escribe terminada_en, el día de las actividades sin día y el día cerrado (sesion_dias);
	// estas aserciones miran lo de siempre (sesión y proyecto) y abajo se prueba lo nuevo
	const deSesion = () => escrito.filter((e) => e[0] === "sesiones" || e[0] === "proyectos");
	let t = await ST.terminar(sbT(0), { sesionId: "s", notas: "n", proyectoId: "p", maestroId: "m", hoy: "2026-10-01" });
	ok("terminar (5b): escribe terminada_en, el día de las actividades sin día y el día cerrado",
		[escrito.map((e) => e[0]), escrito[0][1].terminada_en, escrito[1][1].fecha_trabajo, escrito[2][1].fecha, !!escrito[2][1].cerrado_en],
		[["sesiones", "productos_sesion", "sesion_dias", "proyectos"], "2026-10-01", "2026-10-01", "2026-10-01", true]);
	ok("terminar (5b): el último día trabajado que se eligió (dia) manda sobre hoy", await (async () => {
		escrito.length = 0;
		await ST.terminar(sbT(2), { sesionId: "s", notas: "", proyectoId: "p", maestroId: "m", hoy: "2026-10-06", dia: "2026-10-02" });
		const r = [escrito[0][1].terminada_en, escrito[1][1].fecha_trabajo, escrito[2][1].fecha];
		escrito.length = 0;
		await ST.terminar(sbT(0), { sesionId: "s", notas: "n", proyectoId: "p", maestroId: "m", hoy: "2026-10-01" });
		return r;
	})(), ["2026-10-02", "2026-10-02", "2026-10-02"]);
	ok("terminar: sin sesiones por trabajar, el proyecto pasa a completado", [t.proyectoCompletado, deSesion().map((e) => e[0] + ":" + (e[1].estado_sesion || e[1].estado))], [true, ["sesiones:completada", "proyectos:completado"]]);
	escrito.length = 0;
	t = await ST.terminar(sbT(2), { sesionId: "s", notas: "", proyectoId: "p", maestroId: "m", hoy: "2026-10-01" });
	ok("terminar: si quedan sesiones, el proyecto no se toca", [t.proyectoCompletado, deSesion().map((e) => e[0])], [false, ["sesiones"]]);

	ok("terminar: la cuenta de sesiones por terminar excluye las anteriores al corte (activas de Fanny) sin escribir en ellas", [filtros[0], deSesion().every((e) => e[1].estado_sesion === "completada" || e[1].estado === "completado")], ["fecha.is.null,fecha.gte.2026-09-30", true]);

	// Hoy usa el módulo
	const h = leer("js/hoy.js"), hh = leer("hoy.html");
	ok("Hoy: botón «Terminar sesión N» al pie, espera la cola y abre la tarjeta azul", /data-terminar-sesion=/.test(h) && /await bandeja\.esperarEnvio\(\)/.test(h) && /"#siguientes"/.test(h) && /id='siguientes'/.test(h), true);
	ok("Hoy: una sesión en curso muestra «Empezó el…» y bloquea la siguiente", /data-empezo/.test(h) && /enCursoDe\(todasLasSesiones/.test(h) && /data-bloqueo-siguiente/.test(h), true);
	ok("Hoy e Inicio cargan sesion-terminar.js y visor-recursos.js antes de su script",
		hh.indexOf("js/sesion-terminar.js") < hh.indexOf('src="js/hoy.js"') && hh.indexOf("js/visor-recursos.js") < hh.indexOf('src="js/hoy.js"') &&
		leer("dashboard.html").indexOf("js/sesion-terminar.js") < leer("dashboard.html").indexOf("js/dashboard.js") && leer("dashboard.html").indexOf("js/visor-recursos.js") < leer("dashboard.html").indexOf("js/dashboard.js"), true);
	ok("Inicio: «Trabajar hoy» solo sobre la siguiente y sin sesión sin terminar", /const sinTerminar = visibles\.some/.test(leer("js/dashboard.js")) && /if \(!sinTerminar && siguiente\)/.test(leer("js/dashboard.js")), true);
	ok("Hoy: la tarjeta Pendientes tiene los dos bloques", /id="pendientesClase"/.test(hh) && /De la clase anterior/.test(hh) && /id="pendientesFalta"/.test(hh) && /Por falta justificada/.test(hh), true);
	ok("Hoy: lee las asistencias como lectura opcional y las índices con AlcanceHoy", /leerAsistencias\(window\.sb, user\.id, grupo\.id/.test(h) && /lectura-opcional: solo alimenta "Por falta justificada"/.test(h), true);

	// ── 6. Visor: urlEmbebible ──
	const u = V.urlEmbebible;
	// Constructor AX (Jorge, 2026-09-29): Drive ya no se abre en el visor, va en otra pestaña (más casos en
	// pruebas/recursos-solo-enlaces.test.js)
	ok("Drive: archivo → otra pestaña, sin visor", u("https://drive.google.com/file/d/1t7XZhp0TOeHCeHod_wpo1HVAZUVtm2Hu/view?usp=sharing"),
		{ tipo: "otro", src: null, embebible: false, aparte: "https://drive.google.com/file/d/1t7XZhp0TOeHCeHod_wpo1HVAZUVtm2Hu/view?usp=sharing" });
	ok("Drive: carpeta, open?id= y Google Docs → otra pestaña", ["https://drive.google.com/drive/folders/1Nx6kmHq4J_NmIxmaSbt9riMYiEUaSz-t", "https://drive.google.com/open?id=XYZ123", "https://docs.google.com/document/d/DOC1/edit"].map((x) => u(x).embebible), [false, false, false]);
	ok("CONALITEG se abre dentro por https y conserva la página", u("http://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100"),
		{ tipo: "libro", src: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", embebible: true, aparte: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100" });
	ok("otro sitio: no embebible (se abre en otra pestaña)", [u("https://ejemplo.com/a.pdf").embebible, u("https://ejemplo.com/a.pdf").aparte], [false, "https://ejemplo.com/a.pdf"]);
	ok("esquemas raros: ni se abren", [u("javascript:alert(1)"), u("data:text/html,x"), u("")].map((x) => x.embebible + "/" + x.aparte), ["false/null", "false/null", "false/null"]);
	ok("un dominio parecido a CONALITEG no cuenta", u("https://conaliteg.gob.mx.evil.com/x").embebible, false);
	ok("el visor espera 8 s antes de decir «¿No se ve? Ábrelo aparte»", V.ESPERA_MS, 8000);
	const vs = leer("js/visor-recursos.js");
	ok("visor: «Abrir aparte», «Cerrar», «¿No se ve? …», desde 1024 px dividido y abajo pantalla completa",
		/Abrir aparte/.test(vs) && /data-visor-cerrar/.test(vs) && /¿No se ve\? <a[^>]*>Ábrelo aparte/.test(vs) && /@media \(min-width:1024px\)/.test(vs) && /inset:0;z-index:60/.test(vs), true);
	ok("visor: botones de 44 px y sin emojis", /min-height:44px/.test(vs) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(vs), true);

	// ── 7. Enlaces a libros dentro del texto ──
	const sesion1 = {
		inicio_todos: "El docente muestra la página \"El origen de las letras\" de Múltiples Lenguajes de 1° (p. 100) y pregunta. Escribe en la página \"Mi nombre completo\" de Trazos y palabras de 2° (p. 6) su nombre. Otra de Nuestros Saberes de 2° (p. 105).",
		recursos: { links: [
			{ url: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", nombre: "El origen de las letras — Múltiples Lenguajes 1°, p.100" },
			{ url: "https://libros.conaliteg.gob.mx/2025/P2TPA.htm#page/6", nombre: "Mi nombre completo — Múltiples Lenguajes: Trazos y palabras 2°, p.6" },
		] },
	};
	let hs = S.html(sesion1);
	ok("libros: la mención enlaza cuando la sesión trae ese libro y la página coincide (2 de 3 menciones)", (hs.match(/data-secuencia-libro/g) || []).length, 2);
	ok("libros: el enlace lleva a su página y abre el visor", /href='https:\/\/libros\.conaliteg\.gob\.mx\/2025\/P1MLA\.htm#page\/100'[^>]*data-visor-url='https:\/\/libros\.conaliteg\.gob\.mx\/2025\/P1MLA\.htm#page\/100'[^>]*>Múltiples Lenguajes de 1° \(p\. 100\)<\/a>/.test(hs), true);
	ok("libros: «Trazos y palabras de 2° (p. 6)» enlaza al libro «Trazos y palabras»", /P2TPA\.htm#page\/6'[^>]*>Trazos y palabras de 2° \(p\. 6\)<\/a>/.test(hs), true);
	ok("libros: sin libro en los enlaces, la mención queda como texto", hs.indexOf(">Nuestros Saberes de 2° (p. 105)<") === -1 && hs.indexOf("Nuestros Saberes de 2° (p. 105)") !== -1, true);
	const sesionMal = JSON.parse(JSON.stringify(sesion1));
	sesionMal.recursos.links[0].url = "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/101"; // otra página
	ok("libros: si la página del enlace no coincide, no se enlaza", (S.html(sesionMal).match(/data-secuencia-libro/g) || []).length, 1);
	const sesionOtroGrado = JSON.parse(JSON.stringify(sesion1));
	sesionOtroGrado.recursos.links[0].nombre = "El origen de las letras — Múltiples Lenguajes 2°, p.100";
	ok("libros: si el grado no coincide, no se enlaza", (S.html(sesionOtroGrado).match(/data-secuencia-libro/g) || []).length, 1);
	ok("libros: los anexos y libros de «Anexos y libros» también abren el visor", /data-secuencia-enlace='libro'[^>]*data-visor-url=/.test(hs), true);
	ok("libros: un texto con HTML se sigue escapando", S.html({ inicio_todos: "<b>x</b> Múltiples Lenguajes de 1° (p. 100)", recursos: sesion1.recursos }).indexOf("<b>x</b>"), -1);

	// ── 8. R33: el motor NO depende de una global opcional; una sola respuesta por alumno en todas las pantallas ──
	{
		const raiz = path.join(__dirname, "..");
		fs.readdirSync(raiz).filter((f) => f.endsWith(".html")).forEach((f) => {
			const html = fs.readFileSync(path.join(raiz, f), "utf8");
			const motorPos = html.indexOf("js/motor-calificacion.js");
			if (motorPos === -1) return;
			const cal = html.indexOf("js/calendario-sep.js"), alc = html.indexOf("js/alcance-hoy.js"), cam = html.indexOf("js/campos-formativos.js");
			ok(f + ": carga campos-formativos.js, calendario-sep.js y alcance-hoy.js antes del motor", cam !== -1 && cal !== -1 && alc !== -1 && cam < motorPos && cal < alc && alc < motorPos, true);
		});
		// Sin calendario (en el navegador sin el script; aquí, un contexto sin require) el motor FALLA a la vista
		const vm = require("vm");
		const ctx = { window: {}, console: console, Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, Promise: Promise, Number: Number, String: String, Error: Error };
		vm.createContext(ctx);
		vm.runInContext(leer("js/campos-formativos.js"), ctx);
		vm.runInContext(leer("js/alcance-hoy.js"), ctx);
		vm.runInContext(leer("js/motor-calificacion.js"), ctx);
		ok("sin CalendarioSEP AlcanceHoy.calendarioDisponible() es falso", ctx.window.AlcanceHoy.calendarioDisponible(), false);
		let mensajeError = null;
		try { await ctx.window.MotorCalificacion.cargarYCalcularGrupo(fabricarSb(BASE()), { maestroId: "m", grupoId: "g", trimestre: 1, alumnos: [{ id: "x", grado: 1 }] }); } catch (e) { mensajeError = e.message; }
		ok("sin calendario el motor lanza un error que lo dice (no calcula otra cosa)", /falta js\/calendario-sep\.js/.test(mensajeError || ""), true);
		ok("con el calendario disponible el motor calcula", (await motor(BASE(), [{ id: "x", grado: 1, created_at: "2026-08-01T15:00:00+00:00" }])).sinProyectos, false);
	}

	// ── 9. R33: correcciones de la Fase 2 ──
	{
		const hj = leer("js/hoy.js"), vs2 = leer("js/visor-recursos.js");
		ok("deshacer «La entregó»: tocar el mismo nivel ya no escribe (no pierde el origen)", /if \(accion === "completo" && yaEsa\) return;/.test(hj), true);
		ok("la tarjeta azul se vuelve a poner a la vista tras la recarga (scroll manual y reintentos)", /scrollRestoration = "manual"/.test(hj) && /\[250, 900\]\.forEach/.test(hj), true);
		ok("tocar el chip de asistencia ya activo no escribe nada", /if \(asistencia\[alumnoId\] === btn\.dataset\.valor\) return;/.test(hj), true);
		ok("tocar el valor del Cierre ya guardado no escribe nada", /if \(registroGuardado\[alumnoId\] && actual\[btn\.dataset\.cierre\] === Number\(btn\.dataset\.valor\)\) return;/.test(hj), true);
		// Constructor AX (2026-09-29): el visor ya solo abre libros; el aviso sale si a los 8 s no cargó
		ok("visor: el aviso «¿No se ve?» sale solo si el libro no cargó y avisa que Esc no funciona dentro del libro", /aviso\.hidden = true;/.test(vs2) && !/esDrive/.test(vs2) && /Esc solo funciona fuera del libro/.test(vs2), true);
	}

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
