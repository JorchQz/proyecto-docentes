/*
	delete_own_account entre migraciones (la cita de b19 y la nota de b19a).

	Varias migraciones reemplazan delete_own_account completa (b10, jissez_interes_secciones, b17,
	b18, b19 y b19a). La que se aplica AL FINAL es la que queda, así que la última del orden
	recomendado (b19a) debe contener todo lo que borran las anteriores:
	  - cada tabla que borra alguna versión anterior también la borra b19a;
	  - lo de b13 en adelante va con guarda to_regclass (b19a se puede aplicar aunque falte una tabla);
	  - las compras de la tienda siguen bloqueando el borrado;
	  - la cabecera de b19a dice que va al final.
	Si otra migración nueva redefine delete_own_account (p. ej. al fusionar las ramas de otros
	constructores), agrégala a ORDEN al final: la prueba exige lo mismo de la última.

	node pruebas/migraciones-orden.test.js
*/
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..", "supabase");
const leer = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
function ok(nombre, bien, detalle) {
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
ok("la cabecera de b19a dice que va al final", /ORDEN: va AL FINAL/.test(leer(ultima)));
ok("b19 ya no afirma ser la última ni cita una prueba que no comprueba eso",
	!/cualquiera de esos archivos que se\s+--\s+aplique AL FINAL deja la función completa/.test(leer("mi_salon_b19_examenes_cola_2026-09.sql")));

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
