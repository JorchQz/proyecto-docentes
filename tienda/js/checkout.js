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
	var mensajeDatos = document.getElementById("mensajeDatos");

	var params = new URLSearchParams(location.search);
	var productoId = params.get("producto_id");
	var tipo = params.get("tipo");

	// Compra combinada del paquete unitario (llega desde el catálogo):
	// checkout.html?combo=unitaria&agrupacion=...&tipo_paquete=...[&trimestre=n]&tipo=...
	var esCombo = params.get("combo") === "unitaria";
	var comboAgrupacion = params.get("agrupacion");
	var comboTipoPaquete = params.get("tipo_paquete");
	var comboTrimestre = Number(params.get("trimestre"));
	var COMBOS_UNITARIA = { tridocente: ["1-2", "3-4", "5-6"], bidocente: ["1-2-3", "4-5-6"] };

	// Provisional hasta saber a qué grado pertenece el paquete; se afina abajo.
	volverLink.href = "catalogo.html";

	var comboValido = esCombo && COMBOS_UNITARIA[comboAgrupacion] &&
		(comboTipoPaquete === "ciclo" ||
			(comboTipoPaquete === "trimestre" && [1, 2, 3].indexOf(comboTrimestre) !== -1));

	if ((tipo !== "pdf" && tipo !== "editable") || (esCombo ? !comboValido : !productoId)) {
		estadoEl.textContent = "Compra inválida.";
		return;
	}

	// Lo que se manda a crear-preferencia-mp; lo llena prepararCombo o
	// prepararIndividual. El precio NUNCA viaja aquí: lo calcula el servidor.
	var cuerpoPago = null;

	if (!(esCombo ? await prepararCombo() : await prepararIndividual())) { return; }

	/** Compra normal de un solo paquete: resumen y cuerpo del pago. */
	async function prepararIndividual() {
		var res = await window.sb
			.from("marketplace_productos")
			.select("id, titulo, precio_pdf, precio_editable, activo, organizacion, grado, grados_combo")
			.eq("id", productoId)
			.eq("activo", true)
			.maybeSingle();

		if (res.error || !res.data) {
			estadoEl.textContent = "Este paquete no está disponible.";
			return false;
		}
		var p = res.data;
		var precio = tipo === "pdf" ? p.precio_pdf : p.precio_editable;
		if (precio == null) {
			estadoEl.textContent = "Esta versión no tiene precio configurado.";
			return false;
		}

		// "Volver" tiene que llevar a la ficha del paquete, y esa página se
		// identifica por grado o por combinación multigrado, nunca por el id del
		// producto: con `?id=` no encontraba nada y decía "no está disponible".
		volverLink.href = p.organizacion === "multigrado"
			? "producto.html?org=multigrado&combo=" + encodeURIComponent(p.grados_combo || "")
			: "producto.html?org=completa&g=" + encodeURIComponent(p.grado || "");

		// Resumen
		resumenTitulo.textContent = p.titulo;
		resumenTipo.textContent = tipo === "pdf" ? "Versión PDF" : "Versión editable — planeación, anexos y examen en PDF y Word";
		resumenPrecio.textContent = money(precio);

		// Con el add-on de Word mostramos de dónde sale el total: el PDF cuesta lo
		// mismo que suelto y el resto es exactamente el precio del editable.
		if (tipo === "editable" && p.precio_pdf != null) {
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
		volverLink.href = "producto.html?org=multigrado&combo=unitaria";

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

		var precioPdf = Number(tarifaRes.data.precio_pdf);
		var total = tipo === "pdf" ? precioPdf : Number(tarifaRes.data.precio_editable);

		resumenTitulo.textContent = "Paquete unitario · 1° a 6° de Primaria";
		var etiquetaPaquete = comboTipoPaquete === "ciclo" ? "Ciclo completo" : "Trimestre " + comboTrimestre;
		resumenTipo.textContent = etiquetaPaquete + " · " +
			(tipo === "pdf" ? "Versión PDF" : "Versión editable — planeación, anexos y examen en PDF y Word");
		resumenPrecio.textContent = money(total);

		// Qué paquetes incluye y cuánto costarían por separado. El tachado solo
		// aparece cuando por separado sale de verdad más caro.
		var separado = 0;
		var itemsHtml = esperados.map(function (combo) {
			var p = productos.find(function (x) { return x.grados_combo === combo; });
			var precio = tipo === "pdf" ? p.precio_pdf : p.precio_editable;
			separado += precio != null ? Number(precio) : 0;
			return '<li class="flex items-center gap-2 text-[13px]" style="color:#1c2434">' +
				'<i data-lucide="check" class="w-4 h-4 shrink-0" style="color:#059669"></i>' +
				Tienda.esc(p.titulo) + '</li>';
		}).join("");

		var resumenCombo = document.getElementById("resumenCombo");
		resumenCombo.innerHTML =
			'<p class="text-[11px] font-bold uppercase tracking-[0.1em] text-mute mb-2">Incluye ' + productos.length + ' paquetes multigrado</p>' +
			'<ul class="flex flex-col gap-1.5">' + itemsHtml + '</ul>' +
			(separado > total
				? '<p class="mt-2.5 text-[13px]" style="color:#5b6473">Por separado: <s>' + money(separado) + '</s> · ahorras <span class="font-bold" style="color:#059669">' + money(separado - total) + '</span></p>'
				: '');
		resumenCombo.classList.remove("hidden");

		if (tipo === "editable" && total > precioPdf) {
			mostrarDesglose(precioPdf, total - precioPdf);
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

	function mostrarDesglose(precioPdf, addon) {
		if (addon <= 0) { return; }
		document.getElementById("desglosePdf").textContent = money(precioPdf);
		document.getElementById("desgloseWord").textContent = "+ " + money(addon);
		document.getElementById("resumenDesglose").classList.remove("hidden");
		document.getElementById("filaTotal").style.borderTop = "1px solid #e7e6df";
		document.getElementById("filaTotal").style.marginTop = "0.5rem";
	}

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
			var resp = await fetch(Tienda.EDGE_BASE + "/crear-preferencia-mp", {
				method: "POST",
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(cuerpoPago),
			});
			var data = await resp.json();
			if (!resp.ok) {
				if (data.ya_comprado) {
					Tienda.toast(data.error || "Ya tienes esta versión.", "info");
					setTimeout(function () { location.href = "mis-compras.html"; }, 1200);
					return;
				}
				throw new Error(data.error || "No se pudo iniciar el pago.");
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
