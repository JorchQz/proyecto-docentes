document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
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
	var groupGenderCountEl = document.getElementById("groupGenderCount");
	var groupSchoolEl = document.getElementById("groupSchool");
	var groupDirectorEl = document.getElementById("groupDirector");
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
	var editGroupSchoolInput = document.getElementById("editGroupSchool");
	var editGroupDirectorInput = document.getElementById("editGroupDirector");
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
	var cancelStudentEditBtn = document.getElementById("cancelStudentEditBtn");
	// Ficha del alumno (opcional; reglas en js/ficha-alumno.js)
	var Ficha = window.FichaAlumno;
	var editStudentBirthdateInput = document.getElementById("editStudentBirthdate");
	var editStudentGenderSelect = document.getElementById("editStudentGender");
	var editStudentTutorNameInput = document.getElementById("editStudentTutorName");
	var editStudentTutorPhoneInput = document.getElementById("editStudentTutorPhone");
	var editStudentWhatsAppLink = document.getElementById("editStudentWhatsApp");
	// Columnas del alumno que lee y escribe esta pantalla (las de la ficha, desde B13)
	var ALUMNO_COLS = "id, nombre_completo, num_lista, grado, fecha_nacimiento, genero, tutor_nombre, tutor_telefono";
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
	// Trimestre actual (ver guardarTrimestre)
	var trimestreSelect = document.getElementById("trimestreActualSelect");
	var trimestreSugerenciaEl = document.getElementById("trimestreSugerencia");
	var trimestreSugerenciaTexto = document.getElementById("trimestreSugerenciaTexto");
	var trimestreSugerenciaBtn = document.getElementById("trimestreSugerenciaBtn");
	var trimestreMensajeEl = document.getElementById("trimestreMensaje");
	var guardandoTrimestre = false;

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
	bindFichaInputs();
	bindGroupActionsMenu();
	bindMainMenu();
	bindEditTabs();
	// Si una lectura falla (el grupo, la lista), la página se detiene con el aviso común
	// (js/lectura.js): nada de "Aún no hay alumnos" ni "0 alumnos" cuando no se pudo leer,
	// ni dar de alta encima de una lista que no se leyó (numeraría desde 1)
	try {
		await loadCurrentGroup();
	} catch (error) {
		window.Lectura.detenerPagina(error);
		return;
	}

	window.sb.auth.onAuthStateChange(function (event) {
		if (event === "SIGNED_OUT") {
			// Bajo /salon/ (la app instalable), al login de la app; fuera, como siempre
			window.location.href = window.AppInstalada ? window.AppInstalada.salida("index.html") : "index.html";
		}
	});

	/*
		Código muerto hoy (revisado 2026-09-25, R18): ninguna página tiene #logoutBtn desde el
		rediseño de la navegación. Cerrar sesión es el botón de la barra (#navbarLogoutBtn en
		js/navbar.js), que pide confirmar si hay capturas sin enviar y limpia el aparato
		(BandejaSalida). Se deja por si vuelve un botón propio en la página; no se agregan botones.
	*/
	if (logoutBtn) {
		logoutBtn.addEventListener("click", async function () {
			closeMainMenu();
			logoutBtn.disabled = true;
			logoutBtn.classList.add("opacity-70", "cursor-not-allowed");

			// Borra del aparato las marcas de capturas que ya no hacen falta (js/bandeja-salida.js)
			if (window.BandejaSalida && window.BandejaSalida.limpiarAlSalir) { try { await window.BandejaSalida.limpiarAlSalir(window.sb); } catch (_) { /* se sigue */ } }
			var result = await window.sb.auth.signOut();
			if (result.error) {
				showMessage("error", "No se pudo cerrar sesión: " + result.error.message);
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
			var escuela = (editGroupSchoolInput.value || "").trim();
			var director = (editGroupDirectorInput ? editGroupDirectorInput.value : "").replace(/\s+/g, " ").trim();
			var descripcion = (editGroupDescriptionInput.value || "").trim();

			if (!nombre || !tipo) {
				showMessage("error", "Nombre y tipo de organización son requeridos.");
				return;
			}

			var gradeList = getSelectedGrades();
			if (gradeList.length === 0) {
				showMessage("error", "Selecciona al menos un grado.");
				return;
			}


			setButtonLoading(saveGroupBtn, true, "Guardando...");

			try {
				var updateResult = await window.sb
					.from("grupos")
					.update({
						nombre: nombre,
						tipo_organizacion: tipo,
						grados: gradeList.map(String),
						escuela: escuela || null,
						director_nombre: director || null,
						descripcion: descripcion || null,
						es_multigrado: gradeList.length > 1,
					})
					.eq("id", currentGroup.id)
					.eq("maestro_id", userId)
					.select("id, nombre, tipo_organizacion, grados, escuela, director_nombre, descripcion, trimestre_actual")
					.single();

				if (updateResult.error) {
					throw updateResult.error;
				}

				// Se conservan las demás columnas del grupo (ciclo escolar, etc.)
				currentGroup = Object.assign({}, currentGroup, updateResult.data);
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

			var studentsCount;
			try {
				studentsCount = await countStudentsByGroupId(currentGroup.id);
			} catch (error) {
				console.error("mi-grupo: conteo antes de eliminar", error);
				showMessage("error", "No se pudo contar a los alumnos del grupo, así que no se eliminó nada. Revisa tu conexión e intenta de nuevo.");
				return;
			}
			var countText = formatStudentCount(studentsCount);
			var confirmation = await showDeleteConfirmModal(
				"Se eliminará el grupo \"" +
					(currentGroup.nombre || "Sin nombre") +
					"\" y " +
					countText +
					" asociado(s), con sus incidencias, su calendario, su rol de aseo y sus listas de cooperación y materiales. Esta acción no se puede deshacer."
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

				// Tras R20: si la maestra tiene otro grupo, se sigue con él (lo decide
				// js/grupo-activo.js); solo sin grupos se va a crear uno. Si no se pudo leer
				// cuáles quedan, Inicio lo decide al cargar (GrupoActivo.cargar).
				var siguiente = null, destino = "dashboard.html";
				try {
					siguiente = await window.GrupoActivo.trasEliminar(window.sb, userId, currentGroup.id);
					if (!siguiente) destino = "onboarding.html";
				} catch (errorSiguiente) {
					console.error("mi-grupo: grupo que sigue tras eliminar", errorSiguiente);
				}
				showMessage("success", siguiente
					? "Grupo eliminado. Ahora trabajas con «" + (siguiente.nombre || "tu otro grupo") + "»."
					: (destino === "onboarding.html" ? "Grupo eliminado. Ya no tienes grupos: vamos a crear uno." : "Grupo eliminado."));
				setTimeout(function () {
					window.location.href = destino;
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

			if (!areValidWords(lastName1, true) || (lastName2 && !areValidWords(lastName2, true))) {
				showStudentsMessage(
					"error",
					"Cada apellido solo puede contener letras, espacios, guiones y apóstrofos."
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
					showStudentsMessage("error", "Selecciona un grado válido para el alumno.");
					return;
				}
			}

			var studentName = buildFullName(lastName1, lastName2, firstNames);
 			var studentGrade = shouldCaptureStudentGrade()
				? selectedGrade
				: currentGroupGrades[0] || null;

			// alumnos.grado es obligatorio (lo necesitan boleta, fase y multigrado)
			if (!studentGrade) {
				showStudentsMessage("error", "Configura primero los grados del grupo para poder asignar el grado del alumno.");
				return;
			}

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

			// Ficha (opcional): validación suave, con el motivo y sin perder lo escrito
			var ficha = leerFicha();
			if (ficha.error) {
				showStudentsMessage("error", ficha.error);
				if (ficha.enfocar && ficha.enfocar.focus) ficha.enfocar.focus();
				return;
			}

			setButtonLoading(addStudentBtn, true, editingStudentId ? "Actualizando..." : "Agregando...");
			try {
				if (editingStudentId) {
					var updateResult = await window.sb
						.from("alumnos")
						.update(Object.assign({
							nombre_completo: studentName,
							grado: studentGrade,
						}, ficha.datos))
						.eq("id", editingStudentId)
						.eq("maestro_id", userId)
						.eq("grupo_id", currentGroup.id)
						.select(ALUMNO_COLS)
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
							Object.assign({
								maestro_id: userId,
								grupo_id: currentGroup.id,
								nombre_completo: studentName,
								grado: studentGrade,
								num_lista: nextListNumber,
								estatus: "activo",
							}, ficha.datos),
						])
						.select(ALUMNO_COLS)
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
					message += ". Verifica que exista la columna public.alumnos.grado y vuelve a cargar la página.";
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

	/*
		Trimestre actual del grupo (grupos.trimestre_actual). Antes solo se elegía en el
		onboarding: pasado noviembre, Reportes, Diagnóstico y Crear proyecto seguían abriendo
		en el trimestre 1. Se guarda al elegirlo. La fecha solo SUGIERE (calendario SEP,
		js/calendario-escolar.js): nunca se cambia sola.
		El guardado pasa por la capa común (Lectura.uno lanza si la base devuelve error) y se
		comprueba lo que la base guardó; si falla, se avisa y el selector vuelve a lo guardado.
	*/

	function trimestreGuardado() {
		var t = currentGroup ? Number(currentGroup.trimestre_actual) : NaN;
		return [1, 2, 3].indexOf(t) !== -1 ? t : null;
	}

	function mensajeTrimestre(tipo, texto) {
		if (!trimestreMensajeEl) return;
		if (!texto) { trimestreMensajeEl.textContent = ""; trimestreMensajeEl.className = "mt-3"; return; }
		trimestreMensajeEl.textContent = texto;
		trimestreMensajeEl.className = "mt-3 rounded-lg px-3 py-2 text-sm " +
			(tipo === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200");
	}

	function renderTrimestreActual() {
		if (!trimestreSelect || !currentGroup) return;
		var t = trimestreGuardado();
		trimestreSelect.value = t ? String(t) : "";
		trimestreSelect.disabled = guardandoTrimestre;
		var sug = window.CalendarioEscolar ? window.CalendarioEscolar.trimestreSugerido() : null;
		if (!sug || !trimestreSugerenciaEl) return;
		trimestreSugerenciaTexto.textContent = sug.texto + (t === sug.trimestre ? " Ya es el trimestre de tu grupo." : "");
		trimestreSugerenciaEl.classList.remove("hidden");
		if (t !== sug.trimestre) {
			trimestreSugerenciaBtn.textContent = "Cambiar al trimestre " + sug.trimestre;
			trimestreSugerenciaBtn.dataset.trimestre = String(sug.trimestre);
			trimestreSugerenciaBtn.classList.remove("hidden");
		} else {
			trimestreSugerenciaBtn.classList.add("hidden");
		}
		trimestreSugerenciaBtn.disabled = guardandoTrimestre;
	}

	async function guardarTrimestre(nuevo) {
		if (!currentGroup || guardandoTrimestre) return;
		var anterior = trimestreGuardado();
		if (nuevo === anterior) { renderTrimestreActual(); return; }
		guardandoTrimestre = true;
		mensajeTrimestre("", "");
		renderTrimestreActual();
		trimestreSelect.value = String(nuevo);
		try {
			var fila = await window.Lectura.uno(window.sb
				.from("grupos")
				.update({ trimestre_actual: nuevo })
				.eq("id", currentGroup.id)
				.eq("maestro_id", userId)
				.select("id, trimestre_actual")
				.maybeSingle());
			if (!fila || Number(fila.trimestre_actual) !== nuevo) throw new Error("la base no confirmó el cambio");
			currentGroup.trimestre_actual = nuevo;
			mensajeTrimestre("success", "Guardado: tu grupo está en el trimestre " + nuevo + ". Hoy, Inicio, Reportes, Diagnóstico y Crear proyecto ya abren en él.");
		} catch (error) {
			// El detalle técnico ("TypeError: Failed to fetch") solo va a la consola; la
			// maestra lee qué pasó y qué hacer (revisor R6)
			console.error("mi-grupo: trimestre actual", error);
			var sinRed = window.Lectura && window.Lectura.errorDeRed ? window.Lectura.errorDeRed(error) : false;
			var sigue = " Tu grupo sigue en " + (anterior ? "el trimestre " + anterior : "el trimestre que tenía") + ".";
			mensajeTrimestre("error", sinRed
				? "No se pudo guardar el trimestre porque no hay conexión." + sigue + " Revisa tu internet e intenta de nuevo."
				: "No se pudo guardar el trimestre." + sigue + " Intenta de nuevo en un momento.");
		} finally {
			guardandoTrimestre = false;
			renderTrimestreActual();
		}
	}

	if (trimestreSelect) {
		trimestreSelect.addEventListener("change", function () {
			var t = Number(trimestreSelect.value);
			if ([1, 2, 3].indexOf(t) !== -1) guardarTrimestre(t);
		});
	}
	if (trimestreSugerenciaBtn) {
		trimestreSugerenciaBtn.addEventListener("click", function () {
			var t = Number(trimestreSugerenciaBtn.dataset.trimestre);
			if ([1, 2, 3].indexOf(t) !== -1) guardarTrimestre(t);
		});
	}

	async function loadCurrentGroup() {
		// Grupo activo (con 2+ grupos se edita el que el maestro eligió en la barra)
		// Si la lectura del grupo falla, GrupoActivo.cargar detiene la página él mismo
		var activo = await window.GrupoActivo.cargar(window.sb, userId);
		if (!activo.grupo) {
			window.location.href = "onboarding.html";
			return;
		}

		currentGroup = activo.grupo;
		renderGroupInfo(currentGroup);
		syncEditForm(currentGroup);
		renderTrimestreActual();
		configureStudentGradeSelector();
		await loadStudents();
		refreshStudentsCount();
	}

	// La lista del grupo. Si no se pudo leer, LANZA (la página se detiene): una lista vacía
	// diría "Aún no hay alumnos" y el alta numeraría desde 1
	async function loadStudents() {
		if (!currentGroup || !studentsListEl) {
			return;
		}

		studentsListEl.innerHTML =
			"<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Cargando alumnos...</div>";

		students = (await window.Lectura.uno(window.sb
			.from("alumnos")
			.select(ALUMNO_COLS)
			.eq("maestro_id", userId)
			.eq("grupo_id", currentGroup.id)
			.order("num_lista", { ascending: true })
			.order("nombre_completo", { ascending: true }))) || [];
		hasStudentGradeColumn = true;
		try {
			await recalculateAndPersistListOrder();
		} catch (error) {
			showStudentsMessage(
				"error",
				"No se pudo actualizar el No. de lista alfabético: " +
					(error.message || "Error desconocido")
			);
		}
		resetStudentEditor();
		renderStudentsList();
	}

	// Conteo en la base (antes de borrar el grupo). Si no se pudo contar, LANZA: el aviso
	// de borrado decía "0 alumnos" cuando la lectura había fallado
	async function countStudentsByGroupId(groupId) {
		return window.Lectura.contar(window.sb
			.from("alumnos")
			.select("id", { count: "exact", head: true })
			.eq("grupo_id", groupId)
			.eq("maestro_id", userId));
	}

	// El total del grupo es la lista ya leída (la misma consulta: todos los alumnos del grupo)
	function refreshStudentsCount() {
		if (!groupStudentsCountEl) {
			return;
		}

		if (!currentGroup) {
			groupStudentsCountEl.textContent = "N/A";
			return;
		}

		groupStudentsCountEl.textContent = formatStudentCount(students.length);

		// Cuántas niñas y cuántos niños: solo si alguna ficha tiene el dato
		if (groupGenderCountEl) {
			var conteo = Ficha ? Ficha.conteoGenero(students) : { texto: "" };
			groupGenderCountEl.textContent = conteo.texto;
			groupGenderCountEl.classList.toggle("hidden", !conteo.texto);
		}
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
			var grades = parseGroupGrades(group.grados);
			groupGradesEl.textContent = grades.length > 0
				? grades.map(function (g) { return g + "\u00b0"; }).join(", ")
				: "N/A";
		}

		// Datos de la escuela de ESTE grupo (una maestra puede tener grupos en escuelas distintas)
		pintarDato(groupSchoolEl, group.escuela);
		pintarDato(groupDirectorEl, group.director_nombre);
	}

	// Un dato opcional del grupo: el valor, o "Sin registrar" en gris
	function pintarDato(el, valor) {
		if (!el) return;
		var hay = Boolean(valor && String(valor).trim());
		el.textContent = hay ? String(valor) : "Sin registrar";
		el.classList.toggle("text-gray-800", hay);
		el.classList.toggle("font-semibold", hay);
		el.classList.toggle("text-gray-400", !hay);
	}

	function renderStudentsList() {
		if (!studentsListEl) {
			return;
		}

		studentsListEl.innerHTML = "";
		updateStudentsCountBadge();

		if (!students.length) {
			studentsListEl.innerHTML =
				"<div class='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500'>Aún no hay alumnos en este grupo.</div>";
			return;
		}

		var table = document.createElement("div");
		table.className = "rounded-xl border border-gray-200";

		// Columnas en PC y tablet horizontal; en celular y tablet vertical cada alumno es una tarjeta (sin deslizar de lado)
		var COLUMNAS = "lg:grid-cols-[4rem_minmax(0,1fr)_3.5rem_18.5rem]";
		var header = document.createElement("div");
		header.className =
			"hidden lg:grid " + COLUMNAS + " gap-3 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 rounded-t-xl";
		header.innerHTML =
			"<span>No. lista</span><span>Nombre completo</span><span>Grado</span><span class='sr-only'>Acciones</span>";
		table.appendChild(header);

		students.forEach(function (student, indice) {
			var row = document.createElement("div");
			row.className =
				"grid grid-cols-[2.5rem_minmax(0,1fr)] " + COLUMNAS + " gap-x-3 gap-y-2 px-4 py-3 text-sm text-gray-800 items-center" +
				(indice > 0 ? " border-t border-gray-200" : " lg:border-t lg:border-gray-200");

			var listNumber = document.createElement("span");
			listNumber.className = "font-semibold";
			listNumber.textContent =
				typeof student.num_lista === "number" ? String(student.num_lista) : "-";

			// Nombre y, debajo, lo de la ficha que haya (tutor y teléfono)
			var nameCell = document.createElement("div");
			nameCell.className = "min-w-0";
			var fullName = document.createElement("p");
			fullName.className = "font-medium break-words";
			fullName.textContent = student.nombre_completo || "Alumno sin nombre";
			nameCell.appendChild(fullName);
			// En celular y tablet vertical el grado va aquí (su columna solo se ve desde 1024 px)
			var detalle = [];
			if (student.genero && Ficha) detalle.push(Ficha.etiquetaGenero(student.genero));
			if (student.tutor_nombre) detalle.push("Tutor: " + student.tutor_nombre);
			if (student.tutor_telefono && Ficha) detalle.push(Ficha.formatoTelefono(student.tutor_telefono));
			var tieneGrado = typeof student.grado === "number";
			if (detalle.length || tieneGrado) {
				var sub = document.createElement("p");
				sub.className = "text-xs text-gray-500 mt-0.5 break-words" + (detalle.length ? "" : " lg:hidden");
				if (tieneGrado) {
					var gradoCel = document.createElement("span");
					gradoCel.className = "lg:hidden";
					gradoCel.textContent = student.grado + "° grado" + (detalle.length ? " · " : "");
					sub.appendChild(gradoCel);
				}
				if (detalle.length) sub.appendChild(document.createTextNode(detalle.join(" · ")));
				nameCell.appendChild(sub);
			}

			var gradeCell = document.createElement("span");
			gradeCell.className = "hidden lg:block";
			gradeCell.textContent =
				typeof student.grado === "number" ? String(student.grado) : "-";

			var controls = document.createElement("div");
			controls.className = "col-span-2 lg:col-span-1 flex flex-wrap items-center justify-end gap-2";

			// WhatsApp al tutor (solo con teléfono válido): wa.me/52 + los 10 dígitos
			var enlace = Ficha && student.tutor_telefono
				? Ficha.enlaceWhatsApp(student.tutor_telefono, Ficha.saludoWhatsApp(nombreDocente(), student.nombre_completo))
				: "";
			if (enlace) {
				var waLink = document.createElement("a");
				waLink.href = enlace;
				waLink.target = "_blank";
				waLink.rel = "noopener noreferrer";
				waLink.className =
					"inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-sm font-medium hover:bg-emerald-100 transition-colors";
				waLink.setAttribute("aria-label", "Escribir por WhatsApp al tutor de " + (student.nombre_completo || "este alumno"));
				waLink.innerHTML =
					"<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4 shrink-0' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M7.9 20A9 9 0 1 0 4 16.1L2 22Z'/></svg>";
				var waTxt = document.createElement("span");
				waTxt.textContent = "WhatsApp";
				waLink.appendChild(waTxt);
				controls.appendChild(waLink);
			}

			var editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className =
				"inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg bg-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-200 transition-colors";
			editBtn.textContent = "Editar";
			editBtn.setAttribute("aria-label", "Editar a " + (student.nombre_completo || "este alumno"));

			var deleteBtn = document.createElement("button");
			deleteBtn.type = "button";
			deleteBtn.className =
				"inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg bg-red-100 text-red-700 text-sm font-medium hover:bg-red-200 transition-colors";
			deleteBtn.textContent = "Eliminar";
			deleteBtn.setAttribute("aria-label", "Eliminar a " + (student.nombre_completo || "este alumno"));

			editBtn.addEventListener("click", function () {
				beginEditStudent(student);
			});

			deleteBtn.addEventListener("click", async function () {
				await deleteStudent(student);
			});

			controls.appendChild(editBtn);
			controls.appendChild(deleteBtn);

			row.appendChild(listNumber);
			row.appendChild(nameCell);
			row.appendChild(gradeCell);
			row.appendChild(controls);
			table.appendChild(row);
		});

		studentsListEl.appendChild(table);
	}

	async function deleteStudent(student) {
		var confirmation = await showDeleteConfirmModal(
			"Se eliminará el alumno \"" +
				(student.nombre_completo || "Sin nombre") +
				"\" con su ficha, y se quitará de las incidencias donde aparece (las incidencias se conservan). Esta acción no se puede deshacer."
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

		llenarFicha(student);

		if (addStudentBtn) {
			addStudentBtn.textContent = "Actualizar alumno";
		}
		if (cancelStudentEditBtn) {
			cancelStudentEditBtn.classList.remove("hidden");
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
		if (cancelStudentEditBtn) {
			cancelStudentEditBtn.classList.add("hidden");
		}
		llenarFicha(null);
	}

	// ── Ficha del alumno (opcional; reglas en js/ficha-alumno.js) ──────────────
	function hoyLocalISO() {
		var ahora = new Date();
		return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
	}

	// Nombre de la maestra para el saludo de WhatsApp ("" si no lo registró)
	function nombreDocente() {
		var n = getTeacherNameFromUser(user);
		return n === "Docente" ? "" : n;
	}

	function llenarFicha(student) {
		if (editStudentBirthdateInput) editStudentBirthdateInput.value = (student && student.fecha_nacimiento) || "";
		if (editStudentGenderSelect) editStudentGenderSelect.value = (student && student.genero) || "";
		if (editStudentTutorNameInput) editStudentTutorNameInput.value = (student && student.tutor_nombre) || "";
		if (editStudentTutorPhoneInput) {
			editStudentTutorPhoneInput.value = student && student.tutor_telefono && Ficha
				? Ficha.formatoTelefono(student.tutor_telefono)
				: "";
		}
		actualizarWhatsApp();
	}

	/*
		leerFicha() → { datos, error, enfocar }
		datos: las cuatro columnas de la ficha (null si están vacías) para mandarlas junto con el
		nombre. error: por qué no se puede guardar (teléfono sin 10 dígitos, fecha fuera de lo
		razonable para primaria); lo escrito se queda en su lugar.
	*/
	function leerFicha() {
		if (!Ficha) return { datos: {}, error: "" };
		var tel = Ficha.normalizarTelefono(editStudentTutorPhoneInput ? editStudentTutorPhoneInput.value : "");
		if (!tel.ok) return { datos: {}, error: tel.error, enfocar: editStudentTutorPhoneInput };
		var fecha = editStudentBirthdateInput ? editStudentBirthdateInput.value : "";
		// Un <input type="date"> a medio llenar devuelve "" pero marca badInput
		if (!fecha && editStudentBirthdateInput && editStudentBirthdateInput.validity && editStudentBirthdateInput.validity.badInput) {
			return { datos: {}, error: "La fecha de nacimiento está incompleta: complétala o bórrala.", enfocar: editStudentBirthdateInput };
		}
		var vf = Ficha.validarFechaNacimiento(fecha, hoyLocalISO());
		if (!vf.ok) return { datos: {}, error: vf.error, enfocar: editStudentBirthdateInput };
		var genero = editStudentGenderSelect ? editStudentGenderSelect.value : "";
		if (!Ficha.generoValido(genero)) genero = "";
		var tutor = Ficha.limpiarNombreTutor(editStudentTutorNameInput ? editStudentTutorNameInput.value : "");
		return {
			error: "",
			datos: {
				fecha_nacimiento: vf.vacio ? null : fecha,
				genero: genero || null,
				tutor_nombre: tutor || null,
				tutor_telefono: tel.vacio ? null : tel.digitos,
			},
		};
	}

	// El botón de WhatsApp del editor aparece solo con un teléfono de 10 dígitos
	function actualizarWhatsApp() {
		if (!editStudentWhatsAppLink || !Ficha) return;
		var nombreAlumno = buildFullName(
			normalizeSpaces(editStudentLastName1Input ? editStudentLastName1Input.value : ""),
			normalizeSpaces(editStudentLastName2Input ? editStudentLastName2Input.value : ""),
			normalizeSpaces(editStudentFirstNamesInput ? editStudentFirstNamesInput.value : "")
		);
		var enlace = Ficha.enlaceWhatsApp(
			editStudentTutorPhoneInput ? editStudentTutorPhoneInput.value : "",
			Ficha.saludoWhatsApp(nombreDocente(), nombreAlumno)
		);
		if (enlace) {
			editStudentWhatsAppLink.href = enlace;
			editStudentWhatsAppLink.classList.remove("hidden");
		} else {
			editStudentWhatsAppLink.removeAttribute("href");
			editStudentWhatsAppLink.classList.add("hidden");
		}
	}

	function bindFichaInputs() {
		if (editStudentBirthdateInput && Ficha) {
			var lim = Ficha.limitesFecha(hoyLocalISO());
			editStudentBirthdateInput.min = lim.min;
			editStudentBirthdateInput.max = lim.max;
		}
		// El saludo de WhatsApp lleva el nombre del alumno que se está escribiendo
		[editStudentLastName1Input, editStudentLastName2Input, editStudentFirstNamesInput].forEach(function (input) {
			if (input) input.addEventListener("input", actualizarWhatsApp);
		});
		if (editStudentTutorPhoneInput) {
			editStudentTutorPhoneInput.addEventListener("input", actualizarWhatsApp);
			// Al salir del campo se deja con el formato de México ("33 1234 5678"), editable
			editStudentTutorPhoneInput.addEventListener("blur", function () {
				if (!Ficha) return;
				var tel = Ficha.normalizarTelefono(editStudentTutorPhoneInput.value);
				if (tel.ok && !tel.vacio) editStudentTutorPhoneInput.value = Ficha.formatoTelefono(tel.digitos);
				actualizarWhatsApp();
			});
		}
		if (cancelStudentEditBtn) {
			cancelStudentEditBtn.addEventListener("click", function () {
				resetStudentEditor();
				[editStudentLastName1Input, editStudentLastName2Input, editStudentFirstNamesInput].forEach(function (input) {
					if (input) input.value = "";
				});
				clearStudentsMessage();
				if (editStudentLastName1Input) editStudentLastName1Input.focus();
			});
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
			? /^[A-Za-zÑñ\-\s]+$/
			: /^[A-Za-zÑñ\-]+$/;

		return pattern.test(removeAccents(text));
	}

	function bindNameInput(input, allowSpaces, extra) {
		input.addEventListener("input", function (e) {
			if (e.isComposing) return;
			input.value = formatNameInput(input.value, allowSpaces);
			if (extra) extra();
		});
		input.addEventListener("compositionend", function () {
			input.value = formatNameInput(input.value, allowSpaces);
			if (extra) extra();
		});
	}

	function bindStudentInputRules() {
		if (editStudentLastName1Input)
			bindNameInput(editStudentLastName1Input, true, maybeExitEditModeFromBlankForm);
		if (editStudentLastName2Input)
			bindNameInput(editStudentLastName2Input, true, maybeExitEditModeFromBlankForm);
		if (editStudentFirstNamesInput)
			bindNameInput(editStudentFirstNamesInput, true, maybeExitEditModeFromBlankForm);

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
		var cleaned = removeAccents(rawValue || "")
			.replace(/[^A-Za-zÑñ\-\s]/g, "")
			.replace(/\s+/g, " ")
			.trimStart();

		if (!allowSpaces) {
			cleaned = cleaned.replace(/\s+/g, "");
		}

		return cleaned.toUpperCase();
	}

	function removeAccents(text) {
		return text.normalize("NFD").replace(/[\u0300-\u0302\u0304-\u036f]/g, "").normalize("NFC");
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

		var legacyTypeMap = { normal: "completa", multigrado: "unitaria" };
		var tipo = group.tipo_organizacion || "";
		editGroupTypeInput.value = legacyTypeMap[tipo] !== undefined ? legacyTypeMap[tipo] : tipo;

		setSelectedGrades(currentGroupGrades);
		editGroupSchoolInput.value = group.escuela || "";
		if (editGroupDirectorInput) editGroupDirectorInput.value = group.director_nombre || "";
		editGroupDescriptionInput.value = group.descripcion || "";
		updateGradesHelpText(editGroupTypeInput.value);
		configureStudentGradeSelector();
	}

	function shouldCaptureStudentGrade() {
		if (!currentGroup) {
			return false;
		}

		var tipo = currentGroup.tipo_organizacion;
		return tipo !== "completa" && tipo !== "normal" && currentGroupGrades.length > 1;
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

	function parseGroupGrades(gradesValue) {
		if (Array.isArray(gradesValue)) {
			return gradesValue
				.map(function (g) { return parseInt((g || "").toString().trim(), 10); })
				.filter(function (g) { return !isNaN(g) && g >= 1 && g <= 6; })
				.sort(function (a, b) { return a - b; });
		}
		return parseGrades(gradesValue || "");
	}

	function getSelectedGrades() {
		return Array.from(document.querySelectorAll("input[name='editGroupGrades']:checked"))
			.map(function (cb) { return parseInt(cb.value, 10); })
			.sort(function (a, b) { return a - b; });
	}

	function setSelectedGrades(grades) {
		document.querySelectorAll("input[name='editGroupGrades']").forEach(function (cb) {
			cb.checked = grades.indexOf(parseInt(cb.value, 10)) !== -1;
		});
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
				"inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors";
			tabStudentsBtn.className =
				"inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white";
			return;
		}

		editGroupDataForm.classList.remove("hidden");
		editStudentsTabPanel.classList.add("hidden");
		tabGroupBtn.className =
			"inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white";
		tabStudentsBtn.className =
			"inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors";
	}

	function bindEditGradeRules() {
		if (!editGroupTypeInput) {
			return;
		}

		var gradeMaxByTypeEdit = { unitaria: 6, bidocente: 3, tridocente: 2, tetradocente: 3, pentadocente: 2, completa: 1 };

		editGroupTypeInput.addEventListener("change", function () {
			updateGradesHelpText(editGroupTypeInput.value);
			// Al cambiar tipo, desmarcar los que excedan el nuevo límite
			var max = gradeMaxByTypeEdit[editGroupTypeInput.value] || 6;
			var checked = Array.from(document.querySelectorAll("input[name='editGroupGrades']:checked"));
			checked.slice(max).forEach(function (cb) { cb.checked = false; });
		});

		document.querySelectorAll("input[name='editGroupGrades']").forEach(function (cb) {
			cb.addEventListener("change", function () {
				var max = gradeMaxByTypeEdit[editGroupTypeInput.value] || 6;
				var checked = Array.from(document.querySelectorAll("input[name='editGroupGrades']:checked"));
				if (checked.length > max) {
					cb.checked = false;
				}
			});
		});
	}

	function updateGradesHelpText(type) {
		if (!editGroupGradesHelp) {
			return;
		}

		var messages = {
			completa:     "En organización completa, cada maestro atiende un solo grado. Selecciona el grado que tú atiendes.",
			bidocente:    "En escuelas bidocentes, generalmente cada maestro atiende 2 o 3 grados. Selecciona los grados que tú atiendes.",
			tridocente:   "En escuelas tridocentes, generalmente cada maestro atiende 2 grados. Selecciona los grados que tú atiendes.",
			tetradocente: "En escuelas tetradocentes, el maestro puede tener 1, 2 o más grados. Selecciona los grados que tú atiendes.",
			pentadocente: "En escuelas pentadocentes, generalmente un maestro atiende 2 grados. Selecciona los grados que tú atiendes.",
			unitaria:     "En escuelas unitarias, un solo maestro atiende todos los grados (1\u00b0 al 6\u00b0). Selecciona los grados que tú atiendes.",
		};

		editGroupGradesHelp.textContent = messages[type] || "Selecciona los grados que atiendes.";
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
			completa:     "Organización completa",
			bidocente:    "Bidocente",
			tridocente:   "Tridocente",
			tetradocente: "Tetradocente",
			pentadocente: "Pentadocente",
			unitaria:     "Unitaria",
			normal:       "Organización completa",
			multigrado:   "Multigrado",
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
