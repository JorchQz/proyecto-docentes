document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	const estadoEl = document.getElementById("proyectosEstado");
	const gridEl = document.getElementById("proyectosGrid");
	let proyectoActivoId = null;
	let modalEl = null;
	let modalFechaInput = null;
	let modalConfirmBtn = null;
	let modalCancelarBtn = null;
	let toastEl = null;

	const userResult = await window.sb.auth.getUser();
	const user = userResult && userResult.data ? userResult.data.user : null;

	if (!user) {
		window.location.href = "index.html";
		return;
	}

	if (gridEl) {
		gridEl.addEventListener("click", function (event) {
			const iniciarBtn = event.target.closest(".btn-iniciar");
			const pausarBtn = event.target.closest(".btn-pausar");

			if (iniciarBtn) {
				proyectoActivoId = iniciarBtn.getAttribute("data-id");
				abrirModalInicio();
				return;
			}

			if (pausarBtn) {
				const proyectoId = pausarBtn.getAttribute("data-id");
				pausarProyecto(proyectoId);
			}
		});
	}

	await cargarProyectos();

	function getHoyISO() {
		const hoy = new Date();
		hoy.setMinutes(hoy.getMinutes() - hoy.getTimezoneOffset());
		return hoy.toISOString().split("T")[0];
	}

	function normalizarLista(valor) {
		if (!valor) {
			return [];
		}

		if (Array.isArray(valor)) {
			return valor.map(function (item) {
				return String(item).trim();
			}).filter(Boolean);
		}

		if (typeof valor === "string") {
			try {
				const parsed = JSON.parse(valor);
				if (Array.isArray(parsed)) {
					return normalizarLista(parsed);
				}
			} catch (_) {}

			return valor
				.split(",")
				.map(function (item) {
					return String(item).trim();
				})
				.filter(Boolean);
		}

		return [];
	}

	function formatearFecha(fecha) {
		if (!fecha) {
			return "";
		}

		const valor = typeof fecha === "string" && fecha.length === 10 ? fecha + "T00:00:00" : fecha;
		const date = new Date(valor);

		if (Number.isNaN(date.getTime())) {
			return "";
		}

		return new Intl.DateTimeFormat("es-MX", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
		}).format(date);
	}

	function mostrarEstadoInicial(texto) {
		if (!estadoEl || !gridEl) {
			return;
		}

		estadoEl.classList.remove("hidden");
		estadoEl.className = "text-center py-12 text-gray-400";
		estadoEl.textContent = texto;
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function mostrarVacio() {
		if (!estadoEl || !gridEl) {
			return;
		}

		estadoEl.innerHTML = '\n    <div class="text-center py-12">\n      <p class="text-gray-400 text-lg mb-4">Aún no tienes proyectos creados</p>\n      <a href="crear_proyecto.html" \n         class="bg-blue-600 text-white font-bold px-6 py-3 \n                rounded-xl hover:bg-blue-700 transition">\n        Crear mi primer proyecto\n      </a>\n    </div>';
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function mostrarError() {
		if (!estadoEl || !gridEl) {
			return;
		}

		estadoEl.innerHTML = '<p class="text-red-500">Error al cargar proyectos. Intenta de nuevo.</p>';
		estadoEl.classList.remove("hidden");
		gridEl.classList.add("hidden");
		gridEl.innerHTML = "";
	}

	function renderProyectos(proyectos) {
		if (!estadoEl || !gridEl) {
			return;
		}

		estadoEl.classList.add("hidden");
		gridEl.classList.remove("hidden");
		gridEl.innerHTML = "";

		proyectos.forEach(function (proyecto) {
			const campos = normalizarLista(proyecto.campos_formativos);
			const grados = normalizarLista(proyecto.grados).map(function (grado) {
				return String(grado).replace(/[^0-9]/g, "");
			}).filter(Boolean);
			const gradosTexto = grados.length
				? "Grados: " + grados.map(function (grado) {
					return grado + "°";
				}).join(", ")
				: "Grados: -";
			const estado = proyecto.estado || "borrador";

			const card = document.createElement("article");
			card.className = "relative rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow";

			const badgeMap = {
				borrador: { clase: "bg-gray-100 text-gray-600", texto: "Borrador" },
				activo: { clase: "bg-green-100 text-green-700", texto: "Activo" },
				completado: { clase: "bg-blue-100 text-blue-700", texto: "Completado" },
				pausado: { clase: "bg-yellow-100 text-yellow-700", texto: "Pausado" },
			};
			const badge = badgeMap[estado] || badgeMap.borrador;

			let accionesHtml = "";
			if (estado === "borrador") {
				accionesHtml =
					'<button data-id="' + proyecto.id + '" class="btn-iniciar bg-green-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-green-700 transition">▶ Iniciar proyecto</button>' +
					'<a href="crear_proyecto.html?id=' + proyecto.id + '" class="border border-gray-300 text-gray-700 text-sm font-bold px-4 py-2 rounded-xl hover:bg-gray-50 transition">Ver / Editar</a>';
			} else if (estado === "activo") {
				accionesHtml =
					'<a href="crear_proyecto.html?id=' + proyecto.id + '" class="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition">Ver proyecto</a>' +
					'<button data-id="' + proyecto.id + '" class="btn-pausar border border-yellow-400 text-yellow-700 text-sm font-bold px-4 py-2 rounded-xl hover:bg-yellow-50 transition">Pausar</button>';
			} else {
				accionesHtml =
					'<a href="crear_proyecto.html?id=' + proyecto.id + '" class="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition">Ver proyecto</a>';
			}

			card.innerHTML =
				'<div class="absolute top-4 right-4 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ' +
				badge.clase +
				'">' +
				badge.texto +
				"</div>" +
				'<h3 class="font-bold text-gray-800 text-base truncate mb-2 pr-20">' +
				(proyecto.titulo || proyecto.nombre || "Proyecto sin título") +
				"</h3>" +
				(campos.length
					? '<div class="flex flex-wrap gap-1 mb-2">' +
						campos.map(function (campo) {
							return '<span class="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">' + campo + "</span>";
						}).join("") +
						"</div>"
					: "") +
				'<p class="text-sm text-gray-500 mb-1">Metodología: ' + (proyecto.metodologia || "-") + "</p>" +
				'<p class="text-sm text-gray-500 mb-3">' + gradosTexto + "</p>" +
				'<p class="text-xs text-gray-400">' + formatearFecha(proyecto.created_at) + "</p>" +
				'<div class="border-t pt-3 mt-3 flex flex-wrap gap-2">' +
				accionesHtml +
				"</div>";

			gridEl.appendChild(card);
		});
	}

	async function cargarProyectos() {
		mostrarEstadoInicial("Cargando proyectos...");

		const result = await window.sb
			.from("proyectos")
			.select("id, titulo, campos_formativos, metodologia, estado, created_at, grados, fase, fecha_inicial")
			.eq("maestro_id", user.id)
			.order("created_at", { ascending: false });

		if (result.error) {
			mostrarError();
			return;
		}

		const proyectos = result.data || [];

		if (!proyectos.length) {
			mostrarVacio();
			return;
		}

		renderProyectos(proyectos);
	}

	function abrirModalInicio() {
		if (!proyectoActivoId) {
			return;
		}

		const modal = asegurarModal();
		if (!modal || !modalFechaInput) {
			return;
		}

		modalFechaInput.value = getHoyISO();
		modal.classList.remove("hidden");
		modalFechaInput.focus();
	}

	function cerrarModalInicio() {
		if (modalEl) {
			modalEl.classList.add("hidden");
		}
		proyectoActivoId = null;
	}

	function asegurarModal() {
		if (modalEl) {
			return modalEl;
		}

		modalEl = document.createElement("div");
		modalEl.id = "modalInicioProyecto";
		modalEl.className = "hidden fixed inset-0 bg-black/40 flex items-center justify-center z-50";
		modalEl.innerHTML =
			'<div class="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">' +
			'<h3 class="text-lg font-bold text-gray-800">¿Cuándo inicias este proyecto?</h3>' +
			'<input type="date" id="fechaInicio" class="mt-4 w-full rounded-xl border border-gray-300 px-4 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />' +
			'<div class="mt-6 flex justify-end gap-2">' +
			'<button id="btnCancelarModal" type="button" class="border border-gray-300 text-gray-700 text-sm font-bold px-4 py-2 rounded-xl hover:bg-gray-50 transition">Cancelar</button>' +
			'<button id="btnConfirmarInicio" type="button" class="bg-green-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-green-700 transition">Iniciar</button>' +
			"</div>" +
			"</div>";

		document.body.appendChild(modalEl);
		modalFechaInput = modalEl.querySelector("#fechaInicio");
		modalConfirmBtn = modalEl.querySelector("#btnConfirmarInicio");
		modalCancelarBtn = modalEl.querySelector("#btnCancelarModal");

		modalEl.addEventListener("click", function (event) {
			if (event.target === modalEl) {
				cerrarModalInicio();
			}
		});

		if (modalConfirmBtn) {
			modalConfirmBtn.addEventListener("click", confirmarInicioProyecto);
		}

		if (modalCancelarBtn) {
			modalCancelarBtn.addEventListener("click", cerrarModalInicio);
		}

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
				cerrarModalInicio();
			}
		});

		return modalEl;
	}

	async function confirmarInicioProyecto() {
		if (!proyectoActivoId || !modalFechaInput) {
			return;
		}

		const fechaElegida = modalFechaInput.value || getHoyISO();

		if (modalConfirmBtn) {
			modalConfirmBtn.disabled = true;
			modalConfirmBtn.textContent = "Iniciando...";
		}

		try {
			const proyectoResult = await window.sb
				.from("proyectos")
				.update({ estado: "activo", fecha_inicial: fechaElegida })
				.eq("id", proyectoActivoId);

			if (proyectoResult.error) {
				throw proyectoResult.error;
			}

			const sesionResult = await window.sb
				.from("sesiones")
				.update({ estado_sesion: "activa" })
				.eq("proyecto_id", proyectoActivoId)
				.eq("numero_sesion", 1);

			if (sesionResult.error) {
				throw sesionResult.error;
			}

			cerrarModalInicio();
			await cargarProyectos();
			mostrarToast("✅ ¡Proyecto iniciado! Ya aparece en tu dashboard.");
		} catch (error) {
			console.error(error);
			alert("No se pudo iniciar el proyecto. Intenta de nuevo.");
		} finally {
			if (modalConfirmBtn) {
				modalConfirmBtn.disabled = false;
				modalConfirmBtn.textContent = "Iniciar";
			}
		}
	}

	async function pausarProyecto(proyectoId) {
		if (!proyectoId) {
			return;
		}

		const result = await window.sb
			.from("proyectos")
			.update({ estado: "pausado" })
			.eq("id", proyectoId);

		if (result.error) {
			alert("No se pudo pausar el proyecto. Intenta de nuevo.");
			return;
		}

		await cargarProyectos();
	}

	function mostrarToast(mensaje) {
		if (toastEl) {
			toastEl.remove();
		}

		toastEl = document.createElement("div");
		toastEl.className = "fixed bottom-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-xl shadow-lg";
		toastEl.textContent = mensaje;
		document.body.appendChild(toastEl);

		setTimeout(function () {
			if (toastEl) {
				toastEl.remove();
				toastEl = null;
			}
		}, 3000);
	}
});