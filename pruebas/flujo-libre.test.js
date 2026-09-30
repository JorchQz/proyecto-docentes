/*
	Flujo libre y asignación por alumno (decisiones de Jorge del 2026-09-26, fase 2 para Fanny).

	1. Regla única de "¿Para quién?" (js/alcance-hoy.js: asignadoA / recibeProducto): el alumno
	   recibe un producto si (su grado está en sus grados y no está excluido) o está incluido, y
	   además cuenta el alta tarde. La usan Hoy, Inicio, Tareas, el motor y Qué le falta (sin
	   copias propias). El motor la aplica de verdad (alumno incluido de otro grado, excluido).
	   ProductosHoy.planAsignacion / filasDeEdicion / resumenPara. SQL: alumno_recibe_producto,
	   la tabla con RLS y delete_own_account (mi_salon_b17).
	2. CalendarioSEP.siguienteDiaDeClase (CTE, festivos, vacaciones, registro de calificaciones,
	   ajustes del grupo, fin de ciclo y fuera de ciclo) y AlcanceHoy.venceTarea con el calendario.
	3. Actividad en clase "Incompleta": marcar, pendiente, "Lo completó" o "Sigue incompleta", su
	   valor en el motor (0.5 pendiente o definitiva; el nivel que logró al completarla) y la
	   frase de "Qué le falta" ("se revisa el …").
	4. Actividades sueltas (contenedor tipo 'sueltas') y "Pasar a un proyecto" (destinos y SQL).
	5. Arreglos del revisor R25a: "Quitar" revisa otra vez antes de escribir y la base lo rechaza
	   con calificaciones; "Duplicar" con candado; aviso manejado sin console.error; /\s/ en Mi grupo.

	Con 3cb15b8 falla (no existen la regla, el calendario conectado, la incompleta ni las sueltas).
	node pruebas/flujo-libre.test.js
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
function leer(f) { return fs.readFileSync(path.join(__dirname, "..", f), "utf8"); }
function intentar(nombre, fn) {
	try { fn(); } catch (e) { fallos++; console.log("FALLA " + nombre + " → excepción: " + (e && e.message)); }
}

global.window = {};
require("../js/campos-formativos.js");
const C = require("../js/calendario-sep.js");
const A = require("../js/alcance-hoy.js");
window.AlcanceHoy = A;
const P = require("../js/productos-hoy.js");
const M = require("../js/motor-calificacion.js");
const Q = require("../js/que-le-falta.js");
let PA = null;
try { PA = require("../js/pasar-a-proyecto.js"); } catch (e) { /* 3cb15b8: no existe */ }
const SQL = (function () { try { return leer("supabase/mi_salon_b17_flujo_libre_2026-09.sql"); } catch (e) { return ""; } })();

// ── 1. Regla única ───────────────────────────────────────────────────────────
intentar("regla única", function () {
	const ana3 = { id: "ana", grado: 3 }, beto3 = { id: "beto", grado: 3 }, caro4 = { id: "caro", grado: 4 }, dani5 = { id: "dani", grado: 5 };
	const prod = { id: "p", grados: ["3", "4"] };
	const idx = A.indiceAsignaciones([
		{ producto_sesion_id: "p", alumno_id: "beto", modo: "excluir" },
		{ producto_sesion_id: "p", alumno_id: "dani", modo: "incluir" },
	]);
	ok("sus grados reciben; el excluido no; el incluido de otro grado sí",
		[ana3, beto3, caro4, dani5].map((a) => A.asignadoA(a, prod, idx)), [true, false, true, true]);
	ok("sin filas: solo sus grados (como antes)", [ana3, dani5].map((a) => A.asignadoA(a, prod, {})), [true, false]);
	ok("grados de texto contra grado número", A.asignadoA({ id: "x", grado: 4 }, { id: "q", grados: ["4"] }, {}), true);
	// Alta tarde: también a los incluidos
	const tarde = { id: "dani", grado: 5, alta: "2026-09-24" };
	ok("el incluido de alta tarde: no recibe lo de antes de su alta", A.recibeProducto(tarde, Object.assign({ fecha_entrega: null }, prod), idx, "2026-09-10", null), false);
	ok("…y sí lo del día de su alta", A.recibeProducto(tarde, prod, idx, "2026-09-24", null), true);
	ok("«trabaja con 2°»: incluido de otro grado", A.trabajaCon({ id: "e", grado: 3 }, { id: "p2", grados: ["2"] }, { p2: { e: "incluir" } }), "2°");
	ok("sin «trabaja con» para uno de su grado o sin grados", [A.trabajaCon(ana3, prod, idx), A.trabajaCon({ id: "e", grado: 3 }, { id: "p3", grados: [] }, { p3: { e: "incluir" } })], ["", ""]);

	// Una sola regla: nadie tiene su propia copia del filtro por grado
	const fuentes = { "js/hoy.js": "alumnosDeProducto", "js/tareas.js": "alumnosDe", "js/dashboard.js": "alumnosDe" };
	Object.keys(fuentes).forEach(function (f) {
		const s = leer(f);
		ok(f + ": usa AlcanceHoy.recibeProducto", /AlcanceHoy\.recibeProducto\(/.test(s), true);
	});
	ok("motor: misProductos pasa por la regla única", /var misProductos = productos\.filter\(function \(p\) \{\s*return recibe\(a, p, asignaciones/.test(leer("js/motor-calificacion.js")) &&
		/A\.recibeProducto\(alumno, p, asignaciones/.test(leer("js/motor-calificacion.js")), true);
	ok("motor, Hoy, Tareas e Inicio leen producto_sesion_alumnos", ["js/motor-calificacion.js", "js/hoy.js", "js/tareas.js", "js/dashboard.js"].filter((f) => !/from\("producto_sesion_alumnos"\)/.test(leer(f))), []);
	ok("Qué le falta no filtra por su cuenta: usa los productos del motor", /from\("productos_sesion"\)/.test(leer("js/que-le-falta.js")), false);
});

// ── planAsignacion / filasDeEdicion / resumenPara ────────────────────────────
intentar("¿Para quién?", function () {
	const al = [
		{ id: "a1", grado: 3, nombre_completo: "A1" }, { id: "a2", grado: 3, nombre_completo: "A2" }, { id: "a3", grado: 3, nombre_completo: "A3" },
		{ id: "b1", grado: 4, nombre_completo: "B1" }, { id: "b2", grado: 4, nombre_completo: "B2" },
		{ id: "c1", grado: 5, nombre_completo: "C1" },
	];
	const g = [3, 4, 5];
	ok("todo el grupo: sus grados, sin filas", P.planAsignacion({ modo: "grupo", gradosGrupo: g, alumnos: al }).grados, ["3", "4", "5"]);
	ok("por grado", P.planAsignacion({ modo: "grados", gradosGrupo: g, gradosElegidos: [4], alumnos: al }).grados, ["4"]);
	ok("por grado sin elegir: aviso", P.planAsignacion({ modo: "grados", gradosGrupo: g, gradosElegidos: [], alumnos: al }).foco, "grados");
	const dos3con2 = P.planAsignacion({ modo: "alumnos", gradosGrupo: g, alumnos: al, elegidos: ["a1", "a2"], nivel: "2" });
	ok("dos de 3° que trabajan con 2°: grado 2 e incluidos", [dos3con2.grados, dos3con2.filas, dos3con2.gradosPda], [["2"], [{ alumno_id: "a1", modo: "incluir" }, { alumno_id: "a2", modo: "incluir" }], [2, 3]]);
	const solo2 = P.planAsignacion({ modo: "alumnos", gradosGrupo: g, alumnos: al, elegidos: ["a1", "b1"] });
	ok("dos alumnos específicos: sin grados, incluidos uno por uno", [solo2.grados, solo2.filas.map((f) => f.alumno_id + ":" + f.modo)], [[], ["a1:incluir", "b1:incluir"]]);
	const todo5 = P.planAsignacion({ modo: "alumnos", gradosGrupo: g, alumnos: al, elegidos: ["c1"] });
	ok("todos los de un grado: va el grado (sin filas)", [todo5.grados, todo5.filas], [["5"], []]);
	const sinUno = P.planAsignacion({ modo: "alumnos", gradosGrupo: g, alumnos: al, elegidos: ["a1", "a2", "b1", "b2", "c1"] });
	ok("todos menos uno: sus grados y ese excluido", [sinUno.grados, sinUno.filas], [["3", "4", "5"], [{ alumno_id: "a3", modo: "excluir" }]]);
	ok("nadie marcado: aviso", P.planAsignacion({ modo: "alumnos", gradosGrupo: g, alumnos: al, elegidos: [] }).foco, "alumnos");
	ok("editar: quitar a uno de su grado → excluir; agregar a uno de otro grado → incluir",
		P.filasDeEdicion(["3"], al, { a1: true, a2: true, b1: true }), [{ alumno_id: "a3", modo: "excluir" }, { alumno_id: "b1", modo: "incluir" }]);
	ok("rótulos", [
		P.resumenPara({ grados: ["3", "4"] }, {}, al),
		P.resumenPara({ grados: ["3", "4", "5"] }, { a3: "excluir" }, al),
		P.resumenPara({ grados: [] }, { b1: "incluir", c1: "incluir" }, al),
		P.resumenPara({ grados: ["2"] }, { a1: "incluir", a2: "incluir" }, al),
	], ["3° y 4°", "3°, 4° y 5° (sin 1 alumno)", "2 alumnos de 4° y 5°", "2° + 2 alumnos de 3°"]);
	ok("validarNuevo: sin grados pero con incluidos sí", P.validarNuevo({ nombre: "x", tipo: "trabajo", campo: "LEN", grados: [], incluidos: 2 }, { hoy: "2026-09-28" }).ok, true);
	ok("validarSuelta: el día no puede ser anterior a hoy", P.validarSuelta({ nombre: "x", tipo: "trabajo", campo: "LEN", grados: [3], fecha: "2026-09-25" }, { hoy: "2026-09-28" }).foco, "fechaSuelta");
	ok("validarSuelta: una tarea suelta se deja hoy", P.validarSuelta({ nombre: "x", tipo: "tarea", campo: "LEN", grados: [3], fechaRevision: "2026-09-29" }, { hoy: "2026-09-28" }).fecha, "2026-09-28");
});

// ── 2. Calendario: siguiente día de clase y vencimiento ──────────────────────
intentar("calendario", function () {
	ok("CTE: del jueves 24 de sep se salta el viernes 25 (CTE) → lunes 28", C.siguienteDiaDeClase("2026-09-24"), "2026-09-28");
	ok("festivo: del 15 de sep se salta el 16 → 17", C.siguienteDiaDeClase("2026-09-15"), "2026-09-17");
	ok("CTE y festivo seguidos: del 29 de oct (30 CTE, 2 nov festivo) → 3 de nov", C.siguienteDiaDeClase("2026-10-29"), "2026-11-03");
	ok("registro de calificaciones y festivo: del 12 de nov → 17", C.siguienteDiaDeClase("2026-11-12"), "2026-11-17");
	ok("vacaciones de invierno: del 18 de dic → 7 de ene", C.siguienteDiaDeClase("2026-12-18"), "2027-01-07");
	ok("ajuste del grupo sin clase: suspensión el 28 → 29", C.siguienteDiaDeClase("2026-09-24", [{ fecha: "2026-09-28", tipo: "suspension" }]), "2026-09-29");
	ok("ajuste del grupo con clase en el CTE: → 25", C.siguienteDiaDeClase("2026-09-24", [{ fecha: "2026-09-25", tipo: "con_clase" }]), "2026-09-25");
	ok("fin de ciclo: del último día (9 de jul de 2027) → primer lunes a viernes fuera de lo cargado", C.siguienteDiaDeClase("2027-07-09"), "2027-08-02");
	ok("fuera de todo ciclo: el siguiente lunes a viernes", C.siguienteDiaDeClase("2025-05-02"), "2025-05-05");
	ok("antes del inicio (receso): el primer día de clases", C.siguienteDiaDeClase("2026-08-20"), "2026-08-31");
	ok("fecha no válida: null", C.siguienteDiaDeClase("x"), null);
	ok("venceTarea: la fecha de entrega manda", A.venceTarea("2026-10-01", "2026-09-24"), "2026-10-01");
	ok("venceTarea: sin sesión con fecha, null", A.venceTarea(null, null), null);
	ok("venceTarea: después de un festivo (dejada el 15 de sep) → 17", A.venceTarea(null, "2026-09-15"), "2026-09-17");
	ok("venceTarea: con los ajustes del grupo", A.venceTarea(null, "2026-09-24", [{ fecha: "2026-09-28", tipo: "otro" }]), "2026-09-29");
	ok("Hoy, Inicio, Tareas y Qué le falta pasan los ajustes del grupo", [
		/venceTarea\(t\.fecha_entrega, t\.sesion && t\.sesion\.fecha, ajustesCal\)/.test(leer("js/hoy.js")),
		/venceTarea\(p\.fecha_entrega, fechaSesion\[p\.sesion_id\], ajustes\)/.test(leer("js/dashboard.js")),
		/venceTarea\(t\.fecha_entrega, s\.fecha, ajustes\)/.test(leer("js/tareas.js")),
		/venceTarea\(p\.fecha_entrega, s\.fecha \|\| null, e\.calendario \|\| \[\]\)/.test(leer("js/que-le-falta.js")),
	], [true, true, true, true]);
	ok("las páginas cargan el calendario antes del alcance", ["hoy.html", "dashboard.html", "tareas.html", "reporte-alumno.html", "reportes.html", "planeacion.html"].filter(function (f) {
		const h = leer(f), c = h.indexOf('src="js/calendario-sep.js"'), a = h.indexOf('src="js/alcance-hoy.js"');
		return !(c > 0 && c < a);
	}), []);
});

// ── 3. Incompleta → siguiente día de clase ───────────────────────────────────
intentar("incompleta", function () {
	const marcar = A.cambiosIncompleta("marcar", { hoy: "2026-09-24", ajustes: [] });
	ok("marcar Incompleta el jueves 24: se revisa el lunes 28 (el 25 es CTE)", marcar, { estado_entrega: "incompleto", nivel: null, estado_en_clase: "incompleta", revisar_en: "2026-09-28", completado_en: null });
	ok("pendiente: toca revisarla desde su día, no antes", [A.tocaRevisar(marcar, "2026-09-25"), A.tocaRevisar(marcar, "2026-09-28"), A.tocaRevisar(marcar, "2026-10-02")], [false, true, true]);
	const completa = Object.assign({}, marcar, A.cambiosIncompleta("completo", { hoy: "2026-09-28", nivel: "en_proceso" }));
	const sigue = Object.assign({}, marcar, A.cambiosIncompleta("sigue", { hoy: "2026-09-28" }));
	ok("revisada ya no toca (pasa una sola vez)", [A.tocaRevisar(completa, "2026-09-29"), A.tocaRevisar(sigue, "2026-09-29")], [false, false]);
	ok("valor en el motor: pendiente 0.5, completada con su nivel, sigue incompleta 0.5",
		[M.puntajeProducto(marcar), M.puntajeProducto(completa), M.puntajeProducto(sigue)], [0.5, 0.7, 0.5]);
	ok("deshacer la revisión: vuelve a pendiente", A.cambiosIncompleta("pendiente", {}), { estado_entrega: "incompleto", nivel: null, estado_en_clase: "incompleta", completado_en: null });
	// El motor entero: dos trabajos, uno incompleto pendiente y otro completado
	const campos = ["LEN"];
	const r = M.calcularPorcentajes({
		campos: campos, productos: [{ id: "x", tipo: "trabajo", campo: "LEN" }, { id: "y", tipo: "trabajo", campo: "LEN" }],
		calificaciones: { x: marcar, y: completa }, registros: [], camposPorFecha: {}, examenPorCampo: {}, legacy: [],
		pesos: { tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 33 },
	});
	ok("motor: trabajos 0.5 + 0.7 de 2", [r.LEN.rubros.trabajos.obtenido, r.LEN.rubros.trabajos.maximo], [1.2, 2]);
	// Qué le falta
	const res = Q.calcular({
		alumno: { id: "a", grado: 3 }, porCampo: { LEN: { porcentaje: 60 } }, hoy: "2026-09-28",
		detalle: {
			sesiones: [{ id: "s", fecha: "2026-09-24", campo_formativo: "Lenguajes", numero_sesion: 2 }, { id: "sx", fecha: "2026-09-24", campo_formativo: "Lenguajes", numero_sesion: 1, suelta: true }],
			productos: [{ id: "x", sesion_id: "s", tipo: "trabajo", campo: "LEN", nombre: "Cartel" }, { id: "y", sesion_id: "sx", tipo: "trabajo", campo: "LEN", nombre: "Lectura" }],
			calificaciones: { x: marcar, y: sigue }, alta: null,
		},
	});
	const frases = Q.frases(res.campos.LEN).map((f) => f.texto);
	ok("Qué le falta: pendiente → «se revisa el 28 de septiembre»", frases.some((t) => /Completar «Cartel» \(sesión 2\): quedó incompleta en clase; se revisa el 28 de septiembre\./.test(t)), true);
	ok("Qué le falta: sigue incompleta → «Completar», y una suelta se nombra por su fecha", frases.some((t) => /Completar «Lectura» \(actividad del 24 de septiembre\): la entrega quedó incompleta\./.test(t)), true);
	// Hoy: el botón y el bloque
	const h = leer("js/hoy.js"), hh = leer("hoy.html");
	ok("Hoy: botón Incompleta en las actividades en clase y bloque «Pendientes de la clase anterior»",
		[/chip\("Incompleta", cal\.estado_entrega === "incompleto"/.test(h), /data-incompleta='1'/.test(h), /id="pendientes"/.test(hh) && /Pendientes de la clase anterior/.test(hh),
			// (b20: con historico, una actividad de un día anterior al de su creación no pasa a la siguiente clase)
			/cambiosIncompleta\("marcar", \{ hoy: hoy, ajustes: ajustesCal,[\s\S]{0,200}historico: window\.AlcanceHoy\.esHistorico\(producto/.test(h)], [true, true, true, true]);
	ok("Hoy: quien faltó hoy sigue pendiente", /if \(falto && pendiente\)/.test(h) && /Faltó hoy: queda pendiente para su siguiente clase\./.test(h), true);
	ok("Tareas: estado «Por completar» e Inicio: su conteo", [/por_completar: "<span/.test(leer("js/tareas.js")), /value="por_completar">Por completar</.test(leer("tareas.html")),
		/Pendientes de la clase anterior/.test(leer("js/dashboard.js"))], [true, true, true]);
	ok("la cola (bandeja) lleva las columnas nuevas en el grupo del semáforo",
		/\["captura_semaforo", \["estado_entrega", "nivel", "revisar_en", "estado_en_clase", "completado_en"\]\]/.test(leer("js/bandeja-salida.js")), true);
	ok("SQL: columnas aditivas, CHECK y marca del semáforo con ellas", [
		/add column if not exists revisar_en date/.test(SQL), /add column if not exists estado_en_clase text/.test(SQL), /add column if not exists completado_en date/.test(SQL),
		/estado_en_clase in \('incompleta', 'completada', 'sigue_incompleta'\)/.test(SQL),
		/or new\.revisar_en is distinct from old\.revisar_en or new\.estado_en_clase is distinct from old\.estado_en_clase/.test(SQL),
	], [true, true, true, true, true]);
});

// ── 4. Sueltas y "Pasar a un proyecto" ───────────────────────────────────────
intentar("sueltas", function () {
	ok("esSueltas", [A.esSueltas({ tipo: "sueltas" }), A.esSueltas({ tipo: "proyecto" }), A.esSueltas(null)], [true, false, false]);
	ok("pasar-a-proyecto.js existe", !!PA, true);
	if (PA) {
		const proys = [
			{ id: "s", tipo: "sueltas", trimestre: 1, estado: "completado", titulo: "Actividades del trimestre" },
			{ id: "b", tipo: "proyecto", trimestre: 1, estado: "borrador", titulo: "B" },
			{ id: "a", tipo: "proyecto", trimestre: 1, estado: "activo", titulo: "Z activo" },
			{ id: "t2", tipo: "proyecto", trimestre: 2, estado: "activo", titulo: "De otro trimestre" },
			{ id: "vacio", tipo: "proyecto", trimestre: 1, estado: "activo", titulo: "Sin sesiones" },
		];
		const ses = [{ id: "1", proyecto_id: "s", numero_sesion: 1 }, { id: "2", proyecto_id: "b", numero_sesion: 2 }, { id: "3", proyecto_id: "b", numero_sesion: 1 },
			{ id: "4", proyecto_id: "a", numero_sesion: 1 }, { id: "5", proyecto_id: "t2", numero_sesion: 1 }];
		const d = PA.destinos(proys, ses, 1);
		ok("destinos: sin el contenedor ni otro trimestre ni proyectos sin sesiones; activos primero; sesiones en orden",
			d.map((g) => g.proyecto.id + ":" + g.sesiones.map((s) => s.numero_sesion).join(",")), ["a:1", "b:1,2"]);
		ok("etiqueta de sesión", PA.etiquetaSesion({ numero_sesion: 3, campo_formativo: "Lenguajes", fecha: "2026-09-25" }), "Sesión 3 · Lenguajes · 25 sep");
	}
	ok("SQL: contenedor por grupo y trimestre, sesión por fecha y campo, una transacción", [
		/add column if not exists tipo text not null default 'proyecto'/.test(SQL),
		/create unique index if not exists proyectos_sueltas_grupo_trimestre_uidx\s+on public\.proyectos \(grupo_id, trimestre\) where tipo = 'sueltas'/.test(SQL),
		/create or replace function public\.agregar_actividad_suelta\(/.test(SQL) && /'Actividades del trimestre', 'sueltas', 'completado'/.test(SQL),
		/where proyecto_id = v_proy and fecha = p_fecha and campo_formativo = v_campo/.test(SQL),
	], [true, true, true, true]);
	ok("SQL: pasar a un proyecto solo desde sueltas, al mismo grupo y trimestre, con calificaciones y PDA", [
		/raise exception 'Solo se pasan a un proyecto las actividades sueltas'/.test(SQL),
		/v_p_new\.trimestre is distinct from v_p_old\.trimestre/.test(SQL),
		/update public\.calificaciones set sesion_id = p_sesion, proyecto_id = v_p_new\.id/.test(SQL),
		/perform public\.recalcular_evidencia_pda\(c\.alumno_id, l\.id, auth\.uid\(\)\)/.test(SQL),
	], [true, true, true, true]);
	ok("Proyectos, Actividades y Crear proyecto no lo tratan como proyecto", [
		/todosLosProyectos = todos\.filter\(function \(p\) \{ return !window\.AlcanceHoy\.esSueltas\(p\); \}\)/.test(leer("js/planeacion.js")),
		/s\.proyectos\.tipo === "sueltas"/.test(leer("js/actividades.js")),
		/proyecto\.tipo === 'sueltas'/.test(leer("js/crear_proyecto.js")),
	], [true, true, true]);
	ok("«Trabajar hoy» y las tarjetas de Inicio: solo proyectos activos (el contenedor es 'completado')",
		/p && p\.estado === "activo"/.test(leer("js/productos-hoy.js")) && /\.eq\("estado", "activo"\)/.test(leer("js/dashboard.js")), true);
	// Fase 4 (2026-09-29): "+ Actividad o tarea" (dentro o fuera del proyecto) reemplaza a "Actividad suelta"; Inicio abre
	// el diálogo (?nueva=1) y Proyectos, fuera del proyecto (?nueva=suelta). Hoy acepta las dos
	ok("Hoy, Inicio y Proyectos ofrecen «+ Actividad o tarea» (fuera del proyecto es la suelta)", [
		/id="btnActividad"[^>]*>[\s\S]{0,400}Actividad o tarea<\/button>/.test(leer("hoy.html")) && !/btnSuelta/.test(leer("hoy.html")),
		/hoy\.html\?nueva=1'[^>]*>[\s\S]{0,400}Actividad o tarea<\/a>/.test(leer("js/dashboard.js")),
		/hoy\.html\?nueva=suelta/.test(leer("planeacion.html")),
		/if \(nueva !== "suelta" && nueva !== "1"\) return;/.test(leer("js/hoy.js")) && /agregarActividad\(\{ modo: nueva === "suelta" \? "fuera" : null, origen: btnActividad \}\)/.test(leer("js/hoy.js")),
	], [true, true, true, true]);
	ok("SQL: la tabla de asignación con RLS y delete_own_account completo", [
		/create table if not exists public\.producto_sesion_alumnos/.test(SQL),
		/alter table public\.producto_sesion_alumnos enable row level security/.test(SQL),
		/create or replace function public\.alumno_recibe_producto/.test(SQL),
		["producto_sesion_alumnos", "incidencia_alumnos", "incidencias", "roles_aseo", "calendario_ajustes", "listas_valores", "listas_columnas", "listas_grupo"]
			.every((t) => new RegExp("delete from public\\." + t + " where maestro_id").test(SQL)) && /delete from public\.interes_secciones where usuario_id/.test(SQL),
	], [true, true, true, true]);
	ok("SQL aditiva: no borra tablas ni columnas", /drop table|drop column|truncate/i.test(SQL), false);
});

// ── 5. Arreglos del revisor R25a ─────────────────────────────────────────────
intentar("R25a", function () {
	const h = leer("js/hoy.js");
	const iUpd = h.indexOf('update({ activo: false })');
	const iRevision = h.lastIndexOf("calificadasEnBase()", iUpd);
	ok("Quitar: vuelve a revisar justo antes del UPDATE y avisa «Mientras decidías…»", [iRevision > h.indexOf("alAceptar: async function (form, avisar) {\n\t\t\t\tif (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }\n\t\t\t\t// Se vuelve"), iRevision < iUpd, /Mientras decidías, se calificó/.test(h), /producto_con_calificaciones/.test(h)], [true, true, true, true]);
	ok("Quitar: la base lo rechaza con calificaciones (trigger BEFORE UPDATE OF activo)", [
		/create trigger productos_sesion_no_quitar_calificado\s+before update of activo on public\.productos_sesion/.test(SQL),
		/raise exception 'Mientras decidías, se calificó este producto; no se quitó\.'\s+using errcode = 'P0001', hint = 'producto_con_calificaciones'/.test(SQL),
	], [true, true]);
	const pl = leer("js/planeacion.js");
	ok("Duplicar: candado de «en curso»", /if \(duplicandoEnCurso\) return;/.test(pl) && /finally \{\s*duplicandoEnCurso = false;/.test(pl), true);
	ok("Crear proyecto: el aviso manejado no sale como console.error", /if \(err && err\.humano\) console\.info\('Guardar:', err\.message\);\s*else console\.error\('Error al guardar:', err\);/.test(leer("js/crear_proyecto.js")), true);
	ok("Crear proyecto: una sesión que se trabajó a media escritura regresa su campo (consistente con sus productos)",
		/for \(const id of \(resumen\.omitidas \|\| \[\]\)\)/.test(leer("js/crear_proyecto.js")) && /if \(!\(k in \(e\.texto \|\| \{\}\)\) && k in e\.actual\) vuelta\[k\] = e\.actual\[k\];/.test(leer("js/crear_proyecto.js")), true);
	ok("Mi grupo: un espacio es /\\s/ (no la letra s)", /!allowSpaces && \/\\s\/\.test\(text\)/.test(leer("js/mi-grupo.js")), true);
});

// ── El motor con la asignación, de punta a punta ─────────────────────────────
(async function () {
	const DATOS = {
		maestro_ajustes: [], grupos: [{ id: "g", created_at: "2026-08-01T15:00:00+00:00" }],
		proyectos: [{ id: "proy", tipo: "proyecto" }],
		sesiones: [{ id: "s1", fecha: "2026-09-24", campo_formativo: "Lenguajes" }],
		productos_sesion: [
			{ id: "p2", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["2"], fecha_entrega: null, activo: true },   // dos de 3° trabajan con 2°
			{ id: "p3", sesion_id: "s1", tipo: "trabajo", campo: "LEN", grados: ["3"], fecha_entrega: null, activo: true },   // 3°, sin uno
		],
		producto_sesion_alumnos: [
			{ producto_sesion_id: "p2", alumno_id: "a1", modo: "incluir" },
			{ producto_sesion_id: "p3", alumno_id: "a3", modo: "excluir" },
		],
		calificaciones: [
			{ alumno_id: "a1", producto_sesion_id: "p2", estado_entrega: "entregado", nivel: "logrado" },
			{ alumno_id: "a1", producto_sesion_id: "p3", estado_entrega: "entregado", nivel: "requiere_apoyo" },
		].map((c) => Object.assign({ tipo: "trabajo", proyecto_id: "proy", fecha: "2026-09-24" }, c)),
		registro_diario: [], asistencias: [], examenes: [],
		alumnos: [{ id: "a1", created_at: "2026-08-01T15:00:00+00:00" }, { id: "a2", created_at: "2026-08-01T15:00:00+00:00" }, { id: "a3", created_at: "2026-08-01T15:00:00+00:00" }],
	};
	function consulta(tabla) {
		const q = {
			select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
			range() { return Promise.resolve({ data: DATOS[tabla] || [], error: null }); },
			maybeSingle() { return Promise.resolve({ data: null, error: null }); },
			then(a, b) { return Promise.resolve({ data: DATOS[tabla] || [], error: null }).then(a, b); },
		};
		return q;
	}
	const sb = { from: consulta, rpc(n, args) { return Promise.resolve({ data: args.p_porcentajes.map(() => 8), error: null }); } };
	try {
		const r = await M.cargarYCalcularGrupo(sb, { maestroId: "m", grupoId: "g", trimestre: 1, campos: ["LEN"], detalle: true,
			alumnos: [{ id: "a1", grado: 3 }, { id: "a2", grado: 3 }, { id: "a3", grado: 3 }] });
		const prods = (id) => r.porAlumno[id].detalle.productos.map((p) => p.id).sort();
		ok("motor: el incluido de 3° que trabaja con 2° recibe las dos; los demás de 3° solo la suya; el excluido ninguna",
			[prods("a1"), prods("a2"), prods("a3")], [["p2", "p3"], ["p3"], []]);
		ok("motor: su calificación cuenta con las dos (1 + 0.4 de 2)", [r.porAlumno.a1.porCampo.LEN.rubros.trabajos.obtenido, r.porAlumno.a1.porCampo.LEN.rubros.trabajos.maximo], [1.4, 2]);
	} catch (e) {
		fallos++;
		console.log("FALLA motor con asignación → excepción: " + (e && e.message));
	}
	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
