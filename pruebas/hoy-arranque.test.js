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
require("../js/productos-hoy.js");
// Orden de la tarjeta de Asistencia (hoy.html la carga antes que hoy.js)
require("../js/orden-lista.js");
// La secuencia de la sesión (hoy.html la carga antes que hoy.js)
require("../js/texto-sesion.js");
require("../js/secuencia-sesion.js");
// La bandeja de salida (en node no hay IndexedDB: la cola vive en memoria, como sin él)
require("../js/bandeja-salida.js");
// El diálogo accesible y "+ Actividad o tarea" (hoy.html los carga antes que hoy.js; Fase 4)
require("../js/para-quien.js");
require("../js/actividad-nueva.js");

// ── Supabase falso ───────────────────────────────────────────────────────────
const HOY = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
	.toISOString().slice(0, 10);
// Hace una semana (una sesión trabajada con una actividad que quedó incompleta)
const ANTES = new Date(new Date(HOY + "T12:00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10);

const ALUMNOS = [
	{ id: "al-2", nombre_completo: "ALUMNO DE SEGUNDO", num_lista: 1, grado: 2 },
	{ id: "al-3", nombre_completo: "ALUMNO DE TERCERO", num_lista: 2, grado: 3 },
];
const DATOS = {
	grupos: [{ id: "g1", nombre: "Multigrado", grados: ["2", "3"], es_multigrado: true, trimestre_actual: 1 }],
	alumnos: ALUMNOS,
	asistencias: [{ alumno_id: "al-2", asistencia_estado: "presente" }],
	registro_diario: [{ alumno_id: "al-3", participacion: 2, conducta: 1 }],
	proyectos: [
		{ id: "p1", titulo: "Proyecto de prueba", estado: "activo" },
		// Un proyecto por campo formativo: también activo (su id "ordena" antes que p1)
		{ id: "0-otro", titulo: "Otro proyecto activo", estado: "activo" },
				{ id: "pz", titulo: "Pausado", estado: "pausado" },
		// Actividades del trimestre (sueltas, sin proyecto; mi_salon_b17)
		{ id: "suel", titulo: "Actividades del trimestre", estado: "completado", tipo: "sueltas" },
	],
	sesiones: [
		{ id: "s1", numero_sesion: 1, fecha: HOY, campo_formativo: "Lenguajes", momento: "Desarrollo", proyecto_id: "p1" },
		{ id: "s2", numero_sesion: 2, fecha: HOY, campo_formativo: "Saberes y Pensamiento Científico", momento: "Desarrollo", proyecto_id: "p1" },
		// Pendiente y sin fecha: debe ofrecerse con "Trabajar hoy"
		{ id: "s3", numero_sesion: 3, fecha: null, campo_formativo: "Ética, Naturaleza y Sociedades", momento: "Desarrollo", proyecto_id: "p1", estado_sesion: "pendiente" },
		// Ya completada y sin fecha: no se ofrece
		{ id: "s0", numero_sesion: 0, fecha: null, campo_formativo: "Lenguajes", momento: "Cierre", proyecto_id: "p1", estado_sesion: "completada" },
		// Segundo proyecto activo con 5 pendientes (antes el tope de 4 escondía proyectos)
		{ id: "q1", numero_sesion: 1, fecha: null, campo_formativo: "Saberes y Pensamiento Científico", proyecto_id: "0-otro", estado_sesion: "pendiente" },
		{ id: "q2", numero_sesion: 2, fecha: null, campo_formativo: "Saberes y Pensamiento Científico", proyecto_id: "0-otro", estado_sesion: "pendiente" },
		{ id: "q3", numero_sesion: 3, fecha: null, campo_formativo: "Saberes y Pensamiento Científico", proyecto_id: "0-otro", estado_sesion: "pendiente" },
		{ id: "q4", numero_sesion: 4, fecha: null, campo_formativo: "Saberes y Pensamiento Científico", proyecto_id: "0-otro", estado_sesion: "pendiente" },
		{ id: "q5", numero_sesion: 5, fecha: null, campo_formativo: "Saberes y Pensamiento Científico", proyecto_id: "0-otro", estado_sesion: "pendiente" },
				{ id: "z1", numero_sesion: 1, fecha: null, campo_formativo: "Lenguajes", proyecto_id: "pz", estado_sesion: "pendiente" },
		// Sesión de hace una semana (ya trabajada) y la sesión suelta de hoy
		{ id: "sp", numero_sesion: 9, fecha: ANTES, campo_formativo: "Lenguajes", proyecto_id: "p1", estado_sesion: "completada" },
		{ id: "sx", numero_sesion: 1, fecha: HOY, campo_formativo: "Lenguajes", proyecto_id: "suel", estado_sesion: "activa" },
	],
	productos_sesion: [
		{ id: "pr1", sesion_id: "s1", tipo: "trabajo", nombre: "Cartel del cuento", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: null, orden: 1 },
		{ id: "pr2", sesion_id: "s1", tipo: "tarea", nombre: "Leer en casa", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: HOY, orden: 2 },
				{ id: "pr3", sesion_id: "s2", tipo: "trabajo", nombre: "Experimento del agua", grados: ["3"], modalidad: "diferenciada", campo: "SAB", fecha_entrega: null, orden: 1 },
		// Para quién (b17): de 3°, y el de 2° trabaja con 3°
		{ id: "pr4", sesion_id: "s2", tipo: "trabajo", nombre: "Problemas de 3°", grados: ["3"], modalidad: "diferenciada", campo: "SAB", fecha_entrega: null, orden: 2 },
		// De hace una semana: quedó incompleta para el de 3°
		{ id: "prP", sesion_id: "sp", tipo: "trabajo", nombre: "Mapa del barrio", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: null, orden: 1 },
		// Suelta de hoy
		{ id: "prS", sesion_id: "sx", tipo: "trabajo", nombre: "Lectura libre", grados: ["2", "3"], modalidad: "compartida", campo: "LEN", fecha_entrega: null, orden: 1 },
	],
	producto_sesion_alumnos: [{ producto_sesion_id: "pr4", alumno_id: "al-2", modo: "incluir" }],
	calendario_ajustes: [],
	calificaciones: [
				{ id: "c1", alumno_id: "al-2", producto_sesion_id: "pr1", estado_entrega: "entregado", nivel: "logrado", puntaje: null, retroalimentacion: null },
		{ id: "c2", alumno_id: "al-3", producto_sesion_id: "prP", estado_entrega: "incompleto", nivel: null, puntaje: null, retroalimentacion: null,
			estado_en_clase: "incompleta", revisar_en: ANTES, completado_en: null },
		{ id: "c3", alumno_id: "al-2", producto_sesion_id: "prP", estado_entrega: "entregado", nivel: "logrado", puntaje: null, retroalimentacion: null },
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
	ok("1. asistencia: una sub-tarjeta por grado (2° y 3°)", (asistencia.match(/data-asistencia-grado='(\d)'/g) || []).join(","), "data-asistencia-grado='2',data-asistencia-grado='3'");

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
	// La tarea se califica en "Tareas por revisar"; en la sesión solo se lista (para renombrarla
	// o quitarla), sin controles de calificación
	ok("3. la tarea no se califica dentro de la sesión", sesiones.indexOf("data-producto='pr2'"), -1);
	ok("3. la sesión lista sus tareas con su día de revisión",
		/Tareas de esta sesión[\s\S]*Leer en casa[\s\S]*Se revisa hoy/.test(sesiones), true);
	// Fase 4 (2026-09-29): cada sesión tiene el atajo "+ Actividad o tarea" (el diálogo con esa sesión ya elegida)
	ok("3. el botón de la sesión es «+ Actividad o tarea», con su ícono y su nombre accesible (sin window.prompt)",
		/data-agregar-producto='s1' aria-label='Agregar actividad o tarea a la sesión 1'[^>]*><svg[^>]*aria-hidden='true'>[\s\S]*?<\/svg>Actividad o tarea<\/button>/.test(sesiones) &&
		!/window\.prompt/.test(codigo), true);
	ok("3. el bloque de «Actividades del trimestre» tiene el mismo atajo", /data-agregar-producto='sx' aria-label='Agregar actividad o tarea a Actividades del trimestre de Lenguajes'/.test(sesiones), true);
	ok("3. ya no hay «Agregar actividad o tarea» ni «Actividad suelta» como texto de botón", !/>Agregar actividad o tarea</.test(sesiones) && !/Actividad suelta/.test(sesiones), true);
	// Varios proyectos activos: la siguiente de CADA uno, con su nombre (antes 4 en total por uuid)
	ok("3. Trabajar hoy: la siguiente del segundo proyecto activo también sale", sesiones.indexOf("data-trabajar-hoy='q1'") !== -1, true);
	ok("3. Trabajar hoy: cada proyecto con su nombre",
		sesiones.indexOf("Proyecto de prueba") !== -1 && sesiones.indexOf("Otro proyecto activo") !== -1, true);
	// Fase 1 (2026-09-29): solo la SIGUIENTE de cada proyecto ofrece "Trabajar hoy"; las demás se ven
	// ("N sesiones restantes"), cada una con su ojo (secuencia) y su lápiz (Crear proyecto, ya en esa sesión)
	ok("3. Trabajar hoy: las demás pendientes ya no lo ofrecen (solo la siguiente)",
		["q2", "q3", "q4", "q5"].every((id) => sesiones.indexOf("data-trabajar-hoy='" + id + "'") === -1), true);
	ok("3. las restantes dicen «4 sesiones restantes» (ya no «Elegir otra sesión»)",
		sesiones.indexOf("4 sesiones restantes") !== -1 && sesiones.indexOf("Elegir otra sesión") === -1, true);
	ok("3. cada sesión que falta lleva su ojo (secuencia)",
		["q1", "q2", "q3", "q4", "q5", "s3"].every((id) => sesiones.indexOf("data-ver-secuencia='" + id + "'") !== -1), true);
	ok("3. cada sesión que falta lleva su lápiz: enlace relativo a Crear proyecto con ?id= y &sesion=",
		sesiones.indexOf("href='crear_proyecto.html?id=0-otro&sesion=q3'") !== -1 && sesiones.indexOf("href='crear_proyecto.html?id=p1&sesion=s3'") !== -1, true);
	ok("3. el ojo y el lápiz miden al menos 44 px",
		/data-ver-secuencia='q2'[^>]*min-h-\[44px\] min-w-\[44px\]/.test(sesiones) && /data-editar-sesion='q2'[^>]*min-h-\[44px\] min-w-\[44px\]/.test(sesiones), true);
	ok("3. el lápiz no sale de /salon/ (ningún enlace absoluto)", !/data-editar-sesion='[^']+'[^>]*href='\//.test(sesiones) && sesiones.indexOf("href='/") === -1, true);
	ok("3. las sesiones de hoy traen el panel «Secuencia de la sesión» plegado",
		sesiones.indexOf("data-secuencia='s1'") !== -1 && /data-secuencia='s1' aria-expanded='false'/.test(sesiones) && sesiones.indexOf("Secuencia de la sesión") !== -1, true);
	ok("3. las actividades salen plegadas, con «N de M calificados»",
		/data-abrir-producto='pr1' aria-expanded='false'/.test(sesiones) && sesiones.indexOf("calificados") !== -1, true);
	ok("3. Trabajar hoy: no ofrece sesiones de un proyecto pausado", sesiones.indexOf("data-trabajar-hoy='z1'"), -1);

		// ── Fase 2 (2026-09-26): para quién, incompleta y sueltas ──
	const trasProblemas = sesiones.split("Problemas de 3°").slice(1).join("").split("Tareas de esta sesión")[0];
	ok("para quién: el de 2° incluido en una actividad de 3° aparece y «Trabaja con 3°»",
		/ALUMNO DE SEGUNDO[\s\S]*Trabaja con 3°/.test(trasProblemas), true);
	// 2026-10-02: el renglón dice quién la hace como la vista del proyecto (ParaQuien.quienHace): los nombres
	ok("para quién: el renglón dice quiénes la hacen (el de 2° incluido y los de 3°)", sesiones.indexOf("Problemas de 3°<span class='text-sm font-semibold text-blue-700' data-quien> · ALUMNO DE SEGUNDO, ALUMNO DE TERCERO</span>") !== -1, true);
	ok("para quién: cada actividad ofrece «Para quién»", sesiones.indexOf("data-para-quien='pr4'") !== -1, true);
	ok("incompleta: cada actividad en clase ofrece «Incompleta»", sesiones.indexOf("data-producto='pr1' data-alumno='al-3' data-incompleta='1'") !== -1, true);
	const pend = elementos.pendientesLista ? elementos.pendientesLista.innerHTML : "";
	ok("pendientes de la clase anterior: el de 3° con «Mapa del barrio», «Lo completó» y «Sigue incompleta»",
		/ALUMNO DE TERCERO[\s\S]*Mapa del barrio/.test(pend) && pend.indexOf("Lo completó") !== -1 && pend.indexOf("Sigue incompleta") !== -1, true);
	ok("pendientes: solo lo incompleto (no el que ya la entregó)", pend.indexOf("ALUMNO DE SEGUNDO"), -1);
	ok("pendientes: la sección se muestra", !elementos.pendientes.classList.contains("hidden"), true);
	ok("sueltas: su bloque se llama «Actividades del trimestre», no «Sesión 1», y ofrece «Pasar a un proyecto»",
		sesiones.indexOf("Actividades del trimestre · Lenguajes") !== -1 && sesiones.indexOf("data-pasar-proyecto='prS'") !== -1, true);
	ok("sueltas: no se «quitan de hoy»", sesiones.indexOf("data-quitar-hoy='sx'"), -1);
	ok("sueltas: no aparecen en «Trabajar hoy»", sesiones.indexOf("data-trabajar-hoy='sx'"), -1);

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

	// Capturar pasa por la bandeja de salida (js/bandeja-salida.js) y llega a la base
	ok("la cola de guardado es la bandeja del dispositivo", !!global.window.BandejaSalida, true);
	const clic = (lista, datos) => (elementos[lista]._listeners.click || []).forEach((fn) =>
		fn({ target: { closest: () => ({ dataset: datos }) } }));
	clic("asistenciaLista", { asistencia: "al-3", valor: "ausente" });
	// Lo que se ve justo al marcar la falta (el Supabase falso de esta prueba responde luego con su propia
	// fila de asistencias y la pantalla la toma, así que estas fotos se sacan antes)
	const cierreDespues = elementos.cierreLista.innerHTML;
	const sesionesDespues = elementos.sesionesLista.innerHTML;
	const tareasDespues = elementos.tareasLista.innerHTML;
	await new Promise((r) => setTimeout(r, 50));
	ok("tocar una asistencia la guarda (upsert en asistencias)", escrituras.indexOf("asistencias") !== -1, true);
	const pill = elementos.hoyEstadoGuardado || { textContent: "" };
	ok("al vaciarse la cola: \"Todo guardado\"", pill.textContent, "Todo guardado");

	// ── Fase 1 (2026-09-29) ──
	// Cierre del día: encabezado, columnas y "Faltó"
	ok("4. cierre: encabezado fijo con No., Grado, Nombre, Participación y Conducta",
		/data-cierre-encabezado[^>]*sticky top-14/.test(cierre) && ["No.", "Grado", "Nombre", "Participación", "Conducta"].every((t) => cierre.indexOf(">" + t + "</span>") !== -1), true);
	ok("4. cierre: Participación y Conducta con colores distintos", cierre.indexOf("bg-violet-100") !== -1 && cierre.indexOf("bg-teal-100") !== -1, true);
	ok("4. cierre: en el orden de la lista (2° antes que 3°) y con su número", cierre.indexOf("ALUMNO DE SEGUNDO") < cierre.indexOf("ALUMNO DE TERCERO") && /data-num-lista[^>]*>1</.test(cierre), true);
	// al-3 ya tenía un cierre 2/1: al marcarle la falta se ve «Faltó» CON sus chips y «Quitar del cierre» (R32 R-1)
	ok("4. cierre: quien faltó pero ya tenía un cierre distinto de 1/1 se ve «Faltó» con chips y «Quitar del cierre»",
		/data-cierre-fila='al-3'[\s\S]*data-cierre-falto[^>]*>Faltó<[\s\S]*data-cierre-quitar='al-3'/.test(cierreDespues) && cierreDespues.indexOf("data-cierre='participacion' data-alumno='al-3'") !== -1, true);
	ok("4. cierre: quien asistió conserva sus chips", cierreDespues.indexOf("data-cierre='participacion' data-alumno='al-2'") !== -1, true);
	// Quien faltó no aparece para calificar: ni en la sesión ni en Tareas; arriba de la sesión, quién faltó
	const cartel = sesionesDespues.split("data-bloque-producto='pr1'")[1].split("data-bloque-producto=")[0].split("id='ses-")[0];
	ok("3. el ausente sin calificación ya no aparece en «Cartel del cuento»", cartel.indexOf("ALUMNO DE TERCERO") === -1 && cartel.indexOf("ALUMNO DE SEGUNDO") !== -1, true);
	ok("3. arriba de la sesión dice quién faltó hoy", /data-faltaron-hoy>Faltó hoy: <span[^>]*>ALUMNO DE TERCERO/.test(sesionesDespues), true);
	ok("2. el ausente tampoco aparece en Tareas por revisar", tareasDespues.indexOf("data-tarea='pr2' data-alumno='al-3'") === -1 && tareasDespues.indexOf("data-tarea='pr2' data-alumno='al-2'") !== -1, true);
	// La asistencia completa se pliega sola a los 0.7 s, con su resumen y «Cambiar asistencia»
	ok("1. con la asistencia completa (recién marcada) todavía no se pliega", elementos.asistenciaPlegada.classList.contains("hidden"), true);
	await new Promise((r) => setTimeout(r, 900));
	ok("1. a los 0.7 s se pliega: resumen visible y lista oculta", !elementos.asistenciaPlegada.classList.contains("hidden") && elementos.asistenciaLista.classList.contains("hidden"), true);
	ok("1. el resumen dice «2 de 2 · N presentes …»", /^2 de 2 · [0-9] presentes?/.test(elementos.asistenciaTextoPlegada.textContent), true);
	(elementos.asistenciaCambiar._listeners.click || []).forEach((fn) => fn({}));
	ok("1. «Cambiar asistencia» la vuelve a abrir", elementos.asistenciaPlegada.classList.contains("hidden") && !elementos.asistenciaLista.classList.contains("hidden"), true);
	// La secuencia de una sesión se lee al abrirla (lectura opcional) y se muestra
	const clicSesiones = (selectores) => (elementos.sesionesLista._listeners.click || []).forEach((fn) =>
		fn({ target: { closest: (sel) => (selectores.some((k) => sel.indexOf(k) !== -1) ? { dataset: selectores.dato } : null) } }));
	const abrirSecuencia = Object.assign(["data-secuencia"], { dato: { secuencia: "s1" } });
	clicSesiones(abrirSecuencia);
	await new Promise((r) => setTimeout(r, 50));
	ok("3. abrir la secuencia la deja abierta y la lee sin escribir nada", /data-secuencia='s1' aria-expanded='true'/.test(elementos.sesionesLista.innerHTML), true);
	ok("3. tras abrirla no se escribió en `sesiones`", escrituras.indexOf("sesiones") === -1, true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
