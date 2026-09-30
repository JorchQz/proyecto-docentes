/*
	alcance-hoy.js — Qué proyectos mira "Hoy" (y, para ser coherentes, Inicio y Tareas).

	Un solo lugar para esta regla. Entran los proyectos del grupo que:
	  - siguen en curso: activo, borrador o pausado;
	  - son del trimestre actual del grupo (aunque ya estén terminados);
	  - o se terminaron hace poco (fecha_final en los últimos DIAS_RECIENTES días).
	Así, al terminar la última sesión de un proyecto (Inicio lo pasa a "completado"),
	su tarea y sus productos pendientes siguen apareciendo en "Hoy" hasta revisarse. No
	entran proyectos viejos de otros trimestres: sus sesiones harían crecer sin límite
	las consultas del día (listas de ids en la URL).

	"Trabajar hoy" es otra cosa: solo ofrece sesiones de proyectos ACTIVOS.

	También viven aquí las otras piezas que esas tres pantallas deben compartir para
	decir lo mismo: la lectura de calificaciones sin el tope de 1000 filas (leerPorLotes),
	la cuenta del cierre del día (resumenCierre) y la regla del alumno dado de alta tarde
	(fechaAlta, fechaProducto, cuentaDesdeAlta y, para el examen, examenCuentaDesdeAlta), que
	también usa el motor de calificación.
*/

(function () {
	"use strict";

	var DIAS_RECIENTES = 30;

	/*
		Actividades sueltas (sin proyecto, decisión de Jorge del 2026-09-26): viven en un proyecto
		contenedor por grupo y trimestre con tipo = 'sueltas' ("Actividades del trimestre", estado
		'completado', fecha_final = su última fecha; mi_salon_b17). Entra al alcance de Hoy con la
		regla de siempre (trimestre actual o terminado hace poco) y nunca a "Trabajar hoy", a la
		lista de Proyectos ni a las tarjetas de proyectos activos.
	*/
	var TITULO_SUELTAS = "Actividades del trimestre";
	function esSueltas(proyecto) { return !!(proyecto && proyecto.tipo === "sueltas"); }

	function restarDias(fechaISO, dias) {
		var d = new Date(fechaISO + "T12:00:00");
		d.setDate(d.getDate() - dias);
		return d.toISOString().slice(0, 10);
	}

	// Filtro para .or() de PostgREST sobre la tabla proyectos
	function filtro(grupo, hoyISO) {
		var partes = ["estado.in.(activo,borrador,pausado)", "fecha_final.gte." + restarDias(hoyISO, DIAS_RECIENTES)];
		if (grupo && grupo.trimestre_actual) partes.push("trimestre.eq." + Number(grupo.trimestre_actual));
		return partes.join(",");
	}

	// La misma regla, para un proyecto ya cargado ({estado, trimestre, fecha_final})
	function incluye(proyecto, grupo, hoyISO) {
		if (!proyecto) return false;
		if (["activo", "borrador", "pausado"].indexOf(proyecto.estado) !== -1) return true;
		if (grupo && grupo.trimestre_actual && Number(proyecto.trimestre) === Number(grupo.trimestre_actual)) return true;
		return !!proyecto.fecha_final && proyecto.fecha_final >= restarDias(hoyISO, DIAS_RECIENTES);
	}

	// El calendario SEP (js/calendario-sep.js): en el navegador, el global; en node, require
	function calendario() {
		if (typeof window !== "undefined" && window.CalendarioSEP) return window.CalendarioSEP;
		if (typeof require === "function") {
			try { return require("./calendario-sep"); } catch (e) { /* sin el script */ }
		}
		return null;
	}

	// El siguiente lunes a viernes (la regla de antes; solo si no está js/calendario-sep.js)
	function siguienteHabil(fechaISO) {
		var d = new Date(fechaISO + "T12:00:00");
		do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
		return d.toISOString().slice(0, 10);
	}

	/*
		El siguiente día de clase después de `fecha` (decisión de Jorge del 2026-09-26): calendario
		SEP y ajustes del grupo (calendario_ajustes: [{fecha, tipo, motivo}]). Lo usan el vencimiento
		de las tareas y la revisión de una actividad en clase que quedó incompleta.
	*/
	function siguienteDiaDeClase(fecha, ajustes) {
		if (!fecha) return null;
		var C = calendario();
		return C ? C.siguienteDiaDeClase(fecha, ajustes || []) : siguienteHabil(fecha);
	}

	/*
		Los ajustes del grupo al calendario SEP (calendario_ajustes: días sin clase o con clase del
		grupo). Acotada: una fila por día ajustado del grupo, a lo más los días hábiles de un ciclo.
		Lanza el error: quien llama decide (Hoy, Inicio y Tareas se detienen; Qué le falta sigue con
		el calendario oficial).
	*/
	async function leerAjustesCalendario(sb, maestroId, grupoId) {
		var res = await sb.from("calendario_ajustes").select("fecha, tipo, motivo")
			.eq("maestro_id", maestroId).eq("grupo_id", grupoId).order("fecha");
		if (res.error) throw res.error;
		return res.data || [];
	}

	/*
		Cuándo vence una tarea: su fecha de entrega si la tiene; si no, el siguiente DÍA DE CLASE
		después de la sesión en que se dejó (calendario SEP y ajustes del grupo; antes, el siguiente
		lunes a viernes, sin saltar festivos ni CTE). La tarea de hoy se revisa en la próxima clase,
		no el mismo día. null si la sesión aún no tiene fecha.
		ajustes: filas de calendario_ajustes del grupo (opcional: sin ellas, solo el oficial).
	*/
	function venceTarea(fechaEntrega, fechaSesion, ajustes) {
		if (fechaEntrega) return fechaEntrega;
		if (!fechaSesion) return null;
		return siguienteDiaDeClase(fechaSesion, ajustes);
	}

	/*
		── Para quién es un producto (decisión de Jorge del 2026-09-26) ──
		REGLA ÚNICA (la misma en Hoy, Inicio, Tareas, el motor y Qué le falta; en SQL,
		alumno_recibe_producto de mi_salon_b17): el alumno recibe el producto si (su grado está en
		producto.grados y no está excluido) o está incluido (producto_sesion_alumnos, modo
		'incluir' | 'excluir'); además, la regla del alta tarde (cuentaDesdeAlta). El alumno sigue
		en su grado oficial para la boleta y el examen.
		asignaciones: el índice de indiceAsignaciones { productoId: { alumnoId: modo } }.
	*/
	function indiceAsignaciones(filas) {
		var idx = {};
		(filas || []).forEach(function (f) {
			if (!f || !f.producto_sesion_id || !f.alumno_id) return;
			(idx[f.producto_sesion_id] = idx[f.producto_sesion_id] || {})[f.alumno_id] = f.modo;
		});
		return idx;
	}

	function modoDe(alumno, producto, asignaciones) {
		var p = asignaciones && producto ? asignaciones[producto.id] : null;
		return p && alumno ? p[alumno.id] || null : null;
	}

	function asignadoA(alumno, producto, asignaciones) {
		if (!alumno || !producto) return false;
		var modo = modoDe(alumno, producto, asignaciones);
		if (modo === "incluir") return true;
		if (modo === "excluir") return false;
		return (producto.grados || []).map(Number).indexOf(Number(alumno.grado)) !== -1;
	}

	/*
		recibeProducto(alumno, producto, asignaciones, fechaSesion, cal, alta) → boolean
		alta: la fecha de alta del alumno ("AAAA-MM-DD"); por omisión alumno.alta.
	*/
	function recibeProducto(alumno, producto, asignaciones, fechaSesion, cal, alta) {
		if (!asignadoA(alumno, producto, asignaciones)) return false;
		var a = alta === undefined ? (alumno && alumno.alta) : alta;
		return cuentaDesdeAlta(a || null, fechaProducto(fechaSesion, producto.fecha_entrega), cal);
	}

	/*
		Un alumno incluido de otro grado "trabaja con" el grado de la actividad: → "2°" (o "2° y 3°")
		si está incluido y su grado no es el de la actividad; "" si no.
		gradosPda (opcional): los grados de los PDA ligados al producto. Si los hay, mandan ellos. El
		alumno se evalúa siempre con los PDA de SU grado (decisión de Jorge del 2026-09-27; deja
		evidencia solo en los de su grado, b5): un trabajo por nivel que incluye alumnos de otro grado
		se liga también a los PDA de ese grado, y entonces no hay nota (Morado y Triángulos de
		PP-NIVELES, con PDA de 1° y de 2°: el de 2° se evalúa con los de 2°). Si el producto no tiene
		PDA de su grado, la nota dice con qué grado trabaja ("Trabaja con 1°"). R30, 2026-09-27.
	*/
	function gradosValidos(lista) {
		var vistos = {};
		return (lista || []).map(Number).filter(function (x) {
			if (!(x >= 1 && x <= 6) || vistos[x]) return false;
			vistos[x] = true;
			return true;
		}).sort(function (a, b) { return a - b; });
	}
	function trabajaCon(alumno, producto, asignaciones, gradosPda) {
		if (modoDe(alumno, producto, asignaciones) !== "incluir") return "";
		var dePda = gradosValidos(gradosPda);
		var g = dePda.length ? dePda : gradosValidos(producto.grados);
		if (!g.length || g.indexOf(Number(alumno.grado)) !== -1) return "";
		var t = g.map(function (x) { return x + "°"; });
		return t.length === 1 ? t[0] : t.slice(0, -1).join(", ") + " y " + t[t.length - 1];
	}
	// [{ producto_sesion_id, sesiones_pda: { grado } }] (producto_sesion_pda con su PDA) → { productoId: [grados] }
	function gradosPdaPorProducto(filas) {
		var out = {};
		(filas || []).forEach(function (f) {
			var sp = f && f.sesiones_pda;
			var g = Number(sp && (Array.isArray(sp) ? sp[0] && sp[0].grado : sp.grado));
			if (!f || !f.producto_sesion_id || !(g >= 1 && g <= 6)) return;
			var l = out[f.producto_sesion_id] = out[f.producto_sesion_id] || [];
			if (l.indexOf(g) === -1) l.push(g);
		});
		Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a - b; }); });
		return out;
	}

	/*
		── Actividad en clase "Incompleta" (decisión de Jorge del 2026-09-26) ──
		calificaciones.estado_en_clase: 'incompleta' (pendiente: se revisa el revisar_en) ·
		'completada' (la revisó y la completó) · 'sigue_incompleta' (definitiva). El valor para la
		boleta sale de estado_entrega y nivel como siempre (el motor): pendiente y "sigue
		incompleta" = incompleto sin nivel (0.5); completada = el nivel que logró.
	*/
	function porCompletar(cal) {
		return !!(cal && cal.estado_en_clase === "incompleta");
	}
	// ¿Ya toca revisarla? (sale en "Pendientes de la clase anterior")
	function tocaRevisar(cal, hoyISO) {
		return porCompletar(cal) && !!cal.revisar_en && String(cal.revisar_en).slice(0, 10) <= hoyISO;
	}
	// Lo que se escribe en la calificación en cada paso (los campos del grupo del semáforo)
	function cambiosIncompleta(accion, ctx) {
		ctx = ctx || {};
		// Registro histórico (spec §4.3): en una actividad histórica "Incompleta" NO pasa a la
		// siguiente clase; queda incompleta (0.5) sin revisión pendiente
		if (accion === "marcar" && ctx.historico) {
			return { estado_entrega: "incompleto", nivel: null, estado_en_clase: null, revisar_en: null, completado_en: null };
		}
		/*
			"No entregó" en una actividad en clase (decisión de Jorge del 2026-09-29): también pasa a
			revisión el siguiente día de clase, como Incompleta. Vale 0 (no_entregado) mientras no se
			revise. En el registro histórico no hay revisión: queda como No entregó definitivo.
			(La tarea que se revisa en "Tareas por revisar" no pasa por aquí: ya venció.)
		*/
		if (accion === "no_entregado") {
			if (ctx.historico) {
				return { estado_entrega: "no_entregado", nivel: null, estado_en_clase: null, revisar_en: null, completado_en: null };
			}
			return { estado_entrega: "no_entregado", nivel: null, estado_en_clase: "incompleta",
				revisar_en: siguienteDiaDeClase(ctx.hoy, ctx.ajustes), completado_en: null };
		}
		if (accion === "marcar") {
			return { estado_entrega: "incompleto", nivel: null, estado_en_clase: "incompleta",
				revisar_en: siguienteDiaDeClase(ctx.hoy, ctx.ajustes), completado_en: null };
		}
		if (accion === "completo") {
			return { estado_entrega: "entregado", nivel: ctx.nivel || "logrado", estado_en_clase: "completada", completado_en: ctx.hoy };
		}
		if (accion === "sigue") {
			return { estado_entrega: "incompleto", nivel: null, estado_en_clase: "sigue_incompleta", completado_en: ctx.hoy };
		}
		// "Sigue sin entregar": lo que era No entregó sigue valiendo 0 (no pasa a incompleto: 0.5)
		if (accion === "sigue_sin_entregar") {
			return { estado_entrega: "no_entregado", nivel: null, estado_en_clase: "sigue_incompleta", completado_en: ctx.hoy };
		}
		if (accion === "pendiente") { // deshacer la revisión: vuelve a pendiente
			return { estado_entrega: "incompleto", nivel: null, estado_en_clase: "incompleta", completado_en: null };
		}
		if (accion === "pendiente_no_entregado") { // lo mismo, de algo que era No entregó
			return { estado_entrega: "no_entregado", nivel: null, estado_en_clase: "incompleta", completado_en: null };
		}
		// "quitar": sin la marca de incompleta (lo demás lo decide quien llama)
		return { estado_en_clase: null, revisar_en: null, completado_en: null };
	}

	/*
		Alumno dado de alta tarde (decisión de Jorge del 2026-09-24): para cada alumno solo
		cuentan las tareas y productos con fecha desde su alta, tanto para mostrarlos como
		pendientes (Hoy, Inicio, Tareas) como para su calificación (motor-calificacion.js).

		- Fecha de alta: alumnos.created_at en hora de Ciudad de México. Es la única fecha
		  fiable de la base (no hay columna de ingreso; editar al alumno no la cambia).
		- Solo es "tarde" quien se dio de alta DESPUÉS de crearse su grupo. Los alumnos que
		  nacen con el grupo (la semilla QA crea grupo y alumnos en el mismo instante) no
		  tienen fecha de alta para esta regla: les cuenta todo. Tampoco los que se dieron de
		  alta el mismo día que su grupo (el onboarding los agrega minutos después): una
		  actividad suelta puede ser de un día anterior al grupo (decisión del 2026-09-26).
		- Fecha del producto: la de su sesión, que es el día en que se trabajó o se dejó la
		  tarea (una tarea que se dejó antes de que llegara no se le pidió, aunque venza
		  después). Sin fecha de sesión, la de entrega; sin ninguna, cuenta.
		- Excepción: una calificación FECHADA antes del alta sí cuenta. Es evidencia de que
		  el alumno ya estaba (datos cargados después con su fecha real). Lo que se captura
		  en "Hoy" lleva la fecha del día de captura, así que nunca cae en esta excepción.
	*/
	var FORMATO_CDMX = null;
	// createdAt: alumnos.created_at · grupoCreado: grupos.created_at de su grupo (opcional)
	function fechaAlta(createdAt, grupoCreado) {
		if (!createdAt) return null;
		var d = new Date(createdAt);
		if (isNaN(d.getTime())) return null;
		var g = grupoCreado ? new Date(grupoCreado) : null;
		if (g && !isNaN(g.getTime()) && d.getTime() <= g.getTime()) return null; // nació con el grupo
		try {
			// en-CA da "AAAA-MM-DD"
			if (!FORMATO_CDMX) FORMATO_CDMX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
			/*
				Dado de alta el MISMO día en que se creó su grupo (el alta del onboarding, minutos
				después del grupo): también nació con el grupo. Desde el 2026-09-26 una actividad
				suelta puede ser de un día anterior del trimestre (anterior al grupo): sin esto, a los
				alumnos del primer día no les tocaría la actividad de la semana pasada.
			*/
			if (g && !isNaN(g.getTime()) && FORMATO_CDMX.format(d) === FORMATO_CDMX.format(g)) return null;
			return FORMATO_CDMX.format(d);
		} catch (e) {
			return null; // sin zona horaria disponible no se filtra (lo conservador: no esconder nada)
		}
	}

	function fechaProducto(fechaSesion, fechaEntrega) {
		return fechaSesion || fechaEntrega || null;
	}

	// alta: "AAAA-MM-DD" (fechaAlta) · fecha: fechaProducto · cal: su calificación, si hay
	function cuentaDesdeAlta(alta, fecha, cal) {
		if (!alta || !fecha || fecha >= alta) return true;
		return !!(cal && cal.fecha && String(cal.fecha).slice(0, 10) < alta);
	}

	/*
		El examen del trimestre para un alumno dado de alta tarde (misma decisión 10). Un
		examen no tiene fecha de sesión: su fecha es el instante en que se aplicó (la
		primera respuesta capturada; sin ninguna, cuando se creó el examen). Se compara al
		instante y no por día porque el alta y el examen pueden caer el mismo día.
		- Quien no es de alta tarde (alta null): siempre cuenta, contestara o no.
		- Si el alumno contestó alguna pregunta, cuenta: es evidencia de que lo presentó.
		- Si se aplicó antes de su alta y no lo contestó, no cuenta: el rubro de examen
		  queda sin datos y su peso se reparte entre los demás, como cualquier rubro vacío.
		alta: fechaAlta · altaInstante: alumnos.created_at · fechaExamen: instante ISO
	*/
	function examenCuentaDesdeAlta(alta, altaInstante, fechaExamen, contesto) {
		if (!alta || contesto || !altaInstante || !fechaExamen) return true;
		var a = new Date(altaInstante).getTime(), e = new Date(fechaExamen).getTime();
		if (isNaN(a) || isNaN(e)) return true;
		return e >= a;
	}

	/*
		Lecturas sin tope. Supabase devuelve como máximo 1000 filas por consulta (y corta
		en silencio) y la lista de ids viaja en la URL. leerPorLotes parte los ids en lotes
		y lee cada lote por páginas: con un trimestre completo (decenas de productos por
		18 alumnos) las calificaciones pasan de 1000 filas y no debe perderse ninguna.
		construir(lote) → consulta de Supabase sin .range() y con un orden estable.
	*/
	var PAGINA = 1000;
	var LOTE = 150;
	async function leerPorLotes(ids, construir) {
		var filas = [];
		for (var i = 0; i < ids.length; i += LOTE) {
			var lote = ids.slice(i, i + LOTE);
			for (var desde = 0; ; desde += PAGINA) {
				var res = await construir(lote).range(desde, desde + PAGINA - 1);
				if (res.error) throw res.error;
				var datos = res.data || [];
				filas = filas.concat(datos);
				if (datos.length < PAGINA) break;
			}
		}
		return filas;
	}

	/*
		El cierre del día con una sola cuenta para "Hoy" e Inicio. No se espera cierre de
		quien faltó; si faltó todo el grupo no hay nada que cerrar y el día cuenta como
		cerrado en las dos pantallas.
	*/
	function resumenCierre(totalAlumnos, esperados, guardados) {
		var faltaron = totalAlumnos - esperados;
		var nadieAsistio = totalAlumnos > 0 && esperados === 0;
		return {
			nadieAsistio: nadieAsistio,
			completo: nadieAsistio || (esperados > 0 && guardados >= esperados),
			conteo: guardados + " de " + esperados,
			sinContar: faltaron > 0 ? " (sin contar " + faltaron + (faltaron === 1 ? " que faltó)" : " que faltaron)") : "",
		};
	}

	/*
		"Finalizar jornada" (Fase 3, 2026-10-01): lo que falta al terminar el día. Pura: la pantalla
		(js/hoy.js) le pasa lo que ya calculó con SUS reglas y aquí solo se junta y se cuenta.
		  d.alumnos       [{ id, nombre_completo }] los activos del grupo
		  d.asistencia    { alumnoId: "presente" | "ausente" | "justificada" } la de hoy
		  d.trabajos      [{ id, nombre, alumnos: [alumnoId] }] las actividades de las sesiones de hoy y de las que
		                  siguen en curso, con los alumnos que se califican en pantalla
		  d.tareas        igual, las tareas que se revisan hoy
		  d.calificado    (alumnoId, productoId) → true si ya tiene semáforo, entrega o puntaje
		  d.pendientes    cuántos "pendientes de la clase anterior" y "por falta justificada" siguen sin revisar
		  d.sesiones      [{ id, numero_sesion, titulo }] sesiones empezadas y sin terminar
		Quien faltó hoy (ausente o justificada) NO cuenta como trabajo o tarea sin calificar, salvo que ya
		tenga una calificación (entonces está calificado y tampoco falta). → { asistencia, trabajos, tareas,
		pendientes, sesiones, total, completo, resumen }. `resumen` (solo números) es lo que se guarda en
		jornadas.resumen.
	*/
	function faltantesJornada(d) {
		d = d || {};
		var asis = d.asistencia || {};
		var calificado = typeof d.calificado === "function" ? d.calificado : function () { return false; };
		function faltoHoy(id) { return asis[id] === "ausente" || asis[id] === "justificada"; }
		var nombres = {};
		(d.alumnos || []).forEach(function (a) { nombres[a.id] = a.nombre_completo; });
		var sinAsistencia = (d.alumnos || []).filter(function (a) { return !asis[a.id]; }).map(function (a) { return a.nombre_completo; });
		function sinCalificarDe(lista) {
			var productos = [], n = 0;
			(lista || []).forEach(function (p) {
				var faltan = (p.alumnos || []).filter(function (id) { return !faltoHoy(id) && !calificado(id, p.id); });
				if (!faltan.length) return;
				n += faltan.length;
				productos.push({ id: p.id, nombre: p.nombre, n: faltan.length, alumnos: faltan.map(function (id) { return nombres[id] || ""; }) });
			});
			return { n: n, productos: productos };
		}
		var trabajos = sinCalificarDe(d.trabajos);
		var tareas = sinCalificarDe(d.tareas);
		var pendientes = Math.max(0, Number(d.pendientes) || 0);
		var sesiones = (d.sesiones || []).slice();
		var salida = {
			asistencia: { n: sinAsistencia.length, alumnos: sinAsistencia },
			trabajos: trabajos,
			tareas: tareas,
			pendientes: { n: pendientes },
			sesiones: { n: sesiones.length, lista: sesiones },
		};
		salida.total = salida.asistencia.n + trabajos.n + tareas.n + pendientes + sesiones.length;
		salida.completo = salida.total === 0;
		salida.resumen = {
			asistencia: salida.asistencia.n, trabajos: trabajos.n, tareas: tareas.n,
			pendientes: pendientes, sesiones: sesiones.length,
		};
		return salida;
	}

	/*
		── Registro histórico (spec de Jorge del 2026-09-26, §4.3; mi_salon_b20) ──
		Una captura con fecha anterior al día en que se registró es histórica (es_historico). La
		base la marca (triggers de b20); aquí vive la misma regla para las pantallas:
		  - esFechaHistorica(fecha, instante): fecha < el día (hora de Ciudad de México) del instante.
		  - esHistorico(producto, fechaSesion): la columna es_historico si se leyó; si no, su sesión
		    es de un día anterior al de su creación (created_at).
		  - tareaPorRevisar(producto, vence, hoy, fechaSesion): una tarea vencida que Hoy, Inicio y
		    Tareas piden revisar. Las históricas NO (al ponerse al día aparecerían cientos de
		    pendientes): lo que no se capturó en el registro histórico no se le pide a nadie.
		  - abrirParaCalificar(producto): una actividad suelta de un día pasado entra a Hoy el día en
		    que se agregó (para calificarla al momento), salvo la del asistente Ponte al día, que ya se
		    calificó en su cuadrícula (desde_ponte_al_dia).
	*/
	function diaMexico(instante) {
		if (!instante) return null;
		var d = new Date(instante);
		if (isNaN(d.getTime())) return null;
		try {
			if (!FORMATO_CDMX) FORMATO_CDMX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
			return FORMATO_CDMX.format(d);
		} catch (e) {
			return d.toISOString().slice(0, 10);
		}
	}
	function esFechaHistorica(fecha, instante) {
		var dia = diaMexico(instante);
		return !!(fecha && dia && String(fecha).slice(0, 10) < dia);
	}
	function esHistorico(producto, fechaSesion) {
		if (!producto) return false;
		if (typeof producto.es_historico === "boolean") return producto.es_historico;
		var f = fechaSesion || (producto.sesion && producto.sesion.fecha) || null;
		return esFechaHistorica(f, producto.created_at);
	}
	function tareaPorRevisar(producto, vence, hoyISO, fechaSesion) {
		if (!vence || vence > hoyISO) return false;
		return !esHistorico(producto, fechaSesion);
	}
	function abrirParaCalificar(producto) {
		return !(producto && producto.desde_ponte_al_dia === true);
	}

	/*
		── Faltas (decisiones de Jorge del 2026-09-29) ──
		Todo se DERIVA de la asistencia y de las calificaciones que ya existen; no se guarda nada.
		  - Falta sin justificar (asistencia "ausente"): sus actividades y tareas de ese día cuentan
		    como No entregó (vale 0), mientras el docente no le ponga una calificación. Si después
		    la falta se cambia a Justificada, lo de ese día pasa a pendiente.
		  - Justificada: todo lo de ese día queda pendiente, con 3 días de clase completos desde que
		    regresa (el primer Presente posterior): si regresa el miércoles trabaja miércoles, jueves
		    y viernes y se revisa el lunes (venceFalta). Si se justificó DESPUÉS del regreso, el plazo
		    cuenta desde el día de la justificación (asistencias.updated_at, que la base actualiza al
		    cambiar el estado). Cuenta con el calendario SEP y los ajustes del grupo.
		  - Plazo vencido: sigue pendiente ("venció el…") hasta que el docente califique; no pasa
		    sola a No entregó.
		  - Una calificación del docente siempre manda (sinCalificar). Lo histórico (Ponte al día)
		    no se deriva: solo cuenta lo que el docente capturó (esHistorico).
		"Lo de ese día" de un producto (fechasDeProducto): el día de su sesión (o su fecha de
		entrega, si la sesión no tiene fecha) y, si es una tarea, el día que vence.
		Las asistencias van indexadas (indiceAsistencias): { alumnoId: { "AAAA-MM-DD": { estado,
		actualizada } } }, "actualizada" es el día (hora de México) de asistencias.updated_at.
	*/
	var DIAS_PLAZO_FALTA = 3;

	function indiceAsistencias(filas) {
		var idx = {};
		(filas || []).forEach(function (f) {
			if (!f || !f.alumno_id || !f.fecha) return;
			(idx[f.alumno_id] = idx[f.alumno_id] || {})[String(f.fecha).slice(0, 10)] = {
				estado: f.asistencia_estado || null,
				actualizada: f.updated_at ? diaMexico(f.updated_at) : null,
			};
		});
		return idx;
	}

	// "presente" | "ausente" | "justificada" | null (sin lista ese día) de un alumno ya indexado
	function estadoAsistencia(asisAlumno, fecha) {
		var x = asisAlumno ? asisAlumno[String(fecha || "").slice(0, 10)] : null;
		if (!x) return null;
		return typeof x === "string" ? x : (x.estado || null);
	}

	// El primer Presente DESPUÉS de la falta; null si aún no regresa (o no se pasó lista)
	function regresoDe(asisAlumno, fechaFalta) {
		var falta = String(fechaFalta || "").slice(0, 10);
		var fechas = Object.keys(asisAlumno || {}).sort();
		for (var i = 0; i < fechas.length; i++) {
			if (fechas[i] > falta && estadoAsistencia(asisAlumno, fechas[i]) === "presente") return fechas[i];
		}
		return null;
	}

	// El día desde el que cuenta el plazo si se justificó después de la falta (o el de la falta)
	function diaDeJustificacion(asisAlumno, fechaFalta) {
		var falta = String(fechaFalta || "").slice(0, 10);
		var x = asisAlumno ? asisAlumno[falta] : null;
		if (x && typeof x === "object" && x.estado === "justificada" && x.actualizada && x.actualizada > falta) return x.actualizada;
		return falta;
	}

	/*
		venceFalta(asisAlumno, fechaFalta, ajustes) → "AAAA-MM-DD": el día de clase en que se revisa
		lo de una falta justificada: 3 días de clase después de max(regreso, justificación). Con el
		regreso el miércoles: jueves, viernes y lunes → "lunes". null si aún no regresa.
	*/
	function venceFalta(asisAlumno, fechaFalta, ajustes) {
		var regreso = regresoDe(asisAlumno, fechaFalta);
		if (!regreso) return null;
		var base = regreso;
		var just = diaDeJustificacion(asisAlumno, fechaFalta);
		if (just > base) base = just;
		var C = calendario();
		if (C) return C.diaDeClaseN(base, DIAS_PLAZO_FALTA, ajustes || []);
		var d = base;
		for (var i = 0; i < DIAS_PLAZO_FALTA; i++) d = siguienteHabil(d);
		return d;
	}

	// ¿Sin calificación del docente? (semáforo, estado de entrega o puntaje: lo mismo que "calificado" en Hoy)
	function sinCalificar(cal) {
		return !(cal && (cal.nivel || cal.estado_entrega || (cal.puntaje !== null && cal.puntaje !== undefined && cal.puntaje !== "")));
	}

	// Los días a los que pertenece un producto: el de su sesión (o su entrega) y, si es tarea, el que vence
	function fechasDeProducto(producto, fechaSesion, ajustes) {
		if (!producto) return [];
		var f0 = fechaProducto(fechaSesion || null, producto.fecha_entrega || null);
		var salida = f0 ? [String(f0).slice(0, 10)] : [];
		if (producto.tipo === "tarea") {
			var v = venceTarea(producto.fecha_entrega || null, fechaSesion || null, ajustes);
			if (v && salida.indexOf(String(v).slice(0, 10)) === -1) salida.push(String(v).slice(0, 10));
		}
		return salida;
	}

	/*
		estadoPorAsistencia(producto, fechaSesion, asisAlumno, ajustes) → { estado, fecha } | null
		"ausente" (Falta sin justificar: cuenta como No entregó) o "justificada" (pendiente), y el día
		de esa falta. Si el producto toca dos días con estados distintos, la justificada manda (no se
		castiga con un cero lo que también tiene una falta justificada). null: sin falta en esos días.
		No mira la calificación: quien llama decide con sinCalificar.
	*/
	function estadoPorAsistencia(producto, fechaSesion, asisAlumno, ajustes) {
		var fechas = fechasDeProducto(producto, fechaSesion, ajustes);
		var ausente = null;
		for (var i = 0; i < fechas.length; i++) {
			var e = estadoAsistencia(asisAlumno, fechas[i]);
			if (e === "justificada") return { estado: "justificada", fecha: fechas[i] };
			if (e === "ausente" && !ausente) ausente = { estado: "ausente", fecha: fechas[i] };
		}
		return ausente;
	}

	/*
		pendientesPorFalta(d) → [{ alumno, producto, fechaFalta, regreso, vence }]
		Lo que se le debe a cada alumno por una falta JUSTIFICADA: los trabajos de las sesiones de ese
		día, las tareas que se dejaron y las que vencían ese día; solo lo que recibe (recibeProducto),
		sin calificación y no histórico. vence: venceFalta (null si aún no regresa).
		d = { alumnos: [{id, grado, num_lista, alta}], productos: [{id, tipo, sesion_id, fecha_entrega, grados,
		      sesion: {fecha}, ...}], fechaSesion: { sesionId: fecha } (opcional: por omisión, producto.sesion.fecha),
		      calificaciones: { "alumnoId|productoId": fila }, asignaciones: indiceAsignaciones,
		      asistencias: indiceAsistencias, ajustes: [...] }
	*/
	function pendientesPorFalta(d) {
		d = d || {};
		var salida = [];
		var asis = d.asistencias || {};
		var califs = d.calificaciones || {};
		(d.alumnos || []).forEach(function (a) {
			var suya = asis[a.id];
			if (!suya) return;
			var hayJustificada = Object.keys(suya).some(function (f) { return estadoAsistencia(suya, f) === "justificada"; });
			if (!hayJustificada) return;
			(d.productos || []).forEach(function (p) {
				var fechaSes = (d.fechaSesion && d.fechaSesion[p.sesion_id]) || (p.sesion && p.sesion.fecha) || null;
				var cal = califs[a.id + "|" + p.id];
				if (!sinCalificar(cal)) return;
				if (esHistorico(p, fechaSes)) return;
				var est = estadoPorAsistencia(p, fechaSes, suya, d.ajustes);
				if (!est || est.estado !== "justificada") return;
				if (!recibeProducto(a, p, d.asignaciones || {}, fechaSes, cal)) return;
				salida.push({ alumno: a, producto: p, fechaFalta: est.fecha, regreso: regresoDe(suya, est.fecha), vence: venceFalta(suya, est.fecha, d.ajustes) });
			});
		});
		return salida;
	}

	// "sin_regreso" (aún no vuelve) | "vigente" (le queda plazo, incluido el día que vence) | "vencido"
	function estadoPlazo(vence, hoyISO) {
		if (!vence) return "sin_regreso";
		return vence < hoyISO ? "vencido" : "vigente";
	}

	// Las asistencias del grupo desde una fecha (con updated_at para saber cuándo se justificó). Sin el tope de
	// 1000 filas (por páginas). Lanza el error: quien llama decide (Hoy e Inicio siguen sin esta parte).
	async function leerAsistencias(sb, maestroId, grupoId, desde) {
		return leerPorLotes([grupoId], function (lote) {
			return sb.from("asistencias").select("alumno_id, fecha, asistencia_estado, updated_at")
				.eq("maestro_id", maestroId).eq("grupo_id", lote[0]).gte("fecha", desde || "2000-01-01")
				.order("fecha").order("id");
		});
	}

	// ¿Está el calendario SEP? (el motor de calificación lo EXIGE: sin él, el vencimiento de las tareas cambiaría y la
	// calificación dependería de la pantalla)
	function calendarioDisponible() { return !!calendario(); }

	var api = {
		calendarioDisponible: calendarioDisponible,
		DIAS_RECIENTES: DIAS_RECIENTES, PAGINA: PAGINA, LOTE: LOTE, DIAS_PLAZO_FALTA: DIAS_PLAZO_FALTA,
		indiceAsistencias: indiceAsistencias, estadoAsistencia: estadoAsistencia, regresoDe: regresoDe,
		diaDeJustificacion: diaDeJustificacion, venceFalta: venceFalta, sinCalificar: sinCalificar,
		fechasDeProducto: fechasDeProducto, estadoPorAsistencia: estadoPorAsistencia,
		pendientesPorFalta: pendientesPorFalta, estadoPlazo: estadoPlazo, leerAsistencias: leerAsistencias,
		diaMexico: diaMexico, esFechaHistorica: esFechaHistorica, esHistorico: esHistorico,
		tareaPorRevisar: tareaPorRevisar, abrirParaCalificar: abrirParaCalificar,
		filtro: filtro, incluye: incluye, venceTarea: venceTarea, siguienteDiaDeClase: siguienteDiaDeClase,
		leerAjustesCalendario: leerAjustesCalendario,
		leerPorLotes: leerPorLotes, resumenCierre: resumenCierre, faltantesJornada: faltantesJornada,
		fechaAlta: fechaAlta, fechaProducto: fechaProducto, cuentaDesdeAlta: cuentaDesdeAlta,
		examenCuentaDesdeAlta: examenCuentaDesdeAlta,
		indiceAsignaciones: indiceAsignaciones, asignadoA: asignadoA, recibeProducto: recibeProducto, trabajaCon: trabajaCon, gradosPdaPorProducto: gradosPdaPorProducto,
		porCompletar: porCompletar, tocaRevisar: tocaRevisar, cambiosIncompleta: cambiosIncompleta,
		esSueltas: esSueltas, TITULO_SUELTAS: TITULO_SUELTAS,
	};
	if (typeof window !== "undefined") window.AlcanceHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
