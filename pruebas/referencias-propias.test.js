/*
	Referencias propias (decisión 4 de Jorge, supabase/mi_salon_b9_referencias_propias_2026-09.sql).

	Las políticas de escritura solo revisaban maestro_id = auth.uid(); una fila propia podía
	apuntar al alumno, grupo, proyecto o sesión de otro maestro. La migración b9 agrega, por
	tabla, dos políticas RESTRICTIVE (insert y update) que exigen que cada referencia sea propia.
	Esta prueba lee el archivo SQL y revisa:
	  - que cada tabla del inventario tenga su política de insert y de update, restrictivas, y
	    que cada una revise TODAS las columnas de referencia de esa tabla con la función correcta;
	  - que las funciones ref_* sean security invoker, stable y con search_path fijo;
	  - que la migración sea aditiva (solo borra sus propias políticas para poder reaplicarse) y
	    no toque la tienda;
	  - que ninguna tabla nueva en supabase/*.sql con alumno_id, grupo_id, proyecto_id, sesion_id,
	    sesion_pda_id, producto_sesion_id o examen_id quede fuera del inventario sin razón.
	La prueba en la base (cada vía rechazada con la sesión QA) está en .qa/constructor-d-rls/vias.js.

	node pruebas/referencias-propias.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

const DIR = path.join(__dirname, "..", "supabase");
const ARCHIVO = path.join(DIR, "mi_salon_b9_referencias_propias_2026-09.sql");
const sql = fs.readFileSync(ARCHIVO, "utf8");
// Sin comentarios de línea, para no contar la consulta de verificación comentada
const codigo = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");

// columna → función que la revisa
const FUNCION = {
	alumno_id: "ref_propia_alumno", grupo_id: "ref_propia_grupo", proyecto_id: "ref_propia_proyecto",
	sesion_id: "ref_propia_sesion", sesion_pda_id: "ref_propia_sesion_pda",
	producto_sesion_id: "ref_propia_producto_sesion", examen_id: "ref_visible_examen",
	producto_final_id: "ref_visible_producto_final",
};

/*
	Inventario (leído de la base de pruebas: llaves foráneas y políticas). Columnas que la
	migración b9 revisa en cada tabla. Las que ya revisaba la política permisiva de siempre
	(p. ej. respuestas_examen.alumno_id) no se repiten.
*/
const INVENTARIO = {
	alumnos: ["grupo_id"],
	asistencias: ["alumno_id", "grupo_id"],
	boleta_trimestral: ["alumno_id"],
	calificaciones: ["alumno_id", "grupo_id", "sesion_id", "proyecto_id", "producto_sesion_id"],
	evaluacion_diagnostica: ["alumno_id", "grupo_id"],
	evaluacion_formativa: ["alumno_id", "sesion_id", "sesion_pda_id"],
	examenes: ["grupo_id"],
	productos_finales: ["grupo_id"],
	productos_sesion: ["sesion_id"],
	producto_sesion_pda: ["sesion_pda_id"],
	proyectos: ["grupo_id"],
	registro_diario: ["alumno_id"],
	respuestas_examen: ["examen_id"],
	sesiones: ["proyecto_id"],
	tareas: ["sesion_id", "proyecto_id", "grupo_id"],
	zz_deprecated_calificacion_tarea: ["alumno_id"],
	zz_deprecated_calificacion_trabajo: ["alumno_id"],
	zz_deprecated_configuracion_calificacion: ["grupo_id"],
	zz_deprecated_diagnosticos: ["alumno_id", "grupo_id"],
	zz_deprecated_entregas_producto_final: ["producto_final_id"],
	zz_deprecated_evaluacion_cuaderno: ["alumno_id", "grupo_id"],
	zz_deprecated_evaluacion_habilidades_basicas: ["alumno_id", "grupo_id"],
	zz_deprecated_participacion_jornada: ["alumno_id", "grupo_id"],
	zz_deprecated_registros_diarios: ["alumno_id", "proyecto_id"],
};

// Tablas con referencias que b9 no toca, con su razón
const EXCEPCIONES = {
	actividades_proyecto: "su política permisiva ya exige que el proyecto sea del maestro",
	proyectos_contenidos: "su política permisiva ya exige que el proyecto sea del maestro",
	sesiones_pda: "su política permisiva ya exige que la sesión (vía proyecto) sea del maestro",
	banco_preguntas: "catálogo compartido: sesion_id apunta a dosificacion_sesiones, solo lectura",
	materiales_sesion: "catálogo compartido (dosificación), solo lectura",
	sesion_links_ltg: "catálogo compartido (dosificación), solo lectura",
	dosificacion_sesion_pdas: "catálogo compartido (dosificación), solo lectura",
	// B14 (supabase/mi_salon_b14_calendario_2026-09.sql): nacen con la revisión en su política
	calendario_ajustes: "sus políticas de insert y update ya exigen que el grupo sea del maestro",
	roles_aseo: "sus políticas de insert y update ya exigen que el grupo sea del maestro y que los alumnos de inicio y de continuación sean suyos y de ese grupo",
};

// 1. Políticas por tabla
const politicas = [...codigo.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)\s+as\s+(\w+)\s+for\s+(\w+)([\s\S]*?);/gi)]
	.map((m) => ({ nombre: m[1], tabla: m[2], modo: m[3].toLowerCase(), cmd: m[4].toLowerCase(), cuerpo: m[5] }));
for (const [tabla, columnas] of Object.entries(INVENTARIO)) {
	for (const cmd of ["insert", "update"]) {
		const p = politicas.filter((x) => x.tabla === tabla && x.cmd === cmd);
		if (p.length !== 1) { ok(tabla + " " + cmd, false, p.length + " políticas"); continue; }
		const faltan = columnas.filter((c) => !new RegExp("public\\." + FUNCION[c] + "\\(" + c + "\\)").test(p[0].cuerpo));
		const conCheck = /with check\s*\(/i.test(p[0].cuerpo);
		const usingOk = cmd === "insert" || /using\s*\(\s*true\s*\)/i.test(p[0].cuerpo);
		ok(tabla + " " + cmd + " (" + columnas.join(", ") + ")", p[0].modo === "restrictive" && conCheck && usingOk && !faltan.length,
			(p[0].modo !== "restrictive" ? "no es restrictive " : "") + (faltan.length ? "sin revisar: " + faltan.join(", ") : "") +
			(!conCheck ? " sin with check" : "") + (!usingOk ? " update sin using (true)" : ""));
	}
}
const sobran = politicas.filter((p) => !INVENTARIO[p.tabla]);
ok("no hay políticas sobre tablas fuera del inventario", !sobran.length, sobran.map((p) => p.tabla).join(", "));

// 2. Funciones auxiliares
const funciones = [...codigo.matchAll(/create or replace function public\.(ref_\w+)\(([\s\S]*?)\$\$([\s\S]*?)\$\$;/gi)];
const usadas = new Set(Object.values(FUNCION));
ok("están las " + usadas.size + " funciones ref_*", [...usadas].every((f) => funciones.some((m) => m[1] === f)),
	[...usadas].filter((f) => !funciones.some((m) => m[1] === f)).join(", "));
for (const m of funciones) {
	const cab = m[2];
	const bien = /\bstable\b/i.test(cab) && /security invoker/i.test(cab) && /set search_path = public/i.test(cab) && !/security definer/i.test(cab);
	const nulo = /if p_id is null then return true;/i.test(m[3]);
	const aviso = /raise exception '[^']*no pertenece a tu cuenta' using errcode = '42501'/i.test(m[3]);
	ok(m[1] + ": stable, security invoker, search_path fijo, null permitido, error claro", bien && nulo && aviso);
}

// 3. Aditiva y sin tienda
const drops = [...codigo.matchAll(/drop\s+(\w+)\s+(?:if exists\s+)?(\w+)/gi)];
const dropsAjenos = drops.filter((d) => !(d[1].toLowerCase() === "policy" && /_refs_propias_(ins|upd)$/.test(d[2])));
ok("solo borra sus propias políticas (reaplicable)", !dropsAjenos.length, dropsAjenos.map((d) => d[0]).join("; "));
ok("no cambia tablas (alter/delete/truncate)", !/\b(alter\s+table|delete\s+from|truncate|update\s+public\.)/i.test(codigo));
ok("no toca la tienda", !/marketplace_/i.test(codigo));
ok("no toca funciones existentes", !/function public\.(?!ref_)/i.test(codigo));

// 4. Tablas en supabase/*.sql con columnas de referencia: en el inventario o con razón
const REF = /\b(alumno_id|grupo_id|proyecto_id|sesion_id|sesion_pda_id|producto_sesion_id|examen_id)\b/;
const nuevas = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".sql"))) {
	const t = fs.readFileSync(path.join(DIR, f), "utf8");
	for (const m of t.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
		const tabla = m[1];
		if (/^marketplace_/.test(tabla) || !REF.test(m[2])) continue;
		if (!INVENTARIO[tabla] && !EXCEPCIONES[tabla]) nuevas.push(tabla + " (" + f + ")");
	}
}
ok("toda tabla con referencias de supabase/*.sql está cubierta o exceptuada", !nuevas.length, nuevas.join(", "));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
