document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("mis-compras");
	if (!session) {
		session = await Tienda.requireSession();
		if (!session) { return; }
	}
	Tienda.montarFooter();

	var esc = Tienda.esc;
	var token = Tienda.getAccessToken(session);

	var estadoEl = document.getElementById("estado");
	var listaEl = document.getElementById("lista");
	var bibGrid = document.getElementById("bibGrid");
	var tituloEl = document.getElementById("titulo");
	var subtituloEl = document.getElementById("subtitulo");
	var bibAvatar = document.getElementById("bibAvatar");
	var bibBadges = document.getElementById("bibBadges");
	var resumenPaquete = document.getElementById("resumenPaquete");

	var GRADO_COLOR = {
		"1": { bg: "#f2cf6b", txt: "rgba(30,58,138,.85)" },
		"2": { bg: "#ef9277", txt: "#fff" },
		"3": { bg: "#79c8a6", txt: "rgba(30,58,138,.85)" },
		"4": { bg: "#a99fe0", txt: "#fff" },
		"5": { bg: "#85b8e6", txt: "rgba(30,58,138,.85)" },
		"6": { bg: "#f0b285", txt: "rgba(30,58,138,.85)" },
	};

	var accesoId = new URLSearchParams(location.search).get("acceso_id");
	if (!accesoId) { estadoEl.textContent = "Paquete no especificado."; return; }

	// Datos del paquete (valida que el acceso es del usuario por RLS).
	var accRes = await window.sb
		.from("marketplace_accesos")
		.select("tipo, marketplace_productos(titulo, grado, tipo_paquete, trimestre)")
		.eq("id", accesoId)
		.eq("user_id", session.user.id)
		.maybeSingle();

	if (accRes.error || !accRes.data) {
		estadoEl.textContent = "No tienes acceso a este paquete.";
		return;
	}
	var esEditable = accRes.data.tipo === "editable";
	var prod = accRes.data.marketplace_productos || {};
	tituloEl.textContent = prod.titulo || "Biblioteca";
	subtituloEl.textContent = esEditable
		? "Versión editable · abre, imprime o descarga (PDF y Word)."
		: "Versión PDF · abre, imprime o descarga.";

	// Avatar de grado + badges del encabezado.
	if (prod.grado && bibAvatar) {
		var gc = GRADO_COLOR[String(prod.grado)] || { bg: "#e7e6df", txt: "#1c2434" };
		bibAvatar.textContent = prod.grado + "°";
		bibAvatar.style.background = gc.bg;
		bibAvatar.style.color = gc.txt;
		bibAvatar.classList.remove("bg-board/8", "text-board");
	}
	if (bibBadges) {
		var esCiclo = prod.tipo_paquete === "ciclo";
		var contenido = esCiclo ? "Ciclo completo" : (prod.trimestre ? "Trimestre " + prod.trimestre : "Trimestre");
		bibBadges.innerHTML =
			'<span class="inline-flex items-center gap-1"><i data-lucide="badge-check" class="w-3.5 h-3.5 text-action"></i> Alineado a la NEM</span>' +
			'<span class="inline-flex items-center gap-1"><i data-lucide="book-open" class="w-3.5 h-3.5"></i> ' + esc(contenido) + '</span>' +
			'<span class="inline-flex items-center gap-1"><i data-lucide="' + (esEditable ? "file-pen-line" : "file-text") + '" class="w-3.5 h-3.5"></i> ' + (esEditable ? "PDF + Word" : "PDF") + '</span>' +
			'<span class="inline-flex items-center gap-1"><i data-lucide="infinity" class="w-3.5 h-3.5"></i> Sin caducidad</span>';
	}

	// Lista de proyectos del paquete.
	var proyectos = await llamarJson("/contenido-paquete?acceso_id=" + encodeURIComponent(accesoId));
	if (!proyectos) { return; }
	var lista = proyectos.proyectos || [];
	if (!lista.length) {
		estadoEl.innerHTML = '<p class="text-gray-500">Este paquete aún no tiene archivos. Vuelve pronto.</p>';
		return;
	}

	estadoEl.classList.add("hidden");
	bibGrid.classList.remove("hidden");
	pintarLista(lista);
	if (resumenPaquete) {
		resumenPaquete.innerHTML =
			'<div class="flex items-center justify-between"><span class="flex items-center gap-2"><i data-lucide="layers" class="w-4 h-4"></i> Proyectos</span><span class="font-bold text-ink">' + lista.length + '</span></div>' +
			'<div class="flex items-center justify-between"><span class="flex items-center gap-2"><i data-lucide="' + (esEditable ? "file-pen-line" : "file-text") + '" class="w-4 h-4"></i> Formato</span><span class="font-bold text-ink">' + (esEditable ? "PDF + Word" : "PDF") + '</span></div>';
	}
	Tienda.iconos();

	// Un paquete de ciclo son quince carpetas seguidas. Sin separar por trimestre
	// la lista es impracticable en un celular, y los tres exámenes se llamaban
	// igual. Un paquete de un solo trimestre se deja tal cual: no hay nada que
	// agrupar.
	function pintarLista(lista) {
		var trimestres = [];
		var idx = {};
		lista.forEach(function (p) {
			var t = p.trimestre != null ? p.trimestre : 0;
			if (!(t in idx)) { idx[t] = trimestres.length; trimestres.push({ t: t, items: [] }); }
			trimestres[idx[t]].items.push(p);
		});

		var agrupar = trimestres.length > 1;
		trimestres.forEach(function (g) {
			if (agrupar) {
				var titulo = document.createElement("p");
				titulo.className = "text-[11px] font-bold uppercase tracking-[0.12em] text-mute mt-6 first:mt-0 mb-2";
				titulo.textContent = g.t ? "Trimestre " + g.t : "Otros materiales";
				listaEl.appendChild(titulo);
			}
			g.items.forEach(function (p) { listaEl.appendChild(cardProyecto(p)); });
		});
	}

	function cardProyecto(p) {
		var card = document.createElement("div");
		card.className = "bg-white rounded-3xl border border-line overflow-hidden";
		// El código (P01, P02...) va delante: es como el autor numera los
		// proyectos y permite localizarlos de un vistazo en pantalla pequeña.
		var etiqueta = p.codigo ? p.codigo + " · " + p.nombre : p.nombre;
		card.innerHTML =
			'<button class="cab w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-paper transition">' +
			'<span class="flex items-center gap-3 min-w-0">' +
			'<span class="w-9 h-9 rounded-xl bg-gisMenta/20 text-action-dark flex items-center justify-center shrink-0"><i data-lucide="' + (p.es_examen ? "clipboard-check" : "folder") + '" class="w-5 h-5"></i></span>' +
			'<span class="font-bold text-ink truncate">' + esc(etiqueta) + "</span>" +
			"</span>" +
			'<i data-lucide="chevron-down" class="chevron transition-transform -rotate-90 w-5 h-5 text-mute shrink-0"></i>' +
			"</button>" +
			'<div class="cuerpo hidden px-5 py-4 border-t border-line"><p class="text-sm text-mute">Cargando...</p></div>';

		var cab = card.querySelector(".cab");
		var cuerpo = card.querySelector(".cuerpo");
		var chevron = card.querySelector(".chevron");
		var cargado = false;

		cab.addEventListener("click", async function () {
			var abierto = !cuerpo.classList.contains("hidden");
			cuerpo.classList.toggle("hidden", abierto);
			chevron.classList.toggle("-rotate-90", abierto);
			if (!abierto && !cargado) {
				cargado = true;
				await cargarArchivos(cuerpo, p.index);
			}
		});
		return card;
	}

	async function cargarArchivos(cuerpo, index) {
		var data = await llamarJson("/archivos-proyecto?acceso_id=" + encodeURIComponent(accesoId) + "&proyecto=" + index);
		if (!data) { cuerpo.innerHTML = '<p class="text-sm text-red-500">No se pudo cargar.</p>'; return; }
		var archivos = data.archivos || [];
		if (!archivos.length) {
			cuerpo.innerHTML = '<p class="text-sm text-gray-400">Aún no hay archivos en este proyecto.</p>';
			return;
		}

		// Agrupar por "grupo" preservando orden de aparición.
		var grupos = [];
		var idx = {};
		archivos.forEach(function (a) {
			if (!(a.grupo in idx)) { idx[a.grupo] = grupos.length; grupos.push({ grupo: a.grupo, items: [] }); }
			grupos[idx[a.grupo]].items.push(a);
		});

		cuerpo.innerHTML = grupos.map(function (g) {
			var filas = g.items.map(function (a) { return filaArchivo(a, index); }).join("");
			return (
				'<div class="mb-3 last:mb-0">' +
				'<p class="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5" style="color:#5b6473">' + esc(g.grupo) + "</p>" +
				'<div class="flex flex-col gap-1.5">' + filas + "</div></div>"
			);
		}).join("");

		Tienda.iconos();
		cuerpo.querySelectorAll("[data-accion]").forEach(function (b) {
			b.addEventListener("click", function () { onAccion(b); });
		});
	}

	function filaArchivo(a, index) {
		var btns = "";
		if (a.ver) {
			btns += boton("ver", index, a, '<i data-lucide="eye" style="width:.875rem;height:.875rem"></i> Ver', "background:#1e3a8a;color:#fff");
		}
		if (a.ext === "docx") {
			btns += boton("descargar", index, a, '<i data-lucide="pencil" style="width:.875rem;height:.875rem"></i> Editar', "background:#059669;color:#fff");
		} else {
			btns += boton("descargar", index, a, '<i data-lucide="download" style="width:.875rem;height:.875rem"></i> Descargar', "background:#475569;color:#fff");
		}
		var iconoName = a.ext === "pdf" ? "file-text" : (a.ext === "docx" ? "file-pen-line" : "paperclip");
		var fmtBadge = a.ext === "pdf"
			? '<span class="text-[10px] font-bold px-2 h-5 rounded-full inline-flex items-center shrink-0" style="background:#e8f5e9;color:#1b5e20;border:1px solid #c8e6c9">PDF</span>'
			: (a.ext === "docx"
				? '<span class="text-[10px] font-bold px-2 h-5 rounded-full inline-flex items-center shrink-0" style="background:#e3f2fd;color:#0d47a1;border:1px solid #bbdefb">Word</span>'
				: "");
		// En móvil el nombre va en su propia línea y los botones debajo: en una
		// sola fila el `truncate` cortaba el archivo por la mitad
		// ("Planeacion_1G-2G-3...") justo cuando más falta hace distinguirlo.
		return (
			'<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-xl px-3 py-2.5 bg-paper">' +
			'<span class="text-sm min-w-0 flex items-start sm:items-center gap-2 text-ink break-words sm:truncate">' +
			'<i data-lucide="' + iconoName + '" class="w-4 h-4 shrink-0 text-mute mt-0.5 sm:mt-0"></i>' +
			'<span class="min-w-0 sm:truncate">' + esc(a.nombre) + "</span>" +
			"</span>" +
			'<div class="flex items-center justify-end gap-2 shrink-0">' + fmtBadge + btns + "</div></div>"
		);
	}

	function boton(accion, index, a, label, style) {
		return (
			'<button data-accion="' + accion + '" data-proyecto="' + index +
			'" data-path="' + esc(a.path) + '" data-nombre="' + esc(a.nombre) +
			'" class="text-xs font-semibold px-3 rounded-lg inline-flex items-center gap-1.5" style="' + style + ';min-height:38px">' + label + "</button>"
		);
	}

	async function onAccion(b) {
		var accion = b.getAttribute("data-accion");
		var proyecto = b.getAttribute("data-proyecto");
		var path = b.getAttribute("data-path");
		var nombre = b.getAttribute("data-nombre");
		var original = b.innerHTML;
		b.disabled = true;
		b.innerHTML = accion === "ver" ? "Abriendo…" : "…";

		// Para "ver" abrimos la pestaña YA (gesto del usuario) y la llenamos tras el fetch,
		// así el visor del navegador es de página completa: los hipervínculos del PDF funcionan.
		var ventana = accion === "ver" ? window.open("", "_blank") : null;

		try {
			var blob = await fetchArchivo(proyecto, path, accion === "ver" ? "inline" : "download");
			var url = URL.createObjectURL(blob);
			if (accion === "ver") {
				if (ventana) { ventana.location.href = url; }
				else { window.location.href = url; } // si el navegador bloqueó la pestaña
				setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
			} else {
				var a = document.createElement("a");
				a.href = url; a.download = nombre || "archivo";
				document.body.appendChild(a); a.click(); a.remove();
				setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
			}
		} catch (err) {
			if (ventana) { try { ventana.close(); } catch (_) {} }
			Tienda.toast(err.message || "No se pudo abrir el archivo.", "error");
		} finally {
			b.disabled = false;
			b.innerHTML = original;
		}
	}

	async function fetchArchivo(proyecto, path, modo) {
		var qs = "acceso_id=" + encodeURIComponent(accesoId) +
			"&proyecto=" + encodeURIComponent(proyecto) +
			"&path=" + encodeURIComponent(path) +
			"&modo=" + modo;
		var resp = await fetch(Tienda.EDGE_BASE + "/ver-archivo?" + qs, {
			headers: { Authorization: "Bearer " + token },
		});
		if (!resp.ok) {
			var msg = "No se pudo abrir el archivo.";
			try { var j = await resp.json(); if (j.error) { msg = j.error; } } catch (_) {}
			throw new Error(msg);
		}
		return await resp.blob();
	}

	async function llamarJson(ruta) {
		try {
			var resp = await fetch(Tienda.EDGE_BASE + ruta, { headers: { Authorization: "Bearer " + token } });
			var data = await resp.json();
			if (!resp.ok) { throw new Error(data.error || "Error al cargar."); }
			return data;
		} catch (err) {
			estadoEl.classList.remove("hidden");
			listaEl.classList.add("hidden");
			estadoEl.innerHTML = '<p style="color:#dc2626">' + esc(err.message || "Error al cargar.") + "</p>";
			return null;
		}
	}
});
