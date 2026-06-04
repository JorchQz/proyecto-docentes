let proyectoActivo = null;
let sesionActiva = null;
let grupoId = null;
let alumnos = [];
let user = null;

let flujoEstado = {
	asistenciaGuardada: false,
	tareasRevisadas: false,
	sesionCompletada: false,
};

let resumenDia = {
	presentes: 0,
	totalAlumnos: 0,
	tareasRevisadas: [],
	sesionNombre: "",
	tareasParaManana: [],
	proyectoCompletado: false,
	haySiguienteSesion: false,
};

document.addEventListener("DOMContentLoaded", async function () {
	try {
		const {
			data: { user: u },
			error: userError,
		} = await window.sb.auth.getUser();

		if (userError || !u) {
			window.location.href = "index.html";
			return;
		}

		user = u;
		await inicializarEncabezado();
		await cargarGrupoYAlumnos();

		const { data: proyectos, error: proyectoError } = await window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado")
			.eq("maestro_id", user.id)
			.eq("estado", "activo")
			.limit(1);

		if (proyectoError) {
			showError("No se pudo cargar el proyecto activo: " + proyectoError.message);
			renderSinProyecto();
			return;
		}

		if (!proyectos || proyectos.length === 0) {
			renderSinProyecto();
			return;
		}

		proyectoActivo = proyectos[0];

		const { data: sesiones, error: sesionError } = await window.sb
			.from("sesiones")
			.select("*")
			.eq("proyecto_id", proyectoActivo.id)
			.eq("estado_sesion", "activa")
			.order("numero_sesion")
			.limit(1);

		if (sesionError) {
			showError("No se pudo cargar la sesion activa: " + sesionError.message);
		}

		sesionActiva = sesiones && sesiones.length ? sesiones[0] : null;
		await iniciarFlujo();
	} catch (error) {
		showError("Error inesperado al cargar el dashboard: " + (error.message || ""));
	}
});

async function inicializarEncabezado() {
	const { data: perfil, error: perfilError } = await window.sb
		.from("perfiles")
		.select("nombre_completo")
		.eq("id", user.id)
		.single();

	if (perfilError) {
		showError("No se pudo obtener el perfil: " + perfilError.message);
	}

	const hora = new Date().getHours();
	const saludo = hora < 12 ? "Buenos dias" : hora < 19 ? "Buenas tardes" : "Buenas noches";
	const nombre = (perfil && perfil.nombre_completo ? perfil.nombre_completo : "").trim();
	document.getElementById("welcomeTitle").textContent =
		saludo + (nombre ? ", " + nombre.split(" ")[0] : "");

	const hoy = new Date();
	document.getElementById("fechaHoy").textContent = hoy.toLocaleDateString("es-MX", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	document.getElementById("welcomeSub").textContent = "Panel de jornada diaria";
}

async function cargarGrupoYAlumnos() {
	const rawGrupo = localStorage.getItem("grupoActivo") || localStorage.getItem("grupo_activo");
	if (rawGrupo) {
		try {
			grupoId = JSON.parse(rawGrupo).id || null;
		} catch (_) {
			grupoId = null;
		}
	}

	if (!grupoId) {
		const { data: g, error: grupoError } = await window.sb
			.from("grupos")
			.select("id")
			.eq("maestro_id", user.id)
			.limit(1)
			.single();

		if (grupoError && grupoError.code !== "PGRST116") {
			showError("No se pudo cargar el grupo activo: " + grupoError.message);
			return;
		}

		if (g) {
			grupoId = g.id;
		}
	}

	if (!grupoId) {
		window.location.href = "onboarding.html";
		return;
	}

	const { data: als, error: alumnosError } = await window.sb
		.from("alumnos")
		.select("id, nombre_completo, grado, num_lista")
		.eq("grupo_id", grupoId)
		.eq("estatus", "Activo")
		.order("grado")
		.order("num_lista");

	if (alumnosError) {
		showError("No se pudo cargar la lista de alumnos: " + alumnosError.message);
	}

	alumnos = als || [];
}

function renderSinProyecto() {
	document.getElementById("flowContainer").innerHTML =
		"<div class='bg-white rounded-2xl shadow-md p-8 text-center'>" +
		"<p class='text-gray-400 text-lg mb-2'>No tienes ningun proyecto activo</p>" +
		"<p class='text-gray-400 text-sm mb-6'>Ve a Proyectos, selecciona uno y presiona \"Iniciar proyecto\"</p>" +
		"<a href='planeacion.html' class='bg-blue-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition'>" +
		"Ir a Mis Proyectos -></a></div>";
}

async function iniciarFlujo() {
	const container = document.getElementById("flowContainer");
	container.innerHTML = "";

	container.appendChild(await crearCardAsistencia());
	container.appendChild(await crearCardTareas());
	container.appendChild(await crearCardSesion());

	expandirCard("card-asistencia");

	if (flujoEstado.asistenciaGuardada) {
		expandirCard("card-tareas");
	}
	if (flujoEstado.asistenciaGuardada && flujoEstado.tareasRevisadas) {
		expandirCard("card-sesion");
	}
}

async function crearCardAsistencia() {
	const card = crearCardBase("card-asistencia", "border-l-blue-500", "📋 Asistencia", formatFechaCorta(new Date()));
	const body = card.querySelector(".card-flow-body");
	const hoy = getLocalDateISO();

	let registrosHoy = [];
	if (grupoId) {
		const { data, error } = await window.sb
			.from("asistencias")
			.select("alumno_id, asistencia_estado")
			.eq("grupo_id", grupoId)
			.eq("fecha", hoy);
		if (error) {
			showError("No se pudo consultar asistencia de hoy: " + error.message);
		}
		registrosHoy = data || [];
	}

	if (registrosHoy.length > 0) {
		const resumen = buildAsistenciaResumen(registrosHoy, alumnos.length);
		flujoEstado.asistenciaGuardada = true;
		resumenDia.presentes = resumen.presentes;
		resumenDia.totalAlumnos = alumnos.length;
		colapsar("card-asistencia", "✅ " + resumen.presentes + " presentes, " + resumen.ausentes + " ausentes");
		body.innerHTML = "<p class='text-sm text-gray-500'>La asistencia de hoy ya fue registrada.</p>";
		return card;
	}

	if (!alumnos.length) {
		body.innerHTML = "<p class='text-red-600 text-sm'>No hay alumnos activos en el grupo.</p>";
		return card;
	}

	const estadoPorAlumno = {};
	alumnos.forEach((a) => {
		estadoPorAlumno[a.id] = "presente";
	});

	body.appendChild(renderAlumnosAsistencia(alumnos, estadoPorAlumno));

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "mt-5 bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition";
	saveBtn.textContent = "Guardar asistencia";
	body.appendChild(saveBtn);

	saveBtn.addEventListener("click", async function () {
		saveBtn.disabled = true;
		saveBtn.classList.add("opacity-70", "cursor-not-allowed");
		clearError();

		try {
			const payload = alumnos.map((a) => ({
				maestro_id: user.id,
				grupo_id: grupoId,
				alumno_id: a.id,
				fecha: hoy,
				asistencia_estado: estadoPorAlumno[a.id] || "presente",
			}));

			const { error } = await window.sb
				.from("asistencias")
				.upsert(payload, { onConflict: "alumno_id,fecha" });

			if (error) {
				throw error;
			}

			const resumen = buildAsistenciaResumen(payload, alumnos.length);
			flujoEstado.asistenciaGuardada = true;
			resumenDia.presentes = resumen.presentes;
			resumenDia.totalAlumnos = alumnos.length;
			colapsar("card-asistencia", "✅ " + resumen.presentes + " presentes, " + resumen.ausentes + " ausentes");
			expandirCard("card-tareas");
		} catch (errorGuardar) {
			showError("No se pudo guardar la asistencia: " + errorGuardar.message);
		} finally {
			saveBtn.disabled = false;
			saveBtn.classList.remove("opacity-70", "cursor-not-allowed");
		}
	});

	return card;
}

async function crearCardTareas() {
	const { data: tareasPendientes, error } = await window.sb
		.from("tareas")
		.select("id, descripcion, grado, sesion_id, fecha_asignada")
		.eq("maestro_id", user.id)
		.eq("revisada", false)
		.not("fecha_asignada", "is", null)
		.eq("proyecto_id", proyectoActivo.id)
		.order("fecha_asignada");

	if (error) {
		showError("No se pudieron cargar las tareas pendientes: " + error.message);
	}

	const tareas = tareasPendientes || [];
	const card = crearCardBase(
		"card-tareas",
		"border-l-emerald-500",
		"📝 Revision de Tareas",
		tareas.length ? tareas.length + " pendientes" : "Sin pendientes"
	);
	const body = card.querySelector(".card-flow-body");

	if (!tareas.length) {
		flujoEstado.tareasRevisadas = true;
		body.innerHTML = "<p class='text-sm text-gray-500'>No hay tareas pendientes de revision.</p>";
		colapsar("card-tareas", "No hay tareas pendientes de revision");
		return card;
	}

	const grupos = agruparTareas(tareas);
	const revisiones = [];

	grupos.forEach((grupo, idx) => {
		const box = document.createElement("div");
		box.className = "mb-4 rounded-xl border border-emerald-100 p-4 bg-emerald-50/30";
		box.innerHTML =
			"<p class='font-semibold text-gray-800'>" + escapeHtml(grupo.descripcion) + "</p>" +
			"<p class='text-xs text-gray-500 mb-3'>" +
			(grupo.grado == null ? "Todos los grados" : "Grado " + grupo.grado) +
			"</p>";

		const lista = document.createElement("div");
		lista.className = "space-y-2";
		const candidatos = alumnos.filter((a) => grupo.grado == null || Number(a.grado) === Number(grupo.grado));

		candidatos.forEach((alumno) => {
			const row = document.createElement("div");
			row.className = "grid grid-cols-1 md:grid-cols-3 gap-2 items-center bg-white p-2 rounded-lg border border-gray-100";
			row.innerHTML =
				"<span class='text-sm font-medium text-gray-700'>" + escapeHtml(getNombreAlumno(alumno)) + "</span>" +
				"<input type='number' min='5' max='10' step='0.1' value='10' class='tarea-calif border border-gray-300 rounded-lg px-3 py-1.5 text-sm' />" +
				"<label class='inline-flex items-center gap-2 text-sm text-gray-600'><input type='checkbox' class='tarea-no-entrego' /> No entrego</label>";

			const inputCalif = row.querySelector(".tarea-calif");
			const chkNo = row.querySelector(".tarea-no-entrego");
			chkNo.addEventListener("change", function () {
				inputCalif.disabled = chkNo.checked;
				if (chkNo.checked) {
					inputCalif.value = "";
				}
			});

			revisiones.push({
				grupoIndex: idx,
				descripcion: grupo.descripcion,
				sesion_id: grupo.sesion_id,
				grado: grupo.grado,
				alumno,
				inputCalif,
				chkNo,
			});

			lista.appendChild(row);
		});

		if (!candidatos.length) {
			const vacio = document.createElement("p");
			vacio.className = "text-sm text-gray-500";
			vacio.textContent = "No hay alumnos activos para este grado.";
			lista.appendChild(vacio);
		}

		box.appendChild(lista);
		body.appendChild(box);
	});

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "bg-emerald-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-emerald-700 transition";
	saveBtn.textContent = "Guardar revision";
	body.appendChild(saveBtn);

	saveBtn.addEventListener("click", async function () {
		saveBtn.disabled = true;
		saveBtn.classList.add("opacity-70", "cursor-not-allowed");
		clearError();
		const hoy = getLocalDateISO();

		try {
			const payload = [];
			revisiones.forEach((r) => {
				const noEntrego = r.chkNo.checked;
				const califRaw = r.inputCalif.value;
				const calif = califRaw ? Number(califRaw) : null;

				if (!noEntrego && (calif == null || Number.isNaN(calif) || calif < 5 || calif > 10)) {
					throw new Error("Las calificaciones deben estar entre 5 y 10.");
				}

				payload.push({
					alumno_id: r.alumno.id,
					maestro_id: user.id,
					sesion_id: r.sesion_id || (sesionActiva ? sesionActiva.id : null),
					proyecto_id: proyectoActivo.id,
					grupo_id: grupoId,
					tipo: "tarea",
					descripcion: r.descripcion,
					calificacion: noEntrego ? null : calif,
					entrego: !noEntrego,
					fecha: hoy,
					grado: r.alumno.grado,
					campo_formativo: sesionActiva ? sesionActiva.campo_formativo || null : null,
				});
			});

			if (payload.length) {
				const { error: insertError } = await window.sb.from("calificaciones").insert(payload);
				if (insertError) {
					throw insertError;
				}
			}

			const ids = tareas.map((t) => t.id);
			const { error: updateError } = await window.sb
				.from("tareas")
				.update({ revisada: true, fecha_revision: hoy })
				.in("id", ids);

			if (updateError) {
				throw updateError;
			}

			flujoEstado.tareasRevisadas = true;
			resumenDia.tareasRevisadas = [...new Set(tareas.map((t) => t.descripcion))];
			colapsar("card-tareas", "✅ " + ids.length + " tareas revisadas");
			expandirCard("card-sesion");
		} catch (e) {
			showError("No se pudo guardar la revision de tareas: " + e.message);
		} finally {
			saveBtn.disabled = false;
			saveBtn.classList.remove("opacity-70", "cursor-not-allowed");
		}
	});

	return card;
}

async function crearCardSesion() {
	const tituloSesion = sesionActiva
		? "📖 Sesion " + (sesionActiva.numero_sesion || "-") + " - " + (sesionActiva.momento || "Dia")
		: "📖 Sesion del dia";
	const card = crearCardBase(
		"card-sesion",
		"border-l-violet-500",
		tituloSesion,
		sesionActiva && sesionActiva.campo_formativo ? sesionActiva.campo_formativo : "Sin sesion activa"
	);
	const body = card.querySelector(".card-flow-body");

	if (!sesionActiva) {
		body.innerHTML =
			"<p class='text-gray-500 mb-4'>No hay sesion activa en este momento.</p>" +
			"<a href='planeacion.html' class='inline-flex border border-blue-300 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition'>Ver proyecto</a>";
		return card;
	}

	body.appendChild(renderBloqueSesion("INICIO", "border-l-blue-500", getTextoFase("inicio"), getActividadesFase("inicio")));
	body.appendChild(renderBloqueSesion("DESARROLLO", "border-l-violet-500", getTextoFase("desarrollo"), getActividadesFase("desarrollo")));
	body.appendChild(
		renderBloqueSesion(
			"CIERRE",
			"border-l-emerald-500",
			getTextoFase("cierre"),
			getActividadesFase("cierre"),
			getTareasCierreTexto()
		)
	);

	const recursos = normalizarRecursos(sesionActiva.recursos);
	if (recursos.length) {
		const bloqueRecursos = document.createElement("section");
		bloqueRecursos.className = "border-l-4 border-l-amber-500 pl-4 py-2";
		bloqueRecursos.innerHTML = "<h4 class='font-semibold text-gray-800 mb-2'>Recursos</h4>";
		const wrap = document.createElement("div");
		wrap.className = "flex flex-wrap gap-2";
		recursos.forEach((r) => {
			const a = document.createElement("a");
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			a.href = r.url;
			a.className = "text-sm border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50";
			a.textContent = r.titulo;
			wrap.appendChild(a);
		});
		bloqueRecursos.appendChild(wrap);
		body.appendChild(bloqueRecursos);
	}

	const pdaHtml = renderPdaSesion(sesionActiva.pda_sesion);
	if (pdaHtml) {
		const bloquePda = document.createElement("section");
		bloquePda.className = "border-l-4 border-l-rose-500 pl-4 py-2";
		bloquePda.innerHTML = "<h4 class='font-semibold text-gray-800 mb-2'>PDA por grado</h4>" + pdaHtml;
		body.appendChild(bloquePda);
	}

	const acciones = document.createElement("div");
	acciones.className = "mt-5 flex flex-wrap gap-2";

	const siguiente = await buscarSiguienteSesionPendiente();
	if (siguiente) {
		const btnSiguiente = document.createElement("button");
		btnSiguiente.type = "button";
		btnSiguiente.className = "border border-blue-400 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50";
		btnSiguiente.textContent = "Continuar con siguiente sesion";
		btnSiguiente.addEventListener("click", async function () {
			await activarSiguienteSesion(siguiente);
			await iniciarFlujo();
		});
		acciones.appendChild(btnSiguiente);
	}

	const btnTerminar = document.createElement("button");
	btnTerminar.type = "button";
	btnTerminar.className = "border border-gray-300 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50";
	btnTerminar.textContent = "Terminar jornada";
	btnTerminar.addEventListener("click", function () {
		window.scrollTo({ top: 0, behavior: "smooth" });
	});
	acciones.appendChild(btnTerminar);

	const btnCompletar = document.createElement("button");
	btnCompletar.type = "button";
	btnCompletar.className = "bg-green-600 text-white text-lg font-semibold px-5 py-2.5 rounded-xl hover:bg-green-700";
	btnCompletar.textContent = "✓ Sesion completada";
	btnCompletar.addEventListener("click", function () {
		abrirModalCierre(async function (notas, califs) {
			await completarSesionDelDia(notas, califs);
		});
	});
	acciones.appendChild(btnCompletar);

	body.appendChild(acciones);
	return card;
}

async function completarSesionDelDia(notasCierre, califData) {
	clearError();
	const hoy = getLocalDateISO();
	try {
		const updatePayload = {
			estado_sesion: "completada",
			fecha: hoy,
			notas_cierre: notasCierre || null,
		};

		const { error: updateError } = await window.sb
			.from("sesiones")
			.update(updatePayload)
			.eq("id", sesionActiva.id);
		if (updateError) {
			throw updateError;
		}

		const tareasCierre = extraerTareasCierre();
		const insertsTareas = construirInsertsTareasCierre(tareasCierre, hoy);
		if (insertsTareas.length) {
			const { error: insertTaskError } = await window.sb.from("tareas").insert(insertsTareas);
			if (insertTaskError) {
				throw insertTaskError;
			}
		}

		if (califData && califData.length) {
			const califRows = [];
			califData.forEach(function (al) {
				califRows.push({
					alumno_id:     al.id,
					maestro_id:    user.id,
					sesion_id:     sesionActiva.id,
					proyecto_id:   proyectoActivo.id,
					grupo_id:      grupoId,
					tipo:          "participacion",
					calificacion:  al.participacion,
					entrego:       true,
					fecha:         hoy,
					grado:         al.grado || null,
					campo_formativo: null,
				});
				califRows.push({
					alumno_id:     al.id,
					maestro_id:    user.id,
					sesion_id:     sesionActiva.id,
					proyecto_id:   proyectoActivo.id,
					grupo_id:      grupoId,
					tipo:          "conducta",
					calificacion:  al.conducta,
					entrego:       true,
					fecha:         hoy,
					grado:         al.grado || null,
					campo_formativo: null,
				});
			});
			const { error: califError } = await window.sb.from("calificaciones").insert(califRows);
			if (califError) {
				// No se bloquea el cierre — la sesión ya fue guardada. El maestro puede re-registrar desde Reportes.
				console.error("calificaciones insert:", califError.message);
			}
		}

		const siguiente = await buscarSiguienteSesionPendiente();
		if (siguiente) {
			await activarSiguienteSesion(siguiente);
			resumenDia.haySiguienteSesion = true;
			resumenDia.proyectoCompletado = false;
		} else {
			const { error: proyectoError } = await window.sb
				.from("proyectos")
				.update({ estado: "completado", fecha_final: hoy })
				.eq("id", proyectoActivo.id);
			if (proyectoError) {
				throw proyectoError;
			}
			resumenDia.haySiguienteSesion = false;
			resumenDia.proyectoCompletado = true;
			sesionActiva = null;
		}

		flujoEstado.sesionCompletada = true;
		resumenDia.sesionNombre =
			"Sesion " + (sesionActiva ? sesionActiva.numero_sesion || "-" : "") + " " +
			(sesionActiva && sesionActiva.momento ? "- " + sesionActiva.momento : "");
		resumenDia.tareasParaManana = insertsTareas.map((t) =>
			t.grado != null ? t.grado + "°: " + t.descripcion : t.descripcion
		);

		cerrarModalCierre();
		colapsar("card-sesion", "✅ Sesion marcada como completada");
		crearCardResumen();
	} catch (error) {
		showError("No se pudo completar la sesion: " + error.message);
	}
}

function crearCardResumen() {
	const container = document.getElementById("flowContainer");
	const card = document.createElement("section");
	card.className = "bg-white border border-gray-200 rounded-2xl p-6";

	const tareasRevisadasHtml = resumenDia.tareasRevisadas.length
		? "<ul class='list-disc pl-5 text-sm text-gray-600'>" +
			resumenDia.tareasRevisadas.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
			"</ul>"
		: "<p class='text-sm text-gray-500'>Sin tareas revisadas hoy.</p>";

	const tareasMananaHtml = resumenDia.tareasParaManana.length
		? "<ul class='list-disc pl-5 text-sm text-gray-600'>" +
			resumenDia.tareasParaManana.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
			"</ul>"
		: "<p class='text-sm text-gray-500'>No se dejaron tareas nuevas.</p>";

	card.innerHTML =
		"<h3 class='text-xl font-bold text-gray-800 mb-4'>✅ Jornada completada</h3>" +
		"<div class='space-y-3'>" +
		"<p class='text-sm text-gray-700'><span class='font-semibold'>Resumen asistencia:</span> " +
		resumenDia.presentes + " de " + resumenDia.totalAlumnos + " alumnos presentes</p>" +
		"<div><p class='font-semibold text-gray-700'>Tareas revisadas:</p>" + tareasRevisadasHtml + "</div>" +
		"<p class='text-sm text-gray-700'><span class='font-semibold'>Sesion trabajada:</span> " +
		escapeHtml(resumenDia.sesionNombre || "N/A") + "</p>" +
		"<div><p class='font-semibold text-gray-700'>Tareas dejadas para manana:</p>" + tareasMananaHtml + "</div>" +
		"</div>";

	const acciones = document.createElement("div");
	acciones.className = "mt-5 flex flex-wrap gap-2";

	const btnPrint = document.createElement("button");
	btnPrint.type = "button";
	btnPrint.className = "border border-gray-300 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50";
	btnPrint.textContent = "🖨 Imprimir resumen";
	btnPrint.onclick = function () {
		window.print();
	};
	acciones.appendChild(btnPrint);

	if (resumenDia.haySiguienteSesion) {
		const btnNext = document.createElement("button");
		btnNext.type = "button";
		btnNext.className = "bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700";
		btnNext.textContent = "Continuar con siguiente sesion";
		btnNext.onclick = async function () {
			flujoEstado.sesionCompletada = false;
			await iniciarFlujo();
		};
		acciones.appendChild(btnNext);
	}

	if (resumenDia.proyectoCompletado) {
		const aProyecto = document.createElement("a");
		aProyecto.href = "planeacion.html";
		aProyecto.className = "bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700";
		aProyecto.textContent = "🎉 Proyecto completado - Ver en Proyectos";
		acciones.appendChild(aProyecto);
	}

	card.appendChild(acciones);
	container.appendChild(card);
}

function expandirCard(id) {
	document.querySelectorAll(".card-flow-body").forEach((b) => {
		b.classList.add("hidden");
	});
	const body = document.getElementById(id + "-body");
	if (body) {
		body.classList.remove("hidden");
	}
}

function colapsar(id, resumenHTML) {
	const body = document.getElementById(id + "-body");
	if (body) {
		body.classList.add("hidden");
	}
	const resumen = document.getElementById(id + "-resumen");
	if (resumen) {
		resumen.innerHTML = resumenHTML;
		resumen.classList.remove("hidden");
	}
}

function crearCardBase(id, borderColorClass, titulo, badgeTexto) {
	const card = document.createElement("section");
	card.id = id;
	card.className =
		"bg-white rounded-2xl shadow-sm border border-gray-200 border-l-4 overflow-hidden " + borderColorClass;

	const header = document.createElement("div");
	header.className = "flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition";
	header.innerHTML =
		"<h3 class='font-bold text-gray-800'>" + escapeHtml(titulo) + "</h3>" +
		"<span class='text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full'>" +
		escapeHtml(badgeTexto || "") +
		"</span>";

	const resumen = document.createElement("div");
	resumen.id = id + "-resumen";
	resumen.className = "hidden px-4 pb-4 text-sm text-gray-600";

	const body = document.createElement("div");
	body.id = id + "-body";
	body.className = "card-flow-body p-5 border-t border-gray-100 hidden";

	header.addEventListener("click", function () {
		expandirCard(id);
	});

	card.appendChild(header);
	card.appendChild(resumen);
	card.appendChild(body);
	return card;
}

function renderAlumnosAsistencia(listaAlumnos, estadoPorAlumno) {
	const wrapper = document.createElement("div");
	const porGrado = {};

	listaAlumnos.forEach((a) => {
		const key = a.grado || "-";
		if (!porGrado[key]) {
			porGrado[key] = [];
		}
		porGrado[key].push(a);
	});

	Object.keys(porGrado)
		.sort((a, b) => Number(a) - Number(b))
		.forEach((grado) => {
			const bloque = document.createElement("div");
			bloque.className = "mb-4";
			bloque.innerHTML = "<h4 class='font-semibold text-gray-700 mb-2'>Grado " + grado + "</h4>";

			porGrado[grado].forEach((a) => {
				const row = document.createElement("div");
				row.className = "flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-2 border-b border-gray-100";
				const groupName = "asis-" + a.id;
				row.innerHTML =
					"<span class='text-sm font-medium text-gray-700'>" + escapeHtml(getNombreAlumno(a)) + "</span>" +
					"<div class='flex flex-wrap gap-2'>" +
					crearPillAsistencia(groupName, "presente", "✓ Presente", true) +
					crearPillAsistencia(groupName, "ausente", "✗ Ausente", false) +
					crearPillAsistencia(groupName, "justificada", "~ Justificada", false) +
					"</div>";

				row.querySelectorAll("input[type='radio']").forEach((radio) => {
					radio.addEventListener("change", function () {
						estadoPorAlumno[a.id] = radio.value;
					});
				});

				bloque.appendChild(row);
			});

			wrapper.appendChild(bloque);
		});

	return wrapper;
}

function crearPillAsistencia(name, value, text, checked) {
	return (
		"<label class='inline-flex items-center border border-gray-300 rounded-full px-3 py-1 text-xs cursor-pointer hover:bg-gray-50'>" +
		"<input class='mr-1' type='radio' name='" +
		name +
		"' value='" +
		value +
		"' " +
		(checked ? "checked" : "") +
		" />" +
		escapeHtml(text) +
		"</label>"
	);
}

function buildAsistenciaResumen(registros, total) {
	const presentes = registros.filter((r) => r.asistencia_estado !== "ausente").length;
	const ausentes = total - presentes;
	return { presentes, ausentes };
}

function agruparTareas(tareas) {
	const mapa = {};
	tareas.forEach((t) => {
		const key = (t.descripcion || "") + "__" + (t.grado == null ? "all" : t.grado);
		if (!mapa[key]) {
			mapa[key] = {
				descripcion: t.descripcion || "Tarea",
				grado: t.grado,
				sesion_id: t.sesion_id,
				ids: [],
			};
		}
		mapa[key].ids.push(t.id);
	});
	return Object.keys(mapa).map((k) => mapa[k]);
}

function getTextoFase(fase) {
	const todos = sesionActiva && sesionActiva[fase + "_todos"] ? sesionActiva[fase + "_todos"] : "";
	const diferenciado = sesionActiva && sesionActiva[fase + "_diferenciado"] ? sesionActiva[fase + "_diferenciado"] : "";
	if (typeof todos === "string" && todos.trim()) {
		return todos;
	}
	if (typeof diferenciado === "string" && diferenciado.trim()) {
		return diferenciado;
	}
	if (typeof diferenciado === "object" && diferenciado !== null) {
		return Object.keys(diferenciado)
			.map((g) => "Grado " + g + ": " + (diferenciado[g] || ""))
			.join("\n");
	}
	return "Sin informacion registrada.";
}

function getActividadesFase(fase) {
	const raw = sesionActiva ? sesionActiva[fase + "_actividades"] : null;
	if (!raw) {
		return [];
	}
	if (Array.isArray(raw)) {
		return raw.map((x) => (typeof x === "string" ? x : x.descripcion || JSON.stringify(x)));
	}
	if (typeof raw === "string") {
		return [raw];
	}
	if (typeof raw === "object") {
		return Object.values(raw).flat().map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
	}
	return [];
}

function getTareasCierreTexto() {
	return extraerTareasCierre().map((t) =>
		t.grado != null ? t.grado + "°: " + t.descripcion : t.descripcion
	);
}

function extraerTareasCierre() {
	const raw = sesionActiva ? sesionActiva.cierre_tareas : null;
	if (!raw) {
		return [];
	}
	if (Array.isArray(raw)) {
		return raw.map((x) => ({ descripcion: typeof x === "string" ? x : x.descripcion || "Tarea", grado: x.grado ?? null }));
	}
	if (typeof raw === "object") {
		const mode = raw.mode || "todos";
		// Modo diferenciado: { diferenciado: { "4": [...], "5": [...] } }.
		// "por_grado" se acepta como alias por compatibilidad con borradores antiguos.
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
		// Modo igual para todos: { todos: [...] }. "items"/"tareas" son alias antiguos.
		const lista = raw.todos || raw.items || raw.tareas || [];
		return (Array.isArray(lista) ? lista : [lista]).map((t) => ({ descripcion: typeof t === "string" ? t : t.descripcion || "Tarea", grado: null }));
	}
	return [];
}

function construirInsertsTareasCierre(tareasCierre, hoy) {
	return tareasCierre.map((t) => ({
		sesion_id: sesionActiva.id,
		proyecto_id: proyectoActivo.id,
		grupo_id: grupoId,
		maestro_id: user.id,
		descripcion: t.descripcion,
		grado: t.grado,
		fecha_asignada: hoy,
		revisada: false,
	}));
}

function renderBloqueSesion(titulo, borde, texto, actividades, tareas) {
	const box = document.createElement("section");
	box.className = "border-l-4 " + borde + " pl-4 py-2 mb-3";
	let html =
		"<h4 class='font-semibold text-gray-800 mb-1'>" + titulo + "</h4>" +
		"<p class='text-sm text-gray-600 whitespace-pre-line mb-2'>" + escapeHtml(texto || "") + "</p>";

	if (actividades && actividades.length) {
		html += "<ul class='list-disc pl-5 text-sm text-gray-600 mb-2'>" +
			actividades.map((a) => "<li>" + escapeHtml(a) + "</li>").join("") +
			"</ul>";
	}

	if (tareas && tareas.length) {
		html += "<p class='text-sm font-medium text-gray-700'>Tareas del cierre:</p>" +
			"<ul class='list-disc pl-5 text-sm text-gray-600'>" +
			tareas.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
			"</ul>";
	}

	box.innerHTML = html;
	return box;
}

function renderPdaSesion(rawPda) {
	if (!rawPda) {
		return "";
	}
	let pda = rawPda;
	if (typeof pda === "string") {
		try {
			pda = JSON.parse(pda);
		} catch (_) {
			return "<p class='text-sm text-gray-600'>" + escapeHtml(rawPda) + "</p>";
		}
	}
	if (!pda || typeof pda !== "object") {
		return "";
	}

	return Object.keys(pda)
		.map((grado) => {
			const item = pda[grado] || {};
			const texto = typeof item === "string" ? item : item.pda || item.texto || "";
			const criterio = typeof item === "object" ? item.criterio_aplicado || "" : "";
			return (
				"<div class='mb-2 text-sm text-gray-700'>" +
				"<p><span class='font-semibold'>Grado " + escapeHtml(grado) + ":</span> " + escapeHtml(texto) + "</p>" +
				(criterio ? "<p class='text-gray-500'>Criterio: " + escapeHtml(criterio) + "</p>" : "") +
				"</div>"
			);
		})
		.join("");
}

function normalizarRecursos(raw) {
	if (!raw) {
		return [];
	}
	let recursos = raw;
	if (typeof recursos === "string") {
		try {
			recursos = JSON.parse(recursos);
		} catch (_) {
			return [];
		}
	}
	if (!Array.isArray(recursos)) {
		recursos = [recursos];
	}
	return recursos
		.map((r) => {
			const url = r.url || r.link || r.href || null;
			if (!url) {
				return null;
			}
			return { titulo: r.nombre || r.titulo || "Abrir recurso", url };
		})
		.filter(Boolean);
}

async function buscarSiguienteSesionPendiente() {
	const { data, error } = await window.sb
		.from("sesiones")
		.select("*")
		.eq("proyecto_id", proyectoActivo.id)
		.eq("estado_sesion", "pendiente")
		.order("numero_sesion")
		.limit(1);
	if (error) {
		showError("No se pudo consultar la siguiente sesion: " + error.message);
		return null;
	}
	return data && data.length ? data[0] : null;
}

async function activarSiguienteSesion(siguiente) {
	const { error } = await window.sb
		.from("sesiones")
		.update({ estado_sesion: "activa" })
		.eq("id", siguiente.id);
	if (error) {
		showError("No se pudo activar la siguiente sesion: " + error.message);
		return;
	}
	sesionActiva = siguiente;
}

function abrirModalCierre(onConfirm) {
	let modal = document.getElementById("modal-cierre-sesion");
	if (modal) modal.remove();

	// Estado de calificaciones: { alumnoId: { p: 10, c: 10 } }
	const califState = {};
	alumnos.forEach(function (al) {
		califState[al.id] = { p: 10, c: 10 };
	});

	modal = document.createElement("div");
	modal.id = "modal-cierre-sesion";
	modal.className = "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4";

	const inner = document.createElement("div");
	inner.className = "bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]";
	modal.appendChild(inner);

	// Cabecera
	const hdr = document.createElement("div");
	hdr.className = "p-5 border-b shrink-0";
	hdr.innerHTML = "<h3 class='text-lg font-bold text-gray-800'>Cerrar sesión del día</h3>";
	inner.appendChild(hdr);

	// Área scrollable
	const body = document.createElement("div");
	body.className = "flex-1 overflow-y-auto p-5 flex flex-col gap-5";
	inner.appendChild(body);

	// — Notas —
	const notasWrap = document.createElement("div");
	notasWrap.innerHTML =
		"<label class='block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2'>Notas (opcional)</label>" +
		"<textarea id='notasCierreInput' class='w-full border border-gray-300 rounded-xl p-3 text-sm min-h-[72px] resize-none' placeholder='¿Algo diferente a lo planeado?'></textarea>";
	body.appendChild(notasWrap);

	// — Participación y Conducta —
	const califSection = document.createElement("div");
	const califTitle = document.createElement("p");
	califTitle.className = "text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3";
	califTitle.textContent = "Participación y Conducta";
	califSection.appendChild(califTitle);

	// Setter global
	const globalWrap = document.createElement("div");
	globalWrap.className = "flex items-center gap-3 bg-gray-50 rounded-xl p-3 mb-3";
	const globalLbl = document.createElement("span");
	globalLbl.className = "text-sm text-gray-600 font-semibold shrink-0 w-20";
	globalLbl.textContent = "Todos:";
	globalWrap.appendChild(globalLbl);

	["P", "C"].forEach(function (tipo) {
		const wrap = document.createElement("div");
		wrap.className = "flex-1";
		const lbl = document.createElement("p");
		lbl.className = "text-xs text-gray-500 mb-1";
		lbl.textContent = tipo === "P" ? "Participación" : "Conducta";
		wrap.appendChild(lbl);
		const btns = document.createElement("div");
		btns.className = "flex gap-1";
		[10, 9, 8, 7, 6, 5].forEach(function (g) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = g;
			btn.className = "text-xs w-9 h-9 rounded-lg font-semibold transition " +
				(g === 10 ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200");
			btn.addEventListener("click", function () {
				// Actualizar visual del setter global
				btns.querySelectorAll("button").forEach(function (b) {
					b.className = "text-xs w-9 h-9 rounded-lg font-semibold transition bg-gray-100 text-gray-600 hover:bg-gray-200";
				});
				btn.className = "text-xs w-9 h-9 rounded-lg font-semibold transition bg-indigo-600 text-white";
				// Aplicar a todos los alumnos
				alumnos.forEach(function (al) {
					califState[al.id][tipo === "P" ? "p" : "c"] = g;
					const key = tipo === "P" ? "p" : "c";
					const row = document.getElementById("calif-row-" + al.id);
					if (!row) return;
					row.querySelectorAll(".grade-btn[data-tipo='" + tipo + "']").forEach(function (b) {
						b.className = "grade-btn text-xs w-9 h-9 rounded-lg font-semibold transition " +
							(parseInt(b.dataset.grade) === g ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200");
					});
				});
			});
			btns.appendChild(btn);
		});
		wrap.appendChild(btns);
		globalWrap.appendChild(wrap);
	});
	califSection.appendChild(globalWrap);

	// Filas por alumno
	alumnos.forEach(function (al) {
		const row = document.createElement("div");
		row.id = "calif-row-" + al.id;
		row.className = "flex items-center gap-2 py-2 border-b border-gray-100 last:border-0";

		const nameWrap = document.createElement("div");
		nameWrap.className = "w-36 shrink-0";
		const name = document.createElement("p");
		name.className = "text-sm text-gray-800 truncate font-medium";
		name.textContent = (al.nombre_completo || "Alumno").split(" ")[0];
		const gBadge = document.createElement("span");
		gBadge.className = "text-xs text-blue-600";
		gBadge.textContent = al.grado ? al.grado + "°" : "";
		nameWrap.appendChild(name);
		nameWrap.appendChild(gBadge);
		row.appendChild(nameWrap);

		["P", "C"].forEach(function (tipo) {
			const wrap = document.createElement("div");
			wrap.className = "flex-1 flex gap-0.5";
			[10, 9, 8, 7, 6, 5].forEach(function (g) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.textContent = g;
				btn.dataset.tipo = tipo;
				btn.dataset.grade = g;
				btn.className = "grade-btn text-xs w-9 h-9 rounded-lg font-semibold transition " +
					(g === 10 ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200");
				btn.addEventListener("click", function () {
					califState[al.id][tipo === "P" ? "p" : "c"] = g;
					wrap.querySelectorAll("button").forEach(function (b) {
						b.className = "grade-btn text-xs w-9 h-9 rounded-lg font-semibold transition bg-gray-100 text-gray-600 hover:bg-gray-200";
						b.dataset.tipo = tipo;
						b.dataset.grade = b.textContent;
					});
					btn.className = "grade-btn text-xs w-9 h-9 rounded-lg font-semibold transition bg-blue-600 text-white";
				});
				wrap.appendChild(btn);
			});
			row.appendChild(wrap);
		});

		califSection.appendChild(row);
	});

	body.appendChild(califSection);

	// Footer
	const footer = document.createElement("div");
	footer.className = "p-5 border-t flex justify-end gap-2 shrink-0";
	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.id = "cancelarCierreBtn";
	cancelBtn.className = "border border-gray-300 text-gray-600 px-4 py-3 rounded-xl";
	cancelBtn.textContent = "Cancelar";
	const confirmBtn = document.createElement("button");
	confirmBtn.type = "button";
	confirmBtn.id = "confirmarCierreBtn";
	confirmBtn.className = "bg-green-600 text-white px-5 py-3 rounded-xl font-semibold";
	confirmBtn.textContent = "Guardar y cerrar";
	footer.appendChild(cancelBtn);
	footer.appendChild(confirmBtn);
	inner.appendChild(footer);

	document.body.appendChild(modal);

	cancelBtn.addEventListener("click", cerrarModalCierre);
	confirmBtn.addEventListener("click", async function () {
		const notas  = document.getElementById("notasCierreInput").value.trim();
		const califs = alumnos.map(function (al) {
			return {
				id:           al.id,
				grado:        al.grado || null,
				participacion: califState[al.id].p,
				conducta:      califState[al.id].c,
			};
		});
		await onConfirm(notas, califs);
	});
}

function cerrarModalCierre() {
	const modal = document.getElementById("modal-cierre-sesion");
	if (modal) {
		modal.remove();
	}
}

function showError(msg) {
	const container = document.getElementById("flowContainer");
	if (!container) {
		return;
	}
	let alert = document.getElementById("flowError");
	if (!alert) {
		alert = document.createElement("div");
		alert.id = "flowError";
		alert.className = "bg-red-100 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm";
		container.prepend(alert);
	}
	alert.textContent = msg;
}

function clearError() {
	const alert = document.getElementById("flowError");
	if (alert) {
		alert.remove();
	}
}

function getLocalDateISO() {
	const now = new Date();
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
	return local.toISOString().slice(0, 10);
}

function formatFechaCorta(date) {
	return date.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getNombreAlumno(alumno) {
	return alumno.nombre_completo || alumno.nombre || "Alumno";
}

function escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
