/*
	pasar-a-proyecto.js — "Pasar a un proyecto" una actividad o tarea suelta (decisión de Jorge del
	2026-09-26: guiar sin obligar; lo que se hizo sin proyecto se puede acomodar después).

	Mueve el producto, con sus calificaciones, su "para quién" y sus PDA, a una sesión de un proyecto
	del MISMO grupo y trimestre (sus calificaciones siguen en la misma boleta). Lo hace la función
	mover_producto_a_sesion de la base (supabase/mi_salon_b17_flujo_libre_2026-09.sql), en una
	transacción: no se pierde nada. Lo usan Hoy (js/hoy.js) y Proyectos (js/planeacion.js).

	Arriba, reglas puras (pruebas/flujo-libre.test.js); abajo, el diálogo.
		PasarAProyecto.abrir({ sb, maestroId, grupoId, trimestre, producto, fechaEntrega, origen, alTerminar })
		  producto: { id, nombre, tipo }; fechaEntrega: en una tarea sin fecha de entrega, el día en
		  que se revisaba (se conserva al moverla); alTerminar(): tras mover (la pantalla recarga)
*/
(function () {
	"use strict";

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// "2026-09-29" → "29 sep"
	function fechaCorta(iso) {
		var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return "";
		return Number(m[3]) + " " + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m[2]) - 1];
	}

	/*
		destinos(proyectos, sesiones, trimestre) → [{ proyecto, sesiones: [...] }]
		Solo proyectos normales (no el contenedor de sueltas) del trimestre, con al menos una sesión;
		los activos primero, luego por título; sesiones por número.
	*/
	var ORDEN_ESTADO = { activo: 0, pausado: 1, borrador: 2, completado: 3 };
	function destinos(proyectos, sesiones, trimestre) {
		var porProyecto = {};
		(sesiones || []).forEach(function (s) { if (s && s.proyecto_id) (porProyecto[s.proyecto_id] = porProyecto[s.proyecto_id] || []).push(s); });
		return (proyectos || []).filter(function (p) {
			return p && p.tipo !== "sueltas" && (!trimestre || Number(p.trimestre) === Number(trimestre)) && (porProyecto[p.id] || []).length;
		}).sort(function (a, b) {
			var oa = a.estado in ORDEN_ESTADO ? ORDEN_ESTADO[a.estado] : 9, ob = b.estado in ORDEN_ESTADO ? ORDEN_ESTADO[b.estado] : 9;
			return (oa - ob) ||
				String(a.titulo || "").localeCompare(String(b.titulo || ""), "es", { sensitivity: "base" });
		}).map(function (p) {
			return { proyecto: p, sesiones: porProyecto[p.id].slice().sort(function (a, b) { return (Number(a.numero_sesion) || 0) - (Number(b.numero_sesion) || 0); }) };
		});
	}

	// "Sesión 3 · Lenguajes · 25 sep" (o "sin fecha")
	function etiquetaSesion(s) {
		return "Sesión " + (s.numero_sesion || "") + (s.campo_formativo ? " · " + s.campo_formativo : "") +
			" · " + (s.fecha ? fechaCorta(s.fecha) : "sin fecha");
	}

	// ── Diálogo ──────────────────────────────────────────────────────────────────
	async function leer(sb, maestroId, grupoId) {
		var pr = await sb.from("proyectos").select("id, titulo, estado, trimestre, tipo")
			.eq("maestro_id", maestroId).eq("grupo_id", grupoId).order("created_at");
		if (pr.error) throw pr.error;
		var proyectos = (pr.data || []).filter(function (p) { return p.tipo !== "sueltas"; });
		var ids = proyectos.map(function (p) { return p.id; });
		var sesiones = [];
		if (ids.length) {
			// Sin el tope de 1000 filas (js/alcance-hoy.js)
			sesiones = await window.AlcanceHoy.leerPorLotes(ids, function (lote) {
				return sb.from("sesiones").select("id, proyecto_id, numero_sesion, campo_formativo, fecha").in("proyecto_id", lote).order("id");
			});
		}
		return { proyectos: proyectos, sesiones: sesiones };
	}

	function boton(texto, clases) {
		var b = document.createElement("button");
		b.type = "button";
		b.className = "min-h-[44px] px-5 rounded-xl font-semibold " + clases;
		b.textContent = texto;
		return b;
	}

	function abrir(o) {
		var previo = o.origen || document.activeElement;
		var fondo = document.createElement("div");
		fondo.className = "fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4";
		var caja = document.createElement("div");
		caja.setAttribute("role", "dialog");
		caja.setAttribute("aria-modal", "true");
		caja.setAttribute("aria-labelledby", "pasarTitulo");
		caja.className = "bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto";
		caja.innerHTML =
			"<div class='p-5 border-b border-gray-100'><h2 id='pasarTitulo' class='text-lg font-bold text-gray-800'>Pasar a un proyecto</h2>" +
			"<p class='text-sm text-gray-500 mt-1'>«" + esc(o.producto && o.producto.nombre) + "» se mueve con sus calificaciones, para quién es y sus PDA. " +
			"Solo a proyectos del mismo trimestre: sus calificaciones siguen en la misma boleta.</p></div>" +
			"<div class='p-5 flex flex-col gap-4' data-cuerpo><p class='text-sm text-gray-500'>Cargando tus proyectos...</p></div>" +
			"<p role='alert' data-aviso class='hidden mx-5 mb-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2'></p>" +
			"<div class='p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2' data-pie></div>";
		fondo.appendChild(caja);
		var cuerpo = caja.querySelector("[data-cuerpo]"), aviso = caja.querySelector("[data-aviso]"), pie = caja.querySelector("[data-pie]");
		var cancelar = boton("Cancelar", "border border-gray-300 text-gray-700 font-medium hover:bg-gray-50");
		var aceptar = boton("Pasar", "text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60");
		aceptar.disabled = true;
		pie.appendChild(cancelar);
		pie.appendChild(aceptar);

		function avisar(t) { aviso.textContent = t || ""; aviso.classList.toggle("hidden", !t); }
		function cerrar() {
			document.removeEventListener("keydown", teclas, true);
			if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
			if (previo && previo.focus && document.body.contains(previo)) previo.focus();
		}
		function teclas(e) {
			if (e.key === "Escape") { e.preventDefault(); cerrar(); return; }
			if (e.key !== "Tab") return;
			var lista = Array.from(caja.querySelectorAll("select, button")).filter(function (el) { return !el.disabled; });
			if (!lista.length) return;
			var primero = lista[0], ultimo = lista[lista.length - 1];
			if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
			else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
		}
		cancelar.addEventListener("click", cerrar);
		fondo.addEventListener("click", function (e) { if (e.target === fondo) cerrar(); });
		document.addEventListener("keydown", teclas, true);
		document.body.appendChild(fondo);
		cancelar.focus();

		var opciones = [];
		var selProy = null, selSes = null;
		function pintarSesiones() {
			var g = opciones[Number(selProy.value)];
			selSes.innerHTML = g ? g.sesiones.map(function (s) { return "<option value='" + esc(s.id) + "'>" + esc(etiquetaSesion(s)) + "</option>"; }).join("") : "";
		}
		leer(o.sb, o.maestroId, o.grupoId).then(function (d) {
			opciones = destinos(d.proyectos, d.sesiones, o.trimestre);
			if (!opciones.length) {
				cuerpo.innerHTML = "<p class='text-sm text-gray-700'>No tienes proyectos con sesiones en este trimestre. Crea o importa uno en Proyectos y vuelve a intentarlo.</p>";
				return;
			}
			var clase = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base text-gray-800 bg-white";
			cuerpo.innerHTML =
				"<label class='flex flex-col gap-1 text-sm font-medium text-gray-700'>Proyecto<select data-proyecto class='" + clase + "'>" +
				opciones.map(function (g, i) { return "<option value='" + i + "'>" + esc(g.proyecto.titulo || "Proyecto sin título") + "</option>"; }).join("") +
				"</select></label>" +
				"<label class='flex flex-col gap-1 text-sm font-medium text-gray-700'>Sesión<select data-sesion class='" + clase + "'></select></label>";
			selProy = cuerpo.querySelector("[data-proyecto]");
			selSes = cuerpo.querySelector("[data-sesion]");
			selProy.addEventListener("change", pintarSesiones);
			pintarSesiones();
			aceptar.disabled = false;
			selProy.focus();
		}).catch(function (err) {
			console.error("pasar a un proyecto: lectura", err);
			cuerpo.innerHTML = "<p class='text-sm text-red-700'>No se pudieron cargar tus proyectos. Revisa la señal e inténtalo de nuevo.</p>";
		});

		aceptar.addEventListener("click", async function () {
			if (!selSes || !selSes.value) return;
			avisar("");
			aceptar.disabled = true;
			aceptar.textContent = "Pasando...";
			try {
				var res = await o.sb.rpc("mover_producto_a_sesion", { p_producto: o.producto.id, p_sesion: selSes.value, p_fecha_entrega: o.fechaEntrega || null });
				if (res.error) throw res.error;
				cerrar();
				if (o.alTerminar) o.alTerminar(res.data);
			} catch (err) {
				console.error("pasar a un proyecto", err);
				avisar((typeof navigator !== "undefined" && navigator.onLine === false)
					? "Esto necesita señal. Inténtalo cuando vuelva."
					: "No se pudo pasar: " + ((err && err.message) || "error desconocido") + ".");
				aceptar.disabled = false;
				aceptar.textContent = "Pasar";
			}
		});
	}

	var api = { destinos: destinos, etiquetaSesion: etiquetaSesion, abrir: abrir };
	if (typeof window !== "undefined") window.PasarAProyecto = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
