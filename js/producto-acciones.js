/*
	producto-acciones.js — Renombrar y Quitar una actividad o una tarea ya creada (un producto de una sesión).
	Lo comparten Hoy (js/hoy.js) y la vista del proyecto (js/proyecto.js; Fase 5 del plan de Fanny, 2026-09-30):
	el código se sacó tal cual de renombrarProducto y quitarProducto de Hoy, con las mismas reglas y los mismos
	textos. Lo que cada pantalla hace antes y después (qué tiene capturado, cómo se vuelve a dibujar y dónde avisa)
	llega en `o`.

	  - Renombrar: el nombre pasa por ProductosHoy.validarNombre; un nombre igual no escribe nada.
	  - Quitar (activo = false: ya no se califica ni cuenta en el motor, "Qué le falta" ni los reportes): solo si
	    nadie lo ha calificado. Se revisa DOS veces: al tocar (lo capturado en la pantalla, también lo pendiente de
	    enviar, y la base) y otra vez justo antes de escribir (mientras el diálogo estuvo abierto, otra pestaña u otro
	    aparato pudo calificarlo: R25a-r09). La base también lo rechaza (trigger productos_sesion_no_quitar_calificado,
	    mi_salon_b17, con la pista "producto_con_calificaciones") y entonces se avisa «Mientras decidías…».
	  - Las dos necesitan señal (no van por la cola: la captura de sus calificaciones necesita el id de la base).

	ProductoAcciones.renombrar(o) · ProductoAcciones.quitar(o) (asíncrona). o:
	  sb, maestroId, producto { id, nombre, tipo, grados }, origen (el botón que lo abrió)
	  sinSenal()        ¿hay señal? (Hoy mira también la cola)
	  textoSinSenal     "Esto necesita señal. …" (lo que se dice dentro del diálogo)
	  textoError(err)   cómo se explica un error de la base
	  avisoALaVista(t)  un aviso de error que la pantalla deja a la vista
	  mensaje(tipo, t)  el mensaje de la pantalla ("info" | "error")
	  alRenombrar(nombre)  la pantalla ya tiene el nombre nuevo en producto.nombre: que se vuelva a dibujar
	  conCaptura()      (quitar) ¿alguien tiene algo capturado en ESTA pantalla? (sin la función: nadie)
	  alQuitar()        (quitar) la pantalla lo saca de sus listas y se vuelve a dibujar
	Requiere js/para-quien.js (el diálogo accesible) y js/productos-hoy.js.
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;

	function PH() {
		if (!raiz.ProductosHoy) throw new Error("Falta cargar js/productos-hoy.js.");
		return raiz.ProductosHoy;
	}
	function PQ() {
		if (!raiz.ParaQuien) throw new Error("Falta cargar js/para-quien.js.");
		return raiz.ParaQuien;
	}

	// "Esto necesita señal. Lo que ya capturaste…" → "Lo que ya capturaste…" (para "Renombrar necesita señal. …")
	function restoSinSenal(texto) {
		return String(texto || "").replace("Esto necesita señal. ", "");
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

	// Los textos de los avisos de Quitar (los mismos de Hoy desde b17 y R25a)
	function avisoConCalificaciones(nombre) {
		return "«" + nombre + "» ya tiene calificaciones, así que no se puede quitar. Si el nombre no es el correcto, usa Renombrar.";
	}
	function avisoCarrera(nombre) {
		return "Mientras decidías, se calificó «" + nombre + "»; no se quitó. Recarga la página para ver esa calificación.";
	}

	function renombrar(o) {
		var producto = o.producto;
		if (!producto) return;
		var sinSenal = o.sinSenal, TEXTO_SIN_SENAL = o.textoSinSenal;
		if (sinSenal()) { o.avisoALaVista("Renombrar necesita señal. " + restoSinSenal(TEXTO_SIN_SENAL)); return; }
		var refs = {};
		return PQ().abrirDialogo({
			origen: o.origen,
			textoError: o.textoError,
			titulo: "Renombrar",
			subtitulo: (producto.tipo === "tarea" ? "Tarea" : "Actividad") + " para " + PH().etiquetaGrados(producto.grados),
			aceptar: "Guardar nombre",
			construir: function (cuerpo) {
				var n = campoTexto("Nombre", { type: "text", maxlength: String(PH().NOMBRE_MAX), autocomplete: "off", "data-foco": "1" });
				n.input.value = producto.nombre || "";
				refs.nombre = n.input;
				cuerpo.appendChild(n.cont);
			},
			alAceptar: async function (form, avisar) {
				var v = PH().validarNombre(refs.nombre.value);
				if (!v.ok) { avisar(v.error, refs.nombre); return false; }
				if (v.nombre === producto.nombre) return;
				if (sinSenal()) { avisar(TEXTO_SIN_SENAL); return false; }
				var res = await o.sb.from("productos_sesion").update({ nombre: v.nombre })
					.eq("id", producto.id).eq("maestro_id", o.maestroId);
				if (res.error) {
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo renombrar: " + o.textoError(res.error) + ".");
					return false;
				}
				producto.nombre = v.nombre;
				if (o.alRenombrar) o.alRenombrar(v.nombre);
				o.mensaje("info", "Nombre guardado: «" + v.nombre + "».");
			},
		});
	}

	async function quitar(o) {
		var producto = o.producto;
		if (!producto) return;
		var sinSenal = o.sinSenal, TEXTO_SIN_SENAL = o.textoSinSenal, origen = o.origen;
		// Con captura en la pantalla (en Hoy, también lo pendiente de enviar)
		function conCapturaAqui() {
			return !!(o.conCaptura && o.conCaptura());
		}
		// Con calificaciones en la base (lanza si no se pudo leer)
		async function calificadasEnBase() {
			var res = await o.sb.from("calificaciones").select("id", { count: "exact", head: true })
				.eq("maestro_id", o.maestroId).eq("producto_sesion_id", producto.id)
				.or("estado_entrega.not.is.null,nivel.not.is.null,puntaje.not.is.null,retroalimentacion.not.is.null");
			if (res.error) throw res.error;
			return res.count || 0;
		}
		var avisoConCal = avisoConCalificaciones(producto.nombre);
		// Se calificó mientras el diálogo estaba abierto (otra pestaña u otro aparato: R25a-r09)
		var avisoMientras = avisoCarrera(producto.nombre);
		if (conCapturaAqui()) { o.avisoALaVista(avisoConCal); return; }
		if (sinSenal()) { o.avisoALaVista("Quitar necesita señal. " + restoSinSenal(TEXTO_SIN_SENAL)); return; }
		if (origen) origen.disabled = true;
		var enBaseCon = 0;
		try {
			enBaseCon = await calificadasEnBase();
		} catch (err) {
			if (origen) origen.disabled = false;
			o.avisoALaVista(sinSenal() ? "Quitar necesita señal. " + restoSinSenal(TEXTO_SIN_SENAL)
				: "No se pudo revisar si tiene calificaciones, así que no se quitó: " + o.textoError(err) + ".");
			return;
		}
		if (origen) origen.disabled = false;
		if (enBaseCon > 0) { o.avisoALaVista(avisoConCal); return; }
		return PQ().abrirDialogo({
			origen: origen,
			textoError: o.textoError,
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
						avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo revisar si tiene calificaciones, así que no se quitó: " + o.textoError(err) + ".");
						return false;
					}
				}
				if (yaCalificado) { o.avisoALaVista(avisoMientras); return; }
				var upd = await o.sb.from("productos_sesion").update({ activo: false })
					.eq("id", producto.id).eq("maestro_id", o.maestroId);
				if (upd.error) {
					if (String(upd.error.hint || "") === "producto_con_calificaciones" || /se calific/i.test(String(upd.error.message || ""))) {
						o.avisoALaVista(avisoMientras);
						return;
					}
					avisar(sinSenal() ? TEXTO_SIN_SENAL : "No se pudo quitar: " + o.textoError(upd.error) + ".");
					return false;
				}
				if (o.alQuitar) o.alQuitar();
				o.mensaje("info", "Se quitó «" + producto.nombre + "».");
			},
		});
	}

	var api = {
		renombrar: renombrar, quitar: quitar, avisoConCalificaciones: avisoConCalificaciones, avisoCarrera: avisoCarrera,
	};
	raiz.ProductoAcciones = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
