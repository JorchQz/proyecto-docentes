/*
	Crear proyecto: abrir un proyecto y guardarlo SIN CAMBIOS no borra ni recrea nada
	(encontrado con PP-NIVELES de Fanny, 2026-09-27).

	Antes, al abrir un proyecto importado del bot (cierre "igual para todos" con tareas POR GRADO)
	y guardar, la pantalla armaba cierre_tareas = { mode: "todos", todos: [] } y el materializador
	borraba las tareas por grado de las sesiones 3, 6, 9, 12 y 15. También se perdían los pasos
	por grupo de trabajo ("Morado") y un PDA que la lista de la sesión no ofrecía (pda_sesion
	vacío → el materializador quitaba el PDA). Esta prueba arma la fila como la arma la pantalla
	(las mismas funciones de js/proyecto-edicion.js que usa js/crear_proyecto.js), la compara con
	lo guardado (ProyectoEdicion.cambiosDeSesion) y le pasa el resultado al materializador
	(SesionesMaterializar.planificar, la regla sin base de datos).

	node pruebas/guardar-sin-cambios.test.js
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
const SM = global.window.SesionesMaterializar;
const PE = require("../js/proyecto-edicion.js");
const TS = require("../js/texto-sesion.js");
const has = (fn) => typeof PE[fn] === "function";
["tareasDelCierre", "modoTareasAlAbrir", "actividadesDeSeccion", "pdaSesionConservando"].forEach((fn) => {
	ok("ProyectoEdicion." + fn + " existe", has(fn), true);
});
if (!has("tareasDelCierre") || !has("actividadesDeSeccion") || !has("pdaSesionConservando")) {
	console.log("\n" + fallos + " FALLAS");
	process.exit(1);
}

// ── Una sesión como la del bot (S3 de PP-NIVELES): cierre igual para todos, tareas por grado,
// pasos por grupo de trabajo y PDA por grado
const guardada = {
	id: "s3", numero_sesion: 3, campo_formativo: "Ética, Naturaleza y Sociedades", momento: "Punto de partida",
	duracion: null, fecha: null,
	inicio_todos: "10:50 a 11:05 · Regreso a la calma", inicio_diferenciado: null,
	inicio_actividades: { mode: "todos", todos: ["Regreso del recreo"], diferenciado: null },
	desarrollo_todos: "11:05 a 11:55 · Reglamento", desarrollo_diferenciado: null,
	desarrollo_actividades: { mode: "todos", todos: ["Tarjetas de reglas", "Votación"],
		diferenciado: { Azul: ["Copia las reglas en tiras."], Morado: ["Colorea y pega los dibujos."], Naranja: ["Traza la palabra clave."] },
		orden_grupos: ["Morado", "Naranja", "Azul"] },
	cierre_todos: "11:55 a 12:30 · Cuento 1", cierre_diferenciado: null,
	cierre_actividades: { mode: "todos", todos: ["Cuento 1"], diferenciado: null },
	cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 1: ["Dibuja la regla."], 2: ["Escribe la regla."] } },
	pda_sesion: [
		{ grado: 1, pda_id: "pda-1", pda_texto: "Participa en acuerdos", criterio_aplicado: "Vota por una regla" },
		{ grado: 2, pda_id: "pda-2", pda_texto: "Participa en normas", criterio_aplicado: "Propone una consecuencia" },
	],
	recursos: { links: [{ titulo: "Carpeta de la sesión 3", url: "https://drive.google.com/drive/folders/x" }], archivos: [] },
	observaciones: "Sesión 3",
};

// Lo que la pantalla muestra al abrir (restoreSessionBlocks) y lo que vuelve a leer al guardar
// (payloadDeBloque), sin que la docente toque nada
const modoCierre = guardada.cierre_actividades.mode;
const modoTareas = PE.modoTareasAlAbrir(guardada.cierre_tareas, modoCierre);
ok("al abrir: cierre igual para todos con tareas POR GRADO", [modoCierre, modoTareas], ["todos", "grado"]);
const pantalla = {
	numero_sesion: 3, duracion: "", campo_formativo: guardada.campo_formativo, momento: guardada.momento,
	inicio_todos: guardada.inicio_todos, inicio_diferenciado: null,
	inicio_actividades: PE.actividadesDeSeccion("todos", { todos: guardada.inicio_actividades.todos, grupos: TS.gruposDe(guardada.inicio_actividades) }),
	desarrollo_todos: guardada.desarrollo_todos, desarrollo_diferenciado: null,
	desarrollo_actividades: PE.actividadesDeSeccion("todos", { todos: guardada.desarrollo_actividades.todos, grupos: TS.gruposDe(guardada.desarrollo_actividades) }),
	cierre_todos: guardada.cierre_todos, cierre_diferenciado: null,
	cierre_actividades: PE.actividadesDeSeccion("todos", { todos: guardada.cierre_actividades.todos, grupos: [] }),
	cierre_tareas: PE.tareasDelCierre(modoCierre, modoTareas, { todos: [], porGradoDif: {}, porGrado: { 1: ["Dibuja la regla."], 2: ["Escribe la regla."] } }),
	recursos: { archivos: [], links: guardada.recursos.links },
	pda_sesion: PE.pdaSesionConservando([
		{ grado: 1, representable: true, entrada: guardada.pda_sesion[0] },
		{ grado: 2, representable: true, entrada: guardada.pda_sesion[1] },
	], guardada.pda_sesion),
	observaciones: guardada.observaciones,
};
ok("guardar sin cambios: la fila es la misma (no se manda PATCH)", PE.cambiosDeSesion(pantalla, guardada), {});
ok("los pasos por grupo de trabajo se leen en su orden", TS.gruposDe(guardada.desarrollo_actividades).map((g) => g.llave), ["Morado", "Naranja", "Azul"]);

// El materializador con esa fila (reedición: la anterior es la guardada) no borra ni crea nada
const productos = [
	{ id: "p-morado", sesion_id: "s3", tipo: "trabajo", nombre: "Reglamento · Morado", grados: [], campo: "ETI", modalidad: "diferenciada", created_at: "2026-09-27T10:00:00.001Z" },
	{ id: "p-naranja", sesion_id: "s3", tipo: "trabajo", nombre: "Reglamento · Naranja", grados: ["1"], campo: "ETI", modalidad: "diferenciada", created_at: "2026-09-27T10:00:00.002Z" },
	{ id: "p-2", sesion_id: "s3", tipo: "trabajo", nombre: "Reglamento · 2°", grados: ["2"], campo: "ETI", modalidad: "diferenciada", created_at: "2026-09-27T10:00:00.003Z" },
	{ id: "t-1", sesion_id: "s3", tipo: "tarea", nombre: "Dibuja la regla.", grados: ["1"], campo: "ETI", modalidad: "diferenciada", created_at: "2026-09-27T10:00:01Z" },
	{ id: "t-2", sesion_id: "s3", tipo: "tarea", nombre: "Escribe la regla.", grados: ["2"], campo: "ETI", modalidad: "diferenciada", created_at: "2026-09-27T10:00:01Z" },
];
const spda = [
	{ id: "sp1", sesion_id: "s3", pda_id: "pda-1", grado: 1, criterio_aplicado: "Vota por una regla" },
	{ id: "sp2", sesion_id: "s3", pda_id: "pda-2", grado: 2, criterio_aplicado: "Propone una consecuencia" },
];
const opts = { gradosProyecto: ["1", "2"], camposProyecto: ["Ética, Naturaleza y Sociedades"], anteriores: { s3: guardada } };
const nueva = Object.assign({}, guardada, pantalla, { id: "s3" });
const plan = SM.planificar([nueva], { spda: spda, productos: productos }, opts);
ok("materializar lo guardado: 0 productos nuevos, 0 borrados, 0 actualizados",
	[plan.productosInsertar.length, plan.productosBorrar.length, plan.productosActualizar.length], [0, 0, 0]);
ok("materializar lo guardado: 0 PDA nuevos, 0 borrados, 0 actualizados",
	[plan.spdaInsertar.length, plan.spdaBorrar.length, plan.spdaActualizar.length], [0, 0, 0]);

// Así quedaba antes (la pantalla solo sabía "todos" con el cierre igual para todos): se borraban
// las dos tareas. Documenta el defecto que se corrigió.
const antes = Object.assign({}, nueva, { cierre_tareas: { mode: "todos", todos: [], diferenciado: null } });
const planAntes = SM.planificar([antes], { spda: spda, productos: productos }, opts);
ok("(antes) con tareas 'para todos' vacías el materializador borraba las 2 tareas", planAntes.productosBorrar.sort(), ["t-1", "t-2"]);

// ── Tareas del cierre ──
ok("tareas por grado con el cierre igual para todos: solo los grados con tareas",
	PE.tareasDelCierre("todos", "grado", { porGrado: { 1: [" Lee "], 2: [] } }), { mode: "diferenciado", todos: null, diferenciado: { 1: ["Lee"] } });
ok("tareas iguales para todos", PE.tareasDelCierre("todos", "todos", { todos: ["A", " "], porGrado: { 1: ["no"] } }), { mode: "todos", todos: ["A"], diferenciado: null });
ok("cierre diferenciado: las columnas como siempre", PE.tareasDelCierre("diferenciado", "grado", { porGradoDif: { 3: ["X"], 4: [] } }),
	{ mode: "diferenciado", todos: null, diferenciado: { 3: ["X"], 4: [] } });
ok("al abrir: cierre diferenciado → las tareas van en sus columnas", PE.modoTareasAlAbrir(guardada.cierre_tareas, "diferenciado"), "todos");
ok("al abrir: sin tareas → iguales para todos", PE.modoTareasAlAbrir(null, "todos"), "todos");

// ── Pasos por grupo de trabajo ──
ok("grupos en modo diferenciado: junto a los grados, con su orden",
	PE.actividadesDeSeccion("diferenciado", { todos: ["ignorado"], porGrado: { 1: ["A"] }, grupos: [{ llave: "Círculos", items: ["B"] }] }),
	{ mode: "diferenciado", todos: null, diferenciado: { 1: ["A"], "Círculos": ["B"] }, orden_grupos: ["Círculos"] });
ok("un grupo sin pasos se quita (y sin grupos no hay orden_grupos)",
	PE.actividadesDeSeccion("todos", { todos: ["A"], grupos: [{ llave: "Morado", items: ["", " "] }] }), { mode: "todos", todos: ["A"], diferenciado: null });

// ── PDA que la sesión no ofrece en su lista: se conservan ──
ok("sin lista de PDA para un grado: se conserva lo guardado",
	PE.pdaSesionConservando([{ grado: 1, representable: false, entrada: null }, { grado: 2, representable: true, entrada: null }], guardada.pda_sesion),
	[guardada.pda_sesion[0]]);
ok("con lista: lo que dice la pantalla (se puede quitar)",
	PE.pdaSesionConservando([{ grado: 1, representable: true, entrada: null }, { grado: 2, representable: true, entrada: null }], guardada.pda_sesion), null);

// ── Vacío = vacío ──
ok("null y el objeto vacío de la pantalla son lo mismo (no se reescribe una sesión sin tareas)",
	PE.cambiosDeSesion({ cierre_tareas: { mode: "todos", todos: [], diferenciado: null }, pda_sesion: null, recursos: { archivos: [], links: [] } },
		{ cierre_tareas: null, pda_sesion: [], recursos: null }), {});
ok("pero quitar todas las tareas sí es un cambio",
	Object.keys(PE.cambiosDeSesion({ cierre_tareas: { mode: "todos", todos: [], diferenciado: null } }, { cierre_tareas: { mode: "todos", todos: ["Leer"], diferenciado: null } })), ["cierre_tareas"]);

// ── crear_proyecto.js usa estas reglas al leer la pantalla y al abrir ──
const cp = leer("js/crear_proyecto.js");
ok("crear_proyecto: las tareas se leen con ProyectoEdicion.tareasDelCierre (guardar y borrador)", (cp.match(/ProyectoEdicion\.tareasDelCierre\(/g) || []).length, 2);
ok("crear_proyecto: los pasos se leen con ProyectoEdicion.actividadesDeSeccion (guardar y borrador)", (cp.match(/ProyectoEdicion\.actividadesDeSeccion\(/g) || []).length, 2);
ok("crear_proyecto: el PDA que no se puede mostrar se conserva", /ProyectoEdicion\.pdaSesionConservando\(leidas, original\)/.test(cp), true);
ok("crear_proyecto: al abrir, tareas por grado con el cierre igual para todos", /modoTareasAlAbrir\(data\.cierre_tareas, modoCierre\) === 'grado'/.test(cp), true);
ok("crear_proyecto: al abrir, pinta los pasos por grupo de trabajo", /pintarGruposTrabajo\(section, key, window\.TextoSesion\.gruposDe\(actData\)\)/.test(cp), true);
ok("crear_proyecto.html: carga js/texto-sesion.js antes de crear_proyecto.js",
	leer("crear_proyecto.html").indexOf('src="js/texto-sesion.js"') > 0 && leer("crear_proyecto.html").indexOf('src="js/texto-sesion.js"') < leer("crear_proyecto.html").indexOf('src="js/crear_proyecto.js"'), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
