// Formulario del proyecto a la medida.
//
// No cobra: arma el pedido, lo guarda como borrador en localStorage y manda al
// checkout (checkout.html?personalizado=1), que es quien crea la cuenta si
// hace falta, aplica cupón y abre Mercado Pago. Precio, cupo y ventana salen
// de la RPC pública marketplace_personalizados_estado.
document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	await Tienda.montarNav("");
	Tienda.montarFooter();
	var esc = Tienda.esc;
	var money = Tienda.formatMoney;

	var CLAVE_BORRADOR = "jissez_pedido";
	var COMBOS = { "1-2": "tridocente", "3-4": "tridocente", "5-6": "tridocente", "1-2-3": "bidocente", "4-5-6": "bidocente" };

	var cargandoEl = document.getElementById("cargando");
	var contenidoEl = document.getElementById("contenido");
	var estadoCupoEl = document.getElementById("estadoCupo");
	var chipsOrgEl = document.getElementById("chipsOrg");
	var bloqueGrado = document.getElementById("bloqueGrado");
	var bloqueCombo = document.getElementById("bloqueCombo");
	var chipsGradoEl = document.getElementById("chipsGrado");
	var chipsComboEl = document.getElementById("chipsCombo");
	var opcionesNivelEl = document.getElementById("opcionesNivel");
	var chipsCFEl = document.getElementById("chipsCF");
	var selContenido = document.getElementById("selContenido");
	var selPda = document.getElementById("selPda");
	var selMetodologia = document.getElementById("selMetodologia");
	var fFecha = document.getElementById("fFecha");
	var fNotas = document.getElementById("fNotas");
	var mensajeForm = document.getElementById("mensajeForm");
	var continuarBtn = document.getElementById("continuarBtn");
	var resumenEl = document.getElementById("resumen");
	var resumenPrecio = document.getElementById("resumenPrecio");
	var resumenEntrega = document.getElementById("resumenEntrega");

	// Estado del pedido. Se prellena desde la URL (llega del catálogo sin
	// resultados) o desde el borrador guardado si el maestro vuelve atrás.
	var pedido = {
		organizacion: "completa",
		grado: null,
		grados_combo: null,
		nivel: "con_anexos",
		campo_formativo: null,
		contenido_id: null,
		pda_id: null,
		metodologia: "",
		fecha_necesaria: "",
		notas: "",
	};
	var estado = null;      // respuesta de marketplace_personalizados_estado
	var contenidos = [];    // catalogo_contenidos de la fase actual
	var pdas = [];          // catalogo_pda del contenido elegido

	var params = new URLSearchParams(location.search);
	var borrador = leerBorrador();
	if (borrador && !params.get("org")) {
		Object.keys(pedido).forEach(function (k) { if (borrador[k] != null) { pedido[k] = borrador[k]; } });
	}
	if (params.get("org") === "multigrado") { pedido.organizacion = "multigrado"; }
	var gParam = (params.get("grado") || "").split(",")[0];
	if (/^[1-6]$/.test(gParam)) { pedido.grado = Number(gParam); }
	if (COMBOS[params.get("combo") || ""]) { pedido.grados_combo = params.get("combo"); pedido.organizacion = "multigrado"; }
	var cfParam = (params.get("cf") || "").split(",")[0];
	if (Tienda.CF_COLOR[cfParam]) { pedido.campo_formativo = cfParam; }
	if (params.get("contenido_id")) { pedido.contenido_id = params.get("contenido_id"); }
	if (params.get("pda_id")) { pedido.pda_id = params.get("pda_id"); }

	// ── Disponibilidad y precios ──────────────────────────────────────────────
	var res = await Promise.all([
		window.sb.rpc("marketplace_personalizados_estado"),
		Tienda.cargarPromo(),
	]);
	cargandoEl.classList.add("hidden");
	if (res[0].error || !res[0].data) {
		cargandoEl.classList.remove("hidden");
		cargandoEl.textContent = "No pudimos cargar la disponibilidad. Recarga la página.";
		return;
	}
	estado = res[0].data;
	pintarCupo();
	contenidoEl.classList.remove("hidden");

	pintarOrg();
	pintarGradoCombo();
	pintarNivel();
	pintarCF();
	selMetodologia.value = pedido.metodologia || "";
	fFecha.value = pedido.fecha_necesaria || "";
	fNotas.value = pedido.notas || "";
	await cargarContenidos();
	pintarResumen();
	Tienda.iconos();

	// ── Chips ─────────────────────────────────────────────────────────────────
	chipsOrgEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-org");
		if (!c) { return; }
		pedido.organizacion = c.getAttribute("data-org");
		pintarOrg();
		cargarContenidos().then(pintarResumen);
		pintarResumen();
	});
	chipsGradoEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-grado");
		if (!c) { return; }
		pedido.grado = Number(c.getAttribute("data-grado"));
		pintarGradoCombo();
		cargarContenidos().then(pintarResumen);
		pintarResumen();
	});
	chipsComboEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-combo");
		if (!c) { return; }
		pedido.grados_combo = c.getAttribute("data-combo");
		pintarGradoCombo();
		cargarContenidos().then(pintarResumen);
		pintarResumen();
	});
	chipsCFEl.addEventListener("click", function (e) {
		var c = e.target.closest(".chip-cf");
		if (!c) { return; }
		var cf = c.getAttribute("data-cf");
		pedido.campo_formativo = pedido.campo_formativo === cf ? null : cf;
		pintarCF();
		llenarContenidos();
		pintarResumen();
	});
	selContenido.addEventListener("change", function () {
		pedido.contenido_id = selContenido.value || null;
		pedido.pda_id = null;
		cargarPdas().then(pintarResumen);
	});
	selPda.addEventListener("change", function () {
		pedido.pda_id = selPda.value || null;
		pintarResumen();
	});
	selMetodologia.addEventListener("change", function () { pedido.metodologia = selMetodologia.value; pintarResumen(); });
	fFecha.addEventListener("change", function () { pedido.fecha_necesaria = fFecha.value; pintarResumen(); });
	fNotas.addEventListener("input", function () { pedido.notas = fNotas.value; });

	function setChip(chip, activo) {
		chip.classList.toggle("active", activo);
		chip.classList.toggle("border-line", !activo);
		chip.classList.toggle("text-ink", !activo);
	}
	function pintarOrg() {
		var multi = pedido.organizacion === "multigrado";
		chipsOrgEl.querySelectorAll(".chip-org").forEach(function (x) { setChip(x, x.getAttribute("data-org") === pedido.organizacion); });
		bloqueGrado.classList.toggle("hidden", multi);
		bloqueCombo.classList.toggle("hidden", !multi);
	}
	function pintarGradoCombo() {
		chipsGradoEl.querySelectorAll(".chip-grado").forEach(function (x) { setChip(x, Number(x.getAttribute("data-grado")) === pedido.grado); });
		chipsComboEl.querySelectorAll(".chip-combo").forEach(function (x) { setChip(x, x.getAttribute("data-combo") === pedido.grados_combo); });
	}
	function pintarCF() {
		chipsCFEl.querySelectorAll(".chip-cf").forEach(function (x) { setChip(x, x.getAttribute("data-cf") === pedido.campo_formativo); });
	}

	// ── Versión ───────────────────────────────────────────────────────────────
	function pintarNivel() {
		var opciones = [
			{ nivel: "sin_anexos", titulo: "Sin anexos", sub: "Planeación completa en PDF y Word", precio: estado.precio_sin_anexos },
			{ nivel: "con_anexos", titulo: "Con anexos", sub: "Planeación en PDF y Word + anexos imprimibles por sesión", precio: estado.precio_con_anexos },
		];
		opcionesNivelEl.innerHTML = opciones.map(function (o) {
			var sel = o.nivel === pedido.nivel;
			return '<button type="button" data-nivel="' + o.nivel + '" class="opt-btn w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3' + (sel ? " selected" : " border-line bg-white") + '">' +
				'<span class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center" style="border-color:' + (sel ? "#fff" : "#9ba3af") + '">' + (sel ? '<span class="w-2.5 h-2.5 rounded-full" style="background:#fff"></span>' : "") + "</span>" +
				'<span class="min-w-0 flex-1"><span class="block font-bold">' + esc(o.titulo) + '</span><span class="block text-[13px]' + (sel ? " opacity-90" : " text-mute") + '">' + esc(o.sub) + "</span></span>" +
				'<span class="shrink-0 text-right">' + Tienda.precioHTML(o.precio, {
					claseFinal: "font-black text-lg" + (sel ? "" : " text-ink"),
					claseLista: "text-[12px] font-bold" + (sel ? " opacity-80" : " text-mute"),
				}) + "</span></button>";
		}).join("");
		opcionesNivelEl.querySelectorAll("[data-nivel]").forEach(function (b) {
			b.addEventListener("click", function () { pedido.nivel = b.getAttribute("data-nivel"); pintarNivel(); pintarResumen(); });
		});
	}

	// ── Contenidos y PDAs del catálogo SEP ────────────────────────────────────
	function fasesActuales() {
		var grados = pedido.organizacion === "multigrado"
			? (pedido.grados_combo ? pedido.grados_combo.split("-").map(Number) : [])
			: (pedido.grado ? [pedido.grado] : []);
		// catalogo_contenidos.fase es texto ("Fase 3"), no número.
		var fases = {};
		grados.forEach(function (g) { fases["Fase " + (g <= 2 ? 3 : (g <= 4 ? 4 : 5))] = true; });
		return { grados: grados, fases: Object.keys(fases) };
	}
	async function cargarContenidos() {
		var f = fasesActuales();
		if (!f.fases.length) { contenidos = []; llenarContenidos(); return; }
		var r = await window.sb
			.from("catalogo_contenidos")
			.select("id, fase, campo_formativo, contenido, orden")
			.in("fase", f.fases)
			.order("campo_formativo").order("orden");
		contenidos = (r.data || []).map(function (c) {
			return { id: c.id, fase: c.fase, cf: window.CamposFormativos.corto(c.campo_formativo), texto: c.contenido };
		});
		llenarContenidos();
		if (pedido.contenido_id) { await cargarPdas(); }
	}
	function llenarContenidos() {
		var lista = contenidos.filter(function (c) { return !pedido.campo_formativo || c.cf === pedido.campo_formativo; });
		var existe = lista.some(function (c) { return c.id === pedido.contenido_id; });
		if (!existe) { pedido.contenido_id = null; pedido.pda_id = null; cargarPdas(); }
		selContenido.innerHTML = '<option value="">Cualquiera (lo elegimos nosotros)</option>' +
			lista.map(function (c) {
				var cfNombre = Tienda.CF_COLOR[c.cf] ? Tienda.CF_COLOR[c.cf].corto : "";
				return '<option value="' + esc(c.id) + '"' + (c.id === pedido.contenido_id ? " selected" : "") + ">" +
					(cfNombre ? esc(cfNombre) + " · " : "") + esc(c.texto) + "</option>";
			}).join("");
		selContenido.disabled = !lista.length;
	}
	async function cargarPdas() {
		if (!pedido.contenido_id) {
			pdas = [];
			selPda.innerHTML = '<option value="">Primero elige un contenido</option>';
			selPda.disabled = true;
			return;
		}
		var f = fasesActuales();
		var q = window.sb.from("catalogo_pda").select("id, grado, pda, orden").eq("contenido_id", pedido.contenido_id).order("grado").order("orden");
		if (f.grados.length) { q = q.in("grado", f.grados); }
		var r = await q;
		pdas = r.data || [];
		selPda.innerHTML = '<option value="">Cualquier PDA de este contenido</option>' +
			pdas.map(function (p) {
				return '<option value="' + esc(p.id) + '"' + (p.id === pedido.pda_id ? " selected" : "") + ">" + p.grado + "° · " + esc(p.pda) + "</option>";
			}).join("");
		selPda.disabled = !pdas.length;
		if (!pdas.some(function (p) { return p.id === pedido.pda_id; })) { pedido.pda_id = null; }
	}

	// ── Cupo ──────────────────────────────────────────────────────────────────
	function pintarCupo() {
		var cerrado = !estado.abierto;
		var agotado = Number(estado.cupos_disponibles) <= 0;
		estadoCupoEl.classList.remove("hidden");
		if (cerrado || agotado) {
			var cuando = estado.fecha_reapertura
				? new Date(estado.fecha_reapertura).toLocaleDateString("es-MX", { day: "numeric", month: "long" })
				: null;
			estadoCupoEl.style.cssText = "background:#fffbeb;border:1px solid #fcd34d;color:#92400e";
			estadoCupoEl.innerHTML = '<i data-lucide="clock" class="w-5 h-5 shrink-0 mt-0.5"></i><div>' +
				"<p class=\"font-semibold\">" + (cerrado ? "Por ahora no recibimos pedidos a la medida" : "Esta semana ya no hay cupo") + "</p>" +
				"<p>" + esc(cerrado ? (estado.mensaje || "Vuelve a intentarlo en unos días.") : ("Se libera el " + (cuando || "próximo lunes") + ". Mientras tanto, revisa los proyectos del catálogo.")) + "</p></div>";
			continuarBtn.disabled = true;
			continuarBtn.style.opacity = ".5";
			continuarBtn.innerHTML = cerrado ? "Pedidos cerrados por ahora" : "Sin cupo esta semana";
			return;
		}
		estadoCupoEl.style.cssText = "background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.25);color:#047857";
		estadoCupoEl.innerHTML = '<i data-lucide="check-circle-2" class="w-5 h-5 shrink-0 mt-0.5"></i><div>' +
			'<p class="font-semibold">Recibimos pedidos esta semana · ' + estado.cupos_disponibles + (estado.cupos_disponibles === 1 ? " lugar" : " lugares") + " disponibles</p>" +
			"<p>Entrega en tu biblioteca en un máximo de " + Math.round(estado.ventana_horas) + " horas a partir de tu pago.</p></div>";
	}

	// ── Resumen ───────────────────────────────────────────────────────────────
	function aulaTexto() {
		if (pedido.organizacion === "multigrado") {
			return pedido.grados_combo ? "Multigrado " + pedido.grados_combo.split("-").map(function (n) { return n + "°"; }).join("-") : "Elige los grados";
		}
		return pedido.grado ? pedido.grado + "° de Primaria" : "Elige el grado";
	}
	function pintarResumen() {
		var filas = [["Grupo", aulaTexto()], ["Versión", pedido.nivel === "con_anexos" ? "PDF + Word + anexos" : "PDF + Word (sin anexos)"]];
		if (pedido.campo_formativo) { filas.push(["Campo", Tienda.CF_COLOR[pedido.campo_formativo].nombre]); }
		var c = contenidos.find(function (x) { return x.id === pedido.contenido_id; });
		if (c) { filas.push(["Contenido", c.texto]); }
		var p = pdas.find(function (x) { return x.id === pedido.pda_id; });
		if (p) { filas.push(["PDA", p.grado + "° · " + p.pda]); }
		if (pedido.metodologia) { filas.push(["Metodología", pedido.metodologia]); }
		if (pedido.fecha_necesaria) { filas.push(["Lo necesitas para", pedido.fecha_necesaria]); }
		resumenEl.innerHTML = filas.map(function (f) {
			return '<div class="flex gap-3"><dt class="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-mute pt-0.5">' + esc(f[0]) + '</dt><dd class="text-ink leading-snug">' + esc(f[1]) + "</dd></div>";
		}).join("");
		var lista = Number(pedido.nivel === "con_anexos" ? estado.precio_con_anexos : estado.precio_sin_anexos);
		resumenPrecio.innerHTML = Tienda.precioHTML(lista, { claseFinal: "font-black text-ink text-2xl", claseLista: "text-mute text-base font-bold" });
		resumenEntrega.textContent = "Se paga por adelantado. Entrega comprometida: hasta " + Math.round(estado.ventana_horas) + " horas después del pago.";
	}

	// ── Continuar ─────────────────────────────────────────────────────────────
	document.getElementById("formPedido").addEventListener("submit", function (e) {
		e.preventDefault();
		var esMulti = pedido.organizacion === "multigrado";
		if (esMulti ? !pedido.grados_combo : !pedido.grado) {
			aviso(esMulti ? "Elige los grados que atiendes." : "Elige el grado.");
			return;
		}
		var borradorNuevo = {
			organizacion: pedido.organizacion,
			grado: esMulti ? null : pedido.grado,
			grados_combo: esMulti ? pedido.grados_combo : null,
			nivel: pedido.nivel,
			campo_formativo: pedido.campo_formativo,
			contenido_id: pedido.contenido_id,
			pda_id: pedido.pda_id,
			metodologia: pedido.metodologia || "",
			fecha_necesaria: pedido.fecha_necesaria || "",
			notas: (pedido.notas || "").trim(),
			// Textos para pintar el resumen en el checkout sin volver a consultar.
			contenido_texto: (contenidos.find(function (x) { return x.id === pedido.contenido_id; }) || {}).texto || null,
			pda_texto: (pdas.find(function (x) { return x.id === pedido.pda_id; }) || {}).pda || null,
			guardado_en: new Date().toISOString(),
		};
		try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borradorNuevo)); } catch (_) {
			aviso("Tu navegador no permite guardar el pedido. Activa el almacenamiento local e inténtalo de nuevo.");
			return;
		}
		location.href = "checkout.html?personalizado=1";
	});

	function aviso(texto) {
		mensajeForm.textContent = texto;
		mensajeForm.style.cssText = "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5";
		mensajeForm.classList.remove("hidden");
		mensajeForm.scrollIntoView({ behavior: "smooth", block: "center" });
	}
	function leerBorrador() {
		try {
			var raw = localStorage.getItem(CLAVE_BORRADOR);
			if (!raw) { return null; }
			var b = JSON.parse(raw);
			// Un borrador de más de un día ya no refleja lo que quiere el maestro.
			if (!b.guardado_en || Date.now() - new Date(b.guardado_en).getTime() > 24 * 60 * 60 * 1000) { return null; }
			return b;
		} catch (_) { return null; }
	}
});
