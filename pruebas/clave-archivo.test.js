/*
	Nombres de archivo al subir recursos en Crear proyecto (js/clave-archivo.js).
	Storage respondía "Invalid key" con «3° 'B'.pdf» (°, apóstrofo, comillas, acentos, ñ):
	  - la clave queda solo con letras y números ASCII, punto, guion y guion bajo;
	  - la extensión se conserva (en minúsculas);
	  - dos nombres que quedan iguales reciben sufijo;
	  - el nombre ORIGINAL se conserva y se muestra escapado (js/crear_proyecto.js).

	node pruebas/clave-archivo.test.js
*/
const fs = require("fs");
const path = require("path");
const K = require("../js/clave-archivo.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

// Lo que acepta Storage sin "Invalid key" (subconjunto conservador de su lista de caracteres seguros)
const SEGURA = /^[A-Za-z0-9._-]+$/;

ok("3° 'B'.pdf", K.clave("3° 'B'.pdf"), "3-B.pdf");
ok("acentos y ñ", K.clave("Guía de lectura (ñandú).docx"), "Guia-de-lectura-nandu.docx");
ok("comillas dobles y tipográficas", K.clave("El “mejor” \"cartel\".PNG"), "El-mejor-cartel.png");
ok("diéresis y mayúsculas", K.clave("PINGÜINO Ártico.JPG"), "PINGUINO-Artico.jpg");
ok("sin extensión", K.clave("Mi archivo"), "Mi-archivo");
ok("solo símbolos: «archivo» con su extensión", K.clave("°°° ''.pdf"), "archivo.pdf");
ok("nombre vacío", K.clave(""), "archivo");
ok("oculto (.pdf): se toma como nombre, no como extensión", K.clave(".pdf"), "pdf");
ok("barras y rutas no crean carpetas", K.clave("../../otro/usuario.pdf"), "otro-usuario.pdf");
ok("emojis y símbolos fuera de ASCII", K.clave("Tarea \u{1F600} #1 & 50% ¿sí?.pdf"), "Tarea-1-50-si.pdf");
ok("largo acotado", K.clave("a".repeat(300) + ".pdf").length <= 84, true);
ok("extensión rara larga: queda en el nombre", K.clave("reporte.final-version-larguisima"), "reporte.final-version-larguisima");

const casos = ["3° 'B'.pdf", "Guía (ñandú).docx", "\"x\".txt", "°", "a b c.PDF", "ñ", "Año 2° — 'grupo' «A».pdf", "\u{1F4DA}.png", "  espacios  .pdf "];
ok("todas las claves son seguras para Storage", casos.map(K.clave).every((c) => SEGURA.test(c)), true);

// Sufijo único
ok("sin choque: sin sufijo", K.unica("3° 'B'.pdf", []), "3-B.pdf");
ok("choque con una ruta completa ya subida: -2", K.unica("3 B.pdf", ["recursos/u/temp/sesion_1/3-B.pdf"]), "3-B-2.pdf");
ok("choque doble: -3", K.unica("3° B.pdf", ["3-B.pdf", "3-B-2.pdf"]), "3-B-3.pdf");
ok("el choque no distingue mayúsculas", K.unica("a.PDF", ["A.pdf"]), "a-2.pdf");

// Crear proyecto usa la clave normalizada y escapa el nombre original
const cp = fs.readFileSync(path.join(__dirname, "..", "js", "crear_proyecto.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "crear_proyecto.html"), "utf8");
ok("la ruta ya no lleva file.name tal cual", /sesion_\$\{num\}\/\$\{file\.name\}/.test(cp), false);
ok("la ruta usa ClaveArchivo.unica", /ClaveArchivo\.unica\(file\.name/.test(cp), true);
ok("se guarda el nombre original aparte", /archivosSubidos\.push\(\{ nombre: file\.name, path: ruta/.test(cp), true);
ok("ningún file.name ni ruta se pinta sin escapar", /\$\{String\((file\.name|ruta)|\$\{file\.name\}|\$\{String\(truncarTexto\(file/.test(cp), false);
ok("el chip de «Subiendo...» escapa el nombre", /title="\$\{escapeHtml\(file\.name\)\}">\$\{escapeHtml\(truncarTexto\(file\.name, 30\)\)\} · Subiendo/.test(cp), true);
ok("si la subida falla, el chip de «Subiendo...» se quita", /catch \(errorSubida\) \{\s*pendingChip\.remove\(\)/.test(cp), true);
ok("crear_proyecto.html carga clave-archivo.js antes de crear_proyecto.js",
	html.indexOf('src="js/clave-archivo.js"') !== -1 && html.indexOf('src="js/clave-archivo.js"') < html.indexOf('src="js/crear_proyecto.js"'), true);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
process.exit(fallos ? 1 : 0);
