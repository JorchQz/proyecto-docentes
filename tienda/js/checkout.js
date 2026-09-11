document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	// Todo el cobro pasa por Mercado Pago (Checkout Pro): ahí el comprador elige
	// cuenta MP, tarjeta, dos tarjetas, efectivo o transferencia SPEI, y la
	// entrega se activa sola. No hay confirmación manual de por medio.
	//
	// La cuenta se crea AQUÍ, en la misma pantalla del pago. Antes había un
	// paso previo de "inicia sesión / regístrate", y mandar a otra pantalla en
	// pleno pago es donde más gente abandona.

	var session = await Tienda.montarNav("");
	// El pie lleva los enlaces a Términos y Privacidad: en el pago no pueden faltar.
	Tienda.montarFooter();
	var money = Tienda.formatMoney;

	var estadoEl = document.getElementById("estado");
	var contenidoEl = document.getElementById("contenido");
	var resumenTitulo = document.getElementById("resumenTitulo");
	var resumenTipo = document.getElementById("resumenTipo");
	var resumenPrecio = document.getElementById("resumenPrecio");
	var bloqueDatos = document.getElementById("bloqueDatos");
	var bloquePago = document.getElementById("bloquePago");
	var barraUsuario = document.getElementById("barraUsuario");
	var usuarioEmail = document.getElementById("usuarioEmail");
	var pagarMpBtn = document.getElementById("pagarMpBtn");
	var volverLink = document.getElementById("volverLink");
	// "Volver" nace oculto y aparece con su destino definitivo: nada de un
	// enlace al catálogo que un instante después apunte a la ficha.
	function mostrarVolver(href) {
		volverLink.href = href;
		volverLink.classList.remove("hidden");
	}
	var mensajeDatos = document.getElementById("mensajeDatos");

	var params = new URLSearchParams(location.search);
	var productoId = params.get("producto_id");
	var tipo = params.get("tipo");

	// Proyecto personalizado: llega de personalizado.html con el pedido guardado
	// como borrador en localStorage (checkout.html?personalizado=1). No hay
	// producto: la Edge Function crea el pedido y la orden juntos.
	var esPedido = params.get("personalizado") === "1";
	var borradorPedido = null;
	if (esPedido) {
		try { borradorPedido = JSON.parse(localStorage.getItem("jissez_pedido") || "null"); } catch (_) { borradorPedido = null; }
		if (borradorPedido) { tipo = borradorPedido.nivel === "con_anexos" ? "anexos" : "pdf"; }
	}

	// Compra combinada del paquete unitario (llega desde el catálogo):
	// checkout.html?combo=unitaria&agrupacion=...&tipo_paquete=...[&trimestre=n]&tipo=...
	var esCombo = params.get("combo") === "unitaria";
	var comboAgrupacion = params.get("agrupacion");
	var comboTipoPaquete = params.get("tipo_paquete");
	var comboTrimestre = Number(params.get("trimestre"));
	var COMBOS_UNITARIA = { tridocente: ["1-2", "3-4", "5-6"], bidocente: ["1-2-3", "4-5-6"] };


	var comboValido = esCombo && COMBOS_UNITARIA[comboAgrupacion] &&
		(comboTipoPaquete === "ciclo" ||
			(comboTipoPaquete === "trimestre" && [1, 2, 3].indexOf(comboTrimestre) !== -1));

	// 'anexos' es la versión "con anexos" del proyecto individual; el combo unitario
	// es de paquetes y no la tiene.
	var tipoValido = tipo === "pdf" || tipo === "editable" || (!esCombo && tipo === "anexos");
	if (esPedido) {
		if (!borradorPedido) {
			estadoEl.innerHTML = 'No encontramos tu pedido. <a href="personalizado.html" class="font-semibold" style="color:#1e3a8a">Vuelve a armarlo</a>.';
			return;
		}
	} else if (!tipoValido || (esCombo ? !comboValido : !productoId)) {
		estadoEl.textContent = "Compra inválida.";
		return;
	}
	var aceptaTerminosEl = document.getElementById("aceptaTerminos");

	// Lo que se manda a crear-preferencia-mp; lo llena prepararCombo o
	// prepararIndividual. El precio NUNCA viaja aquí: lo calcula el servidor.
	var cuerpoPago = null;
	// Importe que el comprador tiene delante. Se compara con el que devuelve la
	// Edge Function antes de mandarlo a Mercado Pago: si la promoción terminó
	// entre que se pintó el resumen y este clic, no se cobra a ciegas.
	var precioMostrado = null;
	// Precio de lista del pedido (sin ningún descuento). Es lo que se manda a
	// validar el cupón, y la base de todo lo que se repinta.
	var precioLista = null;
	// Cupón que el comprador aplicó y que descontó de verdad. null si no puso
	// ninguno o si el suyo no llegó a bajar el precio. pintarTotal() lo lee para
	// saber qué parte del descuento es de la oferta y qué parte del cupón, así
	// que SIEMPRE se asigna antes de repintar.
	var cuponAplicado = null;

	// Antes de pintar cualquier importe: así el precio no aparece a lista y
	// cambia un instante después.
	await Tienda.cargarPromo();
	// Ámbito del descuento: pedido personalizado desde ya; producto o combo se
	// fijan en cuanto se sabe qué es (antes de pintar cualquier importe).
	if (esPedido) { Tienda.setAmbito("personalizado"); }

	var preparado = esPedido ? await prepararPedido() : (esCombo ? await prepararCombo() : await prepararIndividual());
	if (!preparado) {
		if (volverLink.classList.contains("hidden")) { mostrarVolver("catalogo.html"); }
		return;
	}
	pintarNotaPromo();

	/**
	 * Proyecto personalizado: precio, cupo y ventana salen de la RPC pública; el
	 * resumen se pinta con lo que el maestro eligió en el formulario. El cobro
	 * real lo vuelve a resolver la Edge Function contra la base.
	 */
	async function prepararPedido() {
		mostrarVolver("personalizado.html");
		var r = await window.sb.rpc("marketplace_personalizados_estado");
		if (r.error || !r.data) {
			estadoEl.textContent = "No pudimos consultar la disponibilidad. Vuelve a intentarlo.";
			return false;
		}
		var est = r.data;
		if (!est.abierto || Number(est.cupos_disponibles) <= 0) {
			estadoEl.innerHTML = (est.abierto ? "Por ahora no hay cupo para pedidos personalizados: en cuanto entreguemos uno se libera un lugar." : Tienda.esc(est.mensaje || "Por ahora no recibimos pedidos personalizados.")) +
				' <a href="catalogo.html?vista=proyectos" class="font-semibold" style="color:#1e3a8a">Ver proyectos del catálogo</a>';
			return false;
		}
		var b = borradorPedido;
		var conAnexos = b.nivel === "con_anexos";
		var lista = Number(conAnexos ? est.precio_con_anexos : est.precio_sin_anexos);
		var aula = b.organizacion === "multigrado"
			? "Multigrado " + String(b.grados_combo || "").split("-").map(function (n) { return n + "°"; }).join("-")
			: b.grado + "° de Primaria";

		resumenTitulo.textContent = "Proyecto personalizado · " + aula;
		resumenTipo.textContent = conAnexos
			? "Planeación en PDF y Word editable, con anexos imprimibles"
			: "Planeación en PDF y Word editable, sin anexos";
		pintarTotal(lista);

		// Mismo formato que "Tu pedido" en el formulario: cada rótulo una vez
		// (en plural si hay varios) y los elementos en lista.
		var filas = [];
		var cfs = (b.campos_formativos || []).filter(function (c) { return Tienda.CF_COLOR[c]; });
		if (cfs.length) { filas.push([cfs.length > 1 ? "Campos" : "Campo", cfs.map(function (c) { return Tienda.CF_COLOR[c].nombre; })]); }
		var contenidos = b.contenidos_texto || [];
		if (contenidos.length) { filas.push([contenidos.length > 1 ? "Contenidos" : "Contenido", contenidos]); }
		var pdas = b.pdas_texto || [];
		if (pdas.length) { filas.push([pdas.length > 1 ? "PDAs" : "PDA", pdas]); }
		if (b.metodologia) { filas.push(["Metodología", [b.metodologia]]); }
		if (b.fecha_necesaria) { filas.push(["Lo necesitas para", [b.fecha_necesaria]]); }
		var resumenCombo = document.getElementById("resumenCombo");
		resumenCombo.innerHTML =
			'<p class="text-[11px] font-bold uppercase tracking-[0.1em] text-mute mb-2">Lo que pediste</p>' +
			(filas.length
				? '<dl class="flex flex-col gap-1.5 text-[13px]">' + filas.map(function (f) {
					var valor = f[1].length === 1
						? Tienda.esc(f[1][0])
						: '<ul class="list-disc pl-4 flex flex-col gap-1">' + f[1].map(function (v) { return "<li>" + Tienda.esc(v) + "</li>"; }).join("") + "</ul>";
					return '<div class="flex gap-2"><dt class="w-20 shrink-0 font-semibold text-mute">' + Tienda.esc(f[0]) + '</dt><dd class="text-ink leading-snug min-w-0 flex-1">' + valor + "</dd></div>";
				}).join("") + "</dl>"
				: '<p class="text-[13px] text-mute">Sin preferencias: elegimos campo, contenido y PDA para ese grado.</p>') +
			'<p class="mt-3 text-[13px]" style="color:#047857">Entrega en tu biblioteca en un máximo de ' + Math.round(est.ventana_horas) + " horas después del pago. Te avisamos por correo.</p>" +
			'<a href="personalizado.html" class="inline-block mt-2 text-[13px] font-semibold" style="color:#1e3a8a">Cambiar el pedido</a>';
		resumenCombo.classList.remove("hidden");
		// Un pedido no se entrega al instante: se elabora y llega a la
		// biblioteca dentro de la ventana comprometida.
		var ventajaAcceso = document.getElementById("ventajaAcceso");
		if (ventajaAcceso) {
			ventajaAcceso.innerHTML = '<i data-lucide="clock" class="w-3.5 h-3.5 text-action"></i> Entrega en tu biblioteca en un máximo de ' + Math.round(est.ventana_horas) + " horas después del pago";
			Tienda.iconos();
		}

		cuerpoPago = {
			pedido: {
				organizacion: b.organizacion,
				grado: b.grado,
				grados_combo: b.grados_combo,
				campos_formativos: b.campos_formativos || [],
				contenido_ids: b.contenido_ids || [],
				pda_ids: b.pda_ids || [],
				metodologia: b.metodologia || null,
				fecha_necesaria: b.fecha_necesaria || null,
				notas: b.notas || null,
			},
			tipo: tipo,
		};
		return true;
	}

	// Con la promoción apagada se queda la nota de "Precio de lanzamiento"
	// que ya trae el HTML.
	function pintarNotaPromo() {
		var el = document.getElementById("notaPrecioCheckout");
		if (!el || !Tienda.promoActiva()) { return; }
		var hasta = Tienda.promoFechaLimite();
		// El importe del descuento ya está arriba, en su renglón de la cuenta;
		// aquí solo se recuerda hasta cuándo dura. Rojo, como todo lo que habla
		// de la oferta.
		el.style.color = Tienda.COLOR_DESCUENTO.texto;
		el.innerHTML = '<i data-lucide="tag" class="w-3.5 h-3.5"></i> ' +
			(hasta
				? '<span class="font-semibold">La oferta termina el ' + Tienda.esc(hasta) + "</span>"
				: '<span class="font-semibold">Oferta por tiempo limitado</span>');
		Tienda.iconos();
	}

	/**
	 * Pinta la cuenta completa del resumen: subtotal a precio de lista, una
	 * línea en negativo por cada descuento y el total a pagar.
	 *
	 * Las dos líneas se leen en cascada, igual que las calcula la base: la
	 * oferta baja el precio de lista y el cupón descuenta sobre ESE precio
	 * (marketplace_cupon_evaluar). Por eso nunca se solapan y las cifras de
	 * arriba siempre suman el total de abajo.
	 *
	 * `final` sobreescribe el cálculo de la promoción cuando manda un cupón.
	 * `precioMostrado` queda siempre sincronizado con lo que hay en pantalla,
	 * porque es contra eso que se compara el importe que devuelve el servidor
	 * antes de redirigir a Mercado Pago.
	 */
	function pintarTotal(lista, final) {
		precioLista = Number(lista);
		precioMostrado = final != null ? Number(final) : Tienda.precioFinal(lista);

		// Sin cupón aplicado, todo lo que falta hasta el total es la oferta.
		// El segundo caso es la red de seguridad: si el servidor devolviera un
		// importe por encima del precio con oferta (la promo caducó entre que
		// se pintó el resumen y el clic), no se inventa un descuento de cupón.
		var conOferta = Tienda.precioFinal(lista);
		if (!cuponAplicado || precioMostrado > conOferta) { conOferta = precioMostrado; }

		var dctoOferta = precioLista - conOferta;
		var dctoCupon = conOferta - precioMostrado;
		var ahorro = precioLista - precioMostrado;

		fila("filaSubtotal", ahorro > 0);
		document.getElementById("subtotalMonto").innerHTML = ahorro > 0
			? '<s class="text-mute font-semibold">' + money(precioLista) + "</s>"
			: money(precioLista);

		fila("filaOferta", dctoOferta > 0);
		if (dctoOferta > 0) {
			var promo = Tienda.promoActiva() ? Tienda.promoInfo() : null;
			document.getElementById("ofertaLabel").textContent =
				promo ? "Oferta -" + promo.porcentaje + "%" : "Descuento";
			pintarResta("ofertaMonto", dctoOferta);
		}

		fila("filaCuponPrecio", dctoCupon > 0);
		if (dctoCupon > 0) {
			document.getElementById("cuponPrecioLabel").textContent = "Cupón " + cuponAplicado;
			pintarResta("cuponPrecioMonto", dctoCupon);
		}

		resumenPrecio.innerHTML =
			'<span class="font-black text-ink text-2xl">' + money(precioMostrado) + "</span>";

		// La cuenta solo aparece cuando tiene algo que contar: con precio de
		// lista y sin add-on, el resumen se queda en una línea de Total.
		var conDesglose = !document.getElementById("resumenDesglose").classList.contains("hidden");
		fila("bloqueCuenta", ahorro > 0 || conDesglose);

		var ahorroEl = document.getElementById("filaAhorro");
		ahorroEl.classList.toggle("hidden", !(ahorro > 0));
		if (ahorro > 0) {
			ahorroEl.style.color = Tienda.COLOR_DESCUENTO.texto;
			// Solo el monto, nunca el porcentaje total. Encadenar 20% y 10% da
			// 28%, no 30%, y ese número compuesto además se mueve con el
			// redondeo a pesos: prometería algo distinto en cada paquete. Lo que
			// sí se anuncia por su porcentaje es la oferta, y ahí el número
			// cuadra exacto contra el subtotal que está justo encima.
			ahorroEl.textContent = "Ahorras " + money(ahorro);
		}
	}

	/** Muestra u oculta una fila de la cuenta sin perder su `display:flex`. */
	function fila(id, visible) {
		var el = document.getElementById(id);
		el.classList.toggle("hidden", !visible);
		el.classList.toggle("flex", visible);
	}

	/** Un descuento siempre se pinta en rojo y con el signo menos delante. */
	function pintarResta(id, monto) {
		var el = document.getElementById(id);
		el.style.color = Tienda.COLOR_DESCUENTO.texto;
		el.textContent = "- " + money(monto);
	}

	/** Compra normal de un solo paquete: resumen y cuerpo del pago. */
	async function prepararIndividual() {
		var res = await window.sb
			.from("marketplace_productos")
			.select("id, titulo, precio_pdf, precio_editable, precio_pdf_con_anexos, tiene_anexos, tipo_paquete, activo, organizacion, grado, grados_combo")
			.eq("id", productoId)
			.eq("activo", true)
			.maybeSingle();

		if (res.error || !res.data) {
			estadoEl.textContent = "Este paquete no está disponible.";
			return false;
		}
		var p = res.data;
		// Proyecto individual: 'pdf' = sin anexos, 'anexos' = con anexos; el Word va
		// incluido en los dos. Paquete: 'editable' es el add-on de Word.
		var esProyecto = p.tipo_paquete === "proyecto";
		if (esProyecto ? tipo === "editable" : tipo === "anexos") {
			estadoEl.textContent = "Esta versión no existe para este producto.";
			return false;
		}
		if (esProyecto && tipo === "anexos" && p.tiene_anexos === false) {
			estadoEl.innerHTML = 'Este proyecto no incluye anexos imprimibles. <a href="checkout.html?producto_id=' + encodeURIComponent(p.id) + '&tipo=pdf" class="font-semibold" style="color:#1e3a8a">Comprar la planeación en PDF y Word</a>.';
			return false;
		}
		var precio = esProyecto
			? (tipo === "pdf" ? p.precio_pdf : p.precio_pdf_con_anexos)
			: (tipo === "pdf" ? p.precio_pdf : p.precio_editable);
		if (precio == null) {
			estadoEl.textContent = "Esta versión no tiene precio configurado.";
			return false;
		}

		// "Volver" tiene que llevar a la ficha del paquete, y esa página se
		// identifica por grado o por combinación multigrado, nunca por el id del
		// producto: con `?id=` no encontraba nada y decía "no está disponible".
		// La ficha del proyecto individual sí va por id.
		Tienda.setAmbito(esProyecto ? "proyecto" : "paquete");
		mostrarVolver(esProyecto
			? "proyecto.html?id=" + encodeURIComponent(p.id)
			: (p.organizacion === "multigrado"
				? "producto.html?org=multigrado&combo=" + encodeURIComponent(p.grados_combo || "")
				: "producto.html?org=completa&g=" + encodeURIComponent(p.grado || "")));

		// Resumen
		resumenTitulo.textContent = p.titulo;
		resumenTipo.textContent = esProyecto
			? (tipo === "anexos"
				? "Proyecto individual — planeación en PDF y Word editable, con anexos imprimibles"
				: "Proyecto individual — planeación en PDF y Word editable, sin anexos")
			: (tipo === "pdf" ? "Versión PDF" : "Versión editable — planeación, anexos y examen en PDF y Word");
		pintarTotal(precio);

		// Con el add-on mostramos de dónde sale el subtotal: la base cuesta lo
		// mismo que suelta y el resto es exactamente el precio del extra.
		if (esProyecto && tipo === "anexos" && p.precio_pdf != null) {
			mostrarDesglose(Number(p.precio_pdf), Number(p.precio_pdf_con_anexos) - Number(p.precio_pdf),
				"Proyecto en PDF + Word", "Anexos imprimibles");
		} else if (tipo === "editable" && p.precio_pdf != null) {
			mostrarDesglose(Number(p.precio_pdf), Number(p.precio_editable) - Number(p.precio_pdf));
		}

		cuerpoPago = { producto_id: productoId, tipo: tipo };
		return true;
	}

	/**
	 * Paquete unitario: resuelve los productos multigrado reales de la
	 * agrupación elegida, pide el precio del combo a la RPC y lista lo que
	 * incluye. El cobro real lo recalcula la Edge Function contra la base.
	 */
	async function prepararCombo() {
		mostrarVolver("producto.html?org=multigrado&combo=unitaria");

		var esperados = COMBOS_UNITARIA[comboAgrupacion];
		var q = window.sb
			.from("marketplace_productos")
			.select("id, titulo, grados_combo, trimestre, tipo_paquete, precio_pdf, precio_editable")
			.eq("activo", true)
			.eq("organizacion", "multigrado")
			.eq("modalidad", comboAgrupacion)
			.eq("tipo_paquete", comboTipoPaquete);
		if (comboTipoPaquete === "trimestre") { q = q.eq("trimestre", comboTrimestre); }
		var res = await q;
		var tarifaRes = await window.sb.rpc("marketplace_precio_unitaria", { p_tipo_paquete: comboTipoPaquete });

		var productos = (res.data || []).filter(function (x) {
			return esperados.indexOf(x.grados_combo) !== -1;
		});
		if (res.error || tarifaRes.error || !tarifaRes.data || productos.length !== esperados.length) {
			estadoEl.textContent = "El paquete unitario no está disponible por ahora.";
			return false;
		}

		var listaTotal = tipo === "pdf"
			? Number(tarifaRes.data.precio_pdf)
			: Number(tarifaRes.data.precio_editable);
		var precioPdf = Tienda.precioFinal(tarifaRes.data.precio_pdf);
		var total = Tienda.precioFinal(listaTotal);

		resumenTitulo.textContent = "Paquete unitario · 1° a 6° de Primaria";
		var etiquetaPaquete = comboTipoPaquete === "ciclo" ? "Ciclo completo" : "Trimestre " + comboTrimestre;
		resumenTipo.textContent = etiquetaPaquete + " · " +
			(tipo === "pdf" ? "Versión PDF" : "Versión editable — planeación, anexos y examen en PDF y Word");
		pintarTotal(listaTotal);

		// Qué paquetes incluye y cuánto costarían por separado. El tachado solo
		// aparece cuando por separado sale de verdad más caro. Se comparan
		// precios finales contra precio final: sumar los de lista contra un
		// total con descuento inflaría el ahorro.
		var separado = 0;
		var itemsHtml = esperados.map(function (combo) {
			var p = productos.find(function (x) { return x.grados_combo === combo; });
			var precio = tipo === "pdf" ? p.precio_pdf : p.precio_editable;
			separado += precio != null ? Tienda.precioFinal(precio) : 0;
			return '<li class="flex items-center gap-2 text-[13px]" style="color:#1c2434">' +
				'<i data-lucide="check" class="w-4 h-4 shrink-0" style="color:#059669"></i>' +
				Tienda.esc(p.titulo) + '</li>';
		}).join("");

		var resumenCombo = document.getElementById("resumenCombo");
		resumenCombo.innerHTML =
			'<p class="text-[11px] font-bold uppercase tracking-[0.1em] text-mute mb-2">Incluye ' + productos.length + ' paquetes multigrado</p>' +
			'<ul class="flex flex-col gap-1.5">' + itemsHtml + '</ul>' +
			(separado > total
				? '<p class="mt-2.5 text-[13px]" style="color:#5b6473">Por separado: <s>' + money(separado) + '</s> · ahorras <span class="font-bold" style="color:' + Tienda.COLOR_DESCUENTO.texto + '">' + money(separado - total) + '</span></p>'
				: '');
		resumenCombo.classList.remove("hidden");

		// El desglose va a precio de lista, como el subtotal que reparte.
		var listaPdf = Number(tarifaRes.data.precio_pdf);
		if (tipo === "editable" && listaTotal > listaPdf) {
			mostrarDesglose(listaPdf, listaTotal - listaPdf);
		}

		cuerpoPago = {
			combo: "unitaria",
			agrupacion: comboAgrupacion,
			tipo_paquete: comboTipoPaquete,
			tipo: tipo,
		};
		if (comboTipoPaquete === "trimestre") { cuerpoPago.trimestre = comboTrimestre; }
		return true;
	}

	/**
	 * Reparte el subtotal entre la base y el add-on. Los dos importes son de
	 * LISTA, nunca descontados: así suman exactamente el subtotal y los
	 * descuentos quedan abajo, en sus propias líneas. (Con precios ya
	 * descontados no cuadraría: el redondeo hacia abajo no es aditivo.)
	 */
	function mostrarDesglose(precioPdf, addon, etiquetaBase, etiquetaAddon) {
		if (addon <= 0) { return; }
		// Las etiquetas por defecto son las del paquete (PDF + add-on de Word);
		// el proyecto individual manda las suyas (PDF + Word / anexos).
		document.getElementById("desgloseBaseLabel").textContent = etiquetaBase || "Planeación en PDF";
		document.getElementById("desgloseAddonLabel").textContent = etiquetaAddon || "Versión Word editable";
		document.getElementById("desglosePdf").textContent = money(precioPdf);
		document.getElementById("desgloseWord").textContent = "+ " + money(addon);
		fila("resumenDesglose", true);
		// Puede correr después del primer pintarTotal(), así que abre la cuenta
		// por su cuenta: si no, el desglose quedaría dentro de un bloque oculto.
		fila("bloqueCuenta", true);
	}

	// ── Cupones ──────────────────────────────────────────────────────────────
	// El navegador solo PINTA lo que la base responde. El importe que se cobra
	// lo vuelve a resolver crear-preferencia-mp con el mismo núcleo SQL, así que
	// lo mostrado y lo cobrado no pueden separarse.

	var cuponInput = document.getElementById("fCupon");
	var cuponBtn = document.getElementById("aplicarCuponBtn");
	var cuponMsgEl = document.getElementById("cuponMensaje");

	// Comodidad al teclear; la garantía está en la base (upper/btrim + check).
	cuponInput.addEventListener("input", function () {
		var pos = cuponInput.selectionStart;
		cuponInput.value = cuponInput.value.toUpperCase().replace(/\s+/g, "");
		try { cuponInput.setSelectionRange(pos, pos); } catch (_) {}
	});
	cuponInput.addEventListener("keydown", function (e) {
		if (e.key === "Enter") { e.preventDefault(); cuponBtn.click(); }
	});

	// tono: "ok" verde · "info" azul · "error" rojo
	function mensajeCupon(texto, tono) {
		if (!texto) { cuponMsgEl.classList.add("hidden"); return; }
		var color = tono === "ok" ? "#047857" : (tono === "error" ? "#b91c1c" : "#1e3a8a");
		cuponMsgEl.style.color = color;
		cuponMsgEl.textContent = texto;
		cuponMsgEl.classList.remove("hidden");
	}

	cuponBtn.addEventListener("click", async function () {
		var codigo = (cuponInput.value || "").trim().toUpperCase();
		if (!codigo) {
			// Campo vacío = quitar el cupón y volver al precio de la oferta.
			cuponAplicado = null;
			pintarTotal(precioLista);
			mensajeCupon("", null);
			return;
		}

		cuponBtn.disabled = true;
		cuponBtn.textContent = "...";
		var r = await Tienda.validarCupon(codigo, precioLista);
		cuponBtn.disabled = false;
		cuponBtn.textContent = "Aplicar";

		if (!r) {
			mensajeCupon("No pudimos comprobar tu cupón. Inténtalo de nuevo.", "error");
			return;
		}

		if (r.aplicado) {
			cuponAplicado = r.codigo;
			pintarTotal(precioLista, Number(r.precio_final));
			// El importe del cupón ya aparece en su renglón de la cuenta: aquí
			// basta confirmar que entró y, si hace falta, avisar de la cuenta.
			mensajeCupon(
				"Cupón " + r.codigo + " aplicado." +
				(r.requiere_sesion
					? " Se confirma al crear tu cuenta aquí abajo (es de un uso por persona)."
					: ""),
				"ok");
			return;
		}

		// No se aplicó. Se vuelve al precio sin cupón en todos los casos.
		cuponAplicado = null;
		pintarTotal(precioLista);
		// "No mejora" (el precio ya está en el piso) no es un error del
		// comprador: su cupón sigue intacto. Va en azul, nunca en rojo.
		mensajeCupon(r.mensaje || "Ese cupón no está disponible.",
			r.motivo === "no_mejora" ? "info" : "error");
	});

	estadoEl.classList.add("hidden");
	contenidoEl.classList.remove("hidden");
	bloquePago.classList.remove("hidden");

	pintarSesion();

	var etiquetaBoton = pagarMpBtn.innerHTML;

	function pintarSesion() {
		if (session) {
			bloqueDatos.classList.add("hidden");
			barraUsuario.classList.remove("hidden");
			usuarioEmail.textContent = session.user.email || "";
		} else {
			bloqueDatos.classList.remove("hidden");
			barraUsuario.classList.add("hidden");
		}
	}

	function aviso(texto, tipoMsg) {
		mensajeDatos.textContent = texto;
		mensajeDatos.className = "rounded-xl px-3.5 py-2.5 text-sm font-medium";
		mensajeDatos.style.cssText = tipoMsg === "error"
			? "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5"
			: "background:#eff6ff;color:#1e40af;border:1px solid #93c5fd";
		mensajeDatos.classList.remove("hidden");
	}
	function limpiarAviso() { mensajeDatos.classList.add("hidden"); }

	/**
	 * Deja al comprador con sesión iniciada, cree cuenta o entre a la suya.
	 *
	 * El mismo formulario sirve para las dos cosas: pedirle que decida de
	 * antemano si es nuevo o no es una pregunta que el sistema puede responder
	 * solo. Si el correo ya existe, se intenta iniciar sesión con esa
	 * contraseña; si no, se crea la cuenta.
	 *
	 * @returns {Promise<object|null>} la sesión, o null si falta algo
	 */
	async function asegurarSesion() {
		var nombre = (document.getElementById("fNombre").value || "").trim();
		var correo = (document.getElementById("fCorreo").value || "").trim();
		var clave = document.getElementById("fClave").value || "";

		if (!nombre || nombre.length < 3) {
			aviso("Escribe tu nombre completo.", "error");
			return null;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
			aviso("Revisa tu correo, parece incompleto.", "error");
			return null;
		}
		if (clave.length < 6) {
			aviso("La contraseña debe tener al menos 6 caracteres.", "error");
			return null;
		}

		// 1. Intentar crear la cuenta.
		var alta = await window.sb.auth.signUp({
			email: correo,
			password: clave,
			options: { data: { full_name: nombre, nombre_docente: nombre } },
		});

		if (!alta.error && alta.data.session) {
			await window.sb.from("perfiles").upsert(
				{ id: alta.data.session.user.id, nombre_completo: nombre },
				{ onConflict: "id" }
			);
			return alta.data.session;
		}

		// 2. El correo ya tenía cuenta: entrar con esa contraseña.
		var entrada = await window.sb.auth.signInWithPassword({ email: correo, password: clave });
		if (entrada.error || !entrada.data.session) {
			aviso(
				window.mensajeAuth
					? window.mensajeAuth(entrada.error || alta.error, "No pudimos entrar con esos datos.")
					: "No pudimos entrar con esos datos.",
				"error",
			);
			return null;
		}
		return entrada.data.session;
	}

	pagarMpBtn.addEventListener("click", async function () {
		limpiarAviso();
		// Sin aceptar los Términos y el Aviso de Privacidad no se cobra. La
		// casilla vive fuera del bloque de datos (que se oculta con sesión),
		// así que se ve siempre.
		if (aceptaTerminosEl && !aceptaTerminosEl.checked) {
			Tienda.toast("Para continuar, acepta los Términos y Condiciones y el Aviso de Privacidad.", "error");
			aceptaTerminosEl.focus();
			return;
		}
		pagarMpBtn.disabled = true;
		pagarMpBtn.textContent = "Preparando tu compra...";
		try {
			if (!session) {
				session = await asegurarSesion();
				if (!session) {
					pagarMpBtn.disabled = false;
					pagarMpBtn.innerHTML = etiquetaBoton;
					Tienda.iconos();
					return;
				}
				pintarSesion();
			}

			pagarMpBtn.textContent = "Abriendo Mercado Pago...";
			var token = Tienda.getAccessToken(session);
			// El código viaja; el precio no. El servidor vuelve a evaluar el
			// cupón con el user_id real (importa para "uno por cliente", que no
			// se puede comprobar antes de que exista la cuenta).
			var cuerpo = Object.assign({}, cuerpoPago);
			if (cuponAplicado) { cuerpo.cupon = cuponAplicado; }
			// La aceptación viaja con la compra y queda sellada en la orden.
			cuerpo.acepta_terminos = true;
			var resp = await fetch(Tienda.EDGE_BASE + "/crear-preferencia-mp", {
				method: "POST",
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(cuerpo),
			});
			var data = await resp.json();
			if (!resp.ok) {
				if (data.ya_comprado) {
					Tienda.toast(data.error || "Ya tienes esta versión.", "info");
					setTimeout(function () { location.href = "mis-compras.html"; }, 1200);
					return;
				}
				// Pedido personalizado: se acabó el cupo o se cerraron los pedidos
				// entre que se armó y este clic.
				if (data.cerrado || data.agotado) {
					aviso(data.error || "Por ahora no hay cupo para pedidos personalizados.", "error");
					bloqueDatos.classList.remove("hidden");
				}
				throw new Error(data.error || "No se pudo iniciar el pago.");
			}
			// El pedido ya quedó registrado en el servidor: el borrador local sobra.
			if (esPedido) { try { localStorage.removeItem("jissez_pedido"); } catch (_) {} }
			// El servidor devuelve el importe que realmente va a cobrar. Si no
			// coincide con el que está en pantalla —la promoción o el cupón
			// caducaron entre que se pintó el resumen y este clic— no se manda a
			// Mercado Pago con una cifra que el comprador no ha visto: se
			// repinta el total y decide él. La orden ya quedó creada al precio
			// nuevo, así que el segundo clic es coherente.
			if (data.precio != null && precioMostrado != null &&
				Number(data.precio) !== Number(precioMostrado)) {
				var subio = Number(data.precio) > Number(precioMostrado);
				// El cupón mandado no sobrevivió a la segunda evaluación (caducó,
				// se agotó, o resultó que este comprador ya lo había usado).
				cuponAplicado = data.cupon || null;
				pintarTotal(precioLista, Number(data.precio));
				if (data.cupon_motivo === "ya_usado") {
					mensajeCupon("Ya usaste este cupón en una compra anterior.", "error");
				} else if (data.cupon_motivo === "agotado") {
					mensajeCupon("Este cupón ya llegó a su límite de usos.", "error");
				} else if (data.cupon_motivo === "inexistente") {
					mensajeCupon("Ese cupón ya no está disponible.", "error");
				} else if (data.cupon_motivo === "no_mejora") {
					mensajeCupon("Tu cupón no puede bajar más este precio, así que sigue disponible para otra compra.", "info");
				}
				Tienda.toast(
					subio
						? "El precio cambió: revisa el total antes de continuar."
						: "Bajó el precio: ahora pagas " + money(data.precio) + ". Revísalo y continúa.",
					"info");
				pagarMpBtn.disabled = false;
				pagarMpBtn.innerHTML = etiquetaBoton;
				Tienda.iconos();
				return;
			}
			if (data.init_point) {
				location.href = data.init_point;
			} else {
				throw new Error("Respuesta de pago inválida.");
			}
		} catch (err) {
			Tienda.toast(err.message || "Error al iniciar el pago.", "error");
			pagarMpBtn.disabled = false;
			pagarMpBtn.innerHTML = etiquetaBoton;
			Tienda.iconos();
		}
	});
});
