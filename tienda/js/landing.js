// Landing dinámico: trae precios reales y paquetes destacados desde la BD
// (marketplace_productos, editable por el admin). Sin datos inventados.
document.addEventListener("DOMContentLoaded", function () {
	if (!window.sb) { return; }
	cargarLanding();
});

var GRADO_COLOR = {
	"1": { bg: "#f2cf6b", txt: "rgba(30,58,138,.85)" },
	"2": { bg: "#ef9277", txt: "#fff" },
	"3": { bg: "#79c8a6", txt: "rgba(30,58,138,.85)" },
	"4": { bg: "#a99fe0", txt: "#fff" },
	"5": { bg: "#85b8e6", txt: "rgba(30,58,138,.85)" },
	"6": { bg: "#f0b285", txt: "rgba(30,58,138,.85)" },
};

async function cargarLanding() {
	var res = await window.sb
		.from("marketplace_productos")
		.select("id, grado, tipo_paquete, precio_pdf, precio_editable, organizacion, grados_combo, modalidad")
		.eq("activo", true);
	var prods = (!res.error && res.data) ? res.data : [];

	llenarPrecios(prods);
	llenarUnitaria();
	renderDestacados(prods);
	renderMuestra(prods);
}

// Precio del paquete unitario (combo de todos los paquetes multigrado). No hay
// productos de los que derivarlo: viene del tarifario vía RPC pública.
async function llenarUnitaria() {
	var el = document.getElementById("unitariaNota");
	if (!el || !window.sb) { return; }
	var rTrim = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "trimestre" });
	var rCiclo = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "ciclo" });
	if (rTrim.error || rCiclo.error || !rTrim.data || !rCiclo.data) { return; }
	el.textContent = "Paquete unitario: todos los combos en una sola compra. Desde " +
		montoCorto(rTrim.data.precio_pdf) + " el trimestre o " +
		montoCorto(rCiclo.data.precio_pdf) + " el ciclo completo.";
}

// Vista previa en la portada: enseña páginas reales antes de pedir nada. Busca
// el primer paquete que ya tenga imágenes subidas en `previews/<slug>/` y las
// muestra. Si todavía no hay ninguna, la sección se queda oculta.
async function renderMuestra(prods) {
	var seccion = document.getElementById("muestra");
	var tira = document.getElementById("muestraTira");
	if (!seccion || !tira || !prods.length) { return; }

	// Un candidato por grado/combinación, en el orden en que se prefieren.
	var vistos = {};
	var candidatos = [];
	prods.forEach(function (p) {
		var slug = Tienda.slugPreview(p.organizacion, p.grado, p.grados_combo);
		if (!slug || vistos[slug]) { return; }
		vistos[slug] = true;
		candidatos.push({
			slug: slug,
			esMulti: p.organizacion === "multigrado",
			orden: p.organizacion === "multigrado" ? 100 : Number(p.grado || 99),
			href: p.organizacion === "multigrado"
				? "producto.html?org=multigrado&combo=" + encodeURIComponent(p.grados_combo || "")
				: "producto.html?org=completa&g=" + encodeURIComponent(p.grado),
			titulo: p.organizacion === "multigrado"
				? "Multigrado " + comboDisplay(p.grados_combo)
				: p.grado + "° Primaria",
		});
	});
	candidatos.sort(function (a, b) { return a.orden - b.orden; });

	// Se consultan a la vez y se toma el primero con imágenes, para no encadenar
	// hasta once viajes de ida y vuelta cuando aún no hay nada subido.
	var urls = await Promise.all(candidatos.map(function (c) {
		return listarMuestra(c.slug);
	}));
	var i = urls.findIndex(function (u) { return u && u.length; });
	if (i === -1) { return; }

	var elegido = candidatos[i];
	tira.innerHTML = urls[i].slice(0, 5).map(function (im) {
		return '<a href="' + Tienda.esc(elegido.href) + '" class="shrink-0 w-[240px] sm:w-[280px] rounded-2xl overflow-hidden border border-line bg-paper block">' +
			'<img src="' + Tienda.esc(im.url) + '" alt="Página de muestra · ' + Tienda.esc(elegido.titulo) + '" class="w-full h-[320px] sm:h-[380px] object-contain" loading="lazy">' +
			'<span class="block px-3 py-2 text-[12px] font-semibold text-mute border-t border-line">' + Tienda.esc(im.etiqueta) + '</span>' +
			'</a>';
	}).join("");

	var cta = document.getElementById("muestraCta");
	if (cta) { cta.href = elegido.href; }

	seccion.classList.remove("hidden");

	// Ya hay muestra que enseñar: el botón secundario del hero pasa a ofrecerla.
	// Es mejor gancho que "Qué incluye", y solo aparece cuando de verdad existe.
	var heroSec = document.getElementById("heroSecundario");
	if (heroSec) {
		heroSec.href = "#muestra";
		heroSec.innerHTML = '<i data-lucide="eye" class="w-5 h-5"></i> Ver muestra gratis';
	}

	Tienda.iconos();
	Tienda.revelar();
}

// Mismas etiquetas que usa la galería de la ficha de producto.
function etiquetaMuestra(nombre) {
	var n = String(nombre).toLowerCase();
	if (n.indexOf("anexo") !== -1) { return "Anexo para el alumno"; }
	if (n.indexOf("examen") !== -1) { return "Examen del trimestre"; }
	return "Planeación";
}

async function listarMuestra(slug) {
	try {
		var r = await window.sb.storage.from("assets").list("previews/" + slug, {
			limit: 12,
			sortBy: { column: "name", order: "asc" },
		});
		if (r.error || !r.data) { return []; }
		return r.data
			// El listado incluye un marcador de carpeta vacía; fuera.
			.filter(function (f) { return f.name && /\.(jpe?g|png|webp)$/i.test(f.name); })
			.map(function (f) {
				return {
					etiqueta: etiquetaMuestra(f.name),
					url: window.sb.storage.from("assets")
						.getPublicUrl("previews/" + slug + "/" + f.name).data.publicUrl,
				};
			});
	} catch (_) {
		return [];
	}
}

function minPrecio(prods, filtro) {
	var arr = prods.filter(filtro)
		.map(function (p) { return p.precio_pdf != null ? Number(p.precio_pdf) : Infinity; })
		.filter(isFinite);
	return arr.length ? Math.min.apply(null, arr) : null;
}

function llenarPrecios(prods) {
	var esUnGradoTrim = function (p) { return p.organizacion === "completa" && p.tipo_paquete === "trimestre"; };
	var esUnGradoCiclo = function (p) { return p.organizacion === "completa" && p.tipo_paquete === "ciclo"; };

	var trim = minPrecio(prods, esUnGradoTrim);
	var ciclo = minPrecio(prods, esUnGradoCiclo);

	setPrecio("precioTrim", trim, "por grado y trimestre", false);
	setPrecio("precioCiclo", ciclo, "el ciclo completo", true);
	setPrecio("precioMulti", minPrecio(prods, function (p) { return p.organizacion === "multigrado"; }), "2 o 3 grados", false);

	// El ahorro en pesos, no la idea vaga de "ahorra": tres trimestres sueltos
	// contra el ciclo. Sale de los precios reales, así que sigue siendo cierto
	// cuando el ciclo cambie de tramo de lanzamiento.
	if (trim != null && ciclo != null) {
		var ahorro = trim * 3 - ciclo;
		var el = document.getElementById("ahorroCiclo");
		if (el && ahorro > 0) {
			el.textContent = "Ahorras " + montoCorto(ahorro) + " frente a comprar los tres trimestres por separado";
			el.classList.remove("hidden");
		}
	}

	// El Word es un add-on que se suma al paquete: se muestra cuánto cuesta
	// aparte, en vez de dejarlo en "costo adicional" sin número.
	setAddon("addonTrim", prods, esUnGradoTrim, "Versión Word editable");
	setAddon("addonCiclo", prods, esUnGradoCiclo, "Versión Word editable");
	setAddon("addonMulti", prods, function (p) {
		return p.organizacion === "multigrado" && p.tipo_paquete === "trimestre";
	}, "Versión Word editable");
}

// Importe compacto: "$349" en vez de "$349.00 MXN", que repetido en una línea
// se vuelve ilegible.
function montoCorto(n) {
	var num = Number(n || 0);
	return "$" + num.toLocaleString("es-MX", {
		minimumFractionDigits: num % 1 === 0 ? 0 : 2,
		maximumFractionDigits: 2,
	});
}

// El add-on es la diferencia entre las dos versiones del mismo paquete.
function setAddon(id, prods, filtro, etiqueta) {
	var el = document.getElementById(id);
	if (!el) { return; }
	var candidatos = prods.filter(filtro).filter(function (p) {
		return p.precio_pdf != null && p.precio_editable != null;
	});
	if (!candidatos.length) { return; }
	var addon = Number(candidatos[0].precio_editable) - Number(candidatos[0].precio_pdf);
	if (!(addon > 0)) { return; }
	el.textContent = etiqueta + ": + " + montoCorto(addon);
}

// Si hay precio real lo muestra ("Desde $X"); si no, deja el texto genérico ya presente.
function setPrecio(id, monto, sufijo, dark) {
	var el = document.getElementById(id);
	if (!el || monto == null) { return; }
	var numCls = "text-3xl font-black" + (dark ? "" : " text-ink");
	var sufCls = dark ? "text-white/70" : "text-mute";
	el.innerHTML =
		'<span class="' + numCls + '">Desde ' + Tienda.formatMoney(monto) + '</span>' +
		'<span class="' + sufCls + '"> · ' + sufijo + '</span>';
}

function comboDisplay(combo) {
	return (combo || "").split("-").map(function (n) { return n + "°"; }).join("-");
}

function renderDestacados(prods) {
	var grid = document.getElementById("destacadosGrid");
	// Si no hay productos activos, se dejan las tarjetas estáticas de muestra
	// (que ya remiten al catálogo). Solo reemplazamos con datos reales si existen.
	if (!grid || !prods.length) { return; }

	// Agrupar por categoría: grado (completa) o combinación (multigrado).
	var mapa = {}, orden = [];
	prods.forEach(function (p) {
		var clave = p.organizacion === "multigrado" ? "c" + p.grados_combo : "g" + p.grado;
		if (!(clave in mapa)) {
			mapa[clave] = { org: p.organizacion, grado: p.grado, combo: p.grados_combo, modalidad: p.modalidad, prods: [] };
			orden.push(clave);
		}
		mapa[clave].prods.push(p);
	});
	var grupos = orden.map(function (k) { return mapa[k]; });
	grupos.sort(function (a, b) {
		var ga = a.grado || 9, gb = b.grado || 9;
		if (ga !== gb) { return ga - gb; }
		return (a.combo || "").length - (b.combo || "").length;
	});
	grupos = grupos.slice(0, 3);

	grid.innerHTML = grupos.map(cardHtml).join("");
	// Las portadas reales entran después, sin bloquear el pintado del grid.
	grid.querySelectorAll("[data-portada]").forEach(function (el) {
		Tienda.pintarPortada(el, el.getAttribute("data-slug"), el.getAttribute("data-alt"));
	});
	Tienda.iconos();
}

function cardHtml(g) {
	var esMulti = g.org === "multigrado";
	var esc = Tienda.esc, money = Tienda.formatMoney;
	// Mismo nombre que el h1 de la ficha y que la tarjeta del catálogo.
	var titulo = esMulti
		? "Multigrado " + comboDisplay(g.combo) + " de Primaria"
		: g.grado + "° de Primaria";
	var precioDesde = minPrecio(g.prods, function () { return true; });
	var href = esMulti
		? "producto.html?org=multigrado&combo=" + encodeURIComponent(g.combo)
		: "producto.html?org=completa&g=" + encodeURIComponent(g.grado);
	var tieneWord = g.prods.some(function (p) { return p.precio_editable != null; });

	var badge;
	if (!esMulti) {
		var gc = GRADO_COLOR[String(g.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
		badge = '<span style="background:' + gc.bg + ';color:' + gc.txt + '" class="absolute top-3 left-3 w-10 h-10 rounded-xl text-base font-black flex items-center justify-center shadow">' + esc(g.grado) + '°</span>';
	} else {
		// bidocente = 2 docentes = 3 grados; tridocente = 3 docentes = 2 grados.
		// Sin etiqueta si la modalidad no es una de las dos conocidas.
		var etiqueta = g.modalidad === "bidocente" ? "Bidocente"
			: g.modalidad === "tridocente" ? "Tridocente" : "";
		badge = etiqueta
			? '<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">' + esc(etiqueta) + '</span>'
			: "";
	}

	return (
		'<a href="' + href + '" class="prod-card bg-white border border-line rounded-3xl overflow-hidden flex flex-col">' +
		'<div class="relative"><div class="ph h-44 overflow-hidden" data-portada data-slug="' + esc(Tienda.slugPreview(g.org, g.grado, g.combo)) + '" data-alt="' + esc(titulo) + '" style="border-radius:0">' + esc(titulo) + ' · portada</div>' + badge + '</div>' +
		'<div class="p-5 flex flex-col flex-1">' +
		'<h3 class="font-bold text-lg text-ink leading-snug">' + esc(titulo) + '</h3>' +
		'<p class="mt-1 text-sm text-mute">Proyectos, PDAs, anexos y examen.</p>' +
		'<div class="mt-3 flex flex-wrap gap-1.5">' +
		'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md bg-paper border border-line text-mute">PDF</span>' +
		(tieneWord ? '<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md text-board/70" style="background:rgba(133,184,230,.18);border:1px solid rgba(133,184,230,.4)">+ Word disponible</span>' : '') +
		'</div>' +
		'<div class="mt-4 pt-4 border-t border-line flex items-center justify-between gap-2">' +
		(precioDesde != null
			? '<div><span class="text-lg font-black text-ink">Desde ' + money(precioDesde) + '</span></div>'
			: '<span class="text-[12px] font-semibold text-mute">Ver opciones</span>') +
		'<span class="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-action hover:bg-action-dark text-white text-sm font-bold transition">Ver <i data-lucide="arrow-right" class="w-4 h-4"></i></span>' +
		'</div></div></a>'
	);
}
