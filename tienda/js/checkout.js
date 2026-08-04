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

	// Provisional hasta saber a qué grado pertenece el paquete; se afina abajo.
	volverLink.href = "catalogo.html";

	if (!productoId || (tipo !== "pdf" && tipo !== "editable")) {
		estadoEl.textContent = "Compra inválida.";
		return;
	}

	var res = await window.sb
		.from("marketplace_productos")
		.select("id, titulo, precio_pdf, precio_editable, activo, organizacion, grado, grados_combo")
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

	// "Volver" tiene que llevar a la ficha del paquete, y esa página se
	// identifica por grado o por combinación multigrado, nunca por el id del
	// producto: con `?id=` no encontraba nada y decía "no está disponible".
	volverLink.href = p.organizacion === "multigrado"
		? "producto.html?org=multigrado&combo=" + encodeURIComponent(p.grados_combo || "")
		: "producto.html?org=completa&g=" + encodeURIComponent(p.grado || "");

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
