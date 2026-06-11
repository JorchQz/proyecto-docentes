document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	// ─────────────────────────────────────────────────────────────────────────
	// DATOS PARA PAGO POR TRANSFERENCIA — Jorge: edita estos valores.
	// ─────────────────────────────────────────────────────────────────────────
	var DATOS_TRANSFERENCIA = {
		clabe: "722969015731430609",
		banco: "Mercado Pago W",
		titular: "Jorge Ivan Martinez Quezada",
	};

	var session = await Tienda.montarNav("");
	var esc = Tienda.esc;
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
	var toggleTransferencia = document.getElementById("toggleTransferencia");
	var bloqueTransferencia = document.getElementById("bloqueTransferencia");
	var clabeTexto = document.getElementById("clabeTexto");
	var bancoTexto = document.getElementById("bancoTexto");
	var montoTransferencia = document.getElementById("montoTransferencia");
	var registrarTransferenciaBtn = document.getElementById("registrarTransferenciaBtn");
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
	clabeTexto.textContent = DATOS_TRANSFERENCIA.clabe;
	bancoTexto.textContent = DATOS_TRANSFERENCIA.banco + " · " + DATOS_TRANSFERENCIA.titular;
	montoTransferencia.textContent = money(precio);

	// ── Pago con Mercado Pago ────────────────────────────────────────────────
	pagarMpBtn.addEventListener("click", async function () {
		pagarMpBtn.disabled = true;
		pagarMpBtn.textContent = "Redirigiendo a Mercado Pago...";
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
			pagarMpBtn.textContent = "Pagar con Mercado Pago";
		}
	});

	// ── Transferencia directa ────────────────────────────────────────────────
	toggleTransferencia.addEventListener("click", function () {
		bloqueTransferencia.classList.toggle("hidden");
	});

	registrarTransferenciaBtn.addEventListener("click", async function () {
		registrarTransferenciaBtn.disabled = true;
		registrarTransferenciaBtn.textContent = "Registrando...";
		try {
			// El usuario crea su propia orden pendiente (RLS lo permite).
			var ordRes = await window.sb
				.from("marketplace_ordenes")
				.insert({
					user_id: session.user.id,
					monto_total: precio,
					estado: "pendiente",
					metodo_pago: "transferencia",
				})
				.select("id")
				.single();
			if (ordRes.error) { throw ordRes.error; }

			var itemRes = await window.sb.from("marketplace_orden_items").insert({
				orden_id: ordRes.data.id,
				producto_id: productoId,
				tipo: tipo,
				precio_unitario: precio,
			});
			if (itemRes.error) { throw itemRes.error; }

			bloqueTransferencia.innerHTML =
				'<div class="text-center py-3 flex flex-col items-center gap-2">' +
				'<i data-lucide="circle-check" style="width:2.5rem;height:2.5rem;color:#059669"></i>' +
				'<p class="font-bold text-lg" style="color:#1c2434">Compra registrada</p>' +
				'<p class="text-sm" style="color:#5b6473">En cuanto confirmemos tu transferencia activaremos tu acceso. Te avisaremos por correo.</p>' +
				'<a href="mis-compras.html" class="inline-block mt-2 font-semibold text-sm" style="color:#1e3a8a">Ir a Mis compras &rarr;</a>' +
				"</div>";
			Tienda.iconos();
		} catch (err) {
			Tienda.toast(err.message || "No se pudo registrar. Intenta de nuevo.", "error");
			registrarTransferenciaBtn.disabled = false;
			registrarTransferenciaBtn.textContent = "Ya transferí — registrar mi compra";
		}
	});
});
