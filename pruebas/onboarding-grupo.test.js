/*
	Onboarding de un grupo:
	  - el ciclo escolar propuesto sigue el calendario de México (empieza a fines de
	    agosto): de agosto a diciembre, año-año+1; de enero a julio, año-1-año;
	  - el grupo recién creado queda como grupo activo (js/grupo-activo.js, elegir), y
	    una lectura del grupo activo que empezó antes no lo pisa con el anterior.

	node pruebas/onboarding-grupo.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const RAIZ = path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/^﻿/, "");

// ── Ciclo propuesto: onboarding.js con un DOM mínimo y la fecha fija ─────────────
async function cicloPropuesto(fechaISO) {
	const elementos = {};
	const el = (id) => elementos[id] || (elementos[id] = {
		id, value: "", hijos: [], classList: { add() {}, remove() {} },
		appendChild(h) { this.hijos.push(h); }, addEventListener() {}, querySelector() { return el(id + "_q"); }, focus() {},
	});
	let listo = null;
	const FechaFija = class extends Date {
		constructor(...a) { if (a.length) super(...a); else super(fechaISO); }
		static now() { return new Date(fechaISO).getTime(); }
	};
	const ventana = {
		sb: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
		location: { href: "" },
	};
	const ctx = {
		window: ventana, Date: FechaFija, console,
		document: {
			addEventListener(tipo, fn) { if (tipo === "DOMContentLoaded") listo = fn; },
			getElementById: el, querySelectorAll: () => [], createElement: () => ({}),
		},
	};
	vm.createContext(ctx);
	vm.runInContext(leer("js/onboarding.js"), ctx);
	await listo();
	return elementos.cicloInicio.value + "-" + elementos.cicloFin.value;
}

// ── Grupo activo: grupo-activo.js con localStorage y Supabase falsos ─────────────
function cargarGrupoActivo(guardadoInicial) {
	const almacen = { grupoActivo: guardadoInicial ? JSON.stringify({ id: guardadoInicial }) : null };
	const ventana = {
		localStorage: {
			getItem: (k) => (almacen[k] === undefined ? null : almacen[k]),
			setItem: (k, v) => { almacen[k] = String(v); },
		},
		location: { reload() {} },
	};
	const ctx = { window: ventana, document: { addEventListener() {}, getElementById: () => null }, console };
	vm.createContext(ctx);
	vm.runInContext(leer("js/grupo-activo.js"), ctx);
	return { GA: ventana.GrupoActivo, almacen };
}
function sbLento(grupos) {
	let soltar;
	const listo = new Promise((r) => { soltar = r; });
	const q = {
		select() { return q; }, eq() { return q; }, order() { return q; },
		then(bien, mal) { return listo.then(() => ({ data: grupos, error: null })).then(bien, mal); },
	};
	return { sb: { from: () => q }, soltar };
}

(async () => {
	ok("24 de septiembre de 2026 → 2026-2027", await cicloPropuesto("2026-09-24T12:00:00"), "2026-2027");
	ok("1 de agosto de 2026 → 2026-2027", await cicloPropuesto("2026-08-01T12:00:00"), "2026-2027");
	ok("31 de diciembre de 2026 → 2026-2027", await cicloPropuesto("2026-12-31T12:00:00"), "2026-2027");
	ok("15 de marzo de 2027 → 2026-2027", await cicloPropuesto("2027-03-15T12:00:00"), "2026-2027");
	ok("31 de julio de 2027 → 2026-2027", await cicloPropuesto("2027-07-31T12:00:00"), "2026-2027");

	// elegir deja el grupo nuevo como activo
	{
		const { GA, almacen } = cargarGrupoActivo("viejo");
		ok("GrupoActivo.elegir existe", typeof GA.elegir, "function");
		if (typeof GA.elegir === "function") {
			GA.elegir("nuevo");
			ok("elegir guarda el grupo nuevo", JSON.parse(almacen.grupoActivo).id, "nuevo");
		}
	}
	// Una lectura que empezó antes de crear el grupo (no lo trae) no lo pisa
	{
		const { GA, almacen } = cargarGrupoActivo("viejo");
		const { sb, soltar } = sbLento([{ id: "viejo", nombre: "R2" }, { id: "otro", nombre: "QA" }]);
		const lectura = GA.cargar(sb, "m");
		if (typeof GA.elegir === "function") GA.elegir("nuevo");
		soltar();
		await lectura;
		ok("la lectura vieja no pisa el grupo elegido", JSON.parse(almacen.grupoActivo).id, "nuevo");
	}
	// Sin elegir nada, la regla de siempre: el guardado si existe
	{
		const { GA, almacen } = cargarGrupoActivo("otro");
		const { sb, soltar } = sbLento([{ id: "viejo" }, { id: "otro" }]);
		const lectura = GA.cargar(sb, "m");
		soltar();
		const r = await lectura;
		ok("sin elegir: se respeta el guardado", [r.grupo.id, JSON.parse(almacen.grupoActivo).id], ["otro", "otro"]);
	}

	// El onboarding usa GrupoActivo al crear el grupo y la página carga el script antes
	const html = leer("onboarding.html");
	const iGA = html.indexOf('src="js/grupo-activo.js"'), iOn = html.indexOf('src="js/onboarding.js"');
	ok("onboarding.html carga grupo-activo.js antes de onboarding.js", iGA !== -1 && iGA < iOn, true);
	const js = leer("js/onboarding.js");
	const iInsert = js.indexOf('.from("grupos").insert(');
	const iElegir = js.indexOf("GrupoActivo.elegir(currentGroupId)");
	ok("onboarding.js elige el grupo recién creado después de insertarlo", iInsert !== -1 && iElegir > iInsert, true);

	console.log(fallos ? "\n" + fallos + " FALLAS" : "\nTODO OK");
	process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
