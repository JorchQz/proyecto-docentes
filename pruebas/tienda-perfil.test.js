/*
	Perfil del comprador en la tienda (Tienda.asegurarPerfil, tienda/js/tienda-common.js).

	Antes: login.js y checkout.js hacían perfiles.upsert({id, ...}, {onConflict: "id"}).
	authenticated no tiene UPDATE sobre perfiles.id, así que el upsert fallaba SIEMPRE y el
	error se ignoraba; y como el registro pide confirmar el correo, al registrarse no hay sesión
	y el perfil nunca se creaba. Ahora un solo ayudante:
	  - lee el perfil; si no existe lo INSERTA con id y nombre_completo (de los datos o del
	    registro: user_metadata full_name / nombre_docente / nombre_completo);
	  - si existe, UPDATE solo de las columnas con datos nuevos no vacíos, nunca id;
	  - si algo falla, console.warn y sigue (nunca lanza).
	Además: el registro pide solo nombre, correo y contraseña (sin CCT ni escuela), y el login y
	el checkout usan el ayudante (ningún upsert a perfiles).

	node pruebas/tienda-perfil.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
let fallos = 0;
function ok(nombre, real, esperado) {
	const bien = JSON.stringify(real) === JSON.stringify(esperado);
	if (!bien) fallos++;
	console.log((bien ? "OK   " : "FALLA ") + nombre + " → " + JSON.stringify(real) + (bien ? "" : " (esperado " + JSON.stringify(esperado) + ")"));
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

// Supabase falso: registra cada operación sobre perfiles
function cargar(opciones) {
	const ops = [];
	const avisos = [];
	function consulta() {
		const q = {
			_op: "select", _datos: null, _filtros: [],
			select: function () { return this; },
			eq: function (c, v) { this._filtros.push(c + "=" + v); return this; },
			maybeSingle: function () { return this; },
			insert: function (d) { this._op = "insert"; this._datos = d; return this; },
			update: function (d) { this._op = "update"; this._datos = d; return this; },
			upsert: function (d) { this._op = "upsert"; this._datos = d; return this; },
			then: function (resolver) {
				ops.push({ op: this._op, datos: this._datos, filtros: this._filtros });
				if (this._op === "select") return Promise.resolve(resolver(opciones.lectura));
				const err = (opciones.errorEscritura && opciones.errorEscritura[this._op]) || null;
				return Promise.resolve(resolver({ data: null, error: err }));
			},
		};
		return q;
	}
	const ctx = {
		window: { sb: { from: function (t) { if (t !== "perfiles") throw new Error("tabla " + t); return consulta(); } }, matchMedia: () => ({ matches: false }) },
		sessionStorage: { getItem: () => null, setItem: () => {} },
		console: { log: console.log, error: console.error, warn: function () { avisos.push([].slice.call(arguments).join(" ")); } },
	};
	ctx.window.window = ctx.window;
	vm.createContext(ctx);
	vm.runInContext(leer("tienda/js/tienda-common.js"), ctx);
	return { T: ctx.window.Tienda, ops: ops, avisos: avisos };
}
const sesion = (meta) => ({ user: { id: "u1", email: "comprador@correo.com", user_metadata: meta || {} } });
const escrituras = (ops) => ops.filter((o) => o.op !== "select");

(async () => {
	// 1. Sin perfil, con el nombre del registro en la pantalla: INSERT con id y nombre
	let t = cargar({ lectura: { data: null, error: null } });
	ok("sin perfil: lo crea", await t.T.asegurarPerfil(sesion({ full_name: "Ana Ruiz" }), { nombre_completo: "  Ana Ruiz " }), "creado");
	ok("sin perfil: un INSERT con id y nombre (sin upsert)", escrituras(t.ops), [{ op: "insert", datos: { id: "u1", nombre_completo: "Ana Ruiz" }, filtros: [] }]);

	// 2. Al iniciar sesión (sin datos): el nombre sale del registro
	t = cargar({ lectura: { data: null, error: null } });
	await t.T.asegurarPerfil(sesion({ full_name: "Bety Luna", nombre_docente: "Otra" }));
	ok("login sin perfil: nombre de full_name", escrituras(t.ops)[0].datos, { id: "u1", nombre_completo: "Bety Luna" });
	t = cargar({ lectura: { data: null, error: null } });
	await t.T.asegurarPerfil(sesion({ nombre_docente: "Caro Díaz" }));
	ok("login sin perfil: nombre de nombre_docente", escrituras(t.ops)[0].datos.nombre_completo, "Caro Díaz");
	t = cargar({ lectura: { data: null, error: null } });
	await t.T.asegurarPerfil(sesion({ nombre_completo: "Dani Soto" }));
	ok("login sin perfil: nombre de nombre_completo", escrituras(t.ops)[0].datos.nombre_completo, "Dani Soto");
	t = cargar({ lectura: { data: null, error: null } });
	await t.T.asegurarPerfil(sesion({}));
	ok("login sin perfil ni nombre: se crea solo con id", escrituras(t.ops)[0].datos, { id: "u1" });

	// 3. Con perfil y nombre, sin datos nuevos: no escribe nada
	t = cargar({ lectura: { data: { id: "u1", nombre_completo: "Ana Ruiz", escuela: null, cct: null }, error: null } });
	ok("con perfil: sin cambios", await t.T.asegurarPerfil(sesion({ full_name: "Ana Ruiz" })), "sin_cambios");
	ok("con perfil: ninguna escritura", escrituras(t.ops).length, 0);
	// Datos vacíos no pisan lo guardado
	t = cargar({ lectura: { data: { id: "u1", nombre_completo: "Ana Ruiz", escuela: "Rural", cct: null }, error: null } });
	await t.T.asegurarPerfil(sesion({}), { nombre_completo: "  ", escuela: "" });
	ok("datos vacíos: ninguna escritura", escrituras(t.ops).length, 0);

	// 4. Perfil sin nombre: UPDATE solo del nombre, sin id
	t = cargar({ lectura: { data: { id: "u1", nombre_completo: null, escuela: null, cct: null }, error: null } });
	ok("perfil sin nombre: se actualiza", await t.T.asegurarPerfil(sesion({ full_name: "Eva Paz" })), "actualizado");
	ok("perfil sin nombre: UPDATE {nombre_completo} por id", escrituras(t.ops), [{ op: "update", datos: { nombre_completo: "Eva Paz" }, filtros: ["id=u1"] }]);

	// 5. Datos nuevos no vacíos: UPDATE solo de esas columnas
	t = cargar({ lectura: { data: { id: "u1", nombre_completo: "Ana Ruiz", escuela: null, cct: null }, error: null } });
	await t.T.asegurarPerfil(sesion({}), { nombre_completo: "Ana Ruiz", cct: "21DPR1234X" });
	ok("dato nuevo: UPDATE solo del cct", escrituras(t.ops), [{ op: "update", datos: { cct: "21DPR1234X" }, filtros: ["id=u1"] }]);

	// 6. Fallas: nunca lanza, avisa en consola y no bloquea
	t = cargar({ lectura: { data: null, error: null }, errorEscritura: { insert: { message: "permiso denegado" } } });
	ok("INSERT fallido: devuelve error sin lanzar", await t.T.asegurarPerfil(sesion({ full_name: "Ana" })), "error");
	ok("INSERT fallido: console.warn", t.avisos.length === 1 && /permiso denegado/.test(t.avisos[0]), true);
	t = cargar({ lectura: { data: null, error: { message: "sin red" } } });
	ok("lectura fallida: error", await t.T.asegurarPerfil(sesion({ full_name: "Ana" })), "error");
	ok("lectura fallida: no escribe nada", escrituras(t.ops).length, 0);
	t = cargar({ lectura: { data: null, error: null } });
	ok("sin sesión: no hace nada", [await t.T.asegurarPerfil(null), t.ops.length], ["sin_cambios", 0]);

	// 7. Cableado: ningún upsert a perfiles; el registro solo pide nombre, correo y contraseña
	const login = leer("tienda/js/login.js");
	const checkout = leer("tienda/js/checkout.js");
	const loginHtml = leer("tienda/login.html");
	ok("login.js: sin upsert", /\.upsert\(/.test(login), false);
	ok("checkout.js: sin upsert a perfiles", /from\("perfiles"\)\s*\.upsert|perfiles"\)\.upsert/.test(checkout), false);
	ok("login.js: asegurarPerfil al registrarse (con el nombre) y al iniciar sesión",
		[/asegurarPerfil\(res\.data\.session, \{ nombre_completo: nombre \}\)/.test(login), /asegurarPerfil\(res\.data\.session\);/.test(login)], [true, true]);
	ok("checkout.js: asegurarPerfil al crear la cuenta", /asegurarPerfil\(alta\.data\.session, \{ nombre_completo: nombre \}\)/.test(checkout), true);
	const inputs = (loginHtml.match(/<input[^>]*id="([^"]+)"/g) || []).map((m) => m.match(/id="([^"]+)"/)[1]);
	ok("registro: solo nombre, correo y contraseña", inputs, ["nombre", "email", "password"]);
	ok("login.js: ya no lee CCT ni escuela", /getElementById\("(cct|escuela)/.test(login), false);

	console.log(fallos === 0 ? "\nTODAS PASAN" : "\n" + fallos + " FALLAS");
	process.exit(fallos ? 1 : 0);
})();
