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

	var api = { DIAS_RECIENTES: DIAS_RECIENTES, filtro: filtro, incluye: incluye, venceTarea: venceTarea };
	if (typeof window !== "undefined") window.AlcanceHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
