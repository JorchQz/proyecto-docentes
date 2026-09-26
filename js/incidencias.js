/*
	incidencias.js — Registro de sucesos del salón, por grupo (decisión de Jorge, 2026-09-25).

	Cada incidencia: asunto, fecha y hora, alumnos involucrados (uno o varios del grupo activo),
	descripción y acuerdos o compromisos (opcional). Tablas incidencias + incidencia_alumnos
	(supabase/mi_salon_b13_ficha_incidencias_2026-09.sql); alta y edición por la función
	guardar_incidencia (una transacción: la incidencia y su lista de alumnos, con la RLS de la
	maestra). Eliminar pide confirmación.

	Documento imprimible (como la boleta: la hoja en pantalla y @media print deja solo la hoja):
	  - encabezado: escuela y director del GRUPO (grupos.escuela, grupos.director_nombre; una
	    maestra puede tener grupos en escuelas distintas, así que no se toma la escuela del
	    perfil), grupo, ciclo y docente;
	  - los datos de la incidencia;
	  - firmas: Docente (nombre de la maestra), Director(a) (el del grupo; si falta, la línea
	    queda en blanco con "Director(a)") y Madre, padre o tutor (con el nombre del tutor
	    cuando hay un solo alumno y su ficha lo tiene).
	Todo texto capturado se escapa (esc) antes de entrar al HTML.

	Si un alumno se elimina del grupo, sale de sus incidencias (la incidencia se conserva).

	La parte pura (formatos, validación, lista y documento) se exporta a node para
	pruebas/incidencias.test.js.
*/
(function () {
	"use strict";

	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
	var LARGO = { asunto: 150, descripcion: 5000, acuerdos: 5000 };

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// "2026-09-25" → "25 de septiembre de 2026"
	function formatoFecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		if (!m) return "";
		var mes = MESES[Number(m[2]) - 1];
		if (!mes) return "";
		return Number(m[3]) + " de " + mes + " de " + m[1];
	}

	// "13:05:00" → "1:05 p. m."; "00:30" → "12:30 a. m."; vacío → ""
	function formatoHora(hora) {
		var m = /^(\d{1,2}):(\d{2})/.exec(String(hora || ""));
		if (!m) return "";
		var h = Number(m[1]);
		if (h > 23) return "";
		var sufijo = h < 12 ? "a. m." : "p. m.";
		var h12 = h % 12 === 0 ? 12 : h % 12;
		return h12 + ":" + m[2] + " " + sufijo;
	}

	function fechaYHora(inc) {
		var f = formatoFecha(inc && inc.fecha);
		var h = formatoHora(inc && inc.hora);
		return f + (h ? ", " + h : "");
	}

	function limpiar(texto) {
		return String(texto === null || texto === undefined ? "" : texto).trim();
	}

	/*
		validar(valores, hoy) → "" si se puede guardar; si no, qué falta (una sola cosa, la primera).
		valores = { asunto, fecha, hora, descripcion, acuerdos, alumnos: [ids] }
	*/
	function validar(v, hoy) {
		v = v || {};
		var asunto = limpiar(v.asunto);
		if (!asunto) return "Escribe el asunto de la incidencia.";
		if (asunto.length > LARGO.asunto) return "El asunto es muy largo (máximo " + LARGO.asunto + " caracteres).";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.fecha || ""))) return "Elige la fecha de la incidencia.";
		if (v.fecha < "2000-01-01") return "Revisa la fecha de la incidencia.";
		if (hoy && v.fecha > hoy) return "La fecha no puede ser futura.";
		if (v.hora && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(v.hora))) return "Revisa la hora (o déjala vacía).";
		if (!v.alumnos || !v.alumnos.length) return "Elige al menos un alumno involucrado.";
		var descripcion = limpiar(v.descripcion);
		if (!descripcion) return "Escribe la descripción de lo que pasó.";
		if (descripcion.length > LARGO.descripcion) return "La descripción es muy larga (máximo " + LARGO.descripcion + " caracteres).";
		if (limpiar(v.acuerdos).length > LARGO.acuerdos) return "Los acuerdos son muy largos (máximo " + LARGO.acuerdos + " caracteres).";
		return "";
	}

	// Más reciente primero (fecha, hora; sin hora va al final de su día)
	function ordenar(lista) {
		return (lista || []).slice().sort(function (a, b) {
			if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
			var ha = a.hora || "", hb = b.hora || "";
			if (ha !== hb) return ha < hb ? 1 : -1;
			return String(a.created_at || "") < String(b.created_at || "") ? 1 : -1;
		});
	}

	// "Pérez López Ana (3°)"; el grado solo en multigrado
	function nombreAlumno(al, conGrado) {
		if (!al) return "";
		var n = al.nombre_completo || "Alumno sin nombre";
		return conGrado && al.grado ? n + " (" + al.grado + "°)" : n;
	}

	/*
		documento(d) → HTML de la hoja (todo escapado).
		d = {
		  incidencia: { asunto, fecha, hora, descripcion, acuerdos },
		  alumnos:    [{ nombre_completo, grado, tutor_nombre }] (los involucrados que siguen en el grupo),
		  grupo:      { nombre, ciclo_escolar, escuela, director_nombre, multigrado },
		  docente:    nombre de la maestra,
		  sinAlumnos: true si la incidencia se quedó sin alumnos (se eliminaron del grupo)
		}
	*/
	function documento(d) {
		d = d || {};
		var inc = d.incidencia || {};
		var g = d.grupo || {};
		var alumnos = d.alumnos || [];
		var docente = limpiar(d.docente);
		var director = limpiar(g.director_nombre);
		var escuela = limpiar(g.escuela);
		var acuerdos = limpiar(inc.acuerdos);
		// Nombre del tutor en su línea: solo con un alumno y si su ficha lo tiene
		var tutor = alumnos.length === 1 ? limpiar(alumnos[0].tutor_nombre) : "";

		function dato(etq, valor) {
			return "<div><dt>" + esc(etq) + "</dt><dd>" + (valor ? esc(valor) : "&nbsp;") + "</dd></div>";
		}
		function firma(nombre, rol) {
			return "<div class='inc-firma'><div class='inc-firma-linea'>" +
				"<p class='inc-firma-nombre'>" + (nombre ? esc(nombre) : "&nbsp;") + "</p>" +
				"<p class='inc-firma-rol'>" + esc(rol) + "</p></div></div>";
		}

		var listaAlumnos = alumnos.length
			? "<ul class='inc-alumnos'>" + alumnos.map(function (al) {
				return "<li>" + esc(nombreAlumno(al, g.multigrado)) + "</li>";
			}).join("") + "</ul>"
			: "<p>" + esc(d.sinAlumnos ? "Sin alumnos registrados (se eliminaron del grupo)." : "Sin alumnos registrados.") + "</p>";

		return (
			"<article class='inc-hoja'>" +
			"<header class='inc-enc'>" +
			(escuela
				? "<p class='inc-escuela'>" + esc(escuela) + "</p>"
				: "<p class='inc-escuela inc-escuela-vacia'>Escuela: ______________________________</p>") +
			"<h1>Registro de incidencia</h1>" +
			"<dl class='inc-datos'>" +
			dato("Grupo", g.nombre || "") +
			dato("Ciclo escolar", g.ciclo_escolar || "") +
			dato("Docente", docente) +
			"</dl></header>" +
			"<dl>" +
			"<div class='inc-campo'><dt>Asunto</dt><dd class='inc-asunto'>" + esc(limpiar(inc.asunto)) + "</dd></div>" +
			"<div class='inc-campo'><dt>Fecha y hora</dt><dd>" + esc(fechaYHora(inc)) + "</dd></div>" +
			"<div class='inc-campo'><dt>" + (alumnos.length === 1 ? "Alumno involucrado" : "Alumnos involucrados") + "</dt><dd>" + listaAlumnos + "</dd></div>" +
			"</dl>" +
			"<section class='inc-seccion'><h2>Descripción</h2><p class='inc-texto'>" + esc(limpiar(inc.descripcion)) + "</p></section>" +
			"<section class='inc-seccion'><h2>Acuerdos o compromisos</h2>" +
			(acuerdos
				? "<p class='inc-texto'>" + esc(acuerdos) + "</p>"
				: "<div class='inc-renglon'></div><div class='inc-renglon'></div><div class='inc-renglon'></div>") +
			"</section>" +
			"<section class='inc-firmas' aria-label='Firmas'>" +
			firma(docente, "Docente") +
			firma(director, "Director(a)") +
			firma(tutor, "Madre, padre o tutor") +
			"</section>" +
			"<p class='inc-pie'>Registro interno del grupo elaborado en Mi Salón (Jissez). No es un documento oficial de la SEP.</p>" +
			"</article>"
		);
	}

	/*
		tarjeta(inc, nombres, permitir) → HTML de una incidencia en la lista (escapado).
		nombres: los nombres de los alumnos involucrados que siguen en el grupo.
	*/
	var ICONO = {
		imprimir: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
		editar: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
		eliminar: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
	};
	function icono(nombre) {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + ICONO[nombre] + "</svg>";
	}

	function tarjeta(inc, nombres) {
		var id = esc(inc.id);
		var asunto = limpiar(inc.asunto);
		var descripcion = limpiar(inc.descripcion);
		var alumnosTxt = nombres && nombres.length ? nombres.join(", ") : "Sin alumnos (se eliminaron del grupo)";
		var boton = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors";
		return (
			"<li class='rounded-xl border border-gray-200 p-4' data-incidencia='" + id + "'>" +
			"<p class='text-xs font-medium text-gray-500'>" + esc(fechaYHora(inc)) + "</p>" +
			"<h3 class='mt-0.5 font-semibold text-gray-900 break-words'>" + esc(asunto) + "</h3>" +
			"<p class='mt-1 text-sm text-gray-700 break-words'><span class='text-gray-500'>" + (nombres && nombres.length === 1 ? "Alumno:" : "Alumnos:") + "</span> " + esc(alumnosTxt) + "</p>" +
			"<p class='mt-1 text-sm text-gray-600 break-words line-clamp-2'>" + esc(descripcion) + "</p>" +
			(limpiar(inc.acuerdos) ? "<p class='mt-1 text-xs text-emerald-800'>Con acuerdos registrados</p>" : "") +
			"<div class='mt-3 flex flex-wrap gap-2'>" +
			"<button type='button' data-accion='ver' data-id='" + id + "' class='" + boton + " bg-blue-700 text-white font-semibold hover:bg-blue-800' aria-label='Ver e imprimir: " + esc(asunto) + "'>" + icono("imprimir") + "Ver e imprimir</button>" +
			"<button type='button' data-accion='editar' data-id='" + id + "' class='" + boton + " bg-blue-50 text-blue-800 hover:bg-blue-100' aria-label='Editar: " + esc(asunto) + "'>" + icono("editar") + "Editar</button>" +
			"<button type='button' data-accion='eliminar' data-id='" + id + "' class='" + boton + " bg-red-50 text-red-700 hover:bg-red-100' aria-label='Eliminar: " + esc(asunto) + "'>" + icono("eliminar") + "Eliminar</button>" +
			"</div></li>"
		);
	}

	var api = {
		LARGO: LARGO,
		esc: esc,
		formatoFecha: formatoFecha,
		formatoHora: formatoHora,
		fechaYHora: fechaYHora,
		validar: validar,
		ordenar: ordenar,
		nombreAlumno: nombreAlumno,
		documento: documento,
		tarjeta: tarjeta,
	};
	if (typeof window !== "undefined") window.Incidencias = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	// ── Página incidencias.html ──────────────────────────────────────────────
	document.addEventListener("DOMContentLoaded", async function () {
		if (!document.getElementById("incPantalla")) return; // otra página que solo usa la parte pura
		if (!window.sb) { window.location.href = "index.html"; return; }

		var el = {
			pantalla: document.getElementById("incPantalla"),
			subtitulo: document.getElementById("incSubtitulo"),
			mensaje: document.getElementById("incMensaje"),
			aviso: document.getElementById("incAvisoEscuela"),
			avisoTexto: document.getElementById("incAvisoEscuelaTexto"),
			formulario: document.getElementById("incFormulario"),
			formTitulo: document.getElementById("incFormTitulo"),
			form: document.getElementById("incForm"),
			asunto: document.getElementById("incAsunto"),
			fecha: document.getElementById("incFecha"),
			hora: document.getElementById("incHora"),
			alumnos: document.getElementById("incAlumnos"),
			alumnosCuenta: document.getElementById("incAlumnosCuenta"),
			descripcion: document.getElementById("incDescripcion"),
			acuerdos: document.getElementById("incAcuerdos"),
			formMensaje: document.getElementById("incFormMensaje"),
			cancelar: document.getElementById("incCancelarBtn"),
			guardar: document.getElementById("incGuardarBtn"),
			nueva: document.getElementById("incNuevaBtn"),
			lista: document.getElementById("incLista"),
			resumen: document.getElementById("incListaResumen"),
			doc: document.getElementById("incDocumento"),
			hoja: document.getElementById("incHoja"),
			volver: document.getElementById("incVolverBtn"),
			imprimir: document.getElementById("incImprimirBtn"),
			confirmar: document.getElementById("incConfirmar"),
			confirmarFondo: document.getElementById("incConfirmarFondo"),
			confirmarTexto: document.getElementById("incConfirmarTexto"),
			confirmarSi: document.getElementById("incConfirmarSi"),
			confirmarNo: document.getElementById("incConfirmarNo"),
		};

		var maestroId = null;
		var grupo = null;
		var docente = "";
		var alumnos = [];          // todos los del grupo (activos y de baja), por id en porId
		var porId = {};
		var incidencias = [];
		var editandoId = null;
		var guardando = false;
		var tituloOriginal = document.title;

		function hoyISO() {
			var ahora = new Date();
			return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
		}
		function horaAhora() {
			var a = new Date();
			return (a.getHours() < 10 ? "0" : "") + a.getHours() + ":" + (a.getMinutes() < 10 ? "0" : "") + a.getMinutes();
		}

		function mensaje(tipo, texto) {
			if (!texto) { el.mensaje.classList.add("hidden"); el.mensaje.textContent = ""; return; }
			el.mensaje.className = "rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200");
			el.mensaje.textContent = texto;
		}
		function mensajeForm(texto) {
			if (!texto) { el.formMensaje.classList.add("hidden"); el.formMensaje.textContent = ""; return; }
			el.formMensaje.className = "rounded-lg px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200";
			el.formMensaje.textContent = texto;
		}
		function motivo(error) {
			var sinRed = window.Lectura && window.Lectura.errorDeRed ? window.Lectura.errorDeRed(error) : false;
			return sinRed ? "No hay conexión. Revisa tu internet e intenta de nuevo." : "Intenta de nuevo en un momento.";
		}

		function multigrado() {
			var grados = {};
			alumnos.forEach(function (a) { if (a.grado) grados[a.grado] = true; });
			return Object.keys(grados).length > 1;
		}

		// Los involucrados que siguen en el grupo, en orden de lista
		function involucrados(inc) {
			return (inc.incidencia_alumnos || [])
				.map(function (v) { return porId[v.alumno_id]; })
				.filter(Boolean)
				.sort(function (a, b) {
					return (a.grado || 0) - (b.grado || 0) || (a.num_lista || 0) - (b.num_lista || 0) ||
						String(a.nombre_completo).localeCompare(String(b.nombre_completo), "es");
				});
		}

		// ── Lista ──
		function pintarLista() {
			var orden = ordenar(incidencias);
			el.resumen.textContent = orden.length === 0 ? "" : orden.length === 1 ? "1 incidencia" : orden.length + " incidencias";
			if (!orden.length) {
				el.lista.innerHTML = "<li class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Todavía no hay incidencias en este grupo. Registra la primera con «Nueva incidencia».</li>";
				return;
			}
			el.lista.innerHTML = orden.map(function (inc) {
				return tarjeta(inc, involucrados(inc).map(function (a) { return nombreAlumno(a, multigrado()); }));
			}).join("");
		}

		async function leerIncidencias() {
			incidencias = await window.Lectura.todas(function () {
				return window.sb.from("incidencias")
					.select("id, asunto, fecha, hora, descripcion, acuerdos, created_at, updated_at, incidencia_alumnos(alumno_id)")
					.eq("maestro_id", maestroId)
					.eq("grupo_id", grupo.id)
					.order("fecha", { ascending: false })
					.order("id", { ascending: true });
			});
		}

		// ── Formulario ──
		function pintarAlumnos(elegidos) {
			var marcados = {};
			(elegidos || []).forEach(function (id) { marcados[id] = true; });
			var conGrado = multigrado();
			// Los activos, más los de baja que ya estaban en esta incidencia
			var opciones = alumnos.filter(function (a) { return a.estatus === "activo" || marcados[a.id]; });
			if (!opciones.length) {
				el.alumnos.innerHTML = "<p class='text-sm text-gray-500 sm:col-span-2 lg:col-span-3'>Tu grupo todavía no tiene alumnos. Agrégalos en <a href='mi-grupo.html' class='underline font-medium text-blue-800'>Mi grupo</a>.</p>";
				contarElegidos();
				return;
			}
			el.alumnos.innerHTML = opciones.map(function (a) {
				var id = esc(a.id);
				return "<label class='flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50'>" +
					"<input type='checkbox' name='incAlumno' value='" + id + "'" + (marcados[a.id] ? " checked" : "") + " class='h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500'>" +
					"<span class='min-w-0 text-sm text-gray-800 break-words'>" + esc(a.nombre_completo || "Alumno sin nombre") +
					(conGrado && a.grado ? " <span class='text-gray-500'>(" + esc(a.grado) + "°)</span>" : "") +
					(a.estatus !== "activo" ? " <span class='text-gray-500'>(baja)</span>" : "") + "</span></label>";
			}).join("");
			contarElegidos();
		}
		function elegidos() {
			return Array.prototype.map.call(el.alumnos.querySelectorAll("input[name='incAlumno']:checked"), function (c) { return c.value; });
		}
		function contarElegidos() {
			var n = elegidos().length;
			el.alumnosCuenta.textContent = n === 0 ? "Ningún alumno elegido." : n === 1 ? "1 alumno elegido." : n + " alumnos elegidos.";
		}

		function abrirFormulario(inc) {
			editandoId = inc ? inc.id : null;
			el.formTitulo.textContent = inc ? "Editar incidencia" : "Nueva incidencia";
			el.guardar.textContent = inc ? "Guardar cambios" : "Guardar incidencia";
			el.asunto.value = inc ? (inc.asunto || "") : "";
			el.fecha.value = inc ? (inc.fecha || "") : hoyISO();
			el.fecha.max = hoyISO();
			el.hora.value = inc ? String(inc.hora || "").slice(0, 5) : horaAhora();
			el.descripcion.value = inc ? (inc.descripcion || "") : "";
			el.acuerdos.value = inc ? (inc.acuerdos || "") : "";
			pintarAlumnos(inc ? (inc.incidencia_alumnos || []).map(function (v) { return v.alumno_id; }).filter(function (id) { return porId[id]; }) : []);
			mensajeForm("");
			mensaje(null);
			el.formulario.classList.remove("hidden");
			el.nueva.disabled = true;
			el.formulario.scrollIntoView({ behavior: "smooth", block: "start" });
			setTimeout(function () { el.asunto.focus({ preventScroll: true }); }, 50);
		}
		function cerrarFormulario() {
			editandoId = null;
			el.formulario.classList.add("hidden");
			el.nueva.disabled = false;
			mensajeForm("");
		}

		async function guardar(e) {
			e.preventDefault();
			if (guardando) return;
			var valores = {
				asunto: el.asunto.value, fecha: el.fecha.value, hora: el.hora.value,
				descripcion: el.descripcion.value, acuerdos: el.acuerdos.value, alumnos: elegidos(),
			};
			var falta = validar(valores, hoyISO());
			if (falta) { mensajeForm(falta); return; }
			guardando = true;
			el.guardar.disabled = true;
			var eraEdicion = !!editandoId;
			try {
				var res = await window.sb.rpc("guardar_incidencia", {
					p_id: editandoId,
					p_grupo_id: grupo.id,
					p_asunto: limpiar(valores.asunto),
					p_fecha: valores.fecha,
					p_hora: valores.hora ? valores.hora : null,
					p_descripcion: limpiar(valores.descripcion),
					p_acuerdos: limpiar(valores.acuerdos) || null,
					p_alumnos: valores.alumnos,
				});
				if (res.error) throw res.error;
				cerrarFormulario();
				await leerIncidencias();
				pintarLista();
				mensaje("ok", eraEdicion ? "Incidencia actualizada." : "Incidencia guardada.");
			} catch (error) {
				console.error("incidencias: guardar", error);
				mensajeForm("No se pudo guardar la incidencia. " + motivo(error) + " Lo que escribiste sigue aquí.");
			} finally {
				guardando = false;
				el.guardar.disabled = false;
			}
		}

		// ── Eliminar (con confirmación) ──
		function confirmar(texto) {
			return new Promise(function (resolver) {
				var antes = document.activeElement;
				function fin(si) {
					el.confirmar.classList.add("hidden");
					el.confirmarSi.removeEventListener("click", si1);
					el.confirmarNo.removeEventListener("click", no1);
					el.confirmarFondo.removeEventListener("click", no1);
					document.removeEventListener("keydown", tecla);
					if (antes && antes.focus) { try { antes.focus(); } catch (_) {} }
					resolver(si);
				}
				function si1() { fin(true); }
				function no1() { fin(false); }
				function tecla(ev) {
					if (ev.key === "Escape") fin(false);
					if (ev.key === "Tab") { // el foco no sale del diálogo
						var a = el.confirmarNo, b = el.confirmarSi;
						if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); b.focus(); }
						else if (!ev.shiftKey && document.activeElement === b) { ev.preventDefault(); a.focus(); }
					}
				}
				el.confirmarTexto.textContent = texto;
				el.confirmar.classList.remove("hidden");
				el.confirmarSi.addEventListener("click", si1);
				el.confirmarNo.addEventListener("click", no1);
				el.confirmarFondo.addEventListener("click", no1);
				document.addEventListener("keydown", tecla);
				el.confirmarNo.focus();
			});
		}

		async function eliminar(inc) {
			var si = await confirmar("Se eliminará la incidencia «" + limpiar(inc.asunto) + "» del " + formatoFecha(inc.fecha) + ". Esta acción no se puede deshacer.");
			if (!si) return;
			try {
				var res = await window.sb.from("incidencias").delete()
					.eq("id", inc.id).eq("maestro_id", maestroId).eq("grupo_id", grupo.id)
					.select("id");
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el borrado");
				if (editandoId === inc.id) cerrarFormulario();
				await leerIncidencias();
				pintarLista();
				mensaje("ok", "Incidencia eliminada.");
			} catch (error) {
				console.error("incidencias: eliminar", error);
				mensaje("error", "No se pudo eliminar la incidencia. " + motivo(error));
			}
		}

		// ── Documento ──
		function verDocumento(inc) {
			var invol = involucrados(inc);
			el.hoja.innerHTML = documento({
				incidencia: inc,
				alumnos: invol,
				sinAlumnos: !invol.length && (inc.incidencia_alumnos || []).length === 0,
				grupo: {
					nombre: grupo.nombre, ciclo_escolar: grupo.ciclo_escolar, escuela: grupo.escuela,
					director_nombre: grupo.director_nombre, multigrado: multigrado(),
				},
				docente: docente,
			});
			el.pantalla.classList.add("hidden");
			el.doc.classList.remove("hidden");
			el.doc.classList.add("flex");
			// El nombre del PDF al guardar: "Incidencia 2026-09-25 Asunto"
			document.title = ("Incidencia " + inc.fecha + " " + limpiar(inc.asunto)).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 90);
			window.scrollTo(0, 0);
			el.volver.focus();
		}
		function cerrarDocumento() {
			el.doc.classList.add("hidden");
			el.doc.classList.remove("flex");
			el.pantalla.classList.remove("hidden");
			document.title = tituloOriginal;
		}

		function buscar(id) {
			for (var i = 0; i < incidencias.length; i++) if (incidencias[i].id === id) return incidencias[i];
			return null;
		}

		// ── Eventos ──
		el.nueva.addEventListener("click", function () { abrirFormulario(null); });
		el.cancelar.addEventListener("click", function () { cerrarFormulario(); el.nueva.focus(); });
		el.form.addEventListener("submit", guardar);
		el.alumnos.addEventListener("change", contarElegidos);
		// El aviso de lo que falta se quita en cuanto la maestra corrige algo
		el.form.addEventListener("input", function () { mensajeForm(""); });
		el.form.addEventListener("change", function () { mensajeForm(""); });
		el.lista.addEventListener("click", function (e) {
			var btn = e.target.closest ? e.target.closest("button[data-accion]") : null;
			if (!btn) return;
			var inc = buscar(btn.getAttribute("data-id"));
			if (!inc) return;
			var accion = btn.getAttribute("data-accion");
			if (accion === "ver") verDocumento(inc);
			else if (accion === "editar") abrirFormulario(inc);
			else if (accion === "eliminar") eliminar(inc);
		});
		el.volver.addEventListener("click", cerrarDocumento);
		el.imprimir.addEventListener("click", function () { window.print(); });
		window.addEventListener("afterprint", function () {
			if (!el.doc.classList.contains("hidden")) el.imprimir.focus();
		});

		// ── Arranque ──
		try {
			var ses = await window.sb.auth.getSession();
			var sesion = ses && ses.data ? ses.data.session : null;
			if (!sesion) { window.location.href = "index.html"; return; }
			maestroId = sesion.user.id;
			var activo = await window.GrupoActivo.cargar(window.sb, maestroId);
			if (!activo.grupo) { window.location.href = "onboarding.html"; return; }
			grupo = activo.grupo;

			var perfil = await window.Lectura.uno(window.sb.from("perfiles").select("nombre_completo").eq("id", maestroId).maybeSingle());
			var meta = sesion.user.user_metadata || {};
			docente = limpiar((perfil && perfil.nombre_completo) || meta.nombre_docente || meta.full_name || "");

			alumnos = await window.Lectura.todas(function () {
				return window.sb.from("alumnos")
					.select("id, nombre_completo, grado, num_lista, estatus, tutor_nombre")
					.eq("maestro_id", maestroId)
					.eq("grupo_id", grupo.id)
					.order("grado", { ascending: true })
					.order("num_lista", { ascending: true })
					.order("id", { ascending: true });
			});
			porId = {};
			alumnos.forEach(function (a) { porId[a.id] = a; });
			await leerIncidencias();
		} catch (error) {
			window.Lectura.detenerPagina(error);
			return;
		}

		el.subtitulo.textContent = (grupo.nombre || "Grupo") + (grupo.ciclo_escolar ? " · Ciclo " + grupo.ciclo_escolar : "") +
			(grupo.escuela ? " · " + grupo.escuela : "");
		var faltan = [];
		if (!limpiar(grupo.escuela)) faltan.push("el nombre de la escuela");
		if (!limpiar(grupo.director_nombre)) faltan.push("el nombre del director o directora");
		if (faltan.length) {
			el.avisoTexto.textContent = "Este grupo no tiene " + faltan.join(" ni ") + (faltan.length === 1 ? ". El documento para imprimir lo deja en blanco para llenarlo a mano." : ". El documento para imprimir los deja en blanco para llenarlos a mano.");
			el.aviso.classList.remove("hidden");
		}
		el.nueva.disabled = false;
		pintarLista();
	});
})();
