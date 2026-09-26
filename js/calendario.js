/*
	calendario.js — Pantalla "Calendario" de Mi Salón: calendario escolar SEP del grupo activo y
	rol de aseo (decisión de Jorge, 2026-09-25: organización del salón).

	Pestaña Calendario
	  - Vista de mes (lunes a domingo) con colores y leyenda por tipo de día (js/calendario-sep.js).
	  - Hoy y el próximo día sin clase, y cuántos días de clase tiene el ciclo con los ajustes.
	  - Tocar un día muestra qué es y, en un día hábil del periodo de clases, permite marcar una
	    suspensión propia del grupo (Suspensión, Festividad local u Otro, con motivo) o, en un día
	    oficial sin clase, marcar que el grupo SÍ tiene clase (ajuste de la autoridad educativa
	    local, LGE art. 87). Quitar un ajuste regresa al calendario oficial. Todo con confirmación.
	    Se guarda en calendario_ajustes (una fila por grupo y fecha).
	  - Pie con la fuente oficial (DOF) y la advertencia de que la entidad o la escuela lo ajustan.

	Pestaña Rol de aseo
	  - Mes, alumnos por día (1 a 5), con quién empieza (número de lista) y, si hay rol guardado del
	    mes anterior, "Continuar donde se quedó". Solo alumnos activos, en orden de lista, y solo
	    días de clase (oficial + ajustes). Reglas en js/rol-aseo.js.
	  - "Generar y guardar" guarda en roles_aseo (una fila por grupo y mes) para reimprimir igual.
	    Si ya había uno, pide confirmar antes de reemplazarlo. Tocar un nombre permite cambiarlo.
	  - Si el calendario cambió después de guardar (un ajuste nuevo), hay alumnos de baja o
	    alumnos NUEVOS sin turno (dados de alta después de generar: roles_aseo.activos_al_generar),
	    se avisa y se ofrece volver a generar; no se cambia solo.
	  - Salida: vista previa en lista y en calendario, imágenes PNG (Canvas, sin librerías) para
	    WhatsApp de 2400 px de alto como máximo (un mes largo sale en varias, "1 de 3"),
	    Compartir (Web Share API con todos los archivos, cuando el aparato lo permite), Copiar
	    texto e Imprimir.
	  - Los ajustes guardados fuera del periodo de clases de un ciclo cargado se ignoran (la base
	    solo acepta de lunes a viernes; el periodo depende del ciclo).

	No cambia ningún cálculo de asistencia, tareas ni calificaciones, ni el trimestre (decisión de
	Jorge, 2026-09-25: no se conectan; ver js/calendario-sep.js). El rol de aseo es un extra
	opcional: la pestaña lo dice y nada fuera de ella (Inicio, avisos, recordatorios) lo sugiere;
	las confirmaciones de ajustes solo lo mencionan si el grupo ya tiene roles guardados.

	La parte pura (colores, HTML del mes, del rol y de la impresión) se exporta a node para
	pruebas/calendario-sep.test.js.
*/

(function () {
	"use strict";

	var C = typeof window !== "undefined" && window.CalendarioSEP ? window.CalendarioSEP : (typeof require === "function" ? require("./calendario-sep.js") : null);
	var R = typeof window !== "undefined" && window.RolAseo ? window.RolAseo : (typeof require === "function" ? require("./rol-aseo.js") : null);
	var esc = R.esc;

	// ── Colores por tipo (Tailwind) ─────────────────────────────────────────────
	// celda: el día en la vista del mes · muestra: el cuadrito de la leyenda · corta: texto en la celda
	var ESTILOS = {
		clase:            { celda: "bg-white text-gray-900 border-gray-200", muestra: "bg-white border-gray-300", corta: "" },
		fin_semana:       { celda: "bg-gray-50 text-gray-400 border-transparent", muestra: "bg-gray-100 border-gray-200", corta: "" },
		fuera_ciclo:      { celda: "bg-gray-50 text-gray-300 border-transparent", muestra: "bg-gray-50 border-gray-200", corta: "" },
		cte:              { celda: "bg-violet-100 text-violet-900 border-violet-200", muestra: "bg-violet-200 border-violet-300", corta: "CTE" },
		festivo:          { celda: "bg-rose-100 text-rose-900 border-rose-200", muestra: "bg-rose-200 border-rose-300", corta: "Suspensión" },
		vacaciones:       { celda: "bg-amber-100 text-amber-900 border-amber-200", muestra: "bg-amber-200 border-amber-300", corta: "Vacaciones" },
		registro:         { celda: "bg-teal-100 text-teal-900 border-teal-200", muestra: "bg-teal-200 border-teal-300", corta: "Registro" },
		formacion:        { celda: "bg-indigo-100 text-indigo-900 border-indigo-200", muestra: "bg-indigo-200 border-indigo-300", corta: "Formación" },
		otro:             { celda: "bg-gray-200 text-gray-800 border-gray-300", muestra: "bg-gray-300 border-gray-400", corta: "Sin clase" },
		entrega:          { celda: "bg-white text-gray-900 border-emerald-300", muestra: "bg-white border-emerald-500", corta: "Familias", punto: "bg-emerald-500" },
		jornada:          { celda: "bg-white text-gray-900 border-sky-300", muestra: "bg-white border-sky-500", corta: "Jornada", punto: "bg-sky-500" },
		preinscripcion:   { celda: "bg-white text-gray-900 border-cyan-300", muestra: "bg-white border-cyan-500", corta: "Preinscripción", punto: "bg-cyan-500" },
		aviso:            { celda: "bg-white text-gray-900 border-gray-300", muestra: "bg-white border-gray-500", corta: "", punto: "bg-gray-500" },
		propio_sin_clase: { celda: "bg-orange-100 text-orange-900 border-orange-400 border-dashed", muestra: "bg-orange-200 border-orange-500 border-dashed", corta: "" },
		propio_con_clase: { celda: "bg-white text-gray-900 border-emerald-500 border-dashed", muestra: "bg-white border-emerald-600 border-dashed", corta: "Con clase", punto: "bg-emerald-600" },
	};
	var ETIQUETA_LEYENDA = {
		clase: "Día de clase",
		cte: "Consejo Técnico Escolar (sin clase)",
		festivo: "Suspensión oficial de labores",
		vacaciones: "Vacaciones y recesos",
		registro: "Registro de calificaciones (descarga administrativa)",
		formacion: "Formación docente (sin clase)",
		otro: "Otro día sin clase",
		entrega: "Comunicación de resultados a las familias (con clase)",
		jornada: "Jornada nacional (con clase)",
		preinscripcion: "Preinscripción (con clase)",
		propio_sin_clase: "Sin clase en tu grupo (ajuste tuyo)",
		propio_con_clase: "Con clase en tu grupo (ajuste tuyo)",
		fin_semana: "Fin de semana",
	};
	var ENCABEZADO_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
	// Pastel (Lucide "cake") para los cumpleaños en la vista de mes
	var ICONO_PASTEL = '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>';
	function pastel(clase) {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='" + clase + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + ICONO_PASTEL + "</svg>";
	}
	// "Ana Pérez (cumple 8) y Luis (cumple 9)"
	function textoCumples(lista) {
		var t = (lista || []).map(function (c) { return c.nombre + " (cumple " + c.edad + ")"; });
		return t.length <= 1 ? t.join("") : t.slice(0, -1).join(", ") + " y " + t[t.length - 1];
	}
	/*
		Nota de un cumpleaños que cae en un día sin clase (se muestra igual, decisión de Jorge):
		"Cae en fin de semana", "Sin clase: Vacaciones…", "Fuera del periodo de clases"; "" si hay clase.
	*/
	function notaDia(t) {
		if (!t || t.clase) return "";
		if (t.tipo === "fin_semana") return "Cae en fin de semana";
		if (t.tipo === "fuera_ciclo") return "Fuera del periodo de clases";
		return "Sin clase: " + (t.motivo || t.etiqueta || "día sin clase");
	}

	function estilo(tipo) { return ESTILOS[tipo] || ESTILOS.clase; }

	function textoCorto(t) {
		if (t.tipo === "propio_sin_clase") return t.ajuste ? C.AJUSTES[t.ajuste.tipo].etiqueta : "Sin clase";
		if (t.tipo === "aviso") return t.motivo.replace(/ de clases$/, "");
		return estilo(t.tipo).corta;
	}

	// "viernes 25 de septiembre: Consejo Técnico Escolar, sin clase"
	function descripcionDia(t) {
		var partes = [C.fechaLarga(t.fecha, false)];
		var que = t.tipo === "clase" ? "día de clase" : (t.motivo || t.etiqueta);
		if (t.tipo !== "fin_semana" && t.tipo !== "fuera_ciclo" && t.tipo !== "clase") que += t.clase ? ", con clase" : ", sin clase";
		if (t.tipo === "fin_semana") que = "fin de semana";
		if (t.tipo === "fuera_ciclo") que = "fuera del ciclo escolar";
		return partes[0] + ": " + que;
	}

	/*
		htmlMes(mes, ajustes, hoy, cumples) → la cuadrícula del mes (lunes a domingo) con un botón por día.
		mes "AAAA-MM" · ajustes: filas o mapa (CalendarioSEP) · hoy "AAAA-MM-DD"
		cumples (opcional): { "AAAA-MM-DD": [{nombre, edad}] } (Cumpleanos.porFecha): un pastel
		discreto abajo a la izquierda; los nombres solo en el nombre accesible y al tocar el día.
	*/
	function htmlMes(mes, ajustes, hoy, cumples) {
		var mapa = C.mapaAjustes(ajustes);
		var dias = C.diasDelMes(mes);
		var primero = C.diaSemana(dias[0]); // 0 domingo
		var vacios = primero === 0 ? 6 : primero - 1;
		var celdas = [];
		for (var i = 0; i < vacios; i++) celdas.push("<div aria-hidden='true'></div>");
		dias.forEach(function (f) {
			var t = C.tipoDeDia(f, mapa);
			var e = estilo(t.tipo);
			var esHoy = f === hoy;
			var corta = textoCorto(t);
			var cum = cumples && cumples[f] && cumples[f].length ? cumples[f] : null;
			celdas.push(
				"<button type='button' data-fecha='" + f + "' aria-label='" + esc(descripcionDia(t) + (esHoy ? " (hoy)" : "") + (cum ? ". Cumpleaños de " + textoCumples(cum) : "")) + "'" +
				(esHoy ? " aria-current='date'" : "") +
				" class='cal-dia relative flex flex-col items-start justify-start min-h-[48px] sm:min-h-[64px] lg:min-h-[76px] w-full rounded-lg border p-1.5 sm:p-2 text-left transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " +
				e.celda + (esHoy ? " ring-2 ring-blue-700 ring-offset-1" : "") + "'>" +
				"<span class='text-sm sm:text-base font-semibold leading-none" + (esHoy ? " text-blue-800" : "") + "'>" + Number(f.slice(8)) + "</span>" +
				(corta ? "<span class='hidden sm:block mt-1 text-[11px] leading-tight font-medium line-clamp-2 break-words'>" + esc(corta) + "</span>" : "") +
				(e.punto ? "<span class='absolute top-1.5 right-1.5 h-2 w-2 rounded-full " + e.punto + "' aria-hidden='true'></span>" : "") +
				(t.ajuste ? "<span class='absolute bottom-1 right-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70' aria-hidden='true'>tuyo</span>" : "") +
				(cum ? "<span class='cal-pastel absolute bottom-1 left-1.5 text-pink-600' data-cumple='" + cum.length + "'>" + pastel("h-3.5 w-3.5 sm:h-4 sm:w-4") + "</span>" : "") +
				"</button>");
		});
		return "<div class='grid grid-cols-7 gap-1 sm:gap-1.5 mb-1' aria-hidden='true'>" +
			ENCABEZADO_SEMANA.map(function (d, i) { return "<div class='text-center text-xs font-semibold " + (i >= 5 ? "text-gray-400" : "text-gray-500") + " py-1'>" + d + "</div>"; }).join("") +
			"</div><div class='grid grid-cols-7 gap-1 sm:gap-1.5'>" + celdas.join("") + "</div>";
	}

	function htmlLeyenda(tipos) {
		return (tipos || C.ORDEN_LEYENDA).map(function (tipo) {
			var e = estilo(tipo);
			return "<li class='flex items-center gap-2 text-sm text-gray-700'>" +
				"<span class='relative inline-block h-5 w-5 shrink-0 rounded border-2 " + e.muestra + "' aria-hidden='true'>" +
				(e.punto ? "<span class='absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full " + e.punto + "'></span>" : "") + "</span>" +
				"<span>" + esc(ETIQUETA_LEYENDA[tipo] || tipo) + "</span></li>";
		}).join("");
	}

	/*
		"Semana del 5 al 9 de octubre". Solo con los días del mes del rol (el de sus filas): la
		semana del 30 de noviembre al 4 de diciembre, en el rol de noviembre, es "30 de noviembre"
		y en el de diciembre, "Semana del 1 al 4 de diciembre". Sin filas, la semana completa.
	*/
	function fechaSemana(s) {
		var lunes = s.lunes, viernes = C.sumarDias(s.lunes, 4);
		var mes = s.filas && s.filas.length ? String(s.filas[0].fecha).slice(0, 7) : null;
		if (mes) {
			var delMes = C.diasDelMes(mes);
			if (lunes < delMes[0]) lunes = delMes[0];
			if (viernes > delMes[delMes.length - 1]) viernes = delMes[delMes.length - 1];
		}
		var ml = Number(lunes.slice(5, 7)) - 1, mv = Number(viernes.slice(5, 7)) - 1;
		var dl = Number(lunes.slice(8)), dv = Number(viernes.slice(8));
		if (lunes === viernes) return dl + " de " + C.MESES[ml];
		if (ml === mv) return "Semana del " + dl + " al " + dv + " de " + C.MESES[mv];
		return "Semana del " + dl + " de " + C.MESES[ml] + " al " + dv + " de " + C.MESES[mv];
	}

	// Lista del rol: por semana, un renglón por día; cada nombre es un botón para cambiarlo
	function htmlRolLista(semanas, editable) {
		if (!semanas.length) return "<p class='text-sm text-gray-500 py-2'>Este mes no tiene días de clase.</p>";
		return semanas.map(function (s) {
			return "<div class='mb-4 last:mb-0'><h4 class='text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2'>" + esc(fechaSemana(s)) + "</h4>" +
				"<ul class='flex flex-col gap-1.5'>" + s.filas.map(function (f) {
					if (!f.clase) {
						return "<li class='flex items-start gap-3 rounded-xl px-3 py-2 text-sm text-gray-400'>" +
							"<span class='w-16 shrink-0 font-semibold'>" + esc(C.fechaCorta(f.fecha)) + "</span><span>Sin clase: " + esc(f.motivo) + "</span></li>";
					}
					var nombres = f.alumnos.length ? f.alumnos.map(function (a, i) {
						var clase = "inline-flex items-center min-h-[44px] max-w-full px-3 py-1.5 rounded-lg text-sm font-medium text-left leading-snug " +
							(a.baja ? "bg-gray-100 text-gray-500 italic" : "bg-blue-50 text-blue-900") + (editable ? " hover:bg-blue-100 cursor-pointer" : "");
						return editable
							? "<button type='button' class='" + clase + "' data-cambiar-fecha='" + f.fecha + "' data-cambiar-pos='" + i + "' aria-label='Cambiar a " + esc(a.nombre) + " del " + esc(C.fechaLarga(f.fecha, false)) + "'>" +
								"<span class='min-w-0 break-words'>" + esc(a.nombre) + "</span></button>"
							: "<span class='" + clase + "'><span class='min-w-0 break-words'>" + esc(a.nombre) + "</span></span>";
					}).join("") : "<span class='text-sm text-gray-400'>Sin alumnos</span>";
					return "<li class='flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2'>" +
						"<span class='w-16 shrink-0 text-sm font-bold text-blue-800'>" + esc(C.fechaCorta(f.fecha)) + "</span>" +
						"<span class='flex flex-wrap gap-1.5 min-w-0 flex-1'>" + nombres + "</span></li>";
				}).join("") + "</ul></div>";
		}).join("");
	}

	// Calendario del rol: semanas de lunes a viernes con los nombres en cada día
	function htmlRolCalendario(semanas) {
		if (!semanas.length) return "<p class='text-sm text-gray-500 py-2'>Este mes no tiene días de clase.</p>";
		var cab = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
		var cuerpo = semanas.map(function (s) {
			var porFecha = {};
			s.filas.forEach(function (f) { porFecha[f.fecha] = f; });
			var tds = [0, 1, 2, 3, 4].map(function (i) {
				var fecha = C.sumarDias(s.lunes, i);
				var f = porFecha[fecha];
				var num = "<span class='block text-xs font-bold " + (f && f.clase ? "text-blue-800" : "text-gray-400") + "'>" + Number(fecha.slice(8)) + "</span>";
				if (!f) return "<td class='align-top border border-gray-200 p-1.5 bg-gray-50'></td>";
				if (!f.clase) return "<td class='align-top border border-gray-200 p-1.5 bg-gray-50 text-gray-400 text-xs'>" + num + "<span class='block mt-0.5 leading-tight'>" + esc(f.motivo) + "</span></td>";
				return "<td class='align-top border border-gray-200 p-1.5'>" + num +
					f.alumnos.map(function (a) { return "<span class='block mt-0.5 text-xs sm:text-sm leading-tight break-words" + (a.baja ? " text-gray-500 italic" : " text-gray-900") + "'>" + esc(a.nombre) + "</span>"; }).join("") + "</td>";
			}).join("");
			return "<tr>" + tds + "</tr>";
		}).join("");
		return "<table class='w-full table-fixed border-collapse'><thead><tr>" +
			cab.map(function (d) { return "<th scope='col' class='border border-gray-200 bg-gray-50 px-1 py-1.5 text-xs font-semibold text-gray-600'><span class='hidden sm:inline'>" + d + "</span><span class='sm:hidden'>" + d.slice(0, 3) + "</span></th>"; }).join("") +
			"</tr></thead><tbody>" + cuerpo + "</tbody></table>";
	}

	// Hoja para imprimir el rol (carta vertical): encabezado y calendario de lunes a viernes
	function htmlImpresionRol(meta, semanas) {
		return "<div class='imp-hoja imp-rol'>" +
			"<p class='imp-etq'>Rol de aseo</p><h1 class='imp-titulo'>" + esc(meta.mes) + "</h1>" +
			(meta.escuela ? "<p class='imp-sub'>" + esc(meta.escuela) + "</p>" : "") +
			(meta.grupo ? "<p class='imp-sub'>Grupo: " + esc(meta.grupo) + "</p>" : "") +
			"<div class='imp-tabla'>" + htmlRolCalendario(semanas) + "</div>" +
			"</div>";
	}

	function htmlImpresionMes(meta, mes, ajustes, hoy, cumples) {
		return "<div class='imp-hoja'>" +
			"<p class='imp-etq'>Calendario escolar " + esc(meta.ciclo || "") + "</p><h1 class='imp-titulo'>" + esc(C.nombreMes(mes)) + "</h1>" +
			(meta.escuela ? "<p class='imp-sub'>" + esc(meta.escuela) + "</p>" : "") +
			(meta.grupo ? "<p class='imp-sub'>Grupo: " + esc(meta.grupo) + "</p>" : "") +
			"<div class='imp-mes'>" + htmlMes(mes, ajustes, hoy, cumples) + "</div>" +
			"<ul class='imp-leyenda'>" + htmlLeyenda() + "</ul>" +
			"<p class='imp-fuente'>" + esc(meta.fuente || "") + "</p></div>";
	}

	function slug(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
			.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	}
	// "rol-de-aseo-octubre-2026-3-a.png"; con varias imágenes, "…-1-de-3.png"
	function nombreArchivo(mes, grupo, i, n) {
		return ["rol-de-aseo", slug(C.nombreMes(mes)), slug(grupo)].filter(Boolean).join("-") +
			(n > 1 ? "-" + i + "-de-" + n : "") + ".png";
	}

	var api = {
		ESTILOS: ESTILOS, ETIQUETA_LEYENDA: ETIQUETA_LEYENDA,
		htmlMes: htmlMes, htmlLeyenda: htmlLeyenda, notaDia: notaDia, textoCumples: textoCumples, pastel: pastel, descripcionDia: descripcionDia, fechaSemana: fechaSemana,
		htmlRolLista: htmlRolLista, htmlRolCalendario: htmlRolCalendario,
		htmlImpresionRol: htmlImpresionRol, htmlImpresionMes: htmlImpresionMes, nombreArchivo: nombreArchivo,
	};
	if (typeof window !== "undefined") window.CalendarioPantalla = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	// ═════════════════════════════════════════════════════════════════════════
	// Página calendario.html
	// ═════════════════════════════════════════════════════════════════════════
	document.addEventListener("DOMContentLoaded", function () {
		if (!window.sb) return;

		var $ = function (id) { return document.getElementById(id); };
		var el = {
			subtitulo: $("calSubtitulo"), mensaje: $("calMensaje"),
			tabs: [$("tabCalendario"), $("tabCumples"), $("tabAseo")], paneles: { calendario: $("panelCalendario"), cumpleanos: $("panelCumples"), aseo: $("panelAseo") },
			cumLista: $("cumLista"), cumSinFecha: $("cumSinFecha"),
			hoy: $("calHoy"), proximo: $("calProximo"), cuenta: $("calCuenta"),
			mesTitulo: $("calMesTitulo"), mesResumen: $("calMesResumen"), grid: $("calGrid"),
			anterior: $("calAnterior"), siguiente: $("calSiguiente"), irHoy: $("calIrHoy"),
			leyenda: $("calLeyenda"), ajustes: $("calAjustesLista"), fuente: $("calFuente"), fuenteLink: $("calFuenteLink"),
			dlgDia: $("dlgDia"), dlgDiaCuerpo: $("dlgDiaCuerpo"),
			dlgConfirmar: $("dlgConfirmar"), dlgCambio: $("dlgCambio"),
			aseoMes: $("aseoMes"), aseoPorDia: $("aseoPorDia"), aseoInicio: $("aseoInicio"),
			aseoContinuarFila: $("aseoContinuarFila"), aseoContinuar: $("aseoContinuar"), aseoContinuarTexto: $("aseoContinuarTexto"),
			aseoGenerar: $("aseoGenerar"), aseoEstado: $("aseoEstado"), aseoAviso: $("aseoAviso"),
			aseoTitulo: $("aseoTitulo"), aseoVista: $("aseoVista"), aseoPreview: $("aseoPreview"), aseoSalida: $("aseoSalida"),
			aseoImagen: $("aseoImagen"), aseoCompartir: $("aseoCompartir"), aseoCopiar: $("aseoCopiar"), aseoImprimir: $("aseoImprimir"),
			impresion: $("zonaImpresion"),
		};

		var userId = null, grupo = null, escuela = "";
		var ajustes = [];            // filas de calendario_ajustes del grupo
		var todos = [], activos = []; // alumnos del grupo (todos, para bajas) y activos en orden de lista
		var roles = {};              // "AAAA-MM" → fila de roles_aseo
		var cumples = { lista: [], sinFecha: 0 }, cumplesPorFecha = {}; // js/cumpleanos.js
		var hoy = C.hoyLocal();
		var ciclo = C.cicloVigente(hoy);
		var meses = ciclo ? C.mesesDelCiclo(ciclo) : [];
		var mesVista = meses.indexOf(hoy.slice(0, 7)) !== -1 ? hoy.slice(0, 7) : (meses[0] || hoy.slice(0, 7));
		var pestana = "calendario";
		var aseo = { mes: null, porDia: 2, vista: "lista" };
		var pendientes = 0;

		// ── Utilidades ────────────────────────────────────────────────────────
		function mensaje(tipo, texto) {
			if (!texto) { el.mensaje.className = "hidden"; el.mensaje.textContent = ""; return; }
			el.mensaje.className = "rounded-xl px-4 py-3 text-sm border " +
				(tipo === "error" ? "bg-red-50 text-red-800 border-red-200" : (tipo === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-blue-50 text-blue-800 border-blue-200"));
			el.mensaje.textContent = texto;
		}
		function estadoAseo(texto) { el.aseoEstado.textContent = texto || ""; }
		function textoError(e) { return (e && e.message) || "error desconocido"; }
		function nombreAlumno(a) { return (typeof a.num_lista === "number" ? a.num_lista + ". " : "") + (a.nombre_completo || "Alumno sin nombre"); }
		function nombresPorId() {
			var m = {};
			todos.forEach(function (a) { m[a.id] = { nombre: a.nombre_completo || "Alumno sin nombre", activo: a.estatus === "activo" }; });
			return m;
		}
		async function escribir(fn) {
			pendientes++;
			try { return await fn(); } finally { pendientes--; }
		}
		window.Lectura.antesDeSalir({
			pendiente: function () { return pendientes > 0; },
			guardar: function () {
				return new Promise(function (r) {
					(function esperar() { if (!pendientes) r(true); else setTimeout(esperar, 100); })();
				});
			},
		});

		// Diálogo de confirmación → Promise<boolean>
		function confirmar(titulo, texto, boton, peligro) {
			return new Promise(function (resolver) {
				var d = el.dlgConfirmar;
				d.querySelector("[data-titulo]").textContent = titulo;
				d.querySelector("[data-texto]").textContent = texto;
				var ok = d.querySelector("[data-ok]");
				ok.textContent = boton || "Confirmar";
				ok.className = "min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white " + (peligro ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800");
				function cerrar(v) {
					d.removeEventListener("close", alCerrar);
					ok.removeEventListener("click", alOk);
					if (d.open) d.close();
					resolver(v);
				}
				function alOk() { cerrar(true); }
				function alCerrar() { cerrar(false); }
				ok.addEventListener("click", alOk);
				d.addEventListener("close", alCerrar);
				d.showModal();
				ok.focus();
			});
		}
		Array.prototype.forEach.call(document.querySelectorAll("dialog [data-cerrar]"), function (b) {
			b.addEventListener("click", function () { var d = b.closest("dialog"); if (d && d.open) d.close(); });
		});
		// Tocar el fondo cierra el diálogo
		Array.prototype.forEach.call(document.querySelectorAll("dialog"), function (d) {
			d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
		});

		// ── Pestañas ──────────────────────────────────────────────────────────
		function elegirPestana(cual, foco) {
			pestana = cual === "aseo" || cual === "cumpleanos" ? cual : "calendario";
			el.tabs.forEach(function (t) {
				var si = t.getAttribute("data-tab") === pestana;
				t.setAttribute("aria-selected", si ? "true" : "false");
				t.tabIndex = si ? 0 : -1;
				t.className = "min-h-[44px] px-4 rounded-lg text-sm font-semibold transition-colors " +
					(si ? "bg-white text-blue-800 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-white/60");
				if (si && foco) t.focus();
			});
			Object.keys(el.paneles).forEach(function (k) { el.paneles[k].hidden = pestana !== k; });
			try { window.history.replaceState(null, "", pestana !== "calendario" ? "#" + pestana : window.location.pathname + window.location.search); } catch (_) {}
		}
		el.tabs.forEach(function (t, i) {
			t.addEventListener("click", function () { elegirPestana(t.getAttribute("data-tab")); });
			t.addEventListener("keydown", function (e) {
				if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
				e.preventDefault();
				elegirPestana(el.tabs[(i + (e.key === "ArrowRight" ? 1 : el.tabs.length - 1)) % el.tabs.length].getAttribute("data-tab"), true);
			});
		});

		// ═══ Calendario ═══════════════════════════════════════════════════════
		function pintarResumen() {
			var th = C.tipoDeDia(hoy, ajustes);
			var fueraTexto = ciclo ? "El ciclo " + ciclo.ciclo + " va del " + C.fechaLarga(ciclo.inicio) + " al " + C.fechaLarga(ciclo.fin) + "." : "";
			if (!th || th.tipo === "fuera_ciclo" || (ciclo && (hoy < ciclo.inicio || hoy > ciclo.fin) && th.tipo !== "fin_semana")) {
				el.hoy.innerHTML = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>Hoy</p><p class='mt-1 font-semibold text-gray-900'>" +
					esc(C.fechaLarga(hoy)) + "</p><p class='text-sm text-gray-600 mt-1'>" + esc(th && th.motivo ? th.motivo + ". " : "Fuera del periodo de clases. ") + esc(fueraTexto) + "</p>";
			} else {
				el.hoy.innerHTML = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>Hoy</p><p class='mt-1 font-semibold text-gray-900'>" +
					esc(C.fechaLarga(hoy)) + "</p><p class='text-sm mt-1 " + (th.clase ? "text-emerald-700" : "text-amber-800") + "'>" +
					esc(th.clase ? (th.tipo === "clase" ? "Hay clase." : "Hay clase: " + (th.motivo || th.etiqueta) + ".") : (th.tipo === "fin_semana" ? "Fin de semana." : "Sin clase: " + (th.motivo || th.etiqueta) + ".")) + "</p>";
			}
			var p = C.proximoSinClase(hoy, ajustes);
			if (p) {
				var dias = Math.round((Date.parse(p.fecha + "T12:00:00Z") - Date.parse(hoy + "T12:00:00Z")) / 86400000);
				el.proximo.innerHTML = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>Próximo día sin clase</p><p class='mt-1 font-semibold text-gray-900'>" +
					esc(C.fechaLarga(p.fecha)) + "</p><p class='text-sm text-gray-600 mt-1'>" + esc((p.motivo || p.etiqueta) + (dias > 0 ? " (en " + dias + (dias === 1 ? " día)." : " días).") : ".")) + "</p>";
			} else {
				el.proximo.innerHTML = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>Próximo día sin clase</p><p class='mt-1 text-sm text-gray-600'>No hay más días sin clase en el calendario cargado.</p>";
			}
			if (ciclo) {
				var oficial = C.diasDeClase(ciclo.inicio, ciclo.fin).length;
				var conAjustes = C.diasDeClase(ciclo.inicio, ciclo.fin, ajustes).length;
				el.cuenta.innerHTML = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>Días de clase del ciclo " + esc(ciclo.ciclo) + "</p>" +
					"<p class='mt-1 font-semibold text-gray-900'>" + conAjustes + " días</p><p class='text-sm text-gray-600 mt-1'>" +
					(conAjustes === oficial ? "Los " + oficial + " del calendario oficial." : oficial + " del calendario oficial; " + conAjustes + " con los ajustes de tu grupo.") + "</p>";
			}
		}

		function pintarMes() {
			el.mesTitulo.textContent = C.nombreMes(mesVista);
			el.grid.innerHTML = htmlMes(mesVista, ajustes, hoy, cumplesPorFecha);
			var dias = C.diasDelMes(mesVista);
			var n = C.diasDeClase(dias[0], dias[dias.length - 1], ajustes).length;
			el.mesResumen.textContent = n === 1 ? "1 día de clase este mes" : n + " días de clase este mes";
			var i = meses.indexOf(mesVista);
			el.anterior.disabled = i <= 0;
			el.siguiente.disabled = i === -1 || i >= meses.length - 1;
			el.irHoy.disabled = mesVista === hoy.slice(0, 7) || meses.indexOf(hoy.slice(0, 7)) === -1;
		}

		function pintarAjustes() {
			var lista = ajustes.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
			if (!lista.length) {
				el.ajustes.innerHTML = "<p class='text-sm text-gray-500'>Tu grupo sigue el calendario oficial. Toca un día para marcar una suspensión o un cambio de tu escuela.</p>";
				return;
			}
			el.ajustes.innerHTML = "<ul class='divide-y divide-gray-100'>" + lista.map(function (a) {
				var t = C.tipoDeDia(a.fecha, ajustes);
				var vigente = !!(t && t.ajuste);
				return "<li class='flex flex-col sm:flex-row sm:items-center gap-2 py-2'>" +
					"<div class='flex-1 min-w-0'><p class='text-sm font-semibold text-gray-900'>" + esc(C.fechaLarga(a.fecha)) + "</p>" +
					"<p class='text-sm text-gray-600 break-words'>" + esc(C.AJUSTES[a.tipo] ? C.AJUSTES[a.tipo].etiqueta : a.tipo) + (a.motivo ? ": " + esc(a.motivo) : "") +
					(vigente ? "" : " <span class='text-amber-700'>(no cambia nada: el calendario oficial ya lo marca así)</span>") + "</p></div>" +
					"<button type='button' data-ver-dia='" + esc(a.fecha) + "' class='min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 self-start sm:self-auto'>Ver o quitar</button></li>";
			}).join("") + "</ul>";
		}

		function pintarCalendario() {
			pintarResumen();
			pintarMes();
			pintarAjustes();
		}

		el.anterior.addEventListener("click", function () { var i = meses.indexOf(mesVista); if (i > 0) { mesVista = meses[i - 1]; pintarMes(); } });
		el.siguiente.addEventListener("click", function () { var i = meses.indexOf(mesVista); if (i < meses.length - 1) { mesVista = meses[i + 1]; pintarMes(); } });
		el.irHoy.addEventListener("click", function () { mesVista = hoy.slice(0, 7); pintarMes(); });

		el.grid.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-fecha]") : null;
			if (b) abrirDia(b.getAttribute("data-fecha"));
		});
		el.ajustes.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-ver-dia]") : null;
			if (!b) return;
			var f = b.getAttribute("data-ver-dia");
			mesVista = f.slice(0, 7);
			pintarMes();
			abrirDia(f);
		});

		// ── Diálogo de un día ─────────────────────────────────────────────────
		function abrirDia(fecha) {
			var t = C.tipoDeDia(fecha, ajustes);
			if (!t) return;
			var guardado = ajustes.filter(function (a) { return a.fecha === fecha; })[0] || null;
			var of = t.oficial;
			var h = "<p class='text-xs font-semibold uppercase tracking-wide text-gray-500'>" + esc(C.fechaLarga(fecha)) + "</p>" +
				"<h2 id='dlgDiaTitulo' class='mt-1 text-lg font-bold text-gray-900'>" + esc(t.tipo === "clase" ? "Día de clase" : t.etiqueta) + "</h2>";
			if (t.motivo && t.tipo !== "clase") h += "<p class='mt-1 text-sm text-gray-700 break-words'>" + esc(t.motivo) + "</p>";
			if (cumplesPorFecha[fecha]) {
				h += "<p class='mt-2 flex items-start gap-2 text-sm text-pink-800'>" + pastel("h-4 w-4 shrink-0 mt-0.5") + "<span class='break-words'>Cumpleaños de " + esc(textoCumples(cumplesPorFecha[fecha])) + ".</span></p>";
			}
			h += "<p class='mt-2 text-sm " + (t.clase ? "text-emerald-700" : "text-gray-600") + "'>" + (t.clase ? "Hay clase con los alumnos." : "No hay clase con los alumnos.") + "</p>";
			if (t.ajuste) {
				h += "<p class='mt-2 text-sm text-gray-600'>Calendario oficial: " + esc(of.tipo === "clase" ? "día de clase" : (of.motivo || of.etiqueta)) + ". Lo cambiaste para tu grupo.</p>";
			} else if (of.tipo !== "clase" && of.tipo !== "fin_semana" && of.tipo !== "fuera_ciclo") {
				h += "<p class='mt-2 text-xs text-gray-500'>Según el calendario escolar SEP " + esc(of.ciclo || "") + ".</p>";
			}

			var puedeSuspender = C.ajustePermitido(fecha, "suspension").ok && !t.ajuste;
			var puedeConClase = C.ajustePermitido(fecha, "con_clase").ok && !t.ajuste;
			var acciones = "";
			if (t.ajuste || guardado) {
				acciones += "<button type='button' data-accion='quitar' class='w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-white border border-red-300 text-red-700 text-sm font-semibold hover:bg-red-50'>Quitar mi ajuste y volver al calendario oficial</button>";
			}
			if (puedeSuspender) {
				acciones += "<fieldset class='mt-1'><legend class='text-sm font-semibold text-gray-800'>Marcar sin clase en tu grupo</legend>" +
					"<div class='mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2' role='radiogroup'>" +
					["suspension", "festividad_local", "otro"].map(function (k, i) {
						return "<label class='flex items-center gap-2 min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm cursor-pointer has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50'>" +
							"<input type='radio' name='ajTipo' value='" + k + "'" + (i === 0 ? " checked" : "") + " class='h-4 w-4'>" + esc(C.AJUSTES[k].etiqueta) + "</label>";
					}).join("") + "</div>" +
					"<label for='ajMotivo' class='block mt-3 text-sm font-medium text-gray-700'>Motivo (opcional)</label>" +
					"<input id='ajMotivo' type='text' maxlength='" + C.MOTIVO_MAX + "' autocomplete='off' placeholder='Por ejemplo: fiesta patronal' class='mt-1 block w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm'>" +
					"<button type='button' data-accion='suspender' class='mt-3 w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800'>Marcar sin clase</button></fieldset>";
			}
			if (puedeConClase) {
				acciones += "<div><p class='text-sm text-gray-700'>Si tu entidad o tu escuela cambió este día y en tu grupo sí hay clase, márcalo aquí.</p>" +
					"<label for='ajMotivo' class='block mt-3 text-sm font-medium text-gray-700'>Motivo (opcional)</label>" +
					"<input id='ajMotivo' type='text' maxlength='" + C.MOTIVO_MAX + "' autocomplete='off' placeholder='Por ejemplo: ajuste de la autoridad educativa local' class='mt-1 block w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm'>" +
					"<button type='button' data-accion='conclase' class='mt-3 w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800'>En mi grupo sí hay clase</button></div>";
			}
			if (!acciones && (t.tipo === "fin_semana" || t.tipo === "fuera_ciclo" || !ciclo || fecha < (C.cicloDe(fecha) || {}).inicio || fecha > (C.cicloDe(fecha) || {}).fin)) {
				acciones = "<p class='text-sm text-gray-500'>Este día no se puede ajustar: solo los días de lunes a viernes dentro del periodo de clases.</p>";
			}
			el.dlgDiaCuerpo.innerHTML = h + (acciones ? "<div class='mt-4 pt-4 border-t border-gray-100 flex flex-col gap-3'>" + acciones + "</div>" : "");
			el.dlgDia.dataset.fecha = fecha;
			el.dlgDia.showModal();
		}

		el.dlgDiaCuerpo.addEventListener("click", async function (e) {
			var b = e.target.closest ? e.target.closest("button[data-accion]") : null;
			if (!b) return;
			var fecha = el.dlgDia.dataset.fecha;
			var accion = b.getAttribute("data-accion");
			var motivoEl = el.dlgDiaCuerpo.querySelector("#ajMotivo");
			var motivo = motivoEl ? motivoEl.value.trim().slice(0, C.MOTIVO_MAX) : "";
			var tipo = accion === "conclase" ? "con_clase" : (accion === "suspender" ? ((el.dlgDiaCuerpo.querySelector("input[name=ajTipo]:checked") || {}).value || "suspension") : null);
			var largo = C.fechaLarga(fecha);
			var nombreGrupo = grupo.nombre || "tu grupo";
			var ok;
			el.dlgDia.close();
			if (accion === "quitar") {
				ok = await confirmar("Quitar el ajuste", "El " + largo + " volverá a ser como dice el calendario oficial para " + nombreGrupo + "." + notaAseo(), "Quitar ajuste", true);
				if (ok) await quitarAjuste(fecha);
			} else if (tipo) {
				var texto = tipo === "con_clase"
					? "El " + largo + " contará como día de clase en " + nombreGrupo + ", aunque el calendario oficial diga que no."
					: "El " + largo + " no habrá clase en " + nombreGrupo + " (" + C.AJUSTES[tipo].etiqueta.toLowerCase() + (motivo ? ": " + motivo : "") + ").";
				ok = await confirmar(tipo === "con_clase" ? "Marcar con clase" : "Marcar sin clase", texto + notaAseo(), "Guardar");
				if (ok) await guardarAjuste(fecha, tipo, motivo);
			}
		});

		// El rol de aseo es opcional: solo se menciona si el grupo ya tiene roles guardados
		function notaAseo() {
			return Object.keys(roles).length ? " Los roles de aseo ya guardados no cambian solos." : "";
		}

		async function guardarAjuste(fecha, tipo, motivo) {
			if (!C.ajustePermitido(fecha, tipo).ok) { mensaje("error", C.ajustePermitido(fecha, tipo).razon); return; }
			mensaje("info", "Guardando...");
			try {
				var res = await escribir(function () {
					return window.sb.from("calendario_ajustes").upsert({
						maestro_id: userId, grupo_id: grupo.id, fecha: fecha, tipo: tipo, motivo: motivo || null,
					}, { onConflict: "grupo_id,fecha" }).select("id, fecha, tipo, motivo");
				});
				if (res.error) throw res.error;
				ajustes = ajustes.filter(function (a) { return a.fecha !== fecha; }).concat(res.data || []);
				pintarCalendario();
				pintarAseo();
				mensaje("ok", "Guardado: " + C.fechaLarga(fecha) + ", " + (tipo === "con_clase" ? "con clase" : "sin clase") + " en " + (grupo.nombre || "tu grupo") + ".");
			} catch (e) {
				console.error("calendario: guardar ajuste", e);
				mensaje("error", "No se pudo guardar el cambio del " + C.fechaLarga(fecha) + ": " + textoError(e) + ". El calendario muestra lo que sí está guardado.");
			}
		}

		async function quitarAjuste(fecha) {
			mensaje("info", "Guardando...");
			try {
				var res = await escribir(function () {
					return window.sb.from("calendario_ajustes").delete().eq("maestro_id", userId).eq("grupo_id", grupo.id).eq("fecha", fecha);
				});
				if (res.error) throw res.error;
				ajustes = ajustes.filter(function (a) { return a.fecha !== fecha; });
				pintarCalendario();
				pintarAseo();
				mensaje("ok", "Listo: el " + C.fechaLarga(fecha) + " sigue el calendario oficial.");
			} catch (e) {
				console.error("calendario: quitar ajuste", e);
				mensaje("error", "No se pudo quitar el ajuste del " + C.fechaLarga(fecha) + ": " + textoError(e) + ".");
			}
		}

		// ═══ Cumpleaños ═══════════════════════════════════════════════════════
		// Próximos cumpleaños (12 meses) de los alumnos activos; los que caen sin clase, con su nota
		function pintarCumples() {
			var K = window.Cumpleanos;
			if (!K) return;
			// La leyenda del mes explica el pastel solo si hay cumpleaños que marcar
			el.leyenda.innerHTML = htmlLeyenda() + (cumples.lista.length ? "<li class='flex items-center gap-2 text-sm text-gray-700'><span class='inline-flex h-5 w-5 shrink-0 items-center justify-center text-pink-600'>" + pastel("h-4 w-4") + "</span><span>Cumpleaños de un alumno</span></li>" : "");
			if (cumples.sinFecha) {
				el.cumSinFecha.hidden = false;
				el.cumSinFecha.innerHTML = "<div class='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3'>" +
					"<p class='flex-1'>" + esc(K.textoSinFecha(cumples.sinFecha)) + ". Agrégala en su ficha para ver su cumpleaños aquí.</p>" +
					"<a href='mi-grupo.html' class='shrink-0 inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-amber-300 bg-white font-semibold text-amber-900 hover:bg-amber-100'>Ir a Mi grupo</a></div>";
			} else {
				el.cumSinFecha.hidden = true;
				el.cumSinFecha.innerHTML = "";
			}
			if (!cumples.lista.length) {
				el.cumLista.innerHTML = "<li class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>" +
					(todos.some(function (a) { return a.estatus === "activo"; }) ? "Ningún alumno activo tiene fecha de nacimiento en su ficha." : "Este grupo no tiene alumnos activos.") + "</li>";
				return;
			}
			el.cumLista.innerHTML = cumples.lista.map(function (c) {
				var t = C.tipoDeDia(c.fecha, ajustes);
				var nota = notaDia(t);
				var esHoy = c.dias === 0;
				return "<li class='flex items-start gap-3 rounded-xl border px-3 py-2.5 " + (esHoy ? "border-pink-300 bg-pink-50" : "border-gray-100 bg-white") + "'>" +
					"<span class='mt-0.5 text-pink-600'>" + pastel("h-5 w-5") + "</span>" +
					"<div class='min-w-0 flex-1'><p class='font-semibold text-gray-900 break-words'>" + esc(c.alumno.nombre_completo || "Alumno sin nombre") + "</p>" +
					"<p class='text-sm text-gray-700'>" + esc(C.fechaLarga(c.fecha, false)) + " · cumple " + c.edad + (c.edad === 1 ? " año" : " años") + "</p>" +
					(nota ? "<p class='text-xs text-gray-500'>" + esc(nota) + "</p>" : "") +
					(c.bisiesto && c.fecha.slice(5) === "02-28" ? "<p class='text-xs text-gray-500'>Nació un 29 de febrero: este año se marca el 28.</p>" : "") + "</div>" +
					"<span class='shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold " + (esHoy ? "bg-pink-600 text-white" : "bg-gray-100 text-gray-700") + "'>" + esc(K.cuando(c.dias)) + "</span></li>";
			}).join("");
		}

		// ═══ Rol de aseo ══════════════════════════════════════════════════════
		function mesesConClase() {
			return meses.filter(function (m) {
				var d = C.diasDelMes(m);
				return C.diasDeClase(d[0], d[d.length - 1], ajustes).length > 0;
			});
		}
		function diasClaseMes(m) {
			var d = C.diasDelMes(m);
			return C.diasDeClase(d[0], d[d.length - 1], ajustes);
		}
		function sinClaseMes(m) {
			var d = C.diasDelMes(m);
			return C.diasSinClase(d[0], d[d.length - 1], ajustes);
		}
		function rolAnterior(m) { return roles[C.mesSiguiente(m, -1)] || null; }

		function pintarSelectorMes() {
			var lista = mesesConClase();
			if (!aseo.mes || lista.indexOf(aseo.mes) === -1) {
				aseo.mes = lista.indexOf(hoy.slice(0, 7)) !== -1 ? hoy.slice(0, 7) : (lista.filter(function (m) { return m >= hoy.slice(0, 7); })[0] || lista[0] || null);
			}
			el.aseoMes.innerHTML = lista.map(function (m) {
				return "<option value='" + m + "'" + (m === aseo.mes ? " selected" : "") + ">" + esc(C.nombreMes(m)) + (roles[m] ? " (guardado)" : "") + "</option>";
			}).join("");
		}

		function pintarPorDia() {
			el.aseoPorDia.innerHTML = [1, 2, 3, 4, 5].map(function (n) {
				var si = n === aseo.porDia;
				return "<button type='button' role='radio' aria-checked='" + si + "' data-pordia='" + n + "' class='min-h-[44px] min-w-[44px] px-3 rounded-lg text-sm font-semibold border transition-colors " +
					(si ? "bg-blue-700 border-blue-700 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50") + "'>" + n + "</button>";
			}).join("");
		}

		function pintarInicio(valor) {
			el.aseoInicio.innerHTML = activos.map(function (a) {
				return "<option value='" + esc(a.id) + "'" + (a.id === valor ? " selected" : "") + ">" + esc(nombreAlumno(a)) + "</option>";
			}).join("");
			if (!activos.length) el.aseoInicio.innerHTML = "<option value=''>Sin alumnos activos</option>";
		}

		// Configuración del mes elegido: la guardada o la sugerida (continuar si hay rol anterior)
		function cargarConfigMes() {
			var guardado = roles[aseo.mes] || null;
			var previo = rolAnterior(aseo.mes);
			var continuo = R.inicioContinuo(previo, activos, todos);
			el.aseoContinuarFila.hidden = !continuo;
			if (continuo) {
				var al = activos.filter(function (a) { return a.id === continuo.id; })[0];
				el.aseoContinuarTexto.textContent = "Continuar donde se quedó " + C.nombreMes(C.mesSiguiente(aseo.mes, -1), false).toLowerCase() +
					(al ? " (sigue " + nombreAlumno(al) + ")" : "") + (continuo.exacto ? "" : ". Quien seguía ya no está activo; empieza el siguiente de la lista.");
			}
			if (guardado) {
				aseo.porDia = R.porDiaValido(guardado.por_dia);
				el.aseoContinuar.checked = !!(guardado.continua && continuo);
				pintarInicio(guardado.continua && continuo ? continuo.id : (guardado.inicia_alumno_id || (activos[0] && activos[0].id)));
			} else {
				el.aseoContinuar.checked = !!continuo;
				pintarInicio(continuo ? continuo.id : (activos[0] && activos[0].id));
			}
			el.aseoInicio.disabled = !!(el.aseoContinuar.checked && continuo) || !activos.length;
			pintarPorDia();
		}

		function filasActuales() {
			var g = roles[aseo.mes];
			if (!g) return null;
			return R.filasDelMes(R.asignacionValida(g.asignacion), sinClaseMes(aseo.mes), nombresPorId());
		}

		function metaImagen() {
			return { mes: C.nombreMes(aseo.mes), escuela: escuela, grupo: grupo.nombre || "" };
		}

		function pintarVistaRol() {
			var filas = filasActuales();
			el.aseoTitulo.textContent = "Rol de aseo de " + (aseo.mes ? C.nombreMes(aseo.mes) : "");
			Array.prototype.forEach.call(el.aseoVista.querySelectorAll("button"), function (b) {
				var si = b.getAttribute("data-vista") === aseo.vista;
				b.setAttribute("aria-pressed", si ? "true" : "false");
				b.className = "min-h-[44px] px-4 rounded-lg text-sm font-semibold transition-colors " + (si ? "bg-white text-blue-800 shadow-sm" : "text-gray-600 hover:text-gray-900");
			});
			el.aseoAviso.className = "hidden";
			if (!filas) {
				el.aseoPreview.innerHTML = "<p class='text-sm text-gray-500 py-2'>" + (activos.length
					? "Todavía no hay rol guardado para " + esc(C.nombreMes(aseo.mes)) + ". Elige cuántos alumnos por día y con quién empieza, y toca Generar y guardar."
					: "Este grupo no tiene alumnos activos. Agrégalos en Mi grupo.") + "</p>";
				el.aseoSalida.hidden = true;
				return;
			}
			var semanas = R.porSemanas(filas, C.sumarDias, C.diaSemana);
			el.aseoPreview.innerHTML = aseo.vista === "calendario" ? "<div class='overflow-x-auto'>" + htmlRolCalendario(semanas) + "</div>" : htmlRolLista(semanas, true);
			el.aseoSalida.hidden = false;
			// ¿El calendario o la lista cambiaron desde que se guardó?
			var g = roles[aseo.mes];
			var dif = R.diferencias(R.asignacionValida(g.asignacion), diasClaseMes(aseo.mes));
			var bajas = filas.some(function (f) { return f.clase && f.alumnos.some(function (a) { return a.baja; }); });
			// Altas después de guardar: activos que no estaban al generar y no tienen turno
			var nuevos = R.nuevosSinTurno(R.asignacionValida(g.asignacion), activos, g.activos_al_generar);
			var avisos = [];
			if (dif.sobran.length) avisos.push("ya no hay clase el " + dif.sobran.map(function (f) { return C.fechaCorta(f).toLowerCase(); }).join(", "));
			if (dif.faltan.length) avisos.push("ahora hay clase el " + dif.faltan.map(function (f) { return C.fechaCorta(f).toLowerCase(); }).join(", "));
			if (bajas) avisos.push("hay alumnos que ya no están activos");
			if (nuevos.length) avisos.push((nuevos.length === 1 ? "hay un alumno nuevo sin turno (" : "hay alumnos nuevos sin turno (") + nuevos.map(nombreAlumno).join(", ") + ")");
			if (avisos.length) {
				el.aseoAviso.className = "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3";
				el.aseoAviso.innerHTML = "<p class='flex-1 min-w-0 break-words'>" + esc("Desde que guardaste este rol cambió algo: " + avisos.join("; ") +
					". El rol no cambia solo: vuelve a generarlo para repartir de nuevo" + (nuevos.length ? " e incluir a quien se dio de alta" : "") + ", o cambia a mano los nombres.") + "</p>" +
					"<button type='button' data-regenerar class='shrink-0 min-h-[44px] px-4 rounded-xl border border-amber-300 bg-white text-sm font-semibold text-amber-900 hover:bg-amber-100'>Volver a generar</button>";
			}
		}
		// "Volver a generar" del aviso: el mismo botón de Generar y guardar (pide confirmar el reemplazo)
		el.aseoAviso.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-regenerar]") : null;
			if (b && !el.aseoGenerar.disabled) el.aseoGenerar.click();
		});

		function pintarAseo() {
			if (!grupo) return;
			pintarSelectorMes();
			if (!aseo.mes) {
				el.aseoPreview.innerHTML = "<p class='text-sm text-gray-500'>El calendario cargado no tiene meses con clase.</p>";
				el.aseoSalida.hidden = true;
				return;
			}
			cargarConfigMes();
			pintarVistaRol();
		}

		el.aseoMes.addEventListener("change", function () {
			if (generandoImagenes) { el.aseoMes.value = aseo.mes; return; } // se está generando el mes elegido
			aseo.mes = el.aseoMes.value; cargarConfigMes(); pintarVistaRol(); estadoAseo(""); });
		el.aseoPorDia.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-pordia]") : null;
			if (!b) return;
			aseo.porDia = R.porDiaValido(b.getAttribute("data-pordia"));
			pintarPorDia();
		});
		el.aseoPorDia.addEventListener("keydown", function (e) {
			if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
			e.preventDefault();
			aseo.porDia = R.porDiaValido(aseo.porDia + (e.key === "ArrowRight" ? 1 : -1));
			pintarPorDia();
			var b = el.aseoPorDia.querySelector("[aria-checked=true]");
			if (b) b.focus();
		});
		el.aseoContinuar.addEventListener("change", function () {
			var continuo = R.inicioContinuo(rolAnterior(aseo.mes), activos, todos);
			if (el.aseoContinuar.checked && continuo) el.aseoInicio.value = continuo.id;
			el.aseoInicio.disabled = !!(el.aseoContinuar.checked && continuo);
		});
		el.aseoVista.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-vista]") : null;
			if (!b) return;
			aseo.vista = b.getAttribute("data-vista") === "calendario" ? "calendario" : "lista";
			pintarVistaRol();
		});

		el.aseoGenerar.addEventListener("click", async function () {
			if (!activos.length) { estadoAseo("Este grupo no tiene alumnos activos. Agrégalos en Mi grupo."); return; }
			var mes = aseo.mes;
			var dias = diasClaseMes(mes);
			if (!dias.length) { estadoAseo("Este mes no tiene días de clase."); return; }
			if (roles[mes]) {
				var ok = await confirmar("Reemplazar el rol guardado", "Ya tienes un rol de aseo guardado para " + C.nombreMes(mes) + ". Si lo generas de nuevo se reemplaza, con todo y los cambios que hiciste a mano.", "Reemplazar");
				if (!ok) return;
			}
			var continuo = R.inicioContinuo(rolAnterior(mes), activos, todos);
			var continua = !!(el.aseoContinuar.checked && continuo);
			var inicioId = continua ? continuo.id : el.aseoInicio.value;
			var r = R.generar({ dias: dias, alumnos: activos, porDia: aseo.porDia, inicioId: inicioId });
			el.aseoGenerar.disabled = true;
			estadoAseo("Guardando...");
			try {
				var res = await escribir(function () {
					return window.sb.from("roles_aseo").upsert({
						maestro_id: userId, grupo_id: grupo.id, mes: mes + "-01", por_dia: aseo.porDia,
						inicia_alumno_id: inicioId || null, continua: continua,
						siguiente_alumno_id: r.siguienteId, siguiente_num_lista: r.siguienteNum,
						asignacion: r.asignacion,
						// Quiénes estaban activos: para avisar después de las altas (nuevosSinTurno)
						activos_al_generar: activos.map(function (a) { return a.id; }),
					}, { onConflict: "grupo_id,mes" }).select("*");
				});
				if (res.error) throw res.error;
				roles[mes] = (res.data || [])[0];
				pintarSelectorMes();
				pintarVistaRol();
				estadoAseo("Guardado. " + dias.length + " días de clase en " + C.nombreMes(mes) + ".");
			} catch (e) {
				console.error("calendario: guardar rol", e);
				estadoAseo("");
				mensaje("error", "No se pudo guardar el rol de aseo: " + textoError(e) + ". Revisa tu conexión y vuelve a intentarlo.");
			} finally {
				el.aseoGenerar.disabled = false;
			}
		});

		// ── Cambiar a mano un alumno de un día ────────────────────────────────
		el.aseoPreview.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-cambiar-fecha]") : null;
			if (!b) return;
			var fecha = b.getAttribute("data-cambiar-fecha"), pos = Number(b.getAttribute("data-cambiar-pos"));
			var g = roles[aseo.mes];
			var dia = R.asignacionValida(g.asignacion).filter(function (d) { return d.fecha === fecha; })[0];
			if (!dia) return;
			var actual = dia.alumnos[pos];
			var ocupados = dia.alumnos.filter(function (x, i) { return i !== pos; });
			var sel = el.dlgCambio.querySelector("select");
			sel.innerHTML = activos.map(function (a) {
				var ya = ocupados.indexOf(a.id) !== -1;
				return "<option value='" + esc(a.id) + "'" + (a.id === actual ? " selected" : "") + (ya ? " disabled" : "") + ">" + esc(nombreAlumno(a)) + (ya ? " (ya está ese día)" : "") + "</option>";
			}).join("");
			var nombres = nombresPorId();
			el.dlgCambio.querySelector("[data-texto]").textContent = "El " + C.fechaLarga(fecha, false) + " le toca a " + (nombres[actual] ? nombres[actual].nombre : "un alumno que ya no está en la lista") + ". Elige a quién le toca en su lugar.";
			el.dlgCambio.dataset.fecha = fecha;
			el.dlgCambio.dataset.pos = String(pos);
			el.dlgCambio.showModal();
			sel.focus();
		});
		el.dlgCambio.querySelector("[data-ok]").addEventListener("click", async function () {
			var fecha = el.dlgCambio.dataset.fecha, pos = Number(el.dlgCambio.dataset.pos);
			var nuevo = el.dlgCambio.querySelector("select").value;
			el.dlgCambio.close();
			var g = roles[aseo.mes];
			if (!g || !nuevo) return;
			var mes = aseo.mes;
			var asignacion = R.cambiar(R.asignacionValida(g.asignacion), fecha, pos, nuevo);
			estadoAseo("Guardando...");
			try {
				var res = await escribir(function () {
					return window.sb.from("roles_aseo").update({ asignacion: asignacion }).eq("id", g.id).eq("maestro_id", userId).select("*");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("el rol ya no existe; vuelve a generarlo");
				roles[mes] = res.data[0];
				pintarVistaRol();
				estadoAseo("Cambio guardado.");
			} catch (e) {
				console.error("calendario: cambiar alumno", e);
				estadoAseo("");
				mensaje("error", "No se pudo guardar el cambio: " + textoError(e) + ". El rol muestra lo que sí está guardado.");
			}
		});

		// ── Salida: imagen, compartir, texto, impresión ───────────────────────
		function datosSalida() {
			var filas = filasActuales() || [];
			return { filas: filas, semanas: R.porSemanas(filas, C.sumarDias, C.diaSemana) };
		}

		// Las imágenes del rol (una o varias, de 2400 px como máximo) → [{ blob, nombre }]
		/*
			Tras R20: cambiar de mes mientras se generaban las imágenes mezclaba los archivos (el
			nombre se armaba con el mes de ese momento, después de cada espera). Ahora el mes, el
			grupo y los datos se congelan al empezar, y el selector de mes y los botones de salida
			quedan bloqueados hasta terminar (generandoImagenes).
		*/
		var generandoImagenes = false;
		function bloquearSalida(si) {
			generandoImagenes = si;
			[el.aseoMes, el.aseoImagen, el.aseoCompartir].forEach(function (b) { b.disabled = si; });
		}
		async function crearImagenes() {
			var mes = aseo.mes, nombreGrupo = grupo.nombre;
			var d = datosSalida();
			var m = metaImagen();
			var medidor = document.createElement("canvas").getContext("2d");
			var hojas = R.paginas(medidor, { mes: m.mes, escuela: m.escuela, grupo: m.grupo, semanas: d.semanas, fechaCorta: C.fechaCorta, fechaSemana: fechaSemana });
			var salida = [];
			for (var i = 0; i < hojas.length; i++) {
				var canvas = R.pintar(document.createElement("canvas"), hojas[i]);
				var blob = await new Promise(function (resolver, rechazar) {
					canvas.toBlob(function (b) { if (b) resolver(b); else rechazar(new Error("el navegador no pudo crear la imagen")); }, "image/png");
				});
				salida.push({ blob: blob, nombre: nombreArchivo(mes, nombreGrupo, i + 1, hojas.length), mes: mes });
			}
			return salida;
		}

		function descargar(blob, nombre) {
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = nombre;
			a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
		}

		// Descarga todas (una tras otra: algunos navegadores piden permiso para varias descargas)
		function descargarTodas(imagenes) {
			imagenes.forEach(function (im, i) { setTimeout(function () { descargar(im.blob, im.nombre); }, i * 400); });
			estadoAseo(imagenes.length === 1
				? "Imagen guardada en tus descargas: " + imagenes[0].nombre + "."
				: imagenes.length + " imágenes guardadas en tus descargas, de " + imagenes[0].nombre + " a " + imagenes[imagenes.length - 1].nombre + ". Si el navegador pregunta, permite descargar varios archivos.");
		}

		el.aseoImagen.addEventListener("click", async function () {
			if (generandoImagenes) return;
			bloquearSalida(true);
			try {
				descargarTodas(await crearImagenes());
			} catch (e) {
				console.error("calendario: imagen", e);
				mensaje("error", "No se pudo crear la imagen: " + textoError(e) + ".");
			} finally {
				bloquearSalida(false);
			}
		});

		// Compartir con archivo: solo si el aparato lo permite (celulares, sobre todo)
		var puedeCompartir = false;
		try {
			puedeCompartir = !!(navigator.share && navigator.canShare && typeof File === "function" &&
				navigator.canShare({ files: [new File([new Blob(["x"], { type: "image/png" })], "rol.png", { type: "image/png" })] }));
		} catch (_) { puedeCompartir = false; }
		el.aseoCompartir.hidden = !puedeCompartir;
		// Compartir manda TODAS las imágenes del mes en un solo envío
		el.aseoCompartir.addEventListener("click", async function () {
			if (generandoImagenes) return;
			bloquearSalida(true);
			var imagenes = null;
			try {
				imagenes = await crearImagenes();
				var archivos = imagenes.map(function (im) { return new File([im.blob], im.nombre, { type: "image/png" }); });
				if (navigator.canShare && !navigator.canShare({ files: archivos })) throw new Error("sin compartir");
				await navigator.share({ files: archivos, title: "Rol de aseo, " + C.nombreMes(imagenes[0].mes) });
			} catch (e) {
				if (e && e.name === "AbortError") return; // la maestra cerró el menú de compartir
				if (imagenes && imagenes.length) {
					descargarTodas(imagenes);
					estadoAseo("No se pudo abrir Compartir; " + (imagenes.length === 1 ? "la imagen quedó" : "las " + imagenes.length + " imágenes quedaron") + " en tus descargas.");
					return;
				}
				mensaje("error", "No se pudo crear la imagen: " + textoError(e) + ".");
			} finally {
				bloquearSalida(false);
			}
		});

		el.aseoCopiar.addEventListener("click", async function () {
			var t = R.texto(metaImagen(), datosSalida().filas, C.fechaCorta);
			var copiado = false;
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); copiado = true; }
			} catch (_) {}
			if (!copiado) {
				var ta = document.createElement("textarea");
				ta.value = t;
				ta.setAttribute("readonly", "");
				ta.style.position = "fixed"; ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				try { copiado = document.execCommand("copy"); } catch (_) {}
				ta.remove();
			}
			estadoAseo(copiado ? "Texto copiado. Pégalo en WhatsApp." : "No se pudo copiar. Mantén presionado el texto para copiarlo.");
		});

		function prepararImpresion() {
			var meta = { escuela: escuela, grupo: grupo ? grupo.nombre : "", ciclo: ciclo ? ciclo.ciclo : "", fuente: ciclo ? C.textoFuente(ciclo) : "" };
			if (pestana === "aseo" && roles[aseo.mes]) {
				el.impresion.innerHTML = htmlImpresionRol({ mes: C.nombreMes(aseo.mes), escuela: escuela, grupo: meta.grupo }, datosSalida().semanas);
			} else {
				el.impresion.innerHTML = htmlImpresionMes(meta, mesVista, ajustes, hoy, cumplesPorFecha);
			}
		}
		window.addEventListener("beforeprint", prepararImpresion);
		el.aseoImprimir.addEventListener("click", function () { prepararImpresion(); window.print(); });
		var imprimirMes = $("calImprimir");
		if (imprimirMes) imprimirMes.addEventListener("click", function () { prepararImpresion(); window.print(); });

		// ── Arranque ──────────────────────────────────────────────────────────
		function pestanaDelHash() { return (window.location.hash || "").replace(/^#/, ""); }
		elegirPestana(pestanaDelHash());
		window.addEventListener("hashchange", function () { elegirPestana(pestanaDelHash()); });
		el.leyenda.innerHTML = htmlLeyenda();
		if (ciclo) {
			el.fuente.textContent = C.textoFuente(ciclo);
			el.fuenteLink.href = ciclo.fuente.url;
		}

		window.Lectura.arrancar(async function () {
			var ses = await window.sb.auth.getSession();
			if (ses.error || !ses.data.session) { window.location.href = "index.html"; return; }
			userId = ses.data.session.user.id;
			grupo = (await window.GrupoActivo.cargar(window.sb, userId)).grupo;
			if (!grupo) { window.location.href = "onboarding.html"; return; }

			var lecturas = await Promise.all([
				window.Lectura.uno(window.sb.from("perfiles").select("escuela").eq("id", userId).maybeSingle()),
				window.Lectura.uno(window.sb.from("calendario_ajustes").select("id, fecha, tipo, motivo")
					.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("fecha")),
				window.Lectura.uno(window.sb.from("alumnos").select("id, nombre_completo, num_lista, estatus, fecha_nacimiento")
					.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("num_lista", { ascending: true }).order("nombre_completo", { ascending: true })),
				window.Lectura.uno(window.sb.from("roles_aseo").select("*").eq("maestro_id", userId).eq("grupo_id", grupo.id).order("mes")),
			]);
			var perfil = lecturas[0] || {};
			escuela = String(grupo.escuela || perfil.escuela || "").trim();
			// Solo los ajustes de un día hábil dentro del periodo de clases de un ciclo cargado: la base
			// ya no acepta fines de semana y el periodo depende del ciclo (CalendarioSEP.ajusteEnPeriodo)
			ajustes = (lecturas[1] || []).filter(function (a) { return C.ajusteEnPeriodo(a.fecha); });
			todos = lecturas[2] || [];
			activos = R.ordenarAlumnos(todos.filter(function (a) { return a.estatus === "activo"; }));
			roles = {};
			(lecturas[3] || []).forEach(function (r) { roles[String(r.mes).slice(0, 7)] = r; });

			el.subtitulo.textContent = (grupo.nombre || "Grupo") + (ciclo ? " · Ciclo " + ciclo.ciclo : "") + (escuela ? " · " + escuela : "");
			cumples = window.Cumpleanos ? window.Cumpleanos.proximos(todos, hoy) : { lista: [], sinFecha: 0 };
			cumplesPorFecha = window.Cumpleanos ? window.Cumpleanos.porFecha(cumples.lista) : {};
			pintarCumples();
			pintarCalendario();
			pintarAseo();
		});
	});
})();
