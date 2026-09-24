/*
	"Eliminar mi cuenta" para quien compra en la tienda (al final de Mis compras).

	La Ley de datos personales de 2025 pide ofrecer la opción también a quien no usa Mi Salón;
	antes solo existía en Ajustes del SaaS (js/ajustes.js). Mismo flujo que allá: botón
	secundario, confirmación escribiendo ELIMINAR y rpc("delete_own_account").

	La regla la decide la base (supabase/mi_salon_b10_eliminar_cuenta_2026-09.sql): si la
	cuenta tiene compras, NO se borra y la función responde con un mensaje que manda a
	soporte. Ese mensaje se muestra tal cual, con el correo como enlace.

	- Éxito: se cierra la sesión (solo en este navegador: la cuenta y sus sesiones ya no
	  existen) y se va a la portada, que muestra el aviso (landing.js).
	- Cualquier otro error: se avisa y la sesión sigue abierta.
*/
var EliminarCuenta = (function () {
	var PALABRA = "ELIMINAR";
	var SOPORTE = "soporte@jissez.com";
	// sessionStorage: la portada (landing.js, misma clave) lo lee para confirmar que la cuenta se eliminó.
	var CLAVE_AVISO = "jissez.aviso.cuentaEliminada";

	// Igual que en Ajustes: la palabra exacta. Solo se perdonan espacios al inicio y al final
	// (el teclado del celular suele agregar uno al autocompletar).
	function confirmacionValida(texto) {
		return String(texto == null ? "" : texto).trim() === PALABRA;
	}

	// ¿La base se negó porque la cuenta tiene compras? (errcode check_violation = 23514)
	function esErrorCompras(error) {
		if (!error) { return false; }
		var msg = String(error.message || "");
		return error.code === "23514" || /compras registradas/i.test(msg);
	}

	function esc(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// Texto escapado, con el correo de soporte convertido en enlace mailto.
	function conEnlaceSoporte(texto) {
		var enlace = '<a href="mailto:' + SOPORTE + '" class="font-bold underline underline-offset-2">' + SOPORTE + "</a>";
		return esc(texto).split(SOPORTE).join(enlace);
	}

	// Lo que se muestra cuando la llamada falla: { tipo, html }.
	function mensajeError(error) {
		if (esErrorCompras(error)) {
			var texto = (error && error.message) || "Tu cuenta tiene compras registradas en la tienda. Para eliminarla escribe a " + SOPORTE + ".";
			return { tipo: "compras", html: conEnlaceSoporte(texto) };
		}
		// Red caída, sesión vencida, error del servidor: nada se borró.
		return {
			tipo: "otro",
			html: conEnlaceSoporte("No se pudo eliminar tu cuenta y no se borró nada. Revisa tu conexión e inténtalo de nuevo; si el problema sigue, escribe a " + SOPORTE + "."),
		};
	}

	// Llama a la base. { ok: true } si la cuenta se eliminó (y ya se cerró la sesión aquí);
	// si no, { ok: false, tipo, html } con lo que hay que mostrar, y la sesión sigue abierta.
	async function eliminar(sb) {
		var error = null;
		try {
			var res = await sb.rpc("delete_own_account");
			error = res && res.error ? res.error : null;
		} catch (e) {
			error = e || { message: "Error desconocido" };
		}
		if (error) {
			var info = mensajeError(error);
			return { ok: false, tipo: info.tipo, html: info.html };
		}
		// La cuenta ya no existe: se limpia la sesión de este navegador sin pedirle nada
		// al servidor (sus sesiones se borraron con la cuenta).
		try { await sb.auth.signOut({ scope: "local" }); } catch (_) {}
		try { sessionStorage.setItem(CLAVE_AVISO, "1"); } catch (_) {}
		return { ok: true };
	}

	// Pinta la sección dentro de `contenedor` y conecta el flujo.
	// opts: { sb, alTerminar(destino) } (alTerminar existe para poder probarlo sin navegar).
	function montar(contenedor, opts) {
		opts = opts || {};
		var sb = opts.sb || window.sb;
		var alTerminar = opts.alTerminar || function (destino) { location.href = destino; };
		if (!contenedor || !sb) { return; }

		contenedor.innerHTML =
			'<h2 class="text-[11px] font-bold uppercase tracking-[0.12em] text-mute">Tu cuenta</h2>' +
			'<div class="bg-white rounded-3xl border border-line p-5 sm:p-6 flex flex-col gap-4">' +
			'<div class="flex flex-col sm:flex-row sm:items-center gap-4">' +
			'<div class="flex items-start gap-3 flex-1 min-w-0">' +
			'<div class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style="background:#fef2f2"><i data-lucide="user-x" style="width:1.25rem;height:1.25rem;color:#b91c1c"></i></div>' +
			'<div class="min-w-0">' +
			'<h3 class="font-bold text-ink leading-snug">Eliminar mi cuenta</h3>' +
			'<p class="text-sm text-mute mt-1 leading-relaxed">Borra tu cuenta de Jissez y los datos personales que guardamos de ti. No se puede deshacer.</p>' +
			"</div></div>" +
			'<button type="button" data-ec-abrir class="shrink-0 h-11 px-5 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 transition bg-white hover:bg-red-50" style="border:1px solid #fca5a5;color:#b91c1c">' +
			'<i data-lucide="trash-2" class="w-4 h-4"></i> Eliminar mi cuenta</button>' +
			"</div>" +

			// Confirmación (oculta hasta que se pide)
			'<div data-ec-form class="hidden flex flex-col gap-4 rounded-2xl p-4 sm:p-5" style="background:#fef2f2;border:1px solid #fecaca">' +
			'<div class="flex items-start gap-2.5">' +
			'<i data-lucide="triangle-alert" class="w-5 h-5 shrink-0 mt-0.5" style="color:#b91c1c"></i>' +
			'<p class="text-sm font-bold leading-relaxed" style="color:#991b1b">Esta acción es permanente y no se puede deshacer.</p>' +
			"</div>" +
			'<div class="text-sm leading-relaxed" style="color:#1c2434">' +
			'<p class="font-semibold">Se borra:</p>' +
			'<ul class="list-disc pl-5 mt-1 flex flex-col gap-0.5">' +
			"<li>Tu cuenta: tu correo y tu contraseña ya no servirán para entrar.</li>" +
			"<li>Tu perfil (nombre, escuela y CCT).</li>" +
			"<li>Si usas Mi Salón: tus grupos, alumnos, asistencias, calificaciones, boletas y proyectos.</li>" +
			"</ul>" +
			'<p class="mt-2 text-mute">Si tu cuenta tiene compras registradas en la tienda, la eliminación se hace por medio de soporte: te lo indicaremos al confirmar.</p>' +
			"</div>" +
			'<label class="flex flex-col gap-1.5">' +
			'<span class="text-sm font-medium" style="color:#1c2434">Escribe <span class="font-bold" style="color:#b91c1c">' + PALABRA + "</span> para confirmar:</span>" +
			'<input type="text" data-ec-input autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' + PALABRA + '" class="h-11 w-full rounded-xl bg-white px-4 text-[16px] outline-none focus:ring-2 focus:ring-red-300" style="border:1px solid #fca5a5;color:#1c2434">' +
			"</label>" +
			'<div data-ec-mensaje role="alert" class="hidden"></div>' +
			'<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
			'<button type="button" data-ec-cancelar class="h-11 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center bg-white border border-line hover:bg-paper transition" style="color:#1c2434">Cancelar</button>' +
			'<button type="button" data-ec-confirmar disabled class="h-11 px-5 rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed" style="background:#dc2626">' +
			'<i data-lucide="trash-2" class="w-4 h-4"></i> <span data-ec-texto>Sí, eliminar mi cuenta</span></button>' +
			"</div>" +
			"</div>" +
			"</div>";
		contenedor.classList.remove("hidden");

		var abrirBtn = contenedor.querySelector("[data-ec-abrir]");
		var form = contenedor.querySelector("[data-ec-form]");
		var input = contenedor.querySelector("[data-ec-input]");
		var mensaje = contenedor.querySelector("[data-ec-mensaje]");
		var cancelarBtn = contenedor.querySelector("[data-ec-cancelar]");
		var confirmarBtn = contenedor.querySelector("[data-ec-confirmar]");
		var confirmarTxt = contenedor.querySelector("[data-ec-texto]");
		var ocupado = false;

		function limpiarMensaje() {
			mensaje.classList.add("hidden");
			mensaje.innerHTML = "";
		}

		function mostrarMensaje(info) {
			var compras = info.tipo === "compras";
			mensaje.className = "rounded-xl px-4 py-3 text-sm font-medium flex items-start gap-2.5 leading-relaxed";
			mensaje.setAttribute("style", compras
				? "background:#fffbeb;border:1px solid #fcd34d;color:#92400e"
				: "background:#fff;border:1px solid #fca5a5;color:#991b1b");
			mensaje.innerHTML = '<i data-lucide="' + (compras ? "info" : "circle-alert") + '" class="w-4 h-4 shrink-0 mt-0.5"></i><span>' + info.html + "</span>";
			iconos();
		}

		function bloquear(si) {
			ocupado = si;
			input.disabled = si;
			cancelarBtn.disabled = si;
			confirmarBtn.disabled = si || !confirmacionValida(input.value);
			confirmarTxt.textContent = si ? "Eliminando..." : "Sí, eliminar mi cuenta";
		}

		abrirBtn.addEventListener("click", function () {
			abrirBtn.classList.add("hidden");
			form.classList.remove("hidden");
			input.focus();
		});

		cancelarBtn.addEventListener("click", function () {
			if (ocupado) { return; }
			form.classList.add("hidden");
			abrirBtn.classList.remove("hidden");
			input.value = "";
			confirmarBtn.disabled = true;
			limpiarMensaje();
			abrirBtn.focus();
		});

		input.addEventListener("input", function () {
			confirmarBtn.disabled = ocupado || !confirmacionValida(input.value);
		});
		input.addEventListener("keydown", function (e) {
			if (e.key === "Enter" && !confirmarBtn.disabled) { confirmarBtn.click(); }
		});

		confirmarBtn.addEventListener("click", async function () {
			if (ocupado || !confirmacionValida(input.value)) { return; }
			bloquear(true);
			limpiarMensaje();

			var r = await eliminar(sb);
			if (!r.ok) {
				bloquear(false);
				mostrarMensaje(r);
				return;
			}
			alTerminar("index.html");
		});

		iconos();
	}

	function iconos() {
		if (typeof window !== "undefined" && window.lucide && typeof window.lucide.createIcons === "function") {
			window.lucide.createIcons();
		}
	}

	return {
		PALABRA: PALABRA,
		SOPORTE: SOPORTE,
		CLAVE_AVISO: CLAVE_AVISO,
		confirmacionValida: confirmacionValida,
		esErrorCompras: esErrorCompras,
		conEnlaceSoporte: conEnlaceSoporte,
		mensajeError: mensajeError,
		eliminar: eliminar,
		montar: montar,
	};
})();

if (typeof module !== "undefined" && module.exports) module.exports = EliminarCuenta; // pruebas en node
