/*
	nombres-alumno.js — Cómo se escribe el nombre de un alumno (onboarding y Mi grupo).

	Decisión de Jorge del 2026-09-26: MAYÚSCULAS CON ACENTOS Y Ñ ("JOSÉ PEÑA"). Antes se
	quitaban los acentos al teclear ("JOSE PEÑA"). Solo cambia lo que se escribe desde ahora:
	los nombres ya guardados no se tocan (se muestran y se editan como están).

	  formatear(texto, conEspacios) → lo que queda en el cuadro al teclear: letras (con á é í ó
	      ú ü ñ), guiones y espacios; mayúsculas. Otras marcas (à, ã, ç…) quedan como su letra
	      base; números y signos se quitan.
	  valido(texto)   → ¿solo letras (con acentos y Ñ), espacios y guiones?
	  clave(texto)    → para detectar duplicados: sin acentos, minúsculas y espacios simples
	      ("JOSÉ PEÑA" y "JOSE PENA" son el mismo alumno).
*/

(function () {
	"use strict";

	var PERMITIDAS = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\-\s]/;

	function letraPermitida(ch) {
		if (PERMITIDAS.test(ch)) return ch;
		// Otra letra con marca (à, ã, ç…): su letra base
		var base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
		return /^[A-Za-z]$/.test(base) ? base : "";
	}

	function formatear(texto, conEspacios) {
		var limpio = Array.from(String(texto || "").normalize("NFC")).map(letraPermitida).join("");
		limpio = conEspacios === false
			? limpio.replace(/\s+/g, "")
			: limpio.replace(/\s+/g, " ").replace(/^\s+/, "");
		return limpio.toUpperCase();
	}

	function valido(texto) {
		var t = String(texto || "").normalize("NFC").trim();
		return !!t && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\-\s]+$/.test(t);
	}

	function clave(texto) {
		return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
			.toLowerCase().replace(/\s+/g, " ").trim();
	}

	var api = { formatear: formatear, valido: valido, clave: clave };
	if (typeof window !== "undefined") window.NombresAlumno = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
