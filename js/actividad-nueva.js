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
	    del trimestre", se agrega a ESA sesión, como antes de la Fase 4 (agregar_producto_sesion, con los PDA que ya
	    tiene; también si se cambia el campo o si es una tarea de un bloque de un día que ya pasó): en lugar del día
	    se dice a qué bloque va.
	Orden de los campos: nombre, qué es (con el día en que se revisa, si es tarea), para quién (Grupo / Grado(s) /
	Alumno(s)), campo formativo, contenido y PDA.

	Dentro del proyecto la actividad comparte TODO con la sesión (decisión de Jorge, 2026-10-02, corrige la Fase 4):
	  - el campo formativo es el de la sesión, de solo lectura ("Campo formativo: Lenguajes"); si la sesión no tiene
	    campo (caso raro) se deja el selector;
	  - el contenido y los PDA son los de la sesión, de solo lectura: se muestran los PDA que se van a ligar, que son
	    los de la regla de siempre (ProductosHoy.pdaDeSesionParaActividad, los marcados por omisión) y se recalculan al
	    cambiar "¿Para quién?". Sin casillas que se puedan desmarcar, sin "Cambiar", sin "+ Otro contenido" y sin
	    buscador. Sin PDA para esos grados: "Esta sesión no tiene PDA para ese grado: se guarda sin PDA."
	Fuera del proyecto (también abierto desde un bloque de "Actividades del trimestre") queda como en la Fase 4:

	Contenido y PDA fuera del proyecto (opcional). La lectura de los PDA de la sesión trae su contenido del catálogo
	(catalogo_pda(pda, contenido_id, catalogo_contenidos(id, contenido, campo_formativo))): en un bloque de sueltas
	salen ya elegidos los contenidos de la sesión para el campo, cada uno con sus PDA marcados por la regla de siempre
	(ProductosHoy.pdaDeSesionParaActividad). Con ellos, dos botones:
	  - "+ Otro contenido": abre el buscador SIN quitar lo de la sesión y se suman, como era el diálogo antes de la
	    Fase 4 (los PDA de la sesión y los del contenido del catálogo; los que ya están arriba no se repiten abajo);
	  - "Cambiar": el contenido que se elige en el buscador REEMPLAZA a los de la sesión (sus PDA, marcados por
	    ProductosHoy.pdaMarcadosPorOmision; uno que la sesión ya tiene se reutiliza: planLigas); "Usar los de la
	    sesión" regresa.
	Sin contenidos de la sesión para ese campo (otro campo, o fuera del proyecto) el buscador sale directo, como antes,
	y lo que se elige se suma.

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
	  Opcionales de la vista del proyecto (js/proyecto.js, Fase 5; Hoy no los pasa y su diálogo no cambia):
	  soloDentro         true: solo "Dentro del proyecto", en la sesión que llega (el interruptor no se muestra)
	  revisaAlTrabajar   true: una TAREA de una sesión que aún no se trabaja (sin fecha) no pide día de revisión: se
	                     revisa el siguiente día de clase después de trabajar la sesión, como las tareas del plan
	                     (fecha_entrega null; ProductosHoy.validarNuevo con sinFechaRevision)
	Puras (pruebas/actividad-nueva.test.js): contenidosDeSesion, destino, conCampo, campoGuardado, pdaDeSesionALigar.
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
		  dentro                                    → "sesion" (la sesión elegida)
		  fuera, abierto desde un bloque de sueltas → "sesion" (esa misma sesión, como antes de la Fase 4: también
		                                              con otro campo, y una tarea de un bloque de un día que ya pasó)
		  fuera                                     → "suelta" (agregar_actividad_suelta: la sesión de ese día y campo)
		d: { modo, suelta: la sesión del bloque | null }
	*/
	function destino(d) {
		d = d || {};
		if (d.modo === "dentro") return "sesion";
		return d.suelta ? "sesion" : "suelta";
	}

	/*
		El campo formativo que se guarda. Dentro del proyecto (fijo) es el de la sesión; si no, el que eligió el docente.
		d: { fijo, campoSesion, campoElegido }
	*/
	function campoGuardado(d) {
		d = d || {};
		return d.fijo ? d.campoSesion : d.campoElegido;
	}

	/*
		Los PDA de la sesión que se ligan (ids de sesiones_pda). visibles: los de pdaDeSesionParaActividad (con
		`marcado`, la regla de siempre). d: { fijo, modo ("sesion" | "otro" | "cambiar"), tocados: { id: bool } }.
		  fijo (dentro del proyecto): exactamente los marcados por la regla; lo que el docente "tocó" no cuenta;
		  si no: los marcados por el docente o, si no los tocó, por la regla; con "Cambiar", ninguno de la sesión.
	*/
	function pdaDeSesionALigar(visibles, d) {
		d = d || {};
		var lista = visibles || [];
		if (d.fijo) return lista.filter(function (r) { return !!r.marcado; }).map(function (r) { return r.id; });
		if (d.modo === "cambiar" || !lista.length) return [];
		var tocados = d.tocados || {};
		return lista.filter(function (r) {
			return Object.prototype.hasOwnProperty.call(tocados, r.id) ? tocados[r.id] : !!r.marcado;
		}).map(function (r) { return r.id; });
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

	// "2026-09-24" → "24 sep"
	function fechaCorta(iso) {
		var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		return m ? Number(m[3]) + " " + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m[2]) - 1] : "";
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
			tocadosSesion: {}, marcadosCatalogo: {},
			// Con los contenidos de la sesión: "sesion" (solo ellos), "otro" (+ Otro contenido: ellos y el buscador, se
			// suman, como antes de la Fase 4) o "cambiar" (el buscador los reemplaza)
			modo: "sesion" };
		var cargaPda = null; // la lectura de los PDA de la sesión (alAceptar la espera)
		var lecturaSpda = 0;  // la última lectura pedida (una que llega tarde no pisa a la de otra sesión)

		// ── El contexto: la sesión de la que salen el campo, los grados por omisión y los PDA ──
		// La sesión cuyos PDA se ofrecen: la elegida (dentro) o la del bloque de sueltas (fuera)
		function sesionPda() { return st.modo === "dentro" ? st.sesion : suelta; }
		function campoSesion() {
			var s = sesionPda();
			return s ? corto(s.campo_formativo) : null;
		}
		// Dentro del proyecto el campo y los PDA son los de la sesión (solo lectura). Sin campo en la sesión (caso raro): como en fuera
		function campoFijo() { return st.modo === "dentro" && !!st.sesion && !!campoSesion(); }
		function porOmision() {
			var s = sesionPda();
			return s && ctx.gradosDeLaSesion ? ctx.gradosDeLaSesion(s) : gradosGrupo;
		}
		function tipoElegido() { return refs.tipo ? (refs.tipo.querySelector("input:checked") || {}).value : "trabajo"; }
		function destinoActual() { return destino({ modo: st.modo, suelta: suelta }); }
		// Vista del proyecto (ctx.revisaAlTrabajar): la sesión elegida aún no se trabaja → la tarea se revisa después de
		// trabajarla (sin día de revisión). En Hoy siempre es false: sus sesiones son de hoy o siguen en curso
		function alTrabajar() { return !!ctx.revisaAlTrabajar && st.modo === "dentro" && !!st.sesion && !st.sesion.fecha; }
		// El día en que se revisa la tarea (o, con alTrabajar, la nota de cuándo se revisa)
		function pintarFecha() {
			refs.fechaCont.classList.toggle("hidden", tipoElegido() !== "tarea" || alTrabajar());
			if (refs.notaRevision) refs.notaRevision.classList.toggle("hidden", tipoElegido() !== "tarea" || !alTrabajar());
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
			// Vista del proyecto: solo dentro, en la sesión de la que se abrió (el interruptor no se muestra)
			if (ctx.soloDentro) fs.classList.add("hidden");
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

			// Fuera: el día de la actividad (por omisión hoy). Cualquier día del trimestre en curso (decisión de Jorge del
			// 2026-09-26): uno que ya pasó se califica aquí mismo, al agregarla. Abierto desde un bloque de sueltas, en
			// su lugar se dice a qué bloque va (va a esa sesión, como antes)
			var dia = campoTexto("Día de la actividad", { type: "date", min: rango.desde, max: rango.hasta, value: hoy });
			var ayudaDia = document.createElement("span");
			ayudaDia.className = "text-xs font-normal text-gray-500";
			ayudaDia.textContent = "Puede ser un día que ya pasó del trimestre: la calificas aquí mismo al agregarla. Un día que viene aparece en Hoy ese día.";
			dia.cont.appendChild(ayudaDia);
			refs.dia = dia.input;
			refs.diaCont = dia.cont;
			cuerpo.appendChild(dia.cont);
			if (suelta) {
				var bloque = document.createElement("p");
				bloque.setAttribute("data-bloque-suelta", "1");
				bloque.className = "rounded-xl bg-violet-50 border border-violet-200 px-3 py-2.5 text-sm text-gray-800";
				bloque.innerHTML = "<span class='block text-xs text-gray-500'>Se agrega a</span>" + esc(raiz.AlcanceHoy.TITULO_SUELTAS) + " · " +
					esc(suelta.campo_formativo || "") + (suelta.fecha && suelta.fecha !== hoy ? " · " + esc(fechaCorta(suelta.fecha)) : " · hoy");
				refs.bloqueCont = bloque;
				cuerpo.appendChild(bloque);
			}

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
			// La tarea suelta se deja hoy: sin día. Desde un bloque de sueltas, el bloque en lugar del día
			refs.diaCont.classList.toggle("hidden", st.modo !== "fuera" || tarea || !!suelta);
			if (refs.bloqueCont) refs.bloqueCont.classList.toggle("hidden", st.modo !== "fuera");
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
			var fijo = campoFijo();
			var valor = !fijo && st.campoTocado ? sel.value : (cs || "");
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
			// Dentro del proyecto: el campo de la sesión, como texto (el selector no se ve ni se puede cambiar)
			sel.disabled = fijo;
			if (refs.campoCont) refs.campoCont.classList.toggle("hidden", fijo);
			if (refs.campoFijo) {
				refs.campoFijo.classList.toggle("hidden", !fijo);
				refs.campoFijo.textContent = fijo ? "Campo formativo: " + campoLargo(cs) : "";
			}
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
			// "+ Otro contenido": el buscador se abre sin quitar lo de la sesión (se suman). "Cambiar": el buscador los reemplaza
			refs.pdaSesion.addEventListener("click", function (e) {
				var b = e.target.closest("[data-otro-contenido], [data-cambiar-contenido]");
				if (!b) return;
				pda.modo = b.hasAttribute("data-otro-contenido") ? "otro" : "cambiar";
				pintarPda();
				refs.busca.focus();
			});
			refs.volver.addEventListener("click", function () {
				pda.modo = "sesion";
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
		// ¿Se ven (y cuentan) los contenidos de la sesión? Sí, salvo con "Cambiar"
		function conContenidosDeSesion(visibles) { return pda.modo !== "cambiar" && visibles.length > 0; }
		// ¿Se ve el buscador? Con "+ Otro contenido", con "Cambiar" o si la sesión no trae contenidos de ese campo
		function conBuscador(visibles) { return pda.modo !== "sesion" || !visibles.length; }

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
			if (campoFijo()) { pintarPdaFijos(visibles); return; }
			var enSesion = conContenidosDeSesion(visibles);
			refs.pdaSesion.innerHTML = "";
			refs.pdaSesion.classList.toggle("hidden", !enSesion);
			refs.buscador.classList.toggle("hidden", !conBuscador(visibles));
			refs.volver.classList.toggle("hidden", pda.modo !== "cambiar" || !visibles.length);
			if (enSesion) {
				var cabeza = document.createElement("div");
				cabeza.className = "flex flex-wrap items-center justify-between gap-x-2";
				cabeza.innerHTML = "<p class='text-xs text-gray-500'>De esta sesión (marca los PDA que esta actividad evalúa):</p>" +
					"<span class='flex flex-wrap gap-1 shrink-0'>" +
					(pda.modo === "sesion"
						? "<button type='button' data-otro-contenido aria-label='Otro contenido: buscar uno más en el catálogo, sin quitar los de la sesión' class='inline-flex items-center gap-1 min-h-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50'>" +
							"<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 5v14'/><path d='M5 12h14'/></svg>Otro contenido</button>"
						: "") +
					"<button type='button' data-cambiar-contenido aria-label='Cambiar el contenido: buscar otro en el catálogo' class='shrink-0 min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-medium text-blue-700 hover:bg-blue-50'>Cambiar</button>" +
					"</span>";
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
			refs.buscaEtiqueta.textContent = campo ? (enSesion ? "Buscar otro contenido de " : "Buscar un contenido de ") + campoLargo(campo) : "Elige el campo formativo para buscar su contenido";
			refs.busca.disabled = !campo || pda.errorCatalogo;
			pintarResultados();
			pintarContenido();
		}

		/*
			Dentro del proyecto: el contenido y los PDA de la sesión, de solo lectura. Se ven los que se van a ligar (los
			marcados por la regla de siempre, pdaDeSesionALigar) como casillas marcadas y deshabilitadas.
		*/
		function pintarPdaFijos(visibles) {
			var ligar = {};
			pdaDeSesionALigar(visibles, { fijo: true }).forEach(function (id) { ligar[id] = true; });
			refs.pdaSesion.innerHTML = "";
			refs.pdaSesion.classList.remove("hidden");
			refs.buscador.classList.add("hidden");
			refs.volver.classList.add("hidden");
			if (pda.errorSpda) {
				refs.pdaSesion.innerHTML = "<p class='text-sm text-gray-600'>No se pudieron leer los PDA de esta sesión: se guarda sin PDA.</p>";
				return;
			}
			var hay = false;
			contenidosDeSesion(visibles).forEach(function (g) {
				var propios = g.pda.filter(function (r) { return ligar[r.id]; });
				if (!propios.length) return;
				if (!hay) {
					hay = true;
					refs.pdaSesion.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>De esta sesión (se ligan estos PDA):</p>");
				}
				var caja = document.createElement("div");
				caja.className = "flex flex-col gap-2 rounded-xl bg-gray-50 border border-gray-200 p-2";
				caja.setAttribute("data-contenido-sesion", g.id || "");
				caja.innerHTML = "<p class='text-sm text-gray-800 px-1'><span class='block text-xs text-gray-500'>" + (g.id ? "Contenido" : "Otros criterios de la sesión") + "</span>" +
					(g.id ? esc(g.contenido || "Contenido del catálogo") : "") + "</p>";
				propios.forEach(function (r) {
					var l = document.createElement("label");
					l.className = "flex items-start gap-3 min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2.5";
					l.innerHTML = "<input type='checkbox' name='pdaSesionFijo' disabled checked class='h-5 w-5 mt-0.5 shrink-0 text-blue-600 rounded'>" +
						"<span class='text-sm text-gray-800'><span class='font-semibold'>" + Number(r.grado) + "°</span> · " + esc(textoPda(r)) + "</span>";
					caja.appendChild(l);
				});
				refs.pdaSesion.appendChild(caja);
			});
			if (!hay) refs.pdaSesion.innerHTML = "<p class='text-sm text-gray-600' data-sin-pda='1'>Esta sesión no tiene PDA para ese grado: se guarda sin PDA.</p>";
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
			// Elegido con el buscador directo (la sesión no traía contenidos de ese campo): se suma, como "+ Otro contenido"
			if (pda.modo === "sesion") pda.modo = "otro";
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
			// Con los contenidos de la sesión a la vista ("+ Otro contenido"), sin repetir los PDA que ya están arriba
			// (planLigas los reutiliza), como antes de la Fase 4. Con "Cambiar", todos
			var visibles = deSesionVisibles();
			var yaArriba = {};
			if (conContenidosDeSesion(visibles)) visibles.forEach(function (r) { if (r.pda_id) yaArriba[r.pda_id + "|" + Number(r.grado)] = true; });
			var deGrados = pda.pdaContenido.filter(function (p) { return g.indexOf(Number(p.grado)) !== -1 && !yaArriba[p.id + "|" + Number(p.grado)]; });
			if (!deGrados.length) {
				var yaEstan = pda.pdaContenido.some(function (p) { return yaArriba[p.id + "|" + Number(p.grado)]; });
				refs.contenido.insertAdjacentHTML("beforeend", "<p class='text-xs text-gray-500'>" + (yaEstan
					? "Sus PDA de estos grados ya están arriba, entre los de esta sesión."
					: "Este contenido no tiene PDA para los grados elegidos.") + "</p>");
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
			Lo elegido al aceptar (de los grados y el campo elegidos), la misma cuenta del diálogo de antes de la Fase 4:
			los PDA marcados de la sesión (salvo con "Cambiar", que los reemplaza) y los marcados del contenido elegido en
			el buscador (planLigas reutiliza el que la sesión ya tiene).
		*/
		function eleccionPda() {
			if (pda.spda === null) return null; // no se leyeron los de la sesión: como antes (sin PDA)
			var g = gradosElegidos();
			var visibles = deSesionVisibles();
			var fijo = campoFijo();
			var deSesion = pdaDeSesionALigar(visibles, { fijo: fijo, modo: pda.modo, tocados: pda.tocadosSesion });
			// Dentro del proyecto no hay buscador: nada del catálogo
			var deCatalogo = fijo ? [] : (pda.pdaContenido || []).filter(function (p) { return pda.marcadosCatalogo[p.id] && g.indexOf(Number(p.grado)) !== -1; })
				.map(function (p) { return { pda_id: p.id, grado: Number(p.grado) }; });
			return { deSesion: deSesion, deCatalogo: deCatalogo, spdaSesion: pda.spda };
		}

		// Otra sesión o el otro lado del interruptor: campo, "¿Para quién?" (si no se tocaron) y los PDA de esa sesión
		function cambioDeContexto() {
			pda.modo = "sesion";
			pda.tocadosSesion = {};
			st.campoTocado = false; // el interruptor o la sesión cambian: el campo vuelve a ser el de la sesión (dentro) o el del bloque (fuera)
			quitarContenido();
			llenarCampos();
			aplicarOmisionPara();
			if (ctx.revisaAlTrabajar) pintarFecha(); // otra sesión: con fecha o sin ella (la vista del proyecto)
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
				// Vista del proyecto: una tarea de una sesión que aún no se trabaja se revisa después de trabajarla
				if (ctx.revisaAlTrabajar) {
					var nota = document.createElement("p");
					nota.setAttribute("data-revision-al-trabajar", "1");
					nota.className = "hidden rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm text-gray-700";
					nota.textContent = "La tarea se revisa el siguiente día de clase después de trabajar esta sesión, como las tareas del plan.";
					refs.notaRevision = nota;
					cuerpo.appendChild(nota);
				}

				var grados = construirParaQuien(porOmision());
				cuerpo.appendChild(grados);
				mostrarPara();

				var campo = document.createElement("label");
				campo.className = "flex flex-col gap-1 text-sm font-medium text-gray-700";
				campo.textContent = "Campo formativo";
				refs.campoCont = campo;
				var sel = document.createElement("select");
				sel.setAttribute("data-campo", "1");
				sel.className = "min-h-[44px] w-full rounded-xl border border-gray-300 px-3 text-base font-normal text-gray-800 bg-white";
				refs.campo = sel;
				var campoFijoTxt = document.createElement("p");
				campoFijoTxt.setAttribute("data-campo-fijo", "1");
				campoFijoTxt.className = "hidden rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm text-gray-800";
				refs.campoFijo = campoFijoTxt;
				llenarCampos();
				campo.appendChild(sel);
				cuerpo.appendChild(campo);
				cuerpo.appendChild(campoFijoTxt);

				construirPda(cuerpo);
				pintarDonde();

				tipo.addEventListener("change", function () {
					pintarFecha();
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
					campo: campoGuardado({ fijo: campoFijo(), campoSesion: campoSesion(), campoElegido: refs.campo.value }),
					grados: plan.grados,
					incluidos: plan.incluidos,
					fechaRevision: refs.fecha.value,
					fecha: st.modo === "fuera" && !suelta ? refs.dia.value : null,
				};
				var hacia = destinoActual();
				var esSuelta = hacia === "suelta";
				var ctxV = { hoy: hoy, gradosSesion: porOmision(), desde: esSuelta ? rango.desde : undefined, hasta: esSuelta ? rango.hasta : undefined };
				// Vista del proyecto: la tarea de una sesión que aún no se trabaja no lleva día de revisión (en Hoy, nunca)
				if (!esSuelta && alTrabajar()) ctxV.sinFechaRevision = true;
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
						p_asignacion: plan.filas, p_crear: ligas.crear })
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
		abrir: abrir, contenidosDeSesion: contenidosDeSesion, destino: destino, conCampo: conCampo,
		campoGuardado: campoGuardado, pdaDeSesionALigar: pdaDeSesionALigar,
	};
	raiz.ActividadNueva = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
