/*
	motor-calificacion.js — ÚNICO motor de calificación del SaaS (B.3).
	Reemplaza a calcCF de reportes.js: no hay una segunda fórmula en ningún otro .js.

	Lee el grano nuevo de Parte A:
	  productos_sesion (qué es calificable, de qué grados, de qué campo)
	  calificaciones   (nivel / puntaje / estado_entrega por alumno y producto)
	  registro_diario  (participación y conducta, una vez al día, global)
	  examenes + respuestas_examen + banco_preguntas (examen por campo, del grado del alumno)

	Reglas (docs/CONTEXTO.md §3 y docs/PRODUCTO-MI-SALON.md §B.2-B.5):
	  - La ASISTENCIA no pondera nunca (Acuerdo 10/09/23, art. 7 I d). Se calcula solo
	    como dato de referencia.
	  - Pesos en maestro_ajustes (tareas/trabajos/participación/conducta/examen, suman
	    100). Un peso en 0 es válido y se respeta. Un rubro sin datos no entra y los
	    demás se renormalizan.
	  - Máximos automáticos: se cuentan los productos que le tocan al grado del alumno;
	    justificado / no_aplica se descuentan del máximo (no penalizan).
	  - Porcentaje → calificación SOLO con la función SQL calcular_calificacion_boleta
	    (piso por fase: 6 en 1°-2°, 5 en 3°-6°). El motor nunca redondea por su cuenta.

	Transición: mientras la pantalla "Hoy" (B.1) no exista, la revisión de tareas del
	Dashboard sigue escribiendo filas viejas en `calificaciones` (escala 5-10, sin
	producto). Se toman en cuenta en su rubro (calificacion/10) para no perder trabajo
	ya capturado, y el resultado avisa con `usaLegacy` para que el reporte lo advierta.
*/

(function () {
	"use strict";

	// Valor de un producto por nivel cuando no hay puntaje numérico.
	// Vive aquí (un solo lugar); hacerlo editable por maestro está pendiente.
	var ESCALA_NIVEL = { logrado: 1, en_proceso: 0.7, requiere_apoyo: 0.4 };
	var VALOR_INCOMPLETO = 0.5; // incompleto sin nivel

	var RUBROS = ["tareas", "trabajos", "participacion", "conducta", "examen"];

	// productos_sesion.tipo → rubro de la fórmula ('examen' como producto no entra:
	// el rubro de examen sale de la tabla examenes)
	function rubroDeProducto(tipo) {
		if (tipo === "tarea") return "tareas";
		if (tipo === "trabajo" || tipo === "producto_final" || tipo === "otro") return "trabajos";
		return null;
	}

	/*
		Valor 0-1 de un producto para un alumno.
		null = se excluye del máximo (justificado / no_aplica / aún sin calificar).
	*/
	function puntajeProducto(cal) {
		if (!cal) return null; // sin capturar todavía: no cuenta ni a favor ni en contra
		var estado = cal.estado_entrega;
		if (estado === "justificado" || estado === "no_aplica") return null;
		if (estado === "no_entregado") return 0;
		if (cal.puntaje !== null && cal.puntaje !== undefined && cal.puntaje !== "") {
			return Math.max(0, Math.min(10, Number(cal.puntaje))) / 10;
		}
		if (cal.nivel && ESCALA_NIVEL[cal.nivel] !== undefined) return ESCALA_NIVEL[cal.nivel];
		if (estado === "incompleto") return VALOR_INCOMPLETO;
		return null;
	}

	function acumulador() {
		var acc = {};
		RUBROS.forEach(function (r) { acc[r] = { obtenido: 0, maximo: 0 }; });
		return acc;
	}

	function sumar(rubro, obtenido, maximo) {
		rubro.obtenido += obtenido;
		rubro.maximo += maximo;
	}

	/*
		Reparto de participación y conducta a los campos (B.4): el valor diario del
		alumno se reparte en partes iguales entre los campos con sesión ese día. Un día
		sin sesión registrada, o sin registro_diario, no entra al máximo.
	*/
	function repartirRegistroDiario(registros, camposPorFecha, porCampo) {
		(registros || []).forEach(function (reg) {
			var campos = camposPorFecha[reg.fecha];
			if (!campos || !campos.length) return;
			var parte = 1 / campos.length;
			campos.forEach(function (campo) {
				if (!porCampo[campo]) return;
				if (reg.participacion !== null && reg.participacion !== undefined) {
					sumar(porCampo[campo].participacion, (Number(reg.participacion) / 2) * parte, parte);
				}
				if (reg.conducta !== null && reg.conducta !== undefined) {
					sumar(porCampo[campo].conducta, (Number(reg.conducta) / 2) * parte, parte);
				}
			});
		});
	}

	/*
		Núcleo puro y testeable: de evidencias a porcentaje por campo.

		datos = {
		  campos:           ["LEN","SAB","ETI","DHL"],
		  productos:        [{id, tipo, campo}]            ya filtrados por el grado del alumno
		  calificaciones:   {producto_sesion_id: {estado_entrega, nivel, puntaje}}
		  registros:        [{fecha, participacion, conducta}]
		  camposPorFecha:   {"2026-09-22": ["LEN","SAB"]}
		  examenPorCampo:   {LEN: 0.8}                     fracción 0-1
		  legacy:           [{rubro: "tareas"|"trabajos", campo, calificacion}]  escala 5-10
		  pesos:            {tareas, trabajos, participacion, conducta, examen}
		}
	*/
	function calcularPorcentajes(datos) {
		var porCampo = {};
		datos.campos.forEach(function (c) { porCampo[c] = acumulador(); });

		(datos.productos || []).forEach(function (p) {
			var rubro = rubroDeProducto(p.tipo);
			if (!rubro || !porCampo[p.campo]) return;
			var valor = puntajeProducto((datos.calificaciones || {})[p.id]);
			if (valor === null) return; // excluido del máximo
			sumar(porCampo[p.campo][rubro], valor, 1);
		});

		(datos.legacy || []).forEach(function (l) {
			if (!porCampo[l.campo] || !porCampo[l.campo][l.rubro]) return;
			if (l.calificacion === null || l.calificacion === undefined) return;
			sumar(porCampo[l.campo][l.rubro], Number(l.calificacion) / 10, 1);
		});

		repartirRegistroDiario(datos.registros, datos.camposPorFecha || {}, porCampo);

		datos.campos.forEach(function (campo) {
			var frac = (datos.examenPorCampo || {})[campo];
			if (frac !== null && frac !== undefined) sumar(porCampo[campo].examen, frac, 1);
		});

		var resultado = {};
		datos.campos.forEach(function (campo) {
			var rubros = {}, suma = 0, pesoUsado = 0;
			RUBROS.forEach(function (r) {
				var acc = porCampo[campo][r];
				var peso = Number(datos.pesos[r] || 0);
				var fraccion = acc.maximo > 0 ? acc.obtenido / acc.maximo : null;
				rubros[r] = { obtenido: acc.obtenido, maximo: acc.maximo, fraccion: fraccion, peso: peso };
				if (fraccion !== null && peso > 0) { suma += fraccion * peso; pesoUsado += peso; }
			});
			resultado[campo] = {
				rubros: rubros,
				// Renormaliza sobre los pesos con datos: un rubro vacío no hunde el resultado
				porcentaje: pesoUsado > 0 ? (suma / pesoUsado) * 100 : null,
			};
		});
		return resultado;
	}

	// ── Carga desde Supabase ──────────────────────────────────────────────────
	// ctx = {maestroId, grupoId, alumnoId, grado, trimestre, campos}
	async function cargarYCalcular(sb, ctx) {
		var campos = ctx.campos || ["LEN", "SAB", "ETI", "DHL"];
		var grado = Number(ctx.grado);

		var ajustesRes = await sb.from("maestro_ajustes").select("*").eq("maestro_id", ctx.maestroId).maybeSingle();
		var aj = ajustesRes.data;
		var pesos = {
			tareas:        Number(aj && aj.peso_tareas        != null ? aj.peso_tareas        : 28),
			trabajos:      Number(aj && aj.peso_trabajos      != null ? aj.peso_trabajos      : 28),
			participacion: Number(aj && aj.peso_participacion != null ? aj.peso_participacion : 6),
			conducta:      Number(aj && aj.peso_conducta      != null ? aj.peso_conducta      : 5),
			examen:        Number(aj && aj.peso_examen        != null ? aj.peso_examen        : 33),
		};

		// Proyectos del trimestre (proyectos.trimestre es la fuente única) y sus sesiones
		var proyRes = await sb.from("proyectos").select("id")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre);
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });

		var sesiones = [];
		if (proyIds.length) {
			var sesRes = await sb.from("sesiones").select("id, fecha, campo_formativo").in("proyecto_id", proyIds);
			sesiones = sesRes.data || [];
		}
		var sesionIds = sesiones.map(function (s) { return s.id; });

		// Campos trabajados por fecha (para repartir participación y conducta)
		var camposPorFecha = {};
		sesiones.forEach(function (s) {
			if (!s.fecha) return;
			var codigo = window.CamposFormativos ? window.CamposFormativos.corto(s.campo_formativo) : null;
			if (!codigo) return;
			if (!camposPorFecha[s.fecha]) camposPorFecha[s.fecha] = [];
			if (camposPorFecha[s.fecha].indexOf(codigo) === -1) camposPorFecha[s.fecha].push(codigo);
		});

		// Productos activos que le tocan al grado del alumno
		var productos = [];
		if (sesionIds.length) {
			var prodRes = await sb.from("productos_sesion")
				.select("id, tipo, campo, grados, activo")
				.in("sesion_id", sesionIds).eq("activo", true);
			productos = (prodRes.data || []).filter(function (p) {
				return (p.grados || []).map(Number).indexOf(grado) !== -1;
			});
		}

		// Calificaciones del alumno sobre esos productos + filas legacy sin producto
		var calificaciones = {}, legacy = [], usaLegacy = false;
		var califRes = await sb.from("calificaciones")
			.select("producto_sesion_id, tipo, estado_entrega, nivel, puntaje, calificacion, campo_formativo, proyecto_id")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", ctx.alumnoId);
		(califRes.data || []).forEach(function (c) {
			if (c.producto_sesion_id) { calificaciones[c.producto_sesion_id] = c; return; }
			// Legacy: solo del trimestre, con calificación numérica y campo reconocible
			if (!proyIds.length || proyIds.indexOf(c.proyecto_id) === -1) return;
			if (c.calificacion === null || c.calificacion === undefined) return;
			var rubro = c.tipo === "tarea" ? "tareas" : (c.tipo === "actividad" || c.tipo === "trabajo" ? "trabajos" : null);
			if (!rubro) return;
			var codigo = window.CamposFormativos ? window.CamposFormativos.corto(c.campo_formativo) : null;
			if (!codigo) return;
			usaLegacy = true;
			legacy.push({ rubro: rubro, campo: codigo, calificacion: c.calificacion });
		});

		// Participación y conducta del trimestre (rango = fechas de las sesiones)
		var fechas = sesiones.map(function (s) { return s.fecha; }).filter(Boolean).sort();
		var registros = [];
		if (fechas.length) {
			var regRes = await sb.from("registro_diario")
				.select("fecha, participacion, conducta")
				.eq("maestro_id", ctx.maestroId).eq("alumno_id", ctx.alumnoId)
				.gte("fecha", fechas[0]).lte("fecha", fechas[fechas.length - 1]);
			registros = regRes.data || [];
		}

		var examen = await examenPorCampo(sb, ctx, grado, campos);

		var porCampo = calcularPorcentajes({
			campos: campos, productos: productos, calificaciones: calificaciones,
			registros: registros, camposPorFecha: camposPorFecha,
			examenPorCampo: examen.porCampo, legacy: legacy, pesos: pesos,
		});

		// Calificación propuesta: SIEMPRE por la función SQL (piso por fase)
		for (var i = 0; i < campos.length; i++) {
			var campo = campos[i];
			var pct = porCampo[campo].porcentaje;
			porCampo[campo].calificacionPropuesta = null;
			if (pct === null) continue;
			var rpc = await sb.rpc("calcular_calificacion_boleta", {
				p_porcentaje: Math.round(pct * 100) / 100, p_grado: grado,
			});
			if (rpc.error) throw rpc.error;
			porCampo[campo].calificacionPropuesta = rpc.data;
			porCampo[campo].nivel = pct >= 80 ? "logrado" : (pct >= 60 ? "en_proceso" : "requiere_apoyo");
		}

		var asistencia = await calcularAsistencia(sb, ctx, fechas);

		return {
			porCampo: porCampo, pesos: pesos, asistencia: asistencia,
			usaLegacy: usaLegacy, examenAproximado: examen.aproximado,
			sinProyectos: proyIds.length === 0,
		};
	}

	/*
		Examen del trimestre DEL GRADO DEL ALUMNO (en multigrado hay un examen por
		grado; tomar cualquiera mezclaba grados). Limitación conocida: banco_preguntas
		no guarda el valor de cada pregunta, así que el máximo por campo se aproxima
		como valor_total / total_preguntas.
	*/
	async function examenPorCampo(sb, ctx, grado, campos) {
		var porCampo = {}, aproximado = false;
		var exRes = await sb.from("examenes")
			.select("id, preguntas_ids, valor_total, total_preguntas, grado")
			.eq("maestro_id", ctx.maestroId).eq("trimestre", ctx.trimestre).eq("grado", grado)
			.order("created_at", { ascending: false }).limit(1).maybeSingle();
		var examen = exRes.data;
		if (!examen || !examen.id) return { porCampo: porCampo, aproximado: aproximado };

		var respRes = await sb.from("respuestas_examen")
			.select("pregunta_id, puntos_obtenidos")
			.eq("examen_id", examen.id).eq("alumno_id", ctx.alumnoId);
		var pregIds = examen.preguntas_ids || [];
		if (!pregIds.length) return { porCampo: porCampo, aproximado: aproximado };

		var pregRes = await sb.from("banco_preguntas").select("id, campo_formativo").in("id", pregIds);
		var preguntas = pregRes.data || [];
		var cfPorPregunta = {};
		var valorPorPregunta = (examen.valor_total && examen.total_preguntas)
			? Number(examen.valor_total) / Number(examen.total_preguntas) : 1;
		aproximado = true;

		var obt = {}, max = {};
		preguntas.forEach(function (p) {
			var codigo = window.CamposFormativos ? window.CamposFormativos.corto(p.campo_formativo) : null;
			if (!codigo) return;
			cfPorPregunta[p.id] = codigo;
			max[codigo] = (max[codigo] || 0) + valorPorPregunta;
		});
		(respRes.data || []).forEach(function (r) {
			var codigo = cfPorPregunta[r.pregunta_id];
			if (!codigo) return;
			obt[codigo] = (obt[codigo] || 0) + Number(r.puntos_obtenidos || 0);
		});
		campos.forEach(function (campo) {
			if (max[campo] > 0) porCampo[campo] = Math.min(1, (obt[campo] || 0) / max[campo]);
		});
		return { porCampo: porCampo, aproximado: aproximado };
	}

	// Asistencia: SOLO referencia, nunca entra a la fórmula (art. 7 I d)
	async function calcularAsistencia(sb, ctx, fechas) {
		var vacio = { presentes: 0, total: 0, porcentaje: null };
		if (!fechas.length) return vacio;
		var res = await sb.from("asistencias").select("asistencia_estado")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", ctx.alumnoId)
			.gte("fecha", fechas[0]).lte("fecha", fechas[fechas.length - 1]);
		var presentes = 0, total = 0;
		(res.data || []).forEach(function (a) {
			total++;
			if (a.asistencia_estado === "presente" || a.asistencia_estado === "justificada") presentes++;
		});
		return { presentes: presentes, total: total, porcentaje: total ? presentes / total : null };
	}

	var api = {
		ESCALA_NIVEL: ESCALA_NIVEL,
		RUBROS: RUBROS,
		ETIQUETA_RUBRO: {
			tareas: "Tareas", trabajos: "Trabajos", participacion: "Participación",
			conducta: "Conducta", examen: "Examen",
		},
		rubroDeProducto: rubroDeProducto,
		puntajeProducto: puntajeProducto,
		calcularPorcentajes: calcularPorcentajes,
		cargarYCalcular: cargarYCalcular,
	};

	if (typeof window !== "undefined") window.MotorCalificacion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
