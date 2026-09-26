/* global InteresSeccion */
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
	  beneficioCompradores
	             texto del beneficio para quien ya compró planeaciones en Jissez, tal como se
	             mostrará en la página (por ejemplo "Tu primer trimestre de Mi Salón va sin
	             costo."), o null si no hay beneficio que anunciar.

	Forma del objeto:
	  { trimestre: número | null, ciclo: número | null, compra: "ruta.html?..." | null,
	    beneficioCompradores: "texto" | null }
	Reglas:
	  - Un precio en null (o que no sea un número mayor que 0) muestra "Precio por anunciar" en su
	    tarjeta y NO muestra botón de compra.
	  - El botón de compra solo aparece con precio Y enlace de compra.
	  - Mientras los dos precios sean null, en su lugar se ofrece "Avísame cuando esté disponible"
	    (tabla interes_secciones, sección "mi_salon").
	  - A una cuenta que ya tiene Mi Salón no se le ofrece comprar: ve "Ir a Mi Salón".
	  - Tarjeta "¿Ya compraste planeaciones en Jissez?": con beneficioCompradores, muestra ese
	    texto; sin él y sin ningún precio, el texto genérico ("tendrás un beneficio especial; te
	    lo diremos al lanzar"); sin él y CON precio, la tarjeta no aparece (ya se lanzó y no hay
	    beneficio que anunciar).
	Probado en pruebas/presentaciones.test.js.
	═══════════════════════════════════════════════════════════════════════════════════════════
*/
var PRECIOS_MI_SALON = {
	trimestre: null,
	ciclo: null,
	compra: null,
	beneficioCompradores: null,
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

	// Texto de la tarjeta de beneficio para quien ya compró planeaciones, o null si la tarjeta
	// no aparece (reglas en el comentario de PRECIOS_MI_SALON)
	var BENEFICIO_GENERICO = "Si ya compraste planeaciones en Jissez, tendrás un beneficio especial; te lo diremos al lanzar.";
	function beneficio(cfg) {
		cfg = cfg || {};
		var b = cfg.beneficioCompradores;
		if (typeof b === "string" && b.trim()) return b.trim();
		return hayPrecio(cfg) ? null : BENEFICIO_GENERICO;
	}

	/*
		Título y texto de "Cómo adquirirlo" según cuántos precios hay (R25b): con uno solo no se
		ofrece elegir y el título nombra solo ese plan; el otro sigue con "Precio por anunciar".
		Sin ningún precio, el modelo decidido (trimestre o ciclo), sin "Elige": aún no hay qué elegir.
	*/
	var CUENTA_TIENDA = "Con tu suscripción entras con la misma cuenta de la tienda.";
	function encabezado(cfg) {
		cfg = cfg || {};
		var t = precioValido(cfg.trimestre), c = precioValido(cfg.ciclo);
		if (t && c) return { titulo: "Suscripción por trimestre o por ciclo escolar.", texto: "Elige lo que te acomode. " + CUENTA_TIENDA };
		if (t) return { titulo: "Suscripción por trimestre.", texto: CUENTA_TIENDA + " El precio por ciclo escolar se anunciará pronto." };
		if (c) return { titulo: "Suscripción por ciclo escolar.", texto: CUENTA_TIENDA + " El precio por trimestre se anunciará pronto." };
		return { titulo: "Suscripción por trimestre o por ciclo escolar.", texto: CUENTA_TIENDA };
	}

	// ¿Se ofrece "Avísame cuando esté disponible"? Solo sin ningún precio y sin acceso.
	function ofrecerAviso(cfg, conAcceso) {
		return !conAcceso && !hayPrecio(cfg);
	}

	/*
		Mi Salón abierto (b21): ¿sigue el periodo gratis? `vence` es la fecha (AAAA-MM-DD) del
		periodo gratis en mi_salon_periodos; `ahora`, la fecha de hoy. Una cuenta creada hasta ese
		día recibe el acceso gratis; después ya no (decisión de Jorge, 2026-09-26: sin prueba).
	*/
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
	function hoyMexico(ahora) {
		try {
			return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
		} catch (_) {
			return ahora.toISOString().slice(0, 10);
		}
	}
	function gratisVigente(vence, ahora) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(vence || ""))) return false;
		return hoyMexico(ahora || new Date()) <= vence;
	}
	function textoGratis(vence) {
		var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(vence || ""));
		return m
			? "Crea tu cuenta y tendrás acceso completo a Mi Salón hasta el " + Number(m[3]) + " de " + MESES[Number(m[2]) - 1] + ", sin tarjeta."
			: "Crea tu cuenta y tendrás acceso completo a Mi Salón.";
	}

	return { precioValido: precioValido, formatoPrecio: formatoPrecio, enlaceCompra: enlaceCompra, planes: planes, hayPrecio: hayPrecio, ofrecerAviso: ofrecerAviso, beneficio: beneficio, encabezado: encabezado, BENEFICIO_GENERICO: BENEFICIO_GENERICO, gratisVigente: gratisVigente, textoGratis: textoGratis };
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

	// Tarjeta de beneficio para quien ya compró planeaciones. Sin beneficio, "Qué incluye" queda
	// solo, en una columna centrada.
	function pintarBeneficio() {
		var tarjeta = document.getElementById("msBeneficio");
		var texto = document.getElementById("msBeneficioTexto");
		var grid = document.getElementById("msIncluyeGrid");
		if (!tarjeta || !texto) return;
		var t = ConoceMiSalon.beneficio(PRECIOS_MI_SALON);
		if (t) texto.textContent = t;
		tarjeta.classList.toggle("hidden", !t);
		if (grid) {
			grid.classList.toggle("sm:grid-cols-2", !!t);
			grid.classList.toggle("max-w-3xl", !!t);
			grid.classList.toggle("max-w-xl", !t);
		}
	}

	function aplicarAcceso(conAcceso) {
		raiz.classList.toggle("ms-acceso", !!conAcceso);
		pintarPrecios(conAcceso);
		var aviso = document.getElementById("msAvisoBloque");
		if (aviso) aviso.classList.toggle("hidden", !ConoceMiSalon.ofrecerAviso(PRECIOS_MI_SALON, conAcceso));
	}

	// Título y texto de "Cómo adquirirlo" según cuántos precios hay (ConoceMiSalon.encabezado)
	function pintarEncabezado() {
		var e = ConoceMiSalon.encabezado(PRECIOS_MI_SALON);
		var titulo = document.getElementById("msPreciosTitulo");
		var texto = document.getElementById("msPreciosTexto");
		if (titulo) titulo.textContent = e.titulo;
		if (texto) texto.textContent = e.texto;
	}

	// Primer pintado: con la pista del <head> (ms-acceso) y los precios de la configuración
	pintarEncabezado();
	pintarBeneficio();
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
		if (!session) { aplicarAcceso(false); return false; }
		return Tienda.tieneSaas(session).then(function (si) { aplicarAcceso(si); return si; });
	}).then(function (conAcceso) {
		// Mi Salón abierto (b21): a quien aún no lo tiene se le ofrece crear su cuenta con el
		// primer trimestre gratis, en lugar del "Avísame", mientras dure el periodo gratis
		if (conAcceso || !Tienda.miSalonAbierto) return null;
		return Tienda.miSalonAbierto().then(function (abierto) {
			if (!abierto) return null;
			return window.sb.from("jissez_config").select("gratis_ciclo, gratis_periodo").eq("id", true).maybeSingle().then(function (c) {
				if (c.error || !c.data) return null;
				return window.sb.from("mi_salon_periodos").select("vence").eq("ciclo", c.data.gratis_ciclo).eq("periodo", c.data.gratis_periodo).maybeSingle();
			}).then(function (p) {
				var vence = p && !p.error && p.data ? p.data.vence : null;
				if (!ConoceMiSalon.gratisVigente(vence, new Date())) return;
				var bloque = document.getElementById("msAbiertoBloque");
				var texto = document.getElementById("msAbiertoTexto");
				var aviso = document.getElementById("msAvisoBloque");
				if (texto) texto.textContent = ConoceMiSalon.textoGratis(vence);
				if (bloque) bloque.classList.remove("hidden");
				if (aviso) aviso.classList.add("hidden");
				Tienda.iconos();
			});
		});
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
