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
// Fase 4 (2026-09-29): "+ Actividad o tarea" vive en js/actividad-nueva.js (sacado de agregarProducto de Hoy) y el diálogo
// accesible es el de js/para-quien.js (Hoy ya no tiene uno propio)
const nueva = leer("js/actividad-nueva.js"), pq = leer("js/para-quien.js");
ok("Hoy: sin window.prompt", /window\.prompt/.test(hoy) || /window\.prompt/.test(nueva), false);
ok("Hoy: diálogo accesible (role=dialog, aria-modal, Esc) de js/para-quien.js, el mismo en Hoy y en el diálogo nuevo",
	/setAttribute\("role", "dialog"\)/.test(pq) && /aria-modal/.test(pq) && /e\.key === "Escape"/.test(pq) &&
	/window\.ParaQuien\.abrirDialogo\(\{/.test(hoy) && /raiz\.ParaQuien\.abrirDialogo\(\{/.test(nueva) && !/function abrirDialogo\(/.test(hoy) && !/function listaAlumnosHtml\(/.test(hoy), true);
// Desde 2026-09-26 (fase 2) el día por omisión es el siguiente día de CLASE (calendario SEP y ajustes del grupo)
ok("Hoy: el diálogo valida con ProductosHoy.validarNuevo y el día por omisión es venceTarea",
	/PH\(\)\.validarNuevo\(datos, ctxV\)/.test(nueva) && /PH\(\)\.validarSuelta\(datos, ctxV\)/.test(nueva) && /raiz\.AlcanceHoy\.venceTarea\(null, hoy, ctx\.ajustesCal \|\| \[\]\)/.test(nueva) &&
	/ajustesCal: ajustesCal/.test(hoy), true);
// Fase 5 (2026-09-30): Renombrar y Quitar viven en js/producto-acciones.js (sacados tal cual de Hoy; los usa también la
// vista del proyecto). Hoy le pasa lo suyo: lo capturado en pantalla (también lo pendiente de enviar) y cómo se redibuja
const acciones = leer("js/producto-acciones.js");
ok("Hoy: agregar, renombrar y quitar dicen que necesitan señal",
	[(hoy.match(/necesita señal/g) || []).length >= 2, /"Renombrar necesita señal\. "/.test(acciones), /"Quitar necesita señal\. "/.test(acciones)], [true, true, true]);
ok("Hoy: quitar revisa calificaciones (pantalla y base) antes de poner activo = false (js/producto-acciones.js)",
	/tieneCaptura\(calificaciones\[/.test(hoy) && /window\.ProductoAcciones\.quitar\(/.test(hoy) &&
	/\.eq\("producto_sesion_id", producto\.id\)/.test(acciones) && /update\(\{ activo: false \}\)/.test(acciones) &&
	acciones.indexOf('.eq("producto_sesion_id", producto.id)') < acciones.indexOf("update({ activo: false })") && !/update\(\{ activo: false \}\)/.test(hoy), true);
ok("Hoy: renombrar actualiza productos_sesion.nombre (js/producto-acciones.js)",
	/window\.ProductoAcciones\.renombrar\(/.test(hoy) && /update\(\{ nombre: v\.nombre \}\)/.test(acciones) && !/update\(\{ nombre: v\.nombre \}\)/.test(hoy), true);
ok("hoy.html: carga js/producto-acciones.js (después del diálogo) antes de js/hoy.js",
	hoyHtml.indexOf('src="js/para-quien.js"') < hoyHtml.indexOf('src="js/producto-acciones.js"') && hoyHtml.indexOf('src="js/producto-acciones.js"') < hoyHtml.indexOf('src="js/hoy.js"'), true);
// Fase 2: producto, "para quién" y PDA se guardan juntos en la base (agregar_producto_sesion, mi_salon_b17)
ok("Hoy: el producto nuevo se liga a los PDA de la sesión de sus grados (en la misma transacción)",
	/rpc\("agregar_producto_sesion"/.test(nueva) && /p_ligar: ligas\.ligar, p_crear: ligas\.crear/.test(nueva) &&
	/insert into public\.producto_sesion_pda \(producto_sesion_id, sesion_pda_id\)\s*select v_prod\.id, sp\.id from public\.sesiones_pda sp/.test(leer("supabase/mi_salon_b17_flujo_libre_2026-09.sql")), true);
ok("Hoy: Trabajar hoy usa siguientesPorProyecto (sin .slice(0, 4))", /ProductosHoy\.siguientesPorProyecto/.test(hoy) && !/\.slice\(0, 4\)/.test(hoy), true);
ok("hoy.html: carga js/productos-hoy.js antes de js/hoy.js",
	hoyHtml.indexOf('src="js/productos-hoy.js"') > 0 && hoyHtml.indexOf('src="js/productos-hoy.js"') < hoyHtml.indexOf('src="js/hoy.js"'), true);
ok("hoy.html: carga js/para-quien.js y js/actividad-nueva.js después de las reglas y antes de js/hoy.js",
	["js/para-quien.js", "js/actividad-nueva.js"].map((f) => hoyHtml.indexOf('src="' + f + '"')).every((i) => i > hoyHtml.indexOf('src="js/productos-hoy.js"') && i > hoyHtml.indexOf('src="js/alcance-hoy.js"') && i < hoyHtml.indexOf('src="js/hoy.js"')) &&
	hoyHtml.indexOf('src="js/para-quien.js"') < hoyHtml.indexOf('src="js/actividad-nueva.js"'), true);

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
	/async function terminarSesion\(sesionId, notasCierre, proyecto, dia\)/.test(dj) && /proyectoId: proyecto\.id/.test(dj) &&
	/\.eq\("proyecto_id", d\.proyectoId\)/.test(leer("js/sesion-terminar.js")) && /\.eq\("id", d\.proyectoId\)/.test(leer("js/sesion-terminar.js")), true);

// ── 8. Actividad de otro campo o fuera de la sesión: contenido y PDA del catálogo (opcional) ──
// Por omisión los PDA de la sesión si el campo coincide; un PDA que no está en la sesión se crea
// en sesiones_pda de esa sesión y grado para que cuente en evaluación formativa.
const tiene8 = ["fasesDeGrados", "buscarContenidos", "pdaDeSesionParaActividad", "pdaMarcadosPorOmision", "planLigas"].map((f) => typeof P[f] === "function");
ok("productos-hoy expone lo de contenido y PDA", tiene8, [true, true, true, true, true]);
if (tiene8.every(Boolean)) {
	ok("fases de los grados (4° y 5° → Fase 4 y Fase 5)", P.fasesDeGrados(["5", 4]), ["Fase 4", "Fase 5"]);
	const cat = [
		{ id: "c1", fase: "Fase 4", campo_formativo: "Saberes y Pensamiento Científico", contenido: "Estados físicos del agua", orden: 2 },
		{ id: "c2", fase: "Fase 4", campo_formativo: "Lenguajes", contenido: "Narración de sucesos del agua", orden: 1 },
		{ id: "c3", fase: "Fase 5", campo_formativo: "Saberes y Pensamiento Científico", contenido: "Ciclo del agua y la energía", orden: 1 },
		{ id: "c4", fase: "Fase 3", campo_formativo: "Saberes y Pensamiento Científico", contenido: "El agua en casa", orden: 1 },
	];
	ok("buscador: del campo elegido y de las fases de los grados, sin acentos", P.buscarContenidos(cat, "fisicos agua", "Saberes y Pensamiento Científico", ["Fase 4", "Fase 5"]).map((c) => c.id), ["c1"]);
	ok("buscador: varias fases, por fase y orden", P.buscarContenidos(cat, "agua", "Saberes y Pensamiento Científico", ["Fase 4", "Fase 5"]).map((c) => c.id), ["c1", "c3"]);
	const spda = [{ id: "sp3", pda_id: "pA", grado: 3 }, { id: "sp4", pda_id: "pB", grado: 4 }];
	ok("por omisión: los PDA de la sesión de esos grados si el campo coincide", P.pdaDeSesionParaActividad(spda, "LEN", "LEN", [4]).map((r) => r.id), ["sp4"]);
	ok("otro campo: no se ofrecen los PDA de la sesión", P.pdaDeSesionParaActividad(spda, "LEN", "SAB", [3, 4]), []);
	ok("los del plan del mismo campo salen marcados", P.pdaDeSesionParaActividad(spda, "LEN", "LEN", [4]).map((r) => r.marcado), [true]);
	// Un PDA de Saberes que se agregó desde Hoy a esta sesión de Lenguajes (su campo viene del catálogo)
	const conHoy = spda.concat([{ id: "spSab", pda_id: "pS", grado: 4, campo: "SAB" }]);
	ok("un PDA de otro campo agregado desde Hoy no se ofrece para una actividad del campo de la sesión",
		P.pdaDeSesionParaActividad(conHoy, "LEN", "LEN", [4]).map((r) => r.id), ["sp4"]);
	ok("…y sí para otra actividad de su campo, sin marcar", P.pdaDeSesionParaActividad(conHoy, "LEN", "SAB", [4]).map((r) => r.id + ":" + r.marcado), ["spSab:false"]);
	ok("PDA del contenido marcados solos: el único de cada grado", P.pdaMarcadosPorOmision([{ id: "x4", grado: 4 }, { id: "y5", grado: 5 }, { id: "z5", grado: 5 }], [4, 5]), ["x4"]);
	const plan = P.planLigas({ grados: ["4"], deSesion: ["sp4", "sp3"], deCatalogo: [{ pda_id: "pB", grado: 4 }, { pda_id: "pN", grado: 4 }, { pda_id: "pN", grado: 4 }, { pda_id: "pZ", grado: 5 }], spdaSesion: spda });
	ok("planLigas: liga los de la sesión de su grado, reutiliza el que ya está y crea el que falta (sin duplicar)", plan, { ligar: ["sp4"], crear: [{ pda_id: "pN", grado: 4 }] });
}
{
	// Fase 4 (2026-09-29): el diálogo de agregar vive en js/actividad-nueva.js
	const h = leer("js/actividad-nueva.js");
	ok("Hoy: el diálogo tiene buscador de contenidos y PDA opcionales", h.includes("PDA que evalúa") && h.includes("data-busca-contenido") && h.includes("(opcional)"), true);
	ok("Hoy: liga con lo elegido y crea el PDA que falta en sesiones_pda de la sesión (agregar_producto_sesion)",
		h.includes("PH().planLigas({ grados: plan.gradosPda") &&
		/insert into public\.sesiones_pda \(sesion_id, pda_id, grado, criterio_aplicado\)\s*values \(p_sesion, r\.pda_id, r\.grado, null\)/.test(leer("supabase/mi_salon_b17_flujo_libre_2026-09.sql")), true);
	ok("Hoy: Enter en el buscador no envía el diálogo", h.includes('refs.busca.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });'), true);
	const q = leer("js/que-le-falta.js"), m = leer("js/motor-calificacion.js");
	ok("Qué le falta: el PDA cuenta en el campo de su contenido del catálogo",
		q.includes("codigoCampo(campoCatalogo(sp)) || cSesion") && m.includes("catalogo_pda(pda, catalogo_contenidos(campo_formativo))"), true);
	ok("migración b16: v_avance_pda toma el campo del catálogo",
		leer("supabase/mi_salon_b16_pda_campo_catalogo_2026-09.sql").includes("COALESCE(cc.campo_formativo, s.campo_formativo) AS campo_formativo"), true);
}

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
