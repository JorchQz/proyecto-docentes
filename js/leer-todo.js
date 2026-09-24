/*
	leer-todo.js — Lecturas de Supabase sin el tope de 1000 filas.

	PostgREST devuelve como máximo 1000 filas por consulta y corta EN SILENCIO: una
	pantalla que lee "todo" de una tabla que crece (asistencias de un trimestre, avance por
	PDA de un grupo, respuestas de un examen, el catálogo de PDA de una escuela unitaria)
	se queda sin una parte de los datos sin ningún aviso.

	  LeerTodo.paginas(construir)       → todas las filas; construir() arma la consulta
	                                       (sin .range() y con un orden estable)
	  LeerTodo.porLotes(ids, construir) → igual, partiendo una lista de ids en lotes (la
	                                       lista viaja en la URL); construir(lote)

	Es el mismo patrón que ya usan el motor (`todas()`), js/reporte-datos.js y
	`AlcanceHoy.leerPorLotes` (Hoy, Tareas e Inicio). Un error de Supabase se lanza, nunca
	se traga: mejor un mensaje que una pantalla incompleta que parece completa. El error
	sale marcado como de lectura (`lectura = true`): si nadie lo atrapa, js/lectura.js
	detiene la página con su aviso en vez de dejar una excepción suelta.
*/

(function () {
	"use strict";

	var PAGINA = 1000;
	var LOTE = 150;

	function marcar(error) {
		try { error.lectura = true; } catch (e) {}
		return error;
	}

	async function paginas(construir) {
		var filas = [];
		for (var desde = 0; ; desde += PAGINA) {
			var res = await construir().range(desde, desde + PAGINA - 1);
			if (res.error) throw marcar(res.error);
			var datos = res.data || [];
			filas = filas.concat(datos);
			if (datos.length < PAGINA) return filas;
		}
	}

	async function porLotes(ids, construir) {
		var filas = [];
		for (var i = 0; i < ids.length; i += LOTE) {
			var lote = ids.slice(i, i + LOTE);
			filas = filas.concat(await paginas(function () { return construir(lote); }));
		}
		return filas;
	}

	var api = { PAGINA: PAGINA, LOTE: LOTE, paginas: paginas, porLotes: porLotes };
	if (typeof window !== "undefined") window.LeerTodo = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
