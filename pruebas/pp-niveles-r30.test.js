/*
	PP-NIVELES tras R30 (decisiones de Jorge del 2026-09-27: la planeación es la fuente y el SaaS la
	representa sin reinterpretarla). Falla con el código de 1edc33b.

	1. Orden de la clase: los pasos de cada fase se quedan en *_todos, en su lugar y con su redacción
	   (antes el plan sacaba "Grupo Azul: …" a un grupo de trabajo y la pantalla lo mostraba después
	   de "Cierre del bloque" y de la "Actividad de reserva"). El script de carga los deja tal cual
	   (ajustarFila) y lo comprueba; Actividades deja leer todos los pasos en su orden ("+ N más").
	2. Horario de la planeación en `duracion` ("Lunes 28 sep · 8:00 a 9:20 · Letras"); nunca `fecha`.
	3. "Trabaja con 1°": sale de los PDA ligados al producto. El alumno se evalúa siempre con los PDA
	   de SU grado (decisión de Jorge del 2026-09-27; evidencia solo en los de su grado, b5): un
	   trabajo por nivel con un alumno de otro grado se liga también a los PDA de ese grado y no lleva
	   nota (Morado y Triángulos con PDA de 1° y de 2°). Sin PDA de su grado, la nota lo dice.
	4. Reporte: "PDA trabajados", con la nota de que se evalúa con los PDA de su grado.
	5. El plan real (docs/referencia/pp-niveles-plan.json, fuera de git porque trae nombres): si está
	   en esta computadora, se revisa que no mueva pasos, que la hoja Morado (Lenguajes, Ética y De lo
	   Humano) y Triángulos (Saberes) estén ligados a los PDA de 1° y de 2°, que el trabajo de 2° de
	   Ética y De lo Humano sea solo de Azul, que cada alumno reciba en cada sesión un trabajo con PDA
	   de su grado (el de 2° de Morado y Triángulos, en las 15), el horario de las 15 sesiones y el
	   nombre de la sesión 13. Sin el archivo, esa parte se salta.

	node pruebas/pp-niveles-r30.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

const C = require("../scripts/cargar-pp-niveles.js");
const A = require("../js/alcance-hoy.js");
const TS = require("../js/texto-sesion.js");

// ── 1 y 2. El script deja los pasos en su orden y pone el horario ──
ok("cargar-pp-niveles exporta ajustarFila", typeof C.ajustarFila, "function");
const desarrollo = { mode: "todos", todos: ["Paso 1", "Paso 2", "Grupo Azul: además de su tarjeta…", "Paso 4", "Grupos Morado y Naranja, al regresar a su lugar: arman…", "Cierre del bloque con todo el grupo", "Actividad de reserva"], diferenciado: null };
const planSin = { sesiones: { 1: { productos: [], duracion: "Lunes 28 sep · 8:00 a 9:20 · Letras" } }, drive: { carpetas_por_sesion: {} }, anexos: {} };
if (typeof C.ajustarFila === "function") {
	const fila = C.ajustarFila({ inicio_actividades: null, desarrollo_actividades: JSON.parse(JSON.stringify(desarrollo)), cierre_actividades: null, recursos: null, pda_sesion: [], fecha: "2026-09-28" }, 1, planSin, {});
	ok("sin movimientos en el plan, los pasos quedan tal cual y en su orden", fila.desarrollo_actividades, desarrollo);
	ok("…y así se leen en Inicio y Actividades (el paso de Azul antes del Cierre del bloque)",
		TS.lineasActividades(fila.desarrollo_actividades).indexOf("Grupo Azul: además de su tarjeta…") < TS.lineasActividades(fila.desarrollo_actividades).indexOf("Cierre del bloque con todo el grupo"), true);
	ok("el horario de la planeación va en duracion", fila.duracion, "Lunes 28 sep · 8:00 a 9:20 · Letras");
	ok("nunca pone fecha (marcaría la sesión como trabajada)", "fecha" in fila, false);
}
// Así quedaba con el plan de antes: el paso de Azul se iba al final, después de la reserva
const movido = C.textoPorGrupo(JSON.parse(JSON.stringify(desarrollo)), [{ paso: 3, llave: "Azul", quitar: "Grupo Azul: " }], ["Azul"], "prueba");
const lineas = TS.lineasActividades(movido);
ok("(antes) con el paso movido a un grupo, «Azul» salía después de la Actividad de reserva", lineas.indexOf("Azul: Además de su tarjeta…") > lineas.indexOf("Actividad de reserva"), true);
const script = leer("scripts/cargar-pp-niveles.js");
ok("el script comprueba que los pasos quedaron como en la planeación y el horario", /los pasos no quedaron como en la planeación/.test(script) && /sin el horario de la planeación en duracion/.test(script), true);

// Actividades: "+ N más" deja ver el resto de los pasos, en su orden
const act = leer("js/actividades.js");
ok("Actividades: los pasos 4 en adelante se pintan (ocultos) y «+ N más» los muestra",
	/paso-extra/.test(act) && /ver-mas-pasos/.test(act) && /aria-expanded/.test(act) && !/lista\.slice\(0, 3\)/.test(act), true);

// ── 3. "Trabaja con" desde los PDA ligados ──
const idx = { morado: { diego: "incluir", ana: "incluir" }, tri: { diego: "incluir" } };
const diego = { id: "diego", grado: 2 }, ana = { id: "ana", grado: 1 };
const morado = { id: "morado", grados: [] }, tri = { id: "tri", grados: ["1"] };
ok("Morado (sin grados, PDA de 1° y de 2°, en Lenguajes, Ética y De lo Humano): Diego (2°) sin nota (se evalúa con los de 2°)", A.trabajaCon(diego, morado, idx, [1, 2]), "");
ok("Triángulos (grados [1], PDA de 1° y de 2°): Diego (2°) sin nota", A.trabajaCon(diego, tri, idx, [1, 2]), "");
ok("Ana (1°) en Morado: sin nota", [A.trabajaCon(ana, morado, idx, [1]), A.trabajaCon(ana, morado, idx, [1, 2])], ["", ""]);
ok("un trabajo sin PDA de su grado (ya no pasa en PP-NIVELES: el plan no carga): «Trabaja con 1°»", [A.trabajaCon(diego, morado, idx, [1]), A.trabajaCon(diego, tri, idx, [1])], ["1°", "1°"]);
ok("sin leer los PDA ligados, la nota sale de los grados del producto (como antes)", A.trabajaCon(diego, tri, idx), "1°");
ok("sin PDA ligados, la nota sale de los grados del producto (como antes)", A.trabajaCon(diego, morado, idx, []), "");
ok("gradosPdaPorProducto: agrupa los grados de los PDA ligados",
	typeof A.gradosPdaPorProducto === "function" ? A.gradosPdaPorProducto([
		{ producto_sesion_id: "morado", sesiones_pda: { grado: 2 } }, { producto_sesion_id: "morado", sesiones_pda: { grado: 1 } },
		{ producto_sesion_id: "morado", sesiones_pda: { grado: 1 } }, { producto_sesion_id: "tri", sesiones_pda: [{ grado: 1 }] }, { producto_sesion_id: "x", sesiones_pda: null }]) : null,
	{ morado: [1, 2], tri: [1] });
const hoy = leer("js/hoy.js");
ok("Hoy lee los grados de los PDA ligados (lectura opcional) y los pasa a la nota",
	/from\("producto_sesion_pda"\)\.select\("producto_sesion_id, sesiones_pda\(grado\)"\)/.test(hoy) && /lectura-opcional: solo la nota "Trabaja con"/.test(hoy) &&
	/trabajaCon\(alumno, producto, asignaciones, gradosPda\[producto\.id\]\)/.test(hoy), true);

// ── 4. Reporte ──
const rep = leer("js/reporte-alumno.js");
ok("Reporte: «PDA trabajados», ya no «de su grado»", [/Procesos de desarrollo de aprendizaje trabajados/.test(rep), /Procesos de desarrollo de aprendizaje de su grado/.test(rep)], [true, false]);
ok("Reporte: la nota dice que se evalúa con los PDA de su grado (ya no que salen los de otro grado)",
	[/Se evalúa con los PDA "\s*\+\s*"de su grado, aunque haya trabajado las actividades de otro nivel/.test(rep), /también salen los PDA de ese grado/.test(rep)], [true, false]);
ok("Hoy, Inicio, Reporte y el script ya no citan b24 (se descartó)",
	["js/hoy.js", "js/alcance-hoy.js", "js/reporte-alumno.js", "scripts/cargar-pp-niveles.js"].filter((f) => /\bb24\b|pda_de_alumno_en_producto/.test(leer(f))), []);
ok("b24 ya no está en supabase/ (nunca se aplicó en producción)", fs.existsSync(path.join(RAIZ, "supabase", "mi_salon_b24_evidencia_incluidos_2026-09.sql")), false);

// ── 5. El plan real (si está en esta computadora) ──
const archivoPlan = path.join(RAIZ, "docs", "referencia", "pp-niveles-plan.json");
if (!fs.existsSync(archivoPlan)) {
	console.log("(se salta: no está docs/referencia/pp-niveles-plan.json en esta computadora)");
} else {
	const plan = JSON.parse(fs.readFileSync(archivoPlan, "utf8"));
	const S = plan.sesiones;
	ok("plan: ninguna sesión mueve pasos a un grupo de trabajo (los pasos quedan en el orden de la planeación)",
		Object.keys(S).filter((n) => S[n].texto && Object.keys(S[n].texto).some((f) => (S[n].texto[f] || []).length)), []);
	ok("plan: las 15 sesiones traen su día, horario y bloque",
		Object.keys(S).filter((n) => !/^(Lunes|Martes|Miércoles|Jueves|Viernes) \d{1,2} (sep|oct) · \d{1,2}:\d{2} a \d{1,2}:\d{2} · \S/.test(S[n].duracion || "")).length, 0);
	ok("plan: el día y el horario en el orden de la semana (S1-S3 lunes … S13-S15 viernes)",
		Object.keys(S).map((n) => String(S[n].duracion || "").split(" ")[0]).join(","), "Lunes,Lunes,Lunes,Martes,Martes,Martes,Miércoles,Miércoles,Miércoles,Jueves,Jueves,Jueves,Viernes,Viernes,Viernes");
	[3, 6, 12, 15].forEach((n) => {
		const ps = S[n].productos;
		const m = ps.find((p) => p.para.grupo === "Morado");
		ok("plan S" + n + ": la hoja Morado es de todo el grupo Morado (uno de 1° y uno de 2°) con los PDA de 1° y de 2°", [m.para, m.pda], [{ grupo: "Morado" }, [1, 2]]);
		ok("plan S" + n + ": el trabajo de 2° es solo de Azul", ps.filter((p) => p.pda.length === 1 && p.pda[0] === 2).map((p) => [p.para, / · Azul$/.test(p.nombre)]), [[{ grupo: "Azul" }, true]]);
	});
	// Lenguajes: Morado con los PDA de 1° y de 2°; Saberes: Triángulos igual (decisión de Jorge del
	// 2026-09-27: el alumno de 2° que trabaja con ellos se evalúa siempre con los PDA de 2°)
	ok("plan: Morado de Lenguajes (S1, 4, 7, 10 y 13) con los PDA de 1° y de 2°",
		[1, 4, 7, 10, 13].map((n) => { const m = S[n].productos.find((p) => p.para.grupo === "Morado"); return [m.para, m.pda]; }),
		[1, 4, 7, 10, 13].map(() => [{ grupo: "Morado" }, [1, 2]]));
	ok("plan: Triángulos de Saberes (S2, 5, 8, 11 y 14) con los PDA de 1° y de 2°",
		[2, 5, 8, 11, 14].map((n) => { const m = S[n].productos.find((p) => p.para.grupo === "Triángulos"); return [m.para, m.pda]; }),
		[2, 5, 8, 11, 14].map(() => [{ grupo: "Triángulos" }, [1, 2]]));
	ok("plan: Naranja, Círculos, Azul y Cuadrados siguen con los PDA de su nivel (solo alumnos de ese grado)",
		Object.keys(S).reduce((t, n) => t.concat(S[n].productos.filter((p) => /^(Naranja|Círculos|Azul|Cuadrados)$/.test(p.para.grupo || "")).map((p) => p.para.grupo + ":" + p.pda.join(","))), [])
			.filter((x) => !/^(Naranja|Círculos):1$|^(Azul|Cuadrados):2$/.test(x)), []);
	// Cada alumno, en cada sesión, un trabajo con PDA de su grado (la regla que exige el script)
	const claves = Object.keys(plan.alumnos);
	const ficticios = claves.map((k, i) => ({ id: "x" + i, grado: plan.alumnos[k].grado, num_lista: i + 1 }));
	const porClave = {};
	claves.forEach((k, i) => { porClave[k] = ficticios[i]; });
	const sesionesDos = Object.keys(S).map((n) => ({ numero_sesion: Number(n), campo_formativo: "Lenguajes" }));
	const res = C.productosDelPlan(plan, sesionesDos, ficticios, porClave, [1, 2]);
	ok("plan: cada alumno recibe en cada sesión un trabajo ligado a un PDA de su grado", res.errores, []);
	const deSegundo = (plan.agrupaciones.lectoescritura.Morado || []).filter((k) => Number(plan.alumnos[k].grado) === 2);
	const idDe = deSegundo.length === 1 ? porClave[deSegundo[0]].id : null;
	const conDos = Object.keys(res.porNumero).filter((n) => res.porNumero[n].productos.some((p) => p.reciben.indexOf(idDe) !== -1 && p.pda.indexOf(2) !== -1));
	ok("plan: el alumno de 2° de Morado y Triángulos tiene PDA de 2° en las 15 sesiones", [deSegundo.length, conDos.length], [1, 15]);
	// Si en una sesión se queda sin PDA de 2° (como el plan de antes), el plan no cuadra
	const viejo = JSON.parse(JSON.stringify(plan));
	viejo.sesiones[1].productos.find((p) => p.para.grupo === "Morado").pda = [1];
	viejo.sesiones[14].productos.find((p) => p.para.grupo === "Triángulos").pda = [1];
	ok("plan: con Morado (S1) y Triángulos (S14) solo de 1°, el alumno de 2° queda sin PDA de su grado y el plan no cuadra",
		C.productosDelPlan(viejo, sesionesDos, ficticios, porClave, [1, 2]).errores.map((e) => e.split(":")[0] + (e.indexOf(deSegundo[0] + " (2°)") !== -1 && /sin PDA de su grado/.test(e) ? " ok" : " otro")),
		["Sesión 1 ok", "Sesión 14 ok"]);
	ok("plan S13: Morado y Naranja dicen lo que pide el criterio («hace al menos una pregunta»)",
		S[13].productos.filter((p) => /Morado|Naranja/.test(p.para.grupo || "")).map((p) => /hace al menos una pregunta/.test(p.nombre)), [true, true]);
	ok("plan: ningún nombre pasa de 120 letras", Object.keys(S).reduce((t, n) => t.concat(S[n].productos.filter((p) => p.nombre.length > 120)), []).length, 0);
}

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
