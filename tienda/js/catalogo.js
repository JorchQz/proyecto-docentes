document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	await Tienda.montarNav("catalogo");

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
	await cargar();

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
			chip.classList.remove("border-gray-300", "text-gray-600", "bg-white", "hover:bg-gray-50");
			chip.classList.add("border-emerald-600", "text-white", "bg-emerald-600");
		} else {
			chip.classList.add("border-gray-300", "text-gray-600", "bg-white", "hover:bg-gray-50");
			chip.classList.remove("border-emerald-600", "text-white", "bg-emerald-600");
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
		contadorTextoEl.textContent = grupos.length
			? grupos.length + (grupos.length === 1 ? " paquete disponible" : " paquetes disponibles")
			: "";
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

	function card(grupo) {
		var esMulti = orgActiva === "multigrado";
		var precios = grupo.productos
			.map(function (p) { return p.precio_pdf != null ? Number(p.precio_pdf) : Infinity; });
		var precioDesde = Math.min.apply(null, precios);

		var titulo = esMulti
			? "Multigrado " + comboDisplay(grupo.combo)
			: grupo.grado + "° Primaria";
		var etiqueta = esMulti
			? (grupo.modalidad === "bidocente" ? "Bidocente" : "Tridocente")
			: "Grado completo";
		var acento = esMulti ? "bg-blue-900" : "bg-emerald-600";
		var icono = esMulti ? "users" : "graduation-cap";

		var href = esMulti
			? "producto.html?org=multigrado&combo=" + encodeURIComponent(grupo.combo)
			: "producto.html?org=completa&g=" + encodeURIComponent(grupo.grado);

		var a = document.createElement("a");
		a.href = href;
		a.className = "bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col";

		a.innerHTML =
			'<div class="h-32 ' + acento + ' flex flex-col items-center justify-center text-white gap-1">' +
			'<i data-lucide="' + icono + '" class="w-8 h-8"></i>' +
			'<span class="text-sm font-semibold">' + esc(titulo) + "</span></div>" +
			'<div class="p-4 flex flex-col gap-2 flex-1">' +
			'<div class="flex flex-wrap gap-1.5">' +
			'<span class="inline-flex items-center ' + acento + ' text-white text-xs font-semibold px-2 py-0.5 rounded-full">' + esc(etiqueta) + "</span>" +
			"</div>" +
			'<h3 class="font-bold text-gray-800 text-sm leading-snug">' + esc(titulo) + "</h3>" +
			'<p class="text-xs text-gray-500 flex-1">Elige por trimestre (4 proyectos) o el ciclo completo (12 proyectos). Incluye anexos y examen.</p>' +
			'<div class="flex items-center justify-between pt-2 border-t border-gray-100 mt-1">' +
			'<span class="text-xs text-gray-400">Ver opciones</span>' +
			'<span class="text-emerald-700 font-bold text-sm">' + (isFinite(precioDesde) ? "Desde " + money(precioDesde) : "") + "</span>" +
			"</div></div>";
		return a;
	}

	function mostrarCargando() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML = '<p class="text-gray-400">Cargando paquetes...</p>';
	}
	function mostrarError() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML = '<p class="text-red-500 font-medium">Error al cargar el catálogo. Recarga la página.</p>';
	}
	function mostrarVacioCatalogo() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		contadorTextoEl.textContent = "";
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-3">' +
			'<i data-lucide="package" class="w-12 h-12 text-gray-400"></i>' +
			'<p class="text-gray-700 text-lg font-semibold">Catálogo en camino</p>' +
			'<p class="text-gray-400 text-sm max-w-md">Estamos cargando los paquetes. Vuelve pronto.</p>' +
			"</div>";
		Tienda.iconos();
	}
	function mostrarVacioFiltrado() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML =
			'<p class="text-gray-400 font-medium">Aún no hay paquetes disponibles aquí</p>' +
			'<p class="text-gray-300 text-sm mt-1">Prueba con otra organización o modalidad.</p>';
	}
});
