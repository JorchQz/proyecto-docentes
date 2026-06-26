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

	// Precios predeterminados por organización.
	var PRECIO = {
		completa: { trimestre: { pdf: 400, editable: 600 }, ciclo: { pdf: 1050, editable: 1550 } },
		multigrado: { trimestre: { pdf: 500, editable: 700 }, ciclo: { pdf: 1300, editable: 1800 } },
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
		});
	});

	async function cargarProductos() {
		var res = await window.sb
			.from("marketplace_productos")
			.select("*")
			.order("grado", { ascending: true });
		productos = res.data || [];
		porClave = {};
		productos.forEach(function (p) { porClave[clave(p)] = p; });
		renderGrid();
		poblarSelectProductos();
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
			F.driveFolder.value = prod.proyecto_folder_drive_id || "";
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
		modal.classList.remove("hidden");
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

	// Carga inicial: al final, cuando gridEl y accesoProductoSel ya están referenciados.
	await cargarProductos();
});
