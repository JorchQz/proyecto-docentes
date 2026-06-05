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
	var pesoAsistenciaInput = document.getElementById("pesoAsistencia");
	var pesoParticipacionInput = document.getElementById("pesoParticipacion");
	var pesoConductaInput = document.getElementById("pesoConducata");
	var pesoExamenInput = document.getElementById("pesoExamen");
	var sumaPonderacionSpan = document.getElementById("sumaPonderacion");
	var savePonderacionBtn = document.getElementById("savePonderacionBtn");
	var resetPonderacionBtn = document.getElementById("resetPonderacionBtn");

	// Valores por defecto
	var defaultValues = {
		tareas: 25,
		trabajos: 25,
		asistencia: 10,
		participacion: 5,
		conducta: 5,
		examen: 30
	};

	// Cargar ponderación al iniciar
	async function loadPonderacion() {
		try {
			var result = await window.sb
				.from("maestro_ajustes")
				.select("*")
				.eq("maestro_id", currentUser.id)
				.maybeSingle();

			if (result.error) {
				console.error("Error al cargar ponderación:", result.error);
				return;
			}

			if (result.data) {
				pesoTareasInput.value = result.data.peso_tareas || defaultValues.tareas;
				pesoTrabajosInput.value = result.data.peso_trabajos || defaultValues.trabajos;
				pesoAsistenciaInput.value = result.data.peso_asistencia || defaultValues.asistencia;
				pesoParticipacionInput.value = result.data.peso_participacion || defaultValues.participacion;
				pesoConductaInput.value = result.data.peso_conducta || defaultValues.conducta;
				pesoExamenInput.value = result.data.peso_examen || defaultValues.examen;
			} else {
				// Si no hay datos, usar valores por defecto
				pesoTareasInput.value = defaultValues.tareas;
				pesoTrabajosInput.value = defaultValues.trabajos;
				pesoAsistenciaInput.value = defaultValues.asistencia;
				pesoParticipacionInput.value = defaultValues.participacion;
				pesoConductaInput.value = defaultValues.conducta;
				pesoExamenInput.value = defaultValues.examen;
			}

			calcularSuma();
		} catch (error) {
			console.error("Error al cargar ponderación:", error);
		}
	}

	function calcularSuma() {
		var suma =
			Number(pesoTareasInput.value || 0) +
			Number(pesoTrabajosInput.value || 0) +
			Number(pesoAsistenciaInput.value || 0) +
			Number(pesoParticipacionInput.value || 0) +
			Number(pesoConductaInput.value || 0) +
			Number(pesoExamenInput.value || 0);

		sumaPonderacionSpan.textContent = suma + "%";

		if (suma === 100) {
			sumaPonderacionSpan.classList.remove("text-red-600");
			sumaPonderacionSpan.classList.add("text-green-600");
			savePonderacionBtn.disabled = false;
		} else {
			sumaPonderacionSpan.classList.remove("text-green-600");
			sumaPonderacionSpan.classList.add("text-red-600");
			savePonderacionBtn.disabled = true;
		}
	}

	// Event listeners para los inputs
	pesoTareasInput.addEventListener("input", calcularSuma);
	pesoTrabajosInput.addEventListener("input", calcularSuma);
	pesoAsistenciaInput.addEventListener("input", calcularSuma);
	pesoParticipacionInput.addEventListener("input", calcularSuma);
	pesoConductaInput.addEventListener("input", calcularSuma);
	pesoExamenInput.addEventListener("input", calcularSuma);

	// Guardar ponderación
	savePonderacionBtn.addEventListener("click", async function () {
		clearMessage("ponderacionMessage");
		setButtonLoading(savePonderacionBtn, true, "Guardando...");

		try {
			var result = await window.sb.from("maestro_ajustes").upsert(
				{
					maestro_id: currentUser.id,
					peso_tareas: Number(pesoTareasInput.value),
					peso_trabajos: Number(pesoTrabajosInput.value),
					peso_asistencia: Number(pesoAsistenciaInput.value),
					peso_participacion: Number(pesoParticipacionInput.value),
					peso_conducta: Number(pesoConductaInput.value),
					peso_examen: Number(pesoExamenInput.value),
					updated_at: new Date().toISOString()
				},
				{ onConflict: "maestro_id" }
			);

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
		}
	});

	// Restaurar valores por defecto
	resetPonderacionBtn.addEventListener("click", function () {
		pesoTareasInput.value = defaultValues.tareas;
		pesoTrabajosInput.value = defaultValues.trabajos;
		pesoAsistenciaInput.value = defaultValues.asistencia;
		pesoParticipacionInput.value = defaultValues.participacion;
		pesoConductaInput.value = defaultValues.conducta;
		pesoExamenInput.value = defaultValues.examen;
		calcularSuma();
		clearMessage("ponderacionMessage");
	});

	// Cargar ponderación al iniciar la página
	loadPonderacion();
});
