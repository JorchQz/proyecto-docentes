/*
	mi-salon-acceso.js — El acceso a Mi Salón en la app: modo solo lectura, banner de Inicio,
	estado en Mi cuenta y aviso cuando la base rechaza una escritura por falta de acceso
	(spec de Jorge 2026-09-26, §5.4 y §5.5; supabase/mi_salon_b21_acceso_2026-09.sql).

	La regla la pone el SERVIDOR: sin acceso vigente, las políticas restrictivas rechazan toda
	escritura del SaaS (error 42501 con la pista "mi_salon_solo_lectura"). Aquí solo se muestra:
	  - el candado (js/saas-guard.js) lee el estado junto con activo_saas (perfiles.mi_salon) y lo
	    deja en window.saasEstado (promesa) y window.MiSalonEstado;
	  - sin acceso vigente, <html> lleva la clase "ms-solo-lectura" y:
	      · Inicio (#avisoAcceso): el banner fijo "Tu acceso terminó el [fecha]. Tus datos están
	        guardados. Renueva para seguir capturando." con el botón a la compra;
	      · Mi cuenta (#estadoAcceso): el estado del acceso (también con acceso vigente);
	      · las demás páginas: un aviso corto arriba del contenido;
	      · los controles de captura se ven deshabilitados y, al tocarlos, explican por qué. Cada
	        página los marca: data-captura (un botón o campo) o data-captura-zona (un bloque de
	        captura completo; dentro, data-lectura deja libre un control que solo muestra).
	  - si la base rechaza una escritura por solo lectura (evento "jissez:solo-lectura" que lanza
	    js/supabase.js), se avisa y la página pasa a solo lectura aunque el estado leído al
	    cargar dijera otra cosa (el acceso venció con la página abierta).
	Sin estado (base sin migrar, lectura fallida) no se asume solo lectura: el servidor decide.

	Botón de compra: mientras no exista la compra de Mi Salón (la hace el constructor de cobros),
	lleva a la página de presentación de Mi Salón en la tienda (MiSalonAcceso.COMPRA).
	Se carga en cada página del SaaS justo después de js/saas-guard.js.
	Las reglas puras se prueban en pruebas/mi-salon-acceso.test.js.
*/
var MiSalonAcceso = (function () {
	var PISTA = "mi_salon_solo_lectura";
	var COMPRA = "tienda/conoce-mi-salon.html";
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
		"septiembre", "octubre", "noviembre", "diciembre"];
	var ORIGEN = {
		gratis_t1: "Primer trimestre gratis",
		pago: "Acceso pagado",
		piloto: "Piloto de Mi Salón",
		regalo_admin: "Acceso otorgado por Jissez",
	};

	// ── Reglas puras ─────────────────────────────────────────────────────────────
	// "2026-12-18" → { d: 18, m: 12, a: 2026 } (sin pasar por Date: nada de husos horarios)
	function partes(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		return m ? { a: +m[1], m: +m[2], d: +m[3] } : null;
	}
	// "18 de diciembre de 2026"
	function fechaLarga(iso) {
		var p = partes(iso);
		return p ? p.d + " de " + MESES[p.m - 1] + " de " + p.a : "";
	}
	// "18 de diciembre" (sin año)
	function fechaCorta(iso) {
		var p = partes(iso);
		return p ? p.d + " de " + MESES[p.m - 1] : "";
	}

	// Solo lectura: el servidor dijo que NO hay acceso vigente. Sin estado no se asume nada.
	function soloLectura(estado) {
		return !!(estado && typeof estado === "object" && estado.vigente === false);
	}

	// ¿El error de una escritura es el candado de solo lectura?
	function esErrorSoloLectura(e) {
		if (!e) return false;
		if (e.hint === PISTA) return true;
		return typeof e.message === "string" && e.message.indexOf(PISTA) !== -1;
	}

	// Banner de Inicio (spec §5.4). Una cuenta que nunca tuvo acceso (creada después del periodo
	// gratis, sin compra) no tiene "terminó el": se le invita a comprar.
	function textoBanner(estado) {
		if (!soloLectura(estado)) return null;
		if (estado.vence) {
			return {
				titulo: "Tu acceso terminó el " + fechaLarga(estado.vence) + ".",
				texto: "Tus datos están guardados. Renueva para seguir capturando.",
				boton: "Renovar mi acceso",
			};
		}
		return {
			titulo: "Tu cuenta está en modo solo lectura.",
			texto: "Puedes ver Mi Salón. Para capturar asistencia, trabajos y calificaciones, elige tu acceso.",
			boton: "Ver cómo tener acceso",
		};
	}

	// Aviso corto de las demás páginas
	function textoCorto(estado) {
		if (!soloLectura(estado)) return null;
		return estado.vence
			? "Solo lectura desde el " + fechaLarga(estado.solo_lectura_desde || estado.vence) + ": puedes ver, imprimir y exportar. Para capturar, renueva tu acceso."
			: "Solo lectura: puedes ver, imprimir y exportar. Para capturar, elige tu acceso.";
	}

	// Lo que se explica al tocar un control de captura en solo lectura
	function textoBloqueo(estado) {
		return estado && estado.vence
			? "Tu acceso terminó el " + fechaLarga(estado.vence) + ". Tus datos están guardados; para seguir capturando, renueva tu acceso."
			: "Tu cuenta está en modo solo lectura. Para capturar, elige tu acceso.";
	}

	// Mi cuenta: { titulo, detalle, origen, solo } o null sin estado
	function textoCuenta(estado) {
		if (!estado || typeof estado !== "object") return null;
		var origen = ORIGEN[estado.origen] || "";
		if (estado.vigente) {
			var hasta = estado.vence ? "Acceso completo hasta el " + fechaLarga(estado.vence) + "." : "Acceso completo.";
			return {
				titulo: "Tu acceso está activo",
				detalle: hasta + (estado.vence ? " Desde el " + fechaLarga(estado.solo_lectura_desde) + " tu cuenta pasa a solo lectura si no renuevas; tus datos se quedan guardados." : ""),
				origen: origen,
				solo: false,
			};
		}
		if (estado.vence) {
			return {
				titulo: "Tu cuenta está en modo solo lectura",
				detalle: "Tu acceso terminó el " + fechaLarga(estado.vence) + ". Puedes ver, imprimir y exportar todo; tus datos están guardados. Renueva para seguir capturando.",
				origen: origen,
				solo: true,
			};
		}
		return {
			titulo: "Tu cuenta está en modo solo lectura",
			detalle: "Todavía no tienes un acceso a Mi Salón. Puedes verlo; para capturar, elige tu acceso.",
			origen: "",
			solo: true,
		};
	}

	// A dónde lleva el botón de compra: desde la raíz; dentro de la app instalable (/salon/) la
	// tienda está fuera de la app
	function urlCompra(pathname) {
		return /^\/salon\//.test(String(pathname || "")) ? "/" + COMPRA : COMPRA;
	}

	// ── Interfaz ─────────────────────────────────────────────────────────────────
	var estadoActual = null;
	var CSS =
		"html.ms-solo-lectura [data-captura]," +
		"html.ms-solo-lectura [data-captura-zona] :is(button,input,select,textarea,[role=button],[contenteditable=true]):not([data-lectura]){opacity:.5;cursor:not-allowed}" +
		".ms-aviso-sl{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;border:1px solid #fcd34d;background:#fffbeb;color:#78350f;border-radius:.75rem;padding:.625rem 1rem;font-size:.875rem;line-height:1.4}" +
		".ms-aviso-sl a{display:inline-flex;align-items:center;min-height:44px;font-weight:600;color:#1e3a8a;text-decoration:underline}" +
		".ms-toast-sl{position:fixed;left:50%;bottom:calc(16px + var(--jz-sec-abajo,0px) + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:60;max-width:min(560px,calc(100vw - 32px));width:max-content;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .75rem;background:#1c2434;color:#fff;border-radius:.875rem;padding:.625rem 1rem;box-shadow:0 12px 32px -12px rgba(0,0,0,.45);font-size:.875rem;line-height:1.4}" +
		".ms-toast-sl a{display:inline-flex;align-items:center;min-height:44px;color:#a7f3d0;font-weight:600;text-decoration:underline}" +
		".ms-toast-sl[hidden]{display:none}" +
		"@media print{.ms-aviso-sl,.ms-toast-sl,#avisoAcceso{display:none!important}}";

	function estilos() {
		if (document.getElementById("ms-acceso-css")) return;
		var st = document.createElement("style");
		st.id = "ms-acceso-css";
		st.textContent = CSS;
		document.head.appendChild(st);
	}

	function esc(s) {
		return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	var ICONO_CANDADO = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
	var ICONO_ESCUDO = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>';

	function enlaceCompra(texto, clase) {
		var enApp = false;
		try { enApp = !!(window.AppInstalada && window.AppInstalada.modoApp && window.AppInstalada.modoApp()); } catch (_) {}
		return '<a href="' + esc(urlCompra(window.location.pathname)) + '"' + (enApp ? ' target="_blank" rel="noopener"' : "") +
			(clase ? ' class="' + clase + '"' : "") + ">" + esc(texto) + "</a>";
	}

	// Banner fijo de Inicio: no se puede cerrar mientras dure el solo lectura
	function pintarBanner(el, estado) {
		var t = textoBanner(estado);
		if (!t) { el.classList.add("hidden"); el.innerHTML = ""; return; }
		el.className = "rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4";
		el.setAttribute("role", "status");
		el.innerHTML =
			'<div class="shrink-0 w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">' + ICONO_CANDADO + "</div>" +
			'<div class="flex-1 min-w-0"><p class="font-semibold text-amber-950">' + esc(t.titulo) + "</p>" +
			'<p class="text-sm text-amber-900 mt-0.5">' + esc(t.texto) + "</p></div>" +
			enlaceCompra(t.boton, "shrink-0 inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-blue-800 text-white text-sm font-semibold hover:bg-blue-900");
	}

	// Mi cuenta: el estado del acceso (siempre que haya estado)
	function pintarCuenta(el, estado) {
		var t = textoCuenta(estado);
		if (!t) { el.classList.add("hidden"); return; }
		el.classList.remove("hidden");
		el.innerHTML =
			'<div class="flex items-start gap-3">' +
			'<div class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ' + (t.solo ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700") + '">' + (t.solo ? ICONO_CANDADO : ICONO_ESCUDO) + "</div>" +
			'<div class="flex-1 min-w-0">' +
			'<h2 class="text-lg font-bold text-gray-800">Tu acceso a Mi Salón</h2>' +
			'<p class="mt-1 font-semibold ' + (t.solo ? "text-amber-900" : "text-emerald-800") + '">' + esc(t.titulo) + "</p>" +
			(t.origen ? '<p class="text-sm text-gray-600 mt-0.5">' + esc(t.origen) + "</p>" : "") +
			'<p class="text-sm text-gray-600 mt-2">' + esc(t.detalle) + "</p>" +
			(t.solo ? '<div class="mt-3">' + enlaceCompra(estado.vence ? "Renovar mi acceso" : "Ver cómo tener acceso",
				"inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-blue-800 text-white text-sm font-semibold hover:bg-blue-900") + "</div>" : "") +
			"</div></div>";
	}

	// Aviso corto al principio del contenido de las demás páginas
	function pintarAvisoCorto(estado) {
		var ya = document.getElementById("msAvisoSoloLectura");
		var t = textoCorto(estado);
		if (!t) { if (ya) ya.remove(); return; }
		if (document.getElementById("avisoAcceso") || document.getElementById("estadoAcceso")) return;
		var cont = document.querySelector("main") || document.body;
		var el = ya || document.createElement("div");
		el.id = "msAvisoSoloLectura";
		el.className = "ms-aviso-sl";
		el.setAttribute("role", "status");
		el.style.marginBottom = "1rem";
		el.innerHTML = ICONO_CANDADO + "<span>" + esc(t) + "</span>" + enlaceCompra(estado.vence ? "Renovar" : "Ver cómo tener acceso");
		if (!ya) cont.insertBefore(el, cont.firstChild);
	}

	var toastTimer = null;
	function avisar(texto) {
		estilos();
		var el = document.getElementById("msToastSoloLectura");
		if (!el) {
			el = document.createElement("div");
			el.id = "msToastSoloLectura";
			el.className = "ms-toast-sl";
			el.setAttribute("role", "status");
			el.setAttribute("aria-live", "polite");
			document.body.appendChild(el);
		}
		el.innerHTML = "<span>" + esc(texto) + "</span>" + enlaceCompra("Ver opciones");
		el.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { el.hidden = true; }, 7000);
	}

	// ¿El elemento es un control de captura bloqueado? (en solo lectura)
	function controlBloqueado(t) {
		if (!t || !t.closest) return null;
		if (t.closest("[data-lectura]")) return null;
		var directo = t.closest("[data-captura]");
		if (directo) return directo;
		var zona = t.closest("[data-captura-zona]");
		if (!zona) return null;
		if (t.closest("a[href]")) return null; // navegar sí se puede
		return t.closest("button,input,select,textarea,label,[role=button],[contenteditable=true]");
	}

	function alEvento(e) {
		if (!document.documentElement.classList.contains("ms-solo-lectura")) return;
		if (e.type === "keydown" && (e.key === "Tab" || e.key === "Escape" || e.key === "Shift")) return;
		var c = controlBloqueado(e.target);
		if (!c) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.stopImmediatePropagation) e.stopImmediatePropagation();
		if (e.type === "click" || e.type === "submit" || (e.type === "keydown" && (e.key === "Enter" || e.key === " "))) avisar(textoBloqueo(estadoActual));
	}

	// Marca los controles de captura para el lector de pantalla
	function marcarDeshabilitados(raiz) {
		if (!document.documentElement.classList.contains("ms-solo-lectura")) return;
		var sel = "[data-captura],[data-captura-zona] button:not([data-lectura]),[data-captura-zona] input:not([data-lectura]),[data-captura-zona] select:not([data-lectura]),[data-captura-zona] textarea:not([data-lectura])";
		var lista = (raiz && raiz.querySelectorAll) ? raiz.querySelectorAll(sel) : [];
		Array.prototype.forEach.call(lista, function (el) {
			if (el.closest("[data-lectura]")) return;
			el.setAttribute("aria-disabled", "true");
			if (!el.getAttribute("title")) el.setAttribute("title", "Solo lectura: tu acceso no está activo");
		});
	}

	var observador = null;
	function aplicar(estado) {
		estadoActual = estado || null;
		var solo = soloLectura(estado);
		document.documentElement.classList.toggle("ms-solo-lectura", solo);
		estilos();
		var banner = document.getElementById("avisoAcceso");
		if (banner) pintarBanner(banner, estado);
		var cuenta = document.getElementById("estadoAcceso");
		if (cuenta) pintarCuenta(cuenta, estado);
		pintarAvisoCorto(estado);
		if (solo) {
			marcarDeshabilitados(document);
			if (!observador && typeof MutationObserver !== "undefined") {
				observador = new MutationObserver(function (cambios) {
					cambios.forEach(function (c) {
						Array.prototype.forEach.call(c.addedNodes || [], function (n) { if (n.nodeType === 1) marcarDeshabilitados(n.parentNode || n); });
					});
				});
				observador.observe(document.body, { childList: true, subtree: true });
			}
		}
	}

	function iniciar() {
		["click", "submit", "keydown", "beforeinput", "input", "change", "paste", "drop", "mousedown"].forEach(function (tipo) {
			document.addEventListener(tipo, alEvento, { capture: true, passive: false });
		});
		// La base rechazó una escritura por solo lectura (js/supabase.js): se avisa y la página
		// pasa a solo lectura aunque al cargar el acceso estuviera vigente
		window.addEventListener("jissez:solo-lectura", function () {
			var e = estadoActual && typeof estadoActual === "object" ? Object.assign({}, estadoActual, { vigente: false }) : { vigente: false };
			avisar(textoBloqueo(e));
			if (!soloLectura(estadoActual)) aplicar(e);
		});
		var p = window.saasEstado;
		if (p && typeof p.then === "function") {
			p.then(function (estado) {
				if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { aplicar(estado); });
				else aplicar(estado);
			}, function () {});
		}
	}

	if (typeof window !== "undefined" && typeof document !== "undefined" && document.addEventListener) iniciar();

	return {
		PISTA: PISTA,
		COMPRA: COMPRA,
		fechaLarga: fechaLarga,
		fechaCorta: fechaCorta,
		soloLectura: function (estado) { return soloLectura(arguments.length ? estado : estadoActual); },
		esErrorSoloLectura: esErrorSoloLectura,
		textoBanner: textoBanner,
		textoCorto: textoCorto,
		textoBloqueo: textoBloqueo,
		textoCuenta: textoCuenta,
		urlCompra: urlCompra,
		estado: function () { return estadoActual; },
		avisar: avisar,
		aplicar: aplicar,
	};
})();
if (typeof module !== "undefined" && module.exports) module.exports = MiSalonAcceso; // pruebas en node
