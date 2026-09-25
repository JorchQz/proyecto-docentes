/*
	que-le-falta.js — "Qué le falta" a cada alumno en el trimestre, por campo formativo
	(idea aprobada por Jorge el 2026-09-25, a partir del "¿Cómo sacar 10?" de un competidor;
	la versión de Mi salón va según la NEM: dice qué falta para acreditar o avanzar, nunca
	"puntos para sacar 10").

	SOLO junta hechos que ya existen en los datos. No inventa pesos, puntos ni metas y no
	convierte porcentajes a calificación (eso es solo calcular_calificacion_boleta, en SQL):
	  - Productos de sesiones ya trabajadas que el alumno no entregó o entregó incompletos
	    (calificaciones.estado_entrega) y, aparte, los que la maestra aún no revisa (eso es
	    pendiente de la maestra, no del alumno). Los productos son los que el motor ya tomó
	    para su calificación (js/motor-calificacion.js: su grado y su alta); justificado y
	    "no aplica" no cuentan, igual que en el motor.
	    "Ya trabajada": la sesión tiene fecha y esa fecha ya llegó; una tarea, cuando ya venció
	    (AlcanceHoy.venceTarea: su fecha de entrega o el siguiente día hábil, como en Hoy).
	  - PDA del trimestre con nivel predominante "Requiere apoyo" o "En proceso" (v_avance_pda,
	    la misma vista de "Avance por PDA") y PDA de su grado trabajados en sesiones ya dadas
	    que todavía no tienen evidencia (sesiones_pda), con el texto del catálogo y su criterio.
	  - Campo sin evidencias en el trimestre: queda a juicio docente (decisión 5 de Jorge).
	  - Campo con la calificación (la confirmada; si no hay, la propuesta del motor, que ya
	    salió de la función SQL) debajo del mínimo por campo de su grado y su entidad
	    (js/reglas-entidad.js: acreditacion.campoMinimo; 1° se acredita con haber cursado):
	    "Revisar", con la escala de su grado (1° de 6 a 10; 2° a 6° de 5 a 10).
	  - Faltas sin justificar del trimestre, como dato de referencia (la asistencia no
	    pondera; ya se muestra en el reporte).
	Boleta del trimestre cerrada: lo entregado lee solo la foto del cierre y la foto no guarda
	productos ni capturas, así que no se lista nada: se dice "trimestre cerrado".

	Arriba, funciones puras (se prueban en node: pruebas/que-le-falta.test.js); abajo, el HTML
	para el Reporte del alumno y para la vista de grupo de Reportes.
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var NOMBRE_CAMPO = {
		LEN: "Lenguajes",
		SAB: "Saberes y Pensamiento Científico",
		ETI: "Ética, Naturaleza y Sociedades",
		DHL: "De lo Humano y lo Comunitario",
	};
	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };
	var ETIQUETA_NIVEL = { en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
	var ORDEN_NIVEL = { requiere_apoyo: 0, en_proceso: 1 };
	var SIN_CRITERIO = "Criterio de la sesión"; // lo que pone recalcular_evidencia_pda sin PDA ni criterio

	// Módulos compartidos: en el navegador, los globales; en node (pruebas), require
	function modulo(global, archivo) {
		if (typeof window !== "undefined" && window[global]) return window[global];
		if (typeof require === "function") {
			try { return require("./" + archivo); } catch (e) { /* sin el script */ }
		}
		return null;
	}
	function motor() { return modulo("MotorCalificacion", "motor-calificacion.js"); }
	function alcance() { return modulo("AlcanceHoy", "alcance-hoy.js"); }
	function codigoCampo(largo) {
		var CF = typeof window !== "undefined" ? window.CamposFormativos : null;
		if (CF && CF.corto) return CF.corto(largo);
		var c = String(largo || "").toUpperCase();
		return CAMPOS.indexOf(c) !== -1 ? c : null;
	}

	function vacio(v) { return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v)); }
	function texto(v) { return vacio(v) ? "" : String(v).trim(); }

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// Llave de un PDA como la de v_avance_pda (clave_pda): el pda_id; sin PDA de catálogo, el
	// criterio con que recalcular_evidencia_pda guarda la evidencia
	function clavePda(sp) {
		if (sp.pda_id) return String(sp.pda_id);
		return texto(sp.criterio_aplicado) || SIN_CRITERIO;
	}
	function textoCatalogo(sp) {
		var cp = sp.catalogo_pda;
		if (Array.isArray(cp)) cp = cp[0];
		return cp && texto(cp.pda) ? texto(cp.pda) : "";
	}

	function campoVacio() {
		return { productos: [], porRevisar: [], pda: [], sinEvidencias: false, revisar: null, pendientes: 0 };
	}

	/*
		calcular(e) → resultado de un alumno.
		e = {
		  alumno:       { id, grado }                    grado de hoy
		  cerrada:      true si la boleta del trimestre está cerrada
		  porCampo:     el del motor de HOY ({LEN: {porcentaje}, ...})
		  detalle:      { sesiones: [{id, fecha, campo_formativo, numero_sesion, sesiones_pda: [...]}],
		                  productos: [{id, sesion_id, tipo, campo, nombre, fecha_entrega, orden}],
		                  calificaciones: {productoId: fila}, alta: "AAAA-MM-DD"|null }
		                (motor con ctx.detalle: los productos ya vienen filtrados por grado y alta)
		  avancePda:    filas de v_avance_pda de ese alumno y trimestre
		  calificacion: {LEN: {valor, origen: "confirmada"|"propuesta"} | null, ...}
		  asistencia:   { presentes, total }   (presentes cuenta las justificadas, como el motor)
		  hoy:          "AAAA-MM-DD"
		  regla:        ReglasEntidad.regla(estado)
		}
		→ { cerrada, campos: {LEN: {productos, porRevisar, pda, sinEvidencias, revisar, pendientes}},
		    faltas: {sinJustificar, dias} | null, total, porRevisar }
	*/
	function calcular(e) {
		e = e || {};
		if (e.cerrada) return { cerrada: true, campos: {}, faltas: null, total: 0, porRevisar: 0 };
		var grado = Number(e.alumno && e.alumno.grado);
		var hoy = e.hoy || "";
		var det = e.detalle || {};
		var M = motor(), A = alcance();
		var campos = {};
		CAMPOS.forEach(function (c) { campos[c] = campoVacio(); });

		var sesionPorId = {};
		(det.sesiones || []).forEach(function (s) { sesionPorId[s.id] = s; });
		// Sesión ya trabajada: con fecha, esa fecha ya llegó y es desde el alta del alumno
		function trabajada(s) {
			if (!s || !s.fecha || s.fecha > hoy) return false;
			return !A || !det.alta || A.cuentaDesdeAlta(det.alta, s.fecha, null);
		}

		// ── Productos ──
		var productos = (det.productos || []).slice().sort(function (a, b) {
			var sa = sesionPorId[a.sesion_id] || {}, sb = sesionPorId[b.sesion_id] || {};
			return (Number(sa.numero_sesion) || 0) - (Number(sb.numero_sesion) || 0) ||
				String(sa.fecha || "").localeCompare(String(sb.fecha || "")) || (Number(a.orden) || 0) - (Number(b.orden) || 0);
		});
		productos.forEach(function (p) {
			var rubro = M ? M.rubroDeProducto(p.tipo) : (p.tipo === "tarea" ? "tareas" : "trabajos");
			var c = codigoCampo(p.campo);
			if (!rubro || !campos[c]) return; // un "examen" como producto no es de este rubro (motor)
			var s = sesionPorId[p.sesion_id] || {};
			var cal = (det.calificaciones || {})[p.id] || null;
			var estado = cal ? cal.estado_entrega : null;
			var item = {
				id: p.id, nombre: texto(p.nombre) || "Producto", tarea: rubro === "tareas",
				sesion: vacio(s.numero_sesion) ? null : Number(s.numero_sesion), fecha: s.fecha || null,
			};
			if (estado === "justificado" || estado === "no_aplica") return; // fuera del máximo, como en el motor
			if (estado === "no_entregado") { campos[c].productos.push(Object.assign(item, { estado: "no_entregado" })); return; }
			if (estado === "incompleto") { campos[c].productos.push(Object.assign(item, { estado: "incompleto" })); return; }
			var valor = M ? M.puntajeProducto(cal) : (cal && (cal.nivel || !vacio(cal.puntaje)) ? 1 : null);
			if (valor !== null) return; // ya revisado
			// Sin revisar: solo si ya le tocaba (sesión dada; la tarea, ya vencida)
			var cuando = item.tarea
				? (A ? A.venceTarea(p.fecha_entrega, s.fecha || null) : (p.fecha_entrega || s.fecha || null))
				: (s.fecha || null);
			if (!cuando || cuando > hoy) return;
			campos[c].porRevisar.push(Object.assign(item, { estado: "sin_revisar" }));
		});

		// ── PDA ──
		var evidencia = {};
		(e.avancePda || []).forEach(function (f) {
			if (e.alumno && e.alumno.id && f.alumno_id && f.alumno_id !== e.alumno.id) return;
			evidencia[String(f.clave_pda)] = f;
		});
		var trabajados = {}; // clave → {campo, texto, criterio, sesiones: [], fecha}
		(det.sesiones || []).forEach(function (s) {
			if (!trabajada(s)) return;
			var c = codigoCampo(s.campo_formativo);
			if (!campos[c]) return;
			(s.sesiones_pda || []).forEach(function (sp) {
				if (Number(sp.grado) !== grado) return;
				var k = clavePda(sp);
				var t = trabajados[k] || (trabajados[k] = { clave: k, campo: c, texto: "", criterio: "", sesiones: [], fecha: "" });
				var txt = textoCatalogo(sp) || texto(sp.criterio_aplicado) || SIN_CRITERIO;
				if (!t.texto) t.texto = txt;
				if (!vacio(s.numero_sesion) && t.sesiones.indexOf(Number(s.numero_sesion)) === -1) t.sesiones.push(Number(s.numero_sesion));
				// El criterio de la sesión más reciente (solo si hay PDA de catálogo: si no, el criterio ES el texto)
				if (sp.pda_id && texto(sp.criterio_aplicado) && String(s.fecha) >= t.fecha) { t.criterio = texto(sp.criterio_aplicado); t.fecha = String(s.fecha); }
			});
		});
		Object.keys(trabajados).forEach(function (k) {
			var t = trabajados[k];
			var f = evidencia[k];
			t.sesiones.sort(function (a, b) { return a - b; });
			if (!f) {
				campos[t.campo].pda.push({ clave: k, texto: t.texto, criterio: t.criterio, nivel: null, evidencias: 0, sesiones: t.sesiones });
				return;
			}
			if (ETIQUETA_NIVEL[f.nivel_predominante]) {
				campos[t.campo].pda.push({ clave: k, texto: texto(f.pda) || t.texto, criterio: t.criterio, nivel: f.nivel_predominante,
					evidencias: Number(f.evidencias) || 0, sesiones: t.sesiones });
			}
		});
		// PDA con evidencia en proceso o requiere apoyo de sesiones que no están entre las trabajadas
		// (por ejemplo, calificadas antes de ponerles fecha): también son del trimestre
		Object.keys(evidencia).forEach(function (k) {
			if (trabajados[k]) return;
			var f = evidencia[k];
			var c = codigoCampo(f.campo_formativo);
			if (!campos[c] || !ETIQUETA_NIVEL[f.nivel_predominante]) return;
			campos[c].pda.push({ clave: k, texto: texto(f.pda) || SIN_CRITERIO, criterio: "", nivel: f.nivel_predominante,
				evidencias: Number(f.evidencias) || 0, sesiones: [] });
		});
		CAMPOS.forEach(function (c) {
			campos[c].pda.sort(function (a, b) {
				var na = a.nivel ? ORDEN_NIVEL[a.nivel] : 2, nb = b.nivel ? ORDEN_NIVEL[b.nivel] : 2;
				return na - nb || ((a.sesiones[0] || 0) - (b.sesiones[0] || 0)) || String(a.texto).localeCompare(String(b.texto));
			});
		});

		// ── Campo sin evidencias y calificación debajo del mínimo ──
		var R = e.regla || null;
		var ac = R && R.acreditacion ? R.acreditacion : null;
		CAMPOS.forEach(function (c) {
			var pc = (e.porCampo || {})[c];
			campos[c].sinEvidencias = !pc || vacio(pc.porcentaje);
			var cal = (e.calificacion || {})[c];
			if (!ac || !cal || vacio(cal.valor) || !(grado >= 1 && grado <= 6)) return;
			if (grado === 1 && ac.primeroConCursar) return; // 1° se acredita con haber cursado el grado
			if (Number(cal.valor) < Number(ac.campoMinimo)) {
				campos[c].revisar = {
					valor: Number(cal.valor), origen: cal.origen === "confirmada" ? "confirmada" : "propuesta",
					minimo: Number(ac.campoMinimo), grado: grado, escala: R.escalaDeGrado ? R.escalaDeGrado(grado) : "",
				};
			}
		});

		var total = 0, porRevisar = 0;
		CAMPOS.forEach(function (c) {
			var x = campos[c];
			x.pendientes = x.productos.length + x.pda.length + (x.sinEvidencias ? 1 : 0) + (x.revisar ? 1 : 0);
			total += x.pendientes;
			porRevisar += x.porRevisar.length;
		});

		var a = e.asistencia || {};
		var faltas = null;
		if (Number(a.total) > 0) {
			var sin = Number(a.total) - Number(a.presentes || 0);
			if (sin > 0) faltas = { sinJustificar: sin, dias: Number(a.total) };
		}
		return { cerrada: false, campos: campos, faltas: faltas, total: total, porRevisar: porRevisar };
	}

	// ── Frases (tono formativo, apto para la maestra y para la junta con las familias) ──

	function sesionTexto(item) {
		if (item.sesion !== null && item.sesion !== undefined) return " (sesión " + item.sesion + ")";
		return "";
	}
	function sesionesTexto(lista) {
		if (!lista || !lista.length) return "";
		if (lista.length === 1) return "la sesión " + lista[0];
		return "las sesiones " + lista.slice(0, -1).join(", ") + " y " + lista[lista.length - 1];
	}

	/*
		frases(campoRes) → [{ tipo, texto, docente }] en el orden en que se leen:
		lo que hay que revisar de la calificación, el campo sin evidencias, lo que falta entregar,
		los PDA por reforzar y, al final, lo que la maestra aún no revisa (docente: true).
		Ejemplo: "Entregar «Cartel de mi comunidad» (sesión 4)."
		         "Reforzar el PDA «Lee textos...», hoy En proceso."
	*/
	function frases(x) {
		var salida = [];
		if (!x) return salida;
		if (x.revisar) {
			var r = x.revisar;
			/*
				Impreso (puede llegar a la familia): una propuesta sin confirmar nunca sale como
				número (art. 4 XI; el reporte imprime "pendiente"), así que esa frase no se imprime;
				una confirmada, con palabras para la familia y sin "Revisar".
			*/
			salida.push({ tipo: "revisar", docente: false, texto: "Revisar la calificación: la " + (r.origen === "confirmada" ? "confirmada" : "propuesta") +
				" es " + r.valor + " y el mínimo aprobatorio es " + r.minimo + (r.escala ? " (escala de " + r.grado + "°: " + r.escala + ")" : "") + ".",
				impreso: r.origen === "confirmada"
					? "La calificación de este campo (" + r.valor + ") está debajo del mínimo aprobatorio de su grado (" + r.minimo + "); la escuela la revisará."
					: null });
		}
		if (x.sinEvidencias) {
			salida.push({ tipo: "sin_evidencias", docente: false,
				texto: "Todavía no hay evidencias de este campo en el trimestre: la calificación queda a juicio docente." });
		}
		x.productos.forEach(function (p) {
			var que = (p.tarea ? "la tarea " : "") + "«" + p.nombre + "»";
			salida.push(p.estado === "incompleto"
				? { tipo: "completar", docente: false, texto: "Completar " + que + sesionTexto(p) + ": la entrega quedó incompleta." }
				: { tipo: "entregar", docente: false, texto: "Entregar " + que + sesionTexto(p) + "." });
		});
		x.pda.forEach(function (d) {
			var crit = d.criterio ? " Criterio: «" + d.criterio + "»." : "";
			if (d.nivel) {
				salida.push({ tipo: "reforzar", docente: false, nivel: d.nivel,
					texto: "Reforzar el PDA «" + d.texto + "», hoy " + ETIQUETA_NIVEL[d.nivel] + "." + crit });
			} else {
				salida.push({ tipo: "sin_evidencia_pda", docente: false,
					texto: "Mostrar evidencia del PDA «" + d.texto + "»" + (d.sesiones.length ? ": se trabajó en " + sesionesTexto(d.sesiones) + " y todavía no tiene evidencia." : ": todavía no tiene evidencia.") + crit });
			}
		});
		x.porRevisar.forEach(function (p) {
			salida.push({ tipo: "por_revisar", docente: true, texto: "Por revisar: «" + p.nombre + "»" + sesionTexto(p) + "." });
		});
		return salida;
	}

	// ── HTML ──────────────────────────────────────────────────────────────────

	var NOTA = "Solo hechos registrados en Mi salón: productos de sesiones ya trabajadas, el avance por PDA y la escala de su grado. " +
		"No son puntos ni metas nuevas: la calificación es juicio del docente.";
	var TEXTO_CERRADO = "La boleta de este trimestre ya se cerró: lo entregado queda como está y lo que falte se trabaja en el siguiente trimestre.";

	function chipCampo(c) {
		return "<span class='inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold text-white' style='background:" +
			COLOR_CAMPO[c] + "'>" + c + "</span>";
	}

	function claseFrase(f) {
		if (f.tipo === "revisar") return "text-amber-900";
		if (f.tipo === "reforzar" && f.nivel === "requiere_apoyo") return "text-gray-900";
		return "text-gray-800";
	}

	function listaFrases(lista) {
		return "<ul class='flex flex-col gap-1.5'>" + lista.map(function (f) {
			// Solo en pantalla: lo pendiente de la maestra y una propuesta sin confirmar
			var soloPantalla = f.docente || f.impreso === null;
			var cuerpo = f.impreso
				? "<span class='print:hidden'>" + esc(f.texto) + "</span><span class='hidden print:inline'>" + esc(f.impreso) + "</span>"
				: esc(f.texto);
			return "<li class='flex gap-2 text-sm leading-relaxed " + claseFrase(f) + (soloPantalla ? " print:hidden" : "") + "' data-qlf='" + f.tipo + "'>" +
				"<span class='mt-2 inline-block w-1.5 h-1.5 rounded-full shrink-0 " + (f.docente ? "bg-gray-300" : "bg-blue-700") + "' aria-hidden='true'></span>" +
				"<span class='min-w-0 break-words'>" + (f.docente ? "<span class='font-semibold text-gray-500'>Docente · </span>" : "") + cuerpo + "</span></li>";
		}).join("") + "</ul>";
	}

	/*
		htmlAlumno(res) → el detalle de un alumno: un bloque por campo con "Para avanzar en
		<campo>:" y sus frases, las faltas como referencia y la nota. Lo que es pendiente de la
		maestra ("Por revisar") se ve en pantalla y no se imprime (el reporte impreso puede
		llegar a la familia). Sirve igual en el Reporte del alumno y en la vista de grupo.
	*/
	function htmlAlumno(res, opciones) {
		opciones = opciones || {};
		if (!res) return "";
		if (res.cerrada) {
			return "<div class='rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900' data-qlf-cerrado>" +
				"<p class='font-semibold'>Trimestre cerrado</p><p class='mt-1 leading-relaxed'>" + esc(TEXTO_CERRADO) + "</p></div>";
		}
		var bloques = CAMPOS.map(function (c) {
			var x = res.campos[c] || campoVacio();
			var lista = frases(x);
			var alumnoN = x.pendientes;
			var cabeza = "<p class='flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200' style='border-left:6px solid " + COLOR_CAMPO[c] + "'>" +
				chipCampo(c) + "<span class='font-semibold text-gray-800 text-sm'>" + (lista.some(function (f) { return !f.docente; }) ? "Para avanzar en " : "") +
				esc(NOMBRE_CAMPO[c]) + "</span>" +
				"<span class='text-xs text-gray-500 print:hidden' data-qlf-cuenta='" + c + "'>" + (alumnoN ? alumnoN + (alumnoN === 1 ? " pendiente" : " pendientes") : "sin pendientes") + "</span></p>";
			var cuerpo = lista.length
				? listaFrases(lista)
				: "<p class='text-sm text-gray-500'>Sin pendientes con lo registrado hasta hoy.</p>";
			return "<div class='bloque rounded-xl border border-gray-200 overflow-hidden' data-qlf-campo='" + c + "'>" + cabeza +
				"<div class='px-3 py-2'>" + cuerpo + "</div></div>";
		}).join("");
		var faltas = res.faltas
			? "<p class='bloque rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700' data-qlf-faltas>" +
				"<span class='font-semibold'>Faltas sin justificar en el trimestre:</span> " + res.faltas.sinJustificar + " de " + res.faltas.dias +
				" días registrados. <span class='text-xs text-gray-500'>Dato de referencia: la asistencia no forma parte de la calificación.</span></p>"
			: "";
		var resumen = res.total
			? res.total + (res.total === 1 ? " pendiente" : " pendientes") + " del alumno en el trimestre"
			: "Sin pendientes del alumno con lo registrado hasta hoy";
		return "<div class='flex flex-col gap-3' data-qlf-alumno-detalle>" +
			(opciones.sinResumen ? "" : "<p class='text-sm text-gray-700 print:hidden' data-qlf-total='" + res.total + "'>" + esc(resumen) +
				(res.porRevisar ? "<span class='print:hidden'> · " + res.porRevisar + (res.porRevisar === 1 ? " producto" : " productos") + " por revisar (docente)</span>" : "") + ".</p>") +
			"<div class='grid grid-cols-1 lg:grid-cols-2 print:grid-cols-1 gap-3'>" + bloques + "</div>" + faltas +
			"<p class='text-xs text-gray-500 leading-relaxed'>" + esc(NOTA) + "</p></div>";
	}

	/*
		Vista de grupo (Reportes → "Qué le falta"): una fila por alumno con cuántos pendientes
		tiene en cada campo; al tocarla se abre su detalle (htmlAlumno) debajo.
		lista = [{ alumno: {id, nombre_completo, num_lista, grado}, res }]
	*/
	function htmlGrupo(lista, trimestre) {
		if (!lista || !lista.length) return "<p class='text-gray-400'>Sin alumnos activos en el grupo.</p>";
		var abiertos = lista.filter(function (f) { return f.res && !f.res.cerrada; });
		var conPendientes = abiertos.filter(function (f) { return f.res.total > 0; }).length;
		var cerrados = lista.length - abiertos.length;
		var porRevisar = abiertos.reduce(function (s, f) { return s + (f.res.porRevisar || 0); }, 0);
		var cabecera = "<div class='rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900' data-qlf-resumen>" +
			"<p class='font-semibold'>" + conPendientes + " de " + lista.length + " alumnos con algo pendiente en el trimestre " + esc(trimestre) + ".</p>" +
			"<p class='mt-1 leading-relaxed'>El número de cada campo cuenta lo que le falta al alumno: entregas, PDA por reforzar o sin evidencia, " +
			"campo sin evidencias (juicio docente) y calificación por revisar. Toca un alumno para ver el detalle." +
			(porRevisar ? " Además tienes " + porRevisar + (porRevisar === 1 ? " producto" : " productos") + " sin revisar; no cuentan como pendiente del alumno." : "") +
			(cerrados ? " " + cerrados + (cerrados === 1 ? " alumno tiene" : " alumnos tienen") + " la boleta de este trimestre cerrada." : "") + "</p></div>";
		var filas = lista.map(function (f) {
			var al = f.alumno || {};
			var res = f.res || { cerrada: false, campos: {}, total: 0 };
			var chips = res.cerrada
				? "<span class='inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800'>Trimestre cerrado</span>"
				: CAMPOS.map(function (c) {
					var x = res.campos[c] || campoVacio();
					var n = x.pendientes;
					var marca = x.revisar ? " · Revisar" : (x.sinEvidencias ? " · sin evidencias" : "");
					return "<span class='inline-flex items-center gap-1 rounded-lg border px-1.5 sm:px-2 py-1 text-xs whitespace-nowrap " +
						(n ? "border-gray-300 bg-white text-gray-800" : "border-gray-100 bg-gray-50 text-gray-400") + "' data-qlf-chip='" + c + "' title='" +
						esc(NOMBRE_CAMPO[c]) + "'>" + "<span class='inline-block w-2 h-2 rounded-full' style='background:" + COLOR_CAMPO[c] + "'></span>" +
						"<span class='font-semibold'>" + c + "</span> <span class='font-bold'>" + n + "</span>" +
						(marca ? "<span class='" + (x.revisar ? "text-amber-800 font-semibold" : "text-gray-500") + "'>" + marca + "</span>" : "") + "</span>";
				}).join("");
			var idDetalle = "qlf-detalle-" + esc(al.id);
			return "<li class='border-b border-gray-100 last:border-0' data-qlf-fila='" + esc(al.id) + "'>" +
				"<button type='button' class='w-full min-h-[44px] flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg' " +
				"data-qlf-alumno='" + esc(al.id) + "' aria-expanded='false' aria-controls='" + idDetalle + "'>" +
				"<span class='flex items-center gap-2 min-w-0 sm:w-64 shrink-0'>" +
				"<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0 text-gray-400 transition-transform' data-qlf-flecha viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m9 18 6-6-6-6'/></svg>" +
				"<span class='text-xs text-gray-400 w-6 text-right shrink-0'>" + esc(al.num_lista || "") + "</span>" +
				"<span class='font-medium text-gray-800 truncate'>" + esc(al.nombre_completo || "Sin nombre") + "</span>" +
				"<span class='text-xs text-gray-400 shrink-0'>" + esc(al.grado ? al.grado + "°" : "") + "</span></span>" +
				"<span class='flex flex-wrap gap-1 sm:gap-1.5 pl-6 sm:pl-0'>" + chips + "</span>" +
				(res.cerrada ? "" : "<span class='sm:ml-auto pl-6 sm:pl-0 text-xs text-gray-500 whitespace-nowrap' data-qlf-total-alumno='" + res.total + "'>" +
					res.total + (res.total === 1 ? " pendiente" : " pendientes") + "</span>") +
				"</button>" +
				"<div id='" + idDetalle + "' class='hidden px-3 pb-4 pt-1' data-qlf-detalle='" + esc(al.id) + "'>" +
				htmlAlumno(res) +
				"<a href='reporte-alumno.html?alumno=" + encodeURIComponent(al.id || "") + "&trimestre=" + encodeURIComponent(trimestre) +
				"' class='mt-3 inline-flex items-center min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50'>Ver reporte del alumno</a>" +
				"</div></li>";
		}).join("");
		return "<div class='flex flex-col gap-4'>" + cabecera +
			"<ul class='rounded-xl border border-gray-200 bg-white' data-qlf-grupo>" + filas + "</ul></div>";
	}

	// Abre o cierra el detalle de un alumno (delegado en el contenedor de la vista de grupo)
	function alternar(boton) {
		var li = boton && boton.closest ? boton.closest("[data-qlf-fila]") : null;
		if (!li) return;
		var det = li.querySelector("[data-qlf-detalle]");
		var abierto = boton.getAttribute("aria-expanded") === "true";
		boton.setAttribute("aria-expanded", abierto ? "false" : "true");
		if (det) det.classList.toggle("hidden", abierto);
		var flecha = boton.querySelector("[data-qlf-flecha]");
		if (flecha) flecha.style.transform = abierto ? "" : "rotate(90deg)";
	}

	var api = {
		CAMPOS: CAMPOS,
		calcular: calcular,
		frases: frases,
		htmlAlumno: htmlAlumno,
		htmlGrupo: htmlGrupo,
		alternar: alternar,
		TEXTO_CERRADO: TEXTO_CERRADO,
	};
	if (typeof window !== "undefined") window.QueLeFalta = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
