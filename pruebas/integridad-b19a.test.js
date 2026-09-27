/*
	Integridad de b19a (supabase/mi_salon_b19a_integridad_2026-09.sql; revisores R26a y R26b):
	  A1  una calificación no se guarda en un producto quitado (trigger con hint 'producto_inactivo',
	      producto leído FOR SHARE) y Hoy quita esa actividad de la pantalla al recibir el rechazo;
	  A2  referencias del mismo grupo: calificaciones (alumno, producto y grupo), examen_respuestas
	      (la pregunta es de ese examen y el examen es "propio"), examen_id fijo en preguntas y
	      respuestas, productos_sesion.sesion_id solo con mover_producto_a_sesion;
	  A3  la calificación toma sesion_id y proyecto_id de su producto;
	  B2  delete_own_account borra marketplace_busquedas_vacias y productos_finales (con guarda) antes
	      que el usuario;
	  B5  campo_largo sin permiso para anon/public; Hoy no muestra el texto técnico en inglés de la
	      base ("column … does not exist") y da uno en español.
	Lee los archivos (sin base). La prueba contra la base de pruebas, con cada ataque y cada uso
	normal como QA2, está en .qa/constructor-aj/sql-integridad.js y sql-cuenta.js. Con el código de
	7ee2455 (sin b19a) esta prueba falla.

	node pruebas/integridad-b19a.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (f) => { try { return fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n"); } catch (_) { return ""; } };

let fallos = 0;
function ok(nombre, bien, detalle) {
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

const sql = leer("supabase/mi_salon_b19a_integridad_2026-09.sql");
// Sin comentarios de línea (la verificación del final va comentada)
const codigo = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const funcion = (nombre) => {
	const i = codigo.indexOf("create or replace function public." + nombre + "(");
	if (i < 0) return "";
	const j = codigo.indexOf("end $$;", i);
	return j < 0 ? "" : codigo.slice(i, j + 7);
};
ok("existe la migración b19a", sql.length > 0);

// ── A1 y A3 ──
const desde = funcion("calificaciones_desde_producto");
ok("A1 trigger rechaza producto inactivo con hint 'producto_inactivo' y el texto fijo",
	/v_activo = false/.test(desde) && /hint = 'producto_inactivo'/.test(desde) &&
	desde.includes("'Esta actividad se quitó en otra pantalla; tu captura no se aplicó.'") && /errcode = 'P0001'/.test(desde));
ok("A1 lee el producto FOR SHARE (un Quitar simultáneo se ordena)", /for share of ps/.test(desde));
ok("A1 el trigger es BEFORE INSERT OR UPDATE (toda escritura)",
	/create trigger calificaciones_desde_producto\s+before insert or update on public\.calificaciones\s+for each row execute function public\.calificaciones_desde_producto\(\)/.test(codigo));
ok("A3 toma sesion_id y proyecto_id del producto", /new\.sesion_id := v_sesion;/.test(desde) && /new\.proyecto_id := v_proyecto;/.test(desde));
ok("A1/A3 sin producto no hace nada; producto que no se ve (otra cuenta) lo deja a las políticas",
	/if new\.producto_sesion_id is null then\s+return new;/.test(desde) && /if not found then\s+return new;/.test(desde));

// ── A2 ──
const mismo = funcion("ref_calificacion_mismo_grupo");
ok("A2a función: alumno, proyecto del producto y grupo coinciden",
	/a\.grupo_id = p\.grupo_id and p\.grupo_id = p_grupo/.test(mismo) && /security invoker/.test(mismo) && /errcode = '42501'/.test(mismo));
for (const op of ["insert", "update"]) {
	const n = "calificaciones_mismo_grupo_" + (op === "insert" ? "ins" : "upd");
	ok("A2a política " + n + " restrictiva", new RegExp("create policy " + n + " on public\\.calificaciones as restrictive for " + op + "[\\s\\S]{0,120}ref_calificacion_mismo_grupo\\(producto_sesion_id, alumno_id, grupo_id\\)").test(codigo));
}
const resp = funcion("ref_respuesta_mismo_examen");
ok("A2b función: la pregunta es de ese examen y el examen es propio",
	/p\.examen_id = p_examen/.test(resp) && /e\.modo = 'propio'/.test(resp) && /errcode = '42501'/.test(resp));
for (const op of ["insert", "update"]) {
	const n = "examen_respuestas_mismo_examen_" + (op === "insert" ? "ins" : "upd");
	ok("A2b política " + n + " restrictiva", new RegExp("create policy " + n + " on public\\.examen_respuestas as restrictive for " + op + "[\\s\\S]{0,120}ref_respuesta_mismo_examen\\(examen_id, pregunta_id\\)").test(codigo));
}
for (const t of ["examen_preguntas", "examen_respuestas"]) {
	ok("A2b/c " + t + ".examen_id fijo (trigger before update of examen_id)",
		new RegExp("create trigger " + t + "_examen_fijo\\s+before update of examen_id on public\\." + t).test(codigo));
}
ok("A2b/c el trigger rechaza el cambio de examen", /new\.examen_id is distinct from old\.examen_id/.test(funcion("examen_hijo_examen_fijo")));
const fija = funcion("productos_sesion_sesion_fija");
ok("A2d productos_sesion.sesion_id: solo con la marca jissez.mover_producto del mismo producto",
	/current_setting\('jissez\.mover_producto', true\) is distinct from new\.id::text/.test(fija) && /hint = 'producto_sesion_fija'/.test(fija) &&
	/create trigger productos_sesion_sesion_fija\s+before update of sesion_id on public\.productos_sesion/.test(codigo));
const mover = funcion("mover_producto_a_sesion");
const iMarca = mover.indexOf("set_config('jissez.mover_producto', p_producto::text, true)");
const iUpd = mover.indexOf("update public.productos_sesion\n    set sesion_id = p_sesion");
const iLimpia = mover.indexOf("set_config('jissez.mover_producto', '', true)");
ok("A2d mover_producto_a_sesion pone la marca justo antes de mover y la limpia después", iMarca > 0 && iUpd > iMarca && iLimpia > iUpd);
// mover es la de b17 más esas dos líneas
const b17 = leer("supabase/mi_salon_b17_flujo_libre_2026-09.sql");
const m17 = (() => { const i = b17.indexOf("create or replace function public.mover_producto_a_sesion("); return b17.slice(i, b17.indexOf("\nend $$;", i) + 8); })();
const normal = (t) => t.split("\n").map((l) => l.replace(/--.*$/, "").trimEnd()).filter((l) => l).join("\n");
const sinMarca = normal(mover.split("\n").filter((l) => !/jissez\.mover_producto/.test(l)).join("\n"));
ok("A2d mover_producto_a_sesion = la de b17 más las dos líneas de la marca", sinMarca === normal(m17));

// ── B2 delete_own_account ──
const doa = (() => { const i = sql.indexOf("-- @@delete_own_account inicio"); return sql.slice(i, sql.indexOf("-- @@delete_own_account fin", i)); })();
const iUsuario = doa.indexOf("delete from auth.users where id = v;");
const iBusq = doa.indexOf("delete from public.marketplace_busquedas_vacias where user_id = $1");
const iPF = doa.indexOf("delete from public.productos_finales where maestro_id = $1 or grupo_id in (select id from public.grupos where maestro_id = $1)");
ok("B2 borra marketplace_busquedas_vacias y productos_finales antes que al usuario", iBusq > 0 && iPF > 0 && iUsuario > iBusq && iUsuario > iPF);
ok("B2 cada uno con su guarda to_regclass",
	/if to_regclass\('public\.marketplace_busquedas_vacias'\) is not null then\s+execute 'delete from public\.marketplace_busquedas_vacias/.test(doa) &&
	/if to_regclass\('public\.productos_finales'\) is not null then\s+execute 'delete from public\.productos_finales/.test(doa));

// ── B5 ──
ok("B5 campo_largo: sin permiso para public ni anon", /revoke all on function public\.campo_largo\(text\) from public, anon;/.test(codigo));
ok("B5 ninguna función nueva de b19a se puede llamar sin sesión",
	["calificaciones_desde_producto()", "examen_hijo_examen_fijo()", "productos_sesion_sesion_fija()"].every((f) => codigo.includes("revoke all on function public." + f + " from public, anon, authenticated;")) &&
	["ref_calificacion_mismo_grupo(uuid, uuid, uuid)", "ref_respuesta_mismo_examen(uuid, uuid)", "mover_producto_a_sesion(uuid, uuid, date)"].every((f) => codigo.includes("revoke all on function public." + f + " from public, anon;")));
ok("migración aditiva: no borra columnas, tablas ni filas fuera de funciones",
	!/\bdrop\s+(table|column)\b/i.test(codigo) && !/^\s*(delete|truncate|update)\b/im.test(codigo.replace(/\$\$[\s\S]*?\$\$/g, "")));

// ── Hoy ──
const hoy = leer("js/hoy.js");
ok("A1 Hoy: al rechazo con motivo producto_inactivo quita la actividad de la pantalla (esta ventana y las otras)",
	/r && r\.motivo === "producto_inactivo"\) quitarDePantalla\(it\)/.test(hoy) && /m\.motivo === "producto_inactivo"\) quitarDePantalla\(it\)/.test(hoy) &&
	/function quitarDePantalla\(it\)/.test(hoy));
// textoError de Hoy, sacada del archivo y probada sola
const iT = hoy.indexOf("function textoError(e) {");
let textoError = null;
if (iT >= 0) {
	const cuerpo = hoy.slice(iT, hoy.indexOf("\n\t}\n", iT) + 3);
	textoError = new Function("console", cuerpo + "\nreturn textoError;")({ warn() {} });
}
const T = (e) => (textoError ? textoError(e) : "(sin textoError)");
ok("B5 Hoy: 'column … does not exist' no se muestra; se da un texto en español",
	!/does not exist|column/i.test(T({ code: "42703", message: "column calificaciones.revisar_en does not exist" })) && /actualización/.test(T({ code: "42703", message: "column calificaciones.revisar_en does not exist" })),
	T({ code: "42703", message: "column calificaciones.revisar_en does not exist" }));
ok("B5 Hoy: tabla o función que falta (PGRST205/PGRST202) también", /actualización/.test(T({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" })) && /actualización/.test(T({ code: "PGRST202", message: "Could not find the function" })));
ok("B5 Hoy: sin red", T({ message: "TypeError: Failed to fetch" }), "no hubo conexión con el servidor");
ok("B5 Hoy: un mensaje propio de la base en español se conserva", T({ code: "P0001", message: "La sesión destino debe ser de un proyecto del mismo grupo" }), "La sesión destino debe ser de un proyecto del mismo grupo");
ok("B5 Hoy: RLS en inglés → genérico en español", T({ code: "42501", message: "new row violates row-level security policy" }), "la base no lo permitió");
ok("B5 Hoy: ningún mensaje de error muestra e.message directo", !/\.message \|\| "error desconocido"/.test(hoy));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
