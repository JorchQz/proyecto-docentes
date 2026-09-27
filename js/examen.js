/*
	examen.js — "Exámenes" de Mi Salón (decisiones de Jorge, 2026-09-26).

	Los exámenes del catálogo se venden en la tienda y ya NO son parte de Mi Salón: esta pantalla
	no los lista ni los aplica (sus datos se conservan; lo que una maestra ya había aplicado se
	abre en js/examen-anterior.js y el motor lo sigue leyendo).

	La maestra elige, por examen, uno de dos caminos (supabase/mi_salon_b18_examenes_2026-09.sql):
	  1. "Solo subir resultados": por campo formativo, cuántas preguntas tenía y cuántos aciertos
	     sacó cada alumno. Sirve con cualquier examen (propio, de la tienda o revisado a mano).
	     Captura rápida en tabla: alumnos por campos, un número por celda, validado (aciertos ≤
	     preguntas). Aquí mismo.
	  2. "Crear mi examen": preguntas de opción múltiple (sugerida), verdadero o falso, completar y
	     abierta; imprimir el examen y la hoja de respuestas; revisar con la cámara, tocando o a
	     mano (js/examen-propio.js y js/examen-camara.js).
	Los dos alimentan el rubro "examen" del motor por campo formativo (js/motor-calificacion.js);
	la conversión porcentaje → calificación sigue solo en SQL.

	Lista: los exámenes del grupo activo con su estado (sin aplicar, en revisión, calificado).

	Sin señal (decisión de Jorge del 2026-09-26; supabase/mi_salon_b19_examenes_cola_2026-09.sql):
	las CAPTURAS de un examen (la letra tocada o escaneada, la calificación a mano, los aciertos de
	cada campo y "No presentó") van por la MISMA cola de Hoy (js/bandeja-salida.js, tipos
	examen_respuesta, examen_resultado y examen_alumno): se guardan primero en la tablet (IndexedDB,
	por cuenta), se ven de inmediato y se envían solas al volver la señal, también después de
	recargar o de cerrar la página (la envía Exámenes, Hoy o cualquier página de Mi Salón). No pisan
	lo que otro aparato capturó: marca por fila (captura_id) con la misma regla de Hoy; si otro
	aparato lo cambió, se conserva lo suyo y se avisa aquí. Crear o editar el examen y sus
	preguntas sí necesita señal (se avisa y no se pierde lo escrito en el diálogo).

	"No presentó" (por alumno y examen): no cuenta ni a favor ni en contra y deja cerrar el examen
	como "Calificado". Si después lo presenta, se captura normal: capturar algo suyo quita la marca.
*/
document.addEventListener("DOMContentLoaded", function () {
	if (!window.sb) return;
	if (new URLSearchParams(window.location.search).get("examen_id")) {
		// Examen del modelo anterior (catálogo ya aplicado)
		document.getElementById("exPantalla").hidden = true;
		window.Lectura.arrancar(window.ExamenAnterior.iniciar);
		return;
	}
	window.Lectura.arrancar(iniciarExamenes);
});

async function iniciarExamenes() {
	"use strict";
	var X = window.ExamenModelo;
	var sb = window.sb;
	var el = {
		subtitulo: document.getElementById("exSubtitulo"),
		mensaje: document.getElementById("exMensaje"),
		vista: document.getElementById("exVista"),
		dlgExamen: document.getElementById("exDlgExamen"),
		dlgConfirmar: document.getElementById("exDlgConfirmar"),
	};

	var ses = await sb.auth.getSession();
	if (ses.error || !ses.data.session) { window.location.href = "index.html"; return; }
	var userId = ses.data.session.user.id;
	var grupo = (await window.GrupoActivo.cargar(sb, userId)).grupo;
	if (!grupo) {
		el.subtitulo.textContent = "Sin grupo";
		el.vista.innerHTML = vacio("Primero crea tu grupo.", "Los exámenes son de un grupo y de sus alumnos.");
		return;
	}
	var gradosGrupo = (grupo.grados || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; }).sort();

	// ── Estado ──────────────────────────────────────────────────────────────────
	var examenes = [], anteriores = [], alumnos = [];
	var datos = { preguntas: [], respuestas: [], resultados: [], alumnosExamen: [] };
	var perfil = {};
	var enBase = {}; // llave de la cola → lo que la pantalla sabe de la base ({ marcas, valor } o null)
	var bandeja = null; // la cola sin señal (js/bandeja-salida.js)
	var avisosCola = []; // lo que no se aplicó (otro aparato lo cambió, o la base no lo aceptó)

	// ── Utilidades ──────────────────────────────────────────────────────────────
	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function vacio(texto, sub) {
		return '<div class="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">' +
			'<p class="text-gray-600 text-base font-medium">' + esc(texto) + '</p>' +
			(sub ? '<p class="text-gray-400 text-sm mt-1">' + esc(sub) + '</p>' : '') +
			'<a href="dashboard.html" class="inline-flex items-center justify-center min-h-[44px] px-3 mt-4 text-blue-600 underline text-sm font-medium">Volver a Inicio</a>' +
			'</div>';
	}
	var ICONOS = {
		mas: '<path d="M5 12h14"/><path d="M12 5v14"/>',
		atras: '<path d="m15 18-6-6 6-6"/>',
		lapiz: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
		basura: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
		tabla: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
		hoja: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
		copiar: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
		alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	};
	function icono(n, cls) {
		return '<svg xmlns="http://www.w3.org/2000/svg" class="' + (cls || "h-5 w-5") + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONOS[n] || "") + '</svg>';
	}
	var BTN = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold";
	var BTN_PRI = BTN + " bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60";
	var BTN_SEC = BTN + " bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60";
	var BTN_PELIGRO = BTN + " bg-white border border-red-200 text-red-700 hover:bg-red-50";

	function mensaje(tipo, texto) {
		if (!texto) { el.mensaje.className = "hidden"; el.mensaje.textContent = ""; return; }
		var c = tipo === "error" ? "bg-red-50 border-red-200 text-red-800" : (tipo === "aviso" ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-emerald-50 border-emerald-200 text-emerald-800");
		el.mensaje.className = "rounded-xl border px-4 py-3 text-sm font-medium " + c;
		el.mensaje.textContent = texto;
	}

	function textoGrados(gs) {
		var l = (gs || []).map(Number).sort().map(function (g) { return g + "°"; });
		if (l.length <= 1) return l.join("");
		return l.slice(0, -1).join(", ") + " y " + l[l.length - 1];
	}
	var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
	function textoFecha(iso) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
		return m ? Number(m[3]) + " de " + MESES[Number(m[2]) - 1] + " de " + m[1] : "";
	}
	function hoyISO() { return window.CalendarioEscolar ? window.CalendarioEscolar.fechaLocalISO() : new Date().toISOString().slice(0, 10); }

	function esDeRed(e) {
		var t = String((e && (e.message || e.details)) || e || "");
		return !navigator.onLine || /Failed to fetch|NetworkError|network|Load failed|fetch/i.test(t) || (e && (e.status === 0 || e.code === "" || e.name === "TypeError"));
	}
	function textoError(e) {
		if (esDeRed(e)) return "Sin señal: no se guardó. Lo capturado sigue en pantalla; se vuelve a intentar al tener señal.";
		var t = String((e && e.message) || "");
		if (/aciertos_rango|between 0 and preguntas/i.test(t)) return "Los aciertos no pueden pasar de las preguntas.";
		if (/row-level security|42501|permission/i.test(t)) return "No se pudo guardar: ese dato no es de tu grupo.";
		return "No se pudo guardar: " + (t || "error desconocido") + ".";
	}

	// Una escritura: { ok, error, red }
	async function escribir(consulta) {
		try {
			var r = await consulta;
			if (r && r.error) return { ok: false, error: r.error, red: esDeRed(r.error) };
			return { ok: true, data: r ? r.data : null };
		} catch (e) {
			return { ok: false, error: e, red: true };
		}
	}

	// ── La cola sin señal (js/bandeja-salida.js; mi_salon_b19) ───────────────────
	var B = window.BandejaSalida;
	function claveCola(tipo, d) { return B.clave(tipo, userId, d); }
	function baseCola(tipo, d) { var v = enBase[claveCola(tipo, d)]; return v === undefined ? null : v; }
	function ponerBase(tipo, fila, d) { enBase[claveCola(tipo, d || fila)] = fila ? B.baseDeFila(tipo, fila) : null; }
	function hayPendientes() { return !!(bandeja && bandeja.pendientes()); }

	// Lo que la pantalla tiene de una llave (para aplicar lo que dice la base)
	function filaLocal(tipo, d) {
		var fam = tipo.replace(/_borrar$/, "");
		var lista = fam === "examen_respuesta" ? datos.respuestas : fam === "examen_resultado" ? datos.resultados : datos.alumnosExamen;
		for (var i = 0; i < lista.length; i++) {
			var r = lista[i];
			if (fam === "examen_respuesta" && r.alumno_id === d.alumno_id && r.pregunta_id === d.pregunta_id) return r;
			if (fam === "examen_resultado" && r.examen_id === d.examen_id && r.alumno_id === d.alumno_id && r.campo === d.campo) return r;
			if (fam === "examen_alumno" && r.examen_id === d.examen_id && r.alumno_id === d.alumno_id) return r;
		}
		return null;
	}
	/*
		ponerLocal(tipo, d, v): deja en pantalla el valor v de esa llave ({ respuesta, resultado,
		origen } · { aciertos, preguntas } · { no_presento }; null = sin fila).
	*/
	function ponerLocal(tipo, d, v) {
		var fam = tipo.replace(/_borrar$/, "");
		var prop = fam === "examen_respuesta" ? "respuestas" : fam === "examen_resultado" ? "resultados" : "alumnosExamen";
		var actual = filaLocal(fam, d);
		datos[prop] = datos[prop].filter(function (r) { return r !== actual; });
		if (!v) return;
		var fila = { examen_id: d.examen_id, alumno_id: d.alumno_id };
		if (fam === "examen_respuesta") { fila.pregunta_id = d.pregunta_id; fila.respuesta = v.respuesta === undefined ? null : v.respuesta; fila.resultado = v.resultado || null; fila.origen = v.origen || "toque"; }
		else if (fam === "examen_resultado") { fila.campo = d.campo; fila.aciertos = v.aciertos; fila.preguntas = v.preguntas; }
		else fila.no_presento = v.no_presento === true;
		datos[prop].push(fila);
	}
	function valorLocal(tipo, d) {
		var r = filaLocal(tipo, d);
		return r ? B.valorDeFila(tipo.replace(/_borrar$/, ""), r) : null;
	}
	function difiere(tipo, d, v) {
		var a = valorLocal(tipo, d);
		if (tipo.replace(/_borrar$/, "") === "examen_alumno") return !!(a && a.no_presento) !== !!(v && v.no_presento);
		return !B.igual(a, v);
	}

	/*
		capturar(tipo, d, descripcion, campos): se ve de inmediato y se encola (la tablet la guarda y
		la envía sola). d: { examen_id, alumno_id, pregunta_id | campo, y los valores }.
		tipo: examen_respuesta | examen_respuesta_borrar | examen_resultado | examen_resultado_borrar |
		examen_alumno. Capturar algo de quien estaba como "No presentó" le quita la marca.
	*/
	function capturar(tipo, d, descripcion, campos) {
		var fam = tipo.replace(/_borrar$/, "");
		var borrar = /_borrar$/.test(tipo);
		var v = null;
		if (!borrar) {
			v = {};
			B.CAMPOS[fam].forEach(function (f) { if (d[f] !== undefined) v[f] = d[f]; });
		}
		if (fam !== "examen_alumno" && !borrar && X.noPresento({ id: d.examen_id }, datos, d.alumno_id)) {
			var a = alumnoPorId(d.alumno_id);
			capturar("examen_alumno", { examen_id: d.examen_id, alumno_id: d.alumno_id, no_presento: false },
				"«No presentó» de " + (a ? a.nombre_completo : "un alumno"), ["no_presento"]);
			mensaje("ok", "Se quitó «No presentó» de " + (a ? a.nombre_completo : "ese alumno") + ": lo capturado sí cuenta.");
		}
		ponerLocal(fam, d, v);
		if (!bandeja) { mensaje("error", "Este navegador no puede guardar capturas. Recarga la página."); return; }
		bandeja.agregar(tipo, d, descripcion, baseCola(fam, d), { campos: campos || B.CAMPOS[fam] })
			.catch(function (e) { console.error("examen: no se pudo encolar", e); mensaje("error", "No se pudo guardar en la tablet. Recarga la página e inténtalo otra vez."); });
	}

	// Lo que no se aplicó (otro aparato lo cambió o la base no lo aceptó): se dice en el aviso
	function avisarCola(clave, texto) {
		avisosCola = avisosCola.filter(function (a) { return a.clave !== clave; }).concat([{ clave: clave, texto: texto }]);
		pintarCola();
	}
	var ultimoCola = { pendientes: 0, estado: "ok", persistente: true };
	function pintarCola() {
		var caja = document.getElementById("exPendientes");
		if (!caja) return;
		var e = ultimoCola, n = e.pendientes || 0;
		var partes = "";
		if (n) {
			var cuantas = n + (n === 1 ? " captura pendiente de enviar" : " capturas pendientes de enviar");
			var donde = e.persistente ? (n === 1 ? ", guardada en esta tablet." : ", guardadas en esta tablet.") : ". No cierres esta página.";
			var texto = e.estado === "red" ? "Sin señal: " + cuantas + donde + " Se envían solas al volver la señal."
				: e.estado === "servidor" ? "No se pudo guardar por ahora; se reintentará. " + cuantas + donde
				: e.estado === "sesion" ? "Tu sesión se cerró: " + cuantas + ". Siguen en esta tablet; vuelve a iniciar sesión para enviarlas."
				: e.estado === "cuenta" ? "En esta tablet entró otra cuenta: las capturas pendientes de la anterior se enviarán cuando ella entre."
				: "Enviando " + cuantas.replace(" pendientes de enviar", "").replace(" pendiente de enviar", "") + "...";
			partes += '<div class="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border ' + (e.estado === "enviando" || e.estado === "ok" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-300 bg-amber-50 text-amber-900") + ' px-4 py-3" data-cola-estado="' + esc(e.estado) + '">' +
				icono("alerta") + '<p class="text-sm font-medium flex-1" data-cola-texto>' + esc(texto) + '</p>' +
				(e.estado === "red" || e.estado === "servidor" ? '<button type="button" data-reintentar class="' + BTN_SEC + '">Reintentar ahora</button>' : '') + '</div>';
		}
		if (avisosCola.length) {
			partes += '<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900 flex flex-col gap-2" role="alert"><p class="text-sm font-semibold">No se aplicó:</p>' +
				'<ul class="list-disc pl-5 text-sm flex flex-col gap-1">' + avisosCola.map(function (a) { return '<li>' + esc(a.texto) + '</li>'; }).join("") + '</ul>' +
				'<button type="button" data-cerrar-avisos class="' + BTN_SEC + ' self-start">Entendido</button></div>';
		}
		caja.hidden = !partes;
		caja.innerHTML = partes;
		if (vistaActual && vistaActual.tipo === "resultados") pintarEstadoCeldas();
	}
	function avisoPendientes() { pintarCola(); }
	document.addEventListener("click", function (e) {
		if (!e.target.closest) return;
		if (e.target.closest("[data-reintentar]") && bandeja) bandeja.procesar();
		if (e.target.closest("[data-cerrar-avisos]")) { avisosCola = []; pintarCola(); }
	});

	// Lo que dijo la base (o otra ventana de esta tablet): se muestra si la pantalla tenía otra cosa
	function aplicarDeBase(it, v) {
		var fam = it.tipo.replace(/_borrar$/, "");
		if (!difiere(fam, it.datos, v)) return;
		ponerLocal(fam, it.datos, v);
		repintar();
	}
	function repintar() {
		if (!vistaActual) return;
		if (vistaActual.tipo === "resultados") pintarResultados(vistaActual.ex);
		else if (vistaActual.tipo === "propio" && ctx.alReintentar) ctx.alReintentar();
		else if (vistaActual.tipo === "lista") pintarLista();
	}

	if (B) {
		bandeja = B.crear({
			sb: sb,
			auth: window.Lectura && window.Lectura.authDirecto ? window.Lectura.authDirecto : null,
			maestroId: userId,
			alCambiar: function (e) { ultimoCola = e; pintarCola(); },
			alGuardar: function (it, r) {
				if (!B.esExamen(it.tipo)) return;
				enBase[it.clave] = r ? r.base : null;
				if (r && !r.sigue) aplicarDeBase(it, r.fila ? r.valor : null);
			},
			alConflicto: function (it, r) {
				if (!B.esExamen(it.tipo)) return;
				enBase[it.clave] = r.base;
				if (!r.sigue) aplicarDeBase(it, r.actual);
				avisarCola(it.clave, r.texto);
			},
			alRechazar: function (it, explicacion, r) {
				if (!B.esExamen(it.tipo)) return;
				if (r && r.base !== undefined) {
					enBase[it.clave] = r.base;
					if (!r.sigue) aplicarDeBase(it, r.actual === undefined ? null : r.actual);
				}
				avisarCola(it.clave, (it.descripcion || "Una captura") + ": " + explicacion + ".");
			},
			// Otra ventana de esta tablet envió algo: la versión nueva de la base
			alSaber: function (m) {
				if (!B.esExamen(m.tipoCaptura) || !m.datos) return;
				if (m.base !== undefined) enBase[m.clave] = m.base;
				var pendiente = m.sigue || (!bandeja.persistente() && bandeja.pendienteDe(m.clave));
				if (m.base !== undefined && !pendiente) aplicarDeBase({ tipo: m.tipoCaptura, datos: m.datos }, m.base ? m.base.valor : null);
				if (m.tipo === "aviso" && m.texto) avisarCola(m.clave, m.texto);
			},
		});
		window.addEventListener("online", function () { bandeja.procesar(); });
		document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") bandeja.procesar(); });
		try {
			if (window.AppInstalada && window.AppInstalada.modoApp() && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
		} catch (_) {}
	}
	// Sin almacenamiento en la tablet (sin IndexedDB) lo pendiente solo vive en esta página
	window.addEventListener("beforeunload", function (e) {
		if (!(bandeja && bandeja.pendientes() && !bandeja.persistente())) return;
		e.preventDefault();
		e.returnValue = "";
	});

	// Lo que sigue en la cola (por ejemplo, se recargó sin señal) va encima de lo leído de la base
	async function aplicarPendientes() {
		if (!bandeja) return;
		var lista = await bandeja.lista();
		lista.forEach(function (it) {
			if (!B.esExamen(it.tipo)) return;
			var fam = it.tipo.replace(/_borrar$/, "");
			if (it.borrar) { ponerLocal(fam, it.datos, null); return; }
			var v = B.valoresPendientes(it);
			var antes = valorLocal(fam, it.datos) || {};
			ponerLocal(fam, it.datos, Object.assign({}, antes, v));
		});
	}

	// ── Carga ────────────────────────────────────────────────────────────────────
	async function cargar() {
		var lect = await Promise.all([
			window.Lectura.uno(sb.from("perfiles").select("nombre_completo, escuela").eq("id", userId).maybeSingle()),
			window.Lectura.todas(function () {
				return sb.from("alumnos").select("id, nombre_completo, num_lista, grado, estatus")
					.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("num_lista", { ascending: true }).order("id", { ascending: true });
			}),
			window.Lectura.todas(function () {
				return sb.from("examenes_grupo").select("*").eq("maestro_id", userId).eq("grupo_id", grupo.id)
					.order("trimestre", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: true });
			}),
			// Modelo anterior: lo que la maestra ya había aplicado de la tienda (solo para abrirlo)
			window.Lectura.todas(function () {
				return sb.from("examenes").select("id, titulo, trimestre, grado, total_preguntas, created_at")
					.eq("maestro_id", userId).eq("grupo_id", grupo.id).order("created_at", { ascending: false }).order("id", { ascending: true });
			}),
		]);
		perfil = lect[0] || {};
		alumnos = lect[1] || [];
		examenes = lect[2] || [];
		anteriores = lect[3] || [];
		var propios = examenes.filter(function (e) { return e.modo === "propio"; }).map(function (e) { return e.id; });
		var deRes = examenes.filter(function (e) { return e.modo === "resultados"; }).map(function (e) { return e.id; });
		var l2 = await Promise.all([
			propios.length ? window.Lectura.porLotes(propios, function (lote) {
				return sb.from("examen_preguntas").select("id, examen_id, orden, tipo, campo, enunciado, opciones, clave")
					.eq("maestro_id", userId).in("examen_id", lote).order("orden", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });
			}) : [],
			propios.length ? window.Lectura.porLotes(propios, function (lote) {
				return sb.from("examen_respuestas").select("id, examen_id, pregunta_id, alumno_id, respuesta, resultado, origen, captura_id")
					.eq("maestro_id", userId).in("examen_id", lote).order("id", { ascending: true });
			}) : [],
			deRes.length ? window.Lectura.porLotes(deRes, function (lote) {
				return sb.from("examen_resultados").select("id, examen_id, alumno_id, campo, preguntas, aciertos, captura_id")
					.eq("maestro_id", userId).in("examen_id", lote).order("id", { ascending: true });
			}) : [],
			// "No presentó" (mi_salon_b19), de todos los exámenes del grupo
			examenes.length ? window.Lectura.porLotes(examenes.map(function (e) { return e.id; }), function (lote) {
				return sb.from("examen_alumnos").select("id, examen_id, alumno_id, no_presento, captura_id")
					.eq("maestro_id", userId).in("examen_id", lote).order("id", { ascending: true });
			}) : [],
		]);
		datos.preguntas = l2[0] || [];
		datos.respuestas = l2[1] || [];
		datos.resultados = l2[2] || [];
		datos.alumnosExamen = l2[3] || [];
		// Lo que la pantalla vio de la base (con su marca): la cola decide con esto si otro aparato lo cambió
		enBase = {};
		datos.respuestas.forEach(function (r) { ponerBase("examen_respuesta", r); });
		datos.resultados.forEach(function (r) { ponerBase("examen_resultado", r); });
		datos.alumnosExamen.forEach(function (r) { ponerBase("examen_alumno", r); });
		datos.preguntas.sort(function (a, b) { return (a.orden - b.orden); });
	}

	function alumnoPorId(id) { for (var i = 0; i < alumnos.length; i++) if (alumnos[i].id === id) return alumnos[i]; return null; }

	// "No presentó" de un alumno en un examen (o quitarlo): por la cola, como cualquier captura
	function marcarNoPresento(ex, alumnoId, si) {
		var a = alumnoPorId(alumnoId);
		capturar("examen_alumno", { examen_id: ex.id, alumno_id: alumnoId, no_presento: !!si },
			(si ? "«No presentó» de " : "Quitar «No presentó» de ") + (a ? a.nombre_completo : "un alumno"), ["no_presento"]);
		mensaje("ok", si ? (a ? a.nombre_completo : "El alumno") + ": no presentó. No cuenta ni a favor ni en contra en este examen; si lo presenta después, captúralo normal."
			: "Se quitó «No presentó» de " + (a ? a.nombre_completo : "ese alumno") + ".");
	}

	function examenPorId(id) { for (var i = 0; i < examenes.length; i++) if (examenes[i].id === id) return examenes[i]; return null; }
	function alumnosDe(ex) { return X.alumnosDelExamen(alumnos, ex); }

	// ── Contexto compartido con js/examen-propio.js ──────────────────────────────
	var ctx = {
		sb: sb, userId: userId, grupo: grupo, datos: datos,
		alumnos: function () { return alumnos; }, alumnosDe: alumnosDe,
		esc: esc, icono: icono, mensaje: mensaje, escribir: escribir, textoError: textoError,
		BTN: BTN, BTN_PRI: BTN_PRI, BTN_SEC: BTN_SEC, BTN_PELIGRO: BTN_PELIGRO,
		textoGrados: textoGrados, textoFecha: textoFecha,
		perfil: function () { return perfil; },
		capturar: capturar,
		noPresento: function (ex, alumnoId) { return X.noPresento(ex, datos, alumnoId); },
		marcarNoPresento: marcarNoPresento,
		pendienteCola: function (tipo, d) { return !!(bandeja && bandeja.pendienteDe(claveCola(tipo, d))); },
		avisoPendientes: avisoPendientes,
		confirmar: confirmar,
		imprimir: imprimir,
		ir: function (hash) { if (window.location.hash === hash) mostrar(); else window.location.hash = hash; },
		editarExamen: function (ex) { abrirDialogoExamen(ex, null); },
		duplicarExamen: function (ex) { abrirDialogoExamen(null, ex); },
		eliminarExamen: eliminarExamen,
		cabecera: cabeceraExamen,
	};

	// ── Diálogo de confirmación ──────────────────────────────────────────────────
	function confirmar(titulo, texto, boton, peligro) {
		return new Promise(function (listo) {
			var d = el.dlgConfirmar;
			d.innerHTML = '<form method="dialog" class="p-5 flex flex-col gap-4">' +
				'<h2 id="exDlgConfirmarTitulo" class="text-lg font-bold text-gray-900">' + esc(titulo) + '</h2>' +
				'<p class="text-sm text-gray-600">' + esc(texto) + '</p>' +
				'<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
				'<button value="no" class="' + BTN_SEC + '">Cancelar</button>' +
				'<button value="si" class="' + (peligro ? BTN + " bg-red-600 text-white hover:bg-red-700" : BTN_PRI) + '">' + esc(boton) + '</button></div></form>';
			d.addEventListener("close", function f() { d.removeEventListener("close", f); listo(d.returnValue === "si"); });
			d.returnValue = "";
			d.showModal();
		});
	}

	// ── Imprimir ─────────────────────────────────────────────────────────────────
	function imprimir(html) {
		var zona = document.getElementById("zonaImpresion");
		var turno = String(Date.now()) + Math.random();
		zona.innerHTML = html;
		zona.dataset.turno = turno;
		// Solo limpia lo suyo: si ya se pidió otra impresión, no la borra
		var limpiar = function () {
			window.removeEventListener("afterprint", limpiar);
			setTimeout(function () { if (zona.dataset.turno === turno) zona.innerHTML = ""; }, 300);
		};
		window.addEventListener("afterprint", limpiar);
		setTimeout(function () { window.print(); }, 50);
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Lista
	// ══════════════════════════════════════════════════════════════════════════════
	var vistaActual = { tipo: "lista" };

	function badgeEstado(est) {
		var c = est.clave === "calificado" ? "bg-emerald-100 text-emerald-800" : (est.clave === "en_revision" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700");
		var extra = est.clave === "en_revision" ? " · " + est.completos + " de " + est.total : "";
		return '<span data-estado="' + est.clave + '" class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ' + c + '">' + esc(est.texto + extra) + '</span>';
	}

	function tarjeta(ex) {
		var est = X.estadoExamen(ex, datos, alumnos);
		var detalle;
		if (ex.modo === "resultados") {
			detalle = Object.keys(ex.campos_resultados || {}).map(function (c) {
				return (X.campo(c) ? X.campo(c).corto : c) + " " + ex.campos_resultados[c];
			}).join(" · ") + " preguntas";
		} else {
			var r = X.resumenPreguntas(datos.preguntas.filter(function (p) { return p.examen_id === ex.id; }));
			detalle = r.total ? r.total + (r.total === 1 ? " pregunta" : " preguntas") + (r.aMano ? " (" + r.aMano + " a mano)" : "") : "Sin preguntas todavía";
		}
		var pend = est.pendientesMano ? '<p class="text-xs text-amber-800 mt-1">' + est.pendientesMano + (est.pendientesMano === 1 ? " respuesta por calificar a mano" : " respuestas por calificar a mano") + '</p>' : "";
		return '<li><a href="#ex=' + esc(ex.id) + '" data-examen="' + esc(ex.id) + '" class="flex flex-col gap-2 h-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow min-h-[44px]">' +
			'<div class="flex items-start justify-between gap-3"><h3 class="font-bold text-gray-900 leading-snug break-words min-w-0">' + esc(ex.titulo) + '</h3>' + badgeEstado(est) + '</div>' +
			'<div class="flex flex-wrap gap-1.5 text-xs">' +
			'<span class="rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 font-medium">' + (ex.modo === "resultados" ? "Solo resultados" : "Creado en Mi Salón") + '</span>' +
			'<span class="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 font-medium">' + esc(textoGrados(ex.grados)) + '</span>' +
			(ex.fecha_aplicacion ? '<span class="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 font-medium">' + esc(textoFecha(ex.fecha_aplicacion)) + '</span>' : '') +
			'</div><p class="text-sm text-gray-600">' + esc(detalle) + '</p>' + pend + '</a></li>';
	}

	function pintarLista() {
		vistaActual = { tipo: "lista" };
		var html = '<div id="exPendientes" hidden></div>' +
			'<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">' +
			'<p class="text-sm text-gray-600">' + (examenes.length ? examenes.length + (examenes.length === 1 ? " examen" : " exámenes") + " del grupo" : "") + '</p>' +
			'<button type="button" id="exNuevo" class="' + BTN_PRI + '">' + icono("mas", "h-4 w-4") + 'Nuevo examen</button></div>';
		if (!examenes.length) {
			html += '<div class="rounded-2xl border border-dashed border-gray-300 bg-white p-6 sm:p-8 flex flex-col gap-4">' +
				'<p class="text-base font-semibold text-gray-800">Aún no hay exámenes en este grupo.</p>' +
				'<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">' +
				'<div class="rounded-xl bg-gray-50 p-4"><p class="font-semibold text-gray-800">Crear mi examen</p><p class="mt-1">Escribes las preguntas aquí, imprimes el examen y una hoja de respuestas con círculos, y la revisas con la cámara de la tablet o tocando la letra.</p></div>' +
				'<div class="rounded-xl bg-gray-50 p-4"><p class="font-semibold text-gray-800">Solo subir resultados</p><p class="mt-1">Para un examen que ya tienes (tuyo, de la tienda o revisado a mano): capturas cuántos aciertos sacó cada alumno por campo formativo.</p></div>' +
				'</div></div>';
		} else {
			var porTrim = {};
			examenes.forEach(function (e) { (porTrim[e.trimestre] = porTrim[e.trimestre] || []).push(e); });
			Object.keys(porTrim).sort().reverse().forEach(function (t) {
				html += '<section class="flex flex-col gap-2"><h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Trimestre ' + esc(t) +
					(Number(t) === Number(grupo.trimestre_actual) ? ' <span class="normal-case font-medium text-blue-700">(actual)</span>' : '') + '</h2>' +
					'<ul class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">' + porTrim[t].map(tarjeta).join("") + '</ul></section>';
			});
		}
		if (anteriores.length) {
			html += '<section class="flex flex-col gap-2"><h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Exámenes anteriores del catálogo</h2>' +
				'<p class="text-sm text-gray-500">Los aplicaste antes de este cambio. Se siguen contando en la boleta y puedes terminar de calificarlos.</p>' +
				'<ul class="flex flex-col gap-2">' + anteriores.map(function (a) {
					return '<li><a href="examen.html?examen_id=' + esc(a.id) + '" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 min-h-[44px] hover:border-blue-300">' +
						'<span class="font-medium text-gray-800">' + esc(a.titulo || "Examen") + '</span><span class="text-xs text-gray-500">Trimestre ' + esc(a.trimestre) + (a.grado ? " · " + esc(a.grado) + "°" : "") + '</span></a></li>';
				}).join("") + '</ul></section>';
		}
		el.vista.innerHTML = html;
		document.getElementById("exNuevo").addEventListener("click", function () { abrirDialogoExamen(null, null); });
		avisoPendientes();
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Nuevo examen / editar datos / duplicar
	// ══════════════════════════════════════════════════════════════════════════════
	// inicial (opcional): { modo } preelegido en un examen nuevo (Ponte al día abre "Solo subir resultados")
	function abrirDialogoExamen(ex, base, inicial) {
		var nuevo = !ex;
		var d = el.dlgExamen;
		var modo = ex ? ex.modo : (base ? base.modo : ((inicial && inicial.modo) || null));
		var fuente = ex || base || {};
		var grados = (fuente.grados && fuente.grados.length ? fuente.grados : gradosGrupo).map(Number);
		var trimestre = fuente.trimestre || grupo.trimestre_actual || 1;
		var titulo = ex ? ex.titulo : (base ? String(base.titulo || "") + " (copia)" : "");

		function camino(clave, tituloC, texto) {
			return '<label class="flex gap-3 items-start rounded-xl border-2 p-4 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 border-gray-200 min-h-[44px]">' +
				'<input type="radio" name="exModo" value="' + clave + '" class="mt-1 h-5 w-5 accent-blue-700"' + (modo === clave ? " checked" : "") + '>' +
				'<span><span class="block font-semibold text-gray-900">' + tituloC + '</span><span class="block text-sm text-gray-600 mt-0.5">' + texto + '</span></span></label>';
		}
		var camposHtml = X.CAMPOS.map(function (c) {
			var v = fuente.campos_resultados && fuente.campos_resultados[c.codigo] ? fuente.campos_resultados[c.codigo] : "";
			return '<label class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-1.5"><span class="text-sm text-gray-700">' + esc(c.nombre) + '</span>' +
				'<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" data-campo="' + c.codigo + '" value="' + esc(v) + '" placeholder="—" aria-label="Preguntas de ' + esc(c.nombre) + '" class="w-20 min-h-[44px] rounded-lg border border-gray-300 px-2 text-center text-base"></label>';
		}).join("");
		var gradosHtml = gradosGrupo.length > 1 ? '<fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold text-gray-800">¿Qué grados lo presentan?</legend>' +
			'<div class="flex flex-wrap gap-2">' + gradosGrupo.map(function (g) {
				return '<label class="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 min-h-[44px] cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">' +
					'<input type="checkbox" name="exGrado" value="' + g + '" class="h-5 w-5 accent-blue-700"' + (grados.indexOf(g) !== -1 ? " checked" : "") + '><span class="text-sm font-medium">' + g + '°</span></label>';
			}).join("") + '</div><p class="text-xs text-gray-500">Todas las preguntas son para los grados que marques. Si quieres preguntas distintas para cada grado, haz un examen por grado (puedes duplicarlo).</p></fieldset>' : "";

		d.innerHTML = '<form class="flex flex-col max-h-[calc(100dvh-24px)]" novalidate>' +
			'<div class="px-5 pt-5 pb-3 border-b border-gray-100"><h2 id="exDlgExamenTitulo" class="text-lg font-bold text-gray-900">' +
			(nuevo ? (base ? "Duplicar examen" : "Nuevo examen") : "Datos del examen") + '</h2>' +
			(base ? '<p class="text-sm text-gray-500 mt-1">Se copian las preguntas; las respuestas no.</p>' : '') + '</div>' +
			'<div class="px-5 py-4 flex flex-col gap-4 overflow-y-auto">' +
			(nuevo && !base ? '<fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold text-gray-800 mb-1">¿Cómo lo quieres hacer?</legend>' +
				camino("propio", "Crear mi examen", "Escribes las preguntas aquí (sugerimos opción múltiple: se revisa sola). Imprimes el examen y una hoja de respuestas que revisas con la cámara de la tablet o tocando la letra.") +
				camino("resultados", "Solo subir resultados", "Para un examen que ya tienes (tuyo, de la tienda o revisado a mano): por campo formativo, cuántas preguntas tenía y cuántos aciertos sacó cada alumno.") +
				'</fieldset>' : '') +
			'<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Nombre del examen</span>' +
			'<input id="exTitulo" type="text" maxlength="' + X.LARGO.titulo + '" value="' + esc(titulo) + '" placeholder="Por ejemplo: Examen del primer trimestre" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base"></label>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
			'<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Trimestre</span><select id="exTrimestre" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base bg-white">' +
			[1, 2, 3].map(function (t) { return '<option value="' + t + '"' + (Number(trimestre) === t ? " selected" : "") + '>Trimestre ' + t + '</option>'; }).join("") + '</select></label>' +
			'<label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Fecha en que se aplica <span class="font-normal text-gray-500">(opcional)</span></span>' +
			'<input id="exFecha" type="date" value="' + esc(fuente.fecha_aplicacion || (nuevo ? hoyISO() : "")) + '" class="min-h-[44px] rounded-xl border border-gray-300 px-3 text-base bg-white"></label></div>' +
			gradosHtml +
			'<div id="exBloqueResultados" class="flex flex-col gap-2"' + (modo === "resultados" ? "" : " hidden") + '>' +
			'<p class="text-sm font-semibold text-gray-800">¿Cuántas preguntas tenía de cada campo formativo?</p>' +
			'<p class="text-xs text-gray-500">Deja vacío el campo que el examen no evaluó.</p>' +
			'<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' + camposHtml + '</div></div>' +
			'<div id="exBloquePropio"' + (modo === "propio" ? "" : " hidden") + '><label class="flex flex-col gap-1"><span class="text-sm font-semibold text-gray-800">Instrucciones para el alumno <span class="font-normal text-gray-500">(opcional)</span></span>' +
			'<textarea id="exInstr" rows="2" maxlength="' + X.LARGO.instrucciones + '" class="rounded-xl border border-gray-300 px-3 py-2 text-base">' + esc(fuente.instrucciones || "") + '</textarea></label></div>' +
			'<p id="exDlgError" class="hidden text-sm font-medium text-red-700" role="alert"></p>' +
			'</div>' +
			'<div class="px-5 py-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
			'<button type="button" data-cerrar class="' + BTN_SEC + '">Cancelar</button>' +
			'<button type="submit" class="' + BTN_PRI + '">' + (nuevo ? (base ? "Duplicar" : "Crear examen") : "Guardar") + '</button></div></form>';

		var form = d.querySelector("form");
		var err = d.querySelector("#exDlgError");
		function error(t) { err.textContent = t; err.classList.toggle("hidden", !t); }
		d.querySelector("[data-cerrar]").addEventListener("click", function () { d.close(); });
		d.querySelectorAll("input[name=exModo]").forEach(function (r) {
			r.addEventListener("change", function () {
				modo = r.value;
				d.querySelector("#exBloqueResultados").hidden = modo !== "resultados";
				d.querySelector("#exBloquePropio").hidden = modo !== "propio";
				error("");
			});
		});
		form.addEventListener("submit", async function (e) {
			e.preventDefault();
			error("");
			if (!modo) { error("Elige cómo lo quieres hacer: crear tu examen o solo subir resultados."); return; }
			var tit = String(d.querySelector("#exTitulo").value || "").replace(/\s+/g, " ").trim();
			if (!tit) { error("Escribe el nombre del examen."); d.querySelector("#exTitulo").focus(); return; }
			var gs = gradosGrupo.length > 1
				? Array.prototype.map.call(d.querySelectorAll("input[name=exGrado]:checked"), function (c) { return Number(c.value); })
				: gradosGrupo.slice();
			if (!gs.length) { error("Marca al menos un grado."); return; }
			var fila = {
				titulo: tit, trimestre: Number(d.querySelector("#exTrimestre").value) || 1, grados: gs,
				fecha_aplicacion: d.querySelector("#exFecha").value || null,
			};
			var cambios = null;
			if (modo === "resultados") {
				var entrada = {};
				d.querySelectorAll("input[data-campo]").forEach(function (i) { entrada[i.dataset.campo] = i.value; });
				var v = X.validarCampos(entrada);
				if (!v.ok) { error(v.error); return; }
				fila.campos_resultados = v.campos;
				if (ex) {
					cambios = X.cambioDeCampos(ex.campos_resultados, v.campos, datos.resultados.filter(function (r) { return r.examen_id === ex.id; }));
					if (!cambios.ok) { error(cambios.error); return; }
					if (cambios.quitar.length && !(await confirmar("Quitar campos con capturas",
						"Quitaste " + cambios.quitar.map(function (c) { return X.campo(c).nombre; }).join(" y ") + ". Se borran los aciertos que ya capturaste de ese campo.", "Quitar y guardar", true))) return;
				}
			} else {
				fila.instrucciones = String(d.querySelector("#exInstr").value || "").trim() || null;
			}
			var boton = form.querySelector("button[type=submit]");
			boton.disabled = true;
			var r, guardado = null;
			if (ex) {
				r = await escribir(sb.from("examenes_grupo").update(fila).eq("id", ex.id).eq("maestro_id", userId).select("*").single());
				if (r.ok) guardado = r.data;
				if (r.ok && cambios) {
					for (var i = 0; i < cambios.ajustar.length && r.ok; i++) {
						var c = cambios.ajustar[i];
						// Ajuste del examen (necesita señal): el trigger les pone marca del servidor; la
						// pantalla toma la nueva versión para que una captura siguiente no parezca de otro aparato
						r = await escribir(sb.from("examen_resultados").update({ preguntas: fila.campos_resultados[c] }).eq("examen_id", ex.id).eq("maestro_id", userId).eq("campo", c)
							.select("id, examen_id, alumno_id, campo, preguntas, aciertos, captura_id"));
						if (r.ok) (r.data || []).forEach(function (x) { ponerBase("examen_resultado", x); });
					}
					if (r.ok && cambios.quitar.length) {
						r = await escribir(sb.from("examen_resultados").delete().eq("examen_id", ex.id).eq("maestro_id", userId).in("campo", cambios.quitar)
							.select("id, examen_id, alumno_id, campo"));
						if (r.ok) (r.data || []).forEach(function (x) { ponerBase("examen_resultado", null, x); });
					}
				}
			} else {
				fila.modo = modo;
				fila.grupo_id = grupo.id;
				fila.maestro_id = userId;
				r = await escribir(sb.from("examenes_grupo").insert(fila).select("*").single());
				if (r.ok && base && base.modo === "propio") {
					var copia = datos.preguntas.filter(function (p) { return p.examen_id === base.id; }).map(function (p) {
						return { examen_id: r.data.id, maestro_id: userId, orden: p.orden, tipo: p.tipo, campo: p.campo, enunciado: p.enunciado, opciones: p.opciones, clave: p.clave };
					});
					if (copia.length) {
						var rc = await escribir(sb.from("examen_preguntas").insert(copia).select("id, examen_id, orden, tipo, campo, enunciado, opciones, clave"));
						if (rc.ok) datos.preguntas = datos.preguntas.concat(rc.data || []);
						else mensaje("error", "Se creó el examen pero no se copiaron las preguntas. " + textoError(rc.error));
					}
				}
			}
			boton.disabled = false;
			if (!r.ok) { error(textoError(r.error)); return; }
			// Refleja lo guardado
			if (ex) {
				Object.assign(ex, guardado || fila); // r puede ser ya la de las capturas
				if (cambios) {
					datos.resultados = datos.resultados.filter(function (x) { return !(x.examen_id === ex.id && cambios.quitar.indexOf(x.campo) !== -1); });
					datos.resultados.forEach(function (x) { if (x.examen_id === ex.id && fila.campos_resultados[x.campo]) x.preguntas = fila.campos_resultados[x.campo]; });
				}
				d.close();
				mensaje("ok", "Datos del examen guardados.");
				mostrar();
			} else {
				examenes.unshift(r.data);
				d.close();
				mensaje(null);
				ctx.ir("#ex=" + r.data.id + (r.data.modo === "propio" ? "&tab=preguntas" : ""));
			}
		});
		d.showModal();
		var primero = d.querySelector(nuevo && !base ? "input[name=exModo]" : "#exTitulo");
		if (primero) primero.focus();
	}

	async function eliminarExamen(ex) {
		var n = ex.modo === "resultados"
			? datos.resultados.filter(function (r) { return r.examen_id === ex.id; }).length
			: datos.respuestas.filter(function (r) { return r.examen_id === ex.id; }).length;
		var ok = await confirmar("Eliminar examen", "Se borra «" + ex.titulo + "»" + (n ? " con todo lo capturado (" + n + (n === 1 ? " dato" : " datos") + ")" : "") +
			". Deja de contar en la boleta. No se puede deshacer.", "Eliminar", true);
		if (!ok) return;
		var r = await escribir(sb.from("examenes_grupo").delete().eq("id", ex.id).eq("maestro_id", userId));
		if (!r.ok) { mensaje("error", textoError(r.error)); return; }
		examenes = examenes.filter(function (e) { return e.id !== ex.id; });
		datos.preguntas = datos.preguntas.filter(function (p) { return p.examen_id !== ex.id; });
		datos.respuestas = datos.respuestas.filter(function (p) { return p.examen_id !== ex.id; });
		datos.resultados = datos.resultados.filter(function (p) { return p.examen_id !== ex.id; });
		datos.alumnosExamen = datos.alumnosExamen.filter(function (p) { return p.examen_id !== ex.id; });
		mensaje("ok", "Examen eliminado.");
		ctx.ir("#");
	}

	// Cabecera de un examen (título, datos, estado y acciones)
	function cabeceraExamen(ex, extraAcciones) {
		var est = X.estadoExamen(ex, datos, alumnos);
		var meta = ["Trimestre " + ex.trimestre, textoGrados(ex.grados)];
		if (ex.fecha_aplicacion) meta.push(textoFecha(ex.fecha_aplicacion));
		return '<div id="exPendientes" hidden></div>' +
			'<a href="#" class="inline-flex items-center gap-1 self-start min-h-[44px] pr-3 text-sm font-semibold text-blue-700 hover:underline">' + icono("atras", "h-4 w-4") + 'Todos los exámenes</a>' +
			'<section class="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm flex flex-col gap-3">' +
			'<div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">' +
			'<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="text-xl font-bold text-gray-900 break-words">' + esc(ex.titulo) + '</h2>' + badgeEstado(est) + '</div>' +
			'<p class="text-sm text-gray-600 mt-1">' + (ex.modo === "resultados" ? "Solo resultados" : "Creado en Mi Salón") + ' · ' + esc(meta.join(" · ")) + '</p></div>' +
			'<div class="flex flex-wrap gap-2 shrink-0">' + (extraAcciones || "") +
			'<button type="button" data-accion="editar" class="' + BTN_SEC + '">' + icono("lapiz", "h-4 w-4") + 'Datos</button>' +
			'<button type="button" data-accion="eliminar" class="' + BTN_PELIGRO + '">' + icono("basura", "h-4 w-4") + 'Eliminar</button></div></div></section>';
	}
	// El estado de la cabecera cambia con cada captura
	function refrescarEstado(ex) {
		var b = el.vista.querySelector("section [data-estado]");
		if (b) b.outerHTML = badgeEstado(X.estadoExamen(ex, datos, alumnos));
	}
	ctx.refrescarEstado = refrescarEstado;
	function ligarCabecera(ex) {
		var b1 = el.vista.querySelector("[data-accion=editar]"), b2 = el.vista.querySelector("[data-accion=eliminar]"), b3 = el.vista.querySelector("[data-accion=duplicar]");
		if (b1) b1.addEventListener("click", function () { abrirDialogoExamen(ex, null); });
		if (b2) b2.addEventListener("click", function () { eliminarExamen(ex); });
		if (b3) b3.addEventListener("click", function () { abrirDialogoExamen(null, ex); });
	}
	ctx.ligarCabecera = ligarCabecera;

	// ══════════════════════════════════════════════════════════════════════════════
	// Solo subir resultados: tabla alumnos × campos
	// ══════════════════════════════════════════════════════════════════════════════
	function valorGuardado(ex, alumnoId, campo) {
		for (var i = 0; i < datos.resultados.length; i++) {
			var r = datos.resultados[i];
			if (r.examen_id === ex.id && r.alumno_id === alumnoId && r.campo === campo) return r;
		}
		return null;
	}

	function totalAlumno(ex, alumnoId) {
		if (X.noPresento(ex, datos, alumnoId)) return '<span class="text-sm font-semibold text-gray-600">No presentó</span><span class="block text-xs text-gray-500">No cuenta</span>';
		var res = X.resultadoAlumno(ex, datos, alumnoId);
		if (!res.preguntas) return '<span class="text-gray-400">—</span>';
		return '<span class="font-semibold text-gray-900">' + X.numeroAciertos(res.aciertos) + '</span><span class="text-gray-500"> / ' + res.preguntas + '</span>' +
			'<span class="block text-xs text-gray-500">' + Math.floor(res.porcentaje * 10 + 1e-9) / 10 + ' %</span>';
	}

	// El botón "No presentó" de un alumno (se oprime otra vez para quitarlo)
	function botonNoPresento(ex, a) {
		var si = X.noPresento(ex, datos, a.id);
		return '<button type="button" data-no-presento="' + esc(a.id) + '" aria-pressed="' + si + '" aria-label="No presentó: ' + esc(a.nombre_completo) + '" ' +
			'class="min-h-[44px] px-3 rounded-xl text-xs font-semibold border-2 whitespace-nowrap ' +
			(si ? "bg-gray-700 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50") + '">No presentó</button>';
	}
	ctx.botonNoPresento = botonNoPresento;

	function pintarResultados(ex) {
		vistaActual = { tipo: "resultados", ex: ex };
		var campos = X.CODIGOS.filter(function (c) { return ex.campos_resultados && ex.campos_resultados[c]; });
		var lista = alumnosDe(ex);
		var html = cabeceraExamen(ex);
		html += '<section class="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col">' +
			'<div class="p-4 sm:p-5 flex flex-col gap-1 border-b border-gray-100">' +
			'<h3 class="font-bold text-gray-900 flex items-center gap-2">' + icono("tabla", "h-5 w-5 text-blue-700") + 'Aciertos de cada alumno</h3>' +
			'<p class="text-sm text-gray-600">Escribe cuántos aciertos sacó en cada campo. Se guarda en la tablet al pasar a otra casilla y se envía solo (también sin señal); con Enter bajas al siguiente alumno. ' +
			'Si alguien no presentó, toca «No presentó»: no cuenta ni a favor ni en contra y el examen puede quedar Calificado. Si lo presenta después, escribe sus aciertos.</p></div>';
		if (!lista.length) {
			html += '<p class="p-5 text-sm text-gray-500">No hay alumnos activos de ' + esc(textoGrados(ex.grados)) + ' en el grupo.</p></section>';
			el.vista.innerHTML = html;
			ligarCabecera(ex);
			return;
		}
		html += '<div class="overflow-x-auto"><table class="ex-tabla w-full text-sm" id="exTablaResultados"><thead><tr class="bg-gray-50 text-left">' +
			'<th scope="col" class="ex-fija bg-gray-50 px-3 py-2 font-semibold text-gray-700 min-w-[10rem]">Alumno</th>' +
			campos.map(function (c) {
				return '<th scope="col" class="px-2 py-2 font-semibold text-gray-700 text-center whitespace-nowrap">' + esc(X.campo(c).corto) +
					'<span class="block text-xs font-normal text-gray-500">de ' + ex.campos_resultados[c] + '</span></th>';
			}).join("") + '<th scope="col" class="px-3 py-2 font-semibold text-gray-700 text-center">Total</th></tr></thead><tbody>';
		lista.forEach(function (a, fila) {
			var np = X.noPresento(ex, datos, a.id);
			html += '<tr data-alumno="' + esc(a.id) + '"' + (np ? ' class="bg-gray-50"' : '') + '><th scope="row" class="ex-fija px-3 py-1.5 text-left font-medium text-gray-800' + (np ? " bg-gray-50" : "") + '">' +
				'<span class="text-gray-400 text-xs mr-1">' + esc(a.num_lista || "") + '</span>' + esc(a.nombre_completo) +
				(gradosGrupo.length > 1 ? ' <span class="text-xs text-gray-500">' + esc(a.grado) + '°</span>' : '') +
				// «No presentó» bajo el nombre (una columna más ensanchaba la vista de celular)
				'<div class="mt-1">' + botonNoPresento(ex, a) + '</div></th>' +
				campos.map(function (c, col) {
					var g = valorGuardado(ex, a.id, c);
					return '<td class="px-2 py-1.5 text-center"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" ' +
						'class="ex-celda w-16 min-h-[44px] rounded-lg border border-gray-300 text-center text-base' + (np ? " text-gray-400" : "") + '" data-campo="' + c + '" data-fila="' + fila + '" data-col="' + col + '" ' +
						'aria-label="' + esc(X.campo(c).corto + ", " + a.nombre_completo) + '" value="' + (g ? esc(g.aciertos) : "") + '"></td>';
				}).join("") + '<td class="px-3 py-1.5 text-center whitespace-nowrap" data-total>' + totalAlumno(ex, a.id) + '</td></tr>';
		});
		html += '</tbody></table></div><p id="exErrorCelda" class="hidden px-4 py-2 text-sm font-medium text-red-700" role="alert"></p></section>';
		el.vista.innerHTML = html;
		ligarCabecera(ex);
		pintarEstadoCeldas();
		avisoPendientes();

		var tabla = document.getElementById("exTablaResultados");
		var errEl = document.getElementById("exErrorCelda");
		tabla.addEventListener("input", function (e) {
			var inp = e.target.closest("input[data-campo]");
			if (!inp) return;
			var v = X.leerNumero(inp.value, ex.campos_resultados[inp.dataset.campo]);
			inp.classList.toggle("border-red-500", !v.ok);
			inp.classList.toggle("bg-red-50", !v.ok);
			errEl.textContent = v.ok ? "" : v.error;
			errEl.classList.toggle("hidden", v.ok);
		});
		tabla.addEventListener("change", function (e) {
			var inp = e.target.closest("input[data-campo]");
			if (inp) guardarCelda(ex, inp);
		});
		tabla.addEventListener("click", function (e) {
			var b = e.target.closest("[data-no-presento]");
			if (!b) return;
			var id = b.getAttribute("data-no-presento");
			marcarNoPresento(ex, id, !X.noPresento(ex, datos, id));
			pintarResultados(ex);
			var otra = document.querySelector('[data-no-presento="' + id + '"]');
			if (otra) otra.focus();
		});
		tabla.addEventListener("keydown", function (e) {
			if (e.key !== "Enter") return;
			var inp = e.target.closest("input[data-campo]");
			if (!inp) return;
			e.preventDefault();
			var sig = tabla.querySelector('input[data-fila="' + (Number(inp.dataset.fila) + 1) + '"][data-col="' + inp.dataset.col + '"]') ||
				tabla.querySelector('input[data-fila="0"][data-col="' + (Number(inp.dataset.col) + 1) + '"]');
			if (sig) { sig.focus(); sig.select(); } else inp.blur();
		});
	}

	// Casillas que siguen en la cola (sin enviar): en ámbar
	function pintarEstadoCeldas() {
		var tabla = document.getElementById("exTablaResultados");
		if (!tabla || !vistaActual || !vistaActual.ex) return;
		var ex = vistaActual.ex;
		tabla.querySelectorAll("input[data-campo]").forEach(function (inp) {
			var tr = inp.closest("tr[data-alumno]");
			var pend = ctx.pendienteCola("examen_resultado", { examen_id: ex.id, alumno_id: tr.dataset.alumno, campo: inp.dataset.campo });
			inp.classList.toggle("bg-amber-50", pend);
			inp.classList.toggle("border-amber-500", pend);
			inp.title = pend ? "Guardado en la tablet; falta enviarlo" : "";
		});
	}

	function guardarCelda(ex, inp) {
		var tr = inp.closest("tr[data-alumno]");
		var alumnoId = tr.dataset.alumno, campo = inp.dataset.campo, preguntas = Number(ex.campos_resultados[campo]);
		var v = X.leerNumero(inp.value, preguntas);
		if (!v.ok) return; // se queda en rojo, sin guardar
		var previo = valorGuardado(ex, alumnoId, campo);
		if (v.vacio && !previo) return;
		if (!v.vacio && previo && Number(previo.aciertos) === v.valor && Number(previo.preguntas) === preguntas) return;
		var a = alumnoPorId(alumnoId);
		var d = { examen_id: ex.id, alumno_id: alumnoId, campo: campo };
		var desc = X.campo(campo).corto + " de " + (a ? a.nombre_completo : "un alumno") + " en «" + ex.titulo + "»";
		var np = X.noPresento(ex, datos, alumnoId);
		if (v.vacio) capturar("examen_resultado_borrar", d, desc);
		else capturar("examen_resultado", Object.assign({ aciertos: v.valor, preguntas: preguntas }, d), desc);
		if (np && !v.vacio) { pintarResultados(ex); return; } // ya no dice "No presentó"
		var celdaTotal = tr.querySelector("[data-total]");
		if (celdaTotal) celdaTotal.innerHTML = totalAlumno(ex, alumnoId);
		pintarEstadoCeldas();
		refrescarEstado(ex);
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// Rutas (#ex=<id>&tab=...)
	// ══════════════════════════════════════════════════════════════════════════════
	function mostrar() {
		var h = window.location.hash.replace(/^#/, "");
		var p = new URLSearchParams(h);
		var id = p.get("ex");
		if (window.ExamenCamara && window.ExamenCamara.abierta()) window.ExamenCamara.cerrar();
		if (!id) { pintarLista(); return; }
		var ex = examenPorId(id);
		if (!ex) { mensaje("aviso", "Ese examen ya no existe."); pintarLista(); return; }
		if (ex.modo === "resultados") pintarResultados(ex);
		else { vistaActual = { tipo: "propio", ex: ex }; window.ExamenPropio.pintar(ctx, ex, p.get("tab") || "preguntas", el.vista); avisoPendientes(); }
		window.scrollTo(0, 0);
	}

	await cargar();
	await aplicarPendientes();
	var partes = [grupo.nombre || "Grupo"];
	if (grupo.ciclo_escolar) partes.push("Ciclo " + grupo.ciclo_escolar);
	if (gradosGrupo.length) partes.push(textoGrados(gradosGrupo));
	el.subtitulo.textContent = partes.join(" · ");
	mostrar();
	window.addEventListener("hashchange", function () { mensaje(null); mostrar(); });
	/*
		Registro histórico (Ponte al día, paso 3): examen.html?nuevo=resultados&desde=ponte abre el
		camino de siempre, "Solo subir resultados", con su fecha editable (la del examen que ya se
		aplicó), y deja a la vista cómo volver al asistente.
	*/
	var params = new URLSearchParams(window.location.search);
	if (params.get("desde") === "ponte") {
		var volver = document.getElementById("exPonte");
		if (volver) volver.classList.remove("hidden");
	}
	if (params.get("nuevo") === "resultados" && !window.location.hash) abrirDialogoExamen(null, null, { modo: "resultados" });
	// Lo pendiente de otra vez (o de otra ventana) se intenta enviar ya
	if (bandeja) bandeja.iniciar();
}
