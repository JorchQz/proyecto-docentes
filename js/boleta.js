/*
	boleta.js — Boleta trimestral imprimible por alumno (Mi salón B.8.1,
	docs/MISION-PARTE-B.md §3.3).

		boleta.html?alumno=<uuid>&trimestre=<1|2|3>
		Sin parámetros: selector de alumno (del grupo activo) y de trimestre.

	No calcula nada por su cuenta: todo sale de js/reporte-datos.js.
	  - Calificación: SOLO la confirmada por el maestro (ReporteDatos.calificacionOficial).
	    Lo no confirmado se imprime "pendiente", nunca un número (Acuerdo 10/09/23,
	    art. 4 XI). La tabla siempre muestra T1, T2 y T3 del ciclo; el trimestre elegido
	    define observaciones, asistencia, cuaderno y habilidades.
	  - Promedios: ReporteDatos.promedio, solo sobre calificaciones confirmadas. El
	    promedio general de un trimestre aparece cuando los cuatro campos están
	    confirmados (un promedio de dos campos se leería como si fuera el del trimestre).
	  - Pisos por fase: los garantiza la BD (trigger boleta_trimestral_piso_fase); aquí
	    solo se rotula la escala que aplica. Nada se convierte de porcentaje a número.
	  - Textos: lo que el maestro dejó en boleta_trimestral; si está vacío, la propuesta
	    de la Capa 1 (ReporteDatos.textoSeccion).
	  - Asistencia: dato de referencia, nunca pondera (art. 7).
	  - Boleta cerrada: grado, fase, escala y banda de lectura del cierre (la foto; si después
	    cambia el grado del alumno, lo entregado no se mueve). Calificación por juicio docente
	    sin evidencias: marcada con * y explicada al pie (ReporteDatos.juicioSinEvidencias).
	  - Matemáticas: solo las habilidades del grado del alumno (el del cierre si está cerrada),
	    con su alcance (CatalogoHabilidades.matematicasDeGrado); las que no aplican no salen.
	  - Mi salón es complemento de la boleta oficial (SIGED): no la sustituye.

	Esta página SOLO LEE: no escribe nada en la base de datos.

	Las funciones de render son puras (reciben datos, devuelven HTML) y se exportan
	para las pruebas en node: pruebas/boleta-imprimible.test.js.
*/

(function () {
	"use strict";

	function RD() { return window.ReporteDatos; }
	function CH() { return window.CatalogoHabilidades; }
	function esc(s) { return RD().esc(s); }

	var TRIMESTRES = [1, 2, 3];
	var GENERAL = "GEN";

	// Semáforo: color y texto (el texto lo hace legible impreso en blanco y negro)
	var COLOR_NIVEL = { logrado: "#059669", en_proceso: "#d97706", requiere_apoyo: "#dc2626" };
	var COLOR_FLUIDEZ = { requiere_apoyo: "#dc2626", cercano: "#d97706", estandar: "#059669", avanzado: "#059669" };

	var TIPOS_TEXTO = [
		{ columna: "fortalezas", clave: "fortalezas", titulo: "Fortalezas" },
		{ columna: "areas_oportunidad", clave: "areas", titulo: "Áreas de oportunidad" },
		{ columna: "sugerencias", clave: "sugerencias", titulo: "Sugerencias" },
	];

	// ── Fase y escala (Acuerdo 10/09/23, art. 9) ──────────────────────────────
	function fase(grado) {
		var g = Number(grado);
		if (!(g >= 1 && g <= 6)) return null;
		return g <= 2 ? 3 : (g <= 4 ? 4 : 5);
	}

	function escala(grado) {
		var f = fase(grado);
		if (!f) return "";
		return "Enteros de " + RD().escalaDeFase(f);
	}

	function formatoPromedio(valor) {
		return valor === null || valor === undefined ? null : Number(valor).toFixed(1);
	}

	function fechaLarga(fecha) {
		var d = fecha instanceof Date ? fecha : new Date();
		try {
			return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
		} catch (e) {
			return d.toISOString().slice(0, 10);
		}
	}

	// ── Calificaciones: campo × T1/T2/T3 + promedio ───────────────────────────

	// Valores confirmados de un campo en los tres trimestres: {1: n|null, 2: ..., 3: ...}
	function confirmadasCampo(boletaCiclo, campo) {
		var salida = {};
		TRIMESTRES.forEach(function (t) {
			var fila = boletaCiclo && boletaCiclo[t] ? boletaCiclo[t][campo] : null;
			salida[t] = RD().calificacionOficial(fila).valor;
		});
		return salida;
	}

	/*
		resumenCalificaciones(boletaCiclo, grado) → {
			porCampo: {LEN: {1: n|null, 2, 3, final: n|null}, ...},
			general:  {1: n|null, 2, 3, final: n|null},
			final:    ReporteDatos.finalCiclo (acreditación incluida)
		}
		General de un trimestre: solo con los cuatro campos confirmados (truncado a un decimal).
		Final de cada campo y promedio final de grado: ReporteDatos.finalCiclo, la misma
		función de todos los documentos; solo con los tres trimestres confirmados.
	*/
	function resumenCalificaciones(boletaCiclo, grado) {
		var campos = RD().CAMPOS;
		var final = RD().finalCiclo(boletaCiclo, grado);
		var porCampo = {};
		campos.forEach(function (c) {
			var v = confirmadasCampo(boletaCiclo, c);
			v.final = final.porCampo[c];
			porCampo[c] = v;
		});
		var general = {};
		TRIMESTRES.forEach(function (t) {
			var valores = campos.map(function (c) { return porCampo[c][t]; });
			var completo = valores.every(function (x) { return x !== null && x !== undefined; });
			general[t] = completo ? RD().promedio(valores) : null;
		});
		general.final = final.promedio;
		return { porCampo: porCampo, general: general, final: final };
	}

	// Marca de calificación por juicio docente, sin evidencias registradas (se explica al pie)
	var MARCA_JUICIO = "<sup class='bol-juicio' style='font-size:0.7em;color:#b45309;margin-left:1px' aria-label='por juicio docente, sin evidencias'>*</sup>";

	function celdaValor(valor, attrs, actual, esPromedio, juicio) {
		var clases = (actual ? "actual " : "");
		if (valor === null || valor === undefined) {
			return "<td class='" + clases + "pendiente' " + attrs + ">pendiente</td>";
		}
		var texto = esPromedio ? formatoPromedio(valor) : String(valor);
		return "<td class='" + clases + "num' " + attrs + ">" + esc(texto) + (juicio ? MARCA_JUICIO : "") + "</td>";
	}

	/*
		¿Qué calificaciones fueron por juicio docente, sin evidencias? {1: {LEN: bool}, ...}
		juicioActual: el del trimestre elegido, ya calculado con el motor de hoy o la foto
		del cierre (alumnoTrimestre); los otros trimestres, con su fila o su foto.
	*/
	function juicioCiclo(boletaCiclo, trimestre, juicioActual) {
		var salida = {};
		TRIMESTRES.forEach(function (t) {
			salida[t] = {};
			RD().CAMPOS.forEach(function (c) {
				salida[t][c] = t === trimestre && juicioActual
					? !!juicioActual[c]
					: RD().juicioSinEvidencias((boletaCiclo || {})[t] || {}, c);
			});
		});
		return salida;
	}

	/*
		La conducta ya no pondera (LGE art. 21, decisión de Jorge del 2026-09-24), pero una
		boleta cerrada antes del cambio conserva en su foto la conducta con peso: en ese
		trimestre la nota dice lo que pasó de verdad (ReporteDatos.pesoConductaCierre).
	*/
	function notaConducta(boletaCiclo) {
		var conPeso = TRIMESTRES.map(function (t) {
			return { t: t, peso: RD().pesoConductaCierre((boletaCiclo || {})[t] || null) };
		}).filter(function (x) { return x.peso > 0; });
		if (!conPeso.length) return "La conducta se informa en las observaciones: no forma parte de la calificación.";
		var cuales = conPeso.map(function (x) { return x.t; });
		var lista = cuales.length === 1 ? "el trimestre " + cuales[0]
			: "los trimestres " + cuales.slice(0, -1).join(", ") + " y " + cuales[cuales.length - 1];
		var pesos = conPeso.map(function (x) { return x.peso; }).filter(function (p, i, l) { return l.indexOf(p) === i; });
		return "En " + lista + ", cerrado" + (cuales.length > 1 ? "s" : "") + " antes de un cambio de criterio, la conducta sí formó parte de la calificación " +
			"(con peso " + pesos.join(" y ") + ", el que tenía entonces) y ese número no se recalcula." +
			(cuales.length < TRIMESTRES.length ? " En los demás trimestres la conducta se informa en las observaciones y no forma parte de la calificación." : "");
	}

	function tablaCalificaciones(boletaCiclo, trimestre, juicioActual, grado) {
		var R = RD();
		var resumen = resumenCalificaciones(boletaCiclo, grado);
		var juicio = juicioCiclo(boletaCiclo, trimestre, juicioActual);
		var hayJuicio = false;
		var cabeza = "<thead><tr><th style='text-align:left'>Campo formativo</th>" +
			TRIMESTRES.map(function (t) {
				return "<th" + (t === trimestre ? " class='actual'" : "") + "><span class='bol-largo'>Trimestre </span>" +
					"<span class='bol-corto'>T</span>" + t + "</th>";
			}).join("") + "<th>Final</th></tr></thead>";

		var cuerpo = R.CAMPOS.map(function (c) {
			var v = resumen.porCampo[c];
			return "<tr><th scope='row' style='font-weight:normal'><span class='bol-campo'>" +
				"<span class='bol-chip' style='background:" + R.COLOR_CAMPO[c] + "'></span>" +
				"<span><span class='bol-codigo bol-codigo-tabla'>" + c + "</span> <span class='bol-nombre-campo'>" + esc(R.NOMBRE_CAMPO[c]) + "</span></span></span></th>" +
				TRIMESTRES.map(function (t) {
					var j = juicio[t][c] && v[t] !== null && v[t] !== undefined;
					if (j) hayJuicio = true;
					return celdaValor(v[t], "data-campo='" + c + "' data-trim='" + t + "'", t === trimestre, false, j);
				}).join("") +
				celdaValor(v.final, "data-campo='" + c + "' data-trim='final'", false, true) +
				"</tr>";
		}).join("");

		var g = resumen.general;
		var f = resumen.final;
		var pie = "<tfoot><tr><th scope='row' style='text-align:left'>Promedio general</th>" +
			TRIMESTRES.map(function (t) {
				return celdaValor(g[t], "data-campo='GENERAL' data-trim='" + t + "'", t === trimestre, true);
			}).join("") +
			celdaValor(g.final, "data-campo='GENERAL' data-trim='final'", false, true) +
			"</tr></tfoot>";

		var etiquetaAcr = R.ETIQUETA_ACREDITACION[f.acreditacion];
		var colorAcr = f.acreditacion === "acredita" ? "#047857" : (f.acreditacion === "no_acredita" ? "#b91c1c" : "#6b7280");
		var acreditacion = "<p class='bol-acreditacion' id='boletaAcreditacion' data-acreditacion='" + f.acreditacion + "'>" +
			"<span><strong>Promedio final de grado:</strong> <span data-promedio-final>" +
			esc(f.promedio === null ? "pendiente" : R.formatoDecimal(f.promedio)) + "</span></span>" +
			"<span><strong>Acreditación:</strong> <span style='font-weight:700;color:" + colorAcr + (f.completo ? "" : ";font-style:italic") + "'>" +
			esc(etiquetaAcr) + "</span>" +
			(f.completo ? "" : " <span style='font-size:11px;color:#6b7280'>(faltan " + f.faltan + " de 12 calificaciones confirmadas)</span>") + "</span>" +
			"<span class='bol-siged' data-nota-siged>" + esc(R.NOTA_FINAL_APOYO) + "</span></p>";

		// En celular la tabla lleva solo el código del campo (para que quepa la columna
		// "Final" sin deslizar): los nombres van en esta leyenda, que no se imprime
		var leyenda = "<p class='bol-leyenda-campos'>" + R.CAMPOS.map(function (c) {
			return "<span><strong>" + c + "</strong> " + esc(R.NOMBRE_CAMPO[c]) + "</span>";
		}).join("") + "</p>";
		return "<div class='bol-tabla-envoltura'><table class='bol-tabla' id='boletaTablaCalificaciones'>" +
			cabeza + "<tbody>" + cuerpo + "</tbody>" + pie + "</table></div>" + leyenda +
			acreditacion +
			"<p class='bol-nota'>«pendiente»: el docente todavía no confirma esa calificación. " +
			"El promedio general de un trimestre aparece cuando están confirmados los cuatro campos formativos. " +
			"La final de cada campo es el promedio de sus tres calificaciones confirmadas y el promedio final de grado, el de las cuatro finales: " +
			"con un decimal, sin redondear, y solo cuando están confirmados los tres trimestres. " +
			(f.grado === 1 ? "En 1° se acredita con haber cursado el grado." : "De 2° a 6° se acredita con un promedio final de grado mínimo de 6.") +
			" " + notaConducta(boletaCiclo) + "</p>" +
			(hayJuicio
				? "<p class='bol-nota' id='boletaNotaJuicio'><span style='color:#b45309;font-weight:600'>*</span> Calificación asignada por juicio docente: " +
					"no hay evidencias registradas de ese campo formativo en el trimestre.</p>"
				: "");
	}

	// Asistencia: SOLO referencia, nunca parte de la calificación (art. 7)
	function bloqueAsistencia(asistencia, trimestre) {
		var a = asistencia || {};
		var texto;
		if (a.total > 0) {
			var pct = a.porcentaje !== null && a.porcentaje !== undefined ? Math.round(a.porcentaje * 100) : null;
			texto = "<strong>Asistencia del trimestre " + trimestre + ":</strong> " + a.presentes + " de " + a.total +
				" días registrados" + (pct !== null ? " (" + pct + " %)" : "") + ". Las faltas justificadas no se cuentan como faltas.";
		} else {
			texto = "<strong>Asistencia del trimestre " + trimestre + ":</strong> sin registros.";
		}
		return "<div class='bol-asistencia bol-bloque' id='boletaAsistencia'>" + texto +
			"<span class='ref'>Dato de referencia: la asistencia no forma parte de la calificación.</span></div>";
	}

	// ── Observaciones y sugerencias del trimestre elegido ─────────────────────

	function textoDe(filaBoleta, tipo, generado, cerrada) {
		var propuesto = window.TextosBoleta.comoParrafo(generado ? (generado[tipo.clave] || []) : []);
		var t = RD().textoSeccion(filaBoleta, tipo.columna, propuesto, cerrada);
		// Lo que ya está guardado y marcado como del maestro, o lo que él escribió
		return { texto: t.texto ? String(t.texto).trim() : "", delMaestro: t.delMaestro };
	}

	function bloqueObservaciones(campo, titulo, color, filaBoleta, generado, cerrada) {
		var partes = TIPOS_TEXTO.map(function (tipo) {
			var t = textoDe(filaBoleta, tipo, generado, cerrada);
			var marca = (t.texto && !t.delMaestro && !cerrada)
				? "<span class='bol-propuesta no-print'>propuesta del sistema</span>" : "";
			return "<div><dt>" + tipo.titulo + marca + "</dt>" +
				(t.texto
					? "<dd>" + esc(t.texto) + "</dd>"
					: "<dd class='vacio' aria-label='Sin texto'>—</dd>") + "</div>";
		}).join("");
		return "<div class='bol-obs bol-bloque' data-obs='" + campo + "' style='border-left-color:" + color + "'>" +
			"<h3>" + (campo !== GENERAL ? "<span class='bol-codigo'>" + campo + "</span>" : "") + esc(titulo) + "</h3>" +
			"<dl class='bol-obs-grid'>" + partes + "</dl></div>";
	}

	function seccionObservaciones(d) {
		var R = RD();
		var boletaT = (d.boletaCiclo && d.boletaCiclo[d.trimestre]) || {};
		var textos = d.textos || {};
		var diag = d.diagnostica;
		// Boleta cerrada: todo como se entregó (ReporteDatos.boletaCerrada)
		var cerrada = R.boletaCerrada(boletaT);
		// null = el maestro no lo ha escrito (propuesta); "" = lo vació a propósito
		var trabajo = R.trabajoDiario(diag, textos.trabajoDiario || "", boletaT[GENERAL], cerrada).texto;

		var html = "<div class='bol-obs bol-bloque' data-obs='trabajo' style='border-left-color:#1e3a8a'>" +
			"<h3>Trabajo diario</h3>" +
			(trabajo ? "<p style='font-size:inherit'>" + esc(trabajo) + "</p>"
				: "<p class='vacio' style='color:#9ca3af' aria-label='Sin texto'>—</p>") +
			"</div>";
		R.CAMPOS.forEach(function (c) {
			html += bloqueObservaciones(c, R.NOMBRE_CAMPO[c], R.COLOR_CAMPO[c], boletaT[c], textos[c], cerrada);
		});
		html += bloqueObservaciones(GENERAL, "Observaciones generales", "#6b7280", boletaT[GENERAL], textos[GENERAL], cerrada);
		return html;
	}

	// ── Cuaderno y habilidades básicas (evaluacion_diagnostica + bandas_ppm) ──

	function semaforo(nivel, sinDato) {
		var etiqueta = CH().ETIQUETA_NIVEL[nivel];
		if (!etiqueta) {
			return "<span class='bol-sem sin-dato'><span class='bol-punto'></span>" + esc(sinDato) + "</span>";
		}
		return "<span class='bol-sem' data-nivel='" + nivel + "'>" +
			"<span class='bol-punto' style='background:" + COLOR_NIVEL[nivel] + ";border-color:" + COLOR_NIVEL[nivel] + "'></span>" +
			esc(etiqueta) + "</span>";
	}

	function semaforoFluidez(nivel) {
		var etiqueta = CH().ETIQUETA_FLUIDEZ[nivel];
		if (!etiqueta) return null;
		return "<span class='bol-sem' data-fluidez='" + nivel + "'>" +
			"<span class='bol-punto' style='background:" + COLOR_FLUIDEZ[nivel] + ";border-color:" + COLOR_FLUIDEZ[nivel] + "'></span>" +
			esc(etiqueta) + "</span>";
	}

	// detalle (opcional): línea chica bajo la etiqueta (el alcance de una habilidad en su grado)
	function renglon(etiqueta, valorHtml, attrs, detalle) {
		return "<div class='bol-renglon' " + (attrs || "") + "><span class='etiqueta'>" + esc(etiqueta) +
			(detalle ? "<span class='detalle' data-alcance>" + esc(detalle) + "</span>" : "") + "</span>" +
			"<span class='valor'>" + valorHtml + "</span></div>";
	}

	function cajaCuaderno(diag) {
		var mapa = CH().aMapa(diag ? diag.cuaderno : null);
		return "<div class='bol-caja bol-bloque' id='boletaCuaderno'><h3>Revisión de cuaderno</h3>" +
			CH().CUADERNO.map(function (c) {
				return renglon(c.etiqueta, semaforo(mapa[c.clave], "No evaluado"), "data-clave='" + c.clave + "'");
			}).join("") + "</div>";
	}

	// "Referencia SEP 2010 para 2°: 60 a 84 ppm" (de la banda del grado). Los rangos de
	// palabras por minuto de 2010 ya no son un estándar vigente: se rotulan como referencia
	function textoBanda(banda, grado) {
		return CH().textoReferenciaPPM(banda, grado);
	}

	function cajaHabilidades(diag, banda, grado) {
		var ch = CH();
		var ppm = diag && diag.lectura_ppm !== null && diag.lectura_ppm !== undefined && diag.lectura_ppm !== "" ? Number(diag.lectura_ppm) : null;
		var nivelFluidez = ch.clasificarPPM(ppm, banda);
		var referencia = textoBanda(banda, grado);

		var velocidad = ppm !== null
			? esc(ppm + " palabras por minuto")
			: "<span class='bol-sem sin-dato'>No evaluada</span>";
		var fluidez;
		if (ppm === null) fluidez = "<span class='bol-sem sin-dato'><span class='bol-punto'></span>No evaluada</span>";
		else if (!nivelFluidez) fluidez = "<span class='bol-sem sin-dato'><span class='bol-punto'></span>Sin banda de referencia</span>";
		else fluidez = semaforoFluidez(nivelFluidez);
		if (referencia) fluidez += "<span class='detalle'>" + esc(referencia) + "</span>";

		// Solo las habilidades de su grado (con la boleta cerrada, el grado del cierre), con
		// el alcance del grado como detalle chico, igual que el estándar de PPM
		var mates = ch.aMapa(diag ? diag.matematicas : null);
		var gradoOk = ch.gradoValido(grado);
		return "<div class='bol-caja bol-bloque' id='boletaHabilidades'><h3>Habilidades básicas</h3>" +
			"<h4>Lectura</h4>" +
			renglon("Velocidad lectora", velocidad, "data-clave='lectura.ppm'") +
			renglon("Fluidez lectora", fluidez, "data-clave='lectura.fluidez'") +
			renglon("Comprensión lectora", semaforo(diag ? diag.lectura_comprension : null, "No evaluada"), "data-clave='lectura.comprension'") +
			"<h4>Matemáticas</h4>" +
			ch.matematicasDeGrado(grado).map(function (h) {
				var alcance = ch.alcanceMatematica(h, grado);
				return renglon(h.etiqueta, semaforo(mates[h.clave], "No evaluada"), "data-clave='" + h.clave + "'",
					alcance ? "Alcance en " + gradoOk + "°: " + alcance : "");
			}).join("") + "</div>";
	}

	// ── Encabezado y firmas ───────────────────────────────────────────────────

	// Boleta cerrada: grado, fase y escala del cierre (d.fase y d.escala vienen de la foto,
	// ReporteDatos.alumnoTrimestre); si no, los del grado de hoy
	function encabezado(d) {
		var a = d.alumno || {};
		var f = d.fase || fase(a.grado);
		var textoEscala = d.escala ? "Enteros de " + d.escala : escala(a.grado);
		function dato(etiqueta, valor, clase) {
			return "<div" + (clase ? " class='" + clase + "'" : "") + "><dt>" + etiqueta + "</dt><dd>" +
				(valor !== null && valor !== undefined && String(valor) !== "" ? esc(valor) : "—") + "</dd></div>";
		}
		return "<header class='bol-encabezado bol-bloque'>" +
			"<div class='bol-titulo'>" +
			"<div><p class='bol-escuela'>" + esc(d.escuela || "Escuela") + "</p>" +
			"<h1>Boleta de evaluación trimestral</h1></div>" +
			"<div class='bol-periodo'><strong>Trimestre " + d.trimestre + "</strong>Ciclo escolar " + esc(d.ciclo || "—") + "</div>" +
			"</div>" +
			"<p class='bol-complemento' id='boletaComplemento'>Complemento de la boleta oficial (SIGED). " +
			"No sustituye el documento oficial de la SEP.</p>" +
			"<dl class='bol-datos'>" +
			dato("Alumno", a.nombre_completo, "ancho") +
			dato("Grado", a.grado ? a.grado + "°" : null) +
			dato("Número de lista", a.num_lista) +
			dato("Grupo", d.grupoNombre) +
			dato("Docente", d.maestroNombre) +
			dato("Fase", f ? "Fase " + f : null) +
			dato("Escala", textoEscala) +
			"</dl>" +
			"</header>";
	}

	function firmas(maestroNombre) {
		return "<div class='bol-firmas bol-bloque' id='boletaFirmas'>" +
			"<div class='bol-firma'><div class='linea'></div><p class='nombre'>" + esc(maestroNombre || "") + "</p><p class='rol'>Docente</p></div>" +
			"<div class='bol-firma'><div class='linea'></div><p class='nombre'></p><p class='rol'>Madre, padre o tutor</p></div>" +
			"</div>";
	}

	/*
		renderBoleta(d) → HTML de la hoja completa.
		d = {
			escuela, ciclo, grupoNombre, maestroNombre, fecha (Date, opcional),
			alumno: {id, nombre_completo, grado, num_lista}, trimestre: 1|2|3,
			boletaCiclo: {1: {LEN: fila, ..., GEN: fila}, 2: {...}, 3: {...}},
			textos: salida de TextosBoleta.generar, diagnostica: fila|null,
			banda: fila de bandas_ppm|null, asistencia: {presentes, total, porcentaje},
			fase, escala (opcionales: los del cierre), juicio: {LEN: bool, ...} (opcional)
		}
		Con la boleta cerrada, alumno.grado, fase, escala y banda son los de la foto del cierre.
	*/
	// Nota solo en pantalla: qué significa la marca de propuesta, o que la boleta ya se cerró
	function notaObservaciones(d) {
		var estilo = "<p class='no-print bol-nota' style='margin:-2px 0 8px'>";
		if (RD().boletaCerrada((d.boletaCiclo || {})[d.trimestre])) {
			return estilo + "La boleta de este trimestre está cerrada: los textos quedan como se entregaron.</p>";
		}
		return estilo + "Lo marcado como <span class='bol-propuesta' style='margin:0'>propuesta del sistema</span> " +
			"sale de lo que capturaste y todavía no lo editas; puedes ajustarlo en Reportes, pestaña Boleta. La marca no se imprime.</p>";
	}

	function renderBoleta(d) {
		var grado = d.alumno ? d.alumno.grado : null;
		return encabezado(d) +
			"<section class='bol-seccion'><h2>1. Calificaciones por campo formativo</h2>" +
			"<div class='bol-bloque'>" + tablaCalificaciones(d.boletaCiclo || {}, d.trimestre, d.juicio, grado) + "</div>" +
			bloqueAsistencia(d.asistencia, d.trimestre) + "</section>" +
			"<section class='bol-seccion'><h2>2. Observaciones y sugerencias del trimestre " + d.trimestre + "</h2>" +
			notaObservaciones(d) +
			seccionObservaciones(d) + "</section>" +
			"<section class='bol-seccion'><h2>3. Cuaderno y habilidades básicas del trimestre " + d.trimestre + "</h2>" +
			"<div class='bol-dos-col'>" + cajaCuaderno(d.diagnostica) + cajaHabilidades(d.diagnostica, d.banda, grado) + "</div>" +
			"</section>" +
			firmas(d.maestroNombre) +
			"<p class='bol-nota' style='margin-top:14px;text-align:right'>Fecha de emisión: " + esc(fechaLarga(d.fecha)) + "</p>";
	}

	var api = {
		fase: fase,
		escala: escala,
		formatoPromedio: formatoPromedio,
		resumenCalificaciones: resumenCalificaciones,
		tablaCalificaciones: tablaCalificaciones,
		bloqueAsistencia: bloqueAsistencia,
		seccionObservaciones: seccionObservaciones,
		cajaCuaderno: cajaCuaderno,
		cajaHabilidades: cajaHabilidades,
		encabezado: encabezado,
		firmas: firmas,
		renderBoleta: renderBoleta,
	};
	if (typeof window !== "undefined") window.BoletaImprimible = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
	if (typeof document === "undefined") return;

	// ══════════════════════════════════════════════════════════════════════════
	// Página
	// ══════════════════════════════════════════════════════════════════════════
	document.addEventListener("DOMContentLoaded", function () {
		var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

		// ── Estado ──
		var ctx = null;
		var turno = 0; // descarta respuestas viejas si se piden dos boletas seguidas

		var el = {
			subtitulo: document.getElementById("boletaSubtitulo"),
			alumno: document.getElementById("boletaAlumno"),
			trimestre: document.getElementById("boletaTrimestre"),
			ver: document.getElementById("boletaVer"),
			imprimir: document.getElementById("boletaImprimir"),
			mensaje: document.getElementById("boletaMensaje"),
			hoja: document.getElementById("boletaHoja"),
		};

		function mensaje(tipo, html) {
			if (!html) { el.mensaje.className = "no-print hidden rounded-xl px-4 py-3 text-sm"; el.mensaje.innerHTML = ""; return; }
			el.mensaje.className = "no-print rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200"
				                  : "bg-amber-50 text-amber-800 border border-amber-200");
			el.mensaje.innerHTML = html;
		}

		function hojaVacia(texto) {
			el.hoja.innerHTML = "<p class='text-sm text-gray-500 py-10 text-center'>" + esc(texto) + "</p>";
			el.imprimir.disabled = true;
		}

		function leerParametros() {
			var p = new URLSearchParams(window.location.search);
			return { alumno: (p.get("alumno") || "").trim(), trimestre: (p.get("trimestre") || "").trim() };
		}

		function escribirParametros(alumnoId, trimestre) {
			try {
				var url = new URL(window.location.href);
				url.searchParams.set("alumno", alumnoId);
				url.searchParams.set("trimestre", String(trimestre));
				window.history.replaceState(null, "", url.pathname + url.search);
			} catch (e) {}
		}

		function poblarSelector(seleccionado) {
			if (!ctx.alumnos.length) {
				el.alumno.innerHTML = "<option value=''>El grupo no tiene alumnos activos</option>";
				return;
			}
			var porGrado = {};
			ctx.alumnos.forEach(function (a) { (porGrado[a.grado] = porGrado[a.grado] || []).push(a); });
			var grados = Object.keys(porGrado).sort(function (x, y) { return x - y; });
			var opcion = function (a) {
				return "<option value='" + esc(a.id) + "'" + (a.id === seleccionado ? " selected" : "") + ">" +
					esc((a.num_lista ? a.num_lista + ". " : "") + (a.nombre_completo || "Sin nombre") + " (" + a.grado + "°)") + "</option>";
			};
			el.alumno.innerHTML = "<option value=''>Elige un alumno</option>" + (grados.length > 1
				? grados.map(function (g) { return "<optgroup label='" + g + "° grado'>" + porGrado[g].map(opcion).join("") + "</optgroup>"; }).join("")
				: ctx.alumnos.map(opcion).join(""));
		}

		// El alumno del enlace no está en el grupo activo: decir por qué y ofrecer salida
		async function avisoAlumnoAjeno(alumnoId) {
			var fila = null;
			try {
				var res = await window.sb.from("alumnos").select("id, nombre_completo, grupo_id, estatus")
					.eq("maestro_id", ctx.maestroId).eq("id", alumnoId).maybeSingle();
				if (res.error) throw res.error;
				fila = res.data || null;
			} catch (e) {
				// No es "no existe": no se pudo leer
				mensaje("error", "No se pudo cargar a este alumno. Recarga la página para intentarlo de nuevo.");
				return;
			}

			if (!fila) {
				mensaje("error", "No se encontró a este alumno. Puede que se haya borrado o que el enlace sea de otra cuenta. Elige un alumno de la lista.");
				return;
			}
			var suGrupo = null;
			(ctx.grupos || []).forEach(function (g) { if (g.id === fila.grupo_id) suGrupo = g; });
			if (suGrupo && suGrupo.id !== ctx.grupo.id) {
				mensaje("aviso", esc(fila.nombre_completo) + " es del grupo «" + esc(suGrupo.nombre) + "», y ahora estás trabajando con «" +
					esc(ctx.grupo.nombre) + "». " +
					"<button type='button' id='boletaCambiarGrupo' class='ml-1 min-h-[44px] px-3 rounded-lg border border-amber-300 bg-white font-semibold text-amber-800 hover:bg-amber-100'>" +
					"Cambiar a «" + esc(suGrupo.nombre) + "»</button>");
				var btn = document.getElementById("boletaCambiarGrupo");
				if (btn) btn.addEventListener("click", function () { window.GrupoActivo.cambiar(suGrupo.id); });
				return;
			}
			mensaje("error", esc(fila.nombre_completo) + " no está activo en el grupo «" + esc(ctx.grupo.nombre) + "». Elige un alumno de la lista.");
		}

		async function mostrar(alumnoId, trimestre) {
			var mio = ++turno;
			mensaje(null);
			var alumno = null;
			ctx.alumnos.forEach(function (a) { if (a.id === alumnoId) alumno = a; });
			if (!alumno) {
				hojaVacia("Elige un alumno y un trimestre para ver su boleta.");
				document.title = "Boleta trimestral — Jissez";
				await avisoAlumnoAjeno(alumnoId);
				return;
			}

			el.hoja.innerHTML = "<p class='text-sm text-gray-400 py-10 text-center'>Armando la boleta de " + esc(alumno.nombre_completo) + "...</p>";
			el.imprimir.disabled = true;
			el.ver.disabled = true;
			try {
				var datos = await RD().alumnoTrimestre(window.sb, ctx, alumno, trimestre);
				if (mio !== turno) return;
				el.hoja.innerHTML = renderBoleta({
					escuela: ctx.escuela, ciclo: ctx.ciclo, grupoNombre: ctx.grupo.nombre,
					maestroNombre: ctx.maestroNombre, fecha: new Date(),
					// Con la boleta cerrada, el alumno con el grado del cierre
					alumno: datos.alumno || alumno, trimestre: trimestre,
					fase: datos.fase, escala: datos.escala, juicio: datos.juicio,
					boletaCiclo: datos.boletaCiclo, textos: datos.textos,
					diagnostica: datos.diagnostica, banda: datos.banda,
					asistencia: datos.motor ? datos.motor.asistencia : null,
				});
				el.imprimir.disabled = false;
				// El título es el nombre sugerido del PDF al "Guardar como PDF"
				document.title = "Boleta T" + trimestre + " — " + (alumno.nombre_completo || "Alumno");
			} catch (e) {
				if (mio !== turno) return;
				console.error("boleta: no se pudo armar", e);
				hojaVacia("No se pudo armar la boleta.");
				mensaje("error", "No se pudo armar la boleta: " + esc((e && e.message) || "error desconocido") + ". Revisa tu conexión e inténtalo de nuevo.");
			} finally {
				if (mio === turno) el.ver.disabled = false;
			}
		}

		function verSeleccion() {
			var alumnoId = el.alumno.value;
			var trimestre = parseInt(el.trimestre.value, 10);
			if (!alumnoId) {
				mensaje("aviso", "Elige un alumno de la lista.");
				return;
			}
			escribirParametros(alumnoId, trimestre);
			mostrar(alumnoId, trimestre);
		}

		async function arrancar() {
			try {
				ctx = await RD().contexto(window.sb);
				if (!ctx) { window.location.href = "index.html"; return; }
				if (!ctx.grupo) { window.location.href = "onboarding.html"; return; }

				el.subtitulo.textContent = ctx.grupo.nombre + " · " + ctx.alumnos.length + " alumno" + (ctx.alumnos.length === 1 ? "" : "s") +
					(ctx.ciclo ? " · Ciclo " + ctx.ciclo : "");

				var p = leerParametros();
				var trimParam = parseInt(p.trimestre, 10);
				var trimValido = trimParam === 1 || trimParam === 2 || trimParam === 3;
				var trimActual = [1, 2, 3].indexOf(Number(ctx.grupo.trimestre_actual)) !== -1 ? Number(ctx.grupo.trimestre_actual) : 1;
				var trimestre = trimValido ? trimParam : trimActual;
				el.trimestre.value = String(trimestre);
				poblarSelector(p.alumno);

				if (!p.alumno) {
					hojaVacia(ctx.alumnos.length ? "Elige un alumno y un trimestre para ver su boleta." : "Este grupo todavía no tiene alumnos activos.");
					return;
				}
				if (!UUID.test(p.alumno)) {
					hojaVacia("Elige un alumno y un trimestre para ver su boleta.");
					mensaje("error", "El enlace no es válido: no se reconoce al alumno. Elige uno de la lista.");
					return;
				}
				if (p.trimestre && !trimValido) {
					hojaVacia("Elige un alumno y un trimestre para ver su boleta.");
					mensaje("error", "El trimestre del enlace no es válido (debe ser 1, 2 o 3). Elige uno de la lista.");
					return;
				}
				await mostrar(p.alumno, trimestre);
			} catch (e) {
				console.error("boleta: arranque", e);
				hojaVacia("No se pudo cargar la información del grupo.");
				mensaje("error", "No se pudo cargar la información del grupo: " + esc((e && e.message) || "error desconocido") + ".");
			}
		}

		el.ver.addEventListener("click", verSeleccion);
		el.imprimir.addEventListener("click", function () { window.print(); });

		// Arranque: al final, con el estado y los listeners ya listos
		arrancar();
	});
})();
