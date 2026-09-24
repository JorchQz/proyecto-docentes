/*
	Lecturas que MANEJAN su error (3.7): ninguna pantalla sigue como si nada cuando una
	lectura de Supabase falla.

	Tres revisiones seguidas encontraron lo mismo en pantallas distintas: una lectura falla,
	la pantalla cree que no hay nada guardado, dice "no hay alumnos", "0 alumnos" o "no tienes
	proyecto activo" y el siguiente guardado pisa lo capturado. La versión anterior de esta
	prueba solo exigía que el error se MENCIONARA después de la lectura; no que se manejara
	bien, y no veía a quien llama a GrupoActivo.cargar. Ahora cada lectura de js/ debe:
	  - ir por una lectura que LANZA el error: la capa común (Lectura.uno, Lectura.contar,
	    Lectura.todas, Lectura.porLotes; js/lectura.js) o un paginador (LeerTodo,
	    AlcanceHoy.leerPorLotes, todas() del motor); o
	  - revisar su error con un `if` que lo MANEJA: el bloque lanza (`throw`) o avisa y sale
	    (una llamada que no sea console.* y un `return` que no devuelva un vacío: 0, [], {},
	    "" o null). No vale mezclar el error con la ausencia de datos (`if (x.error ||
	    !x.data)`: así se decía "no encontrado" cuando la lectura había fallado), ni usar el
	    error en un ternario o en una asignación antes de revisarlo; o
	  - llevar justo antes un comentario "lectura-opcional: <razón>" que diga por qué es
	    seguro seguir sin ese dato (nada se guarda con él y la pantalla no afirma nada).
	Además:
	  - quien llama a GrupoActivo.cargar no se traga su error (un catch que solo registra y
	    sigue mostraba los proyectos de todos los grupos o "crea tu grupo");
	  - toda página con el candado carga js/lectura.js entre js/supabase.js y el candado, y
	    antes de js/grupo-activo.js; la que usa Lectura.todas/porLotes carga js/leer-todo.js.
	El comportamiento de la capa (lanzar, detener la página, GrupoActivo.cargar en error) se
	prueba ejecutándola en pruebas/lectura.test.js.

	node pruebas/lecturas-revisan-error.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

const RAIZ = path.join(__dirname, "..");
const DIR = path.join(RAIZ, "js");
// Lecturas que lanzan el error (la capa común y los paginadores)
const LANZA = /(Lectura\.(uno|contar|todas|porLotes)|LeerTodo\.paginas|LeerTodo\.porLotes|leerPorLotes|\btodas|\bleer)\(/;
const VACIO = /\breturn\s*(0|\[\s*\]|\{\s*\}|""|''|null)\s*;/;

// Cuerpo de un bloque que empieza en `desde` (la posición de "{" o de la primera sentencia)
function bloque(s, desde) {
	let i = desde;
	while (/\s/.test(s[i])) i++;
	if (s[i] !== "{") {
		const fin = s.indexOf(";", i);
		return s.slice(i, fin + 1);
	}
	let prof = 0;
	for (let j = i; j < s.length; j++) {
		if (s[j] === "{") prof++;
		else if (s[j] === "}") { prof--; if (prof === 0) return s.slice(i, j + 1); }
	}
	return s.slice(i);
}

// La condición de un `if (` que empieza en `pos` (posición de "(") y dónde termina
function condicion(s, pos) {
	let prof = 0;
	for (let j = pos; j < s.length; j++) {
		if (s[j] === "(") prof++;
		else if (s[j] === ")") { prof--; if (prof === 0) return { texto: s.slice(pos + 1, j), fin: j + 1 }; }
	}
	return { texto: "", fin: s.length };
}

/*
	¿El error de nombre `nombre` (p. ej. "error" o "res.error") se maneja en `despues`?
	Devuelve null si sí, o el motivo si no.
*/
function manejo(despues, nombre) {
	const re = new RegExp("(^|[^\\w.])" + nombre.replace(/\./g, "\\.") + "\\b", "g");
	const m = re.exec(despues);
	if (!m) return "el error no se revisa";
	const uso = m.index + m[1].length;
	// El primer uso debe ser la condición de un if
	const antes = despues.slice(0, uso);
	const abre = antes.lastIndexOf("if (");
	if (abre === -1 || /[;{}]/.test(antes.slice(abre))) {
		return "el error se usa antes de revisarlo (ternario o asignación): " + despues.slice(Math.max(0, uso - 40), uso + nombre.length + 20).replace(/\s+/g, " ");
	}
	const cond = condicion(despues, abre + 3);
	if (/\|\|\s*!/.test(cond.texto) || /!\s*[\w.]+\s*\|\|/.test(cond.texto)) {
		return "mezcla el error con la ausencia de datos: if (" + cond.texto.replace(/\s+/g, " ") + ")";
	}
	if (/^\s*!/.test(cond.texto)) return "la condición niega el error: if (" + cond.texto + ")";
	const cuerpo = bloque(despues, cond.fin);
	if (/\bthrow\b/.test(cuerpo)) return null;
	if (VACIO.test(cuerpo)) return "el bloque del error devuelve un vacío: " + cuerpo.replace(/\s+/g, " ").slice(0, 120);
	const avisa = /\b(?!console\b)[A-Za-z_$][\w$]*(\.[\w$]+)*\s*\(/.test(cuerpo.replace(/console\.\w+\s*\([^;]*;/g, ""));
	if (/\breturn\b/.test(cuerpo) && avisa) return null;
	return "el bloque del error ni lanza ni avisa y sale: " + cuerpo.replace(/\s+/g, " ").slice(0, 120);
}

const sinManejar = [];
const opcionales = [];
let revisadas = 0;

// Solo los archivos que alguna página carga (js/auth.js, por ejemplo, ya no lo carga
// ninguna: el acceso es por tienda/login.html)
function htmlDe(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		if (e.isDirectory()) return ["node_modules", ".git", ".qa", "supabase"].indexOf(e.name) !== -1 ? [] : htmlDe(path.join(dir, e.name));
		return e.name.endsWith(".html") ? [path.join(dir, e.name)] : [];
	});
}
const cargados = new Set();
htmlDe(RAIZ).forEach((h) => {
	const html = fs.readFileSync(h, "utf8");
	const rs = /<script[^>]*src="(?:\.\.\/|\/)?js\/([^"?]+)"/g;
	let x;
	while ((x = rs.exec(html))) cargados.add(x[1]);
});
const sinPagina = fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && !cargados.has(f));

fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && cargados.has(f)).forEach((archivo) => {
	const s = fs.readFileSync(path.join(DIR, archivo), "utf8");
	const re = /\.from\(\s*["']([a-z_]+)["']\s*\)/g;
	let m;
	while ((m = re.exec(s))) {
		let fin = s.indexOf(";", m.index);
		if (fin < 0 || fin - m.index > 900) fin = m.index + 900;
		const cadena = s.slice(m.index, fin);
		const antesDelSelect = cadena.split(".select(")[0];
		if (!/\.select\(/.test(cadena) || /\.(insert|update|upsert|delete)\(/.test(antesDelSelect)) continue;
		// El almacenamiento de archivos (sb.storage.from) no es una tabla
		if (/storage\s*$/.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
		revisadas++;
		const linea = s.slice(0, m.index).split("\n").length;
		const donde = archivo + ":" + linea + " " + m[1];

		// Comentario "lectura-opcional: <razón>" en las 6 líneas anteriores
		const inicioLinea = s.lastIndexOf("\n", m.index);
		let desde = inicioLinea;
		for (let i = 0; i < 6 && desde > 0; i++) desde = s.lastIndexOf("\n", desde - 1);
		const previoLineas = s.slice(Math.max(0, desde), m.index);
		const opcional = previoLineas.match(/lectura-opcional:\s*(\S.{9,})/);
		if (opcional) { opcionales.push(donde); continue; }
		if (/lectura-opcional:/.test(previoLineas)) { sinManejar.push(donde + " (lectura-opcional sin razón)"); continue; }

		// Dentro de una lectura que lanza (la llamada abre poco antes y no se cerró con ";")
		const previo = s.slice(Math.max(0, m.index - 260), m.index);
		// La ÚLTIMA lectura que lanza abierta antes de .from
		let pag = -1;
		const reLanza = new RegExp(LANZA.source, "g");
		let l;
		while ((l = reLanza.exec(previo))) pag = l.index;
		if (pag !== -1 && !/;/.test(previo.slice(pag))) continue;
		if (pag !== -1 && /function\s*\(\s*\w*\s*\)|=>/.test(previo.slice(pag))) continue;
		// Consulta armada en una función con nombre que se pasa a un paginador
		const fn = previo.match(/function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*$/);
		if (fn && new RegExp("(paginas|porLotes|leerPorLotes|todas)\\([^;]*\\b" + fn[1] + "\\b").test(s)) continue;

		// La sentencia: desde el último ";" o "{" antes de .from
		const corte = Math.max(s.lastIndexOf(";", m.index), s.lastIndexOf("{\n", m.index), s.lastIndexOf("{\r\n", m.index));
		const sentencia = s.slice(corte + 1, m.index);
		const despues = s.slice(fin, fin + 3000);

		// Consulta que se arma aquí y se pasa después a la capa (let consulta = sb.from(...); ...
		// Lectura.uno(consulta...))
		const armada = sentencia.match(/(?:let|var|const)\s+(\w+)\s*=\s*(?:await\s+)?window\.sb\s*$/) ||
			sentencia.match(/(?:let|var|const)\s+(\w+)\s*=\s*(?:await\s+)?(?:window\.)?sb\s*$/);
		if (armada && new RegExp("Lectura\\.(uno|contar)\\(\\s*" + armada[1] + "\\b").test(despues.slice(0, 1500))) continue;

		// "error-revisado-en: <nombre>": el error se revisa más adelante con ese nombre (p. ej.
		// Promise.all); ese nombre debe MANEJARSE como cualquier otro
		const marca = previoLineas.match(/error-revisado-en:\s*([\w.]+)/);
		let motivo;
		if (marca) {
			motivo = manejo(despues, marca[1]);
			// El resultado se le pasa a una función del mismo archivo que revisa su error y sale
			// (p. ej. Portal.destinoMiSalon(res))
			const fnDef = new RegExp("function\\s+" + marca[1] + "\\s*\\(([^)]*)\\)").exec(s);
			if (motivo && fnDef && new RegExp("\\b" + marca[1] + "\\(").test(despues)) {
				const cuerpoFn = bloque(s, fnDef.index + fnDef[0].length);
				const param = fnDef[1].split(",")[0].trim();
				if (param && new RegExp("\\b" + param + "\\.error\\b[^;{]*\\)\\s*return\\b").test(cuerpoFn)) motivo = null;
			}
		} else {
			const desestructura = sentencia.match(/\{\s*(?:data|count)(?:\s*:\s*\w+)?\s*,\s*error(?:\s*:\s*(\w+))?\s*\}\s*=\s*await/);
			const asigna = sentencia.match(/(\w+)\s*=\s*await\b/);
			if (desestructura) motivo = manejo(despues, desestructura[1] || "error");
			else if (asigna) motivo = manejo(despues, asigna[1] + ".error");
			else motivo = "no se puede ver cómo se revisa su error";
		}
		if (motivo) sinManejar.push(donde + " (" + motivo + ")");
	}
});

ok("se revisaron las lecturas de js/", revisadas > 80, revisadas + " lecturas");
ok("toda lectura maneja su error (lanza, o avisa y sale; salvo las lectura-opcional con su razón)",
	sinManejar.length === 0, sinManejar.length + ":\n       " + sinManejar.join("\n       "));
console.log("     sin ninguna página que los cargue (no se revisan): " + (sinPagina.join(", ") || "ninguno"));
console.log("     marcadas lectura-opcional: " + opcionales.length + (opcionales.length ? " (" + opcionales.join(", ") + ")" : ""));

// ── Quien llama a GrupoActivo.cargar no se traga su error ────────────────────
// GrupoActivo.cargar ya detiene la página si la lectura falla (y no devuelve nada); un
// try/catch alrededor que solo registra y sigue es justo lo que mostraba datos de todos
// los grupos. Un catch alrededor debe lanzar, detener la página o salir.
const tragados = [];
let llamadas = 0;
fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "grupo-activo.js").forEach((archivo) => {
	const s = fs.readFileSync(path.join(DIR, archivo), "utf8");
	const re = /GrupoActivo\.cargar\(/g;
	let m;
	while ((m = re.exec(s))) {
		llamadas++;
		const linea = s.slice(0, m.index).split("\n").length;
		// ¿Hay un try abierto que envuelve la llamada? (llaves sin cerrar desde el try)
		const previo = s.slice(Math.max(0, m.index - 1500), m.index);
		let t = previo.lastIndexOf("try {");
		while (t !== -1) {
			const tramo = previo.slice(t + 4);
			let prof = 0;
			for (const c of tramo) { if (c === "{") prof++; else if (c === "}") prof--; }
			if (prof > 0) break; // este try sigue abierto: envuelve la llamada
			t = previo.lastIndexOf("try {", t - 1);
		}
		if (t === -1) continue;
		const inicioTry = m.index - (previo.length - t);
		const cuerpoTry = bloque(s, inicioTry + 3);
		const tras = s.slice(inicioTry + 3 + cuerpoTry.length + (s.slice(inicioTry + 3).length - s.slice(inicioTry + 3).trimStart().length));
		const cm = tras.match(/^\s*catch\s*(\([^)]*\))?\s*/);
		if (!cm) continue;
		const cuerpoCatch = bloque(tras, cm[0].length);
		if (!/\bthrow\b|detenerPagina|\breturn\b/.test(cuerpoCatch)) {
			tragados.push(archivo + ":" + linea + " → catch " + cuerpoCatch.replace(/\s+/g, " ").slice(0, 80));
		}
	}
});
ok("se revisaron las llamadas a GrupoActivo.cargar", llamadas >= 12, llamadas + " llamadas");
ok("ninguna pantalla se traga el error de GrupoActivo.cargar", tragados.length === 0, tragados.join(" | "));

// ── Las páginas cargan la capa en su lugar ───────────────────────────────────
const paginas = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html"));
const malCargadas = [];
paginas.forEach((pagina) => {
	const html = fs.readFileSync(path.join(RAIZ, pagina), "utf8");
	const scripts = [];
	const rs = /<script[^>]*src="(js\/[^"]+)"/g;
	let m;
	while ((m = rs.exec(html))) scripts.push(m[1]);
	const pos = (n) => scripts.indexOf(n);
	const guard = pos("js/saas-guard.js"), lect = pos("js/lectura.js"), sup = pos("js/supabase.js"), ga = pos("js/grupo-activo.js");
	// El candado funciona sin la capa (portal.html: oculta la página y avisa), pero si la
	// página la carga, va entre js/supabase.js y el candado
	if (guard !== -1 && lect !== -1 && !(lect > sup && lect < guard)) malCargadas.push(pagina + ": js/lectura.js va entre js/supabase.js y js/saas-guard.js");
	if (ga !== -1 && !(lect !== -1 && lect < ga)) malCargadas.push(pagina + ": js/lectura.js va antes de js/grupo-activo.js");
	// Los scripts propios de la página que usan la capa
	scripts.forEach((src) => {
		const ruta = path.join(RAIZ, src);
		if (!fs.existsSync(ruta)) return;
		const codigo = fs.readFileSync(ruta, "utf8");
		// La capa misma, y el candado y el grupo activo, que la usan solo si la página la cargó
		if (["js/lectura.js", "js/saas-guard.js", "js/grupo-activo.js"].indexOf(src) !== -1) return;
		if (/Lectura\.\w+/.test(codigo) && (lect === -1 || lect > pos(src))) malCargadas.push(pagina + ": " + src + " usa Lectura y la página no carga antes js/lectura.js");
		if (/Lectura\.(todas|porLotes)\(/.test(codigo) && (pos("js/leer-todo.js") === -1 || pos("js/leer-todo.js") > pos(src))) malCargadas.push(pagina + ": " + src + " usa Lectura.todas/porLotes sin js/leer-todo.js antes");
	});
});
ok("las páginas cargan js/lectura.js (y js/leer-todo.js cuando hace falta) en su lugar", malCargadas.length === 0, malCargadas.join(" | "));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
