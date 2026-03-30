(function () {
	var NAV_ITEMS = [
		{
			key: "dashboard",
			href: "dashboard.html",
			label: "Inicio",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
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
			key: "crear_proyecto",
			href: "crear_proyecto.html",
			label: "Proyectos",
			icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
		},
	];

	var MENU_ITEMS = [
		{ key: "mi-cuenta", href: "mi-cuenta.html", label: "Mi cuenta" },
		{ key: "mi-grupo", href: "mi-grupo.html", label: "Mi grupo" },
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
			return '<a href="' + item.href + '" class="' + cls + '">' + item.icon + item.label + "</a>";
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
			'<nav id="app-navbar" class="fixed top-0 left-0 right-0 z-30 bg-blue-800 shadow-md">' +
			'<div class="max-w-4xl mx-auto px-4 h-14 flex items-center gap-2">' +
			'<div class="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">' +
			navLinksHtml +
			"</div>" +
			'<div class="relative shrink-0 ml-2">' +
			'<button id="navbarMenuBtn" type="button" aria-label="Abrir menú" ' +
			'class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-blue-600 bg-blue-700 text-white hover:bg-blue-600 transition-colors">' +
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>' +
			"</svg>" +
			"</button>" +
			'<div id="navbarMenuPanel" class="hidden absolute right-0 top-full mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-md p-1 z-40">' +
			menuItemsHtml +
			'<button id="navbarLogoutBtn" type="button" class="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-red-700 hover:bg-red-50 transition-colors">Cerrar sesión</button>' +
			"</div>" +
			"</div>" +
			"</div>" +
			"</nav>"
		);
	}

	document.addEventListener("DOMContentLoaded", function () {
		var wrapper = document.createElement("div");
		wrapper.innerHTML = buildNavbar();
		document.body.insertBefore(wrapper.firstChild, document.body.firstChild);

		var btn = document.getElementById("navbarMenuBtn");
		var panel = document.getElementById("navbarMenuPanel");
		var logoutBtn = document.getElementById("navbarLogoutBtn");

		if (!btn || !panel) {
			return;
		}

		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			panel.classList.toggle("hidden");
		});

		document.addEventListener("click", function (e) {
			if (!panel.classList.contains("hidden")) {
				if (!panel.contains(e.target) && !btn.contains(e.target)) {
					panel.classList.add("hidden");
				}
			}
		});

		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				panel.classList.add("hidden");
			}
		});

		if (logoutBtn) {
			logoutBtn.addEventListener("click", async function () {
				panel.classList.add("hidden");
				logoutBtn.disabled = true;
				logoutBtn.textContent = "Cerrando...";
				if (window.sb) {
					var result = await window.sb.auth.signOut();
					if (result.error) {
						logoutBtn.disabled = false;
						logoutBtn.textContent = "Cerrar sesión";
					}
				}
			});
		}
	});
})();
