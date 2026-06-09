document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	// ── Auth ──────────────────────────────────────────────────────────────────
	const { data: { user }, error: authError } = await window.sb.auth.getUser();
	if (authError || !user) {
		window.location.href = "index.html";
		return;
	}

	// ── DOM refs ──────────────────────────────────────────────────────────────
	const estadoEl          = document.getElementById("estado");
	const gridEl            = document.getElementById("grid");
	const chipsGradoEl      = document.getElementById("chipsGrado");
	const filtroCampoEl     = document.getElementById("filtroCampo");
	const filtroMetodoEl    = document.getElementById("filtroMetodologia");
	const filtroTrimestreEl = document.getElementById("filtroTrimestre");
	const contadorTextoEl   = document.getElementById("contadorTexto");
	const modalEl           = document.getElementById("modalPreview");
	const previewTituloEl   = document.getElementById("previewTitulo");
	const previewBodyEl     = document.getElementById("previewBody");
	const btnCerrarPreview  = document.getElementById("btnCerrarPreview");
	const btnPreviewCerrar  = document.getElementById("btnPreviewCerrarPie");
	const btnPreviewImport  = document.getElementById("btnPreviewImportar");

	// ── Estado local ──────────────────────────────────────────────────────────
	let todosLosProyectos = [];
	let gradosActivos     = new Set();   // strings "1".."6"
	let grupoId           = null;
	let proyectoPreviewId = null;        // id del proyecto abierto en el modal
	let toastEl           = null;

	// dosificacion usa nombres completos; los dropdowns usan abreviaciones
	const METODOLOGIA_MAP = {
		"Proyectos Comunitarios": "ABPC",
		"Indagación (STEAM)": "STEAM",
		"Aprendizaje Basado en Problemas": "ABP",
		"Aprendizaje Servicio": "AS",
	};

	// ── Init ──────────────────────────────────────────────────────────────────
	await cargarGrupo();
	bindFiltros();
	bindModal();
	await cargarProyectos();

	// =========================================================================
	// CARGA DE DATOS
	// =========================================================================

	async function cargarGrupo() {
		const { data, error } = await window.sb
			.from("grupos")
			.select("id")
			.eq("maestro_id", user.id)
			.order("created_at", { ascending: true })
			.limit(1);

		if (!error && data && data.length) {
			grupoId = data[0].id;
		}
	}

	async function cargarProyectos() {
		mostrarCargando();

		// Nota: el estado terminal de dosificacion_proyectos es 'publicado'
		// (CHECK: pendiente · en_generacion · generado · revisado · publicado).
		// No existe 'aprobado' a nivel proyecto — ese es estado de sesión.
		const { data, error } = await window.sb
			.from("dosificacion_proyectos")
			.select("*, dosificacion_sesiones(count)")
			.eq("estado", "publicado")
			.order("created_at", { ascending: false });

		if (error) {
			mostrarError();
			return;
		}

		todosLosProyectos = data || [];

		if (!todosLosProyectos.length) {
			mostrarCatalogoVacio();
			return;
		}

		aplicarFiltros();
	}

	// =========================================================================
	// FILTROS (client-side)
	// =========================================================================

	function bindFiltros() {
		if (chipsGradoEl) {
			chipsGradoEl.addEventListener("click", function (e) {
				const chip = e.target.closest(".chip-grado");
				if (!chip) { return; }
				const g = chip.getAttribute("data-grado");
				if (gradosActivos.has(g)) {
					gradosActivos.delete(g);
					setChipActivo(chip, false);
				} else {
					gradosActivos.add(g);
					setChipActivo(chip, true);
				}
				aplicarFiltros();
			});
		}
		if (filtroCampoEl)     { filtroCampoEl.addEventListener("change", aplicarFiltros); }
		if (filtroMetodoEl)    { filtroMetodoEl.addEventListener("change", aplicarFiltros); }
		if (filtroTrimestreEl) { filtroTrimestreEl.addEventListener("change", aplicarFiltros); }
	}

	function setChipActivo(chip, activo) {
		if (activo) {
			chip.classList.remove("border-gray-300", "text-gray-600", "bg-white", "hover:bg-gray-50");
			chip.classList.add("border-emerald-600", "text-white", "bg-emerald-600");
		} else {
			chip.classList.add("border-gray-300", "text-gray-600", "bg-white", "hover:bg-gray-50");
			chip.classList.remove("border-emerald-600", "text-white", "bg-emerald-600");
		}
	}

	function aplicarFiltros() {
		// El catálogo vacío tiene su propio estado; no filtrar.
		if (!todosLosProyectos.length) { return; }

		const campo     = filtroCampoEl ? filtroCampoEl.value : "";
		const metodo    = filtroMetodoEl ? filtroMetodoEl.value : "";
		const trimestre = filtroTrimestreEl ? filtroTrimestreEl.value : "";

		let filtrados = todosLosProyectos.slice();

		// Grado: el proyecto debe contener al menos uno de los grados activos
		if (gradosActivos.size) {
			filtrados = filtrados.filter(function (p) {
				const grados = normalizarLista(p.grados).map(soloDigito);
				for (const g of gradosActivos) {
					if (grados.indexOf(g) !== -1) { return true; }
				}
				return false;
			});
		}

		// Campo formativo: contiene el campo seleccionado
		if (campo) {
			filtrados = filtrados.filter(function (p) {
				return normalizarLista(p.campos_formativos).indexOf(campo) !== -1;
			});
		}

		// Metodología: comparar contra la abreviación
		if (metodo) {
			filtrados = filtrados.filter(function (p) {
				return abrevMetodologia(p.metodologia) === metodo;
			});
		}

		// Trimestre
		if (trimestre) {
			filtrados = filtrados.filter(function (p) {
				return String(p.trimestre) === trimestre;
			});
		}

		if (contadorTextoEl) {
			const total = todosLosProyectos.length;
			contadorTextoEl.textContent = filtrados.length === total
				? total + (total === 1 ? " planeación" : " planeaciones")
				: filtrados.length + " de " + total;
		}

		if (!filtrados.length) {
			mostrarVacioFiltrado();
		} else {
			renderProyectos(filtrados);
		}
	}

	// =========================================================================
	// RENDER
	// =========================================================================

	function renderProyectos(proyectos) {
		if (!estadoEl || !gridEl) { return; }

		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";

		proyectos.forEach(function (p) {
			gridEl.appendChild(crearCard(p));
		});

		gridEl.onclick = manejarClickGrid;
	}

	function crearCard(proyecto) {
		const campos = normalizarLista(proyecto.campos_formativos);
		const grados = normalizarLista(proyecto.grados).map(soloDigito).filter(Boolean);
		const gradosTexto = grados.length
			? grados.map(function (g) { return g + "°"; }).join(", ")
			: "—";
		const metodo = abrevMetodologia(proyecto.metodologia) || proyecto.metodologia || "";
		const trimestre = proyecto.trimestre ? proyecto.trimestre + "° Trim." : "";
		const numSesiones = contarSesiones(proyecto);
		const titulo = proyecto.nombre_proyecto || proyecto.titulo || "Proyecto sin título";
		const descripcion = proyecto.producto_final || proyecto.pregunta_generadora || "";

		const card = document.createElement("article");
		card.className = "bg-white rounded-2xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-3";

		// Título
		const tituloEl = document.createElement("h3");
		tituloEl.className = "font-bold text-gray-800 text-base leading-snug";
		tituloEl.textContent = titulo;

		// Badges
		const badges = document.createElement("div");
		badges.className = "flex flex-wrap gap-1.5";
		let badgesHtml = "";
		if (metodo) {
			badgesHtml += '<span class="inline-flex items-center bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">' + esc(metodo) + "</span>";
		}
		campos.forEach(function (c) {
			badgesHtml += '<span class="inline-flex items-center bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">' + esc(c) + "</span>";
		});
		badgesHtml += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">👥 ' + gradosTexto + "</span>";
		if (trimestre) {
			badgesHtml += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">📅 ' + esc(trimestre) + "</span>";
		}
		badgesHtml += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">📄 ' + numSesiones + " " + (numSesiones === 1 ? "sesión" : "sesiones") + "</span>";
		badges.innerHTML = badgesHtml;

		// Descripción (truncada a 2 líneas)
		const desc = document.createElement("p");
		desc.className = "text-sm text-gray-500 leading-relaxed";
		desc.style.display = "-webkit-box";
		desc.style.webkitLineClamp = "2";
		desc.style.webkitBoxOrient = "vertical";
		desc.style.overflow = "hidden";
		desc.textContent = descripcion || "Sin descripción.";

		// Acciones
		const acciones = document.createElement("div");
		acciones.className = "border-t border-gray-100 pt-3 mt-auto flex flex-wrap gap-2";
		const btnBase = "inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition min-h-[44px]";
		acciones.innerHTML =
			'<button data-action="preview" data-id="' + esc(proyecto.id) + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50">👁 Vista previa</button>' +
			'<button data-action="importar" data-id="' + esc(proyecto.id) + '" class="' + btnBase + ' bg-emerald-600 hover:bg-emerald-700 text-white">⬇ Importar a mi cuenta</button>';

		card.appendChild(tituloEl);
		card.appendChild(badges);
		card.appendChild(desc);
		card.appendChild(acciones);
		return card;
	}

	// =========================================================================
	// MANEJO DE CLICKS (delegación)
	// =========================================================================

	function manejarClickGrid(event) {
		const btn = event.target.closest("[data-action]");
		if (!btn) { return; }
		const action = btn.getAttribute("data-action");
		const id     = btn.getAttribute("data-id");
		if (!action || !id) { return; }

		if (action === "preview")  { abrirPreview(id); return; }
		if (action === "importar") { importar(id, btn); return; }
	}

	// =========================================================================
	// MODAL DE VISTA PREVIA
	// =========================================================================

	function bindModal() {
		if (!modalEl) { return; }
		if (btnCerrarPreview) { btnCerrarPreview.addEventListener("click", cerrarPreview); }
		if (btnPreviewCerrar) { btnPreviewCerrar.addEventListener("click", cerrarPreview); }
		if (btnPreviewImport) {
			btnPreviewImport.addEventListener("click", function () {
				if (proyectoPreviewId) { importar(proyectoPreviewId, btnPreviewImport); }
			});
		}
		modalEl.addEventListener("click", function (e) {
			if (e.target === modalEl) { cerrarPreview(); }
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && !modalEl.classList.contains("hidden")) {
				cerrarPreview();
			}
		});
	}

	async function abrirPreview(id) {
		const proyecto = todosLosProyectos.find(function (p) { return String(p.id) === String(id); });
		if (!proyecto) { return; }

		proyectoPreviewId = id;
		if (previewTituloEl) {
			previewTituloEl.textContent = proyecto.nombre_proyecto || proyecto.titulo || "Proyecto sin título";
		}
		if (previewBodyEl) {
			previewBodyEl.innerHTML =
				'<div class="text-center py-8 text-gray-400">' +
				'<svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 mx-auto mb-2 animate-spin text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
				"Cargando sesiones...</div>";
		}
		if (modalEl) { modalEl.classList.remove("hidden"); }

		// Cargar sesiones del proyecto
		const { data: sesiones, error } = await window.sb
			.from("dosificacion_sesiones")
			.select("numero_sesion, momento_metodologico, campo_formativo, duracion_minutos")
			.eq("proyecto_dos_id", id)
			.order("numero_sesion", { ascending: true });

		// El usuario pudo cerrar el modal mientras cargaba
		if (String(proyectoPreviewId) !== String(id)) { return; }

		renderPreviewBody(proyecto, error ? null : (sesiones || []));
	}

	function renderPreviewBody(proyecto, sesiones) {
		if (!previewBodyEl) { return; }

		const metodo = abrevMetodologia(proyecto.metodologia) || proyecto.metodologia || "";
		const grados = normalizarLista(proyecto.grados).map(soloDigito).filter(Boolean)
			.map(function (g) { return g + "°"; }).join(", ");

		let html = "";

		// Meta
		html += '<div class="flex flex-wrap gap-1.5">';
		if (metodo)  { html += '<span class="inline-flex items-center bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">' + esc(metodo) + "</span>"; }
		if (grados)  { html += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">👥 ' + esc(grados) + "</span>"; }
		if (proyecto.trimestre) { html += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">📅 ' + esc(proyecto.trimestre) + "° Trim.</span>"; }
		normalizarLista(proyecto.campos_formativos).forEach(function (c) {
			html += '<span class="inline-flex items-center bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">' + esc(c) + "</span>";
		});
		html += "</div>";

		// Producto final / propósito
		if (proyecto.producto_final) {
			html += '<div><p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Producto final</p>' +
				'<p class="text-gray-700 leading-relaxed">' + esc(proyecto.producto_final) + "</p></div>";
		}

		// Pregunta generadora
		if (proyecto.pregunta_generadora) {
			html += '<div><p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pregunta generadora</p>' +
				'<p class="text-gray-700 leading-relaxed italic">"' + esc(proyecto.pregunta_generadora) + '"</p></div>';
		}

		// Sesiones
		html += '<div><p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sesiones (' + (sesiones ? sesiones.length : 0) + ")</p>";
		if (sesiones && sesiones.length) {
			html += '<ul class="flex flex-col gap-1.5">';
			sesiones.forEach(function (s) {
				const dur = s.duracion_minutos ? s.duracion_minutos + " min" : "";
				html += '<li class="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">' +
					'<span class="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">' + esc(s.numero_sesion) + "</span>" +
					'<div class="min-w-0 flex-1">' +
					'<p class="text-sm font-medium text-gray-700 truncate">' + esc(s.momento_metodologico || "Sesión") + "</p>" +
					(s.campo_formativo ? '<p class="text-xs text-gray-400 truncate">' + esc(s.campo_formativo) + "</p>" : "") +
					"</div>" +
					(dur ? '<span class="shrink-0 text-xs text-gray-400">⏱ ' + esc(dur) + "</span>" : "") +
					"</li>";
			});
			html += "</ul>";
		} else {
			html += '<p class="text-sm text-gray-400">Este proyecto no tiene sesiones cargadas.</p>';
		}
		html += "</div>";

		previewBodyEl.innerHTML = html;
	}

	function cerrarPreview() {
		proyectoPreviewId = null;
		if (modalEl) { modalEl.classList.add("hidden"); }
	}

	// =========================================================================
	// IMPORTAR
	// =========================================================================

	async function importar(dosProyectoId, btn) {
		if (typeof window.importarProyecto !== "function") {
			mostrarToast("No se pudo cargar el importador. Recarga la página.", "error");
			return;
		}
		if (!grupoId) {
			mostrarToast("Primero crea tu grupo para poder importar proyectos.", "error");
			return;
		}

		const labelOriginal = btn ? btn.innerHTML : "";
		if (btn) {
			btn.disabled = true;
			btn.innerHTML =
				'<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Importando...';
		}

		try {
			await window.importarProyecto(dosProyectoId, user.id, grupoId);
			cerrarPreview();
			mostrarToastImportado();
		} catch (err) {
			console.error(err);
			mostrarToast("No se pudo importar el proyecto. Intenta de nuevo.", "error");
		} finally {
			if (btn) {
				btn.disabled = false;
				btn.innerHTML = labelOriginal;
			}
		}
	}

	// =========================================================================
	// ESTADOS DE UI
	// =========================================================================

	function mostrarCargando() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML =
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto mb-3 animate-spin text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
			'<p class="text-gray-400">Cargando planeaciones...</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function mostrarError() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML = '<p class="text-red-500 font-medium">Error al cargar el marketplace. Intenta de nuevo.</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
	}

	function mostrarCatalogoVacio() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-4">' +
			'<svg xmlns="http://www.w3.org/2000/svg" class="w-24 h-24 text-blue-100" viewBox="0 0 96 96" fill="none">' +
			'<rect x="14" y="22" width="68" height="52" rx="8" fill="#dbeafe"/>' +
			'<rect x="22" y="32" width="52" height="4" rx="2" fill="#93c5fd"/>' +
			'<rect x="22" y="42" width="36" height="4" rx="2" fill="#93c5fd"/>' +
			'<rect x="22" y="52" width="44" height="4" rx="2" fill="#93c5fd"/>' +
			'<circle cx="72" cy="70" r="13" fill="#3b82f6"/>' +
			'<path d="M72 64v9M67.5 68.5 72 73l4.5-4.5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
			"</svg>" +
			'<div class="text-center max-w-md">' +
			'<p class="text-gray-700 text-lg font-semibold mb-1">Catálogo en camino</p>' +
			'<p class="text-gray-400 text-sm mb-5">El catálogo de planeaciones estará disponible próximamente. Mientras tanto puedes crear tus propios proyectos.</p>' +
			'<a href="planeacion.html" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition text-sm min-h-[44px]">Ir a Mis Proyectos</a>' +
			"</div>" +
			"</div>";
		estadoEl.className = "py-12 flex items-center justify-center";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
		if (contadorTextoEl) { contadorTextoEl.textContent = ""; }
	}

	function mostrarVacioFiltrado() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML =
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
			'<p class="text-gray-400 font-medium">Sin resultados para estos filtros</p>' +
			'<p class="text-gray-300 text-sm mt-1">Prueba cambiando el grado, campo, metodología o trimestre</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	// =========================================================================
	// UTILIDADES
	// =========================================================================

	function abrevMetodologia(nombre) {
		if (!nombre) { return ""; }
		if (METODOLOGIA_MAP[nombre]) { return METODOLOGIA_MAP[nombre]; }
		// Si ya viene abreviado, devolverlo tal cual
		return nombre;
	}

	function contarSesiones(proyecto) {
		const c = proyecto.dosificacion_sesiones;
		if (Array.isArray(c) && c.length) { return c[0].count || 0; }
		if (c && typeof c === "object" && typeof c.count === "number") { return c.count; }
		return 0;
	}

	function soloDigito(g) {
		return String(g).replace(/[^0-9]/g, "");
	}

	function normalizarLista(valor) {
		if (!valor) { return []; }
		if (Array.isArray(valor)) {
			return valor.map(function (i) { return String(i).trim(); }).filter(Boolean);
		}
		if (typeof valor === "string") {
			try {
				const parsed = JSON.parse(valor);
				if (Array.isArray(parsed)) { return normalizarLista(parsed); }
			} catch (_) {}
			return valor.split(",").map(function (i) { return String(i).trim(); }).filter(Boolean);
		}
		return [];
	}

	function esc(str) {
		return String(str == null ? "" : str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function mostrarToast(mensaje, tipo) {
		if (toastEl) { toastEl.remove(); }
		toastEl = document.createElement("div");
		const bg = tipo === "error" ? "bg-red-600" : "bg-emerald-600";
		toastEl.className = "fixed bottom-5 right-5 z-50 " + bg + " text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs";
		toastEl.textContent = mensaje;
		document.body.appendChild(toastEl);
		setTimeout(function () {
			if (toastEl) { toastEl.remove(); toastEl = null; }
		}, 3500);
	}

	function mostrarToastImportado() {
		if (toastEl) { toastEl.remove(); }
		toastEl = document.createElement("div");
		toastEl.className = "fixed bottom-5 right-5 z-50 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs flex flex-col gap-1";
		toastEl.innerHTML =
			'<span class="font-semibold">✅ Proyecto importado.</span>' +
			'<a href="planeacion.html" class="underline font-bold hover:text-emerald-100">Ya aparece en Mis Proyectos →</a>';
		document.body.appendChild(toastEl);
		const ref = toastEl;
		setTimeout(function () {
			if (toastEl === ref) { ref.remove(); toastEl = null; }
		}, 6000);
	}
});
