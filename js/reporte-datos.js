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
		var perfil = perfilRes.data || {};

		var bandasRes = await sb.from("bandas_ppm").select("*");
		var bandas = {};
		(bandasRes.data || []).forEach(function (b) { bandas[b.grado] = b; });

		var plantillasRes = await sb.from("plantillas_sugerencia").select("clave, texto").eq("activo", true);
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
		if (cerrada) return { texto: guardado || "", delMaestro: false };
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
			return { texto: foto.trabajo_diario, delMaestro: !!foto.trabajo_diario_del_maestro };
		}
		var obs = diagnostica ? diagnostica.observaciones : null;
		if (obs !== null && obs !== undefined) return { texto: String(obs).trim(), delMaestro: true };
		return { texto: propuesto || "", delMaestro: false };
	}

	/*
		Todo lo de un alumno en un trimestre, listo para boleta o reporte detallado.
	*/
	async function alumnoTrimestre(sb, ctx, alumno, trimestre) {
		var motor = await window.MotorCalificacion.cargarYCalcular(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupo.id, alumnoId: alumno.id,
			grado: alumno.grado, trimestre: trimestre, campos: CAMPOS,
		});

		var diagRes = await sb.from("evaluacion_diagnostica").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id)
			.eq("momento", "trimestre_" + trimestre).maybeSingle();
		var diagnostica = diagRes.data || null;

		var pdaRes = await sb.from("v_avance_pda").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id).eq("trimestre", trimestre);
		var avancePda = pdaRes.data || [];

		var banda = ctx.bandas[alumno.grado] || null;
		var fluidez = window.CatalogoHabilidades.clasificarPPM(diagnostica ? diagnostica.lectura_ppm : null, banda);

		var textos = window.TextosBoleta.generar({
			porCampo: motor.porCampo, avancePda: avancePda, diagnostica: diagnostica, banda: banda,
			asistencia: motor.asistencia, catalogo: window.CatalogoHabilidades,
			corto: window.CamposFormativos.corto, plantillas: ctx.plantillas,
		});

		var boletas = await boletasCiclo(sb, ctx, [alumno.id]);
		var retro = await retroalimentaciones(sb, ctx, alumno.id, trimestre, 5);

		return {
			alumno: alumno, trimestre: trimestre, motor: motor,
			diagnostica: diagnostica, banda: banda, fluidez: fluidez,
			avancePda: avancePda, textos: textos,
			boletaCiclo: boletas[alumno.id] || { 1: {}, 2: {}, 3: {} },
			retroalimentaciones: retro,
		};
	}

	// Últimas retroalimentaciones no vacías del trimestre, con su producto
	async function retroalimentaciones(sb, ctx, alumnoId, trimestre, limite) {
		var proyRes = await sb.from("proyectos").select("id")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id).eq("trimestre", trimestre);
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
		return { motor: motor, diagnosticas: diagnosticas, avancePda: avancePda, boletas: boletas };
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
		textoSeccion: textoSeccion,
		trabajoDiario: trabajoDiario,
		alumnoTrimestre: alumnoTrimestre,
		retroalimentaciones: retroalimentaciones,
		grupoTrimestre: grupoTrimestre,
	};
})();
