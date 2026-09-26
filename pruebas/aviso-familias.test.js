/*
	Aviso para las familias en Mi grupo (js/aviso-familias.js; decisión de Jorge, 2026-09-25):
	  - el texto dice lo que la maestra lleva en Mi Salón (lista, asistencia, calificaciones y
	    trabajos, participación y conducta, diagnóstico, observaciones, ficha con fecha de
	    nacimiento, género y datos del tutor, incidencias y, desde el 2026-09-26, las listas de
	    cooperación y materiales: lo mismo que el Aviso de privacidad),
	    que solo ella lo ve y que pueden pedirle corregirlo o borrarlo; al final, "Más información:
	    jissez.com/tienda/privacidad" (Jorge, 2026-09-26); sin emojis;
	  - Compartir por WhatsApp: wa.me sin número, con el texto;
	  - la página tiene Copiar, Compartir por WhatsApp e Imprimir (44 px) y carga el script;
	  - al imprimir sale solo la hoja del aviso.

	node pruebas/aviso-familias.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const A = require(path.join(RAIZ, "js", "aviso-familias.js"));
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const t = A.TEXTO;
ok("dice qué lleva: lista, asistencia, calificaciones, ficha (fecha de nacimiento, género y tutor) e incidencias",
	[/lista del grupo/, /asistencia/, /calificaciones/, /ficha de cada alumno \(fecha de nacimiento, género y datos de la madre, padre o tutor\)/, /registro de incidencias/].map((r) => r.test(t)),
	[true, true, true, true, true]);
// Decisión de Jorge (2026-09-26): lo que el aviso de privacidad sí lista de los alumnos
ok("también lista participación y conducta, diagnóstico y observaciones (como el aviso de privacidad)",
	[/la participación y la conducta/, /el diagnóstico \(cuaderno, lectura y matemáticas\)/, /mis observaciones/, /los trabajos/].map((r) => r.test(t)), [true, true, true, true]);
const priv = leer("tienda/privacidad.html");
const delAlumno = (priv.match(/<li><strong>Del alumno:<\/strong>([^<]*)<\/li>/) || [])[1] || "";
ok("cada dato del alumno que lista el aviso de privacidad sale en el aviso a las familias",
	["asistencia", "calificaciones", "participación", "conducta", "diagnóstico", "observaciones", "fecha de nacimiento", "género"].map((p) => [delAlumno.indexOf(p) !== -1, t.indexOf(p) !== -1]),
	["asistencia", "calificaciones", "participación", "conducta", "diagnóstico", "observaciones", "fecha de nacimiento", "género"].map(() => [true, true]));
// Decisión de Jorge (2026-09-26): también las listas de cooperación y materiales (b15)
ok("también menciona las listas de cooperación y materiales (como el aviso de privacidad)",
	[/el registro de incidencias y las listas de cooperación y materiales del grupo \(quién entregó y cuánto aportó\)\./.test(t),
		/<li><strong>Listas de cooperación y materiales del grupo, si usted las usa:<\/strong>/.test(priv)], [true, true]);
ok("termina con «Más información: jissez.com/tienda/privacidad»", [/ Más información: jissez\.com\/tienda\/privacidad$/.test(t), A.ENLACE_PRIVACIDAD], [true, "jissez.com/tienda/privacidad"]);
ok("dice que solo ella lo ve y que pueden pedir corregir o borrar", [/Solo yo veo esa información/.test(t), /corrijo o lo borro/.test(t)], [true, true]);
ok("dice que es Mi Salón, herramienta personal (no oficial)", /Mi Salón, una herramienta personal/.test(t), true);
ok("un solo párrafo corto (sin saltos, menos de 800 caracteres)", [/\n/.test(t), t.length < 800], [false, true]);
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;
ok("sin emojis", SIMBOLOS.test(t), false);
const wa = A.enlaceWhatsApp(t);
ok("WhatsApp: wa.me sin número, con el texto completo", [wa.indexOf("https://wa.me/?text=") === 0, decodeURIComponent(wa.slice("https://wa.me/?text=".length)) === t], [true, true]);

const html = leer("mi-grupo.html");
ok("Mi grupo: sección con Copiar, Compartir por WhatsApp e Imprimir",
	[/id="avisoFamilias"/, /id="avisoFamiliasCopiar"[\s\S]*?Copiar/, /id="avisoFamiliasWhatsApp"[^>]*target="_blank" rel="noopener noreferrer"[\s\S]*?Compartir por WhatsApp/, /id="avisoFamiliasImprimir"[\s\S]*?Imprimir/].map((r) => r.test(html)),
	[true, true, true, true]);
const seccion = html.slice(html.indexOf('id="avisoFamilias"'), html.indexOf("</section>", html.indexOf('id="avisoFamilias"')));
ok("botones de al menos 44 px", (seccion.match(/<(button|a) [^>]*>/g) || []).every((b) => /min-h-\[44px\]/.test(b)), true);
ok("carga js/aviso-familias.js antes de mi-grupo.js", html.indexOf('src="js/aviso-familias.js"') > 0 && html.indexOf('src="js/aviso-familias.js"') < html.indexOf('src="js/mi-grupo.js"'), true);
ok("al imprimir sale solo la hoja del aviso", /@media print \{[\s\S]*body\.imprime-aviso > \*:not\(#avisoFamiliasHoja\) \{ display: none !important; \}/.test(html), true);
ok("sin emojis en la sección", SIMBOLOS.test(seccion), false);

// ── Aviso de privacidad (tienda/privacidad.html), tras R19a y las decisiones del 2026-09-26 ──
const txtPriv = priv.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("privacidad: los datos de los alumnos no van a Anthropic SALVO las frases sin nombre del punto 4 (sin contradicción)",
	[/no se envían a Meta ni a Anthropic, salvo las frases sin nombre que se describen arriba, en este mismo punto/.test(txtPriv),
		/no se envían a Meta ni a Anthropic\. /.test(txtPriv), /se envían las frases sobre el desempeño y el grado, sin el nombre del alumno/.test(txtPriv)],
	[true, false, true]);
ok("privacidad: calendario y rol de aseo en los datos, la imagen con nombres que comparte la docente, y se borran con el grupo",
	[/Calendario y rol de aseo del grupo, si usted los usa:/.test(txtPriv), /La imagen del rol de aseo lleva los nombres de los alumnos: usted decide con quién la comparte\./.test(txtPriv),
		/Eliminar un grupo borra a sus alumnos con todo su registro, sus incidencias, su calendario, su rol de aseo/.test(txtPriv), /imágenes del rol de aseo/.test(txtPriv)],
	[true, true, true, true]);
ok("privacidad: incidencias en dos tantos por alumno y el resumen solo para el expediente",
	[/dos hojas por cada alumno, las dos solo con el nombre de ese alumno y firmadas por su familia/.test(txtPriv), /el resumen con todos los nombres es solo para el expediente del docente/.test(txtPriv),
		/imprime una hoja para cada familia/.test(txtPriv)], [true, true, false]);
// Listas aprobadas por Jorge (2026-09-26), con las sugerencias de R21
ok("privacidad: listas publicadas (sin comentarios de propuesta) y con fecha de actualización",
	[/PROPUESTA|PENDIENTE DE APROBACI/.test(priv), /<p class="mt-2 text-mute">Última actualización: \d{1,2} de [a-z]+ de 2026<\/p>/.test(priv)], [false, true]);
ok("privacidad: Mi Salón no pone nombres en lo de las familias; la descripción y las columnas son texto de la docente",
	[/En la imagen y el texto de una lista para las familias, Mi Salón no pone nombres de alumnos/.test(txtPriv),
		/La descripción de la lista y los nombres de sus columnas son texto que usted escribe y salen tal cual en esa imagen y ese texto; le pedimos no escribir en ellos nombres de alumnos\./.test(txtPriv)],
	[true, true]);
ok("privacidad: «Recordar por WhatsApp» y la imagen de las listas en el punto 4; imágenes e impresiones de las listas y los mensajes en el 6",
	[/Cuando usted toca "Escribir por WhatsApp" o "Recordar por WhatsApp", o comparte el rol de aseo o la imagen de una lista, es su propio dispositivo el que abre WhatsApp/.test(txtPriv),
		/imágenes del rol de aseo, imágenes e impresiones de las listas, archivos de Excel\), así como los mensajes que haya enviado con "Escribir por WhatsApp" o "Recordar por WhatsApp", quedan bajo su cuidado/.test(txtPriv)],
	[true, true]);
ok("privacidad: finalidad de mostrar los próximos cumpleaños (Calendario e Inicio) con la fecha de nacimiento que captura la docente",
	/mostrarle los próximos cumpleaños de sus alumnos \(en Calendario y en Inicio\), con la fecha de nacimiento que usted captura/.test(txtPriv), true);
ok("privacidad: nada nuevo sobre «dato patrimonial» (queda como pregunta para Jorge)", /patrimonial/i.test(txtPriv), false);
ok("privacidad: sin emojis", SIMBOLOS.test(txtPriv), false);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
process.exit(fallos ? 1 : 0);
