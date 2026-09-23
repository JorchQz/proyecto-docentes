/*
	textos-boleta.js — Capa 1 de fortalezas, áreas de oportunidad y sugerencias
	(docs/PRODUCTO-MI-SALON.md §B.7). Reglas, sin IA: instantáneo, gratis y
	explicable. La Capa 2 (redacción con IA) se monta sobre esta salida.

	Regla de oro: el maestro siempre puede editar y lo editado NO se sobreescribe.
	Este módulo solo PROPONE texto; quién lo guarda y cuándo es cosa de quien lo usa.

	De dónde sale cada frase (nada se afirma con una sola evidencia):
	  - PDA con al menos 2 evidencias (v_avance_pda): lo logrado y lo que necesita apoyo.
	  - Rubros del motor: tareas, trabajos y examen por campo (≥90 % fortaleza, <60 % área).
	  - Participación y conducta: se registran UNA vez al día, globales; por eso van a la
	    fila general y no se repiten en los cuatro campos.
	  - Habilidades básicas: lectura (PPM contra la banda del grado y comprensión) → LEN;
	    matemáticas → SAB; cuaderno → general.
	  - Asistencia: observación general. Nunca baja la calificación (Acuerdo art. 7).

	Límites: máximo 4 frases por sección, sin repetir la misma idea. Si hay más áreas de
	las que caben, se quedan las de aprendizaje (PDA, lectura, matemáticas) antes que
	las de hábitos, y cada sugerencia corresponde a un área que sí quedó.

	Sugerencias: vienen del catálogo editable `plantillas_sugerencia` (clave → texto),
	que se pasa en `datos.plantillas`; si no llega, se usan las mismas frases por defecto.

	El texto es para los padres: tercera persona, respetuoso, sin etiquetas ni
	diagnósticos, sin comparar con otros alumnos.
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var GENERAL = "GEN";
	var EVIDENCIAS_MINIMAS = 2;
	var UMBRAL_FORTALEZA = 90;
	var UMBRAL_AREA = 60;
	var MAXIMO_POR_LISTA = 4;
	var UMBRAL_DIARIO_NORMAL = 50; // participación y conducta: 1 de 2 es lo normal

	// Prioridad al recortar: primero lo que habla del aprendizaje, luego los hábitos
	var PRIORIDAD = { pda: 1, lectura: 2, matematicas: 2, examen: 3, trabajos: 4, tareas: 4, cuaderno: 5,
		participacion: 6, conducta: 6, asistencia: 7 };

	// Copia por defecto del catálogo plantillas_sugerencia (mismas claves y textos)
	var SUGERENCIAS_DEFECTO = {
		tareas: "Establecer un horario fijo para hacer la tarea en casa.",
		trabajos: "Revisar juntos, al final del día, que los trabajos hayan quedado completos.",
		participacion: "Invitarle a compartir sus ideas en casa para ganar confianza al hablar en clase.",
		conducta: "Repasar en casa los acuerdos del salón y reconocer cuando los cumple.",
		examen: "Repasar los contenidos del trimestre con ejercicios cortos antes del examen.",
		lectura_ppm: "Practicar lectura en voz alta 10 minutos diarios.",
		comprension: "Después de leer, pedirle que cuente con sus palabras lo que entendió.",
		matematicas: "Practicar con ejercicios cortos y diarios: {habilidades}.",
		cuaderno: "Revisar el cuaderno en casa una vez por semana.",
		asistencia: "Avisar a la escuela cuando falte y ponerse al corriente con los trabajos.",
		pda_mejora: "Ya muestra avance en este punto: conviene seguir practicándolo en casa.",
		pda_apoyo: "Practicar en casa lo que se trabajó en clase sobre este aprendizaje.",
	};

	var RUBROS = {
		tareas: { fortaleza: "Entrega puntualmente sus tareas.", area: "No entrega todas sus tareas." },
		trabajos: { fortaleza: "Termina sus trabajos en clase.", area: "Le falta terminar los trabajos que se hacen en clase." },
		examen: { fortaleza: "Muestra buenos resultados en la evaluación escrita.", area: "Los resultados de la evaluación escrita quedaron por debajo de lo esperado." },
		participacion: { fortaleza: "Participa de forma constante en las actividades del grupo.", area: "Participa poco en las actividades del grupo." },
		conducta: { fortaleza: "Respeta los acuerdos de convivencia del grupo.", area: "Le cuesta seguir los acuerdos de convivencia del grupo." },
	};

	var TEXTOS = {
		lectura_baja: "Su velocidad de lectura está por debajo de lo esperado para su grado.",
		lectura_bien: "Lee con la fluidez esperada para su grado.",
		comprension_baja: "Le cuesta explicar lo que lee.",
		comprension_bien: "Comprende lo que lee y lo explica con sus palabras.",
		mates_baja: "Necesita apoyo en: ",
		mates_bien: "Resuelve con seguridad: ",
		cuaderno_baja: "Su cuaderno necesita más cuidado en: ",
		cuaderno_bien: "Mantiene su cuaderno ordenado y completo.",
		asistencia_baja: "Asistencia irregular: sus faltas se reflejan en su avance.",
		asistencia_bien: "Asiste con regularidad.",
	};

	var TRABAJO_DIARIO = {
		ambos_bien: "Cumple con sus tareas y termina sus trabajos en clase.",
		tareas_mal: "Entrega sus trabajos en clase, pero no siempre trae la tarea.",
		trabajos_mal: "Trae sus tareas, pero le falta terminar los trabajos en clase.",
		ambos_mal: "No trae las tareas y le falta terminar los trabajos en clase.",
		sin_datos: "Todavía no hay suficientes registros para describir su trabajo diario.",
	};

	function listaEnTexto(items) {
		if (!items.length) return "";
		if (items.length === 1) return items[0];
		return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}

	// "Lee en voz alta diversos textos: cuentos, poemas" → frase corta y legible
	function frasePda(texto) {
		if (!texto) return null;
		var limpio = String(texto).trim().replace(/\s+/g, " ");
		var corte = limpio.indexOf(":");
		if (corte > 30) limpio = limpio.slice(0, corte);
		if (limpio.length > 140) limpio = limpio.slice(0, 137).replace(/[,;\s]+\S*$/, "") + "...";
		limpio = limpio.charAt(0).toUpperCase() + limpio.slice(1);
		return limpio.replace(/\.*$/, ".");
	}

	function sinPuntoFinal(frase) {
		return String(frase || "").replace(/\.+$/, "");
	}

	/*
		Cada sección junta candidatos {texto, sugerencia?, prioridad, orden}; al final se
		ordenan por prioridad, se recortan y las sugerencias salen solo de las áreas que
		quedaron. Así nunca aparece una sugerencia sin su área, ni una idea dos veces.
	*/
	function seccion() { return { fortalezas: [], areas: [] }; }

	function agregar(lista, item) {
		if (!item || !item.texto) return;
		for (var i = 0; i < lista.length; i++) if (lista[i].texto === item.texto) return;
		item.orden = lista.length;
		lista.push(item);
	}

	function resolver(sec) {
		function porPrioridad(a, b) { return (a.prioridad - b.prioridad) || (a.orden - b.orden); }
		var fortalezas = sec.fortalezas.slice().sort(porPrioridad).slice(0, MAXIMO_POR_LISTA);
		var areas = sec.areas.slice().sort(porPrioridad).slice(0, MAXIMO_POR_LISTA);
		var sugerencias = [];
		areas.forEach(function (a) {
			if (a.sugerencia && sugerencias.indexOf(a.sugerencia) === -1) sugerencias.push(a.sugerencia);
		});
		return {
			fortalezas: fortalezas.map(function (x) { return x.texto; }),
			areas: areas.map(function (x) { return x.texto; }),
			sugerencias: sugerencias.slice(0, MAXIMO_POR_LISTA),
		};
	}

	/*
		generar(datos) → { LEN|SAB|ETI|DHL|GEN: {fortalezas, areas, sugerencias}, trabajoDiario }

		datos = {
			porCampo:    resultado del motor (rubros con fracción por campo),
			avancePda:   filas de v_avance_pda del alumno en el trimestre,
			diagnostica: fila de evaluacion_diagnostica (cuaderno, matematicas, ppm, comprensión),
			banda:       fila de bandas_ppm del grado del alumno,
			asistencia:  {presentes, total, porcentaje},
			catalogo:    window.CatalogoHabilidades,
			corto:       CamposFormativos.corto,
			plantillas:  { clave: texto } desde plantillas_sugerencia (opcional)
		}
	*/
	function generar(datos) {
		var plantillas = {};
		Object.keys(SUGERENCIAS_DEFECTO).forEach(function (k) { plantillas[k] = SUGERENCIAS_DEFECTO[k]; });
		if (datos.plantillas) {
			Object.keys(datos.plantillas).forEach(function (k) {
				if (datos.plantillas[k]) plantillas[k] = datos.plantillas[k];
			});
		}
		function sugerencia(clave, habilidades) {
			var t = plantillas[clave] || "";
			return habilidades ? t.replace("{habilidades}", habilidades) : t.replace(" {habilidades}", "").replace("{habilidades}", "");
		}

		var secs = {};
		CAMPOS.concat([GENERAL]).forEach(function (c) { secs[c] = seccion(); });

		porRubros(datos.porCampo || {}, secs, sugerencia);
		porPda(datos.avancePda || [], secs, datos.corto, sugerencia);
		porHabilidades(datos, secs, sugerencia);
		porAsistencia(datos.asistencia, secs[GENERAL], sugerencia);

		var salida = { trabajoDiario: trabajoDiario(datos.porCampo || {}) };
		CAMPOS.concat([GENERAL]).forEach(function (c) { salida[c] = resolver(secs[c]); });
		return salida;
	}

	function fraccionRubro(porCampo, campo, rubro) {
		var d = porCampo[campo];
		if (!d || !d.rubros) return null;
		var r = d.rubros[rubro];
		if (!r || r.maximo <= 0 || r.fraccion === null || r.fraccion === undefined) return null;
		return r.fraccion * 100;
	}

	function porRubros(porCampo, secs, sugerencia) {
		// Tareas, trabajos y examen: por campo
		CAMPOS.forEach(function (campo) {
			["tareas", "trabajos", "examen"].forEach(function (rubro) {
				var pct = fraccionRubro(porCampo, campo, rubro);
				if (pct === null) return;
				if (pct >= UMBRAL_FORTALEZA) {
					agregar(secs[campo].fortalezas, { texto: RUBROS[rubro].fortaleza, prioridad: PRIORIDAD[rubro] });
				} else if (pct < UMBRAL_AREA) {
					agregar(secs[campo].areas, { texto: RUBROS[rubro].area, sugerencia: sugerencia(rubro), prioridad: PRIORIDAD[rubro] });
				}
			});
		});
		// Participación y conducta: registro global del día → una sola vez, en general.
		// Se toma el total repartido entre campos (misma evidencia, sin duplicarla).
		["participacion", "conducta"].forEach(function (rubro) {
			var obtenido = 0, maximo = 0;
			CAMPOS.forEach(function (campo) {
				var d = porCampo[campo];
				var r = d && d.rubros ? d.rubros[rubro] : null;
				if (!r || !(r.maximo > 0)) return;
				obtenido += r.obtenido; maximo += r.maximo;
			});
			if (!(maximo > 0)) return;
			var pct = obtenido / maximo * 100;
			// En "Hoy" el valor por defecto del día es 1 de 2 (lo normal; el maestro solo
			// cambia excepciones), o sea 50 %. Un alumno que se queda en el valor normal
			// no "participa poco": solo es área si su promedio baja del valor por defecto.
			if (pct >= UMBRAL_FORTALEZA) {
				agregar(secs[GENERAL].fortalezas, { texto: RUBROS[rubro].fortaleza, prioridad: PRIORIDAD[rubro] });
			} else if (pct < UMBRAL_DIARIO_NORMAL) {
				agregar(secs[GENERAL].areas, { texto: RUBROS[rubro].area, sugerencia: sugerencia(rubro), prioridad: PRIORIDAD[rubro] });
			}
		});
	}

	function porPda(filas, secs, corto, sugerencia) {
		filas.forEach(function (f) {
			if (!f || f.evidencias < EVIDENCIAS_MINIMAS) return;
			var campo = corto ? corto(f.campo_formativo) : null;
			if (!campo || !secs[campo]) return;
			var frase = frasePda(f.pda);
			if (!frase) return;
			if (f.nivel_predominante === "logrado") {
				agregar(secs[campo].fortalezas, { texto: frase, prioridad: PRIORIDAD.pda });
			} else if (f.nivel_predominante === "requiere_apoyo") {
				// El PDA viene conjugado ("Lee en voz alta..."): se cita, no se encaja en la frase
				agregar(secs[campo].areas, {
					texto: "Necesita apoyo para lograr: «" + sinPuntoFinal(frase) + "».",
					sugerencia: sugerencia(f.tendencia === "mejora" ? "pda_mejora" : "pda_apoyo"),
					prioridad: PRIORIDAD.pda,
				});
			}
		});
	}

	function porHabilidades(datos, secs, sugerencia) {
		var diag = datos.diagnostica;
		var catalogo = datos.catalogo;
		if (!diag || !catalogo) return;

		// Lectura → LEN
		var nivelPpm = catalogo.clasificarPPM(diag.lectura_ppm, datos.banda);
		if (nivelPpm === "requiere_apoyo" || nivelPpm === "cercano") {
			agregar(secs.LEN.areas, { texto: TEXTOS.lectura_baja, sugerencia: sugerencia("lectura_ppm"), prioridad: PRIORIDAD.lectura });
		} else if (nivelPpm === "estandar" || nivelPpm === "avanzado") {
			agregar(secs.LEN.fortalezas, { texto: TEXTOS.lectura_bien, prioridad: PRIORIDAD.lectura });
		}
		if (diag.lectura_comprension === "requiere_apoyo") {
			agregar(secs.LEN.areas, { texto: TEXTOS.comprension_baja, sugerencia: sugerencia("comprension"), prioridad: PRIORIDAD.lectura });
		} else if (diag.lectura_comprension === "logrado") {
			agregar(secs.LEN.fortalezas, { texto: TEXTOS.comprension_bien, prioridad: PRIORIDAD.lectura });
		}

		// Matemáticas básicas → SAB (en el orden del catálogo)
		var mates = catalogo.aMapa(diag.matematicas);
		var etiquetas = function (nivel) {
			return catalogo.MATEMATICAS.filter(function (h) { return mates[h.clave] === nivel; })
				.map(function (h) { return h.etiqueta.toLowerCase(); });
		};
		var matesFlojas = etiquetas("requiere_apoyo");
		var matesBien = etiquetas("logrado");
		if (matesFlojas.length) {
			var lista = listaEnTexto(matesFlojas);
			agregar(secs.SAB.areas, { texto: TEXTOS.mates_baja + lista + ".", sugerencia: sugerencia("matematicas", lista), prioridad: PRIORIDAD.matematicas });
		}
		if (matesBien.length) {
			agregar(secs.SAB.fortalezas, { texto: TEXTOS.mates_bien + listaEnTexto(matesBien.slice(0, 4)) + ".", prioridad: PRIORIDAD.matematicas });
		}

		// Cuaderno → general (hábito de trabajo)
		var cuaderno = catalogo.aMapa(diag.cuaderno);
		var capturados = catalogo.CUADERNO.filter(function (c) { return cuaderno[c.clave]; });
		var cuadernoFlojo = catalogo.CUADERNO.filter(function (c) { return cuaderno[c.clave] === "requiere_apoyo"; })
			.map(function (c) { return c.etiqueta.toLowerCase(); });
		if (cuadernoFlojo.length) {
			agregar(secs.GEN.areas, { texto: TEXTOS.cuaderno_baja + listaEnTexto(cuadernoFlojo.slice(0, 4)) + ".", sugerencia: sugerencia("cuaderno"), prioridad: PRIORIDAD.cuaderno });
		} else if (capturados.length && capturados.every(function (c) { return cuaderno[c.clave] === "logrado"; })) {
			agregar(secs.GEN.fortalezas, { texto: TEXTOS.cuaderno_bien, prioridad: PRIORIDAD.cuaderno });
		}
	}

	function porAsistencia(asistencia, general, sugerencia) {
		if (!asistencia || !asistencia.total) return;
		var pct = asistencia.porcentaje * 100;
		if (pct >= 95) agregar(general.fortalezas, { texto: TEXTOS.asistencia_bien, prioridad: PRIORIDAD.asistencia });
		else if (pct < 80) agregar(general.areas, { texto: TEXTOS.asistencia_baja, sugerencia: sugerencia("asistencia"), prioridad: PRIORIDAD.asistencia });
	}

	// Promedio de un rubro entre los campos donde hay datos
	function promedioRubro(porCampo, rubro) {
		var suma = 0, n = 0;
		CAMPOS.forEach(function (campo) {
			var pct = fraccionRubro(porCampo, campo, rubro);
			if (pct === null) return;
			suma += pct; n++;
		});
		return n ? suma / n : null;
	}

	function trabajoDiario(porCampo) {
		var tareas = promedioRubro(porCampo, "tareas");
		var trabajos = promedioRubro(porCampo, "trabajos");
		if (tareas === null && trabajos === null) return TRABAJO_DIARIO.sin_datos;
		var tareasBien = tareas === null || tareas >= UMBRAL_AREA;
		var trabajosBien = trabajos === null || trabajos >= UMBRAL_AREA;
		if (tareasBien && trabajosBien) return TRABAJO_DIARIO.ambos_bien;
		if (!tareasBien && !trabajosBien) return TRABAJO_DIARIO.ambos_mal;
		return tareasBien ? TRABAJO_DIARIO.trabajos_mal : TRABAJO_DIARIO.tareas_mal;
	}

	function comoParrafo(items) {
		if (!items || !items.length) return "";
		return items.join(" ");
	}

	var api = {
		CAMPOS: CAMPOS,
		GENERAL: GENERAL,
		EVIDENCIAS_MINIMAS: EVIDENCIAS_MINIMAS,
		UMBRAL_FORTALEZA: UMBRAL_FORTALEZA,
		UMBRAL_AREA: UMBRAL_AREA,
		MAXIMO_POR_LISTA: MAXIMO_POR_LISTA,
		TRABAJO_DIARIO: TRABAJO_DIARIO,
		SUGERENCIAS_DEFECTO: SUGERENCIAS_DEFECTO,
		frasePda: frasePda,
		generar: generar,
		comoParrafo: comoParrafo,
	};

	if (typeof window !== "undefined") window.TextosBoleta = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
