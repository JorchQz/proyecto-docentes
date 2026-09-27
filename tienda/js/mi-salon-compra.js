/*
	mi-salon-compra.js — Compra y renovación de Mi Salón (tienda/mi-salon-compra.html; b22, spec de
	Jorge 2026-09-26 §3, §5.2 y §6).

	El navegador NO calcula precios ni coberturas: todo sale de la base con la sesión de la cuenta
	(RPC mi_salon_opciones: opciones del periodo de venta, precio fundador / de lista / con cupón,
	qué periodos cubre, "Quedan N lugares", el estado del acceso y el pago pendiente). Aquí solo
	se pinta y se manda a la Edge comprar-mi-salon, que vuelve a cotizar en el servidor y crea la
	preferencia de Mercado Pago. El acceso lo crea el webhook con el pago aprobado.

	Parámetros: ?producto=trimestre|resto_ciclo|ciclo (preseleccionado), ?cupon=CODIGO,
	?orden=<id>[&payment_id=...] (regreso de Mercado Pago: se verifica con confirmar-pago).
	Reglas puras (MiSalonCompra) probadas en pruebas/mi-salon-cobros.test.js.
*/
var MiSalonCompra = (function () {
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
		"septiembre", "octubre", "noviembre", "diciembre"];
	var ORDINAL = { T1: "primer trimestre", T2: "segundo trimestre", T3: "tercer trimestre" };
	var ORIGEN = { gratis_t1: "primer trimestre gratis", pago: "acceso pagado", piloto: "piloto de Mi Salón", regalo_admin: "acceso otorgado por Jissez" };

	// "2027-04-09" → "9 de abril de 2027" (sin Date: nada de husos horarios)
	function fechaLarga(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		return m ? Number(m[3]) + " de " + MESES[Number(m[2]) - 1] + " de " + m[1] : "";
	}

	function pesos(n) {
		var v = Number(n);
		if (!isFinite(v)) return "";
		return "$" + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
	}

	// "el segundo trimestre" o "el primer trimestre del ciclo 2027-2028" (si es de otro ciclo)
	function nombrePeriodo(sig, cicloCompra) {
		if (!sig || !sig.periodo) return "";
		var base = ORDINAL[sig.periodo] || sig.periodo;
		return "el " + base + (sig.ciclo && cicloCompra && sig.ciclo !== cicloCompra ? " del ciclo " + sig.ciclo : "");
	}

	function lista(items) {
		items = (items || []).filter(Boolean);
		return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}

	// Qué cubre: "T1 y T2 del ciclo 2026-2027" / "T3 del ciclo 2026-2027 y T1 del ciclo 2027-2028"
	function textoCobertura(cob) {
		return lista((cob || []).map(function (c) { return lista(c.periodos || []) + " del ciclo " + c.ciclo; }));
	}

	/*
		Lo que se muestra en grande antes de pagar (spec §6):
		  { principal: "Tu acceso será válido hasta el 9 de abril de 2027", extras: [...] }
		Compra tardía: "Incluye también el segundo trimestre sin costo extra". Ciclo siguiente sin
		calendario: vence provisional y se extiende solo.
	*/
	function textoValidez(cot) {
		if (!cot || !cot.vence_acceso) return null;
		var extras = [];
		if (cot.compra_tardia && cot.siguiente) {
			extras.push("Incluye también " + nombrePeriodo(cot.siguiente, cot.ciclo) + " sin costo extra.");
		}
		if (cot.provisional) {
			extras.push("Cuando se publique el calendario del ciclo " + (cot.siguiente && cot.siguiente.ciclo || "siguiente") +
				", tu acceso se extiende solo hasta el final de ese periodo.");
		}
		return { principal: "Tu acceso será válido hasta el " + fechaLarga(cot.vence_acceso), extras: extras };
	}

	// Por qué una opción no se puede comprar
	function motivoTexto(motivo) {
		return {
			ya_cubierto: "Ya tienes acceso a esos periodos.",
			fuera_de_venta: "Ya no está a la venta en este periodo.",
			no_se_vende: "No está a la venta en este ciclo.",
			sin_periodo: "Todavía no hay un periodo a la venta.",
			sin_calendario: "La venta abre cuando se publique el calendario del ciclo siguiente.",
		}[motivo] || "No está disponible por ahora.";
	}

	// "Quedan 37 lugares con precio fundador" (contador real; nada si no hay precio fundador)
	function textoLugares(n) {
		n = Number(n);
		if (!isFinite(n) || n <= 0) return null;
		return n === 1 ? "Queda 1 lugar con precio fundador" : "Quedan " + n + " lugares con precio fundador";
	}

	// Renglones de la cuenta: [{ etiqueta, monto, tipo: 'base'|'descuento' }]
	function renglones(cot) {
		if (!cot || cot.precio_lista == null) return [];
		var r = [{ etiqueta: "Precio de lista", monto: Number(cot.precio_lista), tipo: "base" }];
		var desc = Number(cot.precio_lista) - Number(cot.precio_final);
		if (desc > 0) {
			var etiqueta = cot.tipo_precio === "fundador"
				? (cot.motivo_fundador === "tienda" ? "Precio fundador (compraste en la tienda)" : "Precio fundador")
				: "Cupón " + (cot.cupon_codigo || "");
			r.push({ etiqueta: etiqueta, monto: -desc, tipo: "descuento" });
		}
		return r;
	}

	// Mensaje del cupón tras cotizar: { texto, tipo: 'ok'|'info'|'error' } o null
	function mensajeCupon(cot) {
		var c = cot && cot.cupon;
		if (!c) return null;
		if (c.aplicado) return { texto: "Cupón " + c.codigo + " aplicado sobre el precio de lista.", tipo: "ok" };
		if (c.motivo === "fundador_mejor") return { texto: c.mensaje, tipo: "info" };
		return { texto: c.mensaje || "Ese cupón no se pudo aplicar.", tipo: "error" };
	}

	// Estado del acceso actual, en una línea
	function textoEstado(e) {
		if (!e || typeof e !== "object") return null;
		if (e.vigente && e.vence) return "Tu acceso actual (" + (ORIGEN[e.origen] || "Mi Salón") + ") es válido hasta el " + fechaLarga(e.vence) + ".";
		if (e.vence) return "Tu acceso terminó el " + fechaLarga(e.vence) + ". Tus datos están guardados.";
		return "Todavía no tienes un acceso a Mi Salón.";
	}

	// "Renovar" si ya tuvo acceso; si no, "Comprar"
	function titulo(e) {
		return e && e.tiene_acceso ? "Renovar tu acceso a Mi Salón" : "Tu acceso a Mi Salón";
	}

	// Qué opción se preselecciona: la pedida si se puede comprar; si no, la primera disponible
	function elegirInicial(productos, pedido) {
		var disp = (productos || []).filter(function (p) { return p && p.disponible; });
		var pedida = disp.filter(function (p) { return p.producto === pedido; })[0];
		return pedida ? pedida.producto : (disp[0] ? disp[0].producto : null);
	}

	// Pago pendiente: texto del método
	function metodoTexto(p) {
		if (!p) return "";
		if (p.metodo === "oxxo") return "en efectivo en OXXO";
		if (p.tipo_metodo === "ticket") return "en efectivo";
		if (p.tipo_metodo === "bank_transfer") return "por transferencia SPEI";
		return "";
	}

	return {
		fechaLarga: fechaLarga, pesos: pesos, nombrePeriodo: nombrePeriodo, textoCobertura: textoCobertura,
		textoValidez: textoValidez, motivoTexto: motivoTexto, textoLugares: textoLugares, renglones: renglones,
		mensajeCupon: mensajeCupon, textoEstado: textoEstado, titulo: titulo, elegirInicial: elegirInicial, metodoTexto: metodoTexto,
	};
})();
if (typeof module !== "undefined" && module.exports) module.exports = MiSalonCompra; // pruebas en node

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb || !window.Tienda) return;
	var M = MiSalonCompra;
	var esc = Tienda.esc;
	var $ = function (id) { return document.getElementById(id); };
	var params = new URLSearchParams(location.search);

	var session = await Tienda.montarNav("", { seccion: "salon" });
	Tienda.montarFooter();
	if (!session) { session = await Tienda.requireSession(); if (!session) return; }

	var datos = null;          // respuesta de mi_salon_opciones
	var elegido = params.get("producto");
	var cupon = (params.get("cupon") || "").trim().toUpperCase() || null;
	var nuevoPago = false;     // "Pagar de otra forma" con un pago pendiente
	var precioMostrado = null;

	function cot() {
		return datos && (datos.productos || []).filter(function (p) { return p.producto === elegido; })[0] || null;
	}

	async function cargar() {
		var r = await window.sb.rpc("mi_salon_opciones", { p_cupon: cupon });
		if (r.error || !r.data) {
			$("msCargando").textContent = "No pudimos cargar las opciones. Recarga la página.";
			return false;
		}
		datos = r.data;
		elegido = M.elegirInicial(datos.productos, elegido);
		return true;
	}

	function pintarEstado() {
		var e = datos.estado;
		$("msTitulo").textContent = M.titulo(e);
		document.title = M.titulo(e) + " — Jissez";
		var t = M.textoEstado(e);
		$("msEstadoActual").textContent = t || "";
		$("msEstadoActual").classList.toggle("hidden", !t);
	}

	function pintarPendiente() {
		var p = datos.pendiente;
		var el = $("msPendiente");
		if (!p) { el.classList.add("hidden"); el.innerHTML = ""; return; }
		el.classList.remove("hidden");
		el.innerHTML =
			'<div class="flex items-start gap-3"><span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:#fef3c7;color:#b45309"><i data-lucide="clock" class="w-5 h-5"></i></span>' +
			'<div class="min-w-0"><p class="font-bold" style="color:#78350f">Pago pendiente</p>' +
			'<p class="text-sm mt-0.5" style="color:#92400e">Tu pago de ' + esc(M.pesos(p.monto)) + " (" + esc(p.nombre) + ") " + esc(M.metodoTexto(p)) +
			" todavía no se refleja. Cuando se acredite, tu acceso se activa solo y te avisamos por correo.</p>" +
			(p.referencia ? '<p class="text-sm mt-1" style="color:#78350f">Referencia de pago: <strong class="font-mono">' + esc(p.referencia) + "</strong></p>" : "") +
			"</div></div>" +
			'<div class="flex flex-wrap gap-2">' +
			(p.ticket_url ? '<a href="' + esc(p.ticket_url) + '" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white" style="background:#b45309"><i data-lucide="receipt" class="w-4 h-4"></i> Ver mi ficha de pago</a>' : "") +
			'<button type="button" id="msVerificar" class="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold" style="background:#fff;border:1px solid #fbbf24;color:#b45309"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Ya pagué, verificar</button>' +
			'<button type="button" id="msOtraForma" class="inline-flex items-center min-h-[44px] px-3 rounded-xl text-sm font-semibold" style="color:#b45309">Pagar de otra forma</button>' +
			"</div>";
		$("msVerificar").addEventListener("click", function () { verificar({ orden_id: p.orden_id }, $("msVerificar")); });
		$("msOtraForma").addEventListener("click", function () {
			nuevoPago = true;
			Tienda.toast("Puedes elegir otra forma de pago. Si el pago en efectivo se acredita después, no se pierde: se suma a tu acceso.", "info");
			$("msContenido").scrollIntoView({ behavior: "smooth", block: "start" });
		});
		Tienda.iconos();
	}

	function pintarOpciones() {
		var lista = datos.productos || [];
		$("msOpciones").innerHTML = lista.map(function (p) {
			var disp = !!p.disponible;
			var sel = p.producto === elegido;
			var precio = p.precio_final != null
				? '<span class="text-xl font-black text-ink">' + esc(M.pesos(p.precio_final)) + "</span>" +
					(Number(p.precio_lista) > Number(p.precio_final) ? ' <span class="text-sm text-mute line-through">' + esc(M.pesos(p.precio_lista)) + "</span>" : "")
				: (p.precio_lista != null ? '<span class="text-xl font-black text-mute">' + esc(M.pesos(p.precio_lista)) + "</span>" : "");
			var detalle = disp
				? "Cubre " + esc(M.textoCobertura(p.cobertura)) + ". Hasta el " + esc(M.fechaLarga(p.vence)) + "."
				: esc(M.motivoTexto(p.motivo));
			return '<label class="flex items-start gap-3 rounded-2xl border p-4 ' + (disp ? "cursor-pointer hover:bg-paper" : "opacity-60 cursor-not-allowed") + '" style="border-color:' + (sel ? "#059669" : "#e7e6df") + (sel ? ";box-shadow:0 0 0 1px #059669" : "") + '">' +
				'<input type="radio" name="msProducto" value="' + esc(p.producto) + '" class="mt-1 w-5 h-5 shrink-0" style="accent-color:#059669"' + (sel ? " checked" : "") + (disp ? "" : " disabled") + ">" +
				'<span class="min-w-0 flex-1"><span class="flex flex-wrap items-baseline justify-between gap-2"><span class="font-bold text-ink">' + esc(p.nombre || p.producto) + "</span><span>" + precio + "</span></span>" +
				'<span class="block text-sm text-mute mt-1">' + detalle + "</span>" +
				(disp && p.tipo_precio === "fundador" ? '<span class="inline-block mt-2 text-[11px] font-bold px-2 py-1 rounded-full" style="background:#ecfdf5;color:#047857">Precio fundador</span>' : "") +
				"</span></label>";
		}).join("");
		Array.prototype.forEach.call(document.querySelectorAll("input[name=msProducto]"), function (r) {
			r.addEventListener("change", function () { elegido = r.value; pintar(); });
		});
	}

	function pintarResumen() {
		var c = cot();
		var v = M.textoValidez(c);
		$("msVigenciaTexto").textContent = v ? v.principal : "Elige una opción para ver hasta cuándo es válida.";
		$("msVigenciaExtra").innerHTML = v ? v.extras.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") : "";
		$("msResumenTitulo").textContent = c ? "Mi Salón · " + (c.nombre || c.producto) : "Mi Salón";
		$("msResumenCubre").textContent = c && c.cobertura ? "Cubre " + M.textoCobertura(c.cobertura) : "";
		var lug = c && c.precio_fundador != null ? M.textoLugares(c.lugares_fundador) : null;
		$("msLugares").classList.toggle("hidden", !lug);
		$("msLugares").querySelector("span").textContent = lug || "";
		$("msCuenta").innerHTML = M.renglones(c).map(function (r) {
			return '<div class="flex justify-between items-baseline gap-3"><span class="text-mute">' + esc(r.etiqueta) + '</span><span class="font-semibold whitespace-nowrap" style="color:' + (r.tipo === "descuento" ? "#047857" : "#1c2434") + '">' +
				(r.monto < 0 ? "−" + esc(M.pesos(-r.monto)) : esc(M.pesos(r.monto))) + "</span></div>";
		}).join("");
		precioMostrado = c && c.disponible ? Number(c.precio_final) : null;
		$("msTotal").textContent = precioMostrado != null ? M.pesos(precioMostrado) + " MXN" : "—";
		var mc = M.mensajeCupon(c);
		var el = $("msCuponMensaje");
		el.classList.toggle("hidden", !mc);
		if (mc) {
			el.textContent = mc.texto;
			el.style.color = mc.tipo === "ok" ? "#047857" : (mc.tipo === "info" ? "#1e3a8a" : "#b91c1c");
		}
		$("msPagar").disabled = !(c && c.disponible);
	}

	function pintar() {
		pintarEstado();
		pintarPendiente();
		$("msCargando").classList.add("hidden");
		var hay = (datos.productos || []).some(function (p) { return p.disponible; });
		if (!datos.venta_abierta || !hay) {
			$("msContenido").classList.add("hidden");
			var cerrado = $("msCerrado");
			cerrado.classList.remove("hidden");
			cerrado.innerHTML = !datos.venta_abierta
				? '<p class="font-bold text-lg">La compra de Mi Salón todavía no está disponible.</p><p class="text-mute mt-1">Te avisaremos por correo cuando abra.</p>'
				: '<p class="font-bold text-lg">Por ahora no hay nada que comprar.</p><p class="text-mute mt-1">' +
					esc((datos.productos || []).map(function (p) { return (p.nombre || p.producto) + ": " + M.motivoTexto(p.motivo); }).join(" ") || "Todavía no hay un periodo a la venta.") + "</p>" +
					'<a href="../dashboard.html" class="mt-4 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl font-semibold text-white" style="background:#1e3a8a">Ir a Mi Salón</a>';
			Tienda.iconos();
			return;
		}
		$("msCerrado").classList.add("hidden");
		$("msContenido").classList.remove("hidden");
		if (cupon) $("msCupon").value = cupon;
		pintarOpciones();
		pintarResumen();
		Tienda.iconos();
	}

	// ── Regreso de Mercado Pago y "Ya pagué, verificar" ──
	async function verificar(cuerpo, boton) {
		if (boton) { boton.disabled = true; boton.textContent = "Verificando..."; }
		var res = $("msResultado");
		var r = null;
		try {
			var token = Tienda.getAccessToken(session);
			var resp = await fetch(Tienda.EDGE_BASE + "/confirmar-pago", {
				method: "POST",
				headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
				body: JSON.stringify(cuerpo),
			});
			var data = await resp.json();
			r = data && data.resultados && data.resultados[0];
		} catch (_) { r = null; }
		await cargar();
		pintar();
		var estado = r && r.estado;
		var e = datos.estado || {};
		res.classList.remove("hidden");
		if (estado === "pagado") {
			res.style.cssText = "background:#ecfdf5;border:1px solid #6ee7b7";
			res.innerHTML = '<span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:#d1fae5;color:#047857"><i data-lucide="check" class="w-5 h-5"></i></span>' +
				'<div class="flex-1 min-w-0"><p class="font-bold" style="color:#065f46">Listo, tu pago quedó confirmado.</p>' +
				'<p class="text-sm mt-0.5" style="color:#047857">' + esc(e.vence ? "Tu acceso es válido hasta el " + M.fechaLarga(e.vence) + "." : "Tu acceso está activo.") + " Te mandamos el comprobante por correo.</p></div>" +
				'<a href="../dashboard.html" class="shrink-0 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-bold text-white" style="background:#059669">Entrar a Mi Salón <i data-lucide="arrow-right" class="w-4 h-4"></i></a>';
		} else if (estado === "fallido") {
			res.style.cssText = "background:#fef2f2;border:1px solid #fecaca";
			res.innerHTML = '<div class="flex-1"><p class="font-bold" style="color:#991b1b">El pago no se completó.</p><p class="text-sm mt-0.5" style="color:#b91c1c">No se hizo ningún cargo. Puedes intentarlo de nuevo con otra forma de pago.</p></div>';
		} else if (estado === "pendiente" || datos.pendiente) {
			res.classList.add("hidden"); // lo dice el bloque de "Pago pendiente"
		} else {
			res.style.cssText = "background:#eff6ff;border:1px solid #bfdbfe";
			res.innerHTML = '<div class="flex-1"><p class="font-bold" style="color:#1e3a8a">Estamos confirmando tu pago.</p><p class="text-sm mt-0.5" style="color:#1e40af">En cuanto Mercado Pago lo confirme, tu acceso se activa solo y te avisamos por correo.</p></div>';
		}
		Tienda.iconos();
		if (boton) { boton.disabled = false; boton.textContent = "Ya pagué, verificar"; }
	}

	// ── Cupón ──
	async function aplicarCupon() {
		var v = ($("msCupon").value || "").trim().toUpperCase();
		cupon = v || null;
		$("msAplicarCupon").disabled = true;
		if (await cargar()) pintar();
		$("msAplicarCupon").disabled = false;
	}
	$("msAplicarCupon").addEventListener("click", aplicarCupon);
	$("msCupon").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); aplicarCupon(); } });

	// ── Pagar ──
	var etiquetaBoton = $("msPagar").innerHTML;
	$("msPagar").addEventListener("click", async function () {
		var c = cot();
		if (!c || !c.disponible) return;
		if (!$("aceptaTerminos").checked) {
			Tienda.toast("Para continuar, acepta los Términos y Condiciones y el Aviso de Privacidad.", "error");
			$("aceptaTerminos").focus();
			return;
		}
		var btn = $("msPagar");
		btn.disabled = true;
		btn.textContent = "Abriendo Mercado Pago...";
		try {
			var resp = await fetch(Tienda.EDGE_BASE + "/comprar-mi-salon", {
				method: "POST",
				headers: { Authorization: "Bearer " + Tienda.getAccessToken(session), "Content-Type": "application/json" },
				body: JSON.stringify({ producto: c.producto, cupon: cupon, acepta_terminos: true, nuevo: nuevoPago }),
			});
			var data = await resp.json();
			if (!resp.ok) {
				if (data && data.motivo === "pago_pendiente") {
					await cargar(); pintar();
					Tienda.toast("Tienes un pago pendiente. Si ya pagaste, espera a que se acredite; si no, elige \"Pagar de otra forma\".", "info");
					$("msPendiente").scrollIntoView({ behavior: "smooth", block: "center" });
					return;
				}
				throw new Error((data && data.error) || "No se pudo iniciar el pago.");
			}
			// El servidor cobra lo que calcula él: si no coincide con lo que se ve, se repinta y se pregunta
			if (data.precio != null && precioMostrado != null && Number(data.precio) !== Number(precioMostrado)) {
				await cargar(); pintar();
				Tienda.toast("El precio cambió: revisa el total antes de continuar.", "info");
				return;
			}
			if (!data.init_point) throw new Error("Respuesta de pago inválida.");
			location.href = data.init_point;
			return;
		} catch (err) {
			Tienda.toast(err.message || "Error al iniciar el pago.", "error");
		} finally {
			btn.disabled = false;
			btn.innerHTML = etiquetaBoton;
			Tienda.iconos();
		}
	});

	if (!(await cargar())) return;
	pintar();
	var ordenRegreso = params.get("orden");
	var pagoRegreso = params.get("payment_id") || params.get("collection_id");
	if (ordenRegreso || pagoRegreso) {
		verificar(pagoRegreso && /^\d+$/.test(pagoRegreso) ? { payment_id: pagoRegreso } : { orden_id: ordenRegreso }, null);
	}
});
