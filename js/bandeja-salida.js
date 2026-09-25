/*
	bandeja-salida.js — La cola de guardado de "Hoy" vive en el dispositivo (fase 2.5 de
	docs/PWA-MI-SALON.md, §9.3; marca por campo, §9.9).

	Cada captura se guarda PRIMERO aquí (IndexedDB "jissez-bandeja", almacén "pendientes") y
	después se envía en serie. Se borra solo cuando la base la confirmó. Si no hay IndexedDB (o
	falla), la cola sigue en memoria y la página lo dice.

	Cada captura es un dato serializable (formato 3):
		{ v: 3, clave, tipo, maestro_id, seq, capturado_en, datos, descripcion, captura_id,
		  campos, vistos, relleno?, borrar?, intentado }
	  tipo "asistencia"      datos { grupo_id, alumno_id, fecha, estado }
	  tipo "registro"        datos { alumno_id, fecha, participacion, conducta, grupo_id? }   (cierre del día)
	  tipo "registro_borrar" datos { alumno_id, fecha }                                      (se retira el cierre)
	  tipo "calificacion"    datos { id?, fecha, fila }  (fila: la de calificaciones)
	  campos  { campo: valor } solo lo que la maestra tocó (estado; participacion, conducta;
	          estado_entrega, nivel, puntaje, retroalimentacion)
	  vistos  { campo: { fila, id, valor } } la versión de la base que la pantalla tenía al tocarlo
	          (id: la marca del grupo de ese campo; null = fila sin marca o sin fila; undefined =
	          no se sabe: se compara por contenido)

	Marca por campo (supabase/mi_salon_b12_captura_id_2026-09.sql). Una columna uuid por grupo de
	campos que Hoy escribe junto (MARCAS): asistencias.captura_id; registro_diario.
	captura_participacion y captura_conducta; calificaciones.captura_semaforo (entrega + nivel),
	captura_puntaje y captura_retroalimentacion.
	  - Cada escritura de Hoy pone en los grupos que escribe un uuid NUEVO generado en el aparato
	    (el mismo para todos los grupos de esa captura). Un insert pone en los grupos que la
	    maestra no tocó y quedan con su valor por defecto la MARCA INICIAL ("nadie lo ha escrito":
	    para quien no veía la fila, es lo que mostraba). Cualquier otra
	    escritura (Asistencia, SQL, otra versión de la app) recibe del trigger una marca nueva del
	    servidor en cada grupo que cambió. Así un cambio de ida y vuelta (A → B → A) de otro
	    aparato o pantalla siempre deja una marca distinta.
	  - La escritura es condicional y atómica: update ... where <marca de cada grupo escrito> =
	    <la que vio la pantalla> (fila sin marca, de antes de la migración: is null + contenido);
	    si no había fila, insert que no pisa. Solo se escriben los grupos tocados.
	  - "Es mío": la marca está entre las que ESTE aparato generó para esa llave (almacén
	    "propias", compartido por todas las ventanas, por cuenta, con poda por cantidad y no por
	    reloj). Cada una se anota ANTES de enviarse, con su número de captura (seq), los grupos
	    que tocó y la marca sobre la que se capturó cada uno (padres): una respuesta perdida o
	    una ventana cerrada no rompen la cadena.
	  - Si la escritura no aplicó, se lee la fila y se decide grupo por grupo:
	      * ya tiene exactamente lo capturado → listo, sin aviso (dos aparatos pusieron lo mismo);
	      * la marca sigue siendo la que vio la pantalla, o la pantalla no veía la fila y el grupo
	        tiene la marca inicial con su valor por defecto → se escribe;
	      * la marca es de una captura propia más vieja (o de un insert propio que no tocó ese
	        grupo), o es una marca ajena que este aparato ya vio (es padre de una
	        captura propia más vieja) → se escribe encima, sin aviso (gana el último toque);
	      * la marca es de una captura propia más nueva → esta ya no aplica (sin aviso);
	      * cualquier otra marca (otro aparato u otra pantalla) → conflicto: NO se pisa y se
	        avisa, aunque el valor coincida con el que vio la pantalla.
	  - El relleno del Cierre del día (1 y 1 a todos) solo inserta donde no hay fila (nunca
	    actualiza ni avisa), con la marca inicial en los dos grupos, y pide la fila de vuelta: la
	    pantalla conoce su versión. No se pone a quien este aparato marcó con falta (aunque haya
	    sido en otra ventana) si la base lo confirma.
	  - Si la base aún no tiene las columnas (el frontend se publicó antes que la migración), se
	    detecta y se usa la regla anterior por contenido (un 400 en la consola por carga): la
	    migración va ANTES que el frontend.

	Otras reglas:
	  - Una sola captura por llave: la más reciente reemplaza a la anterior y hereda sus campos
	    (y la versión que vio de cada uno).
	  - Solo se reintenta lo que es de red (sin respuesta: estado "red"; 408, 429, 5xx: estado
	    "servidor"), con espera creciente, al volver la red, al volver a primer plano y al abrir
	    la página. Sesión vencida: se refresca y se reintenta; sin sesión, se espera. Cualquier
	    otro "no" de la base (400, 403, 404, 409, un CHECK o un trigger) NO se reintenta: sale de
	    la cola y se avisa en español, sin códigos técnicos.
	  - La cola es de la cuenta que capturó (se confirma antes de enviar y antes de terminar).
	  - Varias ventanas del mismo aparato: una sola envía a la vez (Web Locks, si hay) y se
	    avisan por BroadcastChannel (lo confirmado, los avisos y los cambios de la cola).

	Uso (js/hoy.js):
		var b = BandejaSalida.crear({ sb, auth, maestroId, alCambiar, alGuardar, alConflicto, alRechazar, alSaber });
		b.agregar("asistencia", datos, "Asistencia de Ana", base, { campos: ["estado"] });
		  base: lo que la pantalla sabe de la base (BandejaSalida.baseDeFila): { marcas, valor } o null
		b.iniciar();            // habilita el envío (después de pintar lo pendiente)
		b.lista() → Promise<[capturas propias pendientes]>
		b.pendientes(), b.persistente(), b.vacia(), b.esperarEnvio() → Promise
	Otras páginas: BandejaSalida.vigilarFuera() (aviso "N capturas de Hoy sin enviar" y envío).
	Cerrar sesión (js/navbar.js, js/sala-maestros.js):
		BandejaSalida.confirmarSalida(sb) → Promise<boolean>
		BandejaSalida.limpiarAlSalir(sb)  → borra las marcas propias de la cuenta que ya no
		                                     necesita ninguna captura pendiente (privacidad)
*/
var BandejaSalida = (function () {
	var NOMBRE_BD = "jissez-bandeja";
	var VERSION_BD = 2;
	var ALMACEN = "pendientes";
	var PROPIAS = "propias"; // las marcas que generó este aparato, por llave
	var META = "meta";       // el contador de capturas (orden sin reloj)
	var CANAL = "jissez-bandeja";
	var MAX_MARCAS = 40;     // por llave: se podan las más viejas por cantidad
	var MAX_LLAVES = 3000;   // llaves con marcas guardadas (alumno y día, alumno y producto)
	var MAX_INTENTOS_CAS = 5;
	var LIMITE_ENVIO = 30000; // una petición que no contesta en 30 s se da por "sin señal"
	// Una retroalimentación muy larga no va como filtro en la URL: se compara al leer
	var RETRO_MAX_FILTRO = 1000;
	var RECIENTE_MS = 5000; // una captura más vieja que esto ya esperó en la cola
	var FORMATO = 3;        // el formato de las capturas (2: 80a4375, sin publicar; sin v: 3d48d1a)
	/*
		La marca inicial: la pone un insert de Hoy en los grupos que la maestra NO tocó y que quedan
		con su valor por defecto (el relleno 1 y 1 del cierre; el puntaje o la retroalimentación
		vacíos de una calificación nueva). Dice "este grupo nadie lo ha escrito": para una pantalla
		que no veía la fila es lo mismo que no haber fila. Cualquier escritura posterior la cambia
		(la de Hoy trae su marca; cualquier otra recibe una del servidor), así que una ida y vuelta
		se sigue notando.
	*/
	var MARCA_INICIAL = "00000000-0000-4000-8000-000000000000";

	// ¿La base tiene las columnas de marca? null: aún no se sabe (se intenta con ellas)
	var marca = { disponible: null };

	// ── Reglas puras ─────────────────────────────────────────────────────────────
	function clave(tipo, maestroId, d) {
		if (tipo === "asistencia") return "asistencia|" + d.grupo_id + "|" + d.alumno_id + "|" + d.fecha;
		if (tipo === "registro" || tipo === "registro_borrar") return "registro|" + maestroId + "|" + d.alumno_id + "|" + d.fecha;
		if (tipo === "calificacion") return "calificacion|" + maestroId + "|" + d.fila.alumno_id + "|" + d.fila.producto_sesion_id;
		throw new Error("bandeja: tipo desconocido " + tipo);
	}

	var CAMPOS = {
		asistencia: ["estado"],
		registro: ["participacion", "conducta"],
		calificacion: ["estado_entrega", "nivel", "puntaje", "retroalimentacion"],
	};
	/*
		Grupos de campos que Hoy escribe y decide juntos, cada uno con su marca (la columna de la
		base): el semáforo implica la entrega (y "No entregó" quita el semáforo).
	*/
	var MARCAS = {
		asistencia: [["captura_id", ["estado"]]],
		registro: [["captura_participacion", ["participacion"]], ["captura_conducta", ["conducta"]]],
		calificacion: [["captura_semaforo", ["estado_entrega", "nivel"]], ["captura_puntaje", ["puntaje"]],
			["captura_retroalimentacion", ["retroalimentacion"]]],
	};
	function familia(tipo) { return tipo === "registro_borrar" ? "registro" : tipo; }
	function columna(f) { return f === "estado" ? "asistencia_estado" : f; }
	// Las columnas de marca de un tipo, en el orden de MARCAS
	function columnasMarca(tipo) { return (MARCAS[familia(tipo)] || []).map(function (g) { return g[0]; }); }
	// La columna de marca del grupo de un campo
	function marcaDeCampo(tipo, f) {
		var g = (MARCAS[familia(tipo)] || []).find(function (x) { return x[1].indexOf(f) !== -1; });
		return g ? g[0] : null;
	}
	// Los grupos que tocan esos campos: [[columna de marca, [los campos del grupo que están en la lista]]]
	function gruposDe(tipo, campos) {
		return (MARCAS[familia(tipo)] || []).map(function (g) {
			return [g[0], g[1].filter(function (f) { return campos.indexOf(f) !== -1; })];
		}).filter(function (g) { return g[1].length; });
	}

	var MENSAJE_RED = /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|aborted|network/i;

	/*
		tipoDeFallo(error) → "red" | "sesion" | "rechazo"
		"rechazo" exige una respuesta del servidor que diga que no: sin respuesta, o una
		excepción que no se entiende, se trata como de red (se reintenta; nunca se descarta una
		captura por algo que no es un "no" de la base).
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

	// La base todavía no tiene las columnas de marca (se publicó el frontend antes que la migración)
	function faltaMarca(e) {
		if (!e) return false;
		var texto = String(e.message || "") + " " + String(e.details || "") + " " + String(e.hint || "");
		var code = String(e.code || "");
		return /captura_(id|participacion|conducta|semaforo|puntaje|retroalimentacion)/.test(texto) &&
			(code === "PGRST204" || code === "42703" || code === "PGRST100" || e.status === 400);
	}

	// Explicación para la maestra de por qué la base no aceptó una captura (en español; el
	// texto técnico y los códigos de la base solo van a la consola)
	function explicar(e) {
		var code = e && e.code ? String(e.code) : "";
		var status = e && e.status;
		if (code === "42501" || status === 403) return "la base no lo permitió (el alumno, el grupo o el producto ya no es de esta cuenta)";
		if (code === "23503") return "el alumno, la sesión o el producto ya no existe";
		if (code === "23505" || status === 409) return "ya había un registro de ese dato guardado desde otro dispositivo o pantalla; se conservó ese";
		if (code === "23514" || code === "22P02" || code === "22003" || code === "23502") return "un valor capturado no es válido";
		if (code === "P0001" && e.message) return e.message; // los triggers propios hablan en español
		return "la base no lo aceptó";
	}

	// La respuesta de supabase-js trae status y error: se vuelve un Error con ambos (para lanzarlo)
	function fallo(res) {
		var err = (res && res.error) || {};
		var e = new Error(err.message || "No se pudo guardar");
		e.status = res && typeof res.status === "number" ? res.status : (typeof err.status === "number" ? err.status : null);
		e.code = err.code || "";
		e.details = err.details || null;
		e.hint = err.hint || null;
		return e;
	}

	// Un id único generado en el aparato (la marca de cada captura)
	function nuevoId() {
		try {
			if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
		} catch (_) {}
		var b = new Array(16);
		try {
			if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
				var u = new Uint8Array(16);
				crypto.getRandomValues(u);
				for (var i = 0; i < 16; i++) b[i] = u[i];
			}
		} catch (_) {}
		for (var j = 0; j < 16; j++) if (typeof b[j] !== "number") b[j] = Math.floor(Math.random() * 256);
		b[6] = (b[6] & 0x0f) | 0x40;
		b[8] = (b[8] & 0x3f) | 0x80;
		var h = b.map(function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
		return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
	}

	// ── Valores ──────────────────────────────────────────────────────────────────
	function num(v) { return v === null || v === undefined || v === "" ? null : Number(v); }
	function txt(v) { return v === null || v === undefined || v === "" ? null : String(v); }
	function normal(f, v) { return f === "participacion" || f === "conducta" || f === "puntaje" ? num(v) : txt(v); }
	// Lo que la pantalla muestra cuando no hay fila (el cierre del día empieza en 1 y 1)
	function predeterminado(tipo, f) { return familia(tipo) === "registro" ? 1 : null; }
	function igual1(a, b) {
		var na = a === undefined ? null : a, nb = b === undefined ? null : b;
		return na === nb;
	}

	function valorDeFila(tipo, f) {
		if (!f) return null;
		var fam = familia(tipo);
		if (fam === "asistencia") return { estado: txt(f.asistencia_estado !== undefined ? f.asistencia_estado : f.estado) };
		if (fam === "registro") return { participacion: num(f.participacion), conducta: num(f.conducta) };
		if (fam === "calificacion") {
			return { estado_entrega: txt(f.estado_entrega), nivel: txt(f.nivel), puntaje: num(f.puntaje), retroalimentacion: txt(f.retroalimentacion) };
		}
		return null;
	}

	// Las marcas de una fila leída { columna: uuid | null }; una columna que no vino (lectura sin
	// marcas) no aparece: ese grupo se compara por contenido
	function marcasDeFila(tipo, f) {
		var m = {};
		if (!f) return m;
		columnasMarca(tipo).forEach(function (c) { if (f[c] !== undefined) m[c] = f[c]; });
		return m;
	}

	// Lo que la pantalla guarda como "versión que vio" de una fila leída: { marcas, valor } o null
	function baseDeFila(tipo, f) {
		if (!f) return null;
		return { marcas: marcasDeFila(tipo, f), valor: valorDeFila(tipo, f) };
	}

	function valorCampo(fuente, f) {
		if (!fuente) return undefined;
		if (f === "estado") return fuente.estado !== undefined ? fuente.estado : fuente.asistencia_estado;
		return fuente[f];
	}
	function fuenteDe(it) { return familia(it.tipo) === "calificacion" ? (it.datos && it.datos.fila) || {} : it.datos || {}; }

	// Formato de 3d48d1a (sin `v`): lo que la captura quería dejar, la fila completa
	function valorDeseadoLegado(it) {
		var d = it.datos || {};
		if (it.tipo === "registro_borrar") return null;
		if (it.tipo === "calificacion") return valorDeFila("calificacion", d.fila);
		return valorDeFila(it.tipo, d);
	}

	// Lo que la captura quiere dejar en la base (los campos que tocó; null = retirar la fila)
	function valorDeseado(it) {
		if (!it) return null;
		if (!it.v) return valorDeseadoLegado(it);
		if (it.borrar) return null;
		return Object.assign({}, it.campos || {});
	}

	function igual(a, b) {
		if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
		var ka = Object.keys(a), kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		return ka.every(function (k) { return a[k] === b[k]; });
	}

	function elegir(v, campos) {
		if (!v) return v;
		var o = {};
		campos.forEach(function (f) { o[f] = v[f] === undefined ? null : v[f]; });
		return o;
	}

	// El valor como lo lee la maestra (para los avisos); acepta valores parciales
	var ETIQ_ASISTENCIA = { presente: "Presente", ausente: "Falta", justificada: "Justificada" };
	var ETIQ_NIVEL = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };
	var ETIQ_ENTREGA = { entregado: "Entregó", incompleto: "Incompleta", no_entregado: "No entregó", justificado: "Justificada", no_aplica: "No aplica" };
	function describir(tipo, v) {
		var fam = familia(tipo);
		function g(k) { return v && v[k] !== undefined ? v[k] : null; }
		if (fam === "asistencia") return v && v.estado ? (ETIQ_ASISTENCIA[v.estado] || v.estado) : "sin asistencia registrada";
		if (fam === "registro") {
			if (!v) return "sin cierre del día";
			var pr = [];
			if ("participacion" in v) pr.push("participación " + (g("participacion") === null ? "-" : g("participacion")));
			if ("conducta" in v) pr.push("conducta " + (g("conducta") === null ? "-" : g("conducta")));
			return pr.length ? pr.join(", ") : "sin cierre del día";
		}
		if (fam === "calificacion") {
			if (!v) return "sin calificar";
			var partes = [];
			var nivel = g("nivel"), entrega = g("estado_entrega"), puntaje = g("puntaje"), retro = g("retroalimentacion");
			if (nivel) partes.push(ETIQ_NIVEL[nivel] || nivel);
			if (entrega && !(nivel && entrega === "entregado")) partes.push(ETIQ_ENTREGA[entrega] || entrega);
			if (puntaje !== null) partes.push("puntaje " + puntaje);
			if (retro) partes.push("retroalimentación “" + (retro.length > 60 ? retro.slice(0, 57) + "..." : retro) + "”");
			if (partes.length) return partes.join(", ");
			if ("puntaje" in v && Object.keys(v).length === 1) return "sin puntaje";
			if ("retroalimentacion" in v && Object.keys(v).length === 1) return "sin retroalimentación";
			return "sin calificar";
		}
		return "";
	}

	/*
		El aviso de un conflicto: el alumno, lo que quedó en la base y lo que no se aplicó, solo
		de los campos en conflicto. `r`: { valor (la fila en la base, completa o null),
		conflictos: [[campos]], aplicado }
	*/
	function textoConflicto(it, r) {
		var campos = [];
		(r.conflictos || []).forEach(function (g) { campos = campos.concat(g); });
		if (!it.v) campos = CAMPOS[familia(it.tipo)];
		var quedo = r.fila === false || r.valor === null || r.valor === undefined ? null : elegir(r.valor, campos);
		var tuya = it.borrar || it.tipo === "registro_borrar" ? null : elegir(valorDeseado(it), campos);
		return (it.descripcion || "Una captura") + ": se cambió desde otro dispositivo o pantalla (quedó: " +
			describir(it.tipo, quedo) + "). Se conservó eso; tu captura (" + describir(it.tipo, tuya) + ") no se aplicó." +
			(r.aplicado ? " Lo demás que capturaste sí se guardó." : "");
	}

	// ── Capturas ─────────────────────────────────────────────────────────────────
	/*
		vistaDe(base) → { fila, marcas, valor }
		  null/undefined             → no había fila
		  { marcas, valor }          → la fila que vio la pantalla, con la marca de cada grupo (null =
		                               sin marca; una columna que no está = no se sabe)
		  { estado } / { nivel ... } → formato de 3d48d1a (solo contenido): marcas desconocidas
	*/
	function vistaDe(base) {
		if (base === null || base === undefined) return { fila: false, marcas: null, valor: null };
		if (typeof base === "object" && Object.prototype.hasOwnProperty.call(base, "valor")) {
			if (base.valor === null || base.valor === undefined) return { fila: false, marcas: null, valor: null };
			return { fila: true, marcas: base.marcas || {}, valor: base.valor };
		}
		return { fila: true, marcas: {}, valor: base };
	}

	// La versión que vio la pantalla de un campo: { fila, id (la marca de su grupo), valor }
	function vistoDeCampo(tipo, vista, f) {
		if (!vista.fila) return { fila: false, id: null, valor: predeterminado(tipo, f) };
		var m = vista.marcas ? vista.marcas[marcaDeCampo(tipo, f)] : undefined;
		return { fila: true, id: m === undefined ? undefined : m, valor: normal(f, vista.valor ? vista.valor[f] : null) };
	}

	function crearCaptura(tipo, maestroId, datos, descripcion, base, opciones) {
		opciones = opciones || {};
		var fam = familia(tipo);
		var it = {
			v: FORMATO, clave: clave(tipo, maestroId, datos), tipo: tipo, maestro_id: maestroId,
			seq: 0, capturado_en: new Date().toISOString(),
			datos: datos, descripcion: descripcion || "",
			captura_id: nuevoId(), campos: {}, vistos: {}, propiasValor: {}, intentado: false,
		};
		if (tipo === "registro" && opciones.relleno) it.relleno = true;
		if (tipo === "registro_borrar") it.borrar = true;
		var todos = CAMPOS[fam];
		var tocados = it.relleno ? [] : it.borrar ? todos
			: (opciones.campos || todos).filter(function (f) { return todos.indexOf(f) !== -1; });
		var fuente = fuenteDe(it);
		var vista = vistaDe(base);
		tocados.forEach(function (f) {
			it.campos[f] = it.borrar ? null : normal(f, valorCampo(fuente, f));
			it.vistos[f] = vistoDeCampo(tipo, vista, f);
		});
		return it;
	}

	/*
		Una captura de un formato anterior al formato 3:
		  - 2 (80a4375, sin publicar: una sola marca por fila): conserva sus campos; la marca vista
		    solo sigue valiendo en asistencias (misma columna); en lo demás, por contenido.
		  - sin `v` (3d48d1a, el publicado: la fila completa y `base` por contenido).
	*/
	function normalizar(it) {
		if (!it || it.v === FORMATO) return it;
		var fam = familia(it.tipo);
		var todos = CAMPOS[fam];
		if (it.v === 2) {
			var n2 = Object.assign({}, it, { v: FORMATO, vistos: {} });
			Object.keys(it.vistos || {}).forEach(function (f) {
				var x = it.vistos[f] || {};
				n2.vistos[f] = { fila: !!x.fila, id: !x.fila ? null : fam === "asistencia" ? x.id : undefined, valor: x.valor };
			});
			return n2;
		}
		var n = Object.assign({}, it, { v: FORMATO, legado: true, captura_id: it.captura_id || null, campos: {}, vistos: {}, propiasValor: {} });
		n.borrar = it.tipo === "registro_borrar";
		var deseado = n.borrar ? null : valorDeseadoLegado(it) || {};
		var vista = vistaDe(it.base === undefined ? null : it.base); // sin `base`: "no existía"
		todos.forEach(function (f) {
			n.campos[f] = n.borrar ? null : (deseado[f] === undefined ? null : deseado[f]);
			n.vistos[f] = vistoDeCampo(it.tipo, vista, f);
		});
		// Lo que ese aparato ya pudo haber escrito (formato anterior, por contenido)
		(it.propias || []).forEach(function (v) {
			if (!v) return;
			todos.forEach(function (f) { (n.propiasValor[f] = n.propiasValor[f] || []).push(v[f] === undefined ? null : v[f]); });
		});
		delete n.base;
		delete n.propias;
		return n;
	}

	// Los valores de los campos que una captura pendiente deja (para pintarla encima de la base)
	function valoresPendientes(it) {
		var n = normalizar(it);
		if (!n) return {};
		if (n.relleno) return valoresInsert(n);
		return Object.assign({}, n.campos);
	}

	/*
		Una captura nueva de una llave que ya tenía una pendiente: hereda sus campos y la versión
		que vio de cada uno (la pantalla aún no sabe qué quedó en la base). `enVuelo(p)`: esa
		captura ya se está enviando. → la captura a guardar, o null si no cambia nada.
	*/
	function combinar(prev, it, enVuelo) {
		if (!prev || prev.maestro_id !== it.maestro_id) return it;
		var p = normalizar(prev);
		if (it.relleno) return null;   // ya hay algo de ese alumno: el relleno no agrega nada
		if (p.relleno) return it;      // la maestra tocó a quien solo tenía el relleno
		var n = Object.assign({}, it, { campos: {}, vistos: {}, propiasValor: {} });
		var fam = familia(it.tipo);
		if (it.borrar) {
			n.campos = Object.assign({}, it.campos);
			n.vistos = Object.assign({}, it.vistos);
		} else if (p.borrar) {
			// Se retiró el cierre y después se tocó: queda la fila que ve la pantalla completa
			var fuente = fuenteDe(it);
			CAMPOS[fam].forEach(function (f) {
				n.campos[f] = f in it.campos ? it.campos[f] : normal(f, valorCampo(fuente, f));
				n.vistos[f] = it.vistos[f] || p.vistos[f];
			});
		} else {
			n.campos = Object.assign({}, p.campos, it.campos);
			n.vistos = Object.assign({}, p.vistos, it.vistos);
		}
		Object.keys(p.propiasValor || {}).forEach(function (f) { n.propiasValor[f] = (p.propiasValor[f] || []).slice(-10); });
		if (p.intentado || (enVuelo && enVuelo(p))) {
			Object.keys(p.campos || {}).forEach(function (f) { (n.propiasValor[f] = n.propiasValor[f] || []).push(p.campos[f]); });
		}
		if (p.legado) n.legado = true;
		return n;
	}

	/*
		La marca propia que se anota al encolar (ANTES de enviar, en la misma transacción que la
		captura): su número de captura, los grupos que tocó la maestra y, de cada uno, la marca
		sobre la que se capturó (su padre). Un insert pone la marca también en los grupos que no
		tocó (con su valor por defecto): esos no cuentan como tocados.
	*/
	function entradaDe(it) {
		var tocados = Object.keys(it.campos || {});
		var padres = {};
		gruposDe(it.tipo, tocados).forEach(function (g) {
			var v = it.vistos && it.vistos[g[1][0]];
			if (v && v.fila && v.id) padres[g[0]] = v.id;
		});
		return {
			id: it.captura_id, seq: it.seq, valores: Object.assign({}, it.campos),
			grupos: it.relleno ? [] : gruposDe(it.tipo, tocados).map(function (g) { return g[0]; }),
			padres: padres, borrado: !!it.borrar, relleno: !!it.relleno, confirmada: false,
		};
	}
	function podar(marcas) {
		return marcas.slice().sort(function (a, b) { return a.seq - b.seq; }).slice(-MAX_MARCAS);
	}

	/*
		Privacidad al cerrar sesión (limpiarPropias). Las marcas propias guardan lo que se capturó
		(valores, incluida la retroalimentación) y solo sirven para decidir los conflictos de las
		capturas que AÚN no llegan a la base. Una captura nueva siempre sale de una lectura
		nueva de la base (su "vistos"), así que las marcas de lo ya confirmado no le hacen falta.
		Lo que sí necesita la regla, mientras haya capturas pendientes de esa cuenta:
		  - todas las marcas de la llave de cada captura pendiente (la cadena propia: su número de
		    captura, sus grupos y sus padres; se conservan COMPLETAS, sin separar por marca);
		  - para el relleno del cierre, las de la asistencia de ese alumno y ese día
		    (faltoEnEsteAparato: "no se pone 1 y 1 a quien este aparato marcó con falta").
		llavesNecesarias(pendientes, maestroId) → { llave: true } con esas llaves.
	*/
	function llavesNecesarias(pendientes, maestroId) {
		var salida = {};
		(pendientes || []).forEach(function (it) {
			if (!it || (maestroId && it.maestro_id !== maestroId)) return;
			if (it.clave) salida[it.clave] = true;
			var d = it.datos || {};
			if (it.relleno && d.grupo_id && d.alumno_id && d.fecha) {
				salida[clave("asistencia", maestroId, { grupo_id: d.grupo_id, alumno_id: d.alumno_id, fecha: d.fecha })] = true;
			}
		});
		return salida;
	}
	// ¿Se borra esta fila del almacén "propias"? Solo las de esa cuenta que ya no necesita la regla
	function propiaSobra(r, maestroId, necesarias) {
		return !!r && r.maestro_id === maestroId && !necesarias[r.clave];
	}

	// ── Decidir grupo por grupo ──────────────────────────────────────────────────
	// Lo propio frente a esta captura: "superado" si es de una captura más nueva; si no, "propio"
	function frente(it, m) { return m.seq > it.seq ? "superado" : "propio"; }

	/*
		estadoGrupo(it, col, campos, R, marcas, conMarca) → "igual" | "visto" | "propio" | "superado" | "ajeno"
		  col: la columna de marca del grupo; campos: los campos del grupo que tocó la captura;
		  R: la fila ahora ({ fila, marcas, valor }); marcas: las propias de la llave (almacén "propias").
	*/
	function estadoGrupo(it, col, campos, R, marcas, conMarca) {
		// Ya tiene exactamente lo capturado: listo (reenviar, o dos aparatos pusieron lo mismo)
		if (!it.borrar && R.fila && campos.every(function (f) { return igual1(R.valor[f], it.campos[f]); })) return "igual";
		var v = it.vistos[campos[0]] || { fila: false, id: null, valor: predeterminado(it.tipo, campos[0]) };
		if (!R.fila) {
			if (!v.fila) return "visto";
			// La vio y ya no está: ¿la quitó este aparato? (su última marca propia confirmada es un retiro)
			var ultima = null;
			marcas.forEach(function (m) { if (m.confirmada && !m.relleno && (!ultima || m.seq > ultima.seq)) ultima = m; });
			return ultima && ultima.borrado ? frente(it, ultima) : "ajeno";
		}
		var mR = conMarca && R.marcas ? R.marcas[col] : undefined;
		if (conMarca && mR !== undefined && campos.every(function (f) { return (it.vistos[f] || {}).id !== undefined; })) {
			if (v.fila && mR === v.id) return "visto"; // la misma versión que vio (con marca, o sin marca)
			// Nadie ha escrito el grupo desde que se creó la fila (marca inicial, valor por defecto):
			// para la pantalla que no veía la fila es lo que ella mostraba
			if (!v.fila && mR === MARCA_INICIAL &&
				campos.every(function (f) { return igual1(R.valor[f], predeterminado(it.tipo, f)); })) return "visto";
			if (mR) {
				var propia = marcas.find(function (m) { return m.id === mR; });
				if (propia) {
					if (propia.id === it.captura_id) return "igual"; // ya se aplicó (se perdió la respuesta)
					// Un insert propio que no tocó este grupo nunca le gana a una captura
					if (propia.grupos && propia.grupos.indexOf(col) === -1) return "propio";
					return frente(it, propia);
				}
				// Una marca ajena que este aparato ya vio: otra ventana capturó sobre ella
				var vio = marcas.filter(function (m) { return m.id !== it.captura_id && m.padres && m.padres[col] === mR; });
				if (vio.length) return vio.some(function (m) { return m.seq > it.seq; }) ? "superado" : "propio";
			}
			// Otro aparato u otra pantalla la cambió después de lo que vio la pantalla (aunque el valor coincida)
			return "ajeno";
		}
		// Sin marca que comparar (base sin las columnas, o captura de un formato anterior): por contenido
		var est = campos.map(function (f) {
			var vf = it.vistos[f] || v;
			if (igual1(R.valor[f], vf.fila ? vf.valor : predeterminado(it.tipo, f))) return "visto";
			if ((it.propiasValor && it.propiasValor[f] || []).some(function (x) { return igual1(x, R.valor[f]); })) return "propio";
			return "ajeno";
		});
		return est.indexOf("ajeno") !== -1 ? "ajeno" : est.indexOf("propio") !== -1 ? "propio" : "visto";
	}

	// → { escribir: [campos], conflictos: [[campos]], superados: [[campos]] }
	function decidir(it, R, marcas, conMarca) {
		var escribir = [], conflictos = [], superados = [];
		gruposDe(it.tipo, Object.keys(it.campos || {})).forEach(function (g) {
			var est = estadoGrupo(it, g[0], g[1], R, marcas, conMarca);
			if (est === "superado") superados.push(g[1]);
			else if (est === "ajeno") conflictos.push(g[1]);
			else if (est !== "igual") escribir = escribir.concat(g[1]);
		});
		// Retirar el cierre es todo o nada
		if (it.borrar && (conflictos.length || superados.length)) escribir = [];
		return { escribir: escribir, conflictos: conflictos, superados: superados };
	}

	// ── Escrituras condicionales ─────────────────────────────────────────────────
	function filtrar(q, pares) {
		pares.forEach(function (p) { q = p[1] === null || p[1] === undefined ? q.is(p[0], null) : q.eq(p[0], p[1]); });
		return q;
	}

	function valoresInsert(it) {
		var fam = familia(it.tipo), fuente = fuenteDe(it), v = {};
		CAMPOS[fam].forEach(function (f) {
			if (it.campos && Object.prototype.hasOwnProperty.call(it.campos, f)) v[f] = it.campos[f];
			else {
				var x = valorCampo(fuente, f);
				v[f] = x === undefined ? predeterminado(it.tipo, f) : normal(f, x);
			}
		});
		return v;
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
		},
		registro: {
			tabla: "registro_diario", columnas: "participacion, conducta", conflicto: "maestro_id,alumno_id,fecha",
			llave: function (it) { return [["maestro_id", it.maestro_id], ["alumno_id", it.datos.alumno_id], ["fecha", it.datos.fecha]]; },
			nueva: function (it, v) {
				return { maestro_id: it.maestro_id, alumno_id: it.datos.alumno_id, fecha: it.datos.fecha, participacion: v.participacion, conducta: v.conducta };
			},
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
			// captura, solo informativo: la regla de concurrencia no depende de relojes
			nueva: function (it, v) {
				return Object.assign({ fecha: it.datos.fecha }, it.datos.fila, {
					estado_entrega: v.estado_entrega, nivel: v.nivel, puntaje: v.puntaje, retroalimentacion: v.retroalimentacion,
					entrego: v.estado_entrega === "entregado" || v.estado_entrega === "incompleto",
					maestro_id: it.maestro_id, evaluado_en: it.capturado_en,
				});
			},
		},
	};

	// Solo los campos que se escriben (una ventana vieja no pisa los demás) y, con marcas, la de
	// esta captura en cada grupo escrito
	function cambiosDe(it, campos, conMarca) {
		var c = {};
		campos.forEach(function (f) { c[columna(f)] = it.campos[f]; });
		if (familia(it.tipo) === "calificacion") {
			if (campos.indexOf("estado_entrega") !== -1) c.entrego = it.campos.estado_entrega === "entregado" || it.campos.estado_entrega === "incompleto";
			c.evaluado_en = it.capturado_en;
		}
		if (conMarca) gruposDe(it.tipo, campos).forEach(function (g) { c[g[0]] = it.captura_id; });
		return c;
	}

	function columnasDe(op, tipo, conMarca) { return op.columnas + (conMarca ? ", " + columnasMarca(tipo).join(", ") : ""); }

	// La fila de la base, ahora → { fila, marcas, valor, rowId }
	async function leerActual(sb, it, conMarca) {
		var op = OPS[familia(it.tipo)];
		var res = await filtrar(sb.from(op.tabla).select(columnasDe(op, it.tipo, conMarca)), op.llave(it)).maybeSingle();
		if (res.error) throw fallo(res);
		var f = res.data;
		return {
			fila: !!f, marcas: f && conMarca ? marcasDeFila(it.tipo, f) : {},
			valor: valorDeFila(it.tipo, f), rowId: f && f.id ? f.id : null,
		};
	}

	/*
		"La fila sigue como la vi", grupo por grupo de los campos que se escriben: por su marca
		(estado.marcas[columna]) o, sin marca, por el contenido. Marca null = fila sin marca (de
		antes de la migración: is null y, además, el contenido); undefined = no se sabe: contenido.
	*/
	function condicion(q, estado, tipo, campos, contenido, conMarca) {
		var porContenido = [];
		gruposDe(tipo, campos).forEach(function (g) {
			var id = conMarca && estado.marcas ? estado.marcas[g[0]] : undefined;
			if (id) { q = q.eq(g[0], id); return; }
			if (id === null) q = q.is(g[0], null);
			porContenido = porContenido.concat(g[1]);
		});
		porContenido.forEach(function (f) {
			var v = contenido ? contenido[f] : null;
			if (f === "retroalimentacion" && v && v.length > RETRO_MAX_FILTRO) return; // se compara leyendo
			q = v === null || v === undefined ? q.is(columna(f), null) : q.eq(columna(f), v);
		});
		return q;
	}

	function retroLargaEnCondicion(estado, tipo, campos, contenido, conMarca) {
		if (campos.indexOf("retroalimentacion") === -1) return false;
		if (conMarca && estado.marcas && estado.marcas[marcaDeCampo(tipo, "retroalimentacion")]) return false;
		return !!(contenido && contenido.retroalimentacion && contenido.retroalimentacion.length > RETRO_MAX_FILTRO);
	}

	/*
		Un insert de Hoy lleva su marca (propia) en los grupos que tocó la maestra; en los que no tocó
		y quedan con su valor por defecto, la marca inicial (el relleno: en los dos). Un grupo no
		tocado con otro valor lleva la marca propia.
	*/
	function conMarcas(it, fila) {
		var tocados = it.relleno ? [] : Object.keys(it.campos || {});
		(MARCAS[familia(it.tipo)] || []).forEach(function (g) {
			var tocado = g[1].some(function (f) { return tocados.indexOf(f) !== -1; });
			var porDefecto = g[1].every(function (f) { return igual1(normal(f, fila[columna(f)]), predeterminado(it.tipo, f)); });
			fila[g[0]] = !tocado && porDefecto ? MARCA_INICIAL : it.captura_id;
		});
		return fila;
	}

	// Una captura que esperó en la cola (sin red, reintento) no es una recién hecha en línea
	function esperoEnCola(it) {
		return !!(it.enCola || it.intentado || Date.now() - Date.parse(it.capturado_en) > RECIENTE_MS);
	}

	/*
		escribir(sb, it, estado, campos, contenido, conMarca) → { ok, fila, valor, marcas, rowId }
		Un solo statement: la base lo resuelve de forma atómica. ok=false: la condición no se cumplió.
		estado.fila=false: insert que no pisa (con todos los campos). estado.marcas: la marca de
		cada grupo que debe seguir en la fila.
	*/
	async function escribir(sb, it, estado, campos, contenido, conMarca) {
		var op = OPS[familia(it.tipo)];
		var cols = columnasDe(op, it.tipo, conMarca);
		var res;
		if (it.borrar && !estado.fila) return { ok: false }; // no había fila que retirar: se lee
		if (!estado.fila) {
			var fila = op.nueva(it, valoresInsert(it));
			if (conMarca) conMarcas(it, fila);
			if (op.conflicto) {
				res = await sb.from(op.tabla).upsert(fila, { onConflict: op.conflicto, ignoreDuplicates: true }).select(cols);
			} else {
				// Una captura que esperó en la cola pudo encontrarse con una fila creada en otro lado:
				// se mira antes, para no provocar un 409 en la consola
				if (esperoEnCola(it) && (await leerActual(sb, it, conMarca)).fila) return { ok: false };
				res = await sb.from(op.tabla).insert(fila).select(cols);
				if (res.error && String(res.error.code || "") === "23505") return { ok: false };
			}
		} else if (it.borrar) {
			res = await condicion(filtrar(sb.from(op.tabla).delete(), op.llave(it)), estado, it.tipo, CAMPOS.registro, contenido, conMarca).select("id");
			if (res.error) throw fallo(res);
			return res.data && res.data.length ? { ok: true, fila: false, valor: null, marcas: {}, rowId: null } : { ok: false };
		} else {
			if (retroLargaEnCondicion(estado, it.tipo, campos, contenido, conMarca)) {
				var a = await leerActual(sb, it, conMarca);
				if (!a.fila || !igual1(a.valor.retroalimentacion, contenido.retroalimentacion)) return { ok: false };
			}
			res = await condicion(filtrar(sb.from(op.tabla).update(cambiosDe(it, campos, conMarca)), op.llave(it)),
				estado, it.tipo, campos, contenido, conMarca).select(cols);
		}
		if (res.error) throw fallo(res);
		var filas = res.data ? [].concat(res.data) : [];
		if (!filas.length) return { ok: false };
		var f = filas[0];
		return { ok: true, fila: true, valor: valorDeFila(it.tipo, f), marcas: conMarca ? marcasDeFila(it.tipo, f) : {}, rowId: f.id || null };
	}

	/*
		Todos los campos tocados se vieron con fila (o todos sin fila) y los de un mismo grupo en la
		misma versión → { fila, marcas: { columna: marca vista } }; si no, null (se lee y se decide)
	*/
	function vistaComun(it) {
		var campos = Object.keys(it.campos || {});
		if (!campos.length) return null;
		var v0 = it.vistos[campos[0]];
		if (!v0) return null;
		var marcas = {};
		var bien = gruposDe(it.tipo, campos).every(function (g) {
			var a = it.vistos[g[1][0]];
			if (!a || a.fila !== v0.fila) return false;
			for (var i = 1; i < g[1].length; i++) {
				var b = it.vistos[g[1][i]];
				if (!b || b.fila !== a.fila || b.id !== a.id) return false;
			}
			if (a.id !== undefined) marcas[g[0]] = a.id;
			return true;
		});
		return bien ? { fila: v0.fila, marcas: marcas } : null;
	}

	/*
		enviar(sb, it, ctx) → { aplicado, fila, valor, marcas, rowId, conflictos? }
		ctx: { conMarca, marcas: () → Promise<[marcas propias de la llave]>, revisarFalta }
		  revisarFalta: el relleno de alguien que este aparato marcó con falta (en otra ventana): si
		  la base lo confirma, no se inserta; solo se lee la fila para que la pantalla sepa qué hay.
		Lanza el error de la base (red, sesión o rechazo).
	*/
	async function enviar(sb, it, ctx) {
		var conMarca = !!ctx.conMarca;
		var todos = CAMPOS[familia(it.tipo)];
		var soloLeer = !!(it.relleno && ctx.revisarFalta && (await faltaEnLaBase(sb, it)));
		function resultado(r, extra) {
			return Object.assign({ fila: r.fila, valor: r.valor, marcas: r.marcas || {}, rowId: r.rowId || null }, extra || {});
		}

		// 1. Directo, sin leer (el caso normal: un aparato, una ventana, en línea)
		if (it.relleno) {
			if (!it.intentado && !soloLeer) {
				var r0 = await escribir(sb, it, { fila: false }, [], null, conMarca);
				if (r0.ok) return resultado(r0, { aplicado: true });
			}
		} else {
			var comun = vistaComun(it);
			if (comun) {
				var tocados = it.borrar ? todos : Object.keys(it.campos);
				var contenido = {};
				tocados.forEach(function (f) { contenido[f] = it.vistos[f] ? it.vistos[f].valor : null; });
				var r1 = await escribir(sb, it, comun, tocados, contenido, conMarca);
				if (r1.ok) return resultado(r1, { aplicado: true });
			}
		}

		// 2. Se lee la fila y se decide grupo por grupo
		for (var i = 0; i < MAX_INTENTOS_CAS; i++) {
			var R = await leerActual(sb, it, conMarca);
			if (it.relleno) {
				// Solo inserta donde no hay fila; si ya hay, la pantalla se entera de su versión
				if (R.fila || soloLeer) return resultado(R, { aplicado: false });
				var ri = await escribir(sb, it, { fila: false }, [], null, conMarca);
				if (ri.ok) return resultado(ri, { aplicado: true });
				continue;
			}
			if (it.borrar && !R.fila) return resultado({ fila: false, valor: null }, { aplicado: false });
			// Las marcas propias se consultan siempre: una respuesta perdida de esta misma captura se
			// reconoce por su marca (el grupo queda "igual") y no se escribe dos veces
			var marcas = conMarca && ctx.marcas ? await ctx.marcas() : [];
			var d = decidir(it, R, marcas, conMarca);
			if (!d.escribir.length) return resultado(R, { aplicado: false, conflictos: d.conflictos });
			var rw = await escribir(sb, it, { fila: R.fila, marcas: conMarca ? R.marcas : {} }, d.escribir, R.valor || {}, conMarca);
			if (rw.ok) return resultado(rw, { aplicado: true, conflictos: d.conflictos });
			// La fila cambió entre la lectura y la escritura: se vuelve a leer
		}
		// La fila cambió varias veces mientras se intentaba: se reintenta más tarde
		var e = new Error("La fila cambió mientras se guardaba");
		e.status = 0;
		throw e;
	}

	/*
		El relleno del cierre (1 y 1 a quien aún no tiene fila): un solo insert que no pisa para
		todos, con sus marcas propias, y pide las filas de vuelta (la pantalla conoce su versión).
		Los que no se insertaron (ya había fila) se resuelven uno por uno (solo leen).
		→ [{ aplicado, fila, valor, marcas } | { pendiente: true }] en el orden del lote.
	*/
	async function enviarLoteRelleno(sb, lote, conMarca) {
		var op = OPS.registro;
		var filas = lote.map(function (it) {
			var f = op.nueva(it, valoresInsert(it));
			return conMarca ? conMarcas(it, f) : f;
		});
		var res = await sb.from(op.tabla).upsert(filas, { onConflict: op.conflicto, ignoreDuplicates: true })
			.select("alumno_id, fecha, participacion, conducta" + (conMarca ? ", " + columnasMarca("registro").join(", ") : ""));
		if (res.error) throw fallo(res);
		var puestas = {};
		(res.data || []).forEach(function (f) { puestas[f.alumno_id + "|" + f.fecha] = f; });
		return lote.map(function (it) {
			var f = puestas[it.datos.alumno_id + "|" + it.datos.fecha];
			return f ? { aplicado: true, fila: true, valor: valorDeFila("registro", f), marcas: conMarca ? marcasDeFila("registro", f) : {}, rowId: null }
				: { pendiente: true };
		});
	}

	// ¿La base tiene a ese alumno con falta ese día? (antes de poner su relleno 1 y 1)
	async function faltaEnLaBase(sb, it) {
		var d = it.datos || {};
		var res = await sb.from("asistencias").select("asistencia_estado").eq("maestro_id", it.maestro_id)
			.eq("grupo_id", d.grupo_id).eq("alumno_id", d.alumno_id).eq("fecha", d.fecha).maybeSingle();
		if (res.error) throw fallo(res);
		var e = res.data ? res.data.asistencia_estado : null;
		return e === "ausente" || e === "justificada";
	}

	// ── Almacenes ────────────────────────────────────────────────────────────────
	function copia(it) { return it ? JSON.parse(JSON.stringify(it)) : it; }

	// En memoria: sin IndexedDB, y en las pruebas (el mismo objeto = el mismo aparato)
	function almacenMemoria() {
		var mapa = {}, marcas = {}, contador = Date.now() * 1000;
		var a = {
			persistente: false,
			todos: function () { return Promise.resolve(Object.keys(mapa).map(function (k) { return copia(mapa[k]); })); },
			obtener: function (c) { return Promise.resolve(copia(mapa[c]) || null); },
			poner: function (it) {
				if (typeof it.seq === "number" && it.seq > contador) contador = it.seq;
				mapa[it.clave] = copia(it);
				return Promise.resolve();
			},
			quitarSi: function (c, seq) {
				if (mapa[c] && mapa[c].seq === seq) delete mapa[c];
				return Promise.resolve();
			},
			// Cambia la captura guardada solo si pasa la prueba (la misma `seq`, o una más nueva)
			cambiarSi: function (c, prueba, fn) {
				if (mapa[c] && prueba(mapa[c])) fn(mapa[c]);
				return Promise.resolve();
			},
			quitar: function (c) { delete mapa[c]; },
			/*
				encolar(it, combinarFn): en un solo paso, el siguiente número de captura, la captura
				guardada (combinada con la pendiente de la misma llave) y su marca anotada como propia.
				→ { guardada, sinCambio }
			*/
			encolar: function (it, combinarFn) {
				contador += 1;
				it.seq = contador;
				var prev = mapa[it.clave] ? copia(mapa[it.clave]) : null;
				var nuevo = combinarFn(prev, it);
				if (!nuevo) return Promise.resolve({ guardada: prev, sinCambio: true });
				mapa[it.clave] = copia(nuevo);
				if (!nuevo.relleno) a.anotarMarca(it.clave, nuevo.maestro_id, entradaDe(nuevo)); // el relleno lleva la marca inicial
				return Promise.resolve({ guardada: copia(nuevo) });
			},
			marcas: function (c, maestroId) {
				var r = marcas[c];
				return Promise.resolve(r && (!maestroId || r.maestro_id === maestroId) ? copia(r.marcas) : []);
			},
			anotarMarca: function (c, maestroId, entrada) {
				var r = marcas[c] = marcas[c] || { clave: c, maestro_id: maestroId, marcas: [] };
				r.marcas = podar(r.marcas.filter(function (m) { return m.id !== entrada.id; }).concat([copia(entrada)]));
				return Promise.resolve();
			},
			confirmarMarca: function (c, maestroId, id, cambios) {
				var r = marcas[c];
				var m = r && r.marcas.find(function (x) { return x.id === id; });
				if (m) Object.assign(m, copia(cambios));
				return Promise.resolve();
			},
			// Al cerrar sesión: borra las marcas propias de la cuenta que ya no necesita ninguna
			// captura pendiente (llavesNecesarias). → { borradas, conservadas }
			limpiarPropias: function (maestroId) {
				var necesarias = llavesNecesarias(Object.keys(mapa).map(function (k) { return mapa[k]; }), maestroId);
				var n = { borradas: 0, conservadas: 0 };
				Object.keys(marcas).forEach(function (c) {
					if (propiaSobra(marcas[c], maestroId, necesarias)) { delete marcas[c]; n.borradas++; }
					else if (marcas[c].maestro_id === maestroId) n.conservadas++;
				});
				return Promise.resolve(n);
			},
		};
		return a;
	}

	function abrirBD() {
		return new Promise(function (ok) {
			var hecho = false;
			function fin(v) { if (!hecho) { hecho = true; ok(v); } else if (v && v.close) { try { v.close(); } catch (_) {} } }
			setTimeout(function () { fin(null); }, 5000); // un navegador que nunca contesta
			function listo(db) {
				db.onversionchange = function () { try { db.close(); } catch (_) {} };
				fin(db);
			}
			function completa(db) {
				return db.objectStoreNames.contains(ALMACEN) && db.objectStoreNames.contains(PROPIAS) && db.objectStoreNames.contains(META);
			}
			try {
				if (typeof indexedDB === "undefined" || !indexedDB) { fin(null); return; }
				var req = indexedDB.open(NOMBRE_BD, VERSION_BD);
				req.onupgradeneeded = function () {
					// De la versión 1 (3d48d1a) a la 2: las capturas pendientes se quedan como están
					// (se convierten al enviarlas) y se agregan las marcas propias y el contador
					var db = req.result, tx = req.transaction;
					if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: "clave" });
					if (!db.objectStoreNames.contains(PROPIAS)) db.createObjectStore(PROPIAS, { keyPath: "clave" });
					if (!db.objectStoreNames.contains(META)) {
						var meta = db.createObjectStore(META, { keyPath: "clave" });
						// El contador arranca arriba de las capturas que ya había (el formato anterior
						// numeraba con el reloj); de aquí en adelante, solo suma
						var maximo = Date.now() * 1000;
						var cur = tx.objectStore(ALMACEN).openCursor();
						cur.onsuccess = function () {
							var c = cur.result;
							if (c) { if (typeof c.value.seq === "number" && c.value.seq >= maximo) maximo = c.value.seq + 1; c.continue(); }
							else meta.put({ clave: "seq", valor: maximo });
						};
					}
				};
				req.onerror = function (e) {
					if (e && e.preventDefault) e.preventDefault();
					// La base ya es de una versión más nueva (se regresó a esta): se abre la que hay
					var r2;
					try { r2 = indexedDB.open(NOMBRE_BD); } catch (_) { fin(null); return; }
					r2.onsuccess = function () { if (completa(r2.result)) listo(r2.result); else { try { r2.result.close(); } catch (_) {} fin(null); } };
					r2.onerror = function (e2) { if (e2 && e2.preventDefault) e2.preventDefault(); fin(null); };
				};
				// Una pestaña con la versión anterior tiene la base abierta: la suelta al enterarse
				// (onversionchange) y entonces sigue la actualización; si no, se vence el tiempo
				req.onblocked = function () {};
				req.onsuccess = function () {
					var db = req.result;
					if (completa(db)) { listo(db); return; }
					try { db.close(); } catch (_) {}
					fin(null);
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
		function txn(almacenes, modo, fn) {
			return new Promise(function (ok, mal) {
				try {
					var tx = db.transaction(almacenes, modo);
					var salida = { valor: undefined };
					fn(tx, salida);
					tx.oncomplete = function () { ok(salida.valor); };
					tx.onerror = function () { mal(tx.error || new Error("IndexedDB")); };
					tx.onabort = function () { mal(tx.error || new Error("IndexedDB")); };
				} catch (e) {
					mal(e);
				}
			});
		}
		function sinDisco(e) {
			a.persistente = false;
			if (typeof console !== "undefined") console.warn("bandeja: no se pudo guardar en el dispositivo; queda en memoria", e);
		}
		a.todos = function () {
			return txn([ALMACEN], "readonly", function (tx, s) {
				var g = tx.objectStore(ALMACEN).getAll();
				g.onsuccess = function () { s.valor = g.result; };
			}).catch(function () { return []; }).then(function (lista) {
				var por = {};
				(lista || []).forEach(function (it) { por[it.clave] = it; });
				return mem.todos().then(function (enMem) {
					enMem.forEach(function (it) { if (!por[it.clave] || por[it.clave].seq < it.seq) por[it.clave] = it; });
					return Object.keys(por).map(function (k) { return por[k]; });
				});
			});
		};
		a.obtener = function (c) {
			return txn([ALMACEN], "readonly", function (tx, s) {
				var g = tx.objectStore(ALMACEN).get(c);
				g.onsuccess = function () { s.valor = g.result; };
			}).catch(function () { return null; }).then(function (enBD) {
				return mem.obtener(c).then(function (enMem) {
					if (enMem && (!enBD || enBD.seq < enMem.seq)) return enMem;
					return enBD || null;
				});
			});
		};
		a.poner = function (it) {
			return txn([ALMACEN], "readwrite", function (tx) { tx.objectStore(ALMACEN).put(it); }).then(function () {
				mem.quitar(it.clave);
			}, function (e) {
				sinDisco(e);
				return mem.poner(it);
			});
		};
		a.quitarSi = function (c, seq) {
			return mem.quitarSi(c, seq).then(function () {
				return txn([ALMACEN], "readwrite", function (tx) {
					var s = tx.objectStore(ALMACEN);
					var g = s.get(c);
					g.onsuccess = function () { if (g.result && g.result.seq === seq) s.delete(c); };
				}).catch(function () {});
			});
		};
		a.cambiarSi = function (c, prueba, fn) {
			return mem.cambiarSi(c, prueba, fn).then(function () {
				return txn([ALMACEN], "readwrite", function (tx) {
					var s = tx.objectStore(ALMACEN);
					var g = s.get(c);
					g.onsuccess = function () { if (g.result && prueba(g.result)) { fn(g.result); s.put(g.result); } };
				}).catch(function () {});
			});
		};
		// Todo en una transacción: dos ventanas que encolan a la vez no se pisan
		a.encolar = function (it, combinarFn) {
			return txn([ALMACEN, PROPIAS, META], "readwrite", function (tx, salida) {
				var sPend = tx.objectStore(ALMACEN), sProp = tx.objectStore(PROPIAS), sMeta = tx.objectStore(META);
				var gm = sMeta.get("seq");
				gm.onsuccess = function () {
					var n = (gm.result && typeof gm.result.valor === "number" ? gm.result.valor : Date.now() * 1000) + 1;
					sMeta.put({ clave: "seq", valor: n });
					it.seq = n;
					var gp = sPend.get(it.clave);
					gp.onsuccess = function () {
						var nuevo = combinarFn(gp.result || null, it);
						if (!nuevo) { salida.valor = { guardada: gp.result || null, sinCambio: true }; return; }
						sPend.put(nuevo);
						salida.valor = { guardada: nuevo };
						if (nuevo.relleno) return; // el relleno lleva la marca inicial: no es propia
						var gr = sProp.get(it.clave);
						gr.onsuccess = function () {
							var r = gr.result || { clave: it.clave, maestro_id: nuevo.maestro_id, marcas: [] };
							r.marcas = podar(r.marcas.filter(function (m) { return m.id !== nuevo.captura_id; }).concat([entradaDe(nuevo)]));
							sProp.put(r);
						};
					};
				};
			}).then(function (r) {
				mem.quitar(it.clave);
				return r;
			}, function (e) {
				sinDisco(e);
				return mem.encolar(it, combinarFn);
			});
		};
		a.marcas = function (c, maestroId) {
			return txn([PROPIAS], "readonly", function (tx, s) {
				var g = tx.objectStore(PROPIAS).get(c);
				g.onsuccess = function () { s.valor = g.result; };
			}).catch(function () { return null; }).then(function (r) {
				return mem.marcas(c, maestroId).then(function (enMem) {
					var lista = r && (!maestroId || r.maestro_id === maestroId) ? r.marcas : [];
					return lista.concat(enMem);
				});
			});
		};
		a.anotarMarca = function (c, maestroId, entrada) {
			return txn([PROPIAS], "readwrite", function (tx) {
				var s = tx.objectStore(PROPIAS);
				var g = s.get(c);
				g.onsuccess = function () {
					var r = g.result || { clave: c, maestro_id: maestroId, marcas: [] };
					r.marcas = podar(r.marcas.filter(function (m) { return m.id !== entrada.id; }).concat([entrada]));
					s.put(r);
				};
			}).catch(function () { return mem.anotarMarca(c, maestroId, entrada); });
		};
		a.confirmarMarca = function (c, maestroId, id, cambios) {
			return mem.confirmarMarca(c, maestroId, id, cambios).then(function () {
				return txn([PROPIAS], "readwrite", function (tx) {
					var s = tx.objectStore(PROPIAS);
					var g = s.get(c);
					g.onsuccess = function () {
						var r = g.result;
						var m = r && r.marcas.find(function (x) { return x.id === id; });
						if (!m) return;
						Object.assign(m, cambios);
						s.put(r);
					};
				}).catch(function () {});
			});
		};
		/*
			Poda por cantidad de llaves (no por reloj): se quedan las MAX_LLAVES con la marca más
			reciente. Olvidar las marcas de una llave vieja solo hace que esa llave se compare por
			contenido; nunca pierde una captura.
		*/
		/*
			Al cerrar sesión: en UNA transacción sobre "pendientes" y "propias" (una ventana que
			encola a la vez no se cruza: encolar escribe las dos en su propia transacción), se leen
			las capturas pendientes y se borran las marcas propias de la cuenta que ya no necesita
			ninguna (llavesNecesarias). → { borradas, conservadas }
		*/
		a.limpiarPropias = function (maestroId) {
			return mem.limpiarPropias(maestroId).then(function () {
				return txn([ALMACEN, PROPIAS], "readwrite", function (tx, salida) {
					var n = { borradas: 0, conservadas: 0 };
					salida.valor = n;
					var gp = tx.objectStore(ALMACEN).getAll();
					gp.onsuccess = function () {
						var necesarias = llavesNecesarias(gp.result || [], maestroId);
						var cur = tx.objectStore(PROPIAS).openCursor();
						cur.onsuccess = function () {
							var c = cur.result;
							if (!c) return;
							if (propiaSobra(c.value, maestroId, necesarias)) { c.delete(); n.borradas++; }
							else if (c.value && c.value.maestro_id === maestroId) n.conservadas++;
							c.continue();
						};
					};
				});
			});
		};
		a.podarLlaves = function () {
			return txn([PROPIAS], "readwrite", function (tx) {
				var s = tx.objectStore(PROPIAS);
				var c = s.count();
				c.onsuccess = function () {
					if (c.result <= MAX_LLAVES) return;
					var g = s.getAll();
					g.onsuccess = function () {
						var ultimas = (g.result || []).map(function (r) {
							return { clave: r.clave, seq: (r.marcas || []).reduce(function (m, x) { return Math.max(m, x.seq || 0); }, 0) };
						}).sort(function (x, y) { return y.seq - x.seq; });
						ultimas.slice(MAX_LLAVES).forEach(function (r) { s.delete(r.clave); });
					};
				};
			}).catch(function () {});
		};
		return a;
	}

	function abrirAlmacen() {
		return abrirBD().then(function (db) {
			if (!db) return almacenMemoria();
			var a = almacenIDB(db);
			a.podarLlaves();
			return a;
		});
	}

	// ── La bandeja ───────────────────────────────────────────────────────────────
	var FALLAS = ["red", "servidor", "sesion", "cuenta"];

	// La promesa, o un error "sin señal" si tarda más de ms (la marca hace inofensivo que llegue tarde)
	function conLimite(promesa, ms) {
		return new Promise(function (ok, mal) {
			var t = setTimeout(function () {
				var e = new Error("La red no contestó a tiempo");
				e.status = 0;
				mal(e);
			}, ms);
			promesa.then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); mal(e); });
		});
	}

	/*
		crear(o)
		  o.sb          cliente de Supabase (window.sb)
		  o.auth        auth para leer y refrescar la sesión (Lectura.authDirecto: sin detener la página)
		  o.maestroId   la cuenta con sesión (la dueña de lo que se capture aquí)
		  o.almacen     (pruebas) un almacén ya abierto; si no, IndexedDB o memoria
		  o.alCambiar({ pendientes, estado: "ok"|"enviando"|"red"|"servidor"|"sesion"|"cuenta", persistente })
		  o.alGuardar(captura, { valor, id, fila, base, sigue })    se confirmó
		  o.alConflicto(captura, { actual, texto, sigue, base })   otro aparato lo cambió: se conservó lo de la base
		  o.alRechazar(captura, explicacion, { actual?, sigue, base? })    la base no la aceptó: ya salió de la cola
		     `actual`: lo que hay en la base (undefined si no se pudo leer); `base`: { marcas, valor }
		     o null (la nueva versión que vio la pantalla); `sigue`: hay una captura más nueva de la
		     misma llave en la cola (la pantalla sigue mostrando esa)
		  o.alSaber(mensaje)   otra ventana de este aparato confirmó algo o avisó de un conflicto:
		     { tipo: "guardada"|"aviso", clave, tipoCaptura, datos, base, valor, id, sigue, texto? }
		  o.esperaMax   tope de la espera entre reintentos (ms; 30 s)
		  o.canal       (pruebas) un canal para avisar a otras ventanas; false = ninguno
		  o.cerrojo     false = sin Web Locks (pruebas)
	*/
	function crear(o) {
		var st = {
			almacen: null, habilitada: false, procesando: false, otraVez: false, enCiclo: false,
			espera: null, intentos: 0, estado: "ok", n: 0, claves: {}, unoPorUno: false,
			esperandoVacia: [], esperandoEnvio: [], cadena: Promise.resolve(), enVuelo: {},
			huboFalla: false, // la cola se atoró (red, servidor, sesión) desde la última vez que se vació
		};
		var listo = (o.almacen ? Promise.resolve(o.almacen) : abrirAlmacen()).then(function (a) { st.almacen = a; return a; });
		var esperaMax = o.esperaMax || 30000;

		// ── Otras ventanas de este aparato ──
		var canal = null;
		try {
			if (o.canal) canal = o.canal;
			else if (o.canal !== false && typeof window !== "undefined" && window.BroadcastChannel) canal = new window.BroadcastChannel(CANAL);
		} catch (_) { canal = null; }
		function difundir(m) {
			if (!canal) return;
			try { canal.postMessage(Object.assign({ maestro_id: o.maestroId }, m)); } catch (_) {}
		}
		function alMensaje(ev) {
			var m = ev && ev.data;
			if (!m || m.maestro_id !== o.maestroId) return;
			if (m.tipo === "cambio") {
				// La cola cambió en otra ventana: se vuelve a contar y, si hay algo, se intenta enviar
				listo.then(propios).then(function (l) {
					avisar();
					if (l.length && !st.procesando && st.habilitada) procesar();
				});
			} else if (m.tipo === "estado") {
				if (!st.enCiclo && FALLAS.concat(["ok", "enviando"]).indexOf(m.estado) !== -1) {
					st.estado = m.estado;
					listo.then(propios).then(avisar);
				}
			} else if ((m.tipo === "guardada" || m.tipo === "aviso") && o.alSaber) {
				try { o.alSaber(m); } catch (_) {}
			}
		}
		if (canal) {
			if (typeof canal.addEventListener === "function") canal.addEventListener("message", alMensaje);
			else canal.onmessage = alMensaje;
		}

		function avisar() {
			if (o.alCambiar) {
				try {
					o.alCambiar({ pendientes: st.n, estado: st.estado, persistente: !!(st.almacen && st.almacen.persistente) });
				} catch (_) {}
			}
			if (st.enCiclo && st.estado !== st.estadoDifundido) {
				st.estadoDifundido = st.estado;
				difundir({ tipo: "estado", estado: st.estado });
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
				st.claves = {};
				mias.forEach(function (it) { st.claves[it.clave] = true; });
				return mias;
			});
		}

		/*
			agregar(tipo, datos, descripcion, base, opciones)
			`base`: lo que la pantalla sabe de la base para esa llave ({ marcas, valor } o null).
			`opciones.campos`: los campos que tocó la maestra (si no, todos); `opciones.relleno`: el
			1 y 1 del Cierre del día (solo inserta donde no hay fila).
		*/
		function agregar(tipo, datos, descripcion, base, opciones) {
			var it = crearCaptura(tipo, o.maestroId, datos, descripcion, base, opciones);
			// En serie: dos toques seguidos de la misma llave no se pisan la herencia
			var hecho = st.cadena.then(function () { return listo; })
				.then(function () {
					return st.almacen.encolar(it, function (prev, nuevo) {
						return combinar(prev, nuevo, function (p) { return st.enVuelo[p.clave] === p.seq; });
					});
				});
			st.cadena = hecho.catch(function () {});
			return hecho.then(function (r) { return propios().then(function () { return r; }); })
				.then(function (r) {
					if (!r || !r.sinCambio) difundir({ tipo: "cambio" });
					avisar();
					procesar();
					return r && r.guardada ? r.guardada : it;
				});
		}

		function programar(ms) {
			if (st.espera) return;
			var t = ms || Math.min(esperaMax, 1000 * Math.pow(2, Math.max(0, st.intentos - 1)));
			st.espera = setTimeout(function () { st.espera = null; procesar(); }, t);
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

		// La nueva versión que vio la pantalla: { marcas, valor } o null (no hay fila)
		function baseDe(r) {
			return r.fila ? { marcas: r.marcas || {}, valor: r.valor } : null;
		}

		async function terminar(it, r) {
			await st.almacen.quitarSi(it.clave, it.seq);
			// Confirmada: se aplicó (o, un retiro, la fila ya no está); la usa la regla del retiro propio
			if (!it.relleno && (r.aplicado || (it.borrar && !r.fila))) {
				await st.almacen.confirmarMarca(it.clave, it.maestro_id, it.captura_id, { confirmada: true });
			}
			var sigue = await hayMasNueva(it);
			var base = baseDe(r);
			var msg = { clave: it.clave, tipoCaptura: it.tipo, datos: it.datos, base: base, valor: r.valor, id: r.rowId || null, sigue: sigue };
			if (r.conflictos && r.conflictos.length) {
				var texto = textoConflicto(it, r);
				if (typeof console !== "undefined") console.warn("bandeja: conflicto, se conservó lo de la base", it.descripcion);
				if (o.alConflicto) { try { o.alConflicto(it, { actual: r.fila ? r.valor : null, sigue: sigue, texto: texto, base: base, id: r.rowId || null }); } catch (_) {} }
				difundir(Object.assign({ tipo: "aviso", texto: texto }, msg));
				return;
			}
			if (o.alGuardar) { try { o.alGuardar(it, { valor: r.fila ? r.valor : null, id: r.rowId || null, fila: !!r.fila, base: base, sigue: sigue }); } catch (_) {} }
			difundir(Object.assign({ tipo: "guardada" }, msg));
		}

		// Una sola ventana del aparato envía a la vez (si el navegador tiene Web Locks)
		function conCerrojo(fn) {
			var locks = null;
			try {
				if (o.cerrojo !== false && typeof window !== "undefined" && typeof navigator !== "undefined" &&
					navigator.locks && typeof navigator.locks.request === "function") locks = navigator.locks;
			} catch (_) {}
			if (!locks) return fn(true);
			var llamado = false;
			return locks.request("jissez-bandeja-" + o.maestroId, { ifAvailable: true }, function (l) { llamado = true; return fn(!!l); })
				.catch(function (e) {
					if (llamado) throw e; // falló el envío, no el cerrojo
					return fn(true);      // el navegador no dio el cerrojo: se envía sin él
				});
		}

		function ctxDe(it, conMarca, revisarFalta) {
			return { conMarca: conMarca, revisarFalta: !!revisarFalta, marcas: function () { return st.almacen.marcas(it.clave, o.maestroId); } };
		}

		// Envía con las marcas; si la base no tiene las columnas, con la regla anterior (por contenido)
		async function enviarUno(it, revisarFalta) {
			var conMarca = marca.disponible !== false;
			try {
				return await conLimite(enviar(o.sb, it, ctxDe(it, conMarca, revisarFalta)), o.limiteMs || LIMITE_ENVIO);
			} catch (e) {
				if (conMarca && faltaMarca(e)) {
					marca.disponible = false;
					if (typeof console !== "undefined") console.warn("bandeja: la base aún no tiene las columnas de marca; se compara por contenido");
					return await conLimite(enviar(o.sb, it, ctxDe(it, false, revisarFalta)), o.limiteMs || LIMITE_ENVIO);
				}
				throw e;
			}
		}

		/*
			El relleno 1 y 1 no se pone a quien ESTE aparato marcó con falta (aunque haya sido en otra
			ventana que esta no conoce): si la última captura propia de su asistencia de ese día es una
			falta, el relleno se envía solo y se confirma con la base antes de insertar (faltaEnLaBase;
			una falta vieja que ya se corrigió en otra pantalla no lo impide). Sin grupo en los datos
			(una captura de antes) no se puede saber: se inserta como siempre.
		*/
		async function faltoEnEsteAparato(it) {
			var d = it.datos || {};
			if (!it.relleno || !d.grupo_id) return false;
			var lista = await st.almacen.marcas(clave("asistencia", o.maestroId, { grupo_id: d.grupo_id, alumno_id: d.alumno_id, fecha: d.fecha }), o.maestroId);
			var ultima = null;
			lista.forEach(function (m) { if (m.valores && m.valores.estado !== undefined && (!ultima || m.seq > ultima.seq)) ultima = m; });
			return !!(ultima && (ultima.valores.estado === "ausente" || ultima.valores.estado === "justificada"));
		}

		async function enviarLote(lote) {
			var conMarca = marca.disponible !== false;
			try {
				return await conLimite(enviarLoteRelleno(o.sb, lote, conMarca), o.limiteMs || LIMITE_ENVIO);
			} catch (e) {
				if (conMarca && faltaMarca(e)) {
					marca.disponible = false;
					return await conLimite(enviarLoteRelleno(o.sb, lote, false), o.limiteMs || LIMITE_ENVIO);
				}
				throw e;
			}
		}

		// La captura como está guardada ahora; una del formato anterior se convierte (con su marca)
		async function actual(x) {
			var g = await st.almacen.obtener(x.clave);
			if (!g || g.maestro_id !== o.maestroId) return null;
			if (g.v === FORMATO) return g;
			var n = normalizar(g);
			// La de 80a4375 conserva su marca (pudo haberse enviado ya); la de 3d48d1a no tenía
			n.captura_id = g.v === 2 && g.captura_id ? g.captura_id : nuevoId();
			await st.almacen.cambiarSi(g.clave, function (y) { return y.seq === g.seq && y.v !== FORMATO; }, function (y) {
				Object.keys(y).forEach(function (k) { delete y[k]; });
				Object.assign(y, n);
			});
			var otra = await st.almacen.obtener(g.clave);
			if (!otra || otra.seq !== g.seq) return otra && otra.v === FORMATO ? otra : null;
			if (otra.captura_id === n.captura_id) await st.almacen.anotarMarca(g.clave, o.maestroId, entradaDe(otra));
			return otra.v === FORMATO ? otra : n;
		}

		async function procesar() {
			await listo;
			if (!st.habilitada) return;
			if (st.procesando) { st.otraVez = true; return; }
			st.procesando = true;
			if (st.espera) { clearTimeout(st.espera); st.espera = null; }
			var envio = false;
			try {
				await conCerrojo(async function (tengo) {
					if (!tengo) {
						// Otra ventana de este aparato está enviando: avisará al terminar
						await propios();
						programar(3000);
						return;
					}
					st.enCiclo = true;
					try { envio = await ciclo(); } finally { st.enCiclo = false; st.estadoDifundido = null; }
				});
			} finally {
				st.procesando = false;
				avisar();
				if (envio) difundir({ tipo: "cambio" });
				if (st.otraVez) {
					st.otraVez = false;
					if (FALLAS.indexOf(st.estado) === -1 || (st.estado !== "sesion" && st.estado !== "cuenta" && !st.espera)) procesar();
				}
			}
		}

		// Envía lo pendiente de la cuenta, en serie. → true si algo cambió en la cola
		async function ciclo() {
			var sesionIntentada = false;
			var algo = false;
			// Sin la dueña de la cola no se envía ni se decide nada
			async function duenaPresente() {
				var c = await cuentaDuena();
				if (c === "ok") return true;
				st.huboFalla = true;
				if (c === "red") { st.intentos++; st.estado = "red"; programar(); }
				else st.estado = c;
				return false;
			}
			for (;;) {
				var lista = await propios();
				if (!lista.length) { st.estado = "ok"; st.intentos = 0; st.unoPorUno = false; st.huboFalla = false; break; }
				if (!(await duenaPresente())) break;
				if (st.estado === "ok") { st.estado = "enviando"; avisar(); }
				// Lo que se envía es lo que está guardado AHORA (un toque que llegó mientras tanto ya se combinó)
				var it = await actual(lista[0]);
				if (!it) continue;
				var lote = [it];
				// El relleno de quien este aparato marcó con falta va solo: se confirma con la base
				var revisarFalta = await faltoEnEsteAparato(it);
				if (it.relleno && !revisarFalta && !st.unoPorUno) {
					var otros = [];
					for (var k = 1; k < lista.length && otros.length < 99; k++) {
						if (lista[k].v === FORMATO && lista[k].relleno && !(await faltoEnEsteAparato(lista[k]))) otros.push(lista[k]);
					}
					lote = lote.concat(otros);
				}
				for (var j = 0; j < lote.length; j++) {
					var x = lote[j];
					x.enCola = st.huboFalla; // esperó en la cola: ver escribir
					st.enVuelo[x.clave] = x.seq;
					if (!x.intentado) {
						await st.almacen.cambiarSi(x.clave, (function (seq) { return function (y) { return y.seq === seq; }; })(x.seq),
							function (y) { y.intentado = true; });
					}
				}
				try {
					var rs = lote.length > 1 ? await enviarLote(lote) : [await enviarUno(it, revisarFalta)];
					// Antes de dar algo por terminado: ¿sigue siendo la sesión de la dueña?
					if (!(await duenaPresente())) break;
					for (var i = 0; i < lote.length; i++) {
						if (rs[i].pendiente) { st.unoPorUno = true; lote[i].intentado = true; continue; } // ya había fila: de uno en uno
						await terminar(lote[i], rs[i]);
						algo = true;
					}
					await propios();
					avisar(); // el aviso cuenta lo que falta mientras se envía
					st.intentos = 0;
					st.estado = "enviando";
				} catch (e) {
					var tipo = tipoDeFallo(e);
					if (tipo === "rechazo") {
						if (lote.length > 1) { st.unoPorUno = true; continue; } // ¿cuál fue? de uno en uno
						// Un "no" con la sesión de otra cuenta no es de la captura: se espera a su dueña
						if (!(await duenaPresente())) break;
						await st.almacen.quitarSi(it.clave, it.seq);
						algo = true;
						if (typeof console !== "undefined") console.warn("bandeja: la base rechazó una captura", it.descripcion, e);
						var leida;
						try { leida = await leerActual(o.sb, it, marca.disponible !== false); } catch (_) { leida = undefined; }
						var sigue = await hayMasNueva(it);
						var base = leida ? (leida.fila ? { marcas: leida.marcas, valor: leida.valor } : null) : undefined;
						var explicacion = explicar(e);
						if (o.alRechazar) {
							try { o.alRechazar(it, explicacion, { actual: leida ? leida.valor : undefined, sigue: sigue, base: base }); } catch (_) {}
						}
						difundir({ tipo: "aviso", clave: it.clave, tipoCaptura: it.tipo, datos: it.datos, base: base, valor: leida ? leida.valor : undefined,
							sigue: sigue, texto: (it.descripcion || "Una captura") + ": " + explicacion + "." });
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
					lote.forEach(function (y) { if (st.enVuelo[y.clave] === y.seq) delete st.enVuelo[y.clave]; });
				}
			}
			return algo;
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
			// ¿Hay una captura pendiente de esa llave? (según la última cuenta de la cola)
			pendienteDe: function (c) { return !!st.claves[c]; },
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
			cerrar: function () { try { if (canal && canal.close && !o.canal) canal.close(); } catch (_) {} },
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
		en este dispositivo y abra Mi Salón. → true: se puede cerrar la sesión.
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
			" cuando vuelvas a entrar en él y abras Mi Salón.\n\n¿Cerrar sesión de todos modos?");
	}

	/*
		Privacidad en el aparato al cerrar sesión (js/navbar.js, después de confirmarSalida): se
		borran del almacén "propias" las marcas de ESA cuenta que ya no necesita ninguna captura
		pendiente (llavesNecesarias). Sin pendientes se borran todas; con pendientes se conservan
		completas las de sus llaves (y la asistencia del día para un relleno del cierre), para que
		la regla de conflictos siga igual cuando se envíen. No crea la base si no existe, nunca
		toca las capturas pendientes ni lo de otra cuenta, y no detiene el cierre de sesión: si el
		navegador no contesta en LIMITE_LIMPIEZA, se sigue sin limpiar.
		→ Promise<{ borradas, conservadas } | null>
	*/
	var LIMITE_LIMPIEZA = 3000;
	async function limpiarAlSalir(sb) {
		var id = cuentaGuardada();
		if (!id && sb && sb.auth && sb.auth.getSession) {
			try {
				var r = await sb.auth.getSession();
				id = r && r.data && r.data.session ? r.data.session.user.id : null;
			} catch (_) {}
		}
		if (!id) return null;
		return new Promise(function (ok) {
			var hecho = false;
			function fin(v) { if (!hecho) { hecho = true; ok(v); } }
			setTimeout(function () { fin(null); }, LIMITE_LIMPIEZA);
			try {
				if (typeof indexedDB === "undefined" || !indexedDB) { fin(null); return; }
				var req = indexedDB.open(NOMBRE_BD);
				// No existía: no se crea (no había nada que limpiar)
				req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (_) {} };
				req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fin(null); };
				req.onsuccess = function () {
					var db = req.result;
					if (!db.objectStoreNames.contains(ALMACEN) || !db.objectStoreNames.contains(PROPIAS)) { try { db.close(); } catch (_) {} fin(null); return; }
					almacenIDB(db).limpiarPropias(id).then(function (n) {
						try { db.close(); } catch (_) {}
						fin(n);
					}, function (e) {
						try { db.close(); } catch (_) {}
						if (typeof console !== "undefined") console.warn("bandeja: no se pudieron limpiar las marcas propias", e);
						fin(null);
					});
				};
			} catch (_) { fin(null); }
		});
	}

	// ── Fuera de Hoy: lo pendiente se dice y se envía ────────────────────────────
	var ESTILO_BOTON = "display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1rem;" +
		"border-radius:.75rem;font-weight:600;font-size:.875rem;text-decoration:none;cursor:pointer;box-sizing:border-box;";

	/*
		Dónde va el aviso: DENTRO del flujo de la página (arriba del contenido), nunca encima de
		los controles. El primer contenedor visible que no es fijo (main, o el de la página).
	*/
	function lugarDelAviso() {
		var main = document.querySelector("main");
		if (main) return main;
		var hijos = document.body ? document.body.children : [];
		for (var i = 0; i < hijos.length; i++) {
			var h = hijos[i];
			if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|NAV|HEADER|FOOTER)$/.test(h.tagName) || h.id === "app-navbar") continue;
			var cs = window.getComputedStyle ? window.getComputedStyle(h) : null;
			if (cs && (cs.position === "fixed" || cs.position === "sticky" || cs.position === "absolute" || cs.display === "none")) continue;
			if (h.getBoundingClientRect && h.getBoundingClientRect().height === 0) continue;
			return h;
		}
		return document.body;
	}

	function avisoFuera() {
		var caja = document.createElement("div");
		caja.id = "bandejaAvisoFuera";
		caja.setAttribute("role", "status");
		caja.setAttribute("aria-live", "polite");
		caja.setAttribute("style", "display:none;box-sizing:border-box;width:100%;max-width:56rem;margin:0 auto 1rem;background:#fff;" +
			"border:1px solid #bfdbfe;border-radius:1rem;padding:.75rem 1rem;font-size:.875rem;line-height:1.45;color:#1e293b;");
		var texto = document.createElement("p");
		texto.setAttribute("style", "margin:0");
		var lista = document.createElement("ul");
		lista.setAttribute("style", "margin:.5rem 0 0;padding-left:1.25rem;display:none");
		var acciones = document.createElement("div");
		acciones.setAttribute("style", "display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem");
		var ir = document.createElement("a");
		ir.href = "hoy.html";
		ir.textContent = "Ir a Hoy";
		ir.setAttribute("style", ESTILO_BOTON + "background:#1e3a8a;color:#fff;border:0");
		var ocultar = document.createElement("button");
		ocultar.type = "button";
		ocultar.textContent = "Ocultar";
		ocultar.setAttribute("style", ESTILO_BOTON + "background:#fff;color:#1e3a8a;border:1px solid #bfdbfe");
		acciones.appendChild(ir);
		acciones.appendChild(ocultar);
		caja.appendChild(texto);
		caja.appendChild(lista);
		caja.appendChild(acciones);

		// En el flujo: si la página vuelve a dibujar su contenedor, el aviso regresa a su lugar
		function colocar() {
			var lugar = lugarDelAviso();
			if (!lugar) return;
			if (caja.parentNode !== lugar || lugar.firstChild !== caja) lugar.insertBefore(caja, lugar.firstChild);
		}
		colocar();
		try {
			if (typeof MutationObserver === "function") {
				new MutationObserver(function () { if (!caja.isConnected && !oculto) colocar(); })
					.observe(document.body, { childList: true, subtree: true });
			}
		} catch (_) {}

		var problemas = []; // [{ clave, texto }]: un renglón por dato
		var ultimo = { pendientes: 0 };
		var oculto = false;
		var ocultarEn = null;
		function mostrar(t, alerta) {
			if (ocultarEn) { clearTimeout(ocultarEn); ocultarEn = null; }
			texto.textContent = t;
			caja.setAttribute("role", alerta ? "alert" : "status");
			caja.style.borderColor = alerta ? "#fecaca" : "#bfdbfe";
			lista.textContent = "";
			problemas.forEach(function (p) {
				var li = document.createElement("li");
				li.textContent = p.texto;
				lista.appendChild(li);
			});
			lista.style.display = problemas.length ? "block" : "none";
			if (oculto) return;
			colocar();
			caja.style.display = "block";
		}
		function pintar() {
			var n = ultimo.pendientes;
			if (n) {
				var cuantas = n === 1 ? "Tienes 1 captura de Hoy sin enviar." : "Tienes " + n + " capturas de Hoy sin enviar.";
				var detalle = ultimo.estado === "red" ? " Sin señal: están guardadas en este dispositivo y se enviarán solas al volver la señal."
					: ultimo.estado === "servidor" ? " El servidor no respondió bien; se reintentará."
					: ultimo.estado === "sesion" ? " Tu sesión se cerró: vuelve a iniciar sesión para enviarlas."
					: ultimo.estado === "cuenta" ? " Son de otra cuenta: se enviarán cuando ella entre en este dispositivo."
					: " Enviando...";
				mostrar(cuantas + detalle + (problemas.length ? " Estas no se aplicaron:" : ""), problemas.length > 0);
				return;
			}
			if (problemas.length) {
				mostrar("Se enviaron las capturas de Hoy que faltaban, salvo estas (se conservó lo que había en la base):", true);
				return;
			}
			mostrar("Se enviaron las capturas de Hoy que faltaban.", false);
			ocultarEn = setTimeout(function () { caja.style.display = "none"; }, 4000);
		}
		ocultar.addEventListener("click", function () {
			oculto = true;
			problemas = [];
			caja.style.display = "none";
		});
		return {
			estado: function (e) { ultimo = e; pintar(); },
			problema: function (clave, t) {
				oculto = false; // algo que no se aplicó siempre se muestra
				problemas = problemas.filter(function (p) { return p.clave !== clave; }).concat([{ clave: clave, texto: t }]);
				pintar();
			},
		};
	}

	function vigilarFuera() {
		try {
			if (!window.sb || typeof window.sb.from !== "function" || typeof indexedDB === "undefined" || !indexedDB || !document.body) return;
			if (document.querySelector('script[src$="/hoy.js"], script[src="js/hoy.js"], script[src="hoy.js"]')) return; // Hoy tiene su propia bandeja
		} catch (_) {
			return;
		}
		var id = cuentaGuardada();
		if (!id) return;
		contarDe(id).then(function (n) {
			if (!n) return;
			var aviso = avisoFuera();
			var b = crear({
				sb: window.sb,
				// El auth sin envolver: una falla de red al comprobar la sesión no detiene la página
				auth: window.Lectura && window.Lectura.authDirecto ? window.Lectura.authDirecto : window.sb.auth,
				maestroId: id,
				alCambiar: aviso.estado,
				alConflicto: function (it, r) { aviso.problema(it.clave, r.texto); },
				alRechazar: function (it, explicacion) { aviso.problema(it.clave, (it.descripcion || "Una captura") + ": " + explicacion + "."); },
			});
			window.addEventListener("online", function () { b.procesar(); });
			document.addEventListener("visibilitychange", function () {
				if (document.visibilityState === "visible") b.procesar();
			});
			b.iniciar();
		}).catch(function (e) {
			if (typeof console !== "undefined") console.warn("bandeja: no se pudo revisar lo pendiente", e);
		});
	}

	if (typeof window !== "undefined" && typeof document !== "undefined" && window.addEventListener && typeof document.querySelector === "function") {
		window.addEventListener("load", function () { setTimeout(vigilarFuera, 1200); });
	}

	return {
		clave: clave,
		CAMPOS: CAMPOS,
		tipoDeFallo: tipoDeFallo,
		explicar: explicar,
		faltaMarca: faltaMarca,
		valorDeFila: valorDeFila,
		baseDeFila: baseDeFila,
		valorDeseado: valorDeseado,
		valoresPendientes: valoresPendientes,
		normalizar: normalizar,
		igual: igual,
		describir: describir,
		nuevoId: nuevoId,
		MARCAS: MARCAS,
		// Las columnas de marca de un tipo (para leerlas con cada fila)
		columnasMarca: columnasMarca,
		// La pantalla que leyó la base dice si existen las columnas de marca (true/false)
		marcaDisponible: function (v) { if (v === true || v === false) marca.disponible = v; return marca.disponible; },
		almacenMemoria: almacenMemoria,
		abrirAlmacen: abrirAlmacen,
		crear: crear,
		cuentaGuardada: cuentaGuardada,
		contarDe: contarDe,
		confirmarSalida: confirmarSalida,
		llavesNecesarias: llavesNecesarias,
		limpiarAlSalir: limpiarAlSalir,
		vigilarFuera: vigilarFuera,
	};
})();
if (typeof window !== "undefined") window.BandejaSalida = BandejaSalida;
if (typeof module !== "undefined" && module.exports) module.exports = BandejaSalida; // pruebas en node
