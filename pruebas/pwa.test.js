/*
	Mi Salón como app instalable, "Jissez MS" (docs/PWA-MI-SALON.md, fase 1).

	- Manifest (salon.webmanifest): nombres de Jorge, id fijo, alcance /salon/, arranque en
	  /salon/hoy?origen=app, colores de la marca, íconos 192/512 (any) y 512 maskable que
	  existen y miden lo que dicen, atajos dentro del alcance.
	- Service worker (sw.js): caché con versión, página "Sin conexión" guardada, red primero en
	  las navegaciones, no toca otros orígenes (Supabase, CDN).
	- Las páginas de Mi Salón enlazan el manifest y los meta de iPhone con rutas absolutas (valen
	  desde / y desde /salon/) y cargan js/app-instalada.js en el <head>; la tienda no.
	- _redirects: cada página de Mi Salón tiene su regla para no salirse de /salon/.
	- Modo app (js/app-instalada.js): standalone; fullscreen solo en iPhone/iPad; ?origen=app.
	- Dentro de /salon/: la pestaña Tienda va a la tienda de siempre (y en la app, al
	  navegador); el candado y la capa de lectura mandan al login DE LA APP con ?next= a la
	  página; el login sin next lleva a Hoy; la raíz de /salon/ lleva al login de la app.
	  Fuera de /salon/ nada cambia.

	node pruebas/pwa.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8").replace(/^﻿/, "");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

function medidaPNG(ruta) {
	const b = fs.readFileSync(path.join(RAIZ, ruta.replace(/^\//, "")));
	return b.readUInt32BE(16) + "x" + b.readUInt32BE(20);
}

// ── Manifest ─────────────────────────────────────────────────────────────────
const m = JSON.parse(leer("salon.webmanifest"));
ok("manifest: nombres de Jorge", [m.name, m.short_name], ["Jissez Mi Salón", "Jissez MS"]);
ok("manifest: id fijo", m.id, "/mi-salon");
ok("manifest: alcance y arranque", [m.scope, m.start_url], ["/salon/", "/salon/hoy?origen=app"]);
ok("manifest: el arranque está dentro del alcance y sin .html", m.start_url.indexOf(m.scope) === 0 && !/\.html/.test(m.start_url), true);
ok("manifest: standalone, es-MX y colores de la marca", [m.display, m.lang, m.theme_color, m.background_color], ["standalone", "es-MX", "#1e3a8a", "#faf9f4"]);
ok("manifest: no prefiere una app de tienda", m.prefer_related_applications, false);
const iconos = m.icons.map((i) => i.sizes + ":" + i.purpose);
ok("manifest: íconos 192 y 512 'any' y 512 'maskable' (sin combinar)", iconos, ["192x192:any", "512x512:any", "512x512:maskable"]);
ok("manifest: cada ícono existe y mide lo que dice", m.icons.every((i) => medidaPNG(i.src) === i.sizes), true);
ok("apple-touch-icon de 180", medidaPNG("iconos/apple-touch-icon-180.png"), "180x180");
ok("manifest: atajos Pasar lista, Calificar trabajos y Reportes", m.shortcuts.map((s) => s.name), ["Pasar lista", "Calificar trabajos", "Reportes"]);
ok("manifest: los atajos van a Hoy (asistencia), Hoy (sesiones) y Reportes, dentro de /salon/",
	m.shortcuts.map((s) => s.url), ["/salon/hoy?origen=atajo#asistencia", "/salon/hoy?origen=atajo#sesiones", "/salon/reportes?origen=atajo"]);
ok("manifest: íconos de los atajos existen", m.shortcuts.every((s) => s.icons.every((i) => medidaPNG(i.src) === i.sizes)), true);
ok("Hoy tiene las secciones a las que saltan los atajos",
	["asistencia", "tareas", "sesiones", "cierre"].every((id) => new RegExp('<section id="' + id + '"').test(leer("hoy.html"))), true);

// ── Service worker ───────────────────────────────────────────────────────────
const sw = leer("sw.js");
ok("sw: caché con versión y borra las de otra versión", /var VERSION = "salon-/.test(sw) && /caches\.delete\(c\)/.test(sw), true);
ok("sw: guarda la página Sin conexión (sin .html, dentro de /salon/)", /SIN_CONEXION = "\/salon\/sin-conexion"/.test(sw) && fs.existsSync(path.join(RAIZ, "sin-conexion.html")), true);
ok("sw: navegaciones con red primero y, si falla, Sin conexión", /req\.mode === "navigate"[\s\S]*fetch\(req\)[\s\S]*\.catch\([\s\S]*cache\.match\(SIN_CONEXION\)/.test(sw), true);
ok("sw: no toca otros orígenes (Supabase, CDN)", /if \(url\.origin !== self\.location\.origin\) return;/.test(sw), true);
ok("sw: no guarda respuestas que vienen de una redirección", /res\.redirected/.test(sw), true);
ok("sw: no guarda las páginas ni los datos (solo lo de Sin conexión)", (sw.match(/cache\.put\(/g) || []).length, 1);
const sinConexion = leer("sin-conexion.html");
ok("Sin conexión: autónoma (sin scripts ni estilos externos) y con Reintentar",
	!/<script src=|<link rel="stylesheet"/.test(sinConexion) && /Reintentar/.test(sinConexion) && /addEventListener\("online"/.test(sinConexion), true);
ok("Sin conexión: no crea la base de la bandeja si no existe", /onupgradeneeded = function \(\) \{ try \{ req\.transaction\.abort\(\)/.test(sinConexion), true);
ok("Sin conexión: con sesión cuenta solo las capturas de esa cuenta", /it\.maestro_id === yo/.test(sinConexion) && /auth-token/.test(sinConexion), true);
const limite = Number((sw.match(/var LIMITE_NAVEGACION = (\d+);/) || [])[1]);
ok("sw: una navegación que no contesta en 8 a 10 s muestra Sin conexión",
	limite >= 8000 && limite <= 10000 && /conLimite\(precarga\.then[\s\S]*LIMITE_NAVEGACION\)\.catch/.test(sw), true);

// ── Páginas ──────────────────────────────────────────────────────────────────
const NO_SALON = new Set(["index.html", "reset-password.html", "sin-conexion.html"]);
const paginas = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && !NO_SALON.has(f));
const faltan = paginas.filter((f) => {
	const t = leer(f);
	const head = t.split("</head>")[0];
	return !(/<link rel="manifest" href="\/salon\.webmanifest">/.test(head) &&
		/<meta name="theme-color" content="#1e3a8a">/.test(head) &&
		/<link rel="apple-touch-icon" href="\/iconos\/apple-touch-icon-180\.png">/.test(head) &&
		/<meta name="apple-mobile-web-app-capable" content="yes">/.test(head) &&
		/<meta name="apple-mobile-web-app-title" content="Jissez MS">/.test(head) &&
		/<script src="js\/app-instalada\.js"><\/script>/.test(head));
});
ok("las " + paginas.length + " páginas de Mi Salón enlazan manifest, theme-color, meta de iPhone y app-instalada en el <head>", faltan, []);
const tienda = fs.readdirSync(path.join(RAIZ, "tienda")).filter((f) => f.endsWith(".html"));
ok("la tienda no enlaza el manifest de la app", tienda.filter((f) => /salon\.webmanifest/.test(leer("tienda/" + f))), []);
const redirects = leer("_redirects");
const sinRegla = paginas.filter((f) => redirects.indexOf("/salon/" + f + " /salon/" + f.replace(/\.html$/, "") + " 301") === -1);
ok("_redirects: cada página de Mi Salón tiene su regla dentro de /salon/", sinRegla, []);
ok("_redirects: el login de la tienda también", redirects.indexOf("/salon/tienda/login.html /salon/tienda/login 301") !== -1, true);
ok("Hoy carga la bandeja de salida antes que su script",
	leer("hoy.html").indexOf('src="js/bandeja-salida.js"') !== -1 && leer("hoy.html").indexOf('src="js/bandeja-salida.js"') < leer("hoy.html").indexOf('src="js/hoy.js"'), true);
ok("Inicio tiene el lugar del botón Instalar", /id="instalarAppSlot"/.test(leer("dashboard.html")), true);
// Cerrar sesión avisa si hay capturas sin enviar: la bandeja se carga donde hay ese botón
ok("las páginas con Cerrar sesión (barra o Sala de Maestros) cargan la bandeja antes de su script",
	paginas.filter((f) => {
		const t = leer(f);
		const script = t.indexOf('src="js/navbar.js"') !== -1 ? 'src="js/navbar.js"' : t.indexOf('src="js/sala-maestros.js"') !== -1 ? 'src="js/sala-maestros.js"' : null;
		if (!script || f === "hoy.html") return false;
		const i = t.indexOf('src="js/bandeja-salida.js"');
		return i === -1 || i > t.indexOf(script);
	}), []);
ok("Cerrar sesión pide confirmar si hay capturas pendientes (barra y Sala de Maestros)",
	/BandejaSalida\.confirmarSalida\(window\.sb\)/.test(leer("js/navbar.js")) && /BandejaSalida\.confirmarSalida\(window\.sb\)/.test(leer("js/sala-maestros.js")), true);
ok("boleta: el Aviso de privacidad no saca de /salon/ en la misma ventana (en la app, target=_blank)",
	/function enlacePrivacidad\(\)[\s\S]*\/tienda\/privacidad\.html[\s\S]*target='_blank' rel='noopener'/.test(leer("js/reportes.js")) &&
	!/<a href='tienda\/privacidad\.html' class='underline'>/.test(leer("js/reportes.js")), true);
ok("el menú de la cuenta tiene Instalar la app (oculto hasta que se pueda)", /id="navbarInstalarBtn" type="button" class="hidden/.test(leer("js/navbar.js")), true);

// ── Modo app ─────────────────────────────────────────────────────────────────
const A = require("../js/app-instalada.js");
const mm = (activos) => (q) => activos.some((a) => q.indexOf(a) !== -1);
ok("enSalon: solo bajo /salon/", ["/salon/hoy", "/salon/tienda/login", "/hoy", "/hoy.html", "/salonx/hoy", "/"].map(A.enSalon), [true, true, false, false, false, false]);
ok("modo app: standalone", A.modoAppCon({ mm: mm(["standalone"]), ios: false }), true);
ok("modo app: fullscreen en iPhone (así lo reporta iOS)", A.modoAppCon({ mm: mm(["fullscreen"]), ios: true }), true);
ok("modo app: fullscreen en PC (F11) NO es la app", A.modoAppCon({ mm: mm(["fullscreen"]), ios: false }), false);
ok("modo app: navigator.standalone en iPhone", A.modoAppCon({ mm: mm([]), ios: true, nav: { standalone: true } }), true);
ok("modo app: arranque ?origen=app y atajos ?origen=atajo", [A.modoAppCon({ search: "?origen=app" }), A.modoAppCon({ search: "?x=1&origen=atajo" }), A.modoAppCon({ search: "?origen=apple" })], [true, true, false]);
ok("modo app: navegador normal", A.modoAppCon({ mm: mm([]), ios: false, search: "" }), false);
ok("iPadOS se reconoce aunque diga Mac", [A.esIOS({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), A.esIOS({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 })], [true, false]);
ok("página a la que regresa el login", [A.paginaActual("/salon/reportes", "?x=1", "#a"), A.paginaActual("/salon/", "", ""), A.paginaActual("/salon/hoy.html", "", "")], ["reportes.html?x=1#a", "hoy.html", "hoy.html"]);

// ── Secciones, login y portal dentro de /salon/ ──────────────────────────────
const S = require("../js/secciones.js");
ok("Tienda bajo /salon/: a la tienda de siempre; en la app, en el navegador",
	[S.destinoPestana("tienda", "https://jissez.com/salon/", false), S.destinoPestana("tienda", "https://jissez.com/salon/", true)],
	[{ href: "https://jissez.com/tienda/index.html", fuera: false }, { href: "https://jissez.com/tienda/index.html", fuera: true }]);
ok("Mi Salón y Sala se quedan en /salon/", [S.destinoPestana("salon", "https://jissez.com/salon/", true), S.destinoPestana("sala", "https://jissez.com/salon/", true)],
	[{ href: "https://jissez.com/salon/dashboard.html", fuera: false }, { href: "https://jissez.com/salon/sala-maestros.html", fuera: false }]);
ok("fuera de /salon/ la pestaña Tienda no cambia", S.destinoPestana("tienda", "https://jissez.com/", true), { href: "https://jissez.com/tienda/index.html", fuera: false });
const L = require("../tienda/js/login.js");
ok("login: reconoce /salon/", [L.enSalon("/salon/tienda/login"), L.enSalon("/tienda/login")], [true, false]);
ok("login en la app sin next: Hoy (sin grupo, el alta)", [L.destinoSalon("dashboard.html"), L.destinoSalon("onboarding.html")], ["hoy.html", "onboarding.html"]);
ok("login: el next de la app es aceptado", [L.nextSeguro("../hoy.html"), L.nextSeguro("../reportes.html?x=1#a")], ["../hoy.html", "../reportes.html?x=1#a"]);
global.Secciones = S; // js/portal.js lo usa como global, igual que en el navegador
const P = require("../js/portal.js");
ok("portal bajo /salon/ con última Tienda → panel (la tienda no es parte de la app)", [P.destino("tienda", true), P.destino("tienda", false)], ["dashboard.html", "tienda/index.html"]);

// ── Sin sesión: candado y capa de lectura ────────────────────────────────────
function pagina(pathname, search) {
	const hacia = [];
	const documento = {
		body: { children: [], appendChild() {} }, documentElement: { style: { visibility: "" } },
		createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
		getElementById: () => null, addEventListener() {},
	};
	const ventana = {
		sb: {
			auth: { getUser: () => Promise.resolve({ data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 } }), getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
			from: () => ({}), rpc: () => ({}),
		},
		location: { pathname: pathname, search: search || "", hash: "", href: pathname, replace(u) { hacia.push(u); } },
		addEventListener() {},
		localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		sessionStorage: { getItem: () => null, setItem() {} },
	};
	ventana.window = ventana;
	const ctx = { window: ventana, document: documento, console: { error() {}, warn() {}, log() {} }, Promise, setTimeout, Proxy, Error, Object, String, Array, encodeURIComponent };
	vm.createContext(ctx);
	["lectura.js", "saas-guard.js"].forEach((n) => vm.runInContext(leer("js/" + n), ctx, { filename: n }));
	return { hacia, ventana };
}

(async function () {
	const enApp = pagina("/salon/reportes", "?origen=atajo");
	await espera(30);
	ok("sin sesión bajo /salon/: al login de la app, con regreso a la página",
		enApp.hacia[0], "tienda/login.html?next=" + encodeURIComponent("../reportes.html?origen=atajo"));
	ok("…y nadie lo manda a otro lado después", enApp.hacia.every((u) => u === enApp.hacia[0]), true);
	// Una página que pregunta la sesión por su cuenta (y mandaría a "index.html") no sigue
	let siguio = false;
	enApp.ventana.sb.auth.getSession().then(() => { siguio = true; });
	await espera(20);
	ok("…la página que pregunta la sesión no sigue (no manda a index.html fuera de la app)", siguio, false);
	const raiz = pagina("/hoy.html", "");
	await espera(30);
	ok("sin sesión en la raíz: como siempre, al login de la tienda sin next", raiz.hacia[0], "tienda/login.html");
	let siguioRaiz = false;
	raiz.ventana.sb.auth.getSession().then(() => { siguioRaiz = true; });
	await espera(20);
	ok("…y en la raíz la página sigue decidiendo como antes", siguioRaiz, true);

	// La raíz de /salon/ (a donde mandan las páginas sin sesión) lleva al login de la app
	const script = leer("index.html").match(/<script>([\s\S]*?)<\/script>/)[1];
	function correrRaiz(pathname) {
		const hacia = [];
		const ctx = {
			window: { location: { pathname, hash: "", search: "", replace: (u) => hacia.push(u) }, localStorage: { getItem: () => null } },
			document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
			setTimeout: () => 0, encodeURIComponent,
		};
		vm.createContext(ctx);
		vm.runInContext(script, ctx);
		return hacia[0];
	}
	ok("/salon/ sin sesión → login de la app que vuelve a Hoy", correrRaiz("/salon/"), "tienda/login.html?next=" + encodeURIComponent("../hoy.html"));
	ok("/ (la raíz de siempre) → la tienda, como antes", correrRaiz("/"), "tienda/index.html");

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
