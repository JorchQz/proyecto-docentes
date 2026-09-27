/*
	scripts/cargar-pp-niveles.js — las reglas del plan de carga por grupo de trabajo, sin base de
	datos (decisiones de Jorge del 2026-09-27, PP-NIVELES). Datos ficticios (el plan real, con
	nombres de alumnos, vive en docs/referencia/, fuera de git).
	  - Cada nombre de pila del plan encuentra a UN alumno de su grado; los activos quedan cubiertos.
	  - La asignación de cada producto (grados + incluir/excluir) es la de Hoy y da exactamente sus
	    alumnos: Morado (1° y 2°) sin grado; Triángulos con un alumno de 2° incluido; solo_grado.
	  - Cada alumno recibe en cada sesión un trabajo ligado a un PDA de SU grado (decisión de Jorge del
	    2026-09-27: el alumno se evalúa siempre con los PDA de su grado). Un trabajo por nivel con un
	    alumno de otro grado se liga también a los PDA de ese grado ("pda": [1, 2]); si no, no se carga.
	    Con el plan real (si está en esta computadora): el alumno de 2° de Morado y Triángulos recibe en
	    las 15 sesiones un trabajo con PDA de 2°, y quitárselo en cualquiera detiene la carga.
	  - Los pasos por grupo de trabajo se mueven a diferenciado sin inventar texto.
	  - Recursos: carpeta de la sesión y anexos por Drive; los libros se quedan.
	  - La capa de simulación: lo "escrito" se lee, la base no se toca.

	node pruebas/cargar-pp-niveles.test.js
*/

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
function lanza(fn) { try { fn(); return ""; } catch (e) { return e.message; } }

const C = require("../scripts/cargar-pp-niveles.js");

const plan = {
	alumnos: {
		"Ana": { grado: 1, busca: "ANA" }, "José": { grado: 1, busca: "N N JOSE" }, "Beto": { grado: 1, busca: "BETO" },
		"Diego": { grado: 2, busca: "DIEGO" }, "Tomás": { grado: 2, busca: "TOMAS" }, "Raúl": { grado: 2, busca: "RAUL" },
	},
	agrupaciones: {
		lectoescritura: { Morado: ["Ana", "Diego"], Naranja: ["José", "Beto"], Azul: ["Tomás", "Raúl"] },
		matematicas: { "Círculos": ["Ana"], "Triángulos": ["José", "Beto", "Diego"], Cuadrados: ["Tomás", "Raúl"] },
	},
	drive: { carpetas_por_sesion: { 1: "carpeta1" } },
	anexos: { "ANX-2627-PP-1-2-NIVELES-S01-01": { id: "archivo1", titulo: "Organización de grupos" } },
};
const alumnos = [
	{ id: "a1", grado: 1, nombre_completo: "RIOS LUNA ANA", num_lista: 1 },
	{ id: "a2", grado: 1, nombre_completo: "N N JOSÉ", num_lista: 2 },
	{ id: "a3", grado: 1, nombre_completo: "MORA JOSE BETO", num_lista: 3 },
	{ id: "b1", grado: 2, nombre_completo: "IBARRA DIEGO", num_lista: 4 },
	{ id: "b2", grado: 2, nombre_completo: "N N TOMÁS", num_lista: 5 },
	{ id: "b3", grado: 2, nombre_completo: "N N RAÚL", num_lista: 6 },
];

// ── Alumnos ──
const r = C.resolverAlumnos(plan, alumnos, null);
ok("cada nombre de pila encuentra a su alumno (sin acentos; «N N JOSE» no confunde a quien se apellida José)",
	[r.errores, Object.keys(r.porClave).map((k) => k + "=" + r.porClave[k].id)], [[], ["Ana=a1", "José=a2", "Beto=a3", "Diego=b1", "Tomás=b2", "Raúl=b3"]]);
const r2 = C.resolverAlumnos(plan, alumnos.concat([{ id: "b4", grado: 2, nombre_completo: "OTRO NIÑO", num_lista: 7 }]), null);
ok("un alumno activo que no está en el plan detiene la carga", r2.errores.length, 1);
const r3 = C.resolverAlumnos(plan, alumnos, { "José": "JOSE" });
ok("un nombre que encuentra a dos alumnos detiene la carga (equivalencias)", r3.errores.some((e) => /José: 2 alumnos/.test(e)), true);

// ── Asignación ──
const A = (para) => C.asignacionDe(para, plan, alumnos, r.porClave, [1, 2]);
const morado = A({ grupo: "Morado" });
ok("Morado (uno de 1° y uno de 2°): sin grado, incluidos uno por uno", [morado.grados, morado.filas], [[], [{ alumno_id: "a1", modo: "incluir" }, { alumno_id: "b1", modo: "incluir" }]]);
ok("…y lo reciben exactamente ellos", C.recibenCon(morado.grados, morado.filas, alumnos), ["a1", "b1"]);
const tri = A({ grupo: "Triángulos" });
ok("Triángulos: 1° sin Ana e incluido Diego de 2°", [tri.grados, tri.filas], [["1"], [{ alumno_id: "a1", modo: "excluir" }, { alumno_id: "b1", modo: "incluir" }]]);
ok("…lo reciben José, Beto y Diego", C.recibenCon(tri.grados, tri.filas, alumnos), ["a2", "a3", "b1"]);
const moradoEti = A({ grupo: "Morado", solo_grado: 1 });
ok("solo_grado: el grupo de trabajo, solo los de ese grado", C.recibenCon(moradoEti.grados, moradoEti.filas, alumnos), ["a1"]);
const segundo = A({ grado: 2 });
ok("por grado: el grado, sin filas", [segundo.grados, segundo.filas], [["2"], []]);
ok("un grupo que no existe es error", /no tiene el grupo/.test(lanza(() => A({ grupo: "Verde" }))), true);

// ── Cada alumno, un trabajo por sesión ligado a un PDA de SU grado ──
const sesionesDos = [{ numero_sesion: 1, campo_formativo: "Lenguajes" }, { numero_sesion: 2, campo_formativo: "Saberes y pensamiento científico" }];
const planPda = (pdaMorado, pdaTri) => Object.assign({}, plan, { sesiones: {
	1: { productos: [
		{ para: { grupo: "Morado" }, pda: pdaMorado, nombre: "Hoja · Morado" },
		{ para: { grupo: "Naranja" }, pda: [1], nombre: "Hoja · Naranja" },
		{ para: { grupo: "Azul" }, pda: [2], nombre: "Hoja · Azul" },
	] },
	2: { productos: [
		{ para: { grupo: "Círculos" }, pda: [1], nombre: "Conteo · Círculos" },
		{ para: { grupo: "Triángulos" }, pda: pdaTri, nombre: "Conteo · Triángulos" },
		{ para: { grupo: "Cuadrados" }, pda: [2], nombre: "Conteo · Cuadrados" },
	] },
} });
const bien = C.productosDelPlan(planPda([1, 2], [1, 2]), sesionesDos, alumnos, r.porClave, [1, 2]);
ok("Morado y Triángulos con los PDA de 1° y de 2°: el plan cuadra (cada uno, un trabajo con PDA de su grado)",
	[bien.errores, bien.porNumero[1].productos.map((p) => p.reciben.length), bien.porNumero[2].productos.map((p) => p.pda)], [[], [2, 2, 2], [[1], [1, 2], [2]]]);
const sinSuPda = C.productosDelPlan(planPda([1], [1]), sesionesDos, alumnos, r.porClave, [1, 2]);
ok("Morado y Triángulos solo con PDA de 1°: Diego (2°) queda sin PDA de su grado en las dos sesiones y no se carga",
	sinSuPda.errores.map((e) => e.replace(/«.*»/, "«…»")), ["Sesión 1: Diego (2°) recibe «…», ligado a PDA de 1°: sin PDA de su grado", "Sesión 2: Diego (2°) recibe «…», ligado a PDA de 1°: sin PDA de su grado"]);
ok("basta un trabajo sin PDA de su grado para que no se cargue (Triángulos solo de 1°)",
	C.productosDelPlan(planPda([1, 2], [1]), sesionesDos, alumnos, r.porClave, [1, 2]).errores.length, 1);
const doble = planPda([1, 2], [1, 2]);
doble.sesiones[1].productos.push({ para: { grado: 2 }, pda: [2], nombre: "Extra · 2°" });
ok("un alumno con dos trabajos en la sesión sigue siendo error", C.productosDelPlan(doble, sesionesDos, alumnos, r.porClave, [1, 2]).errores.filter((e) => /recibe 2 trabajos/.test(e)).length, 3);

// ── El plan real (docs/referencia/pp-niveles-plan.json, fuera del repositorio porque trae
// nombres): si está en esta computadora, cada alumno recibe en cada sesión un trabajo con PDA de
// su grado. Alumnos ficticios (solo las claves del plan y su grado) ──
const fs = require("fs");
const path = require("path");
const archivoPlan = path.join(__dirname, "..", "docs", "referencia", "pp-niveles-plan.json");
if (!fs.existsSync(archivoPlan)) {
	console.log("(se salta el plan real: no está docs/referencia/pp-niveles-plan.json en esta computadora)");
} else {
	const real = JSON.parse(fs.readFileSync(archivoPlan, "utf8"));
	const claves = Object.keys(real.alumnos);
	const ficticios = claves.map((k, i) => ({ id: "x" + i, grado: real.alumnos[k].grado, nombre_completo: "ALUMNO " + i, num_lista: i + 1 }));
	const porClaveReal = {};
	claves.forEach((k, i) => { porClaveReal[k] = ficticios[i]; });
	const sesionesReal = Object.keys(real.sesiones).map((n) => ({ numero_sesion: Number(n), campo_formativo: "Lenguajes" }));
	const resReal = C.productosDelPlan(real, sesionesReal, ficticios, porClaveReal, [1, 2]);
	ok("plan real: 16 alumnos, 15 sesiones, cada alumno con un trabajo por sesión ligado a un PDA de su grado",
		[claves.length, sesionesReal.length, resReal.errores], [16, 15, []]);
	// El alumno de 2° que trabaja con los de 1° en Morado y Triángulos (anexo S01-01)
	const deSegundo = (real.agrupaciones.lectoescritura.Morado || []).filter((k) => Number(real.alumnos[k].grado) === 2);
	const enTri = deSegundo.filter((k) => (real.agrupaciones.matematicas["Triángulos"] || []).indexOf(k) !== -1);
	const idDe = deSegundo.length === 1 ? porClaveReal[deSegundo[0]].id : null;
	const suPda = Object.keys(resReal.porNumero).map((n) => {
		const p = resReal.porNumero[n].productos.find((x) => x.reciben.indexOf(idDe) !== -1);
		return p ? p.pda.indexOf(2) !== -1 : false;
	});
	ok("plan real: el alumno de 2° de Morado (también en Triángulos) recibe en las 15 sesiones un trabajo con PDA de 2°",
		[deSegundo.length, enTri.length, suPda.filter(Boolean).length], [1, 1, 15]);
	// Quitarle el PDA de 2° en cualquier sesión detiene la carga
	const sinDos = Object.keys(real.sesiones).filter((n) => {
		const copia = JSON.parse(JSON.stringify(real));
		const p = copia.sesiones[n].productos.find((x) => resReal.porNumero[n].productos.some((y) => y.nombre === x.nombre && y.reciben.indexOf(idDe) !== -1));
		p.pda = p.pda.filter((g) => g !== 2);
		if (!p.pda.length) p.pda = [1];
		const e = C.productosDelPlan(copia, sesionesReal, ficticios, porClaveReal, [1, 2]).errores;
		return e.some((x) => x.indexOf("Sesión " + n + ": " + deSegundo[0] + " (2°)") === 0 && /sin PDA de su grado/.test(x));
	});
	ok("plan real: sin el PDA de 2° en el trabajo de ese alumno, en cualquiera de las 15 sesiones, el plan no cuadra", sinDos.length, 15);
}

// ── Texto por grupo de trabajo ──
const act = { mode: "todos", todos: ["Paso común.", "Grupo Azul: escribe su nombre.", "Trabajo por grupos: el Grupo Morado colorea; el Grupo Naranja traza.", "Cierre."], diferenciado: null };
const nuevo = C.textoPorGrupo(act, [
	{ paso: 2, llave: "Azul", quitar: "Grupo Azul: " },
	{ paso: 3, empieza: "Trabajo por grupos:", grupos: [{ llave: "Morado", texto: "Colorea." }, { llave: "Naranja", texto: "Traza." }] },
], ["Morado", "Naranja", "Azul"], "Sesión 1");
ok("los pasos de cada grupo pasan a diferenciado (sin su rótulo) y los comunes se quedan en orden", nuevo,
	{ mode: "todos", todos: ["Paso común.", "Cierre."], diferenciado: { Azul: ["Escribe su nombre."], Morado: ["Colorea."], Naranja: ["Traza."] }, orden_grupos: ["Morado", "Naranja", "Azul"] });
ok("un paso que no empieza como se esperaba detiene la carga",
	/no empieza como se esperaba/.test(lanza(() => C.textoPorGrupo(act, [{ paso: 1, llave: "Azul", quitar: "Grupo Azul: " }], [], "S1"))), true);
ok("un texto con palabras que no están en la planeación detiene la carga",
	/palabras que no están/.test(lanza(() => C.textoPorGrupo(act, [{ paso: 3, empieza: "Trabajo", grupos: [{ llave: "Morado", texto: "Colorea con crayolas." }] }], [], "S1"))), true);
ok("con 'antes': el rótulo del grupo se cambia por el dato que traía",
	C.textoPorGrupo({ mode: "todos", todos: ["Círculos (hasta 10): cuentan granos."] }, [{ paso: 1, llave: "Círculos", quitar: "Círculos (hasta 10): ", antes: "Hasta 10. " }], [], "S2").diferenciado,
	{ "Círculos": ["Hasta 10. Cuentan granos."] });

// ── Recursos ──
ok("recursos: la carpeta de la sesión, cada anexo por Drive y los libros igual", C.recursosDeSesion({ links: [
	{ url: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", nombre: "Libro" },
	{ url: "https://jissez.com/tienda/anexo.html?aula=1-2&pr=PP-NIVELES&a=ANX-2627-PP-1-2-NIVELES-S01-01", nombre: "ANX" },
], archivos: [] }, 1, plan), { links: [
	{ titulo: "Anexos de la sesión 1 (carpeta de Drive)", url: "https://drive.google.com/drive/folders/carpeta1" },
	{ url: "https://libros.conaliteg.gob.mx/2025/P1MLA.htm#page/100", nombre: "Libro" },
	{ titulo: "S01-01 · Organización de grupos", url: "https://drive.google.com/file/d/archivo1/view" },
], archivos: [] });
ok("un anexo que no está en el plan detiene la carga",
	/no tiene el anexo/.test(lanza(() => C.recursosDeSesion({ links: [{ url: "https://jissez.com/tienda/anexo.html?a=ANX-X-S09-09" }] }, 2, plan))), true);

// ── Capa de simulación: lo escrito se lee y la base no se toca ──
(async () => {
	const escrituras = [];
	const cliente = {
		query(sql) {
			if (/^\s*(insert|update|delete)/i.test(sql)) escrituras.push(sql);
			if (/information_schema/.test(sql)) return Promise.resolve({ rows: [{ column_name: "id", data_type: "uuid" }, { column_name: "sesion_id", data_type: "uuid" }, { column_name: "nombre", data_type: "text" }] });
			return Promise.resolve({ rows: [] });
		},
	};
	const sb = C.sbDesdePg(cliente, { simular: true, memoria: { dosificacion_proyectos: [{ id: "d1", nombre_proyecto: "P" }] } });
	const ins = await sb.from("productos_sesion").insert([{ sesion_id: "s1", nombre: "Uno" }]).select("id, sesion_id, nombre");
	const leido = await sb.from("productos_sesion").select("id, nombre").in("sesion_id", ["s1"]);
	const dos = await sb.from("dosificacion_proyectos").select("*").eq("id", "d1").single();
	await sb.rpc("guardar_asignacion_producto", { p_producto: ins.data[0].id, p_filas: [{ alumno_id: "a1", modo: "incluir" }] });
	const asig = await sb.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo").eq("producto_sesion_id", ins.data[0].id);
	ok("simulación: lo insertado se lee, la dosificación sale de memoria y la base no recibe escrituras",
		[ins.data.length, leido.data.map((x) => x.nombre), dos.data.nombre_proyecto, asig.data.map((x) => x.modo), escrituras.length], [1, ["Uno"], "P", ["incluir"], 0]);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log("FALLA " + e.message); process.exit(1); });
