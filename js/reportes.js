document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	// ── Estado global ──────────────────────────────────────────────
	let userId    = null;
	let grupoId   = null;
	let grupNombre = "";
	let alumnos   = [];
	let lastCalifData = []; // cache para CSV y concentrado

	const CAMPOS = [
		"Lenguajes",
		"Saberes y Pensamiento Científico",
		"Ética, Naturaleza y Sociedades",
		"De lo Humano y lo Comunitario",
	];
	const CAMPOS_CORTOS = ["Lenguajes", "Sab. Cient.", "Ética/Soc.", "Humano/Com."];

	// ── Inicialización ─────────────────────────────────────────────
	const { data: { session }, error: sessErr } = await window.sb.auth.getSession();
	if (sessErr || !session) { window.location.href = "index.html"; return; }
	userId = session.user.id;

	const { data: grupo } = await window.sb
		.from("grupos").select("id, nombre").eq("maestro_id", userId).single();
	if (!grupo) { window.location.href = "onboarding.html"; return; }
	grupoId   = grupo.id;
	grupNombre = grupo.nombre || "Grupo";

	const { data: als } = await window.sb
		.from("alumnos")
		.select("id, nombre_completo, num_lista, grado")
		.eq("maestro_id", userId)
		.eq("grupo_id", grupoId)
		.eq("estatus", "Activo")
		.order("grado").order("num_lista");
	alumnos = als || [];

	// ── Tabs ───────────────────────────────────────────────────────
	document.querySelectorAll(".tab-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			const tab = btn.dataset.tab;
			document.querySelectorAll(".tab-btn").forEach(function (b) {
				b.classList.remove("text-blue-700", "border-blue-600", "bg-blue-50");
				b.classList.add("text-gray-500", "border-transparent");
			});
			btn.classList.add("text-blue-700", "border-blue-600", "bg-blue-50");
			btn.classList.remove("text-gray-500", "border-transparent");

			["panelAsistencia", "panelCalificaciones", "panelConcentrado"].forEach(function (id) {
				document.getElementById(id).classList.add("hidden");
			});
			document.getElementById("panel" + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.remove("hidden");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// TAB 1 — ASISTENCIA
	// ═══════════════════════════════════════════════════════════════
	document.getElementById("generateReportBtn").addEventListener("click", async function () {
		const start = document.getElementById("startDate").value;
		const end   = document.getElementById("endDate").value;
		const cont  = document.getElementById("reportContainer");

		if (!start || !end) {
			cont.innerHTML = "<p class='text-red-500 text-sm'>Selecciona un rango de fechas.</p>";
			return;
		}
		cont.innerHTML = "<p class='text-gray-400 text-sm'>Generando...</p>";

		const { data, error } = await window.sb
			.from("asistencias")
			.select("alumno_id, asistencia_estado")
			.eq("maestro_id", userId)
			.eq("grupo_id", grupoId)
			.gte("fecha", start)
			.lte("fecha", end);

		if (error) { cont.innerHTML = "<p class='text-red-500 text-sm'>Error al cargar datos.</p>"; return; }

		const mapa = {};
		alumnos.forEach(function (al) {
			mapa[al.id] = { nombre: al.nombre_completo, num: al.num_lista, presente: 0, ausente: 0, justificada: 0 };
		});
		(data || []).forEach(function (r) {
			if (!mapa[r.alumno_id]) return;
			if (r.asistencia_estado === "presente")   mapa[r.alumno_id].presente++;
			if (r.asistencia_estado === "ausente")    mapa[r.alumno_id].ausente++;
			if (r.asistencia_estado === "justificada") mapa[r.alumno_id].justificada++;
		});

		const filas = Object.values(mapa).sort(function (a, b) { return (a.num || 0) - (b.num || 0); });
		if (!filas.length) { cont.innerHTML = "<p class='text-gray-400'>Sin datos para este período.</p>"; return; }

		let html = "<h3 class='font-bold text-gray-800 mb-3'>Asistencia del " + start + " al " + end + "</h3>" +
			"<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-4 py-3 text-left'>No.</th><th class='px-4 py-3 text-left'>Alumno</th>" +
			"<th class='px-4 py-3 text-center'>Presentes</th><th class='px-4 py-3 text-center'>Faltas</th>" +
			"<th class='px-4 py-3 text-center'>Justificadas</th><th class='px-4 py-3 text-center'>Total</th>" +
			"</tr></thead><tbody class='divide-y divide-gray-100'>";

		filas.forEach(function (al) {
			const total = al.presente + al.ausente + al.justificada;
			const pct   = total ? Math.round((al.presente / total) * 100) : 0;
			const color = pct >= 85 ? "text-green-600" : pct >= 70 ? "text-yellow-600" : "text-red-600";
			html += "<tr class='hover:bg-gray-50'>" +
				"<td class='px-4 py-3 text-gray-500'>" + (al.num || "") + "</td>" +
				"<td class='px-4 py-3 font-medium text-gray-800'>" + esc(al.nombre) + "</td>" +
				"<td class='px-4 py-3 text-center text-green-600 font-semibold'>" + al.presente + "</td>" +
				"<td class='px-4 py-3 text-center text-red-500'>" + al.ausente + "</td>" +
				"<td class='px-4 py-3 text-center text-yellow-600'>" + al.justificada + "</td>" +
				"<td class='px-4 py-3 text-center'><span class='" + color + " font-bold'>" + total + "</span></td>" +
				"</tr>";
		});
		html += "</tbody></table></div>";
		cont.innerHTML = html;
	});

	document.getElementById("downloadPdfBtn").addEventListener("click", function () {
		const el = document.getElementById("reportContainer");
		if (!el.querySelector("table")) return;
		html2pdf().set({
			margin: 0.5,
			filename: "asistencia-" + grupNombre + ".pdf",
			html2canvas: { scale: 2 },
			jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
		}).from(el).save();
	});

	// ═══════════════════════════════════════════════════════════════
	// TAB 2 — VISTA RECREA (Calificaciones por campo formativo)
	// ═══════════════════════════════════════════════════════════════
	document.getElementById("generarCalifBtn").addEventListener("click", async function () {
		await generarVistaRecrea();
	});

	document.getElementById("exportCsvBtn").addEventListener("click", function () {
		if (!lastCalifData.length) return;
		exportarCSV(lastCalifData);
	});

	async function generarVistaRecrea() {
		const cont = document.getElementById("califContainer");
		const trimestre = document.getElementById("selectTrimestre").value;
		cont.innerHTML = "<p class='text-gray-400 text-sm'>Cargando calificaciones...</p>";

		// Obtener IDs de proyectos del trimestre seleccionado
		let proyIds = null;
		if (trimestre) {
			const { data: proyectos } = await window.sb
				.from("proyectos")
				.select("id")
				.eq("maestro_id", userId)
				.eq("grupo_id", grupoId)
				.eq("trimestre", parseInt(trimestre));
			if (!proyectos || !proyectos.length) {
				cont.innerHTML = "<p class='text-gray-400'>No hay proyectos para el trimestre " + trimestre + ".</p>";
				return;
			}
			proyIds = proyectos.map(function (p) { return p.id; });
		}

		let query = window.sb
			.from("calificaciones")
			.select("alumno_id, tipo, calificacion, campo_formativo, grado")
			.eq("maestro_id", userId)
			.eq("grupo_id", grupoId);

		if (proyIds) {
			query = query.in("proyecto_id", proyIds);
		}

		const { data: califs, error } = await query;
		if (error) { cont.innerHTML = "<p class='text-red-500 text-sm'>Error al cargar calificaciones.</p>"; return; }

		if (!califs || !califs.length) {
			cont.innerHTML = "<div class='py-8 text-center'><p class='text-gray-400 text-lg mb-2'>Sin calificaciones registradas</p><p class='text-sm text-gray-400'>Las calificaciones se generan al cerrar sesiones desde el Dashboard.</p></div>";
			return;
		}

		// Calcular promedios por alumno x campo + participación + conducta
		const resumen = {};
		alumnos.forEach(function (al) {
			resumen[al.id] = {
				nombre:  al.nombre_completo || "Sin nombre",
				num:     al.num_lista,
				grado:   al.grado,
				campos:  {},
				part:    [],
				cond:    [],
			};
			CAMPOS.forEach(function (c) { resumen[al.id].campos[c] = []; });
		});

		califs.forEach(function (r) {
			if (!resumen[r.alumno_id] || r.calificacion === null) return;
			const cal = Number(r.calificacion);
			if (r.tipo === "participacion") {
				resumen[r.alumno_id].part.push(cal);
			} else if (r.tipo === "conducta") {
				resumen[r.alumno_id].cond.push(cal);
			} else if (r.campo_formativo && resumen[r.alumno_id].campos[r.campo_formativo]) {
				resumen[r.alumno_id].campos[r.campo_formativo].push(cal);
			}
		});

		// Mostrar TODOS los alumnos — los sin datos muestran "—" para que el maestro vea quién falta
		const filas = Object.values(resumen)
			.sort(function (a, b) { return (a.grado || 0) - (b.grado || 0) || (a.num || 0) - (b.num || 0); });

		if (!filas.length) {
			cont.innerHTML = "<p class='text-gray-400'>Sin alumnos en el grupo.</p>";
			return;
		}

		lastCalifData = filas;

		// Renderizar tabla
		let html = "<div class='overflow-x-auto'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-500 uppercase'>" +
			"<th class='px-3 py-3 text-left whitespace-nowrap'>No.</th>" +
			"<th class='px-3 py-3 text-left whitespace-nowrap'>Alumno</th>" +
			"<th class='px-3 py-3 text-center'>Grado</th>";

		CAMPOS_CORTOS.forEach(function (c) {
			html += "<th class='px-3 py-3 text-center whitespace-nowrap'>" + c + "</th>";
		});
		html += "<th class='px-3 py-3 text-center'>Part.</th>" +
			"<th class='px-3 py-3 text-center'>Cond.</th>" +
			"<th class='px-3 py-3 text-center font-bold text-gray-700'>Prom.</th>" +
			"</tr></thead><tbody class='divide-y divide-gray-100'>";

		filas.forEach(function (al) {
			const campoProms = CAMPOS.map(function (c) {
				return promedio(al.campos[c]);
			});
			const partProm = promedio(al.part);
			const condProm = promedio(al.cond);
			const todos    = campoProms.filter(function (v) { return v !== null; })
				.concat(partProm !== null ? [partProm] : [])
				.concat(condProm !== null ? [condProm] : []);
			const promTotal = todos.length ? Math.round(todos.reduce(function (a, b) { return a + b; }, 0) / todos.length) : null;

			html += "<tr class='hover:bg-gray-50'>" +
				"<td class='px-3 py-3 text-gray-500'>" + (al.num || "") + "</td>" +
				"<td class='px-3 py-3 font-medium text-gray-800 whitespace-nowrap'>" + esc(al.nombre) + "</td>" +
				"<td class='px-3 py-3 text-center'>" + (al.grado ? al.grado + "°" : "—") + "</td>";

			campoProms.forEach(function (v) {
				html += "<td class='px-3 py-3 text-center'>" + celdaCalif(v) + "</td>";
			});
			html += "<td class='px-3 py-3 text-center'>" + celdaCalif(partProm) + "</td>" +
				"<td class='px-3 py-3 text-center'>" + celdaCalif(condProm) + "</td>" +
				"<td class='px-3 py-3 text-center'><span class='font-bold text-base " + colorCalif(promTotal) + "'>" +
				(promTotal !== null ? promTotal : "—") + "</span></td>" +
				"</tr>";
		});

		html += "</tbody></table></div>";
		cont.innerHTML = html;
	}

	// ═══════════════════════════════════════════════════════════════
	// TAB 3 — CONCENTRADO DIRECTOR
	// ═══════════════════════════════════════════════════════════════
	document.getElementById("generarConcBtn").addEventListener("click", async function () {
		const cont = document.getElementById("concentradoContainer");
		const trimestre = document.getElementById("selectTrimestreConc").value;

		// Reusar datos cacheados si el trimestre coincide con Vista Recrea
		const trimestreCalif = document.getElementById("selectTrimestre").value;
		let filas = [];

		if (lastCalifData.length && trimestreCalif === trimestre) {
			filas = lastCalifData;
		} else {
			cont.innerHTML = "<p class='text-gray-400 text-sm'>Generando desde calificaciones...</p>";

			let proyIds = null;
			if (trimestre) {
				const { data: proyectos } = await window.sb
					.from("proyectos").select("id")
					.eq("maestro_id", userId).eq("grupo_id", grupoId)
					.eq("trimestre", parseInt(trimestre));
				if (proyectos && proyectos.length) proyIds = proyectos.map(function (p) { return p.id; });
			}

			let q = window.sb.from("calificaciones")
				.select("alumno_id, tipo, calificacion, campo_formativo, grado")
				.eq("maestro_id", userId).eq("grupo_id", grupoId);
			if (proyIds) q = q.in("proyecto_id", proyIds);

			const { data: califs, error } = await q;
			if (error || !califs || !califs.length) {
				cont.innerHTML = "<p class='text-gray-400'>Sin calificaciones para este período.</p>";
				return;
			}

			const resumen = {};
			alumnos.forEach(function (al) {
				resumen[al.id] = { nombre: al.nombre_completo, grado: al.grado, todos: [] };
			});
			califs.forEach(function (r) {
				if (!resumen[r.alumno_id] || r.calificacion === null) return;
				resumen[r.alumno_id].todos.push(Number(r.calificacion));
			});

			filas = Object.values(resumen)
				.filter(function (al) { return al.todos.length; })
				.map(function (al) {
					const prom = al.todos.reduce(function (a, b) { return a + b; }, 0) / al.todos.length;
					return { nombre: al.nombre, grado: al.grado, promedio: Math.round(prom) };
				})
				.sort(function (a, b) { return b.promedio - a.promedio; });
		}

		if (!filas.length) { cont.innerHTML = "<p class='text-gray-400'>Sin datos para este período.</p>"; return; }

		const calcProm = function (fila) {
			const campoProms = CAMPOS.map(function (c) { return promedio(fila.campos ? (fila.campos[c] || []) : []); });
			const partP = promedio(fila.part || []);
			const condP = promedio(fila.cond || []);
			const todos = campoProms.filter(Boolean)
				.concat(partP !== null ? [partP] : [])
				.concat(condP !== null ? [condP] : []);
			return todos.length ? Math.round(todos.reduce(function (a, b) { return a + b; }, 0) / todos.length) : (fila.promedio || null);
		};

		const bajo  = filas.filter(function (f) { const p = calcProm(f); return p !== null && p <= 6; });
		const medio = filas.filter(function (f) { const p = calcProm(f); return p !== null && p >= 7 && p <= 8; });
		const alto  = filas.filter(function (f) { const p = calcProm(f); return p !== null && p >= 9; });

		const bloque = function (titulo, color, lista) {
			if (!lista.length) return "";
			const items = lista.map(function (al) {
				const p = calcProm(al);
				return "<li class='flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0'>" +
					"<span class='text-sm text-gray-800'>" + esc(al.nombre) + (al.grado ? " <span class='text-xs text-gray-400'>" + al.grado + "°</span>" : "") + "</span>" +
					"<span class='text-sm font-bold " + colorCalif(p) + "'>" + (p !== null ? p : "—") + "</span>" +
					"</li>";
			}).join("");
			return "<div class='rounded-xl border " + color.border + " overflow-hidden'>" +
				"<div class='" + color.header + " px-4 py-3 flex justify-between items-center'>" +
				"<span class='font-bold text-sm'>" + titulo + "</span>" +
				"<span class='text-sm font-semibold'>" + lista.length + " alumno" + (lista.length !== 1 ? "s" : "") + "</span>" +
				"</div><ul class='px-4 py-1'>" + items + "</ul></div>";
		};

		cont.innerHTML =
			"<div class='flex flex-col gap-4'>" +
			bloque("Alto (9-10)", { border: "border-green-200", header: "bg-green-50 text-green-800" }, alto) +
			bloque("Medio (7-8)", { border: "border-yellow-200", header: "bg-yellow-50 text-yellow-800" }, medio) +
			bloque("Bajo (5-6)",  { border: "border-red-200",   header: "bg-red-50 text-red-800"   }, bajo) +
			"<p class='text-xs text-gray-400 text-right'>Total: " + (alto.length + medio.length + bajo.length) + " alumnos con datos</p>" +
			"</div>";
	});

	// ── Helpers ────────────────────────────────────────────────────
	function promedio(arr) {
		if (!arr || !arr.length) return null;
		const sum = arr.reduce(function (a, b) { return a + b; }, 0);
		return Math.round(sum / arr.length);
	}

	function colorCalif(v) {
		if (v === null || v === undefined) return "text-gray-400";
		if (v >= 9) return "text-green-600";
		if (v >= 7) return "text-yellow-600";
		return "text-red-500";
	}

	function celdaCalif(v) {
		if (v === null || v === undefined) return "<span class='text-gray-300'>—</span>";
		return "<span class='font-semibold " + colorCalif(v) + "'>" + v + "</span>";
	}

	function exportarCSV(filas) {
		const cabecera = ["No.", "Alumno", "Grado"].concat(CAMPOS).concat(["Participacion", "Conducta", "Promedio"]);
		const lineas = [cabecera.join(",")];

		filas.forEach(function (al) {
			const campoProms = CAMPOS.map(function (c) {
				return promedio(al.campos ? (al.campos[c] || []) : []) ?? "";
			});
			const partP = promedio(al.part || []) ?? "";
			const condP = promedio(al.cond || []) ?? "";
			const todos = [].concat(campoProms.filter(function (v) { return v !== ""; }))
				.concat(partP !== "" ? [partP] : [])
				.concat(condP !== "" ? [condP] : []);
			const promT = todos.length ? Math.round(todos.reduce(function (a, b) { return Number(a) + Number(b); }, 0) / todos.length) : "";

			const fila = [al.num || "", '"' + (al.nombre || "") + '"', al.grado || ""]
				.concat(campoProms)
				.concat([partP, condP, promT]);
			lineas.push(fila.join(","));
		});

		const blob = new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8;" });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement("a");
		a.href     = url;
		a.download = "vista-recrea-" + grupNombre + ".csv";
		a.click();
		URL.revokeObjectURL(url);
	}

	function esc(str) {
		return String(str || "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
});
