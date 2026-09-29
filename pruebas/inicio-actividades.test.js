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

// La regla de las llaves (grado o grupo de trabajo) vive en js/texto-sesion.js (la página la carga antes)
global.window = global.window || {};
require("../js/texto-sesion.js");

// Desde la Fase 2 (2026-09-29) Inicio muestra la secuencia con js/secuencia-sesion.js, la misma de Hoy: las
// reglas de texto son las mismas de antes, ahora con la sesión como parámetro
const S = require("../js/secuencia-sesion.js");
const dashboard = fs.readFileSync(path.join(__dirname, "..", "js", "dashboard.js"), "utf8");
function crear(sesion) {
	return {
		actividades: (fase) => S.actividadesFase(sesion, fase),
		texto: (fase) => S.textoFase(sesion, fase) || "Sin información registrada.",
		tareas: () => S.tareasCierre(sesion),
	};
}
ok("Inicio usa SecuenciaSesion.html y ya no tiene sus propios ayudantes", /SecuenciaSesion\.html\(sesion\)/.test(dashboard) && !/function getTextoFase|function extraerTareasCierre/.test(dashboard), true);

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

// ── Grupos de trabajo por nivel (PP-NIVELES, decisión de Jorge del 2026-09-27) ──
// Una llave que no es número de grado se rotula tal cual: antes salía "Morado°:" y "Grado Morado:"
p = crear({ desarrollo_actividades: { mode: "todos", todos: ["Calentamiento de sonidos"],
	diferenciado: { Azul: ["Nombres con mayúscula"], Morado: ["Vocal A"], Naranja: ["Sílabas con M"] },
	orden_grupos: ["Morado", "Naranja", "Azul"] } });
ok("pasos de todo el grupo y luego cada grupo, rotulado tal cual y en su orden", p.actividades("desarrollo"),
	["Calentamiento de sonidos", "Morado: Vocal A", "Naranja: Sílabas con M", "Azul: Nombres con mayúscula"]);

p = crear({ desarrollo_actividades: { mode: "todos", todos: [], diferenciado: { "Morado y Naranja": ["Arman su nombre"], Cuadrados: ["Tabla del 100"], "Círculos": ["Tapetes"] } } });
ok("sin orden_grupos: grupos en orden alfabético (con acentos)", p.actividades("desarrollo"),
	["Círculos: Tapetes", "Cuadrados: Tabla del 100", "Morado y Naranja: Arman su nombre"]);

p = crear({ desarrollo_diferenciado: { Morado: "Colorea", 2: "Escribe", 1: "Dibuja" } });
ok("texto diferenciado: grados primero ('Grado 1:') y el grupo tal cual", p.texto("desarrollo"), "Grado 1: Dibuja\nGrado 2: Escribe\nMorado: Colorea");

p = crear({ cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 2: "Escribe la regla", 1: "Dibuja la regla" } } });
ok("tareas por grado guardadas como texto (el bot): no truena y salen en orden", p.tareas(), ["1°: Dibuja la regla", "2°: Escribe la regla"]);

p = crear({ cierre_tareas: { mode: "diferenciado", todos: null, diferenciado: { 1: ["Lee"], 3: ["Suma", "Resta"] } } });
ok("tareas por grado en lista (Crear proyecto)", p.tareas(), ["1°: Lee", "3°: Suma", "3°: Resta"]);

console.log(fallos ? fallos + " FALLAS" : "TODO OK");
process.exit(fallos ? 1 : 0);
