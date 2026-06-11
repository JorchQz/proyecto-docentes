document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("mis-compras");
	if (!session) {
		session = await Tienda.requireSession();
		if (!session) { return; }
	}
	Tienda.montarFooter();

	var esc = Tienda.esc;
	var estadoEl = document.getElementById("estado");
	var listaEl = document.getElementById("listaCompras");
	var bannerEl = document.getElementById("banner");
	var seccionPendientes = document.getElementById("seccionPendientes");
	var listaPendientes = document.getElementById("listaPendientes");

	var status = new URLSearchParams(location.search).get("status");
	if (status === "approved") {
		banner("¡Pago exitoso! Tu paquete ya está disponible para descargar.", "ok");
	} else if (status === "pending") {
		banner("Tu pago está en proceso. En cuanto se confirme verás las descargas aquí.", "info");
	} else if (status === "failure") {
		banner("El pago no se completó. Puedes intentarlo de nuevo desde el catálogo.", "error");
	}

	await cargar();

	async function cargar() {
		var accRes = await window.sb
			.from("marketplace_accesos")
			.select("id, tipo, producto_id, otorgado_en, marketplace_productos(titulo, grado, tipo_paquete, trimestre, num_proyectos)")
			.eq("user_id", session.user.id)
			.order("otorgado_en", { ascending: false });

		var ordRes = await window.sb
			.from("marketplace_ordenes")
			.select("id, estado, monto_total, metodo_pago, created_at, marketplace_orden_items(tipo, marketplace_productos(titulo))")
			.eq("user_id", session.user.id)
			.eq("estado", "pendiente")
			.order("created_at", { ascending: false });

		estadoEl.classList.add("hidden");

		var accesos = (accRes.data || []);
		renderCompras(accesos);
		renderPendientes(ordRes.data || []);

		if (!accesos.length && !(ordRes.data || []).length) {
			vacio();
		}
	}

	function renderCompras(accesos) {
		var porProducto = {};
		accesos.forEach(function (a) {
			var pid = a.producto_id;
			if (!porProducto[pid]) {
				porProducto[pid] = { producto: a.marketplace_productos, tipos: {}, fecha: a.otorgado_en };
			}
			porProducto[pid].tipos[a.tipo] = a.id;
		});

		var ids = Object.keys(porProducto);
		if (!ids.length) { return; }

		listaEl.classList.remove("hidden");
		listaEl.innerHTML = "";

		ids.forEach(function (pid) {
			var info = porProducto[pid];
			var prod = info.producto || {};
			var esCiclo = prod.tipo_paquete === "ciclo";
			var etiquetaTipo = esCiclo ? "Ciclo completo" : "Trimestre " + (prod.trimestre || "");
			var esEditable = !!info.tipos.editable;
			var accesoId = esEditable ? info.tipos.editable : info.tipos.pdf;
			var versionTxt = esEditable ? "Word + PDF + anexos" : "PDF + anexos";
			var iconoNombre = esCiclo ? "library" : "folder";
			var iconoBg = esCiclo ? "rgba(30,58,138,.1)" : "rgba(5,150,105,.1)";
			var iconoColor = esCiclo ? "#1e3a8a" : "#059669";

			var card = document.createElement("div");
			card.className = "bg-white rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-4";
			card.style.borderColor = "#e7e6df";
			card.innerHTML =
				'<div class="flex items-start gap-3 flex-1 min-w-0">' +
				'<div class="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style="background:' + iconoBg + '">' +
				'<i data-lucide="' + iconoNombre + '" style="width:1.5rem;height:1.5rem;color:' + iconoColor + '"></i></div>' +
				'<div class="min-w-0 flex-1">' +
				'<h3 class="font-bold leading-snug" style="color:#1c2434">' + esc(prod.titulo || "Paquete") + "</h3>" +
				'<div class="flex flex-wrap gap-1.5 mt-2">' +
				'<span class="text-[12px] font-medium h-6 px-2 rounded-md inline-flex items-center" style="background:#f1f0ea;color:#5b6473">' + esc(etiquetaTipo) + "</span>" +
				(prod.grado ? '<span class="text-[12px] font-medium h-6 px-2 rounded-md inline-flex items-center" style="background:#f1f0ea;color:#5b6473">' + esc(prod.grado) + '°</span>' : "") +
				'<span class="text-[12px] font-medium h-6 px-2 rounded-md inline-flex items-center" style="background:#f1f0ea;color:#5b6473">Incluye: ' + esc(versionTxt) + "</span>" +
				"</div></div></div>" +
				'<a href="biblioteca.html?acceso_id=' + encodeURIComponent(accesoId) + '" class="shrink-0 h-11 px-5 rounded-xl text-sm font-bold text-white inline-flex items-center justify-center transition" style="background:#1e3a8a">Abrir biblioteca</a>';

			listaEl.appendChild(card);
		});
		Tienda.iconos();
	}

	function renderPendientes(ordenes) {
		if (!ordenes.length) { return; }
		seccionPendientes.classList.remove("hidden");
		listaPendientes.innerHTML = "";
		ordenes.forEach(function (o) {
			var items = (o.marketplace_orden_items || []);
			var titulo = items.length && items[0].marketplace_productos
				? items[0].marketplace_productos.titulo : "Paquete";
			var metodo = o.metodo_pago === "transferencia" ? "Transferencia (por confirmar)" : "Pago en proceso";
			var div = document.createElement("div");
			div.className = "rounded-2xl p-4 flex items-center justify-between gap-3";
			div.style.cssText = "background:#fffbeb;border:1px solid #fbbf24";
			div.innerHTML =
				'<div>' +
				'<p class="font-semibold text-sm" style="color:#1c2434">' + esc(titulo) + "</p>" +
				'<p class="text-xs mt-0.5" style="color:#b45309">' + esc(metodo) + "</p></div>" +
				'<span class="text-xs font-bold h-7 px-3 rounded-full inline-flex items-center shrink-0" style="background:#fef3c7;color:#b45309">En proceso</span>';
			listaPendientes.appendChild(div);
		});
	}

	function vacio() {
		estadoEl.classList.remove("hidden");
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-4">' +
			'<i data-lucide="shopping-cart" style="width:3rem;height:3rem;color:#5b6473"></i>' +
			'<p class="font-bold text-lg" style="color:#1c2434">Aún no tienes compras</p>' +
			'<a href="catalogo.html" class="inline-flex items-center gap-2 h-11 px-6 rounded-xl text-sm font-bold text-white" style="background:#059669">Ver catálogo</a>' +
			"</div>";
		Tienda.iconos();
	}

	function banner(texto, tipo) {
		var bg, border, color;
		if (tipo === "ok") { bg = "#f0fdf4"; border = "#86efac"; color = "#166534"; }
		else if (tipo === "error") { bg = "#fef2f2"; border = "#fca5a5"; color = "#991b1b"; }
		else { bg = "#eff6ff"; border = "#93c5fd"; color = "#1e40af"; }
		bannerEl.innerHTML = '<div class="rounded-2xl px-4 py-3 text-sm font-medium" style="background:' + bg + ';border:1px solid ' + border + ';color:' + color + '">' + esc(texto) + "</div>";
	}
});
