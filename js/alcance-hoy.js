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
	(fechaAlta, fechaProducto, cuentaDesdeAlta), que también usa el motor de calificación.
*/

(function () {
	"use strict";

	var DIAS_RECIENTES = 30;

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

	/*
		Cuándo vence una tarea: su fecha de entrega si la tiene; si no, el siguiente día
		hábil después de la sesión en que se dejó (la tarea de hoy se revisa en la próxima
		clase, no el mismo día). null si la sesión aún no tiene fecha.
	*/
	function venceTarea(fechaEntrega, fechaSesion) {
		if (fechaEntrega) return fechaEntrega;
		if (!fechaSesion) return null;
		var d = new Date(fechaSesion + "T12:00:00");
		do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
		return d.toISOString().slice(0, 10);
	}

	/*
		Alumno dado de alta tarde (decisión de Jorge del 2026-09-24): para cada alumno solo
		cuentan las tareas y productos con fecha desde su alta, tanto para mostrarlos como
		pendientes (Hoy, Inicio, Tareas) como para su calificación (motor-calificacion.js).

		- Fecha de alta: alumnos.created_at en hora de Ciudad de México. Es la única fecha
		  fiable de la base (no hay columna de ingreso; editar al alumno no la cambia).
		- Solo es "tarde" quien se dio de alta DESPUÉS de crearse su grupo. Los alumnos que
		  nacen con el grupo (la semilla QA crea grupo y alumnos en el mismo instante) no
		  tienen fecha de alta para esta regla: les cuenta todo. En el uso real no cambia
		  nada, porque ninguna sesión puede tener fecha anterior a su grupo.
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
		filtro: filtro, incluye: incluye, venceTarea: venceTarea,
		leerPorLotes: leerPorLotes, resumenCierre: resumenCierre,
		fechaAlta: fechaAlta, fechaProducto: fechaProducto, cuentaDesdeAlta: cuentaDesdeAlta,
	};
	if (typeof window !== "undefined") window.AlcanceHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
