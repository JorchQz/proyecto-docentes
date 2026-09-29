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
	  - La sesión que se continúa otro día conserva su fecha de inicio: sus tareas vencen contando desde
	    ese día y el día que solo se continúa su campo no recibe participación (el motor no cambia).

	Expone window.SesionTerminar (y module.exports para las pruebas):
	  CORTE_EN_CURSO, enCurso(sesion, corte), enCursoDe(sesiones, proyectoId, corte),
	  bloqueaSiguiente(sesiones, proyectoId, corte), etiquetaEmpezo(fecha, hoy), textoSinCalificar(n),
	  abrirModal(opciones), terminar(sb, datos)
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
		abrirModal({ titulo, sinCalificar, etiquetaBoton, origen, alConfirmar })
		Diálogo accesible (role="dialog", foco dentro, Esc cierra y el foco vuelve a `origen`).
		alConfirmar(notas) es asíncrona: si lanza, el diálogo sigue abierto y dice el error. Devuelve
		{ cerrar }.
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
			"<div class='p-5'><label for='" + id + "-n' class='block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2'>Notas (opcional)</label>" +
			"<textarea id='" + id + "-n' rows='3' class='w-full border border-gray-300 rounded-xl p-3 text-sm min-h-[72px] resize-none' placeholder='¿Algo diferente a lo planeado?'></textarea>" +
			"<p id='" + id + "-e' class='hidden mt-3 text-sm text-red-700' role='alert'></p></div>" +
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
		function teclas(e) {
			if (e.key === "Escape" && !ocupado) { e.stopPropagation(); cerrar(); return; }
			if (e.key !== "Tab") return;
			var lista = Array.prototype.slice.call(caja.querySelectorAll("button, textarea")).filter(function (x) { return !x.disabled; });
			if (!lista.length) return;
			var primero = lista[0], ultimo = lista[lista.length - 1];
			if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
			else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
		}
		document.addEventListener("keydown", teclas, true);
		btnNo.addEventListener("click", function () { if (!ocupado) cerrar(); });
		fondo.addEventListener("click", function (e) { if (e.target === fondo && !ocupado) cerrar(); });
		btnOk.addEventListener("click", async function () {
			if (ocupado) return;
			ocupado = true;
			btnOk.disabled = true;
			btnNo.disabled = true;
			var etiqueta = btnOk.textContent;
			btnOk.textContent = "Terminando...";
			error.classList.add("hidden");
			try {
				await op.alConfirmar(area.value.trim());
			} catch (e) {
				error.textContent = (e && e.message) ? e.message : "No se pudo terminar la sesión.";
				error.classList.remove("hidden");
				ocupado = false;
				btnOk.disabled = false;
				btnNo.disabled = false;
				btnOk.textContent = etiqueta;
			}
		});
		setTimeout(function () { if (area && area.focus) area.focus(); }, 0);
		return { cerrar: cerrar };
	}

	/*
		terminar(sb, { sesionId, notas, proyectoId, maestroId, hoy }) → { proyectoCompletado }
		Marca la sesión completada (con sus notas) y, si a ESE proyecto ya no le queda ninguna sin
		terminar, lo da por completado (los demás proyectos activos no se tocan). Lanza el error.
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
		var r = await sb.from("sesiones")
			.update({ estado_sesion: "completada", notas_cierre: d.notas || null })
			.eq("id", d.sesionId).eq("maestro_id", d.maestroId);
		if (r.error) throw r.error;
		var consulta = sb.from("sesiones").select("id", { count: "exact", head: true })
			.eq("proyecto_id", d.proyectoId).neq("estado_sesion", "completada");
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
		etiquetaEmpezo: etiquetaEmpezo, textoSinCalificar: textoSinCalificar, abrirModal: abrirModal, terminar: terminar,
	};
	if (typeof window !== "undefined") window.SesionTerminar = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
