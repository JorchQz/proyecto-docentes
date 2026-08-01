/*
	Traduce al español los errores de Supabase Auth.

	El SDK devuelve los mensajes en inglés ("Invalid login credentials") y esos
	textos llegaban tal cual al maestro. Este archivo los convierte en mensajes
	en español que además dicen qué hacer.

	Uso:  showMessage("error", mensajeAuth(error));

	Nota sobre credenciales inválidas: Supabase responde lo mismo si la
	contraseña es incorrecta que si la cuenta no existe, a propósito, para no
	revelar qué correos están registrados. La traducción mantiene esa
	ambigüedad; no digas "esa cuenta no existe".
*/
(function () {
	// Por código de error (Supabase v2 los envía en error.code).
	var POR_CODIGO = {
		invalid_credentials: "Correo o contraseña incorrectos. Revísalos e inténtalo de nuevo.",
		email_not_confirmed: "Aún no confirmas tu correo. Busca el mensaje que te enviamos y abre el enlace.",
		user_already_exists: "Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.",
		email_exists: "Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.",
		weak_password: "La contraseña es muy débil. Usa al menos 6 caracteres.",
		same_password: "La contraseña nueva debe ser distinta de la anterior.",
		over_request_rate_limit: "Demasiados intentos seguidos. Espera un momento y vuelve a intentar.",
		over_email_send_rate_limit: "Enviamos demasiados correos a esa dirección. Espera unos minutos.",
		otp_expired: "El enlace caducó. Solicita uno nuevo.",
		email_address_invalid: "Ese correo no es válido. Revisa que esté bien escrito.",
		signup_disabled: "El registro está deshabilitado por ahora.",
		user_not_found: "No encontramos esa cuenta.",
		session_not_found: "Tu sesión expiró. Inicia sesión de nuevo.",
		user_banned: "Esta cuenta está suspendida. Escríbenos para ayudarte.",
	};

	// Respaldo por texto, para versiones del SDK que no mandan `code`.
	// Se evalúan en orden: el primero que coincida gana.
	var POR_TEXTO = [
		[/invalid login credentials/i, POR_CODIGO.invalid_credentials],
		[/email not confirmed/i, POR_CODIGO.email_not_confirmed],
		[/user already registered|already been registered/i, POR_CODIGO.user_already_exists],
		[/password should be at least/i, "La contraseña debe tener al menos 6 caracteres."],
		[/password.*(weak|breach)/i, POR_CODIGO.weak_password],
		[/new password should be different|same.*password/i, POR_CODIGO.same_password],
		[/unable to validate email|invalid format|invalid email/i, POR_CODIGO.email_address_invalid],
		[/email rate limit/i, POR_CODIGO.over_email_send_rate_limit],
		[/rate limit|too many requests/i, POR_CODIGO.over_request_rate_limit],
		[/expired|invalid.*token|token.*invalid/i, "El enlace caducó o no es válido. Solicita uno nuevo."],
		[/signups? not allowed|signup.*disabled/i, POR_CODIGO.signup_disabled],
		[/user not found/i, POR_CODIGO.user_not_found],
		[/failed to fetch|network|networkerror/i, "No hay conexión. Revisa tu internet e inténtalo de nuevo."],
	];

	// Códigos demasiado amplios para decidir por sí solos: se consultan solo si
	// el texto tampoco dijo nada. `validation_failed`, por ejemplo, lo mismo
	// cubre un correo mal escrito que un campo faltante.
	var CODIGOS_GENERICOS = {
		validation_failed: "Revisa los datos del formulario: alguno falta o no es válido.",
	};

	// Para los segundos de espera del límite de intentos:
	// "For security purposes, you can only request this after 47 seconds."
	var ESPERA = /you can only request this after (\d+) seconds?/i;

	/**
	 * @param {*} error   error de Supabase (o cualquier Error)
	 * @param {string=} respaldo  qué decir si no reconocemos el error
	 * @returns {string} mensaje en español
	 */
	function mensajeAuth(error, respaldo) {
		var porDefecto = respaldo || "No se pudo completar la operación. Inténtalo de nuevo.";
		if (!error) { return porDefecto; }

		// La API REST manda el slug en `error_code` y un número HTTP en `code`;
		// el SDK lo normaliza a `code`. Aceptamos ambos y descartamos los
		// numéricos por no estar en el mapa.
		var codigo = String(
			error.code || error.error_code ||
			(error.error && (error.error.code || error.error.error_code)) || ""
		);
		var texto = String(error.message || error.msg || error.error_description || "");

		// Va antes que el código: cuando Supabase dice cuántos segundos faltan,
		// ese dato es más útil que el "espera un momento" genérico del código.
		var espera = texto.match(ESPERA);
		if (espera) {
			return "Por seguridad, espera " + espera[1] + " segundos antes de volver a intentar.";
		}

		if (codigo && POR_CODIGO[codigo]) { return POR_CODIGO[codigo]; }
		if (!texto) { return CODIGOS_GENERICOS[codigo] || porDefecto; }

		for (var i = 0; i < POR_TEXTO.length; i++) {
			if (POR_TEXTO[i][0].test(texto)) { return POR_TEXTO[i][1]; }
		}

		if (CODIGOS_GENERICOS[codigo]) { return CODIGOS_GENERICOS[codigo]; }

		// Sin traducción conocida: no mostramos el texto en inglés al maestro,
		// pero lo dejamos en consola para poder diagnosticarlo.
		if (window.console && console.warn) {
			console.warn("Error de auth sin traducir:", codigo, texto);
		}
		return porDefecto;
	}

	window.mensajeAuth = mensajeAuth;
})();
