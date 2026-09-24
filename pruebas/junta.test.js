/*
	Pruebas de la presentación de grupo para la junta de padres (B.8.3, js/junta.js).

	Carga las mismas piezas que la página (campos-formativos, catalogo-habilidades,
	textos-boleta, reporte-datos) y corre el cálculo y el render de junta.js con datos
	de ejemplo con la forma exacta de ReporteDatos.grupoTrimestre:
	  - un solo trimestre (1er): "sin trimestre anterior" y ningún delta;
	  - 2do trimestre con el 1ro capturado: promedios, deltas y "mejoraron";
	  - 2do trimestre con el 1ro vacío: sin deltas inventados;
	  - trimestre vacío: estado vacío;
	  - privacidad: sin nombres por defecto; las áreas nunca llevan nombre ni número;
	  - reglas de áreas de atención y sugerencias frecuentes de la Capa 1.

	node pruebas/junta.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
require("../js/catalogo-habilidades.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const J = require("../js/junta.js");
const RD = window.ReporteDatos;

// ── Datos de ejemplo ─────────────────────────────────────────────────────────
const BANDAS = {
	1: { grado: 1, requiere_apoyo_max: 14, cercano_max: 34, estandar_max: 59 },
	2: { grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 },
	3: { grado: 3, requiere_apoyo_max: 59, cercano_max: 84, estandar_max: 99 },
};
const NOMBRES = ["ANA TORRES", "DIEGO RUIZ", "LUIS PEREZ", "ELENA RIOS", "JUAN MENA", "SOFIA LARA"];
const ctx = {
	maestroId: "m1", maestroNombre: "Maestra Prueba",
	grupo: { id: "g1", nombre: "Grupo 1°-2° de prueba", grados: ["1", "2"] },
	ciclo: "2026-2027", escuela: "Escuela de prueba",
	alumnos: [
		{ id: "a1", nombre_completo: NOMBRES[0], num_lista: 1, grado: 1 },
		{ id: "a2", nombre_completo: NOMBRES[1], num_lista: 2, grado: 1 },
		{ id: "a3", nombre_completo: NOMBRES[2], num_lista: 3, grado: 1 },
		{ id: "b1", nombre_completo: NOMBRES[3], num_lista: 4, grado: 2 },
		{ id: "b2", nombre_completo: NOMBRES[4], num_lista: 5, grado: 2 },
		{ id: "b3", nombre_completo: NOMBRES[5], num_lista: 6, grado: 2 },
	],
	bandas: BANDAS,
	plantillas: {},
};

// Resultado del motor para un alumno: porcentaje por campo y fracción por rubro
function motorAlumno(pcts, fr) {
	const porCampo = {};
	RD.CAMPOS.forEach((c) => {
		const pct = pcts[c] === undefined ? null : pcts[c];
		const rubros = {};
		["tareas", "trabajos", "participacion", "conducta", "examen"].forEach((r) => {
			const f = pct === null || !fr ? null : fr[r];
			rubros[r] = f === null || f === undefined ? { obtenido: 0, maximo: 0, fraccion: null, peso: 20 }
				: { obtenido: 2 * f, maximo: 2, fraccion: f, peso: 20 };
		});
		porCampo[c] = { porcentaje: pct, rubros: rubros, calificacionPropuesta: pct === null ? null : 8 };
	});
	return { porCampo: porCampo, asistencia: { presentes: 20, total: 20, porcentaje: 1 }, usaLegacy: false, examenAproximado: true };
}
// Participación y conducta: 1 (normal) y 2 valen el día completo (decisión de Jorge 9)
const BIEN = { tareas: 0.9, trabajos: 0.9, participacion: 1, conducta: 1, examen: 0.8 };

function confirmadaTodo(cal) {
	const t = {};
	RD.CAMPOS.forEach((c) => { t[c] = { calificacion: cal, calificacion_confirmada: true, cerrada: false }; });
	return t;
}

function trimestre1() {
	return {
		motor: {
			sinProyectos: false,
			porAlumno: {
				a1: motorAlumno({ LEN: 90, SAB: 100, ETI: 80, DHL: null }, BIEN),                     // 90
				a2: motorAlumno({ LEN: 60, SAB: 70, ETI: 50, DHL: 60 }, Object.assign({}, BIEN, { tareas: 0.5 })), // 60
				a3: motorAlumno({ LEN: 30, SAB: 40, ETI: 20, DHL: 30 },
					Object.assign({}, BIEN, { tareas: 0.3, participacion: 0.4, examen: 0.2 })),            // 30
				b1: motorAlumno({ LEN: 80, SAB: 80, ETI: 80, DHL: 80 }, BIEN),                        // 80
				b2: motorAlumno({ LEN: 50, SAB: 50 }, BIEN),                                           // 50
				b3: motorAlumno({}, null),                                                             // sin datos
			},
		},
		diagnosticas: {
			a1: { alumno_id: "a1", lectura_ppm: 60 },                                   // 1°: avanzado
			a2: { alumno_id: "a2", lectura_ppm: 10, matematicas: [{ clave: "mates.suma", nivel: "requiere_apoyo" }] }, // requiere apoyo
			a3: { alumno_id: "a3", lectura_ppm: 20 },                                   // cercano
			b1: { alumno_id: "b1", lectura_ppm: 90 },                                   // 2°: avanzado
			b2: { alumno_id: "b2", lectura_ppm: 30, matematicas: [
				{ clave: "mates.suma", nivel: "requiere_apoyo" }, { clave: "mates.resta", nivel: "requiere_apoyo" }] },
		},
		avancePda: [
			// P1 (1°): 2 de 3 en requiere apoyo → mayoría
			{ alumno_id: "a1", grado: 1, clave_pda: "P1", campo_formativo: "Lenguajes", pda: "Escribe su nombre y lo compara con otros", evidencias: 3, nivel_predominante: "logrado", tendencia: "estable" },
			{ alumno_id: "a2", grado: 1, clave_pda: "P1", campo_formativo: "Lenguajes", pda: "Escribe su nombre y lo compara con otros", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			{ alumno_id: "a3", grado: 1, clave_pda: "P1", campo_formativo: "Lenguajes", pda: "Escribe su nombre y lo compara con otros", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			// P2 (1°): la fila con 1 evidencia no cuenta → 1 de 2, no es mayoría
			{ alumno_id: "a1", grado: 1, clave_pda: "P2", campo_formativo: "Saberes y Pensamiento Científico", pda: "Describe sus características físicas", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			{ alumno_id: "a2", grado: 1, clave_pda: "P2", campo_formativo: "Saberes y Pensamiento Científico", pda: "Describe sus características físicas", evidencias: 1, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			{ alumno_id: "a3", grado: 1, clave_pda: "P2", campo_formativo: "Saberes y Pensamiento Científico", pda: "Describe sus características físicas", evidencias: 2, nivel_predominante: "logrado", tendencia: "estable" },
			// P3 (2°): 2 de 3 → mayoría
			{ alumno_id: "b1", grado: 2, clave_pda: "P3", campo_formativo: "Ética, Naturaleza y Sociedades", pda: "Comprende que es parte de un contexto social", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			{ alumno_id: "b2", grado: 2, clave_pda: "P3", campo_formativo: "Ética, Naturaleza y Sociedades", pda: "Comprende que es parte de un contexto social", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			{ alumno_id: "b3", grado: 2, clave_pda: "P3", campo_formativo: "Ética, Naturaleza y Sociedades", pda: "Comprende que es parte de un contexto social", evidencias: 2, nivel_predominante: "en_proceso", tendencia: "estable" },
			// P4 (2°): un solo alumno evaluado → no es "la mayoría del grado"
			{ alumno_id: "b1", grado: 2, clave_pda: "P4", campo_formativo: "Lenguajes", pda: "Lee en voz alta", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
			// Alumno que ya no está activo en el grupo: se ignora
			{ alumno_id: "zz", grado: 2, clave_pda: "P4", campo_formativo: "Lenguajes", pda: "Lee en voz alta", evidencias: 3, nivel_predominante: "requiere_apoyo", tendencia: "estable" },
		],
		boletas: {
			a1: { 1: confirmadaTodo(9), 2: {}, 3: {} },
			a2: { 1: { LEN: { calificacion: 8, calificacion_confirmada: false } }, 2: {}, 3: {} },
			a3: { 1: {}, 2: {}, 3: {} }, b1: { 1: {}, 2: {}, 3: {} }, b2: { 1: {}, 2: {}, 3: {} }, b3: { 1: {}, 2: {}, 3: {} },
		},
	};
}

function vacio() {
	const porAlumno = {};
	ctx.alumnos.forEach((a) => { porAlumno[a.id] = motorAlumno({}, null); });
	return { motor: { sinProyectos: true, porAlumno: porAlumno }, diagnosticas: {}, avancePda: [], boletas: {} };
}

function anterior1() {
	const d = vacio();
	d.motor.sinProyectos = false;
	d.motor.porAlumno.a1 = motorAlumno({ LEN: 80, SAB: 80, ETI: 80, DHL: 80 }, BIEN); // 80 → 90: +10
	d.motor.porAlumno.a2 = motorAlumno({ LEN: 65, SAB: 65, ETI: 65, DHL: 65 }, BIEN); // 65 → 60: −5
	d.motor.porAlumno.a3 = motorAlumno({ LEN: 20, SAB: 20, ETI: 20, DHL: 20 }, BIEN); // 20 → 30: +10
	d.motor.porAlumno.b1 = motorAlumno({ LEN: 80, SAB: 80, ETI: 80, DHL: 80 }, BIEN); // 80 → 80: 0
	return d;
}

const FECHA = new Date(2026, 8, 23);
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/gu;
function sinEmojis(html) {
	return [...html.matchAll(SIMBOLOS)].map((m) => m[0]).filter((c) => c !== "→" && c !== "←").length === 0;
}
function textoPlano(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }
function slide(lista, prefijo) { return lista.find((d) => d.titulo.indexOf(prefijo) === 0); }
const redondo = (v) => (v === null ? null : Math.round(v * 10) / 10);

// ── 1. Un solo trimestre de datos (1er trimestre) ───────────────────────────
console.log("\n1er trimestre (sin trimestre anterior)");
const m1 = J.construirModelo({ ctx: ctx, trimestre: 1, actual: trimestre1(), anterior: null, fecha: FECHA });
ok("hay datos", m1.hayDatos, true);
ok("sin comparación", m1.comparacion, false);
ok("motivo: primera medición", m1.motivoSinComparacion, "primero");
ok("promedio del alumno = sus campos con datos (90, 100, 80)", m1.alumnos[0].actual, 90);
ok("alumno sin datos queda en null, no en 0", m1.alumnos[5].actual, null);
ok("promedio del grupo = promedio de sus alumnos con datos", redondo(m1.resumen.actual), 62);
ok("conDatos / n", [m1.resumen.conDatos, m1.resumen.n], [5, 6]);
ok("promedio de 1° y de 2°", m1.grados.map((g) => redondo(g.resumen.actual)), [60, 65]);
ok("promedio de LEN del grupo", redondo(m1.porCampo.LEN.actual), 62);
ok("ningún delta ni 'mejoraron' sin trimestre anterior",
	[m1.resumen.delta, m1.resumen.mejoraron, m1.alumnos.every((a) => a.delta === null && a.anterior === null)], [null, 0, true]);
ok("boleta: solo cuenta la confirmada completa (1 de 6)", m1.confirmadas, { alumnos: 1, total: 6 });
ok("fluidez: clasificación con la banda del grado", m1.alumnos.map((a) => a.fluidez),
	["avanzado", "requiere_apoyo", "cercano", "avanzado", "requiere_apoyo", null]);

const s1 = J.diapositivas(m1, { mostrarNombres: false });
const html1 = s1.map((d) => d.html).join("\n");
ok("diapositivas mínimas en orden", s1.map((d) => d.titulo), [
	"Portada", "Panorama del grupo", "Desempeño de 1° grado", "Desempeño de 2° grado", "Fluidez lectora",
	"Promedio por campo formativo", "Áreas de atención del grupo", "Aprendizajes por reforzar", "Cómo apoyar en casa"]);
ok("dice 'Sin trimestre anterior'", /Sin trimestre anterior/.test(html1), true);
ok("ninguna insignia de delta", /j-delta/.test(html1), false);
ok("ninguna barra del trimestre anterior", /j-barra-ant/.test(html1), false);
ok("no dice 'subieron'", /subieron/.test(html1), false);
ok("sin nombres por defecto", NOMBRES.some((n) => html1.indexOf(n) !== -1), false);
ok("alumnos por número de lista", /No\. 1<\/span>/.test(html1) && /No\. 6<\/span>/.test(html1), true);
const g1 = slide(s1, "Desempeño de 1°").html;
ok("barras en orden de lista, no por resultado", [g1.indexOf("No. 1<"), g1.indexOf("No. 2<"), g1.indexOf("No. 3<")].every((v, i, a) => v !== -1 && (i === 0 || v > a[i - 1])), true);
ok("barras con el color del grado, no con semáforo", g1.indexOf(RD.COLOR_GRADO[1]) !== -1 && !/requiere apoyo/i.test(textoPlano(g1)), true);
ok("alumno sin datos: 'Sin datos este trimestre'", /Sin datos este trimestre/.test(slide(s1, "Desempeño de 2°").html), true);
ok("panorama: X de Y con calificación confirmada", /<strong>1 de 6<\/strong> alumnos con calificación confirmada/.test(html1), true);
ok("panorama: no muestra calificaciones (ni la propuesta 8)", /calificación propuesta|propuesta:/i.test(html1), false);
ok("portada: escuela, grupo, ciclo, trimestre y fecha",
	["Escuela de prueba", "Grupo 1°-2° de prueba", "2026-2027", "1er trimestre", "23 de septiembre de 2026"].every((t) => slide(s1, "Portada").html.indexOf(t) !== -1), true);
ok("portada: nota de privacidad", /número de lista, sin nombre/.test(slide(s1, "Portada").html), true);
ok("colores NEM en el promedio por campo", ["#059669", "#ea580c", "#7c3aed", "#0284c7"].every((c) => slide(s1, "Promedio por campo").html.indexOf(c) !== -1), true);
ok("sin emojis en el render", sinEmojis(html1), true);
ok("montar: indicador y pie en cada diapositiva", (J.montar(s1, m1).match(/class='j-pie'/g) || []).length, 9);

// ── Áreas de atención (agregadas) ───────────────────────────────────────────
console.log("\nÁreas de atención");
const at = m1.atencion;
ok("lectura: requiere apoyo + cercano, sobre alumnos con PPM", [at.lectura.n, at.lectura.total], [3, 5]);
ok("lectura: desglose solo de grados con 3 o más alumnos con dato", at.lectura.porGrado, [{ grado: 1, total: 3, n: 2 }]);
const rubro = (r) => at.rubros.find((x) => x.def.rubro === r);
ok("tareas bajo 60 % (todo el trimestre)", [rubro("tareas").n, rubro("tareas").total], [2, 5]);
ok("trabajos: nadie bajo 60 %", rubro("trabajos").n, 0);
ok("examen bajo 60 %", rubro("examen").n, 1);
ok("participación: el día normal vale completo; solo cuenta bajo 60 %", rubro("participacion").n, 1);
ok("conducta al 100 %: no es área", rubro("conducta").n, 0);
ok("PDA con mayoría en requiere apoyo (≥2 evidencias, ≥2 evaluados)", at.pda.map((p) => [p.grado, p.campo, p.n, p.total]), [[1, "LEN", 2, 3], [2, "ETI", 2, 3]]);

const sNombres = J.diapositivas(m1, { mostrarNombres: true });
const areasHtml = slide(sNombres, "Áreas de atención").html + slide(sNombres, "Aprendizajes por reforzar").html;
ok("áreas: nunca nombres ni número de lista, ni con 'Mostrar nombres'",
	NOMBRES.some((n) => areasHtml.indexOf(n) !== -1) || /No\. \d/.test(areasHtml), false);
ok("áreas: conteos agregados", /<strong>3 de 5<\/strong> alumnos todavía no alcanzan/.test(areasHtml), true);
ok("áreas: el examen se rotula como aproximado", /dato aproximado/.test(areasHtml), true);
ok("con 'Mostrar nombres' sí aparecen en las barras", NOMBRES.every((n) => sNombres.map((d) => d.html).join("").indexOf(n) !== -1), true);

// ── Sugerencias del cierre (Capa 1, las más frecuentes) ─────────────────────
console.log("\nSugerencias del cierre");
const sug = m1.sugerencias;
ok("máximo 4", sug.length <= 4, true);
ok("la más frecuente primero (lectura: 3 alumnos)", sug[0].clave, "lectura_ppm");
ok("sin las sugerencias que hablan de 'este aprendizaje'", sug.some((s) => /pda_/.test(s.clave)), false);
const mates = sug.find((s) => s.clave === "matematicas");
ok("matemáticas con las habilidades más frecuentes del grupo", mates && mates.texto, "Practicar con ejercicios cortos y diarios: suma y resta.");
const cierre = slide(s1, "Cómo apoyar").html;
ok("cierre sin nombres ni números de lista", NOMBRES.some((n) => cierre.indexOf(n) !== -1) || /No\. \d/.test(cierre), false);
ok("clavePlantilla respeta el catálogo de la BD",
	J.clavePlantilla("Leer 15 minutos.", { lectura_ppm: "Leer 15 minutos.", tareas: "x" }), "lectura_ppm");

// ── 2. 2do trimestre con el 1ro capturado ───────────────────────────────────
console.log("\n2do trimestre con el 1ro capturado");
const m2 = J.construirModelo({ ctx: ctx, trimestre: 2, actual: trimestre1(), anterior: anterior1(), fecha: FECHA });
ok("hay comparación", m2.comparacion, true);
ok("promedio anterior del grupo (80, 65, 20, 80)", m2.resumen.anterior, 61.25);
ok("el cambio compara a los mismos alumnos: ahora (90, 60, 30, 80)", m2.resumen.actualComparable, 65);
ok("delta del grupo en puntos, a un decimal (65 − 61.25)", m2.resumen.delta, 3.8);
ok("se avisa que no son todos los alumnos (uno no tiene 1er trimestre)", m2.resumen.mismosAlumnos, false);
ok("deltas por alumno", m2.alumnos.map((a) => a.delta), [10, -5, 10, 0, null, null]);
ok("mejoraron / comparables", [m2.resumen.mejoraron, m2.resumen.comparables], [2, 4]);
ok("delta por grado solo con los mismos alumnos (2°: el que no tiene 1er trimestre no cuenta)", m2.grados.map((g) => g.resumen.delta), [5, 0]);
ok("delta por campo con los mismos alumnos (LEN 2°: solo el alumno 4)", m2.grados[1].porCampo.LEN.delta, 0);
const s2 = J.diapositivas(m2, { mostrarNombres: false });
const html2 = s2.map((d) => d.html).join("\n");
ok("barras del trimestre anterior", /j-barra-ant/.test(html2), true);
ok("ya no dice 'Sin trimestre anterior'", /Sin trimestre anterior/.test(html2), false);
ok("panorama: '2 de 4' subieron", /<strong>2 de 4<\/strong> alumnos subieron su promedio/.test(html2), true);
ok("cambio negativo en gris neutro, con signo menos y sin palabras", /j-delta j-neutro'>−5\.0/.test(html2) && !/bajó|empeor/i.test(html2), true);
ok("cambio positivo marcado", /j-delta j-sube'>\+10\.0/.test(html2), true);
ok("leyenda con el trimestre anterior", /1er trimestre/.test(slide(s2, "Desempeño de 1°").html), true);
ok("2°: dice que compara a los mismos alumnos", /Mismos 1 alumnos/.test(slide(s2, "Desempeño de 2°").html), true);
ok("panorama: aviso de mismos alumnos", /Compara a los mismos 4 alumnos/.test(slide(s2, "Panorama").html), true);
ok("promedio por campo: nota de mismos alumnos", /mismos alumnos/.test(slide(s2, "Promedio por campo").html), true);

// ── 3. 2do trimestre con el 1ro vacío ────────────────────────────────────────
console.log("\n2do trimestre con el 1ro sin datos");
const m3 = J.construirModelo({ ctx: ctx, trimestre: 2, actual: trimestre1(), anterior: vacio(), fecha: FECHA });
ok("sin comparación", [m3.comparacion, m3.motivoSinComparacion], [false, "sin_datos_anterior"]);
const html3 = J.diapositivas(m3, {}).map((d) => d.html).join("\n");
ok("dice que no hay datos del 1er trimestre", /no hay datos del 1er trimestre/.test(html3), true);
ok("ningún delta inventado", /j-delta|j-barra-ant/.test(html3), false);

// 1er trimestre aunque llegue un "anterior": se ignora
const m4 = J.construirModelo({ ctx: ctx, trimestre: 1, actual: trimestre1(), anterior: anterior1(), fecha: FECHA });
ok("en el 1er trimestre nunca hay comparación", m4.comparacion, false);

// ── 4. Trimestre sin datos ───────────────────────────────────────────────────
console.log("\nTrimestre sin datos");
const m5 = J.construirModelo({ ctx: ctx, trimestre: 2, actual: vacio(), anterior: trimestre1(), fecha: FECHA });
ok("hayDatos = false (la página muestra el estado vacío)", m5.hayDatos, false);
ok("sin comparación contra un trimestre vacío", m5.comparacion, false);
const soloPpm = vacio(); soloPpm.diagnosticas = { a1: { alumno_id: "a1", lectura_ppm: 40 } };
ok("con solo un PPM capturado sí hay algo que presentar", J.construirModelo({ ctx: ctx, trimestre: 2, actual: soloPpm, anterior: null }).hayDatos, true);

// ── 5. Grupo grande: columnas y cortes de diapositiva ────────────────────────
console.log("\nGrupo grande");
const grande = { alumnos: [], bandas: BANDAS, plantillas: {}, grupo: { nombre: "3° grande" }, ciclo: "2026-2027", escuela: "", maestroNombre: "" };
const datosGrande = { motor: { porAlumno: {} }, diagnosticas: {}, avancePda: [], boletas: {} };
for (let i = 1; i <= 30; i++) {
	grande.alumnos.push({ id: "x" + i, nombre_completo: "ALUMNO " + i, num_lista: i, grado: 3 });
	datosGrande.motor.porAlumno["x" + i] = motorAlumno({ LEN: 50 + i, SAB: 60, ETI: 70, DHL: 80 }, BIEN);
	datosGrande.diagnosticas["x" + i] = { alumno_id: "x" + i, lectura_ppm: 40 + i * 2 };
}
const sg = J.diapositivas(J.construirModelo({ ctx: grande, trimestre: 1, actual: datosGrande }), {});
const titulos = sg.map((d) => d.titulo);
ok("30 alumnos de un grado: dos diapositivas de barras", titulos.filter((t) => /^Desempeño de 3° grado \(\d de 2\)$/.test(t)).length, 2);
ok("más de 12 filas: dos columnas", /--columnas:2/.test(slide(sg, "Desempeño de 3° grado (1").html), true);
ok("fluidez partida sin pasarse de 12 por diapositiva", titulos.filter((t) => /^Fluidez lectora/.test(t)).length, 3);

// ── 6. Boletas cerradas: la junta usa la foto del cierre (decisión de Jorge 7) ─
console.log("\nBoletas cerradas");
{
	// b1 cerró en 1° con 70 % en cada campo, tareas al 40 %, 20 ppm contra la banda de 1°;
	// después le cambiaron el grado a 2° y se capturó más (hoy 80 %, 90 ppm)
	const d = trimestre1();
	const pcCierre = motorAlumno({ LEN: 70, SAB: 70, ETI: 70, DHL: 70 }, Object.assign({}, BIEN, { tareas: 0.4 })).porCampo;
	const foto = {
		trabajo_diario: "", diagnostico: { lectura_ppm: 20, lectura_comprension: null, cuaderno: [], matematicas: [] },
		asistencia: { presentes: 18, total: 20, porcentaje: 0.9 },
		alumno: RD.fotoAlumno({ grado: 1 }, BANDAS[1]),
		campos: RD.fotoCampos(pcCierre), pesos: {},
		avance_pda: [{ grado: 1, clave_pda: "P1", campo_formativo: "Lenguajes", pda: "Escribe su nombre y lo compara con otros", evidencias: 2, nivel_predominante: "requiere_apoyo", tendencia: "estable" }],
	};
	const filas = {};
	RD.CAMPOS.forEach((c) => { filas[c] = { calificacion: 7, porcentaje: 70, calificacion_confirmada: true, cerrada: true }; });
	filas.GEN = { campo: "GEN", texto_autogenerado: { cierre: foto } };
	d.boletas.b1 = { 1: filas, 2: {}, 3: {} };
	const cong = RD.congelarCerradas(ctx, d, 1);
	ok("congelar: b1 con el grado del cierre", cong.alumnos.find((a) => a.id === "b1").grado, 1);
	ok("congelar: orden de lista con el grado del cierre (b1 con los de 1°)", cong.alumnos.map((a) => a.id), ["a1", "a2", "a3", "b1", "b2", "b3"]);
	{
		// a1 cerró en 1° y hoy está en 2° (y la lista llega en otro orden): vuelve a 1°, por su número
		const alumnosHoy = ctx.alumnos.map((a) => a.id === "a1" ? Object.assign({}, a, { grado: 2, num_lista: 9 }) : a);
		const fa = { alumno: RD.fotoAlumno({ grado: 1 }, BANDAS[1]), campos: RD.fotoCampos(pcCierre) };
		const fl = {};
		RD.CAMPOS.forEach((c) => { fl[c] = { calificacion: 7, porcentaje: 70, calificacion_confirmada: true, cerrada: true }; });
		fl.GEN = { campo: "GEN", texto_autogenerado: { cierre: fa } };
		const d2 = trimestre1(); d2.boletas.a1 = { 1: fl, 2: {}, 3: {} };
		ok("congelar: quien cambió de grado después del cierre vuelve a su lugar de lista",
			RD.congelarCerradas(Object.assign({}, ctx, { alumnos: alumnosHoy.slice(1, 3).concat(alumnosHoy.slice(3)).concat([alumnosHoy[0]]) }), d2, 1).alumnos.map((a) => a.id),
			["a2", "a3", "a1", "b1", "b2", "b3"]);
	}
	ok("congelar: los abiertos no cambian", cong.alumnos.find((a) => a.id === "b2").grado, 2);
	ok("congelar: porcentaje del cierre", cong.motor.porAlumno.b1.porCampo.LEN.porcentaje, 70);
	ok("congelar: el abierto sigue en vivo", cong.motor.porAlumno.b2.porCampo.LEN.porcentaje, 50);
	ok("congelar: lectura del cierre", cong.diagnosticas.b1.lectura_ppm, 20);
	ok("congelar: banda del cierre", cong.bandasAlumno.b1.estandar_max, 59);
	ok("congelar: avance por PDA del cierre (P3 de hoy ya no, P1 del cierre sí)",
		cong.avancePda.filter((f) => f.alumno_id === "b1").map((f) => f.clave_pda), ["P1"]);
	ok("congelar: no toca los datos originales", d.motor.porAlumno.b1.porCampo.LEN.porcentaje, 80);
	ok("congelar: marca cerrados", cong.cerrados, { b1: true });

	const m = J.construirModelo({ ctx: ctx, trimestre: 1, actual: cong });
	const b1 = m.alumnos.find((a) => a.id === "b1");
	ok("junta: b1 cuenta en 1° (grado del cierre)", m.grados.find((g) => g.grado === 1).alumnos.map((a) => a.id), ["a1", "a2", "a3", "b1"]);
	ok("junta: promedio de b1 = el de su boleta cerrada", b1.actual, 70);
	ok("junta: fluidez contra la banda del cierre (20 ppm en 1° = cercano)", b1.fluidez, "cercano");
	ok("junta: tareas del cierre (40 %) cuentan en atención", b1.rubros.tareas, 40);
	// Promedio del grupo a mano: a1 90, a2 60, a3 30, b1 70 (cierre), b2 50 → 300 / 5 = 60
	ok("junta: promedio del grupo cuadra con la boleta cerrada", Math.round(m.resumen.actual * 10) / 10, 60);
	ok("junta: 1 de 6 con boleta cerrada", [m.cierre.cerrados, m.cierre.total], [1, 6]);
	const pan = slide(J.diapositivas(m, {}), "Panorama").html;
	ok("junta: explica la mezcla de cerrados y abiertos", pan.indexOf("1 de 6 alumnos tienen la boleta cerrada") !== -1, true);
	ok("textoCierre: todos cerrados", J.textoCierre({ cerrados: 3, total: 3 }), "Todas las boletas del trimestre están cerradas: los datos son los que se entregaron.");
	ok("textoCierre: ninguno cerrado, sin texto", J.textoCierre({ cerrados: 0, total: 3 }), "");
	const sinMezcla = slide(J.diapositivas(J.construirModelo({ ctx: ctx, trimestre: 1, actual: RD.congelarCerradas(ctx, trimestre1(), 1) }), {}), "Panorama").html;
	ok("junta: sin cerradas no hay texto de mezcla", sinMezcla.indexOf("data-junta-cierre") === -1, true);

	// Juicio docente: b3 sin evidencias con sus cuatro calificaciones elegidas
	const dj = trimestre1();
	const fj = {};
	RD.CAMPOS.forEach((c) => { fj[c] = { calificacion: 6, porcentaje: null, calificacion_confirmada: true, cerrada: false }; });
	dj.boletas.b3 = { 1: fj, 2: {}, 3: {} };
	const mj = J.construirModelo({ ctx: ctx, trimestre: 1, actual: RD.congelarCerradas(ctx, dj, 1) });
	ok("junta: cuenta la boleta por juicio como confirmada", mj.confirmadas.alumnos, 2);
	// a1 también: su DHL confirmado no tiene evidencias hoy (porcentaje null)
	ok("junta: cuenta 2 alumnos con calificación por juicio docente (b3 y el DHL de a1)", mj.cierre.juicio, 2);
	ok("junta: lo dice sin nombres", slide(J.diapositivas(mj, {}), "Panorama").html.indexOf("2 alumnos tienen alguna calificación asignada por juicio docente") !== -1, true);
	ok("junta: sin calificaciones por juicio no lo menciona",
		slide(J.diapositivas(J.construirModelo({ ctx: grande, trimestre: 1, actual: datosGrande }), {}), "Panorama").html.indexOf("data-junta-juicio") === -1, true);
}

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
