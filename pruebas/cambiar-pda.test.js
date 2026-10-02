/*
	"Cambiar PDA" en Crear proyecto (2026-10-02): un grado con 2 o más PDA en una sesión SIN trabajar se
	puede editar (cambiar, agregar, quitar). La regla de guardar, sin base de datos:
	  - un PDA que se conserva es la MISMA fila de sesiones_pda (no se inserta ni se borra; solo cambia su criterio),
	  - uno nuevo crea fila, uno quitado se borra solo si nada lo referencia,
	  - los productos del grado se ligan a todos los PDA del grado: el que reemplaza a otro hereda sus ligas.
	Se arma el pda_sesion como lo arma la pantalla (pdaSesionConservando con `lista`) y se le pasa al
	materializador (SesionesMaterializar.planificar).

	node pruebas/cambiar-pda.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "PASS " : "FAIL ") + nombre + (bien ? "" : "\n   esperado: " + JSON.stringify(esperado) + "\n   real:     " + JSON.stringify(real)));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

global.window = {};
require("../js/campos-formativos.js");
require("../js/sesiones-materializar.js");
const SM = global.window.SesionesMaterializar;
const PE = require("../js/proyecto-edicion.js");

const e = (grado, pda, criterio) => ({ grado, pda_id: pda, pda_texto: "Texto " + pda, criterio_aplicado: criterio || null });
// Sesión de la tienda: 1° con dos PDA (a1, a2) y 2° con uno (b1)
const original = [e(1, "a1", "Criterio a1"), e(1, "a2", "Criterio a2"), e(2, "b1", null)];
const spdaBase = [
	{ id: "r-a1", sesion_id: "s1", pda_id: "a1", grado: 1, criterio_aplicado: "Criterio a1" },
	{ id: "r-a2", sesion_id: "s1", pda_id: "a2", grado: 1, criterio_aplicado: "Criterio a2" },
	{ id: "r-b1", sesion_id: "s1", pda_id: "b1", grado: 2, criterio_aplicado: null },
];
const productos = [
	{ id: "p1", sesion_id: "s1", tipo: "trabajo", nombre: "Producto — Sesión 1 · LEN", grados: ["1"], campo: "LEN", modalidad: "diferenciada", created_at: "2026-01-01" },
	{ id: "p2", sesion_id: "s1", tipo: "trabajo", nombre: "Producto — Sesión 1 · LEN", grados: ["2"], campo: "LEN", modalidad: "diferenciada", created_at: "2026-01-02" },
];
const sesion = (pda) => ({ id: "s1", numero_sesion: 1, campo_formativo: "Lenguajes", pda_sesion: pda, cierre_tareas: null });
const opts = { gradosProyecto: [1, 2], camposProyecto: ["Lenguajes"] };
const plan = (pda) => SM.planificar([sesion(pda)], { spda: spdaBase, productos }, Object.assign({ anteriores: { s1: sesion(original) } }, opts));
// La pantalla: grado 1 con la lista editada, grado 2 con su selector de siempre
const guarda = (lista1) => PE.pdaSesionConservando([
	{ grado: 1, lista: lista1, representable: true, entrada: null },
	{ grado: 2, representable: true, entrada: original[2] },
], original);

// 1. Abrir el editor y no cambiar nada: el mismo pda_sesion, el plan no escribe nada
const igual = guarda([original[0], original[1]]);
ok("sin cambios: pda_sesion igual al guardado", PE.mismoValor(igual, original), true);
const p0 = plan(igual);
ok("sin cambios: ni inserta, ni borra, ni actualiza sesiones_pda", [p0.spdaInsertar.length, p0.spdaBorrar.length, p0.spdaActualizar.length], [0, 0, 0]);

// 2. Cambiar el criterio de uno: la misma fila, solo se actualiza el criterio
const crit = guarda([original[0], e(1, "a2", "Otro criterio")]);
const p1 = plan(crit);
ok("criterio: la fila se actualiza (mismo id), sin insertar ni borrar",
	[p1.spdaActualizar, p1.spdaInsertar.length, p1.spdaBorrar.length], [[{ id: "r-a2", criterio_aplicado: "Otro criterio" }], 0, 0]);

// 3. Cambiar el PDA de un renglón (a2 -> a3): a1 se conserva (mismo id), a3 es nuevo, a2 se borra
const cambia = guarda([original[0], e(1, "a3", null)]);
const p2 = plan(cambia);
ok("reemplazo: a3 crea fila", p2.spdaInsertar.map((r) => r.pda_id), ["a3"]);
ok("reemplazo: a2 se borra, a1 se conserva", p2.spdaBorrar, ["r-a2"]);
ok("reemplazo: no se actualiza nada de a1", p2.spdaActualizar, []);
const c2 = PE.cambiosDePda(PE.pdaGuardadosDeGrado(original, 1), PE.pdaGuardadosDeGrado(cambia, 1));
ok("cambiosDePda: conservados / nuevos / quitados", [c2.conservados.map((p) => p.pda_id), c2.nuevos.map((p) => p.pda_id), c2.quitados.map((p) => p.pda_id)], [["a1"], ["a3"], ["a2"]]);

// 4. Agregar uno
const agrega = guarda([original[0], original[1], e(1, "a3", "Nuevo")]);
const p3 = plan(agrega);
ok("agregar: solo inserta el nuevo", [p3.spdaInsertar.map((r) => r.pda_id), p3.spdaBorrar.length], [["a3"], 0]);
ok("agregar: queda el grado 2 como estaba", agrega.filter((p) => p.grado === 2), [original[2]]);

// 5. Quitar uno: se queda con el otro (1 PDA, vuelve al selector normal al abrir)
const quita = guarda([original[0]]);
const p4 = plan(quita);
ok("quitar: se borra a2", p4.spdaBorrar, ["r-a2"]);
ok("quitar: queda un PDA en 1°", PE.pdaGuardadosDeGrado(quita, 1).map((p) => p.pda_id), ["a1"]);

// 6. Dejar el grado en 0 (la pantalla pide confirmar): se borran los dos, el 2° no se toca
const cero = guarda([]);
const p5 = plan(cero);
ok("cero: se borran los dos de 1° y nada del 2°", p5.spdaBorrar.sort(), ["r-a1", "r-a2"]);
ok("cero: el grado 2 sigue igual", cero, [original[2]]);

// 7. Las ligas del plan: un producto liga TODOS los PDA de su grado (el que reemplaza hereda; quitar sin reemplazo deja los demás).
// Las ligas se calculan en materializarSesiones con spda + productos; aquí se verifica con la misma lógica que usa la regla de protección.
const spdaA2 = { id: "r-a2", grado: 1 };
ok("protección: liga del plan (producto del campo y grado del PDA) NO protege",
	PE.motivoDeProteccion(spdaA2, { ligas: [{ sesion_pda_id: "r-a2", campo: "LEN", grados: ["1"] }] }, "LEN"), null);
ok("protección: liga de un producto de otro campo NO protege (el materializador ya la quita de un PDA del plan)",
	PE.motivoDeProteccion(spdaA2, { ligas: [{ sesion_pda_id: "r-a2", campo: "SAB", grados: ["2"] }] }, "LEN"), null);
ok("protección: liga de un producto del campo pero de otro grado SÍ protege (hecha a mano)",
	PE.motivoDeProteccion(spdaA2, { ligas: [{ sesion_pda_id: "r-a2", campo: "LEN", grados: ["2"] }] }, "LEN"), "liga");
ok("protección: evaluación formativa protege",
	PE.motivoDeProteccion(spdaA2, { evaluaciones: [{ sesion_pda_id: "r-a2" }] }, "LEN"), "evaluacion");
ok("protección: la liga de otro PDA no cuenta",
	PE.motivoDeProteccion(spdaA2, { ligas: [{ sesion_pda_id: "r-a1", campo: "SAB", grados: ["2"] }], evaluaciones: [{ sesion_pda_id: "r-a1" }] }, "LEN"), null);

// 8. Un PDA protegido se queda en la lista: el plan ya no lo borra
const conProtegido = guarda([original[0], e(1, "a3", null), original[1]]);
ok("protegido: si se queda en la lista, el plan no lo borra", plan(conProtegido).spdaBorrar, []);

// 9. Sin PDA repetido por grado en lo que se guarda (clave por PDA)
ok("clavePda: por pda_id; sin pda_id, por criterio", [PE.clavePda(e(1, "a1")), PE.clavePda(e(1, null, "x"))], ["p|a1", "c|x"]);
ok("pdaSesionConservando: sin lista, igual que antes (2 PDA se conservan)",
	PE.pdaSesionConservando([{ grado: 1, representable: true, entrada: original[0] }, { grado: 2, representable: true, entrada: original[2] }], original).map((p) => p.pda_id), ["a1", "a2", "b1"]);

// ── La pantalla ──
const cp = leer("js/crear_proyecto.js");
ok("crear_proyecto: botón 'Cambiar PDA' solo en sesión sin trabajar", /const editable = block\.dataset\.trabajada !== '1';/.test(cp) && /pda-cambiar/.test(cp), true);
ok("crear_proyecto: el payload usa la lista del editor (lista: entradasDeEditorPda)", /lista: entradasDeEditorPda\(block, gNum\) \|\| undefined/.test(cp), true);
ok("crear_proyecto: se protegen los PDA quitados antes de armar las filas", /await protegerPdaQuitados\(lista, existe\);/.test(cp), true);
ok("crear_proyecto: se revisan repetidos y 0 PDA antes de guardar", /revisarPdaEditados\(blocks\)/.test(cp) && /window\.confirm\('Al guardar, '/.test(cp), true);
ok("crear_proyecto: el editor se recuerda al reconstruir los PDA (volver del paso 2)", /recordarEditoresPda\(block\);/.test(cp), true);
ok("crear_proyecto: sin emojis en el editor", /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(cp.slice(cp.indexOf("function abrirEditorPda"), cp.indexOf("function recordarEditoresPda"))), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
