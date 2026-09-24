/*
	catalogo-habilidades.js — Único lugar donde viven las claves estables de la
	revisión de cuaderno y de las habilidades básicas de matemáticas, con sus
	etiquetas para la UI. Mismo patrón que campos-formativos.js.

	Se guardan en evaluacion_diagnostica (jsonb cuaderno / matematicas) como
	[{clave: "cuaderno.orden_limpieza", nivel: "logrado"}, ...]. La BD valida el
	prefijo de la clave y el nivel (constraint *_items); la lista de claves válidas
	vive solo aquí. Una clave nunca se renombra: si cambia la redacción, cambia
	la etiqueta. Un criterio nuevo se agrega al final de su lista.

	Niveles: logrado / en_proceso / requiere_apoyo (vocabulario único del sistema).

	Fluidez lectora: los umbrales viven en la tabla bandas_ppm (catálogo editable,
	no en código); aquí solo está la regla que clasifica un PPM contra su banda.
*/

(function () {
	"use strict";

	var CUADERNO = [
		{ clave: "cuaderno.orden_limpieza",        etiqueta: "Orden y limpieza" },
		{ clave: "cuaderno.fecha_completa",        etiqueta: "Escribe fecha completa" },
		{ clave: "cuaderno.titulo_actividad",      etiqueta: "Escribe título de actividad" },
		{ clave: "cuaderno.letra_legible",         etiqueta: "Letra legible" },
		{ clave: "cuaderno.mayusculas_minusculas", etiqueta: "Uso correcto de mayúsculas/minúsculas" },
		{ clave: "cuaderno.signos_puntuacion",     etiqueta: "Signos de puntuación" },
		{ clave: "cuaderno.acentuacion",           etiqueta: "Acentuación" },
		{ clave: "cuaderno.buen_estado",           etiqueta: "Buen estado de la libreta" },
		{ clave: "cuaderno.orden_proyecto",        etiqueta: "Orden por proyecto" },
		{ clave: "cuaderno.respeta_margen",        etiqueta: "Respeta margen" },
	];

	/*
		Matemáticas por grado (decisión 13 de Jorge; investigación en
		docs/referencia/matematicas-por-grado-nem.md, Programas Sintéticos de las Fases 3, 4 y 5):
		  grados:  en qué grados se muestra y se evalúa. 1° no tiene PDA de multiplicación,
		           división, fracciones ni tablas; 2° sí tiene multiplicación, división y
		           tablas (cálculo mental con números menores que 10), pero no fracciones,
		           que empiezan en 3°. De 3° a 6°, las 8.
		  alcance: una línea por grado que resume los PDA (guía para la maestra y detalle
		           en boleta y reporte, como el estándar de PPM).
		Una habilidad que no aplica al grado no se muestra en ninguna pantalla; lo que ya
		se hubiera capturado en ella se conserva en la base (Diagnóstico no lo borra al
		guardar) y en la exportación su celda dice "No aplica".
		La lista de cada alumno sale de SU grado (en multigrado cada niño ve la suya); con la
		boleta cerrada, del grado de la foto del cierre. Ver matematicasDeGrado.
	*/
	var TODOS_LOS_GRADOS = [1, 2, 3, 4, 5, 6];
	var MATEMATICAS = [
		{ clave: "mates.suma", etiqueta: "Suma", grados: TODOS_LOS_GRADOS, alcance: {
			1: "Juntar y agregar hasta dos cifras, sin algoritmo",
			2: "Con agrupamientos y algoritmo, hasta dos cifras",
			3: "Con algoritmo, hasta tres cifras",
			4: "Hasta cuatro cifras y con decimales",
			5: "Con decimales y fracciones",
			6: "Con decimales y fracciones" } },
		{ clave: "mates.resta", etiqueta: "Resta", grados: TODOS_LOS_GRADOS, alcance: {
			1: "Quitar y comparar hasta dos cifras, sin algoritmo",
			2: "Hasta dos cifras, en la recta y mentalmente",
			3: "Con agrupamientos y algoritmo, hasta tres cifras",
			4: "Hasta cuatro cifras y con decimales",
			5: "Con decimales y fracciones",
			6: "Con decimales y fracciones" } },
		{ clave: "mates.multiplicacion", etiqueta: "Multiplicación", grados: [2, 3, 4, 5, 6], alcance: {
			2: "Sumas de sumandos iguales y arreglos, hasta 10",
			3: "Productos de hasta tres cifras",
			4: "Algoritmo de hasta tres por dos cifras",
			5: "Fracciones y decimales por un natural",
			6: "Con naturales, decimales y fracciones" } },
		{ clave: "mates.division", etiqueta: "División", grados: [2, 3, 4, 5, 6], alcance: {
			2: "Repartos con divisor menor que 10",
			3: "Reparto y agrupamiento (a ÷ b = c)",
			4: "Algoritmo: cociente y residuo",
			5: "Entre naturales con cociente decimal",
			6: "Decimales y fracciones entre un natural" } },
		{ clave: "mates.fracciones", etiqueta: "Fracciones", grados: [3, 4, 5, 6], alcance: {
			3: "Medios, cuartos y octavos; 1/10 y 1/100",
			4: "Tercios a décimos; suma y resta",
			5: "Equivalentes y en notación decimal",
			6: "Suma, resta y división entre un natural" } },
		{ clave: "mates.tablas", etiqueta: "Tablas de multiplicar", grados: [2, 3, 4, 5, 6], alcance: {
			2: "Multiplicaciones de números menores que 10",
			3: "Repertorio de factores de una cifra",
			4: "Uso en operaciones; doble, triple y mitad",
			5: "Uso en operaciones",
			6: "Uso en operaciones" } },
		{ clave: "mates.lectura_escritura_cantidades", etiqueta: "Lectura y escritura de cantidades", grados: TODOS_LOS_GRADOS, alcance: {
			1: "Números hasta 100",
			2: "Números menores que 1000; usa <, > e =",
			3: "Hasta cuatro cifras",
			4: "Hasta cinco cifras y decimales",
			5: "Hasta nueve cifras y decimales",
			6: "Más de nueve cifras" } },
		{ clave: "mates.problemas", etiqueta: "Problemas matemáticos", grados: TODOS_LOS_GRADOS, alcance: {
			1: "De su contexto: agregar, quitar, juntar, comparar",
			2: "Con suma, resta, multiplicación y reparto",
			3: "Con las cuatro operaciones y fracciones",
			4: "Con las cuatro operaciones, decimales y fracciones",
			5: "Con decimales, fracciones y proporcionalidad",
			6: "Con decimales, fracciones y porcentajes" } },
	];

	// Grado de 1 a 6, o null si no es un grado válido
	function gradoValido(grado) {
		if (grado === null || grado === undefined || grado === "") return null;
		var g = Number(grado);
		return g >= 1 && g <= 6 && Math.floor(g) === g ? g : null;
	}

	function habilidadMates(claveOHabilidad) {
		var clave = claveOHabilidad && typeof claveOHabilidad === "object" ? claveOHabilidad.clave : claveOHabilidad;
		for (var i = 0; i < MATEMATICAS.length; i++) if (MATEMATICAS[i].clave === clave) return MATEMATICAS[i];
		return null;
	}

	/*
		¿La habilidad (clave u objeto del catálogo) se muestra y evalúa en ese grado?
		Sin grado válido: sí (lo de antes, las 8). Una clave que no está en el catálogo: no.
	*/
	function aplicaMatematica(claveOHabilidad, grado) {
		var h = habilidadMates(claveOHabilidad);
		if (!h) return false;
		var g = gradoValido(grado);
		return g === null || h.grados.indexOf(g) !== -1;
	}

	// Las habilidades de matemáticas del grado, en el orden del catálogo (sin grado válido, las 8)
	function matematicasDeGrado(grado) {
		return MATEMATICAS.filter(function (h) { return aplicaMatematica(h, grado); });
	}

	// "Repartos con divisor menor que 10" (vacío si no aplica o no hay grado)
	function alcanceMatematica(claveOHabilidad, grado) {
		var h = habilidadMates(claveOHabilidad);
		var g = gradoValido(grado);
		if (!h || g === null || !h.alcance) return "";
		return h.alcance[g] || "";
	}

	var NIVELES = ["logrado", "en_proceso", "requiere_apoyo"];
	var ETIQUETA_NIVEL = { logrado: "Logrado", en_proceso: "En proceso", requiere_apoyo: "Requiere apoyo" };

	var ETIQUETA_FLUIDEZ = {
		requiere_apoyo: "Requiere apoyo",
		cercano: "Cercano al estándar",
		estandar: "Estándar",
		avanzado: "Avanzado",
	};

	// Arreglo jsonb -> { clave: nivel } (ignora claves que ya no existan en el catálogo)
	function aMapa(items) {
		var mapa = {};
		(Array.isArray(items) ? items : []).forEach(function (it) {
			if (it && it.clave) mapa[it.clave] = it.nivel || null;
		});
		return mapa;
	}

	/*
		clasificarPPM(ppm, banda) -> "requiere_apoyo" | "cercano" | "estandar" | "avanzado" | null
		banda = fila de bandas_ppm del grado del alumno.
	*/
	function clasificarPPM(ppm, banda) {
		if (ppm === null || ppm === undefined || ppm === "" || isNaN(Number(ppm)) || !banda) return null;
		var v = Number(ppm);
		if (v <= banda.requiere_apoyo_max) return "requiere_apoyo";
		if (v <= banda.cercano_max) return "cercano";
		if (v <= banda.estandar_max) return "estandar";
		return "avanzado";
	}

	window.CatalogoHabilidades = {
		CUADERNO: CUADERNO,
		MATEMATICAS: MATEMATICAS,
		matematicasDeGrado: matematicasDeGrado,
		aplicaMatematica: aplicaMatematica,
		alcanceMatematica: alcanceMatematica,
		gradoValido: gradoValido,
		NIVELES: NIVELES,
		ETIQUETA_NIVEL: ETIQUETA_NIVEL,
		ETIQUETA_FLUIDEZ: ETIQUETA_FLUIDEZ,
		aMapa: aMapa,
		clasificarPPM: clasificarPPM,
	};
})();
