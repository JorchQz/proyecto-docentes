/*
	Pantalla principal de tres partes (portal.html): Mi Salón, Tienda y Sala de Maestros.

	Solo la ven las cuentas con acceso al SaaS (el candado js/saas-guard.js manda a la
	tienda al resto). El nombre del saludo, el correo y "Cerrar sesión" los pone
	js/section-shell.js (#userName, #userEmail, #logoutBtn), igual que en el SaaS.

	Aquí solo se decide a dónde lleva la tarjeta Mi Salón: al panel, o al alta del grupo si
	la maestra aún no tiene uno.
*/

var Portal = (function () {
	// `res` es la respuesta de la lectura de grupos (limit 1). Con grupo, al panel; sin
	// grupo, al alta. Si la lectura falla no se afirma nada: se deja el panel, que revisa
	// el grupo por su cuenta y manda al alta si hace falta.
	function destinoMiSalon(res) {
		if (!res || res.error || !Array.isArray(res.data)) return { href: "dashboard.html", sinGrupo: false };
		if (res.data.length > 0) return { href: "dashboard.html", sinGrupo: false };
		return { href: "onboarding.html", sinGrupo: true };
	}

	function saludoPorHora(hora) {
		return hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
	}

	return { destinoMiSalon: destinoMiSalon, saludoPorHora: saludoPorHora };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Portal; // pruebas en node

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async function () {
	var ahora = new Date();
	document.getElementById("saludo").textContent = Portal.saludoPorHora(ahora.getHours());
	document.getElementById("fechaHoy").textContent = ahora.toLocaleDateString("es-MX", {
		weekday: "long", day: "numeric", month: "long", year: "numeric",
	});
	if (window.lucide) window.lucide.createIcons();

	if (!window.sb) return; // el candado ya saca de la página
	var sesion = await window.sb.auth.getSession();
	var user = sesion && sesion.data && sesion.data.session ? sesion.data.session.user : null;
	if (!user) return; // el candado manda al login

	// error-revisado-en: destinoMiSalon
	var grupos = await window.sb.from("grupos").select("id").eq("maestro_id", user.id).limit(1);
	var destino = Portal.destinoMiSalon(grupos);
	document.getElementById("cardMiSalon").setAttribute("href", destino.href);
	if (destino.sinGrupo) {
		document.getElementById("miSalonTexto").textContent = "Empieza por dar de alta tu grupo y tus alumnos; después llevas aquí asistencia, proyectos, evaluación y boletas.";
		document.getElementById("miSalonAccion").textContent = "Crear mi grupo";
	}
});
