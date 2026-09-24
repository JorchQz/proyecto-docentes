/*
	reporte-datos.js — Capa de datos compartida de los reportes de Mi salón (B.8):
	boleta imprimible, reporte detallado, presentación de junta y exportación.

	No calcula nada por su cuenta: junta lo que ya existe.
	  - Calificaciones y rubros: js/motor-calificacion.js (motor único).
	  - Calificación oficial: la CONFIRMADA por el maestro en boleta_trimestral. Lo no
	    confirmado es "pendiente", nunca un número (Acuerdo 10/09/23, art. 4 XI).
	  - Textos: los que el maestro dejó en la boleta; si no hay, la propuesta de la
	    Capa 1 (js/textos-boleta.js).
	  - Cuaderno, habilidades y PPM: evaluacion_diagnostica + bandas_ppm.
	  - Boleta cerrada: TODO sale de la foto del cierre (texto_autogenerado.cierre de la fila
	    GEN): grado, fase, escala, banda de PPM, porcentajes y desglose por rubro, pesos,
	    avance por PDA, diagnóstico, asistencia y trabajo diario (decisiones de Jorge 6 y 7).
	    alumnoTrimestre y grupoTrimestre ya la aplican; las cerradas antes de que la foto
	    guardara algo caen, dato por dato, a lo de hoy.
	  - Juicio docente sin evidencias (decisión 5): juicioSinEvidencias.

	Requiere (en este orden): supabase.js, grupo-activo.js, campos-formativos.js,
	catalogo-habilidades.js, motor-calificacion.js, textos-boleta.js.
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
	// Colores NEM por campo (docs/MISION-PARTE-B.md §1.3)
	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };
	// Badge por grado en reportes multigrado
	var COLOR_GRADO = { 1: "#0891b2", 2: "#16a34a", 3: "#ca8a04", 4: "#d97706", 5: "#2563eb", 6: "#059669" };

	var PAGINA = 1000;
	async function todas(construir) {
		var filas = [], desde = 0;
		for (;;) {
			var res = await construir().range(desde, desde + PAGINA - 1);
			if (res.error) throw res.error;
			var lote = res.data || [];
			filas = filas.concat(lote);
			if (lote.length < PAGINA) return filas;
			desde += PAGINA;
		}
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/*
		contexto(sb) → { maestroId, maestroNombre, grupo, grupos, alumnos, ciclo, escuela,
		                 bandas: {grado: fila}, plantillas: {clave: texto} }
		null si no hay sesión (la página decide a dónde mandar).
	*/
	async function contexto(sb) {
		var ses = await sb.auth.getSession();
		var session = ses && ses.data ? ses.data.session : null;
		if (!session) return null;
		var maestroId = session.user.id;

		var activo = await window.GrupoActivo.cargar(sb, maestroId);
		var grupo = activo.grupo;
		var alumnos = [];
		if (grupo) {
			var alRes = await sb.from("alumnos").select("id, nombre_completo, num_lista, grado")
				.eq("maestro_id", maestroId).eq("grupo_id", grupo.id).eq("estatus", "activo")
				.order("grado").order("num_lista");
			if (alRes.error) throw alRes.error;
			alumnos = alRes.data || [];
		}

		var perfilRes = await sb.from("perfiles").select("nombre_completo, escuela").eq("id", maestroId).maybeSingle();
		// Un error se lanza: la página dice que no pudo, en vez de imprimir sin escuela ni
		// docente, o sin bandas de lectura y sugerencias
		if (perfilRes.error) throw perfilRes.error;
		var perfil = perfilRes.data || {};

		var bandasRes = await sb.from("bandas_ppm").select("*");
		if (bandasRes.error) throw bandasRes.error;
		var bandas = {};
		(bandasRes.data || []).forEach(function (b) { bandas[b.grado] = b; });

		var plantillasRes = await sb.from("plantillas_sugerencia").select("clave, texto").eq("activo", true);
		if (plantillasRes.error) throw plantillasRes.error;
		var plantillas = {};
		(plantillasRes.data || []).forEach(function (p) { plantillas[p.clave] = p.texto; });

		return {
			maestroId: maestroId,
			maestroNombre: perfil.nombre_completo || "",
			grupo: grupo,
			grupos: activo.grupos,
			alumnos: alumnos,
			ciclo: grupo ? (grupo.ciclo_escolar || "") : "",
			escuela: (grupo && grupo.escuela) || perfil.escuela || "",
			bandas: bandas,
			plantillas: plantillas,
		};
	}

	// Calificación que vale para cualquier reporte: solo la confirmada por el maestro
	function calificacionOficial(filaBoleta) {
		if (!filaBoleta || !filaBoleta.calificacion_confirmada || filaBoleta.calificacion === null || filaBoleta.calificacion === undefined) {
			return { valor: null, confirmada: false, cerrada: false, pendiente: true };
		}
		return { valor: Number(filaBoleta.calificacion), confirmada: true, cerrada: !!filaBoleta.cerrada, pendiente: false };
	}

	/*
		Boleta cerrada = los cuatro campos del trimestre cerrados (el botón "Cerrar boleta"
		los cierra juntos). Desde ahí lo entregado queda fijo en todos los reportes:
		calificación y porcentaje guardados, los textos guardados (también los de la fila
		GEN, que no lleva calificación y por eso la base no la marca cerrada) y el trabajo
		diario de la foto del cierre. filasTrimestre = {LEN: fila, SAB: fila, ...}.
	*/
	function boletaCerrada(filasTrimestre) {
		if (!filasTrimestre) return false;
		return CAMPOS.every(function (c) { return !!(filasTrimestre[c] && filasTrimestre[c].cerrada); });
	}

	// Lo que se congeló al cerrar: texto_autogenerado.cierre de la fila GEN
	function fotoCierre(filaGeneral) {
		var t = filaGeneral && filaGeneral.texto_autogenerado;
		return t && t.cierre && typeof t.cierre === "object" ? t.cierre : null;
	}

	/*
		Diagnóstico como se entregó. Con la boleta cerrada, cuaderno, lectura y matemáticas
		salen de la foto del cierre (texto_autogenerado.cierre.diagnostico de la fila GEN),
		no de lo que se edite después en Evaluación diagnóstica. null en la foto = no había
		diagnóstico al cerrar. Boletas cerradas antes de la foto: el diagnóstico de hoy.
	*/
	var CAMPOS_DIAGNOSTICO = ["cuaderno", "lectura_ppm", "lectura_comprension", "matematicas"];
	function diagnosticaVisible(diagnostica, filaGeneral, cerrada) {
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		if (!foto || !Object.prototype.hasOwnProperty.call(foto, "diagnostico")) return diagnostica;
		if (!foto.diagnostico) return null;
		return Object.assign({}, diagnostica || {}, foto.diagnostico);
	}
	// Asistencia de referencia como se entregó (foto del cierre); sin foto, la de hoy
	function asistenciaVisible(asistencia, filaGeneral, cerrada) {
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		return foto && foto.asistencia ? foto.asistencia : asistencia;
	}
	function fotoAsistencia(asistencia) {
		if (!asistencia) return null;
		return { presentes: asistencia.presentes, total: asistencia.total, porcentaje: asistencia.porcentaje };
	}
	function fotoDiagnostico(diagnostica) {
		if (!diagnostica) return null;
		var foto = {};
		CAMPOS_DIAGNOSTICO.forEach(function (k) { foto[k] = diagnostica[k] === undefined ? null : diagnostica[k]; });
		return foto;
	}

	function vacio(v) { return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v)); }
	function tiene(obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); }

	/*
		Fase y escala (Acuerdo 10/09/23, art. 9). Solo rotulan: el piso lo garantiza la base
		(piso_calificacion_boleta + trigger boleta_trimestral_piso_fase) y la conversión de
		porcentaje a número es solo calcular_calificacion_boleta.
	*/
	function faseDeGrado(grado) {
		var g = Number(grado);
		if (!(g >= 1 && g <= 6)) return null;
		return g <= 2 ? 3 : (g <= 4 ? 4 : 5);
	}
	function escalaDeFase(fase) {
		if (!fase) return "";
		return Number(fase) === 3 ? "6 a 10" : "5 a 10; 5 no acredita";
	}

	/*
		Foto del cierre, segunda parte (decisiones de Jorge 6 y 7, 2026-09-24). Además del
		trabajo diario, el diagnóstico y la asistencia, al cerrar se guardan:
		  alumno:     grado, fase, escala y banda de PPM de su grado (estándar de lectura)
		  campos:     por campo, porcentaje (truncado a 2 decimales, igual que la fila),
		              semáforo, desglose por rubro y si no había evidencias (juicio docente)
		  pesos:      los pesos con que se calculó
		  avance_pda: el avance por PDA del alumno
		Todo documento de una boleta cerrada lee esto; si después cambia el grado, las
		capturas o los pesos, lo entregado no se mueve. Las boletas cerradas antes de esta
		foto no traen estas claves: entonces cada dato cae a lo de hoy, sin romperse.
	*/
	function truncar2(p) {
		return vacio(p) ? null : Math.floor(Number(p) * 100 + 1e-9) / 100;
	}
	function fotoAlumno(alumno, banda) {
		var grado = alumno && !vacio(alumno.grado) ? Number(alumno.grado) : null;
		var fase = faseDeGrado(grado);
		return {
			grado: grado, fase: fase, escala: escalaDeFase(fase),
			banda_ppm: banda ? {
				grado: banda.grado === undefined ? grado : banda.grado,
				requiere_apoyo_max: banda.requiere_apoyo_max, cercano_max: banda.cercano_max, estandar_max: banda.estandar_max,
			} : null,
		};
	}
	function fotoCampos(porCampo) {
		var salida = {};
		CAMPOS.forEach(function (c) {
			var pc = (porCampo && porCampo[c]) || {};
			// Todo lo que el motor da por rubro (obtenido, máximo, fracción, peso y los conteos
			// que usa la Capa 1, como entrega y días del registro diario), copiado tal cual
			var rubros = {};
			Object.keys(pc.rubros || {}).forEach(function (r) {
				var x = pc.rubros[r] || {};
				rubros[r] = JSON.parse(JSON.stringify(x));
				if (rubros[r].fraccion === undefined) rubros[r].fraccion = null;
			});
			var pct = truncar2(pc.porcentaje);
			salida[c] = { porcentaje: pct, nivel: pc.nivel || null, sin_evidencias: pct === null, rubros: rubros };
		});
		return salida;
	}
	function fotoAvancePda(filas) {
		return (filas || []).map(function (f) {
			var copia = Object.assign({}, f);
			delete copia.maestro_id;
			delete copia.grupo_id;
			return copia;
		});
	}

	// Lo que la foto guardó del alumno (null en boletas cerradas antes de guardarlo)
	function alumnoCierre(foto) {
		return foto && foto.alumno && typeof foto.alumno === "object" && !vacio(foto.alumno.grado) ? foto.alumno : null;
	}
	// El alumno como se entregó: con el grado de la foto
	function alumnoVisible(alumno, foto) {
		var a = alumnoCierre(foto);
		return a ? Object.assign({}, alumno, { grado: Number(a.grado) }) : alumno;
	}
	// Banda de PPM como se entregó (la foto puede decir que no había banda: null)
	function bandaVisible(banda, foto) {
		var a = alumnoCierre(foto);
		return a && tiene(a, "banda_ppm") ? a.banda_ppm : banda;
	}
	function faseVisible(grado, foto) {
		var a = alumnoCierre(foto);
		return a && a.fase ? Number(a.fase) : faseDeGrado(grado);
	}
	function escalaVisible(grado, foto) {
		var a = alumnoCierre(foto);
		return a && a.escala ? String(a.escala) : escalaDeFase(faseDeGrado(grado));
	}
	// porCampo como el del motor, pero del cierre (null si la foto no lo guardó)
	function porCampoCierre(foto) {
		if (!foto || !foto.campos || typeof foto.campos !== "object") return null;
		var salida = {};
		CAMPOS.forEach(function (c) {
			var x = foto.campos[c] || {};
			salida[c] = {
				rubros: x.rubros || {},
				porcentaje: vacio(x.porcentaje) ? null : Number(x.porcentaje),
				nivel: x.nivel || null,
				calificacionPropuesta: null, // cerrada: la calificación es la confirmada
				sinEvidencias: !!x.sin_evidencias,
			};
		});
		return salida;
	}
	function avancePdaCierre(foto) {
		return foto && Array.isArray(foto.avance_pda) ? foto.avance_pda : null;
	}

	/*
		¿La calificación confirmada de este campo fue por juicio docente, sin evidencias
		registradas? (decisión de Jorge 5: el maestro la elige con "Elige", dentro de la
		escala de su fase). Nunca se inventa un porcentaje: se dice que no lo hubo.
		  - boleta cerrada con la foto completa: lo que dice la foto
		  - boleta cerrada antes de esa foto: la fila sin porcentaje
		  - abierta con el motor de hoy (pcVivo): el campo sin porcentaje hoy
		  - abierta sin motor (otro trimestre): la fila sin porcentaje (al generar la boleta
		    se guarda el porcentaje de todo campo con evidencias)
	*/
	function juicioSinEvidencias(boletaT, campo, pcVivo) {
		var fila = boletaT ? boletaT[campo] : null;
		if (!calificacionOficial(fila).confirmada) return false;
		if (boletaCerrada(boletaT)) {
			var foto = fotoCierre(boletaT.GEN);
			if (foto && foto.campos && foto.campos[campo]) return !!foto.campos[campo].sin_evidencias;
			return vacio(fila.porcentaje);
		}
		if (pcVivo && typeof pcVivo === "object") return vacio(pcVivo.porcentaje);
		return vacio(fila.porcentaje);
	}

	// Promedio de calificaciones confirmadas (enteros por campo) con un decimal
	function promedio(valores) {
		var nums = valores.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
		if (!nums.length) return null;
		return Math.round((nums.reduce(function (a, b) { return a + b; }, 0) / nums.length) * 10) / 10;
	}

	/*
		Filas de boleta_trimestral del ciclo, por alumno, trimestre y campo:
		{ alumnoId: { 1: {LEN: fila, ..., GEN: fila}, 2: {...}, 3: {...} } }
	*/
	async function boletasCiclo(sb, ctx, alumnoIds) {
		var ids = alumnoIds || ctx.alumnos.map(function (a) { return a.id; });
		var salida = {};
		ids.forEach(function (id) { salida[id] = { 1: {}, 2: {}, 3: {} }; });
		if (!ids.length) return salida;
		var filas = await todas(function () {
			return sb.from("boleta_trimestral").select("*")
				.eq("maestro_id", ctx.maestroId).eq("ciclo", ctx.ciclo).in("alumno_id", ids).order("id");
		});
		filas.forEach(function (f) {
			if (!salida[f.alumno_id]) salida[f.alumno_id] = { 1: {}, 2: {}, 3: {} };
			if (!salida[f.alumno_id][f.trimestre]) salida[f.alumno_id][f.trimestre] = {};
			salida[f.alumno_id][f.trimestre][f.campo] = f;
		});
		return salida;
	}

	/*
		Texto visible de una sección:
		  - si el maestro escribió ESE cuadro, lo suyo tal cual, aunque lo haya dejado
		    vacío a propósito (TextosBoleta.esEditado);
		  - si la redacción con IA está en los cuadros, la redacción guardada;
		  - si no, la propuesta calculada AHORA (con las evidencias de hoy): lo guardado
		    podría ser de antes de las últimas capturas. Solo si no se calculó propuesta
		    se usa lo guardado.
	*/
	function textoSeccion(filaBoleta, tipo, propuesto, cerrada) {
		var guardado = filaBoleta ? filaBoleta[tipo] : null;
		if (window.TextosBoleta.esEditado(filaBoleta, tipo)) return { texto: guardado || "", delMaestro: true };
		// Boleta cerrada: lo que se entregó, nunca una propuesta calculada después
		if (cerrada) return { texto: guardado || "", delMaestro: false, delCierre: true };
		var conIa = filaBoleta && filaBoleta.texto_autogenerado && filaBoleta.texto_autogenerado.visible === "ia";
		if (conIa && guardado && String(guardado).trim()) return { texto: guardado, delMaestro: false };
		if (propuesto !== null && propuesto !== undefined) return { texto: propuesto, delMaestro: false };
		return { texto: guardado || "", delMaestro: false };
	}

	/*
		Trabajo diario: vive en evaluacion_diagnostica.observaciones del trimestre.
		null = el maestro no lo ha escrito → la propuesta de la Capa 1;
		"" = lo vació a propósito → se respeta vacío.
	*/
	function trabajoDiario(diagnostica, propuesto, filaGeneral, cerrada) {
		// Boleta cerrada: el texto que tenía al cerrarse (foto en la fila GEN)
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		if (foto && typeof foto.trabajo_diario === "string") {
			return { texto: foto.trabajo_diario, delMaestro: !!foto.trabajo_diario_del_maestro, delCierre: !foto.trabajo_diario_del_maestro };
		}
		var obs = diagnostica ? diagnostica.observaciones : null;
		if (obs !== null && obs !== undefined) return { texto: String(obs).trim(), delMaestro: true };
		return { texto: propuesto || "", delMaestro: false };
	}

	/*
		Todo lo de un alumno en un trimestre, listo para boleta o reporte detallado.
	*/
	async function alumnoTrimestre(sb, ctx, alumno, trimestre) {
		var motorVivo = await window.MotorCalificacion.cargarYCalcular(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupo.id, alumnoId: alumno.id,
			grado: alumno.grado, trimestre: trimestre, campos: CAMPOS,
		});

		var diagRes = await sb.from("evaluacion_diagnostica").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id)
			.eq("momento", "trimestre_" + trimestre).maybeSingle();
		// Un error se lanza: el reporte dice que no pudo, en vez de salir "sin diagnóstico"
		if (diagRes.error) throw diagRes.error;
		var diagnostica = diagRes.data || null;

		var pdaRes = await sb.from("v_avance_pda").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id).eq("trimestre", trimestre);
		if (pdaRes.error) throw pdaRes.error;
		var avancePda = pdaRes.data || [];

		var boletas = await boletasCiclo(sb, ctx, [alumno.id]);
		var boletaT = (boletas[alumno.id] || {})[trimestre] || {};
		var cerrada = boletaCerrada(boletaT);
		var foto = cerrada ? fotoCierre(boletaT.GEN) : null;
		diagnostica = diagnosticaVisible(diagnostica, boletaT.GEN, cerrada);
		// Boleta cerrada: desglose, porcentajes, pesos y avance por PDA de la foto del cierre
		// (motorVivo queda para avisar si hubo capturas después)
		var pcCierre = porCampoCierre(foto);
		var motor = Object.assign({}, motorVivo, { asistencia: asistenciaVisible(motorVivo.asistencia, boletaT.GEN, cerrada) },
			pcCierre ? {
				porCampo: pcCierre,
				pesos: foto.pesos || motorVivo.pesos,
				examenAproximado: tiene(foto, "examen_aproximado") ? !!foto.examen_aproximado : motorVivo.examenAproximado,
				usaLegacy: tiene(foto, "usa_legacy") ? !!foto.usa_legacy : motorVivo.usaLegacy,
			} : {});
		avancePda = avancePdaCierre(foto) || avancePda;

		// Grado, fase, escala y banda de lectura como se entregaron
		var alumnoV = alumnoVisible(alumno, foto);
		var banda = bandaVisible(ctx.bandas[alumnoV.grado] || null, foto);
		var fluidez = window.CatalogoHabilidades.clasificarPPM(diagnostica ? diagnostica.lectura_ppm : null, banda);
		var juicio = {};
		CAMPOS.forEach(function (c) { juicio[c] = juicioSinEvidencias(boletaT, c, (motorVivo.porCampo || {})[c]); });

		var textos = window.TextosBoleta.generar({
			porCampo: motor.porCampo, avancePda: avancePda, diagnostica: diagnostica, banda: banda,
			asistencia: motor.asistencia, catalogo: window.CatalogoHabilidades,
			corto: window.CamposFormativos.corto, plantillas: ctx.plantillas,
		});

		var retro = await retroalimentaciones(sb, ctx, alumno.id, trimestre, 5);

		return {
			alumno: alumnoV, trimestre: trimestre, motor: motor, motorVivo: motorVivo,
			cerrada: cerrada, deCierre: !!pcCierre,
			fase: faseVisible(alumnoV.grado, foto), escala: escalaVisible(alumnoV.grado, foto),
			diagnostica: diagnostica, banda: banda, fluidez: fluidez,
			avancePda: avancePda, textos: textos, juicio: juicio,
			boletaCiclo: boletas[alumno.id] || { 1: {}, 2: {}, 3: {} },
			retroalimentaciones: retro,
		};
	}

	/*
		Grupo con las boletas cerradas congeladas (decisión de Jorge 7): para cada alumno con
		la boleta del trimestre cerrada, porcentajes y rubros, asistencia, diagnóstico, avance
		por PDA, grado y banda de lectura salen de la foto del cierre; los abiertos siguen en
		vivo. Así la junta, la exportación y los concentrados cuadran con lo entregado.
		Devuelve una copia de datos con además:
		  alumnos       ctx.alumnos con el grado del cierre
		  cerrados      {alumnoId: true} (boleta cerrada)
		  bandasAlumno  {alumnoId: banda|null} de la foto (solo si la foto la guardó)
	*/
	function congelarCerradas(ctx, datos, trimestre) {
		var porAlumno = Object.assign({}, (datos.motor && datos.motor.porAlumno) || {});
		var diagnosticas = Object.assign({}, datos.diagnosticas || {});
		var avancePda = datos.avancePda || [];
		var cerrados = {}, bandasAlumno = {}, pdaCambio = false;
		var alumnos = (ctx.alumnos || []).map(function (a) {
			var boletaT = ((datos.boletas || {})[a.id] || {})[trimestre] || {};
			if (!boletaCerrada(boletaT)) return a;
			var foto = fotoCierre(boletaT.GEN);
			cerrados[a.id] = true;
			var diag = diagnosticaVisible(diagnosticas[a.id] || null, boletaT.GEN, true);
			if (diag) diagnosticas[a.id] = diag; else delete diagnosticas[a.id];
			var m = porAlumno[a.id] || { porCampo: {}, asistencia: { presentes: 0, total: 0, porcentaje: null } };
			var pc = porCampoCierre(foto);
			porAlumno[a.id] = Object.assign({}, m, { asistencia: asistenciaVisible(m.asistencia, boletaT.GEN, true) },
				pc ? {
					porCampo: pc,
					examenAproximado: tiene(foto, "examen_aproximado") ? !!foto.examen_aproximado : m.examenAproximado,
					usaLegacy: tiene(foto, "usa_legacy") ? !!foto.usa_legacy : m.usaLegacy,
				} : {});
			var pda = avancePdaCierre(foto);
			if (pda) {
				avancePda = avancePda.filter(function (f) { return f.alumno_id !== a.id; })
					.concat(pda.map(function (f) { return Object.assign({}, f, { alumno_id: a.id }); }));
				pdaCambio = true;
			}
			var ac = alumnoCierre(foto);
			if (ac && tiene(ac, "banda_ppm")) bandasAlumno[a.id] = ac.banda_ppm;
			return alumnoVisible(a, foto);
		});
		// Orden de lista con el grado del cierre (grado y número de lista, como la consulta de
		// alumnos): si cambió el grado de alguien después de cerrar, sigue donde se entregó
		alumnos = alumnos.map(function (a, i) { return { a: a, i: i }; }).sort(function (x, y) {
			return (Number(x.a.grado) || 0) - (Number(y.a.grado) || 0) ||
				(Number(x.a.num_lista) || 0) - (Number(y.a.num_lista) || 0) || x.i - y.i;
		}).map(function (x) { return x.a; });
		if (pdaCambio) {
			// El mismo orden que la consulta (alumno, PDA)
			avancePda = avancePda.slice().sort(function (x, y) {
				return String(x.alumno_id).localeCompare(String(y.alumno_id)) || String(x.clave_pda).localeCompare(String(y.clave_pda));
			});
		}
		return Object.assign({}, datos, {
			motor: Object.assign({}, datos.motor || {}, { porAlumno: porAlumno }),
			diagnosticas: diagnosticas, avancePda: avancePda,
			alumnos: alumnos, cerrados: cerrados, bandasAlumno: bandasAlumno,
		});
	}

	// Últimas retroalimentaciones no vacías del trimestre, con su producto
	async function retroalimentaciones(sb, ctx, alumnoId, trimestre, limite) {
		var proyRes = await sb.from("proyectos").select("id")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id).eq("trimestre", trimestre);
		if (proyRes.error) throw proyRes.error;
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });
		if (!proyIds.length) return [];
		var res = await sb.from("calificaciones")
			.select("retroalimentacion, fecha, evaluado_en, productos_sesion(nombre, campo)")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumnoId).in("proyecto_id", proyIds)
			.not("retroalimentacion", "is", null)
			.neq("retroalimentacion", "") // en la consulta, no después: si no, el límite trae de menos
			.order("evaluado_en", { ascending: false, nullsFirst: false })
			.limit(limite || 5);
		if (res.error) throw res.error;
		return (res.data || []).filter(function (r) { return r.retroalimentacion && String(r.retroalimentacion).trim(); })
			.map(function (r) {
				return {
					texto: r.retroalimentacion,
					fecha: r.fecha,
					producto: r.productos_sesion ? r.productos_sesion.nombre : "",
					campo: r.productos_sesion ? r.productos_sesion.campo : null,
				};
			});
	}

	/*
		Todo el grupo en un trimestre (junta, exportación, concentrado).
		{ motor: {porAlumno, pesos, sinProyectos}, diagnosticas: {alumnoId: fila},
		  avancePda: [filas], boletas: {alumnoId: {1:{...},2:{...},3:{...}}} }
	*/
	async function grupoTrimestre(sb, ctx, trimestre) {
		var motor = await window.MotorCalificacion.cargarYCalcularGrupo(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupo.id, trimestre: trimestre,
			alumnos: ctx.alumnos, campos: CAMPOS,
		});
		var ids = ctx.alumnos.map(function (a) { return a.id; });
		var diagnosticas = {};
		var avancePda = [];
		if (ids.length) {
			var diags = await todas(function () {
				return sb.from("evaluacion_diagnostica").select("*")
					.eq("maestro_id", ctx.maestroId).eq("momento", "trimestre_" + trimestre).in("alumno_id", ids).order("id");
			});
			diags.forEach(function (d) { diagnosticas[d.alumno_id] = d; });
			avancePda = await todas(function () {
				return sb.from("v_avance_pda").select("*")
					.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id).eq("trimestre", trimestre).order("alumno_id").order("clave_pda");
			});
		}
		var boletas = await boletasCiclo(sb, ctx, ids);
		// Alumnos con la boleta cerrada: como se entregó
		return congelarCerradas(ctx, { motor: motor, diagnosticas: diagnosticas, avancePda: avancePda, boletas: boletas }, trimestre);
	}

	window.ReporteDatos = {
		CAMPOS: CAMPOS,
		NOMBRE_CAMPO: NOMBRE_CAMPO,
		COLOR_CAMPO: COLOR_CAMPO,
		COLOR_GRADO: COLOR_GRADO,
		esc: esc,
		contexto: contexto,
		calificacionOficial: calificacionOficial,
		promedio: promedio,
		boletasCiclo: boletasCiclo,
		boletaCerrada: boletaCerrada,
		fotoCierre: fotoCierre,
		diagnosticaVisible: diagnosticaVisible,
		asistenciaVisible: asistenciaVisible,
		fotoAsistencia: fotoAsistencia,
		fotoDiagnostico: fotoDiagnostico,
		faseDeGrado: faseDeGrado,
		escalaDeFase: escalaDeFase,
		truncar2: truncar2,
		fotoAlumno: fotoAlumno,
		fotoCampos: fotoCampos,
		fotoAvancePda: fotoAvancePda,
		alumnoCierre: alumnoCierre,
		alumnoVisible: alumnoVisible,
		bandaVisible: bandaVisible,
		faseVisible: faseVisible,
		escalaVisible: escalaVisible,
		porCampoCierre: porCampoCierre,
		avancePdaCierre: avancePdaCierre,
		juicioSinEvidencias: juicioSinEvidencias,
		congelarCerradas: congelarCerradas,
		textoSeccion: textoSeccion,
		trabajoDiario: trabajoDiario,
		alumnoTrimestre: alumnoTrimestre,
		retroalimentaciones: retroalimentaciones,
		grupoTrimestre: grupoTrimestre,
	};
})();
