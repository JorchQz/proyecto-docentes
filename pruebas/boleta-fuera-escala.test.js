/*
	Calificación confirmada que queda FUERA de la escala del grado de hoy (revisor R7, art. 4 XI:
	nada numérico se cierra sin confirmación explícita).

	Cómo pasaba: un alumno de 2° a 6° con un 5 confirmado en una boleta abierta; en Mi grupo se
	le cambia el grado a 1° (mínimo 6). En Reportes → Boleta el selector no tenía la opción 5 y el
	navegador mostraba 6; la barra decía "Calificaciones confirmadas por el docente. Puedes cerrar
	la boleta" y "Cerrar boleta" mandaba 6 a cerrar_boleta: un número que la maestra no eligió.

	Ejecuta js/reportes.js de verdad (pestaña Boleta) con un Supabase falso:
	  A) 1° con LEN 5 confirmado (abierta): LEN pide "Elige" (ningún número puesto por la
	     pantalla) con el aviso "El 5 confirmado no es válido en 1° (escala 6 a 10)...", la barra no
	     dice "confirmadas", "Cerrar boleta" queda deshabilitado, nada se escribe en la fila de LEN
	     (la base la rechaza) y la evaluación final dice "revisar" en ese trimestre.
	  B) Aunque se pulse "Cerrar boleta" con 6 en pantalla, no se llama a cerrar_boleta y se avisa.
	  C) Control: el mismo alumno en 2° (el 5 sí es válido): se puede cerrar y cerrar_boleta recibe
	     lo confirmado en la BASE.
	  D) Reglas compartidas (js/reporte-datos.js): calificacionOficial, finalCiclo, validarCierre.
	  E) Vista Recrea y Concentrado (js/reportes-grupo.js): "revisar", nunca como número oficial.

	node pruebas/boleta-fuera-escala.test.js
	(REPORTES_JS / REPORTE_DATOS_JS / REPORTES_GRUPO_JS apuntan a otra versión para comprobar
	que con el código anterior esta prueba falla)
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
function contiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) !== -1, true); }
function noContiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) === -1, true); }

// ── DOM mínimo (como pruebas/boleta-juicio.test.js) ─────────────────────────
let elementos = {};
const errores = [];
const alertas = [];
function crearElemento(id) {
	return {
		id: id, innerHTML: "", textContent: "", className: "", value: "",
		disabled: false, dataset: {}, options: [], hijos: [],
		classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
		_listeners: {},
		addEventListener: function (evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		appendChild: function (hijo) { this.hijos.push(hijo); this.options.push(hijo); },
		prepend: function () {}, remove: function () {},
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		closest: function () { return null; },
	};
}
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	createElement: function () { return crearElemento("opt"); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = {
	location: { href: "" }, confirm: function () { return true; },
	alert: function (m) { alertas.push(String(m)); }, open: function () {},
};
global.Event = function () {};

require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/catalogo-habilidades.js");
require("../js/motor-calificacion.js");
require("../js/textos-boleta.js");
require("../js/reglas-entidad.js");
window.ReglasEntidad = require("../js/reglas-entidad.js");
require(process.env.REPORTE_DATOS_JS || "../js/reporte-datos.js");
require(process.env.REPORTES_GRUPO_JS || "../js/reportes-grupo.js");
const RD = window.ReporteDatos;
const RG = window.ReportesGrupo;

// ── Supabase falso ──────────────────────────────────────────────────────────
let DATOS = {};
let guardado = {};
let llamadasRpc = [];
function consulta(tabla) {
	return {
		_single: false,
		select: function () { return this; },
		eq: function () { return this; }, in: function () { return this; },
		gte: function () { return this; }, lte: function () { return this; },
		not: function () { return this; }, neq: function () { return this; }, order: function () { return this; },
		limit: function () { return this; }, range: function () { return this; },
		single: function () { this._single = true; return this; },
		maybeSingle: function () { this._single = true; return this; },
		insert: function () { this._escritura = true; return this; }, update: function () { this._escritura = true; return this; },
		upsert: function (filas) {
			guardado[tabla] = (guardado[tabla] || []).concat(Array.isArray(filas) ? filas : [filas]);
			this._escritura = true;
			return this;
		},
		then: function (resolver) {
			// Una escritura con .select().single() devuelve la fila escrita (su id)
			if (this._escritura) return Promise.resolve(resolver({ data: this._single ? { id: "nuevo" } : null, error: null }));
			// Copias: la página anota en memoria el grado de hoy (_gradoHoy) en lo que lee
			const filas = (DATOS[tabla] || []).map(function (f) { return Object.assign({}, f); });
			return Promise.resolve(resolver({ data: this._single ? (filas[0] || null) : filas, error: null }));
		},
	};
}
global.window.sb = {
	auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: "m1" } } }, error: null }); } },
	from: function (t) { return consulta(t); },
	functions: { invoke: function () { return Promise.resolve({ data: { configurada: false }, error: null }); } },
	rpc: function (nombre, args) {
		llamadasRpc.push({ nombre: nombre, args: args });
		return Promise.resolve({ data: null, error: null });
	},
};

const CICLO = "2026-2027";
function filasBoleta(alumnoId, cal) {
	return ["LEN", "SAB", "ETI", "DHL"].map(function (c) {
		return {
			id: "b-" + c, maestro_id: "m1", alumno_id: alumnoId, ciclo: CICLO, trimestre: 1, campo: c,
			calificacion: cal[c], porcentaje: null, calificacion_confirmada: true, cerrada: false, texto_autogenerado: {},
		};
	});
}
function base(alumno, boleta) {
	return {
		grupos: [{ id: "g1", nombre: "Multigrado", escuela: "Escuela de prueba", ciclo_escolar: CICLO }],
		alumnos: [alumno],
		maestro_ajustes: [{ peso_tareas: 28, peso_trabajos: 28, peso_participacion: 6, peso_conducta: 0, peso_examen: 33 }],
		// El grupo tiene proyecto (hay qué calificar) pero este alumno no tiene evidencias
		proyectos: [{ id: "p1" }],
		sesiones: [{ id: "s1", fecha: "2026-09-21", campo_formativo: "Lenguajes", numero_sesion: 1, proyecto_id: "p1" }],
		productos_sesion: [{ id: "pr1", sesion_id: "s1", tipo: "tarea", campo: "LEN", grados: ["6"], activo: true }],
		calificaciones: [], registro_diario: [], asistencias: [],
		examenes: [], respuestas_examen: [], banco_preguntas: [],
		evaluacion_diagnostica: [],
		bandas_ppm: [],
		plantillas_sugerencia: [],
		boleta_trimestral: boleta,
		v_avance_pda: [],
	};
}

const codigo = fs.readFileSync(process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js"), "utf8");

async function boletaCon(datos, alumnoId) {
	DATOS = datos; guardado = {}; elementos = {}; llamadasRpc = [];
	errores.length = 0; alertas.length = 0;
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

// Pulsa "Cerrar boleta" con estos valores en los selectores (lo que el navegador muestra)
async function pulsarCerrar(enPantalla) {
	const cont = elementos.boletaContainer;
	cont.querySelectorAll = function (sel) {
		if (sel.indexOf("select[data-cal-campo]") === 0) {
			return Object.keys(enPantalla).map(function (c) { return { dataset: { calCampo: c }, value: String(enPantalla[c]) }; });
		}
		return [];
	};
	const btn = elementos.boletaCerrarBtn;
	const fn = btn && (btn._listeners.click || [])[0];
	if (!fn) { fallos++; console.log("FALLA no hay listener de «Cerrar boleta»"); return; }
	const consolaOriginal = console.error;
	console.error = function () { errores.push(Array.prototype.slice.call(arguments).join(" ")); };
	try { await fn(); } catch (e) { fallos++; console.log("FALLA cerrar lanzó → " + (e && e.stack ? e.stack : e)); }
	console.error = consolaOriginal;
}

function selectDe(html, campo) {
	const m = html.match(new RegExp("<select data-cal-campo='" + campo + "'[^>]*>([\\s\\S]*?)</select>"));
	return m ? m[0] : "";
}
function elegido(html, campo) {
	const s = selectDe(html, campo);
	const m = s.match(/<option value='(\d*)'[^>]*selected/);
	return m ? m[1] : null;
}

(async function () {
	// ── A) 1° con LEN 5 confirmado (cambió de 2° a 1° después de confirmar) ──
	const elsa1 = { id: "al-e", nombre_completo: "L ELSA", num_lista: 5, grado: 1 };
	const cal = { LEN: 5, SAB: 6, ETI: 6, DHL: 6 };
	let html = await boletaCon(base(elsa1, filasBoleta("al-e", cal)), "al-e");
	ok("A: sin errores en consola", errores.length ? errores[0] : "sin errores", "sin errores");
	ok("A: LEN pide «Elige» (ningún número puesto por la pantalla)", elegido(html, "LEN"), "");
	ok("A: LEN no ofrece el 5 (fuera de la escala de 1°)", /<option value='5'/.test(selectDe(html, "LEN")), false);
	contiene("A: aviso claro en el campo", html, "El 5 confirmado no es válido en 1° (escala 6 a 10): elige y confirma de nuevo.");
	ok("A: los demás campos siguen con su confirmada (6)", [elegido(html, "SAB"), elegido(html, "ETI"), elegido(html, "DHL")], ["6", "6", "6"]);
	noContiene("A: la barra NO dice «confirmadas»", html, "Calificaciones confirmadas por el docente");
	contiene("A: la barra dice qué pasó", html, "Lenguajes: el 5 confirmado no es válido en 1° (escala 6 a 10)");
	ok("A: «Cerrar boleta» deshabilitado", /id='boletaCerrarBtn' type='button' disabled/.test(html), true);
	ok("A: «Confirmar calificaciones» habilitado", /id='boletaConfirmarBtn' type='button' disabled/.test(html), false);
	contiene("A: el botón dice «Confirmar calificaciones»", html, "Confirmar calificaciones</button>");
	const escritoLen = (guardado.boleta_trimestral || []).filter(function (f) { return f.campo === "LEN"; });
	ok("A: nada se escribe en la fila de LEN (la base la rechaza)", escritoLen.length, 0);
	ok("A: los textos de LEN quedan en solo lectura", /data-boleta-campo='LEN' data-boleta-tipo='fortalezas'[^>]* readonly/.test(html), true);
	contiene("A: evaluación final: T1 LEN «revisar»", html, "data-final-trim='1' data-final-de='LEN' data-fuera-escala='1'");
	ok("A: evaluación final: el 5 no aparece como calificación de T1", /data-final-trim='1' data-final-de='LEN'>5</.test(html), false);

	// ── B) "Cerrar boleta" pulsado aunque sea (con 6 en pantalla, como mostraba el navegador) ──
	await pulsarCerrar({ LEN: 6, SAB: 6, ETI: 6, DHL: 6 });
	ok("B: no se llama a cerrar_boleta", llamadasRpc.filter(function (l) { return l.nombre === "cerrar_boleta"; }).length, 0);
	ok("B: avisa que no se cerró y por qué", alertas.some(function (a) { return /No se cerró la boleta/.test(a) && /el 5 confirmado no es válido en 1°/.test(a); }), true);

	// ── C) Control: el mismo alumno en 2° (el 5 sí es de su escala) ──
	const elsa2 = Object.assign({}, elsa1, { grado: 2 });
	html = await boletaCon(base(elsa2, filasBoleta("al-e", cal)), "al-e");
	ok("C: 2° con el 5: se ve el 5 confirmado", elegido(html, "LEN"), "5");
	contiene("C: confirmadas", html, "Calificaciones confirmadas por el docente");
	ok("C: «Cerrar boleta» habilitado", /id='boletaCerrarBtn' type='button' disabled/.test(html), false);
	await pulsarCerrar({ LEN: 5, SAB: 6, ETI: 6, DHL: 6 });
	const cierre = llamadasRpc.filter(function (l) { return l.nombre === "cerrar_boleta"; });
	ok("C: cerrar_boleta recibe lo confirmado en la base", cierre.length ? cierre[0].args.p_calificaciones : null,
		[{ campo: "LEN", calificacion: 5 }, { campo: "SAB", calificacion: 6 }, { campo: "ETI", calificacion: 6 }, { campo: "DHL", calificacion: 6 }]);
	// Pantalla distinta de la base (se movió un selector sin «Guardar ajustes»): no se cierra
	await boletaCon(base(elsa2, filasBoleta("al-e", cal)), "al-e");
	await pulsarCerrar({ LEN: 7, SAB: 6, ETI: 6, DHL: 6 });
	ok("C: pantalla distinta de lo confirmado: no se cierra", llamadasRpc.filter(function (l) { return l.nombre === "cerrar_boleta"; }).length, 0);
	ok("C: y lo dice", alertas.some(function (a) { return /en pantalla dice 7 y la calificación confirmada es 5/.test(a); }), true);

	// ── D) Reglas compartidas ──
	const fila5 = { campo: "LEN", calificacion: 5, calificacion_confirmada: true, cerrada: false };
	ok("D: calificacionOficial en 1°: pendiente", RD.calificacionOficial(fila5, 1).pendiente, true);
	ok("D: calificacionOficial en 2°: el 5", RD.calificacionOficial(fila5, 2).valor, 5);
	ok("D: con el grado anotado al leer", RD.calificacionOficial(RD.anotarGradoHoy(Object.assign({}, fila5), 1)).pendiente, true);
	ok("D: cerrada: lo entregado no se revisa", RD.calificacionOficial(Object.assign({}, fila5, { cerrada: true }), 1).valor, 5);
	ok("D: fueraDeEscala", RD.fueraDeEscala(fila5, 1), { valor: 5, grado: 1, piso: 6, escala: "6 a 10" });
	const ciclo = { 1: {}, 2: {}, 3: {} };
	[1, 2, 3].forEach(function (t) {
		["LEN", "SAB", "ETI", "DHL"].forEach(function (c) {
			ciclo[t][c] = RD.anotarGradoHoy({ campo: c, calificacion: t === 2 && c === "LEN" ? 5 : 8, calificacion_confirmada: true, cerrada: false }, 1);
		});
	});
	const fin = RD.finalCiclo(ciclo, 1);
	ok("D: finalCiclo: la final de LEN queda pendiente", [fin.porCampo.LEN, fin.faltan, fin.acreditacion], [null, 1, "pendiente"]);
	const base5 = filasBoleta("al-e", cal);
	ok("D: validarCierre: 6 en pantalla y 5 en la base (1°) → no",
		RD.validarCierre([{ campo: "LEN", calificacion: 6 }, { campo: "SAB", calificacion: 6 }, { campo: "ETI", calificacion: 6 }, { campo: "DHL", calificacion: 6 }], base5, 1).ok, false);
	ok("D: validarCierre: falta un campo en la base → no",
		RD.validarCierre([{ campo: "LEN", calificacion: 5 }], base5.slice(0, 1), 2).ok, false);
	ok("D: validarCierre: todo coincide (2°) → las de la base",
		RD.validarCierre(base5.map(function (f) { return { campo: f.campo, calificacion: f.calificacion }; }), base5, 2).calificaciones.map(function (x) { return x.calificacion; }), [5, 6, 6, 6]);

	// ── E) Vista Recrea y Concentrado ──
	const alumnosG = [{ id: "al-e", nombre_completo: "L ELSA", num_lista: 5, grado: 1 }];
	const boletasG = { "al-e": { 1: {}, 2: {}, 3: {} } };
	filasBoleta("al-e", cal).forEach(function (f) { boletasG["al-e"][1][f.campo] = RD.anotarGradoHoy(f, 1); });
	const lista = RG.filas(alumnosG, { motor: { porAlumno: {} }, boletas: boletasG }, 1);
	ok("E: LEN no cuenta como confirmada (3 de 4)", [lista[0].confirmadas, lista[0].completa, lista[0].campos.LEN.oficial], [3, false, null]);
	const recrea = RG.htmlVistaRecrea(lista, 1);
	contiene("E: Vista Recrea: «revisar»", recrea, "data-fuera-escala='1'>revisar");
	contiene("E: Vista Recrea: explica por qué", recrea, "el 5 no es válido en 1°");
	ok("E: CSV: LEN pendiente, no 5", RG.csvVistaRecrea(lista).split("\r\n")[1].split(",").slice(3, 7), ["pendiente", "6", "6", "6"]);
	const conc = RG.htmlConcentrado(lista, 1);
	contiene("E: Concentrado: en pendientes con «revisar LEN»", conc, "revisar LEN: fuera de la escala de 1°");
	contiene("E: Concentrado: aviso de qué hacer", conc, "Elige y confirma de nuevo en la pestaña Boleta");

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
