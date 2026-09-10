document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("admin");
	var denegadoEl = document.getElementById("denegado");
	var panelEl = document.getElementById("panel");

	if (!session || !Tienda.esAdmin(session)) {
		denegadoEl.classList.remove("hidden");
		Tienda.iconos();
		return;
	}
	panelEl.classList.remove("hidden");

	var esc = Tienda.esc;
	var money = Tienda.formatMoney;

	// Precios de arranque al crear un paquete nuevo (tarifario nivel 1).
	// La fuente de verdad es la tabla marketplace_precios: en cuanto se acredita
	// una venta, marketplace_aplicar_precios() reescribe estos valores.
	// Son precios de LISTA y deben seguir siéndolo: la promoción por tiempo
	// limitado nunca se siembra en la base, se aplica al mostrar y al cobrar.
	var PRECIO = {
		completa: { trimestre: { pdf: 249, editable: 298 }, ciclo: { pdf: 499, editable: 598 } },
		multigrado: { trimestre: { pdf: 299, editable: 348 }, ciclo: { pdf: 599, editable: 698 } },
	};

	// Combinaciones multigrado (orden de muestra).
	var COMBOS = [
		{ combo: "1-2", modalidad: "tridocente", grado: 1, fase: 3 },
		{ combo: "3-4", modalidad: "tridocente", grado: 3, fase: 4 },
		{ combo: "5-6", modalidad: "tridocente", grado: 5, fase: 5 },
		{ combo: "1-2-3", modalidad: "bidocente", grado: 1, fase: 3 },
		{ combo: "4-5-6", modalidad: "bidocente", grado: 4, fase: 4 },
	];

	// Estado
	var productos = [];
	var porClave = {};
	var edit = null;

	function faseDeGrado(g) { return g <= 2 ? 3 : (g <= 4 ? 4 : 5); }
	function comboDisplay(combo) { return combo.split("-").map(function (n) { return n + "°"; }).join("-"); }

	function clave(p) {
		var suf = p.tipo_paquete + "-" + (p.tipo_paquete === "ciclo" ? "C" : p.trimestre);
		return p.organizacion === "multigrado"
			? "m-" + p.grados_combo + "-" + suf
			: "c-" + p.grado + "-" + suf;
	}
	function claveDe(org, llave, tipo, trimestre) {
		var suf = tipo + "-" + (tipo === "ciclo" ? "C" : trimestre);
		return (org === "multigrado" ? "m-" + llave + "-" : "c-" + llave + "-") + suf;
	}

	function tituloPaquete(org, grado, combo, tipo, trimestre) {
		var base = org === "multigrado" ? "Multigrado " + comboDisplay(combo) : grado + "° Primaria";
		return tipo === "ciclo" ? base + " — Ciclo completo" : base + " — Trimestre " + trimestre;
	}

	// ── Tabs ──────────────────────────────────────────────────────────────────
	var tabs = document.querySelectorAll(".tab-btn");
	var paneles = {
		productos: document.getElementById("panelProductos"),
		sueltos: document.getElementById("panelSueltos"),
		pedidos: document.getElementById("panelPedidos"),
		precios: document.getElementById("panelPrecios"),
		ordenes: document.getElementById("panelOrdenes"),
		acceso: document.getElementById("panelAcceso"),
	};
	tabs.forEach(function (t) {
		t.addEventListener("click", function () {
			var tab = t.getAttribute("data-tab");
			tabs.forEach(function (x) {
				if (x === t) { x.classList.add("active"); } else { x.classList.remove("active"); }
			});
			Object.keys(paneles).forEach(function (k) {
				paneles[k].classList.toggle("hidden", k !== tab);
			});
			if (tab === "ordenes") { cargarOrdenes(); }
			if (tab === "precios") { cargarPrecios(); }
			if (tab === "sueltos") { renderSueltos(); }
			if (tab === "pedidos") { cargarPedidos(); }
		});
	});

	async function cargarProductos() {
		var res = await window.sb
			.from("marketplace_productos")
			// Los *_drive_id ya no son legibles desde el cliente (seguridad): la
			// carpeta de Drive se carga al abrir el editor vía RPC admin_producto_drive.
			.select("id, titulo, descripcion, grado, fase, campo_formativo, metodologia, escenario, trimestre, num_sesiones, precio_pdf, precio_editable, precio_pdf_con_anexos, numero_proyecto, tiene_anexos, portada_url, activo, dosificacion_proyecto_id, created_at, updated_at, tipo_paquete, num_proyectos, organizacion, grados_combo, modalidad, es_prueba")
			.order("grado", { ascending: true });
		productos = res.data || [];
		porClave = {};
		// La grilla es de paquetes; los proyectos individuales tienen su pestaña.
		productos.forEach(function (p) { if (p.tipo_paquete !== "proyecto") { porClave[clave(p)] = p; } });
		renderGrid();
		poblarSelectProductos();
		poblarSelectSueltos();
	}

	// ── Grilla ────────────────────────────────────────────────────────────────
	var gridEl = document.getElementById("gridPaquetes");

	function renderGrid() {
		var html = "";

		// Organización completa: 6 grados.
		html += '<div><h2 class="text-lg font-extrabold mb-3" style="color:#1e3a8a">Organización completa</h2>';
		for (var g = 1; g <= 6; g++) {
			html += bloqueFila(g + "° grado", "completa", String(g), g, "");
		}
		html += "</div>";

		// Multigrado: 5 combinaciones.
		html += '<div><h2 class="text-lg font-extrabold mb-3 mt-2" style="color:#1e3a8a">Multigrado</h2>';
		COMBOS.forEach(function (c) {
			var sub = c.modalidad === "bidocente" ? "Bidocente" : "Tridocente";
			html += bloqueFila("Multigrado " + comboDisplay(c.combo) + " · " + sub, "multigrado", c.combo, c.grado, c.combo);
		});
		html += "</div>";

		gridEl.innerHTML = html;

		gridEl.querySelectorAll("[data-cfg]").forEach(function (b) {
			b.addEventListener("click", function () {
				abrirEditor(
					b.getAttribute("data-org"),
					b.getAttribute("data-llave"),
					b.getAttribute("data-tipo"),
					b.getAttribute("data-tri") === "null" ? null : parseInt(b.getAttribute("data-tri"), 10)
				);
			});
		});
		Tienda.iconos();
	}

	// Una fila = título + 4 celdas (T1, T2, T3, Ciclo).
	function bloqueFila(titulo, org, llave, grado, combo) {
		var celdas = "";
		celdas += celda(org, llave, "trimestre", 1, "Trimestre 1", "4 proyectos");
		celdas += celda(org, llave, "trimestre", 2, "Trimestre 2", "4 proyectos");
		celdas += celda(org, llave, "trimestre", 3, "Trimestre 3", "4 proyectos");
		celdas += celda(org, llave, "ciclo", null, "Ciclo completo", "12 proyectos");
		return (
			'<div class="mb-4"><h3 class="font-bold mb-2 text-sm" style="color:#5b6473">' + esc(titulo) + "</h3>" +
			'<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' + celdas + "</div></div>"
		);
	}

	function celda(org, llave, tipo, trimestre, etiqueta, sub) {
		var prod = porClave[claveDe(org, llave, tipo, trimestre)];
		var estadoHtml, borderColor;
		if (!prod) {
			estadoHtml = '<span class="text-[11px] font-semibold" style="color:#5b6473">Sin configurar</span>';
			borderColor = "#e7e6df";
		} else if (prod.activo) {
			estadoHtml = '<span class="text-[11px] font-semibold" style="color:#047a55">Publicado · ' + money(prod.precio_pdf) + "</span>";
			borderColor = "#6ee7b7";
		} else {
			estadoHtml = '<span class="text-[11px] font-semibold" style="color:#b45309">Oculto</span>';
			borderColor = "#fcd34d";
		}
		return (
			'<button data-cfg="1" data-org="' + esc(org) + '" data-llave="' + esc(llave) + '" data-tipo="' + tipo + '" data-tri="' + trimestre + '" ' +
			'class="text-left bg-white rounded-xl p-3 hover:shadow-md transition min-h-[78px] flex flex-col justify-between" style="border:1px solid ' + borderColor + '">' +
			'<div><p class="font-semibold text-sm" style="color:#1c2434">' + etiqueta + "</p>" +
			'<p class="text-[11px]" style="color:#5b6473">' + sub + "</p></div>" +
			'<div class="mt-2">' + estadoHtml + "</div></button>"
		);
	}

	// ── Editor (modal) ─────────────────────────────────────────────────────────
	var modal = document.getElementById("modalProducto");
	var F = {
		driveFolder: document.getElementById("fDriveFolder"),
		precioPdf: document.getElementById("fPrecioPdf"),
		precioEditable: document.getElementById("fPrecioEditable"),
		descripcion: document.getElementById("fDescripcion"),
		activo: document.getElementById("fActivo"),
	};
	document.getElementById("modalCerrar").addEventListener("click", cerrarEditor);
	document.getElementById("modalCancelar").addEventListener("click", cerrarEditor);
	modal.addEventListener("click", function (e) { if (e.target === modal) { cerrarEditor(); } });
	document.getElementById("modalGuardar").addEventListener("click", guardarPaquete);

	function abrirEditor(org, llave, tipo, trimestre) {
		var esMulti = org === "multigrado";
		var comboInfo = esMulti ? COMBOS.find(function (c) { return c.combo === llave; }) : null;
		var grado = esMulti ? comboInfo.grado : parseInt(llave, 10);
		var fase = esMulti ? comboInfo.fase : faseDeGrado(grado);
		var combo = esMulti ? llave : null;
		var modalidad = esMulti ? comboInfo.modalidad : null;

		var prod = porClave[claveDe(org, llave, tipo, trimestre)] || null;
		edit = { org: org, llave: llave, grado: grado, fase: fase, combo: combo, modalidad: modalidad, tipo: tipo, trimestre: trimestre, productoId: prod ? prod.id : null };

		document.getElementById("modalTitulo").textContent = tituloPaquete(org, grado, combo, tipo, trimestre);
		document.getElementById("resumenPaquete").innerHTML =
			"<strong>" + esc(tituloPaquete(org, grado, combo, tipo, trimestre)) + "</strong><br>" +
			(tipo === "ciclo" ? "Incluye los 12 proyectos del ciclo (3 trimestres)." : "Incluye los 4 proyectos del trimestre.");
		document.getElementById("ayudaCarpeta").textContent = tipo === "ciclo"
			? "Carpeta del " + (esMulti ? "combo multigrado" : "GRADO") + " (contiene las 3 carpetas de trimestre)."
			: "Carpeta del TRIMESTRE (contiene las carpetas de proyecto).";

		var def = PRECIO[org][tipo];
		if (prod) {
			F.driveFolder.value = "";
			// La carpeta de Drive ya no viaja en el listado (no legible por el
			// cliente); se pide aparte con la RPC admin, que exige es_admin().
			window.sb.rpc("admin_producto_drive", { p_id: prod.id }).then(function (r) {
				if (!r.error && r.data && r.data[0]) {
					F.driveFolder.value = r.data[0].proyecto_folder_drive_id || "";
				}
			});
			F.precioPdf.value = prod.precio_pdf != null ? prod.precio_pdf : "";
			F.precioEditable.value = prod.precio_editable != null ? prod.precio_editable : "";
			F.descripcion.value = prod.descripcion || "";
			F.activo.checked = !!prod.activo;
		} else {
			F.driveFolder.value = "";
			F.precioPdf.value = def.pdf;
			F.precioEditable.value = def.editable;
			F.descripcion.value = "";
			F.activo.checked = false;
		}
		bloquearPrecioPaquete(prod);
		modal.classList.remove("hidden");
	}

	/**
	 * El precio de un paquete es una columna DERIVADA del tarifario:
	 * marketplace_aplicar_precios() lo reescribe tras cada venta y cada
	 * reembolso. Dejarlo editable sería mentir: se escribiría un número que
	 * vuelve solo días después. Se edita en la pestaña Precios.
	 *
	 * La excepción es real: esa función salta los paquetes `es_prueba`, así que
	 * ahí el precio individual sí manda y el campo se habilita.
	 */
	function bloquearPrecioPaquete(prod) {
		var esPrueba = !!(prod && prod.es_prueba);
		var aviso = document.getElementById("avisoPrecioPaquete");
		[F.precioPdf, F.precioEditable].forEach(function (input) {
			input.readOnly = !esPrueba;
			input.style.background = esPrueba ? "#fff" : "#f1f0ea";
			input.style.color = esPrueba ? "#1c2434" : "#5b6473";
		});
		if (!aviso) { return; }
		aviso.textContent = esPrueba
			? "Paquete de prueba: su precio no lo toca el tarifario, se edita aquí."
			: "Los precios salen del tarifario (pestaña Precios) y se reescriben con cada venta. Para cambiarlos, edítalos allí.";
		aviso.classList.remove("hidden");
	}

	function cerrarEditor() { modal.classList.add("hidden"); edit = null; }

	async function guardarPaquete() {
		if (!edit) { return; }
		var precioPdf = F.precioPdf.value === "" ? null : Number(F.precioPdf.value);
		if (precioPdf == null) { Tienda.toast("El precio PDF es obligatorio.", "error"); return; }
		if (F.activo.checked && !F.driveFolder.value.trim()) {
			Tienda.toast("Para publicar necesitas el ID de la carpeta de Drive.", "error");
			return;
		}

		var payload = {
			titulo: tituloPaquete(edit.org, edit.grado, edit.combo, edit.tipo, edit.trimestre),
			descripcion: F.descripcion.value.trim() || null,
			grado: edit.grado,
			fase: edit.fase,
			campo_formativo: null,
			trimestre: edit.tipo === "ciclo" ? null : edit.trimestre,
			tipo_paquete: edit.tipo,
			num_proyectos: edit.tipo === "ciclo" ? 12 : 4,
			organizacion: edit.org,
			grados_combo: edit.combo,
			modalidad: edit.modalidad,
			precio_pdf: precioPdf,
			precio_editable: F.precioEditable.value === "" ? null : Number(F.precioEditable.value),
			proyecto_folder_drive_id: F.driveFolder.value.trim() || null,
			activo: F.activo.checked,
			updated_at: new Date().toISOString(),
		};

		var btn = document.getElementById("modalGuardar");
		btn.disabled = true; btn.textContent = "Guardando...";

		var res = edit.productoId
			? await window.sb.from("marketplace_productos").update(payload).eq("id", edit.productoId)
			: await window.sb.from("marketplace_productos").insert(payload);

		btn.disabled = false; btn.textContent = "Guardar";
		if (res.error) { Tienda.toast("No se pudo guardar: " + res.error.message, "error"); return; }

		Tienda.toast("Paquete guardado.", "ok");
		cerrarEditor();
		await cargarProductos();
	}

	// ── Órdenes ─────────────────────────────────────────────────────────────
	var listaOrdenesEl = document.getElementById("listaOrdenes");

	async function cargarOrdenes() {
		listaOrdenesEl.innerHTML = '<p class="text-sm" style="color:#5b6473">Cargando órdenes...</p>';
		var res = await window.sb.rpc("admin_listar_ordenes");
		if (res.error) {
			listaOrdenesEl.innerHTML = '<p class="text-sm" style="color:#b91c1c">Error al cargar órdenes: ' + esc(res.error.message) + "</p>";
			return;
		}
		var ordenes = res.data || [];
		if (!ordenes.length) {
			listaOrdenesEl.innerHTML = '<p class="text-sm" style="color:#5b6473">Aún no hay órdenes.</p>';
			return;
		}
		var rows = ordenes.map(function (o) {
			var fecha = o.created_at ? new Date(o.created_at).toLocaleDateString("es-MX") : "";
			var accion = o.estado === "pendiente"
				? '<button data-confirmar="' + esc(o.id) + '" class="text-xs font-semibold px-3 py-2 rounded-lg min-h-[40px] text-white" style="background:#059669">Confirmar pago</button>'
				: "—";
			// monto_total es lo REALMENTE cobrado: si la orden se creó con la
			// promoción activa, aquí sale el importe con descuento. Correcto tal
			// cual; no aplicarle nada encima.
			return (
				'<tr style="border-bottom:1px solid #e7e6df">' +
				'<td class="py-2 pr-3 text-xs" style="color:#5b6473">' + esc(fecha) + "</td>" +
				'<td class="py-2 pr-3 text-sm" style="color:#1c2434">' + esc(o.comprador_email || o.user_id) + "</td>" +
				'<td class="py-2 pr-3 text-sm" style="color:#1c2434">' + esc(o.detalle || "—") + "</td>" +
				'<td class="py-2 pr-3 text-sm font-semibold" style="color:#1c2434">' + money(o.monto_total) + "</td>" +
				'<td class="py-2 pr-3 text-xs" style="color:#5b6473">' + esc(o.metodo_pago || "") + "</td>" +
				"<td class='py-2 pr-3'>" + badgeEstado(o.estado) + "</td>" +
				"<td class='py-2'>" + accion + "</td></tr>"
			);
		}).join("");
		listaOrdenesEl.innerHTML =
			'<table class="w-full text-left min-w-[760px]">' +
			'<thead><tr class="text-xs uppercase tracking-wide" style="color:#5b6473;border-bottom:1px solid #e7e6df">' +
			"<th class='py-2 pr-3 font-semibold'>Fecha</th><th class='py-2 pr-3 font-semibold'>Comprador</th>" +
			"<th class='py-2 pr-3 font-semibold'>Compra</th>" +
			"<th class='py-2 pr-3 font-semibold'>Monto</th><th class='py-2 pr-3 font-semibold'>Método</th>" +
			"<th class='py-2 pr-3 font-semibold'>Estado</th><th class='py-2 font-semibold'>Acción</th></tr></thead>" +
			"<tbody>" + rows + "</tbody></table>";
		listaOrdenesEl.querySelectorAll("[data-confirmar]").forEach(function (b) {
			b.addEventListener("click", function () { confirmarOrden(b); });
		});
	}

	async function confirmarOrden(b) {
		if (!confirm("¿Confirmar el pago de esta orden y otorgar acceso?")) { return; }
		b.disabled = true; b.textContent = "Confirmando...";
		var res = await window.sb.rpc("admin_confirmar_orden", { p_orden_id: b.getAttribute("data-confirmar") });
		if (res.error) {
			Tienda.toast("Error: " + res.error.message, "error");
			b.disabled = false; b.textContent = "Confirmar pago"; return;
		}
		Tienda.toast("Pago confirmado y acceso otorgado.", "ok");
		cargarOrdenes();
	}

	function badgeEstado(estado) {
		var styles = {
			pagado:      "color:#047a55;background:#ecfdf5;border:1px solid #a7f3d0",
			pendiente:   "color:#b45309;background:#fffbeb;border:1px solid #fcd34d",
			fallido:     "color:#b91c1c;background:#fef2f2;border:1px solid #fca5a5",
			reembolsado: "color:#5b6473;background:#f3f4f6;border:1px solid #e7e6df",
		};
		var style = styles[estado] || styles.reembolsado;
		return '<span class="text-xs font-semibold px-2 py-1 rounded-full" style="' + style + '">' + esc(estado) + "</span>";
	}

	// ── Acceso manual ──────────────────────────────────────────────────────────
	var accesoProductoSel = document.getElementById("accesoProducto");
	var otorgarBtn = document.getElementById("otorgarBtn");

	function poblarSelectProductos() {
		var opts = '<option value="">Selecciona un paquete</option>';
		productos.forEach(function (p) {
			opts += '<option value="' + esc(p.id) + '">' + esc(p.titulo) + "</option>";
		});
		accesoProductoSel.innerHTML = opts;
	}

	otorgarBtn.addEventListener("click", async function () {
		var email = (document.getElementById("accesoEmail").value || "").trim();
		var productoId = accesoProductoSel.value;
		var tipo = document.getElementById("accesoTipo").value;
		if (!email || !productoId) { Tienda.toast("Completa correo y paquete.", "error"); return; }
		otorgarBtn.disabled = true; otorgarBtn.textContent = "Otorgando...";
		var res = await window.sb.rpc("admin_otorgar_acceso", { p_email: email, p_producto_id: productoId, p_tipo: tipo });
		otorgarBtn.disabled = false; otorgarBtn.textContent = "Otorgar acceso";
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		Tienda.toast("Acceso otorgado a " + email, "ok");
		document.getElementById("accesoEmail").value = "";
	});

	// ── Precios, oferta general y cupones ─────────────────────────────────────
	// El escalón de lanzamiento (subir el precio con las ventas acumuladas) se
	// retiró en septiembre de 2026: nunca llegó a usarse y era la única vía por
	// la que un precio podía subir solo. Ahora los precios se escriben a mano
	// aquí, en el tarifario.
	//
	// Bidocente y tridocente comparten tarifa: el maestro no elige cuál le toca,
	// se lo dicta su escuela, así que el tarifario no los distingue. "Unitaria"
	// es el combo de todos los paquetes multigrado de una agrupación (no tiene
	// productos propios: lo arma crear-preferencia-mp).
	var MODALIDAD_ETIQUETA = {
		un_grado: "1 grado",
		multigrado: "Multigrado (bi y tridocente)",
		unitaria: "Unitario (combo 6 grados)",
	};

	var estadoPreciosTextoEl = document.getElementById("estadoPreciosTexto");
	var tablaTarifarioEl = document.getElementById("tablaTarifario");
	var guardarTarifarioBtn = document.getElementById("guardarTarifarioBtn");

	var promoActivaEl = document.getElementById("promoActiva");
	var promoPorcentajeEl = document.getElementById("promoPorcentaje");
	var promoDesdeEl = document.getElementById("promoDesde");
	var promoHastaEl = document.getElementById("promoHasta");
	var promoEtiquetaEl = document.getElementById("promoEtiqueta");
	var promoAplicaPaquetesEl = document.getElementById("promoAplicaPaquetes");
	var promoAplicaProyectosEl = document.getElementById("promoAplicaProyectos");
	var promoAplicaPersonalizadosEl = document.getElementById("promoAplicaPersonalizados");
	var promoPersonalizadosPreviewEl = document.getElementById("promoPersonalizadosPreview");
	var estadoPromoEl = document.getElementById("estadoPromo");
	var guardarPromoBtn = document.getElementById("guardarPromoBtn");

	var tablaCuponesEl = document.getElementById("tablaCupones");
	var tituloFormCuponEl = document.getElementById("tituloFormCupon");
	var cupCodigoEl = document.getElementById("cupCodigo");
	var cupTipoEl = document.getElementById("cupTipo");
	var cupValorEl = document.getElementById("cupValor");
	var cupValorEtiquetaEl = document.getElementById("cupValorEtiqueta");
	var cupHastaEl = document.getElementById("cupHasta");
	var cupMaxUsosEl = document.getElementById("cupMaxUsos");
	var cupUnoPorClienteEl = document.getElementById("cupUnoPorCliente");
	var cupActivoEl = document.getElementById("cupActivo");
	var cupDescripcionEl = document.getElementById("cupDescripcion");
	var guardarCuponBtn = document.getElementById("guardarCuponBtn");
	var cupCreadorNombreEl = document.getElementById("cupCreadorNombre");
	var cupCreadorContactoEl = document.getElementById("cupCreadorContacto");
	var cupComisionEl = document.getElementById("cupComision");
	var cupMaxComisionEl = document.getElementById("cupMaxComision");
	var cancelarCuponBtn = document.getElementById("cancelarCuponBtn");

	// Última respuesta de admin_estado_promocion(): la comparten la tabla de
	// precios, la tarjeta de oferta y la franja de estado, así que no pueden
	// contradecirse entre ellas.
	var estadoPrecios = null;
	var cupones = [];

	async function cargarPrecios() {
		var res = await Promise.all([
			window.sb.rpc("admin_estado_promocion"),
			window.sb.rpc("admin_listar_cupones"),
		]);
		if (res[0].error) {
			Tienda.toast("No se pudo cargar el estado de precios: " + res[0].error.message, "error");
			return;
		}
		estadoPrecios = res[0].data;
		renderTarifario(estadoPrecios);
		renderPromocion(estadoPrecios);

		if (res[1].error) {
			Tienda.toast("No se pudieron cargar los cupones: " + res[1].error.message, "error");
			cupones = [];
		} else {
			cupones = res[1].data || [];
		}
		renderCupones();
		renderEstadoPrecios();
	}

	// Una línea que responde "¿qué se le está cobrando ahora mismo a la gente?".
	function renderEstadoPrecios() {
		if (!estadoPreciosTextoEl || !estadoPrecios) { return; }
		var partes = [];
		if (estadoPrecios.vigente_ahora) {
			var hasta = estadoPrecios.vigente_hasta
				? new Date(estadoPrecios.vigente_hasta).toLocaleDateString("es-MX",
					{ day: "numeric", month: "long", timeZone: "America/Mexico_City" })
				: null;
			partes.push("Hoy se cobra con -" + estadoPrecios.porcentaje + "% " +
				(estadoPrecios.etiqueta || "") + (hasta ? " hasta el " + hasta : ""));
		} else {
			partes.push("Hoy se cobra el precio de lista, sin oferta general");
		}
		var activos = cupones.filter(function (c) { return c.vigente_ahora; }).length;
		partes.push(activos === 0 ? "sin cupones activos"
			: activos === 1 ? "1 cupón activo"
			: activos + " cupones activos");
		estadoPreciosTextoEl.textContent = partes.join(" · ");
	}

	// Tabla de precios de lista, editable. La última columna es de solo lectura:
	// es lo que el comprador va a pagar hoy con la oferta general puesta.
	function renderTarifario(d) {
		var filas = (d && d.previsualizacion) || [];
		tablaTarifarioEl.innerHTML = filas.map(function (t) {
			var clave = t.modalidad_precio + "|" + t.tipo_paquete;
			// promo_pdf ya respeta el ámbito (lista si el renglón está excluido).
			var hayOferta = d.vigente_ahora && t.aplica !== false && Number(t.promo_pdf) < Number(t.lista_pdf);
			return '<tr class="border-b border-line" data-tarifa="' + esc(clave) + '">' +
				'<td class="py-2 pr-3">' + esc(MODALIDAD_ETIQUETA[t.modalidad_precio] || t.modalidad_precio) + "</td>" +
				'<td class="py-2 pr-3">' + (t.tipo_paquete === "ciclo" ? "Ciclo completo" : t.tipo_paquete === "proyecto" ? 'Proyecto individual <span class="text-xs text-mute">(extra = anexos)</span>' : "Trimestre") + "</td>" +
				'<td class="py-2 pr-3 text-right"><input type="number" min="10" step="1" inputmode="numeric" data-campo="base" value="' +
					esc(Number(t.lista_pdf)) + '" class="w-24 h-10 rounded-lg border border-line px-2 text-right text-ink" style="background:#fff"></td>' +
				'<td class="py-2 pr-3 text-right"><input type="number" min="0" step="1" inputmode="numeric" data-campo="addon" value="' +
					esc(Number(t.addon)) + '" class="w-24 h-10 rounded-lg border border-line px-2 text-right text-ink" style="background:#fff"></td>' +
				'<td class="py-2 pr-3 text-right font-semibold text-ink">' + money(t.lista_editable) + "</td>" +
				// En rojo cuando hay descuento: mismo color que ve el comprador.
				'<td class="py-2 pr-3 text-right ' + (hayOferta ? "font-bold" : "text-mute") + '" style="' +
					(hayOferta ? "color:" + Tienda.COLOR_DESCUENTO.texto : "") + '">' +
					money(t.promo_pdf) + '<span class="text-mute font-normal"> / ' + money(t.promo_editable) + "</span></td>" +
				"</tr>";
		}).join("");
	}

	guardarTarifarioBtn.addEventListener("click", async function () {
		var tarifas = [];
		var error = null;
		tablaTarifarioEl.querySelectorAll("[data-tarifa]").forEach(function (tr) {
			var partes = tr.getAttribute("data-tarifa").split("|");
			var base = Number(tr.querySelector('[data-campo="base"]').value);
			var addon = Number(tr.querySelector('[data-campo="addon"]').value);
			if (!isFinite(base) || !isFinite(addon) || base < 10 || addon < 0) {
				error = "Revisa los precios: el PDF va de 10 en adelante y el extra de Word no puede ser negativo.";
				return;
			}
			if (base !== Math.floor(base) || addon !== Math.floor(addon)) {
				error = "Los precios van en pesos completos, sin centavos.";
				return;
			}
			tarifas.push({
				modalidad_precio: partes[0],
				tipo_paquete: partes[1],
				precio_base: base,
				precio_addon_editable: addon,
			});
		});
		if (error) { Tienda.toast(error, "error"); return; }
		if (tarifas.length !== 8) {
			Tienda.toast("Falta algún renglón del tarifario. Recarga la página.", "error");
			return;
		}

		guardarTarifarioBtn.disabled = true;
		guardarTarifarioBtn.textContent = "Guardando...";
		var res = await window.sb.rpc("admin_guardar_tarifario", { p_tarifas: tarifas });
		guardarTarifarioBtn.disabled = false;
		guardarTarifarioBtn.textContent = "Guardar precios";

		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		estadoPrecios = res.data;
		renderTarifario(estadoPrecios);
		renderPromocion(estadoPrecios);
		renderEstadoPrecios();
		Tienda.toast("Precios guardados y aplicados a " +
			(res.data.productos_actualizados || 0) + " productos.", "ok");
		// El grid de la pestaña Paquetes muestra precios: sin esto se queda viejo.
		await cargarProductos();
	});

	// El <input type="datetime-local"> trabaja en hora local del navegador; la
	// base guarda timestamptz. Estas dos funciones son la conversión.
	function aInputLocal(iso) {
		if (!iso) { return ""; }
		var d = new Date(iso);
		if (isNaN(d.getTime())) { return ""; }
		var p = function (n) { return String(n).padStart(2, "0"); };
		return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
			"T" + p(d.getHours()) + ":" + p(d.getMinutes());
	}
	function aISO(valor) {
		if (!valor) { return null; }
		var d = new Date(valor);
		return isNaN(d.getTime()) ? null : d.toISOString();
	}

	function renderPromocion(d) {
		promoActivaEl.checked = !!d.activa;
		promoPorcentajeEl.value = d.porcentaje != null ? String(d.porcentaje) : "20";
		promoDesdeEl.value = aInputLocal(d.vigente_desde);
		promoHastaEl.value = aInputLocal(d.vigente_hasta);
		promoEtiquetaEl.value = d.etiqueta || "";
		promoAplicaPaquetesEl.checked = d.aplica_paquetes !== false;
		promoAplicaProyectosEl.checked = d.aplica_proyectos !== false;
		promoAplicaPersonalizadosEl.checked = d.aplica_personalizados === true;
		var pp = d.previsualizacion_personalizados;
		if (pp) {
			promoPersonalizadosPreviewEl.textContent = "Un proyecto personalizado se cobra hoy: " + money(pp.promo_sin_anexos) + " sin anexos / " + money(pp.promo_con_anexos) + " con anexos" +
				(pp.aplica ? "" : " (precio de lista: el descuento no aplica a los pedidos)") + ".";
		}

		// "Activa" marcada no basta: puede estar programada para más adelante o
		// ya vencida. Lo que manda es lo que ve el comprador.
		var ahora = Date.now();
		var texto;
		if (d.vigente_ahora) {
			var hasta = d.vigente_hasta
				? new Date(d.vigente_hasta).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })
				: null;
			var donde = [];
			if (d.aplica_paquetes !== false) { donde.push("paquetes"); }
			if (d.aplica_proyectos !== false) { donde.push("proyectos individuales"); }
			if (d.aplica_personalizados === true) { donde.push("personalizados"); }
			texto = "Vigente ahora · -" + d.porcentaje + "%" +
				(hasta ? " · termina el " + hasta + " (hora del centro)" : " · sin fecha límite") +
				" · aplica a: " + (donde.length ? donde.join(", ") : "nada (revisa los interruptores)");
		} else if (!d.activa) {
			texto = "Apagada. Los precios que se muestran y se cobran son los de lista.";
		} else if (d.vigente_desde && new Date(d.vigente_desde).getTime() > ahora) {
			texto = "Programada: empieza el " +
				new Date(d.vigente_desde).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
		} else {
			texto = "Venció el " +
				new Date(d.vigente_hasta).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) +
				". Los precios ya volvieron a los de lista solos.";
		}
		estadoPromoEl.textContent = texto;
		// Los precios resultantes no se pintan aquí: viven en la columna "Se
		// cobra hoy" de la tabla de precios, para no tener dos tablas que
		// puedan contradecirse.
	}

	guardarPromoBtn.addEventListener("click", async function () {
		var pct = Number((promoPorcentajeEl.value || "").trim());
		if (!isFinite(pct) || pct < 1 || pct > 90) {
			Tienda.toast("El porcentaje debe estar entre 1 y 90.", "error");
			return;
		}
		var desde = aISO(promoDesdeEl.value);
		var hasta = aISO(promoHastaEl.value);
		if (desde && hasta && new Date(hasta) <= new Date(desde)) {
			Tienda.toast("La fecha de fin debe ser posterior a la de inicio.", "error");
			return;
		}

		guardarPromoBtn.disabled = true;
		guardarPromoBtn.textContent = "Guardando...";
		var res = await window.sb.rpc("admin_guardar_promocion", {
			p_activa: promoActivaEl.checked,
			p_porcentaje: pct,
			p_vigente_hasta: hasta,
			p_vigente_desde: desde,
			p_etiqueta: (promoEtiquetaEl.value || "").trim() || null,
			p_aplica_paquetes: promoAplicaPaquetesEl.checked,
			p_aplica_proyectos: promoAplicaProyectosEl.checked,
			p_aplica_personalizados: promoAplicaPersonalizadosEl.checked,
		});
		guardarPromoBtn.disabled = false;
		guardarPromoBtn.textContent = "Guardar promoción";

		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		// No hace falta recargar los paquetes: la promoción no toca sus precios
		// de lista, solo lo que se muestra y se cobra.
		estadoPrecios = res.data;
		renderPromocion(estadoPrecios);
		renderTarifario(estadoPrecios);
		renderEstadoPrecios();
		Tienda.toast("Promoción guardada.", "ok");
	});

	// ── Cupones ───────────────────────────────────────────────────────────────

	function etiquetaDescuento(c) {
		return c.tipo === "porcentaje"
			? "-" + Number(c.valor) + "%"
			: "-" + money(c.valor);
	}

	function renderCupones() {
		if (!cupones.length) {
			tablaCuponesEl.innerHTML =
				'<tr><td colspan="7" class="py-4 text-sm text-mute">Todavía no hay cupones. Crea el primero abajo.</td></tr>';
			return;
		}
		tablaCuponesEl.innerHTML = cupones.map(function (c) {
			var estado, color;
			if (!c.activo) { estado = "Apagado"; color = "#9ba3af"; }
			else if (c.vencido) { estado = "Vencido"; color = "#b45309"; }
			else if (c.agotado_comision) { estado = "Agotado (tope de comisión)"; color = "#b45309"; }
			else if (c.agotado) { estado = "Agotado"; color = "#b45309"; }
			else { estado = "Activo"; color = "#047857"; }

			// Si se pasó del máximo (dos compras simultáneas), se ve en rojo.
			var excedido = c.max_usos != null && c.usos > c.max_usos;
			var usos = c.usos + (c.max_usos != null ? " / " + c.max_usos : "");
			var hasta = c.vigente_hasta
				? new Date(c.vigente_hasta).toLocaleDateString("es-MX",
					{ day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" })
				: "Sin caducidad";

			return '<tr class="border-b border-line">' +
				'<td class="py-2 pr-3"><span class="font-bold text-ink">' + esc(c.codigo) + "</span>" +
					(c.descripcion ? '<br><span class="text-xs text-mute">' + esc(c.descripcion) + "</span>" : "") +
					(c.uno_por_cliente ? '<br><span class="text-xs text-mute">Uno por cliente</span>' : "") + "</td>" +
				'<td class="py-2 pr-3 font-bold" style="color:' + Tienda.COLOR_DESCUENTO.texto + '">' +
					esc(etiquetaDescuento(c)) + "</td>" +
				'<td class="py-2 pr-3">' + (c.creador_nombre || c.comision_porcentaje != null
					? '<span class="font-semibold text-ink">' + esc(c.creador_nombre || "Sin nombre") + "</span>" +
						(c.comision_porcentaje != null ? '<br><span class="text-xs text-mute">Comisión ' + esc(Number(c.comision_porcentaje)) + "%" +
							(Number(c.pendiente) > 0 ? ' · <span class="font-semibold" style="color:#b45309">pendiente ' + esc(money(c.pendiente)) + "</span>" : " · al corriente") + "</span>" : "") +
						// Tope por monto: acumulado / tope, en rojo si ya se alcanzó.
						(c.max_comision != null ? '<br><span class="text-xs' + (c.agotado_comision ? ' font-bold" style="color:#b91c1c"' : ' text-mute"') + '>Generado ' + esc(money(c.comision_generada)) + " de " + esc(money(c.max_comision)) + " de tope</span>" : "") +
						'<br><button type="button" data-cupon-cuentas="' + esc(c.codigo) + '" class="text-sm font-semibold underline" style="color:#1e3a8a">Cuentas</button>'
					: '<span class="text-xs text-mute">Propio</span><br><button type="button" data-cupon-cuentas="' + esc(c.codigo) + '" class="text-xs font-semibold underline text-mute">Ver usos</button>') + "</td>" +
				'<td class="py-2 pr-3' + (excedido ? ' font-bold" style="color:#b91c1c"' : '"') + ">" + esc(usos) +
					(c.referidos ? '<br><span class="text-xs text-mute">+' + esc(c.referidos) + " referida" + (c.referidos === 1 ? "" : "s") + "</span>" : "") +
					(c.reembolsos ? '<br><span class="text-xs" style="color:#b91c1c">' + esc(c.reembolsos) + " reembolso" + (c.reembolsos === 1 ? "" : "s") + "</span>" : "") + "</td>" +
				'<td class="py-2 pr-3 text-mute">' + esc(hasta) + "</td>" +
				'<td class="py-2 pr-3 font-semibold" style="color:' + color + '">' + esc(estado) + "</td>" +
				'<td class="py-2 text-right whitespace-nowrap">' +
					'<button type="button" data-cupon-editar="' + esc(c.codigo) + '" class="text-sm font-semibold underline" style="color:#1e3a8a">Editar</button>' +
					'<button type="button" data-cupon-toggle="' + esc(c.codigo) + '" class="ml-3 text-sm font-semibold underline text-mute">' +
						(c.activo ? "Apagar" : "Encender") + "</button>" +
					(c.usos === 0
						? '<button type="button" data-cupon-borrar="' + esc(c.codigo) + '" class="ml-3 text-sm font-semibold underline" style="color:#b91c1c">Borrar</button>'
						: "") +
				"</td></tr>";
		}).join("");

		tablaCuponesEl.querySelectorAll("[data-cupon-cuentas]").forEach(function (b) {
			b.addEventListener("click", function () { abrirCuentas(b.getAttribute("data-cupon-cuentas")); });
		});
		tablaCuponesEl.querySelectorAll("[data-cupon-editar]").forEach(function (b) {
			b.addEventListener("click", function () {
				llenarFormCupon(b.getAttribute("data-cupon-editar"));
			});
		});
		tablaCuponesEl.querySelectorAll("[data-cupon-toggle]").forEach(function (b) {
			b.addEventListener("click", function () {
				var c = cupones.find(function (x) { return x.codigo === b.getAttribute("data-cupon-toggle"); });
				if (c) { guardarCupon(Object.assign({}, c, { activo: !c.activo }), true); }
			});
		});
		tablaCuponesEl.querySelectorAll("[data-cupon-borrar]").forEach(function (b) {
			b.addEventListener("click", async function () {
				var codigo = b.getAttribute("data-cupon-borrar");
				if (!confirm("¿Borrar el cupón " + codigo + "? Nunca se ha usado, así que no se pierde ningún historial.")) { return; }
				var res = await window.sb.rpc("admin_borrar_cupon", { p_codigo: codigo });
				if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
				cupones = res.data || [];
				renderCupones();
				renderEstadoPrecios();
				Tienda.toast("Cupón borrado.", "ok");
			});
		});
	}

	// "Descuento (%)" o "Descuento (MXN)", según el tipo elegido.
	function sincronizarEtiquetaValor() {
		cupValorEtiquetaEl.textContent = cupTipoEl.value === "monto"
			? "Descuento (MXN)" : "Descuento (%)";
		cupValorEl.max = cupTipoEl.value === "monto" ? "" : "90";
	}
	cupTipoEl.addEventListener("change", sincronizarEtiquetaValor);

	// Comodidad al teclear; la garantía de formato está en la base.
	cupCodigoEl.addEventListener("input", function () {
		cupCodigoEl.value = cupCodigoEl.value.toUpperCase().replace(/\s+/g, "");
	});

	function limpiarFormCupon() {
		tituloFormCuponEl.textContent = "Crear un cupón";
		cupCodigoEl.value = "";
		cupCodigoEl.readOnly = false;
		cupTipoEl.value = "porcentaje";
		cupValorEl.value = "";
		cupHastaEl.value = "";
		cupMaxUsosEl.value = "";
		cupUnoPorClienteEl.checked = true;
		cupActivoEl.checked = true;
		cupDescripcionEl.value = "";
		cupCreadorNombreEl.value = "";
		cupCreadorContactoEl.value = "";
		cupComisionEl.value = "";
		cupMaxComisionEl.value = "";
		cancelarCuponBtn.classList.add("hidden");
		sincronizarEtiquetaValor();
	}

	function llenarFormCupon(codigo) {
		var c = cupones.find(function (x) { return x.codigo === codigo; });
		if (!c) { return; }
		// El código es la clave: al editar no se cambia, se crea otro.
		tituloFormCuponEl.textContent = "Editando " + c.codigo;
		cupCodigoEl.value = c.codigo;
		cupCodigoEl.readOnly = true;
		cupTipoEl.value = c.tipo;
		cupValorEl.value = String(Number(c.valor));
		cupHastaEl.value = aInputLocal(c.vigente_hasta);
		cupMaxUsosEl.value = c.max_usos != null ? String(c.max_usos) : "";
		cupUnoPorClienteEl.checked = !!c.uno_por_cliente;
		cupActivoEl.checked = !!c.activo;
		cupDescripcionEl.value = c.descripcion || "";
		cupCreadorNombreEl.value = c.creador_nombre || "";
		cupCreadorContactoEl.value = c.creador_contacto || "";
		cupComisionEl.value = c.comision_porcentaje != null ? String(Number(c.comision_porcentaje)) : "";
		cupMaxComisionEl.value = c.max_comision != null ? String(Number(c.max_comision)) : "";
		cancelarCuponBtn.classList.remove("hidden");
		sincronizarEtiquetaValor();
		tituloFormCuponEl.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	cancelarCuponBtn.addEventListener("click", limpiarFormCupon);

	/**
	 * Guarda un cupón. `silencioso` lo usa el botón de encender/apagar de la
	 * tabla, que no debe tocar ni vaciar el formulario de abajo.
	 */
	async function guardarCupon(c, silencioso) {
		var res = await window.sb.rpc("admin_guardar_cupon", {
			p_codigo: c.codigo,
			p_tipo: c.tipo,
			p_valor: c.valor,
			p_activo: c.activo,
			p_vigente_hasta: c.vigente_hasta || null,
			p_max_usos: c.max_usos != null ? c.max_usos : null,
			p_uno_por_cliente: c.uno_por_cliente,
			p_descripcion: c.descripcion || null,
			p_creador_nombre: c.creador_nombre || null,
			p_creador_contacto: c.creador_contacto || null,
			p_comision_porcentaje: c.comision_porcentaje != null ? c.comision_porcentaje : null,
			p_max_comision: c.max_comision != null ? c.max_comision : null,
		});
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return false; }
		cupones = res.data || [];
		renderCupones();
		renderEstadoPrecios();
		if (!silencioso) { limpiarFormCupon(); }
		Tienda.toast("Cupón " + c.codigo + " guardado.", "ok");
		return true;
	}

	guardarCuponBtn.addEventListener("click", async function () {
		var codigo = (cupCodigoEl.value || "").trim().toUpperCase();
		if (!/^[A-Z0-9][A-Z0-9._-]{2,23}$/.test(codigo)) {
			Tienda.toast("El código debe tener de 3 a 24 caracteres: letras, números, punto o guion. Sin espacios ni acentos.", "error");
			return;
		}
		var tipo = cupTipoEl.value;
		var valor = Number((cupValorEl.value || "").trim());
		if (!isFinite(valor) || valor <= 0 || valor !== Math.floor(valor)) {
			Tienda.toast("El descuento debe ser un número entero mayor que cero.", "error");
			return;
		}
		if (tipo === "porcentaje" && valor > 90) {
			Tienda.toast("El porcentaje no puede pasar de 90.", "error");
			return;
		}
		var maxTxt = (cupMaxUsosEl.value || "").trim();
		var maxUsos = maxTxt === "" ? null : Number(maxTxt);
		if (maxUsos != null && (!isFinite(maxUsos) || maxUsos < 1)) {
			Tienda.toast("El máximo de usos debe ser 1 o más, o dejarse vacío.", "error");
			return;
		}

		var comTxt = (cupComisionEl.value || "").trim();
		var comision = comTxt === "" ? null : Number(comTxt);
		if (comision != null && (!isFinite(comision) || comision < 0 || comision > 100)) {
			Tienda.toast("La comisión debe estar entre 0 y 100, o dejarse vacía.", "error");
			return;
		}
		var topeTxt = (cupMaxComisionEl.value || "").trim();
		var maxComision = topeTxt === "" ? null : Number(topeTxt);
		if (maxComision != null && (!isFinite(maxComision) || maxComision <= 0)) {
			Tienda.toast("El tope de comisión debe ser mayor que cero, o dejarse vacío.", "error");
			return;
		}
		if (maxComision != null && !(comision > 0)) {
			Tienda.toast("Para poner un tope de comisión primero define el porcentaje de comisión del creador.", "error");
			return;
		}

		guardarCuponBtn.disabled = true;
		guardarCuponBtn.textContent = "Guardando...";
		await guardarCupon({
			codigo: codigo,
			tipo: tipo,
			valor: valor,
			activo: cupActivoEl.checked,
			vigente_hasta: aISO(cupHastaEl.value),
			max_usos: maxUsos,
			uno_por_cliente: cupUnoPorClienteEl.checked,
			descripcion: (cupDescripcionEl.value || "").trim() || null,
			creador_nombre: (cupCreadorNombreEl.value || "").trim() || null,
			creador_contacto: (cupCreadorContactoEl.value || "").trim() || null,
			comision_porcentaje: comision,
			max_comision: maxComision,
		});
		guardarCuponBtn.disabled = false;
		guardarCuponBtn.textContent = "Guardar cupón";
	});

	// ── Estado de cuenta de un cupón (creadores de contenido) ────────────────
	// Todo lo numérico lo calcula admin_estado_cuenta_cupon(); aquí solo se
	// pinta y se exporta. El periodo se manda como [desde 00:00, hasta+1 00:00)
	// en hora local del admin (Ciudad de México).
	var cuentasEl = document.getElementById("cuentasCupon");
	var cuentasDesdeEl = document.getElementById("cuentasDesde");
	var cuentasHastaEl = document.getElementById("cuentasHasta");
	var cuentasCodigo = null;
	var cuentasDatos = null;

	function fechaLocalISO(d) {
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function fechaCorta(iso) {
		if (!iso) { return ""; }
		return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
	}
	function ponerMes(desplazamiento) {
		var hoy = new Date();
		var ini = new Date(hoy.getFullYear(), hoy.getMonth() + desplazamiento, 1);
		var fin = new Date(hoy.getFullYear(), hoy.getMonth() + desplazamiento + 1, 0);
		cuentasDesdeEl.value = fechaLocalISO(ini);
		cuentasHastaEl.value = fechaLocalISO(fin);
	}

	function abrirCuentas(codigo) {
		cuentasCodigo = codigo;
		ponerMes(0);
		cuentasEl.classList.remove("hidden");
		cargarCuentas();
		cuentasEl.scrollIntoView({ behavior: "smooth", block: "start" });
	}
	document.getElementById("cuentasCerrar").addEventListener("click", function () { cuentasEl.classList.add("hidden"); cuentasCodigo = null; });
	document.getElementById("cuentasActualizar").addEventListener("click", cargarCuentas);
	document.getElementById("cuentasMesActual").addEventListener("click", function () { ponerMes(0); cargarCuentas(); });
	document.getElementById("cuentasMesAnterior").addEventListener("click", function () { ponerMes(-1); cargarCuentas(); });
	document.getElementById("cuentasTodo").addEventListener("click", function () { cuentasDesdeEl.value = ""; cuentasHastaEl.value = ""; cargarCuentas(); });

	async function cargarCuentas() {
		if (!cuentasCodigo) { return; }
		var desde = cuentasDesdeEl.value ? new Date(cuentasDesdeEl.value + "T00:00:00") : null;
		var hasta = cuentasHastaEl.value ? new Date(cuentasHastaEl.value + "T00:00:00") : null;
		if (hasta) { hasta.setDate(hasta.getDate() + 1); }
		if (desde && hasta && hasta <= desde) { Tienda.toast("La fecha final debe ser igual o posterior a la inicial.", "error"); return; }
		var res = await window.sb.rpc("admin_estado_cuenta_cupon", {
			p_codigo: cuentasCodigo,
			p_desde: desde ? desde.toISOString() : null,
			p_hasta: hasta ? hasta.toISOString() : null,
		});
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		cuentasDatos = res.data;
		renderCuentas(res.data);
	}

	function renderCuentas(d) {
		var c = d.cupon, t = d.totales_periodo, h = d.historico;
		var conComision = c.comision_porcentaje != null;
		document.getElementById("cuentasTitulo").textContent = "Cuentas del cupón " + c.codigo +
			(c.creador_nombre ? " · " + c.creador_nombre : "");
		document.getElementById("cuentasSub").textContent =
			(conComision ? "Comisión del " + Number(c.comision_porcentaje) + "% sobre lo cobrado" : "Sin comisión configurada") +
			(c.creador_contacto ? " · " + c.creador_contacto : "") +
			" · periodo: " + (cuentasDesdeEl.value ? fechaCorta(cuentasDesdeEl.value + "T12:00:00") : "inicio") + " a " +
			(cuentasHastaEl.value ? fechaCorta(cuentasHastaEl.value + "T12:00:00") : "hoy");

		function tarjeta(titulo, valor, sub, color) {
			return '<div class="rounded-xl p-3" style="background:#fff;border:1px solid #e7e6df"><p class="text-[11px] font-bold uppercase tracking-[0.08em] text-mute">' + esc(titulo) + '</p>' +
				'<p class="mt-1 text-xl font-black" style="color:' + (color || "#1c2434") + '">' + esc(valor) + "</p>" +
				(sub ? '<p class="text-xs text-mute">' + esc(sub) + "</p>" : "") + "</div>";
		}
		document.getElementById("cuentasResumen").innerHTML =
			tarjeta("Ventas del periodo", String(t.ventas), money(t.monto_vendido) + " cobrados") +
			tarjeta("Descuento otorgado", money(t.descuento_otorgado), "lo que ahorraron los compradores") +
			tarjeta("Reembolsos", String(t.reembolsos), t.reembolsos ? "-" + money(t.monto_reembolsado) : "ninguno", t.reembolsos ? "#b91c1c" : null) +
			tarjeta("Comisión neta del periodo", money(t.comision_neta), t.referidos ? "+ " + t.referidos + " referida" + (t.referidos === 1 ? "" : "s") + " sin comisión (" + money(t.monto_referidos) + ")" : "", "#047857");

		var movs = d.movimientos || [];
		var etiquetas = { venta: ["Venta", "#047857"], reembolso: ["Reembolso", "#b91c1c"], referido: ["Referida (sin descuento del cupón)", "#5b6473"] };
		document.getElementById("cuentasMovs").innerHTML = movs.length ? movs.map(function (m) {
			var e = etiquetas[m.tipo] || [m.tipo, "#5b6473"];
			return '<tr class="border-b border-line">' +
				'<td class="py-2 px-3 whitespace-nowrap">' + esc(fechaCorta(m.fecha)) + "</td>" +
				'<td class="py-2 px-3 font-semibold whitespace-nowrap" style="color:' + e[1] + '">' + esc(e[0]) + "</td>" +
				'<td class="py-2 px-3 whitespace-nowrap">' + esc(m.comprador || "") + "</td>" +
				'<td class="py-2 px-3">' + esc(m.detalle || "") + '<br><span class="text-[11px] text-mute">Orden ' + esc(String(m.orden_id).slice(0, 8)) + "</span></td>" +
				'<td class="py-2 px-3 text-right text-mute">' + esc(money(m.precio_lista)) + "</td>" +
				'<td class="py-2 px-3 text-right text-mute">' + esc(money(m.descuento)) + "</td>" +
				'<td class="py-2 px-3 text-right font-semibold">' + esc(money(m.monto)) + "</td>" +
				'<td class="py-2 px-3 text-right font-bold" style="color:' + (Number(m.comision) < 0 ? "#b91c1c" : "#047857") + '">' + esc(money(m.comision)) + "</td>" +
				"</tr>";
		}).join("") : '<tr><td colspan="8" class="py-4 px-3 text-sm text-mute">Sin movimientos en este periodo.</td></tr>';

		var cupLista = cupones.find(function (x) { return x.codigo === c.codigo; }) || {};
		var tope = cupLista.max_comision != null ? Number(cupLista.max_comision) : null;
		document.getElementById("cuentasSaldo").innerHTML =
			"<div>Ventas pagadas con el cupón: <strong>" + esc(h.ventas_pagadas) + "</strong> · " + esc(money(h.monto_vendido)) + " cobrados</div>" +
			"<div>Comisión generada: <strong>" + esc(money(h.comision_generada)) + "</strong>" +
				(tope != null ? " de un tope de " + esc(money(tope)) + (Number(h.comision_generada) >= tope
					? ' · <span class="font-semibold" style="color:#b91c1c">tope alcanzado, el cupón ya no se acepta</span>'
					: " · restan " + esc(money(tope - Number(h.comision_generada)))) : "") + "</div>" +
			"<div>Ya pagado al creador: <strong>" + esc(money(h.liquidado)) + "</strong></div>" +
			'<div class="text-base">Pendiente por pagar: <strong style="color:' + (Number(h.pendiente) > 0 ? "#b45309" : "#047857") + '">' + esc(money(h.pendiente)) + "</strong></div>";

		var liqMonto = document.getElementById("liqMonto");
		if (!liqMonto.value || Number(liqMonto.value) <= 0) { liqMonto.value = Number(h.pendiente) > 0 ? String(Number(h.pendiente).toFixed(2)) : ""; }
		if (!document.getElementById("liqFecha").value) { document.getElementById("liqFecha").value = fechaLocalISO(new Date()); }

		var liqs = d.liquidaciones || [];
		document.getElementById("cuentasLiquidaciones").innerHTML = liqs.length
			? '<p class="text-[11px] font-bold uppercase tracking-[0.08em] text-mute mt-2">Pagos registrados</p>' + liqs.map(function (l) {
				return '<div class="flex items-center justify-between gap-3 border-b border-line py-1.5"><span>' + esc(fechaCorta(l.fecha_pago + "T12:00:00")) + " · <strong>" + esc(money(l.monto)) + "</strong>" +
					(l.notas ? ' <span class="text-mute">· ' + esc(l.notas) + "</span>" : "") + "</span>" +
					'<button type="button" data-liq-borrar="' + esc(l.id) + '" class="text-xs font-semibold underline" style="color:#b91c1c">Quitar</button></div>';
			}).join("")
			: '<p class="text-xs text-mute">Todavía no has registrado pagos a este creador.</p>';
		document.querySelectorAll("[data-liq-borrar]").forEach(function (b) {
			b.addEventListener("click", async function () {
				if (!confirm("¿Quitar este pago registrado? El saldo pendiente volverá a subir.")) { return; }
				var res = await window.sb.rpc("admin_borrar_liquidacion", { p_id: b.getAttribute("data-liq-borrar") });
				if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
				cuentasDatos = res.data;
				renderCuentas(res.data);
				await recargarCupones();
			});
		});
		Tienda.iconos();
	}

	async function recargarCupones() {
		var r = await window.sb.rpc("admin_listar_cupones");
		if (!r.error) { cupones = r.data || []; renderCupones(); renderEstadoPrecios(); }
	}

	document.getElementById("liqRegistrar").addEventListener("click", async function () {
		if (!cuentasCodigo) { return; }
		var monto = Number(document.getElementById("liqMonto").value);
		if (!isFinite(monto) || monto <= 0) { Tienda.toast("Escribe el monto que pagaste.", "error"); return; }
		var btn = this;
		btn.disabled = true;
		var res = await window.sb.rpc("admin_registrar_liquidacion", {
			p_codigo: cuentasCodigo,
			p_monto: monto,
			p_fecha_pago: document.getElementById("liqFecha").value || null,
			p_periodo_desde: cuentasDesdeEl.value || null,
			p_periodo_hasta: cuentasHastaEl.value || null,
			p_notas: (document.getElementById("liqNotas").value || "").trim() || null,
		});
		btn.disabled = false;
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		document.getElementById("liqMonto").value = "";
		document.getElementById("liqNotas").value = "";
		cuentasDatos = res.data;
		renderCuentas(res.data);
		await recargarCupones();
		Tienda.toast("Pago registrado.", "ok");
	});

	// CSV para el creador: los mismos movimientos y totales que se ven, con
	// el correo enmascarado. BOM al inicio para que Excel lo abra con acentos.
	document.getElementById("cuentasCsv").addEventListener("click", function () {
		if (!cuentasDatos) { return; }
		var d = cuentasDatos, c = d.cupon, t = d.totales_periodo, h = d.historico;
		function celda(v) { var s = String(v == null ? "" : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
		var filas = [];
		filas.push(["Cupón", c.codigo, "Creador", c.creador_nombre || "", "Comisión %", c.comision_porcentaje != null ? Number(c.comision_porcentaje) : ""]);
		filas.push(["Periodo", cuentasDesdeEl.value || "inicio", "a", cuentasHastaEl.value || "hoy"]);
		filas.push([]);
		filas.push(["Fecha", "Movimiento", "Comprador", "Compra", "Orden", "Precio de lista", "Descuento", "Cobrado", "Comisión"]);
		var nombres = { venta: "Venta", reembolso: "Reembolso", referido: "Referida (sin descuento del cupón)" };
		(d.movimientos || []).forEach(function (m) {
			filas.push([fechaCorta(m.fecha), nombres[m.tipo] || m.tipo, m.comprador || "", m.detalle || "", String(m.orden_id).slice(0, 8),
				Number(m.precio_lista).toFixed(2), Number(m.descuento).toFixed(2), Number(m.monto).toFixed(2), Number(m.comision).toFixed(2)]);
		});
		filas.push([]);
		filas.push(["Ventas del periodo", t.ventas, "Cobrado", Number(t.monto_vendido).toFixed(2), "Descuento otorgado", Number(t.descuento_otorgado).toFixed(2)]);
		filas.push(["Reembolsos", t.reembolsos, "Monto reembolsado", Number(t.monto_reembolsado).toFixed(2)]);
		filas.push(["Comisión neta del periodo", Number(t.comision_neta).toFixed(2)]);
		filas.push(["Referidas sin comisión", t.referidos, "Monto", Number(t.monto_referidos).toFixed(2)]);
		filas.push([]);
		filas.push(["Histórico: comisión generada", Number(h.comision_generada).toFixed(2), "Pagado al creador", Number(h.liquidado).toFixed(2), "Pendiente", Number(h.pendiente).toFixed(2)]);
		var csv = "\ufeff" + filas.map(function (f) { return f.map(celda).join(","); }).join("\r\n");
		var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		var a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "cuentas-" + c.codigo + "-" + (cuentasDesdeEl.value || "inicio") + "-a-" + (cuentasHastaEl.value || "hoy") + ".csv";
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
	});

	// ── Proyectos individuales ──────────────────────────────────────────────────────
	// Un proyecto individual es una fila de marketplace_productos con
	// tipo_paquete = 'proyecto' y la carpeta P0N del proyecto en Drive. Se crean
	// en lote a partir de un paquete trimestral: la Edge Function
	// admin-proyectos-drive lee las carpetas, las empareja con
	// dosificacion_proyectos y dice qué contiene cada una. Aquí solo se elige
	// y se inserta.
	// Precio de arranque de un suelto nuevo. Lo definitivo lo pone el tarifario
	// (marketplace_aplicar_precios lo reescribe al guardar precios); aquí solo se
	// siembra con el renglón 'proyecto' si ya está cargado, o con el valor base.
	var PRECIO_SUELTO = { sin_anexos: 80, con_anexos: 120 };
	function precioSuelto(org) {
		var filas = (estadoPrecios && estadoPrecios.previsualizacion) || [];
		var t = filas.find(function (x) { return x.tipo_paquete === "proyecto" && x.modalidad_precio === (org === "multigrado" ? "multigrado" : "un_grado"); });
		return t ? { sin_anexos: Number(t.lista_pdf), con_anexos: Number(t.lista_editable) } : PRECIO_SUELTO;
	}
	var sueltosPaqueteSel = document.getElementById("sueltosPaquete");
	var detectarSueltosBtn = document.getElementById("detectarSueltosBtn");
	var sueltosDeteccionEl = document.getElementById("sueltosDeteccion");
	var listaSueltosEl = document.getElementById("listaSueltos");
	var deteccion = null;

	function poblarSelectSueltos() {
		var trimestres = productos.filter(function (p) {
			return p.tipo_paquete === "trimestre" && !p.es_prueba;
		});
		trimestres.sort(function (a, b) {
			if (a.organizacion !== b.organizacion) { return a.organizacion === "completa" ? -1 : 1; }
			if (a.grado !== b.grado) { return a.grado - b.grado; }
			var la = (a.grados_combo || "").length, lb = (b.grados_combo || "").length;
			if (la !== lb) { return la - lb; }
			return (a.trimestre || 0) - (b.trimestre || 0);
		});
		var opts = '<option value="">Selecciona un trimestre</option>';
		trimestres.forEach(function (p) {
			opts += '<option value="' + esc(p.id) + '">' + esc(p.titulo) + "</option>";
		});
		sueltosPaqueteSel.innerHTML = opts;
	}

	function tituloSuelto(org, grado, combo, numero, nombre) {
		var base = org === "multigrado" ? "Multigrado " + comboDisplay(combo) : grado + "° Primaria";
		return base + " — Proyecto " + numero + (nombre ? " · " + nombre : "");
	}

	function chipSi(ok, textoSi, textoNo) {
		return ok
			? '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:#ecfdf5;color:#047a55;border:1px solid #a7f3d0">' + textoSi + "</span>"
			: '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5">' + textoNo + "</span>";
	}

	// Verificación masiva de anexos contra Drive (por tandas; repite hasta que
	// no queden pendientes). Los proyectos sin anexos dejan de ofrecer esa
	// versión en la ficha, y el cobro también la rechaza.
	// ── Vistas previas por imagen ─────────────────────────────────────────────
	// Convierte la muestra en PDF de cada proyecto individual (sin imágenes
	// todavía) en JPG y la sube a previews/proyecto-<id>/; la primera queda
	// como portada. Uno por uno, con avance en el botón: ~5 s por proyecto.
	var generarPreviewsBtn = document.getElementById("generarPreviewsBtn");
	generarPreviewsBtn.addEventListener("click", async function () {
		var pendientes = productos.filter(function (p) { return p.tipo_paquete === "proyecto" && !p.portada_url; });
		if (!pendientes.length) { Tienda.toast("Todos los proyectos individuales ya tienen imágenes.", "ok"); return; }
		if (!window.VistaPrevia) { Tienda.toast("No cargó el generador de vistas previas; recarga la página.", "error"); return; }
		generarPreviewsBtn.disabled = true;
		var texto = generarPreviewsBtn.innerHTML;
		var hechos = 0, fallos = [];
		try {
			for (var i = 0; i < pendientes.length; i++) {
				generarPreviewsBtn.textContent = "Generando " + (i + 1) + " de " + pendientes.length + "...";
				try {
					await window.VistaPrevia.generarProyecto(window.sb, Tienda.EDGE_BASE, pendientes[i].id, {
						headers: { Authorization: "Bearer " + Tienda.getAccessToken(session) },
					});
					hechos++;
				} catch (err) {
					fallos.push(pendientes[i].titulo + ": " + (err.message || "error"));
				}
			}
			Tienda.toast("Vistas previas generadas: " + hechos + (fallos.length ? ". Con error: " + fallos.length + " (" + fallos.slice(0, 2).join("; ") + (fallos.length > 2 ? "…" : "") + ")" : "."), fallos.length ? "info" : "ok");
			await cargarProductos();
			renderSueltos();
		} finally {
			generarPreviewsBtn.disabled = false;
			generarPreviewsBtn.innerHTML = texto;
			Tienda.iconos();
		}
	});

	var verificarAnexosBtn = document.getElementById("verificarAnexosBtn");
	verificarAnexosBtn.addEventListener("click", async function () {
		verificarAnexosBtn.disabled = true;
		var texto = verificarAnexosBtn.innerHTML;
		verificarAnexosBtn.textContent = "Revisando en Drive...";
		try {
			// Primero los que nunca se han revisado; si no queda ninguno, se
			// vuelve a revisar todo el catalogo (por si se agregaron anexos a
			// una carpeta ya verificada). Todo por tandas de 60.
			var LOTE = 60, total = { con: 0, sin: 0, fallos: 0 }, pendientes = 1, vueltas = 0, todos = false, desde = 0;
			async function tanda(cuerpo) {
				var resp = await fetch(Tienda.EDGE_BASE + "/admin-proyectos-drive", {
					method: "POST",
					headers: { Authorization: "Bearer " + Tienda.getAccessToken(session), "Content-Type": "application/json" },
					body: JSON.stringify(cuerpo),
				});
				var data = await resp.json();
				if (!resp.ok) { throw new Error(data.error || "No se pudo verificar."); }
				total.con += data.con_anexos; total.sin += data.sin_anexos; total.fallos += data.fallos;
				return data;
			}
			while (pendientes > 0 && vueltas < 5) {
				var data = await tanda({ verificar_anexos: true, limite: LOTE });
				pendientes = data.pendientes;
				vueltas++;
				if (!data.revisados) { break; }
			}
			if (!total.con && !total.sin && !total.fallos) {
				todos = true;
				for (var i = 0; i < 6; i++) {
					var d = await tanda({ verificar_anexos: true, todos: true, limite: LOTE, desde: desde });
					desde += d.revisados;
					if (d.revisados < LOTE) { break; }
				}
			}
			Tienda.toast((todos ? "Revisados de nuevo todos: " : "Verificados: ") + total.con + " con anexos, " + total.sin + " sin anexos" + (total.fallos ? ", " + total.fallos + " con error" : "") + (pendientes ? ". Quedan " + pendientes + " por revisar: vuelve a pulsar." : "."), total.fallos ? "info" : "ok");
			await cargarProductos();
			renderSueltos();
		} catch (err) {
			Tienda.toast(err.message || "Error al verificar.", "error");
		} finally {
			verificarAnexosBtn.disabled = false;
			verificarAnexosBtn.innerHTML = texto;
			Tienda.iconos();
		}
	});

	detectarSueltosBtn.addEventListener("click", async function () {
		var paqueteId = sueltosPaqueteSel.value;
		if (!paqueteId) { Tienda.toast("Elige un paquete de trimestre.", "error"); return; }
		detectarSueltosBtn.disabled = true;
		sueltosDeteccionEl.classList.remove("hidden");
		sueltosDeteccionEl.innerHTML = '<p class="text-sm text-mute">Leyendo Drive y la base...</p>';
		try {
			var resp = await fetch(Tienda.EDGE_BASE + "/admin-proyectos-drive", {
				method: "POST",
				headers: {
					Authorization: "Bearer " + Tienda.getAccessToken(session),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ producto_id: paqueteId }),
			});
			var data = await resp.json();
			if (!resp.ok) { throw new Error(data.error || "No se pudo leer la carpeta."); }
			deteccion = data;
			renderDeteccion();
		} catch (err) {
			sueltosDeteccionEl.innerHTML = '<p class="text-sm" style="color:#b91c1c">' + esc(err.message || "Error al detectar.") + "</p>";
		} finally {
			detectarSueltosBtn.disabled = false;
		}
	});

	function renderDeteccion() {
		var d = deteccion;
		if (!d || !d.proyectos.length) {
			sueltosDeteccionEl.innerHTML = '<p class="text-sm text-mute">No se encontraron carpetas de proyecto (P01, P02...) en ese trimestre.</p>';
			return;
		}
		var filas = d.proyectos.map(function (p, i) {
			var listo = !!p.dosificacion && p.tiene_pdf && p.tiene_docx;
			var yaExiste = !!p.producto;
			var estado;
			if (yaExiste) {
				estado = p.producto.activo
					? '<span class="text-[11px] font-semibold" style="color:#047a55">Ya publicado</span>'
					: '<span class="text-[11px] font-semibold" style="color:#b45309">Ya creado (oculto)</span>';
			} else if (!listo) {
				estado = '<span class="text-[11px] font-semibold" style="color:#b91c1c">Incompleto</span>';
			} else {
				estado = '<span class="text-[11px] font-semibold" style="color:#1e3a8a">Listo para crear</span>';
			}
			return (
				'<tr style="border-bottom:1px solid #e7e6df">' +
				'<td class="py-2 pr-3"><input type="checkbox" data-idx="' + i + '" class="w-4 h-4 rounded" style="accent-color:#059669"' +
				(listo && !yaExiste ? " checked" : " disabled") + "></td>" +
				'<td class="py-2 pr-3 text-sm font-semibold" style="color:#1c2434">' + esc(p.codigo || "P?") + ' <span class="text-xs font-normal" style="color:#5b6473">(n.º ' + p.numero_proyecto + ")</span></td>" +
				'<td class="py-2 pr-3 text-sm" style="color:#1c2434">' +
				(p.dosificacion
					? esc(p.dosificacion.nombre_proyecto) + '<br><span class="text-xs" style="color:#5b6473">' + esc(p.dosificacion.num_sesiones_estimadas ? p.dosificacion.num_sesiones_estimadas + " sesiones" : "") + "</span>"
					: '<span class="text-xs" style="color:#b91c1c">Sin proyecto en la base para este número</span><br><span class="text-xs" style="color:#5b6473">Carpeta: ' + esc(p.nombre_carpeta) + "</span>") +
				"</td>" +
				'<td class="py-2 pr-3 text-xs"><div class="flex flex-wrap gap-1">' +
				chipSi(p.tiene_pdf, "PDF", "Sin PDF") + chipSi(p.tiene_docx, "Word", "Sin Word") +
				chipSi(p.num_anexos > 0, p.num_anexos + " anexos", "Sin anexos") +
				"</div></td>" +
				"<td class='py-2'>" + estado + "</td></tr>"
			);
		}).join("");

		sueltosDeteccionEl.innerHTML =
			'<div class="rounded-2xl border border-line p-4 flex flex-col gap-3" style="background:#faf9f4">' +
			'<p class="text-sm font-semibold text-ink">Trimestre ' + d.trimestre + " · " + d.proyectos.length + " carpetas de proyecto</p>" +
			'<div class="overflow-x-auto"><table class="w-full text-left min-w-[720px]">' +
			'<thead><tr class="text-xs uppercase tracking-wide" style="color:#5b6473;border-bottom:1px solid #e7e6df">' +
			"<th class='py-2 pr-3'></th><th class='py-2 pr-3 font-semibold'>Carpeta</th><th class='py-2 pr-3 font-semibold'>Proyecto del bot</th>" +
			"<th class='py-2 pr-3 font-semibold'>Contenido</th><th class='py-2 font-semibold'>Estado</th></tr></thead>" +
			"<tbody>" + filas + "</tbody></table></div>" +
			'<div class="flex flex-wrap items-center gap-3">' +
			'<button id="crearSueltosBtn" class="h-11 px-5 rounded-xl font-bold text-white text-sm" style="background:#059669">Crear productos seleccionados</button>' +
			'<span class="text-xs text-mute">Se crean OCULTOS con el precio del tarifario (pestaña Precios, renglón Proyecto individual). Los publicas abajo.</span>' +
			"</div></div>";

		document.getElementById("crearSueltosBtn").addEventListener("click", crearSueltos);
		Tienda.iconos();
	}

	async function crearSueltos() {
		var d = deteccion;
		// El precio de arranque sale del tarifario; si la pestaña Precios no se
		// ha abierto aún, se carga aquí.
		if (!estadoPrecios) {
			var rp = await window.sb.rpc("admin_estado_promocion");
			if (!rp.error) { estadoPrecios = rp.data; }
		}
		var marcados = Array.prototype.slice.call(sueltosDeteccionEl.querySelectorAll("input[data-idx]:checked"));
		if (!marcados.length) { Tienda.toast("No hay proyectos seleccionados.", "error"); return; }
		var btn = document.getElementById("crearSueltosBtn");
		btn.disabled = true; btn.textContent = "Creando...";

		// Contra el doble clic: se descartan los que ya existen según la lista
		// de productos recién cargada (la tabla de detección puede estar vieja).
		// La base además tiene un índice único por proyecto, por si acaso.
		var yaExiste = function (p) {
			return productos.some(function (x) {
				return x.tipo_paquete === "proyecto" && !x.es_prueba && (
					(p.dosificacion && x.dosificacion_proyecto_id === p.dosificacion.id) ||
					(x.organizacion === d.organizacion && (x.grados_combo || null) === (d.grados_combo || null) &&
						x.grado === d.grado && Number(x.numero_proyecto) === Number(p.numero_proyecto))
				);
			});
		};
		var elegidos = marcados.map(function (cb) { return d.proyectos[Number(cb.getAttribute("data-idx"))]; })
			.filter(function (p) { return !yaExiste(p); });
		if (!elegidos.length) {
			Tienda.toast("Esos proyectos ya estaban creados.", "info");
			btn.disabled = false; btn.textContent = "Crear productos seleccionados";
			detectarSueltosBtn.click();
			return;
		}

		var filas = elegidos.map(function (p) {
			return {
				titulo: tituloSuelto(d.organizacion, d.grado, d.grados_combo, p.numero_proyecto, p.dosificacion ? p.dosificacion.nombre_proyecto : null),
				descripcion: null,
				grado: d.grado,
				fase: d.fase || faseDeGrado(d.grado),
				campo_formativo: null,
				trimestre: d.trimestre,
				tipo_paquete: "proyecto",
				num_proyectos: 1,
				numero_proyecto: p.numero_proyecto,
				organizacion: d.organizacion,
				grados_combo: d.grados_combo || null,
				modalidad: d.modalidad || null,
				metodologia: p.dosificacion ? p.dosificacion.metodologia || null : null,
				num_sesiones: p.dosificacion ? p.dosificacion.num_sesiones_estimadas || null : null,
				dosificacion_proyecto_id: p.dosificacion ? p.dosificacion.id : null,
				proyecto_folder_drive_id: p.folder_id,
				precio_pdf: precioSuelto(d.organizacion).sin_anexos,
				precio_pdf_con_anexos: precioSuelto(d.organizacion).con_anexos,
				precio_editable: null,
				activo: false,
				tiene_anexos: p.num_anexos > 0,
			};
		});

		var res = await window.sb.from("marketplace_productos").insert(filas);
		if (res.error) {
			btn.disabled = false; btn.textContent = "Crear productos seleccionados";
			var duplicado = /suelto_dosif_unico|suelto_numero_unico|duplicate key/i.test(res.error.message);
			Tienda.toast(duplicado ? "Alguno de esos proyectos ya existe: no se creó dos veces." : "No se pudo crear: " + res.error.message, "error");
			if (duplicado) { await cargarProductos(); detectarSueltosBtn.click(); renderSueltos(); }
			return;
		}
		// La tabla vieja se retira de inmediato: mientras se vuelve a detectar,
		// un segundo clic ya no encuentra casillas ni botón.
		sueltosDeteccionEl.innerHTML = '<p class="text-sm text-mute">' + filas.length + " proyecto(s) creado(s). Actualizando la lista...</p>";
		Tienda.toast(filas.length + " proyecto(s) creado(s), ocultos.", "ok");
		await cargarProductos();
		renderSueltos();
		// Repetir la detección para que la tabla marque "Ya creado".
		detectarSueltosBtn.click();
	}

	// Eliminar un suelto que se creó por error. Si alguien ya lo compró, la
	// base lo impide (acceso u orden lo referencian): en ese caso, ocultarlo.
	async function eliminarSuelto(id) {
		var p = productos.find(function (x) { return x.id === id; });
		if (!p) { return; }
		if (!confirm("¿Eliminar \"" + p.titulo + "\" del catálogo? Si alguien ya lo compró no se podrá borrar; en ese caso solo ocúltalo.")) { return; }
		var res = await window.sb.from("marketplace_productos").delete().eq("id", id);
		if (res.error) {
			var conCompras = /foreign key|violates|viola/i.test(res.error.message);
			Tienda.toast(conCompras ? "No se puede eliminar: ya tiene compras o accesos. Desmarca \"Publicado\" para ocultarlo." : "No se pudo eliminar: " + res.error.message, "error");
			return;
		}
		Tienda.toast("Proyecto eliminado.", "ok");
		await cargarProductos();
		renderSueltos();
	}

	// Lista de sueltos agrupada por aula. Sin botones por fila: la casilla
	// "Publicado" guarda al instante y cada grupo tiene "Publicar todos" /
	// "Ocultar todos". Los precios son de solo lectura: vienen del tarifario
	// (pestaña Precios, renglón "Proyecto individual") por modalidad.
	function renderSueltos() {
		var sueltos = productos.filter(function (p) { return p.tipo_paquete === "proyecto"; });
		if (!sueltos.length) {
			listaSueltosEl.innerHTML = '<p class="text-sm text-mute">Todavía no hay proyectos individuales. Detecta los de un trimestre arriba.</p>';
			return;
		}
		var grupos = {}, orden = [];
		sueltos.forEach(function (p) {
			var clave = p.organizacion === "multigrado" ? "m-" + p.grados_combo : "c-" + p.grado;
			if (!grupos[clave]) {
				grupos[clave] = {
					titulo: p.organizacion === "multigrado" ? "Multigrado " + comboDisplay(p.grados_combo || "") : p.grado + "° grado",
					grado: p.grado, combo: p.grados_combo || "", items: [],
				};
				orden.push(clave);
			}
			grupos[clave].items.push(p);
		});
		orden.sort(function (x, y) {
			var a = grupos[x], b = grupos[y];
			if (!!a.combo !== !!b.combo) { return a.combo ? 1 : -1; }
			if (a.grado !== b.grado) { return a.grado - b.grado; }
			return a.combo.length - b.combo.length;
		});

		listaSueltosEl.innerHTML = orden.map(function (clave) {
			var g = grupos[clave];
			g.items.sort(function (a, b) { return (a.trimestre || 0) - (b.trimestre || 0) || (a.numero_proyecto || 0) - (b.numero_proyecto || 0); });
			var publicados = g.items.filter(function (p) { return p.activo; }).length;
			var filas = g.items.map(function (p) {
				var nombre = p.titulo.replace(/^.*? — /, "");
				return '<tr data-suelto="' + esc(p.id) + '" style="border-bottom:1px solid ' + (p.es_prueba ? "#fcd34d" : "#e7e6df") + '">' +
					'<td class="py-2 pr-3 text-sm" style="color:#1c2434">' + esc(nombre) +
					(p.es_prueba ? ' <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#fef3c7;color:#b45309">PRUEBA</span>' : "") +
					(!p.dosificacion_proyecto_id ? ' <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#fef2f2;color:#b91c1c">sin proyecto del bot</span>' : "") +
					(p.tiene_anexos === false ? ' <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#f3f4f6;color:#5b6473">sin anexos</span>' : (p.tiene_anexos == null ? ' <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#fffbeb;color:#b45309">anexos sin verificar</span>' : "")) +
					(p.portada_url ? "" : ' <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#fffbeb;color:#b45309">sin imágenes</span>') + "</td>" +
					'<td class="py-2 pr-3 text-xs whitespace-nowrap" style="color:#5b6473">' + (p.trimestre ? "T" + p.trimestre : "—") + "</td>" +
					'<td class="py-2 pr-3 text-sm whitespace-nowrap" style="color:#1c2434">' + money(p.precio_pdf) + ' <span class="text-mute">/</span> ' + money(p.precio_pdf_con_anexos) + "</td>" +
					'<td class="py-2"><div class="flex items-center gap-3">' +
					'<label class="inline-flex items-center gap-2 text-sm text-ink cursor-pointer"><input data-publicar="' + esc(p.id) + '" type="checkbox" class="w-4 h-4 rounded" style="accent-color:#059669"' + (p.activo ? " checked" : "") + "> Publicado</label>" +
					'<button type="button" data-eliminar-suelto="' + esc(p.id) + '" aria-label="Eliminar" title="Eliminar" class="w-9 h-9 rounded-lg flex items-center justify-center transition hover:bg-red-50" style="color:#b91c1c"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
					"</div></td></tr>";
			}).join("");
			return '<div class="mb-5">' +
				'<div class="flex flex-wrap items-center justify-between gap-2 mb-2">' +
				'<h4 class="font-bold text-sm" style="color:#1e3a8a">' + esc(g.titulo) + ' <span class="font-normal text-mute">· ' + publicados + " de " + g.items.length + " publicados</span></h4>" +
				'<div class="flex gap-2">' +
				'<button data-grupo-publicar="' + esc(clave) + '" data-valor="1" class="text-xs font-semibold px-3 h-9 rounded-lg" style="background:#ecfdf5;color:#047a55;border:1px solid #a7f3d0">Publicar todos</button>' +
				'<button data-grupo-publicar="' + esc(clave) + '" data-valor="0" class="text-xs font-semibold px-3 h-9 rounded-lg" style="background:#fff;border:1px solid #e7e6df;color:#5b6473">Ocultar todos</button>' +
				"</div></div>" +
				'<table class="w-full text-left min-w-[640px]"><thead><tr class="text-xs uppercase tracking-wide" style="color:#5b6473;border-bottom:1px solid #e7e6df">' +
				"<th class='py-2 pr-3 font-semibold'>Proyecto</th><th class='py-2 pr-3 font-semibold'>Trim.</th><th class='py-2 pr-3 font-semibold'>Sin / con anexos</th><th class='py-2 font-semibold'>Catálogo</th></tr></thead>" +
				"<tbody>" + filas + "</tbody></table></div>";
		}).join("");

		listaSueltosEl.querySelectorAll("[data-publicar]").forEach(function (cb) {
			cb.addEventListener("change", function () { publicarSueltos([cb.getAttribute("data-publicar")], cb.checked); });
		});
		listaSueltosEl.querySelectorAll("[data-eliminar-suelto]").forEach(function (b) {
			b.addEventListener("click", function () { eliminarSuelto(b.getAttribute("data-eliminar-suelto")); });
		});
		Tienda.iconos();
		listaSueltosEl.querySelectorAll("[data-grupo-publicar]").forEach(function (b) {
			b.addEventListener("click", function () {
				var ids = grupos[b.getAttribute("data-grupo-publicar")].items
					.filter(function (p) { return !p.es_prueba; })
					.map(function (p) { return p.id; });
				publicarSueltos(ids, b.getAttribute("data-valor") === "1");
			});
		});
	}

	// Publicar u ocultar uno o varios sueltos. Se guarda al instante y se
	// repinta la lista con lo que la base devolvió.
	async function publicarSueltos(ids, activo) {
		if (!ids.length) { return; }
		var res = await window.sb.from("marketplace_productos")
			.update({ activo: activo, updated_at: new Date().toISOString() })
			.in("id", ids);
		if (res.error) { Tienda.toast("No se pudo guardar: " + res.error.message, "error"); await cargarProductos(); renderSueltos(); return; }
		Tienda.toast(ids.length === 1 ? (activo ? "Publicado." : "Oculto.") : (activo ? ids.length + " proyectos publicados." : ids.length + " proyectos ocultos."), "ok");
		await cargarProductos();
		renderSueltos();
	}

	// ── Proyectos personalizados ──────────────────────────────────────────────────
	// Configuración (cupo, ventana, precios) por RPC; listado por RPC con el
	// flag de vencido calculado en la base; "Entregar" pasa por la Edge Function
	// completar-pedido, que verifica la carpeta en Drive, crea el producto,
	// otorga el acceso y avisa al cliente.
	var pedAbiertoEl = document.getElementById("pedAbierto");
	var pedTopeEl = document.getElementById("pedTope");
	var pedVentanaEl = document.getElementById("pedVentana");
	var pedPrecioSinEl = document.getElementById("pedPrecioSin");
	var pedPrecioConEl = document.getElementById("pedPrecioCon");
	var pedMensajeEl = document.getElementById("pedMensaje");
	var estadoPedidosEl = document.getElementById("estadoPedidos");
	var guardarPedidosCfgBtn = document.getElementById("guardarPedidosCfgBtn");
	var listaPedidosEl = document.getElementById("listaPedidos");
	var listaBusquedasEl = document.getElementById("listaBusquedas");
	var pedidos = [];
	var pedidoAbierto = null;
	var dosifCache = null; // dosificacion_proyectos para el datalist del modal

	var ESTADO_PEDIDO = {
		pendiente:  { texto: "En cola", css: "background:#eff6ff;color:#1e40af;border:1px solid #93c5fd" },
		en_proceso: { texto: "En elaboración", css: "background:#fffbeb;color:#b45309;border:1px solid #fcd34d" },
		completado: { texto: "Entregado", css: "background:#ecfdf5;color:#047a55;border:1px solid #a7f3d0" },
		cancelado:  { texto: "Cancelado", css: "background:#f3f4f6;color:#5b6473;border:1px solid #e7e6df" },
	};
	var NOMBRE_CF = { LEN: "Lenguajes", SAB: "Saberes y Pensamiento Científico", ETI: "Ética, Naturaleza y Sociedades", DHL: "De lo Humano y lo Comunitario" };

	function aulaPedido(p) {
		return p.organizacion === "multigrado"
			? "Multigrado " + comboDisplay(p.grados_combo || "")
			: (p.grados && p.grados[0] ? p.grados[0] + "° Primaria" : "Primaria");
	}
	function fechaCorta(iso) {
		return iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
	}

	async function cargarPedidos() {
		var res = await Promise.all([
			window.sb.rpc("admin_estado_personalizados"),
			window.sb.rpc("admin_listar_pedidos"),
			window.sb.rpc("admin_busquedas_vacias", { p_dias: 30 }),
		]);
		if (res[0].error) { Tienda.toast("No se pudo cargar la configuración: " + res[0].error.message, "error"); }
		else { renderPedidosCfg(res[0].data); }
		if (res[1].error) { listaPedidosEl.innerHTML = '<p class="text-sm" style="color:#b91c1c">Error: ' + esc(res[1].error.message) + "</p>"; }
		else { pedidos = res[1].data || []; renderPedidos(); }
		if (res[2].error) { listaBusquedasEl.innerHTML = '<p class="text-sm" style="color:#b91c1c">Error: ' + esc(res[2].error.message) + "</p>"; }
		else { renderBusquedas(res[2].data || []); }
	}

	function renderPedidosCfg(d) {
		pedAbiertoEl.checked = !!d.abierto;
		pedTopeEl.value = d.tope_simultaneo;
		pedVentanaEl.value = d.ventana_horas;
		pedPrecioSinEl.value = d.precio_sin_anexos;
		pedPrecioConEl.value = d.precio_con_anexos;
		pedMensajeEl.value = d.mensaje_cerrado || "";
		var pub = d.publico || {};
		estadoPedidosEl.textContent = (pub.abierto ? "Abierto" : "Cerrado") +
			" · " + (pub.cupos_disponibles != null ? pub.cupos_disponibles + " lugares libres ahora (" + (pub.en_curso || 0) + " en curso)" : "") +
			" · en cola " + (d.pendientes || 0) + " · en elaboración " + (d.en_proceso || 0) +
			(d.vencidos ? " · VENCIDOS " + d.vencidos : "");
		estadoPedidosEl.style.color = d.vencidos ? "#b91c1c" : "#1c2434";
	}

	guardarPedidosCfgBtn.addEventListener("click", async function () {
		var tope = Number(pedTopeEl.value), ventana = Number(pedVentanaEl.value);
		var sin = Number(pedPrecioSinEl.value), con = Number(pedPrecioConEl.value);
		if (!(tope >= 0) || !(ventana >= 1) || !(sin >= 0) || !(con >= sin)) {
			Tienda.toast("Revisa los números: el cupo y los precios no pueden ser negativos, y el precio con anexos no puede ser menor que sin anexos.", "error");
			return;
		}
		guardarPedidosCfgBtn.disabled = true; guardarPedidosCfgBtn.textContent = "Guardando...";
		var res = await window.sb.rpc("admin_guardar_personalizados", {
			p_abierto: pedAbiertoEl.checked, p_tope: tope, p_ventana: ventana,
			p_precio_sin: sin, p_precio_con: con, p_mensaje: (pedMensajeEl.value || "").trim() || null,
		});
		guardarPedidosCfgBtn.disabled = false; guardarPedidosCfgBtn.textContent = "Guardar";
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		renderPedidosCfg(res.data);
		Tienda.toast("Configuración guardada.", "ok");
	});

	function renderPedidos() {
		if (!pedidos.length) {
			listaPedidosEl.innerHTML = '<p class="text-sm text-mute">Todavía no hay pedidos pagados.</p>';
			return;
		}
		var rows = pedidos.map(function (p) {
			var est = ESTADO_PEDIDO[p.estado] || ESTADO_PEDIDO.cancelado;
			var detalle = [];
			if (p.campos_formativos && p.campos_formativos.length) { detalle.push(p.campos_formativos.map(function (c) { return NOMBRE_CF[c] || c; }).join(", ")); }
			(p.contenidos || []).forEach(function (c) { detalle.push("Contenido: " + c); });
			(p.pdas || []).forEach(function (d) { detalle.push("PDA: " + d); });
			if (p.metodologia) { detalle.push(p.metodologia); }
			if (p.fecha_necesaria) { detalle.push("Lo necesita: " + p.fecha_necesaria); }
			if (p.notas) { detalle.push("Notas: " + p.notas); }
			var abierto = p.estado === "pendiente" || p.estado === "en_proceso";
			var acciones = "";
			if (abierto) {
				if (p.estado === "pendiente") {
					acciones += '<button data-ped-estado="en_proceso" data-ped="' + esc(p.id) + '" class="text-xs font-semibold px-3 h-10 rounded-lg" style="background:#fff;border:1px solid #fcd34d;color:#b45309">En elaboración</button>';
				}
				acciones += '<button data-ped-entregar="' + esc(p.id) + '" class="text-xs font-bold px-3 h-10 rounded-lg text-white" style="background:#059669">Entregar</button>';
				acciones += '<button data-ped-estado="cancelado" data-ped="' + esc(p.id) + '" class="text-xs font-semibold px-3 h-10 rounded-lg" style="color:#b91c1c">Cancelar</button>';
			} else if (p.estado === "completado" && p.producto_id) {
				acciones += '<a href="proyecto.html?id=' + esc(p.producto_id) + '" target="_blank" rel="noopener" class="text-xs font-semibold px-3 h-10 inline-flex items-center rounded-lg" style="border:1px solid #e7e6df;color:#1e3a8a">Ver ficha</a>';
			}
			var carpeta = p.numero_pedido + "_" + ((p.nombre_cliente || "cliente").split(" ")[0]);
			return (
				'<tr style="border-bottom:1px solid #e7e6df;vertical-align:top' + (p.vencido ? ";background:#fef2f2" : "") + '">' +
				'<td class="py-3 pr-3"><p class="font-bold text-sm" style="color:#1c2434">' + esc(p.numero_pedido) + "</p>" +
				'<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-block mt-1" style="' + est.css + '">' + esc(est.texto) + "</span>" +
				(p.vencido ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full inline-block mt-1 ml-1" style="background:#fee2e2;color:#b91c1c">Vencido</span>' : "") + "</td>" +
				'<td class="py-3 pr-3 text-sm" style="color:#1c2434"><p class="font-semibold">' + esc(p.nombre_cliente || "") + '</p><p class="text-xs" style="color:#5b6473">' + esc(p.email || "") + "</p></td>" +
				'<td class="py-3 pr-3 text-sm" style="color:#1c2434"><p class="font-semibold">' + esc(aulaPedido(p)) + " · " + (p.nivel === "con_anexos" ? "con anexos" : "sin anexos") + "</p>" +
				'<p class="text-xs leading-relaxed" style="color:#5b6473">' + esc(detalle.join(" · ") || "Sin preferencias") + "</p>" +
				'<p class="text-xs mt-1 font-mono" style="color:#5b6473">Carpeta: ' + esc(carpeta) + "</p></td>" +
				'<td class="py-3 pr-3 text-xs" style="color:#5b6473">Pagó ' + esc(fechaCorta(p.pagado_en)) + "<br>Entregar antes de<br><strong style=\"color:" + (p.vencido ? "#b91c1c" : "#1c2434") + '">' + esc(fechaCorta(p.fecha_compromiso_entrega)) + "</strong>" +
				(p.completado_en ? "<br>Entregado " + esc(fechaCorta(p.completado_en)) : "") + "</td>" +
				'<td class="py-3"><div class="flex flex-wrap gap-1.5">' + acciones + "</div></td></tr>"
			);
		}).join("");
		listaPedidosEl.innerHTML =
			'<table class="w-full text-left min-w-[900px]">' +
			'<thead><tr class="text-xs uppercase tracking-wide" style="color:#5b6473;border-bottom:1px solid #e7e6df">' +
			"<th class='py-2 pr-3 font-semibold'>Pedido</th><th class='py-2 pr-3 font-semibold'>Cliente</th>" +
			"<th class='py-2 pr-3 font-semibold'>Qué pidió</th><th class='py-2 pr-3 font-semibold'>Fechas</th><th class='py-2 font-semibold'>Acciones</th></tr></thead>" +
			"<tbody>" + rows + "</tbody></table>";
		listaPedidosEl.querySelectorAll("[data-ped-estado]").forEach(function (b) {
			b.addEventListener("click", function () { cambiarEstadoPedido(b.getAttribute("data-ped"), b.getAttribute("data-ped-estado")); });
		});
		listaPedidosEl.querySelectorAll("[data-ped-entregar]").forEach(function (b) {
			b.addEventListener("click", function () { abrirModalPedido(b.getAttribute("data-ped-entregar")); });
		});
	}

	async function cambiarEstadoPedido(id, estado) {
		var p = pedidos.find(function (x) { return x.id === id; });
		if (!p) { return; }
		if (estado === "cancelado" && !confirm("¿Cancelar el pedido " + p.numero_pedido + "? El reembolso, si aplica, se hace aparte en Mercado Pago.")) { return; }
		var res = await window.sb.rpc("admin_actualizar_pedido", { p_id: id, p_estado: estado });
		if (res.error) { Tienda.toast("Error: " + res.error.message, "error"); return; }
		Tienda.toast("Pedido actualizado.", "ok");
		cargarPedidos();
	}

	// ── Modal de entrega ────────────────────────────────────────────────────
	var modalPedido = document.getElementById("modalPedido");
	var pedDriveFolderEl = document.getElementById("pedDriveFolder");
	var pedDosifEl = document.getElementById("pedDosif");
	var listaDosifEl = document.getElementById("listaDosif");
	var pedTituloEl = document.getElementById("pedTitulo");
	var pedPublicarEl = document.getElementById("pedPublicar");
	var modalPedidoMensaje = document.getElementById("modalPedidoMensaje");
	var modalPedidoEntregar = document.getElementById("modalPedidoEntregar");
	document.getElementById("modalPedidoCerrar").addEventListener("click", cerrarModalPedido);
	document.getElementById("modalPedidoCancelar").addEventListener("click", cerrarModalPedido);
	modalPedido.addEventListener("click", function (e) { if (e.target === modalPedido) { cerrarModalPedido(); } });

	async function abrirModalPedido(id) {
		pedidoAbierto = pedidos.find(function (x) { return x.id === id; });
		if (!pedidoAbierto) { return; }
		var p = pedidoAbierto;
		document.getElementById("modalPedidoTitulo").textContent = "Entregar " + p.numero_pedido;
		document.getElementById("modalPedidoResumen").innerHTML =
			"<strong>" + esc(p.nombre_cliente || "") + "</strong> · " + esc(p.email || "") + "<br>" +
			esc(aulaPedido(p)) + " · " + (p.nivel === "con_anexos" ? "CON anexos (la carpeta debe tener subcarpetas S##)" : "sin anexos") +
			((p.contenidos || []).length ? "<br>" + esc((p.contenidos || []).join(" · ")) : "");
		pedDriveFolderEl.value = p.drive_folder_id || "";
		pedDosifEl.value = "";
		pedTituloEl.value = "";
		pedTituloEl.placeholder = aulaPedido(p) + " — (nombre del proyecto)";
		pedPublicarEl.checked = true;
		modalPedidoMensaje.classList.add("hidden");
		modalPedido.classList.remove("hidden");
		await poblarDosif();
	}
	function cerrarModalPedido() { modalPedido.classList.add("hidden"); pedidoAbierto = null; }

	// Proyectos del bot para enlazar el personalizado. Se cargan una vez.
	async function poblarDosif() {
		if (!dosifCache) {
			var r = await window.sb.from("dosificacion_proyectos")
				.select("id, nombre_proyecto, grados, trimestre, numero_proyecto")
				.order("created_at", { ascending: false }).limit(500);
			dosifCache = r.data || [];
		}
		listaDosifEl.innerHTML = dosifCache.map(function (d) {
			var etiqueta = (d.grados || []).join("-") + "° · " + (d.trimestre ? "T" + d.trimestre + " P" + d.numero_proyecto + " · " : "") + d.nombre_proyecto;
			return '<option value="' + esc(etiqueta) + '"></option>';
		}).join("");
	}
	function dosifElegido() {
		var v = (pedDosifEl.value || "").trim();
		if (!v) { return null; }
		var d = (dosifCache || []).find(function (x) {
			var etiqueta = (x.grados || []).join("-") + "° · " + (x.trimestre ? "T" + x.trimestre + " P" + x.numero_proyecto + " · " : "") + x.nombre_proyecto;
			return etiqueta === v || x.nombre_proyecto === v;
		});
		return d ? d.id : null;
	}

	modalPedidoEntregar.addEventListener("click", async function () {
		var p = pedidoAbierto;
		if (!p) { return; }
		var folder = pedDriveFolderEl.value.trim();
		if (!folder) { mensajeModal("Pega el ID de la carpeta de Drive.", true); return; }
		if ((pedDosifEl.value || "").trim() && !dosifElegido()) {
			mensajeModal("No encontré ese proyecto del bot: elige uno de la lista o deja el campo vacío.", true);
			return;
		}
		if (!confirm("Vas a marcar el pedido " + p.numero_pedido + " de " + (p.nombre_cliente || p.email) + " como completado con la carpeta " + folder + ". Se creará el producto, se dará el acceso y se avisará al cliente por correo. ¿Confirmar?")) { return; }

		modalPedidoEntregar.disabled = true; modalPedidoEntregar.textContent = "Verificando en Drive y entregando...";
		try {
			var resp = await fetch(Tienda.EDGE_BASE + "/completar-pedido", {
				method: "POST",
				headers: { Authorization: "Bearer " + Tienda.getAccessToken(session), "Content-Type": "application/json" },
				body: JSON.stringify({
					pedido_id: p.id,
					drive_folder_id: folder,
					dosificacion_proyecto_id: dosifElegido(),
					titulo: (pedTituloEl.value || "").trim() || null,
					publicar: pedPublicarEl.checked,
				}),
			});
			var data = await resp.json();
			if (!resp.ok) { throw new Error(data.error || "No se pudo entregar."); }
			Tienda.toast("Pedido " + data.numero_pedido + " entregado" + (data.correo_enviado ? " y cliente avisado." : ". No se pudo enviar el correo: avísale tú."), "ok");
			cerrarModalPedido();
			await cargarPedidos();
			await cargarProductos();
		} catch (err) {
			mensajeModal(err.message || "Error al entregar.", true);
		} finally {
			modalPedidoEntregar.disabled = false; modalPedidoEntregar.textContent = "Entregar y avisar al cliente";
		}
	});
	function mensajeModal(texto, error) {
		modalPedidoMensaje.textContent = texto;
		modalPedidoMensaje.style.cssText = error ? "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5" : "background:#eff6ff;color:#1e40af;border:1px solid #93c5fd";
		modalPedidoMensaje.classList.remove("hidden");
	}

	function renderBusquedas(filas) {
		if (!filas.length) { listaBusquedasEl.innerHTML = '<p class="text-sm text-mute">Ninguna en los últimos 30 días.</p>'; return; }
		listaBusquedasEl.innerHTML =
			'<table class="w-full text-left min-w-[560px]"><thead><tr class="text-xs uppercase tracking-wide" style="color:#5b6473;border-bottom:1px solid #e7e6df">' +
			"<th class='py-2 pr-3 font-semibold'>Filtros</th><th class='py-2 pr-3 font-semibold'>Veces</th><th class='py-2 font-semibold'>Última</th></tr></thead><tbody>" +
			filas.map(function (f) {
				var x = f.filtros || {};
				var partes = [];
				partes.push(x.organizacion === "multigrado" ? "Multigrado " + ((x.combos || []).map(comboDisplay).join(", ") || "") : ((x.grados || []).map(function (g) { return g + "°"; }).join(", ") || "cualquier grado"));
				if (x.campos && x.campos.length) { partes.push(x.campos.map(function (c) { return NOMBRE_CF[c] || c; }).join(", ")); }
				if (x.contenido_id) { partes.push("contenido " + String(x.contenido_id).slice(0, 8) + "…"); }
				if (x.pda_id) { partes.push("PDA " + String(x.pda_id).slice(0, 8) + "…"); }
				return '<tr style="border-bottom:1px solid #e7e6df"><td class="py-2 pr-3 text-sm" style="color:#1c2434">' + esc(partes.join(" · ")) + "</td>" +
					'<td class="py-2 pr-3 text-sm font-semibold" style="color:#1c2434">' + esc(f.veces) + "</td>" +
					'<td class="py-2 text-xs" style="color:#5b6473">' + esc(fechaCorta(f.ultima)) + "</td></tr>";
			}).join("") + "</tbody></table>";
	}

	// Carga inicial: al final, cuando gridEl y accesoProductoSel ya están referenciados.
	await cargarProductos();
});
