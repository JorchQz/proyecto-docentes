/*
	Sesiones de varios días (Fase 5b del plan de Fanny, 2026-10-02; mi_salon_b27).

	  - AlcanceHoy.diaTrabajo y baseTarea: UNA regla del día (fecha_trabajo; suelta; terminada con terminada_en o fecha;
	    en curso o sin empezar = por trabajar) y su corte, atado al de js/sesion-terminar.js y al de la función SQL.
	  - Con sesiones de UN día (la sesión como texto, o solo con `fecha`, o terminada sin terminada_en) todo da lo mismo
	    que antes de b27.
	  - Faltas, alta tarde, histórico y vencimiento con sesiones de 1, 2 y 3 días: una falta cuenta contra una actividad
	    solo el día en que esa actividad se trabaja; por trabajar no deriva falta; la tarea del plan vence tras terminar.
	  - El motor (con una base de mentira): la participación se reparte en CADA día trabajado (sesion_dias), una actividad
	    de otro campo suma a su campo en su día, y lo de un día no cambia.
	  - SesionTerminar.preguntaDia y etiquetaDia; los pasos de la jornada (preguntar y elegirActividades) en el código.
	  - La migración b27: aditiva, idempotente, con sus triggers y su respaldo.

	node pruebas/dias-sesion.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");

global.window = {};
require("../js/campos-formativos.js");
const C = require("../js/calendario-sep.js");
window.CalendarioSEP = C;
const A = require("../js/alcance-hoy.js");
window.AlcanceHoy = A;
const M = require("../js/motor-calificacion.js");
const ST = require("../js/sesion-terminar.js");

// ── 1. El corte: un solo valor en tres lugares ──────────────────────────────
const sql = leer("supabase/mi_salon_b27_sesiones_varios_dias_2026-10.sql");
ok("el corte de alcance-hoy es el de sesion-terminar", A.CORTE_EN_CURSO, ST.CORTE_EN_CURSO);
ok("el corte de la función SQL sesion_terminada es el mismo", sql.indexOf("s.fecha < date '" + ST.CORTE_EN_CURSO + "'") !== -1, true);
[
	[{ fecha: "2026-09-29", estado_sesion: "activa", terminada_en: null }, "antes del corte"],
	[{ fecha: "2026-09-30", estado_sesion: "activa", terminada_en: null }, "en el corte"],
	[{ fecha: "2026-10-05", estado_sesion: "activa", terminada_en: null }, "después"],
	[{ fecha: "2026-10-05", estado_sesion: "completada", terminada_en: "2026-10-06" }, "completada"],
	[{ fecha: null, estado_sesion: "pendiente", terminada_en: null }, "sin empezar"],
].forEach(function (c) {
	// terminada y en curso son opuestos para una sesión con fecha; sin fecha no es ninguna de las dos
	const s = c[0];
	ok("sesionTerminada y SesionTerminar.enCurso se complementan: " + c[1], [A.sesionTerminada(s), A.sesionEnCurso(s), ST.enCurso(s)],
		[!!s.fecha && !ST.enCurso(s), ST.enCurso(s), ST.enCurso(s)]);
});

// ── 2. diaTrabajo y baseTarea ───────────────────────────────────────────────
const enCurso = { fecha: "2026-10-05", terminada_en: null, estado_sesion: "activa" };
const terminada = { fecha: "2026-10-05", terminada_en: "2026-10-07", estado_sesion: "completada" };
const vieja = { fecha: "2026-09-28", terminada_en: null, estado_sesion: "activa" }; // antes de b27 y del corte: terminada
const sinEmpezar = { fecha: null, terminada_en: null, estado_sesion: "pendiente" };
const suelta = { fecha: "2026-10-01", terminada_en: null, estado_sesion: "completada", suelta: true };
const act = (extra) => Object.assign({ id: "p", tipo: "trabajo" }, extra || {});
ok("diaTrabajo: fecha_trabajo manda", A.diaTrabajo(act({ fecha_trabajo: "2026-10-06" }), enCurso), "2026-10-06");
ok("diaTrabajo: sesión en curso sin día = por trabajar (null)", A.diaTrabajo(act(), enCurso), null);
ok("diaTrabajo: sin empezar = null", A.diaTrabajo(act(), sinEmpezar), null);
ok("diaTrabajo: terminada = terminada_en", A.diaTrabajo(act(), terminada), "2026-10-07");
ok("diaTrabajo: terminada antes de b27 (sin terminada_en) = su fecha", A.diaTrabajo(act(), vieja), "2026-09-28");
ok("diaTrabajo: suelta = la fecha de su sesión", A.diaTrabajo(act(), suelta), "2026-10-01");
ok("diaTrabajo: suelta marcada por su proyecto (proyectos.tipo)", A.diaTrabajo(act(), { fecha: "2026-10-01", estado_sesion: "completada", proyectos: { tipo: "sueltas" } }), "2026-10-01");
ok("diaTrabajo: la sesión como texto es de un día (todo lo de antes)", A.diaTrabajo(act(), "2026-09-28"), "2026-09-28");
ok("diaTrabajo: un objeto solo con fecha también (los suites de antes)", A.diaTrabajo(act(), { fecha: "2026-09-28" }), "2026-09-28");
ok("diaTrabajo: sin sesión ni día = null", A.diaTrabajo(act(), null), null);
ok("diaTrabajo: opciones.corte cambia lo terminado", A.diaTrabajo(act(), { fecha: "2026-10-05", estado_sesion: "activa" }, { corte: "2026-10-06" }), "2026-10-05");
ok("baseTarea: en curso o sin empezar = null (vence tras terminar)", [A.baseTarea(enCurso), A.baseTarea(sinEmpezar)], [null, null]);
ok("baseTarea: terminada = terminada_en; antes de b27 = fecha; suelta = fecha; texto = el texto",
	[A.baseTarea(terminada), A.baseTarea(vieja), A.baseTarea(suelta), A.baseTarea("2026-09-28")], ["2026-10-07", "2026-09-28", "2026-10-01", "2026-09-28"]);
ok("venceTarea: con la base de una sesión terminada el viernes 9 oct, el lunes 12", A.venceTarea(null, A.baseTarea({ fecha: "2026-10-05", terminada_en: "2026-10-09", estado_sesion: "completada" })), "2026-10-12");
ok("venceTarea: mientras la sesión sigue abierta no vence (null)", A.venceTarea(null, A.baseTarea(enCurso)), null);
ok("venceTarea: acepta la sesión misma", A.venceTarea(null, terminada), A.venceTarea(null, "2026-10-07"));
ok("venceTarea: la fecha de entrega manda aunque la sesión siga abierta", A.venceTarea("2026-10-08", A.baseTarea(enCurso)), "2026-10-08");
ok("fechaDeProducto: actividad = su día; tarea = la base; sin ellos, su entrega",
	[A.fechaDeProducto(act({ fecha_trabajo: "2026-10-06" }), enCurso), A.fechaDeProducto({ id: "t", tipo: "tarea" }, terminada), A.fechaDeProducto({ id: "t", tipo: "tarea", fecha_entrega: "2026-10-09" }, enCurso)],
	["2026-10-06", "2026-10-07", "2026-10-09"]);

// ── 3. Faltas: una falta cuenta solo el día en que esa actividad se trabaja ──
// Sesión de 3 días (lun 5, mar 6, mié 7): A del lun, C del mar, E por trabajar, tarea del plan
const dosDias = { fecha: "2026-10-05", terminada_en: null, estado_sesion: "activa" };
const A1 = act({ id: "A", fecha_trabajo: "2026-10-05" }), C2 = act({ id: "C", fecha_trabajo: "2026-10-06" }), E0 = act({ id: "E" });
const TA = { id: "T", tipo: "tarea" };
function asis(filas) {
	return A.indiceAsistencias(filas.map((f) => ({ alumno_id: "x", fecha: f[0], asistencia_estado: f[1], updated_at: f[0] + "T15:00:00+00:00" }))).x;
}
const faltoMar = asis([["2026-10-05", "presente"], ["2026-10-06", "ausente"], ["2026-10-07", "presente"]]);
ok("falta del martes: A (del lunes) no se afecta", A.estadoPorAsistencia(A1, dosDias, faltoMar, []), null);
ok("falta del martes: C (del martes) es No entregó", A.estadoPorAsistencia(C2, dosDias, faltoMar, []), { estado: "ausente", fecha: "2026-10-06" });
ok("falta del martes: E por trabajar NO deriva falta hasta tener día", A.estadoPorAsistencia(E0, dosDias, faltoMar, []), null);
const faltoLun = asis([["2026-10-05", "ausente"], ["2026-10-06", "presente"]]);
ok("falta del lunes: A es No entregó; C (del martes, vino) no", [A.estadoPorAsistencia(A1, dosDias, faltoLun, []), A.estadoPorAsistencia(C2, dosDias, faltoLun, [])], [{ estado: "ausente", fecha: "2026-10-05" }, null]);
const justLun = asis([["2026-10-05", "justificada"], ["2026-10-06", "presente"]]);
ok("justificada el lunes: A queda pendiente, C no", [A.estadoPorAsistencia(A1, dosDias, justLun, []), A.estadoPorAsistencia(C2, dosDias, justLun, [])], [{ estado: "justificada", fecha: "2026-10-05" }, null]);
ok("la tarea del plan de una sesión abierta no deriva falta (sin días: ni base ni vencimiento)", [A.fechasDeProducto(TA, dosDias, []), A.estadoPorAsistencia(TA, dosDias, faltoMar, [])], [[], null]);
const cerrada = { fecha: "2026-10-05", terminada_en: "2026-10-07", estado_sesion: "completada" };
ok("al terminar la sesión (mié 7) la tarea toma su base y su vencimiento: mié 7 y jue 8", A.fechasDeProducto(TA, cerrada, []), ["2026-10-07", "2026-10-08"]);
ok("terminada con una falta el mié 7: la tarea de ese día es No entregó", A.estadoPorAsistencia(TA, cerrada, asis([["2026-10-07", "ausente"]]), []), { estado: "ausente", fecha: "2026-10-07" });
// pendientesPorFalta: el mapa fechaSesion puede traer la sesión entera
const alumnosP = [{ id: "x", grado: 1, num_lista: 1 }];
const prods = [Object.assign({ sesion_id: "s", grados: ["1"] }, A1), Object.assign({ sesion_id: "s", grados: ["1"] }, C2), Object.assign({ sesion_id: "s", grados: ["1"] }, E0)];
const pend = A.pendientesPorFalta({ alumnos: alumnosP, productos: prods, fechaSesion: { s: dosDias }, calificaciones: {}, asignaciones: {},
	asistencias: { x: asis([["2026-10-05", "justificada"], ["2026-10-06", "presente"]]) }, ajustes: [] });
ok("pendientesPorFalta con la sesión entera: solo lo del día de la falta justificada (A), no C ni lo por trabajar", pend.map((x) => x.producto.id), ["A"]);

// ── 4. Histórico y alta tarde ───────────────────────────────────────────────
const dia2 = "2026-10-06T16:00:00+00:00";
ok("agregada el día 2 de una sesión en curso (con su día): NO es histórica", A.esHistorico({ id: "n", tipo: "trabajo", fecha_trabajo: "2026-10-06", created_at: dia2 }, dosDias), false);
ok("agregada el día 2 y aún por trabajar: no es histórica", A.esHistorico({ id: "n", tipo: "trabajo", created_at: dia2 }, dosDias), false);
ok("una actividad con día anterior a su creación sí lo es (Ponte al día)", A.esHistorico({ id: "n", tipo: "trabajo", fecha_trabajo: "2026-10-05", created_at: dia2 }, dosDias), true);
ok("sesión terminada el día 1 y actividad creada el día 2: histórica (como antes)", A.esHistorico({ id: "n", tipo: "trabajo", created_at: dia2 }, { fecha: "2026-10-05", terminada_en: "2026-10-05", estado_sesion: "completada" }), true);
ok("sesión de un día (texto) como antes: histórica si su día es anterior a la creación", A.esHistorico({ id: "n", tipo: "trabajo", created_at: dia2 }, "2026-10-05"), true);
ok("la columna es_historico manda", A.esHistorico({ id: "n", tipo: "trabajo", es_historico: false, created_at: dia2 }, "2026-10-05"), false);
ok("tareaPorRevisar: una tarea de sesión abierta (vence null) no se pide; la terminada vencida, sí",
	[A.tareaPorRevisar(TA, A.venceTarea(null, A.baseTarea(dosDias)), "2026-10-09", dosDias), A.tareaPorRevisar(Object.assign({ created_at: "2026-10-07T12:00:00+00:00" }, TA), A.venceTarea(null, A.baseTarea(cerrada)), "2026-10-09", cerrada)],
	[false, true]);
// Alta tarde: un alumno dado de alta el mar 6
const tarde = { id: "x", grado: 1, alta: "2026-10-06" };
ok("alta tarde: lo del lunes (día 1) no le toca; lo del martes y lo por trabajar sí",
	[A1, C2, E0].map((p) => A.recibeProducto(tarde, Object.assign({ grados: ["1"] }, p), {}, dosDias, null)), [false, true, true]);
ok("alta tarde: la tarea de una sesión abierta le toca (aún se va a trabajar)", A.recibeProducto(tarde, Object.assign({ grados: ["1"] }, TA), {}, dosDias, null), true);
ok("alta tarde: una sesión de un día de antes (texto) como siempre", A.recibeProducto(tarde, { id: "z", tipo: "trabajo", grados: ["1"] }, {}, "2026-10-05", null), false);

// ── 5. El motor: la participación en cada día trabajado ─────────────────────
function fabricarSb(datos) {
	function consulta(tabla) {
		const q = {
			select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
			range() { return Promise.resolve({ data: datos[tabla] || [], error: null }); },
			maybeSingle() { return Promise.resolve({ data: null, error: null }); },
			then(a, b) { return Promise.resolve({ data: datos[tabla] || [], error: null }).then(a, b); },
		};
		return q;
	}
	return { from: consulta, rpc(n, args) { return Promise.resolve({ data: args.p_porcentajes.map(() => 8), error: null }); } };
}
const reg = (fecha, p) => ({ alumno_id: "x", fecha: fecha, participacion: p, conducta: 1 });
function BASE(sesion, dias, productos, registros) {
	return {
		maestro_ajustes: [], grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }], proyectos: [{ id: "proy", tipo: "proyecto" }],
		sesiones: [Object.assign({ id: "s1", proyecto_id: "proy", campo_formativo: "Lenguajes" }, sesion)],
		sesion_dias: dias.map((d) => ({ sesion_id: "s1", fecha: d })),
		productos_sesion: productos.map((p) => Object.assign({ sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["1"], fecha_entrega: null, activo: true, es_historico: false, created_at: "2026-10-05T16:00:00+00:00" }, p)),
		calificaciones: [], registro_diario: registros, examenes: [], alumnos: [], asistencias: [], calendario_ajustes: [],
	};
}
const alumnos = [{ id: "x", grado: 1, created_at: "2026-08-01T15:00:00+00:00" }];
const motor = (d) => M.cargarYCalcularGrupo(fabricarSb(d), { maestroId: "m", grupoId: "g", trimestre: 1, alumnos: alumnos });
const diario = (r, c) => r.porAlumno.x.porCampo[c].rubros.participacion.diario;

(async () => {
	// Un día (como todo lo de antes): 1 día de participación en LEN
	let r = await motor(BASE({ fecha: "2026-10-05", estado_sesion: "completada" }, [], [{ id: "p1" }], [reg("2026-10-05", 1), reg("2026-10-06", 1)]));
	ok("motor, 1 día (sin sesion_dias ni terminada_en): 1 día de participación y el 6 sin sesión no entra", diario(r, "LEN").dias, 1);
	// Tres días trabajados: lun 5, mar 6, jue 8; el registro del mié 7 no entra (no se trabajó)
	r = await motor(BASE({ fecha: "2026-10-05", estado_sesion: "activa" }, ["2026-10-05", "2026-10-06", "2026-10-08"], [{ id: "p1" }],
		[reg("2026-10-05", 1), reg("2026-10-06", 2), reg("2026-10-07", 1), reg("2026-10-08", 0)]));
	ok("motor, 3 días: la participación cuenta en cada día trabajado y no en el que no se trabajó", [diario(r, "LEN").dias, diario(r, "LEN").destacados, diario(r, "LEN").ceros], [3, 1, 1]);
	ok("motor, 3 días: la calificación del rubro es 2 de 3", Math.round(r.porAlumno.x.porCampo.LEN.rubros.participacion.obtenido * 1000) / 1000 + "/" + r.porAlumno.x.porCampo.LEN.rubros.participacion.maximo, "2/3");
	// Otra actividad de otro campo (SAB) trabajada el mar 6: suma a SU campo en SU día; ese día LEN se reparte con SAB
	r = await motor(BASE({ fecha: "2026-10-05", estado_sesion: "activa" }, ["2026-10-05", "2026-10-06"], [{ id: "p1", fecha_trabajo: "2026-10-05" }, { id: "p2", campo: "SAB", fecha_trabajo: "2026-10-06" }],
		[reg("2026-10-05", 1), reg("2026-10-06", 1)]));
	ok("motor, otro campo: SAB recibe su día y LEN comparte el martes (1 + 0.5)", [diario(r, "LEN").dias, diario(r, "SAB").dias], [1.5, 0.5]);
	// La actividad por trabajar (sin día) no agrega campos a ningún día
	r = await motor(BASE({ fecha: "2026-10-05", estado_sesion: "activa" }, ["2026-10-05"], [{ id: "p1" }, { id: "p2", campo: "SAB" }], [reg("2026-10-05", 1)]));
	ok("motor: lo por trabajar (sin día) no reparte participación a otro campo", [diario(r, "LEN").dias, diario(r, "SAB").dias], [1, 0]);
	// Sesión terminada con terminada_en distinto de la fecha: ese día también cuenta
	r = await motor(BASE({ fecha: "2026-10-05", terminada_en: "2026-10-07", estado_sesion: "completada" }, ["2026-10-05", "2026-10-06"], [{ id: "p1" }],
		[reg("2026-10-05", 1), reg("2026-10-06", 1), reg("2026-10-07", 1)]));
	ok("motor: el día en que se terminó (terminada_en) también reparte participación", diario(r, "LEN").dias, 3);
	// Una sesión suelta cuenta su fecha (como siempre) con el campo de su actividad
	const d = BASE({ fecha: "2026-10-05", estado_sesion: "completada", proyecto_id: "sue" }, [], [{ id: "p1" }], [reg("2026-10-05", 1)]);
	d.proyectos = [{ id: "sue", tipo: "sueltas" }];
	r = await motor(d);
	ok("motor: una suelta cuenta su día", diario(r, "LEN").dias, 1);
	// Faltas derivadas con la sesión de varios días: falta el mar 6 → solo lo del martes vale 0
	const f = BASE({ fecha: "2026-10-05", estado_sesion: "activa" }, ["2026-10-05", "2026-10-06"],
		[{ id: "A", fecha_trabajo: "2026-10-05" }, { id: "C", fecha_trabajo: "2026-10-06" }, { id: "E" }], []);
	f.calificaciones = [{ alumno_id: "x", producto_sesion_id: "A", estado_entrega: "entregado", nivel: "logrado", puntaje: null, tipo: "trabajo", proyecto_id: "proy", fecha: "2026-10-05" }];
	f.asistencias = [{ alumno_id: "x", fecha: "2026-10-05", asistencia_estado: "presente", updated_at: "2026-10-05T15:00:00+00:00" }, { alumno_id: "x", fecha: "2026-10-06", asistencia_estado: "ausente", updated_at: "2026-10-06T15:00:00+00:00" }];
	f.registro_diario = [reg("2026-10-05", 1)];
	r = await motor(f);
	const tr = r.porAlumno.x.porCampo.LEN.rubros.trabajos;
	ok("motor: falta del martes — A (logrado) más C (0): 1 de 2; E por trabajar no cuenta", [Math.round(tr.fraccion * 1000) / 1000, tr.entrega.esperados + "/" + tr.entrega.entregados], [0.5, "2/1"]);

	// ── 6. preguntaDia y etiquetaDia ────────────────────────────────────────
	ok("etiquetaDia: el día de la semana y el número", [ST.etiquetaDia("2026-10-05"), ST.etiquetaDia("2026-10-06"), ST.etiquetaDia("2026-10-10")], ["lun 5 oct", "mar 6 oct", "sáb 10 oct"]);
	ok("preguntaDia: empezó hoy → no se pregunta", ST.preguntaDia({ sesion: { fecha: "2026-10-05" }, dias: ["2026-10-05"], productos: [], hoy: "2026-10-05" }), null);
	ok("preguntaDia: empezó el lun y hoy (mié) no se trabajó → último día trabajado", ST.preguntaDia({ sesion: { fecha: "2026-10-05" }, dias: ["2026-10-05", "2026-10-06"], productos: [], hoy: "2026-10-07" }), { ultimoDia: "2026-10-06" });
	ok("preguntaDia: una actividad con día de hoy → no se pregunta", ST.preguntaDia({ sesion: { fecha: "2026-10-05" }, dias: ["2026-10-05"], productos: [{ tipo: "trabajo", fecha_trabajo: "2026-10-07" }], hoy: "2026-10-07" }), null);
	ok("preguntaDia: el último día sale también de las actividades", ST.preguntaDia({ sesion: { fecha: "2026-10-05" }, dias: [], productos: [{ tipo: "trabajo", fecha_trabajo: "2026-10-06" }, { tipo: "tarea", fecha_trabajo: "2026-10-06" }], hoy: "2026-10-09" }), { ultimoDia: "2026-10-06" });
	ok("preguntaDia: sin fecha de sesión → no se pregunta", ST.preguntaDia({ sesion: { fecha: null }, dias: [], productos: [], hoy: "2026-10-09" }), null);

	// ── 7. El código ────────────────────────────────────────────────────────
	const h = leer("js/hoy.js"), st = leer("js/sesion-terminar.js");
	ok("Hoy: la jornada pregunta por la sesión abierta ANTES del diálogo de faltantes",
		h.indexOf("var paso = await pasoSesionesAbiertas(btn);") > 0 && h.indexOf("var paso = await pasoSesionesAbiertas(btn);") < h.indexOf("var faltantes = faltantesDeLaJornada(paso.siguen);"), true);
	ok("Hoy: los dos botones del paso y la lista «¿Qué se trabajó hoy?»",
		/Sigue el siguiente día de clase/.test(h) && /Terminarla ahora/.test(h) && /¿Qué se trabajó hoy\?/.test(h) && /sigue abierta\./.test(h), true);
	ok("Hoy: «Terminarla ahora» espera la cola y usa el diálogo de Terminar sesión", /async function terminarDesdeJornada[\s\S]{0,700}await esperarCola\(\)[\s\S]{0,400}abrirModal/.test(h), true);
	ok("Hoy: la pregunta del día siguiente (una vez por día sin cerrar)", /no se cerró la jornada\. ¿Qué actividades se trabajaron ese día\?/.test(h) && /data-dia-nada/.test(h) && /No se trabajó nada más/.test(h) && /cerrado_en/.test(h), true);
	ok("Hoy: el grupo plegado «Trabajadas el …»", /Trabajadas el /.test(h) && /data-abrir-grupo-dia/.test(h), true);
	ok("Hoy: quién falta usa el día de CADA actividad (diaTrabajo), no el primero de la sesión", /var diaAct = producto\.tipo === "tarea" \? null : window\.AlcanceHoy\.diaTrabajo\(producto, producto\.sesion\);/.test(h) && !/fechaSes === hoy \|\| esEnCurso/.test(h), true);
	ok("Hoy: lo por trabajar no falta calificarlo en la jornada", /if \(!p\.fecha_trabajo && esEnCurso\(ses\)\) return;/.test(h), true);
	ok("Terminar sesión escribe terminada_en, el día de las actividades sin día y el día cerrado", /terminada_en: diaFin/.test(st) && /fecha_trabajo: diaFin/.test(st) && /from\("sesion_dias"\)[\s\S]{0,200}upsert/.test(st), true);
	ok("la cabecera de sesion-terminar ya no dice la regla vieja (el día que solo se continúa no recibe participación)", !/el día que solo se continúa su campo no recibe participación/.test(st), true);
	const dj = leer("js/dashboard.js");
	ok("Inicio: cuenta también las sesiones en curso (como Hoy) y usa baseTarea y el día de cada actividad",
		/s\.fecha === hoy \|\| window\.AlcanceHoy\.sesionEnCurso\(s\)/.test(dj) && /baseTarea\(fechaSesion\[p\.sesion_id\]\)/.test(dj) && /terminada_en/.test(dj), true);
	const pj = leer("js/proyecto.js");
	ok("la vista del proyecto: Terminada el…, los días trabajados y «por trabajar»", /"Terminada el "/.test(pj) && /Se trabajó /.test(pj) && /"por trabajar"/.test(pj) && /trabajada el /.test(pj), true);

	// ── 8. La migración ─────────────────────────────────────────────────────
	ok("b27: columnas nuevas y nulas, tabla nueva, candado y sin anon",
		/add column if not exists terminada_en date;/.test(sql) && /add column if not exists fecha_trabajo date;/.test(sql) && /create table if not exists public\.sesion_dias/.test(sql) &&
		/select public\.mi_salon_candado\('public\.sesion_dias'\)/.test(sql) && !/to anon/.test(sql) && /unique \(sesion_id, fecha\)/.test(sql), true);
	const codigoSql = sql.replace(/--[^\n]*/g, "");
	// mover_producto_a_sesion es la de b19a letra por letra (con sus borrados de siempre); fuera de ella solo se borra sesion_dias
	const sinMover = codigoSql.slice(0, codigoSql.indexOf("create or replace function public.mover_producto_a_sesion")) +
		codigoSql.slice(codigoSql.indexOf("grant execute on function public.mover_producto_a_sesion"));
	ok("b27: aditiva (sin drop table ni drop column ni borrar filas ajenas; la reversa va en comentarios)",
		!/alter table[^;]*drop/i.test(codigoSql) && !/drop (table|column)/i.test(codigoSql) && !/delete from public\.(?!sesion_dias)/.test(sinMover) && /-- REVERSA/.test(sql), true);
	ok("b27: los triggers del encargo (sesiones, productos, calificaciones)",
		/create trigger sesiones_dias_trabajo\s+after insert or update of fecha on public\.sesiones/.test(sql) && /create trigger calificaciones_dia_actividad\s+after insert or update on public\.calificaciones/.test(sql) && /function public\.marca_historico_productos\(\)/.test(sql), true);
	ok("b27: la actividad nueva toma su día ANTES de calcular es_historico (misma función)", sql.indexOf("new.fecha_trabajo := greatest(v_ses.fecha, v_creado)") < sql.indexOf("new.es_historico := coalesce(new.es_historico, false)"), true);
	ok("b27: mover_producto_a_sesion conserva el día de la suelta y mantiene su firma", /fecha_trabajo = coalesce\(fecha_trabajo, v_ses_old\.fecha\)/.test(sql) && /function public\.mover_producto_a_sesion\(p_producto uuid, p_sesion uuid, p_fecha_entrega date default null\)/.test(sql), true);
	ok("b27: el respaldo es idempotente (solo donde falta el día; on conflict do nothing)", (sql.match(/fecha_trabajo is null/g) || []).length >= 4 && /on conflict \(sesion_id, fecha\) do nothing/.test(sql), true);
	ok("b27: la calificación solo da día a actividades de proyecto en curso y no a tareas", /public\.sesion_terminada\(v_ses\)/.test(sql) && /ps\.tipo is distinct from 'tarea'/.test(sql) && /v_tipo_proy is distinct from 'proyecto'/.test(sql), true);
	const guia = leer("docs/PRODUCCION-MI-SALON.md");
	ok("la guía de producción trae b27 con su comprobación y su reversa", /mi_salon_b27_sesiones_varios_dias_2026-10\.sql/.test(guia) && /Comprobación de b27/.test(guia) && /Reversa de b27/.test(guia), true);
	ok("existe la consulta de medición de solo lectura", fs.existsSync(path.join(__dirname, "..", "scripts", "medir-b27.sql")) && !/\b(insert|update|delete|alter|drop|create)\b/i.test(leer("scripts/medir-b27.sql").replace(/--[^\n]*/g, "")), true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
