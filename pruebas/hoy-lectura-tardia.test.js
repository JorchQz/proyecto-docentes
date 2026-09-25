/*
	"Hoy": ninguna lectura tardía pisa una versión vista más nueva (R14-FAIL 2, x05; docs/PWA-MI-SALON.md §9.9).

	Ejecuta js/hoy.js de verdad (DOM mínimo, Supabase falso y un BroadcastChannel falso). La
	lectura del cierre del día sale y se queda detenida; mientras, otra ventana de este aparato
	avisa por el canal que Dani ya tiene participación 2 y conducta 2 (con sus marcas). Luego llega
	la lectura con lo viejo (1 y 1). Esperado: la pantalla muestra 2 y 2, y el siguiente toque
	(conducta 0) se escribe condicionado a la marca NUEVA de la conducta (no a la vieja).

	node pruebas/hoy-lectura-tardia.test.js [hoy.js de otra versión] [bandeja-salida.js de otra versión]
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── DOM mínimo ───────────────────────────────────────────────────────────────
function crearElemento(id) {
	return {
		id: id, innerHTML: "", textContent: "", className: "", value: "", dataset: {},
		classList: {
			_c: new Set(),
			add: function (c) { this._c.add(c); },
			remove: function (c) { this._c.delete(c); },
			contains: function (c) { return this._c.has(c); },
			toggle: function (c, f) { if (f === undefined ? !this._c.has(c) : f) this._c.add(c); else this._c.delete(c); },
		},
		_listeners: {},
		addEventListener: function (evento, fn) { (this._listeners[evento] = this._listeners[evento] || []).push(fn); },
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		closest: function () { return null; },
	};
}
const elementos = {};
global.document = {
	_domReady: null,
	getElementById: function (id) { return (elementos[id] = elementos[id] || crearElemento(id)); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (evento, fn) { if (evento === "DOMContentLoaded") this._domReady = fn; },
};
// Otra ventana de este aparato: el canal de la bandeja
const canales = [];
global.window = {
	location: { href: "" },
	prompt: function () { return null; },
	alert: function () {},
	addEventListener: function () {},
	BroadcastChannel: function () {
		this.fns = [];
		this.postMessage = function () {};
		this.addEventListener = function (t, fn) { if (t === "message") this.fns.push(fn); };
		this.close = function () {};
		canales.push(this);
	},
};
global.Event = function () {};

require("../js/campos-formativos.js");
require("../js/grupo-activo.js");
require("../js/alcance-hoy.js");
require(process.argv[3] ? path.resolve(process.argv[3]) : "../js/bandeja-salida.js");

// ── Supabase falso ───────────────────────────────────────────────────────────
const HOY = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DATOS = {
	grupos: [{ id: "g1", nombre: "Multigrado", grados: ["1", "2"], es_multigrado: true, trimestre_actual: 1 }],
	alumnos: [
		{ id: "ana", nombre_completo: "ANA", num_lista: 1, grado: 1 },
		{ id: "dani", nombre_completo: "DANI", num_lista: 2, grado: 2 },
	],
	asistencias: [],
	// Lo que había cuando salió la lectura: el relleno 1 y 1 (marcas del relleno)
	registro_diario: [
		{ alumno_id: "ana", participacion: 1, conducta: 1, captura_id: "r-ana", captura_participacion: "r-ana", captura_conducta: "r-ana" },
		{ alumno_id: "dani", participacion: 1, conducta: 1, captura_id: "r-dani", captura_participacion: "r-dani", captura_conducta: "r-dani" },
	],
	proyectos: [],
};
let soltarRegistro;
const registroDetenido = new Promise((r) => { soltarRegistro = r; });
let registroSalio = false;
const escrituras = [];
function consulta(tabla) {
	const q = {
		op: "select", filtros: [], fila: null,
		select: function () { return this; },
		eq: function (c, v) { this.filtros.push([c, v]); return this; },
		is: function (c) { this.filtros.push([c, null]); return this; },
		in: function () { return this; }, or: function () { return this; }, order: function () { return this; },
		range: function () { return this; }, limit: function () { return this; },
		single: function () { this.uno = true; return this; },
		maybeSingle: function () { this.uno = true; return this; },
		insert: function (f) { this.op = "insert"; this.fila = f; return this; },
		upsert: function (f) { this.op = "upsert"; this.fila = f; return this; },
		update: function (f) { this.op = "update"; this.fila = f; return this; },
		delete: function () { this.op = "delete"; return this; },
		then: function (resolver, rechazar) {
			const q2 = this;
			if (q2.op !== "select") {
				escrituras.push({ tabla: tabla, op: q2.op, fila: q2.fila, filtros: q2.filtros });
				const filas = [].concat(q2.fila).map((f) => Object.assign({ id: "nuevo", participacion: 2, conducta: 2 }, f));
				return Promise.resolve({ data: filas, error: null, status: 200 }).then(resolver, rechazar);
			}
			const filas = DATOS[tabla] || [];
			const res = { data: q2.uno ? filas[0] || null : filas, error: null, status: 200 };
			if (tabla === "registro_diario" && !q2.uno) {
				registroSalio = true;
				return registroDetenido.then(() => res).then(resolver, rechazar);
			}
			return Promise.resolve(res).then(resolver, rechazar);
		},
	};
	return q;
}
global.window.sb = {
	auth: { getUser: function () { return Promise.resolve({ data: { user: { id: "m1" } }, error: null }); } },
	from: function (tabla) { return consulta(tabla); },
};

const archivo = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "js", "hoy.js");
new Function(fs.readFileSync(archivo, "utf8"))();

(async function () {
	const carga = document._domReady();
	for (let i = 0; i < 100 && !registroSalio; i++) await dormir(5);
	ok("la lectura del cierre salió y quedó detenida", registroSalio, true);
	// Mientras, otra ventana de este aparato confirmó participación 2 y conducta 2 de Dani
	const nueva = { marcas: { captura_participacion: "o2", captura_conducta: "o1" }, valor: { participacion: 2, conducta: 2 } };
	const msg = { maestro_id: "m1", tipo: "guardada", clave: "registro|m1|dani|" + HOY, tipoCaptura: "registro",
		datos: { alumno_id: "dani", fecha: HOY }, base: nueva, valor: nueva.valor, id: null, sigue: false };
	canales.forEach((c) => c.fns.forEach((fn) => fn({ data: msg })));
	await dormir(10);
	soltarRegistro(); // llega la lectura (vieja: 1 y 1)
	await carga;
	await dormir(20);

	const cierre = elementos.cierreLista.innerHTML;
	const activo = (campo, v) => new RegExp("data-cierre='" + campo + "' data-alumno='dani' data-valor='" + v + "' class='[^']*bg-blue-600 text-white").test(cierre);
	ok("la pantalla muestra lo más nuevo de Dani (2 y 2), no la lectura tardía (1 y 1)", [activo("participacion", 2), activo("conducta", 2)], [true, true]);
	ok("Ana (sin versión nueva) queda como la leyó", new RegExp("data-cierre='conducta' data-alumno='ana' data-valor='1' class='[^']*bg-blue-600").test(cierre), true);

	// La maestra toca conducta 0 a Dani: se escribe sobre la marca nueva de la conducta
	(elementos.cierreLista._listeners.click || []).forEach((fn) => fn({ target: { closest: () => ({ dataset: { cierre: "conducta", alumno: "dani", valor: "0" } }) } }));
	for (let i = 0; i < 100 && !escrituras.length; i++) await dormir(5);
	await dormir(20);
	const w = escrituras.find((e) => e.tabla === "registro_diario" && e.op === "update");
	ok("el toque escribe una sola vez, un update condicionado a la marca nueva de la conducta",
		w ? [escrituras.length, w.filtros.filter((f) => /^captura_/.test(f[0]))] : escrituras.map((e) => e.op), [1, [["captura_conducta", "o1"]]]);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
