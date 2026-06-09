document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		mostrarError("Supabase no está configurado.");
		return;
	}

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
	var evalMap     = {};   // clave: alumno_id + "||" + criterio → semaforo
	var obsMap      = {};   // clave: alumno_id + "||" + criterio → observacion
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

	function ocultarMensaje() {
		if (evalMensajeEl) evalMensajeEl.classList.add("hidden");
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
		evalListaEl.innerHTML =
			'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' +
			'Sesión no encontrada. <a href="dashboard.html" class="text-blue-600 underline font-medium">Vuelve al Dashboard.</a>' +
			'</div>';
		return;
	}

	// ── cargar sesión + proyecto ──────────────────────────────────────────────
	try {
		var sesionRes = await window.sb
			.from("sesiones")
			.select("id, numero_sesion, momento, pda_sesion, proyectos(titulo, metodologia, grupo_id)")
			.eq("id", sesionId)
			.eq("maestro_id", userId)
			.single();

		if (sesionRes.error || !sesionRes.data) {
			evalListaEl.innerHTML =
				'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' +
				'Sesión no encontrada o sin permiso. <a href="dashboard.html" class="text-blue-600 underline font-medium">Volver al Dashboard.</a>' +
				'</div>';
			return;
		}
		sesion = sesionRes.data;
	} catch (e) {
		mostrarError("Error al cargar la sesión: " + (e.message || "Error desconocido"));
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

	try {
		var alumnosRes = await window.sb
			.from("alumnos")
			.select("id, nombre_completo, grado, num_lista")
			.eq("grupo_id", proyecto.grupo_id)
			.eq("maestro_id", userId)
			.eq("estatus", "activo")
			.order("num_lista", { ascending: true });

		if (alumnosRes.error) throw alumnosRes.error;
		alumnos = alumnosRes.data || [];
	} catch (e) {
		mostrarError("Error al cargar alumnos: " + (e.message || "Error desconocido"));
		return;
	}

	if (!alumnos.length) {
		evalListaEl.innerHTML =
			'<div class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500 text-sm">' +
			'No hay alumnos activos en este grupo.' +
			'</div>';
		return;
	}

	// ── cargar evaluaciones existentes ────────────────────────────────────────
	try {
		var evalRes = await window.sb
			.from("evaluacion_formativa")
			.select("alumno_id, criterio, semaforo, observacion")
			.eq("sesion_id", sesionId)
			.eq("maestro_id", userId);

		if (!evalRes.error && evalRes.data) {
			evalRes.data.forEach(function (row) {
				var k = mapKey(row.alumno_id, row.criterio);
				evalMap[k] = row.semaforo;
				obsMap[k]  = row.observacion || "";
			});
		}
	} catch (e) {
		// No bloquear si la tabla aún no tiene filas
	}

	// ── obtener criterios por alumno ──────────────────────────────────────────
	var pdaSesion = Array.isArray(sesion.pda_sesion) ? sesion.pda_sesion : [];

	function criteriosParaAlumno(alumno) {
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

	// ── guardar semáforo (upsert inmediato) ───────────────────────────────────
	async function guardarSemaforo(alumnoId, criterio, semaforo) {
		var obs = obsMap[mapKey(alumnoId, criterio)] || "";
		try {
			var res = await window.sb
				.from("evaluacion_formativa")
				.upsert({
					maestro_id:  userId,
					sesion_id:   sesionId,
					alumno_id:   alumnoId,
					criterio:    criterio,
					semaforo:    semaforo,
					observacion: obs,
					fecha:       getLocalDateISO()
				}, { onConflict: "maestro_id,sesion_id,alumno_id,criterio" });

			if (res.error) {
				console.error("Error guardando semáforo:", res.error);
			}
		} catch (e) {
			console.error("Error guardando semáforo:", e);
		}
	}

	// ── guardar observación (upsert al salir del campo) ───────────────────────
	async function guardarObservacion(alumnoId, criterio, observacion) {
		var semaforo = evalMap[mapKey(alumnoId, criterio)] || null;
		if (!semaforo) return; // No guardar obs si no hay semáforo seleccionado
		try {
			await window.sb
				.from("evaluacion_formativa")
				.upsert({
					maestro_id:  userId,
					sesion_id:   sesionId,
					alumno_id:   alumnoId,
					criterio:    criterio,
					semaforo:    semaforo,
					observacion: observacion,
					fecha:       getLocalDateISO()
				}, { onConflict: "maestro_id,sesion_id,alumno_id,criterio" });
		} catch (e) {
			console.error("Error guardando observación:", e);
		}
	}

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

	// ── renderizar lista de alumnos ───────────────────────────────────────────
	function renderLista() {
		evalListaEl.innerHTML = "";
		ocultarMensaje();

		alumnos.forEach(function (alumno) {
			var criterios  = criteriosParaAlumno(alumno);
			var gradoLabel = alumno.grado ? alumno.grado + "° grado" : "";

			var criteriosHtml = criterios.map(function (crit) {
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

			var card = document.createElement("div");
			card.className = "bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3";
			card.innerHTML =
				'<div class="flex items-center gap-2 pb-1 border-b border-gray-100">' +
				'<span class="text-sm font-bold text-gray-800">' + escHtml(alumno.nombre_completo || "Alumno") + '</span>' +
				(gradoLabel ? '<span class="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">' + escHtml(gradoLabel) + '</span>' : '') +
				'</div>' +
				'<div class="flex flex-col gap-3">' + criteriosHtml + '</div>';

			evalListaEl.appendChild(card);
		});

		actualizarContadores();
		actualizarProgreso();
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
	evalListaEl.addEventListener("click", async function (e) {
		var btn = e.target.closest("button[data-alumno]");
		if (!btn) return;

		var alumnoId = btn.dataset.alumno;
		var criterio = btn.dataset.criterio;
		var valor    = btn.dataset.valor;
		var k        = mapKey(alumnoId, criterio);

		// Toggle: si ya está seleccionado, deseleccionar
		if (evalMap[k] === valor) {
			delete evalMap[k];
		} else {
			evalMap[k] = valor;
		}

		// Re-renderizar solo la tarjeta del alumno afectado
		var alumno = alumnos.find(function (a) { return a.id === alumnoId; });
		if (alumno) {
			var cardVieja = btn.closest(".bg-white.rounded-2xl");
			if (cardVieja) {
				// Reconstruir innerHTML de la sección de criterios
				var criterios  = criteriosParaAlumno(alumno);
				var criteriosHtml = criterios.map(function (crit) {
					var ck      = mapKey(alumno.id, crit.key);
					var actual  = evalMap[ck] || null;
					var obsVal  = obsMap[ck] || "";

					function btnClass(v) {
						var base = "flex-1 min-h-[48px] rounded-xl text-sm font-semibold transition-colors focus:outline-none active:scale-95 ";
						if (actual === v) {
							if (v === "logrado")          return base + "bg-emerald-500 text-white shadow-sm";
							if (v === "en_proceso")       return base + "bg-amber-400 text-white shadow-sm";
							if (v === "requiere_apoyo")   return base + "bg-red-500 text-white shadow-sm";
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

				var seccionCriterios = cardVieja.querySelector(".flex.flex-col.gap-3");
				if (seccionCriterios) seccionCriterios.innerHTML = criteriosHtml;
			}
		}

		actualizarContadores();
		actualizarProgreso();

		// Autosave inmediato
		if (evalMap[k]) {
			await guardarSemaforo(alumnoId, criterio, evalMap[k]);
		}
	});

	// ── guardar observación al perder el foco ─────────────────────────────────
	evalListaEl.addEventListener("blur", async function (e) {
		var ta = e.target.closest("textarea[data-obs-alumno]");
		if (!ta) return;
		var alumnoId = ta.dataset.obsAlumno;
		var criterio = ta.dataset.obsCriterio;
		var obs      = ta.value.trim();
		var k        = mapKey(alumnoId, criterio);
		obsMap[k]    = obs;
		await guardarObservacion(alumnoId, criterio, obs);
	}, true); // captura para que blur funcione en delegación

	// ── botón finalizar ───────────────────────────────────────────────────────
	if (btnFinalizar) {
		btnFinalizar.addEventListener("click", function () {
			window.location.href = "dashboard.html";
		});
	}

	// ── primer render ─────────────────────────────────────────────────────────
	renderLista();

	// Ajustar padding top del contenido dinámicamente según altura del header evaluación
	(function ajustarPadding() {
		var navbar    = document.getElementById("app-navbar");
		var evalHdr   = document.getElementById("evalHeader");
		var contenido = document.querySelector(".max-w-4xl.mx-auto.px-4");
		if (!navbar || !evalHdr || !contenido) return;
		var navH  = navbar.offsetHeight;
		var evalH = evalHdr.offsetHeight;
		// El header evalHeader ya tiene top-14 (56px navbar), calculamos el offset total
		contenido.style.paddingTop = (navH + evalH + 8) + "px";
	})();
});
