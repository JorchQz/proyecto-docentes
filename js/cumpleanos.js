/*
	cumpleanos.js — Próximos cumpleaños del grupo (pestaña "Cumpleaños" de calendario.html,
	decisión de Jorge, 2026-09-26). Reglas puras, sin DOM ni base.

	- Usa alumnos.fecha_nacimiento (la ficha de Mi grupo). Solo alumnos ACTIVOS.
	- proximos(alumnos, hoy) → los cumpleaños de los próximos 12 meses, del más cercano al más
	  lejano (hoy primero), con la fecha en que caen, en cuántos días y la edad que cumplen.
	- 29 de febrero: en un año que no es bisiesto se festeja el 28 de febrero (lo más cercano sin
	  cambiar de mes), con una nota en la pantalla. Confirmado por Jorge (2026-09-26): la maestra
	  captura la fecha tal como viene en el acta y se queda así.
	- Los que no tienen fecha (o la tienen inválida) se cuentan aparte: "N alumnos sin fecha de
	  nacimiento", con enlace a Mi grupo.
	- Un cumpleaños en fin de semana o en un día sin clase se muestra igual; la pantalla le pone
	  la nota del día (js/calendario-sep.js).
	- porFecha(lista) → { "AAAA-MM-DD": [nombres] } de una lista de próximos.
	- delMes(alumnos, mes) → lo mismo pero con TODOS los cumpleaños de ese mes, también los que
	  ya pasaron: es lo que marca el pastel en la vista de mes (R21).
	- paraInicio / textoInicio: el aviso discreto de Inicio (dashboard.html), el mismo día y
	  hasta DIAS_AVISO_INICIO (7) días antes, "para planear una sorpresa" (Jorge, 2026-09-26).

	node pruebas/cumpleanos.test.js
*/
(function () {
	"use strict";

	function partes(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
		if (!m) return null;
		var p = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
		var t = new Date(Date.UTC(p.y, p.m - 1, p.d));
		if (t.getUTCFullYear() !== p.y || t.getUTCMonth() !== p.m - 1 || t.getUTCDate() !== p.d) return null;
		return p;
	}
	function bisiesto(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
	function iso(y, m, d) { return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d; }
	function diasEntre(a, b) {
		var pa = partes(a), pb = partes(b);
		return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
	}

	// El cumpleaños de ese año (29 de febrero → 28 en año no bisiesto)
	function cumpleEn(nac, y) {
		var d = nac.m === 2 && nac.d === 29 && !bisiesto(y) ? 28 : nac.d;
		return iso(y, nac.m, d);
	}

	/*
		siguiente(nacimiento, hoy) → { fecha, dias, edad, bisiesto } del próximo cumpleaños (hoy
		cuenta como próximo: dias = 0), o null si la fecha no es válida o es futura.
	*/
	function siguiente(nacimiento, hoy) {
		var n = partes(nacimiento), h = partes(hoy);
		if (!n || !h || nacimiento > hoy) return null;
		var f = cumpleEn(n, h.y);
		var y = h.y;
		if (f < hoy) { y = h.y + 1; f = cumpleEn(n, y); }
		return { fecha: f, dias: diasEntre(hoy, f), edad: y - n.y, bisiesto: n.m === 2 && n.d === 29 };
	}

	/*
		proximos(alumnos, hoy) → { lista: [{ alumno, fecha, dias, edad, bisiesto }], sinFecha }
		alumnos: [{ id, nombre_completo, estatus, fecha_nacimiento }]
	*/
	function proximos(alumnos, hoy) {
		var lista = [], sinFecha = 0;
		(alumnos || []).forEach(function (a) {
			if (!a || a.estatus !== "activo") return;
			var s = a.fecha_nacimiento ? siguiente(a.fecha_nacimiento, hoy) : null;
			if (!s) { sinFecha++; return; }
			lista.push({ alumno: a, fecha: s.fecha, dias: s.dias, edad: s.edad, bisiesto: s.bisiesto });
		});
		lista.sort(function (x, y) {
			return x.dias - y.dias || String(x.alumno.nombre_completo || "").localeCompare(String(y.alumno.nombre_completo || ""), "es");
		});
		return { lista: lista, sinFecha: sinFecha };
	}

	// "hoy", "mañana", "en 2 días"
	function cuando(dias) {
		if (dias === 0) return "hoy";
		if (dias === 1) return "mañana";
		return "en " + dias + " días";
	}

	// { fecha: [ "Ana (cumple 8)" ] } para la vista de mes
	function porFecha(lista) {
		var m = {};
		(lista || []).forEach(function (c) {
			if (!m[c.fecha]) m[c.fecha] = [];
			m[c.fecha].push({ nombre: c.alumno.nombre_completo || "Alumno sin nombre", edad: c.edad });
		});
		return m;
	}

	// "1 alumno sin fecha de nacimiento" / "3 alumnos sin fecha de nacimiento"
	function textoSinFecha(n) {
		return n === 1 ? "1 alumno sin fecha de nacimiento" : n + " alumnos sin fecha de nacimiento";
	}

	/*
		delMes(alumnos, mes) → { "AAAA-MM-DD": [{nombre, edad}] } con TODOS los cumpleaños del mes
		"AAAA-MM" (también los que ya pasaron), para el pastel de la vista de mes (R21: antes solo
		salían los de los próximos 12 meses y un cumpleaños de principios de mes ya no se veía).
		Solo alumnos activos; 29 de febrero en año no bisiesto, el 28. Un bebé que todavía no
		cumple años ese mes (edad 0 o fecha futura) no sale.
	*/
	function delMes(alumnos, mes) {
		var mm = /^(\d{4})-(\d{2})$/.exec(String(mes || ""));
		var out = {};
		if (!mm) return out;
		var y = Number(mm[1]), m = Number(mm[2]);
		(alumnos || []).forEach(function (a) {
			if (!a || a.estatus !== "activo" || !a.fecha_nacimiento) return;
			var n = partes(a.fecha_nacimiento);
			if (!n || n.m !== m || y - n.y < 1) return;
			var f = cumpleEn(n, y);
			if (!out[f]) out[f] = [];
			out[f].push({ nombre: a.nombre_completo || "Alumno sin nombre", edad: y - n.y });
		});
		Object.keys(out).forEach(function (f) {
			out[f].sort(function (x, z) { return String(x.nombre).localeCompare(String(z.nombre), "es"); });
		});
		return out;
	}

	// ── Aviso en Inicio (decisión de Jorge, 2026-09-26) ───────────────────────
	// El mismo día y unos días antes, "para planear una sorpresa"
	var DIAS_AVISO_INICIO = 7;
	var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

	// "el jueves 1 de octubre"
	function elDia(fecha) {
		var p = partes(fecha);
		if (!p) return "";
		return "el " + DIAS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] + " " + p.d + " de " + MESES[p.m - 1];
	}

	/*
		paraInicio(alumnos, hoy, dias?) → los cumpleaños de hoy a dentro de DIAS_AVISO_INICIO días
		(inclusive), en orden; [] si no hay ninguno (Inicio entonces no muestra nada).
		alumnos: los activos del grupo activo (los demás se ignoran igual que en proximos).
	*/
	function paraInicio(alumnos, hoy, dias) {
		var tope = typeof dias === "number" ? dias : DIAS_AVISO_INICIO;
		return proximos(alumnos, hoy).lista.filter(function (c) { return c.dias <= tope; });
	}

	/*
		textoInicio(lista) → "Ana Pérez, hoy (cumple 8) · Luis Ríos, el jueves 1 de octubre (cumple 9)"
		hoy / mañana / el día de la semana con la fecha.
	*/
	function textoInicio(lista) {
		return (lista || []).map(function (c) {
			var cuandoEs = c.dias === 0 ? "hoy" : (c.dias === 1 ? "mañana" : elDia(c.fecha));
			return (c.alumno.nombre_completo || "Alumno sin nombre") + ", " + cuandoEs + " (cumple " + c.edad + ")";
		}).join(" · ");
	}

	var api = {
		siguiente: siguiente, proximos: proximos, cuando: cuando, porFecha: porFecha, textoSinFecha: textoSinFecha, bisiesto: bisiesto,
		delMes: delMes, DIAS_AVISO_INICIO: DIAS_AVISO_INICIO, paraInicio: paraInicio, textoInicio: textoInicio, elDia: elDia,
	};
	if (typeof window !== "undefined") window.Cumpleanos = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
