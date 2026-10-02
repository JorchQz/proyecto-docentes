/*
	"+ Actividad o tarea" (Fase 4 del plan de Fanny, 2026-09-29): js/actividad-nueva.js, el único diálogo para agregar
	una actividad o una tarea en Hoy, sacado de agregarProducto (js/hoy.js). Aquí:
	  - sus reglas puras: contenidosDeSesion (los contenidos de la sesión, ya elegidos), destino (a qué sesión va),
	    crearParaSuelta (los PDA de un bloque de sueltas pedidos para otro día) y conCampo;
	  - lo que el código tiene que decir: la lectura de los PDA de la sesión trae su contenido del catálogo, el orden de
	    los campos, las etiquetas del interruptor y de "¿Para quién?", "Cambiar" y que las reglas son las de ProductosHoy;
	  - cómo lo usa Hoy (el botón de arriba de la tarjeta 3, el de cada sesión y ?nueva=).
	Que deja las MISMAS filas que el diálogo de antes se comprueba contra la base de pruebas (la prueba dorada del
	constructor AY, .qa/constructor-ay/dorada.js).

	node pruebas/actividad-nueva.test.js
*/
const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + (bien ? "" : " → " + JSON.stringify(real) + " (esperado " + JSON.stringify(esperado) + ")"));
}
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n");

global.window = global;
require("../js/campos-formativos.js");
require("../js/alcance-hoy.js");
require("../js/productos-hoy.js");
const N = require("../js/actividad-nueva.js");

// ── 1. contenidosDeSesion: los contenidos de la sesión, ya elegidos, con sus PDA ──
const fila = (id, grado, contenidoId, contenido, pda) => ({ id: id, pda_id: "p-" + id, grado: grado, criterio_aplicado: null,
	catalogo_pda: contenidoId ? { pda: pda || "PDA " + id, contenido_id: contenidoId, catalogo_contenidos: { id: contenidoId, contenido: contenido, campo_formativo: "Lenguajes" } } : null });
const grupos = N.contenidosDeSesion([
	fila("a1", 1, "c1", "Escritura de nombres"), { id: "sin", pda_id: null, grado: 1, criterio_aplicado: "Criterio propio", catalogo_pda: null },
	fila("a2", 2, "c1", "Escritura de nombres"), fila("b1", 1, "c2", "Descripción de objetos"),
	// PostgREST también puede dar la relación como arreglo
	{ id: "b2", pda_id: "p-b2", grado: 2, catalogo_pda: [{ pda: "x", contenido_id: "c2", catalogo_contenidos: [{ id: "c2", contenido: "Descripción de objetos", campo_formativo: "Lenguajes" }] }] },
]);
ok("contenidosDeSesion: un grupo por contenido, en el orden en que aparecen; los PDA sin contenido del catálogo al final",
	grupos.map((g) => [g.id, g.contenido, g.pda.map((r) => r.id)]),
	[["c1", "Escritura de nombres", ["a1", "a2"]], ["c2", "Descripción de objetos", ["b1", "b2"]], [null, "", ["sin"]]]);
ok("contenidosDeSesion: sin filas, ninguno", [N.contenidosDeSesion([]), N.contenidosDeSesion(null)], [[], []]);

// ── 2. conCampo: el campo de un PDA de la sesión es el de su contenido en el catálogo (código corto) ──
ok("conCampo: el código corto del campo de su contenido, o null", [N.conCampo(fila("a1", 1, "c1", "Escritura")).campo, N.conCampo({ id: "x", catalogo_pda: null }).campo],
	["LEN", null]);

// ── 3. destino: a qué sesión va lo que se agrega ──
const bloque = { id: "sx", campo_formativo: "Ética, Naturaleza y Sociedades", fecha: "2026-09-24" };
ok("destino: dentro del proyecto, a la sesión elegida", N.destino({ modo: "dentro" }), "sesion");
ok("destino: fuera del proyecto, una suelta (agregar_actividad_suelta)", N.destino({ modo: "fuera" }), "suelta");
// Como en 7971358: desde un bloque de sueltas va SIEMPRE a esa sesión (también con otro campo, y una tarea de un día pasado)
ok("destino: desde un bloque de sueltas, a esa misma sesión (como antes de la Fase 4)", N.destino({ modo: "fuera", suelta: bloque }), "sesion");
ok("destino: desde un bloque de sueltas pero cambiado a dentro del proyecto, a la sesión elegida", N.destino({ modo: "dentro", suelta: bloque }), "sesion");
ok("ya no hay crearParaSuelta (un bloque de sueltas no se manda a otra sesión)", typeof N.crearParaSuelta, "undefined");

// ── 5. Lo que el código dice ──
const js = leer("js/actividad-nueva.js");
ok("la lectura de los PDA de la sesión trae su contenido del catálogo (para precargarlo)",
	/from\("sesiones_pda"\)\s*\.select\("id, pda_id, grado, criterio_aplicado, catalogo_pda\(pda, contenido_id, catalogo_contenidos\(id, contenido, campo_formativo\)\)"\)\s*\.eq\("sesion_id", sesion\.id\)/.test(js), true);
ok("la lectura revisa su error (si falla: como antes, sin PDA y se dice al agregar)", /if \(res\.error\) throw res\.error;[\s\S]{0,300}spda = \(res\.data \|\| \[\]\)\.map\(conCampo\);[\s\S]{0,200}spda = null;/.test(js), true);
// El orden de los campos: nombre, qué es, para quién, campo formativo, contenido y PDA (el interruptor y la sesión o el día, arriba)
const cons = js.split("construir: function (cuerpo) {")[1].split("alAceptar:")[0];
const orden = ["construirDonde(cuerpo)", 'campoTexto("Nombre"', "¿Qué es?", "construirParaQuien(porOmision())", '"Campo formativo"', "construirPda(cuerpo)"].map((t) => cons.indexOf(t));
ok("orden de los campos: dónde va, nombre, qué es, para quién, campo formativo, contenido y PDA", orden.every((x, i) => x !== -1 && (i === 0 || x > orden[i - 1])), true);
ok("interruptor «Dentro del proyecto / Fuera del proyecto»", /\[\["dentro", "Dentro del proyecto"\], \["fuera", "Fuera del proyecto"\]\]/.test(js), true);
ok("¿Para quién?: Grupo / Grado(s) / Alumno(s), con el grado con que trabajan", /\[\["grupo", "Grupo"\]\]/.test(js) && /\["grados", "Grado\(s\)"\]/.test(js) && /\["alumnos", "Alumno\(s\)"\]/.test(js) &&
	/¿Con qué grado trabajan\?/.test(js), true);
ok("usa el diálogo y la lista de alumnos de js/para-quien.js", /raiz\.ParaQuien\.abrirDialogo\(\{/.test(js) && /raiz\.ParaQuien\.listaAlumnosHtml\(alumnos, "alumnoNuevo", \{\}, \{\}\)/.test(js), true);
ok("las reglas son las de ProductosHoy (sin copias)", ["planAsignacion", "validarNuevo", "validarSuelta", "pdaDeSesionParaActividad", "pdaMarcadosPorOmision", "planLigas", "buscarContenidos", "fasesDeGrados"]
	.every((f) => new RegExp("PH\\(\\)\\." + f + "\\(").test(js)) && !/function (planAsignacion|validarNuevo|planLigas|pdaDeSesionParaActividad)\(/.test(js), true);
ok("«+ Otro contenido» abre el buscador SIN quitar lo de la sesión; «Cambiar» lo reemplaza; «Usar los de la sesión» regresa",
	/data-otro-contenido/.test(js) && /data-cambiar-contenido/.test(js) &&
	/pda\.modo = b\.hasAttribute\("data-otro-contenido"\) \? "otro" : "cambiar";/.test(js) &&
	/function conContenidosDeSesion\(visibles\) \{ return pda\.modo !== "cambiar" && visibles\.length > 0; \}/.test(js) &&
	/function conBuscador\(visibles\) \{ return pda\.modo !== "sesion" \|\| !visibles\.length; \}/.test(js) &&
	/refs\.volver\.addEventListener\("click", function \(\) \{\s*pda\.modo = "sesion";\s*quitarContenido\(\);/.test(js), true);
ok("lo elegido con el buscador directo (sin contenidos de la sesión) se suma, como «+ Otro contenido»", /pda\.contenido = c;[\s\S]{0,200}if \(pda\.modo === "sesion"\) pda\.modo = "otro";/.test(js), true);
ok("con los de la sesión a la vista, el contenido del catálogo no repite los PDA que ya están arriba (como antes)",
	/if \(conContenidosDeSesion\(visibles\)\) visibles\.forEach\(function \(r\) \{ if \(r\.pda_id\) yaArriba\[r\.pda_id \+ "\|" \+ Number\(r\.grado\)\] = true; \}\);/.test(js) &&
	/Sus PDA de estos grados ya están arriba, entre los de esta sesión\./.test(js), true);
const elec = js.split("function eleccionPda() {")[1].split("\n\t\t}")[0];
ok("al agregar, la cuenta de antes de la Fase 4 (fuera): los PDA marcados de la sesión (salvo con «Cambiar») más los marcados del catálogo; dentro, solo los de la sesión",
	/var deSesion = pdaDeSesionALigar\(visibles, \{ fijo: fijo, modo: pda\.modo, tocados: pda\.tocadosSesion \}\);/.test(elec) &&
	/var deCatalogo = fijo \? \[\] : \(pda\.pdaContenido \|\| \[\]\)\.filter\(function \(p\) \{ return pda\.marcadosCatalogo\[p\.id\] && g\.indexOf\(Number\(p\.grado\)\) !== -1; \}\)/.test(elec) &&
	/if \(pda\.spda === null\) return null;/.test(elec), true);

// ── 7. Dentro del proyecto todo es de la sesión (decisión de Jorge, 2026-10-02) ──
const marcada = (id, grado) => ({ id, grado, marcado: true }), noMarcada = (id, grado) => ({ id, grado, marcado: false });
const visiblesEj = [marcada("a", 1), noMarcada("b", 1), marcada("c", 2)];
ok("pdaDeSesionALigar dentro (fijo): exactamente los marcados por la regla, aunque el docente haya tocado algo o el modo sea otro",
	[N.pdaDeSesionALigar(visiblesEj, { fijo: true }), N.pdaDeSesionALigar(visiblesEj, { fijo: true, modo: "cambiar", tocados: { a: false, b: true } })], [["a", "c"], ["a", "c"]]);
ok("pdaDeSesionALigar fuera: lo que marcó el docente, o la regla si no lo tocó; con «Cambiar», ninguno de la sesión",
	[N.pdaDeSesionALigar(visiblesEj, { modo: "sesion", tocados: {} }), N.pdaDeSesionALigar(visiblesEj, { modo: "otro", tocados: { a: false, b: true } }),
		N.pdaDeSesionALigar(visiblesEj, { modo: "cambiar", tocados: {} }), N.pdaDeSesionALigar([], { modo: "sesion" })], [["a", "c"], ["b", "c"], [], []]);
ok("campoGuardado: dentro, el campo de la sesión (aunque el selector diga otro); fuera, el elegido",
	[N.campoGuardado({ fijo: true, campoSesion: "LEN", campoElegido: "SAB" }), N.campoGuardado({ fijo: false, campoSesion: "LEN", campoElegido: "SAB" })], ["LEN", "SAB"]);
ok("dentro: el campo se ve como texto y el selector queda deshabilitado y oculto", /refs\.campoFijo\.textContent = fijo \? "Campo formativo: " \+ campoLargo\(cs\) : "";/.test(js) &&
	/sel\.disabled = fijo;/.test(js) && /function campoFijo\(\) \{ return st\.modo === "dentro" && !!st\.sesion && !!campoSesion\(\); \}/.test(js), true);
ok("dentro: contenido y PDA de solo lectura (casillas marcadas y deshabilitadas, sin buscador, sin Cambiar ni + Otro contenido)",
	/if \(campoFijo\(\)\) \{ pintarPdaFijos\(visibles\); return; \}/.test(js) && /name='pdaSesionFijo' disabled checked/.test(js) &&
	!/data-cambiar-contenido|data-otro-contenido/.test(js.split("function pintarPdaFijos(visibles) {")[1].split("function pintarResultados()")[0]) &&
	/refs\.buscador\.classList\.add\("hidden"\);/.test(js.split("function pintarPdaFijos(visibles) {")[1].split("function pintarResultados()")[0]), true);
ok("dentro, sin PDA para esos grados: el texto de siempre y se guarda sin PDA", js.indexOf("Esta sesión no tiene PDA para ese grado: se guarda sin PDA.") !== -1, true);
ok("al cambiar el interruptor o la sesión, el campo vuelve a ser el del modo (nada «tocado» sobrevive)", /st\.campoTocado = false;[\s\S]{0,200}quitarContenido\(\);\s*llenarCampos\(\);/.test(js), true);
ok("al agregar, el campo que se guarda sale de campoGuardado", /campo: campoGuardado\(\{ fijo: campoFijo\(\), campoSesion: campoSesion\(\), campoElegido: refs\.campo\.value \}\),/.test(js), true);
ok("desde un bloque de sueltas: en lugar del día, a qué bloque va (va a esa sesión)",
	/if \(suelta\) \{\s*var bloque = document\.createElement\("p"\);\s*bloque\.setAttribute\("data-bloque-suelta", "1"\);/.test(js) &&
	/refs\.diaCont\.classList\.toggle\("hidden", st\.modo !== "fuera" \|\| tarea \|\| !!suelta\);/.test(js) && /fecha: st\.modo === "fuera" && !suelta \? refs\.dia\.value : null,/.test(js), true);
ok("los PDA de la sesión se marcan por la regla de siempre (r.marcado) salvo lo que tocó el docente",
	/hasOwnProperty\.call\(pda\.tocadosSesion, r\.id\) \? pda\.tocadosSesion\[r\.id\] : !!r\.marcado/.test(js), true);
ok("dentro: agregar_producto_sesion; fuera: agregar_actividad_suelta (los dos, en una transacción)",
	/rpc\("agregar_actividad_suelta", \{ p_grupo: grupo\.id, p_fecha: v\.fecha, p_producto: producto,\s*p_asignacion: plan\.filas, p_crear: ligas\.crear \}\)/.test(js) &&
	/rpc\("agregar_producto_sesion", \{ p_sesion: sesion\.id, p_producto: producto,\s*p_asignacion: plan\.filas, p_ligar: ligas\.ligar, p_crear: ligas\.crear \}\)/.test(js), true);
ok("dentro sin sesión elegida no agrega: «Elige la sesión del proyecto.»", /if \(st\.modo === "dentro" && !st\.sesion\) \{ avisar\("Elige la sesión del proyecto\.", refs\.sesion\); return false; \}/.test(js), true);
ok("sin señal no agrega (no va por la cola)", /if \(ctx\.sinSenal && ctx\.sinSenal\(\)\) \{ avisar\(ctx\.textoSinSenal\); return false; \}/.test(js), true);
ok("una lectura de PDA que llega tarde no pisa a la de otra sesión", /if \(n !== lecturaSpda\) return;/.test(js), true);
ok("controles de al menos 44 px", (js.match(/min-h-\[44px\]/g) || []).length >= 6 && !/min-h-\[(3\d|40)px\]/.test(js), true);

// ── 6. Cómo lo usa Hoy ──
const hoy = leer("js/hoy.js"), hoyHtml = leer("hoy.html").replace(/<!--[\s\S]*?-->/g, ""), dash = leer("js/dashboard.js");
ok("Hoy: «+ Actividad o tarea» arriba de la tarjeta 3 (reemplaza a «Actividad suelta»), con ícono SVG",
	/<section id="sesiones"[\s\S]{0,600}<button id="btnActividad"[^>]*min-h-\[44px\][^>]*><svg[^>]*aria-hidden="true">[\s\S]{0,200}<\/svg>Actividad o tarea<\/button>/.test(hoyHtml) && !/btnSuelta|Actividad suelta/.test(hoyHtml), true);
ok("Hoy: cada sesión tiene el mismo atajo, que abre el diálogo con esa sesión ya elegida",
	/if \(btnAgregar\) \{ agregarActividad\(\{ sesionId: btnAgregar\.dataset\.agregarProducto, origen: btnAgregar \}\); return; \}/.test(hoy) &&
	/sesionId: sesion && !deSueltas \? sesion\.id : null,/.test(hoy) && /sesionSuelta: deSueltas \? sesion : null,/.test(hoy), true);
ok("Hoy: dentro del proyecto se elige entre las sesiones de hoy y las que siguen en curso (sin las sueltas)",
	/sesiones: sesionesHoy\.filter\(function \(s\) \{ return !esSuelta\(s\); \}\),/.test(hoy) && /sesionesHoy = sesiones\.filter\(function \(s\) \{ return s\.fecha === hoy \|\| esEnCurso\(s\); \}\);/.test(hoy), true);
ok("Hoy: se siguen aceptando ?nueva=suelta (fuera) y ?nueva=1", /if \(nueva !== "suelta" && nueva !== "1"\) return;/.test(hoy), true);
ok("Inicio: el atajo abre el diálogo (?nueva=1) y dice «Actividad o tarea»", /<a href='hoy\.html\?nueva=1'[^>]*>" \+\s*"<svg[\s\S]{0,400}"Actividad o tarea<\/a>"/.test(dash) && !/Actividad suelta<\/a>/.test(dash), true);
ok("Hoy ya no tiene agregarProducto, su diálogo ni su lista de alumnos (se usan los de js/actividad-nueva.js y js/para-quien.js)",
	[/function agregarProducto\(/, /function abrirDialogo\(/, /function listaAlumnosHtml\(/, /function contenidosDelCatalogo\(/].map((r) => r.test(hoy)), [false, false, false, false]);
// Sin señal el diálogo no se abre y lo dice A LA VISTA (antes el aviso quedaba arriba, fuera de la pantalla)
ok("Hoy: sin señal el diálogo no se abre y lo dice a la vista", /if \(sinSenal\(\)\) \{ avisoALaVista\("Agregar una actividad o una tarea necesita señal\./.test(hoy), true);
// Renombrar y Quitar viven desde la Fase 5 en js/producto-acciones.js (sacados tal cual de Hoy): Hoy le pasa su avisoALaVista
const acciones = leer("js/producto-acciones.js");
ok("Hoy: sin señal, Renombrar, Quitar y Para quién también avisan a la vista (ninguno con mensaje(\"error\") por la señal)",
	[/if \(sinSenal\(\)\) \{ o\.avisoALaVista\("Renombrar necesita señal\. "/.test(acciones), /if \(sinSenal\(\)\) \{ o\.avisoALaVista\("Quitar necesita señal\. "/.test(acciones),
		/o\.avisoALaVista\(sinSenal\(\) \? "Quitar necesita señal\. "/.test(acciones), /if \(sinSenal\(\)\) \{ avisoALaVista\("Cambiar para quién es necesita señal\. "/.test(hoy),
		/avisoALaVista: avisoALaVista, mensaje: mensaje/.test(hoy)]
		.concat([/mensaje\("error", [^)]*necesita señal/.test(hoy + acciones)]), [true, true, true, true, true, false]);
// El aviso de error de un diálogo se desplaza a la vista dentro del diálogo (a 390 px quedaba abajo del borde)
ok("diálogo (js/para-quien.js): el aviso de error se desplaza a la vista; el foco va al campo sin mover lo que se ve",
	/foco\.focus\(\{ preventScroll: true \}\)/.test(leer("js/para-quien.js")) && /if \(texto && aviso\.scrollIntoView\) aviso\.scrollIntoView\(\{ block: "nearest" \}\);/.test(leer("js/para-quien.js")), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
