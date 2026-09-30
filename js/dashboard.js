/*
	dashboard.js — Inicio del maestro.

	La captura del día (asistencia, tareas, productos, cierre) vive en "Hoy" (hoy.html).
	Inicio NO la duplica: resume lo que falta de hoy y muestra el plan de la sesión que
	toca, con lo necesario para trabajarla y terminarla.

	  1. Tu día: lo pendiente de hoy, con el botón a "Hoy".
	  2. Proyectos activos (puede haber varios: 2026-09-26), una tarjeta compacta por cada
	     uno con su sesión de hoy o, si ninguna tiene fecha de hoy, su siguiente pendiente con
	     "Trabajar hoy" (le pone la fecha de hoy, igual que en "Hoy"). El plan (inicio,
	     desarrollo, cierre, recursos, PDA por grado) se abre con "Ver el plan".
	  3. Terminar sesión: la marca como completada con notas opcionales; si a SU proyecto ya
	     no le quedan sesiones, ese proyecto pasa a completado. Ya no escribe la tabla vieja
	     `tareas`: las tareas son productos de la sesión y se revisan en "Hoy".

	Próximos cumpleaños (decisión de Jorge, 2026-09-26): una línea discreta en el encabezado,
	el mismo día y hasta 7 días antes (Cumpleanos.DIAS_AVISO_INICIO), con enlace a Calendario →
	Cumpleaños. Solo alumnos activos del grupo activo; usa la lectura de alumnos que Inicio ya
	hace (con la fecha de nacimiento). Si nadie cumple en esos días, no se muestra nada.
*/

let user = null;
let grupo = null;
let grupoId = null;
let alumnos = [];
let proyectosActivos = []; // puede haber varios a la vez (uno por campo formativo, por ejemplo)

// Arranque común (js/lectura.js): si la lista de alumnos o los proyectos activos no se
// pudieron leer, la página se detiene con el aviso "No se pudo cargar". Antes, con el
// proyecto en error, Inicio decía "No tienes ningún proyecto activo".
document.addEventListener("DOMContentLoaded", function () {
	window.Lectura.arrancar(async function () {
		const { data: { user: u }, error: userError } = await window.sb.auth.getUser();
		if (userError || !u) {
			window.location.href = "index.html";
			return;
		}
		user = u;
		await inicializarEncabezado();
		await cargarGrupoYAlumnos();
		if (!grupoId) return;

		// TODOS los proyectos activos del grupo (antes solo el más reciente: con un proyecto
		// por campo formativo, los demás no se veían en Inicio)
		proyectosActivos = (await window.Lectura.uno(window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado")
			.eq("maestro_id", user.id)
			.eq("grupo_id", grupoId)
			.eq("estado", "activo")
			.order("created_at", { ascending: true }))) || [];

		// Las sesiones se leen ANTES de dibujar: si fallan, no queda media pantalla
		const sesiones = proyectosActivos.length ? await leerSesiones() : [];

		const container = document.getElementById("flowContainer");
		container.innerHTML = "";
		const altaPendiente = crearCardAltaPendiente();
		if (altaPendiente) container.appendChild(altaPendiente);
		const ponte = await crearCardPonteAlDia();
		if (ponte) container.appendChild(ponte);
		container.appendChild(await crearCardHoy());
		if (!proyectosActivos.length) {
			container.appendChild(crearCardSinProyecto());
			return;
		}
		renderProyectos(container, sesiones);
	});
});

/*
	Alta sin terminar: el onboarding guarda en este aparato la lista de alumnos que se va
	capturando (js/alta-borrador.js). Si la maestra cerró la pestaña después de crear el grupo,
	al volver entra aquí (ya tiene grupo): se le ofrece continuar. Sin alumnos y sin borrador,
	se le lleva a Mi grupo.
*/
function crearCardAltaPendiente() {
	if (alumnos.length) return null;
	const borrador = window.AltaBorrador ? window.AltaBorrador.leer(user.id) : null;
	const n = borrador && borrador.grupoId === grupoId ? (borrador.alumnos || []).length : 0;
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6 border-l-4 border-l-amber-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3";
	card.innerHTML = n
		? "<div><h2 class='text-lg font-bold text-gray-800'>Tu lista de alumnos quedó a medias</h2>" +
			"<p class='text-sm text-gray-600'>En este aparato quedó la lista que estabas capturando (" + n + (n === 1 ? " alumno" : " alumnos") + "). Continúa para guardarla.</p></div>" +
			"<a href='onboarding.html' class='inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 shrink-0'>Continuar la lista</a>"
		: "<div><h2 class='text-lg font-bold text-gray-800'>Tu grupo aún no tiene alumnos</h2>" +
			"<p class='text-sm text-gray-600'>Agrégalos para pasar lista y calificar.</p></div>" +
			"<a href='mi-grupo.html' class='inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 shrink-0'>Agregar alumnos</a>";
	return card;
}

/*
	"Ponte al día" (registro histórico, spec de Jorge del 2026-09-26, §4.1): el asistente se puede
	saltar y retomar desde aquí. Se ofrece al crear el grupo (el alta deja su avance en
	ponte_al_dia, mi_salon_b20, si el trimestre ya había empezado); la tarjeta sale mientras ese
	avance esté "en curso". A los grupos de antes (sin avance) no se les ofrece: ya capturan en
	Hoy. "Ya no mostrar" lo marca como saltado.
*/
async function crearCardPonteAlDia() {
	if (!alumnos.length) return null;
	// lectura-opcional: solo decide si se muestra la tarjeta; si falla no se muestra y no se guarda nada
	const { data: fila, error } = await window.sb.from("ponte_al_dia").select("estado, paso, pasos_hechos")
		.eq("maestro_id", user.id).eq("grupo_id", grupoId).maybeSingle();
	if (error) { console.error("inicio: ponte al día", error); return null; }
	if (!fila || fila.estado !== "en_curso") return null;
	const enCurso = true;
	const hechos = Array.isArray(fila.pasos_hechos) ? fila.pasos_hechos.length : 0;
	const card = document.createElement("section");
	card.id = "cardPonteAlDia";
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6 border-l-4 border-l-emerald-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3";
	card.innerHTML =
		"<div><h2 class='text-lg font-bold text-gray-800'>" + (enCurso ? "Sigue con Ponte al día" : "Ponte al día") + "</h2>" +
		"<p class='text-sm text-gray-600'>" + (enCurso
			? "Llevas " + hechos + " de 4 pasos. Captura lo que ya llevas del trimestre: asistencia, trabajos, exámenes y calificaciones."
			: "El trimestre ya empezó: captura en una tarde lo que ya llevas (asistencia, trabajos, exámenes y calificaciones) para que tu boleta salga completa.") + "</p></div>" +
		"<div class='flex flex-col sm:flex-row gap-2 shrink-0'>" +
		"<a href='ponte-al-dia.html' class='inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700'>" + (enCurso ? "Continuar" : "Empezar") + "</a>" +
		"<button type='button' data-ponte-ocultar class='inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50'>Ya no mostrar</button></div>";
	card.querySelector("[data-ponte-ocultar]").addEventListener("click", async function () {
		this.disabled = true;
		const { error: e } = await window.sb.from("ponte_al_dia").upsert({ maestro_id: user.id, grupo_id: grupoId, estado: "saltado" }, { onConflict: "grupo_id" });
		if (e) {
			this.disabled = false;
			window.alert("No se pudo guardar: " + (e.message || "error desconocido") + ". Revisa tu conexión e inténtalo de nuevo.");
			return;
		}
		card.remove();
	});
	return card;
}

async function inicializarEncabezado() {
	// lectura-opcional: solo el nombre del saludo y el aviso de la entidad; si falla, saluda sin nombre, no muestra el aviso y no se guarda nada
	const { data: perfil, error: errorPerfil } = await window.sb
		.from("perfiles")
		.select("nombre_completo, estado")
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

	// Entidad (decisión 21): si la cuenta es de antes y no la eligió, un aviso discreto que
	// invita a elegirla en Mi cuenta. No bloquea nada. Solo si la lectura sí respondió.
	const aviso = document.getElementById("avisoEntidad");
	if (aviso && !errorPerfil && perfil && !String(perfil.estado || "").trim()) aviso.classList.remove("hidden");
}

async function cargarGrupoYAlumnos() {
	// Grupo activo: único lugar que lo decide (valida que el guardado sea de este maestro).
	// Si su lectura falla, GrupoActivo.cargar detiene la página él mismo.
	const activo = await window.GrupoActivo.cargar(window.sb, user.id);
	grupo = activo.grupo;
	grupoId = grupo ? grupo.id : null;
	if (!grupoId) {
		window.location.href = "onboarding.html";
		return;
	}
	// Sin la lista no se sigue (lanza): "0 alumnos" y todo en verde contradiría a "Hoy"
	alumnos = (await window.Lectura.uno(window.sb
		.from("alumnos")
		.select("id, nombre_completo, grado, num_lista, created_at, estatus, fecha_nacimiento")
		.eq("grupo_id", grupoId)
		.eq("estatus", "activo")
		.order("grado")
		.order("num_lista"))) || [];
	// Alta tarde: misma regla que "Hoy" (js/alcance-hoy.js)
	alumnos.forEach((a) => { a.alta = window.AlcanceHoy.fechaAlta(a.created_at, grupo.created_at); });
	document.getElementById("welcomeSub").textContent = (grupo.nombre || "Grupo") + " · " + alumnos.length + " alumnos";
	pintarAvisoCumples();
}

// ── Próximos cumpleaños (una línea en el encabezado) ────────────────────────
// Pastel de Lucide ("cake"), en línea como en Calendario
const ICONO_PASTEL = "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" +
	"<path d='M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8'/><path d='M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1'/><path d='M2 21h20'/><path d='M7 8v3'/><path d='M12 8v3'/><path d='M17 8v3'/><path d='M7 4h.01'/><path d='M12 4h.01'/><path d='M17 4h.01'/></svg>";
function pintarAvisoCumples() {
	const aviso = document.getElementById("avisoCumples");
	const K = window.Cumpleanos;
	if (!aviso || !K) return;
	const lista = K.paraInicio(alumnos, getLocalDateISO());
	if (!lista.length) { aviso.classList.add("hidden"); aviso.innerHTML = ""; return; }
	// Toda la línea es el enlace a Calendario → Cumpleaños: en el celular no agrega otro renglón
	aviso.innerHTML =
		"<a href='calendario.html#cumpleanos' class='group flex items-center gap-2 min-h-[44px] -my-1.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-white'>" +
		"<span class='self-start mt-3 text-pink-200'>" + ICONO_PASTEL + "</span>" +
		"<span class='min-w-0 flex-1 break-words py-1.5'><span class='font-semibold text-white'>Próximos cumpleaños:</span> " + escapeHtml(K.textoInicio(lista)) + "</span>" +
		"<span class='shrink-0 font-semibold text-white underline underline-offset-2 group-hover:text-blue-100'>Ver<span class='hidden sm:inline'> cumpleaños</span></span></a>";
	aviso.classList.remove("hidden");
}

// ── 1. Tu día: lo que falta de hoy ──────────────────────────────────────────
async function crearCardHoy() {
	const hoy = getLocalDateISO();
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6";

	// Asistencia y cierre del día de hoy. Si no se pudieron leer, no se inventa "0 de 8":
	// esa fila dice que no se pudo leer (el resto de Inicio sigue en pie)
	let asistenciasHoy = [], registrosHoy = [], sinLeerDia = false;
	try {
		[asistenciasHoy, registrosHoy] = await Promise.all([
			window.Lectura.uno(window.sb.from("asistencias").select("alumno_id, asistencia_estado").eq("grupo_id", grupoId).eq("fecha", hoy)),
			alumnos.length
				? window.Lectura.uno(window.sb.from("registro_diario").select("alumno_id").eq("maestro_id", user.id).eq("fecha", hoy)
					.in("alumno_id", alumnos.map((a) => a.id)))
				: Promise.resolve([]),
		]);
	} catch (e) {
		console.error("inicio: asistencia/cierre de hoy", e);
		sinLeerDia = true;
	}
	// Solo alumnos activos: uno dado de baja con asistencia de hoy no debe dar "9 de 8"
	const activos = new Set(alumnos.map((a) => a.id));
	const conAsistencia = new Set((asistenciasHoy || []).map((r) => r.alumno_id).filter((id) => activos.has(id))).size;
	// Cierre del día con la misma regla que "Hoy": no se espera de quien faltó
	const faltaron = new Set((asistenciasHoy || [])
		.filter((r) => r.asistencia_estado === "ausente" || r.asistencia_estado === "justificada")
		.map((r) => r.alumno_id));
	const esperadosCierre = alumnos.filter((a) => !faltaron.has(a.id));
	const conRegistro = new Set((registrosHoy || []).map((r) => r.alumno_id));
	const conCierre = esperadosCierre.filter((a) => conRegistro.has(a.id)).length;
	const cierre = window.AlcanceHoy.resumenCierre(alumnos.length, esperadosCierre.length, conCierre);

	// Lo mismo que muestra "Hoy", con el mismo alcance de proyectos (js/alcance-hoy.js):
	// productos de las sesiones de hoy sin calificar y tareas vencidas con alumnos sin revisar
	let sinCalificar = 0;
	let sesionesHoy = 0;
	let tareasPorRevisar = 0;
	// Actividades en clase que quedaron incompletas y hoy (o antes) toca revisar (una por alumno)
	let porCompletar = 0;
	// Lo de una falta justificada que aún no se califica, y cuántos ya pasaron su plazo
	let porFalta = 0, porFaltaVencidas = 0;
	// Si una lectura falla, Inicio sigue en pie: esos conteos dicen que no se pudieron leer
	let sinLeer = false;
	try {
		// Días sin clase del grupo: las tareas vencen el siguiente día de clase (como en "Hoy")
		const ajustes = await window.AlcanceHoy.leerAjustesCalendario(window.sb, user.id, grupoId);
		const proys = await window.Lectura.uno(window.sb.from("proyectos").select("id")
			.eq("maestro_id", user.id).eq("grupo_id", grupoId).or(window.AlcanceHoy.filtro(grupo, hoy)));
		const proyIds = (proys || []).map((p) => p.id);
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
					.select("id, tipo, grados, sesion_id, fecha_entrega, created_at, es_historico").in("sesion_id", lote).eq("activo", true).order("id"));
				const trabajos = prods.filter((p) => p.tipo !== "tarea" && idsHoy.indexOf(p.sesion_id) !== -1);
				// Las tareas del registro histórico no se piden (misma regla que "Hoy": AlcanceHoy.tareaPorRevisar)
				const tareas = prods.filter((p) => {
					const vence = p.tipo === "tarea" ? window.AlcanceHoy.venceTarea(p.fecha_entrega, fechaSesion[p.sesion_id], ajustes) : null;
					return window.AlcanceHoy.tareaPorRevisar(p, vence, hoy, fechaSesion[p.sesion_id]);
				});
				const revisar = trabajos.concat(tareas);
				// Lo incompleta en clase que ya toca revisar (Pendientes de la clase anterior de "Hoy"),
				// de los mismos productos que mira Hoy, de alumnos activos
				const activosIds = new Set(alumnos.map((a) => a.id));
				const incompletas = await leer(prods.map((p) => p.id), (lote) => window.sb.from("calificaciones")
					.select("alumno_id, producto_sesion_id, revisar_en")
					.eq("maestro_id", user.id).eq("estado_en_clase", "incompleta").in("producto_sesion_id", lote).order("id"));
				porCompletar = incompletas.filter((c) => activosIds.has(c.alumno_id) &&
					window.AlcanceHoy.tocaRevisar(Object.assign({ estado_en_clase: "incompleta" }, c), hoy)).length;
				/*
					Por falta justificada (AlcanceHoy.pendientesPorFalta: lo mismo que muestra "Hoy" y "Qué le
					falta"): lo de los días que faltaron con justificante y aún no se califica. Solo se leen
					las calificaciones y las asignaciones de los productos que tocan a esas faltas.
				*/
				const A = window.AlcanceHoy;
				const fechasTrab = ses.map((s) => s.fecha).filter(Boolean).sort();
				if (fechasTrab.length) {
					const asisIdx = A.indiceAsistencias(await A.leerAsistencias(window.sb, user.id, grupoId, fechasTrab[0]));
					const conJust = alumnos.filter((a) => asisIdx[a.id] &&
						Object.keys(asisIdx[a.id]).some((f) => A.estadoAsistencia(asisIdx[a.id], f) === "justificada"));
					if (conJust.length) {
						const candidatos = prods.filter((p) => conJust.some((a) => {
							const e = A.estadoPorAsistencia(p, fechaSesion[p.sesion_id], asisIdx[a.id], ajustes);
							return e && e.estado === "justificada";
						}));
						if (candidatos.length) {
							const idsC = candidatos.map((p) => p.id);
							const asigF = A.indiceAsignaciones(await leer(idsC, (lote) => window.sb
								.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo")
								.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id")));
							const calsF = await leer(idsC, (lote) => window.sb.from("calificaciones")
								.select("alumno_id, producto_sesion_id, nivel, estado_entrega, puntaje, fecha")
								.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id"));
							const mapaF = {};
							calsF.forEach((c) => { mapaF[c.alumno_id + "|" + c.producto_sesion_id] = c; });
							const pend = A.pendientesPorFalta({
								alumnos: conJust, productos: candidatos, fechaSesion: fechaSesion, calificaciones: mapaF,
								asignaciones: asigF, asistencias: asisIdx, ajustes: ajustes,
							});
							porFalta = pend.length;
							porFaltaVencidas = pend.filter((x) => x.vence && x.vence < hoy).length;
						}
					}
				}
				if (revisar.length) {
					// Para quién es cada producto además de sus grados (regla única: js/alcance-hoy.js)
					const asignaciones = window.AlcanceHoy.indiceAsignaciones(await leer(revisar.map((p) => p.id), (lote) => window.sb
						.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo")
						.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id")));
					const cals = await leer(revisar.map((p) => p.id), (lote) => window.sb.from("calificaciones")
						.select("alumno_id, producto_sesion_id, nivel, estado_entrega, puntaje, fecha")
						.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id"));
					// Calificado = semáforo, estado de entrega o puntaje (misma regla que "Hoy")
					const hechas = new Set(cals.filter((c) => c.nivel || c.estado_entrega || (c.puntaje !== null && c.puntaje !== undefined))
						.map((c) => c.alumno_id + "|" + c.producto_sesion_id));
					const conTareaRevisada = new Set(cals.filter((c) => c.estado_entrega)
						.map((c) => c.alumno_id + "|" + c.producto_sesion_id));
					const calPorClave = new Map(cals.map((c) => [c.alumno_id + "|" + c.producto_sesion_id, c]));
					// A un alumno dado de alta tarde no se le cuenta lo anterior a su alta (misma regla que "Hoy")
					// y a quien se excluyó; sí a los incluidos (REGLA ÚNICA: AlcanceHoy.recibeProducto)
					const alumnosDe = (p) => alumnos.filter((a) =>
						window.AlcanceHoy.recibeProducto(a, p, asignaciones, fechaSesion[p.sesion_id], calPorClave.get(a.id + "|" + p.id)));
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

	// lectura-opcional: solo la fila "Jornada" de Tu día; nada se guarda con ella y, si no se puede leer (o la tabla de b25 aún no existe), la fila no se muestra
	let jornada; // undefined: no se pudo leer; null: sin finalizar; { cerrada_en, actualizada_en }: finalizada
	try {
		const jRes = await window.sb.from("jornadas").select("cerrada_en, actualizada_en")
			.eq("maestro_id", user.id).eq("grupo_id", grupoId).eq("fecha", hoy).maybeSingle();
		if (!jRes.error) jornada = jRes.data || null;
	} catch (_) { /* sin la jornada, Inicio sigue igual */ }
	const horaJornada = jornada ? new Date(jornada.cerrada_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

	const fila = (etiqueta, valor, listo) =>
		"<div class='flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0'>" +
		"<span class='text-sm text-gray-700'>" + etiqueta + "</span>" +
		"<span class='text-sm font-semibold " + (listo ? "text-emerald-600" : "text-amber-600") + "'>" + valor + "</span></div>";

	card.innerHTML =
		"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3'>" +
		"<div><h2 class='text-lg font-bold text-gray-800'>Tu día</h2>" +
		"<p class='text-sm text-gray-500'>La captura se hace en Hoy: asistencia, tareas, productos y cierre.</p></div>" +
		"<span class='flex flex-wrap gap-2'>" +
		// Guiar sin obligar: una actividad o tarea suelta, sin proyecto (se abre en Hoy)
		"<a href='hoy.html?nueva=suelta' class='inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl border border-violet-300 text-violet-700 font-semibold hover:bg-violet-50'>Actividad suelta</a>" +
		"<a href='hoy.html' class='inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700'>Abrir Hoy</a>" +
		"</span></div>" +
		(sinLeerDia
			? fila("Asistencia y cierre del día", "no se pudieron leer; ábrelos en Hoy", false)
			: fila("Asistencia", conAsistencia + " de " + alumnos.length, alumnos.length > 0 && conAsistencia >= alumnos.length)) +
		(sinLeer
			? fila("Tareas y productos", "no se pudieron leer; ábrelos en Hoy", false)
			: fila("Tareas por revisar", String(tareasPorRevisar), tareasPorRevisar === 0) +
			(porCompletar ? fila("Pendientes de la clase anterior", String(porCompletar), false) : "") +
			(porFalta ? fila("Por falta justificada", porFalta + (porFaltaVencidas ? " (" + porFaltaVencidas + (porFaltaVencidas === 1 ? " venció)" : " vencieron)") : ""), false) : "") +
			fila("Sesiones de hoy", sesionesHoy ? String(sesionesHoy) : "ninguna todavía", sesionesHoy > 0) +
			fila("Productos por calificar", sesionesHoy ? String(sinCalificar) : "—", sesionesHoy > 0 && sinCalificar === 0)) +
		(sinLeerDia ? "" : fila("Cierre del día", cierre.nadieAsistio ? "nadie asistió hoy" : cierre.conteo + cierre.sinContar, cierre.completo)) +
		(jornada === undefined ? "" : fila("Jornada", jornada ? "finalizada a las " + horaJornada : "sin finalizar", !!jornada));
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

// ── 2. Proyectos activos: la sesión de hoy (o la siguiente pendiente) de cada uno ──
// Las sesiones de todos los proyectos activos, sin el tope de 1000 filas (js/alcance-hoy.js);
// si fallan, lanza (Inicio no dice "ya se trabajaron")
function leerSesiones() {
	return window.AlcanceHoy.leerPorLotes(proyectosActivos.map((p) => p.id), (lote) => window.sb
		.from("sesiones")
		.select("*")
		.in("proyecto_id", lote)
		.order("proyecto_id")
		.order("numero_sesion")
		.order("id"));
}

/*
	Una tarjeta compacta por proyecto activo (decisión de Jorge del 2026-09-26: hay maestros
	con un proyecto por campo formativo). Cada una dice qué sesión toca hoy o cuál sigue, con
	sus acciones; el plan completo se abre con "Ver el plan" (abierto de entrada si hay un
	solo proyecto). "Terminar sesión" es de cada proyecto.
*/
function renderProyectos(container, sesiones) {
	const hoy = getLocalDateISO();
	const varios = proyectosActivos.length > 1;
	if (varios) {
		const titulo = document.createElement("h2");
		titulo.className = "text-sm font-semibold uppercase tracking-wide text-gray-500 mt-2";
		titulo.textContent = "Tus " + proyectosActivos.length + " proyectos activos";
		container.appendChild(titulo);
	}
	proyectosActivos.forEach((proyecto) => {
		const suyas = (sesiones || []).filter((s) => s.proyecto_id === proyecto.id)
			.sort((a, b) => (a.numero_sesion || 0) - (b.numero_sesion || 0));
		container.appendChild(crearCardProyecto(proyecto, suyas, hoy, !varios));
	});
}

function crearCardProyecto(proyecto, sesiones, hoy, planAbierto) {
	const card = document.createElement("section");
	card.className = "bg-white rounded-2xl shadow-md p-5 sm:p-6 flex flex-col gap-3";
	card.setAttribute("aria-label", "Proyecto " + (proyecto.titulo || ""));
	const campos = Array.isArray(proyecto.campos_formativos) ? proyecto.campos_formativos : [];
	const cabecera = document.createElement("div");
	cabecera.innerHTML =
		"<p class='text-xs font-semibold uppercase tracking-wide text-emerald-700'>Proyecto activo</p>" +
		"<h2 class='text-lg font-bold text-gray-800'>" + escapeHtml(proyecto.titulo || "Proyecto sin título") + "</h2>" +
		(campos.length ? "<p class='text-sm text-gray-500'>" + escapeHtml(campos.join(" · ")) + "</p>" : "");
	card.appendChild(cabecera);

	/*
		Las sesiones de hoy y las EMPEZADAS otro día que siguen sin terminar (sesión en curso: no se puede
		empezar otra hasta terminarla, js/sesion-terminar.js). "Trabajar hoy" solo se ofrece sobre la siguiente
		sesión (la de menor número sin fecha) y solo si no hay una sin terminar.
	*/
	const ST = window.SesionTerminar;
	const deHoy = sesiones.filter((s) => s.fecha === hoy);
	const enCurso = ST ? ST.enCursoDe(sesiones, proyecto.id) : [];
	const visibles = deHoy.concat(enCurso.filter((s) => deHoy.indexOf(s) === -1))
		.sort((a, b) => (a.numero_sesion || 0) - (b.numero_sesion || 0));
	const sinTerminar = visibles.some((s) => s.estado_sesion !== "completada");
	const siguiente = sesiones.find((s) => !s.fecha && s.estado_sesion !== "completada");
	visibles.forEach((s) => card.appendChild(crearCardSesion(s, true, proyecto, planAbierto, hoy)));
	if (!sinTerminar && siguiente) {
		card.appendChild(crearCardSesion(siguiente, false, proyecto, planAbierto, hoy));
	} else if (!visibles.length) {
		const p = document.createElement("p");
		p.className = "text-sm text-gray-600";
		p.textContent = "Todas las sesiones de este proyecto ya se trabajaron.";
		card.appendChild(p);
	}
	return card;
}

function crearCardSesion(sesion, esDeHoy, proyecto, planAbierto, hoy) {
	const card = document.createElement("div");
	card.className = "rounded-xl border border-gray-200 border-l-4 p-4 " + (esDeHoy ? "border-l-violet-500" : "border-l-gray-300");

	const titulo = "Sesión " + (sesion.numero_sesion || "-") + (sesion.campo_formativo ? " · " + sesion.campo_formativo : "");
	// De otro día y sin terminar: "Empezó el 29 sep · en curso"
	const empezo = esDeHoy && sesion.fecha !== hoy && window.SesionTerminar ? window.SesionTerminar.etiquetaEmpezo(sesion.fecha, hoy) : "";
	const cabecera = document.createElement("div");
	cabecera.className = "mb-3";
	cabecera.innerHTML =
		"<p class='text-xs font-semibold uppercase tracking-wide " + (esDeHoy ? "text-violet-600" : "text-gray-400") + "'>" +
		(esDeHoy ? (sesion.estado_sesion === "completada" ? "Hoy · terminada" : (empezo ? escapeHtml(empezo) + " · en curso" : "Hoy")) : "Siguiente sesión") + "</p>" +
		"<h3 class='text-base font-bold text-gray-800'>" + escapeHtml(titulo) + "</h3>" +
		(sesion.momento ? "<p class='text-sm text-gray-500'>" + escapeHtml(sesion.momento) + "</p>" : "");
	card.appendChild(cabecera);

	const acciones = document.createElement("div");
	acciones.className = "flex flex-wrap gap-2";
	const idSesion = sesion.id;

	if (!esDeHoy) {
		const btnHoy = document.createElement("button");
		btnHoy.type = "button";
		btnHoy.className = "min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700";
		btnHoy.textContent = "Trabajar hoy";
		btnHoy.setAttribute("aria-label", "Trabajar hoy la sesión " + (sesion.numero_sesion || "") + " de " + (proyecto.titulo || "este proyecto"));
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
			btnTerminar.textContent = "Terminar sesión " + (sesion.numero_sesion || "");
			btnTerminar.setAttribute("aria-label", "Terminar la sesión " + (sesion.numero_sesion || "") + " de " + (proyecto.titulo || "este proyecto"));
			btnTerminar.addEventListener("click", function () {
				window.SesionTerminar.abrirModal({
					titulo: "Terminar la sesión " + (sesion.numero_sesion || ""),
					sinCalificar: null,
					etiquetaBoton: "Terminar sesión " + (sesion.numero_sesion || ""),
					origen: btnTerminar,
					alConfirmar: async function (notas) {
						await terminarSesion(idSesion, notas, proyecto);
					},
				});
			});
			acciones.appendChild(btnTerminar);
		}
	}
	card.appendChild(acciones);

	// El plan de la sesión: se abre a pedido (abierto de entrada con un solo proyecto). Es la misma secuencia
	// que muestra Hoy (js/secuencia-sesion.js), con sus anexos y libros en el visor (js/visor-recursos.js)
	const plan = document.createElement("details");
	plan.className = "mt-3 group";
	if (planAbierto) plan.open = true;
	const resumen = document.createElement("summary");
	resumen.className = "min-h-[44px] flex items-center cursor-pointer text-sm font-semibold text-blue-700";
	resumen.textContent = "Ver el plan de la sesión";
	plan.appendChild(resumen);
	const cuerpo = document.createElement("div");
	cuerpo.className = "pt-2";
	const secuencia = document.createElement("div");
	secuencia.setAttribute("data-secuencia-inicio", "1");
	secuencia.innerHTML = window.SecuenciaSesion ? window.SecuenciaSesion.html(sesion) : "";
	cuerpo.appendChild(secuencia);

	const pdaHtml = renderPdaSesion(sesion.pda_sesion);
	if (pdaHtml) {
		const bloque = document.createElement("section");
		bloque.className = "border-l-4 border-l-rose-500 pl-4 py-2 mb-3";
		bloque.innerHTML = "<h4 class='font-semibold text-gray-800 mb-2'>PDA por grado</h4>" + pdaHtml;
		cuerpo.appendChild(bloque);
	}
	plan.appendChild(cuerpo);
	card.appendChild(plan);
	return card;
}

// ── 3. Terminar la sesión (de SU proyecto): js/sesion-terminar.js, el mismo de Hoy ──
async function terminarSesion(sesionId, notasCierre, proyecto) {
	clearError();
	try {
		await window.SesionTerminar.terminar(window.sb, {
			sesionId: sesionId, notas: notasCierre, proyectoId: proyecto.id, maestroId: user.id, hoy: getLocalDateISO(),
		});
	} catch (error) {
		throw new Error("No se pudo terminar la sesión: " + ((error && error.message) || "error desconocido"));
	}
	window.location.reload();
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
