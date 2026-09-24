/*
	Alcance de "Hoy" (js/alcance-hoy.js, bloque 3.7): qué proyectos mira la captura del día.

	Al terminar la última sesión, Inicio pasa el proyecto a "completado"; su tarea y sus
	productos pendientes deben seguir en "Hoy" (antes desaparecían y Tareas los pedía para
	siempre). Tareas usa la misma regla para decidir si ofrece "Revisar en Hoy".

	node pruebas/alcance-hoy.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const A = require("../js/alcance-hoy.js");
const HOY = "2026-09-23";
const grupo = { trimestre_actual: 1 };

ok("filtro PostgREST", A.filtro(grupo, HOY), "estado.in.(activo,borrador,pausado),fecha_final.gte.2026-08-24,trimestre.eq.1");
ok("sin trimestre actual, sin esa condición", A.filtro({}, HOY), "estado.in.(activo,borrador,pausado),fecha_final.gte.2026-08-24");

ok("activo entra", A.incluye({ estado: "activo", trimestre: 2 }, grupo, HOY), true);
ok("borrador entra", A.incluye({ estado: "borrador" }, grupo, HOY), true);
ok("pausado entra (sus tareas pendientes siguen a la vista)", A.incluye({ estado: "pausado" }, grupo, HOY), true);
ok("recién completado (hoy) entra aunque sea de otro trimestre", A.incluye({ estado: "completado", trimestre: 3, fecha_final: HOY }, grupo, HOY), true);
ok("completado del trimestre actual entra aunque sea viejo", A.incluye({ estado: "completado", trimestre: 1, fecha_final: "2026-01-10" }, grupo, HOY), true);
ok("completado viejo de otro trimestre no entra", A.incluye({ estado: "completado", trimestre: 2, fecha_final: "2026-05-01" }, grupo, HOY), false);
ok("completado sin fecha_final de otro trimestre no entra", A.incluye({ estado: "completado", trimestre: 2 }, grupo, HOY), false);
ok("límite: justo 30 días atrás entra", A.incluye({ estado: "completado", trimestre: 2, fecha_final: "2026-08-24" }, grupo, HOY), true);

// ── Cierre del día: la misma cuenta en "Hoy" e Inicio ────────────────────────
ok("nadie ha guardado", A.resumenCierre(18, 18, 0), { nadieAsistio: false, completo: false, conteo: "0 de 18", sinContar: "" });
ok("completo sin faltas", A.resumenCierre(18, 18, 18).completo, true);
ok("con una falta: completo al guardar a los 17", A.resumenCierre(18, 17, 17), { nadieAsistio: false, completo: true, conteo: "17 de 17", sinContar: " (sin contar 1 que faltó)" });
ok("con varias faltas, en plural", A.resumenCierre(18, 15, 3).sinContar, " (sin contar 3 que faltaron)");
ok("faltó todo el grupo: no hay nada que cerrar y cuenta como cerrado",
	A.resumenCierre(18, 0, 0), { nadieAsistio: true, completo: true, conteo: "0 de 0", sinContar: " (sin contar 18 que faltaron)" });
ok("grupo sin alumnos: no se da por cerrado", A.resumenCierre(0, 0, 0).completo, false);

// ── Lecturas sin el tope de 1000 filas de Supabase ───────────────────────────
// Consulta falsa con el comportamiento de PostgREST: .in() filtra y .range() corta a
// lo pedido, nunca más de 1000 filas por respuesta.
function tablaFalsa(filas, registro) {
	return function (lote) {
		const q = {
			range(desde, hasta) {
				registro.push({ lote: lote.length, desde, hasta });
				const de = filas.filter((f) => lote.indexOf(f.producto) !== -1);
				return Promise.resolve({ data: de.slice(desde, Math.min(hasta + 1, desde + 1000)), error: null });
			},
		};
		return q;
	};
}

(async () => {
	// 60 productos × 18 alumnos = 1080 calificaciones: sin paginar se perdían 80
	const productos = Array.from({ length: 60 }, (_, i) => "p" + i);
	const filas = [];
	productos.forEach((p) => { for (let a = 0; a < 18; a++) filas.push({ producto: p, alumno: a }); });
	let registro = [];
	let leidas = await A.leerPorLotes(productos, tablaFalsa(filas, registro));
	ok("un trimestre con 1080 calificaciones: se leen todas", leidas.length, 1080);
	ok("en dos páginas", registro.map((r) => r.desde), [0, 1000]);

	// 400 productos: los ids se parten en lotes (la lista viaja en la URL)
	const muchos = Array.from({ length: 400 }, (_, i) => "q" + i);
	const filas2 = [];
	muchos.forEach((p) => { for (let a = 0; a < 18; a++) filas2.push({ producto: p, alumno: a }); });
	registro = [];
	leidas = await A.leerPorLotes(muchos, tablaFalsa(filas2, registro));
	ok("400 productos × 18: se leen las 7200", leidas.length, 7200);
	ok("ningún lote pasa de " + A.LOTE + " ids", registro.every((r) => r.lote <= A.LOTE), true);
	ok("sin duplicados", new Set(leidas.map((f) => f.producto + "|" + f.alumno)).size, 7200);

	registro = [];
	ok("sin ids no consulta", (await A.leerPorLotes([], tablaFalsa(filas, registro))).length + registro.length, 0);

	let error = null;
	try {
		await A.leerPorLotes(["p1"], () => ({ range: () => Promise.resolve({ data: null, error: { message: "sin red" } }) }));
	} catch (e) { error = e.message; }
	ok("un error de Supabase no se traga en silencio", error, "sin red");

	// ── Alumno dado de alta tarde (decisión de Jorge 10, 2026-09-24) ──────────
	ok("alta en hora de Ciudad de México (UTC-6)", A.fechaAlta("2026-09-24T05:59:00Z"), "2026-09-23");
	ok("alta a mediodía", A.fechaAlta("2026-09-24T18:00:00+00:00"), "2026-09-24");
	ok("sin created_at: sin fecha (no se filtra)", A.fechaAlta(null), null);
	ok("nació con su grupo (mismo instante, semilla QA): sin fecha de alta", A.fechaAlta("2026-09-24T07:43:51.056498+00:00", "2026-09-24T07:43:51.056498+00:00"), null);
	ok("alta después de crear el grupo: su fecha", A.fechaAlta("2026-09-24T09:18:11+00:00", "2026-09-24T07:43:51+00:00"), "2026-09-24");
	ok("created_at ilegible: sin fecha", A.fechaAlta("no es fecha"), null);
	ok("fecha del producto: la de su sesión", A.fechaProducto("2026-09-20", "2026-09-22"), "2026-09-20");
	ok("sin sesión fechada: la de entrega", A.fechaProducto(null, "2026-09-22"), "2026-09-22");
	ok("sin ninguna: null", A.fechaProducto(null, null), null);
	ok("producto anterior al alta: no cuenta", A.cuentaDesdeAlta("2026-09-24", "2026-09-23", null), false);
	ok("producto del día del alta: cuenta", A.cuentaDesdeAlta("2026-09-24", "2026-09-24", null), true);
	ok("producto posterior: cuenta", A.cuentaDesdeAlta("2026-09-24", "2026-09-30", null), true);
	ok("alumno sin fecha de alta: todo cuenta", A.cuentaDesdeAlta(null, "2026-01-01", null), true);
	ok("producto sin fecha: cuenta", A.cuentaDesdeAlta("2026-09-24", null, null), true);
	ok("evidencia fechada antes del alta (semilla QA): cuenta", A.cuentaDesdeAlta("2026-09-24", "2026-09-10", { fecha: "2026-09-10" }), true);
	ok("captura del día del alta sobre algo viejo: no cuenta", A.cuentaDesdeAlta("2026-09-24", "2026-09-10", { fecha: "2026-09-24" }), false);
	ok("calificación sin fecha: no salva al producto viejo", A.cuentaDesdeAlta("2026-09-24", "2026-09-10", { estado_entrega: "no_entregado" }), false);

	console.log(fallos ? fallos + " FALLAS" : "TODO OK");
	process.exit(fallos ? 1 : 0);
})();
