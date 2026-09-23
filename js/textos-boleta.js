/*
	textos-boleta.js — Capa 1 de fortalezas, áreas de oportunidad y sugerencias
	(docs/PRODUCTO-MI-SALON.md §B.7). Reglas, sin IA: instantáneo, gratis y
	explicable. La Capa 2 (redacción con IA) se monta sobre esta salida.

	Regla de oro: el maestro siempre puede editar y lo editado NO se sobreescribe.
	Este módulo solo PROPONE texto; quién lo guarda y cuándo es cosa de quien lo usa.

	De dónde sale cada frase (nada se afirma con una sola evidencia):
	  - PDA con al menos 2 evidencias (v_avance_pda): lo logrado y lo que necesita apoyo.
	  - Hábitos (fila general): ENTREGA de tareas y trabajos terminados, sumando todos los
	    campos (≥90 % fortaleza, <60 % área). No se mezclan con la calidad. Si tareas y
	    trabajos van bien, es una sola frase.
	  - Calidad de lo entregado (trabajos, con al menos 2 entregados) y examen, por campo
	    (≥90 % fortaleza, <60 % área). Si la misma frase aplicaría a dos o más campos, va
	    una sola vez a la fila general nombrando esos campos.
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
	var PRIORIDAD = { pda: 1, lectura: 2, matematicas: 2, calidad: 3, examen: 3, trabajos: 4, tareas: 4, cuaderno: 5,
		participacion: 6, conducta: 6, asistencia: 7 };

	// Copia por defecto del catálogo plantillas_sugerencia (mismas claves y textos)
	var SUGERENCIAS_DEFECTO = {
		tareas: "Establecer un horario fijo para hacer la tarea en casa.",
		trabajos: "Revisar juntos, al final del día, que los trabajos hayan quedado completos.",
		calidad: "Platicar en casa sobre lo que hace en clase y repasar juntos lo que se le dificulta.",
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

	var NOMBRE_CAMPO = {
		LEN: "Lenguajes",
		SAB: "Saberes y Pensamiento Científico",
		ETI: "Ética, Naturaleza y Sociedades",
		DHL: "De lo Humano y lo Comunitario",
	};

	var RUBROS = {
		// Hábitos, por entrega (fila general). Si los dos van bien, una sola frase.
		tareas: { fortaleza: "Entrega con regularidad sus tareas.", area: "No entrega todas sus tareas." },
		trabajos: { fortaleza: "Termina sus trabajos en clase.", area: "Le falta terminar los trabajos que se hacen en clase." },
		habitos: { fortaleza: "Entrega con regularidad sus tareas y termina sus trabajos en clase." },
		// Por campo. {campos} queda vacío si es un solo campo (la frase va en su sección) o
		// nombra los campos cuando la frase se junta en la fila general.
		calidad: {
			fortaleza: "Sus trabajos muestran un buen nivel de logro{campos}.", prepFortaleza: "en",
			area: "Sus trabajos{campos} todavía no alcanzan el nivel esperado.", prepArea: "de",
		},
		examen: {
			fortaleza: "Muestra buenos resultados en la evaluación escrita{campos}.", prepFortaleza: "de",
			area: "Sus resultados en la evaluación escrita{campos} quedaron por debajo de lo esperado.", prepArea: "de",
		},
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
		asistencia_baja: "Su asistencia en el trimestre fue irregular.",
		asistencia_bien: "Asiste con regularidad.",
	};

	// Trabajo diario: solo de la ENTREGA (trae la tarea, termina el trabajo), no de la calidad
	var TRABAJO_DIARIO = {
		ambos_bien: "Cumple con sus tareas y termina sus trabajos en clase.",
		tareas_mal: "Termina sus trabajos en clase, pero no siempre trae la tarea.",
		trabajos_mal: "Trae sus tareas, pero le falta terminar los trabajos en clase.",
		ambos_mal: "No siempre trae la tarea y le falta terminar los trabajos en clase.",
		solo_tareas_bien: "Cumple con sus tareas.",
		solo_tareas_mal: "No siempre trae la tarea.",
		solo_trabajos_bien: "Termina sus trabajos en clase.",
		solo_trabajos_mal: "Le falta terminar los trabajos en clase.",
		sin_datos: "Todavía no hay suficientes registros para describir su trabajo diario.",
	};

	function listaEnTexto(items) {
		if (!items.length) return "";
		if (items.length === 1) return items[0];
		return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}

	// Palabras con las que empieza una cláusula nueva después de una coma
	var INICIO_CLAUSULA = /^(a|al|para|mediante|desde|en|por|que|con|como|cuando|donde|según|sin|así|tanto|además|a través|[a-záéíóúñ]+ndo)\b/i;

	// Posición de la última ", " antes de `limite` seguida de un inicio de cláusula; -1 si no hay
	function corteDeClausula(texto, limite) {
		var i = texto.slice(0, limite).lastIndexOf(", ");
		while (i > 0) {
			if (INICIO_CLAUSULA.test(texto.slice(i + 2))) return i;
			i = texto.slice(0, i).lastIndexOf(", ");
		}
		return -1;
	}

	// "Lee en voz alta diversos textos: cuentos, poemas" → frase corta y legible
	function frasePda(texto) {
		if (!texto) return null;
		var limpio = String(texto).trim().replace(/\s+/g, " ");
		var corte = limpio.indexOf(":");
		// Los dos puntos cortan bien "Lee textos diversos: cuentos, poemas", pero no
		// "textos del tipo: …" ni "tales como: …" (la frase quedaría colgando)
		if (corte > 30 && !/\b(tipo|tipos|como|ejemplo|siguientes?|ellos|ellas|entre|son|de|del|los|las|a|al|en|y)$/i.test(limpio.slice(0, corte).trim())) {
			limpio = limpio.slice(0, corte);
		}
		if (limpio.length > 140) {
			// Mejor una cláusula completa que una frase cortada: se corta en la última
			// coma que ABRE una cláusula (", a partir de…", ", para…", ", mediante…",
			// ", considerando…") antes de 140 caracteres. Una coma de enumeración
			// ("óseo, muscular y nervioso") no sirve. Si no hay, en palabra y con "...".
			var coma = corteDeClausula(limpio, 140);
			limpio = coma >= 50
				? limpio.slice(0, coma)
				: limpio.slice(0, 137).replace(/[,;\s]+\S*$/, "") + "...";
		}
		limpio = limpio.charAt(0).toUpperCase() + limpio.slice(1);
		return /\.\.\.$/.test(limpio) ? limpio : limpio.replace(/\.*$/, ".");
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

	function enPlural(texto) {
		return texto.replace(/\beste aprendizaje\b/g, "estos aprendizajes").replace(/\beste punto\b/g, "estos puntos");
	}

	function resolver(sec) {
		function porPrioridad(a, b) { return (a.prioridad - b.prioridad) || (a.orden - b.orden); }
		var fortalezas = sec.fortalezas.slice().sort(porPrioridad).slice(0, MAXIMO_POR_LISTA);
		var areas = sec.areas.slice().sort(porPrioridad).slice(0, MAXIMO_POR_LISTA);
		var sugerencias = [];
		areas.forEach(function (a) {
			if (!a.sugerencia) return;
			var texto = a.sugerencia;
			// Una sola sugerencia para varios PDA: "este aprendizaje" → "estos aprendizajes"
			var mismas = areas.filter(function (b) { return b.sugerencia === a.sugerencia; }).length;
			if (a.plural && mismas > 1) texto = enPlural(texto);
			if (sugerencias.indexOf(texto) === -1) sugerencias.push(texto);
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

	// Suma la entrega de un rubro (tareas o trabajos) de todos los campos
	function entregaTotal(porCampo, rubro) {
		var t = { esperados: 0, entregados: 0, completos: 0 };
		CAMPOS.forEach(function (campo) {
			var d = porCampo[campo];
			var e = d && d.rubros && d.rubros[rubro] ? d.rubros[rubro].entrega : null;
			if (!e) return;
			t.esperados += e.esperados;
			t.entregados += e.entregados;
			t.completos += e.completos;
		});
		return t;
	}

	// % de tareas entregadas (completas o no) y % de trabajos terminados; null sin evidencia
	function tasaEntrega(porCampo) {
		var tareas = entregaTotal(porCampo, "tareas");
		var trabajos = entregaTotal(porCampo, "trabajos");
		return {
			tareas: tareas.esperados >= EVIDENCIAS_MINIMAS ? tareas.entregados / tareas.esperados * 100 : null,
			trabajos: trabajos.esperados >= EVIDENCIAS_MINIMAS ? trabajos.completos / trabajos.esperados * 100 : null,
		};
	}

	// Calidad de lo entregado en un campo: promedio de los trabajos entregados (al menos 2)
	function calidadCampo(porCampo, campo) {
		var d = porCampo[campo];
		var e = d && d.rubros && d.rubros.trabajos ? d.rubros.trabajos.entrega : null;
		if (!e || e.entregados < EVIDENCIAS_MINIMAS) return null;
		return e.sumaEntregados / e.entregados * 100;
	}

	// " de «Lenguajes» y «Saberes y Pensamiento Científico»" / " en todos los campos formativos"
	function nombrarCampos(campos, prep) {
		if (campos.length === CAMPOS.length) return " " + prep + " todos los campos formativos";
		return " " + prep + " " + listaEnTexto(campos.map(function (c) { return "«" + NOMBRE_CAMPO[c] + "»"; }));
	}

	/*
		Una frase que se decide por campo (calidad, examen): si aplica a un solo campo va
		en ese campo; si aplica a varios, una sola vez en la fila general nombrándolos.
	*/
	function repartirPorCampos(secs, lista, campos, plantilla, prep, item) {
		if (!campos.length) return;
		var destino = campos.length === 1 ? secs[campos[0]] : secs[GENERAL];
		var frase = plantilla.replace("{campos}", campos.length === 1 ? "" : nombrarCampos(campos, prep));
		agregar(destino[lista], Object.assign({}, item, { texto: frase }));
	}

	function porRubros(porCampo, secs, sugerencia) {
		// Hábitos: entrega de tareas y trabajos terminados, sumando todos los campos (fila general)
		var tasa = tasaEntrega(porCampo);
		var bien = [];
		["tareas", "trabajos"].forEach(function (rubro) {
			if (tasa[rubro] === null) return;
			if (tasa[rubro] >= UMBRAL_FORTALEZA) bien.push(rubro);
			else if (tasa[rubro] < UMBRAL_AREA) {
				agregar(secs[GENERAL].areas, { texto: RUBROS[rubro].area, sugerencia: sugerencia(rubro), prioridad: PRIORIDAD[rubro] });
			}
		});
		if (bien.length === 2) {
			agregar(secs[GENERAL].fortalezas, { texto: RUBROS.habitos.fortaleza, prioridad: PRIORIDAD.tareas });
		} else if (bien.length === 1) {
			agregar(secs[GENERAL].fortalezas, { texto: RUBROS[bien[0]].fortaleza, prioridad: PRIORIDAD[bien[0]] });
		}

		// Calidad de lo entregado y examen: se deciden por campo
		[
			{ clave: "calidad", valor: function (campo) { return calidadCampo(porCampo, campo); } },
			{ clave: "examen", valor: function (campo) { return fraccionRubro(porCampo, campo, "examen"); } },
		].forEach(function (r) {
			var fuertes = [], flojos = [];
			CAMPOS.forEach(function (campo) {
				var pct = r.valor(campo);
				if (pct === null) return;
				if (pct >= UMBRAL_FORTALEZA) fuertes.push(campo);
				else if (pct < UMBRAL_AREA) flojos.push(campo);
			});
			var frases = RUBROS[r.clave];
			repartirPorCampos(secs, "fortalezas", fuertes, frases.fortaleza, frases.prepFortaleza, { prioridad: PRIORIDAD[r.clave] });
			repartirPorCampos(secs, "areas", flojos, frases.area, frases.prepArea, { sugerencia: sugerencia(r.clave), prioridad: PRIORIDAD[r.clave] });
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
					plural: true, // si la comparten varios PDA, se dice en plural
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

	// Trabajo diario: de la entrega (trae la tarea, termina el trabajo), nunca de la calidad
	function trabajoDiario(porCampo) {
		var tasa = tasaEntrega(porCampo);
		if (tasa.tareas === null && tasa.trabajos === null) return TRABAJO_DIARIO.sin_datos;
		var tareasBien = tasa.tareas !== null && tasa.tareas >= UMBRAL_AREA;
		var trabajosBien = tasa.trabajos !== null && tasa.trabajos >= UMBRAL_AREA;
		// Sin evidencia de uno de los dos, no se afirma nada sobre él
		if (tasa.tareas === null) return trabajosBien ? TRABAJO_DIARIO.solo_trabajos_bien : TRABAJO_DIARIO.solo_trabajos_mal;
		if (tasa.trabajos === null) return tareasBien ? TRABAJO_DIARIO.solo_tareas_bien : TRABAJO_DIARIO.solo_tareas_mal;
		if (tareasBien && trabajosBien) return TRABAJO_DIARIO.ambos_bien;
		if (!tareasBien && !trabajosBien) return TRABAJO_DIARIO.ambos_mal;
		return tareasBien ? TRABAJO_DIARIO.trabajos_mal : TRABAJO_DIARIO.tareas_mal;
	}

	function comoParrafo(items) {
		if (!items || !items.length) return "";
		return items.join(" ");
	}

	/*
		¿El maestro escribió este cuadro? (fortalezas | areas_oportunidad | sugerencias)
		Lo editado se respeta tal cual, incluso vacío. Se lleva por cuadro en
		texto_autogenerado.editados; las filas anteriores a esa marca solo tienen
		editado_manual (por campo), y entonces cuentan los tres cuadros como editados.
	*/
	var TIPOS_TEXTO = ["fortalezas", "areas_oportunidad", "sugerencias"];
	function esEditado(fila, tipo) {
		if (!fila || !fila.editado_manual) return false;
		var editados = fila.texto_autogenerado && fila.texto_autogenerado.editados;
		return Array.isArray(editados) ? editados.indexOf(tipo) !== -1 : true;
	}

	var api = {
		CAMPOS: CAMPOS,
		GENERAL: GENERAL,
		EVIDENCIAS_MINIMAS: EVIDENCIAS_MINIMAS,
		UMBRAL_FORTALEZA: UMBRAL_FORTALEZA,
		UMBRAL_AREA: UMBRAL_AREA,
		MAXIMO_POR_LISTA: MAXIMO_POR_LISTA,
		UMBRAL_DIARIO_NORMAL: UMBRAL_DIARIO_NORMAL,
		TRABAJO_DIARIO: TRABAJO_DIARIO,
		SUGERENCIAS_DEFECTO: SUGERENCIAS_DEFECTO,
		TIPOS_TEXTO: TIPOS_TEXTO,
		frasePda: frasePda,
		generar: generar,
		comoParrafo: comoParrafo,
		esEditado: esEditado,
	};

	if (typeof window !== "undefined") window.TextosBoleta = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
