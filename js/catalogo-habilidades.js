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

	var MATEMATICAS = [
		{ clave: "mates.suma",                        etiqueta: "Suma" },
		{ clave: "mates.resta",                       etiqueta: "Resta" },
		{ clave: "mates.multiplicacion",              etiqueta: "Multiplicación" },
		{ clave: "mates.division",                    etiqueta: "División" },
		{ clave: "mates.fracciones",                  etiqueta: "Fracciones" },
		{ clave: "mates.tablas",                      etiqueta: "Tablas de multiplicar" },
		{ clave: "mates.lectura_escritura_cantidades", etiqueta: "Lectura y escritura de cantidades" },
		{ clave: "mates.problemas",                   etiqueta: "Problemas matemáticos" },
	];

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
		NIVELES: NIVELES,
		ETIQUETA_NIVEL: ETIQUETA_NIVEL,
		ETIQUETA_FLUIDEZ: ETIQUETA_FLUIDEZ,
		aMapa: aMapa,
		clasificarPPM: clasificarPPM,
	};
})();
