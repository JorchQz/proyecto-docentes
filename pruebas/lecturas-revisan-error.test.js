/*
	Lecturas que revisan su error (3.7): ninguna pantalla sigue como si nada cuando una
	lectura de Supabase falla.

	Dos revisiones seguidas encontraron lo mismo en pantallas distintas: una lectura falla,
	la pantalla cree que no hay nada guardado, dice "nada pendiente" y el siguiente guardado
	pisa lo capturado. Esta prueba revisa TODAS las lecturas de js/: cada una debe
	  - ir dentro de un paginador (LeerTodo, AlcanceHoy.leerPorLotes, todas(): lanzan el
	    error), o
	  - revisar su error (`x.error` o `{ data, error }` con `error` usado después), o
	  - llevar justo antes un comentario "lectura-opcional: <razón>" que diga por qué es
	    seguro seguir sin ese dato (nada se guarda con él y la pantalla no afirma nada).
	Una lectura nueva que no cumpla hace fallar la prueba.

	node pruebas/lecturas-revisan-error.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

const DIR = path.join(__dirname, "..", "js");
const PAGINADOR = /(LeerTodo\.paginas|LeerTodo\.porLotes|leerPorLotes|\btodas|\bleer)\(/;
const sinRevisar = [];
const opcionales = [];
let revisadas = 0;

fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).forEach((archivo) => {
	const s = fs.readFileSync(path.join(DIR, archivo), "utf8");
	const re = /\.from\(\s*["']([a-z_]+)["']\s*\)/g;
	let m;
	while ((m = re.exec(s))) {
		let fin = s.indexOf(";", m.index);
		if (fin < 0 || fin - m.index > 900) fin = m.index + 900;
		const cadena = s.slice(m.index, fin);
		const antesDelSelect = cadena.split(".select(")[0];
		if (!/\.select\(/.test(cadena) || /\.(insert|update|upsert|delete)\(/.test(antesDelSelect)) continue;
		revisadas++;
		const linea = s.slice(0, m.index).split("\n").length;
		const donde = archivo + ":" + linea + " " + m[1];

		// Comentario "lectura-opcional:" en las 6 líneas anteriores
		const inicioLinea = s.lastIndexOf("\n", m.index);
		let desde = inicioLinea;
		for (let i = 0; i < 6 && desde > 0; i++) desde = s.lastIndexOf("\n", desde - 1);
		const previoLineas = s.slice(Math.max(0, desde), m.index);
		if (/lectura-opcional:/.test(previoLineas)) { opcionales.push(donde); continue; }
		// "error-revisado-en: <nombre>": el error se revisa más adelante con ese nombre (p. ej.
		// Promise.all o una consulta que se arma antes del await); el nombre debe aparecer después
		const marca = previoLineas.match(/error-revisado-en:\s*([\w.]+)/);
		if (marca) {
			if (s.slice(fin, fin + 3000).indexOf(marca[1]) === -1) sinRevisar.push(donde + " (marca sin uso: " + marca[1] + ")");
			continue;
		}

		// Dentro de un paginador (la llamada abre poco antes y no se cerró con ";")
		const previo = s.slice(Math.max(0, m.index - 260), m.index);
		// El paginador abre antes y la consulta va dentro de la función que se le pasa
		const pag = previo.search(PAGINADOR);
		if (pag !== -1 && /function\s*\(\s*\w*\s*\)|=>/.test(previo.slice(pag))) continue;
		// Consulta armada en una función con nombre que se pasa a un paginador
		const fn = previo.match(/function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*$/);
		if (fn && new RegExp("(paginas|porLotes|leerPorLotes|todas)\\([^;]*\\b" + fn[1] + "\\b").test(s)) continue;

		// La sentencia: desde el último ";" o "{" antes de .from
		const corte = Math.max(s.lastIndexOf(";", m.index), s.lastIndexOf("{\n", m.index), s.lastIndexOf("{\r\n", m.index));
		const sentencia = s.slice(corte + 1, m.index);
		const despues = s.slice(fin, fin + 3000);
		let revisa = false;
		const desestructura = sentencia.match(/\{\s*(?:data|count)(?:\s*:\s*\w+)?\s*,\s*error(?:\s*:\s*(\w+))?\s*\}\s*=\s*await/);
		if (desestructura) {
			const nombre = desestructura[1] || "error";
			revisa = new RegExp("\\b" + nombre + "\\b").test(despues);
		} else {
			const asigna = sentencia.match(/(\w+)\s*=\s*await\b/);
			if (asigna) revisa = new RegExp("\\b" + asigna[1] + "\\.error\\b").test(despues);
		}
		if (!revisa) sinRevisar.push(donde);
	}
});

ok("se revisaron las lecturas de js/", revisadas > 80, revisadas + " lecturas");
ok("ninguna lectura ignora su error (salvo las marcadas lectura-opcional con su razón)",
	sinRevisar.length === 0, sinRevisar.length + ": " + sinRevisar.join(", "));
console.log("     marcadas lectura-opcional: " + opcionales.length + (opcionales.length ? " (" + opcionales.join(", ") + ")" : ""));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
