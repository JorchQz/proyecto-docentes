/*
	examen-plantilla.js — Reglas de "Exámenes" que no dependen de la pantalla (se prueban en node:
	pruebas/examen-plantilla.test.js).

	Bug (R23, 2026-09-26): "Aplicar este examen" le ponía maestro_id y grupo_id a la fila del
	CATÁLOGO (la plantilla, maestro_id null). La plantilla quedaba "reclamada" por la primera
	cuenta que la aplicaba y dejaba de verse para todas las demás (RLS: se ven las propias y las
	de maestro_id null).
	Ahora aplicar COPIA la plantilla: una fila nueva con maestro_id y grupo_id de la maestra; la
	plantilla sigue en el catálogo para todas. No hace falta migración: la política "examenes
	insertar propios" (maestro_id = auth.uid()) y examenes_refs_propias_ins (su grupo) ya lo
	permiten. Las respuestas (respuestas_examen) cuelgan del id de la copia.
	Lo ya reclamado antes de este arreglo se queda como está (tiene respuestas de esa cuenta).
*/

(function () {
	"use strict";

	var CAMPOS_COPIA = ["ciclo_escolar", "trimestre", "fase", "grado", "titulo", "instrucciones",
		"preguntas_ids", "total_preguntas", "valor_total", "tiempo_minutos", "link_documento"];

	// Fila nueva de examenes para aplicar una plantilla del catálogo en un grupo
	function copiaDeExamen(plantilla, maestroId, grupoId) {
		var fila = { maestro_id: maestroId, grupo_id: grupoId, estado: "publicado" };
		CAMPOS_COPIA.forEach(function (k) { if (plantilla && k in plantilla && plantilla[k] !== undefined) fila[k] = plantilla[k]; });
		return fila;
	}

	// Misma plantilla = mismo título, grado, trimestre y preguntas (la copia no guarda de cuál salió)
	function llave(ex) {
		return [String(ex.titulo || "").trim(), ex.grado, ex.trimestre, (ex.preguntas_ids || []).join(",")].join("|");
	}

	/*
		visibles(lista, userId, grupoId) → lo que se muestra en la lista del grupo activo:
		  - las plantillas del catálogo (maestro_id null) que esta maestra no ha aplicado en este grupo;
		  - sus exámenes aplicados en este grupo (con grupo_id del grupo; sin grupo, también).
		Los de otra cuenta nunca (RLS ya no los trae) y los suyos de otro grupo tampoco.
	*/
	function visibles(lista, userId, grupoId) {
		var propios = (lista || []).filter(function (ex) {
			return ex && ex.maestro_id && ex.maestro_id === userId && (!grupoId || !ex.grupo_id || ex.grupo_id === grupoId);
		});
		var aplicadas = {};
		propios.forEach(function (ex) { aplicadas[llave(ex)] = true; });
		var plantillas = (lista || []).filter(function (ex) { return ex && !ex.maestro_id && !aplicadas[llave(ex)]; });
		return propios.concat(plantillas);
	}

	var api = { CAMPOS_COPIA: CAMPOS_COPIA, copiaDeExamen: copiaDeExamen, visibles: visibles };
	if (typeof window !== "undefined") window.ExamenPlantilla = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
