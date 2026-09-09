document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	await Tienda.montarNav("catalogo");
	Tienda.montarFooter();

	var esc = Tienda.esc;

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

	// Vista de proyectos sueltos y su filtro curricular.
	var chipsVistaEl = document.getElementById("chipsVista");
	var subProyectos = document.getElementById("subProyectos");
	var chipsCFEl = document.getElementById("chipsCF");
	var filtroContenidoEl = document.getElementById("filtroContenido");
	var listaContenidosEl = document.getElementById("listaContenidos");
	var limpiarContenidoEl = document.getElementById("limpiarContenido");
	var bloquePdaEl = document.getElementById("bloquePda");
	var filtroPdaEl = document.getElementById("filtroPda");
	var subtituloEl = document.getElementById("subtituloCatalogo");

	var todos = [];       // paquetes (trimestre / ciclo)
	var proyectos = [];   // proyectos sueltos publicados, con sus PDAs
	var vista = "paquetes";
	var orgActiva = "completa";
	var gradosActivos = new Set();
	var modalidadActiva = null; // null = ambas
	var combosActivos = new Set(); // combinaciones de grados elegidas
	var cfActivos = new Set();     // códigos LEN/SAB/ETI/DHL
	var contenidoActivo = null;    // id de catalogo_contenidos
	var pdaActivo = null;          // id de catalogo_pda
	var contenidoPorTexto = {};    // texto visible → id (para el datalist)

	bindFiltros();

	// Se puede llegar filtrado: catalogo.html?org=multigrado&mod=bidocente
	// o a la vista de proyectos: ?vista=proyectos&g=3&cf=LEN&contenido=<id>&pda=<id>
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
	if (params.get("vista") === "proyectos") { activarVista("proyectos"); }
	var gInicial = params.get("g");
	if (gInicial && /^[1-6]$/.test(gInicial)) {
		gradosActivos.add(gInicial);
		chipsGradoEl.querySelectorAll(".chip-grado").forEach(function (x) {
			if (x.getAttribute("data-grado") === gInicial) { setChip(x, true); }
		});
	}
	(params.get("cf") || "").split(",").forEach(function (cf) {
		if (!Tienda.CF_COLOR[cf]) { return; }
		cfActivos.add(cf);
		chipsCFEl.querySelectorAll(".chip-cf").forEach(function (x) {
			if (x.getAttribute("data-cf") === cf) { setChip(x, true); }
		});
	});
	var contenidoInicial = params.get("contenido");
	var pdaInicial = params.get("pda");

	async function cargar() {
		mostrarCargando();
		// La promoción se pide junto al catálogo: ninguna tarjeta se pinta
		// antes de saber si hay descuento, así el precio no parpadea. Los
		// proyectos sueltos llegan por RPC porque sus PDAs viven en una tabla
		// que un visitante sin sesión no puede leer directo.
		var resultados = await Promise.all([
			window.sb
				.from("marketplace_productos")
				.select("id, titulo, grado, trimestre, tipo_paquete, num_proyectos, precio_pdf, precio_editable, organizacion, grados_combo, modalidad, portada_url")
				.eq("activo", true),
			Tienda.cargarPromo(),
			window.sb.rpc("marketplace_proyectos_publicos"),
		]);
		var res = resultados[0];

		if (res.error) { mostrarError(); return; }
		// Solo paquetes (trimestre / ciclo). Los proyectos sueltos (tipo
		// 'proyecto', desde $80) tienen su propia vista: si entraran aquí se
		// colarían en la tarjeta del grado y el "desde" bajaría a $80.
		todos = (res.data || []).filter(function (p) { return p.tipo_paquete !== "proyecto"; });
		proyectos = normalizarProyectos(resultados[2].error ? [] : (resultados[2].data || []));
		if (contenidoInicial) { fijarContenidoPorId(contenidoInicial, pdaInicial); }
		pintarTiraPromo();
		renderCombos();
		aplicarFiltros();
	}

	// Los PDAs llegan con el nombre largo del campo ("Lenguajes"); aquí se
	// traduce al código corto una sola vez y se preparan los índices que usan
	// los filtros (campos que cubre, contenidos y PDAs por id).
	function normalizarProyectos(filas) {
		var corto = window.CamposFormativos ? window.CamposFormativos.corto : function (x) { return x; };
		return filas.map(function (p) {
			var pdas = (p.pdas || []).map(function (x) {
				return {
					cf: corto(x.cf) || null,
					grado: x.grado,
					contenido_id: x.contenido_id,
					contenido: x.contenido,
					pda_id: x.pda_id,
					pda: x.pda,
				};
			});
			var cfs = {};
			pdas.forEach(function (x) { if (x.cf) { cfs[x.cf] = true; } });
			return {
				id: p.id,
				titulo: p.titulo,
				nombre: p.nombre_proyecto || p.titulo,
				grado: p.grado,
				organizacion: p.organizacion,
				grados_combo: p.grados_combo,
				modalidad: p.modalidad,
				trimestre: p.trimestre,
				numero: p.numero_proyecto,
				precio_pdf: p.precio_pdf,
				precio_pdf_con_anexos: p.precio_pdf_con_anexos,
				metodologia: p.metodologia,
				sesiones: p.num_sesiones_estimadas,
				pdas: pdas,
				cfs: Object.keys(cfs).sort(function (a, b) { return Tienda.CF_ORDEN.indexOf(a) - Tienda.CF_ORDEN.indexOf(b); }),
			};
		});
	}

	// Tira superior con el descuento vigente. Oculta si no hay promoción.
	function pintarTiraPromo() {
		var el = document.getElementById("tiraPromo");
		if (!el || !Tienda.promoActiva()) { return; }
		var hasta = Tienda.promoFechaLimite();
		el.innerHTML = '<i data-lucide="tag" class="w-4 h-4 shrink-0"></i>' +
			'<span><strong>-' + Tienda.promoInfo().porcentaje + "% en todo el catálogo</strong>" +
			(hasta ? " · termina el " + hasta : " · por tiempo limitado") + "</span>";
		el.classList.remove("hidden");
		Tienda.iconos();
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

	// Cambia entre paquetes y proyectos sueltos. El filtro curricular solo
	// tiene sentido en proyectos; la modalidad "unitaria" solo en paquetes.
	function activarVista(v) {
		vista = v;
		chipsVistaEl.querySelectorAll(".chip-vista").forEach(function (x) {
			setChip(x, x.getAttribute("data-vista") === v);
		});
		var esProy = v === "proyectos";
		subProyectos.classList.toggle("hidden", !esProy);
		subProyectos.classList.toggle("flex", esProy);
		var chipUnitaria = chipsModalidadEl.querySelector('[data-mod="unitaria"]');
		if (chipUnitaria) {
			chipUnitaria.classList.toggle("hidden", esProy);
			if (esProy && modalidadActiva === "unitaria") {
				modalidadActiva = null;
				setChip(chipUnitaria, false);
				bloqueCombosEl.classList.remove("hidden");
			}
		}
		if (subtituloEl) {
			subtituloEl.textContent = esProy
				? "Un proyecto suelto con su planeación en PDF y Word. Con o sin anexos imprimibles, sin el examen del trimestre."
				: "Elige tu grado o modalidad. Seleccionas T1, T2, T3 o ciclo completo en la página del paquete.";
		}
	}

	function bindFiltros() {
		chipsVistaEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-vista");
			if (!c) { return; }
			activarVista(c.getAttribute("data-vista"));
			aplicarFiltros();
		});
		chipsCFEl.addEventListener("click", function (e) {
			var c = e.target.closest(".chip-cf");
			if (!c) { return; }
			var cf = c.getAttribute("data-cf");
			if (cfActivos.has(cf)) { cfActivos.delete(cf); setChip(c, false); }
			else { cfActivos.add(cf); setChip(c, true); }
			aplicarFiltros();
		});
		// El contenido se fija cuando el texto coincide con una opción de la
		// lista (al elegirla o al terminar de escribirla). Texto parcial no
		// filtra: la lista ya va acotando.
		filtroContenidoEl.addEventListener("input", function () {
			var id = contenidoPorTexto[filtroContenidoEl.value.trim()];
			if (id) { fijarContenidoPorId(id, null); aplicarFiltros(); }
			else if (contenidoActivo) { contenidoActivo = null; pdaActivo = null; aplicarFiltros(); }
			limpiarContenidoEl.classList.toggle("hidden", !filtroContenidoEl.value);
		});
		filtroContenidoEl.addEventListener("change", function () {
			var id = contenidoPorTexto[filtroContenidoEl.value.trim()];
			if (id && id !== contenidoActivo) { fijarContenidoPorId(id, null); aplicarFiltros(); }
		});
		limpiarContenidoEl.addEventListener("click", function () {
			filtroContenidoEl.value = "";
			contenidoActivo = null;
			pdaActivo = null;
			limpiarContenidoEl.classList.add("hidden");
			aplicarFiltros();
			filtroContenidoEl.focus();
		});
		filtroPdaEl.addEventListener("change", function () {
			pdaActivo = filtroPdaEl.value || null;
			aplicarFiltros();
		});

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
		if (vista === "proyectos") { renderProyectos(); return; }
		// La unitaria no tiene productos propios: se muestra una sola tarjeta
		// que lleva a su ficha, igual que las tarjetas de las otras modalidades.
		if (orgActiva === "multigrado" && modalidadActiva === "unitaria") {
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

	var GRADO_COLOR = Tienda.GRADO_COLOR;

	// ── Proyectos sueltos ───────────────────────────────────────────────────
	// Una tarjeta por proyecto (no por grado): aquí el maestro busca un tema
	// concreto, así que el nombre del proyecto y sus campos son lo primero.

	// Proyectos que pasan los filtros de aula (organización, grado, modalidad,
	// combinación) y de campo. El contenido y el PDA se aplican aparte porque
	// la lista de contenidos se construye ANTES de aplicarlos: si no, al elegir
	// un contenido desaparecerían del selector todos los demás.
	function proyectosDeAula() {
		return proyectos.filter(function (p) {
			if (p.organizacion !== orgActiva) { return false; }
			if (orgActiva === "completa") {
				if (gradosActivos.size && !gradosActivos.has(String(p.grado))) { return false; }
			} else {
				if (modalidadActiva && p.modalidad !== modalidadActiva) { return false; }
				if (combosActivos.size && !combosActivos.has(p.grados_combo)) { return false; }
			}
			// Campos: basta con que cubra alguno de los marcados.
			if (cfActivos.size && !p.cfs.some(function (cf) { return cfActivos.has(cf); })) { return false; }
			return true;
		});
	}

	function filtrarProyectos() {
		var base = proyectosDeAula();
		llenarContenidos(base);
		if (!contenidoActivo) { return base; }
		return base.filter(function (p) {
			return p.pdas.some(function (x) {
				return x.contenido_id === contenidoActivo && (!pdaActivo || x.pda_id === pdaActivo);
			});
		});
	}

	// Lista de contenidos disponibles (los que cubre algún proyecto de la
	// selección actual), ordenados por campo y texto, sin repetidos.
	function llenarContenidos(base) {
		var vistos = {};
		base.forEach(function (p) {
			p.pdas.forEach(function (x) {
				if (!x.contenido_id || !x.contenido) { return; }
				if (cfActivos.size && !cfActivos.has(x.cf)) { return; }
				if (!vistos[x.contenido_id]) { vistos[x.contenido_id] = { id: x.contenido_id, texto: x.contenido, cf: x.cf }; }
			});
		});
		var lista = Object.keys(vistos).map(function (k) { return vistos[k]; });
		lista.sort(function (a, b) {
			var oa = Tienda.CF_ORDEN.indexOf(a.cf), ob = Tienda.CF_ORDEN.indexOf(b.cf);
			if (oa !== ob) { return oa - ob; }
			return a.texto.localeCompare(b.texto, "es");
		});
		contenidoPorTexto = {};
		listaContenidosEl.innerHTML = lista.map(function (c) {
			contenidoPorTexto[c.texto] = c.id;
			var cfNombre = Tienda.CF_COLOR[c.cf] ? Tienda.CF_COLOR[c.cf].corto : "";
			return '<option value="' + esc(c.texto) + '">' + esc(cfNombre) + "</option>";
		}).join("");
		filtroContenidoEl.placeholder = lista.length
			? "Escribe o elige entre " + lista.length + " contenidos"
			: "No hay contenidos para esta selección";

		// PDAs del contenido fijado, dentro de la selección actual.
		if (!contenidoActivo) { bloquePdaEl.classList.add("hidden"); return; }
		var pdas = {};
		base.forEach(function (p) {
			p.pdas.forEach(function (x) {
				if (x.contenido_id === contenidoActivo && x.pda_id && !pdas[x.pda_id]) {
					pdas[x.pda_id] = { id: x.pda_id, texto: x.pda, grado: x.grado };
				}
			});
		});
		var lp = Object.keys(pdas).map(function (k) { return pdas[k]; });
		lp.sort(function (a, b) { return (a.grado - b.grado) || a.texto.localeCompare(b.texto, "es"); });
		filtroPdaEl.innerHTML = '<option value="">Cualquier PDA de este contenido (' + lp.length + ")</option>" +
			lp.map(function (x) {
				return '<option value="' + esc(x.id) + '"' + (x.id === pdaActivo ? " selected" : "") + ">" +
					(x.grado ? x.grado + "° · " : "") + esc(recortar(x.texto, 140)) + "</option>";
			}).join("");
		bloquePdaEl.classList.remove("hidden");
	}

	// Fija un contenido por id (desde la lista o desde la URL) y sincroniza el
	// texto del campo. El PDA se conserva solo si pertenece a ese contenido.
	function fijarContenidoPorId(id, pdaId) {
		var encontrado = null;
		proyectos.some(function (p) {
			return p.pdas.some(function (x) {
				if (x.contenido_id === id) { encontrado = x; return true; }
				return false;
			});
		});
		if (!encontrado) { contenidoActivo = null; pdaActivo = null; return; }
		contenidoActivo = id;
		pdaActivo = pdaId || null;
		filtroContenidoEl.value = encontrado.contenido;
		limpiarContenidoEl.classList.remove("hidden");
	}

	function recortar(texto, n) {
		texto = String(texto || "");
		return texto.length > n ? texto.slice(0, n - 1) + "…" : texto;
	}

	function renderProyectos() {
		if (!proyectos.length) { mostrarVacioProyectos(true); return; }
		var lista = filtrarProyectos();
		if (contadorTextoEl) {
			contadorTextoEl.textContent = lista.length
				? lista.length + (lista.length === 1 ? " proyecto" : " proyectos")
				: "";
		}
		if (!lista.length) { mostrarVacioProyectos(false); return; }
		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";
		lista.forEach(function (p) { gridEl.appendChild(cardProyecto(p)); });
		Tienda.iconos();
	}

	function cardProyecto(p) {
		var esMulti = p.organizacion === "multigrado";
		var aula = esMulti ? "Multigrado " + comboDisplay(p.grados_combo) : p.grado + "° de Primaria";
		var gc = GRADO_COLOR[String(p.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
		var badge = esMulti
			? '<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">' + esc(comboDisplay(p.grados_combo)) + "</span>"
			: '<span style="background:' + gc.bg + ';color:' + gc.txt + '" class="absolute top-3 left-3 w-10 h-10 rounded-xl text-base font-black flex items-center justify-center shadow">' + esc(p.grado) + "°</span>";
		var sub = [];
		if (p.trimestre) { sub.push("Trimestre " + p.trimestre); }
		if (p.numero) { sub.push("Proyecto " + p.numero); }
		if (p.sesiones) { sub.push(p.sesiones + " sesiones"); }

		var a = document.createElement("a");
		a.href = "proyecto.html?id=" + encodeURIComponent(p.id);
		a.className = "prod-card bg-white rounded-3xl border overflow-hidden flex flex-col";
		a.style.borderColor = "#e7e6df";
		a.innerHTML =
			'<div class="relative">' +
			'<div class="ph h-32 overflow-hidden rounded-none border-x-0 border-t-0" data-portada style="border-radius:0">' + esc(aula) + " · portada</div>" +
			badge +
			(Tienda.promoActiva() ? '<span class="absolute top-3 right-3">' + Tienda.promoChip() + "</span>" : "") +
			"</div>" +
			'<div class="p-5 flex flex-col flex-1">' +
			'<p class="text-[12px] font-semibold" style="color:#5b6473">' + esc(aula + (sub.length ? " · " + sub.join(" · ") : "")) + "</p>" +
			'<h3 class="mt-1 font-bold text-[17px] leading-snug" style="color:#1c2434">' + esc(p.nombre) + "</h3>" +
			'<div class="mt-3 flex flex-wrap gap-1.5">' + p.cfs.map(function (cf) { return Tienda.chipCF(cf); }).join("") + "</div>" +
			'<div class="mt-3 flex flex-wrap gap-1.5">' +
			'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md bg-paper border border-line text-mute">PDF + Word incluidos</span>' +
			'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md text-board/70" style="background:rgba(133,184,230,.18);border:1px solid rgba(133,184,230,.4)">Anexos opcionales</span>' +
			"</div>" +
			'<div class="mt-4 pt-4 flex items-center justify-between" style="border-top:1px solid #e7e6df">' +
			"<div>" +
			(p.precio_pdf != null
				? '<span class="text-sm" style="color:#5b6473">Desde </span>' +
					Tienda.precioHTML(p.precio_pdf, { claseFinal: "font-black text-lg text-ink", claseLista: "text-mute text-[13px] font-bold" })
				: '<span class="text-sm" style="color:#5b6473">Ver opciones</span>') +
			"</div>" +
			'<span class="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-bold text-white" style="background:#059669">Ver <i data-lucide="arrow-right" class="w-4 h-4"></i></span>' +
			"</div></div>";

		Tienda.pintarPortada(a.querySelector("[data-portada]"), Tienda.slugPreview(p.organizacion, p.grado, p.grados_combo), p.nombre);
		return a;
	}

	// Sin resultados en proyectos: puente al pedido a la medida con lo que ya
	// se buscó, y registro silencioso de la búsqueda (señal de qué generar).
	function mostrarVacioProyectos(catalogoVacio) {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		if (contadorTextoEl) { contadorTextoEl.textContent = ""; }
		var qs = [];
		qs.push("org=" + encodeURIComponent(orgActiva));
		if (orgActiva === "completa" && gradosActivos.size) { qs.push("grado=" + encodeURIComponent(Array.from(gradosActivos).join(","))); }
		if (orgActiva === "multigrado" && combosActivos.size) { qs.push("combo=" + encodeURIComponent(Array.from(combosActivos)[0])); }
		if (cfActivos.size) { qs.push("cf=" + encodeURIComponent(Array.from(cfActivos).join(","))); }
		if (contenidoActivo) { qs.push("contenido_id=" + encodeURIComponent(contenidoActivo)); }
		if (pdaActivo) { qs.push("pda_id=" + encodeURIComponent(pdaActivo)); }
		var href = "personalizado.html?" + qs.join("&");
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-3 max-w-md mx-auto">' +
			'<i data-lucide="search-x" style="width:3rem;height:3rem;color:#5b6473"></i>' +
			'<p class="font-semibold text-lg" style="color:#1c2434">' + (catalogoVacio ? "Todavía no hay proyectos sueltos publicados" : "No hay un proyecto con esa combinación") + "</p>" +
			'<p class="text-sm" style="color:#5b6473">' + (catalogoVacio
				? "Estamos publicándolos. Mientras tanto puedes pedir uno a la medida."
				: "Prueba con otro campo o contenido, o pídelo a la medida con lo que ya elegiste: lo generamos y te lo entregamos en unos días.") + "</p>" +
			'<a href="' + esc(href) + '" class="mt-2 inline-flex items-center gap-2 text-white font-bold px-6 h-12 rounded-xl text-sm transition" style="background:#059669">Pedir un proyecto a la medida <i data-lucide="arrow-right" class="w-4 h-4"></i></a>' +
			"</div>";
		Tienda.iconos();
		if (!catalogoVacio) { registrarBusquedaVacia(); }
	}

	// Guarda la combinación de filtros que no encontró nada. La tabla llega
	// en un bloque posterior; si no existe (o la política no deja), se ignora.
	var ultimaBusquedaVacia = "";
	function registrarBusquedaVacia() {
		var filtros = {
			organizacion: orgActiva,
			grados: Array.from(gradosActivos),
			modalidad: modalidadActiva,
			combos: Array.from(combosActivos),
			campos: Array.from(cfActivos),
			contenido_id: contenidoActivo,
			pda_id: pdaActivo,
		};
		var clave = JSON.stringify(filtros);
		if (clave === ultimaBusquedaVacia) { return; }
		ultimaBusquedaVacia = clave;
		try {
			window.sb.from("marketplace_busquedas_vacias").insert({ filtros: filtros }).then(function () {});
		} catch (_) { /* sin registro */ }
	}

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
			// El badge de grado ocupa la esquina izquierda: el descuento va enfrente.
			(Tienda.promoActiva() ? '<span class="absolute top-3 right-3">' + Tienda.promoChip() + '</span>' : "") +
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
				? '<span class="text-sm" style="color:#5b6473">Desde </span>' +
					Tienda.precioHTML(precioDesde, {
						claseFinal: "font-black text-lg text-ink",
						claseLista: "text-mute text-[13px] font-bold",
					}) +
					'<span class="text-sm" style="color:#5b6473"> / trim</span>'
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
	// Un maestro unitario atiende los 6 grados. Su paquete es un combo sin
	// producto propio en la base, así que aquí solo se pinta UNA tarjeta —con
	// el mismo aspecto que las demás— que lleva a la ficha
	// producto.html?org=multigrado&combo=unitaria, donde se elige agrupación,
	// paquete y versión. El "desde" sale del tarifario vía RPC.

	var precioUnitaria = null; // cache del "desde" ($/trimestre)

	async function renderUnitaria() {
		if (contadorTextoEl) { contadorTextoEl.textContent = "1 paquete"; }
		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";
		gridEl.appendChild(cardUnitaria());
		Tienda.iconos();

		if (precioUnitaria == null) {
			var r = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "trimestre" });
			if (!r.error && r.data) { precioUnitaria = Number(r.data.precio_pdf); }
		}
		// Si el maestro ya cambió de filtro mientras llegaba la RPC, el nodo ya
		// no está y no hay nada que actualizar.
		var precioEl = gridEl.querySelector("[data-precio-unitaria]");
		if (precioEl && precioUnitaria != null) {
			precioEl.innerHTML = '<span class="text-sm" style="color:#5b6473">Desde </span>' +
				Tienda.precioHTML(precioUnitaria, {
					claseFinal: "font-black text-lg text-ink",
					claseLista: "text-mute text-[13px] font-bold",
				}) +
				'<span class="text-sm" style="color:#5b6473"> / trim</span>';
		}
	}

	function cardUnitaria() {
		var titulo = "Multigrado Unitaria de Primaria";
		var a = document.createElement("a");
		a.href = "producto.html?org=multigrado&combo=unitaria";
		a.className = "prod-card bg-white rounded-3xl border overflow-hidden flex flex-col";
		a.style.borderColor = "#e7e6df";
		a.innerHTML =
			'<div class="relative">' +
			'<div class="ph h-40 overflow-hidden rounded-none border-x-0 border-t-0" data-portada style="border-radius:0">' + esc(titulo) + ' · portada</div>' +
			'<span class="absolute top-3 left-3 h-9 px-3 rounded-xl text-sm font-black flex items-center justify-center shadow" style="background:#1e3a8a;color:#fff">Unitaria</span>' +
			(Tienda.promoActiva() ? '<span class="absolute top-3 right-3">' + Tienda.promoChip() + '</span>' : "") +
			'</div>' +
			'<div class="p-5 flex flex-col flex-1">' +
			'<h3 class="font-bold text-lg leading-snug" style="color:#1c2434">' + esc(titulo) + '</h3>' +
			'<p class="mt-1 text-sm" style="color:#5b6473">Los 6 grados en una sola compra, con descuento. Eliges combos de 2 o de 3 grados.</p>' +
			'<div class="mt-3 flex flex-wrap gap-1.5">' +
			'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md bg-paper border border-line text-mute">PDF</span>' +
			'<span class="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-md text-board/70" style="background:rgba(133,184,230,.18);border:1px solid rgba(133,184,230,.4)">+ Word disponible</span>' +
			'</div>' +
			'<div class="mt-4 pt-4 flex items-center justify-between" style="border-top:1px solid #e7e6df">' +
			'<div data-precio-unitaria><span class="text-sm" style="color:#5b6473">Ver opciones</span></div>' +
			'<span class="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-bold text-white" style="background:#059669">Ver <i data-lucide="arrow-right" class="w-4 h-4"></i></span>' +
			'</div></div>';

		Tienda.pintarPortada(a.querySelector("[data-portada]"), "multi-unitaria", titulo);
		return a;
	}

	function mostrarCargando() {
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		estadoEl.innerHTML = '<p style="color:#5b6473">Cargando ' + (vista === "proyectos" ? "proyectos" : "paquetes") + "...</p>";
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
