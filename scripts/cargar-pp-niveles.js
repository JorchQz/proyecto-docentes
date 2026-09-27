/*
	cargar-pp-niveles.js — Carga un proyecto del bot (dosificacion_*) en el grupo de una docente
	con productos POR GRUPO DE TRABAJO (niveles) y su "¿Para quién?" alumno por alumno, según un
	plan en JSON. Se hizo para PP-NIVELES del grupo de Fanny (decisiones de Jorge del 2026-09-27):
	dos agrupaciones por nivel (lectoescritura: Morado, Naranja, Azul; matemáticas: Círculos,
	Triángulos, Cuadrados) que sirven SOLO para asignar a cada alumno lo que la docente revisa. La
	lista, la asistencia y lo demás no cambian: el grupo no se parte.

	Hace lo mismo que el importador de la tienda y con su mismo código (js/importador.js, que
	materializa con js/sesiones-materializar.js; "¿Para quién?" con la RPC guardar_asignacion_producto):
	  - proyecto ACTIVO del trimestre del plan; 15 sesiones SIN fecha en el orden de la planeación;
	  - PDA por grado (sesiones_pda con el pda_id del catálogo);
	  - antes de materializar, los trabajos con nombre por grupo ("... · Naranja"): el
	    materializador los empareja con su hueco (trabajo de 1°, de 2°) y no crea el genérico;
	    las tareas por grado las materializa él desde cierre_tareas;
	  - "¿Para quién?" de cada trabajo (producto_sesion_alumnos, incluir / excluir) con la regla de
	    Hoy (ProductosHoy.planAsignacion) y la liga producto-PDA del nivel ("pda" del plan: un alumno
	    de 2° en Morado de Lenguajes, PDA de 1°; un trabajo con "pda": [1, 2] se liga a los dos y cada
	    alumno deja evidencia en los de su grado);
	  - los pasos de cada fase, tal como vienen en la planeación y en su orden (2026-09-27, Jorge:
	    la planeación es la fuente). El plan PUEDE mover un paso a un grupo de trabajo (texto.*,
	    llaves "Morado"; js/texto-sesion.js), pero PP-NIVELES ya no lo hace: se mostraba al final
	    de la fase y cambiaba el orden de la clase;
	  - día, horario y bloque de la planeación en `duracion` (nunca `fecha`: marcaría la sesión como
	    trabajada);
	  - recursos: la carpeta de Drive de la sesión y cada PDF (en lugar de los enlaces de la
	    tienda, que no abren para un personalizado); el producto final va en el propósito.

	Todo en UNA transacción, como la docente (rol authenticated con su id: las políticas RLS y el
	candado de solo lectura aplican igual que en la app), y al final una comprobación; si algo no
	cuadra, no se escribe nada. No lleva secretos ni nombres de alumnos: los nombres viven en el
	plan (docs/referencia/, ignorado por git).

	Uso (desde la raíz del repo):
	  node scripts/cargar-pp-niveles.js --base pruebas|prod --grupo <id del grupo> --simular
	  node scripts/cargar-pp-niveles.js --base pruebas|prod --grupo <id del grupo> --aplicar
	Opciones:
	  --dosificacion <id>      proyecto del bot (por omisión, el del plan)
	  --plan <archivo>         por omisión docs/referencia/pp-niveles-plan.json
	  --equivalencias <archivo> { "Nombre del plan": "PALABRAS DEL NOMBRE", ... } para encontrar a cada alumno
	                           con otro nombre (grupo espejo de pruebas)
	  --json <archivo>         lee la dosificación de un JSON exportado en vez de la base
	  --exportar-json <archivo> solo exporta la dosificación de la base a un JSON (no escribe en la base)
	--simular no escribe nada (transacción de solo lectura): imprime lo que va a escribir, con
	conteos y la tabla por sesión. La cadena de conexión sale de PRUEBAS_DB_URL / PROD_DB_URL
	(variable de entorno) o de .env.local (el del repo o el de una carpeta superior); nunca se imprime.
	Necesita el paquete "pg" (el de .qa/node_modules si existe).
*/
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.join(__dirname, "..");

// ── Entorno ────────────────────────────────────────────────────────────────
function buscarHaciaArriba(relativo) {
	let dir = RAIZ;
	for (let i = 0; i < 6; i++) {
		const p = path.join(dir, relativo);
		if (fs.existsSync(p)) return p;
		const arriba = path.dirname(dir);
		if (arriba === dir) break;
		dir = arriba;
	}
	return null;
}
function cargarPg() {
	try { return require("pg"); } catch (_) { /* sigue */ }
	const p = buscarHaciaArriba(path.join(".qa", "node_modules", "pg"));
	if (!p) throw new Error('Falta el paquete "pg" (npm install pg o .qa/node_modules)');
	return require(p);
}
function urlBase(base) {
	const nombre = base === "prod" ? "PROD_DB_URL" : "PRUEBAS_DB_URL";
	if (process.env[nombre]) return process.env[nombre];
	const archivo = buscarHaciaArriba(".env.local");
	if (!archivo) return null;
	const linea = fs.readFileSync(archivo, "utf8").split(/\r?\n/).find((l) => l.startsWith(nombre + "="));
	return linea ? linea.slice(nombre.length + 1).trim() : null;
}
function argumentos(argv) {
	const a = { modo: null };
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		if (k === "--simular" || k === "--aplicar") { a.modo = k.slice(2); continue; }
		if (k.startsWith("--")) { a[k.slice(2)] = argv[i + 1]; i++; }
	}
	return a;
}

// ── Código compartido con la app (el mismo que corre en el navegador) ──────
global.window = global.window || {};
require(path.join(RAIZ, "js", "campos-formativos.js"));
require(path.join(RAIZ, "js", "sesiones-materializar.js"));
const AlcanceHoy = require(path.join(RAIZ, "js", "alcance-hoy.js"));
const ProductosHoy = require(path.join(RAIZ, "js", "productos-hoy.js"));
const TextoSesion = require(path.join(RAIZ, "js", "texto-sesion.js"));
const Importador = require(path.join(RAIZ, "js", "importador.js"));
const CF = global.window.CamposFormativos;
const SM = global.window.SesionesMaterializar;

// ── Reglas del plan (sin base de datos; pruebas/cargar-pp-niveles.test.js) ──
function normal(s) {
	return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9Ñ ]/g, " ").split(/\s+/).filter(Boolean);
}

/*
	resolverAlumnos(plan, alumnos, equivalencias) → { porClave: { clave: alumno }, errores: [] }
	Cada clave del plan (nombre de pila del anexo) encuentra a UN alumno activo de su grado cuyo
	nombre trae todas sus palabras; los 16 quedan cubiertos una sola vez.
*/
function resolverAlumnos(plan, alumnos, equivalencias) {
	const porClave = {}, errores = [], usados = {};
	Object.keys(plan.alumnos || {}).forEach((clave) => {
		const def = plan.alumnos[clave];
		const busca = normal((equivalencias && equivalencias[clave]) || def.busca);
		const cand = alumnos.filter((a) => Number(a.grado) === Number(def.grado) &&
			busca.every((p) => normal(a.nombre_completo).indexOf(p) !== -1));
		if (cand.length !== 1) { errores.push(clave + ": " + cand.length + " alumnos de " + def.grado + "° coinciden"); return; }
		if (usados[cand[0].id]) { errores.push(clave + ": el mismo alumno que " + usados[cand[0].id]); return; }
		usados[cand[0].id] = clave;
		porClave[clave] = cand[0];
	});
	alumnos.forEach((a) => { if (!usados[a.id]) errores.push("alumno activo sin clave en el plan (" + a.grado + "°, lista " + (a.num_lista || "?") + ")"); });
	return { porClave: porClave, errores: errores };
}

// Los miembros (claves) de un "para" del plan: { grupo, solo_grado } o { grado }
function miembrosDe(para, plan) {
	if (para.grupo) {
		let lista = null;
		Object.keys(plan.agrupaciones || {}).forEach((ag) => { if (plan.agrupaciones[ag][para.grupo]) lista = plan.agrupaciones[ag][para.grupo]; });
		if (!lista) throw new Error("El plan no tiene el grupo de trabajo «" + para.grupo + "»");
		return para.solo_grado ? lista.filter((c) => Number(plan.alumnos[c].grado) === Number(para.solo_grado)) : lista.slice();
	}
	if (para.grado) return Object.keys(plan.alumnos).filter((c) => Number(plan.alumnos[c].grado) === Number(para.grado));
	throw new Error("«para» sin grupo ni grado");
}

/*
	asignacionDe(para, plan, alumnos, porClave, gradosGrupo) → { grados, filas, miembros: [ids] }
	La misma regla que Hoy al elegir alumnos (ProductosHoy.planAsignacion): por grado, todos → el
	grado; más de la mitad → el grado sin los que no; si no, uno por uno (incluir).
*/
function asignacionDe(para, plan, alumnos, porClave, gradosGrupo) {
	const miembros = miembrosDe(para, plan).map((c) => porClave[c] && porClave[c].id).filter(Boolean);
	const r = para.grado && !para.grupo
		? ProductosHoy.planAsignacion({ modo: "grados", gradosGrupo: gradosGrupo, gradosElegidos: [para.grado], alumnos: alumnos })
		: ProductosHoy.planAsignacion({ modo: "alumnos", gradosGrupo: gradosGrupo, alumnos: alumnos, elegidos: miembros });
	if (!r.ok) throw new Error(r.error);
	return { grados: r.grados, filas: r.filas, miembros: miembros };
}

// Quién recibe un producto con esa asignación (AlcanceHoy.asignadoA: la regla única)
function recibenCon(grados, filas, alumnos) {
	const asig = { _: {} };
	filas.forEach((f) => { asig._[f.alumno_id] = f.modo; });
	return alumnos.filter((a) => AlcanceHoy.asignadoA(a, { id: "_", grados: grados }, asig)).map((a) => a.id);
}

// JSON con las llaves ordenadas (jsonb no guarda el orden de las llaves)
function estable(v) {
	if (Array.isArray(v)) return "[" + v.map(estable).join(",") + "]";
	if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + estable(v[k])).join(",") + "}";
	return JSON.stringify(v === undefined ? null : v);
}

// Mayúscula inicial (sin tocar lo demás)
function mayuscula(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function palabras(s) { return normal(s).filter((w) => w.length >= 3); }

/*
	textoPorGrupo(actividades, movimientos, ordenGrupos) → *_actividades con los pasos de cada
	grupo de trabajo en diferenciado (llave = el grupo) y los de todo el grupo en todos.
	movimientos: [{ paso, llave, quitar, antes? }] (el paso empieza con "quitar", que se quita) o
	[{ paso, empieza, grupos: [{ llave, texto }] }] (un paso que se reparte entre varios grupos).
	Se comprueba que cada paso sea el que se esperaba y que el texto nuevo no traiga palabras que
	no estaban (solo se quita el rótulo): si no, error y no se escribe nada.
*/
function textoPorGrupo(actividades, movimientos, ordenGrupos, donde) {
	if (!movimientos || !movimientos.length) return actividades;
	if (!actividades || actividades.mode !== "todos" || !Array.isArray(actividades.todos)) throw new Error(donde + ": se esperaban pasos para todo el grupo");
	const todos = actividades.todos.slice();
	const quitar = {};
	const dif = {};
	movimientos.forEach((m) => {
		const original = todos[m.paso - 1];
		if (!original) throw new Error(donde + ": no existe el paso " + m.paso);
		const partes = m.grupos
			? (original.indexOf(m.empieza) === 0 ? m.grupos : null)
			: (original.indexOf(m.quitar) === 0 ? [{ llave: m.llave, texto: (m.antes || "") + (!m.antes || /\.\s$/.test(m.antes) ? mayuscula(original.slice(m.quitar.length)) : original.slice(m.quitar.length)) }] : null);
		if (!partes) throw new Error(donde + ", paso " + m.paso + ": no empieza como se esperaba («" + (m.empieza || m.quitar) + "»)");
		const suyas = palabras(original);
		partes.forEach((p) => {
			const nuevas = palabras(p.texto).filter((w) => suyas.indexOf(w) === -1);
			if (nuevas.length) throw new Error(donde + ", paso " + m.paso + ": el texto de " + p.llave + " trae palabras que no están en la planeación: " + nuevas.join(", "));
			(dif[p.llave] = dif[p.llave] || []).push(p.texto);
		});
		quitar[m.paso - 1] = true;
	});
	const orden = TextoSesion.llavesEnOrden(dif, ordenGrupos);
	return Object.assign({}, actividades, {
		todos: todos.filter((_, i) => !quitar[i]),
		diferenciado: dif,
		orden_grupos: orden,
	});
}

// Recursos: la carpeta de la sesión y cada anexo por su enlace de Drive (los de la tienda no abren
// para un proyecto personalizado); los libros de texto se quedan
function recursosDeSesion(recursos, numero, plan) {
	const base = recursos && typeof recursos === "object" && !Array.isArray(recursos) ? recursos : { links: [], archivos: [] };
	const links = [];
	const carpeta = plan.drive && plan.drive.carpetas_por_sesion && plan.drive.carpetas_por_sesion[numero];
	if (carpeta) links.push({ titulo: "Anexos de la sesión " + numero + " (carpeta de Drive)", url: "https://drive.google.com/drive/folders/" + carpeta });
	(base.links || []).forEach((l) => {
		const m = String(l && l.url || "").match(/[?&]a=(ANX-[A-Za-z0-9-]+)/);
		if (!m) { links.push(l); return; }
		const anx = plan.anexos && plan.anexos[m[1]];
		if (!anx) throw new Error("Sesión " + numero + ": el plan no tiene el anexo " + m[1]);
		const corto = m[1].replace(/^.*-(S\d{2}-\d{2})$/, "$1");
		links.push({ titulo: corto + " · " + anx.titulo, url: "https://drive.google.com/file/d/" + anx.id + "/view" });
	});
	return { links: links, archivos: base.archivos || [] };
}

/*
	ajustarFila(fila, numero, plan, catalogo) → la fila de `sesiones` que arma el importador, con lo
	del plan: pasos por grupo solo si el plan los pide (texto.*; PP-NIVELES no: los pasos se quedan
	en su orden, como la planeación), recursos de Drive, el texto del catálogo en cada PDA y el día,
	horario y bloque de la planeación en `duracion` ("Lunes 28 sep · 8:00 a 9:20 · Letras": se ve en
	Actividades y en Crear proyecto). Nunca pone `fecha` (marcaría la sesión como trabajada).
*/
function ajustarFila(fila, numero, plan, catalogo) {
	const ps = (plan.sesiones || {})[numero] || {};
	["inicio", "desarrollo", "cierre"].forEach((fase) => {
		fila[fase + "_actividades"] = textoPorGrupo(fila[fase + "_actividades"], (ps.texto || {})[fase], plan.orden_grupos, "Sesión " + numero + " (" + fase + ")");
	});
	fila.recursos = recursosDeSesion(fila.recursos, numero, plan);
	fila.pda_sesion = (fila.pda_sesion || []).map((p) => Object.assign({}, p, { pda_texto: (catalogo || {})[p.pda_id] || p.pda_texto }));
	if (ps.duracion) fila.duracion = String(ps.duracion);
	delete fila.fecha;
	return fila;
}

// ── Base de datos: el cliente de Supabase que usan importador y materializador, sobre pg ──
/*
	sbDesdePg(cliente, { memoria, simular }) → { from(tabla)…, rpc(nombre, params) }
	  memoria: { tabla: [filas] } que se sirven de aquí (la dosificación leída antes)
	  simular: las escrituras van a una capa en memoria (la base no se toca); las lecturas juntan
	    lo de la base y lo de la capa.
	Solo lo que usan js/importador.js y js/sesiones-materializar.js: select de columnas simples,
	eq, in, is null, order, range, single, insert, update, delete (con select para devolver filas).
*/
function sbDesdePg(cliente, opts) {
	opts = opts || {};
	const memoria = opts.memoria || {};
	const capa = {};
	const tipos = {};
	async function tipoDe(tabla) {
		if (tipos[tabla]) return tipos[tabla];
		const r = await cliente.query("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1", [tabla]);
		tipos[tabla] = {};
		r.rows.forEach((f) => { tipos[tabla][f.column_name] = f.data_type; });
		return tipos[tabla];
	}
	const IDENT = /^[a-z_][a-z0-9_]*$/;
	function columnas(sel) {
		const s = String(sel || "*").trim();
		if (!s || s === "*") return "*";
		const cols = s.split(",").map((c) => c.trim());
		cols.forEach((c) => { if (!IDENT.test(c)) throw new Error("Columna no soportada: " + c); });
		return cols;
	}
	function proyectar(fila, cols) {
		if (cols === "*") return Object.assign({}, fila);
		const o = {};
		cols.forEach((c) => { o[c] = fila[c] === undefined ? null : fila[c]; });
		return o;
	}
	function cumple(fila, filtros) {
		return filtros.every((f) => {
			const v = fila[f.col] === undefined ? null : fila[f.col];
			if (f.op === "eq") return String(v) === String(f.val);
			if (f.op === "in") return f.val.map(String).indexOf(String(v)) !== -1;
			if (f.op === "is") return v === null;
			return false;
		});
	}
	function ordenar(filas, orden) {
		return filas.sort((a, b) => {
			for (const o of orden) {
				const x = a[o.col] === null || a[o.col] === undefined ? "" : String(a[o.col]);
				const y = b[o.col] === null || b[o.col] === undefined ? "" : String(b[o.col]);
				if (x !== y) return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
			}
			return 0;
		});
	}
	function valor(tipo, v) {
		if (v === undefined) return null;
		if ((tipo === "jsonb" || tipo === "json") && v !== null) return JSON.stringify(v);
		return v;
	}
	function cast(tipo) { return tipo === "jsonb" ? "::jsonb" : tipo === "json" ? "::json" : ""; }

	function from(tabla) {
		if (!IDENT.test(tabla)) throw new Error("Tabla no soportada: " + tabla);
		const q = { op: "select", cols: "*", filtros: [], orden: [], rango: null, uno: false, filas: null, cambios: null, devolver: null };
		const api = {
			select(sel) { if (q.op === "select") q.cols = columnas(sel); else q.devolver = columnas(sel); return api; },
			eq(col, val) { q.filtros.push({ op: "eq", col: col, val: val }); return api; },
			in(col, val) { q.filtros.push({ op: "in", col: col, val: val || [] }); return api; },
			is(col, val) { if (val !== null) throw new Error(".is solo con null"); q.filtros.push({ op: "is", col: col }); return api; },
			order(col, o) { q.orden.push({ col: col, asc: !(o && o.ascending === false) }); return api; },
			range(a, b) { q.rango = [a, b]; return api; },
			single() { q.uno = true; return api; },
			maybeSingle() { q.uno = "tal vez"; return api; },
			insert(filas) { q.op = "insert"; q.filas = Array.isArray(filas) ? filas : [filas]; return api; },
			update(c) { q.op = "update"; q.cambios = c; return api; },
			delete() { q.op = "delete"; return api; },
			then(resolver, rechazar) { return ejecutar(tabla, q).then(resolver, rechazar); },
		};
		return api;
	}

	async function ejecutar(tabla, q) {
		try {
			let data = await (memoria[tabla] ? enMemoria(tabla, q) : (opts.simular && q.op !== "select" ? enCapa(tabla, q) : enBase(tabla, q)));
			if (q.uno) {
				if (data.length !== 1 && q.uno === true) return { data: null, error: { message: "Se esperaba una fila y hubo " + data.length, code: "PGRST116" } };
				data = data[0] || null;
			}
			return { data: data, error: null };
		} catch (e) {
			return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } };
		}
	}

	function enMemoria(tabla, q) {
		if (q.op !== "select") throw new Error("La dosificación no se escribe: " + tabla);
		let filas = memoria[tabla].filter((f) => cumple(f, q.filtros));
		filas = ordenar(filas, q.orden);
		if (q.rango) filas = filas.slice(q.rango[0], q.rango[1] + 1);
		return filas.map((f) => proyectar(f, q.cols));
	}

	function enCapa(tabla, q) {
		const t = capa[tabla] = capa[tabla] || [];
		if (q.op === "insert") {
			const ahora = new Date().toISOString();
			const nuevas = q.filas.map((f) => {
				const fila = Object.assign({}, f);
				if (tabla !== "producto_sesion_pda" && !fila.id) fila.id = crypto.randomUUID();
				if (!fila.created_at && tabla !== "producto_sesion_pda") fila.created_at = ahora;
				if (tabla === "productos_sesion" && fila.activo === undefined) fila.activo = true;
				t.push(fila);
				return fila;
			});
			return q.devolver ? nuevas.map((f) => proyectar(f, q.devolver)) : null;
		}
		const tocadas = t.filter((f) => cumple(f, q.filtros));
		if (q.op === "update") tocadas.forEach((f) => Object.assign(f, q.cambios));
		if (q.op === "delete") capa[tabla] = t.filter((f) => !cumple(f, q.filtros));
		return q.devolver ? tocadas.map((f) => proyectar(f, q.devolver)) : null;
	}

	async function enBase(tabla, q) {
		const tipo = await tipoDe(tabla);
		const params = [];
		const p = (v) => { params.push(v); return "$" + params.length; };
		const where = q.filtros.map((f) => {
			if (!IDENT.test(f.col)) throw new Error("Columna no soportada: " + f.col);
			if (f.op === "eq") return f.col + " = " + p(valor(tipo[f.col], f.val)) + cast(tipo[f.col]);
			if (f.op === "in") return f.col + " = any(" + p(f.val) + ")";
			return f.col + " is null";
		});
		const w = where.length ? " where " + where.join(" and ") : "";
		const lista = (cols) => (cols === "*" ? "*" : cols.join(", "));
		let sql;
		if (q.op === "select") {
			sql = "select " + lista(q.cols) + " from public." + tabla + w +
				(q.orden.length ? " order by " + q.orden.map((o) => o.col + (o.asc ? " asc" : " desc")).join(", ") : "") +
				(q.rango ? " offset " + Number(q.rango[0]) + " limit " + (Number(q.rango[1]) - Number(q.rango[0]) + 1) : "");
		} else if (q.op === "insert") {
			const cols = Array.from(new Set([].concat.apply([], q.filas.map((f) => Object.keys(f)))));
			cols.forEach((c) => { if (!IDENT.test(c) || !tipo[c]) throw new Error("Columna desconocida en " + tabla + ": " + c); });
			const valores = q.filas.map((f) => "(" + cols.map((c) => (c in f ? p(valor(tipo[c], f[c])) + cast(tipo[c]) : "default")).join(", ") + ")");
			sql = "insert into public." + tabla + " (" + cols.join(", ") + ") values " + valores.join(", ") + (q.devolver ? " returning " + lista(q.devolver) : "");
		} else if (q.op === "update") {
			const sets = Object.keys(q.cambios).map((c) => {
				if (!IDENT.test(c) || !tipo[c]) throw new Error("Columna desconocida en " + tabla + ": " + c);
				return c + " = " + p(valor(tipo[c], q.cambios[c])) + cast(tipo[c]);
			});
			sql = "update public." + tabla + " set " + sets.join(", ") + w + (q.devolver ? " returning " + lista(q.devolver) : "");
		} else {
			sql = "delete from public." + tabla + w + (q.devolver ? " returning " + lista(q.devolver) : "");
		}
		const r = await cliente.query(sql, params);
		let filas = r.rows;
		if (opts.simular && q.op === "select") {
			// Lo que "se escribió" en la simulación también se lee
			let extra = (capa[tabla] || []).filter((f) => cumple(f, q.filtros)).map((f) => proyectar(f, q.cols));
			filas = ordenar(filas.concat(extra), q.orden);
			if (q.rango && extra.length) filas = filas.slice(0, Number(q.rango[1]) - Number(q.rango[0]) + 1);
		}
		return q.op === "select" || q.devolver ? filas : null;
	}

	async function rpc(nombre, params) {
		try {
			if (nombre !== "guardar_asignacion_producto") throw new Error("RPC no soportada: " + nombre);
			if (opts.simular) {
				const t = capa.producto_sesion_alumnos = (capa.producto_sesion_alumnos || []).filter((f) => f.producto_sesion_id !== params.p_producto);
				params.p_filas.forEach((f) => t.push({ id: crypto.randomUUID(), producto_sesion_id: params.p_producto, alumno_id: f.alumno_id, modo: f.modo }));
				return { data: null, error: null };
			}
			await cliente.query("select public.guardar_asignacion_producto(p_producto => $1::uuid, p_filas => $2::jsonb)", [params.p_producto, JSON.stringify(params.p_filas)]);
			return { data: null, error: null };
		} catch (e) {
			return { data: null, error: { message: e.message, code: e.code, hint: e.hint } };
		}
	}

	return { from: from, rpc: rpc, capa: capa };
}

// ── Lo que se escribe (para imprimir y comprobar) ──────────────────────────
function resumenPara(prod, asignacion, alumnos) {
	return ProductosHoy.resumenPara({ grados: prod.grados }, asignacion, alumnos) || ProductosHoy.etiquetaGrados(prod.grados) || "—";
}

async function principal() {
	const a = argumentos(process.argv.slice(2));
	const base = a.base;
	if (base !== "pruebas" && base !== "prod") throw new Error("Falta --base pruebas|prod");
	if (!a["exportar-json"] && !a.grupo) throw new Error("Falta --grupo <id del grupo destino>");
	if (!a["exportar-json"] && a.modo !== "simular" && a.modo !== "aplicar") throw new Error("Falta --simular o --aplicar");
	const archivoPlan = path.resolve(a.plan || path.join(RAIZ, "docs", "referencia", "pp-niveles-plan.json"));
	const plan = JSON.parse(fs.readFileSync(archivoPlan, "utf8"));
	const equivalencias = a.equivalencias ? JSON.parse(fs.readFileSync(path.resolve(a.equivalencias), "utf8")) : null;
	const dosId = a.dosificacion || plan.dosificacion;

	const url = urlBase(base);
	if (!url) throw new Error("Falta la cadena de conexión de " + base + " (variable de entorno o .env.local)");
	const { Client, types } = cargarPg();
	// Fechas y marcas de tiempo como texto, igual que las devuelve Supabase (el materializador
	// ordena por created_at como texto)
	[1082, 1114, 1184].forEach((oid) => types.setTypeParser(oid, (v) => v));
	const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
	await c.connect();
	const q = async (sql, params) => (await c.query(sql, params)).rows;
	const aplicar = a.modo === "aplicar";
	console.log("Base: " + base + " · modo: " + (a["exportar-json"] ? "exportar" : a.modo) + " · plan: " + path.basename(archivoPlan));

	try {
		await c.query(aplicar ? "begin" : "begin read only");
		await c.query("set local lock_timeout = '5s'");

		// 1. Dosificación del bot (de la base, como dueño, o de un JSON exportado)
		let dos;
		if (a.json) {
			dos = JSON.parse(fs.readFileSync(path.resolve(a.json), "utf8"));
		} else {
			dos = {
				dosificacion_proyectos: await q("select * from public.dosificacion_proyectos where id = $1", [dosId]),
				dosificacion_sesiones: await q("select * from public.dosificacion_sesiones where proyecto_dos_id = $1 order by numero_sesion", [dosId]),
				dosificacion_pdas: await q("select * from public.dosificacion_pdas where proyecto_dos_id = $1", [dosId]),
			};
		}
		if (a["exportar-json"]) {
			fs.writeFileSync(path.resolve(a["exportar-json"]), JSON.stringify(dos, null, 1));
			console.log("Exportada la dosificación a " + a["exportar-json"] + " (" + dos.dosificacion_sesiones.length + " sesiones).");
			await c.query("rollback");
			return 0;
		}
		const dosProy = dos.dosificacion_proyectos[0];
		if (!dosProy) throw new Error("No existe la dosificación " + dosId);
		console.log("Proyecto del bot: «" + dosProy.nombre_proyecto + "» · " + dos.dosificacion_sesiones.length + " sesiones · " + dos.dosificacion_pdas.length + " PDA");

		// 2. Grupo destino, su docente y sus alumnos activos
		const grupo = (await q("select id, maestro_id, nombre, grados, trimestre_actual, ciclo_escolar from public.grupos where id = $1", [a.grupo]))[0];
		if (!grupo) throw new Error("No existe el grupo " + a.grupo);
		const alumnos = await q("select id, nombre_completo, grado, num_lista from public.alumnos where grupo_id = $1 and estatus = 'activo' order by grado, num_lista", [grupo.id]);
		console.log("Grupo: «" + grupo.nombre + "» · grados " + (grupo.grados || []).join(", ") + " · " + alumnos.length + " alumnos activos");

		// 3. Lo que hace falta en la base (b17: "¿Para quién?"; b24: evidencia de los incluidos). Se
		// revisa aquí y se exige después de validar el plan (así una simulación antes de las
		// migraciones ya comprueba alumnos, grupos y productos)
		const hay = (await q("select to_regclass('public.producto_sesion_alumnos') is not null as asignacion, " +
			"exists (select 1 from pg_proc where proname = 'guardar_asignacion_producto') as rpc, " +
			"exists (select 1 from pg_proc where proname = 'pda_de_alumno_en_producto') as b24"))[0];
		if (!hay.b24) console.log("AVISO: la base no tiene b24 (mi_salon_b24_evidencia_incluidos): los trabajos de Morado y Triángulos de un alumno de 2° cuentan en su boleta, pero no dejan evidencia en los PDA de 1°.");

		// 4. No duplicar
		const ya = await q("select id, estado from public.proyectos where grupo_id = $1 and titulo = $2", [grupo.id, dosProy.nombre_proyecto]);
		if (ya.length) {
			console.log("\nYA EXISTE este proyecto en el grupo (id " + ya[0].id + ", " + ya[0].estado + "): no se carga otra vez. Nada cambió.");
			await c.query("rollback");
			return 2;
		}

		// 5. Alumnos del plan → alumnos del grupo
		const res = resolverAlumnos(plan, alumnos, equivalencias);
		if (res.errores.length) throw new Error("Los alumnos del plan no cuadran con el grupo:\n  - " + res.errores.join("\n  - "));
		const claveDe = {};
		Object.keys(res.porClave).forEach((k) => { claveDe[res.porClave[k].id] = k; });
		const gradosGrupo = (grupo.grados || []).map(Number);

		// 6. Catálogo: el texto de cada PDA (el mismo que pone Crear proyecto)
		const pdaIds = Array.from(new Set(dos.dosificacion_pdas.map((d) => d.pda_id)));
		const catalogo = {};
		(await q("select id, pda from public.catalogo_pda where id = any($1)", [pdaIds])).forEach((r) => { catalogo[r.id] = r.pda; });
		const faltan = pdaIds.filter((id) => !catalogo[id]);
		if (faltan.length) throw new Error(faltan.length + " PDA de la dosificación no están en el catálogo de esta base");

		// 7. Plan de productos por sesión (sin escribir): asignación y quién lo recibe
		const porNumero = {};
		const errores = [];
		dos.dosificacion_sesiones.forEach((ds) => {
			const ps = plan.sesiones[ds.numero_sesion];
			if (!ps) { errores.push("Sesión " + ds.numero_sesion + ": no está en el plan"); return; }
			const campo = CF.corto(ds.campo_formativo);
			const recibe = {};
			const productos = ps.productos.map((p, i) => {
				const asig = asignacionDe(p.para, plan, alumnos, res.porClave, gradosGrupo);
				const reciben = recibenCon(asig.grados, asig.filas, alumnos);
				const esperado = asig.miembros.slice().sort().join(",");
				if (reciben.slice().sort().join(",") !== esperado) errores.push("Sesión " + ds.numero_sesion + ", «" + p.nombre + "»: la asignación no da exactamente sus alumnos");
				reciben.forEach((id) => { recibe[id] = (recibe[id] || 0) + 1; });
				if (p.nombre.length > ProductosHoy.NOMBRE_MAX) errores.push("Sesión " + ds.numero_sesion + ": nombre de más de " + ProductosHoy.NOMBRE_MAX + " letras: " + p.nombre);
				return { orden: i + 1, nombre: p.nombre, campo: campo, grados: asig.grados, filas: asig.filas, reciben: reciben, pda: p.pda, para: p.para };
			});
			// Cada alumno recibe exactamente un trabajo por sesión (el de su grupo)
			alumnos.forEach((al) => { if (recibe[al.id] !== 1) errores.push("Sesión " + ds.numero_sesion + ": " + claveDe[al.id] + " recibe " + (recibe[al.id] || 0) + " trabajos"); });
			porNumero[ds.numero_sesion] = { ds: ds, campo: campo, productos: productos };
		});
		if (errores.length) throw new Error("El plan no cuadra:\n  - " + errores.join("\n  - "));
		console.log("Plan: alumnos del grupo resueltos (" + Object.keys(res.porClave).length + ") y cada uno recibe un trabajo por sesión.");

		if (!hay.asignacion || !hay.rpc) {
			if (aplicar) throw new Error("La base no tiene «¿Para quién?» (migración b17): aplica las migraciones antes de cargar.");
			console.log("\nLa base aún no tiene «¿Para quién?» (migración b17): el plan cuadra con el grupo, pero la escritura " +
				"solo se puede simular después de aplicar las migraciones. Nada se escribió.");
			Object.keys(porNumero).map(Number).sort((x, y) => x - y).forEach((n) => porNumero[n].productos.forEach((p) => {
				console.log(n + " | " + p.nombre + " | " + p.campo + " | PDA " + p.pda.map((g) => g + "°").join(", ") + " | " + p.reciben.map((id) => claveDe[id]).join(", "));
			}));
			await c.query("rollback");
			return 3;
		}

		// 8. Importar como el importador (en una transacción; como la docente, con RLS)
		await c.query("set local role authenticated");
		await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
			[JSON.stringify({ sub: grupo.maestro_id, role: "authenticated" }), grupo.maestro_id]);
		const sb = sbDesdePg(c, { simular: !aplicar, memoria: {
			dosificacion_proyectos: dos.dosificacion_proyectos, dosificacion_sesiones: dos.dosificacion_sesiones, dosificacion_pdas: dos.dosificacion_pdas,
		} });
		global.window.sb = sb;
		let resumenMat = null;
		const insertados = {}; // sesionId → [productos insertados]
		const sesionPorNumero = {};
		const proyectoId = await Importador.importarProyecto(dosProy.id, grupo.maestro_id, grupo.id, {
			trimestre: plan.proyecto.trimestre, estado: plan.proyecto.estado,
			ajustarSesion: function (fila, ds) { return ajustarFila(fila, ds.numero_sesion, plan, catalogo); },
			antesDeMaterializar: async function (sesiones) {
				const base = Date.now();
				let k = 0;
				for (const s of sesiones) {
					sesionPorNumero[s.numero_sesion] = s;
					const filas = porNumero[s.numero_sesion].productos.map((p) => ({
						sesion_id: s.id, maestro_id: grupo.maestro_id, tipo: "trabajo", nombre: p.nombre, grados: p.grados,
						modalidad: "diferenciada", campo: p.campo, orden: p.orden, origen: "importado",
						created_at: new Date(base + (k++)).toISOString(),
					}));
					// Los huecos del materializador (trabajo de cada grado) deben quedar llenos con estos
					const pares = SM.emparejarPlan(s, grupo.grados, filas.map((f, i) => Object.assign({ id: "plan-" + i }, f)));
					const vacios = pares.filter((x) => x.hueco.tipo === "trabajo" && !x.producto);
					if (vacios.length) throw new Error("Sesión " + s.numero_sesion + ": el trabajo de " + vacios.map((x) => x.hueco.grados.join(",") + "°").join(" y ") + " no tiene producto por grupo");
					const r = await sb.from("productos_sesion").insert(filas).select("id, sesion_id, nombre, grados, orden");
					if (r.error) throw r.error;
					insertados[s.id] = r.data;
				}
			},
			alMaterializar: function (r) { resumenMat = r; },
		});
		if (!resumenMat) throw new Error("No se materializó");

		// 9. Ligas producto-PDA del nivel y "¿Para quién?" alumno por alumno
		const spda = (await sb.from("sesiones_pda").select("id, sesion_id, pda_id, grado").in("sesion_id", Object.values(sesionPorNumero).map((s) => s.id))).data;
		let ligasNuevas = 0, asignados = 0;
		for (const n of Object.keys(porNumero)) {
			const s = sesionPorNumero[n];
			const hechos = insertados[s.id];
			for (const p of porNumero[n].productos) {
				const prod = hechos.find((h) => h.orden === p.orden && h.nombre === p.nombre);
				p.id = prod.id;
				const ligas = (await sb.from("producto_sesion_pda").select("producto_sesion_id, sesion_pda_id").eq("producto_sesion_id", prod.id)).data || [];
				const faltanL = spda.filter((r) => r.sesion_id === s.id && p.pda.indexOf(Number(r.grado)) !== -1 && !ligas.some((l) => l.sesion_pda_id === r.id));
				if (faltanL.length) {
					const r = await sb.from("producto_sesion_pda").insert(faltanL.map((x) => ({ producto_sesion_id: prod.id, sesion_pda_id: x.id })));
					if (r.error) throw r.error;
					ligasNuevas += faltanL.length;
				}
				if (p.filas.length) {
					const r = await sb.rpc("guardar_asignacion_producto", { p_producto: prod.id, p_filas: p.filas });
					if (r.error) throw r.error;
					asignados++;
				}
			}
		}

		// 10. Comprobación (lee lo que quedó; en la simulación, lo que quedaría)
		const sesionIds = Object.values(sesionPorNumero).map((s) => s.id);
		const sesiones = (await sb.from("sesiones").select("*").in("id", sesionIds)).data;
		const prods = (await sb.from("productos_sesion").select("id, sesion_id, tipo, nombre, grados, campo, modalidad, activo, orden, origen, created_at").in("sesion_id", sesionIds)).data;
		const ligas = (await sb.from("producto_sesion_pda").select("producto_sesion_id, sesion_pda_id").in("producto_sesion_id", prods.map((p) => p.id))).data;
		const asigs = (await sb.from("producto_sesion_alumnos").select("producto_sesion_id, alumno_id, modo").in("producto_sesion_id", prods.map((p) => p.id))).data;
		const spdaFin = (await sb.from("sesiones_pda").select("id, sesion_id, pda_id, grado, criterio_aplicado").in("sesion_id", sesionIds)).data;
		const indice = AlcanceHoy.indiceAsignaciones(asigs);
		const fallas = [];
		const tareas = prods.filter((p) => p.tipo === "tarea");
		const trabajos = prods.filter((p) => p.tipo === "trabajo");
		const esperadosTrabajos = Object.values(porNumero).reduce((t, x) => t + x.productos.length, 0);
		const esperadasTareas = dos.dosificacion_sesiones.reduce((t, ds) => {
			const ct = Importador.normalizarTareas(ds.cierre_tareas);
			if (!ct) return t;
			return t + (ct.mode === "diferenciado" ? Object.keys(ct.diferenciado || {}).reduce((u, g) => u + (ct.diferenciado[g] || []).length, 0) : (ct.todos || []).length);
		}, 0);
		if (sesiones.length !== dos.dosificacion_sesiones.length) fallas.push("sesiones: " + sesiones.length);
		sesiones.forEach((s) => { if (s.fecha || s.estado_sesion !== "pendiente") fallas.push("Sesión " + s.numero_sesion + " con fecha o no pendiente"); });
		if (trabajos.length !== esperadosTrabajos) fallas.push("trabajos: " + trabajos.length + " (esperados " + esperadosTrabajos + ")");
		if (tareas.length !== esperadasTareas) fallas.push("tareas: " + tareas.length + " (esperadas " + esperadasTareas + ")");
		if (resumenMat.insertados !== tareas.length) fallas.push("el materializador insertó " + resumenMat.insertados + " productos (solo debían ser las " + tareas.length + " tareas)");
		if (spdaFin.length !== dos.dosificacion_pdas.length) fallas.push("sesiones_pda: " + spdaFin.length);
		spdaFin.forEach((r) => { if (!catalogo[r.pda_id]) fallas.push("sesiones_pda sin PDA del catálogo"); });
		Object.keys(porNumero).forEach((n) => {
			const s = sesionPorNumero[n];
			porNumero[n].productos.forEach((p) => {
				const reciben = alumnos.filter((al) => AlcanceHoy.asignadoA(al, { id: p.id, grados: p.grados }, indice)).map((al) => al.id).sort().join(",");
				if (reciben !== p.reciben.slice().sort().join(",")) fallas.push("Sesión " + n + " «" + p.nombre + "»: recibe otros alumnos");
				const grados = ligas.filter((l) => l.producto_sesion_id === p.id).map((l) => spdaFin.find((r) => r.id === l.sesion_pda_id))
					.filter((r) => r && r.sesion_id === s.id).map((r) => Number(r.grado)).sort().join(",");
				if (grados !== p.pda.slice().sort().join(",")) fallas.push("Sesión " + n + " «" + p.nombre + "»: ligado a PDA de " + grados + " (esperado " + p.pda.join(",") + ")");
			});
			const ses = sesiones.find((x) => x.id === s.id);
			const psn = plan.sesiones[n] || {};
			if (psn.duracion && ses.duracion !== String(psn.duracion)) fallas.push("Sesión " + n + ": sin el horario de la planeación en duracion");
			// Sin movimientos en el plan, los pasos de cada fase quedan tal como vienen, en su orden
			const dsn = dos.dosificacion_sesiones.find((x) => Number(x.numero_sesion) === Number(n));
			["inicio", "desarrollo", "cierre"].forEach((fase) => {
				if ((psn.texto || {})[fase]) return;
				if (estable(ses[fase + "_actividades"]) !== estable(dsn[fase + "_actividades"])) fallas.push("Sesión " + n + " (" + fase + "): los pasos no quedaron como en la planeación");
			});
			const links = (ses.recursos && ses.recursos.links) || [];
			if (links.some((l) => /anexo\.html/.test(l.url))) fallas.push("Sesión " + n + ": quedó un enlace de la tienda");
			if (plan.drive.carpetas_por_sesion[n] && !links.some((l) => /drive\.google\.com\/drive\/folders\//.test(l.url))) fallas.push("Sesión " + n + ": sin carpeta de Drive");
		});
		// Guardar sin cambios en Crear proyecto (reedición con la fila de siempre): no borra ni crea nada
		const reedicion = SM.planificar(sesiones, { spda: spdaFin, productos: prods.slice().sort((x, y) => String(x.created_at).localeCompare(String(y.created_at))) }, {
			gradosProyecto: grupo.grados, camposProyecto: dosProy.campos_formativos, anteriores: sesiones.reduce((o, s) => { o[s.id] = s; return o; }, {}),
		});
		const cambiaria = reedicion.productosInsertar.length + reedicion.productosBorrar.length + reedicion.productosActualizar.length +
			reedicion.spdaInsertar.length + reedicion.spdaBorrar.length + reedicion.spdaActualizar.length;
		if (cambiaria) fallas.push("una reedición sin cambios tocaría " + cambiaria + " filas");
		// En la base (al aplicar): la regla de SQL da los mismos alumnos
		if (aplicar) {
			const sql = await q("select ps.id, array_agg(a.id order by a.id) filter (where public.alumno_recibe_producto(a.id, ps.id)) as reciben " +
				"from public.productos_sesion ps cross join public.alumnos a where ps.sesion_id = any($1) and a.grupo_id = $2 and a.estatus = 'activo' and ps.tipo = 'trabajo' group by ps.id", [sesionIds, grupo.id]);
			sql.forEach((r) => {
				let p = null;
				Object.values(porNumero).forEach((x) => x.productos.forEach((y) => { if (y.id === r.id) p = y; }));
				if (p && (r.reciben || []).slice().sort().join(",") !== p.reciben.slice().sort().join(",")) fallas.push("alumno_recibe_producto no coincide en «" + p.nombre + "»");
			});
		}

		// 11. Lo que se escribe (o se escribió)
		console.log("\nSesión | producto | tipo | campo | PDA | para quién | alumnos");
		Object.keys(porNumero).map(Number).sort((x, y) => x - y).forEach((n) => {
			const s = sesionPorNumero[n];
			porNumero[n].productos.forEach((p) => {
				console.log(n + " | " + p.nombre + " | trabajo | " + p.campo + " | " + p.pda.map((g) => g + "°").join(", ") + " | " +
					resumenPara(p, indice[p.id], alumnos) + " | " + p.reciben.map((id) => claveDe[id]).join(", "));
			});
			tareas.filter((t) => t.sesion_id === s.id).forEach((t) => {
				const rec = alumnos.filter((al) => AlcanceHoy.asignadoA(al, t, indice)).map((al) => claveDe[al.id]);
				console.log(n + " | " + t.nombre + " | tarea | " + t.campo + " | " + t.grados.map((g) => g + "°").join(", ") + " | " + ProductosHoy.etiquetaGrados(t.grados) + " | " + rec.join(", "));
			});
		});
		const conteo = {
			proyecto: 1, sesiones: sesiones.length, sesiones_pda: spdaFin.length, trabajos: trabajos.length, tareas: tareas.length,
			ligas_producto_pda: ligas.length, ligas_por_nivel: ligasNuevas, productos_con_para_quien: asignados, filas_para_quien: asigs.length,
		};
		console.log("\nConteos: " + JSON.stringify(conteo));
		console.log("Proyecto: " + proyectoId + (aplicar ? "" : " (simulado: no existe)") + " · trimestre " + plan.proyecto.trimestre + " · " + plan.proyecto.estado);
		if (fallas.length) throw new Error("La comprobación falló:\n  - " + fallas.join("\n  - "));
		console.log("Comprobación: OK (asignación, ligas, 15 sesiones sin fecha, horario y pasos como en la planeación, recursos de Drive, reedición sin cambios = 0 filas)");

		if (aplicar) {
			await c.query("commit");
			console.log("\nCOMMIT: cargado.");
		} else {
			await c.query("rollback");
			console.log("\nSimulación: no se escribió nada.");
		}
		return 0;
	} catch (e) {
		try { await c.query("rollback"); } catch (_) { /* ya estaba cerrada */ }
		throw e;
	} finally {
		await c.end();
	}
}

module.exports = { resolverAlumnos, miembrosDe, asignacionDe, recibenCon, textoPorGrupo, recursosDeSesion, ajustarFila, sbDesdePg, normal };

if (require.main === module) {
	principal().then((codigo) => { process.exitCode = codigo || 0; }).catch((e) => {
		console.error("\nERROR (no se escribió nada): " + e.message);
		process.exitCode = 1;
	});
}
