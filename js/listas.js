/*
	listas.js — Listas de cooperación y materiales del grupo (decisiones de Jorge, 2026-09-26).

	Una tabla libre por grupo para cuotas, materiales, permisos firmados o tallas. Tablas
	listas_grupo, listas_columnas y listas_valores (supabase/mi_salon_b15_listas_2026-09.sql).

	Qué permite
	  - Varias listas por grupo, cada una con nombre, fecha y descripción opcional.
	  - Columnas que crea la maestra (hasta MAX_COLUMNAS), de tres tipos:
	      palomita → entregó / no entregó;
	      texto    → libre ("Talla 8");
	      monto    → pesos; la cantidad esperada por alumno es opcional y, si se define, se
	                 calcula lo reunido y lo que falta. Todo se suma en CENTAVOS enteros (sin
	                 errores de punto flotante) y una cantidad capturada se redondea a centavos.
	  - Filas: alumnos activos en orden de lista. Un alumno dado de baja DESPUÉS conserva su
	    registro: sigue en la lista si tiene algo registrado (marcado "baja"). Se marca con toques.
	  - Resumen arriba por columna ("17 de 20 entregaron", "$850 de $1,000 reunidos, faltan
	    $150") y avance general; los pendientes van resaltados.

	Quién cuenta en una lista (filasDeLista)
	  - Lista abierta: los alumnos activos de hoy cuentan en todas las columnas. Un alumno que
	    ya no está activo solo aparece si tiene algo registrado, y solo cuenta en la columna
	    donde participó (entregó, escribió o aportó): así una baja no se queda "debiendo".
	  - Lista cerrada: igual, pero con los alumnos activos AL CERRARLA (activos_al_cerrar):
	    el expediente no cambia con altas y bajas posteriores.

	Para las familias (decisión de Jorge: SIN nombres)
	  - La imagen PNG (Canvas, 1080 px de ancho, partes de 2400 px como máximo, como el rol de
	    aseo) y "Copiar texto para las familias" solo llevan el nombre de la lista, grupo,
	    escuela, fecha, descripción y el resumen por columna ("Entregaron 17 de 20; faltan 3",
	    "Reunido $850 de $1,000"), con el pie "Hecho con Jissez Mi Salón". Nunca a quién le falta.
	  - La maestra avisa en privado: "Recordar por WhatsApp" por alumno pendiente abre el chat
	    con su tutor (wa.me/52…, js/ficha-alumno.js) con un mensaje amable que ella edita; solo
	    si la ficha tiene teléfono.
	  - Imprimir es la versión con nombres, "Solo para la maestra" (uso interno).

	Historial (decisión de Jorge: se guarda como expediente)
	  - "Cerrar" deja la lista de solo lectura en el historial del grupo; no se borra (la base
	    lo impide). Reabrir pide confirmación.
	  - Por alumno: en cuántas listas cerradas cumplió ("Cumplió en 5 de 6"), como referencia
	    para la maestra; no se imprime ni se comparte. Tono respetuoso: "Completo", "Parcial" y
	    "Sin registro", nunca "debe" ni "no cumplió".

	La parte pura (montos, resumen, historial, textos, imagen y HTML) se exporta a node para
	pruebas/listas.test.js. js/exportar.js la usa para la hoja "Listas" del Excel.
*/
(function () {
	"use strict";

	var R = typeof window !== "undefined" && window.RolAseo ? window.RolAseo : (typeof require === "function" ? require("./rol-aseo.js") : null);

	var LARGO = { nombre: 80, descripcion: 300, columna: 40, texto: 80 };
	var MAX_COLUMNAS = 12;
	var MONTO_MAX_CENT = 99999999; // $999,999.99 (numeric(9,2) de la base)
	var TIPOS = {
		palomita: { etiqueta: "Palomita", ayuda: "Entregó o no entregó (material, permiso firmado)." },
		texto: { etiqueta: "Texto", ayuda: "Algo que escribes, por ejemplo una talla." },
		monto: { etiqueta: "Monto en pesos", ayuda: "Cuánto aportó cada alumno. Suma lo reunido." },
	};
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function limpiar(t) { return String(t === null || t === undefined ? "" : t).replace(/\s+/g, " ").trim(); }

	// "2026-09-25" → "25 de septiembre de 2026"
	function formatoFecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		if (!m || !MESES[Number(m[2]) - 1]) return "";
		return Number(m[3]) + " de " + MESES[Number(m[2]) - 1] + " de " + m[1];
	}

	// ── Pesos (siempre en centavos enteros) ─────────────────────────────────────
	// Valor de la base (numeric → "50.00" o número) → centavos enteros; vacío → null
	function aCentavos(v) {
		if (v === null || v === undefined || v === "") return null;
		var n = Number(v);
		if (!isFinite(n)) return null;
		return Math.round(n * 100);
	}

	/*
		parsearMonto(texto) → { ok, vacio, centavos, valor, error }
		  "50", "$50", "50.5", "1,000", "$1,000.50", "50,50" (coma decimal) → ok
		  "12.345" → se redondea a centavos (12.35), con la regla de medio hacia arriba, por texto
		  (sin punto flotante). Negativos, letras o más de $999,999.99 → error.
	*/
	function parsearMonto(texto) {
		var s = String(texto === null || texto === undefined ? "" : texto).replace(/\s+/g, "").replace(/^\$/, "").replace(/(mxn|pesos?)$/i, "");
		if (!s) return { ok: true, vacio: true, centavos: null, valor: null, error: "" };
		if (/^-/.test(s)) return { ok: false, vacio: false, centavos: null, valor: null, error: "La cantidad no puede ser negativa." };
		if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) s = s.replace(/,/g, "");
		else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
		var m = /^(\d*)(?:\.(\d*))?$/.exec(s);
		if (!m || (!m[1] && !m[2])) return { ok: false, vacio: false, centavos: null, valor: null, error: "Escribe solo la cantidad en pesos, por ejemplo 50 o 50.50." };
		var enteros = m[1] ? Number(m[1]) : 0;
		var dec = (m[2] || "") + "000";
		var cent = enteros * 100 + Number(dec.slice(0, 2)) + (Number(dec.charAt(2)) >= 5 ? 1 : 0);
		if (!isFinite(cent) || cent > MONTO_MAX_CENT) return { ok: false, vacio: false, centavos: null, valor: null, error: "La cantidad es muy grande (máximo $999,999.99)." };
		return { ok: true, vacio: false, centavos: cent, valor: cent / 100, error: "" };
	}

	// centavos → "$1,000" o "$850.50" (es-MX)
	function pesos(cent) {
		var c = Math.round(Number(cent) || 0);
		var neg = c < 0;
		c = Math.abs(c);
		var enteros = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		var resto = c % 100;
		return (neg ? "-" : "") + "$" + enteros + (resto ? "." + (resto < 10 ? "0" : "") + resto : "");
	}
	// centavos → lo que va en el campo para editarlo ("50" o "50.50")
	function montoEditable(cent) {
		if (cent === null || cent === undefined) return "";
		var resto = cent % 100;
		return Math.floor(cent / 100) + (resto ? "." + (resto < 10 ? "0" : "") + resto : "");
	}

	// ── Orden y filas ─────────────────────────────────────────────────────────
	function ordenarAlumnos(lista) {
		return (lista || []).slice().sort(function (a, b) {
			var na = typeof a.num_lista === "number" ? a.num_lista : Infinity;
			var nb = typeof b.num_lista === "number" ? b.num_lista : Infinity;
			if (na !== nb) return na < nb ? -1 : 1;
			return String(a.nombre_completo || "").localeCompare(String(b.nombre_completo || ""), "es");
		});
	}
	function ordenarColumnas(cols) {
		return (cols || []).slice().sort(function (a, b) {
			return (a.orden || 0) - (b.orden || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id));
		});
	}

	/*
		mapaValores(filas) → { columna_id: { alumno_id: fila } }
	*/
	function mapaValores(filas) {
		var m = {};
		(filas || []).forEach(function (v) {
			if (!m[v.columna_id]) m[v.columna_id] = {};
			m[v.columna_id][v.alumno_id] = v;
		});
		return m;
	}
	function valorDe(mapa, colId, alId) { return (mapa[colId] && mapa[colId][alId]) || null; }

	// ¿El alumno participó en esa columna? (entregó, escribió algo o aportó más de $0)
	function participa(col, v) {
		if (!v) return false;
		if (col.tipo === "palomita") return v.entregado === true;
		if (col.tipo === "texto") return limpiar(v.texto) !== "";
		if (col.tipo === "monto") return (aCentavos(v.monto) || 0) > 0;
		return false;
	}
	// Cuota por alumno en centavos; 0 o vacía = sin cuota
	function esperadoCent(col) {
		var e = aCentavos(col && col.monto_esperado);
		return e && e > 0 ? e : null;
	}
	/*
		¿Cumple en esa columna? palomita: entregó. monto con cuota: aportó la cuota completa; sin
		cuota: aportó algo. texto: tiene algo escrito ("registrado").
	*/
	function cumple(col, v) {
		if (col.tipo === "monto") {
			var c = v ? (aCentavos(v.monto) || 0) : 0;
			var e = esperadoCent(col);
			return e ? c >= e : c > 0;
		}
		return participa(col, v);
	}

	/*
		filasDeLista(lista, columnas, alumnos, mapa) → [{ alumno, cuenta, baja }]
		cuenta: el alumno cuenta en TODAS las columnas (activo hoy, o activo al cerrar la lista).
		Los demás solo salen si participaron en alguna columna, y solo cuentan donde participaron.
	*/
	function activosDeLista(lista, alumnos) {
		if (lista && lista.estado === "cerrada" && Array.isArray(lista.activos_al_cerrar)) return lista.activos_al_cerrar.slice();
		return (alumnos || []).filter(function (a) { return a.estatus === "activo"; }).map(function (a) { return a.id; });
	}
	function filasDeLista(lista, columnas, alumnos, mapa) {
		var activos = {};
		activosDeLista(lista, alumnos).forEach(function (id) { activos[id] = true; });
		return ordenarAlumnos(alumnos).filter(function (a) {
			if (activos[a.id]) return true;
			return (columnas || []).some(function (c) { return participa(c, valorDe(mapa, c.id, a.id)); });
		}).map(function (a) {
			return { alumno: a, cuenta: !!activos[a.id], baja: a.estatus !== "activo" };
		});
	}
	// ¿Esa fila cuenta en esa columna?
	function cuentaEn(fila, col, mapa) {
		return fila.cuenta || participa(col, valorDe(mapa, col.id, fila.alumno.id));
	}

	/*
		resumenColumna(col, filas, mapa) → {
		  columna, tipo, total, hechos, faltan, pendientes: [alumno_id],
		  (monto) reunido, esperadoTotal, falta, cuota, aportaron: en centavos
		}
		"falta" en montos = la suma de lo que le falta a cada alumno para su cuota (lo que aportó
		de más uno no cubre lo de otro).
	*/
	function resumenColumna(col, filas, mapa) {
		var r = { columna: col, tipo: col.tipo, total: 0, hechos: 0, faltan: 0, pendientes: [] };
		var cuota = col.tipo === "monto" ? esperadoCent(col) : null;
		if (col.tipo === "monto") { r.reunido = 0; r.aportaron = 0; r.cuota = cuota; r.esperadoTotal = null; r.falta = null; }
		(filas || []).forEach(function (f) {
			if (!cuentaEn(f, col, mapa)) return;
			var v = valorDe(mapa, col.id, f.alumno.id);
			r.total++;
			if (col.tipo === "monto") {
				var c = v ? (aCentavos(v.monto) || 0) : 0;
				r.reunido += c;
				if (c > 0) r.aportaron++;
				if (cuota) r.falta = (r.falta || 0) + Math.max(0, cuota - c);
			}
			if (cumple(col, v)) r.hechos++;
			else r.pendientes.push(f.alumno.id);
		});
		r.faltan = r.total - r.hechos;
		if (cuota) { r.esperadoTotal = cuota * r.total; if (r.falta === null) r.falta = 0; }
		return r;
	}

	/*
		resumenLista(lista, columnas, alumnos, mapa) → { filas, columnas: [resumenColumna],
		  avance: { hechos, total, porcentaje } }
		Avance general: casillas completas entre casillas que cuentan, en todas las columnas. El
		porcentaje se trunca (99.6 % es 99 %, no 100 %).
	*/
	function resumenLista(lista, columnas, alumnos, mapa) {
		var cols = ordenarColumnas(columnas);
		var filas = filasDeLista(lista, cols, alumnos, mapa);
		var res = cols.map(function (c) { return resumenColumna(c, filas, mapa); });
		var hechos = 0, total = 0;
		res.forEach(function (x) { hechos += x.hechos; total += x.total; });
		return { filas: filas, columnas: res, avance: { hechos: hechos, total: total, porcentaje: total ? Math.floor(hechos * 100 / total) : 0 } };
	}

	// ── Textos del resumen ────────────────────────────────────────────────────
	function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

	// Una línea por columna, SIN nombres: la pantalla, la imagen y el texto para las familias
	function lineaColumna(r) {
		if (r.tipo === "palomita") {
			if (!r.total) return "Sin alumnos en la lista";
			return "Entregaron " + r.hechos + " de " + r.total + (r.faltan ? "; faltan " + r.faltan : "");
		}
		if (r.tipo === "texto") {
			if (!r.total) return "Sin alumnos en la lista";
			return "Registrados " + r.hechos + " de " + r.total + (r.faltan ? "; faltan " + r.faltan : "");
		}
		if (r.cuota) {
			return "Reunido " + pesos(r.reunido) + " de " + pesos(r.esperadoTotal) + (r.falta ? "; faltan " + pesos(r.falta) : "");
		}
		return "Reunido " + pesos(r.reunido) + " (" + plural(r.aportaron, "aportación", "aportaciones") + ")";
	}
	// Detalle secundario: la cuota o cuántos completaron
	function detalleColumna(r) {
		if (r.tipo === "monto" && r.cuota) return "Cuota: " + pesos(r.cuota) + " por alumno. Completaron " + r.hechos + " de " + r.total + ".";
		return "";
	}

	/*
		textoFamilias(meta, resumen) → texto para WhatsApp SIN nombres de alumnos.
		meta = { nombre, grupo, escuela, fecha, descripcion }
	*/
	function textoFamilias(meta, resumen) {
		var cab = [meta.nombre || "Lista"];
		if (meta.grupo) cab.push("Grupo: " + meta.grupo);
		if (meta.escuela) cab.push(meta.escuela);
		if (meta.fecha) cab.push("Fecha: " + formatoFecha(meta.fecha));
		var partes = [cab.join("\n")];
		if (limpiar(meta.descripcion)) partes.push(limpiar(meta.descripcion));
		var cols = (resumen.columnas || []).map(function (r) {
			var d = detalleColumna(r);
			return r.columna.nombre + ": " + lineaColumna(r) + "." + (d ? " " + d : "");
		});
		partes.push(cols.length ? cols.join("\n") : "Esta lista todavía no tiene columnas.");
		partes.push("Gracias por su apoyo.");
		return partes.join("\n\n");
	}

	// ── Pendientes de un alumno y recordatorio ────────────────────────────────
	/*
		pendientesDe(resumen, alumnoId, mapa) → ["el material de arte", "$20 de la cooperación"]
		Solo lo que le falta (en las columnas donde cuenta).
	*/
	function pendientesDe(resumen, alumnoId, mapa) {
		var fila = (resumen.filas || []).filter(function (f) { return f.alumno.id === alumnoId; })[0];
		if (!fila) return [];
		var out = [];
		(resumen.columnas || []).forEach(function (r) {
			var col = r.columna;
			if (!cuentaEn(fila, col, mapa)) return;
			var v = valorDe(mapa, col.id, alumnoId);
			if (cumple(col, v)) return;
			if (col.tipo === "monto" && r.cuota) {
				var c = v ? (aCentavos(v.monto) || 0) : 0;
				out.push(pesos(r.cuota - c) + " de «" + col.nombre + "»" + (c > 0 ? " (ya aportó " + pesos(c) + ")" : ""));
			} else if (col.tipo === "monto") {
				out.push("la aportación de «" + col.nombre + "»");
			} else if (col.tipo === "texto") {
				out.push("el dato de «" + col.nombre + "»");
			} else {
				out.push("«" + col.nombre + "»");
			}
		});
		return out;
	}
	function unirLista(items) {
		if (items.length <= 1) return items.join("");
		return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}
	// Mensaje amable para la familia (se edita antes de abrir WhatsApp)
	function mensajeRecordatorio(docente, alumno, lista, pendientes) {
		var d = limpiar(docente), a = limpiar(alumno);
		return "Hola, buen día." + (d ? " Le escribe " + d + "," : " Le escribo como") + " docente de " + (a || "su hija o hijo") + ". " +
			"Le comparto un recordatorio de «" + limpiar(lista) + "»: " + (pendientes.length ? "está pendiente " + unirLista(pendientes) + "." : "queda algo pendiente.") +
			" Si ya lo envió o necesita más tiempo, con toda confianza dígame. Muchas gracias.";
	}

	// ── Historial por alumno ──────────────────────────────────────────────────
	/*
		estadoEnLista(resumen, alumnoId, mapa) → "completo" | "parcial" | "sin_registro" | null
		Solo con las columnas de palomita y monto (el texto no es algo que se "cumpla"). null si
		el alumno no cuenta en la lista o la lista no tiene esas columnas.
	*/
	function estadoEnLista(resumen, alumnoId, mapa) {
		var fila = (resumen.filas || []).filter(function (f) { return f.alumno.id === alumnoId; })[0];
		if (!fila) return null;
		var medibles = (resumen.columnas || []).filter(function (r) { return r.tipo !== "texto" && cuentaEn(fila, r.columna, mapa); });
		if (!medibles.length) return null;
		var hechos = 0, algo = false;
		medibles.forEach(function (r) {
			var v = valorDe(mapa, r.columna.id, alumnoId);
			if (cumple(r.columna, v)) hechos++;
			if (participa(r.columna, v)) algo = true;
		});
		if (hechos === medibles.length) return "completo";
		return algo ? "parcial" : "sin_registro";
	}
	var ESTADOS = { completo: "Completo", parcial: "Parcial", sin_registro: "Sin registro" };

	/*
		historialAlumno(alumnoId, listas) → { completo, parcial, sin_registro, total, detalle, texto }
		listas: [{ lista, resumen, mapa }] (solo las CERRADAS: una abierta todavía se está juntando)
		texto: "Cumplió en 5 de 6 listas cerradas" (+ "; parcial en 1")
	*/
	function historialAlumno(alumnoId, listas) {
		var h = { completo: 0, parcial: 0, sin_registro: 0, total: 0, detalle: [], texto: "" };
		(listas || []).forEach(function (x) {
			if (!x.lista || x.lista.estado !== "cerrada") return;
			var e = estadoEnLista(x.resumen, alumnoId, x.mapa);
			if (!e) return;
			h[e]++;
			h.total++;
			h.detalle.push({ lista: x.lista, estado: e });
		});
		h.detalle.sort(function (a, b) { return String(b.lista.fecha).localeCompare(String(a.lista.fecha)); });
		if (!h.total) h.texto = "Sin listas cerradas donde cuente";
		else h.texto = "Cumplió en " + h.completo + " de " + h.total + (h.total === 1 ? " lista cerrada" : " listas cerradas") + (h.parcial ? "; parcial en " + h.parcial : "");
		return h;
	}

	// ── Validación ────────────────────────────────────────────────────────────
	function validarLista(v, hoy) {
		v = v || {};
		var nombre = limpiar(v.nombre);
		if (!nombre) return "Escribe el nombre de la lista.";
		if (nombre.length > LARGO.nombre) return "El nombre es muy largo (máximo " + LARGO.nombre + " caracteres).";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.fecha || "")) || v.fecha < "2020-01-01" || v.fecha >= "2100-01-01") return "Elige la fecha de la lista.";
		if (String(v.descripcion || "").trim().length > LARGO.descripcion) return "La descripción es muy larga (máximo " + LARGO.descripcion + " caracteres).";
		return "";
	}
	function validarColumna(v, nColumnas) {
		v = v || {};
		var nombre = limpiar(v.nombre);
		if (!nombre) return "Escribe el nombre de la columna.";
		if (nombre.length > LARGO.columna) return "El nombre de la columna es muy largo (máximo " + LARGO.columna + " caracteres).";
		if (!TIPOS[v.tipo]) return "Elige el tipo de columna.";
		if (typeof nColumnas === "number" && nColumnas >= MAX_COLUMNAS) return "Una lista puede tener hasta " + MAX_COLUMNAS + " columnas.";
		if (v.tipo === "monto" && v.esperado !== undefined) {
			var p = parsearMonto(v.esperado);
			if (!p.ok) return "Cantidad esperada: " + p.error.charAt(0).toLowerCase() + p.error.slice(1);
		}
		return "";
	}

	// ── Imagen para las familias (Canvas; SIN nombres) ─────────────────────────
	var IMG = {
		ancho: 1080, margen: 64, altoMax: 2400,
		fuente: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
		azul: "#1e3a8a", azulClaro: "#dbeafe", tinta: "#1c2434", gris: "#6b7280", grisClaro: "#e5e7eb", verde: "#059669", ambar: "#d97706", tarjeta: "#f3f6fc",
	};
	function fuenteImg(tam, peso) { return (peso || 400) + " " + tam + "px " + IMG.fuente; }
	function opTexto(t, x, y, tam, peso, color, alinear) {
		return { t: "texto", texto: t, x: x, y: y, fuente: fuenteImg(tam, peso), color: color, alinear: alinear || "left" };
	}
	function mover(ops, dy) {
		return ops.map(function (o) { var c = {}; for (var k in o) c[k] = o[k]; c.y = o.y + dy; return c; });
	}
	function lineas(ctx, texto, ancho, tam, peso) {
		ctx.font = fuenteImg(tam, peso);
		return R.renglones(ctx, texto, ancho);
	}
	function barra(x, y, w, h, fraccion, color) {
		var f = Math.max(0, Math.min(1, fraccion || 0));
		var ops = [{ t: "rect", x: x, y: y, w: w, h: h, color: IMG.grisClaro, radio: h / 2 }];
		if (f > 0) ops.push({ t: "rect", x: x, y: y, w: Math.max(h, Math.round(w * f)), h: h, color: color, radio: h / 2 });
		return ops;
	}

	/*
		paginasImagen(ctx, datos, altoMax?) → [{ alto, ops }]
		datos = { nombre, grupo, escuela, fecha, descripcion, resumen } — el resumen trae los
		totales por columna; los nombres de los alumnos NO entran a ningún texto de la imagen.
	*/
	function paginasImagen(ctx, datos, altoMax) {
		var W = IMG.ancho, M = IMG.margen, AI = W - 2 * M;
		var tope = altoMax || IMG.altoMax;
		// Encabezado (en cada imagen)
		var titulo = lineas(ctx, datos.nombre || "Lista", AI, 56, 800);
		var subs = [];
		if (datos.grupo) subs = subs.concat(lineas(ctx, "Grupo: " + datos.grupo, AI, 34, 500));
		if (datos.escuela) subs = subs.concat(lineas(ctx, datos.escuela, AI, 34, 500));
		if (datos.fecha) subs = subs.concat(lineas(ctx, formatoFecha(datos.fecha), AI, 34, 500));
		var altoCab = 56 + 40 + 16 + titulo.length * 68 + (subs.length ? 18 : 0) + subs.length * 46 + 48;
		function cabecera(etiqueta) {
			var ops = [{ t: "rect", x: 0, y: 0, w: W, h: altoCab, color: IMG.azul }];
			var y = 56;
			ops.push(opTexto("LISTA DEL GRUPO", M, y + 30, 30, 700, "#bfdbfe"));
			if (etiqueta) ops.push(opTexto(etiqueta, W - M, y + 30, 30, 700, "#ffffff", "right"));
			y += 56;
			titulo.forEach(function (l) { ops.push(opTexto(l, M, y + 54, 56, 800, "#ffffff")); y += 68; });
			if (subs.length) y += 18;
			subs.forEach(function (l) { ops.push(opTexto(l, M, y + 34, 34, 500, IMG.azulClaro)); y += 46; });
			return ops;
		}

		// Bloques del cuerpo, cada uno armado desde y = 0
		var bloques = [];
		var desc = limpiar(datos.descripcion);
		if (desc) {
			var dl = lineas(ctx, desc, AI, 34, 400);
			bloques.push({ alto: dl.length * 46 + 12, ops: dl.map(function (l, i) { return opTexto(l, M, 36 + i * 46, 34, 400, IMG.tinta); }) });
		}
		var res = datos.resumen || { columnas: [], avance: { hechos: 0, total: 0, porcentaje: 0 } };
		if (res.columnas.length) {
			var av = res.avance;
			bloques.push({
				alto: 132,
				ops: [opTexto("Avance general", M, 40, 34, 700, IMG.tinta), opTexto(av.porcentaje + " %", W - M, 40, 40, 800, IMG.azul, "right")]
					.concat(barra(M, 70, AI, 26, av.total ? av.hechos / av.total : 0, IMG.azul)),
			});
		}
		res.columnas.forEach(function (r) {
			var pad = 32, AT = AI - 2 * pad;
			var nom = lineas(ctx, r.columna.nombre, AT, 40, 700);
			var lin = lineas(ctx, lineaColumna(r), AT, 36, 600);
			var det = detalleColumna(r) ? lineas(ctx, detalleColumna(r), AT, 30, 500) : [];
			var ops = [];
			var y = pad;
			nom.forEach(function (l) { ops.push(opTexto(l, M + pad, y + 40, 40, 700, IMG.azul)); y += 52; });
			y += 6;
			var completo = r.total > 0 && r.faltan === 0;
			lin.forEach(function (l) { ops.push(opTexto(l, M + pad, y + 36, 36, 600, completo ? IMG.verde : IMG.tinta)); y += 48; });
			det.forEach(function (l) { ops.push(opTexto(l, M + pad, y + 30, 30, 500, IMG.gris)); y += 42; });
			y += 14;
			var frac = r.tipo === "monto" && r.cuota ? (r.esperadoTotal ? Math.min(1, r.reunido / r.esperadoTotal) : 0) : (r.total ? r.hechos / r.total : 0);
			ops = ops.concat(barra(M + pad, y, AT, 20, frac, completo ? IMG.verde : IMG.ambar));
			y += 20 + pad;
			bloques.push({ alto: y, ops: [{ t: "rect", x: M, y: 0, w: AI, h: y, color: IMG.tarjeta, radio: 24 }].concat(ops) });
		});
		if (!res.columnas.length) bloques.push({ alto: 80, ops: [opTexto("Esta lista todavía no tiene columnas.", M, 44, 36, 500, IMG.gris)] });

		// Reparto en imágenes de altoMax como máximo
		var SEP = 24, PIE = 32 + 2 + 30 + 26 + M;
		var inicio = altoCab + 40;
		var disponible = Math.max(200, tope - inicio - PIE);
		var hojas = [[]], usado = 0;
		bloques.forEach(function (b) {
			if (hojas[hojas.length - 1].length && usado + SEP + b.alto > disponible) { hojas.push([]); usado = 0; }
			usado += (hojas[hojas.length - 1].length ? SEP : 0) + b.alto;
			hojas[hojas.length - 1].push(b);
		});
		var n = hojas.length;
		return hojas.map(function (bs, hi) {
			var ops = cabecera(n > 1 ? (hi + 1) + " de " + n : "");
			var y = inicio;
			bs.forEach(function (b, bi) {
				if (bi) y += SEP;
				ops = ops.concat(mover(b.ops, y));
				y += b.alto;
			});
			y += 32;
			ops.push({ t: "rect", x: M, y: y, w: AI, h: 2, color: IMG.grisClaro });
			y += 30;
			ops.push(opTexto("Hecho con Jissez Mi Salón", M, y + 26, 26, 500, IMG.gris));
			if (hi < n - 1) ops.push(opTexto("Sigue en la imagen " + (hi + 2) + " de " + n, W - M, y + 26, 26, 700, IMG.azul, "right"));
			y += 26 + M;
			return { alto: Math.ceil(y), ops: ops };
		});
	}

	function slug(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
			.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	}
	function nombreArchivo(lista, grupo, i, n) {
		return ["lista", slug(lista), slug(grupo)].filter(Boolean).join("-") + (n > 1 ? "-" + i + "-de-" + n : "") + ".png";
	}

	// ── HTML (pantalla e impresión) ───────────────────────────────────────────
	var ICONOS = {
		check: '<path d="M20 6 9 17l-5-5"/>',
		palomita: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
		texto: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
		monto: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
		mensaje: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
		editar: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
		candado: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
	};
	function icono(nombre, clase) {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='" + (clase || "h-4 w-4 shrink-0") + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + ICONOS[nombre] + "</svg>";
	}
	function nombreFila(a) { return (typeof a.num_lista === "number" ? a.num_lista + ". " : "") + (a.nombre_completo || "Alumno sin nombre"); }

	/*
		htmlImpresion(meta, resumen, mapa) → hoja "Solo para la maestra" (con nombres): encabezado,
		resumen por columna y la tabla de alumnos. Todo escapado.
	*/
	function htmlImpresion(meta, resumen, mapa) {
		var cols = resumen.columnas;
		var cab = "<tr><th scope='col'>Alumno</th>" + cols.map(function (r) {
			var c = r.columna;
			return "<th scope='col'>" + esc(c.nombre) + (c.tipo === "monto" && r.cuota ? "<span class='imp-cuota'>Cuota " + esc(pesos(r.cuota)) + "</span>" : "") + "</th>";
		}).join("") + "</tr>";
		var cuerpo = resumen.filas.map(function (f) {
			return "<tr><th scope='row'>" + esc(nombreFila(f.alumno)) + (f.baja ? " <span class='imp-baja'>(baja)</span>" : "") + "</th>" + cols.map(function (r) {
				var c = r.columna, v = valorDe(mapa, c.id, f.alumno.id);
				if (!cuentaEn(f, c, mapa)) return "<td class='imp-na'>No aplica</td>";
				var pend = !cumple(c, v);
				var txt;
				if (c.tipo === "palomita") txt = v && v.entregado ? "Sí" : "Pendiente";
				else if (c.tipo === "texto") txt = v && limpiar(v.texto) ? limpiar(v.texto) : "Pendiente";
				else txt = v && aCentavos(v.monto) ? pesos(aCentavos(v.monto)) : (r.cuota ? "Pendiente" : "$0");
				return "<td class='" + (pend ? "imp-pend" : "") + "'>" + esc(txt) + "</td>";
			}).join("") + "</tr>";
		}).join("");
		return "<div class='imp-hoja" + (cols.length > 4 ? " imp-ancha" : "") + "'>" +
			"<p class='imp-solo'>Solo para la maestra · Uso interno. No se comparte con las familias.</p>" +
			"<p class='imp-etq'>Lista del grupo</p><h1 class='imp-titulo'>" + esc(meta.nombre) + "</h1>" +
			"<p class='imp-sub'>" + esc([meta.grupo ? "Grupo: " + meta.grupo : "", meta.escuela, formatoFecha(meta.fecha), meta.estado === "cerrada" ? "Cerrada" : ""].filter(Boolean).join(" · ")) + "</p>" +
			(limpiar(meta.descripcion) ? "<p class='imp-desc'>" + esc(limpiar(meta.descripcion)) + "</p>" : "") +
			"<ul class='imp-resumen'>" + cols.map(function (r) {
				return "<li><strong>" + esc(r.columna.nombre) + ":</strong> " + esc(lineaColumna(r)) + "</li>";
			}).join("") + (cols.length ? "<li><strong>Avance general:</strong> " + resumen.avance.porcentaje + " %</li>" : "") + "</ul>" +
			(cols.length ? "<table class='imp-tabla'><thead>" + cab + "</thead><tbody>" + cuerpo + "</tbody></table>" : "<p>Esta lista todavía no tiene columnas.</p>") +
			"<p class='imp-pie'>Hecho con Jissez Mi Salón.</p></div>";
	}

	var api = {
		LARGO: LARGO, MAX_COLUMNAS: MAX_COLUMNAS, TIPOS: TIPOS, ESTADOS: ESTADOS, IMG: IMG,
		esc: esc, formatoFecha: formatoFecha,
		aCentavos: aCentavos, parsearMonto: parsearMonto, pesos: pesos, montoEditable: montoEditable,
		ordenarAlumnos: ordenarAlumnos, ordenarColumnas: ordenarColumnas, mapaValores: mapaValores, valorDe: valorDe,
		participa: participa, cumple: cumple, esperadoCent: esperadoCent, activosDeLista: activosDeLista,
		filasDeLista: filasDeLista, cuentaEn: cuentaEn, resumenColumna: resumenColumna, resumenLista: resumenLista,
		lineaColumna: lineaColumna, detalleColumna: detalleColumna, textoFamilias: textoFamilias,
		pendientesDe: pendientesDe, mensajeRecordatorio: mensajeRecordatorio,
		estadoEnLista: estadoEnLista, historialAlumno: historialAlumno,
		validarLista: validarLista, validarColumna: validarColumna,
		paginasImagen: paginasImagen, nombreArchivo: nombreArchivo, htmlImpresion: htmlImpresion, nombreFila: nombreFila,
	};
	if (typeof window !== "undefined") window.Listas = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node

	if (typeof document === "undefined" || !document.addEventListener) return;

	// ═════════════════════════════════════════════════════════════════════════
	// Página listas.html
	// ═════════════════════════════════════════════════════════════════════════
	document.addEventListener("DOMContentLoaded", function () {
		if (!document.getElementById("listasPantalla")) return; // otra página que solo usa la parte pura
		if (!window.sb) { window.location.href = "index.html"; return; }
		var F = window.FichaAlumno;

		var $ = function (id) { return document.getElementById(id); };
		var el = {
			subtitulo: $("lsSubtitulo"), mensaje: $("lsMensaje"),
			indice: $("lsIndice"), tabs: Array.prototype.slice.call(document.querySelectorAll("[data-ls-tab]")),
			paneles: { abiertas: $("lsPanelAbiertas"), historial: $("lsPanelHistorial"), alumnos: $("lsPanelAlumnos") },
			abiertas: $("lsAbiertas"), historial: $("lsHistorial"), alumnos: $("lsAlumnos"), nueva: $("lsNueva"),
			detalle: $("lsDetalle"), volver: $("lsVolver"), cabeza: $("lsCabeza"), acciones: $("lsAcciones"),
			resumen: $("lsResumen"), tabla: $("lsTabla"), estadoTabla: $("lsEstadoTabla"), salida: $("lsSalida"),
			imagen: $("lsImagen"), compartir: $("lsCompartir"), copiar: $("lsCopiar"), imprimir: $("lsImprimir"), estadoSalida: $("lsEstadoSalida"),
			dlgLista: $("dlgLista"), dlgColumna: $("dlgColumna"), dlgConfirmar: $("dlgConfirmar"), dlgRecordar: $("dlgRecordar"), dlgAlumno: $("dlgAlumno"),
			impresion: $("zonaImpresion"),
		};

		var userId = null, grupo = null, escuela = "", docente = "";
		var alumnos = [], porId = {};
		var listas = [];                 // filas de listas_grupo (con listas_columnas)
		var valores = {};                // lista_id → [filas de listas_valores]
		var pestana = "abiertas", listaId = null;
		var pendientes = 0;

		// ── Utilidades ────────────────────────────────────────────────────────
		function mensaje(tipo, texto) {
			if (!texto) { el.mensaje.className = "hidden"; el.mensaje.textContent = ""; return; }
			el.mensaje.className = "rounded-xl px-4 py-3 text-sm border " +
				(tipo === "error" ? "bg-red-50 text-red-800 border-red-200" : (tipo === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-blue-50 text-blue-800 border-blue-200"));
			el.mensaje.textContent = texto;
		}
		function motivo(e) {
			var sinRed = window.Lectura && window.Lectura.errorDeRed ? window.Lectura.errorDeRed(e) : false;
			if (sinRed) return "No hay conexión. Revisa tu internet e intenta de nuevo.";
			if (e && /cerrada/i.test(String(e.message || ""))) return "La lista está cerrada.";
			return "Intenta de nuevo en un momento.";
		}
		function hoyISO() {
			var a = new Date();
			return new Date(a.getTime() - a.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
		}
		async function escribir(fn) {
			pendientes++;
			try { return await fn(); } finally { pendientes--; }
		}
		window.Lectura.antesDeSalir({
			pendiente: function () { return pendientes > 0; },
			guardar: function () {
				return new Promise(function (r) { (function esperar() { if (!pendientes) r(true); else setTimeout(esperar, 100); })(); });
			},
		});
		function listaPorId(id) { return listas.filter(function (l) { return l.id === id; })[0] || null; }
		function columnasDe(l) { return ordenarColumnas(l && l.listas_columnas); }
		function mapaDe(l) { return mapaValores(valores[l.id] || []); }
		function resumenDe(l) { return resumenLista(l, columnasDe(l), alumnos, mapaDe(l)); }

		// Diálogo de confirmación → Promise<boolean>
		function confirmar(titulo, texto, boton, peligro) {
			return new Promise(function (resolver) {
				var d = el.dlgConfirmar;
				d.querySelector("[data-titulo]").textContent = titulo;
				d.querySelector("[data-texto]").textContent = texto;
				var ok = d.querySelector("[data-ok]");
				ok.textContent = boton || "Confirmar";
				ok.className = "min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white " + (peligro ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800");
				function cerrar(v) {
					d.removeEventListener("close", alCerrar);
					ok.removeEventListener("click", alOk);
					if (d.open) d.close();
					resolver(v);
				}
				function alOk() { cerrar(true); }
				function alCerrar() { cerrar(false); }
				ok.addEventListener("click", alOk);
				d.addEventListener("close", alCerrar);
				d.showModal();
				ok.focus();
			});
		}
		Array.prototype.forEach.call(document.querySelectorAll("dialog [data-cerrar]"), function (b) {
			b.addEventListener("click", function () { var d = b.closest("dialog"); if (d && d.open) d.close(); });
		});
		Array.prototype.forEach.call(document.querySelectorAll("dialog"), function (d) {
			d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
		});

		// ── Navegación interna: pestañas del índice y detalle de una lista ────
		function ponerHash() {
			var h = listaId ? "#lista=" + listaId : (pestana === "abiertas" ? "" : "#" + pestana);
			try { window.history.replaceState(null, "", h || window.location.pathname + window.location.search); } catch (_) {}
		}
		function elegirPestana(cual, foco) {
			pestana = ["abiertas", "historial", "alumnos"].indexOf(cual) !== -1 ? cual : "abiertas";
			el.tabs.forEach(function (t) {
				var si = t.getAttribute("data-ls-tab") === pestana;
				t.setAttribute("aria-selected", si ? "true" : "false");
				t.tabIndex = si ? 0 : -1;
				t.className = "min-h-[44px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors " +
					(si ? "bg-white text-blue-800 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-white/60");
				if (si && foco) t.focus();
			});
			Object.keys(el.paneles).forEach(function (k) { el.paneles[k].hidden = k !== pestana; });
		}
		el.tabs.forEach(function (t, i) {
			t.addEventListener("click", function () { elegirPestana(t.getAttribute("data-ls-tab")); ponerHash(); });
			t.addEventListener("keydown", function (e) {
				if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
				e.preventDefault();
				var j = (i + (e.key === "ArrowRight" ? 1 : el.tabs.length - 1)) % el.tabs.length;
				elegirPestana(el.tabs[j].getAttribute("data-ls-tab"), true);
				ponerHash();
			});
		});
		function mostrarIndice() {
			listaId = null;
			el.detalle.hidden = true;
			el.indice.hidden = false;
			pintarIndice();
			ponerHash();
		}
		function abrirLista(id, foco) {
			var l = listaPorId(id);
			if (!l) { mostrarIndice(); return; }
			listaId = id;
			el.indice.hidden = true;
			el.detalle.hidden = false;
			el.estadoSalida.textContent = "";
			pintarDetalle();
			ponerHash();
			window.scrollTo(0, 0);
			if (foco !== false) el.volver.focus();
		}
		el.volver.addEventListener("click", function () { mostrarIndice(); mensaje(null); });

		// ── Índice ────────────────────────────────────────────────────────────
		function tarjetaLista(l) {
			var res = resumenDe(l);
			var cerrada = l.estado === "cerrada";
			var cols = res.columnas;
			var lineas = cols.slice(0, 3).map(function (r) {
				return "<li class='truncate'><span class='font-medium text-gray-800'>" + esc(r.columna.nombre) + ":</span> " + esc(lineaColumna(r)) + "</li>";
			}).join("") + (cols.length > 3 ? "<li class='text-gray-500'>y " + plural(cols.length - 3, "columna más", "columnas más") + "</li>" : "");
			return "<li><button type='button' data-abrir='" + esc(l.id) + "' class='w-full h-full text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 min-h-[44px]'>" +
				"<div class='flex items-start justify-between gap-3'><div class='min-w-0'>" +
				"<p class='text-xs font-medium text-gray-500'>" + esc(formatoFecha(l.fecha)) + "</p>" +
				"<h3 class='mt-0.5 font-semibold text-gray-900 break-words'>" + esc(l.nombre) + "</h3></div>" +
				(cerrada ? "<span class='shrink-0 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700'>" + icono("candado", "h-3.5 w-3.5") + "Cerrada</span>"
					: "<span class='shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800'>" + res.avance.porcentaje + " %</span>") +
				"</div>" +
				(cols.length ? "<ul class='mt-2 text-sm text-gray-600 flex flex-col gap-0.5 min-w-0'>" + lineas + "</ul>" : "<p class='mt-2 text-sm text-gray-500'>Sin columnas todavía.</p>") +
				"</button></li>";
		}
		function pintarIndice() {
			var abiertas = listas.filter(function (l) { return l.estado !== "cerrada"; });
			var cerradas = listas.filter(function (l) { return l.estado === "cerrada"; });
			el.abiertas.innerHTML = abiertas.length ? abiertas.map(tarjetaLista).join("")
				: "<li class='sm:col-span-2 lg:col-span-3 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>No tienes listas abiertas. Crea una con «Nueva lista», por ejemplo «Cooperación del festival» o «Material de arte».</li>";
			el.historial.innerHTML = cerradas.length ? cerradas.map(tarjetaLista).join("")
				: "<li class='sm:col-span-2 lg:col-span-3 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Todavía no hay listas cerradas. Cuando termines de juntar una, ciérrala: queda aquí como expediente, de solo lectura.</li>";
			el.tabs.forEach(function (t) {
				var k = t.getAttribute("data-ls-tab");
				var n = k === "abiertas" ? abiertas.length : (k === "historial" ? cerradas.length : null);
				var etq = t.getAttribute("data-etq");
				t.textContent = n === null ? etq : etq + " (" + n + ")";
			});
			pintarAlumnos();
		}

		// Por alumno: en cuántas listas cerradas cumplió (solo referencia para la maestra)
		function historiales() {
			return listas.filter(function (l) { return l.estado === "cerrada"; }).map(function (l) {
				return { lista: l, resumen: resumenDe(l), mapa: mapaDe(l) };
			});
		}
		function pintarAlumnos() {
			var hs = historiales();
			if (!hs.length) {
				el.alumnos.innerHTML = "<p class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Todavía no hay listas cerradas. Al cerrar una lista, aquí verás en cuántas cumplió cada alumno.</p>";
				return;
			}
			var visibles = ordenarAlumnos(alumnos).filter(function (a) {
				return a.estatus === "activo" || hs.some(function (x) { return estadoEnLista(x.resumen, a.id, x.mapa); });
			});
			el.alumnos.innerHTML = "<ul class='divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white'>" + visibles.map(function (a) {
				var h = historialAlumno(a.id, hs);
				return "<li><button type='button' data-alumno='" + esc(a.id) + "' class='w-full min-h-[44px] flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3 text-left hover:bg-gray-50'>" +
					"<span class='flex-1 min-w-0 font-medium text-gray-900 break-words'>" + esc(nombreFila(a)) + (a.estatus !== "activo" ? " <span class='text-gray-500 font-normal'>(baja)</span>" : "") + "</span>" +
					"<span class='text-sm text-gray-600'>" + esc(h.texto) + "</span></button></li>";
			}).join("") + "</ul>";
		}
		function abrirAlumno(id) {
			var a = porId[id];
			if (!a) return;
			var h = historialAlumno(id, historiales());
			var cuerpo = el.dlgAlumno.querySelector("[data-cuerpo]");
			el.dlgAlumno.querySelector("[data-titulo]").textContent = a.nombre_completo || "Alumno";
			cuerpo.innerHTML = "<p class='text-sm text-gray-700'>" + esc(h.texto) + ".</p>" +
				(h.detalle.length ? "<ul class='mt-3 divide-y divide-gray-100'>" + h.detalle.map(function (d) {
					var color = d.estado === "completo" ? "bg-emerald-50 text-emerald-800" : (d.estado === "parcial" ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-700");
					return "<li class='flex items-center justify-between gap-3 py-2'><span class='min-w-0 text-sm text-gray-800 break-words'>" + esc(d.lista.nombre) +
						" <span class='text-gray-500'>(" + esc(formatoFecha(d.lista.fecha)) + ")</span></span>" +
						"<span class='shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold " + color + "'>" + esc(ESTADOS[d.estado]) + "</span></li>";
				}).join("") + "</ul>" : "") +
				"<p class='mt-3 text-xs text-gray-500'>Solo para ti, como referencia para organizar futuras actividades. Cuentan las listas cerradas con palomitas o montos. No se imprime ni se comparte.</p>";
			el.dlgAlumno.showModal();
		}
		el.alumnos.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-alumno]") : null;
			if (b) abrirAlumno(b.getAttribute("data-alumno"));
		});
		[el.abiertas, el.historial].forEach(function (ul) {
			ul.addEventListener("click", function (e) {
				var b = e.target.closest ? e.target.closest("button[data-abrir]") : null;
				if (b) { mensaje(null); abrirLista(b.getAttribute("data-abrir")); }
			});
		});

		// ── Detalle de una lista ──────────────────────────────────────────────
		function pintarDetalle() {
			var l = listaPorId(listaId);
			if (!l) { mostrarIndice(); return; }
			var cerrada = l.estado === "cerrada";
			var cols = columnasDe(l);
			el.cabeza.innerHTML = "<div class='flex flex-wrap items-center gap-2'>" +
				"<p class='text-xs font-medium text-gray-500'>" + esc(formatoFecha(l.fecha)) + "</p>" +
				(cerrada ? "<span class='inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700'>" + icono("candado", "h-3.5 w-3.5") + "Cerrada · solo lectura</span>"
					: "<span class='rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800'>Abierta</span>") + "</div>" +
				"<h2 class='mt-1 text-xl font-bold text-gray-900 break-words'>" + esc(l.nombre) + "</h2>" +
				(limpiar(l.descripcion) ? "<p class='mt-1 text-sm text-gray-700 break-words'>" + esc(l.descripcion) + "</p>" : "");
			var b = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors";
			el.acciones.innerHTML = cerrada
				? "<button type='button' data-accion='reabrir' class='" + b + " border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'>Reabrir lista</button>"
				: "<button type='button' data-accion='columna' class='" + b + " bg-blue-700 text-white hover:bg-blue-800'" + (cols.length >= MAX_COLUMNAS ? " disabled" : "") + ">Agregar columna</button>" +
					"<button type='button' data-accion='editar' class='" + b + " border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'>" + icono("editar") + "Editar datos</button>" +
					"<button type='button' data-accion='cerrar' class='" + b + " border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'>" + icono("candado") + "Cerrar lista</button>" +
					"<button type='button' data-accion='eliminar' class='" + b + " bg-red-50 text-red-700 hover:bg-red-100'>Eliminar lista</button>";
			pintarResumen();
			pintarTabla();
			el.salida.hidden = !cols.length;
		}

		function pintarResumen() {
			var l = listaPorId(listaId);
			if (!l) return;
			var res = resumenDe(l);
			if (!res.columnas.length) {
				el.resumen.innerHTML = "<p class='text-sm text-gray-600'>" + (l.estado === "cerrada" ? "Esta lista no tiene columnas." : "Agrega la primera columna: por ejemplo «Entregó material» (palomita), «Talla» (texto) o «Cooperación» (monto en pesos).") + "</p>";
				return;
			}
			var av = res.avance;
			el.resumen.innerHTML = "<div class='rounded-2xl bg-blue-50 border border-blue-100 p-4'>" +
				"<div class='flex items-baseline justify-between gap-2'><p class='font-semibold text-blue-900'>Avance general</p><p class='text-2xl font-extrabold text-blue-800'>" + av.porcentaje + " %</p></div>" +
				"<div class='mt-2 h-2.5 rounded-full bg-white overflow-hidden' aria-hidden='true'><div class='h-full rounded-full bg-blue-700' style='width:" + (av.total ? Math.floor(av.hechos * 100 / av.total) : 0) + "%'></div></div>" +
				"<p class='mt-1 text-xs text-blue-900'>" + av.hechos + " de " + av.total + " casillas completas</p></div>" +
				res.columnas.map(function (r) {
					var completo = r.total > 0 && r.faltan === 0;
					var d = detalleColumna(r);
					return "<div class='rounded-2xl border p-4 " + (completo ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50") + "'>" +
						"<p class='flex items-center gap-2 font-semibold text-gray-900 break-words'>" + icono(r.tipo) + "<span class='min-w-0'>" + esc(r.columna.nombre) + "</span></p>" +
						"<p class='mt-1 text-sm font-medium " + (completo ? "text-emerald-800" : "text-amber-900") + "'>" + esc(lineaColumna(r)) + "</p>" +
						(d ? "<p class='mt-0.5 text-xs text-gray-600'>" + esc(d) + "</p>" : "") + "</div>";
				}).join("");
		}

		function tieneTelefono(a) { return !!(a && a.tutor_telefono && F && F.enlaceWhatsApp(a.tutor_telefono)); }

		function celdaHTML(l, r, fila, mapa) {
			var c = r.columna, a = fila.alumno, v = valorDe(mapa, c.id, a.id);
			var cerrada = l.estado === "cerrada";
			if (!cuentaEn(fila, c, mapa)) return "<td class='px-2 py-1.5 border-b border-gray-100 text-xs text-gray-400'>No aplica</td>";
			var pend = !cumple(c, v);
			var fondo = pend ? " bg-amber-50" : "";
			var etq = esc(c.nombre + ", " + (a.nombre_completo || "alumno"));
			var datos = " data-col='" + esc(c.id) + "' data-al='" + esc(a.id) + "'";
			var dentro;
			if (c.tipo === "palomita") {
				var si = !!(v && v.entregado);
				dentro = cerrada
					? "<span class='inline-flex items-center gap-1 text-sm " + (si ? "text-emerald-700 font-semibold" : "text-amber-900") + "'>" + (si ? icono("check") + "Sí" : "Pendiente") + "</span>"
					: "<button type='button'" + datos + " data-tipo='palomita' aria-pressed='" + si + "' aria-label='" + etq + "' class='inline-flex items-center justify-center h-11 w-11 rounded-lg border-2 transition-colors " +
						(si ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-amber-400 text-transparent hover:bg-amber-100") + "'>" + icono("check", "h-6 w-6") + "</button>";
			} else if (c.tipo === "texto") {
				var t = v && v.texto ? v.texto : "";
				dentro = cerrada ? "<span class='text-sm " + (t ? "text-gray-900" : "text-amber-900") + " break-words'>" + esc(t || "Pendiente") + "</span>"
					: "<input type='text'" + datos + " data-tipo='texto' maxlength='" + LARGO.texto + "' autocomplete='off' value='" + esc(t) + "' aria-label='" + etq + "' class='min-h-[44px] w-32 sm:w-40 rounded-lg border border-gray-300 bg-white px-2 text-sm'>";
			} else {
				var cent = v ? aCentavos(v.monto) : null;
				dentro = cerrada ? "<span class='text-sm tabular-nums " + (pend ? "text-amber-900" : "text-gray-900") + "'>" + esc(cent ? pesos(cent) : (r.cuota ? "Pendiente" : "$0")) + "</span>"
					: "<div class='flex items-center gap-1'><span class='text-sm text-gray-500' aria-hidden='true'>$</span><input type='text' inputmode='decimal'" + datos + " data-tipo='monto' maxlength='12' autocomplete='off' value='" + esc(cent ? montoEditable(cent) : "") + "' placeholder='0' aria-label='" + etq + " (pesos)' class='min-h-[44px] w-24 rounded-lg border border-gray-300 bg-white px-2 text-sm text-right tabular-nums'></div>";
			}
			return "<td class='px-2 py-1.5 border-b border-gray-100 align-middle" + fondo + "' data-celda='" + esc(c.id) + ":" + esc(a.id) + "'>" + dentro + "</td>";
		}
		function celdaRecordar(l, res, fila, mapa) {
			if (l.estado === "cerrada") return "";
			var pend = pendientesDe(res, fila.alumno.id, mapa);
			var dentro = pend.length && tieneTelefono(fila.alumno)
				? "<button type='button' data-recordar='" + esc(fila.alumno.id) + "' class='inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-emerald-600 text-emerald-700 text-sm font-semibold hover:bg-emerald-50 whitespace-nowrap' aria-label='Recordar por WhatsApp a la familia de " + esc(fila.alumno.nombre_completo || "este alumno") + "'>" + icono("mensaje") + "Recordar</button>"
				: (pend.length ? "<span class='text-xs text-gray-400'>Sin teléfono</span>" : "");
			return "<td class='px-2 py-1.5 border-b border-gray-100' data-recordar-celda='" + esc(fila.alumno.id) + "'>" + dentro + "</td>";
		}

		function pintarTabla() {
			var l = listaPorId(listaId);
			var cols = columnasDe(l);
			if (!cols.length) { el.tabla.innerHTML = ""; el.estadoTabla.textContent = ""; return; }
			var mapa = mapaDe(l);
			var res = resumenLista(l, cols, alumnos, mapa);
			var cerrada = l.estado === "cerrada";
			if (!res.filas.length) {
				el.tabla.innerHTML = "<p class='text-sm text-gray-500 py-2'>Este grupo no tiene alumnos activos. Agrégalos en <a href='mi-grupo.html' class='underline font-medium text-blue-800'>Mi grupo</a>.</p>";
				return;
			}
			var cab = "<tr><th scope='col' class='sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b border-gray-200'>Alumno</th>" +
				res.columnas.map(function (r) {
					var c = r.columna;
					return "<th scope='col' class='bg-gray-50 px-2 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200 align-bottom min-w-[7rem]'>" +
						"<span class='flex items-center gap-1.5'>" + icono(c.tipo, "h-3.5 w-3.5 shrink-0 text-gray-500") + "<span class='break-words'>" + esc(c.nombre) + "</span></span>" +
						(r.cuota ? "<span class='block font-normal text-gray-500'>Cuota " + esc(pesos(r.cuota)) + "</span>" : "") +
						(cerrada ? "" : "<button type='button' data-editar-col='" + esc(c.id) + "' class='mt-1 inline-flex items-center gap-1 min-h-[44px] px-2 rounded-lg text-xs font-medium text-blue-800 hover:bg-blue-50' aria-label='Editar la columna " + esc(c.nombre) + "'>" + icono("editar", "h-3.5 w-3.5") + "Editar</button>") +
						"</th>";
				}).join("") +
				(cerrada ? "" : "<th scope='col' class='bg-gray-50 px-2 py-2 text-left text-xs font-semibold text-gray-600 border-b border-gray-200'>Avisar</th>") + "</tr>";
			var cuerpo = res.filas.map(function (f) {
				return "<tr data-fila='" + esc(f.alumno.id) + "'><th scope='row' class='sticky left-0 z-10 bg-white px-3 py-1.5 text-left border-b border-gray-100 font-normal'>" +
					"<button type='button' data-alumno='" + esc(f.alumno.id) + "' class='min-h-[44px] min-w-[8rem] max-w-[11rem] sm:max-w-[16rem] text-left text-sm font-medium text-gray-900 hover:text-blue-800 break-words'>" + esc(nombreFila(f.alumno)) +
					(f.baja ? " <span class='text-xs font-normal text-gray-500'>(baja)</span>" : "") + "</button></th>" +
					res.columnas.map(function (r) { return celdaHTML(l, r, f, mapa); }).join("") +
					celdaRecordar(l, res, f, mapa) + "</tr>";
			}).join("");
			el.tabla.innerHTML = "<div class='overflow-x-auto rounded-xl border border-gray-200'><table class='min-w-full border-separate border-spacing-0'><thead>" + cab + "</thead><tbody>" + cuerpo + "</tbody></table></div>";
			el.estadoTabla.textContent = cerrada ? "Lista cerrada: es de solo lectura. Para cambiar algo, reábrela." : "Toca la casilla para marcar. Los textos y montos se guardan al salir del campo. Lo pendiente se ve en amarillo.";
		}

		// Tras guardar un valor: la celda, la columna "Avisar" de esa fila y el resumen (sin repintar la tabla: el foco sigue donde está)
		function refrescarCelda(colId, alId) {
			var l = listaPorId(listaId);
			if (!l) return;
			var mapa = mapaDe(l);
			var res = resumenLista(l, columnasDe(l), alumnos, mapa);
			var fila = res.filas.filter(function (f) { return f.alumno.id === alId; })[0];
			var r = res.columnas.filter(function (x) { return x.columna.id === colId; })[0];
			var td = el.tabla.querySelector("td[data-celda='" + colId + ":" + alId + "']");
			if (td && fila && r) {
				var pend = !cumple(r.columna, valorDe(mapa, colId, alId));
				td.classList.toggle("bg-amber-50", pend);
				var boton = td.querySelector("button[data-tipo='palomita']");
				if (boton) {
					var si = !!(valorDe(mapa, colId, alId) || {}).entregado;
					boton.setAttribute("aria-pressed", si ? "true" : "false");
					boton.className = "inline-flex items-center justify-center h-11 w-11 rounded-lg border-2 transition-colors " +
						(si ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-amber-400 text-transparent hover:bg-amber-100");
				}
			}
			var tdr = el.tabla.querySelector("td[data-recordar-celda='" + alId + "']");
			if (tdr && fila) { var tmp = document.createElement("tr"); tmp.innerHTML = celdaRecordar(l, res, fila, mapa); if (tmp.firstChild) tdr.innerHTML = tmp.firstChild.innerHTML; }
			pintarResumen();
		}

		// Guardar un valor: vacío → se borra la fila (sin registro); si no, upsert por columna y alumno
		async function guardarValor(l, col, alId, campos) {
			var vacio = campos === null;
			var anteriores = (valores[l.id] || []).slice();
			var sin = anteriores.filter(function (v) { return !(v.columna_id === col.id && v.alumno_id === alId); });
			valores[l.id] = vacio ? sin : sin.concat([Object.assign({ lista_id: l.id, columna_id: col.id, alumno_id: alId, entregado: null, texto: null, monto: null }, campos)]);
			refrescarCelda(col.id, alId);
			try {
				var res = await escribir(function () {
					if (vacio) {
						return window.sb.from("listas_valores").delete().eq("maestro_id", userId).eq("columna_id", col.id).eq("alumno_id", alId);
					}
					return window.sb.from("listas_valores").upsert(Object.assign({
						maestro_id: userId, lista_id: l.id, columna_id: col.id, alumno_id: alId, entregado: null, texto: null, monto: null,
					}, campos), { onConflict: "columna_id,alumno_id" }).select("id, lista_id, columna_id, alumno_id, entregado, texto, monto");
				});
				if (res.error) throw res.error;
				if (!vacio && res.data && res.data[0]) {
					valores[l.id] = (valores[l.id] || []).filter(function (v) { return !(v.columna_id === col.id && v.alumno_id === alId); }).concat([res.data[0]]);
				}
				return true;
			} catch (e) {
				console.error("listas: guardar valor", e);
				valores[l.id] = anteriores;
				pintarTabla();
				pintarResumen();
				mensaje("error", "No se pudo guardar lo de " + ((porId[alId] || {}).nombre_completo || "ese alumno") + " en «" + col.nombre + "». " + motivo(e) + " La tabla muestra lo que sí está guardado.");
				return false;
			}
		}

		el.tabla.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button") : null;
			if (!b) return;
			var l = listaPorId(listaId);
			if (!l) return;
			if (b.hasAttribute("data-alumno")) { abrirAlumno(b.getAttribute("data-alumno")); return; }
			if (b.hasAttribute("data-recordar")) { abrirRecordar(b.getAttribute("data-recordar")); return; }
			if (b.hasAttribute("data-editar-col")) { abrirColumna(b.getAttribute("data-editar-col")); return; }
			if (b.getAttribute("data-tipo") === "palomita" && l.estado !== "cerrada") {
				var col = columnasDe(l).filter(function (c) { return c.id === b.getAttribute("data-col"); })[0];
				if (!col) return;
				var alId = b.getAttribute("data-al");
				var ahora = !!(valorDe(mapaDe(l), col.id, alId) || {}).entregado;
				mensaje(null);
				guardarValor(l, col, alId, ahora ? null : { entregado: true });
			}
		});
		el.tabla.addEventListener("change", function (e) {
			var inp = e.target;
			if (!inp || !inp.getAttribute || !inp.getAttribute("data-tipo")) return;
			var l = listaPorId(listaId);
			if (!l || l.estado === "cerrada") return;
			var col = columnasDe(l).filter(function (c) { return c.id === inp.getAttribute("data-col"); })[0];
			if (!col) return;
			var alId = inp.getAttribute("data-al");
			mensaje(null);
			if (inp.getAttribute("data-tipo") === "texto") {
				var t = limpiar(inp.value).slice(0, LARGO.texto);
				inp.value = t;
				guardarValor(l, col, alId, t ? { texto: t } : null);
				return;
			}
			var p = parsearMonto(inp.value);
			if (!p.ok) {
				inp.classList.add("border-red-500", "ring-1", "ring-red-500");
				inp.setAttribute("aria-invalid", "true");
				mensaje("error", ((porId[alId] || {}).nombre_completo || "Alumno") + ", «" + col.nombre + "»: " + p.error + " No se guardó.");
				return;
			}
			inp.classList.remove("border-red-500", "ring-1", "ring-red-500");
			inp.removeAttribute("aria-invalid");
			inp.value = p.vacio ? "" : montoEditable(p.centavos);
			guardarValor(l, col, alId, p.vacio || !p.centavos ? null : { monto: p.valor });
		});

		// ── Acciones de la lista ──────────────────────────────────────────────
		el.acciones.addEventListener("click", async function (e) {
			var b = e.target.closest ? e.target.closest("button[data-accion]") : null;
			if (!b) return;
			var l = listaPorId(listaId);
			if (!l) return;
			var a = b.getAttribute("data-accion");
			if (a === "columna") abrirColumna(null);
			else if (a === "editar") abrirDialogoLista(l);
			else if (a === "cerrar") cerrarLista(l);
			else if (a === "reabrir") reabrirLista(l);
			else if (a === "eliminar") eliminarLista(l);
		});

		async function cerrarLista(l) {
			var ok = await confirmar("Cerrar la lista", "«" + l.nombre + "» quedará en el historial del grupo, de solo lectura, como expediente. No se borra. Si necesitas corregir algo, podrás reabrirla.", "Cerrar lista");
			if (!ok) return;
			await cambiarEstado(l, { estado: "cerrada", activos_al_cerrar: alumnos.filter(function (x) { return x.estatus === "activo"; }).map(function (x) { return x.id; }) },
				"Lista cerrada. Quedó en el historial.");
		}
		async function reabrirLista(l) {
			var ok = await confirmar("Reabrir la lista", "«" + l.nombre + "» volverá a poder editarse y saldrá del historial hasta que la cierres otra vez. Mientras esté abierta cuenta a los alumnos activos de hoy.", "Reabrir");
			if (!ok) return;
			await cambiarEstado(l, { estado: "abierta" }, "Lista reabierta.");
		}
		async function cambiarEstado(l, cambios, textoOk) {
			mensaje("info", "Guardando...");
			try {
				var res = await escribir(function () {
					return window.sb.from("listas_grupo").update(cambios).eq("id", l.id).eq("maestro_id", userId).select("*, listas_columnas(*)");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el cambio");
				reemplazarLista(res.data[0]);
				pintarDetalle();
				mensaje("ok", textoOk);
			} catch (e) {
				console.error("listas: cambiar estado", e);
				mensaje("error", "No se pudo guardar el cambio. " + motivo(e));
			}
		}
		async function eliminarLista(l) {
			var ok = await confirmar("Eliminar la lista", "Se eliminará «" + l.nombre + "» con todas sus columnas y lo registrado. Esta acción no se puede deshacer. Si quieres conservarla como expediente, mejor ciérrala.", "Sí, eliminar", true);
			if (!ok) return;
			try {
				var res = await escribir(function () {
					return window.sb.from("listas_grupo").delete().eq("id", l.id).eq("maestro_id", userId).select("id");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el borrado");
				listas = listas.filter(function (x) { return x.id !== l.id; });
				delete valores[l.id];
				mostrarIndice();
				mensaje("ok", "Lista eliminada.");
			} catch (e) {
				console.error("listas: eliminar", e);
				mensaje("error", "No se pudo eliminar la lista. " + motivo(e));
			}
		}
		function reemplazarLista(nueva) {
			var hay = false;
			listas = listas.map(function (x) { if (x.id === nueva.id) { hay = true; return nueva; } return x; });
			if (!hay) listas.unshift(nueva);
			listas.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)) || String(b.created_at || "").localeCompare(String(a.created_at || "")); });
		}

		// ── Diálogo: nueva lista / editar datos ───────────────────────────────
		var fL = {
			form: el.dlgLista.querySelector("form"), titulo: el.dlgLista.querySelector("[data-titulo]"),
			nombre: $("dlgListaNombre"), fecha: $("dlgListaFecha"), descripcion: $("dlgListaDescripcion"), error: el.dlgLista.querySelector("[data-error]"),
			ok: el.dlgLista.querySelector("[data-ok]"),
		};
		var editandoLista = null;
		function abrirDialogoLista(l) {
			editandoLista = l || null;
			fL.titulo.textContent = l ? "Editar datos de la lista" : "Nueva lista";
			fL.ok.textContent = l ? "Guardar cambios" : "Crear lista";
			fL.nombre.value = l ? l.nombre : "";
			fL.fecha.value = l ? l.fecha : hoyISO();
			fL.descripcion.value = l ? (l.descripcion || "") : "";
			fL.error.hidden = true;
			el.dlgLista.showModal();
			fL.nombre.focus();
		}
		el.nueva.addEventListener("click", function () { abrirDialogoLista(null); });
		fL.form.addEventListener("submit", async function (e) {
			e.preventDefault();
			var v = { nombre: fL.nombre.value, fecha: fL.fecha.value, descripcion: fL.descripcion.value };
			var falta = validarLista(v);
			if (falta) { fL.error.textContent = falta; fL.error.hidden = false; return; }
			fL.ok.disabled = true;
			var datos = { nombre: limpiar(v.nombre), fecha: v.fecha, descripcion: String(v.descripcion || "").trim() || null };
			try {
				var res = await escribir(function () {
					return editandoLista
						? window.sb.from("listas_grupo").update(datos).eq("id", editandoLista.id).eq("maestro_id", userId).select("*, listas_columnas(*)")
						: window.sb.from("listas_grupo").insert(Object.assign({ maestro_id: userId, grupo_id: grupo.id }, datos)).select("*, listas_columnas(*)");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el guardado");
				var nueva = res.data[0];
				var eraNueva = !editandoLista;
				reemplazarLista(nueva);
				if (eraNueva) valores[nueva.id] = [];
				el.dlgLista.close();
				abrirLista(nueva.id, false);
				mensaje("ok", eraNueva ? "Lista creada. Ahora agrega sus columnas." : "Datos de la lista guardados.");
				if (eraNueva) abrirColumna(null);
			} catch (err) {
				console.error("listas: guardar lista", err);
				fL.error.textContent = "No se pudo guardar. " + motivo(err) + " Lo que escribiste sigue aquí.";
				fL.error.hidden = false;
			} finally {
				fL.ok.disabled = false;
			}
		});

		// ── Diálogo: columna ──────────────────────────────────────────────────
		var fC = {
			form: el.dlgColumna.querySelector("form"), titulo: el.dlgColumna.querySelector("[data-titulo]"),
			nombre: $("dlgColumnaNombre"), tipos: $("dlgColumnaTipos"), esperadoFila: $("dlgColumnaEsperadoFila"), esperado: $("dlgColumnaEsperado"),
			error: el.dlgColumna.querySelector("[data-error]"), ok: el.dlgColumna.querySelector("[data-ok]"), eliminar: el.dlgColumna.querySelector("[data-eliminar]"),
			nota: el.dlgColumna.querySelector("[data-nota]"),
		};
		var editandoCol = null;
		fC.tipos.innerHTML = Object.keys(TIPOS).map(function (k, i) {
			return "<label class='flex items-start gap-3 min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 cursor-pointer has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50 has-[:disabled]:opacity-60 has-[:disabled]:cursor-not-allowed'>" +
				"<input type='radio' name='dlgColumnaTipo' value='" + k + "'" + (i === 0 ? " checked" : "") + " class='mt-1 h-4 w-4 shrink-0'>" +
				"<span class='min-w-0'><span class='flex items-center gap-1.5 text-sm font-semibold text-gray-900'>" + icono(k) + esc(TIPOS[k].etiqueta) + "</span>" +
				"<span class='block text-xs text-gray-600'>" + esc(TIPOS[k].ayuda) + "</span></span></label>";
		}).join("");
		function tipoElegido() { var r = fC.tipos.querySelector("input:checked"); return r ? r.value : "palomita"; }
		function mostrarEsperado() { fC.esperadoFila.hidden = tipoElegido() !== "monto"; }
		fC.tipos.addEventListener("change", mostrarEsperado);
		function abrirColumna(colId) {
			var l = listaPorId(listaId);
			if (!l || l.estado === "cerrada") return;
			var col = colId ? columnasDe(l).filter(function (c) { return c.id === colId; })[0] : null;
			if (!col && columnasDe(l).length >= MAX_COLUMNAS) { mensaje("error", "Una lista puede tener hasta " + MAX_COLUMNAS + " columnas."); return; }
			editandoCol = col || null;
			fC.titulo.textContent = col ? "Editar columna" : "Agregar columna";
			fC.ok.textContent = col ? "Guardar cambios" : "Agregar";
			fC.nombre.value = col ? col.nombre : "";
			Array.prototype.forEach.call(fC.tipos.querySelectorAll("input"), function (r) {
				r.checked = col ? r.value === col.tipo : r.value === "palomita";
				r.disabled = !!col;
			});
			fC.esperado.value = col && col.monto_esperado !== null && col.monto_esperado !== undefined ? montoEditable(aCentavos(col.monto_esperado)) : "";
			fC.nota.textContent = col ? "El tipo no se puede cambiar: lo registrado ya es de ese tipo." : "";
			fC.nota.hidden = !col;
			fC.eliminar.hidden = !col;
			fC.error.hidden = true;
			mostrarEsperado();
			el.dlgColumna.showModal();
			fC.nombre.focus();
		}
		fC.form.addEventListener("submit", async function (e) {
			e.preventDefault();
			var l = listaPorId(listaId);
			if (!l) return;
			var tipo = editandoCol ? editandoCol.tipo : tipoElegido();
			var v = { nombre: fC.nombre.value, tipo: tipo, esperado: tipo === "monto" ? fC.esperado.value : undefined };
			var falta = validarColumna(v, editandoCol ? undefined : columnasDe(l).length);
			if (falta) { fC.error.textContent = falta; fC.error.hidden = false; return; }
			var esp = tipo === "monto" ? parsearMonto(fC.esperado.value) : null;
			var datos = { nombre: limpiar(v.nombre), monto_esperado: esp && !esp.vacio && esp.centavos > 0 ? esp.valor : null };
			fC.ok.disabled = true;
			try {
				var res = await escribir(function () {
					if (editandoCol) return window.sb.from("listas_columnas").update(datos).eq("id", editandoCol.id).eq("maestro_id", userId).select("*");
					var orden = columnasDe(l).reduce(function (m, c) { return Math.max(m, (c.orden || 0) + 1); }, 0);
					return window.sb.from("listas_columnas").insert(Object.assign({ maestro_id: userId, lista_id: l.id, tipo: tipo, orden: Math.min(99, orden) }, datos)).select("*");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el guardado");
				var c = res.data[0];
				l.listas_columnas = (l.listas_columnas || []).filter(function (x) { return x.id !== c.id; }).concat([c]);
				el.dlgColumna.close();
				pintarDetalle();
				mensaje("ok", editandoCol ? "Columna guardada." : "Columna «" + c.nombre + "» agregada.");
			} catch (err) {
				console.error("listas: guardar columna", err);
				fC.error.textContent = "No se pudo guardar la columna. " + motivo(err);
				fC.error.hidden = false;
			} finally {
				fC.ok.disabled = false;
			}
		});
		fC.eliminar.addEventListener("click", async function () {
			var l = listaPorId(listaId), col = editandoCol;
			if (!l || !col) return;
			el.dlgColumna.close();
			var ok = await confirmar("Eliminar la columna", "Se eliminará la columna «" + col.nombre + "» con lo registrado en ella. Esta acción no se puede deshacer.", "Sí, eliminar", true);
			if (!ok) return;
			try {
				var res = await escribir(function () {
					return window.sb.from("listas_columnas").delete().eq("id", col.id).eq("maestro_id", userId).select("id");
				});
				if (res.error) throw res.error;
				if (!res.data || !res.data.length) throw new Error("la base no confirmó el borrado");
				l.listas_columnas = (l.listas_columnas || []).filter(function (x) { return x.id !== col.id; });
				valores[l.id] = (valores[l.id] || []).filter(function (v) { return v.columna_id !== col.id; });
				pintarDetalle();
				mensaje("ok", "Columna eliminada.");
			} catch (e) {
				console.error("listas: eliminar columna", e);
				mensaje("error", "No se pudo eliminar la columna. " + motivo(e));
			}
		});

		// ── Recordar por WhatsApp (en privado, a una familia) ─────────────────
		var fR = { texto: $("dlgRecordarTexto"), abrir: $("dlgRecordarAbrir"), para: el.dlgRecordar.querySelector("[data-para]") };
		function actualizarEnlace() {
			var a = porId[el.dlgRecordar.dataset.alumno];
			fR.abrir.href = a && F ? F.enlaceWhatsApp(a.tutor_telefono, fR.texto.value) : "#";
		}
		function abrirRecordar(alId) {
			var l = listaPorId(listaId), a = porId[alId];
			if (!l || !a || !tieneTelefono(a)) return;
			var mapa = mapaDe(l);
			var res = resumenLista(l, columnasDe(l), alumnos, mapa);
			el.dlgRecordar.dataset.alumno = alId;
			fR.para.textContent = "Para " + (a.tutor_nombre ? a.tutor_nombre + ", " : "") + "familia de " + (a.nombre_completo || "el alumno") + " (" + F.formatoTelefono(a.tutor_telefono) + "). Solo lo ve esa familia.";
			fR.texto.value = mensajeRecordatorio(docente, a.nombre_completo, l.nombre, pendientesDe(res, alId, mapa));
			actualizarEnlace();
			el.dlgRecordar.showModal();
			fR.texto.focus();
		}
		fR.texto.addEventListener("input", actualizarEnlace);
		fR.abrir.addEventListener("click", function () { actualizarEnlace(); setTimeout(function () { if (el.dlgRecordar.open) el.dlgRecordar.close(); }, 300); });

		// ── Salida: imagen y texto para las familias (sin nombres), impresión (maestra) ──
		function metaSalida(l) {
			return { nombre: l.nombre, grupo: grupo ? grupo.nombre || "" : "", escuela: escuela, fecha: l.fecha, descripcion: l.descripcion, estado: l.estado };
		}
		async function crearImagenes() {
			var l = listaPorId(listaId);
			if (!l) throw new Error("no hay lista abierta");
			// Todo se copia al empezar: si la maestra cambia algo mientras se dibuja, no se mezcla
			var datos = Object.assign(metaSalida(l), { resumen: resumenDe(l) });
			var nombreLista = l.nombre, nombreGrupo = grupo ? grupo.nombre : "";
			var medidor = document.createElement("canvas").getContext("2d");
			var hojas = paginasImagen(medidor, datos);
			var salida = [];
			for (var i = 0; i < hojas.length; i++) {
				var canvas = R.pintar(document.createElement("canvas"), hojas[i]);
				var blob = await new Promise(function (resolver, rechazar) {
					canvas.toBlob(function (b) { if (b) resolver(b); else rechazar(new Error("el navegador no pudo crear la imagen")); }, "image/png");
				});
				salida.push({ blob: blob, nombre: nombreArchivo(nombreLista, nombreGrupo, i + 1, hojas.length) });
			}
			return salida;
		}
		function descargar(blob, nombre) {
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url; a.download = nombre; a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
		}
		function descargarTodas(imgs) {
			imgs.forEach(function (im, i) { setTimeout(function () { descargar(im.blob, im.nombre); }, i * 400); });
			el.estadoSalida.textContent = imgs.length === 1 ? "Imagen guardada en tus descargas: " + imgs[0].nombre + "." :
				imgs.length + " imágenes guardadas en tus descargas. Si el navegador pregunta, permite descargar varios archivos.";
		}
		var generando = false;
		async function conBotones(fn) {
			if (generando) return;
			generando = true;
			[el.imagen, el.compartir].forEach(function (b) { b.disabled = true; });
			try { await fn(); } finally { generando = false; [el.imagen, el.compartir].forEach(function (b) { b.disabled = false; }); }
		}
		el.imagen.addEventListener("click", function () {
			conBotones(async function () {
				try { descargarTodas(await crearImagenes()); } catch (e) { console.error("listas: imagen", e); mensaje("error", "No se pudo crear la imagen: " + ((e && e.message) || "error desconocido") + "."); }
			});
		});
		var puedeCompartir = false;
		try {
			puedeCompartir = !!(navigator.share && navigator.canShare && typeof File === "function" &&
				navigator.canShare({ files: [new File([new Blob(["x"], { type: "image/png" })], "lista.png", { type: "image/png" })] }));
		} catch (_) { puedeCompartir = false; }
		el.compartir.hidden = !puedeCompartir;
		el.compartir.addEventListener("click", function () {
			conBotones(async function () {
				var imgs = null;
				try {
					imgs = await crearImagenes();
					var archivos = imgs.map(function (im) { return new File([im.blob], im.nombre, { type: "image/png" }); });
					if (navigator.canShare && !navigator.canShare({ files: archivos })) throw new Error("sin compartir");
					await navigator.share({ files: archivos, title: (listaPorId(listaId) || {}).nombre || "Lista" });
				} catch (e) {
					if (e && e.name === "AbortError") return;
					if (imgs && imgs.length) { descargarTodas(imgs); return; }
					mensaje("error", "No se pudo crear la imagen: " + ((e && e.message) || "error desconocido") + ".");
				}
			});
		});
		el.copiar.addEventListener("click", async function () {
			var l = listaPorId(listaId);
			if (!l) return;
			var t = textoFamilias(metaSalida(l), resumenDe(l));
			var copiado = false;
			try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); copiado = true; } } catch (_) {}
			if (!copiado) {
				var ta = document.createElement("textarea");
				ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
				document.body.appendChild(ta); ta.select();
				try { copiado = document.execCommand("copy"); } catch (_) {}
				ta.remove();
			}
			el.estadoSalida.textContent = copiado ? "Texto copiado, sin nombres de alumnos. Pégalo en WhatsApp." : "No se pudo copiar. Intenta de nuevo.";
		});
		function prepararImpresion() {
			var l = listaPorId(listaId);
			el.impresion.innerHTML = l && !el.detalle.hidden ? htmlImpresion(metaSalida(l), resumenDe(l), mapaDe(l)) : "";
		}
		window.addEventListener("beforeprint", prepararImpresion);
		el.imprimir.addEventListener("click", function () { prepararImpresion(); window.print(); });

		// ── Arranque ──────────────────────────────────────────────────────────
		function desdeHash() {
			var h = window.location.hash || "";
			var m = /^#lista=([0-9a-f-]{36})$/i.exec(h);
			if (m && listaPorId(m[1])) { elegirPestana(listaPorId(m[1]).estado === "cerrada" ? "historial" : "abiertas"); abrirLista(m[1], false); return; }
			elegirPestana(h === "#historial" ? "historial" : (h === "#alumnos" ? "alumnos" : "abiertas"));
			mostrarIndice();
		}

		window.Lectura.arrancar(async function () {
			var ses = await window.sb.auth.getSession();
			if (ses.error || !ses.data.session) { window.location.href = "index.html"; return; }
			userId = ses.data.session.user.id;
			grupo = (await window.GrupoActivo.cargar(window.sb, userId)).grupo;
			if (!grupo) { window.location.href = "onboarding.html"; return; }

			var lecturas = await Promise.all([
				window.Lectura.uno(window.sb.from("perfiles").select("nombre_completo, escuela").eq("id", userId).maybeSingle()),
				window.Lectura.todas(function () {
					return window.sb.from("alumnos").select("id, nombre_completo, num_lista, grado, estatus, tutor_nombre, tutor_telefono")
						.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("num_lista", { ascending: true }).order("id", { ascending: true });
				}),
				window.Lectura.todas(function () {
					return window.sb.from("listas_grupo").select("*, listas_columnas(*)")
						.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("fecha", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: true });
				}),
			]);
			var perfil = lecturas[0] || {};
			var meta = ses.data.session.user.user_metadata || {};
			docente = limpiar(perfil.nombre_completo || meta.nombre_docente || meta.full_name || "");
			escuela = limpiar(grupo.escuela || perfil.escuela || "");
			alumnos = lecturas[1] || [];
			porId = {};
			alumnos.forEach(function (a) { porId[a.id] = a; });
			listas = lecturas[2] || [];
			var ids = listas.map(function (l) { return l.id; });
			var filas = ids.length ? await window.Lectura.porLotes(ids, function (lote) {
				return window.sb.from("listas_valores").select("id, lista_id, columna_id, alumno_id, entregado, texto, monto")
					.eq("maestro_id", userId).in("lista_id", lote).order("id", { ascending: true });
			}) : [];
			valores = {};
			ids.forEach(function (id) { valores[id] = []; });
			filas.forEach(function (v) { if (valores[v.lista_id]) valores[v.lista_id].push(v); });

			el.subtitulo.textContent = (grupo.nombre || "Grupo") + (grupo.ciclo_escolar ? " · Ciclo " + grupo.ciclo_escolar : "") + (escuela ? " · " + escuela : "");
			el.nueva.disabled = false;
			desdeHash();
			// Un enlace o el historial del navegador que cambia el #: se abre lo que diga
			window.addEventListener("hashchange", function () { mensaje(null); desdeHash(); });
		});
	});
})();
