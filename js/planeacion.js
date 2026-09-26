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
	let grupoActivo       = null; // para el trimestre de una copia
	let toastEl           = null;
	// Actividades del trimestre (sueltas, sin proyecto): antes del arranque (cargarProyectos las usa)
	const sueltasListaEl = document.getElementById("sueltasLista");
	const NOMBRE_CAMPO = { LEN: "Lenguajes", SAB: "Saberes y Pensamiento Científico", ETI: "Ética, Naturaleza y Sociedades", DHL: "De lo Humano y lo Comunitario" };
	let sueltasProductos = []; // [{ producto, sesion, proyecto }]
	let ajustesCal = [];

	// ── Init ──────────────────────────────────────────────────────────────────
	// Arranque común (js/lectura.js): si el grupo o la lista no se pudieron leer, la página
	// se detiene con el aviso "No se pudo cargar" (antes, sin grupo, mostraba los proyectos
	// de todos los grupos). Tras una acción, una recarga fallida de la lista también la
	// detiene (el error sale marcado como de lectura).
	bindFiltros();
	bindModal();
	bindSueltas();
	await window.Lectura.arrancar(cargarProyectos);

	// =========================================================================
	// CARGA DE DATOS
	// =========================================================================

	async function cargarProyectos() {
		mostrarCargando();

		// Solo los proyectos del grupo activo: con 2+ grupos no se mezclan. Si la lectura del
		// grupo falla, GrupoActivo.cargar detiene la página él mismo
		const activo = await window.GrupoActivo.cargar(window.sb, user.id);
		const grupoActivoId = activo.grupo ? activo.grupo.id : null;
		grupoActivo = activo.grupo || null;

		let consulta = window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado, created_at, grados, trimestre, fecha_inicial, tipo, sesiones(count)")
			.eq("maestro_id", user.id);
		if (grupoActivoId) consulta = consulta.eq("grupo_id", grupoActivoId);
		// proyectos no tiene updated_at: ordenar por él daba 400 y la lista nunca cargaba.
		// Si falla, lanza: no se dice "Aún no tienes proyectos"
		const todos = (await window.Lectura.uno(consulta.order("created_at", { ascending: false }))) || [];
		// "Actividades del trimestre" (actividades sueltas, tipo 'sueltas') no es un proyecto: no se
		// lista, no se inicia, no se duplica ni se edita; tiene su propia sección arriba
		todosLosProyectos = todos.filter(function (p) { return !window.AlcanceHoy.esSueltas(p); });
		actualizarBannerActivo();
		aplicarFiltros();
		await cargarSueltas(todos.filter(function (p) { return window.AlcanceHoy.esSueltas(p); }), grupoActivoId);
	}

	// =========================================================================
	// ACTIVIDADES DEL TRIMESTRE (sueltas, sin proyecto)
	// =========================================================================

	function escHtml(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function fechaCortaTexto(iso) {
		const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		return m ? Number(m[3]) + " " + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m[2]) - 1] : "";
	}

	/*
		Las actividades y tareas sueltas del grupo (las de los contenedores de sus trimestres), con
		"Pasar a un proyecto" (js/pasar-a-proyecto.js): van con sus calificaciones a una sesión de un
		proyecto del mismo trimestre. Si la lectura falla, lanza (la página dice "No se pudo cargar").
	*/
	async function cargarSueltas(contenedores, grupoId) {
		if (!sueltasListaEl) return;
		sueltasProductos = [];
		if (contenedores.length) {
			const porId = {};
			contenedores.forEach(function (p) { porId[p.id] = p; });
			const sesiones = await window.AlcanceHoy.leerPorLotes(contenedores.map(function (p) { return p.id; }), function (lote) {
				return window.sb.from("sesiones").select("id, proyecto_id, fecha, campo_formativo").in("proyecto_id", lote).order("id");
			});
			const sesPorId = {};
			sesiones.forEach(function (s) { sesPorId[s.id] = s; });
			const productos = sesiones.length ? await window.AlcanceHoy.leerPorLotes(sesiones.map(function (s) { return s.id; }), function (lote) {
				return window.sb.from("productos_sesion").select("id, sesion_id, tipo, nombre, campo, grados, fecha_entrega")
					.in("sesion_id", lote).eq("activo", true).order("id");
			}) : [];
			sueltasProductos = productos.map(function (p) {
				const s = sesPorId[p.sesion_id] || {};
				return { producto: p, sesion: s, proyecto: porId[s.proyecto_id] || {} };
			}).sort(function (a, b) {
				return String(b.sesion.fecha || "").localeCompare(String(a.sesion.fecha || "")) ||
					String(a.producto.nombre || "").localeCompare(String(b.producto.nombre || ""), "es");
			});
			// Días sin clase del grupo: una tarea movida conserva el día en que se revisaba
			try {
				ajustesCal = grupoId ? await window.AlcanceHoy.leerAjustesCalendario(window.sb, user.id, grupoId) : [];
			} catch (e) {
				// lectura-opcional: solo afina el día en que se revisa una tarea al pasarla a un proyecto (con el calendario oficial si falla); no se escribe nada aquí
				console.error("proyectos: ajustes del calendario", e);
				ajustesCal = [];
			}
		}
		pintarSueltas();
	}

	function pintarSueltas() {
		if (!sueltasListaEl) return;
		if (!sueltasProductos.length) {
			sueltasListaEl.innerHTML = "<p class='text-sm text-gray-400'>Todavía no hay actividades sueltas. Agrégalas desde Hoy en cualquier momento.</p>";
			return;
		}
		sueltasListaEl.innerHTML = sueltasProductos.map(function (x, i) {
			const p = x.producto, s = x.sesion;
			return "<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2'>" +
				"<div class='min-w-0'><p class='text-sm font-semibold text-gray-800 break-words'>" + escHtml(p.nombre) + "</p>" +
				"<p class='text-xs text-gray-500'>" + (p.tipo === "tarea" ? "Tarea" : "Actividad en clase") + " · " + escHtml(NOMBRE_CAMPO[p.campo] || p.campo || "") +
				(s.fecha ? " · " + fechaCortaTexto(s.fecha) : "") + (x.proyecto.trimestre ? " · Trimestre " + x.proyecto.trimestre : "") + "</p></div>" +
				"<button type='button' data-pasar-suelta='" + i + "' class='shrink-0 min-h-[44px] px-4 rounded-xl border border-violet-300 text-sm font-semibold text-violet-700 hover:bg-violet-50'>Pasar a un proyecto</button>" +
				"</div>";
		}).join("");
	}

	function bindSueltas() {
		if (!sueltasListaEl) return;
		sueltasListaEl.addEventListener("click", function (e) {
			const btn = e.target.closest("button[data-pasar-suelta]");
			if (!btn || !window.PasarAProyecto) return;
			const x = sueltasProductos[Number(btn.dataset.pasarSuelta)];
			if (!x) return;
			window.PasarAProyecto.abrir({
				sb: window.sb, maestroId: user.id, grupoId: grupoActivo ? grupoActivo.id : x.proyecto.grupo_id,
				trimestre: x.proyecto.trimestre, producto: x.producto, origen: btn,
				fechaEntrega: x.producto.tipo === "tarea" ? window.AlcanceHoy.venceTarea(x.producto.fecha_entrega, x.sesion.fecha, ajustesCal) : null,
				alTerminar: function () { window.location.reload(); },
			});
		});
	}

	// =========================================================================
	// BANNER PROYECTO ACTIVO
	// =========================================================================

	// Puede haber varios proyectos activos a la vez (uno por campo formativo, por ejemplo)
	function actualizarBannerActivo() {
		const activos = todosLosProyectos.filter(function (p) { return p.estado === "activo"; });
		const etiqueta = bannerEl ? bannerEl.querySelector("[data-banner-etiqueta]") : null;
		if (etiqueta) etiqueta.textContent = activos.length > 1 ? activos.length + " proyectos activos" : "Proyecto activo";
		if (activos.length && bannerEl && bannerTituloEl) {
			bannerTituloEl.textContent = activos.map(function (p) { return p.titulo || "Proyecto sin título"; }).join(" · ");
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
			(proyecto.metodologia ? '<span class="inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21 21 3"/><path d="M7 17l2 2M11 13l2 2M15 9l2 2"/></svg>' + esc(proyecto.metodologia) + '</span>' : '') +
			'<span class="inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11a3 3 0 1 0 0-6"/><path d="M21 20a6 6 0 0 0-4-5.7"/></svg>Grados: ' + gradosTexto + '</span>' +
			(trimestre ? '<span class="inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>' + trimestre + '</span>' : '') +
			'<span class="text-gray-400 inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>' + numSesiones + ' ' + (numSesiones === 1 ? 'sesión' : 'sesiones') + '</span>';

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

		// Duplicar (decisión de Jorge del 2026-09-26): en cualquier estado; la copia sale sin fechas ni calificaciones
		const duplicar = '<button data-action="duplicar" data-id="' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Duplicar</button>';

		if (estado === "borrador") {
			return (
				'<button data-action="iniciar" data-id="' + id + '" class="' + btnBase + ' bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>Iniciar</button>' +
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>Editar</a>' +
				duplicar +
				'<button data-action="eliminar" data-id="' + id + '" class="' + btnBase + ' border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Eliminar</button>'
			);
		}

		if (estado === "activo") {
			return (
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver y editar sesiones</a>' +
				'<button data-action="pausar" data-id="' + id + '" class="' + btnBase + ' border border-amber-300 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>Pausar</button>' +
				duplicar
			);
		}

		if (estado === "pausado") {
			return (
				'<button data-action="reanudar" data-id="' + id + '" class="' + btnBase + ' bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>Reanudar</button>' +
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' border border-gray-300 text-gray-700 hover:bg-gray-50">Ver y editar sesiones</a>' +
				duplicar
			);
		}

		if (estado === "completado") {
			return (
				'<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver sesiones</a>' +
				duplicar
			);
		}

		return '<a href="crear_proyecto.html?id=' + id + '" class="' + btnBase + ' bg-blue-600 hover:bg-blue-700 text-white">Ver proyecto</a>' + duplicar;
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
		if (action === "duplicar")  { duplicarProyecto(id);  return; }
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
			'¿Eliminar "' + titulo + '"?\n\nSe borrarán también todas sus sesiones y lo capturado en ellas (calificaciones, tareas revisadas y evidencias por PDA). Esta acción no se puede deshacer.'
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

	/*
		Duplicar (antes "Clonar", solo en completados; decisión de Jorge del 2026-09-26: en
		cualquier estado). La copia es un borrador con el plan completo y sus sesiones, SIN
		fechas, estado de sesión ni calificaciones (ProyectoEdicion.copiaDeSesion).
	*/
	/*
		Candado (R25a-r12): un doble toque en "Duplicar" (tablet) creaba dos copias. Mientras una
		copia está en curso, otro toque no hace nada (y los botones Duplicar se deshabilitan).
	*/
	let duplicandoEnCurso = false;
	function botonesDuplicar(deshabilitar) {
		if (!gridEl || !gridEl.querySelectorAll) return;
		Array.prototype.forEach.call(gridEl.querySelectorAll('[data-action="duplicar"]'), function (b) {
			b.disabled = deshabilitar;
			b.setAttribute("aria-busy", deshabilitar ? "true" : "false");
		});
	}
	async function duplicarProyecto(id) {
		if (duplicandoEnCurso) return;
		duplicandoEnCurso = true;
		botonesDuplicar(true);
		try {
			await duplicarProyectoUnaVez(id);
		} finally {
			duplicandoEnCurso = false;
			botonesDuplicar(false);
		}
	}

	async function duplicarProyectoUnaVez(id) {
		// La lista trae solo lo que se muestra: el proyecto completo (grupo, escenario,
		// contenidos) se lee aquí. Antes se copiaba sin grupo_id y la base lo rechazaba siempre
		let original;
		try {
			original = await window.Lectura.uno(window.sb.from("proyectos").select("*").eq("id", id).maybeSingle());
		} catch (e) {
			console.error("duplicar: lectura del proyecto", e);
			mostrarToast("No se pudo leer el proyecto, así que no se duplicó. Revisa tu conexión.", "error");
			return;
		}
		if (!original) {
			mostrarToast("Ese proyecto ya no existe.", "error");
			return;
		}

		// Trimestre de la copia: el que el grupo trabaja ahora (como un proyecto nuevo); se cambia en el paso 1
		const trimNuevo = window.ProyectoEdicion.trimestreDeCopia(original, grupoActivo);

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
			fase:                original.fase || null,
			ejes_articuladores:  original.ejes_articuladores || null,
			proposito:           original.proposito || null,
			pregunta_generadora: original.pregunta_generadora || null,
			es_multigrado:       original.es_multigrado || false,
		};

		/*
			Las sesiones se copian también: el plan de cada una, sin fecha, sin estado y sin
			calificaciones, y se materializan sus PDA y productos como al crear un proyecto. Se
			leen ANTES de crear la copia; si algo falla después, la copia se borra (en cascada)
			para no dejar un proyecto a medias.
		*/
		let sesiones;
		try {
			sesiones = await window.LeerTodo.paginas(function () {
				return window.sb.from("sesiones").select("*").eq("proyecto_id", id)
					.order("numero_sesion").order("id");
			});
		} catch (e) {
			console.error("duplicar: lectura de sesiones", e);
			mostrarToast("No se pudieron leer las sesiones del proyecto, así que no se duplicó. Revisa tu conexión.", "error");
			return;
		}

		const { data: creado, error } = await window.sb
			.from("proyectos")
			.insert(nuevoProyecto)
			.select("id")
			.single();

		if (error) {
			mostrarToast("No se pudo duplicar el proyecto.", "error");
			return;
		}
		try {
			if (sesiones.length) {
				const copias = sesiones.map(function (s) {
					return window.ProyectoEdicion.copiaDeSesion(s, creado.id, user.id);
				});
				const ins = await window.sb.from("sesiones").insert(copias)
					.select("id, numero_sesion, campo_formativo, pda_sesion, cierre_tareas");
				if (ins.error) throw ins.error;
				await window.materializarSesiones(ins.data || [], user.id, {
					gradosProyecto: original.grados || [],
					camposProyecto: original.campos_formativos || [],
					origenTrabajo: "maestro",
					origenTarea: "maestro",
				});
			}
		} catch (e) {
			console.error("duplicar: sesiones", e);
			await window.sb.from("proyectos").delete().eq("id", creado.id);
			mostrarToast("No se pudo duplicar el proyecto: " + (e && e.humano ? e.message : "revisa tu conexión e inténtalo de nuevo."), "error");
			await cargarProyectos();
			return;
		}
		mostrarToast(sesiones.length
			? "Proyecto duplicado con sus " + sesiones.length + (sesiones.length === 1 ? " sesión" : " sesiones") + ", sin fechas ni calificaciones. La copia es un borrador."
			: "Proyecto duplicado (no tenía sesiones). La copia es un borrador.");
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
			// Verificar que tenga sesiones (si no se pudo contar, se dice eso: no "no tiene sesiones")
			let count;
			try {
				count = await window.Lectura.contar(window.sb
					.from("sesiones")
					.select("id", { count: "exact", head: true })
					.eq("proyecto_id", proyectoActivoId));
			} catch (e) {
				console.error("iniciar: conteo de sesiones", e);
				mostrarToast("No se pudieron revisar las sesiones del proyecto, así que no se inició. Revisa tu conexión.", "error");
				return;
			}

			if (!count) {
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
			mostrarToast("Proyecto iniciado. Sus sesiones ya aparecen en Hoy para trabajarlas.");
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
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
