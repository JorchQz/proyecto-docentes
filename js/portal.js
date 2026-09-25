/* global Secciones */
/*
	portal.html ya no es una pantalla (decisión de Jorge, 2026-09-25): la "pantalla principal"
	de tres tarjetas se cambió por el selector de secciones (js/secciones.js), que está en
	todas las páginas de las cuentas con acceso. Queda solo como redirección, para no romper
	enlaces viejos:

	- sin sesión o sin acceso: el candado (js/saas-guard.js) saca a la tienda, como antes;
	- con acceso: a la última sección que usó en este dispositivo (la primera vez, Mi Salón).
	  Mi Salón abre el panel, que manda al alta del grupo si aún no tiene uno.

	Espera a que el candado confirme el acceso (window.saasAcceso) para no adelantarse a él.
*/

var Portal = (function () {
	// Ruta (desde la raíz) a la que redirige portal.html
	function destino(ultima) {
		return typeof Secciones !== "undefined" && Secciones ? Secciones.ruta(ultima) : "dashboard.html";
	}
	return { destino: destino };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Portal; // pruebas en node

if (typeof document !== "undefined" && window.saasAcceso) {
	window.saasAcceso.then(function () {
		var ultima = typeof Secciones !== "undefined" && Secciones ? Secciones.leerUltima() : null;
		window.location.replace(Portal.destino(ultima));
	});
}
