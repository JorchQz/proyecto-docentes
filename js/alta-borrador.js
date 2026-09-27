/*
	alta-borrador.js — Borrador del alta (onboarding) en este aparato.

	Decisión de Jorge del 2026-09-26: si la maestra cierra la pestaña a media captura, no
	pierde la lista de alumnos. El onboarding guarda aquí (localStorage, por cuenta) el grupo
	que ya creó y los alumnos que lleva; al volver se le ofrece continuar (el onboarding y,
	si ya tiene grupo sin alumnos, Inicio). Se borra al completar el alta.

	Todo acceso va en try/catch: sin almacenamiento (modo privado, bloqueado) el alta funciona
	igual, solo sin borrador. Nunca se guarda nada que no sea el nombre y el grado.
*/

(function () {
	"use strict";

	var VERSION = 1;
	var DIAS_VIGENCIA = 60;

	function clave(maestroId) { return "jissez.alta.borrador." + String(maestroId || ""); }

	function almacen() {
		try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; }
	}

	// datos: { grupoId, grupo: {campos del formulario}, alumnos: [{ nombre_completo, grado }] }
	function guardar(maestroId, datos) {
		var ls = almacen();
		if (!ls || !maestroId) return false;
		try {
			var alumnos = ((datos && datos.alumnos) || []).map(function (a) {
				return { nombre_completo: String(a.nombre_completo || ""), grado: typeof a.grado === "number" ? a.grado : null };
			}).filter(function (a) { return a.nombre_completo; });
			ls.setItem(clave(maestroId), JSON.stringify({
				v: VERSION,
				guardado: new Date().toISOString(),
				grupoId: (datos && datos.grupoId) || null,
				grupo: (datos && datos.grupo) || null,
				alumnos: alumnos,
			}));
			return true;
		} catch (_) { return false; }
	}

	function leer(maestroId, ahora) {
		var ls = almacen();
		if (!ls || !maestroId) return null;
		try {
			var raw = ls.getItem(clave(maestroId));
			if (!raw) return null;
			var b = JSON.parse(raw);
			if (!b || b.v !== VERSION || !Array.isArray(b.alumnos)) return null;
			var t = new Date(b.guardado).getTime();
			var hoy = ahora ? new Date(ahora).getTime() : Date.now();
			if (isNaN(t) || hoy - t > DIAS_VIGENCIA * 86400000) return null;
			if (!b.alumnos.length && !b.grupoId && !b.grupo) return null;
			return b;
		} catch (_) { return null; }
	}

	function borrar(maestroId) {
		var ls = almacen();
		if (!ls || !maestroId) return;
		try { ls.removeItem(clave(maestroId)); } catch (_) { /* sin almacenamiento: nada que borrar */ }
	}

	var api = { clave: clave, guardar: guardar, leer: leer, borrar: borrar, DIAS_VIGENCIA: DIAS_VIGENCIA };
	if (typeof window !== "undefined") window.AltaBorrador = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
