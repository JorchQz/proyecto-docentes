// Utilidades compartidas por todas las páginas de la tienda.
// Expone el objeto global `Tienda`.
(function () {
	var SUPABASE_URL =
		window.SUPABASE_URL || "https://cluvaxxqvhtxxiwctpnl.supabase.co";
	var EDGE_BASE = SUPABASE_URL + "/functions/v1";
	var ADMIN_EMAIL = "jorgequezadarm@gmail.com";

	// Colores por campo formativo (design tokens).
	var CF_COLOR = {
		LEN: { bg: "bg-gisMenta/25", text: "text-action-dark", nombre: "Lenguajes" },
		SAB: { bg: "bg-gisCoral/25", text: "text-gisCoral", nombre: "Saberes y Pensamiento Científico" },
		DHL: { bg: "bg-gisCielo/25", text: "text-board", nombre: "De lo Humano y lo Comunitario" },
		ETI: { bg: "bg-gisAmarillo/25", text: "text-amber-800", nombre: "Ética, Naturaleza y Sociedades" },
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
		var bg = tipo === "error"
			? "background:#dc2626"
			: (tipo === "info" ? "background:#1e3a8a" : "background:#059669");
		toastEl.setAttribute("style",
			"position:fixed;bottom:1.25rem;right:1.25rem;z-index:9999;" + bg +
			";color:#fff;padding:.75rem 1rem;border-radius:.75rem;box-shadow:0 10px 28px -8px rgba(0,0,0,.35);font-size:.875rem;font-weight:500;max-width:20rem");
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

		// Enlaces de navegación (centro). Visibles en desktop y dentro del menú móvil.
		function navLinks(extraCls) {
			var items = [{ href: "catalogo.html", label: "Catálogo", key: "catalogo" }];
			if (session) { items.push({ href: "mis-compras.html", label: "Mis compras", key: "mis-compras" }); }
			if (admin) { items.push({ href: "admin.html", label: "Admin", key: "admin" }); }
			return items.map(function (it) {
				var act = activo === it.key;
				var cls = act
					? "bg-white/15 text-white font-semibold"
					: "text-white/85 hover:bg-white/10 hover:text-white";
				return '<a href="' + it.href + '" class="' + (extraCls || "inline-flex items-center h-10 px-3.5 rounded-lg text-[15px] transition") + ' ' + cls + '">' + it.label + '</a>';
			}).join("");
		}

		// Lado derecho desktop: nombre + Salir, o Iniciar sesión.
		var derecha = "";
		if (session) {
			if (nombre) { derecha += '<span class="hidden lg:inline text-white/60 text-[13px] px-2 truncate max-w-[150px]">' + esc(nombre) + '</span>'; }
			derecha += '<button data-logout class="inline-flex items-center h-10 px-3.5 rounded-lg text-[15px] text-white/85 hover:bg-white/10 hover:text-white transition">Salir</button>';
		} else {
			derecha += '<a href="login.html" class="inline-flex items-center h-11 px-4 sm:px-5 rounded-xl bg-action hover:bg-action-dark text-white font-bold text-[15px] transition" style="background-color:#059669;box-shadow:0 8px 24px -12px rgba(5,150,105,.9)">Iniciar sesión</a>';
		}

		var html =
			'<header class="sticky top-0 z-50" style="background-color:#1e3a8a;background-image:radial-gradient(circle at 18% 12%,rgba(255,255,255,.08),transparent 38%),radial-gradient(circle at 86% 78%,rgba(255,255,255,.06),transparent 42%),radial-gradient(rgba(255,255,255,.05) .6px,transparent .6px);background-size:auto,auto,4px 4px;border-bottom:1px solid rgba(255,255,255,.1)">' +
			'<nav class="max-w-[1180px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">' +
			// Logo
			'<a href="index.html" class="shrink-0 flex items-center gap-2">' +
			'<img src="assets/jissez-wordmark-white.png" alt="Jissez" style="height:28px;width:auto" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'inline\'" />' +
			'<span style="display:none;color:#fff;font-weight:800;font-size:17px;letter-spacing:-.01em">Jissez</span>' +
			'</a>' +
			// Enlaces centro (solo desktop)
			'<div class="hidden md:flex items-center gap-1 min-w-0">' +
			navLinks() +
			'</div>' +
			// Lado derecho
			'<div class="flex items-center gap-2 shrink-0">' +
			'<div class="hidden md:flex items-center gap-1">' + derecha + '</div>' +
			// Botón hamburguesa (solo móvil)
			'<button data-menu-toggle class="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl text-white hover:bg-white/10 transition" aria-label="Menú" aria-expanded="false">' +
			'<i data-lucide="menu" style="width:24px;height:24px"></i>' +
			'</button>' +
			'</div>' +
			'</nav>' +
			// Menú móvil desplegable
			'<div data-mobile-menu class="hidden md:hidden border-t border-white/10" style="background-color:#16276b">' +
			'<div class="px-4 py-3 flex flex-col text-white/90 gap-0.5">' +
			navLinks("flex items-center h-12 px-3 rounded-lg text-[15px] transition") +
			(session
				? (nombre ? '<span class="px-3 pt-3 mt-1 border-t border-white/10 text-white/55 text-[13px] truncate">' + esc(nombre) + '</span>' : '') +
					'<button data-logout class="flex items-center h-12 px-3 rounded-lg text-[15px] text-white/85 hover:bg-white/10 transition text-left">Salir</button>'
				: '<a href="login.html" class="flex items-center justify-center h-12 mt-2 rounded-xl text-white font-bold text-[15px]" style="background-color:#059669">Iniciar sesión</a>') +
			'</div>' +
			'</div>' +
			'</header>';

		var wrapper = document.createElement("div");
		wrapper.innerHTML = html;
		var header = wrapper.firstChild;
		document.body.insertBefore(header, document.body.firstChild);
		iconos();

		// Toggle del menú móvil.
		var toggle = header.querySelector("[data-menu-toggle]");
		var menu = header.querySelector("[data-mobile-menu]");
		if (toggle && menu) {
			toggle.addEventListener("click", function () {
				var abierto = !menu.classList.contains("hidden");
				menu.classList.toggle("hidden", abierto);
				toggle.setAttribute("aria-expanded", String(!abierto));
				toggle.innerHTML = '<i data-lucide="' + (abierto ? "menu" : "x") + '" style="width:24px;height:24px"></i>';
				iconos();
			});
		}

		// Cerrar sesión (botón desktop y móvil).
		header.querySelectorAll("[data-logout]").forEach(function (btn) {
			btn.addEventListener("click", async function () {
				header.querySelectorAll("[data-logout]").forEach(function (b) { b.disabled = true; b.textContent = "Saliendo..."; });
				if (window.sb) { await window.sb.auth.signOut(); }
				location.href = "index.html";
			});
		});

		return session;
	}

	// Footer claro compartido para páginas internas. Se agrega al final del body.
	function montarFooter() {
		if (document.querySelector("footer[data-tienda-footer]")) { return; }
		var anio = new Date().getFullYear();
		var html =
			'<footer data-tienda-footer class="mt-12 border-t border-line bg-white">' +
			'<div class="max-w-[1180px] mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-mute">' +
			'<img src="assets/jissez-wordmark-blue.png" alt="Jissez" style="height:24px;width:auto" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'inline\'" />' +
			'<span style="display:none;color:#1e3a8a;font-weight:800">Jissez</span>' +
			'<p>© ' + anio + ' Jissez · Planeaciones NEM</p>' +
			'<div class="flex gap-5">' +
			'<a href="index.html" class="hover:text-ink transition">Inicio</a>' +
			'<a href="catalogo.html" class="hover:text-ink transition">Catálogo</a>' +
			'<a href="mailto:jorgequezadarm@gmail.com" class="hover:text-ink transition">Contacto</a>' +
			'</div>' +
			'</div>' +
			'</footer>';
		var wrapper = document.createElement("div");
		wrapper.innerHTML = html;
		document.body.appendChild(wrapper.firstChild);
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
		montarFooter: montarFooter,
	};
})();
