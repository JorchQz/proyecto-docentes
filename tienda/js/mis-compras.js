document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("mis-compras");
	if (!session) {
		session = await Tienda.requireSession();
		if (!session) { return; }
	}

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
		// Agrupar accesos por producto; quedarse con el tier más completo.
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

			// Tier que se usará para descargar (editable incluye docx + pdf).
			var esEditable = !!info.tipos.editable;
			var accesoId = esEditable ? info.tipos.editable : info.tipos.pdf;
			var versionTxt = esEditable ? "Word + PDF + anexos" : "PDF + anexos";

			var card = document.createElement("div");
			card.className = "bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-3";
			card.innerHTML =
				'<div class="flex items-start gap-3 flex-1 min-w-0">' +
				'<div class="shrink-0 w-12 h-12 rounded-xl ' + (esCiclo ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700") + ' flex items-center justify-center"><i data-lucide="' + (esCiclo ? "library" : "folder") + '" class="w-6 h-6"></i></div>' +
				'<div class="min-w-0 flex-1">' +
				'<h3 class="font-bold text-gray-800 leading-snug">' + esc(prod.titulo || "Paquete") + "</h3>" +
				'<div class="flex flex-wrap gap-1.5 mt-1">' +
				'<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">' + esc(etiquetaTipo) + "</span>" +
				(prod.grado ? '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">' + esc(prod.grado) + "°</span>" : "") +
				'<span class="inline-flex items-center bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">Incluye: ' + esc(versionTxt) + "</span>" +
				"</div></div></div>" +
				'<a href="biblioteca.html?acceso_id=' + encodeURIComponent(accesoId) + '" class="shrink-0 bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold px-5 py-3 rounded-xl transition min-h-[44px] inline-flex items-center justify-center">Abrir biblioteca →</a>';

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
			div.className = "bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3";
			div.innerHTML =
				'<div><p class="font-semibold text-gray-800 text-sm">' + esc(titulo) + "</p>" +
				'<p class="text-xs text-amber-700 mt-0.5">' + esc(metodo) + "</p></div>" +
				'<span class="text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full shrink-0">En proceso</span>';
			listaPendientes.appendChild(div);
		});
	}

	function vacio() {
		estadoEl.classList.remove("hidden");
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-3">' +
			'<i data-lucide="shopping-cart" class="w-12 h-12 text-gray-400"></i>' +
			'<p class="text-gray-700 text-lg font-semibold">Aún no tienes compras</p>' +
			'<a href="catalogo.html" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition text-sm min-h-[44px]">Ver catálogo</a>' +
			"</div>";
		Tienda.iconos();
	}

	function banner(texto, tipo) {
		var cls = tipo === "ok"
			? "bg-emerald-50 border-emerald-200 text-emerald-800"
			: tipo === "error"
			? "bg-red-50 border-red-200 text-red-700"
			: "bg-blue-50 border-blue-200 text-blue-800";
		bannerEl.innerHTML = '<div class="border rounded-xl px-4 py-3 text-sm font-medium ' + cls + '">' + esc(texto) + "</div>";
	}
});
