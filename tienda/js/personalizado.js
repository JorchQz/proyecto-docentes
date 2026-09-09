// Formulario del proyecto a la medida.
//
// No cobra: arma el pedido, lo guarda como borrador en localStorage y manda al
// checkout (checkout.html?personalizado=1), que es quien crea la cuenta si
// hace falta, aplica cupón y abre Mercado Pago. Precio, cupo y ventana salen
// de la RPC pública marketplace_personalizados_estado.
//
// Campos, contenidos y PDAs son de selección MÚLTIPLE, con buscador de texto.
// Un PDA pertenece a un solo contenido: al elegir un PDA se agrega su
// contenido solo; al quitar un contenido se quitan sus PDAs.
document.addEventListener("DOMContentLoaded", async function () {
	// El descuento general solo aplica aquí si el admin lo activó para los
	// pedidos a la medida (interruptor propio en el panel).
	Tienda.setAmbito("personalizado");
	if (!window.sb) { return; }

	await Tienda.montarNav("");
	Tienda.montarFooter();
	var esc = Tienda.esc;

	var CLAVE_BORRADOR = "jissez_pedido";
	var COMBOS = { "1-2": "tridocente", "3-4": "tridocente", "5-6": "tridocente", "1-2-3": "bidocente", "4-5-6": "bidocente" };
	var MAX_RESULTADOS = 40;

	var cargandoEl = document.getElementById("cargando");
	var contenidoEl = document.getElementById("contenido");
	var estadoCupoEl = document.getElementById("estadoCupo");
	var chipsOrgEl = document.getElementById("chipsOrg");
	var bloqueGrado = document.getElementById("bloqueGrado");
	var bloqueCombo = document.getElementById("bloqueCombo");
	var chipsGradoEl = document.getElementById("chipsGrado");
	var chipsComboEl = document.getElementById("chipsCombo");
	var opcionesNivelEl = document.getElementById("opcionesNivel");
	var chipsCFEl = document.getElementById("chipsCF");
	var chipsContenidosEl = document.getElementById("chipsContenidos");
	var buscarContenidoEl = document.getElementById("buscarContenido");
	var listaContenidosEl = document.getElementById("listaContenidos");
	var ayudaContenidoEl = document.getElementById("ayudaContenido");
	var chipsPdasEl = document.getElementById("chipsPdas");
	var buscarPdaEl = document.getElementById("buscarPda");
	var listaPdasEl = document.getElementById("listaPdas");
	var ayudaPdaEl = document.getElementById("ayudaPda");
	var selMetodologia = document.getElementById("selMetodologia");
	var fFecha = document.getElementById("fFecha");
	var fNotas = document.getElementById("fNotas");
	var mensajeForm = document.getElementById("mensajeForm");
	var continuarBtn = document.getElementById("continuarBtn");
	var resumenEl = document.getElementById("resumen");
	var resumenPrecio = document.getElementById("resumenPrecio");
	var resumenEntrega = document.getElementById("resumenEntrega");

	// Estado del pedido. Se prellena desde la URL (llega del catálogo sin
	// resultados) o desde el borrador guardado si el maestro vuelve atrás.
	var pedido = {
		organizacion: "completa",
		grado: null,
		grados_combo: null,
		nivel: "con_anexos",
		campos_formativos: [],
		contenido_ids: [],
		pda_ids: [],
		metodologia: "",
		fecha_necesaria: "",
		notas: "",
	};
	var estado = null;         // respuesta de marketplace_personalizados_estado
	var contenidos = [];       // catalogo_contenidos de la(s) fase(s) actual(es)
	var pdas = [];             // catalogo_pda de los grados actuales
	var contenidoPorId = {};
	var pdaPorId = {};
	var cargaActual = 0;       // evita que una carga vieja pise a la nueva

	var params = new URLSearchParams(location.search);
	var borrador = leerBorrador();
	if (borrador && !params.get("org")) {
		Object.keys(pedido).forEach(function (k) { if (borrador[k] != null) { pedido[k] = borrador[k]; } });
	}
	if (params.get("org") === "multigrado") { pedido.organizacion = "multigrado"; }
	var gParam = (params.get("grado") || "").split(",")[0];
	if (/^[1-6]$/.test(gParam)) { pedido.grado = Number(gParam); }
	if (COMBOS[params.get("combo") || ""]) { pedido.grados_combo = params.get("combo"); pedido.organizacion = "multigrado"; }
	(params.get("cf") || "").split(",").forEach(function (cf) {
		if (Tienda.CF_COLOR[cf] && pedido.campos_formativos.indexOf(cf) === -1) { pedido.campos_formativos.push(cf); }
	});
	// Del catálogo llegan listas (contenido_ids=a,b&pda_ids=c); se aceptan
	// también las claves en singular por compatibilidad.
	((params.get("contenido_ids") || params.get("contenido_id") || "").split(",")).forEach(function (id) {
		if (id && pedido.contenido_ids.indexOf(id) === -1) { pedido.contenido_ids.push(id); }
	});
	((params.get("pda_ids") || params.get("pda_id") || "").split(",")).forEach(function (id) {
		if (id && pedido.pda_ids.indexOf(id) === -1) { pedido.pda_ids.push(id); }
	});

	// ── Disponibilidad y precios ──────────────────────────────────────────────
	var res = await Promise.all([
		window.sb.rpc("marketplace_personalizados_estado"),
		Tienda.cargarPromo(),
	]);
	cargandoEl.classList.add("hidden");
	if (res[0].error || !res[0].data) {
		cargandoEl.classList.remove("hidden");
		cargandoEl.textContent = "No pudimos cargar la disponibilidad. Recarga la página.";
		return;
	}
	estado = res[0].data;
	pintarCupo();
	contenidoEl.classList.remove("hidden");

	pintarOrg();
	pintarGradoCombo();
	pintarNivel();
	pintarCF();
	selMetodologia.value = pedido.metodologia || "";
	fFecha.value = pedido.fecha_necesaria || "";
	fNotas.value = pedido.notas || "";
	// El precio y el grupo se pintan ya; los catálogos SEP llegan después y
	// vuelven a pintar el resumen con contenidos y PDAs.
	pintarResumen();
	Tienda.iconos();
	await cargarCatalogos();
	pintarResumen();
	Tienda.iconos();

	// ── Chips de grupo, versión y campo ──────────────────────────────────────
	chipsOrgEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-org");
		if (!c) { return; }
		pedido.organizacion = c.getAttribute("data-org");
		pintarOrg();
		cargarCatalogos().then(pintarResumen);
		pintarResumen();
	});
	chipsGradoEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-grado");
		if (!c) { return; }
		pedido.grado = Number(c.getAttribute("data-grado"));
		pintarGradoCombo();
		cargarCatalogos().then(pintarResumen);
		pintarResumen();
	});
	chipsComboEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-combo");
		if (!c) { return; }
		pedido.grados_combo = c.getAttribute("data-combo");
		pintarGradoCombo();
		cargarCatalogos().then(pintarResumen);
		pintarResumen();
	});
	chipsCFEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-cf");
		if (!c) { return; }
		var cf = c.getAttribute("data-cf");
		var i = pedido.campos_formativos.indexOf(cf);
		if (i === -1) { pedido.campos_formativos.push(cf); } else { pedido.campos_formativos.splice(i, 1); }
		pintarCF();
		pintarAyudas();
		pintarResumen();
	});
	selMetodologia.addEventListener("change", function () { pedido.metodologia = selMetodologia.value; pintarResumen(); });
	fFecha.addEventListener("change", function () { pedido.fecha_necesaria = fFecha.value; pintarResumen(); });
	fNotas.addEventListener("input", function () { pedido.notas = fNotas.value; });

	function setChip(chip, activo) {
		chip.classList.toggle("active", activo);
		chip.classList.toggle("border-line", !activo);
		chip.classList.toggle("text-ink", !activo);
	}
	function pintarOrg() {
		var multi = pedido.organizacion === "multigrado";
		chipsOrgEl.querySelectorAll(".chip-org").forEach(function (x) { setChip(x, x.getAttribute("data-org") === pedido.organizacion); });
		bloqueGrado.classList.toggle("hidden", multi);
		bloqueCombo.classList.toggle("hidden", !multi);
	}
	function pintarGradoCombo() {
		chipsGradoEl.querySelectorAll(".chip-grado").forEach(function (x) { setChip(x, Number(x.getAttribute("data-grado")) === pedido.grado); });
		chipsComboEl.querySelectorAll(".chip-combo").forEach(function (x) { setChip(x, x.getAttribute("data-combo") === pedido.grados_combo); });
	}
	function pintarCF() {
		chipsCFEl.querySelectorAll(".chip-cf").forEach(function (x) { setChip(x, pedido.campos_formativos.indexOf(x.getAttribute("data-cf")) !== -1); });
	}

	// ── Versión ───────────────────────────────────────────────────────────────
	function pintarNivel() {
		var opciones = [
			{ valor: "sin_anexos", titulo: "Sin anexos", sub: "Planeación completa en PDF y Word", precio: estado.precio_sin_anexos },
			{ valor: "con_anexos", titulo: "Con anexos", sub: "Planeación en PDF y Word + anexos imprimibles por sesión", precio: estado.precio_con_anexos },
		];
		opcionesNivelEl.innerHTML = opciones.map(function (o) { return Tienda.opcionVersion(o, o.valor === pedido.nivel); }).join("");
		opcionesNivelEl.querySelectorAll("[data-opcion]").forEach(function (b) {
			b.addEventListener("click", function () { pedido.nivel = b.getAttribute("data-opcion"); pintarNivel(); pintarResumen(); });
		});
	}

	// ── Catálogos SEP del grupo elegido ───────────────────────────────────────
	function gradosActuales() {
		return pedido.organizacion === "multigrado"
			? (pedido.grados_combo ? pedido.grados_combo.split("-").map(Number) : [])
			: (pedido.grado ? [pedido.grado] : []);
	}
	function fasesActuales(grados) {
		// catalogo_contenidos.fase es texto ("Fase 3"), no número.
		var fases = {};
		grados.forEach(function (g) { fases["Fase " + (g <= 2 ? 3 : (g <= 4 ? 4 : 5))] = true; });
		return Object.keys(fases);
	}

	// Contenidos de la fase y PDAs de los grados, en un solo viaje cada uno.
	// Las selecciones que ya no pertenecen al grupo nuevo se descartan.
	async function cargarCatalogos() {
		var grados = gradosActuales();
		var mia = ++cargaActual;
		if (!grados.length) {
			// Sin grado no hay catálogo, pero las selecciones se conservan (por
			// ejemplo, las que llegan del catálogo en la URL): se validan y se
			// pintan en cuanto se elige el grado.
			contenidos = []; pdas = []; contenidoPorId = {}; pdaPorId = {};
			pintarSelecciones(); pintarAyudas();
			return;
		}
		var r = await Promise.all([
			window.sb.from("catalogo_contenidos")
				.select("id, fase, campo_formativo, contenido, orden")
				.in("fase", fasesActuales(grados)).order("campo_formativo").order("orden"),
			window.sb.from("catalogo_pda")
				.select("id, contenido_id, grado, pda, orden")
				.in("grado", grados).order("grado").order("orden"),
		]);
		if (mia !== cargaActual) { return; }
		contenidoPorId = {};
		contenidos = (r[0].data || []).map(function (c) {
			var item = { id: c.id, cf: window.CamposFormativos.corto(c.campo_formativo), texto: c.contenido, norm: normalizar(c.contenido) };
			contenidoPorId[c.id] = item;
			return item;
		});
		pdaPorId = {};
		pdas = (r[1].data || []).map(function (p) {
			var c = contenidoPorId[p.contenido_id];
			var item = { id: p.id, contenido_id: p.contenido_id, grado: p.grado, texto: p.pda, cf: c ? c.cf : null, norm: normalizar(p.pda + " " + (c ? c.texto : "")) };
			pdaPorId[p.id] = item;
			return item;
		});
		pedido.contenido_ids = pedido.contenido_ids.filter(function (id) { return !!contenidoPorId[id]; });
		pedido.pda_ids = pedido.pda_ids.filter(function (id) { return !!pdaPorId[id]; });
		// Un PDA elegido desde el catálogo trae su contenido.
		pedido.pda_ids.forEach(function (id) { agregarContenido(pdaPorId[id].contenido_id, true); });
		pintarSelecciones();
		pintarAyudas();
	}

	function normalizar(s) { return Tienda.normalizarTexto(s); }
	function coincide(item, consulta) { return Tienda.coincideTexto(item.norm, consulta); }
	function pasaCF(item) {
		return !pedido.campos_formativos.length || pedido.campos_formativos.indexOf(item.cf) !== -1;
	}

	// ── Selección de contenidos y PDAs ────────────────────────────────────────
	function agregarContenido(id, silencioso) {
		if (!contenidoPorId[id] || pedido.contenido_ids.indexOf(id) !== -1) { return; }
		pedido.contenido_ids.push(id);
		if (!silencioso) { pintarSelecciones(); pintarAyudas(); pintarResumen(); }
	}
	function quitarContenido(id) {
		pedido.contenido_ids = pedido.contenido_ids.filter(function (x) { return x !== id; });
		// Sus PDAs ya no tienen sentido sin el contenido.
		pedido.pda_ids = pedido.pda_ids.filter(function (p) { return !pdaPorId[p] || pdaPorId[p].contenido_id !== id; });
		pintarSelecciones(); pintarAyudas(); pintarResumen();
	}
	function agregarPda(id) {
		var p = pdaPorId[id];
		if (!p || pedido.pda_ids.indexOf(id) !== -1) { return; }
		pedido.pda_ids.push(id);
		// El PDA es único de su contenido: el contenido se agrega solo.
		agregarContenido(p.contenido_id, true);
		pintarSelecciones(); pintarAyudas(); pintarResumen();
	}
	function quitarPda(id) {
		pedido.pda_ids = pedido.pda_ids.filter(function (x) { return x !== id; });
		pintarSelecciones(); pintarAyudas(); pintarResumen();
	}

	function chipSeleccion(texto, cf, tipo, id) { return Tienda.chipQuitable(texto, cf, tipo, id); }
	function pintarSelecciones() {
		chipsContenidosEl.innerHTML = pedido.contenido_ids.map(function (id) {
			var c = contenidoPorId[id];
			return c ? chipSeleccion(c.texto, c.cf, "contenido", id) : "";
		}).join("");
		chipsPdasEl.innerHTML = pedido.pda_ids.map(function (id) {
			var p = pdaPorId[id];
			return p ? chipSeleccion(p.grado + "° · " + p.texto, p.cf, "pda", id) : "";
		}).join("");
		Tienda.iconos();
	}
	document.addEventListener("click", function (e) {
		var b = e.target.closest("[data-quitar]");
		if (!b) { return; }
		if (b.getAttribute("data-quitar") === "contenido") { quitarContenido(b.getAttribute("data-id")); }
		else { quitarPda(b.getAttribute("data-id")); }
	});

	function pintarAyudas() {
		// Las casillas nunca se deshabilitan: una casilla gris sin explicación
		// parece rota. Si falta el grado, la propia lista lo dice al hacer clic.
		var grados = gradosActuales();
		if (!grados.length) {
			ayudaContenidoEl.textContent = "Elige el grado arriba para ver los contenidos de su fase.";
			ayudaPdaEl.textContent = "Elige el grado arriba para ver sus PDAs.";
			return;
		}
		var nC = contenidos.filter(pasaCF).length;
		var nP = pdas.filter(pasaCF).length;
		ayudaContenidoEl.textContent = nC + " contenidos disponibles" + (pedido.campos_formativos.length ? " en los campos elegidos" : "") + ". Escribe para filtrar o deja vacío y lo elegimos nosotros.";
		ayudaPdaEl.textContent = pedido.contenido_ids.length
			? "Verás los PDAs de tus contenidos; escribe para buscar entre los " + nP + " del grado (su contenido se agrega solo)."
			: nP + " PDAs disponibles. Al elegir un PDA se agrega su contenido.";
	}

	// ── Buscadores (Tienda.combobox, compartido con el catálogo) ─────────────
	function combobox(input, lista, buscar, elegir) { return Tienda.combobox(input, lista, buscar, elegir); }

	combobox(buscarContenidoEl, listaContenidosEl, function (consulta) {
		var items = contenidos.filter(pasaCF).filter(function (c) { return !consulta || coincide(c, consulta); })
			.map(function (c) { return { id: c.id, texto: c.texto, cf: c.cf, sub: Tienda.CF_COLOR[c.cf] ? Tienda.CF_COLOR[c.cf].corto : "", elegido: pedido.contenido_ids.indexOf(c.id) !== -1 }; });
		return { items: items, vacio: gradosActuales().length ? null : "Primero elige el grado en el paso 1: los contenidos y PDAs dependen de él." };
	}, agregarContenido);

	// PDAs: sin contenidos elegidos, todos los del grado. Con contenidos
	// elegidos y la casilla vacía, SOLO los de esos contenidos (es lo que casi
	// siempre se busca). Al escribir se busca entre todos: si eliges uno de otro
	// contenido, ese contenido se agrega solo.
	combobox(buscarPdaEl, listaPdasEl, function (consulta) {
		var hayContenidos = pedido.contenido_ids.length > 0;
		var base = pdas.filter(pasaCF);
		var esDeElegido = function (p) { return pedido.contenido_ids.indexOf(p.contenido_id) !== -1; };
		var lista, encabezado = "";
		if (!consulta && hayContenidos) {
			lista = base.filter(esDeElegido);
			encabezado = "PDAs de tus contenidos · escribe para buscar cualquier otro";
		} else {
			lista = base.filter(function (p) { return !consulta || coincide(p, consulta); });
			if (hayContenidos) {
				lista.sort(function (a, b) { return (esDeElegido(a) ? 0 : 1) - (esDeElegido(b) ? 0 : 1); });
				encabezado = "Primero los de tus contenidos; al elegir otro, su contenido se agrega solo";
			}
		}
		return {
			encabezado: encabezado,
			vacio: gradosActuales().length ? null : "Primero elige el grado en el paso 1: los contenidos y PDAs dependen de él.",
			items: lista.map(function (p) {
				var c = contenidoPorId[p.contenido_id];
				return { id: p.id, prefijo: p.grado + "°", texto: p.texto, cf: p.cf, sub: c ? c.texto : "", elegido: pedido.pda_ids.indexOf(p.id) !== -1 };
			}),
		};
	}, agregarPda);

	// ── Cupo ──────────────────────────────────────────────────────────────────
	function pintarCupo() {
		var cerrado = !estado.abierto;
		var agotado = Number(estado.cupos_disponibles) <= 0;
		estadoCupoEl.classList.remove("hidden");
		if (cerrado || agotado) {
			// El cupo es simultáneo: se libera un lugar en cuanto se entrega un
			// pedido, no en una fecha fija.
			estadoCupoEl.style.cssText = "background:#fffbeb;border:1px solid #fcd34d;color:#92400e";
			estadoCupoEl.innerHTML = '<i data-lucide="clock" class="w-5 h-5 shrink-0 mt-0.5"></i><div>' +
				"<p class=\"font-semibold\">" + (cerrado ? "Por ahora no recibimos pedidos a la medida" : "Por ahora no hay cupo: todos los lugares están ocupados") + "</p>" +
				"<p>" + esc(cerrado ? (estado.mensaje || "Vuelve a intentarlo en unos días.") : "En cuanto entreguemos un pedido se libera un lugar, normalmente en horas. Vuelve a intentarlo más tarde o revisa los proyectos del catálogo.") + "</p></div>";
			continuarBtn.disabled = true;
			continuarBtn.style.opacity = ".5";
			continuarBtn.innerHTML = cerrado ? "Pedidos cerrados por ahora" : "Sin cupo por ahora";
			return;
		}
		estadoCupoEl.style.cssText = "background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.25);color:#047857";
		estadoCupoEl.innerHTML = '<i data-lucide="check-circle-2" class="w-5 h-5 shrink-0 mt-0.5"></i><div>' +
			'<p class="font-semibold">Recibimos pedidos ahora · ' + estado.cupos_disponibles + (estado.cupos_disponibles === 1 ? " lugar disponible" : " lugares disponibles") + "</p>" +
			"<p>Entrega en tu biblioteca en un máximo de " + Math.round(estado.ventana_horas) + " horas a partir de tu pago.</p></div>";
	}

	// ── Resumen ───────────────────────────────────────────────────────────────
	function aulaTexto() {
		if (pedido.organizacion === "multigrado") {
			return pedido.grados_combo ? "Multigrado " + pedido.grados_combo.split("-").map(function (n) { return n + "°"; }).join("-") : "Elige los grados";
		}
		return pedido.grado ? pedido.grado + "° de Primaria" : "Elige el grado";
	}
	function pintarResumen() {
		var filas = [["Grupo", aulaTexto()], ["Versión", pedido.nivel === "con_anexos" ? "PDF + Word + anexos" : "PDF + Word (sin anexos)"]];
		if (pedido.campos_formativos.length) {
			filas.push([pedido.campos_formativos.length > 1 ? "Campos" : "Campo", pedido.campos_formativos.map(function (c) { return Tienda.CF_COLOR[c].nombre; }).join(", ")]);
		}
		pedido.contenido_ids.forEach(function (id) { if (contenidoPorId[id]) { filas.push(["Contenido", contenidoPorId[id].texto]); } });
		pedido.pda_ids.forEach(function (id) { if (pdaPorId[id]) { filas.push(["PDA", pdaPorId[id].grado + "° · " + pdaPorId[id].texto]); } });
		if (pedido.metodologia) { filas.push(["Metodología", pedido.metodologia]); }
		if (pedido.fecha_necesaria) { filas.push(["Lo necesitas para", pedido.fecha_necesaria]); }
		resumenEl.innerHTML = filas.map(function (f) {
			return '<div class="flex gap-3"><dt class="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-mute pt-0.5">' + esc(f[0]) + '</dt><dd class="text-ink leading-snug">' + esc(f[1]) + "</dd></div>";
		}).join("");
		var lista = Number(pedido.nivel === "con_anexos" ? estado.precio_con_anexos : estado.precio_sin_anexos);
		resumenPrecio.innerHTML = Tienda.precioHTML(lista, { claseFinal: "font-black text-ink text-2xl", claseLista: "text-mute text-base font-bold" });
		resumenEntrega.textContent = "Se paga por adelantado. Entrega comprometida: hasta " + Math.round(estado.ventana_horas) + " horas después del pago.";
	}

	// ── Continuar ─────────────────────────────────────────────────────────────
	document.getElementById("formPedido").addEventListener("submit", function (e) {
		e.preventDefault();
		var esMulti = pedido.organizacion === "multigrado";
		if (esMulti ? !pedido.grados_combo : !pedido.grado) {
			aviso(esMulti ? "Elige los grados que atiendes." : "Elige el grado.");
			return;
		}
		var borradorNuevo = {
			organizacion: pedido.organizacion,
			grado: esMulti ? null : pedido.grado,
			grados_combo: esMulti ? pedido.grados_combo : null,
			nivel: pedido.nivel,
			campos_formativos: pedido.campos_formativos.slice(),
			contenido_ids: pedido.contenido_ids.slice(),
			pda_ids: pedido.pda_ids.slice(),
			metodologia: pedido.metodologia || "",
			fecha_necesaria: pedido.fecha_necesaria || "",
			notas: (pedido.notas || "").trim(),
			// Textos para pintar el resumen en el checkout sin volver a consultar.
			contenidos_texto: pedido.contenido_ids.map(function (id) { return contenidoPorId[id] ? contenidoPorId[id].texto : null; }).filter(Boolean),
			pdas_texto: pedido.pda_ids.map(function (id) { return pdaPorId[id] ? pdaPorId[id].grado + "° · " + pdaPorId[id].texto : null; }).filter(Boolean),
			guardado_en: new Date().toISOString(),
		};
		try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borradorNuevo)); } catch (_) {
			aviso("Tu navegador no permite guardar el pedido. Activa el almacenamiento local e inténtalo de nuevo.");
			return;
		}
		location.href = "checkout.html?personalizado=1";
	});

	function aviso(texto) {
		mensajeForm.textContent = texto;
		mensajeForm.style.cssText = "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5";
		mensajeForm.classList.remove("hidden");
		mensajeForm.scrollIntoView({ behavior: "smooth", block: "center" });
	}
	function leerBorrador() {
		try {
			var raw = localStorage.getItem(CLAVE_BORRADOR);
			if (!raw) { return null; }
			var b = JSON.parse(raw);
			// Un borrador de más de un día ya no refleja lo que quiere el maestro.
			if (!b.guardado_en || Date.now() - new Date(b.guardado_en).getTime() > 24 * 60 * 60 * 1000) { return null; }
			return b;
		} catch (_) { return null; }
	}
});
