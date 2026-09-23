/*
	Plan de la sesión en Inicio (js/dashboard.js, bloque 3.10).

	Las actividades llegan como lista, texto o el objeto de "Crear proyecto"
	{ mode, todos, diferenciado }. Antes ese objeto se pintaba tal cual y salía
	"• todos • null" en Inicio, Desarrollo y Cierre.

	node pruebas/inicio-actividades.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "dashboard.js"), "utf8");
function fn(nombre) {
	const m = fuente.match(new RegExp("\\nfunction " + nombre + "\\([\\s\\S]*?\\n\\}"));
	if (!m) { console.log("FALLA no se encontró " + nombre + " en js/dashboard.js"); process.exit(1); }
	return m[0];
}
function crear(sesion) {
	return new Function("sesionActiva",
		fn("textoActividad") + fn("getActividadesFase") + fn("getTextoFase") +
		"\nreturn { actividades: getActividadesFase, texto: getTextoFase };")(sesion);
}

let p = crear({ inicio_actividades: { mode: "todos", todos: [], diferenciado: null }, inicio_todos: "" });
ok("objeto vacío de Crear proyecto: sin 'todos' ni 'null'", p.actividades("inicio"), []);
ok("sin texto: aviso neutro", p.texto("inicio"), "Sin información registrada.");

p = crear({ desarrollo_actividades: { mode: "diferenciado", todos: [], diferenciado: { 1: ["Lee un cuento"], 2: [{ descripcion: "Escribe un final" }] } } });
ok("diferenciado por grado", p.actividades("desarrollo"), ["1°: Lee un cuento", "2°: Escribe un final"]);

p = crear({ cierre_actividades: ["Comparte", { descripcion: "Reflexiona" }, null, ""] });
ok("lista mixta sin vacíos", p.actividades("cierre"), ["Comparte", "Reflexiona"]);

p = crear({ inicio_actividades: { mode: "todos", todos: ["Pregunta detonadora"], diferenciado: null } });
ok("todos con actividades", p.actividades("inicio"), ["Pregunta detonadora"]);

p = crear({ inicio_diferenciado: { 1: "Dibuja", 2: { texto: "Escribe" } } });
ok("texto diferenciado con objetos", p.texto("inicio"), "Grado 1: Dibuja\nGrado 2: Escribe");

p = crear({ inicio_actividades: { raro: { descripcion: "Algo" }, otro: null } });
ok("objeto de otra forma: solo textos legibles", p.actividades("inicio"), ["Algo"]);

console.log(fallos ? fallos + " FALLAS" : "TODO OK");
process.exit(fallos ? 1 : 0);
