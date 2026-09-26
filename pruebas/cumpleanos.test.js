/*
	Cumpleaños (pestaña "Cumpleaños" de calendario.html, decisión de Jorge del 2026-09-26).

	- js/cumpleanos.js: próximos cumpleaños en orden (hoy primero), edad que cumplen, 29 de
	  febrero (en año no bisiesto, el 28), alumnos sin fecha o con fecha inválida, solo activos.
	- js/calendario.js: el pastel en la vista de mes (nombres escapados y solo en el nombre
	  accesible), la nota del día sin clase y la pestaña en la página.
	- R21: el pastel marca TODOS los cumpleaños del mes que se ve (también los que ya pasaron);
	  fuera de los ciclos cargados no dice "Fuera del periodo de clases".
	- Inicio (Jorge, 2026-09-26): aviso discreto el mismo día y hasta 7 días antes, con enlace a
	  Calendario → Cumpleaños; solo activos; sin lecturas extra (la de alumnos ya existente).

	node pruebas/cumpleanos.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");
const K = require("../js/cumpleanos.js");
const C = require("../js/calendario-sep.js");
const P = require("../js/calendario.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

const al = (id, n, f, estatus) => ({ id, nombre_completo: n, fecha_nacimiento: f, estatus: estatus || "activo" });
const HOY = "2026-09-25";
const grupo = [
	al("a", "Ana", "2018-09-27"),      // en 2 días, cumple 8
	al("b", "Beto", "2017-09-25"),     // hoy, cumple 9
	al("c", "Carla", "2019-09-24"),    // ayer: el próximo es en 2027, cumple 8
	al("d", "Dora", "2016-02-29"),     // 29 de febrero: en 2027 (no bisiesto) se marca el 28
	al("e", "Eva", null),              // sin fecha
	al("f", "Fer", "2018-13-40"),      // fecha inválida: cuenta como sin fecha
	al("g", "Gil", "2018-10-01", "baja"), // de baja: no sale
	al("h", "Hugo", "2018-09-26"),     // mañana
];
const r = K.proximos(grupo, HOY);
ok("orden: hoy, mañana, en 2 días, … y el que fue ayer al final", r.lista.map((c) => [c.alumno.id, c.dias, K.cuando(c.dias)]),
	[["b", 0, "hoy"], ["h", 1, "mañana"], ["a", 2, "en 2 días"], ["d", 156, "en 156 días"], ["c", 364, "en 364 días"]]);
ok("edad que cumplen", r.lista.map((c) => [c.alumno.id, c.edad]), [["b", 9], ["h", 8], ["a", 8], ["d", 11], ["c", 8]]);
ok("29 de febrero: en 2027 (no bisiesto) se marca el 28 de febrero", [r.lista[3].fecha, r.lista[3].bisiesto], ["2027-02-28", true]);
ok("29 de febrero: en año bisiesto, el 29", K.siguiente("2016-02-29", "2028-01-10").fecha, "2028-02-29");
ok("29 de febrero visto el 28 de febrero de un año no bisiesto: es hoy", [K.siguiente("2016-02-29", "2027-02-28").dias, K.siguiente("2016-02-29", "2027-02-28").edad], [0, 11]);
ok("sin fecha (vacía o inválida) y solo activos", [r.sinFecha, K.textoSinFecha(r.sinFecha), K.textoSinFecha(1), r.lista.some((c) => c.alumno.id === "g")], [2, "2 alumnos sin fecha de nacimiento", "1 alumno sin fecha de nacimiento", false]);
ok("fecha futura: no se toma como cumpleaños", K.siguiente("2027-01-01", HOY), null);
ok("fin de año: el 2 de enero visto el 30 de diciembre", [K.siguiente("2019-01-02", "2026-12-30").fecha, K.siguiente("2019-01-02", "2026-12-30").dias, K.siguiente("2019-01-02", "2026-12-30").edad], ["2027-01-02", 3, 8]);
ok("bisiestos", [2024, 2026, 2100, 2000].map(K.bisiesto), [true, false, false, true]);

// ── Vista de mes ─────────────────────────────────────────────────────────────
const porFecha = K.porFecha(r.lista);
const mes = P.htmlMes("2026-09", [], HOY, porFecha);
ok("mes: pastel discreto en los días con cumpleaños (25, 26 y 27 de septiembre)", (mes.match(/data-cumple='1'/g) || []).length, 3);
ok("mes: el nombre accesible del día dice de quién es y cuántos cumple", /aria-label='viernes 25 de septiembre: Consejo Técnico Escolar[^']*sin clase \(hoy\)\. Cumpleaños de Beto \(cumple 9\)'/.test(mes), true);
ok("mes: sin cumpleaños no hay pastel", /data-cumple/.test(P.htmlMes("2026-09", [], HOY)), false);
const MALO = "<img src=x onerror=alert(1)>'\"";
const conMalo = P.htmlMes("2026-09", [], HOY, K.porFecha(K.proximos([al("m", MALO, "2018-09-28")], HOY).lista));
ok("mes: nombres escapados", [/<img/.test(conMalo), /&lt;img src=x onerror=alert\(1\)&gt;&#39;&quot;/.test(conMalo)], [false, true]);
ok("cumpleaños en fin de semana o sin clase: se muestra con la nota del día",
	[P.notaDia(C.tipoDeDia("2026-09-27", [])), P.notaDia(C.tipoDeDia("2026-12-24", [])).indexOf("Sin clase: ") === 0, P.notaDia(C.tipoDeDia("2026-09-28", []))], ["Cae en fin de semana", true, ""]);
ok("varios el mismo día", P.textoCumples([{ nombre: "Ana", edad: 8 }, { nombre: "Beto", edad: 9 }, { nombre: "Carla", edad: 7 }]), "Ana (cumple 8), Beto (cumple 9) y Carla (cumple 7)");

// ── Página ───────────────────────────────────────────────────────────────────
const html = leer("calendario.html");
const js = leer("js/calendario.js");
ok("pestaña Cumpleaños (44 px), panel y js/cumpleanos.js antes de js/calendario.js",
	[/<button id="tabCumples" type="button" role="tab" data-tab="cumpleanos" aria-controls="panelCumples"[^>]*min-h-\[44px\][^>]*>Cumpleaños<\/button>/.test(html), /<section id="panelCumples" role="tabpanel"/.test(html),
		html.indexOf('src="js/cumpleanos.js"') > 0 && html.indexOf('src="js/cumpleanos.js"') < html.indexOf('src="js/calendario.js"')], [true, true, true]);
ok("la página lee la fecha de nacimiento y avisa de los que no la tienen con enlace a Mi grupo",
	[/select\("id, nombre_completo, num_lista, estatus, fecha_nacimiento"\)/.test(js), /K\.textoSinFecha\(cumples\.sinFecha\)[\s\S]{0,200}href='mi-grupo\.html'/.test(js)], [true, true]);

// ── R21: el pastel del mes marca todos los cumpleaños de ese mes, también los pasados ──
const mesSep = K.delMes(grupo, "2026-09");
ok("delMes: septiembre 2026 con los que ya pasaron (Carla, el 24) y los que vienen; sin baja ni sin fecha",
	Object.keys(mesSep).sort().map((f) => [f, mesSep[f].map((c) => c.nombre + " " + c.edad).join(",")]),
	[["2026-09-24", "Carla 7"], ["2026-09-25", "Beto 9"], ["2026-09-26", "Hugo 8"], ["2026-09-27", "Ana 8"]]);
ok("delMes: un mes ya pasado del ciclo también (febrero 2027 con el 29 → 28) y uno sin cumpleaños",
	[K.delMes(grupo, "2027-02"), K.delMes(grupo, "2026-11"), K.delMes(grupo, "2028-02")["2028-02-29"]],
	[{ "2027-02-28": [{ nombre: "Dora", edad: 11 }] }, {}, [{ nombre: "Dora", edad: 12 }]]);
ok("delMes: sin edad (nació ese mes o después) no hay pastel", [K.delMes([al("z", "Bebé", "2026-09-10")], "2026-09"), K.delMes([al("z", "Bebé", "2026-09-10")], "2027-09")["2027-09-10"]],
	[{}, [{ nombre: "Bebé", edad: 1 }]]);
const mesConPasados = P.htmlMes("2026-09", [], "2026-09-30", mesSep);
ok("mes visto el 30 de septiembre: siguen los pasteles del 24 al 27 (antes solo salían los próximos 12 meses)",
	(mesConPasados.match(/data-cumple='1'/g) || []).length, 4);
const jsCal = leer("js/calendario.js");
ok("la página usa delMes para el mes, el día y la impresión (no la lista de próximos)",
	[/function cumplesDelMes\(m\) \{ return window\.Cumpleanos \? window\.Cumpleanos\.delMes\(todos, m\) : \{\}; \}/.test(jsCal),
		/htmlMes\(mesVista, ajustes, hoy, cumplesDelMes\(mesVista\)\)/.test(jsCal), /cumplesDelMes\(fecha\.slice\(0, 7\)\)\[fecha\]/.test(jsCal),
		/htmlImpresionMes\(meta, mesVista, ajustes, hoy, cumplesDelMes\(mesVista\)\)/.test(jsCal), /cumplesPorFecha/.test(jsCal)],
	[true, true, true, true, false]);
ok("fuera de los ciclos cargados: un cumpleaños no dice «Fuera del periodo de clases» (solo el fin de semana)",
	[P.notaDia(C.tipoDeDia("2028-03-01", [])), P.notaDia(C.tipoDeDia("2028-03-04", [])), P.notaDia(C.tipoDeDia("2027-09-03", [])), /Fuera del periodo de clases/.test(jsCal.slice(jsCal.indexOf("function notaDia("), jsCal.indexOf("function estilo(")))],
	["", "Cae en fin de semana", "", false]);

// ── Inicio: el mismo día y hasta 7 días antes (Jorge, 2026-09-26) ─────────────
const gi = [al("i1", "Ana Pérez", "2018-09-25"), al("i2", "Luis Ríos", "2017-10-01"), al("i3", "Mar Sol", "2018-09-28"),
	al("i4", "Lejos Diez", "2018-10-05"), al("i5", "Justo Siete", "2018-10-02"), al("i6", "Baja Hoy", "2018-09-25", "baja"), al("i7", "Sin Fecha", null)];
ok("constante de días antes: 7", K.DIAS_AVISO_INICIO, 7);
ok("paraInicio: hoy, en 3, en 6 y en 7 días (inclusive); no el de 10 días, ni la baja, ni sin fecha",
	K.paraInicio(gi, HOY).map((c) => [c.alumno.id, c.dias]), [["i1", 0], ["i3", 3], ["i2", 6], ["i5", 7]]);
ok("textoInicio: «Nombre, hoy (cumple 8) · Nombre, el jueves 1 de octubre (cumple 9)»",
	K.textoInicio(K.paraInicio(gi, HOY).filter((c) => c.alumno.id === "i1" || c.alumno.id === "i2")),
	"Ana Pérez, hoy (cumple 8) · Luis Ríos, el jueves 1 de octubre (cumple 9)");
ok("textoInicio: mañana y el día de la semana", [K.textoInicio(K.paraInicio([al("m", "Mañanero", "2018-09-26")], HOY)), K.elDia("2026-09-28")],
	["Mañanero, mañana (cumple 8)", "el lunes 28 de septiembre"]);
ok("nadie en esos 7 días: lista vacía (Inicio no muestra nada)", K.paraInicio([al("x", "Lejos", "2018-10-05")], HOY), []);
const dj = leer("js/dashboard.js"), dh = leer("dashboard.html");
ok("Inicio: usa la lectura de alumnos que ya hace (activos del grupo activo) con la fecha de nacimiento; sin otra lectura",
	[/\.select\("id, nombre_completo, grado, num_lista, created_at, estatus, fecha_nacimiento"\)\s*\.eq\("grupo_id", grupoId\)\s*\.eq\("estatus", "activo"\)/.test(dj),
		(dj.match(/from\("alumnos"\)/g) || []).length, /K\.paraInicio\(alumnos, getLocalDateISO\(\)\)/.test(dj)],
	[true, 1, true]);
ok("Inicio: línea discreta en el encabezado (oculta si no hay), enlace a Calendario → Cumpleaños de 44 px, texto escapado",
	[/<header[\s\S]*id="avisoCumples" class="hidden[\s\S]*<\/header>/.test(dh), /href='calendario\.html#cumpleanos' class='[^']*min-h-\[44px\]/.test(dj),
		/escapeHtml\(K\.textoInicio\(lista\)\)/.test(dj), /if \(!lista\.length\) \{ aviso\.classList\.add\("hidden"\)/.test(dj),
		dh.indexOf('src="js/cumpleanos.js"') > 0 && dh.indexOf('src="js/cumpleanos.js"') < dh.indexOf('src="js/dashboard.js"')],
	[true, true, true, true, true]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
