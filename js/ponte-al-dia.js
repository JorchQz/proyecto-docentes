/*
	ponte-al-dia.js — Asistente "Ponte al día" (registro histórico; spec de Jorge del 2026-09-26,
	§4.1). Quien entra a mitad del trimestre captura en una tarde lo que ya lleva:

	  1. Alumnos: su lista (ya guardada en el alta) y, si faltan, pegar más (js/lista-pegada.js).
	  2. Asistencia pasada: del inicio del trimestre a AYER, con los días de clase del calendario SEP
	     y los ajustes del grupo. Por omisión "Todos asistieron": el docente solo toca las faltas en
	     una cuadrícula alumno × día (una semana a la vez). Se escribe en asistencias con el mismo
	     modelo que la pantalla Asistencia (presente / ausente / justificada; una fila por alumno y
	     día). Lo que ya estaba capturado se respeta. La base la marca es_historico (mi_salon_b20).
	  3. Trabajos y exámenes pasados: varias actividades de una vez (fecha, campo, grados y PDA
	     opcional) como actividades sueltas del trimestre (agregar_actividades_historicas, que usa
	     agregar_actividad_suelta de b17) y su semáforo en una cuadrícula alumno × actividad. Cada
	     calificación lleva la fecha de su actividad y capturado_en = ahora (es_historico). Para
	     exámenes, el camino de siempre: Exámenes → "Solo subir resultados".
	  4. Revisar la boleta: la calificación propuesta por campo con lo capturado y cómo se calculó
	     (el motor único, js/motor-calificacion.js; la conversión solo en SQL). Ahí mismo, la
	     calificación directa del trimestre (§4.2): una propuesta que la boleta toma en lugar de la
	     calculada; se borra para volver al cálculo. La oficial sigue siendo la que el docente
	     confirma en Reportes → Boleta.

	Todo paso se puede saltar; el avance queda en ponte_al_dia (se retoma desde Inicio). Las
	reglas puras viven en js/historico.js (pruebas/registro-historico.test.js).
*/

document.addEventListener("DOMContentLoaded", function () {
	if (!window.sb) return;
	var H = window.Historico;
	var A = window.AlcanceHoy;
	var M = window.MotorCalificacion;
	var RD = window.ReporteDatos;
	var CS = window.CalendarioSEP;

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var NOMBRE_CAMPO = { LEN: "Lenguajes", SAB: "Saberes y Pensamiento Científico", ETI: "Ética, Naturaleza y Sociedades", DHL: "De lo Humano y lo Comunitario" };
	var CORTO_CAMPO = { LEN: "Lenguajes", SAB: "Saberes", ETI: "Ética", DHL: "De lo Humano" };
	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };
	var PASOS = [
		{ n: 1, titulo: "Alumnos" },
		{ n: 2, titulo: "Asistencia pasada" },
		{ n: 3, titulo: "Trabajos y exámenes" },
		{ n: 4, titulo: "Revisar la boleta" },
	];
	var BTN_PRI = "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed";
	var BTN_SEC = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed";
	var BTN_OK = "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed";
	var ICONO_OK = "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m5 12 5 5L20 7'/></svg>";
	var ICONO_IZQ = "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m15 18-6-6 6-6'/></svg>";
	var ICONO_DER = "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m9 18 6-6-6-6'/></svg>";

	var el = {
		sub: document.getElementById("ponteSub"),
		intro: document.getElementById("ponteIntro"),
		introTexto: document.getElementById("ponteIntroTexto"),
		empezar: document.getElementById("ponteEmpezar"),
		pasos: document.getElementById("pontePasos"),
		pasosLista: document.getElementById("pontePasosLista"),
		mensaje: document.getElementById("ponteMensaje"),
		contenido: document.getElementById("ponteContenido"),
		salir: document.getElementById("ponteSalir"),
		ocultar: document.getElementById("ponteOcultar"),
		dlgPda: document.getElementById("dlgPda"),
		dlgCalculo: document.getElementById("dlgCalculo"),
	};

	var userId = null, grupo = null, alumnos = [], gradosGrupo = [];
	var hoy = null, ayer = null, trimestre = 1, inicio = null, ajustesCal = [];
	var progreso = null; // fila de ponte_al_dia
	var pasoActual = 1;

	// ── Utilidades ────────────────────────────────────────────────────────────
	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function hoyLocal() {
		var d = new Date();
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	// El momento de la captura (el del aparato): la base decide con él si es histórica
	function ahora() { return new Date().toISOString(); }
	var MESES_C = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
	var DIAS_C = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
	function fechaCorta(iso) {
		var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		return m ? Number(m[3]) + " " + MESES_C[Number(m[2]) - 1] : "";
	}
	function diaSemana(iso) { return DIAS_C[new Date(String(iso).slice(0, 10) + "T12:00:00Z").getUTCDay()]; }
	function mensaje(tipo, texto) {
		if (!texto) { el.mensaje.className = "hidden"; el.mensaje.textContent = ""; return; }
		el.mensaje.textContent = texto;
		el.mensaje.className = "rounded-xl px-4 py-3 text-sm " +
			(tipo === "error" ? "bg-red-50 text-red-800 border border-red-200" : tipo === "ok" ? "bg-emerald-50 text-emerald-900 border border-emerald-200" : "bg-blue-50 text-blue-900 border border-blue-200");
	}
	function textoError(e) { return (e && e.message) || "error desconocido"; }
	function chipCampo(c) {
		return "<span class='inline-flex items-center gap-1 text-xs text-gray-700'><span class='inline-block w-2.5 h-2.5 rounded-full' style='background:" + COLOR_CAMPO[c] + "'></span>" + esc(CORTO_CAMPO[c] || c) + "</span>";
	}
	function textoGrados(gs) {
		var t = (gs || []).map(function (g) { return g + "°"; });
		return t.length <= 1 ? (t[0] || "") : t.slice(0, -1).join(", ") + " y " + t[t.length - 1];
	}
	function porLotes(lista, n) {
		var salida = [];
		for (var i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
		return salida;
	}

	// ── Avance (ponte_al_dia) ────────────────────────────────────────────────
	async function guardarProgreso(cambios) {
		var fila = Object.assign({
			maestro_id: userId, grupo_id: grupo.id,
			estado: progreso && progreso.estado === "terminado" ? "terminado" : "en_curso",
			paso: pasoActual, pasos_hechos: (progreso && progreso.pasos_hechos) || [],
		}, cambios || {});
		var res = await window.sb.from("ponte_al_dia").upsert(fila, { onConflict: "grupo_id" }).select("estado, paso, pasos_hechos").single();
		if (res.error) { console.error("ponte al día: avance", res.error); return false; }
		progreso = res.data;
		return true;
	}
	function hecho(n) { return !!(progreso && (progreso.pasos_hechos || []).map(Number).indexOf(n) !== -1); }
	async function marcarHecho(n, siguiente) {
		var hechos = ((progreso && progreso.pasos_hechos) || []).map(Number);
		if (hechos.indexOf(n) === -1) hechos.push(n);
		hechos.sort();
		await guardarProgreso({ pasos_hechos: hechos, paso: siguiente || n });
	}

	function pintarPasos() {
		el.pasosLista.innerHTML = PASOS.map(function (p) {
			var activo = p.n === pasoActual, ok = hecho(p.n);
			return "<li><button type='button' data-ir-paso='" + p.n + "' aria-current='" + (activo ? "step" : "false") + "' " +
				"class='w-full min-h-[44px] flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold " +
				(activo ? "border-blue-700 bg-blue-700 text-white" : ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50") + "'>" +
				"<span class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full " + (activo ? "bg-white text-blue-800" : ok ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-700") + "'>" +
				(ok && !activo ? ICONO_OK : p.n) + "</span><span class='min-w-0 leading-tight'>" + esc(p.titulo) + "</span></button></li>";
		}).join("");
	}
	el.pasosLista.addEventListener("click", function (e) {
		var b = e.target.closest("[data-ir-paso]");
		if (b) irA(Number(b.dataset.irPaso));
	});

	// conMensaje: el aviso que se acaba de dar (lo guardado en el paso anterior) se queda a la vista
	// Turno: si el docente cambia de paso mientras uno carga, el que llega tarde no se dibuja encima
	var turno = 0;
	async function irA(n, conMensaje) {
		var t = ++turno;
		pasoActual = n;
		if (!conMensaje) mensaje(null);
		pintarPasos();
		el.contenido.innerHTML = "<p class='text-sm text-gray-500'>Cargando...</p>";
		window.scrollTo(0, 0);
		try {
			if (n === 1) await paso1();
			else if (n === 2) await paso2();
			else if (n === 3) await paso3();
			else await paso4();
		} catch (e) {
			if (t !== turno) return;
			console.error("ponte al día: paso " + n, e);
			el.contenido.innerHTML = "<p class='text-sm text-red-700'>No se pudo cargar este paso: " + esc(textoError(e)) + ". Revisa tu conexión y vuelve a intentarlo.</p>" +
				"<button type='button' class='mt-3 " + BTN_SEC + "' data-reintentar>Reintentar</button>";
			var r = el.contenido.querySelector("[data-reintentar]");
			if (r) r.addEventListener("click", function () { irA(n); });
		}
	}

	function pie(n, opciones) {
		opciones = opciones || {};
		return "<div class='mt-6 pt-4 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2'>" +
			(n > 1 ? "<button type='button' data-anterior class='" + BTN_SEC + "'>" + ICONO_IZQ + "Paso anterior</button>" : "<span></span>") +
			"<div class='flex flex-col sm:flex-row gap-2'>" +
			(opciones.saltar ? "<button type='button' data-saltar class='" + BTN_SEC + "'>Saltar este paso</button>" : "") +
			(opciones.siguiente ? "<button type='button' data-siguiente class='" + BTN_PRI + "'>" + esc(opciones.siguiente) + ICONO_DER + "</button>" : "") +
			"</div></div>";
	}
	function conectarPie(n, alSiguiente) {
		var ant = el.contenido.querySelector("[data-anterior]");
		if (ant) ant.addEventListener("click", function () { irA(n - 1); });
		var sal = el.contenido.querySelector("[data-saltar]");
		if (sal) sal.addEventListener("click", async function () { await guardarProgreso({ paso: Math.min(4, n + 1) }); irA(Math.min(4, n + 1)); });
		var sig = el.contenido.querySelector("[data-siguiente]");
		if (sig) sig.addEventListener("click", alSiguiente);
	}

	// ── Lecturas comunes ──────────────────────────────────────────────────────
	async function leerAlumnos() {
		alumnos = await window.Lectura.uno(window.sb.from("alumnos")
			.select("id, nombre_completo, grado, num_lista, created_at")
			.eq("maestro_id", userId).eq("grupo_id", grupo.id).eq("estatus", "activo")
			.order("grado").order("num_lista")) || [];
		alumnos.forEach(function (a) { a.alta = A.fechaAlta(a.created_at, grupo.created_at); a.grado = Number(a.grado); });
	}

	// ══════════════════════════════════════════════════════════════════════════
	// Paso 1: alumnos
	// ══════════════════════════════════════════════════════════════════════════
	async function paso1() {
		var t = turno;
		await leerAlumnos();
		if (t !== turno) return;
		var porGrado = {};
		alumnos.forEach(function (a) { porGrado[a.grado] = (porGrado[a.grado] || 0) + 1; });
		var resumen = Object.keys(porGrado).sort().map(function (g) { return porGrado[g] + " de " + g + "°"; }).join(" · ");
		el.contenido.innerHTML =
			"<h2 class='text-lg font-bold text-gray-900'>1. Tus alumnos</h2>" +
			"<p class='mt-1 text-sm text-gray-600'>" + (alumnos.length
				? "Tu grupo tiene <strong>" + alumnos.length + " alumnos</strong>" + (gradosGrupo.length > 1 ? " (" + esc(resumen) + ")" : "") + "."
				: "Tu grupo todavía no tiene alumnos: pega tu lista.") + "</p>" +
			(alumnos.length
				? "<details class='mt-3 rounded-xl border border-gray-200'><summary class='min-h-[44px] flex items-center px-4 cursor-pointer text-sm font-semibold text-gray-700'>Ver la lista</summary>" +
					"<ol class='px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 text-sm text-gray-800'>" + alumnos.map(function (a) {
						return "<li class='py-1 border-b border-gray-100 flex gap-2'><span class='w-6 text-right text-gray-400'>" + esc(a.num_lista || "") + "</span><span class='min-w-0 break-words'>" + esc(a.nombre_completo) +
							"</span><span class='ml-auto text-xs text-gray-500'>" + a.grado + "°</span></li>";
					}).join("") + "</ol></details>" +
					"<p class='mt-2 text-xs text-gray-500'>Para corregir un nombre o un grado: <a href='mi-grupo.html' class='font-semibold text-blue-700 underline'>Mi grupo</a>.</p>"
				: "") +
			"<div class='mt-5 rounded-xl border border-gray-200 p-3 sm:p-4'>" +
			"<h3 class='text-sm font-bold text-gray-800 mb-2'>" + (alumnos.length ? "¿Te faltan alumnos? Pega más" : "Pega tu lista") + "</h3>" +
			"<div id='ponteListaPegada'></div></div>" +
			pie(1, { siguiente: "Siguiente: asistencia" });
		window.ListaPegada.montar(document.getElementById("ponteListaPegada"), {
			grados: gradosGrupo,
			existentes: function () { return alumnos.map(function (a) { return a.nombre_completo; }); },
			textoBoton: function (n) { return "Guardar " + n + (n === 1 ? " alumno" : " alumnos"); },
			alConfirmar: async function (filas) {
				var siguiente = alumnos.reduce(function (m, a) { return Math.max(m, Number(a.num_lista) || 0); }, 0);
				var nuevos = filas.map(function (f, i) {
					return { maestro_id: userId, grupo_id: grupo.id, nombre_completo: f.nombre_completo, grado: f.grado, num_lista: siguiente + i + 1, estatus: "activo" };
				});
				var res = await window.sb.from("alumnos").insert(nuevos).select("id");
				if (res.error) throw res.error;
				await paso1();
				mensaje("ok", nuevos.length + (nuevos.length === 1 ? " alumno guardado." : " alumnos guardados.") + " Su número de lista sigue al del último; puedes reordenarlo en Mi grupo.");
			},
		});
		conectarPie(1, async function () {
			if (!alumnos.length) { mensaje("error", "Primero guarda tu lista de alumnos."); return; }
			await marcarHecho(1, 2);
			irA(2);
		});
	}

	// ══════════════════════════════════════════════════════════════════════════
	// Paso 2: asistencia pasada
	// ══════════════════════════════════════════════════════════════════════════
	var asis = null; // { dias, semanas, semana, marcas, enBase, sinClase }

	async function paso2() {
		var t = turno;
		if (!alumnos.length) await leerAlumnos();
		var dias = H.diasHistoricos(inicio, hoy, ajustesCal);
		var enBase = {};
		if (dias.length && alumnos.length) {
			var filas = await window.Lectura.todas(function () {
				return window.sb.from("asistencias").select("alumno_id, fecha, asistencia_estado")
					.eq("maestro_id", userId).eq("grupo_id", grupo.id)
					.gte("fecha", dias[0]).lte("fecha", dias[dias.length - 1]).order("id");
			});
			filas.forEach(function (f) { enBase[f.alumno_id + "|" + f.fecha] = f.asistencia_estado; });
		}
		if (t !== turno) return;
		var semanas = H.semanas(dias);
		// Se abre en la primera semana que aún no tiene lista capturada
		var primera = 0;
		for (var i = 0; i < semanas.length; i++) {
			var conLista = semanas[i].dias.every(function (d) { return alumnos.some(function (a) { return enBase[a.id + "|" + d]; }); });
			if (!conLista) { primera = i; break; }
		}
		asis = { dias: dias, semanas: semanas, semana: primera, marcas: {}, enBase: enBase, sinClase: {} };
		pintarPaso2();
	}

	function estadoCelda(a, d) {
		var k = a.id + "|" + d;
		return asis.marcas[k] || asis.enBase[k] || "presente";
	}
	var CELDA_ASIS = {
		presente: { letra: "P", clase: "bg-emerald-50 text-emerald-700 border-emerald-100", nombre: "Presente" },
		ausente: { letra: "F", clase: "bg-red-600 text-white border-red-600", nombre: "Falta" },
		justificada: { letra: "J", clase: "bg-blue-600 text-white border-blue-600", nombre: "Justificada" },
	};

	function cuentaAsistencia() {
		return H.filasAsistencia({ alumnos: alumnos, dias: asis.dias, marcas: asis.marcas, enBase: asis.enBase, sinClase: asis.sinClase, maestroId: userId, grupoId: grupo.id });
	}

	function pintarPaso2() {
		var total = asis.dias.length;
		if (!total) {
			el.contenido.innerHTML = "<h2 class='text-lg font-bold text-gray-900'>2. Asistencia pasada</h2>" +
				"<p class='mt-2 text-sm text-gray-600'>No hay días de clase entre el inicio del trimestre y ayer: no hay asistencia atrasada.</p>" + pie(2, { siguiente: "Siguiente: trabajos y exámenes" });
			conectarPie(2, async function () { await marcarHecho(2, 3); irA(3); });
			return;
		}
		var sem = asis.semanas[asis.semana];
		var c = cuentaAsistencia();
		var sinClaseN = Object.keys(asis.sinClase).length;
		var cabeza = "<tr><th scope='col' class='pd-fija text-left text-xs font-semibold text-gray-600 px-2 py-2 min-w-[8.5rem] sm:min-w-[14rem]'>Alumno</th>" +
			sem.dias.map(function (d) {
				var sin = !!asis.sinClase[d];
				return "<th scope='col' class='px-1 py-1 text-center align-bottom'><span class='block text-xs font-semibold text-gray-700'>" + diaSemana(d) + "</span>" +
					"<span class='block text-xs text-gray-500'>" + fechaCorta(d) + "</span>" +
					"<button type='button' data-sin-clase='" + d + "' aria-pressed='" + sin + "' class='mt-1 min-h-[44px] w-full min-w-[44px] rounded-lg px-1 text-[11px] font-semibold leading-tight " +
					(sin ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200") + "'>" + (sin ? "Sin clase" : "Hubo clase") + "</button></th>";
			}).join("") + "</tr>";
		var cuerpo = alumnos.map(function (a) {
			return "<tr><th scope='row' class='pd-fija text-left font-normal px-2 py-1'><span class='flex items-center gap-2'>" +
				"<span class='w-5 shrink-0 text-right text-xs text-gray-400'>" + esc(a.num_lista || "") + "</span>" +
				"<span class='min-w-0 text-xs sm:text-sm text-gray-800 leading-tight line-clamp-2 break-words'>" + esc(a.nombre_completo) + "</span>" +
				(gradosGrupo.length > 1 ? "<span class='ml-auto shrink-0 text-[11px] text-gray-500'>" + a.grado + "°</span>" : "") + "</span></th>" +
				sem.dias.map(function (d) {
					if (asis.sinClase[d]) return "<td class='px-1 py-1 text-center'><span class='inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-300'>—</span></td>";
					if (a.alta && !A.cuentaDesdeAlta(a.alta, d, null)) return "<td class='px-1 py-1 text-center'><span class='inline-flex h-11 w-11 items-center justify-center rounded-lg text-[10px] text-gray-400' title='Aún no estaba en el grupo'>—</span></td>";
					var e = estadoCelda(a, d), v = CELDA_ASIS[e];
					return "<td class='px-1 py-1 text-center'><button type='button' data-asis='" + a.id + "|" + d + "' aria-label='" + esc(a.nombre_completo) + ", " + fechaCorta(d) + ": " + v.nombre + "' " +
						"class='h-11 w-11 rounded-lg border text-sm font-bold " + v.clase + "'>" + v.letra + "</button></td>";
				}).join("") + "</tr>";
		}).join("");
		el.contenido.innerHTML =
			"<h2 class='text-lg font-bold text-gray-900'>2. Asistencia pasada</h2>" +
			"<p class='mt-1 text-sm text-gray-600'>Del " + fechaCorta(asis.dias[0]) + " al " + fechaCorta(asis.dias[total - 1]) + ": <strong>" + total + " días de clase</strong> según el calendario SEP y los ajustes de tu grupo. " +
			"Todos asistieron: <strong>toca solo las faltas</strong> (un toque, Falta; otro, Justificada; otro, Presente). Si un día no hubo clase en tu grupo, toca «Hubo clase» para marcarlo sin clase: al guardar, ese día queda como suspensión en el calendario de tu grupo (se quita desde Calendario).</p>" +
			"<div class='mt-4 flex flex-wrap items-center justify-between gap-2'>" +
			"<div class='flex items-center gap-2'>" +
			"<button type='button' data-semana='-1' class='inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-30' aria-label='Semana anterior'" + (asis.semana === 0 ? " disabled" : "") + ">" + ICONO_IZQ + "</button>" +
			"<p class='text-sm font-semibold text-gray-800' aria-live='polite'>Semana " + (asis.semana + 1) + " de " + asis.semanas.length + " · " + fechaCorta(sem.dias[0]) + " al " + fechaCorta(sem.dias[sem.dias.length - 1]) + "</p>" +
			"<button type='button' data-semana='1' class='inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-30' aria-label='Semana siguiente'" + (asis.semana >= asis.semanas.length - 1 ? " disabled" : "") + ">" + ICONO_DER + "</button>" +
			"</div>" +
			"<p class='text-xs text-gray-600' data-asis-cuenta>Faltas: <strong>" + (c.cuenta.ausente || 0) + "</strong> · Justificadas: <strong>" + (c.cuenta.justificada || 0) + "</strong>" +
			(sinClaseN ? " · Días sin clase: <strong>" + sinClaseN + "</strong>" : "") + "</p></div>" +
			"<div class='mt-3 overflow-x-auto rounded-xl border border-gray-200'><table class='pd-tabla w-full border-separate border-spacing-0'><thead class='bg-gray-50'>" + cabeza + "</thead><tbody>" + cuerpo + "</tbody></table></div>" +
			"<p class='mt-2 text-xs text-gray-500'>P: presente · F: falta · J: justificada. La asistencia es solo de referencia: no pondera en la calificación ni genera avisos.</p>" +
			"<div class='mt-4 flex flex-col sm:flex-row sm:items-center gap-2'>" +
			"<button type='button' data-guardar-asis class='" + BTN_OK + "'>Guardar la asistencia de los " + (total - sinClaseN) + " días</button>" +
			"<p class='text-xs text-gray-500'>Lo que ya tenías capturado de esos días se respeta.</p></div>" +
			pie(2, { saltar: true });
		el.contenido.querySelectorAll("[data-semana]").forEach(function (b) {
			b.addEventListener("click", function () { asis.semana = Math.max(0, Math.min(asis.semanas.length - 1, asis.semana + Number(b.dataset.semana))); pintarPaso2(); });
		});
		el.contenido.querySelector("[data-guardar-asis]").addEventListener("click", guardarAsistencia);
		conectarPie(2);
	}

	// Un toque en una celda (delegado en el contenido: sobrevive a repintar la semana)
	el.contenido.addEventListener("click", function (e) {
		var b = e.target.closest("[data-asis]");
		if (b && asis) {
			var k = b.dataset.asis;
			var partes = k.split("|");
			var a = alumnos.filter(function (x) { return x.id === partes[0]; })[0];
			if (!a) return;
			var nuevo = H.siguienteAsistencia(estadoCelda(a, partes[1]));
			asis.marcas[k] = nuevo;
			var v = CELDA_ASIS[nuevo];
			b.className = "h-11 w-11 rounded-lg border text-sm font-bold " + v.clase;
			b.textContent = v.letra;
			b.setAttribute("aria-label", a.nombre_completo + ", " + fechaCorta(partes[1]) + ": " + v.nombre);
			var c = cuentaAsistencia();
			var cuenta = el.contenido.querySelector("[data-asis-cuenta]");
			if (cuenta) cuenta.innerHTML = "Faltas: <strong>" + (c.cuenta.ausente || 0) + "</strong> · Justificadas: <strong>" + (c.cuenta.justificada || 0) + "</strong>" +
				(Object.keys(asis.sinClase).length ? " · Días sin clase: <strong>" + Object.keys(asis.sinClase).length + "</strong>" : "");
			return;
		}
		var s = e.target.closest("[data-sin-clase]");
		if (s && asis) {
			var d = s.dataset.sinClase;
			// Un día que ya tiene lista capturada no se marca sin clase aquí (se cambia en Asistencia)
			if (!asis.sinClase[d] && alumnos.some(function (x) { return asis.enBase[x.id + "|" + d]; })) {
				mensaje("info", "El " + fechaCorta(d) + " ya tiene lista capturada; si no hubo clase, corrígelo en Asistencia.");
				return;
			}
			if (asis.sinClase[d]) delete asis.sinClase[d]; else asis.sinClase[d] = true;
			pintarPaso2();
		}
	});

	async function guardarAsistencia() {
		var boton = el.contenido.querySelector("[data-guardar-asis]");
		var r = H.filasAsistencia({ alumnos: alumnos, dias: asis.dias, marcas: asis.marcas, enBase: asis.enBase, sinClase: asis.sinClase,
			maestroId: userId, grupoId: grupo.id, capturadoEn: ahora() });
		/*
			"Sin clase" (decisión de Jorge del 2026-09-26): esos días se guardan como suspensión en el
			calendario del grupo (calendario_ajustes), con confirmación, y se pueden quitar desde
			Calendario. Primero el calendario y después la asistencia: si el calendario no se guarda,
			no se guarda nada y lo marcado sigue en pantalla.
		*/
		var sinClase = H.filasSinClase({ sinClase: asis.sinClase, maestroId: userId, grupoId: grupo.id });
		if (sinClase.length && !window.confirm((sinClase.length === 1 ? "Marcaste 1 día sin clase (" + fechaCorta(sinClase[0].fecha) + ")" :
			"Marcaste " + sinClase.length + " días sin clase") + ". Se guardan en el calendario de tu grupo como suspensión: ya no cuentan como días de clase " +
			"en Asistencia ni en «Qué le falta». Puedes quitarlos cuando quieras desde Calendario. ¿Continuar?")) return;
		if (boton) { boton.disabled = true; boton.textContent = "Guardando..."; }
		if (sinClase.length) {
			try {
				var aj = await window.sb.from("calendario_ajustes").upsert(sinClase, { onConflict: "grupo_id,fecha" }).select("id, fecha, tipo, motivo");
				if (aj.error) throw aj.error;
				var puestas = {};
				(aj.data || []).forEach(function (f) { puestas[f.fecha] = f; });
				ajustesCal = (ajustesCal || []).filter(function (x) { return !puestas[x.fecha]; }).concat(aj.data || []);
			} catch (e) {
				console.error("ponte al día: días sin clase", e);
				mensaje("error", "No se pudieron guardar los días sin clase en el calendario de tu grupo: " + textoError(e) + ". No se guardó nada; lo que marcaste sigue en pantalla.");
				if (boton) { boton.disabled = false; boton.textContent = "Guardar la asistencia"; }
				return;
			}
		}
		try {
			var lotes = porLotes(r.filas, 500);
			for (var i = 0; i < lotes.length; i++) {
				var up = await window.sb.from("asistencias").upsert(lotes[i], { onConflict: "grupo_id,alumno_id,fecha" });
				if (up.error) throw up.error;
				lotes[i].forEach(function (f) { asis.enBase[f.alumno_id + "|" + f.fecha] = f.asistencia_estado; });
			}
		} catch (e) {
			console.error("ponte al día: asistencia", e);
			mensaje("error", "No se pudo guardar la asistencia: " + textoError(e) + ". Lo que marcaste sigue en pantalla; revisa tu conexión y vuelve a guardar.");
			if (boton) { boton.disabled = false; boton.textContent = "Guardar la asistencia"; }
			return;
		}
		asis.marcas = {};
		await marcarHecho(2, 3);
		mensaje("ok", "Asistencia guardada: " + r.filas.length + " registros (" + (r.cuenta.ausente || 0) + " faltas y " + (r.cuenta.justificada || 0) + " justificadas)" +
			(sinClase.length ? ". " + (sinClase.length === 1 ? "1 día quedó" : sinClase.length + " días quedaron") + " sin clase en el calendario de tu grupo (se quitan desde Calendario)." : "."));
		irA(3, true);
	}

	// ══════════════════════════════════════════════════════════════════════════
	// Paso 3: trabajos y exámenes pasados
	// ══════════════════════════════════════════════════════════════════════════
	var bloque = null; // { borradores, forma, productos, enBase, celdas, examenes }

	async function leerActividades() {
		// Las actividades del asistente de este grupo y trimestre (contenedor "Actividades del trimestre")
		var proys = await window.Lectura.uno(window.sb.from("proyectos").select("id")
			.eq("maestro_id", userId).eq("grupo_id", grupo.id).eq("tipo", "sueltas").eq("trimestre", trimestre));
		var ids = (proys || []).map(function (p) { return p.id; });
		if (!ids.length) return { productos: [], enBase: {} };
		var sesiones = await window.Lectura.todas(function () {
			return window.sb.from("sesiones").select("id, fecha, proyecto_id").in("proyecto_id", ids).order("id");
		});
		var sesPorId = {};
		sesiones.forEach(function (s) { sesPorId[s.id] = s; });
		var prods = sesiones.length ? await window.Lectura.porLotes(sesiones.map(function (s) { return s.id; }), function (lote) {
			return window.sb.from("productos_sesion").select("id, sesion_id, tipo, nombre, campo, grados, fecha_entrega, created_at, es_historico, desde_ponte_al_dia")
				.in("sesion_id", lote).eq("activo", true).eq("desde_ponte_al_dia", true).order("id");
		}) : [];
		prods.forEach(function (p) {
			var s = sesPorId[p.sesion_id] || {};
			p.fecha = s.fecha; p.proyecto_id = s.proyecto_id; p.sesion = s;
		});
		prods.sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || String(a.created_at).localeCompare(String(b.created_at)); });
		var enBase = {};
		if (prods.length) {
			var cals = await window.Lectura.porLotes(prods.map(function (p) { return p.id; }), function (lote) {
				return window.sb.from("calificaciones").select("id, alumno_id, producto_sesion_id, estado_entrega, nivel, puntaje, fecha")
					.eq("maestro_id", userId).in("producto_sesion_id", lote).order("id");
			});
			cals.forEach(function (c) { enBase[c.alumno_id + "|" + c.producto_sesion_id] = c; });
		}
		return { productos: prods, enBase: enBase };
	}

	async function paso3() {
		var t = turno;
		if (!alumnos.length) await leerAlumnos();
		var r = await leerActividades();
		var exs = await window.Lectura.uno(window.sb.from("examenes_grupo").select("id, titulo, modo, fecha_aplicacion")
			.eq("maestro_id", userId).eq("grupo_id", grupo.id).eq("trimestre", trimestre).order("created_at"));
		if (t !== turno) return;
		var forma = bloque && bloque.forma ? bloque.forma : { tipo: "trabajo", fecha: ayer, campo: "", grados: gradosGrupo.slice() };
		bloque = { borradores: bloque ? bloque.borradores : [], forma: forma, productos: r.productos, enBase: r.enBase, celdas: {}, examenes: exs || [] };
		pintarPaso3();
	}

	function pintarPaso3() {
		var f = bloque.forma;
		var chipsTipo = [["trabajo", "Trabajo en clase"], ["tarea", "Tarea"]].map(function (t) {
			var on = f.tipo === t[0];
			return "<button type='button' data-forma-tipo='" + t[0] + "' aria-pressed='" + on + "' class='min-h-[44px] px-3 rounded-xl text-sm font-semibold " + (on ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200") + "'>" + t[1] + "</button>";
		}).join("");
		var chipsCampo = CAMPOS.map(function (c) {
			var on = f.campo === c;
			return "<button type='button' data-forma-campo='" + c + "' aria-pressed='" + on + "' class='min-h-[44px] px-3 rounded-xl text-sm font-semibold border-2 " +
				(on ? "text-white" : "bg-white text-gray-700 hover:bg-gray-50") + "' style='border-color:" + COLOR_CAMPO[c] + (on ? ";background:" + COLOR_CAMPO[c] : "") + "'>" + esc(CORTO_CAMPO[c]) + "</button>";
		}).join("");
		var chipsGrados = gradosGrupo.length > 1 ? gradosGrupo.map(function (g) {
			var on = f.grados.indexOf(g) !== -1;
			return "<button type='button' data-forma-grado='" + g + "' aria-pressed='" + on + "' class='min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-bold " + (on ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200") + "'>" + g + "°</button>";
		}).join("") : "";
		var pdaTexto = (f.pda || []).length ? (f.pda.length === 1 ? "1 PDA elegido" : f.pda.length + " PDA elegidos") : "Sin PDA (opcional)";
		var forma =
			"<div class='rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-col gap-3'>" +
			"<h3 class='text-sm font-bold text-gray-800'>Agregar actividades</h3>" +
			"<label class='flex flex-col gap-1'><span class='text-xs font-semibold text-gray-600'>Nombre</span>" +
			"<input type='text' id='formaNombre' maxlength='120' autocomplete='off' placeholder='Por ejemplo: Mapa de mi comunidad' class='min-h-[44px] rounded-xl border border-gray-300 px-3 text-base'></label>" +
			"<div class='grid grid-cols-1 md:grid-cols-2 gap-3'>" +
			"<div class='flex flex-col gap-1'><span class='text-xs font-semibold text-gray-600'>Tipo</span><div class='flex flex-wrap gap-2'>" + chipsTipo + "</div></div>" +
			"<label class='flex flex-col gap-1'><span class='text-xs font-semibold text-gray-600'>" + (f.tipo === "tarea" ? "Día en que se dejó" : "Día") + "</span>" +
			"<input type='date' id='formaFecha' min='" + esc(inicio) + "' max='" + esc(ayer) + "' value='" + esc(f.fecha || "") + "' class='min-h-[44px] rounded-xl border border-gray-300 px-3 text-base bg-white'></label>" +
			"</div>" +
			"<div class='flex flex-col gap-1'><span class='text-xs font-semibold text-gray-600'>Campo formativo</span><div class='flex flex-wrap gap-2'>" + chipsCampo + "</div></div>" +
			(chipsGrados ? "<div class='flex flex-col gap-1'><span class='text-xs font-semibold text-gray-600'>¿Para qué grados?</span><div class='flex flex-wrap gap-2'>" + chipsGrados + "</div></div>" : "") +
			"<div class='flex flex-wrap items-center gap-2'><button type='button' data-forma-pda class='" + BTN_SEC + "'>PDA</button><span class='text-xs text-gray-600' data-forma-pda-texto>" + esc(pdaTexto) + "</span></div>" +
			"<p class='hidden text-sm font-medium text-red-700' data-forma-error role='alert'></p>" +
			"<div><button type='button' data-forma-agregar class='" + BTN_SEC + "'>Agregar a la lista</button> <span class='text-xs text-gray-500'>El tipo, el día, el campo y los grados se quedan para la siguiente.</span></div>" +
			"</div>";
		var borradores = bloque.borradores.length
			? "<div class='mt-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3'><p class='text-sm font-semibold text-gray-800 mb-2'>Por guardar (" + bloque.borradores.length + ")</p>" +
				"<ul class='flex flex-col gap-1'>" + bloque.borradores.map(function (b, i) {
					return "<li class='flex items-center gap-2 text-sm'><span class='min-w-0 flex-1 break-words'><strong>" + esc(b.nombre) + "</strong> · " + fechaCorta(b.fecha) + " · " + chipCampo(b.campo) +
						(gradosGrupo.length > 1 ? " · " + textoGrados(b.grados) : "") + " · " + (b.tipo === "tarea" ? "tarea" : "trabajo") + ((b.pda || []).length ? " · " + b.pda.length + " PDA" : "") + "</span>" +
						"<button type='button' data-quitar-borrador='" + i + "' class='min-h-[44px] min-w-[44px] rounded-xl text-sm text-gray-500 hover:bg-red-50 hover:text-red-700' aria-label='Quitar " + esc(b.nombre) + "'>Quitar</button></li>";
				}).join("") + "</ul>" +
				"<button type='button' data-guardar-actividades class='mt-2 " + BTN_OK + "'>Guardar " + bloque.borradores.length + (bloque.borradores.length === 1 ? " actividad" : " actividades") + "</button></div>"
			: "";
		el.contenido.innerHTML =
			"<h2 class='text-lg font-bold text-gray-900'>3. Trabajos y exámenes pasados</h2>" +
			"<p class='mt-1 text-sm text-gray-600'>Agrega de una vez las actividades que ya calificaste (en papel o en tu libreta) y después pon su semáforo a todo el grupo. " +
			"Quedan en Proyectos → «Actividades del trimestre» y cuentan para la boleta.</p>" +
			"<div class='mt-4'>" + forma + borradores + "</div>" +
			"<div class='mt-6' id='ponteCuadricula'>" + cuadriculaHtml() + "</div>" +
			examenesHtml() +
			pie(3, { saltar: true, siguiente: "Siguiente: revisar la boleta" });
		conectarPaso3();
	}

	function examenesHtml() {
		var lista = bloque.examenes.length
			? "<ul class='mt-2 text-sm text-gray-700 list-disc pl-5'>" + bloque.examenes.map(function (x) {
				return "<li>" + esc(x.titulo) + (x.fecha_aplicacion ? " · " + fechaCorta(x.fecha_aplicacion) : "") + " · " + (x.modo === "resultados" ? "solo resultados" : "creado en Mi Salón") + "</li>";
			}).join("") + "</ul>"
			: "<p class='mt-1 text-sm text-gray-600'>Todavía no hay exámenes en este trimestre.</p>";
		return "<div class='mt-6 rounded-xl border border-gray-200 p-3 sm:p-4'>" +
			"<h3 class='text-sm font-bold text-gray-800'>Exámenes</h3>" +
			"<p class='mt-1 text-sm text-gray-600'>Si ya aplicaste un examen, sube solo sus resultados: cuántas preguntas tenía de cada campo y cuántos aciertos sacó cada alumno.</p>" +
			lista +
			"<a href='examen.html?nuevo=resultados&amp;desde=ponte' class='mt-3 " + BTN_SEC + "'>Subir resultados de un examen</a></div>";
	}

	function forma() { return bloque.forma; }
	function leerForma() {
		var f = forma();
		var n = el.contenido.querySelector("#formaNombre");
		var d = el.contenido.querySelector("#formaFecha");
		if (n) f.nombre = n.value;
		if (d) f.fecha = d.value;
		return f;
	}
	function errorForma(t, foco) {
		var p = el.contenido.querySelector("[data-forma-error]");
		if (p) { p.textContent = t || ""; p.classList.toggle("hidden", !t); }
		if (foco) { var x = el.contenido.querySelector(foco); if (x) x.focus(); }
	}

	function conectarPaso3() {
		var c = el.contenido;
		c.querySelectorAll("[data-forma-tipo]").forEach(function (b) { b.addEventListener("click", function () { leerForma().tipo = b.dataset.formaTipo; pintarPaso3(); }); });
		c.querySelectorAll("[data-forma-campo]").forEach(function (b) { b.addEventListener("click", function () { var f = leerForma(); if (f.campo !== b.dataset.formaCampo) f.pda = []; f.campo = b.dataset.formaCampo; pintarPaso3(); }); });
		c.querySelectorAll("[data-forma-grado]").forEach(function (b) {
			b.addEventListener("click", function () {
				var f = leerForma(), g = Number(b.dataset.formaGrado), i = f.grados.indexOf(g);
				if (i === -1) f.grados.push(g); else f.grados.splice(i, 1);
				f.grados.sort();
				f.pda = (f.pda || []).filter(function (p) { return f.grados.indexOf(Number(p.grado)) !== -1; });
				pintarPaso3();
			});
		});
		var pdaBtn = c.querySelector("[data-forma-pda]");
		if (pdaBtn) pdaBtn.addEventListener("click", function () { var f = leerForma(); if (!f.campo) { errorForma("Primero elige el campo formativo."); return; } abrirPda(f); });
		var agregar = c.querySelector("[data-forma-agregar]");
		if (agregar) agregar.addEventListener("click", function () {
			var f = leerForma();
			var v = H.validarActividad({ nombre: f.nombre, tipo: f.tipo, fecha: f.fecha, campo: f.campo, grados: gradosGrupo.length > 1 ? f.grados : gradosGrupo },
				{ desde: inicio, hoy: hoy, gradosGrupo: gradosGrupo });
			if (!v.ok) { errorForma(v.error, v.foco === "nombre" ? "#formaNombre" : v.foco === "fecha" ? "#formaFecha" : null); return; }
			bloque.borradores.push({ nombre: v.nombre, tipo: f.tipo, fecha: f.fecha, campo: f.campo, grados: v.grados, pda: (f.pda || []).slice() });
			f.nombre = "";
			f.pda = [];
			pintarPaso3();
			var n = el.contenido.querySelector("#formaNombre");
			if (n) n.focus();
		});
		var nombre = c.querySelector("#formaNombre");
		if (nombre) {
			nombre.value = forma().nombre || "";
			nombre.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (agregar) agregar.click(); } });
		}
		c.querySelectorAll("[data-quitar-borrador]").forEach(function (b) { b.addEventListener("click", function () { leerForma(); bloque.borradores.splice(Number(b.dataset.quitarBorrador), 1); pintarPaso3(); }); });
		var guardar = c.querySelector("[data-guardar-actividades]");
		if (guardar) guardar.addEventListener("click", guardarActividades);
		conectarCuadricula();
		conectarPie(3, async function () {
			if (contarCambios()) {
				mensaje("error", "Tienes calificaciones sin guardar en la cuadrícula. Guárdalas antes de seguir.");
				return;
			}
			await marcarHecho(3, 4);
			irA(4);
		});
	}

	async function guardarActividades() {
		leerForma();
		var boton = el.contenido.querySelector("[data-guardar-actividades]");
		if (boton) { boton.disabled = true; boton.textContent = "Guardando..."; }
		var res = await window.sb.rpc("agregar_actividades_historicas", {
			p_grupo: grupo.id, p_items: H.itemsParaGuardar(bloque.borradores), p_capturado_en: ahora(),
		});
		if (res.error) {
			console.error("ponte al día: actividades", res.error);
			mensaje("error", "No se guardaron las actividades: " + textoError(res.error) + ". Siguen en tu lista; revisa tu conexión y vuelve a guardar.");
			if (boton) { boton.disabled = false; boton.textContent = "Guardar actividades"; }
			return;
		}
		var n = bloque.borradores.length;
		bloque.borradores = [];
		await marcarHecho(3, 3);
		await paso3();
		mensaje("ok", n + (n === 1 ? " actividad guardada" : " actividades guardadas") + ". Ahora pon su semáforo: «Todos Logrado» llena la columna y solo tocas las excepciones.");
		var cuad = document.getElementById("ponteCuadricula");
		if (cuad && cuad.scrollIntoView) cuad.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	// ── Cuadrícula alumno × actividad ─────────────────────────────────────────
	var CELDA_SEM = {
		logrado: { letra: "L", clase: "bg-emerald-600 text-white border-emerald-600", nombre: "Logrado" },
		en_proceso: { letra: "P", clase: "bg-amber-400 text-gray-900 border-amber-400", nombre: "En proceso" },
		requiere_apoyo: { letra: "A", clase: "bg-rose-600 text-white border-rose-600", nombre: "Requiere apoyo" },
		no_entregado: { letra: "N", clase: "bg-gray-700 text-white border-gray-700", nombre: "No entregó" },
		otro: { letra: "·", clase: "bg-gray-200 text-gray-700 border-gray-200", nombre: "Otro estado (justificado o sin nivel)" },
	};
	var CELDA_VACIA = { letra: "", clase: "bg-white text-gray-400 border-gray-300 border-dashed", nombre: "Sin capturar" };

	function recibe(a, p) {
		var cal = bloque.enBase[a.id + "|" + p.id];
		return A.recibeProducto(a, p, {}, p.fecha, cal, a.alta);
	}
	function valorCelda(a, p) {
		var k = a.id + "|" + p.id;
		if (Object.prototype.hasOwnProperty.call(bloque.celdas, k)) return bloque.celdas[k];
		return H.semaforoDeFila(bloque.enBase[k]);
	}
	function estiloCelda(v) { return v ? CELDA_SEM[v] : CELDA_VACIA; }
	function contarCambios() {
		if (!bloque) return 0;
		var r = H.filasCalificaciones({ productos: bloque.productos, alumnos: alumnos, celdas: bloque.celdas, enBase: bloque.enBase });
		return r.insertar.length + r.actualizar.length + r.borrar.length;
	}

	function cuadriculaHtml() {
		var ps = bloque.productos;
		if (!ps.length) return "<p class='text-sm text-gray-500'>Cuando guardes actividades, aquí aparece la cuadrícula para calificarlas.</p>";
		var cabeza = "<tr><th scope='col' class='pd-fija text-left text-xs font-semibold text-gray-600 px-2 py-2 min-w-[8.5rem] sm:min-w-[14rem]'>Alumno</th>" +
			ps.map(function (p) {
				return "<th scope='col' class='px-1 py-1 align-bottom min-w-[4.5rem] max-w-[7rem]'>" +
					"<span class='block h-1.5 rounded-full mb-1' style='background:" + COLOR_CAMPO[p.campo] + "'></span>" +
					"<span class='block text-[11px] font-semibold text-gray-800 leading-tight line-clamp-2 break-words' title='" + esc(p.nombre) + "'>" + esc(p.nombre) + "</span>" +
					"<span class='block text-[10px] text-gray-500'>" + fechaCorta(p.fecha) + (p.tipo === "tarea" ? " · tarea" : "") + (gradosGrupo.length > 1 ? " · " + esc(textoGrados((p.grados || []).map(Number))) : "") + "</span>" +
					"<button type='button' data-todos-logrado='" + p.id + "' class='mt-1 w-full min-h-[44px] rounded-lg bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 leading-tight'>Todos Logrado</button></th>";
			}).join("") + "</tr>";
		var cuerpo = alumnos.map(function (a) {
			return "<tr><th scope='row' class='pd-fija text-left font-normal px-2 py-1'><span class='flex items-center gap-2'>" +
				"<span class='w-5 shrink-0 text-right text-xs text-gray-400'>" + esc(a.num_lista || "") + "</span>" +
				"<span class='min-w-0 text-xs sm:text-sm text-gray-800 leading-tight line-clamp-2 break-words'>" + esc(a.nombre_completo) + "</span>" +
				(gradosGrupo.length > 1 ? "<span class='ml-auto shrink-0 text-[11px] text-gray-500'>" + a.grado + "°</span>" : "") + "</span></th>" +
				ps.map(function (p) {
					if (!recibe(a, p)) return "<td class='px-1 py-1 text-center'><span class='inline-flex h-11 w-11 items-center justify-center text-gray-300' title='No es para su grado'>—</span></td>";
					var v = valorCelda(a, p), s = estiloCelda(v);
					return "<td class='px-1 py-1 text-center'><button type='button' data-sem='" + a.id + "|" + p.id + "' aria-label='" + esc(a.nombre_completo) + ", " + esc(p.nombre) + ": " + s.nombre + "' " +
						"class='h-11 w-11 rounded-lg border-2 text-sm font-bold " + s.clase + "'>" + s.letra + "</button></td>";
				}).join("") + "</tr>";
		}).join("");
		var n = contarCambios();
		return "<div class='flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2'>" +
			"<div><h3 class='text-sm font-bold text-gray-800'>Calificar (" + ps.length + (ps.length === 1 ? " actividad" : " actividades") + ")</h3>" +
			"<p class='text-xs text-gray-600'>Cada toque cambia: Logrado (L), En proceso (P), Requiere apoyo (A), No entregó (N) y sin capturar. Lo que dejes sin capturar no cuenta ni a favor ni en contra.</p></div>" +
			"<button type='button' data-guardar-cal class='" + BTN_OK + "'" + (n ? "" : " disabled") + ">" + (n ? "Guardar " + n + (n === 1 ? " cambio" : " cambios") : "Sin cambios por guardar") + "</button></div>" +
			"<div class='mt-2 overflow-x-auto rounded-xl border border-gray-200'><table class='pd-tabla w-full border-separate border-spacing-0'><thead class='bg-gray-50'>" + cabeza + "</thead><tbody>" + cuerpo + "</tbody></table></div>";
	}

	function refrescarBotonCal() {
		var b = el.contenido.querySelector("[data-guardar-cal]");
		if (!b) return;
		var n = contarCambios();
		b.disabled = !n;
		b.textContent = n ? "Guardar " + n + (n === 1 ? " cambio" : " cambios") : "Sin cambios por guardar";
	}

	function conectarCuadricula() {
		var cont = document.getElementById("ponteCuadricula");
		if (!cont) return;
		cont.addEventListener("click", function (e) {
			var b = e.target.closest("[data-sem]");
			if (b) {
				var partes = b.dataset.sem.split("|");
				var a = alumnos.filter(function (x) { return x.id === partes[0]; })[0];
				var p = bloque.productos.filter(function (x) { return x.id === partes[1]; })[0];
				if (!a || !p) return;
				var actual = valorCelda(a, p);
				var nuevo = actual === "otro" ? "logrado" : H.siguienteSemaforo(actual);
				bloque.celdas[b.dataset.sem] = nuevo;
				var s = estiloCelda(nuevo);
				b.className = "h-11 w-11 rounded-lg border-2 text-sm font-bold " + s.clase;
				b.textContent = s.letra;
				b.setAttribute("aria-label", a.nombre_completo + ", " + p.nombre + ": " + s.nombre);
				refrescarBotonCal();
				return;
			}
			var t = e.target.closest("[data-todos-logrado]");
			if (t) {
				var prod = bloque.productos.filter(function (x) { return x.id === t.dataset.todosLogrado; })[0];
				if (!prod) return;
				alumnos.forEach(function (al) {
					if (!recibe(al, prod) || valorCelda(al, prod)) return; // solo las vacías
					bloque.celdas[al.id + "|" + prod.id] = "logrado";
				});
				cont.innerHTML = cuadriculaHtml();
				return;
			}
			if (e.target.closest("[data-guardar-cal]")) guardarCalificaciones();
		});
	}

	async function guardarCalificaciones() {
		var boton = el.contenido.querySelector("[data-guardar-cal]");
		var r = H.filasCalificaciones({
			productos: bloque.productos, alumnos: alumnos, celdas: bloque.celdas, enBase: bloque.enBase,
			maestroId: userId, grupoId: grupo.id, capturadoEn: ahora(),
			campoLargo: window.CamposFormativos ? window.CamposFormativos.largo : null,
		});
		if (boton) { boton.disabled = true; boton.textContent = "Guardando..."; }
		try {
			var lotes = porLotes(r.insertar, 300);
			for (var i = 0; i < lotes.length; i++) {
				var ins = await window.sb.from("calificaciones").insert(lotes[i]);
				if (ins.error) throw ins.error;
			}
			for (var j = 0; j < r.actualizar.length; j++) {
				var up = await window.sb.from("calificaciones").update(r.actualizar[j].cambios).eq("id", r.actualizar[j].id).eq("maestro_id", userId);
				if (up.error) throw up.error;
			}
			if (r.borrar.length) {
				var del = await window.sb.from("calificaciones").delete().in("id", r.borrar).eq("maestro_id", userId);
				if (del.error) throw del.error;
			}
		} catch (e) {
			console.error("ponte al día: calificaciones", e);
			// Se vuelve a leer lo que sí quedó: la pantalla nunca muestra como guardado algo que no lo está
			var pendientes = bloque.celdas;
			var leido = await leerActividades();
			bloque.productos = leido.productos;
			bloque.enBase = leido.enBase;
			bloque.celdas = pendientes;
			document.getElementById("ponteCuadricula").innerHTML = cuadriculaHtml();
			mensaje("error", "No se guardaron todas las calificaciones: " + textoError(e) + ". Lo que falta sigue marcado; vuelve a guardar.");
			return;
		}
		var total = r.insertar.length + r.actualizar.length + r.borrar.length;
		var leido2 = await leerActividades();
		bloque.productos = leido2.productos;
		bloque.enBase = leido2.enBase;
		bloque.celdas = {};
		await marcarHecho(3, 3);
		document.getElementById("ponteCuadricula").innerHTML = cuadriculaHtml();
		mensaje("ok", "Calificaciones guardadas (" + total + (total === 1 ? " cambio" : " cambios") + ").");
	}

	// ── PDA de una actividad (opcional): el catálogo SEP por contenido ────────
	var contenidosCache = null;
	async function abrirPda(f) {
		var d = el.dlgPda;
		var grados = gradosGrupo.length > 1 ? f.grados.slice() : gradosGrupo.slice();
		var elegidos = {};
		(f.pda || []).forEach(function (p) { elegidos[p.pda_id] = p; });
		var contenido = null, pdas = [];
		d.innerHTML = "<div class='flex flex-col max-h-[calc(100dvh-24px)]'>" +
			"<div class='px-5 pt-5 pb-3 border-b border-gray-100'><h2 id='dlgPdaTitulo' class='text-lg font-bold text-gray-900'>PDA que evalúa (opcional)</h2>" +
			"<p class='text-sm text-gray-600 mt-1'>" + esc(NOMBRE_CAMPO[f.campo]) + " · " + esc(textoGrados(grados)) + ". Busca el contenido del catálogo SEP y marca sus PDA.</p></div>" +
			"<div class='px-5 py-4 flex flex-col gap-3 overflow-y-auto min-h-0 flex-1'>" +
			"<label class='flex flex-col gap-1 text-sm font-medium text-gray-700'>Buscar un contenido<input type='search' data-pda-busca autocomplete='off' placeholder='Escribe una palabra del contenido' class='min-h-[44px] rounded-xl border border-gray-300 px-3 text-base font-normal'></label>" +
			"<div data-pda-resultados class='flex flex-col gap-1' aria-live='polite'></div><div data-pda-contenido class='flex flex-col gap-2'></div></div>" +
			"<div class='px-5 py-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2'>" +
			"<button type='button' data-pda-cerrar class='" + BTN_SEC + "'>Cancelar</button><button type='button' data-pda-usar class='" + BTN_PRI + "'>Usar estos PDA</button></div></div>";
		var busca = d.querySelector("[data-pda-busca]"), res = d.querySelector("[data-pda-resultados]"), cont = d.querySelector("[data-pda-contenido]");
		d.querySelector("[data-pda-cerrar]").addEventListener("click", function () { d.close(); });
		d.querySelector("[data-pda-usar]").addEventListener("click", function () {
			f.pda = Object.keys(elegidos).map(function (k) { return elegidos[k]; });
			d.close();
			pintarPaso3();
		});
		function pintarRes() {
			var P = window.ProductosHoy;
			if (!contenidosCache) { res.innerHTML = "<p class='text-xs text-gray-500'>Cargando el catálogo...</p>"; return; }
			var t = busca.value;
			if (!String(t || "").trim()) { res.innerHTML = ""; return; }
			var todos = P.buscarContenidos(contenidosCache, t, NOMBRE_CAMPO[f.campo], P.fasesDeGrados(grados));
			res.innerHTML = todos.length ? todos.slice(0, 8).map(function (c) {
				return "<button type='button' data-pda-cont='" + c.id + "' class='w-full min-h-[44px] text-left rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:border-blue-400 hover:bg-blue-50'>" + esc(c.contenido) + " <span class='text-xs text-gray-500'>· " + esc(c.fase) + "</span></button>";
			}).join("") + (todos.length > 8 ? "<p class='text-xs text-gray-500'>Y " + (todos.length - 8) + " más: escribe otra palabra para acotar.</p>" : "")
				: "<p class='text-xs text-gray-500'>Ningún contenido tiene esas palabras.</p>";
		}
		function pintarCont() {
			if (!contenido) { cont.innerHTML = ""; return; }
			cont.innerHTML = "<p class='text-sm font-semibold text-gray-800'>" + esc(contenido.contenido) + "</p>" + (pdas.length ? pdas.map(function (p) {
				return "<label class='flex items-start gap-2 min-h-[44px] rounded-xl border border-gray-200 px-3 py-2'><input type='checkbox' data-pda-id='" + p.id + "' class='h-5 w-5 mt-0.5 shrink-0'" + (elegidos[p.id] ? " checked" : "") + ">" +
					"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(p.grado) + "°</span> · " + esc(p.pda) + "</span></label>";
			}).join("") : "<p class='text-xs text-gray-500'>Este contenido no tiene PDA para esos grados.</p>");
		}
		busca.addEventListener("input", pintarRes);
		busca.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
		res.addEventListener("click", async function (e) {
			var b = e.target.closest("[data-pda-cont]");
			if (!b) return;
			contenido = contenidosCache.filter(function (c) { return c.id === b.dataset.pdaCont; })[0];
			res.innerHTML = "";
			cont.innerHTML = "<p class='text-xs text-gray-500'>Cargando sus PDA...</p>";
			var r = await window.sb.from("catalogo_pda").select("id, grado, pda, orden").eq("contenido_id", contenido.id).in("grado", grados).order("orden");
			if (r.error) { cont.innerHTML = "<p class='text-xs text-red-700'>No se pudieron cargar sus PDA: " + esc(textoError(r.error)) + ". Puedes guardar la actividad sin PDA.</p>"; return; }
			pdas = r.data || [];
			window.ProductosHoy.pdaMarcadosPorOmision(pdas, grados).forEach(function (id) {
				var p = pdas.filter(function (x) { return x.id === id; })[0];
				if (p) elegidos[p.id] = { pda_id: p.id, grado: Number(p.grado), texto: p.pda };
			});
			pintarCont();
		});
		cont.addEventListener("change", function (e) {
			var c = e.target.closest("[data-pda-id]");
			if (!c) return;
			var p = pdas.filter(function (x) { return x.id === c.dataset.pdaId; })[0];
			if (!p) return;
			if (c.checked) elegidos[p.id] = { pda_id: p.id, grado: Number(p.grado), texto: p.pda };
			else delete elegidos[p.id];
		});
		d.showModal();
		busca.focus();
		if (!contenidosCache) {
			var r2 = await window.sb.from("catalogo_contenidos").select("id, fase, campo_formativo, contenido, orden")
				.in("fase", ["Fase 3", "Fase 4", "Fase 5"]).order("orden").range(0, 999);
			if (r2.error) { res.innerHTML = "<p class='text-xs text-red-700'>No se pudo cargar el catálogo: " + esc(textoError(r2.error)) + ". Puedes guardar la actividad sin PDA.</p>"; return; }
			contenidosCache = r2.data || [];
			pintarRes();
		}
	}

	// ══════════════════════════════════════════════════════════════════════════
	// Paso 4: revisar la boleta (y calificación directa)
	// ══════════════════════════════════════════════════════════════════════════
	var boletaVista = null; // { motor: {alumnoId: porCampo}, boletas, directa: bool }

	async function paso4() {
		var t = turno;
		if (!alumnos.length) await leerAlumnos();
		var motor = await M.cargarYCalcularGrupo(window.sb, {
			maestroId: userId, grupoId: grupo.id, trimestre: trimestre, campos: CAMPOS,
			alumnos: alumnos.map(function (a) { return { id: a.id, grado: a.grado, created_at: a.created_at }; }),
		});
		var boletas = await RD.boletasCiclo(window.sb, { maestroId: userId, ciclo: grupo.ciclo_escolar || "", alumnos: alumnos }, alumnos.map(function (a) { return a.id; }));
		if (t !== turno) return;
		boletaVista = { motor: motor, boletas: boletas, directa: boletaVista ? boletaVista.directa : false };
		pintarPaso4();
	}

	function filaBoleta(a, c) { return ((boletaVista.boletas[a.id] || {})[trimestre] || {})[c] || null; }
	function pcDe(a, c) { var m = boletaVista.motor.porAlumno[a.id]; return m && m.porCampo ? m.porCampo[c] : null; }

	function celdaBoleta(a, c) {
		var fila = filaBoleta(a, c), pc = pcDe(a, c) || {};
		var of = RD.calificacionOficial(fila, a.grado);
		var cerrada = !!(fila && fila.cerrada);
		var directa = RD.esDirecta(pc);
		var prop = pc.calificacionPropuesta;
		var numero, nota;
		/*
			Calificación directa = YA confirmada (decisión de Jorge del 2026-09-26): al guardarla, la base
			la pone como la confirmada de la boleta en ese campo (trigger de mi_salon_b20). Se cambia o
			se borra aquí mismo mientras la boleta no esté cerrada.
		*/
		if (of.confirmada && directa) { numero = of.valor; nota = cerrada ? "boleta cerrada" : "capturada directamente · confirmada"; }
		else if (of.confirmada) { numero = of.valor; nota = cerrada ? "boleta cerrada" : "confirmada"; }
		else if (directa) { numero = prop; nota = "capturada directamente"; }
		else if (prop !== null && prop !== undefined) { numero = prop; nota = "propuesta · " + (Math.floor(Number(pc.porcentaje) * 10 + 1e-9) / 10).toFixed(1) + " %"; }
		else { numero = null; nota = "sin evidencias"; }
		// Una confirmada en Reportes (sin directa) no se pisa desde aquí: se cambia en Reportes
		var editable = boletaVista.directa && !cerrada && (!of.confirmada || directa);
		var control = "";
		if (editable) {
			control = "<select data-directa='" + a.id + "|" + c + "' aria-label='Calificación directa de " + esc(a.nombre_completo) + " en " + esc(NOMBRE_CAMPO[c]) + "' class='mt-1 min-h-[44px] w-full rounded-lg border " + (directa ? "border-violet-400 bg-violet-50" : "border-gray-300 bg-white") + " px-1 text-sm'>" +
				"<option value=''" + (directa ? "" : " selected") + ">Automática</option>" +
				H.escalaDirecta(a.grado).map(function (n) { return "<option value='" + n + "'" + (directa && Number(prop) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select>";
		}
		return "<td class='px-1 sm:px-2 py-1.5 text-center align-top' data-celda='" + a.id + "|" + c + "'>" +
			"<span class='block text-lg font-bold " + (numero === null ? "text-gray-300" : of.confirmada ? "text-gray-900" : directa ? "text-violet-800" : "text-amber-700") + "'>" + (numero === null ? "—" : esc(numero)) + "</span>" +
			"<span class='block text-[10px] sm:text-[11px] leading-tight " + (directa ? "text-violet-700 font-semibold" : "text-gray-500") + "'>" + esc(nota) + "</span>" + control + "</td>";
	}

	function filaAlumno4(a) {
		return "<tr data-fila-alumno='" + a.id + "'><th scope='row' class='pd-fija text-left font-normal px-2 py-1.5'>" +
			"<span class='block text-xs sm:text-sm text-gray-800 leading-tight break-words'>" + esc(a.nombre_completo) + "</span>" +
			"<span class='block text-[11px] text-gray-500'>" + a.grado + "° · escala " + esc(H.escalaDirecta(a.grado)[0] || "") + " a 10</span></th>" +
			CAMPOS.map(function (c) { return celdaBoleta(a, c); }).join("") +
			"<td class='px-1 py-1.5 text-center align-top'><button type='button' data-calculo='" + a.id + "' class='min-h-[44px] px-2 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50'>Cómo se calculó</button></td></tr>";
	}

	function pintarPaso4() {
		var cabeza = "<tr><th scope='col' class='pd-fija text-left text-xs font-semibold text-gray-600 px-2 py-2 min-w-[8.5rem] sm:min-w-[14rem]'>Alumno</th>" +
			CAMPOS.map(function (c) {
				return "<th scope='col' class='px-1 sm:px-2 py-2 text-xs font-semibold text-gray-700 min-w-[4.75rem]'><span class='block h-1.5 rounded-full mb-1' style='background:" + COLOR_CAMPO[c] + "'></span>" + esc(CORTO_CAMPO[c]) + "</th>";
			}).join("") + "<th class='relative px-1 py-2'><span class='sr-only'>Detalle</span></th></tr>";
		var cuerpo = alumnos.map(filaAlumno4).join("");
		el.contenido.innerHTML =
			"<h2 class='text-lg font-bold text-gray-900'>4. Revisa la boleta</h2>" +
			"<p class='mt-1 text-sm text-gray-600'>La calificación que la boleta propone por campo formativo con lo que capturaste (trimestre " + trimestre + "). " +
			"La calculada con las actividades es una propuesta: la confirmas alumno por alumno en Reportes → Boleta (es tu juicio docente).</p>" +
			"<div class='mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>" +
			"<p class='text-sm text-violet-950'><strong>¿Ya tienes tus calificaciones del trimestre en papel o en Excel?</strong> Captúralas directamente: cada una queda ya confirmada en la boleta de ese campo, sin volver a confirmarla. Puedes cambiarla o borrarla (vuelve al cálculo automático) mientras la boleta no esté cerrada.</p>" +
			"<button type='button' data-modo-directa aria-pressed='" + boletaVista.directa + "' class='shrink-0 " + (boletaVista.directa ? BTN_PRI : BTN_SEC) + "'>" + (boletaVista.directa ? "Listo, ocultar la captura" : "Capturar calificación directa") + "</button></div>" +
			"<div class='mt-3 overflow-x-auto rounded-xl border border-gray-200'><table class='pd-tabla w-full border-separate border-spacing-0'><thead class='bg-gray-50'>" + cabeza + "</thead><tbody>" + cuerpo + "</tbody></table></div>" +
			"<p class='mt-2 text-xs text-gray-500'>En ámbar, la propuesta con las actividades (y su porcentaje de logro); en violeta, la capturada directamente (ya confirmada); en negro, la que confirmaste en Reportes. La conversión del porcentaje a calificación es la de la SEP (90 o más, 10; 80 a 89, 9; y así), con el mínimo de cada grado: 1° de 6 a 10; 2° a 6° de 5 a 10.</p>" +
			"<div class='mt-6 pt-4 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2'>" +
			"<button type='button' data-anterior class='" + BTN_SEC + "'>" + ICONO_IZQ + "Paso anterior</button>" +
			"<div class='flex flex-col sm:flex-row gap-2'><a href='reportes.html' class='" + BTN_SEC + "'>Ir a Reportes</a>" +
			"<button type='button' data-terminar class='" + BTN_OK + "'>Terminar Ponte al día</button></div></div>";
		conectarPie(4);
		el.contenido.querySelector("[data-modo-directa]").addEventListener("click", function () { boletaVista.directa = !boletaVista.directa; pintarPaso4(); });
		el.contenido.querySelector("[data-terminar]").addEventListener("click", terminar);
	}

	// Calificación directa: se guarda al elegirla y el alumno se vuelve a calcular
	el.contenido.addEventListener("change", async function (e) {
		var sel = e.target.closest("select[data-directa]");
		if (!sel || !boletaVista) return;
		var partes = sel.dataset.directa.split("|");
		var a = alumnos.filter(function (x) { return x.id === partes[0]; })[0];
		var campo = partes[1];
		if (!a) return;
		sel.disabled = true;
		var res;
		if (sel.value === "") {
			res = await window.sb.from("calificacion_directa").delete()
				.eq("maestro_id", userId).eq("alumno_id", a.id).eq("ciclo", grupo.ciclo_escolar || "").eq("trimestre", trimestre).eq("campo", campo);
		} else {
			var v = H.validarDirecta(sel.value, a.grado);
			if (!v.ok) { mensaje("error", v.error); sel.disabled = false; return; }
			res = await window.sb.from("calificacion_directa").upsert({
				maestro_id: userId, grupo_id: grupo.id, alumno_id: a.id, ciclo: grupo.ciclo_escolar || "", trimestre: trimestre,
				campo: campo, calificacion: v.valor, capturado_en: ahora(),
			}, { onConflict: "maestro_id,alumno_id,ciclo,trimestre,campo" });
		}
		if (res.error) {
			console.error("ponte al día: calificación directa", res.error);
			mensaje("error", "No se guardó la calificación de " + a.nombre_completo + " en " + NOMBRE_CAMPO[campo] + ": " + textoError(res.error) + ".");
			sel.disabled = false;
			return;
		}
		try {
			var r = await M.cargarYCalcular(window.sb, { maestroId: userId, grupoId: grupo.id, alumnoId: a.id, grado: a.grado, trimestre: trimestre, campos: CAMPOS });
			boletaVista.motor.porAlumno[a.id] = Object.assign({}, boletaVista.motor.porAlumno[a.id] || {}, { porCampo: r.porCampo });
			// La boleta del alumno también cambió (la directa queda como la confirmada, o se quitó)
			var bol = await RD.boletasCiclo(window.sb, { maestroId: userId, ciclo: grupo.ciclo_escolar || "", alumnos: [a] }, [a.id]);
			boletaVista.boletas[a.id] = bol[a.id];
		} catch (err) {
			console.error("ponte al día: recalcular", err);
			mensaje("error", "Se guardó, pero no se pudo volver a calcular a " + a.nombre_completo + ": " + textoError(err) + ". Vuelve a abrir este paso.");
		}
		var tr = el.contenido.querySelector("tr[data-fila-alumno='" + a.id + "']");
		if (tr) {
			tr.outerHTML = filaAlumno4(a);
			var nuevo = el.contenido.querySelector("select[data-directa='" + a.id + "|" + campo + "']");
			if (nuevo) nuevo.focus();
		}
		if (!hecho(4)) await guardarProgreso({ paso: 4 });
	});

	el.contenido.addEventListener("click", function (e) {
		var b = e.target.closest("[data-calculo]");
		if (b && boletaVista) abrirCalculo(b.dataset.calculo);
	});

	function abrirCalculo(alumnoId) {
		var a = alumnos.filter(function (x) { return x.id === alumnoId; })[0];
		if (!a) return;
		var d = el.dlgCalculo;
		var bloques = CAMPOS.map(function (c) {
			var pc = pcDe(a, c) || {};
			var cab = "<p class='flex items-center gap-2 text-sm font-bold text-gray-800'><span class='inline-block w-2.5 h-2.5 rounded-full' style='background:" + COLOR_CAMPO[c] + "'></span>" + esc(NOMBRE_CAMPO[c]) + "</p>";
			if (RD.esDirecta(pc)) {
				return "<div class='rounded-xl border border-violet-200 bg-violet-50 p-3'>" + cab +
					"<p class='mt-1 text-sm text-violet-950'>Calificación capturada directamente: <strong>" + esc(pc.directa.calificacion) + "</strong>. Ya cuenta como la confirmada de la boleta; no se calcula con las actividades. Para volver al cálculo automático, elige «Automática» (mientras la boleta no esté cerrada).</p></div>";
			}
			var efectivos = M.pesosEfectivos(pc.rubros) || {};
			var filas = M.RUBROS.map(function (r) {
				var x = (pc.rubros || {})[r];
				if (!x || !(x.maximo > 0)) return "";
				var pct = (Math.floor(x.fraccion * 1000 + 1e-9) / 10).toFixed(1);
				return "<tr><td class='py-1 pr-2 text-gray-700'>" + esc(M.ETIQUETA_RUBRO[r]) + "</td><td class='py-1 pr-2 text-right font-semibold'>" + pct + " %</td>" +
					"<td class='py-1 pr-2 text-right text-xs text-gray-500'>" + (Math.round(x.obtenido * 10) / 10) + " de " + (Math.round(x.maximo * 10) / 10) + "</td>" +
					"<td class='py-1 text-right text-xs text-gray-500'>" + (r === "conducta" ? "no pondera" : efectivos[r] !== undefined ? "pesa " + String(efectivos[r]).replace(/\.0$/, "") + " %" : "") + "</td></tr>";
			}).join("");
			if (!filas) return "<div class='rounded-xl border border-gray-200 p-3'>" + cab + "<p class='mt-1 text-sm text-gray-600'>Sin evidencias en el trimestre: la calificación queda a tu juicio docente (o captúrala directamente).</p></div>";
			return "<div class='rounded-xl border border-gray-200 p-3'>" + cab +
				"<table class='mt-1 w-full text-sm'><tbody>" + filas + "</tbody></table>" +
				"<p class='mt-1 text-sm text-gray-800'>Porcentaje del campo: <strong>" + (pc.porcentaje === null || pc.porcentaje === undefined ? "—" : (Math.floor(Number(pc.porcentaje) * 10 + 1e-9) / 10).toFixed(1) + " %") + "</strong>" +
				(pc.calificacionPropuesta !== null && pc.calificacionPropuesta !== undefined ? " → propuesta <strong>" + esc(pc.calificacionPropuesta) + "</strong>" : "") + "</p></div>";
		}).join("");
		d.innerHTML = "<div class='flex flex-col max-h-[calc(100dvh-24px)]'>" +
			"<div class='px-5 pt-5 pb-3 border-b border-gray-100'><h2 id='dlgCalculoTitulo' class='text-lg font-bold text-gray-900'>Cómo se calculó</h2>" +
			"<p class='text-sm text-gray-600 mt-1'>" + esc(a.nombre_completo) + " · " + a.grado + "° · trimestre " + trimestre + "</p></div>" +
			"<div class='px-5 py-4 flex flex-col gap-3 overflow-y-auto min-h-0 flex-1'>" + bloques +
			"<p class='text-xs text-gray-500'>Cada rubro vale lo que marca su peso entre los rubros con datos (Ajustes). La asistencia y la conducta se informan aparte y no ponderan.</p></div>" +
			"<div class='px-5 py-3 border-t border-gray-100 flex justify-end'><button type='button' data-cerrar class='" + BTN_SEC + "'>Cerrar</button></div></div>";
		d.querySelector("[data-cerrar]").addEventListener("click", function () { d.close(); });
		d.showModal();
	}

	async function terminar() {
		var boton = el.contenido.querySelector("[data-terminar]");
		if (boton) boton.disabled = true;
		var hechos = ((progreso && progreso.pasos_hechos) || []).map(Number);
		if (hechos.indexOf(4) === -1) hechos.push(4);
		var ok = await guardarProgreso({ estado: "terminado", paso: 4, pasos_hechos: hechos.sort(), terminado_en: ahora() });
		if (!ok) {
			if (boton) boton.disabled = false;
			mensaje("error", "No se pudo guardar que terminaste. Revisa tu conexión e inténtalo de nuevo.");
			return;
		}
		pintarPasos();
		el.contenido.innerHTML = "<h2 class='text-lg font-bold text-gray-900'>Ya estás al día</h2>" +
			"<p class='mt-2 text-sm text-gray-700 leading-relaxed'>Tu registro histórico quedó guardado. Desde hoy, captura en Hoy. Cuando llegue el cierre del trimestre, confirma las calificaciones en Reportes → Boleta.</p>" +
			"<div class='mt-4 flex flex-col sm:flex-row gap-2'><a href='hoy.html' class='" + BTN_PRI + "'>Ir a Hoy</a><a href='reportes.html' class='" + BTN_SEC + "'>Ir a Reportes</a><a href='dashboard.html' class='" + BTN_SEC + "'>Ir a Inicio</a></div>";
		el.salir.classList.add("hidden");
	}

	// ── Arranque ──────────────────────────────────────────────────────────────
	el.empezar.addEventListener("click", async function () {
		el.empezar.disabled = true;
		var ok = await guardarProgreso({ estado: "en_curso", paso: 1 });
		el.empezar.disabled = false;
		if (!ok) { mensaje("error", "No se pudo empezar. Revisa tu conexión e inténtalo de nuevo."); return; }
		mostrarAsistente(1);
	});
	el.ocultar.addEventListener("click", async function () {
		el.ocultar.disabled = true;
		var ok = await guardarProgreso({ estado: "saltado" });
		el.ocultar.disabled = false;
		if (!ok) { mensaje("error", "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo."); return; }
		window.location.href = "dashboard.html";
	});

	function mostrarAsistente(n) {
		el.intro.classList.add("hidden");
		el.pasos.classList.remove("hidden");
		el.contenido.classList.remove("hidden");
		el.salir.classList.remove("hidden");
		irA(n);
	}

	window.Lectura.arrancar(async function () {
		var ses = await window.sb.auth.getSession();
		if (ses.error || !ses.data.session) { window.location.href = "index.html"; return; }
		userId = ses.data.session.user.id;
		grupo = (await window.GrupoActivo.cargar(window.sb, userId)).grupo;
		if (!grupo) { window.location.href = "onboarding.html"; return; }
		gradosGrupo = (grupo.grados || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; }).sort(function (a, b) { return a - b; });

		hoy = hoyLocal();
		ayer = H.ayer(hoy);
		trimestre = Number(grupo.trimestre_actual) || 1;
		inicio = H.inicioDelTrimestre(trimestre, hoy);
		// El periodo vigente (mi_salon_periodos si ya existe; si no, el calendario SEP) solo informa
		var periodos = await H.leerPeriodos(window.sb);
		var periodo = H.periodoVigente(hoy, periodos);
		ajustesCal = await A.leerAjustesCalendario(window.sb, userId, grupo.id);
		await leerAlumnos();

		el.sub.textContent = (grupo.nombre || "Grupo") + " · trimestre " + trimestre + " · del " + fechaCorta(inicio) + " a hoy";
		progreso = await window.Lectura.uno(window.sb.from("ponte_al_dia").select("estado, paso, pasos_hechos")
			.eq("maestro_id", userId).eq("grupo_id", grupo.id).maybeSingle());

		var desdeAlta = /[?&]desde=alta\b/.test(window.location.search);
		// Recargar no vuelve a empezar: la dirección queda sin ?desde=alta
		if (desdeAlta && window.history && window.history.replaceState) {
			try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* se queda */ }
		}
		// Viene del alta: el paso 1 ya está hecho (el alta ya dejó el avance; si no pudo, aquí)
		if (desdeAlta && !progreso) await guardarProgreso({ estado: "en_curso", paso: 2, pasos_hechos: [1] });
		if (progreso) {
			mostrarAsistente(progreso.estado === "terminado" ? 4 : Math.max(1, Math.min(4, Number(progreso.paso) || 1)));
			if (desdeAlta) mensaje("ok", "Tus " + alumnos.length + " alumnos quedaron guardados. Sigue la asistencia pasada; puedes saltar cualquier paso.");
			return;
		}
		var semanasN = H.semanas(H.diasHistoricos(inicio, hoy, ajustesCal)).length;
		el.introTexto.textContent = H.ofrecerPonteAlDia(hoy, { inicio: inicio })
			? "El trimestre " + trimestre + " empezó el " + fechaCorta(inicio) + (semanasN ? " y ya llevas " + semanasN + (semanasN === 1 ? " semana" : " semanas") + " de clases" : "") +
				". En 4 pasos capturas lo que ya llevas para que tu boleta salga completa. Con un grupo de 30 alumnos toma una tarde." +
				(periodo && periodo.trimestre !== trimestre ? " Según el calendario, hoy corresponde el trimestre " + periodo.trimestre + "; tu grupo está en el " + trimestre + " (lo cambias en Mi grupo)." : "")
			: "Tu trimestre apenas empieza: no hay días atrasados. Puedes usar el asistente de todos modos para pegar tu lista o capturar calificaciones que ya tengas.";
		el.intro.classList.remove("hidden");
	});
});
