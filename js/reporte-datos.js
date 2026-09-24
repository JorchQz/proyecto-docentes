/*
	reporte-datos.js — Capa de datos compartida de los reportes de Mi salón (B.8):
	boleta imprimible, reporte detallado, presentación de junta y exportación.

	No calcula nada por su cuenta: junta lo que ya existe.
	  - Calificaciones y rubros: js/motor-calificacion.js (motor único).
	  - Calificación oficial: la CONFIRMADA por el maestro en boleta_trimestral. Lo no
	    confirmado es "pendiente", nunca un número (Acuerdo 10/09/23, art. 4 XI).
	  - Textos: los que el maestro dejó en la boleta; si no hay, la propuesta de la
	    Capa 1 (js/textos-boleta.js).
	  - Cuaderno, habilidades y PPM: evaluacion_diagnostica + bandas_ppm. Las habilidades de
	    matemáticas que se muestran son las del grado visible (alumnoVisible: el del cierre si
	    la boleta está cerrada), con CatalogoHabilidades.matematicasDeGrado.
	  - Boleta cerrada: TODO sale de la foto del cierre (texto_autogenerado.cierre de la fila
	    GEN): grado, fase, escala, banda de PPM, porcentajes y desglose por rubro, pesos,
	    avance por PDA, diagnóstico, asistencia y trabajo diario (decisiones de Jorge 6 y 7).
	    alumnoTrimestre y grupoTrimestre ya la aplican; las cerradas antes de que la foto
	    guardara algo caen, dato por dato, a lo de hoy.
	  - Juicio docente sin evidencias (decisión 5): juicioSinEvidencias.

	Requiere (en este orden): supabase.js, grupo-activo.js, campos-formativos.js,
	catalogo-habilidades.js, motor-calificacion.js, textos-boleta.js, reglas-entidad.js.
	Escala, piso y acreditación salen de js/reglas-entidad.js (regla nacional; punto único
	para variantes por estado, decisión 21).
*/

(function () {
	"use strict";

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var NOMBRE_CAMPO = {
		LEN: "Lenguajes",
		SAB: "Saberes y Pensamiento Científico",
		ETI: "Ética, Naturaleza y Sociedades",
		DHL: "De lo Humano y lo Comunitario",
	};
	// Colores NEM por campo (docs/MISION-PARTE-B.md §1.3)
	var COLOR_CAMPO = { LEN: "#059669", SAB: "#ea580c", ETI: "#7c3aed", DHL: "#0284c7" };
	// Badge por grado en reportes multigrado
	var COLOR_GRADO = { 1: "#0891b2", 2: "#16a34a", 3: "#ca8a04", 4: "#d97706", 5: "#2563eb", 6: "#059669" };

	/*
		Reglas de evaluación (escala por grado, acreditación, decimales): js/reglas-entidad.js.
		Hoy la regla nacional para todas las entidades; ver ahí cómo activar una variante.
		Sin ese script no se inventa una escala: se avisa y se lanza.
	*/
	function reglas() {
		var R = typeof window !== "undefined" ? window.ReglasEntidad : null;
		if (!R && typeof require === "function") {
			try { R = require("./reglas-entidad.js"); } catch (e) { /* navegador sin el script */ }
		}
		if (!R) throw new Error("reporte-datos: falta js/reglas-entidad.js (escala y acreditación)");
		return R.regla();
	}

	var PAGINA = 1000;
	async function todas(construir) {
		var filas = [], desde = 0;
		for (;;) {
			var res = await construir().range(desde, desde + PAGINA - 1);
			if (res.error) throw res.error;
			var lote = res.data || [];
			filas = filas.concat(lote);
			if (lote.length < PAGINA) return filas;
			desde += PAGINA;
		}
	}

	function esc(s) {
		return String(s === null || s === undefined ? "" : s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/*
		contexto(sb) → { maestroId, maestroNombre, grupo, grupos, alumnos, ciclo, escuela,
		                 bandas: {grado: fila}, plantillas: {clave: texto} }
		null si no hay sesión (la página decide a dónde mandar).
	*/
	async function contexto(sb) {
		var ses = await sb.auth.getSession();
		var session = ses && ses.data ? ses.data.session : null;
		if (!session) return null;
		var maestroId = session.user.id;

		var activo = await window.GrupoActivo.cargar(sb, maestroId);
		var grupo = activo.grupo;
		var alumnos = [];
		if (grupo) {
			var alRes = await sb.from("alumnos").select("id, nombre_completo, num_lista, grado")
				.eq("maestro_id", maestroId).eq("grupo_id", grupo.id).eq("estatus", "activo")
				.order("grado").order("num_lista");
			if (alRes.error) throw alRes.error;
			alumnos = alRes.data || [];
		}

		var perfilRes = await sb.from("perfiles").select("nombre_completo, escuela, estado").eq("id", maestroId).maybeSingle();
		// Un error se lanza: la página dice que no pudo, en vez de imprimir sin escuela ni
		// docente, o sin bandas de lectura y sugerencias
		if (perfilRes.error) throw perfilRes.error;
		var perfil = perfilRes.data || {};

		var bandasRes = await sb.from("bandas_ppm").select("*");
		if (bandasRes.error) throw bandasRes.error;
		var bandas = {};
		(bandasRes.data || []).forEach(function (b) { bandas[b.grado] = b; });

		var plantillasRes = await sb.from("plantillas_sugerencia").select("clave, texto").eq("activo", true);
		if (plantillasRes.error) throw plantillasRes.error;
		var plantillas = {};
		(plantillasRes.data || []).forEach(function (p) { plantillas[p.clave] = p.texto; });

		return {
			maestroId: maestroId,
			maestroNombre: perfil.nombre_completo || "",
			grupo: grupo,
			grupos: activo.grupos,
			alumnos: alumnos,
			ciclo: grupo ? (grupo.ciclo_escolar || "") : "",
			escuela: (grupo && grupo.escuela) || perfil.escuela || "",
			// Entidad de la maestra (decisión 21). Hoy no cambia ninguna regla
			// (js/reglas-entidad.js); queda aquí para cuando se active una variante
			estado: perfil.estado || "",
			bandas: bandas,
			plantillas: plantillas,
		};
	}

	/*
		Calificación que vale para cualquier reporte: solo la confirmada por el maestro.
		Una confirmada que quedó FUERA de la escala del grado de hoy (fueraDeEscala: un 5
		confirmado en 2° a 6° y después el alumno pasó a 1°) no vale: es "pendiente" hasta
		que el maestro elija y confirme de nuevo (art. 4 XI: nada numérico sin confirmación
		explícita). gradoHoy es opcional: si no se da, el que anotó quien leyó la fila.
	*/
	function calificacionOficial(filaBoleta, gradoHoy) {
		if (!filaBoleta || !filaBoleta.calificacion_confirmada || filaBoleta.calificacion === null || filaBoleta.calificacion === undefined) {
			return { valor: null, confirmada: false, cerrada: false, pendiente: true };
		}
		var fuera = fueraDeEscala(filaBoleta, gradoHoy);
		if (fuera) return { valor: null, confirmada: false, cerrada: false, pendiente: true, fueraDeEscala: fuera };
		return { valor: Number(filaBoleta.calificacion), confirmada: true, cerrada: !!filaBoleta.cerrada, pendiente: false };
	}

	/*
		Grado de HOY del alumno, anotado en sus filas de boleta_trimestral al leerlas
		(_gradoHoy; solo vive en memoria, nunca se escribe en la base). Con él,
		calificacionOficial sabe si una confirmada sigue dentro de la escala del grado.
		filas: una fila, un arreglo o un objeto {campo: fila}.
	*/
	function anotarGradoHoy(filas, grado) {
		if (!filas) return filas;
		var lista = Array.isArray(filas) ? filas : (filas.campo !== undefined || filas.alumno_id !== undefined ? [filas] : Object.keys(filas).map(function (k) { return filas[k]; }));
		lista.forEach(function (f) { if (f && typeof f === "object") f._gradoHoy = vacio(grado) ? null : Number(grado); });
		return filas;
	}

	/*
		¿La calificación confirmada de una boleta ABIERTA quedó fuera de la escala del grado
		de hoy? → null si está bien (o no aplica) o { valor, grado, piso, escala }.
		Pasa al cambiar el grado del alumno después de confirmar (de 2° a 6° a 1°, donde el
		mínimo es 6). Lo cerrado no se revisa: se entregó con la escala de su cierre.
		La base aplica el mismo piso (trigger boleta_trimestral_piso_fase) y rechaza
		cualquier escritura en esa fila hasta que se confirme dentro de la escala.
	*/
	function fueraDeEscala(fila, gradoHoy) {
		if (!fila || !fila.calificacion_confirmada || fila.cerrada || vacio(fila.calificacion)) return null;
		var g = gradoHoy !== undefined ? gradoHoy : fila._gradoHoy;
		if (vacio(g)) return null;
		var piso = pisoDeGrado(g);
		if (!piso) return null;
		var v = Number(fila.calificacion);
		if (v >= piso && v <= 10) return null;
		return { valor: v, grado: Number(g), piso: piso, escala: piso + " a 10" };
	}
	// "El 5 confirmado no es válido en 1° (escala 6 a 10): elige y confirma de nuevo."
	function textoFueraDeEscala(fuera) {
		if (!fuera) return "";
		return "El " + fuera.valor + " confirmado no es válido en " + fuera.grado + "° (escala " + fuera.escala + "): elige y confirma de nuevo.";
	}

	/*
		Defensa del cierre: "Cerrar boleta" manda a cerrar_boleta EXACTAMENTE lo confirmado en
		la base, nunca un número que la pantalla puso por su cuenta (un selector sin la opción
		confirmada muestra otra).
		pantalla:  [{campo, calificacion}] lo que se ve en los selectores
		filasBase: filas de boleta_trimestral del trimestre, leídas justo antes de cerrar
		gradoHoy:  el grado del alumno leído también en ese momento
		→ { ok: true, calificaciones: [{campo, calificacion}] (de la base) } o
		  { ok: false, motivo } si algún campo no está confirmado, quedó fuera de la escala,
		  ya está cerrado o no coincide con la pantalla.
	*/
	function validarCierre(pantalla, filasBase, gradoHoy) {
		var enPantalla = {};
		(pantalla || []).forEach(function (p) { enPantalla[p.campo] = p.calificacion; });
		var base = {};
		(filasBase || []).forEach(function (f) { base[f.campo] = f; });
		var calificaciones = [], problemas = [];
		CAMPOS.forEach(function (c) {
			var fila = base[c];
			var nombre = NOMBRE_CAMPO[c];
			if (!fila || !fila.calificacion_confirmada || vacio(fila.calificacion)) {
				problemas.push(nombre + " no tiene calificación confirmada");
				return;
			}
			if (fila.cerrada) { problemas.push(nombre + " ya está cerrada"); return; }
			var fuera = fueraDeEscala(fila, gradoHoy);
			if (fuera) {
				problemas.push(nombre + ": el " + fuera.valor + " confirmado no es válido en " + fuera.grado + "° (escala " + fuera.escala + "), elige y confirma de nuevo");
				return;
			}
			var vista = enPantalla[c];
			if (vacio(vista) || Number(vista) !== Number(fila.calificacion)) {
				problemas.push(nombre + ": en pantalla " + (vacio(vista) ? "no hay número elegido" : "dice " + vista) +
					" y la calificación confirmada es " + Number(fila.calificacion) + " (pulsa «Guardar ajustes» para confirmar lo que elegiste)");
				return;
			}
			calificaciones.push({ campo: c, calificacion: Number(fila.calificacion) });
		});
		if (problemas.length) return { ok: false, motivo: problemas.join("; ") + "." };
		return { ok: true, calificaciones: calificaciones };
	}

	/*
		Boleta cerrada = los cuatro campos del trimestre cerrados (el botón "Cerrar boleta"
		los cierra juntos). Desde ahí lo entregado queda fijo en todos los reportes:
		calificación y porcentaje guardados, los textos guardados (también los de la fila
		GEN, que no lleva calificación y por eso la base no la marca cerrada) y el trabajo
		diario de la foto del cierre. filasTrimestre = {LEN: fila, SAB: fila, ...}.
	*/
	function boletaCerrada(filasTrimestre) {
		if (!filasTrimestre) return false;
		return CAMPOS.every(function (c) { return !!(filasTrimestre[c] && filasTrimestre[c].cerrada); });
	}

	// Lo que se congeló al cerrar: texto_autogenerado.cierre de la fila GEN
	function fotoCierre(filaGeneral) {
		var t = filaGeneral && filaGeneral.texto_autogenerado;
		return t && t.cierre && typeof t.cierre === "object" ? t.cierre : null;
	}

	/*
		Diagnóstico como se entregó. Con la boleta cerrada, cuaderno, lectura y matemáticas
		salen de la foto del cierre (texto_autogenerado.cierre.diagnostico de la fila GEN),
		no de lo que se edite después en Evaluación diagnóstica. null en la foto = no había
		diagnóstico al cerrar. Boletas cerradas antes de la foto: el diagnóstico de hoy.
	*/
	var CAMPOS_DIAGNOSTICO = ["cuaderno", "lectura_ppm", "lectura_comprension", "matematicas"];
	function diagnosticaVisible(diagnostica, filaGeneral, cerrada) {
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		if (!foto || !Object.prototype.hasOwnProperty.call(foto, "diagnostico")) return diagnostica;
		if (!foto.diagnostico) return null;
		return Object.assign({}, diagnostica || {}, foto.diagnostico);
	}
	// Asistencia de referencia como se entregó (foto del cierre); sin foto, la de hoy
	function asistenciaVisible(asistencia, filaGeneral, cerrada) {
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		return foto && foto.asistencia ? foto.asistencia : asistencia;
	}
	function fotoAsistencia(asistencia) {
		if (!asistencia) return null;
		return { presentes: asistencia.presentes, total: asistencia.total, porcentaje: asistencia.porcentaje };
	}
	function fotoDiagnostico(diagnostica) {
		if (!diagnostica) return null;
		var foto = {};
		CAMPOS_DIAGNOSTICO.forEach(function (k) { foto[k] = diagnostica[k] === undefined ? null : diagnostica[k]; });
		return foto;
	}

	function vacio(v) { return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v)); }
	function tiene(obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); }

	/*
		Fase y escala. La fase es la del Plan de estudio (1° y 2° Fase 3, 3° y 4° Fase 4, 5°
		y 6° Fase 5). La escala va por GRADO, no por fase (decisión 17b: 1° de 6 a 10; 2° a
		6° de 5 a 10, con 5 no aprobatorio) y sale de js/reglas-entidad.js. Solo rotulan: el
		piso lo garantiza la base (piso_calificacion_boleta + trigger
		boleta_trimestral_piso_fase) y la conversión de porcentaje a número es solo
		calcular_calificacion_boleta.
	*/
	function faseDeGrado(grado) {
		var g = Number(grado);
		if (!(g >= 1 && g <= 6)) return null;
		return g <= 2 ? 3 : (g <= 4 ? 4 : 5);
	}
	// 1°: "6 a 10; 1° se acredita con haberlo cursado"; 2° a 6°: "5 a 10; 5 no es aprobatoria"
	function escalaDeGrado(grado) { return reglas().escalaDeGrado(grado); }
	// Calificación mínima que se puede elegir en la boleta: 6 en 1°, 5 de 2° a 6°
	function pisoDeGrado(grado) { return reglas().pisoDeGrado(grado); }

	/*
		Foto del cierre, segunda parte (decisiones de Jorge 6 y 7, 2026-09-24). Además del
		trabajo diario, el diagnóstico y la asistencia, al cerrar se guardan:
		  alumno:     grado, fase, escala y banda de PPM de su grado (estándar de lectura)
		  campos:     por campo, porcentaje (truncado a 2 decimales, igual que la fila),
		              semáforo, desglose por rubro y si no había evidencias (juicio docente)
		  pesos:      los pesos con que se calculó
		  avance_pda: el avance por PDA del alumno
		Todo documento de una boleta cerrada lee esto; si después cambia el grado, las
		capturas o los pesos, lo entregado no se mueve. Las boletas cerradas antes de esta
		foto no traen estas claves: entonces cada dato cae a lo de hoy, sin romperse.
	*/
	function truncar2(p) {
		return vacio(p) ? null : Math.floor(Number(p) * 100 + 1e-9) / 100;
	}
	function fotoAlumno(alumno, banda) {
		var grado = alumno && !vacio(alumno.grado) ? Number(alumno.grado) : null;
		var fase = faseDeGrado(grado);
		return {
			grado: grado, fase: fase, escala: escalaDeGrado(grado),
			banda_ppm: banda ? {
				grado: banda.grado === undefined ? grado : banda.grado,
				requiere_apoyo_max: banda.requiere_apoyo_max, cercano_max: banda.cercano_max, estandar_max: banda.estandar_max,
			} : null,
		};
	}
	function fotoCampos(porCampo) {
		var salida = {};
		CAMPOS.forEach(function (c) {
			var pc = (porCampo && porCampo[c]) || {};
			// Todo lo que el motor da por rubro (obtenido, máximo, fracción, peso y los conteos
			// que usa la Capa 1, como entrega y días del registro diario), copiado tal cual
			var rubros = {};
			Object.keys(pc.rubros || {}).forEach(function (r) {
				var x = pc.rubros[r] || {};
				rubros[r] = JSON.parse(JSON.stringify(x));
				if (rubros[r].fraccion === undefined) rubros[r].fraccion = null;
			});
			var pct = truncar2(pc.porcentaje);
			salida[c] = { porcentaje: pct, nivel: pc.nivel || null, sin_evidencias: pct === null, rubros: rubros };
		});
		return salida;
	}
	function fotoAvancePda(filas) {
		return (filas || []).map(function (f) {
			var copia = Object.assign({}, f);
			delete copia.maestro_id;
			delete copia.grupo_id;
			return copia;
		});
	}

	// Lo que la foto guardó del alumno (null en boletas cerradas antes de guardarlo)
	function alumnoCierre(foto) {
		return foto && foto.alumno && typeof foto.alumno === "object" && !vacio(foto.alumno.grado) ? foto.alumno : null;
	}
	// El alumno como se entregó: con el grado de la foto
	function alumnoVisible(alumno, foto) {
		var a = alumnoCierre(foto);
		return a ? Object.assign({}, alumno, { grado: Number(a.grado) }) : alumno;
	}
	// Banda de PPM como se entregó (la foto puede decir que no había banda: null)
	function bandaVisible(banda, foto) {
		var a = alumnoCierre(foto);
		return a && tiene(a, "banda_ppm") ? a.banda_ppm : banda;
	}
	function faseVisible(grado, foto) {
		var a = alumnoCierre(foto);
		return a && a.fase ? Number(a.fase) : faseDeGrado(grado);
	}
	function escalaVisible(grado, foto) {
		var a = alumnoCierre(foto);
		// Boletas cerradas: la escala que guardó su foto (una de 2° cerrada antes de la
		// decisión 17b sigue diciendo "6 a 10"); si no la guardó, la del grado
		return a && a.escala ? String(a.escala) : escalaDeGrado(grado);
	}
	// porCampo como el del motor, pero del cierre (null si la foto no lo guardó)
	function porCampoCierre(foto) {
		if (!foto || !foto.campos || typeof foto.campos !== "object") return null;
		var salida = {};
		CAMPOS.forEach(function (c) {
			var x = foto.campos[c] || {};
			salida[c] = {
				rubros: x.rubros || {},
				porcentaje: vacio(x.porcentaje) ? null : Number(x.porcentaje),
				nivel: x.nivel || null,
				calificacionPropuesta: null, // cerrada: la calificación es la confirmada
				sinEvidencias: !!x.sin_evidencias,
			};
		});
		return salida;
	}
	/*
		Boleta cerrada ANTES de que existiera la foto completa: no hay desglose del cierre,
		pero el porcentaje y el semáforo de cada fila sí son los del cierre. Lo cerrado nunca
		lee en vivo: el porcentaje es el de la fila, y un campo sin porcentaje (juicio docente,
		sin evidencias al cierre) queda sin porcentaje ni desglose aunque después se capture
		algo en él. En los demás campos el desglose es el de hoy (las pantallas lo avisan).
		porCampoVivo: el del motor de hoy.
	*/
	function porCampoFilas(boletaT, porCampoVivo) {
		var salida = {};
		CAMPOS.forEach(function (c) {
			var fila = (boletaT && boletaT[c]) || {};
			var vivo = (porCampoVivo && porCampoVivo[c]) || { rubros: {} };
			var sin = vacio(fila.porcentaje);
			salida[c] = Object.assign({}, vivo, {
				rubros: sin ? {} : (vivo.rubros || {}),
				porcentaje: sin ? null : Number(fila.porcentaje),
				nivel: sin ? null : (fila.nivel || vivo.nivel || null),
				calificacionPropuesta: null, // cerrada: la calificación es la confirmada
				sinEvidencias: sin,
			});
		});
		return salida;
	}

	function avancePdaCierre(foto) {
		return foto && Array.isArray(foto.avance_pda) ? foto.avance_pda : null;
	}

	/*
		¿La calificación confirmada de este campo fue por juicio docente, sin evidencias
		registradas? (decisión de Jorge 5: el maestro la elige con "Elige", dentro de la
		escala de su fase). Nunca se inventa un porcentaje: se dice que no lo hubo.
		  - boleta cerrada con la foto completa: lo que dice la foto
		  - boleta cerrada antes de esa foto: la fila sin porcentaje
		  - abierta con el motor de hoy (pcVivo): el campo sin porcentaje hoy
		  - abierta sin motor (otro trimestre): la fila sin porcentaje (al generar la boleta
		    se guarda el porcentaje de todo campo con evidencias)
	*/
	function juicioSinEvidencias(boletaT, campo, pcVivo) {
		var fila = boletaT ? boletaT[campo] : null;
		if (!calificacionOficial(fila).confirmada) return false;
		if (boletaCerrada(boletaT)) {
			var foto = fotoCierre(boletaT.GEN);
			if (foto && foto.campos && foto.campos[campo]) return !!foto.campos[campo].sin_evidencias;
			return vacio(fila.porcentaje);
		}
		if (pcVivo && typeof pcVivo === "object") return vacio(pcVivo.porcentaje);
		return vacio(fila.porcentaje);
	}

	/*
		Promedios de calificaciones: con un número entero y un decimal, TRUNCADO, no
		redondeado (decisión de Jorge del 2026-09-24). El Acuerdo 10/09/23 (art. 9) pide "los
		promedios con un número entero y un decimal" sin decir cómo cortar; las normas de
		control escolar de la SEP anteriores dicen "no se deben redondear", y la app ya trunca
		el porcentaje. Se cuenta en décimas enteras para que 7.6 no salga 7.5999.
	*/
	function decimas(v) { return Math.round(Number(v) * 10); }
	function promedioTruncado(valores) {
		var nums = valores.filter(function (v) { return v !== null && v !== undefined && v !== "" && !isNaN(v); });
		if (!nums.length) return null;
		var suma = nums.reduce(function (a, v) { return a + decimas(v); }, 0);
		return Math.floor(suma / nums.length + 1e-9) / 10;
	}
	// Promedio de calificaciones confirmadas (enteros por campo) con un decimal, truncado
	function promedio(valores) { return promedioTruncado(valores); }

	/*
		Evaluación final del ciclo (Acuerdo 10/09/23: art. 7 III b, "tres evaluaciones
		parciales [...] y una final" por campo formativo; art. 9, acreditación). Como en las
		boletas oficiales de la DGAIR 2024-2025: por campo, T1, T2, T3 y el promedio final;
		el promedio final de grado; y si acredita.
		  - Final por campo: promedio de las tres calificaciones CONFIRMADAS (calificacionOficial;
		    las cerradas conservan su número), truncado a un decimal. Falta una → null.
		  - Promedio final de grado: promedio de las cuatro finales, truncado a un decimal.
		  - Acreditación (art. 9 y decisión 18b; umbrales en js/reglas-entidad.js). Solo con
		    los tres trimestres de los cuatro campos confirmados; antes, "pendiente": nunca un
		    número parcial como final.
		      1°: "acredita" siempre (se acredita con haber cursado el grado).
		      2° a 6°: "acredita" si el promedio final de grado y las cuatro finales por campo
		      llegan a 6.0; "revisar" si el promedio llega pero algún campo no (algunas
		      entidades exigen 6 en cada campo: lo confirma control escolar; nunca "no
		      acredita" solo por eso); "no_acredita" si el promedio es menor que 6.0.
		  - Grado: el de la foto del cierre del 3er trimestre si está cerrado (lo entregado);
		    si no, el que da quien llama (el de hoy o el del cierre del trimestre que se ve).
		boletaCiclo = {1: {LEN: fila, ...}, 2: {...}, 3: {...}}
		→ { porCampo: {LEN: n|null, ...}, promedio: n|null, completo, faltan (calificaciones
		    sin confirmar, de 12), grado,
		    acreditacion: "acredita"|"revisar"|"no_acredita"|"pendiente",
		    camposBajoMinimo: ["LEN", ...] (finales debajo del mínimo por campo; vacío en 1°),
		    explicacion: texto corto para "revisar" ("" en los demás casos) }
	*/
	var TRIMESTRES = [1, 2, 3];
	var ACREDITA = "acredita", REVISAR = "revisar", NO_ACREDITA = "no_acredita", PENDIENTE = "pendiente";
	var ETIQUETA_ACREDITACION = { acredita: "Acredita", revisar: "Revisar", no_acredita: "No acredita", pendiente: "pendiente" };
	// Color de la acreditación en las pantallas con Tailwind (reporte, pestaña Boleta, Concentrado)
	var COLOR_ACREDITACION_TW = { acredita: "text-emerald-700", revisar: "text-amber-700", no_acredita: "text-red-700", pendiente: "text-gray-500 italic" };
	// "LEN" | "LEN y SAB" | "LEN, SAB y ETI"
	function listaCampos(campos) {
		if (campos.length <= 1) return campos.join("");
		return campos.slice(0, -1).join(", ") + " y " + campos[campos.length - 1];
	}
	/*
		Explicación de "Revisar" (decisión 18b), la misma en los cinco documentos:
		"Promedio de 6 o más, pero LEN tiene menos de 6. Algunas entidades exigen mínimo 6 en
		cada campo; confírmalo con tu control escolar."
	*/
	function explicacionRevisar(camposBajo, minimoPromedio, minimoCampo) {
		if (!camposBajo || !camposBajo.length) return "";
		return "Promedio de " + minimoPromedio + " o más, pero " + listaCampos(camposBajo) +
			(camposBajo.length === 1 ? " tiene" : " tienen") + " menos de " + minimoCampo +
			". Algunas entidades exigen mínimo " + minimoCampo + " en cada campo; confírmalo con tu control escolar.";
	}
	/*
		Boleta imprimible (la ven las familias): "Revisar" y "confírmalo con tu control
		escolar" son para la maestra. Ahí la acreditación dice que la escuela la confirmará
		y la explicación usa el nombre completo del campo, sin códigos:
		"El promedio final es de 6 o más; Saberes y Pensamiento Científico quedó debajo de 6."
		Las pantallas de la maestra y la exportación siguen con "Revisar".
	*/
	var ACREDITACION_REVISAR_FAMILIAS = "la escuela la confirmará con control escolar";
	function explicacionRevisarFamilias(camposBajo) {
		if (!camposBajo || !camposBajo.length) return "";
		var A = reglas().acreditacion;
		return "El promedio final es de " + A.promedioMinimo + " o más; " +
			listaCampos(camposBajo.map(function (c) { return NOMBRE_CAMPO[c] || c; })) +
			(camposBajo.length === 1 ? " quedó" : " quedaron") + " debajo de " + A.campoMinimo + ".";
	}
	function reglaAcreditacionTextoFamilias(grado) {
		var A = reglas().acreditacion;
		if (Number(grado) === 1 && A.primeroConCursar) return "En 1° se acredita con haber cursado el grado.";
		return "De 2° a 6° se acredita con un promedio final de grado mínimo de " + A.promedioMinimo +
			"; si el promedio llega pero algún campo queda debajo de " + A.campoMinimo +
			", la escuela confirma la acreditación con control escolar.";
	}
	function finalCiclo(boletaCiclo, grado) {
		var ciclo = boletaCiclo || {};
		var porCampo = {}, faltan = 0;
		CAMPOS.forEach(function (c) {
			var valores = TRIMESTRES.map(function (t) { return calificacionOficial((ciclo[t] || {})[c]).valor; });
			var sin = valores.filter(function (v) { return v === null; }).length;
			faltan += sin;
			porCampo[c] = sin ? null : promedioTruncado(valores);
		});
		var completo = faltan === 0;
		var prom = completo ? promedioTruncado(CAMPOS.map(function (c) { return porCampo[c]; })) : null;
		// Grado del cierre del 3er trimestre (lo entregado), si no el que se recibe
		var t3 = ciclo[3] || {};
		var ac = boletaCerrada(t3) ? alumnoCierre(fotoCierre(t3.GEN)) : null;
		var g = ac ? Number(ac.grado) : (vacio(grado) ? null : Number(grado));
		var A = reglas().acreditacion;
		var acreditacion = PENDIENTE, camposBajoMinimo = [], explicacion = "";
		if (completo) {
			if (g === 1 && A.primeroConCursar) {
				acreditacion = ACREDITA;
			} else if (prom < A.promedioMinimo) {
				acreditacion = NO_ACREDITA;
			} else {
				camposBajoMinimo = CAMPOS.filter(function (c) { return porCampo[c] < A.campoMinimo; });
				acreditacion = camposBajoMinimo.length ? REVISAR : ACREDITA;
				explicacion = explicacionRevisar(camposBajoMinimo, A.promedioMinimo, A.campoMinimo);
			}
		}
		return {
			porCampo: porCampo, promedio: prom, completo: completo, faltan: faltan, grado: g,
			acreditacion: acreditacion, camposBajoMinimo: camposBajoMinimo, explicacion: explicacion,
		};
	}
	// Regla de acreditación en una frase, para las notas de los documentos
	function reglaAcreditacionTexto(grado) {
		var A = reglas().acreditacion;
		if (Number(grado) === 1 && A.primeroConCursar) return "En 1° se acredita con haber cursado el grado.";
		return "De 2° a 6° se acredita con un promedio final de grado mínimo de " + A.promedioMinimo +
			"; si el promedio llega pero algún campo queda debajo de " + A.campoMinimo +
			", dice «Revisar» (algunas entidades exigen " + A.campoMinimo + " en cada campo).";
	}
	/*
		Nota que acompaña a toda final y a todo promedio final de grado (boleta imprimible,
		reporte detallado, pestaña Boleta y Concentrado de Reportes): el número es un cálculo
		de apoyo; el oficial lo calcula SIGED. Truncar o redondear sigue pendiente de Jorge:
		aquí solo se dice lo que hace Mi salón hoy.
	*/
	var NOTA_FINAL_APOYO = "Cálculo de apoyo: el promedio oficial lo calcula SIGED. Mi salón lo trunca a un decimal.";

	/*
		Peso con el que la conducta entró a la calificación de una boleta cerrada, según su
		foto del cierre (texto_autogenerado.cierre de la fila GEN). Las boletas cerradas antes
		del 2026-09-24 conservan la conducta con peso (5 de fábrica); desde entonces no pondera.
		Cuenta solo si de verdad entró: con peso Y con datos de conducta en algún campo (un
		rubro sin datos no entra aunque tenga peso). Una foto sin el desglose por campo: su peso.
		0 = no ponderó (o no hay foto que diga otra cosa).
	*/
	function pesoConductaCierre(filasTrimestre) {
		if (!boletaCerrada(filasTrimestre)) return 0;
		var foto = fotoCierre((filasTrimestre || {}).GEN);
		if (!foto) return 0;
		if (foto.campos && typeof foto.campos === "object") return pesoConductaCampos(foto.campos);
		return foto.pesos && Number(foto.pesos.conducta) > 0 ? Number(foto.pesos.conducta) : 0;
	}
	/*
		La misma regla sobre un desglose por campo ({LEN: {rubros: {conducta: {peso,
		fraccion}}}, ...}: el porCampo del motor o foto.campos): el mayor peso de conducta
		entre los campos donde de verdad entró (con peso y con datos). 0 = no ponderó.
	*/
	function pesoConductaCampos(campos) {
		var peso = 0;
		CAMPOS.forEach(function (c) {
			var r = campos && campos[c] && campos[c].rubros ? campos[c].rubros.conducta : null;
			if (r && !vacio(r.fraccion) && Number(r.peso) > peso) peso = Number(r.peso);
		});
		return peso;
	}

	// 7.6 → "7.6"; 8 → "8.0"; null → null
	function formatoDecimal(v) { return vacio(v) ? null : (Math.floor(Number(v) * 10 + 1e-9) / 10).toFixed(1); }

	/*
		Tabla de la evaluación final del ciclo para el reporte detallado y la pestaña Boleta de
		Reportes (Tailwind). La boleta imprimible tiene la suya, con su propio estilo.
		opciones = { trimestre (el que se ve, resaltado), id }
	*/
	function htmlFinalCiclo(boletaCiclo, grado, opciones) {
		opciones = opciones || {};
		var f = finalCiclo(boletaCiclo, grado);
		var borde = "px-2 py-1.5 border border-gray-200 text-center";
		var celda = function (v, extra, attrs) {
			return v === null || v === undefined
				? "<td class='" + borde + " text-xs italic text-gray-400' " + (attrs || "") + ">pendiente</td>"
				: "<td class='" + borde + " font-semibold text-gray-900 " + (extra || "") + "' " + (attrs || "") + ">" + esc(v) + "</td>";
		};
		var cabeza = "<tr class='bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500'>" +
			"<th class='px-2 py-1.5 border border-gray-200 text-left'>Campo formativo</th>" +
			TRIMESTRES.map(function (t) {
				return "<th class='px-2 py-1.5 border border-gray-200" + (t === opciones.trimestre ? " bg-blue-50 text-blue-800" : "") + "'>T" + t + "</th>";
			}).join("") + "<th class='px-2 py-1.5 border border-gray-200'>Final</th></tr>";
		var cuerpo = CAMPOS.map(function (c) {
			return "<tr><th scope='row' class='px-2 py-1.5 border border-gray-200 text-left font-normal text-gray-700'>" +
				"<span class='inline-block w-2 h-2 rounded-full mr-1.5 align-middle' style='background:" + COLOR_CAMPO[c] + "'></span>" +
				"<span class='font-semibold'>" + c + "</span> <span class='hidden sm:inline'>" + esc(NOMBRE_CAMPO[c]) + "</span></th>" +
				TRIMESTRES.map(function (t) {
					var of = calificacionOficial(((boletaCiclo || {})[t] || {})[c]);
					var attrs = "data-final-trim='" + t + "' data-final-de='" + c + "'";
					// Confirmada fuera de la escala del grado de hoy: no vale hasta confirmarla de nuevo
					if (of.fueraDeEscala) {
						return "<td class='" + borde + " text-xs italic text-amber-700' " + attrs + " data-fuera-escala='1' title='" + esc(textoFueraDeEscala(of.fueraDeEscala)) + "'>revisar" +
							"<span class='block not-italic text-[10px] leading-tight'>el " + of.fueraDeEscala.valor + " no es válido en " + of.fueraDeEscala.grado + "°</span></td>";
					}
					return celda(of.valor, "", attrs);
				}).join("") +
				celda(formatoDecimal(f.porCampo[c]), "bg-gray-50", "data-final-campo='" + c + "'") + "</tr>";
		}).join("");
		var pie = "<tr class='bg-gray-50'><th scope='row' colspan='4' class='px-2 py-1.5 border border-gray-200 text-left font-semibold text-gray-800'>Promedio final de grado</th>" +
			celda(formatoDecimal(f.promedio), "", "data-final-promedio") + "</tr>";
		var colorAcr = COLOR_ACREDITACION_TW[f.acreditacion] || COLOR_ACREDITACION_TW.pendiente;
		var regla = reglaAcreditacionTexto(f.grado);
		return "<div" + (opciones.id ? " id='" + esc(opciones.id) + "'" : "") + " data-final-ciclo>" +
			"<div class='overflow-x-auto'><table class='w-full text-xs sm:text-sm border-collapse'>" +
			"<thead>" + cabeza + "</thead><tbody>" + cuerpo + pie + "</tbody></table></div>" +
			"<p class='mt-2 text-sm'><span class='font-semibold text-gray-700'>Acreditación del grado:</span> " +
			"<span class='font-bold " + colorAcr + "' data-acreditacion='" + f.acreditacion + "'>" + ETIQUETA_ACREDITACION[f.acreditacion] + "</span>" +
			(f.completo ? "" : " <span class='text-xs text-gray-500'>(faltan " + f.faltan + " de 12 calificaciones confirmadas)</span>") + "</p>" +
			(f.explicacion ? "<p class='mt-1 text-xs text-amber-800 leading-relaxed' data-explicacion-acreditacion>" + esc(f.explicacion) + "</p>" : "") +
			"<p class='mt-1 text-xs text-gray-500 leading-relaxed'>La final de cada campo es el promedio de sus tres calificaciones confirmadas, con un decimal y sin redondear; " +
			"el promedio final de grado, el de las cuatro finales. Aparecen cuando están confirmados los tres trimestres. " + regla + " (Acuerdo 10/09/23, arts. 7 y 9).</p>" +
			"<p class='mt-1 text-xs font-medium text-gray-600' data-nota-siged>" + NOTA_FINAL_APOYO + "</p>" +
			"</div>";
	}

	/*
		Filas de boleta_trimestral del ciclo, por alumno, trimestre y campo:
		{ alumnoId: { 1: {LEN: fila, ..., GEN: fila}, 2: {...}, 3: {...} } }
	*/
	async function boletasCiclo(sb, ctx, alumnoIds, gradosHoy) {
		var ids = alumnoIds || ctx.alumnos.map(function (a) { return a.id; });
		// Grado de hoy de cada alumno (anotarGradoHoy): el que se recibe o el de ctx.alumnos
		var grados = Object.assign({}, gradosHoy || {});
		(ctx.alumnos || []).forEach(function (a) { if (!(a.id in grados)) grados[a.id] = a.grado; });
		var salida = {};
		ids.forEach(function (id) { salida[id] = { 1: {}, 2: {}, 3: {} }; });
		if (!ids.length) return salida;
		var filas = await todas(function () {
			return sb.from("boleta_trimestral").select("*")
				.eq("maestro_id", ctx.maestroId).eq("ciclo", ctx.ciclo).in("alumno_id", ids).order("id");
		});
		filas.forEach(function (f) {
			if (!salida[f.alumno_id]) salida[f.alumno_id] = { 1: {}, 2: {}, 3: {} };
			if (!salida[f.alumno_id][f.trimestre]) salida[f.alumno_id][f.trimestre] = {};
			if (f.alumno_id in grados) anotarGradoHoy(f, grados[f.alumno_id]);
			salida[f.alumno_id][f.trimestre][f.campo] = f;
		});
		return salida;
	}

	/*
		Texto visible de una sección:
		  - si el maestro escribió ESE cuadro, lo suyo tal cual, aunque lo haya dejado
		    vacío a propósito (TextosBoleta.esEditado);
		  - si la redacción con IA está en los cuadros, la redacción guardada;
		  - si no, la propuesta calculada AHORA (con las evidencias de hoy): lo guardado
		    podría ser de antes de las últimas capturas. Solo si no se calculó propuesta
		    se usa lo guardado.
	*/
	function textoSeccion(filaBoleta, tipo, propuesto, cerrada) {
		var guardado = filaBoleta ? filaBoleta[tipo] : null;
		if (window.TextosBoleta.esEditado(filaBoleta, tipo)) return { texto: guardado || "", delMaestro: true };
		// Boleta cerrada: lo que se entregó, nunca una propuesta calculada después
		if (cerrada) return { texto: guardado || "", delMaestro: false, delCierre: true };
		var conIa = filaBoleta && filaBoleta.texto_autogenerado && filaBoleta.texto_autogenerado.visible === "ia";
		if (conIa && guardado && String(guardado).trim()) return { texto: guardado, delMaestro: false };
		if (propuesto !== null && propuesto !== undefined) return { texto: propuesto, delMaestro: false };
		return { texto: guardado || "", delMaestro: false };
	}

	/*
		Trabajo diario: vive en evaluacion_diagnostica.observaciones del trimestre.
		null = el maestro no lo ha escrito → la propuesta de la Capa 1;
		"" = lo vació a propósito → se respeta vacío.
	*/
	function trabajoDiario(diagnostica, propuesto, filaGeneral, cerrada) {
		// Boleta cerrada: el texto que tenía al cerrarse (foto en la fila GEN)
		var foto = cerrada ? fotoCierre(filaGeneral) : null;
		if (foto && typeof foto.trabajo_diario === "string") {
			return { texto: foto.trabajo_diario, delMaestro: !!foto.trabajo_diario_del_maestro, delCierre: !foto.trabajo_diario_del_maestro };
		}
		var obs = diagnostica ? diagnostica.observaciones : null;
		if (obs !== null && obs !== undefined) return { texto: String(obs).trim(), delMaestro: true };
		return { texto: propuesto || "", delMaestro: false };
	}

	/*
		Todo lo de un alumno en un trimestre, listo para boleta o reporte detallado.
	*/
	async function alumnoTrimestre(sb, ctx, alumno, trimestre) {
		var motorVivo = await window.MotorCalificacion.cargarYCalcular(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupo.id, alumnoId: alumno.id,
			grado: alumno.grado, trimestre: trimestre, campos: CAMPOS,
		});

		var diagRes = await sb.from("evaluacion_diagnostica").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id)
			.eq("momento", "trimestre_" + trimestre).maybeSingle();
		// Un error se lanza: el reporte dice que no pudo, en vez de salir "sin diagnóstico"
		if (diagRes.error) throw diagRes.error;
		var diagnostica = diagRes.data || null;

		var pdaRes = await sb.from("v_avance_pda").select("*")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumno.id).eq("trimestre", trimestre);
		if (pdaRes.error) throw pdaRes.error;
		var avancePda = pdaRes.data || [];

		// alumno llega con su grado de hoy: una confirmada fuera de su escala sale "pendiente"
		var gradoHoy = {};
		gradoHoy[alumno.id] = alumno.grado;
		var boletas = await boletasCiclo(sb, ctx, [alumno.id], gradoHoy);
		var boletaT = (boletas[alumno.id] || {})[trimestre] || {};
		var cerrada = boletaCerrada(boletaT);
		var foto = cerrada ? fotoCierre(boletaT.GEN) : null;
		diagnostica = diagnosticaVisible(diagnostica, boletaT.GEN, cerrada);
		// Boleta cerrada: desglose, porcentajes, pesos y avance por PDA de la foto del cierre
		// (motorVivo queda para avisar si hubo capturas después)
		var pcCierre = porCampoCierre(foto);
		var motor = Object.assign({}, motorVivo, { asistencia: asistenciaVisible(motorVivo.asistencia, boletaT.GEN, cerrada) },
			pcCierre ? {
				porCampo: pcCierre,
				pesos: foto.pesos || motorVivo.pesos,
				examenAproximado: tiene(foto, "examen_aproximado") ? !!foto.examen_aproximado : motorVivo.examenAproximado,
				usaLegacy: tiene(foto, "usa_legacy") ? !!foto.usa_legacy : motorVivo.usaLegacy,
			} : (cerrada ? { porCampo: porCampoFilas(boletaT, motorVivo.porCampo) } : {}));
		avancePda = avancePdaCierre(foto) || avancePda;

		// Grado, fase, escala y banda de lectura como se entregaron
		var alumnoV = alumnoVisible(alumno, foto);
		var banda = bandaVisible(ctx.bandas[alumnoV.grado] || null, foto);
		var fluidez = window.CatalogoHabilidades.clasificarPPM(diagnostica ? diagnostica.lectura_ppm : null, banda);
		var juicio = {};
		CAMPOS.forEach(function (c) { juicio[c] = juicioSinEvidencias(boletaT, c, (motorVivo.porCampo || {})[c]); });

		// grado: el del cierre si está cerrada (las habilidades de matemáticas son las de ese grado)
		var textos = window.TextosBoleta.generar({
			porCampo: motor.porCampo, avancePda: avancePda, diagnostica: diagnostica, banda: banda,
			grado: alumnoV.grado, asistencia: motor.asistencia, catalogo: window.CatalogoHabilidades,
			corto: window.CamposFormativos.corto, plantillas: ctx.plantillas,
		});

		var retro = await retroalimentaciones(sb, ctx, alumno.id, trimestre, 5);

		return {
			alumno: alumnoV, trimestre: trimestre, motor: motor, motorVivo: motorVivo,
			cerrada: cerrada, deCierre: !!pcCierre,
			fase: faseVisible(alumnoV.grado, foto), escala: escalaVisible(alumnoV.grado, foto),
			diagnostica: diagnostica, banda: banda, fluidez: fluidez,
			avancePda: avancePda, textos: textos, juicio: juicio,
			boletaCiclo: boletas[alumno.id] || { 1: {}, 2: {}, 3: {} },
			retroalimentaciones: retro,
		};
	}

	/*
		Grupo con las boletas cerradas congeladas (decisión de Jorge 7): para cada alumno con
		la boleta del trimestre cerrada, porcentajes y rubros, asistencia, diagnóstico, avance
		por PDA, grado y banda de lectura salen de la foto del cierre; los abiertos siguen en
		vivo. Así la junta, la exportación y los concentrados cuadran con lo entregado.
		Devuelve una copia de datos con además:
		  alumnos       ctx.alumnos con el grado del cierre
		  cerrados      {alumnoId: true} (boleta cerrada)
		  bandasAlumno  {alumnoId: banda|null} de la foto (solo si la foto la guardó)
	*/
	function congelarCerradas(ctx, datos, trimestre) {
		var porAlumno = Object.assign({}, (datos.motor && datos.motor.porAlumno) || {});
		var diagnosticas = Object.assign({}, datos.diagnosticas || {});
		var avancePda = datos.avancePda || [];
		var cerrados = {}, bandasAlumno = {}, pdaCambio = false;
		var alumnos = (ctx.alumnos || []).map(function (a) {
			var boletaT = ((datos.boletas || {})[a.id] || {})[trimestre] || {};
			if (!boletaCerrada(boletaT)) return a;
			var foto = fotoCierre(boletaT.GEN);
			cerrados[a.id] = true;
			var diag = diagnosticaVisible(diagnosticas[a.id] || null, boletaT.GEN, true);
			if (diag) diagnosticas[a.id] = diag; else delete diagnosticas[a.id];
			var m = porAlumno[a.id] || { porCampo: {}, asistencia: { presentes: 0, total: 0, porcentaje: null } };
			var pc = porCampoCierre(foto);
			porAlumno[a.id] = Object.assign({}, m, { asistencia: asistenciaVisible(m.asistencia, boletaT.GEN, true) },
				pc ? {
					porCampo: pc,
					examenAproximado: tiene(foto, "examen_aproximado") ? !!foto.examen_aproximado : m.examenAproximado,
					usaLegacy: tiene(foto, "usa_legacy") ? !!foto.usa_legacy : m.usaLegacy,
				} : { porCampo: porCampoFilas(boletaT, m.porCampo) });
			var pda = avancePdaCierre(foto);
			if (pda) {
				avancePda = avancePda.filter(function (f) { return f.alumno_id !== a.id; })
					.concat(pda.map(function (f) { return Object.assign({}, f, { alumno_id: a.id }); }));
				pdaCambio = true;
			}
			var ac = alumnoCierre(foto);
			if (ac && tiene(ac, "banda_ppm")) bandasAlumno[a.id] = ac.banda_ppm;
			return alumnoVisible(a, foto);
		});
		// Orden de lista con el grado del cierre (grado y número de lista, como la consulta de
		// alumnos): si cambió el grado de alguien después de cerrar, sigue donde se entregó
		alumnos = alumnos.map(function (a, i) { return { a: a, i: i }; }).sort(function (x, y) {
			return (Number(x.a.grado) || 0) - (Number(y.a.grado) || 0) ||
				(Number(x.a.num_lista) || 0) - (Number(y.a.num_lista) || 0) || x.i - y.i;
		}).map(function (x) { return x.a; });
		if (pdaCambio) {
			// El mismo orden que la consulta (alumno, PDA)
			avancePda = avancePda.slice().sort(function (x, y) {
				return String(x.alumno_id).localeCompare(String(y.alumno_id)) || String(x.clave_pda).localeCompare(String(y.clave_pda));
			});
		}
		return Object.assign({}, datos, {
			motor: Object.assign({}, datos.motor || {}, { porAlumno: porAlumno }),
			diagnosticas: diagnosticas, avancePda: avancePda,
			alumnos: alumnos, cerrados: cerrados, bandasAlumno: bandasAlumno,
		});
	}

	// Últimas retroalimentaciones no vacías del trimestre, con su producto
	async function retroalimentaciones(sb, ctx, alumnoId, trimestre, limite) {
		var proyRes = await sb.from("proyectos").select("id")
			.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id).eq("trimestre", trimestre);
		if (proyRes.error) throw proyRes.error;
		var proyIds = (proyRes.data || []).map(function (p) { return p.id; });
		if (!proyIds.length) return [];
		var res = await sb.from("calificaciones")
			.select("retroalimentacion, fecha, evaluado_en, productos_sesion(nombre, campo)")
			.eq("maestro_id", ctx.maestroId).eq("alumno_id", alumnoId).in("proyecto_id", proyIds)
			.not("retroalimentacion", "is", null)
			.neq("retroalimentacion", "") // en la consulta, no después: si no, el límite trae de menos
			.order("evaluado_en", { ascending: false, nullsFirst: false })
			.limit(limite || 5);
		if (res.error) throw res.error;
		return (res.data || []).filter(function (r) { return r.retroalimentacion && String(r.retroalimentacion).trim(); })
			.map(function (r) {
				return {
					texto: r.retroalimentacion,
					fecha: r.fecha,
					producto: r.productos_sesion ? r.productos_sesion.nombre : "",
					campo: r.productos_sesion ? r.productos_sesion.campo : null,
				};
			});
	}

	/*
		Todo el grupo en un trimestre (junta, exportación, concentrado).
		{ motor: {porAlumno, pesos, sinProyectos}, diagnosticas: {alumnoId: fila},
		  avancePda: [filas], boletas: {alumnoId: {1:{...},2:{...},3:{...}}} }
	*/
	async function grupoTrimestre(sb, ctx, trimestre) {
		var motor = await window.MotorCalificacion.cargarYCalcularGrupo(sb, {
			maestroId: ctx.maestroId, grupoId: ctx.grupo.id, trimestre: trimestre,
			alumnos: ctx.alumnos, campos: CAMPOS,
		});
		var ids = ctx.alumnos.map(function (a) { return a.id; });
		var diagnosticas = {};
		var avancePda = [];
		if (ids.length) {
			var diags = await todas(function () {
				return sb.from("evaluacion_diagnostica").select("*")
					.eq("maestro_id", ctx.maestroId).eq("momento", "trimestre_" + trimestre).in("alumno_id", ids).order("id");
			});
			diags.forEach(function (d) { diagnosticas[d.alumno_id] = d; });
			avancePda = await todas(function () {
				return sb.from("v_avance_pda").select("*")
					.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id).eq("trimestre", trimestre).order("alumno_id").order("clave_pda");
			});
		}
		var boletas = await boletasCiclo(sb, ctx, ids);
		// Alumnos con la boleta cerrada: como se entregó
		return congelarCerradas(ctx, { motor: motor, diagnosticas: diagnosticas, avancePda: avancePda, boletas: boletas }, trimestre);
	}

	window.ReporteDatos = {
		CAMPOS: CAMPOS,
		NOMBRE_CAMPO: NOMBRE_CAMPO,
		COLOR_CAMPO: COLOR_CAMPO,
		COLOR_GRADO: COLOR_GRADO,
		esc: esc,
		contexto: contexto,
		calificacionOficial: calificacionOficial,
		anotarGradoHoy: anotarGradoHoy,
		fueraDeEscala: fueraDeEscala,
		textoFueraDeEscala: textoFueraDeEscala,
		validarCierre: validarCierre,
		ACREDITACION_REVISAR_FAMILIAS: ACREDITACION_REVISAR_FAMILIAS,
		explicacionRevisarFamilias: explicacionRevisarFamilias,
		reglaAcreditacionTextoFamilias: reglaAcreditacionTextoFamilias,
		promedio: promedio,
		promedioTruncado: promedioTruncado,
		finalCiclo: finalCiclo,
		formatoDecimal: formatoDecimal,
		NOTA_FINAL_APOYO: NOTA_FINAL_APOYO,
		pesoConductaCierre: pesoConductaCierre,
		htmlFinalCiclo: htmlFinalCiclo,
		ETIQUETA_ACREDITACION: ETIQUETA_ACREDITACION,
		boletasCiclo: boletasCiclo,
		boletaCerrada: boletaCerrada,
		fotoCierre: fotoCierre,
		diagnosticaVisible: diagnosticaVisible,
		asistenciaVisible: asistenciaVisible,
		fotoAsistencia: fotoAsistencia,
		fotoDiagnostico: fotoDiagnostico,
		faseDeGrado: faseDeGrado,
		escalaDeGrado: escalaDeGrado,
		pisoDeGrado: pisoDeGrado,
		reglaAcreditacionTexto: reglaAcreditacionTexto,
		COLOR_ACREDITACION_TW: COLOR_ACREDITACION_TW,
		pesoConductaCampos: pesoConductaCampos,
		truncar2: truncar2,
		fotoAlumno: fotoAlumno,
		fotoCampos: fotoCampos,
		fotoAvancePda: fotoAvancePda,
		alumnoCierre: alumnoCierre,
		alumnoVisible: alumnoVisible,
		bandaVisible: bandaVisible,
		faseVisible: faseVisible,
		escalaVisible: escalaVisible,
		porCampoCierre: porCampoCierre,
		porCampoFilas: porCampoFilas,
		avancePdaCierre: avancePdaCierre,
		juicioSinEvidencias: juicioSinEvidencias,
		congelarCerradas: congelarCerradas,
		textoSeccion: textoSeccion,
		trabajoDiario: trabajoDiario,
		alumnoTrimestre: alumnoTrimestre,
		retroalimentaciones: retroalimentaciones,
		grupoTrimestre: grupoTrimestre,
	};
})();
