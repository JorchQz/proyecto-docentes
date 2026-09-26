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
	*/
	function trabajaCon(alumno, producto, asignaciones) {
		if (modoDe(alumno, producto, asignaciones) !== "incluir") return "";
		var g = (producto.grados || []).map(Number).filter(function (x) { return x >= 1 && x <= 6; }).sort(function (a, b) { return a - b; });
		if (!g.length || g.indexOf(Number(alumno.grado)) !== -1) return "";
		var t = g.map(function (x) { return x + "°"; });
		return t.length === 1 ? t[0] : t.slice(0, -1).join(", ") + " y " + t[t.length - 1];
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
		if (accion === "pendiente") { // deshacer la revisión: vuelve a pendiente
			return { estado_entrega: "incompleto", nivel: null, estado_en_clase: "incompleta", completado_en: null };
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

	var api = {
		DIAS_RECIENTES: DIAS_RECIENTES, PAGINA: PAGINA, LOTE: LOTE,
		filtro: filtro, incluye: incluye, venceTarea: venceTarea, siguienteDiaDeClase: siguienteDiaDeClase,
		leerAjustesCalendario: leerAjustesCalendario,
		leerPorLotes: leerPorLotes, resumenCierre: resumenCierre,
		fechaAlta: fechaAlta, fechaProducto: fechaProducto, cuentaDesdeAlta: cuentaDesdeAlta,
		examenCuentaDesdeAlta: examenCuentaDesdeAlta,
		indiceAsignaciones: indiceAsignaciones, asignadoA: asignadoA, recibeProducto: recibeProducto, trabajaCon: trabajaCon,
		porCompletar: porCompletar, tocaRevisar: tocaRevisar, cambiosIncompleta: cambiosIncompleta,
		esSueltas: esSueltas, TITULO_SUELTAS: TITULO_SUELTAS,
	};
	if (typeof window !== "undefined") window.AlcanceHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
