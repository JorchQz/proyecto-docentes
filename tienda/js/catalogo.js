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

	var chipsComboEl = document.getElementById("chipsCombo");
	var bloqueCombosEl = document.getElementById("bloqueCombos");
	var panelUnitariaEl = document.getElementById("panelUnitaria");

	var todos = [];
	var orgActiva = "completa";
	var gradosActivos = new Set();
	var modalidadActiva = null; // null = ambas
	var combosActivos = new Set(); // combinaciones de grados elegidas

	// Selección del paquete unitario (combo de todos los paquetes multigrado
	// de una agrupación). "paquete" es "ciclo" o "t1"/"t2"/"t3".
	var uni = { agrupacion: "tridocente", paquete: "ciclo", version: "pdf", precios: null };

	bindFiltros();

	// Se puede llegar filtrado: catalogo.html?org=multigrado&mod=bidocente
	var params = new URLSearchParams(location.search);
	if (params.get("org") === "multigrado") { activarOrg("multigrado"); }
	var modInicial = params.get("mod");
	if (modInicial === "bidocente" || modInicial === "tridocente" || modInicial === "unitaria") {
		modalidadActiva = modInicial;
		chipsModalidadEl.querySelectorAll(".chip-mod").forEach(function (x) {
			setChip(x, x.getAttribute("data-mod") === modInicial);
		});
		bloqueCombosEl.classList.toggle("hidden", modInicial === "unitaria");
	}

	async function cargar() {
		mostrarCargando();
		var res = await window.sb
			.from("marketplace_productos")
			.select("id, titulo, grado, trimestre, tipo_paquete, num_proyectos, precio_pdf, precio_editable, organizacion, grados_combo, modalidad, portada_url")
			.eq("activo", true);

		if (res.error) { mostrarError(); return; }
		todos = res.data || [];
		renderCombos();
		aplicarFiltros();
	}

	// Deja el filtro de organización en `org` y ajusta los chips y subfiltros.
	// Se usa al pulsar un chip y también al llegar con ?org=multigrado desde la
	// portada, para que los botones que prometen multigrado lo cumplan.
	function activarOrg(org) {
		orgActiva = org;
		chipsOrgEl.querySelectorAll(".chip-org").forEach(function (x) {
			setChip(x, x.getAttribute("data-org") === org);
		});
		subCompleta.classList.toggle("hidden", org !== "completa");
		subMultigrado.classList.toggle("hidden", org !== "multigrado");
		subMultigrado.classList.toggle("flex", org === "multigrado");
	}

	function bindFiltros() {
		chipsOrgEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-org");
			if (!c) { return; }
			activarOrg(c.getAttribute("data-org"));
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
			// Al cambiar de modalidad, las combinaciones anteriores ya no
			// aplican: un combo de dos grados no existe en bidocente.
			combosActivos.clear();
			// En unitaria no se filtran combos: el paquete los incluye todos.
			bloqueCombosEl.classList.toggle("hidden", modalidadActiva === "unitaria");
			renderCombos();
			aplicarFiltros();
		});

		chipsComboEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-combo");
			if (!c) { return; }
			var combo = c.getAttribute("data-combo");
			if (combosActivos.has(combo)) { combosActivos.delete(combo); setChip(c, false); }
			else { combosActivos.add(combo); setChip(c, true); }
			aplicarFiltros();
		});

		// Selecciones dentro del panel unitario (se re-renderiza al cambiar).
		panelUnitariaEl.addEventListener("click", function (e) {
			var b = e.target.closest("[data-uni-agrupacion],[data-uni-paquete],[data-uni-version]");
			if (!b) { return; }
			if (b.hasAttribute("data-uni-agrupacion")) { uni.agrupacion = b.getAttribute("data-uni-agrupacion"); }
			if (b.hasAttribute("data-uni-paquete")) { uni.paquete = b.getAttribute("data-uni-paquete"); }
			if (b.hasAttribute("data-uni-version")) { uni.version = b.getAttribute("data-uni-version"); }
			renderUnitaria();
		});
	}

	/**
	 * Pinta las combinaciones que existen de verdad en el catálogo, filtradas
	 * por la modalidad elegida. Se generan desde los productos y no a mano
	 * para no ofrecer combos que nadie puede comprar.
	 */
	function renderCombos() {
		var vistos = {};
		todos.forEach(function (p) {
			if (p.organizacion !== "multigrado" || !p.grados_combo) { return; }
			if (modalidadActiva && p.modalidad !== modalidadActiva) { return; }
			vistos[p.grados_combo] = p.modalidad;
		});

		var combos = Object.keys(vistos).sort(function (a, b) {
			var na = a.split("-").length, nb = b.split("-").length;
			if (na !== nb) { return na - nb; }
			return Number(a.split("-")[0]) - Number(b.split("-")[0]);
		});

		chipsComboEl.innerHTML = combos.map(function (c) {
			var activo = combosActivos.has(c);
			return '<button data-combo="' + esc(c) + '" class="chip-combo chip ' +
				(activo ? "active" : "border border-line text-ink bg-white") +
				' text-sm font-semibold h-10 px-4 rounded-xl">' + esc(comboDisplay(c)) + "</button>";
		}).join("");
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
				if (combosActivos.size && !combosActivos.has(p.grados_combo)) { return; }
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
		var esUnitaria = orgActiva === "multigrado" && modalidadActiva === "unitaria";
		panelUnitariaEl.classList.toggle("hidden", !esUnitaria);
		if (esUnitaria) {
			estadoEl.classList.add("hidden");
			gridEl.classList.add("hidden");
			if (contadorTextoEl) { contadorTextoEl.textContent = ""; }
			renderUnitaria();
			return;
		}
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

		// Mismo nombre que el h1 de la ficha: lo que se toca y lo que se abre
		// deben llamarse igual. Las de multigrado no decian "primaria" en ningun
		// sitio, que es la palabra con la que busca un maestro.
		var titulo = esMulti
			? "Multigrado " + comboDisplay(grupo.combo) + " de Primaria"
			: grupo.grado + "° de Primaria";
		// bidocente = 2 docentes en la escuela = 3 grados por maestro;
		// tridocente = 3 docentes = 2 grados. Es la convención del proyecto
		// (supabase/marketplace_precios.sql). Si llegara otra cosa, mejor sin
		// etiqueta que con una inventada por descarte.
		var etiqueta = esMulti
			? (grupo.modalidad === "bidocente" ? "Bidocente"
				: grupo.modalidad === "tridocente" ? "Tridocente" : "")
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
		} else if (!etiqueta) {
			badge = "";
		} else {
			badge = '<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">' + esc(etiqueta) + '</span>';
		}

		var a = document.createElement("a");
		a.href = href;
		a.className = "prod-card bg-white rounded-3xl border overflow-hidden flex flex-col";
		a.style.borderColor = "#e7e6df";

		a.innerHTML =
			'<div class="relative">' +
			'<div class="ph h-40 overflow-hidden rounded-none border-x-0 border-t-0" data-portada style="border-radius:0">' + esc(titulo) + ' · portada</div>' +
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

		// La portada real entra después, sin bloquear el pintado del grid.
		Tienda.pintarPortada(
			a.querySelector("[data-portada]"),
			Tienda.slugPreview(orgActiva, grupo.grado, grupo.combo),
			titulo
		);
		return a;
	}

	// ── Paquete unitario ────────────────────────────────────────────────────
	// Un maestro unitario atiende los 6 grados: el combo compra en una sola
	// orden todos los paquetes multigrado de la agrupación elegida (3 de
	// tridocente: 1°-2°, 3°-4°, 5°-6°, o 2 de bidocente: 1°-2°-3°, 4°-5°-6°)
	// al mismo precio. El precio viene de la RPC marketplace_precio_unitaria;
	// el cobro real siempre lo calcula la Edge Function contra la base.

	var COMBOS_UNITARIA = {
		tridocente: ["1-2", "3-4", "5-6"],
		bidocente: ["1-2-3", "4-5-6"],
	};

	async function cargarPreciosUnitaria() {
		if (uni.precios) { return uni.precios; }
		var rTrim = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "trimestre" });
		var rCiclo = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "ciclo" });
		if (rTrim.error || rCiclo.error || !rTrim.data || !rCiclo.data) { return null; }
		uni.precios = { trimestre: rTrim.data, ciclo: rCiclo.data };
		return uni.precios;
	}

	// Los productos reales que incluye la selección actual del combo.
	function productosUnitaria() {
		var esperados = COMBOS_UNITARIA[uni.agrupacion];
		var tipoPaquete = uni.paquete === "ciclo" ? "ciclo" : "trimestre";
		var trimestre = uni.paquete === "ciclo" ? null : Number(uni.paquete.slice(1));
		var elegidos = [];
		esperados.forEach(function (combo) {
			var p = todos.find(function (x) {
				return x.organizacion === "multigrado" && x.modalidad === uni.agrupacion &&
					x.grados_combo === combo && x.tipo_paquete === tipoPaquete &&
					(trimestre == null || Number(x.trimestre) === trimestre);
			});
			if (p) { elegidos.push(p); }
		});
		return { esperados: esperados, elegidos: elegidos, completo: elegidos.length === esperados.length };
	}

	function botonOpcion(attr, valor, activo, titulo, detalle) {
		return '<button ' + attr + '="' + valor + '" class="text-left border rounded-xl px-4 py-3 transition ' +
			(activo ? 'border-board bg-board/5' : 'border-line bg-white hover:border-board/40') + '">' +
			'<span class="block font-bold text-[15px]" style="color:#1c2434">' + titulo + '</span>' +
			(detalle ? '<span class="block text-[13px] mt-0.5" style="color:#5b6473">' + detalle + '</span>' : '') +
			'</button>';
	}

	async function renderUnitaria() {
		panelUnitariaEl.innerHTML = '<div class="text-center py-16" style="color:#5b6473">Cargando paquete unitario...</div>';
		var precios = await cargarPreciosUnitaria();
		// Mientras se esperaba la RPC el maestro pudo salirse del panel.
		if (panelUnitariaEl.classList.contains("hidden")) { return; }
		if (!precios) {
			panelUnitariaEl.innerHTML = '<div class="text-center py-16" style="color:#dc2626">No se pudo cargar el precio. Recarga la página.</div>';
			return;
		}

		var sel = productosUnitaria();
		var tipoPaquete = uni.paquete === "ciclo" ? "ciclo" : "trimestre";
		var tarifa = precios[tipoPaquete];
		var total = uni.version === "pdf" ? Number(tarifa.precio_pdf) : Number(tarifa.precio_editable);

		// Suma de comprar cada paquete por separado, con los precios reales del
		// catálogo. Solo se tacha si de verdad sale más caro por separado.
		var separado = 0;
		sel.elegidos.forEach(function (p) {
			var precio = uni.version === "pdf" ? p.precio_pdf : p.precio_editable;
			separado += precio != null ? Number(precio) : 0;
		});
		var hayAhorro = sel.completo && separado > total;

		var titulos = {
			tridocente: { titulo: "Por parejas de grados", detalle: "3 paquetes: 1°-2°, 3°-4° y 5°-6°" },
			bidocente: { titulo: "Por tríos de grados", detalle: "2 paquetes: 1°-2°-3° y 4°-5°-6°" },
		};

		var opcionesPaquete = [
			{ v: "ciclo", t: "Ciclo completo", d: "Los 3 trimestres · el mejor precio" },
			{ v: "t1", t: "Trimestre 1", d: null },
			{ v: "t2", t: "Trimestre 2", d: null },
			{ v: "t3", t: "Trimestre 3", d: null },
		];

		var listaIncluye = sel.esperados.map(function (combo) {
			var p = sel.elegidos.find(function (x) { return x.grados_combo === combo; });
			var nombre = "Multigrado " + comboDisplay(combo) + " de Primaria";
			return '<li class="flex items-center gap-2 text-[14px]" style="color:#1c2434">' +
				(p
					? '<i data-lucide="check" class="w-4 h-4 shrink-0" style="color:#059669"></i>' + esc(nombre)
					: '<i data-lucide="clock" class="w-4 h-4 shrink-0" style="color:#9ba3af"></i><span style="color:#9ba3af">' + esc(nombre) + ' (próximamente)</span>') +
				'</li>';
		}).join("");

		var urlCheckout = "checkout.html?combo=unitaria&agrupacion=" + uni.agrupacion +
			"&tipo_paquete=" + tipoPaquete +
			(tipoPaquete === "trimestre" ? "&trimestre=" + uni.paquete.slice(1) : "") +
			"&tipo=" + uni.version;

		panelUnitariaEl.innerHTML =
			'<div class="bg-white border border-line rounded-2xl shadow-sm p-5 sm:p-7">' +

			'<div class="flex flex-wrap items-center gap-2">' +
			'<h2 class="font-black text-[clamp(1.25rem,2.5vw,1.6rem)] tracking-tight" style="color:#1c2434">Paquete unitario · 1° a 6° de Primaria</h2>' +
			'<span class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-bold" style="background:rgba(5,150,105,.1);color:#059669;border:1px solid rgba(5,150,105,.25)"><i data-lucide="tag" class="w-3.5 h-3.5"></i>Precio de lanzamiento</span>' +
			'</div>' +
			'<p class="mt-1.5 text-[14px] sm:text-[15px]" style="color:#5b6473">Para maestros que atienden los 6 grados: un solo pago que incluye todos los paquetes multigrado de la agrupación que prefieras. Cubres 1° a 6° con cualquiera de las dos y pagas lo mismo.</p>' +

			'<div class="mt-6">' +
			'<p class="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style="color:#5b6473">Cómo prefieres agrupar los grados</p>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
			["tridocente", "bidocente"].map(function (a) {
				return botonOpcion("data-uni-agrupacion", a, uni.agrupacion === a, titulos[a].titulo, titulos[a].detalle);
			}).join("") +
			'</div></div>' +

			'<div class="mt-5">' +
			'<p class="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style="color:#5b6473">Paquete</p>' +
			'<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
			opcionesPaquete.map(function (o) {
				return botonOpcion("data-uni-paquete", o.v, uni.paquete === o.v, o.t, o.d);
			}).join("") +
			'</div></div>' +

			'<div class="mt-5">' +
			'<p class="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style="color:#5b6473">Versión</p>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
			botonOpcion("data-uni-version", "pdf", uni.version === "pdf", "Solo PDF", "Listo para imprimir · incluye anexos") +
			botonOpcion("data-uni-version", "editable", uni.version === "editable", "PDF + Word editable",
				money(Number(tarifa.precio_pdf)) + " del PDF + " + money(Number(tarifa.precio_editable) - Number(tarifa.precio_pdf)) + " por el Word · todo el paquete editable") +
			'</div></div>' +

			'<div class="mt-6 pt-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4" style="border-top:1px solid #e7e6df">' +
			'<div>' +
			'<p class="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style="color:#5b6473">Incluye</p>' +
			'<ul class="flex flex-col gap-1.5">' + listaIncluye + '</ul>' +
			'</div>' +
			'<div class="sm:text-right">' +
			(hayAhorro
				? '<p class="text-[13px]" style="color:#5b6473">Por separado: <s>' + money(separado) + '</s></p>'
				: '') +
			'<p class="font-black text-3xl" style="color:#1c2434">' + money(total) + ' <span class="text-sm font-semibold" style="color:#5b6473">MXN · pago único</span></p>' +
			(hayAhorro
				? '<p class="text-[13px] font-bold mt-0.5" style="color:#059669">Ahorras ' + money(separado - total) + ' frente a comprarlos por separado</p>'
				: '') +
			(sel.completo
				? '<a href="' + urlCheckout + '" class="mt-3 inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl font-bold text-white" style="background:#059669">Continuar a la compra <i data-lucide="arrow-right" class="w-4 h-4"></i></a>'
				: '<span class="mt-3 inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl font-bold" style="background:#e7e6df;color:#9ba3af;cursor:not-allowed">Disponible próximamente</span>') +
			'</div></div>' +

			'</div>';

		Tienda.iconos();
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
