/*
	La capa de lectura común (js/lectura.js) y quienes se apoyan en ella: el grupo activo
	(js/grupo-activo.js) y el candado (js/saas-guard.js). 3.7.

	Se ejecutan los archivos reales en un DOM mínimo con un Supabase falso y se comprueba:
	  - Lectura.uno / contar / todas LANZAN el error (marcado como de lectura), nunca
	    devuelven vacío;
	  - detenerPagina oculta el contenido sin borrarlo (el script de la página no truena),
	    deja la barra, pinta "No se pudo cargar" con Reintentar, y desde ese momento ninguna
	    lectura ni escritura sale (la consulta nunca termina);
	  - el arranque común y un error de lectura sin atrapar detienen la página;
	  - GrupoActivo.cargar con la lectura en error: la pantalla que lo espera no sigue (ni
	    excepción, ni "crea tu grupo", ni datos de todos los grupos) y la página se detiene;
	    la carga automática del selector de la barra NO detiene la página (Ajustes no usa
	    el grupo);
	  - el candado sin poder leer perfiles: detiene la página (también la barra), la vuelve
	    visible con su aviso y el script de la página ya no puede leer ni escribir.

	node pruebas/lectura.test.js
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
// ¿La promesa sigue sin cumplirse después de `ms`?
function colgada(p, ms) {
	let listo = false;
	Promise.resolve(p).then(() => { listo = true; }, () => { listo = true; });
	return espera(ms || 30).then(() => !listo);
}

// ── DOM mínimo ───────────────────────────────────────────────────────────────
function crearDom() {
	const porId = {};
	function el(tag, id) {
		const e = {
			tagName: tag.toUpperCase(), nodeType: 1, id: id || "", style: {}, children: [], _attrs: {}, _listeners: {},
			textContent: "", innerHTML: "",
			setAttribute(k, v) { this._attrs[k] = String(v); if (k === "id") { this.id = v; porId[v] = this; } },
			getAttribute(k) { return this._attrs[k]; },
			appendChild(h) { this.children.push(h); if (h.id) porId[h.id] = h; return h; },
			addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
			click() { (this._listeners.click || []).forEach((f) => f({})); },
		};
		Object.defineProperty(e, "id", {
			get() { return this._id || ""; },
			set(v) { this._id = v; if (v) porId[v] = this; },
			configurable: true,
		});
		if (id) e.id = id;
		return e;
	}
	const body = el("body");
	["app-navbar", "contenido", "otro"].forEach((id) => body.appendChild(el(id === "app-navbar" ? "nav" : "div", id)));
	const listeners = {};
	const documento = {
		body,
		documentElement: { style: { visibility: "" } },
		createElement: (t) => el(t),
		getElementById: (id) => porId[id] || null,
		addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
		_disparar(ev) { (listeners[ev] || []).forEach((f) => f({})); },
	};
	return { documento, body, porId };
}

// ── Supabase falso ───────────────────────────────────────────────────────────
function crearSb(opciones) {
	const registro = { lecturas: [], escrituras: [] };
	function consulta(tabla) {
		const q = {
			_escribe: false, _count: false,
			select(_, o) { if (o && o.count) this._count = true; return this; },
			eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; },
			maybeSingle() { this._uno = true; return this; }, single() { this._uno = true; return this; },
			range(a, b) { this._rango = [a, b]; return this; },
			upsert() { this._escribe = true; return this; }, insert() { this._escribe = true; return this; },
			update() { this._escribe = true; return this; }, delete() { this._escribe = true; return this; },
			then(resolver) {
				(this._escribe ? registro.escrituras : registro.lecturas).push(tabla);
				if (!this._escribe && (opciones.fallan || []).indexOf(tabla) !== -1) {
					return Promise.resolve(resolver({ data: null, error: { message: "falla simulada en " + tabla, code: "XX000" } }));
				}
				const filas = (opciones.datos || {})[tabla] || [];
				if (this._count) return Promise.resolve(resolver({ data: null, count: filas.length, error: null }));
				if (this._uno) return Promise.resolve(resolver({ data: filas[0] || null, error: null }));
				return Promise.resolve(resolver({ data: this._rango ? filas.slice(this._rango[0], this._rango[1] + 1) : filas, error: null }));
			},
		};
		return q;
	}
	return {
		registro,
		sb: {
			auth: {
				getUser: () => Promise.resolve({ data: { user: { id: "m1" } }, error: null }),
				getSession: () => Promise.resolve({ data: { session: { user: { id: "m1" } } }, error: null }),
			},
			from: (t) => consulta(t),
			rpc: () => consulta("rpc"),
		},
	};
}

// Un contexto nuevo por escenario (cada página es un documento nuevo)
function entorno(opciones) {
	const { documento, body, porId } = crearDom();
	const { sb, registro } = crearSb(opciones || {});
	const winListeners = {};
	const errores = [];
	const ventana = {
		sb,
		location: { href: "", reload() { this.recargada = true; }, replace(u) { this.href = u; } },
		addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
		confirm: () => true,
	};
	const ctx = {
		window: ventana, document: documento, console: { error: (...a) => errores.push(a.join(" ")), log() {} },
		Promise, setTimeout, clearTimeout, Proxy, Error, Array, Object, String, JSON,
	};
	ventana.window = ventana;
	vm.createContext(ctx);
	const cargar = (n) => vm.runInContext(JS(n), ctx, { filename: n });
	return {
		ctx, ventana, documento, body, porId, registro, errores, cargar,
		disparar(ev, datos) { (winListeners[ev] || []).forEach((f) => f(datos)); },
	};
}

function avisoVisible(e) {
	const caja = e.porId.lecturaAviso;
	return !!caja && caja.children.length === 3 && caja.children[2].textContent === "Reintentar";
}

(async function () {
	// ── 1. Lecturas que lanzan ──────────────────────────────────────────────
	{
		const e = entorno({ fallan: ["alumnos"], datos: { grupos: [{ id: "g1" }], sesiones: [{ id: 1 }, { id: 2 }] } });
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		const L = e.ventana.Lectura;
		const bien = await L.uno(e.ventana.sb.from("grupos").select("*"));
		ok("uno: devuelve los datos", Array.isArray(bien) && bien.length === 1);
		let lanzo = null;
		try { await L.uno(e.ventana.sb.from("alumnos").select("*")); } catch (x) { lanzo = x; }
		ok("uno: con error LANZA (no devuelve vacío) y marcado como de lectura", !!lanzo && lanzo.lectura === true && /falla simulada/.test(lanzo.message));
		ok("contar: devuelve el número", (await L.contar(e.ventana.sb.from("sesiones").select("id", { count: "exact", head: true }))) === 2);
		lanzo = null;
		try { await L.contar(e.ventana.sb.from("alumnos").select("id", { count: "exact", head: true })); } catch (x) { lanzo = x; }
		ok("contar: con error LANZA (antes: \"0 alumnos\")", !!lanzo && lanzo.lectura === true);
		lanzo = null;
		try { await L.todas(() => e.ventana.sb.from("alumnos").select("*").order("id")); } catch (x) { lanzo = x; }
		ok("todas (por páginas): con error LANZA marcado", !!lanzo && lanzo.lectura === true);
		ok("todas: sin error trae todo", (await L.todas(() => e.ventana.sb.from("sesiones").select("*").order("id"))).length === 2);
		ok("sin fallas la página no se detuvo", !L.detenida() && !e.porId.lecturaAviso);
	}

	// ── 2. Detener la página ────────────────────────────────────────────────
	{
		const e = entorno({});
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		const L = e.ventana.Lectura;
		const antes = e.ventana.sb.from("alumnos").select("*");
		L.detenerPagina(new Error("x"));
		ok("detener: pinta el aviso con Reintentar", avisoVisible(e));
		ok("detener: el aviso dice que no se pudo cargar", /No se pudo cargar/.test(e.porId.lecturaAviso.children[0].textContent));
		ok("detener: oculta el contenido sin borrarlo", e.porId.contenido.style.display === "none" && e.body.children.indexOf(e.porId.contenido) !== -1);
		ok("detener: deja la barra de navegación", e.porId["app-navbar"].style.display !== "none");
		e.porId.lecturaReintentar.click();
		ok("detener: Reintentar recarga la página", e.ventana.location.recargada === true);
		ok("detener: una escritura posterior nunca sale ni termina",
			await colgada(e.ventana.sb.from("asistencias").upsert({}).select("id")) && e.registro.escrituras.length === 0);
		ok("detener: una lectura posterior nunca termina (no dibuja datos a medias)", await colgada(e.ventana.sb.from("alumnos").select("*").eq("x", 1)));
		ok("detener: tampoco un rpc", await colgada(e.ventana.sb.rpc("calcular")));
		ok("detener: una consulta armada ANTES termina normal (la cola de la página no queda rota)", !(await colgada(antes)));
		ok("detener: fromDirecto (el candado) sigue funcionando", !(await colgada(L.fromDirecto("perfiles").select("activo_saas"))));
		L.detenerPagina(new Error("y"));
		ok("detener dos veces: un solo aviso", e.body.children.filter((c) => c.id === "lecturaAviso").length === 1);
	}

	// ── 3. Arranque común y error sin atrapar ───────────────────────────────
	{
		const e = entorno({ fallan: ["alumnos"] });
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		const L = e.ventana.Lectura;
		let siguio = false;
		await L.arrancar(async function () {
			await L.uno(e.ventana.sb.from("alumnos").select("*"));
			siguio = true;
		});
		ok("arrancar: una lectura fallida detiene la página", L.detenida() && avisoVisible(e));
		ok("arrancar: el arranque no siguió con datos vacíos", siguio === false);
	}
	{
		const e = entorno({});
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		let prevenido = false;
		e.disparar("unhandledrejection", { reason: e.ventana.Lectura.errorDeLectura({ message: "x" }), preventDefault() { prevenido = true; } });
		ok("error de lectura sin atrapar: detiene la página en vez de quedar como excepción", e.ventana.Lectura.detenida() && prevenido);
		const e2 = entorno({});
		e2.cargar("lectura.js");
		e2.disparar("unhandledrejection", { reason: new Error("otro"), preventDefault() {} });
		ok("un error que no es de lectura no detiene la página", !e2.ventana.Lectura.detenida());
	}

	// ── 4. GrupoActivo.cargar con la lectura en error ───────────────────────
	{
		const e = entorno({ fallan: ["grupos"] });
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		e.cargar("grupo-activo.js");
		let siguio = false, excepcion = null;
		const pantalla = (async function () {
			const r = await e.ventana.GrupoActivo.cargar(e.ventana.sb, "m1");
			siguio = true;
			return r;
		})().catch((x) => { excepcion = x; });
		ok("GrupoActivo en error: la pantalla que lo espera no sigue", await colgada(pantalla, 40) && !siguio);
		ok("GrupoActivo en error: sin excepción para la pantalla", excepcion === null);
		ok("GrupoActivo en error: la página se detiene con el aviso", e.ventana.Lectura.detenida() && avisoVisible(e));
	}
	{
		// La carga automática del selector (pantallas que no usan el grupo, como Ajustes)
		const e = entorno({ fallan: ["grupos"] });
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		e.cargar("grupo-activo.js");
		e.documento._disparar("DOMContentLoaded");
		await espera(30);
		ok("selector de la barra en error: NO detiene la página", !e.ventana.Lectura.detenida() && !e.porId.lecturaAviso);
		ok("selector de la barra en error: la lectura sí se intentó", e.registro.lecturas.indexOf("grupos") !== -1);
	}
	{
		const e = entorno({ datos: { grupos: [{ id: "g1", nombre: "A" }, { id: "g2", nombre: "B" }] } });
		e.cargar("lectura.js");
		e.cargar("grupo-activo.js");
		const r = await e.ventana.GrupoActivo.cargar(e.ventana.sb, "m1");
		ok("GrupoActivo sin error: devuelve el grupo (el primero) y la lista", r.grupo && r.grupo.id === "g1" && r.grupos.length === 2);
	}
	{
		// Sin la capa (una página que no carga js/lectura.js): comportamiento anterior, el error llega
		const e = entorno({ fallan: ["grupos"] });
		e.cargar("grupo-activo.js");
		let error = null;
		try { await e.ventana.GrupoActivo.cargar(e.ventana.sb, "m1"); } catch (x) { error = x; }
		ok("GrupoActivo sin la capa: el error le llega a la pantalla", !!error);
	}

	// ── 5. El candado no pudo leer perfiles ─────────────────────────────────
	{
		const e = entorno({ fallan: ["perfiles"] });
		e.cargar("leer-todo.js");
		e.cargar("lectura.js");
		e.cargar("saas-guard.js");
		ok("candado: oculta la página mientras valida", e.documento.documentElement.style.visibility === "hidden");
		await espera(30);
		ok("candado en error: detiene la página con su aviso", e.ventana.Lectura.detenida() && avisoVisible(e));
		ok("candado en error: el aviso dice que no se pudo comprobar el acceso", /comprobar tu acceso/.test(e.porId.lecturaAviso.children[0].textContent));
		ok("candado en error: oculta también la barra", e.porId["app-navbar"].style.display === "none");
		ok("candado en error: vuelve visible la página (el aviso)", e.documento.documentElement.style.visibility === "");
		ok("candado en error: los elementos de la página siguen ahí (su script no truena)", !!e.documento.getElementById("contenido"));
		ok("candado en error: el script de la página ya no lee ni escribe",
			await colgada(e.ventana.sb.from("alumnos").select("*")) && await colgada(e.ventana.sb.from("asistencias").upsert({})));
		ok("candado en error: no manda a la tienda ni al login", e.ventana.location.href === "");
	}
	{
		// La página se detuvo ANTES de que el candado leyera: su lectura no queda colgada
		const e = entorno({ datos: { perfiles: [{ activo_saas: true }] } });
		e.cargar("lectura.js");
		e.ventana.Lectura.detenerPagina(new Error("grupo"));
		e.cargar("saas-guard.js");
		await espera(30);
		ok("candado tras detener la página: igual valida y la muestra (con el aviso)", e.documento.documentElement.style.visibility === "" && avisoVisible(e));
	}
	{
		const e = entorno({ datos: { perfiles: [{ activo_saas: true }] } });
		e.cargar("lectura.js");
		e.cargar("saas-guard.js");
		await espera(30);
		ok("candado con acceso: muestra la página y no la detiene", e.documento.documentElement.style.visibility === "" && !e.ventana.Lectura.detenida());
	}

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
