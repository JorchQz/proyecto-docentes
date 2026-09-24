/*
	Boleta cerrada con un campo por juicio docente (sin evidencias al cerrar) y una
	captura en ese campo DESPUÉS del cierre. Lo cerrado nunca lee en vivo:
	  - Reportes (js/reportes.js, ejecutado de verdad) no muestra el porcentaje de hoy en
	    ese campo: dice que no tenía evidencias al cierre, con la foto completa del cierre
	    y también en boletas cerradas antes de esa foto;
	  - ReporteDatos.alumnoTrimestre (boleta imprimible y reporte detallado) y
	    congelarCerradas (junta y exportación) dejan ese campo sin porcentaje ni desglose;
	  - un campo cerrado CON porcentaje sigue mostrando el del cierre.

	node pruebas/boleta-cerrada-juicio.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

// ── DOM mínimo ───────────────────────────────────────────────────────────────
let elementos = {};
const errores = [];
function crearElemento(id) {
	const el = {
		id: id, innerHTML: "", textContent: "", className: "", value: "",
		disabled: false, dataset: {}, options: [], selectedIndex: 0, hijos: [],
		classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
		_listeners: {},
		addEventListener(evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		appendChild(hijo) { this.hijos.push(hijo); this.options.push(hijo); },
		querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
	};
	return el;
}
global.document = {
	_domReady: null,
	getElementById(id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	createElement() { return crearElemento("opt"); },
	querySelector() { return null; }, querySelectorAll() { return []; },
	addEventListener(evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = { location: { href: "" }, confirm() { return true; }, alert() {}, open() {} };
global.Event = function () {};

require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/catalogo-habilidades.js");
require("../js/motor-calificacion.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const RD = window.ReporteDatos;

// ── Datos: LEN con evidencias al cerrar (80 %); SAB, ETI y DHL por juicio docente.
// Después del cierre se capturó un trabajo LOGRADO de SAB: hoy SAB da 100 %. ─────
function filasBoleta(conFoto) {
	const filas = ["LEN", "SAB", "ETI", "DHL"].map((c) => ({
		id: "b-" + c, alumno_id: "al-3", ciclo: "2026-2027", trimestre: 1, campo: c,
		calificacion: c === "LEN" ? 9 : 7, porcentaje: c === "LEN" ? 80 : null, nivel: c === "LEN" ? "logrado" : null,
		calificacion_confirmada: true, cerrada: true,
		fortalezas: "Entregado " + c, areas_oportunidad: null, sugerencias: null,
		texto_autogenerado: { visible: "reglas", editados: [] },
	}));
	const cierre = { trabajo_diario: "Trabajo diario al cierre", trabajo_diario_del_maestro: false };
	if (conFoto) {
		cierre.alumno = { grado: 3, fase: 4, escala: "5 a 10; 5 no acredita", banda_ppm: null };
		cierre.pesos = { tareas: 28, trabajos: 28, participacion: 6, conducta: 5, examen: 33 };
		cierre.campos = {
			LEN: { porcentaje: 80, nivel: "logrado", sin_evidencias: false, rubros: { trabajos: { obtenido: 0.8, maximo: 1, fraccion: 0.8, peso: 28 } } },
			SAB: { porcentaje: null, nivel: null, sin_evidencias: true, rubros: {} },
			ETI: { porcentaje: null, nivel: null, sin_evidencias: true, rubros: {} },
			DHL: { porcentaje: null, nivel: null, sin_evidencias: true, rubros: {} },
		};
	}
	return filas.concat([{
		id: "b-GEN", alumno_id: "al-3", ciclo: "2026-2027", trimestre: 1, campo: "GEN", cerrada: false, calificacion_confirmada: false,
		fortalezas: "General", areas_oportunidad: null, sugerencias: null,
		texto_autogenerado: { visible: "reglas", editados: [], cierre: cierre },
	}]);
}
const DATOS = {
	grupos: [{ id: "g1", nombre: "G", escuela: "Escuela", ciclo_escolar: "2026-2027" }],
	alumnos: [{ id: "al-3", nombre_completo: "ALUMNA DE TERCERO", num_lista: 1, grado: 3 }],
	maestro_ajustes: [{ peso_tareas: 28, peso_trabajos: 28, peso_participacion: 6, peso_conducta: 5, peso_examen: 33 }],
	proyectos: [{ id: "p1" }],
	sesiones: [
		{ id: "s1", fecha: "2026-09-22", campo_formativo: "Lenguajes", numero_sesion: 1, proyecto_id: "p1" },
		{ id: "s2", fecha: "2026-09-24", campo_formativo: "Saberes y Pensamiento Científico", numero_sesion: 2, proyecto_id: "p1" },
	],
	productos_sesion: [
		{ id: "pr1", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["3"], activo: true },
		{ id: "pr2", sesion_id: "s2", tipo: "trabajo", campo: "SAB", grados: ["3"], activo: true },
	],
	calificaciones: [
		{ alumno_id: "al-3", proyecto_id: "p1", producto_sesion_id: "pr1", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-22" },
		// La captura DESPUÉS del cierre, en el campo que se cerró por juicio
		{ alumno_id: "al-3", proyecto_id: "p1", producto_sesion_id: "pr2", estado_entrega: "entregado", nivel: "logrado", fecha: "2026-09-24" },
	],
	registro_diario: [], asistencias: [], examenes: [], respuestas_examen: [], banco_preguntas: [],
	evaluacion_diagnostica: [], bandas_ppm: [], v_avance_pda: [],
	boleta_trimestral: [],
};

const guardado = [];
function consulta(tabla) {
	const q = {
		_single: false,
		select() { return this; }, eq() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; },
		not() { return this; }, neq() { return this; }, order() { return this; }, limit() { return this; }, range() { return this; },
		single() { this._single = true; return this; }, maybeSingle() { this._single = true; return this; },
		insert() { return this; }, update() { return this; },
		upsert(filas) { guardado.push(tabla); return this; },
		then(resolver) {
			const filas = DATOS[tabla] || [];
			return Promise.resolve(resolver({ data: this._single ? (filas[0] || null) : filas, error: null }));
		},
	};
	return q;
}
const SB = {
	auth: { getSession() { return Promise.resolve({ data: { session: { user: { id: "m1" } } }, error: null }); } },
	from(t) { return consulta(t); },
	rpc(nombre, args) {
		const conv = (p) => (p === null || p === undefined ? null : p >= 90 ? 10 : p >= 80 ? 9 : p >= 70 ? 8 : p >= 60 ? 7 : p >= 50 ? 6 : 5);
		if (nombre === "calcular_calificaciones_boleta") return Promise.resolve({ data: args.p_porcentajes.map(conv), error: null });
		return Promise.resolve({ data: conv(args.p_porcentaje), error: null });
	},
};
global.window.sb = SB;

const codigo = fs.readFileSync((process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js")), "utf8");

// Celdas de la fila "Porcentaje del campo" en el HTML de la boleta
function filaPorcentaje(html) {
	const i = html.indexOf("Porcentaje del campo");
	if (i === -1) return null;
	const fin = html.indexOf("</tr>", i);
	return html.slice(i, fin).split("<td").slice(1).map((td) => td.replace(/^[^>]*>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function boletaReportes(conFoto) {
	DATOS.boleta_trimestral = filasBoleta(conFoto);
	elementos = {};
	document._domReady = null;
	guardado.length = 0;
	const consola = console.error;
	console.error = function () { errores.push(Array.prototype.slice.call(arguments).join(" ")); };
	try {
		new Function(codigo)();
		await document._domReady();
		document.getElementById("selectAlumnoBoleta").value = "al-3";
		document.getElementById("selectTrimBoleta").value = "1";
		await (elementos.generarBoletaBtn._listeners.click || [])[0]();
	} finally { console.error = consola; }
	return elementos.boletaContainer ? elementos.boletaContainer.innerHTML : "";
}

(async function () {
	// El motor de hoy sí ve la captura: sin la regla, SAB saldría 100 %
	const vivo = await window.MotorCalificacion.cargarYCalcular(SB, { maestroId: "m1", grupoId: "g1", alumnoId: "al-3", grado: 3, trimestre: 1 });
	ok("hoy, con la captura posterior, SAB da 100 % (lo que no debe verse)", vivo.porCampo.SAB.porcentaje, 100);

	for (const conFoto of [true, false]) {
		const et = conFoto ? "con foto del cierre" : "cerrada antes de la foto";
		const html = await boletaReportes(conFoto);
		const celdas = filaPorcentaje(html) || [];
		ok("Reportes (" + et + "): LEN, el porcentaje del cierre", celdas[0], "80.0 %");
		ok("Reportes (" + et + "): SAB sin el porcentaje de hoy", /100\.0 %/.test(celdas[1] || ""), false);
		ok("Reportes (" + et + "): SAB dice que no tenía evidencias al cierre", /sin evidencias al cierre/.test(celdas[1] || ""), true);
		ok("Reportes (" + et + "): ETI igual", /sin evidencias al cierre/.test(celdas[2] || ""), true);
		ok("Reportes (" + et + "): sigue marcado juicio docente", /juicio docente, sin evidencias/.test(html), true);
		ok("Reportes (" + et + "): nada se guarda", guardado.length, 0);
		// Desglose de SAB: ni el trabajo capturado después (100.0 % · 1 / 1)
		const iTrab = html.indexOf("Trabajos");
		const filaTrab = html.slice(iTrab, html.indexOf("</tr>", iTrab)).split("<td").slice(1).map((td) => td.replace(/<[^>]+>/g, " ").replace(/^[^>]*>/, "").replace(/\s+/g, " ").trim());
		ok("Reportes (" + et + "): el desglose de SAB no trae la captura de hoy", /1 \/ 1/.test(filaTrab[1] || ""), false);

		// Boleta imprimible y reporte detallado
		const ctx = { maestroId: "m1", grupo: { id: "g1" }, ciclo: "2026-2027", alumnos: DATOS.alumnos, bandas: {}, plantillas: [] };
		const datos = await RD.alumnoTrimestre(SB, ctx, DATOS.alumnos[0], 1);
		ok("alumnoTrimestre (" + et + "): SAB sin porcentaje", datos.motor.porCampo.SAB.porcentaje, null);
		ok("alumnoTrimestre (" + et + "): SAB sin desglose de hoy", Object.keys(datos.motor.porCampo.SAB.rubros || {}).filter((r) => datos.motor.porCampo.SAB.rubros[r].maximo > 0), []);
		ok("alumnoTrimestre (" + et + "): LEN, el del cierre", datos.motor.porCampo.LEN.porcentaje, 80);
		ok("alumnoTrimestre (" + et + "): SAB por juicio", datos.juicio.SAB, true);

		// Junta y exportación
		const boletas = { "al-3": { 1: {}, 2: {}, 3: {} } };
		DATOS.boleta_trimestral.forEach((f) => { boletas["al-3"][1][f.campo] = f; });
		const grupo = await window.MotorCalificacion.cargarYCalcularGrupo(SB, { maestroId: "m1", grupoId: "g1", trimestre: 1, alumnos: DATOS.alumnos });
		const cong = RD.congelarCerradas({ alumnos: DATOS.alumnos }, { motor: grupo, diagnosticas: {}, avancePda: [], boletas: boletas }, 1);
		const pc = cong.motor.porAlumno["al-3"].porCampo;
		ok("congelarCerradas (" + et + "): SAB sin porcentaje", pc.SAB.porcentaje, null);
		ok("congelarCerradas (" + et + "): SAB sin trabajos de hoy", !!(pc.SAB.rubros.trabajos && pc.SAB.rubros.trabajos.maximo > 0), false);
		ok("congelarCerradas (" + et + "): LEN, el del cierre", pc.LEN.porcentaje, 80);
	}
	ok("sin errores en consola", errores, []);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
