/*
	Boleta cerrada (re-ensayo 3.10): lo entregado queda fijo.

	Ejecuta js/reportes.js de verdad con una boleta ya CERRADA (los cuatro campos) y
	capturas posteriores que la bajarían. Nada se vuelve a guardar ni a proponer: el
	porcentaje y la calificación son los del cierre, los textos los guardados (también
	los de la fila GEN, que la base no marca cerrada) y el trabajo diario el de la foto
	del cierre. Revisa también las reglas compartidas de ReporteDatos que usan la boleta
	imprimible, el reporte detallado y la exportación.

	node pruebas/boleta-cerrada.test.js
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
require("../js/reporte-datos.js");

// ── Supabase falso ───────────────────────────────────────────────────────────
const guardado = { boleta_trimestral: [] };
const PRODUCTOS = [
	{ id: "pr1", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["2"], activo: true },
	{ id: "pr2", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["2"], activo: true },
	{ id: "pr3", sesion_id: "s2", tipo: "trabajo", campo: "SAB", grados: ["2"], activo: true },
	// Segunda tarea: con una sola no se afirma nada (EVIDENCIAS_MINIMAS = 2)
	{ id: "pr4", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["2"], activo: true },
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
		{ alumno_id: "al-2", proyecto_id: "p1", producto_sesion_id: "pr4", estado_entrega: "no_entregado", nivel: null, puntaje: null },
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
	boleta_trimestral: ["LEN", "SAB", "ETI", "DHL"].map(function (c) {
		return {
			id: "b-" + c, alumno_id: "al-2", ciclo: "2025-2026", trimestre: 1, campo: c,
			calificacion: 10, porcentaje: 93.28, calificacion_confirmada: true, cerrada: true,
			fortalezas: "Texto entregado " + c, areas_oportunidad: null, sugerencias: null,
			texto_autogenerado: { visible: "reglas", editados: [] },
		};
	}).concat([{
		id: "b-GEN", alumno_id: "al-2", ciclo: "2025-2026", trimestre: 1, campo: "GEN",
		cerrada: false, calificacion_confirmada: false,
		fortalezas: "General entregado", areas_oportunidad: null, sugerencias: null,
		texto_autogenerado: { visible: "reglas", editados: [], cierre: { trabajo_diario: "Trabajo diario entregado al cierre", trabajo_diario_del_maestro: false,
			// Al cerrar el diagnóstico decía 77 ppm y resta "logrado"; hoy dice 20 ppm y "requiere apoyo"
			diagnostico: { lectura_ppm: 77, lectura_comprension: "logrado", matematicas: [{ clave: "mates.resta", nivel: "logrado" }], cuaderno: [] },
			// Al cerrar asistió 3 de 3; hoy la base dice 2 de 3
			asistencia: { presentes: 3, total: 3, porcentaje: 1 } } },
	}]),
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

	// Nada se vuelve a escribir en la boleta cerrada
	ok("no se guarda nada en boleta_trimestral", (guardado.boleta_trimestral || []).length, 0);
	contiene("dice que está cerrada", html, "Boleta cerrada");
	contiene("el porcentaje es el del cierre (93.28)", html, "93.2 %");
	contiene("avisa que hubo capturas después del cierre", html, "Hubo capturas después del cierre");
	contiene("la calificación es la del cierre", html, ">10<");
	contiene("los textos son los entregados", html, "Texto entregado LEN");
	contiene("también los de la fila GEN", html, "General entregado");
	contiene("el trabajo diario es el de la foto del cierre", html, "Trabajo diario entregado al cierre");
	ok("no aparece la propuesta nueva de trabajo diario", html.indexOf("no siempre trae la tarea") === -1, true);
	ok("no aparece la propuesta nueva de textos", html.indexOf("No entrega todas sus tareas") === -1, true);
	ok("no marca nada como propuesto", html.indexOf("(propuesto)") === -1, true);
	ok("no ofrece volver a proponer", html.indexOf("Volver a proponer") === -1, true);
	ok("los cuadros son de solo lectura", html.indexOf("readonly") !== -1, true);
	ok("asistencia de referencia: la del cierre (3 de 3), no la de hoy (2 de 3)", html.indexOf("3 de 3 días") !== -1 && html.indexOf("2 de 3 días") === -1, true);
	ok("asistenciaVisible cerrada: la foto", window.ReporteDatos.asistenciaVisible({ presentes: 2, total: 3 }, { texto_autogenerado: { cierre: { asistencia: { presentes: 3, total: 3 } } } }, true).presentes, 3);
	ok("asistenciaVisible abierta: la de hoy", window.ReporteDatos.asistenciaVisible({ presentes: 2, total: 3 }, { texto_autogenerado: { cierre: { asistencia: { presentes: 3, total: 3 } } } }, false).presentes, 2);
	ok("cuaderno y habilidades: el PPM del cierre (77), no el de hoy (20)", />77</.test(html) && !/>20</.test(html), true);

	// Diagnóstico visible (lo usan la boleta imprimible, el reporte detallado y la exportación)
	const vivo = { lectura_ppm: 20, observaciones: "hoy", matematicas: [] };
	const genFoto = { texto_autogenerado: { cierre: { diagnostico: { lectura_ppm: 77, lectura_comprension: null, matematicas: [], cuaderno: [] } } } };
	ok("diagnosticaVisible cerrada: la foto", window.ReporteDatos.diagnosticaVisible(vivo, genFoto, true).lectura_ppm, 77);
	ok("diagnosticaVisible abierta: lo de hoy", window.ReporteDatos.diagnosticaVisible(vivo, genFoto, false).lectura_ppm, 20);
	ok("diagnosticaVisible cerrada sin diagnóstico al cerrar: ninguno",
		window.ReporteDatos.diagnosticaVisible(vivo, { texto_autogenerado: { cierre: { diagnostico: null } } }, true), null);
	ok("diagnosticaVisible cerrada antes de la foto: lo de hoy",
		window.ReporteDatos.diagnosticaVisible(vivo, { texto_autogenerado: { cierre: { trabajo_diario: "x" } } }, true).lectura_ppm, 20);
	ok("fotoDiagnostico guarda solo cuaderno, lectura y matemáticas",
		Object.keys(window.ReporteDatos.fotoDiagnostico({ lectura_ppm: 5, observaciones: "no", id: "x", cuaderno: [], matematicas: [], lectura_comprension: null })).sort().join(","),
		"cuaderno,lectura_comprension,lectura_ppm,matematicas");

	// Reglas compartidas (boleta imprimible, reporte detallado, exportación)
	const RD = window.ReporteDatos;
	const filasT = {};
	DATOS.boleta_trimestral.forEach(function (f) { filasT[f.campo] = f; });
	ok("boletaCerrada: los cuatro campos cerrados", RD.boletaCerrada(filasT), true);
	ok("boletaCerrada: con uno abierto no", RD.boletaCerrada(Object.assign({}, filasT, { DHL: { cerrada: false } })), false);
	ok("boletaCerrada: sin filas no", RD.boletaCerrada({}), false);
	ok("textoSeccion cerrada: lo guardado, no la propuesta", RD.textoSeccion(filasT.LEN, "fortalezas", "propuesta nueva", true).texto, "Texto entregado LEN");
	ok("textoSeccion cerrada: cuadro vacío queda vacío", RD.textoSeccion(filasT.LEN, "sugerencias", "propuesta nueva", true).texto, "");
	ok("textoSeccion abierta: la propuesta de hoy", RD.textoSeccion(filasT.LEN, "sugerencias", "propuesta nueva", false).texto, "propuesta nueva");
	ok("trabajoDiario cerrada: la foto aunque el maestro escriba después",
		RD.trabajoDiario({ observaciones: "escrito después" }, "propuesta", filasT.GEN, true).texto, "Trabajo diario entregado al cierre");
	ok("trabajoDiario abierta: lo del maestro", RD.trabajoDiario({ observaciones: "escrito" }, "propuesta", filasT.GEN, false).texto, "escrito");
	ok("trabajoDiario cerrada sin foto (boletas cerradas antes): regla de siempre",
		RD.trabajoDiario({ observaciones: null }, "propuesta", {}, true).texto, "propuesta");

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
