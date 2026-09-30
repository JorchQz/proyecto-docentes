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
	var registro = {};        // alumno_id -> {participacion, conducta, nota}; nota = el comentario del día (mi_salon_b25)
	var registroGuardado = {}; // alumno_id -> true si ya hay fila de hoy en registro_diario
	// Comentarios del día a medio escribir: alumno_id -> { texto, timer } (se guardan tras una pausa, como la
	// retroalimentación; el texto escrito sobrevive a un nuevo dibujo del Cierre)
	var notasPendientes = {};
	var NOTA_MAX = 500;
	// La jornada de hoy ya finalizada ({ cerrada_en, actualizada_en }) o null (lectura opcional de `jornadas`, b25)
	var jornadaHoy = null;
	var esperandoJornada = false;
	var calificaciones = {};  // alumno_id|producto_id -> fila de calificaciones
	var tareas = [], sesionesHoy = [], productosPorSesion = {};
	var sesionPedida = null; // la sesión de la actividad suelta que se abrió desde Proyectos (?calificar=)
	// "Trabajar hoy": por cada proyecto activo, su siguiente sesión sin fecha y las demás
	// pendientes (js/productos-hoy.js): [{ proyecto, siguiente, otras }]
	var siguientes = [];
	var proyectoPorId = {};    // proyectos que mira Hoy (título, grados y tipo)
	var detallesAbiertos = {}; // qué paneles de detalle quedan abiertos entre renders
	// Hoy se vuelve a dibujar en cada toque: lo que el docente desplegó se recuerda aquí (en memoria)
	var productosAbiertos = {};   // producto_id -> true: la actividad está abierta para calificar
	var secuenciasAbiertas = {};  // sesion_id -> true: la secuencia de la sesión está desplegada
	var restantesAbiertas = {};   // proyecto_id -> true: la lista de sesiones restantes está abierta
	var secuencias = {};          // sesion_id -> fila de `sesiones` con su secuencia (lectura opcional)
	var secuenciaCargando = {};   // sesion_id -> true mientras se lee
	var secuenciaFalla = {};      // sesion_id -> true si no se pudo leer
	var asistenciaPlegada = false; // la tarjeta de Asistencia está plegada (con todo capturado)
	var plegarAsistenciaTimer = null;
	// Días sin clase (o con clase) del grupo sobre el calendario SEP (calendario_ajustes): con ellos
	// vencen las tareas y se revisa lo incompleto el siguiente día de clase (js/alcance-hoy.js)
	var ajustesCal = [];
	// Para quién es cada producto además de sus grados (producto_sesion_alumnos, mi_salon_b17):
	// { productoId: { alumnoId: "incluir" | "excluir" } } — regla única en AlcanceHoy.recibeProducto
	var asignaciones = {};
	// Grados de los PDA ligados a cada producto ({ productoId: [1, 2] }): de ellos sale la nota
	// "Trabaja con 1°" de un alumno incluido de otro grado (AlcanceHoy.trabajaCon)
	var gradosPda = {};
	// "Pendientes de la clase anterior" que se revisaron en esta visita (siguen a la vista para
	// poder corregir un toque): alumno|producto → true
	var revisadosAqui = {};
	// Faltas (decisiones de Jorge del 2026-09-29; js/alcance-hoy.js, "Faltas"). asisPasadas: las asistencias
	// del grupo desde el primer día trabajado, { alumnoId: { fecha: { estado, actualizada } } }; la de hoy se
	// toma de `asistencia` (asisDe). faltasFalla: la lectura falló (Hoy sigue, sin esa parte).
	var asisPasadas = {};
	var faltasFalla = false;
	var todasLasSesiones = [];      // todas las sesiones de los proyectos que mira Hoy (bloqueo de "Trabajar hoy")
	var faltaVistos = {};           // "Por falta justificada" que se calificaron en esta visita (siguen a la vista para corregir)
	var esperandoTerminar = false;  // se está terminando una sesión
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

	// Deja a la vista el aviso de arriba (#hoyMensaje): el mismo desplazamiento de "Ver detalle" del aviso fijo
	function irAlMensaje() {
		var el = document.getElementById("hoyMensaje");
		if (!el || !el.scrollIntoView) return;
		if (el.style) el.style.scrollMarginTop = "8rem"; // la barra de arriba es fija
		if (el.setAttribute) el.setAttribute("tabindex", "-1");
		el.scrollIntoView({ block: "start", behavior: "smooth" });
		try { el.focus({ preventScroll: true }); } catch (_) { /* sin foco */ }
	}

	/*
		Por qué no se pudo hacer una acción que el docente tocó abajo (Terminar sesión, Finalizar jornada, Pasar a un
		proyecto, Trabajar hoy o Quitar de hoy): el aviso sale arriba, y a 390 px solo se veía la barra ámbar de "Sin
		señal" (R36). Se muestra y la página se desplaza hasta él.
	*/
	function avisoALaVista(texto) {
		mensaje("error", texto);
		irAlMensaje();
	}

	/*
		Por qué falló algo, en español y sin tecnicismos. El texto técnico de la base (en inglés, p. ej.
		"column … does not exist" si falta una migración) va solo a la consola. Los mensajes propios
		de las funciones y triggers de la base ya vienen en español y se muestran tal cual.
	*/
	function textoError(e) {
		if (e && typeof console !== "undefined") console.warn("hoy: detalle del error", e);
		var code = e && e.code ? String(e.code) : "";
		var msg = String((e && e.message) || "");
		if (/^(42703|42P01|42883|PGRST20[0-5])$/.test(code) || /does not exist|schema cache|could not find/i.test(msg)) {
			return "la base de datos todavía no tiene la actualización que usa esta pantalla; avisa a soporte@jissez.com";
		}
		if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out/i.test(msg)) {
			return "no hubo conexión con el servidor";
		}
		if (/jwt|token/i.test(msg) || code === "PGRST301" || code === "PGRST303") return "tu sesión venció; vuelve a entrar";
		// Sin texto, o un texto técnico en inglés de la base: uno genérico
		if (!msg || /\b(violates|permission denied|duplicate key|invalid input|null value|syntax error|unexpected|column|relation|function|failed|error)\b/i.test(msg)) {
			return code === "42501" ? "la base no lo permitió" : "hubo un error en el servidor";
		}
		return msg.replace(/\.$/, "");
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
		Aviso de guardado (Fanny, 2026-09-29: la pastilla verde de abajo se confundía con el chip
		Presente y lo tapaba). Ahora:
		  - "Guardando…" y "Todo guardado" son una línea discreta en el encabezado azul (#hoyEstadoLinea,
		    con el texto en #hoyEstadoGuardado): sin verde y sin flotar;
		  - abajo solo flotan "Sin señal" (ámbar) y los errores (rojo), anchos y con
		    pointer-events-none, para que nunca estorben un toque; la página aparta espacio al final
		    (reservarEspacio) y no tapan la última fila.
	*/
	var ICONOS_ESTADO = {
		ok: "<svg xmlns='http://www.w3.org/2000/svg' class='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5'/></svg>",
		guardando: "<svg xmlns='http://www.w3.org/2000/svg' class='h-3.5 w-3.5 motion-safe:animate-spin' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-6.219-8.56'/></svg>",
		pendiente: "<svg xmlns='http://www.w3.org/2000/svg' class='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><path d='M12 8v4'/><path d='M12 16h.01'/></svg>",
	};

	/*
		Pila fija abajo (a la vista donde esté el docente, también en el Cierre del día): el aviso
		de "Sin señal" o de error de la cola y el aviso de lo que no se guardó, uno sobre otro, sin
		encimarse. Todo es pointer-events-none salvo los botones del aviso de lo que no se guardó.
	*/
	function pilaFija() {
		if (typeof document.createElement !== "function" || !document.body) return null;
		var pila = document.getElementById("hoyAvisosFijos");
		if (pila && pila.appendChild) return pila;
		pila = document.createElement("div");
		pila.id = "hoyAvisosFijos";
		pila.className = "fixed inset-x-4 bottom-4 z-40 flex flex-col items-center gap-2 pointer-events-none";
		document.body.appendChild(pila);
		return pila;
	}

	// Aparta al final de la página lo que mide la pila (más su margen), para que lo que flota nunca
	// tape la última fila. Sin nada flotando, no aparta nada.
	function reservarEspacio() {
		var reserva = document.getElementById("hoyReserva");
		var pila = document.getElementById("hoyAvisosFijos");
		if (!reserva || !reserva.style || !pila || pila.offsetHeight === undefined) return;
		var hayAlgo = pila.children && pila.children.length > 0;
		reserva.style.height = hayAlgo ? (pila.offsetHeight + 24) + "px" : "0px";
	}
	if (typeof window.addEventListener === "function") window.addEventListener("resize", reservarEspacio);

	// La línea del encabezado: tipo "ok" | "guardando" | "pendiente"; sin texto, se esconde
	// (ocupa su lugar: no mueve nada al aparecer)
	function estadoGuardado(texto, tipo) {
		var el = document.getElementById("hoyEstadoGuardado");
		var linea = document.getElementById("hoyEstadoLinea");
		var icono = document.getElementById("hoyEstadoIcono");
		if (!el) return;
		if (!texto) { if (linea && linea.classList) linea.classList.add("invisible"); return; }
		el.textContent = texto;
		if (icono) icono.innerHTML = ICONOS_ESTADO[tipo] || "";
		if (linea) {
			if (linea.classList) linea.classList.remove("invisible");
			linea.className = "mt-1 min-h-[20px] flex items-center gap-1.5 text-xs " + (tipo === "pendiente" ? "text-amber-200 font-semibold" : "text-blue-200");
		}
	}

	// "Sin señal" (tipo "red", ámbar) o un error (rojo) flotando abajo; sin texto, se quita
	function avisoFlotante(texto, tipo) {
		var pila = pilaFija();
		if (!pila) return;
		var el = document.getElementById("hoyEstadoFlotante");
		if (!texto) {
			if (el && el.parentNode) el.parentNode.removeChild(el);
			reservarEspacio();
			return;
		}
		if (!el || el.parentNode !== pila) {
			el = document.createElement("div");
			el.id = "hoyEstadoFlotante";
			el.setAttribute("role", "status");
			pila.appendChild(el);
		}
		el.className = "pointer-events-none w-full max-w-2xl text-center rounded-xl border px-3 py-1 text-xs font-medium shadow backdrop-blur-sm " +
			(tipo === "red" ? "bg-amber-100/80 text-amber-900 border-amber-300/70" : "bg-red-50 text-red-800 border-red-300");
		el.textContent = texto;
		reservarEspacio();
	}

	// El aviso visible de la cola: "Guardando…" mientras haya algo y "Todo guardado" cuando se vacía;
	// sin señal o con un error, la línea de arriba dice "Pendiente de enviar" y abajo flota el aviso
	function pintarBandeja(e) {
		if (!e.pendientes) {
			// Si algo no se guardó, lo dice el aviso de abajo: no se anuncia "Todo guardado"
			avisoFlotante("");
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
			estadoGuardado("Pendiente de enviar", "pendiente");
			avisoFlotante("Sin señal: " + n + resguardo, "red");
		} else if (e.estado === "servidor") {
			// Hubo respuesta (un error del servidor): no es falta de señal
			estadoGuardado("Pendiente de enviar", "pendiente");
			avisoFlotante("No se pudo guardar por ahora; se reintentará. " + n.charAt(0).toUpperCase() + n.slice(1) + resguardo, "error");
		} else if (e.estado === "cuenta") {
			estadoGuardado("Pendiente de enviar", "pendiente");
			avisoFlotante("En este dispositivo entró otra cuenta. " + (e.pendientes === 1
				? "1 captura pendiente de la cuenta anterior sigue guardada aquí y se enviará"
				: e.pendientes + " capturas pendientes de la cuenta anterior siguen guardadas aquí y se enviarán") +
				" cuando ella vuelva a entrar y abra Hoy.", "error");
		} else if (e.estado === "sesion") {
			estadoGuardado("Pendiente de enviar", "pendiente");
			avisoFlotante("Tu sesión se cerró: " + n + ". Siguen en este dispositivo; vuelve a iniciar sesión para enviarlas.", "error");
		} else if (e.estado === "acceso") {
			// Solo lectura de Mi Salón (b21): la base ya no las acepta; no se descartan
			estadoGuardado("Pendiente de enviar", "pendiente");
			avisoFlotante(n.charAt(0).toUpperCase() + n.slice(1) + ". " + window.BandejaSalida.TEXTO_ACCESO_PANTALLA, "error");
		} else {
			avisoFlotante("");
			estadoGuardado(e.persistente ? "Guardando…" : "Guardando… no cierres esta página.", "guardando");
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
		reservarEspacio();
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
		// La caja no recibe toques (lo de abajo se sigue tocando); solo sus botones
		caja.className = "pointer-events-none w-full max-w-lg rounded-2xl border border-red-200 bg-white shadow-xl p-4 text-sm text-red-800";
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
		ver.className = "pointer-events-auto min-h-[44px] px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700";
		ver.textContent = "Ver detalle";
		ver.addEventListener("click", function () {
			if (caja.parentNode) caja.parentNode.removeChild(caja);
			reservarEspacio();
			irAlMensaje();
		});
		var cerrar = document.createElement("button");
		cerrar.type = "button";
		cerrar.className = "pointer-events-auto min-h-[44px] px-4 rounded-lg border border-red-200 bg-white text-sm font-semibold text-red-700 hover:bg-red-50";
		cerrar.textContent = "Cerrar";
		cerrar.addEventListener("click", function () { if (caja.parentNode) caja.parentNode.removeChild(caja); reservarEspacio(); });
		acciones.appendChild(ver);
		acciones.appendChild(cerrar);
		caja.appendChild(titulo);
		caja.appendChild(ultimo);
		caja.appendChild(acciones);
		pila.insertBefore(caja, pila.firstChild);
		reservarEspacio();
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

	/*
		opciones: { campos: [los que tocó la maestra] } o { relleno: true } (1 y 1 del cierre).
		Devuelve la promesa de encolar. bandeja.agregar es ASÍNCRONO: justo después de llamarlo la captura todavía no
		está en la cola y bandeja.pendientes() no la cuenta (R36). Por eso se lleva aquí lo que se está encolando
		(`encolando`), y quien necesita que TODO llegue a la base antes de seguir usa esperarCola().
	*/
	var encolando = [];
	function guardar(tipo, datos, descripcion, opciones) {
		if (!bandeja) return Promise.resolve();
		var p = bandeja.agregar(tipo, datos, descripcion, baseDe(tipo, datos), opciones).catch(function (e) { console.error("hoy: no se pudo encolar", e); });
		encolando.push(p);
		p.then(function () {
			var i = encolando.indexOf(p);
			if (i !== -1) encolando.splice(i, 1);
		});
		return p;
	}

	// Espera a que entre a la cola del dispositivo todo lo que se mandó a encolar (también lo que se encole mientras tanto)
	async function esperarEncolado() {
		while (encolando.length) await Promise.all(encolando.slice());
	}

	/*
		Que todo lo capturado llegue a la base: primero lo que se está encolando y después, SIEMPRE, esperarEnvio de la
		bandeja (sin mirar pendientes(), que no cuenta lo que aún se encola). Si mientras tanto se capturó algo más, se
		vuelve a esperar. → "ok" o el estado de la cola que lo impidió ("red", "servidor", "sesion"...; "pendiente": se
		siguió capturando y quedó algo por enviar).
	*/
	async function esperarCola() {
		if (!bandeja) return "ok";
		for (var vuelta = 0; vuelta < 3; vuelta++) {
			await esperarEncolado();
			var envio = await bandeja.esperarEnvio();
			if (envio !== "ok") return envio;
			if (!encolando.length && !bandeja.pendientes()) return "ok";
		}
		return "pendiente";
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
				renderTareas();
				renderPendientes();
				repintarSesiones(); // quien faltó no aparece para calificar
				renderCierre();
			} else if (it.tipo === "registro" || it.tipo === "registro_borrar") {
				if (d.fecha !== hoy) return;
				if (v) {
					registro[d.alumno_id] = { participacion: v.participacion, conducta: v.conducta, nota: v.nota === undefined ? null : v.nota };
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

	/*
		La base rechazó una calificación porque su actividad se quitó en otra pantalla o aparato
		(hint 'producto_inactivo', mi_salon_b19a): esa actividad sale de esta pantalla, como si se
		hubiera quitado aquí, para que no se siga capturando en ella.
	*/
	function quitarDePantalla(it) {
		var d = (it && it.datos) || {};
		var productoId = it && it.tipo === "calificacion" && d.fila ? d.fila.producto_sesion_id : null;
		if (!productoId) return;
		try {
			Object.keys(productosPorSesion).forEach(function (s) {
				productosPorSesion[s] = (productosPorSesion[s] || []).filter(function (p) { return p.id !== productoId; });
			});
			tareas = tareas.filter(function (t) { return t.id !== productoId; });
			if (!pintado) return;
			renderTareas();
			renderPendientes();
			repintarSesiones();
		} catch (e) {
			console.error("hoy: no se pudo quitar de la pantalla la actividad quitada", e);
		}
	}

	// ¿Lo que muestra la pantalla es distinto de `v` (lo que hay en la base)?
	function difiere(it, v) {
		var d = it.datos || {};
		if (it.tipo === "asistencia") return (asistencia[d.alumno_id] || null) !== (v && v.estado ? v.estado : null);
		if (it.tipo === "registro" || it.tipo === "registro_borrar") {
			var r = registroGuardado[d.alumno_id] ? registro[d.alumno_id] : null;
			if (!r || !v) return !r !== !v;
			return r.participacion !== v.participacion || r.conducta !== v.conducta || (r.nota || null) !== (v.nota || null);
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
		if (!sinResguardo && !Object.keys(retroPendiente || {}).length && !Object.keys(notasPendientes || {}).length) return;
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
				if (r && r.motivo === "producto_inactivo") quitarDePantalla(it);
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
				if (m.tipo === "aviso" && m.motivo === "producto_inactivo") quitarDePantalla(it);
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
		mensaje("error", "No se pudo cargar la lista de alumnos: " + textoError(alumnosRes.error) + ". Recarga la página para intentarlo de nuevo.");
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
				.select(conCaptura("alumno_id, participacion, conducta, nota", "registro"))
				.eq("maestro_id", user.id).eq("fecha", hoy);
		}
		var desdeReg = numeroVista;
		var regRes = await conMarcas(leerRegistro);
		if (regRes.error) throw regRes.error;
		(regRes.data || []).forEach(function (r) {
			var d = { alumno_id: r.alumno_id, fecha: hoy };
			tomarLeido(claveDe("registro", d), desdeReg, { tipo: "registro", datos: d }, r, function () {
				registro[r.alumno_id] = { participacion: r.participacion, conducta: r.conducta, nota: r.nota || null };
				registroGuardado[r.alumno_id] = true;
			});
		});

		// lectura-opcional: solo dice "Jornada finalizada a las 13:20"; nada se guarda con ella y, si no se puede leer
		// (o la tabla aún no existe), el botón sigue diciendo "Finalizar jornada"
		try {
			var jorRes = await window.sb.from("jornadas").select("cerrada_en, actualizada_en")
				.eq("maestro_id", user.id).eq("grupo_id", grupo.id).eq("fecha", hoy).limit(1);
			if (!jorRes.error && jorRes.data && jorRes.data.length) jornadaHoy = jorRes.data[0];
		} catch (_) { /* sin la jornada, Hoy sigue igual */ }

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
		todasLasSesiones = sesiones;
		// Las de hoy y las que se empezaron otro día y siguen sin terminar (sesión en curso: sigue en
		// Hoy hasta darle "Terminar sesión"; SesionTerminar.enCurso, con su corte)
		sesionesHoy = sesiones.filter(function (s) { return s.fecha === hoy || esEnCurso(s); });

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
				.select("id, sesion_id, tipo, nombre, descripcion, grados, modalidad, campo, fecha_entrega, orden, created_at, es_historico, desde_ponte_al_dia")
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
			// Las del asistente Ponte al día ya se calificaron en su cuadrícula: no llenan Hoy (b20)
			if (p.id !== pedida && !window.AlcanceHoy.abrirParaCalificar(p)) return;
			if (sesionesHoy.indexOf(s) === -1) sesionesHoy.push(s);
			if (p.id === pedida) { sesionPedida = s.id; productosAbiertos[p.id] = true; } // la que se abrió para calificar sale abierta
		});
		if (pedida && !sesionPedida) {
			mensaje("info", "Esa actividad no está en el trimestre que mira Hoy (o ya no existe). Revísala en Proyectos, en Actividades del trimestre.");
		}
		// Por proyecto y número; las sueltas al final, las de días que ya pasaron después de las de hoy
		sesionesHoy.sort(function (a, b) {
			var pa = proyectoPorId[a.proyecto_id] || {}, pb = proyectoPorId[b.proyecto_id] || {};
			var sa = window.AlcanceHoy.esSueltas(pa) ? 1 : 0, sb = window.AlcanceHoy.esSueltas(pb) ? 1 : 0;
			var da = a.fecha === hoy || esEnCurso(a) ? 0 : 1, db = b.fecha === hoy || esEnCurso(b) ? 0 : 1;
			var ta = pa.titulo || "", tb = pb.titulo || "";
			return sa - sb || da - db || String(a.fecha || "").localeCompare(String(b.fecha || "")) ||
				ta.localeCompare(tb, "es", { sensitivity: "base" }) || (a.numero_sesion || 0) - (b.numero_sesion || 0);
		});

		// Tareas por revisar: vencen hoy o antes (las de días pasados siguen ahí
		// hasta que el maestro las revise)
		// Las del registro histórico no (spec §4.3: lo que no se capturó al ponerse al día no se pide
		// aquí; AlcanceHoy.tareaPorRevisar, la misma regla de Inicio y Tareas)
		tareas = productos.filter(function (p) {
			if (p.tipo !== "tarea") return false;
			return window.AlcanceHoy.tareaPorRevisar(p, venceDe(p), hoy, p.sesion && p.sesion.fecha);
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

		// Con qué grado trabaja un incluido de otro grado: el de los PDA ligados al producto. Si el
		// producto también tiene PDA de su grado (ahí deja su evidencia), no hay nota; un trabajo sin
		// grados y sin PDA de su grado ahora sí lo dice (antes no decía nada).
		// lectura-opcional: solo la nota "Trabaja con"; nada se guarda con este dato y sin él la nota
		// sale, como antes, de los grados del producto
		try {
			var ligasPda = await window.AlcanceHoy.leerPorLotes(idsRelevantes, function (lote) {
				return window.sb.from("producto_sesion_pda").select("producto_sesion_id, sesiones_pda(grado)")
					.in("producto_sesion_id", lote).order("producto_sesion_id").order("sesion_pda_id");
			});
			gradosPda = window.AlcanceHoy.gradosPdaPorProducto(ligasPda);
		} catch (e) {
			gradosPda = {};
		}

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

		/*
			Las asistencias de los días trabajados: quien faltó no aparece para calificar lo de ese día y lo
			de una falta justificada queda pendiente con su plazo (AlcanceHoy, "Faltas"). Lectura opcional: si
			falla, Hoy sigue sin esa parte y lo dice en su bloque.
		*/
		var fechasTrab = sesiones.map(function (s) { return s.fecha; }).filter(Boolean).sort();
		if (fechasTrab.length) {
			try {
				// lectura-opcional: solo alimenta "Por falta justificada" y quién no aparece para calificar en un día
				// anterior; nada se guarda con ella y, si falla, se dice en pantalla y se sigue calificando
				var filasAsis = await window.AlcanceHoy.leerAsistencias(window.sb, user.id, grupo.id, fechasTrab[0]);
				asisPasadas = window.AlcanceHoy.indiceAsistencias(filasAsis);
			} catch (e) {
				console.warn("hoy: no se pudieron leer las asistencias anteriores", e);
				faltasFalla = true;
			}
		}

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

	// Lo que hay por omisión en el cierre de un alumno: 1 y 1 si asistió; sin participación ni conducta si faltó
	// (quien faltó no participó ni se portó: su fila, si la hay, es solo el comentario)
	function registroPorOmision(alumnoId) {
		return faltoHoy(alumnoId) ? { participacion: null, conducta: null, nota: null } : { participacion: 1, conducta: 1, nota: null };
	}

	// campo: "participacion", "conducta" o "nota" (lo que tocó el docente), o varios en un arreglo; sin campo, el
	// relleno 1 y 1 del cierre, que solo se inserta donde no hay fila (nunca pisa ni avisa). El grupo va para que
	// la bandeja no rellene a quien este aparato marcó con falta en otra ventana
	function guardarRegistro(alumnoId, campo) {
		var v = registro[alumnoId] || registroPorOmision(alumnoId);
		if (!registro[alumnoId]) registro[alumnoId] = v;
		registroGuardado[alumnoId] = true;
		var campos = campo ? [].concat(campo) : null;
		guardar("registro", { alumno_id: alumnoId, fecha: hoy, participacion: v.participacion, conducta: v.conducta, nota: v.nota || null, grupo_id: grupo.id },
			(campos && campos.length === 1 && campos[0] === "nota" ? "Comentario del día de " : "Cierre del día de ") + nombreDe(alumnoId),
			campos ? { campos: campos } : { relleno: true });
	}

	function faltoHoy(alumnoId) {
		return asistencia[alumnoId] === "ausente" || asistencia[alumnoId] === "justificada";
	}

	// Las asistencias de un alumno: las leídas de la base y la de hoy tal como está en pantalla
	function asisDe(alumnoId) {
		var base = asisPasadas[alumnoId] || {};
		var hoyEstado = asistencia[alumnoId];
		if (!hoyEstado) return base;
		var copia = Object.assign({}, base);
		copia[hoy] = { estado: hoyEstado, actualizada: null };
		return copia;
	}
	function asisTodas() {
		var idx = {};
		alumnos.forEach(function (a) { idx[a.id] = asisDe(a.id); });
		return idx;
	}
	// ¿Faltó (o tuvo justificada) ese día? Hoy, con lo de pantalla; otro día, con lo leído
	function faltoEnDia(alumnoId, fecha) {
		if (fecha === hoy) return faltoHoy(alumnoId);
		var e = window.AlcanceHoy.estadoAsistencia(asisDe(alumnoId), fecha);
		return e === "ausente" || e === "justificada";
	}
	// ¿Su falta justificada deja pendiente este producto? (entonces se ve en "Por falta justificada")
	function cubiertoPorJustificada(alumno, producto) {
		var est = window.AlcanceHoy.estadoPorAsistencia(producto, producto.sesion && producto.sesion.fecha, asisDe(alumno.id), ajustesCal);
		return !!(est && est.estado === "justificada");
	}
	// Una sesión de un proyecto (no una actividad suelta) empezada y sin terminar (js/sesion-terminar.js)
	function esEnCurso(s) {
		if (!s || !window.SesionTerminar) return false;
		if (window.AlcanceHoy.esSueltas(proyectoPorId[s.proyecto_id])) return false;
		return window.SesionTerminar.enCurso(s);
	}

	/*
		"Todos empiezan en 1; cambia solo las excepciones": el valor normal también se
		GUARDA. Antes solo se guardaba a quien se tocaba y el motor, que ignora los días
		sin registro, calculaba la participación de cada alumno con días distintos. Se
		guardan de una vez (un solo upsert) los que aún no tienen registro hoy, menos los
		que faltaron: ese día no participaron.
	*/
	function completarCierre() {
		// Un relleno por alumno; la bandeja los manda juntos en un insert que no pisa. Una fila que ya existe
		// (por ejemplo, solo con su comentario) no se rellena: se le completa lo que le falte, sin tocar el comentario
		alumnos.forEach(function (al) {
			if (faltoHoy(al.id)) return;
			if (registroGuardado[al.id]) { completarValoresNulos(al.id); return; }
			if (!registro[al.id]) registro[al.id] = { participacion: 1, conducta: 1, nota: null };
			guardarRegistro(al.id);
		});
	}

	// Un alumno que asiste con una fila SIN participación o conducta (la creó su comentario cuando había faltado y
	// después se le puso Presente): se le pone 1 en lo que falta. Solo esos campos: el comentario no se toca
	function completarValoresNulos(alumnoId) {
		var v = registro[alumnoId];
		if (!v || !registroGuardado[alumnoId] || faltoHoy(alumnoId)) return;
		var campos = [];
		if (v.participacion === null || v.participacion === undefined) { v.participacion = 1; campos.push("participacion"); }
		if (v.conducta === null || v.conducta === undefined) { v.conducta = 1; campos.push("conducta"); }
		if (campos.length) guardarRegistro(alumnoId, campos);
	}

	// Si se marca una falta después del cierre, se retira el registro que se puso por
	// defecto (1 y 1); uno que el maestro cambió a mano se deja. Una fila con COMENTARIO no se borra (el
	// comentario es del docente): solo se le quitan la participación y la conducta por defecto, para que
	// quien faltó no cuente un día de participación
	function retirarCierreSiFalto(alumnoId) {
		var v = registro[alumnoId];
		if (!faltoHoy(alumnoId) || !registroGuardado[alumnoId] || !v || v.participacion !== 1 || v.conducta !== 1) return;
		if (v.nota) {
			v.participacion = null;
			v.conducta = null;
			guardarRegistro(alumnoId, ["participacion", "conducta"]);
			return;
		}
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
	// opciones.numeroAlInicio (solo Asistencia, Jorge 2026-09-27): el número de lista va al
	// inicio, visible y en columna fija (nombres alineados), sin el grado (lo dice el título de
	// la sub-tarjeta). Tareas, Trabajos, Pendientes y Cierre siguen como siempre.
	function filaAlumno(alumno, controles, nota, opciones) {
		if (opciones && opciones.numeroAlInicio) {
			return "<div class='flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-gray-100 last:border-0'>" +
				"<div class='sm:w-64 shrink-0 flex items-baseline gap-2'>" +
				"<span class='w-7 shrink-0 text-right text-sm font-bold text-gray-900 tabular-nums' data-num-lista>" + esc(alumno.num_lista || "") + "</span>" +
				"<span class='min-w-0 text-sm font-medium text-gray-800 break-words'>" + esc(alumno.nombre_completo) + "</span>" +
				"</div><div class='flex flex-wrap gap-2 pl-9 sm:pl-0'>" + controles + "</div></div>";
		}
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

	/*
		Quien faltó hoy no aparece para calificar (Fanny, 2026-09-29). Es un filtro de PANTALLA sobre
		alumnosDeProducto: la regla de a quién le toca un producto (AlcanceHoy.recibeProducto) no
		cambia, y Inicio, Tareas, el motor y Qué le falta siguen igual. Si ya tiene una calificación,
		sí se muestra (para poder corregirla). Solo aplica a lo que se califica hoy: las tareas que se
		revisan hoy y las actividades de una sesión de hoy; una actividad suelta de un día que ya
		pasó se califica con lo que pasó ese día, no con la asistencia de hoy.
	*/
	function alumnosParaCalificar(producto) {
		var lista = alumnosDeProducto(producto);
		var fechaSes = producto.sesion && producto.sesion.fecha;
		// Lo de hoy, las tareas que se revisan hoy y las sesiones en curso (con la asistencia de SU día)
		var delDia = producto.tipo === "tarea" || fechaSes === hoy || esEnCurso(producto.sesion);
		if (!delDia) return lista;
		var diaFalta = producto.tipo === "tarea" ? hoy : (fechaSes || hoy);
		return lista.filter(function (a) {
			if (window.ProductosHoy.tieneCaptura(calificaciones[a.id + "|" + producto.id])) return true;
			// Faltó ese día, o su falta justificada lo deja pendiente (se ve en "Por falta justificada")
			return !faltoEnDia(a.id, diaFalta) && !cubiertoPorJustificada(a, producto);
		});
	}

	// Calificado = semáforo, estado de entrega o puntaje (el motor cuenta el puntaje solo)
	function estaCalificado(cal) {
		return !!(cal && (cal.nivel || cal.estado_entrega || (cal.puntaje !== null && cal.puntaje !== undefined)));
	}

	// "Faltaron hoy: Ana, Luis" (quien faltó o tiene justificada); "" si nadie faltó
	function lineaFaltaron(fecha) {
		var dia = fecha || hoy;
		var ausentes = (window.OrdenLista ? window.OrdenLista.ordenar(alumnos) : alumnos).filter(function (a) { return faltoEnDia(a.id, dia); });
		if (!ausentes.length) return "";
		var cuando = dia === hoy ? "hoy" : "el " + fechaCorta(dia);
		return "<p class='text-xs text-gray-600 mb-2' data-faltaron-hoy>" + (ausentes.length === 1 ? "Faltó " : "Faltaron ") + cuando + ": " +
			"<span class='font-medium'>" + ausentes.map(function (a) { return esc(a.nombre_completo); }).join(", ") + "</span>" +
			" · no aparecen para calificar</p>";
	}

	// "Trabaja con 2°": un alumno incluido de otro grado (sigue en su grado para la boleta)
	function notaTrabajaCon(alumno, producto) {
		var g = window.AlcanceHoy.trabajaCon(alumno, producto, asignaciones, gradosPda[producto.id]);
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
	/*
		Una sub-tarjeta por grado (en orden de grado; con un solo grado también lleva su título) y,
		dentro, los alumnos en orden alfabético (la regla única de js/orden-lista.js; sin ella, el
		orden de la lectura: grado y número de lista). El número de lista va al inicio de la fila.
	*/
	function renderAsistencia() {
		var cont = document.getElementById("asistenciaLista");
		var ordenados = window.OrdenLista ? window.OrdenLista.ordenar(alumnos) : alumnos;
		cont.innerHTML = agruparPorGrado(ordenados).map(function (g) {
			var n = g.alumnos.length;
			var filas = g.alumnos.map(function (al) {
				var controles = ASISTENCIA.map(function (op) {
					return chip(op.etiqueta, asistencia[al.id] === op.valor, op.activo,
						"data-asistencia='" + al.id + "' data-valor='" + op.valor + "'");
				}).join("");
				return filaAlumno(al, controles, "", { numeroAlInicio: true });
			}).join("");
			return "<div class='rounded-xl border border-gray-200 px-3 sm:px-4 pt-3 pb-1' data-asistencia-grado='" + esc(g.grado) + "'>" +
				"<div class='flex items-center justify-between gap-2 pb-1 border-b border-gray-100'>" +
				"<h3 class='text-sm font-bold text-gray-800'>" + esc(g.grado) + "° grado</h3>" +
				"<span class='text-xs text-gray-500'>" + n + (n === 1 ? " alumno" : " alumnos") + "</span></div>" +
				filas + "</div>";
		}).join("");
		resumenAsistencia();
	}

	function asistenciaCompleta() {
		return alumnos.length > 0 && alumnos.every(function (a) { return !!asistencia[a.id]; });
	}

	/*
		La tarjeta de Asistencia se pliega cuando ya está todo capturado (Fanny, 2026-09-29): se
		pliega sola unos 0.7 s después de marcar al último alumno, y también aparece plegada si ya
		estaba completa al abrir Hoy. Queda un resumen ("16 de 16 · 14 presentes · Falta: Ana ·
		Justificada: Luis") y "Cambiar asistencia" la vuelve a abrir (con "Listo" se pliega otra vez).
	*/
	function textoResumenAsistencia() {
		var ordenados = window.OrdenLista ? window.OrdenLista.ordenar(alumnos) : alumnos;
		var capturados = alumnos.filter(function (a) { return asistencia[a.id]; }).length;
		var presentes = alumnos.filter(function (a) { return asistencia[a.id] === "presente"; }).length;
		function nombres(estado) {
			return ordenados.filter(function (a) { return asistencia[a.id] === estado; }).map(function (a) { return a.nombre_completo; });
		}
		var faltas = nombres("ausente"), justificadas = nombres("justificada");
		var partes = [capturados + " de " + alumnos.length, presentes + (presentes === 1 ? " presente" : " presentes")];
		if (faltas.length) partes.push((faltas.length === 1 ? "Falta: " : "Faltan: ") + faltas.join(", "));
		if (justificadas.length) partes.push((justificadas.length === 1 ? "Justificada: " : "Justificadas: ") + justificadas.join(", "));
		return partes.join(" · ");
	}

	function resumenAsistencia() {
		var capturados = alumnos.filter(function (a) { return asistencia[a.id]; }).length;
		var completa = asistenciaCompleta();
		var plegada = asistenciaPlegada && completa;
		var lista = document.getElementById("asistenciaLista");
		var bloque = document.getElementById("asistenciaPlegada");
		var texto = document.getElementById("asistenciaTextoPlegada");
		var cambiar = document.getElementById("asistenciaCambiar");
		var listo = document.getElementById("asistenciaListo");
		if (lista && lista.classList) lista.classList.toggle("hidden", plegada);
		if (bloque && bloque.classList) bloque.classList.toggle("hidden", !plegada);
		if (listo && listo.classList) listo.classList.toggle("hidden", plegada || !completa);
		if (texto) texto.textContent = plegada ? textoResumenAsistencia() : "";
		if (cambiar && cambiar.setAttribute) cambiar.setAttribute("aria-expanded", plegada ? "false" : "true");
		// Plegada, el resumen ya dice cuántos hay: el contador de arriba sobra
		document.getElementById("asistenciaResumen").textContent = plegada ? "" : capturados + " de " + alumnos.length + " capturados";
	}

	document.getElementById("asistenciaLista").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-asistencia]");
		if (!btn) return;
		var alumnoId = btn.dataset.asistencia;
		// Tocar el chip que ya está activo no escribe nada: la base movería asistencias.updated_at y con él el plazo de
		// una Justificada (AlcanceHoy.venceFalta) sin que haya cambiado nada
		if (asistencia[alumnoId] === btn.dataset.valor) return;
		var estabaCompleta = asistenciaCompleta();
		asistencia[alumnoId] = btn.dataset.valor;
		guardarAsistencia(alumnoId, btn.dataset.valor);
		retirarCierreSiFalto(alumnoId);
		completarValoresNulos(alumnoId);
		renderAsistencia();
		renderTareas(); // quien faltó hoy no aparece para calificar
		renderPendientes(); // quien faltó hoy sigue pendiente
		repintarSesiones();
		renderCierre();
		// El último alumno marcado: se pliega solo tras una pausa (si ya estaba completa y se
		// reabrió para corregir, se queda abierta hasta "Listo")
		if (!estabaCompleta && asistenciaCompleta()) {
			clearTimeout(plegarAsistenciaTimer);
			plegarAsistenciaTimer = setTimeout(function () {
				if (!asistenciaCompleta()) return;
				asistenciaPlegada = true;
				resumenAsistencia();
			}, 700);
		}
	});

	var asistenciaCambiarBtn = document.getElementById("asistenciaCambiar");
	if (asistenciaCambiarBtn && asistenciaCambiarBtn.addEventListener) {
		asistenciaCambiarBtn.addEventListener("click", function () {
			clearTimeout(plegarAsistenciaTimer);
			asistenciaPlegada = false;
			resumenAsistencia();
			var primero = document.querySelector("#asistenciaLista button[data-asistencia]");
			if (primero && primero.focus) primero.focus();
		});
	}
	var asistenciaListoBtn = document.getElementById("asistenciaListo");
	if (asistenciaListoBtn && asistenciaListoBtn.addEventListener) {
		asistenciaListoBtn.addEventListener("click", function () {
			clearTimeout(plegarAsistenciaTimer);
			asistenciaPlegada = true;
			resumenAsistencia();
			var cambiar = document.getElementById("asistenciaCambiar");
			if (cambiar && cambiar.focus) cambiar.focus();
		});
	}

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
			var porGrado = agruparPorGrado(alumnosParaCalificar(t));
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
				"</div>" + (filas || vacio("Nadie por revisar en esta tarea: quienes faltaron hoy no aparecen aquí.")) + "</div>";
		}).join("");
		cont.innerHTML = lineaFaltaron() + cont.innerHTML;
		var pendientesTareas = 0;
		tareas.forEach(function (t) {
			alumnosParaCalificar(t).forEach(function (al) {
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

	/*
		"Por falta justificada" (decisiones de Jorge del 2026-09-29; AlcanceHoy.pendientesPorFalta): lo que se
		trabajó o se dejó el día que el alumno faltó CON justificante. Tiene 3 días de clase desde que regresa
		(o desde que se justificó, si fue después). Si el plazo pasa, sigue pendiente ("venció el…") hasta que se
		califique: no pasa sola a No entregó. Lo que se califica en esta visita sigue a la vista para corregir.
	*/
	function itemsPorFalta() {
		if (!window.AlcanceHoy.pendientesPorFalta) return [];
		var productos = [];
		Object.keys(productosPorSesion).forEach(function (s) { productos = productos.concat(productosPorSesion[s] || []); });
		var lista = window.AlcanceHoy.pendientesPorFalta({
			alumnos: alumnos, productos: productos, calificaciones: calificaciones, asignaciones: asignaciones,
			asistencias: asisTodas(), ajustes: ajustesCal,
		});
		var claves = {};
		lista.forEach(function (x) {
			var k = x.alumno.id + "|" + x.producto.id;
			claves[k] = true;
			faltaVistos[k] = x;
		});
		Object.keys(faltaVistos).forEach(function (k) {
			if (!claves[k] && !window.AlcanceHoy.sinCalificar(calificaciones[k])) lista.push(faltaVistos[k]);
		});
		return lista.sort(function (a, b) {
			return String(a.fechaFalta).localeCompare(String(b.fechaFalta)) || (Number(a.alumno.grado) - Number(b.alumno.grado)) ||
				((a.alumno.num_lista || 0) - (b.alumno.num_lista || 0)) || String(a.producto.nombre || "").localeCompare(String(b.producto.nombre || ""), "es");
		});
	}

	function fechaConDia(iso) {
		return window.CalendarioSEP ? window.CalendarioSEP.fechaLarga(iso, false) : fechaCorta(iso);
	}

	function filaFalta(x) {
		var al = x.alumno, p = x.producto;
		var cal = calificaciones[al.id + "|" + p.id] || {};
		var hecho = !window.AlcanceHoy.sinCalificar(cal);
		var plazo = window.AlcanceHoy.estadoPlazo(x.vence, hoy);
		var datos = "data-falta-producto='" + esc(p.id) + "' data-alumno='" + esc(al.id) + "'";
		var controles;
		if (!hecho && faltoHoy(al.id)) {
			controles = "<span class='text-xs text-gray-500 self-center'>Faltó hoy: sigue pendiente para su regreso.</span>";
		} else if (!hecho && plazo === "sin_regreso") {
			controles = "<span class='text-xs text-gray-500 self-center'>Aún no regresa: se le califica a su regreso.</span>";
		} else {
			controles = NIVELES.map(function (op) {
				return chip(op.etiqueta, cal.nivel === op.valor, op.activo, datos + " data-nivel-falta='" + op.valor + "'");
			}).join("") + chip("No entregó", cal.estado_entrega === "no_entregado", "bg-red-500 text-white", datos + " data-estado-falta='no_entregado'");
		}
		var textoPlazo = plazo === "sin_regreso" ? "se entrega a su regreso (3 días de clase)"
			: (plazo === "vencido" ? "venció el " : "entrega a más tardar el ") + (plazo === "sin_regreso" ? "" : fechaConDia(x.vence));
		var sesion = p.sesion || {};
		var nota = (p.nombre || "Actividad") + " · " + (window.CamposFormativos ? window.CamposFormativos.largo(p.campo) : p.campo) +
			" · faltó el " + fechaCorta(x.fechaFalta) + (hecho ? "" : " · " + textoPlazo);
		return "<div data-fila-falta='" + esc(al.id + "|" + p.id) + "' data-plazo='" + plazo + "'>" + filaAlumno(al, controles, nota) + "</div>";
	}

	function renderPendientes() {
		var seccion = document.getElementById("pendientes");
		var bloqueClase = document.getElementById("pendientesClase");
		var bloqueFalta = document.getElementById("pendientesFalta");
		var cont = document.getElementById("pendientesLista");
		var contFalta = document.getElementById("pendientesFaltaLista");
		if (!cont) return;
		var lista = pendientesDeRevisar();
		var porFalta = itemsPorFalta();
		var hayFalta = porFalta.length > 0 || faltasFalla;
		if (seccion && seccion.classList) seccion.classList.toggle("hidden", !lista.length && !hayFalta);
		if (bloqueClase && bloqueClase.classList) bloqueClase.classList.toggle("hidden", !lista.length);
		if (bloqueFalta && bloqueFalta.classList) bloqueFalta.classList.toggle("hidden", !hayFalta);
		var resumen = document.getElementById("pendientesResumen");
		if (contFalta) {
			contFalta.innerHTML = porFalta.length
				? porFalta.map(filaFalta).join("")
				: (faltasFalla ? "<p class='text-sm text-red-700'>No se pudieron leer las faltas anteriores; lo de una falta justificada no se muestra por ahora. Recarga la página para intentarlo de nuevo.</p>" : "");
		}
		var sinRevisar = 0;
		if (!lista.length) {
			cont.innerHTML = "";
		} else {
			cont.innerHTML = lista.map(function (x) {
				var c = x.cal, al = x.alumno, p = x.producto;
				var falto = faltoHoy(al.id);
				var pendiente = c.estado_en_clase === "incompleta";
				// De dónde viene: sin entregar (No entregó en clase) o incompleta. Ya revisada como completada
				// no se sabe: se ofrecen las dos salidas por si hay que corregir
				var sinEntregar = c.estado_entrega === "no_entregado";
				var origenIncierto = c.estado_en_clase === "completada";
				if (pendiente) sinRevisar++;
				var datos = "data-revisar-producto='" + p.id + "' data-alumno='" + al.id + "'";
				var controles = "";
				if (falto && pendiente) {
					controles = "<span class='text-xs text-gray-500 self-center'>Faltó hoy: queda pendiente para su siguiente clase.</span>";
				} else {
					controles = "<span class='text-xs text-gray-500 self-center mr-1'>" + (sinEntregar ? "La entregó:" : "Lo completó:") + "</span>" +
						NIVELES.map(function (op) {
							return chip(op.etiqueta, c.estado_en_clase === "completada" && c.nivel === op.valor, op.activo,
								datos + " data-accion='completo' data-nivel-revision='" + op.valor + "'");
						}).join("") +
						(sinEntregar || origenIncierto
							? chip("Sigue sin entregar", c.estado_en_clase === "sigue_incompleta" && sinEntregar, "bg-red-500 text-white", datos + " data-accion='sigue_sin_entregar'")
							: "") +
						(!sinEntregar
							? chip("Sigue incompleta", c.estado_en_clase === "sigue_incompleta", "bg-amber-500 text-white", datos + " data-accion='sigue'")
							: "");
				}
				var sesion = p.sesion || {};
				var nota = (p.nombre || "Actividad") + " · " + (window.CamposFormativos ? window.CamposFormativos.largo(p.campo) : p.campo) +
					(sesion.fecha ? " · " + (sinEntregar ? "sin entregar" : "incompleta") + " el " + fechaCorta(sesion.fecha) : "");
				return filaAlumno(al, controles, nota);
			}).join("");
		}
		var pendientesFalta = porFalta.filter(function (x) { return window.AlcanceHoy.sinCalificar(calificaciones[x.alumno.id + "|" + x.producto.id]); }).length;
		var total = sinRevisar + pendientesFalta;
		if (resumen) resumen.textContent = total ? total + " por revisar" : ((lista.length || porFalta.length) ? "todas revisadas" : "");
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
			var sinEntregar = c.estado_entrega === "no_entregado";
			var yaEsa = accion === "completo"
				? c.estado_en_clase === "completada" && c.nivel === btn.dataset.nivelRevision
				: c.estado_en_clase === "sigue_incompleta" && (accion === "sigue_sin_entregar") === sinEntregar;
			// Ya "La entregó" con ese nivel: no se ofrece deshacer. Al completarse se pierde si venía de No
			// entregó (0) o de Incompleta (0.5), y deshacer lo regresaría al valor equivocado; para corregir
			// se elige otro nivel, «Sigue incompleta» o «Sigue sin entregar».
			if (accion === "completo" && yaEsa) return;
			// Tocar otra vez «Sigue…» lo regresa a pendiente (para corregir un toque); lo que era No
			// entregó vuelve a No entregó (vale 0), no a incompleta
			guardarCalificacion(alumno, producto, yaEsa
				? window.AlcanceHoy.cambiosIncompleta(accion === "sigue_sin_entregar" ? "pendiente_no_entregado" : "pendiente", { hoy: hoy })
				: window.AlcanceHoy.cambiosIncompleta(accion, { hoy: hoy, nivel: btn.dataset.nivelRevision }));
			revisadosAqui[k] = true;
			renderPendientes();
			repintarSesiones();
		});
	}

	// "Por falta justificada": el nivel o "No entregó" de lo que se debe por la falta; tocar otra vez lo quita
	var pendientesFaltaCont = document.getElementById("pendientesFaltaLista");
	if (pendientesFaltaCont && pendientesFaltaCont.addEventListener) {
		pendientesFaltaCont.addEventListener("click", function (e) {
			var btn = e.target.closest("button[data-falta-producto]");
			if (!btn) return;
			var producto = productoPorId(btn.dataset.faltaProducto);
			var alumno = alumnos.find(function (a) { return a.id === btn.dataset.alumno; });
			if (!producto || !alumno) return;
			var c = calificaciones[alumno.id + "|" + producto.id] || {};
			var sinMarca = window.AlcanceHoy.cambiosIncompleta("quitar");
			if (btn.dataset.nivelFalta) {
				var nuevo = c.nivel === btn.dataset.nivelFalta ? null : btn.dataset.nivelFalta;
				guardarCalificacion(alumno, producto, Object.assign({ nivel: nuevo, estado_entrega: nuevo ? "entregado" : null }, sinMarca));
			} else if (btn.dataset.estadoFalta) {
				var noEnt = c.estado_entrega === btn.dataset.estadoFalta ? null : btn.dataset.estadoFalta;
				guardarCalificacion(alumno, producto, Object.assign({ estado_entrega: noEnt, nivel: null }, sinMarca));
			}
			renderPendientes();
			renderTareas();
			repintarSesiones();
		});
	}

	// ── 3. Sesiones de hoy ────────────────────────────────────────────────────
	// Bloque "Trabajar hoy": las siguientes sesiones pendientes del proyecto activo
	// Una sesión pendiente con su botón "Trabajar hoy"
	/*
		Una sesión que falta, con su ojo (despliega ahí su secuencia) y su lápiz (la abre en Crear
		proyecto, ya en esa sesión). "Trabajar hoy" solo lo ofrece la SIGUIENTE de cada proyecto
		(ofreceTrabajar): las demás se ven y se editan, pero no se saltan.
	*/
	function iconoOjo() {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'/><circle cx='12' cy='12' r='3'/></svg>";
	}
	function iconoLapiz() {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>";
	}

	function filaSiguiente(s, ofreceTrabajar) {
		var num = s.numero_sesion || "";
		var abierta = !!secuenciasAbiertas[s.id];
		return "<div class='rounded-lg bg-white border border-gray-200' data-fila-sesion='" + esc(s.id) + "'>" +
			"<div class='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2'>" +
			"<span class='min-w-0 text-sm text-gray-700'>Sesión " + num + " · " + esc(s.campo_formativo || "Sin campo formativo") +
			(s.momento ? "<span class='block text-xs text-gray-400'>" + esc(s.momento) + "</span>" : "") + "</span>" +
			"<span class='flex items-center gap-2 shrink-0'>" +
			(ofreceTrabajar
				? "<button type='button' data-trabajar-hoy='" + s.id + "' aria-label='Trabajar hoy la sesión " + num + " de " + esc(s.proyectoTitulo || "") + "' " +
					"class='min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700'>Trabajar hoy</button>"
				: "") +
			// Ojo gris: la secuencia de esa sesión, aquí mismo
			"<button type='button' data-ver-secuencia='" + s.id + "' aria-expanded='" + (abierta ? "true" : "false") + "' " +
			"aria-label='Ver la secuencia de la sesión " + num + "' title='Ver la secuencia' " +
			"class='inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg " + (abierta ? "bg-gray-200 text-gray-700" : "text-gray-500 hover:bg-gray-100") + "'>" + iconoOjo() + "</button>" +
			// Lápiz azul: editar esa sesión en Crear proyecto (enlace relativo: en la app instalada no sale de /salon/)
			"<a href='crear_proyecto.html?id=" + encodeURIComponent(s.proyecto_id || "") + "&sesion=" + encodeURIComponent(s.id) + "' data-editar-sesion='" + s.id + "' " +
			"aria-label='Editar la sesión " + num + " en el proyecto' title='Editar en el proyecto' " +
			"class='inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-blue-700 hover:bg-blue-50'>" + iconoLapiz() + "</a>" +
			"</span></div>" +
			(abierta ? "<div class='px-3 pb-3 border-t border-gray-100 pt-2'>" + cuerpoSecuencia(s) + "</div>" : "") +
			"</div>";
	}

	// "Trabajar hoy": la siguiente de CADA proyecto activo, agrupadas, y las demás a un toque
	// "Termina la sesión 4 para empezar otra": una sesión empezada bloquea la siguiente del proyecto
	function avisoBloqueo(bloqueo) {
		if (!bloqueo.length) return "";
		var nums = bloqueo.map(function (x) { return x.numero_sesion; }).join(", ");
		return "<p class='mt-2 text-xs text-gray-600' data-bloqueo-siguiente>Termina la sesión " + esc(nums) + " (arriba, en «Terminar sesión») para empezar la siguiente.</p>";
	}

	function bloqueSiguientes() {
		if (!siguientes.length) {
			return sesionesHoy.length ? "" : vacio("No hay sesiones pendientes en tus proyectos activos. Inicia un proyecto desde Proyectos o agrega una actividad suelta.");
		}
		return "<div id='siguientes' class='scroll-mt-32 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-3'>" +
			"<p class='text-sm font-semibold text-gray-800 mb-1'>" +
			(sesionesHoy.length ? "¿Trabajarás otra sesión hoy?" : "¿Qué sesión trabajas hoy?") + "</p>" +
			"<p class='text-xs text-gray-500 mb-2'>Las sesiones se trabajan en orden: toca «Trabajar hoy» en la siguiente y sus actividades aparecen aquí para calificarlas. Con el ojo ves la secuencia de una sesión y con el lápiz la editas en el proyecto." +
			(siguientes.length > 1 ? " Tienes " + siguientes.length + " proyectos activos." : "") + "</p>" +
			"<div class='flex flex-col gap-3'>" +
			siguientes.map(function (g) {
				var abiertas = !!restantesAbiertas[g.proyecto.id];
					// Una sesión de este proyecto empezada y sin terminar: no se puede empezar otra
					var bloqueo = window.SesionTerminar ? window.SesionTerminar.enCursoDe(todasLasSesiones.filter(function (x) { return !esSuelta(x); }), g.proyecto.id) : [];
				var otras = g.otras.length
					? "<button type='button' data-abrir-restantes='" + esc(g.proyecto.id) + "' aria-expanded='" + (abiertas ? "true" : "false") + "' " +
						"class='mt-2 min-h-[44px] flex items-center gap-2 text-sm text-blue-700 font-medium'>" + chevron(abiertas) +
						g.otras.length + (g.otras.length === 1 ? " sesión restante" : " sesiones restantes") + "</button>" +
						"<div class='" + (abiertas ? "" : "hidden ") + "flex flex-col gap-2 mt-1' data-restantes='" + esc(g.proyecto.id) + "'>" +
						g.otras.map(function (o) { return filaSiguiente(o, false); }).join("") + "</div>"
					: "";
				return "<section class='rounded-lg bg-white/60 p-2' aria-label='" + esc(g.proyecto.titulo || "Proyecto") + "'>" +
					"<p class='text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1'>" + esc(g.proyecto.titulo || "Proyecto sin título") + "</p>" +
					filaSiguiente(g.siguiente, !bloqueo.length) + avisoBloqueo(bloqueo) + otras + "</section>";
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

	/*
		La secuencia de la sesión (inicio, desarrollo, cierre, tareas y enlaces a anexos y libros:
		js/secuencia-sesion.js), a la vista en Hoy sin ir a Inicio. Es una LECTURA OPCIONAL: si no se
		puede leer, se dice y se sigue calificando. Se lee al abrirla, una vez por sesión.
	*/
	function cuerpoSecuencia(ses) {
		if (!window.SecuenciaSesion) return "";
		var fila = secuencias[ses.id];
		if (fila) {
			return window.SecuenciaSesion.hayContenido(fila)
				? window.SecuenciaSesion.html(fila)
				: "<p class='text-sm text-gray-500'>Esta sesión no trae secuencia registrada.</p>";
		}
		if (secuenciaFalla[ses.id]) {
			return "<p class='text-sm text-red-700'>No se pudo cargar la secuencia. Puedes seguir calificando.</p>" +
				"<button type='button' data-ver-secuencia='" + esc(ses.id) + "' data-reintentar='1' " +
				"class='mt-2 min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50'>Reintentar</button>";
		}
		return "<p class='text-sm text-gray-500'>Cargando la secuencia...</p>";
	}

	// El panel plegable de una sesión de hoy (las actividades sueltas no traen secuencia)
	function panelSecuencia(ses) {
		if (!window.SecuenciaSesion || esSuelta(ses)) return "";
		var abierta = !!secuenciasAbiertas[ses.id];
		return "<div class='mb-2 rounded-xl border border-gray-200' data-panel-secuencia='" + esc(ses.id) + "'>" +
			"<button type='button' data-secuencia='" + esc(ses.id) + "' aria-expanded='" + (abierta ? "true" : "false") + "' " +
			"class='w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left rounded-xl hover:bg-gray-50 text-sm font-semibold text-blue-700'>" +
			chevron(abierta) + "Secuencia de la sesión</button>" +
			"<div class='" + (abierta ? "" : "hidden ") + "px-3 pb-3 border-t border-gray-100 pt-2'>" + (abierta ? cuerpoSecuencia(ses) : "") + "</div></div>";
	}

	async function cargarSecuencia(sesionId) {
		if (!window.SecuenciaSesion || secuencias[sesionId] || secuenciaCargando[sesionId]) return;
		secuenciaCargando[sesionId] = true;
		delete secuenciaFalla[sesionId];
		try {
			// lectura-opcional: la secuencia solo se muestra para leerla; nada se guarda con ella y sin ella
			// se sigue calificando (si falla, la pantalla lo dice y ofrece reintentar)
			var res = await window.sb.from("sesiones").select(window.SecuenciaSesion.COLUMNAS)
				.eq("id", sesionId).eq("maestro_id", user.id).maybeSingle();
			if (res.error || !res.data) secuenciaFalla[sesionId] = true;
			else secuencias[sesionId] = res.data;
		} catch (e) {
			console.warn("hoy: no se pudo leer la secuencia", e);
			secuenciaFalla[sesionId] = true;
		}
		delete secuenciaCargando[sesionId];
	}

	async function alternarSecuencia(sesionId, reintentar) {
		if (!window.SecuenciaSesion) return;
		var abrir = reintentar ? true : !secuenciasAbiertas[sesionId];
		secuenciasAbiertas[sesionId] = abrir;
		if (abrir && !secuencias[sesionId]) {
			repintarSesiones(); // "Cargando la secuencia..."
			await cargarSecuencia(sesionId);
		}
		repintarSesiones();
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
						(proyecto && proyecto.titulo ? "<span class='block text-xs font-normal text-gray-500'>" + esc(proyecto.titulo) + "</span>" : "") +
						// Una sesión que se empezó otro día y sigue sin terminar
						(esEnCurso(ses) && ses.fecha < hoy && window.SesionTerminar
							? "<span class='block text-xs font-semibold text-blue-700' data-empezo>" + esc(window.SesionTerminar.etiquetaEmpezo(ses.fecha, hoy)) + " · sigue en curso</span>" : "") + "</p>") +
				"<span class='flex flex-wrap gap-2 shrink-0'>" +
				// Una sesión con calificaciones o ya terminada no se quita de hoy (volvería a "pendiente");
				// las sueltas no se quitan de hoy (son de hoy)
				(suelta || sesionTieneCalificaciones(ses.id) || ses.estado_sesion === "completada" || ses.fecha < hoy ? "" :
					"<button type='button' data-quitar-hoy='" + ses.id + "' " +
					"class='min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-500 hover:bg-gray-50'>Quitar de hoy</button>") +
				"<button type='button' data-agregar-producto='" + ses.id + "' " +
				"class='min-h-[44px] px-3 rounded-lg border border-blue-300 text-sm font-semibold text-blue-700 hover:bg-blue-50'>Agregar actividad o tarea</button>" +
				"</span>" +
				"</div>" + (ses.fecha === hoy || esEnCurso(ses) ? lineaFaltaron(ses.fecha) : "") + panelSecuencia(ses) + cuerpo + bloqueTareasDeSesion(tareasSesion) + pieSesion(ses) + "</div>";
		}).join("") + bloqueSiguientes();
		var sinCalificar = 0;
		sesionesHoy.forEach(function (ses) {
			(productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; }).forEach(function (p) {
				// Quien faltó hoy y no tiene calificación no cuenta: no aparece para calificar
				alumnosParaCalificar(p).forEach(function (al) {
					if (!estaCalificado(calificaciones[al.id + "|" + p.id])) sinCalificar++;
				});
			});
		});
		document.getElementById("sesionesResumen").textContent = sinCalificar
			? sinCalificar + " sin calificar" : "todo calificado";
	}

	// Cuántas actividades (no tareas) de la sesión siguen sin calificar, de quienes aparecen para calificar
	function sinCalificarDeSesion(ses) {
		var n = 0;
		(productosPorSesion[ses.id] || []).filter(function (p) { return p.tipo !== "tarea"; }).forEach(function (p) {
			alumnosParaCalificar(p).forEach(function (al) {
				if (!estaCalificado(calificaciones[al.id + "|" + p.id])) n++;
			});
		});
		return n;
	}

	// Al pie de cada sesión de un proyecto: "Terminar sesión N" (o que ya está terminada)
	function pieSesion(ses) {
		if (esSuelta(ses) || !window.SesionTerminar) return "";
		if (ses.estado_sesion === "completada") {
			return "<p class='mt-3 pt-3 border-t border-gray-100 text-sm font-medium text-emerald-700' data-sesion-terminada>Sesión " + (ses.numero_sesion || "") + " terminada.</p>";
		}
		return "<div class='mt-3 pt-3 border-t border-gray-100 flex justify-end'>" +
			"<button type='button' data-terminar-sesion='" + esc(ses.id) + "' class='min-h-[44px] px-5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700'>Terminar sesión " + (ses.numero_sesion || "") + "</button></div>";
	}

	/*
		"Terminar sesión N": espera a que se envíe lo capturado (sin eso, "quedan N sin calificar" mentiría
		y lo capturado podría quedarse en la cola), dice cuántos quedan sin calificar, deja escribir notas,
		la marca completada (js/sesion-terminar.js) y recarga con la tarjeta azul de la siguiente a la vista.
		La espera es esperarCola (R36): también lo que se acaba de encolar (la retroalimentación a medio
		escribir), que bandeja.pendientes() todavía no cuenta. Si algo no se pudo enviar, no se termina.
	*/
	async function terminarSesion(btn) {
		var ses = todasLasSesiones.filter(function (s) { return s.id === btn.dataset.terminarSesion; })[0];
		if (!ses || esperandoTerminar) return;
		esperandoTerminar = true;
		var etiqueta = btn.textContent;
		try {
			guardarRetrosPendientes(); // lo que se está escribiendo entra a la cola
			if (sinSenal()) {
				avisoALaVista("Sin señal: no se puede terminar la sesión en este momento. Lo que ya capturaste sigue guardado en este dispositivo. Inténtalo de nuevo cuando haya señal.");
				return;
			}
			// Siempre (sin mirar pendientes(): lo que se acaba de encolar aún no cuenta ahí)
			btn.disabled = true;
			btn.textContent = "Guardando lo capturado...";
			var envio = await esperarCola();
			btn.disabled = false;
			btn.textContent = etiqueta;
			if (envio !== "ok") {
				avisoALaVista(envio === "red" || envio === "servidor" || envio === "pendiente"
					? "Todavía no se pudo enviar lo capturado, así que no se puede terminar la sesión. Sigue guardado en este dispositivo y se reintentará solo; inténtalo de nuevo en un momento."
					: "Primero hay que enviar lo capturado y tu sesión no está activa. Vuelve a iniciar sesión e inténtalo de nuevo; lo capturado sigue guardado en este dispositivo.");
				return;
			}
			mensaje("", "");
			window.SesionTerminar.abrirModal({
				titulo: "Terminar la sesión " + (ses.numero_sesion || ""),
				sinCalificar: sinCalificarDeSesion(ses),
				etiquetaBoton: "Terminar sesión " + (ses.numero_sesion || ""),
				origen: btn,
				alConfirmar: async function (notas) {
					try {
						await window.SesionTerminar.terminar(window.sb, { sesionId: ses.id, notas: notas, proyectoId: ses.proyecto_id, maestroId: user.id, hoy: hoy });
					} catch (e) {
						throw new Error("No se pudo terminar la sesión: " + textoError(e) + ".");
					}
					// Recarga con la tarjeta azul de la siguiente sesión a la vista
					if (window.history) {
						try { window.history.scrollRestoration = "manual"; } catch (_) { /* sin esa opción */ }
						if (window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + "#siguientes");
					}
					window.location.reload();
				},
			});
		} finally {
			esperandoTerminar = false;
			if (btn && !btn.disabled) btn.textContent = etiqueta;
		}
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
		// No entregó en clase también se revisa el siguiente día de clase (vale 0 mientras tanto)
		var sinEntregar = cal.estado_entrega === "no_entregado";
		if (cal.estado_en_clase === "incompleta") {
			var quien = sinEntregar ? "No entregó" : "Incompleta";
			return cal.revisar_en ? quien + ": se revisa el " + fechaCorta(cal.revisar_en) : quien;
		}
		if (cal.estado_en_clase === "completada") return "Quedó pendiente; la completó" + (cal.completado_en ? " el " + fechaCorta(cal.completado_en) : "");
		if (cal.estado_en_clase === "sigue_incompleta") return sinEntregar ? "Sigue sin entregar" : "Sigue incompleta";
		return "";
	}

	/*
		Cada actividad es un renglón (nombre, para quién y "N de M calificados") que se abre para
		calificar (Fanny, 2026-09-29). Qué está abierto se recuerda en `productosAbiertos`: Hoy se
		vuelve a dibujar en cada toque. Lo que el docente ve no cambia: en el cuerpo van los mismos
		botones de siempre (Para quién, Renombrar, Quitar y el semáforo de cada alumno).
	*/
	function chevron(abierto) {
		return "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0 text-gray-400 transition-transform" + (abierto ? " rotate-90" : "") +
			"' data-chevron viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m9 6 6 6-6 6'/></svg>";
	}

	// "3 de 8 calificados" (quien no aparece para calificar no cuenta)
	function resumenCalificados(producto) {
		var lista = alumnosParaCalificar(producto);
		var hechos = lista.filter(function (al) { return estaCalificado(calificaciones[al.id + "|" + producto.id]); }).length;
		return { hechos: hechos, total: lista.length };
	}

	function bloqueProducto(producto) {
		var paraCalificar = alumnosParaCalificar(producto);
		var porGrado = agruparPorGrado(paraCalificar);
		var abierto = !!productosAbiertos[producto.id];
		var conteo = resumenCalificados(producto);
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
		var sinFilas = alumnosDeProducto(producto).length
			? "Quienes reciben esta actividad faltaron hoy: no aparecen para calificar."
			: "Nadie recibe esta actividad todavía. Usa «Para quién» para elegir a los alumnos.";
		// Sin nadie que calificar: o nadie la recibe, o todos los que la reciben faltaron hoy
		var etiquetaConteo = conteo.total ? conteo.hechos + " de " + conteo.total + " calificados"
			: alumnosDeProducto(producto).length ? "Faltaron hoy" : "Sin alumnos";
		var terminada = conteo.total > 0 && conteo.hechos === conteo.total;
		return "<div class='mb-3 rounded-xl border border-gray-200' data-bloque-producto='" + esc(producto.id) + "'>" +
			// El renglón: se toca para abrir o cerrar (aria-expanded); no lleva data-producto, que es del semáforo
			"<button type='button' data-abrir-producto='" + esc(producto.id) + "' aria-expanded='" + (abierto ? "true" : "false") + "' " +
			"aria-controls='cuerpo-prod-" + esc(producto.id) + "' class='w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left rounded-xl hover:bg-gray-50'>" +
			chevron(abierto) +
			"<span class='min-w-0 flex-1 text-sm font-medium text-gray-700 break-words'>" + esc(producto.nombre) +
			// Para quién: sus grados (en multigrado salían bloques iguales sin decir de qué grado
			// eran) y los alumnos incluidos o excluidos
			"<span class='text-sm font-semibold text-blue-700'> · " + esc(paraQuien(producto)) + "</span>" +
			"<span class='text-xs text-gray-400 ml-2'>" + esc(producto.campo || "") + "</span></span>" +
			"<span data-conteo-calificados class='shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 " +
			(terminada ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600") + "'>" + etiquetaConteo + "</span>" +
			"</button>" +
			"<div id='cuerpo-prod-" + esc(producto.id) + "' class='" + (abierto ? "" : "hidden ") + "px-3 pb-2'>" +
			"<div class='flex sm:justify-end'>" + botonesProducto(producto) + "</div>" +
			(filas || vacio(sinFilas)) + "</div></div>";
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

	/*
		Una frase sugerida ("No trajo material") se AGREGA al final de la retroalimentación que ya
		estaba escrita ("Le faltó color. No trajo material"); antes la reemplazaba y se perdía lo
		escrito. Si esa frase ya está, no se repite (sin importar mayúsculas ni el punto final).
	*/
	function agregarFrase(actual, frase) {
		var texto = String(actual === null || actual === undefined ? "" : actual).replace(/\s+$/, "");
		var nueva = String(frase === null || frase === undefined ? "" : frase).trim();
		if (!nueva) return texto;
		if (!texto) return nueva;
		function limpio(t) { return t.toLowerCase().replace(/[\s.,;:!?…]+/g, " ").trim(); }
		if ((" " + limpio(texto) + " ").indexOf(" " + limpio(nueva) + " ") !== -1) return String(actual);
		return texto + (/[.!?…]$/.test(texto) ? " " : ". ") + nueva;
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

		var btnTerminar = e.target.closest("button[data-terminar-sesion]");
		if (btnTerminar) { await terminarSesion(btnTerminar); return; }

		// Abrir o cerrar una actividad: se cambia lo que se ve sin volver a dibujar (el foco y el
		// desplazamiento se quedan) y se recuerda en productosAbiertos para el siguiente dibujo
		var btnAbrir = e.target.closest("button[data-abrir-producto]");
		if (btnAbrir) {
			var idProd = btnAbrir.dataset.abrirProducto;
			var seAbreProd = !productosAbiertos[idProd];
			productosAbiertos[idProd] = seAbreProd;
			var cuerpoProd = document.getElementById("cuerpo-prod-" + idProd);
			if (cuerpoProd) cuerpoProd.classList.toggle("hidden", !seAbreProd);
			btnAbrir.setAttribute("aria-expanded", seAbreProd ? "true" : "false");
			var flecha = btnAbrir.querySelector("[data-chevron]");
			if (flecha) flecha.classList.toggle("rotate-90", seAbreProd);
			return;
		}

		// La secuencia de una sesión (panel de las de hoy, ojo de las que faltan)
		var btnSecuencia = e.target.closest("button[data-secuencia], button[data-ver-secuencia]");
		if (btnSecuencia) {
			await alternarSecuencia(btnSecuencia.dataset.secuencia || btnSecuencia.dataset.verSecuencia, !!btnSecuencia.dataset.reintentar);
			return;
		}

		// "N sesiones restantes" de un proyecto
		var btnRestantes = e.target.closest("button[data-abrir-restantes]");
		if (btnRestantes) {
			var idProy = btnRestantes.dataset.abrirRestantes;
			restantesAbiertas[idProy] = !restantesAbiertas[idProy];
			repintarSesiones();
			return;
		}

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
			// La frase se agrega al final de lo ya escrito (antes lo reemplazaba) y no se repite
			if (ta) {
				var conFrase = agregarFrase(ta.value, btnRetro.dataset.texto);
				if (conFrase !== ta.value) {
					ta.value = conFrase;
					ta.dispatchEvent(new Event("change", { bubbles: true }));
				}
			}
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
				: window.AlcanceHoy.cambiosIncompleta("marcar", { hoy: hoy, ajustes: ajustesCal,
					// Actividad histórica (de un día anterior al de su creación): no pasa a la siguiente clase
					historico: window.AlcanceHoy.esHistorico(producto, producto.sesion && producto.sesion.fecha) }));
		} else if (btn.dataset.estado === "no_entregado") {
			// No entregó en clase (decisión del 2026-09-29): vale 0 y pasa a revisión el siguiente día de
			// clase, como Incompleta; tocarlo otra vez lo quita. En una actividad histórica no hay revisión.
			guardarCalificacion(alumno, producto, cal.estado_entrega === "no_entregado"
				? Object.assign({ estado_entrega: null, nivel: null }, sinIncompleta)
				: window.AlcanceHoy.cambiosIncompleta("no_entregado", { hoy: hoy, ajustes: ajustesCal,
					historico: window.AlcanceHoy.esHistorico(producto, producto.sesion && producto.sesion.fecha) }));
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
		guardarNotasPendientes(); // los comentarios del cierre a medio escribir también entran a la cola
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
		if (poner && window.SesionTerminar) {
			var destino = todasLasSesiones.filter(function (s) { return s.id === sesionId; })[0];
			var abierta = destino ? window.SesionTerminar.enCursoDe(todasLasSesiones.filter(function (x) { return !esSuelta(x); }), destino.proyecto_id) : [];
			if (abierta.length) {
				avisoALaVista("Primero termina la sesión " + abierta.map(function (x) { return x.numero_sesion; }).join(", ") + " de este proyecto; después empiezas la siguiente.");
				return;
			}
		}
		btn.disabled = true;
		try {
			// La pantalla se recarga al final: primero debe quedar guardado todo lo que ya
			// se capturó (antes la recarga cortaba la cola y se perdían marcas). Siempre esperarCola (R36): también lo
			// que se acaba de encolar (la retroalimentación o el comentario a medio escribir), que pendientes() no cuenta
			guardarRetrosPendientes(); // lo que se está escribiendo entra a la cola
			if (sinSenal()) { avisoSinSenal(btn, poner); return; }
			btn.textContent = "Guardando lo capturado...";
			// No se espera para siempre: si la cola se atora (sin red, error del servidor,
			// sesión), se dice qué pasa y el botón vuelve; la sesión no cambia
			var envio = await esperarCola();
			if (envio !== "ok") {
				if (envio === "red" || envio === "servidor" || envio === "pendiente") { avisoSinSenal(btn, poner, envio); return; }
				btn.disabled = false;
				btn.textContent = poner ? "Trabajar hoy" : "Quitar de hoy";
				avisoALaVista("Primero hay que enviar lo capturado y tu sesión no está activa. Vuelve a iniciar sesión e inténtalo de nuevo; lo capturado sigue guardado en este dispositivo.");
				return;
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
			avisoALaVista("No se pudo actualizar la sesión: " + textoError(err));
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
		avisoALaVista(motivo === "servidor"
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
		cancelar.textContent = opciones.cancelar || "Cancelar";
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
				avisar("No se pudo guardar: " + textoError(err) + ".");
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
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo agregar: " + textoError(res.error) + ".");
					return false;
				}
				var nuevo = suelta ? (res.data || {}).producto : res.data;
				var ses = sesion;
				if (suelta) ses = incorporarSesionSuelta(res.data);
				if (!nuevo || !nuevo.id) { avisar("No se pudo agregar: la base no devolvió la actividad."); return false; }
				nuevo.sesion = ses;
				productosAbiertos[nuevo.id] = true; // la que se acaba de agregar se ve abierta, lista para calificar
				asignaciones[nuevo.id] =window.AlcanceHoy.indiceAsignaciones(plan.filas.map(function (f) {
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
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo guardar: " + textoError(res.error) + ".");
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
		sesión vieja; esperarCola, R36: también lo que se acaba de encolar) y después se recarga la pantalla.
		Si algo no se pudo enviar, no se pasa.
	*/
	async function pasarAProyecto(productoId, origen) {
		var producto = productoPorId(productoId);
		if (!producto || !window.PasarAProyecto) return;
		guardarRetrosPendientes();
		if (sinSenal()) { avisoALaVista("Pasar a un proyecto necesita señal. " + TEXTO_SIN_SENAL.replace("Esto necesita señal. ", "")); return; }
		// Siempre (sin mirar pendientes(): lo que se acaba de encolar aún no cuenta ahí)
		origen.disabled = true;
		var envio = await esperarCola();
		origen.disabled = false;
		if (envio !== "ok") { avisoALaVista("Primero hay que enviar lo capturado y ahora no se pudo. Lo capturado sigue guardado en este dispositivo; inténtalo en un momento."); return; }
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
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo renombrar: " + textoError(res.error) + ".");
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
				: "No se pudo revisar si tiene calificaciones, así que no se quitó: " + textoError(err) + ".");
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
						avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo revisar si tiene calificaciones, así que no se quitó: " + textoError(err) + ".");
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
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo quitar: " + textoError(upd.error) + ".");
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
	/*
		Una tabla con encabezado fijo (sticky top-14: se queda a la vista al bajar por la lista) y una
		columna por cosa, cada una de su color: No., Grado, Nombre, Participación, Conducta y Comentarios,
		en el orden de la lista (OrdenLista). A quien faltó se le pone "Faltó" y no se le muestran chips
		(sí su caja de comentario: para anotar el motivo). Desde xl (1280 px) es tabla de seis columnas;
		de md (768 px) a xl, de cinco con el comentario en una fila debajo de cada alumno; abajo de md,
		una tarjeta por alumno con las mismas cosas. El significado del 0, 1 y 2 está en la leyenda de hoy.html.
		El comentario (registro_diario.nota, mi_salon_b25) se guarda tras una pausa, como la
		retroalimentación, y funciona sin señal (js/bandeja-salida.js).
	*/
	// Desde md (768 px): cinco columnas y el comentario en una fila debajo de cada alumno (el ancho de la tarjeta no da para
	// seis); desde xl (1280 px, la tableta en horizontal): seis columnas, con Comentarios al lado
	function columnasCierre() {
		return "md:grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_10.5rem_10.5rem] xl:grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_10.5rem_10.5rem_minmax(0,1.3fr)]";
	}

	function encabezadoCierre() {
		return "<div data-cierre-encabezado class='hidden md:grid " + columnasCierre() + " sticky top-14 z-20 mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm text-xs font-semibold'>" +
			"<span class='bg-gray-100 px-2 py-2 text-right text-gray-600'>No.</span>" +
			"<span class='bg-gray-100 px-2 py-2 text-gray-600'>Grado</span>" +
			"<span class='bg-gray-100 px-2 py-2 text-gray-600'>Nombre</span>" +
			"<span class='bg-violet-100 px-2 py-2 text-center text-violet-800'>Participación</span>" +
			"<span class='bg-teal-100 px-2 py-2 text-center text-teal-800'>Conducta</span>" +
			"<span class='hidden xl:block bg-amber-100 px-2 py-2 text-amber-800'>Comentarios</span></div>";
	}

	function celdaCierre(alumno, campo, etiqueta, valor, colorTexto, colorActivo) {
		return "<div class='flex items-center gap-2 mt-2 md:mt-0 md:justify-center md:px-2 md:py-1.5' data-cierre-columna='" + campo + "'>" +
			"<span class='md:hidden w-28 shrink-0 text-xs font-semibold " + colorTexto + "'>" + etiqueta + "</span>" +
			"<div class='flex gap-2'>" + [0, 1, 2].map(function (n) {
				return chip(String(n), valor === n, colorActivo,
					"data-cierre='" + campo + "' data-alumno='" + alumno.id + "' data-valor='" + n + "'");
			}).join("") + "</div></div>";
	}

	// Lo que se ve en la caja de comentario: lo que se está escribiendo o lo guardado
	function textoNota(alumnoId) {
		if (notasPendientes[alumnoId]) return notasPendientes[alumnoId].texto;
		var v = registro[alumnoId];
		return v && v.nota ? v.nota : "";
	}

	// La caja de comentario de un alumno (también de quien faltó: para anotar el motivo). Abajo de md lleva su etiqueta
	function celdaNota(al) {
		return "<div class='mt-2 md:col-span-5 md:px-2 md:pb-2 xl:col-span-1 xl:mt-0 xl:py-1.5 xl:pb-1.5' data-cierre-columna='nota'>" +
			"<label for='cierreNota-" + esc(al.id) + "' class='xl:hidden mb-1 block text-xs font-semibold text-amber-800'>Comentarios</label>" +
			"<textarea id='cierreNota-" + esc(al.id) + "' rows='1' maxlength='" + NOTA_MAX + "' data-cierre-nota='" + esc(al.id) + "' " +
			"aria-label='Comentario del día de " + esc(al.nombre_completo) + "' placeholder='Comentario (opcional)' " +
			"class='block w-full min-h-[44px] resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500'>" +
			esc(textoNota(al.id)) + "</textarea>" +
			"<p data-cierre-nota-cuenta='" + esc(al.id) + "' aria-live='polite' class='" + (textoCuentaNota(textoNota(al.id).length) ? "" : "hidden ") +
			"mt-1 text-right text-xs " + (textoNota(al.id).length >= NOTA_MAX ? "text-amber-800" : "text-gray-500") + "'>" +
			esc(textoCuentaNota(textoNota(al.id).length)) + "</p></div>";
	}

	/*
		El comentario llega hasta NOTA_MAX caracteres (la caja no deja escribir más; la base no cambia). Cerca del límite
		aparece un contador discreto y, si se pegó un texto más largo, se avisa que se recortó.
	*/
	var NOTA_AVISO = 450;
	var notaRecortada = {}; // alumno_id -> true: lo último que se pegó no cabía
	function textoCuentaNota(n, recortada) {
		if (recortada) return "Se recortó lo que pegaste: el comentario llega hasta " + NOTA_MAX + " caracteres.";
		if (n >= NOTA_MAX) return n + " de " + NOTA_MAX + ": llegaste al límite.";
		if (n >= NOTA_AVISO) return n + " de " + NOTA_MAX;
		return "";
	}
	function contarNota(ta, recortada) {
		var el = document.getElementById("cierreLista").querySelector("[data-cierre-nota-cuenta='" + ta.dataset.cierreNota + "']");
		if (!el) return;
		var t = textoCuentaNota((ta.value || "").length, recortada);
		el.textContent = t;
		if (el.classList) {
			el.classList.toggle("hidden", !t);
			el.classList.toggle("text-amber-800", !!recortada || (ta.value || "").length >= NOTA_MAX);
			el.classList.toggle("text-gray-500", !recortada && (ta.value || "").length < NOTA_MAX);
		}
	}

	// La caja crece con lo escrito (hasta unas cuatro líneas)
	function ajustarAlturaNota(ta) {
		if (!ta || !ta.style) return;
		ta.style.height = "auto";
		ta.style.height = Math.max(44, Math.min(ta.scrollHeight || 0, 128)) + "px";
	}

	// ¿Ya tiene participación Y conducta guardadas? Una fila que solo trae su comentario no es un cierre (la misma
	// regla que Inicio: AlcanceHoy.tieneCierre)
	function cierreGuardado(alumnoId) {
		return !!registroGuardado[alumnoId] && window.AlcanceHoy.tieneCierre(registro[alumnoId]);
	}

	function filaCierre(al) {
		var v = registro[al.id];
		var falto = faltoHoy(al.id);
		// Quien faltó y ya tiene una fila con valores distintos de 1 y 1 (la capturó antes de marcarle la
		// falta): se ve "Faltó" CON sus chips, para corregirla, y un botón para quitarla del cierre. Una fila
		// que solo trae el comentario (sin participación ni conducta) no cuenta: es el caso normal de quien faltó
		var conValores = !!v && ((v.participacion !== null && v.participacion !== undefined) || (v.conducta !== null && v.conducta !== undefined));
		var conFila = falto && !!registroGuardado[al.id] && conValores && (v.participacion !== 1 || v.conducta !== 1);
		var etiquetaFalto = "<span data-cierre-falto class='inline-flex items-center rounded-lg bg-gray-100 px-3 min-h-[36px] text-sm font-semibold text-gray-600'>" +
			(asistencia[al.id] === "justificada" ? "Faltó · justificada" : "Faltó") + "</span>";
		var estado = falto && !conFila
			? "<div class='mt-2 md:mt-0 md:col-span-2 md:px-2 md:py-2'>" + etiquetaFalto + "</div>"
			: celdaCierre(al, "participacion", "Participación", v ? v.participacion : 1, "text-violet-800", "bg-violet-600 text-white") +
				celdaCierre(al, "conducta", "Conducta", v ? v.conducta : 1, "text-teal-800", "bg-teal-600 text-white");
		var quitar = conFila ? "<div class='mt-2 flex flex-wrap items-center gap-2 md:col-span-5 xl:col-span-6 md:px-2 md:pb-2'>" + etiquetaFalto +
			"<span class='text-xs text-gray-500'>Tiene un cierre capturado.</span>" +
			"<button type='button' data-cierre-quitar='" + esc(al.id) + "' class='min-h-[44px] px-4 rounded-xl border border-red-200 text-sm font-semibold text-red-700 hover:bg-red-50'>Quitar del cierre</button></div>" : "";
		return "<div data-cierre-fila='" + esc(al.id) + "' class='mb-2 rounded-xl border border-gray-200 p-3 md:mb-0 md:grid " + columnasCierre() +
			" md:items-center md:rounded-none md:border-0 md:border-b md:border-gray-100 md:p-0'>" +
			"<div class='flex items-baseline gap-2 md:contents'>" +
			"<span data-num-lista class='text-sm font-bold text-gray-900 tabular-nums md:px-2 md:text-right'>" + esc(al.num_lista || "") + "</span>" +
			"<span class='order-last text-xs text-gray-500 md:order-none md:px-2' data-cierre-grado>" + esc(al.grado) + "°</span>" +
			"<span class='min-w-0 break-words text-sm font-medium text-gray-800 md:px-2 md:py-2'>" + esc(al.nombre_completo) + "</span></div>" +
			estado + celdaNota(al) + quitar + "</div>";
	}

	// Cuántos cierres hay guardados y el botón de abajo (sin volver a dibujar la lista: no se pierde lo que se escribe)
	function resumenDelCierre() {
		var esperados = alumnos.filter(function (a) { return !faltoHoy(a.id); });
		var guardados = esperados.filter(function (a) { return cierreGuardado(a.id); }).length;
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

	function renderCierre() {
		var cont = document.getElementById("cierreLista");
		// Si se está escribiendo un comentario, el foco y el cursor se quedan donde estaban
		var activo = typeof document.activeElement !== "undefined" ? document.activeElement : null;
		var foco = activo && activo.dataset && activo.dataset.cierreNota && cont.contains && cont.contains(activo)
			? { id: activo.dataset.cierreNota, ini: activo.selectionStart, fin: activo.selectionEnd } : null;
		cont.innerHTML = encabezadoCierre() + (window.OrdenLista ? window.OrdenLista.ordenar(alumnos) : alumnos).map(filaCierre).join("");
		cont.querySelectorAll("textarea[data-cierre-nota]").forEach(function (ta) { if (ta.value) ajustarAlturaNota(ta); });
		if (foco) {
			var ta = cont.querySelector("textarea[data-cierre-nota='" + foco.id + "']");
			if (ta && ta.focus) {
				ta.focus();
				try { ta.setSelectionRange(foco.ini, foco.fin); } catch (_) { /* sin selección */ }
			}
		}
		resumenDelCierre();
	}

	/*
		Un comentario: se guarda tras una pausa o al salir de la caja. Sin cambios no escribe nada. A quien faltó
		se le guarda sin participación ni conducta (una fila solo con su comentario); si después se borra y no queda
		nada, la fila se retira. Al alumno que asistió se le crea su fila con 1 y 1, como cualquier toque del cierre.
	*/
	function guardarNota(alumnoId) {
		var p = notasPendientes[alumnoId];
		if (!p) return;
		clearTimeout(p.timer);
		delete notasPendientes[alumnoId];
		var nota = String(p.texto || "").trim() || null;
		var v = registro[alumnoId];
		if (nota === ((v && v.nota) || null)) return;
		if (!v) v = registro[alumnoId] = registroPorOmision(alumnoId);
		v.nota = nota;
		var sinValores = (v.participacion === null || v.participacion === undefined) && (v.conducta === null || v.conducta === undefined);
		if (!nota && sinValores && faltoHoy(alumnoId)) {
			delete registro[alumnoId];
			registroGuardado[alumnoId] = false;
			guardar("registro_borrar", { alumno_id: alumnoId, fecha: hoy }, "Cierre del día de " + nombreDe(alumnoId));
		} else {
			guardarRegistro(alumnoId, "nota");
		}
		resumenDelCierre();
	}
	function guardarNotasPendientes() {
		Object.keys(notasPendientes).forEach(guardarNota);
	}

	document.getElementById("cierreLista").addEventListener("input", function (e) {
		var ta = e.target && e.target.closest ? e.target.closest("textarea[data-cierre-nota]") : null;
		if (!ta) return;
		var id = ta.dataset.cierreNota;
		if (notasPendientes[id]) clearTimeout(notasPendientes[id].timer);
		notasPendientes[id] = { texto: ta.value, timer: setTimeout(function () { guardarNota(id); }, 1000) };
		ajustarAlturaNota(ta);
		contarNota(ta, !!notaRecortada[id]);
		delete notaRecortada[id];
	});
	// Pegar un texto que no cabe: la caja lo recorta (maxlength) y el contador lo dice
	document.getElementById("cierreLista").addEventListener("paste", function (e) {
		var ta = e.target && e.target.closest ? e.target.closest("textarea[data-cierre-nota]") : null;
		if (!ta) return;
		var pegado = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text") : "";
		var elegido = Math.max(0, (ta.selectionEnd || 0) - (ta.selectionStart || 0));
		if ((ta.value || "").length - elegido + pegado.length > NOTA_MAX) notaRecortada[ta.dataset.cierreNota] = true;
	});
	document.getElementById("cierreLista").addEventListener("focusout", function (e) {
		var ta = e.target && e.target.closest ? e.target.closest("textarea[data-cierre-nota]") : null;
		if (ta) guardarNota(ta.dataset.cierreNota);
	});

	document.getElementById("cierreLista").addEventListener("click", function (e) {
		// "Quitar del cierre": borra la fila de quien faltó (por la cola, como retirarCierreSiFalto). Si la fila
		// tiene comentario, solo se le quitan la participación y la conducta: el comentario se queda
		var quitar = e.target.closest("button[data-cierre-quitar]");
		if (quitar && quitar.dataset.cierreQuitar) {
			var idQuitar = quitar.dataset.cierreQuitar;
			var vQuitar = registro[idQuitar];
			if (vQuitar && vQuitar.nota) {
				vQuitar.participacion = null;
				vQuitar.conducta = null;
				guardarRegistro(idQuitar, ["participacion", "conducta"]);
			} else {
				delete registro[idQuitar];
				registroGuardado[idQuitar] = false;
				guardar("registro_borrar", { alumno_id: idQuitar, fecha: hoy }, "Cierre del día de " + nombreDe(idQuitar));
			}
			renderCierre();
			return;
		}
		var btn = e.target.closest("button[data-cierre]");
		if (!btn) return;
		var alumnoId = btn.dataset.alumno;
		var actual = registro[alumnoId] || registroPorOmision(alumnoId);
		// Igual que en Asistencia: volver a tocar el valor ya guardado no escribe nada
		if (registroGuardado[alumnoId] && actual[btn.dataset.cierre] === Number(btn.dataset.valor)) return;
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

	// ── 5. Finalizar jornada ──────────────────────────────────────────────────
	/*
		Al terminar el día: guarda lo que esté a medio escribir (retroalimentaciones y comentarios), completa el
		cierre, espera a que todo llegue a la base y registra la jornada (jornadas, mi_salon_b25: una fila por
		grupo y día). Antes dice lo que falta (AlcanceHoy.faltantesJornada) con un enlace a cada parte; se puede
		"Finalizar de todos modos". No bloquea nada: se sigue editando y se puede "Finalizar de nuevo". Necesita
		señal: sin ella avisa y NO marca el día.
	*/
	function horaDe(iso) {
		try { return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }); } catch (_) { return ""; }
	}

	function renderJornada() {
		var btn = document.getElementById("jornadaBtn");
		var linea = document.getElementById("jornadaEstado");
		var texto = document.getElementById("jornadaEstadoTexto");
		if (btn) btn.textContent = jornadaHoy ? "Finalizar de nuevo" : "Finalizar jornada";
		if (linea && linea.classList) linea.classList.toggle("hidden", !jornadaHoy);
		if (!texto) return;
		if (!jornadaHoy) { texto.textContent = ""; return; }
		var cerrada = horaDe(jornadaHoy.cerrada_en), actualizada = horaDe(jornadaHoy.actualizada_en);
		texto.textContent = "Jornada finalizada a las " + cerrada + (actualizada && actualizada !== cerrada ? " · actualizada a las " + actualizada : "");
	}

	// Lo que falta del día, con las mismas reglas que las tarjetas de arriba (AlcanceHoy.faltantesJornada lo cuenta)
	function faltantesDeLaJornada() {
		var trabajos = [], tareasDia = [], esTarea = {};
		sesionesHoy.forEach(function (ses) {
			(productosPorSesion[ses.id] || []).forEach(function (p) {
				if (p.tipo === "tarea") return; // las tareas que se dejan hoy se revisan otro día
				trabajos.push({ id: p.id, nombre: p.nombre, alumnos: alumnosParaCalificar(p).map(function (a) { return a.id; }) });
			});
		});
		tareas.forEach(function (t) {
			esTarea[t.id] = true;
			tareasDia.push({ id: t.id, nombre: t.nombre, alumnos: alumnosParaCalificar(t).map(function (a) { return a.id; }) });
		});
		var pendientes = 0;
		pendientesDeRevisar().forEach(function (x) {
			if (x.cal.estado_en_clase === "incompleta" && !faltoHoy(x.alumno.id)) pendientes++;
		});
		// Lo de una falta justificada sin calificar: faltantesJornada solo cuenta lo que ya venció (dentro de sus 3
		// días de clase, o si el alumno aún no regresa, todavía no falta)
		var porFalta = [];
		itemsPorFalta().forEach(function (x) {
			if (window.AlcanceHoy.sinCalificar(calificaciones[x.alumno.id + "|" + x.producto.id]) && !faltoHoy(x.alumno.id)) porFalta.push({ vence: x.vence || null });
		});
		var enCurso = sesionesHoy.filter(function (s) { return !esSuelta(s) && s.estado_sesion !== "completada"; }).map(function (s) {
			var pr = proyectoPorId[s.proyecto_id] || {};
			return { id: s.id, numero_sesion: s.numero_sesion, titulo: pr.titulo || "" };
		});
		return window.AlcanceHoy.faltantesJornada({
			alumnos: alumnos, asistencia: asistencia, trabajos: trabajos, tareas: tareasDia, pendientes: pendientes, porFalta: porFalta, hoy: hoy, sesiones: enCurso,
			calificado: function (alumnoId, productoId) {
				var c = calificaciones[alumnoId + "|" + productoId];
				return esTarea[productoId] ? !!(c && c.estado_entrega) : estaCalificado(c);
			},
		});
	}

	// El cuerpo del diálogo: cada cosa que falta, con su enlace a la parte de la pantalla
	function construirFaltantes(cuerpo, f, alIr) {
		var intro = document.createElement("p");
		intro.className = "text-sm text-gray-600";
		intro.textContent = "Todavía falta esto del día. Puedes volver a completarlo o finalizar así.";
		cuerpo.appendChild(intro);
		var lista = document.createElement("ul");
		lista.className = "flex flex-col gap-2";
		// nota: una línea de aviso debajo del texto (ámbar)
		function fila(texto, ancla, etiqueta, nota) {
			var li = document.createElement("li");
			li.className = "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800";
			var t = document.createElement("div");
			t.className = "min-w-0";
			var p = document.createElement("p");
			p.textContent = texto;
			t.appendChild(p);
			if (nota) {
				var aviso = document.createElement("p");
				aviso.setAttribute("data-faltante-aviso", ancla);
				aviso.className = "mt-1 text-xs font-medium text-amber-800";
				aviso.textContent = nota;
				t.appendChild(aviso);
			}
			var a = document.createElement("a");
			a.href = "#" + ancla;
			a.setAttribute("data-faltante", ancla);
			a.className = "inline-flex items-center min-h-[44px] shrink-0 font-semibold text-blue-700 hover:underline";
			a.textContent = etiqueta + " →";
			a.addEventListener("click", function () { alIr(ancla); });
			li.appendChild(t);
			li.appendChild(a);
			lista.appendChild(li);
		}
		if (f.asistencia.n) {
			// "Finalizar de todos modos" completa el cierre: a quien no tiene asistencia ni cierre se le pone 1 y 1
			var sinMarca = alumnos.filter(function (a) { return !asistencia[a.id] && !cierreGuardado(a.id); }).length;
			fila("Falta la asistencia de " + f.asistencia.n + (f.asistencia.n === 1 ? " alumno: " : " alumnos: ") + f.asistencia.alumnos.join(", ") + ".", "asistencia", "Ir a Asistencia",
				sinMarca ? "Si finalizas así, en el cierre del día " + (sinMarca === 1 ? "se le pondrá" : "se les pondrá") +
					" 1 y 1 de participación y conducta, como si " + (sinMarca === 1 ? "hubiera asistido" : "hubieran asistido") + ". Si faltó alguien, márcalo antes en Asistencia." : "");
		}
		if (f.trabajos.n) fila(f.trabajos.n + (f.trabajos.n === 1 ? " calificación de trabajo sin poner" : " calificaciones de trabajos sin poner") + " (" + f.trabajos.productos.map(function (p) { return p.nombre; }).join(", ") + ").", "sesiones", "Ir a las sesiones");
		if (f.tareas.n) fila(f.tareas.n + (f.tareas.n === 1 ? " tarea sin revisar" : " tareas sin revisar") + " (" + f.tareas.productos.map(function (p) { return p.nombre; }).join(", ") + ").", "tareas", "Ir a Tareas");
		if (f.pendientes.n) {
			var partes = [];
			var clase = f.pendientes.clase === undefined ? f.pendientes.n : f.pendientes.clase;
			if (clase) partes.push(clase + (clase === 1 ? " pendiente de la clase anterior sin revisar" : " pendientes de la clase anterior sin revisar"));
			if (f.pendientes.vencidos) partes.push(f.pendientes.vencidos + " por falta justificada con el plazo vencido");
			fila(partes.join(" y ") + ".", "pendientes", "Ir a Pendientes");
		}
		f.sesiones.lista.forEach(function (s) {
			fila("La sesión " + (s.numero_sesion || "") + (s.titulo ? " de «" + window.AlcanceHoy.nombreBreve(s.titulo, 60) + "»" : "") + " sigue sin terminar.", "ses-" + s.id, "Ir a la sesión");
		});
		cuerpo.appendChild(lista);
	}

	// Sale a la parte de la pantalla que falta (el diálogo se cierra antes)
	function irAFaltante(ancla) {
		var el = document.getElementById(ancla);
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
	}

	// Por qué no se pudo enviar lo capturado (el día NO se marca)
	function textoSinEnviar(envio) {
		if (envio === "sesion" || envio === "cuenta") return "Primero hay que enviar lo capturado y tu sesión no está activa. Vuelve a iniciar sesión e inténtalo de nuevo; lo capturado sigue guardado en este dispositivo.";
		if (envio === "acceso") return "Lo capturado no se pudo enviar porque Mi Salón está en solo lectura, así que el día no se marcó. Sigue guardado en este dispositivo.";
		return "Todavía no se pudo enviar lo capturado, así que el día no se marcó. Sigue guardado en este dispositivo y se reintentará solo; inténtalo de nuevo en un momento.";
	}

	/*
		Registra la jornada: completa el cierre, espera a que TODO llegue a la base (también lo que se acaba de encolar:
		el relleno 1 y 1 y el comentario a medio escribir; esperarCola) y solo entonces escribe en jornadas. Devuelve
		{ ok: true } o { ok: false, texto } (el día NO queda marcado).
	*/
	async function registrarJornada(faltantes) {
		completarCierre();
		renderCierre();
		if (sinSenal()) return { ok: false, texto: "Sin señal: para finalizar la jornada hace falta señal, y el día no se marcó. Lo que ya capturaste sigue guardado en este dispositivo. Inténtalo de nuevo cuando haya señal." };
		var envio = await esperarCola();
		if (envio !== "ok") return { ok: false, texto: textoSinEnviar(envio) };
		var resumen = Object.assign({}, faltantes.resumen, { de_todos_modos: !faltantes.completo });
		var res = await window.sb.from("jornadas")
			.upsert({ maestro_id: user.id, grupo_id: grupo.id, fecha: hoy, resumen: resumen }, { onConflict: "grupo_id,fecha" })
			.select("cerrada_en, actualizada_en");
		if (res.error) {
			return { ok: false, texto: sinSenal() ? "Sin señal: el día no se marcó. Lo capturado sigue guardado. Inténtalo de nuevo cuando haya señal."
				: "No se pudo registrar la jornada: " + textoError(res.error) + ". Lo capturado sí quedó guardado; el día no se marcó." };
		}
		var fila = res.data && res.data[0];
		jornadaHoy = fila || { cerrada_en: new Date().toISOString(), actualizada_en: new Date().toISOString() };
		renderJornada();
		return { ok: true };
	}

	async function finalizarJornada(btn) {
		if (esperandoJornada || !pintado) return;
		esperandoJornada = true;
		var etiqueta = btn.textContent;
		try {
			guardarRetrosPendientes(); // lo que se está escribiendo (retroalimentaciones y comentarios) entra a la cola
			if (sinSenal()) {
				avisoALaVista("Sin señal: para finalizar la jornada hace falta señal, y el día no se marcó. Lo que ya capturaste sigue guardado en este dispositivo. Inténtalo de nuevo cuando haya señal.");
				return;
			}
			// Siempre (sin mirar pendientes(): lo que se acaba de encolar aún no cuenta ahí)
			btn.disabled = true;
			btn.textContent = "Guardando lo capturado...";
			var envio = await esperarCola();
			btn.disabled = false;
			btn.textContent = etiqueta;
			if (envio !== "ok") { avisoALaVista(textoSinEnviar(envio)); return; }
			mensaje("", "");
			var faltantes = faltantesDeLaJornada();
			if (faltantes.completo) {
				btn.disabled = true;
				btn.textContent = "Finalizando...";
				var r = await registrarJornada(faltantes);
				btn.disabled = false;
				btn.textContent = etiqueta;
				if (!r.ok) { avisoALaVista(r.texto); return; }
				renderJornada();
				mensaje("info", "Jornada finalizada a las " + horaDe(jornadaHoy.cerrada_en) + ".");
				return;
			}
			var dialogo = abrirDialogo({
				origen: btn,
				titulo: "Antes de finalizar la jornada",
				aceptar: "Finalizar de todos modos",
				cancelar: "Volver",
				construir: function (cuerpo) {
					construirFaltantes(cuerpo, faltantes, function (ancla) {
						dialogo.cerrar();
						irAFaltante(ancla);
					});
				},
				alAceptar: async function (form, avisar) {
					var res = await registrarJornada(faltantes);
					if (!res.ok) { avisar(res.texto); return false; }
					mensaje("info", "Jornada finalizada a las " + horaDe(jornadaHoy.cerrada_en) + ".");
				},
			});
		} finally {
			esperandoJornada = false;
			if (btn && !btn.disabled) btn.textContent = jornadaHoy ? "Finalizar de nuevo" : "Finalizar jornada";
		}
	}

	var jornadaBtn = document.getElementById("jornadaBtn");
	if (jornadaBtn && jornadaBtn.addEventListener) {
		jornadaBtn.addEventListener("click", function () { finalizarJornada(jornadaBtn); });
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
				// Una captura vieja de la cola (de antes de b25) no trae `nota`: no la toca
				var r = registro[d.alumno_id] || {
					participacion: d.participacion === undefined ? 1 : d.participacion,
					conducta: d.conducta === undefined ? 1 : d.conducta, nota: null,
				};
				registro[d.alumno_id] = {
					participacion: "participacion" in v ? v.participacion : r.participacion,
					conducta: "conducta" in v ? v.conducta : r.conducta,
					nota: "nota" in v ? v.nota : (r.nota || null),
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
		if (["asistencia", "tareas", "sesiones", "cierre", "siguientes"].indexOf(id) === -1) return;
		var el = document.getElementById(id);
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
		// Tras "Terminar sesión" la página se recarga con el scroll donde estaba (al fondo): el navegador lo restaura
		// DESPUÉS de pintar y taparía la tarjeta azul. Se vuelve a poner a la vista un momento después.
		if (id === "siguientes") {
			[250, 900].forEach(function (ms) {
				setTimeout(function () { var e2 = document.getElementById(id); if (e2 && e2.scrollIntoView) e2.scrollIntoView({ block: "start" }); }, ms);
			});
		}
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
		mensaje("error", "No se pudieron cargar los datos del día: " + textoError(e) +
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
	// Con toda la asistencia capturada, la tarjeta aparece plegada (con su resumen)
	asistenciaPlegada = asistenciaCompleta();
	[
		["asistencia", renderAsistencia],
		["tareas", renderTareas],
		["pendientes de la clase anterior", renderPendientes],
		["sesiones", renderSesiones],
		["cierre", renderCierre],
		["jornada", renderJornada],
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
