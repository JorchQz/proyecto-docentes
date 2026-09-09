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

	// Convierte un PDF (ArrayBuffer) en JPG, uno por página, hasta `maxPaginas`.
	async function paginasAJpg(buffer, opts) {
		opts = opts || {};
		var ancho = opts.ancho || 1100;
		var calidad = opts.calidad || 0.82;
		var max = opts.maxPaginas || 3;
		var pdfjs = await cargarPdfJs();
		var doc = await pdfjs.getDocument({ data: buffer }).promise;
		var n = Math.min(doc.numPages, max);
		var salida = [];
		for (var i = 1; i <= n; i++) {
			var pagina = await doc.getPage(i);
			var base = pagina.getViewport({ scale: 1 });
			var vista = pagina.getViewport({ scale: ancho / base.width });
			var canvas = document.createElement("canvas");
			canvas.width = Math.round(vista.width);
			canvas.height = Math.round(vista.height);
			var ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
			salida.push(await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", calidad); }));
		}
		doc.destroy();
		return salida;
	}

	function carpetaDe(productoId) { return "previews/proyecto-" + productoId; }

	// Genera y sube las imágenes de un proyecto individual con el cliente `sb`
	// dado (la sesión del admin o, en carga masiva, la clave de servicio).
	// Devuelve { paginas, portada_url }.
	async function generarProyecto(sb, edgeBase, productoId, opts) {
		var resp = await fetch(edgeBase + "/previsualizar?producto_id=" + encodeURIComponent(productoId));
		var tipo = resp.headers.get("content-type") || "";
		if (!resp.ok || tipo.indexOf("application/pdf") === -1) { throw new Error("Sin muestra en Drive"); }
		var blobs = await paginasAJpg(await resp.arrayBuffer(), opts);
		if (!blobs.length) { throw new Error("El PDF no tiene páginas"); }
		var carpeta = carpetaDe(productoId);
		var version = Date.now();
		var portada = null;
		for (var i = 0; i < blobs.length; i++) {
			var nombre = (i + 1 < 10 ? "0" : "") + (i + 1) + "-planeacion-pagina-" + (i + 1) + ".jpg";
			var up = await sb.storage.from("assets").upload(carpeta + "/" + nombre, blobs[i], {
				upsert: true, contentType: "image/jpeg", cacheControl: "31536000",
			});
			if (up.error) { throw new Error(up.error.message); }
			if (!portada) {
				// `v` evita que el CDN sirva la imagen vieja si se regenera.
				portada = sb.storage.from("assets").getPublicUrl(carpeta + "/" + nombre).data.publicUrl + "?v=" + version;
			}
		}
		var upd = await sb.from("marketplace_productos").update({ portada_url: portada }).eq("id", productoId);
		if (upd.error) { throw new Error(upd.error.message); }
		return { paginas: blobs.length, portada_url: portada };
	}

	window.VistaPrevia = { paginasAJpg: paginasAJpg, generarProyecto: generarProyecto, carpetaDe: carpetaDe };
})();
