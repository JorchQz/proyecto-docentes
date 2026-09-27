/*
	historico.js — Reglas del registro histórico (spec de Jorge del 2026-09-26, §4): el asistente
	"Ponte al día" (ponte-al-dia.html) y el alta con lista pegada (onboarding.html).

	Quien entra a mitad del trimestre ya lleva semanas de clases. La meta: ponerse al día con un
	grupo multigrado de 30 alumnos en una sola tarde (menos de 2 horas).

	Solo reglas puras, sin pantalla ni base (se prueban en node: pruebas/registro-historico.test.js):

	  parsearLista(texto, opciones)  → la lista pegada de Excel, Word o WhatsApp, un nombre por
	      renglón: separa apellido paterno, materno y nombre(s) cuando se puede, detecta el grado
	      (columna, "3°" al final o un renglón de encabezado "TERCER GRADO") y quita números de
	      lista, viñetas y lo que agrega WhatsApp. MAYÚSCULAS con acentos y Ñ (js/nombres-alumno.js).
	  periodoVigente(hoy, filasPeriodos) → { ciclo, trimestre, inicio, fuente }: de la tabla
	      mi_salon_periodos si existe (la crea el constructor de accesos); si no, del calendario SEP.
	  ofrecerPonteAlDia(hoy, periodo) → ¿hoy es posterior al inicio del periodo vigente?
	  diasHistoricos(inicio, hoy, ajustes) → días de clase del inicio del periodo a AYER (calendario
	      SEP con los ajustes del grupo).
	  semanas(dias) → los días agrupados por semana (la cuadrícula se ve de una semana a la vez).
	  Asistencia: por omisión "Todos asistieron"; el docente solo marca faltas. siguienteAsistencia
	      y filasAsistencia (lo que se escribe, con el mismo modelo que la pantalla Asistencia).
	  Captura en bloque: validarActividad, itemsParaGuardar (agregar_actividades_historicas),
	      siguienteSemaforo, cambiosDeSemaforo y filasCalificaciones.
	  Calificación directa: escalaDirecta y validarDirecta (1° de 6 a 10; 2° a 6° de 5 a 10: la
	      misma escala de la boleta, js/reglas-entidad.js).
*/

(function () {
	"use strict";

	function modulo(global, archivo) {
		if (typeof window !== "undefined" && window[global]) return window[global];
		if (typeof require === "function") {
			try { return require("./" + archivo); } catch (e) { /* sin el script */ }
		}
		return null;
	}
	function nombres() { return modulo("NombresAlumno", "nombres-alumno.js"); }
	function calendario() { return modulo("CalendarioSEP", "calendario-sep.js"); }
	function calendarioEscolar() { return modulo("CalendarioEscolar", "calendario-escolar.js"); }
	function productosHoy() { return modulo("ProductosHoy", "productos-hoy.js"); }
	function reglasEntidad() { return modulo("ReglasEntidad", "reglas-entidad.js"); }
	function alcance() { return modulo("AlcanceHoy", "alcance-hoy.js"); }

	// ══════════════════════════════════════════════════════════════════════════
	// 1. Lista pegada
	// ══════════════════════════════════════════════════════════════════════════

	// Partículas de apellidos compuestos: van pegadas a la palabra que sigue ("DE LA CRUZ")
	var PARTICULAS = ["DE", "DEL", "LA", "LAS", "LOS", "Y", "SAN", "SANTA", "MC", "MAC", "VAN", "VON", "DA", "DI", "DOS"];

	// Nombres de pila frecuentes en México (para adivinar si la lista empieza por el nombre)
	var NOMBRES_COMUNES = ("JOSE JUAN LUIS CARLOS JORGE MIGUEL ANGEL JESUS FRANCISCO ANTONIO ALEJANDRO PEDRO " +
		"MANUEL RICARDO FERNANDO DANIEL DAVID EDUARDO JAVIER RAFAEL ROBERTO SERGIO MARIO ARTURO ALBERTO " +
		"OSCAR RAUL HECTOR ENRIQUE VICTOR GABRIEL DIEGO ADRIAN IVAN EMILIANO SANTIAGO MATEO SEBASTIAN " +
		"LEONARDO MATIAS NICOLAS SAMUEL DYLAN KEVIN BRAYAN BRYAN AXEL ANGEL URIEL ISAAC ALAN ERICK ERIK " +
		"CRISTIAN CHRISTIAN JONATHAN OMAR RUBEN HUGO JULIO CESAR RODRIGO EMILIO GAEL IKER TADEO LUCIANO " +
		"ANDRES FELIPE GUSTAVO ERNESTO ABRAHAM ISRAEL JAIR JARED YAHIR ALDO BRUNO " +
		"MARIA GUADALUPE JUANA ANA SOFIA VALENTINA REGINA XIMENA CAMILA VALERIA FERNANDA RENATA ISABELLA " +
		"DANIELA NATALIA ANDREA PAULA MARIANA LUCIA ALEJANDRA GABRIELA DIANA KARLA CARLA LAURA ELENA " +
		"PATRICIA ROSA MARTHA MARTA VERONICA LETICIA CLAUDIA ADRIANA MONICA SANDRA ALMA ELIZABETH ESTRELLA " +
		"ITZEL ABRIL ARELY AMERICA MELANIE MELANY KIMBERLY JIMENA NAOMI ZOE EMILIA ANTONELLA ALEXA ALEXIA " +
		"DULCE ESMERALDA CITLALI YARETZI HANNA HANNAH AITANA ROMINA MIA LIA NAYELI JOCELYN BRENDA PAOLA " +
		"MARISOL SARAHI SARA SAMANTHA VANESSA JULIETA FRIDA MONSERRAT MONTSERRAT BRISA LUNA").split(" ");
	var ES_NOMBRE = {};
	NOMBRES_COMUNES.forEach(function (n) { ES_NOMBRE[n] = true; });

	var ORDINALES = { PRIMERO: 1, PRIMER: 1, PRIMERA: 1, SEGUNDO: 2, SEGUNDA: 2, TERCERO: 3, TERCER: 3, TERCERA: 3,
		CUARTO: 4, CUARTA: 4, QUINTO: 5, QUINTA: 5, SEXTO: 6, SEXTA: 6 };

	function sinAcentos(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
	function clave(t) {
		var N = nombres();
		return N ? N.clave(t) : sinAcentos(t).toLowerCase().replace(/\s+/g, " ").trim();
	}
	// MAYÚSCULAS con acentos y Ñ; sin números, emojis ni signos (como al teclear en el alta)
	function limpiarNombre(t) {
		var N = nombres();
		var s = N ? N.formatear(t, true) : String(t || "").toUpperCase();
		return s.replace(/-{2,}/g, "-").replace(/(^|\s)-+|-+(\s|$)/g, " ").replace(/\s+/g, " ").trim();
	}

	/*
		Grado escrito en un texto corto: "3", "3°", "3º", "3o", "3er", "3ro", "3er grado", "tercero",
		"TERCER GRADO", "3° A". → 1..6 o null. Un texto con más palabras no es un grado. Un número
		solo ("3") cuenta como grado únicamente si numeroSolo (una columna de grado de Excel): en un
		renglón suelto no se toma como encabezado.
	*/
	function gradoDeTexto(t, numeroSolo) {
		var s = sinAcentos(t).toUpperCase().replace(/[.,;:()\[\]]/g, " ").replace(/\s+/g, " ").trim();
		if (!s) return null;
		var m = /^([1-6])\s*(°|º|O|ER|RO|DO|TO|VO|ERO)?\s*(GRADO)?\s*([A-F])?$/.exec(s);
		if (m && (m[2] || m[3] || m[4] || (numeroSolo && /^[1-6]$/.test(s)))) return Number(m[1]);
		var m2 = /^(GRADO\s+)?([A-Z]+)(\s+GRADO)?(\s+[A-F])?$/.exec(s);
		if (m2 && ORDINALES[m2[2]]) return ORDINALES[m2[2]];
		return null;
	}

	// Lo que agrega WhatsApp al copiar mensajes: "[26/09/26, 10:15] Ana: " o "26/9/26 10:15 - Ana: "
	function quitarWhatsApp(linea) {
		return linea
			.replace(/^\s*\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?\s?m\.?)?\]\s*[^:]{1,60}:\s*/i, "")
			.replace(/^\s*\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*([ap]\.?\s?m\.?)?\s*-\s*[^:]{1,60}:\s*/i, "");
	}

	// Número de lista y viñetas al principio: "1.", "1)", "1.-", "01 ", "#3", "-", "•", "*"
	function quitarNumeracion(linea) {
		return linea
			.replace(/^\s*(#\s*)?\d{1,3}\s*(\.-|[.)\-:–—]|\s)\s*/, "")
			.replace(/^\s*[-•*·–—>]+\s*/, "");
	}

	// Separa en grupos: cada partícula se pega a la palabra que sigue ("DE LA CRUZ" es uno)
	function grupos(texto) {
		var palabras = String(texto || "").split(/\s+/).filter(Boolean);
		var salida = [], pendiente = [];
		palabras.forEach(function (p) {
			var base = sinAcentos(p).toUpperCase();
			pendiente.push(p);
			if (PARTICULAS.indexOf(base) !== -1) return;
			salida.push(pendiente.join(" "));
			pendiente = [];
		});
		if (pendiente.length) {
			if (salida.length) salida[salida.length - 1] += " " + pendiente.join(" ");
			else salida.push(pendiente.join(" "));
		}
		return salida;
	}

	function primeraPalabra(g) { return sinAcentos(String(g || "").split(" ")[0]).toUpperCase(); }

	/*
		Separar un nombre completo (una sola celda) en partes, según el orden de la lista:
		  "apellidos": APELLIDO PATERNO, MATERNO, NOMBRE(S) (como las listas de la escuela)
		  "nombre":    NOMBRE(S), APELLIDO PATERNO, MATERNO
		→ { apellido1, apellido2, nombres, dudoso }
	*/
	function separar(texto, orden) {
		var g = grupos(texto);
		var r = { apellido1: "", apellido2: "", nombres: "", dudoso: false };
		if (!g.length) return r;
		if (g.length === 1) { r.nombres = g[0]; r.dudoso = true; return r; }
		if (orden === "nombre") {
			if (g.length === 2) { r.nombres = g[0]; r.apellido1 = g[1]; }
			else { r.apellido2 = g[g.length - 1]; r.apellido1 = g[g.length - 2]; r.nombres = g.slice(0, -2).join(" "); }
		} else {
			r.apellido1 = g[0];
			if (g.length === 2) r.nombres = g[1];
			else { r.apellido2 = g[1]; r.nombres = g.slice(2).join(" "); }
		}
		// Muy largo (¿un apellido compuesto sin partícula?): que el docente lo revise
		if (g.length >= 5) r.dudoso = true;
		return r;
	}

	// ¿La lista empieza por el nombre? Cuenta renglones con un nombre común al principio o al final
	function adivinarOrden(textos) {
		var alPrincipio = 0, alFinal = 0;
		textos.forEach(function (t) {
			var g = grupos(t);
			if (g.length < 2) return;
			var p = ES_NOMBRE[primeraPalabra(g[0])], u = ES_NOMBRE[primeraPalabra(g[g.length - 1])];
			if (p && !u) alPrincipio++;
			if (u && !p) alFinal++;
		});
		return alPrincipio > alFinal ? "nombre" : "apellidos";
	}

	function esEncabezado(texto) {
		var palabras = sinAcentos(texto).toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
		if (!palabras.length) return false;
		var HEAD = ["NO", "NUM", "NUMERO", "N", "NOMBRE", "NOMBRES", "ALUMNO", "ALUMNA", "ALUMNOS", "ALUMNAS", "APELLIDO",
			"APELLIDOS", "PATERNO", "MATERNO", "GRADO", "GRUPO", "LISTA", "DE", "DEL", "Y", "COMPLETO", "ESTUDIANTE", "ESTUDIANTES", "S", "O", "A"];
		return palabras.every(function (p) { return HEAD.indexOf(p) !== -1; }) &&
			palabras.some(function (p) { return ["NOMBRE", "NOMBRES", "ALUMNO", "ALUMNOS", "APELLIDO", "APELLIDOS", "LISTA", "ESTUDIANTE", "ESTUDIANTES"].indexOf(p) !== -1; });
	}

	function armarNombre(r) {
		return [r.apellido1, r.apellido2, r.nombres].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
	}

	/*
		parsearLista(texto, opciones) →
		  { filas: [{ linea, apellido1, apellido2, nombres, nombreCompleto, grado, dudoso, duplicado, error }],
		    orden: "apellidos"|"nombre", ignorados: n }
		opciones = { orden: "auto"|"apellidos"|"nombre", grados: [1..6] (los del grupo),
		             existentes: ["NOMBRE COMPLETO", ...] (para marcar duplicados) }
		Un renglón que solo dice un grado ("3° GRADO", "TERCERO") pone ese grado a los que siguen.
		Excel/Word con columnas (tabulador): una columna de número de lista se ignora, una de grado
		se toma; tres columnas de texto son paterno, materno y nombre(s) (o nombre(s), paterno y
		materno si la lista empieza por el nombre); dos, apellidos y nombre(s). "PÉREZ LÓPEZ, JUAN"
		(con coma): apellidos, nombre(s).
	*/
	function parsearLista(texto, opciones) {
		opciones = opciones || {};
		var gradosGrupo = (opciones.grados || []).map(Number);
		var renglones = String(texto || "").replace(/\r\n?/g, "\n").split("\n");
		var crudos = [];
		var gradoActual = null, ignorados = 0;
		renglones.forEach(function (lineaOriginal, i) {
			var linea = quitarWhatsApp(lineaOriginal);
			if (!linea.trim()) return;
			var celdas = linea.indexOf("\t") !== -1
				? linea.split("\t").map(function (c) { return c.trim(); }).filter(Boolean)
				: [linea.trim()];
			var gradoFila = null, textos = [];
			celdas.forEach(function (c, j) {
				if (celdas.length > 1) {
					// Columnas: la primera con solo un número es el número de lista; otra con un grado
					// ("3", "3°", "tercero") es el grado
					if (j === 0 && /^#?\s*\d{1,3}\s*[.)\-]?$/.test(c)) return;
					var g = gradoDeTexto(c, true);
					if (g) { gradoFila = g; return; }
					if (/^[#\d\s.)\-]+$/.test(c)) return; // otro número suelto
				}
				textos.push(c);
			});
			if (celdas.length === 1) {
				var solo = quitarNumeracion(textos[0] || "");
				// Renglón que solo dice un grado: encabezado de sección
				var gSeccion = gradoDeTexto(solo);
				if (gSeccion) { gradoActual = gSeccion; return; }
				// Grado al final: "JUAN PÉREZ 3°", "JUAN PÉREZ (3ro)", "JUAN PÉREZ - 3"
				var mFin = /[\s,(\-–]+([1-6])\s*(°|º|o|er|ro|do|to|vo)?\s*\)?\s*$/i.exec(solo);
				if (mFin) { gradoFila = Number(mFin[1]); solo = solo.slice(0, mFin.index); }
				textos = [solo];
			}
			textos = textos.map(function (t) { return t.trim(); }).filter(Boolean);
			// Sin letras (un número suelto, signos, un emoji): no es un alumno
			if (!textos.length || !limpiarNombre(textos.join(" ")).replace(/[\s-]/g, "")) { ignorados++; return; }
			if (esEncabezado(textos.join(" "))) { ignorados++; return; }
			crudos.push({ linea: i + 1, original: lineaOriginal.trim(), textos: textos, grado: gradoFila || gradoActual });
		});

		var orden = opciones.orden === "nombre" || opciones.orden === "apellidos" ? opciones.orden
			: adivinarOrden(crudos.filter(function (c) { return c.textos.length === 1 && c.textos[0].indexOf(",") === -1; })
				.map(function (c) { return limpiarNombre(c.textos[0]); }));

		var vistos = {};
		(opciones.existentes || []).forEach(function (n) { vistos[clave(n)] = "existente"; });
		var filas = crudos.map(function (c) {
			var r;
			var t = c.textos.map(limpiarNombre).filter(Boolean);
			if (c.textos.length === 1 && c.textos[0].indexOf(",") !== -1) {
				// "PÉREZ LÓPEZ, JUAN CARLOS": apellidos, nombre(s)
				var partes = c.textos[0].split(",");
				var ap = grupos(limpiarNombre(partes[0]));
				r = { apellido1: ap[0] || "", apellido2: ap.slice(1).join(" "), nombres: limpiarNombre(partes.slice(1).join(" ")), dudoso: ap.length > 2 };
			} else if (t.length >= 3) {
				r = orden === "nombre"
					? { nombres: t[0], apellido1: t[1], apellido2: t.slice(2).join(" "), dudoso: false }
					: { apellido1: t[0], apellido2: t[1], nombres: t.slice(2).join(" "), dudoso: false };
			} else if (t.length === 2) {
				var a2 = orden === "nombre" ? t[1] : t[0];
				var n2 = orden === "nombre" ? t[0] : t[1];
				var ga = grupos(a2);
				r = { apellido1: ga[0] || "", apellido2: ga.slice(1).join(" "), nombres: n2, dudoso: ga.length > 2 };
			} else {
				r = separar(t[0] || "", orden);
			}
			var fila = {
				linea: c.linea, original: c.original,
				apellido1: r.apellido1, apellido2: r.apellido2, nombres: r.nombres,
				grado: c.grado && (!gradosGrupo.length || gradosGrupo.indexOf(c.grado) !== -1) ? c.grado : null,
				gradoLeido: c.grado || null,
				dudoso: !!r.dudoso, duplicado: false, error: null,
			};
			if (gradosGrupo.length === 1) fila.grado = gradosGrupo[0];
			fila.nombreCompleto = armarNombre(fila);
			return fila;
		});
		filas.forEach(function (f) { revisarFila(f, vistos); });
		return { filas: filas, orden: orden, ignorados: ignorados };
	}

	/*
		Revisa una fila (también después de corregirla a mano): nombre completo, que tenga apellido
		paterno y nombre(s), letras válidas y que no esté repetida. vistos: {clave: true|"existente"}.
	*/
	function revisarFila(f, vistos) {
		var N = nombres();
		["apellido1", "apellido2", "nombres"].forEach(function (k) { f[k] = limpiarNombre(f[k]); });
		f.nombreCompleto = armarNombre(f);
		f.error = null;
		f.duplicado = false;
		if (!f.apellido1 || !f.nombres) f.error = "Falta el apellido paterno o el nombre";
		else if (N && !N.valido(f.nombreCompleto)) f.error = "Solo letras, espacios y guiones";
		if (!f.error && vistos) {
			var k = clave(f.nombreCompleto);
			if (vistos[k]) { f.duplicado = true; f.error = vistos[k] === "existente" ? "Ya está en el grupo" : "Está repetido en la lista"; }
			else vistos[k] = true;
		}
		return f;
	}

	/*
		¿Se puede guardar la lista? Todas las filas sin error y, en multigrado, con grado del grupo.
		→ { ok, faltanGrado: n, conError: n }
	*/
	function listaLista(filas, gradosGrupo) {
		var gs = (gradosGrupo || []).map(Number);
		var faltanGrado = 0, conError = 0;
		(filas || []).forEach(function (f) {
			if (f.error) conError++;
			if (gs.length > 1 && gs.indexOf(Number(f.grado)) === -1) faltanGrado++;
		});
		return { ok: (filas || []).length > 0 && !faltanGrado && !conError, faltanGrado: faltanGrado, conError: conError };
	}

	// ══════════════════════════════════════════════════════════════════════════
	// 2. Periodo vigente y días de clase
	// ══════════════════════════════════════════════════════════════════════════

	/*
		periodoVigente(hoy, filasPeriodos) → { ciclo, trimestre, periodo, inicio, fuente }
		filasPeriodos: filas de mi_salon_periodos ({ ciclo, periodo, orden, venta_desde }) o null si
		la tabla aún no existe. Con filas: el periodo cuya venta_desde es la más reciente que ya llegó
		(orden = trimestre). Sin filas: el trimestre del calendario SEP (js/calendario-escolar.js).
		El inicio es el primer día de clases de ese trimestre (ProductosHoy.rangoTrimestre).
	*/
	function periodoVigente(hoy, filasPeriodos) {
		var h = String(hoy || "").slice(0, 10);
		var trimestre = null, ciclo = null, fuente = "calendario", periodo = null;
		var filas = (filasPeriodos || []).filter(function (f) { return f && f.venta_desde && String(f.venta_desde).slice(0, 10) <= h; })
			.sort(function (a, b) { return String(b.venta_desde).localeCompare(String(a.venta_desde)); });
		if (filas.length) {
			trimestre = Number(filas[0].orden) || Number(String(filas[0].periodo || "").replace(/\D/g, "")) || null;
			ciclo = filas[0].ciclo || null;
			periodo = filas[0].periodo || null;
			fuente = "periodos";
		}
		var CE = calendarioEscolar();
		if (!trimestre) {
			var s = CE ? CE.trimestreSugerido(h) : null;
			trimestre = s ? s.trimestre : 1;
			ciclo = s ? s.ciclo : null;
		}
		var rango = rangoDelTrimestre(trimestre, h);
		return { ciclo: ciclo, trimestre: trimestre, periodo: periodo || ("T" + trimestre), inicio: rango.desde, fin: rango.hasta || null, fuente: fuente };
	}

	// Días del trimestre (del primer día de clases a su fin) del calendario SEP: ProductosHoy.rangoTrimestre
	function rangoDelTrimestre(trimestre, hoy) {
		var h = String(hoy || "").slice(0, 10);
		var CE = calendarioEscolar(), CS = calendario(), PH = productosHoy();
		return PH ? PH.rangoTrimestre(trimestre, h, {
			calendarios: CE ? CE.CALENDARIOS : [], ciclo: CS ? CS.cicloDe(h) : null,
		}) : { desde: h, hasta: h };
	}
	// Primer día de clases del trimestre del grupo (grupos.trimestre_actual)
	function inicioDelTrimestre(trimestre, hoy) { return rangoDelTrimestre(trimestre, hoy).desde; }

	/*
		mi_salon_periodos (la tabla de periodos del constructor de accesos): sus filas o null si la
		tabla todavía no existe (entonces manda el calendario SEP). Cualquier otro error se lanza.
	*/
	function faltaTabla(error) {
		return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || ""));
	}
	async function leerPeriodos(sb) {
		var res = await sb.from("mi_salon_periodos").select("ciclo, periodo, orden, venta_desde").order("venta_desde");
		if (res.error) {
			if (faltaTabla(res.error)) return null; // respaldo: calendario SEP
			throw res.error;
		}
		return res.data || [];
	}

	// ¿Se ofrece "Ponte al día"? Hoy ya pasó el inicio del periodo vigente (hay días atrasados)
	function ofrecerPonteAlDia(hoy, periodo) {
		return !!(periodo && periodo.inicio && String(hoy || "").slice(0, 10) > periodo.inicio);
	}

	function ayer(hoy) {
		var CS = calendario();
		if (CS) return CS.sumarDias(hoy, -1);
		var d = new Date(String(hoy).slice(0, 10) + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() - 1);
		return d.toISOString().slice(0, 10);
	}

	// Días de clase del inicio del periodo a AYER (calendario SEP y ajustes del grupo), en orden
	function diasHistoricos(inicio, hoy, ajustes) {
		var CS = calendario();
		if (!CS || !inicio || !hoy) return [];
		var fin = ayer(hoy);
		if (fin < inicio) return [];
		return CS.diasDeClase(inicio, fin, ajustes || []);
	}

	// Semana (lunes) de una fecha
	function lunesDe(iso) {
		var d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
		var dia = d.getUTCDay(); // 0 domingo
		d.setUTCDate(d.getUTCDate() - (dia === 0 ? 6 : dia - 1));
		return d.toISOString().slice(0, 10);
	}
	// [{ lunes, dias: [...] }] en orden
	function semanas(dias) {
		var salida = [], porLunes = {};
		(dias || []).forEach(function (d) {
			var l = lunesDe(d);
			if (!porLunes[l]) { porLunes[l] = { lunes: l, dias: [] }; salida.push(porLunes[l]); }
			porLunes[l].dias.push(d);
		});
		return salida;
	}

	// ══════════════════════════════════════════════════════════════════════════
	// 3. Asistencia pasada
	// ══════════════════════════════════════════════════════════════════════════

	/*
		Por omisión todos asistieron (sin marca = presente). Un toque en la celda: Falta; otro,
		Justificada; otro, vuelve a Presente.
	*/
	var CICLO_ASISTENCIA = ["presente", "ausente", "justificada"];
	function siguienteAsistencia(estado) {
		var i = CICLO_ASISTENCIA.indexOf(estado || "presente");
		return CICLO_ASISTENCIA[(i + 1) % CICLO_ASISTENCIA.length];
	}

	/*
		filasAsistencia(e) → { filas: [...upsert en asistencias], cuenta: {presente, ausente, justificada} }
		e = { alumnos: [{id, alta}], dias: [...], marcas: {"alumnoId|fecha": estado},
		      enBase: {"alumnoId|fecha": estado}, sinClase: {fecha: true}, maestroId, grupoId, capturadoEn }
		Mismo modelo que la pantalla Asistencia (presente / ausente / justificada; una fila por
		alumno y día; llave grupo_id, alumno_id, fecha). Lo que ya está en la base y no cambió no se
		vuelve a escribir. Un día marcado "No hubo clase" no escribe nada. A un alumno dado de alta
		tarde no se le llenan los días anteriores a su alta.
	*/
	function filasAsistencia(e) {
		var filas = [], cuenta = { presente: 0, ausente: 0, justificada: 0 };
		var A = alcance();
		(e.dias || []).forEach(function (d) {
			if (e.sinClase && e.sinClase[d]) return;
			(e.alumnos || []).forEach(function (a) {
				if (a.alta && A && !A.cuentaDesdeAlta(a.alta, d, null)) return;
				var k = a.id + "|" + d;
				var base = (e.enBase || {})[k] || null;
				var estado = (e.marcas || {})[k] || base || "presente";
				cuenta[estado] = (cuenta[estado] || 0) + 1;
				if (base === estado) return;
				filas.push({ maestro_id: e.maestroId, grupo_id: e.grupoId, alumno_id: a.id, fecha: d,
					asistencia_estado: estado, capturado_en: e.capturadoEn || null });
			});
		});
		return { filas: filas, cuenta: cuenta };
	}

	// ══════════════════════════════════════════════════════════════════════════
	// 4. Trabajos y exámenes pasados (captura en bloque)
	// ══════════════════════════════════════════════════════════════════════════

	var CAMPOS = ["LEN", "SAB", "ETI", "DHL"];
	var NOMBRE_MAX = 120;

	/*
		validarActividad(a, ctx) → { ok, error, foco }
		a = { nombre, tipo: "trabajo"|"tarea", fecha, campo, grados: [..] }
		ctx = { desde (inicio del periodo), hoy, gradosGrupo }
		Día de un día que ya pasó dentro del trimestre (desde el inicio hasta ayer).
	*/
	function validarActividad(a, ctx) {
		a = a || {};
		ctx = ctx || {};
		var nombre = String(a.nombre || "").replace(/\s+/g, " ").trim();
		if (!nombre) return { ok: false, foco: "nombre", error: "Escribe el nombre de la actividad." };
		if (nombre.length > NOMBRE_MAX) return { ok: false, foco: "nombre", error: "El nombre es muy largo (" + NOMBRE_MAX + " letras como máximo)." };
		if (a.tipo !== "trabajo" && a.tipo !== "tarea") return { ok: false, foco: "tipo", error: "Elige si es trabajo en clase o tarea." };
		var f = String(a.fecha || "");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return { ok: false, foco: "fecha", error: "Elige el día de la actividad." };
		if (ctx.hoy && f >= ctx.hoy) return { ok: false, foco: "fecha", error: "El registro histórico es de días que ya pasaron: elige un día anterior a hoy." };
		if (ctx.desde && f < ctx.desde) return { ok: false, foco: "fecha", error: "El día debe ser del trimestre en curso (desde el inicio del periodo)." };
		if (CAMPOS.indexOf(a.campo) === -1) return { ok: false, foco: "campo", error: "Elige el campo formativo." };
		var gs = (a.grados || []).map(Number).filter(function (g) { return (ctx.gradosGrupo || [1, 2, 3, 4, 5, 6]).map(Number).indexOf(g) !== -1; });
		if (!gs.length) return { ok: false, foco: "grados", error: "Elige para qué grados es." };
		return { ok: true, nombre: nombre, grados: gs.sort(function (x, y) { return x - y; }) };
	}

	/*
		itemsParaGuardar(actividades, ctx) → p_items de agregar_actividades_historicas:
		[{ fecha, producto: {tipo, nombre, grados (texto, en orden), modalidad, campo}, asignacion: [], crear: [{pda_id, grado}] }]
	*/
	function itemsParaGuardar(actividades) {
		return (actividades || []).map(function (a) {
			var gs = (a.grados || []).map(Number).sort(function (x, y) { return x - y; });
			return {
				fecha: a.fecha,
				producto: { tipo: a.tipo, nombre: String(a.nombre || "").replace(/\s+/g, " ").trim(), grados: gs.map(String),
					modalidad: gs.length > 1 ? "compartida" : "compartida", campo: a.campo },
				asignacion: [],
				crear: (a.pda || []).filter(function (p) { return p && p.pda_id && p.grado; })
					.map(function (p) { return { pda_id: p.pda_id, grado: Number(p.grado) }; }),
			};
		});
	}

	/*
		Semáforo de la cuadrícula: vacío → Logrado → En proceso → Requiere apoyo → No entregó → vacío.
		"Todos Logrado" llena la columna y el docente solo toca las excepciones.
	*/
	var CICLO_SEMAFORO = [null, "logrado", "en_proceso", "requiere_apoyo", "no_entregado"];
	function siguienteSemaforo(v) {
		var i = CICLO_SEMAFORO.indexOf(v || null);
		return CICLO_SEMAFORO[(i + 1) % CICLO_SEMAFORO.length];
	}
	// Valor de la celda → columnas de la calificación (las mismas que escribe Hoy)
	function cambiosDeSemaforo(v) {
		if (v === "no_entregado") return { estado_entrega: "no_entregado", nivel: null, entrego: false };
		if (v === "logrado" || v === "en_proceso" || v === "requiere_apoyo") return { estado_entrega: "entregado", nivel: v, entrego: true };
		return null;
	}
	// Fila de la base → valor de la celda
	function semaforoDeFila(c) {
		if (!c) return null;
		if (c.estado_entrega === "no_entregado") return "no_entregado";
		if (c.nivel) return c.nivel;
		return c.estado_entrega ? "otro" : null;
	}

	/*
		filasCalificaciones(e) → { insertar: [filas], actualizar: [{id, cambios}], borrar: [ids] }
		e = { productos: [{id, sesion_id, proyecto_id, tipo, nombre, campo, fecha}], alumnos: [{id, grado}],
		      celdas: {"alumnoId|productoId": valor}, enBase: {"alumnoId|productoId": fila},
		      maestroId, grupoId, capturadoEn, campoLargo: fn }
		La calificación histórica lleva la FECHA DE SU ACTIVIDAD (la de la sesión) y capturado_en el
		momento de la captura: así la base la marca es_historico. Una celda vacía que en la base
		tenía algo se borra; una igual, no se toca.
	*/
	function filasCalificaciones(e) {
		var insertar = [], actualizar = [], borrar = [];
		(e.productos || []).forEach(function (p) {
			(e.alumnos || []).forEach(function (a) {
				var k = a.id + "|" + p.id;
				if (!Object.prototype.hasOwnProperty.call(e.celdas || {}, k)) return; // no se tocó
				var v = e.celdas[k];
				var base = (e.enBase || {})[k] || null;
				var antes = semaforoDeFila(base);
				if (antes === (v || null)) return;
				var c = cambiosDeSemaforo(v);
				if (!c) { if (base && base.id) borrar.push(base.id); return; }
				if (base && base.id) {
					actualizar.push({ id: base.id, cambios: Object.assign({}, c, { puntaje: null, evaluado_en: e.capturadoEn || null }) });
					return;
				}
				insertar.push(Object.assign({
					maestro_id: e.maestroId, alumno_id: a.id, grupo_id: e.grupoId,
					producto_sesion_id: p.id, sesion_id: p.sesion_id, proyecto_id: p.proyecto_id || null,
					tipo: p.tipo, descripcion: p.nombre, grado: Number(a.grado) || null,
					campo_formativo: e.campoLargo ? e.campoLargo(p.campo) : null,
					puntaje: null, fecha: p.fecha, capturado_en: e.capturadoEn || null, evaluado_en: e.capturadoEn || null,
				}, c));
			});
		});
		return { insertar: insertar, actualizar: actualizar, borrar: borrar };
	}

	// ══════════════════════════════════════════════════════════════════════════
	// 5. Calificación directa del trimestre
	// ══════════════════════════════════════════════════════════════════════════

	// Mínimo de la escala del grado (1° 6; 2° a 6° 5): la regla de la boleta (js/reglas-entidad.js)
	function pisoDe(grado) {
		var R = reglasEntidad();
		var piso = R ? R.regla().pisoDeGrado(grado) : (Number(grado) === 1 ? 6 : (Number(grado) >= 2 && Number(grado) <= 6 ? 5 : null));
		return piso || null;
	}
	// [piso..10] de su grado
	function escalaDirecta(grado) {
		var piso = pisoDe(grado);
		if (!piso) return [];
		var s = [];
		for (var n = piso; n <= 10; n++) s.push(n);
		return s;
	}
	function validarDirecta(valor, grado) {
		var piso = pisoDe(grado);
		if (!piso) return { ok: false, error: "El alumno no tiene un grado válido." };
		var v = Number(valor);
		if (valor === null || valor === undefined || valor === "" || !Number.isInteger(v)) return { ok: false, error: "Elige una calificación entera." };
		if (v < piso || v > 10) return { ok: false, error: "En " + Number(grado) + "° la calificación va de " + piso + " a 10." };
		return { ok: true, valor: v };
	}

	var api = {
		PARTICULAS: PARTICULAS, CICLO_ASISTENCIA: CICLO_ASISTENCIA, CICLO_SEMAFORO: CICLO_SEMAFORO, CAMPOS: CAMPOS,
		parsearLista: parsearLista, revisarFila: revisarFila, listaLista: listaLista, gradoDeTexto: gradoDeTexto,
		separar: separar, grupos: grupos, adivinarOrden: adivinarOrden, armarNombre: armarNombre,
		periodoVigente: periodoVigente, ofrecerPonteAlDia: ofrecerPonteAlDia, ayer: ayer,
		rangoDelTrimestre: rangoDelTrimestre, inicioDelTrimestre: inicioDelTrimestre, leerPeriodos: leerPeriodos,
		diasHistoricos: diasHistoricos, semanas: semanas, lunesDe: lunesDe,
		siguienteAsistencia: siguienteAsistencia, filasAsistencia: filasAsistencia,
		validarActividad: validarActividad, itemsParaGuardar: itemsParaGuardar,
		siguienteSemaforo: siguienteSemaforo, cambiosDeSemaforo: cambiosDeSemaforo, semaforoDeFila: semaforoDeFila,
		filasCalificaciones: filasCalificaciones,
		escalaDirecta: escalaDirecta, validarDirecta: validarDirecta, pisoDe: pisoDe,
	};
	if (typeof window !== "undefined") window.Historico = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
