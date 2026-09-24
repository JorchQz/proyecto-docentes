/*
	asistencia.js — Pase de lista de un día (la pantalla de Asistencia).

	Misma regla que "Hoy" (decisión 8 de Jorge, 2026-09-24): cada alumno tiene tres
	opciones, Presente, Falta y Justificada, y un alumno SIN MARCAR queda sin registro
	(no es falta). Solo se guarda lo que la maestra toca:
	  - tocar una opción la guarda para ese alumno y ese día (una fila en asistencias);
	  - volver a tocar la opción marcada la quita: el alumno queda sin registro y su fila
	    se borra de la base;
	  - "Presentes los que faltan" marca como presentes solo a quienes siguen sin registro.
	Antes la casilla sin marcar se guardaba como falta y cada toque guardaba a TODO el grupo.

	Cada toque es un guardado propio que lleva su fecha y su alumno, en una cola en serie
	(como la de "Hoy"). Así cambiar de fecha con un guardado pendiente ya no puede mandar la
	lista del día nuevo (antes el autoguardado salía después y tomaba la fecha nueva).
	Si un guardado falla, el alumno vuelve a lo que está en la base y se avisa: la pantalla
	nunca muestra como guardado algo que no lo está.

	Una falta (o justificada) retira el cierre del día que se puso por defecto (1 y 1),
	igual que en "Hoy": quien faltó no tiene participación ni conducta ese día.

	Toda lectura va por la capa común (js/lectura.js): si una falla, la página se detiene
	con el aviso "No se pudo cargar" y no se dibuja ni se guarda nada.
*/

document.addEventListener("DOMContentLoaded", function () {
	if (!window.sb) return;

	var OPCIONES = [
		{ valor: "presente",    etiqueta: "Presente",    activo: "bg-emerald-500 text-white" },
		{ valor: "ausente",     etiqueta: "Falta",       activo: "bg-red-500 text-white" },
		{ valor: "justificada", etiqueta: "Justificada", activo: "bg-blue-500 text-white" },
	];

	var fechaInput = document.getElementById("attendanceDateInput");
	var resumenEl = document.getElementById("attendanceSummary");
	var listaEl = document.getElementById("attendanceList");
	var mensajeEl = document.getElementById("attendanceMessage");
	var estadoEl = document.getElementById("attendanceSaveState");
	var todosPresentesBtn = document.getElementById("markAllPresentBtn");

	var userId = null;
	var grupo = null;
	var alumnos = [];
	var hoyIso = fechaLocalISO(new Date());
	var fecha = hoyIso;
	var marcado = {};      // alumno_id → estado en pantalla (sin clave = sin registro)
	var enBase = {};       // alumno_id → estado que tiene la base para `fecha`
	var cargando = true;   // mientras se lee un día no se captura
	var cargaId = 0;       // una lectura vieja (cambio rápido de fecha) no pisa a la nueva

	// ── Cola de guardado en serie ─────────────────────────────────────────────
	var cola = [], procesando = false, pendientes = 0, esperando = [];

	function encolar(tarea) {
		cola.push(tarea);
		pendientes++;
		estado("Guardando...");
		procesar();
	}

	async function procesar() {
		if (procesando) return;
		procesando = true;
		while (cola.length) {
			var tarea = cola[0];
			try {
				await tarea.correr();
				if (tarea.bien) tarea.bien();
			} catch (e) {
				console.error("asistencia: guardado fallido", e);
				if (tarea.mal) tarea.mal(e);
			}
			cola.shift();
			pendientes = Math.max(0, pendientes - 1);
		}
		procesando = false;
		estado(null);
		esperando.splice(0).forEach(function (r) { r(); });
	}

	function colaVacia() {
		if (!pendientes && !procesando) return Promise.resolve();
		return new Promise(function (r) { esperando.push(r); });
	}

	// Salir con un guardado en vuelo: se espera a que termine (o pregunta al cerrar)
	window.Lectura.antesDeSalir({
		pendiente: function () { return pendientes > 0; },
		guardar: function () { return colaVacia().then(function () { return true; }); },
	});

	// ── Guardar un alumno (o varios) en un día ────────────────────────────────
	/*
		cambios: [{ alumnoId, estado }] con estado null = quitar el registro.
		Todos del mismo día `dia` (el que estaba en pantalla al tocar).
	*/
	function guardar(dia, cambios) {
		encolar({
			correr: async function () {
				var borrar = cambios.filter(function (c) { return !c.estado; }).map(function (c) { return c.alumnoId; });
				var poner = cambios.filter(function (c) { return c.estado; });
				if (borrar.length) {
					var del = await window.sb.from("asistencias").delete()
						.eq("maestro_id", userId).eq("grupo_id", grupo.id).eq("fecha", dia).in("alumno_id", borrar);
					if (del.error) throw del.error;
				}
				if (poner.length) {
					var up = await window.sb.from("asistencias").upsert(poner.map(function (c) {
						return { maestro_id: userId, grupo_id: grupo.id, alumno_id: c.alumnoId, fecha: dia, asistencia_estado: c.estado };
					}), { onConflict: "grupo_id,alumno_id,fecha" });
					if (up.error) throw up.error;
				}
			},
			bien: function () {
				if (dia === fecha) {
					cambios.forEach(function (c) {
						if (c.estado) enBase[c.alumnoId] = c.estado; else delete enBase[c.alumnoId];
					});
				}
				var faltaron = cambios.filter(function (c) { return c.estado === "ausente" || c.estado === "justificada"; });
				if (faltaron.length) retirarCierre(dia, faltaron);
			},
			mal: function (e) {
				if (dia !== fecha) {
					mensaje("error", "No se guardó un cambio de asistencia del " + fechaUI(dia) + ": " + textoError(e) + ". Revisa ese día.");
					return;
				}
				// Vuelve a lo que tiene la base, salvo que ya haya otro cambio en la cola para ese alumno
				cambios.forEach(function (c) {
					var otro = cola.some(function (t, i) { return i > 0 && t.dia === dia && t.ids.indexOf(c.alumnoId) !== -1; });
					if (otro) return;
					if (enBase[c.alumnoId]) marcado[c.alumnoId] = enBase[c.alumnoId]; else delete marcado[c.alumnoId];
				});
				dibujar();
				mensaje("error", "No se pudo guardar la asistencia: " + textoError(e) + ". Revisa tu conexión y vuelve a marcarla; la lista muestra lo que sí está guardado.");
			},
			dia: dia,
			ids: cambios.map(function (c) { return c.alumnoId; }),
		});
	}

	// Quien faltó no tiene cierre ese día: se retira solo el 1 y 1 que se puso por defecto;
	// una excepción capturada a mano en "Hoy" se queda. faltaron: [{ alumnoId, estado }]
	function retirarCierre(dia, faltaron) {
		var alumnoIds = faltaron.map(function (c) { return c.alumnoId; });
		encolar({
			correr: async function () {
				var res = await window.sb.from("registro_diario").delete()
					.eq("maestro_id", userId).eq("fecha", dia)
					.in("alumno_id", alumnoIds).eq("participacion", 1).eq("conducta", 1);
				if (res.error) throw res.error;
			},
			mal: function (e) {
				mensaje("error", avisoCierreSinQuitar(dia, faltaron, textoError(e)));
			},
			dia: dia,
			ids: [],
		});
	}

	/*
		Qué hacer si la falta se guardó pero su cierre del día no se pudo quitar. Volver a
		tocar la opción marcada la QUITA (queda sin registro), así que "vuelve a marcarla"
		no bastaba: hay que tocarla dos veces (quitarla y marcarla de nuevo), y eso vuelve a
		intentar quitar el cierre. Se dice de quién, qué día y qué botón.
	*/
	function avisoCierreSinQuitar(dia, faltaron, error) {
		var nombres = faltaron.map(function (c) {
			var al = alumnos.filter(function (a) { return a.id === c.alumnoId; })[0];
			return al && al.nombre_completo ? al.nombre_completo : "un alumno";
		});
		var estados = {};
		faltaron.forEach(function (c) { estados[c.estado] = true; });
		var boton = estados.ausente && estados.justificada ? "Falta o Justificada, la que tenga marcada,"
			: (estados.justificada ? "Justificada" : "Falta");
		var quien = nombres.length === 1 ? nombres[0] : nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1];
		return "La " + (estados.ausente ? "falta" : "falta justificada") + " de " + quien + " del " + fechaUI(dia) + " se guardó, " +
			"pero no se pudo quitar su participación y conducta de ese día: " + error + ". Cuando tengas conexión, " +
			"en ese día toca " + boton + " dos veces en " + (nombres.length === 1 ? "su renglón" : "el renglón de cada uno") +
			": el primer toque la quita y el segundo la vuelve a marcar y quita su participación y conducta.";
	}

	// ── Carga ─────────────────────────────────────────────────────────────────
	async function cargarDia() {
		var id = ++cargaId;
		cargando = true;
		listaEl.innerHTML = "<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Cargando...</div>";
		resumenEl.textContent = "Cargando...";
		// Lo que se tocó y sigue en la cola se guarda antes de leer (si se vuelve a ese día,
		// la lectura ya lo trae)
		await colaVacia();
		var filas = await window.Lectura.uno(window.sb.from("asistencias")
			.select("alumno_id, asistencia_estado")
			.eq("maestro_id", userId)
			.eq("grupo_id", grupo.id)
			.eq("fecha", fecha));
		if (id !== cargaId) return;
		var activos = {};
		alumnos.forEach(function (a) { activos[a.id] = true; });
		marcado = {};
		enBase = {};
		(filas || []).forEach(function (f) {
			if (!activos[f.alumno_id]) return;
			marcado[f.alumno_id] = f.asistencia_estado;
			enBase[f.alumno_id] = f.asistencia_estado;
		});
		cargando = false;
		dibujar();
	}

	// ── Dibujo ────────────────────────────────────────────────────────────────
	function dibujar() {
		if (!alumnos.length) {
			listaEl.innerHTML = "<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>" +
				"Este grupo todavía no tiene alumnos. Agrégalos en Mi grupo.</div>";
			resumenEl.textContent = (grupo.nombre || "Grupo activo") + " | 0 alumnos";
			if (todosPresentesBtn) todosPresentesBtn.disabled = true;
			return;
		}
		listaEl.innerHTML = alumnos.map(function (al) {
			var chips = OPCIONES.map(function (op) {
				var activo = marcado[al.id] === op.valor;
				return "<button type='button' data-alumno='" + esc(al.id) + "' data-valor='" + op.valor + "' aria-pressed='" + activo + "' " +
					"class='min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors " +
					(activo ? op.activo : "bg-gray-100 text-gray-600 hover:bg-gray-200") + "'>" + op.etiqueta + "</button>";
			}).join("");
			return "<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-gray-200 px-4 py-3'>" +
				"<div class='flex items-center gap-3 min-w-0'>" +
				"<span class='inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-100 px-2 text-xs font-semibold text-gray-700'>" +
				(typeof al.num_lista === "number" ? al.num_lista : "-") + "</span>" +
				"<span class='truncate text-sm md:text-base text-gray-800'>" + esc(al.nombre_completo || "Alumno sin nombre") + "</span>" +
				(marcado[al.id] ? "" : "<span class='shrink-0 text-xs text-gray-400'>sin registro</span>") +
				"</div><div class='flex flex-wrap gap-2'>" + chips + "</div></div>";
		}).join("");
		resumen();
	}

	function resumen() {
		var c = { presente: 0, ausente: 0, justificada: 0 };
		var sin = 0;
		alumnos.forEach(function (a) {
			if (marcado[a.id] && c[marcado[a.id]] !== undefined) c[marcado[a.id]]++; else sin++;
		});
		resumenEl.textContent = (grupo.nombre || "Grupo activo") +
			" | Presentes: " + c.presente + " | Faltas: " + c.ausente + " | Justificadas: " + c.justificada +
			" | Sin registro: " + sin + " | Total: " + alumnos.length;
		if (todosPresentesBtn) todosPresentesBtn.disabled = sin === 0;
	}

	// ── Toques ────────────────────────────────────────────────────────────────
	listaEl.addEventListener("click", function (e) {
		var btn = e.target.closest ? e.target.closest("button[data-alumno]") : null;
		if (!btn || cargando) return;
		var alumnoId = btn.dataset.alumno;
		// Volver a tocar la opción marcada la quita: sin registro
		var nuevo = marcado[alumnoId] === btn.dataset.valor ? null : btn.dataset.valor;
		if (nuevo) marcado[alumnoId] = nuevo; else delete marcado[alumnoId];
		clearMensaje();
		dibujar();
		guardar(fecha, [{ alumnoId: alumnoId, estado: nuevo }]);
	});

	if (todosPresentesBtn) {
		todosPresentesBtn.addEventListener("click", function () {
			if (cargando) return;
			var cambios = alumnos.filter(function (a) { return !marcado[a.id]; })
				.map(function (a) { return { alumnoId: a.id, estado: "presente" }; });
			if (!cambios.length) return;
			cambios.forEach(function (c) { marcado[c.alumnoId] = "presente"; });
			clearMensaje();
			dibujar();
			guardar(fecha, cambios);
		});
	}

	if (fechaInput) {
		fechaInput.value = fecha;
		fechaInput.max = hoyIso;
		fechaInput.addEventListener("change", function () {
			if (!fechaInput.value || fechaInput.value > hoyIso) { fechaInput.value = fecha; return; }
			if (fechaInput.value === fecha) return;
			fecha = fechaInput.value;
			clearMensaje();
			window.Lectura.arrancar(cargarDia);
		});
	}

	// ── Arranque ──────────────────────────────────────────────────────────────
	window.Lectura.arrancar(async function () {
		var ses = await window.sb.auth.getSession();
		if (ses.error || !ses.data.session) { window.location.href = "index.html"; return; }
		userId = ses.data.session.user.id;

		grupo = (await window.GrupoActivo.cargar(window.sb, userId)).grupo;
		if (!grupo) { window.location.href = "onboarding.html"; return; }

		// Como en "Hoy": un alumno dado de baja no pasa lista
		alumnos = await window.Lectura.uno(window.sb.from("alumnos")
			.select("id, nombre_completo, num_lista")
			.eq("maestro_id", userId)
			.eq("grupo_id", grupo.id)
			.eq("estatus", "activo")
			.order("num_lista", { ascending: true })
			.order("nombre_completo", { ascending: true })) || [];

		if (!alumnos.length) { cargando = false; dibujar(); return; }
		await cargarDia();
	});

	// ── Ayudantes ─────────────────────────────────────────────────────────────
	function estado(texto) {
		if (!estadoEl) return;
		estadoEl.textContent = texto || "";
		estadoEl.classList.toggle("hidden", !texto);
	}

	function mensaje(tipo, texto) {
		if (!mensajeEl) return;
		mensajeEl.textContent = texto;
		mensajeEl.className = "rounded-lg px-4 py-3 text-sm " + (tipo === "error" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800");
	}

	function clearMensaje() {
		if (!mensajeEl) return;
		mensajeEl.textContent = "";
		mensajeEl.className = "hidden rounded-lg px-4 py-3 text-sm";
	}

	function textoError(e) {
		return (e && e.message) || "error desconocido";
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function fechaLocalISO(d) {
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}

	function fechaUI(iso) {
		var p = (iso || "").split("-");
		return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
	}
});
