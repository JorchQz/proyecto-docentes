/*
	Pruebas de los arreglos del FAIL del revisor NEM R5 (2026-09-24). Cada bloque falla con el
	código anterior (se comprobó corriéndolo contra una copia de HEAD: RAIZ_JS=<carpeta>).

	  1. Textos para las familias en 1° y 2°: nunca "tablas de multiplicar" ni "división"
	     (cuaderno de Fase 3, pp. 25-26); de 3° a 6° no cambia nada. Boleta y junta.
	  2. Trimestre actual: sugerencia por el calendario SEP 2026-2027 y selector en Mi grupo
	     que guarda por la capa de lectura.
	  3. Nota "cálculo de apoyo" junto a la final: boleta imprimible,
	     reporte / pestaña Boleta (htmlFinalCiclo) y Concentrado. Desde el 2026-09-24 dice
	     que Mi salón REDONDEA a un decimal, como la plataforma de control escolar (antes, que
	     truncaba y que el oficial lo calcula SIGED).
	  6. Junta: un grado sin ningún PPM no dice "0 de 0".
	  7. Peso efectivo: suma 100 entre los rubros con datos; Ajustes no pinta de verde la suma.
	  8. Nota de conducta en boletas cerradas antes del cambio (foto con conducta que ponderó).
	  9. Migración del catálogo: solo la descripción de lectura_ppm.
	  (4, la exportación, está en pruebas/exportar.test.js; 5, la boleta a 390 px, en navegador:
	   .qa/constructor-i-r5/.)

	node pruebas/auditoria-nem-r5.test.js
*/

const fs = require("fs");
const path = require("path");
const RAIZ = path.resolve(process.env.RAIZ_JS || path.join(__dirname, "..", "js"));
const REPO = path.join(__dirname, "..");
const js = (f) => path.join(RAIZ, f);

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
function intentar(nombre, fn) {
	try { fn(); } catch (e) { fallos++; console.log("FALLA " + nombre + " → excepción: " + e.message); }
}

global.window = {};
["campos-formativos.js", "catalogo-habilidades.js", "alcance-hoy.js", "motor-calificacion.js", "textos-boleta.js", "reporte-datos.js"]
	.forEach((f) => require(js(f)));
const CH = window.CatalogoHabilidades;
const TB = window.TextosBoleta;
const RD = window.ReporteDatos;
const M = window.MotorCalificacion;
const J = require(js("junta.js"));
const B = require(js("boleta.js"));
require(js("reportes-grupo.js"));
const RG = window.ReportesGrupo;

// ── 1. Textos de 2° sobre las tablas y la división ──────────────────────────
console.log("\n1. Textos para las familias en 1° y 2°");
const DIAG = {
	matematicas: [
		{ clave: "mates.division", nivel: "requiere_apoyo" },
		{ clave: "mates.tablas", nivel: "requiere_apoyo" },
		{ clave: "mates.suma", nivel: "logrado" },
		{ clave: "mates.multiplicacion", nivel: "logrado" },
	],
};
const DIAG_BIEN = { matematicas: [{ clave: "mates.division", nivel: "logrado" }, { clave: "mates.tablas", nivel: "logrado" }] };
function textos(grado, diag) {
	return TB.generar({ catalogo: CH, corto: window.CamposFormativos.corto, diagnostica: diag || DIAG, grado: grado });
}
function todo(r) {
	return Object.keys(r).map((k) => r[k] && r[k].fortalezas ? r[k].fortalezas.concat(r[k].areas, r[k].sugerencias).join(" ") : "").join(" ");
}
const t2 = textos(2);
const area2 = t2.SAB.areas.join(" "), sug2 = t2.SAB.sugerencias.join(" ");
ok("2°: el área no dice «tablas de multiplicar»", /tablas/i.test(area2), false);
ok("2°: el área no dice «división»", /divisi/i.test(area2), false);
ok("2°: la sugerencia no dice «tablas» ni «división»", /tablas|divisi/i.test(sug2), false);
ok("2°: el área habla de cálculo mental y de repartir o agrupar", area2,
	"Necesita apoyo en: estrategias para repartir o agrupar y cálculo mental para multiplicar.");
ok("2°: la sugerencia, igual", sug2,
	"Practicar con ejercicios cortos y diarios: estrategias para repartir o agrupar y cálculo mental para multiplicar.");
ok("2°: las fortalezas tampoco dicen «tablas»", /tablas|divisi/i.test(todo(textos(2, DIAG_BIEN))), false);
ok("2°: nunca «memoriz» ni «algoritmo» en lo que ve la familia", /memoriz|algoritmo/i.test(todo(t2)), false);
ok("1°: no aplican (no aparecen)", /tablas|divisi|repartir|cálculo mental/i.test(todo(textos(1))), false);
[3, 4, 5, 6].forEach((g) => {
	ok(g + "°: sin cambios («división y tablas de multiplicar»)", textos(g).SAB.areas.join(" "), "Necesita apoyo en: división y tablas de multiplicar.");
});
ok("catálogo: textoFamilias en 2° y en 4°", CH.textoFamilias ? [CH.textoFamilias("mates.tablas", 2), CH.textoFamilias("mates.tablas", 4)] : null,
	["cálculo mental para multiplicar", "tablas de multiplicar"]);

// Junta: {habilidades} con el nombre del grado de cada alumno
const motorVacio = { porCampo: {}, asistencia: { presentes: 0, total: 0, porcentaje: null } };
function sugJunta(alumnos, diags) {
	const porAlumno = {};
	alumnos.forEach((a) => { porAlumno[a.id] = motorVacio; });
	const s = J.sugerenciasFrecuentes({ plantillas: {}, bandas: {} }, { motor: { porAlumno }, avancePda: [], diagnosticas: diags }, alumnos)
		.find((x) => x.clave === "matematicas");
	return s ? s.texto : null;
}
const flojas = [{ clave: "mates.division", nivel: "requiere_apoyo" }, { clave: "mates.tablas", nivel: "requiere_apoyo" }];
ok("junta, grupo de 2°: sin «tablas» ni «división»",
	sugJunta([{ id: "d1", grado: 2 }, { id: "d2", grado: 2 }], { d1: { matematicas: flojas }, d2: { matematicas: flojas } }),
	"Practicar con ejercicios cortos y diarios: estrategias para repartir o agrupar y cálculo mental para multiplicar.");
ok("junta, grupo de 4°: sin cambios",
	sugJunta([{ id: "c1", grado: 4 }], { c1: { matematicas: flojas } }),
	"Practicar con ejercicios cortos y diarios: división y tablas de multiplicar.");

// ── 2. Trimestre actual ─────────────────────────────────────────────────────
console.log("\n2. Trimestre actual (calendario SEP 2026-2027 y Mi grupo)");
intentar("calendario-escolar.js", () => {
	const C = require(js("calendario-escolar.js"));
	const t = (f) => C.trimestreSugerido(f).trimestre;
	ok("24 sep 2026 → T1", t("2026-09-24"), 1);
	ok("26 nov 2026 (último día de comunicar T1) → T1", t("2026-11-26"), 1);
	ok("27 nov 2026 → T2", t("2026-11-27"), 2);
	ok("19 mar 2027 (último día de comunicar T2) → T2", t("2027-03-19"), 2);
	ok("20 mar 2027 → T3", t("2027-03-20"), 3);
	ok("9 jul 2027 (fin de clases) → T3", t("2027-07-09"), 3);
	ok("texto con el calendario", C.trimestreSugerido("2027-01-10").texto, "Según el calendario SEP 2026-2027, hoy corresponde el trimestre 2.");
	ok("fuera del calendario: periodos del art. 8 (dic → T2)", [t("2027-12-05"), C.trimestreSugerido("2027-12-05").fuente], [2, "acuerdo"]);
	ok("fuera del calendario: abril → T3, septiembre → T1", [t("2028-04-10"), t("2027-09-15")], [3, 1]);
});
const html = fs.readFileSync(path.join(REPO, "mi-grupo.html"), "utf8");
const miGrupo = fs.readFileSync(js("mi-grupo.js"), "utf8");
ok("Mi grupo: selector «Trimestre actual» con 1, 2 y 3", /id="trimestreActualSelect"[\s\S]*value="1"[\s\S]*value="2"[\s\S]*value="3"/.test(html), true);
ok("Mi grupo: carga el calendario antes de su script", html.indexOf("js/calendario-escolar.js") !== -1 && html.indexOf("js/calendario-escolar.js") < html.indexOf("js/mi-grupo.js"), true);
ok("Mi grupo: guarda trimestre_actual por la capa de lectura", /Lectura\.uno\([\s\S]{0,120}\.update\(\{ trimestre_actual: nuevo \}\)/.test(miGrupo), true);
ok("Mi grupo: avisa si el guardado falla", /No se pudo guardar el trimestre/.test(miGrupo), true);
ok("Mi grupo: la sugerencia no se aplica sola (solo al elegir o con el botón)", /trimestreSugerido\(\)[\s\S]*?guardarTrimestre/.test(miGrupo.slice(miGrupo.indexOf("function renderTrimestreActual"), miGrupo.indexOf("async function guardarTrimestre"))), false);
ok("Mi grupo: «Editar grupo» no pierde trimestre_actual", /descripcion, trimestre_actual"\)/.test(miGrupo), true);

// ── 3. Nota de la final ─────────────────────────────────────────────────────
console.log("\n3. Nota de cálculo de apoyo junto a la final");
const NOTA = "Cálculo de apoyo: el promedio oficial lo calcula la plataforma de control escolar. Mi salón lo redondea a un decimal, como ella.";
function filaB(campo, cal, extra) {
	return Object.assign({ campo: campo, calificacion: cal, calificacion_confirmada: true, cerrada: false, porcentaje: 80 }, extra || {});
}
const CICLO = { 1: {}, 2: {}, 3: {} };
[1, 2, 3].forEach((t) => ["LEN", "SAB", "ETI", "DHL"].forEach((c) => { CICLO[t][c] = filaB(c, 8); }));
ok("reporte y pestaña Boleta (htmlFinalCiclo)", RD.htmlFinalCiclo(CICLO, 4, {}).includes(NOTA), true);
ok("boleta imprimible", B.tablaCalificaciones(CICLO, 3).includes(NOTA), true);
intentar("Concentrado", () => {
	const lista = RG.filas([{ id: "a1", nombre_completo: "UNO", grado: 4, num_lista: 1 }], { boletas: { a1: CICLO } }, 3);
	const h = RG.htmlConcentrado(lista, 3);
	ok("Concentrado: la tabla de la final lleva la nota", h.includes("data-final-grupo") && h.includes(NOTA), true);
});
ok("la nota dice lo que hace el cálculo (redondeado: 7, 8, 8 → 7.7)", RD.finalCiclo({ 1: { LEN: filaB("LEN", 7) }, 2: { LEN: filaB("LEN", 8) }, 3: { LEN: filaB("LEN", 8) } }, 4).porCampo.LEN, 7.7);

// ── 6. Junta sin PPM en un grado ────────────────────────────────────────────
console.log("\n6. Junta: grado sin ningún PPM");
intentar("junta", () => {
	const ctx = {
		maestroId: "m1", maestroNombre: "Maestra", grupo: { id: "g1", nombre: "Grupo", grados: ["2", "3"] }, ciclo: "2026-2027", escuela: "Esc",
		alumnos: [
			{ id: "a", nombre_completo: "A UNO", num_lista: 1, grado: 2 }, { id: "b", nombre_completo: "B DOS", num_lista: 2, grado: 2 },
			{ id: "c", nombre_completo: "C TRES", num_lista: 3, grado: 3 }, { id: "d", nombre_completo: "D CUATRO", num_lista: 4, grado: 3 },
		],
		bandas: { 2: { grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 }, 3: { grado: 3, requiere_apoyo_max: 59, cercano_max: 84, estandar_max: 99 } },
		plantillas: {},
	};
	const mot = (p) => {
		const porCampo = {};
		["LEN", "SAB", "ETI", "DHL"].forEach((c) => {
			const rubros = {};
			M.RUBROS.forEach((r) => { rubros[r] = { obtenido: 1, maximo: 2, fraccion: 0.5, peso: 20 }; });
			porCampo[c] = { porcentaje: p, rubros: rubros, calificacionPropuesta: 8 };
		});
		return { porCampo, asistencia: { presentes: 5, total: 5, porcentaje: 1 }, usaLegacy: false, examenAproximado: false };
	};
	const actual = {
		motor: { sinProyectos: false, porAlumno: { a: mot(70), b: mot(80), c: mot(60), d: mot(90) } },
		// 2°: con PPM; 3°: ninguno
		diagnosticas: { a: { alumno_id: "a", lectura_ppm: 70 }, b: { alumno_id: "b", lectura_ppm: 40 } },
		avancePda: [], boletas: {},
	};
	const m = J.construirModelo({ ctx, trimestre: 1, actual, anterior: null, fecha: new Date(2026, 8, 24) });
	const todoHtml = J.diapositivas(m, { mostrarNombres: false }).map((d) => d.html).join(" ");
	ok("nunca «0 de 0»", /0 de 0<\/strong>/.test(todoHtml), false);
	ok("el grado sin PPM dice que no hay datos", /data-sin-datos-ppm>Todavía no hay datos/.test(todoHtml), true);
	ok("el grado con PPM sigue con su proporción (1 de 2)", /<strong>1 de 2<\/strong> alcanzan la referencia/.test(todoHtml), true);
});

// ── 7. Peso efectivo ────────────────────────────────────────────────────────
console.log("\n7. Peso efectivo (presentación; el cálculo no cambia)");
intentar("repartoEntero", () => {
	const suma = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 10) / 10;
	const def = M.repartoEntero({ tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 33 });
	ok("de fábrica, los cuatro con datos: suma 100 (no 95)", [def, suma(def)], [{ tareas: 29.5, trabajos: 29.5, participacion: 6.3, examen: 34.7 }, 100]);
	const sinExamen = M.pesosEfectivos({
		tareas: { fraccion: 1, peso: 28 }, trabajos: { fraccion: 0.5, peso: 28 }, participacion: { fraccion: 1, peso: 6 },
		conducta: { fraccion: 1, peso: 0 }, examen: { fraccion: null, peso: 33 },
	});
	ok("sin examen: 28, 28 y 6 sobre 62, suma 100, mismos pesos se ven iguales", [sinExamen, suma(sinExamen)], [{ tareas: 45.1, trabajos: 45.1, participacion: 9.8 }, 100]);
	ok("foto vieja con conducta 5 (con datos): entra", M.pesosEfectivos({ tareas: { fraccion: 1, peso: 28 }, conducta: { fraccion: 1, peso: 5 } }), { tareas: 84.8, conducta: 15.2 });
	ok("sin datos: null", M.pesosEfectivos({ tareas: { fraccion: null, peso: 28 } }), null);
	// El cálculo no cambió
	ok("el motor no cambió de pesos de fábrica", M.PESOS_DEFECTO, { tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 33 });
});
const ajustes = fs.readFileSync(js("ajustes.js"), "utf8");
const ajustesHtml = fs.readFileSync(path.join(REPO, "ajustes.html"), "utf8");
ok("Ajustes: la suma ya no se pinta de verde", /text-green-600"\)/.test(ajustes.replace(/remove\([^)]*\)/g, "")), false);
ok("Ajustes: explica que los pesos son relativos", /Los pesos son relativos: no tienen que sumar 100/.test(ajustesHtml), true);
ok("Ajustes: carga el motor para el peso efectivo", ajustesHtml.indexOf("js/motor-calificacion.js") !== -1 && ajustesHtml.indexOf("js/motor-calificacion.js") < ajustesHtml.indexOf("js/ajustes.js"), true);
const reportes = fs.readFileSync(js("reportes.js"), "utf8");
ok("Reportes: la etiqueta del rubro ya no es el peso relativo con «%»", /\(peso > 0 \? peso \+ " %"/.test(reportes), false);
ok("Reportes: usa el peso efectivo", /MOTOR\.pesosEfectivos\(/.test(reportes), true);

// ── 8. Conducta en boletas cerradas antes del cambio ────────────────────────
console.log("\n8. Nota de conducta en una boleta cerrada con la foto vieja");
function cerradaCon(pesoConducta, conDatos) {
	const campos = {};
	["LEN", "SAB", "ETI", "DHL"].forEach((c) => {
		campos[c] = { porcentaje: 80, nivel: "logrado", sin_evidencias: false, rubros: {
			tareas: { obtenido: 1, maximo: 1, fraccion: 1, peso: 28 },
			conducta: conDatos ? { obtenido: 1, maximo: 1, fraccion: 1, peso: pesoConducta } : { obtenido: 0, maximo: 0, fraccion: null, peso: pesoConducta },
		} };
	});
	const t = {};
	["LEN", "SAB", "ETI", "DHL"].forEach((c) => { t[c] = filaB(c, 8, { cerrada: true }); });
	t.GEN = { campo: "GEN", cerrada: true, texto_autogenerado: { cierre: { campos, pesos: { tareas: 28, trabajos: 28, participacion: 6, conducta: pesoConducta, examen: 33 } } } };
	return t;
}
ok("pesoConductaCierre: foto vieja (5, con datos)", RD.pesoConductaCierre ? RD.pesoConductaCierre(cerradaCon(5, true)) : null, 5);
ok("pesoConductaCierre: foto nueva (0)", RD.pesoConductaCierre ? RD.pesoConductaCierre(cerradaCon(0, true)) : null, 0);
ok("pesoConductaCierre: peso 5 pero sin datos de conducta: no entró", RD.pesoConductaCierre ? RD.pesoConductaCierre(cerradaCon(5, false)) : null, 0);
const vieja = { 1: cerradaCon(5, true), 2: {}, 3: {} };
["LEN", "SAB", "ETI", "DHL"].forEach((c) => { vieja[2][c] = filaB(c, 8); vieja[3][c] = filaB(c, 8); });
const tv = B.tablaCalificaciones(vieja, 1);
ok("imprimible: en el T1 viejo NO dice que la conducta no forma parte", /La conducta se informa en las observaciones: no forma parte de la calificación\./.test(tv), false);
ok("imprimible: dice que en el trimestre 1 la conducta sí formó parte (peso 5)", /En el trimestre 1, cerrado antes de un cambio de criterio, la conducta sí formó parte de la calificación \(con peso 5/.test(tv), true);
const nueva = { 1: cerradaCon(0, true), 2: {}, 3: {} };
ok("imprimible: boleta nueva, la nota de siempre", /La conducta se informa en las observaciones: no forma parte de la calificación\./.test(B.tablaCalificaciones(nueva, 1)), true);
ok("Reportes: la nota de conducta depende de la foto del cierre", /pesoConductaCierre\(boletaPorCampo\)/.test(reportes) && /Esta boleta se cerró cuando la conducta todavía ponderaba/.test(reportes), true);

// ── 9. Migración del catálogo ───────────────────────────────────────────────
console.log("\n9. Migración b10 de textos");
const sqlRuta = path.join(REPO, "supabase", "mi_salon_b10_textos_nem_2026-09.sql");
const sql = fs.existsSync(sqlRuta) ? fs.readFileSync(sqlRuta, "utf8").replace(/--.*$/gm, "") : "";
ok("existe", sql.length > 0, true);
// Solo descripciones del catálogo: lectura_ppm, y participación y conducta (el 1 ya vale el
// día completo y la conducta no pondera); nada de borrar, insertar ni cambiar estructura
const updates = sql.match(/\bupdate\b[\s\S]*?;/gi) || [];
ok("solo actualiza descripciones de lectura_ppm, participacion y conducta",
	updates.length === 3 && updates.every((u) => /set\s+descripcion\s*=/i.test(u) && /where clave = '(lectura_ppm|participacion|conducta)'/.test(u)) &&
	!/\b(delete|drop|insert|alter)\b/i.test(sql), true);
ok("dice «referencia SEP 2010», no «estándar»", /referencia SEP 2010/.test(sql) && !/est[aá]ndar/i.test(sql), true);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
process.exit(fallos ? 1 : 0);
