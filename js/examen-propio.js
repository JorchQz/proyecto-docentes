/*
	examen-propio.js — Un examen creado en Mi Salón (modo 'propio'), en cinco pestañas:

	  Preguntas   editor: opción múltiple (sugerida: se revisa sola), verdadero o falso,
	              completar y abierta; cada una con su campo formativo. Subir, bajar, editar y
	              borrar. Todas son para los grados del examen (multigrado: js/examen-modelo.js).
	  Imprimir    el examen (carta; ninguna pregunta se parte entre páginas) y las hojas de
	              respuestas (js/examen-hoja.js): una por alumno con su nombre, grado y un QR con
	              el examen y el alumno; o genéricas, sin nombre (el alumno se elige al escanear).
	              El QR se dibuja con qrcode-generator (jsDelivr, versión fija), que se carga solo
	              al imprimir.
	  Revisar     escanear las hojas con la cámara (js/examen-camara.js) o, sin cámara, tocar la
	              letra que marcó cada alumno (una fila por alumno en la lista; se califica sola).
	  A mano      completar y abiertas: por pregunta, cada alumno correcta, parcial (medio punto)
	              o incorrecta.
	  Resultados  aciertos / preguntas por campo formativo de cada alumno: lo mismo que toma el
	              motor para el rubro Examen de la boleta.

	Lo usa js/examen.js (ctx: base, estado compartido y utilidades).
*/
(function () {
	"use strict";

	var X = window.ExamenModelo, Hoja = window.ExamenHoja;
	var URL_QR = "https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js";
	var TABS = [
		{ clave: "preguntas", texto: "Preguntas" },
		{ clave: "imprimir", texto: "Imprimir" },
		{ clave: "revisar", texto: "Revisar" },
		{ clave: "mano", texto: "A mano" },
		{ clave: "resultados", texto: "Resultados" },
	];
	var ICONOS = {
		arriba: '<path d="m18 15-6-6-6 6"/>',
		abajo: '<path d="m6 9 6 6 6-6"/>',
		lapiz: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
		basura: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
		mas: '<path d="M5 12h14"/><path d="M12 5v14"/>',
		check: '<path d="M20 6 9 17l-5-5"/>',
		camara: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
		impresora: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
		x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
		copiar: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	};
	function ic(n, cls) {
		return '<svg xmlns="http://www.w3.org/2000/svg" class="' + (cls || "h-5 w-5") + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONOS[n] + '</svg>';
	}
	var COLOR_CAMPO = { LEN: "bg-blue-100 text-blue-800", SAB: "bg-emerald-100 text-emerald-800", ETI: "bg-orange-100 text-orange-800", DHL: "bg-violet-100 text-violet-800" };

	var cargaQR = null;
	function cargarScript(url, global) {
		if (window[global]) return Promise.resolve(window[global]);
		return new Promise(function (bien, mal) {
			var s = document.createElement("script");
			s.src = url;
			s.async = true;
			s.onload = function () { window[global] ? bien(window[global]) : mal(new Error("sin " + global)); };
			s.onerror = function () { s.remove(); mal(new Error("No se pudo cargar " + url)); };
			document.head.appendChild(s);
		});
	}
	function cargarQR() {
		if (!cargaQR) cargaQR = cargarScript(URL_QR, "qrcode").catch(function (e) { cargaQR = null; throw e; });
		return cargaQR;
	}

	var ctx, ex, cont, tabActual;

	function pregs() {
		return ctx.datos.preguntas.filter(function (p) { return p.examen_id === ex.id; })
			.sort(function (a, b) { return a.orden - b.orden; });
	}
	function automaticas() { return pregs().filter(function (p) { return X.esAutomatica(p.tipo); }); }
	function aMano() { return pregs().filter(function (p) { return !X.esAutomatica(p.tipo); }); }
	function respuesta(alumnoId, preguntaId) {
		var r = ctx.datos.respuestas;
		for (var i = 0; i < r.length; i++) if (r[i].alumno_id === alumnoId && r[i].pregunta_id === preguntaId) return r[i];
		return null;
	}
	function numeroDe(p) { return pregs().indexOf(p) + 1; }

	// ══════════════════════════════════════════════════════════════════════════════
	function pintar(c, examen, tab, contenedor) {
		ctx = c; ex = examen; cont = contenedor;
		var pestanas = TABS.filter(function (t) { return t.clave !== "mano" || aMano().length; });
		if (!pestanas.some(function (t) { return t.clave === tab; })) tab = "preguntas";
		tabActual = tab;
		ctx.alReintentar = function () { pintarTab(); };
		var acciones = '<button type="button" data-accion="duplicar" class="' + ctx.BTN_SEC + '">' + ic("copiar", "h-4 w-4") + 'Duplicar</button>';
		var h = ctx.cabecera(ex, acciones);
		h += '<nav role="tablist" aria-label="Partes del examen" class="flex flex-wrap gap-1 p-1 rounded-xl bg-gray-200/70 self-start max-w-full">' +
			pestanas.map(function (t) {
				var activa = t.clave === tab;
				return '<a role="tab" href="#ex=' + ctx.esc(ex.id) + '&tab=' + t.clave + '" aria-selected="' + activa + '" class="inline-flex items-center min-h-[44px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap ' +
					(activa ? "bg-white text-blue-800 shadow-sm" : "text-gray-600 hover:text-gray-900") + '">' + t.texto + '</a>';
			}).join("") + '</nav><div id="exTab" class="flex flex-col gap-4"></div>';
		cont.innerHTML = h;
		ctx.ligarCabecera(ex);
		pintarTab();
	}

	function pintarTab() {
		var t = document.getElementById("exTab");
		if (!t) return;
		if (ctx.refrescarEstado) ctx.refrescarEstado(ex);
		if (tabActual === "imprimir") pintarImprimir(t);
		else if (tabActual === "revisar") pintarRevisar(t);
		else if (tabActual === "mano") pintarMano(t);
		else if (tabActual === "resultados") pintarResultados(t);
		else pintarPreguntas(t);
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Preguntas
	// ══════════════════════════════════════════════════════════════════════════════
	function tarjetaPregunta(p, i, total) {
		var esc = ctx.esc, t = X.tipo(p.tipo), cmp = X.campo(p.campo);
		var cuerpo = "";
		if (p.tipo === "opcion_multiple") {
			cuerpo = '<ol class="mt-2 flex flex-col gap-1">' + (p.opciones || []).map(function (o, j) {
				var bien = X.LETRAS[j] === p.clave;
				return '<li class="flex items-start gap-2 text-sm ' + (bien ? "text-emerald-800 font-semibold" : "text-gray-700") + '">' +
					'<span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ' + (bien ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-700") + '">' + X.LETRAS[j] + '</span>' +
					'<span class="break-words min-w-0">' + esc(o) + (bien ? ' <span class="sr-only">(correcta)</span>' : '') + '</span></li>';
			}).join("") + '</ol>';
		} else if (p.tipo === "verdadero_falso") {
			cuerpo = '<p class="mt-2 text-sm text-emerald-800 font-semibold">Correcta: ' + (p.clave === "V" ? "Verdadero" : "Falso") + '</p>';
		} else if (p.tipo === "completar") {
			cuerpo = p.clave ? '<p class="mt-2 text-sm text-gray-600">Respuesta esperada: <span class="font-semibold text-gray-800">' + esc(p.clave) + '</span></p>' : '';
		}
		var btn = "inline-flex items-center justify-center h-11 w-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30";
		return '<li class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex gap-3" data-pregunta="' + esc(p.id) + '">' +
			'<span class="text-base font-bold text-gray-800 w-7 shrink-0">' + (i + 1) + '.</span>' +
			'<div class="flex-1 min-w-0"><div class="flex flex-wrap gap-1.5 mb-1">' +
			'<span class="rounded-full px-2 py-0.5 text-xs font-semibold ' + (COLOR_CAMPO[p.campo] || "bg-gray-100") + '">' + esc(cmp ? cmp.corto : p.campo) + '</span>' +
			'<span class="rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">' + esc(t ? t.nombre : p.tipo) + (X.esAutomatica(p.tipo) ? "" : " · a mano") + '</span></div>' +
			'<p class="text-sm text-gray-900 whitespace-pre-wrap break-words">' + esc(p.enunciado) + '</p>' + cuerpo + '</div>' +
			'<div class="flex flex-col sm:flex-row gap-1 shrink-0">' +
			'<button type="button" data-mover="-1" class="' + btn + '" aria-label="Subir la pregunta ' + (i + 1) + '"' + (i === 0 ? " disabled" : "") + '>' + ic("arriba") + '</button>' +
			'<button type="button" data-mover="1" class="' + btn + '" aria-label="Bajar la pregunta ' + (i + 1) + '"' + (i === total - 1 ? " disabled" : "") + '>' + ic("abajo") + '</button>' +
			'<button type="button" data-editar class="' + btn + '" aria-label="Editar la pregunta ' + (i + 1) + '">' + ic("lapiz") + '</button>' +
			'<button type="button" data-borrar class="' + btn + ' text-red-700 border-red-200 hover:bg-red-50" aria-label="Borrar la pregunta ' + (i + 1) + '">' + ic("basura") + '</button>' +
			'</div></li>';
	}

	function pintarPreguntas(t) {
		var lista = pregs(), r = X.resumenPreguntas(lista);
		var resumen = r.total
			? r.total + (r.total === 1 ? " pregunta" : " preguntas") + ": " + r.automaticas + " se revisan solas" + (r.aMano ? " y " + r.aMano + " a mano" : "") + ". " +
				X.CAMPOS.filter(function (c) { return r.porCampo[c.codigo]; }).map(function (c) { return c.corto + " " + r.porCampo[c.codigo]; }).join(" · ")
			: "Todavía no tiene preguntas.";
		t.innerHTML = '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">' +
			'<p class="text-sm text-gray-600">' + ctx.esc(resumen) + '</p>' +
			'<button type="button" data-agregar class="' + ctx.BTN_PRI + '">' + ic("mas", "h-4 w-4") + 'Agregar pregunta</button></div>' +
			(lista.length ? '<ol class="flex flex-col gap-3">' + lista.map(function (p, i) { return tarjetaPregunta(p, i, lista.length); }).join("") + '</ol>' +
				'<div><button type="button" data-agregar class="' + ctx.BTN_SEC + '">' + ic("mas", "h-4 w-4") + 'Agregar otra pregunta</button></div>'
				: '<div class="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">Te sugerimos preguntas de <strong>opción múltiple</strong>: se revisan solas con la cámara o tocando la letra. Las de completar y abiertas las calificas a mano.</div>');
		t.querySelectorAll("[data-agregar]").forEach(function (b) { b.addEventListener("click", function () { dialogoPregunta(null); }); });
		// En la lista recién pintada (#exTab se reutiliza: escuchar ahí sumaría un escucha por repintado)
		var ol = t.querySelector("ol");
		if (ol) ol.addEventListener("click", function (e) {
			var li = e.target.closest("[data-pregunta]");
			if (!li) return;
			var p = lista.filter(function (x) { return x.id === li.dataset.pregunta; })[0];
			if (!p) return;
			if (e.target.closest("[data-editar]")) dialogoPregunta(p);
			else if (e.target.closest("[data-borrar]")) borrarPregunta(p);
			else if (e.target.closest("[data-mover]")) mover(p, Number(e.target.closest("[data-mover]").dataset.mover));
		});
	}

	async function mover(p, delta) {
		var lista = pregs(), i = lista.indexOf(p), j = i + delta;
		if (j < 0 || j >= lista.length) return;
		lista.splice(i, 1);
		lista.splice(j, 0, p);
		var cambios = [];
		lista.forEach(function (q, k) { if (q.orden !== k) cambios.push({ q: q, orden: k }); });
		for (var n = 0; n < cambios.length; n++) {
			var r = await ctx.escribir(ctx.sb.from("examen_preguntas").update({ orden: cambios[n].orden }).eq("id", cambios[n].q.id).eq("maestro_id", ctx.userId));
			if (!r.ok) { ctx.mensaje("error", ctx.textoError(r.error)); break; }
			cambios[n].q.orden = cambios[n].orden;
		}
		pintarTab();
		var li = document.querySelector('[data-pregunta="' + p.id + '"] [data-mover="' + delta + '"]');
		if (li && !li.disabled) li.focus();
	}

	async function borrarPregunta(p) {
		var n = ctx.datos.respuestas.filter(function (r) { return r.pregunta_id === p.id; }).length;
		var ok = await ctx.confirmar("Borrar pregunta " + numeroDe(p), n
			? "Se borran también las respuestas de " + n + (n === 1 ? " alumno" : " alumnos") + " a esta pregunta. Las hojas ya impresas dejan de coincidir: vuelve a imprimirlas."
			: "La pregunta se quita del examen.", "Borrar", true);
		if (!ok) return;
		var r = await ctx.escribir(ctx.sb.from("examen_preguntas").delete().eq("id", p.id).eq("maestro_id", ctx.userId));
		if (!r.ok) { ctx.mensaje("error", ctx.textoError(r.error)); return; }
		ctx.datos.preguntas = ctx.datos.preguntas.filter(function (x) { return x.id !== p.id; });
		ctx.datos.respuestas = ctx.datos.respuestas.filter(function (x) { return x.pregunta_id !== p.id; });
		pintar(ctx, ex, tabActual, cont);
	}

	function dialogoPregunta(p, previo) {
		var d = document.getElementById("exDlgPregunta"), esc = ctx.esc;
		var conRespuestas = p ? ctx.datos.respuestas.some(function (r) { return r.pregunta_id === p.id; }) : false;
		var st = {
			tipo: p ? p.tipo : (previo ? previo.tipo : "opcion_multiple"),
			campo: p ? p.campo : (previo ? previo.campo : ""),
			enunciado: p ? p.enunciado : "",
			opciones: p && p.opciones ? p.opciones.slice() : ["", "", "", ""],
			clave: p ? p.clave : null,
		};
		function leer() {
			var f = d.querySelector("form");
			if (!f) return;
			var t = f.querySelector("input[name=pTipo]:checked");
			if (t) st.tipo = t.value;
			st.campo = f.querySelector("#pCampo").value;
			st.enunciado = f.querySelector("#pEnunciado").value;
			var ops = f.querySelectorAll("input[data-opcion]");
			if (ops.length) st.opciones = Array.prototype.map.call(ops, function (i) { return i.value; });
			var k = f.querySelector("input[name=pClave]:checked");
			if (st.tipo === "opcion_multiple" || st.tipo === "verdadero_falso") st.clave = k ? k.value : null;
			var e = f.querySelector("#pEsperada");
			if (e) st.clave = e.value;
		}
		function render(foco) {
			var tipos = X.TIPOS.map(function (t) {
				var bloqueado = conRespuestas && X.esAutomatica(t.clave) !== X.esAutomatica(st.tipo);
				return '<label class="flex gap-2 items-start rounded-xl border-2 p-3 min-h-[44px] ' + (bloqueado ? "opacity-50 cursor-not-allowed" : "cursor-pointer") + ' has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 border-gray-200">' +
					'<input type="radio" name="pTipo" value="' + t.clave + '" class="mt-0.5 h-5 w-5 accent-blue-700"' + (st.tipo === t.clave ? " checked" : "") + (bloqueado ? " disabled" : "") + '>' +
					'<span class="min-w-0"><span class="block text-sm font-semibold text-gray-900">' + t.nombre +
					(t.clave === "opcion_multiple" ? ' <span class="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Sugerida</span>' : '') + '</span>' +
					'<span class="block text-xs text-gray-600">' + t.ayuda + '</span></span></label>';
			}).join("");
			var extra = "";
			if (st.tipo === "opcion_multiple") {
				while (st.opciones.length < 2) st.opciones.push("");
				extra = '<fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold text-gray-800 mb-1">Opciones <span class="font-normal text-gray-500">(marca la correcta)</span></legend>' +
					st.opciones.map(function (o, j) {
						var L = X.LETRAS[j];
						return '<div class="flex items-center gap-2"><label class="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-xl border-2 cursor-pointer has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 border-gray-300" title="Marcar ' + L + ' como correcta">' +
							'<input type="radio" name="pClave" value="' + L + '" class="sr-only"' + (st.clave === L ? " checked" : "") + '><span class="font-bold text-gray-800">' + L + '</span></label>' +
							'<input type="text" data-opcion maxlength="' + X.LARGO.opcion + '" value="' + esc(o) + '" placeholder="Opción ' + L + '" aria-label="Opción ' + L + '" class="flex-1 min-w-0 min-h-[44px] rounded-xl border border-gray-300 px-3 text-base">' +
							(st.opciones.length > 2 ? '<button type="button" data-quitar="' + j + '" class="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-xl text-gray-500 hover:bg-gray-100" aria-label="Quitar la opción ' + L + '">' + ic("x") + '</button>' : '<span class="w-11 shrink-0"></span>') +
							'</div>';
					}).join("") +
					(st.opciones.length < 5 ? '<button type="button" data-otra class="' + ctx.BTN_SEC + ' self-start">' + ic("mas", "h-4 w-4") + 'Agregar opción</button>' : '') +
					'<p class="text-xs text-gray-500">Toca la letra de la respuesta correcta: se pone verde.</p></fieldset>';
			} else if (st.tipo === "verdadero_falso") {
				extra = '<fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold text-gray-800 mb-1">¿Cuál es la respuesta correcta?</legend><div class="grid grid-cols-2 gap-2">' +
					[["V", "Verdadero"], ["F", "Falso"]].map(function (v) {
						return '<label class="inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border-2 cursor-pointer has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 border-gray-300">' +
							'<input type="radio" name="pClave" value="' + v[0] + '" class="h-5 w-5 accent-emerald-700"' + (st.clave === v[0] ? " checked" : "") + '><span class="font-semibold">' + v[1] + '</span></label>';
					}).join("") + '</div></fieldset>';
			} else if (st.tipo === "completar") {
				extra = '<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Respuesta esperada <span class="font-normal text-gray-500">(opcional; solo la ves tú al calificar)</span></span>' +
					'<input id="pEsperada" type="text" maxlength="' + X.LARGO.clave + '" value="' + esc(st.clave || "") + '" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base"></label>';
			} else {
				extra = '<p class="text-sm text-gray-600">La calificas a mano en la pestaña «A mano»: correcta, parcial (medio punto) o incorrecta.</p>';
			}
			d.innerHTML = '<form class="flex flex-col max-h-[calc(100dvh-24px)]" novalidate>' +
				'<div class="px-5 pt-5 pb-3 border-b border-gray-100"><h2 id="exDlgPreguntaTitulo" class="text-lg font-bold text-gray-900">' + (p ? "Editar pregunta " + numeroDe(p) : "Nueva pregunta") + '</h2></div>' +
				'<div class="px-5 py-4 flex flex-col gap-4 overflow-y-auto">' +
				'<fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold text-gray-800 mb-1">Tipo</legend><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' + tipos + '</div>' +
				(conRespuestas ? '<p class="text-xs text-amber-800">Ya tiene respuestas: puedes cambiarla, pero no de revisar sola a calificar a mano ni al revés.</p>' : '') + '</fieldset>' +
				'<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Campo formativo</span><select id="pCampo" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base bg-white">' +
				'<option value="">Elige...</option>' + X.CAMPOS.map(function (c) { return '<option value="' + c.codigo + '"' + (st.campo === c.codigo ? " selected" : "") + '>' + esc(c.nombre) + '</option>'; }).join("") + '</select></label>' +
				'<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Pregunta</span>' +
				'<textarea id="pEnunciado" rows="3" maxlength="' + X.LARGO.enunciado + '" class="rounded-xl border border-gray-300 px-3 py-2 text-base">' + esc(st.enunciado) + '</textarea></label>' +
				extra +
				'<p id="pError" class="hidden text-sm font-medium text-red-700" role="alert"></p></div>' +
				'<div class="px-5 py-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
				'<button type="button" data-cerrar class="' + ctx.BTN_SEC + '">Cancelar</button>' +
				(p ? '' : '<button type="button" data-otra-pregunta class="' + ctx.BTN_SEC + '">Guardar y agregar otra</button>') +
				'<button type="submit" class="' + ctx.BTN_PRI + '">Guardar</button></div></form>';
			var f = d.querySelector("form");
			f.querySelectorAll("input[name=pTipo]").forEach(function (r) { r.addEventListener("change", function () { leer(); render(); }); });
			var otra = f.querySelector("[data-otra]");
			if (otra) otra.addEventListener("click", function () { leer(); st.opciones.push(""); render("opcion"); });
			f.querySelectorAll("[data-quitar]").forEach(function (b) {
				b.addEventListener("click", function () {
					leer();
					var j = Number(b.dataset.quitar);
					var claveIdx = X.LETRAS.indexOf(st.clave);
					st.opciones.splice(j, 1);
					if (claveIdx === j) st.clave = null; else if (claveIdx > j) st.clave = X.LETRAS[claveIdx - 1];
					render();
				});
			});
			f.querySelector("[data-cerrar]").addEventListener("click", function () { d.close(); });
			var btnOtra = f.querySelector("[data-otra-pregunta]");
			if (btnOtra) btnOtra.addEventListener("click", function () { guardar(true); });
			f.addEventListener("submit", function (e) { e.preventDefault(); guardar(false); });
			if (foco === "opcion") { var ops = f.querySelectorAll("input[data-opcion]"); if (ops.length) ops[ops.length - 1].focus(); }
		}
		async function guardar(otraMas) {
			leer();
			var err = d.querySelector("#pError");
			var v = X.validarPregunta(st);
			if (!v.ok) { err.textContent = v.error; err.classList.remove("hidden"); return; }
			if (!p) {
				var puede = X.puedeAgregar(pregs(), v.fila.tipo);
				if (!puede.ok) { err.textContent = puede.error; err.classList.remove("hidden"); return; }
			}
			var botones = d.querySelectorAll("button");
			botones.forEach(function (b) { b.disabled = true; });
			var r;
			var campos = "id, examen_id, orden, tipo, campo, enunciado, opciones, clave";
			if (p) {
				r = await ctx.escribir(ctx.sb.from("examen_preguntas").update(v.fila).eq("id", p.id).eq("maestro_id", ctx.userId).select(campos).single());
				if (r.ok) Object.assign(p, r.data);
			} else {
				var orden = pregs().reduce(function (m, q) { return Math.max(m, q.orden + 1); }, 0);
				r = await ctx.escribir(ctx.sb.from("examen_preguntas").insert(Object.assign({ examen_id: ex.id, maestro_id: ctx.userId, orden: orden }, v.fila)).select(campos).single());
				if (r.ok) ctx.datos.preguntas.push(r.data);
			}
			botones.forEach(function (b) { b.disabled = false; });
			if (!r.ok) { err.textContent = ctx.textoError(r.error); err.classList.remove("hidden"); return; }
			d.close();
			pintar(ctx, ex, "preguntas", cont);
			if (otraMas) dialogoPregunta(null, { tipo: v.fila.tipo, campo: v.fila.campo });
		}
		render();
		d.showModal();
		var e0 = d.querySelector("#pEnunciado");
		if (e0 && !p) e0.focus();
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Imprimir
	// ══════════════════════════════════════════════════════════════════════════════
	function pintarImprimir(t) {
		var esc = ctx.esc, lista = pregs(), auto = automaticas(), alumnos = ctx.alumnosDe(ex);
		var tarjeta = "rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm flex flex-col gap-3";
		var h = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">';
		h += '<section class="' + tarjeta + '"><h3 class="font-bold text-gray-900">El examen</h3>' +
			'<p class="text-sm text-gray-600">Tamaño carta. Ninguna pregunta se parte entre dos páginas.</p>' +
			'<button type="button" data-imp="examen" class="' + ctx.BTN_PRI + '"' + (lista.length ? "" : " disabled") + '>' + ic("impresora", "h-4 w-4") + 'Imprimir examen</button>' +
			(lista.length ? '' : '<p class="text-xs text-gray-500">Agrega preguntas primero.</p>') + '</section>';
		h += '<section class="' + tarjeta + '"><h3 class="font-bold text-gray-900">Hojas de respuestas con nombre</h3>' +
			'<p class="text-sm text-gray-600">Una por alumno, con su nombre, grado y un código QR: al escanearla se reconoce sola.</p>';
		if (!auto.length) h += '<p class="text-sm text-gray-500">Este examen no tiene preguntas de opción múltiple ni de verdadero o falso: no lleva hoja de respuestas.</p>';
		else if (!alumnos.length) h += '<p class="text-sm text-gray-500">No hay alumnos activos de ' + esc(ctx.textoGrados(ex.grados)) + '.</p>';
		else {
			h += '<details class="rounded-xl border border-gray-200"><summary class="min-h-[44px] px-3 flex items-center cursor-pointer text-sm font-medium text-gray-700">Elegir alumnos (<span data-cuenta>' + alumnos.length + '</span> de ' + alumnos.length + ')</summary>' +
				'<div class="max-h-64 overflow-y-auto px-2 pb-2 flex flex-col">' + alumnos.map(function (a) {
					return '<label class="flex items-center gap-3 min-h-[44px] px-2 rounded-lg hover:bg-gray-50"><input type="checkbox" data-hoja-alumno="' + esc(a.id) + '" checked class="h-5 w-5 accent-blue-700">' +
						'<span class="text-sm text-gray-800">' + esc(a.nombre_completo) + ' <span class="text-gray-500">' + esc(a.grado) + '°</span></span></label>';
				}).join("") + '</div></details>' +
				'<button type="button" data-imp="nombre" class="' + ctx.BTN_PRI + '">' + ic("impresora", "h-4 w-4") + 'Imprimir hojas con nombre</button>';
		}
		h += '</section>';
		h += '<section class="' + tarjeta + '"><h3 class="font-bold text-gray-900">Hojas sin nombre</h3>' +
			'<p class="text-sm text-gray-600">Para copiar o para quien llegue después. Al escanearla eliges al alumno.</p>' +
			(auto.length ? '<label class="flex items-center justify-between gap-3 text-sm text-gray-700">¿Cuántas?<input type="text" inputmode="numeric" maxlength="2" id="exCopias" value="5" class="w-20 min-h-[44px] rounded-xl border border-gray-300 text-center text-base"></label>' +
				'<button type="button" data-imp="generica" class="' + ctx.BTN_SEC + '">' + ic("impresora", "h-4 w-4") + 'Imprimir hojas sin nombre</button>' : '<p class="text-sm text-gray-500">Sin preguntas que se revisen solas.</p>') +
			'</section></div>';
		h += '<section class="rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:p-5 text-sm text-blue-950 flex flex-col gap-1">' +
			'<p class="font-semibold">Para que la cámara las lea bien</p>' +
			'<ul class="list-disc pl-5 flex flex-col gap-1"><li>Imprime en hoja carta, en blanco y negro basta. Si tu impresora pregunta, elige «Tamaño real» o 100 %; si la ajusta un poco, también se lee.</li>' +
			'<li>Los cuatro cuadros negros de las esquinas deben salir completos: no los recortes, dobles ni manches.</li>' +
			'<li>Que los alumnos usen lápiz y rellenen bien el círculo. Si se equivocan, que borren bien.</li>' +
			'<li>Si cambias las preguntas después de imprimir, vuelve a imprimir las hojas.</li></ul>' +
			'<p id="exImpError" class="hidden font-medium text-red-700" role="alert"></p></section>';
		t.innerHTML = h;
		t.querySelectorAll("[data-hoja-alumno]").forEach(function (c) {
			c.addEventListener("change", function () {
				var n = t.querySelectorAll("[data-hoja-alumno]:checked").length;
				var k = t.querySelector("[data-cuenta]");
				if (k) k.textContent = n;
			});
		});
		t.querySelectorAll("[data-imp]").forEach(function (b) {
			b.addEventListener("click", function () { imprimirAlgo(b.dataset.imp, t, b); });
		});
	}

	async function imprimirAlgo(que, t, boton) {
		var err = t.querySelector("#exImpError");
		err.classList.add("hidden");
		var perfil = ctx.perfil() || {};
		var escuela = ctx.grupo.escuela || perfil.escuela || "";
		if (que === "examen") {
			ctx.imprimir(X.examenHTML(ex, pregs(), { escuela: escuela }));
			return;
		}
		var lista;
		if (que === "nombre") {
			var marcados = Array.prototype.map.call(t.querySelectorAll("[data-hoja-alumno]:checked"), function (c) { return c.dataset.hojaAlumno; });
			lista = ctx.alumnosDe(ex).filter(function (a) { return marcados.indexOf(a.id) !== -1; });
			if (!lista.length) { err.textContent = "Marca al menos un alumno."; err.classList.remove("hidden"); return; }
		} else {
			var n = parseInt(String(t.querySelector("#exCopias").value || "").trim(), 10);
			if (!(n >= 1 && n <= 60)) { err.textContent = "Escribe cuántas hojas, de 1 a 60."; err.classList.remove("hidden"); return; }
			lista = [];
			for (var i = 0; i < n; i++) lista.push(null);
		}
		boton.disabled = true;
		try {
			await cargarQR();
		} catch (e) {
			boton.disabled = false;
			err.textContent = "No se pudo cargar el generador del código QR. Revisa tu señal y vuelve a intentar.";
			err.classList.remove("hidden");
			return;
		}
		boton.disabled = false;
		var disp = Hoja.disposicion(pregs());
		var generica = null;
		var html = lista.map(function (a) {
			var svg;
			if (a) {
				svg = Hoja.hojaSVG({ examen: ex, disposicion: disp, alumno: { id: a.id, nombre: a.nombre_completo, grado: a.grado }, grupo: ctx.grupo.nombre });
			} else {
				generica = generica || Hoja.hojaSVG({ examen: ex, disposicion: disp, alumno: null, grupo: ctx.grupo.nombre });
				svg = generica;
			}
			return '<div class="imp-hoja">' + svg + '</div>';
		}).join("");
		ctx.imprimir(html);
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Revisar: cámara y captura tocando
	// ══════════════════════════════════════════════════════════════════════════════
	var alumnoToque = null;

	function avanceToque(a) {
		var auto = automaticas(), n = 0;
		auto.forEach(function (p) { if (respuesta(a.id, p.id)) n++; });
		return { n: n, total: auto.length };
	}

	function pintarRevisar(t) {
		var esc = ctx.esc, auto = automaticas(), alumnos = ctx.alumnosDe(ex);
		var h = '<section class="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center gap-4">' +
			'<div class="flex-1"><h3 class="font-bold text-gray-900">Escanear las hojas con la cámara</h3>' +
			'<p class="text-sm text-gray-600 mt-1">Pon cada hoja sobre la mesa, con buena luz, y apunta la cámara de atrás: se lee sola cuando se ven los cuatro cuadros negros. Revisas lo leído y guardas. Todo se procesa en la tablet; ninguna foto sale de ella.</p></div>' +
			'<button type="button" data-escanear class="' + ctx.BTN_PRI + ' md:w-auto w-full"' + (auto.length && alumnos.length ? "" : " disabled") + '>' + ic("camara", "h-5 w-5") + 'Escanear hojas</button></section>';
		if (!auto.length) {
			h += '<p class="text-sm text-gray-600">Este examen no tiene preguntas de opción múltiple ni de verdadero o falso. Califica sus preguntas en «A mano».</p>';
			t.innerHTML = h;
			return;
		}
		if (!alumnos.length) { t.innerHTML = h + '<p class="text-sm text-gray-500">No hay alumnos activos de ' + esc(ctx.textoGrados(ex.grados)) + '.</p>'; return; }
		if (!alumnoToque || !alumnos.some(function (a) { return a.id === alumnoToque; })) alumnoToque = alumnos[0].id;
		var actual = alumnos.filter(function (a) { return a.id === alumnoToque; })[0];
		h += '<section class="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col">' +
			'<div class="p-4 sm:p-5 border-b border-gray-100"><h3 class="font-bold text-gray-900">Capturar tocando</h3>' +
			'<p class="text-sm text-gray-600 mt-1">Sin cámara, o si prefieres: elige al alumno y toca la letra que marcó en cada pregunta. Se califica sola. Toca otra vez la letra para quitarla.</p></div>' +
			'<div class="grid grid-cols-1 md:grid-cols-[18rem_1fr]">' +
			'<div class="md:border-r border-gray-100 p-3">' +
			'<label class="md:hidden flex flex-col gap-1 text-sm font-semibold text-gray-800">Alumno<select id="exSelAlumno" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base bg-white font-normal">' +
			alumnos.map(function (a) { var av = avanceToque(a); return '<option value="' + esc(a.id) + '"' + (a.id === alumnoToque ? " selected" : "") + '>' + esc(a.nombre_completo) + (ctx.noPresento(ex, a.id) ? ' (no presentó)' : ' (' + av.n + ' de ' + av.total + ')') + '</option>'; }).join("") + '</select></label>' +
			'<ul class="hidden md:flex flex-col gap-1 max-h-[34rem] overflow-y-auto" aria-label="Alumnos">' + alumnos.map(function (a) {
				var av = avanceToque(a), activo = a.id === alumnoToque;
				return '<li><button type="button" data-alumno="' + esc(a.id) + '" class="w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-xl text-left text-sm ' +
					(activo ? "bg-blue-700 text-white" : "hover:bg-gray-100 text-gray-800") + '"' + (activo ? ' aria-current="true"' : '') + '><span class="truncate">' + esc(a.nombre_completo) + '</span>' +
					'<span class="text-xs shrink-0 ' + (activo ? "text-blue-100" : (av.n === av.total ? "text-emerald-700 font-semibold" : "text-gray-500")) + '">' + (ctx.noPresento(ex, a.id) ? "No presentó" : av.n + '/' + av.total) + '</span></button></li>';
			}).join("") + '</ul></div>' +
			'<div class="p-3 sm:p-4 flex flex-col gap-3"><div class="flex flex-wrap items-center justify-between gap-2">' +
			'<p class="font-semibold text-gray-900">' + esc(actual.nombre_completo) + ' <span class="text-sm font-normal text-gray-500">' + esc(actual.grado) + '°</span></p>' +
			'<span class="flex flex-wrap gap-2">' + ctx.botonNoPresento(ex, actual) + '<button type="button" data-siguiente class="' + ctx.BTN_SEC + '">Siguiente alumno</button></span></div>' +
			(ctx.noPresento(ex, actual.id) ? '<p class="text-sm text-gray-600 rounded-xl bg-gray-100 px-3 py-2">No presentó: no cuenta ni a favor ni en contra. Si lo presenta después, toca sus respuestas o escanea su hoja y se quita solo.</p>' : '') +
			'<ol class="grid grid-cols-1 2xl:grid-cols-2 gap-x-6 gap-y-2">' + auto.map(function (p) {
				var r = respuesta(actual.id, p.id), letras = Hoja.letrasDe(p);
				return '<li class="flex items-center gap-2" data-toque="' + esc(p.id) + '"><span class="w-8 text-right text-sm font-bold text-gray-700 shrink-0">' + numeroDe(p) + '.</span>' +
					'<div class="flex flex-wrap gap-1.5">' + letras.map(function (L) {
						var sel = r && r.respuesta === L, bien = sel && L === p.clave;
						var cls = sel ? (bien ? "bg-emerald-600 border-emerald-600 text-white" : "bg-red-600 border-red-600 text-white") : "bg-white border-gray-300 text-gray-800 hover:bg-gray-50";
						return '<button type="button" data-letra="' + L + '" aria-pressed="' + (sel ? "true" : "false") + '" aria-label="Pregunta ' + numeroDe(p) + ', ' + X.textoRespuesta(L) + '" class="h-11 w-11 rounded-full border-2 text-base font-bold ' + cls + '">' + L + '</button>';
					}).join("") +
					'<button type="button" data-letra="" aria-pressed="' + (r && r.respuesta === null ? "true" : "false") + '" class="h-11 px-3 rounded-full border-2 text-xs font-semibold ' +
					(r && r.respuesta === null ? "bg-gray-700 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-600") + '">En blanco</button>' +
					(r && r.respuesta === "*" ? '<span class="self-center text-xs font-semibold text-amber-800">Doble marca</span>' : '') +
					'</div></li>';
			}).join("") + '</ol></div></div></section>';
		t.innerHTML = h;
		t.querySelector("[data-escanear]").addEventListener("click", abrirCamara);
		if (window.ExamenCamara && window.ExamenCamara.precargar && auto.length) window.ExamenCamara.precargar();
		var sel = t.querySelector("#exSelAlumno");
		if (sel) sel.addEventListener("change", function () { alumnoToque = sel.value; pintarTab(); });
		t.querySelectorAll("[data-alumno]").forEach(function (b) { b.addEventListener("click", function () { alumnoToque = b.dataset.alumno; pintarTab(); }); });
		var bnp = t.querySelector("[data-no-presento]");
		if (bnp) bnp.addEventListener("click", function () { alternarNoPresento(bnp.getAttribute("data-no-presento")); });
		t.querySelector("[data-siguiente]").addEventListener("click", function () {
			var i = alumnos.map(function (a) { return a.id; }).indexOf(alumnoToque);
			alumnoToque = alumnos[(i + 1) % alumnos.length].id;
			pintarTab();
			var p = document.getElementById("exTab");
			if (p) p.scrollIntoView({ block: "start" });
		});
		t.querySelectorAll("[data-toque]").forEach(function (li) {
			li.addEventListener("click", function (e) {
				var b = e.target.closest("[data-letra]");
				if (!b) return;
				var p = auto.filter(function (x) { return x.id === li.dataset.toque; })[0];
				var L = b.dataset.letra || null;
				var r = respuesta(actual.id, p.id);
				// Tocar otra vez lo mismo quita la captura
				if (r && r.respuesta === L) guardarRespuesta(actual.id, p.id, null);
				else guardarRespuesta(actual.id, p.id, { respuesta: L, resultado: null, origen: "toque" });
			});
		});
	}

	/*
		guardarRespuesta(alumnoId, preguntaId, fila|null): null borra la captura. Se ve de
		inmediato; sin señal queda pendiente (se reintenta), con otro error vuelve a lo guardado.
	*/
	function guardarRespuesta(alumnoId, preguntaId, fila) {
		var a = ctx.alumnos().filter(function (x) { return x.id === alumnoId; })[0];
		var p = pregs().filter(function (x) { return x.id === preguntaId; })[0];
		var desc = "Pregunta " + (p ? numeroDe(p) : "") + " de " + (a ? a.nombre_completo : "un alumno") + " en «" + ex.titulo + "»";
		var d = { examen_id: ex.id, pregunta_id: preguntaId, alumno_id: alumnoId };
		// Por la cola de la tablet (js/bandeja-salida.js): se ve ya y se envía sola, también sin señal
		if (!fila) ctx.capturar("examen_respuesta_borrar", d, desc);
		else ctx.capturar("examen_respuesta", Object.assign(d, {
			respuesta: fila.respuesta === undefined ? null : fila.respuesta, resultado: fila.resultado || null, origen: fila.origen || "toque",
		}), desc);
		pintarTab();
	}

	// "No presentó" del alumno en este examen (se oprime otra vez para quitarlo)
	function alternarNoPresento(alumnoId) {
		ctx.marcarNoPresento(ex, alumnoId, !ctx.noPresento(ex, alumnoId));
		pintarTab();
		var b = document.querySelector('[data-no-presento="' + alumnoId + '"]');
		if (b) b.focus();
	}

	function abrirCamara() {
		window.ExamenCamara.abrir({
			examen: ex,
			preguntas: pregs(),
			alumnos: ctx.alumnosDe(ex),
			esc: ctx.esc,
			yaTiene: function (alumnoId) { return automaticas().filter(function (p) { return respuesta(alumnoId, p.id); }).length; },
			/*
				Una hoja leída: una captura por pregunta en la cola de la tablet (se envían solas, también
				sin señal; la marca de cada fila evita pisar lo que otro aparato capturó). Solo cambia lo
				que difiere de lo que ya había.
			*/
			guardar: async function (alumnoId, leidas) {
				var a = ctx.alumnos().filter(function (x) { return x.id === alumnoId; })[0];
				X.filasDeLectura(ex, alumnoId, leidas, "escaneo").forEach(function (f) {
					var antes = respuesta(alumnoId, f.pregunta_id);
					if (antes && antes.respuesta === f.respuesta && !antes.resultado && antes.origen === "escaneo") return;
					var p = pregs().filter(function (x) { return x.id === f.pregunta_id; })[0];
					ctx.capturar("examen_respuesta", { examen_id: ex.id, pregunta_id: f.pregunta_id, alumno_id: alumnoId, respuesta: f.respuesta, resultado: null, origen: "escaneo" },
						"Pregunta " + (p ? numeroDe(p) : "") + " de " + (a ? a.nombre_completo : "un alumno") + " (hoja escaneada)");
				});
				return { ok: true, enTableta: typeof navigator !== "undefined" && navigator.onLine === false };
			},
			alCerrar: function () {
				pintar(ctx, ex, tabActual, cont);
				var b = document.querySelector("[data-escanear]");
				if (b) b.focus();
			},
		});
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// A mano: completar y abiertas
	// ══════════════════════════════════════════════════════════════════════════════
	var preguntaMano = null;
	function pintarMano(t) {
		var esc = ctx.esc, lista = aMano(), alumnos = ctx.alumnosDe(ex);
		if (!lista.length) { t.innerHTML = '<p class="text-sm text-gray-600">Este examen no tiene preguntas de completar ni abiertas.</p>'; return; }
		if (!preguntaMano || !lista.some(function (p) { return p.id === preguntaMano; })) preguntaMano = lista[0].id;
		var p = lista.filter(function (x) { return x.id === preguntaMano; })[0];
		var calificados = alumnos.filter(function (a) { var r = respuesta(a.id, p.id); return r && r.resultado; }).length;
		var h = '<div class="flex flex-wrap gap-2" role="tablist" aria-label="Preguntas a mano">' + lista.map(function (q) {
			var activa = q.id === p.id;
			var n = alumnos.filter(function (a) { var r = respuesta(a.id, q.id); return r && r.resultado; }).length;
			return '<button type="button" data-pmano="' + esc(q.id) + '" role="tab" aria-selected="' + activa + '" class="min-h-[44px] px-4 rounded-xl text-sm font-semibold border ' +
				(activa ? "bg-blue-700 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50") + '">Pregunta ' + numeroDe(q) +
				' <span class="font-normal ' + (activa ? "text-blue-100" : "text-gray-500") + '">' + n + '/' + alumnos.length + '</span></button>';
		}).join("") + '</div>';
		h += '<section class="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col">' +
			'<div class="p-4 sm:p-5 border-b border-gray-100 flex flex-col gap-1"><p class="text-xs font-semibold text-gray-500">' + esc(X.tipo(p.tipo).nombre) + ' · ' + esc(X.campo(p.campo).nombre) + '</p>' +
			'<p class="text-base text-gray-900 whitespace-pre-wrap break-words">' + numeroDe(p) + '. ' + esc(p.enunciado) + '</p>' +
			(p.clave ? '<p class="text-sm text-gray-600">Respuesta esperada: <span class="font-semibold text-gray-900">' + esc(p.clave) + '</span></p>' : '') +
			'<p class="text-sm text-gray-500">' + calificados + ' de ' + alumnos.length + ' calificados. Parcial vale medio punto. Toca otra vez para quitar.</p></div>' +
			'<ul class="divide-y divide-gray-100">' + alumnos.map(function (a) {
				var r = respuesta(a.id, p.id), v = r ? r.resultado : null;
				function b(valor, texto, color) {
					var sel = v === valor;
					return '<button type="button" data-res="' + valor + '" aria-pressed="' + sel + '" class="min-h-[44px] px-3 rounded-xl text-sm font-semibold border-2 ' +
						(sel ? color : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50") + '">' + texto + '</button>';
				}
				return '<li class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2" data-amano="' + esc(a.id) + '">' +
					'<span class="text-sm font-medium text-gray-800">' + esc(a.nombre_completo) + ' <span class="text-gray-500 font-normal">' + esc(a.grado) + '°</span></span>' +
					'<div class="grid grid-cols-3 gap-2 sm:flex">' + b("correcta", "Correcta", "bg-emerald-600 border-emerald-600 text-white") +
					b("parcial", "Parcial", "bg-amber-500 border-amber-500 text-white") + b("incorrecta", "Incorrecta", "bg-red-600 border-red-600 text-white") + '</div></li>';
			}).join("") + '</ul></section>';
		t.innerHTML = h;
		t.querySelectorAll("[data-pmano]").forEach(function (b) { b.addEventListener("click", function () { preguntaMano = b.dataset.pmano; pintarTab(); }); });
		t.querySelectorAll("[data-amano]").forEach(function (li) {
			li.addEventListener("click", function (e) {
				var b = e.target.closest("[data-res]");
				if (!b) return;
				var r = respuesta(li.dataset.amano, p.id);
				if (r && r.resultado === b.dataset.res) guardarRespuesta(li.dataset.amano, p.id, null);
				else guardarRespuesta(li.dataset.amano, p.id, { respuesta: null, resultado: b.dataset.res, origen: "manual" });
			});
		});
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Resultados
	// ══════════════════════════════════════════════════════════════════════════════
	function pintarResultados(t) {
		var esc = ctx.esc, alumnos = ctx.alumnosDe(ex);
		var campos = X.CAMPOS.filter(function (c) { return pregs().some(function (p) { return p.campo === c.codigo; }); });
		if (!alumnos.length || !campos.length) { t.innerHTML = '<p class="text-sm text-gray-600">' + (campos.length ? "No hay alumnos activos en los grados del examen." : "Agrega preguntas primero.") + '</p>'; return; }
		var h = '<section class="rounded-2xl border border-gray-200 bg-white shadow-sm">' +
			'<div class="p-4 sm:p-5 border-b border-gray-100"><h3 class="font-bold text-gray-900">Aciertos por campo formativo</h3>' +
			'<p class="text-sm text-gray-600 mt-1">Esto entra al rubro Examen de la boleta de cada campo. Solo cuenta lo capturado: una pregunta sin capturar o a mano sin calificar no cuenta ni a favor ni en contra.</p></div>' +
			'<div class="overflow-x-auto"><table class="ex-tabla w-full text-sm"><thead><tr class="bg-gray-50 text-left">' +
			'<th scope="col" class="ex-fija bg-gray-50 px-3 py-2 font-semibold text-gray-700 min-w-[10rem]">Alumno</th>' +
			campos.map(function (c) { return '<th scope="col" class="px-3 py-2 font-semibold text-gray-700 text-center whitespace-nowrap">' + esc(c.corto) + '</th>'; }).join("") +
			'<th scope="col" class="px-3 py-2 font-semibold text-gray-700 text-center">Total</th><th scope="col" class="px-3 py-2 font-semibold text-gray-700">Estado</th><th scope="col" class="px-2 py-2"><span class="sr-only">No presentó</span></th></tr></thead><tbody>';
		alumnos.forEach(function (a) {
			var res = X.resultadoAlumno(ex, ctx.datos, a.id), av = X.avanceAlumno(ex, ctx.datos, a.id);
			var estado = av.noPresento ? '<span class="text-gray-600 font-semibold">No presentó</span>' : !av.capturado ? '<span class="text-gray-500">Sin capturar</span>' : (av.completo ? '<span class="text-emerald-700 font-semibold">Completo</span>'
				: '<span class="text-amber-800">' + (av.pendientesMano ? av.pendientesMano + " a mano por calificar" : "Faltan respuestas") + '</span>');
			h += '<tr><th scope="row" class="ex-fija px-3 py-2 text-left font-medium text-gray-800">' + esc(a.nombre_completo) + ' <span class="text-xs text-gray-500">' + esc(a.grado) + '°</span></th>' +
				campos.map(function (c) {
					var x = res.porCampo[c.codigo];
					return '<td class="px-3 py-2 text-center whitespace-nowrap">' + (x ? '<span class="font-semibold">' + X.numeroAciertos(x.aciertos) + '</span> / ' + x.preguntas : '<span class="text-gray-400">—</span>') + '</td>';
				}).join("") +
				'<td class="px-3 py-2 text-center whitespace-nowrap">' + (res.preguntas ? '<span class="font-semibold">' + X.numeroAciertos(res.aciertos) + '</span> / ' + res.preguntas +
					' <span class="text-xs text-gray-500">(' + Math.floor(res.porcentaje * 10 + 1e-9) / 10 + ' %)</span>' : '<span class="text-gray-400">—</span>') + '</td>' +
				'<td class="px-3 py-2 whitespace-nowrap">' + estado + '</td><td class="px-2 py-1.5">' + ctx.botonNoPresento(ex, a) + '</td></tr>';
		});
		h += '</tbody></table></div></section>';
		t.innerHTML = h;
		t.querySelectorAll("[data-no-presento]").forEach(function (b) {
			b.addEventListener("click", function () { alternarNoPresento(b.getAttribute("data-no-presento")); });
		});
	}

	window.ExamenPropio = { pintar: pintar };
})();
