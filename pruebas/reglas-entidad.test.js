/*
	Decisiones 17b, 18b y 21 de Jorge (2026-09-24) y arreglos del revisor R6.

	  1. Escala por GRADO, no por fase (17b): 1° de 6 a 10; 2° a 6° de 5 a 10, con 5 no
	     aprobatorio. La regla vive en js/reglas-entidad.js y debe coincidir con la base
	     (piso_calificacion_boleta en supabase/mi_salon_b11_escala_2_2026-09.sql). Ningún
	     archivo decide la escala por fase.
	  2. Entidad (21): una sola lista de las 32 entidades (js/entidades.js), un punto único
	     de reglas por estado (hoy la nacional para todas), el selector en el onboarding
	     (obligatorio) y en Mi cuenta, y el aviso de Inicio.
	  3. Sección 3 de la boleta en 2°: "Tablas" y "División" con el nombre que ya usan los
	     textos para las familias (CatalogoHabilidades.etiquetaDeGrado), sin cambiar claves.
	  4. Mi grupo: el error al guardar el trimestre no muestra texto técnico.
	(La acreditación con "Revisar" está en pruebas/evaluacion-final.test.js; Ajustes, en
	 pruebas/ajustes-peso-efectivo.test.js; la conducta del reporte, en
	 pruebas/reporte-alumno.test.js; la hoja Léeme, en pruebas/exportar.test.js.)

	node pruebas/reglas-entidad.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}

const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

global.window = {};
require("../js/campos-formativos.js");
require("../js/catalogo-habilidades.js");
require("../js/textos-boleta.js");
const R = require("../js/reglas-entidad.js");
const E = require("../js/entidades.js");
require("../js/reporte-datos.js");
const B = require("../js/boleta.js");
const RD = window.ReporteDatos;
const CH = window.CatalogoHabilidades;

// ── 1. Escala por grado ─────────────────────────────────────────────────────
console.log("\n1. Escala por grado (decisión 17b)");
const N = R.regla();
ok("piso por grado 1° a 6°", [1, 2, 3, 4, 5, 6].map((g) => N.pisoDeGrado(g)), [6, 5, 5, 5, 5, 5]);
ok("piso sin grado válido", [N.pisoDeGrado(null), N.pisoDeGrado(0), N.pisoDeGrado(7), N.pisoDeGrado("")], [null, null, null, null]);
ok("piso con grado en texto (\"2\")", N.pisoDeGrado("2"), 5);
ok("escala 1°", N.escalaDeGrado(1), "6 a 10; 1° se acredita con haberlo cursado");
ok("escala 2° a 6°", [2, 3, 4, 5, 6].map((g) => N.escalaDeGrado(g)), Array(5).fill("5 a 10; 5 no es aprobatoria"));
ok("ReporteDatos usa la regla (escala y piso)", [RD.escalaDeGrado(2), RD.pisoDeGrado(1), RD.pisoDeGrado(2)], ["5 a 10; 5 no es aprobatoria", 6, 5]);
ok("la fase no cambia (2° sigue en Fase 3)", [1, 2, 3, 4, 5, 6].map((g) => RD.faseDeGrado(g)), [3, 3, 4, 4, 5, 5]);
ok("boleta imprimible: 2° de 5 a 10", B.escala(2), "Enteros de 5 a 10; 5 no es aprobatoria");
ok("boleta imprimible: 1° de 6 a 10", B.escala(1), "Enteros de 6 a 10; 1° se acredita con haberlo cursado");
ok("la foto del cierre guarda la escala del grado", RD.fotoAlumno({ grado: 2 }, null).escala, "5 a 10; 5 no es aprobatoria");
ok("una foto vieja de 2° conserva su escala", RD.escalaVisible(2, { alumno: { grado: 2, fase: 3, escala: "6 a 10" } }), "6 a 10");

// La base aplica el mismo piso (la migración b11)
const sql = leer("supabase/mi_salon_b11_escala_2_2026-09.sql");
ok("SQL: 1° → 6", /when p_grado = 1 then 6::smallint/.test(sql), true);
ok("SQL: 2° a 6° → 5", /when p_grado between 2 and 6 then 5::smallint/.test(sql), true);
ok("SQL: create or replace (aditivo)", (sql.match(/create or replace function/g) || []).length, 3);
ok("SQL: no borra nada", /\bdrop\b|\bdelete\b|\btruncate\b/i.test(sql.replace(/--.*$/gm, "")), false);

// Nadie decide la escala por fase
const archivosJs = fs.readdirSync(path.join(RAIZ, "js")).filter((f) => f.endsWith(".js"));
const conFase = archivosJs.filter((f) => /escalaDeFase|pisoFase\(/.test(leer("js/" + f)));
ok("ningún js usa escalaDeFase ni pisoFase", conFase, []);
// Sin comentarios: ninguna etiqueta de escala ("6 a 10…", "5 a 10…") escrita a mano fuera de la regla
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const etiquetasSueltas = archivosJs.filter((f) => f !== "reglas-entidad.js" && /["'](6|5) a 10/.test(sinComentarios(leer("js/" + f))));
ok("etiquetas de escala solo en reglas-entidad.js", etiquetasSueltas, []);
ok("la hoja Léeme ya no dice «1° y 2°: 6 a 10»", leer("js/exportar.js").includes("1° y 2°: 6 a 10"), false);
ok("reportes.js: el selector usa el piso del grado", /function pisoGrado\(grado\)[\s\S]*?ReporteDatos\.pisoDeGrado\(grado\)/.test(leer("js/reportes.js")), true);
ok("reportes-grupo: el aviso del 5 incluye 2°", /Number\(f\.alumno\.grado\) >= 2/.test(leer("js/reportes-grupo.js")), true);
ok("reportes-grupo: la nota ya no dice «En 3° a 6°, un 5»", leer("js/reportes-grupo.js").includes("En 3° a 6°, un 5"), false);

// ── 2. Entidad ──────────────────────────────────────────────────────────────
console.log("\n2. Entidad (decisión 21)");
ok("32 entidades", E.ENTIDADES.length, 32);
ok("nombres únicos", new Set(E.ENTIDADES.map((e) => e.nombre)).size, 32);
ok("claves únicas", new Set(E.ENTIDADES.map((e) => e.clave)).size, 32);
ok("incluye Jalisco, CDMX y Estado de México", ["Jalisco", "Ciudad de México", "Estado de México"].every((n) => E.ENTIDADES.some((e) => e.nombre === n)), true);
ok("normalizar: sin acentos ni mayúsculas", E.normalizar("  michoacan  "), "Michoacán");
ok("normalizar: nombre oficial y clave", [E.normalizar("Coahuila de Zaragoza"), E.normalizar("MEX"), E.normalizar("veracruz de ignacio de la llave")], ["Coahuila", "Estado de México", "Veracruz"]);
ok("normalizar: vacío o desconocido", [E.normalizar(""), E.normalizar(null), E.normalizar("Texas")], ["", "", ""]);
ok("esValida: solo el nombre exacto de la lista", [E.esValida("Jalisco"), E.esValida("jalisco"), E.esValida(""), E.esValida("Texas")], [true, false, false, false]);
ok("regla de cualquier estado = nacional (sin variantes)", E.ENTIDADES.every((e) => R.regla(e.nombre) === R.NACIONAL && !R.tieneVariante(e.nombre)), true);
ok("sin estado: nacional", R.regla("") === R.NACIONAL && R.regla() === R.NACIONAL, true);
ok("regla nacional: promedios con un decimal, redondeados (como la plataforma de control escolar)", R.NACIONAL.promedios, { decimales: 1, modo: "redondear" });
ok("ReporteDatos redondea como dice la regla (7.66 → 7.7)", RD.promedioRedondeado([7, 8, 8]), 7.7);
ok("redondeo igual para todos los estados (Jalisco = nacional)", R.regla("Jalisco").promedios, { decimales: 1, modo: "redondear" });

// llenarSelect con un DOM mínimo
function selectFalso() {
	const doc = { createElement: () => ({ value: "", textContent: "" }) };
	return { ownerDocument: doc, innerHTML: "x", opciones: [], value: "", appendChild(o) { this.opciones.push(o); } };
}
const sel = selectFalso();
E.llenarSelect(sel, "jalisco");
ok("selector: «Elige tu estado» y las 32", [sel.opciones.length, sel.opciones[0].textContent, sel.opciones[0].value], [33, "Elige tu estado", ""]);
ok("selector: propone lo guardado (normalizado)", sel.value, "Jalisco");

// Páginas
const onb = leer("onboarding.html"), cta = leer("mi-cuenta.html"), dash = leer("dashboard.html");
const antes = (html, a, b) => html.indexOf('src="' + a + '"') !== -1 && html.indexOf('src="' + a + '"') < html.indexOf('src="' + b + '"');
ok("onboarding: selector obligatorio", /<select id="entidadDocente" required/.test(onb), true);
ok("onboarding: carga entidades.js antes de onboarding.js", antes(onb, "js/entidades.js", "js/onboarding.js"), true);
ok("mi cuenta: selector editable", /<select id="teacherEntidad"/.test(cta), true);
ok("mi cuenta: carga entidades.js antes de cuenta.js", antes(cta, "js/entidades.js", "js/cuenta.js"), true);
ok("inicio: aviso discreto oculto hasta saber que falta", /id="avisoEntidad" class="hidden /.test(dash), true);
const onbJs = leer("js/onboarding.js"), ctaJs = leer("js/cuenta.js"), dashJs = leer("js/dashboard.js");
ok("onboarding.js: no crea el grupo sin entidad", onbJs.indexOf("Elige el estado donde das clases.") !== -1 &&
	onbJs.indexOf("Elige el estado donde das clases.") < onbJs.indexOf('from("grupos")'), true);
ok("onboarding.js: guarda perfiles.estado antes del grupo", onbJs.indexOf("Entidades.guardar(window.sb, userId, entidad)") !== -1 &&
	onbJs.indexOf("Entidades.guardar(window.sb, userId, entidad)") < onbJs.indexOf('from("grupos").insert'), true);
ok("cuenta.js: guarda perfiles.estado", ctaJs.includes("Entidades.guardar(window.sb, currentUser.id, entidad)"), true);
ok("nadie hace upsert de perfiles con id (authenticated no puede actualizar perfiles.id)", [onbJs, ctaJs, leer("js/entidades.js")].some((s) => /from\("perfiles"\)[\s\S]{0,40}\.upsert/.test(s)), false);

ok("dashboard.js: lee estado y muestra el aviso solo si la lectura respondió", /select\("nombre_completo, estado"\)/.test(dashJs) && /!errorPerfil && perfil && !String\(perfil\.estado/.test(dashJs), true);
// Toda página que carga reporte-datos.js carga antes reglas-entidad.js
const paginas = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && leer(f).includes('src="js/reporte-datos.js"'));
ok("páginas con reporte-datos.js (5)", paginas.length, 5);
ok("todas cargan reglas-entidad.js antes", paginas.filter((p) => !antes(leer(p), "js/reglas-entidad.js", "js/reporte-datos.js")), []);

// ── 3. Sección 3 en 2° ──────────────────────────────────────────────────────
console.log("\n3. Habilidades de 2° con el nombre con que se evalúan");
ok("2°: tablas", CH.etiquetaDeGrado("mates.tablas", 2), "Cálculo mental para multiplicar");
ok("2°: división", CH.etiquetaDeGrado("mates.division", 2), "Estrategias para repartir o agrupar");
ok("2°: suma sin cambio", CH.etiquetaDeGrado("mates.suma", 2), "Suma");
ok("4°: tablas y división como siempre", [CH.etiquetaDeGrado("mates.tablas", 4), CH.etiquetaDeGrado("mates.division", 4)], ["Tablas de multiplicar", "División"]);
ok("mismo nombre que los textos para familias", CH.etiquetaDeGrado("mates.tablas", 2).toLowerCase(), CH.textoFamilias("mates.tablas", 2));
const caja2 = B.cajaHabilidades({ lectura_ppm: null, matematicas: [{ clave: "mates.tablas", nivel: "logrado" }] }, null, 2);
ok("boleta 2°: el renglón dice «Cálculo mental para multiplicar»", /data-clave='mates\.tablas'[^>]*>[\s\S]*?Cálculo mental para multiplicar/.test(caja2) || caja2.includes("Cálculo mental para multiplicar"), true);
ok("boleta 2°: ni «Tablas de multiplicar» ni «División»", /Tablas de multiplicar|>División</.test(caja2), false);
ok("boleta 2°: la clave no cambia", caja2.includes("data-clave='mates.tablas'"), true);
const caja4 = B.cajaHabilidades({ matematicas: [] }, null, 4);
ok("boleta 4°: «Tablas de multiplicar» y «División»", caja4.includes("Tablas de multiplicar") && caja4.includes("División"), true);
ok("pestaña Boleta (reportes.js) usa etiquetaDeGrado", leer("js/reportes.js").includes("CatalogoHabilidades.etiquetaDeGrado(hab, alumnoVisible.grado)"), true);

// ── 4. Mi grupo: sin texto técnico ──────────────────────────────────────────
console.log("\n4. Mi grupo: el error del trimestre en palabras de la maestra");
const mg = leer("js/mi-grupo.js");
const bloque = mg.slice(mg.indexOf("async function guardarTrimestre"), mg.indexOf("if (trimestreSelect) {"));
ok("no pega error.message en el mensaje", /mensajeTrimestre\([^;]*error\.message/.test(bloque), false);
ok("sin red: lo dice en palabras", bloque.includes("No se pudo guardar el trimestre porque no hay conexión."), true);
ok("usa Lectura.errorDeRed para distinguirlo", bloque.includes("window.Lectura.errorDeRed(error)"), true);
ok("el detalle técnico va a la consola", /console\.error\("mi-grupo: trimestre actual", error\)/.test(bloque), true);

// ── 5. Entidades.guardar (asíncrona; cierra la prueba) ───────────────────────
// Entidades.guardar: UPDATE y, sin fila, INSERT
(async () => {
	function sbFalso(filasUpdate, errorUpdate) {
		const log = [];
		return { log, from(t) {
			return {
				update(v) { log.push(["update", t, v]); return { eq(c, id) { log.push(["eq", c, id]); return { select: async () => ({ data: errorUpdate ? null : filasUpdate, error: errorUpdate || null }) }; } }; },
				insert: async (v) => { log.push(["insert", t, v]); return { error: null }; },
			};
		} };
	}
	let sb = sbFalso([{ estado: "Jalisco" }]);
	let r = await E.guardar(sb, "u1", "Jalisco");
	ok("guardar con fila: solo UPDATE", [r.error, sb.log.map((x) => x[0])], [null, ["update", "eq"]]);
	sb = sbFalso([]);
	r = await E.guardar(sb, "u1", "Oaxaca");
	ok("guardar sin fila: UPDATE y luego INSERT con id y estado", [r.error, sb.log.map((x) => x[0]), sb.log[2][2]], [null, ["update", "eq", "insert"], { id: "u1", estado: "Oaxaca" }]);
	sb = sbFalso(null, { message: "falla" });
	r = await E.guardar(sb, "u1", "Oaxaca");
	ok("guardar con error: lo devuelve y no inserta", [r.error.message, sb.log.map((x) => x[0])], ["falla", ["update", "eq"]]);
	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})();
