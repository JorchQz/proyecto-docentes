/*
	Selector de secciones de Jissez (js/secciones.js; decisión de Jorge, 2026-09-25):
	Tienda, Mi Salón y Sala de Maestros, solo para cuentas con acceso a Mi Salón.

	- Última sección por dispositivo (localStorage "jissez.seccion"): se lee y se guarda
	  dentro de try/catch, solo con valores válidos; la primera vez, Mi Salón.
	- Destinos: login (con grupo → panel, sin grupo → alta, Tienda → portada, Sala → su
	  página), raíz (solo Mi Salón y Sala desvían) y portal.
	- index.html (la raíz): a la tienda de inmediato salvo con Mi Salón o Sala guardadas; y
	  aun así solo desvía con sesión y activo_saas = true (se ejecuta su script de verdad).
	- La tienda carga el selector solo para cuentas con acceso: un comprador no pide
	  js/secciones.js.
	- Páginas: Mi Salón carga el selector antes de la barra; Sala de Maestros está protegida
	  y sin Pixel; la barra de abajo respeta el área segura, sube lo fijo y no se imprime.

	node pruebas/secciones.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const S = require("../js/secciones.js");

// ── Última sección ───────────────────────────────────────────────────────────
function almacen(inicial) {
	const d = Object.assign({}, inicial);
	return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } };
}
const rompe = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };

ok("clave compartida", S.CLAVE, "jissez.seccion");
ok("sin nada guardado → null (primera vez)", S.leerUltima(almacen()), null);
let a = almacen();
S.guardarUltima("sala", a);
ok("guarda y lee Sala", [a.d["jissez.seccion"], S.leerUltima(a)], ["sala", "sala"]);
S.guardarUltima("tienda", a);
ok("la última gana", S.leerUltima(a), "tienda");
S.guardarUltima("admin", a);
ok("un valor inválido no se guarda", S.leerUltima(a), "tienda");
ok("un valor inválido guardado a mano se ignora", S.leerUltima(almacen({ "jissez.seccion": "<script>" })), null);
ok("almacenamiento bloqueado: leer no truena", S.leerUltima(rompe), null);
let trono = false;
try { S.guardarUltima("salon", rompe); } catch (_) { trono = true; }
ok("almacenamiento bloqueado: guardar no truena", trono, false);

// ── Destinos ─────────────────────────────────────────────────────────────────
const conGrupo = { data: [{ id: "g" }], error: null };
const sinGrupo = { data: [], error: null };
const falla = { data: null, error: { message: "x" } };
ok("ruta de cada sección", ["tienda", "salon", "sala", null].map(S.ruta), ["tienda/index.html", "dashboard.html", "sala-maestros.html", "dashboard.html"]);
ok("login primera vez con grupo → panel", S.destinoLogin(null, conGrupo), "dashboard.html");
ok("login primera vez sin grupo → alta", S.destinoLogin(null, sinGrupo), "onboarding.html");
ok("login Mi Salón, lectura fallida → panel (no afirma que no hay grupo)", S.destinoLogin("salon", falla), "dashboard.html");
ok("login Mi Salón sin respuesta → panel", S.destinoLogin("salon", null), "dashboard.html");
ok("login Tienda → portada, no catálogo", S.destinoLogin("tienda", sinGrupo), "tienda/index.html");
ok("login Sala → Sala de Maestros", S.destinoLogin("sala", sinGrupo), "sala-maestros.html");
ok("solo Mi Salón necesita leer grupos", [null, "salon", "tienda", "sala"].map(S.necesitaGrupos), [true, true, false, false]);
ok("raíz: Mi Salón y Sala desvían; Tienda y nada, no", [null, "tienda", "salon", "sala", "otro"].map(S.destinoRaiz), [null, null, "dashboard.html", "sala-maestros.html", null]);

// ── index.html (la raíz), ejecutando su script ───────────────────────────────
function raiz(opciones) {
	const html = leer("index.html");
	const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];
	const r = { destino: null, cargados: [], lecturas: 0, relojes: [] };
	const local = almacen(opciones.guardado ? { "jissez.seccion": opciones.guardado } : {});
	const doc = {
		head: {
			appendChild: (s) => {
				r.cargados.push(s.src);
				// Simula la carga: supabase.js deja window.sb; secciones.js deja window.Secciones
				if (s.src === "js/supabase.js") {
					ventana.sb = {
						auth: { getSession: async () => ({ data: { session: opciones.sesion ? { user: { id: "u1" } } : null }, error: null }) },
						from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { r.lecturas++; return opciones.perfil; } }) }) }),
					};
				}
				if (s.src === "js/secciones.js") ventana.Secciones = S;
				if (opciones.cuelga) return; // la red nunca contesta
				Promise.resolve().then(() => (opciones.falla === s.src ? s.onerror() : s.onload()));
			},
		},
		createElement: () => ({}),
		getElementById: (id) => (id === "raizEspera" ? r.aviso : null),
	};
	r.aviso = { hidden: true };
	const ventana = {
		location: { hash: opciones.hash || "", search: "", replace: (u) => { if (r.destino === null) r.destino = u; } },
		get localStorage() { if (opciones.bloqueado) throw new Error("bloqueado"); return local; },
	};
	const ctx = { window: ventana, document: doc, setTimeout: (f, ms) => { f.ms = ms; r.relojes.push(f); }, Promise, console };
	vm.createContext(ctx);
	vm.runInContext(codigo, ctx);
	return new Promise((listo) => setTimeout(() => listo(r), 30));
}

(async () => {
	let r = await raiz({});
	ok("raíz sin nada guardado → tienda de inmediato, sin cargar nada", [r.destino, r.cargados.length], ["tienda/index.html", 0]);
	r = await raiz({ guardado: "tienda", sesion: true, perfil: { data: { activo_saas: true }, error: null } });
	ok("raíz con última Tienda → tienda de inmediato", [r.destino, r.cargados.length], ["tienda/index.html", 0]);
	r = await raiz({ bloqueado: true });
	ok("raíz con almacenamiento bloqueado → tienda", r.destino, "tienda/index.html");
	r = await raiz({ hash: "#access_token=x&type=recovery" });
	ok("raíz: la recuperación de contraseña sigue igual", r.destino, "/reset-password#access_token=x&type=recovery");
	r = await raiz({ guardado: "salon", sesion: true, perfil: { data: { activo_saas: true }, error: null } });
	ok("raíz con acceso y última Mi Salón → Mi Salón", r.destino, "dashboard.html");
	r = await raiz({ guardado: "sala", sesion: true, perfil: { data: { activo_saas: true }, error: null } });
	ok("raíz con acceso y última Sala → Sala de Maestros", r.destino, "sala-maestros.html");
	r = await raiz({ guardado: "salon", sesion: false });
	ok("raíz sin sesión (dispositivo con Mi Salón guardado) → tienda, sin leer perfiles", [r.destino, r.lecturas], ["tienda/index.html", 0]);
	r = await raiz({ guardado: "salon", sesion: true, perfil: { data: { activo_saas: false }, error: null } });
	ok("raíz con un comprador en el mismo dispositivo → tienda", r.destino, "tienda/index.html");
	r = await raiz({ guardado: "sala", sesion: true, perfil: { data: null, error: { message: "caída" } } });
	ok("raíz con la lectura de perfiles fallida → tienda", r.destino, "tienda/index.html");
	r = await raiz({ guardado: "salon", sesion: true, falla: "js/supabase.js" });
	ok("raíz si no carga un script → tienda", r.destino, "tienda/index.html");
	r = await raiz({ guardado: "salon", sesion: true, perfil: { data: { activo_saas: true }, error: null } });
	ok("raíz: un límite de tiempo y el aviso de espera, nada más", r.relojes.length, 2);
	r = await raiz({ guardado: "salon", sesion: true, cuelga: true });
	ok("raíz colgada: sin texto a la vista mientras decide", [r.destino, r.aviso.hidden], [null, true]);
	r.relojes.slice().sort((x, y) => x.ms - y.ms).forEach((f) => f()); // en el orden en que vencen
	ok("raíz colgada: el aviso discreto aparece y el límite manda a la tienda", [r.destino, r.aviso.hidden], ["tienda/index.html", false]);
	const htmlRaiz = leer("index.html");
	ok("raíz: el texto técnico ya no está y el aviso empieza oculto", [/Redirigiendo a/.test(htmlRaiz), /id="raizEspera"[^>]*hidden/.test(htmlRaiz)], [false, true]);
	ok("raíz: sin JavaScript sigue el enlace a la tienda", /<noscript>[\s\S]*href="tienda\/index\.html"[\s\S]*<\/noscript>/.test(htmlRaiz), true);
	ok("raíz: fondo de la marca (el de la tienda)", /background: #faf9f4/.test(htmlRaiz), true);

	// ── La tienda carga el selector solo para cuentas con acceso ─────────────────
	// La cuenta con sesión en el navegador es u1 (sesión de Supabase en localStorage)
	const SESION_U1 = { "sb-x-auth-token": JSON.stringify({ access_token: "t", user: { id: "u1" } }) };
	function conLlaves(a) {
		a.key = (i) => Object.keys(a.d)[i];
		a.removeItem = (k) => { delete a.d[k]; };
		Object.defineProperty(a, "length", { get: () => Object.keys(a.d).length });
		return a;
	}
	function tienda(guardadoPestana, guardadoLocal, clasesHtml) {
		const pedidos = [];
		const ss = conLlaves(almacen(guardadoPestana || {}));
		const ls = conLlaves(almacen(guardadoLocal === undefined ? SESION_U1 : guardadoLocal));
		const clases = new Set(clasesHtml || []);
		const oyentes = {};
		const ctx = {
			window: { sb: null, matchMedia: () => ({ matches: false }) },
			document: {
				createElement: () => ({}), head: { appendChild: (s) => pedidos.push(s.src) },
				documentElement: { classList: { contains: (c) => clases.has(c), add: (c) => clases.add(c), remove: (c) => clases.delete(c) } },
				addEventListener: (ev, f) => { oyentes[ev] = f; },
			},
			sessionStorage: ss,
			localStorage: ls,
			setTimeout: (f, ms) => { pedidos.relojes = (pedidos.relojes || []).concat([[f, ms]]); return 1; },
			clearTimeout: () => {},
			console,
		};
		pedidos.clases = clases;
		pedidos.oyentes = oyentes;
		pedidos.ctx = ctx;
		ctx.window.window = ctx.window;
		vm.createContext(ctx);
		vm.runInContext(leer("tienda/js/tienda-common.js"), ctx);
		return pedidos;
	}
	ok("tienda: anónimo no pide el selector", tienda(), []);
	ok("tienda: comprador sin acceso no pide el selector", tienda({ "jissez.saas.u1": "0" }), []);
	ok("tienda: con acceso ya sabido se pide desde la raíz", tienda({ "jissez.saas.u1": "1" }), ["../js/secciones.js"]);
	ok("tienda: pestaña nueva con la pista del dispositivo lo pide", tienda({}, Object.assign({ "jissez.saas.u1": "1" }, SESION_U1)), ["../js/secciones.js"]);
	ok("tienda: la pestaña manda sobre la pista (acceso retirado)", tienda({ "jissez.saas.u1": "0" }, Object.assign({ "jissez.saas.u1": "1" }, SESION_U1)), []);
	ok("tienda: la pista de otra cuenta del dispositivo no cuenta", tienda({}, Object.assign({ "jissez.saas.u2": "1" }, SESION_U1)), []);
	ok("tienda: sin sesión guardada no pide nada aunque haya pista", tienda({ "jissez.saas.u1": "1" }, { "jissez.saas.u1": "1" }), []);
	ok("tienda: comprador sin nada guardado no pide el selector", tienda({}, SESION_U1), []);

	// Espacio apartado para el encabezado (html.jz-sec-reserva)
	{
		const t = tienda({ "jissez.saas.u1": "1" });
		ok("reserva: cargar la tienda no la pone por sí sola", t.clases.has("jz-sec-reserva"), false);
		// La pone el head (tienda-theme.js): si la página no monta el encabezado, se libera
		const conHead = tienda({ "jissez.saas.u1": "1" }, undefined, ["jz-sec-reserva"]);
		ok("reserva del head: hay tope de tiempo", (conHead.relojes || []).some((x) => x[1] === 4000), true);
		conHead.oyentes.DOMContentLoaded();
		conHead.relojes.filter((x) => x[1] === 0).forEach((x) => x[0]());
		ok("reserva del head: sin encabezado en la página se libera al cargar", conHead.clases.has("jz-sec-reserva"), false);
	}
	{
		// montarNav la pone (o la confirma) antes de esperar la sesión y la quita al insertar
		const t = tienda({ "jissez.saas.u1": "1" }, undefined, []);
		const cuerpo = { hijos: [], insertBefore(n) { this.hijos.unshift(n); }, get firstChild() { return this.hijos[0] || null; } };
		t.ctx.document.body = cuerpo;
		const nodo = { firstChild: null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, classList: { contains: () => false, add: () => {} } };
		t.ctx.document.createElement = () => ({ set innerHTML(v) { this.firstChild = nodo; }, firstChild: null });
		let vistaEsperando = null;
		t.ctx.window.sb = { auth: { getSession: () => { vistaEsperando = t.clases.has("jz-sec-reserva"); return Promise.resolve({ data: { session: null }, error: null }); } } };
		t.ctx.window.lucide = { createIcons: () => {} };
		const T = t.ctx.window.Tienda || vm.runInContext("Tienda", t.ctx);
		const p = T.montarNav("");
		ok("reserva: montarNav la pone mientras llega la sesión", vistaEsperando, true);
		await p;
		ok("reserva: se quita al insertar el encabezado", t.clases.has("jz-sec-reserva"), false);
		const c = tienda({}, SESION_U1, []);
		c.ctx.document.body = { hijos: [], insertBefore(n) { this.hijos.unshift(n); }, get firstChild() { return this.hijos[0] || null; } };
		c.ctx.document.createElement = () => ({ set innerHTML(v) { this.firstChild = nodo; }, firstChild: null });
		let vistaComprador = null;
		c.ctx.window.sb = { auth: { getSession: () => { vistaComprador = c.clases.has("jz-sec-reserva"); return Promise.resolve({ data: { session: null }, error: null }); } } };
		await (c.ctx.window.Tienda || vm.runInContext("Tienda", c.ctx)).montarNav("");
		ok("reserva: a un comprador no se le aparta nada", vistaComprador, false);
	}
	const css = leer("tienda/css/tienda.css");
	ok("reserva: mide lo mismo que el encabezado (65 celular, 110 PC y tablet)", /html\.jz-sec-reserva body::before \{[\s\S]*?height: 65px[\s\S]*?min-width: 768px[\s\S]*?height: 110px/.test(css), true);
	const guardJs = leer("js/saas-guard.js");
	ok("candado: recuerda el acceso con la clave de la tienda", /var clave = "jissez\.saas\." \+ uid/.test(guardJs) && /if \(uid\) recordarAcceso\(uid, activo\);/.test(guardJs), true);

	// ── Páginas ──────────────────────────────────────────────────────────────────
	const paginasNavbar = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html") && /src="js\/navbar\.js"/.test(leer(f)));
	const malas = paginasNavbar.filter((f) => {
		const h = leer(f);
		const i = h.indexOf('src="js/secciones.js"'), j = h.indexOf('src="js/navbar.js"'), g = h.indexOf('src="js/saas-guard.js"');
		return !(i !== -1 && i < j && g !== -1 && g < i);
	});
	ok("Mi Salón: " + paginasNavbar.length + " páginas cargan el candado, el selector y luego la barra", malas, []);

	const sala = leer("sala-maestros.html");
	const ordenSala = ["js/supabase.js", "js/lectura.js", "js/saas-guard.js", "js/secciones.js", "js/sala-maestros.js"].map((s) => sala.indexOf('src="' + s + '"'));
	ok("Sala: protegida (candado antes del selector y su script)", ordenSala.every((v, i) => v > 0 && (i === 0 || v > ordenSala[i - 1])), true);
	ok("Sala: sin Pixel de Meta", /fbq|facebook/i.test(sala), false);
	ok("Sala: dice Próximamente y qué será", /Próximamente/.test(sala) && /compartir material didáctico/.test(sala), true);
	ok("Sala: sin formularios", /<form|<input|<textarea/.test(sala), false);
	const salaJs = leer("js/sala-maestros.js");
	ok("Sala: guarda la última sección solo tras el candado", /saasAcceso\.then\([^)]*\)?[\s\S]{0,80}guardarUltima\("sala"\)/.test(salaJs), true);
	const navbar = leer("js/navbar.js");
	ok("Mi Salón: guarda la última sección solo tras el candado", /saasAcceso\.then\([\s\S]{0,80}guardarUltima\("salon"\)/.test(navbar), true);
	const comun = leer("tienda/js/tienda-common.js");
	ok("Tienda: guarda la última sección al poner el selector", /guardarUltima\("tienda"\)/.test(comun), true);
	const guard = leer("js/saas-guard.js");
	ok("candado: saasAcceso se cumple solo al permitir", /function permitir\(\) \{[\s\S]{0,120}resolverAcceso\(true\)/.test(guard) && (guard.match(/resolverAcceso\(/g) || []).length === 1, true);

	// ── Estilos del selector ─────────────────────────────────────────────────────
	const js = leer("js/secciones.js");
	ok("barra de abajo: respeta el área segura", /env\(safe-area-inset-bottom/.test(js), true);
	ok("barra de abajo: espacio al final de la página", /html\.jz-secciones body::after\{content:''/.test(js), true);
	ok("barra de abajo: sube lo fijo de la página", /\.fixed\[class\*='bottom-'\][^{]*\{margin-bottom:var\(--jz-sec-abajo\)\}/.test(js), true);
	ok("no se imprime", /@media print\{\.jz-sec-barra,\.jz-sec-abajo\{display:none!important\}/.test(js), true);
	ok("sección actual con aria-current", /aria-current="true"/.test(js), true);
	ok("navegación con aria-label", /aria-label="Secciones de Jissez"/.test(js), true);
	ok("foco visible", /:focus-visible/.test(js), true);
	ok("la barra de abajo mide al menos 44 px", S.ALTO_BARRA >= 44 && /height:" \+ ALTO_ABAJO \+ "px/.test(js) && /ALTO_ABAJO = (\d+)/.exec(js)[1] >= 44, true);
	ok("Tienda en el selector lleva a la portada, no al catálogo", /clave: "tienda"[^}]*ruta: "tienda\/index\.html"/.test(js), true);

	// ── Pulido R10 ───────────────────────────────────────────────────────────────
	ok("PC: la barra de abajo no existe (ni como región vacía para el lector)", /\.jz-sec-abajo-nav,\.jz-sec-abajo\{display:none\}/.test(js) && /max-width:767\.98px\)\{" \+\s*"\.jz-sec-abajo-nav\{display:block\}/.test(js), true);
	ok("Mi Salón: #app-navbar es contenedor y la navegación va adentro (el selector no queda anidado)",
		/'<div id="app-navbar" class="fixed/.test(navbar) && /'<nav aria-label="Mi Salón" class="max-w-4xl/.test(navbar) && !/<nav id="app-navbar"/.test(navbar), true);
	ok("Mi Salón: cerrar sesión lleva a la tienda", /signOut\(\)[\s\S]{0,400}window\.location\.href = "tienda\/index\.html"/.test(navbar), true);
	const formativa = leer("js/evaluacion_formativa.js");
	ok("formativa: el ajuste toma el contenido por id, no la barra", /getElementById\("evalContenido"\)/.test(formativa) && !/querySelector\("\.max-w-4xl/.test(formativa) && /id="evalContenido"/.test(leer("evaluacion_formativa.html")), true);
	const examen = leer("js/examen.js");
	ok("examen: el final deja lo que mide el pie de Calificar", /function ajustarPie\(\)[\s\S]{0,600}footerEl\.offsetHeight/.test(examen) && /new ResizeObserver\(ajustarPie\)/.test(examen), true);
	ok("junta: el alto disponible se mide (--j-sobre)", /--j-sobre/.test(leer("junta.html")) && /setProperty\("--j-sobre"/.test(leer("js/junta.js")), true);
	const onboarding = leer("onboarding.html");
	ok("alta: sin selector (no monta nada) pero guarda Mi Salón al terminar",
		!/src="js\/navbar\.js"/.test(onboarding) && onboarding.indexOf('src="js/saas-guard.js"') < onboarding.indexOf('src="js/secciones.js"') &&
		!/Secciones\.montar/.test(leer("js/onboarding.js")) && /Secciones\.guardarUltima\("salon"\)/.test(leer("js/onboarding.js")), true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
