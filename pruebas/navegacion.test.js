/*
	Navegación de Mi Salón y Sala de Maestros (js/navbar.js; decisión de Jorge, 2026-09-25).

	- Punto de corte: 1024 px (barra lateral desde ahí; encabezado y barra de abajo antes). La
	  Galaxy Tab S9 FE+ mide 1280×800 en horizontal (barra lateral) y 800×1280 en vertical.
	- Barra contraída: se recuerda en el aparato (localStorage, dentro de try/catch) y se aplica
	  desde el <head>, antes del primer pintado.
	- Accesos rápidos: Hoy, Asistencia, Reportes y Más en Mi Salón (con la activa marcada); en
	  Sala, solo Más.
	- Enlaces: relativos, así bajo /salon/ (la app instalable) nada se sale de /salon/; la Tienda
	  sale y, dentro de la app, se abre en el navegador (js/secciones.js).
	- Selector de secciones: no viene en la barra; se pinta solo cuando el candado confirmó el
	  acceso (window.saasAcceso).

	node pruebas/navegacion.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const N = require("../js/navbar.js");
const S = require("../js/secciones.js");
const fuente = leer("js/navbar.js");

// ── Punto de corte ───────────────────────────────────────────────────────────
ok("corte en 1024 px", N.CORTE, 1024);
ok("tablet horizontal (1280) y PC (1440, 1024) → barra lateral; tablet vertical (800), 1023 y celular → encabezado",
	[1440, 1280, 1024, 1023, 800, 390, 360].map(N.esLateral), [true, true, true, false, false, false, false]);
ok("la hoja usa el mismo corte (1024 y 1023.98), sin el viejo de 768",
	/min-width:1024px/.test(N.CSS) && /max-width:1023\.98px/.test(N.CSS) && !/768px/.test(N.CSS), true);
ok("en PC la página se corre lo que mide la barra (border-left del body, sin tocar su padding)", /html\.jz-nav body\{border-left:var\(--jz-lat\) solid transparent\}/.test(N.CSS), true);
ok("anchos: 256 expandida, 72 contraída", [N.ANCHO, N.ANCHO_CONTRAIDA], [256, 72]);
ok("lo fijo de la página empieza después de la barra", /\.fixed\.left-0\{left:var\(--jz-lat\)\}/.test(N.CSS) && /\.fixed\.left-1\\\\\/2\{left:calc\(50% \+ var\(--jz-lat\) \/ 2\)\}/.test(fuente), true);

// ── Barra contraída recordada ────────────────────────────────────────────────
function almacen(inicial) {
	const d = Object.assign({}, inicial);
	return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } };
}
const rompe = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
ok("clave", N.CLAVE_CONTRAIDA, "jissez.navContraida");
ok("sin nada guardado: expandida", N.leerContraida(almacen()), false);
let a = almacen();
N.guardarContraida(true, a);
ok("guardar contraída", [a.d["jissez.navContraida"], N.leerContraida(a)], ["1", true]);
N.guardarContraida(false, a);
ok("guardar expandida", [a.d["jissez.navContraida"], N.leerContraida(a)], ["0", false]);
let trono = false;
try { N.guardarContraida(true, rompe); ok("almacenamiento bloqueado: leer no truena", N.leerContraida(rompe), false); } catch (_) { trono = true; }
ok("almacenamiento bloqueado: guardar no truena", trono, false);

// reservar(): lo que hace desde el <head>
function docFalso() {
	const clases = new Set();
	const head = { hijos: [], appendChild(el) { this.hijos.push(el); } };
	const porId = {};
	return {
		clases, head,
		documentElement: { classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } },
		getElementById: (id) => porId[id] || null,
		createElement: () => ({ set id(v) { porId[v] = this; this._id = v; }, get id() { return this._id; } }),
	};
}
let d = docFalso();
N.reservar(d, almacen({ "jissez.navContraida": "1" }));
N.reservar(d, almacen({ "jissez.navContraida": "1" }));
ok("reservar: html.jz-nav y la contraída recordada, con una sola hoja de estilos",
	[d.clases.has("jz-nav"), d.clases.has("jz-nav-contraida"), d.head.hijos.length, d.head.hijos[0].id], [true, true, 1, "jz-nav-css"]);
d = docFalso();
N.reservar(d, almacen());
ok("reservar: sin preferencia, expandida", [d.clases.has("jz-nav"), d.clases.has("jz-nav-contraida")], [true, false]);
d = docFalso();
N.reservar(d, rompe);
ok("reservar: con el almacenamiento bloqueado no truena y queda expandida", [d.clases.has("jz-nav"), d.clases.has("jz-nav-contraida")], [true, false]);
ok("la barra se carga en el <head> de todas sus páginas (reserva antes del primer pintado)",
	fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && /src="js\/navbar\.js"/.test(leer(f)))
		.filter((f) => leer(f).indexOf('src="js/navbar.js"') > leer(f).indexOf("</head>")), []);
ok("el botón de contraer dice su estado (aria-expanded y aria-label)",
	/setAttribute\("aria-expanded", si \? "false" : "true"\)/.test(fuente) && /si \? "Expandir el menú" : "Contraer el menú"/.test(fuente), true);
ok("contraída: el texto queda para el lector de pantalla y cada ícono lleva tooltip (data-tip)",
	/html\.jz-nav-contraida \.jz-txt[^{]*\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/.test(N.CSS) &&
	(N.construir("salon", "hoy").match(/class="jz-item"[^>]*data-tip="/g) || []).length >= 12, true);

// ── Accesos rápidos ──────────────────────────────────────────────────────────
const claves = (l) => l.map((x) => x.clave + (x.activo ? "*" : ""));
ok("Mi Salón: Hoy, Asistencia, Reportes y Más", claves(N.accesosDe("salon", "dashboard")), ["hoy", "asistencia", "reportes", "mas"]);
ok("en Hoy se marca Hoy", claves(N.accesosDe("salon", "hoy")), ["hoy*", "asistencia", "reportes", "mas"]);
ok("en Asistencia se marca Asistencia", claves(N.accesosDe("salon", "asistencia")), ["hoy", "asistencia*", "reportes", "mas"]);
ok("en la boleta, el reporte, la junta y exportar se marca Reportes",
	["boleta", "reporte-alumno", "junta", "exportar"].map((p) => claves(N.accesosDe("salon", p))[2]), ["reportes*", "reportes*", "reportes*", "reportes*"]);
ok("Sala: solo Más (un solo destino)", claves(N.accesosDe("sala", "sala-maestros")), ["mas"]);
const htmlSalon = N.construir("salon", "hoy");
ok("barra de abajo: Más abre el panel (aria-controls, aria-expanded)", /id="jzNavMas" class="jz-abajo-op" aria-controls="jzNavPanel" aria-expanded="false"/.test(htmlSalon), true);
ok("barra de abajo: la activa con aria-current", /<a class="jz-abajo-op" href="hoy\.html" aria-current="page">/.test(htmlSalon), true);
ok("barra de abajo: 60 px más el área segura del iPhone", N.ALTO_ABAJO >= 44 && /--jz-abajo:calc\(60px \+ env\(safe-area-inset-bottom,0px\)\)/.test(N.CSS), true);
ok("barra de abajo: espacio al final y lo fijo abajo sube (avisos de Hoy, pies de página)",
	/html\.jz-nav body::after\{content:'';display:block;height:var\(--jz-abajo\)\}/.test(N.CSS) && /html\.jz-nav \.fixed\[class\*='bottom-'\][^{]*\{margin-bottom:var\(--jz-abajo\)\}/.test(N.CSS), true);

// ── Menú y títulos ───────────────────────────────────────────────────────────
ok("página actual", ["/salon/hoy", "/hoy.html", "/x/reportes", "/", "/salon/"].map(N.paginaDe), ["hoy", "hoy", "reportes", "dashboard", "dashboard"]);
ok("marcado en el menú (las páginas hijas marcan a su sección)",
	["hoy", "crear_proyecto", "boleta", "mi-cuenta", "evaluacion_formativa", "sala-maestros"].map((p) => N.activoDe(p === "sala-maestros" ? "sala" : "salon", p)),
	["hoy", "planeacion", "reportes", "mi-cuenta", null, "sala-maestros"]);
ok("los mismos destinos de antes (barra y menú) más Incidencias y Calendario (2026-09-25) y Listas (2026-09-26), sin quitar ninguno",
	(htmlSalon.match(/href="[a-z_\-]+\.html"/g) || []).map((h) => h.slice(6, -1)).filter((v, i, t) => t.indexOf(v) === i).sort(),
	["actividades.html", "ajustes.html", "asistencia.html", "calendario.html", "dashboard.html", "evaluacion_diagnostica.html", "examen.html",
		"hoy.html", "incidencias.html", "listas.html", "marketplace.html", "mi-cuenta.html", "mi-grupo.html", "planeacion.html", "reportes.html", "tareas.html"]);
ok("Incidencias va en el grupo «Grupo», después de Mi grupo, con su título y marcada en su página",
	[/<p class="jz-titulo" id="jzMenuG3">Grupo<\/p><ul[^>]*><li><a class="jz-item" href="mi-grupo\.html"[\s\S]*?<\/li><li><a class="jz-item" href="incidencias\.html"[\s\S]*?<\/li><li><a class="jz-item" href="calendario\.html"/.test(htmlSalon),
		N.tituloDe("salon", "incidencias"), N.activoDe("salon", "incidencias")],
	[true, "Incidencias", "incidencias"]);
ok("Calendario va en el grupo «Grupo», después de Incidencias, con su título y marcado en su página",
	[N.tituloDe("salon", "calendario"), N.activoDe("salon", "calendario")],
	["Calendario", "calendario"]);
ok("Listas va en el grupo «Grupo», después de Calendario (último del grupo), con su título, su ícono y marcada en su página",
	[/<li><a class="jz-item" href="calendario\.html"[\s\S]*?<\/li><li><a class="jz-item" href="listas\.html"[\s\S]*?<\/li><\/ul>/.test(htmlSalon),
		N.tituloDe("salon", "listas"), N.activoDe("salon", "listas"), /<a class="jz-item" href="listas\.html"[^>]*>[\s\S]*?M13 18h8/.test(htmlSalon)],
	[true, "Listas", "listas", true]);
ok("títulos del encabezado", ["hoy", "boleta", "reporte-alumno", "sala-maestros", "otra"].map((p) => N.tituloDe(p === "sala-maestros" ? "sala" : "salon", p)),
	["Hoy", "Boleta", "Reporte del alumno", "Sala de Maestros", "Mi Salón"]);
ok("cuenta: Mi cuenta, Ajustes, Instalar (oculto hasta que se pueda) y Cerrar sesión, en ese orden",
	/href="mi-cuenta\.html"[\s\S]*href="ajustes\.html"[\s\S]*id="navbarInstalarBtn" type="button" class="hidden[\s\S]*id="navbarLogoutBtn"/.test(htmlSalon), true);
ok("orden de la barra: marca, secciones, grupo, menú y cuenta",
	["jz-marca", 'id="jzNavSecciones"', 'data-grupo-slot="lateral"', 'class="jz-menu"', 'class="jz-cuenta"'].map((s) => htmlSalon.indexOf(s)).every((v, i, t) => v > 0 && (i === 0 || v > t[i - 1])), true);
ok("Sala: sin grupo (no trabaja con grupos)", /data-grupo-slot/.test(N.construir("sala", "sala-maestros")), false);
ok("encabezado: menú, título y grupo", /<header class="jz-cabeza"><button type="button" id="navbarMenuBtn"[^>]*aria-expanded="false"[^>]*>[\s\S]*jz-cabeza-titulo">Hoy<[\s\S]*data-grupo-slot="cabeza"/.test(htmlSalon), true);

// ── Enlaces bajo /salon/ ─────────────────────────────────────────────────────
const hrefs = [];
htmlSalon.replace(/href="([^"]+)"/g, (_, h) => hrefs.push(h));
N.construir("sala", "sala-maestros").replace(/href="([^"]+)"/g, (_, h) => hrefs.push(h));
ok("enlaces relativos (sin / al inicio, sin http, sin ../)", hrefs.filter((h) => /^(\/|https?:|\.\.)/.test(h)), []);
ok("resueltos desde /salon/hoy, todos se quedan en /salon/",
	hrefs.map((h) => new URL(h, "https://jissez.com/salon/hoy").pathname).filter((p) => !p.startsWith("/salon/")), []);
ok("la marca y las imágenes también resuelven bajo /salon/ (la app sirve los mismos archivos)",
	/src="tienda\/assets\/jissez-wordmark-white\.png"/.test(htmlSalon), true);
ok("Tienda desde /salon/: sale de la app y, en la app instalada, se abre en el navegador",
	S.destinoPestana("tienda", "https://jissez.com/salon/", true), { href: "https://jissez.com/tienda/index.html", fuera: true });
ok("Mi Salón y Sala desde /salon/ se quedan en /salon/",
	["salon", "sala"].map((c) => S.destinoPestana(c, "https://jissez.com/salon/", true)),
	[{ href: "https://jissez.com/salon/dashboard.html", fuera: false }, { href: "https://jissez.com/salon/sala-maestros.html", fuera: false }]);

// ── Selector de secciones solo con acceso ────────────────────────────────────
ok("la barra no trae el selector de secciones: solo su lugar apartado",
	/<div id="jzNavSecciones" class="jz-secciones-slot"><\/div>/.test(htmlSalon) && !/Secciones de Jissez|jz-sel-op/.test(htmlSalon), true);
ok("el selector se pinta solo dentro de saasAcceso.then (y solo si existe el candado)",
	/if \(window\.saasAcceso && window\.Secciones\) \{\s*window\.saasAcceso\.then\(function \(\) \{[\s\S]{0,300}selectorNav\(SECCION\)/.test(fuente) &&
	(fuente.match(/selectorNav\(/g) || []).length === 1, true); // y en ningún otro lugar
const sel = S.selectorNav("salon");
ok("selectorNav: tres secciones, la actual marcada, con nombre accesible",
	[(sel.match(/class="jz-sel-op"/g) || []).length, (sel.match(/aria-current="true"/g) || []).length, /aria-label="Mi Salón"[^>]*aria-current="true"/.test(sel), /aria-label="Sala de Maestros"/.test(sel), /aria-label="Secciones de Jissez"/.test(sel)],
	[3, 1, true, true, true]);
ok("selectorNav: sección inválida → Mi Salón", /aria-label="Mi Salón"[^>]*aria-current="true"/.test(S.selectorNav("x")), true);
ok("las páginas con la barra cargan el candado (que decide el acceso) antes del selector",
	fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && /src="js\/navbar\.js"/.test(leer(f)))
		.filter((f) => { const h = leer(f); const g = h.indexOf('src="js/saas-guard.js"'), s = h.indexOf('src="js/secciones.js"'); return !(g !== -1 && s !== -1 && g < s); }), []);

// ── Panel, impresión y lectura ───────────────────────────────────────────────
ok("panel: diálogo modal al abrir, Esc cierra, Tab no sale, fondo sin scroll",
	/setAttribute\("role", "dialog"\)/.test(fuente) && /setAttribute\("aria-modal", "true"\)/.test(fuente) && /e\.key === "Escape"/.test(fuente) &&
	/e\.key === "Tab" && abierto/.test(fuente) && /html\.jz-nav-abierto,html\.jz-nav-abierto body\{overflow:hidden!important\}/.test(N.CSS), true);
ok("no se imprime nada de la navegación y la página vuelve a su ancho",
	/@media print\{\.jz-nav-raiz,#app-navbar\{display:none!important\}html\.jz-nav body\{border-left:0!important\}html\.jz-nav body::after\{display:none!important\}\}/.test(N.CSS), true);
ok("todo va dentro de #app-navbar (el aviso de js/lectura.js lo deja a la vista)", /^<div id="app-navbar"[\s\S]*<\/div>$/.test(htmlSalon) && (htmlSalon.match(/id="app-navbar"/g) || []).length === 1, true);
ok("zonas táctiles de 44 px (menú, encabezado, botones de la barra)",
	/\.jz-item\{[^}]*min-height:44px/.test(N.CSS) && /\.jz-cabeza-btn\{[^}]*width:44px;height:44px/.test(N.CSS) && /\.jz-lat-btn\{[^}]*width:44px;height:44px/.test(N.CSS) &&
	/\.jz-grupo-select,\.jz-grupo-nombre\{[^}]*min-height:44px/.test(N.CSS) && /\.jz-sel-op\{[^}]*min-height:52px/.test(N.CSS), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
