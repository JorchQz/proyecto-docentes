document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado. Regresando al login.");
		window.location.href = "index.html";
		return;
	}

	var mainMenuBtn = document.getElementById("mainMenuBtn");
	var mainMenuPanel = document.getElementById("mainMenuPanel");
	var logoutBtn = document.getElementById("logoutBtn");
	var userNameEl = document.getElementById("userName");
	var userEmailEl = document.getElementById("userEmail");

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var user = sessionResult.data.session.user;	
	if (userEmailEl) {
		userEmailEl.textContent = user.email || "Usuario autenticado";
	}
	if (userNameEl) {
		userNameEl.textContent = getTeacherNameFromUser(user);
	}

	bindMainMenu();

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
				alert("No se pudo cerrar sesion: " + result.error.message);
				logoutBtn.disabled = false;
				logoutBtn.classList.remove("opacity-70", "cursor-not-allowed");
			}
		});
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

	function getTeacherNameFromUser(userData) {
		if (!userData || !userData.user_metadata) {
			return "Docente";
		}

		var name = userData.user_metadata.nombre_docente || userData.user_metadata.full_name || "";
		return (name || "").trim() || "Docente";
	}
});
