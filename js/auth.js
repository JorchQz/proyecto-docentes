document.addEventListener("DOMContentLoaded", function () {
	var form = document.getElementById("loginForm");
	var teacherNameField = document.getElementById("teacherNameField");
	var teacherNameInput = document.getElementById("teacherName");
	var teacherSexField = document.getElementById("teacherSexField");
	var teacherSexInput = document.getElementById("teacherSex");
	var emailInput = document.getElementById("email");
	var passwordInput = document.getElementById("password");
	var submitButton = form ? form.querySelector("button[type='submit']") : null;
	var registerLink = document.querySelector(".mt-6 a");
	var forgotPasswordLink = document.getElementById("forgotPasswordLink");

	if (
		!form ||
		!emailInput ||
		!passwordInput ||
		!submitButton ||
		!teacherNameInput ||
		!teacherSexInput
	) {
		console.error("No se encontraron los elementos del formulario de autenticacion.");
		return;
	}

	if (!window.sb) {
		showMessage(
			"error",
			"Supabase no esta configurado. Revisa SUPABASE_URL y SUPABASE_ANON_KEY."
		);
		return;
	}

	window.sb.auth.getSession().then(async function (result) {
		if (result && result.data && result.data.session) {
			await redirectAfterAuth(result.data.session.user.id);
		}
	});

	var mode = "login"; // 'login' | 'register'
	var originalButtonText = submitButton.textContent;

	if (registerLink) {
		registerLink.addEventListener("click", function (event) {
			event.preventDefault();
			mode = mode === "login" ? "register" : "login";
			updateModeUI();
			clearMessage();
		});
	}

	if (forgotPasswordLink) {
		forgotPasswordLink.addEventListener("click", async function (event) {
			event.preventDefault();

			var email = emailInput.value.trim();
			if (!email) {
				showMessage("error", "Escribe tu correo para recuperar la contraseña.");
				return;
			}

			forgotPasswordLink.classList.add("pointer-events-none", "opacity-70");
			clearMessage();

			try {
				var redirectTo = window.location.origin + "/reset-password.html";
				var result = await window.sb.auth.resetPasswordForEmail(email, {
					redirectTo: redirectTo,
				});
				if (result.error) {
					throw result.error;
				}

				showMessage(
					"success",
					"Te enviamos un correo para recuperar tu contraseña."
				);
			} catch (error) {
				showMessage(
					"error",
					error.message || "No se pudo enviar el correo de recuperación."
				);
			} finally {
				forgotPasswordLink.classList.remove("pointer-events-none", "opacity-70");
			}
		});
	}

	form.addEventListener("submit", async function (event) {
		event.preventDefault();

		var teacherName = (teacherNameInput.value || "").trim();
		var teacherSex = (teacherSexInput.value || "").trim();
		var email = emailInput.value.trim();
		var password = passwordInput.value;

		if (!email || !password) {
			showMessage("error", "Ingresa correo y contrasena.");
			return;
		}

		if (mode === "register") {
			if (!teacherName || teacherName.length < 3) {
				showMessage(
					"error",
					"Ingresa el nombre del profesor(a) con al menos 3 caracteres."
				);
				return;
			}

			if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]+$/.test(teacherName)) {
				showMessage(
					"error",
					"El nombre del profesor(a) solo permite letras y espacios."
				);
				return;
			}

			if (teacherSex !== "profesor" && teacherSex !== "profesora") {
				showMessage("error", "Selecciona si eres profesor o profesora.");
				return;
			}
		}

		setLoading(true);
		clearMessage();

		try {
			if (mode === "register") {
				await registerUser(email, password, teacherName, teacherSex);
			} else {
				await loginUser(email, password);
			}
		} catch (error) {
			showMessage("error", error.message || "Ocurrio un error inesperado.");
		} finally {
			setLoading(false);
		}
	});

	async function registerUser(email, password, teacherName, teacherSex) {
		var result = await window.sb.auth.signUp({
			email: email,
			password: password,
			options: {
				data: {
					nombre_docente: teacherName,
					full_name: teacherName,
					sexo_docente: teacherSex,
				},
			},
		});

		if (result.error) {
			throw result.error;
		}

		if (!result.data.session) {
			showMessage(
				"success",
				"Registro exitoso. Revisa tu correo para confirmar tu cuenta antes de iniciar sesion."
			);
			mode = "login";
			updateModeUI();
			return;
		}

		var userId = result.data.session.user.id;
		await window.sb.from("perfiles").insert([{ id: userId, nombre_completo: teacherName }]);

		showMessage("success", "Registro exitoso. Redirigiendo...");
		await redirectAfterAuth(userId);
	}

	async function loginUser(email, password) {
		var result = await window.sb.auth.signInWithPassword({
			email: email,
			password: password,
		});

		if (result.error) {
			throw result.error;
		}

		showMessage("success", "Inicio de sesion exitoso. Redirigiendo...");
		await redirectAfterAuth(result.data.session.user.id);
	}

	async function redirectAfterAuth(userId) {
		var groupResult = await window.sb
			.from("grupos")
			.select("id")
			.eq("maestro_id", userId)
			.limit(1);

		if (groupResult.error) {
			window.location.href = "onboarding.html";
			return;
		}

		window.location.href =
			groupResult.data && groupResult.data.length > 0
				? "dashboard.html"
				: "onboarding.html";
	}

	function updateModeUI() {
		if (!registerLink) {
			return;
		}

		if (mode === "register") {
			if (teacherNameField) {
				teacherNameField.classList.remove("hidden");
			}
			if (teacherSexField) {
				teacherSexField.classList.remove("hidden");
			}
			teacherNameInput.required = true;
			teacherSexInput.required = true;
			submitButton.textContent = "Crear Cuenta";
			registerLink.textContent = "Ya tengo cuenta";
			return;
		}

		if (teacherNameField) {
			teacherNameField.classList.add("hidden");
		}
		if (teacherSexField) {
			teacherSexField.classList.add("hidden");
		}
		teacherNameInput.required = false;
		teacherSexInput.required = false;
		teacherNameInput.value = "";
		teacherSexInput.value = "";

		submitButton.textContent = originalButtonText || "Iniciar Sesion";
		registerLink.textContent = "Registrate aqui";
	}

	function setLoading(isLoading) {
		submitButton.disabled = isLoading;
		teacherNameInput.disabled = isLoading;
		teacherSexInput.disabled = isLoading;
		emailInput.disabled = isLoading;
		passwordInput.disabled = isLoading;

		if (isLoading) {
			submitButton.textContent = mode === "register" ? "Creando..." : "Entrando...";
			submitButton.classList.add("opacity-70", "cursor-not-allowed");
		} else {
			submitButton.classList.remove("opacity-70", "cursor-not-allowed");
			updateModeUI();
		}
	}

	function showMessage(type, text) {
		var box = getMessageBox();
		box.textContent = text;
		box.className =
			"mt-4 rounded-lg px-4 py-3 text-sm " +
			(type === "success"
				? "bg-blue-100 text-blue-800"
				: "bg-red-100 text-red-800");
	}

	function clearMessage() {
		var box = document.getElementById("authMessage");
		if (box) {
			box.remove();
		}
	}

	function getMessageBox() {
		var box = document.getElementById("authMessage");
		if (!box) {
			box = document.createElement("div");
			box.id = "authMessage";
			form.insertAdjacentElement("afterend", box);
		}
		return box;
	}
});
