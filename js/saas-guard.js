/*
	Candado de acceso al SaaS.

	El SaaS completo permanece cerrado mientras no esté terminado: solo pueden
	entrar las cuentas con perfiles.activo_saas = true. El resto (incluidos los
	usuarios que solo compran en la tienda) se redirige fuera.

	Uso: incluir este script en cada página protegida del SaaS, JUSTO DESPUÉS de
	js/supabase.js y js/lectura.js, y ANTES del script propio de la página:

		<script src="js/supabase.js"></script>
		<script src="js/lectura.js"></script>
		<script src="js/saas-guard.js"></script>
		<script src="js/dashboard.js"></script>

	Reglas (lee perfiles.activo_saas y la columna calculada perfiles.mi_salon en UNA consulta):
	  - Sin sesión            → tienda/login.html
	  - Sesión que no ve Mi Salón → tienda/catalogo.html
	  - Sesión que ve Mi Salón → pasa. La ve con activo_saas (el piloto, como siempre) o, desde
	    b21 (spec 2026-09-26), con acceso piloto o con Mi Salón abierto (interruptor de
	    lanzamiento jissez_config.mi_salon_abierto). Sin acceso vigente pasa igual, en SOLO
	    LECTURA: clase "ms-solo-lectura" en <html> y el estado en window.saasEstado
	    (js/mi-salon-acceso.js pinta el banner y deshabilita la captura; el servidor la rechaza)
	  - No se pudo leer        → aviso "No se pudo comprobar tu acceso" y la página se detiene
	  - Sin red o error 5xx al comprobar la sesión → aviso común de js/lectura.js (no es
	    "sin sesión": la maestra no sale); cualquier otra excepción → el mismo aviso de acceso

	Dentro de /salon/ (la app instalable "Jissez MS", docs/PWA-MI-SALON.md):
	  - el login se queda en /salon/ (relativo: /salon/tienda/login; en iPhone la sesión de la
	    app solo existe dentro de su alcance) y regresa a la página que se estaba abriendo
	    (?next=../hoy.html, con ".html": el login solo acepta esas rutas);
	  - una cuenta sin acceso va al catálogo de siempre, fuera de /salon/ (la tienda no es
	    parte de la app).
	Fuera de /salon/ todo sigue como antes.
*/

(function saasGuard() {
	var LOGIN_URL = "tienda/login.html";
	var TIENDA_URL = "tienda/catalogo.html";
	if (/^\/salon\//.test(window.location.pathname)) {
		var pagina = (window.location.pathname.split("/").pop() || "").replace(/\.html$/, "");
		if (!/^[a-z0-9_\-]+$/i.test(pagina) || pagina === "index") pagina = "hoy";
		LOGIN_URL = "tienda/login.html?next=" + encodeURIComponent("../" + pagina + ".html" + window.location.search + window.location.hash);
		TIENDA_URL = "/tienda/catalogo.html";
	}

	// Se cumple SOLO cuando el acceso quedó confirmado (en los demás casos nunca): el selector
	// de secciones guarda con ella la última sección y portal.html redirige sin adelantarse.
	var resolverAcceso = null;
	window.saasAcceso = new Promise(function (resolver) { resolverAcceso = resolver; });
	// El estado del acceso (perfiles.mi_salon, supabase/mi_salon_b21_acceso_2026-09.sql): vigente,
	// vence, solo lectura... o null si la base aún no lo tiene. Se cumple junto con saasAcceso;
	// lo usa js/mi-salon-acceso.js (banner, solo lectura, Mi cuenta).
	var resolverEstado = null;
	window.saasEstado = new Promise(function (resolver) { resolverEstado = resolver; });
	window.MiSalonEstado = null;

	// Oculta la página hasta validar, para no mostrar el SaaS ni un instante a
	// quien no debe verlo. Se restaura solo si el acceso es válido.
	var rootEl = document.documentElement;
	var prevVisibility = rootEl.style.visibility;
	rootEl.style.visibility = "hidden";

	function expulsar(url) {
		window.location.replace(url);
	}

	function permitir(estado) {
		window.MiSalonEstado = estado || null;
		// Sin acceso vigente: la clase va antes de mostrar la página (sin parpadeo de botones)
		if (estado && estado.vigente === false) rootEl.classList.add("ms-solo-lectura");
		rootEl.style.visibility = prevVisibility || "";
		resolverAcceso(true);
		resolverEstado(estado || null);
	}

	/*
		¿Ve Mi Salón? (decisión de Jorge, 2026-09-26: interruptor de lanzamiento)
		  - activo_saas = true: sí, como siempre (el piloto y las cuentas QA);
		  - si no, el estado del servidor (perfiles.mi_salon.visible): acceso piloto, o Mi Salón
		    abierto (jissez_config.mi_salon_abierto). Con Mi Salón abierto toda cuenta entra; sin
		    acceso vigente, en solo lectura.
		Probado en pruebas/mi-salon-acceso.test.js.
	*/
	function veMiSalon(fila) {
		if (!fila) return false;
		if (fila.activo_saas === true) return true;
		return !!(fila.mi_salon && typeof fila.mi_salon === "object" && fila.mi_salon.visible === true);
	}
	window.saasVeMiSalon = veMiSalon;

	// La base aún no tiene la columna calculada perfiles.mi_salon (el frontend se publicó antes que
	// la migración b21): se vuelve a leer solo activo_saas, como antes
	function faltaColumnaEstado(error) {
		var t = String((error && error.message) || "") + " " + String((error && error.details) || "") + " " + String((error && error.hint) || "");
		return !!error && /mi_salon/.test(t) && (error.code === "42703" || error.code === "PGRST200" || error.code === "PGRST204" || /column|columna|schema cache/i.test(t));
	}

	// Lo que se supo del acceso, con la misma clave que la tienda (Tienda.recordarSaas en
	// tienda/js/tienda-common.js): en la pestaña "1" o "0" y, con acceso, la pista del
	// dispositivo. Con ella la tienda aparta desde el principio el espacio del selector de
	// secciones y su encabezado no brinca. Solo decide eso; no da acceso a nada.
	function recordarAcceso(uid, si) {
		var clave = "jissez.saas." + uid;
		try { window.sessionStorage.setItem(clave, si ? "1" : "0"); } catch (_) {}
		try {
			if (si) window.localStorage.setItem(clave, "1");
			else window.localStorage.removeItem(clave);
		} catch (_) {}
	}

	// No se pudo comprobar el acceso (falló la lectura): ni se deja pasar ni se manda a la
	// tienda como si la cuenta no tuviera acceso; se dice y se ofrece reintentar.
	// Con la capa común (js/lectura.js) además se DETIENE la página: su script ya arrancó en
	// paralelo y, si se borrara el contenido, tronaría al buscar sus elementos; en cambio se
	// oculta todo, y ninguna lectura ni escritura suya vuelve a salir.
	function sinComprobar(error) {
		if (window.Lectura) {
			window.Lectura.detenerPagina(error || null, {
				todo: true,
				mostrar: true,
				titulo: "No se pudo comprobar tu acceso",
				texto: "Revisa tu conexión e intenta de nuevo.",
			});
			return;
		}
		// Sin la capa (una página que no carga js/lectura.js): se OCULTA el contenido en vez de
		// borrarlo, para que el script de la página no truene buscando sus elementos
		function pintar() {
			Array.prototype.forEach.call(document.body.children, function (el) {
				if (el.tagName !== "SCRIPT") el.style.display = "none";
			});
			var caja = document.createElement("div");
			caja.setAttribute("role", "alert");
			caja.innerHTML = "<div style='max-width:28rem;margin:4rem auto;padding:1.5rem;font-family:system-ui,sans-serif;text-align:center'>" +
				"<p style='font-size:1.1rem;font-weight:600;color:#1f2937;margin-bottom:.5rem'>No se pudo comprobar tu acceso</p>" +
				"<p style='color:#4b5563;margin-bottom:1rem'>Revisa tu conexión e intenta de nuevo.</p>" +
				"<button type='button' onclick='location.reload()' style='min-height:44px;padding:0 1.25rem;border-radius:.75rem;background:#2563eb;color:#fff;font-weight:600;border:0'>Reintentar</button></div>";
			document.body.appendChild(caja);
			rootEl.style.visibility = prevVisibility || "";
		}
		if (document.body) pintar(); else document.addEventListener("DOMContentLoaded", pintar);
	}

	if (!window.sb) {
		// Sin cliente no se puede validar: por seguridad, fuera.
		expulsar(LOGIN_URL);
		return;
	}

	var uid = null;
	window.sb.auth
		.getUser()
		.then(function (res) {
			var user = res && res.data ? res.data.user : null;
			// Sin red o 5xx no es "sin sesión" (con la capa común esto ya se detuvo antes)
			if (res && res.error && window.Lectura && window.Lectura.errorDeRed(res.error)) {
				sinComprobar(res.error);
				return null;
			}
			if ((res && res.error) || !user) {
				expulsar(LOGIN_URL);
				return null;
			}
			// Por fuera de la capa común: si la página ya se detuvo, esta lectura no debe
			// quedar colgada (la página seguiría oculta)
			// error-revisado-en: perf.error
			uid = user.id;
			function leer(columnas) {
				return (window.Lectura ? window.Lectura.fromDirecto("perfiles") : window.sb.from("perfiles"))
					.select(columnas)
					.eq("id", user.id)
					.maybeSingle();
			}
			return leer("activo_saas, mi_salon").then(function (perf) {
				if (perf && perf.error && faltaColumnaEstado(perf.error)) return leer("activo_saas");
				return perf;
			});
		})
		.then(function (perf) {
			if (!perf) { return; } // ya redirigido (sin sesión)
			if (perf.error) { sinComprobar(perf.error); return; }
			var activo = veMiSalon(perf.data);
			if (uid) recordarAcceso(uid, activo);
			if (activo) {
				permitir(perf.data && perf.data.mi_salon && typeof perf.data.mi_salon === "object" ? perf.data.mi_salon : null);
			} else {
				expulsar(TIENDA_URL);
			}
		})
		.catch(function (error) {
			// Una excepción no es "sin sesión" (eso es user null, arriba): ni se deja pasar
			// ni se saca a la maestra; se avisa y se ofrece reintentar
			sinComprobar(error);
		});
})();
