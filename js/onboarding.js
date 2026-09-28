document.addEventListener("DOMContentLoaded", async function () {
	if (!window.sb) {
		window.location.href = "index.html";
		return;
	}

	document.getElementById('btnCerrarSesionOnboarding')
		?.addEventListener('click', async function () {
			// Como la barra (js/navbar.js): si hay capturas de Hoy sin enviar en este aparato, se
			// avisa y se pide confirmar; luego se borran del aparato las marcas de capturas que ya
			// no hacen falta (js/bandeja-salida.js, cargado en onboarding.html)
			if (window.BandejaSalida && window.BandejaSalida.confirmarSalida && !(await window.BandejaSalida.confirmarSalida(window.sb))) return;
			if (window.BandejaSalida && window.BandejaSalida.limpiarAlSalir) { try { await window.BandejaSalida.limpiarAlSalir(window.sb); } catch (_) { /* se sigue */ } }
			await window.sb.auth.signOut();
			window.location.href = 'index.html';
		});

	var groupForm = document.getElementById("groupForm");
	var studentForm = document.getElementById("studentForm");
	var completeBtn = document.getElementById("completeOnboarding");
	var backToGroupStepBtn = document.getElementById("backToGroupStep");
	var stepGroup = document.getElementById("stepGroup");
	var stepStudents = document.getElementById("stepStudents");
	var groupTypeSelect = document.getElementById("groupType");
	var groupGradeContainer = document.getElementById("groupGradeCheckboxes");
	var groupGradeCheckboxes = document.querySelectorAll('input[name="groupGrades"]');
	var groupGradeHelp = document.getElementById("groupGradeHelp");
	var studentLastName1Input = document.getElementById("studentLastName1");
	var studentLastName2Input = document.getElementById("studentLastName2");
	var studentFirstNamesInput = document.getElementById("studentFirstNames");
	var studentGradeWrapper = document.getElementById("studentGradeWrapper");
	var studentGradeButtons = document.getElementById("studentGradeButtons");
	var studentSubmitBtn = document.getElementById("studentSubmit");
	var studentCancelEditBtn = document.getElementById("studentCancelEdit");
	var studentFormTitle = document.getElementById("studentFormTitle");

	var cicloInicioSelect = document.getElementById("cicloInicio");
	var cicloFinSelect = document.getElementById("cicloFin");
	var trimestreActualSelect = document.getElementById("trimestreActual");
	var entidadSelect = document.getElementById("entidadDocente");
	if (window.Entidades) window.Entidades.llenarSelect(entidadSelect, "");

	var currentGroupId = null;
	var currentGroupType = "";
	var currentGroupGrades = [];
	var students = [];
	/*
		Formulario "Uno por uno" (Jorge, 2026-09-27):
		  - gradoElegido: el grado marcado en los botones. Después de agregar a un alumno se queda
		    (la docente puede registrar por grado sin cambiarlo cada vez).
		  - editando: el alumno de la lista que se está corrigiendo (lápiz); al guardar se actualiza
		    en su lugar y la lista se reordena. gradoAntesDeEditar: el grado que estaba elegido antes
		    de editar, para volver a él al terminar.
		  - ultimoKey: el alumno recién agregado o corregido, resaltado en la lista (se ordena sola
		    y así se ve dónde quedó).
	*/
	var gradoElegido = null;
	var editando = null;
	var gradoAntesDeEditar = null;
	var ultimoKey = null;
	// Íconos de la lista (SVG en línea, trazo estilo Lucide: pencil y trash-2)
	var ICONO_LAPIZ = "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" +
		"<path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>";
	var ICONO_BASURA = "<svg xmlns='http://www.w3.org/2000/svg' class='h-5 w-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" +
		"<path d='M3 6h18'/><path d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'/><path d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'/><line x1='10' x2='10' y1='11' y2='17'/><line x1='14' x2='14' y1='11' y2='17'/></svg>";

	// Poblar selects de ciclo escolar
	var currentYear = new Date().getFullYear();
	for (var y = currentYear - 4; y <= currentYear + 3; y++) {
		var opt1 = document.createElement("option");
		opt1.value = y;
		opt1.textContent = y;
		cicloInicioSelect.appendChild(opt1);

		var opt2 = document.createElement("option");
		opt2.value = y;
		opt2.textContent = y;
		cicloFinSelect.appendChild(opt2);
	}
	// El ciclo escolar en México empieza a fines de agosto: de agosto a diciembre se
	// propone año-año+1 (sept. de 2026 → 2026-2027); de enero a julio, año-1-año.
	var inicioCiclo = new Date().getMonth() >= 7 ? currentYear : currentYear - 1;
	cicloInicioSelect.value = inicioCiclo;
	cicloFinSelect.value = inicioCiclo + 1;

	var sessionResult = await window.sb.auth.getSession();
	if (sessionResult.error || !sessionResult.data.session) {
		window.location.href = "index.html";
		return;
	}

	var userId = sessionResult.data.session.user.id;

	/*
		Modo "grupo nuevo" (onboarding.html?nuevo=1, desde Mi grupo → Crear otro grupo): una
		docente puede tener grupos en escuelas distintas (Jorge, 2026-09-26). Es la misma alta:
		inserta un grupo NUEVO (nunca toca los que ya tiene), lo deja como grupo activo
		(GrupoActivo.elegir) y al terminar abre Ponte al día (si el trimestre ya empezó) o Inicio. Solo cambian los textos y hay un
		enlace para volver sin crear nada.
	*/
	if (/[?&]nuevo=1\b/.test(window.location.search)) {
		var tituloEl = document.getElementById("onboardingTitulo");
		var subtituloEl = document.getElementById("onboardingSubtitulo");
		var volverEl = document.getElementById("onboardingVolver");
		if (tituloEl) tituloEl.textContent = "Crear otro grupo";
		if (subtituloEl) subtituloEl.textContent = "Tus grupos actuales no cambian: este se agrega y queda como tu grupo activo. Después cambias de grupo con el selector de grupo del menú.";
		if (volverEl) volverEl.classList.remove("hidden");
		document.title = "Crear otro grupo — Jissez";
	}

	/*
		Entidad del docente (decisión 21): se guarda en perfiles.estado. Si ya la había
		elegido (un segundo grupo), queda propuesta.
		lectura-opcional: solo propone lo que ya guardó; si falla, el selector queda en
		"Elige tu estado", el docente lo elige y se guarda lo que elija. No se afirma nada.
	*/
	var perfilEntidad = await window.sb.from("perfiles").select("estado").eq("id", userId).maybeSingle();
	var entidadGuardada = perfilEntidad && !perfilEntidad.error && perfilEntidad.data ? (perfilEntidad.data.estado || "") : "";
	if (window.Entidades && entidadGuardada) window.Entidades.llenarSelect(entidadSelect, entidadGuardada);

	bindStudentInputRules();

	var gradeMaxByType = { unitaria: 6, bidocente: 3, tridocente: 2, tetradocente: 3, pentadocente: 2, completa: 1 };
	var gradeHelpByType = {
		unitaria:     "Unitaria: atiendes todos los grados; selecciona los que tienes.",
		bidocente:    "Bidocente: selecciona hasta 3 grados.",
		tridocente:   "Tridocente: selecciona hasta 2 grados.",
		tetradocente: "Tetradocente: selecciona hasta 3 grados.",
		pentadocente: "Pentadocente: selecciona hasta 2 grados.",
		completa:     "Organización Completa: selecciona solo 1 grado.",
	};

	if (groupTypeSelect && groupGradeHelp && groupGradeContainer) {
		groupTypeSelect.addEventListener("change", function () {
			var type = groupTypeSelect.value;

			// Desmarcar todos al cambiar tipo
			groupGradeCheckboxes.forEach(function (cb) {
				cb.checked = false;
				cb.disabled = !type;
			});

			if (type) {
				groupGradeContainer.classList.remove("opacity-40", "pointer-events-none");
				groupGradeHelp.textContent = gradeHelpByType[type] || "";
			} else {
				groupGradeContainer.classList.add("opacity-40", "pointer-events-none");
				groupGradeHelp.textContent = "Primero selecciona el tipo de organización.";
			}
		});

		groupGradeCheckboxes.forEach(function (cb) {
			cb.addEventListener("change", function () {
				var type = groupTypeSelect.value;
				var max = gradeMaxByType[type] || 6;
				var checked = Array.from(groupGradeCheckboxes).filter(function (c) { return c.checked; });
				if (checked.length > max) {
					cb.checked = false;
				}
			});
		});
	}

	/*
		Registro histórico (spec de Jorge del 2026-09-26, §4.1): dos formas de agregar alumnos,
		"Pegar la lista" (Excel, Word o WhatsApp; js/lista-pegada.js con las reglas de
		js/historico.js) y "Uno por uno" (el formulario de siempre). Las dos llenan la misma lista
		`students` (y su borrador en el aparato); "Completar configuración" la guarda igual.
		Si el trimestre del grupo ya empezó, el alta es el paso 1 de "Ponte al día" y al terminar se
		abre el asistente (ponte-al-dia.html) en vez de Inicio; se puede saltar desde ahí.
	*/
	var modoPegarBtn = document.getElementById("modoPegar");
	var modoUnoBtn = document.getElementById("modoUno");
	var panelPegar = document.getElementById("panelPegar");
	var panelUno = document.getElementById("panelUno");
	function modoAlta(pegar) {
		if (!panelPegar || !panelUno) return;
		panelPegar.classList.toggle("hidden", !pegar);
		panelUno.classList.toggle("hidden", pegar);
		[[modoPegarBtn, pegar], [modoUnoBtn, !pegar]].forEach(function (x) {
			if (!x[0]) return;
			x[0].setAttribute("aria-selected", x[1] ? "true" : "false");
			x[0].className = "min-h-[44px] px-4 rounded-xl text-sm font-semibold " + (x[1] ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200");
		});
	}
	if (modoPegarBtn) modoPegarBtn.addEventListener("click", function () { modoAlta(true); });
	if (modoUnoBtn) modoUnoBtn.addEventListener("click", function () { modoAlta(false); document.getElementById("studentLastName1").focus(); });

	function montarListaPegada() {
		var cont = document.getElementById("pegarListaCont");
		if (!cont || !window.ListaPegada || !window.Historico) {
			// Sin el componente, solo "Uno por uno"
			modoAlta(false);
			if (modoPegarBtn) modoPegarBtn.classList.add("hidden");
			return;
		}
		var lista = window.ListaPegada.montar(cont, {
			grados: shouldCaptureStudentGrade() ? currentGroupGrades : currentGroupGrades.slice(0, 1),
			existentes: function () { return students.map(function (s) { return s.nombre_completo; }); },
			textoBoton: function (n) { return "Agregar " + n + (n === 1 ? " alumno" : " alumnos") + " a la lista"; },
			alConfirmar: async function (filas) {
				var nuevos = 0;
				filas.forEach(function (f) {
					var grado = shouldCaptureStudentGrade() ? f.grado : (currentGroupGrades[0] || null);
					var key = normalizeName(f.nombre_completo) + "|" + String(grado || "");
					if (students.some(function (s) { return s.key === key; })) return;
					// Las partes que la docente revisó al pegar: con ellas se edita con el lápiz
					var partes = f.apellido1 !== undefined || f.nombres !== undefined
						? { apellido1: f.apellido1 || "", apellido2: f.apellido2 || "", nombres: f.nombres || "" } : null;
					students.push({ nombre_completo: f.nombre_completo, grado: grado, key: key, partes: partes });
					nuevos++;
				});
				ultimoKey = null;
				updateStudentsList();
				lista.limpiar();
				showMessage("studentsMessage", "success", nuevos + (nuevos === 1 ? " alumno agregado" : " alumnos agregados") +
					" a la lista. Revísala abajo y presiona «Completar configuración».");
				var destinoLista = document.getElementById("studentsList");
				if (destinoLista && destinoLista.scrollIntoView) destinoLista.scrollIntoView({ behavior: "smooth", block: "start" });
			},
		});
	}

	// ¿El trimestre del grupo ya empezó? Entonces el alta es el paso 1 de "Ponte al día"
	function hoyLocal() {
		var d = new Date();
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function ofrecePonteAlDia() {
		if (!window.Historico) return false;
		var t = parseInt(trimestreActualSelect.value, 10) || 1;
		var hoy = hoyLocal();
		return window.Historico.ofrecerPonteAlDia(hoy, { inicio: window.Historico.inicioDelTrimestre(t, hoy) });
	}
	function pintarAvisoPonte() {
		var aviso = document.getElementById("ponteAviso");
		if (aviso) aviso.classList.toggle("hidden", !ofrecePonteAlDia());
	}

	// ¿Quedó un alta a medias en este aparato? Se ofrece continuarla (después de conectar el
	// tipo de organización: llenar el formulario lo usa)
	ofrecerBorrador();

	groupForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		var groupName = document.getElementById("groupName").value.trim();
		var groupType = document.getElementById("groupType").value.trim();
		var groupSchool = document.getElementById("groupSchool").value.trim();
		var cicloInicio = parseInt(cicloInicioSelect.value, 10);
		var cicloFin = parseInt(cicloFinSelect.value, 10);
		var entidad = entidadSelect ? entidadSelect.value : "";

		var gradeList = Array.from(groupGradeCheckboxes)
			.filter(function (cb) { return cb.checked; })
			.map(function (cb) { return parseInt(cb.value, 10); })
			.sort(function (a, b) { return a - b; });

		if (!entidad || !window.Entidades || !window.Entidades.esValida(entidad)) {
			showMessage("groupMessage", "error", "Elige el estado donde das clases.");
			if (entidadSelect) entidadSelect.focus();
			return;
		}

		if (!groupName || !groupType) {
			showMessage("groupMessage", "error", "Nombre y tipo de organización son requeridos.");
			return;
		}

		if (gradeList.length === 0) {
			showMessage("groupMessage", "error", "Selecciona al menos un grado.");
			return;
		}

		if (cicloFin <= cicloInicio) {
			showMessage("groupMessage", "error", "El año de fin del ciclo debe ser mayor al año de inicio.");
			return;
		}

		var max = gradeMaxByType[groupType] || 6;
		if (gradeList.length > max) {
			showMessage("groupMessage", "error", "Has seleccionado más grados de los permitidos para este tipo de organización.");
			return;
		}

		var isEditing = currentGroupId !== null;

		setLoading(groupForm.querySelector("button"), true);

		try {
			// Primero la entidad: es obligatoria. Si no se guarda, tampoco el grupo
			if (entidad !== entidadGuardada) {
				var resEntidad = await window.Entidades.guardar(window.sb, userId, entidad);
				if (resEntidad.error) {
					console.error("onboarding: entidad", resEntidad.error);
					var errEntidad = new Error("No se pudo guardar tu estado. Revisa tu conexión e intenta de nuevo.");
					errEntidad.humano = true;
					throw errEntidad;
				}
				entidadGuardada = entidad;
			}

			var trimestre = parseInt(trimestreActualSelect.value, 10) || 1;

			var payload = {
				nombre: groupName,
				tipo_organizacion: groupType,
				grados: gradeList,
				escuela: groupSchool || null,
				ciclo_escolar: cicloInicio + "-" + cicloFin,
				es_multigrado: gradeList.length > 1,
				trimestre_actual: trimestre,
			};

			var result;
			if (isEditing) {
				result = await window.sb.from("grupos").update(payload).eq("id", currentGroupId).select();
			} else {
				payload.maestro_id = userId;
				result = await window.sb.from("grupos").insert([payload]).select();
			}

			if (result.error) {
				throw result.error;
			}

			if (!isEditing) {
				currentGroupId = result.data[0].id;
				// El grupo recién creado queda como grupo activo: al terminar, Inicio abre
				// este y no el que estaba antes (js/grupo-activo.js decide)
				if (window.GrupoActivo) window.GrupoActivo.elegir(currentGroupId);
			}
			currentGroupType = groupType;
			currentGroupGrades = gradeList.slice();
			// Alumnos de un borrador recuperado: en un grupo de un solo grado, van a ese grado
			if (!shouldCaptureStudentGrade()) {
				students.forEach(function (s) { s.grado = currentGroupGrades[0] || null; s.key = normalizeName(s.nombre_completo) + "|" + String(s.grado || ""); });
			}
			configureStudentGradeSelector();
			updateStudentsList();
			guardarBorrador();
			montarListaPegada();
			pintarAvisoPonte();
			showMessage("groupMessage", "success", isEditing ? "Grupo actualizado exitosamente." : "Grupo creado exitosamente.");

			setTimeout(function () {
				stepGroup.classList.add("hidden");
				stepStudents.classList.remove("hidden");
				var pegar = panelPegar && !panelPegar.classList.contains("hidden") ? panelPegar.querySelector("textarea") : null;
				(pegar || document.getElementById("studentLastName1")).focus();
			}, 800);
		} catch (error) {
			showMessage(
				"groupMessage",
				"error",
				error && error.humano ? error.message : "Error al guardar grupo: " + (error.message || "Error desconocido")
			);
		} finally {
			setLoading(groupForm.querySelector("button"), false);
		}
	});

	studentForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		// MAYÚSCULAS con acentos y Ñ (js/nombres-alumno.js)
		var lastName1 = normalizeSpaces(document.getElementById("studentLastName1").value).toUpperCase();
		var lastName2 = normalizeSpaces(document.getElementById("studentLastName2").value).toUpperCase();
		var firstNames = normalizeSpaces(document.getElementById("studentFirstNames").value).toUpperCase();
		var selectedGrade = gradoElegido === null ? NaN : Number(gradoElegido);

		if (!lastName1 || !firstNames) {
			showMessage(
				"studentsMessage",
				"error",
				"Apellido paterno y nombre(s) son requeridos."
			);
			return;
		}

		if (!areValidWords(lastName1, true) || (lastName2 && !areValidWords(lastName2, true))) {
			showMessage(
				"studentsMessage",
				"error",
				"Cada apellido solo puede contener letras (con acentos y Ñ), espacios y guiones."
			);
			return;
		}

		if (!areValidWords(firstNames, true)) {
			showMessage(
				"studentsMessage",
				"error",
				"Nombre(s) solo permite letras (con acentos y Ñ), espacios y guiones."
			);
			return;
		}

		if (shouldCaptureStudentGrade()) {
			if (Number.isNaN(selectedGrade) || currentGroupGrades.indexOf(selectedGrade) === -1) {
				showMessage(
					"studentsMessage",
					"error",
					"Selecciona un grado válido para el alumno."
				);
				return;
			}
		}

		var fullName = buildFullName(lastName1, lastName2, firstNames);
		var studentGrade = shouldCaptureStudentGrade() ? selectedGrade : currentGroupGrades[0] || null;
		var key = normalizeName(fullName) + "|" + String(studentGrade || "");

		// Al editar, el propio alumno no cuenta como duplicado
		var alreadyExists = students.some(function (s) {
			return s !== editando && s.key === key;
		});

		if (alreadyExists) {
			showMessage(
				"studentsMessage",
				"error",
				"Ese alumno ya fue agregado. Evita nombres duplicados."
			);
			return;
		}

		var partes = { apellido1: lastName1, apellido2: lastName2, nombres: firstNames };
		if (editando) {
			// Se corrige en su lugar; la lista se reordena sola al pintarse
			editando.nombre_completo = fullName;
			editando.grado = studentGrade;
			editando.key = key;
			editando.partes = partes;
			terminarEdicion();
			ultimoKey = key;
			showMessage("studentsMessage", "success", "Cambios guardados en la lista.");
		} else {
			students.push({
				nombre_completo: fullName,
				grado: studentGrade,
				key: key,
				partes: partes,
			});
			ultimoKey = key;
			clearMessage("studentsMessage");
		}

		updateStudentsList();
		// Se limpian los nombres; el grado se queda para el siguiente alumno
		limpiarNombresFormulario();
		document.getElementById("studentLastName1").focus();
	});

	// ── Grado con botones, editar y cancelar (formulario "Uno por uno") ──────────
	if (studentGradeButtons) {
		studentGradeButtons.addEventListener("click", function (e) {
			var btn = e.target.closest("button[data-grado]");
			if (!btn) return;
			gradoElegido = Number(btn.dataset.grado);
			pintarBotonesGrado();
		});
	}
	if (studentCancelEditBtn) {
		studentCancelEditBtn.addEventListener("click", function () {
			terminarEdicion();
			limpiarNombresFormulario();
			clearMessage("studentsMessage");
			updateStudentsList();
			document.getElementById("studentLastName1").focus();
		});
	}

	function limpiarNombresFormulario() {
		[studentLastName1Input, studentLastName2Input, studentFirstNamesInput].forEach(function (input) {
			if (input) input.value = "";
		});
	}

	// Las partes del nombre para el formulario: las que se capturaron (o se revisaron al pegar);
	// si no las hay (una lista recuperada del borrador), se separan con la regla de la lista
	// pegada (js/historico.js: "DE LA CRUZ" es un apellido)
	function partesDe(student) {
		if (student.partes) return student.partes;
		if (window.Historico && window.Historico.separar) return window.Historico.separar(student.nombre_completo || "", "apellidos");
		var p = normalizeSpaces(student.nombre_completo).split(" ");
		return p.length < 3
			? { apellido1: p[0] || "", apellido2: "", nombres: p.slice(1).join(" ") }
			: { apellido1: p[0], apellido2: p[1], nombres: p.slice(2).join(" ") };
	}

	function empezarEdicion(student) {
		// El formulario vive en "Uno por uno": también se editan los que llegaron pegados
		modoAlta(false);
		if (!editando) gradoAntesDeEditar = gradoElegido;
		editando = student;
		ultimoKey = null; // solo se resalta el que se está editando
		var p = partesDe(student);
		studentLastName1Input.value = normalizeSpaces(p.apellido1);
		studentLastName2Input.value = normalizeSpaces(p.apellido2);
		studentFirstNamesInput.value = normalizeSpaces(p.nombres);
		if (currentGroupGrades.indexOf(Number(student.grado)) !== -1) gradoElegido = Number(student.grado);
		pintarBotonesGrado();
		if (studentSubmitBtn) studentSubmitBtn.textContent = "Guardar cambios";
		if (studentCancelEditBtn) studentCancelEditBtn.classList.remove("hidden");
		if (studentFormTitle) studentFormTitle.textContent = "Editar alumno";
		showMessage("studentsMessage", "success", "Corrige lo que haga falta y presiona «Guardar cambios».");
		updateStudentsList();
		if (panelUno && panelUno.scrollIntoView) panelUno.scrollIntoView({ behavior: "smooth", block: "start" });
		studentLastName1Input.focus({ preventScroll: true });
	}

	function terminarEdicion() {
		if (editando && gradoAntesDeEditar !== null && currentGroupGrades.indexOf(Number(gradoAntesDeEditar)) !== -1) {
			gradoElegido = gradoAntesDeEditar;
		}
		editando = null;
		gradoAntesDeEditar = null;
		pintarBotonesGrado();
		if (studentSubmitBtn) studentSubmitBtn.textContent = "+ Agregar alumno";
		if (studentCancelEditBtn) studentCancelEditBtn.classList.add("hidden");
		if (studentFormTitle) studentFormTitle.textContent = "Agregar Alumno Individual";
	}

	completeBtn.addEventListener("click", async function () {
		if (students.length === 0) {
			showMessage("studentsMessage", "error", "Debe haber al menos 1 alumno.");
			return;
		}

		completeBtn.disabled = true;
		completeBtn.classList.add("opacity-50", "cursor-not-allowed");

		try {
			// Número de lista con la regla única (js/orden-lista.js): por grado y, dentro, orden
			// alfabético; corre 1..N sobre todo el grupo (el mismo que se ve en la lista)
			var studentsForDB = window.OrdenLista.numerar(students).map(function (s) {
				return {
					maestro_id: userId,
					grupo_id: currentGroupId,
					nombre_completo: s.nombre_completo,
					grado: s.grado,
					num_lista: s.num_lista,
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

			// Crear ajustes con la ponderación por defecto de la BD (DEFAULT de cada
			// peso_*; la asistencia no pondera). Silencioso, no bloquea si falla.
			await window.sb.from("maestro_ajustes").upsert({
				maestro_id: userId,
			}, { onConflict: "maestro_id", ignoreDuplicates: true });

			showMessage(
				"studentsMessage",
				"success",
				"Alumnos guardados. Redirigiendo..."
			);

			// Terminó el alta: la raíz y el login la regresan a Mi Salón (el candado ya
			// confirmó el acceso para llegar aquí)
			if (window.Secciones) window.Secciones.guardarUltima("salon");
			// La lista ya está en la base: el borrador de este aparato ya no hace falta
			if (window.AltaBorrador) window.AltaBorrador.borrar(userId);

			// Trimestre ya empezado: sigue "Ponte al día" (paso 2, asistencia pasada); se puede saltar.
			// Su avance queda desde ya (ponte_al_dia, mi_salon_b20): si se cierra la pestaña, Inicio lo
			// ofrece para retomarlo. Si no se pudo guardar, el asistente lo crea al abrirse.
			var ofrece = ofrecePonteAlDia();
			var destino = ofrece ? "ponte-al-dia.html?desde=alta" : "dashboard.html";
			if (ofrece) {
				var avance = await window.sb.from("ponte_al_dia").upsert({
					maestro_id: userId, grupo_id: currentGroupId, estado: "en_curso", paso: 2, pasos_hechos: [1],
				}, { onConflict: "grupo_id" });
				if (avance.error) console.error("onboarding: avance de Ponte al día", avance.error);
			}
			setTimeout(function () {
				window.location.href = destino;
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
			var submitBtn = groupForm.querySelector("button");
			if (submitBtn) {
				submitBtn.textContent = currentGroupId ? "Guardar cambios" : "Crear Grupo";
			}
			document.getElementById("groupName").focus();
		});
	}

	function updateStudentsList() {
		var container = document.getElementById("studentsContainer");
		var count = document.getElementById("studentCount");

		container.innerHTML = "";
		count.textContent = students.length;

		// Se ordena sola con la regla única (js/orden-lista.js): por grado y orden alfabético; el
		// número de la izquierda es el número de lista que se guardará (1..N en todo el grupo)
		if (window.OrdenLista) students = window.OrdenLista.ordenar(students);
		var multigrado = shouldCaptureStudentGrade();

		students.forEach(function (student, index) {
			var div = document.createElement("div");
			var resalte = student === editando ? "border-blue-400 ring-2 ring-blue-200 bg-white"
				: (student.key === ultimoKey ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white");
			div.className = "flex items-center gap-2 sm:gap-3 pl-3 pr-1 py-1 border rounded-2xl shadow-sm " + resalte;

			var numSpan = document.createElement("span");
			numSpan.className = "w-7 shrink-0 text-right text-base font-semibold text-gray-900 tabular-nums";
			numSpan.textContent = String(index + 1);
			// El nombre va por textContent (no innerHTML) para no ejecutar HTML
			// aunque el nombre lo escriba el usuario.
			var nombreSpan = document.createElement("span");
			nombreSpan.className = "min-w-0 flex-1 break-words text-gray-800";
			nombreSpan.textContent = student.nombre_completo || "";
			div.appendChild(numSpan);
			div.appendChild(nombreSpan);
			if (multigrado && typeof student.grado === "number") {
				var gradoSpan = document.createElement("span");
				gradoSpan.className = "shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700";
				gradoSpan.textContent = student.grado + "°";
				div.appendChild(gradoSpan);
			}

			var nombre = student.nombre_completo || "este alumno";
			var editarBtn = botonIcono("Editar", "Editar a " + nombre, ICONO_LAPIZ,
				"text-blue-700 hover:bg-blue-50 focus:ring-blue-500");
			editarBtn.addEventListener("click", function (e) {
				e.preventDefault();
				empezarEdicion(student);
			});
			var quitarBtn = botonIcono("Quitar", "Quitar a " + nombre, ICONO_BASURA,
				"text-red-600 hover:bg-red-50 focus:ring-red-500");
			quitarBtn.addEventListener("click", function (e) {
				e.preventDefault();
				var i = students.indexOf(student);
				if (i !== -1) students.splice(i, 1);
				if (student === editando) {
					terminarEdicion();
					limpiarNombresFormulario();
					clearMessage("studentsMessage");
				}
				updateStudentsList();
			});
			div.appendChild(editarBtn);
			div.appendChild(quitarBtn);

			container.appendChild(div);
		});

		completeBtn.disabled = students.length === 0;
		if (students.length === 0) {
			completeBtn.classList.add("opacity-50", "cursor-not-allowed");
		} else {
			completeBtn.classList.remove("opacity-50", "cursor-not-allowed");
		}
		guardarBorrador();
	}

	// ── Borrador en este aparato (js/alta-borrador.js) ───────────────────────────
	// Lo capturado del grupo (el formulario) y la lista de alumnos, por si se cierra la pestaña
	function datosFormularioGrupo() {
		return {
			nombre: document.getElementById("groupName").value,
			tipo: groupTypeSelect ? groupTypeSelect.value : "",
			grados: Array.from(groupGradeCheckboxes).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; }),
			escuela: document.getElementById("groupSchool").value,
			cicloInicio: cicloInicioSelect.value,
			cicloFin: cicloFinSelect.value,
			trimestre: trimestreActualSelect.value,
		};
	}

	function guardarBorrador() {
		if (!window.AltaBorrador) return;
		window.AltaBorrador.guardar(userId, { grupoId: currentGroupId, grupo: datosFormularioGrupo(), alumnos: students });
	}

	function llenarFormularioGrupo(g) {
		if (!g) return;
		if (g.nombre) document.getElementById("groupName").value = g.nombre;
		if (g.escuela) document.getElementById("groupSchool").value = g.escuela;
		if (g.cicloInicio) cicloInicioSelect.value = String(g.cicloInicio);
		if (g.cicloFin) cicloFinSelect.value = String(g.cicloFin);
		if (g.trimestre) trimestreActualSelect.value = String(g.trimestre);
		if (g.tipo && groupTypeSelect) {
			groupTypeSelect.value = g.tipo;
			groupTypeSelect.dispatchEvent(new Event("change")); // habilita las casillas de grado
		}
		var grados = (g.grados || []).map(String);
		groupGradeCheckboxes.forEach(function (cb) { cb.checked = grados.indexOf(cb.value) !== -1; });
	}

	// Al volver: se ofrece la lista que quedó a medias
	function ofrecerBorrador() {
		if (!window.AltaBorrador) return;
		var b = window.AltaBorrador.leer(userId);
		var banner = document.getElementById("borradorAlta");
		if (!b || !banner) return;
		var n = (b.alumnos || []).length;
		var cuando = new Date(b.guardado);
		document.getElementById("borradorAltaTexto").textContent =
			(n ? "Quedó en este aparato la lista que estabas capturando: " + n + (n === 1 ? " alumno" : " alumnos") : "Quedaron en este aparato los datos de tu grupo") +
			", guardada el " + cuando.toLocaleDateString("es-MX", { day: "numeric", month: "long" }) +
			(" a las " + cuando.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) + ".").replace(/\.\.$/, "."); // "a.m." ya trae punto
		banner.classList.remove("hidden");
		document.getElementById("borradorAltaContinuar").onclick = function () { continuarBorrador(b); };
		document.getElementById("borradorAltaDescartar").onclick = function () {
			window.AltaBorrador.borrar(userId);
			banner.classList.add("hidden");
		};
	}

	async function continuarBorrador(b) {
		var banner = document.getElementById("borradorAlta");
		llenarFormularioGrupo(b.grupo);
		students = (b.alumnos || []).map(function (a) {
			return { nombre_completo: a.nombre_completo, grado: a.grado, key: normalizeName(a.nombre_completo) + "|" + String(a.grado || "") };
		});
		if (b.grupoId) {
			// El grupo ya se había creado: se revisa que siga ahí y que aún no tenga alumnos
			var g = await window.sb.from("grupos").select("id, tipo_organizacion, grados")
				.eq("id", b.grupoId).eq("maestro_id", userId).maybeSingle();
			if (g.error) {
				showMessage("groupMessage", "error", "No se pudo revisar tu grupo guardado. Revisa tu conexión e inténtalo de nuevo; tu lista sigue guardada en este aparato.");
				return;
			}
			if (g.data) {
				var cuenta = await window.sb.from("alumnos").select("id", { count: "exact", head: true }).eq("grupo_id", b.grupoId);
				if (cuenta.error) {
					showMessage("groupMessage", "error", "No se pudo revisar tu grupo guardado. Revisa tu conexión e inténtalo de nuevo; tu lista sigue guardada en este aparato.");
					return;
				}
				if ((cuenta.count || 0) > 0) {
					// La lista ya se había guardado: no se duplica
					window.AltaBorrador.borrar(userId);
					banner.classList.add("hidden");
					showMessage("groupMessage", "success", "Tu grupo ya tiene sus alumnos guardados. Te llevamos a Inicio...");
					setTimeout(function () { window.location.href = "dashboard.html"; }, 1200);
					return;
				}
				currentGroupId = g.data.id;
				currentGroupType = g.data.tipo_organizacion || (b.grupo && b.grupo.tipo) || "";
				currentGroupGrades = (g.data.grados || []).map(function (x) { return parseInt(x, 10); }).filter(Boolean).sort(function (x, y) { return x - y; });
				if (window.GrupoActivo) window.GrupoActivo.elegir(currentGroupId);
				configureStudentGradeSelector();
				updateStudentsList();
				montarListaPegada();
				pintarAvisoPonte();
				banner.classList.add("hidden");
				stepGroup.classList.add("hidden");
				stepStudents.classList.remove("hidden");
				showMessage("studentsMessage", "success", "Recuperamos tu lista. Revisa que esté completa y presiona \"Completar configuración\".");
				return;
			}
		}
		// El grupo aún no existe (o ya no): se crea con los datos recuperados
		updateStudentsList();
		banner.classList.add("hidden");
		showMessage("groupMessage", "success", students.length
			? "Recuperamos tus datos y tu lista de alumnos. Revisa el grupo y presiona \"Crear grupo\" para seguir."
			: "Recuperamos los datos de tu grupo. Revísalos y presiona \"Crear grupo\".");
	}

	// Botón de solo ícono de 44x44 (el ícono es marcado fijo; el nombre va en aria-label)
	function botonIcono(titulo, etiqueta, icono, colores) {
		var b = document.createElement("button");
		b.type = "button";
		b.className = "shrink-0 inline-flex items-center justify-center h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl transition-colors focus:outline-none focus:ring-2 " + colores;
		b.title = titulo;
		b.setAttribute("aria-label", etiqueta);
		b.innerHTML = icono;
		return b;
	}

	// Grado del alumno: un botón por grado del grupo (sin lista desplegable)
	function configureStudentGradeSelector() {
		if (!studentGradeWrapper || !studentGradeButtons) {
			return;
		}

		studentGradeButtons.innerHTML = "";

		if (!shouldCaptureStudentGrade()) {
			gradoElegido = currentGroupGrades[0] || null;
			studentGradeWrapper.classList.add("hidden");
			return;
		}

		// El grado que ya estaba elegido se respeta si sigue en el grupo; si no, el primero
		if (currentGroupGrades.indexOf(Number(gradoElegido)) === -1) gradoElegido = currentGroupGrades[0];

		currentGroupGrades.forEach(function (grade) {
			var b = document.createElement("button");
			b.type = "button";
			b.dataset.grado = String(grade);
			b.textContent = grade + "°";
			b.setAttribute("aria-label", grade + "° grado");
			studentGradeButtons.appendChild(b);
		});
		pintarBotonesGrado();

		studentGradeWrapper.classList.remove("hidden");
	}

	function pintarBotonesGrado() {
		if (!studentGradeButtons || !studentGradeButtons.querySelectorAll) return;
		studentGradeButtons.querySelectorAll("button[data-grado]").forEach(function (b) {
			var activo = Number(b.dataset.grado) === Number(gradoElegido);
			b.setAttribute("aria-pressed", activo ? "true" : "false");
			b.className = "min-h-[44px] min-w-[52px] px-4 rounded-xl border text-base font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 " +
				(activo ? "bg-blue-700 border-blue-700 text-white" : "bg-white border-gray-300 text-gray-800 hover:bg-gray-50");
		});
	}

	function shouldCaptureStudentGrade() {
		return currentGroupType !== "completa" && currentGroupGrades.length > 1;
	}

	function setLoading(btn, isLoading) {
		btn.disabled = isLoading;
		if (isLoading) {
			btn.classList.add("opacity-70", "cursor-not-allowed");
			btn.textContent = currentGroupId ? "Guardando..." : "Creando...";
		} else {
			btn.classList.remove("opacity-70", "cursor-not-allowed");
			btn.textContent = currentGroupId ? "Guardar cambios" : "Crear Grupo";
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

	// Letras con acentos y Ñ, espacios y guiones (js/nombres-alumno.js)
	function areValidWords(text, allowSpaces) {
		if (!allowSpaces && /\s/.test(text || "")) return false;
		return window.NombresAlumno.valido(text);
	}

	function bindNameInput(input, allowSpaces) {
		input.addEventListener("input", function (e) {
			if (e.isComposing) return;
			input.value = formatNameInput(input.value, allowSpaces);
		});
		input.addEventListener("compositionend", function () {
			input.value = formatNameInput(input.value, allowSpaces);
		});
	}

	function bindStudentInputRules() {
		if (studentLastName1Input) bindNameInput(studentLastName1Input, true);
		if (studentLastName2Input) bindNameInput(studentLastName2Input, true);
		if (studentFirstNamesInput) bindNameInput(studentFirstNamesInput, true);
	}

	// MAYÚSCULAS con acentos y Ñ ("JOSÉ PEÑA"; decisión de Jorge del 2026-09-26). Antes se
	// quitaban los acentos al teclear
	function formatNameInput(value, allowSpaces) {
		return window.NombresAlumno.formatear(value, allowSpaces);
	}
});
