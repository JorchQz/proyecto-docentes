// Aplica en PRODUCCIÓN archivos SQL del repo, ya revisados en el proyecto de pruebas, en UNA
// transacción: si uno falla no queda nada a medias. Solo con el OK de Jorge
// (docs/PRODUCCION-MI-SALON.md, paso 1). Copia versionada de .qa/aplicar-migraciones-prod.js
// (.qa/ no está en git).
//
// Uso (desde la raíz del repo):
//   node scripts/aplicar-migraciones-prod.js supabase/a.sql supabase/b.sql ...
// La cadena de conexión sale de PROD_DB_URL (variable de entorno) o, si no está, de la línea
// PROD_DB_URL=... de .env.local (nunca se imprime). Necesita el paquete "pg": el de
// .qa/node_modules si existe; si no, `npm install pg` en una carpeta aparte y NODE_PATH.
//
// lock_timeout de 5 s: si una tabla está ocupada (por ejemplo, una venta de la tienda en curso),
// la migración falla y se revierte en vez de hacer fila y trabar la tienda (R27b). Se vuelve a
// intentar en otro momento de poco uso.
const fs = require("fs");
const path = require("path");

function cargarPg() {
	try { return require("pg"); } catch (_) {}
	return require(path.join(__dirname, "..", ".qa", "node_modules", "pg"));
}

function urlProduccion() {
	if (process.env.PROD_DB_URL) return process.env.PROD_DB_URL;
	const archivo = path.join(__dirname, "..", ".env.local");
	if (!fs.existsSync(archivo)) return null;
	const linea = fs.readFileSync(archivo, "utf8").split(/\r?\n/).find((l) => l.startsWith("PROD_DB_URL="));
	return linea ? linea.slice("PROD_DB_URL=".length) : null;
}

(async () => {
	const archivos = process.argv.slice(2);
	if (!archivos.length) throw new Error("Faltan archivos");
	const url = urlProduccion();
	if (!url) throw new Error("Falta PROD_DB_URL (variable de entorno o .env.local)");
	const { Client } = cargarPg();
	const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
	await c.connect();
	c.on("notice", (n) => console.log("  aviso:", n.message));
	await c.query("begin");
	try {
		await c.query("set local lock_timeout = '5s'");
		for (const a of archivos) {
			await c.query(fs.readFileSync(path.resolve(a), "utf8"));
			console.log("aplicado:", a);
		}
		await c.query("commit");
		console.log("COMMIT");
	} catch (e) {
		await c.query("rollback");
		console.error("ROLLBACK:", e.message);
		process.exitCode = 1;
	}
	await c.end();
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
