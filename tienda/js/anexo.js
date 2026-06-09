document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) { return; }

	var esc = Tienda.esc;
	var estadoEl = document.getElementById("estado");
	var visor = document.getElementById("visor");
	var tituloEl = document.getElementById("titulo");
	var btnImprimir = document.getElementById("btnImprimir");
	var btnDescargar = document.getElementById("btnDescargar");

	var params = new URLSearchParams(location.search);
	// "aula" = grado ("3") o combinación multigrado ("1-2"); acepta "g" por compatibilidad.
	var aula = params.get("aula") || params.get("g");
	var pr = params.get("pr"), a = params.get("a");

	if (!aula || !pr || !a) {
		estadoEl.textContent = "Enlace de anexo inválido.";
		return;
	}
	tituloEl.textContent = a;

	// Requiere sesión; si no, va a login y regresa aquí.
	var session = await Tienda.getSession();
	if (!session) {
		var next = "anexo.html" + location.search;
		location.href = "login.html?next=" + encodeURIComponent(next);
		return;
	}
	var token = Tienda.getAccessToken(session);

	var qsBase = "aula=" + encodeURIComponent(aula) + "&pr=" + encodeURIComponent(pr) +
		"&a=" + encodeURIComponent(a);
	var blobUrl = null;

	try {
		var resp = await fetch(Tienda.EDGE_BASE + "/anexo?" + qsBase + "&modo=inline", {
			headers: { Authorization: "Bearer " + token },
		});
		if (!resp.ok) {
			var data = {};
			try { data = await resp.json(); } catch (_) {}
			if (resp.status === 403 || data.sin_acceso) {
				mostrarSinAcceso();
				return;
			}
			throw new Error(data.error || "No se pudo abrir el anexo.");
		}
		var blob = await resp.blob();
		blobUrl = URL.createObjectURL(blob);
		visor.src = blobUrl;
		estadoEl.classList.add("hidden");
		visor.classList.remove("hidden");
		btnImprimir.classList.remove("hidden");
		btnDescargar.classList.remove("hidden");
	} catch (err) {
		estadoEl.textContent = err.message || "No se pudo abrir el anexo.";
		return;
	}

	btnImprimir.addEventListener("click", function () {
		try { visor.contentWindow.focus(); visor.contentWindow.print(); }
		catch (_) { Tienda.toast("Usa Ctrl+P para imprimir.", "info"); }
	});

	btnDescargar.addEventListener("click", async function () {
		btnDescargar.disabled = true;
		try {
			var r = await fetch(Tienda.EDGE_BASE + "/anexo?" + qsBase + "&modo=download", {
				headers: { Authorization: "Bearer " + token },
			});
			if (!r.ok) { throw new Error("No se pudo descargar."); }
			var b = await r.blob();
			var url = URL.createObjectURL(b);
			var link = document.createElement("a");
			link.href = url;
			link.download = a;
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
		} catch (err) {
			Tienda.toast(err.message || "No se pudo descargar.", "error");
		} finally {
			btnDescargar.disabled = false;
		}
	});

	function mostrarSinAcceso() {
		estadoEl.classList.remove("hidden");
		visor.classList.add("hidden");
		estadoEl.innerHTML =
			'<div class="flex flex-col items-center gap-3 text-gray-200">' +
			'<i data-lucide="lock" class="w-12 h-12 text-gray-400"></i>' +
			'<p class="text-lg font-semibold">Este material es de pago</p>' +
			'<p class="text-sm text-gray-400 max-w-sm">Necesitas comprar el paquete de ' + esc(aula.indexOf("-") !== -1 ? "multigrado " + aula.split("-").map(function (n) { return n + "°"; }).join("-") : aula + "° grado") + ' · trimestre ' + Math.ceil(Number(pr) / 4) + ' para verlo.</p>' +
			'<a href="catalogo.html" class="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl text-sm">Ver en el catálogo</a>' +
			"</div>";
		Tienda.iconos();
	}
});
