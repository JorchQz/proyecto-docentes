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
	lo mismo de la última que la define. La prueba también revisa que la guía de producción aplique
	este orden (b23 al final, b21b aparte) y que ningún comando aplique b24: se descartó por decisión
	de Jorge del 2026-09-27 (el alumno se evalúa siempre con los PDA de su grado) y nunca se aplicó
	en producción. Al final, b26 (bucket `recursos` solo para su cuenta, sin INSERT): va aparte, en su
	propio comando de la guía.

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
// igual(nombre, real, esperado): compara cualquier valor (JSON)
function igual(nombre, real, esperado) { ok(nombre, [real], [esperado]); }

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
	// Folio de incidencias y ajustes de R27a/R27b (2026-09-26): trae la versión FINAL y es la última
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

// La que manda es la ÚLTIMA del orden que define delete_own_account (b23); si alguna fuera después,
// no debe redefinirla
const definen = ORDEN.filter((f) => cuerpo(leer(f)).length > 0);
const ultima = definen[definen.length - 1];
const despues = ORDEN.slice(ORDEN.indexOf(ultima) + 1);
const cu = cuerpo(leer(ultima));
const tu = tablas(cu);
ok("la última que define delete_own_account (" + ultima + ") la define", cu.length > 0);
ok("las que van después de " + ultima + " no redefinen delete_own_account", despues.filter((f) => /delete_own_account/.test(leer(f).replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""))), []);
ORDEN.slice(0, ORDEN.indexOf(ultima)).forEach((f) => {
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
igual("la última que define delete_own_account es b23 (folio de incidencias)", ultima, "mi_salon_b23_folio_incidencias_2026-09.sql");
ok("la cabecera de " + ultima + " dice que va al final (de las que la reemplazan)", /ORDEN: va AL FINAL/.test(leer(ultima)));
igual("solo " + ultima + " dice que va al final", ORDEN.filter((f) => f !== ultima && /ORDEN: va AL FINAL/.test(leer(f))), []);
igual("la última del orden es b23 (folio de incidencias)", ORDEN[ORDEN.length - 1], "mi_salon_b23_folio_incidencias_2026-09.sql");

// ── b24 descartada (decisión de Jorge del 2026-09-27: el alumno se evalúa siempre con los PDA de su
// grado; la evidencia la deja la regla de b5). Nunca se aplicó en producción ──
igual("b24 ya no está en supabase/ ni en el orden", [fs.existsSync(path.join(DIR, "mi_salon_b24_evidencia_incluidos_2026-09.sql")), ORDEN.filter((f) => /b24/.test(f))], [false, []]);
igual("ninguna migración de supabase/ define pda_de_alumno_en_producto ni cambia la regla de evidencia de b5",
	fs.readdirSync(DIR).filter((f) => f.endsWith(".sql") && f !== "mi_salon_b5_2026-09.sql" &&
		/pda_de_alumno_en_producto|create or replace function public\.(propagar_calificacion_a_pda|retirar_evidencia_de_pda)\(/.test(leer(f).replace(/--[^\n]*/g, ""))), []);

// ── La guía de producción aplica este mismo orden en UNA transacción, con b21b aparte después ──
const guia = fs.readFileSync(path.join(__dirname, "..", "docs", "PRODUCCION-MI-SALON.md"), "utf8").replace(/\r\n/g, "\n");
const comandos = guia.split("\n").filter((l) => l.startsWith("node scripts/aplicar-migraciones-prod.js "));
const archivosDe = (l) => (l || "").split(/\s+/).slice(2).map((a) => a.replace(/^supabase\//, ""));
// Desde el 2026-09-27 la guía trae primero lo que falta en producción (las once ya se aplicaron:
// solo b21b) y después la cadena completa para una base sin ninguna
const iCadena = comandos.findIndex((l) => l.indexOf("jissez_interes_secciones_2026-09.sql") !== -1);
const primera = archivosDe(comandos[iCadena]);
const pendientes = ORDEN.slice(ORDEN.indexOf("jissez_interes_secciones_2026-09.sql"));
igual("la guía: la cadena completa trae las de este orden desde jissez_interes_secciones, en el mismo orden, y termina en b23",
	primera.filter((a) => pendientes.indexOf(a) !== -1), pendientes);
igual("la guía: b23 es la última de esa transacción", primera[primera.length - 1], "mi_salon_b23_folio_incidencias_2026-09.sql");
igual("la guía: b21b va aparte, después de la cadena", (comandos[iCadena + 1] || "").indexOf("mi_salon_b21b_piloto_produccion_2026-09.sql") !== -1, true);
igual("la guía: lo que falta en producción es solo b21b, antes de la cadena completa",
	[iCadena, archivosDe(comandos[0])], [1, ["mi_salon_b21b_piloto_produccion_2026-09.sql"]]);
igual("la guía: ningún comando aplica b24 (descartada)", comandos.filter((l) => /b24/.test(l)), []);
igual("la guía: dice que b24 se descartó por decisión de Jorge del 2026-09-27 y que nunca se aplicó en producción",
	/b24 \(`mi_salon_b24_evidencia_incluidos_2026-09\.sql`\) se descartó por decisión de Jorge del 2026-09-27[\s\S]{0,200}se evalúa siempre con los PDA de su grado[\s\S]{0,300}Nunca se aplicó\s+en producción/.test(guia), true);
igual("la guía: la tabla numera b23 como la 11 y b21b como la 12 (sin b24)",
	[/\| 11 \| `supabase\/mi_salon_b23_folio_incidencias_2026-09\.sql` \|/.test(guia), /\| 12 \| `supabase\/mi_salon_b21b_piloto_produccion_2026-09\.sql` \|/.test(guia), /\| \d+ \| `supabase\/mi_salon_b24/.test(guia)], [true, true, false]);
igual("la guía: la comprobación final ya no trae la columna b24 ni pda_de_alumno_en_producto", [/as b24/.test(guia), /pda_de_alumno_en_producto/.test(guia)], [false, false]);
igual("la guía: el estado real dice que falta solo b21b", /YA están\s+aplicadas en producción[\s\S]{0,160}falta solo b21b:/.test(guia), true);
igual("la guía: la carga de PP-NIVELES pide b17 (ya aplicada) y el push a main, con --simular y --aplicar",
	/## 5b\. Cargar PP-NIVELES/.test(guia) && /necesita b17, ya aplicada/.test(guia) && /del paso 5 \(el push a `main`\)/.test(guia) &&
	/cargar-pp-niveles\.js --base prod --grupo \S+ --simular/.test(guia) && /cargar-pp-niveles\.js --base prod --grupo \S+ --aplicar/.test(guia), true);

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

// ── b26 (constructor AX, 2026-09-29): el bucket `recursos` solo para la cuenta que subió cada archivo ──
// Va aparte (no depende de nada ni redefine delete_own_account), idempotente y sin begin/commit. Sin
// política de INSERT: Mi Salón solo guarda enlaces (decisión de Jorge del 2026-09-29).
{
	const B26 = "mi_salon_b26_recursos_storage_2026-10.sql";
	const sql = leer(B26);
	const codigo = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
	const politica = (nombre, cmd) => new RegExp("drop policy if exists \"" + nombre + "\" on storage\\.objects;\\s*create policy \"" + nombre +
		"\" on storage\\.objects\\s+for " + cmd + " to authenticated\\s+using \\(bucket_id = 'recursos' and \\(storage\\.foldername\\(name\\)\\)\\[2\\] = auth\\.uid\\(\\)::text\\);").test(codigo);
	igual("b26: quita las tres políticas abiertas del bucket recursos",
		["recursos_select_autenticado", "recursos_upload_autenticado", "recursos_delete_autenticado"].map((p) => codigo.indexOf("drop policy if exists \"" + p + "\" on storage.objects;") !== -1), [true, true, true]);
	igual("b26: SELECT y DELETE solo para la propia cuenta (to authenticated, carpeta [2] = auth.uid())",
		[politica("recursos: lectura de la propia cuenta", "select"), politica("recursos: borrado de la propia cuenta", "delete")], [true, true]);
	igual("b26: solo esas dos políticas nuevas, ninguna de INSERT ni UPDATE (la de INSERT queda comentada)",
		[(codigo.match(/create policy/g) || []).length, /for (insert|update|all)/.test(codigo), /create policy "recursos: subida de la propia cuenta"[\s\S]*for insert to authenticated/.test(sql)], [2, false, true]);
	igual("b26: sin begin/commit, sin tocar objetos, buckets ni assets, y sin delete_own_account",
		[/\b(begin|commit)\s*;/i.test(codigo), /(insert into|update|delete from|truncate)\s+storage\./i.test(codigo), /assets/.test(codigo), /delete_own_account/.test(codigo)], [false, false, false, false]);
	igual("b26: idempotente (cada create policy tiene antes su drop policy if exists)",
		(codigo.match(/create policy "([^"]+)"/g) || []).every((c) => codigo.indexOf("drop policy if exists " + c.slice("create policy ".length)) !== -1 &&
			codigo.indexOf("drop policy if exists " + c.slice("create policy ".length)) < codigo.indexOf(c)), true);
	igual("b26: no está en la cadena de delete_own_account (va aparte)", ORDEN.indexOf(B26), -1);
	const i26 = comandos.findIndex((l) => l.indexOf(B26) !== -1);
	igual("la guía: b26 va en su propio comando, después de la cadena y de b21b, y solo con su archivo",
		[i26 > iCadena + 1, archivosDe(comandos[i26])], [true, [B26]]);
	igual("la guía: b26 trae su comprobación (las dos políticas) y dice que no crea INSERT",
		/## Aparte: b26[\s\S]*"recursos: borrado de la propia cuenta" \{authenticated\} DELETE[\s\S]*"recursos: lectura de la propia cuenta" \{authenticated\} SELECT/.test(guia) &&
		/## Aparte: b26[\s\S]{0,1200}No crea política de\s+INSERT/.test(guia), true);
}

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
