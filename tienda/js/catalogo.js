document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	await Tienda.montarNav("catalogo");
	Tienda.montarFooter();

	var esc = Tienda.esc;
	var money = Tienda.formatMoney;

	var estadoEl = document.getElementById("estado");
	var gridEl = document.getElementById("grid");
	var contadorTextoEl = document.getElementById("contadorTexto");
	var chipsOrgEl = document.getElementById("chipsOrg");
	var subCompleta = document.getElementById("subCompleta");
	var subMultigrado = document.getElementById("subMultigrado");
	var chipsGradoEl = document.getElementById("chipsGrado");
	var chipsModalidadEl = document.getElementById("chipsModalidad");

	var todos = [];
	var orgActiva = "completa";
	var gradosActivos = new Set();
	var modalidadActiva = null; // null = ambas

	bindFiltros();

	async function cargar() {
		mostrarCargando();
		var res = await window.sb
			.from("marketplace_productos")
			.select("id, titulo, grado, trimestre, tipo_paquete, num_proyectos, precio_pdf, precio_editable, organizacion, grados_combo, modalidad, portada_url")
			.eq("activo", true);

		if (res.error) { mostrarError(); return; }
		todos = res.data || [];
		aplicarFiltros();
	}

	function bindFiltros() {
		chipsOrgEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-org");
			if (!c) { return; }
			orgActiva = c.getAttribute("data-org");
			chipsOrgEl.querySelectorAll(".chip-org").forEach(function (x) { setChip(x, x === c); });
			subCompleta.classList.toggle("hidden", orgActiva !== "completa");
			subMultigrado.classList.toggle("hidden", orgActiva !== "multigrado");
			aplicarFiltros();
		});
		chipsGradoEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-grado");
			if (!c) { return; }
			var g = c.getAttribute("data-grado");
			if (gradosActivos.has(g)) { gradosActivos.delete(g); setChip(c, false); }
			else { gradosActivos.add(g); setChip(c, true); }
			aplicarFiltros();
		});
		chipsModalidadEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-mod");
			if (!c) { return; }
			var m = c.getAttribute("data-mod");
			if (modalidadActiva === m) { modalidadActiva = null; setChip(c, false); }
			else {
				modalidadActiva = m;
				chipsModalidadEl.querySelectorAll(".chip-mod").forEach(function (x) { setChip(x, x === c); });
			}
			aplicarFiltros();
		});
	}

	function setChip(chip, activo) {
		if (activo) {
			chip.classList.remove("border-line", "text-ink");
			chip.classList.add("active");
		} else {
			chip.classList.add("border-line", "text-ink");
			chip.classList.remove("active");
		}
	}

	function comboDisplay(combo) {
		return (combo || "").split("-").map(function (n) { return n + "°"; }).join("-");
	}

	function agrupar() {
		var prods = todos.filter(function (p) { return p.organizacion === orgActiva; });
		var mapa = {}, orden = [];
		prods.forEach(function (p) {
			var clave;
			if (orgActiva === "completa") {
				if (gradosActivos.size && !gradosActivos.has(String(p.grado))) { return; }
				clave = "g" + p.grado;
			} else {
				if (modalidadActiva && p.modalidad !== modalidadActiva) { return; }
				clave = "c" + p.grados_combo;
			}
			if (!(clave in mapa)) {
				mapa[clave] = { key: clave, grado: p.grado, combo: p.grados_combo, modalidad: p.modalidad, productos: [] };
				orden.push(clave);
			}
			mapa[clave].productos.push(p);
		});
		var arr = orden.map(function (k) { return mapa[k]; });
		arr.sort(function (a, b) {
			if (a.grado !== b.grado) { return a.grado - b.grado; }
			var la = (a.combo || "").length, lb = (b.combo || "").length;
			return la - lb;
		});
		return arr;
	}

	function aplicarFiltros() {
		if (!todos.length) { mostrarVacioCatalogo(); return; }
		var grupos = agrupar();
		if (contadorTextoEl) {
			contadorTextoEl.textContent = grupos.length
				? grupos.length + (grupos.length === 1 ? " paquete" : " paquetes")
				: "";
		}
		if (!grupos.length) { mostrarVacioFiltrado(); return; }
		render(grupos);
	}

	function render(grupos) {
		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";
		grupos.forEach(function (g) { gridEl.appendChild(card(g)); });
		Tienda.iconos();
	}

	// Mapa de colores por grado (design tokens inline para compatibilidad CDN)
	var GRADO_COLOR = {
		"1": { bg: "#f2cf6b", txt: "rgba(30,58,138,.85)" },
		"2": { bg: "#ef9277", txt: "#fff" },
		"3": { bg: "#79c8a6", txt: "rgba(30,58,138,.85)" },
		"4": { bg: "#a99fe0", txt: "#fff" },
		"5": { bg: "#85b8e6", txt: "rgba(30,58,138,.85)" },
		"6": { bg: "#f0b285", txt: "rgba(30,58,138,.85)" },
	};

	function card(grupo) {
		var esMulti = orgActiva === "multigrado";
		var precios = grupo.productos
			.map(function (p) { return p.precio_pdf != null ? Number(p.precio_pdf) : Infinity; });
		var precioDesde = Math.min.apply(null, precios);
		var tieneWord = grupo.productos.some(function (p) { return p.precio_editable != null; });

		var titulo = esMulti
			? "Multigrado " + comboDisplay(grupo.combo)
			: grupo.grado + "° Primaria";
		var etiqueta = esMulti
			? (grupo.modalidad === "bidocente" ? "Bidocente" : "Tridocente")
			: (grupo.grado + "° grado");
		var icono = esMulti ? "users" : "graduation-cap";

		var href = esMulti
			? "producto.html?org=multigrado&combo=" + encodeURIComponent(grupo.combo)
			: "producto.html?org=completa&g=" + encodeURIComponent(grupo.grado);

		// Badge de grado (color gis) o badge multigrado
		var badge;
		if (!esMulti) {
			var gc = GRADO_COLOR[String(grupo.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
			badge = '<span style="background:' + gc.bg + ';color:' + gc.txt + '" class="absolute top-3 left-3 w-10 h-10 rounded-xl text-base font-black flex items-center justify-center shadow">' + esc(grupo.grado) + '°</span>';
		} else {
			badge = '<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">' + esc(etiqueta) + '</span>';
		}

		var a = document.createElement("a");
		a.href = href;
		a.className = "prod-card bg-white rounded-3xl border overflow-hidden flex flex-col";
		a.style.borderColor = "#e7e6df";

		a.innerHTML =
			'<div class="relative">' +
			'<div class="ph h-40 rounded-none border-x-0 border-t-0" style="border-radius:0">' + esc(titulo) + ' · portada</div>' +
			badge +
			'</div>' +
			'<div class="p-5 flex flex-col flex-1">' +
			'<h3 class="font-bold text-lg leading-snug" style="color:#1c2434">' + esc(titulo) + '</h3>' +
			'<p class="mt-1 text-sm" style="color:#5b6473">Proyectos, PDAs, anexos y examen. Por trimestre o ciclo completo.</p>' +
			'<div class="mt-3 flex flex-wrap gap-1.5">' +
			'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md bg-paper border border-line text-mute">PDF</span>' +
			(tieneWord ? '<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md text-board/70" style="background:rgba(133,184,230,.18);border:1px solid rgba(133,184,230,.4)">+ Word disponible</span>' : '') +
			'</div>' +
			'<div class="mt-4 pt-4 flex items-center justify-between" style="border-top:1px solid #e7e6df">' +
			'<div>' +
			(isFinite(precioDesde)
				? '<span class="font-black text-lg" style="color:#1c2434">Desde ' + money(precioDesde) + '</span><span class="text-sm" style="color:#5b6473"> / trim</span>'
				: '<span class="text-sm" style="color:#5b6473">Ver opciones</span>') +
			'</div>' +
			'<span class="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-bold text-white" style="background:#059669">Ver <i data-lucide="arrow-right" class="w-4 h-4"></i></span>' +
			'</div></div>';
		return a;
	}

	function mostrarCargando() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML = '<p style="color:#5b6473">Cargando paquetes...</p>';
	}
	function mostrarError() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML = '<p style="color:#dc2626;font-weight:500">Error al cargar el catálogo. Recarga la página.</p>';
	}
	function mostrarVacioCatalogo() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		contadorTextoEl.textContent = "";
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-3">' +
			'<i data-lucide="package" style="width:3rem;height:3rem;color:#5b6473"></i>' +
			'<p class="font-semibold text-lg" style="color:#1c2434">Catálogo en camino</p>' +
			'<p class="text-sm" style="color:#5b6473">Estamos cargando los paquetes. Vuelve pronto.</p>' +
			'</div>';
		Tienda.iconos();
	}
	function mostrarVacioFiltrado() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML =
			'<p style="color:#5b6473;font-weight:500">Aún no hay paquetes disponibles aquí.</p>' +
			'<p style="color:#9ba3af;font-size:.875rem;margin-top:.25rem">Prueba con otra organización o modalidad.</p>';
	}

	// Carga inicial: al final, cuando GRADO_COLOR y el resto ya están definidos.
	await cargar();
});
