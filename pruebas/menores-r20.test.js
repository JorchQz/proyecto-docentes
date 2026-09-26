/*
	Menores pendientes de R20 (2026-09-26). Cada caso falla con el código de 1b8b55a.

	1. Incidencia larga: cada página impresa lleva al pie el alumno, el tanto y su número de
	   página dentro de esa hoja; la nota ya no dice "hojas carta" ni "la hoja siguiente".
	2. Rol de aseo impreso: una semana (fila) no se parte entre páginas; letra compacta.
	3. Imágenes del rol: el mes se congela al empezar y el selector de mes se bloquea.
	4. Trigger de fecha de nacimiento con la fecha de México (b13a).
	5. Teléfono con lada que empieza con 0 o 1: rechazado en la pantalla y en la base (b13a).
	6. El aviso de eliminar grupo menciona calendario, rol de aseo y listas.
	7. Tras eliminar el grupo activo se sigue con otro grupo (js/grupo-activo.js), no al onboarding.

	node pruebas/menores-r20.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const RAIZ = path.join(__dirname, "..");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const sinComentarios = (t) => t.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");

async function main() {
	// ── 1. Incidencia: pie corrido por hoja ─────────────────────────────────────
	const I = require("../js/incidencias.js");
	const d = { incidencia: { asunto: "Discusión" }, alumnos: [{ nombre_completo: "Ana Pérez" }, { nombre_completo: "Beto Ruiz" }] };
	ok("1. familias: un pie por hoja, con alumno y tanto, sin total (cada hoja cuenta desde 1)",
		typeof I.piesDeImpresion === "function" ? I.piesDeImpresion(d, "familias") : null,
		[{ texto: "Registro de incidencia · Ana Pérez · Ejemplar para el expediente", conTotal: false }, { texto: "Registro de incidencia · Ana Pérez · Copia para la familia", conTotal: false },
			{ texto: "Registro de incidencia · Beto Ruiz · Ejemplar para el expediente", conTotal: false }, { texto: "Registro de incidencia · Beto Ruiz · Copia para la familia", conTotal: false }]);
	ok("1. resumen y hoja sin alumnos: una hoja, con «p. N de M»",
		typeof I.piesDeImpresion === "function" ? [I.piesDeImpresion(d, "resumen"), I.piesDeImpresion({ incidencia: { asunto: "Sin alumnos" }, alumnos: [] }, "sola")] : null,
		[[{ texto: "Registro de incidencia · Resumen para el expediente", conTotal: true }], [{ texto: "Registro de incidencia · Sin alumnos", conTotal: true }]]);
	const css = typeof I.cssPaginas === "function" ? I.cssPaginas(I.piesDeImpresion(d, "familias").slice(0, 2).concat([{ texto: "Resumen", conTotal: true }])) : "";
	ok("1. CSS: cada hoja con su página con nombre, su contador y el pie abajo",
		[/\.inc-hoja\[data-pag='0'\] \{ page: incHoja0; \}/.test(css), /@page incHoja1 \{ counter-increment: incPag1; @bottom-left \{ content: "Registro de incidencia · Ana Pérez · Copia para la familia";/.test(css),
			/@bottom-right \{ content: "p\. " counter\(incPag1\);/.test(css), /counter\(incPag2\) " de " counter\(pages\)/.test(css)], [true, true, true, true]);
	const cssMalo = typeof I.cssPaginas === "function" ? I.cssPaginas([{ texto: 'Ana "x" \\ </style>\n{}', conTotal: false }]) : "";
	ok("1. CSS: el nombre va escapado (comillas, diagonal, salto y </style>)", [/content: "Ana \\"x\\" \\\\ \\3C \/style> \{\}"/.test(cssMalo), /<\/style>/.test(cssMalo)], [true, false]);
	const incJs = leer("js/incidencias.js"), incHtml = leer("incidencias.html");
	ok("1. la página llena <style id=incPaginas media=print> y numera las hojas (data-pag)",
		[/<style id="incPaginas" media="print"><\/style>/.test(incHtml), /h\.setAttribute\("data-pag", String\(i\)\)/.test(incJs), /el\.paginas\.textContent = cssPaginas\(/.test(incJs)], [true, true, true]);
	ok("1. las notas dicen lo que sale: sin «hojas carta» ni «la hoja siguiente»",
		[/hojas carta/.test(incJs), /la hoja siguiente/.test(incJs), /cada una empieza en una página carta nueva/.test(incJs), /más de una página carta\. Cada página lleva abajo/.test(incJs)], [false, false, true, true]);

	// ── 2. Rol de aseo impreso ──────────────────────────────────────────────────
	const calHtml = leer("calendario.html");
	const print = (calHtml.match(/@media print \{[\s\S]*?\n\t\t\}/) || [""])[0];
	ok("2. una semana (fila) no se parte entre páginas; encabezado repetido y letra compacta",
		[/\.imp-tabla tr \{ break-inside: avoid; page-break-inside: avoid; \}/.test(print), /\.imp-tabla thead \{ display: table-header-group; \}/.test(print), /\.imp-tabla td span \{ font-size: 9\.5pt !important;/.test(print)], [true, true, true]);

	// ── 3. Imágenes del rol con el mes congelado ────────────────────────────────
	const calJs = leer("js/calendario.js");
	ok("3. el mes y el grupo se toman al empezar; el nombre de cada archivo usa esos, no aseo.mes",
		[/async function crearImagenes\(\) \{\s*var mes = aseo\.mes, nombreGrupo = grupo\.nombre;/.test(calJs), /nombreArchivo\(mes, nombreGrupo, i \+ 1, hojas\.length\)/.test(calJs), /nombreArchivo\(aseo\.mes/.test(calJs)], [true, true, false]);
	ok("3. mientras se generan, el selector de mes y los botones quedan bloqueados",
		[/\[el\.aseoMes, el\.aseoImagen, el\.aseoCompartir\]\.forEach\(function \(b\) \{ b\.disabled = si; \}\)/.test(calJs), /if \(generandoImagenes\) \{ el\.aseoMes\.value = aseo\.mes; return; \}/.test(calJs),
			(calJs.match(/bloquearSalida\(true\)/g) || []).length, (calJs.match(/bloquearSalida\(false\)/g) || []).length], [true, true, 2, 2]);

	// ── 4 y 5. Base: fecha de México y lada válida ──────────────────────────────
	const b13a = fs.existsSync(path.join(RAIZ, "supabase/mi_salon_b13a_ficha_mexico_2026-09.sql")) ? sinComentarios(leer("supabase/mi_salon_b13a_ficha_mexico_2026-09.sql")) : "";
	ok("4. el trigger compara contra la fecha de México, no current_date (create or replace, security invoker)",
		[/create or replace function public\.alumnos_fecha_nacimiento_no_futura\(\)\s*returns trigger\s*language plpgsql\s*security invoker\s*set search_path = ''/.test(b13a),
			/new\.fecha_nacimiento > \(now\(\) at time zone 'America\/Mexico_City'\)::date/.test(b13a), /current_date/.test(b13a)], [true, true, false]);
	ok("5. CHECK nuevo: la lada empieza de 2 a 9 (con guarda, reaplicable)",
		/if not exists \(select 1 from pg_constraint where conname = 'alumnos_tutor_telefono_lada_valida'\) then\s*alter table public\.alumnos add constraint alumnos_tutor_telefono_lada_valida\s*check \(tutor_telefono is null or tutor_telefono ~ '\^\[2-9\]\[0-9\]\{9\}\$'\);/.test(b13a), true);
	const F = require("../js/ficha-alumno.js");
	ok("5. pantalla: «1» + 9 dígitos y «0» + 9 dígitos se rechazan; los prefijos viejos siguen normalizándose",
		[F.normalizarTelefono("1331234567").ok, F.normalizarTelefono("0331234567").ok, F.normalizarTelefono("1 33 1234 5678").digitos, F.normalizarTelefono("+52 1 33 1234 5678").digitos, F.normalizarTelefono("444 123 4567").ok],
		[false, false, "3312345678", "3312345678", true]);
	ok("5. el mensaje explica la lada", /la lada no empieza con 1/.test(F.normalizarTelefono("1331234567").error), true);
	ok("5. sin teléfono válido no hay enlace de WhatsApp", F.enlaceWhatsApp("1331234567"), "");

	// ── 6. Aviso de eliminar grupo ──────────────────────────────────────────────
	const mg = leer("js/mi-grupo.js");
	ok("6. el aviso menciona incidencias, calendario, rol de aseo y listas",
		/con sus incidencias, su calendario, su rol de aseo y sus listas de cooperación y materiales\. Esta acción no se puede deshacer\./.test(mg), true);

	// ── 7. Tras eliminar el grupo activo ────────────────────────────────────────
	function cargarGrupoActivo(guardado) {
		const almacen = {};
		if (guardado) almacen.grupoActivo = JSON.stringify({ id: guardado });
		const win = {
			localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
			location: { reload() {} },
		};
		const doc = { addEventListener() {}, querySelectorAll: () => [], dispatchEvent() {} };
		const ctx = { window: win, document: doc, CustomEvent: function () {}, console };
		vm.createContext(ctx);
		vm.runInContext(leer("js/grupo-activo.js"), ctx);
		return { G: win.GrupoActivo, almacen };
	}
	function sbFalso(grupos, fallo) {
		const filtros = [];
		const q = {
			select() { return q; }, eq(c, v) { filtros.push(["eq", c, v]); return q; }, neq(c, v) { filtros.push(["neq", c, v]); return q; }, order() { return q; },
			then(res) { return Promise.resolve(fallo ? { data: null, error: { message: "sin red" } } : { data: grupos.filter((g) => !filtros.some((f) => f[0] === "neq" && g[f[1]] === f[2])), error: null }).then(res); },
		};
		return { from: () => q, filtros };
	}
	{
		const { G, almacen } = cargarGrupoActivo("g1");
		const sig = typeof G.trasEliminar === "function" ? await G.trasEliminar(sbFalso([{ id: "g1", nombre: "Viejo" }, { id: "g2", nombre: "Otro" }, { id: "g3", nombre: "Tercero" }]), "m1", "g1") : null;
		ok("7. borrado el activo: sigue el primero que queda y queda guardado como activo", [sig && sig.id, almacen.grupoActivo], ["g2", JSON.stringify({ id: "g2" })]);
	}
	{
		const { G, almacen } = cargarGrupoActivo("g3");
		const sig = typeof G.trasEliminar === "function" ? await G.trasEliminar(sbFalso([{ id: "g1" }, { id: "g2" }, { id: "g3" }]), "m1", "g1") : null;
		ok("7. borrado otro grupo: el activo guardado se conserva", [sig && sig.id, almacen.grupoActivo], ["g3", JSON.stringify({ id: "g3" })]);
	}
	{
		const { G, almacen } = cargarGrupoActivo("g1");
		const sig = typeof G.trasEliminar === "function" ? await G.trasEliminar(sbFalso([{ id: "g1" }]), "m1", "g1") : "sin función";
		ok("7. sin grupos: null y se olvida el guardado", [sig, "grupoActivo" in almacen], [null, false]);
	}
	{
		const { G } = cargarGrupoActivo("g1");
		let lanzo = false;
		try { if (typeof G.trasEliminar === "function") await G.trasEliminar(sbFalso([], true), "m1", "g1"); else lanzo = "sin función"; } catch (_) { lanzo = true; }
		ok("7. si la lectura falla, lanza (Mi grupo manda a Inicio, que decide)", lanzo, true);
	}
	ok("7. Mi grupo usa GrupoActivo.trasEliminar y solo va al onboarding si no queda ningún grupo",
		[/siguiente = await window\.GrupoActivo\.trasEliminar\(window\.sb, userId, currentGroup\.id\);\s*if \(!siguiente\) destino = "onboarding\.html";/.test(mg), /var siguiente = null, destino = "dashboard\.html";/.test(mg), /Redirigiendo a onboarding/.test(mg)],
		[true, true, false]);
}

main().then(() => {
	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
