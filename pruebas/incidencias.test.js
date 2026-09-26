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

// ── Dos tantos por alumno y resumen para el expediente (Jorge, 2026-09-25 y 2026-09-26) ──
const MAL_F = `<img src=x onerror="alert(1)">`;
const al3 = { nombre_completo: "SOTO DÍAZ ELENA", grado: 3, tutor_nombre: "" };
const dVarios = { incidencia: inc, alumnos: [al1, al2, al3], grupo: grupo, docente: "Fanny Ruiz" };
const fam = I.hojasFamilias(dVarios);
const ALS = [al1, al2, al3];
ok("familias: DOS hojas por alumno (3 alumnos, 6 hojas), cada una un artículo aparte",
	[fam.length, fam.every((h) => (h.match(/<article /g) || []).length === 1)], [6, true]);
ok("familias: por alumno, primero el «Ejemplar para el expediente» y luego la «Copia para la familia»",
	fam.map((h) => (h.match(/data-copia='(\w+)'/) || [])[1]), ["expediente", "familia", "expediente", "familia", "expediente", "familia"]);
ok("familias: cada hoja lleva SOLO a su alumno (ningún nombre de los otros)",
	fam.map((h, i) => ALS.map((a, j) => h.indexOf(a.nombre_completo) !== -1 ? j : -1).filter((j) => j !== -1).join(",") === String(Math.floor(i / 2))), [true, true, true, true, true, true]);
ok("familias: «Alumno involucrado» en singular y la leyenda de su tanto",
	fam.every((h, i) => /Alumno involucrado</.test(h) && !/Alumnos involucrados/.test(h) &&
		(i % 2 === 0 ? /<span class='inc-copia-titulo'>Ejemplar para el expediente<\/span> <span class='inc-copia-nota'>Lo firma la familia y se queda con la docente\.<\/span>/.test(h)
			: /<span class='inc-copia-titulo'>Copia para la familia<\/span> <span class='inc-copia-nota'>La firma la familia y se la queda\.<\/span>/.test(h))), true);
ok("familias: las dos hojas llevan firma de la familia (las tres firmas), con el tutor de ESE alumno (en blanco si su ficha no lo tiene)",
	[fam.every((h) => /<p class='inc-firma-rol'>Madre, padre o tutor<\/p>/.test(h) && /<p class='inc-firma-rol'>Docente<\/p>/.test(h) && /<p class='inc-firma-rol'>Director\(a\)<\/p>/.test(h) && !/inc-firmas-2/.test(h)),
		[0, 1].every((i) => /<p class='inc-firma-nombre'>María López<\/p><p class='inc-firma-rol'>Madre, padre o tutor/.test(fam[i])),
		[2, 3].every((i) => /<p class='inc-firma-nombre'>Pedro Ruiz<\/p><p class='inc-firma-rol'>Madre, padre o tutor/.test(fam[i])),
		[4, 5].every((i) => /<p class='inc-firma-nombre'>&nbsp;<\/p><p class='inc-firma-rol'>Madre, padre o tutor/.test(fam[i])),
		fam[0].indexOf("Pedro Ruiz") === -1 && fam[2].indexOf("María López") === -1], [true, true, true, true, true]);
ok("familias: la misma descripción, acuerdos, escuela, director y docente en cada hoja",
	fam.every((h) => h.indexOf("Línea 1\nLínea 2") !== -1 && h.indexOf("Hablar con ambos.") !== -1 && h.indexOf("Esc. Benito Juárez") !== -1 && h.indexOf("Mtra. Rosa Díaz") !== -1 && h.indexOf("Fanny Ruiz") !== -1), true);
const res = I.hojaResumen(dVarios);
ok("resumen: una hoja con los tres alumnos y la leyenda «Resumen para el expediente»",
	[ALS.every((a) => res.indexOf(a.nombre_completo) !== -1), /Alumnos involucrados/.test(res), /<span class='inc-copia-titulo'>Resumen para el expediente<\/span>/.test(res), (res.match(/<article /g) || []).length, /data-copia='resumen'/.test(res)],
	[true, true, true, 1, true]);
const firmasRes = res.slice(res.indexOf("inc-firmas"));
ok("resumen: firma solo de docente y director(a), sin líneas para las familias",
	[texto(firmasRes.slice(firmasRes.indexOf(">") + 1)).replace(/ Registro interno.*$/, ""), /Madre, padre o tutor/.test(res), /class='inc-firmas inc-firmas-2'/.test(res)],
	["Fanny Ruiz Docente Mtra. Rosa Díaz Director(a)", false, true]);
ok("un solo alumno: también dos tantos (expediente y familia), con el nombre de su tutor",
	[I.hojasFamilias({ incidencia: inc, alumnos: [al1], grupo: grupo }).length, I.hojasFamilias({ incidencia: inc, alumnos: [al1], grupo: grupo }).map((h) => (h.match(/data-copia='(\w+)'/) || [])[1]),
		I.hojasFamilias({ incidencia: inc, alumnos: [al1], grupo: grupo }).every((h) => /<p class='inc-firma-nombre'>María López<\/p>/.test(h))],
	[2, ["expediente", "familia"], true]);
ok("la hoja sin tanto (incidencia sin alumnos) no lleva leyenda y sí las tres firmas", [/inc-copia/.test(doc), /Madre, padre o tutor/.test(doc)], [false, true]);
// Medido con PDF (constructor Y, v06-hoja-larga.js): 1400 + 400 caracteres caben en una carta; 1600 + 500 no
const txt = (n) => "x".repeat(n);
ok("cabe en una carta: 1400 + 400 sí; 1600 + 500 no; con 5 alumnos en la lista del expediente, menos",
	[I.cabeEnCarta({ descripcion: txt(1400), acuerdos: txt(400) }, 1), I.cabeEnCarta({ descripcion: txt(1600), acuerdos: txt(500) }, 1),
		I.cabeEnCarta({ descripcion: txt(1400), acuerdos: txt(400) }, 5), I.cabeEnCarta({ descripcion: "Corta.\nDos renglones.", acuerdos: "" }, 3)],
	[true, false, false, true]);
ok("sin alumnos: ninguna hoja para familias", I.hojasFamilias({ incidencia: inc, alumnos: [], grupo: grupo }).length, 0);
ok("familias y resumen: nombres escapados", [I.hojasFamilias({ incidencia: inc, alumnos: [{ nombre_completo: MAL_F, tutor_nombre: MAL_F }, al2], grupo: grupo }).join("").indexOf("<img"),
	I.hojaResumen({ incidencia: inc, alumnos: [{ nombre_completo: MAL_F, tutor_nombre: MAL_F }, al2], grupo: grupo }).indexOf("<img")], [-1, -1]);

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
ok("botones: «Imprimir para las familias (2 hojas por alumno)» y «Imprimir resumen para mi expediente»",
	[/id="incImprimirFamiliasBtn"[\s\S]*?Imprimir para las familias \(2 hojas por alumno\)/.test(html), /id="incImprimirExpedienteBtn"[\s\S]*?Imprimir resumen para mi expediente/.test(html),
		/imprimirVersion\("familias"/.test(js) && /imprimirVersion\("resumen"/.test(js)], [true, true, true]);
ok("con alumnos se imprimen los dos tantos; el resumen solo con varios alumnos; la hoja sola solo sin alumnos",
	[/el\.imprimir\.classList\.toggle\("hidden", n > 0\)/.test(js), /el\.imprimirFamilias\.classList\.toggle\("hidden", n === 0\)/.test(js), /el\.imprimirExpediente\.classList\.toggle\("hidden", n <= 1\)/.test(js)],
	[true, true, true]);
ok("la ayuda explica los dos tantos y el resumen",
	[/El «Ejemplar para el expediente» lo firma la familia y se queda contigo; la «Copia para la familia» también la firma y se la lleva\./.test(js), /el resumen para tu expediente, con los " \+ n \+ " alumnos y firma solo tuya y del director o directora/.test(js)], [true, true]);
ok("impresión: cada hoja empieza en su propia página carta (no se mezcla con otra)",
	/@media print \{[\s\S]*\.inc-hoja \+ \.inc-hoja \{[^}]*break-before: page; page-break-before: always;/.test(html), true);
ok("impresión: el resumen con dos firmas en dos columnas", /@media print \{[\s\S]*\.inc-firmas\.inc-firmas-2 \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(html), true);
ok("al guardar no se agrega ninguna casilla de datos sensibles (basta el aviso del formulario)",
	[/<input[^>]*type="checkbox"/.test(html.slice(html.indexOf('id="incForm"'), html.indexOf("</form>"))), /No escribas diagnósticos médicos ni datos de salud/.test(html)], [false, true]);
ok("el formulario pide no escribir nombres de otros alumnos en la descripción", /evita escribir aquí los nombres de los otros alumnos/.test(html), true);

// ── Excel: hoja Incidencias ──────────────────────────────────────────────────
const hoja = E.hojaIncidencias([
	{ fecha: "2026-09-20", hora: "08:00:00", asunto: "A", descripcion: "d", acuerdos: null, created_at: "2026-09-20T15:00:00Z", incidencia_alumnos: [{ alumno_id: "1" }] },
	{ fecha: "2026-09-25", hora: null, asunto: "B", descripcion: "e", acuerdos: "x", created_at: "2026-09-25T15:00:00Z", incidencia_alumnos: [{ alumno_id: "2" }, { alumno_id: "1" }, { alumno_id: "borrado" }] },
	{ fecha: "2026-09-21", hora: "09:00:00", asunto: "C", descripcion: "f", acuerdos: "", created_at: "", incidencia_alumnos: [] },
], { 1: "ANA", 2: "LUIS" }, { 1: { grado: 3, num_lista: 1 }, 2: { grado: 3, num_lista: 2 } });
ok("Excel: encabezado de la hoja Incidencias", hoja[0], ["Fecha", "Hora", "Asunto", "Alumnos involucrados", "Descripción", "Acuerdos o compromisos", "Registrada el"]);
ok("Excel: la más reciente primero, hora HH:MM, alumnos en orden de lista con ; y sin alumnos explicado",
	hoja.slice(1), [
		["2026-09-25", "", "B", "ANA; LUIS", "e", "x", "2026-09-25"],
		["2026-09-21", "09:00", "C", "Sin alumnos (se eliminaron del grupo)", "f", "", ""],
		["2026-09-20", "08:00", "A", "ANA", "d", "", "2026-09-20"],
	]);
ok("Excel: alumnos en orden de lista en multigrado (grado y número de lista, no el orden de captura)",
	E.hojaIncidencias([{ fecha: "2026-09-25", asunto: "M", descripcion: "d", incidencia_alumnos: [{ alumno_id: "c" }, { alumno_id: "a" }, { alumno_id: "b" }] }],
		{ a: "ZETA", b: "BETO", c: "ALMA" }, { a: { grado: 3, num_lista: 2 }, b: { grado: 3, num_lista: 7 }, c: { grado: 4, num_lista: 1 } })[1][3], "ZETA; BETO; ALMA");
ok("Excel: «Registrada el» en la fecha local de México (21:00 del 25 en México son las 03:00Z del 26)",
	[E.fechaMexico("2026-09-26T03:00:00Z"), E.fechaMexico("2026-09-26T05:59:00+00:00"), E.fechaMexico("2026-09-26T06:00:00Z"), E.fechaMexico(""), E.fechaMexico(null)],
	["2026-09-25", "2026-09-25", "2026-09-26", "", ""]);
ok("Excel: la columna usa la fecha de México", E.hojaIncidencias([{ fecha: "2026-09-25", asunto: "N", descripcion: "d", created_at: "2026-09-26T02:30:00Z", incidencia_alumnos: [] }], {})[1][6], "2026-09-25");
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
const unaInc = [{ fecha: "2026-09-25", asunto: "A", descripcion: "d", incidencia_alumnos: [] }];
ok("Excel: la hoja «Incidencias» solo si el grupo tiene incidencias; sin ellas, las tres hojas de siempre",
	[E.libroXLSX(XLSXf, tablaMin, { incidencias: unaInc, nombrePorId: {} }).SheetNames, E.libroXLSX(XLSXf, tablaMin, { incidencias: [], nombrePorId: {} }).SheetNames, E.libroXLSX(XLSXf, tablaMin, {}).SheetNames],
	[["Concentrado", "Máximos", "Léeme", "Incidencias"], ["Concentrado", "Máximos", "Léeme"], ["Concentrado", "Máximos", "Léeme"]]);
// El renglón «Hojas» de la Léeme de 016770a (antes de B13 y B14), palabra por palabra
const HOJAS_016770A = "«Concentrado»: una fila por alumno. «Máximos»: el máximo posible de cada alumno, en la misma celda que su obtenido. «Léeme»: esta explicación. El CSV trae solo la hoja «Concentrado».";
const renglonHojas = (meta) => E.hojaLeeme(meta).find((f) => f[0] === "Hojas")[1];
ok("Léeme: sin incidencias ni ajustes, el renglón «Hojas» queda exactamente como en 016770a",
	[renglonHojas({}), renglonHojas({ incidencias: [], ajustesCalendario: [] })], [HOJAS_016770A, HOJAS_016770A]);
ok("Léeme: sin incidencias ni ajustes, la hoja entera es la de antes (sin renglones de más)",
	E.hojaLeeme({ incidencias: [], ajustesCalendario: [] }).some((f) => f[0] === "Calendario" || /Incidencias|Calendario/.test(f[1] || "")), false);
ok("Léeme: el renglón «Hojas» menciona «Incidencias» solo si la hoja está",
	[/«Incidencias»: las incidencias registradas del grupo/.test(renglonHojas({ incidencias: unaInc })), /«Incidencias»/.test(renglonHojas({ incidencias: [] }))], [true, false]);
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
	/delete from public\.incidencia_alumnos where maestro_id = v;\s*delete from public\.incidencias where maestro_id = v;[\s\S]*?delete from auth\.users where id = v;/.test(codigo), true);
// b13 y b14 redefinen delete_own_account: la de b13 trae también el calendario y el aseo (con
// guarda to_regclass), así la última que se aplique borra todo, sea cual sea el orden
ok("delete_own_account de b13 también borra roles_aseo y calendario_ajustes si existen (orden b13 → b14 o al revés)",
	[/if to_regclass\('public\.roles_aseo'\) is not null then\s*execute 'delete from public\.roles_aseo where maestro_id = \$1' using v;/.test(codigo),
		/if to_regclass\('public\.calendario_ajustes'\) is not null then\s*execute 'delete from public\.calendario_ajustes where maestro_id = \$1' using v;/.test(codigo)], [true, true]);
ok("aditiva: no borra tablas, columnas ni datos ajenos",
	/\bdrop (table|column)\b|\btruncate\b|alter table [^;]* drop /i.test(codigo), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
