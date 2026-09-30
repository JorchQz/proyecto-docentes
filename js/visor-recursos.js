/*
	visor-recursos.js — Visor de los libros de texto de una sesión: el docente ve la página del libro
	SIN salir de Hoy ni de Inicio.

	  - SOLO los libros de CONALITEG se abren aquí, por https (esa página responde sin X-Frame-Options).
	    Los enlaces de Drive (archivo, carpeta, Docs, Slides) y de cualquier otro sitio se abren en otra
	    pestaña, sin visor (decisión de Jorge del 2026-09-29): dentro de un marco, Drive muestra el login
	    de Google si el archivo no es público o si el navegador bloquea las cookies de terceros.
	  - Desde 1024 px de ancho es un panel a la derecha con la pantalla dividida (la página se hace
	    a un lado; se sigue calificando mientras se ve el libro). Abajo de 1024 px es pantalla completa.
	  - Siempre están "Abrir aparte" y "Cerrar". Si en 8 s no carga, dice "¿No se ve? Ábrelo aparte".
	  - Un enlace con data-visor-url (los libros de la secuencia de la sesión, js/secuencia-sesion.js)
	    abre aquí con un toque normal; con Ctrl, Cmd, Mayús o botón del medio se abre como enlace común.
	    Si la dirección no es de un libro, el visor no la abre y el enlace se abre en otra pestaña.

	Expone window.VisorRecursos (y module.exports para las pruebas):
	  urlEmbebible(url) → { tipo, src, embebible, aparte } (funciones puras: se prueban en node)
	  abrir({ url, titulo, origen }) · cerrar() · abierto()
*/

(function () {
	"use strict";

	var ESPERA_MS = 8000;

	function soloHttp(url) {
		var u = String(url === null || url === undefined ? "" : url).trim();
		return /^https?:\/\//i.test(u) ? u : null;
	}

	/*
		urlEmbebible(url) → { tipo: "libro" | "otro", src, embebible, aparte }
		src: lo que va dentro del visor; aparte: la dirección para abrirlo en otra pestaña (la de siempre;
		la del libro, con https). Solo un libro de CONALITEG es embebible: Drive, Google Docs y cualquier
		otro sitio son "otro" y se abren en otra pestaña. Solo http y https: cualquier otro esquema
		(javascript:, data:) no es embebible ni se abre (aparte null).
	*/
	function urlEmbebible(url) {
		var u = soloHttp(url);
		if (!u) return { tipo: "otro", src: null, embebible: false, aparte: null };
		// Libros de texto gratuitos (CONALITEG): por https dentro del visor, con su página (#page/N)
		if (/^https?:\/\/(?:[\w-]+\.)*conaliteg\.(?:gob|sep\.gob)\.mx(?:[/?#:]|$)/i.test(u)) {
			var https = u.replace(/^http:/i, "https:");
			return { tipo: "libro", src: https, embebible: true, aparte: https };
		}
		return { tipo: "otro", src: null, embebible: false, aparte: u };
	}

	// ── Panel ───────────────────────────────────────────────────────────────────
	var panel = null, marco = null, aviso = null, temporizador = null, origenAnterior = null;

	function estilos() {
		if (document.getElementById("visorEstilos")) return;
		var s = document.createElement("style");
		s.id = "visorEstilos";
		s.textContent =
			":root{--visor-ancho:clamp(420px,44vw,720px)}" +
			".jz-visor{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:#fff;font-family:inherit}" +
			".jz-visor[hidden]{display:none}" +
			".jz-visor-barra{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;min-height:52px;background:#1e3a8a;color:#fff}" +
			".jz-visor-titulo{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".jz-visor-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff}" +
			".jz-visor-btn:hover{background:rgba(255,255,255,.14)}" +
			".jz-visor-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
			".jz-visor-aviso{padding:8px 12px;background:#fef3c7;color:#78350f;font-size:13px;border-bottom:1px solid #fcd34d}" +
			".jz-visor-aviso a{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;color:#78350f;font-weight:700;text-decoration:underline}" +
			".jz-visor-pista{padding:4px 12px;background:#eff6ff;color:#1e3a8a;font-size:12px;border-bottom:1px solid #bfdbfe}" +
			".jz-visor-cuerpo{position:relative;flex:1;min-height:0;background:#f3f4f6}" +
			".jz-visor-cuerpo iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}" +
			"@media (min-width:1024px){" +
			".jz-visor{inset:0 0 0 auto;width:var(--visor-ancho);border-left:1px solid #cbd5e1;box-shadow:-12px 0 32px -18px rgba(15,23,42,.5)}" +
			"html.jz-visor-dividido body{margin-right:var(--visor-ancho)}" +
			"html.jz-visor-dividido .fixed.inset-x-4{right:calc(var(--visor-ancho) + 1rem)}" +
			"}";
		document.head.appendChild(s);
	}

	function crear() {
		estilos();
		panel = document.createElement("aside");
		panel.id = "visorRecursos";
		panel.className = "jz-visor";
		panel.hidden = true;
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "Visor de libros");
		panel.innerHTML =
			"<div class='jz-visor-barra'>" +
			"<p class='jz-visor-titulo' data-visor-titulo></p>" +
			"<a class='jz-visor-btn' data-visor-aparte target='_blank' rel='noopener noreferrer'>Abrir aparte</a>" +
			"<button type='button' class='jz-visor-btn' data-visor-cerrar>Cerrar</button>" +
			"</div>" +
			"<p class='jz-visor-pista' data-visor-pista>Para volver usa «Cerrar». La tecla Esc solo funciona fuera del libro.</p>" +
			"<div class='jz-visor-aviso' data-visor-aviso hidden role='status'>¿No se ve? <a data-visor-aparte-2 target='_blank' rel='noopener noreferrer'>Ábrelo aparte</a></div>" +
			"<div class='jz-visor-cuerpo'></div>";
		document.body.appendChild(panel);
		aviso = panel.querySelector("[data-visor-aviso]");
		panel.querySelector("[data-visor-cerrar]").addEventListener("click", cerrar);
		panel.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { e.stopPropagation(); cerrar(); }
		});
	}

	function abierto() { return !!(panel && !panel.hidden); }

	function cerrar() {
		if (!panel) return;
		if (temporizador) { clearTimeout(temporizador); temporizador = null; }
		if (marco && marco.parentNode) marco.parentNode.removeChild(marco);
		marco = null;
		panel.hidden = true;
		document.documentElement.classList.remove("jz-visor-dividido");
		var o = origenAnterior;
		origenAnterior = null;
		if (o && o.focus && document.contains(o)) { try { o.focus(); } catch (_) { /* sin foco */ } }
	}

	/*
		abrir({ url, titulo, origen }): muestra el libro dentro. Si no es un libro (Drive, otro sitio,
		esquema raro) devuelve false y quien llama lo abre como enlace común (otra pestaña).
	*/
	function abrir(op) {
		op = op || {};
		var r = urlEmbebible(op.url);
		if (!r.embebible) return false;
		if (!panel) crear();
		if (!abierto()) origenAnterior = op.origen || document.activeElement;
		if (temporizador) { clearTimeout(temporizador); temporizador = null; }
		if (marco && marco.parentNode) marco.parentNode.removeChild(marco);
		panel.querySelector("[data-visor-titulo]").textContent = op.titulo || "Libro de la sesión";
		panel.querySelector("[data-visor-aparte]").setAttribute("href", r.aparte);
		panel.querySelector("[data-visor-aparte-2]").setAttribute("href", r.aparte);
		// El aviso "¿No se ve?" sale solo si a los 8 s el libro no cargó
		aviso.hidden = true;
		marco = document.createElement("iframe");
		marco.title = op.titulo || "Libro de la sesión";
		marco.setAttribute("loading", "eager");
		// Sin sandbox: el visor de libros de CONALITEG no dibuja sus páginas dentro de un marco con sandbox
		// (comprobado con el mismo libro con y sin el atributo); es el sitio del gobierno y lo único que se
		// muestra aquí.
		marco.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
		marco.addEventListener("load", function () {
			if (temporizador) { clearTimeout(temporizador); temporizador = null; }
			aviso.hidden = true;
			panel.setAttribute("data-visor-cargado", "1");
		});
		panel.removeAttribute("data-visor-cargado");
		// El src va ANTES de insertarlo: un iframe sin src dispara "load" (de about:blank) al insertarse y
		// eso apagaría el aviso de los 8 s aunque el recurso nunca cargue
		marco.src = r.src;
		panel.querySelector(".jz-visor-cuerpo").appendChild(marco);
		panel.hidden = false;
		panel.setAttribute("data-visor-tipo", r.tipo);
		document.documentElement.classList.add("jz-visor-dividido");
		// Si en 8 s no cargó: "¿No se ve? Ábrelo aparte" (Abrir aparte y Cerrar siguen a la vista)
		temporizador = setTimeout(function () {
			temporizador = null;
			if (abierto() && !panel.hasAttribute("data-visor-cargado")) aviso.hidden = false;
		}, ESPERA_MS);
		var cerrarBtn = panel.querySelector("[data-visor-cerrar]");
		if (cerrarBtn && cerrarBtn.focus) { try { cerrarBtn.focus({ preventScroll: true }); } catch (_) { /* sin foco */ } }
		return true;
	}

	// Un toque normal en un enlace con data-visor-url lo abre aquí; con Ctrl, Cmd, Mayús o botón del
	// medio se deja el comportamiento común del enlace (otra pestaña)
	if (typeof document !== "undefined" && document.addEventListener) {
		document.addEventListener("click", function (e) {
			if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			var a = e.target && e.target.closest ? e.target.closest("a[data-visor-url]") : null;
			if (!a) return;
			var url = a.getAttribute("data-visor-url") || a.getAttribute("href");
			if (abrir({ url: url, titulo: a.getAttribute("data-visor-titulo") || a.textContent.trim(), origen: a })) e.preventDefault();
		});
	}

	var api = { ESPERA_MS: ESPERA_MS, urlEmbebible: urlEmbebible, abrir: abrir, cerrar: cerrar, abierto: abierto };
	if (typeof window !== "undefined") window.VisorRecursos = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
