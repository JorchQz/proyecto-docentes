/*
	Mi Salón solo guarda enlaces (decisión de Jorge del 2026-09-29; constructor AX).

	  1. Crear proyecto ya no ofrece subir archivos: sin input de archivo, sin subida a Storage, sin
	     clave-archivo.js; queda "Agregar enlace" con su ayuda (Google Drive recomendado). Los archivos
	     que se subieron antes (recursos.archivos) se siguen viendo, se pueden quitar como antes y se
	     guardan tal cual.
	  2. Ninguna página del SaaS sube archivos a Storage.
	  3. El visor (js/visor-recursos.js) solo abre libros de CONALITEG; Drive (archivo, carpeta, Docs,
	     Slides, Hojas) y cualquier otro sitio se abren en otra pestaña. El toque en un enlace de Drive no
	     se intercepta.
	  4. La secuencia de la sesión (js/secuencia-sesion.js): todos los enlaces con target _blank y
	     rel noopener noreferrer; solo los libros llevan data-visor-url; las menciones a libros dentro del
	     texto siguen enlazando al visor.

	node pruebas/recursos-solo-enlaces.test.js
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

// ── 1. Crear proyecto: solo enlaces ──────────────────────────────────────────
const cp = leer("js/crear_proyecto.js");
const cph = leer("crear_proyecto.html");
ok("Crear proyecto: sin input de archivo", /type=["']?file/i.test(cp) || /type=["']?file/i.test(cph), false);
ok("Crear proyecto: no sube a Storage (sin upload ni enlace firmado)", /\.upload\(|createSignedUrl|subirArchivo/.test(cp), false);
ok("Crear proyecto: sin textos de subir («Subiendo...», «No se pudo subir»)", /Subiendo|No se pudo subir|subir archivos/i.test(cp), false);
ok("crear_proyecto.html ya no carga clave-archivo.js", cph.indexOf("js/clave-archivo.js"), -1);
ok("Crear proyecto: botón «Agregar enlace»", /class="resource-link-add[^"]*">\s*Agregar enlace\s*<\/button>/.test(cp), true);
ok("Crear proyecto: ayuda junto a «Agregar enlace» (tú, sin género, Google Drive)",
	cp.indexOf("Pega el enlace de tu archivo o carpeta. Te recomendamos Google Drive. Por ahora no se suben archivos a Mi Salón.") !== -1, true);
ok("Crear proyecto: el enlace sigue siendo solo http(s)", /if \(!\/\^https\?:\\\/\\\/\/i\.test\(url\)\) \{/.test(cp), true);
// Archivos de antes
ok("archivos de antes: el bloque existe oculto y se muestra solo si hay alguno",
	/<div class="resource-files-wrap hidden">/.test(cp) && /recursosFilesWrap\.classList\.toggle\('hidden', archivosSubidos\.length === 0\)/.test(cp), true);
ok("archivos de antes: rótulo «Archivos que subiste antes»", /Archivos que subiste antes/.test(cp), true);
ok("archivos de antes: se cargan del proyecto o del borrador",
	/block\._cargarRecursos\(data\._archivos \|\| recursos\.archivos \|\| \[\], data\._links \|\| recursos\.links \|\| \[\]\)/.test(cp) &&
	/archivosSubidos = Array\.isArray\(archivos\) \? archivos\.slice\(\) : \[\];/.test(cp), true);
ok("archivos de antes: se pueden quitar como antes (botón de 44 px y Storage remove)",
	/resource-remove-file shrink-0[^"]*h-11 w-11/.test(cp) && /storage\.from\('recursos'\)\.remove\(\[path\]\)/.test(cp), true);
ok("archivos de antes: se guardan tal cual (proyecto y borrador)",
	/archivos: block\._archivos \|\| \[\],\s*links: block\._links \|\| \[\]/.test(cp) && /_archivos:\s+block\._archivos \|\| \[\],/.test(cp), true);

/*
	Un enlace agregado o quitado en una sesión YA GUARDADA sí se guarda. En 088cd88 no: block._alAbrir
	(R30) guarda los mismos arreglos de recursos que la pantalla, y "Agregar" hacía push (y quitar,
	splice) sobre ese arreglo, así que ProyectoEdicion.cambiosDeSesion no veía el cambio.
*/
ok("Crear proyecto: los arreglos de enlaces y archivos nunca se modifican en su lugar",
	/(linksAgregados|archivosSubidos)\.(push|splice|pop|shift|unshift)\(/.test(cp), false);
ok("Crear proyecto: agregar enlace arma un arreglo nuevo y quitarlo también",
	/linksAgregados = linksAgregados\.concat\(\[\{ titulo: titulo, url: url \}\]\);/.test(cp) && /linksAgregados = linksAgregados\.filter\(function \(_, i\) \{ return i !== index; \}\);/.test(cp), true);
{
	const PE = require("../js/proyecto-edicion.js");
	const fila0 = { recursos: { archivos: [], links: [{ titulo: "", url: "https://ejemplo.com/a" }] } };
	const enPantalla = fila0.recursos.links.slice();
	const alAbrir = { recursos: { archivos: [], links: enPantalla } }; // lo que guarda block._alAbrir: el MISMO arreglo
	const nuevo = enPantalla.concat([{ titulo: "Anexo", url: "https://drive.google.com/file/d/X/view" }]);
	ok("agregar un enlace (arreglo nuevo): cambiosDeSesion lo manda a guardar",
		Object.keys(PE.cambiosDeSesion({ recursos: { archivos: [], links: nuevo } }, fila0, alAbrir)), ["recursos"]);
	const quitado = enPantalla.filter((_, i) => i !== 0);
	ok("quitar un enlace (arreglo nuevo): también se guarda",
		Object.keys(PE.cambiosDeSesion({ recursos: { archivos: [], links: quitado } }, fila0, alAbrir)), ["recursos"]);
	enPantalla.push({ titulo: "", url: "https://ejemplo.com/b" }); // lo que hacía 088cd88
	ok("(así fallaba: con push el cambio no se ve y no se guarda nada)",
		Object.keys(PE.cambiosDeSesion({ recursos: { archivos: [], links: enPantalla } }, fila0, alAbrir)), []);
	ok("sin cambios: nada que guardar", Object.keys(PE.cambiosDeSesion({ recursos: { archivos: [], links: fila0.recursos.links.slice() } }, fila0, { recursos: { archivos: [], links: fila0.recursos.links.slice() } })), []);
}

// ── 2. Ninguna página del SaaS sube archivos ─────────────────────────────────
{
	const subidas = [];
	fs.readdirSync(path.join(RAIZ, "js")).filter((f) => f.endsWith(".js")).forEach((f) => {
		const t = leer("js/" + f);
		const usos = t.match(/storage\s*\.\s*from\([^)]*\)\s*\.\s*(\w+)/g) || [];
		usos.forEach((u) => { if (!/\.remove$/.test(u.replace(/\s/g, ""))) subidas.push(f + ": " + u); });
		if (/type=["']?file/i.test(t)) subidas.push(f + ": input de archivo");
	});
	fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html")).forEach((f) => {
		if (/type=["']?file/i.test(leer(f))) subidas.push(f + ": input de archivo");
	});
	ok("SaaS: ningún js/*.js ni página de la raíz sube archivos (solo queda quitar los de antes)", subidas, []);
}

// ── 3. Visor: solo libros ────────────────────────────────────────────────────
let manejador = null;
global.document = { addEventListener: function (tipo, fn) { if (tipo === "click") manejador = fn; } };
global.window = {};
const V = require("../js/visor-recursos.js");
const u = V.urlEmbebible;
const DRIVE = [
	"https://drive.google.com/file/d/1t7XZhp0TOeHCeHod_wpo1HVAZUVtm2Hu/view?usp=sharing",
	"https://drive.google.com/drive/folders/1Nx6kmHq4J_NmIxmaSbt9riMYiEUaSz-t",
	"https://drive.google.com/drive/u/0/folders/ABC_-1?usp=sharing",
	"https://drive.google.com/open?id=XYZ123",
	"https://drive.google.com/uc?export=download&id=XYZ123",
	"https://docs.google.com/document/d/DOC1/edit",
	"https://docs.google.com/presentation/d/SLIDES1/edit#slide=id.p",
	"https://docs.google.com/spreadsheets/d/HOJA1/edit",
];
ok("Drive (archivo, carpeta, open, uc, Docs, Slides, Hojas): no se abren en el visor; aparte = el mismo enlace",
	DRIVE.map((x) => { const r = u(x); return r.tipo + "/" + r.embebible + "/" + r.src + "/" + (r.aparte === x); }),
	DRIVE.map(() => "otro/false/null/true"));
ok("libro de CONALITEG: se abre en el visor por https y conserva la página", u("http://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100"),
	{ tipo: "libro", src: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", embebible: true, aparte: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100" });
ok("libro con https y dominio sep.gob.mx: visor", [u("https://libros.conaliteg.gob.mx/2025/P2TPA.htm#page/6").embebible, u("https://historico.conaliteg.sep.gob.mx/2019/P1ESA.htm").embebible], [true, true]);
ok("otro sitio: otra pestaña", u("https://ejemplo.com/a.pdf"), { tipo: "otro", src: null, embebible: false, aparte: "https://ejemplo.com/a.pdf" });
ok("un archivo subido antes (enlace firmado de Storage): otra pestaña", u("https://cluvaxxqvhtxxiwctpnl.supabase.co/storage/v1/object/sign/recursos/x.pdf?token=t").embebible, false);
ok("dominio parecido a CONALITEG: no", u("https://conaliteg.gob.mx.evil.com/x").embebible, false);
ok("esquemas raros: ni visor ni pestaña", [u("javascript:alert(1)"), u("data:text/html,x"), u(null)].map((x) => x.embebible + "/" + x.aparte), ["false/null", "false/null", "false/null"]);
ok("abrir() con Drive devuelve false (quien llama lo deja como enlace común)", DRIVE.map((x) => V.abrir({ url: x })), DRIVE.map(() => false));
ok("el visor no se abrió", V.abierto(), false);
// El toque en un enlace de Drive (aunque trajera data-visor-url) no se intercepta: el navegador abre la otra pestaña
function toque(url) {
	let prevenido = false;
	const a = { getAttribute: (n) => (n === "data-visor-url" || n === "href" ? url : null), textContent: "Anexo" };
	manejador({ defaultPrevented: false, button: 0, target: { closest: () => a }, preventDefault: () => { prevenido = true; } });
	return prevenido;
}
ok("el visor registra el toque en los enlaces", typeof manejador, "function");
ok("toque en Drive u otro sitio: no se intercepta (se abre en otra pestaña)", DRIVE.concat(["https://ejemplo.com/a"]).map(toque), DRIVE.concat(["x"]).map(() => false));
const vs = leer("js/visor-recursos.js");
ok("el visor ya no arma direcciones de Drive (/preview, embeddedfolderview) ni marco con sandbox para Drive",
	/embeddedfolderview|\/preview|drive-archivo|esDrive|setAttribute\("sandbox"/.test(vs), false);
ok("pista del visor: «Cerrar» y Esc fuera del libro, sin decir «Hoy» (también está en Inicio)",
	/Para volver usa «Cerrar»\. La tecla Esc solo funciona fuera del libro\./.test(vs) && !/volver a Hoy/.test(vs), true);
delete global.document;

// ── 4. Secuencia de la sesión ────────────────────────────────────────────────
const S = require("../js/secuencia-sesion.js");
const sesion = {
	inicio_todos: "Leemos Múltiples Lenguajes de 1° (p. 100) y comentamos.",
	recursos: {
		links: [
			{ url: "https://drive.google.com/file/d/ANEXO1/view", titulo: "Anexo 1" },
			{ url: "https://drive.google.com/drive/folders/CARPETA1", titulo: "Carpeta de anexos" },
			{ url: "https://docs.google.com/presentation/d/SLIDES1/edit", titulo: "Presentación" },
			{ url: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", nombre: "El origen de las letras — Múltiples Lenguajes 1°, p.100" },
			{ url: "https://ejemplo.com/rubrica", titulo: "Rúbrica" },
		],
		archivos: [{ nombre: "3° 'B' guía.pdf", path: "recursos/u/temp/sesion_1/3-B-guia.pdf", url: "https://x.supabase.co/storage/v1/object/sign/recursos/recursos/u/temp/sesion_1/3-B-guia.pdf?token=t" }],
	},
};
const html = S.html(sesion);
const enlaces = html.match(/<a [^>]*>[^<]*<\/a>/g) || [];
const de = (txt) => enlaces.filter((a) => a.indexOf(">" + txt + "<") !== -1)[0] || "";
ok("secuencia: 7 enlaces (3 de Drive, el libro en «Anexos y libros», la mención en el texto, otro sitio y el archivo de antes)", enlaces.length, 7);
ok("secuencia: todos con target _blank y rel noopener noreferrer", enlaces.every((a) => /target='_blank'/.test(a) && /rel='noopener noreferrer'/.test(a)), true);
ok("secuencia: Drive, carpeta y Slides sin data-visor-url", ["Anexo 1", "Carpeta de anexos", "Presentación"].map((t) => /data-visor-url/.test(de(t))), [false, false, false]);
ok("secuencia: otro sitio y archivo de antes sin data-visor-url", [/data-visor-url/.test(de("Rúbrica")), /data-visor-url/.test(de("3° &#39;B&#39; guía.pdf"))], [false, false]);
ok("secuencia: el libro de «Anexos y libros» abre el visor", /data-secuencia-enlace='libro'[^>]*data-visor-url='https:\/\/libros\.conaliteg\.gob\.mx\/2025\/P1MLA\.htm#page\/100'/.test(html), true);
ok("secuencia: la mención del libro en el texto sigue enlazando al visor", /data-secuencia-libro [^>]*data-visor-url='https:\/\/libros\.conaliteg\.gob\.mx\/2025\/P1MLA\.htm#page\/100'[^>]*>Múltiples Lenguajes de 1° \(p\. 100\)<\/a>/.test(html), true);
ok("secuencia: botones de 44 px", enlaces.filter((a) => /data-secuencia-enlace/.test(a)).every((a) => /min-h-\[44px\]/.test(a)), true);

console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
process.exit(fallos ? 1 : 0);
