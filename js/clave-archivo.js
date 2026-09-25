/*
	clave-archivo.js — Nombre seguro para guardar un archivo en Supabase Storage.

	Storage rechaza ("Invalid key") las claves con caracteres fuera de ASCII y con varios
	signos: un recurso llamado «3° 'B'.pdf» o «Guía de lectura (ñandú).docx» no se podía
	subir en Crear proyecto. La clave se normaliza y el nombre ORIGINAL se conserva aparte
	(es el que se muestra, siempre escapado):
	  - se quitan los acentos (á → a, ñ → n, ü → u);
	  - todo lo que no sea letra, número, punto, guion o guion bajo → guion; guiones seguidos
	    se juntan en uno y no quedan guiones ni puntos al principio o al final;
	  - la extensión se conserva en minúsculas (solo letras y números);
	  - sin nada que quede (un nombre solo de símbolos), "archivo";
	  - largo máximo del nombre, para que la ruta completa no crezca sin límite;
	  - si la clave ya está usada en la misma sesión de captura, se agrega un sufijo "-2",
	    "-3"... (dos nombres distintos pueden quedar iguales: «3° B.pdf» y «3 B.pdf»).

	Uso (js/crear_proyecto.js):
		ClaveArchivo.unica(file.name, rutasUsadas) → "3-B.pdf" (o "3-B-2.pdf")
*/
(function () {
	"use strict";

	var LARGO_BASE = 80;
	var LARGO_EXT = 10;

	function sinAcentos(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
	}

	function limpiar(s) {
		return sinAcentos(s).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
	}

	// "3° 'B'.PDF" → { base: "3-B", ext: "pdf" }
	function partes(nombre) {
		var n = String(nombre || "").trim();
		var punto = n.lastIndexOf(".");
		var ext = "", base = n;
		if (punto > 0 && punto < n.length - 1) {
			var cand = sinAcentos(n.slice(punto + 1)).toLowerCase().replace(/[^a-z0-9]/g, "");
			if (cand && cand.length <= LARGO_EXT) { ext = cand; base = n.slice(0, punto); }
		}
		base = limpiar(base).slice(0, LARGO_BASE).replace(/[-.]+$/g, "");
		return { base: base || "archivo", ext: ext };
	}

	// Clave normalizada de un nombre de archivo (sin sufijo)
	function clave(nombre) {
		var p = partes(nombre);
		return p.base + (p.ext ? "." + p.ext : "");
	}

	/*
		unica(nombre, usadas) → una clave que no está en `usadas` (arreglo de claves o de rutas
		completas: se compara el último tramo). Con sufijo "-2", "-3"... si hace falta.
	*/
	function unica(nombre, usadas) {
		var ocupadas = {};
		(usadas || []).forEach(function (u) {
			var s = String(u || "");
			ocupadas[s.slice(s.lastIndexOf("/") + 1).toLowerCase()] = true;
		});
		var p = partes(nombre);
		var ext = p.ext ? "." + p.ext : "";
		var c = p.base + ext;
		for (var i = 2; ocupadas[c.toLowerCase()]; i++) c = p.base + "-" + i + ext;
		return c;
	}

	var api = { clave: clave, unica: unica, partes: partes };
	if (typeof window !== "undefined") window.ClaveArchivo = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
