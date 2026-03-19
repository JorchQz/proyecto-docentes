document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado. Regresando al login.");
		window.location.href = "index.html";
		return;
	}

	var emailEl = document.getElementById("userEmail");
	var userNameEl = document.getElementById("userName");
	var welcomeTitleEl = document.getElementById("welcomeTitle");
	var mainMenuBtn = document.getElementById("mainMenuBtn");
	var mainMenuPanel = document.getElementById("mainMenuPanel");
	var logoutBtn = document.getElementById("logoutBtn");
	var homeMessageEl = document.getElementById("homeMessage");
	var homePreferencesForm = document.getElementById("homePreferencesForm");
	var homePrefsContainer = document.getElementById("homePrefsContainer");
	var saveHomePrefsBtn = document.getElementById("saveHomePrefsBtn");
	var homeCardsEl = document.getElementById("homeCards");

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var currentUser = sessionResult.data.session.user;
	var userId = currentUser.id;

	var widgetsCatalog = [
		{
			id: "asistencia",
			title: "Lista de asistencia",
			description: "Pase de lista rápido para iniciar la jornada.",
			link: "asistencia.html",
			buttonText: "Abrir asistencia",
		},
		{
			id: "actividades",
			title: "Actividades",
			description: "Actividades del día a día para trabajo en clase.",
			link: "actividades.html",
			buttonText: "Abrir actividades",
		},
		{
			id: "tareas",
			title: "Tareas",
			description: "Gestiona entregas y seguimiento de tareas.",
			link: "tareas.html",
			buttonText: "Abrir tareas",
		},
		{
			id: "reportes",
			title: "Reportes",
			description: "Genera y descarga reportes de desempeño.",
			link: "reportes.html",
			buttonText: "Abrir reportes",
		},
	];

	var groupSummary = null;
	var homeLayout = getHomeLayoutFromMetadata(currentUser.user_metadata, widgetsCatalog);

	if (emailEl) {
		emailEl.textContent = currentUser.email || "Usuario autenticado";
	}

	if (userNameEl) {
		userNameEl.textContent = getTeacherNameFromUser(currentUser);
	}

	if (welcomeTitleEl) {
		welcomeTitleEl.textContent = getWelcomeTitleFromUser(currentUser);
	}

	bindMainMenu();
	await loadGroupSummary();
	renderPreferencesForm();
	renderHomeCards();

	window.sb.auth.onAuthStateChange(function (event) {
		if (event === "SIGNED_OUT") {
			window.location.href = "index.html";
		}
	});

	if (logoutBtn) {
		logoutBtn.addEventListener("click", async function () {
			closeMainMenu();
			logoutBtn.disabled = true;
			logoutBtn.classList.add("opacity-70", "cursor-not-allowed");

			var result = await window.sb.auth.signOut();
			if (result.error) {
				showMessage("error", "No se pudo cerrar sesion: " + result.error.message);
				logoutBtn.disabled = false;
				logoutBtn.classList.remove("opacity-70", "cursor-not-allowed");
			}
		});
	}

	if (homePreferencesForm) {
		homePreferencesForm.addEventListener("submit", async function (event) {
			event.preventDefault();
			var updatedLayout = readLayoutFromForm();
			homeLayout = normalizeLayout(updatedLayout, widgetsCatalog);

			setButtonLoading(saveHomePrefsBtn, true, "Guardando...");
			clearMessage();

			try {
				var metadata = Object.assign({}, currentUser.user_metadata || {}, {
					home_layout_v1: homeLayout,
				});

				var updateResult = await window.sb.auth.updateUser({ data: metadata });
				if (updateResult.error) {
					throw updateResult.error;
				}

				currentUser = updateResult.data.user || currentUser;
				showMessage("success", "Configuración de inicio guardada.");
				renderPreferencesForm();
				renderHomeCards();
			} catch (error) {
				showMessage(
					"error",
					"No se pudo guardar tu configuración: " +
						(error.message || "Error desconocido")
				);
			} finally {
				setButtonLoading(saveHomePrefsBtn, false, "Guardar configuración");
			}
		});
	}

	async function loadGroupSummary() {
		var groupResult = await window.sb
			.from("grupos")
			.select("id, nombre, tipo_organizacion, grados")
			.eq("maestro_id", userId)
			.order("id", { ascending: true })
			.limit(1);

		if (groupResult.error || !groupResult.data || groupResult.data.length === 0) {
			groupSummary = null;
			return;
		}

		groupSummary = groupResult.data[0];
	}

	function renderPreferencesForm() {
		if (!homePrefsContainer) {
			return;
		}

		homePrefsContainer.innerHTML = "";

		var totalWidgets = widgetsCatalog.length;
		widgetsCatalog.forEach(function (widget) {
			var config = homeLayout[widget.id] || { visible: true, order: totalWidgets };

			var row = document.createElement("div");
			row.className =
				"flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border border-gray-200 p-3";

			var label = document.createElement("label");
			label.className = "flex items-start gap-3";
			label.innerHTML =
				"<input type='checkbox' class='mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500' data-widget-visible='" +
				widget.id +
				"' " +
				(config.visible ? "checked" : "") +
				">" +
				"<span><span class='block text-sm font-medium text-gray-800'>" +
				widget.title +
				"</span><span class='block text-xs text-gray-500'>" +
				widget.description +
				"</span></span>";

			var orderWrapper = document.createElement("div");
			orderWrapper.className = "flex items-center gap-2";
			orderWrapper.innerHTML =
				"<span class='text-sm text-gray-600'>Orden</span>" +
				"<select data-widget-order='" +
				widget.id +
				"' class='px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500'>" +
				buildOrderOptions(totalWidgets, config.order) +
				"</select>";

			row.appendChild(label);
			row.appendChild(orderWrapper);
			homePrefsContainer.appendChild(row);
		});
	}

	function buildOrderOptions(total, current) {
		var options = "";
		for (var i = 1; i <= total; i += 1) {
			options +=
				"<option value='" +
				i +
				"' " +
				(i === current ? "selected" : "") +
				">" +
				i +
				"</option>";
		}
		return options;
	}

	function readLayoutFromForm() {
		var layout = {};
		widgetsCatalog.forEach(function (widget) {
			var visibleInput = document.querySelector(
				"[data-widget-visible='" + widget.id + "']"
			);
			var orderInput = document.querySelector(
				"[data-widget-order='" + widget.id + "']"
			);

			layout[widget.id] = {
				visible: Boolean(visibleInput && visibleInput.checked),
				order: orderInput ? parseInt(orderInput.value, 10) : widgetsCatalog.length,
			};
		});

		return layout;
	}

	function renderHomeCards() {
		if (!homeCardsEl) {
			return;
		}

		homeCardsEl.innerHTML = "";

		var visibleWidgets = widgetsCatalog
			.filter(function (widget) {
				return homeLayout[widget.id] && homeLayout[widget.id].visible;
			})
			.sort(function (a, b) {
				return homeLayout[a.id].order - homeLayout[b.id].order;
			});

		if (visibleWidgets.length === 0) {
			var empty = document.createElement("div");
			empty.className =
				"md:col-span-2 bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-sm text-gray-500";
			empty.textContent =
				"No tienes módulos visibles. Activa al menos uno en la configuración de inicio.";
			homeCardsEl.appendChild(empty);
			return;
		}

		visibleWidgets.forEach(function (widget) {
			var card = document.createElement("article");
			card.className = "rounded-2xl border border-gray-200 bg-white p-6 shadow-sm";

			var body =
				"<h3 class='text-base font-semibold text-gray-800'>" +
				widget.title +
				"</h3>" +
				"<p class='mt-2 text-sm text-gray-500'>" +
				getWidgetDescription(widget) +
				"</p>";

			if (widget.comingSoon) {
				body +=
					"<span class='inline-flex mt-3 px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800'>Próximamente</span>";
			} else if (widget.link) {
				body +=
					"<a href='" +
					widget.link +
					"' class='inline-flex mt-3 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors'>" +
					(widget.buttonText || "Abrir") +
					"</a>";
			}

			card.innerHTML = body;
			homeCardsEl.appendChild(card);
		});
	}

	function getWidgetDescription(widget) {
		if (!groupSummary) {
			return widget.description;
		}

		if (widget.id === "asistencia") {
			return (
				widget.description +
				" Grupo activo: " +
				(groupSummary.nombre || "Sin nombre")
			);
		}

		return widget.description;
	}

	function getHomeLayoutFromMetadata(metadata, catalog) {
		var rawLayout = (metadata && metadata.home_layout_v1) || {};
		return normalizeLayout(rawLayout, catalog);
	}

	function normalizeLayout(layout, catalog) {
		var normalized = {};
		catalog.forEach(function (widget, index) {
			var current = layout[widget.id] || {};
			normalized[widget.id] = {
				visible: typeof current.visible === "boolean" ? current.visible : true,
				order:
					typeof current.order === "number" && current.order >= 1
						? current.order
						: index + 1,
			};
		});
		return normalized;
	}

	function bindMainMenu() {
		if (!mainMenuBtn || !mainMenuPanel) {
			return;
		}

		mainMenuBtn.addEventListener("click", function (event) {
			event.stopPropagation();
			mainMenuPanel.classList.toggle("hidden");
		});

		document.addEventListener("click", function (event) {
			if (!mainMenuPanel.classList.contains("hidden")) {
				var clickInsideMenu = mainMenuPanel.contains(event.target);
				var clickInsideButton = mainMenuBtn.contains(event.target);

				if (!clickInsideMenu && !clickInsideButton) {
					closeMainMenu();
				}
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				closeMainMenu();
			}
		});
	}

	function closeMainMenu() {
		if (!mainMenuPanel) {
			return;
		}

		mainMenuPanel.classList.add("hidden");
	}

	function getTeacherNameFromUser(userData) {
		if (!userData || !userData.user_metadata) {
			return "Docente";
		}

		var name =
			userData.user_metadata.nombre_docente || userData.user_metadata.full_name || "";

		return (name || "").trim() || "Docente";
	}

	function getWelcomeTitleFromUser(userData) {
		var name = getTeacherNameFromUser(userData);
		var metadata = (userData && userData.user_metadata) || {};
		var sex = (metadata.sexo_docente || "").trim().toLowerCase();

		if (sex === "profesora") {
			return "Bienvenida profesora " + name;
		}

		if (sex === "profesor") {
			return "Bienvenido profesor " + name;
		}

		return "Bienvenido profesor(a) " + name;
	}

	function mapGroupType(groupType) {
		var typeMap = {
			multigrado: "Multigrado",
			bidocente: "Bidocente",
			tridocente: "Tridocente",
			normal: "Organización Completa",
		};

		return typeMap[groupType] || groupType || "N/A";
	}

	function setButtonLoading(button, isLoading, loadingText) {
		if (!button) {
			return;
		}

		if (!button.dataset.defaultText) {
			button.dataset.defaultText = button.textContent;
		}

		button.disabled = isLoading;
		if (isLoading) {
			button.classList.add("opacity-70", "cursor-not-allowed");
			button.textContent = loadingText;
			return;
		}

		button.classList.remove("opacity-70", "cursor-not-allowed");
		button.textContent = button.dataset.defaultText;
	}

	function showMessage(type, text) {
		if (!homeMessageEl) {
			return;
		}

		homeMessageEl.textContent = text;
		homeMessageEl.className =
			"mb-6 rounded-lg px-4 py-3 text-sm " +
			(type === "success"
				? "bg-blue-100 text-blue-800"
				: "bg-red-100 text-red-800");
	}

	function clearMessage() {
		if (!homeMessageEl) {
			return;
		}

		homeMessageEl.textContent = "";
		homeMessageEl.className = "mb-6";
	}
});
