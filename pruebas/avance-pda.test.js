/*
	Pruebas de la pestaña "Avance por PDA" (B.5).

	Extrae las funciones de render tal cual están en js/reportes.js y las corre con
	filas iguales a las que devuelve la vista v_avance_pda en la base real.

	node pruebas/avance-pda.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}

global.window = {};
require("../js/campos-formativos.js");

const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "reportes.js"), "utf8");
function extraer(patron, nombre) {
	const m = fuente.match(patron);
	if (!m) { console.log("FALLA no se encontró " + nombre + " en js/reportes.js"); process.exit(1); }
	return m[0];
}
function fn(nombre) {
	return extraer(new RegExp("\\n\\tfunction " + nombre + "\\([\\s\\S]*?\\n\\t\\}"), "la función " + nombre);
}
function constante(nombre) {
	return extraer(new RegExp("const " + nombre + " = \\{[\\s\\S]*?\\};"), "la constante " + nombre);
}

const cuerpo = [
	constante("ETIQUETA_NIVEL"),
	constante("ETIQUETA_TENDENCIA"),
	constante("CLASE_TENDENCIA"),
	fn("esc"),
	fn("semColorClass"),
	fn("semCirculo"),
	fn("campoCorto"),
	fn("etiquetaNivel"),
	fn("tablaPdaAlumno"),
	fn("tablaPdaGrupo"),
	"return { tablaPdaAlumno: tablaPdaAlumno, tablaPdaGrupo: tablaPdaGrupo };",
].join("\n");
const api = new Function(cuerpo)();

// Filas equivalentes a las que devuelve v_avance_pda (verificadas contra la BD)
const FILAS = [
	{
		alumno_id: "al-2", grado: 2, clave_pda: "pda-lectura", campo_formativo: "Lenguajes",
		pda: "Lee en voz alta diversos textos", contenido: "Lectura compartida en voz alta",
		evidencias: 3, nivel_predominante: "en_proceso", logrados: 1, en_proceso: 1, requiere_apoyo: 1,
		ajustadas_por_el_maestro: 0, tendencia: "mejora",
	},
	{
		alumno_id: "al-2", grado: 2, clave_pda: "pda-escritura", campo_formativo: "Lenguajes",
		pda: "Escribe su nombre y apellidos", contenido: "Escritura de nombres",
		evidencias: 3, nivel_predominante: "requiere_apoyo", logrados: 0, en_proceso: 1, requiere_apoyo: 2,
		ajustadas_por_el_maestro: 1, tendencia: "baja",
	},
	{
		alumno_id: "al-3", grado: 3, clave_pda: "pda-narracion", campo_formativo: "Saberes y Pensamiento Científico",
		pda: "Identifica la función de los textos", contenido: "Narración de sucesos",
		evidencias: 1, nivel_predominante: "logrado", logrados: 1, en_proceso: 0, requiere_apoyo: 0,
		ajustadas_por_el_maestro: 0, tendencia: "sin_datos",
	},
];

// ── Vista por alumno ─────────────────────────────────────────────────────────
const porAlumno = api.tablaPdaAlumno(FILAS.filter(function (f) { return f.alumno_id === "al-2"; }));
ok("por alumno: aparecen sus dos PDA",
	porAlumno.indexOf("Lee en voz alta") !== -1 && porAlumno.indexOf("Escribe su nombre") !== -1, true);
ok("por alumno: lo que requiere apoyo va primero",
	porAlumno.indexOf("Escribe su nombre") < porAlumno.indexOf("Lee en voz alta"), true);
ok("por alumno: el campo sale en código corto", porAlumno.indexOf(">LEN<") !== -1, true);
ok("por alumno: se avisa la tendencia", porAlumno.indexOf("Va mejorando") !== -1 && porAlumno.indexOf("Va bajando") !== -1, true);
ok("por alumno: se señalan los ajustes del maestro", porAlumno.indexOf("1 ajustada(s) por ti") !== -1, true);
ok("por alumno: una sola evidencia no inventa tendencia",
	api.tablaPdaAlumno([FILAS[2]]).indexOf("Falta evidencia") !== -1, true);

// ── Vista de grupo ───────────────────────────────────────────────────────────
const porGrupo = api.tablaPdaGrupo(FILAS);
ok("grupo: un renglón por PDA", (porGrupo.match(/<tr class='hover:bg-gray-50 align-top'>/g) || []).length, 3);
ok("grupo: el PDA con más alumnos en apoyo va primero",
	porGrupo.indexOf("Escribe su nombre") < porGrupo.indexOf("Lee en voz alta"), true);
ok("grupo: muestra el conteo por nivel", porGrupo.indexOf("1 logrado · 0 en proceso · 0 requiere apoyo") !== -1, true);
ok("grupo: separa por grado", porGrupo.indexOf(">2°<") !== -1 && porGrupo.indexOf(">3°<") !== -1, true);
ok("grupo: convierte el campo largo a código", porGrupo.indexOf(">SAB<") !== -1, true);

// Dos alumnos en el mismo PDA se suman en un solo renglón
const mismoPda = api.tablaPdaGrupo([
	Object.assign({}, FILAS[0], { alumno_id: "al-a", nivel_predominante: "logrado" }),
	Object.assign({}, FILAS[0], { alumno_id: "al-b", nivel_predominante: "requiere_apoyo" }),
]);
ok("grupo: el mismo PDA agrupa a los dos alumnos",
	(mismoPda.match(/<tr class='hover:bg-gray-50 align-top'>/g) || []).length, 1);
ok("grupo: y cuenta sus niveles por separado",
	mismoPda.indexOf("1 logrado · 0 en proceso · 1 requiere apoyo") !== -1, true);

// Sin emojis en la UI (regla dura del proyecto)
ok("sin emojis en el render",
	/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(porAlumno + porGrupo), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
