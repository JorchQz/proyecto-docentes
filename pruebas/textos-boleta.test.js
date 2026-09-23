/*
	Pruebas de la Capa 1 de textos de la boleta (B.7): fortalezas, áreas y sugerencias
	generadas por reglas, sin IA.

	node pruebas/textos-boleta.test.js
*/

const T = require("../js/textos-boleta.js");

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
	return { fraccion: fraccion, maximo: maximo === undefined ? 5 : maximo, obtenido: fraccion * 5, peso: 28 };
}
function campo(rubros) {
	return { rubros: Object.assign({ tareas: null, trabajos: null, participacion: null, conducta: null, examen: null }, rubros) };
}

// ── Rubros ───────────────────────────────────────────────────────────────────
let r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ tareas: rubro(1), trabajos: rubro(0.4) }),
		SAB: campo({ examen: rubro(0.95) }),
	},
});
contiene("tareas al 100% es fortaleza", r.LEN.fortalezas, "Entrega sus tareas con puntualidad");
contiene("trabajos al 40% es área", r.LEN.areas, "falta terminar los trabajos");
contiene("y trae su sugerencia", r.LEN.sugerencias, "hayan quedado completos");
contiene("el examen alto cuenta en su campo", r.SAB.fortalezas, "evaluación escrita");
ok("un rubro sin datos no inventa frases", r.ETI.fortalezas.length + r.ETI.areas.length, 0);

// Entre 60 y 90 no dice nada: ni fortaleza ni área
r = T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.75) }) } });
ok("el desempeño intermedio no genera texto", r.LEN.fortalezas.length + r.LEN.areas.length, 0);

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
ok("y se recorta antes de los dos puntos",
	r.LEN.fortalezas[0].indexOf("cuentos"), -1);
contiene("un PDA en apoyo se cita, no se conjuga mal", r.LEN.areas, "Necesita apoyo para lograr: «Escribe su nombre y apellidos»");
contiene("si va mejorando, se reconoce", r.LEN.sugerencias, "Ya muestra avance");
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
contiene("con su sugerencia de 10 minutos", r.LEN.sugerencias, "10 minutos diarios");
contiene("la comprensión baja también", r.LEN.areas, "explicar lo que lee");
// Se listan en el orden del catálogo (división antes que fracciones), no en el de captura
contiene("las matemáticas flojas van a Saberes", r.SAB.areas, "división y fracciones");
contiene("y su práctica sugerida", r.SAB.sugerencias, "ejercicios cortos y diarios");
contiene("el cuaderno va a la fila general", r.GEN.areas, "letra legible");
noContiene("el cuaderno no se mete a un campo formativo", r.LEN.areas, "letra legible");

// PPM dentro del estándar es fortaleza
r = T.generar({ corto: corto, catalogo: catalogo, banda: banda4, diagnostica: { lectura_ppm: 110 } });
contiene("PPM en estándar es fortaleza", r.LEN.fortalezas, "fluidez esperada");

// Cuaderno completo sin problemas: fortaleza general
r = T.generar({
	corto: corto, catalogo: catalogo,
	diagnostica: { cuaderno: [{ clave: "cuaderno.letra_legible", nivel: "logrado" }] },
});
contiene("cuaderno en orden es fortaleza general", r.GEN.fortalezas, "cuaderno ordenado");

// ── Asistencia: observación general, nunca calificación ──────────────────────
r = T.generar({ corto: corto, asistencia: { presentes: 60, total: 60, porcentaje: 1 } });
contiene("la asistencia alta se reconoce", r.GEN.fortalezas, "Asiste con regularidad");
r = T.generar({ corto: corto, asistencia: { presentes: 40, total: 60, porcentaje: 0.666 } });
contiene("las faltas se señalan", r.GEN.areas, "faltas se reflejan");
noContiene("pero no se cuelan a un campo formativo", r.LEN.areas, "faltas");

// ── Trabajo diario ───────────────────────────────────────────────────────────
ok("sin datos no se inventa el trabajo diario",
	T.generar({ corto: corto }).trabajoDiario, T.TRABAJO_DIARIO.sin_datos);
ok("cumple con todo",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.9), trabajos: rubro(0.8) }) } }).trabajoDiario,
	T.TRABAJO_DIARIO.ambos_bien);
ok("falla en tareas",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.3), trabajos: rubro(0.8) }) } }).trabajoDiario,
	T.TRABAJO_DIARIO.tareas_mal);
ok("falla en ambos",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: rubro(0.2), trabajos: rubro(0.3) }) } }).trabajoDiario,
	T.TRABAJO_DIARIO.ambos_mal);

// ── Forma del texto: es para los padres ──────────────────────────────────────
const completo = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	porCampo: { LEN: campo({ tareas: rubro(0.2), trabajos: rubro(0.3), participacion: rubro(0.1), conducta: rubro(0.2), examen: rubro(0.1) }) },
	avancePda: [{ campo_formativo: "Lenguajes", pda: "Lee en voz alta", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "baja" }],
	diagnostica: { lectura_ppm: 20, lectura_comprension: "requiere_apoyo" },
	asistencia: { presentes: 10, total: 60, porcentaje: 0.166 },
});
const todo = JSON.stringify(completo);
ok("nunca etiqueta al alumno", /es un alumno|es flojo|no puede|problema de aprendizaje|déficit/i.test(todo), false);
ok("no usa emojis", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(todo), false);
ok("las listas no se desbordan",
	completo.LEN.areas.length <= 4 && completo.LEN.sugerencias.length <= 4, true);
ok("cada área problemática trae al menos una sugerencia",
	completo.LEN.sugerencias.length > 0 && completo.GEN.sugerencias.length > 0, true);

// Un alumno sin nada capturado no produce texto vacío con puntos sueltos
const sinDatos = T.generar({ corto: corto });
ok("sin datos, las listas quedan vacías",
	sinDatos.LEN.fortalezas.length + sinDatos.LEN.areas.length + sinDatos.GEN.areas.length, 0);
ok("y el párrafo vacío es cadena vacía", T.comoParrafo(sinDatos.LEN.fortalezas), "");

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
