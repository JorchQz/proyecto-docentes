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
	- B3 (2026-09-26): "la escala de su grado", mala señal "en Hoy o en Exámenes", la boleta de una
	  familia solo lleva a su hija o hijo, Incompleta de una actividad, "eliges con qué grado
	  trabajan" solo al marcar alumnos, "docentes" (nunca "maestra" o "maestro") y comillas
	  latinas; y los textos aprobados del aviso de privacidad y los términos.

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
// Sin suscripción recurrente: pago único por periodo escolar (R27a, menor 4)
const CUENTA = "Pagas una sola vez por periodo escolar, sin cobro automático. Entras con la misma cuenta de la tienda.";
ok("sin precios: el modelo, sin 'Elige'", ConoceMiSalon.encabezado({ trimestre: null, ciclo: null }), { titulo: "Pago por periodo escolar: por trimestre o por ciclo.", texto: CUENTA });
ok("solo trimestre: título de trimestre y el ciclo por anunciar", ConoceMiSalon.encabezado({ trimestre: 149, ciclo: null }), { titulo: "Pago por periodo escolar: por trimestre.", texto: CUENTA + " El precio por ciclo escolar se anunciará pronto." });
ok("solo ciclo: título de ciclo y el trimestre por anunciar", ConoceMiSalon.encabezado({ trimestre: 0, ciclo: 399 }), { titulo: "Pago por periodo escolar: por ciclo.", texto: CUENTA + " El precio por trimestre se anunciará pronto." });
ok("los dos: 'Elige lo que te acomode'", ConoceMiSalon.encabezado({ trimestre: 149, ciclo: 399 }), { titulo: "Pago por periodo escolar: por trimestre o por ciclo.", texto: "Elige lo que te acomode. " + CUENTA });
ok("la presentación no habla de suscripción (JS y HTML)", [/suscri/i.test(leer("tienda/js/conoce-mi-salon.js").replace(/\/\/.*$/gm, "")), /suscri/i.test(html)], [false, false]);
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
	/Si aparece «Abrir como app web», déjalo activado\./.test(texto),
	/deja activado «Abrir como app web»/.test(texto),
	/«Agregar a inicio» o «Agregar a pantalla de inicio»/.test(texto),
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
	/«Pasar lista» abre la asistencia de hoy/.test(texto),
	/«Calificar trabajos» abre las sesiones de hoy/.test(texto),
	/«Reportes», los reportes del grupo/.test(texto),
], [true, true, true]);
const hoyHtml = leer("hoy.html");
ok("respaldo: Hoy salta a #asistencia y #sesiones (irASeccion) y esas secciones son Asistencia y Sesiones de hoy", [
	/\["asistencia", "tareas", "sesiones", "cierre", "siguientes"\]/.test(leer("js/hoy.js")),
	/id="asistencia"[\s\S]{0,300}Asistencia<\/h2>/.test(hoyHtml),
	/id="sesiones"[\s\S]{0,300}Sesiones de hoy<\/h2>/.test(hoyHtml),
], [true, true, true]);

// ── 7. Funciones nuevas nombradas en la página: existen en el código ─────────
ok("la página nombra actividades sueltas, ¿Para quién?, Incompleta y Actividades del trimestre", [
	/Actividades sueltas/.test(texto), /¿Para quién\?/.test(texto), /márcala Incompleta/.test(texto), /«Actividades del trimestre»/.test(texto),
	/pasarla a un proyecto del mismo trimestre/.test(texto), /Si marcas alumnos, eliges con qué grado trabajan/.test(texto),
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

// ── 8. B3 (textos aprobados por Jorge el 2026-09-26) ─────────────────────────
// Todo el texto visible de la página (cuerpo, con pie; sin comentarios, scripts, estilos ni atributos)
const visible = sinComentarios.split(/<body[^>]*>/)[1].replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
	.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("escala: ninguna 'escala oficial' y 'la escala de su grado' en las tres frases (más la de multigrado)", [
	(visible.match(/escala oficial de la SEP/g) || []).length, (visible.match(/escala (de calificación )?oficial/g) || []).length,
	(visible.match(/escala de su grado/g) || []).length,
	/PDA por grado y, para cada alumno, la escala de su grado\./.test(visible),
	/Calificación propuesta de cada alumno con la escala de su grado, que tú confirmas;/.test(visible),
	/Mi Salón propone la de cada alumno con lo que capturaste y la escala de su grado;/.test(visible),
], [0, 0, 4, true, true, true]);
ok("mala señal: la tarjeta dice 'en Hoy o en Exámenes'", /Si la señal se va mientras capturas en Hoy o en Exámenes, lo que marcas se guarda en tu tablet/.test(visible), true);
ok("familias: la boleta, el reporte y los mensajes solo llevan a su hija o hijo", [
	/La boleta, el reporte y los mensajes que Mi Salón prepara para una familia solo llevan a su hija o hijo\./.test(visible),
	/Lo que Mi Salón prepara para una familia solo lleva a su hija o hijo/.test(visible),
], [true, false]);
ok("Incompleta: 'no terminó una actividad en clase'", /Si un alumno no terminó una actividad en clase, márcala Incompleta/.test(visible), true);
// "¿Con qué grado trabajan?" solo sale en el modo de alumnos de ¿Para quién? (js/hoy.js construirParaQuien)
const conGrado = visible.split(/(?<=[.?!])\s+/).filter((o) => /eliges con qué grado trabajan/.test(o));
ok("'eliges con qué grado trabajan' solo en el modo de alumnos", [conGrado.length, conGrado.every((o) => /^Si marcas alumnos, eliges con qué grado trabajan/.test(o))], [2, true]);
ok("respaldo: el grado con que trabajan solo se muestra con 'Alumnos que elijo'", /data-para='alumnos'[\s\S]{0,200}¿Con qué grado trabajan\?/.test(hoyJs) && /a\.classList\.toggle\("hidden", m !== "alumnos"\)/.test(hoyJs), true);
ok("docentes: ni 'maestra' ni 'maestro' en el texto visible", visible.match(/\bmaestr[oa]s?\b/gi) || [], []);
ok("comillas: solo latinas en el texto visible, parejas", [
	(visible.match(/["“”]/g) || []).length, (visible.match(/«/g) || []).length === (visible.match(/»/g) || []).length, (visible.match(/«/g) || []).length > 0,
], [0, true, true]);

// ── Lanzamiento (constructor AN, 2026-09-26): Ponte al día, T1 gratis y precios de la tabla ──
ok("Ponte al día: se menciona con sus cuatro pasos", [/¿Empiezas con el trimestre avanzado\? Ponte al día en una tarde\./.test(texto),
	/1\. Tus alumnos/.test(texto), /2\. Asistencia pasada/.test(texto), /3\. Trabajos y exámenes/.test(texto), /4\. Revisa la boleta/.test(texto)], [true, true, true, true, true]);
// Cada afirmación, contra el código
const onbJs = leer("js/onboarding.js"), ponteJs = leer("js/ponte-al-dia.js"), listaJs = leer("js/lista-pegada.js"), dashJs = leer("js/dashboard.js");
ok("Ponte al día verificable: se ofrece al crear el grupo con el trimestre empezado y se retoma desde Inicio",
	[/ofrecePonteAlDia\(\)/.test(onbJs) && /ponte-al-dia\.html\?desde=alta/.test(onbJs), /Sigue con Ponte al día/.test(dashJs)], [true, true]);
ok("Ponte al día verificable: lista de Excel, Word o WhatsApp que se corrige antes de guardar",
	[/Excel, Word o WhatsApp/.test(listaJs), /la corrige si hace falta/.test(listaJs), /Pega la lista desde Excel, Word o WhatsApp/.test(texto)], [true, true, true]);
ok("Ponte al día verificable: todos asistieron, solo las faltas por semana, y los días sin clase al calendario del grupo",
	[/Todos asistieron: <strong>toca solo las faltas<\/strong>/.test(ponteJs), /Semana " \+ \(asis\.semana \+ 1\)/.test(ponteJs), /from\("calendario_ajustes"\)\.upsert\(sinClase/.test(ponteJs)], [true, true, true]);
ok("Ponte al día verificable: actividades con semáforo y exámenes por 'Solo subir resultados'",
	[/Solo subir resultados/.test(ponteJs), /semáforo/.test(ponteJs)], [true, true]);
ok("Ponte al día verificable: la directa queda confirmada (b20 §2b) y lo histórico no llena Hoy",
	[/calificacion_confirmada = true/.test(leer("supabase/mi_salon_b20_registro_historico_2026-09.sql")), /quedan confirmadas en la boleta/.test(texto),
		/no te llena Hoy de pendientes/.test(texto), /es_historico/.test(leer("js/alcance-hoy.js"))], [true, true, true, true]);
ok("FAQ de la calificación: la directa ya queda confirmada", /Si capturas directamente la calificación que ya tenías en papel o en Excel, esa ya queda confirmada\./.test(texto), true);
const cmsJs = require(path.join(RAIZ, "tienda/js/conoce-mi-salon.js")).ConoceMiSalon;
ok("T1 gratis hasta el 18 de diciembre (de la tabla de periodos) solo con Mi Salón abierto",
	[cmsJs.textoGratis("2026-12-18"), /id="msAbiertoBloque" class="hidden/.test(html)],
	["Crea tu cuenta y tendrás acceso completo a Mi Salón hasta el 18 de diciembre, sin tarjeta.", true]);
const pubAbierto = { abierto: true, ciclo: "2026-2027", periodo: "T1", lugares_fundador: 63, cupo_fundador: 100, productos: [
	{ producto: "trimestre", nombre: "Trimestre", precio_lista: 299, precio_fundador: 199, vende_ahora: true },
	{ producto: "resto_ciclo", nombre: "Resto del ciclo", precio_lista: 549, precio_fundador: 399, vende_ahora: true },
	{ producto: "ciclo", nombre: "Ciclo completo", precio_lista: 749, precio_fundador: 549, vende_ahora: false }] };
ok("precios de la tabla: fundador con el de lista tachado y 'Quedan N lugares' (Ciclo completo no se vende en 2026-2027)",
	[cmsJs.planesDeTabla(pubAbierto).map((p) => p.titulo + " " + p.texto + " (" + p.lista + ")"), cmsJs.textoLugares(pubAbierto)],
	[["Trimestre $199 ($299)", "Resto del ciclo $399 ($549)"], "Quedan 63 lugares con precio fundador."]);
ok("con Mi Salón apagado: sin precios de la tabla ni lugares ('Precio por anunciar'), página sin indexar",
	[cmsJs.planesDeTabla({ abierto: false }).length, cmsJs.textoLugares({ abierto: false }), /data-precio="pendiente">Precio por anunciar/.test(html), /<meta name="robots" content="noindex, nofollow">/.test(html)],
	[0, null, true, true]);

// Aviso de privacidad y términos (textos legales aprobados por Jorge el 2026-09-26)
const privacidad = leer("tienda/privacidad.html");
const terminos = leer("tienda/terminos.html");
ok("privacidad: exámenes y ¿Para quién? entre los datos del alumno", [
	/las respuestas y los resultados de los exámenes que usted captura \(incluido si no presentó\)/.test(privacidad),
	/a qué actividades se le asignó \("¿Para quién\?"\)/.test(privacidad),
], [true, true]);
ok("privacidad: cámara y captura sin señal en el dispositivo", [
	/Si revisa las hojas de respuestas con la cámara, la imagen se procesa solo en su dispositivo: no se guarda ni se envía a Jissez; solo se guardan las respuestas leídas\./.test(privacidad),
	/Si pierde la señal mientras captura en Hoy o en Exámenes, lo capturado se guarda temporalmente en su dispositivo, ligado a su cuenta, y se borra al enviarse\. Si comparte el dispositivo, cierre sesión al terminar\./.test(privacidad),
], [true, true]);
ok("privacidad: el navegador guarda la sesión y lo capturado sin señal (ya no 'solo la sesión')", [
	/lo necesario para mantener su sesión iniciada\./.test(privacidad),
	/lo necesario para mantener su sesión iniciada y, además, lo que usted capture sin señal en Mi Salón/.test(privacidad),
], [false, true]);
ok("privacidad: cada cuenta ve solo lo suyo; Jissez no los consulta", [
	/Solo usted, con su cuenta, puede verlos en Mi Salón\./.test(privacidad),
	/En Mi Salón, cada cuenta ve solo lo suyo\. Jissez no los consulta, salvo que usted nos pida ayuda o lo exija la ley\./.test(privacidad),
], [false, true]);
ok("términos: la calificación oficial es la que se registra en el SIGED", /Las calificaciones que propone Mi Salón son una propuesta; la oficial es la que usted confirma y registra en el SIGED\./.test(terminos.split("<h2>10.")[1].split("<h2>11.")[0]), true);
ok("fecha de actualización de los dos textos legales", [/Última actualización: 26 de septiembre de 2026/.test(privacidad), /Última actualización: 26 de septiembre de 2026/.test(terminos)], [true, true]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
