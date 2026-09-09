// Utilidades compartidas por todas las páginas de la tienda.
// Expone el objeto global `Tienda`.
(function () {
	var SUPABASE_URL =
		window.SUPABASE_URL || "https://cluvaxxqvhtxxiwctpnl.supabase.co";
	var EDGE_BASE = SUPABASE_URL + "/functions/v1";
	// Espejo de es_admin() en la base (supabase/admin_cuenta_jissez.sql). Aquí
	// solo decide qué enlaces se muestran; la seguridad real es la RPC.
	var ADMIN_EMAIL = "soporte.jissez@gmail.com";

	// Color del descuento. ROJO en toda la tienda: es con el que el comprador
	// reconoce una rebaja de un vistazo. El verde de la marca (#059669) se
	// queda para acciones y estados ("pagado", "activo", "entrega en X horas"),
	// nunca para anunciar un precio rebajado.
	//
	// Cualquier etiqueta nueva que anuncie descuento debe usar estos valores en
	// vez de escribir el hex a mano, para que no vuelvan a convivir dos colores.
	var COLOR_DESCUENTO = {
		texto: "#b91c1c",              // sobre fondo claro
		fondo: "rgba(220,38,38,.08)",  // relleno suave del badge
		borde: "rgba(220,38,38,.25)",
		solido: "#dc2626",             // chip con texto blanco
	};

	// Colores por campo formativo (design tokens). `hex` es el color NEM que se
	// usa en render dinámico (estilo en línea), porque Tailwind CDN no genera
	// las clases con opacidad arbitraria que aparecen en cadenas construidas.
	var CF_COLOR = {
		LEN: { bg: "bg-gisMenta/25", text: "text-action-dark", nombre: "Lenguajes", corto: "Lenguajes", hex: "#059669" },
		SAB: { bg: "bg-gisCoral/25", text: "text-gisCoral", nombre: "Saberes y Pensamiento Científico", corto: "Saberes", hex: "#ea580c" },
		ETI: { bg: "bg-gisAmarillo/25", text: "text-amber-800", nombre: "Ética, Naturaleza y Sociedades", corto: "Ética", hex: "#7c3aed" },
		DHL: { bg: "bg-gisCielo/25", text: "text-board", nombre: "De lo Humano y lo Comunitario", corto: "Humano", hex: "#0284c7" },
	};
	var CF_ORDEN = ["LEN", "SAB", "ETI", "DHL"];

	// Colores de gis por grado. Vivía copiado en cuatro archivos (catálogo,
	// ficha, Mis compras y biblioteca); aquí queda una sola vez.
	var GRADO_COLOR = {
		"1": { bg: "#f2cf6b", txt: "rgba(30,58,138,.85)" },
		"2": { bg: "#ef9277", txt: "#fff" },
		"3": { bg: "#79c8a6", txt: "rgba(30,58,138,.85)" },
		"4": { bg: "#a99fe0", txt: "#fff" },
		"5": { bg: "#85b8e6", txt: "rgba(30,58,138,.85)" },
		"6": { bg: "#f0b285", txt: "rgba(30,58,138,.85)" },
	};

	// Precio en columna (lista tachada arriba, final abajo) para tarjetas de
	// opción estrechas: en una fila, en el celular la línea se partía a medias.
	function precioColumna(lista, opts) {
		opts = opts || {};
		var final = precioFinal(lista);
		var cFinal = opts.claseFinal || "font-black text-lg text-ink";
		var cLista = opts.claseLista || "text-[12px] font-bold text-mute";
		if (final < Number(lista)) {
			return '<span class="inline-flex flex-col items-end leading-tight"><s class="' + cLista + '">' + montoCorto(lista) + "</s>" +
				'<span class="' + cFinal + '">' + montoCorto(final) + "</span></span>";
		}
		return '<span class="' + cFinal + '">' + montoCorto(final) + "</span>";
	}

	// Tarjeta de opción (radio grande) para elegir versión: título y detalle a
	// la izquierda, precio en columna a la derecha. La usan la ficha del
	// proyecto individual y el formulario de personalizados.
	function opcionVersion(o, seleccionada) {
		return '<button type="button" data-opcion="' + esc(o.valor) + '" class="opt-btn w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3' + (seleccionada ? " selected" : " border-line bg-white") + '">' +
			'<span class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center" style="border-color:' + (seleccionada ? "#fff" : "#9ba3af") + '">' + (seleccionada ? '<span class="w-2.5 h-2.5 rounded-full" style="background:#fff"></span>' : "") + "</span>" +
			'<span class="min-w-0 flex-1"><span class="block font-bold leading-snug">' + esc(o.titulo) + '</span><span class="block text-[13px] leading-snug mt-0.5' + (seleccionada ? " opacity-90" : " text-mute") + '">' + esc(o.sub) + "</span></span>" +
			'<span class="shrink-0 pl-2">' + precioColumna(o.precio, {
				claseFinal: "font-black text-lg" + (seleccionada ? "" : " text-ink"),
				claseLista: "text-[12px] font-bold" + (seleccionada ? " opacity-80" : " text-mute"),
			}) + "</span></button>";
	}

	// ── Buscador de selección múltiple (contenidos y PDAs) ────────────────────
	// Lo usan el catálogo de proyectos y el formulario de personalizados. La lista va
	// en el flujo de la página (no flota, así no tapa la casilla de abajo) y
	// tiene su propio estado abierta/cerrada, sin depender del foco: en tableta
	// y celular tocar la lista quita el foco a la casilla antes de registrar
	// la elección. Se cierra al tocar fuera o con Escape; al elegir se queda
	// abierta y repintada para seguir eligiendo varios.
	//
	//   buscar(consulta) → { items: [{ id, texto, sub?, prefijo?, cf?, elegido }], encabezado?, vacio? }
	//   elegir(id)       → agrega la selección (quien llama repinta sus chips)
	function combobox(input, lista, buscar, elegir) {
		var abierta = false;
		var MAX = 40;

		function pintar() {
			var consulta = input.value.trim();
			var r = buscar(consulta) || { items: [] };
			var items = r.items || [];
			if (!items.length) {
				lista.innerHTML = '<p class="px-3.5 py-3 text-sm ' + (r.vacio ? "font-semibold" : "text-mute") + '" style="' + (r.vacio ? "color:#b45309" : "") + '">' +
					esc(r.vacio || (consulta ? "Sin coincidencias. Prueba con otra palabra." : "No hay opciones con los filtros elegidos.")) + "</p>";
				return;
			}
			lista.innerHTML =
				(r.encabezado ? '<p class="px-3.5 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-mute">' + esc(r.encabezado) + "</p>" : "") +
				items.slice(0, MAX).map(function (it) {
					var color = (it.cf && CF_COLOR[it.cf]) ? CF_COLOR[it.cf].hex : "#5b6473";
					return '<button type="button" data-elegir="' + esc(it.id) + '" class="w-full text-left px-3.5 py-2.5 text-sm flex items-start gap-2 hover:bg-paper transition' + (it.elegido ? " opacity-50" : "") + '">' +
						'<span class="w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]" style="background:' + color + '"></span>' +
						'<span class="leading-snug" style="color:#1c2434">' + (it.prefijo ? '<span class="font-semibold">' + esc(it.prefijo) + "</span> " : "") + esc(it.texto) +
						(it.sub ? '<span class="block text-[12px] text-mute">' + esc(it.sub) + "</span>" : "") +
						(it.elegido ? '<span class="block text-[11px] font-semibold" style="color:#047857">Ya elegido</span>' : "") + "</span></button>";
				}).join("") + (items.length > MAX ? '<p class="px-3.5 py-2 text-[12px] text-mute">Hay más: escribe una palabra para acotar.</p>' : "");
		}
		function abrir() { abierta = true; pintar(); lista.classList.remove("hidden"); }
		function cerrar() { abierta = false; lista.classList.add("hidden"); }

		input.addEventListener("focus", abrir);
		input.addEventListener("click", abrir);
		input.addEventListener("input", abrir);
		input.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { cerrar(); input.blur(); }
			if (e.key === "Enter") {
				e.preventDefault();
				var primero = lista.querySelector("[data-elegir]:not(.opacity-50)");
				if (primero) { elegir(primero.getAttribute("data-elegir")); input.value = ""; abrir(); }
			}
		});
		// Elegir = tocar y soltar SIN mover. pointerdown solo anota dónde empezó
		// (y con preventDefault evita que la casilla pierda el foco en
		// escritorio); la elección se hace en pointerup si el dedo o el ratón
		// apenas se movieron. Así en el celular se puede deslizar la lista sin
		// que se elija la opción bajo el dedo (antes se elegía al primer toque).
		var toque = null;
		lista.addEventListener("pointerdown", function (e) {
			var b = e.target.closest("[data-elegir]");
			if (!b) { toque = null; return; }
			e.preventDefault();
			toque = { id: b.getAttribute("data-elegir"), x: e.clientX, y: e.clientY };
		});
		lista.addEventListener("pointercancel", function () { toque = null; });
		lista.addEventListener("scroll", function () { toque = null; }, { passive: true });
		lista.addEventListener("pointerup", function (e) {
			if (!toque) { return; }
			var b = e.target.closest("[data-elegir]");
			var movio = Math.abs(e.clientX - toque.x) > 8 || Math.abs(e.clientY - toque.y) > 8;
			var id = toque.id;
			toque = null;
			if (movio || !b || b.getAttribute("data-elegir") !== id) { return; }
			e.preventDefault();
			elegir(id);
			input.value = "";
			abrir();
		});
		lista.addEventListener("click", function (e) { e.preventDefault(); });
		// Se mira la ruta del evento (composedPath) y no `contains`: al elegir,
		// la lista se repinta y el botón tocado ya no está dentro de ella.
		// Cerrar = tocar y soltar FUERA sin mover: deslizar la página con la
		// lista abierta no la cierra (en el celular se desliza para llegar a
		// ella o para leer más opciones).
		var fuera = null;
		document.addEventListener("pointerdown", function (e) {
			fuera = null;
			if (!abierta) { return; }
			var ruta = e.composedPath ? e.composedPath() : [];
			if (ruta.indexOf(input) !== -1 || ruta.indexOf(lista) !== -1) { return; }
			fuera = { x: e.clientX, y: e.clientY };
		});
		document.addEventListener("pointercancel", function () { fuera = null; });
		document.addEventListener("pointerup", function (e) {
			if (!fuera || !abierta) { fuera = null; return; }
			var movio = Math.abs(e.clientX - fuera.x) > 8 || Math.abs(e.clientY - fuera.y) > 8;
			fuera = null;
			if (!movio) { cerrar(); }
		});
		return { abrir: abrir, cerrar: cerrar, repintar: function () { if (abierta) { pintar(); } } };
	}

	// Chip de algo elegido, con su botón de quitar (data-quitar="tipo", data-id).
	function chipQuitable(texto, cf, tipo, id) {
		var color = (cf && CF_COLOR[cf]) ? CF_COLOR[cf].hex : "#5b6473";
		return '<span class="inline-flex items-start gap-1.5 max-w-full text-[13px] font-medium rounded-lg pl-2.5 pr-1 py-1.5" style="background:' + color + '14;color:#1c2434;border:1px solid ' + color + '40">' +
			'<span class="w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]" style="background:' + color + '"></span>' +
			'<span class="leading-snug">' + esc(texto) + "</span>" +
			'<button type="button" data-quitar="' + esc(tipo) + '" data-id="' + esc(id) + '" aria-label="Quitar" class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/70 transition"><i data-lucide="x" class="w-3.5 h-3.5 text-mute"></i></button></span>';
	}

	// Sin acentos ni mayúsculas: "Etica" encuentra "Ética".
	function normalizarTexto(s) {
		return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
	}
	// Todas las palabras de la consulta aparecen en el texto normalizado.
	function coincideTexto(norm, consulta) {
		var palabras = normalizarTexto(consulta).split(/\s+/).filter(Boolean);
		return palabras.every(function (w) { return norm.indexOf(w) !== -1; });
	}

	// Chip pequeño de campo formativo para tarjetas y fichas.
	function chipCF(codigo, opts) {
		var c = CF_COLOR[codigo];
		if (!c) { return ""; }
		var texto = opts && opts.largo ? c.nombre : c.corto;
		return '<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold h-6 px-2 rounded-md" style="background:' + c.hex + '14;color:' + c.hex + ';border:1px solid ' + c.hex + '40">' +
			'<span class="w-1.5 h-1.5 rounded-full" style="background:' + c.hex + '"></span>' + esc(texto) + "</span>";
	}

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

	// Importe compacto: "$349" en vez de "$349.00 MXN", que repetido en una
	// línea se vuelve ilegible.
	function montoCorto(n) {
		var num = Number(n || 0);
		return "$" + num.toLocaleString("es-MX", {
			minimumFractionDigits: num % 1 === 0 ? 0 : 2,
			maximumFractionDigits: 2,
		});
	}

	// ── Promoción por tiempo limitado ──────────────────────────────────────
	//
	// El precio de LISTA es el que vive en la base (marketplace_productos y
	// marketplace_precios). El descuento se aplica al pintar, nunca se escribe:
	// marketplace_aplicar_precios() reescribe esas columnas después de cada
	// venta y se llevaría por delante cualquier descuento guardado ahí.
	//
	// La vigencia la evalúa la base contra now(); aquí solo se cachea, durante
	// esta carga de página, lo que devolvió la RPC. Sin localStorage a
	// propósito: una promo vencida en caché mostraría un precio que ya no se
	// va a cobrar.
	var promo = null;        // {porcentaje, etiqueta, vigente_hasta, ambitos} o null
	var promoPromesa = null; // una sola petición aunque la pidan varias funciones
	// Ámbito por defecto de la página: 'paquete' | 'proyecto' | 'personalizado'.
	// Cada página lo fija con Tienda.setAmbito(); las llamadas que mezclan
	// tipos (el catálogo) pasan el ámbito explícito en cada precio.
	var ambitoPagina = "paquete";
	function setAmbito(a) { ambitoPagina = a || "paquete"; }
	// ¿La promoción vigente aplica a ese ámbito? Espejo de
	// marketplace_promocion_aplica() en supabase/marketplace_promocion_ambitos.sql.
	function aplicaA(ambito) {
		if (!promo) { return false; }
		var a = ambito || ambitoPagina;
		var m = promo.ambitos || {};
		if (a === "proyecto") { return m.proyectos !== false; }
		if (a === "personalizado") { return m.personalizados === true; }
		return m.paquetes !== false;
	}

	function cargarPromo() {
		if (promoPromesa) { return promoPromesa; }
		promoPromesa = (async function () {
			if (!window.sb) { return null; }
			try {
				var res = await window.sb.rpc("marketplace_promocion_vigente");
				var d = res.data;
				// Si la RPC falla, `promo` se queda en null y todo se pinta a
				// precio de lista mientras el servidor sí descuenta: se cobra
				// de menos, nunca de más. Es la dirección segura del fallo.
				if (res.error || !d || !d.activa) { return null; }
				promo = {
					porcentaje: Number(d.porcentaje),
					etiqueta: d.etiqueta || "por tiempo limitado",
					vigente_hasta: d.vigente_hasta || null,
					ambitos: d.ambitos || { paquetes: true, proyectos: true, personalizados: false },
				};
			} catch (_) { promo = null; }
			return promo;
		})();
		return promoPromesa;
	}

	// Con ámbito (o el de la página): true solo si el descuento aplica ahí.
	function promoActiva(ambito) { return aplicaA(ambito); }
	function promoInfo() { return promo; }

	// Espejo EXACTO de marketplace_redondeo_promo() en
	// supabase/marketplace_promocion.sql. Si cambia una, cambian las dos.
	function precioFinal(lista, ambito) {
		var n = Number(lista);
		if (!isFinite(n)) { return null; }
		if (!aplicaA(ambito)) { return n; }
		return Math.floor(n * (100 - promo.porcentaje) / 100);
	}

	// Par de precios: lista tachado + precio con descuento. Un solo sitio
	// decide cómo se ve el tachado para que las cinco superficies de la tienda
	// no se contradigan. Sin promo devuelve exactamente lo de siempre.
	//   opts.corto      → "$399" en vez de "$399.00 MXN"
	//   opts.claseLista → clases del tachado (las tarjetas oscuras necesitan otro color)
	//   opts.claseFinal → clases del precio final
	//   opts.ambito     → 'paquete' | 'proyecto' | 'personalizado' (si no, el de la página)
	function precioHTML(lista, opts) {
		var o = opts || {};
		var fmt = o.corto ? montoCorto : formatMoney;
		var final = precioFinal(lista, o.ambito);
		var spanFinal = '<span class="' + (o.claseFinal || "") + '">' + fmt(final) + "</span>";
		if (!aplicaA(o.ambito) || final == null || Number(final) >= Number(lista)) {
			return spanFinal;
		}
		return '<s class="' + (o.claseLista || "text-mute") +
			'" aria-label="Precio anterior">' + fmt(lista) + "</s> " + spanFinal;
	}

	// Badge "-20% por tiempo limitado". El número sale de la base: cambiarlo en
	// el panel admin cambia el badge sin tocar código. Icono Lucide, nunca
	// emojis; hay que llamar a Tienda.iconos() tras insertarlo.
	function promoBadge(opts) {
		var o = opts || {};
		if (!aplicaA(o.ambito)) { return ""; }
		return '<span class="inline-flex items-center gap-1.5 ' +
			(o.clase || "h-7 px-2.5 text-[12px]") +
			' font-bold rounded-full border" style="background:' + COLOR_DESCUENTO.fondo +
			';color:' + COLOR_DESCUENTO.texto + ';border-color:' + COLOR_DESCUENTO.borde + '">' +
			'<i data-lucide="tag" class="w-3.5 h-3.5"></i> -' + promo.porcentaje + "% " +
			esc(promo.etiqueta) + "</span>";
	}

	// Chip corto ("-20%") para donde no cabe la frase completa: tarjetas del
	// catálogo y barra de compra del móvil.
	function promoChip(clase, ambito) {
		if (!aplicaA(ambito)) { return ""; }
		return '<span class="inline-flex items-center h-6 px-2 text-[11px] font-bold rounded-full ' +
			(clase || "") + '" style="background:' + COLOR_DESCUENTO.solido +
			';color:#fff">-' + promo.porcentaje + "%</span>";
	}

	// Comprueba un cupón contra la base. Devuelve la evaluación completa
	// (precio final, si gana o no, y el mensaje para el comprador) o null si la
	// consulta falla. Es el MISMO núcleo que usa la Edge Function al cobrar, así
	// que lo que se pinta aquí y lo que se cobra no pueden discrepar.
	async function validarCupon(codigo, precioLista, ambito) {
		if (!window.sb) { return null; }
		try {
			var res = await window.sb.rpc("marketplace_validar_cupon", {
				p_codigo: codigo || null,
				p_precio_lista: precioLista,
				p_ambito: ambito || ambitoPagina,
			});
			if (res.error || !res.data) { return null; }
			return res.data;
		} catch (_) { return null; }
	}

	// "30 de septiembre". Siempre en hora de Ciudad de México: la fecha límite
	// es una sola para todo el país, no la del navegador del comprador.
	function promoFechaLimite() {
		if (!promo || !promo.vigente_hasta) { return ""; }
		try {
			return new Date(promo.vigente_hasta).toLocaleDateString("es-MX", {
				day: "numeric", month: "long", timeZone: "America/Mexico_City",
			});
		} catch (_) { return ""; }
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
			'<div class="flex flex-wrap justify-center gap-x-5 gap-y-2">' +
			'<a href="index.html" class="hover:text-ink transition">Inicio</a>' +
			'<a href="catalogo.html" class="hover:text-ink transition">Catálogo</a>' +
			'<a href="terminos.html" class="hover:text-ink transition">Términos y Condiciones</a>' +
			'<a href="privacidad.html" class="hover:text-ink transition">Aviso de Privacidad</a>' +
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
	// La caja se queda lisa hasta que la imagen terminó de bajar; entonces
	// aparece con un fundido. Nunca se ve un rótulo o una maqueta que luego
	// cambie.
	function pintarPortadaUrl(contenedor, url, alt) {
		if (!url || !contenedor) { return; }
		contenedor.textContent = "";
		contenedor.style.background = "#f1f0ea";
		var img = document.createElement("img");
		img.alt = alt || "";
		img.className = "w-full h-full object-cover";
		// Un 10% baja el encuadre apenas por debajo del borde: se ve el
		// encabezado de la hoja sin el margen blanco superior.
		img.style.objectPosition = "center 10%";
		img.loading = "lazy";
		img.decoding = "async";
		img.addEventListener("load", function () { img.classList.add("lista"); });
		img.src = url;
		if (img.complete && img.naturalWidth) { img.classList.add("lista"); }
		contenedor.appendChild(img);
	}
	function pintarPortada(contenedor, slug, alt) {
		portadaPreview(slug).then(function (url) { pintarPortadaUrl(contenedor, url, alt); });
	}

	// ── Flechas fugaces ───────────────────────────────────────────────────────
	// En pantallas táctiles las flechas se asoman un momento y se esconden: el
	// gesto natural ahí es deslizar, y la flecha fija encima de la hoja estorba.
	// Cualquier toque las vuelve a asomar. En escritorio (con hover) no hace
	// nada: quedan siempre visibles, porque sin gesto de deslizar son el único
	// control. Devuelve la función "asomar" para llamarla al abrir/mostrar.
	var TACTIL = window.matchMedia && window.matchMedia("(hover: none)").matches;
	function flechasFugaces(contenedor, botones, asomarYa) {
		if (!TACTIL) { return function () {}; }
		var timer = null;
		function asomar() {
			botones.forEach(function (b) { b.classList.remove("opacity-0", "pointer-events-none"); });
			clearTimeout(timer);
			timer = setTimeout(function () {
				botones.forEach(function (b) { b.classList.add("opacity-0", "pointer-events-none"); });
			}, 1600);
		}
		contenedor.addEventListener("touchstart", asomar, { passive: true });
		if (asomarYa) { asomar(); }
		return asomar;
	}

	// ── Visor ampliado compartido ─────────────────────────────────────────────
	// Pantalla completa para las páginas de muestra: un clic acerca al punto
	// señalado, el arrastre o el scroll recorren la página, las flechas navegan
	// y Escape o el fondo cierran. Lo usan la ficha de producto y el landing.
	// El markup se inyecta en el primer uso para no repetirlo en cada página.
	var visorEl = null, visorScroll, visorImg, visorEtiqueta, visorContador, visorPrev, visorNext;
	var visorImgs = [], visorIdx = 0, visorOnCambio = null, visorZoom = false;
	var visorArrastre = null, visorSeMovio = false;
	var visorEnHistorial = false;
	var visorAsomarFlechas = function () {};

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
			// Flechas: chevron azul (board) sin fondo, con halo blanco para que
			// no se pierda ni sobre la hoja blanca ni sobre el fondo oscuro.
			'<span data-visor-etiqueta class="absolute top-4 left-4 text-[11px] font-bold px-2.5 py-1 rounded-full pointer-events-none" style="background:rgba(30,58,138,.9);color:#fff"></span>' +
			'<button data-visor-cerrar type="button" aria-label="Cerrar" class="absolute top-3 right-3 w-11 h-11 flex items-center justify-center text-white transition hover:opacity-80" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))"><i data-lucide="x" class="w-7 h-7"></i></button>' +
			'<button data-visor-prev type="button" aria-label="Anterior" class="absolute left-1 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center transition-opacity duration-300 hover:opacity-80" style="color:#1e3a8a;filter:drop-shadow(0 0 5px rgba(255,255,255,.95)) drop-shadow(0 1px 2px rgba(255,255,255,.8))"><i data-lucide="chevron-left" class="w-10 h-10"></i></button>' +
			'<button data-visor-next type="button" aria-label="Siguiente" class="absolute right-1 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center transition-opacity duration-300 hover:opacity-80" style="color:#1e3a8a;filter:drop-shadow(0 0 5px rgba(255,255,255,.95)) drop-shadow(0 1px 2px rgba(255,255,255,.8))"><i data-lucide="chevron-right" class="w-10 h-10"></i></button>' +
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

		// Deslizar en táctil cambia de página cuando no hay zoom. Con zoom
		// activo no se intercepta: el scroll nativo recorre la página.
		var toque = null;
		visorScroll.addEventListener("touchstart", function (e) {
			toque = e.touches.length === 1
				? { x: e.touches[0].clientX, y: e.touches[0].clientY }
				: null;
		}, { passive: true });
		visorScroll.addEventListener("touchend", function (e) {
			if (!toque || visorZoom) { toque = null; return; }
			var dx = e.changedTouches[0].clientX - toque.x;
			var dy = e.changedTouches[0].clientY - toque.y;
			toque = null;
			if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				visorIr(dx < 0 ? visorIdx + 1 : visorIdx - 1);
			}
		}, { passive: true });

		visorAsomarFlechas = flechasFugaces(visorEl, [visorPrev, visorNext]);

		// En móvil, el botón atrás debe salir del visor, no de la página:
		// abrir agrega una entrada al historial y popstate solo cierra.
		window.addEventListener("popstate", function () {
			if (visorAbierto()) {
				visorEnHistorial = false;
				visorCerrar();
			}
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
		try {
			history.pushState({ visor: true }, "");
			visorEnHistorial = true;
		} catch (_) { visorEnHistorial = false; }
		visorIr(idx || 0);
		visorAsomarFlechas();
	}

	function visorCerrar() {
		if (!visorAbierto()) { return; }
		visorEl.classList.add("hidden");
		document.body.style.overflow = "";
		// Si abrir agregó una entrada al historial y se cierra desde la UI,
		// se retira aquí; cerrar con el botón atrás ya la retiró él mismo.
		if (visorEnHistorial) {
			visorEnHistorial = false;
			history.back();
		}
	}

	function visorAbierto() {
		return !!(visorEl && !visorEl.classList.contains("hidden"));
	}

	window.Tienda = {
		SUPABASE_URL: SUPABASE_URL,
		EDGE_BASE: EDGE_BASE,
		ADMIN_EMAIL: ADMIN_EMAIL,
		CF_COLOR: CF_COLOR,
		CF_ORDEN: CF_ORDEN,
		GRADO_COLOR: GRADO_COLOR,
		chipCF: chipCF,
		precioColumna: precioColumna,
		opcionVersion: opcionVersion,
		combobox: combobox,
		chipQuitable: chipQuitable,
		normalizarTexto: normalizarTexto,
		coincideTexto: coincideTexto,
		esc: esc,
		formatMoney: formatMoney,
		montoCorto: montoCorto,
		COLOR_DESCUENTO: COLOR_DESCUENTO,
		cargarPromo: cargarPromo,
		promoActiva: promoActiva,
		promoAplicaA: aplicaA,
		setAmbito: setAmbito,
		promoInfo: promoInfo,
		precioFinal: precioFinal,
		precioHTML: precioHTML,
		promoBadge: promoBadge,
		promoChip: promoChip,
		promoFechaLimite: promoFechaLimite,
		validarCupon: validarCupon,
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
		pintarPortadaUrl: pintarPortadaUrl,
		visorAbrir: visorAbrir,
		visorCerrar: visorCerrar,
		visorAbierto: visorAbierto,
		flechasFugaces: flechasFugaces,
	};
})();
