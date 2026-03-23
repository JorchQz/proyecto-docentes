document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		alert("Supabase no esta configurado. Regresando al login.");
		window.location.href = "index.html";
		return;
	}

	var emailEl = document.getElementById("userEmail");
	var userNameEl = document.getElementById("userName");
	var mainMenuBtn = document.getElementById("mainMenuBtn");
	var mainMenuPanel = document.getElementById("mainMenuPanel");
	var logoutBtn = document.getElementById("logoutBtn");
	var groupMessageEl = document.getElementById("groupMessage");
	var groupNameEl = document.getElementById("groupName");
	var groupTypeEl = document.getElementById("groupType");
	var groupGradesEl = document.getElementById("groupGrades");
	var groupStudentsCountEl = document.getElementById("groupStudentsCount");
	var groupActionsBtn = document.getElementById("groupActionsBtn");
	var groupActionsMenu = document.getElementById("groupActionsMenu");
	var editGroupBtn = document.getElementById("editGroupBtn");
	var editStudentsBtn = document.getElementById("editStudentsBtn");
	var deleteGroupBtn = document.getElementById("deleteGroupBtn");
	var editGroupForm = document.getElementById("editGroupForm");
	var editGroupDataForm = document.getElementById("editGroupDataForm");
	var tabGroupBtn = document.getElementById("tabGroupBtn");
	var tabStudentsBtn = document.getElementById("tabStudentsBtn");
	var editStudentsTabPanel = document.getElementById("editStudentsTabPanel");
	var cancelEditGroupBtn = document.getElementById("cancelEditGroupBtn");
	var saveGroupBtn = document.getElementById("saveGroupBtn");
	var editGroupNameInput = document.getElementById("editGroupName");
	var editGroupTypeInput = document.getElementById("editGroupType");
	var editGroupGradesInput = document.getElementById("editGroupGrades");
	var editGroupSchoolInput = document.getElementById("editGroupSchool");
	var editGroupDescriptionInput = document.getElementById("editGroupDescription");
	var editGroupGradesHelp = document.getElementById("editGroupGradesHelp");
	var studentsMessageEl = document.getElementById("studentsMessage");
	var studentsListEl = document.getElementById("studentsList");
	var studentsCountBadgeEl = document.getElementById("studentsCountBadge");
	var editStudentLastName1Input = document.getElementById("editStudentLastName1");
	var editStudentLastName2Input = document.getElementById("editStudentLastName2");
	var editStudentFirstNamesInput = document.getElementById("editStudentFirstNames");
	var editStudentGradeWrapper = document.getElementById("editStudentGradeWrapper");
	var editStudentGradeSelect = document.getElementById("editStudentGrade");
	var addStudentBtn = document.getElementById("addStudentBtn");
	var deleteConfirmModalEl = document.getElementById("deleteConfirmModal");
	var deleteConfirmTextEl = document.getElementById("deleteConfirmText");
	var deleteConfirmBackdropEl = document.getElementById("deleteConfirmBackdrop");
	var cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
	var confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
	var currentGroup = null;
	var currentGroupGrades = [];
	var hasStudentGradeColumn = true;
	var students = [];
	var editingStudentId = null;

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var user = sessionResult.data.session.user;
	var userId = user.id;

	if (emailEl) {
		emailEl.textContent = user && user.email ? user.email : "Usuario autenticado";
	}

	if (userNameEl) {
		userNameEl.textContent = getTeacherNameFromUser(user);
	}

	bindEditGradeRules();
	bindStudentInputRules();
	bindGroupActionsMenu();
	bindMainMenu();
	bindEditTabs();
	await loadCurrentGroup();

	window.sb.auth.onAuthStateChange(function (event) {
		if (event === "SIGNED_OUT") {
			window.location.href = "index.html";
		}
	});

	if (logoutBtn) {
		logoutBtn.addEventListener("click", async function () {
			closeMainMenu();
			logoutBtn.disabled = true;
			logoutBtn.classList.add("opacity-70", "cursor-not-allowed");

			var result = await window.sb.auth.signOut();
			if (result.error) {
				showMessage("error", "No se pudo cerrar sesion: " + result.error.message);
				logoutBtn.disabled = false;
				logoutBtn.classList.remove("opacity-70", "cursor-not-allowed");
			}
		});
	}

	if (editGroupBtn && editGroupForm) {
		editGroupBtn.addEventListener("click", function () {
			if (!currentGroup) {
				return;
			}

			closeGroupActionsMenu();
			clearMessage();
			clearStudentsMessage();
			syncEditForm(currentGroup);
			editGroupForm.classList.remove("hidden");
			setEditTab("group");
			editGroupNameInput.focus();
		});
	}

	if (editStudentsBtn && editGroupForm) {
		editStudentsBtn.addEventListener("click", function () {
			if (!currentGroup) {
				return;
			}

			closeGroupActionsMenu();
			clearMessage();
			clearStudentsMessage();
			syncEditForm(currentGroup);
			editGroupForm.classList.remove("hidden");
			setEditTab("students");
			if (editStudentLastName1Input) {
				editStudentLastName1Input.focus();
			}
		});
	}

	if (cancelEditGroupBtn && editGroupForm) {
		cancelEditGroupBtn.addEventListener("click", function () {
			editGroupForm.classList.add("hidden");
			clearMessage();
			clearStudentsMessage();
		});
	}

	if (editGroupDataForm) {
		editGroupDataForm.addEventListener("submit", async function (event) {
			event.preventDefault();
			if (!currentGroup) {
				showMessage("error", "No hay grupo disponible para editar.");
				return;
			}

			var nombre = (editGroupNameInput.value || "").trim();
			var tipo = (editGroupTypeInput.value || "").trim();
			var gradosTexto = (editGroupGradesInput.value || "").trim();
			var escuela = (editGroupSchoolInput.value || "").trim();
			var descripcion = (editGroupDescriptionInput.value || "").trim();

			if (!nombre || !tipo || !gradosTexto) {
				showMessage("error", "Nombre, tipo y grados son requeridos.");
				return;
			}

			var gradeList = parseGrades(gradosTexto);
			if (gradeList.length === 0) {
				showMessage("error", "Ingresa al menos un grado valido entre 1 y 6 (ejemplo: 4,5,6).");
				return;
			}

			if (tipo === "normal" && gradeList.length !== 1) {
				showMessage("error", "Organizacion completa solo permite un grado.");
				return;
			}

			var normalizedGrades = gradeList.join(",");
			var gradoPrincipal = gradeList[0];

			setButtonLoading(saveGroupBtn, true, "Guardando...");

			try {
				var updateResult = await window.sb
					.from("grupos")
					.update({
						nombre: nombre,
						tipo_organizacion: tipo,
						grados: normalizedGrades,
						grado: gradoPrincipal,
						escuela: escuela || null,
						descripcion: descripcion || null,
					})
					.eq("id", currentGroup.id)
					.eq("maestro_id", userId)
					.select("id, nombre, tipo_organizacion, grados, escuela, descripcion")
					.single();

				if (updateResult.error) {
					throw updateResult.error;
				}

				currentGroup = updateResult.data;
				renderGroupInfo(currentGroup);
				syncEditForm(currentGroup);
				editGroupForm.classList.add("hidden");
				showMessage("success", "Grupo actualizado correctamente.");
			} catch (error) {
				showMessage(
					"error",
					"No se pudo actualizar el grupo: " + (error.message || "Error desconocido")
				);
			} finally {
				setButtonLoading(saveGroupBtn, false, "Guardar cambios");
			}
		});
	}

	if (deleteGroupBtn) {
		deleteGroupBtn.addEventListener("click", async function () {
			if (!currentGroup) {
				showMessage("error", "No hay grupo disponible para eliminar.");
				return;
			}

			closeGroupActionsMenu();

			var studentsCount = await countStudentsByGroupId(currentGroup.id);
			var countText = formatStudentCount(studentsCount);
			var confirmation = await showDeleteConfirmModal(
				"Se eliminara el grupo \"" +
					(currentGroup.nombre || "Sin nombre") +
					"\" y " +
					countText +
					" asociado(s). Esta accion no se puede deshacer."
			);
			if (!confirmation) {
				return;
			}

			setButtonLoading(deleteGroupBtn, true, "Eliminando...");
			if (editGroupBtn) {
				editGroupBtn.disabled = true;
				editGroupBtn.classList.add("opacity-70", "cursor-not-allowed");
			}

			try {
				var deleteStudentsResult = await window.sb
					.from("alumnos")
					.delete()
					.eq("grupo_id", currentGroup.id)
					.eq("maestro_id", userId);

				if (deleteStudentsResult.error) {
					throw deleteStudentsResult.error;
				}

				var deleteGroupResult = await window.sb
					.from("grupos")
					.delete()
					.eq("id", currentGroup.id)
					.eq("maestro_id", userId);

				if (deleteGroupResult.error) {
					throw deleteGroupResult.error;
				}

				showMessage("success", "Grupo eliminado. Redirigiendo a onboarding...");
				setTimeout(function () {
					window.location.href = "onboarding.html";
				}, 900);
			} catch (error) {
				showMessage(
					"error",
					"No se pudo eliminar el grupo: " + (error.message || "Error desconocido")
				);
			} finally {
				setButtonLoading(deleteGroupBtn, false, "Eliminar grupo");
				if (editGroupBtn) {
					editGroupBtn.disabled = false;
					editGroupBtn.classList.remove("opacity-70", "cursor-not-allowed");
				}
			}
		});
	}

	if (addStudentBtn) {
		addStudentBtn.addEventListener("click", async function () {

			if (!currentGroup) {
				showStudentsMessage("error", "No hay grupo activo para agregar alumnos.");
				return;
			}

			var lastName1 = normalizeSpaces(
				editStudentLastName1Input ? editStudentLastName1Input.value : ""
			);
			var lastName2 = normalizeSpaces(
				editStudentLastName2Input ? editStudentLastName2Input.value : ""
			);
			var firstNames = normalizeSpaces(
				editStudentFirstNamesInput ? editStudentFirstNamesInput.value : ""
			);
			var selectedGrade = editStudentGradeSelect
				? parseInt(editStudentGradeSelect.value, 10)
				: null;

			if (!lastName1 || !firstNames) {
				showStudentsMessage(
					"error",
					"Apellido paterno y nombre(s) son requeridos."
				);
				return;
			}

			if (!isSingleWord(lastName1) || (lastName2 && !isSingleWord(lastName2))) {
				showStudentsMessage(
					"error",
					"Cada apellido debe contener solo una palabra (sin espacios)."
				);
				return;
			}

			if (!areValidWords(firstNames, true)) {
				showStudentsMessage("error", "Nombre(s) solo permite letras y espacios.");
				return;
			}

			if (shouldCaptureStudentGrade()) {
				if (
					Number.isNaN(selectedGrade) ||
					currentGroupGrades.indexOf(selectedGrade) === -1
				) {
					showStudentsMessage("error", "Selecciona un grado valido para el alumno.");
					return;
				}
			}

			var studentName = toTitleCase(buildFullName(lastName1, lastName2, firstNames));
 			var studentGrade = shouldCaptureStudentGrade()
				? selectedGrade
				: currentGroupGrades[0] || null;

			var normalizedCandidate = normalizeName(studentName) + "|" + String(studentGrade || "");
			var duplicated = students.some(function (student) {
				return (
					(!editingStudentId || student.id !== editingStudentId) &&
					normalizeName(student.nombre_completo) + "|" + String(student.grado || "") ===
					normalizedCandidate
				);
			});

			if (duplicated) {
				showStudentsMessage("error", "Ese alumno ya existe en el grupo.");
				return;
			}

			setButtonLoading(addStudentBtn, true, editingStudentId ? "Actualizando..." : "Agregando...");
			try {
				if (editingStudentId) {
					var updateResult = await window.sb
						.from("alumnos")
						.update({
							nombre_completo: studentName,
							grado: studentGrade,
						})
						.eq("id", editingStudentId)
						.eq("maestro_id", userId)
						.eq("grupo_id", currentGroup.id)
						.select("id, nombre_completo, num_lista, grado")
						.single();

					if (updateResult.error) {
						throw updateResult.error;
					}

					students = students.map(function (student) {
						return student.id === editingStudentId ? updateResult.data : student;
					});
					showStudentsMessage("success", "Alumno actualizado correctamente.");
				} else {
					var nextListNumber = getNextListNumber();
					var insertResult = await window.sb
						.from("alumnos")
						.insert([
							{
								maestro_id: userId,
								grupo_id: currentGroup.id,
								nombre_completo: studentName,
								grado: studentGrade,
								num_lista: nextListNumber,
								estatus: "activo",
							},
						])
						.select("id, nombre_completo, num_lista, grado")
						.single();

					if (insertResult.error) {
						throw insertResult.error;
					}

					students.push(insertResult.data);
					showStudentsMessage("success", "Alumno agregado correctamente.");
				}

				hasStudentGradeColumn = true;
				await recalculateAndPersistListOrder();
				renderStudentsList();
				refreshStudentsCount();
				resetStudentEditor();
				if (editStudentLastName1Input) {
					editStudentLastName1Input.value = "";
					editStudentLastName1Input.focus();
				}
				if (editStudentLastName2Input) {
					editStudentLastName2Input.value = "";
				}
				if (editStudentFirstNamesInput) {
					editStudentFirstNamesInput.value = "";
				}
				if (editStudentGradeSelect && editStudentGradeSelect.options.length > 0) {
					editStudentGradeSelect.value = editStudentGradeSelect.options[0].value;
				}
			} catch (error) {
				var message = error.message || "Error desconocido";
				if (message.toLowerCase().indexOf("grado") !== -1) {
					hasStudentGradeColumn = false;
					message += ". Verifica que exista la columna public.alumnos.grado y vuelve a cargar la pagina.";
				}

				showStudentsMessage("error", "No se pudo guardar el alumno: " + message);
			} finally {
				setButtonLoading(
					addStudentBtn,
					false,
					editingStudentId ? "Actualizar alumno" : "+ Agregar Alumno"
				);
			}
		});
	}

	async function loadCurrentGroup() {
		var groupResult = await window.sb
			.from("grupos")
			.select("id, nombre, tipo_organizacion, grados, escuela, descripcion")
			.eq("maestro_id", userId)
			.order("id", { ascending: true })
			.limit(1);

		if (groupResult.error) {
			showMessage(
				"error",
				"No se pudo cargar el grupo: " +
					(groupResult.error.message || "Error desconocido")
			);
			return;
		}

		if (!groupResult.data || groupResult.data.length === 0) {
			window.location.href = "onboarding.html";
			return;
		}

		currentGroup = groupResult.data[0];
		renderGroupInfo(currentGroup);
		syncEditForm(currentGroup);
		configureStudentGradeSelector();
		await loadStudents();
		refreshStudentsCount();
	}

	async function loadStudents() {
		if (!currentGroup || !studentsListEl) {
			return;
		}

		studentsListEl.innerHTML =
			"<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Cargando alumnos...</div>";

		var result = await window.sb
			.from("alumnos")
			.select("id, nombre_completo, num_lista, grado")
			.eq("maestro_id", userId)
			.eq("grupo_id", currentGroup.id)
			.order("num_lista", { ascending: true })
			.order("nombre_completo", { ascending: true });

		if (result.error && (result.error.message || "").toLowerCase().indexOf("grado") !== -1) {
			hasStudentGradeColumn = false;
			result = await window.sb
				.from("alumnos")
				.select("id, nombre_completo, num_lista")
				.eq("maestro_id", userId)
				.eq("grupo_id", currentGroup.id)
				.order("num_lista", { ascending: true })
				.order("nombre_completo", { ascending: true });
		} else {
			hasStudentGradeColumn = true;
		}

		if (result.error) {
			students = [];
			renderStudentsList();
			showStudentsMessage(
				"error",
				"No se pudo cargar la lista de alumnos: " +
					(result.error.message || "Error desconocido")
			);
			return;
		}

		students = result.data || [];
		try {
			await recalculateAndPersistListOrder();
		} catch (error) {
			showStudentsMessage(
				"error",
				"No se pudo actualizar el No. de lista alfabetico: " +
					(error.message || "Error desconocido")
			);
		}
		resetStudentEditor();
		renderStudentsList();
	}

	async function countStudentsByGroupId(groupId) {
		if (!groupId) {
			return 0;
		}

		var countResult = await window.sb
			.from("alumnos")
			.select("id", { count: "exact", head: true })
			.eq("grupo_id", groupId)
			.eq("maestro_id", userId);

		if (countResult.error) {
			return 0;
		}

		return typeof countResult.count === "number" ? countResult.count : 0;
	}

	async function refreshStudentsCount() {
		if (!groupStudentsCountEl) {
			return;
		}

		if (!currentGroup) {
			groupStudentsCountEl.textContent = "N/A";
			return;
		}

		groupStudentsCountEl.textContent = "Cargando...";
		var total = await countStudentsByGroupId(currentGroup.id);
		groupStudentsCountEl.textContent = formatStudentCount(total);
	}

	function formatStudentCount(total) {
		if (typeof total !== "number") {
			return "0 alumnos";
		}

		return total === 1 ? "1 alumno" : total + " alumnos";
	}

	function renderGroupInfo(group) {
		if (!group) {
			return;
		}

		if (groupNameEl) {
			groupNameEl.textContent = group.nombre || "Sin nombre";
		}

		if (groupTypeEl) {
			groupTypeEl.textContent = mapGroupType(group.tipo_organizacion);
		}

		if (groupGradesEl) {
			groupGradesEl.textContent = group.grados || "N/A";
		}
	}

	function renderStudentsList() {
		if (!studentsListEl) {
			return;
		}

		studentsListEl.innerHTML = "";
		updateStudentsCountBadge();

		if (!students.length) {
			studentsListEl.innerHTML =
				"<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Aun no hay alumnos en este grupo.</div>";
			return;
		}

		var table = document.createElement("div");
		table.className = "overflow-x-auto rounded-xl border border-gray-200";

		var header = document.createElement("div");
		header.className =
			"grid grid-cols-[90px_minmax(260px,1fr)_90px_120px] gap-3 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600";
		header.innerHTML =
			"<span>No. lista</span><span>Nombre completo</span><span>Grado</span><span></span>";
		table.appendChild(header);

		students.forEach(function (student) {
			var row = document.createElement("div");
			row.className =
				"grid grid-cols-[90px_minmax(260px,1fr)_90px_120px] gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-800 items-center";

			var listNumber = document.createElement("span");
			listNumber.className = "font-semibold";
			listNumber.textContent =
				typeof student.num_lista === "number" ? String(student.num_lista) : "-";

			var fullName = document.createElement("span");
			fullName.textContent = student.nombre_completo || "Alumno sin nombre";

			var gradeCell = document.createElement("span");
			gradeCell.textContent =
				typeof student.grado === "number" ? String(student.grado) : "-";

			var editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className =
				"inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-200 transition-colors";
			editBtn.textContent = "Editar";

			var deleteBtn = document.createElement("button");
			deleteBtn.type = "button";
			deleteBtn.className =
				"inline-flex items-center justify-center px-3 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-medium hover:bg-red-200 transition-colors ml-2";
			deleteBtn.textContent = "Eliminar";

			editBtn.addEventListener("click", function () {
				beginEditStudent(student);
			});

			deleteBtn.addEventListener("click", async function () {
				await deleteStudent(student);
			});

			var controls = document.createElement("div");
			controls.className = "flex items-center justify-end";
			controls.appendChild(editBtn);
			controls.appendChild(deleteBtn);

			row.appendChild(listNumber);
			row.appendChild(fullName);
			row.appendChild(gradeCell);
			row.appendChild(controls);
			table.appendChild(row);
		});

		studentsListEl.appendChild(table);
	}

	async function deleteStudent(student) {
		var confirmation = await showDeleteConfirmModal(
			"Se eliminara el alumno \"" +
				(student.nombre_completo || "Sin nombre") +
				"\". Esta accion no se puede deshacer."
		);

		if (!confirmation) {
			return;
		}

		try {
			var deleteAttendanceResult = await window.sb
				.from("asistencias")
				.delete()
				.eq("alumno_id", student.id)
				.eq("maestro_id", userId)
				.eq("grupo_id", currentGroup.id);

			if (deleteAttendanceResult.error) {
				throw deleteAttendanceResult.error;
			}

			var deleteResult = await window.sb
				.from("alumnos")
				.delete()
				.eq("id", student.id)
				.eq("maestro_id", userId)
				.eq("grupo_id", currentGroup.id);

			if (deleteResult.error) {
				throw deleteResult.error;
			}

			students = students.filter(function (item) {
				return item.id !== student.id;
			});
			if (editingStudentId === student.id) {
				resetStudentEditor();
			}
			await recalculateAndPersistListOrder();
			renderStudentsList();
			refreshStudentsCount();
			showStudentsMessage("success", "Alumno eliminado correctamente.");
		} catch (error) {
			showStudentsMessage(
				"error",
				"No se pudo eliminar el alumno: " + (error.message || "Error desconocido")
			);
		}
	}

	function updateStudentsCountBadge() {
		if (!studentsCountBadgeEl) {
			return;
		}

		studentsCountBadgeEl.textContent = formatStudentCount(students.length);
	}

	function sortStudents() {
		students.sort(function (a, b) {
			return (a.nombre_completo || "").localeCompare(b.nombre_completo || "", "es", {
				sensitivity: "base",
			});
		});
	}

	function beginEditStudent(student) {
		if (!student) {
			return;
		}

		editingStudentId = student.id;
		var nameParts = splitStudentNameForEditor(student.nombre_completo || "");

		if (editStudentLastName1Input) {
			editStudentLastName1Input.value = nameParts.lastName1;
		}
		if (editStudentLastName2Input) {
			editStudentLastName2Input.value = nameParts.lastName2;
		}
		if (editStudentFirstNamesInput) {
			editStudentFirstNamesInput.value = nameParts.firstNames;
		}

		if (
			editStudentGradeSelect &&
			typeof student.grado === "number" &&
			Array.from(editStudentGradeSelect.options).some(function (option) {
				return option.value === String(student.grado);
			})
		) {
			editStudentGradeSelect.value = String(student.grado);
		}

		if (addStudentBtn) {
			addStudentBtn.textContent = "Actualizar alumno";
		}

		showStudentsMessage("success", "Editando alumno. Actualiza los datos y confirma.");
		if (editStudentLastName1Input) {
			editStudentLastName1Input.focus();
		}
	}

	function splitStudentNameForEditor(fullName) {
		var normalized = normalizeSpaces(fullName);
		if (!normalized) {
			return { lastName1: "", lastName2: "", firstNames: "" };
		}

		var parts = normalized.split(" ");
		if (parts.length === 1) {
			return { lastName1: parts[0], lastName2: "", firstNames: "" };
		}

		if (parts.length === 2) {
			return { lastName1: parts[0], lastName2: "", firstNames: parts[1] };
		}

		return {
			lastName1: parts[0],
			lastName2: parts[1],
			firstNames: parts.slice(2).join(" "),
		};
	}

	function resetStudentEditor() {
		editingStudentId = null;
		if (addStudentBtn) {
			addStudentBtn.textContent = "+ Agregar Alumno";
		}
	}

	async function recalculateAndPersistListOrder() {
		sortStudents();

		for (var i = 0; i < students.length; i += 1) {
			var expectedNumber = i + 1;
			if (students[i].num_lista === expectedNumber) {
				continue;
			}

			var updateResult = await window.sb
				.from("alumnos")
				.update({ num_lista: expectedNumber })
				.eq("id", students[i].id)
				.eq("maestro_id", userId)
				.eq("grupo_id", currentGroup.id);

			if (updateResult.error) {
				throw updateResult.error;
			}

			students[i].num_lista = expectedNumber;
		}
	}

	function getNextListNumber() {
		if (!students.length) {
			return 1;
		}

		var max = students.reduce(function (acc, student) {
			var value = typeof student.num_lista === "number" ? student.num_lista : 0;
			return Math.max(acc, value);
		}, 0);

		return max + 1;
	}

	function normalizeSpaces(text) {
		return (text || "").replace(/\s+/g, " ").trim();
	}

	function normalizeName(text) {
		return normalizeSpaces(text)
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();
	}

	function buildFullName(lastName1, lastName2, firstNames) {
		var parts = [lastName1, lastName2, firstNames].filter(function (part) {
			return Boolean(part);
		});

		return normalizeSpaces(parts.join(" "));
	}

	function isSingleWord(text) {
		if (!text || text.indexOf(" ") !== -1) {
			return false;
		}

		return areValidWords(text, false);
	}

	function areValidWords(text, allowSpaces) {
		if (!text) {
			return false;
		}

		var pattern = allowSpaces
			? /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]+$/
			: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-]+$/;

		return pattern.test(text);
	}

	function bindStudentInputRules() {
		if (editStudentLastName1Input) {
			editStudentLastName1Input.addEventListener("input", function () {
				editStudentLastName1Input.value = formatNameInput(
					editStudentLastName1Input.value,
					false
				);
				maybeExitEditModeFromBlankForm();
			});
		}

		if (editStudentLastName2Input) {
			editStudentLastName2Input.addEventListener("input", function () {
				editStudentLastName2Input.value = formatNameInput(
					editStudentLastName2Input.value,
					false
				);
				maybeExitEditModeFromBlankForm();
			});
		}

		if (editStudentFirstNamesInput) {
			editStudentFirstNamesInput.addEventListener("input", function () {
				editStudentFirstNamesInput.value = formatNameInput(
					editStudentFirstNamesInput.value,
					true
				);
				maybeExitEditModeFromBlankForm();
			});
		}

		if (editStudentGradeSelect) {
			editStudentGradeSelect.addEventListener("change", function () {
				maybeExitEditModeFromBlankForm();
			});
		}
	}

	function maybeExitEditModeFromBlankForm() {
		if (!editingStudentId) {
			return;
		}

		if (!isStudentFormEmpty()) {
			return;
		}

		resetStudentEditor();
		clearStudentsMessage();
	}

	function isStudentFormEmpty() {
		var lastName1 = normalizeSpaces(
			editStudentLastName1Input ? editStudentLastName1Input.value : ""
		);
		var lastName2 = normalizeSpaces(
			editStudentLastName2Input ? editStudentLastName2Input.value : ""
		);
		var firstNames = normalizeSpaces(
			editStudentFirstNamesInput ? editStudentFirstNamesInput.value : ""
		);

		return !lastName1 && !lastName2 && !firstNames;
	}

	function formatNameInput(rawValue, allowSpaces) {
		var cleaned = (rawValue || "")
			.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\s]/g, "")
			.replace(/\s+/g, " ")
			.trimStart();

		if (!allowSpaces) {
			cleaned = cleaned.replace(/\s+/g, "");
		}

		return toTitleCase(cleaned);
	}

	function toTitleCase(value) {
		return (value || "")
			.toLocaleLowerCase("es-MX")
			.replace(/(^|[\s'\-])([a-záéíóúüñ])/g, function (match, separator, char) {
				return separator + char.toLocaleUpperCase("es-MX");
			});
	}

	function showStudentsMessage(type, text) {
		if (!studentsMessageEl) {
			return;
		}

		studentsMessageEl.textContent = text;
		studentsMessageEl.className =
			"mt-4 rounded-lg px-4 py-3 text-sm " +
			(type === "success" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800");
	}

	function clearStudentsMessage() {
		if (!studentsMessageEl) {
			return;
		}

		studentsMessageEl.textContent = "";
		studentsMessageEl.className = "mt-4";
	}

	function syncEditForm(group) {
		if (!group || !editGroupForm) {
			return;
		}

		currentGroupGrades = parseGroupGrades(group.grados);

		editGroupNameInput.value = group.nombre || "";
		editGroupTypeInput.value = group.tipo_organizacion || "multigrado";
		editGroupGradesInput.value = group.grados || "";
		editGroupSchoolInput.value = group.escuela || "";
		editGroupDescriptionInput.value = group.descripcion || "";
		updateGradesHelpText(editGroupTypeInput.value);
		configureStudentGradeSelector();
	}

	function shouldCaptureStudentGrade() {
		if (!currentGroup) {
			return false;
		}

		return currentGroup.tipo_organizacion !== "normal" && currentGroupGrades.length > 1;
	}

	function configureStudentGradeSelector() {
		if (!editStudentGradeWrapper || !editStudentGradeSelect) {
			return;
		}

		editStudentGradeSelect.innerHTML = "";

		if (!shouldCaptureStudentGrade()) {
			editStudentGradeWrapper.classList.add("hidden");
			return;
		}

		currentGroupGrades.forEach(function (grade) {
			var option = document.createElement("option");
			option.value = String(grade);
			option.textContent = String(grade);
			editStudentGradeSelect.appendChild(option);
		});

		editStudentGradeWrapper.classList.remove("hidden");
	}

	function parseGroupGrades(gradesText) {
		return parseGrades(gradesText || "");
	}

	function bindEditTabs() {
		if (!tabGroupBtn || !tabStudentsBtn) {
			return;
		}

		tabGroupBtn.addEventListener("click", function () {
			setEditTab("group");
		});

		tabStudentsBtn.addEventListener("click", function () {
			setEditTab("students");
		});
	}

	function setEditTab(tab) {
		if (!editGroupDataForm || !editStudentsTabPanel || !tabGroupBtn || !tabStudentsBtn) {
			return;
		}

		if (tab === "students") {
			configureStudentGradeSelector();
			editGroupDataForm.classList.add("hidden");
			editStudentsTabPanel.classList.remove("hidden");
			tabGroupBtn.className =
				"inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors";
			tabStudentsBtn.className =
				"inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white";
			return;
		}

		editGroupDataForm.classList.remove("hidden");
		editStudentsTabPanel.classList.add("hidden");
		tabGroupBtn.className =
			"inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white";
		tabStudentsBtn.className =
			"inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors";
	}

	function bindEditGradeRules() {
		if (!editGroupTypeInput || !editGroupGradesInput) {
			return;
		}

		editGroupTypeInput.addEventListener("change", function () {
			updateGradesHelpText(editGroupTypeInput.value);
			editGroupGradesInput.value = sanitizeGradesByType(
				editGroupGradesInput.value,
				editGroupTypeInput.value
			);
		});

		editGroupGradesInput.addEventListener("input", function () {
			editGroupGradesInput.value = sanitizeGradesByType(
				editGroupGradesInput.value,
				editGroupTypeInput.value
			);
		});
	}

	function updateGradesHelpText(type) {
		if (!editGroupGradesHelp) {
			return;
		}

		if (type === "normal") {
			editGroupGradesHelp.textContent =
				"Organizacion completa: captura solo un grado de 1 a 6 (Ej: 4).";
			editGroupGradesInput.placeholder = "Ej: 4";
			return;
		}

		editGroupGradesHelp.textContent =
			"Multigrado, bidocente y tridocente: uno o mas grados de 1 a 6 (Ej: 1,2,3).";
		editGroupGradesInput.placeholder = "Ej: 4,5,6";
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

	function showMessage(type, text) {
		if (!groupMessageEl) {
			return;
		}

		groupMessageEl.textContent = text;
		groupMessageEl.className =
			"mb-6 rounded-lg px-4 py-3 text-sm " +
			(type === "success" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800");
	}

	function clearMessage() {
		if (!groupMessageEl) {
			return;
		}
		groupMessageEl.textContent = "";
		groupMessageEl.className = "mb-6";
	}

	function mapGroupType(groupType) {
		var typeMap = {
			multigrado: "Multigrado",
			bidocente: "Bidocente",
			tridocente: "Tridocente",
			normal: "Organización Completa",
		};

		return typeMap[groupType] || groupType || "N/A";
	}

	function setButtonLoading(button, isLoading, loadingText) {
		if (!button) {
			return;
		}

		if (!button.dataset.defaultText) {
			button.dataset.defaultText = button.textContent;
		}

		button.disabled = isLoading;
		if (isLoading) {
			button.classList.add("opacity-70", "cursor-not-allowed");
			button.textContent = loadingText;
			return;
		}

		button.classList.remove("opacity-70", "cursor-not-allowed");
		button.textContent = button.dataset.defaultText;
	}

	function bindGroupActionsMenu() {
		if (!groupActionsBtn || !groupActionsMenu) {
			return;
		}

		groupActionsBtn.addEventListener("click", function (event) {
			event.stopPropagation();
			groupActionsMenu.classList.toggle("hidden");
		});

		document.addEventListener("click", function (event) {
			if (!groupActionsMenu.classList.contains("hidden")) {
				var clickInsideMenu = groupActionsMenu.contains(event.target);
				var clickInsideButton = groupActionsBtn.contains(event.target);

				if (!clickInsideMenu && !clickInsideButton) {
					closeGroupActionsMenu();
				}
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				closeGroupActionsMenu();
			}
		});
	}

	function closeGroupActionsMenu() {
		if (!groupActionsMenu) {
			return;
		}

		groupActionsMenu.classList.add("hidden");
	}

	function bindMainMenu() {
		if (!mainMenuBtn || !mainMenuPanel) {
			return;
		}

		mainMenuBtn.addEventListener("click", function (event) {
			event.stopPropagation();
			mainMenuPanel.classList.toggle("hidden");
		});

		document.addEventListener("click", function (event) {
			if (!mainMenuPanel.classList.contains("hidden")) {
				var clickInsideMenu = mainMenuPanel.contains(event.target);
				var clickInsideButton = mainMenuBtn.contains(event.target);

				if (!clickInsideMenu && !clickInsideButton) {
					closeMainMenu();
				}
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				closeMainMenu();
			}
		});
	}

	function closeMainMenu() {
		if (!mainMenuPanel) {
			return;
		}
		mainMenuPanel.classList.add("hidden");
	}

	function getTeacherNameFromUser(userData) {
		if (!userData || !userData.user_metadata) {
			return "Docente";
		}

		var name =
			userData.user_metadata.nombre_docente || userData.user_metadata.full_name || "";

		return (name || "").trim() || "Docente";
	}

	function showDeleteConfirmModal(message) {
		if (
			!deleteConfirmModalEl ||
			!deleteConfirmTextEl ||
			!cancelDeleteBtn ||
			!confirmDeleteBtn
		) {
			return Promise.resolve(false);
		}

		return new Promise(function (resolve) {
			var resolved = false;

			function finish(result) {
				if (resolved) {
					return;
				}
				resolved = true;
				cleanup();
				deleteConfirmModalEl.classList.add("hidden");
				resolve(result);
			}

			function onCancelClick() {
				finish(false);
			}

			function onConfirmClick() {
				finish(true);
			}

			function onBackdropClick() {
				finish(false);
			}

			function onKeyDown(event) {
				if (event.key === "Escape") {
					finish(false);
				}
			}

			function cleanup() {
				cancelDeleteBtn.removeEventListener("click", onCancelClick);
				confirmDeleteBtn.removeEventListener("click", onConfirmClick);
				if (deleteConfirmBackdropEl) {
					deleteConfirmBackdropEl.removeEventListener("click", onBackdropClick);
				}
				document.removeEventListener("keydown", onKeyDown);
			}

			deleteConfirmTextEl.textContent = message;
			deleteConfirmModalEl.classList.remove("hidden");
			confirmDeleteBtn.focus();

			cancelDeleteBtn.addEventListener("click", onCancelClick);
			confirmDeleteBtn.addEventListener("click", onConfirmClick);
			if (deleteConfirmBackdropEl) {
				deleteConfirmBackdropEl.addEventListener("click", onBackdropClick);
			}
			document.addEventListener("keydown", onKeyDown);
		});
	}
});
