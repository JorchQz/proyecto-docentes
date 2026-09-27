/*
	Registro histórico (spec de Jorge del 2026-09-26, §4; mi_salon_b20): "Ponte al día", la
	calificación directa del trimestre y las reglas de es_historico.

	1. Lista pegada (js/historico.js parsearLista): Excel con tabulador, WhatsApp con números,
	   hora y encabezados de grado, nombres y apellidos compuestos, acentos y Ñ, lista que empieza
	   por el nombre, "APELLIDOS, NOMBRE", repetidos, encabezados y renglones sin nombre.
	2. Cuadrícula de asistencia: días de clase del inicio del trimestre a ayer (calendario SEP y
	   ajustes del grupo), semanas, "Todos asistieron" y lo que se escribe (mismo modelo que
	   Asistencia; lo que ya estaba se respeta; días sin clase; alta tarde).
	3. Captura en bloque: validación, lo que va a agregar_actividades_historicas, el semáforo de la
	   cuadrícula y las calificaciones que se escriben (con la fecha de su actividad).
	4. Calificación directa: el motor (aplicarDirectas y cargarYCalcularGrupo con un Supabase
	   falso: la propuesta es la directa, sin porcentaje, y no va a la conversión SQL), la escala por
	   grado (1° de 6 a 10; 2° a 6° de 5 a 10), la boleta (juicio, foto del cierre, etiqueta) y la
	   base (trigger con piso_calificacion_boleta y boleta cerrada).
	5. Reglas es_historico: AlcanceHoy (fecha histórica en hora de México, producto histórico, tarea
	   por revisar, Incompleta que no pasa, abrir para calificar), Qué le falta (solo lo registrado,
	   días antes del alta del grupo, directa no es "sin evidencias"), cumpleaños desde hoy, y los
	   triggers de b20. Además: Hoy, Inicio y Tareas usan esas reglas; delete_own_account completa.

	node pruebas/registro-historico.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
window.ReglasEntidad = require("../js/reglas-entidad.js");
const H = require("../js/historico.js");
const A = window.AlcanceHoy;
const M = require("../js/motor-calificacion.js");
window.MotorCalificacion = M;
require("../js/reporte-datos.js");
const RD = window.ReporteDatos;
const Q = require("../js/que-le-falta.js");
const K = require("../js/cumpleanos.js");

const partes = (f) => [f.apellido1, f.apellido2, f.nombres, f.grado];

// ══════════════════════════════════════════════════════════════════════════
console.log("\n1. Lista pegada");
{
	const excel = [
		"No.\tApellido paterno\tApellido materno\tNombre(s)\tGrado",
		"1\tPérez\tLópez\tJuan Carlos\t3",
		"2\tde la Cruz\tNúñez\tMaría José\t4°",
		"3\tMUÑOZ\tPEÑA\tÑUSTA\ttercero",
	].join("\n");
	const r = H.parsearLista(excel, { grados: [3, 4] });
	ok("Excel con tabulador: encabezado fuera, número de lista fuera, columnas y grado", r.filas.map(partes),
		[["PÉREZ", "LÓPEZ", "JUAN CARLOS", 3], ["DE LA CRUZ", "NÚÑEZ", "MARÍA JOSÉ", 4], ["MUÑOZ", "PEÑA", "ÑUSTA", 3]]);
	ok("Excel: nombre completo en MAYÚSCULAS con acentos y Ñ (paterno, materno, nombres)", r.filas[1].nombreCompleto, "DE LA CRUZ NÚÑEZ MARÍA JOSÉ");
	ok("Excel: el encabezado cuenta como ignorado", r.ignorados, 1);

	const whatsapp = [
		"[12/10/26, 9:15] Dirección Escolar: Lista 3° grado",
		"3° GRADO",
		"1. Juan Pérez López",
		"2) María de los Ángeles Gómez Ruiz",
		"3.- José Ñúñez Peña \u{1F60A}", // un emoji (se quita); escrito como escape para no tenerlo en el repo
		"CUARTO",
		"12/10/26 9:16 - Dirección Escolar: 4. Sofía Hernández",
		"• Luis Ángel del Río Santos",
		"",
		"25",
	].join("\n");
	const w = H.parsearLista(whatsapp, { grados: [3, 4] });
	ok("WhatsApp: adivina que la lista empieza por el nombre", w.orden, "nombre");
	ok("WhatsApp: números, viñetas, hora y remitente fuera; encabezados de grado; nombre compuesto; emoji fuera",
		w.filas.map(partes),
		[["PÉREZ", "LÓPEZ", "JUAN", 3], ["GÓMEZ", "RUIZ", "MARÍA DE LOS ÁNGELES", 3], ["ÑÚÑEZ", "PEÑA", "JOSÉ", 3],
			["HERNÁNDEZ", "", "SOFÍA", 4], ["DEL RÍO", "SANTOS", "LUIS ÁNGEL", 4]]);
	ok("WhatsApp: un número suelto no es alumno", w.filas.length, 5);

	const escuela = ["GARCÍA LÓPEZ ANA SOFÍA", "DEL RÍO SAN JUAN PEDRO", "PÉREZ LÓPEZ, JUAN", "MARTÍNEZ JOSÉ (3°)", "garcía lópez ana sofía"].join("\n");
	const e = H.parsearLista(escuela, { grados: [2, 3], existentes: ["MARTÍNEZ JOSÉ"] });
	ok("lista de la escuela: apellidos primero; partículas pegadas (DEL RÍO, SAN JUAN); coma = apellidos, nombre",
		e.filas.map(partes).slice(0, 3), [["GARCÍA", "LÓPEZ", "ANA SOFÍA", null], ["DEL RÍO", "SAN JUAN", "PEDRO", null], ["PÉREZ", "LÓPEZ", "JUAN", null]]);
	ok("grado al final entre paréntesis", e.filas[3].gradoLeido, 3);
	ok("repetidos: en la lista (sin acentos ni mayúsculas) y con el grupo", [e.filas[4].error, e.filas[3].error], ["Está repetido en la lista", "Ya está en el grupo"]);
	ok("orden a mano: la misma lista leída como «nombre primero»", partes(H.parsearLista("ANA SOFÍA GARCÍA LÓPEZ", { orden: "nombre", grados: [2] }).filas[0]), ["GARCÍA", "LÓPEZ", "ANA SOFÍA", 2]);
	ok("un solo grado en el grupo: todos van a ese grado", H.parsearLista("PÉREZ LÓPEZ JUAN\nRUIZ ANA", { grados: [5] }).filas.map((f) => f.grado), [5, 5]);
	ok("un solo nombre: pide apellido", H.parsearLista("PEDRO", { grados: [1] }).filas[0].error, "Falta el apellido paterno o el nombre");
	ok("muy largo: se marca para revisar cómo se separó", H.parsearLista("GARCÍA LÓPEZ MARÍA FERNANDA GUADALUPE ISABEL", { grados: [1] }).filas[0].dudoso, true);
	// R27a: apellidos compuestos con la partícula en medio (MONTES DE OCA, PONCE DE LEÓN)
	const sep = (t, o) => { const f = H.parsearLista(t, Object.assign({ grados: [1] }, o || {})).filas[0]; return [f.apellido1, f.apellido2, f.nombres, f.dudoso]; };
	ok("MONTES DE OCA es un solo apellido (paterno)", sep("MONTES DE OCA LÓPEZ ANA SOFÍA"), ["MONTES DE OCA", "LÓPEZ", "ANA SOFÍA", false]);
	ok("PONCE DE LEÓN (con acento) es un solo apellido", sep("PONCE DE LEÓN GARCÍA JUAN"), ["PONCE DE LEÓN", "GARCÍA", "JUAN", false]);
	ok("MONTES DE OCA como materno", sep("PÉREZ MONTES DE OCA LUIS"), ["PÉREZ", "MONTES DE OCA", "LUIS", false]);
	ok("MONTES DE OCA con coma y en una lista que empieza por el nombre", [sep("MONTES DE OCA LÓPEZ, ANA"), sep("ANA SOFÍA LÓPEZ MONTES DE OCA", { orden: "nombre" })],
		[["MONTES DE OCA", "LÓPEZ", "ANA", false], ["LÓPEZ", "MONTES DE OCA", "ANA SOFÍA", false]]);
	ok("DE LA CRUZ como materno sigue sin marcarse (el nombre de pila lo delimita)", sep("PÉREZ DE LA CRUZ JUAN CARLOS"), ["PÉREZ", "DE LA CRUZ", "JUAN CARLOS", false]);
	ok("partícula en medio de un compuesto que no está en la lista: se marca para revisar", sep("RUIZ DE ALDANA PÉREZ LUCÍA")[3], true);
	ok("gradoDeTexto: 3°, 3er grado, TERCERO, 3° A; un 3 suelto solo en columna", ["3°", "3er grado", "TERCERO", "3° A", "3"].map((t) => H.gradoDeTexto(t)).concat([H.gradoDeTexto("3", true)]), [3, 3, 3, 3, null, 3]);
	const f = { apellido1: "pérez", apellido2: "", nombres: "ana", grado: 3 };
	H.revisarFila(f, {});
	ok("corregir a mano: vuelve a MAYÚSCULAS y arma el nombre", f.nombreCompleto, "PÉREZ ANA");
	ok("¿se puede guardar? multigrado sin grado no", H.listaLista([{ grado: null }, { grado: 3 }], [3, 4]), { ok: false, faltanGrado: 1, conError: 0 });
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n2. Periodo y cuadrícula de asistencia");
{
	ok("periodo vigente sin la tabla de periodos: el calendario SEP (T1 desde el 31 de agosto)", (({ trimestre, inicio, fuente }) => ({ trimestre, inicio, fuente }))(H.periodoVigente("2026-10-12", null)),
		{ trimestre: 1, inicio: "2026-08-31", fuente: "calendario" });
	ok("periodo vigente con mi_salon_periodos (T2 ya a la venta el 14 de noviembre)", (({ trimestre, periodo, fuente }) => ({ trimestre, periodo, fuente }))(H.periodoVigente("2026-11-20", [
		{ ciclo: "2026-2027", periodo: "T1", orden: 1, venta_desde: "2026-08-31" }, { ciclo: "2026-2027", periodo: "T2", orden: 2, venta_desde: "2026-11-14" }])),
		{ trimestre: 2, periodo: "T2", fuente: "periodos" });
	ok("se ofrece si hoy es posterior al inicio; no el primer día", [H.ofrecerPonteAlDia("2026-10-12", { inicio: "2026-08-31" }), H.ofrecerPonteAlDia("2026-08-31", { inicio: "2026-08-31" })], [true, false]);
	const dias = H.diasHistoricos("2026-08-31", "2026-10-12", []);
	ok("días de clase del 31 ago a AYER (11 oct): 28, sin el 16 sep (festivo) ni el 25 sep (CTE)", [dias.length, dias[0], dias[dias.length - 1], dias.includes("2026-09-16"), dias.includes("2026-09-25")],
		[28, "2026-08-31", "2026-10-09", false, false]);
	ok("con un día sin clase del grupo (calendario_ajustes)", H.diasHistoricos("2026-08-31", "2026-10-12", [{ fecha: "2026-09-10", tipo: "suspension" }]).length, 27);
	ok("semanas de lunes a viernes", H.semanas(dias).map((s) => s.dias.length), [5, 5, 4, 4, 5, 5]);
	ok("un toque: Falta; otro: Justificada; otro: Presente", ["presente", "ausente", "justificada"].map(H.siguienteAsistencia), ["ausente", "justificada", "presente"]);
	const al = [{ id: "a" }, { id: "b" }, { id: "c", alta: "2026-09-02" }];
	const r = H.filasAsistencia({ alumnos: al, dias: ["2026-09-01", "2026-09-02", "2026-09-03"], marcas: { "a|2026-09-02": "ausente", "b|2026-09-02": "justificada" },
		enBase: { "a|2026-09-01": "presente", "b|2026-09-01": "ausente" }, sinClase: { "2026-09-03": true }, maestroId: "m", grupoId: "g", capturadoEn: "2026-10-12T22:00:00Z" });
	ok("Todos asistieron por omisión; lo de la base se respeta; día sin clase y días antes del alta sin nada",
		r.filas.map((x) => x.alumno_id + " " + x.fecha + " " + x.asistencia_estado), ["a 2026-09-02 ausente", "b 2026-09-02 justificada", "c 2026-09-02 presente"]);
	ok("mismo modelo que Asistencia (llave grupo, alumno, fecha) con capturado_en", Object.keys(r.filas[0]).sort(), ["alumno_id", "asistencia_estado", "capturado_en", "fecha", "grupo_id", "maestro_id"]);
	ok("cuenta: presentes, faltas y justificadas", r.cuenta, { presente: 2, ausente: 2, justificada: 1 });
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n3. Captura en bloque");
{
	const ctx = { desde: "2026-08-31", hoy: "2026-10-12", gradosGrupo: [1, 2, 3] };
	const base = { nombre: " Mapa  de mi comunidad ", tipo: "trabajo", fecha: "2026-09-02", campo: "ETI", grados: [3, 1] };
	ok("válida: nombre limpio y grados en orden", H.validarActividad(base, ctx), { ok: true, nombre: "Mapa de mi comunidad", grados: [1, 3] });
	ok("de hoy o futura: no (es de días que ya pasaron)", [H.validarActividad(Object.assign({}, base, { fecha: "2026-10-12" }), ctx).foco, H.validarActividad(Object.assign({}, base, { fecha: "2026-10-20" }), ctx).foco], ["fecha", "fecha"]);
	ok("antes del inicio del trimestre: no", H.validarActividad(Object.assign({}, base, { fecha: "2026-08-20" }), ctx).foco, "fecha");
	ok("sin campo o sin grados: no", [H.validarActividad(Object.assign({}, base, { campo: "" }), ctx).foco, H.validarActividad(Object.assign({}, base, { grados: [] }), ctx).foco], ["campo", "grados"]);
	ok("lo que va a agregar_actividades_historicas", H.itemsParaGuardar([Object.assign({}, base, { grados: [3, 1], pda: [{ pda_id: "p1", grado: "3", texto: "x" }] })]),
		[{ fecha: "2026-09-02", producto: { tipo: "trabajo", nombre: "Mapa de mi comunidad", grados: ["1", "3"], modalidad: "compartida", campo: "ETI" }, asignacion: [], crear: [{ pda_id: "p1", grado: 3 }] }]);
	ok("semáforo: vacío → Logrado → En proceso → Requiere apoyo → No entregó → vacío",
		[null, "logrado", "en_proceso", "requiere_apoyo", "no_entregado"].map(H.siguienteSemaforo), ["logrado", "en_proceso", "requiere_apoyo", "no_entregado", null]);
	ok("celda → columnas de la calificación (las mismas de Hoy)", [H.cambiosDeSemaforo("en_proceso"), H.cambiosDeSemaforo("no_entregado"), H.cambiosDeSemaforo(null)],
		[{ estado_entrega: "entregado", nivel: "en_proceso", entrego: true }, { estado_entrega: "no_entregado", nivel: null, entrego: false }, null]);
	const prods = [{ id: "p", sesion_id: "s", proyecto_id: "pr", tipo: "trabajo", nombre: "Mapa", campo: "ETI", fecha: "2026-09-02" }];
	const alumnos = [{ id: "a", grado: 1 }, { id: "b", grado: 3 }, { id: "c", grado: 3 }, { id: "d", grado: 3 }];
	const r = H.filasCalificaciones({ productos: prods, alumnos: alumnos,
		celdas: { "a|p": "logrado", "b|p": "requiere_apoyo", "c|p": null, "d|p": "logrado" },
		enBase: { "b|p": { id: "cb", estado_entrega: "entregado", nivel: "logrado" }, "c|p": { id: "cc", estado_entrega: "entregado", nivel: "logrado" }, "d|p": { id: "cd", estado_entrega: "entregado", nivel: "logrado" } },
		maestroId: "m", grupoId: "g", capturadoEn: "2026-10-12T22:00:00Z", campoLargo: window.CamposFormativos.largo });
	ok("nueva: con la FECHA DE LA ACTIVIDAD y capturado_en (la base la marca es_historico)", (({ fecha, capturado_en, campo_formativo, grado, estado_entrega, nivel }) => ({ fecha, capturado_en, campo_formativo, grado, estado_entrega, nivel }))(r.insertar[0]),
		{ fecha: "2026-09-02", capturado_en: "2026-10-12T22:00:00Z", campo_formativo: "Ética, Naturaleza y Sociedades", grado: 1, estado_entrega: "entregado", nivel: "logrado" });
	ok("cambiada: update; vaciada: se borra; igual: no se toca", [r.actualizar.map((x) => x.id), r.borrar, r.insertar.length], [["cb"], ["cc"], 1]);
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n4. Calificación directa");
(async () => {
	ok("escala por grado: 1° de 6 a 10; 2° a 6° de 5 a 10", [H.escalaDirecta(1), H.escalaDirecta(2), H.escalaDirecta(6)], [[6, 7, 8, 9, 10], [5, 6, 7, 8, 9, 10], [5, 6, 7, 8, 9, 10]]);
	ok("validar: un 5 en 1° no; un 5 en 2° sí; 11 no; 7.5 no", [H.validarDirecta(5, 1).ok, H.validarDirecta(5, 2).ok, H.validarDirecta(11, 3).ok, H.validarDirecta(7.5, 3).ok, H.validarDirecta(5, 1).error],
		[false, true, false, false, "En 1° la calificación va de 6 a 10."]);
	ok("nivel con los cortes de la conversión (9-10 logrado, 7-8 en proceso, 5-6 requiere apoyo)", [10, 9, 8, 7, 6, 5].map(M.nivelDeCalificacion), ["logrado", "logrado", "en_proceso", "en_proceso", "requiere_apoyo", "requiere_apoyo"]);
	const pc = { LEN: { porcentaje: 74.2, calificacionPropuesta: 8, rubros: { tareas: {} } }, SAB: { porcentaje: 60, calificacionPropuesta: 7 } };
	M.aplicarDirectas(pc, { LEN: { calificacion: 9, capturado_en: "x" } });
	ok("aplicarDirectas: la propuesta es la directa, sin porcentaje; el de las actividades queda aparte", [pc.LEN.calificacionPropuesta, pc.LEN.porcentaje, pc.LEN.porcentajeActividades, pc.LEN.nivel, pc.LEN.directa.calificacion, pc.SAB.calificacionPropuesta],
		[9, null, 74.2, "logrado", 9, 7]);

	// El motor completo con un Supabase falso: LEN con directa, SAB por actividades
	const DATOS = {
		maestro_ajustes: [], grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }], proyectos: [{ id: "proy", tipo: "sueltas" }],
		sesiones: [{ id: "s1", fecha: "2026-09-02", campo_formativo: "Lenguajes" }, { id: "s2", fecha: "2026-09-03", campo_formativo: "Saberes y Pensamiento Científico" }],
		productos_sesion: [
			{ id: "w1", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["1"], activo: true },
			{ id: "w2", sesion_id: "s2", tipo: "trabajo", campo: "SAB", grados: ["1"], activo: true },
		],
		calificaciones: [
			{ alumno_id: "a", producto_sesion_id: "w1", tipo: "trabajo", estado_entrega: "entregado", nivel: "requiere_apoyo", proyecto_id: "proy", fecha: "2026-09-02" },
			{ alumno_id: "a", producto_sesion_id: "w2", tipo: "trabajo", estado_entrega: "entregado", nivel: "logrado", proyecto_id: "proy", fecha: "2026-09-03" },
		],
		registro_diario: [], asistencias: [], examenes: [], examenes_grupo: [], producto_sesion_alumnos: [],
		alumnos: [{ id: "a", created_at: "2026-08-01T15:00:00+00:00" }],
		calificacion_directa: [{ alumno_id: "a", campo: "LEN", calificacion: 8, capturado_en: "2026-10-12T22:00:00Z" }],
	};
	const lecturas = [];
	function consulta(tabla) {
		lecturas.push(tabla);
		const q = {
			select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
			range() { return Promise.resolve({ data: DATOS[tabla] || [], error: null }); },
			maybeSingle() { return Promise.resolve({ data: null, error: null }); },
			then(a, b) { return Promise.resolve({ data: DATOS[tabla] || [], error: null }).then(a, b); },
		};
		return q;
	}
	let enviados = null;
	const sb = { from: consulta, rpc(n, args) { enviados = args.p_porcentajes.slice(); return Promise.resolve({ data: args.p_porcentajes.map(() => 10), error: null }); } };
	const r = await M.cargarYCalcularGrupo(sb, { maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN", "SAB"], alumnos: [{ id: "a", grado: 1 }] });
	const len = r.porAlumno.a.porCampo.LEN, sab = r.porAlumno.a.porCampo.SAB;
	ok("motor: lee calificacion_directa del grupo y trimestre", lecturas.includes("calificacion_directa"), true);
	ok("motor: LEN con directa (8, sin porcentaje; el de actividades, 40 %), SAB por la conversión SQL", [len.calificacionPropuesta, len.porcentaje, len.porcentajeActividades, sab.calificacionPropuesta], [8, null, 40, 10]);
	ok("motor: a la conversión SQL solo va el campo sin directa", enviados, [100]);
	// Sin la tabla (frontend antes que la migración): sin directas, sin error
	DATOS.calificacion_directa = null;
	const sb2 = { from(t) { if (t === "calificacion_directa") { const q = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, range() { return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }); } }; return q; } return consulta(t); }, rpc: sb.rpc };
	const r2 = await M.cargarYCalcularGrupo(sb2, { maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN"], alumnos: [{ id: "a", grado: 1 }] });
	ok("motor: sin la tabla calificacion_directa, calcula como siempre", r2.porAlumno.a.porCampo.LEN.directa, undefined);

	// Boleta: juicio, foto del cierre y etiqueta
	const fila = { calificacion_confirmada: true, calificacion: 8, porcentaje: null, campo: "LEN" };
	ok("boleta: una directa confirmada no es «juicio docente, sin evidencias»", [RD.juicioSinEvidencias({ LEN: fila }, "LEN", len), RD.juicioSinEvidencias({ LEN: fila }, "LEN", { porcentaje: null })], [false, true]);
	const foto = RD.fotoCampos({ LEN: len, SAB: sab });
	ok("foto del cierre: recuerda la directa y no la toma como sin evidencias", [foto.LEN.directa, foto.LEN.sin_evidencias, RD.esDirecta(RD.porCampoCierre({ campos: foto }).LEN)], [{ calificacion: 8 }, false, true]);
	ok("etiqueta de la boleta interna", RD.ETIQUETA_DIRECTA, "Capturada directamente");
	const rep = leer("js/reportes.js");
	ok("Reportes → Boleta: etiqueta, porcentaje «capturada directamente», porcentaje null al guardar y «Usar el cálculo automático»",
		[/RDB\.ETIQUETA_DIRECTA/.test(rep), /data-pct-directa/.test(rep), /porcentaje: datos\.porcentaje === null \|\| datos\.porcentaje === undefined \? null : pctGuardado/.test(rep),
			/from\("calificacion_directa"\)\.delete\(\)/.test(rep)], [true, true, true, true]);
	ok("boleta imprimible: sin la etiqueta ni la marca del registro histórico", /ETIQUETA_DIRECTA|esDirecta|es_historico|Capturada directamente/.test(leer("js/boleta.js")), false);
	ok("reporte del alumno (solo en pantalla), Recrea/Concentrado, junta y Qué le falta la rotulan",
		[/print:hidden' data-directa/.test(leer("js/reporte-alumno.js")), /capturada directamente/.test(leer("js/reportes-grupo.js")), /data-junta-directa/.test(leer("js/junta.js")), /· directa/.test(leer("js/que-le-falta.js"))],
		[true, true, true, true]);

	const b20 = leer("supabase/mi_salon_b20_registro_historico_2026-09.sql");
	ok("base: la directa valida la escala del grado con piso_calificacion_boleta y no cambia una boleta cerrada",
		[/v_piso := public\.piso_calificacion_boleta\(v_grado\);/.test(b20), /new\.calificacion < v_piso or new\.calificacion > 10/.test(b20), /and b\.trimestre = new\.trimestre and b\.campo = new\.campo and b\.cerrada\)/.test(b20),
			/before insert or update on public\.calificacion_directa/.test(b20), /check \(calificacion between 5 and 10\)/.test(b20)], [true, true, true, true, true]);
	ok("base: la directa siempre es registro histórico", /new\.es_historico := true;/.test(b20), true);

	// ══════════════════════════════════════════════════════════════════════
	console.log("\n5. Reglas es_historico");
	ok("fecha histórica en hora de México (a las 9 de la noche del 12 en México ya es 13 en UTC)",
		[A.esFechaHistorica("2026-10-12", "2026-10-13T03:00:00Z"), A.esFechaHistorica("2026-10-11", "2026-10-13T03:00:00Z"), A.esFechaHistorica("2026-10-12", "2026-10-13T07:00:00Z")], [false, true, true]);
	ok("producto histórico: la columna si se leyó; si no, su sesión antes del día de su creación",
		[A.esHistorico({ es_historico: true }), A.esHistorico({ es_historico: false, created_at: "2026-10-12T20:00:00Z" }, "2026-09-02"), A.esHistorico({ created_at: "2026-10-12T20:00:00Z" }, "2026-09-02"), A.esHistorico({ created_at: "2026-09-02T20:00:00Z" }, "2026-09-02")],
		[true, false, true, false]);
	ok("tarea por revisar: vencida y no histórica", [A.tareaPorRevisar({ es_historico: false }, "2026-10-09", "2026-10-12"), A.tareaPorRevisar({ es_historico: true }, "2026-10-09", "2026-10-12"), A.tareaPorRevisar({ es_historico: false }, "2026-10-13", "2026-10-12")], [true, false, false]);
	ok("Incompleta en una actividad histórica: incompleta (0.5), sin revisión en la siguiente clase", A.cambiosIncompleta("marcar", { hoy: "2026-10-12", historico: true }),
		{ estado_entrega: "incompleto", nivel: null, estado_en_clase: null, revisar_en: null, completado_en: null });
	ok("Incompleta en una actividad de hoy: sigue pasando a la siguiente clase", A.cambiosIncompleta("marcar", { hoy: "2026-10-12" }).revisar_en, "2026-10-13");
	ok("Hoy no abre para calificar las del asistente (ya se calificaron en su cuadrícula)", [A.abrirParaCalificar({ desde_ponte_al_dia: true }), A.abrirParaCalificar({ desde_ponte_al_dia: false }), A.abrirParaCalificar({})], [false, true, true]);

	const hoyJs = leer("js/hoy.js"), dash = leer("js/dashboard.js"), tareas = leer("js/tareas.js");
	ok("Hoy, Inicio y Tareas usan la misma regla (tareaPorRevisar) y leen es_historico",
		[/AlcanceHoy\.tareaPorRevisar\(p, venceDe\(p\), hoy/.test(hoyJs), /AlcanceHoy\.abrirParaCalificar\(p\)/.test(hoyJs), /es_historico, desde_ponte_al_dia"\)/.test(hoyJs),
			/AlcanceHoy\.tareaPorRevisar\(p, vence, hoy/.test(dash), /created_at, es_historico"\)\.in\("sesion_id"/.test(dash),
			/AlcanceHoy\.tareaPorRevisar\(t, t\.vence, hoy/.test(tareas), /historica: "<span/.test(tareas), /value="historica">Registro histórico</.test(leer("tareas.html"))],
		[true, true, true, true, true, true, true, true]);

	// Qué le falta: solo lo registrado
	const regla = window.ReglasEntidad.regla(null);
	const base = {
		alumno: { id: "a", grado: 3 }, hoy: "2026-10-12", regla: regla, grupoAlta: "2026-09-20",
		porCampo: { LEN: { porcentaje: 80 }, SAB: { porcentaje: null, directa: { calificacion: 7 } }, ETI: { porcentaje: null }, DHL: { porcentaje: 90 } },
		calificacion: { SAB: { valor: 7, origen: "directa" } }, avancePda: [], asistencia: null,
		detalle: {
			alta: null,
			sesiones: [
				{ id: "s1", fecha: "2026-09-02", campo_formativo: "Lenguajes", numero_sesion: 1, suelta: true, sesiones_pda: [{ pda_id: "pd1", grado: 3, criterio_aplicado: "c", producto_sesion_pda: [] }] },
				{ id: "s2", fecha: "2026-10-05", campo_formativo: "Lenguajes", numero_sesion: 2, suelta: true, sesiones_pda: [] },
				{ id: "s3", fecha: "2026-10-06", campo_formativo: "De lo Humano y lo Comunitario", numero_sesion: 3, sesiones_pda: [] },
			],
			productos: [
				{ id: "p1", sesion_id: "s1", tipo: "trabajo", campo: "LEN", nombre: "Antes del alta del grupo" },
				{ id: "p2", sesion_id: "s2", tipo: "trabajo", campo: "LEN", nombre: "Ponte al día", es_historico: true },
				{ id: "p3", sesion_id: "s2", tipo: "trabajo", campo: "LEN", nombre: "Histórica sin entregar", es_historico: true },
				{ id: "p4", sesion_id: "s3", tipo: "trabajo", campo: "DHL", nombre: "De un día de clase", es_historico: false },
			],
			calificaciones: { p3: { estado_entrega: "no_entregado" } },
		},
	};
	const q = Q.calcular(base);
	ok("Qué le falta: sin captura, lo histórico o anterior al alta del grupo no se pide (ni al docente); lo no histórico sí",
		[q.campos.LEN.porRevisar.map((x) => x.nombre), q.campos.DHL.porRevisar.map((x) => x.nombre)], [[], ["De un día de clase"]]);
	ok("Qué le falta: lo histórico que SÍ se registró cuenta (no entregó)", q.campos.LEN.productos.map((x) => x.nombre + " " + x.estado), ["Histórica sin entregar no_entregado"]);
	ok("Qué le falta: un PDA trabajado solo antes del alta del grupo, sin evidencia, no se pide", q.campos.LEN.pda.length, 0);
	ok("Qué le falta: la directa no es «sin evidencias»; un campo sin nada sí", [q.campos.SAB.sinEvidencias, q.campos.SAB.directa, q.campos.ETI.sinEvidencias], [false, 7, true]);
	ok("Qué le falta: nota del docente con la directa (no se imprime)", Q.frases(q.campos.SAB).filter((f) => f.tipo === "directa").map((f) => f.docente), [true]);
	const q2 = Q.calcular(Object.assign({}, base, { calificacion: { SAB: { valor: 5, origen: "directa" } } }));
	ok("Qué le falta: una directa debajo del mínimo se revisa y se dice que es capturada directamente", Q.frases(q2.campos.SAB)[0].texto, "Revisar la calificación: la capturada directamente es 5 y el mínimo aprobatorio es 6 (escala de 3°: 5 a 10; 5 no es aprobatoria).");

	ok("cumpleaños: el aviso de Inicio solo de hoy en adelante (nunca uno que ya pasó)",
		K.paraInicio([{ id: 1, estatus: "activo", nombre_completo: "A", fecha_nacimiento: "2018-10-10" }, { id: 2, estatus: "activo", nombre_completo: "B", fecha_nacimiento: "2018-10-14" }], "2026-10-12").map((c) => c.fecha), ["2026-10-14"]);
	ok("la asistencia no genera avisos ni incidencias: nada escribe incidencias ni avisos a partir de asistencias",
		fs.readdirSync(path.join(RAIZ, "js")).filter((f) => { const s = leer("js/" + f); return /from\("asistencias"\)/.test(s) && /from\("incidencias"\)\.insert|guardar_incidencia/.test(s); }), []);

	ok("b20: es_historico = fecha anterior al día (hora de México) de capturado_en, al crear; editar no la cambia",
		[/new\.es_historico := new\.fecha < public\.dia_mexico\(new\.capturado_en\);/.test(b20), (b20.match(/new\.es_historico := old\.es_historico;/g) || []).length,
			/new\.capturado_en := coalesce\(new\.capturado_en, new\.evaluado_en, pg_catalog\.now\(\)\);/.test(b20), /at time zone 'America\/Mexico_City'/.test(b20)], [true, 2, true, true]);
	ok("b20: agregar_actividades_historicas solo de días anteriores, en una transacción, y las marca",
		[/v_fecha >= v_hoy then/.test(b20), /public\.agregar_actividad_suelta\(p_grupo, v_fecha/.test(b20), /set es_historico = true, desde_ponte_al_dia = true/.test(b20)], [true, true, true]);
	const sinCom = b20.replace(/--[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$/g, "");
	ok("b20: aditiva (no borra tablas, columnas ni datos) y se puede correr dos veces",
		[/\bdrop (table|column)\b|\btruncate\b|alter table [^;]* drop /i.test(sinCom), (b20.match(/add column if not exists/g) || []).length, (b20.match(/create table if not exists/g) || []).length], [false, 6, 2]);
	const fn = (b20.match(/create or replace function public\.delete_own_account\(\)[\s\S]*?grant execute on function public\.delete_own_account\(\) to authenticated;/g) || [])[0] || "";
	const TODAS = ["evaluacion_formativa", "calificaciones", "registro_diario", "boleta_trimestral", "evaluacion_diagnostica", "tareas", "producto_sesion_alumnos", "productos_sesion", "dias_no_habiles_extra", "maestro_ajustes", "zz_deprecated_diagnosticos",
		"incidencia_alumnos", "incidencias", "roles_aseo", "calendario_ajustes", "listas_valores", "listas_columnas", "listas_grupo", "interes_secciones",
		"examen_alumnos", "examen_respuestas", "examen_resultados", "examen_preguntas", "examenes_grupo", "marketplace_busquedas_vacias", "productos_finales", "calificacion_directa", "ponte_al_dia"];
	ok("delete_own_account de b20: la de b19a completa más calificacion_directa y ponte_al_dia", TODAS.filter((t) => !new RegExp("delete from public\\." + t + " where (maestro_id|usuario_id|user_id)").test(fn)), []);
	ok("delete_own_account de b20: lo nuevo con guarda to_regclass, antes de borrar el usuario",
		["calificacion_directa", "ponte_al_dia"].map((t) => new RegExp("if to_regclass\\('public\\." + t + "'\\) is not null then\\s+execute 'delete from public\\." + t).test(fn) && fn.indexOf(t) < fn.indexOf("delete from auth.users")), [true, true]);

	// Páginas
	const pd = leer("ponte-al-dia.html"), ob = leer("onboarding.html");
	const antes = (s, a, b) => s.indexOf('src="' + a + '"') !== -1 && s.indexOf('src="' + a + '"') < s.indexOf('src="' + b + '"');
	ok("ponte-al-dia.html: carga lo que usa, en orden", [antes(pd, "js/lectura.js", "js/grupo-activo.js"), antes(pd, "js/reglas-entidad.js", "js/reporte-datos.js"), antes(pd, "js/historico.js", "js/ponte-al-dia.js"), antes(pd, "js/lista-pegada.js", "js/ponte-al-dia.js"), antes(pd, "js/alcance-hoy.js", "js/motor-calificacion.js")],
		[true, true, true, true, true]);
	ok("onboarding: lista pegada y, con el trimestre ya empezado, sigue Ponte al día", [antes(ob, "js/historico.js", "js/onboarding.js"), antes(ob, "js/lista-pegada.js", "js/onboarding.js"), /var destino = ofrece \? "ponte-al-dia\.html\?desde=alta" : "dashboard\.html";/.test(leer("js/onboarding.js"))], [true, true, true]);
	ok("Inicio: la tarjeta para retomar Ponte al día solo si su avance va en curso; el alta deja ese avance",
		[/crearCardPonteAlDia/.test(dash), /if \(!fila \|\| fila\.estado !== "en_curso"\) return null;/.test(dash), /from\("ponte_al_dia"\)\.upsert\(/.test(leer("js/onboarding.js"))], [true, true, true]);
	ok("Exámenes: el camino de siempre (solo resultados) desde Ponte al día", [/abrirDialogoExamen\(null, null, \{ modo: "resultados" \}\)/.test(leer("js/examen.js")), /id="exPonte"/.test(leer("examen.html"))], [true, true]);
	ok("textos nuevos sin género sobre la persona (docente, tú)", ["js/ponte-al-dia.js", "js/lista-pegada.js", "ponte-al-dia.html", "js/historico.js"].filter((f) => /\b(bienvenid[oa]|list[oa] para|maestr[oa]s?\b)/i.test(leer(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))), []);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})();
