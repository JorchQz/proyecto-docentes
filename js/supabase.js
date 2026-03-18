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

	window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
