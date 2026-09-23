/*
	Prueba del aviso "propuesta: N" de la boleta (B.3).

	No copia la lógica: extrae la función sincronizarAvisoPropuesta TAL CUAL está en
	js/reportes.js y la ejecuta contra un DOM mínimo. Si alguien la cambia o la
	renombra, esta prueba falla.

	node pruebas/aviso-propuesta.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}

const fuente = fs.readFileSync((process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js")), "utf8");

// La función real, extraída del archivo que se sirve al navegador
const extraida = fuente.match(/function sincronizarAvisoPropuesta[\s\S]*?\n\t\}/);
if (!extraida) {
	console.log("FALLA no se encontró sincronizarAvisoPropuesta en js/reportes.js");
	process.exit(1);
}
const colorCalif = function (v) { return v >= 9 ? "text-green-600" : v >= 7 ? "text-yellow-600" : "text-red-500"; };
const sincronizarAvisoPropuesta = new Function("colorCalif", "return " + extraida[0] + ";")(colorCalif);

// El render y la prueba deben hablar el mismo idioma de atributos
["data-cal-campo", "data-cal-propuesta", "data-cal-aviso"].forEach(function (attr) {
	ok("el render escribe " + attr, fuente.indexOf(attr + "='") !== -1, true);
});

// ── DOM mínimo ────────────────────────────────────────────────────────────────
function crearAviso() {
	const clases = new Set(["hidden"]);
	return {
		clases: clases,
		classList: {
			toggle: function (c, forzar) { if (forzar) clases.add(c); else clases.delete(c); },
		},
		get visible() { return !clases.has("hidden"); },
	};
}
function crearContenedor(avisosPorCampo) {
	return {
		querySelector: function (q) {
			const m = q.match(/data-cal-aviso='([^']+)'/);
			return (m && avisosPorCampo[m[1]]) || null;
		},
	};
}
function crearSelect(valor, propuesta, campo) {
	const ds = { calCampo: campo || "LEN" };
	if (propuesta !== null) ds.calPropuesta = String(propuesta);
	return { value: String(valor), dataset: ds, className: "" };
}

// 1. El maestro se aparta de la propuesta: el aviso aparece
let aviso = crearAviso();
let sel = crearSelect(7, 6);
sincronizarAvisoPropuesta(sel, crearContenedor({ LEN: aviso }));
ok("7 sobre propuesta 6 → aviso visible", aviso.visible, true);
ok("el selector se recolorea", sel.className.indexOf("text-yellow-600") !== -1, true);

// 2. Regresa al valor propuesto: el aviso se esconde otra vez
sel.value = "6";
sincronizarAvisoPropuesta(sel, crearContenedor({ LEN: aviso }));
ok("de vuelta en 6 → aviso oculto", aviso.visible, false);

// 3. Campo sin propuesta (sin evidencias): no truena ni muestra nada
aviso = crearAviso();
sel = crearSelect(8, null, "SAB");
sincronizarAvisoPropuesta(sel, crearContenedor({ SAB: aviso }));
ok("sin propuesta → aviso oculto", aviso.visible, false);

// 4. Cada campo toca solo su propio aviso
const avisoLEN = crearAviso(), avisoSAB = crearAviso();
sincronizarAvisoPropuesta(crearSelect(10, 6, "LEN"), crearContenedor({ LEN: avisoLEN, SAB: avisoSAB }));
ok("solo LEN se muestra", avisoLEN.visible, true);
ok("SAB queda intacto", avisoSAB.visible, false);

// 5. El piso de la fase se refleja en el color del 5 y del 6
sel = crearSelect(5, 6);
sincronizarAvisoPropuesta(sel, crearContenedor({ LEN: crearAviso() }));
ok("5 se pinta en rojo", sel.className.indexOf("text-red-500") !== -1, true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
