/*
	campos-formativos.js — Único lugar donde vive la equivalencia entre el nombre
	largo de cada campo formativo (como lo guardan calificaciones, dosificacion_* y
	banco_preguntas) y el código corto (como lo guardan las tablas nuevas:
	boleta_trimestral, productos_sesion).

	El mapeo se aplica al ESCRIBIR en tablas nuevas (importador, crear_proyecto),
	nunca al leer: así las tablas nuevas quedan siempre limpias con el código corto.

	Códigos: LEN, SAB, ETI, DHL. El alias histórico "HUM" equivale a DHL.
	Si algún día se agrega un quinto campo formativo, se agrega aquí y en la
	documentación de docs/CONTEXTO.md §6 — en ningún otro lado.
*/

(function () {
	"use strict";

	var LARGO_A_CORTO = {
		"Lenguajes": "LEN",
		"Saberes y Pensamiento Científico": "SAB",
		"Ética, Naturaleza y Sociedades": "ETI",
		"De lo Humano y lo Comunitario": "DHL",
	};

	var CORTO_A_LARGO = {
		LEN: "Lenguajes",
		SAB: "Saberes y Pensamiento Científico",
		ETI: "Ética, Naturaleza y Sociedades",
		DHL: "De lo Humano y lo Comunitario",
		HUM: "De lo Humano y lo Comunitario", // alias histórico
	};

	// Normaliza para comparar variantes sin acento vistas en datos reales
	// (p. ej. "Etica, Naturaleza y Sociedades")
	function sinAcentos(s) {
		return String(s || "").toLowerCase()
			.replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
			.replace(/ó/g, "o").replace(/ú/g, "u").replace(/ü/g, "u");
	}

	/*
		corto("Lenguajes") -> "LEN"
		corto("LEN") -> "LEN" (ya es código)
		corto("HUM") -> "DHL"
		Texto sucio con varios campos: devuelve el primero que aparezca en el string.
		Sin coincidencia: null (el llamador decide su fallback).
	*/
	function corto(campoLargo) {
		if (!campoLargo) return null;
		var v = String(campoLargo).trim();
		var mayus = v.toUpperCase();
		if (CORTO_A_LARGO[mayus]) {
			return mayus === "HUM" ? "DHL" : mayus;
		}
		if (LARGO_A_CORTO[v]) return LARGO_A_CORTO[v];
		var vNorm = sinAcentos(v);
		var encontrado = null;
		var mejorPos = Infinity;
		Object.keys(LARGO_A_CORTO).forEach(function (largo) {
			var pos = vNorm.indexOf(sinAcentos(largo));
			if (pos !== -1 && pos < mejorPos) {
				mejorPos = pos;
				encontrado = LARGO_A_CORTO[largo];
			}
		});
		return encontrado;
	}

	function largo(codigo) {
		return CORTO_A_LARGO[String(codigo || "").toUpperCase()] || null;
	}

	window.CamposFormativos = {
		LARGO_A_CORTO: LARGO_A_CORTO,
		CORTO_A_LARGO: CORTO_A_LARGO,
		CODIGOS: ["LEN", "SAB", "ETI", "DHL"],
		corto: corto,
		largo: largo,
	};
})();
