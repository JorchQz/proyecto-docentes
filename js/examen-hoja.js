/*
	examen-hoja.js — La hoja de respuestas de un examen de Mi Salón: su geometría (en milímetros,
	carta vertical), el dibujo para imprimir (SVG) y el contenido de su código QR.

	La MISMA geometría la usan la impresión (hojaSVG) y el lector de la cámara
	(js/examen-lector.js): cada círculo está donde el lector lo busca.

	Formato (carta, 215.9 × 279.4 mm):
	  - 4 marcadores: cuadros negros sólidos de 10 mm en las esquinas (centros a 14 mm de cada
	    orilla; su borde queda a 9 mm, dentro del área que imprime cualquier impresora). El lector
	    los busca para corregir la perspectiva.
	  - Barra de orientación: una franja negra de 70 × 3 mm arriba a la izquierda, bajo el
	    encabezado. Dice cuál es "arriba" (una hoja de cabeza se lee igual).
	  - Encabezado: título del examen, nombre del alumno, grado y grupo; o renglones en blanco en la
	    hoja genérica. Código QR de 38 mm arriba a la derecha:
	        "MS1:<EXAMEN>:<ALUMNO>"  (hoja personalizada)
	        "MS1:<EXAMEN>"           (hoja genérica: el alumno se elige al escanear)
	    con los uuid en mayúsculas y sin guiones (modo alfanumérico del QR: cabe en la versión 4).
	  - Respuestas: SOLO las preguntas que se califican solas (opción múltiple y verdadero o
	    falso), con su número del examen. Tres columnas de 21 renglones (63 como máximo), de arriba
	    abajo como las hojas de ENLACE. Círculos de 6.4 mm con la letra en gris claro, a 9 mm uno de
	    otro y renglones cada 8.5 mm: grandes y separados, pensados para lápiz.
	    Las preguntas de completar y abiertas no llevan círculos: se califican a mano.
*/
(function () {
	"use strict";

	var HOJA = { ancho: 215.9, alto: 279.4 };
	var MARCADOR = { lado: 10, margen: 14 }; // lado y distancia del centro a la orilla
	var MARCADORES = [ // centros: arriba-izq, arriba-der, abajo-der, abajo-izq
		{ x: MARCADOR.margen, y: MARCADOR.margen },
		{ x: HOJA.ancho - MARCADOR.margen, y: MARCADOR.margen },
		{ x: HOJA.ancho - MARCADOR.margen, y: HOJA.alto - MARCADOR.margen },
		{ x: MARCADOR.margen, y: HOJA.alto - MARCADOR.margen },
	];
	var BARRA = { x: 24, y: 62, ancho: 70, alto: 3 };
	var QR = { x: 160, y: 20, lado: 38 };
	var REJILLA = {
		y0: 80,          // centro del primer renglón
		paso: 8.5,       // entre renglones
		filas: 21,       // por columna
		columnas: [22, 83, 144], // x donde empieza cada columna (el número va antes del primer círculo)
		dx: 13,          // del inicio de la columna al centro del primer círculo
		entre: 9,        // entre círculos
		radio: 3.2,
	};
	var MAX_AUTOMATICAS = REJILLA.filas * REJILLA.columnas.length; // 63
	var LETRAS = ["A", "B", "C", "D", "E"];

	function esAutomatica(tipo) { return tipo === "opcion_multiple" || tipo === "verdadero_falso"; }

	// Letras que lleva el renglón de una pregunta automática
	function letrasDe(p) {
		if (p.tipo === "verdadero_falso") return ["V", "F"];
		var n = Array.isArray(p.opciones) ? p.opciones.length : 0;
		return LETRAS.slice(0, Math.max(2, Math.min(5, n)));
	}

	/*
		disposicion(preguntas) → [{ id, numero, letras, circulos: [{letra, x, y}] }]
		preguntas: las del examen en su orden (todas; el número es su lugar en el examen). Solo
		las automáticas entran a la hoja. Más de MAX_AUTOMATICAS → error (la pantalla lo impide).
	*/
	function disposicion(preguntas) {
		var salida = [], k = 0;
		(preguntas || []).forEach(function (p, i) {
			if (!esAutomatica(p.tipo)) return;
			if (k >= MAX_AUTOMATICAS) throw new Error("La hoja admite " + MAX_AUTOMATICAS + " preguntas de opción múltiple o verdadero o falso.");
			var col = Math.floor(k / REJILLA.filas), fila = k % REJILLA.filas;
			var y = REJILLA.y0 + fila * REJILLA.paso;
			var x0 = REJILLA.columnas[col] + REJILLA.dx;
			var letras = letrasDe(p);
			salida.push({
				id: p.id, numero: i + 1, letras: letras, columna: col, fila: fila,
				xNumero: REJILLA.columnas[col] + REJILLA.dx - 5.5, y: y,
				circulos: letras.map(function (l, j) { return { letra: l, x: x0 + j * REJILLA.entre, y: y }; }),
			});
			k++;
		});
		return salida;
	}

	// ── QR ───────────────────────────────────────────────────────────────────────
	function compacto(uuid) { return String(uuid || "").replace(/-/g, "").toUpperCase(); }
	function expandir(hex) {
		var h = String(hex || "").toLowerCase();
		return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
	}
	function textoQR(examenId, alumnoId) {
		return "MS1:" + compacto(examenId) + (alumnoId ? ":" + compacto(alumnoId) : "");
	}
	// → { examenId, alumnoId|null } o null si no es una hoja de Mi Salón
	function leerQR(texto) {
		var m = /^MS1:([0-9A-F]{32})(?::([0-9A-F]{32}))?$/.exec(String(texto || "").trim().toUpperCase());
		if (!m) return null;
		return { examenId: expandir(m[1]), alumnoId: m[2] ? expandir(m[2]) : null };
	}

	/*
		matrizQR(texto) → matriz de booleanos (true = negro) con la librería qrcode-generator
		(window.qrcode, cargada por la página desde jsDelivr con versión fija). Alfanumérico, nivel
		de corrección M, versión automática.
	*/
	function matrizQR(texto, generador) {
		var qrcode = generador || (typeof window !== "undefined" ? window.qrcode : null);
		if (!qrcode) throw new Error("No se cargó el generador de códigos QR.");
		var q = qrcode(0, "M");
		q.addData(texto, "Alphanumeric");
		q.make();
		var n = q.getModuleCount(), m = [];
		for (var r = 0; r < n; r++) {
			var fila = [];
			for (var c = 0; c < n; c++) fila.push(!!q.isDark(r, c));
			m.push(fila);
		}
		return m;
	}

	// ── Dibujo ───────────────────────────────────────────────────────────────────
	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function n2(v) { return String(Math.round(v * 100) / 100); }

	// Un solo path con todos los módulos negros del QR (lado en mm, con su zona blanca)
	function qrSVG(matriz, x, y, lado) {
		var n = matriz.length, total = n + 8, mod = lado / total, d = "";
		for (var r = 0; r < n; r++) {
			for (var c = 0; c < n; c++) {
				if (!matriz[r][c]) continue;
				d += "M" + n2(x + (c + 4) * mod) + " " + n2(y + (r + 4) * mod) + "h" + n2(mod) + "v" + n2(mod) + "h-" + n2(mod) + "z";
			}
		}
		return "<rect x='" + n2(x) + "' y='" + n2(y) + "' width='" + n2(lado) + "' height='" + n2(lado) + "' fill='#fff'/>" +
			"<path d='" + d + "' fill='#000' shape-rendering='crispEdges'/>";
	}

	/*
		hojaSVG(o) → <svg> de una hoja carta completa (215.9 × 279.4 mm).
		o = { examen: {id, titulo}, preguntas, alumno: {id, nombre, grado}|null, grupo, escuela,
		      matriz (del QR; si falta se genera con window.qrcode) }
	*/
	function hojaSVG(o) {
		var ex = o.examen || {};
		var alumno = o.alumno || null;
		var disp = o.disposicion || disposicion(o.preguntas || []);
		var matriz = o.matriz || matrizQR(textoQR(ex.id, alumno ? alumno.id : null), o.generador);
		var s = "<svg xmlns='http://www.w3.org/2000/svg' class='hoja-svg' width='215.9mm' height='279.4mm' viewBox='0 0 215.9 279.4' " +
			"font-family='Arial, Helvetica, sans-serif' role='img' aria-label='Hoja de respuestas'>";
		s += "<rect width='215.9' height='279.4' fill='#fff'/>";
		// Marcadores
		MARCADORES.forEach(function (m) {
			s += "<rect x='" + n2(m.x - MARCADOR.lado / 2) + "' y='" + n2(m.y - MARCADOR.lado / 2) + "' width='" + MARCADOR.lado + "' height='" + MARCADOR.lado + "' fill='#000'/>";
		});
		// Encabezado
		s += "<text x='24' y='18' font-size='3.4' fill='#374151' font-weight='700' letter-spacing='0.3'>HOJA DE RESPUESTAS</text>";
		s += "<text x='24' y='26' font-size='5' font-weight='700' fill='#111827'>" + esc(recortar(ex.titulo || "Examen", 52)) + "</text>";
		if (alumno) {
			s += "<text x='24' y='36' font-size='3.6' fill='#374151'>Nombre:</text>";
			s += "<text x='40' y='36' font-size='4.6' font-weight='700' fill='#111827'>" + esc(recortar(alumno.nombre || "", 44)) + "</text>";
			s += "<text x='24' y='44' font-size='3.6' fill='#374151'>Grado: <tspan font-weight='700' fill='#111827'>" + esc(alumno.grado ? alumno.grado + "°" : "") + "</tspan>" +
				(o.grupo ? "    Grupo: <tspan font-weight='700' fill='#111827'>" + esc(recortar(o.grupo, 34)) + "</tspan>" : "") + "</text>";
		} else {
			s += "<text x='24' y='36' font-size='3.6' fill='#374151'>Nombre:</text>";
			s += "<line x1='40' y1='36.8' x2='156' y2='36.8' stroke='#6b7280' stroke-width='0.3'/>";
			s += "<text x='24' y='44' font-size='3.6' fill='#374151'>Grado:</text>";
			s += "<line x1='37' y1='44.8' x2='60' y2='44.8' stroke='#6b7280' stroke-width='0.3'/>";
			if (o.grupo) s += "<text x='66' y='44' font-size='3.6' fill='#374151'>Grupo: <tspan font-weight='700' fill='#111827'>" + esc(recortar(o.grupo, 34)) + "</tspan></text>";
		}
		s += "<text x='24' y='52' font-size='3.6' fill='#374151'>Fecha:</text>";
		s += "<line x1='37' y1='52.8' x2='80' y2='52.8' stroke='#6b7280' stroke-width='0.3'/>";
		s += "<text x='24' y='71' font-size='3.3' fill='#374151'>Rellena por completo el círculo de tu respuesta, con lápiz. Si te equivocas, borra bien.</text>";
		// Barra de orientación
		s += "<rect x='" + BARRA.x + "' y='" + BARRA.y + "' width='" + BARRA.ancho + "' height='" + BARRA.alto + "' fill='#000'/>";
		// QR
		s += qrSVG(matriz, QR.x, QR.y, QR.lado);
		// Respuestas
		disp.forEach(function (d) {
			s += "<text x='" + n2(d.xNumero) + "' y='" + n2(d.y + 1.3) + "' font-size='3.8' font-weight='700' text-anchor='end' fill='#111827'>" + d.numero + "</text>";
			d.circulos.forEach(function (c) {
				s += "<circle cx='" + n2(c.x) + "' cy='" + n2(c.y) + "' r='" + REJILLA.radio + "' fill='#fff' stroke='#6b7280' stroke-width='0.35'/>";
				s += "<text x='" + n2(c.x) + "' y='" + n2(c.y + 1.1) + "' font-size='3' text-anchor='middle' fill='#a3a3a3'>" + c.letra + "</text>";
			});
		});
		if (!disp.length) {
			s += "<text x='107.95' y='120' font-size='4' text-anchor='middle' fill='#6b7280'>Este examen no tiene preguntas de opción múltiple ni de verdadero o falso.</text>";
		}
		s += "<text x='107.95' y='262' font-size='2.8' text-anchor='middle' fill='#9ca3af'>No dobles ni manches los cuadros negros de las esquinas. Jissez Mi Salón</text>";
		s += "</svg>";
		return s;
	}

	function recortar(t, n) {
		t = String(t || "").replace(/\s+/g, " ").trim();
		return t.length > n ? t.slice(0, n - 1) + "…" : t;
	}

	var api = {
		HOJA: HOJA, MARCADOR: MARCADOR, MARCADORES: MARCADORES, BARRA: BARRA, QR: QR, REJILLA: REJILLA,
		MAX_AUTOMATICAS: MAX_AUTOMATICAS, LETRAS: LETRAS,
		esAutomatica: esAutomatica, letrasDe: letrasDe, disposicion: disposicion,
		textoQR: textoQR, leerQR: leerQR, matrizQR: matrizQR, hojaSVG: hojaSVG,
	};
	if (typeof window !== "undefined") window.ExamenHoja = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
