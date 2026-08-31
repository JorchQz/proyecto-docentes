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
	// montarNav(activo, opts?)
	//   opts.anchors: [{href,label}] → en el landing, anclas de sección en el centro.
	//   opts.cta: {href,label,icon?} → botón verde de acción (p. ej. "Ver planeaciones").
	async function montarNav(activo, opts) {
		opts = opts || {};
		var session = await getSession();
		var admin = esAdmin(session);
		var nombre = nombreUsuario(session);
		var anchors = opts.anchors || null;
		// En el landing (con anclas + CTA) la barra es más ancha: usar breakpoint lg
		// para no amontonar en tablets; en el resto, md.
		var bp = anchors ? "lg" : "md";

		// Enlaces de navegación (centro). En el landing: enlaces de app relevantes + anclas
		// de sección; en el resto: los enlaces de la app.
		function navLinks(extraCls) {
			var items = [];
			if (anchors) {
				if (session) { items.push({ href: "mis-compras.html", label: "Mis compras", key: "mis-compras" }); }
				if (admin) { items.push({ href: "admin.html", label: "Admin", key: "admin" }); }
				anchors.forEach(function (a) { items.push({ href: a.href, label: a.label, key: null }); });
			} else {
				items.push({ href: "catalogo.html", label: "Catálogo", key: "catalogo" });
				if (session) { items.push({ href: "mis-compras.html", label: "Mis compras", key: "mis-compras" }); }
				if (admin) { items.push({ href: "admin.html", label: "Admin", key: "admin" }); }
			}
			return items.map(function (it) {
				var act = it.key && activo === it.key;
				var cls = act
					? "bg-white/15 text-white font-semibold"
					: "text-white/85 hover:bg-white/10 hover:text-white";
				return '<a href="' + it.href + '" class="' + (extraCls || "inline-flex items-center h-10 px-3.5 rounded-lg text-[15px] transition") + ' ' + cls + '">' + it.label + '</a>';
			}).join("");
		}

		// CTA opcional. Si hay CTA, "Iniciar sesión" pasa a estilo fantasma para no
		// duplicar botones verdes.
		var cta = opts.cta || null;
		var ctaDesktop = cta
			? '<a href="' + cta.href + '" class="inline-flex items-center gap-2 h-11 px-4 sm:px-5 rounded-xl text-white font-bold text-[15px] transition" style="background-color:#059669;box-shadow:0 8px 24px -12px rgba(5,150,105,.9)">' + (cta.icon ? '<i data-lucide="' + cta.icon + '" style="width:18px;height:18px"></i>' : '') + esc(cta.label) + '</a>'
			: '';
		var ctaMobile = cta
			? '<a href="' + cta.href + '" class="flex items-center justify-center gap-2 h-12 mt-2 rounded-xl text-white font-bold text-[15px]" style="background-color:#059669">' + esc(cta.label) + '</a>'
			: '';

		var loginDesktop = cta
			? '<a href="login.html" class="inline-flex items-center h-10 px-3.5 rounded-lg text-[15px] text-white/85 hover:bg-white/10 hover:text-white transition">Iniciar sesión</a>'
			: '<a href="login.html" class="inline-flex items-center h-11 px-4 sm:px-5 rounded-xl bg-action hover:bg-action-dark text-white font-bold text-[15px] transition" style="background-color:#059669;box-shadow:0 8px 24px -12px rgba(5,150,105,.9)">Iniciar sesión</a>';
		var loginMobile = cta
			? '<a href="login.html" class="flex items-center h-12 px-3 rounded-lg text-[15px] text-white/85 hover:bg-white/10 transition">Iniciar sesión</a>'
			: '<a href="login.html" class="flex items-center justify-center h-12 mt-2 rounded-xl text-white font-bold text-[15px]" style="background-color:#059669">Iniciar sesión</a>';

		// Lado derecho desktop: nombre + Salir, o Iniciar sesión.
		var derecha = "";
		if (session) {
			if (nombre) { derecha += '<span class="hidden lg:inline text-white/60 text-[13px] px-2 truncate max-w-[150px]">' + esc(nombre) + '</span>'; }
			derecha += '<button data-logout class="inline-flex items-center h-10 px-3.5 rounded-lg text-[15px] text-white/85 hover:bg-white/10 hover:text-white transition">Salir</button>';
		} else {
			derecha += loginDesktop;
		}

		// Bloque sesión/login para el menú móvil.
		var movilSesion = session
			? ((nombre ? '<span class="px-3 pt-3 mt-1 border-t border-white/10 text-white/55 text-[13px] truncate">' + esc(nombre) + '</span>' : '') +
				'<button data-logout class="flex items-center h-12 px-3 rounded-lg text-[15px] text-white/85 hover:bg-white/10 transition text-left">Salir</button>')
			: loginMobile;

		var html =
			'<header class="sticky top-0 z-50" style="background-color:#1e3a8a;background-image:radial-gradient(circle at 18% 12%,rgba(255,255,255,.08),transparent 38%),radial-gradient(circle at 86% 78%,rgba(255,255,255,.06),transparent 42%),radial-gradient(rgba(255,255,255,.05) .6px,transparent .6px);background-size:auto,auto,4px 4px;border-bottom:1px solid rgba(255,255,255,.1)">' +
			'<nav class="max-w-[1180px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">' +
			// Logo
			'<a href="index.html" class="shrink-0 flex items-center gap-2">' +
			'<img src="assets/jissez-wordmark-white.png" alt="Jissez" style="height:28px;width:auto" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'inline\'" />' +
			'<span style="display:none;color:#fff;font-weight:800;font-size:17px;letter-spacing:-.01em">Jissez</span>' +
			'</a>' +
			// Enlaces centro (solo desktop)
			'<div class="hidden ' + bp + ':flex items-center gap-1 min-w-0">' +
			navLinks() +
			'</div>' +
			// Lado derecho
			'<div class="flex items-center gap-2 shrink-0">' +
			'<div class="hidden ' + bp + ':flex items-center gap-2">' + derecha + ctaDesktop + '</div>' +
			// Botón hamburguesa (solo móvil)
			'<button data-menu-toggle class="' + bp + ':hidden inline-flex items-center justify-center w-11 h-11 rounded-xl text-white hover:bg-white/10 transition" aria-label="Menú" aria-expanded="false">' +
			'<i data-lucide="menu" style="width:24px;height:24px"></i>' +
			'</button>' +
			'</div>' +
			'</nav>' +
			// Menú móvil desplegable
			'<div data-mobile-menu class="hidden ' + bp + ':hidden border-t border-white/10" style="background-color:#16276b">' +
			'<div class="px-4 py-3 flex flex-col text-white/90 gap-0.5">' +
			navLinks("flex items-center h-12 px-3 rounded-lg text-[15px] transition") +
			movilSesion + ctaMobile +
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
			var pintarMenu = function (abrir) {
				menu.classList.toggle("hidden", !abrir);
				toggle.setAttribute("aria-expanded", String(abrir));
				toggle.innerHTML = '<i data-lucide="' + (abrir ? "x" : "menu") + '" style="width:24px;height:24px"></i>';
				iconos();
			};

			toggle.addEventListener("click", function () {
				pintarMenu(menu.classList.contains("hidden"));
			});

			// Elegir una opción cierra el menú. Con los enlaces de ancla es
			// imprescindible: la página salta a la sección pero el menú se queda
			// encima, tapando justo lo que se acaba de pedir ver.
			menu.addEventListener("click", function (e) {
				if (e.target.closest("a")) { pintarMenu(false); }
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
			'<a href="mailto:soporte@jissez.com" class="hover:text-ink transition">Contacto</a>' +
			'</div>' +
			'</div>' +
			'</footer>';
		var wrapper = document.createElement("div");
		wrapper.innerHTML = html;
		document.body.appendChild(wrapper.firstChild);
	}

	// Anima los elementos .reveal al entrar en viewport (respeta prefers-reduced-motion).
	function revelar() {
		var els = document.querySelectorAll(".reveal");
		if (!els.length) { return; }
		if (!("IntersectionObserver" in window) ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			els.forEach(function (el) { el.classList.add("in"); });
			return;
		}
		var obs = new IntersectionObserver(function (entries) {
			entries.forEach(function (e) {
				if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
			});
		}, { threshold: 0.12 });
		els.forEach(function (el) { obs.observe(el); });
	}

	// ── Portadas desde las imágenes de vista previa ───────────────────────────
	// Las tarjetas del catálogo y de la portada reutilizan la primera imagen de
	// `previews/<slug>/` — la misma carpeta que alimenta la galería de la ficha,
	// para que subir las imágenes una vez sirva para todo. Mientras la carpeta
	// esté vacía, quien llama se queda con su marcador rayado.
	function slugPreview(org, grado, combo) {
		return org === "multigrado"
			? "multi-" + (combo || "")
			: "grado-" + grado;
	}

	var portadaCache = {}; // slug → Promise<url|null>; evita repedir al filtrar

	function portadaPreview(slug) {
		if (!slug || !window.sb) { return Promise.resolve(null); }
		if (portadaCache[slug]) { return portadaCache[slug]; }

		portadaCache[slug] = window.sb.storage
			.from("assets")
			.list("previews/" + slug, { limit: 10, sortBy: { column: "name", order: "asc" } })
			.then(function (r) {
				if (r.error || !r.data) { return null; }
				// El listado incluye un marcador de carpeta vacía; fuera.
				var img = r.data.filter(function (f) {
					return f.name && /\.(jpe?g|png|webp)$/i.test(f.name);
				})[0];
				if (!img) { return null; }
				return window.sb.storage.from("assets")
					.getPublicUrl("previews/" + slug + "/" + img.name).data.publicUrl;
			})
			.catch(function () { return null; });

		return portadaCache[slug];
	}

	// Cambia el marcador rayado por la portada real, si la hay. Se llama después
	// de pintar la tarjeta: así el grid aparece de inmediato y las imágenes van
	// entrando sin bloquear el render.
	function pintarPortada(contenedor, slug, alt) {
		portadaPreview(slug).then(function (url) {
			if (!url || !contenedor) { return; }
			contenedor.classList.remove("ph");
			contenedor.textContent = "";
			contenedor.style.background = "#f1f0ea";
			// Un 10% baja el encuadre apenas por debajo del borde: se ve el
			// encabezado de la hoja sin el margen blanco superior.
			contenedor.innerHTML = '<img src="' + esc(url) + '" alt="' + esc(alt || "") +
				'" class="w-full h-full object-cover" style="object-position:center 10%" loading="lazy">';
		});
	}

	// ── Visor ampliado compartido ─────────────────────────────────────────────
	// Pantalla completa para las páginas de muestra: un clic acerca al punto
	// señalado, el arrastre o el scroll recorren la página, las flechas navegan
	// y Escape o el fondo cierran. Lo usan la ficha de producto y el landing.
	// El markup se inyecta en el primer uso para no repetirlo en cada página.
	var visorEl = null, visorScroll, visorImg, visorEtiqueta, visorContador, visorPrev, visorNext;
	var visorImgs = [], visorIdx = 0, visorOnCambio = null, visorZoom = false;
	var visorArrastre = null, visorSeMovio = false;

	function visorMontar() {
		if (visorEl) { return; }
		visorEl = document.createElement("div");
		visorEl.className = "hidden fixed inset-0";
		visorEl.style.zIndex = "70";
		visorEl.setAttribute("role", "dialog");
		visorEl.setAttribute("aria-modal", "true");
		visorEl.setAttribute("aria-label", "Vista previa ampliada");
		visorEl.innerHTML =
			'<div class="absolute inset-0" style="background:rgba(28,36,52,.92)"></div>' +
			'<div data-visor-scroll class="absolute inset-0 overflow-auto overscroll-contain flex">' +
			'<img data-visor-img alt="Página de muestra ampliada" class="m-auto max-w-full max-h-full object-contain select-none cursor-zoom-in" draggable="false">' +
			'</div>' +
			'<span data-visor-etiqueta class="absolute top-4 left-4 text-[11px] font-bold px-2.5 py-1 rounded-full pointer-events-none" style="background:rgba(30,58,138,.9);color:#fff"></span>' +
			'<button data-visor-cerrar type="button" aria-label="Cerrar" class="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-white transition" style="background:rgba(255,255,255,.14)"><i data-lucide="x" class="w-5 h-5"></i></button>' +
			'<button data-visor-prev type="button" aria-label="Anterior" class="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-white transition" style="background:rgba(255,255,255,.14)"><i data-lucide="chevron-left" class="w-5 h-5"></i></button>' +
			'<button data-visor-next type="button" aria-label="Siguiente" class="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-white transition" style="background:rgba(255,255,255,.14)"><i data-lucide="chevron-right" class="w-5 h-5"></i></button>' +
			'<span data-visor-contador class="absolute bottom-4 right-4 text-[11px] font-semibold px-2.5 py-1 rounded-full pointer-events-none" style="background:rgba(28,36,52,.75);color:#fff"></span>';
		document.body.appendChild(visorEl);

		visorScroll = visorEl.querySelector("[data-visor-scroll]");
		visorImg = visorEl.querySelector("[data-visor-img]");
		visorEtiqueta = visorEl.querySelector("[data-visor-etiqueta]");
		visorContador = visorEl.querySelector("[data-visor-contador]");
		visorPrev = visorEl.querySelector("[data-visor-prev]");
		visorNext = visorEl.querySelector("[data-visor-next]");

		visorEl.querySelector("[data-visor-cerrar]").addEventListener("click", visorCerrar);
		visorPrev.addEventListener("click", function () { visorIr(visorIdx - 1); });
		visorNext.addEventListener("click", function () { visorIr(visorIdx + 1); });

		visorImg.addEventListener("click", function (e) {
			if (visorSeMovio) { return; }
			if (visorZoom) { visorAjustar(); return; }
			// Acerca centrando el punto donde se hizo clic, no la esquina.
			var rect = visorImg.getBoundingClientRect();
			var fx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
			var fy = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
			visorZoom = true;
			visorImg.classList.remove("max-w-full", "max-h-full", "cursor-zoom-in");
			visorImg.classList.add("max-w-none", "max-h-none", "cursor-zoom-out");
			visorImg.style.width = Math.round(visorScroll.clientWidth * 1.8) + "px";
			requestAnimationFrame(function () {
				visorScroll.scrollLeft = visorImg.clientWidth * fx - visorScroll.clientWidth / 2;
				visorScroll.scrollTop = visorImg.clientHeight * fy - visorScroll.clientHeight / 2;
			});
		});

		// Arrastre con mouse para recorrer la página ampliada; en táctil el
		// scroll nativo ya lo hace. Tras arrastrar, el click no cambia el zoom.
		visorScroll.addEventListener("pointerdown", function (e) {
			if (e.pointerType !== "mouse") { return; }
			visorArrastre = { x: e.clientX, y: e.clientY, sl: visorScroll.scrollLeft, st: visorScroll.scrollTop };
			visorSeMovio = false;
		});
		visorScroll.addEventListener("pointermove", function (e) {
			if (!visorArrastre) { return; }
			var dx = e.clientX - visorArrastre.x;
			var dy = e.clientY - visorArrastre.y;
			if (Math.abs(dx) + Math.abs(dy) > 6) { visorSeMovio = true; }
			visorScroll.scrollLeft = visorArrastre.sl - dx;
			visorScroll.scrollTop = visorArrastre.st - dy;
		});
		window.addEventListener("pointerup", function () { visorArrastre = null; });

		// Clic en el fondo oscuro (fuera de la imagen) cierra.
		visorScroll.addEventListener("click", function (e) {
			if (e.target === visorScroll && !visorSeMovio) { visorCerrar(); }
		});

		document.addEventListener("keydown", function (e) {
			if (!visorAbierto()) { return; }
			if (e.key === "Escape") { visorCerrar(); }
			if (e.key === "ArrowLeft") { visorIr(visorIdx - 1); }
			if (e.key === "ArrowRight") { visorIr(visorIdx + 1); }
		});

		iconos();
	}

	function visorAjustar() {
		visorZoom = false;
		visorImg.classList.add("max-w-full", "max-h-full", "cursor-zoom-in");
		visorImg.classList.remove("max-w-none", "max-h-none", "cursor-zoom-out");
		visorImg.style.width = "";
	}

	function visorIr(i) {
		if (!visorImgs.length) { return; }
		visorIdx = (i + visorImgs.length) % visorImgs.length;
		var im = visorImgs[visorIdx];
		visorImg.src = im.url;
		visorEtiqueta.textContent = im.etiqueta || "";
		visorContador.textContent = (visorIdx + 1) + " / " + visorImgs.length;
		visorAjustar();
		if (visorOnCambio) { visorOnCambio(visorIdx); }
	}

	// imagenes: [{url, etiqueta}]. onCambio (opcional) recibe el índice cada vez
	// que el visor cambia de página, para que la galería de atrás lo siga.
	function visorAbrir(imagenes, idx, onCambio) {
		if (!imagenes || !imagenes.length) { return; }
		visorMontar();
		visorImgs = imagenes;
		visorOnCambio = onCambio || null;
		var soloUna = imagenes.length < 2;
		visorPrev.classList.toggle("hidden", soloUna);
		visorNext.classList.toggle("hidden", soloUna);
		visorEl.classList.remove("hidden");
		document.body.style.overflow = "hidden";
		visorIr(idx || 0);
	}

	function visorCerrar() {
		if (!visorEl) { return; }
		visorEl.classList.add("hidden");
		document.body.style.overflow = "";
	}

	function visorAbierto() {
		return !!(visorEl && !visorEl.classList.contains("hidden"));
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
		revelar: revelar,
		slugPreview: slugPreview,
		portadaPreview: portadaPreview,
		pintarPortada: pintarPortada,
		visorAbrir: visorAbrir,
		visorCerrar: visorCerrar,
		visorAbierto: visorAbierto,
	};
})();
