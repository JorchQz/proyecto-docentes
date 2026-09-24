/*
	calendario-escolar.js — ¿Qué trimestre corresponde a una fecha? Solo SUGIERE: el trimestre
	del grupo (grupos.trimestre_actual) lo elige la maestra en Mi grupo; nada aquí lo cambia.

	Fuentes:
	  - Calendario escolar 2026-2027 de la SEP (Acuerdo 07/07/26, DOF 15/07/2026; imagen en
	    docs/referencia/oficiales/calendario_2026_2027_sep.png). "Registro y comunicación de
	    los resultados de la evaluación": 23 a 26 de noviembre de 2026 (T1), 16 a 19 de marzo
	    de 2027 (T2) y 8 a 9 de julio de 2027 (T3). El trimestre sigue siendo el mismo hasta
	    que se comunican sus resultados; al día siguiente empieza el que sigue.
	  - Fuera de un calendario conocido, los periodos del Acuerdo 10/09/23, art. 8: primero
	    del inicio del ciclo a noviembre, segundo de diciembre a marzo, tercero de abril al
	    fin del ciclo.

	Para un ciclo nuevo basta con agregar su calendario a CALENDARIOS.
*/

(function () {
	"use strict";

	var CALENDARIOS = [
		// desde / hasta: el ciclo (con su receso), para no aplicar este calendario a otro ciclo
		{ ciclo: "2026-2027", desde: "2026-08-01", hasta: "2027-07-31", finT1: "2026-11-26", finT2: "2027-03-19" },
	];

	function fechaLocalISO(d) {
		var f = d || new Date();
		return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
	}

	/*
		trimestreSugerido(fechaISO?) → { trimestre: 1|2|3, fuente: "calendario"|"acuerdo",
		                                  ciclo: "2026-2027"|null, texto }
		Sin fecha, hoy (fecha local).
	*/
	function trimestreSugerido(fechaISO) {
		var f = String(fechaISO || fechaLocalISO()).slice(0, 10);
		for (var i = 0; i < CALENDARIOS.length; i++) {
			var c = CALENDARIOS[i];
			if (f < c.desde || f > c.hasta) continue;
			var t = f <= c.finT1 ? 1 : (f <= c.finT2 ? 2 : 3);
			return { trimestre: t, fuente: "calendario", ciclo: c.ciclo,
				texto: "Según el calendario SEP " + c.ciclo + ", hoy corresponde el trimestre " + t + "." };
		}
		var mes = Number(f.slice(5, 7));
		var tt = mes >= 8 && mes <= 11 ? 1 : ((mes === 12 || mes <= 3) ? 2 : 3);
		return { trimestre: tt, fuente: "acuerdo", ciclo: null,
			texto: "Según los periodos de evaluación de la SEP (Acuerdo 10/09/23, art. 8), hoy corresponde el trimestre " + tt + "." };
	}

	var api = { CALENDARIOS: CALENDARIOS, trimestreSugerido: trimestreSugerido, fechaLocalISO: fechaLocalISO };
	if (typeof window !== "undefined") window.CalendarioEscolar = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
