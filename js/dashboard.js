/*
	dashboard.js — Inicio del maestro.

	La captura del día (asistencia, tareas, productos, cierre) vive en "Hoy" (hoy.html).
	Inicio NO la duplica: resume lo que falta de hoy y muestra el plan de la sesión que
	toca, con lo necesario para trabajarla y terminarla.

	  1. Tu día: lo pendiente de hoy, con el botón a "Hoy".
	  2. Sesión de hoy: el plan (inicio, desarrollo, cierre, recursos, PDA por grado).
	     Si ninguna sesión tiene fecha de hoy, propone la siguiente pendiente del proyecto
	     activo con "Trabajar hoy" (le pone la fecha de hoy, igual que en "Hoy").
	  3. Terminar sesión: la marca como completada con notas opcionales. Ya no escribe la
	     tabla vieja `tareas`: las tareas son productos de la sesión y se revisan en "Hoy".
*/

let user = null;
let grupo = null;
let grupoId = null;
let alumnos = [];
let proyectoActivo = null;
let sesionActiva = null; // la que se está mostrando (los ayudantes de render la leen)

document.addEventListener("DOMContentLoaded", async function () {
	try {
		const { data: { user: u }, error: userError } = await window.sb.auth.getUser();
		if (userError || !u) {
			window.location.href = "index.html";
			return;
		}
		user = u;
		await inicializarEncabezado();
		await cargarGrupoYAlumnos();
		if (!grupoId) return;

		const { data: proyectos, error: proyectoError } = await window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado")
			.eq("maestro_id", user.id)
			.eq("grupo_id", grupoId)
			.eq("estado", "activo")
			.order("created_at", { ascending: false })
			.limit(1);
		if (proyectoError) {
			showError("No se pudo cargar el proyecto activo: " + proyectoError.message);
		}
		proyectoActivo = proyectos && proyectos.length ? proyectos[0] : null;

		const container = document.getElementById("flowContainer");
		container.innerHTML = "";
		container.appendChild(await crearCardHoy());
		if (!proyectoActivo) {
			container.appendChild(crearCardSinProyecto());
			return;
		}
		await renderSesiones(container);
	} catch (error) {
		showError("Error inesperado al cargar el inicio: " + (error.message || ""));
	}
});

async function inicializarEncabezado() {
	const { data: perfil } = await window.sb
		.from("perfiles")
		.select("nombre_completo")
		.eq("id", user.id)
		.maybeSingle();

	const hora = new Date().getHours();
	const saludo = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
	const nombre = (perfil && perfil.nombre_completo ? perfil.nombre_completo : "").trim();
	document.getElementById("welcomeTitle").textContent = saludo + (nombre ? ", " + nombre.split(" ")[0] : "");
	document.getElementById("fechaHoy").textContent = new Date().toLocaleDateString("es-MX", {
		weekday: "long", year: "numeric", month: "long", day: "numeric",
	});
	document.getElementById("welcomeSub").textContent = "Inicio";
}

async function cargarGrupoYAlumnos() {
	// Grupo activo: único lugar que lo decide (valida que el guardado sea de este maestro)
	try {
		const activo = await window.GrupoActivo.cargar(window.sb, user.id);
		grupo = activo.grupo;
		grupoId = grupo ? grupo.id : null;
	} catch (grupoError) {
		showError("No se pudo cargar el grupo activo: " + (grupoError.message || "error desconocido"));
		return;
	}
	if (!grupoId) {
		window.location.href = "onboarding.html";
		return;
	}
	const { data: als, error: alumnosError } = await window.sb
		.from("alumnos")
		.select("id, nombre_completo, grado, num_lista")
		.eq("grupo_id", grupoId)
		.eq("estatus", "activo")
		.order("grado")
		.order("num_lista");
	if (alumnosError) showError("No se pudo cargar la lista de alumnos: " + alumnosError.message);
	alumnos = als || [];
	document.getElementById("welcomeSub").textContent = (grupo.nombre || "Grupo") + " · " + alumnos.length + " alumnos";
}

// ── 1. Tu día: lo que falta de hoy ──────────────────────────────────────────
async function crearCardHoy() {
	const hoy = getLocalDateISO();
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6";

	// Asistencia y cierre del día de hoy
	const [asisRes, regRes] = await Promise.all([
		window.sb.from("asistencias").select("alumno_id, asistencia_estado").eq("grupo_id", grupoId).eq("fecha", hoy),
		alumnos.length
			? window.sb.from("registro_diario").select("alumno_id").eq("maestro_id", user.id).eq("fecha", hoy)
				.in("alumno_id", alumnos.map((a) => a.id))
			: Promise.resolve({ data: [] }),
	]);
	// Solo alumnos activos: uno dado de baja con asistencia de hoy no debe dar "9 de 8"
	const activos = new Set(alumnos.map((a) => a.id));
	const conAsistencia = new Set((asisRes.data || []).map((r) => r.alumno_id).filter((id) => activos.has(id))).size;
	// Cierre del día con la misma regla que "Hoy": no se espera de quien faltó
	const faltaron = new Set((asisRes.data || [])
		.filter((r) => r.asistencia_estado === "ausente" || r.asistencia_estado === "justificada")
		.map((r) => r.alumno_id));
	const esperadosCierre = alumnos.filter((a) => !faltaron.has(a.id));
	const conRegistro = new Set((regRes.data || []).map((r) => r.alumno_id));
	const conCierre = esperadosCierre.filter((a) => conRegistro.has(a.id)).length;
	const cierre = window.AlcanceHoy.resumenCierre(alumnos.length, esperadosCierre.length, conCierre);

	// Lo mismo que muestra "Hoy", con el mismo alcance de proyectos (js/alcance-hoy.js):
	// productos de las sesiones de hoy sin calificar y tareas vencidas con alumnos sin revisar
	let sinCalificar = 0;
	let sesionesHoy = 0;
	let tareasPorRevisar = 0;
	const { data: proys } = await window.sb.from("proyectos").select("id")
		.eq("maestro_id", user.id).eq("grupo_id", grupoId).or(window.AlcanceHoy.filtro(grupo, hoy));
	const proyIds = (proys || []).map((p) => p.id);
	// Si una lectura falla, Inicio sigue en pie: esos conteos dicen que no se pudieron leer
	let sinLeer = false;
	try {
		if (proyIds.length) {
			// Lecturas sin el tope de 1000 filas de Supabase, igual que "Hoy" (js/alcance-hoy.js)
			const leer = window.AlcanceHoy.leerPorLotes;
			const ses = await leer(proyIds, (lote) => window.sb.from("sesiones").select("id, fecha").in("proyecto_id", lote).order("id"));
			const fechaSesion = {};
			ses.forEach((s) => { fechaSesion[s.id] = s.fecha; });
			const idsHoy = ses.filter((s) => s.fecha === hoy).map((s) => s.id);
			sesionesHoy = idsHoy.length;
			// Las mismas sesiones que carga "Hoy": una tarea puede tener fecha de entrega aunque
			// su sesión aún no tenga fecha
			const idsSesiones = ses.map((s) => s.id);
			if (idsSesiones.length) {
				const prods = await leer(idsSesiones, (lote) => window.sb.from("productos_sesion")
					.select("id, tipo, grados, sesion_id, fecha_entrega").in("sesion_id", lote).eq("activo", true).order("id"));
				const trabajos = prods.filter((p) => p.tipo !== "tarea" && idsHoy.indexOf(p.sesion_id) !== -1);
				const tareas = prods.filter((p) => {
					const vence = p.tipo === "tarea" ? window.AlcanceHoy.venceTarea(p.fecha_entrega, fechaSesion[p.sesion_id]) : null;
					return vence && vence <= hoy;
				});
				const revisar = trabajos.concat(tareas);
				if (revisar.length) {
					const cals = await leer(revisar.map((p) => p.id), (lote) => window.sb.from("calificaciones")
						.select("alumno_id, producto_sesion_id, nivel, estado_entrega, puntaje")
						.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id"));
					// Calificado = semáforo, estado de entrega o puntaje (misma regla que "Hoy")
					const hechas = new Set(cals.filter((c) => c.nivel || c.estado_entrega || (c.puntaje !== null && c.puntaje !== undefined))
						.map((c) => c.alumno_id + "|" + c.producto_sesion_id));
					const conTareaRevisada = new Set(cals.filter((c) => c.estado_entrega)
						.map((c) => c.alumno_id + "|" + c.producto_sesion_id));
					const alumnosDe = (p) => {
						const grados = (p.grados || []).map(Number);
						return alumnos.filter((a) => grados.indexOf(Number(a.grado)) !== -1);
					};
					trabajos.forEach((p) => {
						alumnosDe(p).forEach((a) => { if (!hechas.has(a.id + "|" + p.id)) sinCalificar++; });
					});
					tareasPorRevisar = tareas.filter((p) => alumnosDe(p).some((a) => !conTareaRevisada.has(a.id + "|" + p.id))).length;
				}
			}
		}
	} catch (e) {
		console.error("inicio: conteos de Tu día", e);
		sinLeer = true;
	}

	const fila = (etiqueta, valor, listo) =>
		"<div class='flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0'>" +
		"<span class='text-sm text-gray-700'>" + etiqueta + "</span>" +
		"<span class='text-sm font-semibold " + (listo ? "text-emerald-600" : "text-amber-600") + "'>" + valor + "</span></div>";

	card.innerHTML =
		"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3'>" +
		"<div><h2 class='text-lg font-bold text-gray-800'>Tu día</h2>" +
		"<p class='text-sm text-gray-500'>La captura se hace en Hoy: asistencia, tareas, productos y cierre.</p></div>" +
		"<a href='hoy.html' class='inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700'>Abrir Hoy</a>" +
		"</div>" +
		fila("Asistencia", conAsistencia + " de " + alumnos.length, alumnos.length > 0 && conAsistencia >= alumnos.length) +
		(sinLeer
			? fila("Tareas y productos", "no se pudieron leer; ábrelos en Hoy", false)
			: fila("Tareas por revisar", String(tareasPorRevisar), tareasPorRevisar === 0) +
			fila("Sesiones de hoy", sesionesHoy ? String(sesionesHoy) : "ninguna todavía", sesionesHoy > 0) +
			fila("Productos por calificar", sesionesHoy ? String(sinCalificar) : "—", sesionesHoy > 0 && sinCalificar === 0)) +
		fila("Cierre del día", cierre.nadieAsistio ? "nadie asistió hoy" : cierre.conteo + cierre.sinContar, cierre.completo);
	return card;
}

function crearCardSinProyecto() {
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-8 text-center";
	card.innerHTML =
		"<p class='text-gray-500 text-lg mb-2'>No tienes ningún proyecto activo en este grupo</p>" +
		"<p class='text-gray-400 text-sm mb-6'>Ve a Proyectos, elige uno y presiona \"Iniciar proyecto\".</p>" +
		"<a href='planeacion.html' class='inline-flex min-h-[44px] items-center bg-blue-600 text-white font-bold px-6 rounded-xl hover:bg-blue-700 transition'>Ir a Proyectos</a>";
	return card;
}

// ── 2. Sesión de hoy (o la siguiente pendiente) ─────────────────────────────
async function renderSesiones(container) {
	const hoy = getLocalDateISO();
	const { data: sesiones, error } = await window.sb
		.from("sesiones")
		.select("*")
		.eq("proyecto_id", proyectoActivo.id)
		.order("numero_sesion");
	if (error) {
		showError("No se pudieron cargar las sesiones: " + error.message);
		return;
	}
	const deHoy = (sesiones || []).filter((s) => s.fecha === hoy);
	if (deHoy.length) {
		deHoy.forEach((s) => container.appendChild(crearCardSesion(s, true)));
		return;
	}
	const siguiente = (sesiones || []).find((s) => !s.fecha && s.estado_sesion !== "completada");
	if (siguiente) {
		container.appendChild(crearCardSesion(siguiente, false));
		return;
	}
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-6";
	card.innerHTML = "<p class='text-gray-600'>Todas las sesiones de <span class='font-semibold'>" +
		escapeHtml(proyectoActivo.titulo || "este proyecto") + "</span> ya se trabajaron.</p>";
	container.appendChild(card);
}

function crearCardSesion(sesion, esDeHoy) {
	sesionActiva = sesion; // los ayudantes de render leen esta variable
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6 border-l-4 " + (esDeHoy ? "border-l-violet-500" : "border-l-gray-300");

	const titulo = "Sesión " + (sesion.numero_sesion || "-") + (sesion.campo_formativo ? " · " + sesion.campo_formativo : "");
	const cabecera = document.createElement("div");
	cabecera.className = "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4";
	cabecera.innerHTML =
		"<div><p class='text-xs font-semibold uppercase tracking-wide " + (esDeHoy ? "text-violet-600" : "text-gray-400") + "'>" +
		(esDeHoy ? (sesion.estado_sesion === "completada" ? "Hoy · terminada" : "Hoy") : "Siguiente sesión") + "</p>" +
		"<h2 class='text-lg font-bold text-gray-800'>" + escapeHtml(titulo) + "</h2>" +
		"<p class='text-sm text-gray-500'>" + escapeHtml(proyectoActivo.titulo || "") + (sesion.momento ? " · " + escapeHtml(sesion.momento) : "") + "</p></div>";
	card.appendChild(cabecera);

	card.appendChild(renderBloqueSesion("Inicio", "border-l-blue-500", getTextoFase("inicio"), getActividadesFase("inicio")));
	card.appendChild(renderBloqueSesion("Desarrollo", "border-l-violet-500", getTextoFase("desarrollo"), getActividadesFase("desarrollo")));
	card.appendChild(renderBloqueSesion("Cierre", "border-l-emerald-500", getTextoFase("cierre"), getActividadesFase("cierre"), getTareasCierreTexto()));

	const recursos = normalizarRecursos(sesion.recursos);
	if (recursos.length) {
		const bloque = document.createElement("section");
		bloque.className = "border-l-4 border-l-amber-500 pl-4 py-2 mb-3";
		bloque.innerHTML = "<h4 class='font-semibold text-gray-800 mb-2'>Recursos</h4>";
		const wrap = document.createElement("div");
		wrap.className = "flex flex-wrap gap-2";
		recursos.forEach((r) => {
			if (!/^https?:\/\//i.test(String(r.url || ""))) return; // solo http(s)
			const a = document.createElement("a");
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			a.href = r.url;
			a.className = "text-sm border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50";
			a.textContent = r.titulo;
			wrap.appendChild(a);
		});
		bloque.appendChild(wrap);
		card.appendChild(bloque);
	}

	const pdaHtml = renderPdaSesion(sesion.pda_sesion);
	if (pdaHtml) {
		const bloque = document.createElement("section");
		bloque.className = "border-l-4 border-l-rose-500 pl-4 py-2 mb-3";
		bloque.innerHTML = "<h4 class='font-semibold text-gray-800 mb-2'>PDA por grado</h4>" + pdaHtml;
		card.appendChild(bloque);
	}

	const acciones = document.createElement("div");
	acciones.className = "mt-4 flex flex-wrap gap-2";
	const idSesion = sesion.id;

	if (!esDeHoy) {
		const btnHoy = document.createElement("button");
		btnHoy.type = "button";
		btnHoy.className = "min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700";
		btnHoy.textContent = "Trabajar hoy";
		btnHoy.addEventListener("click", async function () {
			btnHoy.disabled = true;
			btnHoy.textContent = "Agregando...";
			const { error } = await window.sb.from("sesiones")
				.update({ fecha: getLocalDateISO(), estado_sesion: "activa" })
				.eq("id", idSesion).eq("maestro_id", user.id);
			if (error) {
				btnHoy.disabled = false;
				btnHoy.textContent = "Trabajar hoy";
				showError("No se pudo agregar la sesión a hoy: " + error.message);
				return;
			}
			window.location.reload();
		});
		acciones.appendChild(btnHoy);
	} else {
		const aHoy = document.createElement("a");
		aHoy.href = "hoy.html";
		aHoy.className = "inline-flex items-center min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700";
		aHoy.textContent = "Capturar en Hoy";
		acciones.appendChild(aHoy);

		const aPda = document.createElement("a");
		aPda.href = "evaluacion_formativa.html?sesion_id=" + encodeURIComponent(idSesion);
		aPda.className = "inline-flex items-center min-h-[44px] px-4 rounded-xl border border-emerald-300 text-emerald-700 font-medium hover:bg-emerald-50";
		aPda.textContent = "Afinar evaluación por PDA";
		acciones.appendChild(aPda);

		if (sesion.estado_sesion !== "completada") {
			const btnTerminar = document.createElement("button");
			btnTerminar.type = "button";
			btnTerminar.className = "min-h-[44px] px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50";
			btnTerminar.textContent = "Marcar sesión como terminada";
			btnTerminar.addEventListener("click", function () {
				abrirModalCierre(async function (notas) {
					await terminarSesion(idSesion, notas);
				});
			});
			acciones.appendChild(btnTerminar);
		}
	}
	card.appendChild(acciones);
	return card;
}

// ── 3. Terminar la sesión ───────────────────────────────────────────────────
async function terminarSesion(sesionId, notasCierre) {
	clearError();
	try {
		const { error: updateError } = await window.sb
			.from("sesiones")
			.update({ estado_sesion: "completada", notas_cierre: notasCierre || null })
			.eq("id", sesionId)
			.eq("maestro_id", user.id);
		if (updateError) throw updateError;

		// Si ya no queda ninguna por trabajar, el proyecto se da por completado
		const { count, error: countError } = await window.sb
			.from("sesiones")
			.select("id", { count: "exact", head: true })
			.eq("proyecto_id", proyectoActivo.id)
			.neq("estado_sesion", "completada");
		if (countError) throw countError;
		if (!count) {
			const { error: proyectoError } = await window.sb
				.from("proyectos")
				.update({ estado: "completado", fecha_final: getLocalDateISO() })
				.eq("id", proyectoActivo.id);
			if (proyectoError) throw proyectoError;
		}
		cerrarModalCierre();
		window.location.reload();
	} catch (error) {
		showError("No se pudo terminar la sesión: " + error.message);
	}
}

// ── Ayudantes de render del plan de la sesión ───────────────────────────────
function getTextoFase(fase) {
	const todos = sesionActiva && sesionActiva[fase + "_todos"] ? sesionActiva[fase + "_todos"] : "";
	const diferenciado = sesionActiva && sesionActiva[fase + "_diferenciado"] ? sesionActiva[fase + "_diferenciado"] : "";
	if (typeof todos === "string" && todos.trim()) return todos;
	if (typeof diferenciado === "string" && diferenciado.trim()) return diferenciado;
	if (typeof diferenciado === "object" && diferenciado !== null) {
		const lineas = Object.keys(diferenciado)
			.map((g) => ({ g: g, t: textoActividad(diferenciado[g]) }))
			.filter((x) => x.t)
			.map((x) => "Grado " + x.g + ": " + x.t);
		if (lineas.length) return lineas.join("\n");
	}
	return "Sin información registrada.";
}

// Texto legible de una actividad guardada como texto, objeto o lista; nunca JSON crudo
function textoActividad(x) {
	if (x === null || x === undefined) return "";
	if (typeof x === "string") return x.trim();
	if (Array.isArray(x)) return x.map(textoActividad).filter(Boolean).join("; ");
	if (typeof x === "object") return textoActividad(x.descripcion || x.texto || x.actividad || x.nombre || "");
	return String(x);
}

/*
	Las actividades llegan en varias formas: lista, texto, o el objeto de "Crear
	proyecto" { mode, todos: [...], diferenciado: { "1": [...] } }. Antes ese objeto se
	pintaba tal cual y salía "• todos • null".
*/
function getActividadesFase(fase) {
	const raw = sesionActiva ? sesionActiva[fase + "_actividades"] : null;
	if (!raw) return [];
	if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
	if (Array.isArray(raw)) return raw.map(textoActividad).filter(Boolean);
	if (typeof raw === "object") {
		if ("mode" in raw || "todos" in raw || "diferenciado" in raw || "por_grado" in raw) {
			const out = (Array.isArray(raw.todos) ? raw.todos : raw.todos ? [raw.todos] : []).map(textoActividad).filter(Boolean);
			const porGrado = raw.diferenciado || raw.por_grado;
			if (porGrado && typeof porGrado === "object") {
				Object.keys(porGrado).forEach((g) => {
					(Array.isArray(porGrado[g]) ? porGrado[g] : [porGrado[g]]).map(textoActividad).filter(Boolean)
						.forEach((t) => out.push(g + "°: " + t));
				});
			}
			return out;
		}
		return Object.values(raw).map(textoActividad).filter(Boolean);
	}
	return [];
}

function getTareasCierreTexto() {
	return extraerTareasCierre().map((t) => (t.grado != null ? t.grado + "°: " + t.descripcion : t.descripcion));
}

function extraerTareasCierre() {
	const raw = sesionActiva ? sesionActiva.cierre_tareas : null;
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.map((x) => ({ descripcion: typeof x === "string" ? x : x.descripcion || "Tarea", grado: x.grado ?? null }));
	}
	if (typeof raw === "object") {
		const mode = raw.mode || "todos";
		// Modo diferenciado: { diferenciado: { "4": [...] } }; "por_grado" es alias antiguo
		const porGrado = raw.diferenciado || raw.por_grado;
		if (mode === "diferenciado" && porGrado && typeof porGrado === "object") {
			const out = [];
			Object.keys(porGrado).forEach((grado) => {
				(porGrado[grado] || []).forEach((t) => {
					out.push({ descripcion: typeof t === "string" ? t : t.descripcion || "Tarea", grado: Number(grado) });
				});
			});
			return out;
		}
		const lista = raw.todos || raw.items || raw.tareas || [];
		return (Array.isArray(lista) ? lista : [lista]).map((t) => ({ descripcion: typeof t === "string" ? t : t.descripcion || "Tarea", grado: null }));
	}
	return [];
}

function renderBloqueSesion(titulo, borde, texto, actividades, tareas) {
	const box = document.createElement("section");
	box.className = "border-l-4 " + borde + " pl-4 py-2 mb-3";
	let html =
		"<h4 class='font-semibold text-gray-800 mb-1'>" + titulo + "</h4>" +
		"<p class='text-sm text-gray-600 whitespace-pre-line mb-2'>" + escapeHtml(texto || "") + "</p>";
	if (actividades && actividades.length) {
		html += "<ul class='list-disc pl-5 text-sm text-gray-600 mb-2'>" +
			actividades.map((a) => "<li>" + escapeHtml(a) + "</li>").join("") + "</ul>";
	}
	if (tareas && tareas.length) {
		html += "<p class='text-sm font-medium text-gray-700'>Tareas del cierre:</p>" +
			"<ul class='list-disc pl-5 text-sm text-gray-600'>" +
			tareas.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") + "</ul>";
	}
	box.innerHTML = html;
	return box;
}

function renderPdaSesion(rawPda) {
	if (!rawPda) return "";
	let pda = rawPda;
	if (typeof pda === "string") {
		try { pda = JSON.parse(pda); } catch (_) { return "<p class='text-sm text-gray-600'>" + escapeHtml(rawPda) + "</p>"; }
	}
	if (!pda || typeof pda !== "object") return "";
	// Acepta tanto un arreglo [{grado, pda_texto, criterio_aplicado}] como un objeto por grado
	const items = Array.isArray(pda)
		? pda.map((p) => ({ grado: p.grado, texto: p.pda_texto || p.pda || p.texto || "", criterio: p.criterio_aplicado || "" }))
		: Object.keys(pda).map((g) => {
			const item = pda[g] || {};
			return {
				grado: g,
				texto: typeof item === "string" ? item : item.pda || item.pda_texto || item.texto || "",
				criterio: typeof item === "object" ? item.criterio_aplicado || "" : "",
			};
		});
	return items.map((it) =>
		"<div class='mb-2 text-sm text-gray-700'>" +
		"<p><span class='font-semibold'>" + escapeHtml(it.grado) + "°:</span> " + escapeHtml(it.texto) + "</p>" +
		(it.criterio ? "<p class='text-gray-500'>Criterio: " + escapeHtml(it.criterio) + "</p>" : "") +
		"</div>").join("");
}

function normalizarRecursos(raw) {
	if (!raw) return [];
	let recursos = raw;
	if (typeof recursos === "string") {
		try { recursos = JSON.parse(recursos); } catch (_) { return []; }
	}
	// El jsonb puede venir como {links: [...], archivos: [...]} o como arreglo
	if (!Array.isArray(recursos)) {
		recursos = [].concat(recursos.links || [], recursos.archivos || [], (recursos.url || recursos.link) ? [recursos] : []);
	}
	return recursos
		.map((r) => {
			const url = r && (r.url || r.link || r.href) || null;
			if (!url) return null;
			// SEGURIDAD: solo http(s). Un esquema como javascript: en un <a href> ejecutaría código.
			if (!/^https?:\/\//i.test(String(url))) return null;
			return { titulo: r.nombre || r.titulo || "Abrir recurso", url: url };
		})
		.filter(Boolean);
}

function abrirModalCierre(onConfirm) {
	let modal = document.getElementById("modal-cierre-sesion");
	if (modal) modal.remove();
	modal = document.createElement("div");
	modal.id = "modal-cierre-sesion";
	modal.className = "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4";
	modal.innerHTML =
		"<div class='bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]'>" +
		"<div class='p-5 border-b'><h3 class='text-lg font-bold text-gray-800'>Terminar la sesión</h3>" +
		"<p class='text-sm text-gray-500 mt-1'>Las calificaciones y el cierre del día se capturan en Hoy; aquí solo se marca la sesión como trabajada.</p></div>" +
		"<div class='p-5'><label for='notasCierreInput' class='block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2'>Notas (opcional)</label>" +
		"<textarea id='notasCierreInput' class='w-full border border-gray-300 rounded-xl p-3 text-sm min-h-[72px] resize-none' placeholder='¿Algo diferente a lo planeado?'></textarea></div>" +
		"<div class='p-5 border-t flex justify-end gap-2'>" +
		"<button type='button' id='cancelarCierreBtn' class='min-h-[44px] border border-gray-300 text-gray-600 px-4 rounded-xl'>Cancelar</button>" +
		"<button type='button' id='confirmarCierreBtn' class='min-h-[44px] bg-green-600 text-white px-5 rounded-xl font-semibold'>Marcar como terminada</button>" +
		"</div></div>";
	document.body.appendChild(modal);
	document.getElementById("cancelarCierreBtn").addEventListener("click", cerrarModalCierre);
	document.getElementById("confirmarCierreBtn").addEventListener("click", async function () {
		const notas = document.getElementById("notasCierreInput").value.trim();
		await onConfirm(notas);
	});
}

function cerrarModalCierre() {
	const modal = document.getElementById("modal-cierre-sesion");
	if (modal) modal.remove();
}

function showError(msg) {
	const container = document.getElementById("flowContainer");
	if (!container) return;
	let alerta = document.getElementById("flowError");
	if (!alerta) {
		alerta = document.createElement("div");
		alerta.id = "flowError";
		alerta.className = "bg-red-100 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm";
		container.prepend(alerta);
	}
	alerta.textContent = msg;
}

function clearError() {
	const alerta = document.getElementById("flowError");
	if (alerta) alerta.remove();
}

function getLocalDateISO() {
	const now = new Date();
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
	return local.toISOString().slice(0, 10);
}

function escapeHtml(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
