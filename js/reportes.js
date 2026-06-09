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

	// ═══════════════════════════════════════════════════════════════
	// TAB 4 — BOLETA
	// ═══════════════════════════════════════════════════════════════
	const CRITERIOS_CUADERNO = [
		"Orden y limpieza",
		"Escribe fecha completa",
		"Escribe título de actividad",
		"Letra legible",
		"Uso correcto de mayúsculas/minúsculas",
		"Signos de puntuación",
		"Acentuación",
		"Buen estado de la libreta",
		"Orden por proyecto",
		"Respeta margen",
	];

	const HABILIDADES_MATES = [
		"Suma", "Resta", "Multiplicación", "División",
		"Fracciones", "Tablas de multiplicar",
		"Lectura y escritura de cantidades", "Problemas matemáticos",
	];

	// Niveles de velocidad lectora por grado: [lenta_max, regular_max, buena_max]
	// < lenta_max = Lenta | < regular_max = Regular | < buena_max = Buena | >= buena_max = Excelente
	const VELOCIDAD_LECTORA = {
		1: [30, 45, 70],
		2: [40, 60, 90],
		3: [60, 80, 110],
		4: [70, 90, 120],
		5: [80, 100, 130],
		6: [90, 110, 140],
	};

	// Datos del grupo para la cabecera (escuela, ciclo)
	let boletaGrupoInfo = { escuela: "", ciclo: "" };
	let boletaResumenTexto = ""; // resumen plano para WhatsApp

	// Cargar info extra del grupo (escuela, ciclo escolar)
	(async function cargarInfoGrupoBoleta() {
		const { data: g } = await window.sb
			.from("grupos").select("escuela, ciclo_escolar")
			.eq("id", grupoId).maybeSingle();
		if (g) {
			boletaGrupoInfo.escuela = g.escuela || "";
			boletaGrupoInfo.ciclo   = g.ciclo_escolar || "";
		}
	})();

	// Poblar selector de alumnos
	(function poblarAlumnosBoleta() {
		const sel = document.getElementById("selectAlumnoBoleta");
		if (!sel) return;
		alumnos.forEach(function (al) {
			const opt = document.createElement("option");
			opt.value = al.id;
			opt.textContent = (al.num_lista ? al.num_lista + ". " : "") + (al.nombre_completo || "Sin nombre") +
				(al.grado ? " (" + al.grado + "°)" : "");
			sel.appendChild(opt);
		});
	})();

	document.getElementById("generarBoletaBtn").addEventListener("click", async function () {
		await generarBoleta();
	});

	function promedioPorTipo(califs, tipo, campo) {
		const filtro = califs.filter(function (c) {
			return c.tipo === tipo && (campo === null || c.campo_formativo === campo) && c.calificacion !== null;
		});
		if (!filtro.length) return null;
		return filtro.reduce(function (s, c) { return s + Number(c.calificacion); }, 0) / filtro.length;
	}

	function calcCF(califs, asistenciaPct, examenPorCF, campo, pesos) {
		const tareas   = promedioPorTipo(califs, "tarea", campo);
		const trabajos = promedioPorTipo(califs, "actividad", campo);
		const part     = promedioPorTipo(califs, "participacion", null); // participación global
		const cond     = promedioPorTipo(califs, "conducta", null);      // conducta global
		const examen   = (examenPorCF[campo] !== undefined && examenPorCF[campo] !== null) ? examenPorCF[campo] : null;

		let suma = 0, pesoUsado = 0;
		if (tareas !== null)        { suma += tareas * pesos.tareas / 100;                 pesoUsado += pesos.tareas; }
		if (trabajos !== null)      { suma += trabajos * pesos.trabajos / 100;             pesoUsado += pesos.trabajos; }
		if (asistenciaPct !== null) { suma += asistenciaPct * 10 * pesos.asistencia / 100; pesoUsado += pesos.asistencia; }
		if (part !== null)          { suma += part * pesos.participacion / 100;            pesoUsado += pesos.participacion; }
		if (cond !== null)          { suma += cond * pesos.conducta / 100;                 pesoUsado += pesos.conducta; }
		if (examen !== null)        { suma += examen * pesos.examen / 100;                 pesoUsado += pesos.examen; }

		if (pesoUsado === 0) return null;
		return suma * 100 / pesoUsado; // normalizar a escala 0-10
	}

	function semColorClass(semaforo) {
		if (semaforo === "logrado")        return "bg-emerald-500";
		if (semaforo === "en_proceso")     return "bg-amber-400";
		if (semaforo === "requiere_apoyo") return "bg-red-500";
		return "bg-gray-200";
	}

	function semCirculo(semaforo) {
		return '<span class="inline-block w-4 h-4 rounded-full ' + semColorClass(semaforo) + '"></span>';
	}

	function nivelVelocidad(grado, ppm) {
		if (ppm === null || ppm === undefined || isNaN(ppm)) return "—";
		const t = VELOCIDAD_LECTORA[grado];
		if (!t) return "—";
		if (ppm < t[0]) return "Lenta";
		if (ppm < t[1]) return "Regular";
		if (ppm < t[2]) return "Buena";
		return "Excelente";
	}

	function fmtCal(v) {
		if (v === null || v === undefined) return "—";
		return (Math.round(v * 10) / 10).toFixed(1);
	}

	async function generarBoleta() {
		const cont      = document.getElementById("boletaContainer");
		const acciones  = document.getElementById("boletaAcciones");
		const alumnoId  = document.getElementById("selectAlumnoBoleta").value;
		const trimestre = parseInt(document.getElementById("selectTrimBoleta").value, 10);

		acciones.classList.add("hidden");

		if (!alumnoId) {
			cont.innerHTML = "<p class='text-red-500 text-sm'>Selecciona un alumno.</p>";
			return;
		}
		const alumno = alumnos.find(function (a) { return a.id === alumnoId; });
		if (!alumno) { cont.innerHTML = "<p class='text-red-500 text-sm'>Alumno no encontrado.</p>"; return; }

		cont.innerHTML = "<p class='text-gray-400 text-sm'>Generando boleta...</p>";

		// 1. Ponderación del maestro
		const { data: ajustes } = await window.sb
			.from("maestro_ajustes").select("*").eq("maestro_id", userId).maybeSingle();
		const pesos = {
			tareas:        Number(ajustes && ajustes.peso_tareas        != null ? ajustes.peso_tareas        : 25),
			trabajos:      Number(ajustes && ajustes.peso_trabajos      != null ? ajustes.peso_trabajos      : 25),
			asistencia:    Number(ajustes && ajustes.peso_asistencia    != null ? ajustes.peso_asistencia    : 10),
			participacion: Number(ajustes && ajustes.peso_participacion != null ? ajustes.peso_participacion : 5),
			conducta:      Number(ajustes && ajustes.peso_conducta      != null ? ajustes.peso_conducta      : 5),
			examen:        Number(ajustes && ajustes.peso_examen        != null ? ajustes.peso_examen        : 30),
		};

		// 2. Proyectos del trimestre
		const { data: proyectos } = await window.sb
			.from("proyectos").select("id")
			.eq("maestro_id", userId).eq("grupo_id", grupoId).eq("trimestre", trimestre);
		const proyIds = (proyectos || []).map(function (p) { return p.id; });

		// 2b. Calificaciones del alumno en esos proyectos
		let califs = [];
		if (proyIds.length) {
			const { data: cData } = await window.sb
				.from("calificaciones")
				.select("tipo, calificacion, campo_formativo")
				.eq("alumno_id", alumnoId)
				.in("proyecto_id", proyIds);
			califs = cData || [];
		}

		// 3. Asistencia del trimestre (rango = min/max fecha de sesiones del trimestre)
		let asistenciaPct = null;
		let diasPresente = 0, diasTotal = 0;
		if (proyIds.length) {
			const { data: ses } = await window.sb
				.from("sesiones").select("fecha")
				.in("proyecto_id", proyIds).not("fecha", "is", null);
			const fechas = (ses || []).map(function (s) { return s.fecha; }).filter(Boolean).sort();
			if (fechas.length) {
				const fechaInicio = fechas[0];
				const fechaFin    = fechas[fechas.length - 1];
				const { data: asis } = await window.sb
					.from("asistencias").select("asistencia_estado")
					.eq("alumno_id", alumnoId)
					.gte("fecha", fechaInicio).lte("fecha", fechaFin);
				(asis || []).forEach(function (a) {
					diasTotal++;
					if (a.asistencia_estado === "presente") diasPresente++;
					else if (a.asistencia_estado === "justificada") diasPresente++; // justificada cuenta como presente
				});
				if (diasTotal > 0) asistenciaPct = diasPresente / diasTotal;
			}
		}

		// 4. Examen del trimestre + puntos por CF
		const examenPorCF = {};
		const { data: examen } = await window.sb
			.from("examenes")
			.select("id, preguntas_ids, valor_total, total_preguntas")
			.eq("trimestre", trimestre).eq("maestro_id", userId)
			.limit(1).maybeSingle();

		if (examen && examen.id) {
			const { data: respuestas } = await window.sb
				.from("respuestas_examen")
				.select("pregunta_id, puntos_obtenidos")
				.eq("examen_id", examen.id).eq("alumno_id", alumnoId);

			const pregIds = (examen.preguntas_ids || []);
			let preguntas = [];
			if (pregIds.length) {
				const { data: pData } = await window.sb
					.from("banco_preguntas").select("id, campo_formativo").in("id", pregIds);
				preguntas = pData || [];
			}
			const cfPorPregunta = {};
			preguntas.forEach(function (p) { cfPorPregunta[p.id] = p.campo_formativo; });

			// max posible por CF: cada pregunta vale (valor_total / total_preguntas) si no hay valor por pregunta
			const valorPorPregunta = (examen.valor_total && examen.total_preguntas)
				? Number(examen.valor_total) / Number(examen.total_preguntas) : null;

			const obtPorCF = {}, maxPorCF = {};
			preguntas.forEach(function (p) {
				const cf = p.campo_formativo;
				if (!cf) return;
				maxPorCF[cf] = (maxPorCF[cf] || 0) + (valorPorPregunta !== null ? valorPorPregunta : 1);
			});
			(respuestas || []).forEach(function (r) {
				const cf = cfPorPregunta[r.pregunta_id];
				if (!cf) return;
				obtPorCF[cf] = (obtPorCF[cf] || 0) + Number(r.puntos_obtenidos || 0);
			});
			CAMPOS.forEach(function (cf) {
				if (maxPorCF[cf] && maxPorCF[cf] > 0) {
					examenPorCF[cf] = (obtPorCF[cf] || 0) / maxPorCF[cf] * 10; // escala 0-10
				}
			});
		}

		// 5. Evaluación diagnóstica del trimestre
		const { data: diagnostica } = await window.sb
			.from("evaluacion_diagnostica").select("*")
			.eq("alumno_id", alumnoId).eq("maestro_id", userId)
			.eq("momento", "trimestre_" + trimestre).maybeSingle();

		// ── Calcular calificación final por CF ──
		const calPorCF = {};
		CAMPOS.forEach(function (cf) {
			calPorCF[cf] = calcCF(califs, asistenciaPct, examenPorCF, cf, pesos);
		});

		// Detalle de rubros por CF para la tabla (cada celda = avg de ese rubro en ese CF)
		function rubroCF(tipo, cf) {
			return promedioPorTipo(califs, tipo, cf);
		}

		// ── Renderizar boleta ──
		const cabecera =
			"<div class='border-b-2 border-gray-300 pb-4 mb-5'>" +
			"<div class='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2'>" +
			"<div>" +
			"<h2 class='text-xl font-bold text-gray-800'>Boleta de Evaluación</h2>" +
			"<p class='text-sm text-gray-600 mt-1'>" + esc(boletaGrupoInfo.escuela || "Escuela") + "</p>" +
			"</div>" +
			"<div class='text-sm text-gray-600 sm:text-right'>" +
			"<p>Ciclo escolar: <span class='font-semibold'>" + esc(boletaGrupoInfo.ciclo || "—") + "</span></p>" +
			"<p>Trimestre: <span class='font-semibold'>" + trimestre + "°</span></p>" +
			"</div>" +
			"</div>" +
			"<div class='mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm'>" +
			"<p><span class='text-gray-500'>Alumno:</span> <span class='font-semibold text-gray-800'>" + esc(alumno.nombre_completo) + "</span></p>" +
			"<p><span class='text-gray-500'>Grado:</span> <span class='font-semibold text-gray-800'>" + (alumno.grado ? alumno.grado + "°" : "—") + "</span></p>" +
			"<p><span class='text-gray-500'>No. lista:</span> <span class='font-semibold text-gray-800'>" + (alumno.num_lista || "—") + "</span></p>" +
			"</div>" +
			"</div>";

		// Sección 1: Desempeño + examen
		const camposCols = CAMPOS_CORTOS;
		const asisCelda10 = (asistenciaPct !== null) ? asistenciaPct * 10 : null;

		function filaRubro(label, tipo, esGlobal, esAsistencia) {
			let celdas = "";
			CAMPOS.forEach(function (cf) {
				let v;
				if (esAsistencia) v = asisCelda10;
				else if (tipo === "examen") v = (examenPorCF[cf] !== undefined ? examenPorCF[cf] : null);
				else if (esGlobal) v = promedioPorTipo(califs, tipo, null);
				else v = rubroCF(tipo, cf);
				celdas += "<td class='px-3 py-2 text-center border border-gray-200'>" + fmtCal(v) + "</td>";
			});
			return "<tr><td class='px-3 py-2 font-medium text-gray-700 border border-gray-200'>" + label + "</td>" + celdas + "</tr>";
		}

		let tablaCeldasFinal = "";
		CAMPOS.forEach(function (cf) {
			tablaCeldasFinal += "<td class='px-3 py-2 text-center font-bold border border-gray-200 " + colorCalif(calPorCF[cf] !== null ? Math.round(calPorCF[cf]) : null) + "'>" + fmtCal(calPorCF[cf]) + "</td>";
		});

		let seccion1 =
			"<h3 class='font-bold text-gray-800 mb-2'>1. Desempeño continuo y examen</h3>" +
			"<div class='overflow-x-auto mb-6'><table class='min-w-full text-sm border-collapse'>" +
			"<thead><tr class='bg-gray-50 text-xs text-gray-600 uppercase'>" +
			"<th class='px-3 py-2 text-left border border-gray-200'>Criterio</th>";
		camposCols.forEach(function (c) { seccion1 += "<th class='px-3 py-2 text-center border border-gray-200'>" + c + "</th>"; });
		seccion1 += "</tr></thead><tbody>" +
			filaRubro("Tareas", "tarea", false, false) +
			filaRubro("Trabajos", "actividad", false, false) +
			filaRubro("Asistencia", null, false, true) +
			filaRubro("Participación", "participacion", true, false) +
			filaRubro("Conducta", "conducta", true, false) +
			filaRubro("Examen", "examen", false, false) +
			"<tr class='bg-blue-50'><td class='px-3 py-2 font-bold text-gray-800 border border-gray-200'>Calificación Final</td>" + tablaCeldasFinal + "</tr>" +
			"</tbody></table></div>";

		// Sección 2: Cuaderno
		const cuadernoArr = (diagnostica && Array.isArray(diagnostica.cuaderno)) ? diagnostica.cuaderno : [];
		const cuadernoMap = {};
		cuadernoArr.forEach(function (it) { cuadernoMap[it.criterio] = it.semaforo; });
		let seccion2 =
			"<h3 class='font-bold text-gray-800 mb-2'>2. Revisión de cuaderno</h3>" +
			"<div class='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-6'>";
		CRITERIOS_CUADERNO.forEach(function (crit) {
			seccion2 += "<div class='flex items-center justify-between border-b border-gray-100 py-1'>" +
				"<span class='text-sm text-gray-700'>" + esc(crit) + "</span>" +
				semCirculo(cuadernoMap[crit]) + "</div>";
		});
		seccion2 += "</div>";

		// Sección 3: Habilidades básicas
		const ppm = (diagnostica && diagnostica.lectura_ppm != null) ? diagnostica.lectura_ppm : null;
		const compr = (diagnostica && diagnostica.lectura_comprension) ? diagnostica.lectura_comprension : null;
		const nivelLect = nivelVelocidad(alumno.grado, ppm);
		const matesArr = (diagnostica && Array.isArray(diagnostica.matematicas)) ? diagnostica.matematicas : [];
		const matesMap = {};
		matesArr.forEach(function (it) { matesMap[it.habilidad] = it.semaforo; });

		let seccion3 =
			"<h3 class='font-bold text-gray-800 mb-2'>3. Habilidades básicas</h3>" +
			"<div class='grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6'>" +
			"<div class='rounded-xl border border-gray-200 p-4'>" +
			"<h4 class='font-semibold text-gray-700 mb-2 text-sm'>Lectura</h4>" +
			"<div class='flex justify-between text-sm py-1 border-b border-gray-100'><span class='text-gray-600'>Velocidad (PPM)</span><span class='font-semibold'>" + (ppm != null ? ppm : "—") + "</span></div>" +
			"<div class='flex justify-between text-sm py-1 border-b border-gray-100'><span class='text-gray-600'>Nivel de velocidad</span><span class='font-semibold'>" + nivelLect + "</span></div>" +
			"<div class='flex justify-between items-center text-sm py-1'><span class='text-gray-600'>Comprensión</span>" + semCirculo(compr) + "</div>" +
			"</div>" +
			"<div class='rounded-xl border border-gray-200 p-4'>" +
			"<h4 class='font-semibold text-gray-700 mb-2 text-sm'>Matemáticas</h4>";
		HABILIDADES_MATES.forEach(function (hab) {
			seccion3 += "<div class='flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0'>" +
				"<span class='text-gray-600'>" + esc(hab) + "</span>" + semCirculo(matesMap[hab]) + "</div>";
		});
		seccion3 += "</div></div>";

		// Sección 4: Observaciones + firmas
		const obsTrabajo = (diagnostica && diagnostica.observaciones) ? diagnostica.observaciones : "";
		let seccion4 =
			"<h3 class='font-bold text-gray-800 mb-2'>4. Observaciones del docente</h3>" +
			"<div class='flex flex-col gap-3 mb-6'>" +
			"<div><label class='block text-xs font-semibold text-gray-600 mb-1'>Trabajo diario</label>" +
			"<textarea id='boletaObsTrabajo' rows='2' class='w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none'>" + esc(obsTrabajo) + "</textarea></div>" +
			"<div><label class='block text-xs font-semibold text-gray-600 mb-1'>Fortalezas</label>" +
			"<textarea id='boletaObsFortalezas' rows='2' class='w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none'></textarea></div>" +
			"<div><label class='block text-xs font-semibold text-gray-600 mb-1'>Áreas de oportunidad</label>" +
			"<textarea id='boletaObsAreas' rows='2' class='w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none'></textarea></div>" +
			"</div>" +
			"<div class='grid grid-cols-2 gap-12 mt-10 mb-2'>" +
			"<div class='text-center'><div class='border-t border-gray-400 pt-2 text-sm text-gray-600'>Docente</div></div>" +
			"<div class='text-center'><div class='border-t border-gray-400 pt-2 text-sm text-gray-600'>Padre / Tutor</div></div>" +
			"</div>";

		cont.innerHTML =
			"<div class='bg-white'>" + cabecera + seccion1 + seccion2 + seccion3 + seccion4 + "</div>";

		acciones.classList.remove("hidden");

		// Construir resumen plano para WhatsApp
		const lineCF = CAMPOS_CORTOS.map(function (corto, i) {
			return corto + ": " + fmtCal(calPorCF[CAMPOS[i]]);
		}).join(" | ");
		const asisTexto = (diasTotal > 0) ? (diasPresente + "/" + diasTotal + " días") : "—";
		boletaResumenTexto =
			"Boleta de " + (alumno.nombre_completo || "") + " — Trimestre " + trimestre + "\n" +
			lineCF + "\n" +
			"Asistencia: " + asisTexto;
	}

	// ── Botones de distribución de la boleta ──
	const boletaImprimirBtn = document.getElementById("boletaImprimirBtn");
	if (boletaImprimirBtn) {
		boletaImprimirBtn.addEventListener("click", function () {
			const el = document.getElementById("boletaContainer");
			if (!el.querySelector("table")) return;
			const alSel = document.getElementById("selectAlumnoBoleta");
			const nombre = alSel.options[alSel.selectedIndex] ? alSel.options[alSel.selectedIndex].text : "alumno";
			html2pdf().set({
				margin: 0.5,
				filename: "boleta-" + nombre.replace(/[^a-zA-Z0-9]+/g, "-") + ".pdf",
				html2canvas: { scale: 2 },
				jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
			}).from(el).save();
		});
	}

	const boletaWhatsappBtn = document.getElementById("boletaWhatsappBtn");
	if (boletaWhatsappBtn) {
		boletaWhatsappBtn.addEventListener("click", function () {
			if (!boletaResumenTexto) return;
			window.open("https://wa.me/?text=" + encodeURIComponent(boletaResumenTexto), "_blank");
		});
	}

	const boletaImagenBtn = document.getElementById("boletaImagenBtn");
	if (boletaImagenBtn) {
		boletaImagenBtn.addEventListener("click", function () {
			const el = document.getElementById("boletaContainer");
			if (!el.querySelector("table")) return;
			// html2canvas no está disponible como global; usar window.print como fallback
			if (typeof html2canvas === "function") {
				html2canvas(el, { scale: 2 }).then(function (canvas) {
					const link = document.createElement("a");
					link.download = "boleta.png";
					link.href = canvas.toDataURL("image/png");
					link.click();
				});
			} else {
				window.print();
			}
		});
	}
});
