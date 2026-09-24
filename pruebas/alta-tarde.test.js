/*
	Alumno dado de alta tarde (decisión de Jorge 10, 2026-09-24), de punta a punta en el
	motor de calificación: para ese alumno solo cuentan las tareas y productos con fecha
	desde su alta (js/alcance-hoy.js), también en su calificación. Los demás no cambian,
	una evidencia fechada antes del alta no se pierde y quien nació con su grupo (la
	semilla QA crea grupo y alumnos en el mismo instante) no es "de alta tarde".

	Además vigila que toda página que carga el motor cargue antes js/alcance-hoy.js: sin
	él, el motor calcula sin la regla (y lo avisa en consola).

	node pruebas/alta-tarde.test.js
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

global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
const M = require("../js/motor-calificacion.js");

// ── Supabase falso: devuelve la tabla completa; el motor filtra por alumno ──────────
const DATOS = {
	maestro_ajustes: [],
	grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }],
	proyectos: [{ id: "proy" }],
	sesiones: [
		{ id: "s-vieja", fecha: "2026-09-10", campo_formativo: "Lenguajes" },
		{ id: "s-hoy", fecha: "2026-09-24", campo_formativo: "Lenguajes" },
	],
	productos_sesion: [
		{ id: "t-vieja", sesion_id: "s-vieja", tipo: "tarea", campo: "LEN", grados: ["3"], fecha_entrega: "2026-09-11", activo: true },
		{ id: "t-hoy", sesion_id: "s-hoy", tipo: "tarea", campo: "LEN", grados: ["3"], fecha_entrega: null, activo: true },
	],
	calificaciones: [
		// Alumno de siempre: entregó la vieja, no entregó la de hoy → 1 de 2
		{ alumno_id: "siempre", producto_sesion_id: "t-vieja", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-11" },
		{ alumno_id: "siempre", producto_sesion_id: "t-hoy", estado_entrega: "no_entregado", fecha: "2026-09-24" },
		// Alumno nuevo (alta el 24): le marcaron "no entregó" la vieja el mismo día de su alta
		{ alumno_id: "nuevo", producto_sesion_id: "t-vieja", estado_entrega: "no_entregado", fecha: "2026-09-24" },
		{ alumno_id: "nuevo", producto_sesion_id: "t-hoy", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-24" },
		// Alumno sembrado (creado el 24, con evidencia fechada el 11): la evidencia cuenta
		{ alumno_id: "sembrado", producto_sesion_id: "t-vieja", estado_entrega: "no_entregado", fecha: "2026-09-11" },
		{ alumno_id: "sembrado", producto_sesion_id: "t-hoy", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-24" },
	].map((c) => Object.assign({ tipo: "tarea", proyecto_id: "proy" }, c)),
	registro_diario: [],
	asistencias: [],
	examenes: [],
	alumnos: [
		{ id: "siempre", created_at: "2026-08-20T15:00:00+00:00" },
		{ id: "nuevo", created_at: "2026-09-24T16:00:00+00:00" },
		{ id: "sembrado", created_at: "2026-09-24T16:00:00+00:00" },
	],
};
const leidas = [];
function consulta(tabla) {
	leidas.push(tabla);
	const q = {
		select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
		range() { return Promise.resolve({ data: DATOS[tabla] || [], error: null }); },
		maybeSingle() { return Promise.resolve({ data: null, error: null }); },
		then(ok_, err) { return Promise.resolve({ data: DATOS[tabla] || [], error: null }).then(ok_, err); },
	};
	return q;
}
const sb = {
	from: consulta,
	rpc(nombre, args) { return Promise.resolve({ data: args.p_porcentajes.map(() => 8), error: null }); },
};

(async () => {
	const ctx = {
		maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN"],
		alumnos: [{ id: "siempre", grado: 3 }, { id: "nuevo", grado: 3 }, { id: "sembrado", grado: 3 }],
	};
	const r = await M.cargarYCalcularGrupo(sb, ctx);
	const tareas = (id) => { const x = r.porAlumno[id].porCampo.LEN.rubros.tareas; return x.obtenido + "/" + x.maximo; };
	ok("sin created_at en el contexto, el motor lo lee de alumnos", leidas.indexOf("alumnos") !== -1, true);
	ok("alumno de siempre: cuentan las dos tareas (1 de 2)", tareas("siempre"), "1/2");
	ok("alumno nuevo: la tarea de antes de su alta no cuenta (1 de 1)", tareas("nuevo"), "1/1");
	ok("alumno nuevo: no pierde calificación por ella (100 %)", r.porAlumno.nuevo.porCampo.LEN.porcentaje, 100);
	ok("alumno sembrado: su evidencia fechada antes del alta sí cuenta (1 de 2)", tareas("sembrado"), "1/2");

	// Con created_at en el contexto no se vuelve a leer la tabla
	leidas.length = 0;
	const r2 = await M.cargarYCalcularGrupo(sb, Object.assign({}, ctx, {
		alumnos: [{ id: "nuevo", grado: 3, created_at: "2026-09-24T16:00:00+00:00" }],
	}));
	ok("con created_at en el contexto no lee alumnos", leidas.indexOf("alumnos"), -1);
	ok("y aplica la misma regla", r2.porAlumno.nuevo.porCampo.LEN.rubros.tareas.maximo, 1);

	// Alumnos que nacieron con el grupo (la semilla QA crea grupo y alumnos en el mismo
	// instante): no son "de alta tarde" y les cuenta todo, aunque no haya evidencia
	DATOS.grupos = [{ id: "g", created_at: "2026-09-24T16:00:00+00:00" }];
	const r3 = await M.cargarYCalcularGrupo(sb, ctx);
	ok("nació con el grupo: la tarea vieja sí cuenta (1 de 2)", r3.porAlumno.nuevo.porCampo.LEN.rubros.tareas.obtenido + "/" + r3.porAlumno.nuevo.porCampo.LEN.rubros.tareas.maximo, "1/2");
	DATOS.grupos = [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }];

	// Un solo alumno (boleta, reporte): mismo camino
	const uno = await M.cargarYCalcular(sb, { maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN"], alumnoId: "nuevo", grado: 3 });
	ok("cargarYCalcular (un alumno) aplica la regla", uno.porCampo.LEN.rubros.tareas.maximo, 1);

	// ── Toda página con el motor carga antes js/alcance-hoy.js ──────────────────
	const raiz = path.join(__dirname, "..");
	fs.readdirSync(raiz).filter((f) => f.endsWith(".html")).forEach((f) => {
		const html = fs.readFileSync(path.join(raiz, f), "utf8");
		const motor = html.indexOf("js/motor-calificacion.js");
		if (motor === -1) return;
		const alcance = html.indexOf("js/alcance-hoy.js");
		ok(f + ": carga js/alcance-hoy.js antes del motor", alcance !== -1 && alcance < motor, true);
	});

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
