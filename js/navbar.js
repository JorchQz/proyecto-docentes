(function () {
	var NAV_ITEMS = [
		{
			key: "dashboard",
			href: "dashboard.html",
			label: "Inicio",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
		},
		{
			key: "hoy",
			href: "hoy.html",
			label: "Hoy",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/><path d="M9 16h6"/></svg>',
		},
		{
			key: "asistencia",
			href: "asistencia.html",
			label: "Asistencia",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
		},
		{
			key: "actividades",
			href: "actividades.html",
			label: "Actividades",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="M7 16V8"/><path d="M12 16V5"/><path d="M17 16v-4"/></svg>',
		},
		{
			key: "tareas",
			href: "tareas.html",
			label: "Tareas",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11.5 11 13.5l4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>',
		},
		{
			key: "reportes",
			href: "reportes.html",
			label: "Reportes",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 20V10"/><path d="M12 20V4"/><path d="M18 20v-7"/></svg>',
		},
		{
			key: "planeacion",
			href: "planeacion.html",
			label: "Proyectos",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
		},
	];

	var MENU_ITEMS = [
		{ key: "mi-cuenta", href: "mi-cuenta.html", label: "Mi cuenta" },
		{ key: "mi-grupo", href: "mi-grupo.html", label: "Mi grupo" },
		{ key: "evaluacion-diagnostica", href: "evaluacion_diagnostica.html", label: "Diagnóstico" },
		{ key: "examen", href: "examen.html", label: "Exámenes" },
		{ key: "marketplace", href: "marketplace.html", label: "Marketplace" },
		{ key: "ajustes", href: "ajustes.html", label: "Ajustes" },
	];

	function getCurrentPage() {
		var path = window.location.pathname;
		var filename = path.split("/").pop() || "dashboard.html";
		return filename.replace(".html", "");
	}

	function buildNavbar() {
		var currentPage = getCurrentPage();

		var navLinksHtml = NAV_ITEMS.map(function (item) {
			var isActive = currentPage === item.key;
			var cls =
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors " +
				(isActive
					? "text-white bg-blue-700"
					: "text-blue-100 hover:text-white hover:bg-blue-700");
			return '<a href="' + item.href + '" class="' + cls + '"' + (isActive ? ' aria-current="page"' : "") + ">" + item.icon + item.label + "</a>";
		}).join("");

		var menuItemsHtml = MENU_ITEMS.map(function (item) {
			var isActive = currentPage === item.key;
			if (isActive) {
				return (
					'<span class="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-blue-700 bg-blue-50">' +
					item.label +
					"</span>"
				);
			}
			return (
				'<a href="' +
				item.href +
				'" class="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors">' +
				item.label +
				"</a>"
			);
		}).join("");

		return (
			// #app-navbar es solo el contenedor fijo: la navegación "Mi Salón" es la fila de
			// adentro, y el selector de secciones (que va en este contenedor) queda como su
			// hermana, no anidada en ella
			'<div id="app-navbar" class="fixed top-0 left-0 right-0 z-30 bg-blue-800 shadow-md">' +
			'<nav aria-label="Mi Salón" class="max-w-4xl mx-auto px-4 h-14 flex items-center gap-2">' +
			'<div class="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">' +
			navLinksHtml +
			"</div>" +
			// La cuenta: en PC sube a la fila de marca del selector de secciones; en celular
			// se queda aquí, junto al carrusel (ver acomodarCuenta)
			'<div id="navCuenta" class="relative shrink-0 ml-2 flex items-center gap-2">' +
			// Nombre del grupo activo (solo aparece con 2+ grupos; lo llena js/grupo-activo.js)
			'<span id="navGrupoActivo" class="hidden max-w-[9rem] truncate rounded-lg bg-blue-900/60 px-2 py-1 text-xs font-medium text-blue-100"></span>' +
			'<button id="navbarMenuBtn" type="button" aria-label="Abrir menú" aria-haspopup="true" aria-expanded="false" aria-controls="navbarMenuPanel" ' +
			'class="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-blue-600 bg-blue-700 text-white hover:bg-blue-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">' +
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>' +
			"</svg>" +
			"</button>" +
			'<div id="navbarMenuPanel" class="hidden absolute right-0 top-full mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-md p-1 z-40">' +
			'<div id="navGrupoSlot" class="hidden"></div>' +
			menuItemsHtml +
			// "Instalar la app" (js/app-instalada.js lo muestra solo si se puede y no está instalada)
			'<button id="navbarInstalarBtn" type="button" class="hidden w-full min-h-[44px] flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm font-medium text-blue-800 hover:bg-blue-50 transition-colors">' +
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M9 18h6"/></svg>' +
			"Instalar la app</button>" +
			'<button id="navbarLogoutBtn" type="button" class="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-red-700 hover:bg-red-50 transition-colors">Cerrar sesión</button>' +
			"</div>" +
			"</div>" +
			"</nav>" +
			"</div>"
		);
	}

	// Con la fila de marca del selector (PC y tablet), la barra de Mi Salón baja lo que mide
	// esa fila, y con ella lo que las páginas ponen fijo justo debajo (top-14: momento del
	// diagnóstico, encabezados de evaluación y examen, filtros del marketplace). En celular
	// la fila no se ve y todo queda como antes.
	function estilosBarra(alto) {
		if (document.getElementById("navbar-secciones-css")) return;
		var st = document.createElement("style");
		st.id = "navbar-secciones-css";
		st.textContent =
			"@media screen and (min-width:768px){" +
			"html.jz-secciones-fija #app-navbar{top:" + alto + "px}" +
			"html.jz-secciones-fija .fixed.top-14,html.jz-secciones-fija .sticky.top-14{top:calc(3.5rem + " + alto + "px)}" +
			"}" +
			// En la fila de marca (más oscura) el botón del menú va discreto, como el resto de la fila
			".jz-sec-cuenta #navbarMenuBtn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16)}" +
			".jz-sec-cuenta #navbarMenuBtn:hover{background:rgba(255,255,255,.16)}" +
			".jz-sec-cuenta #navGrupoActivo{background:rgba(255,255,255,.1)}";
		document.head.appendChild(st);
	}

	document.addEventListener("DOMContentLoaded", function () {
		var wrapper = document.createElement("div");
		wrapper.innerHTML = buildNavbar();
		var nav = wrapper.firstChild;
		document.body.insertBefore(nav, document.body.firstChild);

		// Selector de secciones (Tienda, Mi Salón, Sala de Maestros): fila de marca arriba en
		// PC y barra abajo en celular. Va DENTRO de #app-navbar (las dos piezas son fijas) para
		// que el aviso de js/lectura.js las deje a la vista y la impresión las oculte con la barra.
		if (window.Secciones) {
			estilosBarra(window.Secciones.ALTO_BARRA);
			var secciones = window.Secciones.montar({ actual: "salon", arriba: nav, abajo: nav, fija: true });
			var cuenta = document.getElementById("navCuenta");
			var fila = cuenta ? cuenta.parentNode : null;
			var acomodarCuenta = function () {
				if (!cuenta || !fila) return;
				if (window.Secciones.esEscritorio()) {
					if (cuenta.parentNode !== secciones.cuenta) secciones.cuenta.appendChild(cuenta);
				} else if (cuenta.parentNode !== fila) {
					fila.appendChild(cuenta);
				}
			};
			acomodarCuenta();
			if (window.matchMedia) {
				var mq = window.matchMedia("(min-width: 768px)");
				if (mq.addEventListener) mq.addEventListener("change", acomodarCuenta);
				else if (mq.addListener) mq.addListener(acomodarCuenta);
			}
			// Última sección: solo cuando el candado confirmó el acceso
			if (window.saasAcceso) window.saasAcceso.then(function () { window.Secciones.guardarUltima("salon"); });
		}

		var btn = document.getElementById("navbarMenuBtn");
		var panel = document.getElementById("navbarMenuPanel");
		var logoutBtn = document.getElementById("navbarLogoutBtn");

		if (!btn || !panel) {
			return;
		}

		function cerrarMenu() {
			panel.classList.add("hidden");
			btn.setAttribute("aria-expanded", "false");
		}

		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			panel.classList.toggle("hidden");
			btn.setAttribute("aria-expanded", panel.classList.contains("hidden") ? "false" : "true");
		});

		document.addEventListener("click", function (e) {
			if (!panel.classList.contains("hidden")) {
				if (!panel.contains(e.target) && !btn.contains(e.target)) {
					cerrarMenu();
				}
			}
		});

		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				cerrarMenu();
			}
		});

		if (logoutBtn) {
			logoutBtn.addEventListener("click", async function () {
				panel.classList.add("hidden");
				logoutBtn.disabled = true;
				logoutBtn.textContent = "Cerrando...";
				// Como en la tienda y en Sala de Maestros: con la sesión cerrada, a la portada de la
				// tienda (antes la pantalla se quedaba en el panel). Dentro de /salon/ (la app
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
					logoutBtn.textContent = "Cerrar sesión";
					return;
				}
				if (enApp) { window.location.href = window.AppInstalada.urlLogin(); return; }
				window.location.href = "tienda/index.html";
			});
		}
	});
})();
