document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var session = await Tienda.montarNav("mis-compras");
	if (!session) {
		session = await Tienda.requireSession();
		if (!session) { return; }
	}

	var esc = Tienda.esc;
	var token = Tienda.getAccessToken(session);

	var estadoEl = document.getElementById("estado");
	var listaEl = document.getElementById("lista");
	var tituloEl = document.getElementById("titulo");
	var subtituloEl = document.getElementById("subtitulo");

	var accesoId = new URLSearchParams(location.search).get("acceso_id");
	if (!accesoId) { estadoEl.textContent = "Paquete no especificado."; return; }

	// Datos del paquete (valida que el acceso es del usuario por RLS).
	var accRes = await window.sb
		.from("marketplace_accesos")
		.select("tipo, marketplace_productos(titulo)")
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

	// Lista de proyectos del paquete.
	var proyectos = await llamarJson("/contenido-paquete?acceso_id=" + encodeURIComponent(accesoId));
	if (!proyectos) { return; }
	var lista = proyectos.proyectos || [];
	if (!lista.length) {
		estadoEl.innerHTML = '<p class="text-gray-500">Este paquete aún no tiene archivos. Vuelve pronto.</p>';
		return;
	}

	estadoEl.classList.add("hidden");
	listaEl.classList.remove("hidden");
	lista.forEach(function (p) { listaEl.appendChild(cardProyecto(p)); });
	Tienda.iconos();

	function cardProyecto(p) {
		var card = document.createElement("div");
		card.className = "bg-white rounded-2xl overflow-hidden";
		card.style.border = "1px solid #e7e6df";
		card.innerHTML =
			'<button class="cab w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition" style="border-radius:1rem">' +
			'<span class="font-bold" style="color:#1c2434">' + esc(p.nombre) + "</span>" +
			'<i data-lucide="chevron-down" class="chevron transition-transform -rotate-90" style="width:1.25rem;height:1.25rem;color:#5b6473"></i>' +
			"</button>" +
			'<div class="cuerpo hidden px-5 py-4" style="border-top:1px solid #e7e6df"><p class="text-sm" style="color:#5b6473">Cargando...</p></div>';

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
			btns += boton("descargar", index, a, '<i data-lucide="pencil" style="width:.875rem;height:.875rem"></i> Editar (Word)', "background:#059669;color:#fff");
		} else {
			btns += boton("descargar", index, a, '<i data-lucide="download" style="width:.875rem;height:.875rem"></i> Descargar', "background:#475569;color:#fff");
		}
		var iconoName = a.ext === "pdf" ? "file-text" : (a.ext === "docx" ? "file-pen-line" : "paperclip");
		return (
			'<div class="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style="background:#faf9f4">' +
			'<span class="text-sm min-w-0 truncate flex items-center gap-2" style="color:#1c2434">' +
			'<i data-lucide="' + iconoName + '" style="width:1rem;height:1rem;shrink:0;color:#5b6473"></i>' + esc(a.nombre) + "</span>" +
			'<div class="flex items-center gap-2 shrink-0">' + btns + "</div></div>"
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
