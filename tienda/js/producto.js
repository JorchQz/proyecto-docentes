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
		var tituloGrupo = esMulti ? "Multigrado " + comboDisplay() : gradoNum + "° Primaria";
		tituloEl.textContent = tituloGrupo;
		descripcionEl.textContent = esMulti
			? "Planeación multigrado para un aula de " + comboDisplay() + ", con actividades diferenciadas por grado, alineada a la NEM."
			: "Planeaciones de " + gradoNum + "° grado alineadas a la Nueva Escuela Mexicana.";

		var bc = document.getElementById("breadcrumbNombre");
		if (bc) { bc.textContent = tituloGrupo; }

		var b = "";
		if (!esMulti) {
			var gc = GRADO_COLOR[String(gradoNum)] || "#e7e6df";
			var gt = GRADO_TXT[String(gradoNum)] || "#1c2434";
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:' + gc + ';color:' + gt + '">' +
				gradoNum + '° grado</span>';
		} else {
			b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold" style="background:rgba(30,58,138,.1);color:#1e3a8a">' + esc(comboDisplay() + " multigrado") + '</span>';
		}
		b += '<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold" style="background:rgba(30,58,138,.08);color:#1e3a8a"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Alineado a la NEM</span>';
		if (esMulti) {
			b += '<span class="inline-flex items-center h-8 px-3 rounded-full text-[13px]" style="background:#f1f0ea;color:#5b6473">' + (info.modalidad === "bidocente" ? "Bidocente" : "Tridocente") + "</span>";
		}
		badgesEl.innerHTML = b;
	}

	function renderMeta(p) {
		var esCiclo = p.tipo_paquete === "ciclo";
		var meta = [
			[esMulti ? "Aula multigrado" : "Grado", comboDisplay()],
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
		document.getElementById("precioNota").textContent = losTrimestres().length
			? "por trimestre · el ciclo completo sale más barato"
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
			.select("nombre_proyecto, trimestre, grados, numero_proyecto")
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
			return '<li>' +
				'<p class="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 mt-3 first:mt-0" style="color:#1e3a8a">' +
				"Trimestre " + esc(t) + " · " + proyectos.length + " proyectos</p>" +
				'<ul class="flex flex-col gap-1.5">' +
				proyectos.map(function (d) {
					return '<li class="flex items-start gap-2">' +
						'<i data-lucide="check" class="w-4 h-4 mt-0.5 shrink-0" style="color:#059669"></i>' +
						'<span>' + esc(d.nombre_proyecto || "Proyecto") + "</span></li>";
				}).join("") +
				"</ul></li>";
		}).join("");

		var total = filas.length;
		var nota = document.getElementById("incluyeNota");
		if (nota) {
			nota.textContent = trimestres.length > 1
				? "Los " + total + " proyectos del ciclo completo. Si compras un trimestre suelto, recibes los de ese trimestre."
				: "Los " + total + " proyectos de este paquete.";
		}
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
	var botonVisible = true;  // el CTA original está a la vista
	var botonArriba = false;  // el CTA original se fue por arriba
	var tituloFuera = false;  // el encabezado se fue por arriba

	function sincronizarBarra() {
		if (!barra) { return; }
		// Se muestra si el CTA no está a la vista y el maestro ya bajó lo
		// suficiente: o el botón quedó arriba, o al menos el título ya pasó.
		var visible = !botonVisible && (botonArriba || tituloFuera) &&
			modal.classList.contains("hidden");
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

		// El título hace de centinela. Sin él la barra nunca saldría para quien
		// se queda a media galería: el observador del botón no vuelve a
		// dispararse mientras el botón siga por debajo del pliegue.
		new IntersectionObserver(function (entradas) {
			entradas.forEach(function (e) {
				tituloFuera = !e.isIntersecting && e.boundingClientRect.top < 0;
			});
			sincronizarBarra();
		}, { threshold: 0 }).observe(tituloEl);

		new IntersectionObserver(function (entradas) {
			entradas.forEach(function (e) {
				botonVisible = e.isIntersecting;
				// top < 0 ⇒ quedó ARRIBA. En la carga inicial está por debajo
				// (top > 0), así que la barra no sale de entrada.
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
					? '<p class="text-[13px] font-bold mt-1.5" style="color:#166534">Ahorras ' + montoCorto(ahorro) + " frente a comprarlos sueltos</p>"
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
				detalle: "Adáptala a tu grupo: cambia nombres, tiempos y actividades.",
				precio: p.precio_editable,
				desglose: addon > 0
					? montoCorto(p.precio_pdf) + " del PDF + " + montoCorto(addon) + " por el Word · los " + proyectos + " proyectos editables"
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
});
