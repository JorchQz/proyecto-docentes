/*
	admin-mi-salon.js — Pestaña "Mi Salón" del panel de administración (tienda/admin.html; spec de
	Jorge 2026-09-26 §8, parte de accesos; supabase/mi_salon_b21_acceso_2026-09.sql).

	  - Interruptor de lanzamiento (jissez_config.mi_salon_abierto, RPC admin_mi_salon_interruptor).
	  - Métricas: cuentas creadas, nuevas desde el lanzamiento, con grupo, las que usaron "Ponte al
	    día" (alguna captura con es_historico), boleta del periodo gratis generada y cerrada, y los
	    pagos del T2 (0 hasta que existan los cobros).
	  - Docentes: origen del acceso, periodos, vencimiento, monto y tipo de precio (RPC
	    admin_mi_salon_docentes). Filtro por estado y exportación a Excel por estado (para los
	    avisos por WhatsApp).
	  - Dar o extender acceso (regalo_admin o piloto) y quitar uno dado a mano por error.
	  - Calendario de periodos (mi_salon_periodos; lo escribe solo el admin por RLS).
	El panel solo se muestra a la cuenta admin (admin.js, Tienda.esAdmin); todas las RPC exigen
	es_admin() en la base. Precios y cupo fundador: los agrega el módulo de cobros (#msPrecios).
	Las reglas puras se prueban en pruebas/mi-salon-acceso.test.js.
*/
var AdminMiSalon = (function () {
	var URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
	var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
	var ESTADOS = { vigente: "Vigente", por_vencer: "Por vencer", solo_lectura: "Solo lectura" };
	var ORIGENES = { gratis_t1: "Gratis T1", pago: "Pago", piloto: "Piloto", regalo_admin: "Regalo" };
	var PRECIOS = { fundador: "Fundador", lista: "Lista", cupon: "Cupón" };
	var CAMPOS_PERIODO = [
		["venta_desde", "Se vende desde"],
		["compra_tardia_desde", "Compra tardía desde"],
		["registro_calificaciones", "Registro de calificaciones"],
		["boletas_fin", "Fin de entrega de boletas"],
		["vence", "Vence el acceso"],
	];

	// ── Reglas puras ─────────────────────────────────────────────────────────────
	// "2026-12-18" → "18 dic 2026"
	function fecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		return m ? Number(m[3]) + " " + MESES[Number(m[2]) - 1] + " " + m[1] : "";
	}

	function periodosTexto(p) {
		return Array.isArray(p) && p.length ? p.join(", ") : "";
	}

	// Filtra la lista por estado y por texto (nombre o correo, sin acentos ni mayúsculas)
	function normal(s) {
		return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
	}
	function filtrar(docentes, estado, texto) {
		var t = normal(texto).trim();
		return (docentes || []).filter(function (d) {
			if (estado && d.estado !== estado) return false;
			if (t && normal(d.nombre).indexOf(t) === -1 && normal(d.email).indexOf(t) === -1) return false;
			return true;
		});
	}

	// Métricas a partir de la lista (la misma que se ve y se exporta)
	function metricas(docentes, config) {
		var desde = config && config.mi_salon_abierto_desde ? Date.parse(config.mi_salon_abierto_desde) : null;
		var m = { cuentas: 0, nuevas: 0, con_grupo: 0, ponte_al_dia: 0, boleta: 0, boleta_cerrada: 0, pagaron_t2: 0, vigente: 0, por_vencer: 0, solo_lectura: 0 };
		(docentes || []).forEach(function (d) {
			m.cuentas++;
			if (desde !== null && Date.parse(d.creada) >= desde) m.nuevas++;
			if (d.grupos > 0) m.con_grupo++;
			if (d.ponte_al_dia) m.ponte_al_dia++;
			if (d.boleta_gratis) m.boleta++;
			if (d.boleta_gratis_cerrada) m.boleta_cerrada++;
			if ((d.accesos || []).some(function (a) { return a.origen === "pago" && Array.isArray(a.periodos) && a.periodos.indexOf("T2") !== -1; })) m.pagaron_t2++;
			if (m[d.estado] !== undefined) m[d.estado]++;
		});
		return m;
	}

	// Filas para Excel (una por docente)
	function filasExcel(docentes) {
		return (docentes || []).map(function (d) {
			return {
				Nombre: d.nombre || "",
				Correo: d.email || "",
				Estado: ESTADOS[d.estado] || d.estado || "",
				Origen: ORIGENES[d.origen] || d.origen || "",
				Periodos: periodosTexto(d.periodos),
				Ciclo: d.ciclo || "",
				Vence: d.vence || "",
				"Monto pagado": d.precio_pagado === null || d.precio_pagado === undefined ? "" : Number(d.precio_pagado),
				"Tipo de precio": PRECIOS[d.tipo_precio] || d.tipo_precio || "",
				"Cuenta creada": d.creada ? String(d.creada).slice(0, 10) : "",
				Grupos: d.grupos || 0,
				"Usó Ponte al día": d.ponte_al_dia ? "Sí" : "No",
				"Boleta del T1": d.boleta_gratis_cerrada ? "Cerrada" : d.boleta_gratis ? "Generada" : "No",
			};
		});
	}

	function nombreArchivo(estado, hoy) {
		return "mi-salon-docentes-" + (estado ? estado.replace(/_/g, "-") : "todos") + "-" + String(hoy || "").slice(0, 10) + ".xlsx";
	}

	// Valida el calendario antes de guardar → null o el texto del problema
	function validarPeriodo(p) {
		var f = CAMPOS_PERIODO.map(function (c) { return p[c[0]]; });
		if (f.some(function (v) { return !/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")); })) return p.ciclo + " " + p.periodo + ": faltan fechas.";
		for (var i = 1; i < f.length; i++) {
			if (f[i] < f[i - 1]) return p.ciclo + " " + p.periodo + ": \"" + CAMPOS_PERIODO[i][1] + "\" no puede ir antes de \"" + CAMPOS_PERIODO[i - 1][1] + "\".";
		}
		return null;
	}

	// ── Interfaz ─────────────────────────────────────────────────────────────────
	var datos = null;      // respuesta de admin_mi_salon_docentes
	var periodos = [];     // filas de mi_salon_periodos
	var cargando = false;
	var montado = false;

	function $(id) { return document.getElementById(id); }
	function esc(s) { return window.Tienda ? window.Tienda.esc(s) : String(s == null ? "" : s); }
	function iconos() { if (window.Tienda && window.Tienda.iconos) window.Tienda.iconos(); }

	function mensaje(tipo, texto) {
		var el = $("msMensaje");
		if (!el) return;
		if (!texto) { el.classList.add("hidden"); el.textContent = ""; return; }
		el.textContent = texto;
		el.className = "rounded-xl px-4 py-3 text-sm font-medium " + (tipo === "error" ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200");
		el.scrollIntoView({ block: "nearest" });
	}

	function errorTexto(e) {
		return (e && (e.message || e.error_description)) || "No se pudo completar";
	}

	function pintarInterruptor() {
		var c = datos && datos.config;
		var btn = $("msInterruptorBtn");
		var txt = $("msInterruptorTexto");
		if (!c) return;
		btn.disabled = false;
		if (c.mi_salon_abierto) {
			txt.innerHTML = '<span class="font-semibold" style="color:#047857">Encendido.</span> Mi Salón está abierto para todas las cuentas' +
				(c.mi_salon_abierto_desde ? " desde el " + esc(fecha(String(c.mi_salon_abierto_desde).slice(0, 10))) : "") + ".";
			btn.textContent = "Cerrar Mi Salón";
			btn.style.background = "#b45309";
		} else {
			txt.innerHTML = '<span class="font-semibold text-ink">Apagado.</span> Solo el piloto ve Mi Salón.';
			btn.textContent = "Abrir Mi Salón";
			btn.style.background = "#059669";
		}
	}

	function tarjeta(valor, etiqueta, nota) {
		return '<div class="rounded-xl border border-line bg-white p-3"><p class="text-2xl font-black text-ink">' + esc(valor) + '</p>' +
			'<p class="text-xs font-semibold text-mute mt-0.5">' + esc(etiqueta) + "</p>" + (nota ? '<p class="text-[11px] text-mute mt-1">' + esc(nota) + "</p>" : "") + "</div>";
	}

	function pintarMetricas() {
		var m = metricas(datos.docentes, datos.config);
		$("msMetricas").innerHTML =
			tarjeta(m.cuentas, "Cuentas creadas") +
			tarjeta(datos.config && datos.config.mi_salon_abierto_desde ? m.nuevas : "—", "Nuevas desde el lanzamiento") +
			tarjeta(m.con_grupo, "Con grupo en Mi Salón") +
			tarjeta(m.ponte_al_dia, "Usaron “Ponte al día”") +
			tarjeta(m.boleta, "Generaron boleta del T1", m.boleta_cerrada + " cerrada(s)") +
			tarjeta(m.pagaron_t2, "Pagaron el T2", "Con un acceso pagado que incluye el T2") +
			tarjeta(m.vigente + m.por_vencer, "Con acceso vigente", m.por_vencer + " por vencer") +
			tarjeta(m.solo_lectura, "En solo lectura");
	}

	function badge(estado) {
		var c = estado === "vigente" ? "background:#ecfdf5;color:#047857" : estado === "por_vencer" ? "background:#fffbeb;color:#b45309" : "background:#f3f4f6;color:#374151";
		return '<span class="inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style="' + c + '">' + esc(ESTADOS[estado] || estado) + "</span>";
	}

	function accesosHtml(d) {
		return (d.accesos || []).map(function (a) {
			var quitable = a.origen === "regalo_admin" || a.origen === "piloto";
			return '<div class="flex items-center gap-2 text-xs text-mute whitespace-nowrap">' +
				"<span>" + esc(ORIGENES[a.origen] || a.origen) + " " + esc(a.ciclo) + (a.periodos && a.periodos.length ? " " + esc(periodosTexto(a.periodos)) : "") +
				(a.vence ? " → " + esc(fecha(a.vence)) : " → (ciclo sin cargar)") + "</span>" +
				(quitable ? '<button type="button" data-quitar="' + esc(a.id) + '" class="min-h-[44px] px-2 font-semibold text-red-700 hover:underline">Quitar</button>' : "") +
				"</div>";
		}).join("");
	}

	function pintarDocentes() {
		var lista = filtrar(datos.docentes, $("msFiltro").value, $("msBuscar").value);
		var cont = $("msDocentes");
		if (!lista.length) {
			cont.innerHTML = '<p class="text-sm text-mute">Ninguna cuenta con ese filtro.</p>';
			return;
		}
		var MAX = 300;
		var filas = lista.slice(0, MAX).map(function (d) {
			return "<tr class=\"border-t border-line align-top\">" +
				'<td class="py-2 pr-3"><p class="font-semibold text-ink">' + esc(d.nombre || "(sin nombre)") + '</p><p class="text-xs text-mute break-all">' + esc(d.email) + "</p></td>" +
				'<td class="py-2 pr-3">' + badge(d.estado) + "</td>" +
				'<td class="py-2 pr-3 whitespace-nowrap">' + esc(ORIGENES[d.origen] || "—") + "</td>" +
				'<td class="py-2 pr-3 whitespace-nowrap">' + esc(periodosTexto(d.periodos) || "—") + "</td>" +
				'<td class="py-2 pr-3 whitespace-nowrap">' + esc(d.vence ? fecha(d.vence) : "—") + "</td>" +
				'<td class="py-2 pr-3 whitespace-nowrap">' + (d.precio_pagado === null || d.precio_pagado === undefined ? "—" : esc(window.Tienda ? window.Tienda.formatMoney(d.precio_pagado) : d.precio_pagado)) + "</td>" +
				'<td class="py-2 pr-3 whitespace-nowrap">' + esc(PRECIOS[d.tipo_precio] || "—") + "</td>" +
				'<td class="py-2 pr-3">' + accesosHtml(d) + "</td>" +
				'<td class="py-2"><button type="button" data-dar="' + esc(d.email) + '" class="min-h-[44px] px-3 rounded-lg border border-line text-xs font-semibold text-ink hover:bg-gray-50 whitespace-nowrap">Dar acceso</button></td>' +
				"</tr>";
		}).join("");
		cont.innerHTML = '<table class="w-full text-left text-sm min-w-[980px]"><thead><tr class="text-[11px] uppercase tracking-[0.08em] text-mute">' +
			'<th class="py-2 pr-3">Docente</th><th class="py-2 pr-3">Estado</th><th class="py-2 pr-3">Origen</th><th class="py-2 pr-3">Periodos</th>' +
			'<th class="py-2 pr-3">Vence</th><th class="py-2 pr-3">Monto</th><th class="py-2 pr-3">Precio</th><th class="py-2 pr-3">Accesos</th><th class="py-2"><span class="sr-only">Acciones</span></th></tr></thead>' +
			"<tbody>" + filas + "</tbody></table>" +
			(lista.length > MAX ? '<p class="text-xs text-mute mt-2">Se muestran ' + MAX + " de " + lista.length + ". Usa la búsqueda o exporta a Excel para verlas todas.</p>" : "");
	}

	// ── Calendario de periodos ──
	function pintarPeriodos() {
		var cont = $("msPeriodos");
		if (!periodos.length) { cont.innerHTML = '<p class="text-sm text-mute">No hay periodos cargados.</p>'; return; }
		cont.innerHTML = '<table class="w-full text-left text-sm min-w-[860px]"><thead><tr class="text-[11px] uppercase tracking-[0.08em] text-mute">' +
			'<th class="py-2 pr-3">Ciclo</th><th class="py-2 pr-3">Periodo</th>' +
			CAMPOS_PERIODO.map(function (c) { return '<th class="py-2 pr-3">' + esc(c[1]) + "</th>"; }).join("") + "</tr></thead><tbody>" +
			periodos.map(function (p, i) {
				return '<tr class="border-t border-line">' +
					'<td class="py-2 pr-3 font-semibold text-ink whitespace-nowrap">' + esc(p.ciclo) + "</td>" +
					'<td class="py-2 pr-3 font-semibold text-ink">' + esc(p.periodo) + "</td>" +
					CAMPOS_PERIODO.map(function (c) {
						return '<td class="py-2 pr-3"><input type="date" data-per="' + i + '" data-campo="' + c[0] + '" value="' + esc(p[c[0]] || "") +
							'" aria-label="' + esc(p.ciclo + " " + p.periodo + ": " + c[1]) + '" class="min-h-[44px] px-2 border border-line rounded-lg text-sm" style="color:#1c2434;background:#fff"></td>';
					}).join("") + "</tr>";
			}).join("") + "</tbody></table>";
	}

	function pintarDar() {
		var ciclos = periodos.map(function (p) { return p.ciclo; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
		var sel = $("msDarCiclo");
		var previo = sel.value;
		sel.innerHTML = ciclos.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
		if (previo && ciclos.indexOf(previo) !== -1) sel.value = previo;
		pintarDarPeriodos();
	}

	function pintarDarPeriodos() {
		var ciclo = $("msDarCiclo").value;
		var marcados = Array.prototype.map.call(document.querySelectorAll("#msDarPeriodos input:checked"), function (x) { return x.value; });
		$("msDarPeriodos").innerHTML = periodos.filter(function (p) { return p.ciclo === ciclo; }).map(function (p) {
			return '<label class="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-xl border border-line text-sm cursor-pointer">' +
				'<input type="checkbox" value="' + esc(p.periodo) + '"' + (marcados.indexOf(p.periodo) !== -1 ? " checked" : "") + ' class="w-4 h-4">' +
				esc(p.periodo) + ' <span class="text-xs text-mute">vence ' + esc(fecha(p.vence)) + "</span></label>";
		}).join("");
		resumenDar();
	}

	function resumenDar() {
		var ciclo = $("msDarCiclo").value;
		var sel = Array.prototype.map.call(document.querySelectorAll("#msDarPeriodos input:checked"), function (x) { return x.value; });
		var fijo = $("msDarVence").value;
		var vences = periodos.filter(function (p) { return p.ciclo === ciclo && sel.indexOf(p.periodo) !== -1; }).map(function (p) { return p.vence; });
		if (fijo) vences.push(fijo);
		vences.sort();
		$("msDarResumen").textContent = vences.length ? "Este acceso vence el " + fecha(vences[vences.length - 1]) + "." : "";
	}

	async function cargarPeriodos() {
		var r = await window.sb.from("mi_salon_periodos").select("*").order("ciclo").order("orden");
		if (r.error) throw r.error;
		periodos = r.data || [];
	}

	async function cargarDocentes() {
		var r = await window.sb.rpc("admin_mi_salon_docentes");
		if (r.error) throw r.error;
		datos = r.data || { docentes: [] };
	}

	async function cargar() {
		if (cargando) return;
		cargando = true;
		montar();
		try {
			await Promise.all([cargarPeriodos(), cargarDocentes()]);
			pintarInterruptor();
			pintarMetricas();
			pintarDocentes();
			pintarPeriodos();
			pintarDar();
			iconos();
			// Cobros (b22): precios, cupo fundador, pagos, lanzamiento y WhatsApp
			if (window.AdminMiSalonCobros) window.AdminMiSalonCobros.cargar();
		} catch (e) {
			console.error("admin Mi Salón:", e);
			mensaje("error", "No se pudo cargar Mi Salón: " + errorTexto(e));
		} finally {
			cargando = false;
		}
	}

	function cargarXlsx() {
		if (window.XLSX) return Promise.resolve(window.XLSX);
		return new Promise(function (ok, mal) {
			var s = document.createElement("script");
			s.src = URL_SHEETJS;
			s.onload = function () { window.XLSX ? ok(window.XLSX) : mal(new Error("No se cargó la librería de Excel")); };
			s.onerror = function () { mal(new Error("No se pudo descargar la librería de Excel")); };
			document.head.appendChild(s);
		});
	}

	async function exportar() {
		if (!datos) return;
		var btn = $("msExportar");
		var estado = $("msFiltro").value;
		var lista = filtrar(datos.docentes, estado, $("msBuscar").value);
		btn.disabled = true;
		try {
			var X = await cargarXlsx();
			var hoja = X.utils.json_to_sheet(filasExcel(lista));
			var libro = X.utils.book_new();
			X.utils.book_append_sheet(libro, hoja, "Docentes");
			X.writeFile(libro, nombreArchivo(estado, datos.hoy));
		} catch (e) {
			mensaje("error", errorTexto(e));
		} finally {
			btn.disabled = false;
		}
	}

	async function alternar() {
		var c = datos && datos.config;
		if (!c) return;
		var abrir = !c.mi_salon_abierto;
		var pregunta = abrir
			? "¿Abrir Mi Salón para todas las cuentas? Toda cuenta verá Mi Salón y las cuentas nuevas recibirán el correo de bienvenida."
			: "¿Cerrar Mi Salón? Solo el piloto volverá a verlo. Nadie pierde datos.";
		if (!window.confirm(pregunta)) return;
		var btn = $("msInterruptorBtn");
		btn.disabled = true;
		var r = await window.sb.rpc("admin_mi_salon_interruptor", { p_abierto: abrir });
		if (r.error) { btn.disabled = false; mensaje("error", "No se pudo cambiar: " + errorTexto(r.error)); return; }
		datos.config = r.data;
		pintarInterruptor();
		pintarMetricas();
		mensaje("ok", abrir ? "Mi Salón quedó abierto." : "Mi Salón quedó cerrado (solo el piloto).");
		// Al abrir: se ofrece mandar el aviso de lanzamiento a las cuentas que ya existían (b22)
		if (abrir && window.AdminMiSalonCobros) window.AdminMiSalonCobros.alAbrir();
	}

	async function darAcceso() {
		var email = $("msDarEmail").value.trim();
		var ciclo = $("msDarCiclo").value;
		var sel = Array.prototype.map.call(document.querySelectorAll("#msDarPeriodos input:checked"), function (x) { return x.value; });
		var fijo = $("msDarVence").value || null;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { mensaje("error", "Escribe el correo de la cuenta."); return; }
		if (!sel.length && !fijo) { mensaje("error", "Elige al menos un periodo o una fecha."); return; }
		var btn = $("msDarBtn");
		btn.disabled = true;
		var r = await window.sb.rpc("admin_mi_salon_dar_acceso", {
			p_email: email, p_ciclo: ciclo, p_periodos: sel, p_vence_fijo: fijo,
			p_notas: $("msDarNotas").value.trim() || null, p_origen: $("msDarOrigen").value,
		});
		btn.disabled = false;
		if (r.error) { mensaje("error", "No se pudo dar el acceso: " + errorTexto(r.error)); return; }
		mensaje("ok", "Listo: " + email + " tiene el acceso (" + (ORIGENES[r.data && r.data.origen] || "") + ").");
		$("msDarNotas").value = "";
		$("msDarVence").value = "";
		await cargar();
	}

	async function quitarAcceso(id) {
		if (!window.confirm("¿Quitar este acceso? La cuenta no pierde datos; si no le queda otro acceso vigente, pasa a solo lectura.")) return;
		var r = await window.sb.rpc("admin_mi_salon_quitar_acceso", { p_id: id });
		if (r.error) { mensaje("error", "No se pudo quitar: " + errorTexto(r.error)); return; }
		mensaje("ok", "Acceso quitado.");
		await cargar();
	}

	async function guardarPeriodos() {
		var problema = null;
		periodos.forEach(function (p) { problema = problema || validarPeriodo(p); });
		if (problema) { mensaje("error", problema); return; }
		var btn = $("msPeriodosGuardar");
		btn.disabled = true;
		var filas = periodos.map(function (p) {
			var f = { ciclo: p.ciclo, periodo: p.periodo, orden: p.orden };
			CAMPOS_PERIODO.forEach(function (c) { f[c[0]] = p[c[0]]; });
			return f;
		});
		var r = await window.sb.from("mi_salon_periodos").upsert(filas, { onConflict: "ciclo,periodo" });
		btn.disabled = false;
		if (r.error) { mensaje("error", "No se pudo guardar el calendario: " + errorTexto(r.error)); return; }
		mensaje("ok", "Calendario guardado. Los accesos ya usan las fechas nuevas.");
		await cargar();
	}

	function agregarCiclo() {
		var c = $("msNuevoCiclo").value.trim();
		var m = /^(\d{4})-(\d{4})$/.exec(c);
		if (!m || Number(m[2]) !== Number(m[1]) + 1) { mensaje("error", "Escribe el ciclo así: 2027-2028."); return; }
		if (periodos.some(function (p) { return p.ciclo === c; })) { mensaje("error", "Ese ciclo ya está en el calendario."); return; }
		["T1", "T2", "T3"].forEach(function (per, i) {
			periodos.push({ ciclo: c, periodo: per, orden: i + 1, venta_desde: "", compra_tardia_desde: "", registro_calificaciones: "", boletas_fin: "", vence: "" });
		});
		$("msNuevoCiclo").value = "";
		pintarPeriodos();
		mensaje("ok", "Llena las fechas del ciclo " + c + " y guarda el calendario.");
	}

	function montar() {
		if (montado) return;
		montado = true;
		$("msInterruptorBtn").addEventListener("click", alternar);
		$("msFiltro").addEventListener("change", pintarDocentes);
		$("msBuscar").addEventListener("input", pintarDocentes);
		$("msExportar").addEventListener("click", exportar);
		$("msDarBtn").addEventListener("click", darAcceso);
		$("msDarCiclo").addEventListener("change", pintarDarPeriodos);
		$("msDarPeriodos").addEventListener("change", resumenDar);
		$("msDarVence").addEventListener("change", resumenDar);
		$("msPeriodosGuardar").addEventListener("click", guardarPeriodos);
		$("msNuevoCicloBtn").addEventListener("click", agregarCiclo);
		$("msPeriodos").addEventListener("change", function (e) {
			var t = e.target;
			if (!t || !t.getAttribute("data-per")) return;
			var p = periodos[Number(t.getAttribute("data-per"))];
			if (p) p[t.getAttribute("data-campo")] = t.value;
		});
		$("msDocentes").addEventListener("click", function (e) {
			var q = e.target.closest ? e.target.closest("[data-quitar]") : null;
			if (q) { quitarAcceso(q.getAttribute("data-quitar")); return; }
			var d = e.target.closest ? e.target.closest("[data-dar]") : null;
			if (d) {
				$("msDarEmail").value = d.getAttribute("data-dar");
				$("msDarSeccion").scrollIntoView({ behavior: "smooth", block: "start" });
				$("msDarEmail").focus({ preventScroll: true });
			}
		});
	}

	return {
		cargar: cargar,
		// Reglas puras (pruebas/mi-salon-acceso.test.js)
		fecha: fecha,
		filtrar: filtrar,
		metricas: metricas,
		filasExcel: filasExcel,
		nombreArchivo: nombreArchivo,
		validarPeriodo: validarPeriodo,
	};
})();
if (typeof window !== "undefined") window.AdminMiSalon = AdminMiSalon;
if (typeof module !== "undefined" && module.exports) module.exports = AdminMiSalon; // pruebas en node
