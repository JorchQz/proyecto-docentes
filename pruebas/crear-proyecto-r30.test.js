/*
	Crear proyecto tras R30 (2026-09-27): las dos regresiones de AQ y la defensa contra
	"[object Object]". Falla con el código de 1edc33b.

	A. Un cambio de MODO en una sección sin pasos en lista no se guardaba: mismoValor daba por
	   iguales { mode: "todos" } vacío y { mode: "diferenciado" } vacío.
	   - Caso 1: el Cierre de "Diferenciado" a "Igual para todos" con una tarea: quedaba
	     diferenciado y, al abrir y guardar sin cambios, la tarea se borraba (y su producto).
	   - Caso 2: el Desarrollo a "Diferenciado" con solo el texto de cada grado: al abrir y
	     guardar sin cambios se borraba el texto por grado y quedaba "[object Object]".
	   Ahora Crear proyecto compara con lo que la pantalla armó AL ABRIR (cambiosDeSesion con
	   alAbrir): se escribe solo lo que la docente cambió, también el modo; y sin alAbrir el modo
	   cuenta (dos objetos vacíos con distinto modo no son iguales).
	B. Un grado con 2 o más PDA guardados (proyectos de la tienda importados con el importador
	   nuevo) perdía todos menos el último al guardar sin cambios: se conservan todos.
	C. Nunca "[object Object]" en un texto: al abrir, un objeto nunca llega a una caja de texto; al
	   guardar, textoDeCampo lo quita.

	Se arma la fila como la arma la pantalla (las funciones de js/proyecto-edicion.js que usa
	js/crear_proyecto.js) y se le pasa al materializador (SesionesMaterializar.planificar).

	node pruebas/crear-proyecto-r30.test.js
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
["seccionAlAbrir", "textoDeCampo", "pdaGuardadosDeGrado"].forEach((fn) => ok("ProyectoEdicion." + fn + " existe", typeof PE[fn], "function"));
// Con el código de antes (1edc33b) no existen: se usa lo que hacía la pantalla, para que las
// pruebas de abajo muestren el defecto en vez de detenerse
if (typeof PE.seccionAlAbrir !== "function") {
	PE.seccionAlAbrir = (todos, dif, act) => {
		const modo = (act && act.mode) || "todos";
		const dato = todos || dif; // restoreSection recibía "*_todos || *_diferenciado"
		return { modo: modo, texto: modo === "todos" ? (dato ? String(dato) : "") : "", porGrado: modo !== "todos" && dato && typeof dato === "object" ? dato : {} };
	};
}
if (typeof PE.textoDeCampo !== "function") PE.textoDeCampo = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
if (typeof PE.pdaGuardadosDeGrado !== "function") PE.pdaGuardadosDeGrado = (o, g) => (Array.isArray(o) ? o : []).filter((p) => p && Number(p.grado) === Number(g));

const GRADOS = ["1", "2"];
/*
	Lo que la pantalla arma de una sesión guardada, sin que la docente toque nada: la misma lectura
	que restoreSessionBlocks + payloadDeBloque (secciones con seccionAlAbrir, tareas con
	modoTareasAlAbrir y tareasDelCierre, pasos con actividadesDeSeccion, PDA con pdaSesionConservando).
	ediciones: { seccion: { modo, texto, porGrado }, tareas: {...} } lo que la docente cambió.
*/
function pantalla(g, ed) {
	ed = ed || {};
	const fila = { numero_sesion: g.numero_sesion };
	["inicio", "desarrollo", "cierre"].forEach((k) => {
		const a = PE.seccionAlAbrir(g[k + "_todos"], g[k + "_diferenciado"], g[k + "_actividades"]);
		const e = ed[k] || {};
		const modo = e.modo || a.modo;
		const act = g[k + "_actividades"] || {};
		const texto = "texto" in e ? e.texto : (modo === a.modo ? a.texto : "");
		const porGrado = e.porGrado || (modo === a.modo ? a.porGrado : {});
		fila[k + "_todos"] = modo === "todos" ? PE.textoDeCampo(texto) : null;
		if (modo === "diferenciado") {
			const dif = {};
			GRADOS.forEach((gr) => { dif[gr] = PE.textoDeCampo(porGrado[gr]); });
			fila[k + "_diferenciado"] = dif;
		} else fila[k + "_diferenciado"] = null;
		const pasosTodos = modo === "todos" && a.modo === "todos" ? (act.todos || []) : [];
		fila[k + "_actividades"] = PE.actividadesDeSeccion(modo, { todos: pasosTodos, porGrado: {}, grupos: TS.gruposDe(act) });
	});
	const modoCierre = (ed.cierre && ed.cierre.modo) || PE.seccionAlAbrir(g.cierre_todos, g.cierre_diferenciado, g.cierre_actividades).modo;
	const t = ed.tareas || {};
	const ct = g.cierre_tareas || {};
	const modoTareas = t.modoTareas || PE.modoTareasAlAbrir(g.cierre_tareas, modoCierre);
	const todosGuardadas = ct.mode !== "diferenciado" ? (ct.todos || []) : [];
	const difGuardadas = ct.mode === "diferenciado" ? (ct.diferenciado || {}) : {};
	fila.cierre_tareas = PE.tareasDelCierre(modoCierre, modoTareas, {
		todos: t.todos || (modoCierre === "todos" && modoTareas === "todos" ? todosGuardadas : []),
		porGradoDif: t.porGradoDif || (modoCierre === "diferenciado" ? GRADOS.reduce((o, gr) => { o[gr] = [].concat(difGuardadas[gr] || []); return o; }, {}) : {}),
		porGrado: t.porGrado || (modoCierre === "todos" && modoTareas === "grado" ? difGuardadas : {}),
	});
	fila.pda_sesion = PE.pdaSesionConservando(GRADOS.map((gr) => {
		const suyos = PE.pdaGuardadosDeGrado(g.pda_sesion, gr);
		const elegido = (ed.pda || {})[gr] || suyos[suyos.length - 1] || null; // la lista muestra uno (el último)
		return { grado: Number(gr), representable: true, entrada: elegido };
	}), g.pda_sesion);
	return fila;
}
// Guardar en Crear proyecto: lo que cambió respecto a lo que la pantalla armó al abrir
function guardar(g, ed) {
	const alAbrir = pantalla(g);
	const fila = pantalla(g, ed);
	const cambios = PE.cambiosDeSesion(fila, g, alAbrir);
	return { cambios: cambios, fila: Object.assign({}, g, cambios) };
}
function materializar(nueva, anterior, productos, spda) {
	const p = SM.planificar([nueva], { spda: spda || [], productos: productos || [] }, {
		gradosProyecto: GRADOS, camposProyecto: ["Lenguajes"], anteriores: { [anterior.id]: anterior },
	});
	return {
		productos: [p.productosInsertar.length, p.productosBorrar.length, p.productosActualizar.length],
		pda: [p.spdaInsertar.length, p.spdaBorrar.length, p.spdaActualizar.length],
		borrar: p.productosBorrar,
	};
}

// ── A. Caso 1: el Cierre de "Diferenciado" a "Igual para todos" con una tarea ──
const s1 = {
	id: "s1", numero_sesion: 1, campo_formativo: "Lenguajes",
	inicio_todos: "Inicio S1", inicio_diferenciado: null, inicio_actividades: { mode: "todos", todos: ["Paso de inicio S1"], diferenciado: null },
	desarrollo_todos: null, desarrollo_diferenciado: { 1: "Desarrollo 1° S1", 2: "Desarrollo 2° S1" },
	desarrollo_actividades: { mode: "diferenciado", todos: null, diferenciado: { 1: ["Actividad 1° S1"], 2: ["Actividad 2° S1"] } },
	// Lo que dejó el paso "a" de R30: cierre diferenciado sin pasos, con una tarea por grado
	cierre_todos: null, cierre_diferenciado: { 1: null, 2: null },
	cierre_actividades: { mode: "diferenciado", todos: null, diferenciado: null },
	cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 1: ["Tarea dif 1° S1"], 2: ["Tarea dif 2° S1"] } },
	pda_sesion: null,
};
const caso1 = guardar(s1, { cierre: { modo: "todos", texto: "" }, tareas: { modoTareas: "todos", todos: ["Tarea para todos otra vez S1"] } });
ok("caso 1: al guardar, el modo del cierre SÍ se escribe (cierre_actividades) junto con la tarea",
	Object.keys(caso1.cambios).filter((k) => /^cierre_(actividades|tareas)$/.test(k)).sort(), ["cierre_actividades", "cierre_tareas"]);
ok("caso 1: queda 'Igual para todos' con la tarea para todos",
	[caso1.fila.cierre_actividades.mode, caso1.fila.cierre_tareas], ["todos", { mode: "todos", todos: ["Tarea para todos otra vez S1"], diferenciado: null }]);
const caso1b = guardar(caso1.fila, {});
ok("caso 1: abrir y guardar sin cambios no escribe nada", caso1b.cambios, {});
const prod1 = [
	{ id: "t1", sesion_id: "s1", tipo: "tarea", nombre: "Tarea para todos otra vez S1", grados: ["1", "2"], campo: "LEN", modalidad: "compartida", created_at: "2026-09-27T10:00:00Z" },
	{ id: "p1", sesion_id: "s1", tipo: "trabajo", nombre: "Producto — Sesión 1 · LEN", grados: ["1"], campo: "LEN", modalidad: "diferenciada", created_at: "2026-09-27T09:00:00Z" },
	{ id: "p2", sesion_id: "s1", tipo: "trabajo", nombre: "Producto — Sesión 1 · LEN", grados: ["2"], campo: "LEN", modalidad: "diferenciada", created_at: "2026-09-27T09:00:00Z" },
];
ok("caso 1: y el materializador no borra la tarea", materializar(caso1b.fila, caso1.fila, prod1).productos, [0, 0, 0]);
// Así pasaba antes (sin alAbrir y con el modo ignorado): el cierre seguía diferenciado y la tarea se iba
const antesCaso1 = Object.assign({}, caso1.fila, { cierre_actividades: s1.cierre_actividades });
const reabierta = Object.assign({}, antesCaso1, pantalla(antesCaso1));
ok("(antes) con el cierre guardado como diferenciado, reabrir borraba la tarea", materializar(reabierta, antesCaso1, prod1).borrar, ["t1"]);

// ── A. Caso 2: el Desarrollo a "Diferenciado" con solo el texto de cada grado ──
const s3 = {
	id: "s3", numero_sesion: 3, campo_formativo: "Lenguajes",
	inicio_todos: "Inicio S3", inicio_diferenciado: null, inicio_actividades: { mode: "todos", todos: [], diferenciado: null },
	desarrollo_todos: null, desarrollo_diferenciado: null, desarrollo_actividades: { mode: "todos", todos: [], diferenciado: null },
	cierre_todos: null, cierre_diferenciado: null, cierre_actividades: { mode: "todos", todos: [], diferenciado: null },
	cierre_tareas: { mode: "todos", todos: ["Tarea para todos S3"], diferenciado: null }, pda_sesion: null,
};
const caso2 = guardar(s3, { desarrollo: { modo: "diferenciado", porGrado: { 1: "Texto 1° S3", 2: "Texto 2° S3" } } });
ok("caso 2: se escribe el modo (desarrollo_actividades) y el texto por grado",
	Object.keys(caso2.cambios).filter((k) => /^desarrollo_/.test(k)).sort(), ["desarrollo_actividades", "desarrollo_diferenciado"]);
ok("caso 2: queda diferenciado con su texto", [caso2.fila.desarrollo_actividades.mode, caso2.fila.desarrollo_diferenciado, caso2.fila.desarrollo_todos],
	["diferenciado", { 1: "Texto 1° S3", 2: "Texto 2° S3" }, null]);
ok("caso 2: abrir y guardar sin cambios no escribe nada", guardar(caso2.fila, {}).cambios, {});
// Lo que dejó el defecto (modo "todos" con solo texto por grado) se abre como diferenciado, nunca como "[object Object]"
const residuo = Object.assign({}, caso2.fila, { desarrollo_actividades: { mode: "todos", todos: [], diferenciado: null } });
ok("caso 2: una fila 'todos' con solo texto por grado se abre como Diferenciado, con su texto",
	PE.seccionAlAbrir(residuo.desarrollo_todos, residuo.desarrollo_diferenciado, residuo.desarrollo_actividades),
	{ modo: "diferenciado", texto: "", porGrado: { 1: "Texto 1° S3", 2: "Texto 2° S3" } });
ok("caso 2: y guardarla sin cambios no la toca (ni escribe '[object Object]')", guardar(residuo, {}).cambios, {});

// ── A. Sin alAbrir (reintento de una sesión recién insertada): el modo cuenta; null = vacío ──
ok("mismoValor: dos objetos vacíos con distinto modo NO son iguales",
	Object.keys(PE.cambiosDeSesion({ x: { mode: "todos", todos: [], diferenciado: null } }, { x: { mode: "diferenciado", todos: null, diferenciado: null } })), ["x"]);
ok("mismoValor: null y el objeto vacío de la pantalla siguen siendo iguales",
	[PE.cambiosDeSesion({ x: null }, { x: { mode: "diferenciado", todos: null, diferenciado: null } }), PE.cambiosDeSesion({ x: { mode: "todos", todos: [], diferenciado: null } }, { x: null })], [{}, {}]);
ok("cambiosDeSesion sin alAbrir: el cambio de modo sí se ve",
	Object.keys(PE.cambiosDeSesion({ cierre_actividades: { mode: "todos", todos: [], diferenciado: null } }, { cierre_actividades: { mode: "diferenciado", todos: null, diferenciado: null } })),
	["cierre_actividades"]);
// Con alAbrir: lo que la pantalla no sabe mostrar tal cual (texto común + pasos por grado) no se reescribe
const mixta = Object.assign({}, s3, { desarrollo_todos: "Texto común", desarrollo_actividades: { mode: "diferenciado", todos: null, diferenciado: { 1: ["A"], 2: ["B"] } } });
const alAbrirMixta = pantalla(mixta);
ok("con alAbrir: guardar sin cambios no borra el texto común que la pantalla no muestra en modo diferenciado",
	PE.cambiosDeSesion(alAbrirMixta, mixta, alAbrirMixta), {});

// ── B. Un grado con 2 o más PDA guardados ──
const pdas = [
	{ grado: 1, pda_id: "a1", pda_texto: "PDA A de 1°", criterio_aplicado: "Crit A" },
	{ grado: 1, pda_id: "b1", pda_texto: "PDA B de 1°", criterio_aplicado: "Crit B" },
	{ grado: 2, pda_id: "a2", pda_texto: "PDA A de 2°", criterio_aplicado: "Crit 2" },
];
ok("pdaSesionConservando: los 2 PDA de 1° se conservan (la lista mostraba solo el último)",
	PE.pdaSesionConservando([{ grado: 1, representable: true, entrada: pdas[1] }, { grado: 2, representable: true, entrada: pdas[2] }], pdas).map((p) => p.pda_id),
	["a1", "b1", "a2"]);
ok("pdaSesionConservando: cambiar el PDA de 2° conserva los 2 de 1°",
	PE.pdaSesionConservando([{ grado: 1, representable: true, entrada: pdas[1] }, { grado: 2, representable: true, entrada: { grado: 2, pda_id: "c2", pda_texto: "Otro", criterio_aplicado: null } }], pdas).map((p) => p.pda_id),
	["a1", "b1", "c2"]);
ok("pdaSesionConservando: con un PDA por grado, lo que dice la pantalla (como antes)",
	PE.pdaSesionConservando([{ grado: 1, representable: true, entrada: null }, { grado: 2, representable: true, entrada: pdas[2] }], [pdas[0], pdas[2]]).map((p) => p.pda_id), ["a2"]);
const sVarios = Object.assign({}, s3, { id: "sv", pda_sesion: pdas });
const spda = [
	{ id: "sp1", sesion_id: "sv", pda_id: "a1", grado: 1, criterio_aplicado: "Crit A" },
	{ id: "sp2", sesion_id: "sv", pda_id: "b1", grado: 1, criterio_aplicado: "Crit B" },
	{ id: "sp3", sesion_id: "sv", pda_id: "a2", grado: 2, criterio_aplicado: "Crit 2" },
];
const conPdaSinCambios = Object.assign({}, sVarios, pantalla(sVarios));
ok("B: la fila que arma la pantalla trae los 3 PDA", conPdaSinCambios.pda_sesion.map((p) => p.pda_id), ["a1", "b1", "a2"]);
ok("B: el materializador no quita ningún PDA de la sesión", materializar(conPdaSinCambios, sVarios, [], spda).pda, [0, 0, 0]);
ok("B: guardar sin cambios no escribe pda_sesion", guardar(sVarios, {}).cambios, {});
const otroTexto = guardar(sVarios, { desarrollo: { modo: "todos", texto: "Nuevo texto" } });
ok("B: cambiar otro texto de la sesión escribe solo eso (los PDA siguen)", Object.keys(otroTexto.cambios), ["desarrollo_todos"]);

// ── C. Nunca "[object Object]" ──
ok("textoDeCampo: quita '[object Object]' y deja null si no queda nada",
	[PE.textoDeCampo("[object Object]"), PE.textoDeCampo(" [object Object] "), PE.textoDeCampo({ 1: "x" }), PE.textoDeCampo("  Hola "), PE.textoDeCampo(""), PE.textoDeCampo(null)],
	[null, null, null, "Hola", null, null]);
ok("seccionAlAbrir: un objeto en *_todos nunca llega como texto",
	PE.seccionAlAbrir({ 1: "Texto" }, null, { mode: "todos" }).texto, "");
ok("seccionAlAbrir: el texto guardado como '[object Object]' se abre vacío",
	PE.seccionAlAbrir("[object Object]", null, { mode: "todos" }).texto, "");
ok("seccionAlAbrir: lo de siempre no cambia (todos con texto; diferenciado con su texto por grado)",
	[PE.seccionAlAbrir("Texto", null, { mode: "todos" }), PE.seccionAlAbrir(null, { 1: "A", 2: "" }, { mode: "diferenciado" })],
	[{ modo: "todos", texto: "Texto", porGrado: {} }, { modo: "diferenciado", texto: "", porGrado: { 1: "A" } }]);
// Ninguna fila armada en estas pruebas trae "[object Object]"
const todas = [caso1.fila, caso1b.fila, caso2.fila, guardar(residuo, {}).fila, conPdaSinCambios, otroTexto.fila];
ok("ninguna fila guardada trae '[object Object]'", todas.filter((f) => /\[object Object\]/.test(JSON.stringify(f))).length, 0);

// ── crear_proyecto.js usa estas reglas ──
const cp = leer("js/crear_proyecto.js");
ok("crear_proyecto: al abrir, cada sección con ProyectoEdicion.seccionAlAbrir", /ProyectoEdicion\.seccionAlAbrir\(textoTodos, textoDif, actData\)/.test(cp), true);
ok("crear_proyecto: ya no se pasa '*_todos || *_diferenciado' a una caja de texto", /_todos \|\| data\.\w+_diferenciado/.test(cp), false);
ok("crear_proyecto: ninguna caja recibe el valor guardado sin revisar (ta.value = sectionData)", /ta\.value = sectionData/.test(cp), false);
ok("crear_proyecto: los textos se leen con textoDeCampo (guardar y borrador, común y por grado)", (cp.match(/ProyectoEdicion\.textoDeCampo\(/g) || []).length >= 4, true);
ok("crear_proyecto: al abrir guarda lo que armó la pantalla (block._alAbrir = payloadDeBloque)", /block\._alAbrir = payloadDeBloque\(block, idx, null\)/.test(cp), true);
ok("crear_proyecto: al guardar compara con _alAbrir", /PE\.cambiosDeSesion\(fila, actual, alAbrir\)/.test(cp), true);
ok("crear_proyecto: al abrir no se autollena el criterio (dataset.alAbrir)", /dataset\.alAbrir = '1'/.test(cp) && /!alAbrir && !criterioTextarea\.value\.trim\(\)/.test(cp), true);
ok("crear_proyecto: un grado con 2 o más PDA no se pone en la lista y se muestra de solo lectura",
	/pdaGuardadosDeGrado\(data\.pda_sesion, item\.grado\)\.length > 1\) return;/.test(cp) && /function mostrarPdaVarios\(block\)/.test(cp), true);
ok("crear_proyecto: al rehacer la lista de PDA (volver del paso 2) se vuelve a mostrar", (cp.match(/mostrarPdaVarios\(block\);/g) || []).length, 2);
ok("crear_proyecto: contenidos_pda null no pasa a {} al guardar sin cambios", /proyectoOriginal\.contenidos_pda == null/.test(cp), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
