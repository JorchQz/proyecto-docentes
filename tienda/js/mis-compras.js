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

	var GRADO_COLOR = {
		"1": { bg: "#f2cf6b", txt: "rgba(30,58,138,.85)" },
		"2": { bg: "#ef9277", txt: "#fff" },
		"3": { bg: "#79c8a6", txt: "rgba(30,58,138,.85)" },
		"4": { bg: "#a99fe0", txt: "#fff" },
		"5": { bg: "#85b8e6", txt: "rgba(30,58,138,.85)" },
		"6": { bg: "#f0b285", txt: "rgba(30,58,138,.85)" },
	};

	// ── Regreso desde Mercado Pago ──────────────────────────────────────────
	// No creemos lo que dice la URL: el parámetro `status` lo pone Mercado Pago
	// en el navegador y puede ir por delante del webhook (o el webhook puede
	// fallar). Consultamos el pago real antes de prometer nada.
	var params = new URLSearchParams(location.search);
	var paymentId = limpio(params.get("payment_id") || params.get("collection_id"));
	var externalRef = limpio(params.get("external_reference"));
	var statusUrl = limpio(params.get("status") || params.get("collection_status"));

	if (paymentId || externalRef || statusUrl) {
		// Quitamos los parámetros para que un F5 no reprocese ni confunda.
		history.replaceState({}, "", location.pathname);
	}

	if (paymentId || externalRef) {
		banner("Confirmando tu pago con Mercado Pago...", "info", true);
		var confirmacion = await confirmarPago(
			paymentId ? { payment_id: paymentId } : { orden_id: externalRef },
		);
		mostrarResultadoConfirmacion(confirmacion);
	} else if (statusUrl === "failure") {
		banner("El pago no se completó. Puedes intentarlo de nuevo desde el catálogo.", "error");
	}

	await cargar();

	// ── Carga de datos ──────────────────────────────────────────────────────
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
		listaEl.classList.add("hidden");
		seccionPendientes.classList.add("hidden");

		var accesos = accRes.data || [];
		var pendientes = ordRes.data || [];

		renderCompras(accesos);
		renderPendientes(pendientes);

		if (!accesos.length && !pendientes.length) {
			vacio();
		}
	}

	// ── Confirmación de pago contra Mercado Pago ────────────────────────────
	async function confirmarPago(cuerpo) {
		try {
			var token = Tienda.getAccessToken(session);
			var resp = await fetch(Tienda.EDGE_BASE + "/confirmar-pago", {
				method: "POST",
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(cuerpo || {}),
			});
			var data = await resp.json();
			if (!resp.ok) { throw new Error(data.error || "No se pudo verificar el pago."); }
			return data;
		} catch (err) {
			return { error: err.message || "No se pudo verificar el pago." };
		}
	}

	function mostrarResultadoConfirmacion(data) {
		if (!data || data.error) {
			banner(
				"No pudimos verificar tu pago en este momento. Si ya pagaste, tu acceso aparecerá aquí en unos minutos; también puedes usar el botón de verificar.",
				"error",
			);
			return;
		}

		var resultados = data.resultados || [];
		if (!resultados.length) {
			banner("No encontramos pagos pendientes de confirmar.", "info");
			return;
		}

		var pagado = resultados.some(function (r) { return r.estado === "pagado"; });
		var enProceso = resultados.some(function (r) { return r.estado === "pendiente"; });
		var fallido = resultados.some(function (r) { return r.estado === "fallido"; });

		if (pagado) {
			banner("Pago confirmado. Tu paquete ya está disponible para descargar.", "ok");
		} else if (enProceso) {
			banner(
				"Tu pago está registrado pero el banco aún no lo acredita. Si pagaste en efectivo o por SPEI puede tardar de unos minutos a 3 días. Te avisaremos por correo en cuanto se active.",
				"info",
			);
		} else if (fallido) {
			banner("El pago no se completó. Puedes intentarlo de nuevo desde el catálogo.", "error");
		}
	}

	// ── Render ──────────────────────────────────────────────────────────────
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

			var avatar;
			if (prod.grado) {
				var gc = GRADO_COLOR[String(prod.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
				avatar = '<div class="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black" style="background:' + gc.bg + ';color:' + gc.txt + '">' + esc(prod.grado) + '°</div>';
			} else {
				avatar = '<div class="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center" style="background:rgba(30,58,138,.1)"><i data-lucide="library" style="width:1.6rem;height:1.6rem;color:#1e3a8a"></i></div>';
			}

			var card = document.createElement("div");
			card.className = "lift bg-white rounded-3xl border border-line p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm";
			card.innerHTML =
				'<div class="flex items-start gap-4 flex-1 min-w-0">' +
				avatar +
				'<div class="min-w-0 flex-1">' +
				'<h3 class="font-bold text-ink leading-snug">' + esc(prod.titulo || "Paquete") + "</h3>" +
				'<div class="flex flex-wrap gap-1.5 mt-2">' +
				'<span class="text-[12px] font-semibold h-6 px-2.5 rounded-full inline-flex items-center bg-paper border border-line text-mute">' + esc(etiquetaTipo) + "</span>" +
				'<span class="text-[12px] font-semibold h-6 px-2.5 rounded-full inline-flex items-center bg-paper border border-line text-mute">' + esc(versionTxt) + "</span>" +
				"</div></div></div>" +
				'<a href="biblioteca.html?acceso_id=' + encodeURIComponent(accesoId) + '" class="shrink-0 h-11 px-5 rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5 transition" style="background:#1e3a8a">Abrir biblioteca <i data-lucide="arrow-right" class="w-4 h-4"></i></a>';

			listaEl.appendChild(card);
		});
		Tienda.iconos();
	}

	function renderPendientes(ordenes) {
		if (!ordenes.length) { return; }
		seccionPendientes.classList.remove("hidden");
		listaPendientes.innerHTML = "";

		ordenes.forEach(function (o) {
			var items = o.marketplace_orden_items || [];
			var titulo = items.length && items[0].marketplace_productos
				? items[0].marketplace_productos.titulo : "Paquete";

			var div = document.createElement("div");
			div.className = "rounded-2xl p-4 flex flex-col gap-3";
			div.style.cssText = "background:#fffbeb;border:1px solid #fbbf24";
			div.innerHTML =
				'<div class="flex items-start justify-between gap-3">' +
				'<div class="min-w-0">' +
				'<p class="font-semibold text-sm" style="color:#1c2434">' + esc(titulo) + "</p>" +
				'<p class="text-xs mt-1 leading-relaxed" style="color:#b45309">Esperando que el banco confirme tu pago. En efectivo o SPEI puede tardar de unos minutos a 3 días.</p>' +
				"</div>" +
				'<span class="text-xs font-bold h-7 px-3 rounded-full inline-flex items-center shrink-0" style="background:#fef3c7;color:#b45309">En proceso</span>' +
				"</div>" +
				'<div class="flex flex-wrap items-center gap-2">' +
				'<button data-verificar="' + esc(o.id) + '" class="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-xs font-bold transition" style="background:#fff;border:1px solid #fbbf24;color:#b45309">' +
				'<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Ya pagué — verificar ahora</button>' +
				'<button data-cancelar="' + esc(o.id) + '" class="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-xs font-semibold transition" style="color:#b45309;opacity:.75">' +
				'No lo compré — quitar</button>' +
				"</div>";

			listaPendientes.appendChild(div);
		});

		listaPendientes.querySelectorAll("[data-verificar]").forEach(function (btn) {
			btn.addEventListener("click", function () { verificarOrden(btn); });
		});
		listaPendientes.querySelectorAll("[data-cancelar]").forEach(function (btn) {
			btn.addEventListener("click", function () { cancelarOrden(btn); });
		});
		Tienda.iconos();
	}

	async function verificarOrden(btn) {
		var ordenId = btn.getAttribute("data-verificar");
		btn.disabled = true;
		btn.textContent = "Verificando...";

		var data = await confirmarPago({ orden_id: ordenId });
		var r = (data && data.resultados && data.resultados[0]) || null;

		if (data && data.error) {
			Tienda.toast(data.error, "error");
		} else if (r && r.estado === "pagado") {
			Tienda.toast("Pago confirmado. Ya puedes descargar tu paquete.", "ok");
			await cargar();
			return;
		} else if (r && r.estado === "fallido") {
			// `abandonada` = nunca hubo pago y ya pasó el margen: era un intento
			// que quedó a medias, no un pago rechazado.
			Tienda.toast(
				r.statusMp === "abandonada"
					? "Ese intento de compra quedó sin completar, lo quitamos de la lista."
					: "Ese pago no se completó.",
				"info",
			);
			await cargar();
			return;
		} else {
			Tienda.toast("Aún no se acredita el pago. Te avisaremos por correo en cuanto se active.", "info");
		}

		btn.disabled = false;
		btn.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Ya pagué — verificar ahora';
		Tienda.iconos();
	}

	// Quitar de la lista un intento que el comprador sabe que no completó.
	// Si luego llegara el pago, se acredita igual: cancelar no pierde la compra.
	async function cancelarOrden(btn) {
		btn.disabled = true;
		btn.textContent = "Quitando...";
		var data = await confirmarPago({ orden_id: btn.getAttribute("data-cancelar"), accion: "cancelar" });
		if (data && data.error) {
			Tienda.toast(data.error, "error");
			btn.disabled = false;
			btn.textContent = "No lo compré — quitar";
			return;
		}
		Tienda.toast("Listo, lo quitamos de tu lista.", "ok");
		await cargar();
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

	function banner(texto, tipo, conSpinner) {
		var bg, border, color;
		if (tipo === "ok") { bg = "#f0fdf4"; border = "#86efac"; color = "#166534"; }
		else if (tipo === "error") { bg = "#fef2f2"; border = "#fca5a5"; color = "#991b1b"; }
		else { bg = "#eff6ff"; border = "#93c5fd"; color = "#1e40af"; }
		var icono = conSpinner
			? '<i data-lucide="loader-circle" class="w-4 h-4 shrink-0 animate-spin"></i>'
			: "";
		bannerEl.innerHTML =
			'<div class="rounded-2xl px-4 py-3 text-sm font-medium flex items-start gap-2.5 leading-relaxed" style="background:' + bg + ';border:1px solid ' + border + ';color:' + color + '">' +
			icono + "<span>" + esc(texto) + "</span></div>";
		Tienda.iconos();
	}

	// Mercado Pago a veces devuelve la cadena "null" en los parámetros.
	function limpio(v) {
		if (!v || v === "null" || v === "undefined") { return null; }
		return v;
	}
});
