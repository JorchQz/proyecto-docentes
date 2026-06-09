document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		mostrarError("Supabase no está configurado.");
		return;
	}

	// ── elementos del DOM ─────────────────────────────────────────────────────
	var headerTituloEl = document.getElementById("headerTitulo");
	var headerMetaEl   = document.getElementById("headerMeta");
	var headerEstadoEl = document.getElementById("headerEstado");
	var tabsEl         = document.getElementById("examenTabs");
	var tabVerEl       = document.getElementById("tabVer");
	var tabCalificarEl = document.getElementById("tabCalificar");
	var contenidoEl    = document.getElementById("examenContenido");
	var mainEl         = document.getElementById("examenMain");
	var mensajeEl      = document.getElementById("examenMensaje");
	var footerEl       = document.getElementById("examenFooter");
	var footerCFEl     = document.getElementById("footerCF");
	var footerProgEl   = document.getElementById("footerProgreso");
	var footerBarraEl  = document.getElementById("footerBarra");
	var btnSiguiente   = document.getElementById("btnSiguienteAlumno");

	// ── estado ────────────────────────────────────────────────────────────────
	var userId    = null;
	var grupo     = null;
	var examenId  = null;
	var examen    = null;
	var preguntas = [];          // ordenadas según examen.preguntas_ids
	var alumnos   = [];
	var alumnoActualId = null;
	var respMap   = {};          // clave: alumnoId + "||" + preguntaId → fila de respuestas_examen
	var pestana   = "ver";       // "ver" | "calificar"

	// ── config de campos formativos ───────────────────────────────────────────
	var CF = {
		LEN: { nombre: "Lenguajes",                       badge: "bg-blue-100 text-blue-700",     dot: "bg-blue-500",   pill: "text-blue-700" },
		SAB: { nombre: "Saberes y Pensamiento Científico", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", pill: "text-emerald-700" },
		ETI: { nombre: "Ética, Naturaleza y Sociedades",   badge: "bg-orange-100 text-orange-700", dot: "bg-orange-500", pill: "text-orange-700" },
		DHL: { nombre: "De lo Humano y lo Comunitario",    badge: "bg-violet-100 text-violet-700", dot: "bg-violet-500", pill: "text-violet-700" }
	};
	function cfInfo(cf) {
		return CF[cf] || { nombre: cf || "—", badge: "bg-gray-100 text-gray-700", dot: "bg-gray-400", pill: "text-gray-600" };
	}

	var TIPO_LABEL = {
		opcion_multiple:   "Opción múltiple",
		verdadero_falso:   "Verdadero / Falso",
		completar:         "Completar",
		abierta:           "Respuesta abierta"
	};

	// ── helpers ───────────────────────────────────────────────────────────────
	function getLocalDateISO() {
		var now = new Date();
		var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}
	function escapeHtml(v) {
		return String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}
	function escAttr(v) {
		return String(v == null ? "" : v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function rkey(alumnoId, preguntaId) {
		return alumnoId + "||" + preguntaId;
	}
	function mostrarError(msg) {
		if (!mensajeEl) return;
		mensajeEl.className = "rounded-lg px-4 py-3 text-sm font-medium bg-red-50 text-red-700 border border-red-200";
		mensajeEl.textContent = msg;
		mensajeEl.classList.remove("hidden");
	}
	function ocultarMensaje() {
		if (mensajeEl) mensajeEl.classList.add("hidden");
	}
	function emptyState(texto, subtexto) {
		return '<div class="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">' +
			'<p class="text-gray-600 text-base font-medium">' + escapeHtml(texto) + '</p>' +
			(subtexto ? '<p class="text-gray-400 text-sm mt-1">' + escapeHtml(subtexto) + '</p>' : '') +
			'<a href="dashboard.html" class="inline-block mt-4 text-blue-600 underline text-sm font-medium">Volver al Dashboard</a>' +
			'</div>';
	}
	function puntosPorPregunta() {
		var total = examen && examen.total_preguntas ? examen.total_preguntas : (preguntas.length || 1);
		var valor = examen && examen.valor_total != null ? Number(examen.valor_total) : 0;
		if (!total) return 0;
		return Math.round((valor / total) * 100) / 100;
	}
	function nombreCorto(nombre) {
		var partes = String(nombre || "").trim().split(/\s+/);
		if (partes.length <= 2) return partes.join(" ");
		return partes[0] + " " + partes[1];
	}
	// Trimestre actual según fecha (ciclo escolar mexicano)
	function trimestreActual() {
		var m = new Date().getMonth() + 1; // 1-12
		if (m >= 8 && m <= 11) return 1;    // ago-nov
		if (m === 12 || m <= 3) return 2;   // dic-mar
		return 3;                            // abr-jul
	}

	// ── auth ──────────────────────────────────────────────────────────────────
	var authResult = await window.sb.auth.getUser();
	if (authResult.error || !authResult.data.user) {
		window.location.href = "index.html";
		return;
	}
	userId = authResult.data.user.id;

	// ── grupo del maestro ──────────────────────────────────────────────────────
	try {
		var grupoRes = await window.sb
			.from("grupos")
			.select("id, nombre, grados, ciclo_escolar")
			.eq("maestro_id", userId)
			.order("id", { ascending: true })
			.limit(1);
		if (!grupoRes.error && grupoRes.data && grupoRes.data.length) {
			grupo = grupoRes.data[0];
		}
	} catch (e) { /* sin grupo: la vista lista lo maneja */ }

	// ── enrutar ─────────────────────────────────────────────────────────────────
	var params = new URLSearchParams(window.location.search);
	examenId = params.get("examen_id");

	if (!examenId) {
		await renderListaExamenes();
	} else {
		await cargarExamen();
	}

	// ══════════════════════════════════════════════════════════════════════════
	// VISTA 1 — Lista de exámenes disponibles
	// ══════════════════════════════════════════════════════════════════════════
	async function renderListaExamenes() {
		if (headerTituloEl) headerTituloEl.textContent = "Exámenes disponibles";
		if (headerMetaEl)   headerMetaEl.textContent = grupo ? (grupo.nombre || "") : "";
		if (tabsEl) tabsEl.classList.add("hidden");
		if (footerEl) footerEl.classList.add("hidden");

		var examenesRes;
		try {
			examenesRes = await window.sb
				.from("examenes")
				.select("*")
				.or("maestro_id.eq." + userId + ",maestro_id.is.null")
				.in("estado", ["publicado", "cerrado"])
				.order("trimestre", { ascending: true });
		} catch (e) {
			mostrarError("Error al cargar exámenes: " + (e.message || "Error desconocido"));
			return;
		}
		if (examenesRes.error) {
			mostrarError("Error al cargar exámenes: " + (examenesRes.error.message || "Error desconocido"));
			return;
		}

		var lista = examenesRes.data || [];

		// Filtrar por grados del grupo y trimestre vigente (cuando aplica)
		var trimestre = trimestreActual();
		var gradosGrupo = (grupo && Array.isArray(grupo.grados)) ? grupo.grados.map(String) : null;

		var disponibles = lista.filter(function (ex) {
			// Si el examen ya está asignado a otro maestro, no mostrarlo
			if (ex.maestro_id && ex.maestro_id !== userId) return false;
			// Filtrar por grado del grupo si el examen indica grado
			if (gradosGrupo && gradosGrupo.length && ex.grado != null) {
				if (gradosGrupo.indexOf(String(ex.grado)) === -1) return false;
			}
			return true;
		});

		// Ordenar: trimestre vigente primero
		disponibles.sort(function (a, b) {
			var aT = a.trimestre === trimestre ? 0 : 1;
			var bT = b.trimestre === trimestre ? 0 : 1;
			if (aT !== bT) return aT - bT;
			return (a.trimestre || 0) - (b.trimestre || 0);
		});

		if (!disponibles.length) {
			mainEl.innerHTML = emptyState(
				"Aún no hay exámenes disponibles para este trimestre.",
				"Cuando el generador cree un examen, aparecerá aquí para que lo apliques a tu grupo."
			);
			return;
		}

		mainEl.innerHTML = disponibles.map(function (ex) {
			var estadoBadge = ex.estado === "cerrado"
				? '<span class="text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5 font-medium">Cerrado</span>'
				: '<span class="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">Publicado</span>';
			var asignado = ex.maestro_id === userId && ex.grupo_id;
			var btn = asignado
				? '<a href="examen.html?examen_id=' + escAttr(ex.id) + '" ' +
				  'class="inline-flex items-center justify-center w-full sm:w-auto px-5 py-2.5 rounded-xl bg-blue-800 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-900 transition-colors min-h-[44px]">Abrir examen</a>'
				: '<button type="button" data-aplicar="' + escAttr(ex.id) + '" ' +
				  'class="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-blue-800 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-900 transition-colors min-h-[44px]">Aplicar este examen</button>';

			return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3">' +
				'<div class="flex items-start justify-between gap-3">' +
					'<h2 class="text-base font-bold text-gray-800 leading-snug">' + escapeHtml(ex.titulo || "Examen sin título") + '</h2>' +
					estadoBadge +
				'</div>' +
				'<div class="flex flex-wrap items-center gap-2 text-xs">' +
					'<span class="bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">Trimestre ' + escapeHtml(ex.trimestre || "?") + '</span>' +
					(ex.grado != null ? '<span class="bg-gray-100 text-gray-700 rounded-full px-2 py-0.5 font-medium">' + escapeHtml(ex.grado) + '° grado</span>' : '') +
					(ex.fase != null ? '<span class="bg-gray-100 text-gray-700 rounded-full px-2 py-0.5 font-medium">Fase ' + escapeHtml(ex.fase) + '</span>' : '') +
					'<span class="bg-gray-100 text-gray-700 rounded-full px-2 py-0.5 font-medium">' + escapeHtml(ex.total_preguntas || 0) + ' preguntas</span>' +
					(ex.tiempo_minutos ? '<span class="bg-gray-100 text-gray-700 rounded-full px-2 py-0.5 font-medium">' + escapeHtml(ex.tiempo_minutos) + ' min</span>' : '') +
				'</div>' +
				(ex.instrucciones ? '<p class="text-sm text-gray-500 leading-snug">' + escapeHtml(ex.instrucciones) + '</p>' : '') +
				'<div class="pt-1">' + btn + '</div>' +
			'</div>';
		}).join("");

		// Listener para aplicar
		mainEl.addEventListener("click", async function (e) {
			var btn = e.target.closest("button[data-aplicar]");
			if (!btn) return;
			var exId = btn.dataset.aplicar;
			if (!grupo) {
				mostrarError("Necesitas tener un grupo creado antes de aplicar un examen.");
				return;
			}
			btn.disabled = true;
			btn.textContent = "Aplicando...";
			try {
				var upd = await window.sb
					.from("examenes")
					.update({
						maestro_id: userId,
						grupo_id: grupo.id,
						estado: "publicado"
					})
					.eq("id", exId)
					.select()
					.single();
				if (upd.error) throw upd.error;
				window.location.href = "examen.html?examen_id=" + exId;
			} catch (err) {
				btn.disabled = false;
				btn.textContent = "Aplicar este examen";
				mostrarError("No se pudo aplicar el examen: " + (err.message || "Error desconocido"));
			}
		});
	}

	// ══════════════════════════════════════════════════════════════════════════
	// VISTA 2 — Aplicar / calificar un examen
	// ══════════════════════════════════════════════════════════════════════════
	async function cargarExamen() {
		// Examen
		var examenRes;
		try {
			examenRes = await window.sb.from("examenes").select("*").eq("id", examenId).single();
		} catch (e) {
			mostrarError("Error al cargar el examen.");
			return;
		}
		if (examenRes.error || !examenRes.data) {
			mainEl.innerHTML = emptyState("Examen no encontrado o sin permiso.");
			return;
		}
		examen = examenRes.data;

		// Header
		if (headerTituloEl) headerTituloEl.textContent = examen.titulo || "Examen";
		if (headerMetaEl) {
			var meta = [];
			if (examen.trimestre != null) meta.push("Trimestre " + examen.trimestre);
			if (examen.grado != null) meta.push(examen.grado + "° grado");
			meta.push((examen.total_preguntas || 0) + " preguntas");
			if (examen.valor_total != null) meta.push(examen.valor_total + " pts");
			headerMetaEl.textContent = meta.join(" · ");
		}
		if (headerEstadoEl) {
			var est = examen.estado === "cerrado" ? "Cerrado" : (examen.estado === "publicado" ? "Publicado" : "Borrador");
			headerEstadoEl.textContent = est;
		}
		if (tabsEl) tabsEl.classList.remove("hidden");

		// Preguntas del banco
		var idsPreg = Array.isArray(examen.preguntas_ids) ? examen.preguntas_ids : [];
		if (!idsPreg.length) {
			mainEl.innerHTML = emptyState(
				"Este examen aún no tiene preguntas.",
				"El generador todavía no ha agregado preguntas al banco para este examen."
			);
			return;
		}
		var pregRes;
		try {
			pregRes = await window.sb.from("banco_preguntas").select("*").in("id", idsPreg);
		} catch (e) {
			mostrarError("Error al cargar las preguntas.");
			return;
		}
		if (pregRes.error) {
			mostrarError("Error al cargar las preguntas: " + (pregRes.error.message || ""));
			return;
		}
		var crudas = pregRes.data || [];
		preguntas = idsPreg.map(function (id) {
			return crudas.find(function (p) { return p.id === id; });
		}).filter(Boolean);

		if (!preguntas.length) {
			mainEl.innerHTML = emptyState("No se encontraron las preguntas de este examen en el banco.");
			return;
		}

		// Alumnos del grupo asignado al examen (o del grupo del maestro)
		var grupoIdExamen = examen.grupo_id || (grupo && grupo.id);
		if (grupoIdExamen) {
			try {
				var alRes = await window.sb
					.from("alumnos")
					.select("id, nombre_completo, grado, num_lista")
					.eq("grupo_id", grupoIdExamen)
					.eq("maestro_id", userId)
					.eq("estatus", "activo")
					.order("num_lista", { ascending: true });
				if (!alRes.error) alumnos = alRes.data || [];
			} catch (e) { /* sin alumnos */ }
		}

		// Respuestas existentes
		if (alumnos.length) {
			try {
				var rRes = await window.sb
					.from("respuestas_examen")
					.select("*")
					.eq("examen_id", examenId);
				if (!rRes.error && rRes.data) {
					rRes.data.forEach(function (r) {
						respMap[rkey(r.alumno_id, r.pregunta_id)] = r;
					});
				}
			} catch (e) { /* sin respuestas aún */ }
		}

		// Pestañas
		tabVerEl.addEventListener("click", function () { setPestana("ver"); });
		tabCalificarEl.addEventListener("click", function () { setPestana("calificar"); });
		btnSiguiente.addEventListener("click", siguienteAlumno);

		alumnoActualId = alumnos.length ? alumnos[0].id : null;
		setPestana("ver");
	}

	// ── alternar pestaña ────────────────────────────────────────────────────────
	function setPestana(p) {
		pestana = p;
		var activa = "flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] bg-blue-800 text-white";
		var inactiva = "flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] bg-gray-100 text-gray-600 hover:bg-gray-200";
		tabVerEl.className = p === "ver" ? activa : inactiva;
		tabCalificarEl.className = p === "calificar" ? activa : inactiva;
		// Ajustar padding-top por la barra de pestañas
		ajustarPadding();
		if (p === "ver") {
			footerEl.classList.add("hidden");
			renderVerExamen();
		} else {
			renderCalificar();
		}
	}

	// ── Pestaña A: Ver examen ────────────────────────────────────────────────────
	function renderVerExamen() {
		ocultarMensaje();
		var html = '<div class="flex items-center justify-between gap-3 no-print">' +
			'<p class="text-sm text-gray-500">Vista para impresión del examen.</p>' +
			'<button id="btnImprimir" type="button" class="px-5 py-2.5 rounded-xl bg-blue-800 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-900 transition-colors min-h-[44px]">Imprimir examen</button>' +
			'</div>';

		html += '<div class="print-area bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-5">' +
			'<div class="border-b border-gray-200 pb-3">' +
				'<h2 class="text-lg font-bold text-gray-800">' + escapeHtml(examen.titulo || "Examen") + '</h2>' +
				(examen.instrucciones ? '<p class="text-sm text-gray-600 mt-1">' + escapeHtml(examen.instrucciones) + '</p>' : '') +
				'<div class="flex flex-wrap gap-4 text-sm text-gray-500 mt-2">' +
					'<span>Nombre: _______________________________</span>' +
					'<span>Grado: ______</span>' +
					'<span>Fecha: __________</span>' +
				'</div>' +
			'</div>';

		preguntas.forEach(function (p, i) {
			html += renderPreguntaVer(p, i + 1);
		});
		html += '</div>';

		mainEl.innerHTML = html;

		var btnImp = document.getElementById("btnImprimir");
		if (btnImp) btnImp.addEventListener("click", function () { window.print(); });
	}

	function renderPreguntaVer(p, num) {
		var cf = cfInfo(p.campo_formativo);
		var out = '<div class="flex flex-col gap-2">' +
			'<div class="flex items-start gap-2">' +
				'<span class="text-sm font-bold text-gray-700 shrink-0">' + num + '.</span>' +
				'<div class="flex-1">' +
					'<div class="flex flex-wrap items-center gap-2 mb-1">' +
						'<span class="text-xs ' + cf.badge + ' rounded-full px-2 py-0.5 font-medium">' + escapeHtml(p.campo_formativo || "—") + '</span>' +
						'<span class="text-xs text-gray-400">' + escapeHtml(TIPO_LABEL[p.tipo_pregunta] || p.tipo_pregunta || "") + '</span>' +
					'</div>' +
					'<p class="text-sm text-gray-800 leading-snug">' + escapeHtml(p.pregunta) + '</p>';

	if (p.tipo_pregunta === "opcion_multiple" && Array.isArray(p.opciones)) {
			out += '<ul class="mt-2 flex flex-col gap-1">';
			p.opciones.forEach(function (op) {
				out += '<li class="text-sm text-gray-700">' +
					'<span class="font-semibold mr-1">' + escapeHtml((op.letra || "") + ")") + '</span>' +
					escapeHtml(op.texto) + '</li>';
			});
			out += '</ul>';
		} else if (p.tipo_pregunta === "verdadero_falso") {
			out += '<div class="mt-2 flex gap-6 text-sm text-gray-700">' +
				'<span>(  ) Verdadero</span><span>(  ) Falso</span></div>';
		} else if (p.tipo_pregunta === "completar" || p.tipo_pregunta === "abierta") {
			out += '<div class="mt-2 border-b border-gray-300 h-6"></div>' +
				(p.tipo_pregunta === "abierta" ? '<div class="border-b border-gray-300 h-6 mt-3"></div>' : '');
		}

		out += '</div></div></div>';
		return out;
	}

	// ── Pestaña B: Calificar ─────────────────────────────────────────────────────
	function renderCalificar() {
		ocultarMensaje();

		if (!alumnos.length) {
			footerEl.classList.add("hidden");
			mainEl.innerHTML = emptyState(
				"No hay alumnos activos en el grupo.",
				"Agrega alumnos a tu grupo para poder calificar este examen."
			);
			return;
		}

		footerEl.classList.remove("hidden");

		var alumno = alumnos.find(function (a) { return a.id === alumnoActualId; }) || alumnos[0];
		alumnoActualId = alumno.id;

		// Selector de alumnos (chips)
		var chips = alumnos.map(function (a) {
			var activo = a.id === alumnoActualId;
			var calificado = alumnoCalificado(a.id);
			var cls = "inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap min-h-[44px] transition-colors " +
				(activo ? "bg-blue-800 text-white" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50");
			var marca = calificado ? '<span class="inline-block w-2 h-2 rounded-full ' + (activo ? "bg-emerald-300" : "bg-emerald-500") + '"></span>' : '';
			return '<button type="button" data-alumno-chip="' + escAttr(a.id) + '" class="' + cls + '">' +
				marca + escapeHtml(nombreCorto(a.nombre_completo)) +
				(a.grado ? ' <span class="text-xs opacity-70">' + escapeHtml(a.grado) + '°</span>' : '') +
				'</button>';
		}).join("");

		var html = '<div class="no-print">' +
			'<label for="selectAlumno" class="block text-xs text-gray-500 mb-1 sm:hidden">Alumno</label>' +
			'<select id="selectAlumno" class="sm:hidden w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none mb-3">' +
				alumnos.map(function (a) {
					return '<option value="' + escAttr(a.id) + '"' + (a.id === alumnoActualId ? " selected" : "") + '>' +
						escapeHtml(a.nombre_completo) + (a.grado ? " (" + a.grado + "°)" : "") +
						(alumnoCalificado(a.id) ? " ✓" : "") + '</option>';
				}).join("") +
			'</select>' +
			'<div class="hidden sm:flex flex-wrap gap-2 mb-3">' + chips + '</div>' +
		'</div>';

		// Cabecera del alumno
		html += '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-2">' +
			'<span class="text-base font-bold text-gray-800">' + escapeHtml(alumno.nombre_completo) + '</span>' +
			(alumno.grado ? '<span class="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">' + escapeHtml(alumno.grado) + '° grado</span>' : '') +
		'</div>';

		// Preguntas
		html += '<div id="listaCalificar" class="flex flex-col gap-4 mt-4">';
		preguntas.forEach(function (p, i) {
			html += renderPreguntaCalificar(p, i + 1, alumno.id);
		});
		html += '</div>';

		mainEl.innerHTML = html;

		// Eventos
		var sel = document.getElementById("selectAlumno");
		if (sel) sel.addEventListener("change", function () {
			alumnoActualId = sel.value;
			renderCalificar();
			window.scrollTo({ top: 0, behavior: "smooth" });
		});

		mainEl.querySelectorAll("button[data-alumno-chip]").forEach(function (b) {
			b.addEventListener("click", function () {
				alumnoActualId = b.dataset.alumnoChip;
				renderCalificar();
				window.scrollTo({ top: 0, behavior: "smooth" });
			});
		});

		bindCalificarEventos(alumno.id);
		actualizarFooter();
	}

	function renderPreguntaCalificar(p, num, alumnoId) {
		var cf = cfInfo(p.campo_formativo);
		var r = respMap[rkey(alumnoId, p.id)] || {};
		var ppp = puntosPorPregunta();

		var out = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3" data-pregunta="' + escAttr(p.id) + '">' +
			'<div class="flex items-start gap-2">' +
				'<span class="text-sm font-bold text-gray-700 shrink-0">' + num + '.</span>' +
				'<div class="flex-1">' +
					'<div class="flex flex-wrap items-center gap-2 mb-1">' +
						'<span class="text-xs ' + cf.badge + ' rounded-full px-2 py-0.5 font-medium">' + escapeHtml(p.campo_formativo || "—") + '</span>' +
						'<span class="text-xs text-gray-400">' + escapeHtml(TIPO_LABEL[p.tipo_pregunta] || p.tipo_pregunta || "") + '</span>' +
					'</div>' +
					'<p class="text-sm text-gray-800 leading-snug">' + escapeHtml(p.pregunta) + '</p>' +
				'</div>' +
			'</div>';

		if (p.tipo_pregunta === "opcion_multiple" && Array.isArray(p.opciones)) {
			out += '<div class="flex flex-col gap-2">';
			p.opciones.forEach(function (op) {
				var sel = r.respuesta_alumno != null &&
					String(r.respuesta_alumno).toLowerCase() === String(op.letra).toLowerCase();
				var correcta = String(p.respuesta_correcta || "").toLowerCase() === String(op.letra).toLowerCase();
				var cls = "w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium min-h-[44px] border transition-colors ";
				if (sel && correcta) cls += "bg-emerald-500 text-white border-emerald-500";
				else if (sel && !correcta) cls += "bg-red-500 text-white border-red-500";
				else if (correcta) cls += "bg-emerald-50 text-emerald-700 border-emerald-300";
				else cls += "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100";
				out += '<button type="button" data-opcion="' + escAttr(op.letra) + '" class="' + cls + '">' +
					'<span class="font-bold mr-2">' + escapeHtml((op.letra || "").toUpperCase()) + '</span>' +
					escapeHtml(op.texto) + '</button>';
			});
			out += '</div>';
		} else if (p.tipo_pregunta === "verdadero_falso") {
			var rv = String(r.respuesta_alumno || "").toUpperCase();
			out += '<div class="flex gap-2">';
			["V", "F"].forEach(function (val) {
				var sel = rv === val;
				var correcta = String(p.respuesta_correcta || "").toUpperCase() === val;
				var cls = "flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] border transition-colors ";
				if (sel && correcta) cls += "bg-emerald-500 text-white border-emerald-500";
				else if (sel && !correcta) cls += "bg-red-500 text-white border-red-500";
				else cls += "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100";
				out += '<button type="button" data-vf="' + val + '" class="' + cls + '">' +
					(val === "V" ? "Verdadero" : "Falso") + '</button>';
			});
			out += '</div>';
		} else {
			// completar / abierta — manual
			var modelo = p.respuesta_correcta ? escapeHtml(p.respuesta_correcta) : "";
			out += '<textarea data-resp-abierta rows="2" placeholder="Respuesta del alumno..." ' +
				'class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none placeholder-gray-400">' +
				escapeHtml(r.respuesta_alumno || "") + '</textarea>';
			if (modelo) {
				out += '<p class="text-xs text-gray-400">Respuesta modelo: <span class="text-gray-500">' + modelo + '</span></p>';
			}
			out += '<div class="flex flex-wrap items-center gap-4">' +
				'<label class="inline-flex items-center gap-2 text-sm text-gray-700">' +
					'<input type="checkbox" data-correcta-chk class="h-5 w-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"' +
					(r.es_correcta ? " checked" : "") + '> ¿Correcto?</label>' +
				'<label class="inline-flex items-center gap-2 text-sm text-gray-700">Puntos ' +
					'<input type="number" data-puntos min="0" max="' + ppp + '" step="0.01" ' +
					'value="' + (r.puntos_obtenidos != null ? r.puntos_obtenidos : "") + '" ' +
					'placeholder="0–' + ppp + '" inputmode="decimal" ' +
					'class="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"></label>' +
			'</div>' +
			'<textarea data-obs rows="1" placeholder="Observación del maestro (opcional)..." ' +
				'class="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none placeholder-gray-400">' +
				escapeHtml(r.observacion || "") + '</textarea>';
		}

		// Indicador de puntos obtenidos
		out += '<div class="text-xs text-gray-400" data-puntos-info>' +
			(r.puntos_obtenidos != null ? "Puntos: " + r.puntos_obtenidos + " / " + ppp : "Sin calificar · " + ppp + " pts") +
			'</div>';

		out += '</div>';
		return out;
	}

	// ── auto-calificación ─────────────────────────────────────────────────────
	function autoCalificar(pregunta, respuestaAlumno) {
		var ppp = puntosPorPregunta();
		var esCorrecta = false;
		if (pregunta.tipo_pregunta === "opcion_multiple" || pregunta.tipo_pregunta === "verdadero_falso") {
			esCorrecta = respuestaAlumno != null &&
				String(respuestaAlumno).toLowerCase() === String(pregunta.respuesta_correcta || "").toLowerCase();
		}
		return { es_correcta: esCorrecta, puntos_obtenidos: esCorrecta ? ppp : 0 };
	}

	// ── guardar respuesta (upsert) ──────────────────────────────────────────────
	async function guardarRespuesta(alumnoId, pregunta, respuestaAlumno, esCorrecta, puntos, observacion, automatico) {
		var fila = {
			examen_id: examenId,
			alumno_id: alumnoId,
			pregunta_id: pregunta.id,
			respuesta_alumno: respuestaAlumno != null ? String(respuestaAlumno) : null,
			es_correcta: esCorrecta,
			puntos_obtenidos: puntos != null ? puntos : null,
			calificada_por: automatico ? "automatico" : "maestro",
			observacion: observacion || null
		};
		respMap[rkey(alumnoId, pregunta.id)] = fila;
		try {
			var res = await window.sb
				.from("respuestas_examen")
				.upsert(fila, { onConflict: "examen_id,alumno_id,pregunta_id" });
			if (res.error) console.error("Error guardando respuesta:", res.error);
		} catch (e) {
			console.error("Error guardando respuesta:", e);
		}
	}

	// ── eventos de la pestaña calificar ─────────────────────────────────────────
	function bindCalificarEventos(alumnoId) {
		var lista = document.getElementById("listaCalificar");
		if (!lista) return;

		// Botones (opción múltiple y V/F) → auto-calificar
		lista.addEventListener("click", async function (e) {
			var card = e.target.closest("[data-pregunta]");
			if (!card) return;
			var pregId = card.dataset.pregunta;
			var pregunta = preguntas.find(function (p) { return p.id === pregId; });
			if (!pregunta) return;

			var btnOp = e.target.closest("button[data-opcion]");
			var btnVf = e.target.closest("button[data-vf]");
			if (!btnOp && !btnVf) return;

			var respuesta = btnOp ? btnOp.dataset.opcion : btnVf.dataset.vf;
			var calc = autoCalificar(pregunta, respuesta);
			await guardarRespuesta(alumnoId, pregunta, respuesta, calc.es_correcta, calc.puntos_obtenidos, null, true);

			// Re-render de esta tarjeta
			refrescarTarjeta(card, pregunta, alumnoId);
			actualizarFooter();
		});

		// completar / abierta: respuesta del alumno
		lista.addEventListener("blur", async function (e) {
			var card = e.target.closest("[data-pregunta]");
			if (!card) return;
			var pregId = card.dataset.pregunta;
			var pregunta = preguntas.find(function (p) { return p.id === pregId; });
			if (!pregunta) return;

			if (e.target.matches("textarea[data-resp-abierta], textarea[data-obs]")) {
				await guardarDesdeManual(card, pregunta, alumnoId);
			}
		}, true);

		// checkbox ¿correcto? e input de puntos
		lista.addEventListener("change", async function (e) {
			var card = e.target.closest("[data-pregunta]");
			if (!card) return;
			var pregId = card.dataset.pregunta;
			var pregunta = preguntas.find(function (p) { return p.id === pregId; });
			if (!pregunta) return;

			if (e.target.matches("input[data-correcta-chk]")) {
				// Al marcar correcto, autollenar puntos con el máximo si está vacío
				var puntosInput = card.querySelector("input[data-puntos]");
				if (e.target.checked && puntosInput && puntosInput.value === "") {
					puntosInput.value = puntosPorPregunta();
				}
				if (!e.target.checked && puntosInput) {
					puntosInput.value = 0;
				}
				await guardarDesdeManual(card, pregunta, alumnoId);
			} else if (e.target.matches("input[data-puntos]")) {
				await guardarDesdeManual(card, pregunta, alumnoId);
			}
		});
	}

	async function guardarDesdeManual(card, pregunta, alumnoId) {
		var taResp = card.querySelector("textarea[data-resp-abierta]");
		var chk = card.querySelector("input[data-correcta-chk]");
		var puntosInput = card.querySelector("input[data-puntos]");
		var taObs = card.querySelector("textarea[data-obs]");

		var respuesta = taResp ? taResp.value.trim() : null;
		var esCorrecta = chk ? !!chk.checked : null;
		var ppp = puntosPorPregunta();
		var puntos = null;
		if (puntosInput && puntosInput.value !== "") {
			puntos = Math.max(0, Math.min(ppp, Number(puntosInput.value) || 0));
			puntos = Math.round(puntos * 100) / 100;
		} else if (esCorrecta != null) {
			puntos = esCorrecta ? ppp : 0;
		}
		var obs = taObs ? taObs.value.trim() : null;

		await guardarRespuesta(alumnoId, pregunta, respuesta, esCorrecta, puntos, obs, false);

		var info = card.querySelector("[data-puntos-info]");
		if (info) {
			info.textContent = puntos != null ? "Puntos: " + puntos + " / " + ppp : "Sin calificar · " + ppp + " pts";
		}
		actualizarFooter();
	}

	function refrescarTarjeta(card, pregunta, alumnoId) {
		var idx = preguntas.findIndex(function (p) { return p.id === pregunta.id; });
		var nuevo = document.createElement("div");
		nuevo.innerHTML = renderPreguntaCalificar(pregunta, idx + 1, alumnoId);
		var nuevoCard = nuevo.firstChild;
		card.parentNode.replaceChild(nuevoCard, card);
	}

	// ── cálculo por CF ──────────────────────────────────────────────────────────
	function calcularPorCF(alumnoId) {
		var ppp = puntosPorPregunta();
		var porCF = {};
		preguntas.forEach(function (p) {
			var cf = p.campo_formativo || "—";
			if (!porCF[cf]) porCF[cf] = { puntos: 0, total: 0 };
			porCF[cf].total += ppp;
			var r = respMap[rkey(alumnoId, p.id)];
			if (r && r.puntos_obtenidos != null) porCF[cf].puntos += Number(r.puntos_obtenidos) || 0;
		});
		return porCF;
	}

	function alumnoCalificado(alumnoId) {
		// Calificado si tiene al menos una respuesta registrada para cada pregunta
		return preguntas.every(function (p) {
			var r = respMap[rkey(alumnoId, p.id)];
			return r && (r.puntos_obtenidos != null || r.es_correcta != null || r.respuesta_alumno);
		});
	}

	// ── footer ────────────────────────────────────────────────────────────────
	function actualizarFooter() {
		if (!alumnoActualId) return;
		var porCF = calcularPorCF(alumnoActualId);
		if (footerCFEl) {
			footerCFEl.innerHTML = Object.keys(porCF).map(function (cf) {
				var info = cfInfo(cf);
				var d = porCF[cf];
				return '<span class="inline-flex items-center gap-1">' +
					'<span class="inline-block w-2.5 h-2.5 rounded-full ' + info.dot + '"></span>' +
					'<span class="' + info.pill + '">' + escapeHtml(cf) + ': ' +
					(Math.round(d.puntos * 100) / 100) + ' / ' + (Math.round(d.total * 100) / 100) + '</span>' +
				'</span>';
			}).join("");
		}

		var calificados = alumnos.filter(function (a) { return alumnoCalificado(a.id); }).length;
		var total = alumnos.length;
		var pct = total ? Math.round((calificados / total) * 100) : 0;
		if (footerProgEl) footerProgEl.textContent = calificados + " de " + total + " alumnos calificados";
		if (footerBarraEl) footerBarraEl.style.width = pct + "%";
	}

	// ── siguiente alumno ────────────────────────────────────────────────────────
	function siguienteAlumno() {
		if (!alumnos.length) return;
		var idx = alumnos.findIndex(function (a) { return a.id === alumnoActualId; });
		var next = alumnos[(idx + 1) % alumnos.length];
		alumnoActualId = next.id;
		renderCalificar();
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	// ── ajustar padding por header + tabs ─────────────────────────────────────
	function ajustarPadding() {
		var navbar = document.getElementById("app-navbar");
		var header = document.getElementById("examenHeader");
		if (!navbar || !header || !contenidoEl) return;
		var navH = navbar.offsetHeight;
		var hdrH = header.offsetHeight;
		var tabsH = (tabsEl && !tabsEl.classList.contains("hidden")) ? tabsEl.offsetHeight : 0;
		// reposicionar barra de pestañas debajo del header
		if (tabsEl && !tabsEl.classList.contains("hidden")) {
			tabsEl.style.top = (navH + hdrH) + "px";
		}
		contenidoEl.style.paddingTop = (navH + hdrH + tabsH + 12) + "px";
	}
	window.addEventListener("resize", ajustarPadding);
	ajustarPadding();
});
