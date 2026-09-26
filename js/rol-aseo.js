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
	var IMG = {
		ancho: 1080, margen: 64,
		fuente: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
		azul: "#1e3a8a", azulClaro: "#dbeafe", tinta: "#1c2434", gris: "#6b7280", grisClaro: "#e5e7eb", fondo: "#ffffff", verde: "#059669",
	};

	// Parte un texto en renglones que caben en `ancho` (por palabras; una palabra larguísima se corta)
	function renglones(ctx, textoLargo, ancho) {
		var palabras = String(textoLargo || "").split(/\s+/).filter(Boolean);
		var out = [], linea = "";
		palabras.forEach(function (p) {
			var prueba = linea ? linea + " " + p : p;
			if (ctx.measureText(prueba).width <= ancho) { linea = prueba; return; }
			if (linea) out.push(linea);
			linea = p;
			while (ctx.measureText(linea).width > ancho && linea.length > 1) {
				var corte = linea.length - 1;
				while (corte > 1 && ctx.measureText(linea.slice(0, corte)).width > ancho) corte--;
				out.push(linea.slice(0, corte));
				linea = linea.slice(corte);
			}
		});
		if (linea) out.push(linea);
		return out.length ? out : [""];
	}

	/*
		disenar(ctx, datos) → { alto, ops } — calcula cada texto y rectángulo y su posición.
		datos: { mes, escuela, grupo, semanas: porSemanas(filas), fechaCorta, fechaSemana }
		Separado de pintar() para poder probarlo con un ctx falso.
	*/
	function disenar(ctx, datos) {
		var W = IMG.ancho, M = IMG.margen, F = IMG.fuente;
		var ops = [], y = 0;
		function fuente(tam, peso) { return (peso || 400) + " " + tam + "px " + F; }
		function textoOp(t, x, yy, tam, peso, color, alinear) { ops.push({ t: "texto", texto: t, x: x, y: yy, fuente: fuente(tam, peso), color: color, alinear: alinear || "left" }); }

		// Encabezado azul
		ctx.font = fuente(58, 800);
		var titulo = renglones(ctx, datos.mes, W - 2 * M);
		ctx.font = fuente(34, 500);
		var escuela = datos.escuela ? renglones(ctx, datos.escuela, W - 2 * M) : [];
		var grupo = datos.grupo ? renglones(ctx, "Grupo: " + datos.grupo, W - 2 * M) : [];
		var alto = 56 + 40 + 16 + titulo.length * 70 + (escuela.length || grupo.length ? 18 : 0) + (escuela.length + grupo.length) * 46 + 48;
		ops.push({ t: "rect", x: 0, y: 0, w: W, h: alto, color: IMG.azul });
		y = 56;
		textoOp("ROL DE ASEO", M, y + 30, 30, 700, "#bfdbfe");
		y += 40 + 16;
		titulo.forEach(function (l) { textoOp(l, M, y + 56, 58, 800, "#ffffff"); y += 70; });
		if (escuela.length || grupo.length) y += 18;
		escuela.forEach(function (l) { textoOp(l, M, y + 34, 34, 500, IMG.azulClaro); y += 46; });
		grupo.forEach(function (l) { textoOp(l, M, y + 34, 34, 500, IMG.azulClaro); y += 46; });
		y = alto + 40;

		var colDia = 190;
		var anchoNombres = W - 2 * M - colDia;
		if (!datos.semanas.length) {
			textoOp("Este mes no tiene días de clase.", M, y + 40, 40, 500, IMG.gris);
			y += 80;
		}
		datos.semanas.forEach(function (s, si) {
			if (si > 0) y += 18;
			textoOp(datos.fechaSemana(s), M, y + 28, 28, 700, IMG.gris);
			y += 48;
			s.filas.forEach(function (f, fi) {
				var inicio = y;
				if (f.clase) {
					ctx.font = fuente(42, 600);
					var lineas = [];
					if (!f.alumnos.length) lineas.push({ texto: "Sin alumnos", color: IMG.gris });
					f.alumnos.forEach(function (a) {
						renglones(ctx, a.nombre, anchoNombres).forEach(function (l) { lineas.push({ texto: l, color: a.baja ? IMG.gris : IMG.tinta }); });
					});
					var altoFila = Math.max(1, lineas.length) * 56 + 28;
					if (fi % 2 === 0) ops.push({ t: "rect", x: M - 16, y: inicio, w: W - 2 * M + 32, h: altoFila, color: "#f3f6fc", radio: 18 });
					textoOp(datos.fechaCorta(f.fecha), M + 8, inicio + 14 + 44, 42, 800, IMG.azul);
					lineas.forEach(function (l, li) { textoOp(l.texto, M + colDia, inicio + 14 + 44 + li * 56, 42, 600, l.color); });
					y += altoFila;
				} else {
					ctx.font = fuente(32, 500);
					var motivo = renglones(ctx, "Sin clase: " + f.motivo, anchoNombres);
					var altoGris = motivo.length * 42 + 24;
					textoOp(datos.fechaCorta(f.fecha), M + 8, inicio + 12 + 34, 34, 700, "#9ca3af");
					motivo.forEach(function (l, li) { textoOp(l, M + colDia, inicio + 12 + 34 + li * 42, 32, 500, "#9ca3af"); });
					y += altoGris;
				}
				y += 8;
			});
		});
		y += 32;
		ops.push({ t: "rect", x: M, y: y, w: W - 2 * M, h: 2, color: IMG.grisClaro });
		y += 30;
		textoOp("Hecho con Jissez Mi Salón", M, y + 26, 26, 500, IMG.gris);
		y += 26 + M;
		return { alto: Math.ceil(y), ops: ops };
	}

	// Dibuja en un <canvas> (navegador). Devuelve el canvas.
	function pintar(canvas, datos) {
		var ctx = canvas.getContext("2d");
		var d = disenar(ctx, datos);
		canvas.width = IMG.ancho;
		canvas.height = d.alto;
		ctx = canvas.getContext("2d");
		ctx.fillStyle = IMG.fondo;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.textBaseline = "alphabetic";
		d.ops.forEach(function (op) {
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
		inicioContinuo: inicioContinuo, cambiar: cambiar, diferencias: diferencias, asignacionValida: asignacionValida,
		filasDelMes: filasDelMes, porSemanas: porSemanas, texto: texto,
		renglones: renglones, disenar: disenar, pintar: pintar,
	};
	if (typeof window !== "undefined") window.RolAseo = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
})();
