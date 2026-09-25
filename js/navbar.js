/*
	navbar.js — Navegación de Mi Salón y Sala de Maestros (decisión de Jorge, 2026-09-25).

	Va en el <head> de cada página (después de js/app-instalada.js). Al cargarse aparta el
	espacio de la navegación (html.jz-nav y sus estilos), así nada brinca en el primer pintado;
	la navegación entra en DOMContentLoaded dentro de #app-navbar (el aviso de js/lectura.js la
	deja a la vista y la impresión la oculta).

	Punto de corte: 1024 px de ancho (CORTE). La Samsung Galaxy Tab S9 FE+ mide 1280×800 px
	CSS en horizontal (barra lateral) y 800×1280 en vertical (encabezado y barra de abajo).

	- PC y tablet horizontal (1024 px o más): barra lateral fija a la izquierda. De arriba
	  abajo: marca Jissez; selector de secciones (Tienda / Mi Salón / Sala, js/secciones.js);
	  grupo activo (lo pinta js/grupo-activo.js, el único que decide el grupo); menú de la
	  sección por grupos; y abajo la cuenta (nombre, Mi cuenta, Ajustes, Instalar la app y
	  Cerrar sesión). Se contrae a solo íconos (con tooltip y aria-label); la elección se
	  recuerda en el aparato (localStorage "jissez.navContraida"). La página se corre lo que
	  mide la barra (border-left del body) y lo fijo de la página empieza después de ella.
	- Celular y tablet vertical (menos de 1024 px): encabezado fijo arriba (menú, nombre de la
	  página y grupo activo) y barra de accesos rápidos abajo (Hoy, Asistencia, Reportes y
	  Más; en Sala solo Más). El menú y Más abren la misma barra como panel lateral: foco
	  atrapado, Esc y tocar fuera la cierran, aria-expanded y sin scroll de fondo. La página
	  gana al final lo que mide la barra de abajo y lo fijo abajo sube lo mismo.

	El selector de secciones solo se pinta cuando el candado confirmó el acceso
	(window.saasAcceso, js/saas-guard.js). Enlaces relativos: bajo /salon/ (la app instalable)
	nada se sale de /salon/, salvo la Tienda, que se abre fuera como siempre.

	Sala de Maestros carga este archivo con data-seccion="sala".
*/
var Navegacion = (function () {
	var CORTE = 1024;
	var CLAVE_CONTRAIDA = "jissez.navContraida";
	var ANCHO = 256, ANCHO_CONTRAIDA = 72, ALTO_CABEZA = 56, ALTO_ABAJO = 60;

	function svg(trazos, clase) {
		return '<svg class="' + (clase || "jz-ico") + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + trazos + "</svg>";
	}

	// Íconos Lucide (trazos en línea: así están desde el primer pintado, sin esperar la librería)
	var ICONOS = {
		inicio: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
		hoy: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
		asistencia: '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
		actividades: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
		tareas: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
		proyectos: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
		marketplace: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
		diagnostico: '<path d="m8 11 2 2 4-4"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
		examen: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
		reportes: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
		// El grupo (mochila): distinto del ícono de Sala de Maestros
		grupo: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
		sala: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
		cuenta: '<path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/>',
		ajustes: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
		instalar: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M9 18h6"/>',
		salir: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
		menu: '<path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/>',
		cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
		contraer: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
		expandir: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
		arribaAbajo: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
	};

	// ── Menús por sección (los mismos destinos que antes, agrupados) ─────────────
	var MENUS = {
		salon: [
			{ titulo: "Día a día", items: [
				{ clave: "dashboard", href: "dashboard.html", etiqueta: "Inicio", icono: "inicio" },
				{ clave: "hoy", href: "hoy.html", etiqueta: "Hoy", icono: "hoy" },
				{ clave: "asistencia", href: "asistencia.html", etiqueta: "Asistencia", icono: "asistencia" },
				{ clave: "actividades", href: "actividades.html", etiqueta: "Actividades", icono: "actividades" },
				{ clave: "tareas", href: "tareas.html", etiqueta: "Tareas", icono: "tareas" },
			] },
			{ titulo: "Planeación", items: [
				{ clave: "planeacion", href: "planeacion.html", etiqueta: "Proyectos", icono: "proyectos" },
				{ clave: "marketplace", href: "marketplace.html", etiqueta: "Marketplace", icono: "marketplace" },
			] },
			{ titulo: "Evaluación y reportes", items: [
				{ clave: "evaluacion_diagnostica", href: "evaluacion_diagnostica.html", etiqueta: "Diagnóstico", icono: "diagnostico" },
				{ clave: "examen", href: "examen.html", etiqueta: "Exámenes", icono: "examen" },
				{ clave: "reportes", href: "reportes.html", etiqueta: "Reportes", icono: "reportes" },
			] },
			{ titulo: "Grupo", items: [
				{ clave: "mi-grupo", href: "mi-grupo.html", etiqueta: "Mi grupo", icono: "grupo" },
			] },
		],
		sala: [
			{ titulo: "Sala de Maestros", items: [
				{ clave: "sala-maestros", href: "sala-maestros.html", etiqueta: "Portada", icono: "sala" },
			] },
		],
	};

	var CUENTA = [
		{ clave: "mi-cuenta", href: "mi-cuenta.html", etiqueta: "Mi cuenta", icono: "cuenta" },
		{ clave: "ajustes", href: "ajustes.html", etiqueta: "Ajustes", icono: "ajustes" },
	];

	// Páginas que no están en el menú: se marca la de la que dependen
	var PADRE = {
		crear_proyecto: "planeacion",
		boleta: "reportes",
		"reporte-alumno": "reportes",
		junta: "reportes",
		exportar: "reportes",
	};

	var TITULOS = {
		dashboard: "Inicio", hoy: "Hoy", asistencia: "Asistencia", actividades: "Actividades", tareas: "Tareas",
		planeacion: "Proyectos", crear_proyecto: "Proyecto", marketplace: "Marketplace",
		evaluacion_diagnostica: "Diagnóstico", evaluacion_formativa: "Evaluación formativa", examen: "Exámenes",
		reportes: "Reportes", boleta: "Boleta", "reporte-alumno": "Reporte del alumno", junta: "Junta de padres",
		exportar: "Exportar", "mi-grupo": "Mi grupo", "mi-cuenta": "Mi cuenta", ajustes: "Ajustes",
		"sala-maestros": "Sala de Maestros",
	};

	// Accesos rápidos de la barra de abajo (celular y tablet vertical). Sala tiene un solo
	// destino (su portada): su barra lleva solo Más, en el mismo lugar que en Mi Salón.
	var ACCESOS = {
		salon: [
			{ clave: "hoy", href: "hoy.html", etiqueta: "Hoy", icono: "hoy" },
			{ clave: "asistencia", href: "asistencia.html", etiqueta: "Asistencia", icono: "asistencia" },
			{ clave: "reportes", href: "reportes.html", etiqueta: "Reportes", icono: "reportes" },
		],
		sala: [],
	};

	// ── Reglas (puras; probadas en pruebas/navegacion.test.js) ───────────────────
	function esLateral(ancho) {
		return Number(ancho) >= CORTE;
	}

	function leerContraida(almacen) {
		try { return (almacen || window.localStorage).getItem(CLAVE_CONTRAIDA) === "1"; } catch (_) { return false; }
	}

	function guardarContraida(si, almacen) {
		try { (almacen || window.localStorage).setItem(CLAVE_CONTRAIDA, si ? "1" : "0"); } catch (_) {}
	}

	function seccionValida(s) {
		return s === "sala" ? "sala" : "salon";
	}

	// "/salon/hoy", "/hoy.html", "/x/reportes" → "hoy", "reportes"
	function paginaDe(pathname) {
		var nombre = String(pathname || "").split("/").pop() || "";
		nombre = nombre.replace(/\.html$/, "");
		return nombre || "dashboard";
	}

	// Clave del menú que se marca en esa página (null si ninguna)
	function activoDe(seccion, pagina) {
		var clave = PADRE[pagina] || pagina;
		var todas = MENUS[seccionValida(seccion)].concat([{ items: CUENTA }]);
		for (var i = 0; i < todas.length; i++) {
			for (var j = 0; j < todas[i].items.length; j++) {
				if (todas[i].items[j].clave === clave) return clave;
			}
		}
		return null;
	}

	function tituloDe(seccion, pagina) {
		return TITULOS[pagina] || (seccionValida(seccion) === "sala" ? "Sala de Maestros" : "Mi Salón");
	}

	// Barra de abajo: los accesos de la sección (con el activo marcado) y al final Más
	function accesosDe(seccion, pagina) {
		var activo = activoDe(seccion, pagina);
		return ACCESOS[seccionValida(seccion)].map(function (a) {
			return { clave: a.clave, href: a.href, etiqueta: a.etiqueta, icono: a.icono, activo: a.clave === activo };
		}).concat([{ clave: "mas", etiqueta: "Más", icono: "menu", activo: false }]);
	}

	// ── HTML (puro) ──────────────────────────────────────────────────────────────
	function enlace(item, activo, clase) {
		var es = item.clave === activo;
		return '<a class="' + clase + '" href="' + item.href + '" data-tip="' + item.etiqueta + '"' + (es ? ' aria-current="page"' : "") + ">" +
			svg(ICONOS[item.icono]) + '<span class="jz-txt">' + item.etiqueta + "</span></a>";
	}

	function construir(seccion, pagina) {
		seccion = seccionValida(seccion);
		var activo = activoDe(seccion, pagina);
		var inicio = seccion === "sala" ? "sala-maestros.html" : "dashboard.html";
		var conGrupo = seccion === "salon";

		var menu = MENUS[seccion].map(function (g, i) {
			return '<div class="jz-grupo-menu"><p class="jz-titulo" id="jzMenuG' + i + '">' + g.titulo + '</p><ul aria-labelledby="jzMenuG' + i + '">' +
				g.items.map(function (it) { return "<li>" + enlace(it, activo, "jz-item") + "</li>"; }).join("") +
				"</ul></div>";
		}).join("");

		var cuentaItems = CUENTA.map(function (it) { return enlace(it, activo, "jz-item"); }).join("") +
			// "Instalar la app": js/app-instalada.js lo muestra solo si se puede y no está instalada
			'<button id="navbarInstalarBtn" type="button" class="hidden jz-item" data-tip="Instalar la app">' + svg(ICONOS.instalar) + '<span class="jz-txt">Instalar la app</span></button>' +
			'<button id="navbarLogoutBtn" type="button" class="jz-item jz-item--salir" data-tip="Cerrar sesión">' + svg(ICONOS.salir) + '<span class="jz-txt">Cerrar sesión</span></button>';

		var abajo = accesosDe(seccion, pagina).map(function (a) {
			if (a.clave === "mas") {
				return '<li><button type="button" id="jzNavMas" class="jz-abajo-op" aria-controls="jzNavPanel" aria-expanded="false" aria-haspopup="dialog">' +
					svg(ICONOS.menu) + "<span>Más</span></button></li>";
			}
			return '<li><a class="jz-abajo-op" href="' + a.href + '"' + (a.activo ? ' aria-current="page"' : "") + ">" + svg(ICONOS[a.icono]) + "<span>" + a.etiqueta + "</span></a></li>";
		}).join("");

		return (
			'<div id="app-navbar" class="jz-nav-raiz" data-seccion="' + seccion + '">' +
			// Para teclado y lector de pantalla: saltar la navegación
			'<a class="jz-saltar" href="#" data-nav-saltar>Saltar al contenido</a>' +
			// Encabezado (celular y tablet vertical)
			'<header class="jz-cabeza">' +
			'<button type="button" id="navbarMenuBtn" class="jz-cabeza-btn" aria-label="Abrir el menú" aria-controls="jzNavPanel" aria-expanded="false" aria-haspopup="dialog">' + svg(ICONOS.menu) + "</button>" +
			'<span class="jz-cabeza-titulo">' + tituloDe(seccion, pagina) + "</span>" +
			(conGrupo ? '<div class="jz-grupo-slot jz-grupo-slot--cabeza" data-grupo-slot="cabeza"></div>' : "") +
			"</header>" +
			'<div class="jz-velo" data-nav-cerrar></div>' +
			// Barra lateral (PC y tablet horizontal) y panel del menú (celular)
			'<aside id="jzNavPanel" class="jz-lat" aria-label="Menú de ' + (seccion === "sala" ? "Sala de Maestros" : "Mi Salón") + '">' +
			'<div class="jz-lat-cabeza">' +
			'<a class="jz-marca" href="' + inicio + '" aria-label="Jissez, ' + (seccion === "sala" ? "Sala de Maestros" : "Mi Salón") + '">' +
			'<img class="jz-marca-larga" src="tienda/assets/jissez-wordmark-white.png" alt="" onerror="this.replaceWith(document.createTextNode(\'Jissez\'))">' +
			'<img class="jz-marca-corta" src="tienda/assets/jissez-icon-white.png" alt="">' +
			"</a>" +
			'<button type="button" id="jzNavContraer" class="jz-lat-btn jz-solo-lateral" aria-controls="jzNavPanel" aria-expanded="true" aria-label="Contraer el menú" data-tip="Expandir el menú">' +
			svg(ICONOS.contraer, "jz-ico jz-ico-contraer") + svg(ICONOS.expandir, "jz-ico jz-ico-expandir") + "</button>" +
			'<button type="button" class="jz-lat-btn jz-solo-panel" data-nav-cerrar aria-label="Cerrar el menú">' + svg(ICONOS.cerrar) + "</button>" +
			"</div>" +
			// Arriba, siempre a la vista en PC: secciones y grupo. Solo el menú se desplaza si no cabe.
			'<div class="jz-lat-arriba">' +
			// Selector de secciones: se pinta cuando el candado confirma el acceso (su lugar ya está apartado)
			'<div id="jzNavSecciones" class="jz-secciones-slot"></div>' +
			(conGrupo ? '<div class="jz-lat-grupo jz-solo-lateral">' +
				'<button type="button" id="jzGrupoMini" class="jz-item jz-grupo-mini" aria-label="Grupo activo" data-tip="Grupo activo">' + svg(ICONOS.grupo) + "</button>" +
				'<div class="jz-grupo-slot jz-grupo-slot--lateral" data-grupo-slot="lateral"></div></div>' : "") +
			"</div>" +
			'<div class="jz-lat-cuerpo">' +
			'<nav class="jz-menu" aria-label="' + (seccion === "sala" ? "Sala de Maestros" : "Mi Salón") + '">' + menu + "</nav>" +
			"</div>" +
			// Cuenta: en PC un botón con el nombre que abre sus opciones hacia arriba; en el panel,
			// el nombre y las opciones a la vista al final
			'<div class="jz-cuenta">' +
			'<button type="button" id="jzCuentaBtn" class="jz-cuenta-btn jz-solo-lateral" aria-expanded="false" aria-controls="jzCuentaMenu" data-tip="Cuenta">' +
			'<span class="jz-avatar" aria-hidden="true"></span><span class="jz-txt jz-cuenta-nombre">Mi cuenta</span>' + svg(ICONOS.arribaAbajo, "jz-ico jz-cuenta-chev") + "</button>" +
			'<p class="jz-cuenta-fila jz-solo-panel"><span class="jz-avatar" aria-hidden="true"></span><span class="jz-cuenta-nombre"></span></p>' +
			'<div id="jzCuentaMenu" class="jz-cuenta-menu">' + cuentaItems + "</div>" +
			"</div>" +
			"</aside>" +
			// Accesos rápidos (celular y tablet vertical)
			'<nav class="jz-abajo" aria-label="Accesos rápidos"><ul class="' + (seccion === "sala" ? "jz-abajo-lista jz-abajo-lista--solo" : "jz-abajo-lista") + '">' + abajo + "</ul></nav>" +
			'<div class="jz-tip" role="tooltip" id="jzNavTip" hidden></div>' +
			"</div>"
		);
	}

	// ── Estilos ──────────────────────────────────────────────────────────────────
	var M_LAT = "screen and (min-width:" + CORTE + "px)";
	var M_MOVIL = "screen and (max-width:" + (CORTE - 0.02) + "px)";
	var CSS =
		"html.jz-nav{--jz-lat:0px;--jz-abajo:0px}" +
		// Si la tienda (js de su tema, en Sala) apartó su encabezado, aquí no hace falta
		"html.jz-nav.jz-sec-reserva body::before{display:none}" +
		".jz-nav-raiz{position:fixed;top:0;left:0;right:0;height:" + ALTO_CABEZA + "px;z-index:45;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.25;-webkit-font-smoothing:antialiased}" +
		".jz-nav-raiz .hidden,.jz-nav-raiz [hidden]{display:none!important}" +
		".jz-nav-raiz *{box-sizing:border-box}" +
		".jz-nav-raiz ul{list-style:none;margin:0;padding:0}" +
		".jz-nav-raiz p{margin:0}" +
		":where(.jz-nav-raiz) button{font:inherit;cursor:pointer}" +
		".jz-ico{width:20px;height:20px;flex:none}" +
		".jz-nav-raiz :focus-visible{outline:2px solid #f2cf6b;outline-offset:-2px}" +
		// Encabezado
		".jz-cabeza{height:" + ALTO_CABEZA + "px;display:flex;align-items:center;gap:6px;padding:0 10px 0 6px;background:#1e3a8a;color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.06),0 6px 16px -10px rgba(15,23,42,.6)}" +
		".jz-cabeza-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;border-radius:12px;background:transparent;color:#fff}" +
		".jz-cabeza-btn:hover{background:rgba(255,255,255,.1)}" +
		".jz-cabeza-titulo{flex:1;min-width:0;font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
		// Grupo activo (lo llena js/grupo-activo.js)
		".jz-grupo-slot--cabeza:empty{display:none}" +
		// En la barra su lugar queda apartado mientras llega la lectura (nada se recorre)
		".jz-grupo-slot--lateral{min-height:64px}" +
		".jz-grupo-etq{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.5);margin:0 0 6px 2px}" +
		".jz-grupo-control{position:relative;display:flex;align-items:center}" +
		".jz-grupo-select,.jz-grupo-nombre{display:block;width:100%;min-height:44px;padding:0 34px 0 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:14px;font-weight:600;line-height:42px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-appearance:none;appearance:none}" +
		".jz-grupo-nombre{padding-right:12px;border-color:transparent;background:rgba(255,255,255,.06)}" +
		".jz-grupo-select{cursor:pointer}" +
		".jz-grupo-select:hover{background:rgba(255,255,255,.14)}" +
		".jz-grupo-select option{color:#1c2434;background:#fff}" +
		".jz-grupo-flecha{position:absolute;right:10px;width:16px;height:16px;pointer-events:none;color:rgba(255,255,255,.8)}" +
		".jz-grupo-slot--cabeza{flex:none;max-width:46%;min-width:0}" +
		".jz-grupo-slot--cabeza .jz-grupo-etq{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
		".jz-grupo-slot--cabeza .jz-grupo-select,.jz-grupo-slot--cabeza .jz-grupo-nombre{font-size:13px}" +
		// Velo del panel
		".jz-velo{position:fixed;inset:0;z-index:1;background:rgba(15,23,42,.5);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility 0s linear .2s}" +
		// Barra lateral / panel
		".jz-lat{position:fixed;top:0;bottom:0;left:0;z-index:2;width:min(20rem,86vw);display:flex;flex-direction:column;background:#16276b;color:#fff;box-shadow:12px 0 32px -16px rgba(15,23,42,.6);transform:translateX(-100%);visibility:hidden;transition:transform .22s ease,visibility 0s linear .22s;overscroll-behavior:contain}" +
		".jz-lat-cabeza{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:64px;padding:10px 10px 6px 16px}" +
		".jz-marca{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;margin-left:-6px;border-radius:10px;color:#fff;text-decoration:none;font-weight:800;font-size:18px}" +
		".jz-marca img{display:block;height:22px;width:auto}" +
		".jz-marca .jz-marca-corta{display:none;height:28px}" +
		".jz-lat-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;border-radius:12px;background:transparent;color:rgba(255,255,255,.75)}" +
		".jz-lat-btn:hover{background:rgba(255,255,255,.1);color:#fff}" +
		".jz-ico-expandir{display:none}" +
		".jz-lat-arriba{flex:none;padding:4px 12px 0}" +
		".jz-lat-cuerpo{flex:1;min-height:0;overflow-y:auto;padding:2px 12px 12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}" +
		// Selector de secciones (js/secciones.js, selectorNav)
		".jz-secciones-slot{min-height:58px;margin-bottom:14px}" +
		".jz-sel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px;padding:3px;border-radius:14px;background:rgba(0,0,0,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}" +
		".jz-sel li{display:flex}" +
		".jz-sel-op{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:52px;padding:4px 2px;border-radius:11px;color:rgba(255,255,255,.72);text-decoration:none;font-size:11.5px;font-weight:600;white-space:nowrap;transition:background-color .15s ease,color .15s ease}" +
		".jz-sel-op:hover{color:#fff;background:rgba(255,255,255,.08)}" +
		".jz-sel-op[aria-current]{background:#fff;color:#16276b;box-shadow:0 1px 2px rgba(15,23,42,.3)}" +
		".jz-sel-ico{width:20px;height:20px;flex:none}" +
		// Grupo en la barra
		".jz-lat-grupo{margin-bottom:14px}" +
		".jz-grupo-mini{display:none!important}" +
		// Menú
		".jz-grupo-menu+.jz-grupo-menu{margin-top:14px}" +
		".jz-titulo{padding:0 12px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.45);white-space:nowrap}" +
		".jz-item{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:rgba(255,255,255,.8);font-size:14px;font-weight:500;text-align:left;text-decoration:none;white-space:nowrap;transition:background-color .15s ease,color .15s ease}" +
		".jz-item:hover{background:rgba(255,255,255,.08);color:#fff}" +
		".jz-item[aria-current]{background:rgba(255,255,255,.12);color:#fff;font-weight:600}" +
		// La página actual: un trazo de gis verde a la izquierda
		".jz-item[aria-current]::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:#79c8a6}" +
		".jz-txt{min-width:0;overflow:hidden;text-overflow:ellipsis}" +
		// Cuenta
		".jz-cuenta{position:relative;flex:none;padding:8px 12px 12px;border-top:1px solid rgba(255,255,255,.08)}" +
		".jz-avatar{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border-radius:999px;background:#79c8a6;color:#16276b;font-size:13px;font-weight:800;text-transform:uppercase}" +
		".jz-cuenta-btn{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:0 8px;border:0;border-radius:12px;background:transparent;color:#fff;font-size:14px;font-weight:600;text-align:left}" +
		".jz-cuenta-btn:hover,.jz-cuenta-btn[aria-expanded=true]{background:rgba(255,255,255,.08)}" +
		".jz-cuenta-btn .jz-txt{flex:1}" +
		".jz-cuenta-chev{width:16px;height:16px;color:rgba(255,255,255,.6)}" +
		".jz-cuenta-fila{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 8px;font-weight:600}" +
		".jz-cuenta-fila .jz-cuenta-nombre{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
		".jz-item--salir{color:#fecaca}" +
		".jz-item--salir:hover{background:rgba(248,113,113,.14);color:#fff}" +
		".jz-item:disabled{opacity:.7;cursor:default}" +
		// Barra de abajo
		".jz-abajo{display:none}" +
		".jz-abajo-lista{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}" +
		".jz-abajo-lista--solo{grid-template-columns:minmax(0,1fr)}" +
		".jz-abajo-lista li{display:flex}" +
		".jz-abajo-op{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:" + ALTO_ABAJO + "px;border:0;background:transparent;color:#5b6473;font-size:11.5px;font-weight:600;line-height:1.1;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}" +
		".jz-abajo-op .jz-ico{width:22px;height:22px}" +
		".jz-abajo-op[aria-current],.jz-abajo-op[aria-expanded=true]{color:#1e3a8a;font-weight:700}" +
		".jz-abajo-op[aria-current]::before{content:'';position:absolute;top:0;left:50%;width:36px;margin-left:-18px;height:3px;border-radius:0 0 3px 3px;background:#059669}" +
		".jz-abajo-op:focus-visible{outline:2px solid #1e3a8a;outline-offset:-4px;border-radius:12px}" +
		// Tooltip de la barra contraída
		".jz-saltar{position:fixed;top:8px;left:8px;z-index:6;padding:12px 16px;border-radius:12px;background:#fff;color:#1e3a8a;font-weight:700;text-decoration:none;box-shadow:0 8px 24px -8px rgba(15,23,42,.5);transform:translateY(-200%)}" +
		".jz-saltar:focus{transform:none;outline:2px solid #1e3a8a;outline-offset:2px}" +
		".jz-cuenta-menu .jz-item:focus-visible{outline-color:#1e3a8a}" +
		".jz-tip{position:fixed;z-index:5;max-width:16rem;padding:6px 10px;border-radius:8px;background:#0f172a;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;pointer-events:none;box-shadow:0 6px 16px -6px rgba(15,23,42,.5)}" +

		// ── Celular y tablet vertical ──
		"@media " + M_MOVIL + "{" +
		"html.jz-nav{--jz-abajo:calc(" + ALTO_ABAJO + "px + env(safe-area-inset-bottom,0px))}" +
		".jz-solo-lateral{display:none!important}" +
		".jz-lat{overflow-y:auto}" +
		".jz-lat-cuerpo{flex:none;overflow:visible;padding-bottom:4px}" +
		".jz-lat-arriba .jz-secciones-slot{margin-bottom:12px}" +
		".jz-cuenta{padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}" +
		"html.jz-nav-abierto .jz-lat{transform:none;visibility:visible;transition:transform .22s ease}" +
		"html.jz-nav-abierto .jz-velo{opacity:1;visibility:visible;transition:opacity .2s ease}" +
		"html.jz-nav-abierto,html.jz-nav-abierto body{overflow:hidden!important}" +
		".jz-abajo{display:block;position:fixed;left:0;right:0;bottom:0;z-index:0;background:#fff;padding-bottom:env(safe-area-inset-bottom,0px);box-shadow:inset 0 1px 0 #e3e5ea,0 -8px 24px -18px rgba(28,36,52,.45)}" +
		// Espacio al final de la página y lo fijo abajo por encima de la barra
		"html.jz-nav body::after{content:'';display:block;height:var(--jz-abajo)}" +
		"html.jz-nav .fixed[class*='bottom-'],html.jz-nav [style*='position:fixed'][style*='bottom'],html.jz-nav [style*='position: fixed'][style*='bottom']{margin-bottom:var(--jz-abajo)}" +
		"}" +

		// ── PC y tablet horizontal: barra lateral ──
		"@media " + M_LAT + "{" +
		"html.jz-nav{--jz-lat:" + ANCHO + "px}" +
		"html.jz-nav.jz-nav-contraida{--jz-lat:" + ANCHO_CONTRAIDA + "px}" +
		".jz-nav-raiz{height:0}" +
		".jz-cabeza,.jz-velo,.jz-abajo,.jz-solo-panel{display:none!important}" +
		".jz-lat{width:var(--jz-lat);transform:none;visibility:visible;transition:none;box-shadow:inset -1px 0 0 rgba(255,255,255,.06)}" +
		// La página se corre lo que mide la barra (desde el primer pintado: esta hoja está en el <head>)
		"html.jz-nav body{border-left:var(--jz-lat) solid transparent}" +
		// Sin encabezado arriba: lo que la página dejaba para la barra de 56 px ya no hace falta
		"html.jz-nav body.pt-16{padding-top:2rem}" +
		"html.jz-nav body.pt-14{padding-top:0}" +
		"html.jz-nav .fixed.top-14,html.jz-nav .sticky.top-14{top:0}" +
		// Lo fijo de la página empieza después de la barra
		"html.jz-nav .fixed.left-0{left:var(--jz-lat)}" +
		"html.jz-nav .fixed.inset-x-4{left:calc(var(--jz-lat) + 1rem)}" +
		"html.jz-nav .fixed.left-5{left:calc(var(--jz-lat) + 1.25rem)}" +
		"html.jz-nav .fixed.left-1\\/2{left:calc(50% + var(--jz-lat) / 2)}" +
		".jz-cuenta-menu{display:none;position:absolute;left:12px;right:12px;bottom:calc(100% - 4px);padding:6px;border-radius:14px;background:#fff;box-shadow:0 18px 40px -12px rgba(15,23,42,.45),0 0 0 1px rgba(15,23,42,.06)}" +
		".jz-cuenta-menu.jz-abierto{display:block}" +
		".jz-cuenta-menu .jz-item{color:#1c2434}" +
		".jz-cuenta-menu .jz-item:hover{background:#f1f3f9;color:#1e3a8a}" +
		".jz-cuenta-menu .jz-item[aria-current]{background:#eef2fb;color:#1e3a8a}" +
		".jz-cuenta-menu .jz-item[aria-current]::before{display:none}" +
		".jz-cuenta-menu .jz-item--salir{color:#b91c1c}" +
		".jz-cuenta-menu .jz-item--salir:hover{background:#fef2f2;color:#991b1b}" +
		// Contraída: solo íconos
		"html.jz-nav-contraida .jz-lat-cabeza{flex-direction:column;justify-content:flex-start;padding:10px 0 6px;gap:4px}" +
		"html.jz-nav-contraida .jz-marca{margin:0;padding:0 8px}" +
		"html.jz-nav-contraida .jz-marca-larga{display:none}" +
		"html.jz-nav-contraida .jz-marca .jz-marca-corta{display:block}" +
		"html.jz-nav-contraida .jz-ico-contraer{display:none}" +
		"html.jz-nav-contraida .jz-ico-expandir{display:block}" +
		"html.jz-nav-contraida .jz-lat-cuerpo{padding:2px 12px 12px}" +
		"html.jz-nav-contraida .jz-txt,html.jz-nav-contraida .jz-sel-txt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
		"html.jz-nav-contraida .jz-titulo{height:1px;padding:0;margin:0 8px 13px;overflow:hidden;color:transparent;background:rgba(255,255,255,.12)}" +
		"html.jz-nav-contraida .jz-item{justify-content:center;padding:0;gap:0}" +
		"html.jz-nav-contraida .jz-sel{grid-template-columns:minmax(0,1fr);background:transparent;box-shadow:none;padding:0;gap:4px}" +
		"html.jz-nav-contraida .jz-sel-op{min-height:44px;padding:0}" +
		"html.jz-nav-contraida .jz-secciones-slot{min-height:140px}" +
		"html.jz-nav-contraida .jz-grupo-slot--lateral{display:none}" +
		"html.jz-nav-contraida .jz-grupo-mini{display:flex!important}" +
		"html.jz-nav-contraida .jz-cuenta{padding:8px 12px 12px}" +
		"html.jz-nav-contraida .jz-cuenta-btn{justify-content:center;padding:0}" +
		"html.jz-nav-contraida .jz-cuenta-chev{display:none}" +
		"html.jz-nav-contraida .jz-cuenta-menu{left:8px;right:auto;width:15rem}" +
		"}" +
		"@media (prefers-reduced-motion:reduce){.jz-lat,.jz-velo,.jz-item,.jz-sel-op{transition:none!important}}" +
		"@media print{.jz-nav-raiz,#app-navbar{display:none!important}html.jz-nav body{border-left:0!important}html.jz-nav body::after{display:none!important}}";

	/*
		reservar(doc, almacen): aparta el espacio desde el <head>, antes del primer pintado.
		Pone html.jz-nav (y html.jz-nav-contraida si así se dejó en este aparato) y la hoja de
		estilos. Se puede llamar más de una vez.
	*/
	function reservar(doc, almacen) {
		doc = doc || document;
		var raiz = doc.documentElement;
		raiz.classList.add("jz-nav");
		if (leerContraida(almacen)) raiz.classList.add("jz-nav-contraida");
		if (!doc.getElementById("jz-nav-css")) {
			var st = doc.createElement("style");
			st.id = "jz-nav-css";
			st.textContent = CSS;
			(doc.head || raiz).appendChild(st);
		}
	}

	// ── Montaje (navegador) ──────────────────────────────────────────────────────
	var hayVentana = typeof window !== "undefined" && typeof document !== "undefined";
	var SECCION = "salon";
	if (hayVentana) {
		try {
			var guion = document.currentScript;
			SECCION = seccionValida(guion && guion.getAttribute("data-seccion"));
		} catch (_) {}
		reservar(document);
	}

	function esEscritorio() {
		return !!(window.matchMedia && window.matchMedia("(min-width: " + CORTE + "px)").matches);
	}

	function enfocables(cont) {
		return Array.prototype.filter.call(
			cont.querySelectorAll("a[href],button:not([disabled]),select,input,[tabindex]:not([tabindex='-1'])"),
			function (el) { return el.offsetParent !== null || el === document.activeElement; }
		);
	}

	function montar() {
		if (document.getElementById("app-navbar")) return;
		var pagina = paginaDe(window.location.pathname);
		var envoltura = document.createElement("div");
		envoltura.innerHTML = construir(SECCION, pagina);
		var nav = envoltura.firstChild;
		document.body.insertBefore(nav, document.body.firstChild);
		var raiz = document.documentElement;
		raiz.classList.remove("jz-sec-reserva"); // la reserva de la tienda (Sala carga su tema)

		var panel = document.getElementById("jzNavPanel");
		var abrirBtns = [document.getElementById("navbarMenuBtn"), document.getElementById("jzNavMas")].filter(Boolean);
		var contraerBtn = document.getElementById("jzNavContraer");
		var cuentaBtn = document.getElementById("jzCuentaBtn");
		var cuentaMenu = document.getElementById("jzCuentaMenu");
		var tip = document.getElementById("jzNavTip");
		var logoutBtn = document.getElementById("navbarLogoutBtn");

		// La página actual a la vista dentro de la barra (si el menú no cabe, se desplaza la barra, no la página)
		var cuerpoLat = panel.querySelector(".jz-lat-cuerpo");
		var actual = panel.querySelector(".jz-menu [aria-current]");
		if (cuerpoLat && actual && esEscritorio()) {
			var rc = cuerpoLat.getBoundingClientRect(), ra = actual.getBoundingClientRect();
			if (ra.bottom > rc.bottom) cuerpoLat.scrollTop += ra.bottom - rc.bottom + 24;
		}

		// Grupo activo: si js/grupo-activo.js ya lo leyó, lo pinta en los lugares nuevos
		if (window.GrupoActivo && window.GrupoActivo.repintar) window.GrupoActivo.repintar();

		// Selector de secciones: solo con el acceso confirmado por el candado
		if (window.saasAcceso && window.Secciones) {
			window.saasAcceso.then(function () {
				if (SECCION === "salon") window.Secciones.guardarUltima("salon"); // Sala: js/sala-maestros.js
				var slot = document.getElementById("jzNavSecciones");
				if (slot && window.Secciones.selectorNav) slot.innerHTML = window.Secciones.selectorNav(SECCION);
			});
		}

		// Nombre de la cuenta
		if (window.sb && window.sb.auth) {
			window.sb.auth.getSession().then(function (res) {
				var user = res && res.data && res.data.session ? res.data.session.user : null;
				if (!user) return;
				var meta = user.user_metadata || {};
				var nombre = String(meta.nombre_docente || meta.full_name || user.email || "").trim();
				if (!nombre) return;
				Array.prototype.forEach.call(nav.querySelectorAll(".jz-cuenta-nombre"), function (el) { el.textContent = nombre; });
				Array.prototype.forEach.call(nav.querySelectorAll(".jz-avatar"), function (el) { el.textContent = nombre.charAt(0); });
				if (cuentaBtn) { cuentaBtn.setAttribute("data-tip", nombre); cuentaBtn.setAttribute("aria-label", "Cuenta: " + nombre); }
			}).catch(function () {});
		}

		// ── Panel (celular y tablet vertical) ──
		var abierto = false, volverA = null;
		function abrir(desde) {
			if (esEscritorio() || abierto) return;
			abierto = true;
			volverA = desde || null;
			raiz.classList.add("jz-nav-abierto");
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-modal", "true");
			abrirBtns.forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
			var cerrarBtn = panel.querySelector(".jz-lat-cabeza [data-nav-cerrar]");
			setTimeout(function () { if (abierto && cerrarBtn) cerrarBtn.focus(); }, 30);
		}
		function cerrar(sinFoco) {
			if (!abierto) return;
			abierto = false;
			raiz.classList.remove("jz-nav-abierto");
			panel.removeAttribute("role");
			panel.removeAttribute("aria-modal");
			abrirBtns.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
			if (!sinFoco && volverA && volverA.focus) { try { volverA.focus(); } catch (_) {} }
			volverA = null;
		}
		abrirBtns.forEach(function (b) {
			b.addEventListener("click", function (e) { e.stopPropagation(); if (abierto) cerrar(); else abrir(b); });
		});
		Array.prototype.forEach.call(nav.querySelectorAll("[data-nav-cerrar]"), function (el) {
			el.addEventListener("click", function () { cerrar(); });
		});
		// Un enlace del panel lleva a otra página: se cierra sin esperar (por si la página no cambia)
		panel.addEventListener("click", function (e) {
			var a = e.target.closest ? e.target.closest("a[href]") : null;
			if (a && abierto) cerrar(true);
		});

		// ── Cuenta (PC) ──
		function cerrarCuenta(conFoco) {
			if (!cuentaMenu || !cuentaMenu.classList.contains("jz-abierto")) return;
			cuentaMenu.classList.remove("jz-abierto");
			if (cuentaBtn) cuentaBtn.setAttribute("aria-expanded", "false");
			if (conFoco && cuentaBtn) cuentaBtn.focus();
		}
		if (cuentaBtn && cuentaMenu) {
			cuentaBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				var ya = cuentaMenu.classList.toggle("jz-abierto");
				cuentaBtn.setAttribute("aria-expanded", ya ? "true" : "false");
				ocultarTip();
				if (ya) { var p = enfocables(cuentaMenu)[0]; if (p) p.focus(); }
			});
			document.addEventListener("click", function (e) {
				if (!cuentaMenu.contains(e.target) && !cuentaBtn.contains(e.target)) cerrarCuenta(false);
			});
		}

		// ── Teclado: Esc cierra; Tab no sale del panel abierto ──
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				if (abierto) { cerrar(); return; }
				if (cuentaMenu && cuentaMenu.classList.contains("jz-abierto")) cerrarCuenta(true);
				return;
			}
			if (e.key === "Tab" && abierto) {
				var lista = enfocables(panel);
				if (!lista.length) return;
				var primero = lista[0], ultimo = lista[lista.length - 1];
				if (!panel.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
				if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
				else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
			}
		});

		// Al pasar a PC con el panel abierto, se cierra (la barra ya está a la vista)
		if (window.matchMedia) {
			var mq = window.matchMedia("(min-width: " + CORTE + "px)");
			var alCambiar = function () { if (mq.matches) cerrar(true); else cerrarCuenta(false); ocultarTip(); };
			if (mq.addEventListener) mq.addEventListener("change", alCambiar);
			else if (mq.addListener) mq.addListener(alCambiar);
		}

		// ── Contraer (PC) ──
		function pintarContraida() {
			var si = raiz.classList.contains("jz-nav-contraida");
			if (contraerBtn) {
				contraerBtn.setAttribute("aria-expanded", si ? "false" : "true");
				contraerBtn.setAttribute("aria-label", si ? "Expandir el menú" : "Contraer el menú");
			}
		}
		pintarContraida();
		if (contraerBtn) {
			contraerBtn.addEventListener("click", function () {
				var si = !raiz.classList.contains("jz-nav-contraida");
				raiz.classList.toggle("jz-nav-contraida", si);
				guardarContraida(si);
				cerrarCuenta(false);
				ocultarTip();
				pintarContraida();
			});
		}

		// Grupo con la barra contraída: el botón la expande y lleva al selector
		var grupoMini = document.getElementById("jzGrupoMini");
		if (grupoMini) {
			grupoMini.addEventListener("click", function () {
				raiz.classList.remove("jz-nav-contraida");
				guardarContraida(false);
				pintarContraida();
				ocultarTip();
				var control = nav.querySelector(".jz-grupo-slot--lateral select, .jz-grupo-slot--lateral .jz-grupo-nombre");
				if (control && control.focus) control.focus();
			});
			document.addEventListener("jissez:grupo-activo", function (e) {
				var nombre = e && e.detail && e.detail.nombre;
				if (!nombre) return;
				grupoMini.setAttribute("data-tip", "Grupo: " + nombre);
				grupoMini.setAttribute("aria-label", "Grupo activo: " + nombre + ". Expandir el menú para cambiarlo");
			});
		}

		// ── Tooltip de la barra contraída (no lo recorta el scroll de la barra) ──
		var tipDe = null;
		function ocultarTip() { tipDe = null; if (tip) tip.hidden = true; }
		function mostrarTip(el) {
			if (!tip || !raiz.classList.contains("jz-nav-contraida") || !esEscritorio()) return;
			if (cuentaMenu && cuentaMenu.contains(el)) return;
			var texto = el.getAttribute("data-tip");
			if (!texto) return;
			tipDe = el;
			tip.textContent = texto;
			tip.hidden = false;
			var r = el.getBoundingClientRect();
			tip.style.left = Math.round(r.right + 10) + "px";
			tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + "px";
		}
		function objetivo(e) { return e.target && e.target.closest ? e.target.closest("[data-tip]") : null; }
		panel.addEventListener("mouseover", function (e) { var el = objetivo(e); if (el && el !== tipDe) mostrarTip(el); });
		panel.addEventListener("mouseleave", ocultarTip);
		panel.addEventListener("focusin", function (e) { var el = objetivo(e); if (el) mostrarTip(el); else ocultarTip(); });
		panel.addEventListener("focusout", function (e) { if (!panel.contains(e.relatedTarget)) ocultarTip(); });
		var cuerpo = panel.querySelector(".jz-lat-cuerpo");
		if (cuerpo) cuerpo.addEventListener("scroll", ocultarTip, { passive: true });

		// ── Saltar al contenido: el main de la página (o lo primero que no es la barra) ──
		var saltar = nav.querySelector("[data-nav-saltar]");
		if (saltar) {
			saltar.addEventListener("click", function (e) {
				e.preventDefault();
				var destino = document.querySelector("main");
				if (!destino) {
					for (var el = nav.nextElementSibling; el; el = el.nextElementSibling) {
						if (!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) && el.offsetParent !== null) { destino = el; break; }
					}
				}
				if (!destino) return;
				if (!destino.hasAttribute("tabindex")) destino.setAttribute("tabindex", "-1");
				destino.focus();
			});
		}

		// ── Cerrar sesión ──
		if (logoutBtn) {
			logoutBtn.addEventListener("click", async function () {
				cerrarCuenta(false);
				// Capturas de Hoy sin enviar en este dispositivo: se avisa y se pide confirmar
				// (se quedan guardadas para cuando vuelva a entrar; js/bandeja-salida.js)
				if (window.BandejaSalida && window.BandejaSalida.confirmarSalida && !(await window.BandejaSalida.confirmarSalida(window.sb))) return;
				var etiqueta = logoutBtn.querySelector(".jz-txt");
				logoutBtn.disabled = true;
				if (etiqueta) etiqueta.textContent = "Cerrando...";
				// Con la sesión cerrada, a la portada de la tienda. Dentro de /salon/ (la app
				// instalable, js/app-instalada.js), al login de la app, que regresa a Hoy.
				var enApp = !!(window.AppInstalada && window.AppInstalada.estaEnSalon());
				var result = null;
				try {
					result = window.sb ? await window.sb.auth.signOut() : null;
				} catch (error) {
					result = { error: error };
				}
				if (result && result.error) {
					logoutBtn.disabled = false;
					if (etiqueta) etiqueta.textContent = "Cerrar sesión";
					return;
				}
				if (enApp) { window.location.href = window.AppInstalada.urlLogin(); return; }
				window.location.href = "tienda/index.html";
			});
		}
	}

	if (hayVentana) {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
		else montar();
	}

	return {
		CORTE: CORTE,
		CLAVE_CONTRAIDA: CLAVE_CONTRAIDA,
		ANCHO: ANCHO,
		ANCHO_CONTRAIDA: ANCHO_CONTRAIDA,
		ALTO_ABAJO: ALTO_ABAJO,
		CSS: CSS,
		esLateral: esLateral,
		leerContraida: leerContraida,
		guardarContraida: guardarContraida,
		paginaDe: paginaDe,
		activoDe: activoDe,
		tituloDe: tituloDe,
		accesosDe: accesosDe,
		construir: construir,
		reservar: reservar,
	};
})();
if (typeof module !== "undefined" && module.exports) module.exports = Navegacion; // pruebas en node
