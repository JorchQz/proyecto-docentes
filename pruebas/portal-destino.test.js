/*
	Llegada a Jissez con el selector de secciones (decisión de Jorge, 2026-09-25; antes, la
	pantalla principal de tres partes de la decisión 12).

	- Login de la tienda (tienda/js/login.js): con ?next= válido se respeta (checkout);
	  sin él, las cuentas con el SaaS van a su última sección (Mi Salón → panel o alta,
	  Tienda → portada, Sala → su página) y el resto al catálogo. Una lectura de perfiles
	  fallida cuenta como sin acceso (como antes).
	- nextSeguro sigue rechazando esquemas, //host y backslashes.
	- portal.html ya no es pantalla: redirige (js/portal.js) a la última sección después
	  del candado.
	- Tienda (tienda/js/tienda-common.js): el selector solo se ofrece con activo_saas =
	  true; una lectura fallida no se recuerda.
	- La lógica de las secciones (última sección, destinos, raíz) se prueba en
	  pruebas/secciones.test.js.

	node pruebas/portal-destino.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── Login ────────────────────────────────────────────────────────────────────
const L = require("../tienda/js/login.js");
const S = require("../js/secciones.js");
global.Secciones = S; // js/portal.js lo usa como global, igual que en el navegador
const conSaas = { data: { activo_saas: true }, error: null };
const conGrupo = { data: [{ id: "g" }], error: null };
const sinGrupo = { data: [], error: null };
ok("con SaaS, primera vez con grupo → panel", L.porPerfil(conSaas, S.destinoLogin(null, conGrupo)), "../dashboard.html");
ok("con SaaS, primera vez sin grupo → alta", L.porPerfil(conSaas, S.destinoLogin(null, sinGrupo)), "../onboarding.html");
ok("con SaaS, última Mi Salón, grupos fallidos → panel", L.porPerfil(conSaas, S.destinoLogin("salon", { data: null, error: { message: "x" } })), "../dashboard.html");
ok("con SaaS, última Tienda → portada de la tienda", L.porPerfil(conSaas, S.destinoLogin("tienda", null)), "index.html");
ok("con SaaS, última Sala → Sala de Maestros", L.porPerfil(conSaas, S.destinoLogin("sala", null)), "../sala-maestros.html");
ok("con SaaS sin destino (no cargó el selector) → panel", L.porPerfil(conSaas), "../dashboard.html");
ok("sin SaaS → catálogo", L.porPerfil({ data: { activo_saas: false }, error: null }), "catalogo.html");
ok("sin SaaS no importa la última sección → catálogo", L.porPerfil({ data: { activo_saas: false }, error: null }, "sala-maestros.html"), "catalogo.html");
ok("sin fila de perfil → catálogo", L.porPerfil({ data: null, error: null }), "catalogo.html");
ok("lectura fallida → catálogo", L.porPerfil({ data: null, error: { message: "x" } }, "dashboard.html"), "catalogo.html");
ok("activo_saas no booleano no abre Mi Salón", L.porPerfil({ data: { activo_saas: "true" }, error: null }), "catalogo.html");
ok("tieneSaas: solo con true", [L.tieneSaas(conSaas), L.tieneSaas({ data: { activo_saas: 1 }, error: null }), L.tieneSaas(null)], [true, false, false]);
ok("desdeTienda: raíz → ../", L.desdeTienda("dashboard.html"), "../dashboard.html");
ok("desdeTienda: tienda/ → relativa", L.desdeTienda("tienda/index.html"), "index.html");

ok("next del checkout se respeta", L.nextSeguro("checkout.html?item=3"), "checkout.html?item=3");
ok("next relativo con ..", L.nextSeguro("../dashboard.html"), "../dashboard.html");
ok("next al portal es válido (redirige)", L.nextSeguro("../portal.html"), "../portal.html");
ok("next a Sala de Maestros es válido", L.nextSeguro("../sala-maestros.html"), "../sala-maestros.html");
ok("next javascript: rechazado", L.nextSeguro("javascript:alert(1)"), null);
ok("next https: rechazado", L.nextSeguro("https://malo.com/x.html"), null);
ok("next //host rechazado", L.nextSeguro("//malo.com/x.html"), null);
ok("next con backslash rechazado", L.nextSeguro("\\\\malo.com\\x.html"), null);
ok("next sin .html rechazado", L.nextSeguro("catalogo"), null);
ok("next vacío", L.nextSeguro(""), null);

// ── Portal (solo redirección) ────────────────────────────────────────────────
const P = require("../js/portal.js");
ok("portal: primera vez → Mi Salón", P.destino(null), "dashboard.html");
ok("portal: última Mi Salón → panel", P.destino("salon"), "dashboard.html");
ok("portal: última Tienda → portada (no el catálogo)", P.destino("tienda"), "tienda/index.html");
ok("portal: última Sala → Sala de Maestros", P.destino("sala"), "sala-maestros.html");
ok("portal: valor raro → Mi Salón", P.destino("admin"), "dashboard.html");

// ── Tienda: ¿se ofrece el selector? ──────────────────────────────────────────
function cargarTienda(respuesta) {
	const almacen = {};
	let lecturas = 0;
	const sb = {
		from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { lecturas++; return respuesta; } }) }) }),
	};
	const ctx = {
		window: { sb: sb, matchMedia: () => ({ matches: false }) },
		sessionStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); } },
		console: console,
	};
	ctx.window.window = ctx.window;
	vm.createContext(ctx);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "tienda", "js", "tienda-common.js"), "utf8"), ctx);
	return { T: ctx.window.Tienda, lecturas: () => lecturas, almacen: almacen };
}
const sesion = { user: { id: "u1", email: "maestra@correo.com" } };

(async () => {
	let t = cargarTienda({ data: { activo_saas: true }, error: null });
	ok("tienda: con SaaS se ofrece el selector", await t.T.tieneSaas(sesion), true);
	ok("tienda: la segunda página no vuelve a leer", [await t.T.tieneSaas(sesion), t.lecturas()], [true, 1]);

	t = cargarTienda({ data: { activo_saas: false }, error: null });
	ok("tienda: comprador sin SaaS no ve el selector", await t.T.tieneSaas(sesion), false);

	t = cargarTienda({ data: null, error: { message: "caída" } });
	ok("tienda: lectura fallida → sin selector", await t.T.tieneSaas(sesion), false);
	ok("tienda: lectura fallida no se recuerda", Object.keys(t.almacen).length, 0);

	t = cargarTienda({ data: { activo_saas: true }, error: null });
	ok("tienda: sin sesión no se lee nada", [await t.T.tieneSaas(null), t.lecturas()], [false, 0]);

	// ── portal.html ─────────────────────────────────────────────────────────
	const html = fs.readFileSync(path.join(__dirname, "..", "portal.html"), "utf8");
	const orden = ["js/supabase.js", "js/saas-guard.js", "js/secciones.js", "js/portal.js"].map((s) => html.indexOf('src="' + s + '"'));
	ok("portal.html: scripts en orden (candado y selector antes del script propio)", orden.every((v, i) => v > 0 && (i === 0 || v > orden[i - 1])), true);
	ok("portal.html: sin Pixel de Meta", /fbq|facebook/i.test(html), false);
	ok("portal.html: ya no es pantalla (sin tarjetas)", /id="card(MiSalon|Tienda|Sala)"/.test(html), false);
	const portalJs = fs.readFileSync(path.join(__dirname, "..", "js", "portal.js"), "utf8");
	ok("portal.js: redirige solo después del candado", /saasAcceso\.then\([\s\S]*location\.replace/.test(portalJs), true);

	// Nada lleva ya a la pantalla principal
	const login = fs.readFileSync(path.join(__dirname, "..", "tienda", "js", "login.js"), "utf8");
	const comun = fs.readFileSync(path.join(__dirname, "..", "tienda", "js", "tienda-common.js"), "utf8");
	const navbar = fs.readFileSync(path.join(__dirname, "..", "js", "navbar.js"), "utf8");
	ok("login: no manda al portal", /portal\.html/.test(login), false);
	ok("tienda: sin enlace al portal", /portal\.html/.test(comun), false);
	ok("Mi Salón: sin botón Pantalla principal", /portal\.html|Pantalla principal/.test(navbar), false);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
