/*
	hoja-sintetica.js — Fotos falsas de hojas de respuestas llenas, para probar el lector
	(js/examen-lector.js) sin cámara. No es una prueba: lo usan pruebas/examen-lector.test.js y
	los recorridos de QA (que también sacan de aquí el video falso de la cámara).

	1. La hoja ideal se dibuja en grises a 4 px por mm con la geometría de js/examen-hoja.js:
	   marcadores, barra, QR (la matriz que se pase; si no, un patrón al azar), texto de relleno,
	   círculos con su letra y las marcas del alumno:
	     normal  → lápiz (gris 55-85, sin llenar del todo el círculo)
	     debil   → marca tenue (gris 150-165)
	     borron  → marca borrada (gris 205) junto a la buena
	2. La "foto": la hoja se pone con una homografía (4 esquinas donde se quiera: girada, en
	   perspectiva, chica) sobre una mesa con textura, con sombra (luz dispareja), ruido y un poco
	   de desenfoque. Salida { ancho, alto, datos } en grises.

	Todo es determinista (generador de números al azar con semilla).
*/
const Hoja = require("../js/examen-hoja.js");
const Lector = require("../js/examen-lector.js");

function azar(semilla) {
	let s = semilla >>> 0 || 1;
	return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const PXMM = 4;

function lienzo(ancho, alto, fondo) {
	const d = new Uint8Array(ancho * alto).fill(fondo);
	return { ancho, alto, datos: d };
}
function rect(c, x, y, w, h, v) {
	const x0 = Math.max(0, Math.round(x * PXMM)), x1 = Math.min(c.ancho, Math.round((x + w) * PXMM));
	const y0 = Math.max(0, Math.round(y * PXMM)), y1 = Math.min(c.alto, Math.round((y + h) * PXMM));
	for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) c.datos[yy * c.ancho + xx] = v;
}
function disco(c, cx, cy, r, v, rnd, huecos) {
	const x0 = Math.floor((cx - r) * PXMM), x1 = Math.ceil((cx + r) * PXMM);
	const y0 = Math.floor((cy - r) * PXMM), y1 = Math.ceil((cy + r) * PXMM);
	for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
		const dx = (xx + 0.5) / PXMM - cx, dy = (yy + 0.5) / PXMM - cy;
		if (dx * dx + dy * dy > r * r) continue;
		if (huecos && rnd() < huecos) continue;
		const val = v + (rnd ? Math.round((rnd() - 0.5) * 24) : 0);
		const i = yy * c.ancho + xx;
		c.datos[i] = Math.min(c.datos[i], Math.max(0, Math.min(255, val)));
	}
}
function anillo(c, cx, cy, r, grosor, v) {
	const x0 = Math.floor((cx - r - grosor) * PXMM), x1 = Math.ceil((cx + r + grosor) * PXMM);
	const y0 = Math.floor((cy - r - grosor) * PXMM), y1 = Math.ceil((cy + r + grosor) * PXMM);
	for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
		const dx = (xx + 0.5) / PXMM - cx, dy = (yy + 0.5) / PXMM - cy, d = Math.sqrt(dx * dx + dy * dy);
		if (Math.abs(d - r) <= grosor / 2) c.datos[yy * c.ancho + xx] = Math.min(c.datos[yy * c.ancho + xx], v);
	}
}

function matrizAlAzar(rnd, n) {
	const m = [];
	for (let r = 0; r < n; r++) { const f = []; for (let c = 0; c < n; c++) f.push(rnd() < 0.5); m.push(f); }
	[[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r0, c0]) => {
		for (let r = -1; r < 8; r++) for (let c = -1; c < 8; c++) {
			const rr = r0 + r, cc = c0 + c;
			if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
			const borde = r === 0 || r === 6 || c === 0 || c === 6, centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
			m[rr][cc] = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (borde || centro);
		}
	});
	return m;
}

/*
	hojaIdeal({ disposicion, marcas: { idPregunta: "A" | ["A","C"] }, estilo: { idPregunta:
	"debil"|"borron:B" }, matriz, semilla }) → lienzo de la hoja a 4 px/mm
*/
function hojaIdeal(o) {
	const rnd = azar(o.semilla || 7);
	const W = Math.round(Hoja.HOJA.ancho * PXMM), H = Math.round(Hoja.HOJA.alto * PXMM);
	const c = lienzo(W, H, 240);
	Hoja.MARCADORES.forEach((m) => rect(c, m.x - 5, m.y - 5, 10, 10, 18));
	const B = Hoja.BARRA; rect(c, B.x, B.y, B.ancho, B.alto, 18);
	// Texto del encabezado: renglones de "letras" (manchitas)
	[18, 26, 36, 44, 52, 71].forEach((y) => {
		let x = 24;
		const fin = y === 71 ? 180 : 150;
		while (x < fin) { const w = 1 + rnd() * 2.2; rect(c, x, y - 3, w, 3.2, 60 + Math.round(rnd() * 40)); x += w + 0.8 + (rnd() < 0.15 ? 2 : 0); }
	});
	// QR
	const Q = Hoja.QR, m = o.matriz || matrizAlAzar(rnd, 33), total = m.length + 8, mod = Q.lado / total;
	for (let r = 0; r < m.length; r++) for (let cc = 0; cc < m.length; cc++) {
		if (m[r][cc]) rect(c, Q.x + (cc + 4) * mod, Q.y + (r + 4) * mod, mod, mod, 15);
	}
	// Círculos, números y marcas
	const R = Hoja.REJILLA.radio;
	(o.disposicion || []).forEach((d) => {
		rect(c, d.xNumero - 2.4, d.y - 1.4, 2.4, 2.8, 40);
		const marcadas = [].concat((o.marcas || {})[d.id] || []);
		const estilo = (o.estilo || {})[d.id] || "";
		d.circulos.forEach((ci) => {
			anillo(c, ci.x, ci.y, R, 0.35, 110);
			rect(c, ci.x - 0.7, ci.y - 1.0, 1.4, 2.0, 175); // la letra en gris claro
			if (marcadas.indexOf(ci.letra) !== -1) {
				if (estilo === "debil") disco(c, ci.x, ci.y, R * 0.85, 158, rnd, 0.1);
				else disco(c, ci.x, ci.y, R * (0.8 + rnd() * 0.15), 60 + Math.round(rnd() * 25), rnd, 0.06);
			}
			if (estilo.indexOf("borron:") === 0 && estilo.slice(7) === ci.letra) disco(c, ci.x, ci.y, R * 0.85, 205, rnd, 0.2);
		});
	});
	return c;
}

/*
	foto(ideal, { ancho, alto, esquinas: [4 puntos px: arriba-izq, arriba-der, abajo-der,
	abajo-izq de la HOJA], sombra: 0..0.6, ruido: 0..20, desenfoque: bool, semilla, fondo })
*/
function foto(ideal, o) {
	const rnd = azar(o.semilla || 3);
	const W = o.ancho || 1280, Hh = o.alto || 960;
	const hojaPx = [{ x: 0, y: 0 }, { x: ideal.ancho, y: 0 }, { x: ideal.ancho, y: ideal.alto }, { x: 0, y: ideal.alto }];
	const Hinv = Lector.homografia(o.esquinas, hojaPx); // foto → hoja ideal (px)
	const out = new Uint8Array(W * Hh);
	const sombra = o.sombra || 0, ruido = o.ruido === undefined ? 6 : o.ruido;
	const fondo = o.fondo === undefined ? 95 : o.fondo;
	for (let y = 0; y < Hh; y++) {
		for (let x = 0; x < W; x++) {
			const p = Lector.aplicar(Hinv, x + 0.5, y + 0.5);
			let v;
			if (p.x >= 0 && p.y >= 0 && p.x < ideal.ancho - 1 && p.y < ideal.alto - 1) v = Lector.muestra(ideal, p.x, p.y);
			else v = fondo + ((x * 7 + y * 13) % 23) - 11; // mesa con vetas
			// Luz dispareja: más oscuro hacia la derecha y abajo
			const luz = 1 - sombra * Math.min(1, Math.max(0, (x / W) * 0.7 + (y / Hh) * 0.5 - 0.2));
			v = v * luz + (rnd() - 0.5) * 2 * ruido;
			out[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
		}
	}
	let img = { ancho: W, alto: Hh, datos: out };
	if (o.desenfoque) img = caja3(img);
	return img;
}

function caja3(img) {
	const { ancho: w, alto: h, datos: d } = img, o = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		let s = 0, n = 0;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const xx = x + dx, yy = y + dy;
			if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
			s += d[yy * w + xx]; n++;
		}
		o[y * w + x] = Math.round(s / n);
	}
	return { ancho: w, alto: h, datos: o };
}

// Esquinas de la hoja en la foto: centrada, con escala (px por mm), giro (grados) y perspectiva
function esquinas(o) {
	const W = o.ancho || 1280, Hh = o.alto || 960, s = o.pxMm || 3.2, ang = (o.giro || 0) * Math.PI / 180;
	const hw = Hoja.HOJA.ancho * s / 2, hh = Hoja.HOJA.alto * s / 2, cx = W / 2 + (o.dx || 0), cy = Hh / 2 + (o.dy || 0);
	const p = o.perspectiva || 0; // encoge el lado de arriba (hoja inclinada hacia atrás)
	const base = [[-hw * (1 - p), -hh], [hw * (1 - p), -hh], [hw, hh], [-hw, hh]];
	return base.map(([x, y]) => ({ x: cx + x * Math.cos(ang) - y * Math.sin(ang), y: cy + x * Math.sin(ang) + y * Math.cos(ang) }));
}

module.exports = { azar, hojaIdeal, foto, esquinas, matrizAlAzar, PXMM };
