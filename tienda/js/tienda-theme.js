// Tokens de diseño compartidos para Tailwind (CDN).
// Cargar SIEMPRE justo después de https://cdn.tailwindcss.com y antes del render,
// para que el CDN lea esta config. Reemplaza los bloques tailwind.config inline.
window.tailwind = window.tailwind || {};
tailwind.config = {
	theme: {
		extend: {
			colors: {
				board: { DEFAULT: '#1e3a8a', deep: '#16276b', soft: '#26499f' },
				chalk: '#f6f8fe',
				ink: '#1c2434',
				mute: '#5b6473',
				line: '#e7e6df',
				action: { DEFAULT: '#059669', dark: '#047a55' },
				paper: '#faf9f4',
				gisAmarillo: '#f2cf6b',
				gisCoral: '#ef9277',
				gisMenta: '#79c8a6',
				gisLavanda: '#a99fe0',
				gisCielo: '#85b8e6',
				gisDurazno: '#f0b285',
			},
			fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
			maxWidth: { content: '1180px' },
		},
	},
};


// Encabezado de una cuenta con Mi Salón: su espacio se aparta desde el primer pintado
// (html.jz-sec-reserva, tienda/css/tienda.css) para que el contenido no brinque cuando
// entra el encabezado con el selector de secciones. Misma regla que saasProbable() en
// tienda-common.js, que es quien lo libera: la cuenta con sesión en este navegador y
// "jissez.saas.<id>" = "1" en la pestaña o, si la pestaña no sabe, en el dispositivo.
// A un comprador o visitante no se le aparta nada. El login y el anexo no llevan ese
// encabezado.
(function () {
	try {
		// jissez.com sirve las páginas sin ".html" (/tienda/login); en local llevan la extensión
		if (/\/(login|anexo)(\.html)?$/.test(location.pathname)) return;
		var uid = null;
		for (var i = 0; i < localStorage.length && !uid; i++) {
			var k = localStorage.key(i);
			if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
			var s = JSON.parse(localStorage.getItem(k) || "null");
			var u = s && (s.user || (s.currentSession && s.currentSession.user));
			if (u && u.id) uid = u.id;
		}
		if (!uid) return;
		var clave = "jissez.saas." + uid;
		var ya = sessionStorage.getItem(clave);
		if (ya === "1" || (ya !== "0" && localStorage.getItem(clave) === "1")) {
			document.documentElement.classList.add("jz-sec-reserva");
		}
	} catch (_) {}
})();
