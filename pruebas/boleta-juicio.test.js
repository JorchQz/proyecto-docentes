/*
	Boleta en Reportes: decisiones de Jorge 5, 6 y 7 (2026-09-24).

	Ejecuta js/reportes.js de verdad (pestaña Boleta) con un Supabase falso:
	  A) Alumno sin NINGUNA evidencia en el trimestre (el grupo sí tiene proyecto): los
	     cuatro campos ofrecen "Elige" dentro de la escala de su fase, "Confirmar" queda
	     habilitado y nada se guarda con un número inventado.
	  B) Lo mismo con un alumno de 4° (Fase 4): la escala empieza en 5.
	  C) Sin proyectos en el trimestre: no se ofrece nada (no hay qué calificar todavía).
	  D) Boleta cerrada con la foto completa y el grado cambiado después (de 2° a 4°): el
	     grado, la escala, el desglose por rubro y los pesos son los del cierre, y la
	     calificación elegida por juicio lleva su marca.
	  E) Confirmadas por juicio las cuatro: "Cerrar boleta" habilitado.

	node pruebas/boleta-juicio.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}
function contiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) !== -1, true); }
function noContiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) === -1, true); }

// ── DOM mínimo ───────────────────────────────────────────────────────────────
let elementos = {};
const errores = [];
function crearElemento(id) {
	const el = {
		id: id, innerHTML: "", textContent: "", className: "", value: "",
		disabled: false, dataset: {}, options: [], hijos: [],
		classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
		_listeners: {},
		addEventListener: function (evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		appendChild: function (hijo) { this.hijos.push(hijo); this.options.push(hijo); },
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		closest: function () { return null; },
	};
	return el;
}
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	createElement: function () { return crearElemento("opt"); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = { location: { href: "" }, confirm: function () { return true; }, alert: function () {}, open: function () {} };
global.Event = function () {};

require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/catalogo-habilidades.js");
require("../js/motor-calificacion.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const RD = window.ReporteDatos;

const BANDA_2 = { grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 };
const BANDA_4 = { grado: 4, requiere_apoyo_max: 84, cercano_max: 99, estandar_max: 114 };

// ── Supabase falso (una base por escenario) ──────────────────────────────────
let DATOS = {};
let guardado = {};
function consulta(tabla) {
	const q = {
		_single: false,
		select: function () { return this; },
		eq: function () { return this; }, in: function () { return this; },
		gte: function () { return this; }, lte: function () { return this; },
		not: function () { return this; }, neq: function () { return this; }, order: function () { return this; },
		limit: function () { return this; }, range: function () { return this; },
		single: function () { this._single = true; return this; },
		maybeSingle: function () { this._single = true; return this; },
		insert: function () { return this; }, update: function () { return this; },
		upsert: function (filas) {
			guardado[tabla] = (guardado[tabla] || []).concat(Array.isArray(filas) ? filas : [filas]);
			return this;
		},
		then: function (resolver) {
			const filas = DATOS[tabla] || [];
			return Promise.resolve(resolver({ data: this._single ? (filas[0] || null) : filas, error: null }));
		},
	};
	return q;
}
global.window.sb = {
	auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: "m1" } } }, error: null }); } },
	from: function (t) { return consulta(t); },
	functions: { invoke: function () { return Promise.resolve({ data: { configurada: false }, error: null }); } },
	rpc: function (nombre, args) {
		function convertir(p, grado) {
			if (p === null || p === undefined) return null;
			const piso = grado <= 2 ? 6 : 5;
			const v = p >= 90 ? 10 : p >= 80 ? 9 : p >= 70 ? 8 : p >= 60 ? 7 : p >= 50 ? 6 : 5;
			return Math.max(v, piso);
		}
		if (nombre === "calcular_calificaciones_boleta") {
			return Promise.resolve({ data: args.p_porcentajes.map(function (p, i) { return convertir(p, args.p_grados[i]); }), error: null });
		}
		return Promise.resolve({ data: null, error: null });
	},
};

function base(alumno, extra) {
	return Object.assign({
		grupos: [{ id: "g1", nombre: "Multigrado", escuela: "Escuela de prueba", ciclo_escolar: "2025-2026" }],
		alumnos: [alumno],
		maestro_ajustes: [{ peso_tareas: 28, peso_trabajos: 28, peso_participacion: 6, peso_conducta: 5, peso_examen: 33 }],
		// El grupo tiene proyecto y productos, pero de OTRO grado: este alumno no tiene evidencias
		proyectos: [{ id: "p1" }],
		sesiones: [{ id: "s1", fecha: "2026-09-21", campo_formativo: "Lenguajes", numero_sesion: 1, proyecto_id: "p1" }],
		productos_sesion: [{ id: "pr1", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["6"], activo: true }],
		calificaciones: [], registro_diario: [], asistencias: [],
		examenes: [], respuestas_examen: [], banco_preguntas: [],
		evaluacion_diagnostica: [],
		bandas_ppm: [BANDA_2, BANDA_4],
		plantillas_sugerencia: [],
		boleta_trimestral: [],
		v_avance_pda: [],
	}, extra || {});
}

const codigo = fs.readFileSync(process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js"), "utf8");

async function boletaCon(datos, alumnoId) {
	DATOS = datos; guardado = {}; elementos = {};
	errores.length = 0;
	const consolaOriginal = console.error;
	console.error = function () { errores.push(Array.prototype.slice.call(arguments).join(" ")); };
	try {
		new Function(codigo)();
		await document._domReady();
		document.getElementById("selectAlumnoBoleta").value = alumnoId;
		document.getElementById("selectTrimBoleta").value = "1";
		await (elementos.generarBoletaBtn._listeners.click || [])[0]();
	} catch (e) {
		fallos++;
		console.log("FALLA la boleta lanzó una excepción → " + (e && e.stack ? e.stack : e));
	}
	console.error = consolaOriginal;
	return elementos.boletaContainer ? elementos.boletaContainer.innerHTML : "";
}

function selectoresSinEvidencia(html) {
	return (html.match(/data-cal-sin-evidencia='1'/g) || []).length;
}
function opciones(html, campo) {
	const m = html.match(new RegExp("<select data-cal-campo='" + campo + "'[^>]*>([\\s\\S]*?)</select>"));
	return m ? (m[1].match(/<option value='(\d*)'/g) || []).map((o) => o.match(/'(\d*)'/)[1]).join(",") : null;
}

(async function () {
	// ── A) 2° sin ninguna evidencia ──
	const al2 = { id: "al-2", nombre_completo: "B1 SIN EVIDENCIAS", num_lista: 1, grado: 2 };
	let html = await boletaCon(base(al2), "al-2");
	ok("A: sin errores en consola", errores.length === 0 ? "sin errores" : errores[0], "sin errores");
	ok("A: los cuatro campos ofrecen «Elige»", selectoresSinEvidencia(html), 4);
	ok("A: escala de Fase 3 (6 a 10) en el selector", opciones(html, "LEN"), ",6,7,8,9,10");
	contiene("A: rotula la escala de la fase", html, "Fase 3: 6 a 10");
	contiene("A: explica que es juicio docente", html, "no tiene evidencias registradas en este trimestre");
	ok("A: «Confirmar» habilitado", /id='boletaConfirmarBtn' type='button' disabled/.test(html), false);
	ok("A: «Cerrar boleta» deshabilitado hasta confirmar", /id='boletaCerrarBtn' type='button' disabled/.test(html), true);
	const numericas = (guardado.boleta_trimestral || []).filter((f) => f.calificacion !== undefined || f.porcentaje !== undefined);
	ok("A: no se guarda ningún número ni porcentaje inventado", numericas.length, 0);
	noContiene("A: ningún porcentaje", html, "NaN");

	// ── B) 4° sin ninguna evidencia: escala 5 a 10 ──
	const al4 = { id: "al-4", nombre_completo: "B1 CUARTO SIN EVIDENCIAS", num_lista: 1, grado: 4 };
	html = await boletaCon(base(al4), "al-4");
	ok("B: los cuatro campos ofrecen «Elige»", selectoresSinEvidencia(html), 4);
	ok("B: escala de Fase 4 (5 a 10)", opciones(html, "DHL"), ",5,6,7,8,9,10");
	contiene("B: rotula la escala de la fase", html, "Fase 4: 5 a 10; 5 no acredita");

	// ── C) Sin proyectos en el trimestre: no se ofrece nada ──
	html = await boletaCon(base(al2, { proyectos: [], sesiones: [], productos_sesion: [] }), "al-2");
	ok("C: sin proyectos no ofrece «Elige»", selectoresSinEvidencia(html), 0);
	ok("C: «Confirmar» deshabilitado", /id='boletaConfirmarBtn' type='button' disabled/.test(html), true);
	contiene("C: lo dice", html, "Todavía no hay evidencias en este trimestre");

	// ── E) Confirmadas por juicio las cuatro (abierta): se puede cerrar y lleva la marca ──
	const confirmadas = ["LEN", "SAB", "ETI", "DHL"].map((c, i) => ({
		id: "b-" + c, alumno_id: "al-2", ciclo: "2025-2026", trimestre: 1, campo: c,
		calificacion: 6 + i, porcentaje: null, calificacion_confirmada: true, cerrada: false, texto_autogenerado: {},
	}));
	html = await boletaCon(base(al2, { boleta_trimestral: confirmadas }), "al-2");
	ok("E: «Cerrar boleta» habilitado", /id='boletaCerrarBtn' type='button' disabled/.test(html), false);
	ok("E: «Guardar ajustes» habilitado", /id='boletaConfirmarBtn' type='button' disabled/.test(html), false);
	ok("E: las cuatro con la marca de juicio docente", (html.match(/data-juicio='1'/g) || []).length, 4);
	contiene("E: confirmadas", html, "Calificaciones confirmadas por el docente");

	// ── D) Cerrada con la foto completa; después el alumno pasó de 2° a 4° ──
	const motorCierre = { LEN: { rubros: {
		tareas: { obtenido: 1, maximo: 2, fraccion: 0.5, peso: 28 }, trabajos: { obtenido: 3, maximo: 3, fraccion: 1, peso: 28 },
		participacion: { obtenido: 1, maximo: 1, fraccion: 1, peso: 6 }, conducta: { obtenido: 0, maximo: 0, fraccion: null, peso: 5 },
		examen: { obtenido: 0, maximo: 0, fraccion: null, peso: 33 },
	}, porcentaje: 75, nivel: "en_proceso" }, SAB: { rubros: {}, porcentaje: 90, nivel: "logrado" },
	ETI: { rubros: {}, porcentaje: 80, nivel: "logrado" }, DHL: { rubros: {}, porcentaje: null } };
	const foto = {
		trabajo_diario: "TD del cierre", trabajo_diario_del_maestro: false,
		diagnostico: { lectura_ppm: 70, lectura_comprension: "logrado", cuaderno: [], matematicas: [] },
		asistencia: { presentes: 5, total: 5, porcentaje: 1 },
		alumno: RD.fotoAlumno({ grado: 2 }, BANDA_2),
		campos: RD.fotoCampos(motorCierre),
		pesos: { tareas: 28, trabajos: 28, participacion: 6, conducta: 5, examen: 33 },
		avance_pda: [], en: "2026-09-23T00:00:00Z",
	};
	const cerradas = ["LEN", "SAB", "ETI", "DHL"].map((c) => ({
		id: "c-" + c, alumno_id: "al-x", ciclo: "2025-2026", trimestre: 1, campo: c,
		calificacion: { LEN: 8, SAB: 10, ETI: 9, DHL: 7 }[c], porcentaje: motorCierre[c].porcentaje, nivel: motorCierre[c].nivel || null,
		calificacion_confirmada: true, cerrada: true, fortalezas: null, texto_autogenerado: {},
	})).concat([{ id: "c-GEN", alumno_id: "al-x", ciclo: "2025-2026", trimestre: 1, campo: "GEN", cerrada: false,
		texto_autogenerado: { cierre: foto } }]);
	// Hoy: 4°, pesos distintos y productos de 4° con otra evidencia
	const alHoy = { id: "al-x", nombre_completo: "B1 CAMBIO DE GRADO", num_lista: 2, grado: 4 };
	html = await boletaCon(base(alHoy, {
		boleta_trimestral: cerradas,
		maestro_ajustes: [{ peso_tareas: 50, peso_trabajos: 50, peso_participacion: 0, peso_conducta: 0, peso_examen: 0 }],
		productos_sesion: [{ id: "pr4", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["4"], activo: true }],
		calificaciones: [{ alumno_id: "al-x", proyecto_id: "p1", producto_sesion_id: "pr4", estado_entrega: "no_entregado", nivel: null, puntaje: null }],
		evaluacion_diagnostica: [{ lectura_ppm: 5, lectura_comprension: "requiere_apoyo", cuaderno: [], matematicas: [], observaciones: null }],
	}), "al-x");
	ok("D: sin errores en consola", errores.length === 0 ? "sin errores" : errores[0], "sin errores");
	ok("D: nada se vuelve a guardar", (guardado.boleta_trimestral || []).length, 0);
	contiene("D: grado del cierre (2°), no el de hoy (4°)", html, "Grado:</span> <span class='font-semibold text-gray-800'>2°");
	contiene("D: escala del cierre", html, "Fase 3: 6 a 10");
	noContiene("D: no la de hoy", html, "5 no acredita");
	// Peso efectivo con los pesos del cierre (28, 28 y 6 con datos): 45.1, 45.1 y 9.8
	contiene("D: pesos del cierre (tareas pesa 45.1 %)", html, "data-peso-etiqueta>45.1\u00a0%");
	// La conducta tenía peso 5 en la foto, pero sin datos: no entró, la nota no dice que ponderó
	contiene("D: la conducta sin datos no ponderó", html, "no pondera en el porcentaje ni en la calificación");
	noContiene("D: no los pesos de hoy (50 %)", html, "50 %</span>");
	contiene("D: desglose del cierre (LEN tareas 1 / 2)", html, "1 / 2");
	contiene("D: porcentaje del cierre", html, "75.0 %");
	// Hoy ya no coincide, pero todo lo que se ve es lo del cierre: sin aviso (la pantalla no cambia)
	noContiene("D: sin aviso de capturas después del cierre", html, "Hubo capturas después del cierre");
	contiene("D: fluidez con la banda del cierre (70 ppm en 2° = en la referencia)", html, "En la referencia");
	ok("D: DHL (sin evidencias al cerrar) con la marca de juicio docente", (html.match(/data-juicio='1'/g) || []).length, 1);

	// Reglas compartidas de la foto
	ok("fotoAlumno: 4° es Fase 4 con 5 no acredita", RD.fotoAlumno({ grado: 4 }, BANDA_4).escala, "5 a 10; 5 no acredita");
	ok("fotoCampos: sin evidencias = porcentaje null y marcado", JSON.stringify(RD.fotoCampos(motorCierre).DHL), JSON.stringify({ porcentaje: null, nivel: null, sin_evidencias: true, rubros: {} }));
	ok("fotoCampos: el porcentaje se trunca a 2 decimales (igual que la fila)", RD.fotoCampos({ LEN: { porcentaje: 49.996, rubros: {} } }).LEN.porcentaje, 49.99);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
