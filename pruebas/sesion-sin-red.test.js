/*
	Error al comprobar la sesión (js/lectura.js, un solo lugar para todas las páginas).

	Si auth.getUser o auth.getSession fallan por red o por el servidor (5xx), NO es "sin
	sesión": la página se detiene con el aviso común ("No se pudo comprobar tu sesión",
	Reintentar) y la maestra no sale. Sin sesión de verdad (user null sin error, sesión
	ausente, token vencido 4xx) sigue mandando al login. Se ejecutan los archivos reales
	(lectura.js, saas-guard.js y el arranque de una página, section-shell.js) en un DOM
	mínimo con un Supabase falso. Además:
	  - el cliente real no cambia: supabase-js sigue pidiendo su token con su propio auth
	    (un refresco que falla en medio de un guardado no detiene la página);
	  - una excepción dentro del candado ya no expulsa: avisa.

	node pruebas/sesion-sin-red.test.js
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle !== undefined ? " → " + detalle : ""));
}
const JS = (n) => fs.readFileSync(path.join(__dirname, "..", "js", n), "utf8").replace(/^﻿/, "");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function crearDom() {
	const porId = {};
	function el(tag, id) {
		const e = {
			tagName: tag.toUpperCase(), nodeType: 1, style: {}, children: [], _attrs: {}, _listeners: {}, textContent: "", innerHTML: "",
			setAttribute(k, v) { this._attrs[k] = String(v); if (k === "id") { this.id = v; } },
			getAttribute(k) { return this._attrs[k]; },
			appendChild(h) { this.children.push(h); if (h.id) porId[h.id] = h; return h; },
			addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
		};
		Object.defineProperty(e, "id", { get() { return this._id || ""; }, set(v) { this._id = v; if (v) porId[v] = this; }, configurable: true });
		if (id) e.id = id;
		return e;
	}
	const body = el("body");
	["app-navbar", "contenido"].forEach((id) => body.appendChild(el("div", id)));
	const listeners = {};
	return {
		porId,
		documento: {
			body, documentElement: { style: { visibility: "" } },
			createElement: (t) => el(t), getElementById: (id) => porId[id] || null,
			addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
			_disparar(ev) { (listeners[ev] || []).forEach((f) => f({})); },
		},
	};
}

/*
	auth: { user: {...}|null, error: {...}|null, lanza: Error } para getUser y getSession
	perfil: "lanza" hace que la lectura de perfiles lance dentro del candado
*/
function escenario(auth, opciones) {
	opciones = opciones || {};
	const { documento, porId } = crearDom();
	const lecturas = [];
	function consulta(tabla) {
		lecturas.push(tabla);
		const q = {
			select() { return q; }, eq() { return q; },
			maybeSingle() {
				if (opciones.perfil === "lanza") throw new TypeError("x is not a function");
				return Promise.resolve({ data: { activo_saas: true }, error: null });
			},
			then(r) { return Promise.resolve({ data: [], error: null }).then(r); },
		};
		return q;
	}
	function respuesta(tipo) {
		if (auth.lanza) return Promise.reject(auth.lanza);
		if (tipo === "user") return Promise.resolve({ data: { user: auth.user || null }, error: auth.error || null });
		return Promise.resolve({ data: { session: auth.user ? { user: auth.user } : null }, error: auth.error || null });
	}
	const authReal = {
		getUser: () => respuesta("user"),
		getSession: () => respuesta("session"),
		onAuthStateChange() {}, signOut() { return Promise.resolve({ error: null }); },
	};
	const cliente = { auth: authReal, from: consulta, rpc: () => Promise.resolve({ data: null, error: null }) };
	const ventana = {
		sb: cliente,
		location: { href: "pagina.html", replace(u) { this.href = u; } },
		addEventListener() {},
		localStorage: { getItem: () => null, setItem() {} },
	};
	ventana.window = ventana;
	const errores = [];
	const ctx = {
		window: ventana, document: documento, console: { error: (...a) => errores.push(a.join(" ")), warn() {}, log() {} },
		Promise, setTimeout, clearTimeout, Proxy, Error, TypeError, Array, Object, String, JSON, Date, Number, Reflect,
	};
	vm.createContext(ctx);
	["lectura.js", "saas-guard.js", "section-shell.js"].forEach((n) => vm.runInContext(JS(n), ctx, { filename: n }));
	return {
		ventana, porId, cliente, authReal, lecturas, errores,
		arrancarPagina() { documento._disparar("DOMContentLoaded"); return espera(40); },
		aviso() { const c = porId.lecturaAviso; return c ? c.children.map((h) => h.textContent).join(" | ") : ""; },
		detenida() { return ventana.Lectura.detenida(); },
		visible() { return documento.documentElement.style.visibility !== "hidden"; },
	};
}

const USUARIO = { id: "m1", email: "qa@x.mx", user_metadata: {} };

(async function () {
	const casosDeRed = [
		["sin red (AuthRetryableFetchError, status 0)", { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }],
		["servidor caído (503)", { name: "AuthRetryableFetchError", status: 503, message: "Service Unavailable" }],
		["error 500 del servidor", { name: "AuthApiError", status: 500, message: "Internal Server Error" }],
		["fallo de fetch sin status", { name: "TypeError", message: "Failed to fetch" }],
	];
	for (const [nombre, error] of casosDeRed) {
		const e = escenario({ user: null, error: error });
		await e.arrancarPagina();
		ok(nombre + ": no manda al login ni a la tienda", e.ventana.location.href === "pagina.html", e.ventana.location.href);
		ok(nombre + ": la página se detiene con el aviso común", e.detenida() && /No se pudo comprobar tu sesión/.test(e.aviso()) && /Reintentar/.test(e.aviso()), e.aviso());
		ok(nombre + ": el aviso queda visible (el candado ocultaba la página)", e.visible());
		ok(nombre + ": el perfil no se llega a leer", e.lecturas.indexOf("perfiles") === -1);
	}
	{
		const e = escenario({ lanza: new TypeError("Failed to fetch") });
		await e.arrancarPagina();
		ok("getUser/getSession que LANZAN por red: tampoco saca a la maestra", e.ventana.location.href === "pagina.html" && e.detenida(), e.ventana.location.href);
	}

	// Sin sesión de verdad: sigue mandando al login
	const sinSesion = [
		["user null sin error", { user: null, error: null }],
		["sesión ausente (AuthSessionMissingError)", { user: null, error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" } }],
		["token vencido (401)", { user: null, error: { name: "AuthApiError", status: 401, message: "invalid JWT" } }],
	];
	for (const [nombre, auth] of sinSesion) {
		const e = escenario(auth);
		await e.arrancarPagina();
		ok(nombre + ": manda al login", /login\.html|index\.html/.test(e.ventana.location.href), e.ventana.location.href);
		ok(nombre + ": sin aviso de conexión", !/No se pudo comprobar tu sesión/.test(e.aviso()));
	}

	// Con sesión: pasa y la página arranca
	{
		const e = escenario({ user: USUARIO, error: null });
		await e.arrancarPagina();
		ok("con sesión: pasa (visible, sin aviso, sin redirigir)", e.visible() && !e.detenida() && e.ventana.location.href === "pagina.html");
		ok("con sesión: el perfil se lee", e.lecturas.indexOf("perfiles") !== -1);
		// El cliente real no cambia: supabase-js pide su token con su propio auth
		ok("el cliente real conserva su auth (llamadas internas de supabase-js sin envolver)", e.cliente.auth === e.authReal);
		ok("window.sb sigue leyendo", typeof e.ventana.sb.from("alumnos").select === "function");
		ok("window.sb.auth sigue dando las demás funciones", typeof e.ventana.sb.auth.onAuthStateChange === "function");
		ok("Lectura.authDirecto es el auth sin envolver", e.ventana.Lectura.authDirecto === e.authReal);
	}

	// Una excepción dentro del candado: avisa, no expulsa
	{
		const e = escenario({ user: USUARIO, error: null }, { perfil: "lanza" });
		await e.arrancarPagina();
		ok("excepción en el candado: no expulsa al login", e.ventana.location.href === "pagina.html", e.ventana.location.href);
		ok("excepción en el candado: aviso con Reintentar", e.detenida() && /Reintentar/.test(e.aviso()), e.aviso());
	}

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
