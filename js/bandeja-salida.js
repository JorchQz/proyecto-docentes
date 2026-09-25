/*
	bandeja-salida.js — La cola de guardado de "Hoy" vive en el dispositivo (fase 2.5 de
	docs/PWA-MI-SALON.md).

	Antes la cola de js/hoy.js vivía solo en memoria: si la app se cerraba, se recargaba o iOS
	la descargaba sin red, lo pendiente se perdía. Ahora cada captura se guarda PRIMERO aquí
	(IndexedDB "jissez-bandeja", almacén "pendientes") y después se envía en serie. Se borra
	solo cuando la base la confirmó. Si no hay IndexedDB (o falla), la cola sigue en memoria,
	como antes, y la página lo dice.

	Cada captura es un dato serializable:
		{ clave, tipo, maestro_id, seq, capturado_en, datos, descripcion }
	  tipo "asistencia"      datos { grupo_id, alumno_id, fecha, estado }
	  tipo "registro"        datos { alumno_id, fecha, participacion, conducta }   (cierre del día)
	  tipo "registro_borrar" datos { alumno_id, fecha }                            (se retira el cierre)
	  tipo "calificacion"    datos { id?, fecha, fila }  (fila: la de calificaciones, sin evaluado_en)

	Reglas:
	  - Una sola captura por llave (alumno + fecha, alumno + producto): la más reciente del
	    dispositivo reemplaza a la anterior. Si una versión vieja estaba en camino, al volver no
	    borra la nueva (se compara `seq`).
	  - Escrituras idempotentes: asistencia y cierre, upsert por su llave natural; retirar el
	    cierre, borrado por llave; calificación, "gana la captura más reciente": evaluado_en =
	    capturado_en y el update solo aplica si en la base no hay algo más nuevo
	    (evaluado_en <= capturado_en). Si el insert choca con el índice único, se adopta la fila
	    existente. Reenviar la misma captura no duplica nada. Sin cambios de esquema.
	  - Solo se reintenta lo que es de red (sin respuesta, 408, 429, 5xx), con espera creciente,
	    al volver la red (online), al volver a primer plano y al abrir la página. Sesión
	    vencida (401/JWT): se refresca la sesión y se reintenta; si ya no hay sesión, se espera
	    (nada se borra). Cualquier otra respuesta del servidor (400, 403, 404, 409, un CHECK o un
	    trigger que rechaza) NO se reintenta: se quita de la cola y se avisa con su explicación.
	  - Solo se envían las capturas de la cuenta con sesión (maestro_id). En un equipo
	    compartido, lo de otra maestra se queda en el dispositivo hasta que ella entre.

	Uso (js/hoy.js):
		var b = BandejaSalida.crear({ sb, auth, maestroId, alCambiar, alGuardar, alRechazar, alSuperar });
		b.agregar("asistencia", datos, "Asistencia de Ana");
		b.iniciar();            // habilita el envío (después de pintar lo pendiente)
		b.lista() → Promise<[capturas propias pendientes]>
		b.pendientes(), b.persistente(), b.vacia() → Promise
*/
var BandejaSalida = (function () {
	var NOMBRE_BD = "jissez-bandeja";
	var ALMACEN = "pendientes";

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

	// Explicación para la maestra de por qué la base no aceptó una captura
	function explicar(e) {
		var code = e && e.code ? String(e.code) : "";
		var status = e && e.status;
		if (code === "42501" || status === 403) return "la base no lo permitió (el alumno, el grupo o el producto ya no es de esta cuenta)";
		if (code === "23503") return "el alumno, la sesión o el producto ya no existe";
		if (code === "23514" || code === "22P02" || code === "22003" || code === "23502") return "un valor capturado no es válido";
		if (code === "P0001" && e.message) return e.message;
		return "la base lo rechazó" + (e && e.message ? " (" + e.message + ")" : "");
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

	// ── Envíos (uno por tipo) ────────────────────────────────────────────────────
	async function enviarAsistencia(sb, it) {
		var d = it.datos;
		var res = await sb.from("asistencias").upsert({
			maestro_id: it.maestro_id, grupo_id: d.grupo_id, alumno_id: d.alumno_id,
			fecha: d.fecha, asistencia_estado: d.estado,
		}, { onConflict: "grupo_id,alumno_id,fecha" });
		if (res.error) throw fallo(res);
		return {};
	}

	// Varias filas del cierre del día en un solo upsert
	async function enviarRegistros(sb, lote) {
		var filas = lote.map(function (it) {
			return {
				maestro_id: it.maestro_id, alumno_id: it.datos.alumno_id, fecha: it.datos.fecha,
				participacion: it.datos.participacion, conducta: it.datos.conducta,
			};
		});
		var res = await sb.from("registro_diario").upsert(filas, { onConflict: "maestro_id,alumno_id,fecha" });
		if (res.error) throw fallo(res);
		return {};
	}

	async function borrarRegistro(sb, it) {
		var res = await sb.from("registro_diario").delete()
			.eq("maestro_id", it.maestro_id).eq("alumno_id", it.datos.alumno_id).eq("fecha", it.datos.fecha);
		if (res.error) throw fallo(res);
		return {};
	}

	/*
		Una calificación por (maestro, alumno, producto): el índice único es parcial, así que no
		hay upsert por conflicto. Sin id conocido se inserta (con la fecha del día de la
		captura); si ya existía (23505), se adopta. Con id, update condicionado a que en la base
		no haya una captura más reciente. Si no aplicó: o hay algo más nuevo (se conserva y se
		avisa) o la fila ya no existe (se vuelve a insertar, una vez).
	*/
	async function enviarCalificacion(sb, it, reintento) {
		var d = it.datos;
		var fila = Object.assign({}, d.fila, { maestro_id: it.maestro_id, evaluado_en: it.capturado_en });
		var id = d.id || null;
		if (!id) {
			var ins = await sb.from("calificaciones").insert(Object.assign({ fecha: d.fecha }, fila)).select("id").single();
			if (!ins.error) return { id: ins.data.id };
			if (ins.error.code !== "23505") throw fallo(ins);
			var prev = await sb.from("calificaciones").select("id")
				.eq("maestro_id", it.maestro_id).eq("alumno_id", fila.alumno_id)
				.eq("producto_sesion_id", fila.producto_sesion_id).maybeSingle();
			if (prev.error) throw fallo(prev);
			if (!prev.data) throw fallo({ status: null, error: { message: "La calificación existe pero no se pudo leer" } });
			id = prev.data.id;
		}
		var upd = await sb.from("calificaciones").update(fila).eq("id", id)
			.or("evaluado_en.is.null,evaluado_en.lte." + it.capturado_en)
			.select("id");
		if (upd.error) throw fallo(upd);
		if (upd.data && upd.data.length) return { id: id };
		var ver = await sb.from("calificaciones").select("id").eq("id", id).maybeSingle();
		if (ver.error) throw fallo(ver);
		if (ver.data) return { id: id, superada: true };
		if (reintento) throw fallo({ status: null, error: { message: "La calificación no se pudo guardar" } });
		return enviarCalificacion(sb, Object.assign({}, it, { datos: Object.assign({}, d, { id: null }) }), true);
	}

	var ENVIAR = {
		asistencia: enviarAsistencia,
		registro: function (sb, it) { return enviarRegistros(sb, [it]); },
		registro_borrar: borrarRegistro,
		calificacion: function (sb, it) { return enviarCalificacion(sb, it, false); },
	};

	// ── Almacenes ────────────────────────────────────────────────────────────────
	// En memoria: sin IndexedDB, y en las pruebas (el mismo objeto simula "recargar")
	function almacenMemoria() {
		var mapa = {};
		return {
			persistente: false,
			todos: function () { return Promise.resolve(Object.keys(mapa).map(function (k) { return mapa[k]; })); },
			poner: function (it) { mapa[it.clave] = it; return Promise.resolve(); },
			quitarSi: function (c, seq) {
				if (mapa[c] && mapa[c].seq === seq) delete mapa[c];
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

	/*
		crear(o)
		  o.sb          cliente de Supabase (window.sb)
		  o.auth        auth para refrescar la sesión (Lectura.authDirecto: sin detener la página)
		  o.maestroId   la cuenta con sesión
		  o.almacen     (pruebas) un almacén ya abierto; si no, IndexedDB o memoria
		  o.alCambiar({ pendientes, estado: "ok"|"enviando"|"red"|"sesion", persistente })
		  o.alGuardar(captura, { id?, superada? })   se confirmó
		  o.alRechazar(captura, explicacion)        la base no la aceptó: ya salió de la cola
		  o.alSuperar(captura)                      había una captura más reciente: se conservó esa
		  o.esperaMax   tope de la espera entre reintentos (ms; 30 s)
	*/
	function crear(o) {
		var st = {
			almacen: null, habilitada: false, procesando: false, otraVez: false,
			espera: null, intentos: 0, estado: "ok", n: 0, unoPorUno: false, esperandoVacia: [],
		};
		var listo = (o.almacen ? Promise.resolve(o.almacen) : abrirAlmacen()).then(function (a) { st.almacen = a; return a; });
		var esperaMax = o.esperaMax || 30000;

		function avisar() {
			if (o.alCambiar) {
				try {
					o.alCambiar({ pendientes: st.n, estado: st.estado, persistente: !!(st.almacen && st.almacen.persistente) });
				} catch (_) {}
			}
			if (!st.n) st.esperandoVacia.splice(0).forEach(function (r) { r(); });
		}

		function propios() {
			return st.almacen.todos().then(function (lista) {
				var mias = lista.filter(function (it) { return it.maestro_id === o.maestroId; })
					.sort(function (a, b) { return a.seq - b.seq; });
				st.n = mias.length;
				return mias;
			});
		}

		function agregar(tipo, datos, descripcion) {
			// El momento y el orden son los del toque, no los de la escritura
			var it = {
				clave: clave(tipo, o.maestroId, datos), tipo: tipo, maestro_id: o.maestroId,
				seq: siguienteSeq(), capturado_en: new Date().toISOString(),
				datos: datos, descripcion: descripcion || "",
			};
			return listo.then(function () { return st.almacen.poner(it); })
				.then(function () { return propios(); })
				.then(function () { avisar(); procesar(); return it; });
		}

		function programar() {
			if (st.espera) return;
			var ms = Math.min(esperaMax, 1000 * Math.pow(2, Math.max(0, st.intentos - 1)));
			st.espera = setTimeout(function () { st.espera = null; procesar(); }, ms);
		}

		async function refrescarSesion() {
			try {
				var auth = o.auth || (o.sb && o.sb.auth);
				var r = auth ? await auth.getSession() : null;
				var s = r && r.data ? r.data.session : null;
				return !!(s && s.user && s.user.id === o.maestroId);
			} catch (_) {
				return false;
			}
		}

		async function procesar() {
			await listo;
			if (!st.habilitada) return;
			if (st.procesando) { st.otraVez = true; return; }
			st.procesando = true;
			if (st.espera) { clearTimeout(st.espera); st.espera = null; }
			var sesionIntentada = false;
			try {
				for (;;) {
					var lista = await propios();
					if (!lista.length) { st.estado = "ok"; st.intentos = 0; st.unoPorUno = false; break; }
					if (st.estado === "ok") { st.estado = "enviando"; avisar(); }
					var it = lista[0];
					var lote = [it];
					if (it.tipo === "registro" && !st.unoPorUno) {
						lote = lista.filter(function (x) { return x.tipo === "registro"; }).slice(0, 100);
					}
					try {
						var r = lote.length > 1 ? await enviarRegistros(o.sb, lote) : await ENVIAR[it.tipo](o.sb, it);
						for (var i = 0; i < lote.length; i++) await st.almacen.quitarSi(lote[i].clave, lote[i].seq);
						st.intentos = 0;
						st.estado = "enviando";
						lote.forEach(function (x) {
							if (r && r.superada && o.alSuperar) { try { o.alSuperar(x); } catch (_) {} }
							if (o.alGuardar) { try { o.alGuardar(x, r || {}); } catch (_) {} }
						});
					} catch (e) {
						var tipo = tipoDeFallo(e);
						if (tipo === "rechazo") {
							if (lote.length > 1) { st.unoPorUno = true; continue; } // ¿cuál fue? de una en una
							await st.almacen.quitarSi(it.clave, it.seq);
							if (typeof console !== "undefined") console.warn("bandeja: la base rechazó una captura", it.descripcion, e);
							if (o.alRechazar) { try { o.alRechazar(it, explicar(e)); } catch (_) {} }
							continue;
						}
						if (tipo === "sesion" && !sesionIntentada) {
							sesionIntentada = true;
							if (await refrescarSesion()) continue;
						}
						if (tipo === "sesion") {
							// Sin sesión válida no se reintenta solo: se espera a que vuelva a entrar
							st.estado = "sesion";
							break;
						}
						st.intentos++;
						st.estado = "red";
						programar();
						break;
					}
				}
			} finally {
				st.procesando = false;
				avisar();
				if (st.otraVez) {
					st.otraVez = false;
					if (st.estado !== "red" || !st.espera) procesar();
				}
			}
		}

		// Reenvío inmediato: volvió la red, la página volvió a primer plano o se abrió
		function reintentarYa() {
			if (st.estado === "red" || st.estado === "sesion") st.estado = "ok";
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
			_estado: st,
		};
	}

	return {
		clave: clave,
		tipoDeFallo: tipoDeFallo,
		explicar: explicar,
		almacenMemoria: almacenMemoria,
		abrirAlmacen: abrirAlmacen,
		crear: crear,
	};
})();
if (typeof window !== "undefined") window.BandejaSalida = BandejaSalida;
if (typeof module !== "undefined" && module.exports) module.exports = BandejaSalida; // pruebas en node
