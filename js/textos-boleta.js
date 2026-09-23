/*
	textos-boleta.js — Capa 1 de fortalezas, áreas de oportunidad y sugerencias
	(docs/PRODUCTO-MI-SALON.md §B.7). Reglas, sin IA: instantáneo, gratis y
	explicable. La Capa 2 (redacción con IA) se monta después sobre esta salida.

	Regla de oro: el maestro siempre puede editar y lo editado NO se sobreescribe.
	Este módulo solo PROPONE texto; quién lo guarda y cuándo es cosa de reportes.js.

	De dónde sale cada frase:
	  - PDA con evidencia repetida (v_avance_pda): lo logrado y lo que necesita apoyo.
	  - Rubros del motor (tareas, trabajos, participación, conducta, examen).
	  - Habilidades básicas y fluidez lectora (evaluacion_diagnostica + bandas_ppm).
	  - Asistencia: solo como observación general, nunca como parte de la calificación.

	A qué campo formativo se asigna cada cosa:
	  - PDA y rubros: a su propio campo.
	  - Lectura (PPM y comprensión): LEN. Matemáticas básicas: SAB.
	  - Cuaderno, asistencia y trabajo diario: GEN (la fila general de la boleta),
	    porque son hábitos de trabajo, no contenidos de un campo.

	El texto es para los padres: tercera persona, respetuoso, sin etiquetas ni
	diagnósticos. Nunca dice "el alumno es", dice qué hace y qué necesita.
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var GENERAL = "GEN";
	var EVIDENCIAS_MINIMAS = 2;   // un solo día no hace tendencia
	var UMBRAL_FORTALEZA = 90;    // % del rubro
	var UMBRAL_AREA = 60;
	var MAXIMO_POR_LISTA = 4;     // una boleta legible, no un inventario

	// Plantillas por rubro. Viven aquí (un solo lugar), como campos-formativos.js y
	// catalogo-habilidades.js; hacerlas editables por maestro está pendiente.
	var RUBROS = {
		tareas: {
			fortaleza: "Entrega sus tareas con puntualidad.",
			area: "No entrega todas sus tareas.",
			sugerencia: "Acordar un horario fijo para hacer la tarea en casa.",
		},
		trabajos: {
			fortaleza: "Termina sus trabajos en clase.",
			area: "Le falta terminar los trabajos que se hacen en clase.",
			sugerencia: "Revisar juntos, al final del día, que los trabajos hayan quedado completos.",
		},
		participacion: {
			fortaleza: "Participa de forma constante en las actividades del grupo.",
			area: "Participa poco en las actividades del grupo.",
			sugerencia: "Invitarle a compartir sus ideas en casa para ganar confianza al hablar en clase.",
		},
		conducta: {
			fortaleza: "Respeta los acuerdos de convivencia del grupo.",
			area: "Le cuesta seguir los acuerdos de convivencia del grupo.",
			sugerencia: "Repasar en casa los acuerdos del salón y reconocer cuando los cumple.",
		},
		examen: {
			fortaleza: "Muestra buenos resultados en la evaluación escrita.",
			area: "Los resultados de la evaluación escrita quedaron por debajo de lo esperado.",
			sugerencia: "Repasar los contenidos del trimestre con ejercicios cortos antes del examen.",
		},
	};

	var PLANTILLAS = {
		lectura_baja: {
			area: "Su velocidad de lectura está por debajo de lo esperado para su grado.",
			sugerencia: "Leer en voz alta 10 minutos diarios en casa.",
		},
		lectura_bien: { fortaleza: "Lee con la fluidez esperada para su grado." },
		comprension_baja: {
			area: "Le cuesta explicar lo que lee.",
			sugerencia: "Después de leer, pedirle que cuente con sus palabras lo que entendió.",
		},
		mates_baja: {
			area: "Necesita apoyo en: ",
			sugerencia: "Practicar con ejercicios cortos y diarios: ",
		},
		cuaderno_baja: {
			area: "Su cuaderno necesita más cuidado en: ",
			sugerencia: "Revisar el cuaderno en casa una vez por semana.",
		},
		cuaderno_bien: { fortaleza: "Mantiene su cuaderno ordenado y completo." },
		asistencia_baja: {
			area: "Sus faltas se reflejan en su avance.",
			sugerencia: "Avisar a la escuela cuando falte y ponerse al corriente con los trabajos.",
		},
		asistencia_bien: { fortaleza: "Asiste con regularidad." },
	};

	// "Trabajo diario" (la observación general que Fanny escribía a mano)
	var TRABAJO_DIARIO = {
		ambos_bien: "Cumple con sus tareas y termina sus trabajos en clase.",
		tareas_mal: "Termina sus trabajos en clase, pero no siempre trae la tarea.",
		trabajos_mal: "Trae sus tareas, pero le falta terminar los trabajos en clase.",
		ambos_mal: "No trae las tareas y le falta terminar los trabajos en clase.",
		sin_datos: "Todavía no hay suficientes registros para describir su trabajo diario.",
	};

	function vacio() {
		return { fortalezas: [], areas: [], sugerencias: [] };
	}

	function agregar(lista, texto) {
		if (!texto) return;
		if (lista.indexOf(texto) === -1) lista.push(texto);
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

	function listaEnTexto(items) {
		if (!items.length) return "";
		if (items.length === 1) return items[0];
		return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}

	/*
		generar(datos) → { LEN: {fortalezas, areas, sugerencias}, ..., GEN: {...},
		                   trabajoDiario: "..." }

		datos = {
			porCampo:    resultado del motor (rubros con fracción por campo),
			avancePda:   filas de v_avance_pda del alumno en el trimestre,
			diagnostica: fila de evaluacion_diagnostica (cuaderno, matematicas, ppm),
			banda:       fila de bandas_ppm del grado del alumno,
			asistencia:  {presentes, total, porcentaje},
			catalogo:    window.CatalogoHabilidades (etiquetas de cuaderno y mates)
		}
	*/
	function generar(datos) {
		var salida = { trabajoDiario: TRABAJO_DIARIO.sin_datos };
		CAMPOS.concat([GENERAL]).forEach(function (c) { salida[c] = vacio(); });

		porRubros(datos.porCampo || {}, salida);
		porPda(datos.avancePda || [], salida, datos.corto);
		porHabilidades(datos, salida);
		porAsistencia(datos.asistencia, salida[GENERAL]);
		salida.trabajoDiario = trabajoDiario(datos.porCampo || {});

		// Recorta a lo que cabe en una boleta sin volverse ilegible
		CAMPOS.concat([GENERAL]).forEach(function (c) {
			["fortalezas", "areas", "sugerencias"].forEach(function (k) {
				salida[c][k] = salida[c][k].slice(0, MAXIMO_POR_LISTA);
			});
		});
		return salida;
	}

	function porRubros(porCampo, salida) {
		CAMPOS.forEach(function (campo) {
			var datos = porCampo[campo];
			if (!datos || !datos.rubros) return;
			Object.keys(RUBROS).forEach(function (rubro) {
				var r = datos.rubros[rubro];
				if (!r || r.maximo <= 0 || r.fraccion === null) return;
				var pct = r.fraccion * 100;
				if (pct >= UMBRAL_FORTALEZA) {
					agregar(salida[campo].fortalezas, RUBROS[rubro].fortaleza);
				} else if (pct < UMBRAL_AREA) {
					agregar(salida[campo].areas, RUBROS[rubro].area);
					agregar(salida[campo].sugerencias, RUBROS[rubro].sugerencia);
				}
			});
		});
	}

	function porPda(filas, salida, corto) {
		filas.forEach(function (f) {
			if (!f || f.evidencias < EVIDENCIAS_MINIMAS) return;
			var campo = corto ? corto(f.campo_formativo) : null;
			if (!campo || !salida[campo]) return;
			var frase = frasePda(f.pda);
			if (!frase) return;
			if (f.nivel_predominante === "logrado") {
				agregar(salida[campo].fortalezas, frase);
			} else if (f.nivel_predominante === "requiere_apoyo") {
				// El PDA viene conjugado en tercera persona ("Lee en voz alta..."), así que
				// se cita en lugar de encajarlo en la frase: "apoyo para lee" estaría mal escrito.
				agregar(salida[campo].areas, "Necesita apoyo para lograr: «" + sinPuntoFinal(frase) + "».");
				if (f.tendencia === "mejora") {
					agregar(salida[campo].sugerencias, "Ya muestra avance en este punto: conviene seguir practicándolo en casa.");
				}
			}
		});
	}

	function porHabilidades(datos, salida) {
		var diag = datos.diagnostica;
		var catalogo = datos.catalogo;
		if (!diag || !catalogo) return;

		// Lectura → LEN
		var nivelPpm = catalogo.clasificarPPM(diag.lectura_ppm, datos.banda);
		if (nivelPpm === "requiere_apoyo" || nivelPpm === "cercano") {
			agregar(salida.LEN.areas, PLANTILLAS.lectura_baja.area);
			agregar(salida.LEN.sugerencias, PLANTILLAS.lectura_baja.sugerencia);
		} else if (nivelPpm === "estandar" || nivelPpm === "avanzado") {
			agregar(salida.LEN.fortalezas, PLANTILLAS.lectura_bien.fortaleza);
		}
		if (diag.lectura_comprension === "requiere_apoyo") {
			agregar(salida.LEN.areas, PLANTILLAS.comprension_baja.area);
			agregar(salida.LEN.sugerencias, PLANTILLAS.comprension_baja.sugerencia);
		}

		// Matemáticas básicas → SAB
		var mates = catalogo.aMapa(diag.matematicas);
		var matesFlojas = catalogo.MATEMATICAS.filter(function (h) {
			return mates[h.clave] === "requiere_apoyo";
		}).map(function (h) { return h.etiqueta.toLowerCase(); });
		if (matesFlojas.length) {
			agregar(salida.SAB.areas, PLANTILLAS.mates_baja.area + listaEnTexto(matesFlojas) + ".");
			agregar(salida.SAB.sugerencias, PLANTILLAS.mates_baja.sugerencia + listaEnTexto(matesFlojas) + ".");
		}

		// Cuaderno → general (hábito de trabajo)
		var cuaderno = catalogo.aMapa(diag.cuaderno);
		var cuadernoFlojo = catalogo.CUADERNO.filter(function (c) {
			return cuaderno[c.clave] === "requiere_apoyo";
		}).map(function (c) { return c.etiqueta.toLowerCase(); });
		var cuadernoCapturado = catalogo.CUADERNO.some(function (c) { return cuaderno[c.clave]; });
		if (cuadernoFlojo.length) {
			agregar(salida.GEN.areas, PLANTILLAS.cuaderno_baja.area + listaEnTexto(cuadernoFlojo) + ".");
			agregar(salida.GEN.sugerencias, PLANTILLAS.cuaderno_baja.sugerencia);
		} else if (cuadernoCapturado) {
			agregar(salida.GEN.fortalezas, PLANTILLAS.cuaderno_bien.fortaleza);
		}
	}

	function porAsistencia(asistencia, general) {
		if (!asistencia || !asistencia.total) return;
		var pct = asistencia.porcentaje * 100;
		if (pct >= 95) agregar(general.fortalezas, PLANTILLAS.asistencia_bien.fortaleza);
		else if (pct < 80) {
			agregar(general.areas, PLANTILLAS.asistencia_baja.area);
			agregar(general.sugerencias, PLANTILLAS.asistencia_baja.sugerencia);
		}
	}

	// Promedio de un rubro entre los campos donde hay datos
	function promedioRubro(porCampo, rubro) {
		var suma = 0, n = 0;
		CAMPOS.forEach(function (campo) {
			var datos = porCampo[campo];
			if (!datos || !datos.rubros) return;
			var r = datos.rubros[rubro];
			if (!r || r.maximo <= 0 || r.fraccion === null) return;
			suma += r.fraccion * 100;
			n++;
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

	// Lista de frases → párrafo para el cuadro de texto de la boleta
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
		TRABAJO_DIARIO: TRABAJO_DIARIO,
		frasePda: frasePda,
		generar: generar,
		comoParrafo: comoParrafo,
	};

	if (typeof window !== "undefined") window.TextosBoleta = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
