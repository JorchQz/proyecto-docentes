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
});
