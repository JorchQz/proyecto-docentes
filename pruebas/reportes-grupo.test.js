/*
	Pruebas de Vista Recrea y Concentrado Director (js/reportes-grupo.js, bloque 3.7).

	Regla central: la calificación que se muestra es la CONFIRMADA por el maestro en
	boleta_trimestral; lo no confirmado dice "pendiente" (la propuesta del motor solo
	aparece rotulada como propuesta) y el promedio sale solo con los 4 campos confirmados.

	node pruebas/reportes-grupo.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = real === esperado;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

global.window = {};
require("../js/reportes-grupo.js");
const R = window.ReportesGrupo;

const alumnos = [
	{ id: "b", nombre_completo: "BETO, \"el de 4°\"", num_lista: 1, grado: 4 },
	{ id: "a", nombre_completo: "ANA PÉREZ", num_lista: 1, grado: 2 },
	{ id: "c", nombre_completo: "CARLA RUIZ", num_lista: 2, grado: 2 },
];
function bol(cal, confirmada) { return { calificacion: cal, calificacion_confirmada: confirmada }; }
const datos = {
	motor: {
		porAlumno: {
			a: { porCampo: { LEN: { calificacionPropuesta: 9 }, SAB: { calificacionPropuesta: 8 }, ETI: { calificacionPropuesta: 10 }, DHL: { calificacionPropuesta: 9 } } },
			b: { porCampo: { LEN: { calificacionPropuesta: 5 }, SAB: { calificacionPropuesta: 6 }, ETI: { calificacionPropuesta: 7 }, DHL: { calificacionPropuesta: 6 } } },
			c: { porCampo: { LEN: { calificacionPropuesta: 7 }, SAB: { calificacionPropuesta: null }, ETI: { calificacionPropuesta: 6 }, DHL: { calificacionPropuesta: 6 } } },
		},
	},
	boletas: {
		// Ana: los 4 confirmados → promedio 9.0 (alto)
		a: { 1: { LEN: bol(9, true), SAB: bol(8, true), ETI: bol(10, true), DHL: bol(9, true) }, 2: {}, 3: {} },
		// Beto (4°): los 4 confirmados con un 5 → promedio 6.0 (bajo, campo no acreditado)
		b: { 1: { LEN: bol(5, true), SAB: bol(6, true), ETI: bol(7, true), DHL: bol(6, true) }, 2: {}, 3: {} },
		// Carla: LEN confirmado; SAB guardado SIN confirmar (no debe verse como número)
		c: { 1: { LEN: bol(7, true), SAB: bol(8, false) }, 2: {}, 3: {} },
	},
};

const filas = R.filas(alumnos, datos, 1);
ok("orden por grado y número de lista", filas.map((f) => f.alumno.id).join(","), "a,c,b");
ok("Ana completa, promedio 9", filas[0].completa + " " + filas[0].promedio, "true 9");
ok("Carla: 1 de 4 confirmadas, sin promedio", filas[1].confirmadas + " " + filas[1].promedio, "1 null");
ok("Carla SAB guardado sin confirmar → oficial null", filas[1].campos.SAB.oficial, null);
ok("Carla SAB sin datos: tampoco hay propuesta", filas[1].campos.SAB.propuesta, null);
ok("Carla ETI propuesta 6", filas[1].campos.ETI.propuesta, 6);
ok("Beto promedio 6", filas[2].promedio, 6);

const trimestreVacio = R.filas(alumnos, datos, 2);
ok("trimestre sin confirmar: nadie completo", trimestreVacio.filter((f) => f.completa).length, 0);

const vista = R.htmlVistaRecrea(filas, 1);
ok("Vista Recrea: aviso 2 de 3", vista.includes("2 de 3 alumnos con sus 4 calificaciones confirmadas"), true);
ok("Vista Recrea: dice pendiente", vista.includes("pendiente"), true);
ok("Vista Recrea: propuesta rotulada", vista.includes("propuesta 6"), true);
ok("Vista Recrea: el 8 sin confirmar de Carla NO aparece como número", /CARLA RUIZ[\s\S]*?<\/tr>/.exec(vista)[0].includes(">8<"), false);
ok("Vista Recrea: promedio con un decimal", vista.includes(">9.0<"), true);
ok("Vista Recrea: nombre escapado", vista.includes("BETO, &quot;el de 4°&quot;"), true);
ok("Vista Recrea: sin columnas de participación/conducta sueltas", /Part\.|Cond\./.test(vista), false);

const csv = R.csvVistaRecrea(filas);
const lineas = csv.replace(/^﻿/, "").split("\r\n");
ok("CSV con BOM", csv.charCodeAt(0), 0xfeff);
ok("CSV cabecera", lineas[0], "No.,Alumno,Grado,Lenguajes,Saberes y Pensamiento Científico,\"Ética, Naturaleza y Sociedades\",De lo Humano y lo Comunitario,Promedio");
ok("CSV Ana", lineas[1], "1,ANA PÉREZ,2,9,8,10,9,9.0");
ok("CSV Carla con pendientes", lineas[2], "2,CARLA RUIZ,2,7,pendiente,pendiente,pendiente,pendiente");
ok("CSV comillas escapadas", lineas[3], "1,\"BETO, \"\"el de 4°\"\"\",4,5,6,7,6,6.0");

const conc = R.htmlConcentrado(filas, 1);
ok("Concentrado: Ana en Alto", /Alto[\s\S]*ANA PÉREZ[\s\S]*Bajo/.test(conc), true);
ok("Concentrado: Beto en Bajo con campo no aprobatorio", /Bajo[\s\S]*BETO[\s\S]*>con campo no aprobatorio</.test(conc), true);
// Decisión 17b: en 2° el 5 tampoco es aprobatorio (escala de 5 a 10); en 1° no hay 5
{
	const al2 = [{ id: "d", nombre_completo: "DANI DE SEGUNDO", num_lista: 3, grado: 2 }];
	const d2 = { motor: { porAlumno: {} }, boletas: { d: { 1: { LEN: bol(5, true), SAB: bol(8, true), ETI: bol(8, true), DHL: bol(8, true) }, 2: {}, 3: {} } } };
	const conc2 = R.htmlConcentrado(R.filas(al2, d2, 1), 1);
	ok("Concentrado: 2° con un 5 lleva «con campo no aprobatorio»", /DANI DE SEGUNDO[\s\S]*?>con campo no aprobatorio</.test(conc2), true);
	const d2b = { motor: { porAlumno: {} }, boletas: { d: { 1: { LEN: bol(6, true), SAB: bol(8, true), ETI: bol(8, true), DHL: bol(8, true) }, 2: {}, 3: {} } } };
	ok("Concentrado: 2° sin 5 no lo lleva", R.htmlConcentrado(R.filas(al2, d2b, 1), 1).includes(">con campo no aprobatorio</span>"), false);
}
ok("Concentrado: Carla en pendientes (1 de 4)", /Pendientes de confirmar[\s\S]*CARLA RUIZ[\s\S]*1 de 4 confirmadas/.test(conc), true);
ok("Concentrado: sin bloque Medio vacío", conc.includes("Medio (promedio"), false);
ok("Concentrado: tabla por grado usa solo confirmadas (2° LEN = 8.0)", /<td class='px-3 py-2 font-medium'>2°<\/td><td[^>]*><b[^>]*>8\.0<\/b>/.test(conc), true);
ok("Concentrado: 2° SAB promedia solo lo confirmado (8.0 de Ana)", /2°<\/td>(<td[^>]*>[\s\S]*?<\/td>){1}<td[^>]*><b[^>]*>8\.0<\/b>/.test(conc), true);

const vacio = R.htmlConcentrado([], 1);
ok("Concentrado sin alumnos", vacio.includes("Sin alumnos activos"), true);

console.log(fallos ? fallos + " FALLAS" : "TODO OK");
process.exit(fallos ? 1 : 0);
