/*
	Asistencia (js/asistencia.js) completa, sin navegador. Decisión 8 de Jorge (2026-09-24):
	igual que "Hoy", un alumno sin marcar queda SIN REGISTRO (no es falta) y solo se guarda
	lo que la maestra toca. Se comprueba:
	  - al abrir: quien no tiene fila sale "sin registro" (no "falta") y nada se escribe;
	  - tocar Falta guarda SOLO a ese alumno (no a todo el grupo) y retira su cierre 1 y 1;
	  - volver a tocar la opción marcada la quita: su fila se BORRA de la base;
	  - "Presentes los que faltan" guarda solo a quienes seguían sin registro;
	  - defecto 7: tocar y cambiar de fecha enseguida no manda la lista del día nuevo (el
	    guardado lleva su propia fecha y su propio alumno);
	  - un guardado que falla regresa la pantalla a lo que tiene la base y lo dice;
	  - si la falta se guarda pero su cierre no se puede quitar, el aviso dice de quién y
	    exactamente qué hacer (tocar Falta dos veces), y hacerlo vuelve a quitar el cierre;
	  - con cada lectura en error (grupos, alumnos, asistencias) la página se detiene con el
	    aviso común, no dice "no hay alumnos" y no escribe nada.

	node pruebas/asistencia-arranque.test.js
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}
const JS = (n) => fs.readFileSync(path.join(__dirname, "..", "js", n), "utf8");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function fechaLocal(d) {
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const HOY = fechaLocal(new Date());
const AYER = fechaLocal(new Date(Date.now() - 86400000));

const ALUMNOS = [
	{ id: "al-1", nombre_completo: "ANA", num_lista: 1 },
	{ id: "al-2", nombre_completo: "BETO", num_lista: 2 },
	{ id: "al-3", nombre_completo: "CARLA", num_lista: 3 },
];

function escenario(opciones) {
	opciones = opciones || {};
	const porId = {};
	function el(id) {
		const clases = new Set();
		return porId[id] = porId[id] || {
			id, innerHTML: "", textContent: "", className: "", value: "", max: "", disabled: false, dataset: {}, style: {}, _l: {},
			classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c), toggle: (c, f) => (f ? clases.add(c) : clases.delete(c)) },
			addEventListener(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); },
			setAttribute() {}, appendChild(h) { return h; },
		};
	}
	const docListeners = {};
	const body = { children: [], appendChild(h) { this.children.push(h); if (h.id) porId[h.id] = h; return h; } };
	const documento = {
		body,
		documentElement: { style: {} },
		getElementById: (id) => (["attendanceDateInput", "attendanceSummary", "attendanceList", "attendanceMessage", "attendanceSaveState", "markAllPresentBtn"].indexOf(id) !== -1 ? el(id) : porId[id] || null),
		createElement: (t) => { const e = el("_" + t + Math.random()); e.tagName = t.toUpperCase(); e.children = []; e.appendChild = function (h) { this.children.push(h); return h; }; return e; },
		addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
	};
	// Base falsa
	const asistencias = (opciones.asistencias || []).map((a) => Object.assign({}, a));
	const escrituras = [];
	let fallarEscritura = 0;
	let fallarRegistro = 0;
	function consulta(tabla) {
		const q = {
			_filtros: {}, _in: null, _op: "select", _filas: null,
			select() { return this; }, order() { return this; }, limit() { return this; }, range() { return this; },
			eq(c, v) { this._filtros[c] = v; return this; },
			in(c, v) { this._in = [c, v]; return this; },
			maybeSingle() { return this; },
			upsert(filas) { this._op = "upsert"; this._filas = [].concat(filas); return this; },
			delete() { this._op = "delete"; return this; },
			insert(f) { this._op = "insert"; this._filas = [].concat(f); return this; },
			update() { this._op = "update"; return this; },
			then(resolver) {
				const self = this;
				return espera(opciones.lento || 1).then(function () {
					if (self._op !== "select") {
						escrituras.push({ tabla, op: self._op, filas: self._filas, filtros: self._filtros, in: self._in });
						if (fallarEscritura > 0 && tabla === "asistencias") { fallarEscritura--; return resolver({ data: null, error: { message: "sin red" } }); }
						if (fallarRegistro > 0 && tabla === "registro_diario") { fallarRegistro--; return resolver({ data: null, error: { message: "sin red" } }); }
						if (tabla === "asistencias" && self._op === "upsert") {
							self._filas.forEach((f) => {
								const i = asistencias.findIndex((a) => a.alumno_id === f.alumno_id && a.fecha === f.fecha);
								if (i >= 0) asistencias[i] = Object.assign({}, f); else asistencias.push(Object.assign({}, f));
							});
						}
						if (tabla === "asistencias" && self._op === "delete") {
							for (let i = asistencias.length - 1; i >= 0; i--) {
								if (asistencias[i].fecha === self._filtros.fecha && self._in[1].indexOf(asistencias[i].alumno_id) !== -1) asistencias.splice(i, 1);
							}
						}
						return resolver({ data: [], error: null });
					}
					if ((opciones.fallan || []).indexOf(tabla) !== -1) return resolver({ data: null, error: { message: "falla simulada en " + tabla } });
					if (tabla === "grupos") return resolver({ data: [{ id: "g1", nombre: "Grupo QA" }], error: null });
					if (tabla === "alumnos") return resolver({ data: opciones.sinAlumnos ? [] : ALUMNOS, error: null });
					if (tabla === "asistencias") return resolver({ data: asistencias.filter((a) => a.fecha === self._filtros.fecha), error: null });
					return resolver({ data: [], error: null });
				});
			},
		};
		return q;
	}
	const winListeners = {};
	const ventana = {
		sb: {
			auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "m1" } } }, error: null }) },
			from: consulta,
		},
		location: { href: "", reload() {} },
		addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
		confirm: () => true,
		localStorage: { getItem: () => null, setItem() {} },
	};
	ventana.window = ventana;
	const errores = [];
	const ctx = { window: ventana, document: documento, console: { error: (...a) => errores.push(a.join(" ")), log() {} },
		Promise, setTimeout, clearTimeout, Proxy, Error, Array, Object, String, JSON, Date, Number };
	vm.createContext(ctx);
	["leer-todo.js", "lectura.js", "grupo-activo.js", "asistencia.js"].forEach((n) => vm.runInContext(JS(n), ctx, { filename: n }));
	return {
		el, porId, ventana, escrituras, asistencias, errores,
		fallarProxima(n) { fallarEscritura = n || 1; },
		fallarRetiroCierre(n) { fallarRegistro = n || 1; },
		arrancar() { (docListeners.DOMContentLoaded || []).forEach((f) => f({})); return espera(40); },
		tocar(alumno, valor) {
			const btn = { dataset: { alumno: alumno, valor: valor } };
			el("attendanceList")._l.click.forEach((f) => f({ target: { closest: () => btn } }));
		},
		todosPresentes() { el("markAllPresentBtn")._l.click.forEach((f) => f({})); },
		cambiarFecha(f) { el("attendanceDateInput").value = f; el("attendanceDateInput")._l.change.forEach((fn) => fn({})); },
	};
}

const lista = (e) => e.el("attendanceList").innerHTML;
const activo = (e, alumno, valor) => new RegExp("data-alumno='" + alumno + "' data-valor='" + valor + "' aria-pressed='true'").test(lista(e));

(async function () {
	// ── Al abrir ─────────────────────────────────────────────────────────────
	{
		const e = escenario({ asistencias: [{ alumno_id: "al-1", fecha: HOY, asistencia_estado: "presente" }] });
		await e.arrancar();
		ok("abre sin errores en consola", e.errores.length === 0, e.errores[0]);
		ok("dibuja a los tres alumnos con sus tres opciones", ["ANA", "BETO", "CARLA"].every((n) => lista(e).indexOf(n) !== -1) &&
			(lista(e).match(/data-valor='ausente'/g) || []).length === 3);
		ok("lo guardado sale marcado (ANA presente)", activo(e, "al-1", "presente"));
		ok("sin fila = sin registro, NO falta", !activo(e, "al-2", "ausente") && (lista(e).match(/sin registro/g) || []).length === 2);
		ok("el resumen cuenta a los sin registro aparte", /Presentes: 1 \| Faltas: 0 \| Justificadas: 0 \| Sin registro: 2 \| Total: 3/.test(e.el("attendanceSummary").textContent), e.el("attendanceSummary").textContent);
		ok("abrir no escribe nada", e.escrituras.length === 0);

		// Tocar Falta: solo ese alumno
		e.tocar("al-2", "ausente");
		await espera(40);
		const up = e.escrituras.filter((w) => w.tabla === "asistencias" && w.op === "upsert");
		ok("Falta guarda SOLO a ese alumno (no a todo el grupo)", up.length === 1 && up[0].filas.length === 1 &&
			up[0].filas[0].alumno_id === "al-2" && up[0].filas[0].asistencia_estado === "ausente" && up[0].filas[0].fecha === HOY);
		const retiro = e.escrituras.filter((w) => w.tabla === "registro_diario" && w.op === "delete");
		ok("una falta retira su cierre 1 y 1 del día (como en Hoy)", retiro.length === 1 && retiro[0].in[1].join() === "al-2" &&
			retiro[0].filtros.participacion === 1 && retiro[0].filtros.conducta === 1 && retiro[0].filtros.fecha === HOY);

		// Volver a tocarla: se quita y se borra
		e.tocar("al-2", "ausente");
		await espera(40);
		const del = e.escrituras.filter((w) => w.tabla === "asistencias" && w.op === "delete");
		ok("volver a tocar la opción marcada BORRA su fila (queda sin registro)", del.length === 1 && del[0].in[1].join() === "al-2" && del[0].filtros.fecha === HOY);
		ok("en la base ya no está", !e.asistencias.some((a) => a.alumno_id === "al-2"));
		ok("en pantalla vuelve a sin registro", !activo(e, "al-2", "ausente") && (lista(e).match(/sin registro/g) || []).length === 2);

		// Presentes los que faltan
		e.tocar("al-3", "justificada");
		await espera(40);
		const n0 = e.escrituras.length;
		e.todosPresentes();
		await espera(40);
		const lote = e.escrituras.slice(n0).filter((w) => w.tabla === "asistencias" && w.op === "upsert");
		ok("\"Presentes los que faltan\" guarda solo a quienes seguían sin registro",
			lote.length === 1 && lote[0].filas.map((f) => f.alumno_id).join() === "al-2" && lote[0].filas[0].asistencia_estado === "presente");
		ok("... y no toca la justificada de CARLA", e.asistencias.find((a) => a.alumno_id === "al-3").asistencia_estado === "justificada");
	}

	// ── Defecto 7: tocar y cambiar de fecha enseguida ─────────────────────────
	{
		const e = escenario({ lento: 30 });
		await e.arrancar();
		await espera(80);
		e.tocar("al-1", "presente");
		e.cambiarFecha(AYER);
		await espera(300);
		const asis = e.escrituras.filter((w) => w.tabla === "asistencias");
		ok("el guardado pendiente lleva SU fecha y SU alumno", asis.length === 1 && asis[0].filas.length === 1 &&
			asis[0].filas[0].fecha === HOY && asis[0].filas[0].alumno_id === "al-1", JSON.stringify(asis));
		ok("no se manda ninguna lista del día nuevo", !e.escrituras.some((w) => (w.filas || []).some((f) => f.fecha === AYER)));
		ok("el día nuevo sale con todos sin registro", (lista(e).match(/sin registro/g) || []).length === 3);
		e.cambiarFecha(HOY);
		await espera(200);
		ok("al volver a hoy se ve lo guardado", activo(e, "al-1", "presente"));
	}

	// ── Un guardado que falla ────────────────────────────────────────────────
	{
		const e = escenario({});
		await e.arrancar();
		e.fallarProxima(1);
		e.tocar("al-1", "presente");
		await espera(60);
		ok("si el guardado falla, la pantalla vuelve a lo que tiene la base", !activo(e, "al-1", "presente"));
		ok("... y lo dice", /No se pudo guardar la asistencia/.test(e.el("attendanceMessage").textContent));
	}

	// ── La falta se guarda pero su cierre no se puede quitar ─────────────────
	{
		const e = escenario({});
		await e.arrancar();
		e.fallarRetiroCierre(1);
		e.tocar("al-2", "ausente");
		await espera(60);
		const aviso = e.el("attendanceMessage").textContent;
		ok("el aviso dice de quién es la falta", /BETO/.test(aviso), aviso);
		ok("el aviso ya no pide solo \"volver a marcar la falta\" (tocarla una vez la quita)", !/Vuelve a marcar la falta/.test(aviso), aviso);
		ok("el aviso dice exactamente qué hacer: tocar Falta dos veces", /toca Falta dos veces/.test(aviso) && /el primer toque la quita y el segundo la vuelve a marcar/.test(aviso), aviso);
		ok("la falta sí quedó guardada", activo(e, "al-2", "ausente") && e.asistencias.some((a) => a.alumno_id === "al-2" && a.asistencia_estado === "ausente"));
		// Seguir el aviso: dos toques en Falta → se quita, se vuelve a marcar y se reintenta el retiro
		const n0 = e.escrituras.length;
		e.tocar("al-2", "ausente");
		await espera(40);
		e.tocar("al-2", "ausente");
		await espera(60);
		const retiro = e.escrituras.slice(n0).filter((w) => w.tabla === "registro_diario" && w.op === "delete");
		ok("seguir el aviso vuelve a quitar su cierre", retiro.length === 1 && retiro[0].in[1].join() === "al-2", JSON.stringify(retiro));
		ok("... y la falta queda marcada", activo(e, "al-2", "ausente") && e.asistencias.some((a) => a.alumno_id === "al-2" && a.asistencia_estado === "ausente"));

		// Justificada: el aviso nombra ese botón
		e.fallarRetiroCierre(1);
		e.tocar("al-3", "justificada");
		await espera(60);
		const aviso2 = e.el("attendanceMessage").textContent;
		ok("con Justificada el aviso dice tocar Justificada dos veces", /CARLA/.test(aviso2) && /toca Justificada dos veces/.test(aviso2), aviso2);
	}

	// ── Lecturas en error: aviso común, nada de "no hay alumnos", nada escrito ─
	for (const tabla of ["grupos", "alumnos", "asistencias"]) {
		const e = escenario({ fallan: [tabla] });
		await e.arrancar();
		ok("con " + tabla + " en error: la página se detiene con el aviso", e.ventana.Lectura.detenida() && !!e.porId.lecturaAviso);
		ok("con " + tabla + " en error: no dice que no hay alumnos", !/no tiene alumnos/.test(lista(e)));
		e.tocar("al-1", "presente");
		e.todosPresentes();
		await espera(40);
		ok("con " + tabla + " en error: no escribe nada aunque se toque", e.escrituras.length === 0);
	}

	// Cambiar de fecha con la lectura del nuevo día en error
	{
		const e = escenario({});
		await e.arrancar();
		e.ventana.sb.from = (function (orig) {
			return function (t) {
				const q = orig(t);
				if (t === "asistencias") { const th = q.then; q.then = function (r) { return this._op === "select" ? Promise.resolve(r({ data: null, error: { message: "falla" } })) : th.call(this, r); }; }
				return q;
			};
		})(e.ventana.sb.from);
		e.cambiarFecha(AYER);
		await espera(60);
		ok("con la lectura del día nuevo en error: se detiene (no muestra el día vacío)", e.ventana.Lectura.detenida());
	}

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
