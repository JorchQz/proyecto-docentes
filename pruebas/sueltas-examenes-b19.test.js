/*
	Decisiones de Jorge del 2026-09-26 (después de AG y AH), en node:

	B1. Actividades sueltas con fecha pasada: cualquier día del trimestre en curso
	    (ProductosHoy.rangoTrimestre con el calendario SEP y validarSuelta), y se califican al
	    momento: Hoy muestra la suelta de un día que ya pasó el día en que se agregó y cuando se abre
	    desde "Actividades del trimestre" (hoy.html?calificar=<producto>).
	B5. Exámenes: "No presentó" (no cuenta ni a favor ni en contra, deja cerrar como Calificado) y
	    las capturas por la cola de la tablet (js/bandeja-salida.js). Los escenarios de la cola (sin
	    señal, recargar, conflictos) están en pruebas/bandeja-salida.test.js §11.
	SQL. mi_salon_b19 (examen_alumnos, marcas, triggers, RLS) y delete_own_account: UNA versión
	    completa, idéntica en jissez_interes_secciones, b17, b18 y b19 (el orden no importa).

	node pruebas/sueltas-examenes-b19.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── B1: rango del trimestre y validación ──────────────────────────────────────
const P = require("../js/productos-hoy.js");
const CE = require("../js/calendario-escolar.js");
const CS = require("../js/calendario-sep.js");
const fuentes = (hoy) => ({ calendarios: CE.CALENDARIOS, ciclo: CS.cicloDe(hoy) });
ok("T1 2026-2027: del primer día de clases al fin del primer periodo", P.rangoTrimestre(1, "2026-09-28", fuentes("2026-09-28")), { desde: "2026-08-31", hasta: "2026-11-26" });
ok("T2: del día siguiente al fin del 1.º al fin del 2.º", P.rangoTrimestre(2, "2027-01-15", fuentes("2027-01-15")), { desde: "2026-11-27", hasta: "2027-03-19" });
ok("T3: del día siguiente al fin del 2.º al último día de clases", P.rangoTrimestre(3, "2027-05-10", fuentes("2027-05-10")), { desde: "2027-03-20", hasta: "2027-07-09" });
ok("la maestra aún no cambia el trimestre en Mi grupo: hoy siempre cabe", P.rangoTrimestre(1, "2026-12-03", fuentes("2026-12-03")), { desde: "2026-08-31", hasta: "2026-12-03" });
ok("fuera de un ciclo conocido: los periodos del Acuerdo 10/09/23", P.rangoTrimestre(2, "2028-01-10", fuentes("2028-01-10")), { desde: "2027-12-01", hasta: "2028-03-31" });
const base = { nombre: "Lectura en voz alta", tipo: "trabajo", campo: "LEN", grados: [3] };
const ctx = Object.assign({ hoy: "2026-09-28" }, P.rangoTrimestre(1, "2026-09-28", fuentes("2026-09-28")));
ok("una actividad de un día que ya pasó del trimestre se acepta (con su fecha)", [P.validarSuelta(Object.assign({ fecha: "2026-09-22" }, base), ctx).ok, P.validarSuelta(Object.assign({ fecha: "2026-09-22" }, base), ctx).fecha], [true, "2026-09-22"]);
ok("antes del trimestre: no, con el primer día en el aviso", P.validarSuelta(Object.assign({ fecha: "2026-08-20" }, base), ctx).error, "El día de la actividad debe ser del trimestre en curso (desde el 31 ago).");
ok("después del trimestre: no", P.validarSuelta(Object.assign({ fecha: "2026-12-01" }, base), ctx).foco, "fechaSuelta");
ok("una tarea suelta se deja hoy (su fecha no se elige)", P.validarSuelta({ nombre: "Tarea", tipo: "tarea", campo: "LEN", grados: [3], fechaRevision: "2026-09-29", fecha: "2026-09-01" }, ctx).fecha, "2026-09-28");

// Alta el mismo día que el grupo (onboarding): recibe la suelta de la semana pasada; quien llegó otro día, no
const A = require("../js/alcance-hoy.js");
const grupoCreado = "2026-09-28T14:00:00Z", altaOnboarding = "2026-09-28T14:06:00Z", altaDespues = "2026-10-05T15:00:00Z";
ok("alumno dado de alta el mismo día que su grupo: sin fecha de alta (le cuenta la suelta del 24 sep)", [A.fechaAlta(altaOnboarding, grupoCreado), A.cuentaDesdeAlta(A.fechaAlta(altaOnboarding, grupoCreado), "2026-09-24", null)], [null, true]);
ok("alumno que llegó otro día: la suelta anterior a su alta no le cuenta", [A.fechaAlta(altaDespues, grupoCreado), A.cuentaDesdeAlta(A.fechaAlta(altaDespues, grupoCreado), "2026-09-24", null)], ["2026-10-05", false]);

const hoyJs = leer("js/hoy.js");
ok("Hoy: el día de la actividad suelta va del inicio al fin del trimestre (min y max)", /campoTexto\("Día de la actividad", \{ type: "date", min: rango\.desde, max: rango\.hasta, value: hoy \}\)/.test(hoyJs), true);
ok("Hoy: valida con el rango del trimestre", /var ctxV = \{ hoy: hoy, gradosSesion: porOmision, desde: rangoV\.desde, hasta: rangoV\.hasta \}/.test(hoyJs), true);
ok("Hoy: la suelta de un día que ya pasó entra a la pantalla al agregarla", /if \(!r\.sesion\.fecha \|\| r\.sesion\.fecha > hoy\) return null;/.test(hoyJs), true);
ok("Hoy: entra también al recargar ese día (su producto se creó hoy) y con ?calificar=", /get\("calificar"\)/.test(hoyJs) && /fechaLocal\(p\.created_at\) !== hoy/.test(hoyJs) && /created_at"\)/.test(hoyJs), true);
ok("Hoy: solo sueltas, solo actividades (las tareas van a Tareas por revisar)", /if \(!s \|\| !s\.fecha \|\| s\.fecha >= hoy \|\| p\.tipo === "tarea"\) return;\s*if \(!window\.AlcanceHoy\.esSueltas\(proyectoPorId\[s\.proyecto_id\]\)\) return;/.test(hoyJs), true);
ok("Hoy carga el calendario escolar (fin de cada trimestre)", /<script src="js\/calendario-escolar\.js"><\/script>\s*<script src="js\/calendario-sep\.js"><\/script>/.test(leer("hoy.html")), true);
const plan = leer("js/planeacion.js");
ok("Proyectos, Actividades del trimestre: «Calificar» abre Hoy con esa actividad (de hoy o de un día que ya pasó)", /href='hoy\.html\?calificar=" \+ encodeURIComponent\(p\.id\)/.test(plan) && /p\.tipo !== "tarea" && s\.fecha && s\.fecha <= hoyLocal/.test(plan), true);

// ── B5: No presentó ───────────────────────────────────────────────────────────
const X = require("../js/examen-modelo.js");
const M = require("../js/motor-calificacion.js");
const ex = { id: "e1", modo: "resultados", grados: [3], campos_resultados: { LEN: 10 } };
const alumnos = [{ id: "ana", grado: 3, estatus: "activo" }, { id: "beto", grado: 3, estatus: "activo" }];
const datos = { resultados: [{ examen_id: "e1", alumno_id: "ana", campo: "LEN", preguntas: 10, aciertos: 8 }, { examen_id: "e1", alumno_id: "beto", campo: "LEN", preguntas: 10, aciertos: 2 }], alumnosExamen: [] };
ok("sin No presentó: Beto cuenta (2 de 10)", M.aciertosExamenSalon(ex, datos, "beto"), { LEN: { aciertos: 2, preguntas: 10 } });
const conNP = Object.assign({}, datos, { alumnosExamen: [{ examen_id: "e1", alumno_id: "beto", no_presento: true }] });
ok("No presentó: no cuenta ni a favor ni en contra, aunque tenga algo capturado", M.aciertosExamenSalon(ex, conNP, "beto"), {});
ok("No presentó en OTRO examen no le quita este", M.aciertosExamenSalon(ex, { resultados: datos.resultados, alumnosExamen: [{ examen_id: "e9", alumno_id: "beto", no_presento: true }] }, "beto"), { LEN: { aciertos: 2, preguntas: 10 } });
ok("no_presento false (se quitó): cuenta normal", M.aciertosExamenSalon(ex, { resultados: datos.resultados, alumnosExamen: [{ examen_id: "e1", alumno_id: "beto", no_presento: false }] }, "beto"), { LEN: { aciertos: 2, preguntas: 10 } });
const soloAna = { resultados: [datos.resultados[0]], alumnosExamen: [] };
ok("sin Beto capturado: el examen sigue en revisión", X.estadoExamen(ex, soloAna, alumnos).clave, "en_revision");
ok("Beto «No presentó»: el examen queda Calificado", X.estadoExamen(ex, { resultados: [datos.resultados[0]], alumnosExamen: [{ examen_id: "e1", alumno_id: "beto", no_presento: true }] }, alumnos),
	{ clave: "calificado", texto: "Calificado", capturados: 2, completos: 2, total: 2, pendientesMano: 0, noPresentaron: 1 });
ok("resultado del alumno que no presentó: sin preguntas (no entra al promedio)", X.resultadoAlumno(ex, conNP, "beto").preguntas, 0);
const exP = { id: "e2", modo: "propio", grados: [3] };
const pregs = [{ id: "p1", examen_id: "e2", tipo: "opcion_multiple", campo: "SAB", clave: "A" }, { id: "p2", examen_id: "e2", tipo: "abierta", campo: "SAB", clave: null }];
ok("examen propio: No presentó cuenta como listo aunque tenga una abierta sin calificar", X.avanceAlumno(exP, { preguntas: pregs, respuestas: [], alumnosExamen: [{ examen_id: "e2", alumno_id: "ana", no_presento: true }] }, "ana"),
	{ capturado: true, completo: true, pendientesMano: 0, noPresento: true });

// El motor lee examen_alumnos (solo los marcados) y sin la tabla no se cae
const motor = leer("js/motor-calificacion.js");
ok("motor: lee examen_alumnos con no_presento = true, con respaldo si la tabla no existe", /from\("examen_alumnos"\)\.select\("examen_id, alumno_id, no_presento"\)[\s\S]{0,120}\.eq\("no_presento", true\)/.test(motor) && /if \(!faltaTabla\(e\)\) throw e;/.test(motor), true);

// Las capturas van por la cola; nada escribe directo examen_respuestas / examen_resultados
const exJs = leer("js/examen.js"), propio = leer("js/examen-propio.js"), camara = leer("js/examen-camara.js");
// (la única escritura directa que queda es ajustar las preguntas de un campo al editar el examen: necesita señal y toma la marca nueva)
const directas = [exJs, propio, camara].join("\n").match(/from\("examen_(respuestas|resultados|alumnos)"\)\.(upsert|insert|update|delete)\([^)]*\)/g) || [];
ok("Exámenes: las capturas van por la cola; directo solo el ajuste del examen (preguntas de un campo), que relee la marca",
	[directas, /update\(\{ preguntas: fila\.campos_resultados\[c\] \}\)[\s\S]{0,200}captura_id"\)\);\s*if \(r\.ok\) \(r\.data \|\| \[\]\)\.forEach\(function \(x\) \{ ponerBase\("examen_resultado", x\); \}\);/.test(exJs)],
	[["from(\"examen_resultados\").update({ preguntas: fila.campos_resultados[c] })", "from(\"examen_resultados\").delete()"], true]);
ok("Exámenes crea su cola (BandejaSalida.crear) y la inicia después de pintar lo pendiente", /bandeja = B\.crear\(/.test(exJs) && /await aplicarPendientes\(\);/.test(exJs) && /if \(bandeja\) bandeja\.iniciar\(\);\n\}/.test(exJs), true);
ok("Exámenes lee la marca de cada fila (captura_id) para no pisar otro aparato", /examen_respuestas"\)\.select\("[^"]*captura_id"\)/.test(exJs) && /examen_resultados"\)\.select\("[^"]*captura_id"\)/.test(exJs) && /examen_alumnos"\)\.select\("[^"]*captura_id"\)/.test(exJs), true);
ok("capturar algo de quien estaba «No presentó» le quita la marca", /if \(fam !== "examen_alumno" && !borrar && X\.noPresento\(\{ id: d\.examen_id \}, datos, d\.alumno_id\)\)/.test(exJs), true);
ok("la cámara guarda por la cola (una captura por pregunta) y dice «Guardado en la tablet» sin señal", /ctx\.capturar\("examen_respuesta", \{ examen_id: ex\.id, pregunta_id: f\.pregunta_id/.test(propio) && /Guardado en la tablet \(sin señal; se envía solo al volver\)/.test(camara), true);
ok("examen.html carga la cola antes de examen.js", /js\/bandeja-salida\.js[\s\S]*js\/examen\.js/.test(leer("examen.html")), true);
const band = leer("js/bandeja-salida.js");
ok("la cola conoce los tres tipos de examen con su tabla y su llave única", ["tabla: \"examen_respuestas\"", "conflicto: \"pregunta_id,alumno_id\"", "tabla: \"examen_resultados\"", "conflicto: \"examen_id,alumno_id,campo\"", "tabla: \"examen_alumnos\"", "conflicto: \"examen_id,alumno_id\""].every((x) => band.indexOf(x) !== -1), true);
ok("la marca de Exámenes va aparte (si faltara b19, Hoy sigue con sus marcas)", /var marcaExamen = \{ disponible: null \};/.test(band) && /var marca = marcaDe\(it\.tipo\);/.test(band), true);
ok("fuera de Hoy y Exámenes el aviso habla de capturas (de Hoy o de Exámenes) y Exámenes no duplica el envío", /capturas sin enviar \(de Hoy o de Exámenes\)/.test(band) && /script\[src="js\/examen\.js"\]/.test(band) && /Ir a Exámenes/.test(band), true);
ok("Sin conexión dice que hay capturas de Hoy o de Exámenes guardadas", /capturas \(de Hoy o de Exámenes\) guardadas/.test(leer("sin-conexion.html")), true);

// ── SQL: b19 ──────────────────────────────────────────────────────────────────
const b19 = leer("supabase/mi_salon_b19_examenes_cola_2026-09.sql");
const sinCom = b19.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
ok("b19: examen_alumnos con no_presento, llave única por examen y alumno, y cascadas", /create table if not exists public\.examen_alumnos/.test(sinCom) && /no_presento\s+boolean not null default false/.test(sinCom) &&
	/create unique index if not exists examen_alumnos_examen_alumno_uidx on public\.examen_alumnos \(examen_id, alumno_id\)/.test(sinCom) &&
	/examen_id\s+uuid not null references public\.examenes_grupo \(id\) on delete cascade/.test(sinCom) && /alumno_id\s+uuid not null references public\.alumnos \(id\) on delete cascade/.test(sinCom), true);
ok("b19: RLS, sin anónimo, y al escribir examen propio + alumno propio del mismo grupo", /alter table public\.examen_alumnos enable row level security/.test(sinCom) && /revoke all on public\.examen_alumnos from anon/.test(sinCom) &&
	(sinCom.match(/join public\.alumnos a on a\.grupo_id = e\.grupo_id/g) || []).length === 2, true);
ok("b19: marca captura_id en las tres tablas con su trigger (insert sin marca o cambio sin marca nueva → del servidor)",
	["examen_respuestas", "examen_resultados"].every((t) => new RegExp("alter table public\\." + t + " add column if not exists captura_id uuid").test(sinCom)) &&
	["examen_respuestas", "examen_resultados", "examen_alumnos"].every((t) => new RegExp("create or replace trigger " + t + "_marca_captura\\s+before insert or update on public\\." + t).test(sinCom)) &&
	(sinCom.match(/new\.captura_id is not distinct from old\.captura_id then\s+new\.captura_id := pg_catalog\.gen_random_uuid\(\)/g) || []).length === 3, true);
ok("b19: aditiva (no borra tablas, columnas ni datos)", /\bdrop (table|column)\b|\btruncate\b|alter table [^;]* drop |\bdelete from public\.(?!evaluacion_formativa|calificaciones|registro_diario|boleta_trimestral|evaluacion_diagnostica|tareas|productos_sesion|dias_no_habiles_extra|maestro_ajustes|zz_deprecated_diagnosticos)/i.test(sinCom.replace(/\$\$[\s\S]*?\$\$/g, "")), false);

// ── delete_own_account: la misma versión completa en los cuatro archivos ─────
const ARCHIVOS = ["supabase/jissez_interes_secciones_2026-09.sql", "supabase/mi_salon_b17_flujo_libre_2026-09.sql", "supabase/mi_salon_b18_examenes_2026-09.sql", "supabase/mi_salon_b19_examenes_cola_2026-09.sql"];
const fn = (t) => (t.match(/create or replace function public\.delete_own_account\(\)[\s\S]*?grant execute on function public\.delete_own_account\(\) to authenticated;/g) || []);
const versiones = ARCHIVOS.map((f) => fn(leer(f)));
ok("cada archivo define delete_own_account una sola vez", versiones.map((v) => v.length), [1, 1, 1, 1]);
ok("las cuatro versiones son idénticas letra por letra (cualquiera que se aplique al final la deja completa)", new Set(versiones.map((v) => v[0])).size, 1);
const unica = versiones[0][0];
const TODAS = ["evaluacion_formativa", "calificaciones", "registro_diario", "boleta_trimestral", "evaluacion_diagnostica", "tareas", "producto_sesion_alumnos", "productos_sesion", "dias_no_habiles_extra", "maestro_ajustes", "zz_deprecated_diagnosticos",
	"incidencia_alumnos", "incidencias", "roles_aseo", "calendario_ajustes", "listas_valores", "listas_columnas", "listas_grupo", "interes_secciones",
	"examen_alumnos", "examen_respuestas", "examen_resultados", "examen_preguntas", "examenes_grupo"];
ok("cubre b10, b13, b14, b15, interes_secciones, producto_sesion_alumnos y todas las de exámenes", TODAS.filter((t) => !new RegExp("delete from public\\." + t + " where (maestro_id|usuario_id)").test(unica)), []);
const GUARDADAS = TODAS.slice(TODAS.indexOf("incidencia_alumnos")).concat(["producto_sesion_alumnos"]);
ok("todo lo de b13 en adelante va con guarda to_regclass", GUARDADAS.filter((t) => !new RegExp("if to_regclass\\('public\\." + t + "'\\) is not null then\\s+execute 'delete from public\\." + t + " where").test(unica)), []);
ok("orden: hijos antes que padres (asignación antes que productos; respuestas antes que preguntas; preguntas antes que exámenes)",
	[unica.indexOf("producto_sesion_alumnos where") < unica.indexOf("productos_sesion where"), unica.indexOf("examen_respuestas where") < unica.indexOf("examen_preguntas where"),
		unica.indexOf("examen_preguntas where") < unica.indexOf("examenes_grupo where"), unica.indexOf("examenes_grupo where") < unica.indexOf("delete from auth.users")], [true, true, true, true]);
ok("freno por compras, security definer, search_path vacío y sin anónimo", [/marketplace_ordenes/.test(unica), /security definer\nset search_path = ''/.test(unica), /revoke all on function public\.delete_own_account\(\) from public, anon;/.test(unica)], [true, true, true]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
