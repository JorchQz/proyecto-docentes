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
const bloque = { campo: "ETI", fecha: "2026-09-29" };
ok("destino: dentro del proyecto, a la sesión elegida", N.destino({ modo: "dentro", tipo: "trabajo", campo: "LEN" }), "sesion");
ok("destino: fuera del proyecto, una suelta (agregar_actividad_suelta)", N.destino({ modo: "fuera", tipo: "trabajo", campo: "LEN", dia: "2026-09-29", hoy: "2026-09-29" }), "suelta");
ok("destino: desde un bloque de sueltas sin cambiar día ni campo, a esa misma sesión (como antes)",
	N.destino({ modo: "fuera", tipo: "trabajo", campo: "ETI", dia: "2026-09-29", hoy: "2026-09-29", suelta: bloque }), "sesion");
ok("destino: desde un bloque de sueltas con otro día u otro campo, una suelta de ese día y campo",
	[N.destino({ modo: "fuera", tipo: "trabajo", campo: "ETI", dia: "2026-09-28", hoy: "2026-09-29", suelta: bloque }),
		N.destino({ modo: "fuera", tipo: "trabajo", campo: "LEN", dia: "2026-09-29", hoy: "2026-09-29", suelta: bloque })], ["suelta", "suelta"]);
ok("destino: una tarea desde un bloque de sueltas: a esa sesión solo si el bloque es de hoy (la tarea suelta se deja hoy)",
	[N.destino({ modo: "fuera", tipo: "tarea", campo: "ETI", dia: "2026-09-24", hoy: "2026-09-29", suelta: bloque }),
		N.destino({ modo: "fuera", tipo: "tarea", campo: "ETI", dia: "2026-09-24", hoy: "2026-09-29", suelta: { campo: "ETI", fecha: "2026-09-24" } })], ["sesion", "suelta"]);

// ── 4. crearParaSuelta: los PDA de un bloque de sueltas, pedidos para la sesión de otro día ──
const spda = [{ id: "s1", pda_id: "P1", grado: 1 }, { id: "s2", pda_id: "P2", grado: 2 }, { id: "s3", pda_id: null, grado: 1, criterio_aplicado: "solo criterio" }];
ok("crearParaSuelta: los ligados como (pda_id, grado) más los del catálogo, sin repetir; uno sin pda_id no pasa",
	N.crearParaSuelta({ ligar: ["s1", "s3", "s2"], crear: [{ pda_id: "P1", grado: 1 }, { pda_id: "P9", grado: 2 }] }, spda),
	[{ pda_id: "P1", grado: 1 }, { pda_id: "P2", grado: 2 }, { pda_id: "P9", grado: 2 }]);
ok("crearParaSuelta: sin ligas, lo del catálogo tal cual", N.crearParaSuelta({ ligar: [], crear: [{ pda_id: "P9", grado: 2 }] }, []), [{ pda_id: "P9", grado: 2 }]);

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
ok("«Cambiar» abre el buscador y lo elegido ahí reemplaza a los contenidos de la sesión; «Usar los de la sesión» regresa",
	/data-cambiar-contenido/.test(js) && /if \(!e\.target\.closest\("\[data-cambiar-contenido\]"\)\) return;\s*pda\.buscar = true;/.test(js) &&
	/pda\.contenido = c;\s*pda\.buscar = true;/.test(js) && /refs\.volver\.addEventListener\("click", function \(\) \{\s*pda\.buscar = false;/.test(js), true);
const elec = js.split("function eleccionPda() {")[1].split("\n\t\t}")[0];
ok("al agregar: con los contenidos de la sesión a la vista, sus PDA marcados; con el buscador, los del contenido elegido",
	/var deSesion = enSesion \? visibles\.filter\(marcadoSesion\)/.test(elec) && /var deCatalogo = enSesion \? \[\] :/.test(elec) && /if \(pda\.spda === null\) return null;/.test(elec), true);
ok("los PDA de la sesión se marcan por la regla de siempre (r.marcado) salvo lo que tocó el docente",
	/hasOwnProperty\.call\(pda\.tocadosSesion, r\.id\) \? pda\.tocadosSesion\[r\.id\] : !!r\.marcado/.test(js), true);
ok("dentro: agregar_producto_sesion; fuera: agregar_actividad_suelta (los dos, en una transacción)",
	/rpc\("agregar_actividad_suelta", \{ p_grupo: grupo\.id, p_fecha: v\.fecha, p_producto: producto,\s*p_asignacion: plan\.filas, p_crear: suelta \? crearParaSuelta\(ligas, pda\.spda\) : ligas\.crear \}\)/.test(js) &&
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
ok("Hoy: sin señal el diálogo no se abre (lo dice, como antes)", /if \(sinSenal\(\)\) \{ mensaje\("error", "Agregar una actividad o una tarea necesita señal\./.test(hoy), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
