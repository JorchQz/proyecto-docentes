/*
	Exámenes de Mi Salón (decisión de Jorge, 2026-09-26): los dos caminos (solo resultados y
	examen propio) de punta a punta en las reglas (js/examen-modelo.js) y en el motor
	(js/motor-calificacion.js), la migración b18 (RLS y borrar la cuenta) y la pantalla (sin el
	catálogo de la tienda).

	node pruebas/examen-salon.test.js
*/
const fs = require("fs");
const path = require("path");
global.window = {};
require("../js/campos-formativos.js");
window.AlcanceHoy = require("../js/alcance-hoy.js");
const M = require("../js/motor-calificacion.js");
window.MotorCalificacion = M;
const X = require("../js/examen-modelo.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const a = JSON.stringify(real), b = JSON.stringify(esperado), bien = a === b;
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + a + (bien ? "" : " (esperado " + b + ")"));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// ── Tipos de pregunta ───────────────────────────────────────────────────────────
const om = X.validarPregunta({ tipo: "opcion_multiple", campo: "SAB", enunciado: " ¿Cuánto es 2 + 2? ", opciones: ["3", " 4 ", "5", ""], clave: "b" });
ok("opción múltiple válida: sin la opción vacía del final y clave en mayúscula", [om.ok, om.fila.opciones, om.fila.clave, om.fila.enunciado], [true, ["3", "4", "5"], "B", "¿Cuánto es 2 + 2?"]);
ok("opción múltiple: clave fuera de las opciones", X.validarPregunta({ tipo: "opcion_multiple", campo: "SAB", enunciado: "x", opciones: ["1", "2"], clave: "C" }).ok, false);
ok("opción múltiple: 1 opción no basta", X.validarPregunta({ tipo: "opcion_multiple", campo: "SAB", enunciado: "x", opciones: ["1"], clave: "A" }).error, "Escribe al menos 2 opciones.");
ok("opción múltiple: 6 opciones no caben", X.validarPregunta({ tipo: "opcion_multiple", campo: "SAB", enunciado: "x", opciones: ["1", "2", "3", "4", "5", "6"], clave: "A" }).ok, false);
ok("opción múltiple: hueco entre opciones", X.validarPregunta({ tipo: "opcion_multiple", campo: "SAB", enunciado: "x", opciones: ["1", "", "3"], clave: "A" }).ok, false);
const vf = X.validarPregunta({ tipo: "verdadero_falso", campo: "ETI", enunciado: "El sol es una estrella", clave: "v" });
ok("verdadero o falso: clave V, sin opciones", [vf.ok, vf.fila.clave, vf.fila.opciones], [true, "V", null]);
ok("verdadero o falso sin clave", X.validarPregunta({ tipo: "verdadero_falso", campo: "ETI", enunciado: "x" }).ok, false);
const comp = X.validarPregunta({ tipo: "completar", campo: "LEN", enunciado: "El plural de pez es ____", clave: " peces " });
ok("completar: respuesta esperada opcional", [comp.ok, comp.fila.clave, X.validarPregunta({ tipo: "completar", campo: "LEN", enunciado: "x" }).fila.clave], [true, "peces", null]);
ok("abierta: sin clave", X.validarPregunta({ tipo: "abierta", campo: "DHL", enunciado: "¿Qué harías?" }).fila.clave, null);
ok("sin campo formativo / sin enunciado / sin tipo", [
	X.validarPregunta({ tipo: "abierta", enunciado: "x" }).ok, X.validarPregunta({ tipo: "abierta", campo: "LEN", enunciado: "  " }).ok, X.validarPregunta({ campo: "LEN", enunciado: "x" }).ok,
], [false, false, false]);
ok("la opción múltiple va primero y se dice sugerida", [X.TIPOS[0].clave, /Sugerida/.test(X.TIPOS[0].ayuda)], ["opcion_multiple", true]);
const muchas = Array.from({ length: 63 }, (_, i) => ({ tipo: i % 2 ? "opcion_multiple" : "verdadero_falso" }));
ok("límite de la hoja: 63 automáticas, pero se puede agregar una abierta", [X.puedeAgregar(muchas, "opcion_multiple").ok, X.puedeAgregar(muchas, "abierta").ok], [false, true]);

// ── Captura de resultados ───────────────────────────────────────────────────────
ok("celda: número válido", X.leerNumero(" 7 ", 10), { ok: true, vacio: false, valor: 7, error: "" });
ok("celda vacía = borrar", X.leerNumero("", 10).vacio, true);
ok("celda: aciertos > preguntas se rechaza", X.leerNumero("11", 10).error, "No puede pasar de 10 (las preguntas del campo).");
ok("celda: negativos, decimales y letras se rechazan", ["-1", "7.5", "siete"].map((t) => X.leerNumero(t, 10).ok), [false, false, false]);
ok("campos: al menos uno", X.validarCampos({ LEN: "", SAB: "0" }).ok, false);
ok("campos: 10 y 8", X.validarCampos({ LEN: "10", SAB: " 8 ", ETI: "" }).campos, { LEN: 10, SAB: 8 });
ok("campos: más de 200 no", X.validarCampos({ LEN: "201" }).ok, false);
const res = [{ campo: "LEN", aciertos: 9 }, { campo: "SAB", aciertos: 3 }];
ok("cambiar preguntas: no bajar de lo que ya sacó un alumno", X.cambioDeCampos({ LEN: 10, SAB: 8 }, { LEN: 8, SAB: 8 }, res).ok, false);
ok("cambiar preguntas: subir ajusta; quitar un campo con capturas avisa", X.cambioDeCampos({ LEN: 10, SAB: 8 }, { LEN: 12 }, res), { ok: true, error: "", quitar: ["SAB"], ajustar: ["LEN"] });

// ── Cálculo por campo (motor, puro) ─────────────────────────────────────────────
const P = (id, tipo, campo, clave) => ({ id, examen_id: "ex2", tipo, campo, clave });
const preguntas = [P("p1", "opcion_multiple", "SAB", "B"), P("p2", "opcion_multiple", "SAB", "A"), P("p3", "verdadero_falso", "ETI", "F"),
	P("p4", "completar", "LEN", "peces"), P("p5", "abierta", "LEN", null), P("p6", "opcion_multiple", "SAB", "C")];
const R = (p, a, extra) => Object.assign({ examen_id: "ex2", pregunta_id: p, alumno_id: a }, extra);
const respuestas = [
	R("p1", "ana", { respuesta: "B" }), R("p2", "ana", { respuesta: "*" }), R("p3", "ana", { respuesta: "F" }),
	R("p4", "ana", { resultado: "parcial" }), R("p5", "ana", { resultado: null }), R("p6", "ana", { respuesta: null }),
	R("p1", "beto", { respuesta: "b" }),
];
ok("puntos: clave, doble marca 0, vacía 0, parcial 0.5, sin calificar null", [
	M.puntosRespuestaExamen(preguntas[0], respuestas[0]), M.puntosRespuestaExamen(preguntas[1], respuestas[1]), M.puntosRespuestaExamen(preguntas[5], respuestas[5]),
	M.puntosRespuestaExamen(preguntas[3], respuestas[3]), M.puntosRespuestaExamen(preguntas[4], respuestas[4]), M.puntosRespuestaExamen(preguntas[0], null),
], [1, 0, 0, 0.5, null, null]);
const ex2 = { id: "ex2", modo: "propio", grados: [3, 4] };
ok("examen propio por campo (solo lo capturado; la abierta sin calificar no cuenta)", M.aciertosExamenSalon(ex2, { preguntas, respuestas }, "ana"),
	{ SAB: { aciertos: 1, preguntas: 3 }, ETI: { aciertos: 1, preguntas: 1 }, LEN: { aciertos: 0.5, preguntas: 1 } });
ok("alumno con una sola pregunta capturada: solo esa", M.aciertosExamenSalon(ex2, { preguntas, respuestas }, "beto"), { SAB: { aciertos: 1, preguntas: 1 } });
const ex1 = { id: "ex1", modo: "resultados", grados: [3], campos_resultados: { LEN: 10, SAB: 8 } };
const resultados = [{ examen_id: "ex1", alumno_id: "ana", campo: "LEN", preguntas: 10, aciertos: 7 }, { examen_id: "ex1", alumno_id: "ana", campo: "SAB", preguntas: 8, aciertos: 8 }];
ok("solo resultados por campo", M.aciertosExamenSalon(ex1, { resultados }, "ana"), { LEN: { aciertos: 7, preguntas: 10 }, SAB: { aciertos: 8, preguntas: 8 } });
ok("resultado del alumno: total y porcentaje", X.resultadoAlumno(ex1, { resultados }, "ana"), { porCampo: { LEN: { aciertos: 7, preguntas: 10 }, SAB: { aciertos: 8, preguntas: 8 } }, aciertos: 15, preguntas: 18, porcentaje: 15 / 18 * 100 });

// ── Estado del examen ──────────────────────────────────────────────────────────
const alumnos = [{ id: "ana", grado: 3, estatus: "activo" }, { id: "beto", grado: 4, estatus: "activo" }, { id: "baja", grado: 3, estatus: "baja" }, { id: "quinto", grado: 5, estatus: "activo" }];
ok("alumnos del examen: activos de sus grados", X.alumnosDelExamen(alumnos, ex2).map((a) => a.id), ["ana", "beto"]);
ok("sin aplicar", X.estadoExamen(ex1, { resultados: [] }, alumnos).clave, "sin_aplicar");
ok("solo resultados: calificado cuando todos tienen todos sus campos", X.estadoExamen(ex1, { resultados }, alumnos), { clave: "calificado", texto: "Calificado", capturados: 1, completos: 1, total: 1, pendientesMano: 0 });
ok("examen propio: en revisión, con la abierta de Ana pendiente", X.estadoExamen(ex2, { preguntas, respuestas }, alumnos), { clave: "en_revision", texto: "En revisión", capturados: 2, completos: 0, total: 2, pendientesMano: 3 });
ok("filas de una hoja escaneada (doble, vacía y letra)", X.filasDeLectura(ex2, "ana", [{ id: "p1", letra: "B" }, { id: "p2", letra: "*" }, { id: "p6", letra: null }, { id: "p3", letra: "Z" }], "escaneo").map((f) => [f.pregunta_id, f.respuesta, f.origen]),
	[["p1", "B", "escaneo"], ["p2", "*", "escaneo"], ["p6", null, "escaneo"], ["p3", null, "escaneo"]]);
const html = X.examenHTML({ titulo: "Examen <T1>", instrucciones: "Lee" }, [{ tipo: "opcion_multiple", enunciado: "¿2+2?", opciones: ["3", "4"] }, { tipo: "abierta", enunciado: "Explica" }], { escuela: "Esc" });
ok("examen imprimible: escapado, opciones con letra, preguntas que no se parten", [html.includes("Examen &lt;T1&gt;"), html.includes("B)</span> 4"), (html.match(/imp-pregunta/g) || []).length, /hoja de respuestas/.test(html)], [true, true, 2, true]);

// ── Motor: los dos caminos y el modelo anterior, con un Supabase falso ─────────────
const MAESTRO = "m";
const DATOS = {
	maestro_ajustes: [{ peso_tareas: 0, peso_trabajos: 0, peso_participacion: 0, peso_conducta: 0, peso_examen: 100 }],
	grupos: [{ id: "g1", created_at: "2026-08-01T15:00:00+00:00" }],
	proyectos: [], sesiones: [], productos_sesion: [], calificaciones: [], registro_diario: [], asistencias: [],
	alumnos: [{ id: "ana", created_at: "2026-08-02T00:00:00Z" }, { id: "beto", created_at: "2026-08-02T00:00:00Z" }, { id: "caro", created_at: "2026-08-02T00:00:00Z" }],
	// Modelo anterior: examen de 4° con 2 preguntas (LEN y SAB)
	examenes: [{ id: "viejo", maestro_id: MAESTRO, grupo_id: "g1", trimestre: 1, grado: 4, preguntas_ids: ["b1", "b2"], valor_total: 10, total_preguntas: 2, created_at: "2026-09-01T00:00:00Z" }],
	banco_preguntas: [{ id: "b1", campo_formativo: "Lenguajes" }, { id: "b2", campo_formativo: "Saberes y Pensamiento Científico" }],
	respuestas_examen: [{ examen_id: "viejo", alumno_id: "beto", pregunta_id: "b1", puntos_obtenidos: 5, created_at: "2026-09-02T00:00:00Z" },
		{ examen_id: "viejo", alumno_id: "beto", pregunta_id: "b2", puntos_obtenidos: 0, created_at: "2026-09-02T00:00:00Z" }],
	examenes_grupo: [
		Object.assign({ maestro_id: MAESTRO, grupo_id: "g1", trimestre: 1 }, ex1),
		Object.assign({ maestro_id: MAESTRO, grupo_id: "g1", trimestre: 1 }, ex2),
		{ id: "otroTrim", maestro_id: MAESTRO, grupo_id: "g1", trimestre: 2, modo: "resultados", grados: [3] },
		{ id: "otroGrupo", maestro_id: MAESTRO, grupo_id: "g2", trimestre: 1, modo: "resultados", grados: [3] },
	],
	examen_preguntas: preguntas,
	examen_respuestas: respuestas,
	examen_resultados: resultados.concat([
		{ examen_id: "otroTrim", alumno_id: "ana", campo: "LEN", preguntas: 10, aciertos: 0 },
		{ examen_id: "otroGrupo", alumno_id: "ana", campo: "LEN", preguntas: 10, aciertos: 0 },
	]),
};
function consulta(tabla) {
	const filtros = [];
	let orden = null, desde = 0, hasta = Infinity;
	const q = {
		select() { return q; },
		eq(c, v) { filtros.push((f) => String(f[c]) === String(v)); return q; },
		in(c, vs) { const s = vs.map(String); filtros.push((f) => s.indexOf(String(f[c])) !== -1); return q; },
		gte(c, v) { filtros.push((f) => f[c] >= v); return q; },
		lte(c, v) { filtros.push((f) => f[c] <= v); return q; },
		order(c, o) { orden = { c, asc: !(o && o.ascending === false) }; return q; },
		range(a, b) { desde = a; hasta = b; return q.resolver(); },
		maybeSingle() { return Promise.resolve({ data: (DATOS[tabla] || [])[0] || null, error: null }); },
		resolver() {
			if (!DATOS[tabla]) return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } });
			let filas = DATOS[tabla].filter((f) => filtros.every((fn) => fn(f)));
			if (orden) filas = filas.slice().sort((x, y) => (x[orden.c] < y[orden.c] ? -1 : x[orden.c] > y[orden.c] ? 1 : 0) * (orden.asc ? 1 : -1));
			return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
		},
		then(bien, mal) { return q.resolver().then(bien, mal); },
	};
	return q;
}
const sb = { from: consulta, rpc(n, args) { return Promise.resolve({ data: args.p_porcentajes.map((p) => (p >= 90 ? 10 : p >= 60 ? 8 : 5)), error: null }); } };

(async () => {
	const r = await M.cargarYCalcularGrupo(sb, { maestroId: MAESTRO, grupoId: "g1", trimestre: 1, alumnos: [{ id: "ana", grado: 3 }, { id: "beto", grado: 4 }, { id: "caro", grado: 3 }] });
	const ex = (id, c) => { const x = r.porAlumno[id].porCampo[c].rubros.examen; return [Math.round(x.obtenido * 1000) / 1000, x.maximo]; };
	// Ana (3°): resultados LEN 7/10 + propio LEN 0.5/1 = 7.5/11; SAB 8/8 + 1/3 = 9/11; ETI 1/1
	ok("Ana LEN: los dos caminos suman (7 + 0.5) / (10 + 1)", ex("ana", "LEN"), [Math.round(7.5 / 11 * 1000) / 1000, 1]);
	ok("Ana SAB: (8 + 1) / (8 + 3)", ex("ana", "SAB"), [Math.round(9 / 11 * 1000) / 1000, 1]);
	ok("Ana ETI: 1 / 1", ex("ana", "ETI"), [1, 1]);
	ok("Ana DHL: sin examen en ese campo", ex("ana", "DHL"), [0, 0]);
	ok("otro trimestre y otro grupo no cuentan (LEN no bajó a 0)", r.porAlumno.ana.porCampo.LEN.rubros.examen.fraccion > 0.6, true);
	ok("Ana: examen exacto, no aproximado", r.porAlumno.ana.examenAproximado, false);
	ok("Ana LEN: con peso de examen 100, el porcentaje es el del examen", Math.round(r.porAlumno.ana.porCampo.LEN.porcentaje * 100) / 100, Math.round(7.5 / 11 * 10000) / 100);
	ok("Ana LEN: la calificación sale de SQL (rpc)", r.porAlumno.ana.porCampo.LEN.calificacionPropuesta, 8);
	// Beto (4°): modelo anterior LEN 1/1 y SAB 0/1; el propio es de 3° y 4°: SAB p1 = 1/1 → SAB (0 + 1) / (1 + 1)
	ok("Beto LEN: modelo anterior se sigue leyendo", ex("beto", "LEN"), [1, 1]);
	ok("Beto SAB: anterior 0/1 + propio 1/1", ex("beto", "SAB"), [0.5, 1]);
	ok("Beto: aproximado (entró el modelo anterior)", r.porAlumno.beto.examenAproximado, true);
	// Caro (3°): nada capturado → sin examen, el rubro no entra
	ok("Caro sin capturas: sin examen y sin porcentaje", [ex("caro", "LEN"), r.porAlumno.caro.porCampo.LEN.porcentaje], [[0, 0], null]);

	// Sin la migración b18 en la base: el motor sigue con lo anterior, sin tronar
	const guardado = DATOS.examenes_grupo;
	delete DATOS.examenes_grupo;
	const r2 = await M.cargarYCalcularGrupo(sb, { maestroId: MAESTRO, grupoId: "g1", trimestre: 1, alumnos: [{ id: "beto", grado: 4 }] });
	ok("sin la tabla nueva: el examen anterior sigue", [r2.porAlumno.beto.porCampo.LEN.rubros.examen.fraccion, r2.porAlumno.beto.examenAproximado], [1, true]);
	DATOS.examenes_grupo = guardado;

	// ── Migración b18 ─────────────────────────────────────────────────────────────
	const sql = leer("supabase/mi_salon_b18_examenes_2026-09.sql");
	const codigo = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
	const TABLAS = ["examenes_grupo", "examen_preguntas", "examen_resultados", "examen_respuestas"];
	ok("aditiva: sin drop table, sin borrar columnas, sin tocar tablas viejas", [/drop\s+table|drop\s+column|truncate/i.test(codigo), /alter table public\.(examenes|respuestas_examen|banco_preguntas)\b/i.test(codigo)], [false, false]);
	TABLAS.forEach((t) => {
		const rls = new RegExp("alter table public\\." + t + " enable row level security").test(codigo);
		const anon = new RegExp("revoke all on public\\." + t + " from anon").test(codigo);
		const pols = ["select", "insert", "update", "delete"].every((cmd) => new RegExp("create policy \\w+ on public\\." + t + "\\s+for " + cmd + " to authenticated", "i").test(codigo));
		const uid = new RegExp("create policy \\w+ on public\\." + t + "[\\s\\S]*?\\(select auth\\.uid\\(\\)\\) = maestro_id").test(codigo);
		ok(t + ": RLS, sin anónimo, 4 políticas por maestro_id", [rls, anon, pols, uid], [true, true, true, true]);
	});
	const insResp = (codigo.match(/create policy examen_respuestas_insert_propias[\s\S]*?\);\s*end if;/) || [""])[0];
	ok("respuestas: la pregunta es de ESE examen y el alumno del mismo grupo", [/p\.examen_id = e\.id/.test(insResp), /a\.grupo_id = e\.grupo_id/.test(insResp), /e\.modo = 'propio'/.test(insResp)], [true, true, true]);
	const insRes = (codigo.match(/create policy examen_resultados_insert_propios[\s\S]*?\);\s*end if;/) || [""])[0];
	ok("resultados: alumno del mismo grupo y examen de modo 'resultados'", [/a\.grupo_id = e\.grupo_id/.test(insRes), /e\.modo = 'resultados'/.test(insRes)], [true, true]);
	ok("la base exige 0 <= aciertos <= preguntas y 2 a 5 opciones con clave", [/check \(aciertos between 0 and preguntas\)/.test(codigo), /jsonb_array_length\(opciones\) between 2 and 5/.test(codigo)], [true, true]);
	// delete_own_account: todo lo de antes y lo nuevo, con guardas
	const fn = (codigo.match(/create or replace function public\.delete_own_account\(\)[\s\S]*?end \$\$;/) || [""])[0];
	const previas = leer("supabase/jissez_interes_secciones_2026-09.sql").match(/create or replace function public\.delete_own_account\(\)[\s\S]*?end \$\$;/)[0];
	const borradas = (s) => [...s.matchAll(/delete from public\.(\w+) where/g)].map((m) => m[1]);
	const faltan = borradas(previas).filter((t) => borradas(fn).indexOf(t) === -1);
	ok("delete_own_account conserva todo lo que ya borraba (b13, b14, b15, interes_secciones)", faltan, []);
	ok("delete_own_account borra las 4 tablas nuevas con guarda to_regclass", TABLAS.every((t) => new RegExp("to_regclass\\('public\\." + t + "'\\) is not null then\\s+execute 'delete from public\\." + t + " where maestro_id = \\$1'").test(fn)), true);
	ok("delete_own_account: security definer y search_path vacío", [/security definer/.test(fn), /set search_path = ''/.test(fn)], [true, true]);

	// b18a: una plantilla del catálogo (maestro_id null) ya no se puede reclamar
	const b18a = leer("supabase/mi_salon_b18a_examenes_plantillas_2026-09.sql").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
	const upd = (b18a.match(/create policy "examenes editar propios"[\s\S]*?;/) || [""])[0];
	ok("b18a: quita «reclamar/editar» y la nueva UPDATE es solo de lo propio (sin maestro_id is null)",
		[/drop policy if exists "examenes reclamar\/editar" on public\.examenes/.test(b18a), /for update/.test(upd), /using \(maestro_id = \(select auth\.uid\(\)\)\)/.test(upd), /is null/i.test(upd), /delete from|alter table|update public\./i.test(b18a)],
		[true, true, true, false, false]);
	ok("ninguna pantalla actualiza la tabla vieja de exámenes", ["js/examen.js", "js/examen-propio.js", "js/examen-anterior.js"].some((f) => /from\("examenes"\)\s*\.update/.test(leer(f))), false);

	// ── Pantalla: sin el catálogo de la tienda ──────────────────────────────────────
	const js = leer("js/examen.js"), htmlPag = leer("examen.html");
	ok("examen.js ya no lista ni aplica plantillas del catálogo", [/maestro_id\.is\.null/.test(js), /Aplicar este examen/.test(js), /banco_preguntas/.test(js)], [false, false, false]);
	ok("la pantalla ofrece los dos caminos", [/Solo subir resultados/.test(js), /Crear mi examen/.test(js)], [true, true]);
	const orden = ["js/motor-calificacion.js", "js/examen-modelo.js", "js/examen-hoja.js", "js/examen-lector.js", "js/examen.js"].map((s) => htmlPag.indexOf('src="' + s + '"'));
	ok("examen.html carga motor, modelo, hoja y lector antes de la pantalla", orden.every((v, i) => v > 0 && (i === 0 || v > orden[i - 1])), true);
	ok("examen.html carga alcance-hoy y campos formativos antes del motor", htmlPag.indexOf('src="js/alcance-hoy.js"') > 0 && htmlPag.indexOf('src="js/alcance-hoy.js"') < orden[0] && htmlPag.indexOf('src="js/campos-formativos.js"') > 0, true);
	const libs = [...(leer("js/examen.js") + leer("js/examen-propio.js") + leer("js/examen-camara.js")).matchAll(/https:\/\/[^"'\s]+\.js/g)].map((m) => m[0]);
	ok("librerías solo de jsDelivr con versión fija", libs.length >= 2 && libs.every((u) => /^https:\/\/cdn\.jsdelivr\.net\/npm\/[\w-]+@\d+\.\d+\.\d+\//.test(u)), true);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODAS PASAN");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
