/*
	Alta de alumnos (decisiones de Jorge del 2026-09-26):
	  8. Nombres en MAYÚSCULAS con acentos y Ñ ("JOSÉ PEÑA"); antes se quitaban los acentos.
	     Onboarding y Mi grupo usan la misma regla (js/nombres-alumno.js); lo guardado no cambia.
	  9. Si se cierra la pestaña a media captura, la lista no se pierde: borrador en este aparato
	     (js/alta-borrador.js, localStorage en try/catch) que se ofrece al volver y se borra al
	     completar. Inicio lo ofrece si el grupo ya existe sin alumnos.

	node pruebas/alta-nombres.test.js
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
const cargar = (f) => { try { return require("../js/" + f); } catch (e) { console.log("FALLA no existe js/" + f); fallos++; return {}; } };

// ── 8. Nombres ──
const N = cargar("nombres-alumno.js");
if (N.formatear) {
	ok("«josé peña» → «JOSÉ PEÑA» (con acentos y Ñ)", N.formatear("josé peña", true), "JOSÉ PEÑA");
	ok("acentos, diéresis y Ñ se conservan", N.formatear("maría güémez núñez", true), "MARÍA GÜÉMEZ NÚÑEZ");
	ok("acento compuesto (NFD, como lo dan algunos teclados) se conserva", N.formatear("josé", true), "JOSÉ");
	ok("otras marcas quedan como su letra base; números y signos se quitan", N.formatear("àlex 3 o'brien-díaz!", true), "ALEX OBRIEN-DÍAZ");
	ok("espacios: uno solo y sin espacio al inicio", N.formatear("  de   la  cruz", true), "DE LA CRUZ");
	ok("válido: letras con acentos, Ñ, espacios y guiones", [N.valido("JOSÉ PEÑA"), N.valido("DE-LA CRUZ"), N.valido("JOSE3"), N.valido("  ")], [true, true, false, false]);
	ok("duplicados: JOSÉ PEÑA y JOSE PENA son el mismo alumno", N.clave("JOSÉ  PEÑA") === N.clave("jose pena"), true);
}
const ob = leer("js/onboarding.js"), mg = leer("js/mi-grupo.js");
ok("onboarding: ya no quita acentos (sin removeAccents) y usa NombresAlumno", !/removeAccents/.test(ob) && /NombresAlumno\.formatear/.test(ob) && /NombresAlumno\.valido/.test(ob), true);
ok("Mi grupo: ya no quita acentos y usa NombresAlumno", !/removeAccents/.test(mg) && /NombresAlumno\.formatear/.test(mg) && /NombresAlumno\.valido/.test(mg), true);
["onboarding.html", "mi-grupo.html"].forEach((h) => {
	const s = leer(h);
	const i = s.indexOf('src="js/nombres-alumno.js"'), j = s.indexOf(h === "onboarding.html" ? 'src="js/onboarding.js"' : 'src="js/mi-grupo.js"');
	ok(h + ": carga js/nombres-alumno.js antes de su pantalla", i > 0 && i < j, true);
});

// ── 9. Borrador del alta ──
const B = cargar("alta-borrador.js");
if (B.guardar) {
	const mem = {};
	global.localStorage = {
		getItem: (k) => (k in mem ? mem[k] : null),
		setItem: (k, v) => { mem[k] = String(v); },
		removeItem: (k) => { delete mem[k]; },
	};
	ok("guardar el borrador", B.guardar("m1", { grupoId: "g1", grupo: { nombre: "AE lunes" }, alumnos: [{ nombre_completo: "JOSÉ PEÑA", grado: 4, key: "x" }] }), true);
	const b = B.leer("m1");
	ok("leerlo: grupo y alumnos (solo nombre y grado)", [b.grupoId, b.alumnos], ["g1", [{ nombre_completo: "JOSÉ PEÑA", grado: 4 }]]);
	ok("es por cuenta: otra maestra en el mismo aparato no lo ve", B.leer("m2"), null);
	ok("caduca a los " + B.DIAS_VIGENCIA + " días", B.leer("m1", new Date(Date.now() + (B.DIAS_VIGENCIA + 1) * 86400000).toISOString()), null);
	B.borrar("m1");
	ok("se borra al completar", B.leer("m1"), null);
	mem[B.clave("m1")] = "{no es json";
	ok("un borrador dañado no truena", B.leer("m1"), null);
	global.localStorage = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } };
	let truena = false;
	try { B.guardar("m1", { alumnos: [] }); B.leer("m1"); B.borrar("m1"); } catch (e) { truena = true; }
	ok("sin almacenamiento (modo privado, bloqueado): no truena", truena, false);
}
ok("onboarding: guarda el borrador al cambiar la lista y al crear el grupo", /function updateStudentsList\(\)[\s\S]*?guardarBorrador\(\);\r?\n\t\}/.test(ob) && /configureStudentGradeSelector\(\);\s*updateStudentsList\(\);\s*guardarBorrador\(\);/.test(ob), true);
ok("onboarding: lo ofrece al volver y lo borra al completar", /ofrecerBorrador\(\);/.test(ob) && /AltaBorrador\.borrar\(userId\)/.test(ob), true);
ok("onboarding: al continuar no duplica si el grupo ya tiene alumnos", /\(cuenta\.count \|\| 0\) > 0/.test(ob), true);
const oh = leer("onboarding.html");
ok("onboarding.html: aviso para continuar o empezar de nuevo (44 px)",
	/id="borradorAltaContinuar"[^>]*min-h-\[44px\]/.test(oh) && /id="borradorAltaDescartar"[^>]*min-h-\[44px\]/.test(oh), true);
const dj = leer("js/dashboard.js"), dh = leer("dashboard.html");
ok("Inicio: grupo sin alumnos con borrador → «Continuar la lista»", /AltaBorrador\.leer\(user\.id\)/.test(dj) && /Continuar la lista/.test(dj) && dh.indexOf('src="js/alta-borrador.js"') > 0, true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
