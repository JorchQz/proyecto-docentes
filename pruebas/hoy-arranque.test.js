/*
	Arranque completo de la pantalla "Hoy" sin navegador (B.1).

	Ejecuta js/hoy.js de verdad contra un DOM mínimo y un Supabase falso con datos
	equivalentes a los del grupo multigrado de prueba. Sirve para cazar errores de
	ejecución (como el del 2026-09-23: el arranque corría antes de inicializar el
	estado y se caían las secciones 3 y 4), que ninguna prueba de funciones sueltas
	puede ver.

	node pruebas/hoy-arranque.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}

// ── DOM mínimo ───────────────────────────────────────────────────────────────
function crearElemento(id) {
	return {
		id: id,
		innerHTML: "",
		textContent: "",
		className: "",
		value: "",
		dataset: {},
		classList: {
			_c: new Set(),
			add: function (c) { this._c.add(c); },
			remove: function (c) { this._c.delete(c); },
			contains: function (c) { return this._c.has(c); },
			toggle: function (c, f) { if (f === undefined) { this._c.has(c) ? this._c.delete(c) : this._c.add(c); } else if (f) { this._c.add(c); } else { this._c.delete(c); } },
		},
		_listeners: {},
		addEventListener: function (evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		closest: function () { return null; },
	};
}

const elementos = {};
const errores = [];
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = {
	location: { href: "" },
	prompt: function () { return null; },
	alert: function () {},
	addEventListener: function () {},
};
global.setTimeout = setTimeout;
global.Event = function () {};

// El módulo real de campos formativos (el motor y la pantalla lo usan)
require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/alcance-hoy.js");

// ── Supabase falso ───────────────────────────────────────────────────────────
const HOY = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
	.toISOString().slice(0, 10);

const ALUMNOS = [
	{ id: "al-2", nombre_completo: "ALUMNO DE SEGUNDO", num_lista: 1, grado: 2 },
	{ id: "al-3", nombre_completo: "ALUMNO DE TERCERO", num_lista: 2, grado: 3 },
];
const DATOS = {
	grupos: [{ id: "g1", nombre: "Multigrado", grados: ["2", "3"], es_multigrado: true, trimestre_actual: 1 }],
	alumnos: ALUMNOS,
	asistencias: [{ alumno_id: "al-2", asistencia_estado: "presente" }],
	registro_diario: [{ alumno_id: "al-3", participacion: 2, conducta: 1 }],
	proyectos: [{ id: "p1", titulo: "Proyecto de prueba", estado: "activo" }],
	sesiones: [
		{ id: "s1", numero_sesion: 1, fecha: HOY, campo_formativo: "Lenguajes", momento: "Desarrollo", proyecto_id: "p1" },
		{ id: "s2", numero_sesion: 2, fecha: HOY, campo_formativo: "Saberes y Pensamiento Científico", momento: "Desarrollo", proyecto_id: "p1" },
		// Pendiente y sin fecha: debe ofrecerse con "Trabajar hoy"
		{ id: "s3", numero_sesion: 3, fecha: null, campo_formativo: "Ética, Naturaleza y Sociedades", momento: "Desarrollo", proyecto_id: "p1", estado_sesion: "pendiente" },
		// Ya completada y sin fecha: no se ofrece
		{ id: "s0", numero_sesion: 0, fecha: null, campo_formativo: "Lenguajes", momento: "Cierre", proyecto_id: "p1", estado_sesion: "completada" },
	],
	productos_sesion: [
		{ id: "pr1", sesion_id: "s1", tipo: "trabajo", nombre: "Cartel del cuento", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: null, orden: 1 },
		{ id: "pr2", sesion_id: "s1", tipo: "tarea", nombre: "Leer en casa", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: HOY, orden: 2 },
		{ id: "pr3", sesion_id: "s2", tipo: "trabajo", nombre: "Experimento del agua", grados: ["3"], modalidad: "diferenciada", campo: "SAB", fecha_entrega: null, orden: 1 },
	],
	calificaciones: [
		{ id: "c1", alumno_id: "al-2", producto_sesion_id: "pr1", estado_entrega: "entregado", nivel: "logrado", puntaje: null, retroalimentacion: null },
	],
};

// HOY_FALLA=tabla: esa lectura responde con error (pruebas/lecturas-con-error.test.js)
const FALLA = process.env.HOY_FALLA || "";
const escrituras = [];
function consulta(tabla) {
	const q = {
		_single: false,
		select: function () { return this; },
		eq: function () { return this; },
		in: function () { return this; },
		or: function () { return this; },
		gte: function () { return this; },
		lte: function () { return this; },
		not: function () { return this; },
		order: function () { return this; },
		limit: function () { return this; },
		// Como PostgREST: devuelve solo la página pedida
		range: function (desde, hasta) { this._rango = [desde, hasta]; return this; },
		single: function () { this._single = true; return this; },
		maybeSingle: function () { this._single = true; return this; },
		insert: function (fila) { escrituras.push(tabla); this._insertado = fila; return this; },
		update: function () { escrituras.push(tabla); this._escribe = true; return this; },
		upsert: function () { escrituras.push(tabla); this._escribe = true; return this; },
		then: function (resolver) {
			if (FALLA === tabla && !this._insertado && !this._escribe) {
				return Promise.resolve(resolver({ data: null, error: { message: "falla simulada en " + tabla } }));
			}
			const filas = DATOS[tabla] || [];
			const data = this._insertado
				? Object.assign({ id: "nuevo" }, this._insertado)
				: (this._single ? (filas[0] || null) : this._rango ? filas.slice(this._rango[0], this._rango[1] + 1) : filas);
			return Promise.resolve(resolver({ data: data, error: null }));
		},
	};
	return q;
}
global.window.sb = {
	auth: { getUser: function () { return Promise.resolve({ data: { user: { id: "m1" } }, error: null }); } },
	from: function (tabla) { return consulta(tabla); },
};

// ── Ejecutar la pantalla ─────────────────────────────────────────────────────
// Por defecto js/hoy.js; se puede pasar otra ruta para comprobar que la prueba
// detecta una versión con fallas (p. ej. la anterior a una corrección).
const archivo = process.argv[2] || path.join(__dirname, "..", "js", "hoy.js");
const codigo = fs.readFileSync(archivo, "utf8");
const originalError = console.error;
console.error = function () { errores.push(Array.prototype.slice.call(arguments).join(" ")); };

new Function(codigo)();

(async function () {
	try {
		await document._domReady();
	} catch (e) {
		fallos++;
		console.log("FALLA el arranque lanzó una excepción → " + e);
	}
	console.error = originalError;

	if (FALLA) {
		// Una lectura falló: se dice y no se dibuja ni se escribe nada
		const msg = elementos.hoyMensaje ? elementos.hoyMensaje.textContent : "";
		ok("falla en " + FALLA + ": avisa que no se pudo cargar", /No se pud/.test(msg), true);
		ok("falla en " + FALLA + ": no dibuja el cierre del día", !(elementos.cierreLista && elementos.cierreLista.innerHTML), true);
		ok("falla en " + FALLA + ": no dibuja las sesiones", !(elementos.sesionesLista && elementos.sesionesLista.innerHTML), true);
		ok("falla en " + FALLA + ": no escribe nada", escrituras.length, 0);
		console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
		process.exit(fallos ? 1 : 0);
	}

	const asistencia = elementos.asistenciaLista ? elementos.asistenciaLista.innerHTML : "";
	const tareas = elementos.tareasLista ? elementos.tareasLista.innerHTML : "";
	const sesiones = elementos.sesionesLista ? elementos.sesionesLista.innerHTML : "";
	const cierre = elementos.cierreLista ? elementos.cierreLista.innerHTML : "";

	ok("el arranque no dejó errores en consola", errores.length === 0 ? "sin errores" : errores[0], "sin errores");

	ok("1. asistencia dibuja a los dos alumnos",
		asistencia.indexOf("ALUMNO DE SEGUNDO") !== -1 && asistencia.indexOf("ALUMNO DE TERCERO") !== -1, true);
	ok("1. la asistencia guardada queda marcada", asistencia.indexOf("bg-emerald-500 text-white") !== -1, true);

	ok("2. la tarea del día aparece", tareas.indexOf("Leer en casa") !== -1, true);
	ok("2. la tarea ofrece los cuatro estados de entrega",
		["Entregó", "Incompleta", "No entregó", "Justificada"].every(function (t) { return tareas.indexOf(t) !== -1; }), true);

	// Esto es lo que estaba roto: la sección 3 quedaba vacía
	ok("3. sesiones NO está vacía", sesiones.length > 0, true);
	ok("3. aparecen los productos de las dos sesiones",
		sesiones.indexOf("Cartel del cuento") !== -1 && sesiones.indexOf("Experimento del agua") !== -1, true);
	ok("3. el producto multigrado lista a los dos alumnos",
		sesiones.indexOf("ALUMNO DE SEGUNDO") !== -1 && sesiones.indexOf("ALUMNO DE TERCERO") !== -1, true);
	const trasExperimento = sesiones.split("Experimento del agua")[1] || "";
	ok("3. el producto de un solo grado no invita al de 2°",
		trasExperimento.indexOf("ALUMNO DE SEGUNDO"), -1);
	ok("3. hay panel de detalle por alumno y producto",
		sesiones.indexOf("id='detalle-pr1-al-2'") !== -1 && sesiones.indexOf("id='detalle-pr1-al-3'") !== -1, true);
	ok("3. la tarea no se repite dentro de la sesión", sesiones.indexOf("Leer en casa"), -1);

	// Y esto es lo que se caía en cadena: la sección 4
	// Planeación → Hoy: las sesiones no traen fecha; el maestro elige cuál trabaja hoy
	ok("3. ofrece la siguiente sesión pendiente con \"Trabajar hoy\"", sesiones.indexOf("data-trabajar-hoy='s3'") !== -1, true);
	ok("3. no ofrece sesiones ya completadas", sesiones.indexOf("data-trabajar-hoy='s0'") === -1, true);
	ok("3. una sesión con calificaciones no se puede quitar de hoy", sesiones.indexOf("data-quitar-hoy='s1'") === -1, true);
	ok("3. una sesión sin calificaciones sí se puede quitar", sesiones.indexOf("data-quitar-hoy='s2'") !== -1, true);

	ok("4. cierre NO está vacía", cierre.length > 0, true);
	ok("4. cierre dibuja a los dos alumnos",
		cierre.indexOf("ALUMNO DE SEGUNDO") !== -1 && cierre.indexOf("ALUMNO DE TERCERO") !== -1, true);
	ok("4. cierre ofrece participación y conducta",
		cierre.indexOf("Participación") !== -1 && cierre.indexOf("Conducta") !== -1, true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
