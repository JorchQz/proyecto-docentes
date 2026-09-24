/*
	Pantalla principal de tres partes (decisión 12 de Jorge, 2026-09-24).

	- Login de la tienda (tienda/js/login.js): con ?next= válido se respeta (checkout);
	  sin él, las cuentas con el SaaS van a ../portal.html y el resto al catálogo. Una
	  lectura de perfiles fallida cuenta como sin acceso (como antes).
	- nextSeguro sigue rechazando esquemas, //host y backslashes.
	- Portal (js/portal.js): Mi Salón lleva al panel con grupo, al alta sin grupo, y al
	  panel si la lectura falla (el panel decide).
	- Tienda (tienda/js/tienda-common.js): el enlace de regreso solo se ofrece con
	  activo_saas = true; una lectura fallida no se recuerda.
	- portal.html: candado antes del script propio y sin Pixel de Meta.

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
ok("con SaaS → portal", L.porPerfil({ data: { activo_saas: true }, error: null }), "../portal.html");
ok("sin SaaS → catálogo", L.porPerfil({ data: { activo_saas: false }, error: null }), "catalogo.html");
ok("sin fila de perfil → catálogo", L.porPerfil({ data: null, error: null }), "catalogo.html");
ok("lectura fallida → catálogo", L.porPerfil({ data: null, error: { message: "x" } }), "catalogo.html");
ok("activo_saas no booleano no abre el portal", L.porPerfil({ data: { activo_saas: "true" }, error: null }), "catalogo.html");

ok("next del checkout se respeta", L.nextSeguro("checkout.html?item=3"), "checkout.html?item=3");
ok("next relativo con ..", L.nextSeguro("../dashboard.html"), "../dashboard.html");
ok("next al portal es válido", L.nextSeguro("../portal.html"), "../portal.html");
ok("next javascript: rechazado", L.nextSeguro("javascript:alert(1)"), null);
ok("next https: rechazado", L.nextSeguro("https://malo.com/x.html"), null);
ok("next //host rechazado", L.nextSeguro("//malo.com/x.html"), null);
ok("next con backslash rechazado", L.nextSeguro("\\\\malo.com\\x.html"), null);
ok("next sin .html rechazado", L.nextSeguro("catalogo"), null);
ok("next vacío", L.nextSeguro(""), null);

// ── Portal ───────────────────────────────────────────────────────────────────
const P = require("../js/portal.js");
ok("con grupo → panel", P.destinoMiSalon({ data: [{ id: "g" }], error: null }), { href: "dashboard.html", sinGrupo: false });
ok("sin grupo → alta", P.destinoMiSalon({ data: [], error: null }), { href: "onboarding.html", sinGrupo: true });
ok("lectura fallida → panel, sin afirmar que no hay grupo", P.destinoMiSalon({ data: null, error: { message: "x" } }), { href: "dashboard.html", sinGrupo: false });
ok("sin respuesta → panel", P.destinoMiSalon(null), { href: "dashboard.html", sinGrupo: false });
ok("saludo mañana", P.saludoPorHora(8), "Buenos días");
ok("saludo tarde", P.saludoPorHora(15), "Buenas tardes");
ok("saludo noche", P.saludoPorHora(21), "Buenas noches");

// ── Tienda: ¿se ofrece el enlace de regreso? ─────────────────────────────────
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
	ok("tienda: con SaaS se ofrece", await t.T.tieneSaas(sesion), true);
	ok("tienda: la segunda página no vuelve a leer", [await t.T.tieneSaas(sesion), t.lecturas()], [true, 1]);

	t = cargarTienda({ data: { activo_saas: false }, error: null });
	ok("tienda: comprador sin SaaS no ve el enlace", await t.T.tieneSaas(sesion), false);

	t = cargarTienda({ data: null, error: { message: "caída" } });
	ok("tienda: lectura fallida → sin enlace", await t.T.tieneSaas(sesion), false);
	ok("tienda: lectura fallida no se recuerda", Object.keys(t.almacen).length, 0);

	t = cargarTienda({ data: { activo_saas: true }, error: null });
	ok("tienda: sin sesión no se lee nada", [await t.T.tieneSaas(null), t.lecturas()], [false, 0]);

	// ── portal.html ─────────────────────────────────────────────────────────
	const html = fs.readFileSync(path.join(__dirname, "..", "portal.html"), "utf8");
	const orden = ["js/supabase.js", "js/saas-guard.js", "js/section-shell.js", "js/portal.js"].map((s) => html.indexOf('src="' + s + '"'));
	ok("portal.html: scripts en orden (candado antes del script propio)", orden.every((v, i) => v > 0 && (i === 0 || v > orden[i - 1])), true);
	ok("portal.html: sin Pixel de Meta", /fbq|facebook/i.test(html), false);
	ok("portal.html: Sala de Maestros sin enlace", /<a[^>]*id="cardSala"/.test(html), false);
	ok("portal.html: Sala de Maestros dice Próximamente", /Próximamente/.test(html), true);

	// El login ya no lleva directo al panel
	const login = fs.readFileSync(path.join(__dirname, "..", "tienda", "js", "login.js"), "utf8");
	ok("login: sin destino directo al panel", /"\.\.\/dashboard\.html"\s*:/.test(login), false);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
