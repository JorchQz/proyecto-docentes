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
		validarNuevo({ nombre, tipo, campo, grados, fechaRevision }, { hoy, gradosSesion, sinFechaRevision })
		→ { ok, error, foco, fila } — fila lista para productos_sesion (sin sesion_id ni maestro_id)
		sinFechaRevision (opcional; solo la vista del proyecto, Fase 5): una tarea de una sesión que aún no se trabaja
		no lleva día de revisión (fecha_entrega null): vence el siguiente día de clase después de trabajar la sesión
		(AlcanceHoy.venceTarea), como las tareas del plan. Hoy no lo pasa: sus tareas siempre llevan su día.
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
		// Sin grados solo si es para alumnos elegidos ("¿Para quién?": d.incluidos > 0)
		if (!grados.length && !(Number(d.incluidos) > 0)) return { ok: false, foco: "grados", error: "Elige al menos un grado." };
		var fecha = null;
		if (d.tipo === "tarea" && !ctx.sinFechaRevision) {
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

	/*
		── Contenido y PDA de la actividad (decisión de Jorge del 2026-09-26) ──
		"Si no es el mismo campo formativo o es una actividad fuera de la sesión, que tengan la
		libertad de elegir campo formativo, contenido y PDA, para que cada actividad sume."
		El PDA es OPCIONAL (en tablet tiene que seguir siendo rápido):
		  - Por omisión, si el campo es el de la sesión, los PDA de la sesión de esos grados.
		  - Se puede buscar un contenido del catálogo (del campo elegido y de las fases de los
		    grados elegidos) y marcar sus PDA de esos grados.
		  - Un PDA elegido que no está en la sesión se crea en sesiones_pda de esa sesión para ese
		    grado (como el materializador), así el trigger de evaluación formativa lo cuenta.
	*/
	var FASE_DE_GRADO = { 1: "Fase 3", 2: "Fase 3", 3: "Fase 4", 4: "Fase 4", 5: "Fase 5", 6: "Fase 5" };
	function fasesDeGrados(grados) {
		var f = [];
		gradosOrdenados(grados).forEach(function (g) { if (FASE_DE_GRADO[g] && f.indexOf(FASE_DE_GRADO[g]) === -1) f.push(FASE_DE_GRADO[g]); });
		return f;
	}
	function sinAcentos(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
	}
	/*
		buscarContenidos(contenidos, texto, campoLargo, fases, tope) → los del campo y las fases, que
		contienen todas las palabras buscadas (sin acentos), por fase y orden del catálogo.
		contenidos: filas de catalogo_contenidos { id, fase, campo_formativo, contenido, orden }
	*/
	function buscarContenidos(contenidos, texto, campoLargo, fases, tope) {
		var palabras = sinAcentos(texto).split(" ").filter(Boolean);
		var campo = sinAcentos(campoLargo);
		var r = (contenidos || []).filter(function (c) {
			if (!c) return false;
			if (campo && sinAcentos(c.campo_formativo) !== campo) return false;
			if (fases && fases.length && fases.indexOf(c.fase) === -1) return false;
			var t = sinAcentos(c.contenido);
			return palabras.every(function (p) { return t.indexOf(p) !== -1; });
		}).sort(function (a, b) {
			return String(a.fase).localeCompare(String(b.fase)) || (Number(a.orden) || 0) - (Number(b.orden) || 0);
		});
		return tope ? r.slice(0, tope) : r;
	}
	/*
		PDA de la sesión que se ofrecen para la actividad: los de sus grados y de SU campo. El campo
		de un PDA es el de su contenido en el catálogo (r.campo, código corto); sin él, el de la
		sesión. Así un PDA de Saberes que se agregó desde Hoy a una sesión de Lenguajes no se ofrece
		para una actividad de Lenguajes, y sí para otra de Saberes.
		Se marcan por omisión (r.marcado) solo los del plan de la sesión cuando la actividad es del
		campo de la sesión (la regla de siempre); los de otro campo se ofrecen sin marcar.
	*/
	function pdaDeSesionParaActividad(spdaSesion, campoSesion, campo, grados) {
		if (!campo) return [];
		var g = gradosOrdenados(grados);
		return (spdaSesion || []).filter(function (r) {
			return r && g.indexOf(Number(r.grado)) !== -1 && (r.campo || campoSesion) === campo;
		}).map(function (r) {
			return Object.assign({}, r, { marcado: campo === campoSesion && (!r.campo || r.campo === campoSesion) });
		});
	}
	// PDA de un contenido que se marcan solos: uno por grado si ese grado tiene uno solo
	function pdaMarcadosPorOmision(pdaContenido, grados) {
		var porGrado = {};
		gradosOrdenados(grados).forEach(function (g) { porGrado[g] = []; });
		(pdaContenido || []).forEach(function (p) { if (porGrado[Number(p.grado)]) porGrado[Number(p.grado)].push(p.id); });
		var r = [];
		Object.keys(porGrado).forEach(function (g) { if (porGrado[g].length === 1) r.push(porGrado[g][0]); });
		return r;
	}
	/*
		planLigas({ grados, deSesion: [spdaId], deCatalogo: [{ pda_id, grado }], spdaSesion: [{ id, pda_id, grado }] })
		→ { ligar: [spdaId existentes], crear: [{ pda_id, grado }] }
		Solo los de los grados de la actividad; un PDA del catálogo que la sesión ya tiene para ese
		grado se reutiliza (no se duplica en sesiones_pda).
	*/
	function planLigas(d) {
		d = d || {};
		var g = gradosOrdenados(d.grados);
		var porId = {}, porPda = {};
		(d.spdaSesion || []).forEach(function (r) {
			porId[r.id] = r;
			if (r.pda_id) porPda[r.pda_id + "|" + Number(r.grado)] = r.id;
		});
		var ligar = [], crear = [], vistos = {};
		(d.deSesion || []).forEach(function (id) {
			var r = porId[id];
			if (!r || g.indexOf(Number(r.grado)) === -1 || vistos[id]) return;
			vistos[id] = true;
			ligar.push(id);
		});
		(d.deCatalogo || []).forEach(function (p) {
			var grado = Number(p && p.grado);
			if (!p || !p.pda_id || g.indexOf(grado) === -1) return;
			var ya = porPda[p.pda_id + "|" + grado];
			if (ya) { if (!vistos[ya]) { vistos[ya] = true; ligar.push(ya); } return; }
			var k = "n|" + p.pda_id + "|" + grado;
			if (vistos[k]) return;
			vistos[k] = true;
			crear.push({ pda_id: p.pda_id, grado: grado });
		});
		return { ligar: ligar, crear: crear };
	}

	/*
		── ¿Para quién? (decisión de Jorge del 2026-09-26) ──
		Al crear una actividad o tarea: todo el grupo, uno o varios grados, o los alumnos que la
		maestra marca (agrupados por grado). Se guarda como grados del producto + filas de
		producto_sesion_alumnos (incluir / excluir) con la regla única de AlcanceHoy.asignadoA.

		planAsignacion({ modo, gradosGrupo, gradosElegidos, alumnos, elegidos, nivel })
		  modo: "grupo" | "grados" | "alumnos"
		  alumnos: los del grupo [{ id, grado }]; elegidos: ids marcados (modo "alumnos")
		  nivel: en "alumnos", el grado con el que trabajan (por ejemplo 2 para dos de 3° que trabajan
		         con 2°); null = cada uno con el suyo.
		→ { ok, error, foco, grados: ["3", ...], filas: [{ alumno_id, modo }], incluidos, gradosPda }
		Con "cada uno con el suyo", por grado: si están todos, va el grado; si están más de la mitad,
		el grado sin los que no (excluir); si no, se incluyen uno por uno. Con un nivel: ese grado,
		se incluyen los marcados de otros grados y se excluyen los de ese grado que no se marcaron.
		gradosPda: los grados cuyos PDA se ofrecen (los del producto y los de sus incluidos).
	*/
	function planAsignacion(d) {
		d = d || {};
		var grupo = gradosOrdenados(d.gradosGrupo);
		var alumnos = (d.alumnos || []).filter(function (a) { return a && a.id; });
		function listo(grados, filas) {
			var inc = filas.filter(function (f) { return f.modo === "incluir"; });
			var gp = gradosOrdenados(grados.concat(inc.map(function (f) {
				var a = alumnos.find(function (x) { return x.id === f.alumno_id; });
				return a ? a.grado : null;
			})));
			return { ok: true, error: "", grados: gradosOrdenados(grados).map(String), filas: filas, incluidos: inc.length, gradosPda: gp };
		}
		if (d.modo === "grupo" || !d.modo) {
			if (!grupo.length) return { ok: false, foco: "para", error: "El grupo no tiene grados." };
			return listo(grupo, []);
		}
		if (d.modo === "grados") {
			var g = gradosOrdenados(d.gradosElegidos).filter(function (x) { return !grupo.length || grupo.indexOf(x) !== -1; });
			if (!g.length) return { ok: false, foco: "grados", error: "Elige al menos un grado." };
			return listo(g, []);
		}
		var elegidos = {};
		(d.elegidos || []).forEach(function (id) { elegidos[id] = true; });
		var marcados = alumnos.filter(function (a) { return elegidos[a.id]; });
		if (!marcados.length) return { ok: false, foco: "alumnos", error: "Marca al menos un alumno." };
		var filas = [];
		var nivel = parseInt(d.nivel, 10);
		if (nivel >= 1 && nivel <= 6) {
			alumnos.forEach(function (a) {
				var mismo = Number(a.grado) === nivel;
				if (elegidos[a.id] && !mismo) filas.push({ alumno_id: a.id, modo: "incluir" });
				if (!elegidos[a.id] && mismo) filas.push({ alumno_id: a.id, modo: "excluir" });
			});
			return listo([nivel], filas);
		}
		var grados = [];
		gradosOrdenados(alumnos.map(function (a) { return a.grado; })).forEach(function (gr) {
			var suyos = alumnos.filter(function (a) { return Number(a.grado) === gr; });
			var si = suyos.filter(function (a) { return elegidos[a.id]; });
			var no = suyos.filter(function (a) { return !elegidos[a.id]; });
			if (!si.length) return;
			if (!no.length) { grados.push(gr); return; }
			if (si.length > no.length) {
				grados.push(gr);
				no.forEach(function (a) { filas.push({ alumno_id: a.id, modo: "excluir" }); });
				return;
			}
			si.forEach(function (a) { filas.push({ alumno_id: a.id, modo: "incluir" }); });
		});
		return listo(grados, filas);
	}

	/*
		Editar "para quién" de un producto ya creado: sus grados no cambian; cada alumno queda como
		lo dejó la maestra. quieren: { alumnoId: true } los que deben recibirlo.
		→ [{ alumno_id, modo }] (todas las filas del producto: guardar_asignacion_producto las
		reemplaza). Un alumno de sus grados que no lo quiere: excluir; uno de otro grado que sí: incluir.
	*/
	function filasDeEdicion(grados, alumnos, quieren) {
		var g = gradosOrdenados(grados);
		var filas = [];
		(alumnos || []).forEach(function (a) {
			var suGrado = g.indexOf(Number(a.grado)) !== -1;
			var quiere = !!(quieren && quieren[a.id]);
			if (suGrado && !quiere) filas.push({ alumno_id: a.id, modo: "excluir" });
			if (!suGrado && quiere) filas.push({ alumno_id: a.id, modo: "incluir" });
		});
		return filas;
	}

	/*
		Rótulo de para quién es un producto: "3° y 4°" · "3° y 4° (sin 1 alumno)" ·
		"2 alumnos de 3°" · "2° + 2 alumnos de 3°".
		asignacion: { alumnoId: modo } del producto; alumnos: los del grupo.
	*/
	function resumenPara(producto, asignacion, alumnos) {
		var g = gradosOrdenados(producto && producto.grados);
		var base = etiquetaGrados(g);
		var a = asignacion || {};
		var sin = 0, inc = [];
		(alumnos || []).forEach(function (al) {
			var m = a[al.id];
			var suGrado = g.indexOf(Number(al.grado)) !== -1;
			if (m === "excluir" && suGrado) sin++;
			if (m === "incluir" && !suGrado) inc.push(al);
		});
		var partes = base ? [base + (sin ? " (sin " + sin + (sin === 1 ? " alumno)" : " alumnos)") : "")] : [];
		if (inc.length) {
			var deGrados = etiquetaGrados(inc.map(function (x) { return x.grado; }));
			partes.push(inc.length + (inc.length === 1 ? " alumno de " : " alumnos de ") + deGrados);
		}
		return partes.join(" + ");
	}

	/*
		Los días del trimestre en curso (decisión de Jorge del 2026-09-26: una actividad suelta puede ser
		de cualquier día del trimestre y se califica en ese momento). El trimestre lo elige la maestra
		(grupos.trimestre_actual); sus días salen del calendario SEP del ciclo (js/calendario-escolar.js:
		fin del 1.º y del 2.º; js/calendario-sep.js: primer y último día de clases). Fuera de un ciclo
		conocido, los periodos del Acuerdo 10/09/23 (art. 8). Hoy siempre cabe (si la maestra aún no
		cambia el trimestre en Mi grupo, no se le cierra el día de hoy).
		rangoTrimestre(trimestre, hoy, { calendarios, ciclo }) → { desde, hasta } ("AAAA-MM-DD")
	*/
	function sumarDia(iso, n) {
		var d = new Date(iso + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}
	function rangoTrimestre(trimestre, hoy, fuentes) {
		fuentes = fuentes || {};
		var t = Number(trimestre) >= 1 && Number(trimestre) <= 3 ? Number(trimestre) : 1;
		var h = String(hoy || "").slice(0, 10);
		var cal = (fuentes.calendarios || []).filter(function (c) { return h >= c.desde && h <= c.hasta; })[0];
		var ciclo = fuentes.ciclo || null;
		var desde, hasta;
		if (cal) {
			var inicio = ciclo && ciclo.inicio ? ciclo.inicio : cal.desde, fin = ciclo && ciclo.fin ? ciclo.fin : cal.hasta;
			if (t === 1) { desde = inicio; hasta = cal.finT1; }
			else if (t === 2) { desde = sumarDia(cal.finT1, 1); hasta = cal.finT2; }
			else { desde = sumarDia(cal.finT2, 1); hasta = fin; }
		} else {
			var anio = Number(h.slice(0, 4)), mes = Number(h.slice(5, 7));
			var a0 = mes >= 8 ? anio : anio - 1; // el ciclo empieza en agosto
			if (t === 1) { desde = a0 + "-08-01"; hasta = a0 + "-11-30"; }
			else if (t === 2) { desde = a0 + "-12-01"; hasta = (a0 + 1) + "-03-31"; }
			else { desde = (a0 + 1) + "-04-01"; hasta = (a0 + 1) + "-07-31"; }
		}
		if (h && h < desde) desde = h;
		if (h && h > hasta) hasta = h;
		return { desde: desde, hasta: hasta };
	}

	// "2026-08-31" → "31 ago"
	function fechaCorta(iso) {
		var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		return m ? Number(m[3]) + " " + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m[2]) - 1] : "";
	}

	/*
		Actividad o tarea suelta (sin proyecto): lo mismo que validarNuevo y además la fecha
		(el día en que se trabaja; en una tarea, el día en que se deja: hoy). La actividad puede ser
		de cualquier día del trimestre en curso, también uno que ya pasó (ctx.desde y ctx.hasta:
		rangoTrimestre): se califica en ese momento, en Hoy.
	*/
	function validarSuelta(d, ctx) {
		d = d || {};
		ctx = ctx || {};
		var fecha = String(d.fecha || "");
		if (d.tipo !== "tarea") {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, foco: "fechaSuelta", error: "Elige el día de la actividad." };
			var desde = ctx.desde || ctx.hoy, hasta = ctx.hasta || null;
			if (desde && fecha < desde) return { ok: false, foco: "fechaSuelta", error: "El día de la actividad debe ser del trimestre en curso (desde el " + fechaCorta(desde) + ")." };
			if (hasta && fecha > hasta) return { ok: false, foco: "fechaSuelta", error: "El día de la actividad debe ser del trimestre en curso (hasta el " + fechaCorta(hasta) + ")." };
		}
		var v = validarNuevo(d, ctx);
		if (!v.ok) return v;
		v.fecha = d.tipo === "tarea" ? ctx.hoy : fecha;
		return v;
	}

	var api = {
		CAMPOS: CAMPOS, TIPOS: TIPOS, NOMBRE_MAX: NOMBRE_MAX,
		planAsignacion: planAsignacion, filasDeEdicion: filasDeEdicion, resumenPara: resumenPara, validarSuelta: validarSuelta,
		rangoTrimestre: rangoTrimestre,
		gradosOrdenados: gradosOrdenados,
		fasesDeGrados: fasesDeGrados, buscarContenidos: buscarContenidos,
		pdaDeSesionParaActividad: pdaDeSesionParaActividad, pdaMarcadosPorOmision: pdaMarcadosPorOmision,
		planLigas: planLigas,
		etiquetaGrados: etiquetaGrados, siguientesPorProyecto: siguientesPorProyecto,
		gradosPorOmision: gradosPorOmision, validarNuevo: validarNuevo, validarNombre: validarNombre,
		tieneCaptura: tieneCaptura,
	};
	if (typeof window !== "undefined") window.ProductosHoy = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
