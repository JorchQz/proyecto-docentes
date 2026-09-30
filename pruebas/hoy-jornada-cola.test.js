/*
	Hoy espera lo que ÉL MISMO acaba de encolar antes de hacer algo que no se deshace (R36). Ejecuta js/hoy.js de verdad
	(DOM mínimo, la bandeja real en memoria) contra una base falsa LENTA o SIN RED. bandeja.agregar es asíncrono:
	justo después de encolar, pendientes() vale 0; por eso cada acción usa esperarCola().
	  - "Finalizar jornada" con un comentario a medio escribir y el cierre sin guardar: encola el comentario y el
	    relleno 1 y 1; la jornada se pide DESPUÉS de la última respuesta de registro_diario (sin red: no se marca).
	  - "Terminar sesión" con una retroalimentación a medio escribir: el cambio de estado de la sesión se pide DESPUÉS
	    de la última respuesta de calificaciones (sin red: no se termina ni se recarga).
	  - "Pasar a un proyecto" una actividad suelta con una retroalimentación a medio escribir: el diálogo de pasar
	    se abre DESPUÉS de la última respuesta de calificaciones (sin red: no se abre).
	Escenarios: jornada-lenta, jornada-red, terminar-lenta, terminar-red, pasar-lenta, pasar-red (cada uno en su proceso).
	Con js/hoy.js de d7a1911 (antes de la corrección) fallan todos:
	  git show d7a1911:js/hoy.js > /tmp/hoy-viejo.js && node pruebas/hoy-jornada-cola.test.js /tmp/hoy-viejo.js

	node pruebas/hoy-jornada-cola.test.js [ruta de otra versión de hoy.js]
*/
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ESCENARIO = process.env.JORNADA_ESCENARIO || "";
const ARCHIVO = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "js", "hoy.js");

// ── Proceso principal: corre cada escenario aparte y revisa ─────────────────
if (!ESCENARIO) {
	let fallos = 0;
	const ok = (nombre, bien, detalle) => {
		if (!bien) fallos++;
		console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
	};
	function correr(esc) {
		const r = spawnSync(process.execPath, [__filename, ARCHIVO], { env: Object.assign({}, process.env, { JORNADA_ESCENARIO: esc }), encoding: "utf8", timeout: 60000 });
		const linea = (r.stdout || "").split(/\r?\n/).find((l) => l.startsWith("RESULTADO "));
		if (!linea) { console.log((r.stdout || "") + (r.stderr || "")); return null; }
		return JSON.parse(linea.slice("RESULTADO ".length));
	}
	const tiempos = (R, tabla, que) => R.linea.filter((x) => x.tabla === tabla && x.que === que).map((x) => x.t);
	const ultima = (lista) => (lista.length ? Math.max.apply(null, lista) : undefined);

	// Finalizar jornada
	const L = correr("jornada-lenta");
	ok("jornada lenta: el escenario terminó", !!L);
	if (L) {
		const regResp = tiempos(L, "registro_diario", "resp");
		const pideJ = tiempos(L, "jornadas", "pide");
		ok("jornada lenta: se escribieron el comentario y el relleno (al menos 2 escrituras de registro_diario)", regResp.length >= 2, JSON.stringify(L.linea));
		ok("jornada lenta: la jornada se pidió una sola vez", pideJ.length === 1, String(pideJ.length));
		ok("jornada lenta: la jornada se pide DESPUÉS de la última respuesta de registro_diario", pideJ.length === 1 && regResp.length && pideJ[0] >= ultima(regResp),
			"jornada a los " + pideJ[0] + " ms; última respuesta de registro_diario a los " + ultima(regResp) + " ms");
		ok("jornada lenta: todo quedó en la base (3 cierres 1 y 1, el comentario y la jornada)",
			L.registro.length === 3 && L.registro.every((f) => f.participacion === 1 && f.conducta === 1) &&
			L.registro.filter((f) => f.nota === "Escrito justo antes de finalizar").length === 1 && L.jornadas === 1, JSON.stringify(L.registro));
		ok("jornada lenta: Hoy dice «Jornada finalizada a las…»", /^Jornada finalizada a las \d{2}:\d{2}/.test(L.estado), L.estado);
		ok("jornada lenta: sin errores en consola", L.errores.length === 0, JSON.stringify(L.errores.slice(0, 3)));
	}
	const R = correr("jornada-red");
	ok("jornada sin red: el escenario terminó", !!R);
	if (R) {
		ok("jornada sin red: si lo capturado no llega a la base, NO se escribe la jornada", R.linea.filter((x) => x.tabla === "jornadas").length === 0 && R.jornadas === 0, JSON.stringify(R.linea));
		ok("jornada sin red: avisa que el día no se marcó", /el día no se marcó/.test(R.mensaje), R.mensaje);
		ok("jornada sin red: Hoy no dice que se finalizó", !R.estado, R.estado);
	}

	// Terminar sesión
	const T = correr("terminar-lenta");
	ok("terminar lenta: el escenario terminó", !!T);
	if (T) {
		const calResp = tiempos(T, "calificaciones", "resp");
		const pideS = tiempos(T, "sesiones", "pide");
		ok("terminar lenta: la retroalimentación a medio escribir se escribió", calResp.length >= 1 && T.calificaciones.some((c) => c.retroalimentacion === "Muy bien, sigue así"), JSON.stringify(T.linea));
		ok("terminar lenta: el cambio de estado de la sesión se pide DESPUÉS de la última respuesta de calificaciones", pideS.length === 1 && calResp.length && pideS[0] >= ultima(calResp),
			"sesión a los " + pideS.join(",") + " ms; última respuesta de calificaciones a los " + ultima(calResp) + " ms");
		ok("terminar lenta: la sesión quedó completada y la pantalla se recarga", T.sesionEstado === "completada" && T.recargas === 1, T.sesionEstado + " · recargas " + T.recargas);
		ok("terminar lenta: sin errores en consola", T.errores.length === 0, JSON.stringify(T.errores.slice(0, 3)));
	}
	const TR = correr("terminar-red");
	ok("terminar sin red: el escenario terminó", !!TR);
	if (TR) {
		ok("terminar sin red: si lo capturado no llega a la base, NO se termina la sesión ni se recarga",
			tiempos(TR, "sesiones", "pide").length === 0 && TR.sesionEstado === "activa" && TR.recargas === 0 && !TR.modal, JSON.stringify(TR.linea));
		ok("terminar sin red: avisa que no se puede terminar la sesión", /no se puede terminar la sesión/.test(TR.mensaje), TR.mensaje);
	}

	// Pasar a un proyecto
	const P = correr("pasar-lenta");
	ok("pasar lenta: el escenario terminó", !!P);
	if (P) {
		const calResp = tiempos(P, "calificaciones", "resp");
		ok("pasar lenta: el diálogo de pasar se abre DESPUÉS de la última respuesta de calificaciones (la retroalimentación ya está en la base)",
			P.pasarAbierto !== null && calResp.length && P.pasarAbierto >= ultima(calResp) && P.calificaciones.some((c) => c.retroalimentacion === "Muy bien, sigue así"),
			"diálogo a los " + P.pasarAbierto + " ms; última respuesta de calificaciones a los " + ultima(calResp) + " ms");
		ok("pasar lenta: sin errores en consola", P.errores.length === 0, JSON.stringify(P.errores.slice(0, 3)));
	}
	const PR = correr("pasar-red");
	ok("pasar sin red: el escenario terminó", !!PR);
	if (PR) {
		ok("pasar sin red: si lo capturado no llega a la base, NO se abre el diálogo de pasar", PR.pasarAbierto === null, String(PR.pasarAbierto));
		ok("pasar sin red: avisa que primero hay que enviar lo capturado", /Primero hay que enviar lo capturado/.test(PR.mensaje), PR.mensaje);
	}
	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
}

// ── Un escenario: DOM mínimo, base falsa y la pantalla real ──────────────────
const [ACCION, MODO] = ESCENARIO.split("-"); // jornada|terminar|pasar, lenta|red
function crearElemento(id) {
	return {
		id: id, innerHTML: "", textContent: "", className: "", value: "", dataset: {}, disabled: false, style: {},
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
		contains: function () { return false; },
	};
}
const elementos = {};
const errores = [];
let recargas = 0;
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = {
	location: { href: "", pathname: "/hoy", search: "", hash: "", reload: function () { recargas++; } },
	prompt: function () { return null; }, alert: function () {}, addEventListener: function () {},
};
global.Event = function () {};
require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/alcance-hoy.js");
require("../js/productos-hoy.js");
require("../js/orden-lista.js");
require("../js/texto-sesion.js");
require("../js/secuencia-sesion.js");
require("../js/sesion-terminar.js");
require("../js/bandeja-salida.js");

const HOY = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const t0 = Date.now();
let modal = false, pasarAbierto = null;
// El modal de Terminar y el diálogo de Pasar a un proyecto son de otros módulos: aquí se confirma solo y se anota cuándo
window.SesionTerminar.abrirModal = function (op) { modal = true; op.alConfirmar(""); };
window.PasarAProyecto = { abrir: function () { pasarAbierto = Date.now() - t0; } };

const ALUMNOS = [
	{ id: "al-1", nombre_completo: "ANA", num_lista: 1, grado: 1 },
	{ id: "al-2", nombre_completo: "BETO", num_lista: 2, grado: 1 },
	{ id: "al-3", nombre_completo: "CARO", num_lista: 3, grado: 1 },
];
const DATOS = {
	grupos: [{ id: "g1", nombre: "Grupo", grados: ["1"], es_multigrado: false, trimestre_actual: 1 }],
	alumnos: ALUMNOS,
	asistencias: ALUMNOS.map((a) => ({ alumno_id: a.id, fecha: HOY, asistencia_estado: "presente", captura_id: "m-" + a.id })),
};
// Terminar: una sesión de hoy con un trabajo; Pasar: una actividad suelta de hoy. Jornada: sin sesiones (no falta nada)
if (ACCION === "terminar") {
	DATOS.proyectos = [{ id: "p1", titulo: "Proyecto", estado: "activo", trimestre: 1, tipo: "proyecto", grados: ["1"] }];
	DATOS.sesiones = [{ id: "s1", numero_sesion: 1, fecha: HOY, campo_formativo: "Lenguajes", momento: "Desarrollo", proyecto_id: "p1", estado_sesion: "activa", maestro_id: "m1" }];
} else if (ACCION === "pasar") {
	DATOS.proyectos = [{ id: "suel", titulo: "Actividades del trimestre", estado: "completado", trimestre: 1, tipo: "sueltas", grados: ["1"] }];
	DATOS.sesiones = [{ id: "s1", numero_sesion: 1, fecha: HOY, campo_formativo: "Lenguajes", proyecto_id: "suel", estado_sesion: "activa", maestro_id: "m1" }];
}
if (ACCION !== "jornada") {
	DATOS.productos_sesion = [{ id: "pr1", sesion_id: "s1", tipo: "trabajo", nombre: "Cartel", grados: ["1"], modalidad: "compartida", campo: "LEN", fecha_entrega: null, orden: 1, activo: true, created_at: HOY + "T08:00:00-06:00" }];
}
const LENTAS = ["registro_diario", "calificaciones"];
const RETRASO = MODO === "lenta" ? 400 : 20;
const linea = [];
const bd = { registro_diario: [], jornadas: [], calificaciones: [], sesiones: (DATOS.sesiones || []).map((s) => Object.assign({}, s)) };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function consulta(tabla) {
	const q = { op: "select", filas: null, cambios: null, filtros: [], uno: false };
	["select", "or", "gte", "lte", "not", "order", "limit", "range", "neq"].forEach((m) => { q[m] = function () { return q; }; });
	q.eq = function (c, v) { q.filtros.push([c, "eq", v]); return q; };
	q.is = function (c) { q.filtros.push([c, "is", null]); return q; };
	q.in = function (c, v) { q.filtros.push([c, "in", v]); return q; };
	q.maybeSingle = q.single = function () { q.uno = true; return q; };
	q.upsert = function (f, o) { q.op = "upsert"; q.filas = [].concat(f); q.opciones = o || {}; return q; };
	q.insert = function (f) { q.op = "insert"; q.filas = [].concat(f); return q; };
	q.update = function (c) { q.op = "update"; q.cambios = c; return q; };
	q.delete = function () { q.op = "delete"; return q; };
	const cumple = (fila) => q.filtros.every(([c, op, v]) => (op === "is" ? fila[c] === null || fila[c] === undefined : op === "in" ? v.indexOf(fila[c]) !== -1 : fila[c] === v));
	const llaveCal = (a, b) => a.maestro_id === b.maestro_id && a.alumno_id === b.alumno_id && a.producto_sesion_id === b.producto_sesion_id;
	async function ejecutar() {
		if (q.op === "select") {
			if (tabla === "registro_diario" || tabla === "jornadas" || tabla === "calificaciones") {
				const f = bd[tabla].filter(cumple);
				return { data: q.uno ? (f[0] || null) : f, error: null, status: 200, count: f.length };
			}
			if (tabla === "sesiones" && q.filtros.some((x) => x[0] === "estado_sesion")) return { data: [], error: null, status: 200, count: 0 };
			const f = tabla === "sesiones" ? bd.sesiones : DATOS[tabla] || [];
			return { data: q.uno ? (f[0] || null) : f, error: null, status: 200, count: 0 };
		}
		linea.push({ t: Date.now() - t0, que: "pide", tabla: tabla, op: q.op });
		if (MODO === "red" && LENTAS.indexOf(tabla) !== -1) {
			await dormir(RETRASO);
			return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };
		}
		await dormir(LENTAS.indexOf(tabla) !== -1 ? RETRASO : 5);
		let data = [];
		if (tabla === "registro_diario" || tabla === "calificaciones") {
			const iguales = tabla === "calificaciones" ? llaveCal : (a, b) => a.maestro_id === b.maestro_id && a.alumno_id === b.alumno_id && a.fecha === b.fecha;
			if (q.op === "upsert" || q.op === "insert") {
				for (const f of q.filas) {
					if (bd[tabla].some((x) => iguales(x, f))) {
						if (q.op === "insert") return { data: null, error: { message: "duplicate key", code: "23505" }, status: 409 };
						continue;
					}
					const nueva = Object.assign({ id: tabla[0] + bd[tabla].length, nota: null }, f);
					bd[tabla].push(nueva);
					data.push(Object.assign({}, nueva));
				}
			} else if (q.op === "update") {
				bd[tabla].filter(cumple).forEach((x) => { Object.assign(x, q.cambios); data.push(Object.assign({}, x)); });
			} else if (q.op === "delete") {
				data = bd[tabla].filter(cumple).map((x) => ({ id: x.id }));
				bd[tabla] = bd[tabla].filter((x) => !cumple(x));
			}
		} else if (tabla === "jornadas") {
			const ahora = new Date().toISOString();
			bd.jornadas = bd.jornadas.filter((j) => !(j.grupo_id === q.filas[0].grupo_id && j.fecha === q.filas[0].fecha));
			bd.jornadas.push(Object.assign({ cerrada_en: ahora, actualizada_en: ahora }, q.filas[0]));
			data = [{ cerrada_en: ahora, actualizada_en: ahora }];
		} else if (tabla === "sesiones" && q.op === "update") {
			bd.sesiones.filter(cumple).forEach((x) => { Object.assign(x, q.cambios); data.push(Object.assign({}, x)); });
		}
		linea.push({ t: Date.now() - t0, que: "resp", tabla: tabla, op: q.op });
		return { data: data, error: null, status: 201 };
	}
	q.then = function (res, rej) { return ejecutar().then(res, rej); };
	return q;
}
global.window.sb = {
	auth: { getUser: function () { return Promise.resolve({ data: { user: { id: "m1" } }, error: null }); } },
	from: consulta,
};

const codigo = fs.readFileSync(ARCHIVO, "utf8");
console.error = function () { errores.push(Array.prototype.slice.call(arguments).map(String).join(" ").slice(0, 200)); };
console.warn = function () {};
console.log = (function (log) { return function () { if (String(arguments[0]).startsWith("RESULTADO ")) log.apply(null, arguments); }; })(console.log);
new Function(codigo)();

// Un evento cuyo objetivo responde closest(selector) solo al selector pedido
const evento = (selector, el) => ({ target: { closest: (s) => (s === selector ? el : null) } });

(async function () {
	await document._domReady();
	await dormir(50);
	let listo;
	if (ACCION === "jornada") {
		// Un comentario a medio escribir (sin esperar la pausa de 1 s) en la caja de ANA y "Finalizar jornada"
		const ta = { dataset: { cierreNota: "al-1" }, value: "Escrito justo antes de finalizar", style: {}, selectionStart: 0, selectionEnd: 0 };
		((elementos.cierreLista || {})._listeners.input || []).forEach((fn) => fn({ target: { closest: () => ta } }));
		const boton = elementos.jornadaBtn;
		(boton._listeners.click || []).forEach((fn) => fn({}));
		listo = () => (bd.jornadas.length || /no se marcó/.test((elementos.hoyMensaje || {}).textContent || "")) && !boton.disabled;
	} else {
		// Una retroalimentación a medio escribir (sin esperar la pausa de 1 s) y, enseguida, el botón
		const ta = { dataset: { retroalimentacion: "pr1", alumno: "al-1" }, value: "Muy bien, sigue así" };
		(elementos.sesionesLista._listeners.input || []).forEach((fn) => fn(evento("textarea[data-retroalimentacion]", ta)));
		const boton = ACCION === "terminar"
			? { dataset: { terminarSesion: "s1" }, textContent: "Terminar sesión 1", disabled: false }
			: { dataset: { pasarProyecto: "pr1" }, textContent: "Pasar a un proyecto", disabled: false };
		const sel = ACCION === "terminar" ? "button[data-terminar-sesion]" : "button[data-pasar-proyecto]";
		(elementos.sesionesLista._listeners.click || []).forEach((fn) => fn(evento(sel, boton)));
		listo = () => (recargas || pasarAbierto !== null || /no se puede|Primero hay que enviar/.test((elementos.hoyMensaje || {}).textContent || "")) && !boton.disabled;
	}
	const fin = Date.now() + 15000;
	while (Date.now() < fin) {
		await dormir(100);
		if (listo()) break;
	}
	await dormir(300);
	console.log("RESULTADO " + JSON.stringify({
		linea: linea, registro: bd.registro_diario.map((f) => ({ alumno_id: f.alumno_id, participacion: f.participacion, conducta: f.conducta, nota: f.nota })),
		calificaciones: bd.calificaciones.map((c) => ({ alumno_id: c.alumno_id, producto_sesion_id: c.producto_sesion_id, retroalimentacion: c.retroalimentacion })),
		jornadas: bd.jornadas.length, estado: (elementos.jornadaEstadoTexto || {}).textContent || "",
		sesionEstado: (bd.sesiones[0] || {}).estado_sesion || null, recargas: recargas, modal: modal, pasarAbierto: pasarAbierto,
		mensaje: (elementos.hoyMensaje || {}).textContent || "", errores: errores,
	}));
	process.exit(0);
})().catch((e) => {
	console.log("RESULTADO " + JSON.stringify({ linea: linea, registro: [], calificaciones: [], jornadas: -1, estado: "", sesionEstado: null, recargas: recargas, modal: modal, pasarAbierto: pasarAbierto,
		mensaje: "EXCEPCION " + e.message + " · pantalla: " + ((elementos.hoyMensaje || {}).textContent || "") + " · ir a: " + global.window.location.href,
		errores: errores.concat([String(e.stack)]) }));
	process.exit(0);
});
