/*
	Matemáticas por grado (decisión 13 de Jorge; docs/referencia/matematicas-por-grado-nem.md)
	y aviso del guardado fallido de la propuesta de la boleta (defecto 8 de 3.7).

	  - Catálogo: 1° con 4 habilidades, 2° con 7 (sin fracciones), 3° a 6° con las 8; sin
	    grado válido, las 8. Alcance por grado solo donde aplica.
	  - Textos de la Capa 1: no proponen habilidades que no aplican al grado (dato viejo),
	    con el grado explícito o el de la banda.
	  - Junta: cada habilidad cuenta solo a los alumnos de los grados donde aplica.
	  - Reportes (js/reportes.js): guardarTextosPropuestos devuelve el error si el guardado
	    falla y deja el estado local como estaba (la pantalla no lo da por guardado); se
	    extrae TAL CUAL del archivo, como pruebas/aviso-propuesta.test.js.

	node pruebas/matematicas-grado.test.js
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
require("../js/catalogo-habilidades.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const J = require("../js/junta.js");
const CH = window.CatalogoHabilidades;
const TB = window.TextosBoleta;

// ── Catálogo ─────────────────────────────────────────────────────────────────
const claves = (g) => CH.matematicasDeGrado(g).map((h) => h.clave.replace("mates.", ""));
ok("1°: suma, resta, lectura y escritura de cantidades, problemas", claves(1),
	["suma", "resta", "lectura_escritura_cantidades", "problemas"]);
ok("2°: las de 1° más multiplicación, división y tablas (sin fracciones)", claves(2),
	["suma", "resta", "multiplicacion", "division", "tablas", "lectura_escritura_cantidades", "problemas"]);
[3, 4, 5, 6].forEach((g) => ok(g + "°: las 8", claves(g).length, 8));
ok("grado como texto ('2') también", claves("2").length, 7);
[null, undefined, "", 0, 7, "x", 2.5].forEach((g) => ok("sin grado válido (" + String(g) + "): las 8", claves(g).length, 8));
ok("el orden es el del catálogo", CH.matematicasDeGrado(2).every((h, i, l) => i === 0 || CH.MATEMATICAS.indexOf(l[i - 1]) < CH.MATEMATICAS.indexOf(h)), true);
ok("clave fuera del catálogo no aplica", CH.aplicaMatematica("mates.calculo_mental", 3), false);
ok("no se agregó mates.calculo_mental (pendiente del visto bueno de Jorge)", CH.MATEMATICAS.some((h) => h.clave === "mates.calculo_mental"), false);
ok("el catálogo sigue con 8 claves", CH.MATEMATICAS.length, 8);
let alcancesBien = true;
CH.MATEMATICAS.forEach((h) => {
	[1, 2, 3, 4, 5, 6].forEach((g) => {
		const aplica = h.grados.indexOf(g) !== -1;
		if (aplica !== !!CH.alcanceMatematica(h, g)) alcancesBien = false;
	});
});
ok("alcance en cada grado donde aplica y solo ahí", alcancesBien, true);
// Cuaderno oficial de Fase 3 (DGDC, 2024), pp. 25 y 26: en 2° la división es reparto y
// agrupamiento sin algoritmo convencional, y "Tablas" es cálculo mental, no memorización
ok("alcance por clave", CH.alcanceMatematica("mates.division", 2), "Reparto y agrupamiento con divisores menores que 10, sin algoritmo convencional");
ok("tablas en 2°: estrategias de cálculo mental, sin memorizar", CH.alcanceMatematica("mates.tablas", 2),
	"Estrategias de cálculo mental para multiplicar números menores que 10, sin memorizar las tablas");
ok("tablas en 2°: sigue aplicando (no cambia qué habilidades hay por grado)", CH.aplicaMatematica("mates.tablas", 2), true);
ok("alcance sin grado: vacío", CH.alcanceMatematica("mates.suma", null), "");

// ── Textos de la Capa 1 ──────────────────────────────────────────────────────
const DIAG_VIEJO = {
	matematicas: [
		{ clave: "mates.fracciones", nivel: "requiere_apoyo" }, // no aplica en 1° ni 2°
		{ clave: "mates.division", nivel: "requiere_apoyo" },   // no aplica en 1°
		{ clave: "mates.suma", nivel: "logrado" },
		{ clave: "mates.tablas", nivel: "logrado" },            // no aplica en 1°
	],
};
function textos(extra) {
	return TB.generar(Object.assign({ catalogo: CH, corto: window.CamposFormativos.corto, diagnostica: DIAG_VIEJO }, extra));
}
let r = textos({ grado: 2 });
// En 2° la división se nombra como se evalúa en la Fase 3 (repartir o agrupar, sin algoritmo)
ok("2°: área de reparto (no «división») y no de fracciones", r.SAB.areas.join(" ").includes("estrategias para repartir o agrupar") &&
	!r.SAB.areas.join(" ").includes("división") && !r.SAB.areas.join(" ").includes("fracciones"), true);
ok("2°: la sugerencia tampoco nombra fracciones", r.SAB.sugerencias.join(" ").includes("fracciones"), false);
ok("2°: fortaleza de suma y cálculo mental (nunca «tablas de multiplicar»)", /suma y cálculo mental para multiplicar/.test(r.SAB.fortalezas.join(" ")) &&
	!/tablas/.test(r.SAB.fortalezas.join(" ")), true);
r = textos({ grado: 1 });
ok("1°: sin áreas de matemáticas (división y fracciones no aplican)", r.SAB.areas.length, 0);
ok("1°: fortaleza solo de suma", r.SAB.fortalezas.join(" ").includes("Resuelve con seguridad: suma.") && !r.SAB.fortalezas.join(" ").includes("tablas"), true);
r = textos({ banda: { grado: 1, requiere_apoyo_max: 14, cercano_max: 34, estandar_max: 59 } });
ok("sin grado explícito: el de la banda (1°)", r.SAB.areas.length, 0);
r = textos({ grado: 4 });
ok("4°: división y fracciones", r.SAB.areas.join(" ").includes("división y fracciones"), true);
r = textos({});
ok("sin grado ni banda: las 8 (lo de antes)", r.SAB.areas.join(" ").includes("división y fracciones"), true);

// ── Junta: {habilidades} cuenta solo a los grados donde aplica ───────────────
const motorVacio = { porCampo: {}, asistencia: { presentes: 0, total: 0, porcentaje: null } };
const alumnosJunta = [{ id: "u1", grado: 1 }, { id: "d1", grado: 2 }];
const actual = {
	motor: { porAlumno: { u1: motorVacio, d1: motorVacio } },
	avancePda: [],
	diagnosticas: {
		// 1° con datos viejos de división y fracciones: no cuentan
		u1: { alumno_id: "u1", matematicas: [{ clave: "mates.division", nivel: "requiere_apoyo" }, { clave: "mates.fracciones", nivel: "requiere_apoyo" }, { clave: "mates.suma", nivel: "requiere_apoyo" }] },
		// 2°: división sí cuenta, fracciones no
		d1: { alumno_id: "d1", matematicas: [{ clave: "mates.division", nivel: "requiere_apoyo" }, { clave: "mates.fracciones", nivel: "requiere_apoyo" }] },
	},
};
const sug = J.sugerenciasFrecuentes({ plantillas: {}, bandas: {} }, actual, alumnosJunta).find((s) => s.clave === "matematicas");
ok("junta: habilidades del grupo sin las que no aplican (suma 1, reparto de 2° 1, fracciones 0)",
	sug && sug.texto, "Practicar con ejercicios cortos y diarios: suma y estrategias para repartir o agrupar.");

// ── Reportes: guardado fallido de los textos propuestos ──────────────────────
const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "reportes.js"), "utf8");
const extraida = fuente.match(/async function guardarTextosPropuestos[\s\S]*?\n\t\}/);
if (!extraida) {
	console.log("FALLA no se encontró guardarTextosPropuestos en js/reportes.js");
	process.exit(1);
}
function crear(upsert) {
	return new Function("CODIGOS", "userId", "upsertPorForma", "window", "return " + extraida[0] + ";")(
		["LEN", "SAB", "ETI", "DHL"], "m1", upsert, window);
}
const TEXTOS = { LEN: { fortalezas: ["Lee bien."], areas: [], sugerencias: [] }, SAB: { fortalezas: [], areas: [], sugerencias: [] },
	ETI: { fortalezas: [], areas: [], sugerencias: [] }, DHL: { fortalezas: [], areas: [], sugerencias: [] }, GEN: { fortalezas: [], areas: [], sugerencias: [] } };
const CTX = { alumnoId: "a1", ciclo: "2026-2027", trimestre: 1 };

(async function () {
	const filaPrevia = { id: 7, campo: "LEN", fortalezas: "Texto guardado antes.", texto_autogenerado: { visible: "reglas" } };
	let estado = { LEN: filaPrevia };
	const fallaRed = crear(async function () { throw new Error("Failed to fetch"); });
	const errorConsola = console.error; console.error = function () {}; // el error esperado no ensucia la salida
	const err = await fallaRed(TEXTOS, estado, CTX, false);
	console.error = errorConsola;
	ok("guardado fallido: devuelve el error", err && err.message, "Failed to fetch");
	ok("guardado fallido: el estado local queda como en la base", estado.LEN === filaPrevia && estado.LEN.fortalezas === "Texto guardado antes.", true);
	ok("guardado fallido: no deja filas nuevas en el estado", Object.keys(estado), ["LEN"]);

	estado = {};
	let enviadas = null;
	const bien = crear(async function (tabla, filas) { enviadas = filas; });
	ok("guardado bien: devuelve null", await bien(TEXTOS, estado, CTX, false), null);
	ok("guardado bien: el estado local lleva la propuesta", estado.LEN && estado.LEN.fortalezas, "Lee bien.");
	ok("guardado bien: se mandó la fila de LEN", enviadas && enviadas.map((f) => f.campo), ["LEN"]);

	ok("nada que proponer: null sin escribir", await crear(async function () { throw new Error("no debía escribir"); })(
		{ LEN: { fortalezas: [], areas: [], sugerencias: [] } }, {}, CTX, false), null);

	// La pantalla usa lo que devuelve: aviso de la propuesta (número o textos) y "Volver a proponer"
	ok("generarBoleta avisa si falla la propuesta", /fallosPropuesta\.push\("la propuesta de calificación"\)/.test(fuente) &&
		/fallosPropuesta\.push\("los textos propuestos"\)/.test(fuente) && /avisoGuardado\([\s\S]{0,400}"boletaAvisoPropuesta"\)/.test(fuente), true);
	ok("Volver a proponer avisa si falla", /No se pudieron volver a proponer los textos/.test(fuente), true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
