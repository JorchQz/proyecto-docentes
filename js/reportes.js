document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	// ── Estado global ──────────────────────────────────────────────
	let userId    = null;
	let grupoId   = null;
	let grupNombre = "";
	let alumnos   = [];

	const CAMPOS = [
		"Lenguajes",
		"Saberes y Pensamiento Científico",
		"Ética, Naturaleza y Sociedades",
		"De lo Humano y lo Comunitario",
	];
	const CAMPOS_CORTOS = ["Lenguajes", "Sab. Cient.", "Ética/Soc.", "Humano/Com."];
	// Códigos cortos en el MISMO orden que CAMPOS (el motor y boleta_trimestral los usan)
	const CODIGOS = ["LEN", "SAB", "ETI", "DHL"];

	// ── Inicialización ─────────────────────────────────────────────
	const { data: { session }, error: sessErr } = await window.sb.auth.getSession();
	if (sessErr || !session) { window.location.href = "index.html"; return; }
	userId = session.user.id;

	// Grupo activo (con 2+ grupos, el maestro lo elige en el menú de la barra)
	const { grupo } = await window.GrupoActivo.cargar(window.sb, userId);
	if (!grupo) { window.location.href = "onboarding.html"; return; }
	grupoId   = grupo.id;
	grupNombre = grupo.nombre || "Grupo";

	const { data: als, error: errorAlumnos } = await window.sb
		.from("alumnos")
		.select("id, nombre_completo, num_lista, grado")
		.eq("maestro_id", userId)
		.eq("grupo_id", grupoId)
		.eq("estatus", "activo")
		.order("grado").order("num_lista");
	if (errorAlumnos) {
		// Sin la lista no hay reportes que generar: se dice en vez de dejar selectores vacíos
		console.error("reportes: alumnos", errorAlumnos);
		const aviso = document.createElement("div");
		aviso.className = "max-w-3xl mx-auto mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
		aviso.textContent = "No se pudo cargar la lista de alumnos. Recarga la página para intentarlo de nuevo.";
		(document.querySelector("main") || document.body).prepend(aviso);
		return;
	}
	alumnos = als || [];

	// Todos los selectores de trimestre arrancan en el trimestre actual del grupo
	["selectTrimestre", "selectTrimestreConc", "selectTrimBoleta", "selectTrimPda", "selectTrimFalta"].forEach(function (id) {
		const sel = document.getElementById(id);
		if (sel && grupo.trimestre_actual) sel.value = String(grupo.trimestre_actual);
	});

	// ── Tabs ───────────────────────────────────────────────────────
	/*
		En pantallas angostas (390 px) las pestañas no caben y se desplazan de lado: un degradado
		con flecha en cada borde avisa que hay más de ese lado, y la pestaña elegida se lleva a
		la vista (solo la barra se mueve, nunca la página).
	*/
	const tabsBarra = document.getElementById("tabsBarra");
	const tabsMasIzq = document.getElementById("tabsMasIzq");
	const tabsMasDer = document.getElementById("tabsMasDer");
	function marcarBordesTabs() {
		if (!tabsBarra) return;
		const resto = tabsBarra.scrollWidth - tabsBarra.clientWidth - tabsBarra.scrollLeft;
		if (tabsMasIzq) tabsMasIzq.classList.toggle("hidden", tabsBarra.scrollLeft <= 2);
		if (tabsMasDer) tabsMasDer.classList.toggle("hidden", resto <= 2);
	}
	function tabALaVista(btn, suave) {
		if (!tabsBarra || !btn) return;
		const margen = 40; // el ancho del degradado: la pestaña no queda debajo de él
		const izq = btn.offsetLeft - tabsBarra.offsetLeft;
		const der = izq + btn.offsetWidth;
		let destino = tabsBarra.scrollLeft;
		if (izq - margen < tabsBarra.scrollLeft) destino = Math.max(0, izq - margen);
		else if (der + margen > tabsBarra.scrollLeft + tabsBarra.clientWidth) destino = der + margen - tabsBarra.clientWidth;
		if (destino === tabsBarra.scrollLeft) { marcarBordesTabs(); return; }
		if (suave && typeof tabsBarra.scrollTo === "function") tabsBarra.scrollTo({ left: destino, behavior: "smooth" });
		else tabsBarra.scrollLeft = destino;
		marcarBordesTabs();
	}
	if (tabsBarra && typeof tabsBarra.addEventListener === "function") {
		tabsBarra.addEventListener("scroll", marcarBordesTabs, { passive: true });
		if (typeof window.addEventListener === "function") window.addEventListener("resize", marcarBordesTabs);
		marcarBordesTabs();
		// La pestaña activa al cargar (la primera) ya está a la vista; si no, se lleva
		tabALaVista(tabsBarra.querySelector(".tab-btn.border-blue-600"), false);
	}

	document.querySelectorAll(".tab-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			const tab = btn.dataset.tab;
			tabALaVista(btn, true);
			document.querySelectorAll(".tab-btn").forEach(function (b) {
				b.classList.remove("text-blue-700", "border-blue-600", "bg-blue-50");
				b.classList.add("text-gray-500", "border-transparent");
			});
			btn.classList.add("text-blue-700", "border-blue-600", "bg-blue-50");
			btn.classList.remove("text-gray-500", "border-transparent");

			// Se ocultan TODOS los paneles: la lista sale de las pestañas, para que
			// agregar una nueva no deje dos paneles encima del otro.
			document.querySelectorAll(".tab-btn").forEach(function (b) {
				var panel = document.getElementById("panel" + b.dataset.tab.charAt(0).toUpperCase() + b.dataset.tab.slice(1));
				if (panel) panel.classList.add("hidden");
			});
			document.getElementById("panel" + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.remove("hidden");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// TAB 1 — ASISTENCIA
	// ═══════════════════════════════════════════════════════════════
	document.getElementById("generateReportBtn").addEventListener("click", async function () {
		const start = document.getElementById("startDate").value;
		const end   = document.getElementById("endDate").value;
		const cont  = document.getElementById("reportContainer");

		if (!start || !end) {
			cont.innerHTML = "<p class='text-red-500 text-sm'>Selecciona un rango de fechas.</p>";
			return;
		}
		cont.innerHTML = "<p class='text-gray-400 text-sm'>Generando...</p>";

		// Un trimestre de un grupo pasa de 1000 asistencias: se lee por páginas (js/leer-todo.js)
		let data = null, error = null;
		try {
			data = await window.LeerTodo.paginas(function () {
				return window.sb.from("asistencias").select("alumno_id, asistencia_estado")
					.eq("maestro_id", userId).eq("grupo_id", grupoId)
					.gte("fecha", start).lte("fecha", end).order("id");
			});
		} catch (e) { error = e; }

		if (error) { cont.innerHTML = "<p class='text-red-500 text-sm'>Error al cargar datos.</p>"; return; }

		const mapa = {};
		alumnos.forEach(function (al) {
			mapa[al.id] = { nombre: al.nombre_completo, num: al.num_lista, presente: 0, ausente: 0, justificada: 0 };
		});
		(data || []).forEach(function (r) {
			if (!mapa[r.alumno_id]) return;
			if (r.asistencia_estado === "presente")   mapa[r.alumno_id].presente++;
			if (r.asistencia_estado === "ausente")    mapa[r.alumno_id].ausente++;
			if (r.asistencia_estado === "justificada") mapa[r.alumno_id].justificada++;
		});

		const filas = Object.values(mapa).sort(function (a, b) { return (a.num || 0) - (b.num || 0); });
		if (!filas.length) { cont.innerHTML = "<p class='text-gray-400'>Sin datos para este período.</p>"; return; }

		let html = "<h3 class='font-bold text-gray-800 mb-3'>Asistencia del " + start + " al " + end + "</h3>" +
			"<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-4 py-3 text-left'>No.</th><th class='px-4 py-3 text-left'>Alumno</th>" +
			"<th class='px-4 py-3 text-center'>Presentes</th><th class='px-4 py-3 text-center'>Faltas</th>" +
			"<th class='px-4 py-3 text-center'>Justificadas</th><th class='px-4 py-3 text-center'>Total</th>" +
			"</tr></thead><tbody class='divide-y divide-gray-100'>";

		filas.forEach(function (al) {
			const total = al.presente + al.ausente + al.justificada;
			const pct   = total ? Math.round((al.presente / total) * 100) : 0;
			const color = pct >= 85 ? "text-green-600" : pct >= 70 ? "text-yellow-600" : "text-red-600";
			html += "<tr class='hover:bg-gray-50'>" +
				"<td class='px-4 py-3 text-gray-500'>" + (al.num || "") + "</td>" +
				"<td class='px-4 py-3 font-medium text-gray-800'>" + esc(al.nombre) + "</td>" +
				"<td class='px-4 py-3 text-center text-green-600 font-semibold'>" + al.presente + "</td>" +
				"<td class='px-4 py-3 text-center text-red-500'>" + al.ausente + "</td>" +
				"<td class='px-4 py-3 text-center text-yellow-600'>" + al.justificada + "</td>" +
				"<td class='px-4 py-3 text-center'><span class='" + color + " font-bold'>" + total + "</span></td>" +
				"</tr>";
		});
		html += "</tbody></table></div>";
		cont.innerHTML = html;
	});

	document.getElementById("downloadPdfBtn").addEventListener("click", function () {
		const el = document.getElementById("reportContainer");
		if (!el.querySelector("table")) return;
		html2pdf().set({
			margin: 0.5,
			filename: "asistencia-" + grupNombre + ".pdf",
			html2canvas: { scale: 2 },
			jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
		}).from(el).save();
	});

	// ═══════════════════════════════════════════════════════════════
	// TAB 2 — VISTA RECREA  ·  TAB 3 — CONCENTRADO DIRECTOR
	// Las dos leen la calificación OFICIAL: la confirmada por el maestro en
	// boleta_trimestral. Lo no confirmado sale "pendiente" (Acuerdo 10/09/23, art. 4 XI).
	// Datos: js/reporte-datos.js (motor único); render: js/reportes-grupo.js.
	// ═══════════════════════════════════════════════════════════════
	let ctxReportes = null;
	async function filasGrupo(trimestre) {
		if (!ctxReportes) ctxReportes = await window.ReporteDatos.contexto(window.sb);
		const datos = await window.ReporteDatos.grupoTrimestre(window.sb, ctxReportes, trimestre);
		// datos.alumnos: con boleta cerrada, el grado del cierre (lo entregado no se mueve)
		return window.ReportesGrupo.filas(datos.alumnos || ctxReportes.alumnos, datos, trimestre);
	}

	async function pintarGrupo(contId, trimestre, render) {
		const cont = document.getElementById(contId);
		cont.innerHTML = "<p class='text-gray-400 text-sm'>Cargando calificaciones...</p>";
		try {
			cont.innerHTML = render(await filasGrupo(trimestre), trimestre);
		} catch (e) {
			console.error("reportes de grupo:", e);
			cont.innerHTML = "<p class='text-red-500 text-sm'>No se pudieron cargar las calificaciones: " +
				esc(e.message || "error desconocido") + "</p>";
		}
	}

	document.getElementById("generarCalifBtn").addEventListener("click", function () {
		pintarGrupo("califContainer", parseInt(document.getElementById("selectTrimestre").value, 10),
			window.ReportesGrupo.htmlVistaRecrea);
	});

	document.getElementById("exportCsvBtn").addEventListener("click", async function () {
		const btn = this;
		const trimestre = parseInt(document.getElementById("selectTrimestre").value, 10);
		btn.disabled = true;
		try {
			const csv = window.ReportesGrupo.csvVistaRecrea(await filasGrupo(trimestre));
			const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = "vista-recrea-" + (grupNombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
				.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grupo") + "-T" + trimestre + ".csv";
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			console.error("vista recrea (csv):", e);
			window.alert("No se pudo exportar: " + (e.message || "error desconocido"));
		}
		btn.disabled = false;
	});

	document.getElementById("generarConcBtn").addEventListener("click", function () {
		pintarGrupo("concentradoContainer", parseInt(document.getElementById("selectTrimestreConc").value, 10),
			window.ReportesGrupo.htmlConcentrado);
	});

	// ═══════════════════════════════════════════════════════════════
	// TAB 6 — QUÉ LE FALTA (vista de grupo)
	// Por alumno, cuántos pendientes tiene en cada campo; al tocarlo, su detalle.
	// Las mismas lecturas que las otras pestañas de grupo (ReporteDatos.grupoTrimestre, con
	// más columnas y ninguna petición más); las reglas viven en js/que-le-falta.js.
	// ═══════════════════════════════════════════════════════════════
	let turnoFalta = 0;
	const faltaBtn = document.getElementById("generarFaltaBtn");
	const faltaCont = document.getElementById("faltaContainer");
	if (faltaBtn && faltaCont) {
		faltaBtn.addEventListener("click", async function () {
			const miTurno = ++turnoFalta;
			const trimestre = parseInt(document.getElementById("selectTrimFalta").value, 10) || 1;
			faltaCont.innerHTML = "<p class='text-gray-400 text-sm'>Revisando lo registrado...</p>";
			faltaBtn.disabled = true;
			try {
				if (!ctxReportes) ctxReportes = await window.ReporteDatos.contexto(window.sb);
				const datos = await window.ReporteDatos.grupoTrimestre(window.sb, ctxReportes, trimestre,
					{ queLeFalta: true, hoy: getLocalDateISO() });
				if (miTurno !== turnoFalta) return;
				// Orden de lista con el grado de hoy (el de la captura)
				const lista = ctxReportes.alumnos.map(function (al) {
					return { alumno: al, res: (datos.queLeFalta || {})[al.id] || null };
				});
				faltaCont.innerHTML = window.QueLeFalta.htmlGrupo(lista, trimestre);
			} catch (e) {
				if (miTurno !== turnoFalta) return;
				console.error("qué le falta:", e);
				faltaCont.innerHTML = "<p class='text-red-500 text-sm'>No se pudieron revisar los pendientes: " +
					esc((e && e.message) || "error desconocido") + ". Revisa tu conexión e inténtalo de nuevo.</p>";
			} finally {
				if (miTurno === turnoFalta) faltaBtn.disabled = false;
			}
		});
		// Tocar un alumno abre o cierra su detalle
		faltaCont.addEventListener("click", function (e) {
			const boton = e.target.closest ? e.target.closest("button[data-qlf-alumno]") : null;
			if (boton) window.QueLeFalta.alternar(boton);
		});
	}

	// ── Helpers ────────────────────────────────────────────────────
	function colorCalif(v) {
		if (v === null || v === undefined) return "text-gray-400";
		if (v >= 9) return "text-green-600";
		if (v >= 7) return "text-yellow-600";
		return "text-red-500";
	}

	// También comillas: varios textos van dentro de atributos (data-inicial='…'), y un
	// apóstrofo del maestro cortaba el atributo
	function esc(str) {
		return String(str === null || str === undefined ? "" : str)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// El aviso de privacidad es de la tienda: bajo /salon/ (la app instalable) va a /tienda/ y,
	// dentro de la app, en otra ventana (el navegador), sin sacar a la maestra de Mi Salón
	function enlacePrivacidad() {
		const ai = window.AppInstalada;
		const enSalon = !!(ai && ai.estaEnSalon && ai.estaEnSalon());
		const enApp = !!(ai && ai.modoApp && ai.modoApp());
		return "<a href='" + (enSalon ? "/tienda/privacidad.html" : "tienda/privacidad.html") + "'" +
			(enApp ? " target='_blank' rel='noopener'" : "") + " class='underline'>Aviso de privacidad</a>";
	}

	// Fecha local del maestro, no UTC: a las 7 de la tarde en México, UTC ya es mañana
	function getLocalDateISO() {
		const ahora = new Date();
		const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	// ═══════════════════════════════════════════════════════════════
	// TAB 4 — BOLETA
	// ═══════════════════════════════════════════════════════════════
	// Claves y etiquetas de cuaderno / matemáticas: catálogo único js/catalogo-habilidades.js
	// (las de matemáticas se piden por grado: CatalogoHabilidades.matematicasDeGrado)
	const CRITERIOS_CUADERNO = window.CatalogoHabilidades.CUADERNO;

	// Catálogo editable de sugerencias (plantillas_sugerencia), clave → texto. Si la tabla
	// no tiene una clave, js/textos-boleta.js usa su copia por defecto; si la lectura FALLA,
	// la boleta no se genera (no se guardan textos con sugerencias que no son las del catálogo).
	let plantillasSugerencia = null;
	async function cargarPlantillas() {
		if (plantillasSugerencia) return plantillasSugerencia;
		const { data, error } = await window.sb.from("plantillas_sugerencia").select("clave, texto").eq("activo", true);
		if (error) throw error; // quien genera la boleta lo dice y no guarda nada
		plantillasSugerencia = {};
		(data || []).forEach(function (p) { plantillasSugerencia[p.clave] = p.texto; });
		return plantillasSugerencia;
	}

	// Bandas de fluidez lectora por grado: tabla bandas_ppm (se cargan una vez)
	let bandasPPM = null;
	async function cargarBandasPPM() {
		if (bandasPPM) return bandasPPM;
		const { data, error } = await window.sb.from("bandas_ppm").select("*");
		if (error) throw error;
		bandasPPM = {};
		(data || []).forEach(function (b) { bandasPPM[b.grado] = b; });
		return bandasPPM;
	}

	/*
		Redacción con IA (B.7 Capa 2). La llave vive solo en la Edge Function
		redactar-boleta; aquí solo se pregunta si está configurada. Sin llave, el botón
		no aparece (bandera) y la boleta funciona igual con la Capa 1.
	*/
	let iaDisponible = null;
	async function estadoIa() {
		if (iaDisponible !== null) return iaDisponible;
		try {
			const { data, error } = await window.sb.functions.invoke("redactar-boleta", { body: { accion: "estado" } });
			iaDisponible = !error && !!(data && data.configurada);
		} catch (e) {
			iaDisponible = false;
		}
		return iaDisponible;
	}

	// Datos del grupo para la cabecera (escuela, ciclo): ya vienen con el grupo activo.
	// Antes se pedían aparte y una boleta generada muy rápido podía salir sin ciclo.
	const boletaGrupoInfo = { escuela: grupo.escuela || "", ciclo: grupo.ciclo_escolar || "" };
	let boletaResumenTexto = ""; // resumen plano para WhatsApp
	let boletaCtx = null; // { alumnoId, ciclo, trimestre } de la boleta en pantalla (para autosave)
	let boletaFilas = {}; // filas de boleta_trimestral en pantalla, por campo (para autosave)
	let guardarCuadroBoleta = null; // guarda un cuadro de texto ya (lo usa "Cerrar boleta")

	/*
		PostgREST arma un upsert de varias filas con la UNIÓN de sus columnas y a la fila
		que no trae una columna le pone NULL: así se borraban los textos del maestro (y
		podía borrarse una calificación confirmada) cuando se guardaban juntas filas de
		distinta forma. Se agrupan por forma y va un upsert por grupo.
	*/
	async function upsertPorForma(tabla, filas, onConflict) {
		const grupos = {};
		filas.forEach(function (f) {
			const forma = Object.keys(f).sort().join(",");
			(grupos[forma] = grupos[forma] || []).push(f);
		});
		for (const forma of Object.keys(grupos)) {
			const { error } = await window.sb.from(tabla).upsert(grupos[forma], { onConflict: onConflict });
			if (error) throw error;
		}
	}

	// Poblar selector de alumnos
	(function poblarAlumnosBoleta() {
		const sel = document.getElementById("selectAlumnoBoleta");
		if (!sel) return;
		alumnos.forEach(function (al) {
			const opt = document.createElement("option");
			opt.value = al.id;
			opt.textContent = (al.num_lista ? al.num_lista + ". " : "") + (al.nombre_completo || "Sin nombre") +
				(al.grado ? " (" + al.grado + "°)" : "");
			sel.appendChild(opt);
		});
	})();

	document.getElementById("generarBoletaBtn").addEventListener("click", async function () {
		await generarBoleta();
	});

	// El cálculo por campo vive en js/motor-calificacion.js (B.3), no aquí: es el
	// único motor del sistema y lee productos_sesion + calificaciones + registro_diario.

	function semColorClass(semaforo) {
		if (semaforo === "logrado")        return "bg-emerald-500";
		if (semaforo === "en_proceso")     return "bg-amber-400";
		if (semaforo === "requiere_apoyo") return "bg-red-500";
		return "bg-gray-200";
	}

	function semCirculo(semaforo) {
		return '<span class="inline-block w-4 h-4 rounded-full ' + semColorClass(semaforo) + '"></span>';
	}

	/*
		Piso del GRADO (no de la fase: la Fase 3 tiene 1° de 6 a 10 y 2° de 5 a 10, decisión
		17b), para acotar el selector con el que el maestro ajusta el número. La regla vive en
		js/reglas-entidad.js (ReporteDatos.pisoDeGrado) y la base aplica la misma
		(piso_calificacion_boleta). Sin grado válido, 5: la base revisa de todos modos.
	*/
	function pisoGrado(grado) {
		return window.ReporteDatos.pisoDeGrado(grado) || 5;
	}

	// Un decimal y truncado, no redondeado: 49.86 % se veía "50 %" junto a un 5 (la
	// escala pone el 6 a partir de 50). Truncar evita que 49.97 se lea "50.0 %".
	function fmtPct(v) {
		if (v === null || v === undefined) return "—";
		return (Math.floor(v * 10 + 1e-9) / 10).toFixed(1) + " %";
	}

	// Porcentaje que se guarda en la boleta: truncado a 2 decimales, no redondeado. Así el
	// que se ve (truncado a 1) es el mismo antes y después de cerrar, y un 49.996 nunca se
	// guarda como 50.00 junto a un 5
	function pctGuardado(p) {
		return Math.floor(Number(p) * 100 + 1e-9) / 100;
	}

	function fmtRubro(rubro) {
		if (!rubro || rubro.maximo <= 0) return "<span class='text-gray-300'>—</span>";
		const redondea = function (n) { return Math.round(n * 10) / 10; };
		return "<span class='font-medium'>" + fmtPct(rubro.fraccion * 100) + "</span>" +
			"<span class='block text-xs text-gray-400'>" + redondea(rubro.obtenido) + " / " + redondea(rubro.maximo) + "</span>";
	}

	async function generarBoleta() {
		const cont      = document.getElementById("boletaContainer");
		const acciones  = document.getElementById("boletaAcciones");
		const alumnoId  = document.getElementById("selectAlumnoBoleta").value;
		const trimestre = parseInt(document.getElementById("selectTrimBoleta").value, 10);

		acciones.classList.add("hidden");

		if (!alumnoId) {
			cont.innerHTML = "<p class='text-red-500 text-sm'>Selecciona un alumno.</p>";
			return;
		}
		const alumno = alumnos.find(function (a) { return a.id === alumnoId; });
		if (!alumno) { cont.innerHTML = "<p class='text-red-500 text-sm'>Alumno no encontrado.</p>"; return; }

		cont.innerHTML = "<p class='text-gray-400 text-sm'>Generando boleta...</p>";

		// El grado pudo cambiar en otra pestaña (Mi grupo) desde que se abrió esta página: con el
		// de hoy se decide la escala y qué confirmada ya no vale (no se muestra ni se manda por
		// WhatsApp un número que ya no es válido)
		const errorEnBoleta = function (texto) { cont.innerHTML = "<p class='text-red-500 text-sm'>" + esc(texto) + "</p>"; };
		const { data: fresco, error: errGrado } = await window.sb.from("alumnos").select("grado")
			.eq("id", alumnoId).eq("maestro_id", userId).maybeSingle();
		if (errGrado) {
			console.error("boleta: grado del alumno", errGrado);
			errorEnBoleta("No se pudo leer el grado del alumno. Revisa tu conexión y vuelve a generar la boleta.");
			return;
		}
		if (!fresco) { errorEnBoleta("Alumno no encontrado."); return; }
		if (fresco.grado) alumno.grado = Number(fresco.grado);

		// 1. Todo el cálculo (rubros, máximos, examen del grado, asistencia de
		// referencia y calificación propuesta) lo hace el motor único de B.3.
		let motor;
		try {
			motor = await window.MotorCalificacion.cargarYCalcular(window.sb, {
				maestroId: userId, grupoId: grupoId, alumnoId: alumnoId,
				grado: alumno.grado, trimestre: trimestre, campos: CODIGOS,
			});
		} catch (e) {
			console.error("motor de calificación:", e);
			cont.innerHTML = "<p class='text-red-500 text-sm'>No se pudo calcular la boleta: " +
				esc(e.message || "error desconocido") + "</p>";
			return;
		}
		const porCampo = motor.porCampo;
		// let: con la boleta cerrada se reemplaza por la asistencia del cierre (más abajo)
		let diasPresente = motor.asistencia.presentes;
		let diasTotal    = motor.asistencia.total;
		let asistenciaPct = motor.asistencia.porcentaje;
		const asistenciaHoy = motor.asistencia; // la que se guarda en la foto al cerrar

		// 2. Evaluación diagnóstica del trimestre + bandas de fluidez
		/*
			Generar la boleta ESCRIBE (propuestas de número y de textos). Si una de sus lecturas
			falla, se detiene sin guardar nada: con la boleta guardada "vacía" la propuesta
			pisaría una calificación confirmada o los textos del maestro.
		*/
		const noSePudo = function (que, e) {
			console.error("boleta: " + que, e);
			cont.innerHTML = "<p class='text-red-600 text-sm'>No se pudo leer " + esc(que) + ": " + esc((e && e.message) || "error desconocido") +
				". No se guardó nada. Vuelve a intentarlo en un momento.</p>";
		};
		let { data: diagnostica, error: errorDiag } = await window.sb
			.from("evaluacion_diagnostica").select("*")
			.eq("alumno_id", alumnoId).eq("maestro_id", userId)
			.eq("momento", "trimestre_" + trimestre).maybeSingle();
		if (errorDiag) { noSePudo("la evaluación diagnóstica", errorDiag); return; }
		// Bandas de lectura y sugerencias también se leen antes de guardar nada
		let bandas, plantillas;
		try {
			bandas = await cargarBandasPPM();
			plantillas = await cargarPlantillas();
		} catch (e) { noSePudo("las bandas de lectura o las sugerencias", e); return; }

		// 3. boleta_trimestral: observaciones, número confirmado y estado de cierre
		const cicloBoleta = boletaGrupoInfo.ciclo || "";
		let boletaPorCampo = {};
		const boletaCicloAlumno = { 1: {}, 2: {}, 3: {} };
		{
			// Los tres trimestres del ciclo: el elegido para la boleta y todos para la evaluación
			// final (T1, T2, T3 y final por campo, promedio final de grado y acreditación)
			const { data: boletaRows, error: errorBoleta } = await window.sb
				.from("boleta_trimestral").select("*")
				.eq("alumno_id", alumnoId).eq("maestro_id", userId)
				.eq("ciclo", cicloBoleta);
			if (errorBoleta) { noSePudo("la boleta guardada", errorBoleta); return; }
			(boletaRows || []).forEach(function (r) {
				// Grado de hoy en cada fila: una confirmada fuera de su escala no vale (ReporteDatos.fueraDeEscala)
				window.ReporteDatos.anotarGradoHoy(r, alumno.grado);
				if (!boletaCicloAlumno[r.trimestre]) boletaCicloAlumno[r.trimestre] = {};
				boletaCicloAlumno[r.trimestre][r.campo] = r;
				if (Number(r.trimestre) === trimestre) boletaPorCampo[r.campo] = r;
			});
		}
		let avancePda = [];
		{
			const { data: pdaRows, error: errorPda } = await window.sb.from("v_avance_pda").select("*")
				.eq("maestro_id", userId).eq("alumno_id", alumnoId).eq("trimestre", trimestre);
			// Se lee antes de guardar nada: sin el avance por PDA los textos propuestos saldrían
			// incompletos y se guardarían
			if (errorPda) { noSePudo("el avance por PDA", errorPda); return; }
			avancePda = pdaRows || [];
		}
		boletaCtx = { alumnoId: alumnoId, ciclo: cicloBoleta, trimestre: trimestre };

		/*
			Qué número manda en cada campo:
			  - boleta cerrada           → el guardado, sin recalcular
			  - calificación confirmada  → la del maestro (el motor solo refresca el %)
			  - sin confirmar            → la propuesta del motor, y se persiste
			El maestro puede ajustar el número antes de cerrar (Acuerdo art. 4 XI).
		*/
		const oficialPorCampo = {};
		let hayPropuesta = false, todoConfirmado = true, todoCerrado = true;
		// Boleta cerrada (los cuatro campos): todo queda como se entregó, también los textos
		// de la fila GEN y el trabajo diario (ReporteDatos.boletaCerrada)
		const boletaYaCerrada = window.ReporteDatos.boletaCerrada(boletaPorCampo);
		// Cuaderno, lectura y matemáticas como se entregaron (foto del cierre en la fila GEN)
		diagnostica = window.ReporteDatos.diagnosticaVisible(diagnostica, boletaPorCampo[window.TextosBoleta.GENERAL], boletaYaCerrada);
		// Y la asistencia de referencia, que también va impresa en la boleta
		motor.asistencia = window.ReporteDatos.asistenciaVisible(motor.asistencia, boletaPorCampo[window.TextosBoleta.GENERAL], boletaYaCerrada);
		diasPresente = motor.asistencia.presentes;
		diasTotal = motor.asistencia.total;
		asistenciaPct = motor.asistencia.porcentaje;
		/*
			Foto del cierre (decisiones de Jorge 6 y 7): con la boleta cerrada, grado, fase,
			escala, banda de lectura, desglose por rubro y pesos son los del cierre. Boletas
			cerradas antes de guardar eso: lo de hoy (porCampoCierre y alumnoCierre dan null).
		*/
		const RDB = window.ReporteDatos;
		const fotoGen = boletaYaCerrada ? RDB.fotoCierre(boletaPorCampo[window.TextosBoleta.GENERAL]) : null;
		const porCampoCierre = RDB.porCampoCierre(fotoGen);
		// Cerrada antes de la foto completa: porcentaje de cada fila y, en un campo por juicio
		// docente, ningún desglose de hoy (ReporteDatos.porCampoFilas)
		const porCampoVisible = porCampoCierre || (boletaYaCerrada ? RDB.porCampoFilas(boletaPorCampo, porCampo) : porCampo);
		const pesosVisibles = (porCampoCierre && fotoGen.pesos) || motor.pesos;
		const alumnoVisible = RDB.alumnoVisible(alumno, fotoGen);
		const bandaVisible = RDB.bandaVisible(bandas ? bandas[alumnoVisible.grado] || null : null, fotoGen);
		/*
			Las propuestas (número y textos) se guardan solas al generar la boleta. Si alguna no se
			pudo guardar, la pantalla lo dice (aviso rojo, como el resto de los guardados de esta
			pestaña): lo que se ve es la propuesta sin guardar, no algo que ya quedó en la base.
		*/
		const fallosPropuesta = [];
		let errorPropuesta = null;
		/*
			Confirmada que quedó FUERA de la escala del grado de hoy (un 5 y el alumno pasó a
			1°): NO cuenta como confirmada (art. 4 XI). El campo pide "Elige" con su aviso,
			"Cerrar boleta" queda deshabilitado y no se escribe nada en esa fila: la base
			rechaza cualquier escritura ahí hasta que el maestro confirme dentro de la escala,
			y proponer un número encima lo dejaría "confirmado" sin que él lo eligiera.
		*/
		const fuerasDeEscala = {};
		try {
			const upserts = [];
			CODIGOS.forEach(function (codigo) {
				const fila = boletaPorCampo[codigo] || {};
				const datos = porCampo[codigo] || {};
				const propuesta = datos.calificacionPropuesta;
				if (propuesta !== null && propuesta !== undefined) hayPropuesta = true;

				if (fila.cerrada) { oficialPorCampo[codigo] = fila.calificacion; return; }
				todoCerrado = false;
				const fuera = RDB.fueraDeEscala(fila);
				if (fuera) {
					fuerasDeEscala[codigo] = fuera;
					todoConfirmado = false;
					return;
				}
				if (fila.calificacion_confirmada) {
					oficialPorCampo[codigo] = fila.calificacion;
					if (datos.porcentaje !== null && datos.porcentaje !== undefined) {
						upserts.push({
							maestro_id: userId, alumno_id: alumnoId, ciclo: cicloBoleta,
							trimestre: trimestre, campo: codigo,
							porcentaje: pctGuardado(datos.porcentaje), nivel: datos.nivel,
						});
					}
					return;
				}
				todoConfirmado = false;
				if (propuesta === null || propuesta === undefined) return;
				oficialPorCampo[codigo] = propuesta;
				upserts.push({
					maestro_id: userId, alumno_id: alumnoId, ciclo: cicloBoleta,
					trimestre: trimestre, campo: codigo,
					porcentaje: pctGuardado(datos.porcentaje),
					calificacion: propuesta, nivel: datos.nivel,
				});
			});
			// Confirmadas (solo %) y sin confirmar (con número) tienen forma distinta
			if (upserts.length) await upsertPorForma("boleta_trimestral", upserts, "maestro_id,alumno_id,ciclo,trimestre,campo");
		} catch (e) {
			console.error("boleta_trimestral (numérico):", e);
			fallosPropuesta.push("la propuesta de calificación");
			errorPropuesta = errorPropuesta || e;
		}
		/*
			Alumno sin NINGUNA evidencia en el trimestre (por ejemplo, llegó tarde): igual que un
			campo sin evidencias, cada campo ofrece "Elige" y el maestro decide por juicio docente
			(decisión de Jorge 5, art. 4 XI). todoConfirmado ya es false mientras falte confirmar
			algún campo; si los cuatro están confirmados por juicio, se puede cerrar.
			Sin proyectos en el trimestre no hay nada que calificar todavía: no se ofrece.
		*/
		const ofrecerJuicio = !motor.sinProyectos;

		// ── Capa 1: textos propuestos por reglas (B.7) ──

		const textos = window.TextosBoleta.generar({
			porCampo: porCampo,
			avancePda: avancePda,
			diagnostica: diagnostica,
			banda: bandaVisible,
			grado: alumnoVisible.grado, // las habilidades de matemáticas de su grado (el del cierre si está cerrada)
			asistencia: motor.asistencia,
			catalogo: window.CatalogoHabilidades,
			corto: window.CamposFormativos ? window.CamposFormativos.corto : null,
			plantillas: plantillas,
		});
		if (!boletaYaCerrada) {
			const errorTextos = await guardarTextosPropuestos(textos, boletaPorCampo, {
				alumnoId: alumnoId, ciclo: cicloBoleta, trimestre: trimestre,
			}, false);
			if (errorTextos) {
				fallosPropuesta.push("los textos propuestos");
				errorPropuesta = errorPropuesta || errorTextos;
			}
		}

		const conIa = !todoCerrado && await estadoIa();

		// ── Renderizar boleta ──
		const cabecera =
			"<div class='border-b-2 border-gray-300 pb-4 mb-5'>" +
			"<div class='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2'>" +
			"<div>" +
			"<h2 class='text-xl font-bold text-gray-800'>Boleta de Evaluación</h2>" +
			"<p class='text-sm text-gray-600 mt-1'>" + esc(boletaGrupoInfo.escuela || "Escuela") + "</p>" +
			"</div>" +
			"<div class='text-sm text-gray-600 sm:text-right'>" +
			"<p>Ciclo escolar: <span class='font-semibold'>" + esc(boletaGrupoInfo.ciclo || "—") + "</span></p>" +
			"<p>Trimestre: <span class='font-semibold'>" + trimestre + "°</span></p>" +
			"</div>" +
			"</div>" +
			"<div class='mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm'>" +
			"<p><span class='text-gray-500'>Alumno:</span> <span class='font-semibold text-gray-800'>" + esc(alumno.nombre_completo) + "</span></p>" +
			"<p><span class='text-gray-500'>Grado:</span> <span class='font-semibold text-gray-800'>" + (alumnoVisible.grado ? alumnoVisible.grado + "°" : "—") + "</span></p>" +
			"<p><span class='text-gray-500'>No. lista:</span> <span class='font-semibold text-gray-800'>" + (alumno.num_lista || "—") + "</span></p>" +
			"</div>" +
			"</div>";

		// Sección 1: Desempeño + examen (cada celda: % del rubro y obtenido/máximo)
		const camposCols = CAMPOS_CORTOS;
		const MOTOR = window.MotorCalificacion;

		/*
			Peso EFECTIVO de cada rubro en cada campo (solo presentación: el cálculo no cambia):
			los pesos de Ajustes son relativos y un rubro sin datos no entra, así que se muestra
			cuánto valió cada rubro en ESTE cálculo, sumando 100 % entre los que tienen datos
			(MotorCalificacion.pesosEfectivos). Antes se mostraban 28, 28, 6 y 33 "%", que suman 95.
			Si el rubro valió lo mismo en todos los campos, va en su etiqueta; si no, en cada celda.
		*/
		const efectivos = {};
		CODIGOS.forEach(function (codigo) {
			efectivos[codigo] = MOTOR.pesosEfectivos(porCampoVisible[codigo] ? porCampoVisible[codigo].rubros : null);
		});
		const fmtPeso = function (v) { return String(v).replace(/\.0$/, "") + "\u00a0%"; };

		// Con la boleta cerrada (foto completa), el desglose y los pesos del cierre
		function filaRubro(rubro) {
			const peso = (pesosVisibles || {})[rubro];
			// Conducta: se registra y se informa, pero no pondera (LGE art. 21). Una boleta
			// cerrada antes del cambio conserva el peso con que se entregó.
			const referencia = rubro === "conducta" && !(peso > 0);
			const valio = CODIGOS.map(function (c) { return efectivos[c] ? efectivos[c][rubro] : undefined; })
				.filter(function (v) { return v !== undefined; });
			const varia = valio.some(function (v) { return v !== valio[0]; });
			let celdas = "";
			CODIGOS.forEach(function (codigo) {
				const datos = (porCampoVisible[codigo] && porCampoVisible[codigo].rubros) ? porCampoVisible[codigo].rubros[rubro] : null;
				const suyo = efectivos[codigo] ? efectivos[codigo][rubro] : undefined;
				celdas += "<td class='px-3 py-2 text-center border border-gray-200'" + (suyo !== undefined ? " data-peso-efectivo='" + suyo + "'" : "") + ">" +
					fmtRubro(datos) +
					(varia && suyo !== undefined ? "<span class='block text-xs text-gray-500'>pesa " + fmtPeso(suyo) + "</span>" : "") + "</td>";
			});
			let etiquetaPeso, clasePeso;
			if (referencia) { etiquetaPeso = "referencia, no pondera"; clasePeso = "text-gray-500"; }
			else if (!(peso > 0)) { etiquetaPeso = "sin peso"; clasePeso = "text-gray-300"; }
			else if (!valio.length) { etiquetaPeso = "sin datos"; clasePeso = "text-gray-300"; }
			else if (varia) { etiquetaPeso = "pesa según el campo"; clasePeso = "text-gray-500"; }
			else { etiquetaPeso = fmtPeso(valio[0]); clasePeso = "text-gray-500"; }
			return "<tr data-rubro='" + rubro + "'" + (referencia ? " data-no-pondera='conducta'" : "") + "><td class='px-3 py-2 font-medium text-gray-700 border border-gray-200'>" +
				MOTOR.ETIQUETA_RUBRO[rubro] +
				" <span class='text-xs font-normal " + clasePeso + "' data-peso-etiqueta>" + etiquetaPeso + "</span></td>" + celdas + "</tr>";
		}

		// Fila de porcentaje del campo (lo que el motor convierte a calificación)
		let filaPorcentaje = "";
		let cambioTrasCierre = false;
		CODIGOS.forEach(function (codigo) {
			const vivo = porCampo[codigo] ? porCampo[codigo].porcentaje : null;
			const fila = boletaPorCampo[codigo] || {};
			if (!fila.cerrada) {
				filaPorcentaje += "<td class='px-3 py-2 text-center border border-gray-200 text-gray-700'>" + fmtPct(vivo) + "</td>";
				return;
			}
			/*
				Campo cerrado: SIEMPRE el porcentaje del cierre, nunca el de las capturas de hoy.
				Sin porcentaje guardado no tenía evidencias al cerrar (juicio docente): se dice así
				aunque después se haya capturado algo en ese campo.
			*/
			const guardado = fila.porcentaje !== null && fila.porcentaje !== undefined && fila.porcentaje !== "" ? Number(fila.porcentaje) : null;
			const hayVivo = vivo !== null && vivo !== undefined;
			// Aviso de capturas después del cierre (también si hoy ya no hay evidencias en un
			// campo que las tenía, o si hoy hay en uno que no tenía)
			if (guardado !== null ? (!hayVivo || Math.abs(guardado - vivo) >= 0.05) : hayVivo) cambioTrasCierre = true;
			filaPorcentaje += guardado !== null
				? "<td class='px-3 py-2 text-center border border-gray-200 text-gray-700'>" + fmtPct(guardado) + "</td>"
				: "<td class='px-3 py-2 text-center border border-gray-200 text-gray-400' data-sin-evidencias-cierre='1'>—" +
					"<span class='block text-xs text-amber-700 mt-1'>sin evidencias al cierre</span></td>";
		});

		// Fila de calificación: selector para que el maestro ajuste antes de confirmar
		// El piso del selector es el del grado de hoy (la base lo vuelve a revisar con el
		// grado de hoy: trigger boleta_trimestral_piso_fase); cerrada, la escala del cierre
		const piso = pisoGrado(alumno.grado);
		const faseEtiqueta = RDB.faseVisible(alumnoVisible.grado, fotoGen);
		const escalaEtiqueta = RDB.escalaVisible(alumnoVisible.grado, fotoGen);
		// "juicio docente, sin evidencias": la calificación confirmada no sale de evidencias
		const marcaJuicio = "<span class='block text-xs text-amber-700 mt-1' data-juicio='1'>juicio docente, sin evidencias</span>";
		let filaCalificacion = "";
		let haySelector = false;
		const camposSinEvidencia = [];
		CODIGOS.forEach(function (codigo, i) {
			const fila = boletaPorCampo[codigo] || {};
			const valor = oficialPorCampo[codigo];
			const propuesta = porCampo[codigo] ? porCampo[codigo].calificacionPropuesta : null;
			const juicio = RDB.juicioSinEvidencias(boletaPorCampo, codigo, porCampo[codigo]);
			const fuera = fuerasDeEscala[codigo];
			if (fuera) {
				// La confirmada no existe en la escala de hoy: "Elige", sin ningún número puesto
				// por la pantalla, y el aviso de qué pasó
				haySelector = true;
				let opcionesFuera = "<option value='' selected>Elige</option>";
				for (let n = piso; n <= 10; n++) opcionesFuera += "<option value='" + n + "'>" + n + "</option>";
				filaCalificacion += "<td class='px-3 py-2 text-center border border-gray-200 bg-amber-50'>" +
					"<select data-cal-campo='" + codigo + "' data-cal-fuera-escala='" + fuera.valor + "' data-cal-nombre='" + esc(CAMPOS_CORTOS[i]) + "'" +
					" class='min-h-[44px] w-24 text-center font-bold rounded-lg border border-amber-400 bg-white text-gray-700'>" + opcionesFuera + "</select>" +
					"<span class='block text-xs text-amber-800 mt-1 leading-snug' data-fuera-escala='" + codigo + "'>" + esc(RDB.textoFueraDeEscala(fuera)) + "</span></td>";
				return;
			}
			if (valor === null || valor === undefined) {
				/*
					Campo sin evidencias este trimestre (y sin calificación confirmada): no hay
					propuesta, pero la boleta oficial necesita el número de los cuatro campos.
					Lo decide el maestro (juicio docente, art. 4 XI): selector sin valor
					elegido, dentro de la escala de su grado. Vale también si NINGÚN campo tiene
					evidencias (alumno que llegó tarde). Sin proyectos en el trimestre, nada.
				*/
				if (!ofrecerJuicio || todoCerrado || fila.cerrada) {
					filaCalificacion += "<td class='px-3 py-2 text-center border border-gray-200 text-gray-300'>—</td>";
					return;
				}
				haySelector = true;
				camposSinEvidencia.push(CAMPOS_CORTOS[i]);
				let opcionesSin = "<option value=''>Elige</option>";
				for (let n = piso; n <= 10; n++) opcionesSin += "<option value='" + n + "'>" + n + "</option>";
				filaCalificacion += "<td class='px-3 py-2 text-center border border-gray-200 bg-amber-50'>" +
					"<select data-cal-campo='" + codigo + "' data-cal-sin-evidencia='1' data-cal-nombre='" + esc(CAMPOS_CORTOS[i]) + "'" +
					" class='min-h-[44px] w-24 text-center font-bold rounded-lg border border-amber-300 bg-white text-gray-700'>" + opcionesSin + "</select>" +
					"<span class='block text-xs text-amber-700 mt-1'>sin evidencias</span></td>";
				return;
			}
			if (todoCerrado || fila.cerrada) {
				filaCalificacion += "<td class='px-3 py-2 text-center font-bold border border-gray-200 " +
					colorCalif(valor) + "'>" + valor + (juicio ? marcaJuicio : "") + "</td>";
				return;
			}
			haySelector = true;
			let opciones = "";
			for (let n = piso; n <= 10; n++) {
				opciones += "<option value='" + n + "'" + (n === valor ? " selected" : "") + ">" + n + "</option>";
			}
			// El aviso de "propuesta" se dibuja siempre y se muestra/oculta al vuelo
			// cuando el maestro mueve el selector (ver listener más abajo).
			const hayProp = (propuesta !== null && propuesta !== undefined);
			const ajustada = hayProp && valor !== propuesta;
			filaCalificacion += "<td class='px-3 py-2 text-center border border-gray-200'>" +
				"<select data-cal-campo='" + codigo + "'" +
				(hayProp ? " data-cal-propuesta='" + propuesta + "'" : "") +
				" class='min-h-[44px] w-20 text-center font-bold rounded-lg border border-gray-300 bg-white " +
				colorCalif(valor) + "'>" + opciones + "</select>" +
				(hayProp
					? "<span data-cal-aviso='" + codigo + "' class='block text-xs text-amber-600 mt-1" +
						(ajustada ? "" : " hidden") + "'>propuesta: " + propuesta + "</span>"
					: "") +
				(juicio ? marcaJuicio : "") +
				"</td>";
		});

		// Estado y botonera: confirmar el número antes de poder cerrar
		const avisos = [];
		if (motor.sinProyectos) avisos.push("No hay proyectos de este trimestre en el grupo, así que no hay evidencias que calificar.");
		if (motor.usaLegacy) avisos.push("Incluye calificaciones capturadas con el formato anterior (revisión de tareas del Dashboard, escala 5-10).");
		if (motor.examenAproximado) avisos.push("El puntaje del examen por campo es aproximado: el banco de preguntas no guarda el valor de cada pregunta.");
		if (!diagnostica || !diagnostica.id) avisos.push("Cuaderno, lectura y matemáticas salen de Evaluación diagnóstica → «T" + trimestre + " · boleta»: todavía no hay evaluación de este trimestre.");

		let barraEstado;
		if (todoCerrado) {
			barraEstado = "<div class='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 mb-6'>" +
				"Boleta cerrada. Las calificaciones ya no se recalculan." +
				// Con la foto completa todo lo que se ve es lo del cierre (aunque después cambien
				// capturas o el grado): no hay nada que avisar. Cerradas antes de esa foto: el
				// desglose es el de hoy y se dice.
				(cambioTrasCierre && !porCampoCierre
					? "<span class='block text-xs mt-1'>Hubo capturas después del cierre: el desglose por criterio muestra los datos de hoy; el porcentaje y la calificación son los del cierre.</span>"
					: "") + "</div>";
		} else {
			// Confirmadas fuera de la escala de hoy: lo primero que se dice (no se puede cerrar)
			const codigosFuera = CODIGOS.filter(function (c) { return fuerasDeEscala[c]; });
			const avisoFuera = codigosFuera.length
				? "<span class='block mb-1 text-amber-800 font-medium' data-aviso-fuera-escala>" +
					codigosFuera.map(function (c) {
						const f = fuerasDeEscala[c];
						return esc(CAMPOS_CORTOS[CODIGOS.indexOf(c)]) + ": el " + f.valor + " confirmado no es válido en " + f.grado + "° (escala " + esc(f.escala) + ")";
					}).join("; ") +
					". Cambió el grado del alumno: elige y confirma de nuevo " + (codigosFuera.length === 1 ? "esa calificación" : "esas calificaciones") +
					" para poder cerrar la boleta. Mientras tanto, sus textos no se guardan.</span>"
				: "";
			barraEstado =
				"<div class='rounded-xl border " + (codigosFuera.length ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50") + " px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>" +
				"<p class='text-sm text-gray-600'>" + avisoFuera +
				(codigosFuera.length && CODIGOS.every(function (c) { return fuerasDeEscala[c] || RDB.calificacionOficial(boletaPorCampo[c]).confirmada; })
					? (codigosFuera.length < CODIGOS.length ? "Las demás calificaciones siguen confirmadas." : "")
					: todoConfirmado
					? "Calificaciones confirmadas por el docente. Puedes cerrar la boleta."
					: (hayPropuesta
					? "El sistema propone estas calificaciones. Revísalas, ajústalas si hace falta y confírmalas: la calificación es tu juicio docente." +
						(camposSinEvidencia.length
							? " <span class='block mt-1 text-amber-800'>" + esc(camposSinEvidencia.join(", ")) +
								(camposSinEvidencia.length === 1 ? " no tiene" : " no tienen") +
								" evidencias este trimestre: elige su calificación para poder confirmar y cerrar.</span>"
							: "")
					: (camposSinEvidencia.length
					? "<span class='text-amber-800'>Este alumno no tiene evidencias registradas en este trimestre. Elige la calificación de cada campo por juicio docente, " +
						"dentro de la escala de su grado, para poder confirmar y cerrar.</span> La boleta indicará que esas calificaciones no salen de evidencias."
					: "Todavía no hay evidencias en este trimestre para proponer calificaciones."))) +
				"</p>" +
				"<div class='flex gap-2 shrink-0'>" +
				"<button id='boletaConfirmarBtn' type='button' " + (haySelector ? "" : "disabled ") +
				"class='min-h-[44px] px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed'>" +
				(todoConfirmado ? "Guardar ajustes" : "Confirmar calificaciones") + "</button>" +
				"<button id='boletaCerrarBtn' type='button' " + (todoConfirmado ? "" : "disabled ") +
				"class='min-h-[44px] px-4 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed'>" +
				"Cerrar boleta</button>" +
				"</div></div>";
		}
		const avisosHtml = avisos.length
			? "<ul class='text-xs text-gray-500 mb-6 list-disc pl-5'>" +
				avisos.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>"
			: "";

		// Asistencia: referencia, nunca parte de la calificación (Acuerdo 10/09/23, art. 7 I d)
		const asisPctTexto = (asistenciaPct !== null) ? Math.round(asistenciaPct * 100) + " %" : "—";
		const asisReferencia =
			"<p class='text-sm text-gray-600 mb-6'><span class='font-medium text-gray-700'>Asistencia:</span> " +
			(diasTotal > 0 ? diasPresente + " de " + diasTotal + " días (" + asisPctTexto + ")" : "sin registros en el trimestre") +
			". <span class='text-xs text-gray-500'>Dato de referencia; no forma parte de la calificación.</span></p>";

		/*
			La conducta ya no pondera (LGE art. 21), pero una boleta cerrada antes del cambio
			conserva en su foto la conducta con peso: ahí la nota dice lo que pasó en ELLA.
		*/
		const pesoConductaFoto = boletaYaCerrada ? RDB.pesoConductaCierre(boletaPorCampo) : 0;
		const notaConducta = pesoConductaFoto > 0
			? "Esta boleta se cerró cuando la conducta todavía ponderaba: en su porcentaje y su calificación la conducta contó con peso " +
				pesoConductaFoto + " (el de su cierre), y eso no se recalcula. Desde entonces la conducta se informa en las observaciones y no pondera (Ley General de Educación, art. 21)."
			: "La conducta se registra en el cierre del día y se informa en las observaciones: no pondera en el porcentaje ni en la calificación (Ley General de Educación, art. 21).";

		let seccion1 =
			"<h3 class='font-bold text-gray-800 mb-2'>1. Desempeño continuo y examen</h3>" +
			"<div class='overflow-x-auto mb-6'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-600 uppercase'>" +
			"<th class='px-3 py-2 text-left border border-gray-200'>Criterio</th>";
		camposCols.forEach(function (c) { seccion1 += "<th class='px-3 py-2 text-center border border-gray-200'>" + c + "</th>"; });
		seccion1 += "</tr></thead><tbody>" +
			MOTOR.RUBROS.map(filaRubro).join("") +
			"<tr class='bg-gray-50'><td class='px-3 py-2 font-medium text-gray-700 border border-gray-200'>Porcentaje del campo</td>" + filaPorcentaje + "</tr>" +
			"<tr class='bg-blue-50'><td class='px-3 py-2 font-bold text-gray-800 border border-gray-200'>Calificación" +
			// Escala del grado (decisión 17b), con su fase: "2° · Fase 3: enteros de 5 a 10; 5 no es aprobatoria"
			"<span class='block text-xs font-normal text-gray-500' data-escala>" + (alumnoVisible.grado ? esc(alumnoVisible.grado) + "° · " : "") +
			(faseEtiqueta ? "Fase " + faseEtiqueta + ": " : "") + (escalaEtiqueta ? "enteros de " + esc(escalaEtiqueta) : "") + "</span></td>" +
			filaCalificacion + "</tr>" +
			"</tbody></table></div>" +
			"<p class='text-xs text-gray-500 -mt-4 mb-6' data-nota-conducta>" + notaConducta + " " +
			"El peso de cada rubro es lo que valió en este cálculo: los pesos de Ajustes son relativos y se reparten el 100 % entre los rubros con datos de cada campo.</p>" +
			asisReferencia + barraEstado + avisosHtml +
			// Evaluación final del ciclo: una sola función para todos los documentos
			"<h3 class='font-bold text-gray-800 mb-2'>Evaluación final del ciclo</h3>" +
			"<div class='mb-6'>" + RDB.htmlFinalCiclo(boletaCicloAlumno, alumnoVisible.grado, { trimestre: trimestre, id: "boletaFinalCiclo" }) + "</div>";

		// Sección 2: Cuaderno
		const cuadernoMap = window.CatalogoHabilidades.aMapa(diagnostica && diagnostica.cuaderno);
		let seccion2 =
			"<h3 class='font-bold text-gray-800 mb-2'>2. Revisión de cuaderno</h3>" +
			"<div class='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-6'>";
		CRITERIOS_CUADERNO.forEach(function (crit) {
			seccion2 += "<div class='flex items-center justify-between border-b border-gray-100 py-1'>" +
				"<span class='text-sm text-gray-700'>" + esc(crit.etiqueta) + "</span>" +
				semCirculo(cuadernoMap[crit.clave]) + "</div>";
		});
		seccion2 += "</div>";

		// Sección 3: Habilidades básicas
		const ppm = (diagnostica && diagnostica.lectura_ppm != null) ? diagnostica.lectura_ppm : null;
		const compr = (diagnostica && diagnostica.lectura_comprension) ? diagnostica.lectura_comprension : null;
		// Contra la banda del grado como se entregó (foto del cierre) o la de hoy si está abierta
		const nivelLectClave = window.CatalogoHabilidades.clasificarPPM(ppm, bandaVisible);
		const nivelLect = nivelLectClave ? window.CatalogoHabilidades.ETIQUETA_FLUIDEZ[nivelLectClave] : "—";
		const matesMap = window.CatalogoHabilidades.aMapa(diagnostica && diagnostica.matematicas);

		let seccion3 =
			"<h3 class='font-bold text-gray-800 mb-2'>3. Habilidades básicas</h3>" +
			"<div class='grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6'>" +
			"<div class='rounded-xl border border-gray-200 p-4'>" +
			"<h4 class='font-semibold text-gray-700 mb-2 text-sm'>Lectura</h4>" +
			"<div class='flex justify-between text-sm py-1 border-b border-gray-100'><span class='text-gray-600'>Velocidad (PPM)</span><span class='font-semibold'>" + (ppm != null ? ppm : "—") + "</span></div>" +
			"<div class='flex justify-between gap-3 text-sm py-1 border-b border-gray-100'><span class='text-gray-600'>Fluidez lectora" +
			(bandaVisible ? "<span class='block text-xs text-gray-400' data-referencia-ppm>" +
				esc(window.CatalogoHabilidades.textoReferenciaPPM(bandaVisible, alumnoVisible.grado)) + "</span>" : "") +
			"</span><span class='font-semibold text-right'>" + nivelLect + "</span></div>" +
			"<div class='flex justify-between items-center text-sm py-1'><span class='text-gray-600'>Comprensión</span>" + semCirculo(compr) + "</div>" +
			"</div>" +
			"<div class='rounded-xl border border-gray-200 p-4'>" +
			"<h4 class='font-semibold text-gray-700 mb-2 text-sm'>Matemáticas</h4>";
		// Solo las habilidades de su grado (el del cierre si está cerrada), con su alcance
		const gradoMates = window.CatalogoHabilidades.gradoValido(alumnoVisible.grado);
		window.CatalogoHabilidades.matematicasDeGrado(alumnoVisible.grado).forEach(function (hab) {
			const alcance = window.CatalogoHabilidades.alcanceMatematica(hab, alumnoVisible.grado);
			seccion3 += "<div class='flex items-center justify-between gap-3 text-sm py-1 border-b border-gray-100 last:border-0' data-habilidad='" + esc(hab.clave) + "'>" +
				// En 1° y 2°, el nombre con que se evalúa (Fase 3): CatalogoHabilidades.etiquetaDeGrado
				"<span class='text-gray-600'>" + esc(window.CatalogoHabilidades.etiquetaDeGrado(hab, alumnoVisible.grado)) +
				(alcance ? "<span class='block text-xs text-gray-400' data-alcance>Alcance en " + gradoMates + "°: " + esc(alcance) + "</span>" : "") +
				"</span><span class='shrink-0 inline-flex'>" + semCirculo(matesMap[hab.clave]) + "</span></div>";
		});
		seccion3 += "</div></div>";

		// Sección 4: Observaciones + firmas.
		// El texto lo PROPONE la Capa 1 (js/textos-boleta.js, reglas sin IA) y se guarda
		// en boleta_trimestral.texto_autogenerado. Cada cuadro se rellena solo mientras el
		// maestro no lo haya escrito (TextosBoleta.esEditado): lo suyo nunca se pisa, ni
		// siquiera si lo dejó vacío a propósito.
		// field-sizing: el cuadro crece con su texto (antes 2 renglones escondían casi todo)
		const CLASE_TA = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none [field-sizing:content] min-h-[4.5rem]";
		// null = el maestro no lo ha escrito (propuesta); "" = lo vació a propósito
		const obsTrabajo = window.ReporteDatos.trabajoDiario(diagnostica, textos.trabajoDiario,
			boletaPorCampo[window.TextosBoleta.GENERAL], boletaYaCerrada).texto;
		boletaFilas = boletaPorCampo;

		function renglones(texto) {
			return Math.max(3, Math.min(10, Math.ceil(String(texto || "").length / 45) + 1));
		}

		function valorTexto(codigo, tipoTexto, generado) {
			const fila = boletaPorCampo[codigo] || {};
			if (window.TextosBoleta.esEditado(fila, tipoTexto)) return fila[tipoTexto] || "";
			if (boletaYaCerrada) return fila[tipoTexto] || ""; // como se entregó
			return fila[tipoTexto] || generado || "";
		}

		function textareaBoleta(codigo, tipoTexto, label, generado) {
			const fila = boletaPorCampo[codigo] || {};
			const valor = valorTexto(codigo, tipoTexto, generado);
			const deIa = (fila.texto_autogenerado || {}).visible === "ia" && fila[tipoTexto];
			// Campo con la confirmada fuera de la escala: la base no deja guardar sus textos
			// hasta confirmar de nuevo; solo lectura, para que no se escriba algo que se pierda
			const soloLectura = todoCerrado || !!fuerasDeEscala[codigo];
			const marca = window.TextosBoleta.esEditado(fila, tipoTexto)
				? "<span class='text-xs font-normal text-gray-400 ml-1'>(tuyo)</span>"
				: deIa ? "<span class='text-xs font-normal text-violet-600 ml-1'>(redactado con IA)</span>"
				: (generado && !boletaYaCerrada ? "<span class='text-xs font-normal text-blue-500 ml-1'>(propuesto)</span>" : "");
			return "<div><label class='block text-xs font-semibold text-gray-600 mb-1'>" + label + marca + "</label>" +
				"<textarea data-boleta-campo='" + codigo + "' data-boleta-tipo='" + tipoTexto + "'" +
				" data-inicial='" + esc(valor) + "' rows='" + renglones(valor) + "'" + (soloLectura ? " readonly" : "") +
				" class='" + CLASE_TA + (soloLectura ? " bg-gray-50 text-gray-700" : "") + "'>" +
				esc(valor) + "</textarea></div>";
		}

		function bloqueTextos(codigo, titulo, generado) {
			return "<div class='rounded-xl border border-gray-200 p-3'>" +
				"<p class='text-sm font-semibold text-gray-700 mb-2'>" + esc(titulo) + "</p>" +
				(fuerasDeEscala[codigo]
					? "<p class='text-xs text-amber-800 mb-2' data-textos-fuera-escala='" + codigo + "'>Para editar y guardar estos textos, primero elige y confirma la calificación de este campo.</p>"
					: "") +
				"<div class='grid grid-cols-1 sm:grid-cols-3 gap-3'>" +
				textareaBoleta(codigo, "fortalezas", "Fortalezas", window.TextosBoleta.comoParrafo(generado.fortalezas)) +
				textareaBoleta(codigo, "areas_oportunidad", "Áreas de oportunidad", window.TextosBoleta.comoParrafo(generado.areas)) +
				textareaBoleta(codigo, "sugerencias", "Sugerencias", window.TextosBoleta.comoParrafo(generado.sugerencias)) +
				"</div></div>";
		}

		let bloquesCampos = "";
		CAMPOS.forEach(function (cf, i) {
			const codigo = CODIGOS[i];
			bloquesCampos += bloqueTextos(codigo, CAMPOS_CORTOS[i], textos[codigo]);
		});

		let seccion4 =
			"<h3 class='font-bold text-gray-800 mb-2'>4. Observaciones del docente</h3>" +
			// Boleta cerrada: los textos quedan como se entregaron (solo lectura, sin proponer)
			(todoCerrado
				? "<div class='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-3 no-print'><p class='text-xs text-emerald-800'>La boleta está cerrada: los textos quedan como se entregaron.</p></div>"
				: "<div class='rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 no-print'>" +
				"<p class='text-xs text-blue-800'>Los textos marcados como <span class='font-semibold'>propuestos</span> salen de lo que ya capturaste. Edita lo que quieras: lo que escribas queda como tuyo y no se vuelve a sobreescribir. " +
				"No escribas datos de salud, discapacidad ni diagnósticos médicos o psicológicos (" + enlacePrivacidad() + ").</p>" +
				"<div class='flex flex-wrap gap-2 shrink-0'>" +
				(conIa
					? "<button id='boletaIaBtn' type='button' title='Reescribe los textos propuestos con mejor redacción. Los que editaste no se tocan.' class='min-h-[44px] px-4 rounded-lg border border-violet-300 bg-white text-sm font-medium text-violet-700 hover:bg-violet-50'>Redactar con IA</button>"
					: "") +
				"<button id='boletaRegenerarBtn' type='button' class='min-h-[44px] px-4 rounded-lg border border-blue-300 bg-white text-sm font-medium text-blue-700 hover:bg-blue-100'>Volver a proponer</button>" +
				"</div></div>") +
			"<div class='flex flex-col gap-3 mb-6'>" +
			"<div><label class='block text-xs font-semibold text-gray-600 mb-1'>Trabajo diario</label>" +
			"<textarea id='boletaObsTrabajo' rows='" + renglones(obsTrabajo) + "'" + (todoCerrado ? " readonly" : "") +
			" class='" + CLASE_TA + (todoCerrado ? " bg-gray-50 text-gray-700" : "") + "'>" + esc(obsTrabajo) + "</textarea></div>" +
			bloquesCampos +
			bloqueTextos("GEN", "Observaciones generales", textos.GEN) +
			"</div>" +
			"<div class='grid grid-cols-2 gap-12 mt-10 mb-2'>" +
			"<div class='text-center'><div class='border-t border-gray-400 pt-2 text-sm text-gray-600'>Docente</div></div>" +
			"<div class='text-center'><div class='border-t border-gray-400 pt-2 text-sm text-gray-600'>Padre / Tutor</div></div>" +
			"</div>";

		cont.innerHTML =
			"<div class='bg-white'>" + cabecera + seccion1 + seccion2 + seccion3 + seccion4 + "</div>";

		acciones.classList.remove("hidden");

		if (fallosPropuesta.length) {
			const soloCalificacion = fallosPropuesta.length === 1 && fallosPropuesta[0] === "la propuesta de calificación";
			avisoGuardado("No se " + (soloCalificacion ? "pudo" : "pudieron") + " guardar " + fallosPropuesta.join(" ni ") + " de esta boleta: " +
				((errorPropuesta && errorPropuesta.message) || "error desconocido") +
				". Lo que ves es la propuesta del sistema, todavía sin guardar. " + queHacerGuardado(errorPropuesta, "vuelve a generar la boleta."),
				"boletaAvisoPropuesta");
		}

		// ── Confirmar / cerrar: el número lo valida el maestro antes del cierre ──
		function calificacionesEnPantalla() {
			const filas = [];
			cont.querySelectorAll("select[data-cal-campo]").forEach(function (sel) {
				filas.push({
					maestro_id: userId, alumno_id: alumnoId, ciclo: cicloBoleta,
					trimestre: trimestre, campo: sel.dataset.calCampo,
					calificacion: parseInt(sel.value, 10),
					calificacion_confirmada: true,
				});
			});
			return filas;
		}

		async function guardarBoleta(filas, btn, textoOcupado) {
			const original = btn.textContent;
			btn.disabled = true;
			btn.textContent = textoOcupado;
			try {
				const { error } = await window.sb.from("boleta_trimestral")
					.upsert(filas, { onConflict: "maestro_id,alumno_id,ciclo,trimestre,campo" });
				if (error) throw error;
				await generarBoleta(); // re-render con el estado nuevo
			} catch (e) {
				console.error("boleta_trimestral:", e);
				btn.disabled = false;
				btn.textContent = original;
				window.alert("No se pudo guardar: " + (e.message || "error desconocido") + ". " + queHacerGuardado(e, "inténtalo de nuevo."));
				// Si la boleta se cerró en otra pestaña, la base lo rechaza: se muestra lo que hay
				await generarBoleta();
			}
		}

		const confirmarBtn = document.getElementById("boletaConfirmarBtn");
		if (confirmarBtn) {
			confirmarBtn.addEventListener("click", function () {
				const faltan = [], faltanFuera = [];
				cont.querySelectorAll("select[data-cal-campo]").forEach(function (sel) {
					if (sel.value !== "") return;
					// Confirmada fuera de la escala del grado de hoy, o campo sin evidencias
					if (sel.dataset.calFueraEscala) faltanFuera.push(sel.dataset.calNombre || sel.dataset.calCampo);
					else faltan.push(sel.dataset.calNombre || sel.dataset.calCampo);
				});
				if (faltan.length || faltanFuera.length) {
					window.alert("Falta elegir la calificación de: " + faltan.concat(faltanFuera).join(", ") + " (" +
						(faltanFuera.length
							? "su calificación confirmada ya no es válida en el grado actual del alumno" + (faltan.length ? "; las demás no tienen evidencias este trimestre" : "")
							: "sin evidencias este trimestre") +
						": el número es tu juicio docente).");
					return;
				}
				const filas = calificacionesEnPantalla();
				if (!filas.length) return;
				guardarBoleta(filas, confirmarBtn, "Guardando...");
			});
		}

		// "Volver a proponer": rehace los textos aunque el maestro ya los haya tocado
		const regenerarBtn = document.getElementById("boletaRegenerarBtn");
		if (regenerarBtn) {
			regenerarBtn.addEventListener("click", async function () {
				const hayEditados = CODIGOS.concat(["GEN"]).some(function (c) {
					return (boletaPorCampo[c] || {}).editado_manual;
				});
				if (hayEditados && !window.confirm(
					"Hay textos que editaste a mano. Al volver a proponer se reemplazan por los que genera el sistema. ¿Continuar?")) return;
				regenerarBtn.disabled = true;
				regenerarBtn.textContent = "Proponiendo...";
				const errorTextos = await guardarTextosPropuestos(textos, boletaPorCampo, {
					alumnoId: alumnoId, ciclo: cicloBoleta, trimestre: trimestre,
				}, true);
				if (errorTextos) {
					// No se vuelve a dibujar: la pantalla sigue con lo que hay en la base
					window.alert("No se pudieron volver a proponer los textos: " + (errorTextos.message || "error desconocido") +
						". No se cambió nada; revisa tu conexión e inténtalo de nuevo.");
					regenerarBtn.disabled = false;
					regenerarBtn.textContent = "Volver a proponer";
					return;
				}
				await generarBoleta();
			});
		}

		// "Redactar con IA": la función de servidor reescribe la propuesta y solo copia
		// a los cuadros que el maestro no ha editado
		const iaBtn = document.getElementById("boletaIaBtn");
		if (iaBtn) {
			iaBtn.addEventListener("click", async function () {
				iaBtn.disabled = true;
				iaBtn.textContent = "Redactando...";
				const { error } = await window.sb.functions.invoke("redactar-boleta", {
					body: { accion: "redactar", alumno_id: alumnoId, ciclo: cicloBoleta, trimestre: trimestre },
				});
				if (error) {
					let mensaje = "No se pudo redactar con IA.";
					try {
						const cuerpo = await error.context.json();
						if (cuerpo && cuerpo.error) mensaje = cuerpo.error;
					} catch (e) {}
					window.alert(mensaje);
					iaBtn.disabled = false;
					iaBtn.textContent = "Redactar con IA";
					return;
				}
				await generarBoleta();
			});
		}

		// Trabajo diario: es la observación del trimestre, vive en evaluacion_diagnostica
		// Si ya hay diagnóstico del trimestre se actualiza solo la observación (su fecha es
		// la de la evaluación, no la de hoy); si no, se crea con la fecha de hoy. Vaciarlo
		// guarda "" (vacío a propósito), que ya no se vuelve a proponer.
		const obsTrabajoEl = document.getElementById("boletaObsTrabajo");
		let guardarTrabajo = null; // también lo usa "Cerrar boleta"
		if (obsTrabajoEl && !obsTrabajoEl.readOnly) {
			let guardadoTrabajo = (obsTrabajo || "").trim();
			guardarTrabajo = async function () {
				const valor = obsTrabajoEl.value.trim();
				if (valor === guardadoTrabajo) return true;
				const guardadoAntes = guardadoTrabajo;
				guardadoTrabajo = valor;
				try {
					if (diagnostica && diagnostica.id) {
						const { error } = await window.sb.from("evaluacion_diagnostica")
							.update({ observaciones: valor }).eq("id", diagnostica.id).eq("maestro_id", userId);
						if (error) throw error;
						diagnostica.observaciones = valor;
					} else {
						const { data, error } = await window.sb.from("evaluacion_diagnostica").upsert({
							maestro_id: userId, alumno_id: alumnoId, grupo_id: grupoId,
							momento: "trimestre_" + trimestre, fecha: getLocalDateISO(),
							observaciones: valor,
						}, { onConflict: "maestro_id,alumno_id,momento" }).select("id").single();
						if (error) throw error;
						diagnostica = Object.assign({}, diagnostica || {}, { id: data.id, observaciones: valor });
					}
					avisoGuardado("");
					return true;
				} catch (err) {
					console.error("evaluacion_diagnostica (trabajo diario):", err);
					guardadoTrabajo = guardadoAntes; // se reintenta en el siguiente cambio o al salir
					avisoGuardado("No se pudo guardar el trabajo diario: " + ((err && err.message) || "error desconocido") +
						". Lo escrito sigue en pantalla; se volverá a intentar.");
					return false;
				}
			};
			obsTrabajoEl.addEventListener("blur", guardarTrabajo);
			obsTrabajoEl.addEventListener("input", conPausa(obsTrabajoEl, guardarTrabajo));
		}

		const cerrarBtn = document.getElementById("boletaCerrarBtn");
		if (cerrarBtn) {
			cerrarBtn.addEventListener("click", async function () {
				if (!window.confirm("Al cerrar la boleta, las calificaciones, los porcentajes y los textos quedan como están ahora y ya no se pueden cambiar. ¿Continuar?")) return;
				const filas = calificacionesEnPantalla();
				if (!filas.length) return;
				/*
					Defensa: se cierra con lo CONFIRMADO en la base, nunca con un número que la
					pantalla puso por su cuenta (un selector sin la opción confirmada muestra otra).
					Se leen las filas y el grado de hoy justo ahora; si algún campo no está
					confirmado, quedó fuera de la escala del grado o no coincide con la pantalla,
					no se cierra y se dice por qué (ReporteDatos.validarCierre).
				*/
				let revision;
				try {
					const { data: filasBase, error: errorFilas } = await window.sb.from("boleta_trimestral")
						.select("campo, calificacion, calificacion_confirmada, cerrada")
						.eq("maestro_id", userId).eq("alumno_id", alumnoId).eq("ciclo", cicloBoleta).eq("trimestre", trimestre);
					if (errorFilas) throw errorFilas;
					const { data: alumnoBase, error: errorAlumno } = await window.sb.from("alumnos")
						.select("grado").eq("id", alumnoId).eq("maestro_id", userId).maybeSingle();
					if (errorAlumno) throw errorAlumno;
					if (!alumnoBase) throw new Error("no se encontró al alumno");
					revision = RDB.validarCierre(filas, filasBase || [], alumnoBase.grado);
				} catch (e) {
					console.error("cerrar boleta (revisión):", e);
					window.alert("No se cerró la boleta: no se pudo comprobar lo confirmado (" + ((e && e.message) || "error desconocido") +
						"). Revisa tu conexión e inténtalo de nuevo.");
					return;
				}
				if (!revision.ok) {
					window.alert("No se cerró la boleta. " + revision.motivo);
					await generarBoleta(); // lo que hay en la base
					return;
				}
				// Lo que se acaba de escribir entra en lo que se entrega
				let todoGuardado = true;
				if (guardarCuadroBoleta) {
					const resultados = await Promise.all(Array.prototype.map.call(cont.querySelectorAll("textarea[data-boleta-campo]"), function (ta) {
						return guardarCuadroBoleta(ta);
					}));
					if (resultados.indexOf(false) !== -1) todoGuardado = false;
				}
				if (guardarTrabajo && !(await guardarTrabajo())) todoGuardado = false;
				// No se cierra con algo sin guardar: lo entregado no sería lo que está en pantalla
				if (!todoGuardado) {
					window.alert("No se cerró la boleta: no se pudo guardar lo que escribiste. Revisa tu conexión e inténtalo de nuevo.");
					return;
				}
				// Foto del trabajo diario tal como se entrega (vive en evaluacion_diagnostica y
				// podría editarse después en Diagnóstico)
				const trabajoFinal = obsTrabajoEl ? obsTrabajoEl.value.trim() : (obsTrabajo || "");
				const foto = {
					trabajo_diario: trabajoFinal,
					trabajo_diario_del_maestro: !!(diagnostica && diagnostica.observaciones !== null && diagnostica.observaciones !== undefined),
					// Cuaderno, lectura y matemáticas tal como se entregan (null = sin diagnóstico)
					diagnostico: window.ReporteDatos.fotoDiagnostico(diagnostica),
					asistencia: window.ReporteDatos.fotoAsistencia(asistenciaHoy),
					// Grado, fase, escala y referencia de PPM de hoy: si después cambia el grado del
					// alumno, lo entregado no se mueve (decisión de Jorge 6)
					alumno: window.ReporteDatos.fotoAlumno(alumno, bandas ? bandas[alumno.grado] || null : null),
					// Porcentaje, semáforo y desglose por rubro de cada campo (y si no había
					// evidencias: juicio docente), pesos y avance por PDA, para que Reportes, el
					// reporte, la junta y la exportación usen lo del cierre (decisión de Jorge 7)
					campos: window.ReporteDatos.fotoCampos(porCampo),
					pesos: Object.assign({}, motor.pesos || {}),
					avance_pda: window.ReporteDatos.fotoAvancePda(avancePda),
					examen_aproximado: !!motor.examenAproximado,
					usa_legacy: !!motor.usaLegacy,
					en: new Date().toISOString(),
				};
				/*
					Una sola transacción en la base (supabase/mi_salon_b8_cierre_2026-09.sql): la foto
					y el cierre de los cuatro campos van juntos o no va ninguno. Antes eran dos
					escrituras y un corte de red entre ellas dejaba la boleta cerrada sin foto.
				*/
				const original = cerrarBtn.textContent;
				cerrarBtn.disabled = true;
				cerrarBtn.textContent = "Cerrando...";
				try {
					const { error } = await window.sb.rpc("cerrar_boleta", {
						p_alumno: alumnoId, p_ciclo: cicloBoleta, p_trimestre: trimestre,
						p_calificaciones: revision.calificaciones, // las de la base, no las de la pantalla
						p_foto: foto,
					});
					if (error) throw error;
				} catch (e) {
					console.error("cerrar_boleta:", e);
					// Si falló la red, pudo haberse cerrado sin que llegara la respuesta: el cierre
					// es de todo o nada, y la pantalla se vuelve a dibujar con lo que hay en la base
					window.alert("No se pudo confirmar el cierre de la boleta (" + ((e && e.message) || "error desconocido") +
						"). Enseguida ves cómo quedó: cerrada completa o sin cambios; si sigue abierta, inténtalo de nuevo.");
					cerrarBtn.disabled = false;
					cerrarBtn.textContent = original;
				}
				// En los dos casos, la pantalla muestra lo que quedó en la base
				await generarBoleta();
			});
		}

		// Construir resumen plano para WhatsApp
		const lineCF = CAMPOS_CORTOS.map(function (corto, i) {
			// Solo la que vale (una confirmada fuera de la escala de hoy es "pendiente")
			const oficial = RDB.calificacionOficial(boletaPorCampo[CODIGOS[i]]);
			return corto + ": " + (oficial.confirmada ? oficial.valor : "pendiente");
		}).join(" | ");
		const asisTexto = (diasTotal > 0) ? (diasPresente + "/" + diasTotal + " días") : "—";
		boletaResumenTexto =
			"Boleta de " + (alumno.nombre_completo || "") + " — Trimestre " + trimestre + "\n" +
			lineCF + "\n" +
			"Asistencia (referencia): " + asisTexto;
	}

	/*
		Selector de calificación: al moverlo, recolorea y muestra cuál era la propuesta
		del sistema (para que el maestro vea de qué se está apartando). Se registra una
		sola vez sobre el contenedor, que sobrevive a cada render de la boleta.
	*/
	function sincronizarAvisoPropuesta(sel, contenedor) {
		if (!sel) return;
		const valorSel = parseInt(sel.value, 10);
		sel.className = "min-h-[44px] w-20 text-center font-bold rounded-lg border border-gray-300 bg-white " +
			colorCalif(valorSel);
		const aviso = contenedor.querySelector("span[data-cal-aviso='" + sel.dataset.calCampo + "']");
		if (!aviso || sel.dataset.calPropuesta === undefined) return;
		aviso.classList.toggle("hidden", valorSel === parseInt(sel.dataset.calPropuesta, 10));
	}

	const boletaSelectsEl = document.getElementById("boletaContainer");
	if (boletaSelectsEl) {
		boletaSelectsEl.addEventListener("change", function (e) {
			const sel = e.target.closest ? e.target.closest("select[data-cal-campo]") : null;
			if (sel) sincronizarAvisoPropuesta(sel, boletaSelectsEl);
		});
	}

	/*
		Guarda lo que propuso la Capa 1. Siempre deja la propuesta en
		texto_autogenerado (para poder compararla y para la Capa 2 con IA), pero solo
		escribe los campos visibles cuando el maestro no los ha tocado.
		`forzar` = el maestro pidió "Volver a proponer": entonces sí se reescribe todo
		y las filas vuelven a quedar como propuestas.
		Devuelve null si se guardó (o no había nada que guardar) o el error. Si falla, el
		estado local vuelve a lo que hay en la base: la pantalla no muestra como guardado lo
		que no llegó.
	*/
	async function guardarTextosPropuestos(textos, boletaPorCampo, ctx, forzar) {
		const filas = [];
		const antes = Object.assign({}, boletaPorCampo);
		CODIGOS.concat([window.TextosBoleta.GENERAL]).forEach(function (codigo) {
			const generado = textos[codigo];
			if (!generado) return;
			const fila = boletaPorCampo[codigo] || {};
			if (fila.cerrada) return; // boleta cerrada: no se toca
			// Confirmada fuera de la escala de hoy: la base rechaza toda escritura en esa fila
			// (y tumbaría el guardado de los demás campos); la boleta lo avisa
			if (window.ReporteDatos && window.ReporteDatos.fueraDeEscala(fila)) return;
			// Sin nada que proponer y sin fila previa: no se crea una fila vacía
			const hayTexto = generado.fortalezas.length || generado.areas.length || generado.sugerencias.length;
			if (!hayTexto && !fila.id) return;
			const propuesta = {
				fortalezas: window.TextosBoleta.comoParrafo(generado.fortalezas),
				areas_oportunidad: window.TextosBoleta.comoParrafo(generado.areas),
				sugerencias: window.TextosBoleta.comoParrafo(generado.sugerencias),
				generado_en: new Date().toISOString(),
			};
			const TB = window.TextosBoleta;
			const previo = fila.texto_autogenerado || {};
			// Lo que redactó la IA (Capa 2) se conserva: la Capa 1 solo lo reemplaza si el
			// maestro pide "Volver a proponer"
			const conIa = !forzar && previo.visible === "ia";
			// Cuadros que escribió el maestro: se respetan (incluso vacíos) salvo "Volver a proponer"
			const editados = forzar ? [] : TB.TIPOS_TEXTO.filter(function (t) { return TB.esEditado(fila, t); });
			const aEscribir = conIa ? [] : TB.TIPOS_TEXTO.filter(function (t) { return editados.indexOf(t) === -1; });
			const payload = {
				maestro_id: userId, alumno_id: ctx.alumnoId, ciclo: ctx.ciclo,
				trimestre: ctx.trimestre, campo: codigo,
				texto_autogenerado: Object.assign({}, propuesta,
					previo.ia ? { ia: previo.ia } : {},
					{ visible: conIa ? "ia" : "reglas", editados: editados }),
			};
			aEscribir.forEach(function (t) { payload[t] = propuesta[t] || null; });
			if (forzar) payload.editado_manual = false;
			// El estado local también, para que el render muestre lo mismo que se guardó
			boletaPorCampo[codigo] = Object.assign({}, fila, payload);
			filas.push(payload);
		});
		if (!filas.length) return null;
		try {
			// Filas con y sin cuadros visibles tienen forma distinta: un upsert por forma,
			// o PostgREST le pone NULL a los cuadros que una fila no trae
			await upsertPorForma("boleta_trimestral", filas, "maestro_id,alumno_id,ciclo,trimestre,campo");
			return null;
		} catch (e) {
			console.error("boleta_trimestral (textos):", e);
			Object.keys(boletaPorCampo).forEach(function (k) { if (!(k in antes)) delete boletaPorCampo[k]; });
			Object.assign(boletaPorCampo, antes);
			return e || new Error("error desconocido");
		}
	}

	// ═══════════════════════════════════════════════════════════════
	// TAB 5 — AVANCE POR PDA (B.5)
	// Lee la vista v_avance_pda: una fila por alumno y PDA del trimestre, con las
	// evidencias que dejó cada producto calificado. El maestro no captura nada aquí.
	// ═══════════════════════════════════════════════════════════════
	(function poblarAlumnosPda() {
		const sel = document.getElementById("selectAlumnoPda");
		if (!sel) return;
		alumnos.forEach(function (al) {
			const opt = document.createElement("option");
			opt.value = al.id;
			opt.textContent = (al.num_lista ? al.num_lista + ". " : "") + (al.nombre_completo || "Sin nombre") +
				(al.grado ? " (" + al.grado + "°)" : "");
			sel.appendChild(opt);
		});
	})();

	const ETIQUETA_NIVEL = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
	const ETIQUETA_TENDENCIA = { mejora: "Va mejorando", baja: "Va bajando", estable: "Estable", sin_datos: "Falta evidencia" };
	const CLASE_TENDENCIA = {
		mejora: "text-emerald-600", baja: "text-red-500",
		estable: "text-gray-500", sin_datos: "text-gray-400",
	};

	function etiquetaNivel(nivel) {
		return "<span class='inline-flex items-center gap-2 text-sm'>" + semCirculo(nivel) +
			"<span>" + (ETIQUETA_NIVEL[nivel] || "—") + "</span></span>";
	}

	function campoCorto(campoLargo) {
		const codigo = window.CamposFormativos ? window.CamposFormativos.corto(campoLargo) : null;
		return codigo || "—";
	}

	const pdaBtn = document.getElementById("generarPdaBtn");
	if (pdaBtn) {
		pdaBtn.addEventListener("click", async function () {
			const cont = document.getElementById("pdaContainer");
			const alumnoId = document.getElementById("selectAlumnoPda").value;
			const trimestre = parseInt(document.getElementById("selectTrimPda").value, 10);
			cont.innerHTML = "<p class='text-gray-400 text-sm'>Cargando avance...</p>";

			// Todo el grupo: una fila por alumno y PDA, pasa de 1000 con facilidad (js/leer-todo.js)
			let data = null, error = null;
			try {
				data = await window.LeerTodo.paginas(function () {
					let query = window.sb.from("v_avance_pda").select("*")
						.eq("maestro_id", userId).eq("grupo_id", grupoId).eq("trimestre", trimestre);
					if (alumnoId) query = query.eq("alumno_id", alumnoId);
					return query.order("alumno_id").order("clave_pda");
				});
			} catch (e) { error = e; }

			if (error) {
				console.error("v_avance_pda:", error);
				cont.innerHTML = "<p class='text-red-500 text-sm'>No se pudo cargar el avance: " + esc(error.message) + "</p>";
				return;
			}
			if (!data || !data.length) {
				cont.innerHTML = "<div class='py-8 text-center'>" +
					"<p class='text-gray-400 text-lg mb-2'>Todavía no hay evidencias</p>" +
					"<p class='text-sm text-gray-400'>Las evidencias aparecen aquí conforme califiques los productos de cada sesión en la pantalla Hoy.</p></div>";
				return;
			}
			cont.innerHTML = alumnoId ? tablaPdaAlumno(data) : tablaPdaGrupo(data);
		});
	}

	// Vista por alumno: en qué va cada PDA que se le ha trabajado
	function tablaPdaAlumno(filas) {
		filas.sort(function (a, b) {
			const orden = { requiere_apoyo: 0, en_proceso: 1, logrado: 2 };
			return orden[a.nivel_predominante] - orden[b.nivel_predominante] || (b.evidencias - a.evidencias);
		});
		let html = "<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-3 py-3 text-left'>PDA</th>" +
			"<th class='px-3 py-3 text-center'>Campo</th>" +
			"<th class='px-3 py-3 text-center'>Evidencias</th>" +
			"<th class='px-3 py-3 text-left'>Nivel</th>" +
			"<th class='px-3 py-3 text-left'>Tendencia</th>" +
			"</tr></thead><tbody class='divide-y divide-gray-100'>";
		filas.forEach(function (f) {
			const ajustes = f.ajustadas_por_el_maestro > 0
				? "<span class='block text-xs text-gray-400'>" + f.ajustadas_por_el_maestro + " ajustada(s) por ti</span>" : "";
			html += "<tr class='hover:bg-gray-50 align-top'>" +
				"<td class='px-3 py-3'><span class='text-gray-800'>" + esc(f.pda || "—") + "</span>" +
				(f.contenido ? "<span class='block text-xs text-gray-400'>" + esc(f.contenido) + "</span>" : "") + ajustes + "</td>" +
				"<td class='px-3 py-3 text-center text-gray-600'>" + campoCorto(f.campo_formativo) + "</td>" +
				"<td class='px-3 py-3 text-center'>" + f.evidencias +
				"<span class='block text-xs text-gray-400'>" + f.logrados + " · " + f.en_proceso + " · " + f.requiere_apoyo + "</span></td>" +
				"<td class='px-3 py-3'>" + etiquetaNivel(f.nivel_predominante) + "</td>" +
				"<td class='px-3 py-3 " + (CLASE_TENDENCIA[f.tendencia] || "") + "'>" +
				(ETIQUETA_TENDENCIA[f.tendencia] || "—") + "</td>" +
				"</tr>";
		});
		return html + "</tbody></table></div>" +
			"<p class='text-xs text-gray-400 mt-3'>Evidencias: total y, debajo, cuántas fueron logrado · en proceso · requiere apoyo.</p>";
	}

	// Vista de grupo: qué PDA hay que reforzar, con los alumnos que lo necesitan
	function tablaPdaGrupo(filas) {
		const porPda = {};
		filas.forEach(function (f) {
			const clave = f.grado + "||" + f.clave_pda;
			if (!porPda[clave]) {
				porPda[clave] = {
					pda: f.pda, contenido: f.contenido, campo: f.campo_formativo, grado: f.grado,
					logrado: 0, en_proceso: 0, requiere_apoyo: 0, alumnos: 0,
				};
			}
			const p = porPda[clave];
			p.alumnos++;
			p[f.nivel_predominante]++;
		});
		const lista = Object.keys(porPda).map(function (k) { return porPda[k]; })
			.sort(function (a, b) { return b.requiere_apoyo - a.requiere_apoyo || b.en_proceso - a.en_proceso; });

		let html = "<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-3 py-3 text-left'>PDA</th>" +
			"<th class='px-3 py-3 text-center'>Grado</th>" +
			"<th class='px-3 py-3 text-center'>Campo</th>" +
			"<th class='px-3 py-3 text-center'>Alumnos</th>" +
			"<th class='px-3 py-3 text-left'>Cómo va el grupo</th>" +
			"</tr></thead><tbody class='divide-y divide-gray-100'>";
		lista.forEach(function (p) {
			const barra = function (n, clase) {
				if (!n) return "";
				return "<span class='" + clase + " h-2 rounded-sm' style='width:" +
					Math.round((n / p.alumnos) * 100) + "%'></span>";
			};
			html += "<tr class='hover:bg-gray-50 align-top'>" +
				"<td class='px-3 py-3'><span class='text-gray-800'>" + esc(p.pda || "—") + "</span>" +
				(p.contenido ? "<span class='block text-xs text-gray-400'>" + esc(p.contenido) + "</span>" : "") + "</td>" +
				"<td class='px-3 py-3 text-center text-gray-600'>" + (p.grado ? p.grado + "°" : "—") + "</td>" +
				"<td class='px-3 py-3 text-center text-gray-600'>" + campoCorto(p.campo) + "</td>" +
				"<td class='px-3 py-3 text-center text-gray-600'>" + p.alumnos + "</td>" +
				"<td class='px-3 py-3'>" +
				"<span class='flex w-40 gap-0.5 mb-1'>" +
				barra(p.logrado, "bg-emerald-500") + barra(p.en_proceso, "bg-amber-400") + barra(p.requiere_apoyo, "bg-red-500") +
				"</span>" +
				"<span class='text-xs text-gray-500'>" + p.logrado + " logrado · " + p.en_proceso +
				" en proceso · " + p.requiere_apoyo + " requiere apoyo</span></td>" +
				"</tr>";
		});
		return html + "</tbody></table></div>" +
			"<p class='text-xs text-gray-400 mt-3'>Ordenado por lo que más hay que reforzar. Cada alumno cuenta con su nivel predominante en ese PDA.</p>";
	}

	// Llama a fn cuando el elemento lleva ~1 s sin cambios (un temporizador por elemento)
	function conPausa(el, fn) {
		return function () {
			clearTimeout(el._pausa);
			el._pausa = setTimeout(fn, 1000);
		};
	}

	/*
		Guardado rechazado por la escala del grado (trigger boleta_trimestral_piso_fase:
		"Calificación 5 inválida para 1 grado"): pasa cuando cambió el grado del alumno
		después de confirmar. No es la conexión: se dice qué hacer.
	*/
	function esRechazoDeEscala(err) {
		return /inválida para \d+ grado/i.test((err && err.message) || "");
	}
	function queHacerGuardado(err, siNo) {
		if (esRechazoDeEscala(err)) {
			return "Cambió el grado del alumno y una calificación confirmada ya no es válida en su escala: elige y confirma de nuevo esa calificación en esta boleta.";
		}
		return "Revisa tu conexión y " + siNo;
	}

	// Aviso en la boleta cuando un guardado falla (lo escrito sigue en pantalla y se reintenta).
	// id: cada tipo de guardado tiene su aviso; el de la propuesta ("boletaAvisoPropuesta") no
	// lo quita que después se guarde bien un cuadro de texto, solo volver a generar la boleta
	function avisoGuardado(texto, id) {
		const cont = document.getElementById("boletaContainer");
		if (!cont) return;
		const idAviso = id || "boletaAvisoGuardado";
		let el = document.getElementById(idAviso);
		if (!texto) { if (el) el.remove(); return; }
		if (!el) {
			el = document.createElement("div");
			el.id = idAviso;
			el.className = "sticky top-2 z-20 mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 no-print";
			cont.prepend(el);
		}
		el.textContent = texto;
	}

	// ── Autosave de observaciones de boleta (on-blur, upsert por campo) ──
	// Editar a mano marca editado_manual = true y anota ESE cuadro en
	// texto_autogenerado.editados: la Capa 1 nunca sobreescribe lo que el maestro
	// escribió (ni si lo dejó vacío), y los otros dos cuadros del campo siguen
	// recibiendo propuestas.
	const boletaContEl = document.getElementById("boletaContainer");
	if (boletaContEl) {
		const guardarCuadro = guardarCuadroBoleta = async function (ta) {
			if (!ta || !boletaCtx || ta.readOnly) return true; // boleta cerrada: nada que guardar
			// Salir del cuadro sin cambiar nada NO cuenta como edición: si contara, el
			// primer clic marcaría el texto como del maestro y ya no se volvería a proponer.
			if (ta.value === (ta.dataset.inicial || "")) return true;
			const inicialAntes = ta.dataset.inicial || "";
			ta.dataset.inicial = ta.value;
			const campo = ta.dataset.boletaCampo;
			const tipo = ta.dataset.boletaTipo;
			const fila = boletaFilas[campo] || {};
			const previo = fila.texto_autogenerado || {};
			const TB = window.TextosBoleta;
			const editados = TB.TIPOS_TEXTO.filter(function (t) { return t === tipo || TB.esEditado(fila, t); });
			const payload = {
				maestro_id: userId,
				alumno_id: boletaCtx.alumnoId,
				ciclo: boletaCtx.ciclo,
				trimestre: boletaCtx.trimestre,
				campo: campo,
				editado_manual: true,
				texto_autogenerado: Object.assign({}, previo, { editados: editados }),
			};
			payload[tipo] = ta.value.trim() || null;
			boletaFilas[campo] = Object.assign({}, fila, payload);
			// La marca "(tuyo)" del cuadro, sin volver a pintar toda la boleta
			const etiqueta = ta.parentElement ? ta.parentElement.querySelector("label") : null;
			if (etiqueta) {
				const marca = etiqueta.querySelector("span");
				if (marca) marca.remove();
				etiqueta.insertAdjacentHTML("beforeend", "<span class='text-xs font-normal text-gray-400 ml-1'>(tuyo)</span>");
			}
			try {
				const { error } = await window.sb.from("boleta_trimestral")
					.upsert(payload, { onConflict: "maestro_id,alumno_id,ciclo,trimestre,campo" });
				if (error) throw error;
				avisoGuardado("");
				return true;
			} catch (err) {
				// Se deshace la marca de guardado para que el siguiente intento lo vuelva a mandar
				console.error("boleta_trimestral (texto):", err);
				// La boleta se cerró (en otra pestaña): la base lo rechaza; se muestra como quedó
				if (/cerrada|Cerrar boleta/i.test((err && err.message) || "")) {
					window.alert("Esta boleta ya se cerró (quizá en otra pestaña): el cambio no se guardó. Se muestra como quedó.");
					await generarBoleta();
					return false;
				}
				ta.dataset.inicial = inicialAntes;
				avisoGuardado("No se pudo guardar un cuadro de texto: " + ((err && err.message) || "error desconocido") +
					". Lo escrito sigue en pantalla; se volverá a intentar al salir del cuadro." +
					(esRechazoDeEscala(err) ? " " + queHacerGuardado(err, "") : ""));
				return false;
			}
		};
		boletaContEl.addEventListener("blur", function (e) {
			const ta = e.target.closest ? e.target.closest("textarea[data-boleta-campo]") : null;
			if (ta) guardarCuadro(ta);
		}, true); // captura: blur no burbujea
		// También mientras escribe (tras una pausa): recargar sin salir del cuadro ya no
		// pierde lo escrito
		boletaContEl.addEventListener("input", function (e) {
			const ta = e.target.closest ? e.target.closest("textarea[data-boleta-campo]") : null;
			if (ta) conPausa(ta, function () { return guardarCuadro(ta); })();
		});
	}

	// ── Botones de distribución de la boleta ──
	// Enlaces a la boleta imprimible y al reporte detallado del alumno elegido
	function enlaceAlumno(pagina) {
		const alumnoId = document.getElementById("selectAlumnoBoleta").value;
		const trimestre = document.getElementById("selectTrimBoleta").value;
		if (!alumnoId) return;
		window.open(pagina + "?alumno=" + encodeURIComponent(alumnoId) + "&trimestre=" + encodeURIComponent(trimestre), "_blank");
	}
	const boletaImprimirBtn = document.getElementById("boletaImprimirBtn");
	if (boletaImprimirBtn) boletaImprimirBtn.addEventListener("click", function () { enlaceAlumno("boleta.html"); });
	const boletaReporteBtn = document.getElementById("boletaReporteBtn");
	if (boletaReporteBtn) boletaReporteBtn.addEventListener("click", function () { enlaceAlumno("reporte-alumno.html"); });

	const boletaWhatsappBtn = document.getElementById("boletaWhatsappBtn");
	if (boletaWhatsappBtn) {
		boletaWhatsappBtn.addEventListener("click", function () {
			if (!boletaResumenTexto) return;
			window.open("https://wa.me/?text=" + encodeURIComponent(boletaResumenTexto), "_blank");
		});
	}
});
