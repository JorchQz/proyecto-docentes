document.addEventListener("DOMContentLoaded", function () {
	var form = document.getElementById("loginForm");
	var nombreField = document.getElementById("nombreField");
	var nombreInput = document.getElementById("nombre");
	var escuelaField = document.getElementById("escuelaField");
	var escuelaInput = document.getElementById("escuela");
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

	form.addEventListener("submit", async function (e) {
		e.preventDefault();
		var nombre = (nombreInput.value || "").trim();
		var escuela = (escuelaInput.value || "").trim();
		var email = (emailInput.value || "").trim();
		var password = passwordInput.value;

		if (!email || !password) {
			showMessage("error", "Ingresa correo y contraseña.");
			return;
		}
		if (mode === "register" && (!nombre || nombre.length < 3)) {
			showMessage("error", "Ingresa tu nombre completo (mínimo 3 caracteres).");
			return;
		}

		setLoading(true);
		clearMessage();

		try {
			if (mode === "register") {
				await registrar(email, password, nombre, escuela);
			} else {
				await ingresar(email, password);
			}
		} catch (err) {
			showMessage("error", err.message || "Ocurrió un error.");
			setLoading(false);
		}
	});

	async function registrar(email, password, nombre, escuela) {
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
			{ id: userId, nombre_completo: nombre, escuela: escuela || null },
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
			escuelaField.classList.remove("hidden");
			nombreInput.required = true;
			submitBtn.textContent = "Crear cuenta";
			toggleLink.textContent = "Inicia sesión";
			subtitulo.textContent = "Crea tu cuenta para comprar planeaciones";
			document.querySelector("#toggleLink").parentNode.firstChild.textContent = "¿Ya tienes cuenta? ";
		} else {
			nombreField.classList.add("hidden");
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
		box.className =
			"mt-4 rounded-lg px-4 py-3 text-sm " +
			(type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700");
	}

	function clearMessage() {
		var box = document.getElementById("authMessage");
		if (box) { box.remove(); }
	}
});
