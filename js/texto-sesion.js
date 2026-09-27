/*
	texto-sesion.js — Cómo se leen y se rotulan las llaves de lo diferenciado de una sesión:
	*_diferenciado (texto por fase), *_actividades.diferenciado y cierre_tareas.diferenciado.
	Lo usan Inicio (js/dashboard.js), Actividades (js/actividades.js) y Crear proyecto.

	Formato (docs/CONTEXTO.md §4, "Grupos de trabajo", 2026-09-27):
	  - Llave de GRADO: "1" a "6" → se rotula "Grado 1" (texto de la fase) o "1°" (actividades,
	    tareas). Es la de siempre y la única que materializa productos (tareas por grado).
	  - Llave de GRUPO DE TRABAJO: cualquier otra ("Morado", "Círculos", "Morado y Naranja")
	    → se rotula tal cual ("Morado: …"). Antes salía "Grado Morado:" y "Morado°:".
	  - *_actividades puede traer "mode": "todos" con pasos para todo el grupo (todos) Y pasos
	    por grupo de trabajo (diferenciado con llaves de grupo): se leen los de todo el grupo y
	    después los de cada grupo.
	  - Orden: primero los grados de menor a mayor; después los grupos en el orden de
	    `orden_grupos` (arreglo opcional junto a diferenciado; jsonb no guarda el orden de las
	    llaves) y los que no estén ahí, en orden alfabético.

	Expone window.TextoSesion (y module.exports para las pruebas):
	  esLlaveGrado(k) · rotulo(k, "texto"|"corto") · llavesEnOrden(obj, orden)
	  lineas(obj, orden, forma, aTexto) → ["Grado 1: …", "Morado: …"]
	  gruposDe(raw) → [{ llave, items }] solo las llaves de grupo, en orden
	  lineasActividades(raw, aTexto) → los pasos de todo el grupo y luego "1°: …" / "Morado: …"
*/

(function () {
	"use strict";

	function esLlaveGrado(k) {
		return /^[1-6]$/.test(String(k === null || k === undefined ? "" : k).trim());
	}

	function rotulo(k, forma) {
		var s = String(k === null || k === undefined ? "" : k).trim();
		if (!esLlaveGrado(s)) return s;
		return forma === "texto" ? "Grado " + s : s + "°";
	}

	function llavesEnOrden(obj, orden) {
		if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
		var llaves = Object.keys(obj);
		var grados = llaves.filter(esLlaveGrado).sort(function (a, b) { return Number(a) - Number(b); });
		var grupos = llaves.filter(function (k) { return !esLlaveGrado(k); });
		var primero = (Array.isArray(orden) ? orden : []).map(String).filter(function (k) { return grupos.indexOf(k) !== -1; });
		var resto = grupos.filter(function (k) { return primero.indexOf(k) === -1; })
			.sort(function (a, b) { return a.localeCompare(b, "es", { sensitivity: "base" }); });
		return grados.concat(primero.filter(function (k, i) { return primero.indexOf(k) === i; }), resto);
	}

	// Texto legible de una actividad guardada como texto, objeto o lista; nunca JSON crudo
	function textoPlano(x) {
		if (x === null || x === undefined) return "";
		if (typeof x === "string") return x.trim();
		if (Array.isArray(x)) return x.map(textoPlano).filter(Boolean).join("; ");
		if (typeof x === "object") return textoPlano(x.descripcion || x.texto || x.actividad || x.nombre || "");
		return String(x);
	}

	function comoLista(v) {
		if (v === null || v === undefined) return [];
		return Array.isArray(v) ? v : [v];
	}

	// Una línea por llave (texto de la fase): "Grado 1: Dibuja" · "Morado: Colorea"
	function lineas(obj, orden, forma, aTexto) {
		var t = aTexto || textoPlano;
		return llavesEnOrden(obj, orden).map(function (k) {
			var texto = t(obj[k]);
			return texto ? rotulo(k, forma) + ": " + texto : "";
		}).filter(Boolean);
	}

	// Solo los grupos de trabajo de un *_actividades (lo que Crear proyecto muestra aparte)
	function gruposDe(raw) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
		var dif = raw.diferenciado || raw.por_grado;
		if (!dif || typeof dif !== "object") return [];
		return llavesEnOrden(dif, raw.orden_grupos).filter(function (k) { return !esLlaveGrado(k); }).map(function (k) {
			return { llave: k, items: comoLista(dif[k]).map(textoPlano).filter(Boolean) };
		});
	}

	// Los pasos de un *_actividades: los de todo el grupo y luego los de cada grado o grupo
	function lineasActividades(raw, aTexto) {
		var t = aTexto || textoPlano;
		if (!raw) return [];
		if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
		if (Array.isArray(raw)) return raw.map(t).filter(Boolean);
		if (typeof raw !== "object") return [];
		if (!("mode" in raw || "todos" in raw || "diferenciado" in raw || "por_grado" in raw)) {
			return Object.keys(raw).map(function (k) { return t(raw[k]); }).filter(Boolean);
		}
		var out = comoLista(raw.todos).map(t).filter(Boolean);
		var dif = raw.diferenciado || raw.por_grado;
		if (dif && typeof dif === "object") {
			llavesEnOrden(dif, raw.orden_grupos).forEach(function (k) {
				comoLista(dif[k]).map(t).filter(Boolean).forEach(function (x) { out.push(rotulo(k, "corto") + ": " + x); });
			});
		}
		return out;
	}

	var api = {
		esLlaveGrado: esLlaveGrado, rotulo: rotulo, llavesEnOrden: llavesEnOrden, textoPlano: textoPlano,
		lineas: lineas, gruposDe: gruposDe, lineasActividades: lineasActividades,
	};
	if (typeof window !== "undefined") window.TextoSesion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
