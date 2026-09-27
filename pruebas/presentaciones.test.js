/*
	Páginas de presentación de Mi Salón y Sala de Maestros (decisión de Jorge, 2026-09-26):
	tienda/conoce-mi-salon.html y tienda/conoce-sala.html.

	- Publicadas pero ocultas: meta robots noindex y la regla X-Robots-Tag en _headers; ningún
	  enlace de la tienda, de la navegación de Mi Salón ni de la app instalable apunta a ellas.
	- Públicas (sin el candado del SaaS) y fuera de la app instalable (/salon/ las redirige fuera;
	  no llevan el manifest).
	- Precio en un solo lugar (PRECIOS_MI_SALON): en null, "Precio por anunciar" y sin botón de
	  compra; el botón aparece solo con precio y enlace, y nunca a quien ya tiene Mi Salón.
	- "Avísame" (js/interes-seccion.js): el regreso del login pasa el filtro de ?next= del login.
	- Sin emojis en los archivos nuevos.
	- SQL de interes_secciones: RLS (cada quien inserta, ve y borra lo suyo; anon sin permisos;
	  nadie actualiza) y delete_own_account sigue cubriendo todo lo de b15 más la tabla nueva.
	- Las imágenes que usan las páginas existen y llevan tamaño explícito y carga diferida,
	  salvo la principal de Mi Salón (loading="eager").
	- Beneficio para compradores (PRECIOS_MI_SALON.beneficioCompradores): genérico sin precio,
	  oculto con precio y sin beneficio, el texto configurado cuando lo hay.
	- Textos revisados contra el SaaS (revisor R23) y el aviso de privacidad cubre el "Avísame".

	node pruebas/presentaciones.test.js
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

const PAGINAS = ["tienda/conoce-mi-salon.html", "tienda/conoce-sala.html"];
const NUEVOS = PAGINAS.concat(["tienda/js/conoce-mi-salon.js", "tienda/js/interes-seccion.js"]);

// ── 1. Ocultas: noindex ──────────────────────────────────────────────────────
PAGINAS.forEach((p) => {
	const html = leer(p);
	ok(p + ": meta robots noindex", /<meta name="robots" content="noindex[^"]*">/.test(html), true);
	ok(p + ": title, description y og:image", [/<title>[^<]+<\/title>/.test(html), /<meta name="description" content="[^"]{40,}">/.test(html), /<meta property="og:image" content="https:\/\/jissez\.com\/presentacion\/img\/[a-z-]+\.jpg">/.test(html)], [true, true, true]);
	ok(p + ": sin candado del SaaS ni manifest de la app", [/<script[^>]+saas-guard\.js/.test(html), /<link[^>]+salon\.webmanifest/.test(html), /<script[^>]+app-instalada\.js/.test(html)], [false, false, false]);
});
const headers = leer("_headers");
["/tienda/conoce-mi-salon", "/tienda/conoce-mi-salon.html", "/tienda/conoce-sala", "/tienda/conoce-sala.html"].forEach((ruta) => {
	const re = new RegExp("^" + ruta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\r?\\n\\s+X-Robots-Tag: noindex", "m");
	ok("_headers: " + ruta + " con X-Robots-Tag noindex", re.test(headers), true);
});

// ── 2. Ningún enlace desde la tienda, la navegación ni la app ────────────────
function archivos(dir, ext) {
	return fs.readdirSync(path.join(RAIZ, dir)).filter((f) => ext.some((e) => f.endsWith(e))).map((f) => (dir === "." ? f : dir + "/" + f));
}
const revisar = archivos(".", [".html", ".js", ".webmanifest"])
	.concat(archivos("js", [".js"]))
	.concat(archivos("tienda", [".html"]))
	.concat(archivos("tienda/js", [".js"]))
	.concat(["_redirects"])
	.filter((f) => NUEVOS.indexOf(f) === -1);
/*
	Desde b21 (interruptor de lanzamiento, spec de Jorge 2026-09-26) hay DOS lugares que sí la nombran,
	y solo la enlazan cuando corresponde:
	  - tienda/js/tienda-common.js: el enlace "Mi Salón" del menú y los pies, SOLO con Mi Salón abierto
	    (jissez_config.mi_salon_abierto; con el interruptor apagado no aparece ningún enlace);
	  - js/mi-salon-acceso.js: el botón "Renovar" del modo solo lectura (mientras no exista la compra).
	Nadie más.
*/
const ENLAZAN_CON_REGLA = ["tienda/js/tienda-common.js", "js/mi-salon-acceso.js"];
const conEnlace = revisar.filter((f) => {
	if (ENLAZAN_CON_REGLA.indexOf(f) !== -1) return false;
	const t = leer(f);
	// _redirects sí las nombra: para sacarlas de /salon/ (se revisa abajo)
	if (f === "_redirects") return /^(?!\/salon\/)\S*conoce-(mi-salon|sala)/m.test(t);
	return /conoce-(mi-salon|sala)/.test(t);
});
ok("ningún otro archivo de la tienda, Mi Salón o la app enlaza a las presentaciones (" + revisar.length + " revisados)", conEnlace, []);
{
	const comun = leer("tienda/js/tienda-common.js");
	const usos = comun.split("PRESENTACION_MI_SALON").length - 1;
	ok("tienda: la presentación se nombra una sola vez (PRESENTACION_MI_SALON) y nunca conoce-sala", [(comun.match(/conoce-mi-salon/g) || []).length, /conoce-sala/.test(comun)], [1, false]);
	// Cada uso del enlace está dentro de miSalonAbierto().then(... if (!si) return ...)
	const bloques = comun.split("miSalonAbierto().then(function (si) {").slice(1);
	ok("tienda: el enlace solo se pone con Mi Salón abierto (" + usos + " usos)", bloques.length >= 2 && bloques.every((b) => /^\s*(var [^\n]*\n\s*)?if \(!si/.test(b)), true);
	const acceso = leer("js/mi-salon-acceso.js");
	// b22 (cobros): el botón de compra ya lleva a la compra de Mi Salón, no a la presentación
	ok("Mi Salón: la presentación no se enlaza desde la app; el botón de compra (COMPRA) lleva a la compra", [(acceso.match(/conoce-mi-salon/g) || []).length, /var COMPRA = "tienda\/mi-salon-compra\.html"/.test(acceso)], [0, true]);
}

// Fuera de la app instalable: /salon/tienda/conoce-* sale de /salon/, antes de la regla general
const redirects = leer("_redirects").split(/\r?\n/);
const splat = redirects.indexOf("/salon/* /:splat 200");
["conoce-mi-salon", "conoce-sala"].forEach((p) => {
	[".html", ""].forEach((ext) => {
		const i = redirects.indexOf("/salon/tienda/" + p + ext + " /tienda/" + p + " 301");
		ok("_redirects: /salon/tienda/" + p + ext + " → /tienda/" + p + " antes del splat", i !== -1 && i < splat, true);
	});
});

// ── 3. Precio en un solo lugar ───────────────────────────────────────────────
const { PRECIOS_MI_SALON, ConoceMiSalon } = require(path.join(RAIZ, "tienda/js/conoce-mi-salon.js"));
ok("configuración publicada: los precios y el beneficio siguen en null", [PRECIOS_MI_SALON.trimestre, PRECIOS_MI_SALON.ciclo, PRECIOS_MI_SALON.compra, PRECIOS_MI_SALON.beneficioCompradores], [null, null, null, null]);
const enNull = ConoceMiSalon.planes(PRECIOS_MI_SALON, false);
ok("precio en null: 'Precio por anunciar' en las dos tarjetas", enNull.map((p) => p.texto), ["Precio por anunciar", "Precio por anunciar"]);
ok("precio en null: sin botón de compra", enNull.map((p) => p.compra), [null, null]);
ok("precio en null: se ofrece 'Avísame cuando esté disponible'", ConoceMiSalon.ofrecerAviso(PRECIOS_MI_SALON, false), true);
ok("con acceso a Mi Salón no se ofrece el aviso", ConoceMiSalon.ofrecerAviso(PRECIOS_MI_SALON, true), false);
ok("precio sin enlace de compra: se muestra, sin botón", ConoceMiSalon.planes({ trimestre: 149, ciclo: null, compra: null }).map((p) => [p.texto, p.compra]), [["$149", null], ["Precio por anunciar", null]]);
const conTodo = ConoceMiSalon.planes({ trimestre: 149, ciclo: 399.5, compra: "checkout.html?producto=mi-salon" }, false);
ok("precio y enlace: botón con el plan", conTodo.map((p) => [p.texto, p.periodo, p.compra]), [["$149", "por trimestre", "checkout.html?producto=mi-salon&plan=trimestre"], ["$399.50", "por ciclo escolar", "checkout.html?producto=mi-salon&plan=ciclo"]]);
ok("con acceso a Mi Salón no hay botón de compra", ConoceMiSalon.planes({ trimestre: 149, ciclo: 399, compra: "checkout.html" }, true).map((p) => p.compra), [null, null]);
ok("con precio ya no se ofrece el aviso", ConoceMiSalon.ofrecerAviso({ trimestre: 149 }, false), false);
ok("precios inválidos cuentan como null", ["149", 0, -5, NaN, Infinity, undefined].map((v) => ConoceMiSalon.planes({ trimestre: v, compra: "x.html" })[0].compra), [null, null, null, null, null, null]);
ok("enlace de compra sin parámetros previos", ConoceMiSalon.enlaceCompra("comprar-mi-salon.html", "ciclo"), "comprar-mi-salon.html?plan=ciclo");
const htmlMs = leer("tienda/conoce-mi-salon.html");
ok("el HTML inicial no trae botón de compra (solo lo pinta el JS con precio)", /data-compra/.test(htmlMs), false);
ok("el HTML inicial dice 'Precio por anunciar' en las dos tarjetas", (htmlMs.match(/data-precio="pendiente">Precio por anunciar</g) || []).length, 2);
ok("PRECIOS_MI_SALON se define solo en tienda/js/conoce-mi-salon.js", revisar.concat(PAGINAS).filter((f) => /PRECIOS_MI_SALON\s*=/.test(leer(f))), []);
ok("beneficio para compradores, genérico y sin montos", /Si ya compraste planeaciones en Jissez, tendrás un beneficio especial; te lo diremos al lanzar\./.test(htmlMs) && !/\$\s?\d|\d+\s?%/.test(htmlMs.split('id="adquirir"')[1].split("</section>")[0]), true);

// Beneficio para quien ya compró planeaciones (PRECIOS_MI_SALON.beneficioCompradores)
const GENERICO = "Si ya compraste planeaciones en Jissez, tendrás un beneficio especial; te lo diremos al lanzar.";
ok("beneficio: el HTML inicial trae el mismo texto genérico que el JS", htmlMs.indexOf('id="msBeneficioTexto" class="mt-1.5 text-ink/80">' + ConoceMiSalon.BENEFICIO_GENERICO + "</p>") !== -1 && ConoceMiSalon.BENEFICIO_GENERICO === GENERICO, true);
ok("beneficio sin precio (configuración publicada, objeto vacío o null): texto genérico", [ConoceMiSalon.beneficio(PRECIOS_MI_SALON), ConoceMiSalon.beneficio({}), ConoceMiSalon.beneficio(null)], [GENERICO, GENERICO, GENERICO]);
ok("beneficio con precio y sin beneficioCompradores: no aparece", [ConoceMiSalon.beneficio({ trimestre: 149, ciclo: null, compra: null, beneficioCompradores: null }), ConoceMiSalon.beneficio({ ciclo: 399, beneficioCompradores: "   " }), ConoceMiSalon.beneficio({ trimestre: 149, ciclo: 399 })], [null, null, null]);
ok("beneficio con precio y con beneficioCompradores: aparece ese texto", ConoceMiSalon.beneficio({ trimestre: 149, ciclo: 399, compra: "checkout.html", beneficioCompradores: " Tu primer trimestre va sin costo. " }), "Tu primer trimestre va sin costo.");
ok("beneficio sin precio y con beneficioCompradores: gana el texto configurado", ConoceMiSalon.beneficio({ trimestre: null, beneficioCompradores: "Un mes sin costo." }), "Un mes sin costo.");
ok("la página pinta el beneficio desde ConoceMiSalon.beneficio y oculta la tarjeta sin él", /ConoceMiSalon\.beneficio\(PRECIOS_MI_SALON\)/.test(leer("tienda/js/conoce-mi-salon.js")) && /tarjeta\.classList\.toggle\("hidden", !t\)/.test(leer("tienda/js/conoce-mi-salon.js")), true);

// Textos revisados contra el SaaS (R23)
const textoMs = htmlMs.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("el titular ya no dice 'sin Excel' (la página ofrece exportar a Excel)", [/sin Excel/i.test(textoMs), /\bExcel\b/.test(textoMs)], [false, true]);
ok("calendario: 'los ajustes de tu grupo', no 'de tu escuela'", [/ajustes de tu grupo/.test(textoMs), /ajustes de tu escuela/.test(textoMs)], [true, false]);
ok("instalar: 'y sigue los pasos', no 'y acepta'", [/«Instalar la app» y sigue los pasos/.test(htmlMs), /y acepta\b/.test(textoMs)], [true, false]);
// 2026-09-26 (Jorge): la importación de planeaciones de Jissez a Mi Salón va después del piloto;
// hoy solo "próximamente" (pruebas/conoce-mi-salon-textos.test.js fija los textos nuevos)
ok("no afirma que el catálogo de planeaciones está incluido", [/(puedes|o) usar planeaciones de Jissez/.test(textoMs), /import(a|as|ar) (uno|un proyecto) de las planeaciones/.test(textoMs), /(planeaciones|catálogo)[^.]*incluid/i.test(textoMs)], [false, false, false]);
// 2026-09-26 (Jorge): los exámenes del catálogo se venden en la tienda y no son parte de Mi Salón
ok("exámenes: crear el suyo o subir resultados; ya no se aplican los del catálogo",
	[/aplicas los exámenes del catálogo/.test(textoMs), /Creas tu examen en Mi Salón[^.]*\. O subes los resultados de cualquier examen\./.test(textoMs), /matemáticas; y exámenes\./.test(textoMs)], [false, true, false]);
ok("paso 'Crea tu grupo': estado, ciclo, trimestre y tipo de organización", ["tu estado", "ciclo escolar", "trimestre en curso", "tipo de organización"].every((t) => textoMs.split("Crea tu grupo")[1].split("Da de alta")[0].indexOf(t) !== -1), true);
ok("privacidad: no dice que lo del grupo va sin nombres (el rol de aseo sí los lleva)", [/lo que es para todo el grupo no lleva nombres/.test(textoMs), /El rol de aseo sí lleva los nombres/.test(textoMs)], [false, true]);
ok("con acceso: 'Ir a Mi Salón' lleva al panel", (htmlMs.match(/data-ms="acceso" href="\.\.\/dashboard\.html"[^>]*>\s*Ir a Mi Salón/g) || []).length, 2);

// ── 4. "Avísame": regreso del login y secciones válidas ──────────────────────
const InteresSeccion = require(path.join(RAIZ, "tienda/js/interes-seccion.js"));
const LoginDestino = require(path.join(RAIZ, "tienda/js/login.js"));
["sala", "mi_salon"].forEach((s) => {
	const pag = s === "sala" ? "conoce-sala.html" : "conoce-mi-salon.html";
	const enlace = InteresSeccion.enlaceLogin(pag, s);
	const next = new URLSearchParams(enlace.split("?").slice(1).join("?")).get("next");
	ok("login regresa a " + pag + " pidiendo el aviso de " + s, LoginDestino.nextSeguro(next), pag + "?avisame=" + s);
	ok("al regresar se reconoce el pedido de " + s, InteresSeccion.pidioAlRegresar("?avisame=" + s, s), true);
});
ok("otro parámetro no guarda nada", [InteresSeccion.pidioAlRegresar("?avisame=sala", "mi_salon"), InteresSeccion.pidioAlRegresar("", "sala")], [false, false]);
ok("secciones válidas (las del CHECK de la tabla)", ["sala", "mi_salon", "tienda", ""].map(InteresSeccion.valida), [true, true, false, false]);
// El aviso de privacidad cubre el "Avísame" (qué guarda, para qué y cómo se quita), como dice Sala
const priv = leer("tienda/privacidad.html");
ok("privacidad: el Avísame en datos, finalidades y borrado, con la fecha de hoy", [
	/Si pide que le avisemos cuando abra una sección de Jissez[^<]*guardamos su cuenta, esa petición y la fecha/.test(priv),
	/escribirle a su correo cuando abra la sección de la que nos pidió aviso/.test(priv),
	/puede quitar esa petición desde la misma página donde la hizo, con el botón "Ya no quiero el aviso"/.test(priv),
	/Última actualización: 26 de septiembre de 2026/.test(priv),
], [true, true, true, true]);
ok("el botón que nombra el aviso de privacidad es el que pinta interes-seccion.js", /Ya no quiero el aviso/.test(leer("tienda/js/interes-seccion.js")) && /Puedes quitarlo cuando quieras desde esta página\. Más detalles en el <a href="privacidad\.html"/.test(leer("tienda/conoce-sala.html")), true);
ok("la página de Sala monta el aviso con sesión y la de Mi Salón solo sin precio", [/InteresSeccion\.montar\(\{\s*seccion: "sala"/.test(leer("tienda/conoce-sala.html")), /ofrecerAviso/.test(leer("tienda/js/conoce-mi-salon.js"))], [true, true]);

// Selector de secciones en las presentaciones: marca su sección y no la guarda como la última
const comun = leer("tienda/js/tienda-common.js");
ok("montarNav acepta la sección de la presentación", /opts\.seccion === "salon" \|\| opts\.seccion === "sala"/.test(comun), true);
ok("solo la tienda se guarda como última sección", /if \(seccion === "tienda"\) \{ S\.guardarUltima\("tienda"\); \}/.test(comun) && !/^\s*S\.guardarUltima\("tienda"\);\s*$/m.test(comun), true);

// ── 5. Sin emojis ────────────────────────────────────────────────────────────
const SIMBOLOS = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/gu;
const PERMITIDOS = new Set(["→", "←"]);
const emojis = [];
NUEVOS.forEach((f) => {
	leer(f).split(/\r?\n/).forEach((linea, i) => {
		const e = [...linea.matchAll(SIMBOLOS)].map((m) => m[0]).filter((c) => !PERMITIDOS.has(c));
		if (e.length) emojis.push(f + ":" + (i + 1) + " " + e.join(" "));
	});
});
ok("sin emojis en las páginas y scripts nuevos", emojis, []);

// ── 6. SQL: interes_secciones con RLS y delete_own_account completa ───────────
const sql = leer("supabase/jissez_interes_secciones_2026-09.sql");
const sinComentarios = sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n");
ok("tabla con usuario_id = auth.uid() y cascada al borrar la cuenta", /usuario_id\s+uuid not null default auth\.uid\(\) references auth\.users \(id\) on delete cascade/.test(sinComentarios), true);
ok("sección solo 'sala' o 'mi_salon'", /check \(seccion in \('sala', 'mi_salon'\)\)/.test(sinComentarios), true);
ok("una fila por cuenta y sección (índice único)", /create unique index if not exists \w+\s+on public\.interes_secciones \(usuario_id, seccion\)/.test(sinComentarios), true);
ok("RLS activada", /alter table public\.interes_secciones enable row level security/.test(sinComentarios), true);
ok("anon sin permisos", /revoke all on public\.interes_secciones from anon/.test(sinComentarios) && !/grant [^;]*on public\.interes_secciones to [^;]*anon/.test(sinComentarios), true);
ok("authenticated: solo select, insert y delete", (sinComentarios.match(/grant ([^;]+) on public\.interes_secciones to authenticated/) || [])[1], "select, insert, delete");
const politicas = [...sinComentarios.matchAll(/create policy (\w+) on public\.interes_secciones\s+for (\w+) to (\w+) (using|with check) \(\(select auth\.uid\(\)\) = usuario_id\)/g)].map((m) => m[2] + ":" + m[3] + ":" + m[4]);
ok("políticas: cada quien ve, inserta y borra solo lo suyo", politicas, ["select:authenticated:using", "insert:authenticated:with check", "delete:authenticated:using"]);
ok("ninguna política de update ni para anon", /for update|to anon|to public/.test(sinComentarios.split("create or replace function")[0]), false);

function cuerpo(texto) {
	const i = texto.lastIndexOf("create or replace function public.delete_own_account()");
	return texto.slice(i, texto.indexOf("end $$;", i));
}
const b15 = cuerpo(leer("supabase/mi_salon_b15_listas_2026-09.sql"));
const nuevo = cuerpo(sql);
const borrados = (t) => [...t.matchAll(/delete from public\.(\w+) where (?:maestro_id|usuario_id)|to_regclass\('public\.(\w+)'\)/g)].map((m) => m[1] || m[2]);
const faltan = [...new Set(borrados(b15))].filter((t) => borrados(nuevo).indexOf(t) === -1);
ok("delete_own_account sigue cubriendo todo lo de b13, b14 y b15", faltan, []);
ok("delete_own_account borra interes_secciones (con guarda)", /to_regclass\('public\.interes_secciones'\)[\s\S]*delete from public\.interes_secciones where usuario_id = \$1/.test(nuevo), true);
ok("delete_own_account conserva el freno por compras y borra al final auth.users", [/marketplace_ordenes/.test(nuevo), /delete from auth\.users where id = v;\s*$/.test(nuevo.trim() + "\n")], [true, true]);
ok("delete_own_account: security definer, search_path vacío y sin anon", [/security definer/.test(nuevo), /set search_path = ''/.test(nuevo), /revoke all on function public\.delete_own_account\(\) from public, anon;/.test(sql)], [true, true, true]);

// ── 7. Imágenes: existen, con tamaño explícito y carga diferida ──────────────
PAGINAS.forEach((p) => {
	const html = leer(p);
	const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
	const sinTam = imgs.filter((i) => !/\bwidth="\d+"/.test(i) || !/\bheight="\d+"/.test(i));
	// La imagen principal de Mi Salón (la tablet con Hoy, arriba) carga de inmediato; las demás, diferidas
	const esPrincipal = (i) => /ms-hoy-1280\.webp/.test(i);
	const sinLazy = imgs.filter((i) => !esPrincipal(i) && !/loading="lazy"/.test(i));
	const sinAlt = imgs.filter((i) => !/\balt="/.test(i));
	ok(p + ": imágenes con width, height, loading=lazy (salvo la principal) y alt", [sinTam.length, sinLazy.length, sinAlt.length], [0, 0, 0]);
	if (p === "tienda/conoce-mi-salon.html") {
		const principal = imgs.filter(esPrincipal);
		ok(p + ": la imagen principal va con loading=eager (y fetchpriority=high)", principal.length === 1 && /loading="eager"/.test(principal[0]) && /fetchpriority="high"/.test(principal[0]), true);
	}
	const rutas = [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+/)[0]))
		.filter((r) => /presentacion\/img\//.test(r));
	const faltanImg = rutas.filter((r) => !fs.existsSync(path.join(RAIZ, "tienda", r)));
	ok(p + ": capturas presentes (" + rutas.length + ")", faltanImg, []);
	const og = (html.match(/og:image" content="https:\/\/jissez\.com\/([^"]+)"/) || [])[1];
	ok(p + ": og:image presente en el repo", !!og && fs.existsSync(path.join(RAIZ, og)), true);
	// Encabezados en orden: un h1 y ningún salto de nivel
	const niveles = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
	const saltos = niveles.filter((n, i) => i > 0 && n > niveles[i - 1] + 1);
	ok(p + ": un solo h1 y encabezados sin saltos", [niveles.filter((n) => n === 1).length, saltos], [1, []]);
});

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
