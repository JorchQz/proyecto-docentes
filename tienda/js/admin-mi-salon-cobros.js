/*
	admin-mi-salon-cobros.js — Cobros de Mi Salón en la pestaña "Mi Salón" del panel (tienda/admin.html;
	b22, spec de Jorge 2026-09-26 §3, §6, §7 y §8; supabase/mi_salon_b22_cobros_2026-09.sql).

	  - Aviso de lanzamiento: cuántas cuentas que ya existían faltan de recibirlo y el botón para
	    mandarlo (con confirmación). Lo manda la Edge avisos-mi-salon con la sesión del admin, en
	    tandas, hasta que no quede ninguna; idempotente (mi_salon_correos).
	  - Precios (mi_salon_precios, editables: la RLS solo deja al admin), cupo de precio fundador,
	    fecha de corte de los compradores de la tienda y los lugares que quedan.
	  - Pagos: todas las órdenes de Mi Salón, con los pendientes de OXXO y su referencia, y las
	    métricas (pagos aprobados, cobrado, pendientes, cuántas pagaron el T2).
	  - Listas para WhatsApp por segmento con el texto listo para copiar ({url} → la compra).
	Todo sale de la RPC admin_mi_salon_cobros (exige es_admin en la base).
	Las reglas puras se prueban en pruebas/mi-salon-cobros.test.js.
*/
var AdminMiSalonCobros = (function () {
	var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
	var PRODUCTOS = { trimestre: "Trimestre", resto_ciclo: "Resto del ciclo", ciclo: "Ciclo completo", paquete_tienda: "Paquete tienda + Mi Salón" };
	var TIPOS = { fundador: "Fundador", lista: "Lista", cupon: "Cupón" };

	// ── Reglas puras ─────────────────────────────────────────────────────────────
	function fecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		return m ? Number(m[3]) + " " + MESES[Number(m[2]) - 1] + " " + m[1] : "";
	}
	function pesos(n) {
		var v = Number(n);
		if (!isFinite(v)) return "—";
		return "$" + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
	}
	function cobertura(cob) {
		return (cob || []).map(function (c) { return (c.periodos || []).join(", ") + " " + c.ciclo; }).join(" + ");
	}

	// Estado de un pago para la tabla: { texto, tono: 'ok'|'pendiente'|'gris' }
	function estadoPago(p) {
		if (p.estado === "pagado") return { texto: "Pagado", tono: "ok" };
		if (p.estado === "reembolsado") return { texto: "Reembolsado", tono: "gris" };
		if (p.estado === "fallido") return { texto: "No se pagó", tono: "gris" };
		if (p.pago_id) {
			var metodo = p.metodo === "oxxo" ? "OXXO" : (p.tipo_metodo === "ticket" ? "efectivo" : (p.tipo_metodo === "bank_transfer" ? "SPEI" : ""));
			return { texto: "Pago pendiente" + (metodo ? " (" + metodo + ")" : "") + (p.referencia ? " · ref. " + p.referencia : ""), tono: "pendiente" };
		}
		return { texto: "Sin pagar (no terminó el pago)", tono: "gris" };
	}

	function filtrarPagos(pagos, filtro) {
		return (pagos || []).filter(function (p) {
			if (!filtro) return true;
			if (filtro === "pendiente") return p.estado === "pendiente" && !!p.pago_id;
			return p.estado === filtro;
		});
	}

	// Métricas de cobros a partir de los pagos
	function metricas(pagos) {
		var m = { aprobados: 0, cobrado: 0, pendientes: 0, pagaron_t2: 0, fundador: 0, cupon: 0 };
		var t2 = {};
		(pagos || []).forEach(function (p) {
			if (p.estado === "pagado") {
				m.aprobados++;
				m.cobrado += Number(p.monto) || 0;
				if (p.tipo_precio === "fundador") m.fundador++;
				if (p.tipo_precio === "cupon") m.cupon++;
				if ((p.cobertura || []).some(function (c) { return (c.periodos || []).indexOf("T2") !== -1; })) t2[p.email] = true;
			} else if (p.estado === "pendiente" && p.pago_id) {
				m.pendientes++;
			}
		});
		m.pagaron_t2 = Object.keys(t2).length;
		return m;
	}

	// Texto de un segmento listo para copiar: {url} → la página de compra del sitio
	function textoWhatsApp(seg, origen) {
		return String(seg && seg.texto || "").split("{url}").join(String(origen || "https://jissez.com").replace(/\/+$/, "") + "/tienda/mi-salon-compra");
	}
	// Lista de un segmento para pegar en una hoja: nombre, correo y teléfono separados por tabulador
	function listaWhatsApp(seg) {
		return (seg && seg.docentes || []).map(function (d) { return [d.nombre || "", d.email || "", d.telefono || ""].join("\t"); }).join("\n");
	}

	// Valida una fila de precios → null o el problema
	function validarPrecio(p) {
		var lista = Number(p.precio_lista), fund = p.precio_fundador === "" || p.precio_fundador == null ? null : Number(p.precio_fundador);
		var nombre = (PRODUCTOS[p.producto] || p.producto) + " " + p.ciclo;
		if (!isFinite(lista) || lista <= 0) return nombre + ": el precio de lista debe ser mayor que cero.";
		if (fund !== null && (!isFinite(fund) || fund <= 0 || fund > lista)) return nombre + ": el precio fundador debe ser mayor que cero y no más que el de lista.";
		return null;
	}

	// Filas nuevas para un ciclo a partir de las del último ciclo (mismos precios, a revisar)
	function preciosCicloNuevo(precios, ciclo) {
		var ciclos = (precios || []).map(function (p) { return p.ciclo; }).sort();
		var ultimo = ciclos[ciclos.length - 1];
		return (precios || []).filter(function (p) { return p.ciclo === ultimo; }).map(function (p) {
			return { ciclo: ciclo, producto: p.producto, nombre: p.nombre, descripcion: p.descripcion, precio_lista: p.precio_lista,
				precio_fundador: p.precio_fundador, activo: p.activo, vende_hasta_periodo: p.vende_hasta_periodo, orden: p.orden, nuevo: true };
		});
	}

	// ── Interfaz ─────────────────────────────────────────────────────────────────
	var datos = null;
	var precios = [];
	var montado = false;
	var enviando = false;

	function $(id) { return document.getElementById(id); }
	function esc(s) { return window.Tienda ? window.Tienda.esc(s) : String(s == null ? "" : s); }
	function mensaje(tipo, texto) {
		var el = $("msMensaje");
		if (!el) return;
		el.textContent = texto;
		el.className = "rounded-xl px-4 py-3 text-sm font-medium " + (tipo === "error" ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200");
		el.scrollIntoView({ block: "nearest" });
	}
	function errorTexto(e) { return (e && (e.message || e.error_description || e.error)) || "No se pudo completar"; }
	function tarjeta(valor, etiqueta, nota) {
		return '<div class="rounded-xl border border-line bg-white p-3"><p class="text-2xl font-black text-ink">' + esc(valor) + '</p>' +
			'<p class="text-xs font-semibold text-mute mt-0.5">' + esc(etiqueta) + "</p>" + (nota ? '<p class="text-[11px] text-mute mt-1">' + esc(nota) + "</p>" : "") + "</div>";
	}

	function pintarLanzamiento() {
		var c = datos.config || {};
		var pend = Number(datos.lanzamiento_pendientes) || 0;
		var env = Number(datos.lanzamiento_enviados) || 0;
		$("msLanzamientoTexto").textContent = !c.abierto
			? "Se manda cuando abras Mi Salón. Hasta ahora: " + env + " enviado(s)."
			: pend + " cuenta(s) por recibirlo · " + env + " ya lo recibieron.";
		$("msLanzamientoBtn").disabled = !c.abierto || pend === 0 || enviando;
	}

	function pintarPrecios() {
		var c = datos.config || {};
		$("msCupo").value = c.cupo_fundador != null ? c.cupo_fundador : "";
		$("msCorteTienda").value = c.fundador_tienda_hasta ? String(c.fundador_tienda_hasta).slice(0, 10) : "";
		$("msLugaresTexto").textContent = datos.ciclo
			? "Ciclo en venta: " + datos.ciclo + " (" + (datos.periodo || "") + "). Quedan " + (datos.lugares_fundador == null ? "—" : datos.lugares_fundador) +
				" de " + (c.cupo_fundador == null ? "—" : c.cupo_fundador) + " lugares con precio fundador (ocupados: " + (datos.fundador_usados || 0) + ")." +
				(c.corte_tienda ? " Compradores de la tienda: compras hasta el " + fecha(c.corte_tienda) + "." : " Compradores de la tienda: cualquier compra (Mi Salón no se ha abierto).")
			: "No hay un periodo a la venta hoy.";
		if (!precios.length) { $("msPreciosTabla").innerHTML = '<p class="text-sm text-mute">No hay precios cargados.</p>'; return; }
		$("msPreciosTabla").innerHTML = '<table class="w-full text-left text-sm min-w-[820px]"><thead><tr class="text-[11px] uppercase tracking-[0.08em] text-mute">' +
			'<th class="py-2 pr-3">Ciclo</th><th class="py-2 pr-3">Producto</th><th class="py-2 pr-3">Precio de lista</th><th class="py-2 pr-3">Precio fundador</th><th class="py-2 pr-3">Se vende hasta el registro de</th><th class="py-2">A la venta</th></tr></thead><tbody>' +
			precios.map(function (p, i) {
				var bloq = p.producto === "paquete_tienda";
				return '<tr class="border-t border-line">' +
					'<td class="py-2 pr-3 font-semibold text-ink whitespace-nowrap">' + esc(p.ciclo) + "</td>" +
					'<td class="py-2 pr-3 text-ink">' + esc(p.nombre || PRODUCTOS[p.producto] || p.producto) + "</td>" +
					'<td class="py-2 pr-3"><input type="number" min="1" step="1" inputmode="numeric" data-pr="' + i + '" data-campo="precio_lista" value="' + esc(p.precio_lista) + '" aria-label="Precio de lista ' + esc(p.producto + " " + p.ciclo) + '" class="w-28 min-h-[44px] px-2 border border-line rounded-lg text-sm" style="color:#1c2434;background:#fff"></td>' +
					'<td class="py-2 pr-3"><input type="number" min="1" step="1" inputmode="numeric" data-pr="' + i + '" data-campo="precio_fundador" value="' + esc(p.precio_fundador == null ? "" : p.precio_fundador) + '" placeholder="Sin fundador" aria-label="Precio fundador ' + esc(p.producto + " " + p.ciclo) + '" class="w-28 min-h-[44px] px-2 border border-line rounded-lg text-sm" style="color:#1c2434;background:#fff"></td>' +
					'<td class="py-2 pr-3"><select data-pr="' + i + '" data-campo="vende_hasta_periodo" aria-label="Se vende hasta" class="min-h-[44px] px-2 border border-line rounded-lg text-sm" style="color:#1c2434;background:#fff">' +
						["", "T1", "T2", "T3"].map(function (v) { return '<option value="' + v + '"' + ((p.vende_hasta_periodo || "") === v ? " selected" : "") + ">" + (v ? v : "Todo el periodo de venta") + "</option>"; }).join("") + "</select></td>" +
					'<td class="py-2"><label class="inline-flex items-center gap-2 min-h-[44px] cursor-pointer"><input type="checkbox" data-pr="' + i + '" data-campo="activo"' + (p.activo ? " checked" : "") + (bloq ? " disabled" : "") + ' class="w-5 h-5"> ' + (bloq ? "Aún no" : "Sí") + "</label></td>" +
					"</tr>";
			}).join("") + "</tbody></table>";
	}

	function pintarPagos() {
		var m = metricas(datos.pagos);
		$("msPagosMetricas").innerHTML =
			tarjeta(m.aprobados, "Pagos aprobados", m.fundador + " fundador · " + m.cupon + " con cupón") +
			tarjeta(pesos(m.cobrado), "Cobrado (aprobado)") +
			tarjeta(m.pagaron_t2, "Pagaron el T2", "Docentes con un pago que cubre el T2") +
			tarjeta(m.pendientes, "Pagos pendientes", "OXXO o SPEI sin acreditar");
		var lista = filtrarPagos(datos.pagos, $("msPagosFiltro").value);
		if (!lista.length) { $("msPagos").innerHTML = '<p class="text-sm text-mute">Ningún pago con ese filtro.</p>'; return; }
		$("msPagos").innerHTML = '<table class="w-full text-left text-sm min-w-[980px]"><thead><tr class="text-[11px] uppercase tracking-[0.08em] text-mute">' +
			'<th class="py-2 pr-3">Fecha</th><th class="py-2 pr-3">Docente</th><th class="py-2 pr-3">Producto</th><th class="py-2 pr-3">Cubre</th><th class="py-2 pr-3">Vence</th><th class="py-2 pr-3">Monto</th><th class="py-2 pr-3">Precio</th><th class="py-2">Estado</th></tr></thead><tbody>' +
			lista.slice(0, 500).map(function (p) {
				var e = estadoPago(p);
				var color = e.tono === "ok" ? "background:#ecfdf5;color:#047857" : e.tono === "pendiente" ? "background:#fffbeb;color:#b45309" : "background:#f3f4f6;color:#374151";
				return '<tr class="border-t border-line align-top">' +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(fecha(p.pagado_en || p.creada)) + "</td>" +
					'<td class="py-2 pr-3"><p class="font-semibold text-ink">' + esc(p.nombre || "(sin nombre)") + '</p><p class="text-xs text-mute break-all">' + esc(p.email) + "</p></td>" +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(p.nombre_producto || PRODUCTOS[p.producto] || p.producto) + "</td>" +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(cobertura(p.cobertura)) + (p.provisional ? ' <span class="text-xs text-mute">(provisional)</span>' : "") + "</td>" +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(fecha(p.vence)) + "</td>" +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(pesos(p.monto)) + "</td>" +
					'<td class="py-2 pr-3 whitespace-nowrap">' + esc(TIPOS[p.tipo_precio] || p.tipo_precio || "") + (p.cupon ? " " + esc(p.cupon) : "") + "</td>" +
					'<td class="py-2"><span class="inline-block rounded-full px-2.5 py-1 text-xs font-semibold" style="' + color + '">' + esc(e.texto) + "</span>" +
					(p.estado === "pagado" && p.agrego === false ? '<p class="text-xs mt-1" style="color:#b91c1c">No agregó periodos nuevos: revisa si hay que reembolsar.</p>' : "") + "</td></tr>";
			}).join("") + "</tbody></table>";
	}

	function pintarWhats() {
		var segs = datos.segmentos || [];
		if (!segs.length) { $("msWhats").innerHTML = '<p class="text-sm text-mute">No hay docentes en ningún segmento por ahora.</p>'; return; }
		$("msWhats").innerHTML = segs.map(function (s, i) {
			return '<details class="rounded-2xl border border-line bg-white p-4"><summary class="cursor-pointer min-h-[44px] flex items-center justify-between gap-3">' +
				'<span><span class="font-semibold text-ink">' + esc(s.titulo) + '</span> <span class="text-sm text-mute">· ' + (s.docentes || []).length + " docente(s)</span></span></summary>" +
				'<p class="text-xs text-mute mt-2">' + esc(s.descripcion || "") + "</p>" +
				'<label class="block text-[11px] font-bold uppercase tracking-[0.1em] text-mute mt-3 mb-1.5" for="msWhatsTexto' + i + '">Texto</label>' +
				'<textarea id="msWhatsTexto' + i + '" readonly rows="4" class="w-full px-3 py-2 border border-line rounded-xl text-sm" style="color:#1c2434;background:#faf9f4">' + esc(textoWhatsApp(s, location.origin)) + "</textarea>" +
				'<div class="flex flex-wrap gap-2 mt-2">' +
				'<button type="button" data-copiar-texto="' + i + '" class="min-h-[44px] px-4 rounded-xl border border-line text-sm font-semibold text-ink hover:bg-gray-50">Copiar texto</button>' +
				'<button type="button" data-copiar-lista="' + i + '" class="min-h-[44px] px-4 rounded-xl border border-line text-sm font-semibold text-ink hover:bg-gray-50">Copiar lista (nombre, correo, teléfono)</button></div>' +
				'<ul class="mt-3 text-sm text-ink max-h-64 overflow-y-auto divide-y divide-line">' + (s.docentes || []).map(function (d) {
					return '<li class="py-1.5 flex flex-wrap gap-x-3"><span class="font-medium">' + esc(d.nombre || "(sin nombre)") + '</span><span class="text-mute break-all">' + esc(d.email) + "</span>" + (d.telefono ? '<span class="text-mute">' + esc(d.telefono) + "</span>" : "") + "</li>";
				}).join("") + "</ul></details>";
		}).join("");
	}

	function copiar(texto) {
		var ok = function () { mensaje("ok", "Copiado."); };
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(texto).then(ok, function () { mensaje("error", "No se pudo copiar; selecciona el texto y cópialo a mano."); });
		} else { mensaje("error", "Este navegador no deja copiar; selecciona el texto y cópialo a mano."); }
	}

	async function cargar() {
		montar();
		var r = await window.sb.rpc("admin_mi_salon_cobros");
		if (r.error) { mensaje("error", "No se pudieron cargar los cobros: " + errorTexto(r.error)); return; }
		datos = r.data || {};
		precios = (datos.precios || []).map(function (p) { return Object.assign({}, p); });
		pintarLanzamiento();
		pintarPrecios();
		pintarPagos();
		pintarWhats();
	}

	async function guardarCupo() {
		var cupo = Number($("msCupo").value);
		if (!isFinite(cupo) || cupo < 0 || Math.round(cupo) !== cupo) { mensaje("error", "El cupo debe ser un número entero de 0 en adelante."); return; }
		var corte = $("msCorteTienda").value ? $("msCorteTienda").value + "T23:59:59-06:00" : null;
		$("msCupoGuardar").disabled = true;
		var r = await window.sb.rpc("admin_mi_salon_guardar_fundador", { p_cupo: cupo, p_tienda_hasta: corte });
		$("msCupoGuardar").disabled = false;
		if (r.error) { mensaje("error", "No se pudo guardar: " + errorTexto(r.error)); return; }
		mensaje("ok", "Cupo y corte guardados.");
		await cargar();
	}

	async function guardarPrecios() {
		var problema = null;
		precios.forEach(function (p) { problema = problema || validarPrecio(p); });
		if (problema) { mensaje("error", problema); return; }
		$("msPreciosGuardar").disabled = true;
		var filas = precios.map(function (p) {
			return { ciclo: p.ciclo, producto: p.producto, nombre: p.nombre || PRODUCTOS[p.producto] || p.producto, descripcion: p.descripcion || null,
				precio_lista: Number(p.precio_lista), precio_fundador: p.precio_fundador === "" || p.precio_fundador == null ? null : Number(p.precio_fundador),
				activo: p.producto === "paquete_tienda" ? false : !!p.activo, vende_hasta_periodo: p.vende_hasta_periodo || null, orden: p.orden || 1 };
		});
		var r = await window.sb.from("mi_salon_precios").upsert(filas, { onConflict: "ciclo,producto" });
		$("msPreciosGuardar").disabled = false;
		if (r.error) { mensaje("error", "No se pudieron guardar los precios: " + errorTexto(r.error)); return; }
		mensaje("ok", "Precios guardados. La compra y la presentación ya usan los nuevos.");
		await cargar();
	}

	function agregarCiclo() {
		var c = window.prompt("Ciclo nuevo (por ejemplo 2027-2028). Se copian los precios del último ciclo para que los revises:");
		if (!c) return;
		c = c.trim();
		var m = /^(\d{4})-(\d{4})$/.exec(c);
		if (!m || Number(m[2]) !== Number(m[1]) + 1) { mensaje("error", "Escribe el ciclo así: 2027-2028."); return; }
		if (precios.some(function (p) { return p.ciclo === c; })) { mensaje("error", "Ese ciclo ya tiene precios."); return; }
		precios = precios.concat(preciosCicloNuevo(precios, c));
		pintarPrecios();
		mensaje("ok", "Revisa los precios del ciclo " + c + " y guarda.");
	}

	// Aviso de lanzamiento: tandas hasta que no quede ninguna (o no avance)
	async function enviarLanzamiento(sinPreguntar) {
		var pend = Number(datos && datos.lanzamiento_pendientes) || 0;
		if (!pend) return;
		if (!sinPreguntar && !window.confirm("¿Mandar ahora el aviso de lanzamiento a " + pend + " cuenta(s)? Cada cuenta lo recibe una sola vez.")) return;
		enviando = true;
		pintarLanzamiento();
		var total = 0;
		try {
			var s = await window.Tienda.getSession();
			for (var vuelta = 0; vuelta < 60; vuelta++) {
				var resp = await fetch(window.Tienda.EDGE_BASE + "/avisos-mi-salon", {
					method: "POST",
					headers: { Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" },
					body: JSON.stringify({ solo: "lanzamiento" }),
				});
				var d = await resp.json();
				if (!resp.ok) throw new Error(d && d.error || "No se pudo enviar");
				if (d.motivo === "sin_correo_configurado") throw new Error("El correo no está configurado en este proyecto (RESEND_API_KEY).");
				total += Number(d.enviados) || 0;
				$("msLanzamientoTexto").textContent = "Enviando... " + total + " enviado(s).";
				if (!d.restantes || !d.enviados) break;
			}
			mensaje("ok", "Aviso de lanzamiento: " + total + " correo(s) enviados.");
		} catch (e) {
			mensaje("error", "Aviso de lanzamiento: " + errorTexto(e) + (total ? " (" + total + " sí se enviaron)" : ""));
		} finally {
			enviando = false;
			await cargar();
		}
	}

	// Al abrir Mi Salón desde el interruptor: se ofrece mandar el aviso en ese momento
	async function alAbrir() {
		await cargar();
		if (Number(datos && datos.lanzamiento_pendientes) > 0 &&
			window.confirm("Mi Salón quedó abierto. ¿Mandar ahora el aviso de lanzamiento a las " + datos.lanzamiento_pendientes + " cuenta(s) que ya existían? Si no, sale solo con el aviso automático de cada hora.")) {
			await enviarLanzamiento(true);
		}
	}

	function montar() {
		if (montado) return;
		montado = true;
		$("msLanzamientoBtn").addEventListener("click", function () { enviarLanzamiento(false); });
		$("msCupoGuardar").addEventListener("click", guardarCupo);
		$("msPreciosGuardar").addEventListener("click", guardarPrecios);
		$("msPreciosCiclo").addEventListener("click", agregarCiclo);
		$("msPagosFiltro").addEventListener("change", pintarPagos);
		$("msPreciosTabla").addEventListener("change", function (e) {
			var t = e.target;
			if (!t || t.getAttribute("data-pr") === null) return;
			var p = precios[Number(t.getAttribute("data-pr"))];
			if (!p) return;
			var campo = t.getAttribute("data-campo");
			p[campo] = t.type === "checkbox" ? t.checked : t.value;
		});
		$("msWhats").addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("[data-copiar-texto],[data-copiar-lista]") : null;
			if (!b) return;
			var s = (datos.segmentos || [])[Number(b.getAttribute("data-copiar-texto") || b.getAttribute("data-copiar-lista"))];
			if (!s) return;
			copiar(b.hasAttribute("data-copiar-texto") ? textoWhatsApp(s, location.origin) : listaWhatsApp(s));
		});
	}

	return {
		cargar: cargar,
		alAbrir: alAbrir,
		// Reglas puras (pruebas/mi-salon-cobros.test.js)
		estadoPago: estadoPago,
		filtrarPagos: filtrarPagos,
		metricas: metricas,
		textoWhatsApp: textoWhatsApp,
		listaWhatsApp: listaWhatsApp,
		validarPrecio: validarPrecio,
		preciosCicloNuevo: preciosCicloNuevo,
	};
})();
if (typeof window !== "undefined") window.AdminMiSalonCobros = AdminMiSalonCobros;
if (typeof module !== "undefined" && module.exports) module.exports = AdminMiSalonCobros; // pruebas en node
