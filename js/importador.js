/*
	importador.js — Copia un proyecto del marketplace (dosificacion_*) a las tablas
	del maestro (proyectos / sesiones), reasignando dueño y grupo y traduciendo los
	nombres de metodología/escenario y columnas de sesión al shape nativo del SaaS.

	Expone: window.importarProyecto(dosProyectoId, maestroId, grupoId) -> Promise<id>
*/

(function () {
	"use strict";

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

	async function importarProyecto(dosProyectoId, maestroId, grupoId) {
		if (!window.sb) {
			throw new Error("Supabase no está inicializado.");
		}
		if (!dosProyectoId || !maestroId || !grupoId) {
			throw new Error("Faltan datos para importar (proyecto, maestro o grupo).");
		}

		// 1. Leer dosificacion_proyecto
		var proyRes = await window.sb
			.from("dosificacion_proyectos")
			.select("*")
			.eq("id", dosProyectoId)
			.single();

		if (proyRes.error) { throw proyRes.error; }
		var dosProy = proyRes.data;
		if (!dosProy) { throw new Error("No se encontró el proyecto en el catálogo."); }

		// 2. Leer dosificacion_sesiones del proyecto
		var sesRes = await window.sb
			.from("dosificacion_sesiones")
			.select("*")
			.eq("proyecto_dos_id", dosProyectoId)
			.order("numero_sesion", { ascending: true });

		if (sesRes.error) { throw sesRes.error; }
		var dosSesiones = sesRes.data || [];

		// 3. INSERT en proyectos
		//    Notas de mapeo (verificadas contra el esquema real de Supabase):
		//    - dosificacion_proyectos.nombre_proyecto -> proyectos.titulo
		//    - dosificacion_proyectos.fase es text ('Fase 3'); proyectos.fase es text[]
		//      validado como subconjunto de ['Fase 3','Fase 4','Fase 5'] -> envolver en array
		//    - dosificacion_proyectos no tiene 'proposito'; se usa 'producto_final' como
		//      propósito y, en su defecto, queda null
		//    - proyectos NO tiene columna 'ciclo_escolar' -> no se inserta
		var nuevoProyRes = await window.sb
			.from("proyectos")
			.insert({
				maestro_id: maestroId,
				grupo_id: grupoId,
				titulo: dosProy.nombre_proyecto,
				metodologia: METODOLOGIA_MAP[dosProy.metodologia] || dosProy.metodologia,
				escenario: ESCENARIO_MAP[dosProy.escenario] || dosProy.escenario,
				campos_formativos: dosProy.campos_formativos,
				grados: dosProy.grados,
				trimestre: dosProy.trimestre,
				fase: dosProy.fase ? [dosProy.fase] : null,
				proposito: dosProy.producto_final || null,
				pregunta_generadora: dosProy.pregunta_generadora,
				ejes_articuladores: dosProy.ejes_articuladores,
				es_multigrado: (dosProy.grados || []).length > 1,
				estado: "borrador",
				visible_mercado: false,
			})
			.select()
			.single();

		if (nuevoProyRes.error) { throw nuevoProyRes.error; }
		var nuevoProy = nuevoProyRes.data;

		// 4. INSERT sesiones (mapear columnas dosificacion -> sesiones)
		if (dosSesiones.length) {
			var sesionesPayload = dosSesiones.map(function (ds) {
				return {
					proyecto_id: nuevoProy.id,
					maestro_id: maestroId,
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
					cierre_tareas: ds.cierre_tareas,
					pda_sesion: ds.pda_sesion,
					recursos: ds.recursos,
					estado_sesion: "pendiente",
				};
			});

			var sesInsertRes = await window.sb.from("sesiones").insert(sesionesPayload);
			if (sesInsertRes.error) {
				// Revertir: eliminar el proyecto recién creado para evitar estado parcial
				await window.sb.from("proyectos").delete().eq("id", nuevoProy.id);
				throw sesInsertRes.error;
			}
		}

		return nuevoProy.id; // ID del proyecto importado
	}

	window.importarProyecto = importarProyecto;
})();
