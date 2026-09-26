/*
	Crear proyecto y Proyectos (decisiones de Jorge del 2026-09-26): js/proyecto-edicion.js y
	cómo lo usan js/crear_proyecto.js y js/planeacion.js.

	  1. Un proyecto iniciado se edita: se agregan sesiones y se corrigen las no trabajadas;
	     una sesión trabajada (con fecha o calificaciones) solo corrige su texto.
	  4. Paso 1: grados y campos formativos obligatorios; una sesión sin campo no se guarda.
	  5. Guardado sin proyectos huérfanos ni duplicados al reintentar.
	 10. El catálogo del paso 2 se vuelve a leer si cambian los grados.
	 11. Clonar copia las sesiones (sin fechas ni calificaciones) y las materializa.
	 12. Escenario y secuencia con los nombres oficiales (docs/CONTEXTO.md §2); al leer, las dos formas.

	node pruebas/proyecto-edicion.test.js
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

let PE = {};
try { PE = require("../js/proyecto-edicion.js"); } catch (e) { console.log("FALLA no existe js/proyecto-edicion.js"); fallos++; }
const has = (fn) => typeof PE[fn] === "function";

// ── 4. Paso 1 ──
if (has("validarPaso1")) {
	const base = { titulo: "Mi proyecto", trimestre: 1, grados: ["3"], campos_formativos: ["Lenguajes"], metodologia: "ABPC", escenario: "Aula" };
	ok("paso 1 completo: pasa", PE.validarPaso1(base).ok, true);
	const sinGrados = PE.validarPaso1(Object.assign({}, base, { grados: [] }));
	ok("sin grados: no pasa, con mensaje claro y foco en grados", [sinGrados.ok, sinGrados.foco, /al menos un grado/.test(sinGrados.error)], [false, "grados", true]);
	const sinCampos = PE.validarPaso1(Object.assign({}, base, { campos_formativos: [] }));
	ok("sin campos formativos: no pasa, con mensaje claro", [sinCampos.ok, sinCampos.foco, /al menos un campo formativo/.test(sinCampos.error)], [false, "campos", true]);
	ok("sin título: no pasa", PE.validarPaso1(Object.assign({}, base, { titulo: "  " })).ok, false);
}
if (has("sesionesSinCampo")) {
	ok("sesiones sin campo: se nombran por número", PE.sesionesSinCampo([{ campo_formativo: "Lenguajes" }, { campo_formativo: "" }, { campo_formativo: null }]), [2, 3]);
}

// ── 10. Catálogo ──
if (has("claveCatalogo")) {
	ok("la llave del catálogo cambia si cambian los grados", PE.claveCatalogo(["Fase 4"], [3]) !== PE.claveCatalogo(["Fase 4"], [3, 4]), true);
	ok("…y no cambia por el orden", PE.claveCatalogo(["Fase 5", "Fase 4"], [5, 3]), PE.claveCatalogo(["Fase 4", "Fase 5"], [3, 5]));
}

// ── 12. Nombres oficiales ──
if (has("escenarioOficial")) {
	ok("escenarios oficiales del SaaS", PE.ESCENARIOS, ["Aula", "Escuela", "Comunidad"]);
	ok("al leer se aceptan los del bot: Escolar → Escuela, Comunitario → Comunidad",
		[PE.escenarioOficial("Escolar"), PE.escenarioOficial("Comunitario"), PE.escenarioOficial("Aula"), PE.escenarioOficial("Escuela")],
		["Escuela", "Comunidad", "Aula", "Escuela"]);
}
if (has("momentoOficial")) {
	ok("secuencia ABPC con los momentos de ltg_metodologias_estructuras", PE.opcionesSecuencia("ABPC").map((o) => o.valor).slice(0, 5),
		["Identificación", "Recuperación", "Planificación", "Acercamiento", "Comprensión y producción"]);
	ok("la etiqueta lleva el número; se guarda el nombre oficial", PE.opcionesSecuencia("STEAM")[1], { valor: "Diseño y desarrollo de la indagación", etiqueta: "2. Diseño y desarrollo de la indagación" });
	ok("lo guardado con los nombres viejos se lee como el oficial",
		[PE.momentoOficial("ABPC", "5. Vamos y volvemos"), PE.momentoOficial("STEAM", "Fase 3. Organizar y estructurar respuestas"), PE.momentoOficial("AS", "Etapa 5. Compartimos y evaluamos")],
		["Comprensión y producción", "Establecer conclusiones", "Compartimos y evaluamos lo aprendido"]);
	ok("un momento desconocido se conserva tal cual", PE.momentoOficial("ABP", "Algo propio"), "Algo propio");
}

// ── 1. Sesión trabajada ──
if (has("sesionTrabajada")) {
	ok("trabajada = con fecha", PE.sesionTrabajada({ id: "a", fecha: "2026-09-28", estado_sesion: "activa" }, {}), true);
	ok("trabajada = con calificaciones", PE.sesionTrabajada({ id: "a", fecha: null }, { a: true }), true);
	ok("'Iniciar' (activa, sin fecha ni calificaciones) NO la vuelve trabajada", PE.sesionTrabajada({ id: "a", fecha: null, estado_sesion: "activa" }, {}), false);
	const texto = PE.soloTexto({ numero_sesion: 2, inicio_todos: "x", campo_formativo: "Lenguajes", pda_sesion: [1], cierre_tareas: { todos: ["t"] }, observaciones: "o" });
	ok("de una sesión trabajada solo se guarda el texto (sin campo, PDA ni tareas)", Object.keys(texto).sort(), ["inicio_todos", "numero_sesion", "observaciones"]);
	const plan = PE.planGuardado([{ id: "t1", trabajada: true }, { id: "n1", trabajada: false }, { id: "n2", trabajada: false }], [{ sesionId: "t1" }, { sesionId: "n2" }, { sesionId: null }], { t1: true });
	ok("guardar: se borra solo la no trabajada que se quitó", plan.borrar, ["n1"]);
	ok("guardar: una trabajada nunca se borra", PE.planGuardado([{ id: "t1", trabajada: true }], [], { t1: true }).faltanTrabajadas, ["t1"]);
	ok("guardar: detecta la que se empezó a trabajar mientras se editaba", PE.planGuardado([{ id: "n1", trabajada: true }], [{ sesionId: "n1" }], {}).trabajadasDesdeQueAbrio, ["n1"]);
}

// ── 11. Clonar ──
if (has("copiaDeSesion")) {
	const c = PE.copiaDeSesion({ id: "s", numero_sesion: 3, fecha: "2026-09-01", estado_sesion: "completada", notas_cierre: "n", campo_formativo: "Lenguajes", pda_sesion: [{ grado: 3 }], cierre_tareas: { mode: "todos", todos: ["t"] } }, "p2", "m1");
	ok("la copia de una sesión: sin fecha, pendiente, sin notas ni id; con su plan",
		[c.fecha, c.estado_sesion, "notas_cierre" in c, "id" in c, c.proyecto_id, c.campo_formativo, c.numero_sesion, c.cierre_tareas.todos[0]],
		[null, "pendiente", false, false, "p2", "Lenguajes", 3, "t"]);
}

// ── Cómo lo usan las pantallas ──
const cp = leer("js/crear_proyecto.js"), cph = leer("crear_proyecto.html"), pl = leer("js/planeacion.js"), plh = leer("planeacion.html");
ok("crear_proyecto: el paso 1 valida grados y campos (ProyectoEdicion.validarPaso1)", /ProyectoEdicion\.validarPaso1\(datos\)/.test(cp), true);
ok("crear_proyecto: ya no bloquea un proyecto iniciado (sin 'edicionBloqueada')", /edicionBloqueada/.test(cp), false);
ok("crear_proyecto: editar ya no borra todas las sesiones para volver a crearlas",
	/\.from\('sesiones'\)\s*\.delete\(\)\s*\.eq\('proyecto_id', proyectoId\)/.test(cp), false);
ok("crear_proyecto: una sesión trabajada solo guarda su texto", /ProyectoEdicion\.soloTexto\(fila\)/.test(cp), true);
ok("crear_proyecto: la sesión nueva queda con su id (un reintento la actualiza)", /block\.dataset\.sesionId = s\.id/.test(cp), true);
ok("crear_proyecto: proyecto nuevo — si falla después de crearlo, se borra; si no se pudo, se reutiliza",
	/proyectoCreadoId = idProyecto/.test(cp) && /delete\(\)\.eq\('id', idProyecto\)/.test(cp) && /if \(!revErr\) proyectoCreadoId = null/.test(cp), true);
ok("crear_proyecto: un doble toque no guarda dos veces", /if \(guardando\) return;/.test(cp), true);
ok("crear_proyecto: pide el campo de cada sesión antes de guardar", /ProyectoEdicion\.sesionesSinCampo/.test(cp), true);
ok("crear_proyecto: el catálogo se vuelve a leer si cambian fases o grados", /catalogoCargado && catalogoClave === clave/.test(cp), true);
ok("crear_proyecto: materializa con los campos del proyecto (sin LEN por omisión)", /camposProyecto: paso1Data\.campos_formativos/.test(cp), true);
ok("crear_proyecto: los recursos guardados se cargan al editar (antes se perdían)", /_cargarRecursos\(data\._archivos \|\| recursos\.archivos/.test(cp), true);
ok("crear_proyecto.html: escenarios Aula, Escuela y Comunidad",
	[/name="escenario" value="Escuela"/.test(cph), /name="escenario" value="Comunidad"/.test(cph), /value="Escolar"|value="Comunitario"/.test(cph)], [true, true, false]);
ok("crear_proyecto.html: carga js/proyecto-edicion.js antes de crear_proyecto.js",
	cph.indexOf('src="js/proyecto-edicion.js"') > 0 && cph.indexOf('src="js/proyecto-edicion.js"') < cph.indexOf('src="js/crear_proyecto.js"'), true);
ok("crear_proyecto.html: aviso del paso 1 y del proyecto en curso", /id="mensajePaso1"/.test(cph) && /id="avisoEnCurso"/.test(cph), true);
ok("planeacion: clonar copia las sesiones y las materializa",
	/ProyectoEdicion\.copiaDeSesion/.test(pl) && /materializarSesiones\(ins\.data/.test(pl), true);
ok("planeacion: si falla al copiar las sesiones, borra el clon", /delete\(\)\.eq\("id", creado\.id\)/.test(pl), true);
ok("planeacion.html: carga lo que usa clonar",
	["leer-todo.js", "campos-formativos.js", "sesiones-materializar.js", "proyecto-edicion.js"].every((f) => plh.indexOf('src="js/' + f + '"') > 0 && plh.indexOf('src="js/' + f + '"') < plh.indexOf('src="js/planeacion.js"')), true);
ok("planeacion: el aviso de proyectos activos admite varios", /activos\.length > 1 \? activos\.length \+ " proyectos activos"/.test(pl), true);
ok("importador: una sesión sin campo toma el del proyecto (no LEN en silencio)", /camposProyecto: dosProy\.campos_formativos/.test(leer("js/importador.js")), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
