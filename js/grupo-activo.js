/*
	grupo-activo.js — Único lugar que decide con qué grupo trabaja el maestro.

	Antes cada pantalla tomaba "el primer grupo" a su manera, y varias con .single(),
	que truena en cuanto el maestro tiene dos grupos (Reportes lo mandaba al onboarding).
	Ahora todas preguntan aquí:

		const { grupo, grupos } = await window.GrupoActivo.cargar(window.sb, userId);

	- El grupo elegido se recuerda en localStorage ("grupoActivo" = {id}), la misma
	  clave que ya leían dashboard.js y crear_proyecto.js.
	- Si el guardado ya no existe (se borró, o es de otra cuenta), se usa el primero
	  por fecha de creación.
	- Con dos o más grupos, el menú de la barra de navegación muestra el selector.
	  Cambiar de grupo recarga la pantalla para que todo lea del grupo nuevo.
*/

(function () {
	"use strict";

	var CLAVE = "grupoActivo";

	function leerGuardado() {
		try {
			var raw = window.localStorage.getItem(CLAVE) || window.localStorage.getItem("grupo_activo");
			if (!raw) return null;
			var v = JSON.parse(raw);
			return (v && (v.id || v.grupo_id)) || null;
		} catch (e) {
			return null;
		}
	}

	function guardar(id) {
		try { window.localStorage.setItem(CLAVE, JSON.stringify({ id: id })); } catch (e) {}
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/*
		cargar(sb, maestroId) → { grupo, grupos }
		grupo = null si el maestro todavía no tiene ninguno (la pantalla decide: onboarding).
		Se consulta una sola vez por página: el selector de la barra y la pantalla
		comparten la misma respuesta.
	*/
	var enCurso = null, enCursoMaestro = null;
	function cargar(sb, maestroId) {
		if (enCurso && enCursoMaestro === maestroId) return enCurso;
		enCursoMaestro = maestroId;
		enCurso = consultar(sb, maestroId);
		enCurso.catch(function () { enCurso = null; }); // si falla, el siguiente intento vuelve a consultar
		return enCurso;
	}

	async function consultar(sb, maestroId) {
		var res = await sb.from("grupos").select("*")
			.eq("maestro_id", maestroId)
			.order("created_at", { ascending: true });
		if (res.error) throw res.error;
		var grupos = res.data || [];
		var guardado = leerGuardado();
		var grupo = null;
		for (var i = 0; i < grupos.length; i++) {
			if (grupos[i].id === guardado) { grupo = grupos[i]; break; }
		}
		if (!grupo) grupo = grupos[0] || null;
		if (grupo) guardar(grupo.id);
		pintarSelector(grupos, grupo);
		return { grupo: grupo, grupos: grupos };
	}

	function cambiar(id) {
		guardar(id);
		window.location.reload();
	}

	// Selector dentro del menú de la barra (solo si hay 2 o más grupos)
	function pintarSelector(grupos, activo) {
		var slot = document.getElementById("navGrupoSlot");
		if (!slot || grupos.length < 2) return;
		slot.innerHTML =
			"<p class='px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400'>Grupo</p>" +
			grupos.map(function (g) {
				var esActivo = activo && g.id === activo.id;
				return "<button type='button' data-grupo-activo='" + esc(g.id) + "' " +
					"class='block w-full text-left px-3 py-2 min-h-[44px] rounded-md text-sm font-medium " +
					(esActivo ? "text-blue-700 bg-blue-50" : "text-gray-800 hover:bg-gray-100") + "'" +
					(esActivo ? " aria-current='true'" : "") + ">" + esc(g.nombre || "Grupo") + "</button>";
			}).join("") +
			"<div class='my-1 border-t border-gray-100'></div>";
		slot.classList.remove("hidden");
		slot.onclick = function (e) {
			var btn = e.target.closest ? e.target.closest("button[data-grupo-activo]") : null;
			if (!btn || (activo && btn.dataset.grupoActivo === activo.id)) return;
			cambiar(btn.dataset.grupoActivo);
		};

		// El nombre del grupo activo, visible sin abrir el menú
		var chip = document.getElementById("navGrupoActivo");
		if (chip && activo) {
			chip.textContent = activo.nombre || "Grupo";
			chip.classList.remove("hidden");
		}
	}

	window.GrupoActivo = { cargar: cargar, cambiar: cambiar, leerGuardado: leerGuardado };

	// En pantallas que no usan el grupo (Ajustes, Mi cuenta…) el selector de la barra
	// también debe aparecer: se carga solo, con la misma consulta compartida.
	document.addEventListener("DOMContentLoaded", function () {
		if (!window.sb || !window.sb.auth) return;
		window.sb.auth.getSession().then(function (res) {
			var sesion = res && res.data ? res.data.session : null;
			if (sesion) cargar(window.sb, sesion.user.id).catch(function () {});
		}).catch(function () {});
	});
})();
