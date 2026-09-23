/*
	Situación de una tarea en la pantalla Tareas (bloque 3.7).

	Extrae situacionDe y detalleConteo de js/tareas.js. Un alumno está revisado si tiene
	cualquier estado de entrega capturado en "Hoy", también "justificado" y "no aplica":
	así lo cuentan "Hoy" y el motor. Antes, un justificado dejaba la tarea "Por revisar"
	para siempre aunque "Hoy" ya no la mostrara.

	node pruebas/tareas-situacion.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "tareas.js"), "utf8");
function extraer(patron, nombre) {
	const m = fuente.match(patron);
	if (!m) { console.log("FALLA no se encontró " + nombre + " en js/tareas.js"); process.exit(1); }
	return m[0];
}
const codigo = [
	extraer(/\n\tvar ETIQUETA_CONTEO = \[[\s\S]*?\n\t\];/, "ETIQUETA_CONTEO"),
	extraer(/\n\tfunction situacionDe\([\s\S]*?\n\t\}/, "situacionDe"),
	extraer(/\n\tfunction detalleConteo\([\s\S]*?\n\t\}/, "detalleConteo"),
].join("\n");
const T = new Function(codigo + "\nreturn { situacionDe: situacionDe, detalleConteo: detalleConteo };")();

const HOY = "2026-09-23";
const ocho = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id: id }));

// El caso real de QA (S4 y S8): 4 entregado, 2 justificado, 2 no entregado
const rev = { a: "entregado", b: "entregado", c: "entregado", d: "entregado", e: "justificado", f: "justificado", g: "no_entregado", h: "no_entregado" };
let s = T.situacionDe(ocho, rev, "2026-09-10", HOY);
ok("8 de 8 con estado: revisada (los justificados cuentan)", [s.revisados, s.total, s.estado], [8, 8, "revisada"]);
ok("detalle incluye justificadas", T.detalleConteo(s.conteo), "4 entregaron, 2 no entregaron, 2 justificada");

s = T.situacionDe(ocho, { a: "entregado", b: "no_aplica" }, "2026-09-10", HOY);
ok("faltan 6: por revisar", [s.revisados, s.estado], [2, "por_revisar"]);
ok("no aplica también cuenta como revisado", s.conteo.no_aplica, 1);

s = T.situacionDe(ocho, {}, "2026-09-30", HOY);
ok("vence después: próxima", s.estado, "proxima");
s = T.situacionDe(ocho, {}, null, HOY);
ok("sin fecha", s.estado, "sin_fecha");
s = T.situacionDe([], {}, "2026-09-10", HOY);
ok("sin alumnos de ese grado: no queda pendiente", s.estado, "revisada");
ok("un estado desconocido cuenta como revisado sin romper el conteo",
	T.situacionDe([{ id: "x" }], { x: "otro" }, "2026-09-10", HOY).estado, "revisada");

console.log(fallos ? fallos + " FALLAS" : "TODO OK");
process.exit(fallos ? 1 : 0);
