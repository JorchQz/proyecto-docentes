/*
	Lector de hojas de respuestas (js/examen-lector.js) y hoja (js/examen-hoja.js), con fotos
	sintéticas (pruebas/hoja-sintetica.js): giradas, en perspectiva, de cabeza, de lado, chicas,
	con sombra, desenfoque y ruido; con marcas normales, tenues, borrones, dobles y vacías.

	Revisa: homografía, contenido del QR, geometría de la hoja (nada se encima ni cae fuera de
	lo imprimible), tasa de acierto del lector, doble marca, vacía, marca tenue y los errores
	(sin hoja, hoja muy lejos).

	node pruebas/examen-lector.test.js
*/
const Hoja = require("../js/examen-hoja.js");
const Lector = require("../js/examen-lector.js");
const S = require("./hoja-sintetica.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado), bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

// ── Homografía ──────────────────────────────────────────────────────────────────
const de = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
const a = [{ x: 10, y: 20 }, { x: 300, y: 40 }, { x: 280, y: 610 }, { x: 30, y: 580 }];
const H = Lector.homografia(de, a);
const redondo = (p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
ok("homografía: las 4 esquinas caen exactas", de.map((p) => redondo(Lector.aplicar(H, p.x, p.y))), a.map((p) => [p.x, p.y]));
const Hi = Lector.homografia(a, de);
const ida = Lector.aplicar(H, 37, 121), vuelta = Lector.aplicar(Hi, ida.x, ida.y);
ok("homografía: ida y vuelta de un punto interior", redondo(vuelta), [37, 121]);
ok("homografía degenerada (3 puntos en línea) → null", Lector.homografia(de, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null);
const Hid = Lector.homografia(de, de);
ok("homografía identidad", Hid.map((v) => Math.round(v * 1e6) / 1e6), [1, 0, 0, 0, 1, 0, 0, 0, 1]);

// ── QR ──────────────────────────────────────────────────────────────────────────
const EX = "3f2b9c1e-8a4d-4e6f-9b0a-1c2d3e4f5a6b", AL = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const texto = Hoja.textoQR(EX, AL);
ok("QR personalizado: alfanumérico (mayúsculas sin guiones) y corto", [/^[0-9A-Z:]+$/.test(texto), texto.length], [true, 69]);
ok("QR personalizado: se lee de vuelta", Hoja.leerQR(texto), { examenId: EX, alumnoId: AL });
ok("QR genérico: solo el examen", Hoja.leerQR(Hoja.textoQR(EX)), { examenId: EX, alumnoId: null });
ok("QR ajeno: null", [Hoja.leerQR("https://jissez.com"), Hoja.leerQR("MS1:XYZ"), Hoja.leerQR("")], [null, null, null]);

// ── Geometría de la hoja ────────────────────────────────────────────────────────
const preguntas = [];
for (let i = 0; i < 70; i++) {
	const tipo = i % 7 === 3 ? "abierta" : (i % 7 === 5 ? "completar" : (i % 4 === 1 ? "verdadero_falso" : "opcion_multiple"));
	preguntas.push({ id: "q" + i, tipo, opciones: tipo === "opcion_multiple" ? ["a", "b", "c", "d", "e"].slice(0, 2 + (i % 4)) : null });
}
let lleno = null;
try { Hoja.disposicion(preguntas.map((p) => Object.assign({}, p, { tipo: "opcion_multiple", opciones: [1, 2, 3] }))); } catch (e) { lleno = e.message; }
ok("más de " + Hoja.MAX_AUTOMATICAS + " automáticas: la hoja no las admite", /admite 63/.test(lleno || ""), true);
const pocas = preguntas.slice(0, 40);
const disp = Hoja.disposicion(pocas);
ok("solo las automáticas llevan círculos", disp.length, pocas.filter((p) => Hoja.esAutomatica(p.tipo)).length);
ok("cada renglón lleva el número de la pregunta en el examen", disp.slice(0, 4).map((d) => d.numero), [1, 2, 3, 5]);
ok("verdadero o falso: V y F", disp.find((d) => d.id === "q1").letras, ["V", "F"]);
ok("opción múltiple: tantas letras como opciones", [disp.find((d) => d.id === "q2").letras, disp.find((d) => d.id === "q7").letras], [["A", "B", "C", "D"], ["A", "B", "C", "D", "E"]]);
const todos = Hoja.disposicion(preguntas.filter((p) => Hoja.esAutomatica(p.tipo)).slice(0, 63).map((p) => Object.assign({}, p, { tipo: "opcion_multiple", opciones: [1, 2, 3, 4, 5] })));
const circ = [].concat(...todos.map((d) => d.circulos));
const R = Hoja.REJILLA.radio, M = Hoja.MARCADOR;
const chocaMarcador = circ.some((c) => Hoja.MARCADORES.some((m) => Math.abs(c.x - m.x) < M.lado / 2 + R + 1 && Math.abs(c.y - m.y) < M.lado / 2 + R + 1));
const chocaQR = circ.some((c) => c.y - R < Hoja.QR.y + Hoja.QR.lado + 2);
const fuera = circ.some((c) => c.x - R < 12 || c.x + R > Hoja.HOJA.ancho - 12 || c.y + R > Hoja.HOJA.alto - 12);
let encimados = false;
for (let i = 0; i < circ.length && !encimados; i++) for (let j = i + 1; j < circ.length; j++) {
	if (Math.hypot(circ[i].x - circ[j].x, circ[i].y - circ[j].y) < 2 * R + 1.5) { encimados = true; break; }
}
ok("63 renglones de 5 círculos: sin tocar marcadores, QR ni orillas, y sin encimarse", [chocaMarcador, chocaQR, fuera, encimados], [false, false, false, false]);
ok("marcadores dentro del área que imprime cualquier impresora (≥ 6.35 mm)", Hoja.MARCADORES.every((m) => m.x - M.lado / 2 >= 6.35 && m.y - M.lado / 2 >= 6.35 && m.x + M.lado / 2 <= Hoja.HOJA.ancho - 6.35 && m.y + M.lado / 2 <= Hoja.HOJA.alto - 6.35), true);
const svg = Hoja.hojaSVG({ examen: { id: EX, titulo: "Examen <1>" }, preguntas: pocas, alumno: { id: AL, nombre: "JOSÉ PEÑA", grado: 3 }, grupo: "3° y 4°", matriz: S.matrizAlAzar(S.azar(1), 33) });
ok("SVG: tamaño carta en mm, nombre, título escapado y 4 marcadores", [/width='215.9mm' height='279.4mm'/.test(svg), svg.includes("JOSÉ PEÑA"), svg.includes("Examen &lt;1&gt;"), (svg.match(/width='10' height='10' fill='#000'/g) || []).length], [true, true, true, 4]);
const generica = Hoja.hojaSVG({ examen: { id: EX, titulo: "T" }, preguntas: pocas, alumno: null, matriz: S.matrizAlAzar(S.azar(1), 33) });
ok("hoja genérica: renglón en blanco para el nombre", /Nombre:<\/text><line/.test(generica), true);

// ── Lector con fotos sintéticas ─────────────────────────────────────────────────
const rnd = S.azar(2026);
const POSES = [
	{ nombre: "derecha", giro: 0 },
	{ nombre: "girada 7°", giro: 7, sombra: 0.25 },
	{ nombre: "girada -12°", giro: -12, pxMm: 3.0 },
	{ nombre: "perspectiva", giro: -4, perspectiva: 0.12, sombra: 0.45 },
	{ nombre: "perspectiva fuerte", giro: 3, perspectiva: 0.2, pxMm: 3.3 },
	{ nombre: "de cabeza", giro: 179 },
	{ nombre: "de lado", giro: 90, pxMm: 2.9 },
	{ nombre: "chica y borrosa", pxMm: 2.1, dx: 90, desenfoque: true, ruido: 10 },
	{ nombre: "sombra fuerte", giro: 2, sombra: 0.55, ruido: 9 },
	{ nombre: "desenfocada", giro: -3, desenfoque: true, pxMm: 2.6 },
];
const soloAuto = pocas.filter((p) => Hoja.esAutomatica(p.tipo));
const dispAuto = Hoja.disposicion(pocas);
let total = 0, bien = 0, hojasLeidas = 0, dobles = [0, 0], vacias = [0, 0], tenues = [0, 0], borrones = [0, 0], falsasMarcas = 0;
const errores = [];
POSES.forEach((pose, k) => {
	// Respuestas del alumno: al azar, con 2 vacías, 2 dobles, 2 tenues y 1 borrón por hoja
	const marcas = {}, estilo = {};
	dispAuto.forEach((d) => { marcas[d.id] = d.letras[Math.floor(rnd() * d.letras.length)]; });
	const ids = dispAuto.map((d) => d.id);
	const elegir = () => ids.splice(Math.floor(rnd() * ids.length), 1)[0];
	const vac = [elegir(), elegir()], dob = [elegir(), elegir()], ten = [elegir(), elegir()], bor = [elegir()];
	vac.forEach((id) => { marcas[id] = []; });
	dob.forEach((id) => { const d = dispAuto.find((x) => x.id === id); marcas[id] = [d.letras[0], d.letras[d.letras.length - 1]]; });
	ten.forEach((id) => { estilo[id] = "debil"; });
	bor.forEach((id) => { const d = dispAuto.find((x) => x.id === id); estilo[id] = "borron:" + d.letras.find((l) => l !== marcas[id]); });
	const ideal = S.hojaIdeal({ disposicion: dispAuto, marcas, estilo, semilla: 100 + k });
	const img = S.foto(ideal, Object.assign({ esquinas: S.esquinas(pose), semilla: 50 + k }, pose));
	const r = Lector.leerHoja(img, dispAuto);
	if (!r.ok) { errores.push(pose.nombre + ": " + r.error); total += dispAuto.length; return; }
	hojasLeidas++;
	r.respuestas.forEach((x) => {
		total++;
		const m = [].concat(marcas[x.id]);
		const esperado = m.length === 0 ? null : (m.length > 1 ? "*" : m[0]);
		if (x.letra === esperado) bien++;
		else errores.push(pose.nombre + " #" + x.numero + ": leyó " + x.letra + ", era " + esperado);
		if (dob.includes(x.id)) { dobles[1]++; if (x.letra === "*") dobles[0]++; }
		if (vac.includes(x.id)) { vacias[1]++; if (x.letra === null) vacias[0]++; }
		if (ten.includes(x.id)) { tenues[1]++; if (x.letra === esperado) tenues[0]++; }
		if (bor.includes(x.id)) { borrones[1]++; if (x.letra === esperado) borrones[0]++; }
		if (esperado === null && x.letra !== null) falsasMarcas++;
	});
});
const tasa = Math.round((bien / total) * 10000) / 100;
console.log("\n  Tasa de acierto del lector: " + bien + " de " + total + " respuestas (" + tasa + " %), " + hojasLeidas + " de " + POSES.length + " hojas.");
console.log("  Dobles " + dobles.join("/") + ", vacías " + vacias.join("/") + ", tenues " + tenues.join("/") + ", borrones " + borrones.join("/") + ".");
if (errores.length) console.log("  Diferencias: " + errores.join(" | "));
ok("se leen todas las hojas (" + POSES.length + " fotos)", hojasLeidas, POSES.length);
ok("tasa de acierto ≥ 99 %", tasa >= 99, true);
ok("doble marca detectada en todas", dobles[0], dobles[1]);
ok("vacía detectada en todas", vacias[0], vacias[1]);
ok("marca tenue leída en todas", tenues[0], tenues[1]);
ok("un borrón junto a la marca no cuenta como doble", borrones[0], borrones[1]);
ok("ninguna marca inventada en una pregunta vacía", falsasMarcas, 0);

// Hoja en blanco: todo vacío, nada inventado
const blanca = S.foto(S.hojaIdeal({ disposicion: dispAuto, marcas: {}, semilla: 9 }), { esquinas: S.esquinas({ giro: 4 }), sombra: 0.3 });
const rb = Lector.leerHoja(blanca, dispAuto);
ok("hoja sin contestar: se lee y todo queda vacío", [rb.ok, rb.ok && rb.respuestas.every((x) => x.letra === null)], [true, true]);

// La hoja enderezada conserva los marcadores en su lugar (se usa para mostrar y para el QR)
const ideal0 = S.hojaIdeal({ disposicion: dispAuto, marcas: {}, semilla: 3 });
const r0 = Lector.leerHoja(S.foto(ideal0, { esquinas: S.esquinas({ giro: 10, perspectiva: 0.1 }) }), dispAuto);
const der = Lector.enderezar({ ancho: 1, alto: 1, datos: new Uint8Array(1) }, r0.H, 1);
ok("enderezar: tamaño carta a la escala pedida", [der.ancho, der.alto], [216, 279]);
const derecha = Lector.enderezar(S.foto(ideal0, { esquinas: S.esquinas({ giro: 10, perspectiva: 0.1 }) }), r0.H, 2);
const px = (x, y) => derecha.datos[Math.round(y * 2) * derecha.ancho + Math.round(x * 2)];
ok("enderezar: los 4 marcadores quedan negros y el papel blanco", [Hoja.MARCADORES.every((m) => px(m.x, m.y) < 80), px(140, 150) > 160], [true, true]);
const qr = Lector.recorteQR(S.foto(ideal0, { esquinas: S.esquinas({ giro: 10 }) }), r0.H, 8);
ok("recorte del QR en RGBA para jsQR", [qr.ancho, qr.alto, qr.rgba.length], [352, 352, 352 * 352 * 4]);
ok("leerQR sin decodificador: null (la pantalla pide elegir al alumno)", Lector.leerQR(blanca, rb.H, null), null);
ok("leerQR con un decodificador que devuelve el texto de la hoja", Lector.leerQR(blanca, rb.H, () => Hoja.textoQR(EX, AL)), { examenId: EX, alumnoId: AL });

// Errores
const mesa = { ancho: 640, alto: 480, datos: new Uint8Array(640 * 480).fill(120) };
ok("sin hoja: error de marcadores", Lector.leerHoja(mesa, dispAuto).error, "marcadores");
const lejos = S.foto(ideal0, { esquinas: S.esquinas({ pxMm: 1.2 }), desenfoque: true });
const rl = Lector.leerHoja(lejos, dispAuto);
ok("hoja muy lejos: no se lee (pide acercarse)", rl.ok, false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
