/*
	calendario-sep.js — Calendario escolar oficial de la SEP (primaria) y los ajustes de cada grupo.

	Solo datos y reglas puras (sin base ni pantalla): lo usan calendario.html (vista del mes y rol
	de aseo) y las pruebas (pruebas/calendario-sep.test.js).

	Fuente del ciclo 2026-2027: ACUERDO número 07/07/26 por el que se establecen los calendarios
	escolares para el ciclo lectivo 2026-2027 (DOF 15-07-2026), calendario de 185 días para
	preescolar, primaria y secundaria. Las fechas de detalle (CTE, suspensiones, vacaciones,
	registro de calificaciones) solo vienen en la imagen del DOF; se leyeron de ahí y se cotejaron
	con el boletín SEP 235 (referencia local: docs/referencia/calendario-sep-2026-2027.md).

	Decisiones de Jorge (2026-09-25):
	  - "Registro de calificaciones" (13-nov, 5-mar, 2-jul) es día SIN clase, con la etiqueta
	    "Registro de calificaciones (descarga administrativa)". Así la cuenta da los 185 días del
	    acuerdo (225 días hábiles - 40 sin clase). La fecha puede cambiar en cada entidad o
	    escuela: la maestra la ajusta en su calendario (marca con clase el día oficial y sin clase
	    el día nuevo, con los ajustes del grupo).
	  - "Registro y comunicación de los resultados de la evaluación" sí es día CON clase.

	Un ciclo nuevo se agrega como otro objeto en CICLOS (mismas claves); nada de la lógica cambia.

	Tipos de día (TIPOS): cada uno dice si hay clase. Los oficiales sin clase son cte, festivo
	(suspensión oficial de labores), vacaciones, registro (de calificaciones), formacion y otro;
	los oficiales con clase que se marcan son entrega (a las familias), jornada, preinscripcion y
	aviso (inicio y fin de clases). Además: clase, fin_semana, fuera_ciclo y los dos del grupo,
	propio_sin_clase y propio_con_clase.

	Ajustes del grupo (tabla calendario_ajustes, una fila por grupo y fecha): la maestra marca un
	día de clase como sin clase (tipo suspension, festividad_local u otro, con motivo opcional) o un
	día oficial sin clase como con clase (tipo con_clase: la autoridad educativa local puede ajustar
	el calendario, LGE art. 87). Solo en días hábiles (lunes a viernes) dentro del periodo de
	clases; un ajuste que no cambia nada (sin clase sobre un día que ya no tenía) se ignora.
	Las funciones reciben los ajustes como arreglo de filas [{fecha, tipo, motivo}] o como mapa
	{ "AAAA-MM-DD": {tipo, motivo} }.

	── El calendario NO se conecta con la asistencia, las tareas ni el trimestre ──
	Decisión de Jorge (2026-09-25), ya tomada:
	  - Asistencia: el porcentaje se calcula por las veces que la maestra pasó lista (los días con
	    lista capturada), no por los días de clase del calendario: la maestra también puede faltar,
	    y un día sin lista no es falta de nadie. js/motor-calificacion.js, js/reportes.js y demás
	    no leen el calendario.
	  - Tareas: el vencimiento sigue siendo el de js/alcance-hoy.js (venceTarea: su fecha de
	    entrega o el siguiente día hábil, lunes a viernes); no salta los días sin clase.
	  - Trimestre: sigue siendo manual, en Mi grupo (grupos.trimestre_actual); el calendario no lo
	    cambia ni lo sugiere.
	El calendario sirve para ver el ciclo, marcar los ajustes del grupo y, si la maestra lo usa, el
	rol de aseo (opcional).
*/

(function () {
	"use strict";

	// ── Tipos de día ────────────────────────────────────────────────────────────
	var TIPOS = {
		clase:            { etiqueta: "Día de clase", clase: true },
		fin_semana:       { etiqueta: "Fin de semana", clase: false },
		fuera_ciclo:      { etiqueta: "Fuera del ciclo escolar", clase: false },
		// Oficiales sin clase
		cte:              { etiqueta: "Consejo Técnico Escolar", clase: false },
		festivo:          { etiqueta: "Suspensión oficial de labores", clase: false },
		vacaciones:       { etiqueta: "Vacaciones", clase: false },
		registro:         { etiqueta: "Registro de calificaciones (descarga administrativa)", clase: false },
		formacion:        { etiqueta: "Formación docente", clase: false },
		otro:             { etiqueta: "Sin clase", clase: false },
		// Oficiales con clase (se marcan, pero hay clase)
		entrega:          { etiqueta: "Comunicación de resultados a las familias", clase: true },
		jornada:          { etiqueta: "Jornada nacional", clase: true },
		preinscripcion:   { etiqueta: "Preinscripción", clase: true },
		aviso:            { etiqueta: "Fecha del ciclo", clase: true },
		// Del grupo
		propio_sin_clase: { etiqueta: "Sin clase en tu grupo", clase: false },
		propio_con_clase: { etiqueta: "Con clase en tu grupo", clase: true },
	};

	// Tipos de ajuste que la maestra puede guardar (calendario_ajustes.tipo)
	var AJUSTES = {
		suspension:       { etiqueta: "Suspensión", clase: false },
		festividad_local: { etiqueta: "Festividad local", clase: false },
		otro:             { etiqueta: "Otro motivo", clase: false },
		con_clase:        { etiqueta: "Sí hay clase", clase: true },
	};
	var MOTIVO_MAX = 140;

	// ── Datos oficiales por ciclo ──────────────────────────────────────────────
	var FUENTE_2026 = "DOF, Acuerdo 07/07/26 (15-07-2026)";
	var CICLOS = [
		{
			ciclo: "2026-2027",
			nivel: "primaria",
			diasEfectivos: 185,
			inicio: "2026-08-31",     // primer día de clases
			fin: "2027-07-09",        // último día de clases
			desde: "2026-08-01",      // el ciclo con sus recesos (para no aplicarlo a otro ciclo)
			hasta: "2027-07-31",
			fuente: {
				instrumento: "Acuerdo número 07/07/26 por el que se establecen los calendarios escolares para el ciclo lectivo 2026-2027",
				publicacion: "Diario Oficial de la Federación",
				fecha: "2026-07-15",
				fechaTexto: "15-07-2026",
				url: "https://dof.gob.mx/nota_detalle.php?codigo=5793645&fecha=15/07/2026",
				imagen: "https://dof.gob.mx/imagenes_diarios/2026/07/15/MAT/sep_1_Cimg_0.png",
				consultado: "2026-09-25",
			},
			// Días sin clase. Un rango solo cuenta sus días hábiles (los sábados y domingos son
			// fin de semana de todos modos).
			sinClase: [
				{ desde: "2026-08-01", hasta: "2026-08-23", tipo: "vacaciones", motivo: "Receso de clases" },
				{ desde: "2026-08-24", hasta: "2026-08-28", tipo: "cte", motivo: "Consejo Técnico Escolar, fase intensiva" },
				{ desde: "2026-08-29", hasta: "2026-08-30", tipo: "vacaciones", motivo: "Receso de clases" },
				{ desde: "2026-09-16", tipo: "festivo", motivo: "Suspensión de labores: Independencia de México" },
				{ desde: "2026-09-25", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 1" },
				{ desde: "2026-10-30", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 2" },
				{ desde: "2026-11-02", tipo: "festivo", motivo: "Suspensión de labores: Día de Muertos" },
				{ desde: "2026-11-13", tipo: "registro", motivo: "Registro de calificaciones del primer periodo" },
				{ desde: "2026-11-16", tipo: "festivo", motivo: "Suspensión de labores: Revolución Mexicana" },
				{ desde: "2026-11-27", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 3" },
				{ desde: "2026-12-21", hasta: "2026-12-24", tipo: "vacaciones", motivo: "Vacaciones de invierno" },
				{ desde: "2026-12-25", tipo: "festivo", motivo: "Suspensión de labores: Navidad" },
				{ desde: "2026-12-28", hasta: "2026-12-31", tipo: "vacaciones", motivo: "Vacaciones de invierno" },
				{ desde: "2027-01-01", tipo: "festivo", motivo: "Suspensión de labores: Año Nuevo" },
				{ desde: "2027-01-04", hasta: "2027-01-05", tipo: "vacaciones", motivo: "Vacaciones de invierno" },
				{ desde: "2027-01-06", tipo: "festivo", motivo: "Suspensión de labores: Día de Reyes" },
				{ desde: "2027-01-29", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 4" },
				{ desde: "2027-02-01", tipo: "festivo", motivo: "Suspensión de labores: Día de la Constitución" },
				{ desde: "2027-02-26", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 5" },
				{ desde: "2027-03-05", tipo: "registro", motivo: "Registro de calificaciones del segundo periodo" },
				{ desde: "2027-03-15", tipo: "festivo", motivo: "Suspensión de labores: natalicio de Benito Juárez" },
				{ desde: "2027-03-22", hasta: "2027-04-02", tipo: "vacaciones", motivo: "Vacaciones de primavera" },
				{ desde: "2027-04-30", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 6" },
				{ desde: "2027-05-05", tipo: "festivo", motivo: "Suspensión de labores: Batalla de Puebla" },
				{ desde: "2027-05-28", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 7" },
				{ desde: "2027-06-25", tipo: "cte", motivo: "Consejo Técnico Escolar, sesión ordinaria 8" },
				{ desde: "2027-07-02", tipo: "registro", motivo: "Registro de calificaciones del tercer periodo" },
				{ desde: "2027-07-10", hasta: "2027-07-31", tipo: "vacaciones", motivo: "Receso de clases" },
			],
			// Días marcados en el calendario que SÍ tienen clase
			conClase: [
				{ desde: "2026-08-31", tipo: "aviso", motivo: "Inicio de clases" },
				{ desde: "2026-09-07", tipo: "jornada", motivo: "Jornada de concientización sobre abuso sexual y maltrato infantil" },
				{ desde: "2026-11-23", hasta: "2026-11-26", tipo: "entrega", motivo: "Registro y comunicación de los resultados de la evaluación a las familias (primer periodo)" },
				{ desde: "2027-01-07", tipo: "aviso", motivo: "Regreso a clases" },
				{ desde: "2027-02-02", hasta: "2027-02-12", tipo: "preinscripcion", motivo: "Preinscripción al ciclo 2027-2028" },
				{ desde: "2027-03-16", hasta: "2027-03-19", tipo: "entrega", motivo: "Registro y comunicación de los resultados de la evaluación a las familias (segundo periodo)" },
				{ desde: "2027-04-05", tipo: "aviso", motivo: "Regreso a clases" },
				{ desde: "2027-07-08", tipo: "entrega", motivo: "Registro y comunicación de los resultados de la evaluación a las familias (tercer periodo)" },
				{ desde: "2027-07-09", tipo: "aviso", motivo: "Fin de clases" },
			],
			etiquetaFuente: FUENTE_2026,
		},
	];

	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
	var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
	var DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

	// ── Fechas (siempre "AAAA-MM-DD"; cálculos en UTC para no depender de la zona) ──
	function fechaISO(f) {
		var s = String(f || "").slice(0, 10);
		return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
	}
	function aFecha(iso) {
		var p = iso.split("-");
		return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
	}
	function deFecha(d) {
		return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
	}
	function sumarDias(iso, n) {
		var d = aFecha(iso);
		d.setUTCDate(d.getUTCDate() + n);
		return deFecha(d);
	}
	function diaSemana(iso) { return aFecha(iso).getUTCDay(); } // 0 domingo … 6 sábado
	function esFinDeSemana(iso) { var d = diaSemana(iso); return d === 0 || d === 6; }
	function hoyLocal(d) {
		var f = d || new Date();
		return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
	}
	// "AAAA-MM" del mes y sus días
	function diasDelMes(mes) {
		var p = String(mes).slice(0, 7).split("-");
		var total = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
		var out = [];
		for (var i = 1; i <= total; i++) out.push(p[0] + "-" + p[1] + "-" + String(i).padStart(2, "0"));
		return out;
	}
	function mesSiguiente(mes, n) {
		var p = String(mes).slice(0, 7).split("-");
		var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + (n === undefined ? 1 : n), 1));
		return deFecha(d).slice(0, 7);
	}

	// ── Textos de fechas (es-MX, sin depender de Intl) ─────────────────────────
	function nombreMes(mes, conAnio) {
		var p = String(mes).slice(0, 7).split("-");
		var n = MESES[Number(p[1]) - 1] || "";
		var t = n.charAt(0).toUpperCase() + n.slice(1);
		return conAnio === false ? t : t + " " + p[0];
	}
	// "viernes 25 de septiembre de 2026"
	function fechaLarga(iso, conAnio) {
		var d = aFecha(iso);
		return DIAS[d.getUTCDay()] + " " + d.getUTCDate() + " de " + MESES[d.getUTCMonth()] + (conAnio === false ? "" : " de " + d.getUTCFullYear());
	}
	// "Lun 5"
	function fechaCorta(iso) {
		var d = aFecha(iso);
		return DIAS_CORTOS[d.getUTCDay()] + " " + d.getUTCDate();
	}

	// ── Ciclos ─────────────────────────────────────────────────────────────────
	function cicloDe(fecha) {
		var f = fechaISO(fecha);
		if (!f) return null;
		for (var i = 0; i < CICLOS.length; i++) {
			if (f >= CICLOS[i].desde && f <= CICLOS[i].hasta) return CICLOS[i];
		}
		return null;
	}
	function cicloPorNombre(nombre) {
		for (var i = 0; i < CICLOS.length; i++) if (CICLOS[i].ciclo === nombre) return CICLOS[i];
		return null;
	}
	// El ciclo de hoy o, si hoy cae fuera, el más cercano (el próximo, o el último que hubo)
	function cicloVigente(fecha) {
		var f = fechaISO(fecha) || hoyLocal();
		var c = cicloDe(f);
		if (c) return c;
		var proximo = null, ultimo = null;
		CICLOS.forEach(function (x) {
			if (x.desde > f && (!proximo || x.desde < proximo.desde)) proximo = x;
			if (x.hasta < f && (!ultimo || x.hasta > ultimo.hasta)) ultimo = x;
		});
		return proximo || ultimo || null;
	}
	// ["2026-08", …, "2027-07"]
	function mesesDelCiclo(ciclo) {
		var c = typeof ciclo === "string" ? cicloPorNombre(ciclo) : ciclo;
		if (!c) return [];
		var out = [], m = c.desde.slice(0, 7);
		while (m <= c.hasta.slice(0, 7)) { out.push(m); m = mesSiguiente(m); }
		return out;
	}

	// Índice por fecha de lo oficial de cada ciclo (se arma una vez)
	var indices = {};
	function indiceDe(c) {
		if (indices[c.ciclo]) return indices[c.ciclo];
		var idx = {};
		function agregar(lista) {
			lista.forEach(function (r) {
				var f = r.desde, hasta = r.hasta || r.desde;
				while (f <= hasta) {
					idx[f] = { tipo: r.tipo, motivo: r.motivo };
					f = sumarDias(f, 1);
				}
			});
		}
		agregar(c.sinClase);
		agregar(c.conClase);
		indices[c.ciclo] = idx;
		return idx;
	}

	/*
		infoOficial(fecha) → { fecha, tipo, clase, etiqueta, motivo, ciclo }
		Solo el calendario oficial (sin ajustes del grupo).
	*/
	function infoOficial(fecha) {
		var f = fechaISO(fecha);
		if (!f) return null;
		var c = cicloDe(f);
		var base = { fecha: f, ciclo: c ? c.ciclo : null };
		function con(tipo, motivo) {
			base.tipo = tipo;
			base.clase = TIPOS[tipo].clase;
			base.etiqueta = TIPOS[tipo].etiqueta;
			base.motivo = motivo || "";
			return base;
		}
		if (!c) return con("fuera_ciclo", "");
		var marca = indiceDe(c)[f];
		// Un día marcado sin clase que cae en fin de semana (dentro de un receso) sigue siendo
		// fin de semana para contar; se deja su motivo para pintarlo
		if (esFinDeSemana(f)) return con("fin_semana", marca && !TIPOS[marca.tipo].clase ? marca.motivo : "");
		if (f < c.inicio || f > c.fin) return con(marca ? marca.tipo : "fuera_ciclo", marca ? marca.motivo : "");
		if (marca) return con(marca.tipo, marca.motivo);
		return con("clase", "");
	}

	function mapaAjustes(ajustes) {
		if (!ajustes) return {};
		if (!Array.isArray(ajustes)) return ajustes;
		var m = {};
		ajustes.forEach(function (a) {
			var f = a && fechaISO(a.fecha);
			if (f && AJUSTES[a.tipo]) m[f] = { tipo: a.tipo, motivo: a.motivo || "" };
		});
		return m;
	}

	/*
		¿Se puede guardar este ajuste en esta fecha? → { ok, razon }
		- sin clase (suspension, festividad_local, otro): solo sobre un día oficial de clase;
		- con_clase: solo sobre un día hábil oficial sin clase;
		- nunca en fin de semana ni fuera del periodo de clases del ciclo.
	*/
	function ajustePermitido(fecha, tipoAjuste) {
		var of = infoOficial(fecha);
		if (!of || !AJUSTES[tipoAjuste]) return { ok: false, razon: "Ajuste no válido." };
		var c = cicloDe(of.fecha);
		if (!c || of.fecha < c.inicio || of.fecha > c.fin) return { ok: false, razon: "La fecha está fuera del periodo de clases del ciclo." };
		if (of.tipo === "fin_semana") return { ok: false, razon: "Los sábados y domingos no hay clase." };
		if (AJUSTES[tipoAjuste].clase && of.clase) return { ok: false, razon: "Ese día ya es de clase en el calendario oficial." };
		if (!AJUSTES[tipoAjuste].clase && !of.clase) return { ok: false, razon: "Ese día ya no tiene clase en el calendario oficial." };
		return { ok: true, razon: "" };
	}

	/*
		tipoDeDia(fecha, ajustes) → { fecha, tipo, clase, etiqueta, motivo, ciclo, oficial, ajuste }
		oficial: lo que dice el calendario SEP; ajuste: {tipo, motivo} del grupo si cambió el día.
	*/
	function tipoDeDia(fecha, ajustes) {
		var of = infoOficial(fecha);
		if (!of) return null;
		var aj = mapaAjustes(ajustes)[of.fecha];
		var r = { fecha: of.fecha, tipo: of.tipo, clase: of.clase, etiqueta: of.etiqueta, motivo: of.motivo, ciclo: of.ciclo, oficial: of, ajuste: null };
		if (aj && ajustePermitido(of.fecha, aj.tipo).ok) {
			var tipo = AJUSTES[aj.tipo].clase ? "propio_con_clase" : "propio_sin_clase";
			r.tipo = tipo;
			r.clase = TIPOS[tipo].clase;
			r.etiqueta = AJUSTES[aj.tipo].clase ? TIPOS[tipo].etiqueta : AJUSTES[aj.tipo].etiqueta + " en tu grupo";
			r.motivo = aj.motivo || "";
			r.ajuste = { tipo: aj.tipo, motivo: aj.motivo || "" };
		}
		return r;
	}

	function esDiaDeClase(fecha, ajustes) {
		var t = tipoDeDia(fecha, ajustes);
		return !!(t && t.clase);
	}

	// Días de clase entre dos fechas (incluidas), en orden
	function diasDeClase(desde, hasta, ajustes) {
		var a = fechaISO(desde), b = fechaISO(hasta);
		if (!a || !b || a > b) return [];
		var m = mapaAjustes(ajustes), out = [];
		for (var f = a; f <= b; f = sumarDias(f, 1)) if (esDiaDeClase(f, m)) out.push(f);
		return out;
	}

	// Días hábiles (lunes a viernes) SIN clase entre dos fechas, con su información
	function diasSinClase(desde, hasta, ajustes) {
		var a = fechaISO(desde), b = fechaISO(hasta);
		if (!a || !b || a > b) return [];
		var m = mapaAjustes(ajustes), out = [];
		for (var f = a; f <= b; f = sumarDias(f, 1)) {
			if (esFinDeSemana(f)) continue;
			var t = tipoDeDia(f, m);
			if (t && !t.clase && t.tipo !== "fuera_ciclo") out.push(t);
		}
		return out;
	}

	/*
		Próximo día hábil sin clase DESPUÉS de `fecha` (o desde ella con incluir=true), dentro del
		periodo de clases de su ciclo o del siguiente. null si no hay.
	*/
	function proximoSinClase(fecha, ajustes, incluir) {
		var f = fechaISO(fecha);
		if (!f) return null;
		var m = mapaAjustes(ajustes);
		var c = cicloVigente(f);
		if (!c) return null;
		var ultimo = CICLOS.reduce(function (acc, x) { return x.fin > acc ? x.fin : acc; }, c.fin);
		var d = incluir ? f : sumarDias(f, 1);
		for (; d <= ultimo; d = sumarDias(d, 1)) {
			if (esFinDeSemana(d)) continue;
			var cd = cicloDe(d);
			if (!cd || d < cd.inicio || d > cd.fin) continue;
			var t = tipoDeDia(d, m);
			if (t && !t.clase) return t;
		}
		return null;
	}

	// Leyenda para la pantalla: los tipos que aparecen en un ciclo (en orden fijo)
	var ORDEN_LEYENDA = ["clase", "cte", "festivo", "vacaciones", "registro", "formacion", "otro", "entrega", "jornada", "preinscripcion", "propio_sin_clase", "propio_con_clase", "fin_semana"];

	function textoFuente(c) {
		c = c || CICLOS[0];
		return "Fuente: Calendario escolar SEP " + c.ciclo + " (DOF " + c.fuente.fechaTexto + "). Tu entidad o escuela puede ajustarlo.";
	}

	var api = {
		CICLOS: CICLOS, TIPOS: TIPOS, AJUSTES: AJUSTES, MOTIVO_MAX: MOTIVO_MAX, ORDEN_LEYENDA: ORDEN_LEYENDA,
		MESES: MESES, DIAS: DIAS, DIAS_CORTOS: DIAS_CORTOS,
		cicloDe: cicloDe, cicloPorNombre: cicloPorNombre, cicloVigente: cicloVigente, mesesDelCiclo: mesesDelCiclo,
		infoOficial: infoOficial, tipoDeDia: tipoDeDia, esDiaDeClase: esDiaDeClase,
		diasDeClase: diasDeClase, diasSinClase: diasSinClase, proximoSinClase: proximoSinClase,
		ajustePermitido: ajustePermitido, mapaAjustes: mapaAjustes,
		fechaISO: fechaISO, sumarDias: sumarDias, diaSemana: diaSemana, esFinDeSemana: esFinDeSemana,
		hoyLocal: hoyLocal, diasDelMes: diasDelMes, mesSiguiente: mesSiguiente,
		nombreMes: nombreMes, fechaLarga: fechaLarga, fechaCorta: fechaCorta, textoFuente: textoFuente,
	};
	if (typeof window !== "undefined") window.CalendarioSEP = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
