/*
	examen-lector.js — Lee una hoja de respuestas de Mi Salón en una foto (js/examen-hoja.js),
	todo en el aparato: nada se sube a ningún servidor.

	Por qué un algoritmo propio y no OpenCV.js: OpenCV.js pesa ~8 MB (más de lo que pesa todo
	Mi Salón) y en una tablet tarda en cargar y en arrancar. La hoja está hecha para leerse
	fácil (4 cuadros negros sólidos, una barra de orientación y círculos grandes en posiciones
	fijas), así que basta con esto, en JavaScript puro sobre una imagen en grises (unos 20 KB):

	  1. Se reduce la imagen (lado mayor ≤ 800 px) y se binariza con UMBRAL ADAPTATIVO (media
	     local con imagen integral, ventana de 1/8 del lado mayor): una sombra o una luz
	     dispareja no se confunden con tinta.
	  2. Componentes conexas de lo oscuro. Un marcador es un cuadro sólido: su área entre el
	     cuadrado de su distancia máxima al centro da 2 (un círculo relleno da 3.14, un anillo
	     o una letra mucho menos), sin importar la rotación ni el tamaño.
	  3. De los candidatos más grandes se eligen los 4 que forman un cuadrilátero convexo de
	     tamaños parecidos, y se prueban las 4 rotaciones: la buena es la que pone la barra de
	     orientación sobre tinta y su vecindad sobre papel (una hoja de lado o de cabeza se lee).
	  4. HOMOGRAFÍA de los centros de los marcadores de la hoja (mm) a la foto (px): con ella se
	     sabe dónde cae cada círculo aunque la hoja esté girada o en perspectiva. El centro de
	     cada marcador se afina en la imagen completa.
	  5. Cada círculo: oscuridad = 1 − (brillo del interior / brillo del papel alrededor). El
	     papel se mide en un anillo junto a cada círculo, así una sombra no cuenta como marca.
	     Umbral adaptativo por hoja: la base (círculos vacíos, percentil 25) y lo más oscuro
	     de la hoja (percentil 95); marca = base + 35 % de la diferencia (así entra una marca
	     tenue de lápiz), nunca menos de 0.12.
	     Por pregunta: ninguna sobre el umbral → vacía (null); dos o más → doble marca ('*'),
	     salvo que la segunda sea claramente más clara (un borrón): entonces vale la más oscura
	     y queda como dudosa. Lo dudoso se resalta para que la maestra lo revise.

	Imagen: { ancho, alto, datos } con datos = Uint8Array/Uint8ClampedArray de grises (0-255),
	un byte por píxel. gris(imageData) convierte la de un canvas.

	Uso (js/examen-camara.js):
		var r = ExamenLector.leerHoja(img, ExamenHoja.disposicion(preguntas));
		r.ok, r.error, r.H (hoja mm → foto px), r.respuestas [{ id, numero, letra, oscuridad, dudosa }]
		ExamenLector.enderezar(img, r.H, 3) → imagen de la hoja derecha (3 px por mm)
		ExamenLector.recorteQR(img, r.H, 8) → { ancho, alto, rgba } para jsQR
*/
(function () {
	"use strict";

	var Hoja = typeof window !== "undefined" && window.ExamenHoja ? window.ExamenHoja
		: (typeof require === "function" ? require("./examen-hoja.js") : null);

	// ── Imagen ───────────────────────────────────────────────────────────────────
	function gris(imageData) {
		var n = imageData.width * imageData.height, rgba = imageData.data, d = new Uint8Array(n);
		for (var i = 0, j = 0; i < n; i++, j += 4) d[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
		return { ancho: imageData.width, alto: imageData.height, datos: d };
	}

	// Reducción por promedio de bloques (factor entero)
	function reducir(img, maxLado) {
		var f = Math.max(1, Math.ceil(Math.max(img.ancho, img.alto) / maxLado));
		if (f === 1) return { img: img, factor: 1 };
		var w = Math.floor(img.ancho / f), h = Math.floor(img.alto / f), d = new Uint8Array(w * h), ff = f * f;
		for (var y = 0; y < h; y++) {
			for (var x = 0; x < w; x++) {
				var s = 0;
				for (var yy = 0; yy < f; yy++) {
					var fila = (y * f + yy) * img.ancho + x * f;
					for (var xx = 0; xx < f; xx++) s += img.datos[fila + xx];
				}
				d[y * w + x] = s / ff;
			}
		}
		return { img: { ancho: w, alto: h, datos: d }, factor: f };
	}

	function muestra(img, x, y) {
		// Bilineal; fuera de la imagen → null
		if (!(x >= 0 && y >= 0 && x <= img.ancho - 1 && y <= img.alto - 1)) return null;
		var x0 = Math.floor(x), y0 = Math.floor(y);
		var x1 = Math.min(x0 + 1, img.ancho - 1), y1 = Math.min(y0 + 1, img.alto - 1);
		var fx = x - x0, fy = y - y0, d = img.datos, w = img.ancho;
		var a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
		return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
	}

	// ── Homografía ───────────────────────────────────────────────────────────────
	/*
		homografia(de, a) → H (9 números, h33 = 1) tal que a ≈ H·de, con 4 pares de puntos
		(sistema lineal de 8×8 por eliminación de Gauss con pivoteo). null si es degenerada.
	*/
	function homografia(de, a) {
		var M = [], v = [];
		for (var i = 0; i < 4; i++) {
			var x = de[i].x, y = de[i].y, u = a[i].x, w = a[i].y;
			M.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); v.push(u);
			M.push([0, 0, 0, x, y, 1, -w * x, -w * y]); v.push(w);
		}
		var h = resolver(M, v);
		if (!h) return null;
		h.push(1);
		return h;
	}

	function resolver(A, b) {
		var n = b.length, M = A.map(function (f, i) { return f.concat([b[i]]); });
		for (var c = 0; c < n; c++) {
			var p = c;
			for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
			if (Math.abs(M[p][c]) < 1e-12) return null;
			var t = M[c]; M[c] = M[p]; M[p] = t;
			for (var r2 = 0; r2 < n; r2++) {
				if (r2 === c) continue;
				var f = M[r2][c] / M[c][c];
				if (!f) continue;
				for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
			}
		}
		return M.map(function (f, i) { return f[n] / f[i]; });
	}

	function aplicar(H, x, y) {
		var z = H[6] * x + H[7] * y + H[8];
		return { x: (H[0] * x + H[1] * y + H[2]) / z, y: (H[3] * x + H[4] * y + H[5]) / z };
	}

	// ── Marcadores ───────────────────────────────────────────────────────────────
	function umbralAdaptativo(img) {
		var w = img.ancho, h = img.alto, d = img.datos;
		var I = new Float64Array((w + 1) * (h + 1));
		for (var y = 0; y < h; y++) {
			var s = 0;
			for (var x = 0; x < w; x++) {
				s += d[y * w + x];
				I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s;
			}
		}
		var r = Math.max(8, Math.round(Math.max(w, h) / 16));
		var oscuro = new Uint8Array(w * h);
		for (var yy = 0; yy < h; yy++) {
			var y0 = Math.max(0, yy - r), y1 = Math.min(h, yy + r + 1);
			for (var xx = 0; xx < w; xx++) {
				var x0 = Math.max(0, xx - r), x1 = Math.min(w, xx + r + 1);
				var suma = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
				var media = suma / ((x1 - x0) * (y1 - y0));
				if (d[yy * w + xx] < media * 0.72 && d[yy * w + xx] < media - 18) oscuro[yy * w + xx] = 1;
			}
		}
		return oscuro;
	}

	/*
		candidatos(img) → componentes oscuras con forma de cuadro sólido:
		[{ x, y, area, q }] (centro en px de img). q = área / (distancia máxima al centro)²:
		cuadro ≈ 2, círculo ≈ 3.14.
	*/
	function candidatos(img) {
		var w = img.ancho, h = img.alto, osc = umbralAdaptativo(img);
		var etiqueta = new Int32Array(w * h), pila = new Int32Array(w * h);
		var largo = Math.max(w, h);
		var areaMin = Math.max(20, Math.pow(largo / 110, 2)), areaMax = Math.pow(largo / 11, 2);
		var comps = [], n = 0;
		for (var i = 0; i < w * h; i++) {
			if (!osc[i] || etiqueta[i]) continue;
			n++;
			var tope = 0, area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0, grande = false;
			pila[tope++] = i; etiqueta[i] = n;
			while (tope) {
				var p = pila[--tope], px = p % w, py = (p - px) / w;
				area++; sx += px; sy += py;
				if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
				if (area > areaMax) grande = true;
				if (px > 0 && osc[p - 1] && !etiqueta[p - 1]) { etiqueta[p - 1] = n; pila[tope++] = p - 1; }
				if (px < w - 1 && osc[p + 1] && !etiqueta[p + 1]) { etiqueta[p + 1] = n; pila[tope++] = p + 1; }
				if (py > 0 && osc[p - w] && !etiqueta[p - w]) { etiqueta[p - w] = n; pila[tope++] = p - w; }
				if (py < h - 1 && osc[p + w] && !etiqueta[p + w]) { etiqueta[p + w] = n; pila[tope++] = p + w; }
			}
			if (grande || area < areaMin) continue;
			var bw = maxx - minx + 1, bh = maxy - miny + 1;
			if (bw / bh > 2.2 || bh / bw > 2.2) continue;
			if (area / (bw * bh) < 0.42) continue;
			comps.push({ id: n, area: area, x: sx / area, y: sy / area, minx: minx, maxx: maxx, miny: miny, maxy: maxy });
		}
		var salida = [];
		comps.forEach(function (c) {
			var r2 = 0;
			for (var y = c.miny; y <= c.maxy; y++) {
				for (var x = c.minx; x <= c.maxx; x++) {
					if (etiqueta[y * w + x] !== c.id) continue;
					var dx = x + 0.5 - (c.x + 0.5), dy = y + 0.5 - (c.y + 0.5), dd = dx * dx + dy * dy;
					if (dd > r2) r2 = dd;
				}
			}
			// El píxel mide 1: el radio al borde exterior es ~0.7 px mayor que al centro del píxel
			var r = Math.sqrt(r2) + 0.7;
			var q = c.area / (r * r);
			if (q >= 1.55 && q <= 2.6) salida.push({ x: c.x + 0.5, y: c.y + 0.5, area: c.area, q: q });
		});
		salida.sort(function (a, b) { return b.area - a.area; });
		return salida;
	}

	function convexo(p) {
		var signo = 0;
		for (var i = 0; i < 4; i++) {
			var a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
			var z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
			if (Math.abs(z) < 1e-9) return false;
			if (!signo) signo = z > 0 ? 1 : -1;
			else if ((z > 0 ? 1 : -1) !== signo) return false;
		}
		return true;
	}
	function areaCuad(p) {
		var s = 0;
		for (var i = 0; i < 4; i++) { var a = p[i], b = p[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
		return Math.abs(s) / 2;
	}
	function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

	// Promedio de gris en un rectángulo de la hoja (mm), muestreado con H
	function promedioZona(img, H, x0, y0, ancho, alto, paso) {
		var s = 0, n = 0;
		for (var y = y0; y <= y0 + alto + 1e-9; y += paso) {
			for (var x = x0; x <= x0 + ancho + 1e-9; x += paso) {
				var p = aplicar(H, x, y), v = muestra(img, p.x, p.y);
				if (v === null) return null;
				s += v; n++;
			}
		}
		return n ? s / n : null;
	}

	/*
		Orientación: la barra (tinta) contra el papel junto a ella. → contraste en grises
		(papel − barra); negativo o pequeño = no es esta rotación.
	*/
	function contrasteBarra(img, H) {
		var B = Hoja.BARRA;
		var barra = promedioZona(img, H, B.x + 2, B.y + 0.8, B.ancho - 4, B.alto - 1.6, 1.4);
		var arriba = promedioZona(img, H, B.x + 2, B.y - 3.4, B.ancho - 4, 1.2, 1.4);
		var abajo = promedioZona(img, H, B.x + 2, B.y + B.alto + 1.6, B.ancho - 4, 1.2, 1.4);
		if (barra === null || arriba === null || abajo === null) return -999;
		return Math.min(arriba, abajo) - barra;
	}

	/*
		buscarMarcadores(img) → { H, puntos: [4 centros en px de img], contraste } o
		{ error } si no se encontraron los 4 y la barra de orientación.
	*/
	function buscarMarcadores(img, opciones) {
		opciones = opciones || {};
		var red = reducir(img, opciones.maxLado || 800), chica = red.img, f = red.factor;
		var cands = candidatos(chica).slice(0, opciones.maxCandidatos || 12);
		if (cands.length < 4) return { error: "marcadores", candidatos: cands.length };
		var mejor = null;
		var n = cands.length;
		for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) for (var c = b + 1; c < n; c++) for (var d = c + 1; d < n; d++) {
			var grupo = [cands[a], cands[b], cands[c], cands[d]];
			var areas = grupo.map(function (g) { return g.area; });
			if (Math.max.apply(null, areas) / Math.min.apply(null, areas) > 3.2) continue;
			// Orden en círculo alrededor del centro (sentido de las manecillas en la pantalla)
			var cx = (grupo[0].x + grupo[1].x + grupo[2].x + grupo[3].x) / 4, cy = (grupo[0].y + grupo[1].y + grupo[2].y + grupo[3].y) / 4;
			grupo.sort(function (p, q) { return Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx); });
			if (!convexo(grupo)) continue;
			var area = areaCuad(grupo);
			// El cuadrilátero debe ser mucho más grande que un marcador (no 4 cuadritos juntos)
			var lado = Math.sqrt((areas[0] + areas[1] + areas[2] + areas[3]) / 4);
			if (area < Math.pow(lado * 8, 2)) continue;
			// Proporción de la hoja: lados opuestos parecidos (perspectiva moderada)
			var l = [dist(grupo[0], grupo[1]), dist(grupo[1], grupo[2]), dist(grupo[2], grupo[3]), dist(grupo[3], grupo[0])];
			if (Math.max(l[0], l[2]) / Math.min(l[0], l[2]) > 1.8 || Math.max(l[1], l[3]) / Math.min(l[1], l[3]) > 1.8) continue;
			var puntos = grupo.map(function (g) { return { x: g.x * f, y: g.y * f }; });
			for (var rot = 0; rot < 4; rot++) {
				var orden = [puntos[rot % 4], puntos[(rot + 1) % 4], puntos[(rot + 2) % 4], puntos[(rot + 3) % 4]];
				// Lado corto de la hoja (arriba) contra lado largo: 187.9 / 251.4
				var arriba = dist(orden[0], orden[1]) + dist(orden[2], orden[3]);
				var costado = dist(orden[1], orden[2]) + dist(orden[3], orden[0]);
				var prop = costado / arriba;
				if (prop < 1.0 || prop > 1.9) continue;
				var H = homografia(Hoja.MARCADORES, orden);
				if (!H) continue;
				var k = contrasteBarra(img, H);
				if (k < 25) continue;
				var puntaje = k + area / (chica.ancho * chica.alto) * 50;
				if (!mejor || puntaje > mejor.puntaje) mejor = { puntaje: puntaje, puntos: orden, contraste: k };
			}
		}
		if (!mejor) return { error: "orientacion", candidatos: cands.length };
		var afinados = mejor.puntos.map(function (p, i) { return afinar(img, p, mejor.puntos, i); });
		var H2 = homografia(Hoja.MARCADORES, afinados) || homografia(Hoja.MARCADORES, mejor.puntos);
		return { H: H2, puntos: afinados, contraste: mejor.contraste };
	}

	/*
		Afina el centro de un marcador en la imagen completa: centroide de lo oscuro en una
		ventana alrededor (umbral a la mitad entre el marcador y el papel de la ventana).
	*/
	function afinar(img, p, todos, i) {
		// Lado del marcador en px ≈ distancia entre marcadores × 10 / 188 (lado corto de la hoja)
		var vecino = todos[(i + 1) % 4], otro = todos[(i + 3) % 4];
		var escala = Math.min(dist(p, vecino) / 187.9, dist(p, otro) / 251.4) || 1;
		var r = Math.max(3, Math.round(escala * Hoja.MARCADOR.lado * 0.85));
		var x0 = Math.max(0, Math.round(p.x - r)), x1 = Math.min(img.ancho - 1, Math.round(p.x + r));
		var y0 = Math.max(0, Math.round(p.y - r)), y1 = Math.min(img.alto - 1, Math.round(p.y + r));
		var min = 255, max = 0;
		for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
			var v = img.datos[y * img.ancho + x];
			if (v < min) min = v; if (v > max) max = v;
		}
		if (max - min < 30) return p;
		var u = (min + max) / 2, s = 0, sx = 0, sy = 0;
		for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
			var w = u - img.datos[yy * img.ancho + xx];
			if (w <= 0) continue;
			s += w; sx += w * (xx + 0.5); sy += w * (yy + 0.5);
		}
		if (!s) return p;
		var q = { x: sx / s, y: sy / s };
		// Si se fue lejos (otra mancha en la ventana), se queda el de la imagen reducida
		return dist(p, q) > r * 0.5 ? p : q;
	}

	// ── Círculos ─────────────────────────────────────────────────────────────────
	var PUNTOS_INTERIOR = (function () {
		var pts = [];
		for (var y = -4; y <= 4; y++) for (var x = -4; x <= 4; x++) if (x * x + y * y <= 16) pts.push([x / 4, y / 4]);
		return pts;
	})();

	/*
		oscuridad(img, H, c) → 0 (papel) a 1 (negro). Interior: disco de 0.62 del radio (deja
		fuera el contorno impreso). Papel: anillo entre 1.3 y 1.45 radios (mediana).
	*/
	function oscuridad(img, H, c) {
		var R = Hoja.REJILLA.radio, ri = R * 0.62, s = 0, n = 0;
		for (var i = 0; i < PUNTOS_INTERIOR.length; i++) {
			var p = aplicar(H, c.x + PUNTOS_INTERIOR[i][0] * ri, c.y + PUNTOS_INTERIOR[i][1] * ri);
			var v = muestra(img, p.x, p.y);
			if (v === null) return null;
			s += v; n++;
		}
		var interior = s / n, anillo = [];
		for (var k = 0; k < 24; k++) {
			var ang = k * Math.PI / 12, rr = R * (k % 2 ? 1.3 : 1.45);
			var q = aplicar(H, c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
			var w = muestra(img, q.x, q.y);
			if (w !== null) anillo.push(w);
		}
		if (!anillo.length) return null;
		anillo.sort(function (a, b) { return a - b; });
		var papel = anillo[Math.floor(anillo.length * 0.6)];
		if (papel < 1) return 1;
		return Math.max(0, Math.min(1, 1 - interior / papel));
	}

	function percentil(lista, p) {
		if (!lista.length) return 0;
		var o = lista.slice().sort(function (a, b) { return a - b; });
		return o[Math.min(o.length - 1, Math.max(0, Math.floor(p * (o.length - 1))))];
	}

	/*
		leerRespuestas(img, H, disposicion) → { umbral, base, respuestas: [{ id, numero, letra,
		oscuridad: [..], dudosa }] }  letra: 'A'..'E' / 'V' / 'F', null (vacía) o '*' (doble).
	*/
	function leerRespuestas(img, H, disp) {
		var todas = [], filas = disp.map(function (d) {
			var os = d.circulos.map(function (c) { var o = oscuridad(img, H, c); return o === null ? 0 : o; });
			todas = todas.concat(os);
			return os;
		});
		var base = percentil(todas, 0.25), alto = percentil(todas, 0.95);
		var umbral = base + Math.max(0.12, (alto - base) * 0.35);
		var respuestas = disp.map(function (d, i) {
			var os = filas[i];
			var orden = os.map(function (v, j) { return { v: v, j: j }; }).sort(function (a, b) { return b.v - a.v; });
			var e1 = orden[0].v - base, e2 = orden.length > 1 ? orden[1].v - base : 0, T = umbral - base;
			var letra = null, dudosa = false;
			if (e1 >= T) {
				if (e2 >= T) {
					if (e2 < e1 * 0.55) { letra = d.letras[orden[0].j]; dudosa = true; } // borrón: vale la más oscura
					else letra = "*";
				} else {
					letra = d.letras[orden[0].j];
					if (e1 < T * 1.35 || e2 > T * 0.7) dudosa = true;
				}
			} else if (e1 > T * 0.7) {
				dudosa = true; // casi marcada: que la maestra la vea
			}
			return { id: d.id, numero: d.numero, letra: letra, oscuridad: os.map(function (v) { return Math.round(v * 1000) / 1000; }), dudosa: dudosa };
		});
		return { umbral: umbral, base: base, respuestas: respuestas };
	}

	// Escala de la foto en px por mm en el centro de la hoja
	function pxPorMm(H) {
		var c = aplicar(H, 107.95, 139.7), dx = aplicar(H, 117.95, 139.7), dy = aplicar(H, 107.95, 149.7);
		return Math.sqrt(dist(c, dx) * dist(c, dy)) / 10;
	}

	/*
		leerHoja(img, disposicion) → { ok, error, H, puntos, pxMm, umbral, respuestas }
		error: "marcadores" (no se ven los 4 cuadros), "orientacion" (no se ve la barra),
		"lejos" (la hoja se ve muy chica), "luz" (poco contraste).
	*/
	function leerHoja(img, disp, opciones) {
		var m = buscarMarcadores(img, opciones);
		if (m.error) return { ok: false, error: m.error };
		var pxMm = pxPorMm(m.H);
		if (pxMm < 1.6) return { ok: false, error: "lejos", H: m.H, puntos: m.puntos, pxMm: pxMm };
		if (m.contraste < 35) return { ok: false, error: "luz", H: m.H, puntos: m.puntos, pxMm: pxMm };
		var r = leerRespuestas(img, m.H, disp || []);
		return { ok: true, H: m.H, puntos: m.puntos, pxMm: pxMm, contraste: m.contraste, umbral: r.umbral, base: r.base, respuestas: r.respuestas };
	}

	// ── Enderezar (para mostrar y para el QR) ────────────────────────────────────
	function enderezar(img, H, escala, zona) {
		zona = zona || { x: 0, y: 0, ancho: Hoja.HOJA.ancho, alto: Hoja.HOJA.alto };
		var w = Math.round(zona.ancho * escala), h = Math.round(zona.alto * escala), d = new Uint8Array(w * h);
		for (var y = 0; y < h; y++) {
			for (var x = 0; x < w; x++) {
				var p = aplicar(H, zona.x + (x + 0.5) / escala, zona.y + (y + 0.5) / escala);
				var v = muestra(img, p.x, p.y);
				d[y * w + x] = v === null ? 255 : v;
			}
		}
		return { ancho: w, alto: h, datos: d };
	}

	function aRGBA(img) {
		var n = img.ancho * img.alto, out = new Uint8ClampedArray(n * 4);
		for (var i = 0, j = 0; i < n; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = img.datos[i]; out[j + 3] = 255; }
		return out;
	}

	// Zona del QR enderezada (con margen blanco) en RGBA, para jsQR
	function recorteQR(img, H, escala) {
		var Q = Hoja.QR, m = 3;
		var e = enderezar(img, H, escala || 8, { x: Q.x - m, y: Q.y - m, ancho: Q.lado + 2 * m, alto: Q.lado + 2 * m });
		return { ancho: e.ancho, alto: e.alto, rgba: aRGBA(e), gris: e };
	}

	/*
		leerQR(img, H, decodificar) → { examenId, alumnoId } | null
		decodificar(rgba, ancho, alto) → texto | null (jsQR en el navegador). Se prueba a dos
		escalas: la foto puede venir con poca resolución.
	*/
	function leerQR(img, H, decodificar) {
		if (!decodificar) return null;
		var escalas = [8, 5, 11];
		for (var i = 0; i < escalas.length; i++) {
			var r = recorteQR(img, H, escalas[i]);
			var texto = null;
			try { texto = decodificar(r.rgba, r.ancho, r.alto); } catch (e) { texto = null; }
			var q = texto ? Hoja.leerQR(texto) : null;
			if (q) return q;
		}
		return null;
	}

	var api = {
		gris: gris, reducir: reducir, muestra: muestra,
		homografia: homografia, aplicar: aplicar,
		umbralAdaptativo: umbralAdaptativo, candidatos: candidatos, buscarMarcadores: buscarMarcadores,
		oscuridad: oscuridad, leerRespuestas: leerRespuestas, leerHoja: leerHoja, pxPorMm: pxPorMm,
		enderezar: enderezar, aRGBA: aRGBA, recorteQR: recorteQR, leerQR: leerQR,
	};
	if (typeof window !== "undefined") window.ExamenLector = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
