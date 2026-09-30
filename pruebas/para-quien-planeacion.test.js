/*
	"¿Para quién?" también al planear (crear / editar proyecto), decisión de Jorge del 2026-09-26.

	  - La sesión lista lo que VA a materializar con la MISMA regla del materializador
	    (SesionesMaterializar.huecosDeSesion / emparejarPlan, exportadas sin cambiar la regla).
	  - Los grados del producto no cambian: "para quién" se guarda solo como filas incluir /
	    excluir (ProductosHoy.filasDeEdicion); marcar a todos los de otro grado los incluye uno
	    por uno.
	  - Un alumno con calificación en ese producto sale marcado y bloqueado.
	  - Resumen de cada renglón: "3° (todos)", "3° (sin 1 alumno)", "3° + 2 alumnos de 2°".
	  - Si cambia el texto de una tarea, su clave cambia (vuelve al predeterminado).
	  - crear_proyecto.js guarda con guardar_asignacion_producto DESPUÉS de materializar.

	node pruebas/para-quien-planeacion.test.js
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

global.window = {};
require("../js/campos-formativos.js");
require("../js/sesiones-materializar.js");
require("../js/alcance-hoy.js");
require("../js/productos-hoy.js");
require("../js/para-quien.js");
const SM = global.window.SesionesMaterializar;
const PQ = global.window.ParaQuien;
const PH = global.window.ProductosHoy;

// ── 1. Huecos: la regla del materializador ───────────────────────────────────
const sesTodos = { id: "s1", numero_sesion: 1, campo_formativo: "Lenguajes", pda_sesion: null,
	cierre_tareas: { mode: "todos", todos: ["Traer una hoja"], diferenciado: null } };
const huecosMulti = SM.huecosDeSesion(sesTodos, ["3", "4"]);
ok("multigrado 3° y 4°: un trabajo por grado y la tarea para los dos",
	huecosMulti.map((h) => [h.tipo, h.grados, h.nombre || ""]), [["trabajo", [3], ""], ["trabajo", [4], ""], ["tarea", [3, 4], "Traer una hoja"]]);
ok("un solo grado: un trabajo compartido", SM.huecosDeSesion(Object.assign({}, sesTodos, { cierre_tareas: null }), ["3"]).map((h) => [h.tipo, h.grados, h.modalidad]),
	[["trabajo", [3], "compartida"]]);
const sesDif = { id: "s2", numero_sesion: 2, campo_formativo: "Lenguajes",
	cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 3: ["Leer"], 4: ["Escribir", "Dibujar"] } } };
ok("tareas diferenciadas: cada una con su grado", SM.huecosDeSesion(sesDif, [3, 4]).filter((h) => h.tipo === "tarea").map((h) => [h.nombre, h.grados]),
	[["Leer", [3]], ["Escribir", [4]], ["Dibujar", [4]]]);
ok("sin grados no se materializa nada", SM.huecosDeSesion(sesTodos, []), []);
ok("los grados de sus PDA también cuentan (como el materializador)",
	SM.huecosDeSesion(Object.assign({}, sesTodos, { cierre_tareas: null, pda_sesion: [{ grado: 5, pda_id: "p" }] }), [3]).map((h) => h.grados), [[3], [5]]);

// ── 2. Emparejar: mismo tipo, grados y nombre; solo los de la sesión; el más viejo primero ──
const prods = [
	{ id: "t4", sesion_id: "s1", tipo: "trabajo", grados: ["4"], created_at: "2026-09-01T10:00:01Z" },
	{ id: "t3b", sesion_id: "s1", tipo: "trabajo", grados: ["3"], created_at: "2026-09-01T10:00:05Z" },
	{ id: "t3", sesion_id: "s1", tipo: "trabajo", grados: ["3"], created_at: "2026-09-01T10:00:00Z" },
	{ id: "ta", sesion_id: "s1", tipo: "tarea", nombre: "Traer una hoja", grados: ["3", "4"], created_at: "2026-09-01T10:00:02Z" },
	{ id: "otra", sesion_id: "s9", tipo: "trabajo", grados: ["3"], created_at: "2026-09-01T09:00:00Z" },
];
ok("emparejarPlan: cada hueco con su producto (el más viejo; otra sesión no cuenta)",
	SM.emparejarPlan(sesTodos, [3, 4], prods).map((p) => p.producto && p.producto.id), ["t3", "t4", "ta"]);
ok("emparejarPlan: la tarea renombrada ya no empareja (se crearía otra)",
	SM.emparejarPlan(Object.assign({}, sesTodos, { cierre_tareas: { mode: "todos", todos: ["Traer dos hojas"] } }), [3, 4], prods).map((p) => p.producto && p.producto.id),
	["t3", "t4", null]);
// Coherencia con planificar: lo que emparejarPlan deja sin producto es lo que el materializador inserta
const plan = SM.planificar([sesDif], { spda: [], productos: prods.filter((p) => p.sesion_id === "s1").map((p) => Object.assign({}, p, { sesion_id: "s2" })) },
	{ gradosProyecto: [3, 4], camposProyecto: ["Lenguajes"] });
const pares = SM.emparejarPlan(sesDif, [3, 4], prods.filter((p) => p.sesion_id === "s1").map((p) => Object.assign({}, p, { sesion_id: "s2" })));
ok("coherente con planificar: los huecos sin producto son los que se insertan",
	pares.filter((p) => !p.producto).map((p) => p.hueco.tipo + ":" + (p.hueco.nombre || p.hueco.grados.join(","))),
	plan.productosInsertar.map((f) => f.tipo + ":" + (f.tipo === "tarea" ? f.nombre : f.grados.join(","))));

// ── 3. Renglones de la sesión ────────────────────────────────────────────────
const conHoy = prods.concat([
	{ id: "hoy1", sesion_id: "s1", tipo: "trabajo", nombre: "Maqueta", grados: ["3", "4"], created_at: "2026-09-02T10:00:00Z" },
	{ id: "hoy2", sesion_id: "s1", tipo: "tarea", nombre: "Quitada", grados: ["3"], activo: false, created_at: "2026-09-02T10:00:01Z" },
]);
let r = PQ.renglonesDeSesion(sesTodos, [3, 4], conHoy);
ok("renglones: etiquetas", r.renglones.map((x) => x.etiqueta), ["Trabajo de 3°", "Trabajo de 4°", "Tarea: Traer una hoja"]);
ok("renglones: claves del materializador (tipo, grados, nombre) + repetición",
	r.renglones.map((x) => x.clave), ["trabajo|3||1", "trabajo|4||1", "tarea|3,4|Traer una hoja|1"]);
ok("renglones: lo agregado en Hoy (activo) no se lista y se cuenta; el del plan duplicado (t3b) también es de Hoy", r.deHoy, 2);
// Fase 5 (2026-09-30): además de contarlos, los devuelve (Crear proyecto los lista por nombre y para quién, de solo lectura)
ok("renglones: extras = los activos que no son del plan, en el orden en que llegan (sin el quitado ni los de otra sesión); deHoy es cuántos",
	[r.extras.map((p) => p.id), r.deHoy === r.extras.length], [["t3b", "hoy1"], true]);
ok("renglones: el producto quitado en Hoy no cuenta", r.renglones.some((x) => x.producto && x.producto.id === "hoy2"), false);
const renombrada = PQ.renglonesDeSesion(Object.assign({}, sesTodos, { cierre_tareas: { mode: "todos", todos: ["Traer dos hojas"] } }), [3, 4], conHoy);
ok("cambiar el texto de la tarea cambia su clave (su elección vuelve al predeterminado)",
	renombrada.renglones[2].clave !== r.renglones[2].clave && renombrada.renglones[2].producto === null, true);
ok("dos tareas con el mismo nombre: claves distintas",
	PQ.renglonesDeSesion(Object.assign({}, sesTodos, { cierre_tareas: { mode: "todos", todos: ["Leer", "Leer"] } }), [3], []).renglones.filter((x) => x.hueco.tipo === "tarea").map((x) => x.clave),
	["tarea|3|Leer|1", "tarea|3|Leer|2"]);
ok("sesión trabajada (soloConProducto): solo lo que ya tiene producto",
	PQ.renglonesDeSesion(Object.assign({}, sesTodos, { cierre_tareas: { mode: "todos", todos: ["Nueva"] } }), [3, 4], prods, { soloConProducto: true }).renglones.map((x) => x.etiqueta),
	["Trabajo de 3°", "Trabajo de 4°"]);
ok("sesión nueva sin productos: todo sale con su grado", PQ.renglonesDeSesion(sesTodos, [3, 4], []).renglones.map((x) => [x.producto, x.grados]),
	[[null, [3]], [null, [4]], [null, [3, 4]]]);

// ── 4. Filas con grados fijos ────────────────────────────────────────────────
const alumnos = [
	{ id: "a1", nombre_completo: "Ana", grado: 2 }, { id: "a2", nombre_completo: "Beto", grado: 2 },
	{ id: "b1", nombre_completo: "Carla", grado: 3 }, { id: "b2", nombre_completo: "Dani", grado: 3 }, { id: "b3", nombre_completo: "Eva", grado: 3 },
];
const omision = PQ.quierenPorOmision([3], alumnos, {});
ok("por omisión: marcados los de su grado", Object.keys(omision), ["b1", "b2", "b3"]);
ok("por omisión respeta lo guardado (regla de AlcanceHoy.asignadoA)", Object.keys(PQ.quierenPorOmision([3], alumnos, { b2: "excluir", a1: "incluir" })), ["a1", "b1", "b3"]);
ok("quitar a uno de 3° e incluir a uno de 2°: excluir + incluir; los grados no cambian",
	PH.filasDeEdicion([3], alumnos, { b1: true, b3: true, a2: true }), [{ alumno_id: "a2", modo: "incluir" }, { alumno_id: "b2", modo: "excluir" }]);
ok("marcar a TODOS los de 2°: se incluyen uno por uno (el producto sigue siendo de 3°)",
	PQ.asignacionDe([3], alumnos, { a1: true, a2: true, b1: true, b2: true, b3: true }), { a1: "incluir", a2: "incluir" });
ok("sin cambios: ninguna fila", PH.filasDeEdicion([3], alumnos, omision), []);
ok("misma asignación: filas vacías = por omisión", PQ.mismaAsignacion([3], alumnos, PQ.asignacionDe([3], alumnos, omision), {}), true);
ok("distinta asignación", PQ.mismaAsignacion([3], alumnos, { b1: "excluir" }, {}), false);

// ── 5. Bloqueo de alumnos con calificación ───────────────────────────────────
const cal = PQ.indiceCalificaciones([
	{ alumno_id: "b1", producto_sesion_id: "t3", nivel: "verde" },
	{ alumno_id: "b2", producto_sesion_id: "t3", estado_entrega: null, nivel: null, puntaje: null, retroalimentacion: null },
	{ alumno_id: "b3", producto_sesion_id: "t4", puntaje: 0 },
]);
ok("bloqueado solo quien tiene captura en ESE producto", PQ.bloqueados("t3", alumnos, cal), { b1: true });
ok("puntaje 0 cuenta como captura", PQ.bloqueados("t4", alumnos, cal), { b3: true });
ok("producto que aún no existe: nadie bloqueado", PQ.bloqueados(null, alumnos, cal), {});
const html = PQ.listaAlumnosHtml(alumnos, "pqAlumno", { b2: true }, { b1: true });
ok("lista: por grado", (html.match(/° grado<\/p>/g) || []).length, 2);
ok("lista: el bloqueado sale marcado, deshabilitado y con el aviso",
	/value='b1' checked disabled/.test(html) && html.includes("Ya tiene calificación: no se puede quitar"), true);
ok("lista: casillas con alto de 44", (html.match(/min-h-\[44px\]/g) || []).length, alumnos.length);
ok("lista: escapa el nombre", PQ.listaAlumnosHtml([{ id: "x", nombre_completo: "<b>O'Hara</b>", grado: 1 }], "n", {}, {}).includes("&lt;b&gt;O&#39;Hara&lt;/b&gt;"), true);

// ── 6. Resumen ───────────────────────────────────────────────────────────────
ok("resumen: todos", PQ.resumen([3], {}, alumnos), "3° (todos)");
ok("resumen: sin 1 alumno", PQ.resumen([3], { b2: "excluir" }, alumnos), "3° (sin 1 alumno)");
ok("resumen: + 2 alumnos de 2°", PQ.resumen([3], { a1: "incluir", a2: "incluir" }, alumnos), "3° + 2 alumnos de 2°");
ok("resumen: sin 1 y con 1 de otro grado", PQ.resumen([3], { b2: "excluir", a1: "incluir" }, alumnos), "3° (sin 1 alumno) + 1 alumno de 2°");
ok("resumen: todos los de 3° fuera y 2 de 2°", PQ.resumen([3], { b1: "excluir", b2: "excluir", b3: "excluir", a1: "incluir", a2: "incluir" }, alumnos), "2 alumnos de 2°");
ok("resumen: multigrado", PQ.resumen([2, 3], {}, alumnos), "2° y 3° (todos)");
ok("resumen: grado sin alumnos en el grupo", PQ.resumen([4], {}, alumnos), "4° (no hay alumnos de ese grado en el grupo)");

// ── 7. Uso en crear proyecto ─────────────────────────────────────────────────
const cp = leer("js/crear_proyecto.js"), cph = leer("crear_proyecto.html");
const pos = (s) => cph.indexOf('src="js/' + s + '"');
ok("crear_proyecto.html: carga alcance-hoy, productos-hoy y para-quien (después del materializador) antes de crear_proyecto.js",
	[pos("alcance-hoy.js") > 0, pos("productos-hoy.js") > 0, pos("sesiones-materializar.js") < pos("para-quien.js"),
		pos("productos-hoy.js") < pos("para-quien.js"), pos("para-quien.js") < pos("crear_proyecto.js")], [true, true, true, true, true]);
const nuevo = cp.slice(cp.indexOf("async function guardarNuevo"), cp.indexOf("async function guardarEdicion"));
ok("guardarNuevo: guarda el para quién después de materializar y dentro del try que revierte",
	nuevo.indexOf("await guardarParaQuien(") > nuevo.indexOf("await window.materializarSesiones(") && nuevo.indexOf("await guardarParaQuien(") < nuevo.indexOf("} catch (err) {"), true);
const edicion = cp.slice(cp.indexOf("async function guardarEdicion"), cp.indexOf("document.getElementById('btnGuardar')"));
ok("guardarEdicion: después de materializar y antes de devolver; su error no llega a \"guardado\"",
	edicion.indexOf("await guardarParaQuien(") > edicion.indexOf("await window.materializarSesiones(") && /if \(errorPQ\) await pqRecargar\(\);/.test(edicion) && /if \(errorPQ\) throw errorPQ;\s*return proyectoId;/.test(edicion), true);
ok("guarda con guardar_asignacion_producto y filasDeEdicion (grados del producto fijos)",
	/ProductosHoy\.filasDeEdicion\(r\.producto\.grados, alumnosGrupo, elegido\.quieren\)/.test(cp) && /rpc\('guardar_asignacion_producto'/.test(cp), true);
ok("edición: lee producto_sesion_alumnos y calificaciones de los productos de sus sesiones",
	/from\('producto_sesion_alumnos'\)/.test(cp) && /await cargarEstadoParaQuien\(sesiones\.map/.test(cp), true);
ok("el borrador guarda la elección", /_paraQuien:\s+pqParaBorrador\(block\)/.test(cp) && /pqDesdeBorrador\(data\._paraQuien\)/.test(cp), true);
ok("botón Cambiar de 44 px", /pq-cambiar shrink-0 min-h-\[44px\] min-w-\[44px\]/.test(cp), true);

// El diálogo compartido es accesible
const pqf = leer("js/para-quien.js");
ok("diálogo: role=dialog, aria-modal, Esc cierra, foco atrapado y vuelve al botón",
	[/setAttribute\("role", "dialog"\)/.test(pqf), /aria-modal/.test(pqf), /e\.key === "Escape"/.test(pqf), /e\.key !== "Tab"/.test(pqf), /previo\.focus\(\)/.test(pqf)],
	[true, true, true, true, true]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
