/*
	Aviso para las familias en Mi grupo (js/aviso-familias.js; decisión de Jorge, 2026-09-25):
	  - el texto dice lo que la maestra lleva en Mi Salón (lista, asistencia, calificaciones, ficha
	    con fecha de nacimiento y datos del tutor, incidencias), que solo ella lo ve y que pueden
	    pedirle corregirlo o borrarlo; sin emojis;
	  - Compartir por WhatsApp: wa.me sin número, con el texto;
	  - la página tiene Copiar, Compartir por WhatsApp e Imprimir (44 px) y carga el script;
	  - al imprimir sale solo la hoja del aviso.

	node pruebas/aviso-familias.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const A = require(path.join(RAIZ, "js", "aviso-familias.js"));
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const t = A.TEXTO;
ok("dice qué lleva: lista, asistencia, calificaciones, ficha (fecha de nacimiento y tutor) e incidencias",
	[/lista del grupo/, /asistencia/, /calificaciones/, /ficha de cada alumno \(fecha de nacimiento y datos de la madre, padre o tutor\)/, /registro de incidencias/].map((r) => r.test(t)),
	[true, true, true, true, true]);
ok("dice que solo ella lo ve y que pueden pedir corregir o borrar", [/Solo yo veo esa información/.test(t), /corrijo o lo borro/.test(t)], [true, true]);
ok("dice que es Mi Salón, herramienta personal (no oficial)", /Mi Salón, una herramienta personal/.test(t), true);
ok("un solo párrafo corto (sin saltos, menos de 600 caracteres)", [/\n/.test(t), t.length < 600], [false, true]);
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;
ok("sin emojis", SIMBOLOS.test(t), false);
const wa = A.enlaceWhatsApp(t);
ok("WhatsApp: wa.me sin número, con el texto completo", [wa.indexOf("https://wa.me/?text=") === 0, decodeURIComponent(wa.slice("https://wa.me/?text=".length)) === t], [true, true]);

const html = leer("mi-grupo.html");
ok("Mi grupo: sección con Copiar, Compartir por WhatsApp e Imprimir",
	[/id="avisoFamilias"/, /id="avisoFamiliasCopiar"[\s\S]*?Copiar/, /id="avisoFamiliasWhatsApp"[^>]*target="_blank" rel="noopener noreferrer"[\s\S]*?Compartir por WhatsApp/, /id="avisoFamiliasImprimir"[\s\S]*?Imprimir/].map((r) => r.test(html)),
	[true, true, true, true]);
const seccion = html.slice(html.indexOf('id="avisoFamilias"'), html.indexOf("</section>", html.indexOf('id="avisoFamilias"')));
ok("botones de al menos 44 px", (seccion.match(/<(button|a) [^>]*>/g) || []).every((b) => /min-h-\[44px\]/.test(b)), true);
ok("carga js/aviso-familias.js antes de mi-grupo.js", html.indexOf('src="js/aviso-familias.js"') > 0 && html.indexOf('src="js/aviso-familias.js"') < html.indexOf('src="js/mi-grupo.js"'), true);
ok("al imprimir sale solo la hoja del aviso", /@media print \{[\s\S]*body\.imprime-aviso > \*:not\(#avisoFamiliasHoja\) \{ display: none !important; \}/.test(html), true);
ok("sin emojis en la sección", SIMBOLOS.test(seccion), false);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
process.exit(fallos ? 1 : 0);
