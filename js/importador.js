/*
	importador.js — Copia un proyecto del marketplace (dosificacion_*) a las tablas
	del maestro (proyectos / sesiones), reasignando dueño y grupo y traduciendo los
	nombres de metodología/escenario y columnas de sesión al shape nativo del SaaS.

	Expone: window.importarProyecto(dosProyectoId, maestroId, grupoId, opciones) -> Promise<id>
	  opciones (todas opcionales; la tienda no pasa ninguna):
	    trimestre: el del proyecto nuevo (por omisión el de la dosificación)
	    estado: 'borrador' (por omisión) | 'activo'
	    ajustarSesion(fila, dosSesion): cambia la fila de `sesiones` antes de insertarla
	    antesDeMaterializar(sesionesInsertadas, proyecto): async; lo que se inserta antes de
	      materializar (p. ej. productos con nombre por grupo de trabajo que el materializador
	      empareja con su hueco en vez de crear el genérico)
	y, para scripts/cargar-pp-niveles.js y las pruebas (node), Importador.filasDeImportacion:
	la regla sin base de datos.

	Correcciones del 2026-09-27 (proyecto PP-NIVELES de Fanny):
	  - pda_sesion: el bot guarda en pda_id el id de dosificacion_pdas (bot/instrucciones_planeacion.md,
	    "pda_id = id real de dosificacion_pdas"), no el del catálogo; sesiones_pda.pda_id es FK a
	    catalogo_pda y la materialización fallaba. Se traduce con dosificacion_pdas.pda_id.
	  - contenidos_pda del proyecto (el paso 2 de Crear proyecto): se arma con los contenidos y
	    PDA de dosificacion_pdas. Sin él, Crear proyecto no ofrecía los PDA de cada sesión y al
	    guardar sin cambios los quitaba (pda_sesion vacío → el materializador borraba sus PDA).
	  - cierre_tareas por grado: el bot guarda cada grado como texto ("1": "Platica…"); se guarda
	    como lista, como Crear proyecto (Inicio y Crear proyecto recorrían la lista).
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;

	// dosificacion (nombre completo) -> SaaS (abreviación)
	var METODOLOGIA_MAP = {
		"Proyectos Comunitarios": "ABPC",
		"Indagación (STEAM)": "STEAM",
		"Aprendizaje Basado en Problemas": "ABP",
		"Aprendizaje Servicio": "AS",
	};

	var ESCENARIO_MAP = {
		"Aula": "Aula",
		"Escolar": "Escuela",
		"Comunitario": "Comunidad",
	};

	function comoLista(v) {
		if (v === null || v === undefined) return [];
		return (Array.isArray(v) ? v : [v]).map(function (x) { return typeof x === "string" ? x.trim() : x; })
			.filter(function (x) { return x !== "" && x !== null && x !== undefined; });
	}

	// { mode, todos, diferenciado: { "1": "texto" } } → las mismas llaves con listas
	function normalizarTareas(ct) {
		if (!ct || typeof ct !== "object" || Array.isArray(ct)) return ct || null;
		var out = Object.assign({}, ct);
		if (ct.todos !== null && ct.todos !== undefined) out.todos = comoLista(ct.todos);
		if (ct.diferenciado && typeof ct.diferenciado === "object") {
			out.diferenciado = {};
			Object.keys(ct.diferenciado).forEach(function (k) { out.diferenciado[k] = comoLista(ct.diferenciado[k]); });
		}
		return out;
	}

	/*
		contenidos_pda en el formato del paso 2 de Crear proyecto:
		{ "<campo formativo>": { contenidos_ids: [...], pda_ids: [...], contenidos_texto: [...] } }
		dosPdas: filas de dosificacion_pdas (contenido_id, pda_id del catálogo, campo_formativo,
		contenido_texto), en el orden en que se leyeron.
	*/
	function contenidosDesdePdas(dosPdas) {
		var out = {};
		(dosPdas || []).forEach(function (d) {
			if (!d || !d.campo_formativo) return;
			var c = out[d.campo_formativo] || (out[d.campo_formativo] = { contenidos_ids: [], pda_ids: [], contenidos_texto: [] });
			if (d.contenido_id && c.contenidos_ids.indexOf(String(d.contenido_id)) === -1) c.contenidos_ids.push(String(d.contenido_id));
			if (d.pda_id && c.pda_ids.indexOf(String(d.pda_id)) === -1) c.pda_ids.push(String(d.pda_id));
			var t = d.contenido_texto ? String(d.contenido_texto).trim() : "";
			if (t && c.contenidos_texto.indexOf(t) === -1) c.contenidos_texto.push(t);
		});
		return out;
	}

	// pda_sesion del bot → pda_id del catálogo (el de dosificacion_pdas); uno que ya es del
	// catálogo (no está en dosificacion_pdas) se queda igual
	function traducirPdaSesion(pdaSesion, dosPdas) {
		if (!Array.isArray(pdaSesion)) return pdaSesion || null;
		var porDosId = {};
		(dosPdas || []).forEach(function (d) { if (d && d.id) porDosId[String(d.id)] = d; });
		return pdaSesion.map(function (p) {
			if (!p || !p.pda_id) return p;
			var d = porDosId[String(p.pda_id)];
			if (!d || !d.pda_id) return p;
			return Object.assign({}, p, { pda_id: String(d.pda_id), pda_texto: p.pda_texto || d.pda_texto || null });
		});
	}

	/*
		filasDeImportacion(dosProy, dosSesiones, dosPdas, { maestroId, grupoId, trimestre, estado })
		→ { proyecto: fila de proyectos, sesiones: [filas de sesiones sin proyecto_id] }
		Notas de mapeo (verificadas contra el esquema real de Supabase):
		- dosificacion_proyectos.nombre_proyecto -> proyectos.titulo
		- dosificacion_proyectos.fase es text ('Fase 3'); proyectos.fase es text[]
		  validado como subconjunto de ['Fase 3','Fase 4','Fase 5'] -> envolver en array
		- dosificacion_proyectos no tiene 'proposito'; se usa 'producto_final' como
		  propósito y, en su defecto, queda null
		- proyectos NO tiene columna 'ciclo_escolar' -> no se inserta
		- sesiones: sin fecha (se trabajan con "Trabajar hoy"), en el orden de numero_sesion
	*/
	function filasDeImportacion(dosProy, dosSesiones, dosPdas, opts) {
		opts = opts || {};
		var proyecto = {
			maestro_id: opts.maestroId,
			grupo_id: opts.grupoId,
			titulo: dosProy.nombre_proyecto,
			metodologia: METODOLOGIA_MAP[dosProy.metodologia] || dosProy.metodologia,
			escenario: ESCENARIO_MAP[dosProy.escenario] || dosProy.escenario,
			campos_formativos: dosProy.campos_formativos,
			grados: dosProy.grados,
			trimestre: opts.trimestre || dosProy.trimestre,
			fase: dosProy.fase ? [dosProy.fase] : null,
			proposito: dosProy.producto_final || null,
			pregunta_generadora: dosProy.pregunta_generadora,
			ejes_articuladores: dosProy.ejes_articuladores,
			es_multigrado: (dosProy.grados || []).length > 1,
			estado: opts.estado || "borrador",
			visible_mercado: false,
		};
		var contenidos = contenidosDesdePdas(dosPdas);
		if (Object.keys(contenidos).length) proyecto.contenidos_pda = contenidos;
		var ordenadas = (dosSesiones || []).slice().sort(function (a, b) {
			return (Number(a.numero_sesion) || 0) - (Number(b.numero_sesion) || 0);
		});
		var sesiones = ordenadas.map(function (ds) {
			return {
				maestro_id: opts.maestroId,
				numero_sesion: ds.numero_sesion,
				duracion: ds.duracion_minutos ? ds.duracion_minutos + " min" : null,
				campo_formativo: ds.campo_formativo,
				momento: ds.momento || ds.momento_metodologico, // 'momento' real; alias histórico de respaldo
				inicio_todos: ds.inicio_todos,
				inicio_diferenciado: ds.inicio_diferenciado,
				inicio_actividades: ds.inicio_actividades,
				desarrollo_todos: ds.desarrollo_todos,
				desarrollo_diferenciado: ds.desarrollo_diferenciado,
				desarrollo_actividades: ds.desarrollo_actividades,
				cierre_todos: ds.cierre_todos,
				cierre_diferenciado: ds.cierre_diferenciado,
				cierre_actividades: ds.cierre_actividades,
				cierre_tareas: normalizarTareas(ds.cierre_tareas),
				pda_sesion: traducirPdaSesion(ds.pda_sesion, dosPdas),
				recursos: ds.recursos,
				observaciones: ds.observaciones || null,
				estado_sesion: "pendiente",
			};
		});
		// origen[i]: la fila de dosificacion_sesiones de sesiones[i] (mismo orden)
		return { proyecto: proyecto, sesiones: sesiones, origen: ordenadas };
	}

	async function importarProyecto(dosProyectoId, maestroId, grupoId, opciones) {
		var sb = raiz.sb;
		opciones = opciones || {};
		if (!sb) {
			throw new Error("Supabase no está inicializado.");
		}
		if (!dosProyectoId || !maestroId || !grupoId) {
			throw new Error("Faltan datos para importar (proyecto, docente o grupo).");
		}

		// 1. Leer dosificacion_proyecto
		var proyRes = await sb
			.from("dosificacion_proyectos")
			.select("*")
			.eq("id", dosProyectoId)
			.single();

		if (proyRes.error) { throw proyRes.error; }
		var dosProy = proyRes.data;
		if (!dosProy) { throw new Error("No se encontró el proyecto en el catálogo."); }

		// 2. Leer dosificacion_sesiones del proyecto
		var sesRes = await sb
			.from("dosificacion_sesiones")
			.select("*")
			.eq("proyecto_dos_id", dosProyectoId)
			.order("numero_sesion", { ascending: true });

		if (sesRes.error) { throw sesRes.error; }
		var dosSesiones = sesRes.data || [];

		// 2b. Sus PDA (para traducir pda_id al catálogo y armar contenidos_pda)
		var pdaRes = await sb
			.from("dosificacion_pdas")
			.select("id, pda_id, contenido_id, grado, campo_formativo, contenido_texto, pda_texto")
			.eq("proyecto_dos_id", dosProyectoId)
			.order("campo_formativo").order("grado").order("id");
		if (pdaRes.error) { throw pdaRes.error; }

		var filas = filasDeImportacion(dosProy, dosSesiones, pdaRes.data || [], {
			maestroId: maestroId, grupoId: grupoId, trimestre: opciones.trimestre, estado: opciones.estado,
		});

		// 3. INSERT en proyectos
		var nuevoProyRes = await sb
			.from("proyectos")
			.insert(filas.proyecto)
			.select()
			.single();

		if (nuevoProyRes.error) { throw nuevoProyRes.error; }
		var nuevoProy = nuevoProyRes.data;

		// 4. INSERT sesiones (mapear columnas dosificacion -> sesiones)
		if (filas.sesiones.length) {
			var sesionesPayload = filas.sesiones.map(function (fila, i) {
				fila.proyecto_id = nuevoProy.id;
				return opciones.ajustarSesion ? opciones.ajustarSesion(fila, filas.origen[i]) || fila : fila;
			});

			var sesInsertRes = await sb.from("sesiones")
				.insert(sesionesPayload)
				.select("id, numero_sesion, campo_formativo, pda_sesion, cierre_tareas");
			if (sesInsertRes.error) {
				// Revertir: eliminar el proyecto recién creado para evitar estado parcial
				await sb.from("proyectos").delete().eq("id", nuevoProy.id);
				throw sesInsertRes.error;
			}

			// 5. Materializar trazabilidad: sesiones_pda + productos_sesion (+ links).
			//    El trabajo genérico va con origen 'backfill' (la dosificación aún no
			//    trae el nombre real del producto); las tareas sí son contenido real.
			//    Lo que inserte antesDeMaterializar (productos con nombre) llena su hueco.
			if (raiz.materializarSesiones) {
				try {
					if (opciones.antesDeMaterializar) await opciones.antesDeMaterializar(sesInsertRes.data || [], nuevoProy);
					var resumen = await raiz.materializarSesiones(sesInsertRes.data || [], maestroId, {
						gradosProyecto: dosProy.grados || [],
						// Una sesión sin campo toma el del proyecto si es uno solo; si no, se revierte
						// la importación con el aviso (antes quedaba como LEN en silencio)
						camposProyecto: dosProy.campos_formativos || [],
						origenTrabajo: "backfill",
						origenTarea: "importado",
					});
					if (opciones.alMaterializar) opciones.alMaterializar(resumen);
				} catch (matErr) {
					// Revertir todo: el delete de proyectos cascadea sesiones -> sesiones_pda/productos_sesion
					await sb.from("proyectos").delete().eq("id", nuevoProy.id);
					throw matErr;
				}
			}
		}

		return nuevoProy.id; // ID del proyecto importado
	}

	var api = {
		METODOLOGIA_MAP: METODOLOGIA_MAP, ESCENARIO_MAP: ESCENARIO_MAP,
		normalizarTareas: normalizarTareas, contenidosDesdePdas: contenidosDesdePdas,
		traducirPdaSesion: traducirPdaSesion, filasDeImportacion: filasDeImportacion,
		importarProyecto: importarProyecto,
	};
	raiz.importarProyecto = importarProyecto;
	raiz.Importador = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
