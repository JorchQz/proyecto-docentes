/*
	sesiones-materializar.js — Tras insertar o corregir filas en `sesiones`, deja al día la
	trazabilidad estructurada que exige el modelo Mi salón:

	  - sesiones_pda: una fila por (sesión, PDA, grado), con criterio aplicado.
	  - productos_sesion: lo calificable de cada sesión — un trabajo genérico por grado
	    (la dosificación aún no trae el nombre real del producto: origen 'backfill' marca
	    lo pendiente de enriquecer) + las tareas reales que vienen en cierre_tareas.
	  - producto_sesion_pda: liga cada producto con los PDA de su(s) grado(s).

	Reglas (decisiones de Jorge del 2026-09-26):
	  - CADA GRADO DEL PROYECTO TIENE SU PRODUCTO EN CADA SESIÓN, aunque no tenga PDA elegido
	    en esa sesión. Antes los grados salían solo de los PDA elegidos: con PDA solo para 3°,
	    los de 4° y 5° se quedaban sin nada que calificar. Los grados de la sesión son los del
	    proyecto más los de sus PDA.
	  - Una sesión sin campo formativo NO se guarda como LEN en silencio: si el proyecto tiene
	    un solo campo, es ese; si no, se lanza un error que pide el campo (nada se escribe).
	  - Es IDEMPOTENTE: lee lo que ya existe y solo agrega lo que falta. Correrla dos veces
	    (reintento, reedición) no duplica sesiones_pda, productos ni ligas.
	  - Solo borra en una REEDICIÓN (opts.anteriores trae la fila anterior de la sesión) y solo
	    lo que venía del plan anterior y ya no está: un PDA que se quitó, una tarea que se
	    quitó del cierre, el trabajo genérico de un grado que salió del proyecto. Nunca borra
	    un producto con calificaciones ni un PDA con evaluación formativa (se quedan), ni lo
	    que la maestra agregó en Hoy (no era parte del plan).
	  - Quien llama decide qué sesiones se pueden tocar: una sesión TRABAJADA (con fecha o
	    calificaciones) no se le pasa (crear_proyecto.js solo corrige su texto).

	Expone: window.materializarSesiones(sesiones, maestroId, opts) -> Promise<resumen>
	  sesiones: filas con id, numero_sesion, campo_formativo, pda_sesion y cierre_tareas.
	  opts.gradosProyecto: grados del proyecto (todos tienen su producto en cada sesión).
	  opts.camposProyecto: campos del proyecto (si es uno solo, es el de la sesión sin campo).
	  opts.origenTrabajo / opts.origenTarea: 'backfill' | 'importado' | 'maestro'.
	  opts.anteriores: { [sesionId]: fila anterior } en una reedición (permite borrar lo quitado).
	  opts.gradosProyectoAnterior: grados del proyecto antes de la reedición.
	y, para las pruebas, SesionesMaterializar.planificar (la regla sin base de datos).

	Requiere js/campos-formativos.js cargado antes.
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;

	function normalizarGrados(lista) {
		return Array.from(new Set((lista || [])
			.map(function (g) { return parseInt(g, 10); })
			.filter(function (g) { return !Number.isNaN(g) && g >= 1 && g <= 6; })))
			.sort(function (a, b) { return a - b; });
	}

	function claveGrados(lista) { return normalizarGrados(lista).join(","); }

	// cierre_tareas.todos puede ser string (dosificación) o array (crear_proyecto)
	function comoLista(valor) {
		if (valor == null) return [];
		if (Array.isArray(valor)) {
			return valor.map(function (v) { return String(v || "").trim(); }).filter(Boolean);
		}
		var s = String(valor).trim();
		return s ? [s] : [];
	}

	function CF() {
		if (!raiz.CamposFormativos) throw new Error("Falta cargar js/campos-formativos.js.");
		return raiz.CamposFormativos;
	}

	// Campo de la sesión (código corto). Sin campo: el único del proyecto; si hay varios, error.
	function campoDeSesion(ses, opts) {
		var c = CF().corto(ses.campo_formativo);
		if (c) return c;
		var delProyecto = Array.from(new Set((opts.camposProyecto || [])
			.map(function (x) { return CF().corto(x); }).filter(Boolean)));
		if (delProyecto.length === 1) return delProyecto[0];
		var e = new Error("La sesión " + (ses.numero_sesion || "") + " no tiene campo formativo. Elige su campo formativo antes de guardar.");
		e.humano = true;
		e.sinCampo = true;
		throw e;
	}

	// Grados de la sesión: los del proyecto más los de sus PDA (regla del 2026-09-26)
	function gradosDeSesion(ses, gradosProyecto) {
		var pda = Array.isArray(ses.pda_sesion) ? ses.pda_sesion : [];
		return normalizarGrados((gradosProyecto || []).concat(pda.map(function (p) { return p && p.grado; })));
	}

	function spdaDeseados(ses) {
		var filas = [];
		(Array.isArray(ses.pda_sesion) ? ses.pda_sesion : []).forEach(function (p) {
			if (!p) return;
			var grado = parseInt(p.grado, 10);
			if (Number.isNaN(grado)) return;
			var criterio = p.criterio_aplicado ? String(p.criterio_aplicado).trim() : null;
			if (!p.pda_id && !criterio) return; // nada que evaluar
			filas.push({ sesion_id: ses.id, pda_id: p.pda_id || null, grado: grado, criterio_aplicado: criterio || null });
		});
		return filas;
	}

	function claveSpda(r) {
		return r.pda_id ? "p|" + r.pda_id + "|" + Number(r.grado) : "c|" + Number(r.grado) + "|" + String(r.criterio_aplicado || "").trim();
	}

	/*
		Los "huecos" del plan de una sesión: los trabajos genéricos (uno por grado en multigrado,
		uno compartido con un solo grado) y las tareas de cierre_tareas. Cada hueco se llena con
		un producto que ya exista (mismo tipo y grados; las tareas, además, mismo nombre) o con
		uno nuevo.
	*/
	function huecosDelPlan(ses, grados) {
		var huecos = [];
		if (grados.length > 1) {
			grados.forEach(function (g) { huecos.push({ tipo: "trabajo", grados: [g], modalidad: "diferenciada" }); });
		} else if (grados.length === 1) {
			huecos.push({ tipo: "trabajo", grados: grados.slice(), modalidad: "compartida" });
		}
		var ct = ses.cierre_tareas || null;
		if (ct && ct.mode === "todos") {
			comoLista(ct.todos).forEach(function (texto, i) {
				huecos.push({ tipo: "tarea", nombre: texto, grados: grados.slice(), modalidad: "compartida", orden: i + 1 });
			});
		} else if (ct && ct.mode === "diferenciado" && ct.diferenciado) {
			Object.keys(ct.diferenciado).forEach(function (gradoKey) {
				var g = parseInt(gradoKey, 10);
				if (Number.isNaN(g)) return;
				comoLista(ct.diferenciado[gradoKey]).forEach(function (texto, i) {
					huecos.push({ tipo: "tarea", nombre: texto, grados: [g], modalidad: "diferenciada", orden: i + 1 });
				});
			});
		}
		return huecos;
	}

	// Empareja huecos con productos existentes, uno a uno, en orden (el más viejo primero)
	function emparejar(huecos, productos) {
		var usados = {};
		return huecos.map(function (h) {
			var p = productos.find(function (x) {
				if (usados[x.id] || x.tipo !== h.tipo) return false;
				if (claveGrados(x.grados) !== claveGrados(h.grados)) return false;
				if (h.tipo === "tarea" && String(x.nombre || "").trim() !== h.nombre) return false;
				return true;
			}) || null;
			if (p) usados[p.id] = true;
			return { hueco: h, producto: p };
		});
	}

	/*
		planificar(sesiones, existentes, opts) → qué insertar, actualizar y (en reedición) borrar.
		existentes: { spda: [...], productos: [...] } de esas sesiones (productos en orden de
		creación). No toca la base: es la regla, y la usan las pruebas.
	*/
	function planificar(sesiones, existentes, opts) {
		opts = opts || {};
		existentes = existentes || {};
		var gradosProyecto = normalizarGrados(opts.gradosProyecto);
		var gradosAntes = opts.gradosProyectoAnterior ? normalizarGrados(opts.gradosProyectoAnterior) : gradosProyecto;
		var origenTrabajo = opts.origenTrabajo || "backfill";
		var origenTarea = opts.origenTarea || "importado";
		var anteriores = opts.anteriores || {};
		var plan = {
			spdaInsertar: [], spdaActualizar: [], spdaBorrar: [],
			productosInsertar: [], productosActualizar: [], productosBorrar: [],
			campoPorSesion: {},
		};

		// Primero se valida el campo de TODAS: si falta en una, no se escribe nada
		var campos = {};
		sesiones.forEach(function (ses) {
			if (!ses || !ses.id) return;
			campos[ses.id] = campoDeSesion(ses, opts);
		});

		sesiones.forEach(function (ses) {
			if (!ses || !ses.id) return;
			var campo = campos[ses.id];
			plan.campoPorSesion[ses.id] = campo;
			var anterior = anteriores[ses.id] || null;

			// ── sesiones_pda ──
			var spdaExist = (existentes.spda || []).filter(function (r) { return r.sesion_id === ses.id; });
			var porClave = {};
			spdaExist.forEach(function (r) { porClave[claveSpda(r)] = r; });
			var deseadas = {};
			spdaDeseados(ses).forEach(function (r) {
				var k = claveSpda(r);
				if (deseadas[k]) return; // repetido en el jsonb
				deseadas[k] = true;
				var ya = porClave[k];
				if (!ya) { plan.spdaInsertar.push(r); return; }
				if (r.pda_id && String(ya.criterio_aplicado || "") !== String(r.criterio_aplicado || "")) {
					plan.spdaActualizar.push({ id: ya.id, criterio_aplicado: r.criterio_aplicado });
				}
			});
			if (anterior) {
				spdaExist.forEach(function (r) { if (!deseadas[claveSpda(r)]) plan.spdaBorrar.push(r.id); });
			}

			// ── productos ──
			var grados = gradosDeSesion(ses, gradosProyecto);
			if (!grados.length) return; // sin grados no hay a quién calificar
			var prodExist = (existentes.productos || []).filter(function (p) { return p.sesion_id === ses.id; });
			var pares = emparejar(huecosDelPlan(ses, grados), prodExist);
			var enPlan = {};
			pares.forEach(function (par, i) {
				var h = par.hueco;
				if (par.producto) {
					enPlan[par.producto.id] = true;
					var cambios = {};
					if (par.producto.campo !== campo) cambios.campo = campo;
					if (h.tipo === "trabajo" && par.producto.modalidad !== h.modalidad) cambios.modalidad = h.modalidad;
					if (Object.keys(cambios).length) plan.productosActualizar.push(Object.assign({ id: par.producto.id }, cambios));
					return;
				}
				var fila = {
					_clave: ses.id + "#" + i,
					sesion_id: ses.id,
					maestro_id: opts.maestroId || null,
					tipo: h.tipo,
					nombre: h.tipo === "trabajo" ? "Producto — Sesión " + (ses.numero_sesion || "?") + " · " + campo : h.nombre,
					grados: h.grados.map(String),
					modalidad: h.modalidad,
					campo: campo,
					origen: h.tipo === "trabajo" ? origenTrabajo : origenTarea,
				};
				if (h.orden) fila.orden = h.orden;
				plan.productosInsertar.push(fila);
			});

			// Reedición: lo que era del plan anterior y ya no está
			if (anterior) {
				var gradosViejos = gradosDeSesion(anterior, gradosAntes);
				var paresViejos = emparejar(huecosDelPlan(anterior, gradosViejos), prodExist);
				paresViejos.forEach(function (par) {
					if (par.producto && !enPlan[par.producto.id]) plan.productosBorrar.push(par.producto.id);
				});
			}
		});
		return plan;
	}

	// ── Base de datos ──────────────────────────────────────────────────────────
	var LOTE = 100;
	var PAGINA = 1000;
	// Lectura paginada y por lotes de ids (el tope de 1000 filas de Supabase corta en silencio)
	async function todas(ids, construir) {
		var filas = [];
		for (var i = 0; i < ids.length; i += LOTE) {
			var lote = ids.slice(i, i + LOTE);
			for (var desde = 0; ; desde += PAGINA) {
				var res = await construir(lote).range(desde, desde + PAGINA - 1);
				if (res.error) throw res.error;
				var datos = res.data || [];
				filas = filas.concat(datos);
				if (datos.length < PAGINA) break;
			}
		}
		return filas;
	}

	function sinGuionBajo(p) {
		var limpio = {};
		Object.keys(p).forEach(function (k) { if (k.charAt(0) !== "_") limpio[k] = p[k]; });
		return limpio;
	}

	async function materializarSesiones(sesiones, maestroId, opts) {
		var sb = raiz.sb;
		if (!sb) throw new Error("Supabase no está inicializado.");
		CF();
		opts = Object.assign({}, opts || {}, { maestroId: maestroId });
		sesiones = (sesiones || []).filter(function (s) { return s && s.id; });
		var resumen = { insertados: 0, borrados: 0, conservados: 0 };
		if (!sesiones.length) return resumen;
		// Valida el campo de todas ANTES de leer o escribir
		sesiones.forEach(function (s) { campoDeSesion(s, opts); });
		var ids = sesiones.map(function (s) { return s.id; });

		var spda = await todas(ids, function (lote) {
			return sb.from("sesiones_pda").select("id, sesion_id, pda_id, grado, criterio_aplicado")
				.in("sesion_id", lote).order("id");
		});
		var productos = await todas(ids, function (lote) {
			return sb.from("productos_sesion").select("id, sesion_id, tipo, nombre, grados, campo, modalidad, activo, created_at")
				.in("sesion_id", lote).order("created_at").order("id");
		});
		productos.sort(function (a, b) {
			var fa = String(a.created_at || ""), fb = String(b.created_at || "");
			return fa < fb ? -1 : fa > fb ? 1 : 0;
		});

		var plan = planificar(sesiones, { spda: spda, productos: productos }, opts);

		// ── Borrar (solo reedición): nunca un producto con calificaciones ni un PDA con evidencia
		if (plan.productosBorrar.length) {
			var conCal = await todas(plan.productosBorrar, function (lote) {
				return sb.from("calificaciones").select("producto_sesion_id").in("producto_sesion_id", lote).order("id");
			});
			var ocupados = {};
			conCal.forEach(function (c) { ocupados[c.producto_sesion_id] = true; });
			var borrarProd = plan.productosBorrar.filter(function (id) { return !ocupados[id]; });
			resumen.conservados += plan.productosBorrar.length - borrarProd.length;
			if (borrarProd.length) {
				var resBP = await sb.from("productos_sesion").delete().in("id", borrarProd);
				if (resBP.error) throw resBP.error;
				resumen.borrados += borrarProd.length;
			}
			productos = productos.filter(function (p) { return borrarProd.indexOf(p.id) === -1; });
		}
		if (plan.spdaBorrar.length) {
			var conEv = await todas(plan.spdaBorrar, function (lote) {
				return sb.from("evaluacion_formativa").select("sesion_pda_id").in("sesion_pda_id", lote).order("id");
			});
			var conEvidencia = {};
			conEv.forEach(function (e) { conEvidencia[e.sesion_pda_id] = true; });
			var borrarSpda = plan.spdaBorrar.filter(function (id) { return !conEvidencia[id]; });
			resumen.conservados += plan.spdaBorrar.length - borrarSpda.length;
			if (borrarSpda.length) {
				var resBS = await sb.from("sesiones_pda").delete().in("id", borrarSpda);
				if (resBS.error) throw resBS.error;
			}
			spda = spda.filter(function (r) { return borrarSpda.indexOf(r.id) === -1; });
		}

		// ── Actualizar ──
		for (var i = 0; i < plan.spdaActualizar.length; i++) {
			var u = plan.spdaActualizar[i];
			var resU = await sb.from("sesiones_pda").update({ criterio_aplicado: u.criterio_aplicado }).eq("id", u.id);
			if (resU.error) throw resU.error;
		}
		for (var j = 0; j < plan.productosActualizar.length; j++) {
			var pu = plan.productosActualizar[j];
			var cambios = sinGuionBajo(pu);
			delete cambios.id;
			var resPU = await sb.from("productos_sesion").update(cambios).eq("id", pu.id);
			if (resPU.error) throw resPU.error;
			productos.forEach(function (p) { if (p.id === pu.id) Object.assign(p, cambios); });
		}

		// ── Insertar ──
		if (plan.spdaInsertar.length) {
			var resPda = await sb.from("sesiones_pda").insert(plan.spdaInsertar).select("id, sesion_id, pda_id, grado, criterio_aplicado");
			if (resPda.error) throw resPda.error;
			spda = spda.concat(resPda.data || []);
		}
		if (plan.productosInsertar.length) {
			var resProd = await sb.from("productos_sesion").insert(plan.productosInsertar.map(sinGuionBajo))
				.select("id, sesion_id, tipo, nombre, grados, campo, modalidad, activo");
			if (resProd.error) throw resProd.error;
			productos = productos.concat(resProd.data || []);
			resumen.insertados += (resProd.data || []).length;
		}

		// ── Ligas producto-PDA: cada producto con los PDA de su sesión y de su(s) grado(s),
		// solo si es del campo de la sesión (una actividad de otro campo no evalúa esos PDA)
		var prodIds = productos.map(function (p) { return p.id; });
		var ligas = prodIds.length ? await todas(prodIds, function (lote) {
			return sb.from("producto_sesion_pda").select("producto_sesion_id, sesion_pda_id").in("producto_sesion_id", lote).order("producto_sesion_id").order("sesion_pda_id");
		}) : [];
		var yaLigado = {};
		ligas.forEach(function (l) { yaLigado[l.producto_sesion_id + "|" + l.sesion_pda_id] = true; });
		var nuevas = [];
		productos.forEach(function (prod) {
			if (prod.campo !== plan.campoPorSesion[prod.sesion_id]) return;
			var gradosProd = (prod.grados || []).map(function (g) { return parseInt(g, 10); });
			spda.forEach(function (r) {
				if (r.sesion_id !== prod.sesion_id) return;
				if (gradosProd.indexOf(Number(r.grado)) === -1) return;
				var k = prod.id + "|" + r.id;
				if (yaLigado[k]) return;
				yaLigado[k] = true;
				nuevas.push({ producto_sesion_id: prod.id, sesion_pda_id: r.id });
			});
		});
		if (nuevas.length) {
			var resLinks = await sb.from("producto_sesion_pda").insert(nuevas);
			if (resLinks.error) throw resLinks.error;
		}
		return resumen;
	}

	var api = {
		planificar: planificar,
		gradosDeSesion: gradosDeSesion,
		campoDeSesion: campoDeSesion,
		materializar: materializarSesiones,
	};
	raiz.materializarSesiones = materializarSesiones;
	raiz.SesionesMaterializar = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
