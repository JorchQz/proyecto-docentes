/*
	Pruebas de los filtros de multigrado de la pantalla "Hoy" (B.1).

	Extrae las funciones TAL CUAL están en js/hoy.js (viven dentro del closure de la
	página, así que se inyecta `alumnos` como parámetro) y las corre con casos reales
	de un grupo 2°-3°-4°.

	node pruebas/hoy-filtros.test.js
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

const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "hoy.js"), "utf8");
function extraer(nombre) {
	const m = fuente.match(new RegExp("function " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
	if (!m) { console.log("FALLA no se encontró " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}
const alumnos = [
	{ id: "a1", nombre_completo: "ALUMNO DE SEGUNDO", grado: 2, num_lista: 1 },
	{ id: "a2", nombre_completo: "ALUMNO DE TERCERO", grado: 3, num_lista: 2 },
	{ id: "a3", nombre_completo: "OTRO DE TERCERO", grado: 3, num_lista: 3 },
	{ id: "a4", nombre_completo: "ALUMNO DE CUARTO", grado: 4, num_lista: 4 },
];
const ALCANCE = require("../js/alcance-hoy.js");
const hacerAlumnosDe = new Function("alumnos", "window", "calificaciones", "return " + extraer("alumnosDeProducto") + ";");
const alumnosDeProducto = hacerAlumnosDe(alumnos, { AlcanceHoy: ALCANCE }, {});
const agruparPorGrado = new Function("return " + extraer("agruparPorGrado") + ";")();

// productos_sesion.grados es text[]: "3" debe casar con grado 3 (número)
ok("producto compartido 2-3 → tres alumnos",
	alumnosDeProducto({ grados: ["2", "3"] }).map(function (a) { return a.id; }), ["a1", "a2", "a3"]);
ok("producto solo de 4° → un alumno",
	alumnosDeProducto({ grados: ["4"] }).map(function (a) { return a.id; }), ["a4"]);
ok("producto de un grado que nadie cursa → vacío",
	alumnosDeProducto({ grados: ["6"] }), []);
ok("producto sin grados → vacío (no se califica a ciegas)",
	alumnosDeProducto({}), []);

// La lista se agrupa por grado y en orden
ok("agrupa 2-3 en dos bloques ordenados",
	agruparPorGrado(alumnosDeProducto({ grados: ["3", "2"] })).map(function (g) {
		return g.grado + ":" + g.alumnos.length;
	}), ["2:1", "3:2"]);
ok("un solo grado → un bloque",
	agruparPorGrado(alumnosDeProducto({ grados: ["4"] })).map(function (g) { return g.grado; }), ["4"]);

// ── Alumno dado de alta tarde (decisión de Jorge 10, 2026-09-24) ─────────────
// Alta el 24 de septiembre (created_at en UTC; en Ciudad de México sigue siendo el 24)
const conTardio = alumnos.concat([{ id: "a5", nombre_completo: "ALUMNO NUEVO", grado: 3, num_lista: 5,
	alta: ALCANCE.fechaAlta("2026-09-25T03:30:00+00:00") }]);
const califs = { "a5|p-sembrada": { fecha: "2026-09-15", estado_entrega: "entregado" }, "a5|p-hoy-vieja": { fecha: "2026-09-24", estado_entrega: "no_entregado" } };
const deTardio = hacerAlumnosDe(conTardio, { AlcanceHoy: ALCANCE }, califs);
const ids = (p) => deTardio(p).map(function (a) { return a.id; });
ok("alta: 25 sep 03:30 UTC es 24 sep en Ciudad de México", conTardio[4].alta, "2026-09-24");
ok("tarea que se dejó antes de su alta: no le toca", ids({ id: "p-vieja", grados: ["3"], sesion: { fecha: "2026-09-22" } }), ["a2", "a3"]);
ok("aunque venza después de su alta (se dejó antes)", ids({ id: "p-vieja2", grados: ["3"], sesion: { fecha: "2026-09-23" }, fecha_entrega: "2026-09-26" }), ["a2", "a3"]);
ok("producto del día de su alta: sí le toca", ids({ id: "p-hoy", grados: ["3"], sesion: { fecha: "2026-09-24" } }), ["a2", "a3", "a5"]);
ok("sin fecha de sesión manda la de entrega", ids({ id: "p-e", grados: ["3"], sesion: { fecha: null }, fecha_entrega: "2026-09-25" }), ["a2", "a3", "a5"]);
ok("sin ninguna fecha: le toca (no se esconde nada)", ids({ id: "p-sf", grados: ["3"] }), ["a2", "a3", "a5"]);
ok("evidencia fechada antes del alta (semilla): sí cuenta", ids({ id: "p-sembrada", grados: ["3"], sesion: { fecha: "2026-09-15" } }), ["a2", "a3", "a5"]);
ok("captura hecha el día del alta sobre algo viejo: no cuenta", ids({ id: "p-hoy-vieja", grados: ["3"], sesion: { fecha: "2026-09-15" } }), ["a2", "a3"]);
ok("quien nació con el grupo no tiene fecha de alta (le cuenta todo)", ALCANCE.fechaAlta("2026-09-24T07:43:51Z", "2026-09-24T07:43:51Z"), null);
ok("los demás alumnos no cambian", ids({ id: "p-x", grados: ["2", "4"], sesion: { fecha: "2026-09-01" } }), ["a1", "a4"]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
