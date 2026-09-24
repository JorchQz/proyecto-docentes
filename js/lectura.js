/*
	lectura.js — La capa de lectura común de todas las páginas del SaaS.

	Tres revisiones seguidas (3.7) encontraron lo mismo en pantallas distintas: una lectura
	de Supabase falla, la pantalla ignora el error y afirma algo falso ("no hay alumnos",
	"0 alumnos", "no tienes proyecto activo") o guarda encima de lo que no pudo leer. Aquí
	se decide UNA vez qué pasa cuando una lectura falla, en lugar de que cada página lo
	decida a su manera:

	  Lectura.uno(consulta)            → data de la consulta; si trae error, LO LANZA
	  Lectura.contar(consulta)         → el count (select con { count, head }); lanza
	  Lectura.todas(construir)         → todas las filas, por páginas (js/leer-todo.js); lanza
	  Lectura.porLotes(ids, construir) → igual, partiendo la lista de ids; lanza

	  Lectura.arrancar(async fn)       → arranque común de página: si fn lanza, detiene
	  Lectura.detenerPagina(error)     → aviso "No se pudo cargar" con Reintentar

	Detener la página:
	  - oculta el contenido (sin borrarlo: el script de la página puede seguir teniendo
	    referencias a sus elementos y no debe tronar) y deja solo la barra y el aviso;
	  - desde ese momento window.sb.from/rpc devuelven una consulta que nunca termina:
	    nada de lo que la página tuviera en vuelo o pendiente (un autoguardado, una cola)
	    llega a escribir, ni dibuja datos a medias como si estuvieran completos.

	Un error de lectura que nadie atrapó (una promesa rechazada con un error marcado por
	esta capa o por LeerTodo) también detiene la página, en vez de quedar como excepción
	sin atrapar. GrupoActivo.cargar (js/grupo-activo.js) y el candado (js/saas-guard.js)
	usan esta capa: una página que no pudo leer su grupo o comprobar el acceso se detiene
	aquí, sin tener que manejarlo ella.

	Se carga justo después de js/supabase.js y antes de js/saas-guard.js.

	Lectura.antesDeSalir({ pendiente, guardar }) → para las pantallas que capturan: al
	salir por un enlace con algo sin guardar, primero lo guarda; si no se pudo, pregunta.
	Al cerrar o recargar, el navegador pregunta.
*/

(function () {
	"use strict";

	var detenida = false;
	var avisoTodo = false;
	var sb = typeof window !== "undefined" ? window.sb : null;
	var fromDirecto = sb && sb.from ? sb.from.bind(sb) : null;
	var rpcDirecto = sb && sb.rpc ? sb.rpc.bind(sb) : null;

	// ── Errores de lectura ────────────────────────────────────────────────────
	function errorDeLectura(causa) {
		if (causa && causa.lectura) return causa;
		var e = new Error((causa && causa.message) || "No se pudo leer de la base de datos");
		e.lectura = true;
		e.causa = causa || null;
		if (causa && causa.code) e.code = causa.code;
		return e;
	}

	async function uno(consulta) {
		var res = await consulta;
		if (!res || res.error) throw errorDeLectura(res ? res.error : null);
		return res.data;
	}

	async function contar(consulta) {
		var res = await consulta;
		if (!res || res.error) throw errorDeLectura(res ? res.error : null);
		if (typeof res.count !== "number") throw errorDeLectura({ message: "La base no devolvió el conteo" });
		return res.count;
	}

	async function todas(construir) {
		try {
			return await window.LeerTodo.paginas(construir);
		} catch (e) {
			throw errorDeLectura(e);
		}
	}

	async function porLotes(ids, construir) {
		try {
			return await window.LeerTodo.porLotes(ids, construir);
		} catch (e) {
			throw errorDeLectura(e);
		}
	}

	// ── Consulta inerte: la página ya se detuvo ───────────────────────────────
	// Cualquier cadena (.select().eq().upsert()...) devuelve la misma consulta, y esperar
	// su resultado nunca termina: ni lee ni escribe, ni avisa "no hay nada".
	function inerte() {
		var q = new Proxy(function () {}, {
			get: function (_, clave) {
				if (clave === "then") return function () { return new Promise(function () {}); };
				if (clave === "catch" || clave === "finally") return function () { return new Promise(function () {}); };
				return function () { return q; };
			},
			apply: function () { return q; },
		});
		return q;
	}

	if (sb && fromDirecto) {
		sb.from = function (tabla) { return detenida ? inerte() : fromDirecto(tabla); };
		if (rpcDirecto) sb.rpc = function () { return detenida ? inerte() : rpcDirecto.apply(null, arguments); };
	}

	// ── El aviso ──────────────────────────────────────────────────────────────
	var TITULO = "No se pudo cargar esta página";
	var TEXTO = "Revisa tu conexión y vuelve a intentarlo. Mientras tanto no se muestra ni se guarda nada, para no dejar datos a medias.";
	var observador = null;

	function ocultar(el, todo) {
		if (!el || el.id === "lecturaAviso" || el.tagName === "SCRIPT") return;
		if (!todo && el.id === "app-navbar") return;
		if (el.style) el.style.display = "none";
		if (el.setAttribute) el.setAttribute("aria-hidden", "true");
	}

	function pintar(titulo, texto, todo) {
		var body = document.body;
		if (!body) return;
		Array.prototype.forEach.call(body.children, function (el) { ocultar(el, todo); });
		// Lo que la página agregue después (un toast, un modal) tampoco se ve
		if (!observador && typeof MutationObserver !== "undefined") {
			observador = new MutationObserver(function (cambios) {
				cambios.forEach(function (c) {
					Array.prototype.forEach.call(c.addedNodes || [], function (n) {
						if (n.nodeType === 1) ocultar(n, avisoTodo);
					});
				});
			});
			observador.observe(body, { childList: true });
		}
		var caja = document.getElementById("lecturaAviso");
		if (!caja) {
			caja = document.createElement("div");
			caja.id = "lecturaAviso";
			caja.setAttribute("role", "alert");
			body.appendChild(caja);
		}
		caja.setAttribute("style", "max-width:28rem;margin:6rem auto 2rem;padding:1.5rem;font-family:system-ui,sans-serif;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08)");
		caja.textContent = "";
		caja.appendChild(elemento("p", "font-size:1.1rem;font-weight:600;color:#1f2937;margin:0 0 .5rem", titulo));
		caja.appendChild(elemento("p", "color:#4b5563;margin:0 0 1rem;line-height:1.45", texto));
		var boton = elemento("button", "min-height:44px;padding:0 1.25rem;border-radius:.75rem;background:#2563eb;color:#fff;font-weight:600;border:0;cursor:pointer", "Reintentar");
		boton.setAttribute("type", "button");
		boton.id = "lecturaReintentar";
		boton.addEventListener("click", function () { window.location.reload(); });
		caja.appendChild(boton);
	}

	function elemento(tag, estilo, texto) {
		var el = document.createElement(tag);
		el.setAttribute("style", estilo);
		el.textContent = texto;
		return el;
	}

	/*
		detenerPagina(error, opciones)
		  opciones.todo    → oculta también la barra (el candado no pudo comprobar el acceso)
		  opciones.titulo / opciones.texto → otro texto para el aviso
		  opciones.mostrar → vuelve visible la página (el candado la oculta mientras valida)
		Se puede llamar varias veces: la primera pinta el aviso; una con `todo` lo amplía.
	*/
	function detenerPagina(error, opciones) {
		opciones = opciones || {};
		var yaDetenida = detenida;
		detenida = true;
		if (yaDetenida && !(opciones.todo && !avisoTodo)) return;
		if (opciones.todo) avisoTodo = true;
		if (error) console.error("lectura: la página se detuvo porque una lectura falló", error);
		var titulo = opciones.titulo || TITULO;
		var texto = opciones.texto || TEXTO;
		function hacer() {
			pintar(titulo, texto, avisoTodo);
			if (opciones.mostrar) document.documentElement.style.visibility = "";
		}
		if (document.body) hacer(); else document.addEventListener("DOMContentLoaded", hacer);
	}

	// Arranque común: todo el arranque de una página va dentro; si algo lanza, se detiene
	function arrancar(fn) {
		return Promise.resolve().then(fn).catch(function (e) { detenerPagina(e || new Error("error al cargar")); });
	}

	// Un error de lectura que nadie atrapó: se detiene la página en vez de quedar suelto
	if (typeof window !== "undefined" && window.addEventListener) {
		window.addEventListener("unhandledrejection", function (ev) {
			var r = ev && ev.reason;
			if (r && r.lectura) {
				if (ev.preventDefault) ev.preventDefault();
				detenerPagina(r);
			}
		});
	}

	// ── Salir con capturas pendientes ─────────────────────────────────────────
	var saliendo = false;
	function antesDeSalir(o) {
		window.addEventListener("beforeunload", function (e) {
			if (saliendo || detenida || !o.pendiente()) return;
			if (o.guardar) { try { o.guardar(); } catch (_) {} }
			e.preventDefault();
			e.returnValue = "";
		});
		// Un enlace interno (la barra, "Volver"): primero se guarda y luego se sale
		document.addEventListener("click", function (e) {
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
			if (!a || (a.target && a.target !== "_self")) return;
			var href = a.getAttribute("href") || "";
			if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href)) return;
			if (detenida || !o.pendiente()) return;
			e.preventDefault();
			Promise.resolve(o.guardar ? o.guardar() : false).then(function (r) { return r; }, function () { return false; })
				.then(function (bien) {
					if (bien && !o.pendiente()) { saliendo = true; window.location.href = a.href; return; }
					var texto = typeof o.mensaje === "function" ? o.mensaje() : o.mensaje;
					if (window.confirm(texto || "No se pudo guardar lo último que capturaste. ¿Salir de todos modos?")) {
						saliendo = true;
						window.location.href = a.href;
					}
				});
		}, true);
	}

	var api = {
		uno: uno,
		contar: contar,
		todas: todas,
		porLotes: porLotes,
		errorDeLectura: errorDeLectura,
		arrancar: arrancar,
		detenerPagina: detenerPagina,
		detenida: function () { return detenida; },
		antesDeSalir: antesDeSalir,
		// Solo para el candado: su lectura no debe quedar colgada si la página ya se detuvo
		fromDirecto: function (tabla) { return fromDirecto(tabla); },
	};
	if (typeof window !== "undefined") window.Lectura = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
