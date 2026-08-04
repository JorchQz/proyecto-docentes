document.addEventListener("DOMContentLoaded", function () {
	var form = document.getElementById("loginForm");
	var nombreField = document.getElementById("nombreField");
	var nombreInput = document.getElementById("nombre");
	var escuelaField = document.getElementById("escuelaField");
	var escuelaInput = document.getElementById("escuela");
	var cctField = document.getElementById("cctField");
	var cctInput = document.getElementById("cct");
	var emailInput = document.getElementById("email");
	var passwordInput = document.getElementById("password");
	var submitBtn = form.querySelector("button[type='submit']");
	var toggleLink = document.getElementById("toggleLink");
	var subtitulo = document.getElementById("subtitulo");

	if (!window.sb) {
		showMessage("error", "No se pudo conectar. Recarga la página.");
		return;
	}

	// ?next= a dónde ir tras autenticar. Si viene explícito (p. ej. desde
	// checkout) se respeta. Si no, el destino depende de activo_saas.
	var params = new URLSearchParams(location.search);
	var nextExplicito = params.get("next");

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
		var activoSaas = perf && perf.data && perf.data.activo_saas;
		if (!activoSaas) { return "catalogo.html"; }
		// Usuario SaaS: dashboard, o onboarding si aún no tiene grupo.
		var grupo = await window.sb.from("grupos").select("id").eq("maestro_id", userId).limit(1);
		var tieneGrupo = grupo && grupo.data && grupo.data.length > 0;
		return tieneGrupo ? "../dashboard.html" : "../onboarding.html";
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
			var res = await window.sb.auth.resetPasswordForEmail(correo, {
				// Sin ".html": Cloudflare redirige esa ruta y es un salto de más.
				redirectTo: location.origin + "/reset-password",
			});
			olvideLink.textContent = "¿Olvidaste tu contraseña?";
			if (res.error) {
				showMessage("error", window.mensajeAuth
					? window.mensajeAuth(res.error, "No se pudo enviar el correo.")
					: "No se pudo enviar el correo.");
				return;
			}
			// Respuesta igual exista o no la cuenta: decir "ese correo no está
			// registrado" revelaría qué direcciones tienen cuenta.
			showMessage("success", "Si ese correo tiene cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja y el correo no deseado.");
		});
	}

	form.addEventListener("submit", async function (e) {
		e.preventDefault();
		var nombre = (nombreInput.value || "").trim();
		var escuela = (escuelaInput.value || "").trim();
		var cct = (cctInput.value || "").trim().toUpperCase();
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
			if (cct && !/^[A-Z0-9]{10}$/.test(cct)) {
				showMessage("error", "El CCT debe tener 10 caracteres (letras y números).");
				return;
			}
		}

		setLoading(true);
		clearMessage();

		try {
			if (mode === "register") {
				await registrar(email, password, nombre, escuela, cct);
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

	async function registrar(email, password, nombre, escuela, cct) {
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

		var userId = res.data.session.user.id;
		// Crear perfil (activo_saas=false por default → solo marketplace).
		await window.sb.from("perfiles").upsert(
			{ id: userId, nombre_completo: nombre, escuela: escuela || null, cct: cct || null },
			{ onConflict: "id" }
		);
		location.href = await destino(userId);
	}

	async function ingresar(email, password) {
		var res = await window.sb.auth.signInWithPassword({ email: email, password: password });
		if (res.error) { throw res.error; }
		location.href = await destino(res.data.session.user.id);
	}

	function updateModeUI() {
		if (mode === "register") {
			nombreField.classList.remove("hidden");
			cctField.classList.remove("hidden");
			escuelaField.classList.remove("hidden");
			nombreInput.required = true;
			submitBtn.textContent = "Crear cuenta";
			toggleLink.textContent = "Inicia sesión";
			subtitulo.textContent = "Crea tu cuenta para comprar planeaciones";
			document.querySelector("#toggleLink").parentNode.firstChild.textContent = "¿Ya tienes cuenta? ";
		} else {
			nombreField.classList.add("hidden");
			cctField.classList.add("hidden");
			escuelaField.classList.add("hidden");
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
