/*
	motor-calificacion.js — ÚNICO motor de calificación del SaaS (B.3).
	Reemplaza a calcCF de reportes.js: no hay una segunda fórmula en ningún otro .js.

	Lee el grano nuevo de Parte A:
	  productos_sesion (qué es calificable, de qué grados, de qué campo)
	  calificaciones   (nivel / puntaje / estado_entrega por alumno y producto)
	  registro_diario  (participación y conducta, una vez al día, global)
	  examenes_grupo + examen_resultados / examen_preguntas + examen_respuestas (exámenes de
	  Mi Salón, b18: aciertos / preguntas por campo, del grado del alumno) y, si existen,
	  examenes + respuestas_examen + banco_preguntas (modelo anterior del catálogo, aproximado)

	Reglas (docs/CONTEXTO.md §3 y docs/PRODUCTO-MI-SALON.md §B.2-B.5):
	  - La ASISTENCIA no pondera nunca (Acuerdo 10/09/23, art. 7 I d). Se calcula solo
	    como dato de referencia.
	  - Pesos en maestro_ajustes (tareas/trabajos/participación/examen). Un peso en 0 es
	    válido y se respeta. Un rubro sin datos no entra y los demás se renormalizan.
	  - La CONDUCTA no pondera (decisión de Jorge del 2026-09-24; LGE art. 21: la conducta
	    se informa aparte de la calificación). Se sigue registrando en el cierre del día y
	    el motor la sigue contando (obtenido, máximo, días) para los textos y los reportes,
	    pero su peso es siempre 0: se reparte como el de cualquier rubro sin datos. Un
	    peso_conducta guardado en maestro_ajustes se ignora (no se borra). Las boletas
	    cerradas no pasan por aquí: conservan su foto con la conducta que tenía.
	  - Máximos automáticos: se cuentan los productos que le tocan al grado del alumno;
	    justificado / no_aplica se descuentan del máximo (no penalizan).
	  - Porcentaje → calificación SOLO con la función SQL calcular_calificacion_boleta
	    (piso por grado, decisión 17b: 6 en 1°, 5 de 2° a 6°). El motor nunca redondea por su cuenta.
	  - Participación y conducta (decisiones de Jorge, 2026-09-24): 1 (normal) y 2
	    (destacado) valen el día completo; 0 vale 0. El 2 se nota en los textos.
	  - Sesiones de varios días (Fase 5b, mi_salon_b27): la participación y la conducta se reparten en CADA día
	    en que se trabajó una sesión (sesion_dias, su fecha, el día en que se terminó) entre sus campos, y una
	    actividad de otro campo suma a su campo en su día. El día de una actividad y de una tarea sale de
	    AlcanceHoy.diaTrabajo / baseTarea; el motor no vuelve a leer sesiones.fecha para eso.
	  - Alumno dado de alta tarde: solo cuentan los productos con fecha desde su alta, y
	    el examen solo si se aplicó desde su alta o si lo contestó
	    (la regla vive en js/alcance-hoy.js; es la misma de Hoy, Inicio y Tareas).

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
	// Rubros que se registran y se informan, pero no entran al porcentaje (peso siempre 0)
	var RUBROS_REFERENCIA = ["conducta"];
	function esReferencia(rubro) { return RUBROS_REFERENCIA.indexOf(rubro) !== -1; }
	// Pesos de fábrica (los mismos DEFAULT de maestro_ajustes); la conducta ya no pondera
	var PESOS_DEFECTO = { tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 33 };

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
		acc.participacion.diario = { dias: 0, destacados: 0, ceros: 0 };
		acc.conducta.diario = { dias: 0, destacados: 0, ceros: 0 };
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
		Valor de un día de participación o de conducta (decisión de Jorge del 2026-09-24):
		1 (normal) y 2 (destacado) valen el día completo; 0 vale 0. El 2 no suma más de
		100 %: se reconoce en los textos de la boleta (js/textos-boleta.js), no en el número.
		null = sin dato ese día (no entra al máximo).
	*/
	function valorDiario(v) {
		if (v === null || v === undefined || v === "") return null;
		return Number(v) >= 1 ? 1 : 0;
	}

	/*
		Reparto de participación y conducta a los campos (B.4): el valor diario del
		alumno se reparte en partes iguales entre los campos con sesión ese día. Un día
		sin sesión registrada, o sin registro_diario, no entra al máximo.
		Además se lleva la cuenta de los días (repartidos igual) en 2 y en 0: la
		calificación no la usa, los textos sí (el 2 se nota como fortaleza).
	*/
	function sumarDiario(rubro, crudo, parte) {
		var valor = valorDiario(crudo);
		if (valor === null) return;
		sumar(rubro, valor * parte, parte);
		rubro.diario.dias += parte;
		if (Number(crudo) >= 2) rubro.diario.destacados += parte;
		if (valor === 0) rubro.diario.ceros += parte;
	}

	function repartirRegistroDiario(registros, camposPorFecha, porCampo) {
		(registros || []).forEach(function (reg) {
			var campos = camposPorFecha[reg.fecha];
			if (!campos || !campos.length) return;
			var parte = 1 / campos.length;
			campos.forEach(function (campo) {
				if (!porCampo[campo]) return;
				sumarDiario(porCampo[campo].participacion, reg.participacion, parte);
				sumarDiario(porCampo[campo].conducta, reg.conducta, parte);
			});
		});
	}

	/*
		Núcleo puro y testeable: de evidencias a porcentaje por campo.

		datos = {
		  campos:           ["LEN","SAB","ETI","DHL"],
		  productos:        [{id, tipo, campo}]            ya filtrados por el grado y el alta del alumno
		  calificaciones:   {producto_sesion_id: {estado_entrega, nivel, puntaje}}
		  registros:        [{fecha, participacion, conducta}]  0, 1 o 2 por día
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
				// La conducta nunca pondera, traiga el peso que traiga
				var peso = esReferencia(r) ? 0 : Number(datos.pesos[r] || 0);
				var fraccion = acc.maximo > 0 ? acc.obtenido / acc.maximo : null;
				rubros[r] = { obtenido: acc.obtenido, maximo: acc.maximo, fraccion: fraccion, peso: peso };
				if (esReferencia(r)) rubros[r].referencia = true;
				if (acc.entrega) rubros[r].entrega = acc.entrega;
				if (acc.diario) rubros[r].diario = acc.diario;
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

	/*
		Alumno dado de alta tarde: la regla vive en js/alcance-hoy.js (una sola, la misma
		de Hoy, Inicio y Tareas). Toda página que carga este motor debe cargar antes
		js/alcance-hoy.js (lo vigila pruebas/alta-tarde.test.js). Si falta, se calcula
		sin la regla y se avisa en consola: no se esconde ninguna evidencia.
	*/
	var avisoSinAlcance = false;
	function alcance() {
		if (typeof window !== "undefined" && window.AlcanceHoy) return window.AlcanceHoy;
		if (typeof require === "function") {
			try { return require("./alcance-hoy.js"); } catch (e) { /* navegador sin el script */ }
		}
		if (!avisoSinAlcance && typeof console !== "undefined") {
			avisoSinAlcance = true;
			console.warn("motor-calificacion: falta js/alcance-hoy.js; se calcula sin la regla del alumno dado de alta tarde");
		}
		return null;
	}

	function cuentaDesdeAlta(alta, fecha, cal) {
		var A = alcance();
		return A ? A.cuentaDesdeAlta(alta, fecha, cal) : true;
	}

	// ¿El alumno recibe el producto? (AlcanceHoy.recibeProducto; sin el script, sus grados y el alta)
	function recibe(alumno, p, asignaciones, fechaSesion, cal, alta) {
		var A = alcance();
		if (A && A.recibeProducto) return A.recibeProducto(alumno, p, asignaciones, fechaSesion || null, cal, alta || null);
		return (p.grados || []).map(Number).indexOf(Number(alumno.grado)) !== -1;
	}

	function fechaProductoDe(p, fechaSesion) {
		var A = alcance();
		return A ? A.fechaDeProducto(p, fechaSesion[p.sesion_id]) : null;
	}

	// { alumnoId: "AAAA-MM-DD" | null }. Si quien llama no trae created_at, se lee aquí.
	// También se lee cuándo se creó el grupo: quien nació con él no es "de alta tarde".
	// instantes (opcional) recibe { alumnoId: created_at } para la regla del examen.
	async function fechasDeAlta(sb, alumnos, grupoId, instantes) {
		var A = alcance();
		var salida = {};
		if (!A || !alumnos.length) return salida;
		var faltan = alumnos.filter(function (a) { return a.created_at === undefined; });
		var creado = {};
		alumnos.forEach(function (a) { if (a.created_at !== undefined) creado[a.id] = a.created_at; });
		if (faltan.length) {
			var filas = await todas(function () {
				return sb.from("alumnos").select("id, created_at")
					.in("id", faltan.map(function (a) { return a.id; })).order("id");
			});
			filas.forEach(function (f) { if (creado[f.id] === undefined) creado[f.id] = f.created_at; });
		}
		var grupoCreado = null;
		var conFecha = alumnos.some(function (a) { return !!creado[a.id]; });
		if (conFecha && grupoId) {
			var grupos = await todas(function () {
				return sb.from("grupos").select("id, created_at").eq("id", grupoId).order("id");
			});
			var g = grupos.filter(function (x) { return x.id === grupoId; })[0];
			grupoCreado = g ? g.created_at : null;
		}
		alumnos.forEach(function (a) {
			salida[a.id] = A.fechaAlta(creado[a.id], grupoCreado);
			if (instantes) instantes[a.id] = creado[a.id] || null;
		});
		return salida;
	}

	async function cargarPesos(sb, maestroId) {
		var ajustesRes = await sb.from("maestro_ajustes").select("*").eq("maestro_id", maestroId).maybeSingle();
		// Sin los pesos del maestro no se calcula con los de fábrica: la boleta guardaría una
		// propuesta con otros pesos sin decirlo
		if (ajustesRes.error) throw ajustesRes.error;
		return pesosDeAjustes(ajustesRes.data);
	}

	/*
		Pesos del maestro (fila de maestro_ajustes o null). peso_conducta se ignora: la
		conducta no pondera. Si solo la conducta tenía peso (los otros cuatro en 0), se
		usan los de fábrica: con todo en 0 ningún campo tendría porcentaje.
	*/
	function pesosDeAjustes(aj) {
		var pesos = {};
		["tareas", "trabajos", "participacion", "examen"].forEach(function (r) {
			var v = aj ? aj["peso_" + r] : null;
			pesos[r] = Number(v !== null && v !== undefined ? v : PESOS_DEFECTO[r]);
		});
		if (!(pesos.tareas + pesos.trabajos + pesos.participacion + pesos.examen > 0)) {
			pesos = Object.assign({}, PESOS_DEFECTO);
		}
		pesos.conducta = 0;
		return pesos;
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
		// Una sola respuesta por alumno en todas las pantallas: el vencimiento de las tareas (y con él las faltas
		// derivadas) usa el calendario SEP. Sin js/calendario-sep.js NO se calcula otra cosa: falla a la vista.
		if (typeof window === "undefined" || !window.CamposFormativos) {
			throw new Error("motor-calificacion: falta js/campos-formativos.js en esta página; sin él la participación y la conducta no se repartirían a los campos y la calificación saldría distinta según la pantalla");
		}
		var AC = alcance();
		if (!AC || !AC.calendarioDisponible || !AC.calendarioDisponible()) {
			throw new Error("motor-calificacion: falta js/calendario-sep.js (y js/alcance-hoy.js) en esta página; sin el calendario la calificación saldría distinta según la pantalla");
		}
		var campos = ctx.campos || ["LEN", "SAB", "ETI", "DHL"];
		var alumnos = (ctx.alumnos || []).map(function (a) { return { id: a.id, grado: Number(a.grado), created_at: a.created_at }; });
		var ids = alumnos.map(function (a) { return a.id; });
		var pesos = await cargarPesos(sb, ctx.maestroId);
		var altaInstante = {};
		var alta = await fechasDeAlta(sb, alumnos, ctx.grupoId, altaInstante);

		// Proyectos del trimestre (proyectos.trimestre es la fuente única) y sus sesiones
		var proyRes = await sb.from("proyectos").select("id, tipo")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre);
		if (proyRes.error) throw proyRes.error;
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });

		/*
			ctx.detalle ("Qué le falta", js/que-le-falta.js): las MISMAS lecturas, con más columnas
			(número de sesión y sus PDA con el texto del catálogo y los productos ligados a cada PDA,
			producto_sesion_pda; nombre del producto). No agrega ninguna petición y la fórmula no
			cambia: solo se devuelve lo que ya se leyó.
		*/
		var detalle = !!ctx.detalle;
		var sesiones = [];
		if (proyIds.length) {
			sesiones = await todas(function () {
				return sb.from("sesiones").select(detalle
					? "id, fecha, terminada_en, estado_sesion, campo_formativo, numero_sesion, proyecto_id, sesiones_pda(id, pda_id, grado, criterio_aplicado, catalogo_pda(pda, catalogo_contenidos(campo_formativo)), producto_sesion_pda(producto_sesion_id))"
					: "id, fecha, terminada_en, estado_sesion, campo_formativo, proyecto_id").in("proyecto_id", proyIds).order("id");
			});
		}
		var sesionIds = sesiones.map(function (s) { return s.id; });
		// Las sueltas llevan su marca desde ya: su día es el de su sesión (AlcanceHoy.diaTrabajo)
		var tiposProyecto = {};
		(proyRes.data || []).forEach(function (p) { tiposProyecto[p.id] = p.tipo; });
		sesiones.forEach(function (s) { if (tiposProyecto[s.proyecto_id] === "sueltas") s.suelta = true; });

		// Los días reales en que se trabajó cada sesión (mi_salon_b27: sesion_dias)
		var diasDeSesion = {};
		if (sesionIds.length) {
			var filasDias = await todas(function () {
				return sb.from("sesion_dias").select("sesion_id, fecha").in("sesion_id", sesionIds).order("id");
			});
			filasDias.forEach(function (d) { (diasDeSesion[d.sesion_id] = diasDeSesion[d.sesion_id] || []).push(String(d.fecha).slice(0, 10)); });
		}

		var productos = [];
		if (sesionIds.length) {
			productos = await todas(function () {
				return sb.from("productos_sesion").select("id, sesion_id, tipo, campo, grados, fecha_entrega, fecha_trabajo, activo, created_at, es_historico" + (detalle ? ", nombre, orden" : ""))
					.in("sesion_id", sesionIds).eq("activo", true).order("id");
			});
		}

		/*
			Campos trabajados por día (para repartir participación y conducta). Cada sesión cuenta con su campo en cada uno
			de sus días (sesion_dias, su fecha y el día en que se terminó) y cada actividad, que no es tarea y tiene día
			(AlcanceHoy.diaTrabajo), con el suyo en SU día: una actividad de otro campo suma a su campo en su día
			(decisión de Jorge del 2026-10-02). Sin repetir un campo en un día. El rango de registro_diario y de las
			asistencias cubre todos esos días.
		*/
		var camposPorFecha = {}, fechaSesion = {};
		var diasTodos = {};
		function marcarDia(dia, codigo) {
			if (!dia) return;
			diasTodos[dia] = true;
			if (!codigo) return;
			var l = camposPorFecha[dia] = camposPorFecha[dia] || [];
			if (l.indexOf(codigo) === -1) l.push(codigo);
		}
		var corto = function (c) { return window.CamposFormativos ? window.CamposFormativos.corto(c) : null; };
		sesiones.forEach(function (s) {
			fechaSesion[s.id] = s; // la sesión entera: AlcanceHoy.diaTrabajo y baseTarea leen sus columnas
			var codigo = corto(s.campo_formativo);
			(diasDeSesion[s.id] || []).forEach(function (d) { marcarDia(d, codigo); });
			marcarDia(s.fecha ? String(s.fecha).slice(0, 10) : null, codigo);
			marcarDia(s.terminada_en ? String(s.terminada_en).slice(0, 10) : null, codigo);
		});
		productos.forEach(function (p) {
			if (p.tipo === "tarea") return;
			var ses = fechaSesion[p.sesion_id];
			var dia = ses ? alcance().diaTrabajo(p, ses) : null;
			if (!dia) return;
			marcarDia(dia, corto(p.campo) || (ses && corto(ses.campo_formativo)));
		});
		var fechas = Object.keys(diasTodos).sort();

		// Para quién es cada producto además de sus grados ("¿Para quién?", producto_sesion_alumnos,
		// mi_salon_b17): las filas de estos alumnos (la regla de cada alumno solo mira las suyas)
		var asignaciones = {};
		if (ids.length && productos.length) {
			var A0 = alcance();
			var filasAsig = await todas(function () {
				return sb.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo")
					.eq("maestro_id", ctx.maestroId).in("alumno_id", ids).order("id");
			});
			asignaciones = A0 ? A0.indiceAsignaciones(filasAsig) : {};
		}

		// Calificaciones de los alumnos en los proyectos del trimestre (nuevas y legacy); con la
		// revisión de una actividad incompleta (estado_en_clase, revisar_en: "Qué le falta")
		var califs = [];
		if (ids.length && proyIds.length) {
			califs = await todas(function () {
				return sb.from("calificaciones")
					.select("alumno_id, producto_sesion_id, tipo, estado_entrega, nivel, puntaje, calificacion, campo_formativo, proyecto_id, fecha, estado_en_clase, revisar_en, completado_en")
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
			// Sin tope superior: para saber cuándo regresó quien faltó (faltas derivadas, más abajo) se
			// necesitan también los días posteriores; la asistencia de REFERENCIA sigue contando solo
			// el rango de las sesiones (ultimaFecha)
			asistencias = await todas(function () {
				return sb.from("asistencias").select("alumno_id, fecha, asistencia_estado, updated_at")
					.eq("maestro_id", ctx.maestroId).in("alumno_id", ids)
					.gte("fecha", fechas[0]).order("id");
			});
		}
		var ultimaFecha = fechas.length ? fechas[fechas.length - 1] : null;

		/*
			Faltas (decisión de Jorge del 2026-09-29; js/alcance-hoy.js, "Faltas"): un producto no
			histórico y sin calificación del docente, de un día en que el alumno tiene FALTA sin
			justificar, vale como No entregó (0). Con Justificada no cuenta mientras esté pendiente
			(ya no entraba al máximo: sin calificación). Una calificación del docente siempre manda.
			Los datos que se derivan (porFalta) también salen en el detalle, para "Qué le falta".
		*/
		var AF = alcance();
		var asistIdx = AF && AF.indiceAsistencias ? AF.indiceAsistencias(asistencias) : {};
		var hayFaltas = !!AF && asistencias.some(function (x) { return x.asistencia_estado === "ausente" || x.asistencia_estado === "justificada"; });
		var ajustesCal = [];
		if (hayFaltas) ajustesCal = await AF.leerAjustesCalendario(sb, ctx.maestroId, ctx.grupoId);

		var examenes = await examenesPorGrado(sb, ctx, alumnos, ids, campos, alta, altaInstante);
		var directas = await leerDirectas(sb, ctx, ids, campos);

		// Por alumno: mismas entradas que la boleta individual
		var porAlumno = {};
		var pendientes = []; // [alumnoId, campo, porcentaje, grado] para convertir en lote
		alumnos.forEach(function (a) {
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
			// Los productos que recibe (REGLA ÚNICA de js/alcance-hoy.js, la misma de Hoy, Inicio,
			// Tareas y Qué le falta: sus grados sin excluirlo, o incluido), y solo los que tienen
			// fecha desde su alta (alumno dado de alta tarde). Sigue en su grado para la boleta.
			var misProductos = productos.filter(function (p) {
				return recibe(a, p, asignaciones, fechaSesion[p.sesion_id], calificaciones[p.id], alta[a.id]);
			});
			var misRegistros = registros.filter(function (r) { return r.alumno_id === a.id; });
			var examen = examenes[a.id] || { porCampo: {}, aproximado: false };

			// Faltas derivadas: sin calificación del docente, un día con falta sin justificar = No entregó (0)
			var porFalta = {}, paraCalcular = calificaciones;
			if (hayFaltas && asistIdx[a.id]) {
				misProductos.forEach(function (p) {
					var cal = calificaciones[p.id];
					if (!AF.sinCalificar(cal)) return;
					var fechaSes = fechaSesion[p.sesion_id] || null;
					if (AF.esHistorico(p, fechaSes)) return;
					var est = AF.estadoPorAsistencia(p, fechaSes, asistIdx[a.id], ajustesCal);
					if (!est) return;
					porFalta[p.id] = { estado: est.estado, fecha: est.fecha, regreso: AF.regresoDe(asistIdx[a.id], est.fecha), vence: AF.venceFalta(asistIdx[a.id], est.fecha, ajustesCal) };
					if (est.estado === "ausente") {
						if (paraCalcular === calificaciones) paraCalcular = Object.assign({}, calificaciones);
						paraCalcular[p.id] = { estado_entrega: "no_entregado", derivada: "falta", fecha: est.fecha };
					}
				});
			}

			var porCampo = calcularPorcentajes({
				campos: campos, productos: misProductos, calificaciones: paraCalcular,
				registros: misRegistros, camposPorFecha: camposPorFecha,
				examenPorCampo: examen.porCampo, legacy: legacy, pesos: pesos,
			});
			// Calificación directa del trimestre (registro histórico, mi_salon_b20): la propuesta es
			// esa calificación y no se recalcula con las actividades (aplicarDirectas)
			aplicarDirectas(porCampo, directas[a.id] || null);
			campos.forEach(function (campo) {
				if (porCampo[campo].directa) return;
				var pct = porCampo[campo].porcentaje;
				porCampo[campo].calificacionPropuesta = null;
				if (pct === null) return;
				// Truncado a 2 decimales, igual que lo que se ve y lo que se guarda en la boleta: un
				// 49.996 se ve "49.9 %", se guarda 49.99 y su calificación y su nivel salen de 49.99
				// (redondear aquí daba 50.00: un 6 que acredita junto a "49.9 %")
				var pct2 = Math.floor(pct * 100 + 1e-9) / 100;
				porCampo[campo].nivel = pct2 >= 80 ? "logrado" : (pct2 >= 60 ? "en_proceso" : "requiere_apoyo");
				pendientes.push([a.id, campo, pct2, a.grado]);
			});

			// Asistencia: SOLO referencia, nunca entra a la fórmula (art. 7 I d)
			var presentes = 0, total = 0;
			asistencias.forEach(function (x) {
				if (x.alumno_id !== a.id || (ultimaFecha && String(x.fecha).slice(0, 10) > ultimaFecha)) return;
				total++;
				if (x.asistencia_estado === "presente" || x.asistencia_estado === "justificada") presentes++;
			});

			porAlumno[a.id] = {
				porCampo: porCampo,
				asistencia: { presentes: presentes, total: total, porcentaje: total ? presentes / total : null },
				usaLegacy: usaLegacy,
				examenAproximado: examen.aproximado,
			};
			// Lo que entró al cálculo de este alumno (sus productos, sus capturas y su alta)
			if (detalle) porAlumno[a.id].detalle = { productos: misProductos, calificaciones: calificaciones, alta: alta[a.id] || null, porFalta: porFalta };
		});

		// Calificación propuesta: SIEMPRE la función SQL (piso por grado), en un solo viaje
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

		var salida = { porAlumno: porAlumno, pesos: pesos, sinProyectos: proyIds.length === 0 };
		if (detalle) {
			// Las sesiones de "Actividades del trimestre" (actividades sueltas, mi_salon_b17) se marcan:
			// "Qué le falta" las nombra por su fecha y no como "sesión N"
			var sueltas = {};
			(proyRes.data || []).forEach(function (p) { if (p.tipo === "sueltas") sueltas[p.id] = true; });
			sesiones.forEach(function (s) { if (sueltas[s.proyecto_id]) s.suelta = true; });
			salida.sesiones = sesiones;
		}
		return salida;
	}

	/*
		── Calificación directa del trimestre (registro histórico; spec de Jorge del 2026-09-26, §4.2;
		supabase/mi_salon_b20_registro_historico_2026-09.sql) ──
		El docente que ya tiene su concentrado en papel o en Excel captura la calificación del
		trimestre por alumno y campo. Es una PROPUESTA que la boleta toma EN LUGAR de la calculada:
		  - calificacionPropuesta = esa calificación (ya validada en la escala del grado por la base;
		    aquí no hay porcentaje que convertir: la conversión sigue siendo solo SQL);
		  - porcentaje = null (no sale de las actividades; el de las actividades queda en
		    porcentajeActividades, solo informativo) y nivel según la calificación, con los mismos
		    cortes de la conversión (9 y 10 = 80 % o más: logrado; 7 y 8 = 60 a 79 %: en proceso;
		    5 y 6: requiere apoyo);
		  - directa = { calificacion, capturado_en }: las pantallas la rotulan "Capturada
		    directamente" (no la boleta impresa).
		La calificación oficial sigue siendo la que el docente confirma en la boleta. Borrar la
		directa vuelve al cálculo automático.
		directas: { LEN: {calificacion, capturado_en}, ... } de un alumno (o null).
	*/
	function nivelDeCalificacion(n) {
		var v = Number(n);
		if (!(v >= 5 && v <= 10)) return null;
		return v >= 9 ? "logrado" : (v >= 7 ? "en_proceso" : "requiere_apoyo");
	}
	function aplicarDirectas(porCampo, directas) {
		if (!porCampo || !directas) return porCampo;
		Object.keys(directas).forEach(function (campo) {
			var d = directas[campo], pc = porCampo[campo];
			if (!pc || !d || d.calificacion === null || d.calificacion === undefined) return;
			var n = Number(d.calificacion);
			pc.directa = { calificacion: n, capturado_en: d.capturado_en || null };
			pc.porcentajeActividades = pc.porcentaje === undefined ? null : pc.porcentaje;
			pc.porcentaje = null;
			pc.nivel = nivelDeCalificacion(n);
			pc.calificacionPropuesta = n;
		});
		return porCampo;
	}
	// { alumnoId: { LEN: {calificacion, capturado_en} } } del grupo y trimestre (sin la tabla: ninguna)
	async function leerDirectas(sb, ctx, ids, campos) {
		var salida = {};
		if (!ids.length) return salida;
		var filas;
		try {
			filas = await todas(function () {
				return sb.from("calificacion_directa").select("alumno_id, campo, calificacion, capturado_en")
					.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre)
					.in("alumno_id", ids).order("id");
			});
		} catch (e) {
			if (!faltaTabla(e)) throw e;
			return salida;
		}
		filas.forEach(function (f) {
			if (campos.indexOf(f.campo) === -1) return;
			(salida[f.alumno_id] = salida[f.alumno_id] || {})[f.campo] = { calificacion: f.calificacion, capturado_en: f.capturado_en };
		});
		return salida;
	}

	// ctx = {maestroId, grupoId, alumnoId, grado, trimestre, campos, detalle} — un alumno
	async function cargarYCalcular(sb, ctx) {
		var r = await cargarYCalcularGrupo(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupoId, trimestre: ctx.trimestre,
			campos: ctx.campos, alumnos: [{ id: ctx.alumnoId, grado: ctx.grado }], detalle: ctx.detalle,
		});
		var a = r.porAlumno[ctx.alumnoId];
		var salida = {
			porCampo: a.porCampo, pesos: r.pesos, asistencia: a.asistencia,
			usaLegacy: a.usaLegacy, examenAproximado: a.examenAproximado,
			sinProyectos: r.sinProyectos,
		};
		if (ctx.detalle) salida.detalle = Object.assign({ sesiones: r.sesiones || [] }, a.detalle);
		return salida;
	}

	/*
		Exámenes de Mi Salón (supabase/mi_salon_b18_examenes_2026-09.sql; decisión de Jorge del
		2026-09-26). Dos caminos, los dos dan ACIERTOS y PREGUNTAS por campo formativo:
		  - 'resultados': la maestra captura, por campo, aciertos de cada alumno (examen_resultados).
		  - 'propio': una pregunta vale 1 (puntosRespuestaExamen). Opción múltiple y verdadero o
		    falso se califican solas contra la clave (vacía o doble marca = 0); completar y
		    abierta, a mano: correcta 1, parcial 0.5, incorrecta 0.
		Solo cuenta lo CAPTURADO: una pregunta sin fila para ese alumno (o una abierta sin
		calificar) no entra ni a favor ni en contra, como un trabajo sin calificar. Un alumno sin
		nada capturado en un examen no tiene ese examen.
	*/
	function puntosRespuestaExamen(pregunta, fila) {
		if (!pregunta || !fila) return null;
		if (pregunta.tipo === "opcion_multiple" || pregunta.tipo === "verdadero_falso") {
			return fila.respuesta && pregunta.clave && String(fila.respuesta).toUpperCase() === String(pregunta.clave).toUpperCase() ? 1 : 0;
		}
		if (fila.resultado === "correcta") return 1;
		if (fila.resultado === "parcial") return 0.5;
		if (fila.resultado === "incorrecta") return 0;
		return null;
	}

	// ¿El alumno está marcado "No presentó" en ese examen? datos.alumnosExamen: filas de examen_alumnos
	function noPresentoExamen(examenId, datos, alumnoId) {
		return ((datos && datos.alumnosExamen) || []).some(function (r) {
			return r.examen_id === examenId && r.alumno_id === alumnoId && r.no_presento === true;
		});
	}

	/*
		aciertosExamenSalon(examen, datos, alumnoId) → { LEN: { aciertos, preguntas } } (solo los
		campos con algo capturado). datos = { preguntas: [{id, examen_id, tipo, campo, clave}],
		respuestas: [{examen_id, pregunta_id, alumno_id, respuesta, resultado}],
		resultados: [{examen_id, alumno_id, campo, preguntas, aciertos}] }
	*/
	function aciertosExamenSalon(examen, datos, alumnoId) {
		var salida = {};
		// "No presentó" (mi_salon_b19): ese examen no cuenta ni a favor ni en contra, aunque tenga algo capturado
		if (noPresentoExamen(examen.id, datos, alumnoId)) return salida;
		function sumar2(campo, a, p) {
			if (!salida[campo]) salida[campo] = { aciertos: 0, preguntas: 0 };
			salida[campo].aciertos += a;
			salida[campo].preguntas += p;
		}
		if (examen.modo === "resultados") {
			(datos.resultados || []).forEach(function (r) {
				if (r.examen_id !== examen.id || r.alumno_id !== alumnoId) return;
				var p = Number(r.preguntas), a = Number(r.aciertos);
				if (!(p > 0) || isNaN(a)) return;
				sumar2(r.campo, Math.max(0, Math.min(p, a)), p);
			});
			return salida;
		}
		var porPregunta = {};
		(datos.respuestas || []).forEach(function (r) {
			if (r.examen_id === examen.id && r.alumno_id === alumnoId) porPregunta[r.pregunta_id] = r;
		});
		(datos.preguntas || []).forEach(function (p) {
			if (p.examen_id !== examen.id) return;
			var v = puntosRespuestaExamen(p, porPregunta[p.id]);
			if (v === null) return;
			sumar2(p.campo, v, 1);
		});
		return salida;
	}

	// La tabla aún no existe (frontend publicado antes que la migración b18): sin exámenes nuevos
	function faltaTabla(error) {
		return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || ""));
	}

	async function leerExamenesSalon(sb, ctx, ids) {
		var vacio = { examenes: [], preguntas: [], respuestas: [], resultados: [], alumnosExamen: [] };
		var exRes = await sb.from("examenes_grupo").select("id, modo, grados, trimestre, created_at")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre).order("id");
		if (exRes.error) { if (faltaTabla(exRes.error)) return vacio; throw exRes.error; }
		var examenes = exRes.data || [];
		if (!examenes.length || !ids.length) return Object.assign(vacio, { examenes: examenes });
		var propios = examenes.filter(function (e) { return e.modo === "propio"; }).map(function (e) { return e.id; });
		var deResultados = examenes.filter(function (e) { return e.modo === "resultados"; }).map(function (e) { return e.id; });
		var preguntas = [], respuestas = [], resultados = [], alumnosExamen = [];
		// "No presentó" (mi_salon_b19; sin la tabla, nadie está marcado)
		var todosIds = examenes.map(function (e) { return e.id; });
		try {
			alumnosExamen = await todas(function () {
				return sb.from("examen_alumnos").select("examen_id, alumno_id, no_presento")
					.in("examen_id", todosIds).in("alumno_id", ids).eq("no_presento", true).order("id");
			});
		} catch (e) {
			if (!faltaTabla(e)) throw e;
			alumnosExamen = [];
		}
		if (propios.length) {
			preguntas = await todas(function () {
				return sb.from("examen_preguntas").select("id, examen_id, tipo, campo, clave").in("examen_id", propios).order("id");
			});
			respuestas = await todas(function () {
				return sb.from("examen_respuestas").select("examen_id, pregunta_id, alumno_id, respuesta, resultado")
					.in("examen_id", propios).in("alumno_id", ids).order("id");
			});
		}
		if (deResultados.length) {
			resultados = await todas(function () {
				return sb.from("examen_resultados").select("examen_id, alumno_id, campo, preguntas, aciertos")
					.in("examen_id", deResultados).in("alumno_id", ids).order("id");
			});
		}
		return { examenes: examenes, preguntas: preguntas, respuestas: respuestas, resultados: resultados, alumnosExamen: alumnosExamen };
	}

	/*
		Examen del trimestre, por campo, para cada alumno: los exámenes de Mi Salón de su grado
		(todos los del trimestre, sumando aciertos y preguntas) y, si hay datos del modelo
		anterior (catálogo: examenes + respuestas_examen + banco_preguntas), también el de su
		grado, que cuenta como tantas preguntas como tenía en ese campo.
		→ { alumnoId: { porCampo: {LEN: 0..1}, aproximado, aciertos: {LEN: {aciertos, preguntas}} } }
		aproximado solo si entró el examen del modelo anterior.
	*/
	async function examenesPorGrado(sb, ctx, alumnos, ids, campos, alta, altaInstante) {
		var viejos = await examenesAnteriores(sb, ctx, alumnos, ids, campos, alta, altaInstante);
		var nuevos = await leerExamenesSalon(sb, ctx, ids);
		var salida = {};
		alumnos.forEach(function (a) {
			var acc = {}, aproximado = false;
			var viejo = viejos[a.id];
			if (viejo) {
				campos.forEach(function (c) {
					var n = viejo.preguntas[c];
					if (!(n > 0) || viejo.porCampo[c] === undefined) return;
					acc[c] = { aciertos: viejo.porCampo[c] * n, preguntas: n };
					aproximado = true;
				});
			}
			nuevos.examenes.forEach(function (ex) {
				if ((ex.grados || []).map(Number).indexOf(a.grado) === -1) return;
				var r = aciertosExamenSalon(ex, nuevos, a.id);
				Object.keys(r).forEach(function (c) {
					if (campos.indexOf(c) === -1) return;
					if (!acc[c]) acc[c] = { aciertos: 0, preguntas: 0 };
					acc[c].aciertos += r[c].aciertos;
					acc[c].preguntas += r[c].preguntas;
				});
			});
			var porCampo = {};
			Object.keys(acc).forEach(function (c) {
				if (acc[c].preguntas > 0) porCampo[c] = Math.min(1, acc[c].aciertos / acc[c].preguntas);
			});
			if (Object.keys(porCampo).length) salida[a.id] = { porCampo: porCampo, aproximado: aproximado, aciertos: acc };
		});
		return salida;
	}

	/*
		Modelo ANTERIOR (catálogo, ya no se ofrece en Mi Salón; sus datos se siguen leyendo).
		Examen del trimestre DEL GRADO DE CADA ALUMNO (en multigrado hay un examen por
		grado; tomar cualquiera mezclaba grados). Si hay varios del mismo grado, manda el
		más reciente. Solo los exámenes DEL GRUPO: una maestra con dos grupos del mismo
		grado tiene un examen en cada uno. Limitación conocida: banco_preguntas no guarda el
		valor de cada pregunta, así que el máximo por campo se aproxima como
		valor_total / total_preguntas.

		Alumno dado de alta tarde (decisión 10; la regla vive en js/alcance-hoy.js,
		examenCuentaDesdeAlta): si el examen se aplicó antes de su alta y no lo contestó, no
		le cuenta; el alumno queda sin examen y el rubro se reparte como cualquier rubro
		sin datos. alta = {id: "AAAA-MM-DD" | null}, altaInstante = {id: created_at}.
		→ { alumnoId: { porCampo: {LEN: 0..1}, preguntas: {LEN: n}, aproximado } }
	*/
	async function examenesAnteriores(sb, ctx, alumnos, ids, campos, alta, altaInstante) {
		alta = alta || {};
		altaInstante = altaInstante || {};
		var salida = {};
		var grados = [];
		alumnos.forEach(function (a) { if (grados.indexOf(a.grado) === -1) grados.push(a.grado); });
		if (!grados.length) return salida;

		var exRes = await sb.from("examenes")
			.select("id, preguntas_ids, valor_total, total_preguntas, grado, created_at")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupoId).eq("trimestre", ctx.trimestre)
			.in("grado", grados).order("created_at", { ascending: false });
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

		// Fecha de aplicación de cada examen (primera respuesta capturada de cualquier
		// alumno; sin ninguna, su creación). Solo se lee si hay un alumno de alta tarde que
		// no lo contestó: para los demás el examen cuenta siempre.
		var contesto = {};
		respuestas.forEach(function (r) { contesto[r.alumno_id + "|" + r.examen_id] = true; });
		var aplicado = {};
		for (var i = 0; i < alumnos.length; i++) {
			var al = alumnos[i], exA = porGrado[al.grado];
			if (!exA || !alta[al.id] || contesto[al.id + "|" + exA.id] || aplicado[exA.id] !== undefined) continue;
			var primera = await sb.from("respuestas_examen").select("created_at")
				.eq("examen_id", exA.id).order("created_at", { ascending: true }).range(0, 0);
			if (primera.error) throw primera.error;
			aplicado[exA.id] = ((primera.data || [])[0] || {}).created_at || exA.created_at || null;
		}
		var A = alcance();

		alumnos.forEach(function (a) {
			var ex = porGrado[a.grado];
			if (!ex || !(ex.preguntas_ids || []).length) return;
			if (A && alta[a.id] && !A.examenCuentaDesdeAlta(alta[a.id], altaInstante[a.id],
				aplicado[ex.id], !!contesto[a.id + "|" + ex.id])) return; // se aplicó antes de que llegara
			var valor = (ex.valor_total && ex.total_preguntas) ? Number(ex.valor_total) / Number(ex.total_preguntas) : 1;
			var max = {}, obt = {}, cuantas = {};
			ex.preguntas_ids.forEach(function (id) {
				var c = cfPorPregunta[id];
				if (c) { max[c] = (max[c] || 0) + valor; cuantas[c] = (cuantas[c] || 0) + 1; }
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
			salida[a.id] = { porCampo: porCampo, preguntas: cuantas, aproximado: true };
		});
		return salida;
	}

	/*
		Peso EFECTIVO (solo presentación; el cálculo no cambia): los pesos de Ajustes son
		relativos y un rubro sin datos no entra, así que lo que valió cada rubro en un cálculo
		es su peso entre la suma de los que sí entraron. Con los de fábrica (28, 28, 6 y 33,
		que suman 95) y los cuatro con datos: 29.5, 29.5, 6.3 y 34.7. Con un decimal y sumando
		exactamente 100 (resto mayor), para que la maestra nunca vea una suma de 95 o de 99.9.

		repartoEntero({rubro: peso}) → {rubro: porcentaje con un decimal} con los pesos > 0;
		null si ninguno.
		pesosEfectivos(rubros) → lo mismo con los rubros de un campo del motor o de la foto
		del cierre ({rubro: {fraccion, peso}}): cuentan los que tienen datos (fraccion) y peso.
	*/
	function repartoEntero(pesos) {
		var claves = RUBROS.filter(function (r) { return pesos && Number(pesos[r]) > 0; });
		var suma = claves.reduce(function (a, r) { return a + Number(pesos[r]); }, 0);
		if (!(suma > 0)) return null;
		var salida = {}, repartido = 0;
		var restos = claves.map(function (r) {
			// En décimas: 1000 décimas = 100 %
			var exacto = Number(pesos[r]) / suma * 1000;
			salida[r] = Math.floor(exacto + 1e-9);
			repartido += salida[r];
			return { r: r, resto: exacto - salida[r] };
		});
		/*
			Las décimas que faltan para 100 % van a los restos mayores, por grupos de rubros
			con el MISMO peso: dos rubros con el mismo peso nunca se ven distintos (tareas 45.1
			y trabajos 45.2) si se puede evitar. Si ningún grupo cabe en lo que falta (tres
			pesos iguales), va al primero en el orden de RUBROS: la suma manda.
		*/
		while (repartido < 1000) {
			var falta = 1000 - repartido, elegido = null;
			restos.forEach(function (x) {
				var grupo = restos.filter(function (y) { return Number(pesos[y.r]) === Number(pesos[x.r]); });
				if (grupo.length > falta) return;
				if (!elegido || x.resto > elegido.resto + 1e-9) elegido = { resto: x.resto, grupo: grupo };
			});
			if (!elegido) {
				var mayor = restos.slice().sort(function (a, b) { return (b.resto - a.resto) || (RUBROS.indexOf(a.r) - RUBROS.indexOf(b.r)); })[0];
				elegido = { grupo: [mayor] };
			}
			elegido.grupo.forEach(function (y) { salida[y.r]++; y.resto -= 1; repartido++; });
		}
		claves.forEach(function (r) { salida[r] = salida[r] / 10; });
		return salida;
	}

	function pesosEfectivos(rubros) {
		var pesos = {};
		RUBROS.forEach(function (r) {
			var x = rubros ? rubros[r] : null;
			if (x && x.fraccion !== null && x.fraccion !== undefined && !isNaN(x.fraccion) && Number(x.peso) > 0) pesos[r] = Number(x.peso);
		});
		return repartoEntero(pesos);
	}

	var api = {
		ESCALA_NIVEL: ESCALA_NIVEL,
		repartoEntero: repartoEntero,
		pesosEfectivos: pesosEfectivos,
		RUBROS: RUBROS,
		RUBROS_REFERENCIA: RUBROS_REFERENCIA,
		esReferencia: esReferencia,
		PESOS_DEFECTO: PESOS_DEFECTO,
		pesosDeAjustes: pesosDeAjustes,
		ETIQUETA_RUBRO: {
			tareas: "Tareas", trabajos: "Trabajos", participacion: "Participación",
			conducta: "Conducta", examen: "Examen",
		},
		rubroDeProducto: rubroDeProducto,
		puntajeProducto: puntajeProducto,
		puntosRespuestaExamen: puntosRespuestaExamen,
		aciertosExamenSalon: aciertosExamenSalon,
		noPresentoExamen: noPresentoExamen,
		calcularPorcentajes: calcularPorcentajes,
		aplicarDirectas: aplicarDirectas,
		nivelDeCalificacion: nivelDeCalificacion,
		cargarYCalcular: cargarYCalcular,
		cargarYCalcularGrupo: cargarYCalcularGrupo,
	};

	if (typeof window !== "undefined") window.MotorCalificacion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
