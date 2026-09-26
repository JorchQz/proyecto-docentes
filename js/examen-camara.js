/*
	examen-camara.js — Revisar las hojas de respuestas con la cámara de la tablet (decisión de
	Jorge, 2026-09-26). Todo se procesa en el aparato: ninguna imagen sale de él.

	  1. getUserMedia con la cámara de atrás (facingMode "environment", hasta 1920 × 1080).
	     Vista en vivo con un recuadro guía; cada ~0.3 s se buscan los 4 cuadros negros en una
	     copia chica del cuadro (js/examen-lector.js). Cuando se ven en dos cuadros seguidos en el
	     mismo lugar, se captura sola; también hay botón "Capturar".
	  2. Captura: se lee la hoja completa (homografía, oscuridad de cada círculo con umbral
	     adaptativo, vacía y doble marca) y el QR con jsQR (jsDelivr, versión fija; se carga al
	     abrir la cámara). El QR dice el examen y el alumno; en la hoja genérica, o si el QR no se
	     leyó, la maestra elige al alumno.
	  3. Confirmar: la hoja enderezada con lo leído resaltado (verde si coincide con la clave, rojo
	     si no; en amarillo lo dudoso, vacío o con doble marca). Tocar un círculo cambia la
	     respuesta de esa pregunta (tocar la marcada la deja en blanco). "Guardar y seguir"
	     guarda y regresa a la cámara sin cerrarla; no vuelve a capturar la misma hoja hasta que
	     se retire o se ponga la de otro alumno.
	  4. Sin cámara, sin permiso o en un navegador que no la deja usar: se explica y queda
	     "Capturar tocando" (js/examen-propio.js).

	ExamenCamara.abrir({ examen, preguntas, alumnos, esc, yaTiene(alumnoId), guardar(alumnoId,
	leidas) → Promise<{ok, red, texto}>, alCerrar() }), ExamenCamara.cerrar(), .abierta()
*/
(function () {
	"use strict";

	var URL_JSQR = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
	var Hoja = window.ExamenHoja, Lector = window.ExamenLector, X = window.ExamenModelo;
	var ESCALA_CONFIRMAR = 3; // px por mm de la hoja enderezada

	var o = null;          // opciones de abrir
	var raiz = null;
	var stream = null, video = null, capa = null, lienzoChico = null, lienzoGrande = null;
	var temporizador = null, modo = "cerrada";
	var disp = [], estable = 0, ultimos = null, esperarRetiro = false, alumnoGuardado = null, guardadas = 0;
	var lectura = null;    // { img, r, qr, alumnoId, respuestas: {preguntaId: letra}, dudosas }
	var cargaJsQR = null;

	function esc(s) { return o && o.esc ? o.esc(s) : String(s); }
	var IC = {
		x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
		camara: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
	};
	function ic(n, cls) { return '<svg xmlns="http://www.w3.org/2000/svg" class="' + (cls || "h-5 w-5") + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>'; }
	var BTN = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold";

	function cargarJsQR() {
		if (window.jsQR) return Promise.resolve(window.jsQR);
		if (!cargaJsQR) {
			cargaJsQR = new Promise(function (bien, mal) {
				var s = document.createElement("script");
				s.src = URL_JSQR; s.async = true;
				s.onload = function () { window.jsQR ? bien(window.jsQR) : mal(new Error("sin jsQR")); };
				s.onerror = function () { s.remove(); cargaJsQR = null; mal(new Error("no se cargó jsQR")); };
				document.head.appendChild(s);
			});
		}
		return cargaJsQR;
	}
	function decodificar(rgba, ancho, alto) {
		if (!window.jsQR) return null;
		var c = window.jsQR(rgba, ancho, alto, { inversionAttempts: "dontInvert" });
		return c ? c.data : null;
	}

	function alumnoPorId(id) {
		for (var i = 0; i < o.alumnos.length; i++) if (o.alumnos[i].id === id) return o.alumnos[i];
		return null;
	}
	function preguntaPorId(id) {
		for (var i = 0; i < o.preguntas.length; i++) if (o.preguntas[i].id === id) return o.preguntas[i];
		return null;
	}

	// ── Abrir y cerrar ───────────────────────────────────────────────────────────
	function abrir(opciones) {
		o = opciones;
		raiz = document.getElementById("exCamara");
		disp = Hoja.disposicion(o.preguntas);
		guardadas = 0; estable = 0; ultimos = null; esperarRetiro = false; alumnoGuardado = null; lectura = null;
		modo = "abriendo";
		raiz.classList.remove("hidden");
		document.documentElement.style.overflow = "hidden";
		document.addEventListener("keydown", teclado);
		pintarMarco("Abriendo la cámara...");
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			pintarError("Este navegador no deja usar la cámara aquí.", "Puedes capturar tocando la letra que marcó cada alumno, en «Capturar tocando».");
			return;
		}
		var qr = cargarJsQR().catch(function () { return null; });
		navigator.mediaDevices.getUserMedia({
			video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
		}).then(function (s) {
			if (modo === "cerrada") { s.getTracks().forEach(function (t) { t.stop(); }); return; }
			stream = s;
			return qr.then(function (lib) {
				iniciarVivo(lib ? "" : "No se pudo cargar el lector del código QR: al leer cada hoja elige al alumno.");
			});
		}).catch(function (e) {
			var n = e && e.name;
			if (n === "NotAllowedError" || n === "SecurityError") pintarError("No hay permiso para usar la cámara.", "Actívalo en el candado junto a la dirección de la página (Permisos, Cámara) o captura tocando la letra en «Capturar tocando».");
			else if (n === "NotFoundError" || n === "OverconstrainedError") pintarError("No se encontró una cámara en este aparato.", "Captura tocando la letra que marcó cada alumno, en «Capturar tocando».");
			else if (n === "NotReadableError") pintarError("La cámara está ocupada por otra aplicación.", "Ciérrala y vuelve a intentar, o captura tocando.");
			else pintarError("No se pudo abrir la cámara.", "Captura tocando la letra que marcó cada alumno, en «Capturar tocando».");
		});
	}

	function cerrar() {
		if (modo === "cerrada") return;
		modo = "cerrada";
		clearTimeout(temporizador);
		if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
		stream = null; video = null;
		document.removeEventListener("keydown", teclado);
		if (raiz) { raiz.classList.add("hidden"); raiz.innerHTML = ""; }
		document.documentElement.style.overflow = "";
		var fin = o && o.alCerrar;
		if (fin) fin();
	}
	function teclado(e) { if (e.key === "Escape") { e.preventDefault(); cerrar(); } }

	function barraSuperior(titulo) {
		return '<div class="flex items-center justify-between gap-3 px-4 py-2 bg-gray-900 border-b border-white/10">' +
			'<div class="min-w-0"><p class="font-semibold truncate">' + esc(titulo) + '</p><p class="text-xs text-gray-300" data-cuenta>' +
			(guardadas ? guardadas + (guardadas === 1 ? " hoja guardada" : " hojas guardadas") : esc(o.examen.titulo)) + '</p></div>' +
			'<button type="button" data-cerrar class="' + BTN + ' bg-white/10 hover:bg-white/20 text-white" aria-label="Cerrar la cámara">' + ic("x") + 'Cerrar</button></div>';
	}
	function pintarMarco(texto) {
		raiz.innerHTML = barraSuperior("Revisar hojas") + '<div class="flex-1 flex items-center justify-center p-6 text-center text-gray-200">' + esc(texto) + '</div>';
		raiz.querySelector("[data-cerrar]").addEventListener("click", cerrar);
		raiz.querySelector("[data-cerrar]").focus();
	}
	function pintarError(titulo, texto) {
		modo = "error";
		raiz.innerHTML = barraSuperior("Revisar hojas") + '<div class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">' +
			'<p class="text-lg font-semibold" data-error-camara>' + esc(titulo) + '</p><p class="text-sm text-gray-300 max-w-md">' + esc(texto) + '</p>' +
			'<button type="button" data-cerrar2 class="' + BTN + ' bg-white text-gray-900 mt-2">Capturar tocando</button></div>';
		raiz.querySelector("[data-cerrar]").addEventListener("click", cerrar);
		raiz.querySelector("[data-cerrar2]").addEventListener("click", cerrar);
		raiz.querySelector("[data-cerrar2]").focus();
	}

	// ── Vista en vivo ────────────────────────────────────────────────────────────
	function iniciarVivo(aviso) {
		modo = "vivo";
		raiz.innerHTML = barraSuperior("Revisar hojas") +
			'<div class="relative flex-1 overflow-hidden bg-black" data-area>' +
			'<video playsinline muted autoplay class="absolute inset-0 w-full h-full object-contain"></video>' +
			'<canvas class="absolute inset-0 w-full h-full pointer-events-none" data-capa></canvas>' +
			'<div class="absolute left-1/2 -translate-x-1/2 bottom-3 max-w-[92%] rounded-xl bg-black/70 px-4 py-2 text-center text-sm" role="status" aria-live="polite" data-estado>Pon la hoja completa dentro del recuadro, con buena luz.</div>' +
			(aviso ? '<div class="absolute left-1/2 -translate-x-1/2 top-3 max-w-[92%] rounded-xl bg-amber-500/90 text-gray-950 px-4 py-2 text-center text-sm font-medium">' + esc(aviso) + '</div>' : '') +
			'</div><div class="flex items-center justify-center gap-3 px-4 py-3 bg-gray-900 border-t border-white/10">' +
			'<button type="button" data-capturar class="' + BTN + ' bg-blue-600 hover:bg-blue-500 text-white min-w-[10rem]">' + ic("camara") + 'Capturar</button></div>';
		raiz.querySelector("[data-cerrar]").addEventListener("click", cerrar);
		raiz.querySelector("[data-capturar]").addEventListener("click", function () { procesar(true); });
		video = raiz.querySelector("video");
		capa = raiz.querySelector("[data-capa]");
		video.srcObject = stream;
		var p = video.play();
		if (p && p.catch) p.catch(function () {});
		lienzoChico = lienzoChico || document.createElement("canvas");
		lienzoGrande = lienzoGrande || document.createElement("canvas");
		estable = 0; ultimos = null;
		raiz.querySelector("[data-capturar]").focus();
		clearTimeout(temporizador);
		temporizador = setTimeout(vigilar, 400);
	}

	function estado(texto) {
		var e = raiz && raiz.querySelector("[data-estado]");
		if (e) e.textContent = texto;
	}

	function cuadro(maxLado) {
		var vw = video.videoWidth, vh = video.videoHeight;
		if (!vw || !vh) return null;
		var f = maxLado ? Math.min(1, maxLado / Math.max(vw, vh)) : 1;
		var w = Math.round(vw * f), h = Math.round(vh * f);
		var c = maxLado ? lienzoChico : lienzoGrande;
		if (c.width !== w) c.width = w;
		if (c.height !== h) c.height = h;
		var g = c.getContext("2d", { willReadFrequently: true });
		g.drawImage(video, 0, 0, w, h);
		return { img: Lector.gris(g.getImageData(0, 0, w, h)), factor: vw / w };
	}

	function dibujarCapa(puntos, factor, bien) {
		if (!capa || !video) return;
		var cw = capa.clientWidth, ch = capa.clientHeight;
		if (capa.width !== cw) capa.width = cw;
		if (capa.height !== ch) capa.height = ch;
		var g = capa.getContext("2d");
		g.clearRect(0, 0, cw, ch);
		var vw = video.videoWidth, vh = video.videoHeight;
		if (!vw) return;
		var s = Math.min(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
		// Recuadro guía: una hoja carta vertical al 86 % del alto visible
		var gh = vh * s * 0.86, gw = gh * 215.9 / 279.4;
		if (gw > vw * s * 0.9) { gw = vw * s * 0.9; gh = gw * 279.4 / 215.9; }
		g.lineWidth = 3;
		g.setLineDash(bien ? [] : [12, 8]);
		g.strokeStyle = bien ? "#22c55e" : "rgba(255,255,255,0.8)";
		g.strokeRect(ox + (vw * s - gw) / 2, oy + (vh * s - gh) / 2, gw, gh);
		g.setLineDash([]);
		if (puntos) {
			g.fillStyle = "#22c55e";
			puntos.forEach(function (p) {
				var x = ox + p.x * factor * s, y = oy + p.y * factor * s;
				g.fillRect(x - 7, y - 7, 14, 14);
			});
		}
	}

	function cerca(a, b, tol) {
		if (!a || !b) return false;
		for (var i = 0; i < 4; i++) if (Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y) > tol) return false;
		return true;
	}

	function vigilar() {
		if (modo !== "vivo") return;
		var c = video && video.readyState >= 2 ? cuadro(900) : null;
		if (!c) { dibujarCapa(null, 1, false); temporizador = setTimeout(vigilar, 300); return; }
		var m = Lector.buscarMarcadores(c.img, { maxLado: 900 });
		if (m.error) {
			estable = 0; ultimos = null;
			if (esperarRetiro) { esperarRetiro = false; alumnoGuardado = null; }
			dibujarCapa(null, c.factor, false);
			estado(m.error === "orientacion" ? "Se ven cuadros negros, pero no la hoja completa: que se vean las cuatro esquinas." : "Pon la hoja completa dentro del recuadro, con buena luz.");
			temporizador = setTimeout(vigilar, 300);
			return;
		}
		dibujarCapa(m.puntos, c.factor, true);
		var tol = Math.max(c.img.ancho, c.img.alto) * 0.02;
		estable = cerca(m.puntos, ultimos, tol) ? estable + 1 : 1;
		ultimos = m.puntos;
		if (esperarRetiro) {
			estado("Guardado. Retira la hoja y pon la siguiente.");
			// La hoja de otro alumno (QR distinto) también rearma sin retirar
			if (estable >= 2 && estable % 3 === 2 && window.jsQR) {
				var g = cuadro(0), r = Lector.buscarMarcadores(g.img);
				var q = !r.error ? Lector.leerQR(g.img, r.H, decodificar) : null;
				if (q && q.alumnoId && q.alumnoId !== alumnoGuardado) { esperarRetiro = false; procesar(false, g); return; }
			}
			temporizador = setTimeout(vigilar, 300);
			return;
		}
		if (estable >= 2) { estado("Leyendo la hoja..."); procesar(false); return; }
		estado("Se ven los cuatro cuadros: no muevas la tablet.");
		temporizador = setTimeout(vigilar, 250);
	}

	// ── Leer la hoja ─────────────────────────────────────────────────────────────
	function procesar(manual, yaCapturado) {
		if (modo !== "vivo") return;
		clearTimeout(temporizador);
		var c = yaCapturado || cuadro(0);
		if (!c) { estado("La cámara todavía no da imagen."); temporizador = setTimeout(vigilar, 400); return; }
		var r = Lector.leerHoja(c.img, disp);
		if (!r.ok) {
			var t = r.error === "lejos" ? "La hoja se ve muy chica: acerca la tablet." : (r.error === "luz" ? "Falta luz o hay mucho reflejo: busca mejor luz." :
				"No se ven los cuatro cuadros negros de las esquinas.");
			estado(t);
			if (manual) { var b = raiz.querySelector("[data-capturar]"); if (b) b.focus(); }
			estable = 0;
			temporizador = setTimeout(vigilar, 900);
			return;
		}
		var qr = Lector.leerQR(c.img, r.H, window.jsQR ? decodificar : null);
		if (qr && qr.examenId !== o.examen.id) {
			estado("Esta hoja es de otro examen: no se leyó. Usa las hojas de «" + o.examen.titulo + "».");
			esperarRetiro = true; alumnoGuardado = null;
			temporizador = setTimeout(vigilar, 1500);
			return;
		}
		var alumnoId = qr && qr.alumnoId ? qr.alumnoId : null;
		var aviso = "";
		if (alumnoId && !alumnoPorId(alumnoId)) { aviso = "El alumno de esta hoja ya no está en el examen (baja o cambio de grado): elige a quién es."; alumnoId = null; }
		var respuestas = {}, dudosas = {};
		r.respuestas.forEach(function (x) {
			respuestas[x.id] = x.letra;
			if (x.dudosa || x.letra === "*" || x.letra === null) dudosas[x.id] = true;
		});
		lectura = { img: c.img, r: r, qr: qr, alumnoId: alumnoId, respuestas: respuestas, dudosas: dudosas, generica: !!(qr && !qr.alumnoId), sinQR: !qr, aviso: aviso };
		pintarConfirmar();
	}

	// ── Confirmar ────────────────────────────────────────────────────────────────
	function pintarConfirmar(error) {
		modo = "confirmar";
		clearTimeout(temporizador);
		var L = lectura;
		var a = L.alumnoId ? alumnoPorId(L.alumnoId) : null;
		var cuenta = contar();
		var seleccion = '<label class="flex flex-col gap-1 text-sm font-semibold">¿De quién es la hoja?<select data-alumno class="min-h-[44px] rounded-xl border border-gray-600 bg-gray-800 px-3 text-base font-normal text-white">' +
			'<option value="">Elige al alumno...</option>' + o.alumnos.map(function (x) {
				return '<option value="' + esc(x.id) + '"' + (x.id === L.alumnoId ? " selected" : "") + '>' + esc(x.nombre_completo) + ' (' + esc(x.grado) + '°)</option>';
			}).join("") + '</select></label>';
		var quien = L.alumnoId && !L.generica && !L.sinQR
			? '<p class="text-lg font-bold" data-alumno-leido>' + esc(a.nombre_completo) + ' <span class="text-sm font-normal text-gray-300">' + esc(a.grado) + '°</span></p><p class="text-xs text-gray-400">Reconocido por el código QR.</p>'
			: seleccion + '<p class="text-xs text-gray-400">' + (L.sinQR ? "No se pudo leer el código QR." : "Hoja sin nombre.") + '</p>';
		var ya = L.alumnoId && o.yaTiene ? o.yaTiene(L.alumnoId) : 0;
		raiz.innerHTML = barraSuperior("Revisa lo leído") +
			'<div class="flex-1 overflow-auto"><div class="flex flex-col lg:flex-row gap-4 p-3 sm:p-4 items-start">' +
			'<div class="w-full lg:w-auto lg:flex-1 flex justify-center"><canvas data-hoja class="bg-white rounded-lg w-full max-w-3xl h-auto cursor-pointer" aria-label="Hoja leída: toca un círculo para cambiar la respuesta"></canvas></div>' +
			'<div class="w-full lg:max-w-md flex flex-col gap-3">' + quien +
			(L.aviso ? '<p class="rounded-lg bg-amber-500/20 border border-amber-400 px-3 py-2 text-sm">' + esc(L.aviso) + '</p>' : '') +
			(ya ? '<p class="rounded-lg bg-white/10 px-3 py-2 text-sm" data-ya-tenia>Ya tenía respuestas capturadas: al guardar se reemplazan.</p>' : '') +
			'<div class="rounded-lg bg-white/10 px-3 py-2 text-sm flex flex-col gap-1" data-resumen>' + resumenHTML(cuenta) + '</div>' +
			(error ? '<p class="rounded-lg bg-red-600/30 border border-red-400 px-3 py-2 text-sm font-medium" role="alert">' + esc(error) + '</p>' : '') +
			'<p class="text-xs text-gray-300">Verde: coincide con la clave. Rojo: no coincide. Amarillo: revísala (vacía, doble marca o poco clara). Para corregir, toca la letra aquí abajo o el círculo en la hoja; tocar la marcada la deja en blanco.</p>' +
			'<ol class="flex flex-col gap-1" data-corregir aria-label="Respuestas leídas">' + filasCorregir() + '</ol>' +
			'</div></div></div>' +
			'<div class="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-center gap-2 px-4 py-3 bg-gray-900 border-t border-white/10">' +
			'<button type="button" data-repetir class="' + BTN + ' bg-white/10 hover:bg-white/20 text-white">Repetir foto</button>' +
			'<button type="button" data-guardar class="' + BTN + ' bg-emerald-600 hover:bg-emerald-500 text-white min-w-[12rem]">Guardar y seguir</button></div>';
		raiz.querySelector("[data-cerrar]").addEventListener("click", cerrar);
		raiz.querySelector("[data-repetir]").addEventListener("click", function () { esperarRetiro = false; iniciarVivo(""); });
		raiz.querySelector("[data-guardar]").addEventListener("click", guardar);
		var sel = raiz.querySelector("[data-alumno]");
		if (sel) sel.addEventListener("change", function () { L.alumnoId = sel.value || null; });
		var lienzo = raiz.querySelector("[data-hoja]");
		dibujarHoja(lienzo);
		lienzo.addEventListener("click", function (e) { tocarHoja(lienzo, e); });
		raiz.querySelector("[data-corregir]").addEventListener("click", function (e) {
			var b = e.target.closest("[data-letra]");
			if (!b) return;
			cambiar(b.closest("[data-pregunta]").dataset.pregunta, b.dataset.letra || null);
		});
		raiz.querySelector("[data-guardar]").focus();
	}

	// Una fila por pregunta leída, con sus letras (44 px): así se corrige sin atinarle al círculo
	function filasCorregir() {
		return disp.map(function (d) {
			var p = preguntaPorId(d.id), l = lectura.respuestas[d.id], dudosa = !!lectura.dudosas[d.id] || l === "*" || l === null || l === undefined;
			return '<li data-pregunta="' + esc(d.id) + '" class="flex items-center gap-2 rounded-lg px-2 py-1 ' + (dudosa ? "bg-amber-500/20" : "") + '">' +
				'<span class="w-7 text-right text-sm font-bold shrink-0">' + d.numero + '.</span><span class="flex flex-wrap gap-1">' +
				d.letras.map(function (L) {
					var sel = l === L, bien = sel && p && p.clave === L;
					return '<button type="button" data-letra="' + L + '" aria-pressed="' + sel + '" aria-label="Pregunta ' + d.numero + ', ' + X.textoRespuesta(L) + '" class="h-11 w-11 rounded-full border-2 font-bold ' +
						(sel ? (bien ? "bg-emerald-600 border-emerald-500" : "bg-red-600 border-red-500") : "border-gray-500 text-gray-200 hover:bg-white/10") + '">' + L + '</button>';
				}).join("") + '</span><span class="text-xs ' + (dudosa ? "text-amber-300" : "text-gray-400") + '">' +
				(l === "*" ? "Doble marca" : (l === null || l === undefined ? "Vacía" : (lectura.dudosas[d.id] ? "Poco clara" : ""))) + '</span></li>';
		}).join("");
	}

	function cambiar(preguntaId, letra) {
		var actual = lectura.respuestas[preguntaId];
		lectura.respuestas[preguntaId] = actual === letra ? null : letra;
		delete lectura.dudosas[preguntaId];
		var lienzo = raiz.querySelector("[data-hoja]");
		if (lienzo) dibujarHoja(lienzo);
		var res = raiz.querySelector("[data-resumen]");
		if (res) res.innerHTML = resumenHTML(contar());
		var lista = raiz.querySelector("[data-corregir]");
		if (lista) lista.innerHTML = filasCorregir();
	}

	// Lo que se muestra de la hoja: del encabezado (nombre) al último renglón de respuestas
	function zonaVista() {
		var ultimo = disp.reduce(function (m, d) { return Math.max(m, d.y); }, 90);
		var y0 = 16, y1 = Math.min(Hoja.HOJA.alto, ultimo + 9);
		return { x: 0, y: y0, ancho: Hoja.HOJA.ancho, alto: y1 - y0 };
	}

	function contar() {
		var c = { total: 0, bien: 0, mal: 0, vacias: 0, dobles: 0, revisar: 0 };
		disp.forEach(function (d) {
			var p = preguntaPorId(d.id), l = lectura.respuestas[d.id];
			c.total++;
			if (l === null || l === undefined) c.vacias++;
			else if (l === "*") c.dobles++;
			else if (p && l === p.clave) c.bien++;
			else c.mal++;
			if (lectura.dudosas[d.id]) c.revisar++;
		});
		return c;
	}
	function resumenHTML(c) {
		return '<p><span class="font-semibold">' + c.bien + ' de ' + c.total + '</span> correctas</p>' +
			'<p class="text-gray-300">' + c.mal + ' incorrectas · ' + c.vacias + ' vacías · ' + c.dobles + ' con doble marca</p>' +
			(c.revisar ? '<p class="text-amber-300">' + c.revisar + (c.revisar === 1 ? " para revisar" : " para revisar") + ' (en amarillo)</p>' : '');
	}

	function dibujarHoja(lienzo) {
		var L = lectura, z = zonaVista();
		if (!L.derecha) L.derecha = Lector.enderezar(L.img, L.r.H, ESCALA_CONFIRMAR, z);
		var e = L.derecha;
		lienzo.width = e.ancho; lienzo.height = e.alto;
		var g = lienzo.getContext("2d");
		var id = g.createImageData(e.ancho, e.alto);
		for (var i = 0, j = 0; i < e.datos.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = e.datos[i]; id.data[j + 3] = 255; }
		g.putImageData(id, 0, 0);
		var s = ESCALA_CONFIRMAR, R = Hoja.REJILLA.radio * s;
		g.save();
		g.translate(-z.x * s, -z.y * s);
		disp.forEach(function (d) {
			var p = preguntaPorId(d.id), l = L.respuestas[d.id];
			if (L.dudosas[d.id] || l === "*" || l === null || l === undefined) {
				var x0 = d.circulos[0].x * s - R - 6, x1 = d.circulos[d.circulos.length - 1].x * s + R + 6;
				g.fillStyle = "rgba(245, 158, 11, 0.22)";
				g.fillRect(x0, d.y * s - R - 5, x1 - x0, 2 * R + 10);
				g.strokeStyle = "#d97706"; g.lineWidth = 2;
				g.strokeRect(x0, d.y * s - R - 5, x1 - x0, 2 * R + 10);
			}
			d.circulos.forEach(function (c) {
				var marcada = l === c.letra || (l === "*" && L.r.respuestas.some(function (x) { return x.id === d.id && x.oscuridad[d.letras.indexOf(c.letra)] > L.r.umbral; }));
				if (!marcada) return;
				var bien = l === c.letra && p && c.letra === p.clave;
				g.beginPath();
				g.arc(c.x * s, c.y * s, R + 3, 0, Math.PI * 2);
				g.lineWidth = 4;
				g.strokeStyle = l === "*" ? "#d97706" : (bien ? "#16a34a" : "#dc2626");
				g.fillStyle = l === "*" ? "rgba(217, 119, 6, 0.25)" : (bien ? "rgba(22, 163, 74, 0.3)" : "rgba(220, 38, 38, 0.3)");
				g.fill(); g.stroke();
			});
		});
		g.restore();
	}

	function tocarHoja(lienzo, e) {
		var rect = lienzo.getBoundingClientRect(), z = zonaVista();
		var mmX = z.x + (e.clientX - rect.left) / rect.width * z.ancho;
		var mmY = z.y + (e.clientY - rect.top) / rect.height * z.alto;
		var mejor = null, dmin = 5.5;
		disp.forEach(function (d) {
			d.circulos.forEach(function (c) {
				var dd = Math.hypot(c.x - mmX, c.y - mmY);
				if (dd < dmin) { dmin = dd; mejor = { d: d, c: c }; }
			});
		});
		if (!mejor) return;
		cambiar(mejor.d.id, mejor.c.letra);
	}

	async function guardar() {
		var L = lectura;
		if (!L.alumnoId) { pintarConfirmar("Elige de quién es la hoja."); var s = raiz.querySelector("[data-alumno]"); if (s) s.focus(); return; }
		var b = raiz.querySelector("[data-guardar]");
		b.disabled = true; b.textContent = "Guardando...";
		var leidas = disp.map(function (d) { return { id: d.id, letra: L.respuestas[d.id] === undefined ? null : L.respuestas[d.id] }; });
		var r = await o.guardar(L.alumnoId, leidas);
		if (!r.ok) {
			pintarConfirmar(r.red ? "Sin señal: no se guardó. Lo leído sigue aquí; vuelve a intentar al tener señal." : (r.texto || "No se pudo guardar."));
			return;
		}
		guardadas++;
		var a = alumnoPorId(L.alumnoId);
		var c = contar();
		esperarRetiro = true;
		alumnoGuardado = L.alumnoId;
		lectura = null;
		iniciarVivo("");
		estado("Guardado: " + (a ? a.nombre_completo : "") + " (" + c.bien + " de " + c.total + "). Retira la hoja y pon la siguiente.");
	}

	window.ExamenCamara = { abrir: abrir, cerrar: cerrar, abierta: function () { return modo !== "cerrada"; } };
})();
