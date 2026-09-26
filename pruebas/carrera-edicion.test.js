/*
	Carrera al guardar un proyecto (R24-r08): entre "reviso que la sesión no está trabajada" y
	"escribo", otra pestaña trabaja la sesión en Hoy (le pone fecha) y la califica. Antes la
	sesión se borraba con sus calificaciones y el editor decía "guardado".

	  1. js/proyecto-edicion.js: el borrado y la actualización completa llevan fecha IS NULL en
	     la misma petición; lo que no se afectó se reporta (noBorradas / soloTexto).
	  2. Solo se manda PATCH de las sesiones que cambiaron (cambiosDeSesion).
	  3. js/sesiones-materializar.js: con soloSinTrabajar no toca una sesión que se empezó a
	     trabajar; el borrado de productos revisa justo antes (calificaciones y fecha) y confirma
	     después (resumen.carrera); un PDA agregado desde Hoy no se borra en la reedición; al
	     cambiar el campo se quitan las ligas viejas de un producto que ya no es del campo.
	  4. js/crear_proyecto.js usa todo eso y no dice "guardado" si hubo carrera.

	Ejecuta los archivos reales contra un Supabase falso en memoria con un "gancho" que hace lo
	de la otra pestaña en el momento exacto.
	node pruebas/carrera-edicion.test.js [ruta de otra versión de sesiones-materializar.js] [ruta de otra proyecto-edicion.js]
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const raiz = path.join(__dirname, "..");

global.window = {};
require("../js/campos-formativos.js");
require(process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, "js", "sesiones-materializar.js"));
let PE = {};
try { PE = require(process.argv[3] ? path.resolve(process.argv[3]) : path.join(raiz, "js", "proyecto-edicion.js")); } catch (e) { PE = {}; }
const materializar = global.window.materializarSesiones;

// ── Supabase falso: select/in/eq/is/order/range/single, insert, update, delete (con .select) y cascadas ──
let secuencia = 0;
let BD = null;
let gancho = null; // (tabla, op, fase) → fase "antes" o "despues" de ejecutar
function baseNueva() {
	return { sesiones: [], sesiones_pda: [], productos_sesion: [], producto_sesion_pda: [], calificaciones: [], evaluacion_formativa: [] };
}
function cascada() {
	const hay = (t, id) => BD[t].some((f) => f.id === id);
	BD.productos_sesion = BD.productos_sesion.filter((p) => hay("sesiones", p.sesion_id));
	BD.sesiones_pda = BD.sesiones_pda.filter((p) => hay("sesiones", p.sesion_id));
	BD.calificaciones = BD.calificaciones.filter((c) => hay("productos_sesion", c.producto_sesion_id) && (!c.sesion_id || hay("sesiones", c.sesion_id)));
	BD.producto_sesion_pda = BD.producto_sesion_pda.filter((l) => hay("productos_sesion", l.producto_sesion_id) && hay("sesiones_pda", l.sesion_pda_id));
}
const peticiones = [];
function crearSb() {
	return {
		from(tabla) {
			const q = { filtros: [], op: "select", filas: null, cambios: null, rango: null, conSelect: false };
			const api = {
				select() { if (q.op !== "select") q.conSelect = true; return api; },
				in(col, vals) { q.filtros.push((f) => vals.indexOf(f[col]) !== -1); return api; },
				eq(col, val) { q.filtros.push((f) => f[col] === val); return api; },
				is(col, val) { q.filtros.push((f) => (val === null ? f[col] === null || f[col] === undefined : f[col] === val)); return api; },
				order() { return api; },
				range(a, b) { q.rango = [a, b]; return api; },
				single() { return api; },
				insert(filas) { q.op = "insert"; q.filas = Array.isArray(filas) ? filas : [filas]; return api; },
				update(c) { q.op = "update"; q.cambios = c; return api; },
				delete() { q.op = "delete"; return api; },
				then(resolver, rechazar) {
					try {
						if (gancho) gancho(tabla, q.op, "antes");
						peticiones.push(tabla + ":" + q.op);
						const t = BD[tabla] = BD[tabla] || [];
						const pasa = (f) => q.filtros.every((fn) => fn(f));
						let data = null;
						if (q.op === "insert") {
							data = q.filas.map((f) => {
								const fila = Object.assign({ id: tabla + "-" + (++secuencia), created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, secuencia)).toISOString(), activo: true }, f);
								if (tabla === "producto_sesion_pda") delete fila.id;
								t.push(fila);
								return fila;
							});
						} else if (q.op === "update") {
							data = t.filter(pasa);
							data.forEach((f) => Object.assign(f, q.cambios));
							if (!q.conSelect) data = null;
						} else if (q.op === "delete") {
							data = t.filter(pasa);
							BD[tabla] = t.filter((f) => !pasa(f));
							cascada();
							if (!q.conSelect) data = null;
						} else {
							data = t.filter(pasa);
							if (q.rango) data = data.slice(q.rango[0], q.rango[1] + 1);
						}
						if (gancho) gancho(tabla, q.op, "despues");
						return Promise.resolve({ data: data, error: null }).then(resolver, rechazar);
					} catch (e) { return Promise.reject(e).then(resolver, rechazar); }
				},
			};
			return api;
		},
	};
}
const sb = crearSb();
global.window.sb = sb;
const COLS = "id, numero_sesion, campo_formativo, pda_sesion, cierre_tareas";
// "La otra pestaña": trabaja la sesión en Hoy (fecha) y califica un producto suyo
function otraPestanaTrabaja(sesionId) {
	const s = BD.sesiones.find((x) => x.id === sesionId);
	if (s) s.fecha = "2026-09-28";
	const p = BD.productos_sesion.find((x) => x.sesion_id === sesionId);
	if (p) BD.calificaciones.push({ id: "cal-" + (++secuencia), producto_sesion_id: p.id, sesion_id: sesionId, nivel: "logrado" });
}

(async () => {
	const has = (fn) => typeof PE[fn] === "function";
	const gs = (t) => (has("guardarSesiones") ? PE.guardarSesiones(sb, t) : Promise.reject(new Error("no existe ProyectoEdicion.guardarSesiones")));
	ok("proyecto-edicion expone guardarSesiones, cambiosDeSesion y avisoCarrera",
		[has("guardarSesiones"), has("cambiosDeSesion"), has("avisoCarrera"), has("borrarSinTrabajar"), has("actualizarSinTrabajar")], [true, true, true, true, true]);

	// ── 1. Borrar una sesión que la otra pestaña trabaja en medio ──
	BD = baseNueva();
	BD.sesiones.push({ id: "s3", maestro_id: "m1", numero_sesion: 3, fecha: null, campo_formativo: "Lenguajes" });
	BD.sesiones.push({ id: "s4", maestro_id: "m1", numero_sesion: 4, fecha: null, campo_formativo: "Lenguajes" });
	BD.productos_sesion.push({ id: "p4", sesion_id: "s4", tipo: "trabajo", grados: ["3"], campo: "LEN" });
	gancho = (tabla, op, fase) => { if (tabla === "sesiones" && op === "delete" && fase === "antes") { otraPestanaTrabaja("s4"); gancho = null; } };
	let r1 = null, e1 = null;
	try {
		r1 = await gs({ maestroId: "m1", proyectoId: "pA", columnas: COLS, borrar: ["s4"], existentes: [], nuevas: [] });
	} catch (e) { e1 = e.message; }
	gancho = null;
	ok("carrera al borrar: la sesión trabajada en medio NO se borra", BD.sesiones.some((s) => s.id === "s4"), true);
	ok("…y conserva su calificación", BD.calificaciones.filter((c) => c.sesion_id === "s4").length, 1);
	ok("…y se reporta como no borrada (para avisar \"Mientras editabas…\")", r1 && r1.noBorradas, ["s4"]);
	ok("sin carrera, una sesión sin trabajar sí se borra",
		await (async () => { const r = await gs({ maestroId: "m1", columnas: COLS, borrar: ["s3"], existentes: [], nuevas: [] }).catch(() => null); return r && r.borradas; })(), ["s3"]);
	ok("(sin excepción)", e1, null);

	// ── 2. Actualización completa de una sesión que la otra pestaña trabaja en medio ──
	BD = baseNueva();
	BD.sesiones.push({ id: "s5", maestro_id: "m1", numero_sesion: 5, fecha: null, campo_formativo: "Lenguajes", inicio_todos: "Antes" });
	BD.productos_sesion.push({ id: "p5", sesion_id: "s5", tipo: "trabajo", grados: ["3"], campo: "LEN" });
	gancho = (tabla, op, fase) => { if (tabla === "sesiones" && op === "update" && fase === "antes") { otraPestanaTrabaja("s5"); gancho = null; } };
	let r2 = null;
	try {
		r2 = await gs({
			maestroId: "m1", columnas: COLS, borrar: [], nuevas: [],
			existentes: [{ id: "s5", trabajada: false, completa: { campo_formativo: "Saberes y Pensamiento Científico", inicio_todos: "Después" }, texto: { inicio_todos: "Después" }, actual: BD.sesiones[0] }],
		});
	} catch (e) { r2 = null; }
	gancho = null;
	const s5 = BD.sesiones.find((s) => s.id === "s5");
	ok("carrera al actualizar: el campo de la sesión trabajada en medio NO cambia", s5.campo_formativo, "Lenguajes");
	ok("…su texto sí se guarda (como en cualquier sesión trabajada)", s5.inicio_todos, "Después");
	ok("…no se manda a materializar y se reporta", r2 && [r2.materializar.length, r2.soloTexto], [0, ["s5"]]);

	// ── 3. Solo PATCH de lo que cambió ──
	if (has("cambiosDeSesion")) {
		const original = { id: "s", maestro_id: "m1", numero_sesion: 2, duracion: null, recursos: { links: [], archivos: [] }, cierre_tareas: { mode: "todos", todos: ["A"], diferenciado: null }, inicio_todos: "Hola" };
		const igual = { maestro_id: "m1", numero_sesion: 2, duracion: "", recursos: { archivos: [], links: [] }, cierre_tareas: { diferenciado: null, mode: "todos", todos: ["A"] }, inicio_todos: "Hola" };
		ok("cambiosDeSesion: sin cambios (jsonb con las llaves en otro orden, '' = null) → nada", PE.cambiosDeSesion(igual, original), {});
		ok("cambiosDeSesion: solo lo que cambió", PE.cambiosDeSesion(Object.assign({}, igual, { inicio_todos: "Adiós", numero_sesion: 3 }), original), { numero_sesion: 3, inicio_todos: "Adiós" });
		BD = baseNueva();
		BD.sesiones.push({ id: "s6", maestro_id: "m1", numero_sesion: 1, fecha: null, campo_formativo: "Lenguajes" });
		peticiones.length = 0;
		const r3 = await gs({ maestroId: "m1", columnas: COLS, borrar: [], nuevas: [],
			existentes: [{ id: "s6", trabajada: false, completa: {}, texto: {}, actual: BD.sesiones[0] }] });
		ok("una sesión sin cambios no manda PATCH (pero se materializa por si cambiaron los grados)", [peticiones.filter((p) => p === "sesiones:update").length, r3.materializar.map((s) => s.id)], [0, ["s6"]]);
	}

	// ── 4. Materializar con soloSinTrabajar: una sesión que se empezó a trabajar no se toca ──
	BD = baseNueva();
	BD.sesiones.push({ id: "s7", maestro_id: "m1", numero_sesion: 7, fecha: "2026-09-28", campo_formativo: "Lenguajes" });
	const res4 = await materializar([{ id: "s7", numero_sesion: 7, campo_formativo: "Lenguajes", pda_sesion: null, cierre_tareas: null }], "m1",
		{ gradosProyecto: ["3", "5"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", soloSinTrabajar: true });
	ok("soloSinTrabajar: la sesión con fecha no recibe productos nuevos y se reporta", [BD.productos_sesion.length, res4 && res4.omitidas], [0, ["s7"]]);

	// ── 5. Borrar productos: la otra pestaña trabaja y califica justo después de revisar calificaciones ──
	BD = baseNueva();
	const viejo = { id: "s8", numero_sesion: 8, campo_formativo: "Lenguajes", pda_sesion: null, cierre_tareas: { mode: "todos", todos: ["Tarea que se quita"], diferenciado: null } };
	BD.sesiones.push(Object.assign({ maestro_id: "m1", fecha: null }, viejo));
	await materializar([viejo], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro" });
	const tarea = BD.productos_sesion.find((p) => p.nombre === "Tarea que se quita");
	gancho = (tabla, op, fase) => {
		if (tabla === "calificaciones" && op === "select" && fase === "despues") {
			BD.sesiones[0].fecha = "2026-09-28";
			BD.calificaciones.push({ id: "cal-t", producto_sesion_id: tarea.id, sesion_id: "s8", nivel: "logrado" });
			gancho = null;
		}
	};
	const nuevo = Object.assign({}, viejo, { cierre_tareas: { mode: "todos", todos: [], diferenciado: null } });
	const res5 = await materializar([nuevo], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro", anteriores: { s8: viejo } });
	gancho = null;
	ok("carrera al borrar productos: la tarea calificada en medio NO se borra", BD.productos_sesion.some((p) => p.id === tarea.id), true);
	ok("…conserva su calificación", BD.calificaciones.some((c) => c.id === "cal-t"), true);
	ok("…y se reporta (resumen.carrera)", res5 && res5.carrera, ["s8"]);

	// 5b. Si la otra pestaña califica en el instante del DELETE (la ventana que queda), se detecta después
	BD = baseNueva();
	BD.sesiones.push(Object.assign({ maestro_id: "m1", fecha: null }, viejo));
	await materializar([viejo], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro" });
	gancho = (tabla, op, fase) => { if (tabla === "productos_sesion" && op === "delete" && fase === "antes") { BD.sesiones[0].fecha = "2026-09-28"; gancho = null; } };
	const res5b = await materializar([nuevo], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro", anteriores: { s8: viejo } });
	gancho = null;
	ok("ventana del DELETE: se detecta después (resumen.carrera) para no decir \"guardado\"", res5b && res5b.carrera, ["s8"]);

	// ── 6. Un PDA agregado desde Hoy para una actividad no se borra en la reedición ──
	BD = baseNueva();
	const s9 = { id: "s9", numero_sesion: 9, campo_formativo: "Lenguajes", pda_sesion: [{ grado: 3, pda_id: "pda-plan", criterio_aplicado: "P" }], cierre_tareas: null };
	BD.sesiones.push(Object.assign({ maestro_id: "m1", fecha: null }, s9));
	await materializar([s9], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro" });
	BD.productos_sesion.push({ id: "hoy-sab", sesion_id: "s9", tipo: "trabajo", nombre: "Experimento", grados: ["3"], campo: "SAB", activo: true, created_at: "2026-09-30T00:00:00Z" });
	BD.sesiones_pda.push({ id: "spda-hoy", sesion_id: "s9", pda_id: "pda-sab", grado: 3, criterio_aplicado: null });
	BD.producto_sesion_pda.push({ producto_sesion_id: "hoy-sab", sesion_pda_id: "spda-hoy" });
	await materializar([Object.assign({}, s9, { observaciones: "x" })], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", anteriores: { s9: s9 } });
	ok("reedición: el PDA de otro campo agregado desde Hoy se queda, con su liga", [BD.sesiones_pda.some((r) => r.id === "spda-hoy"), BD.producto_sesion_pda.some((l) => l.sesion_pda_id === "spda-hoy")], [true, true]);

	// ── 7. Cambiar el campo de una sesión sin trabajar quita las ligas viejas ──
	BD = baseNueva();
	const s10 = { id: "s10", numero_sesion: 10, campo_formativo: "Lenguajes", pda_sesion: [{ grado: 3, pda_id: null, criterio_aplicado: "Explica con sus palabras" }], cierre_tareas: null };
	BD.sesiones.push(Object.assign({ maestro_id: "m1", fecha: null }, s10));
	await materializar([s10], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes", "Saberes y Pensamiento Científico"], origenTrabajo: "maestro" });
	BD.productos_sesion.push({ id: "hoy-len", sesion_id: "s10", tipo: "trabajo", nombre: "Lectura", grados: ["3"], campo: "LEN", activo: true, created_at: "2026-09-30T00:00:00Z" });
	BD.producto_sesion_pda.push({ producto_sesion_id: "hoy-len", sesion_pda_id: BD.sesiones_pda[0].id });
	const s10b = Object.assign({}, s10, { campo_formativo: "Saberes y Pensamiento Científico" });
	await materializar([s10b], "m1", { gradosProyecto: ["3"], camposProyecto: ["Lenguajes", "Saberes y Pensamiento Científico"], origenTrabajo: "maestro", anteriores: { s10: s10 } });
	ok("cambio de campo: la actividad LEN ya no se liga al PDA de la sesión (ahora SAB)", BD.producto_sesion_pda.some((l) => l.producto_sesion_id === "hoy-len"), false);
	ok("…y el trabajo del plan (ahora SAB) sí queda ligado", BD.producto_sesion_pda.filter((l) => BD.productos_sesion.find((p) => p.id === l.producto_sesion_id && p.campo === "SAB")).length, 1);

	// ── 8. Agregar un grado: las sesiones sin trabajar reciben el trabajo del grado nuevo; la tarea "para todos" no se duplica ──
	BD = baseNueva();
	const s11 = { id: "s11", numero_sesion: 11, campo_formativo: "Lenguajes", pda_sesion: null, cierre_tareas: { mode: "todos", todos: ["Leer"], diferenciado: null } };
	BD.sesiones.push(Object.assign({ maestro_id: "m1", fecha: null }, s11));
	await materializar([s11], "m1", { gradosProyecto: ["4"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro" });
	await materializar([s11], "m1", { gradosProyecto: ["4", "5"], gradosProyectoAnterior: ["4"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro", anteriores: { s11: s11 }, soloSinTrabajar: true });
	const prods11 = BD.productos_sesion.filter((p) => p.sesion_id === "s11").map((p) => p.tipo + ":" + p.grados.join(",")).sort();
	ok("agregar 5°: trabajo de 4° y de 5°, y una sola tarea para 4° y 5°", prods11, ["tarea:4,5", "trabajo:4", "trabajo:5"]);

	// ── 9. crear_proyecto.js usa las escrituras protegidas y no dice "guardado" con carrera ──
	const cp = fs.readFileSync(path.join(raiz, "js", "crear_proyecto.js"), "utf8");
	ok("crear_proyecto: guarda las sesiones con ProyectoEdicion.guardarSesiones y materializa con soloSinTrabajar",
		[/PE\.guardarSesiones\(window\.sb/.test(cp), /soloSinTrabajar: true/.test(cp)], [true, true]);
	ok("crear_proyecto: con carrera lanza el aviso \"Mientras editabas…\" (no llega a \"Proyecto guardado\")",
		/enCarrera\.length\) \{\s*throw errorHumano\(PE\.avisoCarrera/.test(cp), true);
	ok("crear_proyecto: ya no borra sesiones sin la condición de fecha",
		/from\('sesiones'\)\.delete\(\)\s*\.in\('id', plan\.borrar\)/.test(cp), false);
	if (has("avisoCarrera")) {
		const a = PE.avisoCarrera([4]);
		ok("avisoCarrera: empieza con \"Mientras editabas\", nombra la sesión y no dice \"guardado\"", [/^Mientras editabas/.test(a), /sesión 4/.test(a), /guardad/i.test(a)], [true, true, false]);
	}

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA la prueba lanzó: " + (e && e.stack || e)); process.exit(1); });
