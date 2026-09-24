/*
	junta.js — Presentación de grupo para la junta de madres, padres y tutores
	(Mi salón, B.8.3; docs/MISION-PARTE-B.md §3.5). Equivale a la presentación que
	Fanny armaba subiendo sus Excel a una IA, pero generada desde los datos.

	De dónde sale todo (nada se recalcula aquí; solo se agrega lo que ya existe):
	  - ReporteDatos.grupoTrimestre(sb, ctx, t) para el trimestre elegido y, si t > 1,
	    para el anterior. El anterior NUNCA se inventa: si no tiene datos, no hay deltas.
	    Todo cambio (delta) compara a los MISMOS alumnos (los que tienen dato en ambos
	    trimestres); si no son todos, la diapositiva lo dice y muestra sus dos promedios.
	  - Medida de las gráficas: el porcentaje de logro del motor por campo (el mismo que
	    alimenta la boleta). Promedio del alumno = promedio de sus campos con datos.
	    Promedio del grupo (o del grado) = promedio de sus alumnos.
	  - Alumnos con la boleta del trimestre cerrada: porcentajes, rubros, lectura, avance por
	    PDA, grado y banda de lectura salen de la foto del cierre (ReporteDatos.grupoTrimestre
	    ya los congela); los abiertos, en vivo. Así los totales cuadran con lo entregado. Si se
	    mezclan cerrados y abiertos, el panorama lo dice.
	  - La calificación de boleta NO se mezcla con porcentajes: solo se cuenta cuántos
	    alumnos la tienen confirmada ("X de Y"). Nunca se muestra una propuesta.
	  - Fluidez lectora: evaluacion_diagnostica.lectura_ppm contra bandas_ppm del grado
	    del alumno, con CatalogoHabilidades.clasificarPPM.
	  - Sugerencias del cierre: las más frecuentes de la Capa 1 (TextosBoleta.generar)
	    entre los alumnos del grupo, sin nombres.

	Privacidad (decisión documentada, lo más prudente para una pantalla grande):
	  - Los alumnos se identifican por número de lista (dentro de la diapositiva de su
	    grado), no por nombre. "Mostrar nombres" está apagado por defecto y no se guarda.
	  - Las barras van por número de lista, nunca ordenadas por resultado (no hay ranking).
	    Colores del grado, no semáforo: ninguna barra de alumno lleva "requiere apoyo".
	    Un cambio negativo se pinta en gris neutro, sin palabras.
	  - Las áreas de atención van SIEMPRE agregadas (cuántos alumnos, qué PDA, qué rubro),
	    nunca con nombre ni número de lista, aunque "Mostrar nombres" esté encendido. El
	    desglose por grado solo aparece si el grado tiene al menos 3 alumnos con dato.

	Reglas de las áreas de atención (misión §3.5):
	  - Lectura: PPM "requiere apoyo" o "cercano a la referencia" SEP 2010 de su grado (mismo criterio
	    que la Capa 1 para escribir "por debajo de lo esperado").
	  - Rubros bajo 60 %: tareas, trabajos y examen, con el rubro de todo el trimestre (todos
	    los campos juntos). Participación y conducta se capturan una vez al día; 1 (normal) y
	    2 valen el día completo y 0 vale 0: cuentan bajo el umbral de la Capa 1
	    (TextosBoleta.UMBRAL_DIARIO_NORMAL, hoy el mismo 60 %).
	  - PDA: los del grado donde la mayoría (más de la mitad) de los alumnos con al menos 2
	    evidencias quedó en "requiere apoyo"; mínimo 2 alumnos evaluados.

	Estructura: arriba, funciones puras (cálculo y HTML) que se prueban en node
	(pruebas/junta.test.js); abajo, la página (un solo DOMContentLoaded, arranque al final).
*/

(function () {
	"use strict";

	// ── Constantes ────────────────────────────────────────────────────────────
	// Umbrales: los mismos de la Capa 1 (una sola fuente); los números son el respaldo si
	// textos-boleta.js no está cargado (pruebas en node)
	var CAPA1 = (typeof window !== "undefined" && window.TextosBoleta) || {};
	var UMBRAL_RUBRO = CAPA1.UMBRAL_AREA || 60;           // % (misión §3.5)
	var UMBRAL_DIARIO = CAPA1.UMBRAL_DIARIO_NORMAL || UMBRAL_RUBRO; // % participación y conducta (el de la Capa 1)
	var MIN_EVIDENCIAS = CAPA1.EVIDENCIAS_MINIMAS || 2;
	var MIN_ALUMNOS_PDA = 2;     // un PDA con un solo alumno evaluado no es "la mayoría del grado"
	var MIN_DESGLOSE = 3;        // no se desglosa por grado un conteo de menos de 3 alumnos
	var MAX_SUGERENCIAS = 4;
	var MAX_PDA = 7;
	var FILAS_POR_COLUMNA = 12;  // barras por alumno: más de 12 → dos columnas
	var FILAS_POR_DIAPOSITIVA = 24;
	var FILAS_FLUIDEZ = 12;      // máximo de alumnos de un grado en una diapositiva de fluidez
	var CLAVES_SOLO_ALUMNO = ["pda_mejora", "pda_apoyo"]; // hablan de "este aprendizaje": no sirven al grupo

	var NOMBRE_TRIMESTRE = { 1: "1er trimestre", 2: "2do trimestre", 3: "3er trimestre" };

	var RUBROS_ATENCION = [
		{ rubro: "tareas", umbral: UMBRAL_RUBRO, icono: "tareas", titulo: "Entrega de tareas",
			frase: "tuvieron menos del 60 % de cumplimiento en sus tareas del trimestre." },
		{ rubro: "trabajos", umbral: UMBRAL_RUBRO, icono: "trabajos", titulo: "Trabajos en clase",
			frase: "tuvieron un logro menor al 60 % en sus trabajos en clase." },
		{ rubro: "examen", umbral: UMBRAL_RUBRO, icono: "examen", titulo: "Evaluación escrita",
			frase: "obtuvieron menos del 60 % en la evaluación escrita (dato aproximado).", aproximado: true },
		{ rubro: "participacion", umbral: UMBRAL_DIARIO, icono: "participacion", titulo: "Participación",
			frase: "participaron menos de lo habitual en las actividades del grupo." },
		{ rubro: "conducta", umbral: UMBRAL_DIARIO, icono: "conducta", titulo: "Convivencia",
			frase: "necesitan reforzar los acuerdos de convivencia del salón." },
	];

	// Zonas de la banda de fluidez: tintes suaves (la zona es contexto, no etiqueta del alumno)
	var ZONAS_FLUIDEZ = [
		{ nivel: "requiere_apoyo", color: "#fde6d4" },
		{ nivel: "cercano", color: "#fdf3c8" },
		{ nivel: "estandar", color: "#d5f0e0" },
		{ nivel: "avanzado", color: "#d3e7f7" },
	];

	var SUGERENCIAS_GENERALES = [
		"Leer juntos un rato cada día y platicar sobre lo leído.",
		"Revisar la mochila y el cuaderno una vez por semana.",
		"Establecer un horario fijo para hacer la tarea en casa.",
	];

	// Iconos (trazos de Lucide, inline para no depender de la red)
	var ICONOS = {
		anterior: "<path d='m15 18-6-6 6-6'/>",
		siguiente: "<path d='m9 18 6-6-6-6'/>",
		lectura: "<path d='M12 7v14'/><path d='M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'/>",
		tareas: "<rect width='8' height='4' x='8' y='2' rx='1' ry='1'/><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><path d='m9 14 2 2 4-4'/>",
		trabajos: "<path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/>",
		examen: "<path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/><path d='M14 2v4a2 2 0 0 0 2 2h4'/><path d='M10 9H8'/><path d='M16 13H8'/><path d='M16 17H8'/>",
		participacion: "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>",
		conducta: "<circle cx='12' cy='12' r='10'/><path d='M8 14s1.5 2 4 2 4-2 4-2'/><path d='M9 9h.01'/><path d='M15 9h.01'/>",
		pda: "<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/>",
		casa: "<path d='M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'/><path d='M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/>",
		listo: "<circle cx='12' cy='12' r='10'/><path d='m9 12 2 2 4-4'/>",
		privacidad: "<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/>",
		mensaje: "<path d='M7.9 20A9 9 0 1 0 4 16.1L2 22Z'/>",
		pantalla: "<path d='M8 3H5a2 2 0 0 0-2 2v3'/><path d='M21 8V5a2 2 0 0 0-2-2h-3'/><path d='M3 16v3a2 2 0 0 0 2 2h3'/><path d='M16 21h3a2 2 0 0 0 2-2v-3'/>",
		salir: "<path d='M8 3v3a2 2 0 0 1-2 2H3'/><path d='M21 8h-3a2 2 0 0 1-2-2V3'/><path d='M3 16h3a2 2 0 0 1 2 2v3'/><path d='M16 21v-3a2 2 0 0 1 2-2h3'/>",
		imprimir: "<path d='M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'/><path d='M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6'/><rect x='6' y='14' width='12' height='8' rx='1'/>",
	};

	function icono(nombre, clase) {
		return "<svg class='" + (clase || "j-ico") + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' " +
			"stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + (ICONOS[nombre] || "") + "</svg>";
	}

	// Dependencias compartidas (se leen al usarse: en node las carga la prueba)
	function RD() { return window.ReporteDatos; }
	function TB() { return window.TextosBoleta; }
	function CH() { return window.CatalogoHabilidades; }
	function CF() { return window.CamposFormativos; }
	function esc(s) { return RD().esc(s); }

	// ── Números ───────────────────────────────────────────────────────────────
	function esNumero(v) { return v !== null && v !== undefined && v !== "" && !isNaN(v); }

	function media(valores) {
		var nums = (valores || []).filter(esNumero).map(Number);
		if (!nums.length) return null;
		return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
	}

	// Diferencia en puntos, a un decimal; null si falta cualquiera de los dos
	function delta(actual, anterior) {
		if (!esNumero(actual) || !esNumero(anterior)) return null;
		return Math.round((Number(actual) - Number(anterior)) * 10) / 10;
	}

	function fmtPct(v, decimales) {
		if (!esNumero(v)) return "—";
		var d = decimales === undefined ? 1 : decimales, f = Math.pow(10, d); // truncado, como la boleta
		return (Math.floor(Number(v) * f + 1e-9) / f).toFixed(d) + " %";
	}

	function fmtDelta(d) {
		var signo = d > 0 ? "+" : (d < 0 ? "−" : "");
		return signo + Math.abs(d).toFixed(1);
	}

	function listaEnTexto(items) {
		if (!items.length) return "";
		if (items.length === 1) return items[0];
		return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
	}

	function nombreTrimestre(t) { return NOMBRE_TRIMESTRE[t] || ("Trimestre " + t); }
	function textoGrado(g) { return g + "°"; }

	// Promedio de logro de un alumno: sus campos con datos (null si no tiene ninguno)
	function promedioAlumno(porCampo) {
		if (!porCampo) return null;
		return media(RD().CAMPOS.map(function (c) { return porCampo[c] ? porCampo[c].porcentaje : null; }));
	}

	// Rubro de todo el trimestre (todos los campos juntos), en %; null si no hay máximo
	function fraccionRubro(porCampo, rubro) {
		var obtenido = 0, maximo = 0;
		RD().CAMPOS.forEach(function (c) {
			var r = porCampo && porCampo[c] && porCampo[c].rubros ? porCampo[c].rubros[rubro] : null;
			if (!r || !(r.maximo > 0)) return;
			obtenido += Number(r.obtenido) || 0;
			maximo += Number(r.maximo);
		});
		return maximo > 0 ? obtenido / maximo * 100 : null;
	}

	// ¿El trimestre tiene algo que presentar? (logro de algún alumno o algún PPM)
	function hayDatos(datos, alumnos) {
		if (!datos) return false;
		var porAlumno = datos.motor && datos.motor.porAlumno ? datos.motor.porAlumno : {};
		return (alumnos || []).some(function (a) {
			var m = porAlumno[a.id];
			if (m && promedioAlumno(m.porCampo) !== null) return true;
			var d = datos.diagnosticas ? datos.diagnosticas[a.id] : null;
			return !!(d && esNumero(d.lectura_ppm));
		});
	}

	/*
		Resumen de un conjunto de alumnos. El cambio (delta) compara SIEMPRE a los mismos
		alumnos: los que tienen dato en ambos trimestres. Un alumno sin datos en el
		trimestre anterior no mueve el promedio "de antes" y no produce un delta inventado.
		  actual            promedio del trimestre (todos los alumnos con dato)
		  anterior          promedio del trimestre anterior de los alumnos comparables
		  actualComparable  promedio actual de esos mismos alumnos
		  mismosAlumnos     true si los comparables son todos los que tienen dato hoy
	*/
	function resumir(lista, comparacion) {
		var conDatos = lista.filter(function (a) { return a.actual !== null; });
		var comparables = comparacion ? conDatos.filter(function (a) { return a.anterior !== null; }) : [];
		var antes = comparables.length ? media(comparables.map(function (a) { return a.anterior; })) : null;
		var ahora = comparables.length ? media(comparables.map(function (a) { return a.actual; })) : null;
		return {
			n: lista.length,
			conDatos: conDatos.length,
			actual: media(conDatos.map(function (a) { return a.actual; })),
			anterior: antes,
			actualComparable: ahora,
			delta: delta(ahora, antes),
			comparables: comparables.length,
			mismosAlumnos: comparables.length === conDatos.length,
			mejoraron: comparables.filter(function (a) { return a.delta > 0; }).length,
		};
	}

	// Promedio por campo; el cambio, igual que arriba, solo con los mismos alumnos
	function promediosPorCampo(lista, comparacion) {
		var salida = {};
		RD().CAMPOS.forEach(function (c) {
			var conDatos = lista.filter(function (a) { return a.porCampo[c] !== null; });
			var comparables = comparacion ? conDatos.filter(function (a) { return a.porCampoAnterior[c] !== null; }) : [];
			var antes = comparables.length ? media(comparables.map(function (a) { return a.porCampoAnterior[c]; })) : null;
			var ahora = comparables.length ? media(comparables.map(function (a) { return a.porCampo[c]; })) : null;
			salida[c] = {
				actual: media(conDatos.map(function (a) { return a.porCampo[c]; })),
				anterior: antes,
				actualComparable: ahora,
				delta: delta(ahora, antes),
				n: conDatos.length,
				mismosAlumnos: comparables.length === conDatos.length,
			};
		});
		return salida;
	}

	// Conteo agregado con desglose por grado (solo grados con MIN_DESGLOSE alumnos o más)
	function conteo(alumnos, grados, evaluar) {
		var total = 0, n = 0, porGrado = [];
		grados.forEach(function (g) {
			var tg = 0, ng = 0;
			alumnos.forEach(function (a) {
				if (a.grado !== g) return;
				var r = evaluar(a);
				if (r === null || r === undefined) return;
				tg++;
				if (r) ng++;
			});
			total += tg; n += ng;
			if (tg >= MIN_DESGLOSE) porGrado.push({ grado: g, total: tg, n: ng });
		});
		return { total: total, n: n, porGrado: grados.length > 1 ? porGrado : [] };
	}

	// PDA del grado con mayoría en requiere_apoyo (solo filas con evidencia suficiente)
	function pdaConMayoriaApoyo(filas, idsValidos) {
		var grupos = {}, orden = [];
		(filas || []).forEach(function (f) {
			if (!f || !idsValidos[f.alumno_id]) return;
			if (!(Number(f.evidencias) >= MIN_EVIDENCIAS)) return;
			var clave = f.grado + "|" + f.clave_pda;
			if (!grupos[clave]) {
				grupos[clave] = { grado: Number(f.grado), campo: CF().corto(f.campo_formativo), pda: f.pda, total: 0, n: 0 };
				orden.push(clave);
			}
			grupos[clave].total++;
			if (f.nivel_predominante === "requiere_apoyo") grupos[clave].n++;
		});
		var campos = RD().CAMPOS;
		return orden.map(function (k) { return grupos[k]; })
			.filter(function (g) { return g.total >= MIN_ALUMNOS_PDA && g.n * 2 > g.total; })
			.map(function (g) {
				g.texto = TB().frasePda(g.pda) || g.pda;
				return g;
			})
			.sort(function (a, b) {
				return (b.n / b.total - a.n / a.total) || (a.grado - b.grado) ||
					(campos.indexOf(a.campo) - campos.indexOf(b.campo));
			});
	}

	// Banda de lectura del alumno: con la boleta cerrada, la guardada al cerrar; si no, la de su grado
	function bandaDe(ctx, datos, a) {
		var fotos = datos && datos.bandasAlumno;
		if (fotos && Object.prototype.hasOwnProperty.call(fotos, a.id)) return fotos[a.id] || null;
		return (ctx.bandas || {})[a.grado] || null;
	}

	// Plantillas efectivas: las de la BD encima de las de la Capa 1 (mismo orden que generar)
	function plantillasEfectivas(ctx) {
		var p = {};
		var defecto = TB().SUGERENCIAS_DEFECTO || {};
		Object.keys(defecto).forEach(function (k) { p[k] = defecto[k]; });
		var bd = ctx.plantillas || {};
		Object.keys(bd).forEach(function (k) { if (bd[k]) p[k] = bd[k]; });
		return p;
	}

	// De qué plantilla salió una sugerencia de la Capa 1 (las de {habilidades} por prefijo)
	function clavePlantilla(texto, plantillas) {
		var claves = Object.keys(plantillas);
		for (var i = 0; i < claves.length; i++) {
			var t = plantillas[claves[i]] || "";
			if (t === texto) return claves[i];
			var hueco = t.indexOf("{habilidades}");
			if (hueco !== -1) {
				var prefijo = t.slice(0, hueco);
				if (prefijo.trim() && texto.indexOf(prefijo) === 0) return claves[i];
				if (texto === t.replace(" {habilidades}", "").replace("{habilidades}", "")) return claves[i];
			}
		}
		return null;
	}

	/*
		Sugerencias más frecuentes del grupo, desde la Capa 1 de cada alumno.
		Se cuenta a cada alumno una vez por plantilla. Sin nombres ni conteos en pantalla.
	*/
	function sugerenciasFrecuentes(ctx, actual, alumnos) {
		var plantillas = plantillasEfectivas(ctx);
		var porAlumno = actual && actual.motor && actual.motor.porAlumno ? actual.motor.porAlumno : {};
		var filasPda = (actual && actual.avancePda) || [];
		var cuenta = {};
		alumnos.forEach(function (a) {
			var m = porAlumno[a.id];
			if (!m) return;
			var textos = TB().generar({
				porCampo: m.porCampo,
				avancePda: filasPda.filter(function (f) { return f.alumno_id === a.id; }),
				diagnostica: (actual.diagnosticas || {})[a.id] || null,
				banda: bandaDe(ctx, actual, a),
				grado: a.grado, // habilidades de matemáticas de su grado (el del cierre si está cerrada)
				asistencia: m.asistencia,
				catalogo: CH(),
				corto: CF().corto,
				plantillas: ctx.plantillas,
			});
			var vistas = {};
			Object.keys(textos).forEach(function (sec) {
				var s = textos[sec];
				if (!s || !s.sugerencias) return;
				s.sugerencias.forEach(function (texto) {
					var k = clavePlantilla(texto, plantillas);
					if (k && CLAVES_SOLO_ALUMNO.indexOf(k) === -1) vistas[k] = true;
				});
			});
			Object.keys(vistas).forEach(function (k) { cuenta[k] = (cuenta[k] || 0) + 1; });
		});

		// Habilidades de matemáticas más frecuentes en "requiere apoyo" (para {habilidades}).
		// Cada habilidad cuenta solo a los alumnos de los grados donde aplica (a.grado es el
		// del cierre si su boleta está cerrada): lo capturado en una que no aplica no cuenta
		// Cada alumno cuenta con el nombre de la habilidad en SU grado (textoFamilias): en 2°
		// la división y las tablas son "estrategias para repartir o agrupar" y "cálculo mental
		// para multiplicar" (Fase 3: sin algoritmo ni memorización); de 3° a 6°, la etiqueta
		var catalogo = CH();
		var nombreEn = function (h, grado) {
			return catalogo.textoFamilias ? catalogo.textoFamilias(h, grado) : h.etiqueta.toLowerCase();
		};
		var mates = [];
		alumnos.forEach(function (a) {
			var d = (actual.diagnosticas || {})[a.id];
			if (!d) return;
			var mapa = catalogo.aMapa(d.matematicas);
			catalogo.MATEMATICAS.forEach(function (h, i) {
				if (mapa[h.clave] !== "requiere_apoyo" || !catalogo.aplicaMatematica(h, a.grado)) return;
				var texto = nombreEn(h, a.grado);
				var x = mates.filter(function (y) { return y.texto === texto; })[0];
				if (!x) { x = { texto: texto, i: i, n: 0 }; mates.push(x); }
				x.n++;
			});
		});
		var habilidades = listaEnTexto(mates
			.sort(function (a, b) { return (b.n - a.n) || (a.i - b.i) || (a.texto < b.texto ? -1 : 1); })
			.slice(0, 3).map(function (x) { return x.texto; }));

		var orden = Object.keys(plantillas);
		return Object.keys(cuenta)
			.sort(function (a, b) { return (cuenta[b] - cuenta[a]) || (orden.indexOf(a) - orden.indexOf(b)); })
			.slice(0, MAX_SUGERENCIAS)
			.map(function (k) {
				var t = plantillas[k];
				t = habilidades ? t.replace("{habilidades}", habilidades) : t.replace(/:?\s*\{habilidades\}/, "");
				return { clave: k, texto: t, alumnos: cuenta[k] };
			});
	}

	/*
		construirModelo({ctx, trimestre, actual, anterior, fecha}) → todo lo que pintan
		las diapositivas, ya agregado. actual/anterior = ReporteDatos.grupoTrimestre(...).
	*/
	function construirModelo(e) {
		var ctx = e.ctx, t = Number(e.trimestre), actual = e.actual || null;
		var CAMPOS = RD().CAMPOS;
		// actual.alumnos: los alumnos con la boleta cerrada van con el grado del cierre
		// (ReporteDatos.congelarCerradas), para que cada uno cuente donde se entregó
		var alumnosCtx = ((actual && actual.alumnos) || ctx.alumnos || []).map(function (a) {
			return { id: a.id, nombre: a.nombre_completo || "", num: a.num_lista, grado: Number(a.grado) };
		});

		var datosActuales = hayDatos(actual, alumnosCtx);
		var anterior = t > 1 ? (e.anterior || null) : null;
		var comparacion = !!(datosActuales && anterior && hayDatos(anterior, alumnosCtx) &&
			alumnosCtx.some(function (a) {
				var m = anterior.motor && anterior.motor.porAlumno ? anterior.motor.porAlumno[a.id] : null;
				return m && promedioAlumno(m.porCampo) !== null;
			}));

		var modelo = {
			trimestre: t,
			nombreTrimestre: nombreTrimestre(t),
			trimestreAnterior: t > 1 ? t - 1 : null,
			nombreAnterior: t > 1 ? nombreTrimestre(t - 1) : null,
			comparacion: comparacion,
			motivoSinComparacion: comparacion ? null : (t === 1 ? "primero" : "sin_datos_anterior"),
			hayDatos: datosActuales,
			grupo: { nombre: (ctx.grupo && ctx.grupo.nombre) || "Grupo", ciclo: ctx.ciclo || "", escuela: ctx.escuela || "",
				maestro: ctx.maestroNombre || "" },
			fecha: e.fecha || null,
			alumnos: [],
			grados: [],
		};
		if (!datosActuales) return modelo;

		var porAlumnoA = actual.motor && actual.motor.porAlumno ? actual.motor.porAlumno : {};
		var porAlumnoP = comparacion ? anterior.motor.porAlumno : {};
		var diags = actual.diagnosticas || {};
		var boletas = actual.boletas || {};
		var cerrados = actual.cerrados || {};

		modelo.alumnos = alumnosCtx.map(function (a) {
			var mA = porAlumnoA[a.id] || null, mP = porAlumnoP[a.id] || null;
			var porCampo = {}, porCampoAnterior = {};
			CAMPOS.forEach(function (c) {
				porCampo[c] = mA && mA.porCampo[c] && esNumero(mA.porCampo[c].porcentaje) ? Number(mA.porCampo[c].porcentaje) : null;
				porCampoAnterior[c] = mP && mP.porCampo[c] && esNumero(mP.porCampo[c].porcentaje) ? Number(mP.porCampo[c].porcentaje) : null;
			});
			var prom = mA ? promedioAlumno(mA.porCampo) : null;
			var promAnt = mP ? promedioAlumno(mP.porCampo) : null;
			var diag = diags[a.id] || null;
			var ppm = diag && esNumero(diag.lectura_ppm) ? Number(diag.lectura_ppm) : null;
			var banda = bandaDe(ctx, actual, a);
			var boletaT = boletas[a.id] && boletas[a.id][t] ? boletas[a.id][t] : {};
			var rubros = {};
			RUBROS_ATENCION.forEach(function (r) { rubros[r.rubro] = mA ? fraccionRubro(mA.porCampo, r.rubro) : null; });
			return {
				id: a.id, nombre: a.nombre, num: a.num, grado: a.grado,
				actual: prom,
				anterior: comparacion ? promAnt : null,
				delta: comparacion ? delta(prom, promAnt) : null,
				porCampo: porCampo,
				porCampoAnterior: porCampoAnterior,
				ppm: ppm,
				banda: banda,
				fluidez: CH().clasificarPPM(ppm, banda),
				rubros: rubros,
				// Boleta completa confirmada por el docente (los cuatro campos)
				confirmada: CAMPOS.every(function (c) { return RD().calificacionOficial(boletaT[c]).confirmada; }),
				// Boleta cerrada: sus datos son los del cierre (lo entregado)
				cerrada: !!cerrados[a.id],
				// Algún campo con calificación por juicio docente, sin evidencias registradas
				juicio: CAMPOS.some(function (c) {
					return RD().juicioSinEvidencias(boletaT, c, mA && mA.porCampo ? mA.porCampo[c] : undefined);
				}),
			};
		});

		var grados = [];
		modelo.alumnos.forEach(function (a) { if (grados.indexOf(a.grado) === -1) grados.push(a.grado); });
		grados.sort(function (x, y) { return x - y; });

		modelo.resumen = resumir(modelo.alumnos, comparacion);
		modelo.porCampo = promediosPorCampo(modelo.alumnos, comparacion);
		modelo.confirmadas = { alumnos: modelo.alumnos.filter(function (a) { return a.confirmada; }).length, total: modelo.alumnos.length };
		modelo.cierre = {
			cerrados: modelo.alumnos.filter(function (a) { return a.cerrada; }).length,
			total: modelo.alumnos.length,
			juicio: modelo.alumnos.filter(function (a) { return a.juicio; }).length,
		};
		modelo.grados = grados.map(function (g) {
			var lista = modelo.alumnos.filter(function (a) { return a.grado === g; });
			var niveles = { requiere_apoyo: 0, cercano: 0, estandar: 0, avanzado: 0, sinDato: 0 };
			lista.forEach(function (a) { if (a.fluidez) niveles[a.fluidez]++; else niveles.sinDato++; });
			return {
				grado: g,
				color: RD().COLOR_GRADO[g] || "#2563eb",
				alumnos: lista,
				resumen: resumir(lista, comparacion),
				porCampo: promediosPorCampo(lista, comparacion),
				banda: (ctx.bandas || {})[g] || null,
				fluidez: niveles,
			};
		});

		var ids = {};
		modelo.alumnos.forEach(function (a) { ids[a.id] = true; });
		modelo.atencion = {
			lectura: conteo(modelo.alumnos, grados, function (a) {
				if (!a.fluidez) return null;
				return a.fluidez === "requiere_apoyo" || a.fluidez === "cercano";
			}),
			rubros: RUBROS_ATENCION.map(function (def) {
				var c = conteo(modelo.alumnos, grados, function (a) {
					var v = a.rubros[def.rubro];
					return v === null ? null : v < def.umbral;
				});
				c.def = def;
				return c;
			}),
			pda: pdaConMayoriaApoyo(actual.avancePda, ids),
		};
		modelo.sugerencias = sugerenciasFrecuentes(ctx, actual, alumnosCtx);
		return modelo;
	}

	// ── HTML de las diapositivas ─────────────────────────────────────────────
	function etiquetaAlumno(a, mostrarNombres) {
		var num = a.num === null || a.num === undefined || a.num === "" ? "s/n" : a.num;
		if (mostrarNombres) {
			return "<span class='j-num'>" + esc(num) + "</span><span class='j-nombre' title='" + esc(a.nombre) + "'>" + esc(a.nombre) + "</span>";
		}
		return "<span class='j-num'>No. " + esc(num) + "</span>";
	}

	function insigniaDelta(d, unidad) {
		if (d === null || d === undefined) return "";
		var clase = d > 0 ? "j-delta j-sube" : "j-delta j-neutro";
		return "<span class='" + clase + "'>" + fmtDelta(d) + (unidad || "") + "</span>";
	}

	function ancho(v) { return Math.max(0, Math.min(100, Number(v))).toFixed(1); }

	function encabezado(modelo, titulo, subtitulo) {
		return "<header class='j-cab'><p class='j-ceja'>" + esc(modelo.grupo.nombre) + " · " + esc(modelo.nombreTrimestre) + "</p>" +
			"<h2 class='j-titulo'>" + esc(titulo) + "</h2>" +
			(subtitulo ? "<p class='j-subtitulo'>" + subtitulo + "</p>" : "") + "</header>";
	}

	function textoSinComparacion(modelo) {
		if (modelo.motivoSinComparacion === "primero") {
			return "Sin trimestre anterior: es la primera medición del ciclo. La comparación aparece a partir del 2do trimestre.";
		}
		return "Sin trimestre anterior: no hay datos del " + modelo.nombreAnterior + " para comparar.";
	}

	function fechaLarga(fecha) {
		if (!fecha) return "";
		try {
			return new Date(fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
		} catch (e) {
			return "";
		}
	}

	function diapositivaPortada(modelo, op) {
		var g = modelo.grupo;
		var datos = [
			g.escuela ? "<p class='j-portada-escuela'>" + esc(g.escuela) + "</p>" : "",
			"<p class='j-portada-linea'>" + esc(g.nombre) + (g.ciclo ? " · Ciclo escolar " + esc(g.ciclo) : "") + "</p>",
			g.maestro ? "<p class='j-portada-linea'>Docente: " + esc(g.maestro) + "</p>" : "",
			modelo.fecha ? "<p class='j-portada-linea'>" + esc(fechaLarga(modelo.fecha)) + "</p>" : "",
		].join("");
		var nota = op.mostrarNombres
			? "Nombres visibles: esta vista es solo para el docente. Para proyectar a las familias hay que apagar \"Mostrar nombres\"."
			: "Para cuidar la privacidad de cada niña y niño, los alumnos aparecen con su número de lista, sin nombre, " +
				"y las áreas de atención se muestran solo como conteos del grupo. Cada familia recibe el detalle de su hija o hijo en la boleta.";
		return {
			titulo: "Portada",
			clase: "j-portada",
			html: "<div class='j-portada-cuerpo'>" +
				"<p class='j-portada-ceja'>Junta con madres, padres y tutores</p>" +
				"<h1 class='j-portada-titulo'>Avance del grupo</h1>" +
				"<p class='j-portada-trimestre'>" + esc(modelo.nombreTrimestre) + "</p>" +
				"<div class='j-portada-datos'>" + datos + "</div>" +
				"</div>" +
				"<div class='j-portada-nota'>" + icono("privacidad", "j-ico j-ico-nota") + "<p>" + esc(nota) +
				" Mi salón es un complemento de la boleta oficial (SIGED); no la sustituye.</p></div>",
		};
	}

	/*
		Qué datos se ven cuando hay boletas cerradas: las cerradas, como se entregaron (foto
		del cierre); las abiertas, lo capturado hasta hoy. Solo se explica si hay alguna cerrada.
	*/
	function textoCierre(ci) {
		if (!ci || !(ci.cerrados > 0)) return "";
		if (ci.cerrados >= ci.total) return "Todas las boletas del trimestre están cerradas: los datos son los que se entregaron.";
		return ci.cerrados + " de " + ci.total + " alumnos tienen la boleta cerrada: sus datos son los que se entregaron; " +
			"los de los demás son lo capturado hasta hoy y todavía pueden cambiar.";
	}

	function diapositivaPanorama(modelo) {
		var r = modelo.resumen;
		var hero = "<div class='j-tile j-tile-hero'>" +
			"<p class='j-tile-etq'>Promedio de logro del grupo</p>" +
			"<p class='j-hero'>" + esc(fmtPct(r.actual, 1)) + "</p>" +
			"<p class='j-tile-sub'>" + esc(modelo.nombreTrimestre) + " · " + r.conDatos + " de " + r.n + " alumnos con datos</p>" +
			"</div>";

		var comparativo;
		if (modelo.comparacion) {
			comparativo = "<div class='j-tile'>" +
				"<p class='j-tile-etq'>Comparación con el trimestre anterior</p>" +
				"<div class='j-comparativo'>" +
				"<div><p class='j-tile-sub'>" + esc(modelo.nombreAnterior) + "</p><p class='j-num-grande j-apagado'>" + esc(fmtPct(r.anterior, 1)) + "</p></div>" +
				"<span class='j-flecha' aria-hidden='true'>→</span>" +
				"<div><p class='j-tile-sub'>" + esc(modelo.nombreTrimestre) + "</p><p class='j-num-grande'>" + esc(fmtPct(r.actualComparable, 1)) + "</p></div>" +
				"</div>" +
				(r.delta !== null ? "<p class='j-tile-linea'>Cambio del grupo: " + insigniaDelta(r.delta, " puntos") + "</p>" : "") +
				(r.mismosAlumnos ? "" : "<p class='j-tile-sub'>Compara a los mismos " + r.comparables + " alumnos que tienen datos en ambos trimestres.</p>") +
				"<p class='j-tile-linea'><strong>" + r.mejoraron + " de " + r.comparables + "</strong> alumnos subieron su promedio de logro.</p>" +
				"</div>";
		} else {
			comparativo = "<div class='j-tile j-tile-vacio'>" +
				"<p class='j-tile-etq'>Comparación con el trimestre anterior</p>" +
				"<p class='j-tile-linea'>" + esc(textoSinComparacion(modelo)) + "</p>" +
				"</div>";
		}

		var grados = modelo.grados.length > 1
			? "<div class='j-tile'><p class='j-tile-etq'>Por grado</p>" +
				modelo.grados.map(function (g) {
					return "<div class='j-grado-linea'><span class='j-badge' style='background:" + g.color + "'>" + textoGrado(g.grado) + "</span>" +
						"<span class='j-grado-val'>" + esc(fmtPct(g.resumen.actual, 1)) + "</span>" +
						(modelo.comparacion ? insigniaDelta(g.resumen.delta, " pts") : "") +
						"<span class='j-grado-n'>" + g.resumen.n + " alumnos</span></div>";
				}).join("") + "</div>"
			: "";

		var c = modelo.confirmadas;
		var ci = modelo.cierre || { cerrados: 0, total: 0, juicio: 0 };
		var boleta = "<div class='j-tile j-tile-boleta'>" +
			"<p class='j-tile-etq'>Boleta del trimestre</p>" +
			"<p class='j-tile-linea'><strong>" + c.alumnos + " de " + c.total + "</strong> alumnos con calificación confirmada por el docente.</p>" +
			(ci.juicio > 0
				? "<p class='j-tile-sub' data-junta-juicio>" + ci.juicio + (ci.juicio === 1 ? " alumno tiene" : " alumnos tienen") +
					" alguna calificación asignada por juicio docente, sin evidencias registradas en el trimestre.</p>"
				: "") +
			"<p class='j-tile-sub'>La calificación de la boleta es un juicio del docente; esta presentación muestra porcentajes de logro, no calificaciones.</p>" +
			(textoCierre(ci) ? "<p class='j-tile-sub' data-junta-cierre>" + esc(textoCierre(ci)) + "</p>" : "") +
			"</div>";

		return {
			titulo: "Panorama del grupo",
			html: encabezado(modelo, "Panorama del grupo") +
				"<div class='j-cuerpo'><div class='j-panorama'>" + hero + comparativo + grados + boleta + "</div>" +
				"<p class='j-nota'>Porcentaje de logro: combina tareas, trabajos, participación y examen de cada campo formativo " +
				"con los pesos que definió el docente (el examen por campo es aproximado). El promedio de cada alumno es el de sus campos con datos; " +
				"el del grupo, el de sus alumnos. La asistencia y la conducta no cuentan para la calificación: la conducta se informa aparte.</p></div>",
		};
	}

	function leyendaBarras(modelo, color) {
		var actual = "<span class='j-ley'><span class='j-ley-barra' style='background:" + color + "'></span>" + esc(modelo.nombreTrimestre) + "</span>";
		if (!modelo.comparacion) {
			return "<div class='j-leyenda'>" + actual + "<span class='j-ley j-ley-nota'>Sin trimestre anterior</span></div>";
		}
		return "<div class='j-leyenda'><span class='j-ley'><span class='j-ley-barra j-ley-ant'></span>" + esc(modelo.nombreAnterior) + "</span>" + actual +
			"<span class='j-ley j-ley-nota'>El número de la derecha es el cambio en puntos</span></div>";
	}

	function filaBarra(a, color, comparacion, mostrarNombres) {
		var barras = "";
		if (comparacion && a.anterior !== null) {
			barras += "<div class='j-barra j-barra-ant' style='width:" + ancho(a.anterior) + "%'></div>";
		}
		if (a.actual !== null) {
			barras += "<div class='j-barra j-barra-act' style='width:" + ancho(a.actual) + "%;background:" + color + "'></div>";
		} else {
			barras += "<span class='j-sin'>Sin datos este trimestre</span>";
		}
		var valor = "<span class='j-valor'>" + (a.actual !== null ? esc(fmtPct(a.actual, 0)) : "—") + "</span>" +
			(comparacion ? insigniaDelta(a.delta) : "");
		return "<div class='j-fila'><div class='j-etq'>" + etiquetaAlumno(a, mostrarNombres) + "</div>" +
			"<div class='j-pista" + (comparacion ? " j-con-ant" : "") + "'>" + barras + "</div>" +
			"<div class='j-val'>" + valor + "</div></div>";
	}

	function ejeBarras() {
		return "<div class='j-fila j-fila-eje' aria-hidden='true'><div></div><div class='j-eje'>" +
			[0, 25, 50, 75, 100].map(function (v) { return "<span style='left:" + v + "%'>" + v + (v === 100 ? " %" : "") + "</span>"; }).join("") +
			"</div><div></div></div>";
	}

	function partir(lista, tam) {
		var trozos = [];
		for (var i = 0; i < lista.length; i += tam) trozos.push(lista.slice(i, i + tam));
		return trozos.length ? trozos : [[]];
	}

	function diapositivasGrado(modelo, g, op) {
		var trozos = partir(g.alumnos, FILAS_POR_DIAPOSITIVA);
		var r = g.resumen;
		var resumen = "<div class='j-resumen-grado'><span class='j-badge' style='background:" + g.color + "'>" + textoGrado(g.grado) + "</span>" +
			"<span>Promedio de " + textoGrado(g.grado) + ": <strong>" + esc(fmtPct(r.actual, 1)) + "</strong></span>" +
			(modelo.comparacion && r.anterior !== null
				? (r.mismosAlumnos
					? "<span>" + esc(modelo.nombreAnterior) + ": " + esc(fmtPct(r.anterior, 1)) + "</span>"
					: "<span>Mismos " + r.comparables + " alumnos: " + esc(fmtPct(r.anterior, 1)) + " → " + esc(fmtPct(r.actualComparable, 1)) + "</span>") +
					"<span>Cambio: " + insigniaDelta(r.delta, " puntos") + "</span>" +
					"<span>" + r.mejoraron + " de " + r.comparables + " subieron su promedio</span>"
				: "") +
			"</div>";
		return trozos.map(function (trozo, i) {
			var columnas = trozo.length > FILAS_POR_COLUMNA ? 2 : 1;
			var porColumna = Math.ceil(trozo.length / columnas) || 1;
			var alto = Math.min(3, 18 / Math.max(porColumna, 1));
			var cols = partir(trozo, porColumna).map(function (col) {
				return "<div class='j-col'>" + col.map(function (a) {
					return filaBarra(a, g.color, modelo.comparacion, op.mostrarNombres);
				}).join("") + ejeBarras() + "</div>";
			}).join("");
			var titulo = "Desempeño de " + textoGrado(g.grado) + " grado" + (trozos.length > 1 ? " (" + (i + 1) + " de " + trozos.length + ")" : "");
			return {
				titulo: titulo,
				html: encabezado(modelo, titulo, "Promedio de logro de cada alumno en sus campos formativos, en orden de lista.") +
					"<div class='j-cuerpo'>" + resumen +
					"<div class='j-cols" + (op.mostrarNombres ? " j-con-nombres" : "") + "' style='--columnas:" + columnas + ";--alto:" + alto.toFixed(2) + "em'>" + cols + "</div>" +
					leyendaBarras(modelo, g.color) + "</div>",
			};
		});
	}

	function escalaFluidez(banda, alumnos) {
		var maxPpm = 0;
		alumnos.forEach(function (a) { if (a.ppm !== null && a.ppm > maxPpm) maxPpm = a.ppm; });
		var base = banda ? Math.max(banda.estandar_max * 1.3, banda.estandar_max + 15) : 60;
		return Math.ceil(Math.max(base, maxPpm * 1.1, 10) / 10) * 10;
	}

	function fondoBanda(banda, max) {
		if (!banda) return "#eef2f7";
		var cortes = [banda.requiere_apoyo_max + 0.5, banda.cercano_max + 0.5, banda.estandar_max + 0.5].map(function (v) {
			return Math.min(100, v / max * 100).toFixed(2) + "%";
		});
		var z = ZONAS_FLUIDEZ;
		return "linear-gradient(to right," +
			z[0].color + " 0 " + cortes[0] + "," + z[1].color + " " + cortes[0] + " " + cortes[1] + "," +
			z[2].color + " " + cortes[1] + " " + cortes[2] + "," + z[3].color + " " + cortes[2] + " 100%)";
	}

	function panelFluidez(modelo, g, lista, op) {
		var banda = g.banda;
		var max = escalaFluidez(banda, g.alumnos);
		var fondo = fondoBanda(banda, max);
		var marcas = banda
			? [banda.requiere_apoyo_max + 1, banda.cercano_max + 1, banda.estandar_max + 1].map(function (v) {
				return "<span style='left:" + Math.min(100, (v - 0.5) / max * 100).toFixed(2) + "%'>" + v + "</span>";
			}).join("")
			: "";
		var eje = "<div class='j-fila j-fila-eje' aria-hidden='true'><div></div><div class='j-eje j-eje-arriba'>" + marcas +
			"<span class='j-eje-fin' style='left:100%'>ppm</span></div><div></div></div>";
		var filas = lista.map(function (a) {
			var punto = a.ppm !== null
				? "<span class='j-punto-ppm' style='left:" + Math.min(100, a.ppm / max * 100).toFixed(2) + "%'></span>"
				: "<span class='j-sin'>Sin registro de lectura</span>";
			// Sin nombres, la fluidez no lleva ni el número de lista: en un grupo chico el
			// número identifica a quien cae en la franja más baja
			return "<div class='j-fila'><div class='j-etq'>" + (op.mostrarNombres ? etiquetaAlumno(a, true) : "") + "</div>" +
				"<div class='j-pista j-pista-banda' style='background:" + fondo + "'>" + punto + "</div>" +
				"<div class='j-val'><span class='j-valor'>" + (a.ppm !== null ? esc(a.ppm) + " ppm" : "—") + "</span></div></div>";
		}).join("");
		var n = g.fluidez;
		var conDato = g.alumnos.length - n.sinDato;
		// Sin ningún alumno con lectura registrada no hay proporción que dar ("0 de 0")
		var resumen = !banda
			? "Sin referencia de palabras por minuto para este grado."
			: (conDato > 0
				? "<strong>" + (n.estandar + n.avanzado) + " de " + conDato + "</strong> alcanzan la referencia de su grado o la superan."
				: "<span data-sin-datos-ppm>Todavía no hay datos: ningún alumno de este grado tiene registrada su velocidad de lectura.</span>");
		return "<div class='j-panel-fluidez'>" +
			"<div class='j-resumen-grado'><span class='j-badge' style='background:" + g.color + "'>" + textoGrado(g.grado) + "</span>" +
			"<span>" + resumen + "</span>" +
			(banda ? "<span class='j-apagado' data-referencia-ppm>Referencia SEP 2010 para " + textoGrado(g.grado) + ": " + (banda.cercano_max + 1) + " a " + banda.estandar_max + " ppm</span>" : "") +
			"</div>" + eje + filas + "</div>";
	}

	// Presupuesto vertical de una diapositiva de fluidez (em): cada grado ocupa su
	// encabezado y su eje (ALTO_PANEL) más una fila por alumno de al menos ALTO_MIN.
	var ALTO_UTIL = 22, ALTO_PANEL = 3.4, ALTO_MIN = 1.55;
	function cabeFluidez(filas, paneles) { return filas * ALTO_MIN + paneles * ALTO_PANEL <= ALTO_UTIL; }

	// Empaca los grados en diapositivas de fluidez sin pasarse del presupuesto
	function diapositivasFluidez(modelo, op) {
		var bloques = [];
		modelo.grados.forEach(function (g) {
			// Sin nombres se ordena por palabras por minuto (no por lista) para que la
			// posición tampoco identifique a nadie
			var lista = op.mostrarNombres ? g.alumnos : g.alumnos.slice().sort(function (a, b) {
				if (a.ppm === null) return 1;
				if (b.ppm === null) return -1;
				return a.ppm - b.ppm;
			});
			partir(lista, FILAS_FLUIDEZ).forEach(function (trozo) { bloques.push({ g: g, lista: trozo }); });
		});
		var paginas = [], actual = [], filas = 0;
		bloques.forEach(function (b) {
			if (actual.length && !cabeFluidez(filas + b.lista.length, actual.length + 1)) { paginas.push(actual); actual = []; filas = 0; }
			actual.push(b); filas += b.lista.length;
		});
		if (actual.length) paginas.push(actual);

		var leyenda = "<div class='j-leyenda'>" + ZONAS_FLUIDEZ.map(function (z) {
			return "<span class='j-ley'><span class='j-ley-zona' style='background:" + z.color + "'></span>" + esc(CH().ETIQUETA_FLUIDEZ[z.nivel]) + "</span>";
		}).join("") + "<span class='j-ley'><span class='j-punto-ppm j-punto-ley'></span>Palabras por minuto del alumno</span></div>";

		return paginas.map(function (pagina, i) {
			var filas = pagina.reduce(function (s, b) { return s + b.lista.length; }, 0);
			var alto = Math.min(2.4, (ALTO_UTIL - pagina.length * ALTO_PANEL) / Math.max(filas, 1));
			var titulo = "Fluidez lectora" + (paginas.length > 1 ? " (" + (i + 1) + " de " + paginas.length + ")" : "");
			return {
				titulo: titulo,
				html: encabezado(modelo, titulo, op.mostrarNombres
					? "Palabras por minuto de cada alumno frente a la referencia SEP 2010 de su grado, en orden de lista."
					: "Palabras por minuto de cada alumno frente a la referencia SEP 2010 de su grado, de menor a mayor y sin identificar a nadie.") +
					"<div class='j-cuerpo'><div class='j-fluidez" + (op.mostrarNombres ? " j-con-nombres" : "") + "' style='--alto:" + alto.toFixed(2) + "em'>" +
					pagina.map(function (b) { return panelFluidez(modelo, b.g, b.lista, op); }).join("") +
					"</div>" + leyenda + "</div>",
			};
		});
	}

	function celdaCampo(dato, color, modelo) {
		if (!dato || dato.actual === null) return "<div class='j-mcelda'><span class='j-sin'>Sin datos</span></div>";
		return "<div class='j-mcelda'>" +
			"<div class='j-mpista'><div class='j-mbarra' style='width:" + ancho(dato.actual) + "%;background:" + color + "'></div></div>" +
			"<div class='j-mval'><span class='j-valor'>" + esc(fmtPct(dato.actual, 1)) + "</span>" +
			(modelo.comparacion ? insigniaDelta(dato.delta, " pts") : "") + "</div>" +
			(modelo.comparacion && dato.anterior !== null
				? "<div class='j-mant'>" + (dato.mismosAlumnos
					? esc(modelo.nombreAnterior) + ": " + esc(fmtPct(dato.anterior, 1))
					: "Mismos alumnos: " + esc(fmtPct(dato.anterior, 1)) + " → " + esc(fmtPct(dato.actualComparable, 1))) + "</div>"
				: "") +
			"</div>";
	}

	function diapositivaCampos(modelo) {
		var RDx = RD();
		var columnas = modelo.grados.map(function (g) {
			return { titulo: "<span class='j-badge' style='background:" + g.color + "'>" + textoGrado(g.grado) + "</span>", datos: g.porCampo };
		});
		if (modelo.grados.length > 1) columnas.push({ titulo: "<span class='j-mgrupo'>Grupo</span>", datos: modelo.porCampo });
		var cab = "<div></div>" + columnas.map(function (c) { return "<div class='j-mcab'>" + c.titulo + "</div>"; }).join("");
		var subconjunto = modelo.comparacion && columnas.some(function (c) {
			return RDx.CAMPOS.some(function (campo) { var d = c.datos[campo]; return d && d.anterior !== null && !d.mismosAlumnos; });
		});
		var filas = RDx.CAMPOS.map(function (campo) {
			var color = RDx.COLOR_CAMPO[campo];
			return "<div class='j-mcampo'><span class='j-punto' style='background:" + color + "'></span><span>" + esc(RDx.NOMBRE_CAMPO[campo]) + "</span></div>" +
				columnas.map(function (c) { return celdaCampo(c.datos[campo], color, modelo); }).join("");
		}).join("");
		return {
			titulo: "Promedio por campo formativo",
			html: encabezado(modelo, "Promedio por campo formativo",
				"Promedio de logro de los alumnos de cada grado en cada campo formativo." +
				(modelo.comparacion ? "" : " " + esc(textoSinComparacion(modelo)))) +
				"<div class='j-cuerpo'><div class='j-matriz' style='--columnas:" + columnas.length + "'>" + cab + filas + "</div>" +
				(subconjunto ? "<p class='j-nota'>El cambio compara solo a los alumnos que tienen datos en ambos trimestres; donde dice \"mismos alumnos\", se muestran sus dos promedios.</p>" : "") +
				"</div>",
		};
	}

	function desglose(porGrado) {
		if (!porGrado || !porGrado.length) return "";
		return "<p class='j-desglose'>" + porGrado.map(function (x) {
			return textoGrado(x.grado) + ": " + x.n + " de " + x.total;
		}).join(" · ") + "</p>";
	}

	function tarjetaAtencion(nombreIcono, titulo, principal, detalle) {
		return "<div class='j-tarjeta'><div class='j-tarjeta-cab'>" + icono(nombreIcono, "j-ico j-ico-tarjeta") +
			"<p class='j-tarjeta-titulo'>" + esc(titulo) + "</p></div>" + principal + (detalle || "") + "</div>";
	}

	function diapositivaAtencion(modelo) {
		var at = modelo.atencion;
		var tarjetas = [];
		if (at.lectura.n > 0) {
			tarjetas.push(tarjetaAtencion("lectura", "Lectura",
				"<p class='j-tarjeta-texto'><strong>" + at.lectura.n + " de " + at.lectura.total + "</strong> alumnos todavía no alcanzan la velocidad de lectura esperada para su grado.</p>",
				desglose(at.lectura.porGrado)));
		}
		at.rubros.forEach(function (r) {
			if (!(r.n > 0)) return;
			tarjetas.push(tarjetaAtencion(r.def.icono, r.def.titulo,
				"<p class='j-tarjeta-texto'><strong>" + r.n + " de " + r.total + "</strong> alumnos " + esc(r.def.frase) + "</p>",
				desglose(r.porGrado)));
		});
		var cuerpo = tarjetas.length
			? "<div class='j-tarjetas'>" + tarjetas.join("") + "</div>"
			: "<div class='j-tarjeta j-tarjeta-bien'><div class='j-tarjeta-cab'>" + icono("listo", "j-ico j-ico-tarjeta") +
				"<p class='j-tarjeta-titulo'>Sin áreas de atención generales</p></div>" +
				"<p class='j-tarjeta-texto'>En lectura, entregas, evaluación escrita, participación y convivencia, ninguna regla de atención se cumple para el grupo este trimestre.</p></div>";
		return {
			titulo: "Áreas de atención del grupo",
			html: encabezado(modelo, "Áreas de atención del grupo",
				"Lo que el grupo necesita reforzar. Son conteos del grupo: no se muestran nombres ni números de lista.") +
				"<div class='j-cuerpo'>" + cuerpo +
				"<p class='j-nota'>Reglas: lectura por debajo de la referencia SEP 2010 de su grado; tareas, trabajos o evaluación escrita por debajo de 60 % en el trimestre; " +
				"participación y convivencia por debajo del valor habitual del día. Cada familia recibe en la boleta el detalle de su hija o hijo.</p></div>",
		};
	}

	// Aprendizajes (PDA) con mayoría en requiere apoyo: diapositiva propia para que quepan
	function diapositivaPda(modelo) {
		var RDx = RD();
		var pda = modelo.atencion.pda;
		var cuerpo;
		if (!pda.length) {
			cuerpo = "<div class='j-tarjeta j-tarjeta-bien'><div class='j-tarjeta-cab'>" + icono("listo", "j-ico j-ico-tarjeta") +
				"<p class='j-tarjeta-titulo'>Ningún aprendizaje con la mayoría del grado en apoyo</p></div>" +
				"<p class='j-tarjeta-texto'>En los aprendizajes (PDA) trabajados con evidencia suficiente, la mayoría de cada grado va en proceso o ya los logró.</p></div>";
		} else {
			var visibles = pda.slice(0, MAX_PDA);
			cuerpo = "<ul class='j-lista-pda'>" + visibles.map(function (p) {
				var color = RDx.COLOR_GRADO[p.grado] || "#2563eb";
				var colorCampo = p.campo ? RDx.COLOR_CAMPO[p.campo] : "#475569";
				return "<li><span class='j-badge' style='background:" + color + "'>" + textoGrado(p.grado) + "</span>" +
					(p.campo ? "<span class='j-campo-chip' style='border-color:" + colorCampo + ";color:" + colorCampo + "' title='" + esc(RDx.NOMBRE_CAMPO[p.campo]) + "'>" + esc(p.campo) + "</span>" : "") +
					"<span class='j-pda-texto'>" + esc(p.texto) + "</span>" +
					"<span class='j-pda-n'>" + p.n + " de " + p.total + " alumnos</span></li>";
			}).join("") + "</ul>" +
				(pda.length > visibles.length ? "<p class='j-tarjeta-sub'>Y " + (pda.length - visibles.length) + " aprendizaje(s) más en la misma situación.</p>" : "");
		}
		return {
			titulo: "Aprendizajes por reforzar",
			html: encabezado(modelo, "Aprendizajes por reforzar",
				"Aprendizajes (PDA) donde más de la mitad de los alumnos del grado todavía necesita apoyo. Son conteos: sin nombres.") +
				"<div class='j-cuerpo'>" + cuerpo +
				"<p class='j-nota'>Regla: se cuentan los alumnos con al menos 2 evidencias del aprendizaje; aparece si más de la mitad quedó en \"requiere apoyo\" " +
				"(mínimo 2 alumnos evaluados).</p></div>",
		};
	}

	function diapositivaCierre(modelo) {
		var sugerencias = (modelo.sugerencias || []).map(function (s) { return s.texto; });
		var generales = !sugerencias.length;
		if (generales) sugerencias = SUGERENCIAS_GENERALES.slice();
		var cita = modelo.grupo.maestro
			? "Para platicar del avance de su hija o hijo, acuerden una cita con " + modelo.grupo.maestro + "."
			: "Para platicar del avance de su hija o hijo, acuerden una cita con el docente del grupo.";
		return {
			titulo: "Cómo apoyar en casa",
			html: encabezado(modelo, "¿Cómo pueden apoyar en casa?",
				generales ? "Recomendaciones generales para acompañar el aprendizaje." : "Las recomendaciones que más se repiten en el grupo este trimestre.") +
				"<div class='j-cuerpo'><ol class='j-sugerencias'>" + sugerencias.map(function (s, i) {
					return "<li><span class='j-sug-num'>" + (i + 1) + "</span><span>" + esc(s) + "</span></li>";
				}).join("") + "</ol>" +
				"<div class='j-cierre'>" +
				"<p>" + icono("casa", "j-ico j-ico-linea") + "Cada familia recibe en la boleta las fortalezas y sugerencias particulares de su hija o hijo.</p>" +
				"<p>" + icono("mensaje", "j-ico j-ico-linea") + esc(cita) + "</p>" +
				"<p class='j-gracias'>Gracias por su acompañamiento.</p>" +
				"</div></div>",
		};
	}

	/*
		diapositivas(modelo, {mostrarNombres}) → [{titulo, html, clase}]
		Solo se llama con modelo.hayDatos; si no, la página muestra el estado vacío.
	*/
	function diapositivas(modelo, op) {
		op = op || {};
		var lista = [diapositivaPortada(modelo, op), diapositivaPanorama(modelo)];
		modelo.grados.forEach(function (g) { lista = lista.concat(diapositivasGrado(modelo, g, op)); });
		lista = lista.concat(diapositivasFluidez(modelo, op));
		lista.push(diapositivaCampos(modelo));
		lista.push(diapositivaAtencion(modelo));
		lista.push(diapositivaPda(modelo));
		lista.push(diapositivaCierre(modelo));
		return lista;
	}

	function montar(lista, modelo) {
		var total = lista.length;
		return lista.map(function (d, i) {
			return "<section class='j-slide" + (d.clase ? " " + d.clase : "") + "' data-i='" + i + "' " +
				"aria-roledescription='diapositiva' aria-label='" + esc((i + 1) + " de " + total + ": " + d.titulo) + "'>" +
				d.html +
				"<footer class='j-pie'><span>Mi salón · complemento de la boleta oficial</span>" +
				"<span>" + esc(modelo.grupo.nombre) + " · " + esc(modelo.nombreTrimestre) + "</span>" +
				"<span>" + (i + 1) + " / " + total + "</span></footer>" +
				"</section>";
		}).join("");
	}

	var api = {
		UMBRAL_RUBRO: UMBRAL_RUBRO,
		UMBRAL_DIARIO: UMBRAL_DIARIO,
		MIN_DESGLOSE: MIN_DESGLOSE,
		NOMBRE_TRIMESTRE: NOMBRE_TRIMESTRE,
		media: media,
		delta: delta,
		promedioAlumno: promedioAlumno,
		fraccionRubro: fraccionRubro,
		hayDatos: hayDatos,
		pdaConMayoriaApoyo: pdaConMayoriaApoyo,
		clavePlantilla: clavePlantilla,
		sugerenciasFrecuentes: sugerenciasFrecuentes,
		textoCierre: textoCierre,
		construirModelo: construirModelo,
		diapositivas: diapositivas,
		montar: montar,
		icono: icono,
	};

	if (typeof module !== "undefined" && module.exports) module.exports = api; // pruebas en node
	if (typeof window === "undefined" || typeof document === "undefined" || !document.addEventListener) return;
	window.Junta = api;

	// ── Página ────────────────────────────────────────────────────────────────
	document.addEventListener("DOMContentLoaded", async function () {
		if (!window.sb) { window.location.href = "index.html"; return; }

		// Estado
		var ctx = null;
		var trimestre = null;
		var modelo = null;
		var total = 0;
		var indice = 0;
		var mostrarNombres = false; // apagado por defecto y no se guarda
		var solicitud = 0;          // la última carga pedida es la que manda
		var toque = null;

		var el = {
			subtitulo: document.getElementById("juntaSubtitulo"),
			mensaje: document.getElementById("juntaMensaje"),
			avisoNombres: document.getElementById("juntaAvisoNombres"),
			trimestres: document.getElementById("juntaTrimestres"),
			nombres: document.getElementById("juntaNombres"),
			imprimir: document.getElementById("juntaImprimir"),
			pantallaBtn: document.getElementById("juntaPantallaBtn"),
			pantalla: document.getElementById("juntaPantalla"),
			escenario: document.getElementById("juntaEscenario"),
			deck: document.getElementById("juntaDeck"),
			controles: document.getElementById("juntaControles"),
			anterior: document.getElementById("juntaAnterior"),
			siguiente: document.getElementById("juntaSiguiente"),
			indicador: document.getElementById("juntaIndicador"),
			ayuda: document.getElementById("juntaAyuda"),
		};

		function mensaje(tipo, texto) {
			if (!texto) { el.mensaje.classList.add("hidden"); return; }
			el.mensaje.className = "no-print rounded-xl px-4 py-3 text-sm " +
				(tipo === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-blue-50 text-blue-800 border border-blue-200");
			el.mensaje.textContent = texto;
		}

		function hayPresentacion() { return !!(modelo && modelo.hayDatos && total > 0); }

		function controlesActivos(activos) {
			[el.imprimir, el.pantallaBtn].forEach(function (b) { if (b) b.disabled = !activos; });
			el.controles.classList.toggle("hidden", !activos);
			el.ayuda.classList.toggle("hidden", !activos);
		}

		function pintarTrimestres() {
			Array.prototype.forEach.call(el.trimestres.querySelectorAll("button[data-trimestre]"), function (b) {
				var activo = Number(b.dataset.trimestre) === trimestre;
				b.setAttribute("aria-pressed", activo ? "true" : "false");
				b.className = "min-h-[44px] px-3 sm:px-4 rounded-lg text-sm font-semibold transition-colors " +
					(activo ? "bg-blue-800 text-white" : "text-gray-700 hover:bg-gray-100");
			});
		}

		function estadoCarga(texto) {
			el.deck.innerHTML = "<div class='j-estado'><p>" + esc(texto) + "</p></div>";
			total = 0;
			controlesActivos(false);
		}

		function estadoVacio() {
			el.deck.innerHTML = "<div class='j-estado'>" +
				"<p class='j-estado-titulo'>Todavía no hay datos del " + esc(nombreTrimestre(trimestre)) + "</p>" +
				"<p>La presentación se arma sola con lo que captures en <a href='hoy.html'>Hoy</a> (productos, tareas y cierre del día) " +
				"y en <a href='evaluacion_diagnostica.html'>Diagnóstico</a> (lectura). Cuando este trimestre tenga proyectos con evidencias, aparecerá aquí.</p>" +
				"<p class='j-estado-sub'>Si buscas otro trimestre, elígelo arriba.</p></div>";
			total = 0;
			el.indicador.textContent = "";
			controlesActivos(false);
		}

		function pintar() {
			if (!modelo || !modelo.hayDatos) { estadoVacio(); return; }
			var lista = diapositivas(modelo, { mostrarNombres: mostrarNombres });
			total = lista.length;
			el.deck.innerHTML = montar(lista, modelo);
			controlesActivos(true);
			ir(Math.min(indice, total - 1));
		}

		function ir(i) {
			if (!hayPresentacion()) return;
			indice = Math.max(0, Math.min(total - 1, i));
			Array.prototype.forEach.call(el.deck.querySelectorAll(".j-slide"), function (s) {
				var activa = Number(s.dataset.i) === indice;
				s.classList.toggle("j-activa", activa);
				s.setAttribute("aria-hidden", activa ? "false" : "true");
			});
			el.indicador.textContent = (indice + 1) + " / " + total;
			el.anterior.disabled = indice === 0;
			el.siguiente.disabled = indice === total - 1;
		}

		async function cargarTrimestre(t) {
			var mia = ++solicitud;
			trimestre = t;
			pintarTrimestres();
			mensaje(null);
			estadoCarga("Cargando el " + nombreTrimestre(t) + "...");
			try {
				var pedidos = [window.ReporteDatos.grupoTrimestre(window.sb, ctx, t)];
				if (t > 1) pedidos.push(window.ReporteDatos.grupoTrimestre(window.sb, ctx, t - 1));
				var res = await Promise.all(pedidos);
				if (mia !== solicitud) return; // el maestro ya pidió otro trimestre
				modelo = construirModelo({ ctx: ctx, trimestre: t, actual: res[0], anterior: res[1] || null, fecha: new Date() });
				indice = 0;
				try {
					var url = new URL(window.location.href);
					url.searchParams.set("t", String(t));
					window.history.replaceState(null, "", url.toString());
				} catch (e) { /* sin URL: no pasa nada */ }
				pintar();
			} catch (e) {
				if (mia !== solicitud) return;
				console.error("junta: carga del trimestre", e);
				modelo = null;
				estadoCarga("No se pudo armar la presentación.");
				mensaje("error", "No se pudieron cargar los datos del " + nombreTrimestre(t) + ": " + (e.message || "error desconocido"));
			}
		}

		// Trimestre inicial: el de la URL (?t=) o el último con proyectos del grupo
		async function trimestreInicial() {
			var desdeUrl = Number(new URLSearchParams(window.location.search).get("t"));
			if (desdeUrl >= 1 && desdeUrl <= 3) return desdeUrl;
			var res = await window.sb.from("proyectos").select("trimestre")
				.eq("maestro_id", ctx.maestroId).eq("grupo_id", ctx.grupo.id);
			if (res.error) throw res.error;
			var max = 1;
			(res.data || []).forEach(function (p) {
				var t = Number(p.trimestre);
				if (t >= 1 && t <= 3 && t > max) max = t;
			});
			return max;
		}

		// ── Eventos ─────────────────────────────────────────────────────────────
		el.anterior.addEventListener("click", function () { ir(indice - 1); });
		el.siguiente.addEventListener("click", function () { ir(indice + 1); });

		el.trimestres.addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("button[data-trimestre]") : null;
			if (!b || !ctx || !ctx.grupo) return;
			var t = Number(b.dataset.trimestre);
			if (t === trimestre && modelo) return;
			cargarTrimestre(t);
		});

		el.nombres.addEventListener("click", function () {
			mostrarNombres = !mostrarNombres;
			el.nombres.setAttribute("aria-checked", mostrarNombres ? "true" : "false");
			el.nombres.classList.toggle("j-switch-on", mostrarNombres);
			el.avisoNombres.classList.toggle("hidden", !mostrarNombres);
			if (modelo && modelo.hayDatos) pintar();
		});

		el.imprimir.addEventListener("click", function () { window.print(); });

		function enPantallaCompleta() { return document.fullscreenElement === el.pantalla; }
		if (!document.fullscreenEnabled || !el.pantalla.requestFullscreen) {
			el.pantallaBtn.classList.add("hidden");
		}
		el.pantallaBtn.addEventListener("click", function () {
			if (enPantallaCompleta()) {
				document.exitFullscreen().catch(function () {});
			} else {
				el.pantalla.requestFullscreen().catch(function (e) {
					console.warn("junta: pantalla completa no disponible", e);
				});
			}
		});
		document.addEventListener("fullscreenchange", function () {
			var activa = enPantallaCompleta();
			el.pantallaBtn.innerHTML = icono(activa ? "salir" : "pantalla", "h-5 w-5") +
				"<span>" + (activa ? "Salir de pantalla completa" : "Pantalla completa") + "</span>";
			if (activa) el.escenario.focus({ preventScroll: true });
		});

		// Teclado: flechas, Av/Re Pág, Inicio/Fin y espacio (sin robar teclas a los controles)
		document.addEventListener("keydown", function (e) {
			if (!hayPresentacion() || e.altKey || e.ctrlKey || e.metaKey) return;
			var tag = (e.target && e.target.tagName) || "";
			if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
			var enBoton = tag === "BUTTON" || tag === "A";
			var k = e.key;
			if (k === "ArrowRight" || k === "PageDown" || (k === " " && !enBoton && !e.shiftKey)) {
				e.preventDefault(); ir(indice + 1);
			} else if (k === "ArrowLeft" || k === "PageUp" || (k === " " && !enBoton && e.shiftKey)) {
				e.preventDefault(); ir(indice - 1);
			} else if (k === "Home" && !enBoton) {
				e.preventDefault(); ir(0);
			} else if (k === "End" && !enBoton) {
				e.preventDefault(); ir(total - 1);
			}
		});

		// Deslizar en pantallas táctiles (horizontal; el desplazamiento vertical sigue libre)
		el.escenario.addEventListener("touchstart", function (e) {
			if (e.touches.length !== 1) { toque = null; return; }
			toque = { x: e.touches[0].clientX, y: e.touches[0].clientY };
		}, { passive: true });
		el.escenario.addEventListener("touchend", function (e) {
			if (!toque || !e.changedTouches.length) return;
			var dx = e.changedTouches[0].clientX - toque.x;
			var dy = e.changedTouches[0].clientY - toque.y;
			toque = null;
			if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			ir(indice + (dx < 0 ? 1 : -1));
		}, { passive: true });

		// ── Arranque ──────────────────────────────────────────────────────────
		// Todo lo anterior ya está declarado; desde aquí se lee y se pinta.
		try {
			ctx = await window.ReporteDatos.contexto(window.sb);
			if (!ctx) { window.location.href = "index.html"; return; }
			if (!ctx.grupo) {
				el.subtitulo.textContent = "Todavía no tienes un grupo.";
				el.deck.innerHTML = "<div class='j-estado'><p class='j-estado-titulo'>Primero crea tu grupo</p>" +
					"<p>La presentación se arma con los datos de tu grupo. <a href='onboarding.html'>Crear grupo</a></p></div>";
				controlesActivos(false);
				return;
			}
			el.subtitulo.textContent = ctx.grupo.nombre + (ctx.ciclo ? " · Ciclo " + ctx.ciclo : "") + " · " + ctx.alumnos.length + " alumnos";
			await cargarTrimestre(await trimestreInicial());
		} catch (e) {
			console.error("junta: arranque", e);
			estadoCarga("No se pudo armar la presentación.");
			mensaje("error", "No se pudo cargar la presentación: " + (e.message || "error desconocido"));
		}
	});
})();
