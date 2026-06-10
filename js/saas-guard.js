/*
	Candado de acceso al SaaS.

	El SaaS completo permanece cerrado mientras no esté terminado: solo pueden
	entrar las cuentas con perfiles.activo_saas = true. El resto (incluidos los
	usuarios que solo compran en la tienda) se redirige fuera.

	Uso: incluir este script en cada página protegida del SaaS, JUSTO DESPUÉS de
	js/supabase.js y ANTES del script propio de la página:

		<script src="js/supabase.js"></script>
		<script src="js/saas-guard.js"></script>
		<script src="js/dashboard.js"></script>

	Reglas:
	  - Sin sesión            → tienda/login.html
	  - Sesión sin activo_saas → tienda/catalogo.html
	  - Sesión con activo_saas → pasa
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
			return window.sb
				.from("perfiles")
				.select("activo_saas")
				.eq("id", user.id)
				.maybeSingle();
		})
		.then(function (perf) {
			if (!perf) { return; } // ya redirigido (sin sesión)
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
