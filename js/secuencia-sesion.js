/*
	secuencia-sesion.js — La secuencia de una sesión (inicio, desarrollo y cierre, sus tareas y sus
	enlaces a anexos y libros) lista para mostrarse. Es lo que Inicio (js/dashboard.js) escribía con
	ayudantes atados a la variable global de la sesión activa; aquí cada función recibe LA SESIÓN
	como parámetro, así que Hoy puede mostrar la de cualquier sesión (la de hoy y la de las que
	faltan) sin tocar el estado de otra pantalla.

	Los textos diferenciados (por grado o por grupo de trabajo) se leen con js/texto-sesion.js.

	Expone window.SecuenciaSesion (y module.exports para las pruebas):
	  COLUMNAS                   → las columnas de `sesiones` que se necesitan leer
	  textoFase(sesion, fase)    → el texto de "inicio" | "desarrollo" | "cierre" ("" si no hay)
	  actividadesFase(sesion, fase) → los pasos de la fase (todo el grupo y luego cada grado o grupo)
	  tareasCierre(sesion)       → ["1°: Platica en casa…", …] (las tareas que se dejan al cerrar)
	  recursos(sesion)           → [{ titulo, url, tipo: "anexo" | "libro" | "otro" }] (solo http/https)
	  hayContenido(sesion)       → ¿trae algo que mostrar?
	  html(sesion)               → el bloque de HTML de la secuencia (escapado)

	La lectura de estas columnas es opcional para quien la use: si falla, la pantalla sigue.
*/

(function () {
	"use strict";

	var FASES = [
		{ clave: "inicio", titulo: "Inicio", borde: "border-l-blue-500" },
		{ clave: "desarrollo", titulo: "Desarrollo", borde: "border-l-violet-500" },
		{ clave: "cierre", titulo: "Cierre", borde: "border-l-emerald-500" },
	];

	var COLUMNAS = "id, inicio_todos, inicio_diferenciado, inicio_actividades, " +
		"desarrollo_todos, desarrollo_diferenciado, desarrollo_actividades, " +
		"cierre_todos, cierre_diferenciado, cierre_actividades, cierre_tareas, recursos";

	function texto() {
		if (typeof window !== "undefined" && window.TextoSesion) return window.TextoSesion;
		return require("./texto-sesion.js");
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// Texto legible de una actividad guardada como texto, objeto o lista; nunca JSON crudo
	function textoActividad(x) {
		if (x === null || x === undefined) return "";
		if (typeof x === "string") return x.trim();
		if (Array.isArray(x)) return x.map(textoActividad).filter(Boolean).join("; ");
		if (typeof x === "object") return textoActividad(x.descripcion || x.texto || x.actividad || x.nombre || "");
		return String(x);
	}

	function textoFase(sesion, fase) {
		var todos = sesion && sesion[fase + "_todos"] ? sesion[fase + "_todos"] : "";
		var diferenciado = sesion && sesion[fase + "_diferenciado"] ? sesion[fase + "_diferenciado"] : "";
		if (typeof todos === "string" && todos.trim()) return todos;
		if (typeof diferenciado === "string" && diferenciado.trim()) return diferenciado;
		if (typeof diferenciado === "object" && diferenciado !== null) {
			// Llave de grado → "Grado 1:"; de grupo de trabajo ("Morado") → tal cual (js/texto-sesion.js)
			var lineas = texto().lineas(diferenciado, null, "texto", textoActividad);
			if (lineas.length) return lineas.join("\n");
		}
		return "";
	}

	/*
		Las actividades llegan en varias formas: lista, texto, o el objeto de "Crear proyecto"
		{ mode, todos: [...], diferenciado: { "1": [...] } }. Las llaves de grupo de trabajo
		("Morado", "Círculos") se rotulan tal cual, después de los pasos de todo el grupo.
	*/
	function actividadesFase(sesion, fase) {
		var raw = sesion ? sesion[fase + "_actividades"] : null;
		return texto().lineasActividades(raw, textoActividad);
	}

	function tareasEnCierre(sesion) {
		var raw = sesion ? sesion.cierre_tareas : null;
		if (!raw) return [];
		if (Array.isArray(raw)) {
			return raw.map(function (x) {
				return { descripcion: typeof x === "string" ? x : (x && x.descripcion) || "Tarea", grado: x && x.grado !== undefined ? x.grado : null };
			});
		}
		if (typeof raw === "object") {
			var mode = raw.mode || "todos";
			// Modo diferenciado: { diferenciado: { "4": [...] } }; "por_grado" es alias antiguo
			var porGrado = raw.diferenciado || raw.por_grado;
			if (mode === "diferenciado" && porGrado && typeof porGrado === "object") {
				// El bot guarda cada grado como texto ("1": "Platica en casa…"), Crear proyecto como lista
				var out = [];
				texto().llavesEnOrden(porGrado, raw.orden_grupos).forEach(function (grado) {
					var lista = porGrado[grado];
					(Array.isArray(lista) ? lista : lista ? [lista] : []).forEach(function (t) {
						out.push({ descripcion: typeof t === "string" ? t : (t && t.descripcion) || "Tarea", grado: grado });
					});
				});
				return out;
			}
			var lista2 = raw.todos || raw.items || raw.tareas || [];
			return (Array.isArray(lista2) ? lista2 : [lista2]).map(function (t) {
				return { descripcion: typeof t === "string" ? t : (t && t.descripcion) || "Tarea", grado: null };
			});
		}
		return [];
	}

	function tareasCierre(sesion) {
		return tareasEnCierre(sesion).map(function (t) {
			return t.grado !== null && t.grado !== undefined ? texto().rotulo(t.grado, "corto") + ": " + t.descripcion : t.descripcion;
		});
	}

	function tipoDeEnlace(url) {
		if (/drive\.google\.com|docs\.google\.com/i.test(url)) return "anexo";
		if (/conaliteg\.(gob\.mx|sep\.gob\.mx)/i.test(url)) return "libro";
		return "otro";
	}

	function recursos(sesion) {
		var raw = sesion ? sesion.recursos : null;
		if (!raw) return [];
		var lista = raw;
		if (typeof lista === "string") {
			try { lista = JSON.parse(lista); } catch (_) { return []; }
		}
		// El jsonb puede venir como {links: [...], archivos: [...]} o como arreglo
		if (!Array.isArray(lista)) {
			lista = [].concat(lista.links || [], lista.archivos || [], (lista.url || lista.link) ? [lista] : []);
		}
		return lista.map(function (r) {
			var url = r && (r.url || r.link || r.href) || null;
			// SEGURIDAD: solo http(s). Un esquema como javascript: en un <a href> ejecutaría código.
			if (!url || !/^https?:\/\//i.test(String(url))) return null;
			return { titulo: r.nombre || r.titulo || "Abrir recurso", url: String(url), tipo: tipoDeEnlace(String(url)) };
		}).filter(Boolean);
	}

	/*
		Menciones a libros en el texto ("... de Múltiples Lenguajes de 1° (p. 100) ..."): se vuelven enlace
		al visor SOLO si la sesión ya trae ese libro entre sus enlaces y la página coincide: el enlace debe
		ser de CONALITEG, su título decir "<libro> <grado>°, p.N" y su dirección terminar en #page/N (con el
		mismo N que la mención). Sin coincidencia exacta (libro, grado y página) no se enlaza nada.
	*/
	function librosDe(sesion) {
		var salida = [];
		recursos(sesion).forEach(function (r) {
			if (r.tipo !== "libro") return;
			var mu = r.url.match(/#page\/(\d+)\s*$/);
			var mt = String(r.titulo).split("— ").pop().match(/^(.+?) (\d)°, ?p\.? ?(\d+)\s*$/);
			if (!mu || !mt || mu[1] !== mt[3]) return;
			var nombres = [mt[1]];
			if (mt[1].indexOf(": ") !== -1) nombres.push(mt[1].split(": ").pop());
			salida.push({ nombres: nombres, grado: mt[2], pagina: mt[3], url: r.url, titulo: r.titulo });
		});
		return salida;
	}
	function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

	// `htmlEscapado`: texto ya escapado (esc). Devuelve el mismo texto con los enlaces puestos
	function conEnlaces(htmlEscapado, sesion) {
		var libros = librosDe(sesion);
		if (!libros.length || !htmlEscapado) return htmlEscapado;
		var frases = libros.map(function (l) {
			return { re: new RegExp("^(?:" + l.nombres.map(function (n) { return escRe(esc(n)); }).join("|") + ") de " + l.grado + "° \\(p\\. ?" + l.pagina + "\\)$"), libro: l };
		});
		var todos = new RegExp("(?:" + libros.map(function (l) {
			return "(?:" + l.nombres.map(function (n) { return escRe(esc(n)); }).join("|") + ") de " + l.grado + "° \\(p\\. ?" + l.pagina + "\\)";
		}).join("|") + ")", "g");
		return htmlEscapado.replace(todos, function (m) {
			var f = frases.filter(function (x) { return x.re.test(m); })[0];
			if (!f) return m;
			return "<a href='" + esc(f.libro.url) + "' target='_blank' rel='noopener noreferrer' data-secuencia-libro " +
				"data-visor-url='" + esc(f.libro.url) + "' data-visor-titulo='" + esc(f.libro.titulo) + "' " +
				"class='text-blue-700 underline underline-offset-2 hover:text-blue-900'>" + m + "</a>";
		});
	}

	function hayContenido(sesion) {
		if (!sesion) return false;
		return FASES.some(function (f) { return !!textoFase(sesion, f.clave) || actividadesFase(sesion, f.clave).length > 0; }) ||
			tareasCierre(sesion).length > 0 || recursos(sesion).length > 0;
	}

	function bloqueFase(sesion, f) {
		var t = textoFase(sesion, f.clave);
		var acts = actividadesFase(sesion, f.clave);
		var tareas = f.clave === "cierre" ? tareasCierre(sesion) : [];
		var html = "<section class='border-l-4 " + f.borde + " pl-4 py-2 mb-3' data-secuencia-fase='" + f.clave + "'>" +
			"<h4 class='font-semibold text-gray-800 mb-1'>" + f.titulo + "</h4>";
		if (!t && !acts.length) {
			html += "<p class='text-sm text-gray-500'>Sin información registrada.</p>";
		} else {
			if (t) html += "<p class='text-sm text-gray-600 whitespace-pre-line mb-2'>" + conEnlaces(esc(t), sesion) + "</p>";
			if (acts.length) {
				html += "<ul class='list-disc pl-5 text-sm text-gray-600 mb-2'>" +
					acts.map(function (a) { return "<li>" + conEnlaces(esc(a), sesion) + "</li>"; }).join("") + "</ul>";
			}
		}
		if (tareas.length) {
			html += "<p class='text-sm font-medium text-gray-700'>Tareas del cierre:</p>" +
				"<ul class='list-disc pl-5 text-sm text-gray-600'>" +
				tareas.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
		}
		return html + "</section>";
	}

	function grupoEnlaces(titulo, lista) {
		if (!lista.length) return "";
		return "<div class='mb-2'><p class='text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1'>" + titulo + "</p>" +
			"<div class='flex flex-wrap gap-2'>" + lista.map(function (r) {
				// Con js/visor-recursos.js un toque normal lo abre en el visor (data-visor-url); sin él, o con
				// Ctrl/Cmd, se abre en otra pestaña (rel noopener). Son enlaces externos: no aplica lo relativo
				return "<a href='" + esc(r.url) + "' target='_blank' rel='noopener noreferrer' data-secuencia-enlace='" + r.tipo + "' " +
					"data-visor-url='" + esc(r.url) + "' data-visor-titulo='" + esc(r.titulo) + "' " +
					"class='inline-flex items-center min-h-[44px] text-sm border border-amber-300 text-amber-800 px-3 rounded-lg hover:bg-amber-50'>" +
					esc(r.titulo) + "</a>";
			}).join("") + "</div></div>";
	}

	function html(sesion) {
		if (!sesion) return "";
		var out = FASES.map(function (f) { return bloqueFase(sesion, f); }).join("");
		var rec = recursos(sesion);
		if (rec.length) {
			out += "<section class='border-l-4 border-l-amber-500 pl-4 py-2 mb-1' data-secuencia-fase='recursos'>" +
				"<h4 class='font-semibold text-gray-800 mb-2'>Anexos y libros</h4>" +
				grupoEnlaces("Anexos", rec.filter(function (r) { return r.tipo === "anexo"; })) +
				grupoEnlaces("Libros de texto", rec.filter(function (r) { return r.tipo === "libro"; })) +
				grupoEnlaces("Otros enlaces", rec.filter(function (r) { return r.tipo === "otro"; })) +
				"</section>";
		}
		return out;
	}

	var api = {
		COLUMNAS: COLUMNAS, textoFase: textoFase, actividadesFase: actividadesFase, tareasCierre: tareasCierre,
		recursos: recursos, hayContenido: hayContenido, html: html, librosDe: librosDe, conEnlaces: conEnlaces,
	};
	if (typeof window !== "undefined") window.SecuenciaSesion = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
