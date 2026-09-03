/*
	sesiones-materializar.js — Tras insertar filas en `sesiones`, materializa la
	trazabilidad estructurada que exige el modelo Mi salón:

	  - sesiones_pda: una fila por (sesión, PDA, grado), con criterio aplicado.
	  - productos_sesion: lo calificable de cada sesión — un trabajo genérico por
	    grado (la dosificación aún no trae el nombre real del producto: origen
	    'backfill' marca lo pendiente de enriquecer) + las tareas reales que sí
	    vienen estructuradas en cierre_tareas.
	  - producto_sesion_pda: liga cada producto con los PDA de su(s) grado(s).

	Expone: window.materializarSesiones(sesiones, maestroId, opts) -> Promise<void>
	  sesiones: filas YA insertadas, con id, numero_sesion, campo_formativo,
	            pda_sesion y cierre_tareas.
	  opts.gradosProyecto: array de grados del proyecto (fallback si una sesión
	            no trae PDAs por grado).
	  opts.origenTrabajo / opts.origenTarea: 'backfill' | 'importado' | 'maestro'.

	Requiere js/campos-formativos.js cargado antes.
*/

(function () {
	"use strict";

	function normalizarGrados(lista) {
		return Array.from(new Set((lista || [])
			.map(function (g) { return parseInt(g, 10); })
			.filter(function (g) { return !Number.isNaN(g) && g >= 1 && g <= 6; })))
			.sort(function (a, b) { return a - b; });
	}

	// cierre_tareas.todos puede ser string (dosificación) o array (crear_proyecto)
	function comoLista(valor) {
		if (valor == null) return [];
		if (Array.isArray(valor)) {
			return valor.map(function (v) { return String(v || "").trim(); }).filter(Boolean);
		}
		var s = String(valor).trim();
		return s ? [s] : [];
	}

	async function materializarSesiones(sesiones, maestroId, opts) {
		if (!window.sb) throw new Error("Supabase no está inicializado.");
		if (!window.CamposFormativos) throw new Error("Falta cargar js/campos-formativos.js.");
		opts = opts || {};
		var gradosProyecto = normalizarGrados(opts.gradosProyecto);
		var origenTrabajo = opts.origenTrabajo || "backfill";
		var origenTarea = opts.origenTarea || "importado";

		var pdaRows = [];       // filas para sesiones_pda
		var productos = [];     // filas para productos_sesion (con _clave para ligar después)
		var clavePorProducto = 0;

		sesiones.forEach(function (ses) {
			if (!ses || !ses.id) return;
			var pdaSesion = Array.isArray(ses.pda_sesion) ? ses.pda_sesion : [];
			var campoCorto = window.CamposFormativos.corto(ses.campo_formativo) || "LEN";
			var etiquetaCampo = campoCorto;

			// ── sesiones_pda ──
			pdaSesion.forEach(function (p) {
				var grado = parseInt(p.grado, 10);
				if (Number.isNaN(grado)) return;
				pdaRows.push({
					sesion_id: ses.id,
					pda_id: p.pda_id || null,
					grado: grado,
					criterio_aplicado: p.criterio_aplicado || null,
				});
			});

			// ── grados de la sesión ──
			var gradosSesion = normalizarGrados(pdaSesion.map(function (p) { return p.grado; }));
			if (!gradosSesion.length) gradosSesion = gradosProyecto;
			if (!gradosSesion.length) return; // sin grados no hay a quién calificar

			// ── trabajo genérico: diferenciado por grado en multigrado, compartido si es un solo grado ──
			var nombreBase = "Producto — Sesión " + (ses.numero_sesion || "?") + " · " + etiquetaCampo;
			if (gradosSesion.length > 1) {
				gradosSesion.forEach(function (g) {
					productos.push({
						_clave: ++clavePorProducto,
						_grados: [g],
						sesion_id: ses.id,
						maestro_id: maestroId,
						tipo: "trabajo",
						nombre: nombreBase,
						grados: [String(g)],
						modalidad: "diferenciada",
						campo: campoCorto,
						origen: origenTrabajo,
					});
				});
			} else {
				productos.push({
					_clave: ++clavePorProducto,
					_grados: gradosSesion,
					sesion_id: ses.id,
					maestro_id: maestroId,
					tipo: "trabajo",
					nombre: nombreBase,
					grados: gradosSesion.map(String),
					modalidad: "compartida",
					campo: campoCorto,
					origen: origenTrabajo,
				});
			}

			// ── tareas desde cierre_tareas ──
			var ct = ses.cierre_tareas || null;
			if (ct && ct.mode === "todos") {
				comoLista(ct.todos).forEach(function (texto, i) {
					productos.push({
						_clave: ++clavePorProducto,
						_grados: gradosSesion,
						sesion_id: ses.id,
						maestro_id: maestroId,
						tipo: "tarea",
						nombre: texto,
						grados: gradosSesion.map(String),
						modalidad: "compartida",
						campo: campoCorto,
						orden: i + 1,
						origen: origenTarea,
					});
				});
			} else if (ct && ct.mode === "diferenciado" && ct.diferenciado) {
				Object.keys(ct.diferenciado).forEach(function (gradoKey) {
					var g = parseInt(gradoKey, 10);
					if (Number.isNaN(g)) return;
					comoLista(ct.diferenciado[gradoKey]).forEach(function (texto, i) {
						productos.push({
							_clave: ++clavePorProducto,
							_grados: [g],
							sesion_id: ses.id,
							maestro_id: maestroId,
							tipo: "tarea",
							nombre: texto,
							grados: [String(g)],
							modalidad: "diferenciada",
							campo: campoCorto,
							orden: i + 1,
							origen: origenTarea,
						});
					});
				});
			}
		});

		// ── inserts ──
		var spdaInsertadas = [];
		if (pdaRows.length) {
			var resPda = await window.sb.from("sesiones_pda")
				.insert(pdaRows)
				.select("id, sesion_id, grado");
			if (resPda.error) throw resPda.error;
			spdaInsertadas = resPda.data || [];
		}

		if (productos.length) {
			var payload = productos.map(function (p) {
				var limpio = {};
				Object.keys(p).forEach(function (k) {
					if (k.charAt(0) !== "_") limpio[k] = p[k];
				});
				return limpio;
			});
			var resProd = await window.sb.from("productos_sesion")
				.insert(payload)
				.select("id, sesion_id, grados");
			if (resProd.error) throw resProd.error;
			var prodInsertados = resProd.data || [];

			// ── producto_sesion_pda: ligar producto con los PDA de su sesión y grado(s) ──
			var links = [];
			prodInsertados.forEach(function (prod) {
				var gradosProd = (prod.grados || []).map(function (g) { return parseInt(g, 10); });
				spdaInsertadas.forEach(function (spda) {
					if (spda.sesion_id !== prod.sesion_id) return;
					if (gradosProd.indexOf(spda.grado) === -1) return;
					links.push({ producto_sesion_id: prod.id, sesion_pda_id: spda.id });
				});
			});
			if (links.length) {
				var resLinks = await window.sb.from("producto_sesion_pda").insert(links);
				if (resLinks.error) throw resLinks.error;
			}
		}
	}

	window.materializarSesiones = materializarSesiones;
})();
