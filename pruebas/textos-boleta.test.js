/*
	Pruebas de la Capa 1 de textos de la boleta (B.7): fortalezas, áreas y sugerencias
	generadas por reglas, sin IA.

	node pruebas/textos-boleta.test.js [ruta-del-modulo]   (por defecto js/textos-boleta.js)
*/

const path = require("path");
const T = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "js", "textos-boleta.js")));

global.window = {};
require("../js/campos-formativos.js");
require("../js/catalogo-habilidades.js");
const catalogo = global.window.CatalogoHabilidades;
const corto = global.window.CamposFormativos.corto;

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
function contiene(nombre, lista, fragmento) {
	ok(nombre, (lista || []).some(function (t) { return t.indexOf(fragmento) !== -1; }), true);
}
function noContiene(nombre, lista, fragmento) {
	ok(nombre, (lista || []).some(function (t) { return t.indexOf(fragmento) !== -1; }), false);
}

function rubro(fraccion, maximo) {
	const max = maximo === undefined ? 5 : maximo;
	return { fraccion: fraccion, maximo: max, obtenido: fraccion * max, peso: 28 };
}
function campo(rubros) {
	return { rubros: Object.assign({ tareas: null, trabajos: null, participacion: null, conducta: null, examen: null }, rubros) };
}

// ── Rubros por campo ─────────────────────────────────────────────────────────
let r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ tareas: rubro(1), trabajos: rubro(0.4) }),
		SAB: campo({ examen: rubro(0.95) }),
	},
});
contiene("tareas al 100% es fortaleza", r.LEN.fortalezas, "Entrega puntualmente sus tareas");
contiene("trabajos al 40% es área", r.LEN.areas, "falta terminar los trabajos");
contiene("y trae su sugerencia", r.LEN.sugerencias, "hayan quedado completos");
contiene("el examen alto cuenta en su campo", r.SAB.fortalezas, "evaluación escrita");
ok("un campo sin datos no inventa frases", r.ETI.fortalezas.length + r.ETI.areas.length, 0);

r = T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.75) }) } });
ok("el desempeño intermedio (60-90) no genera texto", r.LEN.fortalezas.length + r.LEN.areas.length, 0);

// ── Participación y conducta: registro global del día → solo en la fila general ──
r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ participacion: rubro(0.1, 1) }),
		SAB: campo({ participacion: rubro(0.1, 1) }),
	},
});
contiene("participar poco va a la fila general", r.GEN.areas, "Participa poco");
noContiene("y no se repite en cada campo", r.LEN.areas.concat(r.SAB.areas), "Participa poco");

// El 1 del día (valor por defecto en "Hoy") es lo normal: 50 % no es un área
r = T.generar({ corto: corto, porCampo: { LEN: campo({ participacion: rubro(0.5, 2), conducta: rubro(0.5, 2) }) } });
ok("quedarse en el valor normal (1 de 2) no es área", r.GEN.areas.length, 0);
r = T.generar({ corto: corto, porCampo: { LEN: campo({ conducta: rubro(0.95, 2) }) } });
contiene("conducta sobresaliente es fortaleza general", r.GEN.fortalezas, "acuerdos de convivencia");

// ── PDA ──────────────────────────────────────────────────────────────────────
r = T.generar({
	corto: corto,
	avancePda: [
		{ campo_formativo: "Lenguajes", pda: "Lee en voz alta diversos textos: cuentos, poemas, canciones y notas informativas", nivel_predominante: "logrado", evidencias: 3, tendencia: "mejora" },
		{ campo_formativo: "Lenguajes", pda: "Escribe su nombre y apellidos", nivel_predominante: "requiere_apoyo", evidencias: 2, tendencia: "mejora" },
		{ campo_formativo: "Saberes y Pensamiento Científico", pda: "Mide longitudes con unidades no convencionales", nivel_predominante: "requiere_apoyo", evidencias: 1, tendencia: "sin_datos" },
	],
});
contiene("un PDA logrado con evidencia repetida es fortaleza", r.LEN.fortalezas, "Lee en voz alta diversos textos");
ok("y se recorta antes de los dos puntos", r.LEN.fortalezas[0].indexOf("cuentos"), -1);
contiene("un PDA en apoyo se cita, no se conjuga mal", r.LEN.areas, "Necesita apoyo para lograr: «Escribe su nombre y apellidos»");
contiene("si va mejorando, se reconoce en la sugerencia", r.LEN.sugerencias, "Ya muestra avance");
ok("una sola evidencia no alcanza para afirmar nada", r.SAB.areas.length, 0);

// ── Habilidades básicas ──────────────────────────────────────────────────────
const banda4 = { requiere_apoyo_max: 84, cercano_max: 99, estandar_max: 114 };
r = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	diagnostica: {
		lectura_ppm: 60, lectura_comprension: "requiere_apoyo",
		matematicas: [{ clave: "mates.fracciones", nivel: "requiere_apoyo" }, { clave: "mates.division", nivel: "requiere_apoyo" }, { clave: "mates.suma", nivel: "logrado" }],
		cuaderno: [{ clave: "cuaderno.letra_legible", nivel: "requiere_apoyo" }, { clave: "cuaderno.orden_limpieza", nivel: "logrado" }],
	},
});
contiene("PPM bajo el estándar es área de lenguaje", r.LEN.areas, "velocidad de lectura está por debajo");
contiene("con la sugerencia de leer en voz alta", r.LEN.sugerencias, "lectura en voz alta 10 minutos diarios");
contiene("la comprensión baja también", r.LEN.areas, "explicar lo que lee");
// Se listan en el orden del catálogo (división antes que fracciones), no en el de captura
contiene("las matemáticas flojas van a Saberes", r.SAB.areas, "división y fracciones");
contiene("y su práctica sugerida nombra las habilidades", r.SAB.sugerencias, "ejercicios cortos y diarios: división y fracciones");
contiene("lo logrado en matemáticas es fortaleza", r.SAB.fortalezas, "Resuelve con seguridad: suma");
contiene("el cuaderno va a la fila general", r.GEN.areas, "letra legible");
noContiene("el cuaderno no se mete a un campo formativo", r.LEN.areas, "letra legible");

r = T.generar({ corto: corto, catalogo: catalogo, banda: banda4, diagnostica: { lectura_ppm: 110, lectura_comprension: "logrado" } });
contiene("PPM en estándar es fortaleza", r.LEN.fortalezas, "fluidez esperada");
contiene("comprensión lograda es fortaleza", r.LEN.fortalezas, "Comprende lo que lee");

r = T.generar({ corto: corto, catalogo: catalogo, diagnostica: { cuaderno: [{ clave: "cuaderno.letra_legible", nivel: "logrado" }] } });
contiene("cuaderno en orden es fortaleza general", r.GEN.fortalezas, "cuaderno ordenado");

// ── Asistencia: observación general, nunca calificación ──────────────────────
r = T.generar({ corto: corto, asistencia: { presentes: 60, total: 60, porcentaje: 1 } });
contiene("la asistencia alta se reconoce", r.GEN.fortalezas, "Asiste con regularidad");
r = T.generar({ corto: corto, asistencia: { presentes: 40, total: 60, porcentaje: 0.666 } });
contiene("las faltas se señalan como asistencia irregular", r.GEN.areas, "Asistencia irregular");
noContiene("pero no se cuelan a un campo formativo", r.LEN.areas, "faltas");

// ── Catálogo editable de sugerencias ─────────────────────────────────────────
r = T.generar({
	corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.2) }) },
	plantillas: { tareas: "Texto editado por el administrador." },
});
ok("la sugerencia sale del catálogo si llega", r.LEN.sugerencias[0], "Texto editado por el administrador.");
r = T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.2) }) } });
ok("sin catálogo usa la frase por defecto", r.LEN.sugerencias[0], T.SUGERENCIAS_DEFECTO.tareas);

// ── Límite y prioridad: una boleta legible ───────────────────────────────────
const saturado = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	porCampo: { LEN: campo({ tareas: rubro(0.1), trabajos: rubro(0.1), examen: rubro(0.1) }) },
	avancePda: [
		{ campo_formativo: "Lenguajes", pda: "Lee en voz alta", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "baja" },
		{ campo_formativo: "Lenguajes", pda: "Escribe textos breves", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "baja" },
	],
	diagnostica: { lectura_ppm: 20, lectura_comprension: "requiere_apoyo" },
});
ok("nunca más de 4 áreas por sección", saturado.LEN.areas.length, 4);
contiene("se quedan primero las de aprendizaje (PDA)", saturado.LEN.areas, "Lee en voz alta");
contiene("y la lectura", saturado.LEN.areas, "velocidad de lectura");
noContiene("los hábitos ceden su lugar", saturado.LEN.areas, "No entrega todas sus tareas");
noContiene("y su sugerencia se va con ellos", saturado.LEN.sugerencias, "horario fijo");
ok("nunca más de 4 sugerencias", saturado.LEN.sugerencias.length <= 4, true);
ok("sin sugerencias repetidas", new Set(saturado.LEN.sugerencias).size, saturado.LEN.sugerencias.length);

// ── Perfiles ─────────────────────────────────────────────────────────────────
const sobresaliente = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	porCampo: { LEN: campo({ tareas: rubro(1), trabajos: rubro(0.95), examen: rubro(0.9), participacion: rubro(1, 2), conducta: rubro(1, 2) }) },
	diagnostica: { lectura_ppm: 120, lectura_comprension: "logrado", matematicas: [{ clave: "mates.suma", nivel: "logrado" }] },
	asistencia: { presentes: 60, total: 60, porcentaje: 1 },
});
ok("el sobresaliente no tiene áreas inventadas",
	["LEN", "SAB", "ETI", "DHL", "GEN"].reduce(function (n, c) { return n + sobresaliente[c].areas.length; }, 0), 0);
ok("y tiene fortalezas", sobresaliente.LEN.fortalezas.length > 0 && sobresaliente.GEN.fortalezas.length > 0, true);

// ── Trabajo diario ───────────────────────────────────────────────────────────
ok("sin datos no se inventa el trabajo diario", T.generar({ corto: corto }).trabajoDiario, T.TRABAJO_DIARIO.sin_datos);
ok("cumple con todo",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.9), trabajos: rubro(0.8) }) } }).trabajoDiario, T.TRABAJO_DIARIO.ambos_bien);
ok("entrega trabajos pero no tareas",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.3), trabajos: rubro(0.8) }) } }).trabajoDiario, T.TRABAJO_DIARIO.tareas_mal);
ok("falla en ambos",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.2), trabajos: rubro(0.3) }) } }).trabajoDiario, T.TRABAJO_DIARIO.ambos_mal);

// ── Forma del texto: es para los padres ──────────────────────────────────────
const todo = JSON.stringify(saturado) + JSON.stringify(sobresaliente);
ok("nunca etiqueta al alumno", /es un alumno|flojo|lento|TDAH|no puede|problema de aprendizaje|déficit/i.test(todo), false);
ok("no usa emojis", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(todo), false);

const sinDatos = T.generar({ corto: corto });
ok("sin datos, las listas quedan vacías",
	sinDatos.LEN.fortalezas.length + sinDatos.LEN.areas.length + sinDatos.GEN.areas.length, 0);
ok("y el párrafo vacío es cadena vacía", T.comoParrafo(sinDatos.LEN.fortalezas), "");

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
