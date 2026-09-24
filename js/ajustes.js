document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		return;
	}

	var notificationsForm = document.getElementById("notificationsForm");
	var notifTaskReviewInput = document.getElementById("notifTaskReview");
	var notifTaskUpdatesInput = document.getElementById("notifTaskUpdates");
	var notifWeeklySummaryInput = document.getElementById("notifWeeklySummary");
	var saveNotificationsBtn = document.getElementById("saveNotificationsBtn");

	if (!notificationsForm) {
		return;
	}

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var currentUser = sessionResult.data.session.user;
	fillPreferences(currentUser);

	notificationsForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		setButtonLoading(saveNotificationsBtn, true, "Guardando...");
		clearMessage("notificationsMessage");

		try {
			var metadata = Object.assign({}, currentUser.user_metadata || {});
			metadata.notification_preferences = {
				task_review: Boolean(notifTaskReviewInput && notifTaskReviewInput.checked),
				task_updates: Boolean(notifTaskUpdatesInput && notifTaskUpdatesInput.checked),
				weekly_summary: Boolean(
					notifWeeklySummaryInput && notifWeeklySummaryInput.checked
				),
			};

			var result = await window.sb.auth.updateUser({ data: metadata });
			if (result.error) {
				throw result.error;
			}

			currentUser = result.data.user || currentUser;
			fillPreferences(currentUser);
			showMessage(
				"notificationsMessage",
				"success",
				"Preferencias guardadas correctamente."
			);
		} catch (error) {
			showMessage(
				"notificationsMessage",
				"error",
				"No se pudieron guardar las preferencias: " +
					(error.message || "Error desconocido")
			);
		} finally {
			setButtonLoading(saveNotificationsBtn, false, "Guardar preferencias");
		}
	});

	var showDeleteFormBtn = document.getElementById("showDeleteFormBtn");
	var deleteAccountForm = document.getElementById("deleteAccountForm");
	var deleteConfirmInput = document.getElementById("deleteConfirmInput");
	var cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
	var confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

	if (showDeleteFormBtn) {
		showDeleteFormBtn.addEventListener("click", function () {
			showDeleteFormBtn.classList.add("hidden");
			deleteAccountForm.classList.remove("hidden");
			deleteConfirmInput.focus();
		});
	}

	if (cancelDeleteBtn) {
		cancelDeleteBtn.addEventListener("click", function () {
			deleteAccountForm.classList.add("hidden");
			showDeleteFormBtn.classList.remove("hidden");
			deleteConfirmInput.value = "";
			confirmDeleteBtn.disabled = true;
			clearMessage("deleteAccountMessage");
		});
	}

	if (deleteConfirmInput) {
		deleteConfirmInput.addEventListener("input", function () {
			confirmDeleteBtn.disabled = deleteConfirmInput.value !== "ELIMINAR";
		});
	}

	if (confirmDeleteBtn) {
		confirmDeleteBtn.addEventListener("click", async function () {
			if (deleteConfirmInput.value !== "ELIMINAR") {
				return;
			}

			confirmDeleteBtn.disabled = true;
			cancelDeleteBtn.disabled = true;
			deleteConfirmInput.disabled = true;
			confirmDeleteBtn.textContent = "Eliminando...";
			clearMessage("deleteAccountMessage");

			try {
				var result = await window.sb.rpc("delete_own_account");
				if (result.error) {
					throw result.error;
				}

				await window.sb.auth.signOut();
				window.location.href = "index.html";
			} catch (error) {
				showMessage(
					"deleteAccountMessage",
					"error",
					"No se pudo eliminar la cuenta: " + (error.message || "Error desconocido")
				);
				confirmDeleteBtn.disabled = false;
				cancelDeleteBtn.disabled = false;
				deleteConfirmInput.disabled = false;
				confirmDeleteBtn.textContent = "Confirmar eliminación";
			}
		});
	}

	function fillPreferences(user) {
		var metadata = (user && user.user_metadata) || {};
		var preferences = metadata.notification_preferences || {
			task_review: true,
			task_updates: true,
			weekly_summary: false,
		};

		if (notifTaskReviewInput) {
			notifTaskReviewInput.checked = Boolean(preferences.task_review);
		}
		if (notifTaskUpdatesInput) {
			notifTaskUpdatesInput.checked = Boolean(preferences.task_updates);
		}
		if (notifWeeklySummaryInput) {
			notifWeeklySummaryInput.checked = Boolean(preferences.weekly_summary);
		}
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

	// Ponderación de calificaciones
	var pesoTareasInput = document.getElementById("pesoTareas");
	var pesoTrabajosInput = document.getElementById("pesoTrabajos");
	var pesoParticipacionInput = document.getElementById("pesoParticipacion");
	var pesoExamenInput = document.getElementById("pesoExamen");
	var sumaPonderacionSpan = document.getElementById("sumaPonderacion");
	var savePonderacionBtn = document.getElementById("savePonderacionBtn");
	var resetPonderacionBtn = document.getElementById("resetPonderacionBtn");

	/*
		Valores por defecto (los mismos DEFAULT de maestro_ajustes). No ponderan:
		  - la asistencia (Acuerdo 10/09/23, art. 7), que se muestra aparte en la boleta;
		  - la conducta (decisión de Jorge del 2026-09-24; LGE art. 21: se informa aparte).
		Aquí ya no se puede dar peso a la conducta. Un peso_conducta que el maestro haya
		guardado antes no se toca (no se envía al guardar) y el motor lo ignora.
		Los cuatro pesos son relativos: cada rubro vale su peso entre la suma (el motor
		reparte así también el peso de un rubro sin datos). Con los de fábrica suman 95.
	*/
	var ponderacionCargada = false; // no se guarda sin haber leído los pesos actuales
	var defaultValues = {
		tareas: 28,
		trabajos: 28,
		participacion: 6,
		examen: 33
	};
	var entradas = [
		{ input: pesoTareasInput, clave: "tareas", efectivo: document.getElementById("efectivoTareas") },
		{ input: pesoTrabajosInput, clave: "trabajos", efectivo: document.getElementById("efectivoTrabajos") },
		{ input: pesoParticipacionInput, clave: "participacion", efectivo: document.getElementById("efectivoParticipacion") },
		{ input: pesoExamenInput, clave: "examen", efectivo: document.getElementById("efectivoExamen") }
	];

	// 0 es un peso válido: solo null/undefined cae al default
	function pesoGuardado(valor, porDefecto) {
		return valor !== null && valor !== undefined ? valor : porDefecto;
	}

	function ponerValores(fuente) {
		entradas.forEach(function (e) {
			e.input.value = pesoGuardado(fuente ? fuente["peso_" + e.clave] : null, defaultValues[e.clave]);
		});
	}

	// Cargar ponderación al iniciar
	async function loadPonderacion() {
		try {
			var ajustes = await window.Lectura.uno(window.sb
				.from("maestro_ajustes")
				.select("*")
				.eq("maestro_id", currentUser.id)
				.maybeSingle());

			// Sin fila guardada: los valores por defecto
			ponerValores(ajustes || null);

			ponderacionCargada = true;
			calcularSuma();
		} catch (error) {
			// Sin los pesos guardados, la pantalla mostraría los de fábrica como si fueran los
			// suyos y "Guardar" los pisaría: la página se detiene con el aviso común
			ponderacionCargada = false;
			savePonderacionBtn.disabled = true;
			window.Lectura.detenerPagina(error);
		}
	}

	// Entero de 0 a 100; null si el cuadro no trae un peso válido
	function valorPeso(input) {
		var texto = String(input.value === undefined || input.value === null ? "" : input.value).trim();
		if (texto === "") return null;
		var n = Number(texto);
		return Math.floor(n) === n && n >= 0 && n <= 100 ? n : null;
	}

	function calcularSuma() {
		var valores = entradas.map(function (e) { return valorPeso(e.input); });
		var validos = valores.every(function (v) { return v !== null; });
		var suma = valores.reduce(function (a, v) { return a + (v || 0); }, 0);

		sumaPonderacionSpan.textContent = String(suma);
		// Lo que vale de verdad cada rubro en la calificación (su peso entre la suma)
		entradas.forEach(function (e, i) {
			if (!e.efectivo) return;
			e.efectivo.textContent = validos && suma > 0 && valores[i] > 0
				? "vale " + (Math.floor(valores[i] / suma * 1000 + 1e-9) / 10).toFixed(1) + " % de la calificación"
				: (validos && suma > 0 ? "no cuenta" : "");
		});

		if (validos && suma > 0) {
			sumaPonderacionSpan.classList.remove("text-red-600");
			sumaPonderacionSpan.classList.add("text-green-600");
			savePonderacionBtn.disabled = !ponderacionCargada;
		} else {
			// Todos en 0 o algún cuadro vacío o fuera de 0 a 100
			sumaPonderacionSpan.classList.remove("text-green-600");
			sumaPonderacionSpan.classList.add("text-red-600");
			savePonderacionBtn.disabled = true;
		}
	}

	// Event listeners para los inputs
	entradas.forEach(function (e) { e.input.addEventListener("input", calcularSuma); });

	// Guardar ponderación (sin peso_conducta: si había uno guardado, se queda como estaba)
	savePonderacionBtn.addEventListener("click", async function () {
		clearMessage("ponderacionMessage");
		setButtonLoading(savePonderacionBtn, true, "Guardando...");

		try {
			var fila = { maestro_id: currentUser.id, updated_at: new Date().toISOString() };
			entradas.forEach(function (e) { fila["peso_" + e.clave] = valorPeso(e.input); });
			var result = await window.sb.from("maestro_ajustes").upsert(fila, { onConflict: "maestro_id" });

			if (result.error) {
				throw result.error;
			}

			showMessage(
				"ponderacionMessage",
				"success",
				"Ponderación guardada correctamente."
			);
		} catch (error) {
			showMessage(
				"ponderacionMessage",
				"error",
				"No se pudo guardar la ponderación: " +
					(error.message || "Error desconocido")
			);
		} finally {
			setButtonLoading(savePonderacionBtn, false, "Guardar ponderación");
			calcularSuma();
		}
	});

	// Restaurar valores por defecto
	resetPonderacionBtn.addEventListener("click", function () {
		ponerValores(null);
		calcularSuma();
		clearMessage("ponderacionMessage");
	});

	// Cargar ponderación al iniciar la página
	loadPonderacion();
});
