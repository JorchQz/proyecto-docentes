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
	renderDestacados(prods);
}

function minPrecio(prods, filtro) {
	var arr = prods.filter(filtro)
		.map(function (p) { return p.precio_pdf != null ? Number(p.precio_pdf) : Infinity; })
		.filter(isFinite);
	return arr.length ? Math.min.apply(null, arr) : null;
}

function llenarPrecios(prods) {
	setPrecio("precioTrim", minPrecio(prods, function (p) { return p.organizacion === "completa" && p.tipo_paquete === "trimestre"; }), "por grado y trimestre", false);
	setPrecio("precioCiclo", minPrecio(prods, function (p) { return p.organizacion === "completa" && p.tipo_paquete === "ciclo"; }), "el ciclo completo", true);
	setPrecio("precioMulti", minPrecio(prods, function (p) { return p.organizacion === "multigrado"; }), "2 o 3 grados", false);
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
	Tienda.iconos();
}

function cardHtml(g) {
	var esMulti = g.org === "multigrado";
	var esc = Tienda.esc, money = Tienda.formatMoney;
	var titulo = esMulti ? ("Multigrado " + comboDisplay(g.combo)) : (g.grado + "° Primaria");
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
		badge = '<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">' + esc(g.modalidad === "bidocente" ? "Bidocente" : "Tridocente") + '</span>';
	}

	return (
		'<a href="' + href + '" class="prod-card bg-white border border-line rounded-3xl overflow-hidden flex flex-col">' +
		'<div class="relative"><div class="ph h-44" style="border-radius:0">' + esc(titulo) + ' · portada</div>' + badge + '</div>' +
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
