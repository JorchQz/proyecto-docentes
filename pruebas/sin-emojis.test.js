/*
	Regla dura del proyecto (CLAUDE.md): nada de emojis en la UI del SaaS.

	Barre todas las páginas y scripts del SaaS (no la tienda) buscando pictogramas y
	símbolos que los navegadores pintan como emoji de color: flechas decorativas,
	símbolos técnicos (⏱ ⏸), geométricos (▶ ▼), dingbats (✓ ✕), suplementarios y el
	selector de variación FE0F. Las flechas tipográficas → y ← sí están permitidas.

	Se agregó el 2026-09-23 porque la primera limpieza solo buscaba el rango de emoji
	"clásico" y dejó pasar ⏱ ⏸ ▶ ⬇, que el revisor vio en pantalla.

	node pruebas/sin-emojis.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/gu;
const PERMITIDOS = new Set(["→", "←"]);

const archivos = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html")).map((f) => f)
	.concat(fs.readdirSync(path.join(RAIZ, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f));

let hallazgos = 0;
archivos.forEach((f) => {
	fs.readFileSync(path.join(RAIZ, f), "utf8").split(/\r?\n/).forEach((linea, i) => {
		const encontrados = [...linea.matchAll(SIMBOLOS)].map((m) => m[0]).filter((c) => !PERMITIDOS.has(c));
		if (encontrados.length) {
			hallazgos++;
			console.log("FALLA " + f + ":" + (i + 1) + " → " + encontrados.join(" ") + "  " + linea.trim().slice(0, 90));
		}
	});
});
console.log("Revisados " + archivos.length + " archivos del SaaS.");
console.log(hallazgos === 0 ? "\nTODAS PASAN" : "\n" + hallazgos + " FALLAS");
process.exit(hallazgos ? 1 : 0);
