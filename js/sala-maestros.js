/*
	Sala de Maestros (sala-maestros.html): la tercera sección de Jissez, aún "Próximamente".
	Será un espacio para compartir material didáctico entre maestras y maestros; por ahora
	solo presenta la idea. Sin formularios ni lecturas propias.

	Protegida como Mi Salón (js/saas-guard.js). La navegación es la misma de Mi Salón
	(js/navbar.js con data-seccion="sala"): barra lateral en PC, encabezado y barra de abajo
	en celular, con el selector de secciones y la cuenta (Cerrar sesión pide confirmar si hay
	capturas de Hoy sin enviar, js/bandeja-salida.js). Aquí solo se guarda "Sala" como la
	última sección cuando el candado confirma el acceso.
*/
document.addEventListener("DOMContentLoaded", function () {
	if (!window.Secciones) return;
	if (window.saasAcceso) window.saasAcceso.then(function () { window.Secciones.guardarUltima("sala"); });
});
