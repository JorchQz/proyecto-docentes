/*
	Pruebas de la exportación del concentrado por alumno (B.8.5).

	Corre la parte pura de js/exportar.js (columnas, filas, CSV, nombre de archivo,
	hoja Léeme) con los módulos reales de los que depende (textos-boleta,
	reporte-datos, catálogo de habilidades) y datos de ejemplo con comas, comillas,
	acentos, calificación "pendiente", una confirmada y un alumno sin diagnóstico.

	node pruebas/exportar.test.js
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
const E = require("../js/exportar.js");
const catalogo = window.CatalogoHabilidades;

// ── Columnas: las de BD_Alumnos de Fanny, en su orden, con DHL ──────────────
const ESPERADAS = ["Alumno", "Grado"];
["LEN", "SAB", "ETI", "DHL"].forEach((c) => {
	// La conducta no pondera (decisión de Jorge del 2026-09-24), pero su columna se queda en
	// su lugar y con el encabezado EXACTO de la hoja de Fanny ("LEN: Cond."): ella copia por
	// encabezado. Que es referencia lo dice la hoja Léeme.
	["Tareas", "Trabajos", "Asist.", "Part.", "Cond.", "Examen"].forEach((r) => ESPERADAS.push(c + ": " + r));
});
ESPERADAS.push(
	"Cuaderno: Orden/limpieza", "Cuaderno: Fecha", "Cuaderno: Título", "Cuaderno: Letra", "Cuaderno: Mayús/Minús",
	"Cuaderno: Signos", "Cuaderno: Acentuación", "Cuaderno: Buen estado", "Cuaderno: Orden proyecto", "Cuaderno: Margen",
	"Lectura: PPM", "Lectura: Comprensión",
	"Mates: Suma", "Mates: Resta", "Mates: Multiplicación", "Mates: División", "Mates: Fracciones", "Mates: Tablas",
	"Mates: Lectura y Escritura Cant", "Problemas matemáticos",
	"Trabajo Diario", "Fortalezas", "Áreas de Oportunidad",
	"Asistencia (referencia, no pondera)",
	"LEN: Calificación", "SAB: Calificación", "ETI: Calificación", "DHL: Calificación",
	// Al final, sin mover las de la hoja de Fanny
	"Boleta del trimestre", "Juicio docente sin evidencias",
	// Evaluación final del ciclo (Acuerdo 10/09/23, arts. 7 y 9), también al final
	"LEN: Final", "SAB: Final", "ETI: Final", "DHL: Final", "Promedio final de grado", "Acreditación"
);
const ENC = E.encabezados();
ok("encabezados en el orden exacto de la hoja", ENC, ESPERADAS);
ok("62 columnas (las 54 de la hoja + boleta y juicio + 6 de la evaluación final)", ENC.length, 62);
ok("las columnas de la hoja de Fanny no se movieron (Cond. sigue en la 7a)", ENC.indexOf("LEN: Cond."), 6);
ok("las columnas nuevas van al final", ENC.slice(-6), ["LEN: Final", "SAB: Final", "ETI: Final", "DHL: Final", "Promedio final de grado", "Acreditación"]);
ok("nunca HUM", ENC.some((h) => /HUM/.test(h)), false);
ok("claves de cuaderno existen en el catálogo",
	E.CUADERNO_COLS.every((x) => catalogo.CUADERNO.some((c) => c.clave === x.clave)) && E.CUADERNO_COLS.length === catalogo.CUADERNO.length, true);
ok("claves de matemáticas existen en el catálogo",
	E.MATES_COLS.every((x) => catalogo.MATEMATICAS.some((c) => c.clave === x.clave)) && E.MATES_COLS.length === catalogo.MATEMATICAS.length, true);

const col = (titulo) => ENC.indexOf(titulo);

// ── Datos de ejemplo ────────────────────────────────────────────────────────
function rubro(obtenido, maximo, entrega) {
	const r = { obtenido, maximo, fraccion: maximo > 0 ? obtenido / maximo : null, peso: 20 };
	if (entrega) r.entrega = entrega; // conteos de entrega del motor (los usan los textos)
	return r;
}
function campo(r) {
	const base = { tareas: rubro(0, 0), trabajos: rubro(0, 0), participacion: rubro(0, 0), conducta: rubro(0, 0), examen: rubro(0, 0) };
	return { rubros: Object.assign(base, r), porcentaje: 80, calificacionPropuesta: 9, nivel: "logrado" };
}

const JOSE = { id: "a1", nombre_completo: "Pérez, José \"Pepe\" Ñúñez", grado: 1, num_lista: 1 };
const LUCIA = { id: "a2", nombre_completo: "Lucía Óscar Güemes", grado: 4, num_lista: 1 };
const RAUL = { id: "a3", nombre_completo: "=Raúl Fórmula", grado: 2, num_lista: 2 };

const motor = {
	sinProyectos: false,
	porAlumno: {
		a1: {
			porCampo: {
				LEN: campo({ tareas: rubro(2.66, 3), trabajos: rubro(3.7, 4), participacion: rubro(3.25, 4), conducta: rubro(4, 4), examen: rubro(0.6666666, 1) }),
				SAB: campo({ tareas: rubro(1, 2), examen: rubro(0.5, 1) }),
				ETI: campo({}),
				DHL: campo({ trabajos: rubro(0.4, 1) }),
			},
			asistencia: { presentes: 11, total: 12, porcentaje: 11 / 12 },
		},
		a2: {
			// Multigrado: su máximo es otro (productos de 4°, un justificado fuera)
			porCampo: {
				LEN: campo({
					tareas: rubro(0, 2, { esperados: 2, entregados: 0, completos: 0, sumaEntregados: 0 }),
					trabajos: rubro(5, 5, { esperados: 5, entregados: 5, completos: 5, sumaEntregados: 5 }),
				}),
				SAB: campo({}), ETI: campo({}), DHL: campo({}),
			},
			asistencia: { presentes: 12, total: 12, porcentaje: 1 },
		},
		a3: {
			porCampo: { LEN: campo({}), SAB: campo({}), ETI: campo({}), DHL: campo({}) },
			asistencia: { presentes: 0, total: 0, porcentaje: null },
		},
	},
};

const diagnosticas = {
	a1: {
		alumno_id: "a1",
		cuaderno: [{ clave: "cuaderno.orden_limpieza", nivel: "logrado" }, { clave: "cuaderno.respeta_margen", nivel: "requiere_apoyo" }],
		lectura_ppm: 35,
		lectura_comprension: "en_proceso",
		matematicas: [{ clave: "mates.suma", nivel: "logrado" }, { clave: "mates.problemas", nivel: "en_proceso" }],
		observaciones: "Trabaja bien, pero se distrae con \"la tablet\".",
	},
	// a2 y a3: sin diagnóstico
};

const boletas = {
	a1: {
		1: {
			LEN: { campo: "LEN", calificacion: 9, calificacion_confirmada: true, cerrada: false,
				fortalezas: "Lee con entusiasmo,\ny pregunta lo que no entiende.", editado_manual: true, areas_oportunidad: null,
				texto_autogenerado: { editados: ["fortalezas"] } }, // escribió solo fortalezas
			SAB: { campo: "SAB", calificacion: 6, calificacion_confirmada: false, cerrada: false, fortalezas: null },
		},
		2: {}, 3: {},
	},
	a2: { 1: { DHL: { campo: "DHL", calificacion: 5, calificacion_confirmada: false } }, 2: {}, 3: {} },
	a3: { 1: {}, 2: {}, 3: {} },
};

const bandas = { 1: { grado: 1, requiere_apoyo_max: 40, cercano_max: 59, estandar_max: 80 } };

const tabla = E.construir({
	alumnos: [JOSE, LUCIA, RAUL], trimestre: 1, motor, diagnosticas, avancePda: [], boletas, bandas, plantillas: {},
});
const [fJose, fLucia, fRaul] = tabla.filas;
const [mJose, mLucia, mRaul] = tabla.maximos;

ok("una fila por alumno, en el orden dado", tabla.filas.map((f) => f[0]), [JOSE.nombre_completo, LUCIA.nombre_completo, RAUL.nombre_completo]);
ok("cada fila tiene 62 celdas", tabla.filas.every((f) => f.length === 62) && tabla.maximos.every((f) => f.length === 62), true);
ok("grado numérico", fJose[col("Grado")], 1);

// Rubros: obtenido del motor con 1 decimal
ok("LEN tareas 2.66 → 2.7", fJose[col("LEN: Tareas")], 2.7);
ok("LEN trabajos 3.7", fJose[col("LEN: Trabajos")], 3.7);
ok("LEN part. 3.25 → 3.3", fJose[col("LEN: Part.")], 3.3);
ok("LEN conducta: el dato se sigue exportando como referencia (4 de 4)", fJose[col("LEN: Cond.")], 4);
ok("LEN examen 0.667 → 0.67 (dos decimales: con uno, 2/3 se leía 70 %)", fJose[col("LEN: Examen")], 0.67);
ok("rubro sin evidencias queda vacío (no 0)", fJose[col("SAB: Trabajos")], null);
ok("obtenido 0 con máximo > 0 sí es 0", fLucia[col("LEN: Tareas")], 0);
ok("Asist. = días asistidos, igual en los cuatro campos",
	["LEN", "SAB", "ETI", "DHL"].map((c) => fJose[col(c + ": Asist.")]), [11, 11, 11, 11]);
ok("sin lista de asistencia: Asist. vacío", fRaul[col("LEN: Asist.")], null);

// Máximos por alumno (multigrado)
ok("máximo de José en LEN tareas", mJose[col("LEN: Tareas")], 3);
ok("máximo de Lucía en LEN trabajos (su grado)", mLucia[col("LEN: Trabajos")], 5);
ok("máximo de Asist. = días con lista", mJose[col("DHL: Asist.")], 12);
ok("máximo sin evidencias = 0", mRaul[col("ETI: Examen")], 0);
ok("hoja de máximos: nombre y grado", [mLucia[0], mLucia[1]], [LUCIA.nombre_completo, 4]);
ok("hoja de máximos: sin textos ni calificaciones", mJose.slice(col("Cuaderno: Orden/limpieza")).every((v) => v === null), true);

// Diagnóstico
ok("cuaderno logrado", fJose[col("Cuaderno: Orden/limpieza")], "Logrado");
ok("cuaderno requiere apoyo", fJose[col("Cuaderno: Margen")], "Requiere apoyo");
ok("criterio no capturado vacío", fJose[col("Cuaderno: Fecha")], null);
ok("PPM", fJose[col("Lectura: PPM")], 35);
ok("comprensión en proceso", fJose[col("Lectura: Comprensión")], "En proceso");
ok("mates suma", fJose[col("Mates: Suma")], "Logrado");
ok("problemas matemáticos", fJose[col("Problemas matemáticos")], "En proceso");
ok("alumno sin diagnóstico: cuaderno, lectura y mates vacíos",
	fLucia.slice(col("Cuaderno: Orden/limpieza"), col("Trabajo Diario")).every((v) => v === null), true);
// Matemáticas por grado: las 8 columnas siempre; lo que no corresponde al grado dice "No aplica"
const MATES_NO_1 = ["Mates: Multiplicación", "Mates: División", "Mates: Fracciones", "Mates: Tablas"];
ok("1°: multiplicación, división, fracciones y tablas dicen No aplica", MATES_NO_1.map((c) => fJose[col(c)]), ["No aplica", "No aplica", "No aplica", "No aplica"]);
ok("2° sin diagnóstico: solo fracciones dice No aplica, lo demás vacío",
	E.MATES_COLS.map((x) => fRaul[col(x.titulo)]), [null, null, null, null, "No aplica", null, null, null]);
ok("4°: ninguna dice No aplica", E.MATES_COLS.some((x) => fLucia[col(x.titulo)] === "No aplica"), false);
ok("Léeme: explica No aplica", E.hojaLeeme({}).some((f) => /No aplica/.test(f[0] || "")), true);

// Textos
ok("trabajo diario: el del maestro", fJose[col("Trabajo Diario")], "Trabaja bien, pero se distrae con \"la tablet\".");
ok("trabajo diario sin diagnóstico: la propuesta de la Capa 1",
	fLucia[col("Trabajo Diario")], window.TextosBoleta.TRABAJO_DIARIO.tareas_mal);
ok("fortaleza editada por el maestro, en una línea y con su campo",
	fJose[col("Fortalezas")].indexOf("LEN: Lee con entusiasmo, y pregunta lo que no entiende.") === 0, true);
ok("fortalezas de varios campos separadas con |", / \| /.test(fJose[col("Fortalezas")]), true);
ok("área propuesta por PPM bajo (sin texto guardado)",
	/LEN: .*velocidad de lectura/.test(fJose[col("Áreas de Oportunidad")]), true);
// No entregar tareas es un hábito: va a la fila general, no a un campo
ok("área de tareas de Lucía (0 de 2)", /General: No entrega todas sus tareas\./.test(fLucia[col("Áreas de Oportunidad")]), true);
ok("sin datos: fortalezas vacías", fRaul[col("Fortalezas")], null);

// Asistencia de referencia y calificaciones
ok("asistencia de referencia en %", fJose[col("Asistencia (referencia, no pondera)")], 91.7);
ok("asistencia de referencia sin lista: vacía", fRaul[col("Asistencia (referencia, no pondera)")], null);
ok("LEN confirmada = número", fJose[col("LEN: Calificación")], 9);
ok("SAB con número sin confirmar = pendiente", fJose[col("SAB: Calificación")], "pendiente");
ok("campo sin fila de boleta = pendiente", fJose[col("ETI: Calificación")], "pendiente");
ok("Lucía: nada confirmado, todo pendiente",
	["LEN", "SAB", "ETI", "DHL"].map((c) => fLucia[col(c + ": Calificación")]), ["pendiente", "pendiente", "pendiente", "pendiente"]);
// Evaluación final: con solo T1 no hay final (nunca un número parcial como final)
ok("final con solo el T1 confirmado: pendiente en los cuatro campos",
	["LEN", "SAB", "ETI", "DHL"].map((c) => fJose[col(c + ": Final")]), ["pendiente", "pendiente", "pendiente", "pendiente"]);
ok("promedio final y acreditación pendientes", [fJose[col("Promedio final de grado")], fJose[col("Acreditación")]], ["pendiente", "pendiente"]);
ok("otro trimestre no toma la boleta del T1",
	E.construir({ alumnos: [JOSE], trimestre: 2, motor, diagnosticas: {}, avancePda: [], boletas, bandas }).filas[0][col("LEN: Calificación")], "pendiente");

// ── CSV ─────────────────────────────────────────────────────────────────────
function parsearCSV(texto) {
	const filas = [];
	let fila = [], celda = "", comillas = false;
	for (let i = 0; i < texto.length; i++) {
		const ch = texto[i];
		if (comillas) {
			if (ch === "\"" && texto[i + 1] === "\"") { celda += "\""; i++; }
			else if (ch === "\"") comillas = false;
			else celda += ch;
		} else if (ch === "\"") comillas = true;
		else if (ch === ",") { fila.push(celda); celda = ""; }
		else if (ch === "\r" && texto[i + 1] === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; i++; }
		else celda += ch;
	}
	if (celda || fila.length) { fila.push(celda); filas.push(fila); }
	return filas;
}

const csv = E.aCSV(tabla.encabezados, tabla.filas);
ok("CSV empieza con BOM", csv.charCodeAt(0), 0xfeff);
ok("CSV termina con CRLF", csv.slice(-2), "\r\n");
const bytes = Buffer.from(csv, "utf8");
ok("BOM UTF-8 en bytes", [bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf]);
ok("acentos intactos tras UTF-8", Buffer.from(csv, "utf8").toString("utf8").indexOf("Ñúñez") !== -1, true);
const leido = parsearCSV(csv.slice(1));
ok("CSV: 1 encabezado + 3 alumnos", leido.length, 4);
ok("CSV: encabezados iguales", leido[0], ESPERADAS);
ok("CSV: todas las filas con 62 celdas", leido.every((f) => f.length === 62), true);
ok("CSV: nombre con coma y comillas vuelve igual", leido[1][0], JOSE.nombre_completo);
ok("CSV: nombre con comillas va entrecomillado y duplicado",
	csv.indexOf("\"Pérez, José \"\"Pepe\"\" Ñúñez\"") !== -1, true);
ok("CSV: texto que empieza con = no se vuelve fórmula", leido[3][0], "'=Raúl Fórmula");
ok("CSV: decimal con punto", leido[1][col("LEN: Tareas")], "2.7");
ok("CSV: vacío es celda vacía", leido[1][col("SAB: Trabajos")], "");
ok("CSV: pendiente", leido[1][col("SAB: Calificación")], "pendiente");
ok("CSV: confirmada", leido[1][col("LEN: Calificación")], "9");
ok("CSV: la propuesta sin confirmar (6) no aparece", leido[1][col("SAB: Calificación")] !== "6", true);
ok("CSV: trabajo diario con comillas", leido[1][col("Trabajo Diario")], "Trabaja bien, pero se distrae con \"la tablet\".");
ok("celda con espacio al inicio va entre comillas", E.celdaCSV(" hola"), "\" hola\"");
ok("celda número", E.celdaCSV(0), "0");
ok("celda null", E.celdaCSV(null), "");
ok("celda -texto protegida", E.celdaCSV("-1 tarea"), "'-1 tarea");

// ── Nombre de archivo ───────────────────────────────────────────────────────
ok("nombre CSV", E.nombreArchivo("QA 1°-2° (Fase 3)", 1, "2026-2027", "csv"), "concentrado-qa-1-2-fase-3-T1-2026-2027.csv");
ok("nombre XLSX con acentos y ñ", E.nombreArchivo("Grupo Ñandú / 5°-6° «B»", 2, "2025-2026", "xlsx"), "concentrado-grupo-nandu-5-6-b-T2-2025-2026.xlsx");
ok("nombre sin ciclo ni grupo", E.nombreArchivo("", 3, "", "csv"), "concentrado-grupo-T3.csv");

// ── Hoja Léeme ──────────────────────────────────────────────────────────────
const leeme = E.hojaLeeme({ grupo: "QA", ciclo: "2026-2027", trimestre: 1, fecha: "2026-09-23", alumnos: 3,
	escala: { logrado: 1, en_proceso: 0.7, requiere_apoyo: 0.4 } });
const textoLeeme = leeme.map((f) => f.join(" ")).join("\n");
ok("Léeme: la calificación válida es la confirmada", /CONFIRMADA por el docente en Mi salón/.test(textoLeeme), true);
ok("Léeme: asistencia art. 7", /Acuerdo 10\/09\/23, art\. 7/.test(textoLeeme), true);
ok("Léeme: no recalcular con plantilla que pondere asistencia", /NO debe usarse esta exportación para recalcular calificaciones con una plantilla que pondere la asistencia/.test(textoLeeme), true);
ok("Léeme: examen aproximado", /examen por campo es APROXIMADO/.test(textoLeeme), true);
ok("Léeme: no es documento oficial", /no es un documento oficial de la SEP/.test(textoLeeme), true);
ok("Léeme: escala del motor", /Logrado = 1, En proceso = 0\.7, Requiere apoyo = 0\.4/.test(textoLeeme), true);
ok("Léeme: explica cada grupo de columnas",
	["Tareas", "Trabajos", "Asist.", "Part. / Cond.", "Examen", "Cuaderno / Lectura / Mates", "Trabajo Diario",
		"Fortalezas / Áreas de Oportunidad", "Asistencia (referencia, no pondera)", "Calificación"]
		.every((c) => leeme.some((f) => String(f[0]).indexOf(c) !== -1)), true);

// ── Libro XLSX con un SheetJS de mentira (la real se prueba en .qa/constructor-exportar) ──
const hojas = {};
const XLSXFalso = { utils: {
	book_new: () => ({ SheetNames: [], Sheets: {} }),
	aoa_to_sheet: (aoa) => ({ aoa, "!ref": "A1:BB" + aoa.length }),
	book_append_sheet: (wb, ws, nombre) => { wb.SheetNames.push(nombre); wb.Sheets[nombre] = ws; hojas[nombre] = ws; },
} };
const wb = E.libroXLSX(XLSXFalso, tabla, { grupo: "QA", trimestre: 1 });
ok("XLSX: tres hojas en orden", wb.SheetNames, ["Concentrado", "Máximos", "Léeme"]);
ok("XLSX: hoja principal = encabezados + filas", hojas["Concentrado"].aoa.length, 4);
ok("XLSX: hoja Máximos con los mismos encabezados", hojas["Máximos"].aoa[0], ESPERADAS);
ok("XLSX: anchos de columna", hojas["Concentrado"]["!cols"].length, 62);

// Ajustes del grupo al calendario oficial (calendario.html, b14): hoja "Calendario" solo si hay
{
	const ajustes = [{ fecha: "2026-10-12", tipo: "festividad_local", motivo: "Fiesta\npatronal" }, { fecha: "2026-10-30", tipo: "con_clase", motivo: null }];
	const wbCal = E.libroXLSX(XLSXFalso, tabla, { grupo: "QA", trimestre: 1, ajustesCalendario: ajustes });
	ok("XLSX con ajustes del calendario: cuarta hoja «Calendario»", wbCal.SheetNames, ["Concentrado", "Máximos", "Léeme", "Calendario"]);
	ok("hoja Calendario: fecha, día, qué es y motivo (en una línea)", hojas["Calendario"].aoa, [
		["Fecha", "Día", "Qué es", "Motivo"],
		["2026-10-12", "lunes", "Sin clase: festividad local", "Fiesta patronal"],
		["2026-10-30", "viernes", "Con clase (ajuste al calendario oficial)", ""],
	]);
	ok("Léeme explica la hoja Calendario solo si está", [E.hojaLeeme({ ajustesCalendario: ajustes }).some((f) => f[0] === "Calendario"), E.hojaLeeme({}).some((f) => f[0] === "Calendario")], [true, false]);
	ok("sin ajustes: tres hojas, como siempre", E.libroXLSX(XLSXFalso, tabla, { ajustesCalendario: [] }).SheetNames, ["Concentrado", "Máximos", "Léeme"]);
}

// ── Boleta cerrada y juicio docente (decisiones de Jorge 5, 6 y 7) ─────────
{
	const RD = window.ReporteDatos;
	// Raúl cerró en 2° con tareas 1 de 2 en LEN y 70 %; después pasó a 3° y se capturó más.
	// Lucía (abierta) no tiene evidencias en DHL y su DHL está confirmado por juicio.
	const pcCierre = { LEN: campo({ tareas: rubro(1, 2) }), SAB: campo({}), ETI: campo({}), DHL: campo({}) };
	pcCierre.LEN.porcentaje = 70;
	["SAB", "ETI", "DHL"].forEach((c) => { pcCierre[c].porcentaje = null; });
	const foto = {
		trabajo_diario: "Del cierre", trabajo_diario_del_maestro: true,
		diagnostico: { lectura_ppm: 44, lectura_comprension: "logrado", cuaderno: [], matematicas: [] },
		asistencia: { presentes: 9, total: 10, porcentaje: 0.9 },
		alumno: RD.fotoAlumno({ grado: 2 }, null), campos: RD.fotoCampos(pcCierre), pesos: {}, avance_pda: [],
	};
	const filasRaul = {};
	["LEN", "SAB", "ETI", "DHL"].forEach((c) => { filasRaul[c] = { campo: c, calificacion: c === "LEN" ? 8 : 7, porcentaje: c === "LEN" ? 70 : null, calificacion_confirmada: true, cerrada: true }; });
	filasRaul.GEN = { campo: "GEN", texto_autogenerado: { cierre: foto } };
	const motorHoy = JSON.parse(JSON.stringify(motor));
	motorHoy.porAlumno.a3.porCampo.LEN = campo({ tareas: rubro(5, 5) }); // capturas después del cierre
	motorHoy.porAlumno.a2.porCampo.DHL.porcentaje = null;
	const bol = {
		a1: boletas.a1,
		a2: { 1: { DHL: { campo: "DHL", calificacion: 8, porcentaje: null, calificacion_confirmada: true, cerrada: false } }, 2: {}, 3: {} },
		a3: { 1: filasRaul, 2: {}, 3: {} },
	};
	const RAUL_HOY = Object.assign({}, RAUL, { grado: 3 });
	const datos = RD.congelarCerradas({ alumnos: [JOSE, LUCIA, RAUL_HOY] },
		{ motor: motorHoy, diagnosticas: { a3: { alumno_id: "a3", lectura_ppm: 99 } }, avancePda: [], boletas: bol }, 1);
	const t2 = E.construir({ alumnos: datos.alumnos, trimestre: 1, motor: datos.motor, diagnosticas: datos.diagnosticas,
		avancePda: datos.avancePda, boletas: datos.boletas, bandas, plantillas: {} });
	const fila = (al) => t2.filas.find((f) => f[0] === al.nombre_completo);
	const r = fila(RAUL), l = fila(LUCIA), j = fila(JOSE);
	const mr = t2.maximos.find((f) => f[0] === RAUL.nombre_completo);
	ok("cerrada: en su lugar de lista con el grado del cierre (1°, 2°, 4°)", t2.filas.map((f) => f[1]), [1, 2, 4]);
	ok("cerrada: grado del cierre (2), no el de hoy (3)", r[col("Grado")], 2);
	ok("cerrada: No aplica según el grado del cierre (2°: fracciones), no el de hoy (3°)", r[col("Mates: Fracciones")], "No aplica");
	ok("cerrada: rubros del cierre (LEN tareas 1), no los de hoy (5)", r[col("LEN: Tareas")], 1);
	ok("cerrada: máximo del cierre (2)", mr[col("LEN: Tareas")], 2);
	ok("cerrada: asistencia del cierre", [r[col("LEN: Asist.")], r[col("Asistencia (referencia, no pondera)")]], [9, 90]);
	ok("cerrada: PPM del cierre (44), no el de hoy (99)", r[col("Lectura: PPM")], 44);
	ok("cerrada: trabajo diario del cierre", r[col("Trabajo Diario")], "Del cierre");
	ok("cerrada: columna Boleta", r[col("Boleta del trimestre")], "cerrada");
	ok("abierta: columna Boleta", l[col("Boleta del trimestre")], "abierta");
	ok("cerrada: juicio según la foto (SAB, ETI y DHL sin evidencias)", r[col("Juicio docente sin evidencias")], "SAB, ETI, DHL");
	ok("abierta: juicio en DHL (confirmado sin evidencias hoy)", l[col("Juicio docente sin evidencias")], "DHL");
	ok("sin juicio: celda vacía", j[col("Juicio docente sin evidencias")], null);
	ok("Léeme: explica las dos columnas nuevas",
		["Boleta del trimestre", "Juicio docente sin evidencias"].every((c) => E.hojaLeeme({}).some((f) => f[0] === c)), true);
}

// ── Evaluación final del ciclo (ReporteDatos.finalCiclo) ───────────────────
{
	const conf = (v) => ({ calificacion: v, calificacion_confirmada: true });
	const ciclo = (t1, t2, t3) => {
		const salida = { 1: {}, 2: {}, 3: {} };
		["LEN", "SAB", "ETI", "DHL"].forEach((c, i) => {
			salida[1][c] = conf(t1[i]); salida[2][c] = conf(t2[i]); salida[3][c] = conf(t3[i]);
		});
		return salida;
	};
	// Lucía (4°), redondeado al décimo como la plataforma de control escolar (antes truncado):
	// LEN 7, 8, 8 = 7.66 → 7.7; SAB 6, 6, 7 = 6.33 → 6.3; ETI 9, 9, 9 = 9.0; DHL 5, 6, 6 = 5.66 → 5.7.
	// Promedio de las finales redondeadas (7.7 + 6.3 + 9.0 + 5.7) / 4 = 7.175 → 7.2 (truncado daba 7.1)
	const bolFinal = { a2: ciclo([7, 6, 9, 5], [8, 6, 9, 6], [8, 7, 9, 6]) };
	const tf = E.construir({ alumnos: [LUCIA], trimestre: 3, motor, diagnosticas: {}, avancePda: [], boletas: bolFinal, bandas, plantillas: {} });
	const fl = tf.filas[0];
	ok("final: LEN 7, 8, 8 = 7.66 → 7.7 (redondeado; truncado daba 7.6)", fl[col("LEN: Final")], 7.7);
	ok("final: las cuatro", ["LEN", "SAB", "ETI", "DHL"].map((c) => fl[col(c + ": Final")]), [7.7, 6.3, 9, 5.7]);
	ok("final: promedio final de grado 7.175 → 7.2", fl[col("Promedio final de grado")], 7.2);
	// Decisión 18b: el promedio llega a 6 pero DHL (5.7) no → "Revisar", nunca "No acredita" por eso
	ok("final: 4° con 7.2 pero DHL 5.7 → Revisar", fl[col("Acreditación")], "Revisar");
	// Los cuatro campos en 6 o más → "Acredita" (LEN 7.7, SAB 6.3, ETI 9.0, DHL 6.0 → 7.25 → 7.3)
	const todos6 = { a2: ciclo([7, 6, 9, 6], [8, 6, 9, 6], [8, 7, 9, 6]) };
	const fa = E.construir({ alumnos: [LUCIA], trimestre: 3, motor, diagnosticas: {}, avancePda: [], boletas: todos6, bandas, plantillas: {} }).filas[0];
	ok("final: 4° con 7.3 y los cuatro campos en 6 o más → Acredita", [fa[col("DHL: Final")], fa[col("Promedio final de grado")], fa[col("Acreditación")]], [6, 7.3, "Acredita"]);
	ok("final: la misma en cualquier trimestre exportado",
		E.construir({ alumnos: [LUCIA], trimestre: 1, motor, diagnosticas: {}, avancePda: [], boletas: bolFinal, bandas, plantillas: {} }).filas[0][col("Promedio final de grado")], 7.2);
	// 4° no acredita: 5, 6, 6 en tres campos y 6, 6, 6 en uno → 5.7, 5.7, 5.7, 6.0 → 5.775 → 5.8
	const bajo = { a2: ciclo([5, 5, 5, 6], [6, 6, 6, 6], [6, 6, 6, 6]) };
	const fb = E.construir({ alumnos: [LUCIA], trimestre: 3, motor, diagnosticas: {}, avancePda: [], boletas: bajo, bandas, plantillas: {} }).filas[0];
	ok("final: 4° con promedio 5.8 no acredita", [fb[col("Promedio final de grado")], fb[col("Acreditación")]], [5.8, "No acredita"]);
	// Truncar daba 5.8 y "No acredita"; redondear da 5.95 → 6.0: el promedio llega (LEN, SAB y
	// ETI 5.7 quedan bajo 6 → "Revisar"). LEN, SAB, ETI 5, 6, 6; DHL 6, 7, 7 = 6.7
	const borde = { a2: ciclo([5, 5, 5, 6], [6, 6, 6, 7], [6, 6, 6, 7]) };
	const fbr = E.construir({ alumnos: [LUCIA], trimestre: 3, motor, diagnosticas: {}, avancePda: [], boletas: borde, bandas, plantillas: {} });
	ok("final: 5.95 → 6.0, el promedio llega (Revisar, ya no «No acredita»)", [fbr.filas[0][col("Promedio final de grado")], fbr.filas[0][col("Acreditación")]], [6, "Revisar"]);
	ok("CSV: 5.95 → «6.0»", parsearCSV(E.aCSV(fbr.encabezados, fbr.filas).slice(1))[1][col("Promedio final de grado")], "6.0");
	const csvFinal = parsearCSV(E.aCSV(tf.encabezados, tf.filas).slice(1));
	ok("CSV: final con punto decimal (7, 8, 8 → 7.7)", csvFinal[1][col("LEN: Final")], "7.7");
	ok("CSV: la final entera sale con un decimal (9.0, no 9)", csvFinal[1][col("ETI: Final")], "9.0");
	ok("CSV: el promedio final con un decimal", csvFinal[1][col("Promedio final de grado")], "7.2");
	// Al escribir con un decimal también redondea, nunca trunca: 6.65 → «6.7», 6.649 → «6.6»
	const csvBorde = parsearCSV(E.aCSV(tf.encabezados, [tf.filas[0].map((v, i) => i === col("LEN: Final") ? 6.65 : (i === col("SAB: Final") ? 6.649 : v))]).slice(1));
	ok("CSV: 6.65 → «6.7» y 6.649 → «6.6»", [csvBorde[1][col("LEN: Final")], csvBorde[1][col("SAB: Final")]], ["6.7", "6.6"]);
	const csv10 = parsearCSV(E.aCSV(tf.encabezados, [tf.filas[0].map((v, i) => (i === col("LEN: Final") || i === col("Promedio final de grado")) ? (i === col("LEN: Final") ? 10 : 6) : v)]).slice(1));
	ok("CSV: 10 → «10.0» y 6 → «6.0»", [csv10[1][col("LEN: Final")], csv10[1][col("Promedio final de grado")]], ["10.0", "6.0"]);
	ok("CSV: «pendiente» sigue igual", parsearCSV(E.aCSV(tf.encabezados, [tf.filas[0].map((v, i) => i === col("SAB: Final") ? "pendiente" : v)]).slice(1))[1][col("SAB: Final")], "pendiente");
	ok("CSV: las demás columnas numéricas no cambian (grado 4, no 4.0)", csvFinal[1][col("Grado")], "4");
	// XLSX: número con formato 0.0 en finales y promedio (sigue siendo número, no texto)
	const hojaF = {};
	const XLSXf = { utils: {
		book_new: () => ({ SheetNames: [], Sheets: {} }),
		aoa_to_sheet: (aoa) => { const ws = { "!ref": "A1" }; aoa.forEach((f, r) => f.forEach((v, c) => { if (v === null || v === undefined) return; let col = "", n = c + 1; while (n > 0) { const m = (n - 1) % 26; col = String.fromCharCode(65 + m) + col; n = Math.floor((n - 1) / 26); } ws[col + (r + 1)] = { v, t: typeof v === "number" ? "n" : "s" }; })); return ws; },
		book_append_sheet: (wb, ws, nombre) => { wb.SheetNames.push(nombre); hojaF[nombre] = ws; },
	} };
	E.libroXLSX(XLSXf, tf, {});
	const celdaDe = (titulo) => Object.entries(hojaF.Concentrado).find(([k, v]) => /^[A-Z]+2$/.test(k) && k.replace(/2$/, "") === letraCol(col(titulo)))[1];
	function letraCol(c) { let s = "", n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
	ok("XLSX: final con formato 0.0 y número", [celdaDe("ETI: Final").t, celdaDe("ETI: Final").v, celdaDe("ETI: Final").z], ["n", 9, "0.0"]);
	ok("XLSX: promedio final con formato 0.0", celdaDe("Promedio final de grado").z, "0.0");
	ok("XLSX: otras columnas sin formato forzado", celdaDe("Grado").z, undefined);
	ok("Léeme: explica final, promedio final y acreditación",
		["<Campo>: Final", "Promedio final de grado", "Acreditación"].every((c) => E.hojaLeeme({}).some((f) => f[0] === c)), true);
	ok("Léeme: dice que la conducta es referencia y no pondera",
		E.hojaLeeme({}).some((f) => /Cond\./.test(f[0]) && /REFERENCIA/.test(f[1]) && /NO pondera/.test(f[1])), true);
	ok("Léeme: la final es un cálculo de apoyo (plataforma de control escolar)", E.hojaLeeme({}).some((f) => f[0] === "<Campo>: Final" && /cálculo de apoyo: el promedio oficial lo calcula la plataforma de control escolar/.test(f[1])), true);
	// Decisiones 17b y 18b y el aviso de R6 sobre DHL
	const leeme = E.hojaLeeme({});
	const fila = (t) => (leeme.find((f) => f[0] === t) || [])[1] || "";
	ok("Léeme: la escala va por grado (1° de 6 a 10; 2° a 6° de 5 a 10)",
		/1°, enteros de 6 a 10/.test(fila("<Campo>: Calificación")) && /de 2° a 6°, enteros de 5 a 10, y 5 no es aprobatoria/.test(fila("<Campo>: Calificación")), true);
	ok("Léeme: ya no dice «1° y 2°: 6 a 10»", leeme.some((f) => /1° y 2°: 6 a 10/.test(f[1] || "")), false);
	ok("Léeme: explica «Revisar»", /«Revisar» si el promedio llega a 6 pero algún campo tiene menos de 6/.test(fila("Acreditación")), true);
	ok("Léeme: «Revisar» nunca es «No acredita»", /«No acredita» si el promedio final de grado es menor que 6/.test(fila("Acreditación")), true);
	ok("Léeme: DHL es lo que la hoja de Fanny llama HUM", /DHL = De lo Humano y lo Comunitario, que en la hoja original se llama «HUM»/.test(fila("Campos formativos")), true);
	ok("Léeme: la final y el promedio se redondean al décimo (ya no «truncado»)",
		[/redondeado al décimo más cercano, con \.5 hacia arriba/.test(fila("<Campo>: Final")), /redondeado/.test(fila("Promedio final de grado")),
			/truncad|sin redondear/.test(fila("<Campo>: Final") + fila("Promedio final de grado"))], [true, true, false]);
}

// Sin emojis en lo que se exporta
ok("sin emojis en el CSV ni en el Léeme",
	/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(csv + textoLeeme), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
