/*
	Selector de secciones de Jissez (decisión de Jorge, 2026-09-25): Tienda, Mi Salón y
	Sala de Maestros. Es el ÚNICO componente del selector; lo usan la tienda
	(tienda/js/tienda-common.js lo carga solo para cuentas con acceso), Mi Salón
	(js/navbar.js) y Sala de Maestros (js/sala-maestros.js).

	Solo lo ven las cuentas con acceso a Mi Salón (perfiles.activo_saas = true). Quien lo monta
	ya lo comprobó: el candado (js/saas-guard.js) en Mi Salón y Sala, Tienda.tieneSaas en la
	tienda. Los compradores sin acceso nunca cargan este archivo.

	- En PC y tablet (768 px o más): una fila de marca arriba (logo, las tres pestañas y la
	  cuenta). Debajo va la navegación propia de cada sección.
	- En celular (menos de 768 px): una barra fija abajo con los tres iconos y su etiqueta. La
	  página gana espacio al final (body::after) y lo que ya estaba fijo abajo (barras de
	  guardar, barra de compra, avisos) sube lo que mide la barra (margin-bottom), para que
	  nada quede tapado. Al imprimir no aparece.

	Última sección: se guarda por dispositivo en localStorage (jissez.seccion) y decide a dónde
	llegan el login, la raíz (index.html) y portal.html. La primera vez, Mi Salón.

	Rutas: se resuelven desde la ubicación de este archivo (js/), así funcionan igual desde la
	raíz que desde tienda/.
*/

var Secciones = (function () {
	var CLAVE = "jissez.seccion";

	var LISTA = [
		{ clave: "tienda", etiqueta: "Tienda", ruta: "tienda/index.html", icono: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>' },
		{ clave: "salon", etiqueta: "Mi Salón", ruta: "dashboard.html", icono: '<path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M18 4.933V21"/><path d="m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6"/><path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"/><path d="M6 4.933V21"/><circle cx="12" cy="9" r="2"/>' },
		{ clave: "sala", etiqueta: "Sala de Maestros", ruta: "sala-maestros.html", icono: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>' },
	];

	// ── Reglas (puras; probadas en pruebas/secciones.test.js) ────────────────────
	function valida(clave) {
		return clave === "tienda" || clave === "salon" || clave === "sala";
	}

	// Ruta desde la raíz de la portada de cada sección. Sin sección válida: Mi Salón.
	function ruta(clave) {
		if (clave === "tienda") return "tienda/index.html";
		if (clave === "sala") return "sala-maestros.html";
		return "dashboard.html";
	}

	// Mi Salón al iniciar sesión: con grupo, al panel; sin grupo, al alta. `res` es la
	// lectura de grupos (limit 1). Si falló no se afirma que no hay grupo: al panel, que
	// revisa el grupo por su cuenta y manda al alta si hace falta.
	function destinoMiSalon(res) {
		if (!res || res.error || !Array.isArray(res.data)) return "dashboard.html";
		return res.data.length > 0 ? "dashboard.html" : "onboarding.html";
	}

	// ¿Hace falta leer los grupos para decidir el destino del login? Solo si va a Mi Salón.
	function necesitaGrupos(ultima) {
		return ultima !== "tienda" && ultima !== "sala";
	}

	// Destino (desde la raíz) de una cuenta con acceso al iniciar sesión.
	function destinoLogin(ultima, gruposRes) {
		if (ultima === "tienda" || ultima === "sala") return ruta(ultima);
		return destinoMiSalon(gruposRes);
	}

	// Entrada por la raíz (index.html): solo Mi Salón y Sala desvían; null = la tienda,
	// como siempre.
	function destinoRaiz(ultima) {
		return ultima === "salon" || ultima === "sala" ? ruta(ultima) : null;
	}

	function leerUltima(almacen) {
		try {
			var v = (almacen || window.localStorage).getItem(CLAVE);
			return valida(v) ? v : null;
		} catch (_) {
			return null;
		}
	}

	function guardarUltima(clave, almacen) {
		if (!valida(clave)) return;
		try {
			(almacen || window.localStorage).setItem(CLAVE, clave);
		} catch (_) {}
	}

	// ── Interfaz ─────────────────────────────────────────────────────────────────
	// Raíz del sitio a partir de este archivo (…/js/secciones.js → …/)
	var RAIZ = (function () {
		try {
			var src = typeof document !== "undefined" && document.currentScript && document.currentScript.src;
			if (src) return new URL("../", src).href;
		} catch (_) {}
		return "";
	})();

	function url(r) {
		return RAIZ + r;
	}

	/*
		App instalable "Jissez MS" (docs/PWA-MI-SALON.md): la app vive en /salon/, una ruta
		virtual con los mismos archivos. Como las rutas salen de la ubicación de este archivo,
		bajo /salon/ Mi Salón y Sala de Maestros se quedan en /salon/. La tienda no es parte de
		la app: su pestaña lleva a la tienda de siempre (fuera de /salon/) y, dentro de la app
		instalada, se abre en el navegador.
	*/
	function enSalon(raiz) {
		return /\/salon\/$/.test(String(raiz || ""));
	}

	// href y atributos de la pestaña de una sección. `modoApp`: la página corre en la app.
	function destinoPestana(clave, raiz, modoApp) {
		var r = ruta(clave);
		if (clave === "tienda" && enSalon(raiz)) {
			return { href: raiz.replace(/salon\/$/, "") + r, fuera: !!modoApp };
		}
		return { href: raiz + r, fuera: false };
	}

	function enModoApp() {
		try {
			if (window.AppInstalada) return window.AppInstalada.modoApp();
			return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
		} catch (_) {
			return false;
		}
	}

	function svg(trazos, clase) {
		return '<svg class="' + clase + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + trazos + "</svg>";
	}

	var ALTO_BARRA = 52; // fila de marca (PC y tablet)
	var ALTO_ABAJO = 60; // barra de abajo (celular), sin el área segura

	var CSS =
		// Fila de marca
		".jz-sec-barra{background:#16276b;color:#fff;border-bottom:1px solid rgba(255,255,255,.08);font-family:inherit;line-height:1.25}" +
		".jz-sec-barra--fija{position:fixed;top:0;left:0;right:0;z-index:31}" +
		".jz-sec-fila{height:" + ALTO_BARRA + "px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:0 16px}" +
		"@media (min-width:1024px){.jz-sec-fila{padding:0 24px}}" +
		".jz-sec-marca{justify-self:start;display:inline-flex;align-items:center;min-height:44px;padding:0 6px;margin-left:-6px;border-radius:10px;color:#fff;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.01em}" +
		".jz-sec-marca img{height:22px;width:auto;display:block}" +
		".jz-sec-pestanas{display:flex;align-items:stretch;gap:2px;height:" + ALTO_BARRA + "px;margin:0;padding:0;list-style:none}" +
		".jz-sec-pestanas li{display:flex}" +
		".jz-sec-tab{position:relative;display:inline-flex;align-items:center;gap:8px;padding:0 14px;color:rgba(255,255,255,.7);font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap;transition:color .15s ease}" +
		// El fondo al pasar el cursor es una pastilla dentro de la fila, no la fila entera
		".jz-sec-tab::before{content:'';position:absolute;left:4px;right:4px;top:4px;bottom:4px;border-radius:10px;background:rgba(255,255,255,0);transition:background-color .15s ease}" +
		".jz-sec-tab:hover{color:#fff}" +
		".jz-sec-tab:hover::before{background:rgba(255,255,255,.08)}" +
		".jz-sec-tab>*{position:relative}" +
		".jz-sec-tab[aria-current]{color:#fff}" +
		// La sección actual: un trazo de gis verde al pie de la pestaña
		".jz-sec-tab[aria-current]::after{content:'';position:absolute;left:14px;right:14px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:#79c8a6}" +
		".jz-sec-tab:focus-visible,.jz-sec-marca:focus-visible{outline:none}" +
		".jz-sec-tab:focus-visible::before{background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px #f2cf6b}" +
		".jz-sec-marca:focus-visible{box-shadow:0 0 0 2px #f2cf6b}" +
		".jz-sec-ico{width:18px;height:18px;flex:none}" +
		".jz-sec-cuenta{justify-self:end;display:flex;align-items:center;gap:8px;min-width:0}" +
		// Cuenta sencilla (tienda y Sala): nombre y botón de salir
		".jz-sec-nombre{display:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.6);font-size:13px}" +
		"@media (min-width:1024px){.jz-sec-nombre{display:inline}}" +
		".jz-sec-boton{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:0;border-radius:10px;background:transparent;color:rgba(255,255,255,.85);font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,color .15s ease}" +
		".jz-sec-boton:hover{background:rgba(255,255,255,.1);color:#fff}" +
		".jz-sec-boton:focus-visible{outline:2px solid #f2cf6b;outline-offset:-2px}" +
		".jz-sec-boton:disabled{opacity:.7;cursor:default}" +
		// Barra de abajo (celular). En PC no existe ni para el lector de pantalla: sin esto su
		// <nav> quedaba como una región de navegación vacía
		".jz-sec-abajo-nav,.jz-sec-abajo{display:none}" +
		"@media screen and (max-width:767.98px){" +
		".jz-sec-abajo-nav{display:block}" +
		"html.jz-secciones{--jz-sec-abajo:calc(" + ALTO_ABAJO + "px + env(safe-area-inset-bottom,0px))}" +
		".jz-sec-barra:not(.jz-sec-barra--movil){display:none}" +
		".jz-sec-barra--movil .jz-sec-fila{grid-template-columns:1fr auto}" +
		".jz-sec-barra--movil nav{display:none}" +
		".jz-sec-abajo{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));position:fixed;left:0;right:0;bottom:0;z-index:35;background:#fff;padding:0 0 env(safe-area-inset-bottom,0px);margin:0;list-style:none;box-shadow:inset 0 1px 0 #e3e5ea,0 -8px 24px -18px rgba(28,36,52,.45)}" +
		".jz-sec-abajo li{display:flex}" +
		".jz-sec-abajo a{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:" + ALTO_ABAJO + "px;color:#5b6473;font-size:11.5px;font-weight:600;line-height:1.1;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}" +
		".jz-sec-abajo a .jz-sec-ico{width:22px;height:22px}" +
		".jz-sec-abajo a[aria-current]{color:#1e3a8a;font-weight:700}" +
		".jz-sec-abajo a[aria-current]::before{content:'';position:absolute;top:0;left:50%;width:36px;margin-left:-18px;height:3px;border-radius:0 0 3px 3px;background:#059669}" +
		".jz-sec-abajo a:focus-visible{outline:2px solid #1e3a8a;outline-offset:-4px;border-radius:12px}" +
		// Espacio al final de la página y lo fijo abajo, por encima de la barra
		"html.jz-secciones body::after{content:'';display:block;height:var(--jz-sec-abajo)}" +
		"html.jz-secciones .fixed[class*='bottom-'],html.jz-secciones [style*='position:fixed'][style*='bottom'],html.jz-secciones [style*='position: fixed'][style*='bottom']{margin-bottom:var(--jz-sec-abajo)}" +
		"}" +
		// Fila de marca fija (Mi Salón): la página baja lo que mide la fila. --jz-sec-arriba queda
		// para lo que se mide contra el alto de la ventana (la presentación de la junta)
		"@media screen and (min-width:768px){" +
		"html.jz-secciones-fija{scroll-padding-top:" + ALTO_BARRA + "px;--jz-sec-arriba:" + ALTO_BARRA + "px}" +
		"html.jz-secciones-fija body{border-top:" + ALTO_BARRA + "px solid transparent}" +
		"}" +
		"@media (prefers-reduced-motion:reduce){.jz-sec-tab,.jz-sec-tab::before{transition:none}}" +
		"@media print{.jz-sec-barra,.jz-sec-abajo{display:none!important}html.jz-secciones body::after{display:none}}";

	function estilos() {
		if (document.getElementById("jz-secciones-css")) return;
		var st = document.createElement("style");
		st.id = "jz-secciones-css";
		st.textContent = CSS;
		document.head.appendChild(st);
	}

	function enlaces(actual, claseA, claseIco) {
		var modoApp = enModoApp();
		return LISTA.map(function (s) {
			var es = s.clave === actual;
			var d = destinoPestana(s.clave, RAIZ, modoApp);
			return '<li><a class="' + claseA + '" href="' + d.href + '"' + (d.fuera ? ' target="_blank" rel="noopener"' : "") + (es ? ' aria-current="true"' : "") + ">" +
				svg(s.icono, claseIco) + "<span>" + s.etiqueta + "</span></a></li>";
		}).join("");
	}

	/*
		montar({ actual, arriba, fija, movilArriba }) → { barra, abajo, cuenta }
		  actual       "tienda" | "salon" | "sala": la pestaña marcada.
		  arriba       elemento donde va la fila de marca (al inicio). Sin él, al inicio del body.
		  fija         la fila va fija arriba y la página baja lo que mide (Mi Salón, cuya
		               barra también es fija). Sin ella, la fila va en el flujo (dentro de un
		               encabezado sticky, como en la tienda).
		  movilArriba  en celular la fila se queda arriba con el logo y la cuenta (sin
		               pestañas, que van abajo). Para Sala, que no tiene otra barra.
		`cuenta` es el hueco de la derecha de la fila: cada sección pone ahí lo suyo.
	*/
	function montar(opts) {
		opts = opts || {};
		var actual = valida(opts.actual) ? opts.actual : "salon";
		estilos();
		var raiz = document.documentElement;
		raiz.classList.add("jz-secciones");
		if (opts.fija) raiz.classList.add("jz-secciones-fija");

		var barra = document.createElement("div");
		barra.className = "jz-sec-barra" + (opts.fija ? " jz-sec-barra--fija" : "") + (opts.movilArriba ? " jz-sec-barra--movil" : "");
		barra.innerHTML =
			'<div class="jz-sec-fila">' +
			'<a class="jz-sec-marca" href="' + url(ruta(actual)) + '">' +
			'<img src="' + url("tienda/assets/jissez-wordmark-white.png") + '" alt="Jissez" onerror="this.replaceWith(document.createTextNode(\'Jissez\'))">' +
			"</a>" +
			'<nav aria-label="Secciones de Jissez"><ul class="jz-sec-pestanas">' + enlaces(actual, "jz-sec-tab", "jz-sec-ico") + "</ul></nav>" +
			'<div class="jz-sec-cuenta"></div>' +
			"</div>";
		var destino = opts.arriba || document.body;
		destino.insertBefore(barra, destino.firstChild);

		var abajo = document.createElement("nav");
		abajo.className = "jz-sec-abajo-nav";
		abajo.setAttribute("aria-label", "Secciones de Jissez");
		abajo.innerHTML = '<ul class="jz-sec-abajo">' + enlaces(actual, "", "jz-sec-ico") + "</ul>";
		(opts.abajo || document.body).appendChild(abajo);

		return { barra: barra, abajo: abajo, cuenta: barra.querySelector(".jz-sec-cuenta") };
	}

	// ¿Se ve la fila de marca de PC (y no la barra de abajo)?
	function esEscritorio() {
		return !!(window.matchMedia && window.matchMedia("(min-width: 768px)").matches);
	}

	return {
		CLAVE: CLAVE,
		ALTO_BARRA: ALTO_BARRA,
		valida: valida,
		ruta: ruta,
		destinoMiSalon: destinoMiSalon,
		necesitaGrupos: necesitaGrupos,
		destinoLogin: destinoLogin,
		destinoRaiz: destinoRaiz,
		leerUltima: leerUltima,
		guardarUltima: guardarUltima,
		url: url,
		enSalon: enSalon,
		destinoPestana: destinoPestana,
		montar: montar,
		esEscritorio: esEscritorio,
	};
})();
if (typeof module !== "undefined" && module.exports) module.exports = Secciones; // pruebas en node
