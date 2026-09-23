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

	También viven aquí las otras dos piezas que esas tres pantallas deben compartir para
	decir lo mismo: la lectura de calificaciones sin el tope de 1000 filas (leerPorLotes)
	y la cuenta del cierre del día (resumenCierre).
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
	};
	if (typeof window !== "undefined") window.AlcanceHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
