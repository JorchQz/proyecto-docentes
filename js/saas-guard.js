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

	Reglas:
	  - Sin sesión            → tienda/login.html
	  - Sesión sin activo_saas → tienda/catalogo.html
	  - Sesión con activo_saas → pasa
	  - No se pudo leer        → aviso "No se pudo comprobar tu acceso" y la página se detiene
*/

(function saasGuard() {
	var LOGIN_URL = "tienda/login.html";
	var TIENDA_URL = "tienda/catalogo.html";

	// Oculta la página hasta validar, para no mostrar el SaaS ni un instante a
	// quien no debe verlo. Se restaura solo si el acceso es válido.
	var rootEl = document.documentElement;
	var prevVisibility = rootEl.style.visibility;
	rootEl.style.visibility = "hidden";

	function expulsar(url) {
		window.location.replace(url);
	}

	function permitir() {
		rootEl.style.visibility = prevVisibility || "";
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

	window.sb.auth
		.getUser()
		.then(function (res) {
			var user = res && res.data ? res.data.user : null;
			if ((res && res.error) || !user) {
				expulsar(LOGIN_URL);
				return null;
			}
			// Por fuera de la capa común: si la página ya se detuvo, esta lectura no debe
			// quedar colgada (la página seguiría oculta)
			// error-revisado-en: perf.error
			return (window.Lectura ? window.Lectura.fromDirecto("perfiles") : window.sb.from("perfiles"))
				.select("activo_saas")
				.eq("id", user.id)
				.maybeSingle();
		})
		.then(function (perf) {
			if (!perf) { return; } // ya redirigido (sin sesión)
			if (perf.error) { sinComprobar(perf.error); return; }
			var activo = perf.data && perf.data.activo_saas === true;
			if (activo) {
				permitir();
			} else {
				expulsar(TIENDA_URL);
			}
		})
		.catch(function () {
			expulsar(LOGIN_URL);
		});
})();
