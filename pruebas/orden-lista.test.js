/*
	Número de lista: UNA sola regla (Jorge, 2026-09-27; js/orden-lista.js).
	  - Primero por grado (de menor a mayor); dentro de cada grado, orden alfabético del nombre
	    completo en español (Ñ después de N, acentos sin cambiar el lugar, "N N" entre las N).
	  - El número corre 1..N sobre TODO el grupo: 9 de 1° y 7 de 2° → 1° del 1 al 9, 2° del 10 al 16.
	Además: quién la usa (alta, Mi grupo, Ponte al día y Hoy), que nadie más asigne num_lista, la
	tarjeta de Asistencia de Hoy (sub-tarjeta por grado, número al inicio) y el formulario del alta
	(botones de grado, lápiz y bote de basura).

	node pruebas/orden-lista.test.js
*/

const fs = require("fs");
const path = require("path");
const O = require("../js/orden-lista.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado);
	const bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (bien ? "" : " → " + a + " (esperado " + b + ")"));
}
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/^﻿/, "");
const nombres = (l) => l.map((a) => a.nombre_completo);
const al = (id, nombre, grado, num) => ({ id, nombre_completo: nombre, grado, num_lista: num === undefined ? null : num });

// ── 1. Regla A: grado y luego alfabético; número 1..N sobre todo el grupo ─────
{
	const primero = ["RÍOS LUNA ANA", "BAEZ CRUZ LUIS", "ZAPATA MORA EVA", "MORA JOSE BETO", "CANO RUIZ PEDRO",
		"ORTIZ VEGA SOFÍA", "ÁVILA PAZ DIANA", "LÓPEZ NAVA TERE", "HERRERA SOL IVÁN"].map((n, i) => al("p" + i, n, 1, 20 - i));
	const segundo = ["IBARRA DIEGO", "ACOSTA REY MARIO", "VEGA LUZ ANA", "DURÁN PILAR", "PEÑA LARA JUAN",
		"GÓMEZ RAÚL", "NÚÑEZ SOL ROSA"].map((n, i) => al("s" + i, n, 2, i + 1));
	// Mezclados: lo que llega de la base o de la captura no importa
	const grupo = [segundo[3], primero[0], segundo[0], primero[8], primero[1], segundo[6], primero[4], primero[2], segundo[1],
		primero[3], segundo[2], primero[5], segundo[4], primero[6], segundo[5], primero[7]];
	const n = O.numerar(grupo);
	ok("16 alumnos, 1..16 sin huecos", n.map((a) => a.num_lista), Array.from({ length: 16 }, (_, i) => i + 1));
	ok("los 9 de 1° van del 1 al 9", n.filter((a) => a.grado === 1).map((a) => a.num_lista), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
	ok("los 7 de 2° van del 10 al 16 (el número es del grupo, no del grado)", n.filter((a) => a.grado === 2).map((a) => a.num_lista), [10, 11, 12, 13, 14, 15, 16]);
	ok("1° en orden alfabético (Á con la A)", nombres(n.filter((a) => a.grado === 1)),
		["ÁVILA PAZ DIANA", "BAEZ CRUZ LUIS", "CANO RUIZ PEDRO", "HERRERA SOL IVÁN", "LÓPEZ NAVA TERE", "MORA JOSE BETO", "ORTIZ VEGA SOFÍA", "RÍOS LUNA ANA", "ZAPATA MORA EVA"]);
	ok("2° en orden alfabético (DURÁN, GÓMEZ, NÚÑEZ, PEÑA)", nombres(n.filter((a) => a.grado === 2)),
		["ACOSTA REY MARIO", "DURÁN PILAR", "GÓMEZ RAÚL", "IBARRA DIEGO", "NÚÑEZ SOL ROSA", "PEÑA LARA JUAN", "VEGA LUZ ANA"]);
	ok("numerar no toca la lista original", grupo[0].num_lista, 4);
	ok("ordenar no toca la lista original", nombres(O.ordenar(grupo)).length === 16 && grupo[0].nombre_completo === "DURÁN PILAR", true);
	// Otro orden de entrada, el mismo resultado
	const alReves = grupo.slice().reverse();
	ok("el orden de entrada no cambia el resultado", nombres(O.ordenar(alReves)), nombres(n));
}

// ── 2. Ñ, acentos y "N N" ────────────────────────────────────────────────────
{
	const l = ["PEREZ ANA", "PEÑA ANA", "PENA ANA", "ÑECO LUIS", "NUÑEZ ROSA", "OCHOA EVA", "N N JOSÉ", "NAVA LUIS", "MUÑOZ ANA", "N N TOMÁS"]
		.map((x, i) => al("x" + i, x, 3));
	ok("Ñ después de N y antes de O; PENA < PEÑA < PEREZ; N N entre las N (antes de NAVA)", nombres(O.ordenar(l)),
		["MUÑOZ ANA", "N N JOSÉ", "N N TOMÁS", "NAVA LUIS", "NUÑEZ ROSA", "ÑECO LUIS", "OCHOA EVA", "PENA ANA", "PEÑA ANA", "PEREZ ANA"]);
	const acentos = ["ÉLMER RUIZ", "ELENA ROJAS", "ÁLVAREZ SOL", "ALVAREZ LUZ", "ÚRSULA MENA"].map((x, i) => al("a" + i, x, 1));
	ok("los acentos no cambian el lugar (Á con la A, É con la E, Ú con la U)", nombres(O.ordenar(acentos)),
		["ALVAREZ LUZ", "ÁLVAREZ SOL", "ELENA ROJAS", "ÉLMER RUIZ", "ÚRSULA MENA"]);
	// "JOSE" y "JOSÉ" empatan sin acentos: decide el acento, igual sin importar el orden de entrada
	const empate = [al("j2", "RUIZ JOSÉ", 2), al("j1", "RUIZ JOSE", 2)];
	ok("empate sin acentos: siempre el mismo orden (JOSE antes que JOSÉ)", [nombres(O.ordenar(empate)), nombres(O.ordenar(empate.slice().reverse()))],
		[["RUIZ JOSE", "RUIZ JOSÉ"], ["RUIZ JOSE", "RUIZ JOSÉ"]]);
	ok("espacios de más no cambian el lugar", nombres(O.ordenar([al("e1", "BAEZ  LUIS", 1), al("e2", "BAEZ ANA", 1)])), ["BAEZ ANA", "BAEZ  LUIS"]);
}

// ── 3. Un solo grado y tres grados ───────────────────────────────────────────
{
	const uno = [al("u1", "VEGA ANA", 4, 1), al("u2", "ARIAS LUIS", 4, 2), al("u3", "MENA SOL", 4, 3)];
	ok("un solo grado: alfabético 1..N", O.numerar(uno).map((a) => a.num_lista + " " + a.nombre_completo), ["1 ARIAS LUIS", "2 MENA SOL", "3 VEGA ANA"]);
	const tres = [al("t1", "ZETA ANA", 3), al("t2", "ALBA EVA", 5), al("t3", "BRAVO LUIS", 3), al("t4", "CRUZ SOL", 4),
		al("t5", "ABREGO PIA", 4), al("t6", "MORA ANA", 5), al("t7", "ARCE LEO", 3)];
	ok("tres grados: 3°, 4° y 5° en orden, alfabético dentro, 1..7 corrido",
		O.numerar(tres).map((a) => a.num_lista + " " + a.grado + "° " + a.nombre_completo),
		["1 3° ARCE LEO", "2 3° BRAVO LUIS", "3 3° ZETA ANA", "4 4° ABREGO PIA", "5 4° CRUZ SOL", "6 5° ALBA EVA", "7 5° MORA ANA"]);
	ok("el grado como texto ('2') cuenta como número", nombres(O.ordenar([al("g1", "ANA", "2"), al("g2", "ZOE", 1)])), ["ZOE", "ANA"]);
	ok("sin grado válido va al final", nombres(O.ordenar([al("g3", "ANA", null), al("g4", "ZOE", 6)])), ["ZOE", "ANA"]);
	ok("lista vacía", O.numerar([]), []);
}

// ── 4. posicion y cambios (Mi grupo: el nuevo entra en su lugar) ─────────────
{
	const grupo = [al("a", "ARIAS LUIS", 1, 1), al("b", "VEGA ANA", 1, 2), al("c", "BAEZ SOL", 2, 3), al("d", "RUIZ EVA", 2, 4)];
	ok("un nuevo de 1° «MENA» entra en el 2", O.posicion(grupo, { nombre_completo: "MENA PAZ", grado: 1 }), 2);
	ok("un nuevo de 2° «ZAPATA» entra en el 5 (al final)", O.posicion(grupo, { nombre_completo: "ZAPATA LEO", grado: 2 }), 5);
	ok("un nuevo de 1° «ABREGO» entra en el 1", O.posicion(grupo, { nombre_completo: "ABREGO LEO", grado: 1 }), 1);
	ok("ya numerado con la regla: sin cambios", O.cambios(grupo), []);
	const viejo = [al("a", "ARIAS LUIS", 1, 1), al("c", "BAEZ SOL", 2, 2), al("d", "RUIZ EVA", 2, 3), al("b", "VEGA ANA", 1, 4)];
	ok("numerado alfabético mezclando grados (la regla anterior): cambian VEGA, BAEZ y RUIZ", O.cambios(viejo),
		[{ id: "b", num_lista: 2 }, { id: "c", num_lista: 3 }, { id: "d", num_lista: 4 }]);
}

// ── 5. renumerar: ordena en su lugar y guarda solo lo que cambió ─────────────
function sbFalso(fallarEn) {
	const escrituras = [];
	return {
		escrituras,
		from(tabla) {
			const q = { tabla, filtros: {}, datos: null };
			const api = {
				update(d) { q.datos = d; return api; },
				eq(c, v) { q.filtros[c] = v; return api; },
				then(bien, mal) {
					escrituras.push(q);
					const error = fallarEn && q.filtros.id === fallarEn ? { message: "sin red" } : null;
					return Promise.resolve({ error }).then(bien, mal);
				},
			};
			return api;
		},
	};
}
(async () => {
	{
		const lista = [al("a", "ARIAS LUIS", 1, 1), al("c", "BAEZ SOL", 2, 2), al("d", "RUIZ EVA", 2, 3), al("b", "VEGA ANA", 1, 4)];
		const sb = sbFalso();
		const r = await O.renumerar(sb, { maestroId: "m1", grupoId: "g1" }, lista);
		ok("renumerar devuelve la misma lista, ordenada en su lugar", [r === lista, nombres(lista)], [true, ["ARIAS LUIS", "VEGA ANA", "BAEZ SOL", "RUIZ EVA"]]);
		ok("renumerar deja 1..N", lista.map((a) => a.num_lista), [1, 2, 3, 4]);
		ok("solo escribe los 3 que cambiaron, en alumnos y con maestro y grupo",
			sb.escrituras.map((q) => [q.tabla, q.filtros.id, q.datos.num_lista, q.filtros.maestro_id, q.filtros.grupo_id]),
			[["alumnos", "b", 2, "m1", "g1"], ["alumnos", "c", 3, "m1", "g1"], ["alumnos", "d", 4, "m1", "g1"]]);
		const sb2 = sbFalso();
		await O.renumerar(sb2, { maestroId: "m1", grupoId: "g1" }, lista);
		ok("ya ordenada: ninguna escritura", sb2.escrituras.length, 0);
	}
	{
		const lista = [al("a", "ARIAS LUIS", 1, 1), al("c", "BAEZ SOL", 2, 2), al("d", "RUIZ EVA", 2, 3), al("b", "VEGA ANA", 1, 4)];
		let error = null;
		try { await O.renumerar(sbFalso("c"), { maestroId: "m1", grupoId: "g1" }, lista); } catch (e) { error = e; }
		ok("si una escritura falla, lanza (y la lista queda ordenada en pantalla)", [!!error, nombres(lista)], [true, ["ARIAS LUIS", "VEGA ANA", "BAEZ SOL", "RUIZ EVA"]]);
		ok("lo ya guardado se conserva; lo que falló no se marca como guardado", lista.map((a) => a.num_lista), [1, 2, 2, 3]);
	}

	// ── 6. Quién la usa y que nadie más asigne num_lista ──────────────────────
	const ob = leer("js/onboarding.js"), mg = leer("js/mi-grupo.js"), pd = leer("js/ponte-al-dia.js"), hoy = leer("js/hoy.js");
	ok("alta: guarda con OrdenLista.numerar (el número que se ve en la lista)", /OrdenLista\.numerar\(students\)[\s\S]{0,400}num_lista: s\.num_lista/.test(ob), true);
	ok("alta: ya no ordena alfabético mezclando grados", /orderedStudents/.test(ob), false);
	ok("Mi grupo: renumera con OrdenLista.renumerar y el nuevo entra con OrdenLista.posicion",
		[/OrdenLista\.renumerar\(window\.sb, \{ maestroId: userId, grupoId: currentGroup\.id \}, students\)/.test(mg), /num_lista: nextListNumber/.test(mg) && /OrdenLista\.posicion\(students,/.test(mg)], [true, true]);
	ok("Mi grupo: sin la regla vieja (sortStudents, getNextListNumber)", /function sortStudents|function getNextListNumber/.test(mg), false);
	ok("Mi grupo: renumera al abrir, al agregar o editar y al borrar", (mg.match(/await recalculateAndPersistListOrder\(\);/g) || []).length, 3);
	ok("Ponte al día: al pegar más alumnos renumera todo el grupo", /OrdenLista\.renumerar\(window\.sb, \{ maestroId: userId, grupoId: grupo\.id \}, todos\)/.test(pd), true);
	[["onboarding.html", "js/onboarding.js"], ["mi-grupo.html", "js/mi-grupo.js"], ["ponte-al-dia.html", "js/ponte-al-dia.js"], ["hoy.html", "js/hoy.js"]].forEach(([h, s]) => {
		const t = leer(h), i = t.indexOf('src="js/orden-lista.js"'), j = t.indexOf('src="' + s + '"');
		ok(h + " carga orden-lista.js antes de " + s, i !== -1 && i < j, true);
	});
	// Objetos con num_lista (lo que se inserta o actualiza) en js/: solo los de la regla. exportar.js
	// solo copia el número leído para ordenar la hoja (no escribe en la base)
	const escriben = fs.readdirSync(path.join(RAIZ, "js")).filter((f) => f.endsWith(".js")).filter((f) =>
		/(?<![.\w])num_lista\s*:/.test(leer("js/" + f)));
	ok("solo alta, Mi grupo, Ponte al día y orden-lista ponen num_lista (y exportar lo copia)", escriben.sort(),
		["exportar.js", "mi-grupo.js", "onboarding.js", "orden-lista.js", "ponte-al-dia.js"]);
	ok("exportar.js solo copia el número leído", (leer("js/exportar.js").match(/(?<![.\w])num_lista\s*:[^,}]*/g) || []), ["num_lista: v.alumnos.num_lista "]);

	// ── 7. Hoy: tarjeta de Asistencia ─────────────────────────────────────────
	function extraer(nombre) {
		const m = hoy.match(new RegExp("\\n\\tfunction " + nombre + "\\([\\s\\S]*?\\n\\t\\}"));
		if (!m) throw new Error("no se encontró " + nombre + " en js/hoy.js");
		return m[0];
	}
	const ASIS = hoy.match(/var ASISTENCIA = \[[\s\S]*?\];/)[0];
	const dom = {};
	const cuerpo = [
		"var document = { getElementById: function (id) { return (DOM[id] = DOM[id] || { innerHTML: '', textContent: '' }); } };",
		"var window = { OrdenLista: O };",
		"var alumnos = ALUMNOS; var asistencia = ASIST; var asistenciaPlegada = false;",
		ASIS, extraer("esc"), extraer("chip"), extraer("filaAlumno"), extraer("agruparPorGrado"),
		extraer("asistenciaCompleta"), extraer("textoResumenAsistencia"), extraer("renderAsistencia"), extraer("resumenAsistencia"),
		"return { renderAsistencia: renderAsistencia, filaAlumno: filaAlumno };",
	].join("\n");
	const alumnosHoy = [
		// Como llegan de la base (grado, num_lista), con números viejos para ver que el orden es alfabético
		al("h1", "ZAPATA EVA", 1, 1), al("h2", "ÁVILA LUIS", 1, 2), al("h3", "MUÑOZ ANA", 1, 3),
		al("h4", "RUIZ SOL", 2, 4), al("h5", "BAEZ PIA", 2, 5),
	];
	const api = new Function("DOM", "O", "ALUMNOS", "ASIST", cuerpo)(dom, O, alumnosHoy, { h4: "presente" });
	api.renderAsistencia();
	const html = dom.asistenciaLista.innerHTML;
	const subs = html.split("data-asistencia-grado=").slice(1);
	ok("Asistencia: una sub-tarjeta por grado, en orden de grado", subs.map((s) => s.slice(1, 2)), ["1", "2"]);
	ok("Asistencia: cada una con su título y su conteo", [/1° grado<\/h3><span[^>]*>3 alumnos</.test(subs[0]), /2° grado<\/h3><span[^>]*>2 alumnos</.test(subs[1])], [true, true]);
	const orden = (s) => (s.match(/data-num-lista>\d*<\/span><span[^>]*>([^<]+)</g) || []).map((x) => x.replace(/.*>([^<]+)<$/, "$1"));
	ok("Asistencia: alfabético dentro de cada grado", [orden(subs[0]), orden(subs[1])], [["ÁVILA LUIS", "MUÑOZ ANA", "ZAPATA EVA"], ["BAEZ PIA", "RUIZ SOL"]]);
	ok("Asistencia: el número de lista va al inicio, grande y no gris (columna fija)",
		/<span class='w-7 shrink-0 text-right text-sm font-bold text-gray-900 tabular-nums' data-num-lista>2<\/span><span[^>]*>ÁVILA LUIS/.test(html), true);
	ok("Asistencia: sin el número chico gris ni el « · 1°»", [/text-xs text-gray-400/.test(html), / · \d°/.test(html)], [false, false]);
	ok("Asistencia: los tres botones y lo marcado siguen", [(html.match(/data-asistencia='h\d'/g) || []).length, /data-asistencia='h4' data-valor='presente' class='[^']*bg-emerald-500 text-white/.test(html)], [15, true]);
	ok("Asistencia: el resumen general se queda", dom.asistenciaResumen.textContent, "1 de 5 capturados");
	const unGrado = new Function("DOM", "O", "ALUMNOS", "ASIST", cuerpo)(dom, O, [al("u1", "VEGA ANA", 4, 2), al("u2", "ARIAS LUIS", 4, 1)], {});
	unGrado.renderAsistencia();
	ok("Asistencia con un solo grado: también lleva su título", /data-asistencia-grado='4'[\s\S]*4° grado<\/h3>[\s\S]*2 alumnos/.test(dom.asistenciaLista.innerHTML), true);
	// Tareas, Trabajos, Pendientes y Cierre: la fila de siempre (número y grado chicos)
	const fila = api.filaAlumno(al("t1", "RUIZ SOL", 2, 4), "<b>x</b>", "Trabaja con 3°");
	ok("las demás secciones no cambian: número y grado chicos en gris y la nota",
		fila, "<div class='flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-gray-100 last:border-0'><div class='sm:w-56 shrink-0'>" +
		"<span class='text-sm font-medium text-gray-800'>RUIZ SOL</span><span class='text-xs text-gray-400 ml-2'>4 · 2°</span>" +
		"<span class='block text-xs font-semibold text-violet-700'>Trabaja con 3°</span></div><div class='flex flex-wrap gap-2'><b>x</b></div></div>");
	ok("solo Asistencia pide el número al inicio", (hoy.match(/numeroAlInicio: true/g) || []).length, 1);

	// ── 8. Alta: grado con botones, lápiz azul y bote rojo ─────────────────────
	const obh = leer("onboarding.html");
	ok("alta: sin lista desplegable de grado; botones en un grupo con su etiqueta",
		[/<select id="studentGrade"/.test(obh), /id="studentGradeButtons" role="group" aria-labelledby="studentGradeLabel"/.test(obh)], [false, true]);
	ok("alta: los botones de grado marcan el elegido (aria-pressed) y miden 44 px",
		/setAttribute\("aria-pressed", activo \? "true" : "false"\)/.test(ob) && /min-h-\[44px\] min-w-\[52px\]/.test(ob), true);
	ok("alta: el grado se queda después de agregar (no se regresa al primero)",
		/limpiarNombresFormulario\(\);\s*document\.getElementById\("studentLastName1"\)\.focus\(\);/.test(ob) && !/studentForm\.reset\(\)/.test(ob), true);
	ok("alta: Agregar a la derecha, debajo del grado", /<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">[\s\S]{0,600}id="studentSubmit"/.test(obh) &&
		obh.indexOf('id="studentGradeWrapper"') < obh.indexOf('id="studentSubmit"'), true);
	ok("alta: lápiz azul «Editar» y bote rojo «Quitar», de 44x44, sin la palabra Eliminar",
		[/botonIcono\("Editar", "Editar a " \+ nombre, ICONO_LAPIZ,\s*"text-blue-700/.test(ob), /botonIcono\("Quitar", "Quitar a " \+ nombre, ICONO_BASURA,\s*"text-red-600/.test(ob),
			/h-11 w-11 min-h-\[44px\] min-w-\[44px\]/.test(ob), /b\.title = titulo;/.test(ob), /"Eliminar"/.test(ob)], [true, true, true, true, false]);
	ok("alta: editar carga apellidos, nombres y grado y cambia a «Guardar cambios» con «Cancelar»",
		/function empezarEdicion\(student\)[\s\S]*studentLastName1Input\.value[\s\S]*studentFirstNamesInput\.value[\s\S]*gradoElegido = Number\(student\.grado\)[\s\S]*"Guardar cambios"[\s\S]*studentCancelEditBtn\.classList\.remove\("hidden"\)/.test(ob), true);
	ok("alta: los pegados guardan sus partes para editarlos", /partes: partes \}\);\s*nuevos\+\+;/.test(ob) && /apellido1: f\.apellido1 \|\| "", apellido2: f\.apellido2 \|\| "", nombres: f\.nombres \|\| ""/.test(leer("js/lista-pegada.js")), true);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
