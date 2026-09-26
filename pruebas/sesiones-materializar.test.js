/*
	Materialización de sesiones (js/sesiones-materializar.js), decisiones de Jorge del 2026-09-26.

	  - Cada grado del proyecto tiene su producto en cada sesión, aunque no tenga PDA elegido
	    (antes, con PDA solo para 3°, 4° y 5° se quedaban sin nada que calificar).
	  - Una sesión sin campo no se guarda como LEN en silencio: con un solo campo en el proyecto
	    es ese; con varios, error y nada se escribe.
	  - Idempotente: correrla dos veces (reintento, reedición) no duplica PDA, productos ni ligas.
	  - Reedición: se quita lo que se quitó del plan, nunca un producto con calificaciones, un PDA
	    con evaluación formativa ni lo que la maestra agregó en Hoy.

	Ejecuta el archivo real contra un Supabase falso en memoria.
	node pruebas/sesiones-materializar.test.js [ruta de otra versión]
*/

const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
const archivo = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "js", "sesiones-materializar.js");
require(archivo);
const materializar = global.window.materializarSesiones;
const SM = global.window.SesionesMaterializar;

// ── Supabase falso en memoria (lo que usa el módulo: select/in/eq/order/range, insert, update, delete) ──
let secuencia = 0;
function baseNueva() {
	return { sesiones_pda: [], productos_sesion: [], producto_sesion_pda: [], calificaciones: [], evaluacion_formativa: [] };
}
let BD = baseNueva();
function crearSb() {
	return {
		from(tabla) {
			const q = { filtros: [], op: "select", filas: null, cambios: null, rango: null };
			const api = {
				select() { return api; },
				in(col, vals) { q.filtros.push((f) => vals.indexOf(f[col]) !== -1); return api; },
				eq(col, val) { q.filtros.push((f) => f[col] === val); return api; },
				order() { return api; },
				range(a, b) { q.rango = [a, b]; return api; },
				single() { return api; },
				insert(filas) { q.op = "insert"; q.filas = Array.isArray(filas) ? filas : [filas]; return api; },
				update(c) { q.op = "update"; q.cambios = c; return api; },
				delete() { q.op = "delete"; return api; },
				then(resolver, rechazar) {
					try {
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
							t.filter(pasa).forEach((f) => Object.assign(f, q.cambios));
						} else if (q.op === "delete") {
							BD[tabla] = t.filter((f) => !pasa(f));
							if (tabla === "productos_sesion") BD.producto_sesion_pda = BD.producto_sesion_pda.filter((l) => BD.productos_sesion.some((p) => p.id === l.producto_sesion_id));
							if (tabla === "sesiones_pda") BD.producto_sesion_pda = BD.producto_sesion_pda.filter((l) => BD.sesiones_pda.some((p) => p.id === l.sesion_pda_id));
						} else {
							data = t.filter(pasa);
							if (q.rango) data = data.slice(q.rango[0], q.rango[1] + 1);
						}
						return Promise.resolve({ data: data, error: null }).then(resolver, rechazar);
					} catch (e) { return Promise.reject(e).then(resolver, rechazar); }
				},
			};
			return api;
		},
	};
}
global.window.sb = crearSb();

const de = (tabla, sesionId) => BD[tabla].filter((f) => f.sesion_id === sesionId);
const gradosDe = (lista) => lista.map((p) => p.grados.join(",")).sort();

(async () => {
	ok("expone la regla para probarla (SesionesMaterializar.planificar)", !!(SM && SM.planificar), true);

	// ── 1. PDA de algunos grados: cada grado del proyecto tiene su producto ──
	const s1 = {
		id: "s1", numero_sesion: 1, campo_formativo: "Lenguajes",
		pda_sesion: [{ grado: 3, pda_id: "pda-3", criterio_aplicado: "Lee en voz alta" }],
		cierre_tareas: { mode: "todos", todos: ["Leer en casa"], diferenciado: null },
	};
	await materializar([s1], "m1", { gradosProyecto: ["3", "4", "5"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro" });
	const trabajos1 = de("productos_sesion", "s1").filter((p) => p.tipo === "trabajo");
	ok("PDA solo para 3°: hay trabajo para 3°, 4° y 5°", gradosDe(trabajos1), ["3", "4", "5"]);
	ok("la tarea del cierre es para los tres grados", de("productos_sesion", "s1").filter((p) => p.tipo === "tarea").map((p) => p.grados.join(",")), ["3,4,5"]);
	ok("el trabajo de 3° se liga con el PDA de 3°; los de 4° y 5° no tienen PDA que ligar",
		BD.producto_sesion_pda.map((l) => BD.productos_sesion.find((p) => p.id === l.producto_sesion_id).grados.join(",")).sort(), ["3", "3,4,5"]);

	// ── 2. Idempotente: otra vez lo mismo no duplica nada ──
	const antes = [BD.sesiones_pda.length, BD.productos_sesion.length, BD.producto_sesion_pda.length];
	await materializar([s1], "m1", { gradosProyecto: ["3", "4", "5"], camposProyecto: ["Lenguajes"], origenTrabajo: "maestro", origenTarea: "maestro" });
	ok("correrla dos veces no duplica PDA, productos ni ligas", [BD.sesiones_pda.length, BD.productos_sesion.length, BD.producto_sesion_pda.length], antes);

	// ── 3. Sin campo ──
	BD = baseNueva();
	let error = null;
	try {
		await materializar([{ id: "s2", numero_sesion: 2, campo_formativo: null, pda_sesion: null, cierre_tareas: null }], "m1",
			{ gradosProyecto: ["3"], camposProyecto: ["Lenguajes", "Saberes y Pensamiento Científico"] });
	} catch (e) { error = e.message; }
	ok("sesión sin campo con varios campos en el proyecto: error que pide el campo", /no tiene campo formativo/.test(error || ""), true);
	ok("…y no se escribió nada (antes quedaba como LEN)", BD.productos_sesion.length, 0);
	await materializar([{ id: "s3", numero_sesion: 3, campo_formativo: "", pda_sesion: null, cierre_tareas: null }], "m1",
		{ gradosProyecto: ["4"], camposProyecto: ["Saberes y Pensamiento Científico"] });
	ok("sesión sin campo con un solo campo en el proyecto: toma ese (SAB)", de("productos_sesion", "s3").map((p) => p.campo), ["SAB"]);

	// ── 4. Reedición de una sesión sin trabajar ──
	BD = baseNueva();
	const viejo = {
		id: "s4", numero_sesion: 4, campo_formativo: "Lenguajes",
		pda_sesion: [{ grado: 3, pda_id: "pda-a", criterio_aplicado: "A" }, { grado: 4, pda_id: "pda-b", criterio_aplicado: "B" }],
		cierre_tareas: { mode: "todos", todos: ["Tarea que se queda", "Tarea que se quita", "Tarea calificada"], diferenciado: null },
	};
	const opts = { gradosProyecto: ["3", "4"], camposProyecto: ["Lenguajes", "Saberes y Pensamiento Científico"], origenTrabajo: "maestro", origenTarea: "maestro" };
	await materializar([viejo], "m1", opts);
	// Lo que agregó la maestra en Hoy y una calificación en una tarea (una "Quitar de hoy" deja la sesión sin fecha)
	BD.productos_sesion.push({ id: "hoy-1", sesion_id: "s4", tipo: "trabajo", nombre: "Actividad de Hoy", grados: ["4"], campo: "LEN", modalidad: "diferenciada", activo: true, origen: "maestro", created_at: "2026-09-30T00:00:00Z" });
	const calificada = BD.productos_sesion.find((p) => p.nombre === "Tarea calificada");
	BD.calificaciones.push({ id: "c1", producto_sesion_id: calificada.id });
	const spdaB = BD.sesiones_pda.find((r) => r.pda_id === "pda-b");
	const nuevo = Object.assign({}, viejo, {
		campo_formativo: "Saberes y Pensamiento Científico",
		pda_sesion: [{ grado: 3, pda_id: "pda-a", criterio_aplicado: "A corregido" }],
		cierre_tareas: { mode: "todos", todos: ["Tarea que se queda", "Tarea nueva"], diferenciado: null },
	});
	await materializar([nuevo], "m1", Object.assign({}, opts, { anteriores: { s4: viejo } }));
	const nombres = de("productos_sesion", "s4").map((p) => p.nombre).sort();
	ok("reedición: la tarea quitada del plan se borra", nombres.indexOf("Tarea que se quita"), -1);
	ok("reedición: la tarea nueva se agrega (una sola vez)", nombres.filter((n) => n === "Tarea nueva").length, 1);
	ok("reedición: una tarea con calificaciones NO se borra", nombres.indexOf("Tarea calificada") !== -1, true);
	ok("reedición: lo agregado en Hoy se conserva", nombres.indexOf("Actividad de Hoy") !== -1, true);
	ok("reedición: sin productos duplicados (2 trabajos, 3 tareas, 1 de Hoy)",
		de("productos_sesion", "s4").length, 6);
	ok("reedición: el campo nuevo (SAB) pasa a los productos del plan",
		de("productos_sesion", "s4").filter((p) => p.origen === "maestro" && p.id !== "hoy-1" && p.nombre !== "Tarea calificada").every((p) => p.campo === "SAB"), true);
	ok("reedición: lo de Hoy conserva su campo", BD.productos_sesion.find((p) => p.id === "hoy-1").campo, "LEN");
	ok("reedición: el PDA quitado (4°) se borra", BD.sesiones_pda.some((r) => r.id === spdaB.id), false);
	ok("reedición: el criterio corregido se guarda", BD.sesiones_pda.find((r) => r.pda_id === "pda-a").criterio_aplicado, "A corregido");
	ok("reedición: sin PDA duplicados", de("sesiones_pda", "s4").length, 1);

	// ── 5. Un PDA con evaluación formativa no se borra ──
	BD = baseNueva();
	const conEv = { id: "s5", numero_sesion: 5, campo_formativo: "Lenguajes", pda_sesion: [{ grado: 3, pda_id: "pda-x", criterio_aplicado: "X" }], cierre_tareas: null };
	await materializar([conEv], "m1", { gradosProyecto: ["3"] });
	BD.evaluacion_formativa.push({ id: "ev1", sesion_pda_id: BD.sesiones_pda[0].id });
	await materializar([Object.assign({}, conEv, { pda_sesion: [] })], "m1", { gradosProyecto: ["3"], anteriores: { s5: conEv } });
	ok("un PDA con evaluación formativa se conserva aunque se quite del plan", BD.sesiones_pda.length, 1);

	// ── 6. La regla sola (sin base) ──
	const plan = SM.planificar([{ id: "x", numero_sesion: 1, campo_formativo: "Lenguajes", pda_sesion: [], cierre_tareas: null }], {}, { gradosProyecto: [5, 3, 4] });
	ok("planificar: un trabajo por grado, en orden", plan.productosInsertar.map((p) => p.grados.join(",")), ["3", "4", "5"]);
	ok("planificar: un solo grado → compartido", SM.planificar([{ id: "y", numero_sesion: 1, campo_formativo: "Lenguajes" }], {}, { gradosProyecto: [2] }).productosInsertar.map((p) => p.modalidad), ["compartida"]);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA la prueba lanzó: " + (e && e.stack || e)); process.exit(1); });
