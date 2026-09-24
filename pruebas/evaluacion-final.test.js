/*
	Evaluación final del ciclo (auditoría NEM, decisión de Jorge del 2026-09-24).

	Acuerdo 10/09/23: art. 7 III b (por campo, tres evaluaciones parciales y una final) y
	art. 9 (acreditación: 1° con haber cursado el grado; 2° a 6° con promedio final mínimo
	de 6). Una sola función para todos los documentos: ReporteDatos.finalCiclo.
	  - Final por campo: promedio de las tres calificaciones CONFIRMADAS, con un decimal,
	    truncado (no redondeado).
	  - Promedio final de grado: promedio de las cuatro finales, truncado.
	  - "pendiente" mientras falte confirmar algo: nunca un número parcial como final.
	Además revisa que la boleta imprimible, el reporte, Reportes y el Concentrado usen esa
	misma función.

	node pruebas/evaluacion-final.test.js
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
require("../js/catalogo-habilidades.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const B = require("../js/boleta.js");
require("../js/reportes-grupo.js");
const RD = window.ReporteDatos;
const RG = window.ReportesGrupo;
const CAMPOS = ["LEN", "SAB", "ETI", "DHL"];

function conf(v, extra) { return Object.assign({ calificacion: v, calificacion_confirmada: true, cerrada: false }, extra || {}); }
// ciclo([T1 LEN,SAB,ETI,DHL], [T2 ...], [T3 ...]); null = sin fila
function ciclo(t1, t2, t3) {
	const salida = { 1: {}, 2: {}, 3: {} };
	[t1, t2, t3].forEach((valores, i) => {
		if (!valores) return;
		CAMPOS.forEach((c, j) => { if (valores[j] !== null && valores[j] !== undefined) salida[i + 1][c] = conf(valores[j]); });
	});
	return salida;
}

// ── Truncado, no redondeado ─────────────────────────────────────────────────
let f = RD.finalCiclo(ciclo([7, 6, 9, 8], [8, 6, 9, 9], [8, 7, 10, 9]), 2);
// LEN 23/3 = 7.666 → 7.6; SAB 19/3 = 6.333 → 6.3; ETI 28/3 = 9.333 → 9.3; DHL 26/3 = 8.666 → 8.6
ok("final LEN 7, 8, 8 = 7.66 → 7.6 (no 7.7)", f.porCampo.LEN, 7.6);
ok("final SAB 6, 6, 7 = 6.33 → 6.3", f.porCampo.SAB, 6.3);
ok("final ETI 9, 9, 10 = 9.33 → 9.3", f.porCampo.ETI, 9.3);
ok("final DHL 8, 9, 9 = 8.66 → 8.6 (no 8.7)", f.porCampo.DHL, 8.6);
// (7.6 + 6.3 + 9.3 + 8.6) / 4 = 31.8 / 4 = 7.95 → 7.9 (redondeado sería 8.0)
ok("promedio final de grado 7.95 → 7.9 (no 8.0)", f.promedio, 7.9);
ok("completo: los 12 confirmados", [f.completo, f.faltan], [true, 0]);
ok("formato con un decimal", [RD.formatoDecimal(7.9), RD.formatoDecimal(9), RD.formatoDecimal(null)], ["7.9", "9.0", null]);
// Sin error de coma flotante: 8, 8, 8 → 8.0 exacto; 6.1 no sale 6.09
ok("8, 8, 8 → 8 exacto", RD.finalCiclo(ciclo([8, 8, 8, 8], [8, 8, 8, 8], [8, 8, 8, 8]), 3).porCampo.LEN, 8);
ok("promedio de 7.3, 7.3, 7.3, 7.3 → 7.3 (sin 7.29)", RD.promedioTruncado([7.3, 7.3, 7.3, 7.3]), 7.3);
ok("promedio truncado 5.75 → 5.7", RD.promedioTruncado([5, 6, 5, 7]), 5.7);
ok("ReporteDatos.promedio también trunca", RD.promedio([6, 6, 7]), 6.3);

// ── Pendiente mientras falte algo ───────────────────────────────────────────
f = RD.finalCiclo(ciclo([7, 6, 9, 8], [8, 6, 9, 9], null), 2);
ok("sin T3: finales pendientes (null), nunca el promedio de dos", CAMPOS.map((c) => f.porCampo[c]), [null, null, null, null]);
ok("sin T3: promedio final y acreditación pendientes", [f.promedio, f.acreditacion, f.faltan], [null, "pendiente", 4]);
f = RD.finalCiclo(ciclo([7, 6, 9, 8], [8, 6, 9, 9], [8, 7, 9, null]), 4);
ok("falta un campo: los otros tres ya tienen final", [f.porCampo.LEN, f.porCampo.DHL], [7.6, null]);
ok("falta un campo: promedio final y acreditación pendientes", [f.promedio, f.acreditacion, f.faltan], [null, "pendiente", 1]);
const sinConfirmar = ciclo([7, 6, 9, 8], [8, 6, 9, 9], [8, 7, 9, 9]);
sinConfirmar[3].SAB = { calificacion: 9, calificacion_confirmada: false }; // propuesta guardada sin confirmar
f = RD.finalCiclo(sinConfirmar, 4);
ok("una propuesta sin confirmar no cuenta: SAB pendiente", [f.porCampo.SAB, f.acreditacion], [null, "pendiente"]);
ok("sin ninguna fila: todo pendiente", RD.finalCiclo({}, 3).acreditacion, "pendiente");
ok("boletaCiclo null no truena", RD.finalCiclo(null, 3).faltan, 12);

// ── 1° siempre acredita (con los tres trimestres confirmados) ───────────────
f = RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 1);
ok("1° con todo en 6: acredita", [f.promedio, f.acreditacion], [6, "acredita"]);
// Aunque el número quedara bajo 6 (no debería: escala 6 a 10), 1° acredita con cursar
f = RD.finalCiclo(ciclo([5, 5, 5, 5], [5, 5, 5, 5], [5, 5, 5, 5]), 1);
ok("1°: acredita con haber cursado el grado, sea cual sea el promedio", f.acreditacion, "acredita");
ok("1° incompleto: pendiente, no acredita todavía", RD.finalCiclo(ciclo([9, 9, 9, 9], null, null), 1).acreditacion, "pendiente");

// ── 2° a 6°: con 6.0 o más ──────────────────────────────────────────────────
// Exacto 6.0: acredita
f = RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 2);
ok("2° con 6.0 exacto: acredita", [f.promedio, f.acreditacion], [6, "acredita"]);
// 4°: 5.9 no acredita (LEN 5, 6, 6 = 5.6; los demás 6.0 → (5.6 + 18) / 4 = 5.9)
f = RD.finalCiclo(ciclo([5, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 4);
ok("4° con 5.9: no acredita", [f.promedio, f.acreditacion], [5.9, "no_acredita"]);
// 5.975 redondeado sería 6.0; truncado es 5.9 y no acredita (LEN 6, 6, 5 = 5.6; SAB 6, 6, 6; ETI 6, 6, 6; DHL 6, 6, 7 = 6.3)
f = RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [5, 6, 6, 7]), 5);
ok("5°: (5.6 + 6 + 6 + 6.3) / 4 = 5.975 → 5.9, no acredita (redondeado habría acreditado)", [f.promedio, f.acreditacion], [5.9, "no_acredita"]);
f = RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 7]), 6);
ok("6° con 6.0 (6.3 en DHL): acredita", [f.promedio, f.acreditacion], [6, "acredita"]);
f = RD.finalCiclo(ciclo([5, 5, 5, 5], [5, 5, 5, 5], [6, 6, 6, 6]), 3);
ok("3° con 5.3: no acredita", [f.promedio, f.acreditacion], [5.3, "no_acredita"]);
ok("etiquetas", RD.ETIQUETA_ACREDITACION, { acredita: "Acredita", revisar: "Revisar", no_acredita: "No acredita", pendiente: "pendiente" });

// ── Decisión 18b: promedio en 6 o más con algún campo debajo de 6 → "Revisar" ──
// 4°: LEN 5, 5, 6 = 5.3; SAB 8, 8, 8; ETI 7, 7, 7; DHL 6, 6, 6 → (5.3 + 8 + 7 + 6) / 4 = 6.575 → 6.5
f = RD.finalCiclo(ciclo([5, 8, 7, 6], [5, 8, 7, 6], [6, 8, 7, 6]), 4);
ok("4° con 6.5 y LEN 5.3: revisar (nunca no acredita por eso)", [f.promedio, f.acreditacion, f.camposBajoMinimo], [6.5, "revisar", ["LEN"]]);
ok("revisar: la explicación corta", f.explicacion,
	"Promedio de 6 o más, pero LEN tiene menos de 6. Algunas entidades exigen mínimo 6 en cada campo; confírmalo con tu control escolar.");
// 2° (escala de 5 a 10 desde la decisión 17b): dos campos debajo de 6
f = RD.finalCiclo(ciclo([5, 5, 9, 9], [5, 6, 9, 9], [6, 5, 9, 9]), 2);
ok("2° con 7.1 y LEN y SAB en 5.3: revisar", [f.promedio, f.acreditacion, f.camposBajoMinimo], [7.1, "revisar", ["LEN", "SAB"]]);
ok("revisar con dos campos: «tienen»", f.explicacion.startsWith("Promedio de 6 o más, pero LEN y SAB tienen menos de 6."), true);
// 5.9 en un campo con promedio justo en 6.0: revisar (el campo trunca, 5.96 → 5.9)
f = RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [5, 7, 6, 6]), 5);
ok("5°: LEN 5.6, SAB 6.3 → promedio 5.9: no acredita (el promedio manda)", [f.promedio, f.acreditacion], [5.9, "no_acredita"]);
f = RD.finalCiclo(ciclo([6, 7, 6, 6], [6, 7, 6, 6], [5, 7, 6, 6]), 5);
ok("5°: LEN 5.6 y SAB 7.0 → promedio 6.1: revisar", [f.promedio, f.acreditacion, f.camposBajoMinimo], [6.1, "revisar", ["LEN"]]);
ok("no acredita: sin explicación de revisar", RD.finalCiclo(ciclo([5, 5, 5, 5], [5, 5, 5, 5], [6, 6, 6, 6]), 3).explicacion, "");
ok("acredita: sin campos bajos ni explicación", [RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 2).camposBajoMinimo, RD.finalCiclo(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 2).explicacion], [[], ""]);
f = RD.finalCiclo(ciclo([5, 9, 9, 9], [5, 9, 9, 9], [5, 9, 9, 9]), 1);
ok("1° con un campo en 5 (no debería pasar): acredita igual, sin revisar", [f.acreditacion, f.camposBajoMinimo, f.explicacion], ["acredita", [], ""]);
ok("pendiente: sin revisar mientras falte algo", RD.finalCiclo(ciclo([5, 9, 9, 9], [5, 9, 9, 9], null), 4).acreditacion, "pendiente");
// Los umbrales salen de la regla nacional (js/reglas-entidad.js)
const REGLA = require("../js/reglas-entidad.js").regla("Jalisco");
ok("regla de Jalisco = nacional (sin variantes)", REGLA.clave, "nacional");
ok("regla nacional: 6 de promedio y 6 por campo; 1° con cursar", REGLA.acreditacion, { primeroConCursar: true, promedioMinimo: 6, campoMinimo: 6 });

// ── Boletas cerradas: conservan su número; el grado sale del cierre del T3 ──
const cerrado = ciclo([7, 7, 7, 7], [7, 7, 7, 7], [5, 5, 5, 5]);
CAMPOS.forEach((c) => { cerrado[3][c].cerrada = true; });
cerrado[3].GEN = { campo: "GEN", texto_autogenerado: { cierre: { alumno: RD.fotoAlumno({ grado: 1 }, null) } } };
f = RD.finalCiclo(cerrado, 2); // hoy dice 2°, pero cerró el ciclo en 1°
ok("cerrada: grado del cierre del T3 (1°), no el de hoy (2°)", f.grado, 1);
ok("cerrada en 1°: acredita", f.acreditacion, "acredita");
ok("cerrada: la final usa el número guardado del cierre (7, 7, 5 = 6.3)", f.porCampo.LEN, 6.3);
ok("abierta: el grado que se recibe", RD.finalCiclo(ciclo([7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7]), 4).grado, 4);

// ── Boleta imprimible: columna Final, promedio final de grado y acreditación ─
function celda(html, campo, trim) {
	const m = html.match(new RegExp("data-campo='" + campo + "' data-trim='" + trim + "'>([^<]*)<"));
	return m ? m[1] : null;
}
const completo = ciclo([7, 6, 9, 8], [8, 6, 9, 9], [8, 7, 10, 9]);
let tabla = B.tablaCalificaciones(completo, 3, null, 2);
ok("imprimible: final LEN 7.6", celda(tabla, "LEN", "final"), "7.6");
ok("imprimible: final ETI 9.3", celda(tabla, "ETI", "final"), "9.3");
ok("imprimible: promedio final de grado en la esquina (7.9)", celda(tabla, "GENERAL", "final"), "7.9");
ok("imprimible: promedio general del T3 (8+7+10+9)/4 = 8.5", celda(tabla, "GENERAL", 3), "8.5");
ok("imprimible: acreditación", /id='boletaAcreditacion' data-acreditacion='acredita'/.test(tabla), true);
ok("imprimible: dice Acredita", tabla.includes(">Acredita<"), true);
ok("imprimible: promedio final de grado escrito", /data-promedio-final>7\.9</.test(tabla), true);
ok("imprimible: explica sin redondear", tabla.includes("sin redondear"), true);
ok("imprimible: explica que la conducta no forma parte de la calificación", tabla.includes("La conducta se informa en las observaciones"), true);
tabla = B.tablaCalificaciones(ciclo([7, 6, 9, 8], [8, 6, 9, 9], null), 2, null, 2);
ok("imprimible incompleto: final pendiente", celda(tabla, "LEN", "final"), "pendiente");
ok("imprimible incompleto: promedio final pendiente", celda(tabla, "GENERAL", "final"), "pendiente");
ok("imprimible incompleto: acreditación pendiente", /data-acreditacion='pendiente'/.test(tabla), true);
tabla = B.tablaCalificaciones(ciclo([5, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 3, null, 4);
ok("imprimible 4° con 5.9: No acredita", [celda(tabla, "GENERAL", "final"), /data-acreditacion='no_acredita'/.test(tabla)], ["5.9", true]);
tabla = B.tablaCalificaciones(ciclo([6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]), 3, null, 1);
ok("imprimible 1°: explica que se acredita con cursar", tabla.includes("En 1° se acredita con haber cursado el grado."), true);
// "Revisar" en la imprimible (la ven las familias, R7): sin "Revisar" ni códigos ni "confírmalo"
tabla = B.tablaCalificaciones(ciclo([5, 8, 7, 6], [5, 8, 7, 6], [6, 8, 7, 6]), 3, null, 4);
ok("imprimible 4° con LEN 5.3: la escuela confirmará (no «Revisar»)", [/data-acreditacion='revisar'/.test(tabla), tabla.includes("la escuela la confirmará con control escolar"), tabla.includes("Revisar")], [true, true, false]);
ok("imprimible: explica con el nombre completo del campo", tabla.includes("El promedio final es de 6 o más; Lenguajes quedó debajo de 6."), true);
ok("imprimible: sin «confírmalo con tu control escolar» (es para la maestra)", tabla.includes("confírmalo"), false);
ok("imprimible: la nota dice qué pasa si un campo queda debajo de 6", tabla.includes("la escuela confirma la acreditación con control escolar"), true);
const hoja = B.renderBoleta({ alumno: { nombre_completo: "H", grado: 4, num_lista: 1 }, trimestre: 3, boletaCiclo: ciclo([5, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]) });
ok("imprimible: renderBoleta pasa el grado del alumno (4° con 5.9 no acredita)", /data-acreditacion='no_acredita'/.test(hoja), true);

// ── Reporte detallado y pestaña Boleta de Reportes: la misma tabla ──────────
const html = RD.htmlFinalCiclo(completo, 2, { trimestre: 3, id: "x" });
ok("htmlFinalCiclo: final LEN", /data-final-campo='LEN'>7\.6</.test(html), true);
ok("htmlFinalCiclo: promedio final", /data-final-promedio>7\.9</.test(html), true);
ok("htmlFinalCiclo: acreditación", /data-acreditacion='acredita'>Acredita</.test(html), true);
ok("htmlFinalCiclo: los 12 números del ciclo", (html.match(/data-final-trim='\d'/g) || []).length, 12);
ok("htmlFinalCiclo: no usa data-campo (el reporte busca sus tarjetas por data-campo)", html.includes("data-campo="), false);
const htmlRev = RD.htmlFinalCiclo(ciclo([5, 8, 7, 6], [5, 8, 7, 6], [6, 8, 7, 6]), 4, {});
ok("htmlFinalCiclo: Revisar", /data-acreditacion='revisar'>Revisar</.test(htmlRev), true);
ok("htmlFinalCiclo: explicación del Revisar", /data-explicacion-acreditacion>Promedio de 6 o más, pero LEN tiene menos de 6\./.test(htmlRev), true);
ok("htmlFinalCiclo: Acredita sin explicación", html.includes("data-explicacion-acreditacion"), false);
// El reporte detallado es para el docente y la familia: mismo texto que la boleta imprimible
const htmlFam = RD.htmlFinalCiclo(ciclo([5, 8, 7, 6], [5, 8, 7, 6], [6, 8, 7, 6]), 4, { familias: true });
ok("htmlFinalCiclo para familias: «la escuela la confirmará», no «Revisar»",
	[/data-acreditacion='revisar'>La escuela la confirmará con control escolar</.test(htmlFam), htmlFam.includes(">Revisar<")], [true, false]);
ok("htmlFinalCiclo para familias: explicación con el nombre completo, sin «confírmalo»",
	[/data-explicacion-acreditacion>El promedio final es de 6 o más; Lenguajes quedó debajo de 6\./.test(htmlFam), htmlFam.includes("confírmalo")], [true, false]);
ok("htmlFinalCiclo para familias: una boleta que acredita se ve igual",
	RD.htmlFinalCiclo(completo, 2, { trimestre: 3, familias: true }).includes("data-acreditacion='acredita'>Acredita<"), true);
const htmlPend = RD.htmlFinalCiclo(ciclo([7, 6, 9, 8], null, null), 2, {});
ok("htmlFinalCiclo incompleto: faltan 8 de 12", htmlPend.includes("faltan 8 de 12"), true);
ok("htmlFinalCiclo incompleto: pendiente", /data-acreditacion='pendiente'>pendiente</.test(htmlPend), true);

// ── Concentrado: una fila por alumno con su final ───────────────────────────
const alumnos = [
	{ id: "a", nombre_completo: "H ANA", num_lista: 1, grado: 1 },
	{ id: "b", nombre_completo: "H BETO", num_lista: 1, grado: 4 },
	{ id: "c", nombre_completo: "H CARLA", num_lista: 1, grado: 2 },
	{ id: "d", nombre_completo: "H DORA", num_lista: 2, grado: 2 },
];
const datos = {
	motor: { porAlumno: {} },
	boletas: {
		a: ciclo([6, 6, 6, 6], [7, 7, 7, 7], [6, 6, 6, 6]),
		b: ciclo([5, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]),
		c: ciclo([8, 8, 8, 8], [9, 9, 9, 9], null),
		d: ciclo([5, 8, 7, 6], [5, 8, 7, 6], [6, 8, 7, 6]),
	},
};
const filas = RG.filas(alumnos, datos, 3);
const porId = {};
filas.forEach((x) => { porId[x.alumno.id] = x; });
ok("Concentrado: 1° acredita", porId.a.final.acreditacion, "acredita");
ok("Concentrado: 4° con 5.9 no acredita", [porId.b.final.promedio, porId.b.final.acreditacion], [5.9, "no_acredita"]);
ok("Concentrado: 2° sin T3 pendiente", porId.c.final.acreditacion, "pendiente");
const conc = RG.htmlConcentrado(filas, 3);
ok("Concentrado: sección de evaluación final", conc.includes("data-final-grupo"), true);
ok("Concentrado: No acredita de Beto", /data-final-alumno='b'[\s\S]*?data-acreditacion='no_acredita'>No acredita</.test(conc), true);
ok("Concentrado: final DHL de Ana 6.3 (6, 7, 6)", /data-final-alumno='a'[\s\S]*?data-final-campo='DHL'><span[^>]*>6\.3</.test(conc), true);
ok("Concentrado: 3 de 4 completos (Carla sin T3)", conc.includes("3 de 4 alumnos con los tres trimestres"), true);
ok("Concentrado: 2° con LEN 5.3 → Revisar", [porId.d.final.promedio, porId.d.final.acreditacion], [6.5, "revisar"]);
ok("Concentrado: Revisar de Dora con su explicación", /data-final-alumno='d'[\s\S]*?data-acreditacion='revisar'>Revisar<span[^>]*data-explicacion-acreditacion>Promedio de 6 o más, pero LEN tiene menos de 6/.test(conc), true);
// El promedio del trimestre del Concentrado también trunca: 5, 6, 6, 6 → 5.75 → 5.7
ok("Concentrado: promedio del trimestre truncado (5.75 → 5.7)", RG.filas(alumnos, datos, 1).filter((x) => x.alumno.id === "b")[0].promedio, 5.7);

// Sin emojis en lo nuevo
ok("sin emojis", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html + conc + hoja), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
