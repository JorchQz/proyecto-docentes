/*
	app-instalada.js — Mi Salón como app instalable, "Jissez MS" (docs/PWA-MI-SALON.md, fase 1).

	Va en el <head> de cada página de Mi Salón (antes que nada que dependa de él), junto con el
	manifest (/salon.webmanifest), el theme-color y los meta de Apple.

	- La app vive en /salon/, una ruta virtual que sirve los mismos archivos de la raíz
	  (_redirects). Solo desde páginas bajo /salon/ se registra el service worker (/salon/sw.js,
	  alcance /salon/). Las páginas de la raíz (/hoy, /dashboard...) siguen igual que siempre:
	  sin service worker.
	- Modo app (abierta desde el ícono): display-mode standalone y, en iPhone/iPad, también
	  fullscreen (así lo reporta iOS; WebKit bug 264218) o navigator.standalone; además
	  ?origen=app o ?origen=atajo (el arranque y los atajos del manifest). Pone html.modo-app.
	  El ?origen solo distingue el arranque: no se guarda ni se manda a ningún lado.
	- Botón "Instalar la app": solo con el acceso a Mi Salón confirmado (window.saasAcceso, que
	  cumple el candado) y solo si no está instalada.
	    · Chrome, Edge y Samsung Internet: el aviso del navegador (beforeinstallprompt). Solo
	      llega en páginas bajo /salon/; desde la raíz, el botón lleva a /salon/hoy?instalar=1.
	    · iPhone y iPad: instrucciones (Compartir → Agregar a pantalla de inicio).
	  Lugares: el menú de la cuenta (js/navbar.js, #navbarInstalarBtn) e Inicio
	  (dashboard.html, #instalarAppSlot).
*/
var AppInstalada = (function () {
	var CLAVE_INSTALADA = "jissez.appInstalada"; // se vio instalada en este dispositivo (solo oculta el botón)
	var diferido = null; // el beforeinstallprompt guardado
	var avisos = [];

	// ── Reglas (puras; probadas en pruebas/pwa.test.js) ──────────────────────────
	function enSalon(pathname) {
		return /^\/salon\//.test(String(pathname || ""));
	}

	// ¿Arrancó desde el ícono o un atajo?
	function porOrigen(search) {
		return /[?&]origen=(app|atajo)(&|$)/.test(String(search || ""));
	}

	function esIOS(nav) {
		nav = nav || (typeof navigator !== "undefined" ? navigator : {});
		var ua = String(nav.userAgent || "");
		// iPadOS se presenta como Mac: se distingue por la pantalla táctil
		return /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
	}

	/*
		modoApp({ mm, nav, search, ios }) → ¿la página corre dentro de la app instalada?
		mm(consulta) → matches. fullscreen solo cuenta en iOS: en PC es el navegador a
		pantalla completa (F11), no la app.
	*/
	function modoAppCon(o) {
		var mm = o.mm || function () { return false; };
		if (mm("(display-mode: standalone)") || mm("(display-mode: minimal-ui)")) return true;
		if (o.ios && (mm("(display-mode: fullscreen)") || (o.nav && o.nav.standalone === true))) return true;
		return porOrigen(o.search);
	}

	// A qué página del login regresar: la actual, con ".html" (jissez.com quita la extensión y
	// el login solo acepta rutas .html relativas; ver LoginDestino.nextSeguro).
	function paginaActual(pathname, search, hash) {
		var nombre = String(pathname || "").split("/").pop() || "";
		nombre = nombre.replace(/\.html$/, "");
		if (!/^[a-z0-9_\-]+$/i.test(nombre) || nombre === "index") nombre = "hoy";
		return nombre + ".html" + (search || "") + (hash || "");
	}

	// ── Estado de esta página ────────────────────────────────────────────────────
	var hayVentana = typeof window !== "undefined" && typeof document !== "undefined";
	var EN_SALON = hayVentana && enSalon(location.pathname);
	var IOS = hayVentana && esIOS();
	var MM = function (q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (_) { return false; } };
	var MODO_APP = hayVentana && modoAppCon({
		mm: MM,
		nav: navigator,
		search: location.search,
		ios: IOS,
	});

	function leerInstalada() {
		try { return window.localStorage.getItem(CLAVE_INSTALADA) === "1"; } catch (_) { return false; }
	}
	function marcarInstalada() {
		try { window.localStorage.setItem(CLAVE_INSTALADA, "1"); } catch (_) {}
	}

	// Chromium sabe instalar (aunque desde la raíz no llegue el aviso: la página no está en el alcance)
	function chromiumInstala() {
		return hayVentana && ("BeforeInstallPromptEvent" in window || "onbeforeinstallprompt" in window);
	}

	/*
		¿Se ofrece "Instalar la app"? (sin contar el acceso, que se espera aparte)
		  - en la app, nunca;
		  - bajo /salon/ en Chromium: solo si llegó el aviso del navegador (si ya está instalada,
		    no llega);
		  - en iPhone/iPad: siempre fuera de la app (instrucciones). Safari no avisa si ya está
		    instalada y no comparte almacenamiento con la app, así que no hay cómo saberlo;
		  - desde la raíz en Chromium: lleva a /salon/ (ahí se decide), salvo que ya se haya
		    visto instalada en este navegador.
	*/
	function puedeInstalar() {
		if (MODO_APP) return false;
		if (diferido) return true;
		if (IOS) return true;
		if (!EN_SALON) return chromiumInstala() && !leerInstalada();
		return false;
	}

	function avisar() {
		avisos.forEach(function (fn) { try { fn(); } catch (_) {} });
	}
	function alCambiar(fn) { avisos.push(fn); }

	// ── Instalar ─────────────────────────────────────────────────────────────────
	function instalar() {
		if (diferido) {
			var ev = diferido;
			diferido = null; // el aviso solo se puede usar una vez
			avisar();
			try {
				ev.prompt();
				if (ev.userChoice) {
					ev.userChoice.then(function (r) { if (r && r.outcome === "accepted") marcarInstalada(); avisar(); });
				}
			} catch (_) {}
			return;
		}
		if (IOS) { mostrarInstrucciones(); return; }
		if (!EN_SALON) { window.location.href = "/salon/hoy?instalar=1"; return; }
		mostrarInstrucciones();
	}

	var ICONO_INSTALAR = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M9 18h6"/></svg>';
	var ICONO_COMPARTIR = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>';
	var ICONO_AGREGAR = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';
	var ICONO_CERRAR = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

	var CSS =
		".jz-app-hoja-fondo{position:fixed;inset:0;z-index:60;background:rgba(28,36,52,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}" +
		"@media (min-width:640px){.jz-app-hoja-fondo{align-items:center}}" +
		".jz-app-hoja{width:100%;max-width:28rem;background:#fff;border-radius:20px;padding:22px 20px 18px;font-family:inherit;color:#1c2434;box-shadow:0 20px 40px -12px rgba(28,36,52,.35);margin-bottom:env(safe-area-inset-bottom,0px)}" +
		".jz-app-hoja h2{margin:0 0 6px;font-size:18px;font-weight:800;letter-spacing:-.01em}" +
		".jz-app-hoja p{margin:0 0 12px;color:#5b6473;font-size:14px;line-height:1.5}" +
		".jz-app-hoja ol{margin:0 0 14px;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}" +
		".jz-app-hoja li{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.45}" +
		".jz-app-paso{flex:none;width:32px;height:32px;border-radius:10px;background:#eef2fb;color:#1e3a8a;display:flex;align-items:center;justify-content:center}" +
		".jz-app-fila{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}" +
		".jz-app-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;min-width:44px;padding:0 16px;border-radius:12px;border:1px solid #d1d5db;background:#fff;color:#1c2434;font:inherit;font-size:14px;font-weight:600;cursor:pointer}" +
		".jz-app-btn:hover{background:#f3f4f6}" +
		".jz-app-btn--primario{background:#1e3a8a;border-color:#1e3a8a;color:#fff}" +
		".jz-app-btn--primario:hover{background:#16276b}" +
		".jz-app-btn:focus-visible{outline:2px solid #f2cf6b;outline-offset:2px}" +
		".jz-app-tarjeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:12px 14px}" +
		".jz-app-tarjeta .jz-app-ico{flex:none;width:40px;height:40px;border-radius:12px;background:#eef2fb;color:#1e3a8a;display:flex;align-items:center;justify-content:center}" +
		".jz-app-tarjeta .jz-app-texto{flex:1;min-width:12rem;font-size:14px;line-height:1.4;color:#374151}" +
		".jz-app-tarjeta .jz-app-texto strong{display:block;color:#111827}" +
		"@media print{.jz-app-hoja-fondo,.jz-app-tarjeta,#navbarInstalarBtn{display:none!important}}";

	function estilos() {
		if (document.getElementById("jz-app-css")) return;
		var st = document.createElement("style");
		st.id = "jz-app-css";
		st.textContent = CSS;
		document.head.appendChild(st);
	}

	var hojaAbierta = null;
	function cerrarHoja() {
		if (!hojaAbierta) return;
		var h = hojaAbierta;
		hojaAbierta = null;
		h.fondo.remove();
		document.removeEventListener("keydown", h.tecla);
		if (h.volver && h.volver.focus) { try { h.volver.focus(); } catch (_) {} }
	}

	function abrirHoja(html) {
		cerrarHoja();
		estilos();
		var fondo = document.createElement("div");
		fondo.className = "jz-app-hoja-fondo";
		fondo.innerHTML = '<div class="jz-app-hoja" role="dialog" aria-modal="true" aria-labelledby="jzAppTitulo">' + html + "</div>";
		fondo.addEventListener("click", function (e) {
			if (e.target === fondo || (e.target.closest && e.target.closest("[data-app-cerrar]"))) cerrarHoja();
		});
		var tecla = function (e) { if (e.key === "Escape") cerrarHoja(); };
		document.addEventListener("keydown", tecla);
		hojaAbierta = { fondo: fondo, tecla: tecla, volver: document.activeElement };
		document.body.appendChild(fondo);
		var primero = fondo.querySelector("button");
		if (primero) primero.focus();
		return fondo;
	}

	function mostrarInstrucciones() {
		var pasos = IOS
			? '<li><span class="jz-app-paso">' + ICONO_COMPARTIR + "</span><span>Toca el botón <strong>Compartir</strong> de Safari (el cuadro con la flecha hacia arriba).</span></li>" +
			  '<li><span class="jz-app-paso">' + ICONO_AGREGAR + "</span><span>Elige <strong>Agregar a pantalla de inicio</strong>. Si aparece, deja activado <strong>Abrir como app web</strong>.</span></li>" +
			  '<li><span class="jz-app-paso">' + ICONO_INSTALAR + "</span><span>Abre <strong>Jissez MS</strong> desde tu pantalla de inicio e inicia sesión una vez dentro de la app.</span></li>"
			: '<li><span class="jz-app-paso">' + ICONO_INSTALAR + "</span><span>Si ya la instalaste, ábrela desde el ícono <strong>Jissez MS</strong>.</span></li>" +
			  '<li><span class="jz-app-paso">' + ICONO_AGREGAR + "</span><span>Si no, abre el menú del navegador y elige <strong>Instalar app</strong> o <strong>Agregar a pantalla de inicio</strong>.</span></li>";
		abrirHoja(
			'<h2 id="jzAppTitulo">Instalar la app Jissez MS</h2>' +
			"<p>Mi Salón queda como app en tu " + (IOS ? "iPhone o iPad" : "dispositivo") + ": se abre directo en Hoy, sin pasar por la tienda.</p>" +
			"<ol>" + pasos + "</ol>" +
			(IOS && !EN_SALON ? "<p>Hazlo desde Mi Salón: te llevamos ahí con el botón de abajo.</p>" : "") +
			'<div class="jz-app-fila">' +
			(IOS && !EN_SALON ? '<a class="jz-app-btn jz-app-btn--primario" href="/salon/hoy?instalar=1">Ir a Mi Salón</a>' : "") +
			'<button type="button" class="jz-app-btn" data-app-cerrar>Entendido</button></div>'
		);
	}

	// Llegó desde "Instalar la app" en la raíz: en /salon/ se ofrece con un botón (el aviso del
	// navegador solo puede abrirse con un toque). Si el aviso no llega (ya instalada, o el
	// navegador no lo da), se explica.
	function ofrecerAlLlegar() {
		if (!EN_SALON || MODO_APP || !/[?&]instalar=1(&|$)/.test(location.search)) return;
		function pintar() {
			if (diferido) {
				abrirHoja(
					'<h2 id="jzAppTitulo">Instalar la app Jissez MS</h2>' +
					"<p>Mi Salón queda como app en este dispositivo: se abre directo en Hoy, con su propio ícono.</p>" +
					'<div class="jz-app-fila"><button type="button" class="jz-app-btn" data-app-cerrar>Ahora no</button>' +
					'<button type="button" class="jz-app-btn jz-app-btn--primario" data-app-instalar>' + ICONO_INSTALAR + "Instalar</button></div>"
				).querySelector("[data-app-instalar]").addEventListener("click", function () { cerrarHoja(); instalar(); });
			} else {
				mostrarInstrucciones();
			}
		}
		if (diferido || IOS) { pintar(); return; }
		var listo = false;
		alCambiar(function () { if (!listo && diferido) { listo = true; pintar(); } });
		setTimeout(function () { if (!listo) { listo = true; pintar(); } }, 4000);
	}

	// ── Botones ──────────────────────────────────────────────────────────────────
	// Menú de la cuenta (js/navbar.js pone el botón oculto)
	function prepararMenu() {
		var btn = document.getElementById("navbarInstalarBtn");
		if (!btn) return;
		btn.addEventListener("click", function () { instalar(); });
		function ver() { btn.classList.toggle("hidden", !puedeInstalar()); }
		ver();
		alCambiar(ver);
	}

	// Inicio (dashboard.html)
	function prepararInicio() {
		var slot = document.getElementById("instalarAppSlot");
		if (!slot) return;
		estilos();
		slot.innerHTML =
			'<div class="jz-app-tarjeta">' +
			'<span class="jz-app-ico">' + ICONO_INSTALAR + "</span>" +
			'<span class="jz-app-texto"><strong>Instala Mi Salón como app</strong>Ábrelo con un toque desde tu pantalla de inicio, directo en Hoy.</span>' +
			'<button type="button" class="jz-app-btn jz-app-btn--primario" data-app-instalar>' + ICONO_INSTALAR + "Instalar la app</button>" +
			"</div>";
		slot.querySelector("[data-app-instalar]").addEventListener("click", function () { instalar(); });
		function ver() { slot.classList.toggle("hidden", !puedeInstalar()); }
		ver();
		alCambiar(ver);
	}

	// ── Arranque ─────────────────────────────────────────────────────────────────
	if (hayVentana) {
		if (MODO_APP) document.documentElement.classList.add("modo-app");
		// Abierta de verdad como app (no solo ?origen=app en una pestaña): la raíz deja de ofrecerla
		if (MODO_APP && modoAppCon({ mm: MM, nav: navigator, search: "", ios: IOS })) marcarInstalada();

		window.addEventListener("beforeinstallprompt", function (e) {
			// El botón propio decide cuándo; el navegador no muestra su barra
			e.preventDefault();
			diferido = e;
			avisar();
		});
		window.addEventListener("appinstalled", function () {
			diferido = null;
			marcarInstalada();
			avisar();
		});

		if (EN_SALON && "serviceWorker" in navigator) {
			window.addEventListener("load", function () {
				navigator.serviceWorker.register("/salon/sw.js", { scope: "/salon/" }).catch(function (e) {
					console.warn("app: no se pudo registrar el service worker", e);
				});
			});
		}

		document.addEventListener("DOMContentLoaded", function () {
			// Solo cuentas con acceso a Mi Salón: el candado cumple saasAcceso al confirmarlo
			if (!window.saasAcceso || MODO_APP) return;
			window.saasAcceso.then(function () {
				// Después de los demás DOMContentLoaded: la barra (js/navbar.js) ya puso su menú
				setTimeout(function () {
					prepararMenu();
					prepararInicio();
					ofrecerAlLlegar();
				}, 0);
			});
		});
	}

	return {
		enSalon: enSalon,
		porOrigen: porOrigen,
		esIOS: esIOS,
		modoAppCon: modoAppCon,
		paginaActual: paginaActual,
		modoApp: function () { return MODO_APP; },
		estaEnSalon: function () { return EN_SALON; },
		// Después de cerrar sesión dentro de /salon/: el login de la app, que regresa a Hoy
		urlLogin: function () { return "tienda/login.html?next=" + encodeURIComponent("../hoy.html"); },
		// A dónde ir sin sesión: bajo /salon/ el login de la app; fuera, `normal` (como siempre)
		salida: function (normal) { return EN_SALON ? "tienda/login.html?next=" + encodeURIComponent("../hoy.html") : normal; },
		puedeInstalar: puedeInstalar,
		instalar: instalar,
		alCambiar: alCambiar,
	};
})();
if (typeof module !== "undefined" && module.exports) module.exports = AppInstalada; // pruebas en node
