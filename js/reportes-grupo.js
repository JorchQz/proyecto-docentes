/*
	reportes-grupo.js — Vista Recrea y Concentrado Director (pestañas de Reportes).

	Las dos leen la calificación OFICIAL: la confirmada por el maestro en boleta_trimestral
	(Acuerdo 10/09/23, art. 4 XI). Lo no confirmado se muestra "pendiente", nunca como número;
	la propuesta del motor aparece solo rotulada como propuesta, para que el maestro sepa qué
	le falta confirmar. Los datos llegan de js/reporte-datos.js (grupoTrimestre); aquí solo
	se ordenan y se pintan.
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var NOMBRE_CAMPO = {
		LEN: "Lenguajes",
		SAB: "Saberes y Pensamiento Científico",
		ETI: "Ética, Naturaleza y Sociedades",
		DHL: "De lo Humano y lo Comunitario",
	};
	var CORTO_CAMPO = { LEN: "Lenguajes", SAB: "Saberes", ETI: "Ética", DHL: "Humano" };
	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	// Con un decimal, truncado y no redondeado, igual que ReporteDatos.promedio (decisión de
	// Jorge del 2026-09-24): se cuenta en décimas enteras
	function promedio(valores) {
		var nums = valores.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
		if (!nums.length) return null;
		var suma = nums.reduce(function (a, v) { return a + Math.round(Number(v) * 10); }, 0);
		return Math.floor(suma / nums.length + 1e-9) / 10;
	}

	// Evaluación final del ciclo (ReporteDatos.finalCiclo, la misma de todos los documentos)
	function finalDe(boletaCiclo, grado) {
		var RD = typeof window !== "undefined" ? window.ReporteDatos : null;
		return RD && RD.finalCiclo ? RD.finalCiclo(boletaCiclo || {}, grado) : null;
	}

	function oficial(fila) {
		if (!fila || !fila.calificacion_confirmada || fila.calificacion === null || fila.calificacion === undefined) return null;
		return Number(fila.calificacion);
	}

	function fmt1(v) { return (Math.floor(v * 10 + 1e-9) / 10).toFixed(1); }

	/*
		Una fila por alumno activo:
		{ alumno, campos: {LEN: {oficial, propuesta}}, confirmadas, completa, promedio, final }
		promedio solo cuando los 4 campos están confirmados.
		final: la evaluación final del ciclo (ReporteDatos.finalCiclo) o null sin esa capa.
	*/
	function filas(alumnos, datos, trimestre) {
		var porAlumno = (datos.motor && datos.motor.porAlumno) || {};
		return alumnos.map(function (al) {
			var boleta = ((datos.boletas || {})[al.id] || {})[trimestre] || {};
			var motor = porAlumno[al.id] ? porAlumno[al.id].porCampo || {} : {};
			var campos = {};
			var confirmadas = 0;
			CAMPOS.forEach(function (c) {
				var of = oficial(boleta[c]);
				if (of !== null) confirmadas++;
				var prop = motor[c] && motor[c].calificacionPropuesta !== undefined ? motor[c].calificacionPropuesta : null;
				campos[c] = { oficial: of, propuesta: prop };
			});
			var completa = confirmadas === CAMPOS.length;
			return {
				alumno: al,
				campos: campos,
				confirmadas: confirmadas,
				completa: completa,
				promedio: completa ? promedio(CAMPOS.map(function (c) { return campos[c].oficial; })) : null,
				final: finalDe((datos.boletas || {})[al.id], al.grado),
			};
		}).sort(function (a, b) {
			return (a.alumno.grado || 0) - (b.alumno.grado || 0) || (a.alumno.num_lista || 0) - (b.alumno.num_lista || 0);
		});
	}

	function colorCalif(v) {
		if (v === null || v === undefined) return "text-gray-400";
		if (v >= 9) return "text-green-700";
		if (v >= 7) return "text-amber-700";
		return "text-red-700";
	}

	function celda(c) {
		if (c.oficial !== null) {
			return "<span class='text-base font-bold " + colorCalif(c.oficial) + "'>" + c.oficial + "</span>";
		}
		return "<span class='block text-xs font-semibold text-gray-500'>pendiente</span>" +
			(c.propuesta !== null ? "<span class='block text-[11px] text-gray-400'>propuesta " + c.propuesta + "</span>" : "");
	}

	function avisoConfirmacion(lista) {
		var completas = lista.filter(function (f) { return f.completa; }).length;
		var todas = completas === lista.length;
		return "<div class='rounded-xl border " + (todas ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-900") + " px-4 py-3 text-sm'>" +
			"<p class='font-semibold'>" + completas + " de " + lista.length + " alumnos con sus 4 calificaciones confirmadas.</p>" +
			(todas ? "" : "<p class='mt-1'>Lo que dice «pendiente» todavía no está confirmado: confírmalo en la pestaña Boleta. Solo las calificaciones confirmadas son las que van a la boleta oficial (SIGED).</p>") +
			"</div>";
	}

	function htmlVistaRecrea(lista, trimestre) {
		if (!lista.length) return "<p class='text-gray-400'>Sin alumnos activos en el grupo.</p>";
		var h = avisoConfirmacion(lista) +
			"<div class='overflow-x-auto mt-4'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-3 py-3 text-left'>No.</th><th class='px-3 py-3 text-left'>Alumno</th><th class='px-3 py-3 text-center'>Grado</th>";
		CAMPOS.forEach(function (c) {
			h += "<th class='px-3 py-3 text-center whitespace-nowrap' title='" + esc(NOMBRE_CAMPO[c]) + "'>" +
				"<span class='inline-block w-2 h-2 rounded-full mr-1 align-middle' style='background:" + COLOR_CAMPO[c] + "'></span>" + CORTO_CAMPO[c] + "</th>";
		});
		h += "<th class='px-3 py-3 text-center'>Promedio</th></tr></thead><tbody class='divide-y divide-gray-100'>";
		lista.forEach(function (f) {
			h += "<tr class='hover:bg-gray-50'>" +
				"<td class='px-3 py-3 text-gray-500'>" + esc(f.alumno.num_lista || "") + "</td>" +
				"<td class='px-3 py-3 font-medium text-gray-800 whitespace-nowrap'>" + esc(f.alumno.nombre_completo || "Sin nombre") + "</td>" +
				"<td class='px-3 py-3 text-center'>" + (f.alumno.grado ? f.alumno.grado + "°" : "—") + "</td>";
			CAMPOS.forEach(function (c) { h += "<td class='px-3 py-2 text-center'>" + celda(f.campos[c]) + "</td>"; });
			h += "<td class='px-3 py-3 text-center'>" + (f.promedio !== null
				? "<span class='font-bold " + colorCalif(f.promedio) + "'>" + fmt1(f.promedio) + "</span>"
				: "<span class='text-xs text-gray-400'>pendiente</span>") + "</td></tr>";
		});
		h += "</tbody></table></div>" +
			"<p class='text-xs text-gray-400 mt-3'>Trimestre " + esc(trimestre) + ". El promedio aparece cuando los 4 campos están confirmados. La asistencia no forma parte de la calificación.</p>";
		return h;
	}

	function celdaCsv(v) {
		var s = String(v === null || v === undefined ? "" : v);
		return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	function csvVistaRecrea(lista) {
		var cabecera = ["No.", "Alumno", "Grado"].concat(CAMPOS.map(function (c) { return NOMBRE_CAMPO[c]; })).concat(["Promedio"]);
		var lineas = [cabecera.map(celdaCsv).join(",")];
		lista.forEach(function (f) {
			var fila = [f.alumno.num_lista || "", f.alumno.nombre_completo || "", f.alumno.grado || ""]
				.concat(CAMPOS.map(function (c) { return f.campos[c].oficial !== null ? f.campos[c].oficial : "pendiente"; }))
				.concat([f.promedio !== null ? fmt1(f.promedio) : "pendiente"]);
			lineas.push(fila.map(celdaCsv).join(","));
		});
		return "﻿" + lineas.join("\r\n");
	}

	/*
		Evaluación final del ciclo del grupo (no depende del trimestre elegido): por alumno, la
		final de cada campo, el promedio final de grado y la acreditación (Acuerdo 10/09/23,
		arts. 7 y 9). "pendiente" mientras falte confirmar alguno de los 12 números.
	*/
	var ETIQUETA_ACR = { acredita: "Acredita", no_acredita: "No acredita", pendiente: "pendiente" };
	function celdaFinal(v) {
		return v === null || v === undefined
			? "<span class='text-xs italic text-gray-400'>pendiente</span>"
			: "<span class='font-bold " + colorCalif(v) + "'>" + fmt1(v) + "</span>";
	}
	function htmlFinalGrupo(lista) {
		var conFinal = lista.filter(function (f) { return f.final; });
		if (!conFinal.length) return "";
		var completos = conFinal.filter(function (f) { return f.final.completo; }).length;
		var filasHtml = conFinal.map(function (f) {
			var fin = f.final;
			var color = fin.acreditacion === "acredita" ? "text-green-700" : (fin.acreditacion === "no_acredita" ? "text-red-700" : "text-gray-400 italic");
			return "<tr data-final-alumno='" + esc(f.alumno.id) + "'>" +
				"<td class='px-3 py-2 text-gray-800 whitespace-nowrap'>" + esc(f.alumno.nombre_completo || "Sin nombre") + "</td>" +
				"<td class='px-3 py-2 text-center'>" + (fin.grado ? fin.grado + "°" : "—") + "</td>" +
				CAMPOS.map(function (c) { return "<td class='px-3 py-2 text-center' data-final-campo='" + c + "'>" + celdaFinal(fin.porCampo[c]) + "</td>"; }).join("") +
				"<td class='px-3 py-2 text-center' data-final-promedio>" + celdaFinal(fin.promedio) + "</td>" +
				"<td class='px-3 py-2 text-center text-sm font-semibold " + color + "' data-acreditacion='" + fin.acreditacion + "'>" + ETIQUETA_ACR[fin.acreditacion] + "</td></tr>";
		}).join("");
		return "<div data-final-grupo><h3 class='font-bold text-gray-800 text-sm mb-2'>Evaluación final del ciclo</h3>" +
			"<p class='text-xs text-gray-500 mb-2'>" + completos + " de " + conFinal.length +
			" alumnos con los tres trimestres de los cuatro campos confirmados. No depende del trimestre elegido.</p>" +
			"<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'><th class='px-3 py-2 text-left'>Alumno</th><th class='px-3 py-2 text-center'>Grado</th>" +
			CAMPOS.map(function (c) { return "<th class='px-3 py-2 text-center whitespace-nowrap'>" + CORTO_CAMPO[c] + " final</th>"; }).join("") +
			"<th class='px-3 py-2 text-center whitespace-nowrap'>Promedio final</th><th class='px-3 py-2 text-center'>Acreditación</th></tr></thead>" +
			"<tbody class='divide-y divide-gray-100'>" + filasHtml + "</tbody></table></div>" +
			"<p class='text-xs text-gray-400 mt-1'>Final de cada campo: promedio de sus tres calificaciones confirmadas; promedio final: el de las cuatro finales; " +
			"con un decimal y sin redondear. 1° se acredita con haber cursado el grado; 2° a 6°, con promedio final mínimo de 6.</p>" +
			"<p class='text-xs font-medium text-gray-600 mt-1' data-nota-siged>" + esc(notaFinalApoyo()) + "</p></div>";
	}
	// Misma nota en todos los documentos (ReporteDatos.NOTA_FINAL_APOYO)
	function notaFinalApoyo() {
		var RD = typeof window !== "undefined" ? window.ReporteDatos : null;
		return (RD && RD.NOTA_FINAL_APOYO) || "Cálculo de apoyo: el promedio oficial lo calcula SIGED. Mi salón lo trunca a un decimal.";
	}

	// Concentrado para el director: niveles por promedio de las 4 calificaciones confirmadas
	function htmlConcentrado(lista, trimestre) {
		if (!lista.length) return "<p class='text-gray-400'>Sin alumnos activos en el grupo.</p>";
		var completos = lista.filter(function (f) { return f.completa; });
		var pendientes = lista.filter(function (f) { return !f.completa; });
		var alto = completos.filter(function (f) { return f.promedio >= 9; });
		var medio = completos.filter(function (f) { return f.promedio >= 7 && f.promedio < 9; });
		var bajo = completos.filter(function (f) { return f.promedio < 7; });
		var ordenar = function (a, b) { return b.promedio - a.promedio; };
		[alto, medio, bajo].forEach(function (l) { l.sort(ordenar); });

		function detalleCampos(f) {
			return CAMPOS.map(function (c) {
				var v = f.campos[c].oficial;
				return "<span class='whitespace-nowrap'>" + CORTO_CAMPO[c] + " <b class='" + colorCalif(v) + "'>" + (v !== null ? v : "–") + "</b></span>";
			}).join(" · ");
		}

		function bloque(titulo, estilo, l) {
			if (!l.length) return "";
			return "<div class='rounded-xl border " + estilo.borde + " overflow-hidden'>" +
				"<div class='" + estilo.cabecera + " px-4 py-3 flex justify-between items-center'>" +
				"<span class='font-bold text-sm'>" + titulo + "</span>" +
				"<span class='text-sm font-semibold'>" + l.length + " alumno" + (l.length !== 1 ? "s" : "") + "</span></div>" +
				"<ul class='px-4 py-1'>" + l.map(function (f) {
					var noAcredita = Number(f.alumno.grado) >= 3 && CAMPOS.some(function (c) { return f.campos[c].oficial === 5; });
					return "<li class='py-2 border-b border-gray-100 last:border-0'>" +
						"<div class='flex justify-between items-center gap-3'>" +
						"<span class='text-sm text-gray-800'>" + esc(f.alumno.nombre_completo) + " <span class='text-xs text-gray-400'>" + (f.alumno.grado || "") + "°</span>" +
						(noAcredita ? " <span class='ml-1 text-[11px] font-semibold text-red-700 border border-red-200 rounded px-1'>con campo no acreditado</span>" : "") + "</span>" +
						"<span class='text-sm font-bold " + colorCalif(f.promedio) + "'>" + fmt1(f.promedio) + "</span></div>" +
						"<div class='text-xs text-gray-500 mt-0.5'>" + detalleCampos(f) + "</div></li>";
				}).join("") + "</ul></div>";
		}

		// Promedio por grado y campo (solo confirmadas)
		var grados = [];
		lista.forEach(function (f) { if (grados.indexOf(f.alumno.grado) === -1) grados.push(f.alumno.grado); });
		grados.sort();
		var tabla = "<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'><th class='px-3 py-2 text-left'>Grado</th>" +
			CAMPOS.map(function (c) { return "<th class='px-3 py-2 text-center'>" + CORTO_CAMPO[c] + "</th>"; }).join("") +
			"<th class='px-3 py-2 text-center'>Con las 4 confirmadas</th></tr></thead><tbody class='divide-y divide-gray-100'>" +
			grados.map(function (g) {
				var delGrado = lista.filter(function (f) { return f.alumno.grado === g; });
				return "<tr><td class='px-3 py-2 font-medium'>" + g + "°</td>" +
					CAMPOS.map(function (c) {
						var p = promedio(delGrado.map(function (f) { return f.campos[c].oficial; }));
						return "<td class='px-3 py-2 text-center'>" + (p !== null ? "<b class='" + colorCalif(p) + "'>" + fmt1(p) + "</b>" : "<span class='text-xs text-gray-400'>pendiente</span>") + "</td>";
					}).join("") +
					"<td class='px-3 py-2 text-center text-gray-600'>" + delGrado.filter(function (f) { return f.completa; }).length + " de " + delGrado.length + "</td></tr>";
			}).join("") + "</tbody></table></div>" +
			"<p class='text-xs text-gray-400 mt-1'>Promedio de las calificaciones confirmadas de cada grado.</p>";

		var listaPendientes = pendientes.length
			? "<div class='rounded-xl border border-gray-200 overflow-hidden'>" +
				"<div class='bg-gray-50 text-gray-700 px-4 py-3 flex justify-between items-center'>" +
				"<span class='font-bold text-sm'>Pendientes de confirmar</span>" +
				"<span class='text-sm font-semibold'>" + pendientes.length + " alumno" + (pendientes.length !== 1 ? "s" : "") + "</span></div>" +
				"<ul class='px-4 py-1'>" + pendientes.map(function (f) {
					return "<li class='flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0'>" +
						"<span class='text-sm text-gray-800'>" + esc(f.alumno.nombre_completo) + " <span class='text-xs text-gray-400'>" + (f.alumno.grado || "") + "°</span></span>" +
						"<span class='text-xs text-gray-500'>" + f.confirmadas + " de 4 confirmadas</span></li>";
				}).join("") + "</ul></div>"
			: "";

		return "<div class='flex flex-col gap-4'>" +
			avisoConfirmacion(lista) +
			htmlFinalGrupo(lista) +
			bloque("Alto (promedio de 9 a 10)", { borde: "border-green-200", cabecera: "bg-green-50 text-green-800" }, alto) +
			bloque("Medio (promedio de 7 a 8.9)", { borde: "border-amber-200", cabecera: "bg-amber-50 text-amber-800" }, medio) +
			bloque("Bajo (promedio menor a 7)", { borde: "border-red-200", cabecera: "bg-red-50 text-red-800" }, bajo) +
			listaPendientes +
			"<div><h3 class='font-bold text-gray-800 text-sm mb-2'>Promedio por grado y campo formativo</h3>" + tabla + "</div>" +
			"<p class='text-xs text-gray-400'>Trimestre " + esc(trimestre) + ". Los niveles usan el promedio de los 4 campos confirmados. En 3° a 6°, un 5 en un campo significa que ese campo no se acreditó.</p>" +
			"</div>";
	}

	window.ReportesGrupo = {
		filas: filas,
		htmlVistaRecrea: htmlVistaRecrea,
		csvVistaRecrea: csvVistaRecrea,
		htmlConcentrado: htmlConcentrado,
		htmlFinalGrupo: htmlFinalGrupo,
	};
})();
