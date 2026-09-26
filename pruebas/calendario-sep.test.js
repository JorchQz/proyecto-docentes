/*
	Calendario escolar SEP y rol de aseo (calendario.html, 2026-09-25).

	- js/calendario-sep.js: 185 días de clase del 2026-08-31 al 2027-07-09 (Acuerdo 07/07/26),
	  40 días hábiles sin clase y ninguno en fin de semana; tipos de cada día; ajustes del grupo
	  que quitan o suman días; qué ajustes se permiten; próximo día sin clase.
	- js/rol-aseo.js: reparto en orden y en círculo, días sin clase saltados, continuidad entre
	  meses (también si quien seguía se dio de baja), cambios a mano, avisos de calendario
	  cambiado, texto para copiar e imagen (diseño con un ctx falso).
	- js/calendario.js (parte pura): escape de textos (nombres y motivos) en el HTML del mes, del
	  rol y de la impresión.
	- supabase/mi_salon_b14_calendario_2026-09.sql: RLS y referencias propias en las dos tablas,
	  índice único por grupo y fecha / grupo y mes, sin anónimo y en delete_own_account.
	  La prueba en la base (otra cuenta no ve ni escribe) es .qa-x/rls.js (fuera de git).
	- La página: navegación en el head, candado, scripts en orden, regla de /salon/ y menú.

	node pruebas/calendario-sep.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");
const C = require("../js/calendario-sep.js");
const R = require("../js/rol-aseo.js");
const P = require("../js/calendario.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── Calendario oficial 2026-2027 ─────────────────────────────────────────────
const INI = "2026-08-31", FIN = "2027-07-09";
const clases = C.diasDeClase(INI, FIN);
const sin = C.diasSinClase(INI, FIN);
ok("185 días de clase entre el 31 de agosto de 2026 y el 9 de julio de 2027", clases.length, 185);
ok("40 días hábiles sin clase en el mismo periodo", sin.length, 40);
ok("185 + 40 = días hábiles del periodo (225)", clases.length + sin.length, 225);
ok("ningún día de clase ni sin clase cae en fin de semana", clases.concat(sin.map((t) => t.fecha)).filter(C.esFinDeSemana), []);
ok("el ciclo empieza y termina con clase", [clases[0], clases[clases.length - 1]], [INI, FIN]);
const porTipo = {};
sin.forEach((t) => { porTipo[t.tipo] = (porTipo[t.tipo] || 0) + 1; });
ok("sin clase: 9 suspensiones, 8 CTE, 20 de vacaciones y 3 de registro de calificaciones", porTipo, { festivo: 9, cte: 8, registro: 3, vacaciones: 20 });
ok("hoy (2026-09-25) es CTE, sin clase", [C.tipoDeDia("2026-09-25").tipo, C.esDiaDeClase("2026-09-25")], ["cte", false]);
ok("16 de septiembre: suspensión oficial", C.tipoDeDia("2026-09-16").tipo, "festivo");
ok("registro de calificaciones: sin clase (13-nov, 5-mar, 2-jul)", ["2026-11-13", "2027-03-05", "2027-07-02"].map((f) => C.esDiaDeClase(f)), [false, false, false]);
ok("comunicación a las familias: con clase y marcada", ["2026-11-23", "2027-03-19", "2027-07-08"].map((f) => [C.tipoDeDia(f).tipo, C.esDiaDeClase(f)]),
	[["entrega", true], ["entrega", true], ["entrega", true]]);
ok("jornada y preinscripción: con clase", [C.tipoDeDia("2026-09-07").tipo, C.tipoDeDia("2027-02-10").tipo, C.esDiaDeClase("2027-02-10")], ["jornada", "preinscripcion", true]);
ok("vacaciones de invierno y de primavera", ["2026-12-22", "2027-01-05", "2027-03-25", "2027-04-02"].map((f) => C.tipoDeDia(f).tipo),
	["vacaciones", "vacaciones", "vacaciones", "vacaciones"]);
ok("regreso: 7 de enero y 5 de abril con clase", [C.esDiaDeClase("2027-01-07"), C.esDiaDeClase("2027-04-05")], [true, true]);
ok("fase intensiva de CTE y recesos: sin clase y fuera del periodo", [C.tipoDeDia("2026-08-26").tipo, C.tipoDeDia("2027-07-15").tipo, C.esDiaDeClase("2026-08-26")], ["cte", "vacaciones", false]);
ok("fuera de cualquier ciclo cargado", [C.tipoDeDia("2028-03-01").tipo, C.esDiaDeClase("2028-03-01")], ["fuera_ciclo", false]);
ok("fin de semana", [C.tipoDeDia("2026-09-26").tipo, C.esDiaDeClase("2026-09-26")], ["fin_semana", false]);
ok("fuente: DOF 15-07-2026 con su enlace", [C.CICLOS[0].fuente.fecha, /dof\.gob\.mx\/nota_detalle\.php\?codigo=5793645/.test(C.CICLOS[0].fuente.url)], ["2026-07-15", true]);
ok("texto de la fuente", C.textoFuente(), "Fuente: Calendario escolar SEP 2026-2027 (DOF 15-07-2026). Tu entidad o escuela puede ajustarlo.");
ok("todos los tipos de los datos existen en TIPOS", C.CICLOS.every((c) => c.sinClase.concat(c.conClase).every((r) => C.TIPOS[r.tipo] && C.TIPOS[r.tipo].clase === c.conClase.includes(r))), true);
ok("meses del ciclo: agosto 2026 a julio 2027", [C.mesesDelCiclo("2026-2027").length, C.mesesDelCiclo("2026-2027")[0], C.mesesDelCiclo("2026-2027")[11]], [12, "2026-08", "2027-07"]);
ok("días de clase por mes (septiembre 20, octubre 21, diciembre 14)",
	["2026-09", "2026-10", "2026-12"].map((m) => { const d = C.diasDelMes(m); return C.diasDeClase(d[0], d[d.length - 1]).length; }), [20, 21, 14]);
ok("próximo día sin clase después de hoy: 30 de octubre (CTE)", C.proximoSinClase("2026-09-25").fecha, "2026-10-30");
ok("próximo desde un fin de semana antes del ciclo: el primero del periodo", C.proximoSinClase("2026-08-29").fecha, "2026-09-16");
ok("próximo incluyendo hoy", C.proximoSinClase("2026-09-25", null, true).fecha, "2026-09-25");
ok("fechas en español", [C.fechaLarga("2026-09-25"), C.fechaCorta("2026-10-05"), C.nombreMes("2027-01")], ["viernes 25 de septiembre de 2026", "Lun 5", "Enero 2027"]);
ok("un ciclo nuevo es solo datos (CICLOS es un arreglo con las mismas claves)",
	Object.keys(C.CICLOS[0]).sort(), ["ciclo", "conClase", "desde", "diasEfectivos", "etiquetaFuente", "fin", "fuente", "hasta", "inicio", "nivel", "sinClase"]);

// ── Ajustes del grupo ────────────────────────────────────────────────────────
const ajustes = [
	{ fecha: "2026-10-12", tipo: "festividad_local", motivo: "Fiesta patronal" },   // quita un día de clase
	{ fecha: "2026-10-30", tipo: "con_clase", motivo: "La SEJ movió el CTE" },       // suma un día (era CTE)
	{ fecha: "2026-10-17", tipo: "suspension", motivo: "sábado: no cuenta" },        // fin de semana: se ignora
	{ fecha: "2026-11-02", tipo: "suspension", motivo: "ya era suspensión" },        // no cambia nada
];
ok("con ajustes: -1 +1 = 185 en el ciclo", C.diasDeClase(INI, FIN, ajustes).length, 185);
ok("solo la suspensión propia: 184", C.diasDeClase(INI, FIN, [ajustes[0]]).length, 184);
ok("solo el día con clase: 186", C.diasDeClase(INI, FIN, [ajustes[1]]).length, 186);
ok("el día suspendido queda sin clase y dice su motivo", (() => { const t = C.tipoDeDia("2026-10-12", ajustes); return [t.tipo, t.clase, t.motivo, t.ajuste.tipo, t.oficial.tipo]; })(),
	["propio_sin_clase", false, "Fiesta patronal", "festividad_local", "clase"]);
ok("el CTE con clase en el grupo", (() => { const t = C.tipoDeDia("2026-10-30", ajustes); return [t.tipo, t.clase, t.oficial.tipo]; })(), ["propio_con_clase", true, "cte"]);
ok("un ajuste en sábado o sobre un día que ya no tenía clase se ignora", [C.tipoDeDia("2026-10-17", ajustes).tipo, C.tipoDeDia("2026-11-02", ajustes).tipo], ["fin_semana", "festivo"]);
ok("octubre: 21 - 1 + 1 = 21 días de clase", C.diasDeClase("2026-10-01", "2026-10-31", ajustes).length, 21);
ok("el mapa de ajustes también sirve", C.diasDeClase(INI, FIN, { "2026-10-12": { tipo: "otro" } }).length, 184);
ok("próximo sin clase con ajustes: el 12 de octubre (propio)", C.proximoSinClase("2026-09-25", ajustes).fecha, "2026-10-12");
ok("ajustes permitidos", [
	C.ajustePermitido("2026-10-12", "suspension").ok, C.ajustePermitido("2026-09-25", "suspension").ok,
	C.ajustePermitido("2026-09-25", "con_clase").ok, C.ajustePermitido("2026-10-12", "con_clase").ok,
	C.ajustePermitido("2026-09-26", "suspension").ok, C.ajustePermitido("2026-08-26", "con_clase").ok,
	C.ajustePermitido("2026-10-12", "inventado").ok,
], [true, false, true, false, false, false, false]);
ok("tipos de ajuste = los del CHECK de la tabla", Object.keys(C.AJUSTES).sort(), ["con_clase", "festividad_local", "otro", "suspension"]);

// ── Rol de aseo ──────────────────────────────────────────────────────────────
const alumnos = R.ordenarAlumnos([
	{ id: "c", num_lista: 3, nombre_completo: "Carla" }, { id: "a", num_lista: 1, nombre_completo: "Ana" },
	{ id: "e", num_lista: 5, nombre_completo: "Eva" }, { id: "b", num_lista: 2, nombre_completo: "Beto" },
	{ id: "d", num_lista: 4, nombre_completo: "Dani" },
]);
ok("orden de lista", alumnos.map((a) => a.id), ["a", "b", "c", "d", "e"]);
ok("sin número de lista va al final, luego por nombre", R.ordenarAlumnos([{ id: "x", nombre_completo: "Zoe" }, { id: "y", num_lista: 9, nombre_completo: "Yo" }, { id: "w", nombre_completo: "Ale" }]).map((a) => a.id), ["y", "w", "x"]);

const dias = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
let g = R.generar({ dias, alumnos, porDia: 2, inicioId: "a" });
ok("reparto de 2 en 2 en círculo", g.asignacion.map((d) => d.alumnos.join("")), ["ab", "cd", "ea", "bc"]);
ok("sigue el siguiente de la lista", [g.siguienteId, g.siguienteNum], ["d", 4]);
g = R.generar({ dias, alumnos, porDia: 1, inicioId: "d" });
ok("empieza con quien se elige", g.asignacion.map((d) => d.alumnos.join("")), ["d", "e", "a", "b"]);
ok("más alumnos por día que alumnos: van todos, sin repetir", R.generar({ dias: ["2026-10-01"], alumnos: alumnos.slice(0, 2), porDia: 5 }).asignacion[0].alumnos, ["a", "b"]);
ok("alumnos por día se limita a 1-5", [R.porDiaValido(0), R.porDiaValido(9), R.porDiaValido("3"), R.porDiaValido("x")], [1, 5, 3, 2]);
ok("sin alumnos: días vacíos y sin siguiente", (() => { const x = R.generar({ dias, alumnos: [], porDia: 2 }); return [x.asignacion.length, x.asignacion[0].alumnos, x.siguienteId]; })(), [4, [], null]);
ok("un inicio que no está: empieza el primero", R.generar({ dias: ["2026-10-01"], alumnos, porDia: 1, inicioId: "zz" }).asignacion[0].alumnos, ["a"]);

// Días sin clase saltados: octubre 2026 con la festividad local del 12
const oct = C.diasDelMes("2026-10");
const diasOct = C.diasDeClase(oct[0], oct[oct.length - 1], ajustes);
ok("octubre con ajustes: se salta el 12 (festividad) y se incluye el 30 (con clase)", [diasOct.indexOf("2026-10-12"), diasOct.indexOf("2026-10-30") !== -1, diasOct.length], [-1, true, 21]);
const rolOct = R.generar({ dias: diasOct, alumnos, porDia: 2, inicioId: "a" });
ok("el día sin clase no gasta turno (el 13 sigue al 9)", [rolOct.asignacion.find((d) => d.fecha === "2026-10-09").alumnos, rolOct.asignacion.find((d) => d.fecha === "2026-10-13").alumnos],
	[["c", "d"], ["e", "a"]]);
ok("21 días × 2 = 42 turnos: sigue el tercero (42 mod 5 = 2)", rolOct.siguienteId, "c");

// Continuidad entre meses
const filaOct = { siguiente_alumno_id: rolOct.siguienteId, siguiente_num_lista: rolOct.siguienteNum };
ok("noviembre continúa donde se quedó octubre", R.inicioContinuo(filaOct, alumnos, alumnos), { id: "c", exacto: true });
const sinC = alumnos.filter((a) => a.id !== "c");
ok("si quien seguía se dio de baja: el siguiente activo por número de lista", R.inicioContinuo(filaOct, sinC, alumnos), { id: "d", exacto: false });
ok("si se borró y no hay número guardado: el primero", R.inicioContinuo({ siguiente_alumno_id: "zz" }, alumnos, alumnos), { id: "a", exacto: false });
ok("con el número guardado aunque ya no exista", R.inicioContinuo({ siguiente_alumno_id: "zz", siguiente_num_lista: 5 }, alumnos, []), { id: "e", exacto: false });
ok("el último de la lista se fue: vuelve al primero", R.inicioContinuo({ siguiente_alumno_id: "zz", siguiente_num_lista: 9 }, alumnos, []), { id: "a", exacto: false });
ok("sin rol anterior no hay continuidad", R.inicioContinuo(null, alumnos, alumnos), null);
const nov = C.diasDelMes("2026-11");
const rolNov = R.generar({ dias: C.diasDeClase(nov[0], nov[nov.length - 1]), alumnos, porDia: 2, inicioId: "c" });
ok("noviembre arranca con c y d; salta el 2 y el 13 y el 16", [rolNov.asignacion[0].fecha, rolNov.asignacion[0].alumnos, rolNov.asignacion.some((d) => ["2026-11-02", "2026-11-13", "2026-11-16", "2026-11-27"].includes(d.fecha))],
	["2026-11-03", ["c", "d"], false]);
ok("la rotación seguida de dos meses = la de un solo reparto de 41 días", rolNov.asignacion.map((d) => d.alumnos.join("")).join(),
	R.generar({ dias: diasOct.concat(C.diasDeClase(nov[0], nov[nov.length - 1])), alumnos, porDia: 2, inicioId: "a" }).asignacion.slice(21).map((d) => d.alumnos.join("")).join());

// Cambios a mano y avisos
const cambiado = R.cambiar(rolOct.asignacion, "2026-10-01", 1, "e");
ok("cambio a mano de un alumno de un día", [cambiado[0].alumnos, rolOct.asignacion[0].alumnos], [["a", "e"], ["a", "b"]]);
ok("cambio fuera de rango no hace nada", R.cambiar(rolOct.asignacion, "2026-10-01", 7, "e")[0].alumnos, ["a", "b"]);
ok("calendario cambiado: días que sobran y que faltan", R.diferencias(rolOct.asignacion, C.diasDeClase(oct[0], oct[oct.length - 1])), { sobran: ["2026-10-30"], faltan: ["2026-10-12"] });
ok("asignación de la base validada", R.asignacionValida([{ fecha: "2026-10-01T00:00", alumnos: ["a", 3, null] }, { fecha: 5 }, "x"]), [{ fecha: "2026-10-01", alumnos: ["a"] }]);
ok("asignación que no es arreglo", R.asignacionValida({ a: 1 }), []);

// Filas, semanas, texto
const nombres = { a: { nombre: "Ana", activo: true }, b: { nombre: "Beto", activo: false } };
const filas = R.filasDelMes([{ fecha: "2026-10-01", alumnos: ["a", "b"] }, { fecha: "2026-10-13", alumnos: ["zz"] }], C.diasSinClase(oct[0], oct[oct.length - 1], ajustes), nombres);
ok("filas del mes en orden, con los días sin clase", filas.map((f) => f.fecha + (f.clase ? "" : "*")), ["2026-10-01", "2026-10-12*", "2026-10-13"]);
ok("baja y alumno borrado", [filas[0].alumnos[1].baja, filas[2].alumnos[0].nombre], [true, "Alumno que ya no está en la lista"]);
const semanas = R.porSemanas(filas, C.sumarDias, C.diaSemana);
ok("por semanas (lunes)", semanas.map((s) => s.lunes), ["2026-09-28", "2026-10-12"]);
ok("título de semana entre dos meses", [P.fechaSemana(semanas[0]), P.fechaSemana(semanas[1])], ["Semana del 28 de septiembre al 2 de octubre", "Semana del 12 al 16 de octubre"]);
ok("texto para copiar", R.texto({ mes: "Octubre 2026", escuela: "Esc. Benito Juárez", grupo: "3° A" }, filas, C.fechaCorta),
	"Rol de aseo, Octubre 2026\nEsc. Benito Juárez\nGrupo: 3° A\n\nJue 1: Ana, Beto\nMar 13: Alumno que ya no está en la lista");
ok("texto sin escuela ni días", R.texto({ mes: "Julio 2027" }, [], C.fechaCorta), "Rol de aseo, Julio 2027\n\nEste mes no tiene días de clase.");
ok("nombre del archivo PNG", P.nombreArchivo("2026-10", "3° A Mañana"), "rol-de-aseo-octubre-2026-3-a-manana.png");

// Imagen: diseño con un ctx falso (cada carácter mide 20 px a cualquier tamaño)
const ctxFalso = { font: "", measureText: (t) => ({ width: String(t).length * 20 }) };
const largo = "María Guadalupe Hernández Martínez de la Concepción";
const d1 = R.disenar(ctxFalso, { mes: "Octubre 2026", escuela: "Escuela Primaria Rural Federal Emiliano Zapata", grupo: "Multigrado 1° a 6°",
	semanas: R.porSemanas(R.filasDelMes([{ fecha: "2026-10-01", alumnos: ["x"] }], [], { x: { nombre: largo, activo: true } }), C.sumarDias, C.diaSemana),
	fechaCorta: C.fechaCorta, fechaSemana: P.fechaSemana });
const textos = d1.ops.filter((o) => o.t === "texto");
ok("imagen: 1080 de ancho, nada se sale del margen derecho", textos.every((o) => o.x + ctxFalso.measureText(o.texto).width <= R.IMG.ancho - R.IMG.margen + 1), true);
ok("imagen: el nombre largo se parte en renglones", textos.filter((o) => largo.indexOf(o.texto) !== -1).length > 1, true);
ok("imagen: lleva título, mes, escuela y grupo", ["ROL DE ASEO", "Octubre 2026"].every((t) => textos.some((o) => o.texto === t)) && textos.some((o) => /^Grupo: /.test(o.texto)) && textos.some((o) => /^Escuela/.test(o.texto)), true);
ok("imagen: letra de los nombres de 42 px (legible en el teléfono)", textos.filter((o) => largo.indexOf(o.texto) !== -1).every((o) => / 42px /.test(o.fuente)), true);
const d2 = R.disenar(ctxFalso, { mes: "Octubre 2026", semanas: R.porSemanas(filas, C.sumarDias, C.diaSemana), fechaCorta: C.fechaCorta, fechaSemana: P.fechaSemana });
ok("imagen: vertical (más alta que ancha) con un mes completo", R.disenar(ctxFalso, { mes: "Octubre 2026", semanas: R.porSemanas(R.filasDelMes(rolOct.asignacion, C.diasSinClase(oct[0], oct[oct.length - 1], ajustes), { a: { nombre: "Ana López", activo: true } }), C.sumarDias, C.diaSemana), fechaCorta: C.fechaCorta, fechaSemana: P.fechaSemana }).alto > R.IMG.ancho, true);
ok("imagen: sin escuela ni grupo no pinta renglones vacíos", d2.ops.some((o) => o.t === "texto" && /^Grupo: $/.test(o.texto)), false);

// ── Escape de textos ─────────────────────────────────────────────────────────
const MALO = "<img src=x onerror=alert(1)>'\"&";
const filasMalas = R.filasDelMes([{ fecha: "2026-10-01", alumnos: ["m"] }], [{ fecha: "2026-10-02", motivo: MALO }], { m: { nombre: MALO, activo: true } });
const semMalas = R.porSemanas(filasMalas, C.sumarDias, C.diaSemana);
const htmls = [
	P.htmlRolLista(semMalas, true), P.htmlRolLista(semMalas, false), P.htmlRolCalendario(semMalas),
	P.htmlImpresionRol({ mes: MALO, escuela: MALO, grupo: MALO }, semMalas),
	P.htmlMes("2026-10", [{ fecha: "2026-10-12", tipo: "otro", motivo: MALO }], "2026-10-01"),
	P.htmlImpresionMes({ escuela: MALO, grupo: MALO, ciclo: MALO, fuente: MALO }, "2026-10", [{ fecha: "2026-10-12", tipo: "otro", motivo: MALO }], "2026-10-01"),
];
ok("escape: ningún HTML trae la etiqueta, la comilla simple ni la doble sin escapar",
	htmls.map((h) => [h.indexOf("<img"), /onerror=alert\(1\)>'/.test(h)]), htmls.map(() => [-1, false]));
ok("escape: el nombre aparece escapado", P.htmlRolLista(semMalas, true).indexOf("&lt;img src=x onerror=alert(1)&gt;&#39;&quot;&amp;") !== -1, true);
ok("escape: el motivo propio va escapado en la etiqueta del día", P.htmlMes("2026-10", [{ fecha: "2026-10-12", tipo: "otro", motivo: MALO }], "").indexOf("aria-label='lunes 12 de octubre: &lt;img") !== -1, true);
ok("esc", R.esc("<a href='x'>&\"</a>"), "&lt;a href=&#39;x&#39;&gt;&amp;&quot;&lt;/a&gt;");

// ── HTML del mes ─────────────────────────────────────────────────────────────
const mesHtml = P.htmlMes("2026-09", [], "2026-09-25");
ok("septiembre: empieza en martes (1 hueco), 30 botones", [(mesHtml.match(/<div aria-hidden='true'><\/div>/g) || []).length, (mesHtml.match(/data-fecha=/g) || []).length], [1, 30]);
ok("hoy marcado con aria-current", /data-fecha='2026-09-25' aria-label='viernes 25 de septiembre: Consejo Técnico Escolar, sesión ordinaria 1, sin clase \(hoy\)' aria-current='date'/.test(mesHtml), true);
ok("cada tipo de la leyenda tiene estilo y etiqueta", C.ORDEN_LEYENDA.every((t) => P.ESTILOS[t] && P.ETIQUETA_LEYENDA[t]), true);
ok("los días de 44 px o más", /min-h-\[48px\]/.test(mesHtml), true);

// ── Migración b14 ────────────────────────────────────────────────────────────
const sql = leer("supabase/mi_salon_b14_calendario_2026-09.sql");
const codigo = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
["calendario_ajustes", "roles_aseo"].forEach((t) => {
	ok(t + ": RLS activa y sin anónimo", [new RegExp("alter table public\\." + t + " enable row level security").test(codigo), new RegExp("revoke all on public\\." + t + " from anon").test(codigo)], [true, true]);
	const pol = [...codigo.matchAll(new RegExp("create policy (\\w+) on public\\." + t + "\\s+for (\\w+) to authenticated([\\s\\S]*?);", "g"))];
	ok(t + ": select, insert, update y delete", pol.map((m) => m[2]).sort(), ["delete", "insert", "select", "update"]);
	ok(t + ": todas exigen auth.uid() = maestro_id", pol.every((m) => /\(select auth\.uid\(\)\) = maestro_id/.test(m[3])), true);
	ok(t + ": insert y update exigen un grupo propio", pol.filter((m) => m[2] === "insert" || m[2] === "update").every((m) => /from public\.grupos g where g\.id = grupo_id and g\.maestro_id = \(select auth\.uid\(\)\)/.test(m[3])), true);
	ok(t + ": en cascada con la cuenta y con el grupo", [new RegExp("create table if not exists public\\." + t + "[\\s\\S]*?references auth\\.users \\(id\\) on delete cascade[\\s\\S]*?references public\\.grupos \\(id\\) on delete cascade").test(codigo)], [true]);
});
ok("roles_aseo: los alumnos de inicio y de continuación, propios y del mismo grupo",
	[...codigo.matchAll(/create policy roles_aseo_(insert|update)_propios[\s\S]*?;/g)].every((m) => /a\.id = inicia_alumno_id and a\.grupo_id = roles_aseo\.grupo_id and a\.maestro_id/.test(m[0]) && /a\.id = siguiente_alumno_id and a\.grupo_id = roles_aseo\.grupo_id and a\.maestro_id/.test(m[0])), true);
ok("índices únicos por grupo y fecha / grupo y mes", [/unique index if not exists calendario_ajustes_grupo_fecha_uidx on public\.calendario_ajustes \(grupo_id, fecha\)/.test(codigo), /unique index if not exists roles_aseo_grupo_mes_uidx on public\.roles_aseo \(grupo_id, mes\)/.test(codigo)], [true, true]);
ok("CHECK de tipos = los de la pantalla", /tipo in \('suspension', 'festividad_local', 'otro', 'con_clase'\)/.test(codigo), true);
ok("CHECK de 1 a 5 alumnos por día", /por_dia between 1 and 5/.test(codigo), true);
ok("motivo de hasta " + C.MOTIVO_MAX + " caracteres", new RegExp("char_length\\(motivo\\) <= " + C.MOTIVO_MAX).test(codigo), true);
ok("delete_own_account borra las dos tablas", [/delete from public\.roles_aseo where maestro_id = v;/.test(codigo), /delete from public\.calendario_ajustes where maestro_id = v;/.test(codigo)], [true, true]);
ok("delete_own_account conserva lo de b10 y las incidencias (con guarda)", ["evaluacion_formativa", "calificaciones", "registro_diario", "boleta_trimestral", "evaluacion_diagnostica", "tareas", "productos_sesion", "dias_no_habiles_extra", "maestro_ajustes", "zz_deprecated_diagnosticos"].every((t) => new RegExp("delete from public\\." + t + " where maestro_id = v;").test(codigo)) &&
	/to_regclass\('public\.incidencias'\) is not null/.test(codigo) && /security definer/.test(codigo) && /set search_path = ''/.test(codigo), true);
ok("aditiva: no borra tablas, columnas ni datos ajenos", /\bdrop\s+(table|column)\b|\btruncate\b|alter table [\w.]+ drop/i.test(codigo), false);

// ── Página ───────────────────────────────────────────────────────────────────
const html = leer("calendario.html");
const head = html.split("</head>")[0];
ok("navegación en el head", /<script src="js\/navbar\.js"><\/script>/.test(head), true);
const orden = ["js/supabase.js", "js/lectura.js", "js/saas-guard.js", "js/secciones.js", "js/bandeja-salida.js", "js/grupo-activo.js", "js/calendario-sep.js", "js/rol-aseo.js", "js/calendario.js"].map((s) => html.indexOf('src="' + s + '"'));
ok("candado y scripts en orden", orden.every((v, i) => v > 0 && (i === 0 || v > orden[i - 1])), true);
ok("pie con la fuente y el enlace al DOF", /Fuente: Calendario escolar SEP 2026-2027 \(DOF 15-07-2026\)\. Tu entidad o escuela puede ajustarlo\./.test(html) && /href="https:\/\/dof\.gob\.mx\/nota_detalle\.php\?codigo=5793645/.test(html), true);
ok("sin librerías externas nuevas (la imagen es Canvas)", (html.match(/<script src="https?:\/\/[^"]+"/g) || []).map((s) => s.replace(/<script src="|"/g, "")), ["https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"]);
ok("/salon/: regla en _redirects", leer("_redirects").indexOf("/salon/calendario.html /salon/calendario 301") !== -1, true);
const N = require("../js/navbar.js");
ok("menú: Calendario en el grupo Grupo, con título", [/<p class="jz-titulo" id="jzMenuG3">Grupo<\/p><ul aria-labelledby="jzMenuG3">[\s\S]*href="mi-grupo\.html"[\s\S]*href="calendario\.html"/.test(N.construir("salon", "calendario")), N.tituloDe("salon", "calendario"), N.activoDe("salon", "calendario")],
	[true, "Calendario", "calendario"]);

// ── Decisiones de Jorge (2026-09-25) ─────────────────────────────────────────
ok("registro de calificaciones: sin clase, «Registro de calificaciones (descarga administrativa)»",
	[C.TIPOS.registro.clase, C.tipoDeDia("2026-11-13").etiqueta, /registro: "Registro de calificaciones \(descarga administrativa\)"/.test(leer("js/calendario.js"))],
	[false, "Registro de calificaciones (descarga administrativa)", true]);
ok("registro de calificaciones: la maestra lo mueve con sus ajustes (con clase el oficial, sin clase otro día)",
	[C.esDiaDeClase("2026-11-13", [{ fecha: "2026-11-13", tipo: "con_clase" }, { fecha: "2026-11-12", tipo: "otro", motivo: "Registro de calificaciones" }]),
		C.esDiaDeClase("2026-11-12", [{ fecha: "2026-11-13", tipo: "con_clase" }, { fecha: "2026-11-12", tipo: "otro" }])], [true, false]);
const sep = leer("js/calendario-sep.js");
ok("la asistencia, las tareas y el trimestre NO se conectan (decisión tomada, ya no «pendiente»)",
	[/decisión PENDIENTE/i.test(sep), /NO se conecta con la asistencia, las tareas ni el trimestre/.test(sep), /veces que la maestra pasó lista/.test(sep)], [false, true, true]);
ok("ningún cálculo lee el calendario (motor, alcance, reportes, Hoy, Inicio)",
	["js/motor-calificacion.js", "js/alcance-hoy.js", "js/reportes.js", "js/hoy.js", "js/dashboard.js", "js/reporte-datos.js"].filter((f) => /CalendarioSEP|calendario_ajustes/.test(leer(f))), []);
ok("rol de aseo opcional: la pestaña lo dice y el panel lo aclara",
	[/id="tabAseo"[^>]*>Rol de aseo \(opcional\)<\/button>/.test(html), /id="aseoOpcional"[^>]*>Opcional: úsalo solo si en tu escuela el aseo del salón se organiza por turnos/.test(html)], [true, true]);
ok("rol de aseo: nada fuera del calendario lo empuja (Inicio, Hoy, barra, avisos)",
	["dashboard.html", "js/dashboard.js", "hoy.html", "js/hoy.js", "js/navbar.js", "js/bandeja-salida.js", "js/section-shell.js"].filter((f) => /aseo/i.test(leer(f))), []);
ok("las confirmaciones de ajustes mencionan el aseo solo si hay roles guardados",
	/function notaAseo\(\) \{\s*return Object\.keys\(roles\)\.length \? " Los roles de aseo ya guardados no cambian solos\." : "";/.test(leer("js/calendario.js")) &&
	(leer("js/calendario.js").match(/Los roles de aseo ya guardados no cambian solos/g) || []).length === 1, true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
