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
	var incluyeWrap = document.getElementById("incluyeWrap");
	var incluyeLista = document.getElementById("incluyeLista");
	var precioMinimo = null; // el "desde" que calcula renderPrecios(); lo reusa la barra móvil

	var params = new URLSearchParams(location.search);
	var org = params.get("org") || "completa";
	var g = params.get("g");
	var combo = params.get("combo");

	// Tolerancia a enlaces del tipo `producto.html?id=<uuid>`: la página se
	// identifica por grado o combinación, no por producto, así que se resuelve
	// el id a sus coordenadas en vez de mostrar "no está disponible".
	var idSuelto = params.get("id");
	if (idSuelto && !g && !combo) {
		var refRes = await window.sb
			.from("marketplace_productos")
			.select("organizacion, grado, grados_combo")
			.eq("id", idSuelto)
			.maybeSingle();
		if (refRes.data) {
			org = refRes.data.organizacion || "completa";
			g = refRes.data.grado;
			combo = refRes.data.grados_combo;
		}
	}

	var esMulti = org === "multigrado";

	// Ficha del paquete unitario (el combo para quien atiende los 6 grados).
	// No existe como producto en la base —el precio vive en el tarifario y la
	// orden la arma crear-preferencia-mp—, así que se pinta con su propio
	// flujo y el normal ni se inicia.
	if (esMulti && combo === "unitaria") {
		await flujoUnitaria();
		return;
	}

	var GRADO_COLOR = { "1":"#f2cf6b","2":"#ef9277","3":"#79c8a6","4":"#a99fe0","5":"#85b8e6","6":"#f0b285" };
	var GRADO_TXT = { "1":"rgba(30,58,138,.85)","2":"#fff","3":"rgba(30,58,138,.85)","4":"#fff","5":"rgba(30,58,138,.85)","6":"rgba(30,58,138,.85)" };

	// Todas las variantes del grado o de la combinación multigrado.
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

	// Qué ha comprado ya el usuario, para no ofrecérselo otra vez.
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

	renderHeader();
	renderMeta(productoPorDefecto());
	renderPrecios();
	cargarIncluye();

	estadoEl.classList.add("hidden");
	contenidoEl.classList.remove("hidden");
	var infoExtra = document.getElementById("infoExtra");
	if (infoExtra) { infoExtra.classList.remove("hidden"); }
	Tienda.iconos();

	// La vista previa se carga AL FINAL del archivo, no aquí: necesita las
	// variables que se declaran más abajo y, si se llama antes, revienta y se
	// lleva por delante el registro de los botones de compra.

	// ── Helpers de datos ──────────────────────────────────────────────────────
	function ordenOpcion(p) { return p.tipo_paquete === "ciclo" ? 4 : (p.trimestre || 0); }
	function comboDisplay() {
		return esMulti
			? comboArr.map(function (n) { return n + "°"; }).join("-")
			: gradoNum + "°";
	}
	function etiquetaOpcion(p) {
		return p.tipo_paquete === "ciclo" ? "Ciclo completo" : "Trimestre " + p.trimestre;
	}
	function elCiclo() {
		return productos.find(function (p) { return p.tipo_paquete === "ciclo"; }) || null;
	}
	function losTrimestres() {
		return productos.filter(function (p) { return p.tipo_paquete === "trimestre"; });
	}
	/** Lo que costaría comprar los trimestres sueltos en vez del ciclo. */
	function ahorroDelCiclo() {
		var ciclo = elCiclo();
		var tris = losTrimestres();
		if (!ciclo || tris.length < 2 || ciclo.precio_pdf == null) { return 0; }
		var suelto = tris.reduce(function (t, p) { return t + Number(p.precio_pdf || 0); }, 0);
		var dif = suelto - Number(ciclo.precio_pdf);
		return dif > 0 ? dif : 0;
	}
	function productoPorDefecto() { return elCiclo() || productos[0]; }
	function montoCorto(n) {
		var num = Number(n || 0);
		return "$" + num.toLocaleString("es-MX", {
			minimumFractionDigits: num % 1 === 0 ? 0 : 2,
			maximumFractionDigits: 2,
		});
	}

	// ── Cabecera y datos ──────────────────────────────────────────────────────
	function renderHeader() {
		// "Primaria" se conserva en el titulo de las dos variantes: es la palabra
		// con la que busca un maestro, y "1° grado" a secas se confunde con
		// secundaria. El breadcrumb usa la version corta, que en el celular ya va
		// justo de ancho.
		var nombreCorto = esMulti ? "Multigrado " + comboDisplay() : gradoNum + "° Primaria";
		var tituloPagina = esMulti
			? "Multigrado " + comboDisplay() + " de Primaria"
			: gradoNum + "° de Primaria";

		tituloEl.textContent = tituloPagina;
		// La descripción decía otra vez el grado y otra vez la NEM, que ya están
		// en el título y en el badge. Aquí se aprovecha para contar algo nuevo.
		descripcionEl.textContent = esMulti
			? "Un mismo proyecto para toda el aula, con actividades y anexos diferenciados para cada grado."
			: "Proyectos completos con PDAs, actividades y anexos por sesión, listos para llevar al salón.";

		// Las 11 fichas compartían el título "Planeación — Jissez", así que en
		// Google y en las pestañas eran indistinguibles.
		document.title = "Planeaciones " + tituloPagina + " — Jissez";

		var bc = document.getElementById("breadcrumbNombre");
		if (bc) { bc.textContent = nombreCorto; }

		// El badge lleva solo el grado, sin la palabra: el título ya la dice. Lo
		// que aporta es el color, que enlaza con la tarjeta del catálogo.
		var b = "";
		if (!esMulti) {
			var gc = GRADO_COLOR[String(gradoNum)] || "#e7e6df";
			var gt = GRADO_TXT[String(gradoNum)] || "#1c2434";
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:' + gc + ';color:' + gt + '">' +
				gradoNum + '°</span>';
		} else {
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:rgba(30,58,138,.1);color:#1e3a8a">' + esc(comboDisplay()) + '</span>';
		}
		b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold" style="background:rgba(30,58,138,.08);color:#1e3a8a"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Alineado a la NEM</span>';
		// Sin etiqueta si la modalidad no es una de las dos conocidas, en vez de
		// caer en "Tridocente" por descarte.
		var modalidad = info.modalidad === "bidocente" ? "Bidocente"
			: info.modalidad === "tridocente" ? "Tridocente" : "";
		if (esMulti && modalidad) {
			b += '<span class="inline-flex items-center h-8 px-3 rounded-full text-[13px]" style="background:#f1f0ea;color:#5b6473">' + modalidad + "</span>";
		}
		badgesEl.innerHTML = b;
	}

	function renderMeta(p) {
		var esCiclo = p.tipo_paquete === "ciclo";
		// El aula/grado no se repite aquí: ya está en el badge y en el título,
		// y en móvil este bloque va antes de la galería. En su lugar, el formato,
		// que sí pesa en la decisión y no aparece en ningún otro dato.
		var hayEditable = productos.some(function (x) { return x.precio_editable != null; });
		var meta = [
			["Formato", hayEditable ? "PDF o PDF + Word editable" : "PDF listo para imprimir"],
			["Disponible por", losTrimestres().length ? "Trimestre o ciclo completo" : etiquetaOpcion(p)],
			["Proyectos", esCiclo ? String(p.num_proyectos || 12) + " en el ciclo" : String(p.num_proyectos || 4) + " por trimestre"],
			["Incluye", "Planeación + anexos + examen"],
		];
		metaEl.innerHTML = meta.map(function (m) {
			return '<div><dt class="text-[11px] font-bold uppercase tracking-[0.1em]" style="color:#5b6473">' + esc(m[0]) + "</dt>" +
				'<dd class="font-semibold mt-0.5" style="color:#1c2434">' + esc(m[1]) + "</dd></div>";
		}).join("");
	}

	function renderPrecios() {
		var precios = productos
			.map(function (p) { return p.precio_pdf; })
			.filter(function (v) { return v != null; })
			.map(Number);
		var minimo = precios.length ? Math.min.apply(null, precios) : null;
		precioMinimo = minimo;

		document.getElementById("precioDesde").textContent = minimo != null ? money(minimo) : "—";
		// Solo la unidad del precio. Que el ciclo salga mejor ya lo dice el badge
		// de al lado, y con la cifra exacta en vez de una vaguedad.
		document.getElementById("precioNota").textContent = losTrimestres().length
			? "por trimestre"
			: "pago único, sin caducidad";

		var ahorro = ahorroDelCiclo();
		var badge = document.getElementById("ahorroBadge");
		if (ahorro > 0) {
			badge.textContent = "Ahorras " + montoCorto(ahorro) + " con el ciclo";
			badge.classList.remove("hidden");
		}
	}

	// Los proyectos son lo más concreto de la ficha: aquí el maestro comprueba
	// de qué trata el material. Van agrupados por trimestre —y no en una lista
	// corrida— porque si no, no se entiende qué entra en cada paquete: un
	// trimestre trae cuatro, el ciclo los doce.
	async function cargarIncluye() {
		var qd = window.sb
			.from("dosificacion_proyectos")
			// La metodología y las sesiones estaban en la base sin usarse, y son
			// lo más concreto que puede leer el maestro antes de pagar: cuatro
			// proyectos de diez sesiones son más de cuarenta clases preparadas.
			.select("nombre_proyecto, trimestre, grados, numero_proyecto, metodologia, num_sesiones_estimadas")
			// numero_proyecto es continuo por grado (1-4 en T1, 5-8 en T2…),
			// que es el orden en que se enseñan.
			.order("numero_proyecto", { ascending: true });
		comboArr.forEach(function (gr) { qd = qd.contains("grados", [gr]); });

		var r = await qd;
		if (r.error || !r.data) { return; }
		var filas = r.data.filter(function (d) { return (d.grados || []).length === comboArr.length; });
		if (!filas.length) { return; }

		var porTrimestre = {};
		filas.forEach(function (d) {
			var t = d.trimestre || 0;
			(porTrimestre[t] = porTrimestre[t] || []).push(d);
		});

		var trimestres = Object.keys(porTrimestre).sort();
		incluyeLista.innerHTML = trimestres.map(function (t) {
			var proyectos = porTrimestre[t];
			// Las sesiones del trimestre, sumadas: convierte un precio abstracto
			// en algo medible frente a las tardes que cuesta prepararlas.
			var sesiones = proyectos.reduce(function (n, d) {
				return n + (Number(d.num_sesiones_estimadas) || 0);
			}, 0);

			// Una tarjeta desplegable por trimestre, idéntica a las preguntas
			// frecuentes: mismo borde, mismo redondeo y todas cerradas de inicio.
			// Dejar la primera abierta hacía que el primer toque cerrara en vez
			// de abrir, y el bloque saltaba hacia arriba.
			// El resumen no se pliega: las sesiones son el argumento que
			// justifica el precio y esconderlas sería tirarlo.
			return '<li>' +
				'<details class="bg-white border border-line rounded-2xl px-5">' +
				// Peso de contenido, no de etiqueta: en versalitas de 11px estas
				// filas parecían un rótulo y no invitaban a tocarlas, mientras
				// las preguntas —lo menos decisivo de la ficha— iban a 16px.
				'<summary class="flex items-center justify-between gap-4 py-4">' +
				'<span class="text-base font-semibold text-ink">Trimestre ' + esc(t) +
				'<span class="block text-[13px] font-normal text-mute mt-0.5">' +
				proyectos.length + " proyectos" +
				(sesiones ? " · " + sesiones + " sesiones" : "") + "</span></span>" +
				'<i data-lucide="plus" class="faq-plus w-5 h-5 shrink-0" style="color:#1e3a8a"></i>' +
				"</summary>" +
				'<ul class="flex flex-col gap-2.5 pb-5">' +
				proyectos.map(function (d) {
					// Metodología y sesiones bajo el título: sin ellas la lista es
					// solo nombres y no deja juzgar si el material tiene fondo.
					var detalle = [];
					if (d.metodologia) { detalle.push(esc(d.metodologia)); }
					if (d.num_sesiones_estimadas) { detalle.push(d.num_sesiones_estimadas + " sesiones"); }

					return '<li class="flex items-start gap-2">' +
						'<i data-lucide="check" class="w-4 h-4 mt-0.5 shrink-0" style="color:#059669"></i>' +
						'<span class="min-w-0">' + esc(d.nombre_proyecto || "Proyecto") +
						(detalle.length
							? '<span class="block text-[12px] text-mute mt-0.5">' + detalle.join(" · ") + "</span>"
							: "") +
						"</span></li>";
				}).join("") +
				"</ul></details></li>";
		}).join("");

		incluyeWrap.classList.remove("hidden");
		Tienda.iconos();
	}

	// ── Vista previa ──────────────────────────────────────────────────────────
	// Preferimos imágenes: cargan al instante desde el CDN y se ven bien en
	// móvil, donde el visor de PDF incrustado es incómodo. Si todavía no hay
	// imágenes subidas para este grado, se recurre al PDF recortado de siempre.
	var previewFrame = document.getElementById("previewFrame");
	var previewVacio = document.getElementById("previewVacio");
	var previewCargando = document.getElementById("previewCargando");
	var previewLabel = document.getElementById("previewLabel");
	var galeriaEl = document.getElementById("galeria");
	var galeriaImg = document.getElementById("galeriaImg");
	var galeriaTiras = document.getElementById("galeriaTiras");
	var galeriaEtiqueta = document.getElementById("galeriaEtiqueta");
	var galeriaContador = document.getElementById("galeriaContador");

	// Carpeta de imágenes de este grado o combinación.
	var SLUG = esMulti ? "multi-" + (info.grados_combo || "") : "grado-" + gradoNum;
	var imagenes = [];
	var imgActual = 0;

	function etiquetaDeArchivo(nombre) {
		var n = nombre.toLowerCase();
		if (n.indexOf("anexo") !== -1) { return "Anexo para el alumno"; }
		if (n.indexOf("examen") !== -1) { return "Examen del trimestre"; }
		if (n.indexOf("clave") !== -1) { return "Clave del maestro"; }
		return "Planeación";
	}

	async function cargarVistaPrevia() {
		try {
			var r = await window.sb.storage.from("assets").list("previews/" + SLUG, {
				limit: 60,
				sortBy: { column: "name", order: "asc" },
			});
			if (!r.error && r.data) {
				imagenes = r.data
					// El listado incluye un marcador de carpeta vacía; fuera.
					.filter(function (f) { return f.name && /\.(jpe?g|png|webp)$/i.test(f.name); })
					.map(function (f) {
						return {
							nombre: f.name,
							etiqueta: etiquetaDeArchivo(f.name),
							url: window.sb.storage.from("assets")
								.getPublicUrl("previews/" + SLUG + "/" + f.name).data.publicUrl,
						};
					});
			}
		} catch (_) {
			imagenes = [];
		}

		if (imagenes.length) { mostrarGaleria(); return; }
		await mostrarPdf();
	}

	function mostrarGaleria() {
		previewCargando.classList.add("hidden");
		previewVacio.classList.add("hidden");
		previewFrame.classList.add("hidden");
		galeriaEl.classList.remove("hidden");
		galeriaEl.classList.add("flex");

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
		document.getElementById("galeriaPrev").addEventListener("click", function () { irA(imgActual - 1); });
		document.getElementById("galeriaNext").addEventListener("click", function () { irA(imgActual + 1); });
		document.addEventListener("keydown", function (e) {
			if (document.getElementById("modalCompra").classList.contains("hidden")) {
				if (e.key === "ArrowLeft") { irA(imgActual - 1); }
				if (e.key === "ArrowRight") { irA(imgActual + 1); }
				if (e.key === "Escape" && !lightboxEl.classList.contains("hidden")) { cerrarLightbox(); }
			}
		});

		var soloUna = imagenes.length < 2;
		document.getElementById("galeriaPrev").classList.toggle("hidden", soloUna);
		document.getElementById("galeriaNext").classList.toggle("hidden", soloUna);

		irA(0);
		Tienda.iconos();
	}

	function irA(i) {
		if (!imagenes.length) { return; }
		imgActual = (i + imagenes.length) % imagenes.length;
		var im = imagenes[imgActual];
		galeriaImg.src = im.url;
		galeriaEtiqueta.textContent = im.etiqueta;
		galeriaContador.textContent = (imgActual + 1) + " / " + imagenes.length;
		previewLabel.textContent = "Vista previa · " + imagenes.length + " páginas de muestra";
		galeriaTiras.querySelectorAll("[data-tira]").forEach(function (b) {
			b.style.borderColor = Number(b.getAttribute("data-tira")) === imgActual ? "#1e3a8a" : "#e7e6df";
		});
		// Con el visor ampliado abierto, la página mostrada ahí sigue el mismo índice.
		if (!lightboxEl.classList.contains("hidden")) { lbSync(); }
	}

	async function mostrarPdf() {
		var p = productoPorDefecto();
		previewLabel.textContent = "Vista previa · primeras páginas";
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

	// ── Visor ampliado (lightbox) ─────────────────────────────────────────────
	// La galería cabe en una tarjeta y las páginas de muestra son tamaño carta:
	// el texto no se alcanza a leer. Clic en la imagen la abre a pantalla
	// completa; otro clic acerca al punto señalado (el arrastre o el scroll
	// recorren la página) y Escape o la X cierran.
	var lightboxEl = document.getElementById("lightbox");
	var lbScroll = document.getElementById("lightboxScroll");
	var lbImg = document.getElementById("lightboxImg");
	var lbEtiqueta = document.getElementById("lightboxEtiqueta");
	var lbContador = document.getElementById("lightboxContador");
	var lbZoom = false;
	var lbArrastre = null;
	var lbSeMovio = false;

	function lbAjustar() {
		lbZoom = false;
		lbImg.classList.add("max-w-full", "max-h-full", "cursor-zoom-in");
		lbImg.classList.remove("max-w-none", "max-h-none", "cursor-zoom-out");
		lbImg.style.width = "";
	}

	function lbSync() {
		var im = imagenes[imgActual];
		if (!im) { return; }
		lbImg.src = im.url;
		lbEtiqueta.textContent = im.etiqueta;
		lbContador.textContent = (imgActual + 1) + " / " + imagenes.length;
		lbAjustar();
	}

	function abrirLightbox() {
		if (!imagenes.length) { return; }
		lbSync();
		var soloUna = imagenes.length < 2;
		document.getElementById("lightboxPrev").classList.toggle("hidden", soloUna);
		document.getElementById("lightboxNext").classList.toggle("hidden", soloUna);
		lightboxEl.classList.remove("hidden");
		document.body.style.overflow = "hidden";
	}

	function cerrarLightbox() {
		lightboxEl.classList.add("hidden");
		document.body.style.overflow = "";
	}

	galeriaImg.addEventListener("click", abrirLightbox);
	document.getElementById("galeriaAmpliar").addEventListener("click", abrirLightbox);
	document.getElementById("lightboxCerrar").addEventListener("click", cerrarLightbox);
	document.getElementById("lightboxPrev").addEventListener("click", function () { irA(imgActual - 1); });
	document.getElementById("lightboxNext").addEventListener("click", function () { irA(imgActual + 1); });

	lbImg.addEventListener("click", function (e) {
		if (lbSeMovio) { return; }
		if (lbZoom) { lbAjustar(); return; }
		// Acerca centrando el punto donde se hizo clic, no la esquina.
		var rect = lbImg.getBoundingClientRect();
		var fx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
		var fy = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
		lbZoom = true;
		lbImg.classList.remove("max-w-full", "max-h-full", "cursor-zoom-in");
		lbImg.classList.add("max-w-none", "max-h-none", "cursor-zoom-out");
		lbImg.style.width = Math.round(lbScroll.clientWidth * 1.8) + "px";
		requestAnimationFrame(function () {
			lbScroll.scrollLeft = lbImg.clientWidth * fx - lbScroll.clientWidth / 2;
			lbScroll.scrollTop = lbImg.clientHeight * fy - lbScroll.clientHeight / 2;
		});
	});

	// Arrastre con mouse para recorrer la página ampliada; en táctil el scroll
	// nativo ya lo hace. Si hubo arrastre, el click posterior no cambia el zoom.
	lbScroll.addEventListener("pointerdown", function (e) {
		if (e.pointerType !== "mouse") { return; }
		lbArrastre = { x: e.clientX, y: e.clientY, sl: lbScroll.scrollLeft, st: lbScroll.scrollTop };
		lbSeMovio = false;
	});
	lbScroll.addEventListener("pointermove", function (e) {
		if (!lbArrastre) { return; }
		var dx = e.clientX - lbArrastre.x;
		var dy = e.clientY - lbArrastre.y;
		if (Math.abs(dx) + Math.abs(dy) > 6) { lbSeMovio = true; }
		lbScroll.scrollLeft = lbArrastre.sl - dx;
		lbScroll.scrollTop = lbArrastre.st - dy;
	});
	window.addEventListener("pointerup", function () { lbArrastre = null; });

	// Clic en el fondo oscuro (fuera de la imagen) cierra.
	lbScroll.addEventListener("click", function (e) {
		if (e.target === lbScroll && !lbSeMovio) { cerrarLightbox(); }
	});

	// ── Modal de compra ───────────────────────────────────────────────────────
	// Dos decisiones, una por pantalla: primero QUÉ paquete, luego EN QUÉ
	// formato. Antes se mostraban las ocho combinaciones a la vez y había que
	// multiplicar mentalmente para ver que el ciclo sale mucho más barato.
	var modal = document.getElementById("modalCompra");
	var paso1 = document.getElementById("paso1");
	var paso2 = document.getElementById("paso2");
	var modalPie = document.getElementById("modalPie");
	var modalVolver = document.getElementById("modalVolver");
	var modalTituloPaso = document.getElementById("modalTituloPaso");
	var modalSubtitulo = document.getElementById("modalSubtitulo");
	var modalPagar = document.getElementById("modalPagar");
	var modalPagarTexto = document.getElementById("modalPagarTexto");

	var elegido = null;   // producto seleccionado
	var tipoElegido = null; // 'pdf' | 'editable'
	var pasoActual = 1;

	// Círculo de selección: hace visible qué opción está elegida antes de
	// avanzar. Sin él, el único indicio era el borde, que en la tarjeta
	// destacada ya venía verde por ser la recomendada.
	function radio(activo) {
		return '<span class="shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition" ' +
			'style="border-color:' + (activo ? "#059669" : "#c8ccd4") + '">' +
			(activo ? '<span class="w-2.5 h-2.5 rounded-full" style="background:#059669"></span>' : "") +
			"</span>";
	}

	function pintarSeleccion(contenedor, atributo, valor) {
		contenedor.querySelectorAll("[" + atributo + "]").forEach(function (b) {
			var activo = b.getAttribute(atributo) === String(valor);
			var comprado = b.hasAttribute("data-comprado");
			b.style.borderColor = activo ? "#059669" : "#e7e6df";
			b.style.background = activo ? "rgba(5,150,105,.06)" : "#fff";
			var marca = b.querySelector("[data-radio]");
			if (marca) { marca.innerHTML = radio(activo && !comprado); }
		});
	}

	document.getElementById("comprarBtn").addEventListener("click", abrirModal);
	document.getElementById("modalCerrar").addEventListener("click", cerrarModal);
	document.getElementById("modalFondo").addEventListener("click", cerrarModal);
	modalVolver.addEventListener("click", function () { irPaso(1); });
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && !modal.classList.contains("hidden")) { cerrarModal(); }
	});

	// ── Barra de compra fija en móvil ─────────────────────────────────────────
	// Repite el CTA cuando el botón original ya no está a la vista. Una sola
	// función decide si se ve, para que el estado del observador y el del modal
	// no se puedan desincronizar.
	var barra = document.getElementById("barraCompra");
	var botonArriba = false;  // el CTA original se fue por ARRIBA

	function sincronizarBarra() {
		if (!barra) { return; }
		// Solo cuando el botón quedó por encima del viewport. Si está por debajo
		// —al cargar, o al volver hacia el encabezado— no sale: el maestro
		// todavía no ha pasado por él.
		var visible = botonArriba && modal.classList.contains("hidden");
		barra.classList.toggle("hidden", !visible);
		document.body.classList.toggle("con-barra-compra", visible);
	}

	if (barra && "IntersectionObserver" in window) {
		var barraPrecio = document.getElementById("barraCompraPrecio");
		if (barraPrecio) {
			// Reutiliza el mínimo que ya calculó renderPrecios(). Aquí va el
			// formato corto ("$349"): el largo con " MXN" no cabe en la barra.
			barraPrecio.textContent = precioMinimo != null ? montoCorto(precioMinimo) : "—";
		}
		var barraBtn = document.getElementById("barraCompraBtn");
		if (barraBtn) { barraBtn.addEventListener("click", abrirModal); }

		new IntersectionObserver(function (entradas) {
			entradas.forEach(function (e) {
				// top < 0 ⇒ quedó ARRIBA. Si no interseca pero top > 0 es que
				// está por debajo: al cargar la página o al subir de vuelta.
				botonArriba = !e.isIntersecting && e.boundingClientRect.top < 0;
			});
			sincronizarBarra();
		}, { threshold: 0 }).observe(document.getElementById("comprarBtn"));
	}

	function abrirModal() {
		renderPaso1();
		irPaso(1);
		modal.classList.remove("hidden");
		document.body.style.overflow = "hidden";
		Tienda.iconos();
		sincronizarBarra();
	}
	function cerrarModal() {
		modal.classList.add("hidden");
		document.body.style.overflow = "";
		sincronizarBarra();
	}
	function irPaso(n) {
		pasoActual = n;
		paso1.classList.toggle("hidden", n !== 1);
		paso2.classList.toggle("hidden", n !== 2);
		modalVolver.classList.toggle("hidden", n !== 2);
		// El pie está en los dos pasos: en el primero avanza, en el segundo paga.
		modalPie.classList.remove("hidden");
		modalTituloPaso.textContent = n === 1 ? "¿Qué paquete necesitas?" : "¿Cómo lo quieres?";
		modalSubtitulo.textContent = n === 1
			? comboDisplay() + (esMulti ? " multigrado" : " Primaria")
			: etiquetaOpcion(elegido);
		actualizarPie();
	}

	function renderPaso1() {
		var ahorro = ahorroDelCiclo();
		var ciclo = elCiclo();
		var orden = [];
		if (ciclo) { orden.push(ciclo); }
		losTrimestres().forEach(function (p) { orden.push(p); });

		paso1.innerHTML = orden.map(function (p) {
			var esCiclo = p.tipo_paquete === "ciclo";
			var acc = accesosPorProd[p.id] || {};
			var yaLoTiene = !!(acc.pdf || acc.editable);
			var proyectos = p.num_proyectos || (esCiclo ? 12 : 4);

			var destacado = esCiclo && ahorro > 0;
			var borde = destacado ? "#059669" : "#e7e6df";
			var fondo = destacado ? "rgba(5,150,105,.04)" : "#fff";

			return '<button type="button" data-paquete="' + esc(p.id) + '" ' +
				(yaLoTiene ? 'data-comprado="1" ' : "") +
				'class="text-left w-full rounded-2xl p-4 border-2 transition flex items-start gap-3" ' +
				'style="border-color:' + borde + ';background:' + fondo + (yaLoTiene ? ";opacity:.6" : "") + '">' +
				'<span data-radio>' + radio(false) + "</span>" +
				'<div class="min-w-0 flex-1">' +
				(destacado
					? '<span class="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded mb-1.5" style="background:#059669;color:#fff">Más conveniente</span><br>'
					: "") +
				'<span class="font-bold text-ink">' + esc(esCiclo ? "Ciclo completo" : "Trimestre " + p.trimestre) + "</span>" +
				'<p class="text-[13px] text-mute mt-0.5">' + proyectos + " proyectos" +
				(esCiclo ? " · los tres trimestres" : " · anexos y examen") + "</p>" +
				(destacado
					? '<p class="text-[13px] font-bold mt-1.5" style="color:#166534">Ahorras ' + montoCorto(ahorro) + " frente a comprarlos por separado</p>"
					: "") +
				(yaLoTiene ? '<p class="text-[12px] font-semibold mt-1" style="color:#1e3a8a">Ya lo tienes</p>' : "") +
				"</div>" +
				'<div class="shrink-0 text-right">' +
				'<span class="font-black text-ink text-lg">' + (p.precio_pdf != null ? montoCorto(p.precio_pdf) : "—") + "</span>" +
				'<p class="text-[11px] text-mute">desde</p>' +
				"</div></button>";
		}).join("");

		// Elegir no avanza: marca la opción y espera al botón "Siguiente", para
		// que se vea qué se eligió antes de pasar a la siguiente pregunta.
		paso1.querySelectorAll("[data-paquete]").forEach(function (b) {
			b.addEventListener("click", function () {
				if (b.getAttribute("data-comprado")) {
					location.href = "mis-compras.html";
					return;
				}
				elegido = productos.find(function (x) { return String(x.id) === b.getAttribute("data-paquete"); });
				tipoElegido = null;
				pintarSeleccion(paso1, "data-paquete", elegido.id);
				actualizarPie();
			});
		});

		// El ciclo viene marcado de entrada: es el recomendado y así el botón
		// nunca aparece inerte.
		var inicial = paso1.querySelector("[data-paquete]:not([data-comprado])");
		if (inicial) {
			elegido = productos.find(function (x) { return String(x.id) === inicial.getAttribute("data-paquete"); });
			pintarSeleccion(paso1, "data-paquete", elegido.id);
		}
	}

	function renderPaso2() {
		var p = elegido;
		var acc = accesosPorProd[p.id] || {};
		var addon = (p.precio_editable != null && p.precio_pdf != null)
			? Number(p.precio_editable) - Number(p.precio_pdf) : 0;
		var proyectos = p.num_proyectos || (p.tipo_paquete === "ciclo" ? 12 : 4);

		var opciones = [];
		if (p.precio_pdf != null) {
			opciones.push({
				tipo: "pdf",
				nombre: "Solo PDF",
				detalle: "Lista para imprimir, con anexos y examen.",
				precio: p.precio_pdf,
				desglose: null,
				comprado: !!acc.pdf,
			});
		}
		if (p.precio_editable != null) {
			opciones.push({
				tipo: "editable",
				nombre: "PDF + Word editable",
				// El examen se nombra aparte: es el archivo que más se adapta al
				// grupo y el argumento que sostiene este add-on.
				detalle: "Planeación, anexos y examen en Word, para adaptarlos a tu grupo.",
				precio: p.precio_editable,
				desglose: addon > 0
					? montoCorto(p.precio_pdf) + " del PDF + " + montoCorto(addon) + " por el Word · todo el paquete editable"
					: null,
				comprado: !!acc.editable,
				recomendado: true,
			});
		}

		paso2.innerHTML = opciones.map(function (o) {
			return '<button type="button" data-tipo="' + o.tipo + '" ' + (o.comprado ? 'data-comprado="1" ' : "") +
				'class="opcion-tipo text-left w-full rounded-2xl p-4 border-2 transition flex items-start gap-3" ' +
				'style="border-color:#e7e6df;background:#fff' + (o.comprado ? ";opacity:.6" : "") + '">' +
				'<span data-radio>' + radio(false) + "</span>" +
				'<div class="min-w-0 flex-1">' +
				'<span class="font-bold text-ink">' + esc(o.nombre) + "</span>" +
				(o.recomendado && !o.comprado ? ' <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded ml-1" style="background:rgba(30,58,138,.1);color:#1e3a8a">recomendado</span>' : "") +
				'<p class="text-[13px] text-mute mt-0.5">' + esc(o.detalle) + "</p>" +
				(o.desglose ? '<p class="text-[12px] mt-1.5" style="color:#1c2434">' + esc(o.desglose) + "</p>" : "") +
				(o.comprado ? '<p class="text-[12px] font-semibold mt-1" style="color:#1e3a8a">Ya lo tienes</p>' : "") +
				"</div>" +
				'<span class="shrink-0 font-black text-ink text-lg">' + montoCorto(o.precio) + "</span>" +
				"</button>";
		}).join("");

		paso2.querySelectorAll("[data-tipo]").forEach(function (b) {
			b.addEventListener("click", function () {
				if (b.getAttribute("data-comprado")) { location.href = "mis-compras.html"; return; }
				tipoElegido = b.getAttribute("data-tipo");
				pintarSeleccion(paso2, "data-tipo", tipoElegido);
				actualizarPie();
			});
		});

		// Primera opción disponible marcada de entrada, igual que en el paso 1.
		var primera = paso2.querySelector("[data-tipo]:not([data-comprado])");
		if (primera) {
			tipoElegido = primera.getAttribute("data-tipo");
			pintarSeleccion(paso2, "data-tipo", tipoElegido);
		}
		actualizarPie();
	}

	function actualizarPie() {
		var icono = modalPagar.querySelector("[data-lucide], svg");

		if (pasoActual === 1) {
			var listo = !!elegido;
			modalPagar.disabled = !listo;
			modalPagar.style.opacity = listo ? "1" : ".5";
			modalPagarTexto.textContent = listo
				? "Siguiente · " + etiquetaOpcion(elegido)
				: "Elige un paquete";
			if (icono) { icono.style.display = "none"; }
			return;
		}

		if (icono) { icono.style.display = ""; }
		if (!tipoElegido) {
			modalPagar.disabled = true;
			modalPagar.style.opacity = ".5";
			modalPagarTexto.textContent = "Elige una versión";
			return;
		}
		var precio = tipoElegido === "pdf" ? elegido.precio_pdf : elegido.precio_editable;
		modalPagar.disabled = false;
		modalPagar.style.opacity = "1";
		modalPagarTexto.textContent = "Continuar al pago · " + money(precio);
	}

	// El mismo botón sirve a los dos pasos: primero avanza, después cobra.
	modalPagar.addEventListener("click", function () {
		if (pasoActual === 1) {
			if (!elegido) { return; }
			renderPaso2();
			irPaso(2);
			Tienda.iconos();
			return;
		}
		if (!elegido || !tipoElegido) { return; }
		location.href = "checkout.html?producto_id=" + encodeURIComponent(elegido.id) + "&tipo=" + tipoElegido;
	});

	// Al final del todo: ya están declaradas las variables de la galería y
	// registrados los botones, así que un fallo aquí no deja la página muerta.
	// Aun así se aísla: sin vista previa se puede comprar; sin botones, no.
	try {
		await cargarVistaPrevia();
	} catch (err) {
		console.error("vista previa:", err);
		previewCargando.classList.add("hidden");
		previewVacio.classList.remove("hidden");
		previewVacio.classList.add("flex");
		Tienda.iconos();
	}

	// ── Ficha del paquete unitario ────────────────────────────────────────────
	// Misma página y mismo modal que las demás fichas, pero con tres pasos:
	// agrupación (combos de 2 o de 3 grados) → paquete → versión. Corre ANTES
	// de que el flujo normal inicialice su estado, así que busca sus elementos
	// y solo comparte los helpers puros (radio, pintarSeleccion, montoCorto) y
	// la galería, cuyas variables asigna ella misma.
	async function flujoUnitaria() {
		var AGRUPACIONES = [
			{ clave: "tridocente", nombre: "Combos de 2 grados", detalle: "3 paquetes: 1°-2°, 3°-4° y 5°-6°", combos: ["1-2", "3-4", "5-6"] },
			{ clave: "bidocente", nombre: "Combos de 3 grados", detalle: "2 paquetes: 1°-2°-3° y 4°-5°-6°", combos: ["1-2-3", "4-5-6"] },
		];

		// Tarifa del combo (RPC del tarifario; el cobro real lo recalcula la
		// Edge Function) y paquetes multigrado publicados, para saber qué
		// opciones están completas.
		var rTrim = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "trimestre" });
		var rCiclo = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: "ciclo" });
		var rProds = await window.sb
			.from("marketplace_productos")
			.select("id, grados_combo, modalidad, tipo_paquete, trimestre, precio_pdf, precio_editable")
			.eq("activo", true)
			.eq("organizacion", "multigrado");
		if (rTrim.error || rCiclo.error || !rTrim.data || !rCiclo.data || rProds.error) {
			estadoEl.textContent = "Este paquete no está disponible.";
			return;
		}
		var tarifas = { trimestre: rTrim.data, ciclo: rCiclo.data };
		var multigrados = rProds.data || [];

		function disponible(agr, tipoPaquete, trimestre) {
			return agr.combos.every(function (c) {
				return multigrados.some(function (p) {
					return p.modalidad === agr.clave && p.grados_combo === c &&
						p.tipo_paquete === tipoPaquete &&
						(tipoPaquete === "ciclo" || Number(p.trimestre) === trimestre);
				});
			});
		}
		function agrupacionDisponible(agr) {
			return disponible(agr, "ciclo") ||
				[1, 2, 3].some(function (t) { return disponible(agr, "trimestre", t); });
		}

		// ── Cabecera y datos ──
		var tituloPagina = "Multigrado Unitaria de Primaria";
		document.title = "Planeaciones " + tituloPagina + " — Jissez";
		var bc = document.getElementById("breadcrumbNombre");
		if (bc) { bc.textContent = "Unitaria"; }
		tituloEl.textContent = tituloPagina;
		descripcionEl.textContent = "Para el maestro que atiende los seis grados: todos los paquetes multigrado en una sola compra, con descuento. Tú decides si organizas el aula en combos de 2 o de 3 grados.";
		badgesEl.innerHTML =
			'<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:rgba(30,58,138,.1);color:#1e3a8a">1° a 6°</span>' +
			'<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold" style="background:rgba(30,58,138,.08);color:#1e3a8a"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Alineado a la NEM</span>' +
			'<span class="inline-flex items-center h-8 px-3 rounded-full text-[13px]" style="background:#f1f0ea;color:#5b6473">Unitaria</span>';

		metaEl.innerHTML = [
			["Formato", "PDF o PDF + Word editable"],
			["Disponible por", "Trimestre o ciclo completo"],
			["Cobertura", "Los 6 grados, en combos de 2 o de 3"],
			["Incluye", "Planeación + anexos + examen"],
		].map(function (m) {
			return '<div><dt class="text-[11px] font-bold uppercase tracking-[0.1em]" style="color:#5b6473">' + esc(m[0]) + "</dt>" +
				'<dd class="font-semibold mt-0.5" style="color:#1c2434">' + esc(m[1]) + "</dd></div>";
		}).join("");

		// ── Precio de entrada ──
		var desde = Number(tarifas.trimestre.precio_pdf);
		precioMinimo = desde;
		document.getElementById("precioDesde").textContent = money(desde);
		document.getElementById("precioNota").textContent = "por trimestre · incluye todos los combos";
		var ahorroCiclo = desde * 3 - Number(tarifas.ciclo.precio_pdf);
		if (ahorroCiclo > 0) {
			var badgeAhorro = document.getElementById("ahorroBadge");
			badgeAhorro.textContent = "Ahorras " + montoCorto(ahorroCiclo) + " con el ciclo";
			badgeAhorro.classList.remove("hidden");
		}

		estadoEl.classList.add("hidden");
		contenidoEl.classList.remove("hidden");
		var infoExtra = document.getElementById("infoExtra");
		if (infoExtra) { infoExtra.classList.remove("hidden"); }
		Tienda.iconos();

		// ── Modal de compra: tres decisiones, una por pantalla ──
		var modalU = document.getElementById("modalCompra");
		var pasos = [
			document.getElementById("paso1"),
			document.getElementById("paso2"),
			document.getElementById("paso3"),
		];
		var pieU = document.getElementById("modalPie");
		var volverU = document.getElementById("modalVolver");
		var tituloPasoU = document.getElementById("modalTituloPaso");
		var subtituloU = document.getElementById("modalSubtitulo");
		var pagarU = document.getElementById("modalPagar");
		var pagarTextoU = document.getElementById("modalPagarTexto");

		var agrupacionSel = null; // 'tridocente' | 'bidocente'
		var paqueteSel = null;    // 'ciclo' | 't1' | 't2' | 't3'
		var tipoSel = null;       // 'pdf' | 'editable'
		var pasoU = 1;

		function agrupacionObj() {
			return AGRUPACIONES.find(function (a) { return a.clave === agrupacionSel; }) || null;
		}
		function tipoPaqueteSel() { return paqueteSel === "ciclo" ? "ciclo" : "trimestre"; }
		function trimestreSel() { return paqueteSel === "ciclo" ? null : Number(paqueteSel.slice(1)); }
		function etiquetaPaqueteSel() {
			return paqueteSel === "ciclo" ? "Ciclo completo" : "Trimestre " + trimestreSel();
		}
		function precioSel(tipo) {
			var t = tarifas[tipoPaqueteSel()];
			return tipo === "pdf" ? Number(t.precio_pdf) : Number(t.precio_editable);
		}

		document.getElementById("comprarBtn").addEventListener("click", abrirModalU);
		document.getElementById("modalCerrar").addEventListener("click", cerrarModalU);
		document.getElementById("modalFondo").addEventListener("click", cerrarModalU);
		volverU.addEventListener("click", function () { irPasoU(pasoU - 1); });
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && !modalU.classList.contains("hidden")) { cerrarModalU(); }
		});

		// Barra de compra fija en móvil, igual que en las fichas normales.
		var barraU = document.getElementById("barraCompra");
		var botonArribaU = false;
		function sincronizarBarraU() {
			if (!barraU) { return; }
			var visible = botonArribaU && modalU.classList.contains("hidden");
			barraU.classList.toggle("hidden", !visible);
			document.body.classList.toggle("con-barra-compra", visible);
		}
		if (barraU && "IntersectionObserver" in window) {
			var barraPrecioU = document.getElementById("barraCompraPrecio");
			if (barraPrecioU) { barraPrecioU.textContent = montoCorto(desde); }
			var barraBtnU = document.getElementById("barraCompraBtn");
			if (barraBtnU) { barraBtnU.addEventListener("click", abrirModalU); }
			new IntersectionObserver(function (entradas) {
				entradas.forEach(function (e) {
					botonArribaU = !e.isIntersecting && e.boundingClientRect.top < 0;
				});
				sincronizarBarraU();
			}, { threshold: 0 }).observe(document.getElementById("comprarBtn"));
		}

		function abrirModalU() {
			renderPasoAgrupacion();
			irPasoU(1);
			modalU.classList.remove("hidden");
			document.body.style.overflow = "hidden";
			Tienda.iconos();
			sincronizarBarraU();
		}
		function cerrarModalU() {
			modalU.classList.add("hidden");
			document.body.style.overflow = "";
			sincronizarBarraU();
		}

		function irPasoU(n) {
			pasoU = n;
			pasos.forEach(function (p, i) { p.classList.toggle("hidden", i !== n - 1); });
			volverU.classList.toggle("hidden", n === 1);
			pieU.classList.remove("hidden");
			var agr = agrupacionObj();
			if (n === 1) {
				tituloPasoU.textContent = "¿Cómo agrupas los grados?";
				subtituloU.textContent = "Unitaria · 1° a 6° de Primaria";
			} else if (n === 2) {
				tituloPasoU.textContent = "¿Qué paquete necesitas?";
				subtituloU.textContent = agr ? agr.nombre : "";
			} else {
				tituloPasoU.textContent = "¿Cómo lo quieres?";
				subtituloU.textContent = (agr ? agr.nombre + " · " : "") + etiquetaPaqueteSel();
			}
			actualizarPieU();
		}

		// Paso 1: agrupación. Mismo precio con cualquiera; el contenido cubre
		// 1° a 6° en las dos, solo cambia cómo se reparte en paquetes.
		function renderPasoAgrupacion() {
			pasos[0].innerHTML = AGRUPACIONES.map(function (a) {
				var disp = agrupacionDisponible(a);
				return '<button type="button" data-agr="' + a.clave + '" ' + (disp ? "" : 'data-nodisp="1" ') +
					'class="text-left w-full rounded-2xl p-4 border-2 transition flex items-start gap-3" ' +
					'style="border-color:#e7e6df;background:#fff' + (disp ? "" : ";opacity:.55") + '">' +
					'<span data-radio>' + radio(false) + "</span>" +
					'<div class="min-w-0 flex-1">' +
					'<span class="font-bold text-ink">' + esc(a.nombre) + "</span>" +
					'<p class="text-[13px] text-mute mt-0.5">' + esc(a.detalle) + "</p>" +
					(disp ? "" : '<p class="text-[12px] font-semibold mt-1" style="color:#9ba3af">Disponible próximamente</p>') +
					"</div></button>";
			}).join("") +
				'<p class="text-[13px] text-mute px-1">El contenido cubre 1° a 6° con cualquiera de las dos agrupaciones y el precio es el mismo. Elige la que mejor se acomode a tu aula.</p>';

			pasos[0].querySelectorAll("[data-agr]").forEach(function (b) {
				b.addEventListener("click", function () {
					if (b.getAttribute("data-nodisp")) { return; }
					agrupacionSel = b.getAttribute("data-agr");
					pintarSeleccion(pasos[0], "data-agr", agrupacionSel);
					actualizarPieU();
				});
			});

			var inicial = pasos[0].querySelector("[data-agr]:not([data-nodisp])");
			if (inicial) {
				agrupacionSel = inicial.getAttribute("data-agr");
				pintarSeleccion(pasos[0], "data-agr", agrupacionSel);
			}
		}

		// Paso 2: paquete (ciclo destacado, como en las fichas normales).
		function renderPasoPaquete() {
			var agr = agrupacionObj();
			var opciones = [
				{ clave: "ciclo", nombre: "Ciclo completo", detalle: "Los tres trimestres de todos tus combos", disp: disponible(agr, "ciclo") },
				{ clave: "t1", nombre: "Trimestre 1", detalle: "Anexos y examen de cada combo", disp: disponible(agr, "trimestre", 1) },
				{ clave: "t2", nombre: "Trimestre 2", detalle: "Anexos y examen de cada combo", disp: disponible(agr, "trimestre", 2) },
				{ clave: "t3", nombre: "Trimestre 3", detalle: "Anexos y examen de cada combo", disp: disponible(agr, "trimestre", 3) },
			];

			pasos[1].innerHTML = opciones.map(function (o) {
				var esCiclo = o.clave === "ciclo";
				var destacado = esCiclo && ahorroCiclo > 0 && o.disp;
				var precio = o.clave === "ciclo" ? Number(tarifas.ciclo.precio_pdf) : Number(tarifas.trimestre.precio_pdf);
				return '<button type="button" data-paq="' + o.clave + '" ' + (o.disp ? "" : 'data-nodisp="1" ') +
					'class="text-left w-full rounded-2xl p-4 border-2 transition flex items-start gap-3" ' +
					'style="border-color:' + (destacado ? "#059669" : "#e7e6df") + ';background:' + (destacado ? "rgba(5,150,105,.04)" : "#fff") + (o.disp ? "" : ";opacity:.55") + '">' +
					'<span data-radio>' + radio(false) + "</span>" +
					'<div class="min-w-0 flex-1">' +
					(destacado
						? '<span class="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded mb-1.5" style="background:#059669;color:#fff">Más conveniente</span><br>'
						: "") +
					'<span class="font-bold text-ink">' + esc(o.nombre) + "</span>" +
					'<p class="text-[13px] text-mute mt-0.5">' + esc(o.detalle) + "</p>" +
					(destacado
						? '<p class="text-[13px] font-bold mt-1.5" style="color:#166534">Ahorras ' + montoCorto(ahorroCiclo) + " frente a comprarlos por separado</p>"
						: "") +
					(o.disp ? "" : '<p class="text-[12px] font-semibold mt-1" style="color:#9ba3af">Disponible próximamente</p>') +
					"</div>" +
					'<div class="shrink-0 text-right">' +
					'<span class="font-black text-ink text-lg">' + montoCorto(precio) + "</span>" +
					'<p class="text-[11px] text-mute">desde</p>' +
					"</div></button>";
			}).join("");

			pasos[1].querySelectorAll("[data-paq]").forEach(function (b) {
				b.addEventListener("click", function () {
					if (b.getAttribute("data-nodisp")) { return; }
					paqueteSel = b.getAttribute("data-paq");
					tipoSel = null;
					pintarSeleccion(pasos[1], "data-paq", paqueteSel);
					actualizarPieU();
				});
			});

			var inicial = pasos[1].querySelector("[data-paq]:not([data-nodisp])");
			if (inicial) {
				paqueteSel = inicial.getAttribute("data-paq");
				pintarSeleccion(pasos[1], "data-paq", paqueteSel);
			} else {
				paqueteSel = null;
			}
		}

		// Paso 3: versión, con el mismo desglose del add-on que las fichas normales.
		function renderPasoVersion() {
			var pdf = precioSel("pdf");
			var editable = precioSel("editable");
			var addon = editable - pdf;

			var opciones = [
				{ tipo: "pdf", nombre: "Solo PDF", detalle: "Lista para imprimir, con anexos y examen.", precio: pdf, desglose: null },
				{
					tipo: "editable",
					nombre: "PDF + Word editable",
					detalle: "Planeación, anexos y examen en Word, para adaptarlos a tu grupo.",
					precio: editable,
					desglose: addon > 0
						? montoCorto(pdf) + " del PDF + " + montoCorto(addon) + " por el Word · todos tus combos editables"
						: null,
					recomendado: true,
				},
			];

			pasos[2].innerHTML = opciones.map(function (o) {
				return '<button type="button" data-tipou="' + o.tipo + '" ' +
					'class="text-left w-full rounded-2xl p-4 border-2 transition flex items-start gap-3" ' +
					'style="border-color:#e7e6df;background:#fff">' +
					'<span data-radio>' + radio(false) + "</span>" +
					'<div class="min-w-0 flex-1">' +
					'<span class="font-bold text-ink">' + esc(o.nombre) + "</span>" +
					(o.recomendado ? ' <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded ml-1" style="background:rgba(30,58,138,.1);color:#1e3a8a">recomendado</span>' : "") +
					'<p class="text-[13px] text-mute mt-0.5">' + esc(o.detalle) + "</p>" +
					(o.desglose ? '<p class="text-[12px] mt-1.5" style="color:#1c2434">' + esc(o.desglose) + "</p>" : "") +
					"</div>" +
					'<span class="shrink-0 font-black text-ink text-lg">' + montoCorto(o.precio) + "</span>" +
					"</button>";
			}).join("");

			pasos[2].querySelectorAll("[data-tipou]").forEach(function (b) {
				b.addEventListener("click", function () {
					tipoSel = b.getAttribute("data-tipou");
					pintarSeleccion(pasos[2], "data-tipou", tipoSel);
					actualizarPieU();
				});
			});

			tipoSel = "pdf";
			pintarSeleccion(pasos[2], "data-tipou", tipoSel);
		}

		function actualizarPieU() {
			var icono = pagarU.querySelector("[data-lucide], svg");
			var listo, texto;
			if (pasoU === 1) {
				var agr = agrupacionObj();
				listo = !!agr;
				texto = listo ? "Siguiente · " + agr.nombre : "Elige una agrupación";
			} else if (pasoU === 2) {
				listo = !!paqueteSel;
				texto = listo ? "Siguiente · " + etiquetaPaqueteSel() : "Elige un paquete";
			} else {
				listo = !!tipoSel;
				texto = listo ? "Continuar al pago · " + money(precioSel(tipoSel)) : "Elige una versión";
			}
			if (icono) { icono.style.display = pasoU === 3 ? "" : "none"; }
			pagarU.disabled = !listo;
			pagarU.style.opacity = listo ? "1" : ".5";
			pagarTextoU.textContent = texto;
		}

		pagarU.addEventListener("click", function () {
			if (pasoU === 1) {
				if (!agrupacionSel) { return; }
				renderPasoPaquete();
				irPasoU(2);
				Tienda.iconos();
				return;
			}
			if (pasoU === 2) {
				if (!paqueteSel) { return; }
				renderPasoVersion();
				irPasoU(3);
				Tienda.iconos();
				return;
			}
			if (!agrupacionSel || !paqueteSel || !tipoSel) { return; }
			location.href = "checkout.html?combo=unitaria&agrupacion=" + agrupacionSel +
				"&tipo_paquete=" + tipoPaqueteSel() +
				(tipoPaqueteSel() === "trimestre" ? "&trimestre=" + trimestreSel() : "") +
				"&tipo=" + tipoSel;
		});

		// ── Vista previa ──
		// Se enseñan páginas de un combo de 2 grados y de uno de 3, para que el
		// maestro vea cómo se organiza el material en cada agrupación. Se
		// reutiliza la galería normal asignando sus variables compartidas.
		previewFrame = document.getElementById("previewFrame");
		previewVacio = document.getElementById("previewVacio");
		previewCargando = document.getElementById("previewCargando");
		previewLabel = document.getElementById("previewLabel");
		galeriaEl = document.getElementById("galeria");
		galeriaImg = document.getElementById("galeriaImg");
		galeriaTiras = document.getElementById("galeriaTiras");
		galeriaEtiqueta = document.getElementById("galeriaEtiqueta");
		galeriaContador = document.getElementById("galeriaContador");

		async function listarPreviews(slug, prefijo) {
			try {
				var r = await window.sb.storage.from("assets").list("previews/" + slug, {
					limit: 30,
					sortBy: { column: "name", order: "asc" },
				});
				if (r.error || !r.data) { return []; }
				return r.data
					.filter(function (f) { return f.name && /\.(jpe?g|png|webp)$/i.test(f.name); })
					.map(function (f) {
						return {
							nombre: f.name,
							etiqueta: prefijo + etiquetaDeArchivo(f.name),
							url: window.sb.storage.from("assets")
								.getPublicUrl("previews/" + slug + "/" + f.name).data.publicUrl,
						};
					});
			} catch (_) { return []; }
		}

		try {
			var dosGrados = await listarPreviews("multi-1-2", "Combo de 2 grados · ");
			var tresGrados = await listarPreviews("multi-1-2-3", "Combo de 3 grados · ");
			imagenes = dosGrados.concat(tresGrados);
		} catch (_) {
			imagenes = [];
		}
		if (imagenes.length) {
			mostrarGaleria();
		} else {
			previewCargando.classList.add("hidden");
			previewVacio.classList.remove("hidden");
			previewVacio.classList.add("flex");
			Tienda.iconos();
		}
	}
});
