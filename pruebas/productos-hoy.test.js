/*
	"Hoy" e Inicio con las decisiones de Jorge del 2026-09-26 (js/productos-hoy.js y su uso):

	  2. Agregar en plena clase una actividad o una tarea: diálogo (no window.prompt) con nombre,
	     tipo, campo (el de la sesión), grados (los de la sesión y el proyecto) y, en tareas, el
	     día en que se revisa (AlcanceHoy.venceTarea). Sin señal lo dice.
	  3. Cada producto rotulado con sus grados; renombrar; quitar (activo = false) solo sin
	     calificaciones. El motor, "Qué le falta" y los reportes ignoran los inactivos.
	  7. Varios proyectos activos: "Trabajar hoy" ofrece la siguiente de cada uno, agrupadas y
	     sin tope; Inicio muestra todos y "Terminar sesión" es por proyecto.

	node pruebas/productos-hoy.test.js
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

let P = {};
try { P = require("../js/productos-hoy.js"); } catch (e) { console.log("FALLA no existe js/productos-hoy.js"); fallos++; }
const A = require("../js/alcance-hoy.js");

if (P.etiquetaGrados) {
	ok("etiqueta de grados", [P.etiquetaGrados(["3"]), P.etiquetaGrados(["3", "2"]), P.etiquetaGrados([5, 3, 4]), P.etiquetaGrados([])],
		["3°", "2° y 3°", "3°, 4° y 5°", ""]);
}

if (P.siguientesPorProyecto) {
	const proyectos = [
		{ id: "b-uuid", titulo: "Saberes: el agua", estado: "activo" },
		{ id: "a-uuid", titulo: "Lenguajes: cuentos", estado: "activo" },
		{ id: "c-uuid", titulo: "Pausado", estado: "pausado" },
	];
	const sesiones = [];
	for (let i = 1; i <= 6; i++) sesiones.push({ id: "a" + i, proyecto_id: "a-uuid", numero_sesion: i, fecha: null, estado_sesion: "pendiente" });
	sesiones.push({ id: "b2", proyecto_id: "b-uuid", numero_sesion: 2, fecha: null, estado_sesion: "pendiente" });
	sesiones.push({ id: "b1", proyecto_id: "b-uuid", numero_sesion: 1, fecha: "2026-09-28", estado_sesion: "activa" });
	sesiones.push({ id: "b3", proyecto_id: "b-uuid", numero_sesion: 3, fecha: null, estado_sesion: "completada" });
	sesiones.push({ id: "c1", proyecto_id: "c-uuid", numero_sesion: 1, fecha: null, estado_sesion: "pendiente" });
	const g = P.siguientesPorProyecto(sesiones, proyectos);
	ok("Trabajar hoy: un grupo por proyecto activo, por título (no por uuid)", g.map((x) => x.proyecto.titulo), ["Lenguajes: cuentos", "Saberes: el agua"]);
	ok("Trabajar hoy: la siguiente de cada uno", g.map((x) => x.siguiente.id), ["a1", "b2"]);
	ok("Trabajar hoy: sin tope, las demás pendientes (5) se pueden elegir", g[0].otras.map((s) => s.id), ["a2", "a3", "a4", "a5", "a6"]);
	ok("Trabajar hoy: con el nombre del proyecto", g[1].siguiente.proyectoTitulo, "Saberes: el agua");
	ok("Trabajar hoy: ni fechadas, ni completadas, ni de proyectos pausados", g.some((x) => x.proyecto.id === "c-uuid") || g[1].otras.length > 0, false);
}

if (P.validarNuevo) {
	const hoy = "2026-09-28";
	const act = P.validarNuevo({ nombre: "  Cartel   del cuento ", tipo: "trabajo", campo: "LEN", grados: ["4"] }, { hoy, gradosSesion: [3, 4, 5] });
	ok("actividad solo para 4°: fila lista (sin fecha, origen maestro, diferenciada)",
		[act.ok, act.fila.nombre, act.fila.grados, act.fila.modalidad, act.fila.fecha_entrega, act.fila.origen, act.fila.tipo],
		[true, "Cartel del cuento", ["4"], "diferenciada", null, "maestro", "trabajo"]);
	const tarea = P.validarNuevo({ nombre: "Leer en casa", tipo: "tarea", campo: "LEN", grados: ["5", "3", "4"], fechaRevision: "2026-09-29" }, { hoy, gradosSesion: [3, 4, 5] });
	ok("tarea para toda la sesión: compartida con su día de revisión", [tarea.ok, tarea.fila.grados, tarea.fila.modalidad, tarea.fila.fecha_entrega], [true, ["3", "4", "5"], "compartida", "2026-09-29"]);
	ok("sin nombre: no", P.validarNuevo({ nombre: " ", tipo: "trabajo", campo: "LEN", grados: [3] }, { hoy }).foco, "nombre");
	ok("sin grados: no", P.validarNuevo({ nombre: "x", tipo: "trabajo", campo: "LEN", grados: [] }, { hoy }).foco, "grados");
	ok("sin campo: no", P.validarNuevo({ nombre: "x", tipo: "trabajo", campo: "", grados: [3] }, { hoy }).foco, "campo");
	ok("tarea sin día de revisión o en el pasado: no",
		[P.validarNuevo({ nombre: "x", tipo: "tarea", campo: "LEN", grados: [3] }, { hoy }).foco,
			P.validarNuevo({ nombre: "x", tipo: "tarea", campo: "LEN", grados: [3], fechaRevision: "2026-09-27" }, { hoy }).foco],
		["fecha", "fecha"]);
	ok("el día por omisión de una tarea es el de la regla actual (siguiente día hábil)", A.venceTarea(null, "2026-10-02"), "2026-10-05");
}
if (P.gradosPorOmision) {
	ok("grados por omisión: los de la sesión y el proyecto, dentro del grupo", P.gradosPorOmision(["3"], [3, 4], [3, 4, 5]), [3, 4]);
	ok("grados por omisión: sin sesión ni proyecto, los del grupo", P.gradosPorOmision([], [], ["3", "4", "5"]), [3, 4, 5]);
}
if (P.tieneCaptura) {
	ok("calificación = semáforo, entrega, puntaje o retroalimentación (una fila vacía no cuenta)",
		[P.tieneCaptura({ nivel: "logrado" }), P.tieneCaptura({ puntaje: 0 }), P.tieneCaptura({ retroalimentacion: "bien" }), P.tieneCaptura({ nivel: null, estado_entrega: null, puntaje: null }), P.tieneCaptura(null)],
		[true, true, true, false, false]);
}

// ── Cómo lo usa "Hoy" ──
const hoy = leer("js/hoy.js"), hoyHtml = leer("hoy.html");
ok("Hoy: sin window.prompt", /window\.prompt/.test(hoy), false);
ok("Hoy: diálogo accesible (role=dialog, aria-modal, Esc)", /setAttribute\("role", "dialog"\)/.test(hoy) && /aria-modal/.test(hoy) && /e\.key === "Escape"/.test(hoy), true);
ok("Hoy: el diálogo valida con ProductosHoy.validarNuevo y el día por omisión es venceTarea", /ProductosHoy\.validarNuevo\(datos/.test(hoy) && /AlcanceHoy\.venceTarea\(null, hoy\)/.test(hoy), true);
ok("Hoy: agregar, renombrar y quitar dicen que necesitan señal", (hoy.match(/necesita señal/g) || []).length >= 3, true);
ok("Hoy: quitar revisa calificaciones (pantalla y base) antes de poner activo = false",
	/tieneCaptura\(calificaciones\[/.test(hoy) && /\.eq\("producto_sesion_id", producto\.id\)/.test(hoy) && /update\(\{ activo: false \}\)/.test(hoy) &&
	hoy.indexOf('.eq("producto_sesion_id", producto.id)') < hoy.indexOf("update({ activo: false })"), true);
ok("Hoy: renombrar actualiza productos_sesion.nombre", /update\(\{ nombre: v\.nombre \}\)/.test(hoy), true);
ok("Hoy: el producto nuevo se liga a los PDA de la sesión de sus grados", /producto_sesion_pda"\)\.insert\(ligas\)/.test(hoy), true);
ok("Hoy: Trabajar hoy usa siguientesPorProyecto (sin .slice(0, 4))", /ProductosHoy\.siguientesPorProyecto/.test(hoy) && !/\.slice\(0, 4\)/.test(hoy), true);
ok("hoy.html: carga js/productos-hoy.js antes de js/hoy.js",
	hoyHtml.indexOf('src="js/productos-hoy.js"') > 0 && hoyHtml.indexOf('src="js/productos-hoy.js"') < hoyHtml.indexOf('src="js/hoy.js"'), true);

// ── Los inactivos no cuentan en ningún lado ──
[["js/motor-calificacion.js", "motor (y Qué le falta, que lo usa)"], ["js/tareas.js", "Tareas"], ["js/dashboard.js", "Inicio"], ["js/hoy.js", "Hoy"]].forEach(([f, n]) => {
	const s = leer(f);
	const lecturas = s.split('from("productos_sesion")').slice(1).map((t) => t.slice(0, 400));
	const selects = lecturas.filter((t) => /^\s*\.select\(/.test(t));
	ok(n + ": toda lectura de productos filtra activo = true", selects.length > 0 && selects.every((t) => /\.eq\("activo", true\)/.test(t)), true);
});
ok("Qué le falta usa el detalle del motor (sin leer productos por su cuenta)", /from\("productos_sesion"\)/.test(leer("js/que-le-falta.js")), false);

// ── Inicio con varios proyectos activos ──
const dj = leer("js/dashboard.js");
ok("Inicio: lee TODOS los proyectos activos (sin .limit(1))", /\.eq\("estado", "activo"\)\s*\.order\("created_at", \{ ascending: true \}\)\)\)/.test(dj) && !/\.limit\(1\)/.test(dj), true);
ok("Inicio: una tarjeta por proyecto (renderProyectos → crearCardProyecto)", /proyectosActivos\.forEach\(\(proyecto\) =>/.test(dj) && /crearCardProyecto\(proyecto/.test(dj), true);
ok("Inicio: terminar sesión es por proyecto (completa solo ese)",
	/async function terminarSesion\(sesionId, notasCierre, proyecto\)/.test(dj) && /\.eq\("proyecto_id", proyecto\.id\)/.test(dj) && /\.eq\("id", proyecto\.id\)/.test(dj), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
