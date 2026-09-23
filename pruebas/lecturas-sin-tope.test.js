/*
	Lecturas sin tope (3.7): ninguna pantalla lee "todo" de una tabla que crece sin paginar.

	PostgREST devuelve como máximo 1000 filas y corta en silencio. Dos revisiones seguidas
	encontraron lecturas así (Hoy/Tareas/Inicio y luego Reportes), así que esta prueba
	revisa el código de js/: cada lectura de una tabla que crece con el uso debe
	  - ir paginada (LeerTodo, AlcanceHoy.leerPorLotes o el todas() del motor y de
	    reporte-datos), o
	  - llevar .range/.limit/.single/.maybeSingle, o
	  - estar en la lista de lecturas acotadas por naturaleza (un día, una sesión, un
	    alumno), cada una con su razón.
	Una lectura nueva que no cumpla hace fallar la prueba.

	node pruebas/lecturas-sin-tope.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

// Tablas que crecen con el uso (por alumno, por día, por producto o por catálogo grande)
const CRECEN = [
	"asistencias", "calificaciones", "registro_diario", "evaluacion_formativa", "v_avance_pda",
	"sesiones", "productos_sesion", "producto_sesion_pda", "sesiones_pda", "respuestas_examen",
	"catalogo_pda", "catalogo_contenidos", "boleta_trimestral", "evaluacion_diagnostica",
	"banco_preguntas", "banco_criterios_pda", "dosificacion_sesiones", "dosificacion_proyectos",
];

/*
	Acotadas por naturaleza: [archivo, tabla, filtro EXACTO que la acota, razón]. El filtro
	se busca tal cual en la consulta (un .gte("fecha", …) no pasa por un .eq("fecha", hoy)).
*/
const ACOTADAS = [
	["asistencia.js", "asistencias", ".eq(\"fecha\", attendanceDateIso)", "un día de un grupo"],
	["hoy.js", "asistencias", ".eq(\"fecha\", hoy)", "hoy, un grupo"],
	["hoy.js", "registro_diario", ".eq(\"fecha\", hoy)", "hoy"],
	["dashboard.js", "asistencias", ".eq(\"fecha\", hoy)", "hoy, un grupo"],
	["dashboard.js", "registro_diario", ".eq(\"fecha\", hoy)", "hoy"],
	["dashboard.js", "sesiones", ".eq(\"proyecto_id\", proyectoActivo.id)", "las sesiones de un proyecto"],
	["crear_proyecto.js", "sesiones", ".eq('proyecto_id', id)", "las sesiones de un proyecto"],
	["evaluacion_diagnostica.js", "evaluacion_diagnostica", ".eq(\"momento\", momentoActual)", "un grupo en un momento: uno por alumno"],
	["evaluacion_formativa.js", "evaluacion_formativa", ".eq(\"sesion_id\", sesionId)", "una sesión"],
	["evaluacion_formativa.js", "sesiones_pda", ".eq(\"sesion_id\", sesionId)", "una sesión"],
	["examen.js", "banco_preguntas", ".in(\"id\"", "las preguntas de un examen"],
	["importador.js", "dosificacion_sesiones", ".eq(\"proyecto_dos_id\", dosProyectoId)", "las sesiones de un proyecto del bot"],
	["marketplace.js", "dosificacion_sesiones", ".eq(\"proyecto_dos_id\"", "las sesiones de un proyecto del bot (vista previa)"],
	["reporte-datos.js", "v_avance_pda", ".eq(\"alumno_id\", alumno.id)", "un alumno en un trimestre"],
	["reportes.js", "boleta_trimestral", ".eq(\"alumno_id\", alumnoId)", "un alumno en un trimestre"],
	["reportes.js", "v_avance_pda", ".eq(\"alumno_id\", alumnoId)", "un alumno en un trimestre"],
];

const PAGINADORES = /(LeerTodo\.paginas|LeerTodo\.porLotes|leerPorLotes|\btodas|\bleer)\(/;
const DIR = path.join(__dirname, "..", "js");
const hallazgos = [];
let revisadas = 0;

fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).forEach((archivo) => {
	const s = fs.readFileSync(path.join(DIR, archivo), "utf8");
	const re = /\.from\(\s*["']([a-z_]+)["']\s*\)/g;
	let m;
	while ((m = re.exec(s))) {
		const tabla = m[1];
		if (CRECEN.indexOf(tabla) === -1) continue;
		let fin = s.indexOf(";", m.index);
		if (fin < 0 || fin - m.index > 900) fin = m.index + 900;
		const cadena = s.slice(m.index, fin);
		const antesDelSelect = cadena.split(".select(")[0];
		if (!/\.select\(/.test(cadena) || /\.(insert|update|upsert|delete)\(/.test(antesDelSelect)) continue;
		revisadas++;
		const linea = s.slice(0, m.index).split("\n").length;
		if (/\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|head:\s*true/.test(cadena)) continue;
		// Dentro de un paginador: la llamada abre unas líneas antes
		const previo = s.slice(Math.max(0, m.index - 260), m.index);
		if (PAGINADORES.test(previo)) continue;
		// Consulta armada en una función con nombre que se le pasa a un paginador
		const fn = previo.match(/function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*$/);
		if (fn && new RegExp("(paginas|porLotes|leerPorLotes|todas)\\([^;]*\\b" + fn[1] + "\\b").test(s)) continue;
		const acotada = ACOTADAS.find((a) => a[0] === archivo && a[1] === tabla && cadena.indexOf(a[2]) !== -1);
		if (acotada) continue;
		hallazgos.push(archivo + ":" + linea + " " + tabla);
	}
});

ok("se revisaron las lecturas de las tablas que crecen", revisadas > 30, revisadas + " lecturas");
ok("ninguna lectura sin tope fuera de la lista de acotadas", hallazgos.length === 0, hallazgos.join(", "));

// Cada entrada de la lista de acotadas sigue existiendo (si no, la lista miente)
ACOTADAS.forEach((a) => {
	const s = fs.readFileSync(path.join(DIR, a[0]), "utf8");
	const existe = new RegExp("\\.from\\(\\s*[\"']" + a[1] + "[\"']").test(s) && s.indexOf(a[2]) !== -1;
	ok("acotada vigente: " + a[0] + " " + a[1] + " (" + a[3] + ")", existe);
});

// ── LeerTodo: el paginador de las pantallas ──────────────────────────────────
const LeerTodo = require("../js/leer-todo.js");
function tablaFalsa(filas, registro) {
	return function (lote) {
		return {
			range(desde, hasta) {
				registro.push({ lote: lote ? lote.length : null, desde });
				const de = lote ? filas.filter((f) => lote.indexOf(f.k) !== -1) : filas;
				return Promise.resolve({ data: de.slice(desde, Math.min(hasta + 1, desde + 1000)), error: null });
			},
		};
	};
}
(async () => {
	const filas = Array.from({ length: 1329 }, (_, i) => ({ k: "k" + (i % 400), i }));
	let reg = [];
	let r = await LeerTodo.paginas(tablaFalsa(filas, reg));
	ok("paginas: 1329 filas (el catálogo de PDA de 1° a 6°)", r.length === 1329, r.length + " en " + reg.length + " páginas");
	reg = [];
	r = await LeerTodo.paginas(tablaFalsa(filas.slice(0, 1000), reg));
	ok("paginas: justo 1000 pide una página más y termina", r.length === 1000 && reg.length === 2);
	const ids = Array.from({ length: 400 }, (_, i) => "k" + i);
	reg = [];
	r = await LeerTodo.porLotes(ids, tablaFalsa(filas, reg));
	ok("porLotes: todas las filas, sin duplicados", r.length === 1329 && new Set(r.map((f) => f.i)).size === 1329);
	ok("porLotes: ningún lote pasa de " + LeerTodo.LOTE + " ids", reg.every((x) => x.lote <= LeerTodo.LOTE));
	let error = null;
	try { await LeerTodo.paginas(() => ({ range: () => Promise.resolve({ data: null, error: { message: "sin red" } }) })); }
	catch (e) { error = e.message; }
	ok("un error de Supabase se lanza, no se traga", error === "sin red");

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
