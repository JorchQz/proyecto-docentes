/*
	Pruebas del render de la sección "Sesiones de hoy" (B.1).

	Regresión del 2026-09-23: la pantalla se caía con
	"Cannot read properties of undefined" al dibujar el panel de detalle, porque el
	arranque corría ANTES de que se asignara el estado (las funciones se izan, las
	asignaciones de `var` no). La excepción mataba el render de las secciones 3 y 4.

	Esta prueba dibuja de verdad un producto multigrado con alumnos de dos grados,
	usando las funciones tal cual están en js/hoy.js, y además vigila el orden de
	inicialización que causó el bug.

	node pruebas/hoy-render.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + real + (bien ? "" : " (esperado " + esperado + ")"));
}

const ALCANCE = require("../js/alcance-hoy.js");
const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "hoy.js"), "utf8");

function extraerFuncion(nombre) {
	const m = fuente.match(new RegExp("\\n\\tfunction " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
	if (!m) { console.log("FALLA no se encontró la función " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}
function extraerLista(nombre) {
	// Sirve tanto para listas de una línea como de varias
	const m = fuente.match(new RegExp("var " + nombre + " = \\[[\\s\\S]*?\\];"));
	if (!m) { console.log("FALLA no se encontró la lista " + nombre + " en js/hoy.js"); process.exit(1); }
	return m[0];
}

// ── 1. El bug de fondo: el estado debe existir antes del primer render ────────
const posEstado = fuente.indexOf("var detallesAbiertos");
const posArranque = fuente.indexOf("await cargarDatosDelDia();");
ok("el estado se declara antes del arranque", posEstado !== -1 && posArranque !== -1 && posEstado < posArranque, true);
ok("el arranque envuelve cada render en su propio try", /catch \(e\) \{[\s\S]*?hoy: render de/.test(fuente), true);

// ── 2. Render real de un producto multigrado ─────────────────────────────────
const alumnos = [
	{ id: "al-2", nombre_completo: "ALUMNO DE SEGUNDO", grado: 2, num_lista: 1 },
	{ id: "al-3", nombre_completo: "ALUMNO DE TERCERO", grado: 3, num_lista: 2 },
];
const calificaciones = {
	// uno ya calificado y con detalle capturado, el otro en blanco
	"al-2|prod-1": { id: "c1", nivel: "logrado", estado_entrega: "entregado", puntaje: 9, retroalimentacion: "Excelente trabajo" },
};

const cuerpo = [
	"var window = { AlcanceHoy: ALCANCE, ProductosHoy: PH, ParaQuien: PQ };",
	"var alumnos = ALUMNOS;",
	"var calificaciones = CALIFICACIONES;",
	"var detallesAbiertos = DETALLES;",
	"var asignaciones = ASIGNACIONES || {};",
	// Los grados de los PDA ligados a cada producto (nota "Trabaja con", R30)
	"var gradosPda = {};",
	"var proyectoPorId = {};",
	// Lo que Hoy recuerda entre dibujos (actividades abiertas) y la asistencia de hoy (quien faltó no aparece)
	"var productosAbiertos = ABIERTOS;",
	"var asistencia = ASISTENCIA_HOY;",
	"var hoy = '2026-09-29';",
	extraerLista("NIVELES"),
	extraerLista("RETRO_RAPIDA"),
	extraerFuncion("esc"),
	extraerFuncion("chip"),
	extraerFuncion("filaAlumno"),
	extraerFuncion("alumnosDeProducto"),
	"var asisPasadas = {}; var ajustesCal = [];",
	extraerFuncion("faltoHoy"),
	extraerFuncion("asisDe"), extraerFuncion("faltoEnDia"), extraerFuncion("cubiertoPorJustificada"), extraerFuncion("esEnCurso"),
	extraerFuncion("alumnosParaCalificar"),
	extraerFuncion("estaCalificado"),
	extraerFuncion("resumenCalificados"),
	extraerFuncion("chevron"),
	extraerFuncion("notaTrabajaCon"),
	extraerFuncion("paraQuien"),
	extraerFuncion("quienHaceDe"),
	extraerFuncion("esSuelta"),
	extraerFuncion("notaIncompleta"),
	extraerFuncion("fechaCorta"),
	extraerFuncion("vacio"),
	extraerFuncion("agruparPorGrado"),
	extraerFuncion("detalleProducto"),
	extraerFuncion("botonesProducto"),
	extraerFuncion("bloqueProducto"),
	"return { bloqueProducto: bloqueProducto };",
].join("\n");

const fabrica = new Function("ALUMNOS", "CALIFICACIONES", "DETALLES", "ALCANCE", "PH", "ASIGNACIONES", "ABIERTOS", "ASISTENCIA_HOY", cuerpo);
const PH = require("../js/productos-hoy.js");
// El renglón dice quién hace cada producto con ParaQuien (hoy.html lo carga; sin window, lee lo global)
global.ProductosHoy = PH;
global.AlcanceHoy = ALCANCE;
global.PQ = require("../js/para-quien.js");
const api =fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, {}, {});

const producto = { id: "prod-1", nombre: "Cartel del cuento", campo: "LEN", grados: ["2", "3"], tipo: "trabajo" };
let html = "";
let excepcion = null;
try {
	html = api.bloqueProducto(producto);
} catch (e) {
	excepcion = e;
}
ok("dibuja un producto multigrado sin excepción", excepcion === null ? "sin excepción" : String(excepcion), "sin excepción");
ok("aparecen los dos alumnos", html.indexOf("ALUMNO DE SEGUNDO") !== -1 && html.indexOf("ALUMNO DE TERCERO") !== -1, true);
ok("se agrupa por grado (dos encabezados)", (html.match(/° grado/g) || []).length, 2);
ok("cada alumno tiene su panel de detalle",
	html.indexOf("id='detalle-prod-1-al-2'") !== -1 && html.indexOf("id='detalle-prod-1-al-3'") !== -1, true);
ok("los paneles nacen cerrados", (html.match(/hidden rounded-xl bg-gray-50/g) || []).length, 2);
ok("el semáforo ya capturado queda marcado", html.indexOf("bg-emerald-500 text-white") !== -1, true);
ok("la retroalimentación guardada se muestra", html.indexOf("Excelente trabajo</textarea>") !== -1, true);
ok("el puntaje 9 queda seleccionado", html.indexOf("value='9' selected") !== -1, true);

// Producto de un solo grado: sin encabezados de grado, un solo alumno
const soloTercero = api.bloqueProducto({ id: "prod-2", nombre: "Problemas", campo: "SAB", grados: ["3"], tipo: "trabajo" });
ok("producto de un grado: un solo alumno", soloTercero.indexOf("ALUMNO DE SEGUNDO") === -1, true);
ok("producto de un grado: sin encabezado de grado", (soloTercero.match(/° grado/g) || []).length, 0);

// Rotulado con sus grados (2026-09-26): en multigrado salían bloques iguales sin decir el grado
// 2026-10-02: el renglón dice lo mismo que la vista del proyecto (ParaQuien.quienHace): «3° (todos)» o los nombres
ok("el producto de un grado dice «· 3° (todos)»", /Problemas<span[^>]*> · 3° \(todos\)<\/span>/.test(soloTercero), true);
ok("el producto multigrado dice «· 2° y 3° (todos)»", /Cartel del cuento<span[^>]*> · 2° y 3° \(todos\)<\/span>/.test(html), true);
ok("con todos, el cuerpo no lleva «Lo hacen:»", html.indexOf("data-lo-hacen") === -1, true);
// Quien lo hace por nombre: 3 nombres y «+ N más» en el renglón (es un botón: sin otro botón dentro); al abrir, la lista completa
const cinco = ["ANA", "BETO", "CARLA", "DANIEL", "ELENA"].map((n, i) => ({ id: "n" + i, nombre_completo: n, grado: 1, num_lista: i + 1 }));
const porNombre = { id: "prod-7", nombre: "Tarjeta", campo: "LEN", grados: [], tipo: "trabajo" };
const htmlCinco = fabrica(cinco, {}, {}, ALCANCE, PH, { "prod-7": { n0: "incluir", n1: "incluir", n2: "incluir", n3: "incluir", n4: "incluir" } }, {}, {}).bloqueProducto(porNombre);
const renglon = (htmlCinco.match(/<button type='button' data-abrir-producto[\s\S]*?<\/button>/) || [""])[0];
ok("cinco nombres: el renglón dice «ANA, BETO, CARLA + 2 más» y no lleva otro botón", [/ · ANA, BETO, CARLA \+ 2 más</.test(renglon), /DANIEL/.test(renglon), (renglon.match(/<button/g) || []).length].join(), "true,false,1");
ok("cinco nombres: al abrir, la primera línea del cuerpo dice «Lo hacen:» con todos", /id='cuerpo-prod-prod-7'[^>]*><p [^>]*data-lo-hacen>Lo hacen: ANA, BETO, CARLA, DANIEL, ELENA<\/p>/.test(htmlCinco), true);
const htmlTres = fabrica(cinco, {}, {}, ALCANCE, PH, { "prod-7": { n0: "incluir", n1: "incluir", n2: "incluir" } }, {}, {}).bloqueProducto(porNombre);
ok("tres nombres: todos en el renglón y sin «Lo hacen:»", [/ · ANA, BETO, CARLA</.test(htmlTres), /data-lo-hacen/.test(htmlTres), /\+ \d+ más/.test(htmlTres)].join(), "true,false,false");
ok("cada producto ofrece Renombrar y Quitar (44 px)",
	/data-renombrar='prod-2'[^>]*min-h-\[44px\]/.test(soloTercero) && /data-quitar-producto='prod-2'[^>]*min-h-\[44px\]/.test(soloTercero), true);

// El panel abierto sigue abierto tras redibujar
const api2 = fabrica(alumnos, calificaciones, { "detalle-prod-1-al-3": true }, ALCANCE, PH, {}, {}, {});
const htmlAbierto = api2.bloqueProducto(producto);
ok("un detalle abierto sobrevive al redibujo",
	htmlAbierto.indexOf("id='detalle-prod-1-al-3' class='rounded-xl") !== -1, true);

// Actividades plegadas (2026-09-29): un renglón que se abre; el cuerpo lleva lo de siempre
ok("la actividad nace plegada: su renglón dice que no está expandido", /data-abrir-producto='prod-1' aria-expanded='false'/.test(html), true);
ok("plegada, su cuerpo va oculto pero con todos los alumnos y botones", /id='cuerpo-prod-prod-1' class='hidden /.test(html) && html.indexOf("data-nivel='logrado'") !== -1, true);
ok("el renglón dice «1 de 2 calificados»", html.indexOf("1 de 2 calificados") !== -1, true);
ok("el renglón del producto de un grado dice «0 de 1 calificados»", soloTercero.indexOf("0 de 1 calificados") !== -1, true);
ok("el renglón no lleva data-producto (eso es del semáforo)", !/<button[^>]*data-abrir-producto[^>]*\sdata-producto=/.test(html), true);
const abierta = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, { "prod-1": true }, {}).bloqueProducto(producto);
ok("una actividad abierta sobrevive al redibujo (aria-expanded y sin hidden)", /aria-expanded='true'/.test(abierta) && /id='cuerpo-prod-prod-1' class='px-3/.test(abierta), true);

// Quien faltó hoy no aparece para calificar (filtro de pantalla; recibeProducto no cambia). Solo en lo que se
// califica hoy: una actividad de una sesión de hoy (o una tarea); una suelta de otro día no se filtra.
const productoHoy = Object.assign({}, producto, { sesion: { fecha: "2026-09-29" } });
const conFalta = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, { "prod-1": true }, { "al-3": "ausente" });
const htmlFalta = conFalta.bloqueProducto(productoHoy);
ok("el ausente sin calificación no aparece", htmlFalta.indexOf("ALUMNO DE TERCERO") === -1 && htmlFalta.indexOf("ALUMNO DE SEGUNDO") !== -1, true);
ok("el resumen no cuenta al ausente: «1 de 1 calificados»", htmlFalta.indexOf("1 de 1 calificados") !== -1, true);
const justificada = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, {}, { "al-3": "justificada" }).bloqueProducto(productoHoy);
ok("con justificada tampoco aparece", justificada.indexOf("ALUMNO DE TERCERO") === -1, true);
const calificadoAusente = { "al-2|prod-1": calificaciones["al-2|prod-1"], "al-3|prod-1": { id: "c9", nivel: "en_proceso", estado_entrega: "entregado" } };
const conCal = fabrica(alumnos, calificadoAusente, {}, ALCANCE, PH, {}, {}, { "al-3": "ausente" }).bloqueProducto(productoHoy);
ok("el ausente que YA tiene calificación sí se muestra", conCal.indexOf("ALUMNO DE TERCERO") !== -1 && conCal.indexOf("2 de 2 calificados") !== -1, true);
const todosFaltaron = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, {}, { "al-3": "ausente" }).bloqueProducto(Object.assign({}, productoHoy, { id: "prod-3", grados: ["3"] }));
ok("si todos los que la reciben faltaron: «Faltaron hoy» (no «Sin alumnos») y lo explica", todosFaltaron.indexOf(">Faltaron hoy<") !== -1 && todosFaltaron.indexOf("Sin alumnos") === -1 && todosFaltaron.indexOf("faltaron hoy: no aparecen para calificar") !== -1, true);
const nadieLaRecibe = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, {}, {}).bloqueProducto(Object.assign({}, productoHoy, { id: "prod-4", grados: ["5"] }));
ok("si nadie la recibe: «Sin alumnos» y la invitación a «Para quién»", nadieLaRecibe.indexOf(">Sin alumnos<") !== -1 && nadieLaRecibe.indexOf("Nadie recibe esta actividad todavía") !== -1, true);
const pasado = fabrica(alumnos, calificaciones, {}, ALCANCE, PH, {}, { "prod-1": true }, { "al-3": "ausente" }).bloqueProducto(Object.assign({}, producto, { sesion: { fecha: "2026-09-20" } }));
ok("una actividad de un día que ya pasó no se filtra por la asistencia de hoy", pasado.indexOf("ALUMNO DE TERCERO") !== -1, true);
ok("la regla recibeProducto no cambia: sigue dando el producto al ausente", ALCANCE.recibeProducto(alumnos[1], producto, {}, null, undefined), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
