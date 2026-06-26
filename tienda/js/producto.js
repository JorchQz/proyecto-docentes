document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("");
	Tienda.montarFooter();
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
	var previewCargando = document.getElementById("previewCargando");
	var previewLabel = document.getElementById("previewLabel");
	var previewBlobUrl = null;
	var previewReqId = 0;
	var incluyeWrap = document.getElementById("incluyeWrap");
	var incluyeLista = document.getElementById("incluyeLista");

	var params = new URLSearchParams(location.search);
	var org = params.get("org") || "completa";
	var g = params.get("g");
	var combo = params.get("combo");
	var esMulti = org === "multigrado";

	var GRADO_COLOR = { "1":"#f2cf6b","2":"#ef9277","3":"#79c8a6","4":"#a99fe0","5":"#85b8e6","6":"#f0b285" };
	var GRADO_TXT = { "1":"rgba(30,58,138,.85)","2":"#fff","3":"rgba(30,58,138,.85)","4":"#fff","5":"rgba(30,58,138,.85)","6":"rgba(30,58,138,.85)" };

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
	var infoExtra = document.getElementById("infoExtra");
	if (infoExtra) { infoExtra.classList.remove("hidden"); Tienda.iconos(); }

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

		// Actualizar breadcrumb
		var bc = document.getElementById("breadcrumbNombre");
		if (bc) { bc.textContent = tituloGrupo; }

		var b = "";
		if (!esMulti) {
			var gc = GRADO_COLOR[String(gradoNum)] || "#e7e6df";
			var gt = GRADO_TXT[String(gradoNum)] || "#1c2434";
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:' + gc + ';color:' + gt + '">' +
				'<span class="w-5 h-5 rounded-md text-[11px] font-black flex items-center justify-center" style="background:' + gc + ';color:' + gt + '">' + esc(gradoNum) + '°</span>' +
				gradoNum + '° grado</span>';
		} else {
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:rgba(30,58,138,.1);color:#1e3a8a">' + esc(comboDisplay() + " multigrado") + '</span>';
		}
		b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold" style="background:rgba(30,58,138,.08);color:#1e3a8a"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Alineado a la NEM</span>';
		if (esMulti) {
			b += '<span class="inline-flex items-center h-8 px-3 rounded-full text-[13px]" style="background:#f1f0ea;color:#5b6473">' + (info.modalidad === "bidocente" ? "Bidocente" : "Tridocente") + "</span>";
		}
		badgesEl.innerHTML = b;
		Tienda.iconos();
	}

	function renderSelector() {
		selectorEl.innerHTML = productos.map(function (p) {
			return '<button data-prod="' + esc(p.id) + '" class="opt-btn border border-line text-ink bg-white text-sm font-semibold h-10 px-4 rounded-xl transition">' + esc(etiquetaOpcion(p)) + "</button>";
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
		selectorEl.querySelectorAll(".opt-btn").forEach(function (b) {
			var on = b.getAttribute("data-prod") === String(p.id);
			if (on) { b.classList.add("selected"); } else { b.classList.remove("selected"); }
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
			return '<div><dt class="text-[11px] font-bold uppercase tracking-[0.1em]" style="color:#5b6473">' + esc(m[0]) + "</dt>" +
				'<dd class="font-semibold mt-0.5" style="color:#1c2434">' + esc(m[1]) + "</dd></div>";
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
			? '<button data-descargar="1" class="shrink-0 h-11 px-4 rounded-xl text-sm font-semibold text-white transition" style="background:#1e3a8a">Ya lo tienes — Abrir</button>'
			: '<button data-comprar="' + o.tipo + '" data-pid="' + esc(o.prod.id) + '" class="shrink-0 h-11 px-5 rounded-xl text-sm font-bold text-white transition" style="background:#059669">Comprar ' + precioTxt + "</button>";
		return (
			'<div class="flex items-center justify-between gap-3 bg-white border rounded-2xl p-4" style="border-color:#e7e6df">' +
			'<div class="min-w-0">' +
			'<p class="font-semibold text-sm" style="color:#1c2434">' + esc(o.nombre) + "</p>" +
			'<p class="text-xs mt-0.5" style="color:#5b6473">' + esc(o.detalle) + "</p>" +
			"</div>" + accion + "</div>"
		);
	}

	function previewEstado(estado) {
		// estado: "cargando" | "ok" | "vacio"
		previewCargando.classList.toggle("hidden", estado !== "cargando");
		previewVacio.classList.toggle("hidden", estado !== "vacio");
		previewFrame.classList.toggle("hidden", estado !== "ok");
	}

	async function renderPreview() {
		var p = seleccionado;
		var esCiclo = p.tipo_paquete === "ciclo";
		previewLabel.textContent = "Primeras páginas · " +
			(esCiclo ? "Ciclo completo" : "Trimestre " + p.trimestre) + " · " + comboDisplay();

		var reqId = ++previewReqId;
		previewEstado("cargando");
		liberarPreviewBlob();

		try {
			var resp = await fetch(Tienda.EDGE_BASE + "/previsualizar?producto_id=" + encodeURIComponent(p.id));
			if (reqId !== previewReqId) { return; } // se seleccionó otro paquete entretanto
			var tipo = resp.headers.get("content-type") || "";
			if (!resp.ok || tipo.indexOf("application/pdf") === -1) {
				previewEstado("vacio");
				return;
			}
			var blob = await resp.blob();
			if (reqId !== previewReqId) { return; }
			previewBlobUrl = URL.createObjectURL(blob);
			// #toolbar=0 oculta los controles del visor; el marco propio ya da contexto.
			previewFrame.src = previewBlobUrl + "#toolbar=0&view=FitH";
			previewEstado("ok");
		} catch (_) {
			if (reqId !== previewReqId) { return; }
			previewEstado("vacio");
		}
	}

	function liberarPreviewBlob() {
		if (previewBlobUrl) {
			URL.revokeObjectURL(previewBlobUrl);
			previewBlobUrl = null;
		}
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
			var t = esCiclo && d.trimestre ? '<span class="text-[11px]" style="color:#5b6473">T' + esc(d.trimestre) + " · </span>" : "";
			return '<li class="flex items-start gap-2">' +
				'<i data-lucide="check" class="w-4 h-4 mt-0.5 shrink-0" style="color:#059669"></i>' +
				'<span>' + t + esc(d.nombre_proyecto || "Proyecto") + "</span></li>";
		}).join("");
		incluyeWrap.classList.remove("hidden");
		Tienda.iconos();
	}
});
