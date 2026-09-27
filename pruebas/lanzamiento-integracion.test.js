/*
	Integración del lanzamiento de Mi Salón (constructor AN, 2026-09-26): decisiones de Jorge que
	cruzan el registro histórico (b20), el acceso (b21) y los cobros (b22).

	B1. La calificación directa cuenta YA como confirmada: el trigger de b20 la pone como la
	    confirmada de boleta_trimestral (lo prueba en la base pruebas/sql/calificacion-directa.sql);
	    aquí, que la pantalla de Ponte al día la deje cambiar o borrar mientras la boleta no esté
	    cerrada (también ya confirmada), que no diga que es "solo una propuesta" y que Exportar y la
	    junta sigan leyendo la confirmada de boleta_trimestral (así la directa sale ahí).
	B2. "Ponte al día" también al crear un grupo adicional (onboarding.html?nuevo=1).
	B3. "Sin clase" en la asistencia pasada se guarda como suspensión en calendario_ajustes del
	    grupo, con confirmación, antes de la asistencia, y se puede quitar desde Calendario.
	(B5, capturado_en de la cola en asistencia: pruebas/bandeja-salida.test.js §13.)

	node pruebas/lanzamiento-integracion.test.js
*/
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── B1 ──────────────────────────────────────────────────────────────────────
const b20 = leer("supabase/mi_salon_b20_registro_historico_2026-09.sql");
ok("B1 base: trigger de la directa a la boleta (alta, cambio y borrado) y espejo de la boleta a la directa",
	[/create trigger calificacion_directa_a_boleta\s+after insert or update of calificacion or delete on public\.calificacion_directa/.test(b20),
		/create trigger boleta_trimestral_a_directa\s+after insert or update of calificacion, calificacion_confirmada on public\.boleta_trimestral/.test(b20),
		/calificacion_confirmada = true/.test(b20), /pg_trigger_depth\(\) > 1/.test(b20)], [true, true, true, true]);
ok("B1 base: los triggers son SECURITY INVOKER (pasan por RLS y por el candado)",
	(b20.match(/function public\.(calificacion_directa_a_boleta|boleta_a_calificacion_directa)\(\)\s+returns trigger\s+language plpgsql\s+security invoker/g) || []).length, 2);

const pad = leer("js/ponte-al-dia.js");
ok("B1 Ponte al día: la directa ya confirmada se puede cambiar o borrar mientras la boleta no esté cerrada",
	/var editable = boletaVista\.directa && !cerrada && \(!of\.confirmada \|\| directa\);/.test(pad), true);
ok("B1 Ponte al día: rotula 'capturada directamente · confirmada'", /capturada directamente · confirmada/.test(pad), true);
ok("B1 Ponte al día: tras guardar, relee la boleta del alumno (la confirmada cambió)",
	/boletaVista\.boletas\[a\.id\] = bol\[a\.id\];/.test(pad), true);
ok("B1 Ponte al día: ya no dice que la directa es solo una propuesta",
	[/la boleta las propone en lugar del cálculo/.test(pad), /cada una queda ya confirmada en la boleta de ese campo/.test(pad)], [false, true]);
const rep = leer("js/reportes.js");
ok("B1 Reportes: borrar la directa avisa que deja de estar confirmada", [/Una calificación que ya confirmaste no cambia/.test(rep), /deja de estar confirmada/.test(rep)], [false, true]);
ok("B1 Qué le falta: la directa ya cuenta como la confirmada", /Ya cuenta como la confirmada de la boleta/.test(leer("js/que-le-falta.js")), true);
// Exportar y la junta toman la confirmada de boleta_trimestral: con el trigger, la directa sale ahí
const datos = leer("js/reporte-datos.js");
ok("B1 Exportar/junta/boleta: la oficial es la confirmada de boleta_trimestral (calificacionOficial)",
	/if \(!filaBoleta \|\| !filaBoleta\.calificacion_confirmada/.test(datos), true);
ok("B1 Exportar solo exporta confirmadas y la junta lee la oficial",
	[/calificacionOficial|calificacion_confirmada/.test(leer("js/exportar.js")), /calificacionOficial|calificacion_confirmada/.test(leer("js/junta.js"))], [true, true]);

// ── B2 ──────────────────────────────────────────────────────────────────────
const onb = leer("js/onboarding.js");
ok("B2 grupo adicional: la misma alta (nuevo=1) abre Ponte al día si el trimestre ya empezó, con el grupo nuevo activo",
	[/\[\?&\]nuevo=1\\b/.test(onb), /var ofrece = ofrecePonteAlDia\(\);\s+var destino = ofrece \? "ponte-al-dia\.html\?desde=alta" : "dashboard\.html";/.test(onb),
		/GrupoActivo\.elegir\(currentGroupId\)/.test(onb)], [true, true, true]);
ok("B2 el aviso de Ponte al día se pinta también en el alta de otro grupo (no depende de nuevo=1)",
	/function pintarAvisoPonte\(\)/.test(onb) && !/nuevo[^\n]*pintarAvisoPonte|pintarAvisoPonte[^\n]*nuevo/.test(onb), true);

// ── B3 ──────────────────────────────────────────────────────────────────────
const H = require(path.join(RAIZ, "js/historico.js"));
ok("B3 filasSinClase: suspensión por grupo y fecha, en orden, solo días hábiles",
	H.filasSinClase({ sinClase: { "2026-09-18": true, "2026-09-01": true, "2026-09-19": true, "2026-09-02": false, "x": true }, maestroId: "m", grupoId: "g" }),
	[{ maestro_id: "m", grupo_id: "g", fecha: "2026-09-01", tipo: "suspension", motivo: H.MOTIVO_SIN_CLASE },
		{ maestro_id: "m", grupo_id: "g", fecha: "2026-09-18", tipo: "suspension", motivo: H.MOTIVO_SIN_CLASE }]);
ok("B3 el motivo cabe en la base (140 letras como máximo)", H.MOTIVO_SIN_CLASE.length <= 140, true);
ok("B3 filasSinClase sin días: nada", H.filasSinClase({ sinClase: {} }), []);
const guardar = (pad.match(/async function guardarAsistencia\(\) \{[\s\S]*?\n\t\}/) || [""])[0];
ok("B3 guardar: confirma, guarda en calendario_ajustes (llave grupo_id,fecha) ANTES de la asistencia y actualiza los ajustes",
	[/window\.confirm\(/.test(guardar), /from\("calendario_ajustes"\)\.upsert\(sinClase, \{ onConflict: "grupo_id,fecha" \}\)/.test(guardar),
		guardar.indexOf("calendario_ajustes") < guardar.indexOf('from("asistencias")'), /ajustesCal = /.test(guardar)], [true, true, true, true]);
ok("B3 guardar: si el usuario cancela la confirmación no guarda nada",
	/if \(sinClase\.length && !window\.confirm\([\s\S]*?\)\) return;/.test(guardar), true);
ok("B3 guardar: si el calendario falla no se guarda la asistencia", /No se pudieron guardar los días sin clase[\s\S]*?return;/.test(guardar), true);
ok("B3 la pantalla dice que se quita desde Calendario", /se quita desde Calendario/.test(pad), true);
// La suspensión quita el día de los días de clase (mismo cálculo que Asistencia y Qué le falta)
global.window = global.window || {};
const CS = require(path.join(RAIZ, "js/calendario-sep.js"));
window.CalendarioSEP = CS;
const CE = require(path.join(RAIZ, "js/calendario-escolar.js"));
window.CalendarioEscolar = CE;
const dias = H.diasHistoricos("2026-09-14", "2026-09-19", []);
const diasCon = H.diasHistoricos("2026-09-14", "2026-09-19", H.filasSinClase({ sinClase: { "2026-09-17": true }, maestroId: "m", grupoId: "g" }));
ok("B3 un día guardado sin clase deja de ser día de clase", [dias.indexOf("2026-09-17") !== -1, diasCon.indexOf("2026-09-17") === -1, dias.length - diasCon.length], [true, true, 1]);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
