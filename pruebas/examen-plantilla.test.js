/*
	Exámenes del catálogo (plantillas, maestro_id null).

	R23 (2026-09-26): "Aplicar este examen" le ponía maestro_id a la plantilla y la "reclamaba";
	se cambió a insertar una COPIA. El mismo día Jorge decidió que los exámenes del catálogo se
	VENDEN en la tienda y NO son parte de Mi Salón: la pantalla ya no los lista ni los aplica
	(js/examen-plantilla.js se retiró). Lo ya aplicado se sigue abriendo (js/examen-anterior.js)
	y la base ya no deja reclamar una plantilla (supabase/mi_salon_b18a_...).

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
const existe = (f) => fs.existsSync(path.join(__dirname, "..", f));

const ex = leer("js/examen.js"), ant = leer("js/examen-anterior.js"), html = leer("examen.html");
ok("ya no hay módulo de plantillas ni se carga", [existe("js/examen-plantilla.js"), html.includes("examen-plantilla.js")], [false, false]);
ok("la lista no pide las plantillas del catálogo (maestro_id null) ni ofrece aplicarlas",
	[/maestro_id\.is\.null/.test(ex + ant), /data-aplicar|Aplicar este examen"/.test(ex + ant)], [false, false]);
ok("lo ya aplicado: solo exámenes propios del grupo (maestro_id y grupo_id)",
	/from\("examenes"\)\.select\([^)]*\)\s*\.eq\("maestro_id", userId\)\.eq\("grupo_id", grupo\.id\)/.test(ex), true);
ok("la vista anterior no abre una plantilla ajena por la dirección", /examen\.maestro_id !== userId/.test(ant), true);
ok("la vista anterior ya no dice «Fase Fase 3» (no pinta la fase)", /"Fase " \+/.test(ant), false);
ok("examen.html carga la vista anterior antes de examen.js", (() => {
	const a = html.indexOf('src="js/examen-anterior.js"'), b = html.indexOf('src="js/examen.js"');
	return a > 0 && a < b;
})(), true);
ok("con ?examen_id= se abre la vista anterior; sin él, la de Mi Salón", /get\("examen_id"\)[\s\S]{0,300}ExamenAnterior\.iniciar/.test(ex), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
