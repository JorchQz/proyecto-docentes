document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	const estadoEl    = document.getElementById("tareasEstado");
	const listaEl     = document.getElementById("tareasLista");
	const filtroProy  = document.getElementById("filtroProyecto");
	const filtroGrado = document.getElementById("filtroGrado");

	let todasTareas = [];

	const { data: { user }, error: userErr } = await window.sb.auth.getUser();
	if (userErr || !user) {
		window.location.href = "index.html";
		return;
	}

	// tareas se materializan en esta tabla cuando dashboard.js cierra una sesión
	const { data: tareas, error } = await window.sb
		.from("tareas")
		.select("id, descripcion, grado, fecha_asignada, fecha_revision, revisada, proyecto_id, sesion_id, proyectos(id, titulo)")
		.eq("maestro_id", user.id)
		.order("fecha_asignada", { ascending: false });

	if (error) {
		estadoEl.textContent = "No se pudieron cargar las tareas. Intenta de nuevo.";
		return;
	}

	todasTareas = tareas || [];

	const proyectosVistos = {};
	todasTareas.forEach(function (t) {
		const p = t.proyectos;
		if (p && !proyectosVistos[p.id]) {
			proyectosVistos[p.id] = true;
			const opt = document.createElement("option");
			opt.value = p.id;
			opt.textContent = p.titulo || "Proyecto sin título";
			filtroProy.appendChild(opt);
		}
	});

	filtroProy.addEventListener("change", renderFiltrado);
	filtroGrado.addEventListener("change", renderFiltrado);

	renderFiltrado();

	function renderFiltrado() {
		const pFiltro = filtroProy.value;
		const gFiltro = filtroGrado.value;

		const filtradas = todasTareas.filter(function (t) {
			if (pFiltro && t.proyecto_id !== pFiltro) return false;
			if (gFiltro === "todos" && t.grado !== null) return false;
			if (gFiltro && gFiltro !== "todos" && t.grado !== null && String(t.grado) !== gFiltro) return false;
			return true;
		});

		render(filtradas);
	}

	function render(lista) {
		if (!lista.length) {
			estadoEl.innerHTML = todasTareas.length
				? '<p class="text-gray-400">No hay tareas para este filtro.</p>'
				: sinTareasHtml();
			estadoEl.classList.remove("hidden");
			listaEl.classList.add("hidden");
			listaEl.innerHTML = "";
			return;
		}

		estadoEl.classList.add("hidden");
		listaEl.classList.remove("hidden");
		listaEl.innerHTML = "";

		lista.forEach(function (tarea) {
			const proyecto = tarea.proyectos || {};
			const card = document.createElement("div");
			card.className = "bg-white rounded-2xl border border-gray-200 p-5 shadow-sm transition-shadow hover:shadow-md";

			const gradoBadge = tarea.grado
				? '<span class="inline-flex items-center bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">' + tarea.grado + '°</span>'
				: '<span class="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">Todos los grados</span>';

			const revisadaBadge = tarea.revisada
				? '<span class="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-semibold">✓ Revisada</span>'
				: '<span class="inline-flex items-center bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2 py-1 rounded-full font-semibold">Pendiente</span>';

			const fechaTexto = tarea.fecha_asignada
				? formatFecha(tarea.fecha_asignada)
				: "";

			card.innerHTML =
				'<div class="flex items-start justify-between gap-3 mb-3">' +
					'<div class="flex items-start gap-2 min-w-0">' +
						'<svg class="h-5 w-5 shrink-0 mt-0.5 ' + (tarea.revisada ? 'text-green-500' : 'text-amber-400') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
						'<div class="min-w-0">' +
							'<p class="text-xs text-gray-500 mb-0.5">' + esc(proyecto.titulo || "Proyecto") + '</p>' +
							'<p class="font-semibold text-gray-800 text-sm leading-snug">' + esc(tarea.descripcion) + '</p>' +
						'</div>' +
					'</div>' +
					revisadaBadge +
				'</div>' +
				'<div class="flex flex-wrap items-center gap-2 mb-4">' +
					gradoBadge +
					(fechaTexto ? '<span class="text-xs text-gray-500">📅 Asignada ' + fechaTexto + '</span>' : '') +
					(tarea.fecha_revision ? '<span class="text-xs text-gray-500">🔍 Revisar ' + formatFecha(tarea.fecha_revision) + '</span>' : '') +
				'</div>' +
				'<button data-id="' + esc(tarea.id) + '" data-revisada="' + (tarea.revisada ? 'true' : 'false') + '" ' +
					'class="btn-toggle-revisada w-full py-3 rounded-xl text-sm font-bold border transition ' +
					(tarea.revisada
						? 'border-gray-300 text-gray-600 hover:bg-gray-50'
						: 'border-green-500 text-green-700 hover:bg-green-50') + '">' +
					(tarea.revisada ? 'Marcar como pendiente' : '✓ Marcar como revisada') +
				'</button>';

			listaEl.appendChild(card);
		});

		listaEl.addEventListener("click", handleToggle);
	}

	async function handleToggle(event) {
		const btn = event.target.closest(".btn-toggle-revisada");
		if (!btn) return;

		const id       = btn.dataset.id;
		const esActual = btn.dataset.revisada === "true";
		const nuevo    = !esActual;

		btn.disabled = true;
		btn.textContent = "Guardando...";

		const { error } = await window.sb
			.from("tareas")
			.update({ revisada: nuevo })
			.eq("id", id);

		if (error) {
			btn.disabled = false;
			btn.textContent = esActual ? "Marcar como pendiente" : "✓ Marcar como revisada";
			_toast("No se pudo actualizar la tarea.", "error");
			return;
		}

		// Actualizar estado local y re-renderizar
		todasTareas = todasTareas.map(function (t) {
			return t.id === id ? Object.assign({}, t, { revisada: nuevo }) : t;
		});
		renderFiltrado();
	}

	function formatFecha(iso) {
		if (!iso) return "";
		const d = new Date(iso + "T00:00:00");
		return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(d);
	}

	function sinTareasHtml() {
		return '<div class="py-8">' +
			'<p class="text-gray-400 text-lg mb-2">No hay tareas asignadas aún</p>' +
			'<p class="text-sm text-gray-400 mb-4">Las tareas aparecen aquí cuando cierras una sesión desde el Dashboard.</p>' +
			'<a href="dashboard.html" class="inline-block bg-blue-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition">Ir al Dashboard</a>' +
		'</div>';
	}

	function _toast(msg, type) {
		var el = document.createElement("div");
		var bg = type === "error" ? "bg-red-600" : "bg-green-600";
		el.className = "fixed bottom-4 right-4 z-50 " + bg + " text-white px-4 py-3 rounded-xl shadow-lg text-sm";
		el.textContent = msg;
		document.body.appendChild(el);
		setTimeout(function () { el.remove(); }, 3500);
	}

	function esc(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}
});
