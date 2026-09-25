/*
	Service worker de la app instalable "Jissez MS" (Mi Salón). Fase 1 de docs/PWA-MI-SALON.md.

	- Se registra como /salon/sw.js con alcance /salon/ (js/app-instalada.js, solo desde páginas
	  bajo /salon/). Por construcción no ve la tienda, el pago ni las páginas de la raíz.
	- Navegaciones (abrir una página): RED PRIMERO. Con red, siempre llega lo recién desplegado;
	  si la red falla, o no contesta en LIMITE_NAVEGACION (señal muy débil: la página se quedaría
	  en blanco), se muestra la página "Sin conexión" guardada, que tiene "Reintentar". Las
	  páginas en sí no se guardan todavía: sin red no podrían comprobar la sesión ni cargar sus
	  librerías (eso es la fase 2, que primero fija las versiones de los CDN).
	- Solo se guarda lo que usa la página "Sin conexión" (ella misma y su ícono), en un caché
	  con VERSION: al activarse una versión nueva se borran los cachés de las anteriores.
	- Todo lo demás (Supabase, CDN, scripts, imágenes) pasa directo a la red: este archivo no
	  lo toca ni lo guarda.

	Al cambiar este archivo o la página "Sin conexión", subir VERSION.
	Emergencia: publicar un sw.js que en "activate" borre sus cachés y llame
	self.registration.unregister() (docs/PWA-MI-SALON.md §4.4).
*/
var VERSION = "salon-2026-09-25-3";
var CACHE = "jissez-ms-" + VERSION;
var SIN_CONEXION = "/salon/sin-conexion";
var GUARDADOS = [SIN_CONEXION, "/iconos/mi-salon-192.png"];
var LIMITE_NAVEGACION = 9000; // ms

// La promesa, o un error si tarda más de ms
function conLimite(promesa, ms) {
	return new Promise(function (ok, mal) {
		var t = setTimeout(function () { mal(new Error("sw: la red no contestó a tiempo")); }, ms);
		promesa.then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); mal(e); });
	});
}

self.addEventListener("install", function (event) {
	event.waitUntil(
		caches.open(CACHE).then(function (cache) {
			return Promise.all(GUARDADOS.map(function (url) {
				// cache: "reload" → directo del servidor, no de la caché HTTP
				return fetch(new Request(url, { cache: "reload" })).then(function (res) {
					// Una respuesta que viene de una redirección no sirve para contestar una navegación
					if (!res.ok || res.redirected) throw new Error("sw: no se pudo guardar " + url + " (" + res.status + ")");
					return cache.put(url, res);
				});
			}));
		}).then(function () { return self.skipWaiting(); })
	);
});

self.addEventListener("activate", function (event) {
	event.waitUntil(
		caches.keys().then(function (claves) {
			return Promise.all(claves.map(function (c) {
				if (c.indexOf("jissez-ms-") === 0 && c !== CACHE) return caches.delete(c);
				return null;
			}));
		}).then(function () {
			// Sin esperar al tiempo de arranque del service worker en cada navegación
			if (self.registration.navigationPreload) return self.registration.navigationPreload.enable();
			return null;
		}).then(function () { return self.clients.claim(); })
	);
});

self.addEventListener("fetch", function (event) {
	var req = event.request;
	if (req.method !== "GET") return;
	var url = new URL(req.url);
	if (url.origin !== self.location.origin) return; // Supabase, CDN, fuentes: directo a la red

	if (req.mode === "navigate") {
		var precarga = Promise.resolve(event.preloadResponse);
		// Si se contesta con "Sin conexión" antes de que llegue la precarga, se espera a que
		// termine (así el navegador no la cancela con un aviso en la consola)
		event.waitUntil(precarga.catch(function () {}));
		event.respondWith(
			conLimite(precarga.then(function (pre) {
				return pre || fetch(req);
			}), LIMITE_NAVEGACION).catch(function () {
				return caches.open(CACHE).then(function (cache) { return cache.match(SIN_CONEXION); })
					.then(function (guardada) {
						return guardada || new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
					});
			})
		);
		return;
	}

	// Lo que usa la página "Sin conexión": red primero y, si falla, lo guardado
	if (GUARDADOS.indexOf(url.pathname) !== -1) {
		event.respondWith(
			fetch(req).catch(function () {
				return caches.open(CACHE).then(function (cache) { return cache.match(url.pathname); })
					.then(function (r) { return r || Response.error(); });
			})
		);
	}
	// Todo lo demás: sin respondWith, el navegador lo pide a la red como siempre
});
