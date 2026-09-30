/*
	Zona táctil de 44 px (ancho Y alto) en lo que marcaron R23 y R24 (2026-09-26):
	  - Crear proyecto, paso 2: casillas de PDA y opciones del buscador de contenidos (36 px de alto).
	  - Chips "Quitar contenido", "Eliminar archivo" y "Eliminar link": se aplastaban a 390 (el
	    botón se encogía y los márgenes negativos lo sacaban de la ficha).
	  - Hoy: botones 0/1/2 del cierre del día (30-32 px de ancho).
	  - Onboarding: casillas de grado (41 px de ancho) y "Eliminar" alumno (59x24).
	  - Tienda: encabezado (logo 28 de alto, enlaces h-10) y pie (enlaces de 20 de alto).
	La medición real en navegador está en .qa/constructor-af/t01-tactil.js (fuera de git).

	node pruebas/zona-tactil-r23.test.js
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const cp = leer("js/crear_proyecto.js");
ok("crear: casilla de PDA del paso 2 con alto de 44", cp.includes('<label class="flex items-start gap-3 min-h-[44px] py-2.5 cursor-pointer">'), true);
ok("crear: opción del buscador de contenidos con alto de 44", cp.includes('class="contenido-option flex items-center min-h-[44px]'), true);
ok("crear: los botones de quitar (contenido, archivo, link) no se encogen ni usan márgenes negativos",
	[/remove-contenido-btn shrink-0[^"]*h-11 w-11/.test(cp), /resource-remove-file shrink-0[^"]*h-11 w-11/.test(cp), /resource-remove-link shrink-0[^"]*h-11 w-11/.test(cp), /-my-3 -mr-3/.test(cp)],
	[true, true, true, false]);

ok("crear: los renglones de actividades y tareas del paso 3 miden al menos 44 de alto (sin min-height en línea que lo pise)",
	[cp.includes('class="flex-1 min-h-[44px] px-3 py-2.5 border'), cp.includes('style="min-height:2.1rem"')], [true, false]);

const hoy = leer("js/hoy.js");
ok("Hoy: los chips (0/1/2 del cierre y demás) miden al menos 44 de ancho", /function chip\(texto, activo, clasesActivo, atributos\) \{\s*return "<button type='button' " \+ atributos \+ " class='min-h-\[44px\] min-w-\[44px\]/.test(hoy), true);
// Fase 4 (2026-09-29): "+ Actividad o tarea" arriba de la tarjeta 3 y en cada sesión, y los botones del diálogo nuevo
const nueva = leer("js/actividad-nueva.js");
ok("Hoy: «+ Actividad o tarea» (arriba y en cada sesión) y «Cambiar» / «Usar los de la sesión» del diálogo, con alto de 44",
	[/<button id="btnActividad"[^>]*min-h-\[44px\]/.test(leer("hoy.html")), /data-agregar-producto='" \+ ses\.id \+ "'[\s\S]{0,400}class='inline-flex items-center gap-1\.5 min-h-\[44px\]/.test(hoy),
		/data-cambiar-contenido aria-label='[^']*' class='shrink-0 min-h-\[44px\] min-w-\[44px\]/.test(nueva), /refs\.volver\.className = "self-start min-h-\[44px\]/.test(nueva)],
	[true, true, true, true]);

const ob = leer("onboarding.html"), obj = leer("js/onboarding.js");
ok("onboarding: las 6 casillas de grado con ancho de 44", (ob.match(/<label class="flex items-center gap-2 min-h-\[44px\] min-w-\[44px\] pr-2 select-none cursor-pointer">/g) || []).length, 6);
// Desde 2026-09-27 (Jorge) "Eliminar" es un bote de basura rojo y hay un lápiz azul para editar:
// los dos son botones de solo ícono de 44x44 (botonIcono)
ok("onboarding: lápiz y bote de basura de 44x44", /function botonIcono\([^)]*\) \{[\s\S]{0,200}b\.className = "shrink-0 inline-flex items-center justify-center h-11 w-11 min-h-\[44px\] min-w-\[44px\]/.test(obj), true);
ok("onboarding: botones de grado de al menos 44 de alto y de ancho", /"min-h-\[44px\] min-w-\[52px\] px-4 rounded-xl border/.test(obj), true);

ok("exámenes: 'Volver a Inicio' del estado vacío con alto de 44", leer("js/examen.js").includes('<a href="dashboard.html" class="inline-flex items-center justify-center min-h-[44px] px-3 mt-4'), true);

const tc = leer("tienda/js/tienda-common.js");
ok("tienda: logo del encabezado con alto de 44", tc.includes('data-logo class="shrink-0 flex items-center gap-2 min-h-[44px]"'), true);
ok("tienda: enlaces del encabezado h-11 (no h-10)", /inline-flex items-center h-10 px-3\.5/.test(tc), false);
ok("tienda: los 5 enlaces del pie con 44x44", (tc.match(/class="inline-flex items-center justify-center min-h-\[44px\] min-w-\[44px\] hover:text-ink transition">/g) || []).length, 5);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
