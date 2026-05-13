document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	const estadoEl  = document.getElementById("actividadesEstado");
	const gridEl    = document.getElementById("actividadesGrid");
	const filtroProy = document.getElementById("filtroProyecto");
	const filtroCampo = document.getElementById("filtroCampo");

	let todasSesiones = [];

	const { data: { user }, error: userErr } = await window.sb.auth.getUser();
	if (userErr || !user) {
		window.location.href = "index.html";
		return;
	}

	const { data: sesiones, error } = await window.sb
		.from("sesiones")
		.select("id, proyecto_id, numero_sesion, campo_formativo, momento, duracion, inicio_actividades, desarrollo_actividades, cierre_actividades, proyectos(id, titulo, estado)")
		.eq("maestro_id", user.id)
		.order("numero_sesion", { ascending: true });

	if (error) {
		estadoEl.textContent = "No se pudieron cargar las actividades. Intenta de nuevo.";
		return;
	}

	todasSesiones = sesiones || [];

	const proyectosVistos = {};
	todasSesiones.forEach(function (s) {
		const p = s.proyectos;
		if (p && !proyectosVistos[p.id]) {
			proyectosVistos[p.id] = p.titulo || "Proyecto sin título";
			const opt = document.createElement("option");
			opt.value = p.id;
			opt.textContent = p.titulo || "Proyecto sin título";
			filtroProy.appendChild(opt);
		}
	});

	filtroProy.addEventListener("change", renderFiltrado);
	filtroCampo.addEventListener("change", renderFiltrado);

	renderFiltrado();

	function renderFiltrado() {
		const pFiltro = filtroProy.value;
		const cFiltro = filtroCampo.value;

		const filtradas = todasSesiones.filter(function (s) {
			if (pFiltro && s.proyecto_id !== pFiltro) return false;
			if (cFiltro && s.campo_formativo !== cFiltro) return false;
			return true;
		});

		render(filtradas);
	}

	function render(sesiones) {
		if (!sesiones.length) {
			estadoEl.innerHTML = todasSesiones.length
				? '<p class="text-gray-400">No hay sesiones para este filtro.</p>'
				: sinProyectosHtml();
			estadoEl.classList.remove("hidden");
			gridEl.classList.add("hidden");
			gridEl.innerHTML = "";
			return;
		}

		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";

		sesiones.forEach(function (sesion) {
			const proyecto = sesion.proyectos || {};
			const estado   = proyecto.estado || "borrador";
			const badgeMap = {
				activo:    "bg-green-100 text-green-700",
				borrador:  "bg-emerald-50 text-emerald-700 border border-emerald-200",
				pausado:   "bg-yellow-100 text-yellow-700",
				completado:"bg-blue-100 text-blue-700",
			};
			const badgeCls  = badgeMap[estado] || badgeMap.borrador;
			const badgeTxt  = { activo: "Activo", borrador: "Listo", pausado: "Pausado", completado: "Completado" }[estado] || "Listo";

			const actInicio = extraer(sesion.inicio_actividades);
			const actDes    = extraer(sesion.desarrollo_actividades);
			const actCierre = extraer(sesion.cierre_actividades);

			const card = document.createElement("article");
			card.className = "bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow";

			card.innerHTML =
				'<div class="flex items-start justify-between gap-2 mb-3">' +
					'<div class="min-w-0">' +
						'<p class="text-xs text-gray-500 truncate">' + esc(proyecto.titulo || "Proyecto") + '</p>' +
						'<h3 class="font-bold text-gray-800 text-base">Sesión ' + sesion.numero_sesion +
							(sesion.momento ? ' <span class="font-normal text-gray-500">— ' + esc(sesion.momento) + '</span>' : '') +
						'</h3>' +
					'</div>' +
					'<span class="shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ' + badgeCls + '">' + badgeTxt + '</span>' +
				'</div>' +
				(sesion.campo_formativo
					? '<span class="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full mb-3">' + esc(sesion.campo_formativo) + '</span> '
					: '') +
				(sesion.duracion ? '<span class="inline-block text-xs text-gray-500 mb-3">⏱ ' + esc(sesion.duracion) + '</span>' : '') +
				bloqueActividades("INICIO", actInicio) +
				bloqueActividades("DESARROLLO", actDes) +
				bloqueActividades("CIERRE", actCierre) +
				'<div class="border-t pt-3 mt-3">' +
					'<a href="crear_proyecto.html?id=' + esc(sesion.proyecto_id) + '" ' +
					   'class="block text-center bg-blue-600 text-white text-sm font-bold px-4 py-3 rounded-xl hover:bg-blue-700 transition">' +
					'Ver proyecto completo</a>' +
				'</div>';

			gridEl.appendChild(card);
		});
	}

	function bloqueActividades(titulo, lista) {
		if (!lista.length) return "";
		const items = lista.slice(0, 3).map(function (a) {
			return '<li class="text-sm text-gray-700">' + esc(a) + '</li>';
		}).join("");
		const mas = lista.length > 3
			? '<li class="text-xs text-gray-400">+ ' + (lista.length - 3) + ' más...</li>'
			: "";
		return '<div class="mb-3">' +
			'<p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">' + titulo + '</p>' +
			'<ul class="list-disc list-inside space-y-0.5">' + items + mas + '</ul>' +
		'</div>';
	}

	function extraer(jsonb) {
		if (!jsonb) return [];
		try {
			const d = typeof jsonb === "string" ? JSON.parse(jsonb) : jsonb;
			if (d.mode === "todos" && Array.isArray(d.todos)) {
				return d.todos.filter(Boolean);
			}
			if (d.mode === "diferenciado" && d.diferenciado) {
				return Object.values(d.diferenciado)
					.flatMap(function (arr) { return Array.isArray(arr) ? arr : []; })
					.filter(Boolean);
			}
		} catch (_) {}
		return [];
	}

	function sinProyectosHtml() {
		return '<div class="py-8">' +
			'<p class="text-gray-400 text-lg mb-4">Aún no tienes proyectos con sesiones</p>' +
			'<a href="crear_proyecto.html" class="inline-block bg-blue-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition">Crear mi primer proyecto</a>' +
		'</div>';
	}

	function esc(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}
});
