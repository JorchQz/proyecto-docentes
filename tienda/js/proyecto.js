// Ficha de un proyecto individual: proyecto.html?id=<uuid de marketplace_productos>
//
// Los datos vienen de la RPC pública marketplace_proyectos_publicos(p_id):
// producto + proyecto del bot + sus PDAs. Un proyecto no publicado devuelve
// vacío aunque se conozca el id.
document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	await Tienda.montarNav("");
	Tienda.montarFooter();
	var esc = Tienda.esc;
	var money = Tienda.formatMoney;

	var estadoEl = document.getElementById("estado");
	var contenidoEl = document.getElementById("contenido");
	var badgesEl = document.getElementById("badges");
	var tituloEl = document.getElementById("titulo");
	var descripcionEl = document.getElementById("descripcion");
	var metaEl = document.getElementById("meta");
	var opcionesEl = document.getElementById("opciones");
	var comprarBtn = document.getElementById("comprarBtn");
	var comprarTexto = document.getElementById("comprarTexto");
	var notaPromo = document.getElementById("notaPromo");
	var temarioWrap = document.getElementById("temarioWrap");
	var temarioEl = document.getElementById("temario");
	var temarioNota = document.getElementById("temarioNota");
	var linkPaquete = document.getElementById("linkPaquete");

	var id = new URLSearchParams(location.search).get("id");
	if (!id) { estadoEl.textContent = "Proyecto no encontrado."; return; }

	var resultados = await Promise.all([
		window.sb.rpc("marketplace_proyectos_publicos", { p_id: id }),
		Tienda.cargarPromo(),
	]);
	var res = resultados[0];
	if (res.error || !res.data || !res.data.length) {
		estadoEl.innerHTML =
			'<p class="font-semibold text-ink">Este proyecto no está disponible.</p>' +
			'<a href="catalogo.html?vista=proyectos" class="inline-block mt-3 text-sm font-semibold" style="color:#1e3a8a">Ver los proyectos individuales</a>';
		return;
	}
	var p = res.data[0];
	var corto = window.CamposFormativos ? window.CamposFormativos.corto : function (x) { return x; };
	var pdas = (p.pdas || []).map(function (x) {
		return { cf: corto(x.cf) || null, grado: x.grado, contenido_id: x.contenido_id, contenido: x.contenido, pda_id: x.pda_id, pda: x.pda };
	});
	var esMulti = p.organizacion === "multigrado";
	var nombre = p.nombre_proyecto || p.titulo;
	var aula = esMulti ? "Multigrado " + comboDisplay(p.grados_combo) : p.grado + "° de Primaria";

	document.title = nombre + " · " + aula + " — Jissez";
	document.getElementById("breadcrumbNombre").textContent = nombre;

	// ── Encabezado ────────────────────────────────────────────────────────────
	var gc = Tienda.GRADO_COLOR[String(p.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
	var badges = [];
	badges.push(esMulti
		? '<span class="h-8 px-3 rounded-lg text-sm font-black inline-flex items-center" style="background:#1e3a8a;color:#fff">' + esc(comboDisplay(p.grados_combo)) + "</span>"
		: '<span class="h-8 px-3 rounded-lg text-sm font-black inline-flex items-center" style="background:' + gc.bg + ";color:" + gc.txt + '">' + esc(p.grado) + "° grado</span>");
	if (p.trimestre) { badges.push(chipGris("Trimestre " + p.trimestre)); }
	if (p.numero_proyecto) { badges.push(chipGris("Proyecto " + p.numero_proyecto)); }
	badges.push('<span class="h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center" style="background:rgba(5,150,105,.1);color:#047857">Proyecto individual</span>');
	badgesEl.innerHTML = badges.join("");
	tituloEl.textContent = nombre;
	descripcionEl.textContent = p.descripcion ||
		("Un proyecto completo de " + aula.toLowerCase() + " con su planeación en PDF y en Word editable" +
		(p.num_sesiones_estimadas ? ", " + p.num_sesiones_estimadas + " sesiones" : "") +
		", listo para adaptarlo a tu grupo.");

	// ── Datos ──────────────────────────────────────────────────────────────────
	var cfs = {};
	pdas.forEach(function (x) { if (x.cf) { cfs[x.cf] = true; } });
	var cfsOrdenados = Tienda.CF_ORDEN.filter(function (cf) { return cfs[cf]; });
	var meta = [];
	if (p.metodologia) { meta.push(["Metodología", p.metodologia]); }
	if (p.num_sesiones_estimadas) { meta.push(["Sesiones", p.num_sesiones_estimadas + " sesiones"]); }
	if (p.escenario) { meta.push(["Escenario", p.escenario]); }
	meta.push(["Formato", "PDF + Word editable"]);
	metaEl.innerHTML = meta.map(function (m) {
		return '<div class="bg-white rounded-xl border border-line p-3"><dt class="text-[11px] font-bold uppercase tracking-[0.1em] text-mute">' + esc(m[0]) + '</dt><dd class="mt-1 font-semibold text-ink">' + esc(m[1]) + "</dd></div>";
	}).join("") +
		(cfsOrdenados.length
			? '<div class="col-span-2 bg-white rounded-xl border border-line p-3"><dt class="text-[11px] font-bold uppercase tracking-[0.1em] text-mute">Campos formativos</dt><dd class="mt-2 flex flex-wrap gap-1.5">' +
				cfsOrdenados.map(function (cf) { return Tienda.chipCF(cf, { largo: true }); }).join("") + "</dd></div>"
			: "");

	// ── Versiones y compra ─────────────────────────────────────────────────────
	// La versión con anexos solo se ofrece si el proyecto los tiene
	// (tiene_anexos false = verificado en Drive sin subcarpetas).
	var ofreceAnexos = p.precio_pdf_con_anexos != null && p.tiene_anexos !== false;
	var tipoElegido = ofreceAnexos ? "anexos" : "pdf";
	function renderOpciones() {
		var opciones = [
			{ tipo: "pdf", titulo: ofreceAnexos ? "Sin anexos" : "Planeación completa", sub: "Planeación completa en PDF y Word" + (ofreceAnexos ? "" : " · este proyecto no incluye anexos imprimibles"), precio: p.precio_pdf },
			{ tipo: "anexos", titulo: "Con anexos", sub: "Planeación en PDF y Word + anexos imprimibles por sesión", precio: ofreceAnexos ? p.precio_pdf_con_anexos : null },
		].filter(function (o) { return o.precio != null; });
		opcionesEl.innerHTML = opciones.map(function (o) {
			return Tienda.opcionVersion({ valor: o.tipo, titulo: o.titulo, sub: o.sub, precio: o.precio }, o.tipo === tipoElegido);
		}).join("");
		opcionesEl.querySelectorAll("[data-opcion]").forEach(function (b) {
			b.addEventListener("click", function () { tipoElegido = b.getAttribute("data-opcion"); renderOpciones(); });
		});
		var precio = tipoElegido === "anexos" ? p.precio_pdf_con_anexos : p.precio_pdf;
		comprarTexto.textContent = "Continuar al pago · " + money(Tienda.precioFinal(precio));
		if (Tienda.promoActiva()) {
			var hasta = Tienda.promoFechaLimite();
			notaPromo.textContent = "-" + Tienda.promoInfo().porcentaje + "% aplicado" + (hasta ? " · termina el " + hasta : "");
			notaPromo.classList.remove("hidden");
		}
	}
	renderOpciones();
	comprarBtn.addEventListener("click", function () {
		location.href = "checkout.html?producto_id=" + encodeURIComponent(p.id) + "&tipo=" + tipoElegido;
	});

	// ── Temario ────────────────────────────────────────────────────────────────
	if (pdas.length) {
		var porCampo = {};
		pdas.forEach(function (x) {
			var cf = x.cf || "OTRO";
			if (!porCampo[cf]) { porCampo[cf] = {}; }
			var c = porCampo[cf];
			var k = x.contenido_id || x.contenido;
			if (!c[k]) { c[k] = { contenido: x.contenido, pdas: [] }; }
			c[k].pdas.push(x);
		});
		var orden = Tienda.CF_ORDEN.concat(["OTRO"]).filter(function (cf) { return porCampo[cf]; });
		var nContenidos = 0;
		temarioEl.innerHTML = orden.map(function (cf, i) {
			var color = Tienda.CF_COLOR[cf] || { nombre: "Otros", hex: "#5b6473" };
			var contenidos = Object.keys(porCampo[cf]).map(function (k) { return porCampo[cf][k]; });
			nContenidos += contenidos.length;
			return '<details class="rounded-2xl border border-line overflow-hidden"' + (i === 0 ? " open" : "") + ">" +
				'<summary class="flex items-center justify-between gap-3 px-4 py-3 font-semibold text-ink" style="background:' + color.hex + '0d">' +
				'<span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" style="background:' + color.hex + '"></span>' + esc(color.nombre) +
				'<span class="text-[12px] font-semibold text-mute">· ' + contenidos.length + (contenidos.length === 1 ? " contenido" : " contenidos") + "</span></span>" +
				'<i data-lucide="plus" class="faq-plus w-5 h-5 shrink-0" style="color:' + color.hex + '"></i></summary>' +
				'<div class="px-4 pb-4 pt-2 flex flex-col gap-3">' +
				contenidos.map(function (c) {
					return '<div><p class="font-semibold text-[15px] text-ink leading-snug">' + esc(c.contenido) + "</p>" +
						'<ul class="mt-1.5 flex flex-col gap-1">' + c.pdas.map(function (x) {
							return '<li class="text-[13px] text-mute leading-snug flex gap-2"><span class="shrink-0 font-semibold" style="color:' + color.hex + '">' + (x.grado ? esc(x.grado) + "°" : "•") + "</span><span>" + esc(x.pda) + "</span></li>";
						}).join("") + "</ul></div>";
				}).join("") +
				"</div></details>";
		}).join("");
		temarioNota.textContent = nContenidos + " contenidos del programa y " + pdas.length + " procesos de desarrollo de aprendizaje (PDA)" + (esMulti ? ", diferenciados por grado." : ".");
		temarioWrap.classList.remove("hidden");
	}

	// ── Puente al paquete del trimestre ───────────────────────────────────────
	if (p.trimestre) {
		var q = window.sb.from("marketplace_productos")
			.select("id, precio_pdf")
			.eq("activo", true).eq("tipo_paquete", "trimestre").eq("trimestre", p.trimestre)
			.eq("organizacion", p.organizacion);
		q = esMulti ? q.eq("grados_combo", p.grados_combo) : q.eq("grado", p.grado);
		q.maybeSingle().then(function (r) {
			if (r.error || !r.data) { return; }
			linkPaquete.href = esMulti
				? "producto.html?org=multigrado&combo=" + encodeURIComponent(p.grados_combo)
				: "producto.html?org=completa&g=" + encodeURIComponent(p.grado);
			document.getElementById("linkPaqueteSub").textContent =
				"Trimestre " + p.trimestre + " completo, con examen, desde " + money(Tienda.precioFinal(r.data.precio_pdf)) + ".";
			linkPaquete.classList.remove("hidden");
			linkPaquete.classList.add("flex");
			Tienda.iconos();
		});
	}

	// ── Mostrar ────────────────────────────────────────────────────────────────
	estadoEl.classList.add("hidden");
	contenidoEl.classList.remove("hidden");
	var infoExtra = document.getElementById("infoExtra");
	infoExtra.classList.remove("hidden");
	infoExtra.classList.add("flex");
	Tienda.iconos();

	// ── Vista previa de ESTE proyecto ──────────────────────────────────────────
	// Primero las imágenes de `previews/proyecto-<id>/` (las genera el admin a
	// partir de la muestra; pesan poco y se ven al instante). Si aún no existen,
	// el PDF recortado de `previsualizar` como respaldo.
	var previewFrame = document.getElementById("previewFrame");
	var previewVacio = document.getElementById("previewVacio");
	var previewCargando = document.getElementById("previewCargando");
	var previewLabel = document.getElementById("previewLabel");
	var galeriaEl = document.getElementById("galeria");
	var galeriaImg = document.getElementById("galeriaImg");
	var galeriaTiras = document.getElementById("galeriaTiras");
	var galeriaEtiqueta = document.getElementById("galeriaEtiqueta");
	var galeriaContador = document.getElementById("galeriaContador");
	var imagenes = [];
	var imgActual = 0;

	async function cargarImagenes() {
		try {
			var carpeta = "previews/proyecto-" + p.id;
			var r = await window.sb.storage.from("assets").list(carpeta, { limit: 30, sortBy: { column: "name", order: "asc" } });
			if (r.error || !r.data) { return []; }
			return r.data
				.filter(function (f) { return f.name && /\.(jpe?g|png|webp)$/i.test(f.name); })
				.map(function (f, i) {
					return {
						nombre: f.name,
						etiqueta: "Planeación · página " + (i + 1),
						url: window.sb.storage.from("assets").getPublicUrl(carpeta + "/" + f.name).data.publicUrl,
					};
				});
		} catch (_) { return []; }
	}

	function irA(i) {
		if (!imagenes.length) { return; }
		imgActual = (i + imagenes.length) % imagenes.length;
		var im = imagenes[imgActual];
		galeriaImg.src = im.url;
		galeriaEtiqueta.textContent = im.etiqueta;
		galeriaContador.textContent = (imgActual + 1) + " / " + imagenes.length;
		galeriaTiras.querySelectorAll("[data-tira]").forEach(function (b) {
			b.style.borderColor = Number(b.getAttribute("data-tira")) === imgActual ? "#1e3a8a" : "#e7e6df";
		});
	}

	function mostrarGaleria() {
		previewCargando.classList.add("hidden");
		previewFrame.classList.add("hidden");
		galeriaEl.classList.remove("hidden");
		galeriaEl.classList.add("flex");
		previewLabel.textContent = "Vista previa · " + imagenes.length + " páginas de muestra";
		galeriaTiras.innerHTML = imagenes.map(function (im, i) {
			return '<button type="button" data-tira="' + i + '" class="shrink-0 w-16 h-20 rounded-lg overflow-hidden border-2 transition" style="border-color:' + (i === 0 ? "#1e3a8a" : "#e7e6df") + '">' +
				'<img src="' + esc(im.url) + '" alt="" class="w-full h-full object-cover" loading="lazy">' +
				"</button>";
		}).join("");
		galeriaTiras.classList.remove("hidden");
		galeriaTiras.classList.add("flex");
		galeriaTiras.querySelectorAll("[data-tira]").forEach(function (b) {
			b.addEventListener("click", function () { irA(Number(b.getAttribute("data-tira"))); });
		});
		var prev = document.getElementById("galeriaPrev");
		var next = document.getElementById("galeriaNext");
		prev.addEventListener("click", function () { irA(imgActual - 1); });
		next.addEventListener("click", function () { irA(imgActual + 1); });
		document.addEventListener("keydown", function (e) {
			if (Tienda.visorAbierto && Tienda.visorAbierto()) { return; }
			if (e.key === "ArrowLeft") { irA(imgActual - 1); }
			if (e.key === "ArrowRight") { irA(imgActual + 1); }
		});
		var soloUna = imagenes.length < 2;
		prev.classList.toggle("hidden", soloUna);
		next.classList.toggle("hidden", soloUna);
		if (!soloUna && Tienda.flechasFugaces) { Tienda.flechasFugaces(galeriaEl, [prev, next], true); }

		// Ampliar (visor común con zoom) y deslizar en táctil.
		var galToque = null, galDeslizo = false;
		function abrirLightbox() {
			if (!imagenes.length || galDeslizo || !Tienda.visorAbrir) { return; }
			Tienda.visorAbrir(imagenes, imgActual, function (i) { if (i !== imgActual) { irA(i); } });
		}
		galeriaImg.addEventListener("click", abrirLightbox);
		document.getElementById("galeriaAmpliar").addEventListener("click", abrirLightbox);
		galeriaEl.addEventListener("touchstart", function (e) {
			galToque = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
		}, { passive: true });
		galeriaEl.addEventListener("touchend", function (e) {
			if (!galToque) { return; }
			var dx = e.changedTouches[0].clientX - galToque.x;
			var dy = e.changedTouches[0].clientY - galToque.y;
			galToque = null;
			if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				galDeslizo = true;
				irA(dx < 0 ? imgActual + 1 : imgActual - 1);
				setTimeout(function () { galDeslizo = false; }, 400);
			}
		}, { passive: true });
		irA(0);
		Tienda.iconos();
	}

	async function mostrarPdf() {
		try {
			var resp = await fetch(Tienda.EDGE_BASE + "/previsualizar?producto_id=" + encodeURIComponent(p.id));
			var tipo = resp.headers.get("content-type") || "";
			if (!resp.ok || tipo.indexOf("application/pdf") === -1) { throw new Error("sin muestra"); }
			var blob = await resp.blob();
			previewFrame.src = URL.createObjectURL(blob) + "#toolbar=0&view=FitH";
			previewCargando.classList.add("hidden");
			previewFrame.classList.remove("hidden");
		} catch (_) {
			previewCargando.classList.add("hidden");
			previewVacio.classList.remove("hidden");
			previewVacio.classList.add("flex");
			Tienda.iconos();
		}
	}

	imagenes = await cargarImagenes();
	if (imagenes.length) { mostrarGaleria(); } else { await mostrarPdf(); }

	function chipGris(texto) {
		return '<span class="h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center bg-paper border border-line text-mute">' + esc(texto) + "</span>";
	}
	function comboDisplay(combo) {
		return (combo || "").split("-").map(function (n) { return n + "°"; }).join("-");
	}
});
