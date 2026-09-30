/*
	actividad-nueva.js — "+ Actividad o tarea" de Hoy (Fase 4 del plan de Fanny, 2026-09-29): UN solo diálogo para
	agregar una actividad en clase o una tarea. Antes eran dos ("Agregar actividad o tarea" en cada sesión y
	"Actividad suelta"); el código se sacó tal cual de agregarProducto (js/hoy.js) y las reglas son las de siempre:
	ProductosHoy (planAsignacion, validarNuevo, validarSuelta, pdaDeSesionParaActividad, pdaMarcadosPorOmision,
	planLigas, buscarContenidos) y el diálogo accesible de js/para-quien.js (ParaQuien.abrirDialogo y
	ParaQuien.listaAlumnosHtml).

	Interruptor "Dentro del proyecto / Fuera del proyecto":
	  - dentro: en una sesión de un proyecto, de las de hoy o de las que siguen en curso (ya viene elegida si se abrió
	    desde una sesión) → agregar_producto_sesion (mi_salon_b17), con los PDA de esa sesión;
	  - fuera: una actividad suelta con su día (cualquier día del trimestre en curso; una tarea suelta se deja hoy) →
	    agregar_actividad_suelta (se guarda en "Actividades del trimestre"). Abierto desde un bloque de "Actividades
	    del trimestre", su día y su campo ya vienen puestos, con los PDA que esa sesión ya tiene; si no se cambian, se
	    agrega a esa misma sesión (agregar_producto_sesion), igual que antes.
	Orden de los campos: nombre, qué es (con el día en que se revisa, si es tarea), para quién (Grupo / Grado(s) /
	Alumno(s)), campo formativo, contenido y PDA.

	Contenido y PDA (opcional). La lectura de los PDA de la sesión trae su contenido del catálogo
	(catalogo_pda(pda, contenido_id, catalogo_contenidos(id, contenido, campo_formativo))): salen ya elegidos los
	contenidos de la sesión para el campo, cada uno con sus PDA marcados por la regla de siempre
	(ProductosHoy.pdaDeSesionParaActividad). "Cambiar" abre el buscador del catálogo; el contenido que se elige ahí
	REEMPLAZA a los de la sesión (sus PDA, marcados por ProductosHoy.pdaMarcadosPorOmision; uno que la sesión ya
	tiene se reutiliza: planLigas) y "Usar los de la sesión" regresa. Sin contenidos de la sesión para ese campo
	(otro campo, o fuera del proyecto) el buscador sale directo, como antes.

	Necesita señal (no va por la cola: la captura de sus calificaciones necesita su id de la base).

	ActividadNueva.abrir(ctx) → el diálogo ({ cerrar, avisar }). ctx:
	  sb, grupo { id, grados, trimestre_actual }, alumnos, hoy "AAAA-MM-DD"
	  sesiones           las sesiones de PROYECTO de hoy y en curso (las de Hoy, sin las sueltas)
	  sesionId           la sesión de proyecto ya elegida (se abrió desde ella) o null
	  sesionSuelta       la sesión de "Actividades del trimestre" de la que se abrió, o null
	  modo               "dentro" | "fuera" | null (por omisión: dentro si hay sesiones de proyecto)
	  proyectoPorId      { id: { titulo } } para nombrar las sesiones
	  gradosDeLaSesion(sesion)  los grados por omisión de algo nuevo en esa sesión (js/hoy.js)
	  rango              { desde, hasta }: los días del trimestre en curso (ProductosHoy.rangoTrimestre)
	  sinSenal(), textoSinSenal, textoError(err), origen (el botón que lo abrió)
	  alAgregar({ nuevo, respuesta, suelta, sesion, filas, fecha, sinPda })  lo que hace la pantalla al agregarlo
	Puras (pruebas/actividad-nueva.test.js): contenidosDeSesion, destino, crearParaSuelta, conCampo.
*/

(function () {
	"use strict";

	var raiz = typeof window !== "undefined" ? window : global;

	function PH() {
		if (!raiz.ProductosHoy) throw new Error("Falta cargar js/productos-hoy.js.");
		return raiz.ProductosHoy;
	}
	function corto(campoLargo) { return raiz.CamposFormativos ? raiz.CamposFormativos.corto(campoLargo) : null; }
	function campoLargo(c) { return raiz.CamposFormativos ? raiz.CamposFormativos.largo(c) : c; }

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// PostgREST da una relación embebida como objeto o como arreglo
	function uno(x) { return Array.isArray(x) ? x[0] : x; }

	// ── Puras ────────────────────────────────────────────────────────────────
	/*
		Una fila de sesiones_pda leída con su catálogo → la misma fila con `campo`: el código corto del campo de su
		contenido en el catálogo (ProductosHoy.pdaDeSesionParaActividad lo usa), o null.
	*/
	function conCampo(r) {
		var cp = uno(r && r.catalogo_pda);
		var cc = cp && uno(cp.catalogo_contenidos);
		var c = cc ? corto(cc.campo_formativo) : null;
		return Object.assign({}, r, { campo: c || null });
	}

	/*
		Los PDA de la sesión que se ofrecen (ya filtrados por campo y grados), agrupados por su contenido del catálogo,
		en el orden en que aparecen: [{ id, contenido, pda: [filas] }]. Los que no tienen contenido del catálogo (solo
		el criterio de la sesión) van al final, en un grupo con id null.
	*/
	function contenidosDeSesion(filas) {
		var grupos = [], porClave = {};
		(filas || []).forEach(function (r) {
			if (!r) return;
			var cp = uno(r.catalogo_pda);
			var cc = cp && uno(cp.catalogo_contenidos);
			var id = cc && cc.id ? String(cc.id) : (cp && cp.contenido_id ? String(cp.contenido_id) : "");
			var clave = id || "_sin";
			if (!porClave[clave]) {
				porClave[clave] = { id: id || null, contenido: cc && cc.contenido ? String(cc.contenido) : "", pda: [] };
				grupos.push(porClave[clave]);
			}
			porClave[clave].pda.push(r);
		});
		return grupos.filter(function (g) { return g.id; }).concat(grupos.filter(function (g) { return !g.id; }));
	}

	/*
		¿A dónde va lo que se agrega?
		  dentro                                  → "sesion" (la sesión elegida)
		  fuera, abierto desde un bloque de sueltas, mismo campo y mismo día (una tarea: si el bloque es de hoy)
		                                          → "sesion" (esa misma sesión, como antes)
		  fuera                                   → "suelta" (agregar_actividad_suelta: la sesión de ese día y campo)
		d: { modo, tipo, campo (corto), dia, hoy, suelta: { campo (corto), fecha } | null }
	*/
	function destino(d) {
		d = d || {};
		if (d.modo === "dentro") return "sesion";
		var s = d.suelta;
		if (s && s.campo && d.campo === s.campo && (d.tipo === "tarea" ? s.fecha === d.hoy : d.dia === s.fecha)) return "sesion";
		return "suelta";
	}

	/*
		Fuera del proyecto, abierto desde un bloque de sueltas pero a otro día: los PDA de esa sesión que se marcaron
		(ligas.ligar) se piden como "del catálogo" (pda_id y grado) para la sesión nueva, junto con ligas.crear, sin
		repetir. Un PDA sin pda_id (solo criterio) no se puede pedir así y no pasa.
	*/
	function crearParaSuelta(ligas, spda) {
		var porId = {};
		(spda || []).forEach(function (r) { if (r && r.id) porId[r.id] = r; });
		var vistos = {}, crear = [];
		function poner(pdaId, grado) {
			var k = pdaId + "|" + Number(grado);
			if (!pdaId || vistos[k]) return;
			vistos[k] = true;
			crear.push({ pda_id: pdaId, grado: Number(grado) });
		}
		((ligas && ligas.ligar) || []).forEach(function (id) { var r = porId[id]; if (r) poner(r.pda_id, r.grado); });
		((ligas && ligas.crear) || []).forEach(function (p) { if (p) poner(p.pda_id, p.grado); });
		return crear;
	}

	// ── Contenidos del catálogo (se leen una vez por página) ─────────────────
	var contenidosCache = {};
	function contenidosDelCatalogo(sb, fases) {
		var clave = (fases || []).join(",");
		if (!contenidosCache[clave]) {
			contenidosCache[clave] = (async function () {
				var res = await sb.from("catalogo_contenidos").select("id, fase, campo_formativo, contenido, orden")
					.in("fase", fases && fases.length ? fases : ["Fase 3", "Fase 4", "Fase 5"]).order("orden").range(0, 999);
				if (res.error) throw res.error;
				return res.data || [];
			})();
			contenidosCache[clave].catch(function () { delete contenidosCache[clave]; });
		}
		return contenidosCache[clave];
	}

	// ── Piezas del diálogo ───────────────────────────────────────────────────
	var CLASE_CAMPO = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-600";
	var CLASE_OPCION = "flex items-center gap-2 min-h-[44px] rounded-xl border border-gray-300 px-3 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50";
	var ESTILO_CASILLA = "flex items-start gap-3 min-h-[44px] rounded-xl border border-gray-200 px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50";

	function campoTexto(etiqueta, atributos) {
		var cont = document.createElement("label");
		cont.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
		cont.textContent = etiqueta;
		var input = document.createElement("input");
		Object.keys(atributos || {}).forEach(function (k) { input.setAttribute(k, atributos[k]); });
		input.className = CLASE_CAMPO;
		cont.appendChild(input);
		return { cont: cont, input: input };
	}

	// "Sesión 3 · Lenguajes · Así me llamo" (el título del proyecto, breve)
	function etiquetaSesion(s, proyectoPorId) {
		var pr = (proyectoPorId || {})[s.proyecto_id] || {};
		var titulo = pr.titulo ? (raiz.AlcanceHoy && raiz.AlcanceHoy.nombreBreve ? raiz.AlcanceHoy.nombreBreve(pr.titulo, 40) : pr.titulo) : "";
		return "Sesión " + (s.numero_sesion || "") + " · " + (s.campo_formativo || "Sin campo formativo") + (titulo ? " · " + titulo : "") +
			(s.estado_sesion === "completada" ? " (terminada)" : "");
	}

	function abrir(ctx) {
		ctx = ctx || {};
		if (!raiz.ParaQuien) throw new Error("Falta cargar js/para-quien.js.");
		var sb = ctx.sb, grupo = ctx.grupo || {}, alumnos = ctx.alumnos || [], hoy = ctx.hoy;
		var sesiones = (ctx.sesiones || []).slice();
		var suelta = ctx.sesionSuelta || null;
		var elegida = ctx.sesionId ? sesiones.filter(function (s) { return s.id === ctx.sesionId; })[0] || null : null;
		// Sin una elegida: si solo hay una (o una sola sin terminar), esa
		if (!elegida && !suelta) {
			var abiertas = sesiones.filter(function (s) { return s.estado_sesion !== "completada"; });
			if (sesiones.length === 1) elegida = sesiones[0];
			else if (abiertas.length === 1) elegida = abiertas[0];
		}
		var st = {
			modo: suelta ? "fuera" : (ctx.modo === "fuera" || !sesiones.length ? "fuera" : "dentro"),
			sesion: elegida,
			paraTocado: false,
			campoTocado: false,
		};
		var gradosGrupo = (grupo.grados || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; }).sort(function (a, b) { return a - b; });
		// Los grados de los alumnos (por si el grupo no los tiene todos anotados)
		alumnos.forEach(function (a) { if (gradosGrupo.indexOf(Number(a.grado)) === -1) gradosGrupo.push(Number(a.grado)); });
		gradosGrupo.sort(function (a, b) { return a - b; });
		var fechaOmision = raiz.AlcanceHoy.venceTarea(null, hoy, ctx.ajustesCal || []);
		var rango = ctx.rango || {};
		var refs = {};
		var pda = { spda: null, contenidos: null, errorCatalogo: false, contenido: null, pdaContenido: [], cargandoContenido: false,
			tocadosSesion: {}, marcadosCatalogo: {}, buscar: false };
		var cargaPda = null; // la lectura de los PDA de la sesión (alAceptar la espera)
		var lecturaSpda = 0;  // la última lectura pedida (una que llega tarde no pisa a la de otra sesión)

		// ── El contexto: la sesión de la que salen el campo, los grados por omisión y los PDA ──
		// La sesión cuyos PDA se ofrecen: la elegida (dentro) o la del bloque de sueltas (fuera)
		function sesionPda() { return st.modo === "dentro" ? st.sesion : suelta; }
		function campoSesion() {
			var s = sesionPda();
			return s ? corto(s.campo_formativo) : null;
		}
		function porOmision() {
			var s = sesionPda();
			return s && ctx.gradosDeLaSesion ? ctx.gradosDeLaSesion(s) : gradosGrupo;
		}
		function tipoElegido() { return refs.tipo ? (refs.tipo.querySelector("input:checked") || {}).value : "trabajo"; }
		function destinoActual() {
			return destino({ modo: st.modo, tipo: tipoElegido(), campo: refs.campo ? refs.campo.value : "", dia: refs.dia ? refs.dia.value : "", hoy: hoy,
				suelta: suelta ? { campo: corto(suelta.campo_formativo), fecha: suelta.fecha } : null });
		}

		// "¿Para quién?": lo elegido en el diálogo (ProductosHoy.planAsignacion)
		function planPara() {
			var modo = refs.para ? (refs.para.querySelector("input[name='paraNuevo']:checked") || {}).value : "grupo";
			return PH().planAsignacion({
				modo: modo || "grupo",
				gradosGrupo: gradosGrupo,
				gradosElegidos: refs.para ? Array.from(refs.para.querySelectorAll("input[name='gradoNuevo']:checked")).map(function (c) { return Number(c.value); }) : porOmision(),
				alumnos: alumnos,
				elegidos: refs.para ? Array.from(refs.para.querySelectorAll("input[name='alumnoNuevo']:checked")).map(function (c) { return c.value; }) : [],
				nivel: refs.nivel ? refs.nivel.value : "",
			});
		}
		// Los grados cuyos PDA se ofrecen: los de la actividad y los de sus alumnos incluidos
		function gradosElegidos() {
			var p = planPara();
			return p.ok ? p.gradosPda : [];
		}

		// ── Dentro / Fuera del proyecto ──
		function construirDonde(cuerpo) {
			var fs = document.createElement("fieldset");
			fs.className = "flex flex-col gap-2";
			fs.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>¿Dónde va?</legend>" +
				"<div class='grid grid-cols-2 gap-2'>" + [["dentro", "Dentro del proyecto"], ["fuera", "Fuera del proyecto"]].map(function (o) {
					var sin = o[0] === "dentro" && !sesiones.length;
					return "<label class='" + CLASE_OPCION + (sin ? " opacity-60 cursor-not-allowed" : "") + "'>" +
						"<input type='radio' name='dondeNuevo' value='" + o[0] + "'" + (o[0] === st.modo ? " checked" : "") + (sin ? " disabled" : "") +
						" class='h-5 w-5 shrink-0 text-blue-600'><span class='text-sm text-gray-800'>" + o[1] + "</span></label>";
				}).join("") + "</div>";
			var ayuda = document.createElement("p");
			ayuda.className = "text-xs text-gray-500";
			ayuda.setAttribute("data-donde-ayuda", "1");
			fs.appendChild(ayuda);
			refs.donde = fs;
			refs.dondeAyuda = ayuda;
			cuerpo.appendChild(fs);

			// Dentro: la sesión (de las de hoy y las que siguen en curso)
			var lab = document.createElement("label");
			lab.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
			lab.textContent = "Sesión";
			var sel = document.createElement("select");
			sel.setAttribute("data-sesion", "1");
			sel.className = CLASE_CAMPO + " bg-white";
			if (!st.sesion) {
				var elige = document.createElement("option");
				elige.value = "";
				elige.textContent = "Elige la sesión...";
				elige.selected = true;
				sel.appendChild(elige);
			}
			sesiones.forEach(function (s) {
				var o = document.createElement("option");
				o.value = s.id;
				o.textContent = etiquetaSesion(s, ctx.proyectoPorId);
				if (st.sesion && s.id === st.sesion.id) o.selected = true;
				sel.appendChild(o);
			});
			lab.appendChild(sel);
			refs.sesion = sel;
			refs.sesionCont = lab;
			cuerpo.appendChild(lab);

			// Fuera: el día de la actividad (por omisión hoy, o el del bloque de sueltas). Cualquier día del trimestre en
			// curso (decisión de Jorge del 2026-09-26): uno que ya pasó se califica aquí mismo, al agregarla
			var dia = campoTexto("Día de la actividad", { type: "date", min: rango.desde, max: rango.hasta, value: hoy });
			if (suelta && suelta.fecha) dia.input.value = suelta.fecha;
			var ayudaDia = document.createElement("span");
			ayudaDia.className = "text-xs font-normal text-gray-500";
			ayudaDia.textContent = "Puede ser un día que ya pasó del trimestre: la calificas aquí mismo al agregarla. Un día que viene aparece en Hoy ese día.";
			dia.cont.appendChild(ayudaDia);
			refs.dia = dia.input;
			refs.diaCont = dia.cont;
			cuerpo.appendChild(dia.cont);

			fs.addEventListener("change", function (e) {
				var r = e.target.closest("input[name='dondeNuevo']");
				if (!r || r.value === st.modo) return;
				st.modo = r.value;
				cambioDeContexto();
			});
			sel.addEventListener("change", function () {
				st.sesion = sesiones.filter(function (s) { return s.id === sel.value; })[0] || null;
				var vacia = sel.querySelector("option[value='']");
				if (st.sesion && vacia) sel.removeChild(vacia);
				cambioDeContexto();
			});
		}

		// Lo que se ve según el interruptor y el tipo
		function pintarDonde() {
			var tarea = tipoElegido() === "tarea";
			refs.sesionCont.classList.toggle("hidden", st.modo !== "dentro");
			// La tarea suelta se deja hoy: sin día
			refs.diaCont.classList.toggle("hidden", st.modo !== "fuera" || tarea);
			refs.dondeAyuda.textContent = st.modo === "dentro"
				? "Se agrega a la sesión que elijas: la de hoy o una que sigue en curso."
				: "Sin proyecto: se guarda en " + raiz.AlcanceHoy.TITULO_SUELTAS + " y cuenta para la boleta. Después puedes pasarla a un proyecto." +
					(sesiones.length ? "" : " Para agregarla dentro de un proyecto, primero toca «Trabajar hoy» en una de sus sesiones.");
		}

		// ── ¿Para quién? ──
		/*
			Todo el grupo, uno o varios grados (en multigrado) o los alumnos que el docente marca, agrupados por grado,
			con el grado con el que trabajan (por ejemplo dos de 3° que trabajan con 2°). omision: los grados por omisión.
		*/
		function modoPorOmision(omision) { return omision.length && omision.length < gradosGrupo.length ? "grados" : "grupo"; }
		function construirParaQuien(omision) {
			var fs = document.createElement("fieldset");
			fs.className = "flex flex-col gap-2";
			var modo0 = modoPorOmision(omision);
			var opciones = [["grupo", "Grupo"]];
			if (gradosGrupo.length > 1) opciones.push(["grados", "Grado(s)"]);
			opciones.push(["alumnos", "Alumno(s)"]);
			fs.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>¿Para quién?</legend>" +
				"<div class='grid grid-cols-" + opciones.length + " gap-2'>" + opciones.map(function (o) {
					return "<label class='" + CLASE_OPCION + "'><input type='radio' name='paraNuevo' value='" + o[0] + "'" + (o[0] === modo0 ? " checked" : "") +
						" class='h-5 w-5 shrink-0 text-blue-600'><span class='text-sm text-gray-800'>" + o[1] + "</span></label>";
				}).join("") + "</div>" +
				"<div data-para='grados' class='flex flex-wrap gap-2'>" + gradosGrupo.map(function (g) {
					return "<label class='" + CLASE_OPCION + "'><input type='checkbox' name='gradoNuevo' value='" + g + "'" +
						(omision.indexOf(g) !== -1 ? " checked" : "") + " class='h-5 w-5 text-blue-600 rounded'><span class='text-sm text-gray-800'>" + g + "°</span></label>";
				}).join("") + "</div>" +
				"<div data-para='alumnos' class='flex flex-col gap-2'>" + raiz.ParaQuien.listaAlumnosHtml(alumnos, "alumnoNuevo", {}, {}) +
				"<label class='flex flex-col gap-1 text-sm font-medium text-gray-700'>¿Con qué grado trabajan?" +
				"<select data-nivel class='min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 bg-white'>" +
				"<option value=''>Cada uno con el suyo</option>" + [1, 2, 3, 4, 5, 6].map(function (g) {
					return "<option value='" + g + "'>Con " + g + "° (siguen en su grado para la boleta)</option>";
				}).join("") + "</select></label></div>";
			refs.para = fs;
			refs.nivel = fs.querySelector("select[data-nivel]");
			fs.addEventListener("change", function () {
				st.paraTocado = true; // lo tocó el docente (los cambios del código no disparan "change")
				mostrarPara();
			});
			return fs;
		}
		function mostrarPara() {
			var fs = refs.para;
			var m = (fs.querySelector("input[name='paraNuevo']:checked") || {}).value;
			var g = fs.querySelector("[data-para='grados']"), a = fs.querySelector("[data-para='alumnos']");
			if (g) g.classList.toggle("hidden", m !== "grados");
			if (a) a.classList.toggle("hidden", m !== "alumnos");
		}
		// Otra sesión u otro lado del interruptor: si el docente no tocó "¿Para quién?", sus valores por omisión
		function aplicarOmisionPara() {
			if (st.paraTocado || !refs.para) return;
			var omision = porOmision();
			var modo0 = modoPorOmision(omision);
			Array.from(refs.para.querySelectorAll("input[name='paraNuevo']")).forEach(function (r) { r.checked = r.value === modo0; });
			Array.from(refs.para.querySelectorAll("input[name='gradoNuevo']")).forEach(function (c) { c.checked = omision.indexOf(Number(c.value)) !== -1; });
			mostrarPara();
		}

		// ── Campo formativo ──
		function llenarCampos() {
			var sel = refs.campo, cs = campoSesion();
			var valor = st.campoTocado ? sel.value : (cs || "");
			sel.innerHTML = "";
			if (!valor) {
				var elige = document.createElement("option");
				elige.value = "";
				elige.textContent = "Elige el campo formativo...";
				sel.appendChild(elige);
			}
			PH().CAMPOS.forEach(function (c) {
				var o = document.createElement("option");
				o.value = c;
				o.textContent = campoLargo(c);
				sel.appendChild(o);
			});
			sel.value = valor;
		}

		// ── Contenido y PDA (opcional) ──
		function construirPda(cuerpo) {
			var fs = document.createElement("fieldset");
			fs.className = "flex flex-col gap-2";
			fs.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>Contenido y PDA que evalúa <span class='font-normal text-gray-500'>(opcional)</span></legend>";
			// Los contenidos de la sesión, ya elegidos
			refs.pdaSesion = document.createElement("div");
			refs.pdaSesion.className = "flex flex-col gap-2";
			refs.pdaSesion.setAttribute("data-contenidos-sesion", "1");
			fs.appendChild(refs.pdaSesion);
			// El buscador del catálogo ("Cambiar", o directo si la sesión no trae contenidos de ese campo)
			refs.buscador = document.createElement("div");
			refs.buscador.className = "flex flex-col gap-2";
			refs.buscador.setAttribute("data-buscador", "1");
			var busca = document.createElement("label");
			busca.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
			refs.buscaEtiqueta = document.createElement("span");
			refs.buscaEtiqueta.textContent = "Buscar un contenido del catálogo";
			busca.appendChild(refs.buscaEtiqueta);
			refs.busca = document.createElement("input");
			refs.busca.type = "search";
			refs.busca.autocomplete = "off";
			refs.busca.setAttribute("data-busca-contenido", "1");
			refs.busca.className = CLASE_CAMPO;
			refs.busca.placeholder = "Escribe una palabra del contenido";
			busca.appendChild(refs.busca);
			refs.buscaCont = busca;
			refs.buscador.appendChild(busca);
			refs.resultados = document.createElement("div");
			refs.resultados.className = "flex flex-col gap-1";
			refs.resultados.setAttribute("aria-live", "polite");
			refs.buscador.appendChild(refs.resultados);
			refs.contenido = document.createElement("div");
			refs.contenido.className = "flex flex-col gap-2";
			refs.buscador.appendChild(refs.contenido);
			refs.volver = document.createElement("button");
			refs.volver.type = "button";
			refs.volver.setAttribute("data-usar-sesion", "1");
			refs.volver.className = "self-start min-h-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50";
			refs.volver.textContent = "Usar los de la sesión";
			refs.volver.classList.add("hidden");
			refs.buscador.appendChild(refs.volver);
			fs.appendChild(refs.buscador);
			cuerpo.appendChild(fs);

			refs.busca.addEventListener("input", pintarResultados);
			// Enter en el buscador no envía el diálogo
			refs.busca.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
			refs.resultados.addEventListener("click", function (e) {
				var b = e.target.closest("[data-contenido]");
				if (b) elegirContenido(b.getAttribute("data-contenido"));
			});
			refs.contenido.addEventListener("click", function (e) {
				if (e.target.closest("[data-quitar-contenido]")) { quitarContenido(); pintarPda(); refs.busca.focus(); }
			});
			refs.contenido.addEventListener("change", function (e) {
				var c = e.target.closest("input[name='pdaCatalogo']");
				if (c) pda.marcadosCatalogo[c.value] = c.checked;
			});
			refs.pdaSesion.addEventListener("change", function (e) {
				var c = e.target.closest("input[name='pdaSesion']");
				if (c) pda.tocadosSesion[c.value] = c.checked;
			});
			// "Cambiar": el buscador reemplaza a los contenidos de la sesión
			refs.pdaSesion.addEventListener("click", function (e) {
				if (!e.target.closest("[data-cambiar-contenido]")) return;
				pda.buscar = true;
				pintarPda();
				refs.busca.focus();
			});
			refs.volver.addEventListener("click", function () {
				pda.buscar = false;
				quitarContenido();
				pintarPda();
				var primera = refs.pdaSesion.querySelector("input[name='pdaSesion'], [data-cambiar-contenido]");
				if (primera) primera.focus();
			});
		}

		// Los PDA de la sesión que se ofrecen (los lee cargarSpda). Fuera del proyecto y sin bloque de sueltas: ninguno
		async function cargarSpda() {
			var sesion = sesionPda();
			var n = ++lecturaSpda;
			pda.errorSpda = false;
			if (!sesion) { pda.spda = []; return; }
			pda.spda = null;
			var spda;
			try {
				var res = await sb.from("sesiones_pda")
					.select("id, pda_id, grado, criterio_aplicado, catalogo_pda(pda, contenido_id, catalogo_contenidos(id, contenido, campo_formativo))")
					.eq("sesion_id", sesion.id).order("grado");
				if (res.error) throw res.error;
				// El campo de cada PDA es el de su contenido en el catálogo (ProductosHoy.pdaDeSesionParaActividad)
				spda = (res.data || []).map(conCampo);
			} catch (err) {
				console.error("actividad-nueva: PDA de la sesión", err);
				spda = null;
			}
			if (n !== lecturaSpda) return; // ya se eligió otra sesión: esta lectura no cuenta
			pda.spda = spda;
			pda.errorSpda = spda === null;
			pintarPda();
		}

		async function cargarCatalogo() {
			try {
				// Todas las fases: un alumno puede trabajar con otro grado ("¿Para quién?")
				pda.contenidos = await contenidosDelCatalogo(sb, PH().fasesDeGrados([1, 2, 3, 4, 5, 6]));
			} catch (err) {
				console.error("actividad-nueva: catálogo de contenidos", err);
				pda.errorCatalogo = true;
			}
			pintarPda();
		}

		// Marcado: lo que tocó el docente; si no lo tocó, la regla (r.marcado)
		function marcadoSesion(r) {
			return Object.prototype.hasOwnProperty.call(pda.tocadosSesion, r.id) ? pda.tocadosSesion[r.id] : !!r.marcado;
		}

		function textoPda(r) {
			var cp = uno(r.catalogo_pda);
			return (cp && cp.pda) || r.criterio_aplicado || "Criterio de la sesión";
		}

		// Los PDA de la sesión que se ofrecen para el campo y los grados elegidos (la regla de siempre)
		function deSesionVisibles() {
			return PH().pdaDeSesionParaActividad(pda.spda || [], campoSesion(), refs.campo ? refs.campo.value : "", gradosElegidos());
		}
		// ¿Se ven los contenidos de la sesión (y no el buscador)?
		function conContenidosDeSesion(visibles) { return !pda.buscar && visibles.length > 0; }

		function pintarPda() {
			if (!refs.pdaSesion) return;
			var campo = refs.campo ? refs.campo.value : "";
			// Mientras llegan los PDA de la sesión (una lectura corta), ni sus contenidos ni el buscador
			if (pda.spda === null && !pda.errorSpda && sesionPda()) {
				refs.pdaSesion.innerHTML = "<p class='text-xs text-gray-500'>Cargando los contenidos de la sesión...</p>";
				refs.pdaSesion.classList.remove("hidden");
				refs.buscador.classList.add("hidden");
				return;
			}
			var visibles = deSesionVisibles();
			var enSesion = conContenidosDeSesion(visibles);
			refs.pdaSesion.innerHTML = "";
			refs.pdaSesion.classList.toggle("hidden", !enSesion);
			refs.buscador.classList.toggle("hidden", enSesion);
			refs.volver.classList.toggle("hidden", enSesion || !visibles.length);
			if (enSesion) {
				var cabeza = document.createElement("div");
				cabeza.className = "flex items-center justify-between gap-2";
				cabeza.innerHTML = "<p class='text-xs text-gray-500'>De esta sesión (marca los PDA que esta actividad evalúa):</p>" +
					"<button type='button' data-cambiar-contenido aria-label='Cambiar el contenido: buscar otro en el catálogo' class='shrink-0 min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50'>Cambiar</button>";
				refs.pdaSesion.appendChild(cabeza);
				contenidosDeSesion(visibles).forEach(function (g) {
					var caja = document.createElement("div");
					caja.className = "flex flex-col gap-2 rounded-xl bg-gray-50 border border-gray-200 p-2";
					caja.setAttribute("data-contenido-sesion", g.id || "");
					caja.innerHTML = "<p class='text-sm text-gray-800 px-1'><span class='block text-xs text-gray-500'>" + (g.id ? "Contenido" : "Otros criterios de la sesión") + "</span>" +
						(g.id ? esc(g.contenido || "Contenido del catálogo") : "") + "</p>";
					g.pda.forEach(function (r) {
						var l = document.createElement("label");
						l.className = ESTILO_CASILLA + " bg-white";
						l.innerHTML = "<input type='checkbox' name='pdaSesion' class='h-5 w-5 mt-0.5 shrink-0 text-blue-600 rounded'" + (marcadoSesion(r) ? " checked" : "") + ">" +
							"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(r.grado) + "°</span> · " + esc(textoPda(r)) + "</span>";
						l.querySelector("input").value = r.id;
						caja.appendChild(l);
					});
					refs.pdaSesion.appendChild(caja);
				});
			}
			refs.buscaEtiqueta.textContent = campo ? "Buscar un contenido de " + campoLargo(campo) : "Elige el campo formativo para buscar su contenido";
			refs.busca.disabled = !campo || pda.errorCatalogo;
			pintarResultados();
			pintarContenido();
		}

		function pintarResultados() {
			if (!refs.resultados) return;
			refs.resultados.innerHTML = "";
			var campo = refs.campo ? refs.campo.value : "";
			if (pda.errorCatalogo) {
				refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>No se pudo cargar el catálogo de contenidos. Puedes agregar la actividad sin PDA.</p>";
				return;
			}
			if (!campo || pda.contenido) return;
			if (!pda.contenidos) { refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>Cargando el catálogo...</p>"; return; }
			var texto = refs.busca.value;
			if (!String(texto || "").trim()) return;
			var fases = PH().fasesDeGrados(gradosElegidos());
			var todos = PH().buscarContenidos(pda.contenidos, texto, campoLargo(campo), fases);
			if (!todos.length) {
				refs.resultados.innerHTML = "<p class='text-xs text-gray-500'>Ningún contenido de " + esc(campoLargo(campo)) + " tiene esas palabras.</p>";
				return;
			}
			todos.slice(0, 8).forEach(function (c) {
				var b = document.createElement("button");
				b.type = "button";
				b.setAttribute("data-contenido", c.id);
				b.className = "w-full min-h-[44px] text-left rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:border-blue-400 hover:bg-blue-50";
				b.textContent = c.contenido;
				refs.resultados.appendChild(b);
			});
			if (todos.length > 8) {
				var mas = document.createElement("p");
				mas.className = "text-xs text-gray-500";
				mas.textContent = "Y " + (todos.length - 8) + " más: escribe otra palabra para acotar.";
				refs.resultados.appendChild(mas);
			}
		}

		async function elegirContenido(id) {
			var c = (pda.contenidos || []).find(function (x) { return x.id === id; });
			if (!c) return;
			pda.contenido = c;
			pda.buscar = true; // lo elegido en el buscador reemplaza a los contenidos de la sesión
			pda.pdaContenido = [];
			pda.marcadosCatalogo = {};
			pda.cargandoContenido = true;
			pintarResultados();
			pintarContenido();
			try {
				var res = await sb.from("catalogo_pda").select("id, grado, pda, orden").eq("contenido_id", c.id).in("grado", [1, 2, 3, 4, 5, 6]).order("orden");
				if (res.error) throw res.error;
				if (pda.contenido !== c) return;
				pda.pdaContenido = res.data || [];
				PH().pdaMarcadosPorOmision(pda.pdaContenido, gradosElegidos()).forEach(function (pid) { pda.marcadosCatalogo[pid] = true; });
			} catch (err) {
				console.error("actividad-nueva: PDA del contenido", err);
				pda.pdaContenido = null;
			}
			pda.cargandoContenido = false;
			pintarContenido();
			var primera = refs.contenido.querySelector("input[name='pdaCatalogo'], [data-quitar-contenido]");
			if (primera) primera.focus();
		}

		function quitarContenido() {
			pda.contenido = null;
			pda.pdaContenido = [];
			pda.marcadosCatalogo = {};
			if (refs.busca) refs.busca.value = "";
		}

		function pintarContenido() {
			if (!refs.contenido) return;
			refs.contenido.innerHTML = "";
			if (!pda.contenido) return;
			var caja = document.createElement("div");
			caja.className = "flex items-start justify-between gap-2 rounded-xl bg-gray-50 border border-gray-200 pl-3";
			caja.innerHTML = "<p class='text-sm text-gray-800 py-2.5'><span class='block text-xs text-gray-500'>Contenido</span>" + esc(pda.contenido.contenido) + "</p>" +
				"<button type='button' data-quitar-contenido class='shrink-0 min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50'>Cambiar</button>";
			refs.contenido.appendChild(caja);
			if (pda.cargandoContenido) { refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>Cargando sus PDA...</p>"); return; }
			if (pda.pdaContenido === null) { refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>No se pudieron cargar sus PDA. Puedes agregar la actividad sin PDA.</p>"); return; }
			var g = gradosElegidos();
			var deGrados = pda.pdaContenido.filter(function (p) { return g.indexOf(Number(p.grado)) !== -1; });
			if (!deGrados.length) {
				refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>Este contenido no tiene PDA para los grados elegidos.</p>");
				return;
			}
			deGrados.forEach(function (p) {
				var l = document.createElement("label");
				l.className = ESTILO_CASILLA;
				l.innerHTML = "<input type='checkbox' name='pdaCatalogo' class='h-5 w-5 mt-0.5 shrink-0 text-blue-600 rounded'" + (pda.marcadosCatalogo[p.id] ? " checked" : "") + ">" +
					"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(p.grado) + "°</span> · " + esc(p.pda || "") + "</span>";
				l.querySelector("input").value = p.id;
				refs.contenido.appendChild(l);
			});
		}

		/*
			Lo elegido al aceptar (solo lo visible: de los grados y el campo elegidos). Con los contenidos de la sesión a
			la vista, sus PDA marcados; con el buscador, los PDA marcados del contenido que se eligió ahí.
		*/
		function eleccionPda() {
			if (pda.spda === null) return null; // no se leyeron los de la sesión: como antes (sin PDA)
			var g = gradosElegidos();
			var visibles = deSesionVisibles();
			var enSesion = conContenidosDeSesion(visibles);
			var deSesion = enSesion ? visibles.filter(marcadoSesion).map(function (r) { return r.id; }) : [];
			var deCatalogo = enSesion ? [] : (pda.pdaContenido || []).filter(function (p) { return pda.marcadosCatalogo[p.id] && g.indexOf(Number(p.grado)) !== -1; })
				.map(function (p) { return { pda_id: p.id, grado: Number(p.grado) }; });
			return { deSesion: deSesion, deCatalogo: deCatalogo, spdaSesion: pda.spda };
		}

		// Otra sesión o el otro lado del interruptor: campo, "¿Para quién?" (si no se tocaron) y los PDA de esa sesión
		function cambioDeContexto() {
			pda.buscar = false;
			pda.tocadosSesion = {};
			quitarContenido();
			llenarCampos();
			aplicarOmisionPara();
			pintarDonde();
			cargaPda = cargarSpda();
			pintarPda();
		}

		return raiz.ParaQuien.abrirDialogo({
			origen: ctx.origen,
			titulo: "Agregar actividad o tarea",
			aceptar: "Agregar",
			textoError: ctx.textoError,
			construir: function (cuerpo) {
				construirDonde(cuerpo);

				var nombre = campoTexto("Nombre", { type: "text", maxlength: String(PH().NOMBRE_MAX), autocomplete: "off",
					placeholder: "Por ejemplo: Cartel del cuento", "data-foco": "1" });
				refs.nombre = nombre.input;
				cuerpo.appendChild(nombre.cont);

				var tipo = document.createElement("fieldset");
				tipo.className = "flex flex-col gap-2";
				tipo.innerHTML = "<legend class='text-sm font-medium text-gray-700 mb-1'>¿Qué es?</legend>" +
					"<div class='grid grid-cols-2 gap-2'>" +
					["trabajo", "tarea"].map(function (t, i) {
						return "<label class='" + CLASE_OPCION + " gap-3'>" +
							"<input type='radio' name='tipoNuevo' value='" + t + "'" + (i === 0 ? " checked" : "") + " class='h-5 w-5 shrink-0 text-blue-600'>" +
							"<span class='text-sm text-gray-800'>" + (t === "trabajo" ? "Actividad en clase" : "Tarea para casa") + "</span></label>";
					}).join("") + "</div>";
				refs.tipo = tipo;
				cuerpo.appendChild(tipo);

				// Tarea: el día en que se revisa (por omisión el siguiente día de clase)
				var fecha = campoTexto("Día en que se revisa la tarea", { type: "date", min: hoy, value: fechaOmision || "" });
				fecha.cont.classList.add("hidden");
				var ayuda = document.createElement("span");
				ayuda.className = "text-xs font-normal text-gray-500";
				ayuda.textContent = "Por omisión, el siguiente día de clase. Ese día aparece en Tareas por revisar.";
				fecha.cont.appendChild(ayuda);
				refs.fecha = fecha.input;
				refs.fechaCont = fecha.cont;
				cuerpo.appendChild(fecha.cont);

				var grados = construirParaQuien(porOmision());
				cuerpo.appendChild(grados);
				mostrarPara();

				var campo = document.createElement("label");
				campo.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
				campo.textContent = "Campo formativo";
				var sel = document.createElement("select");
				sel.setAttribute("data-campo", "1");
				sel.className = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 bg-white";
				refs.campo = sel;
				llenarCampos();
				campo.appendChild(sel);
				cuerpo.appendChild(campo);

				construirPda(cuerpo);
				pintarDonde();

				tipo.addEventListener("change", function () {
					refs.fechaCont.classList.toggle("hidden", tipoElegido() !== "tarea");
					pintarDonde();
				});
				sel.addEventListener("change", function () {
					st.campoTocado = true;
					if (pda.contenido && corto(pda.contenido.campo_formativo) !== sel.value) quitarContenido();
					pintarPda();
				});
				grados.addEventListener("change", pintarPda);
				cargaPda = cargarSpda();
				pintarPda();
				cargarCatalogo();
			},
			alAceptar: async function (form, avisar) {
				if (st.modo === "dentro" && !st.sesion) { avisar("Elige la sesión del proyecto.", refs.sesion); return false; }
				var plan = planPara();
				var focoPara = function (f) {
					return f === "alumnos" ? refs.para.querySelector("input[name='alumnoNuevo']") || refs.para.querySelector("input")
						: refs.para.querySelector(f === "grados" ? "input[name='gradoNuevo']" : "input");
				};
				if (!plan.ok) { avisar(plan.error, focoPara(plan.foco)); return false; }
				var datos = {
					nombre: refs.nombre.value,
					tipo: tipoElegido(),
					campo: refs.campo.value,
					grados: plan.grados,
					incluidos: plan.incluidos,
					fechaRevision: refs.fecha.value,
					fecha: st.modo === "fuera" ? refs.dia.value : null,
				};
				var hacia = destinoActual();
				var esSuelta = hacia === "suelta";
				var ctxV = { hoy: hoy, gradosSesion: porOmision(), desde: esSuelta ? rango.desde : undefined, hasta: esSuelta ? rango.hasta : undefined };
				var v = esSuelta ? PH().validarSuelta(datos, ctxV) : PH().validarNuevo(datos, ctxV);
				if (!v.ok) {
					var foco = { nombre: refs.nombre, campo: refs.campo, fecha: refs.fecha, fechaSuelta: refs.dia,
						grados: focoPara("grados"), tipo: refs.tipo.querySelector("input") }[v.foco];
					avisar(v.error, foco);
					return false;
				}
				if (ctx.sinSenal && ctx.sinSenal()) { avisar(ctx.textoSinSenal); return false; }
				// PDA elegidos: los de la sesión se ligan y los del catálogo se reutilizan o se crean
				// Los PDA de la sesión se leen al abrir: si el docente aceptó antes de que llegaran, se esperan
				if (cargaPda) await cargaPda;
				var eleccion = eleccionPda();
				var ligas = eleccion
					? PH().planLigas({ grados: plan.gradosPda, deSesion: eleccion.deSesion, deCatalogo: eleccion.deCatalogo, spdaSesion: eleccion.spdaSesion })
					: { ligar: [], crear: [] };
				var producto = { tipo: v.fila.tipo, nombre: v.fila.nombre, grados: v.fila.grados, modalidad: v.fila.modalidad,
					campo: v.fila.campo, fecha_entrega: v.fila.fecha_entrega };
				var sesion = esSuelta ? null : sesionPda();
				// Producto, "para quién" y PDA en una sola transacción (mi_salon_b17)
				var res = esSuelta
					? await sb.rpc("agregar_actividad_suelta", { p_grupo: grupo.id, p_fecha: v.fecha, p_producto: producto,
						p_asignacion: plan.filas, p_crear: suelta ? crearParaSuelta(ligas, pda.spda) : ligas.crear })
					: await sb.rpc("agregar_producto_sesion", { p_sesion: sesion.id, p_producto: producto,
						p_asignacion: plan.filas, p_ligar: ligas.ligar, p_crear: ligas.crear });
				if (res.error) {
					avisar(ctx.sinSenal && ctx.sinSenal() ? ctx.textoSinSenal : "No se pudo agregar: " + (ctx.textoError ? ctx.textoError(res.error) : res.error.message) + ".");
					return false;
				}
				var nuevo = esSuelta ? (res.data || {}).producto : res.data;
				if (!nuevo || !nuevo.id) { avisar("No se pudo agregar: la base no devolvió la actividad."); return false; }
				if (ctx.alAgregar) {
					ctx.alAgregar({ nuevo: nuevo, respuesta: res.data, suelta: esSuelta, sesion: sesion, filas: plan.filas,
						fecha: esSuelta ? v.fecha : null, sinPda: !eleccion });
				}
			},
		});
	}

	var api = {
		abrir: abrir, contenidosDeSesion: contenidosDeSesion, destino: destino, crearParaSuelta: crearParaSuelta, conCampo: conCampo,
	};
	raiz.ActividadNueva = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
