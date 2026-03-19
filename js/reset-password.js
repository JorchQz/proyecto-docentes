document.addEventListener("DOMContentLoaded", async function () {
	var form = document.getElementById("resetPasswordForm");
	var newPasswordInput = document.getElementById("newPassword");
	var confirmPasswordInput = document.getElementById("confirmPassword");
	var strengthLabel = document.getElementById("passwordStrengthLabel");
	var strengthBar = document.getElementById("passwordStrengthBar");
	var strengthHint = document.getElementById("passwordStrengthHint");
	var submitButton = form ? form.querySelector("button[type='submit']") : null;

	if (!form || !newPasswordInput || !confirmPasswordInput || !submitButton) {
		console.error("No se encontraron los elementos del formulario de recuperacion.");
		return;
	}

	if (!window.sb) {
		showMessage("error", "Supabase no esta configurado.");
		return;
	}

	if (newPasswordInput) {
		newPasswordInput.addEventListener("input", function () {
			updatePasswordStrength(newPasswordInput.value);
		});
	}

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		showMessage(
			"error",
			"El enlace de recuperacion no es valido o ya expiro. Solicita uno nuevo desde login."
		);
		submitButton.disabled = true;
		submitButton.classList.add("opacity-70", "cursor-not-allowed");
		return;
	}

	form.addEventListener("submit", async function (event) {
		event.preventDefault();

		var newPassword = newPasswordInput.value;
		var confirmPassword = confirmPasswordInput.value;

		if (newPassword.length < 6) {
			showMessage("error", "La contraseña debe tener al menos 6 caracteres.");
			return;
		}

		if (newPassword !== confirmPassword) {
			showMessage("error", "Las contraseñas no coinciden.");
			return;
		}

		setLoading(true);
		clearMessage();

		try {
			var result = await window.sb.auth.updateUser({ password: newPassword });
			if (result.error) {
				throw result.error;
			}

			showMessage("success", "Contraseña actualizada. Redirigiendo al login...");
			setTimeout(function () {
				window.location.href = "index.html";
			}, 1500);
		} catch (error) {
			showMessage(
				"error",
				translateResetError(error) || "No se pudo actualizar la contraseña."
			);
		} finally {
			setLoading(false);
		}
	});

	function setLoading(isLoading) {
		submitButton.disabled = isLoading;
		newPasswordInput.disabled = isLoading;
		confirmPasswordInput.disabled = isLoading;

		if (isLoading) {
			submitButton.textContent = "Guardando...";
			submitButton.classList.add("opacity-70", "cursor-not-allowed");
		} else {
			submitButton.textContent = "Guardar nueva contraseña";
			submitButton.classList.remove("opacity-70", "cursor-not-allowed");
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
		var box = document.getElementById("resetPasswordMessage");
		if (box) {
			box.remove();
		}
	}

	function getMessageBox() {
		var box = document.getElementById("resetPasswordMessage");
		if (!box) {
			box = document.createElement("div");
			box.id = "resetPasswordMessage";
			form.insertAdjacentElement("afterend", box);
		}
		return box;
	}

	function updatePasswordStrength(password) {
		if (!strengthLabel || !strengthBar || !strengthHint) {
			return;
		}

		if (!password) {
			strengthLabel.textContent = "Sin evaluar";
			strengthLabel.className = "text-xs font-medium text-gray-600";
			strengthBar.className = "h-full w-0 bg-gray-400 transition-all duration-300";
			strengthHint.textContent =
				"Recomendado: 8+ caracteres, mayúsculas, minúsculas, número y símbolo.";
			return;
		}

		var checks = {
			length: password.length >= 8,
			uppercase: /[A-ZÁÉÍÓÚÜÑ]/.test(password),
			lowercase: /[a-záéíóúüñ]/.test(password),
			number: /\d/.test(password),
			symbol: /[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(password),
		};

		var score = Object.keys(checks).reduce(function (acc, key) {
			return acc + (checks[key] ? 1 : 0);
		}, 0);

		if (score <= 2) {
			strengthLabel.textContent = "Debil";
			strengthLabel.className = "text-xs font-medium text-red-700";
			strengthBar.className =
				"h-full w-1/3 bg-red-500 transition-all duration-300";
			strengthHint.textContent =
				"Agrega mayúsculas, minúsculas, números y símbolos para mejorarla.";
			return;
		}

		if (score <= 4) {
			strengthLabel.textContent = "Media";
			strengthLabel.className = "text-xs font-medium text-amber-700";
			strengthBar.className =
				"h-full w-2/3 bg-amber-500 transition-all duration-300";
			strengthHint.textContent =
				"Vas bien. Para mayor seguridad, incluye todos los tipos de caracteres.";
			return;
		}

		strengthLabel.textContent = "Fuerte";
		strengthLabel.className = "text-xs font-medium text-green-700";
		strengthBar.className = "h-full w-full bg-green-500 transition-all duration-300";
		strengthHint.textContent = "Excelente contraseña.";
	}

	function translateResetError(error) {
		var message = ((error && error.message) || "").toLowerCase();

		if (
			message.indexOf("same") !== -1 &&
			message.indexOf("password") !== -1
		) {
			return "La nueva contraseña no puede ser igual a la anterior.";
		}

		if (message.indexOf("password") !== -1 && message.indexOf("weak") !== -1) {
			return "La contraseña es muy débil. Usa una más segura.";
		}

		if (message.indexOf("expired") !== -1 || message.indexOf("invalid") !== -1) {
			return "El enlace de recuperación no es válido o ya expiró. Solicita uno nuevo.";
		}

		if (message.indexOf("rate limit") !== -1) {
			return "Demasiados intentos. Espera un momento y vuelve a intentar.";
		}

		return error && error.message ? error.message : "";
	}
});
