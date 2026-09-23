/*
	Tareas del grupo activo: seguimiento de los productos tipo "tarea" de las sesiones.

	Es solo lectura. La revisión (entregó / incompleta / no entregó) se captura en "Hoy"
	el día que vence la tarea, en un solo lugar; aquí se ve qué hay asignado, cuándo vence
	y cuántos alumnos faltan por revisar. La tabla vieja `tareas` ya no se usa.
*/
document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	var estadoEl = document.getElementById("tareasEstado");
	var listaEl = document.getElementById("tareasLista");
	var filtroProy = document.getElementById("filtroProyecto");
	var filtroGrado = document.getElementById("filtroGrado");
	var filtroEstado = document.getElementById("filtroEstado");

	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };
	var NOMBRE_CAMPO = { LEN: "Lenguajes", SAB: "Saberes", ETI: "Ética", DHL: "Humano" };

	var hoy = fechaLocalISO();
	var tareas = [];
	var alumnos = [];
	var revisiones = {}; // producto_sesion_id → { alumno_id: estado_entrega }

	function fechaLocalISO() {
		var ahora = new Date();
		return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
	}

	function esc(str) {
		return String(str === null || str === undefined ? "" : str)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function formatFecha(iso) {
		if (!iso) return "";
		return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(iso + "T00:00:00"));
	}

	async function cargar() {
		var ses = await window.sb.auth.getSession();
		var session = ses.data ? ses.data.session : null;
		if (!session) { window.location.href = "index.html"; return false; }
		var maestroId = session.user.id;

		var activo = await window.GrupoActivo.cargar(window.sb, maestroId);
		var grupo = activo.grupo;
		if (!grupo) { window.location.href = "onboarding.html"; return false; }

		// Grados del grupo para el filtro (antes estaba fijo en 3° a 6°)
		var grados = (grupo.grados || []).map(Number).filter(Boolean).sort();
		grados.forEach(function (g) {
			var opt = document.createElement("option");
			opt.value = String(g);
			opt.textContent = g + "°";
			filtroGrado.appendChild(opt);
		});

		var alRes = await window.sb.from("alumnos").select("id, grado")
			.eq("maestro_id", maestroId).eq("grupo_id", grupo.id).eq("estatus", "activo");
		if (alRes.error) throw alRes.error;
		alumnos = alRes.data || [];

		var proyRes = await window.sb.from("proyectos").select("id, titulo, estado, trimestre")
			.eq("maestro_id", maestroId).eq("grupo_id", grupo.id);
		if (proyRes.error) throw proyRes.error;
		var proyectos = proyRes.data || [];
		if (!proyectos.length) return true;
		var proyPorId = {};
		proyectos.forEach(function (p) { proyPorId[p.id] = p; });

		var sesRes = await window.sb.from("sesiones").select("id, numero_sesion, fecha, proyecto_id")
			.in("proyecto_id", proyectos.map(function (p) { return p.id; }));
		if (sesRes.error) throw sesRes.error;
		var sesiones = sesRes.data || [];
		if (!sesiones.length) return true;
		var sesPorId = {};
		sesiones.forEach(function (s) { sesPorId[s.id] = s; });

		var prodRes = await window.sb.from("productos_sesion")
			.select("id, sesion_id, nombre, descripcion, grados, campo, fecha_entrega")
			.eq("tipo", "tarea").eq("activo", true)
			.in("sesion_id", sesiones.map(function (s) { return s.id; }));
		if (prodRes.error) throw prodRes.error;
		tareas = (prodRes.data || []).map(function (t) {
			var s = sesPorId[t.sesion_id] || {};
			return Object.assign({}, t, {
				sesion: s,
				proyecto: proyPorId[s.proyecto_id] || {},
				vence: t.fecha_entrega || s.fecha || null,
			});
		});

		if (tareas.length) {
			var calRes = await window.sb.from("calificaciones").select("alumno_id, producto_sesion_id, estado_entrega")
				.eq("maestro_id", maestroId).in("producto_sesion_id", tareas.map(function (t) { return t.id; }));
			if (calRes.error) throw calRes.error;
			(calRes.data || []).forEach(function (c) {
				if (!c.estado_entrega) return;
				(revisiones[c.producto_sesion_id] = revisiones[c.producto_sesion_id] || {})[c.alumno_id] = c.estado_entrega;
			});
		}

		// Lo más reciente arriba (como en "Hoy"); las que no tienen fecha, al final
		tareas.sort(function (a, b) {
			if (!a.vence && !b.vence) return (a.sesion.numero_sesion || 0) - (b.sesion.numero_sesion || 0);
			if (!a.vence) return 1;
			if (!b.vence) return -1;
			return a.vence < b.vence ? 1 : a.vence > b.vence ? -1 : 0;
		});

		var vistos = {};
		tareas.forEach(function (t) {
			var p = t.proyecto;
			if (p.id && !vistos[p.id]) {
				vistos[p.id] = true;
				var opt = document.createElement("option");
				opt.value = p.id;
				opt.textContent = p.titulo || "Proyecto sin título";
				filtroProy.appendChild(opt);
			}
		});
		return true;
	}

	function alumnosDe(t) {
		var grados = (t.grados || []).map(Number);
		return alumnos.filter(function (a) { return grados.indexOf(Number(a.grado)) !== -1; });
	}

	/*
		Situación de una tarea respecto a hoy y a su revisión. Un alumno está revisado si
		tiene CUALQUIER estado de entrega capturado en "Hoy", también "justificado" y "no
		aplica": así lo cuentan "Hoy" (que ya no la muestra) y el motor (que los saca del
		máximo). Antes un justificado dejaba la tarea "por revisar" para siempre.
	*/
	var ETIQUETA_CONTEO = [
		["entregado", "entregaron"], ["incompleto", "incompleta"], ["no_entregado", "no entregaron"],
		["justificado", "justificada"], ["no_aplica", "no aplica"],
	];
	function situacionDe(lista, rev, vence, hoyISO) {
		var conteo = { entregado: 0, incompleto: 0, no_entregado: 0, justificado: 0, no_aplica: 0 };
		var revisados = 0;
		lista.forEach(function (a) {
			var e = rev[a.id];
			if (!e) return;
			revisados++;
			if (conteo[e] !== undefined) conteo[e]++;
		});
		var estado;
		if (!vence) estado = "sin_fecha";
		else if (lista.length && revisados >= lista.length) estado = "revisada";
		else if (vence > hoyISO) estado = "proxima";
		else if (!lista.length) estado = "revisada"; // nadie a quien revisar
		else estado = "por_revisar";
		return { total: lista.length, revisados: revisados, conteo: conteo, estado: estado };
	}

	function situacion(t) {
		return situacionDe(alumnosDe(t), revisiones[t.id] || {}, t.vence, hoy);
	}

	function detalleConteo(conteo) {
		return ETIQUETA_CONTEO.filter(function (e) { return conteo[e[0]]; })
			.map(function (e) { return conteo[e[0]] + " " + e[1]; }).join(", ");
	}

	function renderFiltrado() {
		var pF = filtroProy.value, gF = filtroGrado.value, eF = filtroEstado.value;
		var lista = tareas.filter(function (t) {
			if (pF && t.proyecto.id !== pF) return false;
			if (gF && (t.grados || []).map(String).indexOf(gF) === -1) return false;
			if (eF && situacion(t).estado !== eF) return false;
			return true;
		});
		render(lista);
	}

	var ETIQUETA_ESTADO = {
		por_revisar: "<span class='inline-flex items-center bg-amber-50 text-amber-800 border border-amber-200 text-xs px-2 py-1 rounded-full font-semibold'>Por revisar</span>",
		revisada: "<span class='inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-semibold'><svg xmlns='http://www.w3.org/2000/svg' class='h-3.5 w-3.5 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m5 12 5 5L20 7'/></svg>Revisada</span>",
		proxima: "<span class='inline-flex items-center bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-full font-semibold'>Próxima</span>",
		sin_fecha: "<span class='inline-flex items-center bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full font-semibold'>Sin fecha</span>",
	};

	function render(lista) {
		if (!lista.length) {
			estadoEl.innerHTML = tareas.length ? "<p class='text-gray-400'>No hay tareas para este filtro.</p>" : sinTareasHtml();
			estadoEl.classList.remove("hidden");
			listaEl.classList.add("hidden");
			listaEl.innerHTML = "";
			return;
		}
		estadoEl.classList.add("hidden");
		listaEl.classList.remove("hidden");
		listaEl.innerHTML = lista.map(function (t) {
			var s = situacion(t);
			var gradosBadges = (t.grados || []).map(function (g) {
				return "<span class='inline-flex items-center bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full'>" + esc(g) + "°</span>";
			}).join("");
			var campo = t.campo && COLOR_CAMPO[t.campo]
				? "<span class='inline-flex items-center gap-1 text-xs text-gray-600'><span class='inline-block w-2 h-2 rounded-full' style='background:" + COLOR_CAMPO[t.campo] + "'></span>" + NOMBRE_CAMPO[t.campo] + "</span>" : "";
			var fecha = t.vence
				? "<span class='text-xs text-gray-500'>" + (t.vence < hoy ? "Venció el " : t.vence === hoy ? "Vence hoy, " : "Vence el ") + formatFecha(t.vence) + "</span>"
				: "<span class='text-xs text-gray-500'>Toma fecha cuando trabajes la sesión " + esc(t.sesion.numero_sesion || "") + " en Hoy</span>";
			var avance = s.total
				? "<p class='text-sm text-gray-700'><b>" + s.revisados + " de " + s.total + "</b> alumnos revisados" +
					(s.revisados ? " <span class='text-xs text-gray-500'>(" + detalleConteo(s.conteo) + ")</span>" : "") + "</p>"
				: "<p class='text-sm text-gray-500'>No hay alumnos activos de ese grado.</p>";
			var accion = s.estado === "por_revisar"
				? "<a href='hoy.html' class='inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition'>Revisar en Hoy</a>"
				: "";
			return "<div class='bg-white rounded-2xl border border-gray-200 p-5 shadow-sm'>" +
				"<div class='flex items-start justify-between gap-3 mb-2'>" +
				"<div class='min-w-0'>" +
				"<p class='text-xs text-gray-500 mb-0.5'>" + esc(t.proyecto.titulo || "Proyecto") + " · Sesión " + esc(t.sesion.numero_sesion || "") + "</p>" +
				"<p class='font-semibold text-gray-800 text-sm leading-snug'>" + esc(t.nombre) + "</p>" +
				(t.descripcion ? "<p class='text-sm text-gray-600 mt-1'>" + esc(t.descripcion) + "</p>" : "") +
				"</div>" + ETIQUETA_ESTADO[s.estado] + "</div>" +
				"<div class='flex flex-wrap items-center gap-2 mb-3'>" + gradosBadges + campo + fecha + "</div>" +
				"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>" + avance + accion + "</div>" +
				"</div>";
		}).join("");
	}

	function sinTareasHtml() {
		return "<div class='py-8'>" +
			"<p class='text-gray-400 text-lg mb-2'>No hay tareas en las sesiones de este grupo</p>" +
			"<p class='text-sm text-gray-400 mb-4'>Las tareas vienen de la planeación de cada sesión. Se revisan en Hoy el día que vencen.</p>" +
			"<a href='hoy.html' class='inline-flex items-center justify-center min-h-[44px] bg-blue-600 text-white font-bold px-6 rounded-xl hover:bg-blue-700 transition'>Ir a Hoy</a>" +
			"</div>";
	}

	filtroProy.addEventListener("change", renderFiltrado);
	filtroGrado.addEventListener("change", renderFiltrado);
	filtroEstado.addEventListener("change", renderFiltrado);

	// Arranque al final: todo lo de arriba ya está definido
	try {
		if (await cargar()) renderFiltrado();
	} catch (e) {
		console.error("tareas:", e);
		estadoEl.textContent = "No se pudieron cargar las tareas. Intenta de nuevo.";
	}
});
