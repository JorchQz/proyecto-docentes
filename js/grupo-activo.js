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
	- La navegación (js/navbar.js) muestra siempre el grupo activo; con dos o más grupos
	  es un selector. Cambiar de grupo recarga la pantalla para que todo lea del grupo nuevo.
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
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	/*
		cargar(sb, maestroId) → { grupo, grupos }
		grupo = null si el maestro todavía no tiene ninguno (la pantalla decide: onboarding).
		Se consulta una sola vez por página: el selector de la barra y la pantalla
		comparten la misma respuesta.

		Si la lectura FALLA, la pantalla no recibe nada: aquí mismo se detiene la página con
		el aviso común (js/lectura.js) y la promesa no se cumple nunca. Antes cada pantalla
		lo manejaba a su manera y varias seguían sin grupo: mostraban los proyectos de todos
		los grupos, decían "crea tu grupo" o lanzaban una excepción sin atrapar. Así ninguna
		pantalla tiene que acordarse: la que espera el grupo simplemente no sigue.
	*/
	var enCurso = null, enCursoMaestro = null;
	var elegido = null; // grupo elegido en esta página (elegir): ninguna lectura lo pisa
	function compartida(sb, maestroId) {
		if (enCurso && enCursoMaestro === maestroId) return enCurso;
		enCursoMaestro = maestroId;
		enCurso = consultar(sb, maestroId);
		enCurso.catch(function () { enCurso = null; }); // si falla, el siguiente intento vuelve a consultar
		return enCurso;
	}

	function cargar(sb, maestroId) {
		return compartida(sb, maestroId).then(null, function (error) {
			// Sin la capa común (una página que no la carga) se conserva el comportamiento
			// anterior: el error le llega a la pantalla
			if (!window.Lectura) throw error;
			window.Lectura.detenerPagina(error);
			return new Promise(function () {});
		});
	}

	async function consultar(sb, maestroId) {
		var res = await sb.from("grupos").select("*")
			.eq("maestro_id", maestroId)
			.order("created_at", { ascending: true })
			// Desempate estable: dos grupos creados en el mismo instante no cambian de orden
			.order("nombre", { ascending: true }).order("id", { ascending: true });
		if (res.error) throw window.Lectura ? window.Lectura.errorDeLectura(res.error) : res.error;
		var grupos = res.data || [];
		var guardado = leerGuardado();
		var grupo = null;
		for (var i = 0; i < grupos.length; i++) {
			if (grupos[i].id === guardado) { grupo = grupos[i]; break; }
		}
		if (!grupo) grupo = grupos[0] || null;
		// Si en esta página se eligió un grupo (onboarding recién lo creó), una lectura
		// que empezó antes no lo pisa con el que estaba
		if (grupo && !elegido) guardar(grupo.id);
		pintarSelector(grupos, grupo);
		return { grupo: grupo, grupos: grupos };
	}

	function cambiar(id) {
		guardar(id);
		window.location.reload();
	}

	/*
		Grupo activo en la navegación (js/navbar.js pone los lugares [data-grupo-slot]: la
		barra lateral en PC y el encabezado en celular). Siempre se ve en qué grupo se
		trabaja; con 2 o más grupos es un selector, y elegir otro recarga la pantalla.
	*/
	var FLECHA = "<svg class='jz-grupo-flecha' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='m6 9 6 6 6-6'/></svg>";
	function pintarSelector(grupos, activo) {
		var slots = document.querySelectorAll ? document.querySelectorAll("[data-grupo-slot]") : [];
		if (!activo) return;
		pintado = { grupos: grupos, activo: activo };
		var nombre = activo.nombre || "Grupo";
		Array.prototype.forEach.call(slots, function (slot, i) {
			var id = "jzGrupoSel" + i;
			if (grupos.length < 2) {
				slot.innerHTML = "<span class='jz-grupo-etq'>Grupo</span>" +
					"<span class='jz-grupo-nombre' tabindex='-1' title='" + esc(nombre) + "'>" + esc(nombre) + "</span>";
				return;
			}
			slot.innerHTML = "<label class='jz-grupo-etq' for='" + id + "'>Grupo</label>" +
				"<div class='jz-grupo-control'><select id='" + id + "' class='jz-grupo-select' aria-label='Grupo activo'>" +
				grupos.map(function (g) {
					return "<option value='" + esc(g.id) + "'" + (g.id === activo.id ? " selected" : "") + ">" + esc(g.nombre || "Grupo") + "</option>";
				}).join("") +
				"</select>" + FLECHA + "</div>";
			var sel = slot.querySelector("select");
			sel.addEventListener("change", function () {
				if (sel.value && sel.value !== activo.id) cambiar(sel.value);
			});
		});
		try {
			document.dispatchEvent(new CustomEvent("jissez:grupo-activo", { detail: { id: activo.id, nombre: nombre, total: grupos.length } }));
		} catch (_) {}
	}

	/*
		elegir(id): deja ese grupo como activo sin recargar. Lo usa el onboarding al crear
		un grupo: la maestra que da de alta su segundo grupo llega a Inicio con ese grupo,
		no con el anterior.
	*/
	function elegir(id) {
		if (!id) return;
		elegido = id;
		enCurso = null;
		guardar(id);
	}

	/*
		trasEliminar(sb, maestroId, idEliminado) → el grupo con el que se sigue trabajando después de
		eliminar uno, o null si ya no queda ninguno (tras R20: Mi grupo mandaba al onboarding aunque
		la maestra tuviera otro grupo). Si el eliminado era el activo, queda activo el guardado si
		sigue existiendo o, si no, el primero por fecha de creación (la misma regla que cargar).
		Sin grupos, se olvida el guardado. Si la lectura falla, LANZA: quien llama decide.
	*/
	async function trasEliminar(sb, maestroId, idEliminado) {
		var res = await sb.from("grupos").select("id, nombre")
			.eq("maestro_id", maestroId)
			.neq("id", idEliminado)
			.order("created_at", { ascending: true })
			.order("nombre", { ascending: true }).order("id", { ascending: true });
		if (res.error) throw res.error;
		var grupos = res.data || [];
		var guardado = leerGuardado();
		var sigue = null;
		for (var i = 0; i < grupos.length; i++) if (grupos[i].id === guardado) { sigue = grupos[i]; break; }
		if (!sigue) sigue = grupos[0] || null;
		enCurso = null;
		elegido = sigue ? sigue.id : null;
		if (sigue) guardar(sigue.id);
		else { try { window.localStorage.removeItem(CLAVE); window.localStorage.removeItem("grupo_activo"); } catch (e) {} }
		return sigue;
	}

	// Si la lectura llegó antes que la navegación, ésta lo vuelve a pintar al montarse
	var pintado = null;
	function repintar() {
		if (pintado) pintarSelector(pintado.grupos, pintado.activo);
	}

	window.GrupoActivo = { cargar: cargar, cambiar: cambiar, elegir: elegir, trasEliminar: trasEliminar, leerGuardado: leerGuardado, repintar: repintar };

	// En pantallas que no usan el grupo (Ajustes, Mi cuenta…) el selector de la barra
	// también debe aparecer: se carga solo, con la misma consulta compartida. Si esta
	// lectura falla no se detiene la página (Ajustes no necesita el grupo): solo falta el
	// selector. La pantalla que sí lo necesita llama a cargar() y ahí se detiene.
	document.addEventListener("DOMContentLoaded", function () {
		if (!window.sb || !window.sb.auth) return;
		window.sb.auth.getSession().then(function (res) {
			var sesion = res && res.data ? res.data.session : null;
			// lectura-opcional: solo el selector de grupo de la barra; la pantalla hace su propia llamada
			if (sesion) compartida(window.sb, sesion.user.id).catch(function () {});
		}).catch(function () {});
	});
})();
