/*
	Incidencias (decisión de Jorge, 2026-09-25): js/incidencias.js, incidencias.html, la hoja del
	Excel (js/exportar.js) y la migración B13.

	- Documento imprimible: encabezado (escuela, grupo, ciclo, docente), datos de la incidencia y
	  tres firmas: Docente (su nombre), Director(a) (el del grupo o la línea en blanco con
	  "Director(a)") y Madre, padre o tutor.
	- Todo texto capturado se escapa (asunto, descripción, acuerdos, nombres, escuela, director,
	  docente, grupo, ids en atributos).
	- Validación del formulario, formatos de fecha y hora, orden de la lista.
	- La página: navegación en el head, candado del SaaS, impresión solo de la hoja, confirmación
	  al eliminar, guardado por la función de una transacción.
	- Base (lectura del .sql): RLS en las dos tablas, políticas con auth.uid() = maestro_id que
	  exigen grupo y alumnos propios, cascadas documentadas, delete_own_account las borra.
	La prueba en la base con dos cuentas (otra cuenta no ve ni escribe) es local, fuera de git: .qa-w/rls-incidencias.js.

	node pruebas/incidencias.test.js
*/
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const RAIZ = path.join(__dirname, "..");
const I = require(path.join(RAIZ, "js", "incidencias.js"));
const E = require(path.join(RAIZ, "js", "exportar.js"));

let fallos = 0;
function ok(nombre, real, esperado) {
	try { assert.deepStrictEqual(real, esperado); console.log("OK    " + nombre); }
	catch (e) { fallos++; console.log("FALLA " + nombre + "\n      esperado: " + JSON.stringify(esperado) + "\n      real:     " + JSON.stringify(real)); }
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");
const texto = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// ── Formatos ─────────────────────────────────────────────────────────────────
ok("fecha en español", [I.formatoFecha("2026-09-25"), I.formatoFecha("2026-01-01"), I.formatoFecha(""), I.formatoFecha("2026-13-01")],
	["25 de septiembre de 2026", "1 de enero de 2026", "", ""]);
ok("hora de 12 horas (a. m. / p. m.)", ["13:05:00", "00:30", "12:00", "09:15", "", "25:00"].map(I.formatoHora),
	["1:05 p. m.", "12:30 a. m.", "12:00 p. m.", "9:15 a. m.", "", ""]);
ok("fecha y hora; sin hora, solo la fecha",
	[I.fechaYHora({ fecha: "2026-09-25", hora: "10:40:00" }), I.fechaYHora({ fecha: "2026-09-25", hora: null })],
	["25 de septiembre de 2026, 10:40 a. m.", "25 de septiembre de 2026"]);

// ── Validación ───────────────────────────────────────────────────────────────
const base = { asunto: "Discusión", fecha: "2026-09-25", hora: "10:00", descripcion: "Se empujaron.", acuerdos: "", alumnos: ["a1"] };
const con = (cambio) => Object.assign({}, base, cambio);
ok("válida: todo lo obligatorio, hora y acuerdos opcionales", [I.validar(base, "2026-09-25"), I.validar(con({ hora: "" }), "2026-09-25")], ["", ""]);
ok("falta: asunto, fecha, alumnos, descripción (en ese orden, uno a la vez)",
	[I.validar(con({ asunto: "  " })), I.validar(con({ fecha: "" })), I.validar(con({ alumnos: [] })), I.validar(con({ descripcion: " " }))],
	["Escribe el asunto de la incidencia.", "Elige la fecha de la incidencia.", "Elige al menos un alumno involucrado.", "Escribe la descripción de lo que pasó."]);
ok("fecha futura no; largo máximo del asunto (150)",
	[I.validar(con({ fecha: "2026-09-26" }), "2026-09-25"), /máximo 150/.test(I.validar(con({ asunto: "x".repeat(151) })))],
	["La fecha no puede ser futura.", true]);
ok("orden: más reciente primero; sin hora al final de su día",
	I.ordenar([
		{ id: "a", fecha: "2026-09-20", hora: "08:00" }, { id: "b", fecha: "2026-09-25", hora: null },
		{ id: "c", fecha: "2026-09-25", hora: "13:00" }, { id: "d", fecha: "2026-09-25", hora: "09:00" },
	]).map((x) => x.id), ["c", "d", "b", "a"]);

// ── Documento: encabezado, datos y firmas ────────────────────────────────────
const inc = { asunto: "Pelea en el recreo", fecha: "2026-09-25", hora: "10:40:00", descripcion: "Línea 1\nLínea 2", acuerdos: "Hablar con ambos." };
const grupo = { nombre: "3°-4° A", ciclo_escolar: "2026-2027", escuela: "Esc. Benito Juárez", director_nombre: "Mtra. Rosa Díaz", multigrado: true };
const al1 = { nombre_completo: "PÉREZ LÓPEZ ANA", grado: 3, tutor_nombre: "María López" };
const al2 = { nombre_completo: "RUIZ SOTO LUIS", grado: 4, tutor_nombre: "Pedro Ruiz" };
const doc = I.documento({ incidencia: inc, alumnos: [al1, al2], grupo: grupo, docente: "Fanny Ruiz" });
const t = texto(doc);
ok("encabezado: escuela, título, grupo, ciclo y docente",
	["ESC. BENITO JUÁREZ".toLowerCase(), "registro de incidencia", "grupo 3°-4° a", "ciclo escolar 2026-2027", "docente fanny ruiz"].map((s) => t.toLowerCase().indexOf(s) !== -1),
	[true, true, true, true, true]);
ok("datos: asunto, fecha y hora, alumnos (con grado en multigrado), descripción y acuerdos",
	["Pelea en el recreo", "25 de septiembre de 2026, 10:40 a. m.", "PÉREZ LÓPEZ ANA (3°)", "RUIZ SOTO LUIS (4°)", "Alumnos involucrados", "Línea 1\nLínea 2", "Hablar con ambos."]
		.map((s) => doc.indexOf(s) !== -1), [true, true, true, true, true, true, true]);
ok("la descripción conserva los saltos de línea (pre-wrap, sin <br> armado a mano)", /<p class='inc-texto'>Línea 1\nLínea 2<\/p>/.test(doc), true);
const firmas = doc.slice(doc.indexOf("inc-firmas"));
ok("tres firmas en orden: Docente con su nombre, Director(a) con el del grupo, Madre, padre o tutor",
	texto(firmas.slice(firmas.indexOf(">") + 1)).replace(/ Registro interno.*$/, ""),
	"Fanny Ruiz Docente Mtra. Rosa Díaz Director(a) Madre, padre o tutor");
ok("con varios alumnos, la línea del tutor va sin nombre (no se elige un tutor por los demás)",
	/<p class='inc-firma-nombre'>&nbsp;<\/p><p class='inc-firma-rol'>Madre, padre o tutor<\/p>/.test(doc), true);
const docUno = I.documento({ incidencia: inc, alumnos: [al1], grupo: Object.assign({}, grupo, { director_nombre: "", multigrado: false }), docente: "Fanny Ruiz" });
ok("director vacío: la línea queda en blanco con «Director(a)»",
	/<p class='inc-firma-nombre'>&nbsp;<\/p><p class='inc-firma-rol'>Director\(a\)<\/p>/.test(docUno), true);
ok("un solo alumno: «Alumno involucrado», sin grado fuera de multigrado y con el nombre de su tutor en la línea",
	[/Alumno involucrado</.test(docUno), docUno.indexOf("PÉREZ LÓPEZ ANA (3°)") === -1, /<p class='inc-firma-nombre'>María López<\/p><p class='inc-firma-rol'>Madre, padre o tutor/.test(docUno)],
	[true, true, true]);
const docSin = I.documento({ incidencia: Object.assign({}, inc, { acuerdos: "", hora: null }), alumnos: [], sinAlumnos: true, grupo: { nombre: "G", ciclo_escolar: "" }, docente: "" });
ok("sin escuela: renglón para escribirla; sin acuerdos: tres renglones; sin alumnos: se dice por qué",
	[/Escuela: _{10,}/.test(docSin), (docSin.match(/class='inc-renglon'/g) || []).length, /se eliminaron del grupo/.test(docSin)], [true, 3, true]);
ok("sin docente registrado: la línea de Docente queda en blanco con su rol",
	/<p class='inc-firma-nombre'>&nbsp;<\/p><p class='inc-firma-rol'>Docente<\/p>/.test(docSin), true);
ok("pie: no es documento oficial de la SEP", /No es un documento oficial de la SEP/.test(doc), true);

// ── Escape de todo lo capturado ──────────────────────────────────────────────
const MAL = `<img src=x onerror="alert(1)">'"&`;
const docMal = I.documento({
	incidencia: { asunto: MAL, fecha: "2026-09-25", hora: "10:00", descripcion: MAL, acuerdos: MAL },
	alumnos: [{ nombre_completo: MAL, grado: 1, tutor_nombre: MAL }],
	grupo: { nombre: MAL, ciclo_escolar: MAL, escuela: MAL, director_nombre: MAL, multigrado: true },
	docente: MAL,
});
ok("documento: ningún texto capturado entra como HTML (ni comillas simples ni dobles)",
	[docMal.indexOf("<img"), docMal.indexOf('"alert'), docMal.indexOf("'\""), (docMal.match(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&#39;&quot;&amp;/g) || []).length],
	[-1, -1, -1, 11]); // escuela, grupo, ciclo, docente x2, asunto, alumno, descripción, acuerdos, director, tutor
const tar = I.tarjeta({ id: "x' onclick='alert(1)", asunto: MAL, fecha: "2026-09-25", hora: null, descripcion: MAL, acuerdos: MAL }, [MAL, "OTRO"]);
ok("tarjeta de la lista: asunto, descripción, alumnos, aria-label e id escapados",
	[tar.indexOf("<img"), tar.indexOf("x' onclick"), /data-id='x&#39; onclick=&#39;alert\(1\)'/.test(tar), /aria-label='Ver e imprimir: &lt;img/.test(tar)],
	[-1, -1, true, true]);
ok("esc: & < > \" ' ", I.esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");

// ── Página ───────────────────────────────────────────────────────────────────
const html = leer("incidencias.html");
const js = leer("js/incidencias.js");
const head = html.split("</head>")[0];
ok("página: navbar y app-instalada en el head, manifest de la app",
	[/<script src="js\/app-instalada\.js"><\/script>/.test(head), /<script src="js\/navbar\.js"><\/script>/.test(head), /salon\.webmanifest/.test(head)], [true, true, true]);
const orden = ["js/supabase.js", "js/lectura.js", "js/saas-guard.js", "js/secciones.js", "js/bandeja-salida.js", "js/grupo-activo.js", "js/leer-todo.js", "js/incidencias.js"]
	.map((s) => html.indexOf('src="' + s + '"'));
ok("página: candado del SaaS después de supabase y lectura y antes del script de la página (y leer-todo antes)",
	orden.every((v, i) => v > 0 && (i === 0 || v > orden[i - 1])), true);
ok("impresión: carta vertical, se ocultan la barra, la lista y los botones; solo la hoja",
	[/@page \{ size: letter portrait/.test(html), /@media print \{[\s\S]*#app-navbar, \.no-print, #incPantalla \{ display: none !important; \}/.test(html), /#incDocumento \{ display: block !important/.test(html)],
	[true, true, true]);
ok("firmas en tres columnas al imprimir", /@media print \{[\s\S]*\.inc-firmas \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(html), true);
ok("eliminar pide confirmación (diálogo con Cancelar y Sí, eliminar) y confirma el borrado en la base",
	[/id="incConfirmar"[^>]*role="dialog" aria-modal="true"/.test(html), /await confirmar\(/.test(js), /if \(!res\.data \|\| !res\.data\.length\) throw/.test(js)], [true, true, true]);
ok("guardar va por guardar_incidencia (una transacción) con el grupo activo",
	/sb\.rpc\("guardar_incidencia", \{[\s\S]*p_grupo_id: grupo\.id[\s\S]*p_alumnos: valores\.alumnos/.test(js), true);
ok("lecturas: por grupo y maestra, sin el tope de 1000 (Lectura.todas)",
	/Lectura\.todas\(function \(\) \{\s*return window\.sb\.from\("incidencias"\)[\s\S]*?\.eq\("maestro_id", maestroId\)\s*\.eq\("grupo_id", grupo\.id\)/.test(js), true);
ok("la escuela y el director salen del GRUPO (no del perfil)", /escuela: grupo\.escuela/.test(js) && /director_nombre: grupo\.director_nombre/.test(js) && !/perfiles"\)\.select\("[^"]*escuela/.test(js), true);
ok("controles de al menos 44 px (botones y casillas de alumnos)",
	(html.match(/<button[^>]*>/g) || []).every((b) => /min-h-\[44px\]/.test(b)) && /min-h-\[44px\] px-3 py-2 rounded-lg border border-gray-200/.test(js), true);
ok("sin Lucide por CDN ni emojis: íconos en línea", !/unpkg\.com\/lucide/.test(html) && /<svg/.test(html), true);

// ── Excel: hoja Incidencias ──────────────────────────────────────────────────
const hoja = E.hojaIncidencias([
	{ fecha: "2026-09-20", hora: "08:00:00", asunto: "A", descripcion: "d", acuerdos: null, created_at: "2026-09-20T15:00:00Z", incidencia_alumnos: [{ alumno_id: "1" }] },
	{ fecha: "2026-09-25", hora: null, asunto: "B", descripcion: "e", acuerdos: "x", created_at: "2026-09-25T15:00:00Z", incidencia_alumnos: [{ alumno_id: "1" }, { alumno_id: "2" }, { alumno_id: "borrado" }] },
	{ fecha: "2026-09-21", hora: "09:00:00", asunto: "C", descripcion: "f", acuerdos: "", created_at: "", incidencia_alumnos: [] },
], { 1: "ANA", 2: "LUIS" });
ok("Excel: encabezado de la hoja Incidencias", hoja[0], ["Fecha", "Hora", "Asunto", "Alumnos involucrados", "Descripción", "Acuerdos o compromisos", "Registrada el"]);
ok("Excel: la más reciente primero, hora HH:MM, alumnos con ; y sin alumnos explicado",
	hoja.slice(1), [
		["2026-09-25", "", "B", "ANA; LUIS", "e", "x", "2026-09-25"],
		["2026-09-21", "09:00", "C", "Sin alumnos (se eliminaron del grupo)", "f", "", ""],
		["2026-09-20", "08:00", "A", "ANA", "d", "", "2026-09-20"],
	]);
ok("Excel: sin incidencias, una fila que lo dice", E.hojaIncidencias([], {}), [hoja[0], ["Sin incidencias registradas en este grupo."]]);
const hojas = [];
const XLSXf = {
	utils: {
		book_new: () => ({ SheetNames: [], Sheets: {} }),
		aoa_to_sheet: (aoa) => ({ aoa }),
		book_append_sheet: (wb, ws, nombre) => { wb.SheetNames.push(nombre); hojas.push(ws); },
	},
};
const tablaMin = { encabezados: ["Alumno"], filas: [["ANA"]], maximos: [["ANA"]] };
ok("Excel: con incidencias leídas, cuarta hoja «Incidencias»; sin leerlas, las tres de siempre",
	[E.libroXLSX(XLSXf, tablaMin, { incidencias: [], nombrePorId: {} }).SheetNames, E.libroXLSX(XLSXf, tablaMin, {}).SheetNames],
	[["Concentrado", "Máximos", "Léeme", "Incidencias"], ["Concentrado", "Máximos", "Léeme"]]);
ok("Excel: la hoja Léeme menciona la hoja Incidencias", E.hojaLeeme({}).some((f) => /«Incidencias»/.test(f[1] || "")), true);
ok("exportar.html carga leer-todo antes de exportar.js",
	leer("exportar.html").indexOf('src="js/leer-todo.js"') !== -1 && leer("exportar.html").indexOf('src="js/leer-todo.js"') < leer("exportar.html").indexOf('src="js/exportar.js"'), true);

// ── Migración B13 ────────────────────────────────────────────────────────────
const sql = leer("supabase/mi_salon_b13_ficha_incidencias_2026-09.sql");
const codigo = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
ok("RLS encendida en las dos tablas", [/alter table public\.incidencias enable row level security/.test(codigo), /alter table public\.incidencia_alumnos enable row level security/.test(codigo)], [true, true]);
ok("sin permisos para anon", [/revoke all on public\.incidencias from anon/.test(codigo), /revoke all on public\.incidencia_alumnos from anon/.test(codigo)], [true, true]);
const pol = [...codigo.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+) to authenticated([\s\S]*?);\n/g)].map((m) => ({ n: m[1], t: m[2], cmd: m[3], cuerpo: m[4] }));
ok("políticas: incidencias con select/insert/update/delete; la puente con select/insert/delete (sin update)",
	[pol.filter((p) => p.t === "incidencias").map((p) => p.cmd).sort(), pol.filter((p) => p.t === "incidencia_alumnos").map((p) => p.cmd).sort()],
	[["delete", "insert", "select", "update"], ["delete", "insert", "select"]]);
ok("toda política exige auth.uid() = maestro_id",
	pol.every((p) => /\(select auth\.uid\(\)\) = maestro_id/.test(p.cuerpo)), true);
ok("insert y update de incidencias exigen que el grupo sea de la maestra",
	pol.filter((p) => p.t === "incidencias" && (p.cmd === "insert" || p.cmd === "update"))
		.every((p) => /with check \([\s\S]*exists \(select 1 from public\.grupos g where g\.id = grupo_id and g\.maestro_id = \(select auth\.uid\(\)\)\)/.test(p.cuerpo)), true);
ok("insert de la puente exige incidencia y alumno de la maestra y del MISMO grupo",
	/join public\.alumnos a on a\.grupo_id = i\.grupo_id[\s\S]*i\.maestro_id = \(select auth\.uid\(\)\)[\s\S]*a\.maestro_id = \(select auth\.uid\(\)\)/.test(pol.find((p) => p.t === "incidencia_alumnos" && p.cmd === "insert").cuerpo), true);
ok("cascadas: borrar el grupo borra sus incidencias; borrar un alumno solo lo quita de ellas",
	[/grupo_id\s+uuid not null references public\.grupos \(id\) on delete cascade/.test(codigo),
		/alumno_id\s+uuid not null references public\.alumnos \(id\) on delete cascade/.test(codigo),
		/incidencia_id uuid not null references public\.incidencias \(id\) on delete cascade/.test(codigo)], [true, true, true]);
ok("guardar_incidencia: security invoker, search_path vacío, exige alumno, sin permisos para anon",
	[/function public\.guardar_incidencia\([\s\S]*?security invoker\s+set search_path = ''/.test(codigo), /cardinality\(v_alumnos\) = 0/.test(codigo),
		/revoke all on function public\.guardar_incidencia\([^)]*\) from public, anon/.test(codigo)], [true, true, true]);
ok("delete_own_account borra las incidencias (y la puente) antes de la cuenta",
	/delete from public\.incidencia_alumnos where maestro_id = v;\s*delete from public\.incidencias where maestro_id = v;\s*delete from auth\.users where id = v;/.test(codigo), true);
ok("aditiva: no borra tablas, columnas ni datos ajenos",
	/\bdrop (table|column)\b|\btruncate\b|alter table [^;]* drop /i.test(codigo), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
