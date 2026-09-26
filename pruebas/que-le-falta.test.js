/*
	"Qué le falta" a cada alumno (js/que-le-falta.js), con el motor y la capa de datos reales:
	  - productos de sesiones ya trabajadas sin entregar, incompletos y (aparte, de la maestra)
	    sin revisar; ni sesiones futuras, ni tareas que aún no vencen, ni justificados;
	  - PDA en proceso o requiere apoyo (v_avance_pda) y PDA trabajados sin evidencia, con su
	    texto y su criterio; solo los del grado del alumno y desde su alta;
	  - campo sin evidencias (juicio docente);
	  - calificación debajo del mínimo por campo de su grado: "Revisar" en 2° a 6° (escala 5 a
	    10) y nunca en 1° (escala 6 a 10, se acredita con haber cursado); confirmada o propuesta;
	  - boleta cerrada: "trimestre cerrado" y nada más;
	  - el tono (sin "puntos" ni "sacar 10") y el HTML (escapado, impresión, sin emojis);
	  - el motor con ctx.detalle hace EXACTAMENTE las mismas peticiones que sin él.

	node pruebas/que-le-falta.test.js
*/
global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
window.MotorCalificacion = require("../js/motor-calificacion.js");
window.ReglasEntidad = require("../js/reglas-entidad.js");
window.TextosBoleta = {};
require("../js/reporte-datos.js");
const Q = require("../js/que-le-falta.js");
window.QueLeFalta = Q;
const RD = window.ReporteDatos;
const M = window.MotorCalificacion;
const NACIONAL = window.ReglasEntidad.regla();

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

const HOY = "2026-09-25";
// Sesiones: 4 (LEN, dada), 5 (SAB, dada ayer con tarea que vence hoy), 6 (LEN, sin fecha), 7 (ETI, futura)
const SESIONES = [
	{ id: "s4", numero_sesion: 4, fecha: "2026-09-15", campo_formativo: "Lenguajes", sesiones_pda: [
		{ id: "sp1", pda_id: "pdaLee", grado: 2, criterio_aplicado: "Lee en voz alta un párrafo", catalogo_pda: { pda: "Lee textos narrativos y comenta su contenido." } },
		{ id: "sp2", pda_id: "pdaEscribe", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "Escribe textos sencillos sobre su comunidad." } },
		{ id: "sp3", pda_id: "pdaOtroGrado", grado: 1, criterio_aplicado: null, catalogo_pda: { pda: "PDA de 1°" } },
		{ id: "sp4", pda_id: "pdaLogrado", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "Conversa en pequeños grupos." } },
	] },
	{ id: "s5", numero_sesion: 5, fecha: "2026-09-24", campo_formativo: "Saberes y Pensamiento Científico", sesiones_pda: [
		{ id: "sp5", pda_id: null, grado: 2, criterio_aplicado: "Cuenta colecciones de hasta 20 objetos", catalogo_pda: null },
	] },
	{ id: "s6", numero_sesion: 6, fecha: null, campo_formativo: "Lenguajes", sesiones_pda: [
		{ id: "sp6", pda_id: "pdaFuturo", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA sin trabajar todavía" } },
	] },
	{ id: "s7", numero_sesion: 7, fecha: "2026-09-30", campo_formativo: "Ética, Naturaleza y Sociedades", sesiones_pda: [
		{ id: "sp7", pda_id: "pdaEti", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA de la sesión futura" } },
	] },
];
const PRODUCTOS = [
	{ id: "cartel", sesion_id: "s4", tipo: "trabajo", campo: "LEN", nombre: "Cartel de mi comunidad", orden: 1 },
	{ id: "cuento", sesion_id: "s4", tipo: "trabajo", campo: "LEN", nombre: "Cuento ilustrado", orden: 2 },
	{ id: "lista", sesion_id: "s4", tipo: "trabajo", campo: "LEN", nombre: "Lista de palabras", orden: 3 },
	{ id: "tareaLen", sesion_id: "s4", tipo: "tarea", campo: "LEN", nombre: "Leer en casa", fecha_entrega: null, orden: 4 },
	{ id: "justif", sesion_id: "s4", tipo: "trabajo", campo: "LEN", nombre: "Mural", orden: 5 },
	{ id: "tareaSab", sesion_id: "s5", tipo: "tarea", campo: "SAB", nombre: "Contar en casa", fecha_entrega: "2026-09-28", orden: 1 },
	{ id: "trabSab", sesion_id: "s5", tipo: "trabajo", campo: "SAB", nombre: "Colección de semillas", orden: 2 },
	{ id: "sinFecha", sesion_id: "s6", tipo: "trabajo", campo: "LEN", nombre: "Producto de sesión sin fecha", orden: 1 },
	{ id: "futuro", sesion_id: "s7", tipo: "trabajo", campo: "ETI", nombre: "Producto futuro", orden: 1 },
	{ id: "examenProd", sesion_id: "s4", tipo: "examen", campo: "LEN", nombre: "Examen como producto", orden: 9 },
];
const CALIFS = {
	cartel: { estado_entrega: "no_entregado" },
	cuento: { estado_entrega: "incompleto", nivel: null },
	lista: { estado_entrega: "entregado", nivel: "logrado" },
	justif: { estado_entrega: "justificado" },
	// tareaLen: sin captura y ya venció (sesión del 15) → por revisar (docente)
	// tareaSab: vence el 28 → todavía no
	trabSab: { estado_entrega: "entregado", nivel: null, puntaje: null }, // entregado sin calificar → por revisar
};
const AVANCE = [
	{ alumno_id: "a2", clave_pda: "pdaLee", pda: "Lee textos narrativos y comenta su contenido.", campo_formativo: "Lenguajes", evidencias: 3, nivel_predominante: "en_proceso" },
	{ alumno_id: "a2", clave_pda: "pdaLogrado", pda: "Conversa en pequeños grupos.", campo_formativo: "Lenguajes", evidencias: 2, nivel_predominante: "logrado" },
	{ alumno_id: "a2", clave_pda: "Cuenta colecciones de hasta 20 objetos", pda: "Cuenta colecciones de hasta 20 objetos", campo_formativo: "Saberes y Pensamiento Científico", evidencias: 1, nivel_predominante: "requiere_apoyo" },
	// Evidencia de un PDA de DHL en proceso cuya sesión no está entre las trabajadas
	{ alumno_id: "a2", clave_pda: "pdaDhl", pda: "Reconoce sus emociones.", campo_formativo: "De lo Humano y lo Comunitario", evidencias: 1, nivel_predominante: "en_proceso" },
	// De otro alumno: no cuenta
	{ alumno_id: "otro", clave_pda: "pdaEscribe", pda: "Escribe", campo_formativo: "Lenguajes", evidencias: 2, nivel_predominante: "requiere_apoyo" },
];
function entrada(extra) {
	return Object.assign({
		alumno: { id: "a2", grado: 2 }, cerrada: false,
		porCampo: { LEN: { porcentaje: 55 }, SAB: { porcentaje: 70 }, ETI: { porcentaje: null }, DHL: { porcentaje: 90 } },
		detalle: { sesiones: SESIONES, productos: PRODUCTOS, calificaciones: CALIFS, alta: null },
		avancePda: AVANCE,
		calificacion: { LEN: { valor: 5, origen: "propuesta" }, SAB: { valor: 7, origen: "propuesta" }, ETI: null, DHL: { valor: 9, origen: "confirmada" } },
		asistencia: { presentes: 18, total: 20 }, hoy: HOY, regla: NACIONAL,
	}, extra || {});
}

(async () => {
	// ── Productos ─────────────────────────────────────────────────────────────
	const r = Q.calcular(entrada());
	const len = r.campos.LEN, sab = r.campos.SAB;
	ok("LEN: sin entregar e incompleto, en orden de sesión", len.productos.map((p) => p.nombre + ":" + p.estado), ["Cartel de mi comunidad:no_entregado", "Cuento ilustrado:incompleto"]);
	ok("LEN: la sesión de cada producto", len.productos.map((p) => p.sesion), [4, 4]);
	ok("LEN: la tarea vencida sin captura es de la maestra (por revisar), no del alumno", len.porRevisar.map((p) => p.nombre), ["Leer en casa"]);
	ok("LEN: ni lo justificado, ni lo calificado, ni la sesión sin fecha, ni el examen como producto",
		len.productos.concat(len.porRevisar).some((p) => ["Mural", "Lista de palabras", "Producto de sesión sin fecha", "Examen como producto"].includes(p.nombre)), false);
	ok("SAB: la tarea que vence el 28 todavía no; el trabajo entregado sin calificar, por revisar", [sab.productos.length, sab.porRevisar.map((p) => p.nombre)], [0, ["Colección de semillas"]]);
	ok("ETI: el producto de una sesión futura no cuenta", r.campos.ETI.productos.length + r.campos.ETI.porRevisar.length, 0);

	// ── PDA ───────────────────────────────────────────────────────────────────
	ok("LEN: PDA en proceso primero y luego el trabajado sin evidencia",
		len.pda.map((d) => d.texto + ":" + d.nivel), ["Lee textos narrativos y comenta su contenido.:en_proceso", "Escribe textos sencillos sobre su comunidad.:null"]);
	ok("LEN: el criterio de la sesión va con su PDA", len.pda[0].criterio, "Lee en voz alta un párrafo");
	ok("LEN: el PDA sin evidencia dice en qué sesión se trabajó", len.pda[1].sesiones, [4]);
	ok("LEN: ni el logrado, ni el de otro grado, ni el de la sesión sin fecha",
		len.pda.some((d) => /Conversa|PDA de 1°|sin trabajar/.test(d.texto)), false);
	ok("SAB: PDA sin catálogo (criterio como llave, igual que v_avance_pda) en requiere apoyo",
		sab.pda.map((d) => d.texto + ":" + d.nivel), ["Cuenta colecciones de hasta 20 objetos:requiere_apoyo"]);
	ok("DHL: evidencia en proceso de una sesión que no está entre las trabajadas también cuenta",
		r.campos.DHL.pda.map((d) => d.texto + ":" + d.nivel), ["Reconoce sus emociones.:en_proceso"]);
	ok("ETI: el PDA de la sesión futura no cuenta", r.campos.ETI.pda.length, 0);
	ok("la evidencia de otro alumno no se mezcla (pdaEscribe sigue sin evidencia)", len.pda[1].nivel, null);

	// ── Campo sin evidencias y Revisar ────────────────────────────────────────
	ok("ETI sin porcentaje: sin evidencias (juicio docente)", [r.campos.ETI.sinEvidencias, r.campos.LEN.sinEvidencias], [true, false]);
	ok("2°, propuesta 5 en LEN: Revisar con la escala de 2° (5 a 10)", r.campos.LEN.revisar,
		{ valor: 5, origen: "propuesta", minimo: 6, grado: 2, escala: "5 a 10; 5 no es aprobatoria" });
	ok("2°, 7 y 9: sin Revisar", [r.campos.SAB.revisar, r.campos.DHL.revisar], [null, null]);
	const primero = Q.calcular(entrada({ alumno: { id: "a2", grado: 1 }, calificacion: { LEN: { valor: 6, origen: "propuesta" } } }));
	ok("1°: nunca Revisar (escala 6 a 10, se acredita con haber cursado)", primero.campos.LEN.revisar, null);
	const cuarto = Q.calcular(entrada({ alumno: { id: "a2", grado: 4 }, calificacion: { SAB: { valor: 5, origen: "confirmada" }, LEN: { valor: 6, origen: "confirmada" } } }));
	ok("4°, confirmada 5: Revisar confirmada; un 6 no", [cuarto.campos.SAB.revisar && cuarto.campos.SAB.revisar.origen, cuarto.campos.LEN.revisar], ["confirmada", null]);

	// ── Conteos y faltas ──────────────────────────────────────────────────────
	ok("LEN: 2 entregas + 2 PDA + Revisar = 5 pendientes", len.pendientes, 5);
	ok("ETI: solo el campo sin evidencias", r.campos.ETI.pendientes, 1);
	ok("por revisar de la maestra aparte (2), no suma al alumno", [r.porRevisar, r.total], [2, 5 + 1 + 1 + 1]);
	ok("faltas sin justificar del trimestre", r.faltas, { sinJustificar: 2, dias: 20 });
	ok("sin faltas: no se dice nada", Q.calcular(entrada({ asistencia: { presentes: 20, total: 20 } })).faltas, null);

	// ── Alta tarde: los PDA de sesiones antes del alta no cuentan ─────────────
	const tarde = Q.calcular(entrada({ detalle: { sesiones: SESIONES, productos: [], calificaciones: {}, alta: "2026-09-20" }, avancePda: [] }));
	ok("alta el 20: el PDA de la sesión del 15 no cuenta; el de la del 24 sí", [tarde.campos.LEN.pda.length, tarde.campos.SAB.pda.length], [0, 1]);

	// ── PDA sin evidencia con productos ligados (R18) ─────────────────────────
	// Un PDA no es pendiente del alumno si todos sus productos ligados (producto_sesion_pda) para
	// ese alumno están justificados, en "no aplica" o sin revisar; lo sin revisar queda solo
	// como "Docente · Por revisar". Con el código de a354dec todos estos salían "Mostrar evidencia".
	const SES_LIG = [
		{ id: "t1", numero_sesion: 3, fecha: "2026-09-10", campo_formativo: "Ética, Naturaleza y Sociedades", sesiones_pda: [
			{ id: "q1", pda_id: "pdaJust", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA con producto justificado" }, producto_sesion_pda: [{ producto_sesion_id: "pJust" }] },
			{ id: "q2", pda_id: "pdaSinRev", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA con producto sin revisar" }, producto_sesion_pda: [{ producto_sesion_id: "pSinRev" }] },
			{ id: "q3", pda_id: "pdaMixto", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA no aplica y sin revisar" }, producto_sesion_pda: [{ producto_sesion_id: "pNoAplica" }, { producto_sesion_id: "pSinRev2" }] },
			{ id: "q4", pda_id: "pdaFalta", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA con uno sin entregar" }, producto_sesion_pda: [{ producto_sesion_id: "pJust2" }, { producto_sesion_id: "pNoEnt" }] },
			{ id: "q5", pda_id: "pdaRevisado", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA revisado sin evidencia" }, producto_sesion_pda: [{ producto_sesion_id: "pRev" }] },
			{ id: "q6", pda_id: "pdaOtroGradoProd", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA ligado solo a producto de otro grado" }, producto_sesion_pda: [{ producto_sesion_id: "pDeOtroGrado" }] },
			{ id: "q7", pda_id: "pdaSinLiga", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA sin productos ligados" }, producto_sesion_pda: [] },
		] },
		// El mismo PDA justificado trabajado otra vez, con su producto también justificado
		{ id: "t2", numero_sesion: 7, fecha: "2026-09-17", campo_formativo: "Ética, Naturaleza y Sociedades", sesiones_pda: [
			{ id: "q8", pda_id: "pdaJust", grado: 2, criterio_aplicado: null, catalogo_pda: { pda: "PDA con producto justificado" }, producto_sesion_pda: [{ producto_sesion_id: "pJust3" }] },
		] },
	];
	const PROD_LIG = ["pJust", "pSinRev", "pNoAplica", "pSinRev2", "pJust2", "pNoEnt", "pRev", "pJust3"].map((id, i) => ({
		id, sesion_id: id === "pJust3" ? "t2" : "t1", tipo: "trabajo", campo: "ETI", nombre: "Producto " + id, orden: i + 1 }));
	const CAL_LIG = {
		pJust: { estado_entrega: "justificado" }, pJust2: { estado_entrega: "justificado" }, pJust3: { estado_entrega: "justificado" },
		pNoAplica: { estado_entrega: "no_aplica" }, pNoEnt: { estado_entrega: "no_entregado" },
		pRev: { estado_entrega: "entregado", nivel: "logrado" }, pSinRev2: { estado_entrega: "entregado", nivel: null, puntaje: null },
	};
	const lig = Q.calcular(entrada({ detalle: { sesiones: SES_LIG, productos: PROD_LIG, calificaciones: CAL_LIG, alta: null }, avancePda: [],
		porCampo: { ETI: { porcentaje: 70 } } }));
	const etiPda = lig.campos.ETI.pda.map((d) => d.texto);
	ok("PDA ligado a productos justificados (en dos sesiones): no es pendiente del alumno", etiPda.includes("PDA con producto justificado"), false);
	ok("PDA ligado a un producto sin revisar: no es pendiente del alumno", etiPda.includes("PDA con producto sin revisar"), false);
	ok("PDA ligado a no aplica + sin revisar: no es pendiente del alumno", etiPda.includes("PDA no aplica y sin revisar"), false);
	ok("el producto sin revisar queda solo como pendiente de la maestra", lig.campos.ETI.porRevisar.map((p) => p.id).sort(), ["pSinRev", "pSinRev2"]);
	ok("sigue pendiente: con un producto sin entregar, ya revisado sin evidencia, ligado solo a otro grado o sin productos ligados",
		etiPda.slice().sort(), ["PDA con uno sin entregar", "PDA ligado solo a producto de otro grado", "PDA revisado sin evidencia", "PDA sin productos ligados"]);
	ok("ETI: pendientes = 1 sin entregar + 4 PDA", lig.campos.ETI.pendientes, 5);
	const frLig = Q.frases(lig.campos.ETI);
	ok("ninguna frase «Mostrar evidencia» del PDA sin revisar; sí «Docente · Por revisar»",
		[frLig.some((f) => /PDA con producto sin revisar/.test(f.texto)), frLig.filter((f) => f.tipo === "por_revisar").length], [false, 2]);
	// Caso R18 (QA1 S3 sin calificar): todos los alumnos con el producto sin revisar → ninguno con el PDA pendiente
	const r18 = ["a1", "a2", "a3", "a4"].map((id) => Q.calcular(entrada({ alumno: { id, grado: 2 }, avancePda: [],
		detalle: { sesiones: [SES_LIG[0]], productos: PROD_LIG.filter((p) => p.id === "pSinRev"), calificaciones: {}, alta: null } })));
	ok("R18: el producto sin calificar no genera «Mostrar evidencia del PDA» en ningún alumno",
		r18.map((x) => x.campos.ETI.pda.some((d) => d.texto === "PDA con producto sin revisar")), [false, false, false, false]);
	ok("R18: y sí sale como por revisar de la maestra en todos", r18.map((x) => x.campos.ETI.porRevisar.length), [1, 1, 1, 1]);

	// ── Trimestre sin trabajo todavía (R18, T2) ───────────────────────────────
	const vacioT2 = Q.calcular(entrada({ detalle: { sesiones: [], productos: [], calificaciones: {}, alta: null }, avancePda: [],
		porCampo: { LEN: { porcentaje: null }, SAB: { porcentaje: null }, ETI: { porcentaje: null }, DHL: { porcentaje: null } },
		calificacion: {}, asistencia: { presentes: 0, total: 0 } }));
	ok("T2 sin sesiones ni productos: sinTrabajo, sin «sin evidencias» y 0 pendientes",
		[vacioT2.sinTrabajo, ["LEN", "SAB", "ETI", "DHL"].some((c) => vacioT2.campos[c].sinEvidencias), vacioT2.total], [true, false, 0]);
	ok("T2 sin trabajo: el detalle dice «Todavía no hay trabajo registrado en este trimestre»",
		/data-qlf-sin-trabajo/.test(Q.htmlAlumno(vacioT2)) && /Todavía no hay trabajo registrado en este trimestre/.test(Q.htmlAlumno(vacioT2)) && !/Para avanzar en |sin evidencias|data-qlf-campo/.test(Q.htmlAlumno(vacioT2)), true);
	const soloFuturas = Q.calcular(entrada({ detalle: { sesiones: [SESIONES[3]], productos: [PRODUCTOS[8]], calificaciones: {}, alta: null }, avancePda: [],
		porCampo: {}, calificacion: {}, asistencia: null }));
	ok("solo sesiones futuras: también sin trabajo", [soloFuturas.sinTrabajo, soloFuturas.total], [true, 0]);
	ok("con trabajo (T1): no es sinTrabajo", r.sinTrabajo, false);
	const gVacio = Q.htmlGrupo([1, 2, 3].map((n) => ({ alumno: { id: "v" + n, nombre_completo: "Alumno " + n, num_lista: n, grado: 2 }, res: vacioT2 })), 2);
	ok("grupo en T2 sin trabajo: un aviso y ninguna lista de pendientes",
		/Todavía no hay trabajo registrado en el trimestre 2\./.test(gVacio) && !/con algo pendiente/.test(gVacio) && !/data-qlf-fila/.test(gVacio), true);
	const gMixto = Q.htmlGrupo([{ alumno: { id: "a2", nombre_completo: "Ana", num_lista: 1, grado: 2 }, res: r },
		{ alumno: { id: "nuevo", nombre_completo: "Nuevo", num_lista: 2, grado: 2 }, res: vacioT2 }], 1);
	ok("grupo mixto: el alumno sin trabajo no cuenta como pendiente y lo dice", /1 de 2 alumnos con algo pendiente/.test(gMixto) &&
		/1 alumno todavía no tiene trabajo registrado/.test(gMixto) && /data-qlf-chip-sin-trabajo/.test(gMixto), true);

	// ── Nombre completo en la vista de grupo (R18: se cortaba a 1280) ─────────
	const largo = "María Guadalupe de los Ángeles Hernández Villaseñor";
	const gLargo = Q.htmlGrupo([{ alumno: { id: "l1", nombre_completo: largo, num_lista: 1, grado: 2 }, res: r }], 1);
	ok("grupo: el nombre no se trunca (salta de línea) y va completo en title",
		/data-qlf-nombre>María Guadalupe/.test(gLargo) && !/truncate'[^>]*data-qlf-nombre|class='[^']*truncate[^']*' data-qlf-nombre/.test(gLargo) && gLargo.indexOf("title='" + largo + "'") !== -1, true);

	// ── Boleta cerrada ────────────────────────────────────────────────────────
	const cerrada = Q.calcular(entrada({ cerrada: true }));
	ok("boleta cerrada: trimestre cerrado, nada listado", [cerrada.cerrada, cerrada.total, Object.keys(cerrada.campos).length], [true, 0, 0]);
	ok("boleta cerrada: el HTML dice Trimestre cerrado", /Trimestre cerrado/.test(Q.htmlAlumno(cerrada)) && !/Para avanzar/.test(Q.htmlAlumno(cerrada)), true);

	// ── Frases: tono formativo ────────────────────────────────────────────────
	const fr = Q.frases(len).map((f) => f.texto);
	ok("frase de entrega", fr.includes("Entregar «Cartel de mi comunidad» (sesión 4)."), true);
	ok("frase de incompleto", fr.includes("Completar «Cuento ilustrado» (sesión 4): la entrega quedó incompleta."), true);
	ok("frase de PDA en proceso, con criterio",
		fr.includes("Reforzar el PDA «Lee textos narrativos y comenta su contenido.», hoy En proceso. Criterio: «Lee en voz alta un párrafo»."), true);
	ok("frase de PDA sin evidencia", fr.includes("Mostrar evidencia del PDA «Escribe textos sencillos sobre su comunidad.»: se trabajó en la sesión 4 y todavía no tiene evidencia."), true);
	ok("frase de Revisar con escala", fr[0], "Revisar la calificación: la propuesta es 5 y el mínimo aprobatorio es 6 (escala de 2°: 5 a 10; 5 no es aprobatoria).");
	const todas = ["LEN", "SAB", "ETI", "DHL"].map((c) => Q.frases(r.campos[c]).map((f) => f.texto).join(" ")).join(" ");
	ok("sin lenguaje de puntos ni de sacar 10", /punto|sacar 10|\bmeta\b/i.test(todas), false);
	ok("ETI: juicio docente", /juicio docente/.test(Q.frases(r.campos.ETI)[0].texto), true);

	// ── HTML ──────────────────────────────────────────────────────────────────
	const h = Q.htmlAlumno(r);
	ok("detalle: los cuatro campos con «Para avanzar en»", ["LEN", "SAB", "ETI", "DHL"].every((c) => h.indexOf("data-qlf-campo='" + c + "'") !== -1) && /Para avanzar en Lenguajes/.test(h), true);
	ok("lo de la maestra (por revisar) no se imprime", /<li class='[^']*print:hidden' data-qlf='por_revisar'/.test(h), true);
	ok("una propuesta debajo del mínimo no se imprime (el reporte imprime «pendiente»)", /<li class='[^']*print:hidden' data-qlf='revisar'/.test(h), true);
	const hc = Q.htmlAlumno(cuarto);
	ok("una confirmada debajo del mínimo sí se imprime, con palabras para la familia",
		/data-qlf='revisar'/.test(hc) && /hidden print:inline'>La calificación de este campo \(5\) está debajo del mínimo aprobatorio de su grado \(6\); la escuela la revisará\./.test(hc), true);
	ok("la asistencia como referencia", /no forma parte de la calificación/.test(h), true);
	const malo = Q.calcular(entrada({ detalle: { sesiones: SESIONES, productos: [{ id: "x", sesion_id: "s4", tipo: "trabajo", campo: "LEN", nombre: "<img src=x onerror=alert(1)> 'B'" }], calificaciones: { x: { estado_entrega: "no_entregado" } }, alta: null } }));
	const hm = Q.htmlAlumno(malo);
	ok("nombres escapados (HTML y comilla simple)", hm.indexOf("<img") === -1 && hm.indexOf("&lt;img") !== -1 && hm.indexOf("&#39;B&#39;") !== -1, true);
	const g = Q.htmlGrupo([
		{ alumno: { id: "a2", nombre_completo: "Ana O'Neil", num_lista: 1, grado: 2 }, res: r },
		{ alumno: { id: "a3", nombre_completo: "Beto", num_lista: 2, grado: 2 }, res: cerrada },
	], 1);
	ok("grupo: un botón por alumno de 44 px con aria-expanded", (g.match(/<button type='button' class='w-full min-h-\[44px\][^>]*aria-expanded='false'/g) || []).length, 2);
	ok("grupo: chips por campo con su cuenta", /data-qlf-chip='LEN'[\s\S]*?<span class='font-bold'>5<\/span>/.test(g), true);
	ok("grupo: Revisar y sin evidencias en el chip", /· Revisar/.test(g) && /· sin evidencias/.test(g), true);
	ok("grupo: el cerrado dice Trimestre cerrado", /data-qlf-fila='a3'[\s\S]*Trimestre cerrado/.test(g), true);
	ok("grupo: nombre escapado", g.indexOf("Ana O&#39;Neil") !== -1 && g.indexOf("Ana O'Neil") === -1, true);
	ok("grupo: resumen 1 de 2 con pendientes y el cerrado aparte", /1 de 2 alumnos con algo pendiente/.test(g) && /1 alumno tiene la boleta de este trimestre cerrada/.test(g), true);
	const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;
	ok("sin emojis en el HTML", SIMBOLOS.test(h + g), false);

	// ── Capa de datos: calificación oficial, propuesta y cerrada ──────────────
	const mAlumno = { porCampo: { LEN: { porcentaje: 40, calificacionPropuesta: 5 }, SAB: { porcentaje: 70, calificacionPropuesta: 7 }, ETI: { porcentaje: 50, calificacionPropuesta: 6 }, DHL: { porcentaje: null, calificacionPropuesta: null } },
		asistencia: { presentes: 5, total: 5 }, detalle: { productos: [], calificaciones: {}, alta: null } };
	const ctx = { estado: "Jalisco" };
	const abierta = { LEN: { calificacion: 7, calificacion_confirmada: true, cerrada: false }, ETI: { calificacion: 5, calificacion_confirmada: true, cerrada: false } };
	const rd = RD.queLeFaltaDe(ctx, { id: "a2", grado: 3 }, mAlumno, [], [], abierta, HOY);
	ok("capa de datos: la confirmada manda sobre la propuesta (LEN 7, sin Revisar)", rd.campos.LEN.revisar, null);
	ok("capa de datos: confirmada 5 en 3° → Revisar confirmada", rd.campos.ETI.revisar && [rd.campos.ETI.revisar.valor, rd.campos.ETI.revisar.origen], [5, "confirmada"]);
	ok("capa de datos: DHL sin porcentaje → sin evidencias", rd.campos.DHL.sinEvidencias, true);
	// Un 5 confirmado que quedó fuera de la escala (el alumno pasó a 1°) no vale: se usa la propuesta
	const fuera = RD.queLeFaltaDe(ctx, { id: "a2", grado: 1 }, mAlumno, [], [], abierta, HOY);
	ok("capa de datos: en 1° nunca Revisar", fuera.campos.ETI.revisar, null);
	const filaCerrada = { calificacion: 8, calificacion_confirmada: true, cerrada: true };
	const cerr = RD.queLeFaltaDe(ctx, { id: "a2", grado: 3 }, mAlumno, [], [], { LEN: filaCerrada, SAB: filaCerrada, ETI: filaCerrada, DHL: filaCerrada }, HOY);
	ok("capa de datos: boleta cerrada → trimestre cerrado", cerr.cerrada, true);

	// ── Motor: ctx.detalle no agrega peticiones ───────────────────────────────
	const DATOS = {
		maestro_ajustes: [], grupos: [{ id: "g1", created_at: "2026-08-01T00:00:00Z" }],
		alumnos: [{ id: "a2", created_at: "2026-08-01T00:00:00Z" }],
		proyectos: [{ id: "p1", maestro_id: "m", grupo_id: "g1", trimestre: 1 }],
		sesiones: SESIONES.map((s) => Object.assign({ proyecto_id: "p1" }, s)),
		productos_sesion: PRODUCTOS.map((p) => Object.assign({ activo: true, grados: ["2"] }, p)),
		calificaciones: Object.keys(CALIFS).map((k) => Object.assign({ alumno_id: "a2", producto_sesion_id: k, maestro_id: "m", proyecto_id: "p1" }, CALIFS[k])),
		registro_diario: [], asistencias: [], examenes: [],
	};
	const peticiones = [], selects = [];
	function consulta(tabla) {
		const filtros = [];
		let desde = 0, hasta = Infinity, cols = "";
		const q = {
			select(c) { cols = c || ""; selects.push(tabla + ": " + cols); return q; },
			eq(c, v) { filtros.push((f) => String(f[c]) === String(v)); return q; },
			in(c, vs) { const s = vs.map(String); filtros.push((f) => s.indexOf(String(f[c])) !== -1); return q; },
			gte() { return q; }, lte() { return q; }, order() { return q; },
			range(a, b) { desde = a; hasta = b; return q.resolver(); },
			maybeSingle() { peticiones.push(tabla); return Promise.resolve({ data: null, error: null }); },
			resolver() {
				peticiones.push(tabla + (/nombre|numero_sesion/.test(cols) ? "+" : ""));
				const filas = (DATOS[tabla] || []).filter((f) => filtros.every((fn) => fn(f)));
				return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
			},
			then(bien, mal) { return q.resolver().then(bien, mal); },
		};
		return q;
	}
	const sb = { from: consulta, rpc(n, a) { peticiones.push("rpc"); return Promise.resolve({ data: a.p_porcentajes.map(() => 6), error: null }); } };
	const base = { maestroId: "m", grupoId: "g1", trimestre: 1, alumnos: [{ id: "a2", grado: 2 }] };
	await M.cargarYCalcularGrupo(sb, base);
	const sinDetalle = peticiones.map((p) => p.replace("+", ""));
	peticiones.length = 0;
	const conDet = await M.cargarYCalcularGrupo(sb, Object.assign({ detalle: true }, base));
	ok("motor con detalle: las mismas peticiones, en el mismo orden", peticiones.map((p) => p.replace("+", "")), sinDetalle);
	ok("motor con detalle: los PDA de la sesión traen sus productos ligados (producto_sesion_pda), en la misma petición",
		selects.filter((x) => x.indexOf("sesiones: ") === 0 && x.indexOf("producto_sesion_pda(producto_sesion_id)") !== -1).length > 0, true);
	ok("motor con detalle: sesiones y productos con más columnas", peticiones.filter((p) => p.endsWith("+")), ["sesiones+", "productos_sesion+"]);
	ok("motor con detalle: devuelve sesiones y los productos y capturas del alumno",
		[conDet.sesiones.length, conDet.porAlumno.a2.detalle.productos.length, Object.keys(conDet.porAlumno.a2.detalle.calificaciones).length], [4, 10, 5]);
	const sinD = await M.cargarYCalcularGrupo(sb, base);
	ok("motor sin detalle: no devuelve detalle (nada cambia para las demás páginas)", [sinD.sesiones, sinD.porAlumno.a2.detalle], [undefined, undefined]);
	ok("motor: el porcentaje es el mismo con y sin detalle", conDet.porAlumno.a2.porCampo.LEN.porcentaje, sinD.porAlumno.a2.porCampo.LEN.porcentaje);
	// De punta a punta: motor con detalle → Qué le falta
	const e2e = Q.calcular({ alumno: { id: "a2", grado: 2 }, porCampo: conDet.porAlumno.a2.porCampo,
		detalle: Object.assign({ sesiones: conDet.sesiones }, conDet.porAlumno.a2.detalle), avancePda: [], calificacion: {}, hoy: HOY, regla: NACIONAL });
	ok("de punta a punta: las mismas entregas pendientes en LEN", e2e.campos.LEN.productos.map((p) => p.nombre), ["Cartel de mi comunidad", "Cuento ilustrado"]);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
