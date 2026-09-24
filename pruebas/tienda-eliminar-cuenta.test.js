/*
	"Eliminar mi cuenta" en la tienda (tienda/js/eliminar-cuenta.js, al final de Mis compras).

	- Confirmación: la palabra ELIMINAR exacta, como en Ajustes del SaaS (solo se perdonan
	  espacios al inicio y al final).
	- Éxito: llama a rpc("delete_own_account"), cierra la sesión solo en este navegador
	  (scope local: la cuenta y sus sesiones ya no existen) y deja la marca que lee la portada.
	- Cuenta con compras: el mensaje de la base se muestra tal cual, escapado, con el correo
	  de soporte como enlace mailto. El mensaje se toma del SQL real.
	- Otro error (red, servidor, excepción): aviso genérico en español y la sesión NO se cierra.
	- Cableado: Mis compras carga el script antes de mis-compras.js y lo monta; la portada lee
	  la misma clave; sin emojis en lo nuevo.

	node pruebas/tienda-eliminar-cuenta.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

// sessionStorage de mentira (en node no existe)
const almacen = {};
global.sessionStorage = {
	getItem: (k) => (k in almacen ? almacen[k] : null),
	setItem: (k, v) => { almacen[k] = String(v); },
	removeItem: (k) => { delete almacen[k]; },
};

const E = require("../tienda/js/eliminar-cuenta.js");

// ── Confirmación ─────────────────────────────────────────────────────────────
ok("ELIMINAR confirma", E.confirmacionValida("ELIMINAR"), true);
ok("con espacios alrededor confirma", E.confirmacionValida("  ELIMINAR "), true);
ok("minúsculas no confirman (igual que Ajustes)", E.confirmacionValida("eliminar"), false);
ok("vacío no confirma", E.confirmacionValida(""), false);
ok("null no confirma", E.confirmacionValida(null), false);
ok("otra palabra no confirma", E.confirmacionValida("ELIMINA"), false);

// ── Mensaje de compras: el de la base, tal cual ──────────────────────────────
const sql = leer("supabase/mi_salon_b10_eliminar_cuenta_2026-09.sql");
const msgBase = (sql.match(/raise exception '(Tu cuenta tiene compras[^']+)'/) || [])[1];
ok("el SQL trae el mensaje de compras", !!msgBase, true);
ok("el SQL usa check_violation (23514)", /errcode = 'check_violation'/.test(sql), true);

const errCompras = { code: "23514", message: msgBase, details: null, hint: null };
ok("se reconoce por código", E.esErrorCompras({ code: "23514", message: "x" }), true);
ok("se reconoce por texto aunque falte el código", E.esErrorCompras({ message: msgBase }), true);
ok("otro error no es de compras", E.esErrorCompras({ code: "PGRST301", message: "JWT expired" }), false);
ok("sin error no es de compras", E.esErrorCompras(null), false);

const mc = E.mensajeError(errCompras);
ok("tipo compras", mc.tipo, "compras");
ok("mensaje exacto con el correo como mailto", mc.html,
	msgBase.replace("soporte@jissez.com", '<a href="mailto:soporte@jissez.com" class="font-bold underline underline-offset-2">soporte@jissez.com</a>'));
ok("un mensaje con HTML se escapa", E.conEnlaceSoporte('<img src=x onerror="a()">'), "&lt;img src=x onerror=&quot;a()&quot;&gt;");

// ── Otros errores ────────────────────────────────────────────────────────────
const red = E.mensajeError({ message: "TypeError: Failed to fetch" });
ok("error de red → tipo otro", red.tipo, "otro");
ok("error de red → sin inglés del navegador", /Failed to fetch/.test(red.html), false);
ok("error de red → dice que no se borró nada", /no se borró nada/.test(red.html), true);
ok("error de red → correo de soporte como enlace", /href="mailto:soporte@jissez.com"/.test(red.html), true);

// ── eliminar(): llamada, cierre de sesión y marca para la portada ─────────────
function sbFalso(respuesta) {
	const llamadas = [];
	return {
		llamadas,
		rpc: async (nombre, args) => {
			llamadas.push(["rpc", nombre, args === undefined ? null : args]);
			if (respuesta instanceof Error) throw respuesta;
			return respuesta;
		},
		auth: { signOut: async (opts) => { llamadas.push(["signOut", opts]); return { error: null }; } },
	};
}

(async () => {
	let sb = sbFalso({ data: null, error: null });
	let r = await E.eliminar(sb);
	ok("éxito → ok", r, { ok: true });
	ok("éxito → rpc delete_own_account sin argumentos y cierre local", sb.llamadas, [["rpc", "delete_own_account", null], ["signOut", { scope: "local" }]]);
	ok("éxito → marca para la portada", sessionStorage.getItem(E.CLAVE_AVISO), "1");
	sessionStorage.removeItem(E.CLAVE_AVISO);

	sb = sbFalso({ data: null, error: errCompras });
	r = await E.eliminar(sb);
	ok("compras → no ok, tipo compras", [r.ok, r.tipo], [false, "compras"]);
	ok("compras → la sesión NO se cierra", sb.llamadas.map((l) => l[0]), ["rpc"]);
	ok("compras → sin marca", sessionStorage.getItem(E.CLAVE_AVISO), null);

	sb = sbFalso({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } });
	r = await E.eliminar(sb);
	ok("red caída → no ok, tipo otro", [r.ok, r.tipo], [false, "otro"]);
	ok("red caída → la sesión NO se cierra", sb.llamadas.map((l) => l[0]), ["rpc"]);

	sb = sbFalso(new Error("boom"));
	r = await E.eliminar(sb);
	ok("excepción → no ok, tipo otro", [r.ok, r.tipo], [false, "otro"]);
	ok("excepción → la sesión NO se cierra", sb.llamadas.map((l) => l[0]), ["rpc"]);
	ok("excepción → sin marca", sessionStorage.getItem(E.CLAVE_AVISO), null);

	// ── Cableado ─────────────────────────────────────────────────────────────
	const html = leer("tienda/mis-compras.html");
	const iEc = html.indexOf('src="js/eliminar-cuenta.js"');
	const iMc = html.indexOf('src="js/mis-compras.js"');
	ok("Mis compras carga eliminar-cuenta.js antes de mis-compras.js", iEc > 0 && iEc < iMc, true);
	ok("Mis compras tiene la sección al final del main", /id="seccionCuenta"[\s\S]*<\/main>/.test(html) && html.indexOf('id="seccionCuenta"') > html.indexOf('id="seccionPendientes"'), true);
	ok("Mis compras conserva el Pixel", /fbq\('init', '1707663363640372'\)/.test(html), true);
	ok("mis-compras.js monta la sección", /window\.EliminarCuenta\.montar\(document\.getElementById\("seccionCuenta"\)/.test(leer("tienda/js/mis-compras.js")), true);
	ok("la portada lee la misma clave", leer("tienda/js/landing.js").includes('"' + E.CLAVE_AVISO + '"'), true);

	// Sin emojis ni pictogramas en lo nuevo (mismo criterio que sin-emojis.test.js)
	const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/gu;
	const PERMITIDOS = new Set(["→", "←"]);
	["tienda/js/eliminar-cuenta.js", "tienda/js/landing.js", "tienda/js/mis-compras.js", "tienda/mis-compras.html"].forEach((f) => {
		const hallados = [...leer(f).matchAll(SIMBOLOS)].map((m) => m[0]).filter((c) => !PERMITIDOS.has(c));
		ok("sin emojis en " + f, hallados, []);
	});

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
