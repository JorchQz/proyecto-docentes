/*
	para-quien.js — "¿Para quién?" de un trabajo o una tarea, compartido por las pantallas
	(decisión de Jorge del 2026-09-26: todo el grupo, grados o alumnos marcados).

	La regla de quién recibe un producto es UNA (AlcanceHoy.asignadoA; en SQL,
	alumno_recibe_producto de mi_salon_b17): su grado está en productos_sesion.grados y no está
	excluido, o está incluido (producto_sesion_alumnos). Editar "para quién" de un producto no
	cambia sus grados: se guarda como filas incluir / excluir (ProductosHoy.filasDeEdicion) con la
	RPC guardar_asignacion_producto, que rechaza quitar a quien ya tiene calificación.

	Arriba, reglas puras (pruebas/para-quien-planeacion.test.js):
	  ParaQuien.renglonesDeSesion(ses, gradosProyecto, productos, { soloConProducto })
	    → { renglones: [{ clave, hueco, producto, grados, etiqueta }], deHoy, extras }
	    Lo que la sesión materializa (SesionesMaterializar.emparejarPlan: la MISMA regla del
	    materializador) con su producto si ya existe. extras: los productos activos de la sesión que
	    no son del plan (se agregaron en Hoy o en la vista del proyecto, o son de un grupo de trabajo);
	    deHoy: cuántos son. Crear proyecto los lista de solo lectura y se gestionan en la vista del
	    proyecto (proyecto.html) o en Hoy.
	  ParaQuien.quienHace(producto, asignacion, alumnos) → { texto, n, alumnos, porNombre, resumen }
	    "1° (todos)" o los nombres de quienes lo hacen ("ANA, LUIS"): la vista del proyecto y Crear proyecto.
	    La clave es la del materializador (tipo, grados y, en tareas, nombre) más el número de
	    repetición: si la maestra cambia el texto de una tarea o los grados, la clave cambia y ese
	    renglón vuelve al predeterminado (los alumnos de su grado).
	  ParaQuien.quierenPorOmision(grados, alumnos, asignacion) → { alumnoId: true }
	  ParaQuien.bloqueados(productoId, alumnos, calificaciones) → { alumnoId: true } (con captura)
	  ParaQuien.asignacionDe(grados, alumnos, quieren) → { alumnoId: modo } (filasDeEdicion)
	  ParaQuien.resumen(grados, asignacion, alumnos) → "3° (todos)", "3° (sin 1 alumno)",
	    "3° + 2 alumnos de 2°", "2 alumnos de 2°"
	Abajo, el diálogo accesible (role="dialog", foco atrapado, Esc cierra, el foco vuelve al botón):
	  ParaQuien.abrirDialogo({ origen, titulo, subtitulo, aceptar, construir(cuerpo), alAceptar(form, avisar) })
	    Opcionales: cancelar (el texto del botón de salida; "Cancelar" por omisión), peligro (el botón de
	    aceptar en rojo), textoError(err) (cómo se explica un error que lance alAceptar; por omisión su
	    mensaje) y alCerrar(). Desde la Fase 4 (2026-09-29) es el MISMO diálogo de Hoy (js/hoy.js y
	    js/actividad-nueva.js) y de Crear proyecto.
	  ParaQuien.listaAlumnosHtml(alumnos, nombre, marcados, bloqueados)
	  ParaQuien.elegir({ origen, titulo, subtitulo, alumnos, marcados, bloqueados, aceptar, alGuardar(quieren, avisar) })
	    Una casilla bloqueada (ya tiene calificación) cuenta como marcada. alGuardar puede ser
	    async y devolver false para dejar el diálogo abierto (con el aviso que puso).

	Requiere js/productos-hoy.js y js/alcance-hoy.js (y, para renglonesDeSesion,
	js/sesiones-materializar.js) cargados antes.
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;

	function PH() {
		if (!raiz.ProductosHoy) throw new Error("Falta cargar js/productos-hoy.js.");
		return raiz.ProductosHoy;
	}
	function SM() {
		if (!raiz.SesionesMaterializar) throw new Error("Falta cargar js/sesiones-materializar.js.");
		return raiz.SesionesMaterializar;
	}

	function gradosOrdenados(lista) { return PH().gradosOrdenados(lista); }

	// La misma regla que AlcanceHoy.asignadoA (si está cargado, se usa ese)
	function asignadoA(alumno, grados, asignacion) {
		var producto = { id: "_", grados: grados };
		if (raiz.AlcanceHoy && raiz.AlcanceHoy.asignadoA) return raiz.AlcanceHoy.asignadoA(alumno, producto, { _: asignacion || {} });
		var modo = (asignacion || {})[alumno.id];
		if (modo === "incluir") return true;
		if (modo === "excluir") return false;
		return grados.map(Number).indexOf(Number(alumno.grado)) !== -1;
	}

	function claveHueco(h) {
		return h.tipo + "|" + gradosOrdenados(h.grados).join(",") + "|" + (h.tipo === "tarea" ? String(h.nombre || "").trim() : "");
	}

	// "Trabajo de 3°" · "Tarea: Traer una hoja"
	function etiquetaHueco(h) {
		if (h.tipo === "tarea") return "Tarea: " + String(h.nombre || "").trim();
		var g = PH().etiquetaGrados(h.grados);
		return g ? "Trabajo de " + g : "Trabajo";
	}

	function renglonesDeSesion(ses, gradosProyecto, productos, opts) {
		opts = opts || {};
		var deSesion = (productos || []).filter(function (p) { return p && (!ses || !ses.id || !p.sesion_id || p.sesion_id === ses.id); });
		var pares = SM().emparejarPlan(ses, gradosProyecto, deSesion);
		var vistas = {}, usados = {}, renglones = [];
		pares.forEach(function (par) {
			var base = claveHueco(par.hueco);
			vistas[base] = (vistas[base] || 0) + 1;
			if (par.producto) usados[par.producto.id] = true;
			// Un producto que se quitó en Hoy (activo = false) ya no se ve en ningún lado
			if (par.producto && par.producto.activo === false) return;
			if (!par.producto && opts.soloConProducto) return;
			renglones.push({
				clave: base + "|" + vistas[base],
				hueco: par.hueco,
				producto: par.producto,
				grados: gradosOrdenados(par.producto ? par.producto.grados : par.hueco.grados),
				etiqueta: etiquetaHueco(par.hueco),
			});
		});
		// Los activos que no son del plan (agregados en Hoy o en la vista del proyecto, o por grupo de trabajo), en
		// el orden en que llegaron. deHoy es cuántos son (se conserva: Crear proyecto los contaba así)
		var extras = deSesion.filter(function (p) { return !usados[p.id] && p.activo !== false; });
		return { renglones: renglones, deHoy: extras.length, extras: extras };
	}

	/*
		Quién hace un producto, para leerlo en una lista (la vista del proyecto y Crear proyecto; Fase 5, 2026-09-30:
		"Tarjeta de nombre · Morado: Angela, Dilan"). La regla de quién lo recibe es la de siempre (asignadoA).
		  - todo un grado (o varios) sin cambios → el resumen: "1° (todos)", "1° y 2° (todos)";
		  - si no (alumnos elegidos uno por uno, un grado sin alguno o con alumnos de otro grado) → los nombres de
		    quienes lo hacen, en el orden de la lista (OrdenLista si está cargado: por grado y nombre);
		  - nadie → el resumen ("Nadie", "4° (no hay alumnos de ese grado en el grupo)").
		→ { texto, n (cuántos lo hacen: para el material), alumnos, porNombre, resumen }
	*/
	function quienHace(producto, asignacion, alumnos) {
		var g = gradosOrdenados(producto && producto.grados);
		var lista = (alumnos || []).filter(function (a) { return a && a.id && asignadoA(a, g, asignacion); });
		if (raiz.OrdenLista && raiz.OrdenLista.ordenar) lista = raiz.OrdenLista.ordenar(lista);
		var r = resumen(g, asignacion, alumnos);
		var todos = / \(todos\)$/.test(r);
		var porNombre = lista.length > 0 && !todos;
		return {
			texto: porNombre ? lista.map(function (a) { return String(a.nombre_completo || "").trim(); }).join(", ") : r,
			n: lista.length, alumnos: lista, porNombre: porNombre, resumen: r,
		};
	}

	function quierenPorOmision(grados, alumnos, asignacion) {
		var g = gradosOrdenados(grados);
		var q = {};
		(alumnos || []).forEach(function (a) { if (a && a.id && asignadoA(a, g, asignacion)) q[a.id] = true; });
		return q;
	}

	// calificaciones: { "alumnoId|productoId": fila } (fila con estado_entrega, nivel, puntaje, retroalimentacion)
	function bloqueados(productoId, alumnos, calificaciones) {
		var b = {};
		if (!productoId) return b;
		(alumnos || []).forEach(function (a) {
			if (a && a.id && PH().tieneCaptura((calificaciones || {})[a.id + "|" + productoId])) b[a.id] = true;
		});
		return b;
	}

	function indiceCalificaciones(filas) {
		var idx = {};
		(filas || []).forEach(function (c) { if (c && c.alumno_id && c.producto_sesion_id) idx[c.alumno_id + "|" + c.producto_sesion_id] = c; });
		return idx;
	}

	function asignacionDe(grados, alumnos, quieren) {
		var idx = {};
		PH().filasDeEdicion(grados, alumnos, quieren).forEach(function (f) { idx[f.alumno_id] = f.modo; });
		return idx;
	}

	// ¿Dos asignaciones dicen lo mismo para estos alumnos? (para no marcar "por guardar" en balde)
	function mismaAsignacion(grados, alumnos, a, b) {
		var q1 = quierenPorOmision(grados, alumnos, a), q2 = quierenPorOmision(grados, alumnos, b);
		return (alumnos || []).every(function (al) { return !!q1[al.id] === !!q2[al.id]; });
	}

	function resumen(grados, asignacion, alumnos) {
		var g = gradosOrdenados(grados);
		var base = PH().etiquetaGrados(g);
		var a = asignacion || {};
		var hay = 0, sin = 0, inc = [];
		(alumnos || []).forEach(function (al) {
			var suGrado = g.indexOf(Number(al.grado)) !== -1;
			if (suGrado) hay++;
			if (suGrado && a[al.id] === "excluir") sin++;
			if (!suGrado && a[al.id] === "incluir") inc.push(al);
		});
		var deOtros = inc.length ? inc.length + (inc.length === 1 ? " alumno de " : " alumnos de ") + PH().etiquetaGrados(inc.map(function (x) { return x.grado; })) : "";
		if (!sin && !inc.length) return hay ? base + " (todos)" : base + " (no hay alumnos de " + (g.length > 1 ? "esos grados" : "ese grado") + " en el grupo)";
		if (hay && sin === hay) return deOtros || "Nadie";
		return PH().resumenPara({ grados: g }, a, alumnos);
	}

	// ── Diálogo ──────────────────────────────────────────────────────────────────
	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function agruparPorGrado(lista) {
		var grupos = {};
		(lista || []).forEach(function (a) { (grupos[a.grado] = grupos[a.grado] || []).push(a); });
		return Object.keys(grupos).sort(function (x, y) { return Number(x) - Number(y); })
			.map(function (g) { return { grado: g, alumnos: grupos[g] }; });
	}

	// Casillas de los alumnos, por grado. marcados / bloqueados: { alumnoId: true }
	function listaAlumnosHtml(alumnos, nombre, marcados, bloqueados) {
		return "<div class='max-h-72 overflow-y-auto rounded-xl border border-gray-200 p-2 flex flex-col gap-1'>" +
			agruparPorGrado(alumnos).map(function (g) {
				return "<p class='text-xs font-semibold text-gray-500 mt-1'>" + esc(g.grado) + "° grado</p>" +
					"<div class='grid grid-cols-1 sm:grid-cols-2 gap-1'>" + g.alumnos.map(function (a) {
						var bloq = bloqueados && bloqueados[a.id];
						return "<label class='flex items-center gap-3 min-h-[44px] rounded-lg px-2 cursor-pointer hover:bg-gray-50 has-[:checked]:bg-blue-50'>" +
							"<input type='checkbox' name='" + esc(nombre) + "' value='" + esc(a.id) + "'" + ((marcados && marcados[a.id]) || bloq ? " checked" : "") +
							(bloq ? " disabled" : "") + " class='h-5 w-5 text-blue-600 rounded shrink-0'>" +
							"<span class='text-sm text-gray-800 min-w-0 break-words'>" + esc(a.nombre_completo) +
							(bloq ? "<span class='block text-xs text-gray-500'>Ya tiene calificación: no se puede quitar</span>" : "") + "</span></label>";
					}).join("") + "</div>";
			}).join("") + "</div>";
	}

	var numeroDialogo = 0;
	function abrirDialogo(opciones) {
		var previo = opciones.origen || document.activeElement;
		var id = "pqDialogo" + (++numeroDialogo);
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
		titulo.className = "text-lg font-bold text-gray-800 break-words";
		titulo.textContent = opciones.titulo;
		cabeza.appendChild(titulo);
		if (opciones.subtitulo) {
			var sub = document.createElement("p");
			sub.id = id + "-sub";
			sub.className = "text-sm text-gray-500 mt-1";
			sub.textContent = opciones.subtitulo;
			cabeza.appendChild(sub);
			caja.setAttribute("aria-describedby", sub.id);
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

		/*
			El aviso va al final del cuerpo: en un diálogo largo (o a 390 px) quedaba abajo del borde. Se desplaza a la
			vista dentro del diálogo; el foco va al campo que hay que corregir sin mover lo que se ve (el aviso dice qué).
		*/
		function avisar(texto, foco) {
			aviso.textContent = texto || "";
			aviso.classList.toggle("hidden", !texto);
			if (foco && foco.focus) {
				try { foco.focus({ preventScroll: true }); } catch (_) { foco.focus(); }
			}
			if (texto && aviso.scrollIntoView) aviso.scrollIntoView({ block: "nearest" });
		}
		function cerrar() {
			document.removeEventListener("keydown", teclas, true);
			if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
			if (previo && previo.focus && document.body.contains(previo)) previo.focus();
			if (opciones.alCerrar) opciones.alCerrar();
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
			if (!caja.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? ultimo : primero).focus(); return; }
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
				console.error("para-quien: diálogo", err);
				avisar("No se pudo guardar: " + (opciones.textoError ? opciones.textoError(err) : ((err && err.message) || "error desconocido")) + ".");
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

	function elegir(o) {
		var nombre = "pqAlumno";
		var lista = null;
		return abrirDialogo({
			origen: o.origen,
			titulo: o.titulo || "¿Para quién es?",
			subtitulo: o.subtitulo || "Marca a los alumnos que la hacen. Cada uno sigue en su grado para la boleta.",
			aceptar: o.aceptar || "Guardar",
			alCerrar: o.alCerrar,
			construir: function (cuerpo) {
				lista = document.createElement("div");
				lista.innerHTML = listaAlumnosHtml(o.alumnos, nombre, o.marcados, o.bloqueados);
				cuerpo.appendChild(lista);
			},
			alAceptar: async function (form, avisar) {
				var quieren = {};
				Array.from(lista.querySelectorAll("input[name='" + nombre + "']")).forEach(function (c) {
					// Una casilla bloqueada (ya tiene calificación) se queda como estaba: marcada
					if (c.checked || c.disabled) quieren[c.value] = true;
				});
				if (!Object.keys(quieren).length) { avisar("Marca al menos un alumno.", lista.querySelector("input:not([disabled])")); return false; }
				return o.alGuardar(quieren, avisar);
			},
		});
	}

	var api = {
		claveHueco: claveHueco, etiquetaHueco: etiquetaHueco, renglonesDeSesion: renglonesDeSesion,
		quierenPorOmision: quierenPorOmision, bloqueados: bloqueados, indiceCalificaciones: indiceCalificaciones,
		asignacionDe: asignacionDe, mismaAsignacion: mismaAsignacion, resumen: resumen, quienHace: quienHace,
		esc: esc, listaAlumnosHtml: listaAlumnosHtml, abrirDialogo: abrirDialogo, elegir: elegir,
	};
	raiz.ParaQuien = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
