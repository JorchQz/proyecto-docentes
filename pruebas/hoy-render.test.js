/*
	Pruebas del render de la sección "Sesiones de hoy" (B.1).

	Regresión del 2026-09-23: la pantalla se caía con
	"Cannot read properties of undefined" al dibujar el panel de detalle, porque el
	arranque corría ANTES de que se asignara el estado (las funciones se izan, las
	asignaciones de `var` no). La excepción mataba el render de las secciones 3 y 4.

	Esta prueba dibuja de verdad un producto multigrado con alumnos de dos grados,
	usando las funciones tal cual están en js/hoy.js, y además vigila el orden de
	inicialización que causó el bug.

	node pruebas/hoy-render.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}

const ALCANCE = require("../js/alcance-hoy.js");
const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "hoy.js"), "utf8");

function extraerFuncion(nombre) {
	const m = fuente.match(new RegExp("\\n\\tfunction " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
	if (!m) { console.log("FALLA no se encontró la función " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}
function extraerLista(nombre) {
	// Sirve tanto para listas de una línea como de varias
	const m = fuente.match(new RegExp("var " + nombre + " = \\[[\\s\\S]*?\\];"));
	if (!m) { console.log("FALLA no se encontró la lista " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}

// ── 1. El bug de fondo: el estado debe existir antes del primer render ────────
const posEstado = fuente.indexOf("var detallesAbiertos");
const posArranque = fuente.indexOf("await cargarDatosDelDia();");
ok("el estado se declara antes del arranque", posEstado !== -1 && posArranque !== -1 && posEstado < posArranque, true);
ok("el arranque envuelve cada render en su propio try", /catch \(e\) \{[\s\S]*?hoy: render de/.test(fuente), true);

// ── 2. Render real de un producto multigrado ─────────────────────────────────
const alumnos = [
	{ id: "al-2", nombre_completo: "ALUMNO DE SEGUNDO", grado: 2, num_lista: 1 },
	{ id: "al-3", nombre_completo: "ALUMNO DE TERCERO", grado: 3, num_lista: 2 },
];
const calificaciones = {
	// uno ya calificado y con detalle capturado, el otro en blanco
	"al-2|prod-1": { id: "c1", nivel: "logrado", estado_entrega: "entregado", puntaje: 9, retroalimentacion: "Excelente trabajo" },
};

const cuerpo = [
	"var window = { AlcanceHoy: ALCANCE };",
	"var alumnos = ALUMNOS;",
	"var calificaciones = CALIFICACIONES;",
	"var detallesAbiertos = DETALLES;",
	extraerLista("NIVELES"),
	extraerLista("RETRO_RAPIDA"),
	extraerFuncion("esc"),
	extraerFuncion("chip"),
	extraerFuncion("filaAlumno"),
	extraerFuncion("alumnosDeProducto"),
	extraerFuncion("agruparPorGrado"),
	extraerFuncion("detalleProducto"),
	extraerFuncion("bloqueProducto"),
	"return { bloqueProducto: bloqueProducto };",
].join("\n");

const api = new Function("ALUMNOS", "CALIFICACIONES", "DETALLES", "ALCANCE", cuerpo)(alumnos, calificaciones, {}, ALCANCE);

const producto = { id: "prod-1", nombre: "Cartel del cuento", campo: "LEN", grados: ["2", "3"], tipo: "trabajo" };
let html = "";
let excepcion = null;
try {
	html = api.bloqueProducto(producto);
} catch (e) {
	excepcion = e;
}
ok("dibuja un producto multigrado sin excepción", excepcion === null ? "sin excepción" : String(excepcion), "sin excepción");
ok("aparecen los dos alumnos", html.indexOf("ALUMNO DE SEGUNDO") !== -1 && html.indexOf("ALUMNO DE TERCERO") !== -1, true);
ok("se agrupa por grado (dos encabezados)", (html.match(/° grado/g) || []).length, 2);
ok("cada alumno tiene su panel de detalle",
	html.indexOf("id='detalle-prod-1-al-2'") !== -1 && html.indexOf("id='detalle-prod-1-al-3'") !== -1, true);
ok("los paneles nacen cerrados", (html.match(/hidden rounded-xl bg-gray-50/g) || []).length, 2);
ok("el semáforo ya capturado queda marcado", html.indexOf("bg-emerald-500 text-white") !== -1, true);
ok("la retroalimentación guardada se muestra", html.indexOf("Excelente trabajo</textarea>") !== -1, true);
ok("el puntaje 9 queda seleccionado", html.indexOf("value='9' selected") !== -1, true);

// Producto de un solo grado: sin encabezados de grado, un solo alumno
const soloTercero = api.bloqueProducto({ id: "prod-2", nombre: "Problemas", campo: "SAB", grados: ["3"], tipo: "trabajo" });
ok("producto de un grado: un solo alumno", soloTercero.indexOf("ALUMNO DE SEGUNDO") === -1, true);
ok("producto de un grado: sin encabezado de grado", (soloTercero.match(/° grado/g) || []).length, 0);

// El panel abierto sigue abierto tras redibujar
const api2 = new Function("ALUMNOS", "CALIFICACIONES", "DETALLES", "ALCANCE", cuerpo)(alumnos, calificaciones, { "detalle-prod-1-al-3": true }, ALCANCE);
const htmlAbierto = api2.bloqueProducto(producto);
ok("un detalle abierto sobrevive al redibujo",
	htmlAbierto.indexOf("id='detalle-prod-1-al-3' class='rounded-xl") !== -1, true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
