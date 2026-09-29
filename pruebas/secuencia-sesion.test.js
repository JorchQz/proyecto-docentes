/*
	La secuencia de una sesión (js/secuencia-sesion.js), lo que Hoy muestra con "Secuencia de la
	sesión" y con el ojo de las sesiones que faltan (2026-09-29). Cada función recibe la sesión como
	parámetro: no hay estado global (Inicio la tenía atada a la variable `sesionActiva`).

	node pruebas/secuencia-sesion.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (bien ? "" : " → " + JSON.stringify(real) + " (esperado " + JSON.stringify(esperado) + ")"));
}

const S = require("../js/secuencia-sesion.js");

const sesionPP = {
	id: "s1",
	inicio_todos: "8:00 a 8:20 · Asamblea de bienvenida.",
	inicio_diferenciado: null,
	inicio_actividades: { mode: "todos", todos: ["El docente saluda a cada alumno.", "Se ensaya la señal de atención."], diferenciado: null },
	desarrollo_todos: "8:20 a 9:10 · Primer bloque de lectoescritura.",
	desarrollo_actividades: {
		mode: "todos",
		todos: ["El docente muestra la página."],
		diferenciado: { Naranja: ["Arman su nombre con letras móviles."], Morado: ["Repasan su nombre con el dedo."], "1": ["Solo 1°: cuentan."] },
		orden_grupos: ["Morado", "Naranja"],
	},
	cierre_todos: "9:10 a 9:20 · Revisión rápida.",
	cierre_actividades: ["Pausa activa de tres minutos."],
	cierre_tareas: { mode: "diferenciado", diferenciado: { "1": "Platica en casa cuál regla te gustó.", "2": ["Escribe la regla en tu cuaderno."] } },
	recursos: {
		links: [
			{ url: "https://drive.google.com/drive/folders/abc", titulo: "Anexos de la sesión 1 (carpeta de Drive)" },
			{ url: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", nombre: "El origen de las letras — Múltiples Lenguajes 1°, p.100" },
			{ url: "https://drive.google.com/file/d/xyz/view", titulo: "S01-01 · Organización de grupos" },
			{ url: "javascript:alert(1)", titulo: "Malo" },
			{ url: "ftp://otro/x", titulo: "Otro esquema" },
			{ url: "https://ejemplo.mx/apoyo", titulo: "Un apoyo" },
		],
		archivos: [],
	},
};

ok("textoFase: el texto de todo el grupo", S.textoFase(sesionPP, "inicio"), "8:00 a 8:20 · Asamblea de bienvenida.");
ok("textoFase: una fase sin texto da vacío (no «Sin información»)", S.textoFase({ id: "x" }, "inicio"), "");
ok("textoFase: sin sesión no truena", S.textoFase(null, "inicio"), "");
ok("textoFase: texto por grado se rotula «Grado 1:»", S.textoFase({ inicio_diferenciado: { "1": "Dibuja", "2": "Escribe" } }, "inicio"), "Grado 1: Dibuja\nGrado 2: Escribe");
ok("textoFase: texto por grupo de trabajo se rotula tal cual (no «Grado Morado»)", S.textoFase({ inicio_diferenciado: { Morado: "Colorea" } }, "inicio"), "Morado: Colorea");
ok("actividadesFase: todo el grupo, luego 1° y luego los grupos en su orden", S.actividadesFase(sesionPP, "desarrollo"),
	["El docente muestra la página.", "1°: Solo 1°: cuentan.", "Morado: Repasan su nombre con el dedo.", "Naranja: Arman su nombre con letras móviles."]);
ok("actividadesFase: acepta una lista simple", S.actividadesFase(sesionPP, "cierre"), ["Pausa activa de tres minutos."]);
ok("actividadesFase: sin datos, lista vacía", S.actividadesFase({}, "cierre"), []);
ok("tareasCierre: por grado, «1°: …» (el bot guarda texto, Crear proyecto lista)", S.tareasCierre(sesionPP),
	["1°: Platica en casa cuál regla te gustó.", "2°: Escribe la regla en tu cuaderno."]);
ok("tareasCierre: para todo el grupo, sin rótulo", S.tareasCierre({ cierre_tareas: { mode: "todos", todos: ["Lee en casa"] } }), ["Lee en casa"]);
ok("tareasCierre: arreglo de objetos", S.tareasCierre({ cierre_tareas: [{ descripcion: "Trae un dibujo", grado: 3 }] }), ["3°: Trae un dibujo"]);
ok("tareasCierre: sin tareas", S.tareasCierre({ cierre_tareas: null }), []);

const rec = S.recursos(sesionPP);
ok("recursos: solo http(s), sin javascript: ni otros esquemas", rec.map((r) => r.titulo), [
	"Anexos de la sesión 1 (carpeta de Drive)", "El origen de las letras — Múltiples Lenguajes 1°, p.100", "S01-01 · Organización de grupos", "Un apoyo"]);
ok("recursos: clasifica anexos (Drive), libros (CONALITEG) y otros", rec.map((r) => r.tipo), ["anexo", "libro", "anexo", "otro"]);
ok("recursos: el título sale de `titulo` o de `nombre`", rec[1].titulo.indexOf("El origen") === 0, true);
ok("recursos: también acepta un arreglo o un texto JSON",
	[S.recursos({ recursos: [{ url: "https://a.mx", titulo: "A" }] }).length, S.recursos({ recursos: JSON.stringify({ links: [{ url: "https://b.mx", nombre: "B" }] }) }).length, S.recursos({ recursos: "no es json" }).length], [1, 1, 0]);

ok("hayContenido: una sesión con secuencia", S.hayContenido(sesionPP), true);
ok("hayContenido: una sesión vacía", S.hayContenido({ id: "z" }), false);
ok("hayContenido: solo enlaces cuenta", S.hayContenido({ recursos: { links: [{ url: "https://a.mx", titulo: "A" }] } }), true);

const html = S.html(sesionPP);
ok("html: las tres fases y los anexos y libros", ["inicio", "desarrollo", "cierre", "recursos"].every((f) => html.indexOf("data-secuencia-fase='" + f + "'") !== -1), true);
ok("html: en el orden inicio, desarrollo, cierre, anexos",
	html.indexOf("data-secuencia-fase='inicio'") < html.indexOf("data-secuencia-fase='desarrollo'") &&
	html.indexOf("data-secuencia-fase='desarrollo'") < html.indexOf("data-secuencia-fase='cierre'") &&
	html.indexOf("data-secuencia-fase='cierre'") < html.indexOf("data-secuencia-fase='recursos'"), true);
ok("html: las tareas del cierre", html.indexOf("Tareas del cierre:") !== -1 && html.indexOf("1°: Platica en casa") !== -1, true);
ok("html: enlaces externos en pestaña nueva y con noopener", (html.match(/<a href='https:[^>]*target='_blank' rel='noopener noreferrer'/g) || []).length, 4);
ok("html: cada enlace mide al menos 44 px", (html.match(/<a [^>]*min-h-\[44px\]/g) || []).length, 4);
ok("html: nada de javascript: en los enlaces", html.indexOf("javascript:"), -1);
ok("html: separa «Anexos» y «Libros de texto»", html.indexOf(">Anexos<") !== -1 && html.indexOf(">Libros de texto<") !== -1, true);
ok("html: escapa el texto (no se cuela HTML)", S.html({ inicio_todos: "<img src=x onerror=alert(1)>" }).indexOf("<img"), -1);
ok("html: una fase sin nada dice «Sin información registrada.»", /Inicio<\/h4><p[^>]*>Sin información registrada\./.test(S.html({ cierre_todos: "x" })), true);
ok("html: sin sesión, vacío", S.html(null), "");
ok("las columnas a leer incluyen texto, actividades, tareas y recursos", ["inicio_todos", "desarrollo_actividades", "cierre_tareas", "recursos"].every((c) => S.COLUMNAS.indexOf(c) !== -1), true);

// El módulo no depende de la sesión activa de Inicio ni toca el DOM
const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "secuencia-sesion.js"), "utf8");
ok("sin estado global de otra pantalla (sesionActiva) ni DOM", !/sesionActiva|document\./.test(fuente.replace(/\/\*[\s\S]*?\*\//g, "")), true);
ok("hoy.html carga texto-sesion.js y secuencia-sesion.js antes de hoy.js", (() => {
	const h = fs.readFileSync(path.join(__dirname, "..", "hoy.html"), "utf8");
	const a = h.indexOf('src="js/texto-sesion.js"'), b = h.indexOf('src="js/secuencia-sesion.js"'), c = h.indexOf('src="js/hoy.js"');
	return a !== -1 && a < b && b < c;
})(), true);
ok("dashboard.js sigue como estaba (la Fase 2 lo pasa a este módulo)", /function getTextoFase\(fase\)/.test(fs.readFileSync(path.join(__dirname, "..", "js", "dashboard.js"), "utf8")), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
