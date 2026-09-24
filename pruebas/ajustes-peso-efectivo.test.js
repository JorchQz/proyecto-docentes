/*
	Ajustes: la línea "vale X %" bajo cada peso (revisor R6, 2026-09-24).

	  - Bloqueante: el ".0" final se quitaba con /.0$/, con el punto sin escapar (cualquier
	    carácter). Con pesos efectivos de 10, 20… 100 salía "vale  %" o "vale 1 %". Ahora
	    solo se quita un ".0" de verdad.
	  - La frase decía "si los cuatro rubros tienen datos" aunque hubiera rubros en 0: ahora
	    cuenta solo los rubros con peso mayor que 0.
	Con los pesos reales del motor (MotorCalificacion.repartoEntero).

	node pruebas/ajustes-peso-efectivo.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
const M = require("../js/motor-calificacion.js");
const A = require("../js/ajustes.js");

// ── El número ───────────────────────────────────────────────────────────────
ok("10 → 10 (antes salía vacío)", A.numeroPeso(10), "10");
ok("20 → 20", A.numeroPeso(20), "20");
ok("100 → 100 (antes salía 1)", A.numeroPeso(100), "100");
ok("50 → 50", A.numeroPeso(50), "50");
ok("29.5 → 29.5", A.numeroPeso(29.5), "29.5");
ok("\"10.0\" → 10 (quita solo el .0 de verdad)", A.numeroPeso("10.0"), "10");
ok("6.3 → 6.3", A.numeroPeso(6.3), "6.3");
ok("0.5 → 0.5", A.numeroPeso(0.5), "0.5");

// ── Con los pesos efectivos reales del motor ───────────────────────────────
const rep = M.repartoEntero({ tareas: 10, trabajos: 20, participacion: 30, examen: 40 });
ok("reparto 10/20/30/40 da enteros", [rep.tareas, rep.trabajos, rep.participacion, rep.examen], [10, 20, 30, 40]);
ok("tareas: vale 10 %", A.textoEfectivo(rep.tareas, 4), "vale 10 % si los cuatro rubros tienen datos");
ok("trabajos: vale 20 %", A.textoEfectivo(rep.trabajos, 4), "vale 20 % si los cuatro rubros tienen datos");
ok("examen: vale 40 %", A.textoEfectivo(rep.examen, 4), "vale 40 % si los cuatro rubros tienen datos");
const solo = M.repartoEntero({ tareas: 0, trabajos: 0, participacion: 0, examen: 7 });
ok("un solo rubro con peso vale 100", solo.examen, 100);
ok("un solo rubro con peso: vale 100 % si tiene datos", A.textoEfectivo(solo.examen, 1), "vale 100 % si tiene datos");
const fabrica = M.repartoEntero({ tareas: 28, trabajos: 28, participacion: 6, examen: 33 });
ok("de fábrica: tareas 29.5", A.textoEfectivo(fabrica.tareas, 4), "vale 29.5 % si los cuatro rubros tienen datos");

// ── La frase cuenta los rubros con peso mayor que 0 ────────────────────────
const tres = M.repartoEntero({ tareas: 50, trabajos: 25, participacion: 0, examen: 25 });
ok("participación en 0: tres rubros con peso", A.textoEfectivo(tres.tareas, 3), "vale 50 % si los tres rubros con peso tienen datos");
ok("dos rubros con peso", A.textoEfectivo(50, 2), "vale 50 % si los dos rubros con peso tienen datos");

// ── El código de la página usa la parte pura y cuenta los rubros con peso ──
const fuente = require("fs").readFileSync(require("path").join(__dirname, "../js/ajustes.js"), "utf8");
ok("sin el punto sin escapar", /replace\(\/\.0\$\//.test(fuente), false);
ok("la página usa textoEfectivo con los rubros con peso", /AjustesTexto\.textoEfectivo\(v, conPeso\)/.test(fuente), true);
ok("conPeso cuenta los pesos mayores que 0", /conPeso = valores\.filter\(function \(v\) \{ return v > 0; \}\)\.length/.test(fuente), true);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTodo bien");
process.exit(fallos ? 1 : 0);
