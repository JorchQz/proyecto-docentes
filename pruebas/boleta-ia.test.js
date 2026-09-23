/*
	Capa 2 (IA) y Capa 1 conviviendo en boleta_trimestral (bloque 3.8).

	Extrae guardarTextosPropuestos tal cual está en js/reportes.js y comprueba:
	  - lo que redactó la IA (texto_autogenerado.visible = "ia") no se pisa al reabrir
	    la boleta; solo "Volver a proponer" lo reemplaza;
	  - lo que escribió el maestro (editado_manual) nunca se pisa;
	  - la redacción de la IA se conserva en texto_autogenerado.ia aunque la Capa 1
	    vuelva a proponer.

	node pruebas/boleta-ia.test.js      (REPORTES_JS=ruta para probar otra copia)
*/

const fs = require("fs");
const path = require("path");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

global.window = {};
require("../js/textos-boleta.js");

const fuente = fs.readFileSync(process.env.REPORTES_JS || path.join(__dirname, "..", "js", "reportes.js"), "utf8");
const m = fuente.match(/\n\tasync function guardarTextosPropuestos\([\s\S]*?\n\t\}/);
const mUpsert = fuente.match(/\n\tasync function upsertPorForma\([\s\S]*?\n\t\}/);
if (!m || !mUpsert) { console.log("FALLA no se encontró guardarTextosPropuestos / upsertPorForma en js/reportes.js"); process.exit(1); }

// Supabase falso que se comporta como PostgREST: el upsert de varias filas usa la
// UNIÓN de columnas y a la fila que no trae una le pone NULL (así se borraban textos).
let escrito = null, llamadas = 0;
window.sb = {
	from: function () {
		return {
			upsert: async function (filas) {
				llamadas++;
				const columnas = new Set();
				filas.forEach(function (f) { Object.keys(f).forEach(function (k) { columnas.add(k); }); });
				filas.forEach(function (f) {
					const completa = {};
					columnas.forEach(function (k) { completa[k] = k in f ? f[k] : null; });
					escrito.push(completa);
				});
				return { error: null };
			},
		};
	},
};
const userId = "maestro-1";
const CODIGOS = ["LEN", "SAB", "ETI", "DHL"];
const guardarTextosPropuestos = new Function("window", "userId", "CODIGOS",
	mUpsert[0] + "\n" + m[0] + "\nreturn guardarTextosPropuestos;")(window, userId, CODIGOS);
async function guardar(textos, boleta, ctx, forzar) {
	escrito = []; llamadas = 0;
	await guardarTextosPropuestos(textos, boleta, ctx, forzar);
}

const textos = {
	LEN: { fortalezas: ["Lee con fluidez."], areas: [], sugerencias: [] },
	SAB: { fortalezas: [], areas: ["Le cuesta explicar lo que observa."], sugerencias: ["Platicar en casa sobre lo que observa."] },
	ETI: { fortalezas: ["Participa en los acuerdos."], areas: [], sugerencias: [] },
	DHL: { fortalezas: ["Colabora con su equipo."], areas: [], sugerencias: [] },
	GEN: { fortalezas: [], areas: [], sugerencias: [] },
};
const ia = { fortalezas: "Juan lee con fluidez y gusto.", areas_oportunidad: "", sugerencias: "", generado_en: "2026-09-23T10:00:00Z", modelo: "claude-opus-5" };
const ctx = { alumnoId: "al-1", ciclo: "2026-2027", trimestre: 1 };

(async function () {
	function base() {
		return {
			// Redactado con IA y sin tocar por el maestro
			LEN: { id: "1", editado_manual: false, fortalezas: ia.fortalezas, texto_autogenerado: { fortalezas: "Lee con fluidez.", ia: ia, visible: "ia" } },
			// El maestro lo escribió a mano (y además hay una redacción de IA guardada)
			SAB: { id: "2", editado_manual: true, fortalezas: "Mío.", texto_autogenerado: { ia: ia, visible: "reglas" } },
			// Solo Capa 1
			ETI: { id: "3", editado_manual: false, fortalezas: "Participa en los acuerdos.", texto_autogenerado: { fortalezas: "Participa en los acuerdos." } },
			// Sin fila previa: DHL
		};
	}

	// 1. Reabrir la boleta (forzar = false)
	let boleta = base();
	await guardar(textos, boleta, ctx, false);
	const porCampo = {};
	escrito.forEach(function (f) { porCampo[f.campo] = f; });

	ok("IA sin tocar: no se reescriben los cuadros visibles", "fortalezas" in porCampo.LEN, false);
	ok("IA sin tocar: sigue marcada como visible=ia", porCampo.LEN.texto_autogenerado.visible, "ia");
	ok("IA sin tocar: la redacción se conserva en texto_autogenerado.ia", porCampo.LEN.texto_autogenerado.ia.fortalezas, ia.fortalezas);
	ok("IA sin tocar: la propuesta de reglas se actualiza al lado", porCampo.LEN.texto_autogenerado.fortalezas, "Lee con fluidez.");
	ok("IA sin tocar: el estado local conserva el texto de IA", boleta.LEN.fortalezas, ia.fortalezas);
	ok("Maestro: no se reescriben sus cuadros", "fortalezas" in porCampo.SAB, false);
	ok("Maestro: la redacción de IA guardada no se pierde", porCampo.SAB.texto_autogenerado.ia.modelo, "claude-opus-5");
	ok("Solo Capa 1: se reescribe y queda visible=reglas", [porCampo.ETI.fortalezas, porCampo.ETI.texto_autogenerado.visible], ["Participa en los acuerdos.", "reglas"]);
	ok("Fila nueva: visible=reglas y sin IA", [porCampo.DHL.texto_autogenerado.visible, "ia" in porCampo.DHL.texto_autogenerado], ["reglas", false]);
	ok("GEN vacío y sin fila: no se crea", !!porCampo.GEN, false);

	// 2. "Volver a proponer" (forzar = true): la Capa 1 manda en todo, la IA queda guardada
	boleta = base();
	await guardar(textos, boleta, ctx, true);
	escrito.forEach(function (f) { porCampo[f.campo] = f; });
	ok("Volver a proponer: LEN se reescribe con reglas", porCampo.LEN.fortalezas, "Lee con fluidez.");
	ok("Volver a proponer: LEN visible=reglas", porCampo.LEN.texto_autogenerado.visible, "reglas");
	ok("Volver a proponer: la IA sigue guardada", porCampo.LEN.texto_autogenerado.ia.fortalezas, ia.fortalezas);
	ok("Volver a proponer: lo del maestro también se reemplaza (con su aviso previo)", [porCampo.SAB.areas_oportunidad, porCampo.SAB.editado_manual], ["Le cuesta explicar lo que observa.", false]);

	// 3. Por cuadro: el maestro vació "sugerencias" a propósito y no tocó lo demás
	boleta = {
		SAB: {
			id: "2", editado_manual: true, fortalezas: null, areas_oportunidad: "Vieja propuesta.", sugerencias: null,
			texto_autogenerado: { visible: "reglas", editados: ["sugerencias"] },
		},
	};
	await guardar(textos, boleta, ctx, false);
	const sab = escrito.find(function (f) { return f.campo === "SAB"; });
	ok("vaciar un cuadro se respeta: sugerencias ni se envía (queda vacío en la base)", "sugerencias" in sab, false);
	ok("y sigue marcado como del maestro", sab.texto_autogenerado.editados, ["sugerencias"]);
	ok("los otros dos cuadros del campo sí reciben la propuesta nueva", sab.areas_oportunidad, "Le cuesta explicar lo que observa.");
	ok("el estado local deja vacío el cuadro vaciado", boleta.SAB.sugerencias, null);

	// 4. B1: filas de forma distinta en un mismo guardado no se borran entre sí
	boleta = base();
	await guardar(textos, boleta, ctx, false);
	ok("se manda un upsert por forma de fila (no uno solo con la unión de columnas)", llamadas >= 2, true);
	const sabB1 = escrito.find(function (f) { return f.campo === "SAB"; });
	ok("la fila editada por el maestro no lleva cuadros en NULL", ["fortalezas", "areas_oportunidad", "sugerencias"].some(function (k) { return k in sabB1; }), false);

	// 5. Boleta cerrada: nada se toca
	boleta = base();
	boleta.LEN.cerrada = true;
	await guardar(textos, boleta, ctx, true);
	ok("Boleta cerrada: LEN no se escribe", escrito.some(function (f) { return f.campo === "LEN"; }), false);

	console.log(fallos ? fallos + " FALLAS" : "TODO OK");
	process.exit(fallos ? 1 : 0);
})();
