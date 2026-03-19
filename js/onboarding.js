document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado.");
		window.location.href = "index.html";
		return;
	}

	var groupForm = document.getElementById("groupForm");
	var studentForm = document.getElementById("studentForm");
	var completeBtn = document.getElementById("completeOnboarding");
	var backToGroupStepBtn = document.getElementById("backToGroupStep");
	var stepGroup = document.getElementById("stepGroup");
	var stepStudents = document.getElementById("stepStudents");
	var groupTypeSelect = document.getElementById("groupType");
	var groupGradeInput = document.getElementById("groupGrade");
	var groupGradeHelp = document.getElementById("groupGradeHelp");
	var studentLastName1Input = document.getElementById("studentLastName1");
	var studentLastName2Input = document.getElementById("studentLastName2");
	var studentFirstNamesInput = document.getElementById("studentFirstNames");
	var studentGradeWrapper = document.getElementById("studentGradeWrapper");
	var studentGradeSelect = document.getElementById("studentGrade");

	var currentGroupId = null;
	var currentGroupType = "";
	var currentGroupGrades = [];
	var students = [];

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var userId = sessionResult.data.session.user.id;

	bindStudentInputRules();

	if (groupTypeSelect && groupGradeHelp && groupGradeInput) {
		groupTypeSelect.addEventListener("change", function () {
			if (groupTypeSelect.value === "normal") {
				groupGradeHelp.textContent =
					"Organizacion completa: captura solo un grado de 1 a 6 (Ej: 4).";
				groupGradeInput.placeholder = "Ej: 4";
				groupGradeInput.value = sanitizeGradesByType(groupGradeInput.value, "normal");
				return;
			}

			groupGradeHelp.textContent =
				"Multigrado, bidocente y tridocente: uno o mas grados de 1 a 6 (Ej: 1,2,3).";
			groupGradeInput.placeholder = "Ej: 4,5,6";
			groupGradeInput.value = sanitizeGradesByType(
				groupGradeInput.value,
				groupTypeSelect.value
			);
		});

		groupGradeInput.addEventListener("input", function () {
			groupGradeInput.value = sanitizeGradesByType(
				groupGradeInput.value,
				groupTypeSelect.value
			);
		});
	}

	groupForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		var groupName = document.getElementById("groupName").value.trim();
		var groupType = document.getElementById("groupType").value.trim();
		var groupGrade = document.getElementById("groupGrade").value.trim();
		var groupSchool = document.getElementById("groupSchool").value.trim();
		var groupDescription = document.getElementById("groupDescription").value.trim();

		if (!groupName || !groupType || !groupGrade) {
			showMessage("groupMessage", "error", "Nombre, tipo y grados son requeridos.");
			return;
		}

		var gradeList = parseGrades(groupGrade);
		if (gradeList.length === 0) {
			showMessage(
				"groupMessage",
				"error",
				"Ingresa al menos un grado valido entre 1 y 6 (ejemplo: 4,5,6)."
			);
			return;
		}

		if (groupType === "normal" && gradeList.length !== 1) {
			showMessage(
				"groupMessage",
				"error",
				"Organizacion completa solo permite un grado."
			);
			return;
		}

		var gradoPrincipal = gradeList[0];
		var normalizedGrades = gradeList.join(",");

		setLoading(groupForm.querySelector("button"), true);

		try {
			var result = await window.sb.from("grupos").insert([
				{
					maestro_id: userId,
					nombre: groupName,
					grado: gradoPrincipal,
					tipo_organizacion: groupType,
					grados: normalizedGrades,
					escuela: groupSchool || null,
					descripcion: groupDescription || null,
					ciclo_escolar: new Date().getFullYear().toString(),
				},
			]).select();

			if (result.error) {
				throw result.error;
			}

			currentGroupId = result.data[0].id;
			currentGroupType = groupType;
			currentGroupGrades = gradeList.slice();
			configureStudentGradeSelector();
			showMessage("groupMessage", "success", "Grupo creado exitosamente.");

			setTimeout(function () {
				stepGroup.classList.add("hidden");
				stepStudents.classList.remove("hidden");
				document.getElementById("studentLastName1").focus();
			}, 800);
		} catch (error) {
			showMessage(
				"groupMessage",
				"error",
				"Error al crear grupo: " + (error.message || "Error desconocido")
			);
		} finally {
			setLoading(groupForm.querySelector("button"), false);
		}
	});

	studentForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		var lastName1 = normalizeSpaces(document.getElementById("studentLastName1").value);
		var lastName2 = normalizeSpaces(document.getElementById("studentLastName2").value);
		var firstNames = normalizeSpaces(document.getElementById("studentFirstNames").value);
		var selectedGrade = studentGradeSelect ? parseInt(studentGradeSelect.value, 10) : null;

		if (!lastName1 || !firstNames) {
			showMessage(
				"studentsMessage",
				"error",
				"Apellido paterno y nombre(s) son requeridos."
			);
			return;
		}

		if (!isSingleWord(lastName1) || (lastName2 && !isSingleWord(lastName2))) {
			showMessage(
				"studentsMessage",
				"error",
				"Cada apellido debe contener solo una palabra (sin espacios)."
			);
			return;
		}

		if (!areValidWords(firstNames, true)) {
			showMessage(
				"studentsMessage",
				"error",
				"Nombre(s) solo permite letras y espacios."
			);
			return;
		}

		if (shouldCaptureStudentGrade()) {
			if (Number.isNaN(selectedGrade) || currentGroupGrades.indexOf(selectedGrade) === -1) {
				showMessage(
					"studentsMessage",
					"error",
					"Selecciona un grado valido para el alumno."
				);
				return;
			}
		}

		var fullName = buildFullName(lastName1, lastName2, firstNames);
		var studentGrade = shouldCaptureStudentGrade() ? selectedGrade : currentGroupGrades[0] || null;
		var key = normalizeName(fullName) + "|" + String(studentGrade || "");

		var alreadyExists = students.some(function (s) {
			return s.key === key;
		});

		if (alreadyExists) {
			showMessage(
				"studentsMessage",
				"error",
				"Ese alumno ya fue agregado. Evita nombres duplicados."
			);
			return;
		}

		students.push({
			nombre_completo: fullName,
			grado: studentGrade,
			key: key,
		});

		clearMessage("studentsMessage");
		updateStudentsList();
		studentForm.reset();
		if (studentGradeSelect && studentGradeSelect.options.length > 0) {
			studentGradeSelect.value = studentGradeSelect.options[0].value;
		}
		document.getElementById("studentLastName1").focus();
	});

	completeBtn.addEventListener("click", async function () {
		if (students.length === 0) {
			showMessage("studentsMessage", "error", "Debe haber al menos 1 alumno.");
			return;
		}

		completeBtn.disabled = true;
		completeBtn.classList.add("opacity-50", "cursor-not-allowed");

		try {
			var orderedStudents = students.slice().sort(function (a, b) {
				var byName = (a.nombre_completo || "").localeCompare(
					b.nombre_completo || "",
					"es",
					{ sensitivity: "base" }
				);
				if (byName !== 0) {
					return byName;
				}

				var aGrade = typeof a.grado === "number" ? a.grado : 999;
				var bGrade = typeof b.grado === "number" ? b.grado : 999;
				return aGrade - bGrade;
			});

			var studentsForDB = orderedStudents.map(function (s, index) {
				return {
					maestro_id: userId,
					grupo_id: currentGroupId,
					nombre_completo: s.nombre_completo,
					grado: s.grado,
					num_lista: index + 1,
					estatus: "activo",
				};
			});

			var insertResult = await window.sb
				.from("alumnos")
				.insert(studentsForDB)
				.select();

			if (insertResult.error) {
				throw insertResult.error;
			}

			showMessage(
				"studentsMessage",
				"success",
				"Alumnos guardados. Redirigiendo..."
			);

			setTimeout(function () {
				window.location.href = "dashboard.html";
			}, 1500);
		} catch (error) {
			var msg = error.message || "Error desconocido";
			if ((msg || "").toLowerCase().indexOf("grado") !== -1) {
				msg +=
					". Verifica que exista la columna public.alumnos.grado (ejecuta supabase/alumnos-grado.sql).";
			}
			showMessage(
				"studentsMessage",
				"error",
				"Error al guardar alumnos: " + msg
			);
			completeBtn.disabled = false;
			completeBtn.classList.remove("opacity-50", "cursor-not-allowed");
		}
	});

	if (backToGroupStepBtn) {
		backToGroupStepBtn.addEventListener("click", function () {
			stepStudents.classList.add("hidden");
			stepGroup.classList.remove("hidden");
			clearMessage("studentsMessage");
			document.getElementById("groupName").focus();
		});
	}

	function updateStudentsList() {
		var container = document.getElementById("studentsContainer");
		var count = document.getElementById("studentCount");

		container.innerHTML = "";
		count.textContent = students.length;

		students.forEach(function (student, index) {
			var div = document.createElement("div");
			div.className = "flex items-center justify-between p-4 bg-white border border-gray-200 rounded-2xl shadow-sm";
			var gradeText =
				typeof student.grado === "number"
					? "<span class='inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 mr-2'>" +
					  student.grado +
					  "</span>"
					: "";
			div.innerHTML =
				"<span class='text-gray-800'>" +
				gradeText +
				student.nombre_completo +
				"</span>" +
				"<button type='button' class='text-red-600 hover:text-red-700 font-medium' data-index='" +
				index +
				"'>Eliminar</button>";

			var deleteBtn = div.querySelector("button");
			deleteBtn.addEventListener("click", function (e) {
				e.preventDefault();
				students.splice(index, 1);
				updateStudentsList();
			});

			container.appendChild(div);
		});

		completeBtn.disabled = students.length === 0;
		if (students.length === 0) {
			completeBtn.classList.add("opacity-50", "cursor-not-allowed");
		} else {
			completeBtn.classList.remove("opacity-50", "cursor-not-allowed");
		}
	}

	function configureStudentGradeSelector() {
		if (!studentGradeWrapper || !studentGradeSelect) {
			return;
		}

		studentGradeSelect.innerHTML = "";

		if (!shouldCaptureStudentGrade()) {
			studentGradeWrapper.classList.add("hidden");
			return;
		}

		currentGroupGrades.forEach(function (grade) {
			var option = document.createElement("option");
			option.value = String(grade);
			option.textContent = String(grade);
			studentGradeSelect.appendChild(option);
		});

		studentGradeWrapper.classList.remove("hidden");
	}

	function shouldCaptureStudentGrade() {
		return currentGroupType !== "normal" && currentGroupGrades.length > 1;
	}

	function setLoading(btn, isLoading) {
		btn.disabled = isLoading;
		if (isLoading) {
			btn.classList.add("opacity-70", "cursor-not-allowed");
			btn.textContent = "Creando...";
		} else {
			btn.classList.remove("opacity-70", "cursor-not-allowed");
			btn.textContent = "Crear Grupo";
		}
	}

	function showMessage(elementId, type, text) {
		var messageBox = document.getElementById(elementId);
		messageBox.textContent = text;
		messageBox.className =
			"rounded-lg px-4 py-3 text-sm " +
			(type === "success"
				? "bg-blue-100 text-blue-800"
				: "bg-red-100 text-red-800");
	}

	function clearMessage(elementId) {
		var messageBox = document.getElementById(elementId);
		messageBox.textContent = "";
		messageBox.className = "mt-4";
	}

	function parseGrades(gradosTexto) {
		var raw = (gradosTexto || "")
			.split(",")
			.map(function (part) {
				return part.trim();
			})
			.filter(function (part) {
				return part.length > 0;
			});

		if (raw.length === 0) {
			return [];
		}

		var parsed = raw
			.map(function (part) {
				return parseInt(part, 10);
			})
			.filter(function (value) {
				return !Number.isNaN(value) && value >= 1 && value <= 6;
			});

		if (parsed.length !== raw.length) {
			return [];
		}

		var unique = [];
		parsed.forEach(function (grade) {
			if (unique.indexOf(grade) === -1) {
				unique.push(grade);
			}
		});

		return unique.sort(function (a, b) {
			return a - b;
		});
	}

	function sanitizeGradesByType(value, groupType) {
		var raw = (value || "").replace(/[^0-9,]/g, "").replace(/,+/g, ",");

		if (groupType === "normal") {
			var first = parseGrades(raw);
			return first.length > 0 ? String(first[0]) : raw.replace(/[^0-9]/g, "").slice(0, 2);
		}

		return raw;
	}

	function buildFullName(lastName1, lastName2, firstNames) {
		var parts = [lastName1, lastName2, firstNames].filter(function (part) {
			return part && part.length > 0;
		});
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	function normalizeName(text) {
		return (text || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	function normalizeSpaces(text) {
		return (text || "").replace(/\s+/g, " ").trim();
	}

	function isSingleWord(text) {
		if (!text || text.indexOf(" ") !== -1) {
			return false;
		}
		return areValidWords(text, false);
	}

	function areValidWords(text, allowSpaces) {
		var pattern = allowSpaces
			? /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]+$/
			: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-]+$/;
		return pattern.test(text);
	}

	function bindStudentInputRules() {
		if (studentLastName1Input) {
			studentLastName1Input.addEventListener("input", function () {
				studentLastName1Input.value = formatNameInput(
					studentLastName1Input.value,
					false
				);
			});
		}

		if (studentLastName2Input) {
			studentLastName2Input.addEventListener("input", function () {
				studentLastName2Input.value = formatNameInput(
					studentLastName2Input.value,
					false
				);
			});
		}

		if (studentFirstNamesInput) {
			studentFirstNamesInput.addEventListener("input", function () {
				studentFirstNamesInput.value = formatNameInput(
					studentFirstNamesInput.value,
					true
				);
			});
		}
	}

	function formatNameInput(value, allowSpaces) {
		var clean = (value || "").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]/g, "");

		if (allowSpaces) {
			clean = clean.replace(/\s+/g, " ").replace(/^\s+/, "");
		} else {
			clean = clean.replace(/\s+/g, "");
		}

		return toTitleCase(clean);
	}

	function toTitleCase(value) {
		return (value || "")
			.toLocaleLowerCase("es-MX")
			.replace(/(^|[\s'\-])([a-záéíóúüñ])/g, function (match, separator, char) {
				return separator + char.toLocaleUpperCase("es-MX");
			});
	}
});
