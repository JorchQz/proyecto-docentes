/*
	ficha-alumno.js — Reglas de la ficha del alumno (decisión de Jorge, 2026-09-25).

	Todo es opcional y se edita en Mi grupo (alta y edición de alumno); el alta rápida del
	onboarding no la pide. SIN CURP. Columnas en alumnos (supabase/mi_salon_b13_…sql):
	fecha_nacimiento, genero, tutor_nombre, tutor_telefono.

	- Teléfono del tutor: se acepta como lo escriba la maestra ("33 1234 5678", "+52 1 33…",
	  "(33) 1234-5678", "044 33…") y se guarda como 10 dígitos de México. El enlace de WhatsApp
	  le antepone 52 (wa.me/52XXXXXXXXXX). Validación suave: si no quedan 10 dígitos, se explica
	  qué falta y no se guarda (la base también exige 10 dígitos).
	- Fecha de nacimiento: razonable para primaria, entre EDAD_MIN y EDAD_MAX años cumplidos a
	  la fecha de hoy (a un alumno de 6° que repitió le caben 15 o 16; a uno que entró antes, 5).
	- Género: niña, niño o "prefiero no decir" (null = sin dato).

	Puro (sin DOM ni base): lo usan js/mi-grupo.js y pruebas/ficha-alumno.test.js.
*/
(function () {
	"use strict";

	var EDAD_MIN = 4;
	var EDAD_MAX = 16;

	var GENEROS = [
		{ valor: "nina", etiqueta: "Niña" },
		{ valor: "nino", etiqueta: "Niño" },
		{ valor: "prefiero_no_decir", etiqueta: "Prefiero no decir" },
	];

	function etiquetaGenero(valor) {
		for (var i = 0; i < GENEROS.length; i++) if (GENEROS[i].valor === valor) return GENEROS[i].etiqueta;
		return "";
	}

	function generoValido(valor) {
		return valor === null || valor === undefined || valor === "" || etiquetaGenero(valor) !== "";
	}

	/*
		normalizarTelefono(texto) → { ok, vacio, digitos, error }
		  ""                          → ok, vacio (el campo es opcional)
		  "33 1234 5678"              → ok, "3312345678"
		  "+52 33 1234 5678"          → ok, "3312345678"  (lada de país)
		  "+52 1 33 1234 5678"        → ok, "3312345678"  (el "1" de celular que ya no se usa)
		  "044 33 1234 5678" / "045…" → ok, "3312345678"  (prefijos de celular que ya no se usan)
		  "1234"                      → error: cuántos dígitos tiene y que deben ser 10
	*/
	function normalizarTelefono(texto) {
		var crudo = String(texto === null || texto === undefined ? "" : texto).trim();
		if (!crudo) return { ok: true, vacio: true, digitos: "", error: "" };
		if (/[A-Za-z]/.test(crudo)) {
			return { ok: false, vacio: false, digitos: "", error: "El teléfono solo lleva números (10 dígitos, por ejemplo 33 1234 5678)." };
		}
		var d = crudo.replace(/\D/g, "");
		if (d.length === 13 && d.indexOf("521") === 0) d = d.slice(3);
		else if (d.length === 12 && d.indexOf("52") === 0) d = d.slice(2);
		else if (d.length === 13 && (d.indexOf("044") === 0 || d.indexOf("045") === 0)) d = d.slice(3);
		if (d.length !== 10) {
			return {
				ok: false, vacio: false, digitos: "",
				error: "El teléfono debe tener 10 dígitos (tiene " + d.length + "). Escríbelo con lada, por ejemplo 33 1234 5678.",
			};
		}
		return { ok: true, vacio: false, digitos: d, error: "" };
	}

	// "3312345678" → "33 1234 5678"; lada de 3 dígitos → "444 123 4567"
	var LADAS_DOS = ["33", "55", "56", "81"];
	function formatoTelefono(digitos) {
		var d = String(digitos || "");
		if (!/^\d{10}$/.test(d)) return d;
		if (LADAS_DOS.indexOf(d.slice(0, 2)) !== -1) return d.slice(0, 2) + " " + d.slice(2, 6) + " " + d.slice(6);
		return d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6);
	}

	/*
		enlaceWhatsApp(telefono, mensaje?) → "https://wa.me/52XXXXXXXXXX[?text=…]" o "" si el
		teléfono no es válido. El mensaje es un saludo que la maestra puede cambiar en WhatsApp
		antes de enviarlo.
	*/
	function enlaceWhatsApp(telefono, mensaje) {
		var n = normalizarTelefono(telefono);
		if (!n.ok || n.vacio) return "";
		var url = "https://wa.me/52" + n.digitos;
		var texto = String(mensaje || "").trim();
		// encodeURIComponent deja pasar ' ( ) ! *: se codifican también (el enlace puede ir en un atributo)
		return texto ? url + "?text=" + encodeURIComponent(texto).replace(/['()!*]/g, function (c) {
			return "%" + c.charCodeAt(0).toString(16).toUpperCase();
		}) : url;
	}

	// Saludo para abrir la conversación (se edita en WhatsApp antes de enviar)
	function saludoWhatsApp(docente, alumno) {
		var d = String(docente || "").trim();
		var a = String(alumno || "").trim();
		return "Hola, buen día." + (d ? " Le escribe " + d + "," : " Le escribo como") + " docente de " + (a || "su hija o hijo") + ".";
	}

	function aFecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
		if (!m) return null;
		var f = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
		var prueba = new Date(Date.UTC(f.y, f.m - 1, f.d));
		if (prueba.getUTCFullYear() !== f.y || prueba.getUTCMonth() !== f.m - 1 || prueba.getUTCDate() !== f.d) return null;
		return f;
	}

	// Años cumplidos en la fecha "hoy" (ambas AAAA-MM-DD)
	function edadEn(nacimiento, hoy) {
		var n = aFecha(nacimiento), h = aFecha(hoy);
		if (!n || !h) return null;
		var edad = h.y - n.y;
		if (h.m < n.m || (h.m === n.m && h.d < n.d)) edad -= 1;
		return edad;
	}

	/*
		validarFechaNacimiento(iso, hoy) → { ok, vacio, edad, error }
		Vacía: ok (opcional). Fecha imposible, futura o fuera de EDAD_MIN..EDAD_MAX: error que
		explica qué se espera.
	*/
	function validarFechaNacimiento(iso, hoy) {
		var s = String(iso === null || iso === undefined ? "" : iso).trim();
		if (!s) return { ok: true, vacio: true, edad: null, error: "" };
		if (!aFecha(s)) return { ok: false, vacio: false, edad: null, error: "La fecha de nacimiento no es válida." };
		var edad = edadEn(s, hoy);
		if (edad === null) return { ok: false, vacio: false, edad: null, error: "La fecha de nacimiento no es válida." };
		if (s > hoy) return { ok: false, vacio: false, edad: null, error: "La fecha de nacimiento no puede ser futura." };
		if (edad < EDAD_MIN || edad > EDAD_MAX) {
			return {
				ok: false, vacio: false, edad: edad,
				error: "Revisa la fecha de nacimiento: daría " + edad + (edad === 1 ? " año" : " años") +
					". En primaria esperamos entre " + EDAD_MIN + " y " + EDAD_MAX + " años.",
			};
		}
		return { ok: true, vacio: false, edad: edad, error: "" };
	}

	// Límites para el <input type="date"> (min y max) a partir de hoy
	function limitesFecha(hoy) {
		var h = aFecha(hoy);
		if (!h) return { min: "", max: "" };
		function iso(y, m, d) { return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d; }
		// El más grande: cumple EDAD_MAX + 1 mañana; el más chico: cumplió EDAD_MIN hoy
		var min = new Date(Date.UTC(h.y - EDAD_MAX - 1, h.m - 1, h.d + 1));
		return {
			min: iso(min.getUTCFullYear(), min.getUTCMonth() + 1, min.getUTCDate()),
			max: iso(h.y - EDAD_MIN, h.m, h.d === 29 && h.m === 2 ? 28 : h.d),
		};
	}

	/*
		conteoGenero(alumnos) → { ninas, ninos, prefierenNoDecir, sinDato, total, texto }
		texto: "6 niñas y 5 niños" (+ ", 1 prefiere no decir", ", 3 sin dato"); "" si nadie
		tiene el dato (entonces no se muestra nada).
	*/
	function conteoGenero(alumnos) {
		var c = { ninas: 0, ninos: 0, prefierenNoDecir: 0, sinDato: 0, total: 0, texto: "" };
		(alumnos || []).forEach(function (a) {
			c.total += 1;
			var g = a ? a.genero : null;
			if (g === "nina") c.ninas += 1;
			else if (g === "nino") c.ninos += 1;
			else if (g === "prefiero_no_decir") c.prefierenNoDecir += 1;
			else c.sinDato += 1;
		});
		if (c.ninas + c.ninos + c.prefierenNoDecir === 0) return c;
		// Niñas y niños siempre juntos (aunque uno sea 0), salvo que nadie tenga ese dato
		var partes = c.ninas + c.ninos > 0
			? [c.ninas + (c.ninas === 1 ? " niña" : " niñas") + " y " + c.ninos + (c.ninos === 1 ? " niño" : " niños")]
			: [];
		if (c.prefierenNoDecir) partes.push(c.prefierenNoDecir + (c.prefierenNoDecir === 1 ? " prefiere no decir" : " prefieren no decir"));
		if (c.sinDato) partes.push(c.sinDato + " sin dato");
		c.texto = partes.join(", ");
		return c;
	}

	// Nombre del tutor: espacios normalizados, hasta 120 caracteres; "" si está vacío
	function limpiarNombreTutor(texto) {
		return String(texto || "").replace(/\s+/g, " ").trim().slice(0, 120);
	}

	var api = {
		EDAD_MIN: EDAD_MIN,
		EDAD_MAX: EDAD_MAX,
		GENEROS: GENEROS,
		etiquetaGenero: etiquetaGenero,
		generoValido: generoValido,
		normalizarTelefono: normalizarTelefono,
		formatoTelefono: formatoTelefono,
		enlaceWhatsApp: enlaceWhatsApp,
		saludoWhatsApp: saludoWhatsApp,
		edadEn: edadEn,
		validarFechaNacimiento: validarFechaNacimiento,
		limitesFecha: limitesFecha,
		conteoGenero: conteoGenero,
		limpiarNombreTutor: limpiarNombreTutor,
	};
	if (typeof window !== "undefined") window.FichaAlumno = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
