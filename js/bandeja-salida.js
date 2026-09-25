/*
	bandeja-salida.js — La cola de guardado de "Hoy" vive en el dispositivo (fase 2.5 de
	docs/PWA-MI-SALON.md, §9.3).

	Antes la cola de js/hoy.js vivía solo en memoria: si la app se cerraba, se recargaba o iOS
	la descargaba sin red, lo pendiente se perdía. Ahora cada captura se guarda PRIMERO aquí
	(IndexedDB "jissez-bandeja", almacén "pendientes") y después se envía en serie. Se borra
	solo cuando la base la confirmó. Si no hay IndexedDB (o falla), la cola sigue en memoria,
	como antes, y la página lo dice.

	Cada captura es un dato serializable:
		{ clave, tipo, maestro_id, seq, capturado_en, datos, descripcion, base, propias, intentado }
	  tipo "asistencia"      datos { grupo_id, alumno_id, fecha, estado }
	  tipo "registro"        datos { alumno_id, fecha, participacion, conducta }   (cierre del día)
	  tipo "registro_borrar" datos { alumno_id, fecha }                            (se retira el cierre)
	  tipo "calificacion"    datos { id?, fecha, fila }  (fila: la de calificaciones, sin evaluado_en)

	Concurrencia optimista (dos dispositivos, la misma maestra), sin depender de relojes:
	  - El "valor" de un dato es su contenido en la base: asistencia { estado }; cierre del día
	    { participacion, conducta }; calificación { estado_entrega, nivel, puntaje,
	    retroalimentacion }; null = no hay fila. Es la "versión" que se compara (registro_diario
	    no tiene columna de versión y evaluado_en de calificaciones lo pone el reloj del aparato).
	  - Cada captura guarda `base`: el valor que la pantalla tenía de la base al tocarla. Si ya
	    había una captura pendiente de la misma llave, la nueva hereda su base (la pantalla aún
	    no sabe lo que hay en la base) y en `propias` lo que este dispositivo ya pudo haber
	    escrito (capturas que se intentaron enviar).
	  - Al enviar, la escritura es CONDICIONAL y atómica en un solo statement: update o delete
	    con filtros "la fila sigue con el valor base"; si base es null, insert que no pisa
	    (ON CONFLICT DO NOTHING; en calificaciones, el índice único parcial responde 23505).
	  - Si no aplicó, se lee la fila: si ya tiene el valor deseado, listo; si tiene la base o un
	    valor propio, se repite la escritura condicional con ese valor; si tiene otra cosa (otro
	    dispositivo la cambió o la creó), NO se pisa: la captura sale de la cola y se avisa con
	    el alumno, lo que quedó y lo que no se aplicó (alConflicto).
	  - Reenviar la misma captura no duplica nada: la segunda vez la fila ya tiene su valor.

	Otras reglas:
	  - Una sola captura por llave (alumno + fecha, alumno + producto): la más reciente del
	    dispositivo reemplaza a la anterior. Si una versión vieja estaba en camino, al volver no
	    borra la nueva (se compara `seq`) y su valor pasa a `propias` de la nueva.
	  - Solo se reintenta lo que es de red (sin respuesta: estado "red"; 408, 429, 5xx: estado
	    "servidor"), con espera creciente, al volver la red (online), al volver a primer plano y
	    al abrir la página. Sesión vencida (401/JWT): se refresca la sesión y se reintenta; si ya
	    no hay sesión, se espera (nada se borra). Cualquier otra respuesta del servidor (400,
	    403, 404, 409, un CHECK o un trigger que rechaza) NO se reintenta: se quita de la cola y
	    se avisa con su explicación en español.
	  - La cola es de la cuenta que capturó. Antes de enviar, y antes de dar por terminada una
	    captura (guardada, en conflicto o rechazada), se confirma que la sesión del dispositivo
	    es de esa cuenta. Si es de otra (cambió sin cerrar sesión), no se envía nada: las
	    capturas esperan a su dueña (estado "cuenta").

	Uso (js/hoy.js):
		var b = BandejaSalida.crear({ sb, auth, maestroId, alCambiar, alGuardar, alConflicto, alRechazar });
		b.agregar("asistencia", datos, "Asistencia de Ana", base);
		b.iniciar();            // habilita el envío (después de pintar lo pendiente)
		b.lista() → Promise<[capturas propias pendientes]>
		b.pendientes(), b.persistente(), b.vacia(), b.esperarEnvio() → Promise
	Cerrar sesión (js/navbar.js, js/sala-maestros.js):
		BandejaSalida.confirmarSalida(sb) → Promise<boolean>
*/
var BandejaSalida = (function () {
	var NOMBRE_BD = "jissez-bandeja";
	var ALMACEN = "pendientes";
	var MAX_INTENTOS_CAS = 4;
	// Una retroalimentación muy larga no va como filtro en la URL: se compara al leer
	var RETRO_MAX_FILTRO = 1000;
	var RECIENTE_MS = 5000; // una captura más vieja que esto ya esperó en la cola

	// ── Reglas puras ─────────────────────────────────────────────────────────────
	function clave(tipo, maestroId, d) {
		if (tipo === "asistencia") return "asistencia|" + d.grupo_id + "|" + d.alumno_id + "|" + d.fecha;
		if (tipo === "registro" || tipo === "registro_borrar") return "registro|" + maestroId + "|" + d.alumno_id + "|" + d.fecha;
		if (tipo === "calificacion") return "calificacion|" + maestroId + "|" + d.fila.alumno_id + "|" + d.fila.producto_sesion_id;
		throw new Error("bandeja: tipo desconocido " + tipo);
	}

	var MENSAJE_RED = /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|aborted|network/i;

	/*
		tipoDeFallo(error) → "red" | "sesion" | "rechazo"
		`error` es el que lanzan los envíos (con status y code de la respuesta) o cualquier
		excepción. "rechazo" exige una respuesta del servidor que diga que no: sin respuesta,
		o una excepción que no se entiende, se trata como de red (se reintenta; nunca se
		descarta una captura por algo que no es un "no" de la base).
	*/
	function tipoDeFallo(e) {
		var status = e && typeof e.status === "number" ? e.status : null;
		var code = e && e.code ? String(e.code) : "";
		var msg = String((e && e.message) || "");
		if (status === 401 || code === "PGRST301" || code === "PGRST303" || /\bjwt\b/i.test(msg)) return "sesion";
		if (status === 0 || status === 408 || status === 429 || (status !== null && status >= 500)) return "red";
		if (status !== null && status >= 400) return "rechazo";
		if (status === null && code && !MENSAJE_RED.test(msg)) return "rechazo"; // error de Postgres sin status
		return "red";
	}

	// Un fallo "de red" con respuesta (408, 429, 5xx) es del servidor: no es "sin señal"
	function estadoDeRed(e) {
		var status = e && typeof e.status === "number" ? e.status : 0;
		return status > 0 ? "servidor" : "red";
	}

	// Explicación para la maestra de por qué la base no aceptó una captura (en español; el
	// texto técnico de la base solo va a la consola)
	function explicar(e) {
		var code = e && e.code ? String(e.code) : "";
		var status = e && e.status;
		if (code === "42501" || status === 403) return "la base no lo permitió (el alumno, el grupo o el producto ya no es de esta cuenta)";
		if (code === "23503") return "el alumno, la sesión o el producto ya no existe";
		if (code === "23505" || status === 409) return "ya había un registro de ese dato guardado desde otro dispositivo o pantalla; se conservó ese";
		if (code === "23514" || code === "22P02" || code === "22003" || code === "23502") return "un valor capturado no es válido";
		if (code === "P0001" && e.message) return e.message; // los triggers propios hablan en español
		return "la base no lo aceptó" + (code ? " (código " + code + ")" : status ? " (error " + status + ")" : "");
	}

	// La respuesta de supabase-js trae status y error: se vuelve un Error con ambos (para lanzarlo)
	function fallo(res) {
		var err = (res && res.error) || {};
		var e = new Error(err.message || "No se pudo guardar");
		e.status = res && typeof res.status === "number" ? res.status : (typeof err.status === "number" ? err.status : null);
		e.code = err.code || "";
		e.details = err.details || null;
		return e;
	}

	// ── Valores (la "versión" de un dato es su contenido) ────────────────────────
	function num(v) { return v === null || v === undefined || v === "" ? null : Number(v); }
	function txt(v) { return v === null || v === undefined || v === "" ? null : String(v); }

	function valorDeFila(tipo, f) {
		if (!f) return null;
		if (tipo === "asistencia") return { estado: txt(f.asistencia_estado !== undefined ? f.asistencia_estado : f.estado) };
		if (tipo === "registro" || tipo === "registro_borrar") return { participacion: num(f.participacion), conducta: num(f.conducta) };
		if (tipo === "calificacion") {
			return { estado_entrega: txt(f.estado_entrega), nivel: txt(f.nivel), puntaje: num(f.puntaje), retroalimentacion: txt(f.retroalimentacion) };
		}
		return null;
	}

	// Lo que la captura quiere dejar en la base
	function valorDeseado(it) {
		var d = it.datos || {};
		if (it.tipo === "registro_borrar") return null;
		if (it.tipo === "calificacion") return valorDeFila("calificacion", d.fila);
		return valorDeFila(it.tipo, d);
	}

	function igual(a, b) {
		if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
		var ka = Object.keys(a), kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		return ka.every(function (k) { return a[k] === b[k]; });
	}

	// El valor como lo lee la maestra (para los avisos)
	var ETIQ_ASISTENCIA = { presente: "Presente", ausente: "Falta", justificada: "Justificada" };
	var ETIQ_NIVEL = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
	var ETIQ_ENTREGA = { entregado: "Entregó", incompleto: "Incompleta", no_entregado: "No entregó", justificado: "Justificada", no_aplica: "No aplica" };
	function describir(tipo, v) {
		if (tipo === "asistencia") return v && v.estado ? (ETIQ_ASISTENCIA[v.estado] || v.estado) : "sin asistencia registrada";
		if (tipo === "registro" || tipo === "registro_borrar") {
			return v ? "participación " + (v.participacion === null ? "-" : v.participacion) + ", conducta " + (v.conducta === null ? "-" : v.conducta) : "sin cierre del día";
		}
		if (tipo === "calificacion") {
			if (!v) return "sin calificar";
			var partes = [];
			if (v.nivel) partes.push(ETIQ_NIVEL[v.nivel] || v.nivel);
			if (v.estado_entrega && !(v.nivel && v.estado_entrega === "entregado")) partes.push(ETIQ_ENTREGA[v.estado_entrega] || v.estado_entrega);
			if (v.puntaje !== null) partes.push("puntaje " + v.puntaje);
			if (v.retroalimentacion) partes.push("retroalimentación “" + (v.retroalimentacion.length > 60 ? v.retroalimentacion.slice(0, 57) + "..." : v.retroalimentacion) + "”");
			return partes.length ? partes.join(", ") : "sin calificar";
		}
		return "";
	}

	function textoConflicto(it, actual) {
		return (it.descripcion || "Una captura") + ": se cambió desde otro dispositivo o pantalla (quedó: " +
			describir(it.tipo, actual) + "). Se conservó eso; tu captura (" + describir(it.tipo, valorDeseado(it)) + ") no se aplicó.";
	}

	// ── Escrituras condicionales (una por tabla) ─────────────────────────────────
	function filtrar(q, pares) {
		pares.forEach(function (p) { q = p[1] === null || p[1] === undefined ? q.is(p[0], null) : q.eq(p[0], p[1]); });
		return q;
	}

	var OPS = {
		asistencia: {
			tabla: "asistencias", columnas: "asistencia_estado", conflicto: "grupo_id,alumno_id,fecha",
			llave: function (it) {
				var d = it.datos;
				return [["maestro_id", it.maestro_id], ["grupo_id", d.grupo_id], ["alumno_id", d.alumno_id], ["fecha", d.fecha]];
			},
			nueva: function (it, v) {
				var d = it.datos;
				return { maestro_id: it.maestro_id, grupo_id: d.grupo_id, alumno_id: d.alumno_id, fecha: d.fecha, asistencia_estado: v.estado };
			},
			cambios: function (it, v) { return { asistencia_estado: v.estado }; },
			condicion: function (v) { return [["asistencia_estado", v.estado]]; },
		},
		registro: {
			tabla: "registro_diario", columnas: "participacion, conducta", conflicto: "maestro_id,alumno_id,fecha",
			llave: function (it) { return [["maestro_id", it.maestro_id], ["alumno_id", it.datos.alumno_id], ["fecha", it.datos.fecha]]; },
			nueva: function (it, v) {
				return { maestro_id: it.maestro_id, alumno_id: it.datos.alumno_id, fecha: it.datos.fecha, participacion: v.participacion, conducta: v.conducta };
			},
			cambios: function (it, v) { return { participacion: v.participacion, conducta: v.conducta }; },
			condicion: function (v) { return [["participacion", v.participacion], ["conducta", v.conducta]]; },
		},
		calificacion: {
			// Una calificación por (maestro, alumno, producto): el índice único es parcial, así que
			// no hay ON CONFLICT; el insert que choca responde 23505 y se trata como "ya existía"
			tabla: "calificaciones", columnas: "id, estado_entrega, nivel, puntaje, retroalimentacion", conflicto: null,
			llave: function (it) {
				var f = it.datos.fila;
				return [["maestro_id", it.maestro_id], ["alumno_id", f.alumno_id], ["producto_sesion_id", f.producto_sesion_id]];
			},
			// La fila entera de la captura (grado, campo, sesión...); evaluado_en = momento de la
			// captura, solo informativo: la regla de concurrencia ya no depende de relojes
			nueva: function (it) {
				return Object.assign({ fecha: it.datos.fecha }, it.datos.fila, { maestro_id: it.maestro_id, evaluado_en: it.capturado_en });
			},
			cambios: function (it) { return Object.assign({}, it.datos.fila, { maestro_id: it.maestro_id, evaluado_en: it.capturado_en }); },
			condicion: function (v) {
				var c = [["estado_entrega", v.estado_entrega], ["nivel", v.nivel], ["puntaje", v.puntaje]];
				if (!v.retroalimentacion || v.retroalimentacion.length <= RETRO_MAX_FILTRO) c.push(["retroalimentacion", v.retroalimentacion]);
				return c;
			},
		},
	};
	OPS.registro_borrar = OPS.registro;

	// La fila de la base, ahora → { valor, id }
	async function leerActual(sb, it) {
		var op = OPS[it.tipo];
		var res = await filtrar(sb.from(op.tabla).select(op.columnas), op.llave(it)).maybeSingle();
		if (res.error) throw fallo(res);
		return { valor: valorDeFila(it.tipo, res.data), id: res.data && res.data.id ? res.data.id : null };
	}

	/*
		escribirSi(sb, it, esperado, deseado) → { ok, valor?, id? }
		Escribe `deseado` solo si la base tiene `esperado` (null = no hay fila). Un solo statement:
		la base lo resuelve de forma atómica. ok=false: la condición no se cumplió.
	*/
	async function escribirSi(sb, it, esperado, deseado) {
		var op = OPS[it.tipo];
		var res;
		if (esperado === null) {
			if (deseado === null) return { ok: false };
			if (op.conflicto) {
				res = await sb.from(op.tabla).upsert(op.nueva(it, deseado), { onConflict: op.conflicto, ignoreDuplicates: true }).select(op.columnas);
			} else {
				// Una captura que esperó en la cola (sin red, reintento) pudo encontrarse con una fila
				// creada en otro lado: se mira antes, para no provocar un 409 en la consola. La
				// captura recién hecha en línea va directo (una sola petición)
				if (it.enCola || it.intentado || Date.now() - Date.parse(it.capturado_en) > RECIENTE_MS) {
					if ((await leerActual(sb, it)).valor !== null) return { ok: false };
				}
				res = await sb.from(op.tabla).insert(op.nueva(it, deseado)).select(op.columnas);
				if (res.error && String(res.error.code || "") === "23505") return { ok: false };
			}
		} else if (deseado === null) {
			res = await filtrar(filtrar(sb.from(op.tabla).delete(), op.llave(it)), op.condicion(esperado)).select("id");
			if (res.error) throw fallo(res);
			return res.data && res.data.length ? { ok: true, valor: null } : { ok: false };
		} else {
			// Una retroalimentación muy larga no va en el filtro: se compara leyendo justo antes
			if (it.tipo === "calificacion" && esperado.retroalimentacion && esperado.retroalimentacion.length > RETRO_MAX_FILTRO) {
				if (!igual((await leerActual(sb, it)).valor, esperado)) return { ok: false };
			}
			res = await filtrar(filtrar(sb.from(op.tabla).update(op.cambios(it, deseado)), op.llave(it)), op.condicion(esperado)).select(op.columnas);
		}
		if (res.error) throw fallo(res);
		var filas = res.data ? [].concat(res.data) : [];
		if (!filas.length) return { ok: false };
		return { ok: true, valor: valorDeFila(it.tipo, filas[0]) || deseado, id: filas[0].id || null };
	}

	/*
		enviar(sb, it) → { valor, id? } si quedó guardada, o { conflicto: true, actual } si otro
		dispositivo la cambió. Lanza el error de la base (red, sesión o rechazo).
	*/
	async function enviar(sb, it) {
		var deseado = valorDeseado(it);
		var base = it.base === undefined ? null : it.base; // capturas de antes de esta regla: "no existía"
		var aceptables = [base].concat(it.propias || []);
		var esperado = base;
		for (var i = 0; i < MAX_INTENTOS_CAS; i++) {
			if (!igual(esperado, deseado)) {
				var r = await escribirSi(sb, it, esperado, deseado);
				if (r.ok) return { valor: r.valor, id: r.id || null };
			}
			var actual = await leerActual(sb, it);
			if (igual(actual.valor, deseado)) return { valor: actual.valor, id: actual.id };
			var nuestro = aceptables.some(function (v) { return igual(v, actual.valor); });
			if (!nuestro) return { conflicto: true, actual: actual.valor, id: actual.id };
			esperado = actual.valor; // la base tiene lo que este dispositivo vio o escribió: se repite
		}
		// La fila cambió varias veces mientras se intentaba: se reintenta más tarde
		var e = new Error("La fila cambió mientras se guardaba");
		e.status = 0;
		throw e;
	}

	/*
		Primer cierre del día: los alumnos sin fila se insertan todos en un solo statement que no
		pisa (ON CONFLICT DO NOTHING). Los que no se insertaron (ya había fila) se resuelven uno
		por uno con la regla general. → [{ valor } | { pendiente: true }] en el orden del lote.
	*/
	async function enviarLoteRegistros(sb, lote) {
		var op = OPS.registro;
		var res = await sb.from(op.tabla).upsert(lote.map(function (it) { return op.nueva(it, valorDeseado(it)); }),
			{ onConflict: op.conflicto, ignoreDuplicates: true }).select("alumno_id, fecha, participacion, conducta");
		if (res.error) throw fallo(res);
		var puestas = {};
		(res.data || []).forEach(function (f) { puestas[f.alumno_id + "|" + f.fecha] = f; });
		return lote.map(function (it) {
			var f = puestas[it.datos.alumno_id + "|" + it.datos.fecha];
			return f ? { valor: valorDeFila("registro", f) } : { pendiente: true };
		});
	}

	// ── Almacenes ────────────────────────────────────────────────────────────────
	function copia(it) { return it ? JSON.parse(JSON.stringify(it)) : it; }

	// En memoria: sin IndexedDB, y en las pruebas (el mismo objeto simula "recargar")
	function almacenMemoria() {
		var mapa = {};
		return {
			persistente: false,
			todos: function () { return Promise.resolve(Object.keys(mapa).map(function (k) { return copia(mapa[k]); })); },
			obtener: function (c) { return Promise.resolve(copia(mapa[c]) || null); },
			poner: function (it) { mapa[it.clave] = copia(it); return Promise.resolve(); },
			quitarSi: function (c, seq) {
				if (mapa[c] && mapa[c].seq === seq) delete mapa[c];
				return Promise.resolve();
			},
			// Cambia la captura guardada solo si sigue siendo la misma (seq) o una más nueva (seq > desde)
			cambiarSi: function (c, prueba, fn) {
				if (mapa[c] && prueba(mapa[c])) fn(mapa[c]);
				return Promise.resolve();
			},
			quitar: function (c) { delete mapa[c]; },
		};
	}

	function abrirBD() {
		return new Promise(function (ok) {
			var hecho = false;
			function fin(v) { if (!hecho) { hecho = true; ok(v); } else if (v && v.close) { try { v.close(); } catch (_) {} } }
			setTimeout(function () { fin(null); }, 4000); // un navegador que nunca contesta
			function crearAlmacen(db) {
				if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: "clave" });
			}
			function listo(db) {
				db.onversionchange = function () { try { db.close(); } catch (_) {} };
				fin(db);
			}
			try {
				if (typeof indexedDB === "undefined" || !indexedDB) { fin(null); return; }
				var req = indexedDB.open(NOMBRE_BD);
				req.onupgradeneeded = function () { crearAlmacen(req.result); };
				req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fin(null); };
				req.onblocked = function () { fin(null); };
				req.onsuccess = function () {
					var db = req.result;
					if (db.objectStoreNames.contains(ALMACEN)) { listo(db); return; }
					// Existe sin el almacén (no debería): se sube de versión para crearlo
					var v = db.version + 1;
					db.close();
					var r2 = indexedDB.open(NOMBRE_BD, v);
					r2.onupgradeneeded = function () { crearAlmacen(r2.result); };
					r2.onsuccess = function () { listo(r2.result); };
					r2.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fin(null); };
					r2.onblocked = function () { fin(null); };
				};
			} catch (_) {
				fin(null);
			}
		});
	}

	// IndexedDB es la fuente; si una escritura falla a media sesión, lo que no se pudo guardar
	// queda en memoria (y la página deja de decir "guardado en este dispositivo")
	function almacenIDB(db) {
		var mem = almacenMemoria();
		var a = { persistente: true };
		function txn(modo, fn) {
			return new Promise(function (ok, mal) {
				try {
					var tx = db.transaction(ALMACEN, modo);
					var req = fn(tx.objectStore(ALMACEN));
					tx.oncomplete = function () { ok(req ? req.result : undefined); };
					tx.onerror = function () { mal(tx.error || new Error("IndexedDB")); };
					tx.onabort = function () { mal(tx.error || new Error("IndexedDB")); };
				} catch (e) {
					mal(e);
				}
			});
		}
		a.todos = function () {
			return txn("readonly", function (s) { return s.getAll(); }).catch(function () { return []; }).then(function (lista) {
				var por = {};
				(lista || []).forEach(function (it) { por[it.clave] = it; });
				return mem.todos().then(function (enMem) {
					enMem.forEach(function (it) { if (!por[it.clave] || por[it.clave].seq < it.seq) por[it.clave] = it; });
					return Object.keys(por).map(function (k) { return por[k]; });
				});
			});
		};
		a.obtener = function (c) {
			return txn("readonly", function (s) { return s.get(c); }).catch(function () { return null; }).then(function (enBD) {
				return mem.obtener(c).then(function (enMem) {
					if (enMem && (!enBD || enBD.seq < enMem.seq)) return enMem;
					return enBD || null;
				});
			});
		};
		a.poner = function (it) {
			return txn("readwrite", function (s) { return s.put(it); }).then(function () {
				mem.quitar(it.clave);
			}, function (e) {
				a.persistente = false;
				if (typeof console !== "undefined") console.warn("bandeja: no se pudo guardar en el dispositivo; queda en memoria", e);
				return mem.poner(it);
			});
		};
		a.quitarSi = function (c, seq) {
			return mem.quitarSi(c, seq).then(function () {
				return txn("readwrite", function (s) {
					var g = s.get(c);
					g.onsuccess = function () { if (g.result && g.result.seq === seq) s.delete(c); };
					return null;
				}).catch(function () {});
			});
		};
		a.cambiarSi = function (c, prueba, fn) {
			return mem.cambiarSi(c, prueba, fn).then(function () {
				return txn("readwrite", function (s) {
					var g = s.get(c);
					g.onsuccess = function () { if (g.result && prueba(g.result)) { fn(g.result); s.put(g.result); } };
					return null;
				}).catch(function () {});
			});
		};
		return a;
	}

	function abrirAlmacen() {
		return abrirBD().then(function (db) { return db ? almacenIDB(db) : almacenMemoria(); });
	}

	// ── La bandeja ───────────────────────────────────────────────────────────────
	var ultimoSeq = 0;
	function siguienteSeq() {
		var s = Date.now() * 1000;
		ultimoSeq = s > ultimoSeq ? s : ultimoSeq + 1;
		return ultimoSeq;
	}

	var FALLAS = ["red", "servidor", "sesion", "cuenta"];

	/*
		crear(o)
		  o.sb          cliente de Supabase (window.sb)
		  o.auth        auth para leer y refrescar la sesión (Lectura.authDirecto: sin detener la página)
		  o.maestroId   la cuenta con sesión (la dueña de lo que se capture aquí)
		  o.almacen     (pruebas) un almacén ya abierto; si no, IndexedDB o memoria
		  o.alCambiar({ pendientes, estado: "ok"|"enviando"|"red"|"servidor"|"sesion"|"cuenta", persistente })
		  o.alGuardar(captura, { valor, id? })                    se confirmó; valor = lo que quedó en la base
		  o.alConflicto(captura, { actual, texto, sigue })        otro dispositivo la cambió: se conservó lo de la base
		  o.alRechazar(captura, explicacion, { actual?, sigue })  la base no la aceptó: ya salió de la cola
		     `actual`: lo que hay en la base (undefined si no se pudo leer); `sigue`: hay una captura
		     más nueva de la misma llave en la cola (la pantalla sigue mostrando esa)
		  o.esperaMax   tope de la espera entre reintentos (ms; 30 s)
	*/
	function crear(o) {
		var st = {
			almacen: null, habilitada: false, procesando: false, otraVez: false,
			espera: null, intentos: 0, estado: "ok", n: 0, unoPorUno: false,
			esperandoVacia: [], esperandoEnvio: [], cadena: Promise.resolve(), enVuelo: {},
			huboFalla: false, // la cola se atoró (red, servidor, sesión) desde la última vez que se vació
		};
		var listo = (o.almacen ? Promise.resolve(o.almacen) : abrirAlmacen()).then(function (a) { st.almacen = a; return a; });
		var esperaMax = o.esperaMax || 30000;

		function avisar() {
			if (o.alCambiar) {
				try {
					o.alCambiar({ pendientes: st.n, estado: st.estado, persistente: !!(st.almacen && st.almacen.persistente) });
				} catch (_) {}
			}
			if (!st.n) {
				st.esperandoVacia.splice(0).forEach(function (r) { r(); });
				st.esperandoEnvio.splice(0).forEach(function (r) { r("ok"); });
			} else if (FALLAS.indexOf(st.estado) !== -1) {
				st.esperandoEnvio.splice(0).forEach(function (r) { r(st.estado); });
			}
		}

		function propios() {
			return st.almacen.todos().then(function (lista) {
				var mias = lista.filter(function (it) { return it.maestro_id === o.maestroId; })
					.sort(function (a, b) { return a.seq - b.seq; });
				st.n = mias.length;
				return mias;
			});
		}

		/*
			agregar(tipo, datos, descripcion, base)
			`base`: el valor que la pantalla tiene de la base para esa llave (null = no hay fila).
			Si ya hay una captura pendiente de la misma llave, se hereda su base y lo que este
			dispositivo pudo haber escrito pasa a `propias`.
		*/
		function agregar(tipo, datos, descripcion, base) {
			// El momento y el orden son los del toque, no los de la escritura
			var it = {
				clave: clave(tipo, o.maestroId, datos), tipo: tipo, maestro_id: o.maestroId,
				seq: siguienteSeq(), capturado_en: new Date().toISOString(),
				datos: datos, descripcion: descripcion || "",
				base: base === undefined ? null : base, propias: [], intentado: false,
			};
			// En serie: dos toques seguidos de la misma llave no se pisan la herencia
			var hecho = st.cadena.then(function () { return listo; })
				.then(function () { return st.almacen.obtener(it.clave); })
				.then(function (prev) {
					if (prev && prev.maestro_id === it.maestro_id) {
						it.base = prev.base === undefined ? null : prev.base;
						it.propias = (prev.propias || []).slice();
						if (prev.intentado || st.enVuelo[prev.clave] === prev.seq) it.propias.push(valorDeseado(prev));
						it.propias = it.propias.filter(function (v, i, arr) {
							return !igual(v, it.base) && arr.findIndex(function (w) { return igual(v, w); }) === i;
						}).slice(-10);
					}
					return st.almacen.poner(it);
				});
			st.cadena = hecho.catch(function () {});
			return hecho.then(function () { return propios(); })
				.then(function () { avisar(); procesar(); return it; });
		}

		function programar() {
			if (st.espera) return;
			var ms = Math.min(esperaMax, 1000 * Math.pow(2, Math.max(0, st.intentos - 1)));
			st.espera = setTimeout(function () { st.espera = null; procesar(); }, ms);
		}

		/*
			¿La sesión del dispositivo es de la dueña de la cola? → "ok" | "sesion" | "cuenta" | "red"
			getSession lee la sesión guardada (y la refresca si venció).
		*/
		async function cuentaDuena() {
			var auth = o.auth || (o.sb && o.sb.auth);
			if (!auth || typeof auth.getSession !== "function") return "ok";
			try {
				var r = await auth.getSession();
				var s = r && r.data ? r.data.session : null;
				if (s && s.user) return s.user.id === o.maestroId ? "ok" : "cuenta";
				if (r && r.error && tipoDeFallo(r.error) === "red") return "red";
				return "sesion";
			} catch (_) {
				return "red";
			}
		}

		async function refrescarSesion() {
			return (await cuentaDuena()) === "ok";
		}

		// Hay una captura más nueva de la misma llave en la cola
		async function hayMasNueva(it) {
			var ahora = await st.almacen.obtener(it.clave);
			return !!(ahora && ahora.seq !== it.seq);
		}

		async function terminar(it, r) {
			await st.almacen.quitarSi(it.clave, it.seq);
			var sigue = await hayMasNueva(it);
			if (r.conflicto) {
				if (typeof console !== "undefined") console.warn("bandeja: conflicto, se conservó lo de la base", it.descripcion);
				if (o.alConflicto) { try { o.alConflicto(it, { actual: r.actual, sigue: sigue, texto: textoConflicto(it, r.actual) }); } catch (_) {} }
				return;
			}
			// Lo que escribió esta captura es "propio" para la más nueva de la misma llave
			if (sigue) {
				await st.almacen.cambiarSi(it.clave, function (x) { return x.seq > it.seq; }, function (x) {
					x.propias = (x.propias || []).concat([r.valor]).slice(-10);
				});
			}
			if (o.alGuardar) { try { o.alGuardar(it, { valor: r.valor, id: r.id || null }); } catch (_) {} }
		}

		async function procesar() {
			await listo;
			if (!st.habilitada) return;
			if (st.procesando) { st.otraVez = true; return; }
			st.procesando = true;
			if (st.espera) { clearTimeout(st.espera); st.espera = null; }
			var sesionIntentada = false;
			// Sin la dueña de la cola no se envía ni se decide nada
			async function duenaPresente() {
				var c = await cuentaDuena();
				if (c === "ok") return true;
				st.huboFalla = true;
				if (c === "red") { st.intentos++; st.estado = "red"; programar(); }
				else st.estado = c;
				return false;
			}
			try {
				for (;;) {
					var lista = await propios();
					if (!lista.length) { st.estado = "ok"; st.intentos = 0; st.unoPorUno = false; st.huboFalla = false; break; }
					if (!(await duenaPresente())) break;
					if (st.estado === "ok") { st.estado = "enviando"; avisar(); }
					var it = lista[0];
					// Lo que esperó en la cola (no es una captura recién hecha en línea): ver escribirSi
					lista.forEach(function (x) { x.enCola = st.huboFalla; });
					var lote = [it];
					if (it.tipo === "registro" && (it.base === null || it.base === undefined) && !st.unoPorUno) {
						lote = lista.filter(function (x) { return x.tipo === "registro" && (x.base === null || x.base === undefined); }).slice(0, 100);
					}
					for (var j = 0; j < lote.length; j++) {
						var x = lote[j];
						st.enVuelo[x.clave] = x.seq;
						if (!x.intentado) {
							await st.almacen.cambiarSi(x.clave, (function (seq) { return function (y) { return y.seq === seq; }; })(x.seq),
								function (y) { y.intentado = true; });
						}
					}
					try {
						var rs = lote.length > 1 ? await enviarLoteRegistros(o.sb, lote) : [await enviar(o.sb, it)];
						// Antes de dar algo por terminado: ¿sigue siendo la sesión de la dueña?
						if (!(await duenaPresente())) break;
						for (var i = 0; i < lote.length; i++) {
							if (rs[i].pendiente) { st.unoPorUno = true; continue; } // ya había fila: de una en una
							await terminar(lote[i], rs[i]);
						}
						st.intentos = 0;
						st.estado = "enviando";
					} catch (e) {
						var tipo = tipoDeFallo(e);
						if (tipo === "rechazo") {
							if (lote.length > 1) { st.unoPorUno = true; continue; } // ¿cuál fue? de una en una
							// Un "no" con la sesión de otra cuenta no es de la captura: se espera a su dueña
							if (!(await duenaPresente())) break;
							await st.almacen.quitarSi(it.clave, it.seq);
							if (typeof console !== "undefined") console.warn("bandeja: la base rechazó una captura", it.descripcion, e);
							var actual;
							try { actual = (await leerActual(o.sb, it)).valor; } catch (_) { actual = undefined; }
							var sigue = await hayMasNueva(it);
							if (o.alRechazar) { try { o.alRechazar(it, explicar(e), { actual: actual, sigue: sigue }); } catch (_) {} }
							continue;
						}
						if (tipo === "sesion" && !sesionIntentada) {
							sesionIntentada = true;
							if (await refrescarSesion()) continue;
						}
						if (tipo === "sesion") {
							// Sin sesión válida no se reintenta solo: se espera a que vuelva a entrar
							st.huboFalla = true;
						st.estado = (await cuentaDuena()) === "cuenta" ? "cuenta" : "sesion";
							break;
						}
						st.intentos++;
						st.huboFalla = true;
						st.estado = estadoDeRed(e);
						programar();
						break;
					} finally {
						lote.forEach(function (x) { if (st.enVuelo[x.clave] === x.seq) delete st.enVuelo[x.clave]; });
					}
				}
			} finally {
				st.procesando = false;
				avisar();
				if (st.otraVez) {
					st.otraVez = false;
					if (FALLAS.indexOf(st.estado) === -1 || (st.estado !== "sesion" && st.estado !== "cuenta" && !st.espera)) procesar();
				}
			}
		}

		// Reenvío inmediato: volvió la red, la página volvió a primer plano o se abrió
		function reintentarYa() {
			if (FALLAS.indexOf(st.estado) !== -1) st.estado = "ok";
			st.intentos = 0;
			return procesar();
		}

		return {
			agregar: agregar,
			iniciar: function () { st.habilitada = true; return reintentarYa(); },
			procesar: reintentarYa,
			lista: function () { return listo.then(propios); },
			pendientes: function () { return st.n; },
			persistente: function () { return !!(st.almacen && st.almacen.persistente); },
			estado: function () { return st.estado; },
			vacia: function () {
				return listo.then(propios).then(function (l) {
					if (!l.length) return;
					return new Promise(function (r) { st.esperandoVacia.push(r); });
				});
			},
			// "ok" cuando todo llegó a la base; si antes queda atorada (sin red, error del servidor,
			// sin sesión u otra cuenta), ese estado: quien espera no se queda colgado
			esperarEnvio: function () {
				return listo.then(propios).then(function (l) {
					if (!l.length) return "ok";
					if (FALLAS.indexOf(st.estado) !== -1) return st.estado;
					return new Promise(function (r) { st.esperandoEnvio.push(r); });
				});
			},
			_estado: st,
		};
	}

	// ── Cerrar sesión con capturas pendientes ────────────────────────────────────
	// La cuenta de la sesión guardada en este dispositivo (sin red): la llave de supabase-js
	function cuentaGuardada(ls) {
		try {
			ls = ls || (typeof localStorage !== "undefined" ? localStorage : null);
			if (!ls) return null;
			for (var i = 0; i < ls.length; i++) {
				var k = ls.key(i);
				if (!/^sb-[a-z0-9]+-auth-token$/i.test(k || "")) continue;
				var v = JSON.parse(ls.getItem(k) || "null");
				var u = v && (v.user || (v.currentSession && v.currentSession.user));
				if (u && u.id) return u.id;
			}
		} catch (_) {}
		return null;
	}

	// Cuántas capturas de esa cuenta esperan en el dispositivo (sin crear la base si no existe)
	function contarDe(maestroId) {
		return new Promise(function (ok) {
			var hecho = false;
			function fin(n) { if (!hecho) { hecho = true; ok(n); } }
			setTimeout(function () { fin(0); }, 2000);
			try {
				if (typeof indexedDB === "undefined" || !indexedDB) { fin(0); return; }
				var req = indexedDB.open(NOMBRE_BD);
				req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (_) {} };
				req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fin(0); };
				req.onsuccess = function () {
					var db = req.result;
					try {
						if (!db.objectStoreNames.contains(ALMACEN)) { db.close(); fin(0); return; }
						var g = db.transaction(ALMACEN, "readonly").objectStore(ALMACEN).getAll();
						g.onsuccess = function () {
							db.close();
							fin((g.result || []).filter(function (it) { return !maestroId || it.maestro_id === maestroId; }).length);
						};
						g.onerror = function () { db.close(); fin(0); };
					} catch (_) { try { db.close(); } catch (__) {} fin(0); }
				};
			} catch (_) { fin(0); }
		});
	}

	/*
		Antes de cerrar sesión: si la cuenta tiene capturas sin enviar en este dispositivo, se
		avisa y se pide confirmar. Se quedan guardadas; se envían cuando ella vuelva a entrar
		en este dispositivo y abra Hoy. → true: se puede cerrar la sesión.
	*/
	async function confirmarSalida(sb) {
		var id = cuentaGuardada();
		if (!id && sb && sb.auth && sb.auth.getSession) {
			try {
				var r = await sb.auth.getSession();
				id = r && r.data && r.data.session ? r.data.session.user.id : null;
			} catch (_) {}
		}
		if (!id) return true;
		var n = await contarDe(id);
		if (!n) return true;
		return window.confirm((n === 1
			? "Tienes 1 captura de Hoy sin enviar. Se queda guardada en este dispositivo y se enviará"
			: "Tienes " + n + " capturas de Hoy sin enviar. Se quedan guardadas en este dispositivo y se enviarán") +
			" cuando vuelvas a entrar en él y abras Hoy.\n\n¿Cerrar sesión de todos modos?");
	}

	return {
		clave: clave,
		tipoDeFallo: tipoDeFallo,
		explicar: explicar,
		valorDeFila: valorDeFila,
		valorDeseado: valorDeseado,
		igual: igual,
		describir: describir,
		almacenMemoria: almacenMemoria,
		abrirAlmacen: abrirAlmacen,
		crear: crear,
		cuentaGuardada: cuentaGuardada,
		contarDe: contarDe,
		confirmarSalida: confirmarSalida,
	};
})();
if (typeof window !== "undefined") window.BandejaSalida = BandejaSalida;
if (typeof module !== "undefined" && module.exports) module.exports = BandejaSalida; // pruebas en node
