// Utilidades compartidas por todas las páginas de la tienda.
// Expone el objeto global `Tienda`.
(function () {
	var SUPABASE_URL =
		window.SUPABASE_URL || "https://cluvaxxqvhtxxiwctpnl.supabase.co";
	var EDGE_BASE = SUPABASE_URL + "/functions/v1";
	var ADMIN_EMAIL = "jorgequezadarm@gmail.com";

	// Colores por campo formativo (del brand system).
	var CF_COLOR = {
		LEN: { bg: "bg-green-100", text: "text-green-800", nombre: "Lenguajes" },
		SAB: { bg: "bg-orange-100", text: "text-orange-800", nombre: "Saberes y Pensamiento Científico" },
		DHL: { bg: "bg-blue-100", text: "text-blue-800", nombre: "De lo Humano y lo Comunitario" },
		ETI: { bg: "bg-yellow-100", text: "text-yellow-800", nombre: "Ética, Naturaleza y Sociedades" },
	};

	function esc(str) {
		return String(str == null ? "" : str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function formatMoney(n) {
		var num = Number(n || 0);
		return "$" + num.toLocaleString("es-MX", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}) + " MXN";
	}

	// Convierte los <i data-lucide="..."> presentes en SVG. Llamar tras render dinámico.
	function iconos() {
		if (window.lucide && typeof window.lucide.createIcons === "function") {
			window.lucide.createIcons();
		}
	}

	var toastEl = null;
	function toast(mensaje, tipo) {
		if (toastEl) { toastEl.remove(); }
		toastEl = document.createElement("div");
		var bg = tipo === "error" ? "bg-red-600" : (tipo === "info" ? "bg-blue-700" : "bg-emerald-600");
		toastEl.className =
			"fixed bottom-5 right-5 z-50 " + bg +
			" text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs";
		toastEl.textContent = mensaje;
		document.body.appendChild(toastEl);
		var ref = toastEl;
		setTimeout(function () {
			if (toastEl === ref) { ref.remove(); toastEl = null; }
		}, 3800);
	}

	// Sesión actual (o null).
	async function getSession() {
		if (!window.sb) { return null; }
		var res = await window.sb.auth.getSession();
		if (res.error || !res.data.session) { return null; }
		return res.data.session;
	}

	// Redirige a login si no hay sesión; devuelve la sesión si la hay.
	async function requireSession(redirectTo) {
		var session = await getSession();
		if (!session) {
			var dest = redirectTo || ("login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search));
			location.href = dest;
			return null;
		}
		return session;
	}

	function getAccessToken(session) {
		return session && session.access_token ? session.access_token : null;
	}

	function esAdmin(session) {
		var email = session && session.user && session.user.email;
		return String(email || "").toLowerCase() === ADMIN_EMAIL;
	}

	function nombreUsuario(session) {
		if (!session || !session.user) { return ""; }
		var m = session.user.user_metadata || {};
		return m.full_name || m.nombre_docente || session.user.email || "";
	}

	// Llama a una Edge Function que devuelve un archivo binario y dispara la
	// descarga en el navegador. Requiere token de sesión.
	async function descargarArchivo(params, nombreSugerido, session) {
		var token = getAccessToken(session);
		if (!token) { throw new Error("Sesión requerida"); }
		var qs = new URLSearchParams(params).toString();
		var resp = await fetch(EDGE_BASE + "/descargar-archivo?" + qs, {
			headers: { Authorization: "Bearer " + token },
		});
		if (!resp.ok) {
			var msg = "No se pudo descargar el archivo.";
			try { var j = await resp.json(); if (j.error) { msg = j.error; } } catch (_) {}
			throw new Error(msg);
		}
		var blob = await resp.blob();
		var url = URL.createObjectURL(blob);
		var a = document.createElement("a");
		a.href = url;
		a.download = nombreSugerido || "archivo";
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
	}

	// Header/navegación compartido. Se inserta al inicio del body.
	async function montarNav(activo) {
		var session = await getSession();
		var admin = esAdmin(session);
		var nombre = nombreUsuario(session);

		function link(href, label, key) {
			var act = activo === key;
			var cls = act
				? "text-white bg-blue-700"
				: "text-blue-100 hover:text-white hover:bg-blue-700";
			return '<a href="' + href + '" class="inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors ' + cls + '">' + label + "</a>";
		}

		var derecha = "";
		if (session) {
			derecha += link("mis-compras.html", "Mis compras", "mis-compras");
			if (admin) { derecha += link("admin.html", "Admin", "admin"); }
			derecha += '<button id="tiendaLogoutBtn" class="inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium text-blue-100 hover:text-white hover:bg-blue-700 transition-colors">Salir</button>';
		} else {
			derecha += link("login.html", "Iniciar sesión", "login");
		}

		var html =
			'<nav class="fixed top-0 left-0 right-0 z-30 bg-blue-900 shadow-md">' +
			'<div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2">' +
			'<div class="flex items-center gap-1 min-w-0">' +
			'<a href="index.html" class="font-bold text-white text-base mr-2 shrink-0">Planeaciones NEM</a>' +
			link("catalogo.html", "Catálogo", "catalogo") +
			"</div>" +
			'<div class="flex items-center gap-1 shrink-0">' +
			(nombre && session ? '<span class="hidden sm:inline text-blue-200 text-xs mr-1 truncate max-w-[140px]">' + esc(nombre) + "</span>" : "") +
			derecha +
			"</div></div></nav>";

		var wrapper = document.createElement("div");
		wrapper.innerHTML = html;
		document.body.insertBefore(wrapper.firstChild, document.body.firstChild);
		iconos();

		var logoutBtn = document.getElementById("tiendaLogoutBtn");
		if (logoutBtn) {
			logoutBtn.addEventListener("click", async function () {
				logoutBtn.disabled = true;
				logoutBtn.textContent = "Saliendo...";
				if (window.sb) { await window.sb.auth.signOut(); }
				location.href = "index.html";
			});
		}

		return session;
	}

	window.Tienda = {
		SUPABASE_URL: SUPABASE_URL,
		EDGE_BASE: EDGE_BASE,
		ADMIN_EMAIL: ADMIN_EMAIL,
		CF_COLOR: CF_COLOR,
		esc: esc,
		formatMoney: formatMoney,
		iconos: iconos,
		toast: toast,
		getSession: getSession,
		requireSession: requireSession,
		getAccessToken: getAccessToken,
		esAdmin: esAdmin,
		nombreUsuario: nombreUsuario,
		descargarArchivo: descargarArchivo,
		montarNav: montarNav,
	};
})();
