/*
	Ficha del alumno (decisión de Jorge, 2026-09-25): js/ficha-alumno.js y cómo la usa Mi grupo.

	- Teléfono del tutor: se normaliza a 10 dígitos de México (quita +52, el "1" viejo de
	  celular, 044/045 y cualquier separador) y un número que no llega a 10 no se guarda.
	- WhatsApp: wa.me/52 + los 10 dígitos, con un saludo que se edita en WhatsApp.
	- Fecha de nacimiento: razonable para primaria (4 a 16 años cumplidos), nunca futura.
	- Género: niña, niño, prefiero no decir o sin dato; el conteo solo aparece si hay datos.
	- Mi grupo lee y escribe las columnas nuevas; el onboarding NO las pide.
	- La migración B13 limita en la base lo mismo (10 dígitos, género, fecha, largos).

	node pruebas/ficha-alumno.test.js
*/
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const RAIZ = path.join(__dirname, "..");
const F = require(path.join(RAIZ, "js", "ficha-alumno.js"));

let fallos = 0;
function ok(nombre, real, esperado) {
	try { assert.deepStrictEqual(real, esperado); console.log("OK    " + nombre); }
	catch (e) { fallos++; console.log("FALLA " + nombre + "\n      esperado: " + JSON.stringify(esperado) + "\n      real:     " + JSON.stringify(real)); }
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

// ── Teléfono ─────────────────────────────────────────────────────────────────
const dig = (t) => { const n = F.normalizarTelefono(t); return n.ok ? n.digitos : "ERROR"; };
ok("teléfono: 10 dígitos con espacios, guiones, paréntesis o puntos",
	["33 1234 5678", "(33) 1234-5678", "33.1234.5678", "3312345678", "  3312345678  "].map(dig),
	["3312345678", "3312345678", "3312345678", "3312345678", "3312345678"]);
ok("teléfono: con lada de país +52 o 52, se quita",
	["+52 33 1234 5678", "52 3312345678", "+523312345678", "0052 33 1234 5678".replace(/^00/, "")].map(dig),
	["3312345678", "3312345678", "3312345678", "3312345678"]);
ok("teléfono: el 1 viejo de celular (+52 1) y los prefijos 044/045 se quitan",
	["+52 1 33 1234 5678", "521 3312345678", "044 33 1234 5678", "045 55 1234 5678"].map(dig),
	["3312345678", "3312345678", "3312345678", "5512345678"]);
ok("teléfono vacío: válido (es opcional)", F.normalizarTelefono("   "), { ok: true, vacio: true, digitos: "", error: "" });
ok("teléfono vacío: null y undefined también", [F.normalizarTelefono(null).vacio, F.normalizarTelefono(undefined).vacio], [true, true]);
ok("teléfono corto o largo: no se guarda y dice cuántos dígitos tiene",
	["1234", "33 1234 567", "33 1234 56789", "+1 555 123 4567 8"].map((t) => F.normalizarTelefono(t).ok), [false, false, false, false]);
ok("teléfono corto: el mensaje dice 10 y cuántos tiene", /10 dígitos \(tiene 4\)/.test(F.normalizarTelefono("1234").error), true);
ok("teléfono con letras: no", F.normalizarTelefono("33 12AB 5678").ok, false);
ok("formato de México: lada de 2 (33, 55, 56, 81) y de 3",
	["3312345678", "5512345678", "8112345678", "4441234567", "123"].map(F.formatoTelefono),
	["33 1234 5678", "55 1234 5678", "81 1234 5678", "444 123 4567", "123"]);

// ── WhatsApp ─────────────────────────────────────────────────────────────────
ok("WhatsApp: wa.me/52 + los 10 dígitos", F.enlaceWhatsApp("+52 1 (33) 1234-5678"), "https://wa.me/523312345678");
ok("WhatsApp: con saludo codificado en la URL",
	F.enlaceWhatsApp("3312345678", "Hola & adiós ?"), "https://wa.me/523312345678?text=Hola%20%26%20adi%C3%B3s%20%3F");
ok("WhatsApp: sin teléfono válido no hay enlace", [F.enlaceWhatsApp(""), F.enlaceWhatsApp("123"), F.enlaceWhatsApp(null)], ["", "", ""]);
ok("WhatsApp: el enlace solo lleva dígitos después de wa.me/52 (nada inyectable)",
	/^https:\/\/wa\.me\/52\d{10}(\?text=[^"'<> ]*)?$/.test(F.enlaceWhatsApp("33 1234 5678", "<script>alert('x')</script>")), true);
ok("saludo: con y sin nombre de la docente",
	[F.saludoWhatsApp("Fanny Ruiz", "PÉREZ ANA"), F.saludoWhatsApp("", "PÉREZ ANA")],
	["Hola, buen día. Le escribe Fanny Ruiz, docente de PÉREZ ANA.", "Hola, buen día. Le escribo como docente de PÉREZ ANA."]);

// ── Fecha de nacimiento ──────────────────────────────────────────────────────
const HOY = "2026-09-25";
ok("edad cumplida (antes y después del cumpleaños)", [F.edadEn("2018-09-25", HOY), F.edadEn("2018-09-26", HOY), F.edadEn("2018-01-01", HOY)], [8, 7, 8]);
ok("fecha vacía: válida (opcional)", F.validarFechaNacimiento("", HOY).ok && F.validarFechaNacimiento("", HOY).vacio, true);
ok("fechas razonables para primaria (4 a 16 años)",
	["2022-09-25", "2020-03-01", "2014-01-10", "2009-09-26"].map((f) => F.validarFechaNacimiento(f, HOY).ok), [true, true, true, true]);
ok("fuera de rango: 3 años, 17 años, futura, imposible",
	["2023-01-01", "2009-09-25", "2027-01-01", "2018-02-30", "25/09/2018"].map((f) => F.validarFechaNacimiento(f, HOY).ok), [false, false, false, false, false]);
ok("el mensaje dice la edad que daría y el rango esperado",
	F.validarFechaNacimiento("2023-01-01", HOY).error, "Revisa la fecha de nacimiento: daría 3 años. En primaria esperamos entre 4 y 16 años.");
ok("futura: su propio mensaje", F.validarFechaNacimiento("2027-01-01", HOY).error, "La fecha de nacimiento no puede ser futura.");
const lim = F.limitesFecha(HOY);
ok("límites del selector de fecha (min y max) coinciden con la regla",
	[lim, F.validarFechaNacimiento(lim.min, HOY).ok, F.validarFechaNacimiento(lim.max, HOY).ok],
	[{ min: "2009-09-26", max: "2022-09-25" }, true, true]);
ok("un día antes del mínimo ya no vale", F.validarFechaNacimiento("2009-09-25", HOY).ok, false);

// ── Género y conteo ──────────────────────────────────────────────────────────
ok("géneros: niña, niño, prefiero no decir", F.GENEROS.map((g) => g.valor + "=" + g.etiqueta), ["nina=Niña", "nino=Niño", "prefiero_no_decir=Prefiero no decir"]);
ok("género válido: los tres y vacío; otro no", ["nina", "nino", "prefiero_no_decir", "", null, "otro"].map(F.generoValido), [true, true, true, true, true, false]);
ok("conteo sin ningún dato: no se muestra", F.conteoGenero([{}, { genero: null }]).texto, "");
ok("conteo con datos: niñas y niños, y lo demás",
	F.conteoGenero([{ genero: "nina" }, { genero: "nina" }, { genero: "nino" }, { genero: "prefiero_no_decir" }, {}]).texto,
	"2 niñas y 1 niño, 1 prefiere no decir, 1 sin dato");
ok("conteo solo con «prefiero no decir»: sin «0 niñas y 0 niños»",
	F.conteoGenero([{ genero: "prefiero_no_decir" }, {}]).texto, "1 prefiere no decir, 1 sin dato");
ok("conteo en singular y plural", [F.conteoGenero([{ genero: "nina" }]).texto, F.conteoGenero([{ genero: "nino" }, { genero: "nino" }]).texto],
	["1 niña y 0 niños", "0 niñas y 2 niños"]);
ok("nombre del tutor: espacios normalizados y máximo 120", [F.limpiarNombreTutor("  Ana   María  "), F.limpiarNombreTutor("x".repeat(200)).length], ["Ana María", 120]);

// ── Mi grupo y onboarding ────────────────────────────────────────────────────
const mgHtml = leer("mi-grupo.html");
const mgJs = leer("js/mi-grupo.js");
ok("Mi grupo carga js/ficha-alumno.js antes de js/mi-grupo.js",
	mgHtml.indexOf('src="js/ficha-alumno.js"') !== -1 && mgHtml.indexOf('src="js/ficha-alumno.js"') < mgHtml.indexOf('src="js/mi-grupo.js"'), true);
ok("Mi grupo: campos de la ficha (fecha, género, tutor, teléfono) y botón de WhatsApp",
	["editStudentBirthdate", "editStudentGender", "editStudentTutorName", "editStudentTutorPhone", "editStudentWhatsApp"].every((id) => mgHtml.indexOf('id="' + id + '"') !== -1), true);
ok("Mi grupo: el género ofrece niña, niño y prefiero no decir, sin CURP en ningún lado",
	/value="nina">Niña[\s\S]*value="nino">Niño[\s\S]*value="prefiero_no_decir">Prefiero no decir/.test(mgHtml) && !/curp/i.test(mgHtml + mgJs), true);
ok("Mi grupo lee y escribe las cuatro columnas de la ficha",
	/ALUMNO_COLS = "id, nombre_completo, num_lista, grado, fecha_nacimiento, genero, tutor_nombre, tutor_telefono"/.test(mgJs) &&
	/tutor_telefono: tel\.vacio \? null : tel\.digitos/.test(mgJs), true);
ok("Mi grupo: director del grupo en los datos del grupo (se lee y se guarda)",
	mgHtml.indexOf('id="editGroupDirector"') !== -1 && /director_nombre: director \|\| null/.test(mgJs) && /group\.director_nombre/.test(mgJs), true);
ok("Mi grupo: el enlace de WhatsApp abre aparte y sin referer", /id="editStudentWhatsApp"[^>]*target="_blank" rel="noopener noreferrer"/.test(mgHtml) &&
	/waLink\.rel = "noopener noreferrer"/.test(mgJs), true);
ok("Mi grupo: la lista pinta con textContent (sin innerHTML con datos de la ficha)",
	!/innerHTML[^;]*(tutor_|nombre_completo|genero)/.test(mgJs), true);
ok("onboarding: el alta rápida no pide la ficha", !/tutor_|fecha_nacimiento|genero/.test(leer("js/onboarding.js")), true);

// ── Migración B13 (lo que la base exige) ─────────────────────────────────────
const sql = leer("supabase/mi_salon_b13_ficha_incidencias_2026-09.sql");
ok("base: teléfono de 10 dígitos, género cerrado, fecha acotada, largos",
	[/tutor_telefono ~ '\^\[0-9\]\{10\}\$'/, /genero in \('nina', 'nino', 'prefiero_no_decir'\)/, /fecha_nacimiento >= date '1990-01-01'/,
		/char_length\(tutor_nombre\) <= 120/, /char_length\(director_nombre\) <= 120/].map((r) => r.test(sql)), [true, true, true, true, true]);
ok("base: columnas nuevas nulas (add column if not exists, sin not null ni default)",
	(sql.match(/alter table public\.(alumnos|grupos) add column if not exists \w+ (date|text);/g) || []).length, 5);
ok("base: sin CURP ni CCT por grupo", /add column[^;]*\b(curp|cct)\b/i.test(sql), false);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
