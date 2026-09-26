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
	var sesionPedida = null; // la sesión de la actividad suelta que se abrió desde Proyectos (?calificar=)
	// "Trabajar hoy": por cada proyecto activo, su siguiente sesión sin fecha y las demás
	// pendientes (js/productos-hoy.js): [{ proyecto, siguiente, otras }]
	var siguientes = [];
	var proyectoPorId = {};    // proyectos que mira Hoy (título, grados y tipo)
	var detallesAbiertos = {}; // qué paneles de detalle quedan abiertos entre renders
	// Días sin clase (o con clase) del grupo sobre el calendario SEP (calendario_ajustes): con ellos
	// vencen las tareas y se revisa lo incompleto el siguiente día de clase (js/alcance-hoy.js)
	var ajustesCal = [];
	// Para quién es cada producto además de sus grados (producto_sesion_alumnos, mi_salon_b17):
	// { productoId: { alumnoId: "incluir" | "excluir" } } — regla única en AlcanceHoy.recibeProducto
	var asignaciones = {};
	// "Pendientes de la clase anterior" que se revisaron en esta visita (siguen a la vista para
	// poder corregir un toque): alumno|producto → true
	var revisadosAqui = {};
	// Los campos de una calificación que captura Hoy (los mismos de la bandeja)
	var CAMPOS_CAL = ["estado_entrega", "nivel", "puntaje", "retroalimentacion", "revisar_en", "estado_en_clase", "completado_en"];
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
				renderPendientes();
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
				CAMPOS_CAL.forEach(function (f) { c[f] = v && v[f] !== undefined ? v[f] : null; });
				if (id && !c.id) c.id = id;
				calificaciones[k] = c;
				if (!pintado) return;
				renderTareas();
				renderPendientes();
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
			return CAMPOS_CAL.some(function (f) {
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

		// Los ajustes del grupo al calendario SEP: las tareas vencen y lo incompleto se revisa el
		// siguiente día de clase (acotada: una fila por día ajustado del grupo, a lo más los días
		// hábiles de un ciclo)
		ajustesCal = await window.AlcanceHoy.leerAjustesCalendario(window.sb, user.id, grupo.id);

		// Proyectos del grupo que mira "Hoy" (js/alcance-hoy.js) → sesiones → productos.
		// Incluye los recién terminados: la tarea de su última sesión se revisa aquí. También el
		// contenedor de las actividades sueltas del trimestre (tipo 'sueltas').
		var proyRes = await window.sb.from("proyectos").select("id, titulo, estado, trimestre, fecha_final, grados, tipo")
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
		(proyRes.data || []).forEach(function (p) { proyectoPorId[p.id] = p; });
		// Con varios proyectos activos, las de hoy van por proyecto y luego por número
		// Las actividades sueltas van al final de las del día
		sesionesHoy = sesiones.filter(function (s) { return s.fecha === hoy; });

		/*
			Las sesiones de una planeación no traen fecha: el maestro decide qué trabaja
			cada día (y a veces son dos en un día, o una en dos). Por cada proyecto ACTIVO se
			ofrece su siguiente sesión pendiente y se puede elegir cualquier otra; "Trabajar hoy"
			les pone la fecha de hoy y así entran a la captura, al reparto de participación y a
			la asistencia del trimestre. Antes eran 4 sesiones en total, ordenadas por el id del
			proyecto: con un proyecto por campo formativo, algunos no salían.
		*/
		siguientes = window.ProductosHoy.siguientesPorProyecto(sesiones, proyRes.data || []);

		if (!sesiones.length) return;
		var productos = await window.AlcanceHoy.leerPorLotes(sesiones.map(function (s) { return s.id; }), function (lote) {
			return window.sb.from("productos_sesion")
				.select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden, created_at")
				.in("sesion_id", lote).eq("activo", true)
				.order("orden").order("id");
		});
		// Por orden y, a igual orden (los trabajos por grado del plan), de menor a mayor grado
		function primerGrado(p) { return Math.min.apply(null, (p.grados || [9]).map(Number)); }
		productos.sort(function (a, b) {
			return (a.orden || 0) - (b.orden || 0) || primerGrado(a) - primerGrado(b);
		});

		productos.forEach(function (p) {
			p.sesion = sesionPorId[p.sesion_id];
			if (!productosPorSesion[p.sesion_id]) productosPorSesion[p.sesion_id] = [];
			productosPorSesion[p.sesion_id].push(p);
		});

		/*
			Actividades sueltas de un día que ya pasó (decisión de Jorge del 2026-09-26: se califican al
			momento): entran a Hoy el día en que se agregaron (su producto se creó hoy) y cuando se
			abren desde "Actividades del trimestre" en Proyectos (hoy.html?calificar=<producto>).
		*/
		var pedida = new URLSearchParams(window.location.search || "").get("calificar");
		productos.forEach(function (p) {
			var s = p.sesion;
			if (!s || !s.fecha || s.fecha >= hoy || p.tipo === "tarea") return;
			if (!window.AlcanceHoy.esSueltas(proyectoPorId[s.proyecto_id])) return;
			if (p.id !== pedida && fechaLocal(p.created_at) !== hoy) return;
			if (sesionesHoy.indexOf(s) === -1) sesionesHoy.push(s);
			if (p.id === pedida) sesionPedida = s.id;
		});
		if (pedida && !sesionPedida) {
			mensaje("info", "Esa actividad no está en el trimestre que mira Hoy (o ya no existe). Revísala en Proyectos, en Actividades del trimestre.");
		}
		// Por proyecto y número; las sueltas al final, las de días que ya pasaron después de las de hoy
		sesionesHoy.sort(function (a, b) {
			var pa = proyectoPorId[a.proyecto_id] || {}, pb = proyectoPorId[b.proyecto_id] || {};
			var sa = window.AlcanceHoy.esSueltas(pa) ? 1 : 0, sb = window.AlcanceHoy.esSueltas(pb) ? 1 : 0;
			var da = a.fecha === hoy ? 0 : 1, db = b.fecha === hoy ? 0 : 1;
			var ta = pa.titulo || "", tb = pb.titulo || "";
			return sa - sb || da - db || String(a.fecha || "").localeCompare(String(b.fecha || "")) ||
				ta.localeCompare(tb, "es", { sensitivity: "base" }) || (a.numero_sesion || 0) - (b.numero_sesion || 0);
		});

		// Tareas por revisar: vencen hoy o antes (las de días pasados siguen ahí
		// hasta que el maestro las revise)
		tareas = productos.filter(function (p) {
			if (p.tipo !== "tarea") return false;
			var vence = venceDe(p);
			return vence && vence <= hoy;
		}).sort(function (a, b) {
			var fa = venceDe(a) || "";
			var fb = venceDe(b) || "";
			return fa < fb ? 1 : fa > fb ? -1 : 0; // lo más reciente primero
		});

		var idsRelevantes = productos.map(function (p) { return p.id; });
		// Para quién es cada producto además de sus grados (sin tope, por lotes de productos)
		var filasAsig = await window.AlcanceHoy.leerPorLotes(idsRelevantes, function (lote) {
			return window.sb.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo")
				.eq("maestro_id", user.id).in("producto_sesion_id", lote).order("id");
		});
		asignaciones = window.AlcanceHoy.indiceAsignaciones(filasAsig);

		// Calificaciones ya capturadas de esos productos
		function leerCalificaciones() {
			return window.AlcanceHoy.leerPorLotes(idsRelevantes, function (lote) {
				return window.sb.from("calificaciones")
					.select(conCaptura("id, alumno_id, producto_sesion_id, estado_entrega, nivel, puntaje, retroalimentacion, revisar_en, estado_en_clase, completado_en, fecha", "calificacion"))
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
			var vence = venceDe(t);
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
				// La revisión de una actividad que quedó incompleta en clase (van con el semáforo)
				revisar_en: actual.revisar_en || null,
				estado_en_clase: actual.estado_en_clase || null,
				completado_en: actual.completado_en || null,
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
		return "<button type='button' " + atributos + " class='min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-semibold transition-colors " +
			(activo ? clasesActivo : "bg-gray-100 text-gray-600 hover:bg-gray-200") + "'>" + esc(texto) + "</button>";
	}

	// nota: texto chico bajo el nombre (por ejemplo "Trabaja con 2°" o "Se revisa el 29 sep")
	function filaAlumno(alumno, controles, nota) {
		return "<div class='flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-gray-100 last:border-0'>" +
			"<div class='sm:w-56 shrink-0'>" +
			"<span class='text-sm font-medium text-gray-800'>" + esc(alumno.nombre_completo) + "</span>" +
			"<span class='text-xs text-gray-400 ml-2'>" + (alumno.num_lista || "") + " · " + alumno.grado + "°</span>" +
			(nota ? "<span class='block text-xs font-semibold text-violet-700'>" + esc(nota) + "</span>" : "") +
			"</div><div class='flex flex-wrap gap-2'>" + controles + "</div></div>";
	}

	// Los días del trimestre en curso en que puede caer una actividad suelta (js/productos-hoy.js)
	function rangoSuelta() {
		return window.ProductosHoy.rangoTrimestre(grupo && grupo.trimestre_actual, hoy, {
			calendarios: window.CalendarioEscolar ? window.CalendarioEscolar.CALENDARIOS : [],
			ciclo: window.CalendarioSEP ? window.CalendarioSEP.cicloDe(hoy) : null,
		});
	}
	// El día (hora de Ciudad de México) de un instante de la base, "AAAA-MM-DD"
	function fechaLocal(instante) {
		if (!instante) return null;
		try {
			return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
		} catch (e) {
			return String(instante).slice(0, 10);
		}
	}

	// Cuándo vence una tarea (calendario SEP y ajustes del grupo: js/alcance-hoy.js)
	function venceDe(t) {
		return window.AlcanceHoy.venceTarea(t.fecha_entrega, t.sesion && t.sesion.fecha, ajustesCal);
	}

	/*
		A quién le toca un producto: REGLA ÚNICA de js/alcance-hoy.js (recibeProducto), la misma de
		Inicio, Tareas, el motor y Qué le falta: los de sus grados que no se excluyeron, más los
		incluidos ("¿Para quién?"), y solo si el producto es desde su alta (un alumno que llegó
		después no ve como pendientes las tareas de antes).
	*/
	function alumnosDeProducto(producto) {
		var fechaSesion = producto.sesion && producto.sesion.fecha;
		return alumnos.filter(function (a) {
			return window.AlcanceHoy.recibeProducto(a, producto, asignaciones, fechaSesion, calificaciones[a.id + "|" + producto.id]);
		});
	}

	// "Trabaja con 2°": un alumno incluido de otro grado (sigue en su grado para la boleta)
	function notaTrabajaCon(alumno, producto) {
		var g = window.AlcanceHoy.trabajaCon(alumno, producto, asignaciones);
		return g ? "Trabaja con " + g : "";
	}

	// El rótulo de para quién es un producto ("3° y 4°", "2 alumnos de 3°", "2° + 2 alumnos de 3°")
	function paraQuien(producto) {
		return window.ProductosHoy.resumenPara(producto, asignaciones[producto.id], alumnos) ||
			window.ProductosHoy.etiquetaGrados(producto.grados);
	}

	function esSuelta(sesion) {
		return !!sesion && window.AlcanceHoy.esSueltas(proyectoPorId[sesion.proyecto_id]);
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
		renderPendientes(); // quien faltó hoy sigue pendiente
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
			var vence = venceDe(t);
			var atrasada = vence && vence < hoy;
			var porGrado = agruparPorGrado(alumnosDeProducto(t));
			var filas = porGrado.map(function (g) {
				var encabezado = porGrado.length > 1
					? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
				return encabezado + g.alumnos.map(function (al) {
					var cal = calificaciones[al.id + "|" + t.id] || {};
					var controles = ENTREGA_TAREA.map(function (op) {
						return chip(op.etiqueta, cal.estado_entrega === op.valor, op.activo,
							"data-tarea='" + t.id + "' data-alumno='" + al.id + "' data-valor='" + op.valor + "'");
					}).join("");
					return filaAlumno(al, controles, notaTrabajaCon(al, t));
				}).join("");
			}).join("");
			return "<div>" +
				"<div class='flex items-center justify-between gap-2 mb-1'>" +
				"<p class='font-semibold text-gray-800 text-sm'>" + esc(t.nombre) +
				"<span class='text-blue-700'> · " + esc(paraQuien(t)) + "</span></p>" +
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

	// ── Pendientes de la clase anterior ───────────────────────────────────────
	/*
		Actividades en clase que quedaron "Incompleta" y ya toca revisar (revisar_en llegó: el
		siguiente día de clase del calendario SEP y los ajustes del grupo). Una fila por alumno y
		actividad (decisión de Jorge del 2026-09-26):
		  - "Lo completó" con el nivel que logró: vale ese nivel, completo;
		  - "Sigue incompleta": queda incompleta definitiva (0.5) y sale en "Qué le falta".
		Pasa una sola vez: revisada, ya no vuelve. Si el alumno faltó hoy, sigue pendiente (se
		revisa cuando vuelva). Lo revisado en esta visita (o hoy) sigue a la vista para corregir.
	*/
	function pendientesDeRevisar() {
		var lista = [];
		Object.keys(calificaciones).forEach(function (k) {
			var c = calificaciones[k];
			if (!c || !c.estado_en_clase) return;
			var revisadaHoy = (c.estado_en_clase === "completada" || c.estado_en_clase === "sigue_incompleta") &&
				(revisadosAqui[k] || String(c.completado_en || "").slice(0, 10) === hoy);
			if (!window.AlcanceHoy.tocaRevisar(c, hoy) && !revisadaHoy && !(revisadosAqui[k] && c.estado_en_clase === "incompleta")) return;
			var producto = productoPorId(c.producto_sesion_id);
			var alumno = alumnos.find(function (a) { return a.id === c.alumno_id; });
			if (!producto || !alumno) return;
			lista.push({ clave: k, cal: c, producto: producto, alumno: alumno });
		});
		return lista.sort(function (a, b) {
			return (Number(a.alumno.grado) - Number(b.alumno.grado)) || ((a.alumno.num_lista || 0) - (b.alumno.num_lista || 0)) ||
				String(a.producto.nombre || "").localeCompare(String(b.producto.nombre || ""), "es");
		});
	}

	function renderPendientes() {
		var seccion = document.getElementById("pendientes");
		var cont = document.getElementById("pendientesLista");
		if (!cont) return;
		var lista = pendientesDeRevisar();
		if (seccion && seccion.classList) seccion.classList.toggle("hidden", !lista.length);
		if (!lista.length) {
			cont.innerHTML = "";
			var r0 = document.getElementById("pendientesResumen");
			if (r0) r0.textContent = "";
			return;
		}
		var sinRevisar = 0;
		cont.innerHTML = lista.map(function (x) {
			var c = x.cal, al = x.alumno, p = x.producto;
			var falto = faltoHoy(al.id);
			var pendiente = c.estado_en_clase === "incompleta";
			if (pendiente) sinRevisar++;
			var datos = "data-revisar-producto='" + p.id + "' data-alumno='" + al.id + "'";
			var controles = "";
			if (falto && pendiente) {
				controles = "<span class='text-xs text-gray-500 self-center'>Faltó hoy: queda pendiente para su siguiente clase.</span>";
			} else {
				controles = "<span class='text-xs text-gray-500 self-center mr-1'>Lo completó:</span>" +
					NIVELES.map(function (op) {
						return chip(op.etiqueta, c.estado_en_clase === "completada" && c.nivel === op.valor, op.activo,
							datos + " data-accion='completo' data-nivel-revision='" + op.valor + "'");
					}).join("") +
					chip("Sigue incompleta", c.estado_en_clase === "sigue_incompleta", "bg-amber-500 text-white", datos + " data-accion='sigue'");
			}
			var sesion = p.sesion || {};
			var nota = (p.nombre || "Actividad") + " · " + (window.CamposFormativos ? window.CamposFormativos.largo(p.campo) : p.campo) +
				(sesion.fecha ? " · incompleta el " + fechaCorta(sesion.fecha) : "");
			return filaAlumno(al, controles, nota);
		}).join("");
		var r = document.getElementById("pendientesResumen");
		if (r) r.textContent = sinRevisar ? sinRevisar + (sinRevisar === 1 ? " por revisar" : " por revisar") : "todas revisadas";
	}

	var pendientesCont = document.getElementById("pendientesLista");
	if (pendientesCont && pendientesCont.addEventListener) {
		pendientesCont.addEventListener("click", function (e) {
			var btn = e.target.closest("button[data-revisar-producto]");
			if (!btn) return;
			var producto = productoPorId(btn.dataset.revisarProducto);
			var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
			if (!producto || !alumno) return;
			var k = alumno.id + "|" + producto.id;
			var c = calificaciones[k] || {};
			var accion = btn.dataset.accion;
			var yaEsa = accion === "sigue" ? c.estado_en_clase === "sigue_incompleta"
				: c.estado_en_clase === "completada" && c.nivel === btn.dataset.nivelRevision;
			// Tocar otra vez lo elegido lo regresa a pendiente (para corregir un toque)
			guardarCalificacion(alumno, producto, yaEsa
				? window.AlcanceHoy.cambiosIncompleta("pendiente", { hoy: hoy })
				: window.AlcanceHoy.cambiosIncompleta(accion, { hoy: hoy, nivel: btn.dataset.nivelRevision }));
			revisadosAqui[k] = true;
			renderPendientes();
			repintarSesiones();
		});
	}

	// ── 3. Sesiones de hoy ────────────────────────────────────────────────────
	// Bloque "Trabajar hoy": las siguientes sesiones pendientes del proyecto activo
	// Una sesión pendiente con su botón "Trabajar hoy"
	function filaSiguiente(s) {
		return "<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg bg-white border border-gray-200 px-3 py-2'>" +
			"<span class='text-sm text-gray-700'>Sesión " + (s.numero_sesion || "") + " · " + esc(s.campo_formativo || "Sin campo formativo") +
			(s.momento ? "<span class='block text-xs text-gray-400'>" + esc(s.momento) + "</span>" : "") + "</span>" +
			"<button type='button' data-trabajar-hoy='" + s.id + "' aria-label='Trabajar hoy la sesión " + (s.numero_sesion || "") + " de " + esc(s.proyectoTitulo || "") + "' " +
			"class='min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shrink-0'>Trabajar hoy</button>" +
			"</div>";
	}

	// "Trabajar hoy": la siguiente de CADA proyecto activo, agrupadas, y las demás a un toque
	function bloqueSiguientes() {
		if (!siguientes.length) {
			return sesionesHoy.length ? "" : vacio("No hay sesiones pendientes en tus proyectos activos. Inicia un proyecto desde Proyectos o agrega una actividad suelta.");
		}
		return "<div class='rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-3'>" +
			"<p class='text-sm font-semibold text-gray-800 mb-1'>" +
			(sesionesHoy.length ? "¿Trabajarás otra sesión hoy?" : "¿Qué sesión trabajas hoy?") + "</p>" +
			"<p class='text-xs text-gray-500 mb-2'>Las sesiones de tu planeación no traen fecha: elige la que vas a trabajar y sus productos aparecen aquí para calificarlos." +
			(siguientes.length > 1 ? " Tienes " + siguientes.length + " proyectos activos." : "") + "</p>" +
			"<div class='flex flex-col gap-3'>" +
			siguientes.map(function (g) {
				var otras = g.otras.length
					? "<details class='mt-2'><summary class='min-h-[44px] flex items-center cursor-pointer text-sm text-blue-700 font-medium'>Elegir otra sesión (" +
						g.otras.length + (g.otras.length === 1 ? " pendiente" : " pendientes") + ")</summary>" +
						"<div class='flex flex-col gap-2 mt-1'>" + g.otras.map(filaSiguiente).join("") + "</div></details>"
					: "";
				return "<section class='rounded-lg bg-white/60 p-2' aria-label='" + esc(g.proyecto.titulo || "Proyecto") + "'>" +
					"<p class='text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1'>" + esc(g.proyecto.titulo || "Proyecto sin título") + "</p>" +
					filaSiguiente(g.siguiente) + otras + "</section>";
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
			var tareasSesion = (productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo === "tarea"; });
			var cuerpo = productos.length
				? productos.map(function (p) { return bloqueProducto(p); }).join("")
				: vacio("Esta sesión no tiene actividades para calificar. Agrega una con \"Agregar actividad o tarea\".");
			var proyecto = proyectoPorId[ses.proyecto_id];
			var suelta = esSuelta(ses);
			return "<div id='ses-" + esc(ses.id) + "' class='rounded-xl border " + (suelta ? "border-violet-200 bg-violet-50/30" : "border-gray-200") + " p-3 scroll-mt-20'>" +
				"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2'>" +
				(suelta
					// Las actividades sueltas del día (sin proyecto): no son una sesión de la planeación
					? "<p class='font-semibold text-gray-800 text-sm'>" + esc(window.AlcanceHoy.TITULO_SUELTAS) + " · " + esc(ses.campo_formativo || "") +
						(ses.fecha && ses.fecha !== hoy ? " · " + esc(fechaCorta(ses.fecha)) : "") +
						"<span class='block text-xs font-normal text-gray-500'>" + (ses.fecha && ses.fecha < hoy
							? "Actividades sin proyecto del " + esc(fechaCorta(ses.fecha)) + " (un día que ya pasó): califícalas aquí; cuentan con su fecha."
							: "Actividades sin proyecto de hoy. Puedes pasarlas a un proyecto cuando quieras.") + "</span></p>"
					: "<p class='font-semibold text-gray-800 text-sm'>Sesión " + (ses.numero_sesion || "") +
						" · " + esc(ses.campo_formativo || "") +
						(proyecto && proyecto.titulo ? "<span class='block text-xs font-normal text-gray-500'>" + esc(proyecto.titulo) + "</span>" : "") + "</p>") +
				"<span class='flex flex-wrap gap-2 shrink-0'>" +
				// Una sesión con calificaciones o ya terminada no se quita de hoy (volvería a "pendiente");
				// las sueltas no se quitan de hoy (son de hoy)
				(suelta || sesionTieneCalificaciones(ses.id) || ses.estado_sesion === "completada" ? "" :
					"<button type='button' data-quitar-hoy='" + ses.id + "' " +
					"class='min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-500 hover:bg-gray-50'>Quitar de hoy</button>") +
				"<button type='button' data-agregar-producto='" + ses.id + "' " +
				"class='min-h-[44px] px-3 rounded-lg border border-blue-300 text-sm font-semibold text-blue-700 hover:bg-blue-50'>Agregar actividad o tarea</button>" +
				"</span>" +
				"</div>" + cuerpo + bloqueTareasDeSesion(tareasSesion) + "</div>";
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

	// "Incompleta: se revisa el 29 sep" (o "La completó el 29 sep" / "Sigue incompleta")
	function notaIncompleta(cal) {
		if (!cal) return "";
		if (cal.estado_en_clase === "incompleta") return cal.revisar_en ? "Incompleta: se revisa el " + fechaCorta(cal.revisar_en) : "Incompleta";
		if (cal.estado_en_clase === "completada") return "Quedó incompleta; la completó" + (cal.completado_en ? " el " + fechaCorta(cal.completado_en) : "");
		if (cal.estado_en_clase === "sigue_incompleta") return "Sigue incompleta";
		return "";
	}

	function bloqueProducto(producto) {
		var porGrado = agruparPorGrado(alumnosDeProducto(producto));
		var filas = porGrado.map(function (g) {
			var encabezado = porGrado.length > 1
				? "<p class='text-xs font-semibold text-gray-500 mt-2 mb-1'>" + g.grado + "° grado</p>" : "";
			return encabezado + g.alumnos.map(function (al) {
				var clave = al.id + "|" + producto.id;
				var cal = calificaciones[clave] || {};
				var controles = NIVELES.map(function (op) {
					return chip(op.etiqueta, cal.nivel === op.valor, op.activo,
						"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-nivel='" + op.valor + "'");
				}).join("");
				// Incompleta: se revisa el siguiente día de clase (Pendientes de la clase anterior)
				controles += chip("Incompleta", cal.estado_entrega === "incompleto", "bg-amber-400 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-incompleta='1'");
				controles += chip("No entregó", cal.estado_entrega === "no_entregado", "bg-red-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_entregado'");
				controles += chip("No aplica", cal.estado_entrega === "no_aplica", "bg-gray-500 text-white",
					"data-producto='" + producto.id + "' data-alumno='" + al.id + "' data-estado='no_aplica'");
				controles += "<button type='button' data-detalle='" + producto.id + "' data-alumno='" + al.id + "' " +
					"class='min-h-[44px] px-3 rounded-xl text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50'>" +
					(cal.puntaje != null || cal.retroalimentacion ? "Detalle ·" : "Detalle") + "</button>";
				var nota = [notaTrabajaCon(al, producto), notaIncompleta(cal)].filter(Boolean).join(" · ");
				return filaAlumno(al, controles, nota) + detalleProducto(producto, al, cal);
			}).join("");
		}).join("");
		return "<div class='mb-3'>" +
			"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2'>" +
			"<p class='text-sm font-medium text-gray-700'>" + esc(producto.nombre) +
			// Para quién: sus grados (en multigrado salían bloques iguales sin decir de qué grado
			// eran) y los alumnos incluidos o excluidos
			"<span class='text-sm font-semibold text-blue-700'> · " + esc(paraQuien(producto)) + "</span>" +
			"<span class='text-xs text-gray-400 ml-2'>" + esc(producto.campo || "") + "</span></p>" +
			botonesProducto(producto) + "</div>" +
			(filas || vacio("Nadie recibe esta actividad todavía. Usa «Para quién» para elegir a los alumnos.")) + "</div>";
	}

	// Para quién, renombrar y quitar un producto (quitar solo si no tiene calificaciones: lo revisa
	// al tocar); en una actividad suelta, también "Pasar a un proyecto"
	function botonesProducto(producto) {
		return "<span class='flex flex-wrap gap-2 shrink-0'>" +
			"<button type='button' data-para-quien='" + producto.id + "' aria-label='Para quién es " + esc(producto.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-gray-600 hover:bg-gray-100'>Para quién</button>" +
			(esSuelta(producto.sesion)
				? "<button type='button' data-pasar-proyecto='" + producto.id + "' aria-label='Pasar " + esc(producto.nombre) + " a un proyecto' " +
					"class='min-h-[44px] px-3 rounded-lg text-sm text-violet-700 hover:bg-violet-50'>Pasar a un proyecto</button>"
				: "") +
			"<button type='button' data-renombrar='" + producto.id + "' aria-label='Renombrar " + esc(producto.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-gray-600 hover:bg-gray-100'>Renombrar</button>" +
			"<button type='button' data-quitar-producto='" + producto.id + "' aria-label='Quitar " + esc(producto.nombre) + "' " +
			"class='min-h-[44px] px-3 rounded-lg text-sm text-red-600 hover:bg-red-50'>Quitar</button>" +
			"</span>";
	}

	// Las tareas que se dejaron en la sesión: se califican en "Tareas por revisar" el día que se revisan
	function bloqueTareasDeSesion(lista) {
		if (!lista.length) return "";
		return "<div class='mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3'>" +
			"<p class='text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1'>Tareas de esta sesión</p>" +
			lista.map(function (t) {
				var vence = venceDe(t);
				return "<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-gray-100 last:border-0'>" +
					"<p class='text-sm text-gray-700'>" + esc(t.nombre) +
					"<span class='text-sm font-semibold text-blue-700'> · " + esc(paraQuien(t)) + "</span>" +
					(vence ? "<span class='block text-xs text-gray-500'>" + (vence === hoy ? "Se revisa hoy, arriba en Tareas por revisar" : "Se revisa el " + esc(fechaCorta(vence))) + "</span>" : "") +
					"</p>" + botonesProducto(t) + "</div>";
			}).join("") + "</div>";
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
		if (btnAgregar) { agregarProducto(btnAgregar.dataset.agregarProducto, btnAgregar); return; }

		var btnRenombrar = e.target.closest("button[data-renombrar]");
		if (btnRenombrar) { renombrarProducto(btnRenombrar.dataset.renombrar, btnRenombrar); return; }

		var btnQuitarProd = e.target.closest("button[data-quitar-producto]");
		if (btnQuitarProd) { await quitarProducto(btnQuitarProd.dataset.quitarProducto, btnQuitarProd); return; }

		var btnPara = e.target.closest("button[data-para-quien]");
		if (btnPara) { editarParaQuien(btnPara.dataset.paraQuien, btnPara); return; }

		var btnPasar = e.target.closest("button[data-pasar-proyecto]");
		if (btnPasar) { await pasarAProyecto(btnPasar.dataset.pasarProyecto, btnPasar); return; }

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

		// Cualquier toque del semáforo en la clase deja sin efecto la marca de "Incompleta" (la
		// revisión del siguiente día de clase); la vuelve a poner solo el botón Incompleta
		var sinIncompleta = window.AlcanceHoy.cambiosIncompleta("quitar");
		if (btn.dataset.nivel) {
			var nuevoNivel = cal.nivel === btn.dataset.nivel ? null : btn.dataset.nivel;
			// Tocar un nivel implica que sí entregó
			guardarCalificacion(alumno, producto, Object.assign({
				nivel: nuevoNivel,
				estado_entrega: nuevoNivel ? "entregado" : null,
			}, sinIncompleta));
		} else if (btn.dataset.incompleta) {
			// Incompleta en clase: cuenta como incompleta (0.5) y se revisa el siguiente día de clase
			// del calendario SEP y los ajustes del grupo; tocarla otra vez la quita
			guardarCalificacion(alumno, producto, cal.estado_entrega === "incompleto"
				? Object.assign({ estado_entrega: null, nivel: null }, sinIncompleta)
				: window.AlcanceHoy.cambiosIncompleta("marcar", { hoy: hoy, ajustes: ajustesCal }));
		} else if (btn.dataset.estado) {
			var nuevoEstado = cal.estado_entrega === btn.dataset.estado ? null : btn.dataset.estado;
			guardarCalificacion(alumno, producto, Object.assign({ estado_entrega: nuevoEstado, nivel: null }, sinIncompleta));
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
		Diálogo accesible (role="dialog", foco dentro, Esc cierra y el foco vuelve al botón que
		lo abrió). construir(form) arma el contenido; alAceptar(form, avisar) guarda y devuelve
		false si el diálogo debe seguir abierto (con el aviso que puso).
	*/
	var numeroDialogo = 0;
	function abrirDialogo(opciones) {
		var previo = opciones.origen || document.activeElement;
		var id = "hoyDialogo" + (++numeroDialogo);
		var fondo = document.createElement("div");
		fondo.className = "fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4";
		var caja = document.createElement("div");
		caja.setAttribute("role", "dialog");
		caja.setAttribute("aria-modal", "true");
		caja.setAttribute("aria-labelledby", id + "-titulo");
		caja.className = "bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto";
		var form = document.createElement("form");
		form.noValidate = true;
		form.className = "flex flex-col";
		var cabeza = document.createElement("div");
		cabeza.className = "p-5 border-b border-gray-100";
		var titulo = document.createElement("h2");
		titulo.id = id + "-titulo";
		titulo.className = "text-lg font-bold text-gray-800";
		titulo.textContent = opciones.titulo;
		cabeza.appendChild(titulo);
		if (opciones.subtitulo) {
			var sub = document.createElement("p");
			sub.className = "text-sm text-gray-500 mt-1";
			sub.textContent = opciones.subtitulo;
			cabeza.appendChild(sub);
		}
		var cuerpo = document.createElement("div");
		cuerpo.className = "p-5 flex flex-col gap-4";
		var aviso = document.createElement("p");
		aviso.setAttribute("role", "alert");
		aviso.className = "hidden text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2";
		var pie = document.createElement("div");
		pie.className = "p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2";
		var cancelar = document.createElement("button");
		cancelar.type = "button";
		cancelar.className = "min-h-[44px] px-5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50";
		cancelar.textContent = "Cancelar";
		var aceptar = document.createElement("button");
		aceptar.type = "submit";
		aceptar.className = "min-h-[44px] px-5 rounded-xl font-semibold text-white " + (opciones.peligro ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700");
		aceptar.textContent = opciones.aceptar || "Guardar";
		pie.appendChild(cancelar);
		pie.appendChild(aceptar);
		form.appendChild(cabeza);
		form.appendChild(cuerpo);
		form.appendChild(pie);
		caja.appendChild(form);
		fondo.appendChild(caja);
		if (opciones.construir) opciones.construir(cuerpo);
		cuerpo.appendChild(aviso);

		function avisar(texto, foco) {
			aviso.textContent = texto || "";
			aviso.classList.toggle("hidden", !texto);
			if (foco && foco.focus) foco.focus();
		}
		function cerrar() {
			document.removeEventListener("keydown", teclas, true);
			if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
			if (previo && previo.focus && document.body.contains(previo)) previo.focus();
		}
		function enfocables() {
			return Array.from(caja.querySelectorAll("input, select, textarea, button, summary"))
				.filter(function (el) { return !el.disabled && el.offsetParent !== null; });
		}
		function teclas(e) {
			if (e.key === "Escape") { e.preventDefault(); cerrar(); return; }
			if (e.key !== "Tab") return;
			var lista = enfocables();
			if (!lista.length) return;
			var primero = lista[0], ultimo = lista[lista.length - 1];
			if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
			else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
		}
		cancelar.addEventListener("click", cerrar);
		fondo.addEventListener("click", function (e) { if (e.target === fondo) cerrar(); });
		document.addEventListener("keydown", teclas, true);
		form.addEventListener("submit", async function (e) {
			e.preventDefault();
			avisar("");
			aceptar.disabled = true;
			var textoAceptar = aceptar.textContent;
			aceptar.textContent = "Guardando...";
			var seguir = false;
			try {
				seguir = (await opciones.alAceptar(form, avisar)) === false;
			} catch (err) {
				console.error("hoy: diálogo", err);
				avisar("No se pudo guardar: " + ((err && err.message) || "error desconocido") + ".");
				seguir = true;
			}
			aceptar.disabled = false;
			aceptar.textContent = textoAceptar;
			if (!seguir) cerrar();
		});
		document.body.appendChild(fondo);
		var primero = caja.querySelector("[data-foco]") || enfocables()[0];
		if (primero) primero.focus();
		return { cerrar: cerrar, avisar: avisar };
	}

	function campoTexto(etiqueta, atributos) {
		var cont = document.createElement("label");
		cont.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
		cont.textContent = etiqueta;
		var input = document.createElement("input");
		Object.keys(atributos || {}).forEach(function (k) { input.setAttribute(k, atributos[k]); });
		input.className = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-600";
		cont.appendChild(input);
		return { cont: cont, input: input };
	}

	// Sin señal no se crea, renombra ni quita un producto (no va por la cola: la captura de sus
	// calificaciones necesita su id de la base). Lo capturado sigue a salvo en el dispositivo
	var TEXTO_SIN_SENAL = "Esto necesita señal. Lo que ya capturaste sigue guardado en este dispositivo; inténtalo cuando vuelva la señal.";

	function gradosDeLaSesion(sesion) {
		var deProductos = [];
		(productosPorSesion[sesion.id] || []).forEach(function (p) { deProductos = deProductos.concat(p.grados || []); });
		var proyecto = proyectoPorId[sesion.proyecto_id] || {};
		return window.ProductosHoy.gradosPorOmision(deProductos, proyecto.grados || [], grupo.grados || []);
	}

	/*
		"Agregar actividad o tarea" en plena clase (decisión de Jorge del 2026-09-26): nombre,
		tipo, campo formativo (el de la sesión), grados (los de la sesión y el proyecto, con las
		casillas de los grados del grupo) y, en tareas, el día en que se revisa (por omisión el
		siguiente día hábil: AlcanceHoy.venceTarea). Se crea con origen 'maestro' y aparece de
		inmediato. La regla del alta tarde se respeta sola: la fecha del producto es la de la sesión.
		PDA (opcional, decisión de Jorge del 2026-09-26: "que cada actividad sume"): por omisión
		los de la sesión si el campo es el de la sesión; además se puede buscar un contenido del
		catálogo del campo elegido y marcar sus PDA. Un PDA elegido que la sesión no tiene se crea
		en sesiones_pda de esa sesión y grado (ProductosHoy.planLigas), para que el trigger de
		evaluación formativa y "Qué le falta" lo cuenten.
	*/
	/*
		sesionId null: ACTIVIDAD O TAREA SUELTA (sin proyecto, decisión de Jorge del 2026-09-26): se
		guarda en "Actividades del trimestre" del grupo (proyecto tipo 'sueltas', una sesión por fecha
		y campo: agregar_actividad_suelta, mi_salon_b17). Pide además el día de la actividad (una
		tarea suelta se deja hoy). "¿Para quién?" (los dos casos): todo el grupo, uno o varios grados
		o los alumnos que la maestra marca (ProductosHoy.planAsignacion); producto, asignación y PDA
		se guardan juntos en una transacción (agregar_producto_sesion).
	*/
	function agregarProducto(sesionId, origen) {
		var suelta = !sesionId;
		var sesion = suelta ? null : sesionesHoy.find(function (s) { return s.id === sesionId; });
		if (!suelta && !sesion) return;
		if (sinSenal()) { mensaje("error", "Agregar una actividad o una tarea necesita señal. Lo que ya capturaste sigue guardado en este dispositivo; inténtalo cuando vuelva la señal."); return; }
		var campoSesion = sesion && window.CamposFormativos ? window.CamposFormativos.corto(sesion.campo_formativo) : null;
		var gradosGrupo = (grupo.grados || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; }).sort(function (a, b) { return a - b; });
		// Los grados de los alumnos (por si el grupo no los tiene todos anotados)
		alumnos.forEach(function (a) { if (gradosGrupo.indexOf(Number(a.grado)) === -1) gradosGrupo.push(Number(a.grado)); });
		gradosGrupo.sort(function (a, b) { return a - b; });
		var porOmision = sesion ? gradosDeLaSesion(sesion) : gradosGrupo;
		var fechaOmision = window.AlcanceHoy.venceTarea(null, hoy, ajustesCal);
		var refs = {};
		var pda = { spda: suelta ? [] : null, contenidos: null, errorCatalogo: false, contenido: null, pdaContenido: [], cargandoContenido: false,
			tocadosSesion: {}, marcadosCatalogo: {} };
		var cargaPda = null; // la lectura de los PDA de la sesión (alAceptar la espera)

		// "¿Para quién?": lo elegido en el diálogo (ProductosHoy.planAsignacion)
		function planPara() {
			var modo = refs.para ? (refs.para.querySelector("input[name='paraNuevo']:checked") || {}).value : "grupo";
			return window.ProductosHoy.planAsignacion({
				modo: modo || "grupo",
				gradosGrupo: gradosGrupo,
				gradosElegidos: refs.para ? Array.from(refs.para.querySelectorAll("input[name='gradoNuevo']:checked")).map(function (c) { return Number(c.value); }) : porOmision,
				alumnos: alumnos,
				elegidos: refs.para ? Array.from(refs.para.querySelectorAll("input[name='alumnoNuevo']:checked")).map(function (c) { return c.value; }) : [],
				nivel: refs.nivel ? refs.nivel.value : "",
			});
		}
		// Los grados cuyos PDA se ofrecen: los de la actividad y los de sus alumnos incluidos
		function gradosElegidos() {
			var p = planPara();
			return p.ok ? p.gradosPda : [];
		}
		function campoLargo(corto) { return window.CamposFormativos ? window.CamposFormativos.largo(corto) : corto; }
		var estiloOpcion = "flex items-start gap-3 min-h-[44px] rounded-xl border border-gray-200 px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50";

		/*
			Sección "¿Para quién?": todo el grupo, uno o varios grados (en multigrado) o los alumnos
			que la maestra marca, agrupados por grado, con el grado con el que trabajan (por
			ejemplo dos de 3° que trabajan con 2°). omision: los grados por omisión.
		*/
		function construirParaQuien(omision) {
			var fs = document.createElement("fieldset");
			fs.className = "flex flex-col gap-2";
			var modo0 = omision.length && omision.length < gradosGrupo.length ? "grados" : "grupo";
			var opciones = [["grupo", "Todo el grupo"]];
			if (gradosGrupo.length > 1) opciones.push(["grados", "Uno o varios grados"]);
			opciones.push(["alumnos", "Alumnos que elijo"]);
			var etiqueta = "flex items-center gap-2 min-h-[44px] rounded-xl border border-gray-300 px-3 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50";
			fs.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>¿Para quién?</legend>" +
				"<div class='grid grid-cols-1 sm:grid-cols-" + opciones.length + " gap-2'>" + opciones.map(function (o) {
					return "<label class='" + etiqueta + "'><input type='radio' name='paraNuevo' value='" + o[0] + "'" + (o[0] === modo0 ? " checked" : "") +
						" class='h-5 w-5 text-blue-600'><span class='text-sm text-gray-800'>" + o[1] + "</span></label>";
				}).join("") + "</div>" +
				"<div data-para='grados' class='flex flex-wrap gap-2'>" + gradosGrupo.map(function (g) {
					return "<label class='" + etiqueta + "'><input type='checkbox' name='gradoNuevo' value='" + g + "'" +
						(omision.indexOf(g) !== -1 ? " checked" : "") + " class='h-5 w-5 text-blue-600 rounded'><span class='text-sm text-gray-800'>" + g + "°</span></label>";
				}).join("") + "</div>" +
				"<div data-para='alumnos' class='flex flex-col gap-2'>" + listaAlumnosHtml("alumnoNuevo", {}, {}) +
				"<label class='flex flex-col gap-1 text-sm font-medium text-gray-700'>¿Con qué grado trabajan?" +
				"<select data-nivel class='min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 bg-white'>" +
				"<option value=''>Cada uno con el suyo</option>" + [1, 2, 3, 4, 5, 6].map(function (g) {
					return "<option value='" + g + "'>Con " + g + "° (siguen en su grado para la boleta)</option>";
				}).join("") + "</select></label></div>";
			refs.para = fs;
			refs.nivel = fs.querySelector("select[data-nivel]");
			function mostrar() {
				var m = (fs.querySelector("input[name='paraNuevo']:checked") || {}).value;
				var g = fs.querySelector("[data-para='grados']"), a = fs.querySelector("[data-para='alumnos']");
				if (g) g.classList.toggle("hidden", m !== "grados");
				if (a) a.classList.toggle("hidden", m !== "alumnos");
			}
			fs.addEventListener("change", mostrar);
			mostrar();
			return fs;
		}

		// Sección "PDA que evalúa (opcional)"
		function construirPda(cuerpo) {
			var fs = document.createElement("fieldset");
			fs.className = "flex flex-col gap-2";
			fs.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>PDA que evalúa <span class='font-normal text-gray-500'>(opcional)</span></legend>";
			refs.pdaSesion = document.createElement("div");
			refs.pdaSesion.className = "flex flex-col gap-2";
			fs.appendChild(refs.pdaSesion);
			var busca = document.createElement("label");
			busca.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
			refs.buscaEtiqueta = document.createElement("span");
			refs.buscaEtiqueta.textContent = "Buscar un contenido del catálogo";
			busca.appendChild(refs.buscaEtiqueta);
			refs.busca = document.createElement("input");
			refs.busca.type = "search";
			refs.busca.autocomplete = "off";
			refs.busca.setAttribute("data-busca-contenido", "1");
			refs.busca.className = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-600";
			refs.busca.placeholder = "Escribe una palabra del contenido";
			busca.appendChild(refs.busca);
			fs.appendChild(busca);
			refs.resultados = document.createElement("div");
			refs.resultados.className = "flex flex-col gap-1";
			refs.resultados.setAttribute("aria-live", "polite");
			fs.appendChild(refs.resultados);
			refs.contenido = document.createElement("div");
			refs.contenido.className = "flex flex-col gap-2";
			fs.appendChild(refs.contenido);
			cuerpo.appendChild(fs);
			refs.busca.addEventListener("input", pintarResultados);
			// Enter en el buscador no envía el diálogo
			refs.busca.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
			refs.resultados.addEventListener("click", function (e) {
				var b = e.target.closest("[data-contenido]");
				if (b) elegirContenido(b.getAttribute("data-contenido"));
			});
			refs.contenido.addEventListener("click", function (e) {
				if (e.target.closest("[data-quitar-contenido]")) { quitarContenido(); pintarPda(); refs.busca.focus(); }
			});
			refs.contenido.addEventListener("change", function (e) {
				var c = e.target.closest("input[name='pdaCatalogo']");
				if (c) pda.marcadosCatalogo[c.value] = c.checked;
			});
			refs.pdaSesion.addEventListener("change", function (e) {
				var c = e.target.closest("input[name='pdaSesion']");
				if (c) pda.tocadosSesion[c.value] = c.checked;
			});
		}

		async function cargarPda() {
			if (!suelta) try {
				var res = await window.sb.from("sesiones_pda").select("id, pda_id, grado, criterio_aplicado, catalogo_pda(pda, catalogo_contenidos(campo_formativo))").eq("sesion_id", sesion.id).order("grado");
				if (res.error) throw res.error;
				// El campo de cada PDA es el de su contenido en el catálogo (ProductosHoy.pdaDeSesionParaActividad)
				pda.spda = (res.data || []).map(function (r) {
					var cp = Array.isArray(r.catalogo_pda) ? r.catalogo_pda[0] : r.catalogo_pda;
					var cc = cp && (Array.isArray(cp.catalogo_contenidos) ? cp.catalogo_contenidos[0] : cp.catalogo_contenidos);
					var corto = cc && window.CamposFormativos ? window.CamposFormativos.corto(cc.campo_formativo) : null;
					return Object.assign({}, r, { campo: corto || null });
				});
			} catch (err) {
				console.error("hoy: PDA de la sesión", err);
				pda.spda = null;
			}
			try {
				// Todas las fases: un alumno puede trabajar con otro grado ("¿Para quién?")
				pda.contenidos = await contenidosDelCatalogo(window.ProductosHoy.fasesDeGrados([1, 2, 3, 4, 5, 6]));
			} catch (err) {
				console.error("hoy: catálogo de contenidos", err);
				pda.errorCatalogo = true;
			}
			pintarPda();
		}

		// Marcado: lo que tocó la maestra; si no lo tocó, la regla (r.marcado)
		function marcadoSesion(r) {
			return Object.prototype.hasOwnProperty.call(pda.tocadosSesion, r.id) ? pda.tocadosSesion[r.id] : !!r.marcado;
		}

		function textoPda(r) {
			var cp = Array.isArray(r.catalogo_pda) ? r.catalogo_pda[0] : r.catalogo_pda;
			return (cp && cp.pda) || r.criterio_aplicado || "Criterio de la sesión";
		}

		function pintarPda() {
			if (!refs.pdaSesion) return;
			var campo = refs.campo ? refs.campo.value : "";
			var deSesion = window.ProductosHoy.pdaDeSesionParaActividad(pda.spda || [], campoSesion, campo, gradosElegidos());
			refs.pdaSesion.innerHTML = "";
			if (deSesion.length) {
				var t = document.createElement("p");
				t.className = "text-xs text-gray-500";
				t.textContent = "De esta sesión (marca los que esta actividad evalúa):";
				refs.pdaSesion.appendChild(t);
				deSesion.forEach(function (r) {
					var l = document.createElement("label");
					l.className = estiloOpcion;
					l.innerHTML = "<input type='checkbox' name='pdaSesion' class='h-5 w-5 mt-0.5 shrink-0 text-blue-600 rounded'" + (marcadoSesion(r) ? " checked" : "") + ">" +
						"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(r.grado) + "°</span> · " + esc(textoPda(r)) + "</span>";
					l.querySelector("input").value = r.id;
					refs.pdaSesion.appendChild(l);
				});
			}
			refs.buscaEtiqueta.textContent = campo ? "Buscar un contenido de " + campoLargo(campo) : "Elige el campo formativo para buscar su contenido";
			refs.busca.disabled = !campo || pda.errorCatalogo;
			pintarResultados();
			pintarContenido();
		}

		function pintarResultados() {
			if (!refs.resultados) return;
			refs.resultados.innerHTML = "";
			var campo = refs.campo ? refs.campo.value : "";
			if (pda.errorCatalogo) {
				refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>No se pudo cargar el catálogo de contenidos. Puedes agregar la actividad sin PDA.</p>";
				return;
			}
			if (!campo || pda.contenido) return;
			if (!pda.contenidos) { refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>Cargando el catálogo...</p>"; return; }
			var texto = refs.busca.value;
			if (!String(texto || "").trim()) return;
			var fases = window.ProductosHoy.fasesDeGrados(gradosElegidos());
			var todos = window.ProductosHoy.buscarContenidos(pda.contenidos, texto, campoLargo(campo), fases);
			if (!todos.length) {
				refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>Ningún contenido de " + esc(campoLargo(campo)) + " tiene esas palabras.</p>";
				return;
			}
			todos.slice(0, 8).forEach(function (c) {
				var b = document.createElement("button");
				b.type = "button";
				b.setAttribute("data-contenido", c.id);
				b.className = "w-full min-h-[44px] text-left rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:border-blue-400 hover:bg-blue-50";
				b.textContent = c.contenido;
				refs.resultados.appendChild(b);
			});
			if (todos.length > 8) {
				var mas = document.createElement("p");
				mas.className = "text-xs text-gray-500";
				mas.textContent = "Y " + (todos.length - 8) + " más: escribe otra palabra para acotar.";
				refs.resultados.appendChild(mas);
			}
		}

		async function elegirContenido(id) {
			var c = (pda.contenidos || []).find(function (x) { return x.id === id; });
			if (!c) return;
			pda.contenido = c;
			pda.pdaContenido = [];
			pda.marcadosCatalogo = {};
			pda.cargandoContenido = true;
			pintarResultados();
			pintarContenido();
			try {
				var res = await window.sb.from("catalogo_pda").select("id, grado, pda, orden").eq("contenido_id", c.id).in("grado", [1, 2, 3, 4, 5, 6]).order("orden");
				if (res.error) throw res.error;
				if (pda.contenido !== c) return;
				pda.pdaContenido = res.data || [];
				window.ProductosHoy.pdaMarcadosPorOmision(pda.pdaContenido, gradosElegidos()).forEach(function (pid) { pda.marcadosCatalogo[pid] = true; });
			} catch (err) {
				console.error("hoy: PDA del contenido", err);
				pda.pdaContenido = null;
			}
			pda.cargandoContenido = false;
			pintarContenido();
			var primera = refs.contenido.querySelector("input[name='pdaCatalogo'], [data-quitar-contenido]");
			if (primera) primera.focus();
		}

		function quitarContenido() {
			pda.contenido = null;
			pda.pdaContenido = [];
			pda.marcadosCatalogo = {};
			if (refs.busca) refs.busca.value = "";
		}

		function pintarContenido() {
			if (!refs.contenido) return;
			refs.contenido.innerHTML = "";
			if (!pda.contenido) return;
			var caja = document.createElement("div");
			caja.className = "flex items-start justify-between gap-2 rounded-xl bg-gray-50 border border-gray-200 pl-3";
			caja.innerHTML = "<p class='text-sm text-gray-800 py-2.5'><span class='block text-xs text-gray-500'>Contenido</span>" + esc(pda.contenido.contenido) + "</p>" +
				"<button type='button' data-quitar-contenido class='shrink-0 min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50'>Cambiar</button>";
			refs.contenido.appendChild(caja);
			if (pda.cargandoContenido) { refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>Cargando sus PDA...</p>"); return; }
			if (pda.pdaContenido === null) { refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>No se pudieron cargar sus PDA. Puedes agregar la actividad sin PDA.</p>"); return; }
			var g = gradosElegidos();
			// Sin repetir los que ya se ofrecen arriba como PDA de esta sesión (planLigas los reutiliza)
			var yaArriba = {};
			window.ProductosHoy.pdaDeSesionParaActividad(pda.spda || [], campoSesion, refs.campo ? refs.campo.value : "", g)
				.forEach(function (r) { if (r.pda_id) yaArriba[r.pda_id + "|" + Number(r.grado)] = true; });
			var deGrados = pda.pdaContenido.filter(function (p) { return g.indexOf(Number(p.grado)) !== -1 && !yaArriba[p.id + "|" + Number(p.grado)]; });
			if (!deGrados.length) {
				var yaEstan = pda.pdaContenido.some(function (p) { return yaArriba[p.id + "|" + Number(p.grado)]; });
				refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>" + (yaEstan
					? "Sus PDA de estos grados ya están arriba, entre los de esta sesión."
					: "Este contenido no tiene PDA para los grados elegidos.") + "</p>");
				return;
			}
			deGrados.forEach(function (p) {
				var l = document.createElement("label");
				l.className = estiloOpcion;
				l.innerHTML = "<input type='checkbox' name='pdaCatalogo' class='h-5 w-5 mt-0.5 shrink-0 text-blue-600 rounded'" + (pda.marcadosCatalogo[p.id] ? " checked" : "") + ">" +
					"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(p.grado) + "°</span> · " + esc(p.pda || "") + "</span>";
				l.querySelector("input").value = p.id;
				refs.contenido.appendChild(l);
			});
		}

		// Lo elegido al aceptar (solo lo visible: de los grados y el campo elegidos)
		function eleccionPda() {
			if (pda.spda === null) return null; // no se leyeron los de la sesión: como antes
			var campo = refs.campo ? refs.campo.value : "";
			var g = gradosElegidos();
			var deSesion = window.ProductosHoy.pdaDeSesionParaActividad(pda.spda, campoSesion, campo, g)
				.filter(marcadoSesion).map(function (r) { return r.id; });
			var deCatalogo = (pda.pdaContenido || []).filter(function (p) { return pda.marcadosCatalogo[p.id] && g.indexOf(Number(p.grado)) !== -1; })
				.map(function (p) { return { pda_id: p.id, grado: Number(p.grado) }; });
			return { deSesion: deSesion, deCatalogo: deCatalogo, spdaSesion: pda.spda };
		}

		abrirDialogo({
			origen: origen,
			titulo: suelta ? "Actividad o tarea suelta" : "Agregar actividad o tarea",
			subtitulo: suelta
				? "Sin proyecto: se guarda en " + window.AlcanceHoy.TITULO_SUELTAS + " y cuenta para la boleta. Después puedes pasarla a un proyecto."
				: esSuelta(sesion)
				? window.AlcanceHoy.TITULO_SUELTAS + " · " + (sesion.campo_formativo || "")
				: "Sesión " + (sesion.numero_sesion || "") + " · " + (sesion.campo_formativo || "") +
					((proyectoPorId[sesion.proyecto_id] || {}).titulo ? " · " + proyectoPorId[sesion.proyecto_id].titulo : ""),
			aceptar: "Agregar",
			construir: function (cuerpo) {
				var nombre = campoTexto("Nombre", { type: "text", maxlength: String(window.ProductosHoy.NOMBRE_MAX), autocomplete: "off",
					placeholder: "Por ejemplo: Cartel del cuento", "data-foco": "1" });
				refs.nombre = nombre.input;
				cuerpo.appendChild(nombre.cont);

				var tipo = document.createElement("fieldset");
				tipo.className = "flex flex-col gap-2";
				tipo.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>¿Qué es?</legend>" +
					"<div class='grid grid-cols-1 sm:grid-cols-2 gap-2'>" +
					["trabajo", "tarea"].map(function (t, i) {
						return "<label class='flex items-center gap-3 min-h-[44px] rounded-xl border border-gray-300 px-3 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50'>" +
							"<input type='radio' name='tipoNuevo' value='" + t + "'" + (i === 0 ? " checked" : "") + " class='h-5 w-5 text-blue-600'>" +
							"<span class='text-sm text-gray-800'>" + (t === "trabajo" ? "Actividad en clase" : "Tarea para casa") + "</span></label>";
					}).join("") + "</div>";
				cuerpo.appendChild(tipo);

				var campo = document.createElement("label");
				campo.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
				campo.textContent = "Campo formativo";
				var sel = document.createElement("select");
				sel.className = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 bg-white";
				window.ProductosHoy.CAMPOS.forEach(function (c) {
					var o = document.createElement("option");
					o.value = c;
					o.textContent = window.CamposFormativos ? window.CamposFormativos.largo(c) : c;
					if (c === campoSesion) o.selected = true;
					sel.appendChild(o);
				});
				if (!campoSesion) {
					var elige = document.createElement("option");
					elige.value = "";
					elige.textContent = "Elige el campo formativo...";
					elige.selected = true;
					sel.insertBefore(elige, sel.firstChild);
				}
				refs.campo = sel;
				campo.appendChild(sel);
				cuerpo.appendChild(campo);

				var grados = construirParaQuien(porOmision);
				cuerpo.appendChild(grados);
				refs.campo = sel;
				refs.grados = grados;

				construirPda(cuerpo);

				// Suelta: el día de la actividad (por omisión hoy). Cualquier día del trimestre en curso
				// (decisión de Jorge del 2026-09-26): uno que ya pasó se califica aquí mismo, al agregarla
				if (suelta) {
					var rango = rangoSuelta();
					var dia = campoTexto("Día de la actividad", { type: "date", min: rango.desde, max: rango.hasta, value: hoy });
					var ayudaDia = document.createElement("span");
					ayudaDia.className = "text-xs font-normal text-gray-500";
					ayudaDia.textContent = "Puede ser un día que ya pasó del trimestre: la calificas aquí mismo al agregarla. Un día que viene aparece en Hoy ese día.";
					dia.cont.appendChild(ayudaDia);
					refs.dia = dia.input;
					refs.diaCont = dia.cont;
					cuerpo.appendChild(dia.cont);
				}

				var fecha = campoTexto("Día en que se revisa la tarea", { type: "date", min: hoy, value: fechaOmision || "" });
				fecha.cont.classList.add("hidden");
				var ayuda = document.createElement("span");
				ayuda.className = "text-xs font-normal text-gray-500";
				ayuda.textContent = "Por omisión, el siguiente día de clase. Ese día aparece en Tareas por revisar.";
				fecha.cont.appendChild(ayuda);
				refs.fecha = fecha.input;
				refs.fechaCont = fecha.cont;
				cuerpo.appendChild(fecha.cont);

				tipo.addEventListener("change", function () {
					var esTarea = (tipo.querySelector("input:checked") || {}).value === "tarea";
					refs.fechaCont.classList.toggle("hidden", !esTarea);
					if (refs.diaCont) refs.diaCont.classList.toggle("hidden", esTarea); // la tarea suelta se deja hoy
				});
				refs.tipo = tipo;
				refs.grados = grados;
				sel.addEventListener("change", function () {
					if (pda.contenido && window.CamposFormativos && window.CamposFormativos.corto(pda.contenido.campo_formativo) !== sel.value) quitarContenido();
					pintarPda();
				});
				grados.addEventListener("change", pintarPda);
				cargaPda = cargarPda();
			},
			alAceptar: async function (form, avisar) {
				var plan = planPara();
				var focoPara = function (f) {
					return f === "alumnos" ? refs.para.querySelector("input[name='alumnoNuevo']") || refs.para.querySelector("input")
						: refs.para.querySelector(f === "grados" ? "input[name='gradoNuevo']" : "input");
				};
				if (!plan.ok) { avisar(plan.error, focoPara(plan.foco)); return false; }
				var datos = {
					nombre: refs.nombre.value,
					tipo: (refs.tipo.querySelector("input:checked") || {}).value,
					campo: refs.campo.value,
					grados: plan.grados,
					incluidos: plan.incluidos,
					fechaRevision: refs.fecha.value,
					fecha: refs.dia ? refs.dia.value : null,
				};
				var rangoV = suelta ? rangoSuelta() : {};
				var ctxV = { hoy: hoy, gradosSesion: porOmision, desde: rangoV.desde, hasta: rangoV.hasta };
				var v = suelta ? window.ProductosHoy.validarSuelta(datos, ctxV) : window.ProductosHoy.validarNuevo(datos, ctxV);
				if (!v.ok) {
					var foco = { nombre: refs.nombre, campo: refs.campo, fecha: refs.fecha, fechaSuelta: refs.dia,
						grados: focoPara("grados"), tipo: refs.tipo.querySelector("input") }[v.foco];
					avisar(v.error, foco);
					return false;
				}
				if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
				// PDA elegidos: los de la sesión se ligan y los del catálogo se reutilizan o se crean
				// Los PDA de la sesión se leen al abrir: si la maestra aceptó antes de que llegaran, se esperan
				if (cargaPda) await cargaPda;
				var eleccion = eleccionPda();
				var ligas = eleccion
					? window.ProductosHoy.planLigas({ grados: plan.gradosPda, deSesion: eleccion.deSesion, deCatalogo: eleccion.deCatalogo, spdaSesion: eleccion.spdaSesion })
					: { ligar: [], crear: [] };
				var producto = { tipo: v.fila.tipo, nombre: v.fila.nombre, grados: v.fila.grados, modalidad: v.fila.modalidad,
					campo: v.fila.campo, fecha_entrega: v.fila.fecha_entrega };
				// Producto, "para quién" y PDA en una sola transacción (mi_salon_b17)
				var res = suelta
					? await window.sb.rpc("agregar_actividad_suelta", { p_grupo: grupo.id, p_fecha: v.fecha, p_producto: producto,
						p_asignacion: plan.filas, p_crear: ligas.crear })
					: await window.sb.rpc("agregar_producto_sesion", { p_sesion: sesion.id, p_producto: producto,
						p_asignacion: plan.filas, p_ligar: ligas.ligar, p_crear: ligas.crear });
				if (res.error) {
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo agregar: " + (res.error.message || "error desconocido") + ".");
					return false;
				}
				var nuevo = suelta ? (res.data || {}).producto : res.data;
				var ses = sesion;
				if (suelta) ses = incorporarSesionSuelta(res.data);
				if (!nuevo || !nuevo.id) { avisar("No se pudo agregar: la base no devolvió la actividad."); return false; }
				nuevo.sesion = ses;
				asignaciones[nuevo.id] = window.AlcanceHoy.indiceAsignaciones(plan.filas.map(function (f) {
					return { producto_sesion_id: nuevo.id, alumno_id: f.alumno_id, modo: f.modo };
				}))[nuevo.id] || {};
				if (ses) {
					(productosPorSesion[ses.id] = productosPorSesion[ses.id] || []).push(nuevo);
					if (nuevo.tipo === "tarea") {
						var vence = venceDe(nuevo);
						if (vence && vence <= hoy) tareas.unshift(nuevo);
					}
				}
				renderTareas();
				renderSesiones();
				var cuando = suelta && nuevo.tipo !== "tarea" && v.fecha > hoy ? " Aparece en Hoy el " + fechaCorta(v.fecha) + " para calificarla."
					: suelta && nuevo.tipo !== "tarea" && v.fecha < hoy ? " Es del " + fechaCorta(v.fecha) + ": califícala aquí abajo." : "";
				mensaje("info", (nuevo.tipo === "tarea" ? "Se agregó la tarea «" : "Se agregó la actividad «") + nuevo.nombre + "» para " +
					paraQuien(nuevo) + "." + cuando +
					(nuevo.tipo === "tarea" ? " Se revisa el " + fechaCorta(ses ? venceDe(nuevo) : nuevo.fecha_entrega) + "." : "") +
					(eleccion ? "" : " No se pudieron leer los PDA de la sesión: se agregó sin PDA; sus calificaciones cuentan igual para la boleta."));
			},
		});
	}

	/*
		Una actividad suelta recién creada: su sesión (la de esa fecha y campo en "Actividades del
		trimestre") entra a la pantalla si es de hoy. → la sesión, o null si es de otro día.
	*/
	function incorporarSesionSuelta(r) {
		if (!r || !r.sesion || !r.sesion.id) return null;
		if (r.proyecto_id && !proyectoPorId[r.proyecto_id]) {
			proyectoPorId[r.proyecto_id] = { id: r.proyecto_id, titulo: window.AlcanceHoy.TITULO_SUELTAS, tipo: "sueltas", estado: "completado" };
		}
		var s = sesionesHoy.find(function (x) { return x.id === r.sesion.id; });
		if (s) return s;
		// De hoy o de un día que ya pasó (se califica ahora); la de un día que viene, ese día
		if (!r.sesion.fecha || r.sesion.fecha > hoy) return null;
		s = { id: r.sesion.id, numero_sesion: r.sesion.numero_sesion, fecha: r.sesion.fecha, campo_formativo: r.sesion.campo_formativo,
			momento: null, proyecto_id: r.proyecto_id, estado_sesion: r.sesion.estado_sesion };
		sesionesHoy.push(s);
		return s;
	}

	// Casillas de los alumnos del grupo, por grado. marcados / bloqueados: { alumnoId: true }
	function listaAlumnosHtml(nombre, marcados, bloqueados) {
		return "<div class='max-h-72 overflow-y-auto rounded-xl border border-gray-200 p-2 flex flex-col gap-1'>" +
			agruparPorGrado(alumnos).map(function (g) {
				return "<p class='text-xs font-semibold text-gray-500 mt-1'>" + g.grado + "° grado</p>" +
					"<div class='grid grid-cols-1 sm:grid-cols-2 gap-1'>" + g.alumnos.map(function (a) {
						var bloq = bloqueados && bloqueados[a.id];
						return "<label class='flex items-center gap-3 min-h-[44px] rounded-lg px-2 cursor-pointer hover:bg-gray-50 has-[:checked]:bg-blue-50'>" +
							"<input type='checkbox' name='" + nombre + "' value='" + esc(a.id) + "'" + (marcados && marcados[a.id] ? " checked" : "") +
							(bloq ? " disabled" : "") + " class='h-5 w-5 text-blue-600 rounded shrink-0'>" +
							"<span class='text-sm text-gray-800'>" + esc(a.nombre_completo) +
							(bloq ? "<span class='block text-xs text-gray-500'>Ya tiene calificación: no se puede quitar</span>" : "") + "</span></label>";
					}).join("") + "</div>";
			}).join("") + "</div>";
	}

	/*
		"Para quién" de un producto ya creado (decisión de Jorge del 2026-09-26): agregar alumnos
		siempre se puede; quitar, solo a quien no tiene calificación (su casilla sale bloqueada y la
		base lo revisa otra vez: guardar_asignacion_producto). Sus grados no cambian.
	*/
	function editarParaQuien(productoId, origen) {
		var producto = productoPorId(productoId);
		if (!producto) return;
		if (sinSenal()) { mensaje("error", "Cambiar para quién es necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")); return; }
		var marcados = {}, bloqueados = {};
		alumnos.forEach(function (a) {
			if (!window.AlcanceHoy.asignadoA(a, producto, asignaciones)) return;
			marcados[a.id] = true;
			if (window.ProductosHoy.tieneCaptura(calificaciones[a.id + "|" + producto.id])) bloqueados[a.id] = true;
		});
		var refs = {};
		abrirDialogo({
			origen: origen,
			titulo: "¿Para quién es «" + producto.nombre + "»?",
			subtitulo: "Marca a los alumnos que la hacen. Cada uno sigue en su grado para la boleta." +
				(window.ProductosHoy.etiquetaGrados(producto.grados) ? " La actividad es de " + window.ProductosHoy.etiquetaGrados(producto.grados) + "." : ""),
			aceptar: "Guardar",
			construir: function (cuerpo) {
				var cont = document.createElement("div");
				cont.innerHTML = listaAlumnosHtml("alumnoPara", marcados, bloqueados);
				refs.lista = cont;
				cuerpo.appendChild(cont);
			},
			alAceptar: async function (form, avisar) {
				var quieren = {};
				Array.from(refs.lista.querySelectorAll("input[name='alumnoPara']")).forEach(function (c) {
					// Una casilla bloqueada (ya tiene calificación) se queda como estaba
					if (c.checked || c.disabled) quieren[c.value] = true;
				});
				if (!Object.keys(quieren).length) { avisar("Marca al menos un alumno.", refs.lista.querySelector("input")); return false; }
				if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
				var filas = window.ProductosHoy.filasDeEdicion(producto.grados, alumnos, quieren);
				var res = await window.sb.rpc("guardar_asignacion_producto", { p_producto: producto.id, p_filas: filas });
				if (res.error) {
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo guardar: " + (res.error.message || "error desconocido"));
					return false;
				}
				var idx = {};
				filas.forEach(function (f) { idx[f.alumno_id] = f.modo; });
				asignaciones[producto.id] = idx;
				renderTareas();
				renderPendientes();
				renderSesiones();
				mensaje("info", "«" + producto.nombre + "» ahora es para " + paraQuien(producto) + ".");
			},
		});
	}

	/*
		"Pasar a un proyecto" una actividad suelta (decisión de Jorge del 2026-09-26): a una sesión de
		un proyecto del mismo grupo y trimestre, con sus calificaciones, su "para quién" y sus PDA
		(mover_producto_a_sesion, mi_salon_b17; el diálogo vive en js/pasar-a-proyecto.js, el mismo de
		Proyectos). Antes se envía lo capturado (una captura pendiente de esa actividad iría a la
		sesión vieja) y después se recarga la pantalla.
	*/
	async function pasarAProyecto(productoId, origen) {
		var producto = productoPorId(productoId);
		if (!producto || !window.PasarAProyecto) return;
		guardarRetrosPendientes();
		if (sinSenal()) { mensaje("error", "Pasar a un proyecto necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")); return; }
		if (bandeja && bandeja.pendientes()) {
			origen.disabled = true;
			var envio = await bandeja.esperarEnvio();
			origen.disabled = false;
			if (envio !== "ok") { mensaje("error", "Primero hay que enviar lo capturado y ahora no se pudo. Lo capturado sigue guardado en este dispositivo; inténtalo en un momento."); return; }
		}
		var proyecto = proyectoPorId[(producto.sesion || {}).proyecto_id] || {};
		window.PasarAProyecto.abrir({
			sb: window.sb, maestroId: user.id, grupoId: grupo.id, trimestre: proyecto.trimestre || grupo.trimestre_actual,
			producto: producto, fechaEntrega: producto.tipo === "tarea" ? venceDe(producto) : null, origen: origen,
			alTerminar: function () { window.location.reload(); },
		});
	}

	// Contenidos del catálogo de las fases del grupo (se leen una vez por página)
	var contenidosCache = {};
	function contenidosDelCatalogo(fases) {
		var clave = (fases || []).join(",");
		if (!contenidosCache[clave]) {
			contenidosCache[clave] = (async function () {
				var res = await window.sb.from("catalogo_contenidos").select("id, fase, campo_formativo, contenido, orden")
					.in("fase", fases && fases.length ? fases : ["Fase 3", "Fase 4", "Fase 5"]).order("orden").range(0, 999);
				if (res.error) throw res.error;
				return res.data || [];
			})();
			contenidosCache[clave].catch(function () { delete contenidosCache[clave]; });
		}
		return contenidosCache[clave];
	}

	function renombrarProducto(productoId, origen) {
		var producto = productoPorId(productoId);
		if (!producto) return;
		if (sinSenal()) { mensaje("error", "Renombrar necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")); return; }
		var refs = {};
		abrirDialogo({
			origen: origen,
			titulo: "Renombrar",
			subtitulo: (producto.tipo === "tarea" ? "Tarea" : "Actividad") + " para " + window.ProductosHoy.etiquetaGrados(producto.grados),
			aceptar: "Guardar nombre",
			construir: function (cuerpo) {
				var n = campoTexto("Nombre", { type: "text", maxlength: String(window.ProductosHoy.NOMBRE_MAX), autocomplete: "off", "data-foco": "1" });
				n.input.value = producto.nombre || "";
				refs.nombre = n.input;
				cuerpo.appendChild(n.cont);
			},
			alAceptar: async function (form, avisar) {
				var v = window.ProductosHoy.validarNombre(refs.nombre.value);
				if (!v.ok) { avisar(v.error, refs.nombre); return false; }
				if (v.nombre === producto.nombre) return;
				if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
				var res = await window.sb.from("productos_sesion").update({ nombre: v.nombre })
					.eq("id", producto.id).eq("maestro_id", user.id);
				if (res.error) {
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo renombrar: " + (res.error.message || "error desconocido") + ".");
					return false;
				}
				producto.nombre = v.nombre;
				renderTareas();
				renderSesiones();
				mensaje("info", "Nombre guardado: «" + v.nombre + "».");
			},
		});
	}

	/*
		Quitar un producto (activo = false: ya no se califica ni cuenta en el motor, "Qué le
		falta" ni los reportes). Solo si no tiene calificaciones: se revisa lo de esta pantalla
		(también lo pendiente de enviar) y la base.
	*/
	async function quitarProducto(productoId, origen) {
		var producto = productoPorId(productoId);
		if (!producto) return;
		// Con captura en esta pantalla (también lo pendiente de enviar)
		function conCapturaAqui() {
			return alumnos.some(function (al) {
				return window.ProductosHoy.tieneCaptura(calificaciones[al.id + "|" + producto.id]);
			});
		}
		// Con calificaciones en la base (lanza si no se pudo leer)
		async function calificadasEnBase() {
			var res = await window.sb.from("calificaciones").select("id", { count: "exact", head: true })
				.eq("maestro_id", user.id).eq("producto_sesion_id", producto.id)
				.or("estado_entrega.not.is.null,nivel.not.is.null,puntaje.not.is.null,retroalimentacion.not.is.null");
			if (res.error) throw res.error;
			return res.count || 0;
		}
		var avisoConCal = "«" + producto.nombre + "» ya tiene calificaciones, así que no se puede quitar. Si el nombre no es el correcto, usa Renombrar.";
		// Se calificó mientras el diálogo estaba abierto (otra pestaña u otro aparato: R25a-r09)
		var avisoCarrera = "Mientras decidías, se calificó «" + producto.nombre + "»; no se quitó. Recarga la página para ver esa calificación.";
		if (conCapturaAqui()) { mensaje("error", avisoConCal); return; }
		if (sinSenal()) { mensaje("error", "Quitar necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")); return; }
		origen.disabled = true;
		var enBaseCon = 0;
		try {
			enBaseCon = await calificadasEnBase();
		} catch (err) {
			origen.disabled = false;
			mensaje("error", sinSenal() ? "Quitar necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")
				: "No se pudo revisar si tiene calificaciones, así que no se quitó: " + ((err && err.message) || "error desconocido") + ".");
			return;
		}
		origen.disabled = false;
		if (enBaseCon > 0) { mensaje("error", avisoConCal); return; }
		abrirDialogo({
			origen: origen,
			titulo: "¿Quitar «" + producto.nombre + "»?",
			subtitulo: "Ya no aparecerá para calificar y no cuenta en la boleta. Nadie lo ha calificado todavía.",
			aceptar: "Quitar",
			peligro: true,
			alAceptar: async function (form, avisar) {
				if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
				// Se vuelve a revisar justo antes: mientras el diálogo estuvo abierto, otra pestaña pudo
				// calificarlo (la base también lo rechaza: productos_sesion_no_quitar_calificado, b17)
				var yaCalificado = conCapturaAqui();
				if (!yaCalificado) {
					try {
						yaCalificado = (await calificadasEnBase()) > 0;
					} catch (err) {
						avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo revisar si tiene calificaciones, así que no se quitó: " + ((err && err.message) || "error desconocido") + ".");
						return false;
					}
				}
				if (yaCalificado) { mensaje("error", avisoCarrera); return; }
				var upd = await window.sb.from("productos_sesion").update({ activo: false })
					.eq("id", producto.id).eq("maestro_id", user.id);
				if (upd.error) {
					if (String(upd.error.hint || "") === "producto_con_calificaciones" || /se calific/i.test(String(upd.error.message || ""))) {
						mensaje("error", avisoCarrera);
						return;
					}
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo quitar: " + (upd.error.message || "error desconocido") + ".");
					return false;
				}
				var lista = productosPorSesion[producto.sesion_id] || [];
				productosPorSesion[producto.sesion_id] = lista.filter(function (p) { return p.id !== producto.id; });
				tareas = tareas.filter(function (t) { return t.id !== producto.id; });
				renderTareas();
				renderSesiones();
				mensaje("info", "Se quitó «" + producto.nombre + "».");
			},
		});
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
				CAMPOS_CAL.forEach(function (f) { if (f in v) c[f] = v[f]; });
				if (!c.id && d.id) c.id = d.id;
				calificaciones[k] = c;
			}
		});
	}

	// Atajos de la app ("Pasar lista" → #asistencia, "Calificar trabajos" → #sesiones): el
	// salto se hace después de pintar, porque las listas se llenan tarde
	function irASeccion() {
		var id = (window.location.hash || "").slice(1);
		// La actividad suelta que se abrió desde Proyectos ("Calificar")
		if (sesionPedida) {
			var ses = document.getElementById("ses-" + sesionPedida);
			if (ses && ses.scrollIntoView) { ses.scrollIntoView({ block: "start" }); return; }
		}
		if (["asistencia", "tareas", "sesiones", "cierre"].indexOf(id) === -1) return;
		var el = document.getElementById(id);
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
	}

	// "Actividad suelta": una actividad o tarea sin proyecto, en cualquier momento (guiar sin obligar)
	var btnSuelta = document.getElementById("btnSuelta");
	if (btnSuelta && btnSuelta.addEventListener) {
		btnSuelta.addEventListener("click", function () {
			if (!pintado) return;
			agregarProducto(null, btnSuelta);
		});
	}
	// Desde Inicio o Proyectos: hoy.html?nueva=suelta abre el diálogo al terminar de cargar
	function abrirSueltaDeUrl() {
		try {
			if (new URLSearchParams(window.location.search || "").get("nueva") !== "suelta") return;
			if (window.history && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + (window.location.hash || ""));
			agregarProducto(null, btnSuelta);
		} catch (e) {
			console.error("hoy: abrir actividad suelta", e);
		}
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
		["pendientes de la clase anterior", renderPendientes],
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
	abrirSueltaDeUrl();
});
