/*
	Textos de la presentación de Mi Salón (tienda/conoce-mi-salon.html) contra el código, tras las
	decisiones de Jorge del 2026-09-26 y los menores del revisor R25b:

	- Planeaciones de Jissez: hoy no hay publicadas y la importación a Mi Salón va después del
	  piloto. Solo se mencionan como "próximamente"; lo de hoy es crear tus propios proyectos o
	  actividades sueltas.
	- Exámenes: se CREAN en Mi Salón (hoja de respuestas revisada con la cámara o tocando) o se
	  SUBEN resultados de cualquier examen. Nada del catálogo de exámenes.
	- "Sus sesiones traen los trabajos a calificar" era exagerado: un trabajo por grado de cada
	  sesión (js/sesiones-materializar.js), que se renombra en Hoy.
	- Privacidad exacta: cada cuenta ve solo lo suyo (RLS); las fotos de las hojas no se suben.
	- "Cómo adquirirlo": título y texto según cuántos precios hay (ConoceMiSalon.encabezado).
	- Instalar en iPhone/iPad: "Abrir como app web" solo si aparece; atajos de Android con su
	  nombre real (salon.webmanifest) y lo que abren (js/hoy.js irASeccion).
	- Funciones nuevas nombradas en la página: existen en el código.

	node pruebas/conoce-mi-salon-textos.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const html = leer("tienda/conoce-mi-salon.html");
// Solo lo que ve la visitante: sin comentarios ni etiquetas
const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, " ");
const main = sinComentarios.split("<main>")[1].split("</main>")[0];
const texto = main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const oraciones = texto.split(/(?<=[.?!])\s+/);

// ── 1. Planeaciones de Jissez: solo "próximamente" ────────────────────────────
const conPlaneaciones = oraciones.filter((o) => /planeaciones de Jissez/i.test(o));
ok("planeaciones de Jissez: se mencionan", conPlaneaciones.length > 0, true);
ok("planeaciones de Jissez: cada mención dice próximamente", conPlaneaciones.filter((o) => !/pr[oó]ximamente/i.test(o)), []);
ok("ya no dice 'usar planeaciones de Jissez' como algo de hoy", /(puedes|o) usar planeaciones de Jissez/i.test(texto), false);
ok("crear tus propios proyectos o actividades sueltas (tarjeta, paso 4 y pregunta)", [
	/Crea tus propios proyectos, con sus sesiones y los PDA de cada grado, o actividades sueltas sin proyecto\./.test(texto),
	/Crea tus propios proyectos: cada sesión trae/.test(texto),
	/Creas tus propios proyectos en Mi Salón[^.]*o agregas actividades y tareas sueltas/.test(texto),
], [true, true, true]);

// ── 2. Exámenes: crear o subir resultados; sin catálogo ───────────────────────
ok("sin 'catálogo' en el contenido (el enlace Catálogo del pie es de la tienda)", /cat[aá]logo/i.test(texto), false);
ok("exámenes: crear en Mi Salón, hoja revisada con la cámara, o subir resultados de cualquier examen", [
	/Creas tu examen en Mi Salón e imprimes la hoja de respuestas, que revisas con la cámara de la tablet o tocando la letra\./.test(texto),
	/O subes los resultados de cualquier examen\./.test(texto),
	/¿Cómo funcionan los exámenes\?/.test(texto),
], [true, true, true]);

// ── 3. Sesiones: un trabajo por grado, no "los trabajos a calificar" ─────────
ok("ya no dice que las sesiones traen los trabajos a calificar", /traen los trabajos a calificar/.test(texto), false);
ok("un trabajo por grado de cada sesión, que se renombra", [/un trabajo por grado para calificar/.test(texto), /aparece un trabajo por grado de cada sesión, que puedes renombrar/.test(texto)], [true, true]);
const materializar = leer("js/sesiones-materializar.js");
ok("respaldo: la materialización crea un trabajo genérico por grado y las tareas del cierre", [/un trabajo genérico por grado/.test(materializar), /CADA GRADO DEL PROYECTO TIENE SU PRODUCTO EN CADA SESIÓN/.test(materializar)], [true, true]);
ok("respaldo: Hoy tiene Renombrar", /data-renombrar=/.test(leer("js/hoy.js")), true);

// ── 4. Privacidad exacta ─────────────────────────────────────────────────────
ok("sin frases absolutas de privacidad", [/solo los ves tú/i.test(texto), /Solo tú, con tu cuenta/.test(texto), /\bnadie\b/i.test(texto), /\bnunca\b/i.test(texto)], [false, false, false, false]);
ok("privacidad: cada cuenta ve solo lo suyo y las fotos de las hojas no se suben", [
	/En Mi Salón, cada cuenta ve solo lo suyo:/.test(texto),
	/la foto de la hoja se lee en tu tablet y no se sube; solo se guardan las respuestas\./.test(texto),
	/Las fotos de las hojas de respuestas se leen en tu tablet y no se suben\./.test(texto),
], [true, true, true]);
// (navigator.storage.persist sí aparece: pide que el navegador no borre la cola; no sube nada)
ok("respaldo: la cámara procesa todo en el aparato y no sube imágenes (sin Storage de Supabase ni imagen exportada)", [/ninguna imagen sale de él/.test(leer("js/examen-camara.js")), ["js/examen.js", "js/examen-propio.js", "js/examen-camara.js", "js/examen-lector.js"].some((f) => /\.storage\.from\(|toDataURL|toBlob|FormData/.test(leer(f)))], [true, false]);

// ── 5. "Cómo adquirirlo" según cuántos precios hay ───────────────────────────
const { ConoceMiSalon } = require(path.join(RAIZ, "tienda/js/conoce-mi-salon.js"));
const CUENTA = "Con tu suscripción entras con la misma cuenta de la tienda.";
ok("sin precios: el modelo, sin 'Elige'", ConoceMiSalon.encabezado({ trimestre: null, ciclo: null }), { titulo: "Suscripción por trimestre o por ciclo escolar.", texto: CUENTA });
ok("solo trimestre: título de trimestre y el ciclo por anunciar", ConoceMiSalon.encabezado({ trimestre: 149, ciclo: null }), { titulo: "Suscripción por trimestre.", texto: CUENTA + " El precio por ciclo escolar se anunciará pronto." });
ok("solo ciclo: título de ciclo y el trimestre por anunciar", ConoceMiSalon.encabezado({ trimestre: 0, ciclo: 399 }), { titulo: "Suscripción por ciclo escolar.", texto: CUENTA + " El precio por trimestre se anunciará pronto." });
ok("los dos: 'Elige lo que te acomode'", ConoceMiSalon.encabezado({ trimestre: 149, ciclo: 399 }), { titulo: "Suscripción por trimestre o por ciclo escolar.", texto: "Elige lo que te acomode. " + CUENTA });
ok("'Elige' solo con los dos precios", [null, { trimestre: 149 }, { ciclo: 399 }, { trimestre: "149", ciclo: 399 }].map((c) => /Elige/.test(ConoceMiSalon.encabezado(c).texto)), [false, false, false, false]);
const inicial = ConoceMiSalon.encabezado(null);
ok("el HTML inicial trae el título y el texto de 'sin precios' (lo mismo que pinta el JS)", [
	html.indexOf('id="msPreciosTitulo"') !== -1 && new RegExp('id="msPreciosTitulo"[^>]*>' + inicial.titulo.replace(/\./g, "\\.") + "</h2>").test(html),
	new RegExp('id="msPreciosTexto"[^>]*>' + inicial.texto.replace(/\./g, "\\.") + "</p>").test(html),
	/Elige lo que te acomode/.test(html),
], [true, true, false]);
ok("la página pinta el encabezado desde ConoceMiSalon.encabezado", /ConoceMiSalon\.encabezado\(PRECIOS_MI_SALON\)/.test(leer("tienda/js/conoce-mi-salon.js")), true);

// ── 6. Instalar: iOS exacto y atajos con su nombre real ──────────────────────
ok("iOS: 'Abrir como app web' solo si aparece; 'Agregar a inicio'", [
	/Si aparece "Abrir como app web", déjalo activado\./.test(texto),
	/deja activado "Abrir como app web"/.test(texto),
	/"Agregar a inicio" o "Agregar a pantalla de inicio"/.test(texto),
	/inicia sesión una vez dentro de la app/.test(texto),
], [true, false, true, true]);
ok("respaldo: la hoja de instrucciones de la app dice lo mismo ('Si aparece')", /Si aparece, deja activado <strong>Abrir como app web<\/strong>/.test(leer("js/app-instalada.js")), true);
const manifest = JSON.parse(leer("salon.webmanifest"));
const atajos = manifest.shortcuts.map((a) => ({ nombre: a.name, hash: (a.url.split("#")[1] || null), ruta: a.url.split("?")[0] }));
ok("manifest: los tres atajos", atajos, [
	{ nombre: "Pasar lista", hash: "asistencia", ruta: "/salon/hoy" },
	{ nombre: "Calificar trabajos", hash: "sesiones", ruta: "/salon/hoy" },
	{ nombre: "Reportes", hash: null, ruta: "/salon/reportes" },
]);
ok("la página nombra cada atajo como el manifest y dice qué abre", [
	/"Pasar lista" abre la asistencia de hoy/.test(texto),
	/"Calificar trabajos" abre las sesiones de hoy/.test(texto),
	/"Reportes", los reportes del grupo/.test(texto),
], [true, true, true]);
const hoyHtml = leer("hoy.html");
ok("respaldo: Hoy salta a #asistencia y #sesiones (irASeccion) y esas secciones son Asistencia y Sesiones de hoy", [
	/\["asistencia", "tareas", "sesiones", "cierre"\]/.test(leer("js/hoy.js")),
	/id="asistencia"[\s\S]{0,300}Asistencia<\/h2>/.test(hoyHtml),
	/id="sesiones"[\s\S]{0,300}Sesiones de hoy<\/h2>/.test(hoyHtml),
], [true, true, true]);

// ── 7. Funciones nuevas nombradas en la página: existen en el código ─────────
ok("la página nombra actividades sueltas, ¿Para quién?, Incompleta y Actividades del trimestre", [
	/Actividades sueltas/.test(texto), /¿Para quién\?/.test(texto), /márcala Incompleta/.test(texto), /"Actividades del trimestre"/.test(texto),
	/pasarla a un proyecto del mismo trimestre/.test(texto), /eliges con qué grado trabajan/.test(texto),
], [true, true, true, true, true, true]);
const hoyJs = leer("js/hoy.js");
ok("respaldo: Hoy agrega actividades sueltas y las pasa a un proyecto", [/id="btnSuelta"[^>]*>Actividad suelta</.test(hoyHtml), /Pasar a un proyecto/.test(hoyJs)], [true, true]);
ok("respaldo: 'Actividades del trimestre' en Proyectos", /<h2 id="sueltasTitulo"[^>]*>Actividades del trimestre<\/h2>/.test(leer("planeacion.html")), true);
ok("respaldo: pasar a un proyecto del mismo grupo y trimestre", /del MISMO grupo y trimestre/.test(leer("js/pasar-a-proyecto.js")), true);
ok("respaldo: ¿Para quién? con todo el grupo, grados o alumnos, y el grado con que trabajan", [
	/¿Para quién\?<\/legend>/.test(hoyJs), /\["grupo", "Todo el grupo"\]/.test(hoyJs), /"Uno o varios grados"/.test(hoyJs), /"Alumnos que elijo"/.test(hoyJs),
	/¿Con qué grado trabajan\?/.test(hoyJs), /siguen en su grado para la boleta/.test(hoyJs),
], [true, true, true, true, true, true]);
const AlcanceHoy = require(path.join(RAIZ, "js/alcance-hoy.js"));
const marcar = AlcanceHoy.cambiosIncompleta("marcar", { hoy: "2026-09-25", ajustes: [] });
ok("respaldo: Incompleta se revisa el siguiente día de clase (viernes 25 → lunes 28)", [marcar.estado_en_clase, marcar.revisar_en], ["incompleta", "2026-09-28"]);
ok("respaldo: al revisarla vale el nivel que logró", AlcanceHoy.cambiosIncompleta("completo", { hoy: "2026-09-28", nivel: "en_proceso" }).nivel, "en_proceso");
ok("respaldo: una tarea sin fecha vence el siguiente día de clase", AlcanceHoy.venceTarea(null, "2026-09-25", []), "2026-09-28");
ok("respaldo: exámenes con dos caminos y cuatro tipos de pregunta", [
	/"Crear mi examen"/.test(leer("js/examen.js")), /"Solo subir resultados"/.test(leer("js/examen.js")),
	/opción múltiple \(sugerida: se revisa sola\), verdadero o falso,\s*completar y abierta/.test(leer("js/examen-propio.js")),
	/Capturar tocando/.test(leer("js/examen-camara.js")),
], [true, true, true, true]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
