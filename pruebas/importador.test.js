/*
	Importador de proyectos del bot (js/importador.js), correcciones del 2026-09-27 (PP-NIVELES):
	  - pda_sesion del bot trae en pda_id el id de dosificacion_pdas (su contrato); se traduce al
	    del catálogo (sesiones_pda.pda_id es FK a catalogo_pda: antes la importación fallaba).
	  - contenidos_pda del proyecto se arma con dosificacion_pdas (sin él, Crear proyecto no ofrecía
	    los PDA y guardar sin cambios los quitaba).
	  - cierre_tareas por grado: el bot guarda texto por grado; se guarda como lista.
	  - Opciones para el script de carga (trimestre, estado, ajustarSesion, antesDeMaterializar):
	    lo que se inserta antes de materializar llena su hueco y el materializador no crea el
	    trabajo genérico.
	Corre el archivo real contra un Supabase falso en memoria.

	node pruebas/importador.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
require("../js/sesiones-materializar.js");
const I = require("../js/importador.js");

// ── Datos con la forma del bot (dosificacion_*) ──
const DOS = "dos-1";
const BD = {
	dosificacion_proyectos: [{
		id: DOS, nombre_proyecto: "Así me llamo", metodologia: "Aprendizaje Servicio", escenario: "Aula",
		campos_formativos: ["Lenguajes", "Ética, Naturaleza y Sociedades"], grados: ["1", "2"], trimestre: null, fase: "Fase 3",
		producto_final: "Mural del salón", pregunta_generadora: "¿Cómo convivimos?", ejes_articuladores: ["Inclusión"],
	}],
	dosificacion_sesiones: [
		{ id: "ds2", proyecto_dos_id: DOS, numero_sesion: 2, fecha_sesion: "2026-09-28", campo_formativo: "Ética, Naturaleza y Sociedades",
			momento: "Punto de partida", duracion_minutos: null, observaciones: "Sesión 2",
			cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 1: "Dibuja la regla.", 2: "Escribe la regla." } },
			pda_sesion: [{ grado: 1, pda_id: "dp-e1", pda_texto: "Acuerdos", criterio_aplicado: "Vota" }, { grado: 2, pda_id: "dp-e2", pda_texto: "Normas", criterio_aplicado: "Propone" }] },
		{ id: "ds1", proyecto_dos_id: DOS, numero_sesion: 1, fecha_sesion: "2026-09-28", campo_formativo: "Lenguajes",
			momento_metodologico: "Punto de partida", duracion_minutos: 50, observaciones: null, cierre_tareas: null,
			pda_sesion: [{ grado: 1, pda_id: "dp-l1", pda_texto: "Nombre", criterio_aplicado: "Repasa" }, { grado: 2, pda_id: "dp-l2", pda_texto: "Nombre y apellidos", criterio_aplicado: "Escribe" }] },
	],
	dosificacion_pdas: [
		{ id: "dp-l1", proyecto_dos_id: DOS, pda_id: "cat-l1", contenido_id: "cont-l", grado: 1, campo_formativo: "Lenguajes", contenido_texto: "Escritura de nombres", pda_texto: "Nombre" },
		{ id: "dp-l2", proyecto_dos_id: DOS, pda_id: "cat-l2", contenido_id: "cont-l", grado: 2, campo_formativo: "Lenguajes", contenido_texto: "Escritura de nombres", pda_texto: "Nombre y apellidos" },
		{ id: "dp-e1", proyecto_dos_id: DOS, pda_id: "cat-e1", contenido_id: "cont-e", grado: 1, campo_formativo: "Ética, Naturaleza y Sociedades", contenido_texto: "Democracia", pda_texto: "Acuerdos" },
		{ id: "dp-e2", proyecto_dos_id: DOS, pda_id: "cat-e2", contenido_id: "cont-e", grado: 2, campo_formativo: "Ética, Naturaleza y Sociedades", contenido_texto: "Democracia", pda_texto: "Normas" },
	],
	proyectos: [], sesiones: [], sesiones_pda: [], productos_sesion: [], producto_sesion_pda: [], calificaciones: [],
};

// ── La regla sin base de datos ──
const f = I.filasDeImportacion(BD.dosificacion_proyectos[0], BD.dosificacion_sesiones, BD.dosificacion_pdas,
	{ maestroId: "m1", grupoId: "g1", trimestre: 1, estado: "activo" });
ok("proyecto: metodología y escenario del SaaS, trimestre y estado elegidos, producto final como propósito",
	[f.proyecto.metodologia, f.proyecto.escenario, f.proyecto.trimestre, f.proyecto.estado, f.proyecto.proposito, f.proyecto.fase], ["AS", "Aula", 1, "activo", "Mural del salón", ["Fase 3"]]);
ok("proyecto: contenidos_pda por campo, con los PDA del catálogo (el paso 2 de Crear proyecto)", f.proyecto.contenidos_pda, {
	"Lenguajes": { contenidos_ids: ["cont-l"], pda_ids: ["cat-l1", "cat-l2"], contenidos_texto: ["Escritura de nombres"] },
	"Ética, Naturaleza y Sociedades": { contenidos_ids: ["cont-e"], pda_ids: ["cat-e1", "cat-e2"], contenidos_texto: ["Democracia"] },
});
ok("origen: la fila del bot de cada sesión, en el mismo orden", f.origen.map((d) => d.id), ["ds1", "ds2"]);
ok("sesiones en el orden de la planeación, sin fecha", f.sesiones.map((s) => [s.numero_sesion, "fecha" in s]), [[1, false], [2, false]]);
ok("pda_sesion: pda_id del catálogo (no el de dosificacion_pdas)", f.sesiones[0].pda_sesion.map((p) => p.pda_id), ["cat-l1", "cat-l2"]);
ok("cierre_tareas por grado: listas", f.sesiones[1].cierre_tareas, { mode: "diferenciado", todos: null, diferenciado: { 1: ["Dibuja la regla."], 2: ["Escribe la regla."] } });
ok("momento (o su alias histórico), duración y observaciones", [f.sesiones[0].momento, f.sesiones[0].duracion, f.sesiones[1].observaciones], ["Punto de partida", "50 min", "Sesión 2"]);
ok("sin opciones: borrador y el trimestre de la dosificación (la tienda no cambia)",
	[I.filasDeImportacion(BD.dosificacion_proyectos[0], [], [], {}).proyecto.estado, I.filasDeImportacion(BD.dosificacion_proyectos[0], [], [], {}).proyecto.trimestre], ["borrador", null]);
ok("un pda_id que ya es del catálogo se queda igual", I.traducirPdaSesion([{ grado: 1, pda_id: "cat-x" }], BD.dosificacion_pdas), [{ grado: 1, pda_id: "cat-x" }]);

// ── importarProyecto contra un Supabase falso ──
let secuencia = 0;
function crearSb() {
	return {
		from(tabla) {
			const q = { filtros: [], op: "select", filas: null, cambios: null, uno: false };
			const api = {
				select() { return api; },
				in(col, vals) { q.filtros.push((x) => vals.indexOf(x[col]) !== -1); return api; },
				eq(col, val) { q.filtros.push((x) => x[col] === val); return api; },
				is(col, val) { q.filtros.push((x) => (x[col] === undefined ? null : x[col]) === val); return api; },
				order() { return api; },
				range() { return api; },
				single() { q.uno = true; return api; },
				insert(filas) { q.op = "insert"; q.filas = Array.isArray(filas) ? filas : [filas]; return api; },
				update(c) { q.op = "update"; q.cambios = c; return api; },
				delete() { q.op = "delete"; return api; },
				then(resolver, rechazar) {
					const t = BD[tabla] = BD[tabla] || [];
					const pasa = (x) => q.filtros.every((fn) => fn(x));
					let data = null;
					if (q.op === "insert") {
						data = q.filas.map((x) => {
							const fila = Object.assign({ id: tabla + "-" + (++secuencia), created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, secuencia)).toISOString(), activo: true }, x);
							if (tabla === "producto_sesion_pda") delete fila.id;
							t.push(fila);
							return fila;
						});
					} else if (q.op === "update") {
						t.filter(pasa).forEach((x) => Object.assign(x, q.cambios));
					} else if (q.op === "delete") {
						BD[tabla] = t.filter((x) => !pasa(x));
					} else {
						data = t.filter(pasa);
					}
					if (q.uno) data = data && data.length ? data[0] : null;
					return Promise.resolve({ data: data, error: null }).then(resolver, rechazar);
				},
			};
			return api;
		},
	};
}
global.window.sb = crearSb();

(async () => {
	const orden = [];
	const id = await global.window.importarProyecto(DOS, "m1", "g1", {
		trimestre: 1, estado: "activo",
		ajustarSesion: (fila, ds) => { orden.push("ajustar " + ds.numero_sesion); return Object.assign(fila, { recursos: { links: [{ titulo: "Carpeta", url: "https://drive.google.com/x" }], archivos: [] } }); },
		antesDeMaterializar: async (sesiones) => {
			orden.push("antes");
			// El trabajo de 1° de la sesión 1 con nombre por grupo de trabajo: llena su hueco
			const s1 = sesiones.find((s) => s.numero_sesion === 1);
			BD.productos_sesion.push({ id: "p-naranja", sesion_id: s1.id, tipo: "trabajo", nombre: "Tarjeta · Naranja", grados: ["1"], campo: "LEN", modalidad: "diferenciada", activo: true, created_at: "2026-08-01T00:00:00Z" });
		},
		alMaterializar: (r) => orden.push("materializado " + r.insertados),
	});
	const p = BD.proyectos.find((x) => x.id === id);
	ok("importa: proyecto activo del trimestre 1", [p.estado, p.trimestre, !!p.contenidos_pda], ["activo", 1, true]);
	ok("importa: ajusta cada sesión, inserta lo propio antes de materializar y luego materializa",
		orden, ["ajustar 1", "ajustar 2", "antes", "materializado 5"]);
	const s1 = BD.sesiones.find((s) => s.numero_sesion === 1);
	ok("importa: la sesión lleva sus recursos ajustados y sin fecha", [s1.recursos.links[0].titulo, s1.fecha === undefined || s1.fecha === null], ["Carpeta", true]);
	ok("importa: sesiones_pda con los PDA del catálogo", BD.sesiones_pda.map((r) => r.pda_id).sort(), ["cat-e1", "cat-e2", "cat-l1", "cat-l2"]);
	const deS1 = BD.productos_sesion.filter((x) => x.sesion_id === s1.id).map((x) => x.nombre + " [" + x.grados.join(",") + "]").sort();
	ok("importa: el trabajo de 1° con nombre llena su hueco (sin genérico de 1°)", deS1, ["Producto — Sesión 1 · LEN [2]", "Tarjeta · Naranja [1]"]);
	const tareas = BD.productos_sesion.filter((x) => x.tipo === "tarea").map((x) => x.nombre + " [" + x.grados.join(",") + "]").sort();
	ok("importa: las tareas por grado (texto del bot) se materializan", tareas, ["Dibuja la regla. [1]", "Escribe la regla. [2]"]);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA " + e.message); process.exit(1); });
