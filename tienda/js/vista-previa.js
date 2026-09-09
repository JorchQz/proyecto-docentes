// Vistas previas por imagen de los proyectos individuales.
//
// La muestra en PDF (`previsualizar`) pesa ~4 MB por proyecto y tarda varios
// segundos en aparecer; una imagen JPG por página pesa ~200 KB y se pinta al
// instante. Este módulo convierte esa muestra en imágenes con pdf.js (se carga
// de cdnjs solo cuando hace falta) y las sube al bucket público `assets`, bajo
// `previews/proyecto-<id>/`, la misma convención que las carpetas de los
// paquetes (`previews/grado-N`). La primera imagen queda en
// marketplace_productos.portada_url para que el catálogo la use sin listar.
//
// Lo usa el admin (botón "Generar vistas previas") y el guion de carga masiva.
(function () {
	var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
	var WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
	var cargando = null;

	function cargarPdfJs() {
		if (window.pdfjsLib) { return Promise.resolve(window.pdfjsLib); }
		if (cargando) { return cargando; }
		cargando = new Promise(function (resolve, reject) {
			var s = document.createElement("script");
			s.src = PDFJS;
			s.onload = function () {
				window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
				resolve(window.pdfjsLib);
			};
			s.onerror = function () { cargando = null; reject(new Error("No se pudo cargar pdf.js")); };
			document.head.appendChild(s);
		});
		return cargando;
	}

	// Pinta una página del documento pdf.js en JPG.
	async function paginaAJpg(doc, numero, opts) {
		var ancho = opts.ancho || 1100;
		var calidad = opts.calidad || 0.82;
		var pagina = await doc.getPage(numero);
		var base = pagina.getViewport({ scale: 1 });
		var vista = pagina.getViewport({ scale: ancho / base.width });
		var canvas = document.createElement("canvas");
		canvas.width = Math.round(vista.width);
		canvas.height = Math.round(vista.height);
		var ctx = canvas.getContext("2d");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
		return new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", calidad); });
	}

	// Texto de una página agrupado por renglón, de arriba hacia abajo.
	async function renglonesDe(doc, numero) {
		var pagina = await doc.getPage(numero);
		var contenido = await pagina.getTextContent();
		var filas = {};
		contenido.items.forEach(function (it) {
			if (!it.str || !it.str.trim()) { return; }
			var y = Math.round(it.transform[5]);
			filas[y] = (filas[y] || "") + it.str;
		});
		return Object.keys(filas)
			.map(Number)
			.sort(function (a, b) { return b - a; })
			.map(function (y) { return filas[y]; });
	}

	// Página donde empieza la Sesión 1. En la planeación del bot cada sesión
	// abre con la tabla "SESIÓN · CAMPO FORMATIVO · MOMENTO" y, en el renglón
	// siguiente, el número de sesión pegado al campo ("1Saberes y…"). Se
	// buscan esos dos renglones entre los primeros de cada página; "10…" no
	// cuenta porque tras el 1 viene otro dígito. Si no se encuentra, null.
	// Cuando el momento ocupa dos líneas, el "1" puede quedar en un renglón
	// aparte o más abajo: se admite en cualquiera de los 4 renglones que
	// siguen a la cabecera. "1°" tampoco cuenta (es un grado).
	var RE_CABECERA = /SESI[OÓ]N\s*CAMPO\s*FORMATIVO/i;
	var RE_UNO = /^\s*1(?![0-9°.,:)])/;
	async function paginaSesion1(doc, opts) {
		var hasta = Math.min(doc.numPages, opts.buscarHasta || 20);
		for (var n = 2; n <= hasta; n++) {
			var renglones = await renglonesDe(doc, n);
			for (var i = 0; i < Math.min(renglones.length, 8); i++) {
				if (!RE_CABECERA.test(renglones[i])) { continue; }
				for (var j = i + 1; j <= i + 4 && j < renglones.length; j++) {
					if (RE_UNO.test(renglones[j])) { return n; }
				}
				break;
			}
		}
		return null;
	}

	// Convierte un PDF (ArrayBuffer) en JPG: páginas 1 y 2 de la planeación y
	// la página donde empieza la Sesión 1 (si no se localiza, la 3). Devuelve
	// [{ blob, nombre }] con los nombres que la ficha etiqueta.
	async function paginasAJpg(buffer, opts) {
		opts = opts || {};
		var pdfjs = await cargarPdfJs();
		var doc = await pdfjs.getDocument({ data: buffer }).promise;
		var sesion = doc.numPages >= 3 ? await paginaSesion1(doc, opts) : null;
		var plan = [
			{ n: 1, nombre: "01-planeacion-pagina-1.jpg" },
			{ n: 2, nombre: "02-planeacion-pagina-2.jpg" },
		];
		if (sesion && sesion > 2) {
			plan.push({ n: sesion, nombre: "03-planeacion-sesion-1.jpg" });
		} else if (doc.numPages >= 3) {
			plan.push({ n: 3, nombre: "03-planeacion-pagina-3.jpg" });
		}
		var salida = [];
		for (var i = 0; i < plan.length; i++) {
			if (plan[i].n > doc.numPages) { continue; }
			salida.push({ nombre: plan[i].nombre, blob: await paginaAJpg(doc, plan[i].n, opts), pagina: plan[i].n });
		}
		doc.destroy();
		return salida;
	}

	function carpetaDe(productoId) { return "previews/proyecto-" + productoId; }

	// Genera y sube las imágenes de un proyecto individual con el cliente `sb`
	// dado (la sesión del admin o, en carga masiva, la clave de servicio).
	// `opts.headers` va a previsualizar con el JWT del admin (o el secreto de
	// mantenimiento): así sirve también un producto aún oculto y entrega el PDF
	// completo (`completo=1`), necesario para localizar la Sesión 1. Sin
	// autorización llega solo la muestra de 3 páginas y se usan esas.
	// Devuelve { paginas, portada_url, sesion_en }.
	async function generarProyecto(sb, edgeBase, productoId, opts) {
		opts = opts || {};
		var resp = await fetch(edgeBase + "/previsualizar?producto_id=" + encodeURIComponent(productoId) + "&completo=1", { headers: opts.headers || {} });
		var tipo = resp.headers.get("content-type") || "";
		if (!resp.ok || tipo.indexOf("application/pdf") === -1) { throw new Error("Sin muestra en Drive"); }
		var imagenes = await paginasAJpg(await resp.arrayBuffer(), opts);
		if (!imagenes.length) { throw new Error("El PDF no tiene páginas"); }
		var carpeta = carpetaDe(productoId);
		var version = Date.now();

		// Limpia lo que hubiera (nombres viejos) para que la ficha no mezcle.
		var previos = await sb.storage.from("assets").list(carpeta, { limit: 50 });
		if (!previos.error && previos.data && previos.data.length) {
			var rutas = previos.data.filter(function (f) { return f.name; }).map(function (f) { return carpeta + "/" + f.name; });
			if (rutas.length) { await sb.storage.from("assets").remove(rutas); }
		}

		var portada = null;
		for (var i = 0; i < imagenes.length; i++) {
			var up = await sb.storage.from("assets").upload(carpeta + "/" + imagenes[i].nombre, imagenes[i].blob, {
				upsert: true, contentType: "image/jpeg", cacheControl: "31536000",
			});
			if (up.error) { throw new Error(up.error.message); }
			if (!portada) {
				// `v` evita que el CDN sirva la imagen vieja si se regenera.
				portada = sb.storage.from("assets").getPublicUrl(carpeta + "/" + imagenes[i].nombre).data.publicUrl + "?v=" + version;
			}
		}
		var upd = await sb.from("marketplace_productos").update({ portada_url: portada }).eq("id", productoId);
		if (upd.error) { throw new Error(upd.error.message); }
		var conSesion = imagenes.filter(function (im) { return /sesion/.test(im.nombre); })[0];
		return { paginas: imagenes.length, portada_url: portada, sesion_en: conSesion ? conSesion.pagina : null };
	}

	window.VistaPrevia = { paginasAJpg: paginasAJpg, generarProyecto: generarProyecto, carpetaDe: carpetaDe, paginaSesion1: paginaSesion1 };
})();
