/*
	lista-pegada.js — "Pegar la lista" de alumnos (registro histórico, spec §4.1 paso 1). Lo usan
	el alta (onboarding.html) y el asistente Ponte al día (ponte-al-dia.html).

	El docente pega la lista de Excel, Word o WhatsApp (un alumno por renglón), revisa cómo se
	separó cada nombre (apellido paterno, materno y nombre(s)), la corrige si hace falta y, en
	multigrado, pone el grado de cada alumno (uno por uno o a varios a la vez: marca los renglones
	y toca el grado). Las reglas viven en js/historico.js (parsearLista, revisarFila, listaLista);
	aquí solo la pantalla.

	ListaPegada.montar(contenedor, opciones) → { filas(), limpiar() }
	opciones = {
	  grados:      [1..6] del grupo (con uno solo, todos van a ese grado)
	  existentes:  nombres completos que ya tiene el grupo (para no duplicar)
	  textoBoton:  function (n) → texto del botón de confirmar
	  alConfirmar: async function (filas) → lo que hace el que llama (agregar o guardar); si lanza,
	               se avisa y la lista se queda como está
	}
	filas: [{ nombre_completo, grado }]
*/

(function () {
	"use strict";

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	var BTN_PRI = "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed";
	var BTN_SEC = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed";
	var INPUT = "block w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-base uppercase focus:outline-none focus:ring-2 focus:ring-blue-600";

	var contador = 0;

	function montar(padre, opciones) {
		opciones = opciones || {};
		// Montar otra vez (cambió el grupo) reemplaza todo, también sus escuchas
		padre.innerHTML = "";
		var contenedor = document.createElement("div");
		padre.appendChild(contenedor);
		// existentes puede ser una lista o una función (la lista de hoy del que llama)
		function existentes() {
			return typeof opciones.existentes === "function" ? (opciones.existentes() || []) : (opciones.existentes || []);
		}
		var H = window.Historico;
		var id = "lp" + (++contador);
		var grados = (opciones.grados || []).map(Number).sort(function (a, b) { return a - b; });
		var multigrado = grados.length > 1;
		var filas = [];
		var orden = "auto";
		var ordenUsado = "apellidos";
		var marcadas = {};

		contenedor.innerHTML =
			"<div class='flex flex-col gap-3' data-lista-pegada>" +
			"<label for='" + id + "Texto' class='text-sm font-semibold text-gray-800'>Pega aquí tu lista (un alumno por renglón)</label>" +
			"<textarea id='" + id + "Texto' rows='7' class='w-full rounded-xl border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600' " +
			"placeholder='PÉREZ LÓPEZ JUAN CARLOS&#10;DE LA CRUZ NÚÑEZ MARÍA JOSÉ&#10;...'></textarea>" +
			"<p class='text-xs text-gray-500 leading-relaxed'>Cópiala de Excel, Word o WhatsApp. Puede traer el número de lista y el grado " +
			(multigrado ? "(una columna, «3°» al final o un renglón como «3° GRADO» antes de los alumnos de ese grado)" : "") +
			". Los nombres quedan en MAYÚSCULAS con acentos y Ñ; antes de guardar revisas cómo se separó cada uno.</p>" +
			"<div class='flex flex-wrap gap-2'><button type='button' data-lp-revisar class='" + BTN_PRI + "'>Revisar la lista</button></div>" +
			"<div data-lp-revision class='hidden flex flex-col gap-3'></div>" +
			"<p data-lp-mensaje class='hidden text-sm rounded-lg px-3 py-2' role='status'></p>" +
			"</div>";

		var texto = contenedor.querySelector("textarea");
		var revision = contenedor.querySelector("[data-lp-revision]");
		var mensajeEl = contenedor.querySelector("[data-lp-mensaje]");

		function mensaje(tipo, t) {
			mensajeEl.textContent = t || "";
			mensajeEl.className = t ? "text-sm rounded-lg px-3 py-2 " + (tipo === "error" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900") : "hidden";
		}

		function leer() {
			var r = H.parsearLista(texto.value, { orden: orden, grados: grados, existentes: existentes() });
			filas = r.filas;
			ordenUsado = r.orden;
			marcadas = {};
			if (!filas.length) {
				revision.classList.add("hidden");
				revision.innerHTML = "";
				mensaje("error", "No encontramos nombres en lo que pegaste. Revisa que sea un alumno por renglón.");
				return;
			}
			mensaje(null);
			pintar();
		}

		function opcionesGrado(sel) {
			return "<option value=''" + (sel ? "" : " selected") + ">Grado</option>" + grados.map(function (g) {
				return "<option value='" + g + "'" + (Number(sel) === g ? " selected" : "") + ">" + g + "°</option>";
			}).join("");
		}

		function pintar() {
			var barra = "<div class='flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2'>" +
				"<p class='text-sm font-semibold text-gray-800' data-lp-resumen></p>" +
				"<div class='flex flex-wrap items-center gap-2' role='radiogroup' aria-label='Orden de la lista'>" +
				"<span class='text-xs text-gray-600'>La lista empieza por:</span>" +
				["apellidos", "nombre"].map(function (o) {
					var activo = ordenUsado === o;
					return "<button type='button' role='radio' aria-checked='" + activo + "' data-lp-orden='" + o + "' class='min-h-[44px] px-3 rounded-xl text-sm font-semibold " +
						(activo ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200") + "'>" + (o === "apellidos" ? "Apellidos" : "Nombre") + "</button>";
				}).join("") + "</div></div>";
			var grupal = multigrado
				? "<div class='rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 flex flex-col gap-2'>" +
					"<p class='text-xs text-blue-900'>Grado a varios a la vez: marca los renglones y toca el grado.</p>" +
					"<div class='flex flex-wrap gap-2'>" +
					"<button type='button' data-lp-marcar-sin class='" + BTN_SEC + "'>Marcar los que no tienen grado</button>" +
					"<button type='button' data-lp-desmarcar class='" + BTN_SEC + "'>Desmarcar</button>" +
					grados.map(function (g) {
						return "<button type='button' data-lp-poner='" + g + "' class='min-h-[44px] min-w-[44px] px-3 rounded-xl bg-white border border-blue-300 text-sm font-bold text-blue-800 hover:bg-blue-100'>Poner " + g + "°</button>";
					}).join("") + "</div></div>"
				: "";
			var lista = "<ol class='flex flex-col gap-2' data-lp-filas>" + filas.map(function (f, i) {
				return "<li class='rounded-xl border border-gray-200 p-2 sm:p-3' data-lp-fila='" + i + "'>" +
					"<div class='flex items-start gap-2'>" +
					(multigrado
						? "<label class='shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] -m-1 cursor-pointer' title='Marcar para poner el grado'>" +
							"<input type='checkbox' data-lp-marca='" + i + "' class='h-5 w-5 accent-blue-700' aria-label='Marcar renglón " + (i + 1) + "'></label>"
						: "") +
					"<span class='shrink-0 w-6 pt-3 text-xs text-gray-400 text-right'>" + (i + 1) + "</span>" +
					"<div class='min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-" + (multigrado ? "4" : "3") + " gap-2'>" +
					campo(i, "apellido1", "Apellido paterno", f.apellido1) +
					campo(i, "apellido2", "Apellido materno", f.apellido2) +
					campo(i, "nombres", "Nombre(s)", f.nombres) +
					(multigrado
						? "<label class='flex flex-col gap-0.5'><span class='text-[11px] text-gray-500'>Grado</span>" +
							"<select data-lp-grado='" + i + "' class='min-h-[44px] rounded-lg border border-gray-300 px-2 text-base bg-white'>" + opcionesGrado(f.grado) + "</select></label>"
						: "") +
					"</div>" +
					"<button type='button' data-lp-quitar='" + i + "' class='shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl text-gray-500 hover:bg-red-50 hover:text-red-700' aria-label='Quitar renglón " + (i + 1) + "'>" +
					"<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M18 6 6 18M6 6l12 12'/></svg></button>" +
					"</div>" +
					"<p class='mt-1 text-xs text-gray-400 truncate' title='" + esc(f.original) + "'>Renglón " + f.linea + ": " + esc(f.original) + "</p>" +
					"<p class='hidden mt-1 text-xs font-semibold' data-lp-error='" + i + "'></p>" +
					"</li>";
			}).join("") + "</ol>";
			revision.innerHTML = barra + grupal + lista +
				"<div class='flex flex-col sm:flex-row sm:items-center gap-2 pt-1'>" +
				"<button type='button' data-lp-confirmar class='" + BTN_PRI + "'></button>" +
				"<p class='text-xs text-gray-600' data-lp-falta></p></div>";
			revision.classList.remove("hidden");
			validar();
		}

		function campo(i, k, etiqueta, valor) {
			return "<label class='flex flex-col gap-0.5'><span class='text-[11px] text-gray-500'>" + etiqueta + "</span>" +
				"<input type='text' data-lp-campo='" + k + "' data-lp-i='" + i + "' value='" + esc(valor) + "' maxlength='80' autocomplete='off' class='" + INPUT + "'></label>";
		}

		// Revisa todas las filas (duplicados entre ellas) y pinta errores y el botón
		function validar() {
			var vistos = {};
			existentes().forEach(function (n) { vistos[window.NombresAlumno ? window.NombresAlumno.clave(n) : n] = "existente"; });
			filas.forEach(function (f) { H.revisarFila(f, vistos); });
			var estado = H.listaLista(filas, grados);
			filas.forEach(function (f, i) {
				var el = revision.querySelector("[data-lp-error='" + i + "']");
				var li = revision.querySelector("[data-lp-fila='" + i + "']");
				var sinGrado = multigrado && grados.indexOf(Number(f.grado)) === -1;
				var t = f.error || (sinGrado ? "Elige su grado" : (f.dudoso ? "Revisa cómo se separó el nombre" : ""));
				if (el) {
					el.textContent = t;
					el.className = t ? "mt-1 text-xs font-semibold " + (f.error || sinGrado ? "text-red-700" : "text-amber-700") : "hidden";
				}
				if (li) li.className = "rounded-xl border p-2 sm:p-3 " + (f.error || sinGrado ? "border-red-300 bg-red-50/40" : (f.dudoso ? "border-amber-300" : "border-gray-200"));
			});
			var resumen = revision.querySelector("[data-lp-resumen]");
			if (resumen) resumen.textContent = filas.length + (filas.length === 1 ? " alumno leído" : " alumnos leídos") +
				(estado.conError || estado.faltanGrado ? " · por corregir: " + (estado.conError + estado.faltanGrado) : "");
			var boton = revision.querySelector("[data-lp-confirmar]");
			if (boton) {
				boton.textContent = opciones.textoBoton ? opciones.textoBoton(filas.length) : "Agregar " + filas.length + " alumnos";
				boton.disabled = !estado.ok;
			}
			var falta = revision.querySelector("[data-lp-falta]");
			if (falta) {
				var partes = [];
				if (estado.faltanGrado) partes.push(estado.faltanGrado + (estado.faltanGrado === 1 ? " sin grado" : " sin grado"));
				if (estado.conError) partes.push(estado.conError + (estado.conError === 1 ? " renglón por corregir" : " renglones por corregir"));
				falta.textContent = partes.length ? "Falta: " + partes.join(" y ") + "." : "";
			}
			return estado;
		}

		contenedor.addEventListener("click", async function (e) {
			var b = e.target.closest("button");
			if (!b || !contenedor.contains(b)) return;
			if (b.hasAttribute("data-lp-revisar")) { leer(); return; }
			if (b.dataset.lpOrden) { orden = b.dataset.lpOrden; leer(); return; }
			if (b.dataset.lpQuitar !== undefined) {
				filas.splice(Number(b.dataset.lpQuitar), 1);
				if (!filas.length) { revision.classList.add("hidden"); revision.innerHTML = ""; return; }
				pintar();
				return;
			}
			if (b.hasAttribute("data-lp-marcar-sin")) {
				filas.forEach(function (f, i) {
					var cb = revision.querySelector("[data-lp-marca='" + i + "']");
					if (cb) cb.checked = grados.indexOf(Number(f.grado)) === -1;
				});
				return;
			}
			if (b.hasAttribute("data-lp-desmarcar")) {
				revision.querySelectorAll("[data-lp-marca]").forEach(function (cb) { cb.checked = false; });
				return;
			}
			if (b.dataset.lpPoner) {
				var g = Number(b.dataset.lpPoner), n = 0;
				revision.querySelectorAll("[data-lp-marca]").forEach(function (cb) {
					if (!cb.checked) return;
					var i = Number(cb.dataset.lpMarca);
					filas[i].grado = g;
					var sel = revision.querySelector("[data-lp-grado='" + i + "']");
					if (sel) sel.value = String(g);
					cb.checked = false;
					n++;
				});
				mensaje(n ? "ok" : "error", n ? "Se puso " + g + "° a " + n + (n === 1 ? " alumno." : " alumnos.") : "Primero marca los renglones a los que quieres poner " + g + "°.");
				validar();
				return;
			}
			if (b.hasAttribute("data-lp-confirmar")) {
				if (!validar().ok) return;
				b.disabled = true;
				var original = b.textContent;
				b.textContent = "Guardando...";
				try {
					await opciones.alConfirmar(filas.map(function (f) {
						return { nombre_completo: f.nombreCompleto, grado: multigrado ? Number(f.grado) : (grados[0] || null) };
					}));
				} catch (err) {
					console.error("lista pegada:", err);
					mensaje("error", (err && err.humano ? err.message : "No se pudo guardar la lista: " + ((err && err.message) || "error desconocido")) + " Tu lista sigue aquí.");
					b.textContent = original;
					b.disabled = false;
				}
			}
		});

		contenedor.addEventListener("input", function (e) {
			var inp = e.target.closest("input[data-lp-campo]");
			if (!inp || e.isComposing) return;
			var pos = inp.selectionStart;
			var v = window.NombresAlumno ? window.NombresAlumno.formatear(inp.value, true) : inp.value.toUpperCase();
			if (v !== inp.value) { inp.value = v; try { inp.setSelectionRange(pos, pos); } catch (err) { /* sin cursor */ } }
			var f = filas[Number(inp.dataset.lpI)];
			if (f) { f[inp.dataset.lpCampo] = inp.value; f.dudoso = false; }
			validar();
		});
		contenedor.addEventListener("change", function (e) {
			var sel = e.target.closest("select[data-lp-grado]");
			if (!sel) return;
			var f = filas[Number(sel.dataset.lpGrado)];
			if (f) f.grado = sel.value ? Number(sel.value) : null;
			validar();
		});

		return {
			filas: function () { return filas.slice(); },
			limpiar: function () { texto.value = ""; filas = []; revision.innerHTML = ""; revision.classList.add("hidden"); mensaje(null); },
			mensaje: mensaje,
		};
	}

	var api = { montar: montar };
	if (typeof window !== "undefined") window.ListaPegada = api;
})();
