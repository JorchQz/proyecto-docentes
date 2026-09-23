/*
	Arranque completo de la boleta sin navegador (B.3 + B.5 + B.7).

	Ejecuta js/reportes.js de verdad contra un DOM mínimo y un Supabase falso, genera
	la boleta de un alumno de 2° y revisa lo que quedó en pantalla y lo que se guardó.
	Caza errores de ejecución, que es lo que ninguna prueba de funciones sueltas ve.

	node pruebas/boleta-arranque.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}
function contiene(nombre, texto, fragmento) {
	ok(nombre, (texto || "").indexOf(fragmento) !== -1, true);
}

// ── DOM mínimo ───────────────────────────────────────────────────────────────
const elementos = {};
const errores = [];
function crearElemento(id) {
	const el = {
		id: id, innerHTML: "", textContent: "", className: "", value: "",
		disabled: false, dataset: {}, options: [], selectedIndex: 0, hijos: [],
		classList: {
			_c: new Set(),
			add: function () {}, remove: function () {}, contains: function () { return false; },
			toggle: function () {},
		},
		_listeners: {},
		addEventListener: function (evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		appendChild: function (hijo) { this.hijos.push(hijo); this.options.push(hijo); },
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		closest: function () { return null; },
		disparar: function (evento) { (this._listeners[evento] || []).forEach(function (fn) { fn({ target: el }); }); },
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

// ── Supabase falso ───────────────────────────────────────────────────────────
const guardado = { boleta_trimestral: [] };
const PRODUCTOS = [
	{ id: "pr1", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["2"], activo: true },
	{ id: "pr2", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["2"], activo: true },
	{ id: "pr3", sesion_id: "s2", tipo: "trabajo", campo: "SAB", grados: ["2"], activo: true },
];
const DATOS = {
	grupos: [{ id: "g1", nombre: "Multigrado", escuela: "Escuela de prueba", ciclo_escolar: "2025-2026" }],
	alumnos: [{ id: "al-2", nombre_completo: "ALUMNA DE SEGUNDO", num_lista: 1, grado: 2 }],
	maestro_ajustes: [{ peso_tareas: 28, peso_trabajos: 28, peso_participacion: 6, peso_conducta: 5, peso_examen: 33 }],
	proyectos: [{ id: "p1" }],
	sesiones: [
		{ id: "s1", fecha: "2026-09-21", campo_formativo: "Lenguajes", numero_sesion: 1, proyecto_id: "p1" },
		{ id: "s2", fecha: "2026-09-22", campo_formativo: "Saberes y Pensamiento Científico", numero_sesion: 2, proyecto_id: "p1" },
	],
	productos_sesion: PRODUCTOS,
	calificaciones: [
		// Tarea no entregada y trabajo flojo en Lenguajes; todo logrado en Saberes
		// El motor reparte las filas por alumno (lee a todo el grupo de una vez): llevan alumno_id
		{ alumno_id: "al-2", proyecto_id: "p1", producto_sesion_id: "pr1", estado_entrega: "no_entregado", nivel: null, puntaje: null },
		{ alumno_id: "al-2", proyecto_id: "p1", producto_sesion_id: "pr2", estado_entrega: "entregado", nivel: "requiere_apoyo", puntaje: null },
		{ alumno_id: "al-2", proyecto_id: "p1", producto_sesion_id: "pr3", estado_entrega: "entregado", nivel: "logrado", puntaje: null },
	],
	registro_diario: [{ alumno_id: "al-2", fecha: "2026-09-21", participacion: 2, conducta: 2 }, { alumno_id: "al-2", fecha: "2026-09-22", participacion: 2, conducta: 2 }],
	asistencias: [{ alumno_id: "al-2", asistencia_estado: "presente" }, { alumno_id: "al-2", asistencia_estado: "presente" }, { alumno_id: "al-2", asistencia_estado: "ausente" }],
	examenes: [],
	respuestas_examen: [],
	banco_preguntas: [],
	evaluacion_diagnostica: [{
		lectura_ppm: 20, lectura_comprension: "requiere_apoyo", observaciones: null,
		matematicas: [{ clave: "mates.resta", nivel: "requiere_apoyo" }],
		cuaderno: [{ clave: "cuaderno.letra_legible", nivel: "logrado" }],
	}],
	bandas_ppm: [{ grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 }],
	boleta_trimestral: [],
	v_avance_pda: [
		{ campo_formativo: "Lenguajes", pda: "Escribe su nombre y apellidos", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "mejora" },
		{ campo_formativo: "Saberes y Pensamiento Científico", pda: "Mide longitudes con distintas unidades", nivel_predominante: "logrado", evidencias: 2, tendencia: "estable" },
	],
};

function consulta(tabla) {
	const q = {
		_single: false,
		select: function () { return this; },
		eq: function () { return this; }, in: function () { return this; },
		gte: function () { return this; }, lte: function () { return this; },
		not: function () { return this; }, order: function () { return this; },
		limit: function () { return this; },
		range: function () { return this; },
		single: function () { this._single = true; return this; },
		maybeSingle: function () { this._single = true; return this; },
		insert: function () { return this; },
		update: function () { return this; },
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
	rpc: function (nombre, args) {
		// Misma regla que la función SQL: piso 6 en 1°-2°, 5 en 3°-6°
		function convertir(p, grado) {
			if (p === null || p === undefined) return null;
			const piso = grado <= 2 ? 6 : 5;
			const v = p >= 90 ? 10 : p >= 80 ? 9 : p >= 70 ? 8 : p >= 60 ? 7 : p >= 50 ? 6 : 5;
			return Math.max(v, piso);
		}
		if (nombre === "calcular_calificaciones_boleta") {
			return Promise.resolve({ data: args.p_porcentajes.map(function (p, i) { return convertir(p, args.p_grados[i]); }), error: null });
		}
		return Promise.resolve({ data: convertir(args.p_porcentaje, args.p_grado), error: null });
	},
};

// ── Ejecutar ─────────────────────────────────────────────────────────────────
const codigo = fs.readFileSync((process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js")), "utf8");
const consolaOriginal = console.error;
console.error = function () { errores.push(Array.prototype.slice.call(arguments).join(" ")); };
new Function(codigo)();

(async function () {
	try {
		await document._domReady();
		if (!elementos.selectAlumnoBoleta) {
			throw new Error("la pantalla no llegó a la boleta. Elementos creados: " + Object.keys(elementos).join(", "));
		}
		// Los selectores del panel (el de trimestre solo se consulta al generar)
		document.getElementById("selectAlumnoBoleta").value = "al-2";
		document.getElementById("selectTrimBoleta").value = "1";
		const generar = (elementos.generarBoletaBtn._listeners.click || [])[0];
		if (!generar) throw new Error("no se registró el botón de generar boleta");
		await generar();
	} catch (e) {
		fallos++;
		console.log("FALLA el arranque lanzó una excepción → " + (e && e.stack ? e.stack : e));
	}
	console.error = consolaOriginal;

	const html = elementos.boletaContainer ? elementos.boletaContainer.innerHTML : "";
	ok("el arranque no dejó errores en consola", errores.length === 0 ? "sin errores" : errores[0], "sin errores");
	ok("la boleta no quedó vacía", html.length > 0, true);

	// B.3 — el motor y el piso por fase
	contiene("hay tabla de rubros", html, "Tareas");
	contiene("la asistencia sale como referencia", html, "no forma parte de la calificación");
	contiene("pide confirmar antes de cerrar", html, "Confirmar calificaciones");
	const filaLen = (guardado.boleta_trimestral || []).filter(function (f) { return f.campo === "LEN" && f.calificacion; })[0];
	ok("Lenguajes bajo 50% se guarda con el piso de 2°: 6", filaLen ? filaLen.calificacion : null, 6);
	const filaSab = (guardado.boleta_trimestral || []).filter(function (f) { return f.campo === "SAB" && f.calificacion; })[0];
	ok("Saberes al 100% da 10", filaSab ? filaSab.calificacion : null, 10);

	// B.7 — los textos propuestos
	contiene("marca los textos como propuestos", html, "(propuesto)");
	contiene("ofrece volver a proponer", html, "Volver a proponer");
	contiene("propone fortalezas", html, "Fortalezas");
	contiene("propone sugerencias", html, "Sugerencias");
	contiene("la tarea no entregada se refleja", html, "No entrega todas sus tareas");
	contiene("el PDA en apoyo se cita textual", html, "Necesita apoyo para lograr");
	contiene("el PDA logrado es fortaleza en su campo", html, "Mide longitudes");
	contiene("la lectura lenta se señala", html, "velocidad de lectura está por debajo");
	contiene("con su sugerencia de leer en casa", html, "10 minutos diarios");
	contiene("las matemáticas flojas van a Saberes", html, "Necesita apoyo en: resta");
	// Tareas en 0% pero trabajos al 70% entre los dos campos: la frase mixta
	contiene("el trabajo diario se redacta solo", html, "no siempre trae la tarea");

	const textosGuardados = (guardado.boleta_trimestral || []).filter(function (f) { return f.texto_autogenerado; });
	// Solo se guardan los bloques con algo que proponer: LEN, SAB y la fila general.
	// ETI y DHL no tienen evidencias y no deben dejar filas vacías en la boleta.
	ok("se guarda la propuesta solo donde hay texto", textosGuardados.map(function (f) { return f.campo; }).sort().join(","), "GEN,LEN,SAB");
	ok("y también se escribe en los campos visibles",
		textosGuardados.every(function (f) { return f.fortalezas !== undefined; }), true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
