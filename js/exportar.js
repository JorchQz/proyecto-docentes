/*
	exportar.js — Exportación del concentrado por alumno (B.8.5 / MISION §3.6).

	Una fila por alumno con las columnas de la hoja BD_Alumnos de Fanny (con DHL en
	lugar de HUM), en CSV (UTF-8 con BOM, para que Excel respete los acentos) y en
	XLSX (SheetJS, que se descarga SOLO al pulsar el botón de Excel).

	No calcula nada por su cuenta: todo sale de js/reporte-datos.js.
	  - Rubros por campo: el OBTENIDO del motor único (rubros[x].obtenido, 1 decimal).
	    En multigrado el máximo cambia por alumno (productos de su grado, justificados
	    fuera), por eso no hay una fila de máximos: en el XLSX va la hoja "Máximos"
	    con el máximo de cada alumno en la misma celda.
	  - "Asist." por campo: días asistidos del trimestre (como en su hoja). Es
	    referencia: la asistencia NO pondera (Acuerdo 10/09/23, art. 7).
	  - Calificación por campo: solo la CONFIRMADA por el maestro
	    (ReporteDatos.calificacionOficial); lo demás es "pendiente", nunca un número.
	  - "Cond." es referencia: la conducta no pondera (LGE art. 21). La columna no se mueve y
	    su encabezado es el de la hoja de Fanny ("LEN: Cond."), porque ella copia por
	    encabezado; la hoja Léeme explica que es referencia.
	  - Evaluación final del ciclo, al final de la fila (ReporteDatos.finalCiclo): final por
	    campo, promedio final de grado y acreditación; "pendiente" mientras falte algo. Las
	    finales y el promedio siempre con un decimal ("10.0"): en el CSV como texto del
	    número y en el XLSX como número con formato 0.0.
	  - Textos: lo guardado en boleta_trimestral o, si no hay, la propuesta de la
	    Capa 1 (TextosBoleta.generar con los mismos insumos que alumnoTrimestre).
	  - Matemáticas: siempre las 8 columnas de la hoja; la habilidad que no corresponde
	    al grado del alumno (CatalogoHabilidades.aplicaMatematica) dice "No aplica".

	La parte pura (columnas, filas, CSV, nombre de archivo, hoja Léeme, libro XLSX)
	se exporta también a node para pruebas/exportar.test.js.
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var GENERAL = "GEN";

	// Rubros de la hoja, en su orden. "asistencia" no es un rubro del motor: es la
	// asistencia del trimestre repetida en cada campo, solo como dato.
	var RUBROS_HOJA = [
		{ clave: "tareas", titulo: "Tareas" },
		{ clave: "trabajos", titulo: "Trabajos" },
		{ clave: "asistencia", titulo: "Asist." },
		{ clave: "participacion", titulo: "Part." },
		// La conducta no pondera (LGE art. 21): la columna se queda en su lugar, con el
		// encabezado exacto de la hoja de Fanny (copia por encabezado); la hoja Léeme lo explica
		{ clave: "conducta", titulo: "Cond." },
		{ clave: "examen", titulo: "Examen" },
	];

	// Claves de js/catalogo-habilidades.js con el encabezado exacto de su hoja
	var CUADERNO_COLS = [
		{ clave: "cuaderno.orden_limpieza", titulo: "Cuaderno: Orden/limpieza" },
		{ clave: "cuaderno.fecha_completa", titulo: "Cuaderno: Fecha" },
		{ clave: "cuaderno.titulo_actividad", titulo: "Cuaderno: Título" },
		{ clave: "cuaderno.letra_legible", titulo: "Cuaderno: Letra" },
		{ clave: "cuaderno.mayusculas_minusculas", titulo: "Cuaderno: Mayús/Minús" },
		{ clave: "cuaderno.signos_puntuacion", titulo: "Cuaderno: Signos" },
		{ clave: "cuaderno.acentuacion", titulo: "Cuaderno: Acentuación" },
		{ clave: "cuaderno.buen_estado", titulo: "Cuaderno: Buen estado" },
		{ clave: "cuaderno.orden_proyecto", titulo: "Cuaderno: Orden proyecto" },
		{ clave: "cuaderno.respeta_margen", titulo: "Cuaderno: Margen" },
	];
	var MATES_COLS = [
		{ clave: "mates.suma", titulo: "Mates: Suma" },
		{ clave: "mates.resta", titulo: "Mates: Resta" },
		{ clave: "mates.multiplicacion", titulo: "Mates: Multiplicación" },
		{ clave: "mates.division", titulo: "Mates: División" },
		{ clave: "mates.fracciones", titulo: "Mates: Fracciones" },
		{ clave: "mates.tablas", titulo: "Mates: Tablas" },
		{ clave: "mates.lectura_escritura_cantidades", titulo: "Mates: Lectura y Escritura Cant" },
		{ clave: "mates.problemas", titulo: "Problemas matemáticos" },
	];

	var COL_ASISTENCIA_REF = "Asistencia (referencia, no pondera)";
	// Al final, para no mover las columnas de la hoja de Fanny
	var COL_BOLETA = "Boleta del trimestre";
	var COL_JUICIO = "Juicio docente sin evidencias";
	// Evaluación final del ciclo, también al final (después de boleta y juicio)
	var COL_PROMEDIO_FINAL = "Promedio final de grado";
	var COL_ACREDITACION = "Acreditación";
	function colFinal(campo) { return campo + ": Final"; }
	var BOLETA_CERRADA = "cerrada";
	var BOLETA_ABIERTA = "abierta";
	var PENDIENTE = "pendiente";
	var ETIQUETA_ACREDITACION = { acredita: "Acredita", no_acredita: "No acredita", pendiente: PENDIENTE };
	var NO_APLICA = "No aplica"; // habilidad de matemáticas que no corresponde al grado del alumno
	var SEPARADOR_TEXTOS = " | ";

	var HOJA_PRINCIPAL = "Concentrado";
	var HOJA_MAXIMOS = "Máximos";
	var HOJA_LEEME = "Léeme";

	function encabezados() {
		var h = ["Alumno", "Grado"];
		CAMPOS.forEach(function (c) {
			RUBROS_HOJA.forEach(function (r) { h.push(c + ": " + r.titulo); });
		});
		CUADERNO_COLS.forEach(function (x) { h.push(x.titulo); });
		h.push("Lectura: PPM", "Lectura: Comprensión");
		MATES_COLS.forEach(function (x) { h.push(x.titulo); });
		h.push("Trabajo Diario", "Fortalezas", "Áreas de Oportunidad", COL_ASISTENCIA_REF);
		CAMPOS.forEach(function (c) { h.push(c + ": Calificación"); });
		h.push(COL_BOLETA, COL_JUICIO);
		CAMPOS.forEach(function (c) { h.push(colFinal(c)); });
		h.push(COL_PROMEDIO_FINAL, COL_ACREDITACION);
		return h;
	}

	// Columnas de la evaluación final (finales por campo y promedio final de grado): siempre
	// con un decimal, "10.0" y no "10" (como en la boleta oficial)
	function esColumnaUnDecimal(titulo) {
		return titulo === COL_PROMEDIO_FINAL || CAMPOS.some(function (c) { return titulo === colFinal(c); });
	}
	// 7.6 → "7.6"; 10 → "10.0" (el valor ya viene truncado de ReporteDatos.finalCiclo)
	function unDecimal(v) {
		return (Math.floor(Number(v) * 10 + 1e-9) / 10).toFixed(1);
	}

	function redondear1(n) {
		if (n === null || n === undefined || n === "" || isNaN(Number(n))) return null;
		return Math.round((Number(n) + Number.EPSILON) * 10) / 10;
	}

	// El examen es una fracción de 0 a 1: con un decimal, 2/3 se leía 0.7 (70 % en vez de 66.7 %)
	function redondear2(n) {
		if (n === null || n === undefined || n === "" || isNaN(Number(n))) return null;
		return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
	}

	// Texto en una sola línea para la celda (lo que el maestro escribió no cambia de fondo)
	function unaLinea(s) {
		return String(s === null || s === undefined ? "" : s).replace(/\s+/g, " ").trim();
	}

	function depsPorDefecto() {
		var w = typeof window !== "undefined" ? window : {};
		return {
			generar: w.TextosBoleta && w.TextosBoleta.generar,
			comoParrafo: w.TextosBoleta && w.TextosBoleta.comoParrafo,
			textoSeccion: w.ReporteDatos && w.ReporteDatos.textoSeccion,
			trabajoDiario: w.ReporteDatos && w.ReporteDatos.trabajoDiario,
			boletaCerrada: w.ReporteDatos && w.ReporteDatos.boletaCerrada,
			diagnosticaVisible: w.ReporteDatos && w.ReporteDatos.diagnosticaVisible,
			asistenciaVisible: w.ReporteDatos && w.ReporteDatos.asistenciaVisible,
			calificacionOficial: w.ReporteDatos && w.ReporteDatos.calificacionOficial,
			juicioSinEvidencias: w.ReporteDatos && w.ReporteDatos.juicioSinEvidencias,
			finalCiclo: w.ReporteDatos && w.ReporteDatos.finalCiclo,
			catalogo: w.CatalogoHabilidades,
			corto: w.CamposFormativos && w.CamposFormativos.corto,
		};
	}

	/*
		construir(insumos, deps) → { encabezados, filas, maximos }

		insumos = {
			alumnos:      grupoTrimestre().alumnos (ctx.alumnos, con el grado del cierre si la
			              boleta está cerrada; [{id, nombre_completo, grado}], en orden de lista),
			trimestre:    1 | 2 | 3,
			motor:        grupoTrimestre().motor  ({porAlumno: {id: {porCampo, asistencia}}}),
			diagnosticas: grupoTrimestre().diagnosticas ({id: fila}),
			avancePda:    grupoTrimestre().avancePda ([filas de v_avance_pda]),
			boletas:      grupoTrimestre().boletas ({id: {1: {LEN: fila, ...}, 2: ..., 3: ...}}),
			bandas:       ctx.bandas, plantillas: ctx.plantillas
		}
		deps (opcional, para pruebas) = { generar, comoParrafo, textoSeccion,
		                                   calificacionOficial, juicioSinEvidencias, finalCiclo,
		                                   catalogo, corto }
		Celda vacía = null (sin evidencias o sin captura).
		Boleta cerrada: grupoTrimestre ya trae la foto del cierre (rubros, asistencia,
		diagnóstico, grado); aquí los textos y el trabajo diario también salen del cierre.
	*/
	function construir(insumos, deps) {
		deps = deps || depsPorDefecto();
		var trimestre = Number(insumos.trimestre);
		var porAlumno = (insumos.motor && insumos.motor.porAlumno) || {};
		var diagnosticas = insumos.diagnosticas || {};
		var boletas = insumos.boletas || {};
		var bandas = insumos.bandas || {};
		var etiquetaNivel = (deps.catalogo && deps.catalogo.ETIQUETA_NIVEL) || {};
		var mapa = deps.catalogo && deps.catalogo.aMapa ? deps.catalogo.aMapa : function () { return {}; };

		var pdaPorAlumno = {};
		(insumos.avancePda || []).forEach(function (f) {
			if (!pdaPorAlumno[f.alumno_id]) pdaPorAlumno[f.alumno_id] = [];
			pdaPorAlumno[f.alumno_id].push(f);
		});

		function semaforo(nivel) { return nivel ? (etiquetaNivel[nivel] || null) : null; }
		// Sin la regla del catálogo (pruebas viejas), todas aplican
		function aplica(clave, grado) {
			return deps.catalogo && deps.catalogo.aplicaMatematica ? deps.catalogo.aplicaMatematica(clave, grado) : true;
		}

		var filas = [], maximos = [];
		(insumos.alumnos || []).forEach(function (al) {
			var m = porAlumno[al.id] || {};
			var porCampo = m.porCampo || {};
			var boletaT = (boletas[al.id] || {})[trimestre] || {};
			// Boleta cerrada: textos, trabajo diario y diagnóstico como se entregaron
			var cerrada = deps.boletaCerrada ? deps.boletaCerrada(boletaT) : false;
			var diag = diagnosticas[al.id] || null;
			if (deps.diagnosticaVisible) diag = deps.diagnosticaVisible(diag, boletaT[GENERAL] || null, cerrada);
			var asis = m.asistencia || { presentes: 0, total: 0, porcentaje: null };
			if (deps.asistenciaVisible) asis = deps.asistenciaVisible(asis, boletaT[GENERAL] || null, cerrada) || asis;
			var hayAsistencia = asis.total > 0;
			var grado = al.grado === null || al.grado === undefined ? null : Number(al.grado);

			var fila = [al.nombre_completo || "", grado];
			var maximo = [al.nombre_completo || "", grado];

			CAMPOS.forEach(function (c) {
				var rubros = (porCampo[c] && porCampo[c].rubros) || {};
				RUBROS_HOJA.forEach(function (r) {
					if (r.clave === "asistencia") {
						fila.push(hayAsistencia ? asis.presentes : null);
						maximo.push(asis.total || 0);
						return;
					}
					var x = rubros[r.clave];
					// Sin evidencias del rubro (máximo 0): celda vacía, no un 0 engañoso
					var redondeo = r.clave === "examen" ? redondear2 : redondear1;
					fila.push(x && x.maximo > 0 ? redondeo(x.obtenido) : null);
					maximo.push(x ? redondear1(x.maximo) : 0);
				});
			});

			var cuaderno = mapa(diag && diag.cuaderno);
			CUADERNO_COLS.forEach(function (x) { fila.push(semaforo(cuaderno[x.clave])); });
			var ppm = diag && diag.lectura_ppm !== null && diag.lectura_ppm !== undefined && diag.lectura_ppm !== "" ? Number(diag.lectura_ppm) : null;
			fila.push(ppm, semaforo(diag && diag.lectura_comprension));
			// Las 8 columnas de la hoja siempre; la habilidad que no aplica a su grado (el del
			// cierre si está cerrada) dice "No aplica", para no confundirla con "sin captura"
			var mates = mapa(diag && diag.matematicas);
			MATES_COLS.forEach(function (x) {
				fila.push(aplica(x.clave, grado) ? semaforo(mates[x.clave]) : NO_APLICA);
			});

			// Textos: mismos insumos que ReporteDatos.alumnoTrimestre
			var generado = deps.generar ? deps.generar({
				porCampo: porCampo, avancePda: pdaPorAlumno[al.id] || [], diagnostica: diag,
				banda: bandas[al.grado] || null, grado: grado, asistencia: asis, catalogo: deps.catalogo,
				corto: deps.corto, plantillas: insumos.plantillas || {},
			}) : {};

			// Trabajo diario: el del maestro (evaluacion_diagnostica.observaciones) o la propuesta
			// null = no lo ha escrito (propuesta); "" = lo vació a propósito (se respeta)
			var trabajoDiario = deps.trabajoDiario
				? deps.trabajoDiario(diag, generado.trabajoDiario, boletaT[GENERAL] || null, cerrada).texto
				: (diag && diag.observaciones !== null && diag.observaciones !== undefined ? diag.observaciones : generado.trabajoDiario);
			fila.push(unaLinea(trabajoDiario) || null);

			function combinados(tipo, lista) {
				var partes = [];
				CAMPOS.concat([GENERAL]).forEach(function (c) {
					var propuesto = deps.comoParrafo ? deps.comoParrafo((generado[c] || {})[lista] || []) : "";
					var t = unaLinea(deps.textoSeccion(boletaT[c] || null, tipo, propuesto, cerrada).texto);
					if (t) partes.push((c === GENERAL ? "General" : c) + ": " + t);
				});
				return partes.length ? partes.join(SEPARADOR_TEXTOS) : null;
			}
			fila.push(combinados("fortalezas", "fortalezas"), combinados("areas_oportunidad", "areas"));

			// Asistencia: porcentaje de días asistidos, solo como referencia
			fila.push(hayAsistencia && asis.porcentaje !== null && asis.porcentaje !== undefined
				? redondear1(asis.porcentaje * 100) : null);

			// Calificación: solo la confirmada; lo demás, "pendiente"
			CAMPOS.forEach(function (c) {
				var oficial = deps.calificacionOficial(boletaT[c] || null);
				fila.push(oficial.pendiente ? PENDIENTE : oficial.valor);
			});

			// Si la boleta está cerrada (sus columnas son las del cierre) y qué campos se
			// calificaron por juicio docente, sin evidencias registradas
			fila.push(cerrada ? BOLETA_CERRADA : BOLETA_ABIERTA);
			var porJuicio = deps.juicioSinEvidencias ? CAMPOS.filter(function (c) {
				return deps.juicioSinEvidencias(boletaT, c, porCampo[c]);
			}) : [];
			fila.push(porJuicio.length ? porJuicio.join(", ") : null);

			// Evaluación final del ciclo (ReporteDatos.finalCiclo, la misma de todos los
			// documentos): la misma en los tres trimestres; "pendiente" mientras falte algo
			var fin = deps.finalCiclo ? deps.finalCiclo(boletas[al.id] || {}, grado) : null;
			CAMPOS.forEach(function (c) {
				var v = fin ? fin.porCampo[c] : null;
				fila.push(v === null || v === undefined ? PENDIENTE : v);
			});
			fila.push(fin && fin.promedio !== null ? fin.promedio : PENDIENTE);
			fila.push(fin ? ETIQUETA_ACREDITACION[fin.acreditacion] : PENDIENTE);

			while (maximo.length < fila.length) maximo.push(null);
			filas.push(fila);
			maximos.push(maximo);
		});

		return { encabezados: encabezados(), filas: filas, maximos: maximos };
	}

	// ── CSV ──────────────────────────────────────────────────────────────────
	function celdaCSV(v) {
		if (v === null || v === undefined) return "";
		if (typeof v === "number") return isFinite(v) ? String(v) : "";
		var s = String(v);
		// Un texto que empieza con = + - @ Excel lo tomaría como fórmula
		if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
		if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = "\"" + s.replace(/"/g, "\"\"") + "\"";
		return s;
	}

	// UTF-8 con BOM, separado por comas, CRLF (lo que Excel en es-MX abre sin preguntar)
	function aCSV(encabezadosFila, filas) {
		var unDec = encabezadosFila.map(esColumnaUnDecimal);
		return "﻿" + [encabezadosFila].concat(filas).map(function (f, i) {
			return f.map(function (v, j) {
				// Finales y promedio final de grado: "10.0" (siempre con un decimal), no "10"
				if (i > 0 && unDec[j] && typeof v === "number" && isFinite(v)) return unDecimal(v);
				return celdaCSV(v);
			}).join(",");
		}).join("\r\n") + "\r\n";
	}

	// ── Nombre de archivo ────────────────────────────────────────────────────
	function slug(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
			.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
	}

	function nombreArchivo(grupoNombre, trimestre, ciclo, extension) {
		var partes = ["concentrado", slug(grupoNombre) || "grupo", "T" + (Number(trimestre) || 1)];
		var c = slug(ciclo);
		if (c) partes.push(c);
		return partes.join("-") + "." + extension;
	}

	// ── Hoja Léeme ───────────────────────────────────────────────────────────
	/*
		meta = { grupo, ciclo, trimestre, escuela, maestro, fecha, alumnos, escala }
		escala = MotorCalificacion.ESCALA_NIVEL (para explicar cuánto vale cada semáforo)
	*/
	function hojaLeeme(meta) {
		meta = meta || {};
		var escala = meta.escala || {};
		var valores = [];
		if (escala.logrado !== undefined) valores.push("Logrado = " + escala.logrado);
		if (escala.en_proceso !== undefined) valores.push("En proceso = " + escala.en_proceso);
		if (escala.requiere_apoyo !== undefined) valores.push("Requiere apoyo = " + escala.requiere_apoyo);
		var textoEscala = valores.length ? " (" + valores.join(", ") + ")" : "";

		return [
			["Concentrado por alumno — Mi salón"],
			[],
			["Grupo", meta.grupo || ""],
			["Escuela", meta.escuela || ""],
			["Docente", meta.maestro || ""],
			["Ciclo escolar", meta.ciclo || ""],
			["Trimestre", meta.trimestre || ""],
			["Alumnos", meta.alumnos === undefined ? "" : meta.alumnos],
			["Generado el", meta.fecha || ""],
			[],
			["IMPORTANTE"],
			["Calificación válida", "La calificación que vale es la CONFIRMADA por el docente en Mi salón. Las columnas «LEN/SAB/ETI/DHL: Calificación» muestran solo esa calificación; si dicen «pendiente», el docente todavía no la confirma. Este archivo no trae calificaciones propuestas."],
			["Asistencia", "La asistencia no es criterio de acreditación (Acuerdo 10/09/23, art. 7). Por eso NO debe usarse esta exportación para recalcular calificaciones con una plantilla que pondere la asistencia (por ejemplo, una que le dé 10 % a la asistencia). Las columnas de asistencia son solo dato de referencia."],
			["Examen", "El examen por campo es APROXIMADO: el banco de preguntas no guarda el valor de cada pregunta, así que el máximo de cada campo se estima como valor total del examen entre número de preguntas."],
			["Documento", "Mi salón es un complemento de la boleta oficial (SIGED). Este archivo no es un documento oficial de la SEP."],
			["Hojas", "«" + HOJA_PRINCIPAL + "»: una fila por alumno. «" + HOJA_MAXIMOS + "»: el máximo posible de cada alumno, en la misma celda que su obtenido. «" + HOJA_LEEME + "»: esta explicación. El CSV trae solo la hoja «" + HOJA_PRINCIPAL + "»."],
			[],
			["COLUMNA", "DE DÓNDE SALE"],
			["Alumno / Grado", "Alumnos activos del grupo, en orden de grado y número de lista."],
			["<Campo>: Tareas", "Obtenido en los productos tipo tarea del campo durante el trimestre, con un decimal. Cada producto vale hasta 1 punto según su semáforo" + textoEscala + " o su puntaje 0-10 dividido entre 10; «no entregó» vale 0. Lo justificado o que no aplica no suma al máximo."],
			["<Campo>: Trabajos", "Igual que Tareas, con los productos tipo trabajo, producto final u otro."],
			["<Campo>: Asist.", "Días asistidos del trimestre (presente o justificada) en el periodo de las sesiones del trimestre. Es el mismo número en los cuatro campos, como en la hoja original. Solo referencia: no entra en la calificación. En «" + HOJA_MAXIMOS + "»: días con lista."],
			["<Campo>: Part. / Cond.", "Registro diario de participación y conducta (0, 1 o 2 por día), repartido en partes iguales entre los campos trabajados ese día. Cada día vale 1 punto repartido: 1 (normal) y 2 (destacado) valen el punto completo; 0 vale 0."],
			["<Campo>: Cond. (conducta)", "Es solo REFERENCIA: la conducta NO pondera en la calificación. Se registra en el cierre del día y se informa aparte, en las observaciones (Ley General de Educación, art. 21). La columna conserva su lugar y su encabezado de la hoja original para que se pueda copiar igual, pero no debe sumarse a la calificación. En una boleta cerrada antes de este cambio, su calificación se calculó con el peso de conducta que había entonces y no se recalcula."],
			["<Campo>: Examen", "Fracción de aciertos en las preguntas del campo del examen del trimestre de su grado (1 = todo correcto). Aproximado (ver arriba)."],
			["Cuaderno / Lectura / Mates", "Evaluación diagnóstica del trimestre: Logrado / En proceso / Requiere apoyo. Lectura: PPM son palabras por minuto."],
			["Mates: «" + NO_APLICA + "»", "La habilidad no corresponde al grado del alumno según el Programa Sintético de la NEM: 1° evalúa suma, resta, lectura y escritura de cantidades y problemas; 2° agrega multiplicación, división y tablas (en 2°, «Tablas» evalúa estrategias de cálculo mental para multiplicar, sin memorizar las tablas, y «División», reparto y agrupamiento sin el algoritmo convencional); de 3° a 6°, las ocho (las fracciones empiezan en 3°)."],
			["Trabajo Diario", "La observación de trabajo diario que guardó el docente; si no hay, la que propone Mi salón a partir de tareas y trabajos."],
			["Fortalezas / Áreas de Oportunidad", "Textos de la boleta por campo (LEN, SAB, ETI, DHL) y generales: los guardados por el docente o, si no hay, los que propone Mi salón con lo capturado."],
			[COL_ASISTENCIA_REF, "Porcentaje de días asistidos sobre días con lista (0 a 100). Solo referencia: la asistencia no pondera."],
			["<Campo>: Calificación", "Calificación confirmada por el docente (1° y 2°: 6 a 10; 3° a 6°: 5 a 10) o «pendiente»."],
			[COL_BOLETA, "«cerrada»: el docente cerró la boleta; todas las columnas de ese alumno (grado, rubros, asistencia, cuaderno, lectura y textos) son las del cierre, lo que se entregó, aunque después se haya capturado algo o cambiado su grado. «abierta»: lo capturado hasta hoy."],
			[COL_JUICIO, "Campos cuya calificación asignó el docente por juicio, sin evidencias registradas en el trimestre (por ejemplo, un alumno que llegó tarde). Esos campos no tienen porcentaje ni rubros."],
			["<Campo>: Final", "Evaluación final del campo formativo en el ciclo (Acuerdo 10/09/23, art. 7): promedio de las calificaciones confirmadas de los trimestres 1, 2 y 3, siempre con un decimal («10.0»), truncado (sin redondear). Es un cálculo de apoyo: el promedio oficial lo calcula SIGED. «pendiente» mientras falte confirmar alguno de los tres. Es la misma en los tres trimestres."],
			[COL_PROMEDIO_FINAL, "Promedio de las cuatro finales por campo, siempre con un decimal («6.0»), truncado. «pendiente» mientras falte alguna final. Es un cálculo de apoyo: el promedio oficial lo calcula SIGED."],
			[COL_ACREDITACION, "Acuerdo 10/09/23, art. 9: 1° se acredita con haber cursado el grado; de 2° a 6°, con un promedio final de grado mínimo de 6. Dice «Acredita» o «No acredita» solo cuando están confirmados los tres trimestres de los cuatro campos; antes, «pendiente»."],
			["Celda vacía", "Sin evidencias de ese rubro en el trimestre, o sin captura."],
		];
	}

	// ── Libro XLSX (SheetJS) ─────────────────────────────────────────────────
	function anchos(encabezadosFila, filas) {
		return encabezadosFila.map(function (h, i) {
			var largo = String(h).length;
			(filas || []).forEach(function (f) {
				var v = f[i];
				if (v !== null && v !== undefined) largo = Math.max(largo, String(v).length);
			});
			return { wch: Math.min(Math.max(largo + 2, 8), 60) };
		});
	}

	// "A1" de la fila y columna (desde 0), como XLSX.utils.encode_cell
	function direccionCelda(fila, columna) {
		var letras = "", n = columna + 1;
		while (n > 0) { var m = (n - 1) % 26; letras = String.fromCharCode(65 + m) + letras; n = Math.floor((n - 1) / 26); }
		return letras + (fila + 1);
	}

	function libroXLSX(XLSX, tabla, meta) {
		var wb = XLSX.utils.book_new();
		var hoja1 = XLSX.utils.aoa_to_sheet([tabla.encabezados].concat(tabla.filas));
		hoja1["!cols"] = anchos(tabla.encabezados, tabla.filas);
		// Finales y promedio final de grado: número con un decimal a la vista ("10.0")
		tabla.encabezados.forEach(function (titulo, j) {
			if (!esColumnaUnDecimal(titulo)) return;
			tabla.filas.forEach(function (f, i) {
				var celda = hoja1[direccionCelda(i + 1, j)];
				if (celda && celda.t === "n") celda.z = "0.0";
			});
		});
		if (tabla.filas.length) hoja1["!autofilter"] = { ref: hoja1["!ref"] };
		XLSX.utils.book_append_sheet(wb, hoja1, HOJA_PRINCIPAL);

		var hoja2 = XLSX.utils.aoa_to_sheet([tabla.encabezados].concat(tabla.maximos));
		hoja2["!cols"] = anchos(tabla.encabezados, tabla.maximos);
		XLSX.utils.book_append_sheet(wb, hoja2, HOJA_MAXIMOS);

		var hoja3 = XLSX.utils.aoa_to_sheet(hojaLeeme(meta));
		hoja3["!cols"] = [{ wch: 34 }, { wch: 120 }];
		XLSX.utils.book_append_sheet(wb, hoja3, HOJA_LEEME);

		wb.Props = { Title: "Concentrado por alumno", Author: "Mi salón" };
		return wb;
	}

	var api = {
		CAMPOS: CAMPOS,
		RUBROS_HOJA: RUBROS_HOJA,
		CUADERNO_COLS: CUADERNO_COLS,
		MATES_COLS: MATES_COLS,
		COL_ASISTENCIA_REF: COL_ASISTENCIA_REF,
		COL_BOLETA: COL_BOLETA,
		COL_JUICIO: COL_JUICIO,
		COL_PROMEDIO_FINAL: COL_PROMEDIO_FINAL,
		COL_ACREDITACION: COL_ACREDITACION,
		colFinal: colFinal,
		PENDIENTE: PENDIENTE,
		NO_APLICA: NO_APLICA,
		HOJA_PRINCIPAL: HOJA_PRINCIPAL,
		HOJA_MAXIMOS: HOJA_MAXIMOS,
		HOJA_LEEME: HOJA_LEEME,
		encabezados: encabezados,
		redondear1: redondear1,
		construir: construir,
		celdaCSV: celdaCSV,
		aCSV: aCSV,
		nombreArchivo: nombreArchivo,
		hojaLeeme: hojaLeeme,
		libroXLSX: libroXLSX,
	};

	if (typeof window !== "undefined") window.Exportar = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	// ── Página exportar.html ─────────────────────────────────────────────────
	document.addEventListener("DOMContentLoaded", async function () {
		if (!window.sb) { window.location.href = "index.html"; return; }

		// Estado
		var R = window.ReporteDatos;
		var ctx = null;
		var trimestre = 1;
		var tabla = null;      // { encabezados, filas, maximos } del trimestre en pantalla
		var sinProyectos = false;
		var turno = 0;         // descarta respuestas viejas si se cambia de trimestre rápido
		var promesaSheetJS = null;
		var FILAS_VISTA = 5;
		var URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
		var SRI_SHEETJS = "sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==";

		var el = {
			subtitulo: document.getElementById("expSubtitulo"),
			mensaje: document.getElementById("expMensaje"),
			trimestres: document.getElementById("expTrimestres"),
			csv: document.getElementById("expCsvBtn"),
			xlsx: document.getElementById("expXlsxBtn"),
			estado: document.getElementById("expEstado"),
			aviso: document.getElementById("expAvisoTrimestre"),
			vista: document.getElementById("expVista"),
			vistaResumen: document.getElementById("expVistaResumen"),
		};
		var esc = R ? R.esc : function (s) { return String(s); };

		function mensaje(tipo, texto) {
			if (!texto) { el.mensaje.classList.add("hidden"); el.mensaje.textContent = ""; return; }
			el.mensaje.className = "rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200"
				                  : "bg-blue-50 text-blue-800 border border-blue-200");
			el.mensaje.textContent = texto;
			el.mensaje.classList.remove("hidden");
		}

		function botones(habilitados) {
			[el.csv, el.xlsx].forEach(function (b) { b.disabled = !habilitados; });
		}

		function hoyISO() {
			var ahora = new Date();
			return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
		}

		function renderTrimestres() {
			el.trimestres.innerHTML = [1, 2, 3].map(function (t) {
				var activo = t === trimestre;
				return "<button type='button' data-trimestre='" + t + "' aria-pressed='" + activo + "' " +
					"class='min-h-[44px] min-w-[5.5rem] px-4 rounded-lg text-sm font-semibold border transition-colors " +
					(activo ? "bg-blue-700 border-blue-700 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50") +
					"'>Trimestre " + t + "</button>";
			}).join("");
		}

		function celdaVista(v) {
			if (v === null || v === undefined || v === "") return "<td class='px-3 py-2 text-gray-300 border-b border-gray-100'>—</td>";
			if (v === PENDIENTE) return "<td class='px-3 py-2 border-b border-gray-100 text-amber-700 italic whitespace-nowrap'>pendiente</td>";
			if (typeof v === "number") return "<td class='px-3 py-2 border-b border-gray-100 text-right tabular-nums whitespace-nowrap'>" + esc(v) + "</td>";
			var largo = String(v).length > 40;
			return "<td class='px-3 py-2 border-b border-gray-100 " + (largo ? "max-w-[18rem] truncate" : "whitespace-nowrap") + "'" +
				(largo ? " title='" + esc(v) + "'" : "") + ">" + esc(v) + "</td>";
		}

		function colorEncabezado(titulo) {
			var codigo = String(titulo).slice(0, 3);
			return R && R.COLOR_CAMPO[codigo] ? R.COLOR_CAMPO[codigo] : null;
		}

		function renderVista() {
			if (!tabla || !tabla.filas.length) {
				el.vista.innerHTML = "<p class='text-sm text-gray-500 py-3'>No hay alumnos activos en este grupo.</p>";
				el.vistaResumen.textContent = "";
				return;
			}
			var enc = tabla.encabezados;
			var cabeza = "<tr>" + enc.map(function (h, i) {
				var color = colorEncabezado(h);
				var fija = i === 0 ? " sm:sticky sm:left-0 sm:z-10 bg-gray-50" : "";
				return "<th scope='col' class='px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap border-b border-gray-200" + fija + "'" +
					(color ? " style='box-shadow: inset 0 3px 0 " + color + "'" : "") + ">" + esc(h) + "</th>";
			}).join("") + "</tr>";
			var cuerpo = tabla.filas.slice(0, FILAS_VISTA).map(function (f) {
				return "<tr>" + f.map(function (v, i) {
					if (i === 0) return "<th scope='row' class='px-3 py-2 text-left font-medium text-gray-800 whitespace-nowrap border-b border-gray-100 sm:sticky sm:left-0 bg-white'>" + esc(v) + "</th>";
					return celdaVista(v);
				}).join("") + "</tr>";
			}).join("");
			el.vista.innerHTML = "<div class='overflow-x-auto rounded-xl border border-gray-200'>" +
				"<table class='min-w-full text-sm bg-white'><thead class='bg-gray-50'>" + cabeza + "</thead><tbody>" + cuerpo + "</tbody></table></div>";
			el.vistaResumen.textContent = "Primeras " + Math.min(FILAS_VISTA, tabla.filas.length) + " de " + tabla.filas.length +
				" filas · " + enc.length + " columnas";
		}

		function renderAviso() {
			if (sinProyectos) {
				el.aviso.textContent = "El trimestre " + trimestre + " no tiene proyectos registrados: los rubros saldrán vacíos y las calificaciones como «pendiente».";
				el.aviso.classList.remove("hidden");
			} else {
				el.aviso.classList.add("hidden");
			}
		}

		async function cargar() {
			var miTurno = ++turno;
			botones(false);
			tabla = null;
			el.estado.textContent = "Preparando el concentrado del trimestre " + trimestre + "...";
			el.vista.innerHTML = "<p class='text-sm text-gray-400 py-3'>Cargando...</p>";
			el.vistaResumen.textContent = "";
			mensaje(null);
			try {
				var datos = await R.grupoTrimestre(window.sb, ctx, trimestre);
				if (miTurno !== turno) return;
				sinProyectos = !!(datos.motor && datos.motor.sinProyectos);
				tabla = construir({
					// Con la boleta cerrada, el alumno con el grado del cierre
					alumnos: datos.alumnos || ctx.alumnos, trimestre: trimestre, motor: datos.motor,
					diagnosticas: datos.diagnosticas, avancePda: datos.avancePda, boletas: datos.boletas,
					bandas: ctx.bandas, plantillas: ctx.plantillas,
				});
				el.estado.textContent = "";
				renderAviso();
				// Si se mezclan boletas cerradas y abiertas, decir de dónde sale cada fila
				var nCerrados = Object.keys(datos.cerrados || {}).length;
				if (nCerrados > 0) {
					mensaje("info", nCerrados >= ctx.alumnos.length
						? "Todas las boletas del trimestre están cerradas: el concentrado es lo que se entregó."
						: nCerrados + " de " + ctx.alumnos.length + " alumnos tienen la boleta cerrada: sus columnas son las del cierre (lo que se entregó); " +
							"las de los demás, lo capturado hasta hoy. La columna «" + COL_BOLETA + "» lo indica.");
				}
				renderVista();
				botones(tabla.filas.length > 0);
			} catch (e) {
				if (miTurno !== turno) return;
				console.error("exportar: carga del trimestre", e);
				el.estado.textContent = "";
				el.vista.innerHTML = "";
				mensaje("error", "No se pudo preparar el concentrado: " + (e && e.message ? e.message : "error desconocido"));
			}
		}

		function descargarBlob(contenido, tipo, nombre) {
			var blob = new Blob([contenido], { type: tipo });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = nombre;
			a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
		}

		function nombre(extension) {
			return nombreArchivo(ctx.grupo.nombre, trimestre, ctx.ciclo, extension);
		}

		function descargarCSV() {
			if (!tabla) return;
			try {
				descargarBlob(aCSV(tabla.encabezados, tabla.filas), "text/csv;charset=utf-8", nombre("csv"));
			} catch (e) {
				console.error("exportar: CSV", e);
				mensaje("error", "No se pudo generar el CSV: " + (e.message || "error desconocido"));
			}
		}

		// SheetJS se descarga solo la primera vez que se pide un Excel
		function cargarSheetJS() {
			if (window.XLSX) return Promise.resolve(window.XLSX);
			if (promesaSheetJS) return promesaSheetJS;
			promesaSheetJS = new Promise(function (resolve, reject) {
				var s = document.createElement("script");
				s.src = URL_SHEETJS;
				s.integrity = SRI_SHEETJS;
				s.crossOrigin = "anonymous";
				s.referrerPolicy = "no-referrer";
				s.onload = function () {
					if (window.XLSX) resolve(window.XLSX);
					else reject(new Error("la librería de Excel no se inicializó"));
				};
				s.onerror = function () { reject(new Error("no se pudo descargar la librería de Excel; revisa tu conexión")); };
				document.head.appendChild(s);
			});
			promesaSheetJS.catch(function () { promesaSheetJS = null; });
			return promesaSheetJS;
		}

		async function descargarXLSX() {
			if (!tabla) return;
			var original = el.xlsx.innerHTML;
			el.xlsx.disabled = true;
			el.xlsx.textContent = "Preparando Excel...";
			try {
				var XLSX = await cargarSheetJS();
				var wb = libroXLSX(XLSX, tabla, {
					grupo: ctx.grupo.nombre, ciclo: ctx.ciclo, trimestre: trimestre,
					escuela: ctx.escuela, maestro: ctx.maestroNombre, fecha: hoyISO(),
					alumnos: tabla.filas.length,
					escala: window.MotorCalificacion ? window.MotorCalificacion.ESCALA_NIVEL : null,
				});
				XLSX.writeFile(wb, nombre("xlsx"), { compression: true });
			} catch (e) {
				console.error("exportar: XLSX", e);
				mensaje("error", "No se pudo generar el Excel: " + (e && e.message ? e.message : "error desconocido"));
			} finally {
				el.xlsx.innerHTML = original;
				el.xlsx.disabled = !tabla;
			}
		}

		el.trimestres.addEventListener("click", function (e) {
			var btn = e.target.closest ? e.target.closest("button[data-trimestre]") : null;
			if (!btn) return;
			var t = Number(btn.dataset.trimestre);
			if (t === trimestre) return;
			trimestre = t;
			try {
				var u = new URL(window.location.href);
				u.searchParams.set("t", String(t));
				window.history.replaceState(null, "", u.toString());
			} catch (err) {}
			renderTrimestres();
			cargar();
		});
		el.csv.addEventListener("click", descargarCSV);
		el.xlsx.addEventListener("click", descargarXLSX);

		// ── Arranque (todo lo anterior ya está declarado) ────────────────────────
		botones(false);
		try {
			if (!R || !window.TextosBoleta || !window.MotorCalificacion) throw new Error("faltan scripts de la página");
			ctx = await R.contexto(window.sb);
			if (!ctx) { window.location.href = "index.html"; return; }
			if (!ctx.grupo) {
				el.subtitulo.textContent = "Todavía no tienes un grupo.";
				mensaje("info", "Crea tu grupo en la configuración inicial para poder exportar su concentrado.");
				el.estado.textContent = "";
				el.vista.innerHTML = "<a href='onboarding.html' class='inline-flex items-center min-h-[44px] px-4 rounded-lg bg-blue-700 text-white text-sm font-semibold'>Crear mi grupo</a>";
				return;
			}
			var desdeUrl = Number(new URLSearchParams(window.location.search).get("t"));
			var delGrupo = Number(ctx.grupo.trimestre_actual);
			trimestre = [1, 2, 3].indexOf(desdeUrl) !== -1 ? desdeUrl : ([1, 2, 3].indexOf(delGrupo) !== -1 ? delGrupo : 1);
			el.subtitulo.textContent = (ctx.grupo.nombre || "Grupo") + (ctx.ciclo ? " · Ciclo " + ctx.ciclo : "") +
				" · " + ctx.alumnos.length + " alumnos";
			renderTrimestres();
			await cargar();
		} catch (e) {
			console.error("exportar: arranque", e);
			el.estado.textContent = "";
			mensaje("error", "No se pudo abrir la exportación: " + (e && e.message ? e.message : "error desconocido"));
		}
	});
})();
