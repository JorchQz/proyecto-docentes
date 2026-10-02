/*
	La vista del proyecto (Fase 5 del plan de Fanny, 2026-09-30): proyecto.html y js/proyecto.js, el módulo compartido de
	Renombrar y Quitar (js/producto-acciones.js, sacado de Hoy), "quién hace" cada actividad (ParaQuien.quienHace), los
	productos que no son del plan en Crear proyecto (ParaQuien.renglonesDeSesion → extras), "Ver proyecto" en Proyectos,
	"Ver en el proyecto" en el ojo de Hoy, las opciones nuevas del diálogo de agregar (soloDentro y revisaAlTrabajar) y la
	ruta de la app (_redirects y la barra). Lo que pasa en el navegador contra la base de pruebas (agregar en la vista y
	verlo en Hoy, y al revés; renombrar, quitar, para quién, ?sesion=, solo lectura, 1280/800/390) está en
	.qa/constructor-az/e2e-vista.js.

	node pruebas/proyecto-vista.test.js
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
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n");

global.window = global;
require("../js/campos-formativos.js");
require("../js/calendario-sep.js");
const A = require("../js/alcance-hoy.js");
const PH = require("../js/productos-hoy.js");
require("../js/orden-lista.js");
require("../js/texto-sesion.js");
require("../js/secuencia-sesion.js");
const ST = require("../js/sesion-terminar.js");
require("../js/proyecto-edicion.js");
require("../js/sesiones-materializar.js");
const PQ = require("../js/para-quien.js");
const PA = require("../js/producto-acciones.js");
const V = require("../js/proyecto.js");

// ── Datos como PP-NIVELES (niveles que no son grados: Morado con uno de 1° y uno de 2°) ──
const alumnos = [
	{ id: "a1", nombre_completo: "SALAS PINO AMELIA", grado: 1, num_lista: 1 },
	{ id: "a2", nombre_completo: "BRAVO CHAVEZ GERMAN", grado: 1, num_lista: 2 },
	{ id: "a3", nombre_completo: "PARRA MARIN MIRIAM", grado: 1, num_lista: 3 },
	{ id: "b1", nombre_completo: "IBAÑEZ PLATA DARIO", grado: 2, num_lista: 4 },
	{ id: "b2", nombre_completo: "NAVA ARIAS EZEQUIEL", grado: 2, num_lista: 5 },
	{ id: "b3", nombre_completo: "LUGO TREJO MATEO", grado: 2, num_lista: 6 },
];
const pM = { id: "pM", sesion_id: "s1", tipo: "trabajo", nombre: "Tarjeta de nombre · Morado", grados: [], campo: "LEN", orden: 1, created_at: "2026-09-27T10:00:00Z" };
const pN = { id: "pN", sesion_id: "s1", tipo: "trabajo", nombre: "Tarjeta de nombre · Naranja", grados: ["1"], campo: "LEN", orden: 1, created_at: "2026-09-27T10:00:01Z" };
const pA = { id: "pA", sesion_id: "s1", tipo: "trabajo", nombre: "Tarjeta de nombre · Azul", grados: ["2"], campo: "LEN", orden: 1, created_at: "2026-09-27T10:00:02Z" };
const t1 = { id: "t1", sesion_id: "s1", tipo: "tarea", nombre: "Platica en casa", grados: ["1"], campo: "LEN", orden: 2, fecha_entrega: null, created_at: "2026-09-27T10:00:03Z" };
const t2 = { id: "t2", sesion_id: "s1", tipo: "tarea", nombre: "Escribe tu nombre", grados: ["2"], campo: "LEN", orden: 2, fecha_entrega: null, created_at: "2026-09-27T10:00:04Z" };
const otro = { id: "pO", sesion_id: "s1", tipo: "trabajo", nombre: "Conteo de granos", grados: ["1", "2"], campo: "SAB", orden: 3, created_at: "2026-09-30T10:00:00Z" };
const asignaciones = A.indiceAsignaciones([
	{ producto_sesion_id: "pM", alumno_id: "a1", modo: "incluir" }, { producto_sesion_id: "pM", alumno_id: "b1", modo: "incluir" },
	{ producto_sesion_id: "pN", alumno_id: "a1", modo: "excluir" }, { producto_sesion_id: "pA", alumno_id: "b1", modo: "excluir" },
]);
const calIdx = PQ.indiceCalificaciones([{ alumno_id: "a2", producto_sesion_id: "pN", nivel: "logrado", estado_entrega: "entregado" },
	{ alumno_id: "a3", producto_sesion_id: "pN", nivel: null, estado_entrega: null, puntaje: null, retroalimentacion: null }]);

// ── 1. Quién hace cada actividad ──
ok("quienHace: un nivel sin grados (Morado, uno de 1° y uno de 2°) → sus nombres en el orden de la lista",
	PQ.quienHace(pM, asignaciones.pM, alumnos).texto, "SALAS PINO AMELIA, IBAÑEZ PLATA DARIO");
ok("quienHace: un grado sin alguno (Naranja) → los nombres de quienes lo hacen", [PQ.quienHace(pN, asignaciones.pN, alumnos).texto, PQ.quienHace(pN, asignaciones.pN, alumnos).n],
	["BRAVO CHAVEZ GERMAN, PARRA MARIN MIRIAM", 2]);
ok("quienHace: todo el grado → «1° (todos)» y cuántos son", [PQ.quienHace(t1, {}, alumnos).texto, PQ.quienHace(t1, {}, alumnos).n, PQ.quienHace(t1, {}, alumnos).porNombre], ["1° (todos)", 3, false]);
ok("quienHace: todo el grupo en multigrado → «1° y 2° (todos)»", PQ.quienHace(otro, {}, alumnos).texto, "1° y 2° (todos)");
ok("quienHace: nadie → el resumen de siempre", [PQ.quienHace({ id: "x", grados: ["4"] }, {}, alumnos).texto, PQ.quienHace({ id: "x", grados: ["4"] }, {}, alumnos).n],
	["4° (no hay alumnos de ese grado en el grupo)", 0]);
ok("quienHace: la regla es la de siempre (un incluido de otro grado sí, un excluido no)",
	PQ.quienHace({ id: "y", grados: ["1"] }, { a1: "excluir", b2: "incluir" }, alumnos).alumnos.map((a) => a.id), ["a2", "a3", "b2"]);

// ── 1b. quienHaceCorto (2026-10-02): tres nombres y «+ N más» ──
const grupoDe = (n) => Array.from({ length: n }, (_, i) => ({ id: "g" + i, nombre_completo: "NOMBRE " + String(i + 1).padStart(2, "0"), grado: 1, num_lista: i + 1 }));
const porNombres = (n) => {
	const al = grupoDe(n + 1); // uno más que no se elige: así no es «todos»
	const asig = {};
	al.slice(0, n).forEach((a) => { asig[a.id] = "incluir"; });
	return PQ.quienHace({ id: "q" + n, grados: [] }, asig, al);
};
ok("quienHaceCorto: 0 nombres (nadie) → el texto de quienHace y sin resto", [PQ.quienHaceCorto(porNombres(0)).resto, PQ.quienHaceCorto(porNombres(0)).corto === porNombres(0).texto, PQ.quienHaceCorto(porNombres(0)).n], [[], true, 0]);
ok("quienHaceCorto: 1 nombre → el nombre, sin resto", PQ.quienHaceCorto(porNombres(1)), { corto: "NOMBRE 01", resto: [], n: 0 });
ok("quienHaceCorto: 3 nombres → los 3, sin resto", PQ.quienHaceCorto(porNombres(3)), { corto: "NOMBRE 01, NOMBRE 02, NOMBRE 03", resto: [], n: 0 });
ok("quienHaceCorto: 4 nombres → 3 + «+ 1 más» y el que falta", PQ.quienHaceCorto(porNombres(4)), { corto: "NOMBRE 01, NOMBRE 02, NOMBRE 03 + 1 más", resto: ["NOMBRE 04"], n: 1 });
const q16 = PQ.quienHaceCorto(porNombres(16));
ok("quienHaceCorto: 16 nombres → 3 + «+ 13 más» y los 13 que faltan, en el orden de la lista",
	[q16.corto, q16.n, q16.resto.length, q16.resto[0], q16.resto[12]], ["NOMBRE 01, NOMBRE 02, NOMBRE 03 + 13 más", 13, 13, "NOMBRE 04", "NOMBRE 16"]);
ok("quienHaceCorto: por grado («1° (todos)») → el texto tal cual, sin resto", PQ.quienHaceCorto(PQ.quienHace(t1, {}, alumnos)), { corto: "1° (todos)", resto: [], n: 0 });
ok("quienHaceCorto: otro máximo", PQ.quienHaceCorto(porNombres(5), 2).corto, "NOMBRE 01, NOMBRE 02 + 3 más");

// ── 2. Estado de la sesión (la regla de Hoy: SesionTerminar.enCurso con su corte) ──
const HOY = "2026-10-05", CORTE = ST.CORTE_EN_CURSO;
ok("estado: sin fecha → Pendiente (también si «Iniciar» la dejó activa)",
	[V.estadoSesion({ fecha: null, estado_sesion: "pendiente" }, HOY, CORTE).texto, V.estadoSesion({ fecha: null, estado_sesion: "activa" }, HOY, CORTE).clave], ["Pendiente", "pendiente"]);
ok("estado: empezada hoy → «En curso desde hoy»", V.estadoSesion({ fecha: HOY, estado_sesion: "activa" }, HOY, CORTE).texto, "En curso desde hoy");
ok("estado: empezada otro día y sin terminar → «En curso desde el 2 oct»", V.estadoSesion({ fecha: "2026-10-02", estado_sesion: "activa" }, HOY, CORTE).texto, "En curso desde el 2 oct");
ok("estado: terminada → «Terminada» y el día en que se trabajó",
	[V.estadoSesion({ fecha: "2026-10-01", estado_sesion: "completada" }, HOY, CORTE).texto, V.estadoSesion({ fecha: "2026-10-01", estado_sesion: "completada" }, HOY, CORTE).detalle],
	["Terminada", "Se trabajó el 1 oct"]);
ok("estado: con fecha anterior al corte cuenta como terminada (Fanny las trabajó antes de «Terminar sesión»)",
	V.estadoSesion({ fecha: "2026-09-28", estado_sesion: "activa" }, HOY, CORTE).clave, "terminada");
ok("trabajada: con fecha o con calificaciones (la regla de Crear proyecto)",
	[V.trabajada({ id: "s", fecha: "2026-10-01" }, {}), V.trabajada({ id: "s", fecha: null }, { s: true }), V.trabajada({ id: "s", fecha: null }, {})], [true, true, false]);

// ── 3. Filas, material y conteo ──
const v = { proyecto: { id: "p1", grados: ["1", "2"] }, alumnos: alumnos, asignaciones: asignaciones, calIdx: calIdx, ajustes: [], hoy: HOY, corte: CORTE,
	productosPorSesion: { s1: [t2, pA, otro, t1, pN, pM] }, conCalificaciones: {}, abiertas: {}, pedida: null };
const orden = V.ordenarProductos(v.productosPorSesion.s1).map((p) => p.id);
ok("orden: como en Hoy (orden y luego el grado más bajo; sin grados al final de su orden)", orden, ["pN", "pA", "pM", "t1", "t2", "pO"]);
const ses1 = { id: "s1", proyecto_id: "p1", numero_sesion: 1, campo_formativo: "Lenguajes", fecha: null, estado_sesion: "pendiente",
	duracion: "Lunes 28 sep · 8:00 a 9:20 · Letras", momento: "Identificación",
	inicio_todos: "Saludo y canción de los nombres.",
	desarrollo_actividades: { mode: "todos", todos: ["Cada grupo trabaja su tarjeta (Múltiples Lenguajes de 1° (p. 6))."] },
	cierre_todos: "Compartimos las tarjetas.",
	recursos: { links: [
		{ titulo: "Anexo S01-01", url: "https://drive.google.com/file/d/abc/view" },
		{ titulo: "Libro — Múltiples Lenguajes 1°, p.6", url: "https://libros.conaliteg.gob.mx/2024/P1MLA.htm#page/6" },
	] } };
const filas = V.ordenarProductos(v.productosPorSesion.s1).map((p) => V.filaProducto(p, ses1, v));
ok("filaProducto: cuántos lo hacen y cuántos ya tienen calificación (una fila sin nada no cuenta)",
	filas.map((f) => [f.producto.id, f.quien.n, f.calificados]), [["pN", 2, 1], ["pA", 2, 0], ["pM", 2, 0], ["t1", 3, 0], ["t2", 3, 0], ["pO", 6, 0]]);
ok("filaProducto: una tarea de una sesión sin fecha se revisa después de trabajarla; con fecha, el siguiente día de clase",
	[filas[3].vence, V.filaProducto(t1, Object.assign({}, ses1, { fecha: "2026-10-01" }), v).vence, V.filaProducto(Object.assign({}, t1, { fecha_entrega: HOY }), ses1, v).vence],
	["se revisa el día de clase siguiente a la sesión", "se revisa el 2 oct", "se revisa hoy"]);
ok("resumen para el material: cuántos alumnos hacen cada actividad y cada tarea", V.resumenMaterial(filas),
	"4 actividades en clase: 2, 2, 2 y 6 alumnos · 2 tareas: 3 y 3 alumnos");
ok("resumen para el material: una sola actividad de un alumno", V.resumenMaterial([V.filaProducto(pM, ses1, { alumnos: alumnos, asignaciones: { pM: { a1: "incluir" } }, calIdx: {} })]),
	"1 actividad en clase: 1 alumno");
ok("conteo de la sesión (también plegada)", [V.conteoSesion(v.productosPorSesion.s1), V.conteoSesion([]), V.conteoSesion([pM])],
	["4 actividades en clase · 2 tareas", "Sin actividades calificables", "1 actividad en clase"]);

// ── 4. El HTML de una sesión ──
const h = V.htmlSesion(ses1, v);
ok("sesión: número, campo, horario (duracion), momento y estado", [/Sesión 1 · Lenguajes/.test(h), /data-horario>Lunes 28 sep · 8:00 a 9:20 · Letras</.test(h), />Identificación</.test(h), /data-estado-sesion='pendiente'[^>]*>Pendiente</.test(h)],
	[true, true, true, true]);
ok("sesión: cada actividad por nivel con quién la hace («· Morado: …»)",
	[/Tarjeta de nombre · Morado<\/span><span class='text-gray-700' data-quien>: SALAS PINO AMELIA, IBAÑEZ PLATA DARIO</.test(h),
		/Tarjeta de nombre · Naranja<\/span><span class='text-gray-700' data-quien>: BRAVO CHAVEZ GERMAN, PARRA MARIN MIRIAM</.test(h),
		/Platica en casa<\/span><span class='text-gray-700' data-quien>: 1° \(todos\)</.test(h)], [true, true, true]);
ok("sesión: qué es, cuántos alumnos y «N calificados»",
	[/data-tipo>Actividad en clase</.test(h), /data-tipo>Tarea para casa · se revisa el día de clase siguiente a la sesión</.test(h), /data-cuantos>2 alumnos</.test(h), /data-calificados>1 calificado</.test(h), /data-calificados>0 calificados</.test(h)],
	[true, true, true, true, true]);
ok("sesión: el resumen para el material y las listas «En clase» y «Tareas para casa»",
	[/data-material><span class='font-semibold'>Para el material:<\/span> 4 actividades en clase/.test(h), />En clase</.test(h), />Tareas para casa</.test(h)], [true, true, true]);
ok("sesión: una actividad de otro campo formativo lo dice", /<span>Saberes y Pensamiento Científico<\/span>/.test(h), true);
ok("sesión: la secuencia (inicio, desarrollo y cierre) con sus anexos y libros (el de CONALITEG en el visor; Drive en otra pestaña)",
	[/data-secuencia-fase='inicio'/.test(h), /data-secuencia-fase='desarrollo'/.test(h), /data-secuencia-fase='cierre'/.test(h),
		/<a href='https:\/\/drive\.google\.com\/file\/d\/abc\/view' target='_blank' rel='noopener noreferrer' data-secuencia-enlace='anexo' class=/.test(h),
		/data-secuencia-enlace='libro' data-visor-url='https:\/\/libros\.conaliteg\.gob\.mx/.test(h)], [true, true, true, true, true]);
const capturas = (h.match(/<button type='button' data-captura data-(agregar|para-quien|renombrar|quitar-producto)=/g) || []).length;
ok("sesión: agregar y, por cada actividad, Para quién, Renombrar y Quitar, con data-captura (solo lectura, b21)", capturas, 1 + 6 * 3);
ok("sesión: todos los botones y enlaces de la sesión miden 44 px de alto",
	(h.match(/<(button|a) [^>]*>/g) || []).filter((t) => !/data-secuencia-libro/.test(t)).every((t) => /min-h-\[44px\]/.test(t)), true);
ok("sesión: «Editar el plan» lleva a Crear proyecto en esa sesión (enlace relativo: no sale de /salon/)",
	/<a href='crear_proyecto\.html\?id=p1&sesion=s1' data-editar-plan='s1'/.test(h) && !/href='\//.test(h), true);
ok("sesión pendiente: abierta, sin el aviso de trabajada y con «+ Actividad o tarea»",
	[/id='cuerpo-ses-s1' class='border-t/.test(h), /data-aviso-trabajada/.test(h), /data-agregar='s1'/.test(h), /data-sin-agregar/.test(h)], [true, false, true, false]);
const enCurso = V.htmlSesion(Object.assign({}, ses1, { fecha: HOY, estado_sesion: "activa" }), v);
ok("sesión en curso: «En curso desde hoy», se trabajó (su plan no cambia; sus actividades sí) y se agrega",
	[/>En curso desde hoy</.test(enCurso), /data-aviso-trabajada[^>]*>Esta sesión ya se trabajó: su plan no cambia; sus actividades calificables sí\.</.test(enCurso), /data-agregar='s1'/.test(enCurso)],
	[true, true, true]);
const terminada = V.htmlSesion(Object.assign({}, ses1, { fecha: "2026-10-01", estado_sesion: "completada" }), v);
ok("sesión terminada: plegada, con el aviso, SIN agregar (no aparecería en Hoy) y con renombrar, quitar y para quién",
	[/id='cuerpo-ses-s1' class='hidden /.test(terminada), /aria-expanded='false'/.test(terminada), /data-aviso-trabajada/.test(terminada), /data-agregar=/.test(terminada),
		/data-sin-agregar>Sesión terminada: aquí ya no se agregan actividades/.test(terminada), /data-renombrar='pM'/.test(terminada), /data-quitar-producto='pM'/.test(terminada), /data-para-quien='pM'/.test(terminada)],
	[true, true, true, false, true, true, true, true]);
const pedida = V.htmlSesion(Object.assign({}, ses1, { fecha: "2026-10-01", estado_sesion: "completada" }), Object.assign({}, v, { pedida: "s1" }));
ok("?sesion=: la pedida sale abierta (aunque esté terminada) y resaltada", [/data-sesion-pedida/.test(pedida), /ring-2 ring-blue-400/.test(pedida), /id='cuerpo-ses-s1' class='border-t/.test(pedida)], [true, true, true]);
ok("lo que el docente plegó o abrió se respeta al volver a dibujar", /id='cuerpo-ses-s1' class='hidden /.test(V.htmlSesion(ses1, Object.assign({}, v, { abiertas: { s1: false } }))), true);
ok("sesión sin actividades ni secuencia: lo dice", [/Esta sesión no tiene actividades calificables\. Agrega una con «Actividad o tarea»\./.test(V.htmlSesion({ id: "s9", numero_sesion: 9 }, v)),
	/Esta sesión no trae secuencia registrada/.test(V.htmlSesion({ id: "s9", numero_sesion: 9 }, v))], [true, true]);
// «Quién hace» con más de 3 nombres: 3 y un botón «+ N más» de 44 px con aria-expanded; data-quien lleva el texto visible
const cuatro = V.htmlSesion(ses1, Object.assign({}, v, { asignaciones: Object.assign({}, v.asignaciones, { pM: { a1: "incluir", a2: "incluir", a3: "incluir", b1: "incluir" } }) }));
ok("sesión: con 4 nombres, 3 y «+ 1 más» (botón de 44 px, aria-expanded, aria-label); con 2 o 3, sin botón",
	[/data-quien>: <span data-quien-texto>BRAVO CHAVEZ GERMAN, PARRA MARIN MIRIAM, SALAS PINO AMELIA<\/span> <button type='button' data-quien-mas='1'/.test(cuatro),
		/data-quien-mas='1' data-corto='[^']*' data-completo='BRAVO CHAVEZ GERMAN, PARRA MARIN MIRIAM, SALAS PINO AMELIA, IBAÑEZ PLATA DARIO' aria-expanded='false' aria-label='Ver 1 alumno más' class='[^']*min-h-\[44px\][^']*'>\+ 1 más<\/button>/.test(cuatro),
		/data-quien-mas/.test(h)], [true, true, false]);
ok("sesión: escapa lo que viene de la base", /&lt;b&gt;/.test(V.htmlSesion({ id: "s8", numero_sesion: 8, campo_formativo: "<b>x</b>" }, v)) && !/<b>x<\/b>/.test(V.htmlSesion({ id: "s8", numero_sesion: 8, campo_formativo: "<b>x</b>" }, v)), true);

// ── 5. El índice ──
const indice = V.htmlIndice([ses1, Object.assign({}, ses1, { id: "s2", numero_sesion: 2, fecha: HOY, estado_sesion: "activa" }), Object.assign({}, ses1, { id: "s3", numero_sesion: 3, fecha: "2026-10-01", estado_sesion: "completada" })], v);
ok("índice: cuántas hay en cada estado y un botón de 44 px por sesión que lleva a ella",
	[/data-cuenta-estados>1 terminada · 1 en curso · 1 pendiente</.test(indice), (indice.match(/data-ir-sesion=/g) || []).length, /href='#ses-s2' data-ir-sesion='s2' aria-label='Sesión 2: En curso desde hoy' class='[^']*min-h-\[44px\] min-w-\[44px\]/.test(indice),
		/data-abrir-todas/.test(indice) && /data-plegar-todas/.test(indice)], [true, 3, true, true]);

// ── 6. Por qué falló (sin tecnicismos) ──
ok("textoError: red, sesión vencida, base sin migrar y un mensaje propio de la base",
	[V.textoError({ message: "Failed to fetch" }), V.textoError({ message: "JWT expired" }), V.textoError({ code: "42883", message: "function x does not exist" }), V.textoError({ message: "Mientras decidías, se calificó este producto; no se quitó." })],
	["no hubo conexión con el servidor", "tu sesión venció; vuelve a entrar", "la base de datos todavía no tiene la actualización que usa esta pantalla; avisa a soporte@jissez.com",
		"Mientras decidías, se calificó este producto; no se quitó"]);

// ── 7. Renombrar y Quitar: el módulo compartido con Hoy (js/producto-acciones.js) ──
function sbFalso(respuestas, registro) {
	return {
		from(tabla) {
			const q = { tabla, ops: [] };
			const cadena = {
				select(c, o) { q.ops.push(["select", c, o]); return cadena; },
				update(d) { q.ops.push(["update", d]); return cadena; },
				eq(k, x) { q.ops.push(["eq", k, x]); return cadena; },
				or(x) { q.ops.push(["or", x]); return cadena; },
				then(a, b) { registro.push(q); const r = respuestas.shift() || { data: null, error: null }; return Promise.resolve(r).then(a, b); },
			};
			return cadena;
		},
	};
}
function contexto(extra) {
	const reg = { mensajes: [], vista: [], dialogos: [], sb: [] };
	const o = Object.assign({
		maestroId: "m1", producto: { id: "pX", nombre: "Cartel", tipo: "trabajo", grados: ["1"], sesion_id: "s1" }, origen: { disabled: false },
		sinSenal: () => false, textoSinSenal: "Esto necesita señal. Inténtalo cuando vuelva la señal.", textoError: (e) => e.message,
		avisoALaVista: (t) => reg.vista.push(t), mensaje: (tipo, t) => reg.mensajes.push([tipo, t]),
	}, extra || {});
	return { o, reg };
}
// El diálogo de verdad necesita el DOM: aquí se guarda lo que se le pidió y se acepta a mano
const PQreal = global.ParaQuien;
global.ParaQuien = Object.assign({}, PQreal, { abrirDialogo(op) { ultimoDialogo = op; return {}; } });
let ultimoDialogo = null;
(async function () {
	let c = contexto({ conCaptura: () => true });
	c.o.sb = sbFalso([], c.reg.sb);
	await PA.quitar(c.o);
	ok("Quitar: con algo capturado en la pantalla no se quita (ni se pregunta a la base)",
		[c.reg.vista, c.reg.mensajes, c.reg.sb.length], [["«Cartel» ya tiene calificaciones, así que no se puede quitar. Si el nombre no es el correcto, usa Renombrar."], [], 0]);

	c = contexto({ sinSenal: () => true });
	c.o.sb = sbFalso([], c.reg.sb);
	await PA.quitar(c.o);
	PA.renombrar(c.o);
	ok("Quitar y Renombrar sin señal: lo dicen a la vista (sin la frase «Esto necesita señal.» repetida)",
		c.reg.vista, ["Quitar necesita señal. Inténtalo cuando vuelva la señal.", "Renombrar necesita señal. Inténtalo cuando vuelva la señal."]);

	c = contexto();
	c.o.sb = sbFalso([{ count: 2, error: null }], c.reg.sb);
	ultimoDialogo = null;
	await PA.quitar(c.o);
	const lectura = c.reg.sb[0];
	ok("Quitar: revisa la base (calificaciones de ESE producto con algo capturado) y, con calificaciones, no abre el diálogo",
		[lectura.tabla, lectura.ops.filter((x) => x[0] === "eq").map((x) => x[1] + "=" + x[2]), /estado_entrega\.not\.is\.null,nivel\.not\.is\.null,puntaje\.not\.is\.null,retroalimentacion\.not\.is\.null/.test(lectura.ops.find((x) => x[0] === "or")[1]),
			ultimoDialogo, c.reg.vista.length, c.reg.mensajes.length, c.o.origen.disabled],
		["calificaciones", ["maestro_id=m1", "producto_sesion_id=pX"], true, null, 1, 0, false]);

	c = contexto();
	c.o.sb = sbFalso([{ count: null, error: { message: "sin red" } }], c.reg.sb);
	await PA.quitar(c.o);
	ok("Quitar: si no se pudo revisar la base, no se quita y se dice", c.reg.vista, ["No se pudo revisar si tiene calificaciones, así que no se quitó: sin red."]);

	// Se abre el diálogo; mientras estaba abierto, alguien lo calificó (segunda revisión)
	c = contexto();
	c.o.sb = sbFalso([{ count: 0, error: null }, { count: 1, error: null }], c.reg.sb);
	await PA.quitar(c.o);
	ok("Quitar: el diálogo pide confirmar, en rojo", [ultimoDialogo.titulo, ultimoDialogo.aceptar, ultimoDialogo.peligro], ["¿Quitar «Cartel»?", "Quitar", true]);
	await ultimoDialogo.alAceptar({}, () => {});
	ok("Quitar: vuelve a revisar justo antes de escribir; si ya se calificó, «Mientras decidías…» y no escribe",
		[c.reg.vista, c.reg.mensajes, c.reg.sb.filter((q) => q.ops.some((x) => x[0] === "update")).length],
		[["Mientras decidías, se calificó «Cartel»; no se quitó. Recarga la página para ver esa calificación."], [], 0]);

	// La base lo rechaza (trigger productos_sesion_no_quitar_calificado, pista producto_con_calificaciones)
	c = contexto();
	c.o.sb = sbFalso([{ count: 0, error: null }, { count: 0, error: null }, { data: null, error: { message: "x", hint: "producto_con_calificaciones" } }], c.reg.sb);
	await PA.quitar(c.o);
	await ultimoDialogo.alAceptar({}, () => {});
	ok("Quitar: si la base lo rechaza con «producto_con_calificaciones», el mismo aviso", [c.reg.vista, c.reg.mensajes], [["Mientras decidías, se calificó «Cartel»; no se quitó. Recarga la página para ver esa calificación."], []]);

	let quitado = 0;
	c = contexto({ alQuitar: () => { quitado++; } });
	c.o.sb = sbFalso([{ count: 0, error: null }, { count: 0, error: null }, { data: null, error: null }], c.reg.sb);
	await PA.quitar(c.o);
	await ultimoDialogo.alAceptar({}, () => {});
	const upd = c.reg.sb[2];
	ok("Quitar: pone activo = false en ESE producto de ESE docente, la pantalla lo saca y lo dice",
		[upd.tabla, upd.ops[0], upd.ops.filter((x) => x[0] === "eq").map((x) => x[1] + "=" + x[2]), quitado, c.reg.mensajes],
		["productos_sesion", ["update", { activo: false }], ["id=pX", "maestro_id=m1"], 1, [["info", "Se quitó «Cartel»."]]]);

	let renombrado = null;
	c = contexto({ alRenombrar: (n) => { renombrado = n; } });
	c.o.sb = sbFalso([{ data: null, error: null }], c.reg.sb);
	PA.renombrar(c.o);
	ok("Renombrar: el diálogo de siempre", [ultimoDialogo.titulo, ultimoDialogo.subtitulo, ultimoDialogo.aceptar], ["Renombrar", "Actividad para 1°", "Guardar nombre"]);
	// El campo de texto lo arma construir con el DOM: uno mínimo, y se escribe el nombre nuevo como el docente
	global.document = { createElement(tag) {
		return { tag, attrs: {}, hijos: [], className: "", textContent: "", value: "",
			setAttribute(k, x) { this.attrs[k] = x; }, appendChild(h) { this.hijos.push(h); } };
	} };
	const cuerpo = { hijos: [], appendChild(h) { this.hijos.push(h); } };
	ultimoDialogo.construir(cuerpo);
	const campo = cuerpo.hijos[0].hijos[0];
	ok("Renombrar: el campo sale con el nombre de ahora, 44 px y el tope de letras", [campo.value, /min-h-\[44px\]/.test(campo.className), campo.attrs.maxlength], ["Cartel", true, String(PH.NOMBRE_MAX)]);
	campo.value = "Cartel";
	await ultimoDialogo.alAceptar({}, () => {});
	ok("Renombrar: el mismo nombre no escribe nada", c.reg.sb.length, 0);
	campo.value = "  Cartel   grande ";
	await ultimoDialogo.alAceptar({}, () => {});
	delete global.document;
	const updN = c.reg.sb[0];
	ok("Renombrar: guarda el nombre limpio en ESE producto, avisa a la pantalla y lo dice",
		[updN.tabla, updN.ops[0], updN.ops.filter((x) => x[0] === "eq").map((x) => x[1] + "=" + x[2]), c.o.producto.nombre, renombrado, c.reg.mensajes],
		["productos_sesion", ["update", { nombre: "Cartel grande" }], ["id=pX", "maestro_id=m1"], "Cartel grande", "Cartel grande", [["info", "Nombre guardado: «Cartel grande»."]]]);
	global.ParaQuien = PQreal;

	// ── 8. Cómo lo usan las pantallas ──
	const hoy = leer("js/hoy.js"), hoyHtml = leer("hoy.html"), pj = leer("js/proyecto.js"), ph = leer("proyecto.html"), acc = leer("js/producto-acciones.js");
	ok("Hoy usa el módulo para Renombrar y Quitar (sin copias) y le pasa lo suyo",
		[/window\.ProductoAcciones\.renombrar\(Object\.assign\(accionesDe\(producto, origen\)/.test(hoy), /await window\.ProductoAcciones\.quitar\(Object\.assign\(accionesDe\(producto, origen\)/.test(hoy),
			/conCaptura: function \(\) \{\s*return alumnos\.some\(function \(al\) \{\s*return window\.ProductosHoy\.tieneCaptura\(calificaciones\[al\.id \+ "\|" \+ producto\.id\]\);/.test(hoy),
			/from\("calificaciones"\)\.select\("id", \{ count: "exact", head: true \}\)/.test(hoy), /function campoTexto\(/.test(hoy)],
		[true, true, true, false, false]);
	ok("el módulo conserva los textos de Hoy", [/«" \+ nombre \+ "» ya tiene calificaciones, así que no se puede quitar\. Si el nombre no es el correcto, usa Renombrar\./.test(acc),
		/Ya no aparecerá para calificar y no cuenta en la boleta\. Nadie lo ha calificado todavía\./.test(acc), /"Nombre guardado: «" \+ v\.nombre \+ "»\."/.test(acc)], [true, true, true]);
	ok("proyecto.html: la barra en el <head>, la capa de lectura entre supabase y el candado, la bandeja (Cerrar sesión) y los módulos antes de js/proyecto.js",
		[ph.indexOf('src="js/navbar.js"') < ph.indexOf("</head>"), ph.indexOf('src="js/supabase.js"') < ph.indexOf('src="js/lectura.js"') && ph.indexOf('src="js/lectura.js"') < ph.indexOf('src="js/saas-guard.js"'),
			ph.indexOf('src="js/bandeja-salida.js"') !== -1,
			["leer-todo", "alcance-hoy", "productos-hoy", "para-quien", "actividad-nueva", "producto-acciones", "orden-lista", "secuencia-sesion", "sesion-terminar", "visor-recursos", "proyecto-edicion"]
				.every((m) => ph.indexOf('src="js/' + m + '.js"') !== -1 && ph.indexOf('src="js/' + m + '.js"') < ph.indexOf('src="js/proyecto.js"')),
			ph.indexOf('src="js/para-quien.js"') < ph.indexOf('src="js/actividad-nueva.js"')],
		[true, true, true, true, true]);
	ok("proyecto.js: lee sesiones y calificaciones paginadas, productos activos y su «para quién» por lotes",
		[/LeerTodo\.paginas\(function \(\) \{\s*return window\.sb\.from\("sesiones"\)\.select\(columnas\)\s*\.eq\("proyecto_id", proyecto\.id\)\.eq\("maestro_id", user\.id\)/.test(pj),
			/leerPorLotes\(ids, function \(lote\) \{\s*return window\.sb\.from\("productos_sesion"\)[\s\S]{0,200}\.in\("sesion_id", lote\)\.eq\("activo", true\)/.test(pj),
			/leerPorLotes\(idsProd, function \(lote\) \{\s*return window\.sb\.from\("producto_sesion_alumnos"\)/.test(pj),
			/LeerTodo\.paginas\(function \(\) \{\s*return window\.sb\.from\("calificaciones"\)[\s\S]{0,200}\.eq\("proyecto_id", proyecto\.id\)/.test(pj),
			/catch \(err\) \{[\s\S]{0,120}window\.Lectura\.detenerPagina\(err\);/.test(pj)], [true, true, true, true, true]);
	ok("proyecto.js: no es del grupo activo, no existe o es «Actividades del trimestre» → a Proyectos",
		/if \(!proyecto \|\| proyecto\.tipo === "sueltas" \|\| proyecto\.grupo_id !== grupo\.id\) \{ window\.location\.href = "planeacion\.html"; return; \}/.test(pj), true);
	ok("proyecto.js: agrega con el diálogo de Hoy, solo dentro y en ESA sesión; renombra y quita con el módulo; para quién con guardar_asignacion_producto",
		[/window\.ActividadNueva\.abrir\(\{[\s\S]{0,300}sesiones: \[ses\], sesionId: ses\.id, sesionSuelta: null, modo: "dentro",\s*soloDentro: true, revisaAlTrabajar: true,/.test(pj),
			/window\.ProductoAcciones\.renombrar\(/.test(pj), /window\.ProductoAcciones\.quitar\(/.test(pj),
			/window\.ParaQuien\.elegir\(\{/.test(pj) && /bloqueados: window\.ParaQuien\.bloqueados\(producto\.id, v\.alumnos, v\.calIdx\)/.test(pj),
			/rpc\("guardar_asignacion_producto", \{ p_producto: producto\.id, p_filas: filas \}\)/.test(pj) && /ProductosHoy\.filasDeEdicion\(producto\.grados, v\.alumnos, quieren\)/.test(pj)],
		[true, true, true, true, true]);
	ok("proyecto.js: una sesión terminada no ofrece agregar (tampoco si se llama a mano)", /if \(estadoSesion\(ses, v\.hoy, v\.corte\)\.clave === "terminada"\) return;/.test(pj), true);
	ok("proyecto.js: sin señal no abre nada y lo dice a la vista", ["Agregar una actividad o una tarea necesita señal", "Cambiar para quién es necesita señal"].every((t) => pj.indexOf('avisoALaVista("' + t) !== -1), true);

	// Crear proyecto: los que no son del plan, por nombre y para quién, de solo lectura, y el enlace a la vista
	const cp = leer("js/crear_proyecto.js");
	ok("Crear proyecto: lista por nombre y para quién lo que no es del plan (ya no «N actividades o tareas más») y enlaza a la vista",
		[/const \{ renglones, extras \} = pqRenglones\(block, pqProductos\);/.test(cp), /window\.ParaQuien\.quienHace\(p, pqAsignaciones\[p\.id\] \|\| \{\}, alumnosGrupo\)/.test(cp),
			/actividades o tareas más/.test(cp), /href="proyecto\.html\?id=' \+ encodeURIComponent\(proyectoId\) \+ '&sesion=' \+ encodeURIComponent\(block\.dataset\.sesionId\) \+ '"/.test(cp),
			/>Ver y gestionar en la vista del proyecto<\/a>/.test(cp), /pq-extras[\s\S]{0,900}(pq-cambiar|data-pq-clave)/.test(cp.slice(cp.indexOf("También en esta sesión"), cp.indexOf("También en esta sesión") + 900))],
		[true, true, false, true, true, false]);
	// Proyectos: "Ver proyecto" es la acción principal; "Editar" sigue a Crear proyecto
	const pl = leer("js/planeacion.js");
	const acciones = pl.slice(pl.indexOf("function renderAcciones"), pl.indexOf("function manejarClickGrid"));
	const bloques = ["borrador", "activo", "pausado", "completado"].map((e) => {
		const i = acciones.indexOf('if (estado === "' + e + '")');
		const j = acciones.indexOf("if (estado ===", i + 5);
		return acciones.slice(i, j === -1 ? acciones.indexOf("return ver + editar + duplicar;") : j);
	});
	ok("Proyectos: en todos los estados «Ver proyecto» (la vista) y «Editar» (Crear proyecto); ya no «Ver y editar sesiones»",
		[bloques.map((b) => /ver \+ editar/.test(b)), /const ver = '<a href="proyecto\.html\?id=' \+ id \+ '" data-ver-proyecto="' \+ id \+ '" class="' \+ btnBase \+ ' bg-blue-600/.test(pl),
			/const editar = '<a href="crear_proyecto\.html\?id=' \+ id \+ '"/.test(pl), /Ver y editar sesiones|>Ver sesiones</.test(pl), /return ver \+ editar \+ duplicar;/.test(pl)],
		[[true, true, true, true], true, true, false, true]);
	// Hoy: el ojo de las sesiones que faltan despliega la secuencia ahí mismo y, además, "Ver en el proyecto"
	ok("Hoy: con la secuencia de una sesión que falta desplegada, «Ver en el proyecto» (enlace relativo a la vista, en esa sesión)",
		/cuerpoSecuencia\(s\) \+[\s\S]{0,200}"<a href='proyecto\.html\?id=" \+ encodeURIComponent\(s\.proyecto_id \|\| ""\) \+ "&sesion=" \+ encodeURIComponent\(s\.id\) \+ "' data-ver-en-proyecto=/.test(hoy) &&
		/>Ver en el proyecto<\/a>/.test(hoy), true);
	ok("hoy.html: carga js/producto-acciones.js antes de js/hoy.js", hoyHtml.indexOf('src="js/producto-acciones.js"') !== -1 && hoyHtml.indexOf('src="js/producto-acciones.js"') < hoyHtml.indexOf('src="js/hoy.js"'), true);

	// El diálogo de agregar: las dos opciones de la vista no cambian el de Hoy
	const an = leer("js/actividad-nueva.js");
	ok("«+ Actividad o tarea»: soloDentro esconde el interruptor; revisaAlTrabajar quita el día de revisión en una sesión sin fecha; Hoy no las pasa",
		[/if \(ctx\.soloDentro\) fs\.classList\.add\("hidden"\);/.test(an), /function alTrabajar\(\) \{ return !!ctx\.revisaAlTrabajar && st\.modo === "dentro" && !!st\.sesion && !st\.sesion\.fecha; \}/.test(an),
			/if \(!esSuelta && alTrabajar\(\)\) ctxV\.sinFechaRevision = true;/.test(an), /soloDentro|revisaAlTrabajar/.test(hoy)], [true, true, true, false]);
	ok("validarNuevo: una tarea sin día solo con sinFechaRevision (la vista, en una sesión que aún no se trabaja): fecha_entrega null",
		[PH.validarNuevo({ nombre: "Leer", tipo: "tarea", campo: "LEN", grados: [1] }, { hoy: HOY, gradosSesion: [1] }).ok,
			PH.validarNuevo({ nombre: "Leer", tipo: "tarea", campo: "LEN", grados: [1] }, { hoy: HOY, gradosSesion: [1], sinFechaRevision: true }).fila.fecha_entrega,
			PH.validarNuevo({ nombre: "Leer", tipo: "tarea", campo: "LEN", grados: [1], fechaRevision: "2026-10-06" }, { hoy: HOY, gradosSesion: [1] }).fila.fecha_entrega],
		[false, null, "2026-10-06"]);

	// Rutas: la app instalada (/salon/) y la barra
	ok("_redirects: /salon/proyecto.html → /salon/proyecto (no sale de la app)", leer("_redirects").indexOf("/salon/proyecto.html /salon/proyecto 301") !== -1, true);
	const nav = leer("js/navbar.js");
	ok("barra: la vista es hija de Proyectos (se marca Proyectos) y se titula «Proyecto»", [/proyecto: "planeacion",/.test(nav), /proyecto: "Proyecto",/.test(nav)], [true, true]);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA excepción: " + (e && e.stack)); process.exit(1); });
