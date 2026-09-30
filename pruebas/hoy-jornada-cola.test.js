/*
	"Finalizar jornada" espera lo que ÉL MISMO encola (R36, F1). Ejecuta js/hoy.js de verdad (DOM mínimo, la bandeja
	real en memoria) contra una base falsa LENTA y pulsa "Finalizar jornada" con un comentario a medio escribir y el
	cierre sin guardar. El botón encola el comentario y el relleno 1 y 1 (bandeja.agregar es asíncrono: pendientes()
	vale 0 justo después), así que la jornada debe pedirse DESPUÉS de la última respuesta de registro_diario.
	  - "lenta": cada escritura de registro_diario tarda 400 ms → la jornada va después y todo llega a la base;
	  - "red":   las escrituras de registro_diario fallan como sin red → NO se escribe la jornada y se avisa.
	Con js/hoy.js de d7a1911 (antes de la corrección) fallan los dos escenarios:
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
	const L = correr("lenta");
	ok("lenta: el escenario terminó", !!L);
	if (L) {
		const regResp = L.linea.filter((x) => x.tabla === "registro_diario" && x.que === "resp").map((x) => x.t);
		const pideJ = L.linea.filter((x) => x.tabla === "jornadas" && x.que === "pide").map((x) => x.t);
		ok("lenta: se escribieron el comentario y el relleno (al menos 2 escrituras de registro_diario)", regResp.length >= 2, JSON.stringify(L.linea));
		ok("lenta: la jornada se pidió una sola vez", pideJ.length === 1, String(pideJ.length));
		ok("lenta: la jornada se pide DESPUÉS de la última respuesta de registro_diario", pideJ.length === 1 && regResp.length && pideJ[0] >= Math.max.apply(null, regResp),
			"jornada a los " + pideJ[0] + " ms; última respuesta de registro_diario a los " + Math.max.apply(null, regResp.concat([0])) + " ms");
		ok("lenta: todo quedó en la base (3 cierres 1 y 1, el comentario y la jornada)",
			L.registro.length === 3 && L.registro.every((f) => f.participacion === 1 && f.conducta === 1) &&
			L.registro.filter((f) => f.nota === "Escrito justo antes de finalizar").length === 1 && L.jornadas === 1, JSON.stringify(L.registro));
		ok("lenta: Hoy dice «Jornada finalizada a las…»", /^Jornada finalizada a las \d{2}:\d{2}/.test(L.estado), L.estado);
		ok("lenta: sin errores en consola", L.errores.length === 0, JSON.stringify(L.errores.slice(0, 3)));
	}
	const R = correr("red");
	ok("red: el escenario terminó", !!R);
	if (R) {
		ok("red: si lo capturado no llega a la base, NO se escribe la jornada", R.linea.filter((x) => x.tabla === "jornadas").length === 0 && R.jornadas === 0, JSON.stringify(R.linea));
		ok("red: avisa que el día no se marcó", /el día no se marcó/.test(R.mensaje), R.mensaje);
		ok("red: Hoy no dice que se finalizó", !R.estado, R.estado);
	}
	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
}

// ── Un escenario: DOM mínimo, base falsa y la pantalla real ──────────────────
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
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
global.window = { location: { href: "", pathname: "/hoy", search: "", hash: "" }, prompt: function () { return null; }, alert: function () {}, addEventListener: function () {} };
global.Event = function () {};
require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/alcance-hoy.js");
require("../js/productos-hoy.js");
require("../js/orden-lista.js");
require("../js/texto-sesion.js");
require("../js/secuencia-sesion.js");
require("../js/bandeja-salida.js");

const HOY = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DATOS = {
	grupos: [{ id: "g1", nombre: "Grupo", grados: ["1"], es_multigrado: false, trimestre_actual: 1 }],
	alumnos: [
		{ id: "al-1", nombre_completo: "ANA", num_lista: 1, grado: 1 },
		{ id: "al-2", nombre_completo: "BETO", num_lista: 2, grado: 1 },
		{ id: "al-3", nombre_completo: "CARO", num_lista: 3, grado: 1 },
	],
	// Todos presentes y sin sesiones: no falta nada, "Finalizar jornada" registra directo (sin diálogo)
	asistencias: ["al-1", "al-2", "al-3"].map((a) => ({ alumno_id: a, asistencia_estado: "presente", captura_id: "m-" + a })),
};
const RETRASO = ESCENARIO === "lenta" ? 400 : 20;
const t0 = Date.now();
const linea = [];
const bd = { registro_diario: [], jornadas: [] };
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
	async function ejecutar() {
		if (q.op === "select") {
			if (tabla === "registro_diario" || tabla === "jornadas") {
				const f = bd[tabla].filter(cumple);
				return { data: q.uno ? (f[0] || null) : f, error: null, status: 200 };
			}
			const f = DATOS[tabla] || [];
			return { data: q.uno ? (f[0] || null) : f, error: null, status: 200 };
		}
		linea.push({ t: Date.now() - t0, que: "pide", tabla: tabla, op: q.op });
		if (ESCENARIO === "red" && tabla === "registro_diario") {
			await dormir(RETRASO);
			return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };
		}
		await dormir(tabla === "registro_diario" ? RETRASO : 5);
		let data = [];
		if (tabla === "registro_diario") {
			if (q.op === "upsert" || q.op === "insert") {
				q.filas.forEach((f) => {
					if (bd.registro_diario.some((x) => x.maestro_id === f.maestro_id && x.alumno_id === f.alumno_id && x.fecha === f.fecha)) return;
					const nueva = Object.assign({ id: "r" + bd.registro_diario.length, nota: null }, f);
					bd.registro_diario.push(nueva);
					data.push(Object.assign({}, nueva));
				});
			} else if (q.op === "update") {
				bd.registro_diario.filter(cumple).forEach((x) => { Object.assign(x, q.cambios); data.push(Object.assign({}, x)); });
			} else if (q.op === "delete") {
				data = bd.registro_diario.filter(cumple).map((x) => ({ id: x.id }));
				bd.registro_diario = bd.registro_diario.filter((x) => !cumple(x));
			}
		} else if (tabla === "jornadas") {
			const ahora = new Date().toISOString();
			bd.jornadas = bd.jornadas.filter((j) => !(j.grupo_id === q.filas[0].grupo_id && j.fecha === q.filas[0].fecha));
			bd.jornadas.push(Object.assign({ cerrada_en: ahora, actualizada_en: ahora }, q.filas[0]));
			data = [{ cerrada_en: ahora, actualizada_en: ahora }];
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

(async function () {
	await document._domReady();
	await dormir(50);
	// Un comentario a medio escribir (sin esperar la pausa de 1 s): lo escribe el docente en la caja de ANA
	const ta = { dataset: { cierreNota: "al-1" }, value: "Escrito justo antes de finalizar", style: {}, selectionStart: 0, selectionEnd: 0 };
	((elementos.cierreLista || {})._listeners.input || []).forEach((fn) => fn({ target: { closest: () => ta } }));
	// "Finalizar jornada"
	const boton = elementos.jornadaBtn;
	(boton._listeners.click || []).forEach((fn) => fn({}));
	// Espera a que termine (se escribe la jornada o aparece un aviso), con tope
	const fin = Date.now() + 15000;
	while (Date.now() < fin) {
		await dormir(100);
		const listo = bd.jornadas.length || /no se marcó/.test((elementos.hoyMensaje || {}).textContent || "");
		if (listo && !boton.disabled) break;
	}
	await dormir(300);
	console.log("RESULTADO " + JSON.stringify({
		linea: linea, registro: bd.registro_diario.map((f) => ({ alumno_id: f.alumno_id, participacion: f.participacion, conducta: f.conducta, nota: f.nota })),
		jornadas: bd.jornadas.length, estado: (elementos.jornadaEstadoTexto || {}).textContent || "",
		mensaje: (elementos.hoyMensaje || {}).textContent || "", errores: errores,
	}));
	process.exit(0);
})().catch((e) => {
	console.log("RESULTADO " + JSON.stringify({ linea: linea, registro: [], jornadas: -1, estado: "", mensaje: "EXCEPCION " + e.message + " · pantalla: " + ((elementos.hoyMensaje || {}).textContent || "") +
		" · ir a: " + global.window.location.href + " · elementos: " + Object.keys(elementos).join(","), errores: errores.concat([String(e.stack)]) }));
	process.exit(0);
});
