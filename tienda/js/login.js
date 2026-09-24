// Reglas puras del destino tras autenticar (probadas en pruebas/login-destino.test.js).
var LoginDestino = (function () {
	// ?next= a dónde ir tras autenticar. Si viene explícito (p. ej. desde
	// checkout) se respeta. Si no, el destino depende de activo_saas.
	//
	// SEGURIDAD: el valor va directo a location.href, así que solo se aceptan
	// rutas RELATIVAS a páginas .html locales (p. ej. "anexo.html?aula=3&pr=7"
	// o "../dashboard.html"). Se rechaza cualquier esquema (javascript:, http:),
	// "//host" y backslashes, que permitirían XSS (robo de sesión) u open redirect.
	function nextSeguro(raw) {
		if (!raw) return null;
		if (/^[a-z][a-z0-9+.\-]*:/i.test(raw)) return null; // tiene esquema
		if (/^\s*\/\//.test(raw)) return null;              // //host protocol-relative
		if (raw.indexOf("\\") !== -1) return null;          // backslash
		if (/^[.\/]*[a-z0-9_\-\/]+\.html([?#].*)?$/i.test(raw)) return raw;
		return null;
	}

	// Sin ?next=: las cuentas con el SaaS van a la pantalla principal de tres
	// partes (Mi Salón, Tienda, Sala de Maestros); el portal decide después si
	// Mi Salón abre el panel o el alta del grupo. El resto, al catálogo.
	// `perf` es la respuesta de perfiles; si la lectura falla se trata como sin
	// acceso (la tienda funciona igual y el portal no se ofrece).
	function porPerfil(perf) {
		var activo = !!(perf && !perf.error && perf.data && perf.data.activo_saas === true);
		return activo ? "../portal.html" : "catalogo.html";
	}

	return { nextSeguro: nextSeguro, porPerfil: porPerfil };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LoginDestino; // pruebas en node

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", function () {
	var form = document.getElementById("loginForm");
	var nombreField = document.getElementById("nombreField");
	var nombreInput = document.getElementById("nombre");
	var emailInput = document.getElementById("email");
	var passwordInput = document.getElementById("password");
	var submitBtn = form.querySelector("button[type='submit']");
	var toggleLink = document.getElementById("toggleLink");
	var subtitulo = document.getElementById("subtitulo");

	if (!window.sb) {
		showMessage("error", "No se pudo conectar. Recarga la página.");
		return;
	}

	var params = new URLSearchParams(location.search);
	var nextExplicito = LoginDestino.nextSeguro(params.get("next"));

	var mode = "login"; // 'login' | 'register'

	// Si ya hay sesión, saltar directo.
	Tienda.getSession().then(async function (session) {
		if (session) { location.href = await destino(session.user.id); }
	});

	// Decide a dónde llevar al usuario tras autenticar.
	async function destino(userId) {
		if (nextExplicito) { return nextExplicito; }
		// ¿Tiene el SaaS completo activado?
		var perf = await window.sb
			.from("perfiles")
			.select("activo_saas")
			.eq("id", userId)
			.maybeSingle();
		return LoginDestino.porPerfil(perf);
	}

	toggleLink.addEventListener("click", function (e) {
		e.preventDefault();
		mode = mode === "login" ? "register" : "login";
		updateModeUI();
		clearMessage();
	});

	// Recuperación de contraseña. El enlace del correo lleva a la página de
	// cambio con la sesión de recuperación ya establecida.
	var olvideLink = document.getElementById("olvideLink");
	if (olvideLink) {
		olvideLink.addEventListener("click", async function (e) {
			e.preventDefault();
			var correo = (emailInput.value || "").trim();
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
				showMessage("error", "Escribe tu correo arriba y vuelve a pulsar aquí.");
				emailInput.focus();
				return;
			}
			olvideLink.textContent = "Enviando...";
			// Vía propia en vez de resetPasswordForEmail: las plantillas de
			// Supabase llegaban en inglés y sus versiones personalizadas no se
			// aplicaban. Así el correo va en español y con la marca.
			var enviado = false;
			try {
				var resp = await fetch(Tienda.EDGE_BASE + "/recuperar-clave", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						email: correo,
						// Sin ".html": Cloudflare redirige esa ruta y es un salto de más.
						redirect_to: location.origin + "/reset-password",
					}),
				});
				enviado = resp.ok;
				if (!enviado) {
					var cuerpo = await resp.json().catch(function () { return {}; });
					showMessage("error", cuerpo.error || "No se pudo enviar el correo. Inténtalo en unos minutos.");
				}
			} catch (_) {
				showMessage("error", "No hay conexión. Revisa tu internet e inténtalo de nuevo.");
			}
			olvideLink.textContent = "¿Olvidaste tu contraseña?";
			if (!enviado) { return; }
			// Respuesta igual exista o no la cuenta: decir "ese correo no está
			// registrado" revelaría qué direcciones tienen cuenta.
			showMessage("success", "Si ese correo tiene cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja y el correo no deseado.");
		});
	}

	form.addEventListener("submit", async function (e) {
		e.preventDefault();
		var nombre = (nombreInput.value || "").trim();
		var email = (emailInput.value || "").trim();
		var password = passwordInput.value;

		if (!email || !password) {
			showMessage("error", "Ingresa correo y contraseña.");
			return;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			showMessage("error", "Ingresa un correo electrónico válido.");
			return;
		}
		if (mode === "register") {
			if (!nombre || nombre.length < 3) {
				showMessage("error", "Ingresa tu nombre completo (mínimo 3 caracteres).");
				return;
			}
			if (password.length < 6) {
				showMessage("error", "La contraseña debe tener al menos 6 caracteres.");
				return;
			}
		}

		setLoading(true);
		clearMessage();

		try {
			if (mode === "register") {
				await registrar(email, password, nombre);
			} else {
				await ingresar(email, password);
			}
		} catch (err) {
			// Supabase devuelve los errores en inglés; los traducimos siempre.
			showMessage("error", window.mensajeAuth
				? window.mensajeAuth(err, mode === "register"
					? "No se pudo crear la cuenta. Inténtalo de nuevo."
					: "No se pudo iniciar sesión. Inténtalo de nuevo.")
				: "Ocurrió un error. Inténtalo de nuevo.");
			setLoading(false);
		}
	});

	// El registro pide solo nombre, correo y contraseña (decisión de Jorge): el CCT y la
	// escuela se piden en Mi salón. El nombre va en la marca de agua de los materiales.
	async function registrar(email, password, nombre) {
		var res = await window.sb.auth.signUp({
			email: email,
			password: password,
			options: { data: { full_name: nombre, nombre_docente: nombre } },
		});
		if (res.error) { throw res.error; }

		// Sin sesión = requiere confirmación por correo.
		if (!res.data.session) {
			showMessage("success", "Registro exitoso. Revisa tu correo para confirmar tu cuenta y luego inicia sesión.");
			mode = "login";
			updateModeUI();
			setLoading(false);
			return;
		}

		// Perfil con su nombre (activo_saas=false por default → solo la tienda). Si falla,
		// no detiene la entrada (Tienda.asegurarPerfil)
		await Tienda.asegurarPerfil(res.data.session, { nombre_completo: nombre });
		location.href = await destino(res.data.session.user.id);
	}

	async function ingresar(email, password) {
		var res = await window.sb.auth.signInWithPassword({ email: email, password: password });
		if (res.error) { throw res.error; }
		// Quien confirmó su correo después de registrarse no tenía sesión al registrarse:
		// su perfil se crea aquí, con el nombre del registro
		await Tienda.asegurarPerfil(res.data.session);
		location.href = await destino(res.data.session.user.id);
	}

	function updateModeUI() {
		if (mode === "register") {
			nombreField.classList.remove("hidden");
			nombreInput.required = true;
			submitBtn.textContent = "Crear cuenta";
			toggleLink.textContent = "Inicia sesión";
			subtitulo.textContent = "Crea tu cuenta para comprar planeaciones";
			document.querySelector("#toggleLink").parentNode.firstChild.textContent = "¿Ya tienes cuenta? ";
		} else {
			nombreField.classList.add("hidden");
			nombreInput.required = false;
			submitBtn.textContent = "Iniciar sesión";
			toggleLink.textContent = "Regístrate";
			subtitulo.textContent = "Inicia sesión para acceder a tus planeaciones";
			document.querySelector("#toggleLink").parentNode.firstChild.textContent = "¿No tienes cuenta? ";
		}
	}

	function setLoading(loading) {
		submitBtn.disabled = loading;
		submitBtn.classList.toggle("opacity-70", loading);
		submitBtn.classList.toggle("cursor-not-allowed", loading);
		if (loading) {
			submitBtn.textContent = mode === "register" ? "Creando..." : "Entrando...";
		} else {
			updateModeUI();
		}
	}

	function showMessage(type, text) {
		var box = document.getElementById("authMessage");
		if (!box) {
			box = document.createElement("div");
			box.id = "authMessage";
			form.insertAdjacentElement("afterend", box);
		}
		box.textContent = text;
		box.className = "mt-4 rounded-xl px-4 py-3 text-sm font-medium";
		box.style.cssText = type === "success"
			? "background:#ecfdf5;color:#047a55;border:1px solid #a7f3d0"
			: "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5";
	}

	function clearMessage() {
		var box = document.getElementById("authMessage");
		if (box) { box.remove(); }
	}
});
