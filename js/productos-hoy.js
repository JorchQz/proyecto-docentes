/*
	productos-hoy.js — Reglas de la pantalla "Hoy" que no dependen del DOM (se prueban en node:
	pruebas/productos-hoy.test.js). Decisiones de Jorge del 2026-09-26:

	  - Agregar en plena clase una ACTIVIDAD (producto tipo 'trabajo') o una TAREA a la sesión
	    que se está trabajando: nombre, tipo, campo formativo (por omisión el de la sesión),
	    grados (por omisión los de la sesión y el proyecto) y, en tareas, el día en que se revisa
	    (por omisión la regla de AlcanceHoy.venceTarea: el siguiente día hábil).
	  - Cada producto se rotula con sus grados ("· 3°", "· 2° y 3°"): en multigrado salían
	    bloques iguales sin decir de qué grado eran.
	  - Un producto se renombra; se quita (activo = false) solo si no tiene calificaciones.
	  - "Trabajar hoy" ofrece la siguiente sesión pendiente de CADA proyecto activo, agrupadas
	    por proyecto y con su nombre, y deja elegir cualquier otra pendiente (sin tope).
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var TIPOS = { trabajo: "Actividad en clase", tarea: "Tarea" };
	var NOMBRE_MAX = 120;

	function gradosOrdenados(lista) {
		return Array.from(new Set((lista || [])
			.map(function (g) { return parseInt(g, 10); })
			.filter(function (g) { return !isNaN(g) && g >= 1 && g <= 6; })))
			.sort(function (a, b) { return a - b; });
	}

	// ["2","3"] → "2° y 3°" · ["3"] → "3°" · ["1","2","3"] → "1°, 2° y 3°"
	function etiquetaGrados(grados) {
		var g = gradosOrdenados(grados).map(function (x) { return x + "°"; });
		if (!g.length) return "";
		if (g.length === 1) return g[0];
		return g.slice(0, -1).join(", ") + " y " + g[g.length - 1];
	}

	/*
		"Trabajar hoy": por cada proyecto ACTIVO con sesiones sin fecha y sin completar, la
		siguiente (la de menor número) y las demás pendientes. Proyectos por título; sin tope.
		sesiones: filas con id, proyecto_id, numero_sesion, fecha, estado_sesion
		proyectos: filas con id, titulo, estado
	*/
	function siguientesPorProyecto(sesiones, proyectos) {
		var porId = {};
		(proyectos || []).forEach(function (p) { if (p && p.estado === "activo") porId[p.id] = p; });
		var grupos = {};
		(sesiones || []).forEach(function (s) {
			if (!s || s.fecha || s.estado_sesion === "completada") return;
			var p = porId[s.proyecto_id];
			if (!p) return;
			(grupos[p.id] = grupos[p.id] || []).push(Object.assign({}, s, { proyectoTitulo: p.titulo || "Proyecto sin título" }));
		});
		return Object.keys(grupos).map(function (id) {
			var lista = grupos[id].sort(function (a, b) {
				return (Number(a.numero_sesion) || 0) - (Number(b.numero_sesion) || 0) || String(a.id).localeCompare(String(b.id));
			});
			return { proyecto: porId[id], siguiente: lista[0], otras: lista.slice(1) };
		}).sort(function (a, b) {
			return String(a.proyecto.titulo || "").localeCompare(String(b.proyecto.titulo || ""), "es", { sensitivity: "base" }) ||
				String(a.proyecto.id).localeCompare(String(b.proyecto.id));
		});
	}

	// Grados por omisión de algo nuevo en una sesión: los de la sesión (sus productos) y los del
	// proyecto; si no hay ninguno, los del grupo
	function gradosPorOmision(gradosSesion, gradosProyecto, gradosGrupo) {
		var g = gradosOrdenados([].concat(gradosSesion || [], gradosProyecto || []));
		if (!g.length) g = gradosOrdenados(gradosGrupo);
		var delGrupo = gradosOrdenados(gradosGrupo);
		// Solo los grados que tiene el grupo (las casillas son las del grupo)
		if (delGrupo.length) g = g.filter(function (x) { return delGrupo.indexOf(x) !== -1; });
		return g.length ? g : delGrupo;
	}

	/*
		validarNuevo({ nombre, tipo, campo, grados, fechaRevision }, { hoy, gradosSesion })
		→ { ok, error, foco, fila } — fila lista para productos_sesion (sin sesion_id ni maestro_id)
	*/
	function validarNuevo(d, ctx) {
		d = d || {};
		ctx = ctx || {};
		var nombre = String(d.nombre || "").replace(/\s+/g, " ").trim();
		if (!nombre) return { ok: false, foco: "nombre", error: "Escribe el nombre de la actividad o de la tarea." };
		if (nombre.length > NOMBRE_MAX) return { ok: false, foco: "nombre", error: "El nombre es muy largo (máximo " + NOMBRE_MAX + " letras)." };
		if (!TIPOS[d.tipo]) return { ok: false, foco: "tipo", error: "Elige si es una actividad en clase o una tarea." };
		if (CAMPOS.indexOf(d.campo) === -1) return { ok: false, foco: "campo", error: "Elige el campo formativo." };
		var grados = gradosOrdenados(d.grados);
		if (!grados.length) return { ok: false, foco: "grados", error: "Elige al menos un grado." };
		var fecha = null;
		if (d.tipo === "tarea") {
			fecha = String(d.fechaRevision || "");
			if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, foco: "fecha", error: "Elige el día en que se revisa la tarea." };
			if (ctx.hoy && fecha < ctx.hoy) return { ok: false, foco: "fecha", error: "El día en que se revisa la tarea no puede ser anterior a hoy." };
		}
		var deSesion = gradosOrdenados(ctx.gradosSesion);
		var todos = deSesion.length && grados.length === deSesion.length && grados.every(function (g, i) { return g === deSesion[i]; });
		return {
			ok: true, error: "",
			fila: {
				tipo: d.tipo,
				nombre: nombre,
				grados: grados.map(String),
				modalidad: grados.length > 1 || todos ? "compartida" : "diferenciada",
				campo: d.campo,
				fecha_entrega: fecha,
				origen: "maestro",
				activo: true,
			},
		};
	}

	function validarNombre(nombre) {
		var n = String(nombre || "").replace(/\s+/g, " ").trim();
		if (!n) return { ok: false, error: "Escribe el nuevo nombre." };
		if (n.length > NOMBRE_MAX) return { ok: false, error: "El nombre es muy largo (máximo " + NOMBRE_MAX + " letras)." };
		return { ok: true, nombre: n };
	}

	// ¿Esta captura cuenta como calificación? (semáforo, entrega, puntaje o retroalimentación)
	function tieneCaptura(cal) {
		return !!(cal && (cal.nivel || cal.estado_entrega || (cal.puntaje !== null && cal.puntaje !== undefined && cal.puntaje !== "") || cal.retroalimentacion));
	}

	var api = {
		CAMPOS: CAMPOS, TIPOS: TIPOS, NOMBRE_MAX: NOMBRE_MAX,
		etiquetaGrados: etiquetaGrados, siguientesPorProyecto: siguientesPorProyecto,
		gradosPorOmision: gradosPorOmision, validarNuevo: validarNuevo, validarNombre: validarNombre,
		tieneCaptura: tieneCaptura,
	};
	if (typeof window !== "undefined") window.ProductosHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
