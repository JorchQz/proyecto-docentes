/*
	Lecturas con error (3.7): una pantalla que captura no sigue con datos a medias.

	Si una lectura de Supabase falla y la pantalla lo ignora, cree que no hay nada guardado:
	"Hoy" decía "nada pendiente" y el cierre del día pisaba con 1 y 1 lo ya capturado; la
	boleta de Reportes guardaba su propuesta encima de una calificación confirmada. Esta
	prueba ejecuta las pantallas completas (pruebas/hoy-arranque.test.js y
	pruebas/boleta-arranque.test.js) con cada una de sus lecturas en error y exige que
	avisen y no escriban nada. También corre pruebas/lectura.test.js (la capa común: el
	grupo activo y el candado en error detienen la página sin excepción ni escritura) y
	pruebas/asistencia-arranque.test.js (Asistencia con cada lectura en error).

	node pruebas/lecturas-con-error.test.js
*/

const { spawnSync } = require("child_process");
const path = require("path");

let fallos = 0;
function correr(prueba, variable, tabla) {
	const env = Object.assign({}, process.env);
	env[variable] = tabla;
	const r = spawnSync(process.execPath, [path.join(__dirname, prueba)], { env: env, encoding: "utf8" });
	const bien = r.status === 0;
	if (!bien) fallos++;
	const detalle = bien ? "" : " → " + (r.stdout || "").split("\n").filter((l) => /^FALLA/.test(l)).join(" | ");
	console.log((bien ? "OK   " : "FALLA ") + prueba.replace(".test.js", "") + " con " + tabla + " en error" + detalle);
}

["alumnos", "asistencias", "registro_diario", "proyectos", "sesiones", "productos_sesion", "calificaciones"]
	.forEach((t) => correr("hoy-arranque.test.js", "HOY_FALLA", t));
["evaluacion_diagnostica", "boleta_trimestral", "v_avance_pda"]
	.forEach((t) => correr("boleta-arranque.test.js", "BOLETA_FALLA", t));

// La capa común (js/lectura.js) con el grupo activo y el candado en error, y Asistencia con
// cada una de sus lecturas en error: se detienen con el aviso común y no escriben
["lectura.test.js", "asistencia-arranque.test.js"].forEach((prueba) => {
	const r = spawnSync(process.execPath, [path.join(__dirname, prueba)], { encoding: "utf8" });
	const bien = r.status === 0;
	if (!bien) fallos++;
	const detalle = bien ? "" : " → " + (r.stdout || "").split("\n").filter((l) => /^FALLA/.test(l)).join(" | ");
	console.log((bien ? "OK   " : "FALLA ") + prueba.replace(".test.js", "") + " (lecturas en error: GrupoActivo, candado, Asistencia)" + detalle);
});

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
