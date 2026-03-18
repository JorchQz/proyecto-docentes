document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado. Regresando al login.");
		window.location.href = "index.html";
		return;
	}

	var emailEl = document.getElementById("userEmail");
	var logoutBtn = document.getElementById("logoutBtn");

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var user = sessionResult.data.session.user;
	var userId = user.id;

	var gruposResult = await window.sb
		.from("grupos")
		.select("id, nombre, tipo_organizacion, grados, escuela, descripcion")
		.eq("maestro_id", userId)
		.limit(1);

	if (gruposResult.error || gruposResult.data.length === 0) {
		window.location.href = "onboarding.html";
		return;
	}

	var currentGroup = gruposResult.data[0];

	if (emailEl) {
		emailEl.textContent = user && user.email ? user.email : "Usuario autenticado";
	}

	var groupNameEl = document.getElementById("groupName");
	var groupTypeEl = document.getElementById("groupType");
	var groupGradesEl = document.getElementById("groupGrades");

	if (groupNameEl) {
		groupNameEl.textContent = currentGroup.nombre || "Sin nombre";
	}
	if (groupTypeEl) {
		var typeMap = {
			multigrado: "Multigrado",
			bidocente: "Bidocente",
			tridocente: "Tridocente",
			normal: "Organización Completa",
		};
		groupTypeEl.textContent = typeMap[currentGroup.tipo_organizacion] || currentGroup.tipo_organizacion;
	}
	if (groupGradesEl) {
		groupGradesEl.textContent = currentGroup.grados || "N/A";
	}

	window.sb.auth.onAuthStateChange(function (event) {
		if (event === "SIGNED_OUT") {
			window.location.href = "index.html";
		}
	});

	if (logoutBtn) {
		logoutBtn.addEventListener("click", async function () {
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
});
