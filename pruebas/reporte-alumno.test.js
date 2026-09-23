/*
	Pruebas del reporte trimestral detallado por alumno (B.8.2).

	Carga los módulos compartidos reales (motor, textos Capa 1, catálogo de
	habilidades, capa de datos de reportes) y las funciones de render de
	js/reporte-alumno.js, y dibuja el reporte con datos de ejemplo armados como los
	devuelve ReporteDatos.alumnoTrimestre. Los porcentajes salen del núcleo real del
	motor (calcularPorcentajes); la calificación propuesta se fija a mano porque en
	la app la pone la función SQL.

	node pruebas/reporte-alumno.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}
function cuenta(texto, patron) { return (texto.match(patron) || []).length; }

global.window = {};
const JS = path.join(__dirname, "..", "js");
["campos-formativos.js", "catalogo-habilidades.js", "motor-calificacion.js", "textos-boleta.js", "reporte-datos.js", "reporte-alumno.js"]
	.forEach((f) => require(path.join(JS, f)));
const RA = window.ReporteAlumno;
const MOTOR = window.MotorCalificacion;
const CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
const PESOS = { tareas: 28, trabajos: 28, participacion: 6, conducta: 5, examen: 33 };
const BANDA_2 = { grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 };
const BANDA_4 = { grado: 4, requiere_apoyo_max: 84, cercano_max: 99, estandar_max: 114 };
const INFO = { escuela: "Escuela de prueba", ciclo: "2026-2027", grupo: "Grupo 1°-2°", docente: "Maestra de prueba", hoy: "2026-09-23" };

// ── Datos de ejemplo: alumno de 2° en riesgo, trimestre 1 ────────────────────
function motorRiesgo() {
	const porCampo = MOTOR.calcularPorcentajes({
		campos: CAMPOS,
		productos: [
			{ id: "l1", tipo: "trabajo", campo: "LEN" }, { id: "l2", tipo: "trabajo", campo: "LEN" },
			{ id: "l3", tipo: "trabajo", campo: "LEN" }, { id: "l4", tipo: "trabajo", campo: "LEN" },
			{ id: "s1", tipo: "tarea", campo: "SAB" }, { id: "s2", tipo: "tarea", campo: "SAB" }, { id: "s3", tipo: "tarea", campo: "SAB" },
			{ id: "s4", tipo: "trabajo", campo: "SAB" }, { id: "s5", tipo: "trabajo", campo: "SAB" },
			{ id: "e1", tipo: "trabajo", campo: "ETI" }, { id: "e2", tipo: "trabajo", campo: "ETI" },
		],
		calificaciones: {
			l1: { estado_entrega: "entregado", nivel: "requiere_apoyo" }, l2: { estado_entrega: "entregado", nivel: "requiere_apoyo" },
			l3: { estado_entrega: "entregado", nivel: "en_proceso" }, l4: { estado_entrega: "no_entregado" },
			s1: { estado_entrega: "no_entregado" }, s2: { estado_entrega: "incompleto" }, s3: { estado_entrega: "no_entregado" },
			s4: { estado_entrega: "entregado", nivel: "logrado" }, s5: { estado_entrega: "entregado", nivel: "requiere_apoyo" },
			e1: { estado_entrega: "entregado", nivel: "requiere_apoyo" }, e2: { estado_entrega: "justificado" },
		},
		registros: [
			{ fecha: "2026-09-01", participacion: 1, conducta: 1 },
			{ fecha: "2026-09-02", participacion: 0, conducta: 1 },
			{ fecha: "2026-09-03", participacion: 0, conducta: 1 },
		],
		camposPorFecha: { "2026-09-01": ["LEN", "SAB"], "2026-09-02": ["LEN", "ETI", "DHL"], "2026-09-03": ["SAB", "DHL"] },
		examenPorCampo: { LEN: 0, SAB: 0, ETI: 1 },
		pesos: PESOS,
	});
	const propuesta = { LEN: 6, SAB: 6, ETI: 7, DHL: 6 };
	CAMPOS.forEach((c) => {
		const pct = porCampo[c].porcentaje;
		porCampo[c].calificacionPropuesta = pct === null ? null : propuesta[c];
		if (pct !== null) porCampo[c].nivel = pct >= 80 ? "logrado" : (pct >= 60 ? "en_proceso" : "requiere_apoyo");
	});
	return {
		porCampo, pesos: PESOS, asistencia: { presentes: 8, total: 12, porcentaje: 8 / 12 },
		usaLegacy: false, examenAproximado: true, sinProyectos: false,
	};
}

const DIAG_RIESGO = {
	cuaderno: [
		{ clave: "cuaderno.orden_limpieza", nivel: "requiere_apoyo" }, { clave: "cuaderno.fecha_completa", nivel: "requiere_apoyo" },
		{ clave: "cuaderno.titulo_actividad", nivel: "en_proceso" }, { clave: "cuaderno.letra_legible", nivel: "requiere_apoyo" },
		{ clave: "cuaderno.mayusculas_minusculas", nivel: "requiere_apoyo" }, { clave: "cuaderno.signos_puntuacion", nivel: "en_proceso" },
		{ clave: "cuaderno.acentuacion", nivel: "requiere_apoyo" }, { clave: "cuaderno.buen_estado", nivel: "requiere_apoyo" },
		{ clave: "cuaderno.orden_proyecto", nivel: "en_proceso" }, { clave: "cuaderno.respeta_margen", nivel: "requiere_apoyo" },
	],
	lectura_ppm: 28,
	lectura_comprension: "requiere_apoyo",
	matematicas: [
		{ clave: "mates.suma", nivel: "en_proceso" }, { clave: "mates.resta", nivel: "requiere_apoyo" },
		{ clave: "mates.lectura_escritura_cantidades", nivel: "en_proceso" }, { clave: "mates.problemas", nivel: "requiere_apoyo" },
	],
	observaciones: null,
};

// Filas como las de v_avance_pda (verificadas contra la vista real)
const PDA_RIESGO = [
	{ clave_pda: "p-len-1", grado: 2, campo_formativo: "Lenguajes", pda: "Escribe su nombre y apellidos para indicar autoría",
		contenido: "Escritura de nombres", evidencias: 2, nivel_predominante: "requiere_apoyo", logrados: 0, en_proceso: 0, requiere_apoyo: 2,
		ajustadas_por_el_maestro: 1, tendencia: "estable" },
	{ clave_pda: "p-len-2", grado: 2, campo_formativo: "Lenguajes", pda: "Lee en voz alta diversos textos",
		contenido: "Lectura compartida", evidencias: 3, nivel_predominante: "logrado", logrados: 2, en_proceso: 1, requiere_apoyo: 0,
		ajustadas_por_el_maestro: 0, tendencia: "mejora" },
	{ clave_pda: "p-sab-1", grado: 2, campo_formativo: "Saberes y Pensamiento Científico", pda: "Reconoce los órganos de los sentidos",
		contenido: "Cuerpo humano", evidencias: 2, nivel_predominante: "en_proceso", logrados: 0, en_proceso: 1, requiere_apoyo: 1,
		ajustadas_por_el_maestro: 0, tendencia: "baja" },
	{ clave_pda: "p-eti-1", grado: 2, campo_formativo: "Ética, Naturaleza y Sociedades", pda: "Comprende que es parte de un contexto social",
		contenido: "Contextos", evidencias: 1, nivel_predominante: "requiere_apoyo", logrados: 0, en_proceso: 0, requiere_apoyo: 1,
		ajustadas_por_el_maestro: 0, tendencia: "sin_datos" },
];

const RETRO = [
	{ texto: "Le faltó terminar; hay que practicar en casa.", fecha: "2026-09-21", producto: "Cartel del cuento", campo: "LEN" },
	{ texto: "   ", fecha: "2026-09-20", producto: "Vacía", campo: "SAB" },
	{ texto: "Buen esfuerzo en la maqueta.", fecha: "2026-09-16", producto: "Maqueta", campo: "SAB" },
	{ texto: "Revisar ortografía.", fecha: "2026-09-12", producto: "Carta", campo: "LEN" },
	{ texto: "Participó con entusiasmo.", fecha: "2026-09-10", producto: "Mapa", campo: "ETI" },
	{ texto: "Trajo su material completo.", fecha: "2026-09-08", producto: "Collage", campo: "DHL" },
	{ texto: "Sexta retroalimentación: no debe verse.", fecha: "2026-09-02", producto: "Otro", campo: "DHL" },
];

function textos(motor, diag, pda, banda) {
	return window.TextosBoleta.generar({
		porCampo: motor.porCampo, avancePda: pda, diagnostica: diag, banda: banda,
		asistencia: motor.asistencia, catalogo: window.CatalogoHabilidades, corto: window.CamposFormativos.corto,
	});
}

function datosRiesgo(extra) {
	const motor = motorRiesgo();
	const base = {
		alumno: { id: "al-juan", nombre_completo: "ALUMNO EN RIESGO", num_lista: 4, grado: 2 },
		trimestre: 1, motor: motor, diagnostica: DIAG_RIESGO, banda: BANDA_2,
		fluidez: window.CatalogoHabilidades.clasificarPPM(DIAG_RIESGO.lectura_ppm, BANDA_2),
		avancePda: PDA_RIESGO, textos: textos(motor, DIAG_RIESGO, PDA_RIESGO, BANDA_2),
		// Fila que dejó la boleta vieja: número propuesto persistido, SIN confirmar
		boletaCiclo: { 1: { LEN: { campo: "LEN", calificacion: 9, calificacion_confirmada: false, cerrada: false, editado_manual: false } }, 2: {}, 3: {} },
		retroalimentaciones: RETRO,
	};
	return Object.assign(base, extra || {});
}

function atributos(html, campo) {
	const m = html.match(new RegExp("data-campo='" + campo + "' data-pct='([^']*)' data-cal='([^']*)' data-cal-tipo='([^']*)'"));
	return m ? { pct: m[1], cal: m[2], tipo: m[3] } : null;
}

// ── 1. Reporte completo: alumno de 2° en riesgo ──────────────────────────────
const d1 = datosRiesgo();
const h1 = RA.render(d1, INFO);

ok("encabezado: alumno, grado, fase, grupo, ciclo, trimestre y docente",
	["ALUMNO EN RIESGO", "2°", "Fase 3", "Grupo 1°-2°", "2026-2027", "Trimestre 1", "Maestra de prueba"].every((t) => h1.includes(t)), true);
ok("encabezado: reporte interno, complemento de la boleta oficial", h1.includes("Complementa la boleta oficial (SIGED)"), true);
ok("encabezado: escala de la fase 3", h1.includes("enteros de 6 a 10"), true);

CAMPOS.forEach((c) => {
	const a = atributos(h1, c);
	const pct = d1.motor.porCampo[c].porcentaje;
	ok("desempeño " + c + ": el % es el del motor con un decimal (truncado)", a && a.pct, pct === null ? "" : (Math.floor(pct * 10 + 1e-9) / 10).toFixed(1));
});
ok("desempeño: sin confirmar se muestra la propuesta del motor, no la fila vieja (LEN 6, no 9)",
	JSON.stringify(atributos(h1, "LEN")), JSON.stringify({ pct: atributos(h1, "LEN").pct, cal: "6", tipo: "propuesta" }));
ok("desempeño: la propuesta va rotulada", cuenta(h1, /Propuesta, sin confirmar/g) >= 4, true);
ok("desempeño: nunca dice confirmada si no lo está", h1.includes("Confirmada por el docente"), false);

// Rubros de LEN: tareas sin datos, su peso se reparte
const tarjetaLen = h1.slice(h1.indexOf("data-campo='LEN'"), h1.indexOf("data-campo='SAB'"));
ok("rubros: los cinco rubros por campo", cuenta(tarjetaLen, /data-rubro='/g), 5);
ok("rubros: tareas sin datos", /data-rubro='tareas'[\s\S]*?sin datos/.test(tarjetaLen), true);
ok("rubros: explica que su peso se reparte", tarjetaLen.includes("Sin datos en tareas (28 %)") && tarjetaLen.includes("se reparte entre los demás rubros"), true);
ok("rubros: peso aplicado de trabajos = 28/72 (truncado)", tarjetaLen.includes("aplica 38.8 %"), true);
ok("rubros: obtenido y máximo de trabajos (0.4+0.4+0.7+0 de 4)", /data-rubro='trabajos'[\s\S]*?>1\.5<[\s\S]*?>4<[\s\S]*?37\.5 %/.test(tarjetaLen), true);
ok("rubros: el examen rotulado aproximado", /data-rubro='examen'[\s\S]*?aproximado/.test(tarjetaLen), true);
ok("rubros: nota del examen aproximado", h1.includes("Examen aproximado:") && h1.includes("valor total del examen entre número de preguntas"), true);
ok("rubros: nota del reparto diario de participación y conducta", h1.includes("se registran una vez al día") && h1.includes("se reparten en partes iguales"), true);
ok("rubros: pesos del maestro visibles", h1.includes("Tareas 28 % · Trabajos 28 % · Participación 6 % · Conducta 5 % · Examen 33 %"), true);
// En SAB lo justificado no cuenta: 3 tareas en el máximo; en ETI el trabajo justificado sale del máximo
const tarjetaEti = h1.slice(h1.indexOf("data-campo='ETI'"), h1.indexOf("data-campo='DHL'"));
ok("rubros: lo justificado no entra al máximo (ETI trabajos 0.4 de 1)", /data-rubro='trabajos'[\s\S]*?>0\.4<[\s\S]*?>1</.test(tarjetaEti), true);
// DHL: solo registro diario, sin productos ni examen
const tarjetaDhl = h1.slice(h1.indexOf("data-campo='DHL'"), h1.indexOf("data-seccion='cuaderno'"));
ok("rubros: DHL sin productos muestra tres rubros sin datos", cuenta(tarjetaDhl, /sin datos<\/td>/g), 3);

ok("asistencia: dato de referencia, no pondera", h1.includes("8 de 12 días") && h1.includes("Dato de referencia: la asistencia no forma parte de la calificación"), true);

// Cuaderno y habilidades
ok("cuaderno: los 10 criterios", cuenta(h1, /data-criterio='/g), 10);
ok("cuaderno: conteo por nivel", h1.includes("0 logrado · 3 en proceso · 7 requiere apoyo"), true);
ok("matemáticas: las 8 habilidades", cuenta(h1, /data-habilidad='/g), 8);
ok("matemáticas: las que faltan dicen no evaluada", cuenta(h1.slice(h1.indexOf("Matemáticas</h3>")), /No evaluada/g), 4);
ok("PPM: valor y clasificación contra la banda de su grado", /data-ppm='28' data-fluidez='requiere_apoyo'/.test(h1), true);
ok("PPM: muestra los rangos de la banda", ["0 a 34", "35 a 59", "60 a 84", "85 o más"].every((t) => h1.includes(t)), true);
ok("PPM: resalta el tramo donde cae", /font-bold text-gray-900' data-tramo='requiere_apoyo'/.test(h1), true);
ok("semáforo con color y texto", /data-nivel='requiere_apoyo'>[\s\S]*?background:#ef4444[\s\S]*?Requiere apoyo/.test(h1), true);

// Avance por PDA
ok("PDA: un bloque por campo", cuenta(h1, /data-pda-campo='/g), 4);
ok("PDA: cada PDA con su renglón", cuenta(h1, /data-pda='/g), 4);
ok("PDA: lo que requiere apoyo va primero en su campo", h1.indexOf("Escribe su nombre") < h1.indexOf("Lee en voz alta"), true);
ok("PDA: tendencias mejora / estable / baja / falta evidencia",
	["data-tendencia='mejora'", "data-tendencia='estable'", "data-tendencia='baja'", "data-tendencia='sin_datos'"].every((t) => h1.includes(t)), true);
ok("PDA: conteo por nivel", h1.includes("2 logrado") && h1.includes("1 en proceso"), true);
ok("PDA: señala ajustes del docente", h1.includes("1 ajustada(s) por el docente"), true);
ok("PDA: campo sin evidencias lo dice", h1.includes("Sin evidencias por PDA en este campo."), true);

// Observaciones
ok("observaciones: trabajo diario propuesto", /data-obs='trabajo'[\s\S]*?data-origen='propuesta'/.test(h1), true);
ok("observaciones: por campo y generales", cuenta(h1, /data-obs='(LEN|SAB|ETI|DHL|GEN)'/g), 5);
ok("observaciones: fortalezas, áreas y sugerencias en cada bloque", cuenta(h1, /Áreas de oportunidad<span|Áreas de oportunidad<\/p>/g), 5);
ok("observaciones: la propuesta dice que es propuesta", h1.includes("Propuesta del sistema"), true);
ok("observaciones: sugerencia de lectura por PPM bajo", h1.includes("Practicar lectura en voz alta 10 minutos diarios."), true);

// Retroalimentaciones
ok("retro: máximo 5 y sin vacías", cuenta(h1, /data-retro>/g), 5);
ok("retro: la sexta no aparece", h1.includes("Sexta retroalimentación"), false);
ok("retro: con producto, campo y fecha", h1.includes("Cartel del cuento") && h1.includes("21 sep 2026"), true);

// ── 2. Calificación confirmada y textos del docente ──────────────────────────
const d2 = datosRiesgo({
	boletaCiclo: {
		1: {
			LEN: { campo: "LEN", calificacion: 8, calificacion_confirmada: true, cerrada: true, editado_manual: false },
			SAB: { campo: "SAB", calificacion: 6, calificacion_confirmada: false, fortalezas: "Texto que escribió la maestra.", editado_manual: true },
		},
		2: {}, 3: {},
	},
	diagnostica: Object.assign({}, DIAG_RIESGO, { observaciones: "Trabaja mejor en equipo." }),
});
const h2 = RA.render(d2, INFO);
ok("confirmada: manda la del docente", JSON.stringify(atributos(h2, "LEN")), JSON.stringify({ pct: atributos(h2, "LEN").pct, cal: "8", tipo: "confirmada" }));
ok("confirmada: rotulada y con boleta cerrada", h2.includes("Confirmada por el docente · boleta cerrada"), true);
ok("confirmada: los demás campos siguen como propuesta", atributos(h2, "SAB").tipo, "propuesta");
ok("texto del docente: se muestra y se marca como suyo",
	/data-obs='SAB'[\s\S]*?Fortalezas<span[^>]*data-origen='docente'>Del docente<\/span><\/p><p[^>]*>Texto que escribió la maestra\./.test(h2), true);
ok("trabajo diario del docente", /data-obs='trabajo'[\s\S]*?data-origen='docente'[\s\S]*?Trabaja mejor en equipo\./.test(h2), true);

// ── 3. Trimestre sin datos: estado vacío ─────────────────────────────────────
const vacioMotor = { porCampo: {}, pesos: PESOS, asistencia: { presentes: 0, total: 0, porcentaje: null }, usaLegacy: false, examenAproximado: false, sinProyectos: true };
CAMPOS.forEach((c) => {
	vacioMotor.porCampo[c] = { rubros: {}, porcentaje: null, calificacionPropuesta: null };
	MOTOR.RUBROS.forEach((r) => { vacioMotor.porCampo[c].rubros[r] = { obtenido: 0, maximo: 0, fraccion: null, peso: PESOS[r] }; });
});
const d3 = {
	alumno: { id: "al-juan", nombre_completo: "ALUMNO EN RIESGO", num_lista: 4, grado: 2 }, trimestre: 2, motor: vacioMotor,
	diagnostica: null, banda: BANDA_2, fluidez: null, avancePda: [], textos: textos(vacioMotor, null, [], BANDA_2),
	boletaCiclo: { 1: {}, 2: {}, 3: {} }, retroalimentaciones: [],
};
const h3 = RA.render(d3, INFO);
ok("vacío: hayDatos es falso", RA.hayDatos(d3), false);
ok("vacío: estado vacío claro", h3.includes("data-estado='vacio'") && h3.includes("Todavía no hay datos del trimestre 2"), true);
ok("vacío: no inventa calificaciones", h3.includes("data-campo="), false);

// Con diagnóstica pero sin proyectos: se muestra, con aviso
const d3b = Object.assign({}, d3, { diagnostica: DIAG_RIESGO, fluidez: "requiere_apoyo" });
const h3b = RA.render(d3b, INFO);
ok("sin proyectos pero con diagnóstica: se muestra con aviso", h3b.includes("No hay proyectos de este trimestre") && h3b.includes("data-criterio="), true);
ok("sin proyectos: campos sin datos", atributos(h3b, "LEN").tipo, "sin_datos");

// Sin diagnóstica: lo dice en cuaderno y habilidades
const h4 = RA.render(datosRiesgo({ diagnostica: null, fluidez: null }), INFO);
ok("sin diagnóstica: cuaderno lo dice", h4.includes("Sin revisión de cuaderno registrada en este trimestre."), true);
ok("sin diagnóstica: habilidades lo dice", h4.includes("Sin evaluación de habilidades registrada en este trimestre."), true);

// ── 4. Alumno de 4° (fase 4) ─────────────────────────────────────────────────
const diag4 = Object.assign({}, DIAG_RIESGO, { lectura_ppm: 78 });
const d5 = datosRiesgo({
	alumno: { id: "al-4", nombre_completo: "ALUMNO DE CUARTO", num_lista: 1, grado: 4 }, banda: BANDA_4, diagnostica: diag4,
	fluidez: window.CatalogoHabilidades.clasificarPPM(78, BANDA_4),
});
const h5 = RA.render(d5, Object.assign({}, INFO, { grupo: "Grupo 3°-4°" }));
ok("4°: fase 4 y escala 5 a 10", h5.includes("Fase 4") && h5.includes("enteros de 5 a 10 (5 no es aprobatoria)"), true);
ok("4°: la banda es la de su grado", h5.includes("0 a 84") && h5.includes("115 o más") && /data-ppm='78' data-fluidez='requiere_apoyo'/.test(h5), true);
ok("sin banda: lo dice sin tronar", RA.render(datosRiesgo({ banda: null }), INFO).includes("No hay banda de referencia de PPM"), true);

// ── 5. Reglas de presentación ────────────────────────────────────────────────
const alterado = JSON.parse(JSON.stringify(motorRiesgo().porCampo.LEN));
alterado.porcentaje += 3;
ok("peso aplicado: si no cuadra con el motor, no se muestra", RA.pesosAplicados(alterado), null);
ok("formato: % con un decimal, truncado (49.86 no se lee 49.9 ni 50)", RA.fmtPct(49.86), "49.8 %");
ok("formato: cantidades sin ruido de flotantes", RA.fmtCantidad(1.2000000000000002), "1.2");
ok("formato: fecha corta", RA.fmtFecha("2026-09-08"), "8 sep 2026");
const xss = RA.render(datosRiesgo({ alumno: { id: "x", nombre_completo: "<img src=x onerror=alert(1)>", grado: 2 } }), INFO);
ok("escapa el nombre del alumno", xss.includes("<img src=x"), false);
const todo = [h1, h2, h3, h3b, h4, h5].join("\n");
ok("sin 'undefined' ni 'NaN' en el render", /undefined|NaN/.test(todo), false);
ok("sin emojis en el render",
	/[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u.test(todo.replace(/[→←]/g, "")), false);

// ── 5b. Boleta cerrada: el porcentaje del cierre, no el de hoy ───────────────
{
	const filas = {};
	CAMPOS.forEach((c) => {
		filas[c] = { campo: c, calificacion: 7, porcentaje: 12.34, nivel: "logrado", calificacion_confirmada: true, cerrada: true, editado_manual: false };
	});
	filas.GEN = { campo: "GEN", cerrada: false, fortalezas: "GENERAL DEL CIERRE",
		texto_autogenerado: { cierre: { trabajo_diario: "TRABAJO DIARIO DEL CIERRE" } } };
	const dc = datosRiesgo({ boletaCiclo: { 1: filas, 2: {}, 3: {} }, diagnostica: Object.assign({}, DIAG_RIESGO, { observaciones: "ESCRITO DESPUÉS" }) });
	const hc = RA.render(dc, INFO);
	const len = atributos(hc, "LEN");
	ok("cerrada: el porcentaje del campo es el guardado al cerrar", len && len.pct, "12.3");
	ok("cerrada: la calificación confirmada", len && len.cal, "7");
	ok("cerrada: el resumen muestra el porcentaje del cierre", hc.includes("12.3 % del campo") || hc.includes("12.3 % del campo"), true);
	const tileLen = (hc.split("12.3 % del campo")[1] || "").slice(0, 200);
	ok("cerrada: el semáforo del campo es el del cierre (logrado), no el de hoy", /data-nivel=.logrado/.test(tileLen), true);
	ok("cerrada: avisa que hubo capturas después del cierre", hc.includes("hubo capturas después del cierre"), true);
	ok("cerrada: trabajo diario de la foto del cierre", hc.includes("TRABAJO DIARIO DEL CIERRE") && !hc.includes("ESCRITO DESPUÉS"), true);
	ok("cerrada: texto general guardado", hc.includes("GENERAL DEL CIERRE"), true);
	ok("cerrada: los textos guardados se marcan «Como se entregó», no «Propuesta del sistema»",
		hc.includes("data-origen='cierre'") && !hc.includes("data-origen='propuesta'"), true);
	const abierta = RA.render(datosRiesgo(), INFO);
	ok("abierta: sin aviso de cierre", abierta.includes("hubo capturas después del cierre"), false);
}

// ── 6. Estructura de la página ───────────────────────────────────────────────
const fuente = fs.readFileSync(path.join(JS, "reporte-alumno.js"), "utf8");
ok("un solo DOMContentLoaded", cuenta(fuente, /addEventListener\("DOMContentLoaded"/g), 1);
const posEstado = fuente.indexOf("var ctx = null;");
const posArranque = fuente.indexOf("ctx = await window.ReporteDatos.contexto(window.sb);");
ok("el estado se declara antes del arranque, que va al final", posEstado !== -1 && posArranque > posEstado && posArranque > fuente.indexOf("async function mostrar("), true);
ok("solo lectura: no escribe en la base", /\.(insert|update|upsert|delete)\(/.test(fuente) || /\.rpc\(/.test(fuente), false);
ok("usa la capa de datos compartida", fuente.includes("window.ReporteDatos.alumnoTrimestre(window.sb, ctx"), true);

const html = fs.readFileSync(path.join(__dirname, "..", "reporte-alumno.html"), "utf8");
const orden = ["js/supabase.js", "js/saas-guard.js", "js/navbar.js", "js/grupo-activo.js", "js/campos-formativos.js",
	"js/catalogo-habilidades.js", "js/motor-calificacion.js", "js/textos-boleta.js", "js/reporte-datos.js", "js/reporte-alumno.js"];
const posiciones = orden.map((s) => html.indexOf('src="' + s + '"'));
ok("scripts en el orden de la capa compartida", posiciones.every((p, i) => p !== -1 && (i === 0 || p > posiciones[i - 1])), true);
ok("impresión: carta, sin barra ni controles", /@page \{ size: letter/.test(html) && /#app-navbar, \.no-print \{ display: none/.test(html), true);
ok("botón Imprimir de 44 px", /id="raImprimir"[\s\S]*?min-h-\[44px\]/.test(html), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
