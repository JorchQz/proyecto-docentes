document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("");
	var esc = Tienda.esc;
	var money = Tienda.formatMoney;

	var estadoEl = document.getElementById("estado");
	var contenidoEl = document.getElementById("contenido");
	var badgesEl = document.getElementById("badges");
	var tituloEl = document.getElementById("titulo");
	var descripcionEl = document.getElementById("descripcion");
	var metaEl = document.getElementById("meta");
	var selectorEl = document.getElementById("selectorOpcion");
	var opcionesEl = document.getElementById("opcionesCompra");
	var previewFrame = document.getElementById("previewFrame");
	var previewVacio = document.getElementById("previewVacio");
	var incluyeWrap = document.getElementById("incluyeWrap");
	var incluyeLista = document.getElementById("incluyeLista");

	var params = new URLSearchParams(location.search);
	var org = params.get("org") || "completa";
	var g = params.get("g");
	var combo = params.get("combo");
	var esMulti = org === "multigrado";

	// Cargar el grupo (todos los paquetes del grado/combinación).
	var q = window.sb
		.from("marketplace_productos")
		.select("id, titulo, grado, trimestre, tipo_paquete, num_proyectos, precio_pdf, precio_editable, grados_combo, modalidad")
		.eq("activo", true)
		.eq("organizacion", org);
	q = esMulti ? q.eq("grados_combo", combo) : q.eq("grado", Number(g));

	var res = await q;
	if (res.error || !res.data || !res.data.length) {
		estadoEl.textContent = "Este paquete no está disponible.";
		return;
	}

	var productos = res.data.slice().sort(function (a, b) { return ordenOpcion(a) - ordenOpcion(b); });
	var info = productos[0];
	var gradoNum = info.grado;
	var comboArr = esMulti ? (info.grados_combo || "").split("-") : [String(gradoNum)];

	// Accesos del usuario sobre estos productos.
	var accesosPorProd = {};
	if (session) {
		var ids = productos.map(function (p) { return p.id; });
		var accRes = await window.sb
			.from("marketplace_accesos")
			.select("tipo, producto_id")
			.eq("user_id", session.user.id)
			.in("producto_id", ids);
		if (!accRes.error && accRes.data) {
			accRes.data.forEach(function (a) {
				(accesosPorProd[a.producto_id] = accesosPorProd[a.producto_id] || {})[a.tipo] = true;
			});
		}
	}

	var seleccionado = productos[0];

	renderHeader();
	renderSelector();
	seleccionar(productos[0]);

	estadoEl.classList.add("hidden");
	contenidoEl.classList.remove("hidden");

	var ctaBtn = document.getElementById("ctaBtn");
	if (ctaBtn) {
		ctaBtn.addEventListener("click", function () {
			document.getElementById("selectorWrap").scrollIntoView({ behavior: "smooth", block: "center" });
		});
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function ordenOpcion(p) { return p.tipo_paquete === "ciclo" ? 4 : (p.trimestre || 0); }
	function comboDisplay() {
		return esMulti
			? comboArr.map(function (n) { return n + "°"; }).join("-")
			: gradoNum + "°";
	}
	function etiquetaOpcion(p) {
		return p.tipo_paquete === "ciclo" ? "Ciclo completo" : "Trimestre " + p.trimestre;
	}

	function renderHeader() {
		var tituloGrupo = esMulti
			? "Multigrado " + comboDisplay()
			: gradoNum + "° Primaria";
		tituloEl.textContent = tituloGrupo;
		descripcionEl.textContent = esMulti
			? "Planeación multigrado para un aula de " + comboDisplay() + ", con actividades diferenciadas por grado, alineada a la NEM."
			: "Planeaciones de " + gradoNum + "° grado alineadas a la Nueva Escuela Mexicana.";

		var acento = esMulti ? "bg-blue-900" : "bg-emerald-600";
		var b = "";
		b += '<span class="inline-flex items-center ' + acento + ' text-white text-xs font-semibold px-2.5 py-1 rounded-full">' + esc(esMulti ? comboDisplay() + " multigrado" : gradoNum + "° grado") + "</span>";
		if (esMulti) {
			b += '<span class="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full">' + (info.modalidad === "bidocente" ? "Bidocente" : "Tridocente") + "</span>";
		}
		badgesEl.innerHTML = b;
	}

	function renderSelector() {
		selectorEl.innerHTML = productos.map(function (p) {
			return '<button data-prod="' + esc(p.id) + '" class="opt border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-sm font-semibold px-4 py-2.5 rounded-xl transition min-h-[44px]">' + esc(etiquetaOpcion(p)) + "</button>";
		}).join("");
		selectorEl.querySelectorAll("[data-prod]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var p = productos.find(function (x) { return String(x.id) === btn.getAttribute("data-prod"); });
				if (p) { seleccionar(p); }
			});
		});
	}

	function seleccionar(p) {
		seleccionado = p;
		// Estilo del selector.
		selectorEl.querySelectorAll(".opt").forEach(function (b) {
			var on = b.getAttribute("data-prod") === String(p.id);
			b.classList.toggle("border-emerald-600", on);
			b.classList.toggle("bg-emerald-600", on);
			b.classList.toggle("text-white", on);
			b.classList.toggle("text-gray-700", !on);
			b.classList.toggle("bg-white", !on);
			b.classList.toggle("border-gray-300", !on);
		});
		renderMeta();
		renderOpciones();
		renderPreview();
		cargarIncluye();
	}

	function renderMeta() {
		var p = seleccionado;
		var esCiclo = p.tipo_paquete === "ciclo";
		var meta = [
			[esMulti ? "Aula multigrado" : "Grado", comboDisplay()],
			["Contenido", esCiclo ? "Ciclo completo (3 trimestres)" : "Trimestre " + p.trimestre],
			["Proyectos", String(p.num_proyectos || (esCiclo ? 12 : 4))],
			["Incluye", "Planeación + anexos + examen"],
		];
		metaEl.innerHTML = meta.map(function (m) {
			return '<div><dt class="text-xs text-gray-400 uppercase tracking-wide">' + esc(m[0]) + "</dt>" +
				'<dd class="font-semibold text-gray-700">' + esc(m[1]) + "</dd></div>";
		}).join("");
	}

	function renderOpciones() {
		var p = seleccionado;
		var acc = accesosPorProd[p.id] || {};
		var html = "";
		if (p.precio_pdf != null) {
			html += filaOpcion({ tipo: "pdf", nombre: "Versión PDF", detalle: "Lista para imprimir, con pie de página de tu compra. Incluye anexos y examen.", precio: p.precio_pdf, comprado: !!acc.pdf, prod: p });
		}
		if (p.precio_editable != null) {
			html += filaOpcion({ tipo: "editable", nombre: "Versión editable (Word)", detalle: "Personalízala a tu grupo. Incluye también el PDF, anexos y examen.", precio: p.precio_editable, comprado: !!acc.editable, prod: p });
		}
		if (!html) { html = '<p class="text-gray-400 text-sm">Esta opción aún no tiene precios.</p>'; }
		opcionesEl.innerHTML = html;

		opcionesEl.querySelectorAll("[data-comprar]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				location.href = "checkout.html?producto_id=" + encodeURIComponent(btn.getAttribute("data-pid")) + "&tipo=" + btn.getAttribute("data-comprar");
			});
		});
		opcionesEl.querySelectorAll("[data-descargar]").forEach(function (btn) {
			btn.addEventListener("click", function () { location.href = "mis-compras.html"; });
		});
	}

	function filaOpcion(o) {
		var precioTxt = money(o.precio);
		var accion = o.comprado
			? '<button data-descargar="1" class="shrink-0 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition min-h-[44px]">Ya lo tienes → Abrir</button>'
			: '<button data-comprar="' + o.tipo + '" data-pid="' + esc(o.prod.id) + '" class="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition min-h-[44px]">Comprar ' + precioTxt + "</button>";
		return (
			'<div class="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-4">' +
			'<div class="min-w-0">' +
			'<p class="font-semibold text-gray-800 text-sm">' + esc(o.nombre) + "</p>" +
			'<p class="text-xs text-gray-500 mt-0.5">' + esc(o.detalle) + "</p>" +
			"</div>" + accion + "</div>"
		);
	}

	function renderPreview() {
		previewFrame.classList.remove("hidden");
		previewVacio.classList.add("hidden");
		previewFrame.src = Tienda.EDGE_BASE + "/previsualizar?producto_id=" + encodeURIComponent(seleccionado.id);
		previewFrame.onerror = function () {
			previewFrame.classList.add("hidden");
			previewVacio.classList.remove("hidden");
		};
	}

	async function cargarIncluye() {
		var p = seleccionado;
		var esCiclo = p.tipo_paquete === "ciclo";
		var qd = window.sb
			.from("dosificacion_proyectos")
			.select("nombre_proyecto, trimestre, grados")
			.order("trimestre", { ascending: true });
		comboArr.forEach(function (gr) { qd = qd.contains("grados", [gr]); });
		if (!esCiclo) { qd = qd.eq("trimestre", p.trimestre); }

		var r = await qd;
		if (r.error || !r.data) { incluyeWrap.classList.add("hidden"); return; }
		// Mantener solo los de la combinación exacta (longitud de grados igual).
		var filas = r.data.filter(function (d) { return (d.grados || []).length === comboArr.length; });
		if (!filas.length) { incluyeWrap.classList.add("hidden"); return; }

		incluyeLista.innerHTML = filas.map(function (d) {
			var t = esCiclo && d.trimestre ? '<span class="text-xs text-gray-400">T' + esc(d.trimestre) + "</span> " : "";
			return '<li class="flex items-start gap-2">' +
				'<i data-lucide="check" class="w-4 h-4 text-emerald-600 mt-0.5 shrink-0"></i>' +
				'<span>' + t + esc(d.nombre_proyecto || "Proyecto") + "</span></li>";
		}).join("");
		incluyeWrap.classList.remove("hidden");
		Tienda.iconos();
	}
});
