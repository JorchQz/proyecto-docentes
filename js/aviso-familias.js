/*
	aviso-familias.js — Texto corto para avisar a las familias qué datos lleva la maestra en Mi
	Salón (decisión de Jorge, 2026-09-25; va con el Aviso de privacidad aprobado ese día).

	Un párrafo simple, en primera persona de la maestra: la lista, la asistencia, las
	calificaciones y los trabajos, la participación y la conducta, el diagnóstico, sus
	observaciones, la ficha (fecha de nacimiento, género, datos del tutor), el registro de
	incidencias y las listas de cooperación y materiales (Jorge, 2026-09-26); solo ella los ve; pueden pedirle corregirlos o borrarlos; al final, "Más
	información: jissez.com/tienda/privacidad" (decisión de Jorge, 2026-09-26). En Mi grupo, con tres botones:
	  - Copiar (portapapeles; si el navegador no deja, se selecciona el texto para copiarlo a mano);
	  - Compartir por WhatsApp (https://wa.me/?text=..., sin número: ella elige el chat);
	  - Imprimir (una hoja carta solo con el aviso y su nombre).
	Sin emojis. La parte pura (TEXTO, enlaceWhatsApp) se exporta a node: pruebas/aviso-familias.test.js.
*/
(function () {
	"use strict";

	// Lo mismo que lista el Aviso de privacidad (tienda/privacidad.html, punto 2) de los alumnos
	// (decisión de Jorge, 2026-09-26: también participación y conducta, diagnóstico y observaciones)
	var ENLACE_PRIVACIDAD = "jissez.com/tienda/privacidad";
	var TEXTO = "Estimadas familias: les informo que llevo el registro del grupo en Mi Salón, una herramienta personal " +
		"para mi trabajo como docente. Ahí anoto la lista del grupo, la asistencia, las calificaciones y los trabajos, " +
		"la participación y la conducta, el diagnóstico (cuaderno, lectura y matemáticas), mis observaciones, la ficha de " +
		"cada alumno (fecha de nacimiento, género y datos de la madre, padre o tutor), el registro de incidencias y las " +
		"listas de cooperación y materiales del grupo (quién entregó y cuánto aportó). Solo yo " +
		"veo esa información. Si algún dato de su hija o hijo está mal, o si quieren que lo borre, díganmelo y lo corrijo o " +
		"lo borro. Más información: " + ENLACE_PRIVACIDAD;

	// wa.me sin número: WhatsApp abre el texto y la maestra elige el chat o grupo
	function enlaceWhatsApp(texto) {
		return "https://wa.me/?text=" + encodeURIComponent(texto || TEXTO);
	}

	var api = { TEXTO: TEXTO, ENLACE_PRIVACIDAD: ENLACE_PRIVACIDAD, enlaceWhatsApp: enlaceWhatsApp };
	if (typeof window !== "undefined") window.AvisoFamilias = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	document.addEventListener("DOMContentLoaded", function () {
		var seccion = document.getElementById("avisoFamilias");
		if (!seccion) return;
		var texto = document.getElementById("avisoFamiliasTexto");
		var copiar = document.getElementById("avisoFamiliasCopiar");
		var whatsapp = document.getElementById("avisoFamiliasWhatsApp");
		var imprimir = document.getElementById("avisoFamiliasImprimir");
		var estado = document.getElementById("avisoFamiliasEstado");
		var hoja = document.getElementById("avisoFamiliasHoja");
		var hojaTexto = document.getElementById("avisoFamiliasHojaTexto");
		var hojaFirma = document.getElementById("avisoFamiliasHojaFirma");

		texto.textContent = TEXTO;
		whatsapp.href = enlaceWhatsApp(TEXTO);
		var borrarEstado = null;
		function avisar(t) {
			estado.textContent = t;
			if (borrarEstado) clearTimeout(borrarEstado);
			borrarEstado = setTimeout(function () { estado.textContent = ""; }, 4000);
		}
		function seleccionar() {
			try {
				var rango = document.createRange();
				rango.selectNodeContents(texto);
				var sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange(rango);
			} catch (_) {}
		}

		copiar.addEventListener("click", async function () {
			try {
				if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("sin portapapeles");
				await navigator.clipboard.writeText(TEXTO);
				avisar("Texto copiado. Pégalo donde quieras enviarlo.");
			} catch (_) {
				seleccionar();
				avisar("No se pudo copiar solo: el texto quedó seleccionado para que lo copies.");
			}
		});

		// Imprimir: una hoja carta solo con el aviso (mi-grupo.html, @media print con .imprime-aviso)
		imprimir.addEventListener("click", function () {
			hojaTexto.textContent = TEXTO;
			var nombre = (document.getElementById("userName") || {}).textContent || "";
			nombre = nombre.trim();
			// Sin nombre registrado (la pantalla dice "Docente" o aún carga): la línea queda para firmar a mano
			if (/^(cargando|docente)\b/i.test(nombre)) nombre = "";
			hojaFirma.textContent = nombre;
			hoja.classList.remove("hidden");
			document.body.classList.add("imprime-aviso");
			window.print();
		});
		window.addEventListener("afterprint", function () {
			if (!document.body.classList.contains("imprime-aviso")) return;
			document.body.classList.remove("imprime-aviso");
			hoja.classList.add("hidden");
			imprimir.focus();
		});
	});
})();
