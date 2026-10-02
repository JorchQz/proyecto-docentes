/*
	sesion-terminar.js — Empezar y terminar una sesión: lo comparten Hoy (js/hoy.js) e Inicio
	(js/dashboard.js). Decisiones de Jorge del 2026-09-29:
	  - Una sesión empezada ("Trabajar hoy" le pone fecha y la marca activa) sigue en Hoy hasta darle
	    "Terminar sesión", aunque pasen los días. No se puede empezar otra del mismo proyecto sin
	    terminarla (enCurso, bloqueaSiguiente).
	  - Las sesiones con fecha ANTERIOR a CORTE_EN_CURSO se dan por terminadas: son las que se trabajaron
	    antes de este cambio (Fanny las trabajó sin darles "Terminar"). Es un corte en el código; no se
	    escribe nada en la cuenta de nadie. CORTE_EN_CURSO es el primer día de clase después de publicar.
	  - Terminar: espera a que se envíe lo capturado, dice cuántos quedan sin calificar, deja escribir
	    notas (opcional), marca la sesión completada y, si a ese proyecto ya no le quedan sesiones, lo
	    da por completado. Después Hoy abre la tarjeta azul con la siguiente.
	  - Sesiones de varios días (Fase 5b, 2026-10-02; mi_salon_b27): la sesión que se continúa otro día conserva
	    su fecha de inicio (sesiones.fecha, la bandera "empezada") y cada día que se trabaja queda en sesion_dias.
	    Al TERMINARLA se escribe terminada_en (el día de México, o el último día trabajado si hoy no se trabajó:
	    preguntaDia) y las actividades que sigan sin día toman ese día. Las tareas del plan, que no traen fecha de
	    entrega, vencen el siguiente día de clase DESPUÉS de terminar la sesión (AlcanceHoy.baseTarea) y la
	    participación cuenta en cada día trabajado (el motor lee sesion_dias).

	Expone window.SesionTerminar (y module.exports para las pruebas):
	  CORTE_EN_CURSO, enCurso(sesion, corte), enCursoDe(sesiones, proyectoId, corte),
	  bloqueaSiguiente(sesiones, proyectoId, corte), etiquetaEmpezo(fecha, hoy), textoSinCalificar(n),
	  preguntaDia(datos), etiquetaDia(fecha), abrirModal(opciones), terminar(sb, datos)
*/

(function () {
	"use strict";

	// Primer día de clase después de publicar (miércoles 30 de septiembre de 2026): las sesiones con fecha
	// anterior cuentan como terminadas. Si la publicación se pasa a otro día, este es el único valor que cambia.
	var CORTE_EN_CURSO = "2026-09-30";

	var MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

	function dia(f) { return String(f || "").slice(0, 10); }

	/*
		¿La sesión está empezada y sin terminar? Con fecha (ya se trabajó al menos un día), desde el corte
		y sin marcar como completada. Las actividades sueltas no son sesiones (quien llama las descarta).
	*/
	function enCurso(sesion, corte) {
		if (!sesion || !sesion.fecha) return false;
		if (sesion.estado_sesion === "completada") return false;
		return dia(sesion.fecha) >= dia(corte || CORTE_EN_CURSO);
	}

	// Las sesiones en curso de un proyecto, por número de sesión
	function enCursoDe(sesiones, proyectoId, corte) {
		return (sesiones || []).filter(function (s) {
			return s && (proyectoId === undefined || proyectoId === null || s.proyecto_id === proyectoId) && enCurso(s, corte);
		}).sort(function (a, b) {
			return (Number(a.numero_sesion) || 0) - (Number(b.numero_sesion) || 0) || String(a.id).localeCompare(String(b.id));
		});
	}

	// ¿Hay una sesión del proyecto sin terminar? Entonces no se puede empezar la siguiente.
	function bloqueaSiguiente(sesiones, proyectoId, corte) {
		return enCursoDe(sesiones, proyectoId, corte).length > 0;
	}

	// "Empezó el 29 sep": solo de un día anterior a hoy ("" si empezó hoy o no hay fecha)
	function etiquetaEmpezo(fecha, hoy) {
		var f = dia(fecha);
		var m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!m || (hoy && f >= dia(hoy))) return "";
		return "Empezó el " + Number(m[3]) + " " + MESES_CORTOS[Number(m[2]) - 1];
	}

	// "lun 5 oct": el día de la semana, el número y el mes; la ÚNICA forma de nombrar un día de una sesión de varios días
	var DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
	function etiquetaDia(fecha) {
		var f = dia(fecha);
		var m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!m) return "";
		var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
		return DIAS_SEMANA[d.getDay()] + " " + Number(m[3]) + " " + MESES_CORTOS[Number(m[2]) - 1];
	}

	/*
		preguntaDia({ sesion, dias, productos, hoy }) → { ultimoDia } | null
		Al terminar una sesión que empezó otro día: si hoy no se trabajó (ninguna actividad con día de hoy y hoy no está en
		sus días), el diálogo pregunta "¿La sesión se trabajó hoy?" y, si no, ese día es el último día trabajado.
		dias: las fechas de sesion_dias; productos: las actividades activas (con fecha_trabajo). null: no se pregunta (empezó
		hoy, o hoy sí se trabajó, o no hay ningún día anterior que ofrecer).
	*/
	function preguntaDia(d) {
		d = d || {};
		var hoy = dia(d.hoy), ses = d.sesion || {};
		if (!hoy || !ses.fecha || dia(ses.fecha) >= hoy) return null;
		var dias = (d.dias || []).map(dia).filter(Boolean);
		(d.productos || []).forEach(function (p) {
			if (p && p.tipo !== "tarea" && p.fecha_trabajo) dias.push(dia(p.fecha_trabajo));
		});
		dias.push(dia(ses.fecha));
		if (dias.indexOf(hoy) !== -1) return null;
		var previos = dias.filter(function (x) { return x < hoy; }).sort();
		return previos.length ? { ultimoDia: previos[previos.length - 1] } : null;
	}

	function textoSinCalificar(n) {
		if (n === null || n === undefined) return "";
		n = Number(n);
		if (!(n > 0)) return "Todo lo de esta sesión está calificado.";
		return (n === 1 ? "Queda 1 sin calificar." : "Quedan " + n + " sin calificar.") +
			" Puedes terminar la sesión y calificarlas después.";
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	/*
		abrirModal({ titulo, sinCalificar, etiquetaBoton, origen, pregunta, alConfirmar })
		Diálogo accesible (role="dialog", foco dentro, Esc cierra y el foco vuelve a `origen`).
		pregunta (preguntaDia): { ultimoDia } agrega "¿La sesión se trabajó hoy?" con "Sí, hoy" y "No, se trabajó
		por última vez el <día>".
		alConfirmar(notas, dia) es asíncrona: dia es null (hoy) o el último día trabajado que eligió; si lanza, el
		diálogo sigue abierto y dice el error. Devuelve { cerrar }.
	*/
	var numero = 0;
	function abrirModal(op) {
		op = op || {};
		var previo = op.origen || document.activeElement;
		var id = "terminarSesion" + (++numero);
		var fondo = document.createElement("div");
		fondo.id = "modal-cierre-sesion";
		fondo.className = "fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center sm:p-4";
		var texto = textoSinCalificar(op.sinCalificar);
		fondo.innerHTML =
			"<div role='dialog' aria-modal='true' aria-labelledby='" + id + "-t' class='bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] overflow-y-auto'>" +
			"<div class='p-5 border-b border-gray-100'><h2 id='" + id + "-t' class='text-lg font-bold text-gray-800'>" + esc(op.titulo || "Terminar la sesión") + "</h2>" +
			"<p class='text-sm text-gray-500 mt-1'>Marca la sesión como trabajada; la siguiente queda lista para empezar.</p>" +
			(texto ? "<p class='mt-2 text-sm font-medium " + (op.sinCalificar > 0 ? "text-amber-700" : "text-emerald-700") + "' data-sin-calificar>" + esc(texto) + "</p>" : "") +
			"</div>" +
			(op.pregunta && op.pregunta.ultimoDia
				? "<fieldset class='px-5 pt-4' data-pregunta-dia aria-describedby='" + id + "-e'><legend class='text-sm font-semibold text-gray-800 mb-2'>¿La sesión se trabajó hoy?</legend>" +
				"<label class='flex items-center gap-3 min-h-[44px] text-sm text-gray-700'><input type='radio' name='" + id + "-d' value='hoy' class='h-5 w-5'> Sí, hoy</label>" +
				"<label class='flex items-center gap-3 min-h-[44px] text-sm text-gray-700'><input type='radio' name='" + id + "-d' value='" + esc(op.pregunta.ultimoDia) + "' class='h-5 w-5'> No, se trabajó por última vez el " + esc(etiquetaDia(op.pregunta.ultimoDia)) + "</label></fieldset>"
				: "") +
			"<div class='p-5'><label for='" + id + "-n' class='block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2'>Notas (opcional)</label>" +
			"<textarea id='" + id + "-n' rows='3' class='w-full border border-gray-300 rounded-xl p-3 text-sm min-h-[72px] resize-none' placeholder='¿Algo diferente a lo planeado?'></textarea>" +
			"<p id='" + id + "-e' class='hidden mt-3 text-sm text-red-700' role='alert' aria-live='assertive'></p></div>" +
			"<div class='p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2'>" +
			"<button type='button' data-terminar-cancelar class='min-h-[44px] border border-gray-300 text-gray-700 px-4 rounded-xl font-medium hover:bg-gray-50'>Cancelar</button>" +
			"<button type='button' data-terminar-confirmar class='min-h-[44px] bg-blue-600 text-white px-5 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-60'>" + esc(op.etiquetaBoton || "Terminar sesión") + "</button>" +
			"</div></div>";
		document.body.appendChild(fondo);
		var caja = fondo.firstChild;
		var btnOk = fondo.querySelector("[data-terminar-confirmar]");
		var btnNo = fondo.querySelector("[data-terminar-cancelar]");
		var area = document.getElementById(id + "-n");
		var error = document.getElementById(id + "-e");
		var ocupado = false;

		function cerrar() {
			document.removeEventListener("keydown", teclas, true);
			if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
			if (previo && previo.focus) { try { previo.focus(); } catch (_) { /* sin foco */ } }
		}
		// Cancelar, Esc o tocar fuera: cierra y avisa (op.alCancelar; la jornada espera la respuesta)
		function cancelar() {
			cerrar();
			if (op.alCancelar) op.alCancelar();
		}
		function teclas(e) {
			if (e.key === "Escape" && !ocupado) { e.stopPropagation(); cancelar(); return; }
			if (e.key !== "Tab") return;
			var lista = Array.prototype.slice.call(caja.querySelectorAll("button, textarea, input[type='radio']")).filter(function (x) { return !x.disabled; });
			if (!lista.length) return;
			var primero = lista[0], ultimo = lista[lista.length - 1];
			// Los radios de la pregunta son un solo paso de Tab: el foco puede estar en cualquiera de ellos (R41)
			var enPrimero = document.activeElement === primero ||
				(primero.type === "radio" && document.activeElement && document.activeElement.name === primero.name);
			if (e.shiftKey && enPrimero) { e.preventDefault(); ultimo.focus(); }
			else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
		}
		document.addEventListener("keydown", teclas, true);
		btnNo.addEventListener("click", function () { if (!ocupado) cancelar(); });
		fondo.addEventListener("click", function (e) { if (e.target === fondo && !ocupado) cancelar(); });
		btnOk.addEventListener("click", async function () {
			if (ocupado) return;
			// Con la pregunta del día no hay opción por omisión (R40): un día de terminación falso movería la participación
			var elegido = fondo.querySelector("input[name='" + id + "-d']:checked");
			if (op.pregunta && op.pregunta.ultimoDia && !elegido) {
				error.classList.remove("hidden");
				error.textContent = "";
				// El texto se pone después de mostrar el aviso para que el lector de pantalla lo anuncie
				setTimeout(function () { error.textContent = "Elige si la sesión se trabajó hoy."; }, 30);
				var primerRadio = fondo.querySelector("input[name='" + id + "-d']");
				if (primerRadio) primerRadio.focus();
				return;
			}
			ocupado = true;
			btnOk.disabled = true;
			btnNo.disabled = true;
			var etiqueta = btnOk.textContent;
			btnOk.textContent = "Terminando...";
			error.classList.add("hidden");
			try {
				// El día en que se terminó: hoy, salvo que diga que hoy no se trabajó (entonces, el último día trabajado)
				await op.alConfirmar(area.value.trim(), elegido && elegido.value !== "hoy" ? elegido.value : null);
			} catch (e) {
				error.textContent = (e && e.message) ? e.message : "No se pudo terminar la sesión.";
				error.classList.remove("hidden");
				ocupado = false;
				btnOk.disabled = false;
				btnNo.disabled = false;
				btnOk.textContent = etiqueta;
			}
		});
		// El foco inicial va a la pregunta del día si existe (el primer radio, sin elegir nada por él); si no, a las notas
		var primerRadioInicial = fondo.querySelector("input[name='" + id + "-d']");
		setTimeout(function () {
			var inicial = primerRadioInicial || area;
			if (inicial && inicial.focus) inicial.focus();
		}, 0);
		return { cerrar: cerrar };
	}

	/*
		── Los pasos de "Finalizar jornada" con una sesión abierta (Fase 5b) ──
		Dos diálogos accesibles en una promesa (role="dialog", foco dentro, Esc o "Volver" resuelven null y el foco vuelve a
		`origen`):
		  preguntar({ origen, titulo, texto, botones: [{ valor, etiqueta, primario }], cancelar }) → valor | null
		  elegirActividades({ origen, titulo, texto, items: [{ id, etiqueta, marcado, fijo }], aceptar, cancelar, vacio })
		    → [ids marcados por quien responde, sin los fijos] | null
		Se arman con el mismo cuerpo que abrirModal (botones de 44 px, sin emojis).
	*/
	function dialogo(op, cuerpoHtml, pieHtml, alListo) {
		var previo = op.origen || document.activeElement;
		var id = "pasoSesion" + (++numero);
		var fondo = document.createElement("div");
		fondo.className = "fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center sm:p-4";
		fondo.innerHTML =
			"<div role='dialog' aria-modal='true' aria-labelledby='" + id + "-t' class='bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] overflow-y-auto'>" +
			"<div class='p-5 border-b border-gray-100'><h2 id='" + id + "-t' class='text-lg font-bold text-gray-800 break-words'>" + esc(op.titulo) + "</h2>" +
			(op.texto ? "<p class='text-sm text-gray-500 mt-1'>" + esc(op.texto) + "</p>" : "") + "</div>" +
			cuerpoHtml +
			"<div class='p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2'>" + pieHtml + "</div></div>";
		document.body.appendChild(fondo);
		var caja = fondo.firstChild;
		var terminado = false;
		function cerrar(valor) {
			if (terminado) return;
			terminado = true;
			document.removeEventListener("keydown", teclas, true);
			if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
			if (previo && previo.focus) { try { previo.focus(); } catch (_) { /* sin foco */ } }
			alListo(valor);
		}
		function teclas(e) {
			if (e.key === "Escape") { e.stopPropagation(); cerrar(null); return; }
			if (e.key !== "Tab") return;
			var lista = Array.prototype.slice.call(caja.querySelectorAll("button, input")).filter(function (x) { return !x.disabled; });
			if (!lista.length) return;
			var primero = lista[0], ultimo = lista[lista.length - 1];
			if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
			else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
		}
		document.addEventListener("keydown", teclas, true);
		fondo.addEventListener("click", function (e) { if (e.target === fondo) cerrar(null); });
		var primerBoton = fondo.querySelector("button, input");
		setTimeout(function () { if (primerBoton && primerBoton.focus) primerBoton.focus(); }, 0);
		return { fondo: fondo, cerrar: cerrar };
	}

	function preguntar(op) {
		op = op || {};
		return new Promise(function (resolver) {
			var botones = (op.botones || []).map(function (b, i) {
				return "<button type='button' data-paso-valor='" + esc(b.valor) + "' class='min-h-[44px] px-5 rounded-xl font-semibold " +
					(b.primario ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-gray-300 text-gray-700 hover:bg-gray-50") + "'>" + esc(b.etiqueta) + "</button>";
			}).join("");
			var d = dialogo(op, "",
				"<button type='button' data-paso-cancelar class='min-h-[44px] px-5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50'>" + esc(op.cancelar || "Volver") + "</button>" + botones,
				resolver);
			d.fondo.addEventListener("click", function (e) {
				var b = e.target.closest ? e.target.closest("button") : null;
				if (!b) return;
				if (b.hasAttribute("data-paso-cancelar")) d.cerrar(null);
				else if (b.hasAttribute("data-paso-valor")) d.cerrar(b.getAttribute("data-paso-valor"));
			});
		});
	}

	function elegirActividades(op) {
		op = op || {};
		return new Promise(function (resolver) {
			var items = op.items || [];
			var lista = items.length ? items.map(function (it, i) {
				return "<label class='flex items-start gap-3 min-h-[44px] py-2 text-sm text-gray-700'>" +
					"<input type='checkbox' data-paso-item='" + esc(it.id) + "' class='mt-0.5 h-5 w-5 shrink-0'" + (it.marcado || it.fijo ? " checked" : "") + (it.fijo ? " disabled" : "") + ">" +
					"<span class='min-w-0 break-words'>" + esc(it.etiqueta) + (it.fijo ? " <span class='text-xs text-gray-400'>· ya se trabajó hoy</span>" : "") + "</span></label>";
			}).join("") : "<p class='text-sm text-gray-500'>" + esc(op.vacio || "No hay actividades por trabajar.") + "</p>";
			var d = dialogo(op, "<div class='p-5 flex flex-col' data-paso-lista>" + lista + "</div>",
				"<button type='button' data-paso-cancelar class='min-h-[44px] px-5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50'>" + esc(op.cancelar || "Volver") + "</button>" +
				"<button type='button' data-paso-aceptar class='min-h-[44px] px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700'>" + esc(op.aceptar || "Aceptar") + "</button>",
				resolver);
			d.fondo.addEventListener("click", function (e) {
				var b = e.target.closest ? e.target.closest("button") : null;
				if (!b) return;
				if (b.hasAttribute("data-paso-cancelar")) d.cerrar(null);
				else if (b.hasAttribute("data-paso-aceptar")) {
					var marcados = Array.prototype.slice.call(d.fondo.querySelectorAll("input[data-paso-item]"))
						.filter(function (c) { return c.checked && !c.disabled; }).map(function (c) { return c.getAttribute("data-paso-item"); });
					d.cerrar(marcados);
				}
			});
		});
	}

	/*
		terminar(sb, { sesionId, notas, proyectoId, maestroId, hoy, dia }) → { proyectoCompletado }
		Marca la sesión completada (con sus notas y terminada_en = dia, o hoy), les pone ese día a las actividades
		activas que no son tarea y siguen sin día (fecha_trabajo) y deja ese día cerrado en sesion_dias (mi_salon_b27).
		Si a ESE proyecto ya no le queda ninguna sin terminar, lo da por completado (los demás proyectos activos no se
		tocan). Lanza el error. El orden importa poco a propósito: una actividad sin día en una sesión terminada se lee
		como terminada_en, así que un corte entre pasos deja lo mismo que si se hubieran escrito.
	*/
	// La lectura común (js/lectura.js: lanza el error); sin ella (pruebas en node), una equivalente
	var Lectura = (typeof window !== "undefined" && window.Lectura) || {
		contar: async function (consulta) {
			var r = await consulta;
			if (r.error) throw r.error;
			return r.count || 0;
		},
	};
	async function terminar(sb, d) {
		var diaFin = dia(d.dia || d.hoy) || null;
		var r = await sb.from("sesiones")
			.update({ estado_sesion: "completada", notas_cierre: d.notas || null, terminada_en: diaFin })
			.eq("id", d.sesionId).eq("maestro_id", d.maestroId);
		if (r.error) throw r.error;
		if (diaFin) {
			var a = await sb.from("productos_sesion").update({ fecha_trabajo: diaFin })
				.eq("sesion_id", d.sesionId).eq("maestro_id", d.maestroId).eq("activo", true).neq("tipo", "tarea").is("fecha_trabajo", null);
			if (a.error) throw a.error;
			var b = await sb.from("sesion_dias")
				.upsert({ sesion_id: d.sesionId, maestro_id: d.maestroId, fecha: diaFin, cerrado_en: new Date().toISOString() }, { onConflict: "sesion_id,fecha" });
			if (b.error) throw b.error;
		}
		var consulta = sb.from("sesiones").select("id", { count: "exact", head: true })
			// Las anteriores al corte cuentan como terminadas (Fanny nunca les dio "Terminar": siguen `activa`);
			// sin esto el proyecto no pasaría a completado al terminar la última. No se escribe nada en esas filas.
			.eq("proyecto_id", d.proyectoId).neq("estado_sesion", "completada")
			.or("fecha.is.null,fecha.gte." + dia(d.corte || CORTE_EN_CURSO));
		var quedan = await Lectura.contar(consulta);
		var completado = quedan === 0;
		if (completado) {
			var p = await sb.from("proyectos").update({ estado: "completado", fecha_final: d.hoy }).eq("id", d.proyectoId);
			if (p.error) throw p.error;
		}
		return { proyectoCompletado: completado };
	}

	var api = {
		CORTE_EN_CURSO: CORTE_EN_CURSO, enCurso: enCurso, enCursoDe: enCursoDe, bloqueaSiguiente: bloqueaSiguiente,
		etiquetaEmpezo: etiquetaEmpezo, etiquetaDia: etiquetaDia, preguntaDia: preguntaDia, preguntar: preguntar, elegirActividades: elegirActividades, textoSinCalificar: textoSinCalificar, abrirModal: abrirModal, terminar: terminar,
	};
	if (typeof window !== "undefined") window.SesionTerminar = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
