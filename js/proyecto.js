/*
	proyecto.js — La vista del proyecto (Fase 5 del plan de Fanny, 2026-09-30): proyecto.html?id=<proyecto>&sesion=<sesión>.

	"Fanny necesita ver en el proyecto bien organizado lo que hará cada quién, no hasta la sección Hoy, para hacer bien
	su planeación y tomar en cuenta cuánto va a necesitar de material según quién realizará la actividad." Por cada
	sesión, como la tarjeta 3 de Hoy:
	  - número, campo formativo, horario (sesiones.duracion) y estado: "Pendiente", "En curso desde…" o "Terminada"
	    (con el día en que se trabajó). La regla es la de Hoy: SesionTerminar.enCurso con su corte (CORTE_EN_CURSO):
	    una sesión con fecha anterior al corte cuenta como terminada;
	  - la secuencia (inicio, desarrollo y cierre, sus tareas y sus anexos y libros: js/secuencia-sesion.js); los
	    libros se abren en el visor (js/visor-recursos.js) y Drive y lo demás en otra pestaña;
	  - las actividades calificables (productos_sesion activos): nombre, qué es (actividad en clase o tarea, con el día
	    en que se revisa) y quién la hace (ParaQuien.quienHace: "Tarjeta de nombre · Morado: ANGELA, DILAN" o "1° (todos)"),
	    cuántos alumnos son (para el material) y cuántos ya tienen calificación; arriba, el resumen para el material.
	  - Con ?sesion=, la vista baja a esa sesión, la abre y la resalta.
	Desde aquí, con las MISMAS tablas y RPC que Hoy (lo de aquí aparece en Hoy y al revés):
	  - Agregar: "+ Actividad o tarea" (js/actividad-nueva.js, el diálogo de Hoy) solo dentro de esa sesión
	    (soloDentro). En una sesión que aún no se trabaja, una tarea se revisa el siguiente día de clase después de
	    trabajarla, como las del plan (revisaAlTrabajar). Una sesión TERMINADA no ofrece agregar: lo nuevo no aparecería
	    en Hoy para calificarlo (Hoy solo muestra las sesiones de hoy y las que siguen en curso).
	  - Renombrar y Quitar: js/producto-acciones.js (el mismo código de Hoy: Quitar revisa dos veces que nadie lo haya
	    calificado y la base lo rechaza con "producto_con_calificaciones").
	  - Para quién: ParaQuien.elegir con guardar_asignacion_producto; quien ya tiene calificación sale bloqueado
	    (ParaQuien.bloqueados) y la base lo revisa otra vez.
	  - Una sesión ya trabajada (con fecha o con calificaciones) dice "Esta sesión ya se trabajó: su plan no cambia; sus
	    actividades calificables sí". "Editar el plan" lleva a Crear proyecto en esa sesión.
	  - Los botones de captura llevan data-captura: en solo lectura (b21, js/mi-salon-acceso.js) se ven deshabilitados.
	Necesita señal para agregar, renombrar, quitar y cambiar para quién (como en Hoy, no van por la cola).

	Arriba, reglas puras (window.ProyectoVista y module.exports; pruebas/proyecto-vista.test.js): fechaCorta,
	estadoSesion, trabajada, ordenarProductos, tipoTexto, estaCalificado, filaProducto, resumenMaterial, conteoSesion,
	htmlSesion, htmlIndice, textoError. Abajo, la página.
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;
	var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function dia(f) { return String(f || "").slice(0, 10); }

	// "2026-09-29" → "29 sep"
	function fechaCorta(iso) {
		var m = dia(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
		return m ? Number(m[3]) + " " + MESES[Number(m[2]) - 1] : "";
	}

	// "1, 2 y 3"
	function listaY(xs) {
		if (xs.length <= 1) return xs.join("");
		return xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];
	}
	function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

	/*
		El estado de una sesión, con la misma regla de Hoy (js/sesion-terminar.js):
		  en curso  → con fecha, sin terminar y desde el corte: "En curso desde hoy" / "En curso desde el 29 sep";
		  terminada → completada, o con fecha anterior al corte (Fanny las trabajó antes de "Terminar sesión"):
		              "Terminada" y "Se trabajó el 29 sep" (la base no guarda el día en que se terminó: es el día en
		              que se trabajó; si se continuó otro día, el primero);
		  pendiente → sin fecha ("Iniciar" el proyecto la deja activa y sin fecha: sigue pendiente).
		→ { clave: "pendiente" | "en_curso" | "terminada", texto, detalle }
	*/
	function estadoSesion(s, hoy, corte) {
		if (!s) return { clave: "pendiente", texto: "Pendiente", detalle: "" };
		var ST = raiz.SesionTerminar;
		var enCurso = ST ? ST.enCurso(s, corte) : (!!s.fecha && s.estado_sesion !== "completada");
		if (enCurso) {
			return { clave: "en_curso", texto: dia(s.fecha) === dia(hoy) ? "En curso desde hoy" : "En curso desde el " + fechaCorta(s.fecha), detalle: "" };
		}
		if (s.estado_sesion === "completada" || s.fecha) {
			return { clave: "terminada", texto: "Terminada", detalle: s.fecha ? "Se trabajó el " + fechaCorta(s.fecha) : "" };
		}
		return { clave: "pendiente", texto: "Pendiente", detalle: "" };
	}

	// Trabajada = con fecha o con calificaciones (la regla de Crear proyecto: ProyectoEdicion.sesionTrabajada)
	function trabajada(s, conCalificaciones) {
		if (raiz.ProyectoEdicion && raiz.ProyectoEdicion.sesionTrabajada) return raiz.ProyectoEdicion.sesionTrabajada(s, conCalificaciones);
		return !!(s && (s.fecha || (conCalificaciones && s.id && conCalificaciones[s.id])));
	}

	// Como en Hoy: por orden y, a igual orden (los trabajos por grado del plan), de menor a mayor grado
	function ordenarProductos(lista) {
		function primerGrado(p) {
			var g = (p.grados || []).map(Number).filter(function (x) { return x >= 1 && x <= 6; });
			return g.length ? Math.min.apply(null, g) : 9;
		}
		return (lista || []).slice().sort(function (a, b) {
			return (a.orden || 0) - (b.orden || 0) || primerGrado(a) - primerGrado(b) ||
				String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id));
		});
	}

	var TIPOS = { trabajo: "Actividad en clase", tarea: "Tarea para casa", producto_final: "Producto final", examen: "Examen", otro: "Otra actividad" };
	function tipoTexto(p) { return TIPOS[p && p.tipo] || "Actividad en clase"; }
	function esTarea(p) { return !!p && p.tipo === "tarea"; }

	// Calificado = semáforo, estado de entrega o puntaje (la misma cuenta de "N de M calificados" de Hoy)
	function estaCalificado(cal) {
		return !!(cal && (cal.nivel || cal.estado_entrega || (cal.puntaje !== null && cal.puntaje !== undefined)));
	}

	/*
		Un renglón de la lista de actividades de una sesión: quién lo hace (ParaQuien.quienHace), cuántos ya tienen
		calificación y, en una tarea, cuándo se revisa (AlcanceHoy.venceTarea: su día o el siguiente día de clase
		después de la sesión). v: { alumnos, asignaciones, calIdx, ajustes, hoy }
	*/
	function filaProducto(p, ses, v) {
		var quien = raiz.ParaQuien.quienHace(p, (v.asignaciones || {})[p.id] || {}, v.alumnos || []);
		var calificados = (v.alumnos || []).filter(function (a) { return estaCalificado((v.calIdx || {})[a.id + "|" + p.id]); }).length;
		var vence = null;
		if (esTarea(p)) {
			var f = raiz.AlcanceHoy.venceTarea(p.fecha_entrega, ses && ses.fecha, v.ajustes || []);
			vence = f ? (f === v.hoy ? "se revisa hoy" : "se revisa el " + fechaCorta(f)) : "se revisa el día de clase siguiente a la sesión";
		}
		return { producto: p, quien: quien, corto: raiz.ParaQuien.quienHaceCorto(quien), calificados: calificados, vence: vence };
	}

	// Para el material: "3 actividades en clase: 2, 8 y 6 alumnos · 2 tareas: 9 y 7 alumnos"
	function resumenMaterial(filas) {
		function parte(lista, uno, varios) {
			if (!lista.length) return "";
			var ns = lista.map(function (f) { return f.quien.n; });
			var ultimo = ns[ns.length - 1];
			return plural(lista.length, uno, varios) + ": " + listaY(ns.map(String)) + (ns.length === 1 && ultimo === 1 ? " alumno" : " alumnos");
		}
		var enClase = (filas || []).filter(function (f) { return !esTarea(f.producto); });
		var tareas = (filas || []).filter(function (f) { return esTarea(f.producto); });
		return [parte(enClase, "actividad en clase", "actividades en clase"), parte(tareas, "tarea", "tareas")].filter(Boolean).join(" · ");
	}

	// "3 actividades en clase · 2 tareas" (en el encabezado de la sesión, también plegada)
	function conteoSesion(productos) {
		var t = (productos || []).filter(esTarea).length, a = (productos || []).length - t;
		if (!a && !t) return "Sin actividades calificables";
		return [a ? plural(a, "actividad en clase", "actividades en clase") : "", t ? plural(t, "tarea", "tareas") : ""].filter(Boolean).join(" · ");
	}

	// ── HTML ─────────────────────────────────────────────────────────────────
	function chevron(abierto) {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5 shrink-0 mt-0.5 text-gray-400 transition-transform" + (abierto ? " rotate-90" : "") +
			"' data-chevron viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m9 6 6 6-6 6'/></svg>";
	}
	function iconoMas() {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 5v14'/><path d='M5 12h14'/></svg>";
	}
	function iconoLapiz() {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>";
	}

	var CLASE_ESTADO = {
		pendiente: "bg-gray-100 text-gray-700 border-gray-200",
		en_curso: "bg-blue-100 text-blue-800 border-blue-200",
		terminada: "bg-emerald-50 text-emerald-800 border-emerald-200",
	};

	// Para quién, Renombrar y Quitar (con data-captura: en solo lectura se ven deshabilitados). Los de Hoy, 44 px
	function botonesProducto(p) {
		return "<div class='flex flex-wrap gap-1 mt-1'>" +
			"<button type='button' data-captura data-para-quien='" + esc(p.id) + "' aria-label='Para quién es " + esc(p.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-gray-600 hover:bg-gray-100'>Para quién</button>" +
			"<button type='button' data-captura data-renombrar='" + esc(p.id) + "' aria-label='Renombrar " + esc(p.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-gray-600 hover:bg-gray-100'>Renombrar</button>" +
			"<button type='button' data-captura data-quitar-producto='" + esc(p.id) + "' aria-label='Quitar " + esc(p.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-red-600 hover:bg-red-50'>Quitar</button></div>";
	}

	/*
		Quién lo hace: con más de 3 nombres, los 3 primeros y "+ N más" (un botón que despliega la lista completa en el
		mismo renglón y la vuelve a plegar). data-quien lleva siempre el texto visible.
	*/
	function quienHtml(f) {
		var c = f.corto || { corto: f.quien.texto, resto: [], n: 0 };
		if (!c.resto.length) return "<span class='text-gray-700' data-quien>: " + esc(f.quien.texto) + "</span>";
		var primeros = c.corto.slice(0, c.corto.length - (" + " + c.n + " más").length);
		return "<span class='text-gray-700' data-quien>: <span data-quien-texto>" + esc(primeros) + "</span> " +
			"<button type='button' data-quien-mas='" + c.n + "' data-corto='" + esc(primeros) + "' data-completo='" + esc(f.quien.texto) + "' " +
			"aria-expanded='false' aria-label='" + etiquetaVerMas(c.n) + "' " +
			"class='inline-flex items-center min-h-[44px] px-2 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600'>+ " + c.n + " más</button></span>";
	}

	function etiquetaVerMas(n) { return Number(n) === 1 ? "Ver 1 alumno más" : "Ver los " + n + " alumnos más"; }

	// El botón "+ N más": despliega o pliega los nombres en el mismo renglón (sin repintar)
	function alternarQuien(b) {
		var abierto = b.getAttribute("aria-expanded") === "true";
		var n = b.getAttribute("data-quien-mas");
		var texto = b.parentNode.querySelector("[data-quien-texto]");
		if (texto) texto.textContent = abierto ? b.getAttribute("data-corto") : b.getAttribute("data-completo");
		b.setAttribute("aria-expanded", abierto ? "false" : "true");
		b.setAttribute("aria-label", abierto ? etiquetaVerMas(n) : "Ver menos alumnos");
		b.textContent = abierto ? "+ " + n + " más" : "Ver menos";
	}

	function htmlProducto(f, ses) {
		var p = f.producto;
		var CF = raiz.CamposFormativos;
		// Una actividad de otro campo formativo (agregada en Hoy o aquí) lo dice
		var campoSesion = CF && ses ? CF.corto(ses.campo_formativo) : null;
		var otroCampo = p.campo && campoSesion && p.campo !== campoSesion ? (CF ? CF.largo(p.campo) : p.campo) : "";
		return "<li class='py-3' data-producto-vista='" + esc(p.id) + "'>" +
			"<p class='text-sm text-gray-800 break-words'><span class='font-semibold'>" + esc(p.nombre || "Sin nombre") + "</span>" +
			quienHtml(f) + "</p>" +
			"<p class='mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5'>" +
			"<span data-tipo>" + esc(tipoTexto(p)) + (f.vence ? " · " + esc(f.vence) : "") + "</span>" +
			"<span class='font-semibold text-gray-700' data-cuantos>" + esc(plural(f.quien.n, "alumno", "alumnos")) + "</span>" +
			"<span data-calificados>" + esc(plural(f.calificados, "calificado", "calificados")) + "</span>" +
			(otroCampo ? "<span>" + esc(otroCampo) + "</span>" : "") +
			"</p>" + botonesProducto(p) + "</li>";
	}

	function listaProductos(titulo, filas, ses) {
		if (!filas.length) return "";
		return "<p class='mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500'>" + esc(titulo) + "</p>" +
			"<ul class='divide-y divide-gray-100'>" + filas.map(function (f) { return htmlProducto(f, ses); }).join("") + "</ul>";
	}

	/*
		Una sesión. v: { proyecto, productosPorSesion, asignaciones, calIdx, conCalificaciones, alumnos, ajustes, hoy,
		corte, abiertas, pedida }. Plegada por omisión solo si ya terminó (lo que viene es lo que se planea); la pedida
		(?sesion=) sale abierta y resaltada.
	*/
	function htmlSesion(ses, v) {
		var est = estadoSesion(ses, v.hoy, v.corte);
		var abiertas = v.abiertas || {};
		var abierta = Object.prototype.hasOwnProperty.call(abiertas, ses.id) ? !!abiertas[ses.id] : (est.clave !== "terminada" || ses.id === v.pedida);
		var productos = ordenarProductos((v.productosPorSesion || {})[ses.id] || []);
		var filas = productos.map(function (p) { return filaProducto(p, ses, v); });
		var enClase = filas.filter(function (f) { return !esTarea(f.producto); });
		var tareas = filas.filter(function (f) { return esTarea(f.producto); });
		var num = ses.numero_sesion || "";
		var ss = raiz.SecuenciaSesion;
		var secuencia = ss && ss.hayContenido(ses) ? ss.html(ses)
			: "<p class='text-sm text-gray-500'>Esta sesión no trae secuencia registrada. Puedes escribirla en «Editar el plan».</p>";
		var puedeAgregar = est.clave !== "terminada";
		var cuerpoId = "cuerpo-ses-" + ses.id;

		var actividades = "<div class='pv-acts rounded-xl border border-gray-200 bg-gray-50/60 p-3' data-actividades-sesion='" + esc(ses.id) + "'>" +
			"<div class='flex flex-wrap items-center justify-between gap-2'>" +
			"<h3 class='text-sm font-semibold text-gray-800'>Actividades calificables</h3>" +
			(puedeAgregar
				? "<button type='button' data-captura data-agregar='" + esc(ses.id) + "' aria-label='Agregar actividad o tarea a la sesión " + esc(num) + "' " +
					"class='inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-blue-300 bg-white text-sm font-semibold text-blue-700 hover:bg-blue-50'>" + iconoMas() + "Actividad o tarea</button>"
				: "") +
			"</div>" +
			(filas.length
				? "<p class='mt-1 text-xs text-gray-600' data-material><span class='font-semibold'>Para el material:</span> " + esc(resumenMaterial(filas)) + "</p>"
				: "<p class='mt-2 text-sm text-gray-500'>Esta sesión no tiene actividades calificables." + (puedeAgregar ? " Agrega una con «Actividad o tarea»." : "") + "</p>") +
			listaProductos("En clase", enClase, ses) + listaProductos("Tareas para casa", tareas, ses) +
			(puedeAgregar ? "" : "<p class='mt-2 text-xs text-gray-500' data-sin-agregar>Sesión terminada: aquí ya no se agregan actividades, porque no aparecerían en Hoy para calificarlas. Sí puedes renombrarlas, quitarlas o cambiar para quién son.</p>") +
			"</div>";

		return "<section id='ses-" + esc(ses.id) + "' data-sesion-vista='" + esc(ses.id) + "' data-estado='" + est.clave + "'" + (ses.id === v.pedida ? " data-sesion-pedida" : "") +
			" class='scroll-mt-20 bg-white rounded-2xl shadow-sm border " + (ses.id === v.pedida ? "border-blue-400 ring-2 ring-blue-400" : "border-gray-100") + "'>" +
			"<div class='flex flex-col sm:flex-row sm:items-start gap-2 p-3 sm:p-4'>" +
			"<button type='button' data-plegar='" + esc(ses.id) + "' aria-expanded='" + (abierta ? "true" : "false") + "' aria-controls='" + esc(cuerpoId) + "' " +
			"class='flex-1 min-w-0 min-h-[44px] flex items-start gap-2 text-left rounded-xl px-1 hover:bg-gray-50'>" + chevron(abierta) +
			"<span class='min-w-0'>" +
			"<span class='block font-bold text-gray-800 break-words'>Sesión " + esc(num) + " · " + esc(ses.campo_formativo || "Sin campo formativo") + "</span>" +
			(ses.duracion ? "<span class='block text-sm text-gray-600' data-horario>" + esc(ses.duracion) + "</span>" : "") +
			(ses.momento ? "<span class='block text-xs text-gray-400'>" + esc(ses.momento) + "</span>" : "") +
			"<span class='block text-xs text-gray-500 mt-0.5' data-conteo>" + esc(conteoSesion(productos)) + "</span>" +
			"</span></button>" +
			"<span class='shrink-0 self-start sm:self-auto flex flex-col items-start sm:items-end gap-0.5 px-1'>" +
			"<span data-estado-sesion='" + est.clave + "' class='inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold " + CLASE_ESTADO[est.clave] + "'>" + esc(est.texto) + "</span>" +
			(est.detalle ? "<span class='text-xs text-gray-500'>" + esc(est.detalle) + "</span>" : "") +
			"</span></div>" +
			"<div id='" + esc(cuerpoId) + "' class='" + (abierta ? "" : "hidden ") + "border-t border-gray-100 p-3 sm:p-4'>" +
			(trabajada(ses, v.conCalificaciones)
				? "<p data-aviso-trabajada class='mb-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3'>Esta sesión ya se trabajó: su plan no cambia; sus actividades calificables sí.</p>"
				: "") +
			"<div class='pv-cols'>" + actividades +
			"<div class='pv-sec flex-1 min-w-0'><h3 class='text-sm font-semibold text-gray-800 mb-2'>Secuencia de la sesión</h3>" + secuencia + "</div>" +
			"</div>" +
			"<div class='mt-3 pt-3 border-t border-gray-100 flex flex-wrap justify-end gap-2'>" +
			// Enlace relativo: en la app instalada no sale de /salon/
			"<a href='crear_proyecto.html?id=" + encodeURIComponent((v.proyecto && v.proyecto.id) || ses.proyecto_id || "") + "&sesion=" + encodeURIComponent(ses.id) + "' data-editar-plan='" + esc(ses.id) + "' " +
			"class='inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50'>" + iconoLapiz() + "Editar el plan</a>" +
			"</div></div></section>";
	}

	// El índice: un botón por sesión con su estado, y "Abrir todas" / "Plegar todas"
	function htmlIndice(sesiones, v) {
		var cuenta = { pendiente: 0, en_curso: 0, terminada: 0 };
		var chips = (sesiones || []).map(function (s) {
			var est = estadoSesion(s, v.hoy, v.corte);
			cuenta[est.clave]++;
			var clase = est.clave === "en_curso" ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
				: est.clave === "terminada" ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
				: "bg-white border-gray-300 text-gray-700 hover:bg-gray-50";
			return "<a href='#ses-" + esc(s.id) + "' data-ir-sesion='" + esc(s.id) + "' aria-label='Sesión " + esc(s.numero_sesion || "") + ": " + esc(est.texto) + "' " +
				"class='inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 rounded-xl border text-sm font-semibold " + clase + "'>" + esc(s.numero_sesion || "") + "</a>";
		}).join("");
		var partes = [];
		if (cuenta.terminada) partes.push(plural(cuenta.terminada, "terminada", "terminadas"));
		if (cuenta.en_curso) partes.push(cuenta.en_curso + " en curso");
		if (cuenta.pendiente) partes.push(plural(cuenta.pendiente, "pendiente", "pendientes"));
		return "<div class='flex flex-wrap items-center justify-between gap-2 mb-3'>" +
			"<h2 class='font-bold text-gray-800'>" + esc(plural((sesiones || []).length, "sesión", "sesiones")) + "</h2>" +
			"<p class='text-xs text-gray-500' data-cuenta-estados>" + esc(partes.join(" · ")) + "</p></div>" +
			"<div class='flex flex-wrap gap-2'>" + chips + "</div>" +
			"<div class='mt-3 flex flex-wrap gap-2'>" +
			"<button type='button' data-abrir-todas class='min-h-[44px] px-4 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50'>Abrir todas</button>" +
			"<button type='button' data-plegar-todas class='min-h-[44px] px-4 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50'>Plegar todas</button>" +
			"</div>";
	}

	/*
		Por qué falló algo, en español y sin tecnicismos (la misma regla de Hoy). El texto técnico va solo a la consola;
		los mensajes propios de las funciones y triggers de la base ya vienen en español y se muestran tal cual.
	*/
	function textoError(e) {
		if (e && typeof console !== "undefined") console.warn("proyecto: detalle del error", e);
		var code = e && e.code ? String(e.code) : "";
		var msg = String((e && e.message) || "");
		if (raiz.MiSalonAcceso && raiz.MiSalonAcceso.esErrorSoloLectura && raiz.MiSalonAcceso.esErrorSoloLectura(e)) {
			return "tu acceso a Mi Salón no está activo (solo lectura)";
		}
		if (/^(42703|42P01|42883|PGRST20[0-5])$/.test(code) || /does not exist|schema cache|could not find/i.test(msg)) {
			return "la base de datos todavía no tiene la actualización que usa esta pantalla; avisa a soporte@jissez.com";
		}
		if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out/i.test(msg)) {
			return "no hubo conexión con el servidor";
		}
		if (/jwt|token/i.test(msg) || code === "PGRST301" || code === "PGRST303") return "tu sesión venció; vuelve a entrar";
		if (!msg || /\b(violates|permission denied|duplicate key|invalid input|null value|syntax error|unexpected|column|relation|function|failed|error)\b/i.test(msg)) {
			return code === "42501" ? "la base no lo permitió" : "hubo un error en el servidor";
		}
		return msg.replace(/\.$/, "");
	}

	var api = {
		fechaCorta: fechaCorta, estadoSesion: estadoSesion, trabajada: trabajada, ordenarProductos: ordenarProductos,
		tipoTexto: tipoTexto, estaCalificado: estaCalificado, filaProducto: filaProducto, resumenMaterial: resumenMaterial,
		conteoSesion: conteoSesion, htmlSesion: htmlSesion, htmlIndice: htmlIndice, textoError: textoError,
	};
	raiz.ProyectoVista = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;

	// ── La página ────────────────────────────────────────────────────────────
	if (typeof document === "undefined" || !document.addEventListener) return;

	document.addEventListener("DOMContentLoaded", async function () {
		if (!window.sb) { window.location.href = "index.html"; return; }

		var params = new URLSearchParams(window.location.search || "");
		var idProyecto = params.get("id");
		var estadoEl = document.getElementById("proyectoEstado");
		var indiceEl = document.getElementById("proyectoIndice");
		var sesionesEl = document.getElementById("proyectoSesiones");
		var mensajeEl = document.getElementById("proyectoMensaje");
		// Sin la cola de Hoy: lo que no se pudo hacer no queda guardado en el aparato
		var TEXTO_SIN_SENAL = "Esto necesita señal. Inténtalo cuando vuelva la señal.";

		var user = null, grupo = null, proyecto = null;
		var v = {
			proyecto: null, alumnos: [], sesiones: [], productosPorSesion: {}, asignaciones: {}, calIdx: {}, conCalificaciones: {},
			ajustes: [], hoy: fechaHoy(), corte: window.SesionTerminar ? window.SesionTerminar.CORTE_EN_CURSO : undefined,
			abiertas: {}, pedida: params.get("sesion") || null,
		};

		function fechaHoy() {
			var ahora = new Date();
			return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
		}

		function mensaje(tipo, texto) {
			if (!mensajeEl) return;
			if (!texto) { mensajeEl.classList.add("hidden"); return; }
			mensajeEl.className = "rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-blue-50 text-blue-800 border border-blue-200");
			mensajeEl.textContent = texto;
			mensajeEl.classList.remove("hidden");
		}
		function irAlMensaje() {
			if (!mensajeEl || !mensajeEl.scrollIntoView) return;
			mensajeEl.style.scrollMarginTop = "5rem"; // la barra de arriba es fija
			mensajeEl.setAttribute("tabindex", "-1");
			mensajeEl.scrollIntoView({ block: "start", behavior: "smooth" });
			try { mensajeEl.focus({ preventScroll: true }); } catch (_) { /* sin foco */ }
		}
		// Un error de algo que se tocó abajo: arriba y a la vista
		function avisoALaVista(texto) {
			mensaje("error", texto);
			irAlMensaje();
		}
		// Lo que salió bien: una línea que flota abajo unos segundos (la lista ya cambió donde se tocó)
		var avisoTimer = null;
		function avisoBien(texto) {
			var el = document.getElementById("proyectoAviso");
			if (!el) {
				el = document.createElement("div");
				el.id = "proyectoAviso";
				el.setAttribute("role", "status");
				el.setAttribute("aria-live", "polite");
				el.className = "fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-lg pointer-events-none";
				document.body.appendChild(el);
			}
			el.textContent = texto;
			el.classList.remove("hidden");
			clearTimeout(avisoTimer);
			avisoTimer = setTimeout(function () { el.classList.add("hidden"); }, 6000);
		}
		// El "mensaje" que usan las acciones compartidas: los errores, a la vista; lo demás, abajo
		function mensajeAccion(tipo, texto) {
			if (tipo === "error") avisoALaVista(texto);
			else avisoBien(texto);
		}
		function sinSenal() {
			return typeof navigator !== "undefined" && navigator.onLine === false;
		}
		function sinProyecto(texto) {
			if (estadoEl) {
				estadoEl.innerHTML = "<p class='text-base text-gray-600'>" + esc(texto) + "</p>" +
					"<a href='planeacion.html' class='mt-3 inline-flex items-center min-h-[44px] px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700'>Ir a Proyectos</a>";
			}
			var h1 = document.getElementById("proyectoTitulo");
			if (h1) h1.textContent = "Proyecto";
		}

		// ── Carga ──
		var authRes = await window.sb.auth.getUser();
		if (authRes.error || !authRes.data.user) { window.location.href = "index.html"; return; }
		user = authRes.data.user;
		if (!idProyecto) { sinProyecto("Elige un proyecto en Proyectos para verlo aquí."); return; }

		try {
			grupo = (await window.GrupoActivo.cargar(window.sb, user.id)).grupo;
			if (!grupo) { window.location.href = "onboarding.html"; return; }
			proyecto = await window.Lectura.uno(window.sb.from("proyectos")
				.select("id, titulo, grupo_id, trimestre, grados, campos_formativos, estado, tipo")
				.eq("id", idProyecto).eq("maestro_id", user.id).maybeSingle());
			// No existe, o es "Actividades del trimestre" (no es un proyecto), o es de otro grupo (se cambió el grupo en
			// el menú: la pantalla se recarga con el grupo nuevo): a Proyectos, como Crear proyecto
			if (!proyecto || proyecto.tipo === "sueltas" || proyecto.grupo_id !== grupo.id) { window.location.href = "planeacion.html"; return; }
			v.proyecto = proyecto;
			v.alumnos = (await window.Lectura.uno(window.sb.from("alumnos")
				.select("id, nombre_completo, num_lista, grado, created_at")
				.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("estatus", "activo")
				.order("grado").order("num_lista"))) || [];
			v.alumnos.forEach(function (a) { a.alta = window.AlcanceHoy.fechaAlta(a.created_at, grupo.created_at); });
			v.ajustes = await window.AlcanceHoy.leerAjustesCalendario(window.sb, user.id, grupo.id);
			await leerSesionesYProductos();
		} catch (err) {
			// No se pudo leer: el aviso común con Reintentar, sin dibujar nada a medias
			window.Lectura.detenerPagina(err);
			return;
		}

		// Las sesiones del proyecto con su secuencia, sus productos activos, su "para quién" y sus calificaciones
		async function leerSesionesYProductos() {
			var columnas = window.SecuenciaSesion.COLUMNAS + ", proyecto_id, numero_sesion, fecha, campo_formativo, momento, duracion, estado_sesion";
			var sesiones = await window.LeerTodo.paginas(function () {
				return window.sb.from("sesiones").select(columnas)
					.eq("proyecto_id", proyecto.id).eq("maestro_id", user.id).order("numero_sesion").order("id");
			});
			var ids = sesiones.map(function (s) { return s.id; });
			var productos = ids.length ? await window.AlcanceHoy.leerPorLotes(ids, function (lote) {
				return window.sb.from("productos_sesion")
					.select("id, sesion_id, tipo, nombre, grados, modalidad, campo, fecha_entrega, orden, origen, created_at")
					.in("sesion_id", lote).eq("activo", true).order("orden").order("id");
			}) : [];
			var idsProd = productos.map(function (p) { return p.id; });
			var asig = idsProd.length ? await window.AlcanceHoy.leerPorLotes(idsProd, function (lote) {
				return window.sb.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo")
					.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id");
			}) : [];
			// Las calificaciones del proyecto: "N calificados", quién queda bloqueado en "Para quién" y qué sesiones ya se
			// trabajaron (con calificaciones: la regla de Crear proyecto)
			var cals = await window.LeerTodo.paginas(function () {
				return window.sb.from("calificaciones")
					.select("id, alumno_id, producto_sesion_id, sesion_id, estado_entrega, nivel, puntaje, retroalimentacion")
					.eq("maestro_id", user.id).eq("proyecto_id", proyecto.id).order("id");
			});
			v.sesiones = sesiones.sort(function (a, b) {
				return (Number(a.numero_sesion) || 0) - (Number(b.numero_sesion) || 0) || String(a.id).localeCompare(String(b.id));
			});
			v.productosPorSesion = {};
			productos.forEach(function (p) { (v.productosPorSesion[p.sesion_id] = v.productosPorSesion[p.sesion_id] || []).push(p); });
			v.asignaciones = window.AlcanceHoy.indiceAsignaciones(asig);
			v.calIdx = window.ParaQuien.indiceCalificaciones(cals);
			v.conCalificaciones = {};
			cals.forEach(function (c) { if (c.sesion_id) v.conCalificaciones[c.sesion_id] = true; });
		}

		function sesionPorId(id) { return v.sesiones.filter(function (s) { return s.id === id; })[0] || null; }
		function productoPorId(id) {
			var hallado = null;
			Object.keys(v.productosPorSesion).forEach(function (sid) {
				(v.productosPorSesion[sid] || []).forEach(function (p) { if (p.id === id) hallado = p; });
			});
			return hallado;
		}

		// ── Dibujo ──
		var ESTADOS_PROYECTO = { activo: "Activo", borrador: "Borrador", pausado: "Pausado", completado: "Completado" };
		function pintarEncabezado() {
			document.getElementById("proyectoTitulo").textContent = proyecto.titulo || "Proyecto sin título";
			var grados = window.ProductosHoy.etiquetaGrados(proyecto.grados || []);
			document.getElementById("proyectoSubtitulo").textContent = [
				proyecto.trimestre ? "Trimestre " + proyecto.trimestre : "", grados, plural(v.sesiones.length, "sesión", "sesiones"),
				ESTADOS_PROYECTO[proyecto.estado] || "",
			].filter(Boolean).join(" · ");
			var editar = document.getElementById("proyectoEditar");
			if (editar) {
				editar.setAttribute("href", "crear_proyecto.html?id=" + encodeURIComponent(proyecto.id));
				editar.classList.remove("hidden");
			}
		}

		function pintar(enfocar) {
			if (!v.sesiones.length) {
				indiceEl.classList.add("hidden");
				sesionesEl.innerHTML = "<div class='bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-gray-600'>Este proyecto todavía no tiene sesiones. " +
					"<a href='crear_proyecto.html?id=" + encodeURIComponent(proyecto.id) + "' class='inline-flex items-center min-h-[44px] px-2 font-semibold text-blue-700 underline'>Agrégalas en «Editar el plan»</a></div>";
				return;
			}
			indiceEl.innerHTML = htmlIndice(v.sesiones, v);
			indiceEl.classList.remove("hidden");
			sesionesEl.innerHTML = v.sesiones.map(function (s) { return htmlSesion(s, v); }).join("");
			if (enfocar) {
				// Después de que el diálogo se cierra (devuelve el foco a su botón, que ya se volvió a dibujar)
				setTimeout(function () {
					var el = document.querySelector(enfocar);
					if (el && el.focus) { try { el.focus({ preventScroll: false }); } catch (_) { el.focus(); } }
				}, 0);
			}
		}

		// Abrir o plegar una sesión sin volver a dibujar (el foco y el desplazamiento se quedan)
		function ponerAbierta(id, abrir) {
			v.abiertas[id] = abrir;
			var cuerpo = document.getElementById("cuerpo-ses-" + id);
			if (cuerpo) cuerpo.classList.toggle("hidden", !abrir);
			var btn = sesionesEl.querySelector("button[data-plegar='" + id + "']");
			if (btn) {
				btn.setAttribute("aria-expanded", abrir ? "true" : "false");
				var flecha = btn.querySelector("[data-chevron]");
				if (flecha) flecha.classList.toggle("rotate-90", abrir);
			}
		}
		function irASesion(id, suave) {
			var el = document.getElementById("ses-" + id);
			if (!el) return;
			ponerAbierta(id, true);
			el.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
		}

		// ── Acciones (las mismas tablas y RPC que Hoy) ──
		function gradosDeLaSesion(ses) {
			var deProductos = [];
			(v.productosPorSesion[ses.id] || []).forEach(function (p) { deProductos = deProductos.concat(p.grados || []); });
			return window.ProductosHoy.gradosPorOmision(deProductos, proyecto.grados || [], grupo.grados || []);
		}
		function rangoTrimestre() {
			return window.ProductosHoy.rangoTrimestre(grupo.trimestre_actual, v.hoy, {
				calendarios: window.CalendarioEscolar ? window.CalendarioEscolar.CALENDARIOS : [],
				ciclo: window.CalendarioSEP ? window.CalendarioSEP.cicloDe(v.hoy) : null,
			});
		}

		// "+ Actividad o tarea" en ESA sesión: el diálogo de Hoy (js/actividad-nueva.js), solo dentro del proyecto
		function agregar(ses, origen) {
			if (!ses) return;
			if (estadoSesion(ses, v.hoy, v.corte).clave === "terminada") return;
			if (sinSenal()) { avisoALaVista("Agregar una actividad o una tarea necesita señal. Inténtalo cuando vuelva la señal."); return; }
			if (!window.ActividadNueva || !window.ParaQuien) { avisoALaVista("No se pudo abrir el diálogo para agregar. Recarga la página."); return; }
			var porId = {};
			porId[proyecto.id] = proyecto;
			window.ActividadNueva.abrir({
				sb: window.sb, grupo: grupo, alumnos: v.alumnos, hoy: v.hoy, ajustesCal: v.ajustes,
				sesiones: [ses], sesionId: ses.id, sesionSuelta: null, modo: "dentro",
				soloDentro: true, revisaAlTrabajar: true,
				proyectoPorId: porId, gradosDeLaSesion: gradosDeLaSesion, rango: rangoTrimestre(),
				sinSenal: sinSenal, textoSinSenal: TEXTO_SIN_SENAL, textoError: textoError, origen: origen,
				alAgregar: function (r) {
					var nuevo = r.nuevo;
					(v.productosPorSesion[ses.id] = v.productosPorSesion[ses.id] || []).push(nuevo);
					v.asignaciones[nuevo.id] = window.AlcanceHoy.indiceAsignaciones((r.filas || []).map(function (f) {
						return { producto_sesion_id: nuevo.id, alumno_id: f.alumno_id, modo: f.modo };
					}))[nuevo.id] || {};
					v.abiertas[ses.id] = true;
					pintar("button[data-para-quien='" + nuevo.id + "']");
					var quien = window.ParaQuien.quienHace(nuevo, v.asignaciones[nuevo.id], v.alumnos);
					var enHoy = estadoSesion(ses, v.hoy, v.corte).clave === "en_curso"
						? " Ya aparece en Hoy para calificarla." : " Aparece en Hoy cuando trabajes esta sesión.";
					avisoBien((nuevo.tipo === "tarea" ? "Se agregó la tarea «" : "Se agregó la actividad «") + nuevo.nombre + "» para " +
						(quien.porNombre ? plural(quien.n, "alumno", "alumnos") : quien.texto) + "." + enHoy +
						(r.sinPda ? " No se pudieron leer los PDA de la sesión: se agregó sin PDA." : ""));
				},
			});
		}

		// Renombrar y Quitar: el módulo compartido con Hoy (js/producto-acciones.js)
		function accionesDe(producto, origen) {
			return {
				sb: window.sb, maestroId: user.id, producto: producto, origen: origen,
				sinSenal: sinSenal, textoSinSenal: TEXTO_SIN_SENAL, textoError: textoError,
				avisoALaVista: avisoALaVista, mensaje: mensajeAccion,
			};
		}
		function renombrar(producto, origen) {
			if (!producto) return;
			window.ProductoAcciones.renombrar(Object.assign(accionesDe(producto, origen), {
				alRenombrar: function () { pintar("button[data-renombrar='" + producto.id + "']"); },
			}));
		}
		async function quitar(producto, origen) {
			if (!producto) return;
			await window.ProductoAcciones.quitar(Object.assign(accionesDe(producto, origen), {
				// Lo que ya se leyó de la base (esta pantalla no captura): el módulo vuelve a revisar la base dos veces
				conCaptura: function () {
					return v.alumnos.some(function (al) { return window.ProductosHoy.tieneCaptura(v.calIdx[al.id + "|" + producto.id]); });
				},
				alQuitar: function () {
					var lista = v.productosPorSesion[producto.sesion_id] || [];
					v.productosPorSesion[producto.sesion_id] = lista.filter(function (p) { return p.id !== producto.id; });
					pintar("section[data-sesion-vista='" + producto.sesion_id + "'] button[data-plegar]");
				},
			}));
		}

		/*
			"Para quién" de un producto ya creado (como en Hoy y en Crear proyecto): agregar alumnos siempre se puede;
			quitar, solo a quien no tiene calificación (su casilla sale bloqueada y la base lo revisa otra vez:
			guardar_asignacion_producto). Sus grados no cambian (ProductosHoy.filasDeEdicion).
		*/
		function cambiarParaQuien(producto, origen) {
			if (!producto) return;
			if (sinSenal()) { avisoALaVista("Cambiar para quién es necesita señal. Inténtalo cuando vuelva la señal."); return; }
			var marcados = {};
			v.alumnos.forEach(function (a) { if (window.AlcanceHoy.asignadoA(a, producto, v.asignaciones)) marcados[a.id] = true; });
			var deGrados = window.ProductosHoy.etiquetaGrados(producto.grados);
			window.ParaQuien.elegir({
				origen: origen,
				titulo: "¿Para quién es «" + producto.nombre + "»?",
				subtitulo: "Marca a los alumnos que la hacen. Cada uno sigue en su grado para la boleta." +
					(deGrados ? " La actividad es de " + deGrados + "." : ""),
				aceptar: "Guardar",
				alumnos: v.alumnos,
				marcados: marcados,
				bloqueados: window.ParaQuien.bloqueados(producto.id, v.alumnos, v.calIdx),
				alGuardar: async function (quieren, avisar) {
					if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
					var filas = window.ProductosHoy.filasDeEdicion(producto.grados, v.alumnos, quieren);
					var res = await window.sb.rpc("guardar_asignacion_producto", { p_producto: producto.id, p_filas: filas });
					if (res.error) {
						avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo guardar: " + textoError(res.error) + ".");
						return false;
					}
					var idx = {};
					filas.forEach(function (f) { idx[f.alumno_id] = f.modo; });
					v.asignaciones[producto.id] = idx;
					pintar("button[data-para-quien='" + producto.id + "']");
					var quien = window.ParaQuien.quienHace(producto, idx, v.alumnos);
					avisoBien("«" + producto.nombre + "» ahora es para " + (quien.porNombre ? plural(quien.n, "alumno", "alumnos") : quien.texto) + ".");
				},
			});
		}

		sesionesEl.addEventListener("click", async function (e) {
			var mas = e.target.closest("button[data-quien-mas]");
			if (mas) { e.stopPropagation(); alternarQuien(mas); return; }
			var b = e.target.closest("button[data-plegar]");
			if (b) { ponerAbierta(b.dataset.plegar, b.getAttribute("aria-expanded") !== "true"); return; }
			b = e.target.closest("button[data-agregar]");
			if (b) { agregar(sesionPorId(b.dataset.agregar), b); return; }
			b = e.target.closest("button[data-para-quien]");
			if (b) { cambiarParaQuien(productoPorId(b.dataset.paraQuien), b); return; }
			b = e.target.closest("button[data-renombrar]");
			if (b) { renombrar(productoPorId(b.dataset.renombrar), b); return; }
			b = e.target.closest("button[data-quitar-producto]");
			if (b) { await quitar(productoPorId(b.dataset.quitarProducto), b); return; }
		});

		indiceEl.addEventListener("click", function (e) {
			var a = e.target.closest("a[data-ir-sesion]");
			if (a) {
				e.preventDefault();
				irASesion(a.dataset.irSesion, true);
				var btn = sesionesEl.querySelector("button[data-plegar='" + a.dataset.irSesion + "']");
				if (btn) { try { btn.focus({ preventScroll: true }); } catch (_) { btn.focus(); } }
				return;
			}
			if (e.target.closest("button[data-abrir-todas]")) { v.sesiones.forEach(function (s) { ponerAbierta(s.id, true); }); return; }
			if (e.target.closest("button[data-plegar-todas]")) { v.sesiones.forEach(function (s) { ponerAbierta(s.id, false); }); }
		});

		// ── Arranque ──
		if (estadoEl) estadoEl.classList.add("hidden");
		pintarEncabezado();
		pintar();
		// ?sesion=: se baja a esa sesión (ya sale abierta y resaltada). Tras pintar: el texto de la secuencia mueve lo de abajo
		if (v.pedida && sesionPorId(v.pedida)) {
			setTimeout(function () { irASesion(v.pedida, false); }, 250);
		}
	});
})();
