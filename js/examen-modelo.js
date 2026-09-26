/*
	examen-modelo.js — Reglas de "Exámenes" de Mi Salón que no dependen de la pantalla (se
	prueban en node: pruebas/examen-salon.test.js). Tablas en
	supabase/mi_salon_b18_examenes_2026-09.sql.

	Dos caminos, a elegir por examen (decisión de Jorge, 2026-09-26):
	  - "Solo subir resultados" (modo 'resultados'): por campo formativo, cuántas preguntas tenía
	    y cuántos aciertos sacó cada alumno. Sirve con cualquier examen.
	  - "Crear mi examen" (modo 'propio'): preguntas de opción múltiple (la sugerida: se revisa
	    sola, también con la cámara), verdadero o falso (también sola), completar y abierta (a
	    mano: correcta, parcial o incorrecta; parcial vale medio punto).

	Multigrado (lo más simple para la maestra): un examen lo presentan uno o varios grados del
	grupo y TODAS sus preguntas son para todos ellos. Si quiere preguntas distintas por grado,
	hace un examen por grado (o duplica uno y lo cambia). Cada alumno cuenta con su grado oficial.

	La calificación (aciertos / preguntas por campo, sumando los exámenes del trimestre) vive en
	el motor: MotorCalificacion.puntosRespuestaExamen y aciertosExamenSalon. Aquí solo se usa.
*/
(function () {
	"use strict";

	var Motor = typeof window !== "undefined" && window.MotorCalificacion ? window.MotorCalificacion
		: (typeof require === "function" ? require("./motor-calificacion.js") : null);

	var CAMPOS = [
		{ codigo: "LEN", nombre: "Lenguajes", corto: "Lenguajes" },
		{ codigo: "SAB", nombre: "Saberes y Pensamiento Científico", corto: "Saberes" },
		{ codigo: "ETI", nombre: "Ética, Naturaleza y Sociedades", corto: "Ética" },
		{ codigo: "DHL", nombre: "De lo Humano y lo Comunitario", corto: "De lo Humano" },
	];
	var CODIGOS = CAMPOS.map(function (c) { return c.codigo; });
	function campo(codigo) {
		for (var i = 0; i < CAMPOS.length; i++) if (CAMPOS[i].codigo === codigo) return CAMPOS[i];
		return null;
	}

	var TIPOS = [
		{ clave: "opcion_multiple", nombre: "Opción múltiple", ayuda: "Sugerida: se revisa sola, también con la cámara.", automatica: true },
		{ clave: "verdadero_falso", nombre: "Verdadero o falso", ayuda: "Se revisa sola, también con la cámara.", automatica: true },
		{ clave: "completar", nombre: "Completar", ayuda: "La calificas a mano: correcta, parcial o incorrecta.", automatica: false },
		{ clave: "abierta", nombre: "Abierta", ayuda: "La calificas a mano: correcta, parcial o incorrecta.", automatica: false },
	];
	function tipo(clave) {
		for (var i = 0; i < TIPOS.length; i++) if (TIPOS[i].clave === clave) return TIPOS[i];
		return null;
	}
	function esAutomatica(t) { return t === "opcion_multiple" || t === "verdadero_falso"; }

	var LETRAS = ["A", "B", "C", "D", "E"];
	var LARGO = { titulo: 120, instrucciones: 500, enunciado: 1000, opcion: 300, clave: 200 };
	var MAX_PREGUNTAS = 80;        // por examen
	var MAX_AUTOMATICAS = 63;      // caben en la hoja de respuestas (js/examen-hoja.js)
	var MAX_PREGUNTAS_CAMPO = 200; // resultados: preguntas de un campo

	function limpiar(t) { return String(t === null || t === undefined ? "" : t).replace(/\s+/g, " ").trim(); }

	// ── Solo subir resultados ────────────────────────────────────────────────────
	/*
		leerNumero(texto, maximo) → { ok, vacio, valor, error }
		Entero de 0 a maximo. Vacío = borrar la captura. Acepta espacios alrededor.
	*/
	function leerNumero(texto, maximo) {
		var s = String(texto === null || texto === undefined ? "" : texto).trim();
		if (!s) return { ok: true, vacio: true, valor: null, error: "" };
		if (!/^\d{1,3}$/.test(s)) return { ok: false, vacio: false, valor: null, error: "Escribe un número entero." };
		var n = Number(s);
		if (maximo !== undefined && maximo !== null && n > maximo) {
			return { ok: false, vacio: false, valor: null, error: "No puede pasar de " + maximo + " (las preguntas del campo)." };
		}
		return { ok: true, vacio: false, valor: n, error: "" };
	}

	/*
		validarCampos({LEN: "10", SAB: ""...}) → { ok, campos: {LEN: 10}, error }
		Al menos un campo con preguntas; cada uno de 1 a 200.
	*/
	function validarCampos(entrada) {
		var campos = {}, error = "";
		CODIGOS.forEach(function (c) {
			if (error) return;
			var v = entrada ? entrada[c] : null;
			var s = String(v === null || v === undefined ? "" : v).trim();
			if (!s || s === "0") return;
			if (!/^\d{1,3}$/.test(s) || Number(s) > MAX_PREGUNTAS_CAMPO) { error = "Las preguntas de " + campo(c).corto + " van de 1 a " + MAX_PREGUNTAS_CAMPO + "."; return; }
			campos[c] = Number(s);
		});
		if (!error && !Object.keys(campos).length) error = "Escribe cuántas preguntas tenía al menos un campo formativo.";
		return { ok: !error, campos: error ? null : campos, error: error };
	}

	/*
		cambioDeCampos(anteriores, nuevos, resultados) → { ok, error, quitar: [campos], ajustar: [campos] }
		Cambiar cuántas preguntas tiene un campo actualiza las capturas; no se puede bajar de lo
		que ya sacó un alumno. Quitar un campo con capturas avisa (la pantalla pide confirmar).
	*/
	function cambioDeCampos(anteriores, nuevos, resultados) {
		anteriores = anteriores || {};
		var quitar = [], ajustar = [], error = "";
		Object.keys(anteriores).forEach(function (c) {
			var conCaptura = (resultados || []).filter(function (r) { return r.campo === c; });
			if (!nuevos[c]) { if (conCaptura.length) quitar.push(c); return; }
			if (nuevos[c] === Number(anteriores[c])) return;
			var mayor = conCaptura.reduce(function (m, r) { return Math.max(m, Number(r.aciertos) || 0); }, 0);
			if (mayor > nuevos[c] && !error) error = "En " + campo(c).corto + " un alumno ya tiene " + mayor + " aciertos: no puede tener menos preguntas.";
			if (conCaptura.length) ajustar.push(c);
		});
		return { ok: !error, error: error, quitar: quitar, ajustar: ajustar };
	}

	// ── Crear mi examen: preguntas ───────────────────────────────────────────────
	/*
		validarPregunta({ tipo, campo, enunciado, opciones: [textos], clave }) →
		{ ok, error, fila: { tipo, campo, enunciado, opciones, clave } }
	*/
	function validarPregunta(p) {
		p = p || {};
		var t = tipo(p.tipo);
		if (!t) return { ok: false, error: "Elige el tipo de pregunta." };
		if (!campo(p.campo)) return { ok: false, error: "Elige el campo formativo de la pregunta." };
		var enunciado = String(p.enunciado || "").trim();
		if (!enunciado) return { ok: false, error: "Escribe la pregunta." };
		if (enunciado.length > LARGO.enunciado) return { ok: false, error: "La pregunta es muy larga (máximo " + LARGO.enunciado + " caracteres)." };
		var fila = { tipo: t.clave, campo: p.campo, enunciado: enunciado, opciones: null, clave: null };
		if (t.clave === "opcion_multiple") {
			var ops = (p.opciones || []).map(limpiar);
			// Se quitan las vacías del final (la maestra dejó un renglón sin usar)
			while (ops.length && !ops[ops.length - 1]) ops.pop();
			if (ops.length < 2) return { ok: false, error: "Escribe al menos 2 opciones." };
			if (ops.length > 5) return { ok: false, error: "Son 5 opciones como máximo (A a E)." };
			if (ops.some(function (o) { return !o; })) return { ok: false, error: "Hay una opción vacía entre las demás: escríbela o quítala." };
			if (ops.some(function (o) { return o.length > LARGO.opcion; })) return { ok: false, error: "Una opción es muy larga (máximo " + LARGO.opcion + " caracteres)." };
			var clave = String(p.clave || "").toUpperCase();
			var i = LETRAS.indexOf(clave);
			if (i === -1 || i >= ops.length) return { ok: false, error: "Marca cuál es la respuesta correcta." };
			fila.opciones = ops;
			fila.clave = clave;
		} else if (t.clave === "verdadero_falso") {
			var v = String(p.clave || "").toUpperCase();
			if (v !== "V" && v !== "F") return { ok: false, error: "Marca si la respuesta correcta es Verdadero o Falso." };
			fila.clave = v;
		} else {
			var esperada = limpiar(p.clave);
			if (esperada.length > LARGO.clave) return { ok: false, error: "La respuesta esperada es muy larga (máximo " + LARGO.clave + " caracteres)." };
			fila.clave = esperada || null;
		}
		return { ok: true, error: "", fila: fila };
	}

	// ¿Se puede agregar una pregunta de este tipo? (límite del examen y de la hoja)
	function puedeAgregar(preguntas, tipoNuevo) {
		preguntas = preguntas || [];
		if (preguntas.length >= MAX_PREGUNTAS) return { ok: false, error: "Un examen tiene " + MAX_PREGUNTAS + " preguntas como máximo." };
		if (esAutomatica(tipoNuevo) && preguntas.filter(function (p) { return esAutomatica(p.tipo); }).length >= MAX_AUTOMATICAS) {
			return { ok: false, error: "La hoja de respuestas admite " + MAX_AUTOMATICAS + " preguntas de opción múltiple o de verdadero o falso." };
		}
		return { ok: true, error: "" };
	}

	function resumenPreguntas(preguntas) {
		var auto = (preguntas || []).filter(function (p) { return esAutomatica(p.tipo); }).length;
		var total = (preguntas || []).length;
		var porCampo = {};
		(preguntas || []).forEach(function (p) { porCampo[p.campo] = (porCampo[p.campo] || 0) + 1; });
		return { total: total, automaticas: auto, aMano: total - auto, porCampo: porCampo };
	}

	// ── Alumnos y estado ─────────────────────────────────────────────────────────
	function alumnosDelExamen(alumnos, examen) {
		var grados = ((examen && examen.grados) || []).map(Number);
		return (alumnos || []).filter(function (a) {
			return (a.estatus === undefined || a.estatus === null || a.estatus === "activo") && grados.indexOf(Number(a.grado)) !== -1;
		});
	}

	/*
		avanceAlumno(examen, datos, alumnoId) → { capturado, completo, pendientesMano }
		datos = { preguntas, respuestas, resultados } (las del examen)
		resultados: completo si tiene todos los campos del examen.
		propio: completo si tiene todas las automáticas y todas las de a mano calificadas.
	*/
	function avanceAlumno(examen, datos, alumnoId) {
		if (examen.modo === "resultados") {
			var campos = Object.keys(examen.campos_resultados || {});
			var tiene = (datos.resultados || []).filter(function (r) { return r.examen_id === examen.id && r.alumno_id === alumnoId; })
				.map(function (r) { return r.campo; });
			return { capturado: tiene.length > 0, completo: campos.length > 0 && campos.every(function (c) { return tiene.indexOf(c) !== -1; }), pendientesMano: 0 };
		}
		var pregs = (datos.preguntas || []).filter(function (p) { return p.examen_id === examen.id; });
		var mias = {};
		(datos.respuestas || []).forEach(function (r) { if (r.examen_id === examen.id && r.alumno_id === alumnoId) mias[r.pregunta_id] = r; });
		var capturado = Object.keys(mias).length > 0;
		var faltaAuto = 0, pendientes = 0;
		pregs.forEach(function (p) {
			var r = mias[p.id];
			if (esAutomatica(p.tipo)) { if (!r) faltaAuto++; }
			else if (!r || !r.resultado) pendientes++;
		});
		return { capturado: capturado, completo: pregs.length > 0 && !faltaAuto && !pendientes, pendientesMano: capturado ? pendientes : 0 };
	}

	/*
		estadoExamen(examen, datos, alumnos) → { clave, texto, capturados, completos, total, pendientesMano }
		  sin_aplicar  → nada capturado
		  en_revision  → algo capturado, falta alguien o hay preguntas a mano sin calificar
		  calificado   → todos los alumnos del examen completos
	*/
	function estadoExamen(examen, datos, alumnos) {
		var lista = alumnosDelExamen(alumnos, examen);
		var capturados = 0, completos = 0, pendientes = 0;
		lista.forEach(function (a) {
			var av = avanceAlumno(examen, datos, a.id);
			if (av.capturado) capturados++;
			if (av.completo) completos++;
			pendientes += av.pendientesMano;
		});
		var clave = !capturados ? "sin_aplicar" : (completos === lista.length && lista.length ? "calificado" : "en_revision");
		var texto = clave === "sin_aplicar" ? "Sin aplicar" : (clave === "calificado" ? "Calificado" : "En revisión");
		return { clave: clave, texto: texto, capturados: capturados, completos: completos, total: lista.length, pendientesMano: pendientes };
	}

	/*
		resultadoAlumno(examen, datos, alumnoId) → { porCampo: {LEN: {aciertos, preguntas}},
		aciertos, preguntas, porcentaje|null } — lo mismo que el motor toma para el rubro examen.
	*/
	function resultadoAlumno(examen, datos, alumnoId) {
		var porCampo = Motor.aciertosExamenSalon(examen, datos, alumnoId);
		var a = 0, p = 0;
		Object.keys(porCampo).forEach(function (c) { a += porCampo[c].aciertos; p += porCampo[c].preguntas; });
		return { porCampo: porCampo, aciertos: a, preguntas: p, porcentaje: p ? (a / p) * 100 : null };
	}

	// Aciertos con medio punto: "7", "7.5"
	function numeroAciertos(n) {
		return String(Math.round(Number(n) * 10) / 10);
	}

	// ── Respuestas (captura tocando y escaneo) ───────────────────────────────────
	/*
		filasDeLectura(examen, alumnoId, respuestasLeidas, origen) → filas para upsert en
		examen_respuestas (una por pregunta automática de la hoja). respuestasLeidas: [{ id,
		letra }] con letra 'A'..'E' / 'V' / 'F', '*' (doble) o null (vacía).
	*/
	function filasDeLectura(examen, alumnoId, leidas, origen) {
		return (leidas || []).map(function (r) {
			var l = r.letra === undefined ? null : r.letra;
			if (l !== null && ["A", "B", "C", "D", "E", "V", "F", "*"].indexOf(l) === -1) l = null;
			return { examen_id: examen.id, pregunta_id: r.id, alumno_id: alumnoId, respuesta: l, origen: origen || "escaneo" };
		});
	}

	function textoRespuesta(letra) {
		if (letra === "*") return "Doble marca";
		if (letra === null || letra === undefined || letra === "") return "Vacía";
		if (letra === "V") return "Verdadero";
		if (letra === "F") return "Falso";
		return letra;
	}

	// ── Examen imprimible ────────────────────────────────────────────────────────
	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	/*
		examenHTML(examen, preguntas, { grupo, escuela }) → HTML del examen para imprimir (carta).
		Cada pregunta con class "imp-pregunta" (no se parte entre páginas).
	*/
	function examenHTML(examen, preguntas, o) {
		o = o || {};
		var hayAuto = (preguntas || []).some(function (p) { return esAutomatica(p.tipo); });
		var hayMano = (preguntas || []).some(function (p) { return !esAutomatica(p.tipo); });
		var h = "<article class='imp-examen'>";
		h += "<header class='imp-cabeza'>";
		if (o.escuela) h += "<p class='imp-escuela'>" + esc(o.escuela) + "</p>";
		h += "<h1 class='imp-titulo'>" + esc(examen.titulo || "Examen") + "</h1>";
		h += "<div class='imp-datos'><span>Nombre: <span class='imp-linea imp-linea-larga'></span></span>" +
			"<span>Grado: <span class='imp-linea'></span></span><span>Fecha: <span class='imp-linea'></span></span></div>";
		if (examen.instrucciones) h += "<p class='imp-instr'>" + esc(examen.instrucciones) + "</p>";
		if (hayAuto) {
			h += "<p class='imp-instr'>Las preguntas de opción múltiple y de verdadero o falso se contestan en tu <strong>hoja de respuestas</strong>: rellena el círculo con lápiz." +
				(hayMano ? " Las demás, aquí mismo." : "") + "</p>";
		}
		h += "</header><ol class='imp-lista'>";
		(preguntas || []).forEach(function (p, i) {
			h += "<li class='imp-pregunta'><div class='imp-enunciado'><span class='imp-num'>" + (i + 1) + ".</span> " + esc(p.enunciado) + "</div>";
			if (p.tipo === "opcion_multiple") {
				h += "<ol class='imp-opciones'>" + (p.opciones || []).map(function (op, j) {
					return "<li><span class='imp-letra'>" + LETRAS[j] + ")</span> " + esc(op) + "</li>";
				}).join("") + "</ol>";
			} else if (p.tipo === "verdadero_falso") {
				h += "<p class='imp-vf'>Verdadero &nbsp;&nbsp; o &nbsp;&nbsp; Falso</p>";
			} else if (p.tipo === "completar") {
				h += "<div class='imp-renglon'></div>";
			} else {
				h += "<div class='imp-renglon'></div><div class='imp-renglon'></div><div class='imp-renglon'></div>";
			}
			h += "</li>";
		});
		h += "</ol></article>";
		return h;
	}

	var api = {
		CAMPOS: CAMPOS, CODIGOS: CODIGOS, campo: campo, TIPOS: TIPOS, tipo: tipo, esAutomatica: esAutomatica,
		LETRAS: LETRAS, LARGO: LARGO, MAX_PREGUNTAS: MAX_PREGUNTAS, MAX_AUTOMATICAS: MAX_AUTOMATICAS,
		leerNumero: leerNumero, validarCampos: validarCampos, cambioDeCampos: cambioDeCampos,
		validarPregunta: validarPregunta, puedeAgregar: puedeAgregar, resumenPreguntas: resumenPreguntas,
		alumnosDelExamen: alumnosDelExamen, avanceAlumno: avanceAlumno, estadoExamen: estadoExamen,
		resultadoAlumno: resultadoAlumno, numeroAciertos: numeroAciertos,
		filasDeLectura: filasDeLectura, textoRespuesta: textoRespuesta, examenHTML: examenHTML,
	};
	if (typeof window !== "undefined") window.ExamenModelo = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
