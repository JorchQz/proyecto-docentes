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

	// ── Solo lo que cambió ──────────────────────────────────────────────────────
	// jsonb guarda las llaves en otro orden: se comparan con las llaves ordenadas
	function estable(v) {
		if (Array.isArray(v)) return "[" + v.map(estable).join(",") + "]";
		if (v && typeof v === "object") {
			return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + estable(v[k]); }).join(",") + "}";
		}
		return JSON.stringify(v === undefined ? null : v);
	}
	function vacio(v) { return v === null || v === undefined || v === ""; }
	/*
		Sin contenido: null, "", [] o un objeto cuyos valores (salvo "mode") no traen nada. Así
		{ mode: "todos", todos: [], diferenciado: null } (lo que arma la pantalla) es lo mismo que
		null (lo que guardó el bot en una sesión sin tareas) y abrir y guardar no reescribe la fila.
	*/
	function sinContenido(v) {
		if (vacio(v)) return true;
		if (Array.isArray(v)) return v.every(sinContenido);
		if (typeof v === "object") return Object.keys(v).every(function (k) { return k === "mode" || sinContenido(v[k]); });
		return false;
	}
	/*
		El modo ("todos" o "diferenciado") es lo único que guarda cómo se muestra una sección sin
		pasos en lista: dos objetos vacíos con distinto modo NO son lo mismo (R30, 2026-09-27: pasar
		el Cierre de "Diferenciado" a "Igual para todos" o el Desarrollo a "Diferenciado" sin pasos
		no se guardaba; al volver a abrir, la tarea se borraba o el texto por grado se volvía
		"[object Object]"). null sigue siendo igual a cualquier objeto vacío (el bot guarda null).
	*/
	function modoDe(v) { return v && typeof v === "object" && !Array.isArray(v) && "mode" in v ? (v.mode || "todos") : null; }
	function mismoValor(a, b) {
		if (vacio(a) && vacio(b)) return true;
		if (a && typeof a === "object" && b && typeof b === "object" && sinContenido(a) && sinContenido(b)) {
			var ma = modoDe(a), mb = modoDe(b);
			return ma === null || mb === null || ma === mb;
		}
		if ((vacio(a) && b && typeof b === "object" && sinContenido(b)) || (vacio(b) && a && typeof a === "object" && sinContenido(a))) return true;
		if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
		return estable(a) === estable(b);
	}
	/*
		cambiosDeSesion(fila, original, alAbrir) → solo las columnas que cambiaron (sin maestro_id ni
		proyecto_id). Así el guardado solo manda PATCH de lo que la docente cambió.
		  alAbrir: la fila que armó la pantalla al abrir el proyecto (payloadDeBloque justo después
		    de dibujar la sesión). Con ella, una columna cambia solo si la docente la cambió en la
		    pantalla (comparación exacta con alAbrir): guardar sin tocar nada no escribe nada, ni
		    siquiera lo que la pantalla no sabe mostrar tal cual (un grado con dos PDA, texto común
		    con pasos por grado), y cualquier cambio en la pantalla (también solo el modo de una
		    sección) sí se escribe. Es la regla que usa Crear proyecto (2026-09-27, R30).
		  Sin alAbrir (una sesión recién insertada en un reintento): se compara con lo guardado
		    (mismoValor: null y el objeto vacío son lo mismo; el modo cuenta). Sin original: la fila
		    completa.
	*/
	function cambiosDeSesion(fila, original, alAbrir) {
		var out = {};
		var conPantalla = alAbrir && typeof alAbrir === "object";
		Object.keys(fila || {}).forEach(function (k) {
			if (k === "maestro_id" || k === "proyecto_id") return;
			var cambio = conPantalla && k in alAbrir
				? estable(fila[k]) !== estable(alAbrir[k])
				: !original || !mismoValor(fila[k], original[k]);
			if (cambio) out[k] = fila[k];
		});
		return out;
	}

	/*
		── Nunca "[object Object]" en un texto (R30, 2026-09-27) ──
		seccionAlAbrir(textoTodos, textoDif, actividades) → { modo, texto, porGrado }: lo que la
		pantalla pone en una sección al abrir. El texto común va SIEMPRE como texto (un objeto nunca
		llega a la caja: así se guardaba "[object Object]") y el texto por grado, como objeto de
		textos. Si la fila dice "todos" pero solo trae texto por grado (lo que dejaba el defecto de
		R30), se abre como "Diferenciado" para que la docente vea su texto.
		textoDeCampo(v) → el valor de una caja de texto para guardar: sin "[object Object]"; vacío → null.
	*/
	var OBJETO_COMO_TEXTO = /\[object Object\]/g;
	function textoDeCampo(v) {
		if (v === null || v === undefined) return null;
		if (typeof v === "object") return null;
		var t = String(v).replace(OBJETO_COMO_TEXTO, "").trim();
		return t || null;
	}
	function seccionAlAbrir(textoTodos, textoDif, actividades) {
		var texto = typeof textoTodos === "string" ? textoTodos : "";
		var porGrado = {};
		if (textoDif && typeof textoDif === "object" && !Array.isArray(textoDif)) {
			Object.keys(textoDif).forEach(function (k) {
				var v = textoDif[k];
				if (typeof v === "string" && v.trim()) porGrado[k] = v;
			});
		}
		var modo = actividades && typeof actividades === "object" && actividades.mode === "diferenciado" ? "diferenciado" : "todos";
		if (modo === "todos" && !texto.trim() && Object.keys(porGrado).length) modo = "diferenciado";
		return { modo: modo, texto: texto.replace(OBJETO_COMO_TEXTO, "").trim() ? texto : "", porGrado: porGrado };
	}

	/*
		── Guardar sin cambios no reescribe lo que la pantalla no sabía mostrar (2026-09-27) ──
		Encontrado con el proyecto PP-NIVELES de Fanny: al abrirlo en Crear proyecto y guardar sin
		tocar nada, las sesiones con cierre "igual para todos" y tareas POR GRADO (3, 6, 9, 12 y 15)
		perdían sus tareas (la pantalla solo tenía tareas por grado con TODO el cierre diferenciado)
		y el materializador las borraba. Lo mismo con los pasos por grupo de trabajo ("Morado") y con
		un PDA que la sesión no ofrece en su lista.
	*/

	// Tareas del cierre: "todos" (la lista de siempre) o "grado" (por grado aunque el texto del
	// cierre sea igual para todos). Con el cierre diferenciado, las tareas van en cada columna.
	function modoTareasAlAbrir(cierreTareas, modoCierre) {
		if (modoCierre === "diferenciado") return "todos";
		return cierreTareas && cierreTareas.mode === "diferenciado" ? "grado" : "todos";
	}

	function listaLimpia(v) {
		return (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v])
			.map(function (x) { return String(x === null || x === undefined ? "" : x).trim(); }).filter(Boolean);
	}

	/*
		tareasDelCierre(modoCierre, modoTareas, { todos, porGrado, porGradoDif }) → cierre_tareas
		  porGradoDif: las columnas del cierre diferenciado (como siempre, con sus llaves aunque vacías)
		  porGrado: las listas "Por grado" del cierre igual para todos (solo las que traen tareas)
	*/
	function tareasDelCierre(modoCierre, modoTareas, l) {
		l = l || {};
		if (modoCierre === "diferenciado") {
			var difCol = l.porGradoDif || {};
			return { mode: "diferenciado", todos: null, diferenciado: Object.keys(difCol).length ? difCol : null };
		}
		if (modoTareas === "grado") {
			var dif = {};
			Object.keys(l.porGrado || {}).forEach(function (g) {
				var items = listaLimpia(l.porGrado[g]);
				if (items.length) dif[g] = items;
			});
			return { mode: "diferenciado", todos: null, diferenciado: Object.keys(dif).length ? dif : null };
		}
		return { mode: "todos", todos: listaLimpia(l.todos), diferenciado: null };
	}

	/*
		actividadesDeSeccion(modo, { todos, porGrado, grupos }) → *_actividades
		  grupos: [{ llave: "Morado", items: [...] }] en el orden de la pantalla: los pasos por grupo
		  de trabajo (js/texto-sesion.js). Van en diferenciado con su llave y su orden en
		  orden_grupos, en los dos modos; un grupo sin pasos se quita.
	*/
	function actividadesDeSeccion(modo, l) {
		l = l || {};
		var grupos = {}, orden = [];
		(l.grupos || []).forEach(function (g) {
			var llave = String(g && g.llave || "").trim();
			var items = listaLimpia(g && g.items);
			if (!llave || !items.length || orden.indexOf(llave) !== -1) return;
			grupos[llave] = items;
			orden.push(llave);
		});
		var out;
		if (modo === "diferenciado") {
			var dif = Object.assign({}, l.porGrado || {}, grupos);
			out = { mode: "diferenciado", todos: null, diferenciado: Object.keys(dif).length ? dif : null };
		} else {
			out = { mode: "todos", todos: listaLimpia(l.todos), diferenciado: orden.length ? grupos : null };
		}
		if (orden.length) out.orden_grupos = orden;
		return out;
	}

	/*
		pdaSesionConservando(leidas, original) → pda_sesion
		  leidas: [{ grado, representable, entrada }] por cada grado del proyecto, en orden:
		    representable = la sesión tiene su lista de PDA para ese grado y, si ya tenía un PDA,
		    esa lista lo ofrece; entrada = lo que dice la pantalla ({grado, pda_id, pda_texto,
		    criterio_aplicado}) o null.
		  Un grado que la pantalla no puede mostrar conserva lo guardado (antes se guardaba vacío y
		  el materializador quitaba ese PDA de la sesión). Tampoco puede mostrar un grado con 2 o más
		  PDA guardados (su lista elige uno): se conservan todos, tal cual (R30, 2026-09-27: en los
		  proyectos de la tienda importados con el importador nuevo, guardar sin cambios dejaba solo
		  el último; sesiones_pda bajaba de 27 a 23, de 33 a 24 y de 20 a 10).
	*/
	function pdaGuardadosDeGrado(original, grado) {
		return (Array.isArray(original) ? original : []).filter(function (p) { return p && Number(p.grado) === Number(grado); });
	}
	/*
		Cambiar PDA (2026-10-02): lo que le pasa a lo ya guardado cuando la docente edita la lista de un
		grado. cambiosDePda(antes, despues) → { conservados, nuevos, quitados } por pda_id (la fila de
		sesiones_pda se identifica por sesión, PDA y grado: un PDA que se conserva es la MISMA fila y
		solo se actualiza su criterio; uno nuevo crea fila; uno quitado se borra si nada lo referencia).
		Una entrada sin pda_id (solo criterio) se identifica por su criterio.
	*/
	function clavePda(p) {
		return p && p.pda_id ? "p|" + p.pda_id : "c|" + String(p && p.criterio_aplicado || "").trim();
	}
	function cambiosDePda(antes, despues) {
		var a = {}, d = {};
		(antes || []).forEach(function (p) { a[clavePda(p)] = p; });
		(despues || []).forEach(function (p) { d[clavePda(p)] = p; });
		return {
			conservados: Object.keys(d).filter(function (k) { return a[k]; }).map(function (k) { return d[k]; }),
			nuevos: Object.keys(d).filter(function (k) { return !a[k]; }).map(function (k) { return d[k]; }),
			quitados: Object.keys(a).filter(function (k) { return !d[k]; }).map(function (k) { return a[k]; }),
		};
	}
	/*
		Un PDA quitado SOLO se borra si nada lo referencia (decisión del 2026-10-02). Lo referencia:
		  - evaluación formativa (evaluacion_formativa.sesion_pda_id), o
		  - una liga producto_sesion_pda que el plan NO haría solo: de un producto DEL CAMPO de la sesión
		    pero de otro grado (lo ligó la docente a mano, p. ej. una actividad de 2° con un PDA de 1°).
		Las ligas del plan (producto del campo de la sesión y de ese grado) NO lo protegen: se mueven
		al PDA que reemplazó (materializarSesiones liga cada producto con todos los PDA de su grado).
		Tampoco una liga de un producto de OTRO campo: materializarSesiones ya la quita de un PDA del plan
		(es lo que sobra al cambiar el campo de la sesión), así que no es una referencia que se conserve.
		refs: { evaluaciones: [{ sesion_pda_id }], ligas: [{ sesion_pda_id, campo, grados }] }
		→ "evaluacion" | "liga" | null
	*/
	function motivoDeProteccion(spda, refs, campoSesion) {
		refs = refs || {};
		if ((refs.evaluaciones || []).some(function (e) { return e.sesion_pda_id === spda.id; })) return "evaluacion";
		var manual = (refs.ligas || []).some(function (l) {
			if (l.sesion_pda_id !== spda.id || l.campo !== campoSesion) return false;
			var grados = (l.grados || []).map(function (g) { return parseInt(g, 10); });
			return grados.indexOf(Number(spda.grado)) === -1;
		});
		return manual ? "liga" : null;
	}
	function pdaSesionConservando(leidas, original) {
		var out = [];
		(leidas || []).forEach(function (l) {
			// "Cambiar PDA" (grado con 2 o más PDA, sesión sin trabajar): la docente editó la lista de
			// ese grado y esa lista, tal cual, es la que se guarda (puede quedar con 1 o con 0)
			if (Array.isArray(l.lista)) { l.lista.forEach(function (p) { out.push(p); }); return; }
			var suyos = pdaGuardadosDeGrado(original, l.grado);
			if (l.representable && suyos.length < 2) { if (l.entrada) out.push(l.entrada); return; }
			suyos.forEach(function (p) { out.push(p); });
		});
		return out.length ? out : null;
	}

	/*
		Escrituras protegidas contra la carrera "revisé que no estaba trabajada → escribo"
		(R24-r08): entre la revisión y la escritura, otra pestaña pudo trabajar la sesión en Hoy
		(le pone fecha) y calificarla. Por eso el borrado y la actualización completa llevan en
		el MISMO DELETE/PATCH la condición fecha IS NULL, y se cuenta qué filas se afectaron: una
		sesión que no se afectó es una que se empezó a trabajar mientras tanto.
		(Hoy solo califica sesiones con fecha: "Trabajar hoy" pone la fecha antes de que aparezcan
		sus productos para calificar.)
	*/
	async function borrarSinTrabajar(sb, ids, maestroId) {
		ids = (ids || []).filter(Boolean);
		if (!ids.length) return { borradas: [], intactas: [] };
		var res = await sb.from("sesiones").delete()
			.in("id", ids).eq("maestro_id", maestroId).is("fecha", null).select("id");
		if (res.error) throw res.error;
		var borradas = (res.data || []).map(function (r) { return r.id; });
		return { borradas: borradas, intactas: ids.filter(function (id) { return borradas.indexOf(id) === -1; }) };
	}
	// → la fila guardada, o null si la sesión ya tenía fecha (no se tocó)
	async function actualizarSinTrabajar(sb, id, cambios, maestroId, columnas) {
		var res = await sb.from("sesiones").update(cambios)
			.eq("id", id).eq("maestro_id", maestroId).is("fecha", null).select(columnas);
		if (res.error) throw res.error;
		return (res.data && res.data[0]) || null;
	}

	/*
		guardarSesiones(sb, t) — las escrituras de sesiones de un proyecto que ya existe.
		t: { maestroId, proyectoId, columnas,
		     borrar: [ids sin trabajar que la pantalla quitó],
		     existentes: [{ id, trabajada, completa, texto, actual }]
		       completa: cambios de la fila completa (sesión sin trabajar), ya reducidos a lo que cambió
		       texto: cambios solo de texto (ProyectoEdicion.soloTexto), ya reducidos
		       actual: la fila como está en la base (para materializar sin volver a leerla)
		     nuevas: [filas para insertar] }
		→ { materializar: [filas], cambiadas: { id: true } (las que recibieron PATCH completo),
		    borradas: [ids], insertadas: [filas], noBorradas: [ids], soloTexto: [ids] }
		  noBorradas: se iban a borrar pero ya se estaban trabajando (siguen, con sus calificaciones).
		  soloTexto: se iba a cambiar lo evaluado pero ya se estaban trabajando: solo se guardó su
		  texto, como en cualquier sesión trabajada.
	*/
	async function guardarSesiones(sb, t) {
		var r = { materializar: [], cambiadas: {}, insertadas: [], noBorradas: [], soloTexto: [] };
		var bor = await borrarSinTrabajar(sb, t.borrar, t.maestroId);
		r.noBorradas = bor.intactas;
		r.borradas = bor.borradas;
		for (var i = 0; i < (t.existentes || []).length; i++) {
			var e = t.existentes[i];
			if (e.trabajada) {
				if (Object.keys(e.texto || {}).length) {
					var rt = await sb.from("sesiones").update(e.texto).eq("id", e.id).eq("maestro_id", t.maestroId);
					if (rt.error) throw rt.error;
				}
				continue;
			}
			if (!Object.keys(e.completa || {}).length) {
				// Sin cambios: se materializa con lo que hay (por si cambiaron los grados del proyecto)
				if (e.actual) r.materializar.push(e.actual);
				continue;
			}
			var guardada = await actualizarSinTrabajar(sb, e.id, e.completa, t.maestroId, t.columnas);
			if (guardada) {
				r.materializar.push(guardada);
				r.cambiadas[e.id] = true;
				continue;
			}
			// Se empezó a trabajar mientras tanto: solo su texto
			r.soloTexto.push(e.id);
			if (Object.keys(e.texto || {}).length) {
				var rt2 = await sb.from("sesiones").update(e.texto).eq("id", e.id).eq("maestro_id", t.maestroId);
				if (rt2.error) throw rt2.error;
			}
		}
		if ((t.nuevas || []).length) {
			var ins = await sb.from("sesiones").insert(t.nuevas).select(t.columnas);
			if (ins.error) throw ins.error;
			r.insertadas = ins.data || [];
		}
		return r;
	}

	// Aviso cuando algo se empezó a trabajar a media escritura (nunca dice "guardado")
	function avisoCarrera(numeros) {
		var n = (numeros || []).filter(function (x) { return x !== null && x !== undefined && x !== ""; });
		var una = n.length <= 1;
		var cuales = una ? "la sesión " + (n[0] || "") : "las sesiones " + n.slice(0, -1).join(", ") + " y " + n[n.length - 1];
		return "Mientras editabas, se empezó a trabajar " + cuales.trim() + " (en Hoy o en otro dispositivo). " +
			(una ? "Esa sesión no se borró ni cambió su" : "Esas sesiones no se borraron ni cambiaron su") +
			" campo formativo, PDA ni tareas: " + (una ? "quedó" : "quedaron") + " con sus calificaciones. " +
			"El resto de tus cambios se escribió. Recarga la página para revisar cómo quedó antes de seguir editando.";
	}

	// ── Duplicar ────────────────────────────────────────────────────────────────
	// Copia de una sesión para un proyecto duplicado: el plan sí, sin fecha, estado, notas ni calificaciones
	var CAMPOS_PLAN_SESION = [
		"numero_sesion", "duracion", "campo_formativo", "momento",
		"inicio_todos", "inicio_diferenciado", "inicio_actividades",
		"desarrollo_todos", "desarrollo_diferenciado", "desarrollo_actividades",
		"cierre_todos", "cierre_diferenciado", "cierre_actividades", "cierre_tareas",
		"pda_sesion", "recursos", "criterios_evaluacion", "observaciones",
	];
	// Trimestre de una copia: el que el grupo trabaja ahora (como un proyecto nuevo); sin él, el
	// del original. Antes "Clonar" (solo en completados) pasaba al trimestre siguiente, lo que no
	// tiene sentido al duplicar un borrador o un proyecto activo.
	function trimestreDeCopia(original, grupo) {
		var delGrupo = parseInt(grupo && grupo.trimestre_actual, 10);
		if (delGrupo >= 1 && delGrupo <= 3) return delGrupo;
		var delOriginal = parseInt(original && original.trimestre, 10);
		return delOriginal >= 1 && delOriginal <= 3 ? delOriginal : 1;
	}

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
		cambiosDeSesion: cambiosDeSesion, sinContenido: sinContenido, mismoValor: mismoValor, borrarSinTrabajar: borrarSinTrabajar,
		textoDeCampo: textoDeCampo, seccionAlAbrir: seccionAlAbrir,
		modoTareasAlAbrir: modoTareasAlAbrir, tareasDelCierre: tareasDelCierre,
		actividadesDeSeccion: actividadesDeSeccion, pdaSesionConservando: pdaSesionConservando, pdaGuardadosDeGrado: pdaGuardadosDeGrado,
		cambiosDePda: cambiosDePda, motivoDeProteccion: motivoDeProteccion, clavePda: clavePda,
		actualizarSinTrabajar: actualizarSinTrabajar, guardarSesiones: guardarSesiones, avisoCarrera: avisoCarrera,
		CAMPOS_PLAN_SESION: CAMPOS_PLAN_SESION, copiaDeSesion: copiaDeSesion, trimestreDeCopia: trimestreDeCopia,
	};
	if (typeof window !== "undefined") window.ProyectoEdicion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
