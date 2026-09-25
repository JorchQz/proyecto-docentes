/*
	Sala de Maestros (sala-maestros.html): la tercera sección de Jissez, aún "Próximamente".
	Será un espacio para compartir material didáctico entre maestras y maestros; por ahora
	solo presenta la idea. Sin formularios ni lecturas propias.

	Protegida como Mi Salón (js/saas-guard.js). Lleva el selector de secciones
	(js/secciones.js): la fila de marca arriba (en celular, solo logo y cuenta) y la barra de
	abajo en celular. Guarda "Sala" como la última sección cuando el candado confirma el acceso.
*/
document.addEventListener("DOMContentLoaded", function () {
	if (!window.Secciones) return;
	var encabezado = document.getElementById("salaEncabezado");
	var m = window.Secciones.montar({ actual: "sala", arriba: encabezado, movilArriba: true });

	m.cuenta.innerHTML =
		'<span class="jz-sec-nombre" id="salaNombre"></span>' +
		'<button type="button" class="jz-sec-boton" id="salaSalir">' +
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>' +
		"<span>Cerrar sesión</span></button>";

	if (window.saasAcceso) window.saasAcceso.then(function () { window.Secciones.guardarUltima("sala"); });

	if (!window.sb) return; // el candado ya saca de la página
	window.sb.auth.getSession().then(function (res) {
		var user = res && res.data && res.data.session ? res.data.session.user : null;
		if (!user) return;
		var meta = user.user_metadata || {};
		var nombre = (meta.nombre_docente || meta.full_name || user.email || "").trim();
		document.getElementById("salaNombre").textContent = nombre;
	}).catch(function () {});

	var salir = document.getElementById("salaSalir");
	salir.addEventListener("click", async function () {
		salir.disabled = true;
		salir.lastChild.textContent = "Cerrando…";
		var r = await window.sb.auth.signOut();
		if (r && r.error) {
			salir.disabled = false;
			salir.lastChild.textContent = "Cerrar sesión";
			return;
		}
		// Bajo /salon/ (la app instalable), al login de la app; fuera, a la tienda como siempre
		window.location.href = window.AppInstalada ? window.AppInstalada.salida("tienda/index.html") : "tienda/index.html";
	});
});
