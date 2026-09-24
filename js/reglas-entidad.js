/*
	reglas-entidad.js — Punto único de las reglas de evaluación que podrían cambiar según
	el estado de la maestra (decisión 21 de Jorge, 2026-09-24; perfiles.estado).

	Hoy TODAS las entidades usan la regla nacional (no hay variantes activas):
	  - Escala por GRADO (decisión 17b, reemplaza a la 17): 1° de 6 a 10 (se acredita con
	    haberlo cursado); 2° a 6° de 5 a 10, con 5 no aprobatorio. Antes iba por fase y la
	    Fase 3 (1° y 2°) usaba 6 a 10; por eso nada debe decidir la escala por fase.
	    La base aplica el mismo piso: piso_calificacion_boleta, calcular_calificacion_boleta
	    y el trigger boleta_trimestral_piso_fase (supabase/mi_salon_b11_escala_2_2026-09.sql).
	    Si esto cambia, cambia también allá.
	  - Acreditación del grado (decisión 18b, art. 9 del Acuerdo 10/09/23): 1° con haberlo
	    cursado; de 2° a 6°, "Acredita" si el promedio final de grado y las cuatro finales
	    por campo llegan a 6; "Revisar" si el promedio llega pero algún campo no (algunas
	    entidades exigen 6 en cada campo; se confirma con control escolar); "No acredita"
	    solo si el promedio es menor que 6. La aplica ReporteDatos.finalCiclo.
	  - Promedios con un entero y un decimal, truncados (ReporteDatos.promedioTruncado).

	Para activar la variante de un estado (en el futuro, con la norma de su control escolar):
	  1. agregarla en VARIANTES con el nombre de js/entidades.js como llave, copiando la
	     nacional y cambiando solo lo que difiere;
	  2. pasar el estado de la maestra (ReporteDatos.contexto ya lo lee: ctx.estado) a
	     regla(estado) donde hoy se llama regla() sin estado;
	  3. si cambia el piso, cambiar también piso_calificacion_boleta (hoy no recibe estado).
*/

(function () {
	"use strict";

	function gradoValido(grado) {
		if (grado === null || grado === undefined || grado === "") return null;
		var g = Number(grado);
		return g >= 1 && g <= 6 && Math.floor(g) === g ? g : null;
	}

	var NACIONAL = {
		clave: "nacional",
		// Calificación mínima de la escala del grado (null sin grado válido)
		pisoDeGrado: function (grado) {
			var g = gradoValido(grado);
			if (g === null) return null;
			return g === 1 ? 6 : 5;
		},
		/*
			Escala del grado en una frase, para rotular ("Enteros de " + esto):
			1° → "6 a 10; 1° se acredita con haberlo cursado"
			2° a 6° → "5 a 10; 5 no es aprobatoria"
		*/
		escalaDeGrado: function (grado) {
			var g = gradoValido(grado);
			if (g === null) return "";
			return g === 1 ? "6 a 10; 1° se acredita con haberlo cursado" : "5 a 10; 5 no es aprobatoria";
		},
		// Calificación más baja que aprueba (el 5 de 2° a 6° no es aprobatorio)
		minimoAprobatorio: 6,
		acreditacion: {
			primeroConCursar: true, // 1° se acredita con haber cursado el grado
			promedioMinimo: 6,      // promedio final de grado mínimo (debajo: "No acredita")
			campoMinimo: 6,         // final por campo mínima (debajo, con promedio suficiente: "Revisar")
		},
		promedios: { decimales: 1, modo: "truncar" },
	};

	// Variantes por estado (llave: nombre de js/entidades.js). Ninguna activa.
	var VARIANTES = {};

	// La regla de un estado; sin estado o sin variante, la nacional
	function regla(estado) {
		return (estado && VARIANTES[estado]) || NACIONAL;
	}

	var api = {
		NACIONAL: NACIONAL,
		regla: regla,
		tieneVariante: function (estado) { return !!(estado && VARIANTES[estado]); },
	};
	if (typeof window !== "undefined") window.ReglasEntidad = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
