/*
	rol-aseo.js — Reparto del rol de aseo de un mes (reglas puras) y su imagen para WhatsApp.

	Reglas (decisión de Jorge, 2026-09-25):
	  - Solo alumnos ACTIVOS del grupo activo, en orden de lista (num_lista y, a igualdad, nombre).
	  - Solo días de CLASE del mes, según el calendario oficial más los ajustes del grupo
	    (CalendarioSEP.diasDeClase); los días sin clase se saltan y no gastan turno.
	  - De 1 a 5 alumnos por día, en orden y en círculo: al llegar al último sigue el primero.
	    Si el grupo tiene menos alumnos que "alumnos por día", ese día van todos (sin repetir).
	  - Empieza con el alumno que elija la maestra; si elige continuar, con el que seguía al
	    terminar el mes anterior (siguiente_alumno_id del rol guardado; si ese alumno ya no está
	    activo, el siguiente activo por número de lista).
	  - Los cambios a mano quedan en la asignación guardada; no mueven la rotación: el mes siguiente
	    continúa donde iba el reparto, no donde quedaron los cambios.

	Asignación: [{ fecha: "AAAA-MM-DD", alumnos: [alumno_id, …] }] (lo que guarda roles_aseo).

	Imagen: se dibuja con Canvas 2D (sin librerías): vertical, 1080 px de ancho, letra grande,
	con título, mes, escuela y grupo si existen, los días por semana y los días sin clase en gris.
	Un mes largo sale en varias imágenes de 2400 px como máximo ("1 de 3"), por semanas.

	Alta después de guardar (tras R19b): el rol guarda los alumnos activos al generarlo
	(activos_al_generar); un alumno activo que no estaba y no tiene turno sale en el aviso
	"alumnos nuevos sin turno" (nuevosSinTurno) y la pantalla ofrece regenerar. No cambia solo.
*/

(function () {
	"use strict";

	var POR_DIA_MIN = 1, POR_DIA_MAX = 5;

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function porDiaValido(n) {
		var v = Math.round(Number(n));
		if (!isFinite(v)) return 2;
		return Math.min(POR_DIA_MAX, Math.max(POR_DIA_MIN, v));
	}

	// Orden de lista: num_lista (sin número al final) y, a igualdad, nombre
	function ordenarAlumnos(lista) {
		return (lista || []).slice().sort(function (a, b) {
			var na = typeof a.num_lista === "number" ? a.num_lista : Infinity;
			var nb = typeof b.num_lista === "number" ? b.num_lista : Infinity;
			if (na !== nb) return na < nb ? -1 : 1;
			return String(a.nombre_completo || "").localeCompare(String(b.nombre_completo || ""), "es");
		});
	}

	/*
		generar({ dias, alumnos, porDia, inicioId }) →
		  { asignacion, siguienteId, siguienteNum }
		alumnos: ya ordenados y activos. inicioId: con quién empieza (si no está, el primero).
	*/
	function generar(o) {
		var dias = (o && o.dias) || [];
		var alumnos = (o && o.alumnos) || [];
		var n = alumnos.length;
		var k = Math.min(porDiaValido(o && o.porDia), n);
		var idx = 0;
		for (var i = 0; i < n; i++) if (alumnos[i].id === (o && o.inicioId)) { idx = i; break; }
		var asignacion = dias.map(function (f) {
			var hoy = [];
			for (var j = 0; j < k; j++) hoy.push(alumnos[(idx + j) % n].id);
			if (n) idx = (idx + k) % n;
			return { fecha: f, alumnos: hoy };
		});
		var sig = n ? alumnos[idx] : null;
		return { asignacion: asignacion, siguienteId: sig ? sig.id : null, siguienteNum: sig && typeof sig.num_lista === "number" ? sig.num_lista : null };
	}

	/*
		Con quién empieza un mes que continúa al anterior.
		rolAnterior: fila de roles_aseo del mes previo ({siguiente_alumno_id, siguiente_num_lista})
		activos: alumnos activos ordenados · todos: todos los del grupo (para el número de lista de
		alguien dado de baja). → { id, exacto } o null si no hay rol anterior o no hay alumnos.
	*/
	function inicioContinuo(rolAnterior, activos, todos) {
		if (!rolAnterior || !activos || !activos.length) return null;
		var id = rolAnterior.siguiente_alumno_id;
		for (var i = 0; i < activos.length; i++) if (activos[i].id === id) return { id: id, exacto: true };
		var num = rolAnterior.siguiente_num_lista;
		if (typeof num !== "number" && id) {
			(todos || []).forEach(function (a) { if (a.id === id && typeof a.num_lista === "number") num = a.num_lista; });
		}
		if (typeof num !== "number") return { id: activos[0].id, exacto: false };
		for (var j = 0; j < activos.length; j++) {
			if (typeof activos[j].num_lista === "number" && activos[j].num_lista >= num) return { id: activos[j].id, exacto: false };
		}
		return { id: activos[0].id, exacto: false };
	}

	// Cambia a mano un alumno de un día (devuelve una asignación nueva)
	function cambiar(asignacion, fecha, posicion, nuevoId) {
		return (asignacion || []).map(function (d) {
			if (d.fecha !== fecha) return d;
			var al = (d.alumnos || []).slice();
			if (posicion >= 0 && posicion < al.length && nuevoId) al[posicion] = nuevoId;
			return { fecha: d.fecha, alumnos: al };
		});
	}

	// ¿La asignación guardada sigue coincidiendo con los días de clase de hoy?
	function diferencias(asignacion, dias) {
		var guardados = (asignacion || []).map(function (d) { return d.fecha; });
		return {
			sobran: guardados.filter(function (f) { return dias.indexOf(f) === -1; }),
			faltan: dias.filter(function (f) { return guardados.indexOf(f) === -1; }),
		};
	}

	/*
		Alumnos nuevos sin turno: activos hoy que NO estaban activos cuando se generó el rol
		(activosAlGenerar, columna roles_aseo.activos_al_generar) y que no tienen ningún día en la
		asignación (si la maestra ya lo puso a mano, no se avisa). Sin la lista (rol anterior a la
		columna) no se puede saber quién es nuevo: []. → los alumnos (en el orden de activos).
	*/
	function nuevosSinTurno(asignacion, activos, activosAlGenerar) {
		if (!Array.isArray(activosAlGenerar)) return [];
		var conTurno = {};
		(asignacion || []).forEach(function (d) { (d.alumnos || []).forEach(function (id) { conTurno[id] = true; }); });
		return (activos || []).filter(function (a) { return activosAlGenerar.indexOf(a.id) === -1 && !conTurno[a.id]; });
	}

	// Validar lo leído de la base (jsonb): solo [{fecha, alumnos: [texto]}]
	function asignacionValida(v) {
		if (!Array.isArray(v)) return [];
		return v.filter(function (d) { return d && typeof d.fecha === "string" && Array.isArray(d.alumnos); })
			.map(function (d) { return { fecha: d.fecha.slice(0, 10), alumnos: d.alumnos.filter(function (x) { return typeof x === "string"; }) }; });
	}

	/*
		Filas del mes para la vista, la imagen, el texto y la impresión, en orden de fecha:
		  { fecha, clase: true, alumnos: [{id, nombre, baja}] } para cada día de la asignación
		  { fecha, clase: false, motivo } para los días hábiles del mes sin clase
		nombres: { alumno_id: {nombre, activo} }
	*/
	function filasDelMes(asignacion, sinClase, nombres) {
		var filas = (asignacion || []).map(function (d) {
			return {
				fecha: d.fecha, clase: true,
				alumnos: d.alumnos.map(function (id) {
					var a = nombres[id];
					return { id: id, nombre: a ? a.nombre : "Alumno que ya no está en la lista", baja: !a || !a.activo };
				}),
			};
		});
		var ya = {};
		filas.forEach(function (f) { ya[f.fecha] = true; });
		(sinClase || []).forEach(function (t) {
			if (!ya[t.fecha]) filas.push({ fecha: t.fecha, clase: false, motivo: t.motivo || t.etiqueta || "Sin clase" });
		});
		return filas.sort(function (a, b) { return a.fecha < b.fecha ? -1 : (a.fecha > b.fecha ? 1 : 0); });
	}

	// Agrupa filas por semana (lunes a viernes). → [{ lunes, filas }]
	function porSemanas(filas, sumarDias, diaSemana) {
		var semanas = [], actual = null;
		(filas || []).forEach(function (f) {
			var d = diaSemana(f.fecha);
			var lunes = sumarDias(f.fecha, d === 0 ? -6 : 1 - d);
			if (!actual || actual.lunes !== lunes) { actual = { lunes: lunes, filas: [] }; semanas.push(actual); }
			actual.filas.push(f);
		});
		return semanas;
	}

	// Texto para copiar (WhatsApp): una línea por día de clase
	function texto(meta, filas, fechaCorta) {
		var cab = ["Rol de aseo, " + meta.mes];
		if (meta.escuela) cab.push(meta.escuela);
		if (meta.grupo) cab.push("Grupo: " + meta.grupo);
		var lineas = (filas || []).filter(function (f) { return f.clase; }).map(function (f) {
			return fechaCorta(f.fecha) + ": " + (f.alumnos.length ? f.alumnos.map(function (a) { return a.nombre; }).join(", ") : "sin alumnos");
		});
		return cab.join("\n") + "\n\n" + (lineas.length ? lineas.join("\n") : "Este mes no tiene días de clase.");
	}

	// ── Imagen (Canvas 2D) ──────────────────────────────────────────────────────
	/*
		Una o varias imágenes de 1080 px de ancho y como máximo altoMax (2400 px, proporción de
		teléfono): WhatsApp reduce una imagen muy alta y la letra queda chica (tras R19b, un mes
		con 2 por día medía 1080 × 5084). Las semanas se reparten en imágenes sin partir una
		semana si cabe entera en una imagen; si una semana sola no cabe (5 por día con nombres
		largos), se parte entre días y su título dice "(continúa)". Con más de una imagen, cada
		una dice "1 de 3" arriba y "Sigue en la imagen 2 de 3" abajo, y todas llevan el mismo
		encabezado (se comparten sueltas en WhatsApp).
		Un nombre que no cabe en un renglón sigue en el de abajo con sangría (colgante), para que
		no parezca otro alumno.
	*/
	var IMG = {
		ancho: 1080, margen: 64, altoMax: 2400, sangria: 40,
		fuente: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
		azul: "#1e3a8a", azulClaro: "#dbeafe", tinta: "#1c2434", gris: "#6b7280", grisClaro: "#e5e7eb", fondo: "#ffffff", verde: "#059669",
	};

	/*
		Parte un texto en renglones que caben en `ancho` (por palabras; una palabra larguísima se
		corta). anchoSiguientes: el ancho de los renglones 2 en adelante (más angosto con sangría);
		si falta, el mismo.
	*/
	function renglones(ctx, textoLargo, ancho, anchoSiguientes) {
		var palabras = String(textoLargo || "").split(/\s+/).filter(Boolean);
		var out = [], linea = "";
		function tope() { return out.length ? (anchoSiguientes || ancho) : ancho; }
		palabras.forEach(function (p) {
			var prueba = linea ? linea + " " + p : p;
			if (ctx.measureText(prueba).width <= tope()) { linea = prueba; return; }
			if (linea) out.push(linea);
			linea = p;
			while (ctx.measureText(linea).width > tope() && linea.length > 1) {
				var corte = linea.length - 1;
				while (corte > 1 && ctx.measureText(linea.slice(0, corte)).width > tope()) corte--;
				out.push(linea.slice(0, corte));
				linea = linea.slice(corte);
			}
		});
		if (linea) out.push(linea);
		return out.length ? out : [""];
	}

	function fuenteImg(tam, peso) { return (peso || 400) + " " + tam + "px " + IMG.fuente; }
	function opTexto(t, x, y, tam, peso, color, alinear) {
		return { t: "texto", texto: t, x: x, y: y, fuente: fuenteImg(tam, peso), color: color, alinear: alinear || "left" };
	}
	// Mueve hacia abajo las operaciones de un bloque armado desde y = 0
	function mover(ops, dy) {
		return ops.map(function (o) { var c = {}; for (var k in o) c[k] = o[k]; c.y = o.y + dy; return c; });
	}

	// Encabezado azul (igual en todas las imágenes). etiqueta: "1 de 3" o "".
	function encabezado(ctx, datos) {
		var W = IMG.ancho, M = IMG.margen;
		ctx.font = fuenteImg(58, 800);
		var titulo = renglones(ctx, datos.mes, W - 2 * M);
		ctx.font = fuenteImg(34, 500);
		var escuela = datos.escuela ? renglones(ctx, datos.escuela, W - 2 * M) : [];
		var grupo = datos.grupo ? renglones(ctx, "Grupo: " + datos.grupo, W - 2 * M) : [];
		var alto = 56 + 40 + 16 + titulo.length * 70 + (escuela.length || grupo.length ? 18 : 0) + (escuela.length + grupo.length) * 46 + 48;
		return {
			alto: alto,
			ops: function (etiqueta) {
				var ops = [{ t: "rect", x: 0, y: 0, w: W, h: alto, color: IMG.azul }];
				var y = 56;
				ops.push(opTexto("ROL DE ASEO", M, y + 30, 30, 700, "#bfdbfe"));
				if (etiqueta) ops.push(opTexto(etiqueta, W - M, y + 30, 30, 700, "#ffffff", "right"));
				y += 40 + 16;
				titulo.forEach(function (l) { ops.push(opTexto(l, M, y + 56, 58, 800, "#ffffff")); y += 70; });
				if (escuela.length || grupo.length) y += 18;
				escuela.forEach(function (l) { ops.push(opTexto(l, M, y + 34, 34, 500, IMG.azulClaro)); y += 46; });
				grupo.forEach(function (l) { ops.push(opTexto(l, M, y + 34, 34, 500, IMG.azulClaro)); y += 46; });
				return ops;
			},
		};
	}

	var COL_DIA = 190, ALTO_TITULO_SEMANA = 48, SEP_SEMANA = 18, SEP_DIA = 8, ALTO_PIE = 32 + 2 + 30 + 26 + 64;

	// Un día (con clase o sin clase), armado desde y = 0. par: fondo gris claro alternado.
	function bloqueDia(ctx, datos, f, par) {
		var W = IMG.ancho, M = IMG.margen;
		var anchoNombres = W - 2 * M - COL_DIA;
		var ops = [];
		if (f.clase) {
			ctx.font = fuenteImg(42, 600);
			var lineas = [];
			if (!f.alumnos.length) lineas.push({ texto: "Sin alumnos", color: IMG.gris, x: M + COL_DIA });
			f.alumnos.forEach(function (a) {
				// Sangría colgante: los renglones que siguen del mismo nombre, más adentro
				renglones(ctx, a.nombre, anchoNombres, anchoNombres - IMG.sangria).forEach(function (l, i) {
					lineas.push({ texto: l, color: a.baja ? IMG.gris : IMG.tinta, x: M + COL_DIA + (i ? IMG.sangria : 0) });
				});
			});
			var alto = Math.max(1, lineas.length) * 56 + 28;
			if (par) ops.push({ t: "rect", x: M - 16, y: 0, w: W - 2 * M + 32, h: alto, color: "#f3f6fc", radio: 18 });
			ops.push(opTexto(datos.fechaCorta(f.fecha), M + 8, 14 + 44, 42, 800, IMG.azul));
			lineas.forEach(function (l, li) { ops.push(opTexto(l.texto, l.x, 14 + 44 + li * 56, 42, 600, l.color)); });
			return { alto: alto, ops: ops };
		}
		ctx.font = fuenteImg(32, 500);
		var motivo = renglones(ctx, "Sin clase: " + f.motivo, anchoNombres, anchoNombres - IMG.sangria);
		ops.push(opTexto(datos.fechaCorta(f.fecha), M + 8, 12 + 34, 34, 700, "#9ca3af"));
		motivo.forEach(function (l, li) { ops.push(opTexto(l, M + COL_DIA + (li ? IMG.sangria : 0), 12 + 34 + li * 42, 32, 500, "#9ca3af")); });
		return { alto: motivo.length * 42 + 24, ops: ops };
	}

	/*
		paginas(ctx, datos, altoMax?) → [{ alto, ops }] — una por imagen, con cada texto y
		rectángulo y su posición. datos: { mes, escuela, grupo, semanas: porSemanas(filas),
		fechaCorta, fechaSemana }. Separado de pintar() para probarlo con un ctx falso.
	*/
	function paginas(ctx, datos, altoMax) {
		var W = IMG.ancho, M = IMG.margen;
		var tope = altoMax || IMG.altoMax;
		var cab = encabezado(ctx, datos);
		var inicio = cab.alto + 40;
		var disponible = Math.max(200, tope - inicio - ALTO_PIE);

		// Las semanas en bloques: título y días (con su alto)
		var semanas = (datos.semanas || []).map(function (s) {
			var dias = s.filas.map(function (f, fi) { return bloqueDia(ctx, datos, f, fi % 2 === 0); });
			var alto = ALTO_TITULO_SEMANA + dias.reduce(function (t, d) { return t + d.alto + SEP_DIA; }, 0);
			return { titulo: datos.fechaSemana(s), dias: dias, alto: alto };
		});

		// Reparto en páginas: [{ elementos: [{titulo}|{dia}], usado }]
		var hojas = [{ elementos: [], usado: 0 }];
		function actual() { return hojas[hojas.length - 1]; }
		function nueva() { hojas.push({ elementos: [], usado: 0 }); }
		function poner(el, alto) {
			var h = actual();
			var sep = el.titulo !== undefined && h.elementos.length ? SEP_SEMANA : 0;
			h.elementos.push(el);
			h.usado += sep + alto;
		}
		semanas.forEach(function (s) {
			var h = actual();
			var sep = h.elementos.length ? SEP_SEMANA : 0;
			// La semana entera no cabe en lo que queda pero sí en una imagen nueva: a la siguiente
			if (h.elementos.length && h.usado + sep + s.alto > disponible) nueva();
			poner({ titulo: s.titulo }, ALTO_TITULO_SEMANA);
			s.dias.forEach(function (d) {
				var hh = actual();
				if (hh.usado + d.alto + SEP_DIA > disponible && hh.elementos.length > 1) {
					nueva();
					poner({ titulo: s.titulo + " (continúa)" }, ALTO_TITULO_SEMANA);
				}
				poner({ dia: d }, d.alto + SEP_DIA);
			});
		});

		var n = hojas.length;
		return hojas.map(function (h, hi) {
			var ops = cab.ops(n > 1 ? (hi + 1) + " de " + n : "");
			var y = inicio;
			if (!semanas.length) {
				ops.push(opTexto("Este mes no tiene días de clase.", M, y + 40, 40, 500, IMG.gris));
				y += 80;
			}
			h.elementos.forEach(function (el, ei) {
				if (el.titulo !== undefined) {
					if (ei > 0) y += SEP_SEMANA;
					ops.push(opTexto(el.titulo, M, y + 28, 28, 700, IMG.gris));
					y += ALTO_TITULO_SEMANA;
					return;
				}
				ops = ops.concat(mover(el.dia.ops, y));
				y += el.dia.alto + SEP_DIA;
			});
			y += 32;
			ops.push({ t: "rect", x: M, y: y, w: W - 2 * M, h: 2, color: IMG.grisClaro });
			y += 30;
			ops.push(opTexto("Hecho con Jissez Mi Salón", M, y + 26, 26, 500, IMG.gris));
			if (hi < n - 1) ops.push(opTexto("Sigue en la imagen " + (hi + 2) + " de " + n, W - M, y + 26, 26, 700, IMG.azul, "right"));
			y += 26 + M;
			return { alto: Math.ceil(y), ops: ops };
		});
	}

	// Dibuja una página de paginas() en un <canvas> (navegador). Devuelve el canvas.
	function pintar(canvas, pagina) {
		var ctx = canvas.getContext("2d");
		canvas.width = IMG.ancho;
		canvas.height = pagina.alto;
		ctx = canvas.getContext("2d");
		ctx.fillStyle = IMG.fondo;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.textBaseline = "alphabetic";
		pagina.ops.forEach(function (op) {
			if (op.t === "rect") {
				ctx.fillStyle = op.color;
				if (op.radio && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(op.x, op.y, op.w, op.h, op.radio); ctx.fill(); }
				else ctx.fillRect(op.x, op.y, op.w, op.h);
				return;
			}
			ctx.font = op.fuente;
			ctx.fillStyle = op.color;
			ctx.textAlign = op.alinear;
			ctx.fillText(op.texto, op.x, op.y);
		});
		return canvas;
	}

	var api = {
		POR_DIA_MIN: POR_DIA_MIN, POR_DIA_MAX: POR_DIA_MAX, IMG: IMG,
		esc: esc, porDiaValido: porDiaValido, ordenarAlumnos: ordenarAlumnos, generar: generar,
		inicioContinuo: inicioContinuo, cambiar: cambiar, diferencias: diferencias, nuevosSinTurno: nuevosSinTurno, asignacionValida: asignacionValida,
		filasDelMes: filasDelMes, porSemanas: porSemanas, texto: texto,
		renglones: renglones, paginas: paginas, pintar: pintar,
	};
	if (typeof window !== "undefined") window.RolAseo = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
