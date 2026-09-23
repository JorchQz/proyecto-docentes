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
const alumnosDeProducto = new Function("alumnos", "return " + extraer("alumnosDeProducto") + ";")(alumnos);
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

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
