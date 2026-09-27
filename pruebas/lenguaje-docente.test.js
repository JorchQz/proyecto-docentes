/*
	Lenguaje "docente" en los textos visibles (regla de Jorge, 2026-09-26; spec de cobros §0 y §7):
	Mi Salón es para docentes, hombres y mujeres. En la app, los correos, los avisos y la
	publicidad se dice "docente" o "docentes", nunca solo "maestra" o "maestro"; se habla de "tú"
	y sin palabras con género sobre la persona ("Bienvenida", "¿Estás segura?", "lista para").

	Recorre el texto que ve la persona (sin comentarios):
	  - el SaaS: todos los *.html de la raíz y js/*.js;
	  - la tienda en lo que toca a Mi Salón: presentación, compra, login, avisos, panel de Mi Salón
	    (sus textos de WhatsApp), Mis compras y la barra común; y la página de la Sala;
	  - los correos y mensajes de las Edge Functions (todos los .ts de supabase/functions);
	  - los textos de avisos y errores de las migraciones del lanzamiento (b20, b21 y b22).
	Palabras: maestra/o(s), profesor/a(s), "(a)" pegado a una palabra, "Bienvenida/o" como saludo,
	y "estás/eres segura/o, lista/o, preparada/o...".

	Lista blanca (EXCEPCIONES, cada una con su razón):
	  - "Sala de Maestros": nombre propio de la sección (pregunta abierta para Jorge).
	  - Valores guardados, no textos: sexo_docente "profesora"/"profesor", origen "maestro".
	  - "Director(a)": se refiere a quien dirige la escuela, no a la persona usuaria.
	  - Etiquetas de archivos de la TIENDA (fuera de Mi Salón): "Clave del maestro" y
	    "(maestro y alumno)" (pendiente de decidir con Jorge; están en tienda/js/producto.js,
	    tienda/js/landing.js y las Edge archivos-proyecto y contenido-paquete).
	  - tienda/privacidad.html y tienda/terminos.html NO se revisan aquí (textos legales
	    aprobados, con "usted"; los revisa pruebas/conoce-mi-salon-textos.test.js).

	node pruebas/lenguaje-docente.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── Archivos ─────────────────────────────────────────────────────────────────
const lista = (dir, ext) => fs.readdirSync(path.join(RAIZ, dir)).filter((f) => f.endsWith(ext)).map((f) => (dir === "." ? f : dir + "/" + f));
function tsDe(dir) {
	let salida = [];
	fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).forEach((d) => {
		const r = dir + "/" + d.name;
		if (d.isDirectory()) salida = salida.concat(tsDe(r));
		else if (d.name.endsWith(".ts")) salida.push(r);
	});
	return salida;
}
const TIENDA = ["tienda/conoce-mi-salon.html", "tienda/js/conoce-mi-salon.js", "tienda/mi-salon-compra.html", "tienda/js/mi-salon-compra.js",
	"tienda/login.html", "tienda/js/login.js", "tienda/js/tienda-common.js", "tienda/js/mis-compras.js", "tienda/mis-compras.html",
	"tienda/js/admin-mi-salon.js", "tienda/js/admin-mi-salon-cobros.js", "tienda/conoce-sala.html", "tienda/checkout.html"]
	.filter((f) => fs.existsSync(path.join(RAIZ, f)));
const SQL = ["supabase/mi_salon_b20_registro_historico_2026-09.sql", "supabase/mi_salon_b21_acceso_2026-09.sql", "supabase/mi_salon_b22_cobros_2026-09.sql"];
const ARCHIVOS = lista(".", ".html").concat(lista("js", ".js"), TIENDA, tsDe("supabase/functions"), SQL);

// Texto sin comentarios, con las líneas en su lugar (para decir la línea)
function sinComentarios(texto, archivo) {
	const blanco = (m) => m.replace(/[^\n]/g, " ");
	let t = texto;
	if (archivo.endsWith(".sql")) {
		// Solo los textos entre comillas simples (avisos, errores, correos); fuera, todo es código
		t = t.replace(/--[^\n]*/g, blanco);
		t = t.replace(/comment on [\s\S]*?';/g, blanco); // comentarios de la base: no los ve nadie
		// Solo las frases: un literal sin espacios es un valor ('bienvenida', 'pago'), no un texto
		const salida = t.replace(/[^\n]/g, " ").split("");
		t.replace(/'((?:[^']|'')*)'/g, (m, c, i) => {
			if (/\s/.test(c)) for (let k = 0; k < c.length; k++) if (c[k] !== "\n") salida[i + 1 + k] = c[k];
			return m;
		});
		return salida.join("");
	}
	t = t.replace(/<!--[\s\S]*?-->/g, blanco);
	t = t.replace(/\/\*[\s\S]*?\*\//g, blanco);
	t = t.replace(/(^|[^:"'\\\w])\/\/[^\n]*/g, (m, a) => a + blanco(m.slice(a.length)));
	if (archivo.endsWith(".html")) return t;
	// JS y TS: solo el contenido de las cadenas (lo demás es código: nombres de funciones y
	// variables). Una cadena que parece un valor (minúsculas, sin espacios: "bienvenida",
	// "maestro", "mi_salon_correos") no es un texto que se muestre.
	const salida = t.replace(/[^\n]/g, " ").split("");
	t.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m, i) => {
		const c = m.slice(1, -1);
		if (/^[a-z0-9_\-\/.:#?=&]*$/.test(c)) return m;
		for (let k = 0; k < c.length; k++) if (c[k] !== "\n") salida[i + 1 + k] = c[k];
		return m;
	});
	return salida.join("");
}

// ── Excepciones ─────────────────────────────────────────────────────────────
const PERMITIDOS = [
	{ re: /Sala de Maestros/g, razon: "nombre propio de la sección" },
	{ re: /value="profesora?"|["']profesora?["']/g, razon: "valor guardado de sexo_docente" },
	{ re: /["']maestr[oa]s?["']|\.maestro\b|\bmaestro:\s|sala-maestros/g, razon: "valor, propiedad o ruta interna, no texto" },
	{ re: /bienvenida-mi-salon|tipo:\s*["']bienvenida["']/g, razon: "nombre de la Edge y tipo de correo, no saludo" },
	{ re: /Director\(a\)/g, razon: "quien dirige la escuela, no la persona usuaria" },
	{ re: /Clave del maestro|\(maestro y alumno\)/g, razon: "etiquetas de archivos de la tienda (pendiente con Jorge)" },
];
const PALABRAS = [
	{ nombre: "maestra/maestro", re: /\bmaestr[oa]s?\b/gi },
	{ nombre: "profesor/profesora", re: /\bprofesor(a|as|es)?\b/gi },
	{ nombre: "(a) pegado", re: /[a-záéíóúñ]{2,}(or|o|e|es|os)\((a|as)\)(?=[\s"'<.,:!?]|$)/gi },
	{ nombre: "Bienvenida como saludo", re: /(^|[^a-záéíóúñ]\s*)(?<!\b(la|de|una|su|tu|el)\s)\bbienvenid[oa]s?\b/gi },
	{ nombre: "adjetivo con género sobre la persona", re: /\b(estás|estas|eres|quedas|quedaste)\s+(segur|list|preparad|cansad|interesad|registrad|invitad|suscrit|lleg)[oa]s?\b/gi },
];

const hallazgos = [];
const usados = new Set();
ARCHIVOS.forEach((archivo) => {
	if (/tienda\/(privacidad|terminos)\.html$/.test(archivo)) return;
	let t = sinComentarios(leer(archivo), archivo);
	PERMITIDOS.forEach((p, i) => { t = t.replace(p.re, (m) => { usados.add(i); return m.replace(/[^\n]/g, " "); }); });
	const lineas = t.split("\n");
	lineas.forEach((l, n) => {
		PALABRAS.forEach((p) => {
			const m = l.match(p.re);
			if (m) hallazgos.push(archivo + ":" + (n + 1) + " [" + p.nombre + "] " + m.join(" | ").trim());
		});
	});
});
console.log("Archivos revisados: " + ARCHIVOS.length);
ok("ningún texto visible dice maestra/maestro ni usa palabras con género sobre la persona", hallazgos, []);

// La prueba sí detecta (con textos de mentira)
function detecta(texto, archivo) {
	let t = sinComentarios(texto, archivo || "x.js");
	PERMITIDOS.forEach((p) => { t = t.replace(p.re, (m) => m.replace(/[^\n]/g, " ")); });
	return PALABRAS.filter((p) => p.re.test(t) && ((p.re.lastIndex = 0), true)).map((p) => p.nombre);
}
PALABRAS.forEach((p) => { p.re.lastIndex = 0; });
ok("detecta: 'Bienvenida, maestra' en un texto", detecta('x = "¡Bienvenida, maestra!";'), ["maestra/maestro", "Bienvenida como saludo"]);
ok("detecta: 'Nombre del Profesor(a)'", detecta("<label>Nombre del Profesor(a)</label>", "a.html"), ["profesor/profesora", "(a) pegado"]);
ok("detecta: '¿Estás segura?'", detecta('confirm("¿Estás segura de borrar?")'), ["adjetivo con género sobre la persona"]);
ok("no marca: 'Te damos la bienvenida', 'correo de bienvenida', maestro_id ni comentarios",
	detecta('t = "Te damos la bienvenida"; u = "el correo de bienvenida"; q.eq("maestro_id", id); // la maestra\n/* el maestro */'), []);
ok("no marca: Sala de Maestros ni los valores guardados", detecta('a = "Sala de Maestros"; if (s === "profesora") x = { origen: "maestro" };'), []);
ok("SQL: solo revisa los textos entre comillas (no los comentarios)", detecta("-- la maestra\nraise exception 'Hola maestra';", "b.sql"), ["maestra/maestro"]);
ok("cada excepción de la lista blanca se usa (si ya no hace falta, se quita)", PERMITIDOS.map((p, i) => usados.has(i) ? "" : p.razon).filter(Boolean), []);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
