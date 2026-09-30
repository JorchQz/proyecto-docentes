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
// R36: lo "por falta justificada" solo falta si ya venció su plazo (3 días de clase); dentro del plazo o sin regreso, no
const porFalta = [{ vence: "2026-10-02" }, { vence: "2026-10-05" }, { vence: "2026-10-06" }, { vence: "2026-10-09" }, { vence: null }];
const f5b = A.faltantesJornada(Object.assign({}, nada, { hoy: "2026-10-06", pendientes: 1, porFalta: porFalta }));
ok("por falta justificada: cuentan solo los vencidos (el día que vence todavía está en plazo; sin regreso no cuenta)",
	[f5b.pendientes, f5b.total, f5b.resumen.pendientes], [{ n: 3, clase: 1, vencidos: 2 }, 3, 3]);
ok("por falta justificada: todo en plazo no es pendiente (se puede finalizar sin diálogo)",
	A.faltantesJornada(Object.assign({}, nada, { hoy: "2026-10-06", porFalta: [{ vence: "2026-10-08" }, { vence: null }] })).completo, true);
ok("por falta justificada: sin la fecha de hoy no se cuenta nada como vencido", A.faltantesJornada(Object.assign({}, nada, { porFalta: [{ vence: "2020-01-01" }] })).pendientes.vencidos, 0);
// R36: nombres breves en el diálogo (sin el punto final que daba «mañana., Escribe» y cortados a 60 con «…»)
ok("nombreBreve: quita la puntuación del final", A.nombreBreve("Dibújala para mostrarla mañana.  "), "Dibújala para mostrarla mañana");
ok("nombreBreve: corta a 60 caracteres con «…» y sin espacio antes",
	[A.nombreBreve("Escribe en tu cuaderno la regla del salón que más te gustó (con ayuda de tu familia)"), A.nombreBreve("x".repeat(80)).length, A.nombreBreve("corto", 60), A.nombreBreve(null)],
	["Escribe en tu cuaderno la regla del salón que más te gustó…", 60, "corto", ""]);
const largos = A.faltantesJornada(Object.assign({}, nada, { tareas: [{ id: "t1", nombre: "Platica en casa cuál regla del salón te gustó más y dibújala en tu cuaderno para mostrarla mañana.", alumnos: ["a1"] }, { id: "t2", nombre: "Lectura.", alumnos: ["a2"] }] }));
ok("nombreBreve: conserva el grupo de trabajo del final (dos trabajos por nivel no se ven iguales)",
	[A.nombreBreve("Tarjeta de nombre repasada y decorada; registro de letras conocidas · Morado"), A.nombreBreve("Tarjeta de nombre repasada y decorada; registro de letras conocidas · Naranja").length <= 60],
	["Tarjeta de nombre repasada y decorada; registro de… · Morado", true]);
ok("faltantesJornada: los nombres de los productos salen breves y la lista ya no dice «., »",
	[largos.tareas.productos.map((p) => p.nombre), largos.tareas.productos.map((p) => p.nombre).join(", ").indexOf("., ") === -1],
	[["Platica en casa cuál regla del salón te gustó más y dibújal…", "Lectura"], true]);
// R36: la misma regla de "fila con cierre" en Hoy y en Inicio
ok("tieneCierre: con participación y conducta sí; solo con el comentario (de quien faltó) no",
	[A.tieneCierre({ participacion: 1, conducta: 1, nota: null }), A.tieneCierre({ participacion: 0, conducta: 2 }), A.tieneCierre({ participacion: null, conducta: null, nota: "Faltó" }), A.tieneCierre(null)],
	[true, true, false, false]);
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
ok("finalizar: sin señal avisa y no llega a marcar (retorna antes de registrar)", /if \(sinSenal\(\)\) \{\s*avisoALaVista\("Sin señal: para finalizar la jornada hace falta señal, y el día no se marcó\.[\s\S]{0,200}return;/.test(fin), true);
// R36 F1: lo que el propio botón encola (comentario a medio escribir, relleno 1 y 1) se espera SIEMPRE, sin mirar pendientes()
const colaEspera = extraerFuncion(hoy, "esperarCola");
ok("guardar() devuelve la promesa de encolar y la anota en «encolando» (bandeja.agregar es asíncrono)",
	/var p = bandeja\.agregar\([\s\S]{0,200}encolando\.push\(p\);[\s\S]{0,200}return p;/.test(extraerFuncion(hoy, "guardar")), true);
ok("esperarCola: espera lo que se encola y después SIEMPRE bandeja.esperarEnvio(); si se capturó algo más, vuelve a esperar",
	/await esperarEncolado\(\);\s*var envio = await bandeja\.esperarEnvio\(\);\s*if \(envio !== "ok"\) return envio;\s*if \(!encolando\.length && !bandeja\.pendientes\(\)\) return "ok";/.test(colaEspera) &&
	/return "pendiente";/.test(colaEspera), true);
ok("finalizar: guarda lo escrito, espera la cola completa (sin revisar pendientes()) y si no llegó todo avisa y NO marca el día",
	fin.indexOf("guardarRetrosPendientes()") < fin.indexOf("esperarCola()") && !/bandeja\.pendientes\(\)/.test(fin) &&
	/var envio = await esperarCola\(\);[\s\S]{0,200}if \(envio !== "ok"\) \{ avisoALaVista\(textoSinEnviar\(envio\)\); return; \}/.test(fin), true);
ok("registrar: completa el cierre, espera la cola completa (lo recién encolado incluido) y solo entonces escribe la jornada",
	reg.indexOf("completarCierre()") < reg.indexOf("esperarCola()") && reg.indexOf("esperarCola()") < reg.indexOf('from("jornadas")') && !/bandeja\.pendientes\(\)/.test(reg) &&
	/if \(sinSenal\(\)\) return \{ ok: false/.test(reg) && /if \(envio !== "ok"\) return \{ ok: false, texto: textoSinEnviar\(envio\) \};/.test(reg), true);
// Hallazgo 1 de R36: Terminar sesión y Pasar a un proyecto (ya publicados en la Fase 2) esperan igual, y si algo no se
// envió no siguen (el comportamiento se prueba en pruebas/hoy-jornada-cola.test.js)
const term = extraerFuncion(hoy, "terminarSesion"), pasar = extraerFuncion(hoy, "pasarAProyecto");
ok("Terminar sesión: guarda lo escrito, espera la cola completa (sin pendientes()) y si no llegó todo no termina",
	term.indexOf("guardarRetrosPendientes()") < term.indexOf("esperarCola()") && !/bandeja\.pendientes\(\)/.test(term) &&
	/var envio = await esperarCola\(\);[\s\S]{0,200}if \(envio !== "ok"\) \{[\s\S]{0,500}no se puede terminar la sesión[\s\S]{0,400}return;\s*\}/.test(term) &&
	term.indexOf("esperarCola()") < term.indexOf("abrirModal("), true);
ok("Pasar a un proyecto: guarda lo escrito, espera la cola completa (sin pendientes()) y si no llegó todo no abre el diálogo",
	pasar.indexOf("guardarRetrosPendientes()") < pasar.indexOf("esperarCola()") && !/bandeja\.pendientes\(\)/.test(pasar) &&
	/if \(envio !== "ok"\) \{ avisoALaVista\("Primero hay que enviar lo capturado[^}]*return; \}/.test(pasar) &&
	pasar.indexOf("esperarCola()") < pasar.indexOf("PasarAProyecto.abrir("), true);
// Hallazgos de R36: "Trabajar hoy" y "Quitar de hoy" esperan igual; los avisos de estas acciones quedan a la vista
const fechar = extraerFuncion(hoy, "fecharSesion");
ok("Trabajar hoy / Quitar de hoy: guarda lo escrito, espera la cola completa (sin pendientes()) y si no llegó todo la sesión no cambia",
	fechar.indexOf("guardarRetrosPendientes()") < fechar.indexOf("esperarCola()") && !/bandeja\.pendientes\(\)/.test(fechar) &&
	/var envio = await esperarCola\(\);\s*if \(envio !== "ok"\) \{[\s\S]{0,500}return;\s*\}/.test(fechar) && fechar.indexOf("esperarCola()") < fechar.indexOf('from("sesiones").update'), true);
ok("irAlMensaje: el mismo desplazamiento de «Ver detalle» (margen por la barra fija, foco sin saltar) y «Ver detalle» lo usa",
	/el\.style\.scrollMarginTop = "8rem";[\s\S]{0,120}el\.scrollIntoView\(\{ block: "start", behavior: "smooth" \}\);[\s\S]{0,80}el\.focus\(\{ preventScroll: true \}\)/.test(extraerFuncion(hoy, "irAlMensaje")) &&
	/ver\.addEventListener\("click", function \(\) \{[\s\S]{0,150}irAlMensaje\(\);/.test(hoy), true);
ok("avisoALaVista: muestra el mismo mensaje de error y lleva la página hasta él",
	/mensaje\("error", texto\);\s*irAlMensaje\(\);/.test(extraerFuncion(hoy, "avisoALaVista")), true);
ok("los avisos de error de Terminar, Finalizar, Pasar, Trabajar y Quitar de hoy van con avisoALaVista (ninguno se queda solo arriba)",
	["terminarSesion", "finalizarJornada", "pasarAProyecto", "fecharSesion", "avisoSinSenal"].map((n) => [n, !/mensaje\("error"/.test(extraerFuncion(hoy, n)) && /avisoALaVista\(/.test(extraerFuncion(hoy, n))]),
	["terminarSesion", "finalizarJornada", "pasarAProyecto", "fecharSesion", "avisoSinSenal"].map((n) => [n, true]));
ok("textoSinEnviar: siempre dice que el día no se marcó (o que la sesión no está activa)",
	["red", "servidor", "pendiente", "acceso"].every((e) => /el día no se marcó/.test(new Function(extraerFuncion(hoy, "textoSinEnviar") + "\nreturn textoSinEnviar;")()(e))), true);
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
// R36 F2: el diálogo avisa que finalizar así le pone 1 y 1 a quien no tiene asistencia
const cf = extraerFuncion(hoy, "construirFaltantes");
ok("F2: con asistencia pendiente, el diálogo avisa del 1 y 1 a quien no la tiene (en «tú», singular y plural)",
	/var sinMarca = alumnos\.filter\(function \(a\) \{ return !asistencia\[a\.id\] && !cierreGuardado\(a\.id\); \}\)\.length;/.test(cf) &&
	/"Si finalizas así, en el cierre del día " \+ \(sinMarca === 1 \? "se le pondrá" : "se les pondrá"\)/.test(cf) && /" 1 y 1 de participación y conducta, como si "/.test(cf) &&
	/Si faltó alguien, márcalo antes en Asistencia\./.test(cf) && /aviso\.setAttribute\("data-faltante-aviso", ancla\)/.test(cf), true);
ok("diálogo: pendientes de la clase anterior y por falta vencidos, con su texto; la sesión con el título breve",
	/" pendientes de la clase anterior sin revisar"/.test(cf) && /" por falta justificada con el plazo vencido"/.test(cf) && /window\.AlcanceHoy\.nombreBreve\(s\.titulo, 60\)/.test(cf) &&
	/porFalta\.push\(\{ vence: x\.vence \|\| null \}\)/.test(extraerFuncion(hoy, "faltantesDeLaJornada")) && /porFalta: porFalta, hoy: hoy/.test(extraerFuncion(hoy, "faltantesDeLaJornada")), true);
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
