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

	Filas viejas: antes de la pantalla "Hoy", la revisión de tareas del Dashboard
	escribía `calificaciones` sin producto (escala 5-10). Si quedan, se toman en su
	rubro (calificacion/10) para no perder trabajo capturado, y el resultado avisa con
	`usaLegacy` para que el reporte lo advierta.

	Un solo camino: cargarYCalcular (un alumno) es cargarYCalcularGrupo con un alumno.
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
		acc.tareas.entrega = entregaVacia();
		acc.trabajos.entrega = entregaVacia();
		return acc;
	}

	function entregaVacia() {
		return { esperados: 0, entregados: 0, completos: 0, sumaEntregados: 0 };
	}

	/*
		Entrega, aparte de la calidad: de los productos ya revisados y no justificados,
		cuántos entregó, cuántos completos y cuánto valen los entregados. Lo usan los
		textos (trabajo diario, hábitos, calidad de lo entregado); la calificación no cambia.
	*/
	function contarEntrega(entrega, cal) {
		if (!cal) return;
		var estado = cal.estado_entrega;
		if (estado === "justificado" || estado === "no_aplica") return;
		var valor = puntajeProducto(cal);
		if (!estado && valor === null) return; // abierto pero sin revisar
		entrega.esperados++;
		if (estado === "no_entregado") return;
		entrega.entregados++;
		if (estado !== "incompleto") entrega.completos++;
		if (valor !== null) entrega.sumaEntregados += valor;
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
			var cal = (datos.calificaciones || {})[p.id];
			contarEntrega(porCampo[p.campo][rubro].entrega, cal);
			var valor = puntajeProducto(cal);
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
				if (acc.entrega) rubros[r].entrega = acc.entrega;
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

	// Supabase devuelve como máximo 1000 filas por consulta: se lee por páginas para
	// que un grupo grande no pierda calificaciones en silencio.
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

	async function cargarPesos(sb, maestroId) {
		var ajustesRes = await sb.from("maestro_ajustes").select("*").eq("maestro_id", maestroId).maybeSingle();
		var aj = ajustesRes.data;
		return {
			tareas:        Number(aj && aj.peso_tareas        != null ? aj.peso_tareas        : 28),
			trabajos:      Number(aj && aj.peso_trabajos      != null ? aj.peso_trabajos      : 28),
			participacion: Number(aj && aj.peso_participacion != null ? aj.peso_participacion : 6),
			conducta:      Number(aj && aj.peso_conducta      != null ? aj.peso_conducta      : 5),
			examen:        Number(aj && aj.peso_examen        != null ? aj.peso_examen        : 33),
		};
	}

	/*
		cargarYCalcularGrupo(sb, ctx) — el motor para varios alumnos a la vez (junta,
		exportación, concentrado). Lee cada tabla UNA vez para todo el grupo y aplica a
		cada alumno exactamente la misma fórmula (calcularPorcentajes) y la misma
		conversión SQL que la boleta individual: cargarYCalcular es este mismo camino con
		un solo alumno, así que no hay dos maneras de calcular.

		ctx = {maestroId, grupoId, trimestre, alumnos: [{id, grado}], campos}
		→ { porAlumno: {id: {porCampo, asistencia, usaLegacy, examenAproximado}},
		    pesos, sinProyectos }
	*/
	async function cargarYCalcularGrupo(sb, ctx) {
		var campos = ctx.campos || ["LEN", "SAB", "ETI", "DHL"];
		var alumnos = (ctx.alumnos || []).map(function (a) { return { id: a.id, grado: Number(a.grado) }; });
		var ids = alumnos.map(function (a) { return a.id; });
		var pesos = await cargarPesos(sb, ctx.maestroId);

		// Proyectos del trimestre (proyectos.trimestre es la fuente única) y sus sesiones
		var proyRes = await sb.from("proyectos").select("id")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre);
		if (proyRes.error) throw proyRes.error;
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });

		var sesiones = [];
		if (proyIds.length) {
			sesiones = await todas(function () {
				return sb.from("sesiones").select("id, fecha, campo_formativo").in("proyecto_id", proyIds).order("id");
			});
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
		var fechas = sesiones.map(function (s) { return s.fecha; }).filter(Boolean).sort();

		var productos = [];
		if (sesionIds.length) {
			productos = await todas(function () {
				return sb.from("productos_sesion").select("id, tipo, campo, grados, activo")
					.in("sesion_id", sesionIds).eq("activo", true).order("id");
			});
		}

		// Calificaciones de los alumnos en los proyectos del trimestre (nuevas y legacy)
		var califs = [];
		if (ids.length && proyIds.length) {
			califs = await todas(function () {
				return sb.from("calificaciones")
					.select("alumno_id, producto_sesion_id, tipo, estado_entrega, nivel, puntaje, calificacion, campo_formativo, proyecto_id")
					.eq("maestro_id", ctx.maestroId).in("alumno_id", ids).in("proyecto_id", proyIds).order("id");
			});
		}

		var registros = [], asistencias = [];
		if (ids.length && fechas.length) {
			registros = await todas(function () {
				return sb.from("registro_diario").select("alumno_id, fecha, participacion, conducta")
					.eq("maestro_id", ctx.maestroId).in("alumno_id", ids)
					.gte("fecha", fechas[0]).lte("fecha", fechas[fechas.length - 1]).order("id");
			});
			asistencias = await todas(function () {
				return sb.from("asistencias").select("alumno_id, asistencia_estado")
					.eq("maestro_id", ctx.maestroId).in("alumno_id", ids)
					.gte("fecha", fechas[0]).lte("fecha", fechas[fechas.length - 1]).order("id");
			});
		}

		var examenes = await examenesPorGrado(sb, ctx, alumnos, ids, campos);

		// Por alumno: mismas entradas que la boleta individual
		var porAlumno = {};
		var pendientes = []; // [alumnoId, campo, porcentaje, grado] para convertir en lote
		alumnos.forEach(function (a) {
			var misProductos = productos.filter(function (p) {
				return (p.grados || []).map(Number).indexOf(a.grado) !== -1;
			});
			var calificaciones = {}, legacy = [], usaLegacy = false;
			califs.forEach(function (c) {
				if (c.alumno_id !== a.id) return;
				if (c.producto_sesion_id) { calificaciones[c.producto_sesion_id] = c; return; }
				// Legacy (revisión de tareas vieja del Dashboard): escala 5-10, sin producto
				if (c.calificacion === null || c.calificacion === undefined) return;
				var rubro = c.tipo === "tarea" ? "tareas" : (c.tipo === "actividad" || c.tipo === "trabajo" ? "trabajos" : null);
				if (!rubro) return;
				var codigo = window.CamposFormativos ? window.CamposFormativos.corto(c.campo_formativo) : null;
				if (!codigo) return;
				usaLegacy = true;
				legacy.push({ rubro: rubro, campo: codigo, calificacion: c.calificacion });
			});
			var misRegistros = registros.filter(function (r) { return r.alumno_id === a.id; });
			var examen = examenes[a.id] || { porCampo: {}, aproximado: false };

			var porCampo = calcularPorcentajes({
				campos: campos, productos: misProductos, calificaciones: calificaciones,
				registros: misRegistros, camposPorFecha: camposPorFecha,
				examenPorCampo: examen.porCampo, legacy: legacy, pesos: pesos,
			});
			campos.forEach(function (campo) {
				var pct = porCampo[campo].porcentaje;
				porCampo[campo].calificacionPropuesta = null;
				if (pct === null) return;
				porCampo[campo].nivel = pct >= 80 ? "logrado" : (pct >= 60 ? "en_proceso" : "requiere_apoyo");
				pendientes.push([a.id, campo, Math.round(pct * 100) / 100, a.grado]);
			});

			// Asistencia: SOLO referencia, nunca entra a la fórmula (art. 7 I d)
			var presentes = 0, total = 0;
			asistencias.forEach(function (x) {
				if (x.alumno_id !== a.id) return;
				total++;
				if (x.asistencia_estado === "presente" || x.asistencia_estado === "justificada") presentes++;
			});

			porAlumno[a.id] = {
				porCampo: porCampo,
				asistencia: { presentes: presentes, total: total, porcentaje: total ? presentes / total : null },
				usaLegacy: usaLegacy,
				examenAproximado: examen.aproximado,
			};
		});

		// Calificación propuesta: SIEMPRE la función SQL (piso por fase), en un solo viaje
		if (pendientes.length) {
			var rpc = await sb.rpc("calcular_calificaciones_boleta", {
				p_porcentajes: pendientes.map(function (p) { return p[2]; }),
				p_grados: pendientes.map(function (p) { return p[3]; }),
			});
			if (rpc.error) throw rpc.error;
			(rpc.data || []).forEach(function (cal, i) {
				porAlumno[pendientes[i][0]].porCampo[pendientes[i][1]].calificacionPropuesta = cal;
			});
		}

		return { porAlumno: porAlumno, pesos: pesos, sinProyectos: proyIds.length === 0 };
	}

	// ctx = {maestroId, grupoId, alumnoId, grado, trimestre, campos} — un alumno
	async function cargarYCalcular(sb, ctx) {
		var r = await cargarYCalcularGrupo(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupoId, trimestre: ctx.trimestre,
			campos: ctx.campos, alumnos: [{ id: ctx.alumnoId, grado: ctx.grado }],
		});
		var a = r.porAlumno[ctx.alumnoId];
		return {
			porCampo: a.porCampo, pesos: r.pesos, asistencia: a.asistencia,
			usaLegacy: a.usaLegacy, examenAproximado: a.examenAproximado,
			sinProyectos: r.sinProyectos,
		};
	}

	/*
		Examen del trimestre DEL GRADO DE CADA ALUMNO (en multigrado hay un examen por
		grado; tomar cualquiera mezclaba grados). Si hay varios del mismo grado, manda el
		más reciente. Limitación conocida: banco_preguntas no guarda el valor de cada
		pregunta, así que el máximo por campo se aproxima como valor_total / total_preguntas.
		→ { alumnoId: { porCampo: {LEN: 0..1}, aproximado } }
	*/
	async function examenesPorGrado(sb, ctx, alumnos, ids, campos) {
		var salida = {};
		var grados = [];
		alumnos.forEach(function (a) { if (grados.indexOf(a.grado) === -1) grados.push(a.grado); });
		if (!grados.length) return salida;

		var exRes = await sb.from("examenes")
			.select("id, preguntas_ids, valor_total, total_preguntas, grado, created_at")
			.eq("maestro_id", ctx.maestroId).eq("trimestre", ctx.trimestre).in("grado", grados)
			.order("created_at", { ascending: false });
		if (exRes.error) throw exRes.error;
		var porGrado = {};
		(exRes.data || []).forEach(function (ex) { if (!porGrado[ex.grado]) porGrado[ex.grado] = ex; });
		var examenes = Object.keys(porGrado).map(function (g) { return porGrado[g]; });
		if (!examenes.length) return salida;

		var pregIds = [];
		examenes.forEach(function (ex) {
			(ex.preguntas_ids || []).forEach(function (id) { if (pregIds.indexOf(id) === -1) pregIds.push(id); });
		});
		var cfPorPregunta = {};
		if (pregIds.length) {
			var preguntas = await todas(function () {
				return sb.from("banco_preguntas").select("id, campo_formativo").in("id", pregIds).order("id");
			});
			preguntas.forEach(function (p) {
				var codigo = window.CamposFormativos ? window.CamposFormativos.corto(p.campo_formativo) : null;
				if (codigo) cfPorPregunta[p.id] = codigo;
			});
		}
		var respuestas = await todas(function () {
			return sb.from("respuestas_examen").select("examen_id, alumno_id, pregunta_id, puntos_obtenidos")
				.in("examen_id", examenes.map(function (e) { return e.id; })).in("alumno_id", ids).order("id");
		});

		alumnos.forEach(function (a) {
			var ex = porGrado[a.grado];
			if (!ex || !(ex.preguntas_ids || []).length) return;
			var valor = (ex.valor_total && ex.total_preguntas) ? Number(ex.valor_total) / Number(ex.total_preguntas) : 1;
			var max = {}, obt = {};
			ex.preguntas_ids.forEach(function (id) {
				var c = cfPorPregunta[id];
				if (c) max[c] = (max[c] || 0) + valor;
			});
			respuestas.forEach(function (r) {
				if (r.alumno_id !== a.id || r.examen_id !== ex.id) return;
				var c = cfPorPregunta[r.pregunta_id];
				if (c) obt[c] = (obt[c] || 0) + Number(r.puntos_obtenidos || 0);
			});
			var porCampo = {};
			campos.forEach(function (campo) {
				if (max[campo] > 0) porCampo[campo] = Math.min(1, (obt[campo] || 0) / max[campo]);
			});
			salida[a.id] = { porCampo: porCampo, aproximado: true };
		});
		return salida;
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
		cargarYCalcularGrupo: cargarYCalcularGrupo,
	};

	if (typeof window !== "undefined") window.MotorCalificacion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
