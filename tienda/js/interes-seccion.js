/*
	"Avísame" de las secciones que aún no abren (decisión de Jorge, 2026-09-26).
	Lo usan las páginas de presentación: Sala de Maestros (tienda/conoce-sala.html, "Avísame
	cuando abra") y Mi Salón mientras no tenga precio (tienda/conoce-mi-salon.html, "Avísame
	cuando esté disponible").

	Guarda el interés en la tabla interes_secciones (supabase/jissez_interes_secciones_2026-09.sql):
	una fila por cuenta y sección, con RLS (cada cuenta inserta, ve y borra solo lo suyo).
	- Sin escritura anónima, para evitar spam: sin sesión, el botón lleva a iniciar sesión o crear
	  la cuenta (login.html?next=<esta página>?avisame=<sección>) y, al regresar, se guarda solo
	  (ya lo pidió).
	- Pedirlo dos veces no duplica (índice único + inserción que ignora el repetido).
	- "Ya no quiero el aviso" borra la fila.
	- Si la lectura o el guardado fallan, se dice y el botón queda para reintentar; nunca se
	  afirma que quedó guardado sin confirmarlo.

	InteresSeccion.montar({ seccion, pagina, cajas, textos }) → promesa
	  seccion  "sala" | "mi_salon"
	  pagina   archivo de esta página, para regresar del login ("conoce-sala.html")
	  cajas    elementos donde se pinta el control (puede haber varios: arriba y abajo)
	  textos   { pedir, hecho, nota } (opcional)
	Iconos Lucide (Tienda.iconos). Botones de 44 px o más.
*/
var InteresSeccion = (function () {
	var SECCIONES = { sala: true, mi_salon: true };

	function valida(seccion) {
		return SECCIONES[seccion] === true;
	}

	// Enlace al login que regresa a esta página pidiendo guardar el aviso. Solo rutas .html
	// locales (el login las valida con nextSeguro).
	function enlaceLogin(pagina, seccion) {
		return "login.html?next=" + encodeURIComponent(pagina + "?avisame=" + seccion);
	}

	// ¿La página llegó del login pidiendo guardar el aviso de esta sección?
	function pidioAlRegresar(search, seccion) {
		try {
			return new URLSearchParams(search || "").get("avisame") === seccion;
		} catch (_) {
			return false;
		}
	}

	function esc(s) {
		return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	var BOTON = "inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-2xl font-bold text-[16px] transition";
	var VERDE = BOTON + " w-full sm:w-auto py-2 text-center leading-snug bg-action hover:bg-action-dark text-white shadow-[0_14px_34px_-16px_rgba(5,150,105,1)] disabled:opacity-70 disabled:cursor-not-allowed";
	var SECUNDARIO = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-[15px] font-semibold transition underline-offset-4 hover:underline disabled:opacity-70";

	function montar(opts) {
		var seccion = opts.seccion;
		if (!valida(seccion) || !opts.cajas || !opts.cajas.length) return Promise.resolve();
		var t = opts.textos || {};
		var pedir = t.pedir || "Avísame cuando abra";
		var hecho = t.hecho || "Listo. Te avisaremos a tu correo cuando abra.";
		var nota = t.nota || "Guardamos en tu cuenta que te interesa, solo para avisarte. Puedes quitarlo cuando quieras.";
		var cajas = Array.prototype.slice.call(opts.cajas);
		// oscuro: la caja va sobre el pizarrón (texto claro)
		var estado = { fase: "cargando", session: null, error: "" };

		function pintar() {
			cajas.forEach(function (caja) {
				var oscuro = caja.getAttribute("data-fondo") === "oscuro";
				var txtNota = oscuro ? "text-white/70" : "text-mute";
				var txtSec = oscuro ? "text-white" : "text-board";
				var html = "";
				if (estado.fase === "cargando") {
					html = '<button type="button" class="' + VERDE + '" disabled aria-busy="true"><i data-lucide="bell" class="w-5 h-5"></i>' + esc(pedir) + "</button>";
				} else if (estado.fase === "visitante") {
					html = '<a href="' + esc(enlaceLogin(opts.pagina, seccion)) + '" class="' + VERDE + '"><i data-lucide="bell" class="w-5 h-5"></i>' + esc(pedir) + "</a>" +
						'<p class="mt-3 text-[14px] ' + txtNota + '">Te pediremos iniciar sesión o crear tu cuenta de Jissez; así el aviso llega a tu correo.</p>';
				} else if (estado.fase === "pedir" || estado.fase === "guardando") {
					var ocupado = estado.fase === "guardando";
					html = '<button type="button" data-interes="pedir" class="' + VERDE + '"' + (ocupado ? " disabled aria-busy=\"true\"" : "") + '><i data-lucide="bell" class="w-5 h-5"></i>' + (ocupado ? "Guardando..." : esc(pedir)) + "</button>" +
						'<p class="mt-3 text-[14px] ' + txtNota + '">' + esc(nota) + "</p>";
				} else if (estado.fase === "hecho" || estado.fase === "quitando") {
					var q = estado.fase === "quitando";
					html = '<p class="inline-flex items-start gap-2 text-[16px] font-semibold ' + (oscuro ? "text-white" : "text-action-dark") + '" role="status"><i data-lucide="bell-ring" class="w-5 h-5 mt-0.5 shrink-0"></i><span>' + esc(hecho) + "</span></p>" +
						'<div class="mt-1"><button type="button" data-interes="quitar" class="' + SECUNDARIO + " " + txtSec + ' -ml-4"' + (q ? " disabled" : "") + ">" + (q ? "Quitando..." : "Ya no quiero el aviso") + "</button></div>";
				}
				if (estado.error) {
					html += '<p class="mt-3 text-[14px] font-semibold ' + (oscuro ? "text-[#fecaca]" : "text-[#b91c1c]") + '" role="alert">' + esc(estado.error) + "</p>";
				}
				caja.innerHTML = html;
			});
			if (window.Tienda && Tienda.iconos) Tienda.iconos();
		}

		function uid() {
			return estado.session && estado.session.user && estado.session.user.id;
		}

		async function guardar() {
			estado.fase = "guardando";
			estado.error = "";
			pintar();
			var res;
			try {
				res = await window.sb.from("interes_secciones")
					.upsert({ usuario_id: uid(), seccion: seccion }, { onConflict: "usuario_id,seccion", ignoreDuplicates: true });
			} catch (e) {
				res = { error: e };
			}
			if (res && res.error) {
				estado.fase = "pedir";
				estado.error = "No se pudo guardar tu aviso. Revisa tu conexión e intenta de nuevo.";
			} else {
				estado.fase = "hecho";
			}
			pintar();
		}

		async function quitar() {
			estado.fase = "quitando";
			estado.error = "";
			pintar();
			var res;
			try {
				res = await window.sb.from("interes_secciones").delete().eq("usuario_id", uid()).eq("seccion", seccion);
			} catch (e) {
				res = { error: e };
			}
			if (res && res.error) {
				estado.fase = "hecho";
				estado.error = "No se pudo quitar el aviso. Revisa tu conexión e intenta de nuevo.";
			} else {
				estado.fase = "pedir";
			}
			pintar();
		}

		cajas.forEach(function (caja) {
			caja.addEventListener("click", function (e) {
				var b = e.target.closest ? e.target.closest("[data-interes]") : null;
				if (!b || b.disabled) return;
				if (b.getAttribute("data-interes") === "pedir") guardar();
				else quitar();
			});
		});

		pintar();

		return (async function () {
			if (!window.sb || !window.Tienda) {
				estado.fase = "visitante";
				pintar();
				return;
			}
			estado.session = await Tienda.getSession();
			if (!uid()) {
				estado.fase = "visitante";
				pintar();
				return;
			}
			var alRegresar = pidioAlRegresar(location.search, seccion);
			if (alRegresar) {
				// Se quita del enlace: recargar la página no debe volver a pedirlo
				try {
					var u = new URL(location.href);
					u.searchParams.delete("avisame");
					history.replaceState(null, "", u.pathname + u.search + u.hash);
				} catch (_) {}
			}
			var lec;
			try {
				lec = await window.sb.from("interes_secciones").select("id").eq("usuario_id", uid()).eq("seccion", seccion).limit(1);
			} catch (e) {
				lec = { error: e };
			}
			if (lec.error) {
				// No se sabe si ya lo pidió: se ofrece el botón (guardar no duplica)
				estado.fase = "pedir";
				estado.error = "No se pudo revisar si ya pediste el aviso. Si lo pides de nuevo, no se duplica.";
				pintar();
				return;
			}
			if (lec.data && lec.data.length) {
				estado.fase = "hecho";
				pintar();
				return;
			}
			if (alRegresar) {
				await guardar();
				return;
			}
			estado.fase = "pedir";
			pintar();
		})();
	}

	return { valida: valida, enlaceLogin: enlaceLogin, pidioAlRegresar: pidioAlRegresar, montar: montar };
})();
if (typeof module !== "undefined" && module.exports) module.exports = InteresSeccion; // pruebas en node
