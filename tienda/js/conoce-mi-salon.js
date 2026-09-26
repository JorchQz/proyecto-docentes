/*
	Página de presentación de Mi Salón (tienda/conoce-mi-salon.html; decisión de Jorge, 2026-09-26).
	Publicada pero OCULTA: sin enlaces desde la tienda ni desde ningún menú, con noindex. Ver el
	comentario del <head> de la página para saber dónde irán los enlaces cuando se lance.

	═══════════════════════════════════════════════════════════════════════════════════════════
	PRECIO DE MI SALÓN: el ÚNICO lugar donde se configura (modelo decidido: suscripción por
	trimestre o por ciclo escolar).

	Cómo llenarlo cuando Jorge dé el precio:
	  trimestre  precio en pesos de un trimestre, como número sin signo ni comas (por ejemplo 149).
	  ciclo      precio en pesos del ciclo escolar completo (por ejemplo 399).
	  compra     a dónde lleva el botón de compra, relativo a tienda/ (por ejemplo
	             "checkout.html?producto=mi-salon"). Al enlace se le agrega "plan=trimestre" o
	             "plan=ciclo" para que la compra sepa cuál eligió.
	Reglas:
	  - Un precio en null (o que no sea un número mayor que 0) muestra "Precio por anunciar" en su
	    tarjeta y NO muestra botón de compra.
	  - El botón de compra solo aparece con precio Y enlace de compra.
	  - Mientras los dos precios sean null, en su lugar se ofrece "Avísame cuando esté disponible"
	    (tabla interes_secciones, sección "mi_salon").
	  - A una cuenta que ya tiene Mi Salón no se le ofrece comprar: ve "Ir a Mi Salón".
	Probado en pruebas/presentaciones.test.js.
	═══════════════════════════════════════════════════════════════════════════════════════════
*/
var PRECIOS_MI_SALON = {
	trimestre: null,
	ciclo: null,
	compra: null,
};

var ConoceMiSalon = (function () {
	var PLANES = [
		{ clave: "trimestre", titulo: "Por trimestre", periodo: "por trimestre", detalle: "Paga un trimestre a la vez." },
		{ clave: "ciclo", titulo: "Ciclo escolar", periodo: "por ciclo escolar", detalle: "Los tres trimestres del ciclo en un solo pago." },
	];

	function precioValido(v) {
		return typeof v === "number" && isFinite(v) && v > 0;
	}

	// "$149" o "$149.50", en pesos mexicanos
	function formatoPrecio(n) {
		var entero = Math.round(n * 100) % 100 === 0;
		try {
			return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 }).format(n);
		} catch (_) {
			return "$" + (entero ? String(Math.round(n)) : n.toFixed(2));
		}
	}

	function enlaceCompra(base, plan) {
		if (typeof base !== "string" || !base.trim()) return null;
		base = base.trim();
		return base + (base.indexOf("?") === -1 ? "?" : "&") + "plan=" + plan;
	}

	// Lo que muestra cada tarjeta de precio. `conAcceso`: la cuenta ya tiene Mi Salón.
	function planes(cfg, conAcceso) {
		cfg = cfg || {};
		return PLANES.map(function (p) {
			var precio = precioValido(cfg[p.clave]) ? cfg[p.clave] : null;
			return {
				clave: p.clave,
				titulo: p.titulo,
				detalle: p.detalle,
				precio: precio,
				texto: precio === null ? "Precio por anunciar" : formatoPrecio(precio),
				periodo: precio === null ? "" : p.periodo,
				compra: precio === null || conAcceso ? null : enlaceCompra(cfg.compra, p.clave),
			};
		});
	}

	function hayPrecio(cfg) {
		cfg = cfg || {};
		return precioValido(cfg.trimestre) || precioValido(cfg.ciclo);
	}

	// ¿Se ofrece "Avísame cuando esté disponible"? Solo sin ningún precio y sin acceso.
	function ofrecerAviso(cfg, conAcceso) {
		return !conAcceso && !hayPrecio(cfg);
	}

	return { precioValido: precioValido, formatoPrecio: formatoPrecio, enlaceCompra: enlaceCompra, planes: planes, hayPrecio: hayPrecio, ofrecerAviso: ofrecerAviso };
})();
if (typeof module !== "undefined" && module.exports) module.exports = { PRECIOS_MI_SALON: PRECIOS_MI_SALON, ConoceMiSalon: ConoceMiSalon }; // pruebas en node

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", function () {
	var raiz = document.documentElement;

	function esc(s) {
		return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	// Tarjetas de precio (sección "Cómo adquirirlo")
	function pintarPrecios(conAcceso) {
		var caja = document.getElementById("msPlanes");
		if (!caja) return;
		caja.innerHTML = ConoceMiSalon.planes(PRECIOS_MI_SALON, conAcceso).map(function (p, i) {
			var destacado = p.clave === "ciclo";
			var fondo = destacado ? "board-tex text-white shadow-xl" : "bg-paper border border-line";
			var sub = destacado ? "text-white/75" : "text-mute";
			var precio = p.precio === null
				? '<p class="mt-5 text-[22px] font-extrabold ' + (destacado ? "text-white" : "text-ink") + '" data-precio="pendiente">' + esc(p.texto) + "</p>"
				: '<p class="mt-5" data-precio="' + p.precio + '"><span class="text-[34px] font-black tracking-tight ' + (destacado ? "text-white" : "text-ink") + '">' + esc(p.texto) + '</span> <span class="' + sub + '">' + esc(p.periodo) + "</span></p>";
			var boton = p.compra
				? '<a href="' + esc(p.compra) + '" data-compra="' + p.clave + '" class="mt-6 inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-action hover:bg-action-dark text-white font-bold transition">Suscribirme ' + (p.clave === "ciclo" ? "por el ciclo" : "por trimestre") + ' <i data-lucide="arrow-right" class="w-5 h-5"></i></a>'
				: "";
			return '<div class="reveal in lift rounded-3xl p-7 flex flex-col ' + fondo + '"' + (i ? ' style="transition-delay:.06s"' : "") + ">" +
				'<h3 class="font-bold text-lg">' + esc(p.titulo) + "</h3>" +
				'<p class="mt-1 text-sm ' + sub + '">' + esc(p.detalle) + "</p>" +
				precio + boton + "</div>";
		}).join("");
		if (window.Tienda) Tienda.iconos();
	}

	function aplicarAcceso(conAcceso) {
		raiz.classList.toggle("ms-acceso", !!conAcceso);
		pintarPrecios(conAcceso);
		var aviso = document.getElementById("msAvisoBloque");
		if (aviso) aviso.classList.toggle("hidden", !ConoceMiSalon.ofrecerAviso(PRECIOS_MI_SALON, conAcceso));
	}

	// Primer pintado: con la pista del <head> (ms-acceso) y los precios de la configuración
	aplicarAcceso(raiz.classList.contains("ms-acceso"));

	if (!window.Tienda) return;
	Tienda.montarNav("", {
		// En el mismo orden en que aparecen abajo
		anchors: [
			{ href: "#que-es", label: "Qué es" },
			{ href: "#para-que", label: "Para qué sirve" },
			{ href: "#usar", label: "Cómo se usa" },
			{ href: "#adquirir", label: "Cómo adquirirlo" },
			{ href: "#preguntas", label: "Preguntas" },
		],
		seccion: "salon",
	}).then(function (session) {
		Tienda.iconos();
		if (!session) { aplicarAcceso(false); return null; }
		return Tienda.tieneSaas(session).then(aplicarAcceso);
	}).then(function () {
		// "Avísame cuando esté disponible" solo mientras no haya precio (y sin acceso)
		var bloque = document.getElementById("msAvisoBloque");
		if (bloque && !bloque.classList.contains("hidden") && window.InteresSeccion) {
			return InteresSeccion.montar({
				seccion: "mi_salon",
				pagina: "conoce-mi-salon.html",
				cajas: document.querySelectorAll("[data-interes-caja]"),
				textos: {
					pedir: "Avísame cuando esté disponible",
					hecho: "Listo. Te avisaremos a tu correo cuando Mi Salón esté disponible.",
				},
			});
		}
		return null;
	}).catch(function () {});
	Tienda.revelar();
});
