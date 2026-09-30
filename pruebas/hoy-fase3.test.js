/*
	Fase 3 del plan de Fanny (2026-09-29): "Finalizar jornada" y los comentarios del día.

	- AlcanceHoy.faltantesJornada (pura): alumnos sin asistencia, trabajos sin calificar sin contar a quien
	  faltó, tareas sin revisar, pendientes y sesiones sin terminar.
	- El botón de Hoy: guarda lo que está a medio escribir, completa el cierre, espera a que se envíe la cola y,
	  si no se pudo enviar o no hay señal, NO marca el día; escribe en `jornadas` con upsert por grupo y fecha;
	  lectura opcional de la jornada al cargar; Inicio agrega la fila "Jornada".
	- Los comentarios: los renders del Cierre se prueban en pruebas/hoy-fase1.test.js y la cola en
	  pruebas/bandeja-salida.test.js (§14); aquí, el arranque contra una base SIN b25.

	node pruebas/hoy-fase3.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (bien ? "" : " → " + JSON.stringify(real) + " (esperado " + JSON.stringify(esperado) + ")"));
}

const RAIZ = path.join(__dirname, "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const A = require("../js/alcance-hoy.js");
const hoy = leer("js", "hoy.js");
const pagina = leer("hoy.html");
const dash = leer("js", "dashboard.js");

function extraerFuncion(fuente, nombre) {
	const m = fuente.match(new RegExp("\\n\\t(?:async )?function " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
	if (!m) { console.log("FALLA no se encontró la función " + nombre); process.exit(1); }
	return m[0];
}

// ── 1. faltantesJornada (pura) ───────────────────────────────────────────────
const alumnos = [
	{ id: "a1", nombre_completo: "ANA" }, { id: "a2", nombre_completo: "BETO" },
	{ id: "a3", nombre_completo: "CARO" }, { id: "a4", nombre_completo: "DANI" },
];
const asistCompleta = { a1: "presente", a2: "presente", a3: "ausente", a4: "justificada" };
const nada = { alumnos, asistencia: asistCompleta, trabajos: [], tareas: [], pendientes: 0, sesiones: [] };

const f0 = A.faltantesJornada(nada);
ok("todo al día: no falta nada", [f0.completo, f0.total, f0.resumen], [true, 0, { asistencia: 0, trabajos: 0, tareas: 0, pendientes: 0, sesiones: 0 }]);

const f1 = A.faltantesJornada(Object.assign({}, nada, { asistencia: { a1: "presente", a3: "ausente" } }));
ok("asistencia: los alumnos sin marcar, por nombre", [f1.asistencia.n, f1.asistencia.alumnos, f1.completo], [2, ["BETO", "DANI"], false]);

const trabajos = [{ id: "p1", nombre: "Cartel", alumnos: ["a1", "a2", "a3", "a4"] }, { id: "p2", nombre: "Mapa", alumnos: ["a1", "a2"] }];
const calif = (mapa) => (a, p) => !!mapa[a + "|" + p];
const f2 = A.faltantesJornada(Object.assign({}, nada, { trabajos, calificado: calif({ "a1|p1": true }) }));
ok("trabajos: no cuenta a quien faltó (ausente ni justificada), ni lo ya calificado",
	[f2.trabajos.n, f2.trabajos.productos.map((p) => p.nombre + ":" + p.n + ":" + p.alumnos.join("/"))], [3, ["Cartel:1:BETO", "Mapa:2:ANA/BETO"]]);
const f3 = A.faltantesJornada(Object.assign({}, nada, { trabajos, calificado: calif({ "a1|p1": true, "a2|p1": true, "a1|p2": true, "a2|p2": true }) }));
ok("trabajos: todo calificado no deja nada (y sin calificado() no se rompe)", [f3.trabajos.n, f3.completo, A.faltantesJornada(Object.assign({}, nada, { trabajos })).trabajos.n], [0, true, 4]);
const f3b = A.faltantesJornada(Object.assign({}, nada, { trabajos: [{ id: "p1", nombre: "Cartel", alumnos: ["a3"] }], calificado: calif({ "a3|p1": true }) }));
ok("trabajos: quien faltó y ya tiene calificación tampoco cuenta", [f3b.trabajos.n, f3b.completo], [0, true]);

const f4 = A.faltantesJornada(Object.assign({}, nada, { tareas: [{ id: "t1", nombre: "Lectura", alumnos: ["a1", "a2", "a3"] }], calificado: calif({ "a2|t1": true }) }));
ok("tareas: las sin revisar, sin quien faltó", [f4.tareas.n, f4.tareas.productos.map((p) => p.nombre + ":" + p.alumnos.join("/"))], [1, ["Lectura:ANA"]]);

const f5 = A.faltantesJornada(Object.assign({}, nada, { pendientes: 3, sesiones: [{ id: "s1", numero_sesion: 2, titulo: "Cuentos" }] }));
ok("pendientes y sesiones sin terminar", [f5.pendientes.n, f5.sesiones.n, f5.sesiones.lista[0].id, f5.total, f5.completo], [3, 1, "s1", 4, false]);
ok("el total suma todo", A.faltantesJornada({ alumnos, asistencia: {}, trabajos, tareas: [], pendientes: 2, sesiones: [{ id: "s" }], calificado: () => false }).total, 4 + 6 + 2 + 1);
ok("el resumen (lo que se guarda en jornadas.resumen) son solo números",
	Object.values(A.faltantesJornada(Object.assign({}, nada, { asistencia: {}, trabajos, pendientes: 1, sesiones: [{ id: "s" }] })).resumen).every((v) => typeof v === "number"), true);
ok("datos vacíos no rompen", A.faltantesJornada().completo, true);
ok("no modifica lo que recibe", (() => { const s = [{ id: "s" }]; const r = A.faltantesJornada(Object.assign({}, nada, { sesiones: s })); r.sesiones.lista.push({ id: "x" }); return s.length; })(), 1);

// ── 2. El botón de Hoy ───────────────────────────────────────────────────────
ok("hoy.html: la sección 5 con su botón de 44 px, su estado y su aviso de que necesita señal",
	/id="jornada"/.test(pagina) && /id="jornadaBtn"[^>]*min-h-\[44px\]/.test(pagina) && /id="jornadaEstadoTexto"/.test(pagina) && /Necesita señal/.test(pagina), true);
ok("hoy.html: la sección es una zona de captura (en solo lectura se deshabilita)", /<section id="jornada" data-captura-zona/.test(pagina), true);
ok("hoy.html: el estado lleva un ícono SVG en línea y no emojis", /id="jornadaEstado"[\s\S]{0,400}<svg[\s\S]{0,400}<\/svg>/.test(pagina), true);
const fin = extraerFuncion(hoy, "finalizarJornada");
const reg = extraerFuncion(hoy, "registrarJornada");
ok("finalizar: primero guarda lo que está a medio escribir (retros y comentarios)", fin.indexOf("guardarRetrosPendientes()") !== -1 &&
	fin.indexOf("guardarRetrosPendientes()") < fin.indexOf("sinSenal()"), true);
ok("finalizar: sin señal avisa y no llega a marcar (retorna antes de registrar)", /if \(sinSenal\(\)\) \{\s*mensaje\("error", "Sin señal: para finalizar la jornada hace falta señal, y el día no se marcó\.[\s\S]{0,200}return;/.test(fin), true);
ok("finalizar: espera a que se envíe la cola y, si no llegó todo, avisa y NO marca el día",
	/bandeja\.esperarEnvio\(\)/.test(fin) && /if \(envio !== "ok"\) \{[\s\S]{0,900}el día no se marcó[\s\S]{0,700}return;/.test(fin), true);
ok("registrar: completa el cierre antes de esperar el envío, y de nuevo revisa la señal y el envío", reg.indexOf("completarCierre()") !== -1 && reg.indexOf("completarCierre()") < reg.indexOf("esperarEnvio()") &&
	/if \(sinSenal\(\)\) return \{ ok: false/.test(reg) && /if \(envio !== "ok"\)/.test(reg), true);
ok("registrar: upsert por grupo y fecha, con el resumen de lo que faltaba",
	/from\("jornadas"\)\s*\.upsert\(\{ maestro_id: user\.id, grupo_id: grupo\.id, fecha: hoy, resumen: resumen \}, \{ onConflict: "grupo_id,fecha" \}\)/.test(reg) &&
	/Object\.assign\(\{\}, faltantes\.resumen, \{ de_todos_modos: !faltantes\.completo \}\)/.test(reg), true);
ok("registrar: si la escritura falla, no marca la jornada en pantalla (jornadaHoy solo se asigna tras el error)",
	reg.indexOf("if (res.error)") !== -1 && reg.indexOf("if (res.error)") < reg.indexOf("jornadaHoy = "), true);
ok("finalizar: con lo que falta abre un diálogo con «Finalizar de todos modos» y «Volver»", /aceptar: "Finalizar de todos modos"/.test(fin) && /cancelar: "Volver"/.test(fin), true);
ok("el diálogo: enlaces a cada sección (asistencia, sesiones, tareas, pendientes y cada sesión sin terminar)",
	["asistencia", "sesiones", "tareas", "pendientes"].every((a) => new RegExp('"' + a + '", "Ir a').test(hoy)) && /"ses-" \+ s\.id, "Ir a la sesión"/.test(hoy), true);
ok("el diálogo: los enlaces son relativos (#ancla) y miden al menos 44 px", /a\.href = "#" \+ ancla;/.test(hoy) && /a\.className = "inline-flex items-center min-h-\[44px\]/.test(hoy), true);
ok("abrirDialogo acepta el texto del botón de salida (Cancelar por omisión)", /cancelar\.textContent = opciones\.cancelar \|\| "Cancelar";/.test(hoy), true);
ok("sin trabajo pendiente no hay diálogo: registra directo", /if \(faltantes\.completo\) \{[\s\S]{0,300}registrarJornada\(faltantes\)/.test(fin), true);
ok("se puede finalizar de nuevo (el botón cambia) y no bloquea nada: ninguna captura mira jornadaHoy",
	/btn\.textContent = jornadaHoy \? "Finalizar de nuevo" : "Finalizar jornada"/.test(extraerFuncion(hoy, "renderJornada")) &&
	!/if \(jornadaHoy\) return/.test(hoy) && !/if \(jornadaHoy\)/.test(hoy.replace(extraerFuncion(hoy, "renderJornada"), "")), true);
ok("finalizar: lo que faltaba usa las mismas reglas que las tarjetas (alumnosParaCalificar, pendientesDeRevisar, itemsPorFalta)",
	/alumnosParaCalificar\(p\)/.test(extraerFuncion(hoy, "faltantesDeLaJornada")) && /pendientesDeRevisar\(\)/.test(extraerFuncion(hoy, "faltantesDeLaJornada")) && /itemsPorFalta\(\)/.test(extraerFuncion(hoy, "faltantesDeLaJornada")), true);
ok("el arranque pinta la jornada y la lectura es opcional con su razón (sin la tabla, Hoy sigue)",
	/\["jornada", renderJornada\]/.test(hoy) && /lectura-opcional: solo dice "Jornada finalizada a las 13:20"[\s\S]{0,400}from\("jornadas"\)/.test(hoy), true);
ok("Hoy: la hora se muestra como «Jornada finalizada a las 13:20» (24 horas, es-MX)", /"Jornada finalizada a las " \+ cerrada/.test(hoy) && /hour12: false/.test(hoy), true);

// ── 3. Inicio ────────────────────────────────────────────────────────────────
ok("Inicio: fila «Jornada» (finalizada a las… / sin finalizar), con lectura opcional y sin ella si no se puede leer",
	/lectura-opcional: solo la fila "Jornada" de Tu día/.test(dash) && /fila\("Jornada", jornada \? "finalizada a las " \+ horaJornada : "sin finalizar", !!jornada\)/.test(dash) &&
	/jornada === undefined \? ""/.test(dash), true);

// ── 4. Sin emojis y con lenguaje docente ─────────────────────────────────────
const textoNuevo = extraerFuncion(hoy, "finalizarJornada") + extraerFuncion(hoy, "registrarJornada") + extraerFuncion(hoy, "construirFaltantes") + pagina;
ok("sin emojis ni pictogramas en lo nuevo", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u.test(textoNuevo), true);
ok("lenguaje docente: sin «maestra»/«maestro» en lo nuevo", !/maestr[oa]/i.test((extraerFuncion(hoy, "finalizarJornada") + extraerFuncion(hoy, "registrarJornada") + extraerFuncion(hoy, "construirFaltantes")).replace(/maestro_id/g, "")), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
