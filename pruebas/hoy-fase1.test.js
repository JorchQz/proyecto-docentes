/*
	Lo que cambió en Hoy tras el primer día de Fanny (2026-09-29, Fase 1): Cierre del día con
	encabezado y columnas, la frase sugerida que se AGREGA sin repetirse, el resumen de la
	asistencia plegada, el aviso de guardado y las sesiones que faltan. Usa las funciones tal cual
	están en js/hoy.js (como pruebas/hoy-render.test.js); el arranque completo lo cubre
	pruebas/hoy-arranque.test.js.

	node pruebas/hoy-fase1.test.js
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
const fuente = fs.readFileSync(path.join(RAIZ, "js", "hoy.js"), "utf8");
const pagina = fs.readFileSync(path.join(RAIZ, "hoy.html"), "utf8");
const ORDEN = require("../js/orden-lista.js");
const ALCANCE = require("../js/alcance-hoy.js");
const PH = require("../js/productos-hoy.js");

function extraerFuncion(nombre) {
	const m = fuente.match(new RegExp("\\n\\tfunction " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
	if (!m) { console.log("FALLA no se encontró la función " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}
function extraerLista(nombre) {
	const m = fuente.match(new RegExp("var " + nombre + " = \\[[\\s\\S]*?\\];"));
	if (!m) { console.log("FALLA no se encontró la lista " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}

// ── 1. La frase sugerida se agrega al final y no se repite ───────────────────
const { agregarFrase } = new Function(extraerFuncion("agregarFrase") + "\nreturn { agregarFrase: agregarFrase };")();
ok("frase: en un cuadro vacío, la frase sola", agregarFrase("", "No trajo material"), "No trajo material");
ok("frase: se agrega al final de lo escrito", agregarFrase("Le faltó color", "No trajo material"), "Le faltó color. No trajo material");
ok("frase: si lo escrito ya cierra con punto, no se duplica", agregarFrase("Le faltó color.", "No trajo material"), "Le faltó color. No trajo material");
ok("frase: con signo de cierre de pregunta o admiración", agregarFrase("¿Y su cuaderno?", "Incompleto"), "¿Y su cuaderno? Incompleto");
ok("frase: ya estaba escrita: no se repite", agregarFrase("Le faltó color. No trajo material", "No trajo material"), "Le faltó color. No trajo material");
ok("frase: sin importar mayúsculas ni el punto final", agregarFrase("no trajo material.", "No trajo material"), "no trajo material.");
ok("frase: dos frases distintas se acumulan", agregarFrase(agregarFrase("Buen trabajo", "Mejorar letra"), "Revisar ortografía"), "Buen trabajo. Mejorar letra. Revisar ortografía");
ok("frase: una palabra parecida no cuenta como repetida", agregarFrase("Incompleto el mapa", "Incompleto"), "Incompleto el mapa");
ok("frase: «Incompleto» sí se agrega si solo aparece dentro de otra palabra", agregarFrase("Trabajo incompletos", "Incompleto"), "Trabajo incompletos. Incompleto");
ok("frase: los espacios al final no estorban", agregarFrase("Buen trabajo   ", "Mejorar letra"), "Buen trabajo. Mejorar letra");
ok("frase: nada que agregar deja el texto igual", agregarFrase("Buen trabajo", "  "), "Buen trabajo");
ok("frase: el botón usa agregarFrase y ya no reemplaza (ta.value = texto)", /agregarFrase\(ta\.value, btnRetro\.dataset\.texto\)/.test(fuente) && !/ta\.value = btnRetro\.dataset\.texto/.test(fuente), true);

// ── 2. Cierre del día: columnas, orden y «Faltó» ─────────────────────────────
const alumnos = [
	{ id: "a3", nombre_completo: "ZAPATA EVA", grado: 2, num_lista: 3 },
	{ id: "a1", nombre_completo: "MUÑOZ ANA", grado: 1, num_lista: 1 },
	{ id: "a2", nombre_completo: "ÁVILA LUIS", grado: 1, num_lista: 2 },
	{ id: "a4", nombre_completo: "RUIZ SOL", grado: 2, num_lista: 4 },
];
const cuerpoCierre = [
	"var window = { OrdenLista: O };",
	"var alumnos = ALUMNOS; var registro = REGISTRO; var asistencia = ASISTENCIA_HOY; var registroGuardado = GUARDADO;",
	"var notasPendientes = PENDIENTES; var NOTA_MAX = 500;",
	extraerLista("NIVELES"),
	extraerFuncion("esc"), extraerFuncion("chip"), extraerFuncion("faltoHoy"),
	extraerFuncion("columnasCierre"), extraerFuncion("encabezadoCierre"), extraerFuncion("celdaCierre"),
	extraerFuncion("textoNota"), extraerFuncion("celdaNota"), extraerFuncion("filaCierre"),
	"return { encabezadoCierre: encabezadoCierre, filaCierre: filaCierre, ordenar: function () { return O.ordenar(alumnos).map(filaCierre).join(''); } };",
].join("\n");
const fabricaCierre = (registro, asis, guardado, pendientes) => new Function("O", "ALUMNOS", "REGISTRO", "ASISTENCIA_HOY", "GUARDADO", "PENDIENTES", cuerpoCierre)(ORDEN, alumnos, registro, asis, guardado, pendientes || {});
const cierre = fabricaCierre({ a1: { participacion: 2, conducta: 0 } }, { a2: "ausente", a4: "justificada" }, { a1: true });
const encabezado = cierre.encabezadoCierre();
ok("cierre: encabezado fijo (sticky top-14) solo desde md", /class='hidden md:grid [^']*sticky top-14/.test(encabezado), true);
ok("cierre: las seis columnas, en orden (la sexta, Comentarios)", ["No.", "Grado", "Nombre", "Participación", "Conducta", "Comentarios"].map((t) => encabezado.indexOf(">" + t + "<")).every((n, i, a) => n !== -1 && (i === 0 || n > a[i - 1])), true);
ok("cierre: Participación, Conducta y Comentarios con colores distintos", /bg-violet-100[^>]*>Participación/.test(encabezado) && /bg-teal-100[^>]*>Conducta/.test(encabezado) && /bg-amber-100[^>]*>Comentarios/.test(encabezado), true);
ok("cierre: desde md cinco columnas y desde xl (1280 px) seis, con Comentarios la ancha",
	/md:grid-cols-\[2\.75rem_3\.25rem_minmax\(0,1fr\)_10\.5rem_10\.5rem\] xl:grid-cols-\[2\.75rem_3\.25rem_minmax\(0,1fr\)_10\.5rem_10\.5rem_minmax\(0,1\.3fr\)\]/.test(encabezado) &&
	/hidden xl:block bg-amber-100[^>]*>Comentarios/.test(encabezado), true);
const filas = cierre.ordenar();
const nombres = (filas.match(/font-medium text-gray-800 md:px-2 md:py-2'>([^<]+)</g) || []).map((x) => x.replace(/.*>([^<]+)<$/, "$1"));
ok("cierre: el orden de la lista (1° alfabético y luego 2°)", nombres, ["ÁVILA LUIS", "MUÑOZ ANA", "RUIZ SOL", "ZAPATA EVA"]);
ok("cierre: número de lista y grado en cada fila", /data-num-lista[^>]*>1<\/span><span[^>]*data-cierre-grado>1°</.test(filas), true);
const filaAna = filas.split("data-cierre-fila='a1'")[1].split("data-cierre-fila=")[0];
ok("cierre: quien asistió lleva seis chips (0 1 2 de cada columna)", (filaAna.match(/data-cierre='(participacion|conducta)'/g) || []).length, 6);
ok("cierre: lo capturado queda marcado con el color de su columna (2 violeta, 0 verde azulado)",
	/data-cierre='participacion' data-alumno='a1' data-valor='2' class='[^']*bg-violet-600 text-white/.test(filaAna) && /data-cierre='conducta' data-alumno='a1' data-valor='0' class='[^']*bg-teal-600 text-white/.test(filaAna), true);
ok("cierre: sin registro, el 1 aparece marcado (todos empiezan en 1)", /data-cierre='participacion' data-alumno='a3' data-valor='1' class='[^']*bg-violet-600 text-white/.test(filas), true);
const filaAusente = filas.split("data-cierre-fila='a2'")[1].split("data-cierre-fila=")[0];
ok("cierre: a quien faltó se le pone «Faltó» y no se le dan chips", />Faltó</.test(filaAusente) && !/data-cierre='/.test(filaAusente), true);
const filaJustificada = filas.split("data-cierre-fila='a4'")[1].split("data-cierre-fila=")[0];
ok("cierre: la justificada dice «Faltó · justificada», también sin chips", />Faltó · justificada</.test(filaJustificada) && !/data-cierre='/.test(filaJustificada), true);
ok("cierre: a 390 px es una tarjeta por alumno (borde y esquinas hasta md) y tabla desde md", /class='mb-2 rounded-xl border border-gray-200 p-3 md:mb-0 md:grid md:grid-cols-\[/.test(filas), true);
ok("cierre: los chips miden al menos 44 px", /data-cierre='participacion'[^>]*>|min-h-\[44px\] min-w-\[44px\]/.test(filas) && (filas.match(/min-h-\[44px\] min-w-\[44px\]/g) || []).length === 12, true);

// R32 R-1: quien faltó pero ya tiene una fila distinta de 1 y 1 se ve CON chips y "Quitar del cierre"
const conFila = fabricaCierre({ a2: { participacion: 2, conducta: 1 }, a4: { participacion: 1, conducta: 1 } }, { a2: "ausente", a4: "justificada" }, { a2: true, a4: true }).ordenar();
const fA2 = conFila.split("data-cierre-fila='a2'")[1].split("data-cierre-fila=")[0];
const fA4 = conFila.split("data-cierre-fila='a4'")[1].split("data-cierre-fila=")[0];
ok("R-1: faltó con fila 2/1: dice «Faltó» y conserva sus 6 chips", />Faltó</.test(fA2) && (fA2.match(/data-cierre='(participacion|conducta)'/g) || []).length === 6, true);
ok("R-1: su participación 2 sigue marcada (para corregirla)", /data-cierre='participacion' data-alumno='a2' data-valor='2' class='[^']*bg-violet-600 text-white/.test(fA2), true);
ok("R-1: ofrece «Quitar del cierre» (44 px)", /data-cierre-quitar='a2'[^>]*min-h-\[44px\][^>]*>Quitar del cierre</.test(fA2), true);
ok("R-1: con fila 1/1 queda como antes: «Faltó · justificada» sin chips ni botón", />Faltó · justificada</.test(fA4) && !/data-cierre='/.test(fA4) && fA4.indexOf("Quitar del cierre") === -1, true);
ok("R-1: sin fila guardada tampoco hay botón", filas.indexOf("Quitar del cierre") === -1, true);
ok("R-1: el botón borra la fila por la cola (registro_borrar) y la quita de la pantalla",
	/var quitar = e\.target\.closest\("button\[data-cierre-quitar\]"\);[\s\S]{0,400}registroGuardado\[idQuitar\] = false;\s*guardar\("registro_borrar"/.test(fuente), true);

// La leyenda del 0, 1 y 2 (texto que aprobó Jorge el 2026-09-29)
const leyenda = pagina.replace(/\s+/g, " ");
ok("leyenda de Participación", leyenda.indexOf("0 = no participó · 1 = participó · 2 = participó de forma destacada. El 1 y el 2 valen el día completo; el 2 se menciona en la boleta.") !== -1, true);
ok("leyenda de Conducta", leyenda.indexOf("0 = necesita apoyo · 1 = adecuada · 2 = destacada. Se informa en las observaciones y no cuenta en la calificación.") !== -1, true);
ok("la leyenda está antes de la lista del cierre", pagina.indexOf("cierreLeyenda") < pagina.indexOf('id="cierreLista"'), true);
// Fase 3: la columna de Comentarios (registro_diario.nota, mi_salon_b25)
ok("comentarios: cada alumno tiene su caja (44 px), también quien faltó", (filas.match(/<textarea /g) || []).length === 4 &&
	/data-cierre-nota='a2'/.test(filaAusente) && /data-cierre-nota='a4'/.test(filaJustificada) && (filas.match(/<textarea [^>]*class='[^']*min-h-\[44px\]/g) || []).length === 4, true);
ok("comentarios: quien faltó tiene su caja pero sigue sin chips", !/data-cierre='/.test(filaAusente) && /data-cierre-nota='a2'/.test(filaAusente), true);
ok("comentarios: la caja lleva su etiqueta (oculta solo desde xl, donde la dice el encabezado) y un nombre accesible", /<label for='cierreNota-a1' class='xl:hidden[^']*'>Comentarios<\/label>/.test(filaAna) && /aria-label='Comentario del día de MUÑOZ ANA'/.test(filaAna), true);
ok("comentarios: de md a xl la caja ocupa una fila debajo (col-span-5); desde xl, su columna", /data-cierre-columna='nota'/.test(filaAna) && /md:col-span-5 md:px-2 md:pb-2 xl:col-span-1/.test(filaAna), true);
ok("comentarios: la caja va después de la conducta (orden de las columnas)", filaAna.indexOf("data-cierre='conducta'") < filaAna.indexOf("data-cierre-nota='a1'"), true);
const conNota = fabricaCierre({ a1: { participacion: 1, conducta: 1, nota: "Trajo <material>" }, a2: { participacion: null, conducta: null, nota: "Enfermo" } },
	{ a2: "ausente" }, { a1: true, a2: true }).ordenar();
const cA1 = conNota.split("data-cierre-fila='a1'")[1].split("data-cierre-fila=")[0];
const cA2 = conNota.split("data-cierre-fila='a2'")[1].split("data-cierre-fila=")[0];
ok("comentarios: lo guardado se ve dentro de la caja (y escapado)", />Trajo &lt;material&gt;<\/textarea>/.test(cA1), true);
ok("comentarios: quien faltó con solo su comentario se ve «Faltó» SIN chips ni «Quitar del cierre» (no es un cierre capturado)",
	/>Faltó</.test(cA2) && !/data-cierre='/.test(cA2) && cA2.indexOf("Quitar del cierre") === -1 && />Enfermo<\/textarea>/.test(cA2), true);
const pend = fabricaCierre({ a1: { participacion: 1, conducta: 1, nota: "guardado" } }, {}, { a1: true }, { a1: { texto: "escribiendo…", timer: 0 } }).ordenar();
ok("comentarios: lo que se está escribiendo gana sobre lo guardado (Hoy se vuelve a dibujar en cada toque)", />escribiendo…<\/textarea>/.test(pend) && !/>guardado<\/textarea>/.test(pend), true);
const conFilaNota = fabricaCierre({ a2: { participacion: 2, conducta: 1, nota: "Faltó pero ya había participado" } }, { a2: "ausente" }, { a2: true }).ordenar();
const fN = conFilaNota.split("data-cierre-fila='a2'")[1].split("data-cierre-fila=")[0];
ok("comentarios: faltó con fila 2/1 y comentario: chips, comentario y «Quitar del cierre» juntos, el botón después de la caja",
	(fN.match(/data-cierre='(participacion|conducta)'/g) || []).length === 6 && fN.indexOf("data-cierre-nota='a2'") < fN.indexOf("Quitar del cierre") && />Faltó pero ya había participado<\/textarea>/.test(fN), true);
ok("comentarios: 'Quitar del cierre' conserva el comentario (solo quita participación y conducta) y sin comentario borra la fila",
	/vQuitar && vQuitar\.nota\)\s*\{\s*vQuitar\.participacion = null;\s*vQuitar\.conducta = null;\s*guardarRegistro\(idQuitar, \["participacion", "conducta"\]\);\s*\} else \{\s*delete registro\[idQuitar\];[\s\S]{0,120}guardar\("registro_borrar"/.test(fuente), true);
ok("comentarios: se guarda tras una pausa (1 s) o al salir de la caja, y funciona con el campo nota por la cola",
	/notasPendientes\[id\] = \{ texto: ta\.value, timer: setTimeout\(function \(\) \{ guardarNota\(id\); \}, 1000\) \};/.test(fuente) &&
	/addEventListener\("focusout"[\s\S]{0,200}guardarNota\(ta\.dataset\.cierreNota\)/.test(fuente) && /guardarRegistro\(alumnoId, "nota"\)/.test(fuente), true);
ok("comentarios: lo escrito y aún no guardado cuenta como pendiente (recargar pide confirmación) y se guarda con las retroalimentaciones",
	/!Object\.keys\(notasPendientes \|\| \{\}\)\.length\) return;/.test(fuente) && /function guardarRetrosPendientes\(\) \{[\s\S]{0,200}guardarNotasPendientes\(\)/.test(fuente), true);
ok("comentarios: guardar el comentario no dibuja de nuevo la lista (no se pierde el foco)", extraerFuncion("guardarNota").indexOf("renderCierre()") === -1, true);
ok("comentarios: renderCierre conserva el foco y el cursor de la caja que se está escribiendo", /activo\.dataset\.cierreNota[\s\S]{0,900}setSelectionRange\(foco\.ini, foco\.fin\)/.test(extraerFuncion("renderCierre")), true);
ok("comentarios: la fila de comentario no cuenta como cierre guardado (cierreGuardado pide participación y conducta)",
	/return !!registroGuardado\[alumnoId\] && !!v && v\.participacion !== null && v\.participacion !== undefined &&\s*v\.conducta !== null && v\.conducta !== undefined;/.test(fuente), true);
ok("comentarios: la leyenda de la página explica la columna, también para quien faltó", /En Comentarios puedes anotar algo del día de cada alumno, también de quien faltó/.test(leyenda), true);

// ── 3. Asistencia plegada: el resumen ────────────────────────────────────────
const cuerpoAsis = [
	"var window = { OrdenLista: O };",
	"var alumnos = ALUMNOS; var asistencia = ASIST;",
	extraerFuncion("textoResumenAsistencia"),
	"return { texto: textoResumenAsistencia };",
].join("\n");
const mk = (n, mapa) => new Function("O", "ALUMNOS", "ASIST", cuerpoAsis)(ORDEN, alumnos.slice(0, n), mapa).texto();
ok("resumen: «4 de 4 · 2 presentes · Falta: … · Justificada: …»", mk(4, { a1: "presente", a2: "ausente", a3: "presente", a4: "justificada" }),
	"4 de 4 · 2 presentes · Falta: ÁVILA LUIS · Justificada: RUIZ SOL");
const cinco = alumnos.concat([{ id: "a5", nombre_completo: "PEÑA OSCAR", grado: 2, num_lista: 5 }]);
ok("resumen: varias faltas, en orden de lista y en plural", new Function("O", "ALUMNOS", "ASIST", cuerpoAsis)(ORDEN, cinco,
	{ a1: "presente", a2: "ausente", a3: "ausente", a4: "justificada", a5: "justificada" }).texto(),
	"5 de 5 · 1 presente · Faltan: ÁVILA LUIS, ZAPATA EVA · Justificadas: PEÑA OSCAR, RUIZ SOL");
ok("resumen: sin faltas, solo el conteo", mk(2, { a3: "presente", a1: "presente" }), "2 de 2 · 2 presentes");
ok("resumen: la tarjeta se pliega solo si está completa (asistenciaCompleta)", /return alumnos\.length > 0 && alumnos\.every\(function \(a\) \{ return !!asistencia\[a\.id\]; \}\);/.test(fuente), true);
ok("plegado: 0.7 s tras marcar al último, y solo si pasó de incompleta a completa", /!estabaCompleta && asistenciaCompleta\(\)[\s\S]{0,200}setTimeout\([\s\S]{0,200}\}, 700\)/.test(fuente), true);
ok("plegado: «Cambiar asistencia» y «Listo» existen en la página", pagina.indexOf("Cambiar asistencia") !== -1 && pagina.indexOf('id="asistenciaListo"') !== -1, true);
ok("plegado: los botones miden al menos 44 px", /id="asistenciaCambiar"[^>]*min-h-\[44px\]/.test(pagina) && /id="asistenciaListo"[^>]*min-h-\[44px\]/.test(pagina), true);

// ── 4. El filtro de ausentes es solo de pantalla ─────────────────────────────
ok("filtro: la regla recibeProducto (js/alcance-hoy.js) no menciona la asistencia", !/asistencia|ausente|falto/i.test(fs.readFileSync(path.join(RAIZ, "js", "alcance-hoy.js"), "utf8").split("function recibeProducto")[1].split("\n\t}")[0]), true);
const cuerpoFiltro = [
	"var window = { AlcanceHoy: A, ProductosHoy: P };",
	"var alumnos = ALUMNOS; var asignaciones = {}; var asistencia = ASIST; var calificaciones = CALIF; var hoy = '2026-09-29';",
	"var asisPasadas = {}; var ajustesCal = []; var proyectoPorId = {};",
	extraerFuncion("faltoHoy"), extraerFuncion("asisDe"), extraerFuncion("faltoEnDia"), extraerFuncion("cubiertoPorJustificada"), extraerFuncion("esEnCurso"),
	extraerFuncion("alumnosDeProducto"), extraerFuncion("alumnosParaCalificar"),
	"return { para: alumnosParaCalificar, todos: alumnosDeProducto };",
].join("\n");
const fabricaFiltro = (asist, calif) => new Function("A", "P", "ALUMNOS", "ASIST", "CALIF", cuerpoFiltro)(ALCANCE, PH, alumnos, asist, calif);
const trabajoHoy = { id: "p1", tipo: "trabajo", grados: ["1", "2"], sesion: { fecha: "2026-09-29" } };
const ids = (l) => l.map((a) => a.id);
let f = fabricaFiltro({ a2: "ausente" }, {});
ok("filtro: el ausente sin calificación sale de la lista de calificar", ids(f.para(trabajoHoy)), ["a3", "a1", "a4"]);
ok("filtro: pero la regla de a quién le toca sigue dándoselo", ids(f.todos(trabajoHoy)).indexOf("a2") !== -1, true);
f = fabricaFiltro({ a2: "ausente" }, { "a2|p1": { nivel: "logrado", estado_entrega: "entregado" } });
ok("filtro: con calificación, sí se muestra", ids(f.para(trabajoHoy)).indexOf("a2") !== -1, true);
f = fabricaFiltro({ a2: "justificada" }, {});
ok("filtro: la justificada tampoco aparece", ids(f.para(trabajoHoy)).indexOf("a2"), -1);
f = fabricaFiltro({ a2: "presente" }, {});
ok("filtro: quien está presente aparece", ids(f.para(trabajoHoy)).indexOf("a2") !== -1, true);
f = fabricaFiltro({}, {});
ok("filtro: sin asistencia capturada nadie se esconde", ids(f.para(trabajoHoy)).length, 4);
f = fabricaFiltro({ a2: "ausente" }, {});
ok("filtro: una tarea que se revisa hoy también lo aplica", ids(f.para({ id: "t1", tipo: "tarea", grados: ["1", "2"], sesion: { fecha: "2026-09-22" } })).indexOf("a2"), -1);
ok("filtro: una actividad suelta de un día que ya pasó NO se filtra por la asistencia de hoy",
	ids(f.para({ id: "p2", tipo: "trabajo", grados: ["1", "2"], sesion: { fecha: "2026-09-25" } })).indexOf("a2") !== -1, true);
ok("filtro: la tarjeta 3 y Tareas lo usan (alumnosParaCalificar)", (fuente.match(/alumnosParaCalificar\(/g) || []).length >= 6 && /agruparPorGrado\(alumnosParaCalificar\(t\)\)/.test(fuente), true);

// ── 5. Aviso de guardado: en el encabezado, sin verde y sin flotar ───────────
const encabezadoPagina = pagina.split("</header>")[0];
ok("guardado: #hoyEstadoGuardado está dentro del encabezado azul", encabezadoPagina.indexOf('id="hoyEstadoGuardado"') !== -1, true);
ok("guardado: la línea reserva su alto (no mueve nada al aparecer) y nace escondida", /id="hoyEstadoLinea" class="invisible [^"]*min-h-\[20px\]/.test(pagina), true);
ok("guardado: ya no hay pastilla verde ni fija en la página", pagina.indexOf("emerald-600") === -1 && !/id="hoyEstadoGuardado"[^>]*fixed/.test(pagina), true);
ok("guardado: el JS no pinta verde el aviso de guardado", !/bg-emerald-600/.test(fuente), true);
ok("guardado: abajo flota solo lo de sin señal (ámbar) y lo de error (rojo)", /tipo === "red" \? "bg-amber-100\/80 text-amber-900 border-amber-300\/70" : "bg-red-50 text-red-800 border-red-300"/.test(fuente), true);
ok("guardado: lo que flota no recibe toques (pointer-events-none) y el aviso de lo no guardado solo en sus botones",
	/pila\.className = "fixed inset-x-4 bottom-4 z-40 flex flex-col items-center gap-2 pointer-events-none"/.test(fuente) &&
	/caja\.className = "pointer-events-none /.test(fuente) && !/pointer-events-auto max-w-full/.test(fuente) &&
	/ver\.className = "pointer-events-auto min-h-\[44px\]/.test(fuente) && /cerrar\.className = "pointer-events-auto min-h-\[44px\]/.test(fuente), true);
ok("guardado: la página aparta espacio al final para lo que flota (#hoyReserva)", pagina.indexOf('id="hoyReserva"') !== -1 && /reserva\.style\.height = hayAlgo \? \(pila\.offsetHeight \+ 24\) \+ "px" : "0px"/.test(fuente), true);
ok("guardado: conserva «Todo guardado» y «Guardando…»", fuente.indexOf('estadoGuardado("Todo guardado", "ok")') !== -1 && fuente.indexOf('"Guardando…"') !== -1, true);

// ── 6. Sesiones que faltan: solo la siguiente ofrece «Trabajar hoy» ──────────
const cuerpoFilas = [
	"var window = {}; var secuenciasAbiertas = ABIERTAS; var restantesAbiertas = {}; var siguientes = SIG; var sesionesHoy = [];",
	extraerFuncion("esc"), extraerFuncion("vacio"), extraerFuncion("chevron"), extraerFuncion("iconoOjo"), extraerFuncion("iconoLapiz"),
	"function cuerpoSecuencia() { return '<p>CUERPO</p>'; }",
	"var todasLasSesiones = [];", extraerFuncion("avisoBloqueo"),
	extraerFuncion("filaSiguiente"), extraerFuncion("bloqueSiguientes"),
	"return { bloque: bloqueSiguientes, fila: filaSiguiente };",
].join("\n");
const sig = [{
	proyecto: { id: "p1", titulo: "Proyecto A" },
	siguiente: { id: "s2", numero_sesion: 2, campo_formativo: "Lenguajes", proyecto_id: "p1", proyectoTitulo: "Proyecto A" },
	otras: [{ id: "s3", numero_sesion: 3, campo_formativo: "Saberes", proyecto_id: "p1" }, { id: "s4", numero_sesion: 4, campo_formativo: "Ética", proyecto_id: "p1" }],
}];
const filasApi = new Function("ABIERTAS", "SIG", cuerpoFilas)({}, sig);
const bloque = filasApi.bloque();
ok("faltan: solo la siguiente ofrece «Trabajar hoy»", (bloque.match(/data-trabajar-hoy=/g) || []).length === 1 && bloque.indexOf("data-trabajar-hoy='s2'") !== -1, true);
ok("faltan: «2 sesiones restantes» (y ya no «Elegir otra sesión»)", bloque.indexOf("2 sesiones restantes") !== -1 && bloque.indexOf("Elegir otra sesión") === -1, true);
ok("faltan: cada fila con su ojo gris y su lápiz azul (3 de cada uno)", (bloque.match(/data-ver-secuencia=/g) || []).length === 3 && (bloque.match(/data-editar-sesion=/g) || []).length === 3, true);
ok("faltan: el lápiz abre Crear proyecto en esa sesión, con enlace relativo", bloque.indexOf("href='crear_proyecto.html?id=p1&sesion=s3'") !== -1 && !/href='\//.test(bloque) && !/href='https?:/.test(bloque), true);
ok("faltan: el ojo es gris y el lápiz azul", /data-ver-secuencia='s3'[^>]*text-gray-500/.test(bloque) && /data-editar-sesion='s3'[^>]*text-blue-700/.test(bloque), true);
ok("faltan: el ojo y el lápiz miden 44 x 44", /data-ver-secuencia='s3'[^>]*min-h-\[44px\] min-w-\[44px\]/.test(bloque) && /data-editar-sesion='s3'[^>]*min-h-\[44px\] min-w-\[44px\]/.test(bloque), true);
ok("faltan: la lista de restantes nace plegada (botón, no <details>)", /data-abrir-restantes='p1' aria-expanded='false'/.test(bloque) && bloque.indexOf("<details") === -1, true);
const conSecuencia = new Function("ABIERTAS", "SIG", cuerpoFilas)({ s3: true }, sig).bloque();
ok("faltan: con la secuencia de esa sesión abierta, se despliega ahí mismo", /data-fila-sesion='s3'[\s\S]*<p>CUERPO<\/p>/.test(conSecuencia) && /data-ver-secuencia='s3' aria-expanded='true'/.test(conSecuencia), true);
ok("faltan: el ojo de una sesión cerrada no despliega nada", bloque.indexOf("CUERPO"), -1);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
