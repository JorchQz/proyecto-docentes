document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	// Todo el cobro pasa por Mercado Pago (Checkout Pro): ahí el comprador elige
	// cuenta MP, tarjeta, dos tarjetas, efectivo o transferencia SPEI, y la
	// entrega se activa sola. No hay confirmación manual de por medio.

	var session = await Tienda.montarNav("");
	var money = Tienda.formatMoney;

	var estadoEl = document.getElementById("estado");
	var contenidoEl = document.getElementById("contenido");
	var resumenTitulo = document.getElementById("resumenTitulo");
	var resumenTipo = document.getElementById("resumenTipo");
	var resumenPrecio = document.getElementById("resumenPrecio");
	var bloqueLogin = document.getElementById("bloqueLogin");
	var bloquePago = document.getElementById("bloquePago");
	var irLoginBtn = document.getElementById("irLoginBtn");
	var usuarioEmail = document.getElementById("usuarioEmail");
	var pagarMpBtn = document.getElementById("pagarMpBtn");
	var volverLink = document.getElementById("volverLink");

	var params = new URLSearchParams(location.search);
	var productoId = params.get("producto_id");
	var tipo = params.get("tipo");

	volverLink.href = productoId ? "producto.html?id=" + encodeURIComponent(productoId) : "catalogo.html";

	if (!productoId || (tipo !== "pdf" && tipo !== "editable")) {
		estadoEl.textContent = "Compra inválida.";
		return;
	}

	var res = await window.sb
		.from("marketplace_productos")
		.select("id, titulo, precio_pdf, precio_editable, activo")
		.eq("id", productoId)
		.eq("activo", true)
		.maybeSingle();

	if (res.error || !res.data) {
		estadoEl.textContent = "Este paquete no está disponible.";
		return;
	}
	var p = res.data;
	var precio = tipo === "pdf" ? p.precio_pdf : p.precio_editable;
	if (precio == null) {
		estadoEl.textContent = "Esta versión no tiene precio configurado.";
		return;
	}

	// Resumen
	resumenTitulo.textContent = p.titulo;
	resumenTipo.textContent = tipo === "pdf" ? "Versión PDF" : "Versión editable (Word) — incluye PDF";
	resumenPrecio.textContent = money(precio);

	// Con el add-on de Word mostramos de dónde sale el total: el PDF cuesta lo
	// mismo que suelto y el resto es exactamente el precio del editable.
	if (tipo === "editable" && p.precio_pdf != null) {
		var addon = Number(p.precio_editable) - Number(p.precio_pdf);
		if (addon > 0) {
			document.getElementById("desglosePdf").textContent = money(p.precio_pdf);
			document.getElementById("desgloseWord").textContent = "+ " + money(addon);
			document.getElementById("resumenDesglose").classList.remove("hidden");
			document.getElementById("filaTotal").style.borderTop = "1px solid #e7e6df";
			document.getElementById("filaTotal").style.marginTop = "0.5rem";
		}
	}

	estadoEl.classList.add("hidden");
	contenidoEl.classList.remove("hidden");

	if (!session) {
		bloqueLogin.classList.remove("hidden");
		var next = "checkout.html?producto_id=" + encodeURIComponent(productoId) + "&tipo=" + tipo;
		irLoginBtn.href = "login.html?next=" + encodeURIComponent(next);
		return;
	}

	// Sesión activa
	bloquePago.classList.remove("hidden");
	usuarioEmail.textContent = session.user.email || "";

	var etiquetaBoton = pagarMpBtn.innerHTML;

	pagarMpBtn.addEventListener("click", async function () {
		pagarMpBtn.disabled = true;
		pagarMpBtn.textContent = "Abriendo Mercado Pago...";
		try {
			var token = Tienda.getAccessToken(session);
			var resp = await fetch(Tienda.EDGE_BASE + "/crear-preferencia-mp", {
				method: "POST",
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ producto_id: productoId, tipo: tipo }),
			});
			var data = await resp.json();
			if (!resp.ok) {
				if (data.ya_comprado) {
					Tienda.toast("Ya tienes esta versión.", "info");
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
