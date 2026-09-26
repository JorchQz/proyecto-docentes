/*
	Exámenes del catálogo (R23, 2026-09-26): aplicar una plantilla ya no la "reclama".
	Antes, "Aplicar este examen" hacía UPDATE de la plantilla (maestro_id y grupo_id de la primera
	cuenta) y dejaba de verse para las demás. Ahora se inserta una COPIA para el grupo.

	node pruebas/examen-plantilla.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

let X = {};
try { X = require("../js/examen-plantilla.js"); } catch (e) { console.log("FALLA no existe js/examen-plantilla.js"); fallos++; }

if (X.copiaDeExamen) {
	const plantilla = { id: "pl1", maestro_id: null, grupo_id: null, ciclo_escolar: "2026-2027", trimestre: 1, fase: 4, grado: 3, titulo: "Examen T1 3°",
		instrucciones: "Lee", preguntas_ids: ["q1", "q2"], total_preguntas: 2, valor_total: 100, tiempo_minutos: 40, estado: "publicado", link_documento: null, created_at: "x" };
	const c = X.copiaDeExamen(plantilla, "m1", "g1");
	ok("la copia es de la maestra y su grupo, publicada, sin el id de la plantilla",
		[c.maestro_id, c.grupo_id, c.estado, "id" in c, "created_at" in c], ["m1", "g1", "publicado", false, false]);
	ok("la copia lleva las preguntas y datos de la plantilla", [c.titulo, c.preguntas_ids, c.total_preguntas, c.grado, c.trimestre, c.ciclo_escolar], ["Examen T1 3°", ["q1", "q2"], 2, 3, 1, "2026-2027"]);

	const copia = Object.assign({ id: "cp1" }, c);
	const otraCuenta = { id: "ot", maestro_id: "m2", grupo_id: "g9", titulo: "Otro", grado: 3, trimestre: 1, preguntas_ids: [] };
	const deOtroGrupo = Object.assign({}, copia, { id: "cp2", grupo_id: "g2" });
	ok("sin aplicar: se ve la plantilla", X.visibles([plantilla], "m1", "g1").map((e) => e.id), ["pl1"]);
	ok("ya aplicada en este grupo: se ve la copia y no la plantilla repetida", X.visibles([plantilla, copia], "m1", "g1").map((e) => e.id), ["cp1"]);
	ok("en otro grupo: se ve la plantilla para aplicarla ahí también", X.visibles([plantilla, copia], "m1", "g2").map((e) => e.id), ["pl1"]);
	ok("nunca los de otra cuenta ni los suyos de otro grupo", X.visibles([plantilla, copia, otraCuenta, deOtroGrupo], "m1", "g1").map((e) => e.id), ["cp1"]);
}

const ex = leer("js/examen.js");
ok("examen.js: aplicar inserta una copia (ya no hace UPDATE de la plantilla)",
	[ex.includes("ExamenPlantilla.copiaDeExamen(plantilla, userId, grupo.id)"), /\.update\(\{\s*maestro_id: userId,\s*grupo_id: grupo\.id/.test(ex)], [true, false]);
ok("examen.html carga examen-plantilla.js antes de examen.js", (() => {
	const h = leer("examen.html");
	const a = h.indexOf('src="js/examen-plantilla.js"'), b = h.indexOf('src="js/examen.js"');
	return a > 0 && a < b;
})(), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
