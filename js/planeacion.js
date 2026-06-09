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
	const estadoEl          = document.getElementById("proyectosEstado");
	const gridEl            = document.getElementById("proyectosGrid");
	const bannerEl          = document.getElementById("bannerActivo");
	const bannerTituloEl    = document.getElementById("bannerActivoTitulo");
	const filtroTrimestreEl = document.getElementById("filtroTrimestre");
	const filtroEstadoEl    = document.getElementById("filtroEstado");
	const contadorFiltroEl  = document.getElementById("contadorFiltro");
	const contadorTextoEl   = document.getElementById("contadorTexto");
	const modalEl           = document.getElementById("modalInicioProyecto");
	const modalFechaEl      = document.getElementById("fechaInicio");
	const btnConfirmarEl    = document.getElementById("btnConfirmarInicio");
	const btnCancelarEl     = document.getElementById("btnCancelarModal");

	// ── Estado local ──────────────────────────────────────────────────────────
	let todosLosProyectos = [];
	let proyectoActivoId  = null;
	let toastEl           = null;

	// ── Init ──────────────────────────────────────────────────────────────────
	await cargarProyectos();
	bindFiltros();
	bindModal();

	// =========================================================================
	// CARGA DE DATOS
	// =========================================================================

	async function cargarProyectos() {
		mostrarCargando();

		const { data, error } = await window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado, created_at, grados, trimestre, fecha_inicial, sesiones(count)")
			.eq("maestro_id", user.id)
			.order("updated_at", { ascending: false });

		if (error) {
			mostrarError();
			return;
		}

		todosLosProyectos = data || [];
		actualizarBannerActivo();
		aplicarFiltros();
	}

	// =========================================================================
	// BANNER PROYECTO ACTIVO
	// =========================================================================

	function actualizarBannerActivo() {
		const activo = todosLosProyectos.find(function (p) { return p.estado === "activo"; });
		if (activo && bannerEl && bannerTituloEl) {
			bannerTituloEl.textContent = activo.titulo || "Proyecto sin título";
			bannerEl.classList.remove("hidden");
			bannerEl.classList.add("flex");
		} else if (bannerEl) {
			bannerEl.classList.add("hidden");
			bannerEl.classList.remove("flex");
		}
	}

	// =========================================================================
	// FILTROS
	// =========================================================================

	function bindFiltros() {
		if (filtroTrimestreEl) {
			filtroTrimestreEl.addEventListener("change", aplicarFiltros);
		}
		if (filtroEstadoEl) {
			filtroEstadoEl.addEventListener("change", aplicarFiltros);
		}
	}

	function aplicarFiltros() {
		const trimestre = filtroTrimestreEl ? filtroTrimestreEl.value : "";
		const estado    = filtroEstadoEl    ? filtroEstadoEl.value    : "";

		let filtrados = todosLosProyectos.slice();

		if (trimestre) {
			filtrados = filtrados.filter(function (p) {
				return String(p.trimestre) === trimestre;
			});
		}

		if (estado) {
			filtrados = filtrados.filter(function (p) {
				return (p.estado || "borrador") === estado;
			});
		}

		// Actualizar contador solo cuando hay algún filtro activo
		const hayFiltro = trimestre !== "" || estado !== "";
		if (contadorFiltroEl && contadorTextoEl) {
			if (hayFiltro) {
				contadorTextoEl.textContent = filtrados.length + " de " + todosLosProyectos.length + " proyectos";
				contadorFiltroEl.classList.remove("hidden");
				contadorFiltroEl.classList.add("flex");
			} else {
				contadorFiltroEl.classList.add("hidden");
				contadorFiltroEl.classList.remove("flex");
			}
		}

		if (!filtrados.length) {
			if (hayFiltro) {
				mostrarVacioFiltrado();
			} else {
				mostrarVacio();
			}
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

		proyectos.forEach(function (proyecto) {
			const card = crearCard(proyecto);
			gridEl.appendChild(card);
		});

		// Delegar click en el grid
		gridEl.onclick = manejarClickGrid;
	}

	function crearCard(proyecto) {
		const estado  = proyecto.estado || "borrador";
		const campos  = normalizarLista(proyecto.campos_formativos);
		const grados  = normalizarLista(proyecto.grados)
			.map(function (g) { return String(g).replace(/[^0-9]/g, ""); })
			.filter(Boolean);

		const gradosTexto = grados.length
			? grados.map(function (g) { return g + "°"; }).join(", ")
			: "—";

		const trimestre = proyecto.trimestre ? proyecto.trimestre + "° Trim." : "";

		// Conteo de sesiones — Supabase devuelve [{count: N}]
		const numSesiones = (Array.isArray(proyecto.sesiones) && proyecto.sesiones.length)
			? (proyecto.sesiones[0].count || 0)
			: 0;

		const badgeMap = {
			borrador:   { cls: "bg-slate-100 text-slate-700",   label: "Listo"      },
			activo:     { cls: "bg-emerald-100 text-emerald-700", label: "Activo"    },
			pausado:    { cls: "bg-amber-100 text-amber-700",    label: "Pausado"    },
			completado: { cls: "bg-blue-100 text-blue-700",      label: "Completado" },
		};
		const badge = badgeMap[estado] || badgeMap.borrador;

		const card = document.createElement("article");
		card.className = "bg-white rounded-2xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-3";

		// Cabecera de la card
		const header = document.createElement("div");
		header.className = "flex items-start justify-between gap-3";
		header.innerHTML =
			'<h3 class="font-bold text-gray-800 text-base leading-snug flex-1">' +
			esc(proyecto.titulo || "Proyecto sin título") +
			"</h3>" +
			'<span class="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ' + badge.cls + '">' +
			badge.label +
			"</span>";

		// Campos formativos
		const camposHtml = campos.length
			? '<div class="flex flex-wrap gap-1">' +
			  campos.map(function (c) {
			      return '<span class="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">' + esc(c) + "</span>";
			  }).join("") +
			  "</div>"
			: "";

		// Meta info
		const meta = document.createElement("div");
		meta.className = "flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500";
		meta.innerHTML =
			(proyecto.metodologia ? '<span>📐 ' + esc(proyecto.metodologia) + '</span>' : '') +
			'<span>👥 Grados: ' + gradosTexto + '</span>' +
			(trimestre ? '<span>📅 ' + trimestre + '</span>' : '') +
			'<span class="text-gray-400">📄 ' + numSesiones + ' ' + (numSesiones === 1 ? 'sesión' : 'sesiones') + '</span>';

		// Acciones
		const acciones = document.createElement("div");
		acciones.className = "border-t border-gray-100 pt-3 flex flex-wrap gap-2";
		acciones.innerHTML = renderAcciones(proyecto.id, estado);

		card.appendChild(header);
		if (camposHtml) {
			const camposDiv = document.createElement("div");
			camposDiv.innerHTML = camposHtml;
			card.appendChild(camposDiv.firstChild);
		}
		card.appendChild(meta);
		card.appendChild(acciones);

		return card;
	}

	function renderAcciones(id, estado) {
		const btnBase = "inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition min-h-[44px]";

		if (estado === "borrador") {
			return (
				'<button data-action="iniciar" data-id="' + id + '" class="' + btnBase + ' bg-emerald-600 hover:bg-emerald-700 text-white">▶ Iniciar</button>' +
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50">✏ Editar</a>' +
				'<button data-action="eliminar" data-id="' + id + '" class="' + btnBase + ' border border-red-200 text-red-600 hover:bg-red-50">🗑 Eliminar</button>'
			);
		}

		if (estado === "activo") {
			return (
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver sesiones</a>' +
				'<button data-action="pausar" data-id="' + id + '" class="' + btnBase + ' border border-amber-300 text-amber-700 hover:bg-amber-50">⏸ Pausar</button>'
			);
		}

		if (estado === "pausado") {
			return (
				'<button data-action="reanudar" data-id="' + id + '" class="' + btnBase + ' bg-emerald-600 hover:bg-emerald-700 text-white">▶ Reanudar</button>' +
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50">Ver sesiones</a>'
			);
		}

		if (estado === "completado") {
			return (
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver sesiones</a>' +
				'<button data-action="clonar" data-id="' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50">📋 Clonar</button>'
			);
		}

		return '<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver proyecto</a>';
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

		if (action === "iniciar")   { abrirModalInicio(id);  return; }
		if (action === "pausar")    { pausarProyecto(id);    return; }
		if (action === "reanudar")  { reanudarProyecto(id);  return; }
		if (action === "eliminar")  { eliminarProyecto(id);  return; }
		if (action === "clonar")    { clonarProyecto(id);    return; }
	}

	// =========================================================================
	// ACCIONES
	// =========================================================================

	async function pausarProyecto(id) {
		const { error } = await window.sb
			.from("proyectos")
			.update({ estado: "pausado" })
			.eq("id", id);

		if (error) {
			mostrarToast("No se pudo pausar el proyecto.", "error");
			return;
		}
		mostrarToast("Proyecto pausado.");
		await cargarProyectos();
	}

	async function reanudarProyecto(id) {
		const { error } = await window.sb
			.from("proyectos")
			.update({ estado: "activo" })
			.eq("id", id);

		if (error) {
			mostrarToast("No se pudo reanudar el proyecto.", "error");
			return;
		}
		mostrarToast("Proyecto reanudado.");
		await cargarProyectos();
	}

	async function eliminarProyecto(id) {
		const proyecto = todosLosProyectos.find(function (p) { return p.id === id; });
		const titulo = proyecto ? (proyecto.titulo || "este proyecto") : "este proyecto";

		const confirmar = window.confirm(
			'¿Eliminar "' + titulo + '"?\n\nSe borrarán también todas sus sesiones. Esta acción no se puede deshacer.'
		);
		if (!confirmar) { return; }

		const { error } = await window.sb
			.from("proyectos")
			.delete()
			.eq("id", id);

		if (error) {
			mostrarToast("No se pudo eliminar el proyecto.", "error");
			return;
		}
		mostrarToast("Proyecto eliminado.");
		await cargarProyectos();
	}

	async function clonarProyecto(id) {
		const original = todosLosProyectos.find(function (p) { return p.id === id; });
		if (!original) { return; }

		// Trimestre: si es 3 queda en 3, si no incrementa
		const trimOrig = parseInt(original.trimestre, 10) || 1;
		const trimNuevo = trimOrig < 3 ? trimOrig + 1 : 3;

		const nuevoProyecto = {
			maestro_id:        user.id,
			titulo:            (original.titulo || "Proyecto") + " (copia)",
			campos_formativos: original.campos_formativos,
			metodologia:       original.metodologia,
			grados:            original.grados,
			trimestre:         trimNuevo,
			estado:            "borrador",
			grupo_id:          original.grupo_id   || null,
			escenario:         original.escenario  || null,
			contenidos_pda:    original.contenidos_pda || null,
		};

		const { error } = await window.sb
			.from("proyectos")
			.insert(nuevoProyecto);

		if (error) {
			mostrarToast("No se pudo clonar el proyecto.", "error");
			return;
		}
		mostrarToast("Proyecto clonado correctamente.");
		await cargarProyectos();
	}

	// =========================================================================
	// MODAL INICIO DE PROYECTO
	// =========================================================================

	function bindModal() {
		if (!modalEl || !btnConfirmarEl || !btnCancelarEl) { return; }

		btnCancelarEl.addEventListener("click", cerrarModal);
		btnConfirmarEl.addEventListener("click", confirmarInicio);

		modalEl.addEventListener("click", function (e) {
			if (e.target === modalEl) { cerrarModal(); }
		});

		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && !modalEl.classList.contains("hidden")) {
				cerrarModal();
			}
		});
	}

	function abrirModalInicio(id) {
		proyectoActivoId = id;
		if (modalFechaEl) { modalFechaEl.value = getHoyISO(); }
		if (modalEl)       { modalEl.classList.remove("hidden"); }
		if (modalFechaEl)  { modalFechaEl.focus(); }
	}

	function cerrarModal() {
		proyectoActivoId = null;
		if (modalEl) { modalEl.classList.add("hidden"); }
	}

	async function confirmarInicio() {
		if (!proyectoActivoId) { return; }

		const fecha = (modalFechaEl && modalFechaEl.value) ? modalFechaEl.value : getHoyISO();

		if (btnConfirmarEl) {
			btnConfirmarEl.disabled    = true;
			btnConfirmarEl.textContent = "Iniciando...";
		}

		try {
			// Verificar que tenga sesiones
			const { count, error: countError } = await window.sb
				.from("sesiones")
				.select("id", { count: "exact", head: true })
				.eq("proyecto_id", proyectoActivoId);

			if (countError || !count) {
				mostrarToast("Este proyecto no tiene sesiones. Edítalo para agregarlas.", "error");
				return;
			}

			// Activar proyecto
			const { error: projError } = await window.sb
				.from("proyectos")
				.update({ estado: "activo", fecha_inicial: fecha })
				.eq("id", proyectoActivoId);

			if (projError) { throw projError; }

			// Activar sesión 1
			const { error: sesError } = await window.sb
				.from("sesiones")
				.update({ estado_sesion: "activa" })
				.eq("proyecto_id", proyectoActivoId)
				.eq("numero_sesion", 1);

			if (sesError) {
				// Revertir para evitar estado parcial
				await window.sb
					.from("proyectos")
					.update({ estado: "borrador", fecha_inicial: null })
					.eq("id", proyectoActivoId);
				throw sesError;
			}

			cerrarModal();
			mostrarToast("¡Proyecto iniciado! Ya aparece en tu dashboard.");
			await cargarProyectos();

		} catch (err) {
			console.error(err);
			mostrarToast("No se pudo iniciar el proyecto. Intenta de nuevo.", "error");
		} finally {
			if (btnConfirmarEl) {
				btnConfirmarEl.disabled    = false;
				btnConfirmarEl.textContent = "Iniciar";
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
			'<p class="text-gray-400">Cargando proyectos...</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function mostrarError() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML = '<p class="text-red-500 font-medium">Error al cargar proyectos. Intenta de nuevo.</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
	}

	function mostrarVacio() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-4">' +
			// Ilustración SVG de libro/carpeta
			'<svg xmlns="http://www.w3.org/2000/svg" class="w-24 h-24 text-blue-100" viewBox="0 0 96 96" fill="none">' +
			'<rect x="12" y="20" width="72" height="56" rx="8" fill="#dbeafe"/>' +
			'<rect x="20" y="28" width="56" height="4" rx="2" fill="#93c5fd"/>' +
			'<rect x="20" y="38" width="40" height="4" rx="2" fill="#93c5fd"/>' +
			'<rect x="20" y="48" width="48" height="4" rx="2" fill="#93c5fd"/>' +
			'<rect x="20" y="58" width="32" height="4" rx="2" fill="#93c5fd"/>' +
			'<path d="M8 14h80" stroke="#bfdbfe" stroke-width="2" stroke-linecap="round"/>' +
			'<circle cx="72" cy="72" r="12" fill="#10b981"/>' +
			'<path d="M72 66v12M66 72h12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' +
			"</svg>" +
			'<div class="text-center">' +
			'<p class="text-gray-700 text-lg font-semibold mb-1">Aún no tienes proyectos</p>' +
			'<p class="text-gray-400 text-sm mb-5">Crea tu primer proyecto de aprendizaje NEM</p>' +
			'<a href="crear_proyecto.html" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition text-sm min-h-[44px]">' +
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
			"Crear mi primer proyecto" +
			"</a>" +
			"</div>" +
			"</div>";
		estadoEl.className = "py-12 flex items-center justify-center";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function mostrarVacioFiltrado() {
		if (!estadoEl || !gridEl) { return; }
		estadoEl.innerHTML =
			'<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
			'<p class="text-gray-400 font-medium">Sin resultados para este filtro</p>' +
			'<p class="text-gray-300 text-sm mt-1">Prueba cambiando el trimestre o el estado</p>';
		estadoEl.className = "text-center py-16";
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	// =========================================================================
	// UTILIDADES
	// =========================================================================

	function getHoyISO() {
		const hoy = new Date();
		hoy.setMinutes(hoy.getMinutes() - hoy.getTimezoneOffset());
		return hoy.toISOString().split("T")[0];
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
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function mostrarToast(mensaje, tipo) {
		if (toastEl) { toastEl.remove(); }
		toastEl = document.createElement("div");
		const bg = tipo === "error" ? "bg-red-600" : "bg-emerald-600";
		toastEl.className = "fixed bottom-4 right-4 z-50 " + bg + " text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium";
		toastEl.textContent = mensaje;
		document.body.appendChild(toastEl);
		setTimeout(function () {
			if (toastEl) { toastEl.remove(); toastEl = null; }
		}, 3000);
	}
});
