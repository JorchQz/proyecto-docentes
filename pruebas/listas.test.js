/*
	Listas de cooperación y materiales (listas.html, decisiones de Jorge del 2026-09-26).

	- js/listas.js (parte pura): montos en pesos sumados en centavos con redondeo a centavos;
	  quién cuenta en una lista (activos, bajas que participaron, activos al cerrar); resumen por
	  columna y avance general; texto e IMAGEN para las familias SIN nombres; recordatorio amable;
	  historial por alumno ("Cumplió en X de Y"); impresión "Solo para la maestra"; escape.
	- js/exportar.js: hoja "Listas" en el Excel solo si hay listas.
	- supabase/mi_salon_b15_listas_2026-09.sql: RLS completa, sin anónimo, CHECK, índices,
	  cascadas y delete_own_account (con lo de b13 y b14).
	- La página: navegación en el head, candado, scripts en orden, regla de /salon/, menú.
	La prueba en la base con dos cuentas es .qa/constructor-aa/rls.js (fuera de git).

	node pruebas/listas.test.js
*/
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");
const L = require("../js/listas.js");
const E = require("../js/exportar.js");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}

// ── Montos en pesos ──────────────────────────────────────────────────────────
const m = (t) => { const p = L.parsearMonto(t); return p.ok ? p.centavos : "ERROR"; };
ok("montos: 50, $50, 50.5, 1,000, $1,000.50, 50,50 (coma decimal), 0.10",
	["50", "$50", "50.5", "1,000", "$1,000.50", "50,50", "0.10", " $ 20 "].map(m), [5000, 5000, 5050, 100000, 100050, 5050, 10, 2000]);
ok("montos: redondeo a centavos por texto (medio hacia arriba, sin punto flotante)",
	["12.345", "12.344", "1.005", "0.125", "999999.994"].map(m), [1235, 1234, 101, 13, 99999999]);
ok("montos: negativos, letras, vacíos raros y más de $999,999.99 no se aceptan",
	["-5", "abc", "5a", ".", "1000000", "999999.995"].map((t) => L.parsearMonto(t).ok), [false, false, false, false, false, false]);
ok("monto vacío: válido (quita el registro)", L.parsearMonto("  "), { ok: true, vacio: true, centavos: null, valor: null, error: "" });
ok("pesos: $1,000 / $850.50 / $0.05 / $1,234,567.89", [L.pesos(100000), L.pesos(85050), L.pesos(5), L.pesos(123456789)], ["$1,000", "$850.50", "$0.05", "$1,234,567.89"]);
ok("valor de la base (numeric como texto) → centavos", [L.aCentavos("50.10"), L.aCentavos(0.3), L.aCentavos(null), L.aCentavos("")], [5010, 30, null, null]);
ok("para editar: 50 y 50.05", [L.montoEditable(5000), L.montoEditable(5005)], ["50", "50.05"]);

// ── Datos de ejemplo ─────────────────────────────────────────────────────────
const al = (id, n, num, estatus, extra) => Object.assign({ id, nombre_completo: n, num_lista: num, estatus: estatus || "activo" }, extra || {});
const alumnos = [al("a3", "Carla Ruiz", 3), al("a1", "Ana López", 1), al("a2", "Beto Díaz", 2), al("a4", "Dora Baja", 4, "baja"), al("a5", "Eva Baja", 5, "baja")];
const col = (id, tipo, nombre, orden, esperado) => ({ id, tipo, nombre, orden, monto_esperado: esperado === undefined ? null : esperado });
const cPal = col("c1", "palomita", "Material de arte", 1);
const cTxt = col("c2", "texto", "Talla", 2);
const cMon = col("c3", "monto", "Cooperación", 0, "33.33");
const lista = { id: "L1", nombre: "Festival", estado: "abierta", fecha: "2026-10-20", listas_columnas: [cMon, cPal, cTxt] };
const val = (c, a, campos) => Object.assign({ lista_id: "L1", columna_id: c, alumno_id: a, entregado: null, texto: null, monto: null }, campos);
const valores = [
	val("c1", "a1", { entregado: true }), val("c1", "a2", { entregado: true }), val("c1", "a3", { entregado: false }),
	val("c2", "a1", { texto: "Talla 8" }),
	val("c3", "a1", { monto: "33.33" }), val("c3", "a2", { monto: "10.01" }), val("c3", "a3", { monto: "40.00" }),
	// Dora se dio de baja DESPUÉS de entregar el material: conserva su registro y cuenta solo ahí
	val("c1", "a4", { entregado: true }),
];
const mapa = L.mapaValores(valores);
const res = L.resumenLista(lista, lista.listas_columnas, alumnos, mapa);

ok("filas: activos en orden de lista y la baja que participó (Eva, de baja y sin nada, no sale)",
	res.filas.map((f) => [f.alumno.id, f.cuenta, f.baja]), [["a1", true, false], ["a2", true, false], ["a3", true, false], ["a4", false, true]]);
ok("columnas en su orden", res.columnas.map((r) => r.columna.id), ["c3", "c1", "c2"]);
const rPal = res.columnas[1], rTxt = res.columnas[2], rMon = res.columnas[0];
ok("palomita: la baja que entregó cuenta (4 de 4 posibles, 3 entregaron)", [rPal.total, rPal.hechos, rPal.faltan, rPal.pendientes], [4, 3, 1, ["a3"]]);
ok("texto: la baja no cuenta donde no participó", [rTxt.total, rTxt.hechos, rTxt.pendientes], [3, 1, ["a2", "a3"]]);
ok("monto con cuota $33.33: reunido 83.34 exacto, esperado 99.99, falta = lo que le falta a cada uno (23.32; lo de más de Carla no cubre a Beto)",
	[rMon.total, rMon.reunido, rMon.esperadoTotal, rMon.falta, rMon.hechos, rMon.aportaron], [3, 8334, 9999, 2332, 2, 3]);
ok("líneas del resumen", res.columnas.map(L.lineaColumna), ["Reunido $83.34 de $99.99; faltan $23.32", "Entregaron 3 de 4; faltan 1", "Registrados 1 de 3; faltan 2"]);
ok("detalle de la cuota", L.detalleColumna(rMon), "Cuota: $33.33 por alumno. Completaron 2 de 3.");
ok("avance general: casillas completas entre las que cuentan (truncado)", res.avance, { hechos: 6, total: 10, porcentaje: 60 });
// Tres centavos que en punto flotante no suman bien
{
	const c = col("x", "monto", "Tres", 0, null);
	const l2 = { id: "L2", estado: "abierta", listas_columnas: [c] };
	const vs = [0.1, 0.2, 0.7].map((mnt, i) => ({ lista_id: "L2", columna_id: "x", alumno_id: ["a1", "a2", "a3"][i], monto: mnt }));
	const r = L.resumenLista(l2, [c], alumnos, L.mapaValores(vs)).columnas[0];
	ok("suma en centavos: 0.10 + 0.20 + 0.70 = $1 (sin cuota: aportaciones)", [r.reunido, L.lineaColumna(r)], [100, "Reunido $1 (3 aportaciones)"]);
}
ok("avance 99.6 % es 99 %, no 100 %", (() => {
	const cs = [col("p", "palomita", "P", 0)];
	const muchos = Array.from({ length: 250 }, (_, i) => al("m" + i, "M" + i, i + 1));
	const vs = muchos.slice(0, 249).map((a) => ({ columna_id: "p", alumno_id: a.id, entregado: true }));
	return L.resumenLista({ estado: "abierta" }, cs, muchos, L.mapaValores(vs)).avance.porcentaje;
})(), 99);

// ── Lista cerrada: cuenta a los activos AL CERRAR ────────────────────────────
{
	const alumnosDespues = alumnos.map((a) => (a.id === "a2" ? Object.assign({}, a, { estatus: "baja" }) : a)).concat([al("a6", "Fer Nuevo", 6)]);
	const cerrada = Object.assign({}, lista, { estado: "cerrada", activos_al_cerrar: ["a1", "a2", "a3"] });
	const r = L.resumenLista(cerrada, cerrada.listas_columnas, alumnosDespues, mapa);
	ok("cerrada: Beto (baja después) sigue contando; Fer (alta después) no aparece", r.filas.map((f) => [f.alumno.id, f.cuenta]), [["a1", true], ["a2", true], ["a3", true], ["a4", false]]);
	ok("cerrada: el resumen no cambia con altas y bajas posteriores", r.columnas.map(L.lineaColumna), res.columnas.map(L.lineaColumna));
}

// ── Para las familias: SIN nombres ───────────────────────────────────────────
const NOMBRES = /Ana|López|Beto|Díaz|Carla|Ruiz|Dora|Eva/;
const meta = { nombre: "Cooperación del festival", grupo: "3° A", escuela: "Escuela Rural Benito Juárez", fecha: "2026-10-20", descripcion: "$33.33 por alumno." };
const txt = L.textoFamilias(meta, res);
ok("texto para las familias: lista, grupo, escuela, fecha y resumen por columna", [/^Cooperación del festival\nGrupo: 3° A\nEscuela Rural Benito Juárez\nFecha: 20 de octubre de 2026/.test(txt),
	/Material de arte: Entregaron 3 de 4; faltan 1\./.test(txt), /Cooperación: Reunido \$83\.34 de \$99\.99; faltan \$23\.32\./.test(txt)], [true, true, true]);
ok("texto para las familias: ningún nombre de alumno", NOMBRES.test(txt), false);
// Imagen con un ctx falso: cada texto que se dibuja
const ctxFalso = { font: "", measureText(t) { return { width: String(t).length * (parseInt(/(\d+)px/.exec(this.font)[1], 10) * 0.55) }; } };
global.RolAseo = undefined;
const hojas = L.paginasImagen(ctxFalso, Object.assign({}, meta, { resumen: res }));
const textos = [].concat(...hojas.map((h) => h.ops.filter((o) => o.t === "texto").map((o) => o.texto)));
ok("imagen: una hoja de 1080 px, alto ≤ 2400, con el pie «Hecho con Jissez Mi Salón»", [hojas.length, hojas.every((h) => h.alto <= 2400), textos.includes("Hecho con Jissez Mi Salón")], [1, true, true]);
ok("imagen: nombre de la lista, grupo, escuela, fecha y resumen por columna", ["Cooperación del festival", "Grupo: 3° A", "Escuela Rural Benito Juárez", "20 de octubre de 2026", "Entregaron 3 de 4; faltan 1", "Reunido $83.34 de $99.99; faltan $23.32", "60 %"].map((t) => textos.includes(t)),
	[true, true, true, true, true, true, true]);
ok("imagen: ningún nombre de alumno en ningún texto", textos.filter((t) => NOMBRES.test(t)), []);
{
	const muchas = Array.from({ length: 12 }, (_, i) => col("k" + i, "palomita", "Material número " + (i + 1), i));
	const r = L.resumenLista({ estado: "abierta" }, muchas, alumnos, L.mapaValores([]));
	const hs = L.paginasImagen(ctxFalso, Object.assign({}, meta, { resumen: r }));
	const ts = [].concat(...hs.map((h) => h.ops.filter((o) => o.t === "texto").map((o) => o.texto)));
	ok("imagen con 12 columnas: se parte en varias de ≤ 2400 px, con «1 de N» y «Sigue en la imagen 2 de N»", [hs.length > 1, hs.every((h) => h.alto <= 2400), ts.includes("1 de " + hs.length), ts.includes("Sigue en la imagen 2 de " + hs.length)], [true, true, true, true]);
}
ok("nombre del archivo", [L.nombreArchivo("Cooperación del festival", "3° A", 1, 1), L.nombreArchivo("Lista", "3° A", 2, 3)], ["lista-cooperacion-del-festival-3-a.png", "lista-lista-3-a-2-de-3.png"]);

// ── Recordatorio (privado, a una familia) ────────────────────────────────────
ok("pendientes de Beto: lo que le falta de la cuota y el dato de la talla", L.pendientesDe(res, "a2", mapa), ["$23.32 de «Cooperación» (ya aportó $10.01)", "el dato de «Talla»"]);
ok("pendientes de Ana: nada", L.pendientesDe(res, "a1", mapa), []);
const msj = L.mensajeRecordatorio("Maestra Fanny", "Beto Díaz", "Cooperación del festival", L.pendientesDe(res, "a2", mapa));
ok("mensaje amable, con el nombre de SU hijo y sin otros alumnos", [/^Hola, buen día\. Le escribe Maestra Fanny, docente de Beto Díaz\. /.test(msj), /recordatorio de «Cooperación del festival»: está pendiente \$23\.32 de «Cooperación» \(ya aportó \$10\.01\) y el dato de «Talla»\./.test(msj),
	/con toda confianza dígame\. Muchas gracias\.$/.test(msj), /Ana|Carla|Dora/.test(msj), /debe|adeuda|multa/i.test(msj)], [true, true, true, false, false]);

// ── Historial por alumno ─────────────────────────────────────────────────────
{
	const mk = (id, estado, cols, vs, activos) => {
		const l = { id, nombre: id, fecha: "2026-10-0" + id.slice(1), estado, activos_al_cerrar: activos || null, listas_columnas: cols };
		const mp = L.mapaValores(vs);
		return { lista: l, resumen: L.resumenLista(l, cols, alumnos, mp), mapa: mp };
	};
	const p = col("p", "palomita", "P", 0), q = col("q", "monto", "Q", 1, 50), t = col("t", "texto", "T", 2);
	const hs = [
		mk("L1", "cerrada", [p], [{ columna_id: "p", alumno_id: "a1", entregado: true }], ["a1", "a2"]),
		mk("L2", "cerrada", [p, q], [{ columna_id: "p", alumno_id: "a1", entregado: true }, { columna_id: "q", alumno_id: "a1", monto: 20 }], ["a1", "a2"]),
		mk("L3", "cerrada", [q], [{ columna_id: "q", alumno_id: "a1", monto: 50 }, { columna_id: "q", alumno_id: "a2", monto: 60 }], ["a1", "a2"]),
		mk("L4", "cerrada", [t], [{ columna_id: "t", alumno_id: "a1", texto: "8" }], ["a1", "a2"]), // solo texto: no se mide
		mk("L5", "abierta", [p], [], null), // abierta: todavía se está juntando
		mk("L6", "cerrada", [p], [], ["a2"]), // Ana no estaba activa al cerrar y no participó
	];
	const h1 = L.historialAlumno("a1", hs);
	ok("Ana: cumplió en 2 de 3 listas cerradas; parcial en 1 (texto, abiertas y donde no contaba, fuera)", [h1.texto, h1.completo, h1.parcial, h1.sin_registro, h1.detalle.map((d) => d.lista.id + ":" + d.estado)],
		["Cumplió en 2 de 3 listas cerradas; parcial en 1", 2, 1, 0, ["L3:completo", "L2:parcial", "L1:completo"]]);
	const h2 = L.historialAlumno("a2", hs);
	ok("Beto: cumplió en 1 de 4; los demás «Sin registro» (nunca «no cumplió»)", [h2.texto, h2.detalle.map((d) => L.ESTADOS[d.estado])], ["Cumplió en 1 de 4 listas cerradas", ["Sin registro", "Completo", "Sin registro", "Sin registro"]]);
	ok("sin listas cerradas", L.historialAlumno("a3", [hs[4]]).texto, "Sin listas cerradas donde cuente");
}

// ── Validación ───────────────────────────────────────────────────────────────
ok("validar lista", [L.validarLista({ nombre: " ", fecha: "2026-10-01" }), L.validarLista({ nombre: "X", fecha: "" }), L.validarLista({ nombre: "x".repeat(81), fecha: "2026-10-01" }), L.validarLista({ nombre: "Festival", fecha: "2026-10-01", descripcion: "y".repeat(301) }), L.validarLista({ nombre: "Festival", fecha: "2026-10-01" })],
	["Escribe el nombre de la lista.", "Elige la fecha de la lista.", "El nombre es muy largo (máximo 80 caracteres).", "La descripción es muy larga (máximo 300 caracteres).", ""]);
ok("validar columna: tipo, largo, tope de 12 y cuota", [L.validarColumna({ nombre: "A", tipo: "otro" }), L.validarColumna({ nombre: "A", tipo: "palomita" }, 12), L.validarColumna({ nombre: "A", tipo: "monto", esperado: "-3" }), L.validarColumna({ nombre: "A", tipo: "monto", esperado: "50" }, 3)],
	["Elige el tipo de columna.", "Una lista puede tener hasta 12 columnas.", "Cantidad esperada: la cantidad no puede ser negativa.", ""]);

// ── Impresión "Solo para la maestra" y escape ────────────────────────────────
const MALO = "<img src=x onerror=alert(1)>'\"&";
{
	const alM = [al("z1", MALO, 1)];
	const cM = [col("z", "texto", MALO, 0)];
	const lM = { estado: "abierta", nombre: MALO };
	const mpM = L.mapaValores([{ columna_id: "z", alumno_id: "z1", texto: MALO }]);
	const h = L.htmlImpresion({ nombre: MALO, grupo: MALO, escuela: MALO, fecha: "2026-10-01", descripcion: MALO }, L.resumenLista(lM, cM, alM, mpM), mpM);
	ok("impresión: etiqueta «Solo para la maestra» y todo escapado", [/Solo para la maestra · Uso interno\. No se comparte con las familias\./.test(h), /<img/.test(h), (h.match(/&lt;img src=x onerror=alert\(1\)&gt;&#39;&quot;&amp;/g) || []).length >= 5], [true, false, true]);
}
{
	const h = L.htmlImpresion(meta, res, mapa);
	ok("impresión: lleva nombres, Pendiente resaltado y «No aplica» para la baja en columnas donde no participó",
		[/Ana López/.test(h), /class='imp-pend'>Pendiente/.test(h), /Dora Baja <span class='imp-baja'>\(baja\)<\/span>/.test(h), /imp-na'>No aplica/.test(h)], [true, true, true, true]);
}

// ── Excel: hoja «Listas» solo si hay listas ──────────────────────────────────
{
	const hojasX = {};
	const XLSXFalso = { utils: {
		book_new: () => ({ SheetNames: [], Sheets: {} }),
		aoa_to_sheet: (aoa) => ({ aoa, "!ref": "A1:Z" + aoa.length }),
		book_append_sheet: (wb, ws, n) => { wb.SheetNames.push(n); wb.Sheets[n] = ws; hojasX[n] = ws; },
	} };
	const tabla = { encabezados: ["Alumno"], filas: [["A"]], maximos: [["1"]] };
	ok("Excel sin listas: tres hojas, como siempre", E.libroXLSX(XLSXFalso, tabla, { listas: [] }).SheetNames, ["Concentrado", "Máximos", "Léeme"]);
	const wb = E.libroXLSX(XLSXFalso, tabla, { listas: [{ lista, valores }], alumnosListas: alumnos });
	ok("Excel con listas: cuarta hoja «Listas»", wb.SheetNames, ["Concentrado", "Máximos", "Léeme", "Listas"]);
	const aoa = hojasX["Listas"].aoa;
	ok("hoja Listas: bloque con nombre, fecha y estado, encabezado, filas (monto como número) y resumen", [aoa[0], aoa[1], aoa[2], aoa[3], aoa[5], aoa[6]],
		[["Lista", "Festival", "Fecha", "2026-10-20", "Estado", "Abierta"], ["Alumno", "Cooperación (pesos; cuota $33.33)", "Material de arte", "Talla"],
			["Ana López", 33.33, "Sí", "Talla 8"], ["Beto Díaz", 10.01, "Sí", ""], ["Dora Baja (baja)", "No aplica", "Sí", "No aplica"],
			["Resumen", "Reunido $83.34 de $99.99; faltan $23.32", "Entregaron 3 de 4; faltan 1", "Registrados 1 de 3; faltan 2"]]);
	const hojasLeeme = (mt) => E.hojaLeeme(mt).find((f) => f[0] === "Hojas")[1];
	ok("Léeme menciona «Listas» solo si la hoja está", [/«Listas»: las listas de cooperación y materiales del grupo/.test(hojasLeeme({ listas: [{ lista, valores }] })), /Listas/.test(hojasLeeme({}))], [true, false]);
	const pag = leer("exportar.html");
	ok("exportar.html carga js/listas.js antes de exportar.js y menciona la hoja", [pag.indexOf('src="js/listas.js"') > 0 && pag.indexOf('src="js/listas.js"') < pag.indexOf('src="js/exportar.js"'), /la hoja <span class="font-medium">Listas<\/span>/.test(pag)], [true, true]);
}

// ── Migración b15 ────────────────────────────────────────────────────────────
const sql = leer("supabase/mi_salon_b15_listas_2026-09.sql");
const codigo = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
const TABLAS = ["listas_grupo", "listas_columnas", "listas_valores"];
ok("tres tablas nuevas con if not exists y RLS activada", TABLAS.map((t) => new RegExp("create table if not exists public\\." + t + " \\(").test(codigo) && new RegExp("alter table public\\." + t + " enable row level security").test(codigo)), [true, true, true]);
ok("sin anónimo: revoke all a anon en las tres", TABLAS.map((t) => new RegExp("revoke all on public\\." + t + " from anon;").test(codigo)), [true, true, true]);
const pol = (t, cmd) => (codigo.match(new RegExp("create policy \\w+ on public\\." + t + "\\s+for " + cmd + " to authenticated[\\s\\S]*?\\);\\s*end if;", "g")) || []);
ok("cuatro políticas por tabla (select, insert, update, delete), todas con auth.uid() = maestro_id",
	TABLAS.map((t) => ["select", "insert", "update", "delete"].map((c) => pol(t, c).length === 1 && /\(select auth\.uid\(\)\) = maestro_id/.test(pol(t, c)[0])).every(Boolean)), [true, true, true]);
ok("referencias propias: grupo del maestro; columna y valor solo en lista suya ABIERTA; alumno suyo del MISMO grupo; el campo del tipo de su columna",
	[/g\.id = grupo_id and g\.maestro_id = \(select auth\.uid\(\)\)/.test(pol("listas_grupo", "insert")[0]),
		/l\.estado = 'abierta'/.test(pol("listas_columnas", "insert")[0]) && /l\.estado = 'abierta'/.test(pol("listas_columnas", "delete")[0]),
		/join public\.alumnos a on a\.grupo_id = l\.grupo_id/.test(pol("listas_valores", "insert")[0]) && /a\.maestro_id = \(select auth\.uid\(\)\)/.test(pol("listas_valores", "insert")[0]),
		/c\.tipo = 'palomita' and listas_valores\.texto is null and listas_valores\.monto is null/.test(pol("listas_valores", "update")[0]),
		/estado = 'abierta'/.test(pol("listas_grupo", "delete")[0])],
	[true, true, true, true, true]);
ok("CHECK: montos ≥ 0 con dos decimales (numeric(9,2)), textos acotados, tipos y estados cerrados",
	[/monto\s+numeric\(9, 2\)/, /monto >= 0 and monto <= 999999\.99/, /monto_esperado >= 0/, /char_length\(btrim\(nombre\)\) between 1 and 80/, /char_length\(descripcion\) <= 300/, /char_length\(texto\) <= 80/,
		/tipo in \('palomita', 'texto', 'monto'\)/, /estado in \('abierta', 'cerrada'\)/, /num_nonnulls\(entregado, texto, monto\) <= 1/].map((r) => r.test(codigo)), Array(9).fill(true));
ok("cascadas: grupo → listas → columnas → valores; alumno → sus valores",
	[/grupo_id\s+uuid not null references public\.grupos \(id\) on delete cascade/, /lista_id\s+uuid not null references public\.listas_grupo \(id\) on delete cascade/, /columna_id\s+uuid not null references public\.listas_columnas \(id\) on delete cascade/,
		/alumno_id\s+uuid not null references public\.alumnos \(id\) on delete cascade/].map((r) => r.test(codigo)), [true, true, true, true]);
ok("índices: único por columna y alumno, y por lista, alumno, maestro y grupo",
	[/create unique index if not exists listas_valores_columna_alumno_uidx on public\.listas_valores \(columna_id, alumno_id\)/, /listas_valores_lista_idx/, /listas_valores_alumno_idx/, /listas_columnas_lista_idx/, /listas_grupo_maestro_grupo_fecha_idx/].map((r) => r.test(codigo)), [true, true, true, true, true]);
ok("cerrada = solo lectura: el trigger rechaza cambiar una lista cerrada; el tipo de columna no cambia",
	[/if old\.estado = 'cerrada' and new\.estado = 'cerrada' then\s*raise exception/.test(codigo), /if new\.tipo <> old\.tipo then\s*raise exception/.test(codigo),
		/create trigger listas_grupo_antes_de_cambiar before update on public\.listas_grupo/.test(codigo)], [true, true, true]);
const dele = (codigo.match(/create or replace function public\.delete_own_account\(\)[\s\S]*?end \$\$;/) || [""])[0];
ok("delete_own_account: sigue con todo lo de b10, b13 y b14 y agrega las tres tablas de listas",
	["evaluacion_formativa", "calificaciones", "registro_diario", "boleta_trimestral", "evaluacion_diagnostica", "tareas", "productos_sesion", "dias_no_habiles_extra", "maestro_ajustes", "zz_deprecated_diagnosticos",
		"incidencia_alumnos", "incidencias", "roles_aseo", "calendario_ajustes", "listas_valores", "listas_columnas", "listas_grupo"].filter((t) => !new RegExp("delete from public\\." + t + " where maestro_id").test(dele)),
	[]);
ok("delete_own_account: security definer, search_path vacío, sin anónimo", [/security definer\s*set search_path = ''/.test(dele), /revoke all on function public\.delete_own_account\(\) from public, anon;/.test(codigo)], [true, true]);
ok("aditiva: no borra tablas, columnas ni datos ajenos", /drop table|drop column|truncate|delete from public\.(?!listas_|evaluacion_formativa|calificaciones|registro_diario|boleta_trimestral|evaluacion_diagnostica|tareas|productos_sesion|dias_no_habiles_extra|maestro_ajustes|zz_deprecated_diagnosticos|incidencia|roles_aseo|calendario_ajustes)/i.test(codigo), false);

// ── La página ────────────────────────────────────────────────────────────────
const html = leer("listas.html");
const js = leer("js/listas.js");
ok("página: navegación en el head, candado y capa de lectura en orden, ficha y rol de aseo antes de listas.js",
	[html.indexOf('src="js/navbar.js"') < html.indexOf("</head>"),
		["js/supabase.js", "js/lectura.js", "js/saas-guard.js", "js/grupo-activo.js", "js/leer-todo.js", "js/ficha-alumno.js", "js/rol-aseo.js", "js/listas.js"].map((s) => html.indexOf('src="' + s + '"')).every((v, i, t) => v > 0 && (i === 0 || v > t[i - 1]))],
	[true, true]);
ok("regla de /salon/ para listas.html", leer("_redirects").indexOf("/salon/listas.html /salon/listas 301") !== -1, true);
ok("botones de al menos 44 px en la página", (html.match(/<button[^>]*>/g) || []).filter((b) => !/min-h-\[44px\]|h-11 w-11/.test(b)), []);
ok("etiquetas claras: «Para las familias», «Solo para la maestra» y «Copiar texto para las familias»",
	[/Para las familias<\/h2>/.test(html), /Solo para la maestra<\/h2>/.test(html), /Copiar texto para las familias/.test(html), /Imprimir \(solo para la maestra\)/.test(html)], [true, true, true, true]);
ok("Recordar por WhatsApp: solo con teléfono en la ficha (enlaceWhatsApp) y abre aparte sin referer",
	[/function tieneTelefono\(a\) \{ return !!\(a && a\.tutor_telefono && F && F\.enlaceWhatsApp\(a\.tutor_telefono\)\); \}/.test(js), /id="dlgRecordarAbrir"[^>]*target="_blank" rel="noopener noreferrer"/.test(html)], [true, true]);
ok("la imagen se arma con los datos copiados al empezar (no se mezcla si algo cambia mientras se dibuja)", /var datos = Object\.assign\(metaSalida\(l\), \{ resumen: resumenDe\(l\) \}\);\s*var nombreLista = l\.nombre, nombreGrupo/.test(js), true);

console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
process.exit(fallos ? 1 : 0);
