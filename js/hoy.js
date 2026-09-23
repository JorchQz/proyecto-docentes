/*
	hoy.js — Pantalla "Hoy" (Parte B, §B.1): el orden del día del maestro en una sola
	pantalla con scroll. Lo que ya revisa de todos modos se captura al toque y alimenta
	solo la boleta (el cálculo vive en js/motor-calificacion.js).

		1. Asistencia            → asistencias (presente / ausente / justificada)
		2. Tareas por revisar    → calificaciones de productos tipo 'tarea' vencidos
		3. Sesiones de hoy       → calificaciones de los productos de cada sesión del día
		4. Cierre del día        → registro_diario (participación y conducta 0 · 1 · 2)

	Reglas que esta pantalla respeta:
	  - La unidad de captura es el PRODUCTO de la sesión, no la actividad.
	  - El semáforo es lo visible; el puntaje 0-10 es un ajuste fino opcional.
	  - Participación y conducta se capturan UNA vez al día y son globales: el reparto
	    a los campos formativos lo hace el motor con las sesiones de ese día (§B.4).
	  - Multigrado: un alumno solo ve los productos cuyos `grados` incluyen el suyo.
	  - Todo se guarda al toque, sin botón "guardar": UI optimista + cola con reintento.
*/

document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { window.location.href = "index.html"; return; }

	// ── Estado ────────────────────────────────────────────────────────────────
	var user = null, grupo = null, alumnos = [];
	var hoy = getLocalDateISO();
	var asistencia = {};      // alumno_id -> estado
	var registro = {};        // alumno_id -> {participacion, conducta}
	var calificaciones = {};  // alumno_id|producto_id -> fila de calificaciones
	var tareas = [], sesionesHoy = [], productosPorSesion = {};
	var detallesAbiertos = {}; // qué paneles de detalle quedan abiertos entre renders

	var NIVELES = [
		{ valor: "logrado",        etiqueta: "Logrado",        activo: "bg-emerald-500 text-white" },
		{ valor: "en_proceso",     etiqueta: "En proceso",     activo: "bg-amber-400 text-white" },
		{ valor: "requiere_apoyo", etiqueta: "Requiere apoyo", activo: "bg-red-500 text-white" },
	];
	var ENTREGA_TAREA = [
		{ valor: "entregado",    etiqueta: "Entregó",     activo: "bg-emerald-500 text-white" },
		{ valor: "incompleto",   etiqueta: "Incompleta",  activo: "bg-amber-400 text-white" },
		{ valor: "no_entregado", etiqueta: "No entregó",  activo: "bg-red-500 text-white" },
		{ valor: "justificado",  etiqueta: "Justificada", activo: "bg-blue-500 text-white" },
	];
	var ASISTENCIA = [
		{ valor: "presente",    etiqueta: "Presente",    activo: "bg-emerald-500 text-white" },
		{ valor: "ausente",     etiqueta: "Falta",       activo: "bg-red-500 text-white" },
		{ valor: "justificada", etiqueta: "Justificada", activo: "bg-blue-500 text-white" },
	];
	var RETRO_RAPIDA = ["Excelente trabajo", "Incompleto", "Mejorar letra", "Revisar ortografía", "No trajo material"];

	function getLocalDateISO() {
		var ahora = new Date();
		var local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function mensaje(tipo, texto) {
		var el = document.getElementById("hoyMensaje");
		if (!el) return;
		if (!texto) { el.classList.add("hidden"); return; }
		el.className = "rounded-xl px-4 py-3 text-sm " +
			(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200"
			                  : "bg-blue-50 text-blue-800 border border-blue-200");
		el.textContent = texto;
		el.classList.remove("hidden");
	}

	function vacio(texto) {
		return "<p class='text-sm text-gray-400 py-2'>" + esc(texto) + "</p>";
	}

	/*
		Cola de guardado: la UI no espera a la red. Cada cambio entra a la cola y se
		reintenta con espera creciente; si la red no vuelve, el aviso queda en pantalla
		y no se pierde nada de lo capturado (sigue en memoria y en la cola).
	*/
	var cola = [], procesando = false, pendientes = 0;

	function estadoGuardado(texto, tipo) {
		var el = document.getElementById("hoyEstadoGuardado");
		if (!el) return;
		if (!texto) { el.classList.add("hidden"); return; }
		el.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full px-4 py-2 text-sm font-medium shadow-lg " +
			(tipo === "error" ? "bg-red-600 text-white"
			 : tipo === "ok"  ? "bg-emerald-600 text-white" : "bg-gray-800 text-white");
		el.textContent = texto;
		el.classList.remove("hidden");
		if (tipo === "ok") setTimeout(function () { if (!pendientes) el.classList.add("hidden"); }, 1200);
	}

	function encolar(tarea) {
		cola.push(tarea);
		pendientes++;
		estadoGuardado("Guardando...", "info");
		procesarCola();
	}

	async function procesarCola() {
		if (procesando) return;
		procesando = true;
		while (cola.length) {
			var tarea = cola[0];
			var intento = 0, ok = false;
			while (intento < 4 && !ok) {
				try {
					await tarea();
					ok = true;
				} catch (e) {
					intento++;
					console.error("hoy: guardado fallido (intento " + intento + ")", e);
					if (intento >= 4) {
						estadoGuardado("Sin conexión. Se reintentará al tocar otra vez.", "error");
						cola.shift();
						pendientes = Math.max(0, pendientes - 1);
						procesando = false;
						return;
					}
					await new Promise(function (r) { setTimeout(r, 400 * intento); });
				}
			}
			cola.shift();
			pendientes = Math.max(0, pendientes - 1);
		}
		procesando = false;
		estadoGuardado("Guardado", "ok");
	}

	// ── Carga inicial ─────────────────────────────────────────────────────────
	var authRes = await window.sb.auth.getUser();
	if (authRes.error || !authRes.data.user) { window.location.href = "index.html"; return; }
	user = authRes.data.user;

	var grupoRes = await window.sb.from("grupos")
		.select("id, nombre, grados, es_multigrado, trimestre_actual")
		.eq("maestro_id", user.id).order("created_at", { ascending: true }).limit(1);
	grupo = (grupoRes.data || [])[0];
	if (!grupo) { window.location.href = "onboarding.html"; return; }

	var alumnosRes = await window.sb.from("alumnos")
		.select("id, nombre_completo, num_lista, grado")
		.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("estatus", "activo")
		.order("grado").order("num_lista");
	alumnos = alumnosRes.data || [];

	document.getElementById("hoySubtitulo").textContent =
		grupo.nombre + " · " + alumnos.length + " alumno" + (alumnos.length === 1 ? "" : "s");
	document.getElementById("hoyFecha").textContent =
		new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

	if (!alumnos.length) {
		mensaje("info", "Este grupo todavía no tiene alumnos. Agrégalos en Mi grupo.");
		return;
	}

	// El arranque (cargar + primer render) va al FINAL del archivo, después de que
	// todo el estado está inicializado. Las funciones se izan, las asignaciones de
	// `var` no: arrancar aquí dejaba variables de estado en undefined.

	async function cargarDatosDelDia() {
		// Asistencia y registro diario de hoy
		var asisRes = await window.sb.from("asistencias")
			.select("alumno_id, asistencia_estado")
			.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("fecha", hoy);
		(asisRes.data || []).forEach(function (a) { asistencia[a.alumno_id] = a.asistencia_estado; });

		var regRes = await window.sb.from("registro_diario")
			.select("alumno_id, participacion, conducta")
			.eq("maestro_id", user.id).eq("fecha", hoy);
		(regRes.data || []).forEach(function (r) {
			registro[r.alumno_id] = { participacion: r.participacion, conducta: r.conducta };
		});

		// Proyectos activos del grupo → sesiones → productos
		var proyRes = await window.sb.from("proyectos").select("id, titulo, estado")
			.eq("maestro_id", user.id).eq("grupo_id", grupo.id).in("estado", ["activo", "borrador"]);
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });
		if (!proyIds.length) return;

		var sesRes = await window.sb.from("sesiones")
			.select("id, numero_sesion, fecha, campo_formativo, momento, proyecto_id")
			.in("proyecto_id", proyIds);
		var sesiones = sesRes.data || [];
		var sesionPorId = {};
		sesiones.forEach(function (s) { sesionPorId[s.id] = s; });
		sesionesHoy = sesiones.filter(function (s) { return s.fecha === hoy; })
			.sort(function (a, b) { return (a.numero_sesion || 0) - (b.numero_sesion || 0); });

		if (!sesiones.length) return;
		var prodRes = await window.sb.from("productos_sesion")
			.select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden")
			.in("sesion_id", sesiones.map(function (s) { return s.id; })).eq("activo", true)
			.order("orden");
		var productos = prodRes.data || [];

		productos.forEach(function (p) {
			p.sesion = sesionPorId[p.sesion_id];
			if (!productosPorSesion[p.sesion_id]) productosPorSesion[p.sesion_id] = [];
			productosPorSesion[p.sesion_id].push(p);
		});

		// Tareas por revisar: vencen hoy o antes (las de días pasados siguen ahí
		// hasta que el maestro las revise)
		tareas = productos.filter(function (p) {
			if (p.tipo !== "tarea") return false;
			var vence = p.fecha_entrega || (p.sesion && p.sesion.fecha);
			return vence && vence <= hoy;
		}).sort(function (a, b) {
			var fa = a.fecha_entrega || (a.sesion && a.sesion.fecha) || "";
			var fb = b.fecha_entrega || (b.sesion && b.sesion.fecha) || "";
			return fa < fb ? 1 : fa > fb ? -1 : 0; // lo más reciente primero
		});

		// Calificaciones ya capturadas de esos productos
		var idsRelevantes = productos.map(function (p) { return p.id; });
		if (idsRelevantes.length) {
			var califRes = await window.sb.from("calificaciones")
				.select("id, alumno_id, producto_sesion_id, estado_entrega, nivel, puntaje, retroalimentacion")
				.eq("maestro_id", user.id).in("producto_sesion_id", idsRelevantes);
			(califRes.data || []).forEach(function (c) {
				calificaciones[c.alumno_id + "|" + c.producto_sesion_id] = c;
			});
		}
	}

	// ── Guardado ──────────────────────────────────────────────────────────────
	function guardarAsistencia(alumnoId, estado) {
		encolar(async function () {
			var res = await window.sb.from("asistencias").upsert({
				maestro_id: user.id, grupo_id: grupo.id, alumno_id: alumnoId,
				fecha: hoy, asistencia_estado: estado,
			}, { onConflict: "grupo_id,alumno_id,fecha" });
			if (res.error) throw res.error;
		});
	}

	function guardarRegistro(alumnoId) {
		var v = registro[alumnoId] || { participacion: 1, conducta: 1 };
		encolar(async function () {
			var res = await window.sb.from("registro_diario").upsert({
				maestro_id: user.id, alumno_id: alumnoId, fecha: hoy,
				participacion: v.participacion, conducta: v.conducta,
			}, { onConflict: "maestro_id,alumno_id,fecha" });
			if (res.error) throw res.error;
		});
	}

	/*
		Una calificación por (alumno, producto). El índice único es parcial, así que no
		se puede usar upsert por conflicto: se actualiza por id si ya existe y se inserta
		la primera vez, guardando el id que devuelve la BD.
		El `tipo` lo pone el trigger calificaciones_tipo_desde_producto copiándolo del
		producto: aquí no se manda.
	*/
	function guardarCalificacion(alumno, producto, cambios) {
		var clave = alumno.id + "|" + producto.id;
		var actual = calificaciones[clave] || { alumno_id: alumno.id, producto_sesion_id: producto.id };
		Object.keys(cambios).forEach(function (k) { actual[k] = cambios[k]; });
		calificaciones[clave] = actual;

		encolar(async function () {
			var fila = {
				maestro_id: user.id, alumno_id: alumno.id, grupo_id: grupo.id,
				producto_sesion_id: producto.id,
				sesion_id: producto.sesion_id,
				proyecto_id: producto.sesion ? producto.sesion.proyecto_id : null,
				tipo: producto.tipo,
				descripcion: producto.nombre,
				grado: alumno.grado,
				campo_formativo: window.CamposFormativos ? window.CamposFormativos.largo(producto.campo) : null,
				estado_entrega: actual.estado_entrega || null,
				nivel: actual.nivel || null,
				puntaje: actual.puntaje === undefined ? null : actual.puntaje,
				retroalimentacion: actual.retroalimentacion || null,
				fecha: hoy,
				evaluado_en: new Date().toISOString(),
			};
			if (actual.id) {
				var upd = await window.sb.from("calificaciones").update(fila).eq("id", actual.id);
				if (upd.error) throw upd.error;
				return;
			}
			var ins = await window.sb.from("calificaciones").insert(fila).select("id").single();
			if (ins.error) {
				// 23505: ya existía (otro dispositivo, o esta pantalla abierta dos veces).
				// Se adopta la fila existente en vez de fallar.
				if (ins.error.code !== "23505") throw ins.error;
				var prev = await window.sb.from("calificaciones").select("id")
					.eq("maestro_id", user.id).eq("alumno_id", alumno.id)
					.eq("producto_sesion_id", producto.id).single();
				if (prev.error) throw prev.error;
				actual.id = prev.data.id;
				var upd2 = await window.sb.from("calificaciones").update(fila).eq("id", actual.id);
				if (upd2.error) throw upd2.error;
				return;
			}
			actual.id = ins.data.id;
		});
	}

	// ── Piezas de UI ──────────────────────────────────────────────────────────
	function chip(texto, activo, clasesActivo, atributos) {
		return "<button type='button' " + atributos + " class='min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors " +
			(activo ? clasesActivo : "bg-gray-100 text-gray-600 hover:bg-gray-200") + "'>" + esc(texto) + "</button>";
	}

	function filaAlumno(alumno, controles) {
		return "<div class='flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-gray-100 last:border-0'>" +
			"<div class='sm:w-56 shrink-0'>" +
			"<span class='text-sm font-medium text-gray-800'>" + esc(alumno.nombre_completo) + "</span>" +
			"<span class='text-xs text-gray-400 ml-2'>" + (alumno.num_lista || "") + " · " + alumno.grado + "°</span>" +
			"</div><div class='flex flex-wrap gap-2'>" + controles + "</div></div>";
	}

	function alumnosDeProducto(producto) {
		var grados = (producto.grados || []).map(Number);
		return alumnos.filter(function (a) { return grados.indexOf(a.grado) !== -1; });
	}

	function agruparPorGrado(lista) {
		var grupos = {};
		lista.forEach(function (a) { (grupos[a.grado] = grupos[a.grado] || []).push(a); });
		return Object.keys(grupos).sort().map(function (g) { return { grado: g, alumnos: grupos[g] }; });
	}

	// ── 1. Asistencia ─────────────────────────────────────────────────────────
	function renderAsistencia() {
		var cont = document.getElementById("asistenciaLista");
		cont.innerHTML = alumnos.map(function (al) {
			var controles = ASISTENCIA.map(function (op) {
				return chip(op.etiqueta, asistencia[al.id] === op.valor, op.activo,
					"data-asistencia='" + al.id + "' data-valor='" + op.valor + "'");
			}).join("");
			return filaAlumno(al, controles);
		}).join("");
		resumenAsistencia();
	}

	function resumenAsistencia() {
		var capturados = alumnos.filter(function (a) { return asistencia[a.id]; }).length;
		document.getElementById("asistenciaResumen").textContent = capturados + " de " + alumnos.length + " capturados";
	}

	document.getElementById("asistenciaLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-asistencia]");
		if (!btn) return;
		var alumnoId = btn.dataset.asistencia;
		asistencia[alumnoId] = btn.dataset.valor;
		guardarAsistencia(alumnoId, btn.dataset.valor);
		renderAsistencia();
	});

	// ── 2. Tareas por revisar ─────────────────────────────────────────────────
	function renderTareas() {
		var cont = document.getElementById("tareasLista");
		if (!tareas.length) {
			cont.innerHTML = vacio("No hay tareas por revisar. Las tareas aparecen aquí el día que vencen.");
			document.getElementById("tareasResumen").textContent = "";
			return;
		}
		cont.innerHTML = tareas.map(function (t) {
			var vence = t.fecha_entrega || (t.sesion && t.sesion.fecha);
			var atrasada = vence && vence < hoy;
			var filas = agruparPorGrado(alumnosDeProducto(t)).map(function (g) {
				var encabezado = (t.grados || []).length > 1
					? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
				return encabezado + g.alumnos.map(function (al) {
					var cal = calificaciones[al.id + "|" + t.id] || {};
					var controles = ENTREGA_TAREA.map(function (op) {
						return chip(op.etiqueta, cal.estado_entrega === op.valor, op.activo,
							"data-tarea='" + t.id + "' data-alumno='" + al.id + "' data-valor='" + op.valor + "'");
					}).join("");
					return filaAlumno(al, controles);
				}).join("");
			}).join("");
			return "<div>" +
				"<div class='flex items-center justify-between gap-2 mb-1'>" +
				"<p class='font-semibold text-gray-800 text-sm'>" + esc(t.nombre) + "</p>" +
				(atrasada ? "<span class='text-xs text-amber-600 shrink-0'>vencía el " + esc(vence) + "</span>" : "") +
				"</div>" + filas + "</div>";
		}).join("");
		var pendientesTareas = 0;
		tareas.forEach(function (t) {
			alumnosDeProducto(t).forEach(function (al) {
				if (!(calificaciones[al.id + "|" + t.id] || {}).estado_entrega) pendientesTareas++;
			});
		});
		document.getElementById("tareasResumen").textContent = pendientesTareas
			? pendientesTareas + " sin revisar" : "todas revisadas";
	}

	document.getElementById("tareasLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-tarea]");
		if (!btn) return;
		var producto = tareas.find(function (t) { return t.id === btn.dataset.tarea; });
		var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
		if (!producto || !alumno) return;
		var clave = alumno.id + "|" + producto.id;
		var actualEstado = (calificaciones[clave] || {}).estado_entrega;
		var nuevo = actualEstado === btn.dataset.valor ? null : btn.dataset.valor;
		// Entregada sin más detalle = trabajo cumplido; el nivel fino se pone en la sesión
		guardarCalificacion(alumno, producto, {
			estado_entrega: nuevo,
			nivel: nuevo === "entregado" ? ((calificaciones[clave] || {}).nivel || "logrado") : null,
		});
		renderTareas();
	});

	// ── 3. Sesiones de hoy ────────────────────────────────────────────────────
	function renderSesiones() {
		var cont = document.getElementById("sesionesLista");
		if (!sesionesHoy.length) {
			cont.innerHTML = vacio("No hay sesiones programadas para hoy. Puedes fechar una sesión desde Proyectos.");
			document.getElementById("sesionesResumen").textContent = "";
			return;
		}
		cont.innerHTML = sesionesHoy.map(function (ses) {
			var productos = (productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; });
			var cuerpo = productos.length
				? productos.map(function (p) { return bloqueProducto(p); }).join("")
				: vacio("Esta sesión no tiene productos calificables.");
			return "<div class='rounded-xl border border-gray-200 p-3'>" +
				"<div class='flex items-center justify-between gap-2 mb-2'>" +
				"<p class='font-semibold text-gray-800 text-sm'>Sesión " + (ses.numero_sesion || "") +
				" · " + esc(ses.campo_formativo || "") + "</p>" +
				"<button type='button' data-agregar-producto='" + ses.id + "' " +
				"class='min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'>Agregar producto</button>" +
				"</div>" + cuerpo + "</div>";
		}).join("");
		var sinCalificar = 0;
		sesionesHoy.forEach(function (ses) {
			(productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; }).forEach(function (p) {
				alumnosDeProducto(p).forEach(function (al) {
					var cal = calificaciones[al.id + "|" + p.id] || {};
					if (!cal.nivel && !cal.estado_entrega) sinCalificar++;
				});
			});
		});
		document.getElementById("sesionesResumen").textContent = sinCalificar
			? sinCalificar + " sin calificar" : "todo calificado";
	}

	function bloqueProducto(producto) {
		var deGrados = (producto.grados || []).length > 1;
		var filas = agruparPorGrado(alumnosDeProducto(producto)).map(function (g) {
			var encabezado = deGrados
				? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
			return encabezado + g.alumnos.map(function (al) {
				var clave = al.id + "|" + producto.id;
				var cal = calificaciones[clave] || {};
				var controles = NIVELES.map(function (op) {
					return chip(op.etiqueta, cal.nivel === op.valor, op.activo,
						"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-nivel='" + op.valor + "'");
				}).join("");
				controles += chip("No entregó", cal.estado_entrega === "no_entregado", "bg-red-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_entregado'");
				controles += chip("No aplica", cal.estado_entrega === "no_aplica", "bg-gray-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_aplica'");
				controles += "<button type='button' data-detalle='" + producto.id + "' data-alumno='" + al.id + "' " +
					"class='min-h-[44px] px-3 rounded-xl text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50'>" +
					(cal.puntaje != null || cal.retroalimentacion ? "Detalle ·" : "Detalle") + "</button>";
				return filaAlumno(al, controles) + detalleProducto(producto, al, cal);
			}).join("");
		}).join("");
		return "<div class='mb-3'>" +
			"<p class='text-sm font-medium text-gray-700'>" + esc(producto.nombre) +
			"<span class='text-xs text-gray-400 ml-2'>" + esc(producto.campo || "") + "</span></p>" +
			filas + "</div>";
	}

	function detalleProducto(producto, alumno, cal) {
		var id = "detalle-" + producto.id + "-" + alumno.id;
		var abierto = detallesAbiertos[id];
		var opciones = "<option value=''>Sin puntaje</option>";
		for (var n = 0; n <= 10; n++) {
			opciones += "<option value='" + n + "'" + (String(cal.puntaje) === String(n) ? " selected" : "") + ">" + n + "</option>";
		}
		var chipsRetro = RETRO_RAPIDA.map(function (t) {
			return "<button type='button' data-retro='" + id + "' data-texto='" + esc(t) + "' " +
				"class='min-h-[44px] px-3 rounded-xl text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200'>" + esc(t) + "</button>";
		}).join("");
		return "<div id='" + id + "' class='" + (abierto ? "" : "hidden ") +
			"rounded-xl bg-gray-50 border border-gray-200 p-3 mb-2'>" +
			"<div class='flex flex-wrap items-center gap-3'>" +
			"<label class='text-xs text-gray-600'>Puntaje" +
			"<select data-puntaje='" + producto.id + "' data-alumno='" + alumno.id + "' " +
			"class='ml-2 min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm'>" + opciones + "</select></label>" +
			"<span class='text-xs text-gray-400'>El puntaje manda sobre el semáforo al calcular.</span>" +
			"</div>" +
			"<div class='flex flex-wrap gap-2 mt-2'>" + chipsRetro + "</div>" +
			"<textarea data-retroalimentacion='" + producto.id + "' data-alumno='" + alumno.id + "' rows='2' " +
			"placeholder='Retroalimentación para el alumno y sus padres' " +
			"class='mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'>" + esc(cal.retroalimentacion || "") + "</textarea>" +
			"</div>";
	}

	var sesionesCont = document.getElementById("sesionesLista");

	sesionesCont.addEventListener("click", async function (e) {
		var btnAgregar = e.target.closest("button[data-agregar-producto]");
		if (btnAgregar) { await agregarProducto(btnAgregar.dataset.agregarProducto); return; }

		var btnDetalle = e.target.closest("button[data-detalle]");
		if (btnDetalle) {
			var idDetalle = "detalle-" + btnDetalle.dataset.detalle + "-" + btnDetalle.dataset.alumno;
			var caja = document.getElementById(idDetalle);
			if (caja) {
				var seAbre = caja.classList.contains("hidden");
				caja.classList.toggle("hidden", !seAbre);
				detallesAbiertos[idDetalle] = seAbre;
			}
			return;
		}

		var btnRetro = e.target.closest("button[data-retro]");
		if (btnRetro) {
			var ta = document.querySelector("#" + btnRetro.dataset.retro + " textarea[data-retroalimentacion]");
			if (ta) { ta.value = btnRetro.dataset.texto; ta.dispatchEvent(new Event("change", { bubbles: true })); }
			return;
		}

		var btn = e.target.closest("button[data-producto]");
		if (!btn) return;
		var producto = productoPorId(btn.dataset.producto);
		var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
		if (!producto || !alumno) return;
		var cal = calificaciones[alumno.id + "|" + producto.id] || {};

		if (btn.dataset.nivel) {
			var nuevoNivel = cal.nivel === btn.dataset.nivel ? null : btn.dataset.nivel;
			// Tocar un nivel implica que sí entregó
			guardarCalificacion(alumno, producto, {
				nivel: nuevoNivel,
				estado_entrega: nuevoNivel ? "entregado" : null,
			});
		} else if (btn.dataset.estado) {
			var nuevoEstado = cal.estado_entrega === btn.dataset.estado ? null : btn.dataset.estado;
			guardarCalificacion(alumno, producto, { estado_entrega: nuevoEstado, nivel: null });
		}
		renderSesiones();
	});

	sesionesCont.addEventListener("change", function (e) {
		var sel = e.target.closest("select[data-puntaje]");
		if (sel) {
			var p = productoPorId(sel.dataset.puntaje);
			var a = alumnos.find(function (x) { return x.id === sel.dataset.alumno; });
			if (p && a) guardarCalificacion(a, p, { puntaje: sel.value === "" ? null : Number(sel.value) });
			return;
		}
		var ta = e.target.closest("textarea[data-retroalimentacion]");
		if (ta) {
			var prod = productoPorId(ta.dataset.retroalimentacion);
			var alum = alumnos.find(function (x) { return x.id === ta.dataset.alumno; });
			if (prod && alum) guardarCalificacion(alum, prod, { retroalimentacion: ta.value.trim() || null });
		}
	});

	function productoPorId(id) {
		var encontrado = null;
		Object.keys(productosPorSesion).forEach(function (sid) {
			productosPorSesion[sid].forEach(function (p) { if (p.id === id) encontrado = p; });
		});
		return encontrado;
	}

	/*
		"Agregar producto": cuando el maestro pidió algo que no estaba en la planeación.
		Se crea con origen 'maestro' para distinguirlo de lo importado.
	*/
	async function agregarProducto(sesionId) {
		var sesion = sesionesHoy.find(function (s) { return s.id === sesionId; });
		if (!sesion) return;
		var nombre = window.prompt("¿Qué producto pediste? (por ejemplo: Cartel del cuento)");
		if (!nombre || !nombre.trim()) return;
		var campo = window.CamposFormativos ? window.CamposFormativos.corto(sesion.campo_formativo) : null;
		if (!campo) { mensaje("error", "La sesión no tiene campo formativo; no se puede agregar el producto."); return; }
		var grados = (grupo.grados || []).map(String).sort();
		try {
			var res = await window.sb.from("productos_sesion").insert({
				sesion_id: sesion.id, maestro_id: user.id, tipo: "trabajo",
				nombre: nombre.trim(), grados: grados,
				modalidad: grados.length > 1 ? "compartida" : "compartida",
				campo: campo, origen: "maestro", activo: true,
			}).select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden").single();
			if (res.error) throw res.error;
			var nuevo = res.data;
			nuevo.sesion = sesion;
			(productosPorSesion[sesion.id] = productosPorSesion[sesion.id] || []).push(nuevo);
			renderSesiones();
			mensaje("", "");
		} catch (err) {
			mensaje("error", "No se pudo agregar el producto: " + (err.message || "error desconocido"));
		}
	}

	// ── 4. Cierre del día ─────────────────────────────────────────────────────
	function renderCierre() {
		var cont = document.getElementById("cierreLista");
		cont.innerHTML = alumnos.map(function (al) {
			var v = registro[al.id];
			var part = v ? v.participacion : 1;
			var cond = v ? v.conducta : 1;
			var controles = "<span class='text-xs text-gray-500 self-center mr-1'>Participación</span>" +
				[0, 1, 2].map(function (n) {
					return chip(String(n), part === n, "bg-blue-600 text-white",
						"data-cierre='participacion' data-alumno='" + al.id + "' data-valor='" + n + "'");
				}).join("") +
				"<span class='text-xs text-gray-500 self-center mx-1'>Conducta</span>" +
				[0, 1, 2].map(function (n) {
					return chip(String(n), cond === n, "bg-blue-600 text-white",
						"data-cierre='conducta' data-alumno='" + al.id + "' data-valor='" + n + "'");
				}).join("");
			return filaAlumno(al, controles);
		}).join("");
		var capturados = alumnos.filter(function (a) { return registro[a.id]; }).length;
		document.getElementById("cierreResumen").textContent = capturados + " de " + alumnos.length + " capturados";
	}

	document.getElementById("cierreLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-cierre]");
		if (!btn) return;
		var alumnoId = btn.dataset.alumno;
		var actual = registro[alumnoId] || { participacion: 1, conducta: 1 };
		actual[btn.dataset.cierre] = Number(btn.dataset.valor);
		registro[alumnoId] = actual;
		guardarRegistro(alumnoId);
		renderCierre();
	});

	// ── Arranque ──────────────────────────────────────────────────────────────
	// Hasta aquí todo está declarado e inicializado. Cada sección se dibuja por
	// separado: si una falla, las demás siguen en pie y el maestro no se queda con
	// media pantalla en blanco.
	try {
		await cargarDatosDelDia();
	} catch (e) {
		console.error("hoy: carga de datos", e);
		mensaje("error", "No se pudieron cargar los datos del día: " + (e.message || "error desconocido"));
	}
	[
		["asistencia", renderAsistencia],
		["tareas", renderTareas],
		["sesiones", renderSesiones],
		["cierre", renderCierre],
	].forEach(function (par) {
		try {
			par[1]();
		} catch (e) {
			console.error("hoy: render de " + par[0], e);
			mensaje("error", "No se pudo mostrar la sección de " + par[0] + ". El resto de la pantalla sigue funcionando.");
		}
	});
});
