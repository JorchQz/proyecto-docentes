document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		mostrarError("Supabase no está configurado.");
		return;
	}

	// ── criterios fijos ──────────────────────────────────────────────────────
	var CRITERIOS_CUADERNO = [
		"Orden y limpieza",
		"Escribe fecha completa",
		"Escribe título de actividad",
		"Letra legible",
		"Uso correcto de mayúsculas/minúsculas",
		"Signos de puntuación",
		"Acentuación",
		"Buen estado de la libreta",
		"Orden por proyecto",
		"Respeta margen"
	];

	var HABILIDADES_MATES = [
		"Suma",
		"Resta",
		"Multiplicación",
		"División",
		"Fracciones",
		"Tablas de multiplicar",
		"Lectura y escritura de cantidades",
		"Problemas matemáticos"
	];

	var LABEL_MOMENTO = {
		inicio_ciclo: "Inicio de ciclo",
		trimestre_1:  "Fin T1",
		trimestre_2:  "Fin T2",
		trimestre_3:  "Fin T3"
	};

	// Mapeo: trimestre_actual del grupo → momento correspondiente
	var TRIMESTRE_A_MOMENTO = {
		1: "inicio_ciclo",
		2: "trimestre_1",
		3: "trimestre_2"
	};

	// ── elementos del DOM ────────────────────────────────────────────────────
	var diagMensajeEl    = document.getElementById("diagMensaje");
	var diagCuerpoEl     = document.getElementById("diagCuerpo");
	var alumnoNombreEl   = document.getElementById("alumnoNombre");
	var alumnoSubtituloEl= document.getElementById("alumnoSubtitulo");
	var btnAnterior      = document.getElementById("btnAnterior");
	var btnSiguiente     = document.getElementById("btnSiguiente");
	var footerProgresoEl = document.getElementById("footerProgreso");
	var footerBarraEl    = document.getElementById("footerBarra");
	var btnFinalizar     = document.getElementById("btnFinalizar");
	var mainContent      = document.getElementById("mainContent");
	var momentoBar       = document.getElementById("momentoBar");

	// ── estado ───────────────────────────────────────────────────────────────
	var user          = null;
	var grupoId       = null;
	var alumnos       = [];
	var alumnoIdx     = 0;   // índice en el array alumnos
	var momentoActual = "inicio_ciclo";

	// Datos del alumno actual en pantalla:
	var estadoCuaderno = [];  // [{criterio, semaforo}]
	var estadoMates    = [];  // [{habilidad, semaforo}]
	var comprension    = null;
	var ppm            = null;
	var observaciones  = "";

	// Para debounce de guardado de texto
	var debounceTimer  = null;

	// Conjunto de alumno_ids evaluados en el momento actual
	var evaluadosSet   = new Set();

	// ── helpers ──────────────────────────────────────────────────────────────
	function getLocalDateISO() {
		var now   = new Date();
		var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	function escHtml(s) {
		return String(s || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function mostrarError(msg) {
		if (!diagMensajeEl) return;
		diagMensajeEl.className = "rounded-lg px-4 py-3 text-sm font-medium bg-red-50 text-red-700 border border-red-200";
		diagMensajeEl.textContent = msg;
		diagMensajeEl.classList.remove("hidden");
	}

	function mostrarToast(msg) {
		if (!diagMensajeEl) return;
		diagMensajeEl.className = "rounded-lg px-4 py-3 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200";
		diagMensajeEl.textContent = msg;
		diagMensajeEl.classList.remove("hidden");
		setTimeout(function () { diagMensajeEl.classList.add("hidden"); }, 2000);
	}

	function ocultarMensaje() {
		if (diagMensajeEl) diagMensajeEl.classList.add("hidden");
	}

	// Inicializa arrays de estado vacíos para el alumno actual
	function resetEstado() {
		estadoCuaderno = CRITERIOS_CUADERNO.map(function (c) {
			return { criterio: c, semaforo: null };
		});
		estadoMates = HABILIDADES_MATES.map(function (h) {
			return { habilidad: h, semaforo: null };
		});
		comprension = null;
		ppm         = null;
		observaciones = "";
	}

	// Aplica datos de una fila de BD al estado local
	function aplicarFila(fila) {
		if (!fila) return;
		// Cuaderno
		if (Array.isArray(fila.cuaderno)) {
			fila.cuaderno.forEach(function (item) {
				var found = estadoCuaderno.find(function (e) { return e.criterio === item.criterio; });
				if (found) found.semaforo = item.semaforo || null;
			});
		}
		// Matemáticas
		if (Array.isArray(fila.matematicas)) {
			fila.matematicas.forEach(function (item) {
				var found = estadoMates.find(function (e) { return e.habilidad === item.habilidad; });
				if (found) found.semaforo = item.semaforo || null;
			});
		}
		comprension   = fila.lectura_comprension || null;
		ppm           = fila.lectura_ppm != null ? fila.lectura_ppm : null;
		observaciones = fila.observaciones || "";
	}

	// ── auth ─────────────────────────────────────────────────────────────────
	var authResult = await window.sb.auth.getUser();
	if (authResult.error || !authResult.data.user) {
		window.location.href = "index.html";
		return;
	}
	user = authResult.data.user;

	// ── cargar grupo del maestro ──────────────────────────────────────────────
	try {
		var grupoRes = await window.sb
			.from("grupos")
			.select("id, trimestre_actual")
			.eq("maestro_id", user.id)
			.limit(1)
			.single();

		if (grupoRes.error || !grupoRes.data) {
			diagCuerpoEl.innerHTML =
				'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' +
				'No tienes un grupo configurado. <a href="onboarding.html" class="text-blue-600 underline font-medium">Crear grupo</a>' +
				'</div>';
			return;
		}

		grupoId = grupoRes.data.id;
		// Elegir momento inicial según trimestre_actual
		var trimActual = grupoRes.data.trimestre_actual;
		momentoActual  = TRIMESTRE_A_MOMENTO[trimActual] || "inicio_ciclo";
	} catch (e) {
		mostrarError("Error al cargar el grupo: " + (e.message || "Error desconocido"));
		return;
	}

	// ── cargar alumnos activos ────────────────────────────────────────────────
	try {
		var alumnosRes = await window.sb
			.from("alumnos")
			.select("id, nombre_completo, grado, num_lista")
			.eq("grupo_id", grupoId)
			.eq("maestro_id", user.id)
			.eq("estatus", "activo")
			.order("num_lista", { ascending: true });

		if (alumnosRes.error) throw alumnosRes.error;
		alumnos = alumnosRes.data || [];
	} catch (e) {
		mostrarError("Error al cargar alumnos: " + (e.message || "Error desconocido"));
		return;
	}

	if (!alumnos.length) {
		diagCuerpoEl.innerHTML =
			'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' +
			'No hay alumnos activos en este grupo.' +
			'</div>';
		return;
	}

	// ── ajustar padding del contenido según la barra fija ────────────────────
	function ajustarPadding() {
		var navbar  = document.getElementById("app-navbar");
		var momBar  = momentoBar;
		if (!navbar || !momBar || !mainContent) return;
		var totalH  = navbar.offsetHeight + momBar.offsetHeight;
		mainContent.style.paddingTop = (totalH + 12) + "px";
	}

	// ── activar botones de momento ────────────────────────────────────────────
	function actualizarBotonesMomento() {
		document.querySelectorAll(".momento-btn").forEach(function (btn) {
			var m = btn.dataset.momento;
			if (m === momentoActual) {
				btn.className = "momento-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] bg-emerald-500 text-white";
			} else {
				btn.className = "momento-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] bg-blue-700 text-blue-100 hover:bg-blue-600";
			}
		});
	}

	// ── cargar evaluaciones del momento actual (para saber cuáles están evaluados)
	async function cargarEvaluadosMomento() {
		try {
			var res = await window.sb
				.from("evaluacion_diagnostica")
				.select("alumno_id")
				.eq("maestro_id", user.id)
				.eq("grupo_id", grupoId)
				.eq("momento", momentoActual);

			evaluadosSet = new Set();
			if (!res.error && res.data) {
				res.data.forEach(function (row) { evaluadosSet.add(row.alumno_id); });
			}
		} catch (e) {
			// No bloquear
		}
	}

	// ── cargar datos del alumno actual en el momento ──────────────────────────
	async function cargarAlumnoActual() {
		var alumno = alumnos[alumnoIdx];
		if (!alumno) return;

		resetEstado();
		ocultarMensaje();

		try {
			var res = await window.sb
				.from("evaluacion_diagnostica")
				.select("*")
				.eq("maestro_id", user.id)
				.eq("alumno_id", alumno.id)
				.eq("momento", momentoActual)
				.maybeSingle();

			if (!res.error && res.data) {
				aplicarFila(res.data);
			}
		} catch (e) {
			// Sin datos previos, comenzar limpio
		}
	}

	// ── upsert completo del alumno actual ─────────────────────────────────────
	async function guardarAlumno() {
		var alumno = alumnos[alumnoIdx];
		if (!alumno) return;

		// Solo guardar si hay al menos 1 dato
		var tieneAlgo = estadoCuaderno.some(function (e) { return e.semaforo; }) ||
			estadoMates.some(function (e) { return e.semaforo; }) ||
			comprension || ppm != null || observaciones.trim();
		if (!tieneAlgo) return;

		var obs = observaciones.trim() || null;
		var ppmVal = (ppm !== null && ppm !== "" && !isNaN(parseInt(ppm, 10)))
			? parseInt(ppm, 10) : null;

		try {
			var res = await window.sb
				.from("evaluacion_diagnostica")
				.upsert({
					maestro_id:          user.id,
					alumno_id:           alumno.id,
					grupo_id:            grupoId,
					momento:             momentoActual,
					fecha:               getLocalDateISO(),
					cuaderno:            estadoCuaderno,
					lectura_ppm:         ppmVal,
					lectura_comprension: comprension || null,
					matematicas:         estadoMates,
					observaciones:       obs
				}, { onConflict: "maestro_id,alumno_id,momento" });

			if (res.error) {
				console.error("Error guardando:", res.error);
			} else {
				evaluadosSet.add(alumno.id);
				actualizarProgreso();
			}
		} catch (e) {
			console.error("Error guardando:", e);
		}
	}

	// Debounce para campos de texto
	function guardarConDebounce() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(guardarAlumno, 800);
	}

	// ── progreso en footer ────────────────────────────────────────────────────
	function actualizarProgreso() {
		var total     = alumnos.length;
		var evaluados = evaluadosSet.size;
		var pct       = total > 0 ? Math.round((evaluados / total) * 100) : 0;
		if (footerProgresoEl) {
			footerProgresoEl.textContent = evaluados + " de " + total + " alumnos evaluados";
		}
		if (footerBarraEl) {
			footerBarraEl.style.width = pct + "%";
		}
	}

	// ── actualizar info del alumno en la barra ────────────────────────────────
	function actualizarInfoAlumno() {
		var alumno = alumnos[alumnoIdx];
		if (!alumno) return;
		var total = alumnos.length;
		if (alumnoNombreEl) {
			alumnoNombreEl.textContent = "Alumno " + (alumnoIdx + 1) + " de " + total + " — " + (alumno.nombre_completo || "Sin nombre");
		}
		if (alumnoSubtituloEl) {
			alumnoSubtituloEl.textContent = alumno.grado ? alumno.grado + "° grado" : "";
		}
		// Botones prev/next
		if (btnAnterior) btnAnterior.disabled = alumnoIdx === 0;
		if (btnSiguiente) btnSiguiente.disabled = alumnoIdx === total - 1;
	}

	// ── generador de botones semáforo ─────────────────────────────────────────
	// tipo: 'cuaderno' | 'lectura' | 'mates'
	// idx: índice en el array o identificador
	// actual: valor actual ('logrado'|'en_proceso'|'requiere_apoyo'|null)
	function buildSemaforoBtn(tipo, itemKey, valor, actual) {
		var labels = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
		var base   = "flex-1 min-h-[44px] rounded-xl text-sm font-semibold transition-colors focus:outline-none active:scale-95 ";
		var cls;
		if (actual === valor) {
			if (valor === "logrado")          cls = base + "bg-emerald-500 text-white shadow-sm";
			else if (valor === "en_proceso")  cls = base + "bg-amber-400 text-white shadow-sm";
			else                               cls = base + "bg-red-500 text-white shadow-sm";
		} else {
			cls = base + "bg-gray-100 text-gray-600 hover:bg-gray-200";
		}
		return '<button type="button" ' +
			'data-tipo="' + tipo + '" ' +
			'data-item="' + escHtml(String(itemKey)) + '" ' +
			'data-valor="' + valor + '" ' +
			'class="' + cls + '">' +
			labels[valor] + '</button>';
	}

	function buildFilaSemaforo(tipo, itemKey, label, actual) {
		return (
			'<div class="flex flex-col gap-1.5">' +
			'<p class="text-xs text-gray-600 font-medium leading-snug">' + escHtml(label) + '</p>' +
			'<div class="flex gap-2">' +
			buildSemaforoBtn(tipo, itemKey, "logrado",          actual) +
			buildSemaforoBtn(tipo, itemKey, "en_proceso",       actual) +
			buildSemaforoBtn(tipo, itemKey, "requiere_apoyo",   actual) +
			'</div>' +
			'</div>'
		);
	}

	// ── renderizar el cuerpo del alumno actual ────────────────────────────────
	function renderAlumno() {
		ocultarMensaje();

		// ── Sección Cuaderno ────────────────────────
		var cuadernoFilas = estadoCuaderno.map(function (item, idx) {
			return buildFilaSemaforo("cuaderno", idx, item.criterio, item.semaforo);
		}).join("");

		var cuadernoHtml =
			'<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">' +
			'<h2 class="text-sm font-bold text-gray-800 flex items-center gap-2">' +
			'<span class="inline-block w-2 h-2 rounded-full bg-blue-500"></span>Cuaderno' +
			'</h2>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">' +
			cuadernoFilas +
			'</div>' +
			'</div>';

		// ── Sección Lectura ─────────────────────────
		var lecturaHtml =
			'<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">' +
			'<h2 class="text-sm font-bold text-gray-800 flex items-center gap-2">' +
			'<span class="inline-block w-2 h-2 rounded-full bg-amber-400"></span>Lectura' +
			'</h2>' +
			'<div class="flex flex-col gap-3">' +
			'<div class="flex flex-col gap-1.5">' +
			'<label class="text-xs text-gray-600 font-medium">PPM (palabras por minuto)</label>' +
			'<input id="inputPPM" type="text" inputmode="numeric" ' +
			'value="' + (ppm != null ? escHtml(String(ppm)) : "") + '" ' +
			'placeholder="Ej: 45" ' +
			'class="w-full max-w-[160px] rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-300 focus:outline-none placeholder-gray-400">' +
			'</div>' +
			buildFilaSemaforo("lectura", "comprension", "Comprensión lectora", comprension) +
			'</div>' +
			'</div>';

		// ── Sección Matemáticas ─────────────────────
		var matesFilas = estadoMates.map(function (item, idx) {
			return buildFilaSemaforo("mates", idx, item.habilidad, item.semaforo);
		}).join("");

		var matesHtml =
			'<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">' +
			'<h2 class="text-sm font-bold text-gray-800 flex items-center gap-2">' +
			'<span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>Matemáticas' +
			'</h2>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">' +
			matesFilas +
			'</div>' +
			'</div>';

		// ── Sección Observaciones ───────────────────
		var obsHtml =
			'<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2">' +
			'<h2 class="text-sm font-bold text-gray-800 flex items-center gap-2">' +
			'<span class="inline-block w-2 h-2 rounded-full bg-gray-400"></span>Observaciones' +
			'</h2>' +
			'<textarea id="inputObs" rows="3" ' +
			'placeholder="Observaciones sobre este alumno..." ' +
			'class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none placeholder-gray-400">' +
			escHtml(observaciones) +
			'</textarea>' +
			'</div>';

		diagCuerpoEl.innerHTML = cuadernoHtml + lecturaHtml + matesHtml + obsHtml;

		// Atar listeners a los campos de texto después del render
		var inputPPM = document.getElementById("inputPPM");
		var inputObs = document.getElementById("inputObs");

		if (inputPPM) {
			inputPPM.addEventListener("input", function () {
				ppm = inputPPM.value;
				guardarConDebounce();
			});
		}

		if (inputObs) {
			inputObs.addEventListener("input", function () {
				observaciones = inputObs.value;
				guardarConDebounce();
			});
		}
	}

	// ── actualizar semáforos en pantalla sin re-renderizar todo ──────────────
	// tipo: 'cuaderno'|'lectura'|'mates', itemKey: índice o string
	function actualizarBotonesSemaforo(tipo, itemKey, nuevoValor) {
		var btns = diagCuerpoEl.querySelectorAll(
			'button[data-tipo="' + tipo + '"][data-item="' + itemKey + '"]'
		);
		btns.forEach(function (btn) {
			var v    = btn.dataset.valor;
			var base = "flex-1 min-h-[44px] rounded-xl text-sm font-semibold transition-colors focus:outline-none active:scale-95 ";
			if (nuevoValor === v) {
				if (v === "logrado")          btn.className = base + "bg-emerald-500 text-white shadow-sm";
				else if (v === "en_proceso")  btn.className = base + "bg-amber-400 text-white shadow-sm";
				else                           btn.className = base + "bg-red-500 text-white shadow-sm";
			} else {
				btn.className = base + "bg-gray-100 text-gray-600 hover:bg-gray-200";
			}
		});
	}

	// ── delegar clicks de semáforo en el cuerpo ───────────────────────────────
	diagCuerpoEl.addEventListener("click", async function (e) {
		var btn = e.target.closest("button[data-tipo][data-item][data-valor]");
		if (!btn) return;

		var tipo  = btn.dataset.tipo;
		var item  = btn.dataset.item;   // índice (string) o 'comprension'
		var valor = btn.dataset.valor;

		if (tipo === "cuaderno") {
			var idx = parseInt(item, 10);
			if (isNaN(idx) || idx < 0 || idx >= estadoCuaderno.length) return;
			// Toggle
			estadoCuaderno[idx].semaforo = (estadoCuaderno[idx].semaforo === valor) ? null : valor;
			actualizarBotonesSemaforo("cuaderno", item, estadoCuaderno[idx].semaforo);
		} else if (tipo === "lectura") {
			// item === 'comprension'
			comprension = (comprension === valor) ? null : valor;
			actualizarBotonesSemaforo("lectura", "comprension", comprension);
		} else if (tipo === "mates") {
			var midx = parseInt(item, 10);
			if (isNaN(midx) || midx < 0 || midx >= estadoMates.length) return;
			estadoMates[midx].semaforo = (estadoMates[midx].semaforo === valor) ? null : valor;
			actualizarBotonesSemaforo("mates", item, estadoMates[midx].semaforo);
		}

		// Autosave inmediato al tocar semáforo
		await guardarAlumno();
	});

	// ── navegar entre alumnos ─────────────────────────────────────────────────
	async function irAAlumno(nuevoIdx) {
		if (nuevoIdx < 0 || nuevoIdx >= alumnos.length) return;
		// Guardar antes de cambiar (texto pendiente)
		clearTimeout(debounceTimer);
		await guardarAlumno();
		alumnoIdx = nuevoIdx;
		await cargarAlumnoActual();
		actualizarInfoAlumno();
		renderAlumno();
		// Scroll al inicio del contenido
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	if (btnAnterior) {
		btnAnterior.addEventListener("click", function () {
			irAAlumno(alumnoIdx - 1);
		});
	}

	if (btnSiguiente) {
		btnSiguiente.addEventListener("click", function () {
			irAAlumno(alumnoIdx + 1);
		});
	}

	// ── cambiar momento ───────────────────────────────────────────────────────
	document.querySelectorAll(".momento-btn").forEach(function (btn) {
		btn.addEventListener("click", async function () {
			var nuevoMomento = btn.dataset.momento;
			if (nuevoMomento === momentoActual) return;
			// Guardar estado actual antes de cambiar
			clearTimeout(debounceTimer);
			await guardarAlumno();
			momentoActual = nuevoMomento;
			actualizarBotonesMomento();
			await cargarEvaluadosMomento();
			await cargarAlumnoActual();
			actualizarInfoAlumno();
			actualizarProgreso();
			renderAlumno();
		});
	});

	// ── botón finalizar ───────────────────────────────────────────────────────
	if (btnFinalizar) {
		btnFinalizar.addEventListener("click", async function () {
			clearTimeout(debounceTimer);
			await guardarAlumno();
			window.location.href = "dashboard.html";
		});
	}

	// ── inicialización ────────────────────────────────────────────────────────
	actualizarBotonesMomento();
	await cargarEvaluadosMomento();
	await cargarAlumnoActual();
	actualizarInfoAlumno();
	actualizarProgreso();
	renderAlumno();

	// Ajustar padding después de que la navbar y la barra de momento están en el DOM
	setTimeout(ajustarPadding, 100);
	window.addEventListener("resize", ajustarPadding);
});
