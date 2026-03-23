// Lógica para poblar dinámicamente los campos de Fase y Grados en Paso 1
// y manejar el envío del formulario por pasos.

document.addEventListener("DOMContentLoaded", async function () {
  // --- Obtener grados del grupo del profesor desde Supabase ---
  let gradosUsuario = [];
  let fasesDisponibles = [];
  try {
    if (window.sb) {
      // Obtener sesión actual
      const sessionResult = await window.sb.auth.getSession();
      if (sessionResult.data && sessionResult.data.session) {
        const userId = sessionResult.data.session.user.id;
        // Buscar el grupo activo del profesor (puedes ajustar el filtro si hay más de un grupo)
        const { data: grupos, error } = await window.sb
          .from("grupos")
          .select("grados")
          .eq("maestro_id", userId)
          .limit(1);
        if (!error && grupos && grupos.length > 0) {
          // La columna grados es tipo texto: "1,2,3"
          gradosUsuario = grupos[0].grados.split(',').map(g => parseInt(g.trim(), 10)).filter(Boolean);
        }
      }
    }
  } catch (e) {
    console.error("Error obteniendo grados del grupo:", e);
  }

  // Determinar fases compatibles según grados obtenidos
  fasesDisponibles = [];
  if (gradosUsuario.includes(1)) fasesDisponibles.push({ val: 1, label: "Fase 1" });
  if (gradosUsuario.includes(2)) fasesDisponibles.push({ val: 2, label: "Fase 2" });
  if (gradosUsuario.includes(3)) fasesDisponibles.push({ val: 3, label: "Fase 3" });
  if (gradosUsuario.includes(4)) fasesDisponibles.push({ val: 4, label: "Fase 4" });
  if (gradosUsuario.includes(5) || gradosUsuario.includes(6)) fasesDisponibles.push({ val: 5, label: "Fase 5 (5° y 6°)" });

  // Poblar select de Grados (selección múltiple)
  const gradosSelect = document.getElementById("gradosSelect");
  if (gradosSelect && gradosUsuario.length > 0) {
    gradosSelect.innerHTML = "";
    gradosUsuario.forEach(grado => {
      const opt = document.createElement("option");
      opt.value = grado;
      opt.textContent = `Grado ${grado}`;
      gradosSelect.appendChild(opt);
    });
  }

  // Poblar checkboxes de Fase según grados disponibles (tipo Google Forms)
  const faseCheckboxes = document.getElementById("faseCheckboxes");
  if (faseCheckboxes) {
    faseCheckboxes.innerHTML = "";
    fasesDisponibles.forEach(fase => {
      const id = `fase_${fase.val}`;
      const label = document.createElement("label");
      label.className = "inline-flex items-center gap-2 cursor-pointer select-none";
      label.innerHTML = `
        <input type='checkbox' name='fase' value='${fase.val}' id='${id}' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
        <span class='text-gray-800'>${fase.label}</span>
      `;
      faseCheckboxes.appendChild(label);
    });
  }

  // --- Agregar opción de seleccionar todos para Fase ---
  if (faseCheckboxes && fasesDisponibles.length > 1) {
    const selectAllFase = document.createElement("label");
    selectAllFase.className = "inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-blue-700";
    selectAllFase.innerHTML = `
      <input type='checkbox' id='selectAllFase' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
      <span>Seleccionar todas las fases</span>
    `;
    faseCheckboxes.prepend(selectAllFase);
    const selectAllFaseInput = selectAllFase.querySelector("input");
    selectAllFaseInput.addEventListener("change", function() {
      const checks = faseCheckboxes.querySelectorAll("input[type='checkbox'][name='fase']");
      checks.forEach(chk => { chk.checked = selectAllFaseInput.checked; });
    });
  }

  // Poblar checkboxes de Grados (en card vertical)
  const gradosCheckboxes = document.getElementById("gradosCheckboxes");
  if (gradosCheckboxes && gradosUsuario.length > 0) {
    gradosCheckboxes.innerHTML = "";
    gradosUsuario.forEach(grado => {
      const id = `grado_${grado}`;
      const label = document.createElement("label");
      label.className = "inline-flex items-center gap-2 cursor-pointer select-none";
      label.innerHTML = `
        <input type='checkbox' name='grados' value='${grado}' id='${id}' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
        <span class='text-gray-800'>Grado ${grado}</span>
      `;
      gradosCheckboxes.appendChild(label);
    });
  }

  // --- Agregar opción de seleccionar todos para Grados ---
  if (gradosCheckboxes && gradosUsuario.length > 1) {
    const selectAllGrados = document.createElement("label");
    selectAllGrados.className = "inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-blue-700";
    selectAllGrados.innerHTML = `
      <input type='checkbox' id='selectAllGrados' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
      <span>Seleccionar todos los grados</span>
    `;
    gradosCheckboxes.prepend(selectAllGrados);
    const selectAllGradosInput = selectAllGrados.querySelector("input");
    selectAllGradosInput.addEventListener("change", function() {
      const checks = gradosCheckboxes.querySelectorAll("input[type='checkbox'][name='grados']");
      checks.forEach(chk => { chk.checked = selectAllGradosInput.checked; });
    });
  }

  // --- Seleccionar todos para Campos formativos ---
  const camposFormativosBox = document.querySelector('[name="campos_formativos"]').closest('.flex');
  if (camposFormativosBox && camposFormativosBox.querySelectorAll('input[type="checkbox"]').length > 1) {
    const selectAllCampos = document.createElement("label");
    selectAllCampos.className = "inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-blue-700";
    selectAllCampos.innerHTML = `
      <input type='checkbox' id='selectAllCamposFormativos' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
      <span>Seleccionar todos los campos</span>
    `;
    camposFormativosBox.prepend(selectAllCampos);
    const selectAllCamposInput = selectAllCampos.querySelector("input");
    selectAllCamposInput.addEventListener("change", function() {
      const checks = camposFormativosBox.querySelectorAll("input[type='checkbox'][name='campos_formativos']");
      checks.forEach(chk => { chk.checked = selectAllCamposInput.checked; });
    });
  }

  // --- Seleccionar todos para Ejes articuladores ---
  const ejesArticuladoresBox = document.querySelector('[name="ejes_articuladores"]').closest('.flex');
  if (ejesArticuladoresBox && ejesArticuladoresBox.querySelectorAll('input[type="checkbox"]').length > 1) {
    const selectAllEjes = document.createElement("label");
    selectAllEjes.className = "inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-blue-700";
    selectAllEjes.innerHTML = `
      <input type='checkbox' id='selectAllEjesArticuladores' class='form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500'>
      <span>Seleccionar todos los ejes</span>
    `;
    ejesArticuladoresBox.prepend(selectAllEjes);
    const selectAllEjesInput = selectAllEjes.querySelector("input");
    selectAllEjesInput.addEventListener("change", function() {
      const checks = ejesArticuladoresBox.querySelectorAll("input[type='checkbox'][name='ejes_articuladores']");
      checks.forEach(chk => { chk.checked = selectAllEjesInput.checked; });
    });
  }

  // Relación de fases a grados
  const faseAGrado = {
    1: [1],
    2: [2],
    3: [3],
    4: [4],
    5: [5, 6],
  };

  // Sincronizar selección de Fase con Grados
  if (faseCheckboxes && gradosCheckboxes) {
    faseCheckboxes.addEventListener("change", function (e) {
      if (e.target && e.target.name === "fase") {
        // Obtener fases seleccionadas
        const fasesSeleccionadas = Array.from(faseCheckboxes.querySelectorAll("input[name='fase']:checked")).map(f => parseInt(f.value, 10));
        // Determinar grados a seleccionar
        let gradosASeleccionar = new Set();
        fasesSeleccionadas.forEach(fase => {
          (faseAGrado[fase] || []).forEach(g => gradosASeleccionar.add(g));
        });
        // Marcar los grados correspondientes
        gradosCheckboxes.querySelectorAll("input[name='grados']").forEach(chk => {
          chk.checked = gradosASeleccionar.has(parseInt(chk.value, 10));
        });
      }
    });
  }

  // Manejo del envío del formulario Paso 1
  const formPaso1 = document.getElementById("formPaso1");
  if (formPaso1) {
    formPaso1.addEventListener("submit", function (e) {
      e.preventDefault();
      // Aquí puedes recolectar los datos y pasar al siguiente paso
      // Por ahora solo muestra los datos en consola
      const formData = new FormData(formPaso1);
      const datos = Object.fromEntries(formData.entries());
      // Para checkboxes múltiples:
      datos.campos_formativos = Array.from(formPaso1.querySelectorAll('input[name="campos_formativos"]:checked')).map(el => el.value);
      datos.ejes_articuladores = Array.from(formPaso1.querySelectorAll('input[name="ejes_articuladores"]:checked')).map(el => el.value);
      // Para grados (select múltiple):
      datos.grados = Array.from(gradosSelect.selectedOptions).map(opt => opt.value);
      console.log("Datos Paso 1:", datos);
      // Aquí iría la lógica para mostrar el Paso 2
      alert("Datos capturados correctamente. (Aquí iría el paso 2)");
    });
  }
});
