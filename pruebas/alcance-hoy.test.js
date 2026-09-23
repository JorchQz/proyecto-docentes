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

console.log(fallos ? fallos + " FALLAS" : "TODO OK");
process.exit(fallos ? 1 : 0);
