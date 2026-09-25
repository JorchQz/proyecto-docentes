/*
	evaluacion_formativa.js — Semáforo por PDA de una sesión (Afinar evaluación por PDA).

	Lecturas por la capa común (js/lectura.js): si la sesión, los alumnos, lo ya evaluado
	o los PDA de la sesión no se pudieron leer, la página se detiene con el aviso "No se
	pudo cargar" (antes decía "Sesión no encontrada" cuando la lectura había fallado).

	Guardado: cada semáforo (alumno + criterio) se guarda en su propia cola en serie y
	cada guardado manda el estado MÁS RECIENTE de la pantalla, así que dos toques rápidos
	no llegan en desorden. Volver a tocar el semáforo marcado lo QUITA y se borra en la
	base (antes solo se quitaba de la pantalla). Si un guardado falla, el semáforo vuelve a
	lo que tiene la base y se avisa. Salir con algo sin guardar: se guarda antes de salir
	por un enlace y el navegador pregunta al cerrar o recargar.
*/

document.addEventListener("DOMContentLoaded", function () {
	if (!window.sb) return;
	window.Lectura.arrancar(iniciarEvaluacionFormativa);
});

async function iniciarEvaluacionFormativa() {
	// ── elementos del DOM ────────────────────────────────────────────────────
	var headerTituloEl    = document.getElementById("headerTitulo");
	var headerMomentoEl   = document.getElementById("headerMomento");
	var headerSesionEl    = document.getElementById("headerSesion");
	var cntLogradoEl      = document.getElementById("cntLogrado");
	var cntEnProcesoEl    = document.getElementById("cntEnProceso");
	var cntRequiereEl     = document.getElementById("cntRequiereApoyo");
	var evalListaEl       = document.getElementById("evalLista");
	var evalMensajeEl     = document.getElementById("evalMensaje");
	var footerProgresoEl  = document.getElementById("footerProgreso");
	var footerBarraEl     = document.getElementById("footerBarra");
	var btnFinalizar      = document.getElementById("btnFinalizar");

	// ── estado ───────────────────────────────────────────────────────────────
	var sesionId    = null;
	var sesion      = null;
	var alumnos     = [];
	var evalMap     = {};   // clave: alumno_id + "||" + criterio → semaforo (lo que muestra la pantalla)
	var obsMap      = {};   // clave: alumno_id + "||" + criterio → observacion
	var enBase      = {};   // clave → { semaforo, observacion } que tiene la base
	var userId      = null;

	var CRITERIO_GENERICO = "Participación en la sesión";

	// ── helpers ──────────────────────────────────────────────────────────────
	function getLocalDateISO() {
		var now   = new Date();
		var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	function mapKey(alumnoId, criterio) {
		return alumnoId + "||" + criterio;
	}

	function mostrarError(msg) {
		if (!evalMensajeEl) return;
		evalMensajeEl.className = "rounded-lg px-4 py-3 text-sm font-medium bg-red-50 text-red-700 border border-red-200";
		evalMensajeEl.textContent = msg;
		evalMensajeEl.classList.remove("hidden");
	}

	function mostrarInfo(msg) {
		if (!evalMensajeEl) return;
		evalMensajeEl.className = "rounded-lg px-4 py-3 text-sm font-medium bg-blue-50 text-blue-800 border border-blue-200";
		evalMensajeEl.textContent = msg;
		evalMensajeEl.classList.remove("hidden");
	}

	function ocultarMensaje() {
		if (evalMensajeEl) evalMensajeEl.classList.add("hidden");
	}

	function vacio(html) {
		evalListaEl.innerHTML =
			'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' + html + '</div>';
	}

	// Etiqueta legible del momento metodológico
	var MOMENTOS = {
		"inicio":      "Inicio",
		"presentemos": "Presentemos",
		"hagamos":     "Hagamos",
		"apliquemos":  "Apliquemos",
		"evaluacion":  "Evaluación",
		"cierre":      "Cierre"
	};
	function labelMomento(m) {
		return (m && MOMENTOS[m.toLowerCase()]) ? MOMENTOS[m.toLowerCase()] : (m || "");
	}

	// ── auth ─────────────────────────────────────────────────────────────────
	var authResult = await window.sb.auth.getUser();
	if (authResult.error || !authResult.data.user) {
		window.location.href = "index.html";
		return;
	}
	userId = authResult.data.user.id;

	// ── leer sesion_id de URL ────────────────────────────────────────────────
	var params = new URLSearchParams(window.location.search);
	sesionId   = params.get("sesion_id");

	if (!sesionId) {
		vacio('Sesión no encontrada. <a href="dashboard.html" class="text-blue-600 underline font-medium">Vuelve al Dashboard.</a>');
		return;
	}

	// ── cargar sesión + proyecto ──────────────────────────────────────────────
	// Si la lectura falla, lanza (la página se detiene); "no encontrada" es solo cuando la
	// lectura funcionó y la sesión no existe o no es de este maestro
	sesion = await window.Lectura.uno(window.sb
		.from("sesiones")
		.select("id, numero_sesion, momento, pda_sesion, proyectos(titulo, metodologia, grupo_id)")
		.eq("id", sesionId)
		.eq("maestro_id", userId)
		.maybeSingle());

	if (!sesion) {
		vacio('Sesión no encontrada o sin permiso. <a href="dashboard.html" class="text-blue-600 underline font-medium">Volver al Dashboard.</a>');
		return;
	}

	// Rellenar header
	var proyecto = sesion.proyectos || {};
	if (headerTituloEl) {
		headerTituloEl.textContent = (proyecto.titulo || "Proyecto sin título") +
			" — Sesión " + (sesion.numero_sesion || "");
	}
	if (headerMomentoEl) {
		headerMomentoEl.textContent = labelMomento(sesion.momento);
	}
	if (headerSesionEl) {
		headerSesionEl.textContent = proyecto.metodologia || "";
	}

	// ── cargar alumnos ────────────────────────────────────────────────────────
	if (!proyecto.grupo_id) {
		mostrarError("El proyecto no tiene grupo asociado.");
		return;
	}

	alumnos = (await window.Lectura.uno(window.sb
		.from("alumnos")
		.select("id, nombre_completo, grado, num_lista")
		.eq("grupo_id", proyecto.grupo_id)
		.eq("maestro_id", userId)
		.eq("estatus", "activo")
		.order("num_lista", { ascending: true }))) || [];

	if (!alumnos.length) {
		vacio("No hay alumnos activos en este grupo.");
		return;
	}

	// ── cargar evaluaciones existentes ────────────────────────────────────────
	// Sin las evaluaciones guardadas la cuadrícula saldría vacía y se capturaría encima: lanza
	var evaluadas = await window.Lectura.uno(window.sb
		.from("evaluacion_formativa")
		.select("alumno_id, criterio, semaforo, observacion")
		.eq("sesion_id", sesionId)
		.eq("maestro_id", userId));
	(evaluadas || []).forEach(function (row) {
		var k = mapKey(row.alumno_id, row.criterio);
		evalMap[k] = row.semaforo;
		obsMap[k]  = row.observacion || "";
		enBase[k]  = { semaforo: row.semaforo, observacion: row.observacion || "" };
	});

	// ── obtener criterios por alumno ──────────────────────────────────────────
	var pdaSesion = Array.isArray(sesion.pda_sesion) ? sesion.pda_sesion : [];

	// ── cargar sesiones_pda (trazabilidad por ID) ─────────────────────────────
	// Cada evaluación nueva se liga a la fila exacta de sesiones_pda; si la sesión
	// es anterior a la trazabilidad, se crean las filas ahora desde el jsonb
	// pda_sesion (backfill perezoso) para nunca guardar una evaluación sin ID.
	// Si no se pudo leer, lanza: el backfill crearía filas repetidas
	var sesionesPda = (await window.Lectura.uno(window.sb
		.from("sesiones_pda")
		.select("id, pda_id, grado, criterio_aplicado")
		.eq("sesion_id", sesionId))) || [];

	if (!sesionesPda.length && pdaSesion.length) {
		var filasBackfill = pdaSesion
			.map(function (p) {
				var grado = parseInt(p.grado, 10);
				if (Number.isNaN(grado)) return null;
				return {
					sesion_id: sesionId,
					pda_id: p.pda_id || null,
					grado: grado,
					criterio_aplicado: p.criterio_aplicado || null
				};
			})
			.filter(Boolean);
		if (filasBackfill.length) {
			var insSpda = await window.sb
				.from("sesiones_pda")
				.insert(filasBackfill)
				.select("id, pda_id, grado, criterio_aplicado");
			if (insSpda.error) {
				// Sin esas filas las evaluaciones se guardarían sin su PDA: no se captura
				console.error("Backfill de sesiones_pda:", insSpda.error);
				mostrarError("No se pudieron preparar los PDA de esta sesión. Recarga la página para intentarlo de nuevo.");
				return;
			}
			sesionesPda = insSpda.data || [];
		}
	}

	// clave grado+criterio → id de sesiones_pda, para el upsert
	var spdaIdPorClave = {};
	sesionesPda.forEach(function (spda) {
		var info = pdaSesion.find(function (p) {
			return String(p.grado) === String(spda.grado) &&
				((spda.pda_id && p.pda_id === spda.pda_id) ||
				 (!spda.pda_id && (p.criterio_aplicado || null) === (spda.criterio_aplicado || null)));
		});
		var texto = spda.criterio_aplicado ||
			(info && (info.criterio_aplicado || info.pda_texto)) || CRITERIO_GENERICO;
		spdaIdPorClave[spda.grado + "||" + texto] = spda.id;
	});

	function resolverSesionPdaId(alumnoId, criterio) {
		var alumno = alumnos.find(function (a) { return a.id === alumnoId; });
		if (!alumno) return null;
		return spdaIdPorClave[alumno.grado + "||" + criterio] || null;
	}

	function criteriosParaAlumno(alumno) {
		// Preferir las filas de sesiones_pda (tienen ID); el jsonb queda de respaldo
		var propiosSpda = sesionesPda.filter(function (spda) {
			return String(spda.grado) === String(alumno.grado);
		});
		if (propiosSpda.length) {
			return propiosSpda.map(function (spda) {
				var info = pdaSesion.find(function (p) {
					return String(p.grado) === String(spda.grado) &&
						((spda.pda_id && p.pda_id === spda.pda_id) ||
						 (!spda.pda_id && (p.criterio_aplicado || null) === (spda.criterio_aplicado || null)));
				});
				var texto = spda.criterio_aplicado ||
					(info && (info.criterio_aplicado || info.pda_texto)) || CRITERIO_GENERICO;
				return { texto: texto, key: texto };
			});
		}

		// Filtrar por grado del alumno
		var propios = pdaSesion.filter(function (pda) {
			return String(pda.grado) === String(alumno.grado);
		});

		if (propios.length === 0 || pdaSesion.length === 0) {
			// Criterio genérico
			return [{ texto: CRITERIO_GENERICO, key: CRITERIO_GENERICO }];
		}

		return propios.map(function (pda) {
			return {
				texto: pda.criterio_aplicado || pda.pda_texto || CRITERIO_GENERICO,
				key:   pda.criterio_aplicado || pda.pda_texto || CRITERIO_GENERICO
			};
		});
	}

	// ── guardado en serie por semáforo ────────────────────────────────────────
	var colaPorClave = {};  // clave → última promesa de su cola
	var enVuelo = 0;

	/*
		Guarda el estado ACTUAL de la pantalla para (alumno, criterio): con semáforo, upsert
		(con su observación); sin semáforo, borra la fila. Devuelve true/false.
	*/
	function guardar(alumnoId, criterio) {
		var k = mapKey(alumnoId, criterio);
		enVuelo++;
		var p = (colaPorClave[k] || Promise.resolve(true)).then(function () {
			return guardarAhora(alumnoId, criterio);
		});
		colaPorClave[k] = p;
		return p.then(function (r) { enVuelo--; return r; });
	}

	async function guardarAhora(alumnoId, criterio) {
		var k = mapKey(alumnoId, criterio);
		var semaforo = evalMap[k] || null;
		var obs = obsMap[k] || "";
		var base = enBase[k] || null;
		// Nada cambió respecto a la base
		if ((!semaforo && !base) || (base && semaforo === base.semaforo && obs === base.observacion)) return true;
		try {
			var res;
			if (semaforo) {
				res = await window.sb
					.from("evaluacion_formativa")
					.upsert({
						maestro_id:    userId,
						sesion_id:     sesionId,
						alumno_id:     alumnoId,
						criterio:      criterio,
						sesion_pda_id: resolverSesionPdaId(alumnoId, criterio),
						semaforo:      semaforo,
						observacion:   obs,
						fecha:         getLocalDateISO(),
						// Lo que el maestro ajusta aquí deja de ser automático: el motor
						// de propagación (B.5) ya no lo vuelve a pisar.
						origen:        "maestro"
					}, { onConflict: "sesion_id,alumno_id,criterio" });
			} else {
				// Quitar el semáforo lo quita también de la base
				res = await window.sb
					.from("evaluacion_formativa")
					.delete()
					.eq("sesion_id", sesionId)
					.eq("alumno_id", alumnoId)
					.eq("criterio", criterio)
					.eq("maestro_id", userId);
			}
			if (res.error) throw res.error;
			if (semaforo) enBase[k] = { semaforo: semaforo, observacion: obs }; else delete enBase[k];
			return true;
		} catch (e) {
			// No se calla y la pantalla vuelve a lo que tiene la base: nada parece guardado sin estarlo
			console.error("Error guardando semáforo:", e);
			if (base) { evalMap[k] = base.semaforo; } else { delete evalMap[k]; }
			redibujarAlumno(alumnoId);
			actualizarContadores();
			actualizarProgreso();
			mostrarError("No se pudo guardar: " + ((e && e.message) || "error desconocido") +
				". Revisa tu conexión; la pantalla muestra lo que sí está guardado.");
			return false;
		}
	}

	// Observaciones escritas que aún no se guardan (el cuadro no ha perdido el foco)
	function sincronizarObservaciones() {
		var claves = [];
		evalListaEl.querySelectorAll("textarea[data-obs-alumno]").forEach(function (ta) {
			var k = mapKey(ta.dataset.obsAlumno, ta.dataset.obsCriterio);
			var v = ta.value.trim();
			if (v !== (obsMap[k] || "")) { obsMap[k] = v; claves.push([ta.dataset.obsAlumno, ta.dataset.obsCriterio]); }
		});
		return claves;
	}

	function observacionesSinSemaforo() {
		return Object.keys(obsMap).some(function (k) { return obsMap[k] && !evalMap[k] && !(enBase[k]); });
	}

	function hayPendiente() {
		if (enVuelo > 0) return true;
		var sucio = false;
		evalListaEl.querySelectorAll("textarea[data-obs-alumno]").forEach(function (ta) {
			var k = mapKey(ta.dataset.obsAlumno, ta.dataset.obsCriterio);
			var guardada = enBase[k] ? enBase[k].observacion : "";
			if (ta.value.trim() !== guardada) sucio = true;
		});
		return sucio;
	}

	// Guarda todo lo pendiente; true si ya no queda nada sin guardar
	async function guardarTodo() {
		sincronizarObservaciones();
		var claves = Object.keys(obsMap).concat(Object.keys(evalMap)).filter(function (k, i, a) { return a.indexOf(k) === i; });
		var resultados = await Promise.all(claves.map(function (k) {
			var partes = k.split("||");
			return guardar(partes[0], partes.slice(1).join("||"));
		}));
		return resultados.every(Boolean) && !observacionesSinSemaforo();
	}

	window.Lectura.antesDeSalir({
		pendiente: hayPendiente,
		guardar: guardarTodo,
		mensaje: function () {
			return observacionesSinSemaforo()
				? "Hay una observación sin semáforo: solo se guarda cuando eliges Logrado, En proceso o Requiere apoyo. ¿Salir de todos modos?"
				: "No se pudo guardar lo último que capturaste. ¿Salir de todos modos?";
		},
	});

	// ── contadores del header ─────────────────────────────────────────────────
	function actualizarContadores() {
		var logrado = 0, enProceso = 0, requiere = 0;
		Object.values(evalMap).forEach(function (v) {
			if (v === "logrado")          logrado++;
			else if (v === "en_proceso")  enProceso++;
			else if (v === "requiere_apoyo") requiere++;
		});
		if (cntLogradoEl)   cntLogradoEl.textContent   = logrado;
		if (cntEnProcesoEl) cntEnProcesoEl.textContent  = enProceso;
		if (cntRequiereEl)  cntRequiereEl.textContent   = requiere;
	}

	// ── progreso en footer ────────────────────────────────────────────────────
	function actualizarProgreso() {
		// Un alumno está "evaluado" si tiene al menos 1 semáforo asignado
		var evaluados = alumnos.filter(function (a) {
			var criterios = criteriosParaAlumno(a);
			return criterios.some(function (c) {
				return !!evalMap[mapKey(a.id, c.key)];
			});
		}).length;

		var total = alumnos.length;
		var pct   = total > 0 ? Math.round((evaluados / total) * 100) : 0;

		if (footerProgresoEl) {
			footerProgresoEl.textContent = evaluados + " de " + total + " alumnos evaluados";
		}
		if (footerBarraEl) {
			footerBarraEl.style.width = pct + "%";
		}
	}

	// ── renderizar ────────────────────────────────────────────────────────────
	function htmlCriterios(alumno) {
		return criteriosParaAlumno(alumno).map(function (crit) {
			var k        = mapKey(alumno.id, crit.key);
			var actual   = evalMap[k] || null;
			var obsVal   = obsMap[k] || "";

			function btnClass(valor) {
				var base = "flex-1 min-h-[48px] rounded-xl text-sm font-semibold transition-colors focus:outline-none active:scale-95 ";
				if (actual === valor) {
					if (valor === "logrado")          return base + "bg-emerald-500 text-white shadow-sm";
					if (valor === "en_proceso")       return base + "bg-amber-400 text-white shadow-sm";
					if (valor === "requiere_apoyo")   return base + "bg-red-500 text-white shadow-sm";
				}
				return base + "bg-gray-100 text-gray-600 hover:bg-gray-200";
			}

			return (
				'<div class="flex flex-col gap-2 pb-3 border-b border-gray-100 last:border-0 last:pb-0">' +
				'<p class="text-xs text-gray-500 leading-snug">' + escHtml(crit.texto) + '</p>' +
				'<div class="flex gap-2">' +
				'<button type="button" data-alumno="' + alumno.id + '" data-criterio="' + escAttr(crit.key) + '" data-valor="logrado" ' +
				'class="' + btnClass("logrado") + '">Logrado</button>' +
				'<button type="button" data-alumno="' + alumno.id + '" data-criterio="' + escAttr(crit.key) + '" data-valor="en_proceso" ' +
				'class="' + btnClass("en_proceso") + '">En proceso</button>' +
				'<button type="button" data-alumno="' + alumno.id + '" data-criterio="' + escAttr(crit.key) + '" data-valor="requiere_apoyo" ' +
				'class="' + btnClass("requiere_apoyo") + '">Requiere apoyo</button>' +
				'</div>' +
				'<textarea data-obs-alumno="' + alumno.id + '" data-obs-criterio="' + escAttr(crit.key) + '" ' +
				'rows="2" placeholder="Observación opcional..." ' +
				'class="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none placeholder-gray-400">' +
				escHtml(obsVal) +
				'</textarea>' +
				'</div>'
			);
		}).join("");
	}

	function renderLista() {
		evalListaEl.innerHTML = "";
		ocultarMensaje();

		alumnos.forEach(function (alumno) {
			var gradoLabel = alumno.grado ? alumno.grado + "° grado" : "";
			var card = document.createElement("div");
			card.className = "bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3";
			card.dataset.tarjetaAlumno = alumno.id;
			card.innerHTML =
				'<div class="flex items-center gap-2 pb-1 border-b border-gray-100">' +
				'<span class="text-sm font-bold text-gray-800">' + escHtml(alumno.nombre_completo || "Alumno") + '</span>' +
				(gradoLabel ? '<span class="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">' + escHtml(gradoLabel) + '</span>' : '') +
				'</div>' +
				'<div class="flex flex-col gap-3" data-criterios>' + htmlCriterios(alumno) + '</div>';

			evalListaEl.appendChild(card);
		});

		actualizarContadores();
		actualizarProgreso();
	}

	// Vuelve a dibujar los semáforos de un alumno (conserva lo escrito en sus observaciones)
	function redibujarAlumno(alumnoId) {
		var alumno = alumnos.find(function (a) { return a.id === alumnoId; });
		var card = evalListaEl.querySelector('[data-tarjeta-alumno="' + alumnoId + '"]');
		if (!alumno || !card) return;
		sincronizarObservaciones();
		var seccion = card.querySelector("[data-criterios]");
		if (seccion) seccion.innerHTML = htmlCriterios(alumno);
	}

	// ── escapado básico ───────────────────────────────────────────────────────
	function escHtml(s) {
		return String(s || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}
	function escAttr(s) {
		return String(s || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// ── delegación de eventos sobre la lista ─────────────────────────────────
	evalListaEl.addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-alumno]");
		if (!btn) return;

		var alumnoId = btn.dataset.alumno;
		var criterio = btn.dataset.criterio;
		var valor    = btn.dataset.valor;
		var k        = mapKey(alumnoId, criterio);

		// Toggle: si ya está seleccionado, se quita (y se borra en la base)
		if (evalMap[k] === valor) {
			delete evalMap[k];
		} else {
			evalMap[k] = valor;
		}

		ocultarMensaje();
		redibujarAlumno(alumnoId);
		actualizarContadores();
		actualizarProgreso();
		guardar(alumnoId, criterio);
	});

	// ── guardar observación al perder el foco ─────────────────────────────────
	evalListaEl.addEventListener("blur", function (e) {
		var ta = e.target.closest("textarea[data-obs-alumno]");
		if (!ta) return;
		var alumnoId = ta.dataset.obsAlumno;
		var criterio = ta.dataset.obsCriterio;
		var k        = mapKey(alumnoId, criterio);
		obsMap[k]    = ta.value.trim();
		if (!evalMap[k]) {
			if (obsMap[k]) mostrarInfo("La observación se guarda cuando eliges un semáforo (Logrado, En proceso o Requiere apoyo).");
			return;
		}
		guardar(alumnoId, criterio);
	}, true); // captura para que blur funcione en delegación

	// ── botón finalizar ───────────────────────────────────────────────────────
	if (btnFinalizar) {
		btnFinalizar.addEventListener("click", async function () {
			btnFinalizar.disabled = true;
			var bien = await guardarTodo();
			btnFinalizar.disabled = false;
			if (!bien && !window.confirm(observacionesSinSemaforo()
				? "Hay una observación sin semáforo: solo se guarda cuando eliges un semáforo. ¿Salir de todos modos?"
				: "No se pudo guardar lo último que capturaste. ¿Salir de todos modos?")) return;
			window.location.href = "dashboard.html";
		});
	}

	// ── primer render ─────────────────────────────────────────────────────────
	renderLista();

	// El contenido empieza justo bajo el encabezado fijo de la evaluación, que va bajo la
	// barra de Mi Salón (y, en PC, bajo la fila del selector de secciones). Se mide la
	// posición real del encabezado: su alto cambia con el ancho (el título se parte) y con
	// la fila del selector. Antes se buscaba el contenido por sus clases y se tomaba la fila
	// de la barra de Mi Salón, que crecía y tapaba el encabezado.
	function ajustarPadding() {
		var evalHdr   = document.getElementById("evalHeader");
		var contenido = document.getElementById("evalContenido");
		if (!evalHdr || !contenido) return;
		contenido.style.paddingTop = "0px";
		var inicio = contenido.getBoundingClientRect().top + window.scrollY;
		var abajo  = evalHdr.getBoundingClientRect().bottom; // fijo: su lugar en la ventana
		contenido.style.paddingTop = Math.max(16, Math.ceil(abajo - inicio + 16)) + "px";
	}
	ajustarPadding();
	window.addEventListener("resize", ajustarPadding);
}
