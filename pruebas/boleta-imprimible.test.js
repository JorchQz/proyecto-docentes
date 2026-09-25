/*
	Pruebas de la boleta trimestral imprimible (B.8.1): boleta.html + js/boleta.js.

	Carga las mismas piezas que la página (campos-formativos, catalogo-habilidades,
	textos-boleta, reporte-datos) y corre las funciones de render de js/boleta.js con
	datos de ejemplo del mismo formato que devuelve ReporteDatos.alumnoTrimestre.

	Lo que cuida:
	  - Solo la calificación CONFIRMADA sale como número; lo demás, "pendiente".
	  - Promedios solo de confirmadas, con un decimal; general del trimestre solo con
	    los cuatro campos confirmados.
	  - Pisos por fase: un 6 en 2° (Fase 3) y un 5 en 4° (Fase 4) salen tal cual, con
	    la escala correcta rotulada.
	  - Textos: el del maestro manda; si no hay, la propuesta de la Capa 1.
	  - Cuaderno, habilidades y PPM contra la banda del grado; "no evaluada" si falta.
	  - Asistencia como referencia; aviso de complemento SIGED; firmas; sin emojis.

	node pruebas/boleta-imprimible.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}
function contiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) !== -1, true); }
function noContiene(nombre, texto, fragmento) { ok(nombre, (texto || "").indexOf(fragmento) === -1, true); }

global.window = {};
require("../js/campos-formativos.js");
require("../js/catalogo-habilidades.js");
require("../js/textos-boleta.js");
require("../js/reporte-datos.js");
const B = require("../js/boleta.js");

// Contenido de una celda de la tabla por campo y trimestre (data-campo / data-trim)
function celda(html, campo, trim) {
	const m = html.match(new RegExp("<td class='([^']*)' data-campo='" + campo + "' data-trim='" + trim + "'>([^<]*)</td>"));
	return m ? m[2] : null;
}
function claseCelda(html, campo, trim) {
	const m = html.match(new RegExp("<td class='([^']*)' data-campo='" + campo + "' data-trim='" + trim + "'>"));
	return m ? m[1] : null;
}

function fila(campo, calificacion, confirmada, extra) {
	return Object.assign({
		// Toda fila con evidencias trae su porcentaje (lo guarda Reportes al generar la boleta);
		// una confirmada SIN porcentaje es juicio docente sin evidencias (se prueba abajo)
		campo: campo, calificacion: calificacion, calificacion_confirmada: confirmada, cerrada: false, porcentaje: 80,
		fortalezas: null, areas_oportunidad: null, sugerencias: null, editado_manual: false,
	}, extra || {});
}

const BANDA_2 = { grado: 2, requiere_apoyo_max: 34, cercano_max: 59, estandar_max: 84 };
const BANDA_4 = { grado: 4, requiere_apoyo_max: 84, cercano_max: 99, estandar_max: 114 };

// ── Fase y escala ───────────────────────────────────────────────────────────
ok("fase 1°", B.fase(1), 3);
ok("fase 2°", B.fase(2), 3);
ok("fase 3°", B.fase(3), 4);
ok("fase 4°", B.fase(4), 4);
ok("fase 5°", B.fase(5), 5);
ok("fase 6°", B.fase(6), 5);
ok("fase de un grado inválido", B.fase(9), null);
// La escala va por GRADO, no por fase (decisión 17b): la Fase 3 tiene 1° de 6 a 10 y 2° de 5 a 10
ok("escala 1°", B.escala(1), "Enteros de 6 a 10; 1° se acredita con haberlo cursado");
ok("escala 2° (Fase 3, pero de 5 a 10)", B.escala(2), "Enteros de 5 a 10; 5 no es aprobatoria");
ok("escala 4°", B.escala(4), "Enteros de 5 a 10; 5 no es aprobatoria");
ok("escala 6°", B.escala(6), "Enteros de 5 a 10; 5 no es aprobatoria");
ok("escala de un grado inválido", B.escala(9), "");

// ── Alumno de 2° (Fase 3): T1 confirmado con un 6; T2 con propuestas sin confirmar ─
const CICLO_2 = {
	1: {
		// El maestro escribió solo el cuadro de fortalezas (marca por cuadro); los otros dos siguen como propuesta
		LEN: fila("LEN", 6, true, { fortalezas: "Escribe su nombre completo sin ayuda.", editado_manual: true, texto_autogenerado: { editados: ["fortalezas"] } }),
		SAB: fila("SAB", 8, true),
		ETI: fila("ETI", 7, true),
		DHL: fila("DHL", 9, true),
		// Escrito por el maestro en ese cuadro: se respeta aunque la propuesta de hoy sea otra
		GEN: fila("GEN", null, false, { areas_oportunidad: "Su cuaderno necesita más cuidado en: orden y limpieza.", editado_manual: true, texto_autogenerado: { editados: ["areas_oportunidad"] } }),
	},
	2: {
		// Propuestas del motor guardadas pero NO confirmadas: nunca deben verse como número
		LEN: fila("LEN", 9, false),
		SAB: fila("SAB", 8, true),
		ETI: fila("ETI", 7, false),
		DHL: fila("DHL", 10, false),
	},
	3: {},
};

const tabla2 = B.tablaCalificaciones(CICLO_2, 1);
ok("2°: LEN T1 confirmado sale el 6 (piso Fase 3)", celda(tabla2, "LEN", 1), "6");
ok("2°: SAB T1", celda(tabla2, "SAB", 1), "8");
ok("2°: LEN T2 sin confirmar → pendiente (no el 9 propuesto)", celda(tabla2, "LEN", 2), "pendiente");
ok("2°: DHL T2 sin confirmar → pendiente (no el 10 propuesto)", celda(tabla2, "DHL", 2), "pendiente");
ok("2°: SAB T2 confirmado", celda(tabla2, "SAB", 2), "8");
ok("2°: T3 sin filas → pendiente", celda(tabla2, "ETI", 3), "pendiente");
// Final por campo (decisión de Jorge del 2026-09-24): solo con los TRES trimestres
// confirmados; un promedio de uno o dos trimestres nunca se presenta como final
ok("2°: final LEN con T2 y T3 sin confirmar → pendiente", celda(tabla2, "LEN", "final"), "pendiente");
ok("2°: final SAB con T3 sin confirmar → pendiente", celda(tabla2, "SAB", "final"), "pendiente");
contiene("2°: la columna se llama Final", tabla2, "<th>Final</th>");
noContiene("2°: ya no hay columna Promedio", tabla2, "<th>Promedio</th>");
ok("2°: promedio general T1 (6+8+7+9)/4", celda(tabla2, "GENERAL", 1), "7.5");
ok("2°: promedio general T2 incompleto → pendiente", celda(tabla2, "GENERAL", 2), "pendiente");
ok("2°: promedio final de grado incompleto → pendiente", celda(tabla2, "GENERAL", "final"), "pendiente");
ok("2°: acreditación pendiente mientras falte algo", /data-acreditacion='pendiente'/.test(tabla2), true);
contiene("2°: dice cuántas faltan", tabla2, "faltan 7 de 12 calificaciones confirmadas");
ok("2°: la columna del trimestre elegido se resalta", /actual/.test(claseCelda(tabla2, "LEN", 1)), true);
ok("2°: la de otro trimestre no", /actual/.test(claseCelda(tabla2, "LEN", 2)), false);
ok("2°: las cuatro filas de campo con su color NEM",
	["#059669", "#ea580c", "#7c3aed", "#0284c7"].every(function (c) { return tabla2.indexOf("background:" + c) !== -1; }), true);
contiene("2°: nombre completo del campo", tabla2, "Saberes y Pensamiento Científico");
contiene("2°: explica qué es pendiente", tabla2, "todavía no confirma");

// Ningún número de propuesta se cuela en la tabla: las celdas numéricas son solo las confirmadas
const numeros = [...tabla2.matchAll(/class='(?:actual )?num'[^>]*>([^<]*)</g)].map(function (m) { return m[1]; });
ok("2°: solo hay números de confirmadas y del promedio del trimestre completo", numeros.join(","), "6,8,8,7,9,7.5");

// ── Alumno de 4° (Fase 4): un 5 confirmado sale como 5 ───────────────────────
const CICLO_4 = {
	1: { LEN: fila("LEN", 5, true), SAB: fila("SAB", 6, true), ETI: fila("ETI", 5, true), DHL: fila("DHL", 7, true) },
	2: {},
	3: {},
};
const tabla4 = B.tablaCalificaciones(CICLO_4, 2);
ok("4°: LEN T1 confirmado con 5", celda(tabla4, "LEN", 1), "5");
ok("4°: ETI T1 confirmado con 5", celda(tabla4, "ETI", 1), "5");
ok("4°: promedio general T1 (5+6+5+7)/4 = 5.75 → 5.8 (redondeado, como control escolar; truncado daba 5.7)", celda(tabla4, "GENERAL", 1), "5.8");
// Promedio general del trimestre: 7, 8, 8, 8 = 7.75 → 7.8 y 6, 6, 7, 7 = 6.5 → 6.5
{
	const t = B.tablaCalificaciones({
		1: { LEN: fila("LEN", 7, true), SAB: fila("SAB", 8, true), ETI: fila("ETI", 8, true), DHL: fila("DHL", 8, true) },
		2: { LEN: fila("LEN", 6, true), SAB: fila("SAB", 6, true), ETI: fila("ETI", 7, true), DHL: fila("DHL", 7, true) },
		3: {},
	}, 2);
	ok("promedio general T1 7, 8, 8, 8 → 7.8 y T2 6, 6, 7, 7 → 6.5", [celda(t, "GENERAL", 1), celda(t, "GENERAL", 2)].join(" "), "7.8 6.5");
}
ok("4°: T2 elegido y vacío → pendiente", celda(tabla4, "LEN", 2), "pendiente");
ok("4°: columna T2 resaltada", /actual/.test(claseCelda(tabla4, "LEN", 2)), true);

// Confirmada pero sin número (no debería existir): nunca "null" ni número inventado
const raro = B.tablaCalificaciones({ 1: { LEN: fila("LEN", null, true) }, 2: {}, 3: {} }, 1);
ok("confirmada sin número → pendiente", celda(raro, "LEN", 1), "pendiente");
noContiene("sin 'null' en pantalla", raro, "null");

// Sin ninguna confirmada: todo pendiente
const nada = B.tablaCalificaciones({ 1: {}, 2: {}, 3: {} }, 1);
ok("sin datos: ninguna celda con número", /class='(?:actual )?num'/.test(nada), false);
ok("sin datos: 20 celdas pendiente (4 campos + general) × (3 + final)", (nada.match(/pendiente<\/td>/g) || []).length, 20);

// ── Juicio docente sin evidencias (decisión de Jorge 5) ─────────────────────
function celdaConMarca(html, campo, trim) {
	const m = html.match(new RegExp("data-campo='" + campo + "' data-trim='" + trim + "'>([^<]*)(<sup[^>]*>\\*</sup>)?</td>"));
	return m ? m[1] + (m[2] ? "*" : "") : null;
}
const CICLO_J = {
	// T1 abierta: LEN elegido por juicio (confirmada y sin porcentaje), el resto con evidencias
	1: { LEN: fila("LEN", 7, true, { porcentaje: null }), SAB: fila("SAB", 8, true), ETI: fila("ETI", 8, true), DHL: fila("DHL", 9, true) },
	// T2 cerrada con la foto completa: la foto dice cuál fue sin evidencias (DHL), no la fila
	2: {
		LEN: fila("LEN", 8, true, { cerrada: true, porcentaje: null }), SAB: fila("SAB", 8, true, { cerrada: true }),
		ETI: fila("ETI", 8, true, { cerrada: true }), DHL: fila("DHL", 6, true, { cerrada: true }),
		GEN: fila("GEN", null, false, { texto_autogenerado: { cierre: { campos: {
			LEN: { porcentaje: 80, sin_evidencias: false }, SAB: { porcentaje: 80, sin_evidencias: false },
			ETI: { porcentaje: 80, sin_evidencias: false }, DHL: { porcentaje: null, sin_evidencias: true } } } } }),
	},
	3: {},
};
const tablaJ = B.tablaCalificaciones(CICLO_J, 3);
ok("juicio: T1 LEN confirmado sin porcentaje lleva la marca", celdaConMarca(tablaJ, "LEN", 1), "7*");
ok("juicio: T1 SAB con evidencias no", celdaConMarca(tablaJ, "SAB", 1), "8");
ok("juicio: T2 cerrada, DHL según la foto", celdaConMarca(tablaJ, "DHL", 2), "6*");
ok("juicio: T2 cerrada, LEN según la foto (aunque la fila no traiga porcentaje)", celdaConMarca(tablaJ, "LEN", 2), "8");
contiene("juicio: nota al pie", tablaJ, "juicio docente: no hay evidencias registradas");
noContiene("sin juicio: sin nota al pie", tabla2, "boletaNotaJuicio");
// El trimestre elegido usa lo calculado con el motor de hoy (datos.juicio), no la fila
const tablaJ2 = B.tablaCalificaciones(CICLO_J, 1, { LEN: false, SAB: true, ETI: false, DHL: false });
ok("juicio del trimestre elegido: el del motor (LEN no)", celdaConMarca(tablaJ2, "LEN", 1), "7");
ok("juicio del trimestre elegido: el del motor (SAB sí)", celdaConMarca(tablaJ2, "SAB", 1), "8*");
ok("un pendiente nunca lleva marca",
	celdaConMarca(B.tablaCalificaciones({ 1: { LEN: fila("LEN", 7, false, { porcentaje: null }) }, 2: {}, 3: {} }, 1), "LEN", 1), "pendiente");

// Alumno sin NINGUNA evidencia: los cuatro campos por juicio
const CICLO_NADA = { 1: {}, 2: {}, 3: {} };
["LEN", "SAB", "ETI", "DHL"].forEach(function (c, i) { CICLO_NADA[1][c] = fila(c, 6 + i, true, { porcentaje: null }); });
const tablaNada = B.tablaCalificaciones(CICLO_NADA, 1, { LEN: true, SAB: true, ETI: true, DHL: true });
ok("sin ninguna evidencia: las cuatro con marca",
	["LEN", "SAB", "ETI", "DHL"].map(function (c) { return celdaConMarca(tablaNada, c, 1); }).join(","), "6*,7*,8*,9*");
ok("sin ninguna evidencia: promedio general del trimestre (6+7+8+9)/4", celda(tablaNada, "GENERAL", 1), "7.5");

// Grado del cierre: el encabezado usa fase y escala de la foto aunque el grado de hoy sea otro
const encCierre = B.encabezado({ trimestre: 1, alumno: { nombre_completo: "X", grado: 2, num_lista: 1 }, fase: 4, escala: "5 a 10; 5 no acredita" });
contiene("cierre: fase de la foto", encCierre, "Fase 4");
contiene("cierre: escala de la foto", encCierre, "Enteros de 5 a 10; 5 no acredita");
const encVivo = B.encabezado({ trimestre: 1, alumno: { nombre_completo: "X", grado: 2, num_lista: 1 } });
contiene("abierta: fase del grado", encVivo, "Fase 3");
contiene("abierta: escala del grado (2°: 5 a 10)", encVivo, "Enteros de 5 a 10; 5 no es aprobatoria");
// Boleta de 2° cerrada antes de la decisión 17b: su foto guardó "6 a 10" y así se sigue viendo
const encCierre2 = B.encabezado({ trimestre: 1, alumno: { nombre_completo: "X", grado: 2, num_lista: 1 }, fase: 3, escala: "6 a 10" });
contiene("2° cerrada con la escala vieja: la de su cierre", encCierre2, "Enteros de 6 a 10</dd>");
noContiene("2° cerrada con la escala vieja: no la de hoy", encCierre2, "5 no es aprobatoria");

// ── Asistencia: solo referencia ─────────────────────────────────────────────
const asis = B.bloqueAsistencia({ presentes: 18, total: 20, porcentaje: 0.9 }, 1);
contiene("asistencia: días", asis, "18 de 20 días registrados (90 %)");
contiene("asistencia: rotulada como referencia", asis, "no forma parte de la calificación");
contiene("asistencia sin registros", B.bloqueAsistencia({ presentes: 0, total: 0, porcentaje: null }, 2), "sin registros");
contiene("asistencia nula no truena", B.bloqueAsistencia(null, 2), "sin registros");

// ── Boleta completa de 2°, trimestre 1 ──────────────────────────────────────
const TEXTOS = window.TextosBoleta.generar({
	porCampo: {
		// Entrega de tareas: 0 de 4 en LEN y 4 de 4 en SAB → 50 % en total (área general)
		LEN: { rubros: {
			tareas: { obtenido: 0, maximo: 4, fraccion: 0, entrega: { esperados: 4, entregados: 0, completos: 0, sumaEntregados: 0 } },
			// 3 trabajos entregados de calidad baja (40 %): área de calidad en Lenguajes
			trabajos: { obtenido: 1.2, maximo: 3, fraccion: 0.4, entrega: { esperados: 3, entregados: 3, completos: 3, sumaEntregados: 1.2 } },
		} },
		SAB: { rubros: { tareas: { obtenido: 4, maximo: 4, fraccion: 1, entrega: { esperados: 4, entregados: 4, completos: 4, sumaEntregados: 4 } } } },
	},
	avancePda: [],
	diagnostica: { lectura_ppm: 28, lectura_comprension: "requiere_apoyo", cuaderno: [], matematicas: [] },
	banda: BANDA_2,
	asistencia: { presentes: 18, total: 20, porcentaje: 0.9 },
	catalogo: window.CatalogoHabilidades,
	corto: window.CamposFormativos.corto,
});

const DIAG_2 = {
	lectura_ppm: 28, lectura_comprension: "requiere_apoyo", observaciones: null,
	cuaderno: [
		{ clave: "cuaderno.orden_limpieza", nivel: "requiere_apoyo" },
		{ clave: "cuaderno.fecha_completa", nivel: "logrado" },
		{ clave: "cuaderno.letra_legible", nivel: "en_proceso" },
	],
	matematicas: [
		{ clave: "mates.suma", nivel: "logrado" },
		{ clave: "mates.resta", nivel: "en_proceso" },
	],
};

const DATOS_2 = {
	escuela: "Escuela QA (datos de prueba)", ciclo: "2026-2027", grupoNombre: "QA 1°-2° (Fase 3)",
	maestroNombre: "Maestra QA", fecha: new Date(2026, 8, 23),
	alumno: { id: "al-2", nombre_completo: "QA JUAN <b>MENA</b>", grado: 2, num_lista: 4 },
	trimestre: 1, boletaCiclo: CICLO_2, textos: TEXTOS, diagnostica: DIAG_2, banda: BANDA_2,
	asistencia: { presentes: 18, total: 20, porcentaje: 0.9 },
};
const hoja2 = B.renderBoleta(DATOS_2);

contiene("encabezado: título", hoja2, "Boleta de evaluación trimestral");
contiene("encabezado: complemento SIGED", hoja2, "Complemento de la boleta oficial (SIGED)");
contiene("encabezado: no sustituye a la SEP", hoja2, "No sustituye el documento oficial de la SEP");
contiene("encabezado: escuela", hoja2, "Escuela QA (datos de prueba)");
contiene("encabezado: ciclo", hoja2, "Ciclo escolar 2026-2027");
contiene("encabezado: grupo", hoja2, "QA 1°-2° (Fase 3)");
contiene("encabezado: docente", hoja2, "Maestra QA");
contiene("encabezado: fase", hoja2, "Fase 3");
contiene("encabezado: escala de 2°", hoja2, "Enteros de 5 a 10; 5 no es aprobatoria");
contiene("encabezado: número de lista", hoja2, "<dt>Número de lista</dt><dd>4</dd>");
contiene("encabezado: grado", hoja2, "<dt>Grado</dt><dd>2°</dd>");
contiene("nombre escapado", hoja2, "QA JUAN &lt;b&gt;MENA&lt;/b&gt;");
noContiene("sin HTML inyectado", hoja2, "<b>MENA</b>");

// Observaciones: lo del maestro manda; lo vacío toma la propuesta de la Capa 1
contiene("obs: texto editado por el maestro", hoja2, "Escribe su nombre completo sin ayuda.");
contiene("obs: propuesta de Capa 1 cuando la boleta está vacía (calidad baja en LEN)", hoja2, "Sus trabajos todavía no alcanzan el nivel esperado.");
contiene("obs: sugerencia de la Capa 1", hoja2, "Establecer un horario fijo para hacer la tarea en casa.");
contiene("obs: propuesta de lectura (PPM bajo)", hoja2, "Practicar lectura en voz alta 10 minutos diarios.");
contiene("obs: fila general con lo escrito por el maestro", hoja2, "Su cuaderno necesita más cuidado en: orden y limpieza.");
contiene("obs: hay bloque general", hoja2, "Observaciones generales");
contiene("obs: un cuadro vacío es un guion neutro (no «Sin registro»)", hoja2, "<dd class='vacio' aria-label='Sin texto'>—</dd>");
noContiene("obs: nunca «Sin registro» frente a la familia", hoja2, "Sin registro");
contiene("obs: la propuesta se marca solo en pantalla", hoja2, "<span class='bol-propuesta no-print'>propuesta del sistema</span>");
// El texto que el maestro escribió no se marca como propuesta
const bloqueLen = hoja2.slice(hoja2.indexOf("data-obs='LEN'"), hoja2.indexOf("data-obs='SAB'"));
ok("obs: la fortaleza del maestro no lleva marca de propuesta",
	/<dt>Fortalezas<\/dt><dd>Escribe su nombre/.test(bloqueLen), true);
contiene("trabajo diario: de la Capa 1 si no hay observación", hoja2,
	"<h3>Trabajo diario</h3><p style='font-size:inherit'>" + TEXTOS.trabajoDiario + "</p>");

// Trabajo diario: la observación de evaluacion_diagnostica manda
const conObs = B.renderBoleta(Object.assign({}, DATOS_2, {
	diagnostica: Object.assign({}, DIAG_2, { observaciones: "Trabaja con entusiasmo en equipo." }),
}));
contiene("trabajo diario: la observación del trimestre manda", conObs, "Trabaja con entusiasmo en equipo.");

// Cuaderno y habilidades
contiene("cuaderno: criterio con nivel", hoja2, "data-clave='cuaderno.orden_limpieza'><span class='etiqueta'>Orden y limpieza</span><span class='valor'><span class='bol-sem' data-nivel='requiere_apoyo'>");
contiene("cuaderno: semáforo con texto", hoja2, "Requiere apoyo</span>");
ok("cuaderno: los 10 criterios", (hoja2.match(/data-clave='cuaderno\./g) || []).length, 10);
ok("cuaderno: los no capturados dicen No evaluado", (hoja2.match(/No evaluado</g) || []).length, 7);
// 2°: las 7 de su grado (sin fracciones, que empiezan en 3°), con su alcance
ok("matemáticas de 2°: las 7 de su grado", (hoja2.match(/data-clave='mates\./g) || []).length, 7);
ok("matemáticas de 2°: sin fracciones", hoja2.includes("data-clave='mates.fracciones'"), false);
ok("matemáticas: las no capturadas dicen No evaluada", (hoja2.match(/No evaluada</g) || []).length, 5);
contiene("matemáticas: alcance del grado como detalle", hoja2, "<span class='detalle' data-alcance>Alcance en 2°: Reparto y agrupamiento con divisores menores que 10, sin algoritmo convencional</span>");
contiene("lectura: PPM", hoja2, "28 palabras por minuto");
contiene("lectura: fluidez contra la banda de 2° (28 ≤ 34)", hoja2, "data-fluidez='requiere_apoyo'");
contiene("lectura: rotulada con ETIQUETA_FLUIDEZ", hoja2, window.CatalogoHabilidades.ETIQUETA_FLUIDEZ.requiere_apoyo);
contiene("lectura: referencia de la banda, rotulada SEP 2010", hoja2, "Referencia SEP 2010 para 2°: 60 a 84 ppm");
noContiene("lectura: ya no dice estándar", hoja2, "Estándar para");

// La fluidez sale de clasificarPPM con la banda del grado (4°: 90 PPM → cercano)
const hab4 = B.cajaHabilidades({ lectura_ppm: 90, lectura_comprension: "logrado", matematicas: [] }, BANDA_4, 4);
contiene("fluidez 4°: 90 PPM es cercano", hab4, "data-fluidez='cercano'");
contiene("fluidez 4°: etiqueta", hab4, "Cercano a la referencia");
contiene("fluidez 4°: banda", hab4, "Referencia SEP 2010 para 4°: 100 a 114 ppm");
const hab4b = B.cajaHabilidades({ lectura_ppm: 120, lectura_comprension: null, matematicas: [] }, BANDA_4, 4);
contiene("fluidez 4°: 120 PPM es avanzado", hab4b, "Avanzado");

// Sin diagnóstico del trimestre
const sinDiag = B.cajaHabilidades(null, BANDA_2, 2);
ok("sin diagnóstico: PPM, fluidez, comprensión y las 7 de mates de 2° no evaluadas", (sinDiag.match(/No evaluada</g) || []).length, 10);
// 1°: solo suma, resta, lectura y escritura de cantidades y problemas; lo capturado en una
// habilidad que no aplica (dato viejo) no aparece
const hab1 = B.cajaHabilidades({ matematicas: [{ clave: "mates.fracciones", nivel: "requiere_apoyo" }, { clave: "mates.suma", nivel: "logrado" }] }, BANDA_2, 1);
ok("1°: 4 habilidades", (hab1.match(/data-clave='mates\./g) || []).length, 4);
ok("1°: sin multiplicación, división, fracciones ni tablas",
	["multiplicacion", "division", "fracciones", "tablas"].some((k) => hab1.includes("data-clave='mates." + k + "'")), false);
ok("1°: el dato viejo de fracciones no se pinta", hab1.includes("Requiere apoyo"), false);
ok("4°: las 8", (B.cajaHabilidades(null, BANDA_4, 4).match(/data-clave='mates\./g) || []).length, 8);
contiene("4°: alcance de fracciones", B.cajaHabilidades(null, BANDA_4, 4), "Alcance en 4°: Tercios a décimos; suma y resta");
ok("sin diagnóstico: cuaderno completo no evaluado", (B.cajaCuaderno(null).match(/No evaluado</g) || []).length, 10);
contiene("PPM sin banda de su grado", B.cajaHabilidades({ lectura_ppm: 50 }, null, 2), "Sin banda de referencia");

// Firmas
contiene("firmas: docente", hoja2, "<p class='rol'>Docente</p>");
contiene("firmas: nombre del docente", hoja2, "<p class='nombre'>Maestra QA</p>");
contiene("firmas: madre, padre o tutor", hoja2, "Madre, padre o tutor");
contiene("fecha de emisión", hoja2, "Fecha de emisión: 23 de septiembre de 2026");

// ── Boleta de 4° en un trimestre sin datos (T2) ─────────────────────────────
const hoja4 = B.renderBoleta({
	escuela: "", ciclo: "2026-2027", grupoNombre: "QA 3°-4° (Fase 4)", maestroNombre: "",
	alumno: { id: "al-4", nombre_completo: "QA EMILIO NAVA", grado: 4, num_lista: 3 },
	trimestre: 2, boletaCiclo: CICLO_4, textos: window.TextosBoleta.generar({}), diagnostica: null, banda: BANDA_4,
	asistencia: { presentes: 0, total: 0, porcentaje: null },
});
contiene("4°: escala con 5 no aprobatoria", hoja4, "Enteros de 5 a 10; 5 no es aprobatoria");
contiene("4°: Fase 4", hoja4, "Fase 4");
contiene("4°: el 5 confirmado de T1 aparece", hoja4, "data-campo='LEN' data-trim='1'>5</td>");
contiene("4°: trimestre elegido en el título", hoja4, "Trimestre 2");
contiene("4°: trabajo diario sin datos", hoja4, window.TextosBoleta.TRABAJO_DIARIO.sin_datos);
contiene("4°: sin escuela no truena", hoja4, "<p class='bol-escuela'>Escuela</p>");
noContiene("4°: sin 'undefined'", hoja4, "undefined");
noContiene("4°: sin 'null'", hoja4, ">null<");
noContiene("2°: sin 'undefined'", hoja2, "undefined");

// ── Impresión: la hoja trae sus bloques indivisibles y la página las reglas ──
ok("bloques marcados para no partirse", (hoja2.match(/bol-bloque/g) || []).length >= 10, true);
const html = fs.readFileSync(path.join(__dirname, "..", "boleta.html"), "utf8");
contiene("página: tamaño carta vertical", html, "@page { size: letter portrait");
contiene("página: oculta la barra al imprimir", html, "#app-navbar, .no-print { display: none !important; }");
contiene("página: no parte los bloques", html, ".bol-bloque { break-inside: avoid;");
// La barra (js/navbar.js) va en el <head> desde el rediseño de la navegación (2026-09-25): aparta
// su espacio desde el primer pintado. El resto sigue el orden del brief.
ok("página: la barra se carga en el <head>", html.split("</head>")[0].indexOf("src=\"js/navbar.js\"") !== -1, true);
const orden = ["supabase.js", "saas-guard.js", "grupo-activo.js", "campos-formativos.js",
	"catalogo-habilidades.js", "motor-calificacion.js", "textos-boleta.js", "reporte-datos.js", "js/boleta.js"];
const posiciones = orden.map(function (s) { return html.indexOf(s + "\"></script>"); });
ok("página: scripts en el orden del brief",
	posiciones.every(function (p, i) { return p !== -1 && (i === 0 || p > posiciones[i - 1]); }), true);

// La página solo lee: el JS no escribe en la BD
const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "boleta.js"), "utf8");
ok("js/boleta.js no escribe en la BD", /\.(insert|upsert|update|delete)\(/.test(fuente), false);

// Sin emojis (misma regla que pruebas/sin-emojis.test.js)
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;
ok("sin emojis en el render", SIMBOLOS.test(hoja2 + hoja4 + conObs), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
