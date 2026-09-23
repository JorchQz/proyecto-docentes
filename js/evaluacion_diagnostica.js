document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		mostrarError("Supabase no está configurado.");
		return;
	}

	// ── criterios: claves estables del catálogo único (js/catalogo-habilidades.js)
	var CRITERIOS_CUADERNO = window.CatalogoHabilidades.CUADERNO;
	var HABILIDADES_MATES  = window.CatalogoHabilidades.MATEMATICAS;

	var LABEL_MOMENTO = {
		inicio_ciclo: "Inicio de ciclo",
		trimestre_1:  "T1 · boleta",
		trimestre_2:  "T2 · boleta",
		trimestre_3:  "T3 · boleta"
	};

	// Mapeo: trimestre_actual del grupo → momento con el que abre la pantalla.
	// Es el que lee la boleta de ese trimestre (antes abría en el anterior y lo
	// capturado "por defecto" no aparecía en la boleta). Inicio de ciclo sigue a mano.
	var TRIMESTRE_A_MOMENTO = {
		1: "trimestre_1",
		2: "trimestre_2",
		3: "trimestre_3"
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
	var estadoCuaderno = [];  // [{clave, nivel}]
	var estadoMates    = [];  // [{clave, nivel}]
	var comprension    = null;
	var ppm            = null;
	var observaciones  = "";
	var observacionesVaciadas = false; // ver aplicarFila

	// Para debounce de guardado de texto
	var debounceTimer  = null;

	// Conjunto de alumno_ids evaluados en el momento actual
	var evaluadosSet   = new Set();
	var cargaFallida   = false; // no se pudo leer el diagnóstico del alumno: no se guarda
	/*
		El formulario está ligado al alumno cuyos datos muestra DE VERDAD (alumnoEnPantalla),
		no a alumnoIdx: al tocar "Siguiente", alumnoIdx cambia antes de que lleguen los datos
		del siguiente, y un toque en ese lapso guardaba el formulario en blanco encima de su
		diagnóstico. Mientras se cambia de alumno o de momento (cambiando) no se guarda nada
		y los controles quedan bloqueados.
	*/
	var alumnoEnPantalla = null; // { id, momento }
	var cambiando = false;
	var sucio = false;          // hubo cambios sin guardar (sin cambios no se reescribe la fecha)
	var teniaFila = false;      // el alumno en pantalla ya tiene fila guardada en este momento
	var versionCambios = 0;     // sube con cada cambio: uno hecho mientras se guarda sigue pendiente
	var conteoFallido = false;  // no se pudo leer quiénes ya están evaluados

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
			return { clave: c.clave, nivel: null };
		});
		estadoMates = HABILIDADES_MATES.map(function (h) {
			return { clave: h.clave, nivel: null };
		});
		comprension = null;
		ppm         = null;
		observaciones = "";
		observacionesVaciadas = false;
	}

	// Aplica datos de una fila de BD al estado local
	function aplicarFila(fila) {
		if (!fila) return;
		var mapaCuaderno = window.CatalogoHabilidades.aMapa(fila.cuaderno);
		var mapaMates    = window.CatalogoHabilidades.aMapa(fila.matematicas);
		estadoCuaderno.forEach(function (e) { e.nivel = mapaCuaderno[e.clave] || null; });
		estadoMates.forEach(function (e) { e.nivel = mapaMates[e.clave] || null; });
		comprension   = fila.lectura_comprension || null;
		ppm           = fila.lectura_ppm != null ? fila.lectura_ppm : null;
		observaciones = fila.observaciones || "";
		// "" = el maestro vació a propósito el trabajo diario en la boleta (null = nunca lo escribió)
		observacionesVaciadas = fila.observaciones === "";
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
		var grupoActivo = (await window.GrupoActivo.cargar(window.sb, user.id)).grupo;
		var grupoRes = { data: grupoActivo, error: null };

		if (!grupoRes.data) {
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
				.select("alumno_id, cuaderno, matematicas, lectura_ppm, lectura_comprension, observaciones")
				.eq("maestro_id", user.id)
				.eq("grupo_id", grupoId)
				.eq("momento", momentoActual);

			evaluadosSet = new Set();
			// Si falla, el conteo no dice "0 de 8": dice que no se pudo contar
			conteoFallido = !!res.error;
			if (res.error) console.error("evaluacion_diagnostica (conteo):", res.error);
			// Solo cuenta como evaluado quien tiene algo capturado (una fila vaciada no)
			else (res.data || []).forEach(function (row) {
				var algo = (row.cuaderno || []).some(function (c) { return c && c.nivel; }) ||
					(row.matematicas || []).some(function (c) { return c && c.nivel; }) ||
					row.lectura_ppm !== null || !!row.lectura_comprension ||
					!!(row.observaciones && String(row.observaciones).trim());
				if (algo) evaluadosSet.add(row.alumno_id);
			});
		} catch (e) {
			// No bloquear
		}
	}

	// ── cargar datos del alumno actual en el momento ──────────────────────────
	async function cargarAlumnoActual() {
		var alumno = alumnos[alumnoIdx];
		if (!alumno) return;

		alumnoEnPantalla = null;
		sucio = false;
		teniaFila = false;
		resetEstado();
		ocultarMensaje();

		// Si no se pudo leer lo que ya tenía, no se guarda nada: el formulario vacío
		// sobrescribiría todo su diagnóstico con el primer toque
		cargaFallida = false;
		try {
			var res = await window.sb
				.from("evaluacion_diagnostica")
				.select("*")
				.eq("maestro_id", user.id)
				.eq("alumno_id", alumno.id)
				.eq("momento", momentoActual)
				.maybeSingle();

			if (res.error) throw res.error;
			if (res.data) aplicarFila(res.data);
			teniaFila = !!res.data;
			alumnoEnPantalla = { id: alumno.id, momento: momentoActual };
		} catch (e) {
			console.error("evaluacion_diagnostica (lectura):", e);
			cargaFallida = true;
			mostrarError("No se pudo cargar lo que ya tiene este alumno. Recarga la página; mientras tanto no se guarda nada, para no borrar su diagnóstico.");
		}
	}

	// ── upsert completo del alumno actual ─────────────────────────────────────
	/*
		Los guardados van EN SERIE (uno a la vez, como la cola de "Hoy"): cada toque manda el
		diagnóstico completo, y si dos viajan juntos el servidor puede aplicarlos en otro
		orden y dejar uno viejo encima del nuevo. Cada guardado toma el estado de la pantalla
		al momento de salir, así que el último siempre lleva lo más reciente.
		Siempre devuelve true (guardado o nada que guardar) o false (falló).
		forzar = guardar lo pendiente del alumno que se deja (al empezar un cambio).
	*/
	// Como mucho uno en vuelo y UNO esperando: el que espera sale con el estado más reciente,
	// así que los toques que llegan mientras tanto se funden en él (diez toques rápidos no
	// hacen diez guardados en fila que "Siguiente" tendría que esperar)
	var enVuelo = null, enEspera = null;

	// Salir o recargar con un cambio sin guardar (p. ej. el texto antes de la pausa): pregunta
	window.addEventListener("beforeunload", function (e) {
		if (!sucio || cargaFallida) return;
		guardarAlumno(true);
		e.preventDefault();
		e.returnValue = "";
	});
	function guardarAlumno(forzar) {
		if (cambiando && !forzar) return Promise.resolve(true);
		if (enEspera) return enEspera;
		if (!enVuelo) return lanzar();
		enEspera = enVuelo.then(function () {}, function () {}).then(function () {
			enEspera = null;
			return lanzar();
		});
		return enEspera;
	}
	function lanzar() {
		enVuelo = guardarAhora().then(function (r) { enVuelo = null; return r; }, function () { enVuelo = null; return false; });
		return enVuelo;
	}

	async function guardarAhora() {
		var objetivo = alumnoEnPantalla;
		if (!objetivo || cargaFallida || !sucio) return true;
		var version = versionCambios; // los cambios hechos mientras se guarda lo suben

		var tieneAlgo = estadoCuaderno.some(function (e) { return e.nivel; }) ||
			estadoMates.some(function (e) { return e.nivel; }) ||
			comprension || (ppm !== null && ppm !== "") || observaciones.trim(); // un PPM borrado ("") no es dato
		// Sin nada marcado y sin fila guardada no hay nada que guardar. Si ya tenía fila y la
		// maestra lo desmarcó todo, sí se guarda vacío: la base debe decir lo que la pantalla
		if (!tieneAlgo && !teniaFila) { sucio = false; return true; }

		// Si seguía vacío a propósito, se conserva "" para que la boleta no reviva la propuesta
		var obs = observaciones.trim() || (observacionesVaciadas ? "" : null);
		var ppmVal = (ppm !== null && ppm !== "" && !isNaN(parseInt(ppm, 10)))
			? parseInt(ppm, 10) : null;

		try {
			var res = await window.sb
				.from("evaluacion_diagnostica")
				.upsert({
					maestro_id:          user.id,
					alumno_id:           objetivo.id,
					grupo_id:            grupoId,
					momento:             objetivo.momento,
					fecha:               getLocalDateISO(),
					cuaderno:            estadoCuaderno,
					lectura_ppm:         ppmVal,
					lectura_comprension: comprension || null,
					matematicas:         estadoMates,
					observaciones:       obs
				}, { onConflict: "maestro_id,alumno_id,momento" });

			if (res.error) throw res.error;
			// Si hubo otro cambio mientras se guardaba, sigue pendiente
			if (version === versionCambios) sucio = false;
			teniaFila = true;
			if (objetivo.momento === momentoActual) {
				if (tieneAlgo) evaluadosSet.add(objetivo.id); else evaluadosSet.delete(objetivo.id);
			}
			actualizarProgreso();
			return true;
		} catch (e) {
			// No se calla: lo capturado sigue en pantalla y se reintenta con el siguiente cambio
			console.error("Error guardando:", e);
			mostrarError("No se pudo guardar el diagnóstico de este alumno: " + ((e && e.message) || "error desconocido") +
				". Revisa tu conexión; lo capturado sigue en pantalla.");
			return false;
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
			footerProgresoEl.textContent = conteoFallido
				? "No se pudo contar a los evaluados"
				: evaluados + " de " + total + " alumnos evaluados";
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
		// Sin los datos del alumno no se dibuja el formulario vacío (parecería "sin
		// diagnóstico"): queda el aviso
		if (cargaFallida) {
			diagCuerpoEl.innerHTML = '<div class="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">' +
				'No se pudo cargar lo que ya tiene este alumno. Recarga la página; mientras tanto no se muestra ni se guarda nada, para no borrar su diagnóstico.</div>';
			return;
		}
		ocultarMensaje();

		// ── Sección Cuaderno ────────────────────────
		var cuadernoFilas = estadoCuaderno.map(function (item, idx) {
			return buildFilaSemaforo("cuaderno", idx, CRITERIOS_CUADERNO[idx].etiqueta, item.nivel);
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
			return buildFilaSemaforo("mates", idx, HABILIDADES_MATES[idx].etiqueta, item.nivel);
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
			// Lo que se escribe aquí sale tal cual en la boleta para la familia
			(momentoActual.indexOf("trimestre_") === 0
				? '<p class="text-xs text-gray-500">Aparece en la boleta del trimestre como <span class="font-semibold">Trabajo diario</span>, tal como lo escribas.</p>'
				: "") +
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
				if (cambiando) return;
				ppm = inputPPM.value;
				sucio = true; versionCambios++;
				guardarConDebounce();
			});
		}

		if (inputObs) {
			inputObs.addEventListener("input", function () {
				if (cambiando) return;
				observaciones = inputObs.value;
				sucio = true; versionCambios++;
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
		if (!btn || cambiando || !alumnoEnPantalla) return; // cambiando de alumno: el toque no aplica

		var tipo  = btn.dataset.tipo;
		var item  = btn.dataset.item;   // índice (string) o 'comprension'
		var valor = btn.dataset.valor;

		if (tipo === "cuaderno") {
			var idx = parseInt(item, 10);
			if (isNaN(idx) || idx < 0 || idx >= estadoCuaderno.length) return;
			// Toggle
			estadoCuaderno[idx].nivel = (estadoCuaderno[idx].nivel === valor) ? null : valor;
			actualizarBotonesSemaforo("cuaderno", item, estadoCuaderno[idx].nivel);
		} else if (tipo === "lectura") {
			// item === 'comprension'
			comprension = (comprension === valor) ? null : valor;
			actualizarBotonesSemaforo("lectura", "comprension", comprension);
		} else if (tipo === "mates") {
			var midx = parseInt(item, 10);
			if (isNaN(midx) || midx < 0 || midx >= estadoMates.length) return;
			estadoMates[midx].nivel = (estadoMates[midx].nivel === valor) ? null : valor;
			actualizarBotonesSemaforo("mates", item, estadoMates[midx].nivel);
		}

		// Autosave inmediato al tocar semáforo
		sucio = true; versionCambios++;
		await guardarAlumno();
	});

	/*
		Cambio de alumno o de momento: bloquea los controles, guarda lo pendiente del que se
		deja y solo vuelve a permitir capturar cuando el formulario ya muestra los datos del
		nuevo (ver alumnoEnPantalla).
	*/
	async function cambiar(fn) {
		if (cambiando) return;
		cambiando = true;
		diagCuerpoEl.classList.add("opacity-50", "pointer-events-none");
		diagCuerpoEl.querySelectorAll("input, textarea").forEach(function (el) { el.readOnly = true; });
		try {
			clearTimeout(debounceTimer);
			// Si no se pudo guardar al que se deja, no se cambia: se perdería lo capturado
			if (!(await guardarAlumno(true))) return;
			await fn();
		} finally {
			cambiando = false;
			diagCuerpoEl.classList.remove("opacity-50", "pointer-events-none");
		}
	}

	// ── navegar entre alumnos ─────────────────────────────────────────────────
	function irAAlumno(nuevoIdx) {
		if (nuevoIdx < 0 || nuevoIdx >= alumnos.length) return;
		return cambiar(async function () {
			alumnoIdx = nuevoIdx;
			await cargarAlumnoActual();
			actualizarInfoAlumno();
			renderAlumno();
			// Scroll al inicio del contenido
			window.scrollTo({ top: 0, behavior: "smooth" });
		});
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
			await cambiar(async function () {
				momentoActual = nuevoMomento;
				actualizarBotonesMomento();
				await cargarEvaluadosMomento();
				await cargarAlumnoActual();
				actualizarInfoAlumno();
				actualizarProgreso();
				renderAlumno();
			});
		});
	});

	// ── botón finalizar ───────────────────────────────────────────────────────
	if (btnFinalizar) {
		btnFinalizar.addEventListener("click", async function () {
			clearTimeout(debounceTimer);
			if (!(await guardarAlumno(true))) return; // el aviso ya está en pantalla
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
