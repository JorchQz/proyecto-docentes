/*
	delete_own_account entre migraciones (la cita de b19, la nota de b19a y la integración del
	lanzamiento: b20, b21 y b22).

	Varias migraciones reemplazan delete_own_account completa (b10, jissez_interes_secciones, b17,
	b18, b19, b19a, b20, b21, b22 y b23). La que se aplica AL FINAL es la que queda, así que la última
	del orden recomendado (b23) debe contener todo lo que borran las anteriores:
	  - cada tabla que borra alguna versión anterior también la borra b22 (b19a: búsquedas vacías y
	    productos finales; b20: calificacion_directa y ponte_al_dia; b21: mi_salon_correos y
	    mi_salon_accesos) más mi_salon_ordenes (b22) e incidencias_folios (b23);
	  - lo de b13 en adelante va con guarda to_regclass (b22 se puede aplicar aunque falte una tabla);
	  - las compras de la tienda y los PAGOS de Mi Salón siguen bloqueando el borrado;
	  - la cabecera de b22 dice que va al final.
	Además, el candado de solo lectura (b21): cada tabla nueva del SaaS que escribe el docente (b17
	en adelante) está en la lista de b21 o su migración llama a mi_salon_candado; las que no lo
	llevan están en SIN_CANDADO con su razón.
	Si otra migración nueva redefine delete_own_account, agrégala a ORDEN al final: la prueba exige
	lo mismo de la última.

	node pruebas/migraciones-orden.test.js
*/
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..", "supabase");
const leer = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
// ok(nombre, condición, detalle) o ok(nombre, real, esperado) cuando real es un arreglo (se compara)
function ok(nombre, bien, detalle) {
	if (Array.isArray(bien)) {
		const real = bien;
		bien = JSON.stringify(real) === JSON.stringify(detalle);
		detalle = JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(detalle) + ")");
	}
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (detalle ? " → " + detalle : ""));
}

// Orden recomendado en producción (docs/PROGRESO-PARTE-B.md); la ÚLTIMA manda
const ORDEN = [
	// Ya en producción
	"mi_salon_b10_eliminar_cuenta_2026-09.sql",
	"mi_salon_b13_ficha_incidencias_2026-09.sql",
	"mi_salon_b14_calendario_2026-09.sql",
	"mi_salon_b15_listas_2026-09.sql",
	// Solo en pruebas (2026-09-26), en este orden
	"jissez_interes_secciones_2026-09.sql",
	"mi_salon_b17_flujo_libre_2026-09.sql",
	"mi_salon_b18_examenes_2026-09.sql",
	"mi_salon_b19_examenes_cola_2026-09.sql",
	"mi_salon_b19a_integridad_2026-09.sql",
	// Lanzamiento de Mi Salón (2026-09-26): registro histórico, accesos y cobros
	"mi_salon_b20_registro_historico_2026-09.sql",
	"mi_salon_b21_acceso_2026-09.sql",
	"mi_salon_b22_cobros_2026-09.sql",
	// Folio de incidencias y ajustes de R27a/R27b (2026-09-26): trae la versión FINAL
	"mi_salon_b23_folio_incidencias_2026-09.sql",
];

// El cuerpo de delete_own_account de un archivo (la última definición, si hay varias)
function cuerpo(sql) {
	const i = sql.lastIndexOf("create or replace function public.delete_own_account()");
	if (i < 0) return "";
	return sql.slice(i, sql.indexOf("end $$;", i) + 7);
}
// Tablas que borra: "delete from public.x" directo o dentro de execute '...'
function tablas(c) {
	const t = new Set();
	const re = /delete from (public|auth)\.([a-z_]+)/g;
	let m;
	while ((m = re.exec(c))) t.add(m[1] + "." + m[2]);
	return t;
}

// Todas las migraciones que definen delete_own_account deben estar en ORDEN
const todas = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql") && /create or replace function public\.delete_own_account\(\)/.test(leer(f)));
const fuera = todas.filter((f) => ORDEN.indexOf(f) === -1);
ok("cada migración que redefine delete_own_account está en el orden", fuera.length === 0, fuera.join(", "));

const ultima = ORDEN[ORDEN.length - 1];
const cu = cuerpo(leer(ultima));
const tu = tablas(cu);
ok("la última (" + ultima + ") define delete_own_account", cu.length > 0);
ORDEN.slice(0, -1).forEach((f) => {
	const faltan = [...tablas(cuerpo(leer(f)))].filter((t) => !tu.has(t));
	ok("la última borra todo lo que borra " + f, faltan.length === 0, faltan.join(", "));
});
ok("la última borra marketplace_busquedas_vacias y productos_finales (R26b)",
	tu.has("public.marketplace_busquedas_vacias") && tu.has("public.productos_finales"));
ok("la última borra lo de b20, b21, b22 y b23 (calificacion_directa, ponte_al_dia, mi_salon_correos, mi_salon_accesos, mi_salon_ordenes, incidencias_folios)",
	["calificacion_directa", "ponte_al_dia", "mi_salon_correos", "mi_salon_accesos", "mi_salon_ordenes", "incidencias_folios"].filter((t) => !tu.has("public." + t)), []);
ok("un pago de Mi Salón bloquea el borrado (guarda con to_regclass, antes de borrar nada)",
	/if to_regclass\('public\.mi_salon_accesos'\) is not null then\s+if exists \(select 1 from public\.mi_salon_accesos where docente_id = v and origen = 'pago'\) then[\s\S]*?errcode = 'check_violation'/.test(cu)
	&& cu.indexOf("origen = 'pago'") < cu.indexOf("delete from public."));
ok("la versión final sigue siendo security definer y solo para authenticated",
	/security definer/.test(cu) && /revoke all on function public\.delete_own_account\(\) from public, anon;\s*grant execute on function public\.delete_own_account\(\) to authenticated;/.test(leer(ultima).slice(leer(ultima).lastIndexOf("@@delete_own_account inicio"))));
ok("la última borra al usuario al final", cu.lastIndexOf("delete from auth.users where id = v;") > cu.lastIndexOf("execute 'delete from public."));
ok("las compras de la tienda siguen bloqueando el borrado",
	/marketplace_ordenes where user_id = v[\s\S]*marketplace_accesos where user_id = v[\s\S]*marketplace_pedidos where user_id = v[\s\S]*errcode = 'check_violation'/.test(cu));
// Lo de b13 en adelante con guarda (sin ella, aplicar la última sobre una base sin esa tabla fallaría)
const SIN_GUARDA_OK = ["evaluacion_formativa", "calificaciones", "registro_diario", "boleta_trimestral", "evaluacion_diagnostica", "tareas",
	"productos_sesion", "dias_no_habiles_extra", "maestro_ajustes", "zz_deprecated_diagnosticos"];
const sinGuarda = [];
const reDirecto = /^\s*delete from public\.([a-z_]+)/gm;
let m;
while ((m = reDirecto.exec(cu))) if (SIN_GUARDA_OK.indexOf(m[1]) === -1) sinGuarda.push(m[1]);
ok("las tablas nuevas van con guarda to_regclass", sinGuarda.length === 0, sinGuarda.join(", "));
const guardas = (cu.match(/if to_regclass\('public\.([a-z_]+)'\) is not null then\s+execute 'delete from public\.([a-z_]+)/g) || [])
	.map((g) => g.match(/public\.([a-z_]+)'\)[\s\S]*public\.([a-z_]+)/)).filter((x) => x[1] !== x[2]);
ok("cada guarda revisa la misma tabla que borra", guardas.length === 0);
ok("la última del orden es b23 (folio de incidencias)", ultima, "mi_salon_b23_folio_incidencias_2026-09.sql");
ok("la cabecera de la última (" + ultima + ") dice que va al final", /ORDEN: va AL FINAL/.test(leer(ultima)));
ok("solo la última dice que va al final", ORDEN.slice(0, -1).filter((f) => /ORDEN: va AL FINAL/.test(leer(f))), []);

// ── Candado de solo lectura (b21) en cada tabla nueva del SaaS ──────────────────
const b21 = leer("mi_salon_b21_acceso_2026-09.sql");
const listaCandado = ((b21.match(/foreach t in array array\[([\s\S]*?)\] loop/) || [])[1] || "").match(/'([a-z_]+)'/g) || [];
const conCandado = new Set(listaCandado.map((x) => x.replace(/'/g, "")));
const SIN_CANDADO = {
	interes_secciones: "avisos de la tienda (no es captura del SaaS)",
	ponte_al_dia: "avance del asistente (se oculta o retoma aun en solo lectura), a propósito",
	jissez_config: "configuración global; solo el admin por RPC",
	mi_salon_periodos: "calendario de periodos; solo el admin",
	mi_salon_accesos: "accesos; solo el trigger de alta, el admin y el webhook",
	mi_salon_correos: "correos enviados; solo las Edge Functions",
	mi_salon_precios: "precios; solo el admin",
	mi_salon_ordenes: "órdenes; solo las Edge Functions (service role)",
	mi_salon_avisos: "calendario de avisos; solo el admin",
};
const DESDE = ORDEN.indexOf("jissez_interes_secciones_2026-09.sql");
const nuevas = [];
ORDEN.slice(DESDE).forEach((f) => {
	const sql = leer(f);
	const re = /create table if not exists public\.([a-z_]+)/g;
	let mt;
	while ((mt = re.exec(sql))) nuevas.push({ tabla: mt[1], archivo: f, sql });
});
const sinCandado = nuevas.filter((n) => !SIN_CANDADO[n.tabla] && !conCandado.has(n.tabla)
	&& !new RegExp("mi_salon_candado\\('public\\." + n.tabla + "'\\)").test(n.sql)).map((n) => n.tabla + " (" + n.archivo + ")");
ok("cada tabla nueva del SaaS (" + nuevas.length + ") lleva el candado de solo lectura o está en SIN_CANDADO con su razón", sinCandado, []);
ok("calificacion_directa: en la lista de b21 y b20 llama a mi_salon_candado (volver a correr b20)",
	[conCandado.has("calificacion_directa"), /perform public\.mi_salon_candado\('public\.calificacion_directa'\)/.test(leer("mi_salon_b20_registro_historico_2026-09.sql"))], [true, true]);
ok("ponte_al_dia NO lleva candado (a propósito)", [conCandado.has("ponte_al_dia") || /mi_salon_candado\('public\.ponte_al_dia'\)/.test(leer("mi_salon_b20_registro_historico_2026-09.sql"))], [false]);
ok("b19 ya no afirma ser la última ni cita una prueba que no comprueba eso",
	!/cualquiera de esos archivos que se\s+--\s+aplique AL FINAL deja la función completa/.test(leer("mi_salon_b19_examenes_cola_2026-09.sql")));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
