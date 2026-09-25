/*
	hoy.js — Pantalla "Hoy" (Parte B, §B.1): el orden del día del maestro en una sola
	pantalla con scroll. Lo que ya revisa de todos modos se captura al toque y alimenta
	solo la boleta (el cálculo vive en js/motor-calificacion.js).

		1. Asistencia            → asistencias (presente / ausente / justificada)
		2. Tareas por revisar    → calificaciones de productos tipo 'tarea' vencidos
		3. Sesiones de hoy       → calificaciones de los productos de cada sesión del día
		4. Cierre del día        → registro_diario (participación y conducta 0 · 1 · 2)

	Reglas que esta pantalla respeta:
	  - La unidad de captura es el PRODUCTO de la sesión, no la actividad.
	  - El semáforo es lo visible; el puntaje 0-10 es un ajuste fino opcional.
	  - Participación y conducta se capturan UNA vez al día y son globales: el reparto
	    a los campos formativos lo hace el motor con las sesiones de ese día (§B.4).
	  - Multigrado: un alumno solo ve los productos cuyos `grados` incluyen el suyo.
	  - Todo se guarda al toque, sin botón "guardar": UI optimista + cola con reintento.
*/

document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { window.location.href = "index.html"; return; }

	// ── Estado ────────────────────────────────────────────────────────────────
	var user = null, grupo = null, alumnos = [];
	var hoy = getLocalDateISO();
	var asistencia = {};      // alumno_id -> estado
	var registro = {};        // alumno_id -> {participacion, conducta}
	var registroGuardado = {}; // alumno_id -> true si ya hay fila de hoy en registro_diario
	var calificaciones = {};  // alumno_id|producto_id -> fila de calificaciones
	var tareas = [], sesionesHoy = [], productosPorSesion = {};
	var siguientes = [];       // próximas sesiones sin fecha del proyecto activo (para "Trabajar hoy")
	var detallesAbiertos = {}; // qué paneles de detalle quedan abiertos entre renders
	// Lo que esta pantalla sabe que hay en la BASE, por llave de la bandeja: { marcas, valor }
	// (la marca de cada grupo de campos y el contenido) o null = no hay fila. Cada captura lo
	// lleva como "la versión que vio" (js/bandeja-salida.js); se actualiza al confirmar (aquí o en
	// otra ventana de este aparato), en un conflicto y tras un rechazo.
	var enBase = {};
	/*
		Ninguna lectura tardía pisa una versión más nueva: cada vez que llega una versión por la
		bandeja (confirmación, conflicto, rechazo u otra ventana) se numera; una lectura de la
		carga anota el número al salir y, al llegar, no toca las llaves que recibieron una versión
		después (esa versión, y lo que muestra, se quedan).
	*/
	var numeroVista = 0;      // cuántas versiones han llegado por la bandeja
	var vistaNumero = {};     // llave -> número de la última versión que llegó por la bandeja
	function ponerBase(clave, base) {
		enBase[clave] = base;
		vistaNumero[clave] = ++numeroVista;
	}
	function llegoDespues(clave, desde) { return (vistaNumero[clave] || 0) > desde; }
	var pintado = false; // ya se dibujaron las secciones (los avisos de la bandeja pueden repintar)

	var NIVELES = [
		{ valor: "logrado",        etiqueta: "Logrado",        activo: "bg-emerald-500 text-white" },
		{ valor: "en_proceso",     etiqueta: "En proceso",     activo: "bg-amber-400 text-white" },
		{ valor: "requiere_apoyo", etiqueta: "Requiere apoyo", activo: "bg-red-500 text-white" },
	];
	var ENTREGA_TAREA = [
		{ valor: "entregado",    etiqueta: "Entregó",     activo: "bg-emerald-500 text-white" },
		{ valor: "incompleto",   etiqueta: "Incompleta",  activo: "bg-amber-400 text-white" },
		{ valor: "no_entregado", etiqueta: "No entregó",  activo: "bg-red-500 text-white" },
		{ valor: "justificado",  etiqueta: "Justificada", activo: "bg-blue-500 text-white" },
	];
	var ASISTENCIA = [
		{ valor: "presente",    etiqueta: "Presente",    activo: "bg-emerald-500 text-white" },
		{ valor: "ausente",     etiqueta: "Falta",       activo: "bg-red-500 text-white" },
		{ valor: "justificada", etiqueta: "Justificada", activo: "bg-blue-500 text-white" },
	];
	var RETRO_RAPIDA = ["Excelente trabajo", "Incompleto", "Mejorar letra", "Revisar ortografía", "No trajo material"];

	function getLocalDateISO() {
		var ahora = new Date();
		var local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
		return local.toISOString().slice(0, 10);
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function mensaje(tipo, texto) {
		var el = document.getElementById("hoyMensaje");
		if (!el) return;
		if (!texto) { el.classList.add("hidden"); return; }
		el.className = "rounded-xl px-4 py-3 text-sm " +
			(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200"
			                  : "bg-blue-50 text-blue-800 border border-blue-200");
		el.textContent = texto;
		el.classList.remove("hidden");
	}

	function vacio(texto) {
		return "<p class='text-sm text-gray-400 py-2'>" + esc(texto) + "</p>";
	}

	/*
		Cola de guardado: la UI no espera a la red. Cada captura se guarda PRIMERO en este
		dispositivo (js/bandeja-salida.js, IndexedDB) y se envía en serie; si la app se cierra
		o se recarga sin red, lo pendiente sigue ahí y se reenvía al volver la red, al volver a
		primer plano o al abrir Hoy (fase 2.5 de docs/PWA-MI-SALON.md). Solo se reintenta lo
		que es de red; lo que la base rechaza se avisa y sale de la cola.
		Sin IndexedDB, la cola vive en memoria como antes y cerrar la página pregunta.
	*/
	var bandeja = null;
	var huboPendientes = false;
	// Lo que la base no aceptó (o ya tenía algo más nuevo), para la maestra: un renglón por
	// dato ({ clave, texto }); un aviso nuevo del mismo dato reemplaza al anterior
	var avisosBandeja = [];

	/*
		Pila fija abajo (a la vista donde esté la maestra, también en el Cierre del día): el
		estado de la cola y el aviso de lo que no se guardó, uno sobre otro, sin encimarse.
	*/
	function pilaFija() {
		if (typeof document.createElement !== "function" || !document.body) return null;
		var pila = document.getElementById("hoyAvisosFijos");
		if (pila && pila.appendChild) return pila;
		pila = document.createElement("div");
		pila.id = "hoyAvisosFijos";
		pila.className = "fixed inset-x-4 bottom-4 z-40 flex flex-col items-center gap-2 pointer-events-none";
		document.body.appendChild(pila);
		var pastilla = document.getElementById("hoyEstadoGuardado");
		if (pastilla && pastilla.parentNode) pila.appendChild(pastilla);
		return pila;
	}

	function estadoGuardado(texto, tipo) {
		var el = document.getElementById("hoyEstadoGuardado");
		if (!el) return;
		if (!texto) { el.classList.add("hidden"); return; }
		var enPila = !!(el.parentNode && el.parentNode.id === "hoyAvisosFijos");
		el.className = (enPila ? "pointer-events-auto max-w-full " : "fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100%-2rem)] ") +
			"text-center rounded-2xl px-4 py-2 text-sm font-medium shadow-lg " +
			(tipo === "error" ? "bg-red-600 text-white"
			 : tipo === "ok"  ? "bg-emerald-600 text-white" : "bg-gray-800 text-white");
		el.textContent = texto;
		el.classList.remove("hidden");
		if (tipo === "ok") setTimeout(function () { if (!(bandeja && bandeja.pendientes())) el.classList.add("hidden"); }, 1500);
	}

	// El aviso visible de la cola: "N capturas pendientes de enviar" mientras haya algo;
	// "Todo guardado" cuando se vacía
	function pintarBandeja(e) {
		if (!e.pendientes) {
			// Si algo no se guardó, lo dice el aviso de arriba: no se anuncia "Todo guardado"
			if (huboPendientes) {
				if (avisosBandeja.length) estadoGuardado("");
				else estadoGuardado("Todo guardado", "ok");
			}
			huboPendientes = false;
			return;
		}
		huboPendientes = true;
		var n = e.pendientes + (e.pendientes === 1 ? " captura pendiente de enviar" : " capturas pendientes de enviar");
		var resguardo = e.persistente
			? (e.pendientes === 1 ? ", guardada en este dispositivo." : ", guardadas en este dispositivo.")
			: ". No cierres esta página.";
		if (e.estado === "red") {
			estadoGuardado("Sin señal: " + n + resguardo, "error");
		} else if (e.estado === "servidor") {
			// Hubo respuesta (un error del servidor): no es falta de señal
			estadoGuardado("No se pudo guardar por ahora; se reintentará. " + n.charAt(0).toUpperCase() + n.slice(1) + resguardo, "error");
		} else if (e.estado === "cuenta") {
			estadoGuardado("En este dispositivo entró otra cuenta. " + (e.pendientes === 1
				? "1 captura pendiente de la cuenta anterior sigue guardada aquí y se enviará"
				: e.pendientes + " capturas pendientes de la cuenta anterior siguen guardadas aquí y se enviarán") +
				" cuando ella vuelva a entrar y abra Hoy.", "error");
		} else if (e.estado === "sesion") {
			estadoGuardado("Tu sesión se cerró: " + n + ". Siguen en este dispositivo; vuelve a iniciar sesión para enviarlas.", "error");
		} else {
			estadoGuardado(n, "info");
		}
	}

	// Lo que no se guardó, con su explicación (la captura ya salió de la cola): en la lista de
	// arriba y en el aviso fijo de abajo
	function avisarBandeja(clave, texto) {
		avisosBandeja = avisosBandeja.filter(function (a) { return a.clave !== clave; }).concat([{ clave: clave, texto: texto }]);
		pintarAvisosBandeja();
		avisoFijo();
	}

	function cerrarAvisos() {
		avisosBandeja = [];
		var el = document.getElementById("hoyMensaje");
		if (el) { el.textContent = ""; el.classList.add("hidden"); }
		var fijo = document.getElementById("hoyAvisoFijo");
		if (fijo && fijo.parentNode) fijo.parentNode.removeChild(fijo);
	}

	// El aviso fijo (role="alert": un lector de pantalla lo anuncia): el último dato que no se
	// guardó, "Ver detalle" (lleva a la lista de arriba) y "Cerrar"
	function avisoFijo() {
		var pila = pilaFija();
		if (!pila || !avisosBandeja.length) return;
		var viejo = document.getElementById("hoyAvisoFijo");
		if (viejo && viejo.parentNode) viejo.parentNode.removeChild(viejo);
		var caja = document.createElement("div");
		caja.id = "hoyAvisoFijo";
		caja.setAttribute("role", "alert");
		caja.className = "pointer-events-auto w-full max-w-lg rounded-2xl border border-red-200 bg-white shadow-xl p-4 text-sm text-red-800";
		var n = avisosBandeja.length;
		var titulo = document.createElement("p");
		titulo.className = "font-semibold";
		titulo.textContent = n === 1 ? "Una captura no se guardó" : n + " capturas no se guardaron";
		var ultimo = document.createElement("p");
		ultimo.className = "mt-1";
		ultimo.textContent = avisosBandeja[n - 1].texto + (n > 1 ? " (y " + (n - 1) + " más)." : "");
		var acciones = document.createElement("div");
		acciones.className = "flex flex-wrap gap-2 mt-3";
		var ver = document.createElement("button");
		ver.type = "button";
		ver.className = "min-h-[44px] px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700";
		ver.textContent = "Ver detalle";
		ver.addEventListener("click", function () {
			if (caja.parentNode) caja.parentNode.removeChild(caja);
			var el = document.getElementById("hoyMensaje");
			if (!el || !el.scrollIntoView) return;
			el.style.scrollMarginTop = "8rem"; // la barra de arriba es fija
			el.setAttribute("tabindex", "-1");
			el.scrollIntoView({ block: "start", behavior: "smooth" });
			try { el.focus({ preventScroll: true }); } catch (_) {}
		});
		var cerrar = document.createElement("button");
		cerrar.type = "button";
		cerrar.className = "min-h-[44px] px-4 rounded-lg border border-red-200 bg-white text-sm font-semibold text-red-700 hover:bg-red-50";
		cerrar.textContent = "Cerrar";
		cerrar.addEventListener("click", function () { if (caja.parentNode) caja.parentNode.removeChild(caja); });
		acciones.appendChild(ver);
		acciones.appendChild(cerrar);
		caja.appendChild(titulo);
		caja.appendChild(ultimo);
		caja.appendChild(acciones);
		pila.insertBefore(caja, pila.firstChild);
	}

	function pintarAvisosBandeja() {
		var el = document.getElementById("hoyMensaje");
		if (!el) return;
		el.className = "rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200";
		el.textContent = "";
		var titulo = document.createElement("p");
		titulo.className = "font-semibold mb-1";
		titulo.textContent = "Algunas capturas no se guardaron. En pantalla ya está lo que quedó en la base; si hace falta, vuelve a capturarlas:";
		el.appendChild(titulo);
		var ul = document.createElement("ul");
		ul.className = "list-disc pl-5 flex flex-col gap-1";
		avisosBandeja.forEach(function (a) {
			var li = document.createElement("li");
			li.textContent = a.texto;
			ul.appendChild(li);
		});
		el.appendChild(ul);
		var cerrar = document.createElement("button");
		cerrar.type = "button";
		cerrar.className = "mt-2 min-h-[44px] px-4 rounded-lg border border-red-200 bg-white text-sm font-semibold text-red-700 hover:bg-red-50";
		cerrar.textContent = "Entendido";
		cerrar.addEventListener("click", cerrarAvisos);
		el.appendChild(cerrar);
		el.classList.remove("hidden");
	}

	// Llave de la bandeja y lo que la pantalla sabe que hay en la base para esa llave
	function claveDe(tipo, datos) { return window.BandejaSalida.clave(tipo, user.id, datos); }
	function baseDe(tipo, datos) {
		var v = enBase[claveDe(tipo, datos)];
		return v === undefined ? null : v;
	}

	// opciones: { campos: [los que tocó la maestra] } o { relleno: true } (1 y 1 del cierre)
	function guardar(tipo, datos, descripcion, opciones) {
		if (!bandeja) return;
		bandeja.agregar(tipo, datos, descripcion, baseDe(tipo, datos), opciones).catch(function (e) { console.error("hoy: no se pudo encolar", e); });
	}

	/*
		Tras un conflicto o un rechazo, la pantalla muestra lo que quedó en la base (sin esperar
		a recargar). `v`: el valor de la base (js/bandeja-salida.js, valorDeFila); null = no hay fila.
	*/
	function aplicarValor(it, v, id) {
		// Antes de pintar (la carga sigue) solo se guarda en el estado: la lectura de la carga no
		// lo pisa si esta versión llegó después de que salió (ver ponerBase)
		if (!grupo) return;
		var d = it.datos || {};
		try {
			if (it.tipo === "asistencia") {
				if (d.grupo_id !== grupo.id || d.fecha !== hoy) return;
				if (v && v.estado) asistencia[d.alumno_id] = v.estado; else delete asistencia[d.alumno_id];
				if (!pintado) return;
				renderAsistencia();
				renderCierre();
			} else if (it.tipo === "registro" || it.tipo === "registro_borrar") {
				if (d.fecha !== hoy) return;
				if (v) {
					registro[d.alumno_id] = { participacion: v.participacion, conducta: v.conducta };
					registroGuardado[d.alumno_id] = true;
				} else {
					delete registro[d.alumno_id];
					registroGuardado[d.alumno_id] = false;
				}
				if (!pintado) return;
				renderCierre();
			} else if (it.tipo === "calificacion" && d.fila) {
				var k = d.fila.alumno_id + "|" + d.fila.producto_sesion_id;
				var c = calificaciones[k] || { alumno_id: d.fila.alumno_id, producto_sesion_id: d.fila.producto_sesion_id };
				["estado_entrega", "nivel", "puntaje", "retroalimentacion"].forEach(function (f) { c[f] = v ? v[f] : null; });
				if (id && !c.id) c.id = id;
				calificaciones[k] = c;
				if (!pintado) return;
				renderTareas();
				repintarSesiones();
			}
		} catch (e) {
			console.error("hoy: no se pudo mostrar lo guardado", e);
		}
	}

	// ¿Lo que muestra la pantalla es distinto de `v` (lo que hay en la base)?
	function difiere(it, v) {
		var d = it.datos || {};
		if (it.tipo === "asistencia") return (asistencia[d.alumno_id] || null) !== (v && v.estado ? v.estado : null);
		if (it.tipo === "registro" || it.tipo === "registro_borrar") {
			var r = registroGuardado[d.alumno_id] ? registro[d.alumno_id] : null;
			if (!r || !v) return !r !== !v;
			return r.participacion !== v.participacion || r.conducta !== v.conducta;
		}
		if (it.tipo === "calificacion" && d.fila) {
			var c = calificaciones[d.fila.alumno_id + "|" + d.fila.producto_sesion_id] || {};
			return ["estado_entrega", "nivel", "puntaje", "retroalimentacion"].some(function (f) {
				var a = c[f] === undefined || c[f] === "" ? null : c[f], b = v ? v[f] : null;
				return (a === null ? null : String(a)) !== (b === null || b === undefined ? null : String(b));
			});
		}
		return false;
	}

	function nombreDe(alumnoId) {
		var a = alumnos.find(function (x) { return x.id === alumnoId; });
		return a ? a.nombre_completo : "un alumno";
	}

	// Cerrar o recargar la página con capturas que NO están a salvo en el dispositivo (sin
	// IndexedDB) o con retroalimentación a medio escribir: el navegador pregunta
	window.addEventListener("beforeunload", function (e) {
		var sinResguardo = bandeja && bandeja.pendientes() && !bandeja.persistente();
		if (!sinResguardo && !Object.keys(retroPendiente || {}).length) return;
		e.preventDefault();
		e.returnValue = "";
	});

	// ── Carga inicial ─────────────────────────────────────────────────────────
	var authRes = await window.sb.auth.getUser();
	if (authRes.error || !authRes.data.user) { window.location.href = "index.html"; return; }
	user = authRes.data.user;

	// La bandeja de salida se abre ya: lo que quedó pendiente de otra vez se envía aunque la
	// carga de hoy falle (se habilita el envío al final del arranque, después de pintarlo)
	if (window.BandejaSalida) {
		bandeja = window.BandejaSalida.crear({
			sb: window.sb,
			auth: window.Lectura && window.Lectura.authDirecto ? window.Lectura.authDirecto : null,
			maestroId: user.id,
			alCambiar: pintarBandeja,
			// La base ya tiene lo capturado: es la nueva "versión que vio" esta pantalla
			alGuardar: function (it, r) {
				ponerBase(it.clave, r ? r.base : null);
				if (it.tipo === "calificacion" && r && r.id) {
					var c = calificaciones[it.datos.fila.alumno_id + "|" + it.datos.fila.producto_sesion_id];
					if (c && !c.id) c.id = r.id;
				}
				// Se escriben solo los campos tocados: si la fila trae otros que esta pantalla no
				// tenía (los capturó otra ventana), se muestran
				if (r && !r.sigue && difiere(it, r.fila ? r.valor : null)) aplicarValor(it, r.fila ? r.valor : null, r.id);
			},
			// Otro dispositivo (u otra pantalla) la cambió: se conservó lo de la base y se muestra
			alConflicto: function (it, r) {
				ponerBase(it.clave, r.base);
				if (!r.sigue) aplicarValor(it, r.actual, r.id);
				avisarBandeja(it.clave, r.texto);
			},
			alRechazar: function (it, explicacion, r) {
				if (r && r.base !== undefined) {
					ponerBase(it.clave, r.base);
					if (!r.sigue) aplicarValor(it, r.actual);
				}
				avisarBandeja(it.clave, (it.descripcion || "Una captura") + ": " + explicacion + ".");
			},
			// Otra ventana de Hoy en este aparato (la app y una pestaña) confirmó algo o no pudo:
			// esta pantalla se entera de la versión nueva y la muestra (si no hay algo más nuevo
			// pendiente de ese dato)
			alSaber: function (m) {
				var it = { clave: m.clave, tipo: m.tipoCaptura, datos: m.datos };
				if (!it.datos || !it.tipo) return;
				if (m.base !== undefined) ponerBase(m.clave, m.base);
				// `sigue` lo calculó quien envió, sobre la cola compartida del aparato; sin
				// IndexedDB cada ventana tiene su cola y se mira la propia
				var pendiente = m.sigue || (bandeja && !bandeja.persistente() && bandeja.pendienteDe(m.clave));
				var v = m.base ? m.base.valor : null;
				if (m.base !== undefined && !pendiente && difiere(it, v)) aplicarValor(it, v, m.id);
				if (m.tipo === "aviso" && m.texto) avisarBandeja(m.clave, m.texto);
			},
		});
		pilaFija();
		// Volvió la red, o la app volvió a primer plano: se reenvía lo pendiente
		window.addEventListener("online", function () { bandeja.procesar(); });
		document.addEventListener("visibilitychange", function () {
			if (document.visibilityState === "visible") bandeja.procesar();
		});
		// En la app instalada se pide que el navegador no borre este almacenamiento
		try {
			if (window.AppInstalada && window.AppInstalada.modoApp() && navigator.storage && navigator.storage.persist) {
				navigator.storage.persist().catch(function () {});
			}
		} catch (_) {}
	}

	grupo = (await window.GrupoActivo.cargar(window.sb, user.id)).grupo;
	if (!grupo) { window.location.href = "onboarding.html"; return; }

	var alumnosRes = await window.sb.from("alumnos")
		.select("id, nombre_completo, num_lista, grado, created_at")
		.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("estatus", "activo")
		.order("grado").order("num_lista");
	if (alumnosRes.error) {
		// No es "grupo sin alumnos": no se pudo leer la lista
		console.error("hoy: alumnos", alumnosRes.error);
		mensaje("error", "No se pudo cargar la lista de alumnos: " + (alumnosRes.error.message || "error desconocido") + ". Recarga la página para intentarlo de nuevo.");
		if (bandeja) bandeja.iniciar(); // lo pendiente de otra vez sí se intenta enviar
		return;
	}
	alumnos = alumnosRes.data || [];
	// Fecha de alta de cada alumno (hora de Ciudad de México): js/alcance-hoy.js
	alumnos.forEach(function (a) { a.alta = window.AlcanceHoy.fechaAlta(a.created_at, grupo.created_at); });

	document.getElementById("hoySubtitulo").textContent =
		grupo.nombre + " · " + alumnos.length + " alumno" + (alumnos.length === 1 ? "" : "s");
	document.getElementById("hoyFecha").textContent =
		new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

	if (!alumnos.length) {
		mensaje("info", "Este grupo todavía no tiene alumnos. Agrégalos en Mi grupo.");
		if (bandeja) bandeja.iniciar();
		return;
	}

	// El arranque (cargar + primer render) va al FINAL del archivo, después de que
	// todo el estado está inicializado. Las funciones se izan, las asignaciones de
	// `var` no: arrancar aquí dejaba variables de estado en undefined.

	// La marca de cada grupo de campos (captura_id; captura_participacion y captura_conducta;
	// captura_semaforo, captura_puntaje y captura_retroalimentacion) se lee con cada fila; si la
	// base aún no tiene esas columnas (el frontend se publicó antes que la migración), se lee sin
	// ellas (un 400 en la consola por carga) y la bandeja compara por contenido (js/bandeja-salida.js)
	var conMarca = !(window.BandejaSalida && window.BandejaSalida.marcaDisponible() === false);
	function conCaptura(columnas, tipo) {
		return columnas + (conMarca && window.BandejaSalida ? ", " + window.BandejaSalida.columnasMarca(tipo).join(", ") : "");
	}
	function faltanMarcas(error) {
		if (!(conMarca && window.BandejaSalida && window.BandejaSalida.faltaMarca(error))) return false;
		conMarca = false;
		window.BandejaSalida.marcaDisponible(false);
		return true;
	}
	// Una lectura con las marcas; si faltan las columnas, se repite sin ellas
	async function conMarcas(leer) {
		var res = await leer();
		if (res.error && faltanMarcas(res.error)) res = await leer();
		return res;
	}
	function baseDeFila(tipo, fila) {
		return window.BandejaSalida ? window.BandejaSalida.baseDeFila(tipo, fila) : null;
	}

	/*
		Lo leído de la base se vuelve lo que la pantalla muestra y la versión que vio, salvo en las
		llaves que recibieron una versión por la bandeja DESPUÉS de que salió la lectura (`desde`):
		esa es más nueva y se queda (ya está en la pantalla, ver aplicarValor).
	*/
	function tomarLeido(clave, desde, it, fila, poner) {
		if (!window.BandejaSalida) { poner(); return; }
		if (llegoDespues(clave, desde)) {
			var nueva = enBase[clave];
			aplicarValor(it, nueva ? nueva.valor : null, fila.id);
			return;
		}
		poner();
		enBase[clave] = baseDeFila(it.tipo, fila);
	}

	async function cargarDatosDelDia() {
		// Asistencia y registro diario de hoy
		// error-revisado-en: asisRes.error
		function leerAsistencia() {
			return window.sb.from("asistencias")
				.select(conCaptura("alumno_id, asistencia_estado", "asistencia"))
				.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("fecha", hoy);
		}
		var desdeAsis = numeroVista;
		var asisRes = await conMarcas(leerAsistencia);
		// Toda lectura fallida detiene la carga (ver el arranque): con datos a medias, el
		// cierre del día guardaría 1 y 1 encima de lo capturado y las secciones dirían
		// "nada pendiente"
		if (asisRes.error) throw asisRes.error;
		if (conMarca && window.BandejaSalida) window.BandejaSalida.marcaDisponible(true);
		(asisRes.data || []).forEach(function (a) {
			var d = { grupo_id: grupo.id, alumno_id: a.alumno_id, fecha: hoy };
			tomarLeido(claveDe("asistencia", d), desdeAsis, { tipo: "asistencia", datos: d }, a, function () {
				asistencia[a.alumno_id] = a.asistencia_estado;
			});
		});

		// error-revisado-en: regRes.error
		function leerRegistro() {
			return window.sb.from("registro_diario")
				.select(conCaptura("alumno_id, participacion, conducta", "registro"))
				.eq("maestro_id", user.id).eq("fecha", hoy);
		}
		var desdeReg = numeroVista;
		var regRes = await conMarcas(leerRegistro);
		if (regRes.error) throw regRes.error;
		(regRes.data || []).forEach(function (r) {
			var d = { alumno_id: r.alumno_id, fecha: hoy };
			tomarLeido(claveDe("registro", d), desdeReg, { tipo: "registro", datos: d }, r, function () {
				registro[r.alumno_id] = { participacion: r.participacion, conducta: r.conducta };
				registroGuardado[r.alumno_id] = true;
			});
		});

		// Proyectos del grupo que mira "Hoy" (js/alcance-hoy.js) → sesiones → productos.
		// Incluye los recién terminados: la tarea de su última sesión se revisa aquí.
		var proyRes = await window.sb.from("proyectos").select("id, titulo, estado, trimestre, fecha_final")
			.eq("maestro_id", user.id).eq("grupo_id", grupo.id).or(window.AlcanceHoy.filtro(grupo, hoy));
		if (proyRes.error) throw proyRes.error;
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });
		if (!proyIds.length) return;

		// Sin el tope de 1000 filas de Supabase (js/alcance-hoy.js)
		var sesiones = await window.AlcanceHoy.leerPorLotes(proyIds, function (lote) {
			return window.sb.from("sesiones")
				.select("id, numero_sesion, fecha, campo_formativo, momento, proyecto_id, estado_sesion")
				.in("proyecto_id", lote).order("id");
		});
		var sesionPorId = {};
		sesiones.forEach(function (s) { sesionPorId[s.id] = s; });
		sesionesHoy = sesiones.filter(function (s) { return s.fecha === hoy; })
			.sort(function (a, b) { return (a.numero_sesion || 0) - (b.numero_sesion || 0); });

		/*
			Las sesiones de una planeación no traen fecha: el maestro decide qué trabaja
			cada día (y a veces son dos en un día, o una en dos). Estas son las siguientes
			pendientes del proyecto activo; "Trabajar hoy" les pone la fecha de hoy y así
			entran a la captura, al reparto de participación y a la asistencia del trimestre.
		*/
		var proyectoPorId = {};
		(proyRes.data || []).forEach(function (p) { proyectoPorId[p.id] = p; });
		siguientes = sesiones.filter(function (s) {
			var p = proyectoPorId[s.proyecto_id];
			return !s.fecha && s.estado_sesion !== "completada" && p && p.estado === "activo";
		}).sort(function (a, b) {
			if (a.proyecto_id !== b.proyecto_id) return a.proyecto_id < b.proyecto_id ? -1 : 1;
			return (a.numero_sesion || 0) - (b.numero_sesion || 0);
		}).slice(0, 4).map(function (s) {
			return Object.assign({}, s, { proyectoTitulo: proyectoPorId[s.proyecto_id].titulo });
		});

		if (!sesiones.length) return;
		var productos = await window.AlcanceHoy.leerPorLotes(sesiones.map(function (s) { return s.id; }), function (lote) {
			return window.sb.from("productos_sesion")
				.select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden")
				.in("sesion_id", lote).eq("activo", true)
				.order("orden").order("id");
		});
		productos.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });

		productos.forEach(function (p) {
			p.sesion = sesionPorId[p.sesion_id];
			if (!productosPorSesion[p.sesion_id]) productosPorSesion[p.sesion_id] = [];
			productosPorSesion[p.sesion_id].push(p);
		});

		// Tareas por revisar: vencen hoy o antes (las de días pasados siguen ahí
		// hasta que el maestro las revise)
		tareas = productos.filter(function (p) {
			if (p.tipo !== "tarea") return false;
			var vence = window.AlcanceHoy.venceTarea(p.fecha_entrega, p.sesion && p.sesion.fecha);
			return vence && vence <= hoy;
		}).sort(function (a, b) {
			var fa = window.AlcanceHoy.venceTarea(a.fecha_entrega, a.sesion && a.sesion.fecha) || "";
			var fb = window.AlcanceHoy.venceTarea(b.fecha_entrega, b.sesion && b.sesion.fecha) || "";
			return fa < fb ? 1 : fa > fb ? -1 : 0; // lo más reciente primero
		});

		// Calificaciones ya capturadas de esos productos
		var idsRelevantes = productos.map(function (p) { return p.id; });
		function leerCalificaciones() {
			return window.AlcanceHoy.leerPorLotes(idsRelevantes, function (lote) {
				return window.sb.from("calificaciones")
					.select(conCaptura("id, alumno_id, producto_sesion_id, estado_entrega, nivel, puntaje, retroalimentacion, fecha", "calificacion"))
					.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id");
			});
		}
		var desdeCal = numeroVista;
		var califs;
		try {
			califs = await leerCalificaciones();
		} catch (e) {
			// Sin las columnas de marca se lee otra vez sin ellas; cualquier otro error detiene la carga
			if (!faltanMarcas(e)) throw e;
			califs = await leerCalificaciones();
		}
		califs.forEach(function (c) {
			var k = c.alumno_id + "|" + c.producto_sesion_id;
			tomarLeido(claveDe("calificacion", { fila: c }), desdeCal, { tipo: "calificacion", datos: { fila: c } }, c, function () {
				calificaciones[k] = c;
			});
		});

		// De las vencidas, solo quedan las de hoy y las que tienen algún alumno sin
		// revisar: una tarea de hace dos semanas ya revisada no es trabajo pendiente.
		tareas = tareas.filter(function (t) {
			var vence = window.AlcanceHoy.venceTarea(t.fecha_entrega, t.sesion && t.sesion.fecha);
			if (vence === hoy) return true;
			return alumnosDeProducto(t).some(function (al) {
				return !(calificaciones[al.id + "|" + t.id] || {}).estado_entrega;
			});
		});
	}

	// ── Guardado ──────────────────────────────────────────────────────────────
	// Cada guardado es una captura para la bandeja (js/bandeja-salida.js): asistencia y cierre
	// del día van por su llave natural; la fecha es la del día en que se abrió Hoy. La bandeja
	// solo escribe si la base sigue como la vio esta pantalla (enBase), y solo los campos tocados
	function guardarAsistencia(alumnoId, estado) {
		guardar("asistencia", { grupo_id: grupo.id, alumno_id: alumnoId, fecha: hoy, estado: estado },
			"Asistencia de " + nombreDe(alumnoId), { campos: ["estado"] });
	}

	// campo: "participacion" o "conducta" (lo que tocó la maestra); sin campo, el relleno 1 y 1
	// del cierre, que solo se inserta donde no hay fila (nunca pisa ni avisa). El grupo va para que
	// la bandeja no rellene a quien este aparato marcó con falta en otra ventana
	function guardarRegistro(alumnoId, campo) {
		var v = registro[alumnoId] || { participacion: 1, conducta: 1 };
		registroGuardado[alumnoId] = true;
		guardar("registro", { alumno_id: alumnoId, fecha: hoy, participacion: v.participacion, conducta: v.conducta, grupo_id: grupo.id },
			"Cierre del día de " + nombreDe(alumnoId), campo ? { campos: [campo] } : { relleno: true });
	}

	function faltoHoy(alumnoId) {
		return asistencia[alumnoId] === "ausente" || asistencia[alumnoId] === "justificada";
	}

	/*
		"Todos empiezan en 1; cambia solo las excepciones": el valor normal también se
		GUARDA. Antes solo se guardaba a quien se tocaba y el motor, que ignora los días
		sin registro, calculaba la participación de cada alumno con días distintos. Se
		guardan de una vez (un solo upsert) los que aún no tienen registro hoy, menos los
		que faltaron: ese día no participaron.
	*/
	function completarCierre() {
		// Un relleno por alumno; la bandeja los manda juntos en un insert que no pisa
		alumnos.forEach(function (al) {
			if (registroGuardado[al.id] || faltoHoy(al.id)) return;
			if (!registro[al.id]) registro[al.id] = { participacion: 1, conducta: 1 };
			guardarRegistro(al.id);
		});
	}

	// Si se marca una falta después del cierre, se retira el registro que se puso por
	// defecto (1 y 1); uno que el maestro cambió a mano se deja
	function retirarCierreSiFalto(alumnoId) {
		var v = registro[alumnoId];
		if (!faltoHoy(alumnoId) || !registroGuardado[alumnoId] || !v || v.participacion !== 1 || v.conducta !== 1) return;
		delete registro[alumnoId];
		registroGuardado[alumnoId] = false;
		guardar("registro_borrar", { alumno_id: alumnoId, fecha: hoy }, "Cierre del día de " + nombreDe(alumnoId));
	}

	/*
		Una calificación por (alumno, producto). La bandeja (js/bandeja-salida.js) inserta si
		la pantalla no tenía fila y, si la tenía, actualiza solo si la base sigue con el valor
		que vio esta pantalla; si otro dispositivo la cambió, se conserva lo suyo y se avisa.
		El `tipo` lo pone el trigger calificaciones_tipo_desde_producto copiándolo del
		producto. La fila se arma al capturar: es la foto de ese momento.
	*/
	function guardarCalificacion(alumno, producto, cambios) {
		var clave = alumno.id + "|" + producto.id;
		var actual = calificaciones[clave] || { alumno_id: alumno.id, producto_sesion_id: producto.id };
		Object.keys(cambios).forEach(function (k) { actual[k] = cambios[k]; });
		calificaciones[clave] = actual;

		(function () {
			var fila = {
				maestro_id: user.id, alumno_id: alumno.id, grupo_id: grupo.id,
				producto_sesion_id: producto.id,
				sesion_id: producto.sesion_id,
				proyecto_id: producto.sesion ? producto.sesion.proyecto_id : null,
				tipo: producto.tipo,
				descripcion: producto.nombre,
				grado: alumno.grado,
				campo_formativo: window.CamposFormativos ? window.CamposFormativos.largo(producto.campo) : null,
				estado_entrega: actual.estado_entrega || null,
				// entrego (columna vieja) debe decir lo mismo que el estado; su default era true
				entrego: actual.estado_entrega === "entregado" || actual.estado_entrega === "incompleto",
				nivel: actual.nivel || null,
				puntaje: actual.puntaje === undefined ? null : actual.puntaje,
				retroalimentacion: actual.retroalimentacion || null,
			};
			// La fecha es la del día en que se capturó por primera vez (solo va en el insert):
			// revisar hoy una tarea de la semana pasada no la mueve (evaluado_en guarda el
			// momento del último cambio; es informativo, no decide quién gana)
			guardar("calificacion", { id: actual.id || null, fecha: hoy, fila: fila },
				"Calificación de " + alumno.nombre_completo + " en " + (producto.nombre || "un producto"),
				{ campos: Object.keys(cambios) });
		})();
	}

	// ── Piezas de UI ──────────────────────────────────────────────────────────
	function chip(texto, activo, clasesActivo, atributos) {
		return "<button type='button' " + atributos + " class='min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors " +
			(activo ? clasesActivo : "bg-gray-100 text-gray-600 hover:bg-gray-200") + "'>" + esc(texto) + "</button>";
	}

	function filaAlumno(alumno, controles) {
		return "<div class='flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-gray-100 last:border-0'>" +
			"<div class='sm:w-56 shrink-0'>" +
			"<span class='text-sm font-medium text-gray-800'>" + esc(alumno.nombre_completo) + "</span>" +
			"<span class='text-xs text-gray-400 ml-2'>" + (alumno.num_lista || "") + " · " + alumno.grado + "°</span>" +
			"</div><div class='flex flex-wrap gap-2'>" + controles + "</div></div>";
	}

	/*
		A quién le toca un producto: a los alumnos de sus grados, y solo si el producto es
		desde su alta (un alumno que llegó después no ve como pendientes las tareas de
		antes). La regla es la de js/alcance-hoy.js, la misma de Inicio, Tareas y el motor.
	*/
	function alumnosDeProducto(producto) {
		var grados = (producto.grados || []).map(Number);
		var fecha = window.AlcanceHoy.fechaProducto(producto.sesion && producto.sesion.fecha, producto.fecha_entrega);
		return alumnos.filter(function (a) {
			if (grados.indexOf(a.grado) === -1) return false;
			return window.AlcanceHoy.cuentaDesdeAlta(a.alta, fecha, calificaciones[a.id + "|" + producto.id]);
		});
	}

	function agruparPorGrado(lista) {
		var grupos = {};
		lista.forEach(function (a) { (grupos[a.grado] = grupos[a.grado] || []).push(a); });
		return Object.keys(grupos).sort().map(function (g) { return { grado: g, alumnos: grupos[g] }; });
	}

	// ── 1. Asistencia ─────────────────────────────────────────────────────────
	function renderAsistencia() {
		var cont = document.getElementById("asistenciaLista");
		cont.innerHTML = alumnos.map(function (al) {
			var controles = ASISTENCIA.map(function (op) {
				return chip(op.etiqueta, asistencia[al.id] === op.valor, op.activo,
					"data-asistencia='" + al.id + "' data-valor='" + op.valor + "'");
			}).join("");
			return filaAlumno(al, controles);
		}).join("");
		resumenAsistencia();
	}

	function resumenAsistencia() {
		var capturados = alumnos.filter(function (a) { return asistencia[a.id]; }).length;
		document.getElementById("asistenciaResumen").textContent = capturados + " de " + alumnos.length + " capturados";
	}

	document.getElementById("asistenciaLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-asistencia]");
		if (!btn) return;
		var alumnoId = btn.dataset.asistencia;
		asistencia[alumnoId] = btn.dataset.valor;
		guardarAsistencia(alumnoId, btn.dataset.valor);
		retirarCierreSiFalto(alumnoId);
		renderAsistencia();
		renderCierre();
	});

	// "2026-09-14" → "14 sep" (como lo lee el maestro, no en formato ISO)
	function fechaCorta(iso) {
		var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return iso || "";
		return Number(m[3]) + " " + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m[2]) - 1];
	}

	// ── 2. Tareas por revisar ─────────────────────────────────────────────────
	function renderTareas() {
		var cont = document.getElementById("tareasLista");
		if (!tareas.length) {
			cont.innerHTML = vacio("No hay tareas por revisar. Las tareas aparecen aquí el día que vencen.");
			document.getElementById("tareasResumen").textContent = "";
			return;
		}
		cont.innerHTML = tareas.map(function (t) {
			var vence = window.AlcanceHoy.venceTarea(t.fecha_entrega, t.sesion && t.sesion.fecha);
			var atrasada = vence && vence < hoy;
			var filas = agruparPorGrado(alumnosDeProducto(t)).map(function (g) {
				var encabezado = (t.grados || []).length > 1
					? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
				return encabezado + g.alumnos.map(function (al) {
					var cal = calificaciones[al.id + "|" + t.id] || {};
					var controles = ENTREGA_TAREA.map(function (op) {
						return chip(op.etiqueta, cal.estado_entrega === op.valor, op.activo,
							"data-tarea='" + t.id + "' data-alumno='" + al.id + "' data-valor='" + op.valor + "'");
					}).join("");
					return filaAlumno(al, controles);
				}).join("");
			}).join("");
			return "<div>" +
				"<div class='flex items-center justify-between gap-2 mb-1'>" +
				"<p class='font-semibold text-gray-800 text-sm'>" + esc(t.nombre) + "</p>" +
				(atrasada ? "<span class='text-xs text-amber-600 shrink-0'>vencía el " + esc(fechaCorta(vence)) + "</span>" : "") +
				"</div>" + filas + "</div>";
		}).join("");
		var pendientesTareas = 0;
		tareas.forEach(function (t) {
			alumnosDeProducto(t).forEach(function (al) {
				if (!(calificaciones[al.id + "|" + t.id] || {}).estado_entrega) pendientesTareas++;
			});
		});
		document.getElementById("tareasResumen").textContent = pendientesTareas
			? pendientesTareas + (pendientesTareas === 1 ? " alumno sin revisar" : " alumnos sin revisar") : "todas revisadas";
	}

	document.getElementById("tareasLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-tarea]");
		if (!btn) return;
		var producto = tareas.find(function (t) { return t.id === btn.dataset.tarea; });
		var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
		if (!producto || !alumno) return;
		var clave = alumno.id + "|" + producto.id;
		var actualEstado = (calificaciones[clave] || {}).estado_entrega;
		var nuevo = actualEstado === btn.dataset.valor ? null : btn.dataset.valor;
		// Entregada sin más detalle = trabajo cumplido; el nivel fino se pone en la sesión
		guardarCalificacion(alumno, producto, {
			estado_entrega: nuevo,
			nivel: nuevo === "entregado" ? ((calificaciones[clave] || {}).nivel || "logrado") : null,
		});
		renderTareas();
	});

	// ── 3. Sesiones de hoy ────────────────────────────────────────────────────
	// Bloque "Trabajar hoy": las siguientes sesiones pendientes del proyecto activo
	function bloqueSiguientes() {
		if (!siguientes.length) {
			return sesionesHoy.length ? "" : vacio("No hay sesiones pendientes en el proyecto activo. Inicia un proyecto desde Proyectos.");
		}
		return "<div class='rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-3'>" +
			"<p class='text-sm font-semibold text-gray-800 mb-1'>" +
			(sesionesHoy.length ? "¿Trabajarás otra sesión hoy?" : "¿Qué sesión trabajas hoy?") + "</p>" +
			"<p class='text-xs text-gray-500 mb-2'>Las sesiones de tu planeación no traen fecha: elige la que vas a trabajar y sus productos aparecen aquí para calificarlos.</p>" +
			"<div class='flex flex-col gap-2'>" +
			siguientes.map(function (s) {
				return "<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg bg-white border border-gray-200 px-3 py-2'>" +
					"<span class='text-sm text-gray-700'>Sesión " + (s.numero_sesion || "") + " · " + esc(s.campo_formativo || "") +
					"<span class='block text-xs text-gray-400'>" + esc(s.proyectoTitulo || "") + "</span></span>" +
					"<button type='button' data-trabajar-hoy='" + s.id + "' class='min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shrink-0'>Trabajar hoy</button>" +
					"</div>";
			}).join("") +
			"</div></div>";
	}

	function sesionTieneCalificaciones(sesionId) {
		return (productosPorSesion[sesionId] || []).some(function (p) {
			return alumnos.some(function (al) {
				var c = calificaciones[al.id + "|" + p.id];
				return c && (c.nivel || c.estado_entrega || c.puntaje !== null && c.puntaje !== undefined);
			});
		});
	}

	function renderSesiones() {
		var cont = document.getElementById("sesionesLista");
		if (!sesionesHoy.length) {
			cont.innerHTML = bloqueSiguientes();
			document.getElementById("sesionesResumen").textContent = "";
			return;
		}
		cont.innerHTML = sesionesHoy.map(function (ses) {
			var productos = (productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; });
			var cuerpo = productos.length
				? productos.map(function (p) { return bloqueProducto(p); }).join("")
				: vacio("Esta sesión no tiene productos calificables.");
			return "<div class='rounded-xl border border-gray-200 p-3'>" +
				"<div class='flex items-center justify-between gap-2 mb-2'>" +
				"<p class='font-semibold text-gray-800 text-sm'>Sesión " + (ses.numero_sesion || "") +
				" · " + esc(ses.campo_formativo || "") + "</p>" +
				"<span class='flex gap-2 shrink-0'>" +
				// Una sesión con calificaciones o ya terminada no se quita de hoy (volvería a "pendiente")
				(sesionTieneCalificaciones(ses.id) || ses.estado_sesion === "completada" ? "" :
					"<button type='button' data-quitar-hoy='" + ses.id + "' " +
					"class='min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-500 hover:bg-gray-50'>Quitar de hoy</button>") +
				"<button type='button' data-agregar-producto='" + ses.id + "' " +
				"class='min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'>Agregar producto</button>" +
				"</span>" +
				"</div>" + cuerpo + "</div>";
		}).join("") + bloqueSiguientes();
		var sinCalificar = 0;
		sesionesHoy.forEach(function (ses) {
			(productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; }).forEach(function (p) {
				alumnosDeProducto(p).forEach(function (al) {
					var cal = calificaciones[al.id + "|" + p.id] || {};
					// Calificado = semáforo, estado de entrega o puntaje (el motor cuenta el puntaje solo)
					if (!cal.nivel && !cal.estado_entrega && (cal.puntaje === null || cal.puntaje === undefined)) sinCalificar++;
				});
			});
		});
		document.getElementById("sesionesResumen").textContent = sinCalificar
			? sinCalificar + " sin calificar" : "todo calificado";
	}

	// Repintar sesiones sin tirar lo que la maestra está escribiendo en una retroalimentación:
	// si hay un cuadro con el foco, se repinta al salir de él
	var repintarAlSalir = false;
	function repintarSesiones() {
		var activo = document.activeElement;
		if (activo && activo.tagName === "TEXTAREA" && sesionesCont && sesionesCont.contains && sesionesCont.contains(activo)) {
			repintarAlSalir = true;
			return;
		}
		renderSesiones();
	}

	function bloqueProducto(producto) {
		var deGrados = (producto.grados || []).length > 1;
		var filas = agruparPorGrado(alumnosDeProducto(producto)).map(function (g) {
			var encabezado = deGrados
				? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
			return encabezado + g.alumnos.map(function (al) {
				var clave = al.id + "|" + producto.id;
				var cal = calificaciones[clave] || {};
				var controles = NIVELES.map(function (op) {
					return chip(op.etiqueta, cal.nivel === op.valor, op.activo,
						"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-nivel='" + op.valor + "'");
				}).join("");
				controles += chip("No entregó", cal.estado_entrega === "no_entregado", "bg-red-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_entregado'");
				controles += chip("No aplica", cal.estado_entrega === "no_aplica", "bg-gray-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_aplica'");
				controles += "<button type='button' data-detalle='" + producto.id + "' data-alumno='" + al.id + "' " +
					"class='min-h-[44px] px-3 rounded-xl text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50'>" +
					(cal.puntaje != null || cal.retroalimentacion ? "Detalle ·" : "Detalle") + "</button>";
				return filaAlumno(al, controles) + detalleProducto(producto, al, cal);
			}).join("");
		}).join("");
		return "<div class='mb-3'>" +
			"<p class='text-sm font-medium text-gray-700'>" + esc(producto.nombre) +
			"<span class='text-xs text-gray-400 ml-2'>" + esc(producto.campo || "") + "</span></p>" +
			filas + "</div>";
	}

	function detalleProducto(producto, alumno, cal) {
		var id = "detalle-" + producto.id + "-" + alumno.id;
		var abierto = detallesAbiertos[id];
		var opciones = "<option value=''>Sin puntaje</option>";
		for (var n = 0; n <= 10; n++) {
			opciones += "<option value='" + n + "'" + (String(cal.puntaje) === String(n) ? " selected" : "") + ">" + n + "</option>";
		}
		var chipsRetro = RETRO_RAPIDA.map(function (t) {
			return "<button type='button' data-retro='" + id + "' data-texto='" + esc(t) + "' " +
				"class='min-h-[44px] px-3 rounded-xl text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200'>" + esc(t) + "</button>";
		}).join("");
		return "<div id='" + id + "' class='" + (abierto ? "" : "hidden ") +
			"rounded-xl bg-gray-50 border border-gray-200 p-3 mb-2'>" +
			"<div class='flex flex-wrap items-center gap-3'>" +
			"<label class='text-xs text-gray-600'>Puntaje" +
			"<select data-puntaje='" + producto.id + "' data-alumno='" + alumno.id + "' " +
			"class='ml-2 min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm'>" + opciones + "</select></label>" +
			"<span class='text-xs text-gray-400'>El puntaje manda sobre el semáforo al calcular.</span>" +
			"</div>" +
			"<div class='flex flex-wrap gap-2 mt-2'>" + chipsRetro + "</div>" +
			"<textarea data-retroalimentacion='" + producto.id + "' data-alumno='" + alumno.id + "' rows='2' " +
			"placeholder='Retroalimentación para el alumno y sus padres' " +
			"class='mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'>" + esc(cal.retroalimentacion || "") + "</textarea>" +
			"</div>";
	}

	var sesionesCont = document.getElementById("sesionesLista");
	sesionesCont.addEventListener("focusout", function () {
		if (!repintarAlSalir) return;
		repintarAlSalir = false;
		setTimeout(renderSesiones, 0);
	});

	sesionesCont.addEventListener("click", async function (e) {
		var btnHoy = e.target.closest("button[data-trabajar-hoy], button[data-quitar-hoy]");
		if (btnHoy) { await fecharSesion(btnHoy); return; }

		var btnAgregar = e.target.closest("button[data-agregar-producto]");
		if (btnAgregar) { await agregarProducto(btnAgregar.dataset.agregarProducto); return; }

		var btnDetalle = e.target.closest("button[data-detalle]");
		if (btnDetalle) {
			var idDetalle = "detalle-" + btnDetalle.dataset.detalle + "-" + btnDetalle.dataset.alumno;
			var caja = document.getElementById(idDetalle);
			if (caja) {
				var seAbre = caja.classList.contains("hidden");
				caja.classList.toggle("hidden", !seAbre);
				detallesAbiertos[idDetalle] = seAbre;
			}
			return;
		}

		var btnRetro = e.target.closest("button[data-retro]");
		if (btnRetro) {
			var ta = document.querySelector("#" + btnRetro.dataset.retro + " textarea[data-retroalimentacion]");
			if (ta) { ta.value = btnRetro.dataset.texto; ta.dispatchEvent(new Event("change", { bubbles: true })); }
			return;
		}

		var btn = e.target.closest("button[data-producto]");
		if (!btn) return;
		var producto = productoPorId(btn.dataset.producto);
		var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
		if (!producto || !alumno) return;
		var cal = calificaciones[alumno.id + "|" + producto.id] || {};

		if (btn.dataset.nivel) {
			var nuevoNivel = cal.nivel === btn.dataset.nivel ? null : btn.dataset.nivel;
			// Tocar un nivel implica que sí entregó
			guardarCalificacion(alumno, producto, {
				nivel: nuevoNivel,
				estado_entrega: nuevoNivel ? "entregado" : null,
			});
		} else if (btn.dataset.estado) {
			var nuevoEstado = cal.estado_entrega === btn.dataset.estado ? null : btn.dataset.estado;
			guardarCalificacion(alumno, producto, { estado_entrega: nuevoEstado, nivel: null });
		}
		renderSesiones();
	});

	sesionesCont.addEventListener("change", function (e) {
		var sel = e.target.closest("select[data-puntaje]");
		if (sel) {
			var p = productoPorId(sel.dataset.puntaje);
			var a = alumnos.find(function (x) { return x.id === sel.dataset.alumno; });
			if (p && a) guardarCalificacion(a, p, { puntaje: sel.value === "" ? null : Number(sel.value) });
			return;
		}
		var ta = e.target.closest("textarea[data-retroalimentacion]");
		if (ta) guardarRetro(ta);
	});

	/*
		Retroalimentación: se guarda al salir del cuadro y también mientras se escribe (tras
		una pausa). Lo escrito y aún no mandado cuenta como pendiente: recargar o cerrar la
		página pide confirmación y "Trabajar hoy" lo guarda antes de recargar.
	*/
	var retroPendiente = {}; // producto|alumno -> { ta, timer }
	function guardarRetro(ta) {
		var clave = ta.dataset.retroalimentacion + "|" + ta.dataset.alumno;
		if (retroPendiente[clave]) { clearTimeout(retroPendiente[clave].timer); delete retroPendiente[clave]; }
		var prod = productoPorId(ta.dataset.retroalimentacion);
		var alum = alumnos.find(function (x) { return x.id === ta.dataset.alumno; });
		if (prod && alum) guardarCalificacion(alum, prod, { retroalimentacion: ta.value.trim() || null });
	}
	function guardarRetrosPendientes() {
		Object.keys(retroPendiente).forEach(function (k) { guardarRetro(retroPendiente[k].ta); });
	}
	sesionesCont.addEventListener("input", function (e) {
		var ta = e.target.closest("textarea[data-retroalimentacion]");
		if (!ta) return;
		var clave = ta.dataset.retroalimentacion + "|" + ta.dataset.alumno;
		if (retroPendiente[clave]) clearTimeout(retroPendiente[clave].timer);
		retroPendiente[clave] = { ta: ta, timer: setTimeout(function () { guardarRetro(ta); }, 1000) };
	});

	function productoPorId(id) {
		var encontrado = null;
		Object.keys(productosPorSesion).forEach(function (sid) {
			productosPorSesion[sid].forEach(function (p) { if (p.id === id) encontrado = p; });
		});
		return encontrado;
	}

	/*
		"Trabajar hoy" pone la fecha de hoy a una sesión pendiente (y la marca activa);
		"Quitar de hoy" la regresa a sin fecha y pendiente, solo si todavía no tiene calificaciones.
		Se recarga la pantalla para que todo (productos, tareas, conteos) salga de la base.
	*/
	async function fecharSesion(btn) {
		var poner = !!btn.dataset.trabajarHoy;
		var sesionId = poner ? btn.dataset.trabajarHoy : btn.dataset.quitarHoy;
		btn.disabled = true;
		try {
			// La pantalla se recarga al final: primero debe quedar guardado todo lo que ya
			// se capturó (antes la recarga cortaba la cola y se perdían marcas)
			guardarRetrosPendientes(); // lo que se está escribiendo entra a la cola
			if (sinSenal()) { avisoSinSenal(btn, poner); return; }
			if (bandeja && bandeja.pendientes()) {
				btn.textContent = "Guardando lo capturado...";
				// No se espera para siempre: si la cola se atora (sin red, error del servidor,
				// sesión), se dice qué pasa y el botón vuelve
				var envio = await bandeja.esperarEnvio();
				if (envio !== "ok") {
					if (envio === "red" || envio === "servidor") { avisoSinSenal(btn, poner, envio); return; }
					btn.disabled = false;
					btn.textContent = poner ? "Trabajar hoy" : "Quitar de hoy";
					mensaje("error", "Primero hay que enviar lo capturado y tu sesión no está activa. Vuelve a iniciar sesión e inténtalo de nuevo; lo capturado sigue guardado en este dispositivo.");
					return;
				}
			}
			btn.textContent = poner ? "Agregando..." : "Quitando...";
			// Quitar de hoy la regresa como estaba: sin fecha y pendiente (no "activa")
			var cambios = poner ? { fecha: hoy, estado_sesion: "activa" } : { fecha: null, estado_sesion: "pendiente" };
			var res = await window.sb.from("sesiones").update(cambios).eq("id", sesionId).eq("maestro_id", user.id);
			if (res.error) throw res.error;
			window.location.reload();
		} catch (err) {
			if (sinSenal() || (window.BandejaSalida && window.BandejaSalida.tipoDeFallo(err) === "red" && !err.status)) {
				avisoSinSenal(btn, poner);
				return;
			}
			btn.disabled = false;
			btn.textContent = poner ? "Trabajar hoy" : "Quitar de hoy";
			mensaje("error", "No se pudo actualizar la sesión: " + (err.message || "error desconocido"));
		}
	}

	function sinSenal() {
		return (typeof navigator !== "undefined" && navigator.onLine === false) || !!(bandeja && bandeja.estado() === "red");
	}

	// "Trabajar hoy" y "Quitar de hoy" cambian la sesión en la base: sin señal no se puede.
	// Lo capturado no se pierde (sigue en este dispositivo)
	function avisoSinSenal(btn, poner, motivo) {
		btn.disabled = false;
		btn.textContent = poner ? "Trabajar hoy" : "Quitar de hoy";
		var accion = poner ? "agregar la sesión a hoy" : "quitar la sesión de hoy";
		mensaje("error", motivo === "servidor"
			? "No se pudo guardar lo capturado por ahora (el servidor no respondió bien) y sin eso no se puede " + accion +
				". Lo capturado sigue guardado en este dispositivo y se reintentará solo. Vuelve a intentarlo en un momento."
			: "Sin señal: no se puede " + accion + " en este momento. Lo que ya capturaste sigue guardado en este dispositivo. Inténtalo de nuevo cuando haya señal.");
	}

	/*
		"Agregar producto": cuando el maestro pidió algo que no estaba en la planeación.
		Se crea con origen 'maestro' para distinguirlo de lo importado.
	*/
	async function agregarProducto(sesionId) {
		var sesion = sesionesHoy.find(function (s) { return s.id === sesionId; });
		if (!sesion) return;
		var nombre = window.prompt("¿Qué producto pediste? (por ejemplo: Cartel del cuento)");
		if (!nombre || !nombre.trim()) return;
		var campo = window.CamposFormativos ? window.CamposFormativos.corto(sesion.campo_formativo) : null;
		if (!campo) { mensaje("error", "La sesión no tiene campo formativo; no se puede agregar el producto."); return; }
		var grados = (grupo.grados || []).map(String).sort();
		try {
			var res = await window.sb.from("productos_sesion").insert({
				sesion_id: sesion.id, maestro_id: user.id, tipo: "trabajo",
				nombre: nombre.trim(), grados: grados,
				modalidad: grados.length > 1 ? "compartida" : "compartida",
				campo: campo, origen: "maestro", activo: true,
			}).select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden").single();
			if (res.error) throw res.error;
			var nuevo = res.data;
			nuevo.sesion = sesion;
			(productosPorSesion[sesion.id] = productosPorSesion[sesion.id] || []).push(nuevo);
			renderSesiones();
			mensaje("", "");
		} catch (err) {
			mensaje("error", "No se pudo agregar el producto: " + (err.message || "error desconocido"));
		}
	}

	// ── 4. Cierre del día ─────────────────────────────────────────────────────
	function renderCierre() {
		var cont = document.getElementById("cierreLista");
		cont.innerHTML = alumnos.map(function (al) {
			var v = registro[al.id];
			var part = v ? v.participacion : 1;
			var cond = v ? v.conducta : 1;
			var controles = "<span class='text-xs text-gray-500 self-center mr-1'>Participación</span>" +
				[0, 1, 2].map(function (n) {
					return chip(String(n), part === n, "bg-blue-600 text-white",
						"data-cierre='participacion' data-alumno='" + al.id + "' data-valor='" + n + "'");
				}).join("") +
				"<span class='text-xs text-gray-500 self-center mx-1'>Conducta</span>" +
				[0, 1, 2].map(function (n) {
					return chip(String(n), cond === n, "bg-blue-600 text-white",
						"data-cierre='conducta' data-alumno='" + al.id + "' data-valor='" + n + "'");
				}).join("");
			return filaAlumno(al, controles);
		}).join("");
		var esperados = alumnos.filter(function (a) { return !faltoHoy(a.id); });
		var guardados = esperados.filter(function (a) { return registroGuardado[a.id]; }).length;
		// La misma cuenta que Inicio (js/alcance-hoy.js)
		var r = window.AlcanceHoy.resumenCierre(alumnos.length, esperados.length, guardados);
		document.getElementById("cierreResumen").textContent = r.nadieAsistio
			? "Nadie asistió hoy: no hay cierre que guardar"
			: r.conteo + " guardados" + r.sinContar;
		var boton = document.getElementById("cierreGuardarBtn");
		if (boton) {
			boton.disabled = r.completo || !esperados.length;
			boton.textContent = r.nadieAsistio ? "Nadie asistió hoy" : r.completo ? "Cierre de hoy guardado" : "Guardar el cierre de hoy";
		}
	}

	document.getElementById("cierreLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-cierre]");
		if (!btn) return;
		var alumnoId = btn.dataset.alumno;
		var actual = registro[alumnoId] || { participacion: 1, conducta: 1 };
		actual[btn.dataset.cierre] = Number(btn.dataset.valor);
		registro[alumnoId] = actual;
		guardarRegistro(alumnoId, btn.dataset.cierre);
		completarCierre(); // la primera excepción guarda el día de todo el grupo (relleno)
		renderCierre();
	});

	var cierreGuardarBtn = document.getElementById("cierreGuardarBtn");
	if (cierreGuardarBtn) {
		cierreGuardarBtn.addEventListener("click", function () {
			completarCierre();
			renderCierre();
		});
	}

	// ── Lo pendiente del dispositivo ──────────────────────────────────────────
	// Las capturas que siguen en la bandeja (por ejemplo, se recargó sin red) se ponen
	// encima de lo leído de la base: en pantalla se ve lo que la maestra capturó.
	async function aplicarPendientes() {
		if (!bandeja) return;
		var lista = await bandeja.lista();
		lista.forEach(function (it) {
			var d = it.datos || {};
			// Solo los campos que tocó la captura (una ventana vieja no tapa lo que otra capturó)
			var v = window.BandejaSalida.valoresPendientes(it);
			if (it.tipo === "asistencia") {
				if (d.grupo_id === grupo.id && d.fecha === hoy && v.estado) asistencia[d.alumno_id] = v.estado;
			} else if (it.tipo === "registro") {
				if (d.fecha !== hoy) return;
				if (it.relleno && registroGuardado[d.alumno_id]) return; // ya hay fila: el relleno no la cambia
				var r = registro[d.alumno_id] || { participacion: 1, conducta: 1 };
				registro[d.alumno_id] = {
					participacion: "participacion" in v ? v.participacion : r.participacion,
					conducta: "conducta" in v ? v.conducta : r.conducta,
				};
				registroGuardado[d.alumno_id] = true;
			} else if (it.tipo === "registro_borrar") {
				if (d.fecha !== hoy) return;
				delete registro[d.alumno_id];
				registroGuardado[d.alumno_id] = false;
			} else if (it.tipo === "calificacion" && d.fila) {
				var k = d.fila.alumno_id + "|" + d.fila.producto_sesion_id;
				var c = calificaciones[k] || { alumno_id: d.fila.alumno_id, producto_sesion_id: d.fila.producto_sesion_id };
				["estado_entrega", "nivel", "puntaje", "retroalimentacion"].forEach(function (f) { if (f in v) c[f] = v[f]; });
				if (!c.id && d.id) c.id = d.id;
				calificaciones[k] = c;
			}
		});
	}

	// Atajos de la app ("Pasar lista" → #asistencia, "Calificar trabajos" → #sesiones): el
	// salto se hace después de pintar, porque las listas se llenan tarde
	function irASeccion() {
		var id = (window.location.hash || "").slice(1);
		if (["asistencia", "tareas", "sesiones", "cierre"].indexOf(id) === -1) return;
		var el = document.getElementById(id);
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
	}

	// ── Arranque ──────────────────────────────────────────────────────────────
	// Hasta aquí todo está declarado e inicializado. Cada sección se dibuja por
	// separado: si una falla, las demás siguen en pie y el maestro no se queda con
	// media pantalla en blanco.
	try {
		await cargarDatosDelDia();
	} catch (e) {
		console.error("hoy: carga de datos", e);
		// Sin los datos completos no se dibuja nada: una sección a medias parecería "sin
		// calificar" y el maestro capturaría encima de lo que ya había guardado
		mensaje("error", "No se pudieron cargar los datos del día: " + (e.message || "error desconocido") +
			". Recarga la página para intentarlo de nuevo.");
		if (bandeja) bandeja.iniciar(); // lo pendiente de otra vez sí se intenta enviar
		return;
	}
	// Lo capturado en este dispositivo que aún no llega a la base se ve como capturado
	try {
		await aplicarPendientes();
	} catch (e) {
		console.error("hoy: pendientes del dispositivo", e);
	}
	[
		["asistencia", renderAsistencia],
		["tareas", renderTareas],
		["sesiones", renderSesiones],
		["cierre", renderCierre],
	].forEach(function (par) {
		try {
			par[1]();
		} catch (e) {
			console.error("hoy: render de " + par[0], e);
			mensaje("error", "No se pudo mostrar la sección de " + par[0] + ". El resto de la pantalla sigue funcionando.");
		}
	});
	pintado = true;
	// Ya pintado lo pendiente: se habilita el envío (antes, un envío entre la lectura y la
	// pintura podía dejar en pantalla el valor viejo)
	if (bandeja) bandeja.iniciar();
	irASeccion();
});
