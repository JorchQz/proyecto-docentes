/*
	proyecto-edicion.js — Reglas de "Crear proyecto" y "Proyectos" que no dependen de la
	pantalla (se prueban en node: pruebas/proyecto-edicion.test.js).

	Decisiones de Jorge del 2026-09-26 (piloto de Fanny):
	  - Un proyecto INICIADO se puede editar: se agregan sesiones y se corrigen las que aún no
	    se trabajan. Una sesión TRABAJADA es la que tiene fecha (se trabajó en Hoy) o tiene
	    calificaciones; en ella queda fijo lo que afecta lo evaluado (campo formativo, PDA y
	    criterios, tareas del cierre) y su texto (inicio, desarrollo, cierre, actividades,
	    recursos, observaciones, duración, secuencia) sí se corrige. Una sesión trabajada no se
	    elimina. En un proyecto con sesiones trabajadas no cambian el trimestre ni los grados,
	    y los campos formativos que ya tiene no se quitan (se pueden agregar).
	  - Paso 1: grados y campos formativos son obligatorios, con mensaje claro.
	  - Escenario y secuencia con los nombres oficiales de docs/CONTEXTO.md §2: escenarios
	    Aula · Escuela · Comunidad (antes la pantalla guardaba "Escolar"/"Comunitario", los del
	    bot); momentos de la tabla ltg_metodologias_estructuras. Al leer se aceptan las dos
	    formas; lo guardado no se reescribe hasta que la maestra vuelve a guardar el proyecto.
*/

(function () {
	"use strict";

	// ── Escenario ───────────────────────────────────────────────────────────────
	var ESCENARIOS = ["Aula", "Escuela", "Comunidad"];
	var ESCENARIO_BOT = { "Escolar": "Escuela", "Comunitario": "Comunidad" };
	function escenarioOficial(valor) {
		var v = String(valor || "").trim();
		return ESCENARIO_BOT[v] || v;
	}

	// ── Secuencia (momentos por metodología) ────────────────────────────────────
	// Fuente de verdad: ltg_metodologias_estructuras (docs/CONTEXTO.md §2)
	var MOMENTOS = {
		ABPC: ["Identificación", "Recuperación", "Planificación", "Acercamiento", "Comprensión y producción",
			"Reconocimiento", "Concreción", "Integración", "Difusión", "Consideraciones", "Avances"],
		STEAM: ["Introducción al tema / Saberes previos", "Diseño y desarrollo de la indagación",
			"Establecer conclusiones", "Presentación de resultados y propuesta de acción", "Metacognición / Reflexión"],
		ABP: ["Presentemos", "Recolectemos", "Formulemos el problema", "Organicemos la experiencia",
			"Vivamos la experiencia", "Resultados y análisis"],
		AS: ["Punto de partida", "Lo que sé y lo que quiero saber", "Organicemos las actividades",
			"Creatividad en marcha", "Compartimos y evaluamos lo aprendido"],
	};
	// Los nombres que guardaba la pantalla antes del 2026-09-26 (misma posición = mismo momento)
	var MOMENTOS_ANTERIORES = {
		ABPC: ["1. Identificamos", "2. Recuperamos", "3. Planificamos", "4. Nos acercamos", "5. Vamos y volvemos",
			"6. Reorientamos", "7. Seguimos", "8. Integramos", "9. Difundimos", "10. Consideramos", "11. Avanzamos"],
		STEAM: ["Fase 1. Introducción al tema", "Fase 2. Diseño de investigación", "Fase 3. Organizar y estructurar respuestas",
			"Fase 4. Presentación de resultados", "Fase 5. Metacognición"],
		ABP: ["1. Presentemos", "2. Recolectemos", "3. Formulemos el problema", "4. Organicemos la experiencia",
			"5. Vivamos la experiencia", "6. Resultados y análisis"],
		AS: ["Etapa 1. Punto de partida", "Etapa 2. Lo que sé y lo que quiero saber", "Etapa 3. Organicemos las actividades",
			"Etapa 4. Creatividad en marcha", "Etapa 5. Compartimos y evaluamos"],
	};

	// [{ valor: nombre oficial (lo que se guarda), etiqueta: "3. Planificación" }]
	function opcionesSecuencia(metodologia) {
		return (MOMENTOS[metodologia] || []).map(function (m, i) {
			return { valor: m, etiqueta: (i + 1) + ". " + m };
		});
	}

	// Un momento guardado (oficial, el nombre viejo de la pantalla o con número) → el oficial
	function momentoOficial(metodologia, valor) {
		var v = String(valor || "").trim();
		if (!v) return "";
		var oficiales = MOMENTOS[metodologia] || [];
		if (oficiales.indexOf(v) !== -1) return v;
		var viejos = MOMENTOS_ANTERIORES[metodologia] || [];
		var i = viejos.indexOf(v);
		if (i !== -1 && oficiales[i]) return oficiales[i];
		// "3. Planificación" → "Planificación"
		var sinNumero = v.replace(/^(fase|etapa)?\s*\d+\.\s*/i, "");
		if (oficiales.indexOf(sinNumero) !== -1) return sinNumero;
		return v; // desconocido: se conserva tal cual
	}

	// ── Paso 1 ──────────────────────────────────────────────────────────────────
	// d: { titulo, trimestre, grados, campos_formativos, metodologia, escenario }
	function validarPaso1(d) {
		d = d || {};
		if (!String(d.titulo || "").trim()) return { ok: false, foco: "titulo", error: "Escribe el título del proyecto." };
		if (!(Number(d.trimestre) >= 1 && Number(d.trimestre) <= 3)) return { ok: false, foco: "trimestre", error: "Elige el trimestre del proyecto." };
		if (!Array.isArray(d.grados) || !d.grados.length) {
			return { ok: false, foco: "grados", error: "Elige al menos un grado. Cada grado que elijas tendrá su producto para calificar en cada sesión." };
		}
		if (!Array.isArray(d.campos_formativos) || !d.campos_formativos.length) {
			return { ok: false, foco: "campos", error: "Elige al menos un campo formativo. Es el que recibe las calificaciones en la boleta." };
		}
		if (!String(d.metodologia || "").trim()) return { ok: false, foco: "metodologia", error: "Elige la metodología del proyecto." };
		if (!String(d.escenario || "").trim()) return { ok: false, foco: "escenario", error: "Elige el escenario del proyecto." };
		return { ok: true, error: "" };
	}

	// Llave del catálogo del paso 2: si cambian fases o grados, el catálogo se vuelve a leer
	function claveCatalogo(fases, grados) {
		var f = (fases || []).map(String).sort().join(",");
		var g = (grados || []).map(Number).filter(function (x) { return !isNaN(x); }).sort(function (a, b) { return a - b; }).join(",");
		return f + "|" + g;
	}

	// ── Sesiones ────────────────────────────────────────────────────────────────
	// conCalificaciones: { [sesionId]: true } de las sesiones con alguna calificación
	function sesionTrabajada(sesion, conCalificaciones) {
		if (!sesion) return false;
		return !!sesion.fecha || !!(conCalificaciones && sesion.id && conCalificaciones[sesion.id]);
	}

	// Lo que se puede corregir en una sesión trabajada (no toca lo evaluado)
	var CAMPOS_TEXTO_SESION = [
		"numero_sesion", "duracion", "momento",
		"inicio_todos", "inicio_diferenciado", "inicio_actividades",
		"desarrollo_todos", "desarrollo_diferenciado", "desarrollo_actividades",
		"cierre_todos", "cierre_diferenciado", "cierre_actividades",
		"recursos", "observaciones",
	];
	function soloTexto(payload) {
		var out = {};
		CAMPOS_TEXTO_SESION.forEach(function (k) { if (payload && k in payload) out[k] = payload[k]; });
		return out;
	}

	// Números de las sesiones sin campo formativo (el paso 3 las pide antes de guardar)
	function sesionesSinCampo(sesiones) {
		return (sesiones || []).map(function (s, i) {
			return String(s && s.campo_formativo || "").trim() ? null : (s && s.numero_sesion) || i + 1;
		}).filter(function (n) { return n !== null; });
	}

	/*
		Qué hacer con las sesiones guardadas al volver a guardar un proyecto.
		originales: [{ id, trabajada }] (lo que había al abrir, revisado de nuevo al guardar)
		bloques: [{ sesionId }] en el orden de la pantalla (sesionId null = sesión nueva)
		→ { borrar: [ids], faltanTrabajadas: [ids], trabajadasDesdeQueAbrio: [ids] }
		Una sesión trabajada nunca se borra; si la pantalla la quitó (no debería poder), no se
		guarda nada.
	*/
	function planGuardado(originales, bloques, trabajadasAlAbrir) {
		var enPantalla = {};
		(bloques || []).forEach(function (b) { if (b && b.sesionId) enPantalla[b.sesionId] = true; });
		var abrio = trabajadasAlAbrir || {};
		var r = { borrar: [], faltanTrabajadas: [], trabajadasDesdeQueAbrio: [] };
		(originales || []).forEach(function (o) {
			if (o.trabajada && !abrio[o.id]) r.trabajadasDesdeQueAbrio.push(o.id);
			if (enPantalla[o.id]) return;
			if (o.trabajada) r.faltanTrabajadas.push(o.id);
			else r.borrar.push(o.id);
		});
		return r;
	}

	// ── Clonar ──────────────────────────────────────────────────────────────────
	// Copia de una sesión para un proyecto clonado: el plan sí, sin fecha, estado, notas ni calificaciones
	var CAMPOS_PLAN_SESION = [
		"numero_sesion", "duracion", "campo_formativo", "momento",
		"inicio_todos", "inicio_diferenciado", "inicio_actividades",
		"desarrollo_todos", "desarrollo_diferenciado", "desarrollo_actividades",
		"cierre_todos", "cierre_diferenciado", "cierre_actividades", "cierre_tareas",
		"pda_sesion", "recursos", "criterios_evaluacion", "observaciones",
	];
	function copiaDeSesion(sesion, proyectoId, maestroId) {
		var fila = { proyecto_id: proyectoId, maestro_id: maestroId, estado_sesion: "pendiente", fecha: null };
		CAMPOS_PLAN_SESION.forEach(function (k) { if (sesion && k in sesion) fila[k] = sesion[k]; });
		return fila;
	}

	var api = {
		ESCENARIOS: ESCENARIOS, escenarioOficial: escenarioOficial,
		MOMENTOS: MOMENTOS, MOMENTOS_ANTERIORES: MOMENTOS_ANTERIORES,
		opcionesSecuencia: opcionesSecuencia, momentoOficial: momentoOficial,
		validarPaso1: validarPaso1, claveCatalogo: claveCatalogo,
		sesionTrabajada: sesionTrabajada, CAMPOS_TEXTO_SESION: CAMPOS_TEXTO_SESION, soloTexto: soloTexto,
		sesionesSinCampo: sesionesSinCampo, planGuardado: planGuardado,
		CAMPOS_PLAN_SESION: CAMPOS_PLAN_SESION, copiaDeSesion: copiaDeSesion,
	};
	if (typeof window !== "undefined") window.ProyectoEdicion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
