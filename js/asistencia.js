document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		showMessage("error", "Supabase no esta configurado.");
		return;
	}

	var attendanceDateInput = document.getElementById("attendanceDateInput");
	var attendanceDateEl = document.getElementById("attendanceDate");
	var attendanceSummaryEl = document.getElementById("attendanceSummary");
	var attendanceListEl = document.getElementById("attendanceList");
	var attendanceMessageEl = document.getElementById("attendanceMessage");
	var markAllPresentBtn = document.getElementById("markAllPresentBtn");
	var clearAllBtn = document.getElementById("clearAllBtn");

	var currentUserId = null;
	var currentGroup = null;
	var students = [];
	var attendanceMap = {};
	var todayIso = getLocalDateISO(new Date());
	var attendanceDateIso = todayIso;
	var autosaveTimer = null;
	var saveInProgress = false;
	var hasPendingAutosave = false;
	var minAttendanceDateIso = null;


	if (attendanceDateInput) {
		attendanceDateInput.value = attendanceDateIso;
		attendanceDateInput.max = todayIso;
		attendanceDateInput.addEventListener("change", async function () {
			attendanceDateIso = attendanceDateInput.value;
			if (attendanceDateEl) {
				attendanceDateEl.textContent = formatDateForUI(attendanceDateIso);
			}
			attendanceListEl.innerHTML = "<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Cargando alumnos...</div>";
			attendanceMap = {}; // Limpiar mapa al cambiar de fecha
			await loadStudents();
			await loadAttendanceOfSelectedDate();
			renderList();
			updateSummary();
		});
	}
	if (attendanceDateEl) {
		attendanceDateEl.textContent = formatDateForUI(attendanceDateIso);
	}

	try {
		var sessionResult = await window.sb.auth.getSession();
		if (sessionResult.error || !sessionResult.data.session) {
			window.location.href = "index.html";
			return;
		}

		currentUserId = sessionResult.data.session.user.id;
		await loadCurrentGroup();
		await loadStudents();
		await fetchMinAttendanceDate();
		try {
			await loadAttendanceOfSelectedDate();
		} catch (attendanceError) {
			attendanceMap = {};
			showMessage(
				"info",
				"La tabla asistencias aun no esta disponible. Puedes ejecutar el SQL y despues guardar."
			);
		}
		renderList();
		updateSummary();
		bindActions();
	async function fetchMinAttendanceDate() {
		if (!currentGroup) {
			minAttendanceDateIso = null;
			return;
		}
		var result = await window.sb
			.from("asistencias")
			.select("fecha")
			.eq("grupo_id", currentGroup.id)
			.order("fecha", { ascending: true })
			.limit(1);
		if (result.error || !result.data || !result.data.length) {
			minAttendanceDateIso = null;
			return;
		}
		minAttendanceDateIso = result.data[0].fecha;
	}
	} catch (error) {
		showMessage(
			"error",
			"No se pudo inicializar asistencia: " +
				(error && error.message ? error.message : "Error desconocido")
		);
		if (attendanceSummaryEl) {
			attendanceSummaryEl.textContent = "No se pudo cargar la asistencia.";
		}
	}

	async function loadCurrentGroup() {
		var groupResult = await window.sb
			.from("grupos")
			.select("id, nombre")
			.eq("maestro_id", currentUserId)
			.order("id", { ascending: true })
			.limit(1);

		if (groupResult.error) {
			throw groupResult.error;
		}

		if (!groupResult.data || groupResult.data.length === 0) {
			window.location.href = "onboarding.html";
			return;
		}

		currentGroup = groupResult.data[0];
	}

	async function loadStudents() {
		var studentsResult = await window.sb
			.from("alumnos")
			.select("id, nombre_completo, num_lista")
			.eq("maestro_id", currentUserId)
			.eq("grupo_id", currentGroup.id)
			.order("num_lista", { ascending: true })
			.order("nombre_completo", { ascending: true });

		if (studentsResult.error) {
			throw studentsResult.error;
		}

		students = studentsResult.data || [];
	}

	async function loadAttendanceOfSelectedDate() {
		if (!students.length) {
			attendanceMap = {};
			return;
		}

		var attendanceResult = await window.sb
			.from("asistencias")
			.select("alumno_id, asistencia_estado")
			.eq("maestro_id", currentUserId)
			.eq("grupo_id", currentGroup.id)
			.eq("fecha", attendanceDateIso);

		if (attendanceResult.error) {
			throw attendanceResult.error;
		}

		attendanceMap = {};
		if (attendanceResult.data && attendanceResult.data.length > 0) {
			(attendanceResult.data || []).forEach(function (row) {
				attendanceMap[row.alumno_id] = row.asistencia_estado || "ausente";
			});
		}
	}

	function isTodaySelected() {
		return attendanceDateIso === todayIso;
	}

	function bindActions() {
		if (markAllPresentBtn) {
			markAllPresentBtn.addEventListener("click", function () {
				students.forEach(function (student) {
					attendanceMap[student.id] = isTodaySelected() ? "presente" : "justificada";
				});
				renderList();
				updateSummary();
				scheduleAutosave();
			});
		}

		if (clearAllBtn) {
			clearAllBtn.addEventListener("click", function () {
				students.forEach(function (student) {
					attendanceMap[student.id] = "ausente";
				});
				renderList();
				updateSummary();
				scheduleAutosave();
			});
		}
	}

	function renderList() {
		if (!attendanceListEl) {
			return;
		}

		attendanceListEl.innerHTML = "";

		if (!students.length) {
			attendanceListEl.innerHTML =
				"<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>No hay alumnos en este grupo. Agrega alumnos en Mi grupo.</div>";
			return;
		}

		students.forEach(function (student) {
			var estado = (attendanceMap && Object.prototype.hasOwnProperty.call(attendanceMap, student.id)) ? attendanceMap[student.id] : "ausente";
			var row = document.createElement("label");
			row.className =
				"flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors";

			var left = document.createElement("div");
			left.className = "flex items-center gap-3 min-w-0";

			var numberBadge = document.createElement("span");
			numberBadge.className =
				"inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-100 px-2 text-xs font-semibold text-gray-700";
			numberBadge.textContent =
				typeof student.num_lista === "number" ? String(student.num_lista) : "-";

			var name = document.createElement("span");
			name.className = "truncate text-sm md:text-base text-gray-800";
			name.textContent = student.nombre_completo || "Alumno sin nombre";

			left.appendChild(numberBadge);
			left.appendChild(name);

			var toggle = document.createElement("input");
			toggle.type = "checkbox";
			toggle.className =
				"h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500";

			if (isTodaySelected()) {
				toggle.checked = estado === "presente";
				toggle.setAttribute("aria-label", "Asistencia de " + (student.nombre_completo || "alumno"));
				row.appendChild(left);
				row.appendChild(toggle);
			} else {
				toggle.checked = estado === "justificada";
				toggle.setAttribute("aria-label", "Justificar falta de " + (student.nombre_completo || "alumno"));
				var justifyLabel = document.createElement("span");
				justifyLabel.className = "ml-2 text-xs text-blue-700 font-medium";
				justifyLabel.textContent = "Justificar falta";
				var right = document.createElement("div");
				right.className = "flex items-center gap-2";
				right.appendChild(toggle);
				right.appendChild(justifyLabel);
				row.appendChild(left);
				row.appendChild(right);
			}

			toggle.addEventListener("change", function () {
				if (isTodaySelected()) {
					attendanceMap[student.id] = toggle.checked ? "presente" : "ausente";
				} else {
					attendanceMap[student.id] = toggle.checked ? "justificada" : "ausente";
				}
				updateSummary();
				scheduleAutosave();
			});

			attendanceListEl.appendChild(row);
		});
	}

	function updateSummary() {
		if (!attendanceSummaryEl) {
			return;
		}

		var total = students.length;
		var present = 0, absent = 0, justified = 0;
		students.forEach(function (student) {
			var estado = attendanceMap[student.id] || "ausente";
			if (estado === "presente") present++;
			else if (estado === "justificada") justified++;
			else absent++;
		});
		var groupName = currentGroup && currentGroup.nombre ? currentGroup.nombre : "Grupo activo";
		
		var summaryText = groupName + " | Presentes: " + present + " | Faltas: " + absent;
		if (!isTodaySelected()) {
			summaryText += " | Justificadas: " + justified;
		}
		summaryText += " | Total: " + total;
		attendanceSummaryEl.textContent = summaryText;
	}

	function scheduleAutosave() {
		if (!currentGroup || !students.length) {
			return;
		}

		if (autosaveTimer) {
			clearTimeout(autosaveTimer);
		}

		autosaveTimer = setTimeout(function () {
			saveAttendance();
		}, 400);
	}

	async function saveAttendance() {
		if (!currentGroup) {
			showMessage("error", "No hay grupo activo para guardar asistencia.");
			return;
		}

		if (!students.length) {
			showMessage("error", "No hay alumnos para guardar asistencia.");
			return;
		}

		if (saveInProgress) {
			hasPendingAutosave = true;
			return;
		}

		saveInProgress = true;

		try {
			var rows = students.map(function (student) {
				return {
					maestro_id: currentUserId,
					grupo_id: currentGroup.id,
					alumno_id: student.id,
					fecha: attendanceDateIso,
					asistencia_estado: attendanceMap[student.id] || "ausente",
				};
			});

			var saveResult = await window.sb
				.from("asistencias")
				.upsert(rows, { onConflict: "grupo_id,alumno_id,fecha" })
				.select("id");

			if (saveResult.error) {
				throw saveResult.error;
			}

			clearMessage();
		} catch (error) {
			showMessage(
				"error",
				"No se pudo guardar la asistencia: " +
					(error && error.message ? error.message : "Error desconocido") +
					". Verifica que exista la tabla asistencias en Supabase."
			);
		} finally {
			saveInProgress = false;
			if (hasPendingAutosave) {
				hasPendingAutosave = false;
				scheduleAutosave();
			}
		}
	}

	function showMessage(type, text) {
		if (!attendanceMessageEl) {
			return;
		}

		attendanceMessageEl.textContent = text;
		attendanceMessageEl.classList.remove("hidden", "bg-red-100", "text-red-800", "bg-green-100", "text-green-800", "bg-blue-100", "text-blue-800");

		if (type === "success") {
			attendanceMessageEl.classList.add("bg-green-100", "text-green-800");
			return;
		}

		if (type === "info") {
			attendanceMessageEl.classList.add("bg-blue-100", "text-blue-800");
			return;
		}

		attendanceMessageEl.classList.add("bg-red-100", "text-red-800");
	}

	function clearMessage() {
		if (!attendanceMessageEl) {
			return;
		}

		attendanceMessageEl.textContent = "";
		attendanceMessageEl.classList.add("hidden");
		attendanceMessageEl.classList.remove(
			"bg-red-100",
			"text-red-800",
			"bg-green-100",
			"text-green-800",
			"bg-blue-100",
			"text-blue-800"
		);
	}

	function getLocalDateISO(date) {
		var year = date.getFullYear();
		var month = String(date.getMonth() + 1).padStart(2, "0");
		var day = String(date.getDate()).padStart(2, "0");
		return year + "-" + month + "-" + day;
	}

	function formatDateForUI(dateIso) {
		var parts = (dateIso || "").split("-");
		if (parts.length !== 3) {
			return "--/--/----";
		}

		return parts[2] + "/" + parts[1] + "/" + parts[0];
	}
});
