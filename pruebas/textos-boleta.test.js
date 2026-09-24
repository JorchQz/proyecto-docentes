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

/*
	Tareas y trabajos con su ENTREGA (lo que devuelve el motor): esperados, entregados
	(entregado o incompleto), completos (solo entregado) y calidad promedio de lo entregado.
*/
function conEntrega(esperados, entregados, completos, calidad) {
	const r = rubro(esperados ? (calidad * entregados) / esperados : 0, esperados);
	r.entrega = { esperados: esperados, entregados: entregados, completos: completos, sumaEntregados: calidad * entregados };
	return r;
}

// ── Entrega (hábito) separada de la calidad ──────────────────────────────────
// Entregó todo, pero sus trabajos son de calidad baja: NO "le falta terminar"
let r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ tareas: conEntrega(5, 5, 5, 1), trabajos: conEntrega(5, 5, 5, 0.4) }),
		SAB: campo({ examen: rubro(0.95) }),
	},
});
noContiene("entregar todo no es área de entrega", r.GEN.areas.concat(r.LEN.areas), "falta terminar");
noContiene("ni de tareas", r.GEN.areas.concat(r.LEN.areas), "No entrega");
contiene("la calidad baja se dice como calidad, en su campo", r.LEN.areas, "todavía no alcanzan el nivel esperado.");
contiene("con su sugerencia de calidad", r.LEN.sugerencias, "repasar juntos lo que se le dificulta");
ok("el trabajo diario habla de entrega: cumple", r.trabajoDiario, T.TRABAJO_DIARIO.ambos_bien);
contiene("el examen alto cuenta en su campo", r.SAB.fortalezas, "evaluación escrita");
ok("un campo sin datos no inventa frases", r.ETI.fortalezas.length + r.ETI.areas.length, 0);

// El caso real de Juan: entrega sus trabajos (calidad baja) pero casi no trae la tarea
r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ tareas: conEntrega(3, 1, 0, 0.5), trabajos: conEntrega(3, 3, 3, 0.4) }),
		SAB: campo({ tareas: conEntrega(3, 0, 0, 0), trabajos: conEntrega(3, 2, 2, 0.4) }),
	},
});
ok("trabajo diario de Juan", r.trabajoDiario, T.TRABAJO_DIARIO.tareas_mal);
contiene("no entregar tareas va a la fila general", r.GEN.areas, "No entrega todas sus tareas.");
contiene("con su sugerencia", r.GEN.sugerencias, "horario fijo");
noContiene("y no se repite por campo", r.LEN.areas.concat(r.SAB.areas), "No entrega");
contiene("la misma frase de calidad en 2 campos va una sola vez, nombrándolos", r.GEN.areas,
	"Sus trabajos de «Lenguajes» y «Saberes y Pensamiento Científico» todavía no alcanzan el nivel esperado.");
noContiene("y no se repite en cada campo", r.LEN.areas.concat(r.SAB.areas), "todavía no alcanzan");

// Un solo trabajo entregado no alcanza para afirmar nada (caso de los irregulares en Ética)
r = T.generar({ corto: corto, porCampo: { ETI: campo({ trabajos: conEntrega(1, 1, 1, 0.4) }) } });
ok("una sola evidencia no genera área de calidad ni de entrega", r.ETI.areas.length + r.GEN.areas.length, 0);

// Terminar poco sí es área (incompleto cuenta como entregado, no como terminado)
r = T.generar({ corto: corto, porCampo: { LEN: campo({ trabajos: conEntrega(4, 4, 1, 0.6) }) } });
contiene("entrega incompleta → le falta terminar", r.GEN.areas, "Le falta terminar los trabajos");
ok("trabajo diario sin tareas registradas no afirma nada de tareas", r.trabajoDiario, T.TRABAJO_DIARIO.solo_trabajos_mal);

// Fortalezas repetidas en varios campos → una sola frase general
r = T.generar({
	corto: corto,
	porCampo: {
		LEN: campo({ trabajos: conEntrega(4, 4, 4, 1), examen: rubro(0.95) }),
		SAB: campo({ trabajos: conEntrega(4, 4, 4, 1), examen: rubro(0.95) }),
		ETI: campo({ trabajos: conEntrega(4, 4, 4, 0.95), examen: rubro(0.95) }),
		DHL: campo({ trabajos: conEntrega(4, 4, 4, 0.7), examen: rubro(0.95) }),
	},
});
contiene("calidad alta en 3 campos: una frase con los 3", r.GEN.fortalezas,
	"Sus trabajos muestran un buen nivel de logro en «Lenguajes», «Saberes y Pensamiento Científico» y «Ética, Naturaleza y Sociedades».");
contiene("examen alto en los 4: «de todos los campos formativos»", r.GEN.fortalezas,
	"Muestra buenos resultados en la evaluación escrita de todos los campos formativos.");
ok("ninguna fortaleza repetida por campo", ["LEN", "SAB", "ETI", "DHL"].reduce(function (n, c) { return n + r[c].fortalezas.length; }, 0), 0);
r = T.generar({ corto: corto, porCampo: {
	LEN: campo({ tareas: conEntrega(4, 4, 4, 1), trabajos: conEntrega(4, 4, 4, 0.8) }),
	SAB: campo({ tareas: conEntrega(4, 4, 4, 1), trabajos: conEntrega(4, 4, 4, 0.8) }),
} });
ok("hábitos al 100 %: una sola frase general (no una por rubro ni por campo)",
	r.GEN.fortalezas.filter(function (t) { return /tareas|trabajos en clase/.test(t); }).join(" | "),
	"Entrega con regularidad sus tareas y termina sus trabajos en clase.");
ok("y ninguna en los campos", r.LEN.fortalezas.length + r.SAB.fortalezas.length, 0);
r = T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 5, 5, 1), trabajos: conEntrega(5, 4, 4, 0.8) }) } });
contiene("solo tareas al ≥90 %: su propia fortaleza", r.GEN.fortalezas, "Entrega con regularidad sus tareas.");

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

// ── Participación y conducta con 0, 1 y 2 (decisión de Jorge 9, 2026-09-24) ──
// Con la salida REAL del motor: 1 y 2 valen el día completo en la calificación; el 2 se
// nota en los textos como fortaleza; el 0 resta.
const M = require("../js/motor-calificacion.js");
function diario(valores, campos) {
	const registros = valores.map(function (v, i) { return { fecha: "2026-09-" + (10 + i), participacion: v, conducta: v }; });
	const camposPorFecha = {};
	registros.forEach(function (x) { camposPorFecha[x.fecha] = campos || ["LEN"]; });
	return M.calcularPorcentajes({
		campos: ["LEN", "SAB", "ETI", "DHL"], productos: [], calificaciones: {},
		registros: registros, camposPorFecha: camposPorFecha,
		pesos: { tareas: 28, trabajos: 28, participacion: 6, conducta: 5, examen: 33 },
	});
}
function textosDiario(valores, campos) { return T.generar({ corto: corto, porCampo: diario(valores, campos) }).GEN; }
const FORT_P = "Participa de forma constante", AREA_P = "Participa poco";
const FORT_C = "Respeta los acuerdos", AREA_C = "Le cuesta seguir los acuerdos";

let g = textosDiario([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
ok("todos los días en 1: ni fortaleza ni área", g.fortalezas.length + g.areas.length, 0);
ok("todos en 1: el motor da 100 % de participación", diario([1, 1, 1])["LEN"].rubros.participacion.fraccion, 1);

g = textosDiario([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
contiene("todos en 2: participación es fortaleza", g.fortalezas, FORT_P);
contiene("todos en 2: conducta es fortaleza", g.fortalezas, FORT_C);
ok("todos en 2: el número es el mismo que con 1 (100 %)", diario([2, 2, 2])["LEN"].rubros.participacion.fraccion, 1);

g = textosDiario([2, 2, 2, 2, 2, 2, 2, 2, 1, 1]);
contiene("8 de 10 días en 2 (el resto en 1): fortaleza", g.fortalezas, FORT_P);
g = textosDiario([2, 2, 2, 2, 2, 1, 1, 1, 1, 1]);
noContiene("la mitad de los días en 2: todavía no es fortaleza", g.fortalezas, FORT_P);
noContiene("ni área", g.areas, AREA_P);
g = textosDiario([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]);
contiene("9 días en 2 y uno en 0: sigue siendo fortaleza", g.fortalezas, FORT_P);

g = textosDiario([2]);
ok("un solo día en 2 no basta para afirmar nada", g.fortalezas.length + g.areas.length, 0);
g = textosDiario([0]);
ok("un solo día en 0 tampoco", g.fortalezas.length + g.areas.length, 0);

g = textosDiario([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
contiene("todos en 0: participación es área", g.areas, AREA_P);
contiene("todos en 0: conducta es área", g.areas, AREA_C);
g = textosDiario([0, 0, 0, 0, 0, 0, 1, 1, 2, 2]);
contiene("6 de 10 días en 0: área (aunque haya días en 2)", g.areas, AREA_P);
noContiene("y no es fortaleza", g.fortalezas, FORT_P);
g = textosDiario([0, 0, 0, 0, 0, 1, 1, 1, 2, 2]);
contiene("la mitad de los días en 0: área (bajo 60 %, como los demás rubros)", g.areas, AREA_P);
g = textosDiario([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
noContiene("4 de 10 días en 0 (60 %): no es área", g.areas, AREA_P);
ok("el umbral es el mismo de los demás rubros", T.UMBRAL_DIARIO_NORMAL, T.UMBRAL_AREA);

// Días repartidos entre varios campos: la misma evidencia, sumada una vez
g = textosDiario([2, 2, 2, 2], ["LEN", "SAB", "ETI"]);
contiene("días repartidos en tres campos: fortaleza en la fila general", g.fortalezas, FORT_P);
const porCampo3 = diario([2, 2, 2, 2], ["LEN", "SAB", "ETI"]);
const t3 = T.generar({ corto: corto, porCampo: porCampo3 });
noContiene("y no se repite en los campos", t3.LEN.fortalezas.concat(t3.SAB.fortalezas, t3.ETI.fortalezas), FORT_P);

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
contiene("PPM en la referencia es fortaleza (rotulada SEP 2010)", r.LEN.fortalezas, "alcanza la referencia SEP 2010");
contiene("comprensión lograda es fortaleza", r.LEN.fortalezas, "Comprende lo que lee");

r = T.generar({ corto: corto, catalogo: catalogo, diagnostica: { cuaderno: [{ clave: "cuaderno.letra_legible", nivel: "logrado" }] } });
contiene("cuaderno en orden es fortaleza general", r.GEN.fortalezas, "cuaderno ordenado");

// ── Asistencia: observación general, nunca calificación ──────────────────────
r = T.generar({ corto: corto, asistencia: { presentes: 60, total: 60, porcentaje: 1 } });
contiene("la asistencia alta se reconoce", r.GEN.fortalezas, "Asiste con regularidad");
r = T.generar({ corto: corto, asistencia: { presentes: 40, total: 60, porcentaje: 0.666 } });
contiene("las faltas se señalan como asistencia irregular", r.GEN.areas, "asistencia en el trimestre fue irregular");
noContiene("sin afirmar una causa que no sale de los datos", r.GEN.areas, "se reflejan");
noContiene("pero no se cuelan a un campo formativo", r.LEN.areas, "faltas");

// ── Catálogo editable de sugerencias ─────────────────────────────────────────
r = T.generar({
	corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 1, 1, 1) }) },
	plantillas: { tareas: "Texto editado por el administrador." },
});
ok("la sugerencia sale del catálogo si llega", r.GEN.sugerencias[0], "Texto editado por el administrador.");
r = T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 1, 1, 1) }) } });
ok("sin catálogo usa la frase por defecto", r.GEN.sugerencias[0], T.SUGERENCIAS_DEFECTO.tareas);

// ── Límite y prioridad: una boleta legible ───────────────────────────────────
const saturado = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	porCampo: { LEN: campo({ tareas: conEntrega(5, 1, 1, 0.5), trabajos: conEntrega(5, 5, 5, 0.1), examen: rubro(0.1) }) },
	avancePda: [
		{ campo_formativo: "Lenguajes", pda: "Lee en voz alta", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "baja" },
		{ campo_formativo: "Lenguajes", pda: "Escribe textos breves", nivel_predominante: "requiere_apoyo", evidencias: 3, tendencia: "baja" },
	],
	diagnostica: { lectura_ppm: 20, lectura_comprension: "requiere_apoyo" },
});
ok("nunca más de 4 áreas por sección", saturado.LEN.areas.length, 4);
contiene("se quedan primero las de aprendizaje (PDA)", saturado.LEN.areas, "Lee en voz alta");
contiene("y la lectura", saturado.LEN.areas, "velocidad de lectura");
noContiene("calidad y examen ceden su lugar", saturado.LEN.areas, "evaluación escrita");
noContiene("y su sugerencia se va con ellos", saturado.LEN.sugerencias, "Repasar los contenidos");
contiene("dos PDA con la misma sugerencia: en plural", saturado.LEN.sugerencias, "sobre estos aprendizajes");
noContiene("y no en singular", saturado.LEN.sugerencias, "este aprendizaje.");
ok("nunca más de 4 sugerencias", saturado.LEN.sugerencias.length <= 4, true);
ok("sin sugerencias repetidas", new Set(saturado.LEN.sugerencias).size, saturado.LEN.sugerencias.length);

// ── Perfiles ─────────────────────────────────────────────────────────────────
const sobresaliente = T.generar({
	corto: corto, catalogo: catalogo, banda: banda4,
	porCampo: { LEN: campo({ tareas: conEntrega(5, 5, 5, 1), trabajos: conEntrega(5, 5, 5, 0.95), examen: rubro(0.9), participacion: rubro(1, 2), conducta: rubro(1, 2) }) },
	diagnostica: { lectura_ppm: 120, lectura_comprension: "logrado", matematicas: [{ clave: "mates.suma", nivel: "logrado" }] },
	asistencia: { presentes: 60, total: 60, porcentaje: 1 },
});
ok("el sobresaliente no tiene áreas inventadas",
	["LEN", "SAB", "ETI", "DHL", "GEN"].reduce(function (n, c) { return n + sobresaliente[c].areas.length; }, 0), 0);
ok("y tiene fortalezas", sobresaliente.LEN.fortalezas.length > 0 && sobresaliente.GEN.fortalezas.length > 0, true);

// ── Trabajo diario ───────────────────────────────────────────────────────────
ok("sin datos no se inventa el trabajo diario", T.generar({ corto: corto }).trabajoDiario, T.TRABAJO_DIARIO.sin_datos);
ok("cumple con todo",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 5, 5, 0.9), trabajos: conEntrega(5, 4, 4, 0.8) }) } }).trabajoDiario, T.TRABAJO_DIARIO.ambos_bien);
ok("termina trabajos pero no trae tareas",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 1, 1, 1), trabajos: conEntrega(5, 5, 5, 0.4) }) } }).trabajoDiario, T.TRABAJO_DIARIO.tareas_mal);
ok("falla en ambos",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 1, 1, 1), trabajos: conEntrega(5, 2, 1, 0.7) }) } }).trabajoDiario, T.TRABAJO_DIARIO.ambos_mal);
ok("la calidad no cuenta para el trabajo diario (todo entregado, calidad 10 %)",
	T.generar({ corto: corto, porCampo: { LEN: campo({ tareas: conEntrega(5, 5, 5, 0.1), trabajos: conEntrega(5, 5, 5, 0.1) }) } }).trabajoDiario, T.TRABAJO_DIARIO.ambos_bien);

// ── Lo que escribió el maestro (por cuadro) ──────────────────────────────────
ok("sin editado_manual no hay nada del maestro", T.esEditado({ editado_manual: false, fortalezas: "x" }, "fortalezas"), false);
ok("filas viejas (sin marca por cuadro): editado_manual cuenta para los tres",
	T.esEditado({ editado_manual: true, texto_autogenerado: {} }, "sugerencias"), true);
ok("con marca por cuadro: solo el cuadro editado",
	T.esEditado({ editado_manual: true, texto_autogenerado: { editados: ["fortalezas"] } }, "sugerencias"), false);
ok("con marca por cuadro: el cuadro editado sí",
	T.esEditado({ editado_manual: true, texto_autogenerado: { editados: ["fortalezas"] } }, "fortalezas"), true);

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
