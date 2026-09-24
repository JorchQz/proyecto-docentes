/*
	reporte-alumno.js — Reporte trimestral detallado por alumno (Mi salón, B.8.2).

	Equivale a la "Plantilla_Reporte" de Fanny, mejorada: desglose por rubro
	(obtenido / máximo / %), cuaderno, habilidades con PPM contra la banda del grado,
	avance por PDA, observaciones y retroalimentaciones destacadas.

	URL: reporte-alumno.html?alumno=<uuid>&trimestre=<1|2|3>
	Sin parámetros: selector de alumno (grupo activo) y trimestre.

	No calcula nada por su cuenta: todo sale de ReporteDatos.alumnoTrimestre
	(motor único, diagnóstica, v_avance_pda, textos Capa 1, boleta del ciclo y
	retroalimentaciones). Esta página SOLO LEE; no escribe en la base.

	Reglas que respeta:
	  - Calificación: la CONFIRMADA por el docente; si no hay, la propuesta del motor
	    rotulada "propuesta, sin confirmar" (vista interna). Nunca se convierte un
	    porcentaje a calificación aquí: eso lo hace la función SQL (Acuerdo 10/09/23).
	  - La asistencia es dato de referencia: no pondera (art. 7).
	  - El examen por campo es aproximado (valor_total / total_preguntas) y así se dice.
	  - Es un reporte interno para el docente y la familia, complemento de la boleta
	    oficial (SIGED); no es un documento oficial de la SEP.

	Las funciones de render son puras (datos → HTML) y se exportan en
	window.ReporteAlumno para probarlas en node (pruebas/reporte-alumno.test.js).
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var RUBROS = ["tareas", "trabajos", "participacion", "conducta", "examen"];
	var ETIQUETA_RUBRO = {
		tareas: "Tareas", trabajos: "Trabajos", participacion: "Participación",
		conducta: "Conducta", examen: "Examen",
	};
	var ETIQUETA_NIVEL = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
	var COLOR_NIVEL = { logrado: "#10b981", en_proceso: "#f59e0b", requiere_apoyo: "#ef4444" };
	var ETIQUETA_TENDENCIA = { mejora: "Mejora", estable: "Estable", baja: "Baja", sin_datos: "Falta evidencia" };
	var COLOR_TENDENCIA = { mejora: "#047857", estable: "#4b5563", baja: "#dc2626", sin_datos: "#9ca3af" };
	var ORDEN_NIVEL = { requiere_apoyo: 0, en_proceso: 1, logrado: 2 };
	// Fluidez lectora: cuatro tramos de bandas_ppm (los umbrales viven en la tabla)
	var COLOR_FLUIDEZ = { requiere_apoyo: "#ef4444", cercano: "#f59e0b", estandar: "#10b981", avanzado: "#047857" };
	var ETIQUETA_FLUIDEZ_DEFECTO = {
		requiere_apoyo: "Requiere apoyo", cercano: "Cercano a la referencia", estandar: "En la referencia", avanzado: "Avanzado",
	};
	var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

	// ── Utilidades de formato ─────────────────────────────────────────────────
	function RD() { return window.ReporteDatos; }
	function CH() { return window.CatalogoHabilidades; }

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function vacio(v) { return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v)); }

	// Porcentaje con un decimal (igual que la boleta: 49.86 no se ve como "50 %")
	function fmtPct(v) {
		// Truncado a un decimal, igual que la boleta de Reportes: antes 64.35 salía 64.3 en
		// una pantalla y 64.4 en otra; además 49.97 no se lee "50.0 %" junto a un 5
		if (vacio(v)) return "—";
		return (Math.floor(Number(v) * 10 + 1e-9) / 10).toFixed(1) + "\u00a0%"; // el % no se separa del número
	}

	// Cantidades de obtenido / máximo: hasta dos decimales, sin ceros de relleno
	function fmtCantidad(v) {
		if (vacio(v)) return "—";
		var r = Math.round(Number(v) * 100) / 100;
		return String(r);
	}

	function fmtFecha(iso) {
		if (!iso) return "";
		var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return esc(iso);
		return Number(m[3]) + " " + MESES[Number(m[2]) - 1] + " " + m[1];
	}

	function fechaHoyISO(d) {
		var f = d || new Date();
		var local = new Date(f.getTime() - f.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	function faseDeGrado(grado) {
		var g = Number(grado);
		if (g <= 2) return 3;
		if (g <= 4) return 4;
		return 5;
	}

	// Mismo texto que la boleta imprimible (ReporteDatos.escalaDeGrado): la escala va por
	// grado, no por fase (decisión 17b: 1° de 6 a 10; 2° a 6° de 5 a 10)
	function escalaDeGrado(grado) {
		return "enteros de " + RD().escalaDeGrado(grado);
	}

	// Fase y escala como se entregaron (foto del cierre, ReporteDatos.alumnoTrimestre)
	function faseDe(datos) {
		return datos.fase || faseDeGrado(datos.alumno ? datos.alumno.grado : 3);
	}
	function escalaDe(datos) {
		return datos.escala ? "enteros de " + datos.escala : escalaDeGrado(datos.alumno ? datos.alumno.grado : 3);
	}

	function colorCampo(c) { return (RD() && RD().COLOR_CAMPO[c]) || "#6b7280"; }
	function nombreCampo(c) { return (RD() && RD().NOMBRE_CAMPO[c]) || c; }

	function chipCampo(c) {
		return "<span class='inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold text-white' style='background:" +
			colorCampo(c) + "'>" + esc(c) + "</span>";
	}

	function chipGrado(grado) {
		var color = (RD() && RD().COLOR_GRADO[grado]) || "#6b7280";
		return "<span class='inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-semibold text-white' style='background:" +
			color + "'>" + esc(grado) + "°</span>";
	}

	// Semáforo: color Y texto (el color solo no basta, ni en pantalla ni impreso en gris)
	function semaforo(nivel, textoVacio) {
		if (!nivel || !ETIQUETA_NIVEL[nivel]) {
			return "<span class='inline-flex items-center gap-1.5 whitespace-nowrap text-gray-400'>" +
				"<span class='inline-block w-3 h-3 rounded-full border border-gray-300 shrink-0'></span>" +
				"<span>" + esc(textoVacio || "No evaluado") + "</span></span>";
		}
		return "<span class='inline-flex items-center gap-1.5 whitespace-nowrap' data-nivel='" + nivel + "'>" +
			"<span class='inline-block w-3 h-3 rounded-full shrink-0' style='background:" + COLOR_NIVEL[nivel] + "'></span>" +
			"<span>" + ETIQUETA_NIVEL[nivel] + "</span></span>";
	}

	function titulo(numero, texto, extra) {
		return "<h2 class='text-base sm:text-lg font-bold text-gray-800 mb-3 flex flex-wrap items-baseline gap-x-2'>" +
			"<span class='text-blue-700'>" + numero + ".</span><span>" + esc(texto) + "</span>" +
			(extra ? "<span class='text-xs font-normal text-gray-500'>" + extra + "</span>" : "") + "</h2>";
	}

	function nota(html) {
		return "<p class='text-xs text-gray-500 leading-relaxed'>" + html + "</p>";
	}

	// ── Lectura de los datos (sin cálculo propio) ─────────────────────────────

	function filaBoleta(datos, campo) {
		var ciclo = datos.boletaCiclo || {};
		return (ciclo[datos.trimestre] || {})[campo] || null;
	}

	// Boleta cerrada: textos y trabajo diario como se entregaron (ReporteDatos.boletaCerrada)
	function cerradaDe(datos) {
		return RD().boletaCerrada((datos.boletaCiclo || {})[datos.trimestre]);
	}

	/*
		El campo como se muestra: el del motor, salvo que la boleta esté cerrada; entonces el
		porcentaje es el guardado al cerrar (igual que en Reportes). Con la foto completa del
		cierre (datos.deCierre), datos.motor ya trae el desglose por rubro del cierre; en
		boletas cerradas antes de esa foto, el desglose es el de hoy. cambioTrasCierre avisa si
		lo de hoy (datos.motorVivo) ya no coincide con lo entregado.
	*/
	function campoVisible(datos, campo) {
		var pc = (datos.motor && datos.motor.porCampo && datos.motor.porCampo[campo]) || { rubros: {}, porcentaje: null };
		var fila = filaBoleta(datos, campo);
		if (!cerradaDe(datos) || !fila || vacio(fila.porcentaje)) return pc;
		var guardado = Number(fila.porcentaje);
		var vivo = datos.motorVivo && datos.motorVivo.porCampo && datos.motorVivo.porCampo[campo]
			? datos.motorVivo.porCampo[campo].porcentaje : pc.porcentaje;
		return Object.assign({}, pc, {
			porcentaje: guardado,
			// El semáforo del campo también es el del cierre
			nivel: fila.nivel || pc.nivel,
			// También si hoy ya no hay evidencias (se borraron productos o capturas)
			cambioTrasCierre: vacio(vivo) || Math.abs(Number(vivo) - guardado) >= 0.05,
		});
	}

	/*
		Qué calificación se muestra en un campo:
		  confirmada → la del docente (calificacionOficial)
		  propuesta  → la del motor (SQL), rotulada "propuesta, sin confirmar"
		  sin_datos  → ni confirmada ni propuesta
	*/
	function calificacionCampo(datos, campo) {
		var oficial = RD().calificacionOficial(filaBoleta(datos, campo));
		if (oficial.confirmada) {
			// juicio: el docente la eligió sin evidencias registradas (ReporteDatos.juicioSinEvidencias)
			return { tipo: "confirmada", valor: oficial.valor, cerrada: oficial.cerrada, juicio: !!(datos.juicio && datos.juicio[campo]) };
		}
		var pc = datos.motor && datos.motor.porCampo ? datos.motor.porCampo[campo] : null;
		var propuesta = pc ? pc.calificacionPropuesta : null;
		if (!vacio(propuesta)) return { tipo: "propuesta", valor: Number(propuesta) };
		return { tipo: "sin_datos", valor: null };
	}

	/*
		Peso con el que cada rubro entró de verdad al porcentaje del campo. El motor
		deja fuera los rubros sin datos y reparte su peso entre los demás; aquí solo
		se muestra ese reparto. Si la suma no reproduce el porcentaje del motor (por
		ejemplo, porque el motor cambió), no se muestra: nunca un reparto que no cuadre.
	*/
	function pesosAplicados(pc) {
		if (!pc || !pc.rubros || vacio(pc.porcentaje)) return null;
		var usado = 0;
		RUBROS.forEach(function (r) {
			var x = pc.rubros[r];
			if (x && !vacio(x.fraccion) && Number(x.peso) > 0) usado += Number(x.peso);
		});
		if (!(usado > 0)) return null;
		var aplicado = {}, suma = 0;
		RUBROS.forEach(function (r) {
			var x = pc.rubros[r];
			if (x && !vacio(x.fraccion) && Number(x.peso) > 0) {
				aplicado[r] = Number(x.peso) / usado * 100;
				suma += Number(x.fraccion) * aplicado[r];
			}
		});
		if (Math.abs(suma - Number(pc.porcentaje)) > 0.05) return null;
		return aplicado;
	}

	function rubroSinDatos(x) {
		return !x || !(Number(x.maximo) > 0) || vacio(x.fraccion);
	}

	// ¿Hay algo que mostrar en este trimestre?
	function hayDatos(datos) {
		var m = datos.motor || {};
		var porCampo = m.porCampo || {};
		var algunPct = CAMPOS.some(function (c) { return porCampo[c] && !vacio(porCampo[c].porcentaje); });
		var algunaConfirmada = CAMPOS.some(function (c) { return calificacionCampo(datos, c).tipo === "confirmada"; });
		var asistencia = m.asistencia && m.asistencia.total > 0;
		return algunPct || algunaConfirmada || !!asistencia || !!datos.diagnostica ||
			(datos.avancePda || []).length > 0 || (datos.retroalimentaciones || []).length > 0;
	}

	// ── Render: encabezado ────────────────────────────────────────────────────

	function renderEncabezado(datos, info) {
		var al = datos.alumno || {};
		var dato = function (etiqueta, valor) {
			return "<div class='min-w-0'><dt class='text-xs text-gray-500'>" + esc(etiqueta) + "</dt>" +
				"<dd class='text-sm font-semibold text-gray-800 break-words'>" + valor + "</dd></div>";
		};
		return "<header class='bloque border-b-2 border-gray-200 pb-4 mb-5'>" +
			"<div class='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2'>" +
			"<div><p class='text-xs font-semibold uppercase tracking-wide text-blue-700'>Mi salón</p>" +
			"<h1 class='text-xl sm:text-2xl font-bold text-gray-900'>Reporte trimestral detallado</h1>" +
			(info.escuela ? "<p class='text-sm text-gray-600 mt-0.5'>" + esc(info.escuela) + "</p>" : "") + "</div>" +
			"<div class='sm:text-right'><p class='text-3xl font-bold text-gray-900 leading-none'>Trimestre " + esc(datos.trimestre) + "</p>" +
			"<p class='text-sm text-gray-600 mt-1'>Ciclo escolar " + esc(info.ciclo || "—") + "</p></div>" +
			"</div>" +
			"<dl class='mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3'>" +
			"<div class='col-span-2 min-w-0'><dt class='text-xs text-gray-500'>Alumno</dt>" +
			"<dd class='text-base font-bold text-gray-900 break-words'>" + esc(al.nombre_completo || "—") +
			(al.num_lista ? " <span class='text-xs font-normal text-gray-500'>No. de lista " + esc(al.num_lista) + "</span>" : "") +
			(info.baja ? " <span class='text-xs font-semibold text-red-600'>(dado de baja)</span>" : "") + "</dd></div>" +
			dato("Grado y fase", chipGrado(al.grado) + " <span class='ml-1'>Fase " + faseDe(datos) + "</span>") +
			dato("Grupo", esc(info.grupo || "—")) +
			dato("Docente", esc(info.docente || "—")) +
			dato("Escala de calificación", esc(escalaDe(datos))) +
			"</dl>" +
			"<p class='mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900 leading-relaxed'>" +
			"Reporte interno para el docente y la familia. Complementa la boleta oficial (SIGED): no la sustituye " +
			"ni es un documento oficial de la SEP. La calificación del trimestre es juicio del docente.</p>" +
			"</header>";
	}

	// ── Render: 1. Resumen ────────────────────────────────────────────────────

	function cajaCalificacion(cal, grande) {
		var tam = grande ? "text-3xl" : "text-2xl";
		if (cal.tipo === "confirmada") {
			return "<div><p class='" + tam + " font-bold text-gray-900 leading-none'>" + esc(cal.valor) + "</p>" +
				"<p class='mt-1 text-[11px] font-semibold text-emerald-700'>Confirmada por el docente" +
				(cal.cerrada ? " · boleta cerrada" : "") + "</p>" +
				(cal.juicio ? "<p class='mt-0.5 text-[11px] font-semibold text-amber-800' data-juicio>Por juicio docente, sin evidencias registradas</p>" : "") +
				"</div>";
		}
		if (cal.tipo === "propuesta") {
			// En pantalla el docente ve la propuesta rotulada; impreso (puede llegar a la
			// familia) sale "pendiente", igual que en la boleta: un número sin confirmar
			// nunca se entrega como calificación (Acuerdo 10/09/23, art. 4 XI).
			return "<div><div class='print:hidden'><p class='" + tam + " font-bold text-amber-700 leading-none'>" + esc(cal.valor) + "</p>" +
				"<p class='mt-1 inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800'>" +
				"Propuesta, sin confirmar</p></div>" +
				"<div class='hidden print:block'><p class='" + tam + " font-bold text-gray-400 leading-none'>pendiente</p>" +
				"<p class='mt-1 text-[11px] text-gray-500'>Sin confirmar por el docente</p></div></div>";
		}
		return "<div><p class='" + tam + " font-bold text-gray-300 leading-none'>—</p>" +
			"<p class='mt-1 text-[11px] text-gray-400'>Sin datos</p></div>";
	}

	function renderResumen(datos) {
		var tiles = CAMPOS.map(function (c) {
			var pc = campoVisible(datos, c);
			var cal = calificacionCampo(datos, c);
			return "<div class='rounded-xl border border-gray-200 overflow-hidden'>" +
				"<div class='h-1.5' style='background:" + colorCampo(c) + "'></div>" +
				"<div class='p-3'>" +
				"<p class='flex items-center gap-2 text-xs text-gray-600'>" + chipCampo(c) +
				"<span class='leading-tight'>" + esc(nombreCampo(c)) + "</span></p>" +
				"<div class='mt-2'>" + cajaCalificacion(cal, true) + "</div>" +
				"<p class='mt-2 text-xs text-gray-600'>" + fmtPct(pc.porcentaje) + " del campo</p>" +
				(pc.nivel ? "<p class='mt-1 text-xs'>" + semaforo(pc.nivel) + "</p>" : "") +
				"</div></div>";
		}).join("");

		var a = (datos.motor && datos.motor.asistencia) || {};
		var asistencia = a.total > 0
			? "<span class='font-semibold text-gray-800'>" + a.presentes + " de " + a.total + " días</span> con asistencia (" +
				fmtPct(a.porcentaje * 100) + "), contando las faltas justificadas."
			: "Sin registros de asistencia en el trimestre.";

		return "<section class='mb-7'>" + titulo(1, "Resumen del trimestre") +
			"<div class='bloque grid grid-cols-2 sm:grid-cols-4 gap-3'>" + tiles + "</div>" +
			renderFinal(datos) +
			"<div class='bloque mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700' data-asistencia>" +
			"<span class='font-semibold'>Asistencia:</span> " + asistencia +
			" <span class='block sm:inline text-xs text-gray-500'>Dato de referencia: la asistencia no forma parte de la calificación.</span></div>" +
			"</section>";
	}

	/*
		Evaluación final del ciclo: T1, T2, T3 y final por campo, promedio final de grado y
		acreditación (ReporteDatos.finalCiclo, la misma función de todos los documentos).
		Solo con calificaciones confirmadas; lo demás, "pendiente".
	*/
	function renderFinal(datos) {
		if (!RD() || !RD().htmlFinalCiclo) return "";
		return "<div class='bloque mt-4 rounded-xl border border-gray-200 p-3' data-seccion='final'>" +
			"<h3 class='text-sm font-semibold text-gray-800 mb-2'>Evaluación final del ciclo</h3>" +
			// Reporte para el docente y la familia: la acreditación con el texto para familias
			RD().htmlFinalCiclo(datos.boletaCiclo || {}, datos.alumno ? datos.alumno.grado : null, { trimestre: Number(datos.trimestre), familias: true }) +
			"</div>";
	}

	// ── Render: 2. Desempeño por campo ────────────────────────────────────────

	function hayExamen(datos) {
		var porCampo = (datos.motor && datos.motor.porCampo) || {};
		return CAMPOS.some(function (c) {
			var x = porCampo[c] && porCampo[c].rubros ? porCampo[c].rubros.examen : null;
			return x && Number(x.maximo) > 0;
		});
	}

	function tablaRubros(pc) {
		/*
			Columna "Peso": lo que valió cada rubro en ESTE cálculo (peso efectivo, suma 100 %
			entre los rubros con datos; MotorCalificacion.pesosEfectivos). Los pesos de Ajustes
			son relativos: mostrar 28, 28, 6 y 33 "%" sumaba 95. Solo si el reparto reproduce
			el porcentaje del motor (pesosAplicados); si no, el peso relativo tal cual.
		*/
		var aplicado = pesosAplicados(pc);
		var M = window.MotorCalificacion;
		var efectivo = aplicado && M && M.pesosEfectivos ? M.pesosEfectivos(pc.rubros) : null;
		var sinDatos = [];
		var filas = RUBROS.map(function (r) {
			var x = (pc.rubros || {})[r] || { obtenido: 0, maximo: 0, fraccion: null, peso: 0 };
			var peso = Number(x.peso) || 0;
			// Conducta: se registra y se informa, pero no pondera (salvo en una boleta cerrada
			// antes del cambio, que conserva el peso con que se entregó)
			var referencia = r === "conducta" && !(peso > 0);
			var nombre = "<span class='font-medium text-gray-800'>" + ETIQUETA_RUBRO[r] + "</span>" +
				(r === "examen" ? " <span class='ml-1 rounded border border-amber-300 bg-amber-50 px-1 py-px text-[10px] font-semibold text-amber-800'>aproximado</span>" : "") +
				(r === "participacion" || r === "conducta" ? "<span class='hidden sm:block text-[11px] text-gray-400 print:hidden'>registro diario repartido</span>" : "");
			var celdaPeso = peso > 0
				? (efectivo && efectivo[r] !== undefined
					? "<span data-peso-efectivo='" + efectivo[r] + "'>" + String(efectivo[r]).replace(/\.0$/, "") + "\u00a0%</span>"
					: "<span class='text-gray-500'>peso " + peso + "</span>")
				: (referencia ? "<span class='text-gray-500 text-[11px] leading-tight' data-no-pondera>referencia, no pondera</span>"
					: "<span class='text-gray-400'>sin peso</span>");
			if (rubroSinDatos(x)) {
				if (peso > 0) sinDatos.push(ETIQUETA_RUBRO[r].toLowerCase());
				return "<tr data-rubro='" + r + "' class='align-top'>" +
					"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200'>" + nombre + "</td>" +
					"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center text-gray-400'>" +
					(peso > 0 ? "no entra<span class='block text-[11px]'>se reparte</span>" : celdaPeso) + "</td>" +
					"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center text-gray-300'>—</td>" +
					"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center text-gray-300'>—</td>" +
					"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center text-gray-400 italic whitespace-nowrap'>sin datos</td></tr>";
			}
			var extraPeso = "";
			return "<tr data-rubro='" + r + "' class='align-top'>" +
				"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200'>" + nombre + "</td>" +
				"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center sm:whitespace-nowrap'>" + celdaPeso + extraPeso + "</td>" +
				"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center'>" + fmtCantidad(x.obtenido) + "</td>" +
				"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center'>" + fmtCantidad(x.maximo) + "</td>" +
				"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center font-semibold whitespace-nowrap'>" + fmtPct(x.fraccion * 100) + "</td></tr>";
		}).join("");

		var explicacion = "";
		if (sinDatos.length && !vacio(pc.porcentaje)) {
			explicacion = nota("Sin datos en " + esc(sinDatos.join(", ")) +
				": su peso se reparte entre los demás rubros en proporción a sus pesos, así que no sube ni baja el porcentaje del campo.");
		}
		return "<div class='overflow-x-auto'><table class='w-full text-xs sm:text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500'>" +
			"<th class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-left'>Rubro</th>" +
			"<th class='px-1.5 sm:px-2 py-1.5 border border-gray-200'>Peso</th>" +
			"<th class='px-1.5 sm:px-2 py-1.5 border border-gray-200'><span class='sm:hidden'>Obt.</span><span class='hidden sm:inline'>Obtenido</span></th>" +
			"<th class='px-1.5 sm:px-2 py-1.5 border border-gray-200'><span class='sm:hidden'>Máx.</span><span class='hidden sm:inline'>Máximo</span></th>" +
			"<th class='px-1.5 sm:px-2 py-1.5 border border-gray-200'>%</th></tr></thead>" +
			"<tbody>" + filas +
			"<tr class='bg-gray-50'><td colspan='4' class='px-1.5 sm:px-2 py-1.5 border border-gray-200 font-semibold text-gray-800'>Porcentaje del campo</td>" +
			"<td class='px-1.5 sm:px-2 py-1.5 border border-gray-200 text-center font-bold text-gray-900 whitespace-nowrap' data-pct-campo>" + fmtPct(pc.porcentaje) + "</td></tr>" +
			"</tbody></table></div>" + (explicacion ? "<div class='mt-2'>" + explicacion + "</div>" : "");
	}

	function renderDesempeno(datos) {
		var m = datos.motor || {};
		var porCampo = m.porCampo || {};
		var notas = [
			"Cada tarea o trabajo que le tocó a su grado suma 1 al máximo; lo obtenido depende del nivel " +
				"(logrado 1, en proceso 0.7, requiere apoyo 0.4) o del puntaje capturado. Lo justificado no cuenta.",
			"Participación y conducta se registran una vez al día, en el cierre del día, y se reparten en partes iguales " +
				"entre los campos trabajados ese día; por eso pueden aparecer fracciones. 1 (normal) y 2 (destacado) " +
				"valen el día completo; 0 no suma.",
			"Un rubro sin datos no cuenta: su peso se reparte entre los demás rubros en proporción a sus pesos.",
		];
		// La conducta no pondera (LGE, art. 21: se informa aparte de la calificación). Una
		// boleta cerrada antes del cambio conserva el peso con que se entregó. Misma regla
		// que ReporteDatos.pesoConductaCierre: cuenta solo con peso Y con datos (un rubro de
		// conducta con peso pero sin datos no entró al cálculo)
		var boletaT = datos.cerrada ? (datos.boletaCiclo || {})[datos.trimestre] : null;
		var conductaPondera = (boletaT ? RD().pesoConductaCierre(boletaT) : RD().pesoConductaCampos(porCampo)) > 0;
		if (!conductaPondera) {
			notas.push("La conducta se registra y se informa como referencia: no forma parte del porcentaje ni de la calificación.");
		} else {
			// Boleta cerrada antes del cambio: su foto trae la conducta con peso, y así se entregó
			notas.push("Esta boleta se cerró cuando la conducta todavía ponderaba: en su porcentaje y su calificación la conducta contó con el peso de su cierre, y eso no se recalcula. " +
				"Desde entonces la conducta se informa aparte y no pondera (Ley General de Educación, art. 21).");
		}
		notas.push("La columna «Peso» dice cuánto valió cada rubro en este cálculo: los pesos de Ajustes son relativos y se reparten el 100 % entre los rubros con datos de cada campo.");
		var escala = window.MotorCalificacion && window.MotorCalificacion.ESCALA_NIVEL;
		if (escala) {
			notas[0] = "Cada tarea o trabajo que le tocó a su grado suma 1 al máximo; lo obtenido depende del nivel " +
				"(logrado " + escala.logrado + ", en proceso " + escala.en_proceso + ", requiere apoyo " + escala.requiere_apoyo +
				") o del puntaje capturado. Lo justificado no cuenta.";
		}
		if (hayExamen(datos) || m.examenAproximado) {
			notas.push("<span class='font-semibold text-amber-800'>Examen aproximado:</span> el banco de preguntas no guarda el valor " +
				"de cada pregunta, así que el puntaje por campo se estima como valor total del examen entre número de preguntas. " +
				"Tómalo como referencia, no como un resultado exacto.");
		}
		// Con la foto completa del cierre todo lo de este reporte es lo entregado: no hay nada
		// que avisar y el documento sale idéntico aunque después cambien capturas o el grado.
		// En boletas cerradas antes de esa foto el desglose es el de hoy y se dice.
		if (!datos.deCierre && CAMPOS.some(function (c) { return campoVisible(datos, c).cambioTrasCierre; })) {
			notas.push("<span class='font-semibold text-gray-800'>Boleta cerrada:</span> hubo capturas después del cierre. " +
				"El porcentaje y la calificación de cada campo son los del cierre; el desglose por rubro muestra los datos de hoy.");
		}
		if (CAMPOS.some(function (c) { return calificacionCampo(datos, c).juicio; })) {
			notas.push("<span class='font-semibold text-amber-800'>Juicio docente:</span> en los campos sin evidencias registradas " +
				"en el trimestre, el docente asignó la calificación por su juicio, dentro de la escala de su grado; no hay porcentaje ni desglose que mostrar.");
		}
		if (m.usaLegacy) {
			notas.push("Incluye calificaciones capturadas con el formato anterior (revisión de tareas del Dashboard, escala 5 a 10).");
		}

		var tarjetas = CAMPOS.map(function (c) {
			var pc = campoVisible(datos, c);
			var cal = calificacionCampo(datos, c);
			var pct = vacio(pc.porcentaje) ? "" : (Math.floor(Number(pc.porcentaje) * 10 + 1e-9) / 10).toFixed(1);
			return "<div class='bloque rounded-xl border border-gray-200 overflow-hidden' data-campo='" + c + "' data-pct='" + pct +
				"' data-cal='" + (cal.valor === null ? "" : cal.valor) + "' data-cal-tipo='" + cal.tipo + "'>" +
				"<div class='flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-200' style='border-left:6px solid " + colorCampo(c) + "'>" +
				"<p class='flex items-center gap-2 min-w-0'>" + chipCampo(c) +
				"<span class='font-semibold text-gray-800 leading-tight'>" + esc(nombreCampo(c)) + "</span></p>" +
				"<div class='text-right shrink-0'>" + cajaCalificacion(cal, false) + "</div></div>" +
				"<div class='p-2 sm:p-3'>" + tablaRubros(pc) + "</div></div>";
		}).join("");

		var pesos = m.pesos || {};
		// Los pesos de Ajustes son relativos (28, 28, 6 y 33 suman 95): sin "%", para que
		// nadie los lea como porcentajes; lo que valió cada rubro va en la columna "Peso"
		var pesosTexto = RUBROS.filter(function (r) { return r !== "conducta" || conductaPondera; })
			.map(function (r) { return ETIQUETA_RUBRO[r] + " " + (Number(pesos[r]) || 0); }).join(" · ") +
			(conductaPondera ? "" : " · Conducta: referencia, no pondera");

		return "<section class='mb-7'>" + titulo(2, "Desempeño por campo formativo", "Pesos relativos: " + esc(pesosTexto)) +
			"<ul class='bloque mb-3 list-disc pl-5 flex flex-col gap-1 text-xs text-gray-500 leading-relaxed'>" +
			notas.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul>" +
			"<div class='grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-3'>" + tarjetas + "</div></section>";
	}

	// ── Render: 3. Cuaderno ───────────────────────────────────────────────────

	function enlaceDiagnostica() {
		return " <a href='evaluacion_diagnostica.html' class='no-print text-blue-700 underline'>Registrar en Evaluación diagnóstica</a>";
	}

	function renderCuaderno(datos) {
		var diag = datos.diagnostica;
		var catalogo = CH();
		var cuerpo;
		if (!diag || !catalogo) {
			cuerpo = nota("Sin revisión de cuaderno registrada en este trimestre." + enlaceDiagnostica());
		} else {
			var mapa = catalogo.aMapa(diag.cuaderno);
			var cuenta = { logrado: 0, en_proceso: 0, requiere_apoyo: 0, sin: 0 };
			var filas = catalogo.CUADERNO.map(function (c) {
				var nivel = mapa[c.clave];
				if (ETIQUETA_NIVEL[nivel]) cuenta[nivel]++; else cuenta.sin++;
				return "<div class='flex items-center justify-between gap-3 border-b border-gray-100 py-1.5 text-sm' data-criterio='" + esc(c.clave) + "'>" +
					"<span class='text-gray-700'>" + esc(c.etiqueta) + "</span>" + semaforo(nivel, "No evaluado") + "</div>";
			}).join("");
			cuerpo = "<p class='mb-2 text-xs text-gray-600'>" + cuenta.logrado + " logrado · " + cuenta.en_proceso + " en proceso · " +
				cuenta.requiere_apoyo + " requiere apoyo" + (cuenta.sin ? " · " + cuenta.sin + " sin evaluar" : "") + "</p>" +
				"<div class='grid grid-cols-1 sm:grid-cols-2 gap-x-8'>" + filas + "</div>";
		}
		return "<section class='bloque mb-7' data-seccion='cuaderno'>" + titulo(3, "Revisión de cuaderno", "10 criterios") + cuerpo + "</section>";
	}

	// ── Render: 4. Habilidades básicas ────────────────────────────────────────

	function tramosBanda(banda) {
		var ra = Number(banda.requiere_apoyo_max), ce = Number(banda.cercano_max), es = Number(banda.estandar_max);
		return [
			{ clave: "requiere_apoyo", desde: 0, hasta: ra, rango: "0 a " + ra },
			{ clave: "cercano", desde: ra + 1, hasta: ce, rango: (ra + 1) + " a " + ce },
			{ clave: "estandar", desde: ce + 1, hasta: es, rango: (ce + 1) + " a " + es },
			{ clave: "avanzado", desde: es + 1, hasta: null, rango: (es + 1) + " o más" },
		];
	}

	function bandaPpm(ppm, banda, nivel, grado) {
		var catalogo = CH();
		var etiquetas = (catalogo && catalogo.ETIQUETA_FLUIDEZ) || ETIQUETA_FLUIDEZ_DEFECTO;
		if (!banda) return nota("No hay referencia de palabras por minuto para " + esc(grado) + "° grado.");
		var tramos = tramosBanda(banda);
		var es = Number(banda.estandar_max), ce = Number(banda.cercano_max);
		var tope = es + Math.max(15, es - ce); // el tramo "avanzado" no tiene techo: se dibuja uno razonable
		var barra = tramos.map(function (t) {
			var hasta = t.hasta === null ? tope : t.hasta;
			var ancho = Math.max(0, (hasta - t.desde + 1) / (tope + 1) * 100);
			var activo = t.clave === nivel;
			return "<div class='h-full' style='width:" + ancho.toFixed(2) + "%;background:" + COLOR_FLUIDEZ[t.clave] +
				";opacity:" + (activo ? "1" : "0.28") + "'></div>";
		}).join("");
		var marcador = "";
		if (!vacio(ppm)) {
			var pos = Math.min(Number(ppm), tope) / (tope + 1) * 100;
			marcador = "<div class='absolute -top-1 -bottom-1' style='left:" + pos.toFixed(2) + "%'>" +
				"<div class='h-full w-0.5 bg-gray-900'></div></div>";
		}
		var leyenda = tramos.map(function (t) {
			var activo = t.clave === nivel;
			return "<div class='flex items-center gap-1.5 text-xs " + (activo ? "font-bold text-gray-900" : "text-gray-500") + "' data-tramo='" + t.clave + "'>" +
				"<span class='inline-block w-2.5 h-2.5 rounded-sm shrink-0' style='background:" + COLOR_FLUIDEZ[t.clave] + "'></span>" +
				"<span>" + esc(etiquetas[t.clave]) + ": " + esc(t.rango) + "</span></div>";
		}).join("");
		// La etiqueta se acota para que no se salga de la barra en los extremos
		var posEtiqueta = vacio(ppm) ? 0 : Math.max(8, Math.min(92, Math.min(Number(ppm), tope) / (tope + 1) * 100));
		return "<div class='relative mt-6 mb-2'>" +
			(!vacio(ppm) ? "<div class='absolute -top-6 text-[11px] font-semibold text-gray-900 whitespace-nowrap' style='left:" +
				posEtiqueta.toFixed(2) + "%;transform:translateX(-50%)'>" + esc(ppm) + " ppm</div>" : "") +
			"<div class='flex h-3 w-full overflow-hidden rounded-full'>" + barra + "</div>" + marcador + "</div>" +
			"<div class='grid grid-cols-2 gap-x-3 gap-y-1 mt-2'>" + leyenda + "</div>";
	}

	function renderHabilidades(datos) {
		var diag = datos.diagnostica;
		var catalogo = CH();
		var grado = datos.alumno ? datos.alumno.grado : "";
		if (!diag || !catalogo) {
			return "<section class='bloque mb-7' data-seccion='habilidades'>" + titulo(4, "Habilidades básicas") +
				nota("Sin evaluación de habilidades registrada en este trimestre." + enlaceDiagnostica()) + "</section>";
		}
		var etiquetas = catalogo.ETIQUETA_FLUIDEZ || ETIQUETA_FLUIDEZ_DEFECTO;
		var ppm = vacio(diag.lectura_ppm) ? null : Number(diag.lectura_ppm);
		var nivelPpm = datos.fluidez || null;
		var fluidezHtml;
		if (ppm === null) {
			fluidezHtml = "<p class='text-sm text-gray-400'>Velocidad lectora no evaluada.</p>";
		} else {
			var tramo = datos.banda ? tramosBanda(datos.banda).filter(function (t) { return t.clave === nivelPpm; })[0] : null;
			fluidezHtml = "<p class='text-sm text-gray-700' data-ppm='" + ppm + "' data-fluidez='" + (nivelPpm || "") + "'>" +
				"Lee <span class='font-bold text-gray-900'>" + ppm + " palabras por minuto</span>" +
				(nivelPpm
					? ". Frente a la referencia SEP 2010 para " + esc(grado) + "°: <span class='inline-flex items-center gap-1 font-semibold'>" +
						"<span class='inline-block w-3 h-3 rounded-full' style='background:" + COLOR_FLUIDEZ[nivelPpm] + "'></span>" +
						esc(etiquetas[nivelPpm]) + "</span>" + (tramo ? " (" + esc(tramo.rango) + " ppm)." : ".")
					: ".") + "</p>";
		}
		var lectura = "<div class='rounded-xl border border-gray-200 p-3'>" +
			"<h3 class='text-sm font-semibold text-gray-800 mb-2'>Lectura</h3>" + fluidezHtml +
			(ppm !== null || datos.banda ? bandaPpm(ppm, datos.banda, nivelPpm, grado) : "") +
			(datos.banda && catalogo.textoReferenciaPPM
				? "<p class='mt-2 text-[11px] text-gray-500 leading-relaxed' data-referencia-ppm>" + esc(catalogo.textoReferenciaPPM(datos.banda, grado)) +
					". Los rangos de palabras por minuto de 2010 son una referencia, no un estándar vigente.</p>"
				: "") +
			"<div class='mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-2 text-sm'>" +
			"<span class='text-gray-700'>Comprensión lectora</span>" + semaforo(diag.lectura_comprension, "No evaluada") + "</div></div>";

		// Solo las habilidades de su grado (datos.alumno trae el grado del cierre si la boleta
		// está cerrada), con el alcance del grado debajo, como el estándar de PPM
		var mates = catalogo.aMapa(diag.matematicas);
		var gradoOk = catalogo.gradoValido ? catalogo.gradoValido(grado) : null;
		var listaMates = catalogo.matematicasDeGrado ? catalogo.matematicasDeGrado(grado) : catalogo.MATEMATICAS;
		var matesHtml = listaMates.map(function (h) {
			var alcance = catalogo.alcanceMatematica ? catalogo.alcanceMatematica(h, grado) : "";
			return "<div class='flex items-center justify-between gap-3 border-b border-gray-100 py-1.5 text-sm last:border-0' data-habilidad='" + esc(h.clave) + "'>" +
				// En 1° y 2°, el nombre con que se evalúa (Fase 3), sin cambiar la clave
				"<span class='text-gray-700'>" + esc(catalogo.etiquetaDeGrado ? catalogo.etiquetaDeGrado(h, grado) : h.etiqueta) +
				(alcance ? "<span class='block text-xs text-gray-500' data-alcance>Alcance en " + gradoOk + "°: " + esc(alcance) + "</span>" : "") +
				"</span>" + semaforo(mates[h.clave], "No evaluada") + "</div>";
		}).join("");
		var matematicas = "<div class='rounded-xl border border-gray-200 p-3'>" +
			"<h3 class='text-sm font-semibold text-gray-800 mb-1'>Matemáticas</h3>" + matesHtml + "</div>";

		return "<section class='bloque mb-7' data-seccion='habilidades'>" + titulo(4, "Habilidades básicas") +
			"<div class='grid grid-cols-1 sm:grid-cols-2 gap-3'>" + lectura + matematicas + "</div></section>";
	}

	// ── Render: 5. Avance por PDA ─────────────────────────────────────────────

	function conteoNiveles(f) {
		var partes = [];
		[["logrados", "logrado"], ["en_proceso", "en proceso"], ["requiere_apoyo", "requiere apoyo"]].forEach(function (p) {
			var n = Number(f[p[0]]) || 0;
			if (n > 0) partes.push("<span class='inline-block mr-2 sm:mr-0 sm:block whitespace-nowrap'>" + n + " " + p[1] + "</span>");
		});
		return partes.length ? partes.join("") : "<span class='text-gray-400'>—</span>";
	}

	// Columnas de la lista de PDA: una sola columna en celular, cinco desde sm (y al imprimir)
	var COLUMNAS_PDA = "grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,1fr)_4rem_6.5rem_7.5rem_5.5rem] sm:gap-x-3 sm:items-start";

	function renderPda(datos) {
		var filas = (datos.avancePda || []).slice();
		var corto = window.CamposFormativos ? window.CamposFormativos.corto : function () { return null; };
		var bloques = CAMPOS.map(function (c) {
			var propias = filas.filter(function (f) { return corto(f.campo_formativo) === c; })
				.sort(function (a, b) {
					return (ORDEN_NIVEL[a.nivel_predominante] - ORDEN_NIVEL[b.nivel_predominante]) || (b.evidencias - a.evidencias);
				});
			var cabecera = "<p class='flex items-center gap-2 px-3 py-2 border-b border-gray-200' style='border-left:6px solid " + colorCampo(c) + "'>" +
				chipCampo(c) + "<span class='font-semibold text-gray-800 text-sm'>" + esc(nombreCampo(c)) + "</span>" +
				"<span class='text-xs text-gray-500'>" + propias.length + " PDA</span></p>";
			if (!propias.length) {
				return "<div class='bloque rounded-xl border border-gray-200 overflow-hidden' data-pda-campo='" + c + "'>" + cabecera +
					"<p class='px-3 py-2 text-sm text-gray-400'>Sin evidencias por PDA en este campo.</p></div>";
			}
			var cuerpo = propias.map(function (f) {
				var ajustes = Number(f.ajustadas_por_el_maestro) > 0
					? "<span class='block text-[11px] text-gray-400'>" + f.ajustadas_por_el_maestro + " ajustada(s) por el docente</span>" : "";
				var tend = ETIQUETA_TENDENCIA[f.tendencia] ? f.tendencia : "sin_datos";
				return "<div class='" + COLUMNAS_PDA + " px-3 py-2 border-b border-gray-100 last:border-0 text-sm' data-pda='" + esc(f.clave_pda) + "'>" +
					"<div class='min-w-0'><span class='text-gray-800'>" + esc(f.pda || "—") + "</span>" +
					(f.contenido ? "<span class='block text-[11px] text-gray-400'>" + esc(f.contenido) + "</span>" : "") + ajustes + "</div>" +
					// En celular los datos van en una línea debajo del PDA; desde sm son columnas
					"<div class='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:contents'>" +
					"<div class='sm:text-center'><span class='sm:hidden text-gray-500'>Evidencias: </span><span class='font-semibold text-sm'>" + esc(f.evidencias) + "</span></div>" +
					"<div class='text-gray-600'>" + conteoNiveles(f) + "</div>" +
					"<div>" + semaforo(f.nivel_predominante, "—") + "</div>" +
					"<div class='font-semibold' style='color:" + COLOR_TENDENCIA[tend] + "' data-tendencia='" + tend + "'>" +
					"<span class='sm:hidden text-gray-500 font-normal'>Tendencia: </span>" + ETIQUETA_TENDENCIA[tend] + "</div>" +
					"</div></div>";
			}).join("");
			return "<div class='bloque rounded-xl border border-gray-200 overflow-hidden' data-pda-campo='" + c + "'>" + cabecera +
				"<div class='hidden sm:grid " + COLUMNAS_PDA.replace("grid ", "") + " px-3 py-1.5 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>" +
				"<div>PDA</div><div class='text-center'>Evidencias</div><div>Por nivel</div><div>Nivel predominante</div><div>Tendencia</div></div>" +
				cuerpo + "</div>";
		}).join("");
		return "<section class='mb-7' data-seccion='pda'>" + titulo(5, "Avance por PDA", "Procesos de desarrollo de aprendizaje de su grado") +
			"<div class='bloque mb-3'>" + nota("Cada evidencia es un producto calificado que trabajó ese PDA. La tendencia compara las primeras " +
				"evidencias con las últimas; con una sola evidencia todavía no hay tendencia (falta evidencia).") + "</div>" +
			"<div class='space-y-3'>" + bloques + "</div></section>";
	}

	// ── Render: 6. Observaciones ──────────────────────────────────────────────

	function origen(delDocente, hayTexto, delCierre) {
		if (!hayTexto) return "";
		// Boleta cerrada: el texto congelado al cerrar, no una propuesta de hoy
		if (!delDocente && delCierre) {
			return "<span class='ml-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-px text-[10px] font-semibold text-emerald-800' data-origen='cierre'>Como se entregó</span>";
		}
		return delDocente
			? "<span class='ml-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-px text-[10px] font-semibold text-blue-800' data-origen='docente'>Del docente</span>"
			: "<span class='ml-1 rounded bg-gray-50 border border-gray-200 px-1.5 py-px text-[10px] font-semibold text-gray-600' data-origen='propuesta'>Propuesta del sistema</span>";
	}

	function cuadroTexto(etiqueta, sec, vacioTexto) {
		var hay = !!(sec.texto && String(sec.texto).trim());
		return "<div class='min-w-0'>" +
			"<p class='text-xs font-semibold text-gray-600 mb-1 flex flex-wrap items-center gap-y-1'>" + esc(etiqueta) + origen(sec.delMaestro, hay, sec.delCierre) + "</p>" +
			(hay ? "<p class='text-sm text-gray-800 leading-relaxed whitespace-pre-line'>" + esc(sec.texto) + "</p>"
				: "<p class='text-sm text-gray-400'>" + esc(vacioTexto) + "</p>") + "</div>";
	}

	function bloqueObservaciones(datos, codigo, cabecera) {
		var TB = window.TextosBoleta;
		var generado = (datos.textos || {})[codigo] || { fortalezas: [], areas: [], sugerencias: [] };
		var parrafo = function (lista) { return TB ? TB.comoParrafo(lista) : (lista || []).join(" "); };
		var fila = filaBoleta(datos, codigo);
		var cerrada = cerradaDe(datos);
		var f = RD().textoSeccion(fila, "fortalezas", parrafo(generado.fortalezas), cerrada);
		var a = RD().textoSeccion(fila, "areas_oportunidad", parrafo(generado.areas), cerrada);
		var s = RD().textoSeccion(fila, "sugerencias", parrafo(generado.sugerencias), cerrada);
		return "<div class='bloque rounded-xl border border-gray-200 overflow-hidden' data-obs='" + codigo + "'>" + cabecera +
			"<div class='grid grid-cols-1 sm:grid-cols-3 gap-3 p-3'>" +
			cuadroTexto("Fortalezas", f, "Sin fortalezas señaladas con la evidencia del trimestre.") +
			cuadroTexto("Áreas de oportunidad", a, "Sin áreas de oportunidad señaladas.") +
			cuadroTexto("Sugerencias", s, "Sin sugerencias por ahora.") + "</div></div>";
	}

	function renderObservaciones(datos) {
		var diag = datos.diagnostica;
		// null = el maestro no lo ha escrito (propuesta); "" = lo vació a propósito
		var trabajo = RD().trabajoDiario(diag, (datos.textos && datos.textos.trabajoDiario) || "", filaBoleta(datos, "GEN"), cerradaDe(datos));

		var bloques = CAMPOS.map(function (c) {
			var cab = "<p class='flex items-center gap-2 px-3 py-2 border-b border-gray-200' style='border-left:6px solid " + colorCampo(c) + "'>" +
				chipCampo(c) + "<span class='font-semibold text-gray-800 text-sm'>" + esc(nombreCampo(c)) + "</span></p>";
			return bloqueObservaciones(datos, c, cab);
		}).join("");
		var cabGen = "<p class='flex items-center gap-2 px-3 py-2 border-b border-gray-200' style='border-left:6px solid #1e40af'>" +
			"<span class='font-semibold text-gray-800 text-sm'>Generales</span>" +
			"<span class='text-xs text-gray-500'>hábitos, cuaderno, participación, conducta y asistencia (estas dos no ponderan)</span></p>";

		return "<section class='mb-7' data-seccion='observaciones'>" + titulo(6, "Observaciones") +
			"<div class='bloque mb-3'>" + nota("<span class='font-semibold text-blue-800'>Del docente:</span> lo escribió o ajustó el docente en la boleta. " +
				"<span class='font-semibold text-gray-700'>Propuesta del sistema:</span> sale de lo capturado en el trimestre; el docente la revisa y puede editarla en la boleta." +
				(cerradaDe(datos) ? " <span class='font-semibold text-emerald-800'>Como se entregó:</span> la boleta está cerrada y el texto quedó como estaba al cerrarla." : "")) + "</div>" +
			"<div class='bloque rounded-xl border border-gray-200 p-3 mb-3' data-obs='trabajo'>" +
			cuadroTexto("Trabajo diario", trabajo, "Sin observaciones del trabajo diario.") + "</div>" +
			"<div class='space-y-3'>" + bloques + bloqueObservaciones(datos, "GEN", cabGen) + "</div></section>";
	}

	// ── Render: 7. Retroalimentaciones destacadas ─────────────────────────────

	function renderRetro(datos) {
		var lista = (datos.retroalimentaciones || []).filter(function (r) { return r && r.texto && String(r.texto).trim(); }).slice(0, 5);
		var cuerpo;
		if (!lista.length) {
			cuerpo = nota("No hay retroalimentaciones escritas en este trimestre.");
		} else {
			cuerpo = "<ol class='flex flex-col gap-2'>" + lista.map(function (r) {
				var campo = r.campo && CAMPOS.indexOf(r.campo) !== -1 ? r.campo : null;
				return "<li class='bloque rounded-lg border border-gray-200 px-3 py-2' data-retro>" +
					"<p class='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500'>" +
					(campo ? chipCampo(campo) : "") +
					"<span class='font-semibold text-gray-700'>" + esc(r.producto || "Producto") + "</span>" +
					(r.fecha ? "<span>" + fmtFecha(r.fecha) + "</span>" : "") + "</p>" +
					"<p class='mt-1 text-sm text-gray-800 leading-relaxed'>&laquo;" + esc(String(r.texto).trim()) + "&raquo;</p></li>";
			}).join("") + "</ol>";
		}
		return "<section class='bloque mb-7' data-seccion='retro'>" + titulo(7, "Retroalimentaciones destacadas", "las más recientes del trimestre") +
			cuerpo + "</section>";
	}

	function renderPie(datos, info) {
		return "<footer class='bloque mt-6 border-t border-gray-200 pt-3 text-[11px] text-gray-500 leading-relaxed'>" +
			"<p>Semáforo del campo: logrado con 80 % o más, en proceso de 60 % a 79.9 %, requiere apoyo debajo de 60 %. " +
			"Escala de su grado: " + esc(escalaDe(datos)) +
			". El sistema propone la calificación y el docente la confirma.</p>" +
			"<p class='mt-1'>Generado el " + fmtFecha(info.hoy || fechaHoyISO()) + " con Mi salón. Reporte interno; complementa la boleta oficial.</p>" +
			"</footer>";
	}

	// ── Render principal ──────────────────────────────────────────────────────

	function renderVacio(datos, info) {
		return renderEncabezado(datos, info) +
			"<div class='rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center' data-estado='vacio'>" +
			"<p class='text-lg font-semibold text-gray-700'>Todavía no hay datos del trimestre " + esc(datos.trimestre) + "</p>" +
			"<p class='mx-auto mt-2 max-w-xl text-sm text-gray-500'>Este reporte se llena solo conforme capturas en " +
			"<span class='font-semibold'>Hoy</span> (productos, tareas y cierre del día), registras la evaluación diagnóstica " +
			"(cuaderno, lectura y matemáticas) y aplicas el examen del trimestre.</p>" +
			"<div class='no-print mt-4 flex flex-wrap justify-center gap-2'>" +
			"<a href='hoy.html' class='inline-flex items-center min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700'>Ir a Hoy</a>" +
			"<a href='evaluacion_diagnostica.html' class='inline-flex items-center min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-100'>Evaluación diagnóstica</a>" +
			"</div></div>";
	}

	/*
		render(datos, info) → HTML del reporte completo.
		datos = salida de ReporteDatos.alumnoTrimestre
		info  = { escuela, ciclo, grupo, docente, hoy (AAAA-MM-DD), baja }
	*/
	function render(datos, info) {
		info = info || {};
		if (!hayDatos(datos)) return renderVacio(datos, info);
		var aviso = (datos.motor && datos.motor.sinProyectos)
			? "<p class='mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900'>No hay proyectos de este trimestre en el grupo: " +
				"no hay productos que calificar. Lo que aparece abajo viene de la evaluación diagnóstica y la asistencia.</p>"
			: "";
		return renderEncabezado(datos, info) + aviso +
			renderResumen(datos) +
			renderDesempeno(datos) +
			renderCuaderno(datos) +
			renderHabilidades(datos) +
			renderPda(datos) +
			renderObservaciones(datos) +
			renderRetro(datos) +
			renderPie(datos, info);
	}

	var api = {
		render: render,
		renderVacio: renderVacio,
		hayDatos: hayDatos,
		calificacionCampo: calificacionCampo,
		pesosAplicados: pesosAplicados,
		tramosBanda: tramosBanda,
		fmtPct: fmtPct,
		fmtCantidad: fmtCantidad,
		fmtFecha: fmtFecha,
		faseDeGrado: faseDeGrado,
	};
	if (typeof window !== "undefined") window.ReporteAlumno = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	// ── Página ────────────────────────────────────────────────────────────────
	document.addEventListener("DOMContentLoaded", async function () {
		if (!window.sb || !window.ReporteDatos) { window.location.href = "index.html"; return; }

		// Estado (todo declarado antes del arranque, que va al final)
		var ctx = null;
		var turno = 0;              // descarta respuestas viejas si el maestro cambia rápido de alumno
		var extraAlumno = null;     // alumno de la URL que no está en la lista (p. ej. dado de baja)
		var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

		var selAlumno = document.getElementById("raAlumno");
		var selTrim = document.getElementById("raTrimestre");
		var btnImprimir = document.getElementById("raImprimir");
		var cont = document.getElementById("reporte");
		var subtitulo = document.getElementById("raSubtitulo");

		function mensaje(tipo, texto) {
			var el = document.getElementById("raMensaje");
			if (!el) return;
			if (!texto) { el.classList.add("hidden"); el.textContent = ""; return; }
			el.className = "no-print rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-blue-50 text-blue-800 border border-blue-200");
			el.textContent = texto;
		}

		function parametros() {
			var p = new URLSearchParams(window.location.search);
			var t = Number(p.get("trimestre"));
			return { alumno: (p.get("alumno") || "").trim(), trimestre: (t === 1 || t === 2 || t === 3) ? t : null };
		}

		function escribirParametros(alumnoId, trimestre) {
			try {
				var q = alumnoId ? "?alumno=" + encodeURIComponent(alumnoId) + "&trimestre=" + trimestre : "?trimestre=" + trimestre;
				window.history.replaceState(null, "", window.location.pathname + q);
			} catch (e) { /* sin historial (vista previa): no pasa nada */ }
		}

		function poblarAlumnos(seleccion) {
			var porGrado = {};
			ctx.alumnos.forEach(function (a) { (porGrado[a.grado] = porGrado[a.grado] || []).push(a); });
			var html = "<option value=''>" + (ctx.alumnos.length ? "Elige un alumno" : "Este grupo no tiene alumnos activos") + "</option>";
			Object.keys(porGrado).sort(function (a, b) { return a - b; }).forEach(function (g) {
				html += "<optgroup label='" + esc(g) + "° grado'>" + porGrado[g].map(function (a) {
					return "<option value='" + esc(a.id) + "'>" + (a.num_lista ? esc(a.num_lista) + ". " : "") + esc(a.nombre_completo || "Sin nombre") + "</option>";
				}).join("") + "</optgroup>";
			});
			if (extraAlumno) {
				html += "<optgroup label='Otros'><option value='" + esc(extraAlumno.id) + "'>" + esc(extraAlumno.nombre_completo || "Alumno") + " (baja)</option></optgroup>";
			}
			selAlumno.innerHTML = html;
			selAlumno.value = seleccion || "";
		}

		/*
			El alumno de la URL puede no estar en la lista del grupo activo:
			  - dado de baja en este grupo  → se muestra igual, marcado
			  - de otro grupo del maestro   → se ofrece cambiar de grupo (no se cambia solo)
			  - no existe o no es suyo       → aviso (RLS devuelve 0 filas)
		*/
		async function resolverAlumno(id) {
			var enLista = ctx.alumnos.filter(function (a) { return a.id === id; })[0];
			if (enLista) return { alumno: enLista };
			if (extraAlumno && extraAlumno.id === id) return { alumno: extraAlumno, baja: true };
			if (!UUID.test(id)) return { noEncontrado: true };
			var res = await window.sb.from("alumnos").select("id, nombre_completo, num_lista, grado, grupo_id, estatus")
				.eq("maestro_id", ctx.maestroId).eq("id", id).maybeSingle();
			if (res.error) throw res.error;
			if (!res.data) return { noEncontrado: true };
			if (res.data.grupo_id === ctx.grupo.id) {
				extraAlumno = res.data;
				return { alumno: res.data, baja: res.data.estatus !== "activo" };
			}
			var otro = (ctx.grupos || []).filter(function (g) { return g.id === res.data.grupo_id; })[0] || null;
			return { otroGrupo: otro, datos: res.data };
		}

		function tarjetaAviso(tituloTexto, cuerpo) {
			return "<div class='rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center'>" +
				"<p class='text-base font-semibold text-gray-700'>" + esc(tituloTexto) + "</p>" + cuerpo + "</div>";
		}

		async function mostrar() {
			var miTurno = ++turno;
			var alumnoId = selAlumno.value;
			var trimestre = Number(selTrim.value) || 1;
			escribirParametros(alumnoId, trimestre);
			btnImprimir.disabled = true;
			mensaje("", "");
			if (!alumnoId) {
				cont.innerHTML = "<p class='text-sm text-gray-400'>Elige un alumno y un trimestre para ver su reporte.</p>";
				document.title = "Reporte del alumno — Jissez";
				return;
			}
			cont.innerHTML = "<p class='text-sm text-gray-400'>Preparando el reporte...</p>";
			try {
				var r = await resolverAlumno(alumnoId);
				if (miTurno !== turno) return;
				if (r.noEncontrado) {
					cont.innerHTML = tarjetaAviso("No se encontró el alumno", "<p class='mt-2 text-sm text-gray-500'>Elige uno de la lista.</p>");
					return;
				}
				if (r.otroGrupo !== undefined) {
					var g = r.otroGrupo;
					var opcion = selAlumno.querySelector("option[data-temporal]");
					if (opcion) opcion.textContent = (r.datos.nombre_completo || "Alumno") + " (otro grupo)";
					cont.innerHTML = tarjetaAviso(
						(r.datos.nombre_completo || "Este alumno") + " es de otro grupo",
						"<p class='mt-2 text-sm text-gray-500'>" + (g ? "Pertenece a «" + esc(g.nombre || "Grupo") + "». " : "") +
						"El reporte se calcula con los proyectos del grupo activo" + (ctx.grupo.nombre ? " («" + esc(ctx.grupo.nombre) + "»)" : "") + ".</p>" +
						(g ? "<button type='button' id='raCambiarGrupo' class='mt-4 inline-flex items-center min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700'>Cambiar a ese grupo</button>" : ""));
					var btn = document.getElementById("raCambiarGrupo");
					if (btn && g) btn.addEventListener("click", function () { window.GrupoActivo.cambiar(g.id); });
					return;
				}
				if (r.baja) poblarAlumnos(r.alumno.id);

				var datos = await window.ReporteDatos.alumnoTrimestre(window.sb, ctx, r.alumno, trimestre);
				if (miTurno !== turno) return;
				cont.innerHTML = render(datos, {
					escuela: ctx.escuela, ciclo: ctx.ciclo, grupo: ctx.grupo.nombre,
					docente: ctx.maestroNombre, hoy: fechaHoyISO(), baja: !!r.baja,
				});
				btnImprimir.disabled = false;
				document.title = "Reporte T" + trimestre + " - " + (r.alumno.nombre_completo || "Alumno") + " — Jissez";
			} catch (e) {
				if (miTurno !== turno) return;
				console.error("reporte-alumno:", e);
				cont.innerHTML = tarjetaAviso("No se pudo preparar el reporte",
					"<p class='mt-2 text-sm text-gray-500'>" + esc((e && e.message) || "Error desconocido") + ". Revisa tu conexión e inténtalo de nuevo.</p>");
				mensaje("error", "No se pudo preparar el reporte. Si el problema sigue, recarga la página.");
			}
		}

		selAlumno.addEventListener("change", mostrar);
		selTrim.addEventListener("change", mostrar);
		btnImprimir.addEventListener("click", function () { window.print(); });

		// ── Arranque ──────────────────────────────────────────────────────────
		try {
			ctx = await window.ReporteDatos.contexto(window.sb);
		} catch (e) {
			console.error("reporte-alumno: contexto", e);
			subtitulo.textContent = "";
			mensaje("error", "No se pudieron cargar tus datos: " + ((e && e.message) || "error desconocido"));
			cont.innerHTML = "";
			return;
		}
		if (!ctx) { window.location.href = "index.html"; return; }
		if (!ctx.grupo) { window.location.href = "onboarding.html"; return; }

		subtitulo.textContent = (ctx.grupo.nombre || "Grupo") + (ctx.ciclo ? " · Ciclo " + ctx.ciclo : "");
		var p = parametros();
		selTrim.value = String(p.trimestre || ctx.grupo.trimestre_actual || 1);
		poblarAlumnos(p.alumno);
		if (p.alumno) {
			// Un alumno fuera de la lista (baja u otro grupo) se resuelve en mostrar()
			if (!selAlumno.value) {
				var tmp = document.createElement("option");
				tmp.value = p.alumno;
				tmp.setAttribute("data-temporal", "1");
				tmp.textContent = "Alumno de la liga";
				selAlumno.appendChild(tmp);
				selAlumno.value = p.alumno;
			}
			await mostrar();
		}
	});
})();
