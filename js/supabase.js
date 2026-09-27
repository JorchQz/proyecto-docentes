/*
	Configuracion de Supabase para frontend sin build step.
	Puedes definir estas variables en una etiqueta <script> antes de cargar este archivo:

	window.SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
	window.SUPABASE_ANON_KEY = 'TU_ANON_KEY';
*/

(function initSupabaseClient() {
	var SUPABASE_URL = window.SUPABASE_URL || "https://cluvaxxqvhtxxiwctpnl.supabase.co";
	var SUPABASE_ANON_KEY =
		window.SUPABASE_ANON_KEY || "sb_publishable_wLxZz4wDwk9xorJw4vIXsQ_6kndSDFg";

	if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
		console.error(
			"Faltan SUPABASE_URL o SUPABASE_ANON_KEY. Definelas en window antes de cargar js/supabase.js"
		);
		window.sb = null;
		return;
	}

	/*
		Modo solo lectura de Mi Salón (supabase/mi_salon_b21_acceso_2026-09.sql): sin acceso
		vigente, la base rechaza toda escritura del SaaS con un 403 y la pista
		"mi_salon_solo_lectura". Aquí solo se AVISA a la página (evento "jissez:solo-lectura",
		que js/mi-salon-acceso.js convierte en un aviso claro); la respuesta llega intacta a quien
		hizo la petición. Sin ese 403, fetch pasa tal cual.
	*/
	function fetchConAviso(entrada, opciones) {
		return window.fetch(entrada, opciones).then(function (resp) {
			if (resp && resp.status === 403 && typeof window.dispatchEvent === "function") {
				try {
					resp.clone().json().then(function (cuerpo) {
						if (cuerpo && cuerpo.hint === "mi_salon_solo_lectura") {
							window.dispatchEvent(new CustomEvent("jissez:solo-lectura", { detail: cuerpo }));
						}
					}).catch(function () {});
				} catch (_) {}
			}
			return resp;
		});
	}

	window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: fetchConAviso } });
})();
