/*
	entidades.js — Única lista de las 32 entidades federativas de México (decisión 21 de
	Jorge, 2026-09-24). La usan el onboarding y Mi cuenta para guardar el estado de la
	maestra en perfiles.estado, y Inicio para invitar a elegirlo si falta.

	perfiles.estado guarda el NOMBRE tal como está aquí (texto; la columna no tiene
	catálogo en la base). Si alguna vez cambia la redacción de un nombre, se agrega el
	viejo a ALIAS para que las cuentas que ya lo guardaron lo sigan reconociendo.
	Las reglas de evaluación por estado viven en js/reglas-entidad.js.
*/

(function () {
	"use strict";

	// Orden alfabético, con el nombre de uso común (el oficial completo va en "oficial")
	var ENTIDADES = [
		{ clave: "AGS", nombre: "Aguascalientes" },
		{ clave: "BC", nombre: "Baja California" },
		{ clave: "BCS", nombre: "Baja California Sur" },
		{ clave: "CAM", nombre: "Campeche" },
		{ clave: "CHS", nombre: "Chiapas" },
		{ clave: "CHH", nombre: "Chihuahua" },
		{ clave: "CDMX", nombre: "Ciudad de México" },
		{ clave: "COA", nombre: "Coahuila", oficial: "Coahuila de Zaragoza" },
		{ clave: "COL", nombre: "Colima" },
		{ clave: "DGO", nombre: "Durango" },
		{ clave: "MEX", nombre: "Estado de México", oficial: "México" },
		{ clave: "GTO", nombre: "Guanajuato" },
		{ clave: "GRO", nombre: "Guerrero" },
		{ clave: "HGO", nombre: "Hidalgo" },
		{ clave: "JAL", nombre: "Jalisco" },
		{ clave: "MICH", nombre: "Michoacán", oficial: "Michoacán de Ocampo" },
		{ clave: "MOR", nombre: "Morelos" },
		{ clave: "NAY", nombre: "Nayarit" },
		{ clave: "NL", nombre: "Nuevo León" },
		{ clave: "OAX", nombre: "Oaxaca" },
		{ clave: "PUE", nombre: "Puebla" },
		{ clave: "QRO", nombre: "Querétaro" },
		{ clave: "QROO", nombre: "Quintana Roo" },
		{ clave: "SLP", nombre: "San Luis Potosí" },
		{ clave: "SIN", nombre: "Sinaloa" },
		{ clave: "SON", nombre: "Sonora" },
		{ clave: "TAB", nombre: "Tabasco" },
		{ clave: "TAMS", nombre: "Tamaulipas" },
		{ clave: "TLAX", nombre: "Tlaxcala" },
		{ clave: "VER", nombre: "Veracruz", oficial: "Veracruz de Ignacio de la Llave" },
		{ clave: "YUC", nombre: "Yucatán" },
		{ clave: "ZAC", nombre: "Zacatecas" },
	];

	// Nombres viejos o alternos → nombre de la lista (vacío por ahora)
	var ALIAS = {};

	function sinAcentos(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
	}

	/*
		Nombre de la lista que corresponde a lo guardado ("jalisco", "Michoacán de Ocampo",
		"MICH" → "Michoacán"); "" si no hay nada o no se reconoce.
	*/
	function normalizar(valor) {
		var v = sinAcentos(valor);
		if (!v) return "";
		if (ALIAS[valor]) return ALIAS[valor];
		for (var i = 0; i < ENTIDADES.length; i++) {
			var e = ENTIDADES[i];
			if (sinAcentos(e.nombre) === v || sinAcentos(e.clave) === v || (e.oficial && sinAcentos(e.oficial) === v)) return e.nombre;
		}
		return "";
	}

	function esValida(valor) { return normalizar(valor) !== "" && normalizar(valor) === valor; }

	/*
		Llena un <select> con "Elige tu estado" y las 32 entidades, y deja elegido
		`actual` si se reconoce. No toca otros atributos del select.
	*/
	function llenarSelect(select, actual) {
		if (!select) return;
		var doc = select.ownerDocument;
		select.innerHTML = "";
		var vacia = doc.createElement("option");
		vacia.value = "";
		vacia.textContent = "Elige tu estado";
		select.appendChild(vacia);
		ENTIDADES.forEach(function (e) {
			var op = doc.createElement("option");
			op.value = e.nombre;
			op.textContent = e.nombre;
			select.appendChild(op);
		});
		select.value = normalizar(actual);
	}

	/*
		Guarda la entidad en perfiles.estado → { error } (null si se guardó).
		UPDATE y, si la maestra todavía no tiene fila en perfiles, INSERT. No es un upsert:
		authenticated no tiene permiso de UPDATE sobre perfiles.id, y el upsert de PostgREST
		pone id en su "do update", así que la base lo rechaza.
	*/
	async function guardar(sb, userId, entidad) {
		var upd = await sb.from("perfiles").update({ estado: entidad }).eq("id", userId).select("estado");
		if (upd.error) return { error: upd.error };
		if (upd.data && upd.data.length) return { error: null };
		var ins = await sb.from("perfiles").insert({ id: userId, estado: entidad });
		return { error: ins.error || null };
	}

	var api = {
		ENTIDADES: ENTIDADES,
		normalizar: normalizar,
		esValida: esValida,
		llenarSelect: llenarSelect,
		guardar: guardar,
	};
	if (typeof window !== "undefined") window.Entidades = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
