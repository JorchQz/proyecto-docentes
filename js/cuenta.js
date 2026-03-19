document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado. Regresando al login.");
		window.location.href = "index.html";
		return;
	}

	var mainMenuBtn = document.getElementById("mainMenuBtn");
	var mainMenuPanel = document.getElementById("mainMenuPanel");
	var logoutBtn = document.getElementById("logoutBtn");

	var profileForm = document.getElementById("profileForm");
	var emailForm = document.getElementById("emailForm");
	var passwordForm = document.getElementById("passwordForm");
	var teacherNameInput = document.getElementById("teacherName");
	var teacherSexInput = document.getElementById("teacherSex");
	var teacherEmailInput = document.getElementById("teacherEmail");
	var teacherCreatedAtInput = document.getElementById("teacherCreatedAt");
	var newEmailInput = document.getElementById("newEmail");
	var saveProfileBtn = document.getElementById("saveProfileBtn");
	var saveEmailBtn = document.getElementById("saveEmailBtn");
	var savePasswordBtn = document.getElementById("savePasswordBtn");

	var newPasswordInput = document.getElementById("newPassword");
	var confirmPasswordInput = document.getElementById("confirmPassword");
	var strengthLabel = document.getElementById("passwordStrengthLabel");
	var strengthBar = document.getElementById("passwordStrengthBar");
	var strengthHint = document.getElementById("passwordStrengthHint");

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var currentUser = sessionResult.data.session.user;

	bindMainMenu();
	fillUserData(currentUser);

	window.sb.auth.onAuthStateChange(function (event) {
		if (event === "SIGNED_OUT") {
			window.location.href = "index.html";
		}
	});

	if (logoutBtn) {
		logoutBtn.addEventListener("click", async function () {
			closeMainMenu();
			logoutBtn.disabled = true;
			logoutBtn.classList.add("opacity-70", "cursor-not-allowed");

			var result = await window.sb.auth.signOut();
			if (result.error) {
				showMessage("accountMessage", "error", "No se pudo cerrar sesion: " + result.error.message);
				logoutBtn.disabled = false;
				logoutBtn.classList.remove("opacity-70", "cursor-not-allowed");
			}
		});
	}

	if (newPasswordInput) {
		newPasswordInput.addEventListener("input", function () {
			updatePasswordStrength(newPasswordInput.value);
		});
	}

	if (profileForm) {
		profileForm.addEventListener("submit", async function (event) {
			event.preventDefault();
			var name = (teacherNameInput.value || "").trim();
			var sex = (teacherSexInput && teacherSexInput.value ? teacherSexInput.value : "").trim();

			if (!name || name.length < 3) {
				showMessage("accountMessage", "error", "Ingresa un nombre valido con al menos 3 caracteres.");
				return;
			}

			if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]+$/.test(name)) {
				showMessage("accountMessage", "error", "El nombre solo permite letras y espacios.");
				return;
			}

			if (sex && sex !== "profesor" && sex !== "profesora") {
				showMessage("accountMessage", "error", "Selecciona un valor válido para sexo.");
				return;
			}

			setButtonLoading(saveProfileBtn, true, "Guardando...");
			clearMessage("accountMessage");

			try {
				var existingMetadata = currentUser.user_metadata || {};
				var updateResult = await window.sb.auth.updateUser({
					data: {
						nombre_docente: name,
						full_name: name,
						sexo_docente: sex || null,
						notification_preferences: existingMetadata.notification_preferences || null,
						avatar_url: existingMetadata.avatar_url || null,
					},
				});

				if (updateResult.error) {
					throw updateResult.error;
				}

				currentUser = updateResult.data.user || currentUser;
				fillUserData(currentUser);
				showMessage("accountMessage", "success", "Datos actualizados correctamente.");
			} catch (error) {
				showMessage("accountMessage", "error", "No se pudieron guardar los datos: " + (error.message || "Error desconocido"));
			} finally {
				setButtonLoading(saveProfileBtn, false, "Guardar datos");
			}
		});
	}

	if (emailForm) {
		emailForm.addEventListener("submit", async function (event) {
			event.preventDefault();

			var newEmail = (newEmailInput.value || "").trim().toLowerCase();
			var currentEmail = (teacherEmailInput.value || "").trim().toLowerCase();

			if (!newEmail) {
				showMessage("emailMessage", "error", "Ingresa el nuevo correo electrónico.");
				return;
			}

			if (newEmail === currentEmail) {
				showMessage("emailMessage", "error", "El nuevo correo debe ser distinto al actual.");
				return;
			}

			setButtonLoading(saveEmailBtn, true, "Enviando...");
			clearMessage("emailMessage");

			try {
				var updateEmailResult = await window.sb.auth.updateUser({ email: newEmail });
				if (updateEmailResult.error) {
					throw updateEmailResult.error;
				}

				newEmailInput.value = "";
				showMessage(
					"emailMessage",
					"success",
					"Solicitud enviada. Revisa tu correo actual y el nuevo para confirmar el cambio."
				);
			} catch (error) {
				showMessage(
					"emailMessage",
					"error",
					translateEmailError(error) || "No se pudo solicitar el cambio de correo."
				);
			} finally {
				setButtonLoading(saveEmailBtn, false, "Solicitar cambio de correo");
			}
		});
	}

	if (passwordForm) {
		passwordForm.addEventListener("submit", async function (event) {
			event.preventDefault();
			var newPassword = newPasswordInput.value;
			var confirmPassword = confirmPasswordInput.value;

			if (newPassword.length < 6) {
				showMessage("securityMessage", "error", "La contraseña debe tener al menos 6 caracteres.");
				return;
			}

			if (newPassword !== confirmPassword) {
				showMessage("securityMessage", "error", "Las contraseñas no coinciden.");
				return;
			}

			setButtonLoading(savePasswordBtn, true, "Guardando...");
			clearMessage("securityMessage");

			try {
				var result = await window.sb.auth.updateUser({ password: newPassword });
				if (result.error) {
					throw result.error;
				}

				passwordForm.reset();
				updatePasswordStrength("");
				showMessage("securityMessage", "success", "Contraseña actualizada correctamente.");
			} catch (error) {
				showMessage("securityMessage", "error", translatePasswordError(error));
			} finally {
				setButtonLoading(savePasswordBtn, false, "Cambiar contraseña");
			}
		});
	}

	function fillUserData(user) {
		if (!user) {
			return;
		}

		var metadata = user.user_metadata || {};
		var name = metadata.nombre_docente || metadata.full_name || "";
		var sex = metadata.sexo_docente || "";
		teacherNameInput.value = name;
		if (teacherSexInput) {
			teacherSexInput.value = sex === "profesor" || sex === "profesora" ? sex : "";
		}
		teacherEmailInput.value = user.email || "";
		teacherCreatedAtInput.value = formatDateTime(user.created_at);
	}

	function bindMainMenu() {
		if (!mainMenuBtn || !mainMenuPanel) {
			return;
		}

		mainMenuBtn.addEventListener("click", function (event) {
			event.stopPropagation();
			mainMenuPanel.classList.toggle("hidden");
		});

		document.addEventListener("click", function (event) {
			if (!mainMenuPanel.classList.contains("hidden")) {
				var clickInsideMenu = mainMenuPanel.contains(event.target);
				var clickInsideButton = mainMenuBtn.contains(event.target);

				if (!clickInsideMenu && !clickInsideButton) {
					closeMainMenu();
				}
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				closeMainMenu();
			}
		});
	}

	function closeMainMenu() {
		if (!mainMenuPanel) {
			return;
		}
		mainMenuPanel.classList.add("hidden");
	}

	function setButtonLoading(button, isLoading, loadingText) {
		if (!button) {
			return;
		}

		if (!button.dataset.defaultText) {
			button.dataset.defaultText = button.textContent;
		}

		button.disabled = isLoading;
		if (isLoading) {
			button.classList.add("opacity-70", "cursor-not-allowed");
			button.textContent = loadingText;
			return;
		}

		button.classList.remove("opacity-70", "cursor-not-allowed");
		button.textContent = button.dataset.defaultText;
	}

	function showMessage(containerId, type, text) {
		var box = document.getElementById(containerId);
		if (!box) {
			return;
		}

		box.textContent = text;
		box.className =
			"mt-4 rounded-lg px-4 py-3 text-sm " +
			(type === "success"
				? "bg-blue-100 text-blue-800"
				: "bg-red-100 text-red-800");
	}

	function clearMessage(containerId) {
		var box = document.getElementById(containerId);
		if (!box) {
			return;
		}
		box.textContent = "";
		box.className = "mt-4";
	}

	function formatDateTime(value) {
		if (!value) {
			return "N/A";
		}

		var date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return "N/A";
		}

		return date.toLocaleString("es-MX", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
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

	function translatePasswordError(error) {
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

		if (message.indexOf("rate limit") !== -1) {
			return "Demasiados intentos. Espera un momento y vuelve a intentar.";
		}

		return error && error.message ? error.message : "No se pudo actualizar la contraseña.";
	}

	function translateEmailError(error) {
		var message = ((error && error.message) || "").toLowerCase();

		if (message.indexOf("same") !== -1 && message.indexOf("email") !== -1) {
			return "El nuevo correo no puede ser igual al actual.";
		}

		if (message.indexOf("invalid") !== -1 && message.indexOf("email") !== -1) {
			return "El correo ingresado no es válido.";
		}

		if (message.indexOf("already") !== -1 && message.indexOf("registered") !== -1) {
			return "Ese correo ya está registrado en otra cuenta.";
		}

		if (message.indexOf("rate limit") !== -1) {
			return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
		}

		return error && error.message ? error.message : "";
	}

});
