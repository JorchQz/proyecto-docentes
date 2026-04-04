document.addEventListener("DOMContentLoaded", async function () {

  // ============================================================
  // PASO 1 — Datos dinámicos
  // ============================================================

  let gradosUsuario = [];
  let grupoId = null;

  // Intentar obtener grupoId desde localStorage (varios formatos posibles)
  try {
    const raw = localStorage.getItem('grupoActivo') || localStorage.getItem('grupo_activo');
    if (raw) {
      const ga = JSON.parse(raw);
      grupoId = ga.id || ga.grupo_id || null;
    }
  } catch (_) {}

  // Cargar grados del grupo del maestro desde Supabase
  try {
    if (window.sb) {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session) {
        const { data: grupos } = await window.sb
          .from('grupos')
          .select('id, grados')
          .eq('maestro_id', session.user.id)
          .limit(1);
        if (grupos && grupos.length > 0) {
          if (!grupoId) grupoId = grupos[0].id;
          const rawGrados = grupos[0].grados;
          if (Array.isArray(rawGrados)) {
            gradosUsuario = rawGrados.map(g => parseInt(g, 10)).filter(Boolean);
          } else if (typeof rawGrados === 'string') {
            gradosUsuario = rawGrados.split(',').map(g => parseInt(g.trim(), 10)).filter(Boolean);
          }
          gradosUsuario.sort((a, b) => a - b);
        }
      }
    }
  } catch (e) {
    console.error('Error cargando grupo:', e);
  }

  // Mapa Fase → grados NEM
  const faseGradosMap = { 'Fase 3': [1, 2], 'Fase 4': [3, 4], 'Fase 5': [5, 6] };

  // ---------- Checkboxes de Fase (NEM Primaria) ----------
  const faseCheckboxes = document.getElementById('faseCheckboxes');
  const fasesNEM = [
    { val: 'Fase 3', label: 'Fase 3 — Primaria (1° y 2°)' },
    { val: 'Fase 4', label: 'Fase 4 — Primaria (3° y 4°)' },
    { val: 'Fase 5', label: 'Fase 5 — Primaria (5° y 6°)' },
  ];

  if (faseCheckboxes) {
    faseCheckboxes.innerHTML = '';
    const fasesVisibles = fasesNEM.filter(fase =>
      (faseGradosMap[fase.val] || []).some(g => gradosUsuario.includes(g))
    );
    if (fasesVisibles.length > 1) {
      faseCheckboxes.appendChild(makeSelectAll('selectAllFase', 'Seleccionar todas las fases', function () {
        faseCheckboxes.querySelectorAll("input[name='fase']").forEach(c => c.checked = this.checked);
        renderGradosCheckboxes();
      }));
    }
    fasesVisibles.forEach(fase => {
      const lbl = makeCheckbox('fase', fase.val, fase.label);
      lbl.querySelector('input').addEventListener('change', renderGradosCheckboxes);
      faseCheckboxes.appendChild(lbl);
    });
    if (fasesVisibles.length === 0) {
      faseCheckboxes.innerHTML = '<p class="text-sm text-gray-400">No hay fases disponibles para los grados de tu grupo.</p>';
    }
  }

  // ---------- Checkboxes de Grados (reactivos a fases) ----------
  const gradosCheckboxes = document.getElementById('gradosCheckboxes');

  function renderGradosCheckboxes() {
    if (!gradosCheckboxes) return;
    const fasesChecked = Array.from(
      faseCheckboxes.querySelectorAll("input[name='fase']:checked")
    ).map(c => c.value);

    let gradosMostrar;
    if (fasesChecked.length === 0) {
      gradosMostrar = gradosUsuario.slice();
    } else {
      const gradosDeFases = new Set();
      fasesChecked.forEach(f => (faseGradosMap[f] || []).forEach(g => gradosDeFases.add(g)));
      gradosMostrar = gradosUsuario.filter(g => gradosDeFases.has(g));
    }

    gradosCheckboxes.innerHTML = '';
    if (gradosMostrar.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-400';
      p.textContent = gradosUsuario.length === 0
        ? 'No hay grados registrados en tu grupo.'
        : 'Las fases seleccionadas no incluyen grados de tu grupo.';
      gradosCheckboxes.appendChild(p);
      return;
    }
    if (gradosMostrar.length > 1) {
      gradosCheckboxes.appendChild(makeSelectAll('selectAllGrados', 'Seleccionar todos', function () {
        gradosCheckboxes.querySelectorAll("input[name='grados']").forEach(c => c.checked = this.checked);
      }));
    }
    gradosMostrar.forEach(grado => {
      gradosCheckboxes.appendChild(makeCheckbox('grados', String(grado), `${grado}°`));
    });
  }

  renderGradosCheckboxes();

  // ---------- Seleccionar todos — Campos formativos ----------
  const cfBox = document.querySelector('[name="campos_formativos"]')?.closest('.flex');
  if (cfBox) {
    cfBox.prepend(makeSelectAll('selectAllCF', 'Seleccionar todos', function () {
      cfBox.querySelectorAll("input[name='campos_formativos']").forEach(c => c.checked = this.checked);
    }));
  }

  // ---------- Seleccionar todos — Ejes articuladores ----------
  const ejBox = document.querySelector('[name="ejes_articuladores"]')?.closest('.flex');
  if (ejBox) {
    ejBox.prepend(makeSelectAll('selectAllEJ', 'Seleccionar todos', function () {
      ejBox.querySelectorAll("input[name='ejes_articuladores']").forEach(c => c.checked = this.checked);
    }));
  }

  // ---------- Helpers para crear elementos ----------
  function makeCheckbox(name, value, labelText) {
    const lbl = document.createElement('label');
    lbl.className = 'inline-flex items-center gap-2 cursor-pointer select-none';
    lbl.innerHTML = `<input type="checkbox" name="${name}" value="${value}"
      class="form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500">
      <span class="text-gray-800">${labelText}</span>`;
    return lbl;
  }

  function makeSelectAll(id, text, handler) {
    const lbl = document.createElement('label');
    lbl.className = 'inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-blue-700';
    lbl.innerHTML = `<input type="checkbox" id="${id}"
      class="form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500">
      <span>${text}</span>`;
    lbl.querySelector('input').addEventListener('change', handler);
    return lbl;
  }

  // ============================================================
  // TRANSICIÓN PASO 1 → PASO 2
  // ============================================================

  let paso1Data = null;
  let sessionCounter = 0;

  const step1 = document.getElementById('step1-datos-generales');
  const step2contenidos = document.getElementById('step2-contenidos');
  const step2 = document.getElementById('step2-sesiones');
  const formPaso1 = document.getElementById('formPaso1');

  // Mapa campo formativo → metodología sugerida
  const campoMetodologiaMap = {
    'Lenguajes': 'ABPC',
    'Saberes y Pensamiento Científico': 'STEAM',
    'Ética, Naturaleza y Sociedades': 'ABP',
    'De lo Humano y lo Comunitario': 'AS',
  };

  function sugerirMetodologia() {
    const checked = Array.from(formPaso1.querySelectorAll('input[name="campos_formativos"]:checked')).map(c => c.value);
    const hint = document.getElementById('sugerenciaMetodologia');
    if (checked.length === 1) {
      const metSugerida = campoMetodologiaMap[checked[0]];
      if (metSugerida) {
        const radio = formPaso1.querySelector(`input[name="metodologia"][value="${metSugerida}"]`);
        if (radio) radio.checked = true;
        if (hint) hint.classList.remove('hidden');
      }
    } else {
      if (hint) hint.classList.add('hidden');
    }
  }

  formPaso1.querySelectorAll('input[name="campos_formativos"]').forEach(cb => {
    cb.addEventListener('change', sugerirMetodologia);
  });

  if (formPaso1) {
    formPaso1.addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(formPaso1);
      paso1Data = {
        titulo:             fd.get('titulo'),
        fecha_inicial:      fd.get('fecha_inicial'),
        fecha_final:        fd.get('fecha_final'),
        fase:               Array.from(formPaso1.querySelectorAll('input[name="fase"]:checked')).map(el => el.value),
        grados:             Array.from(formPaso1.querySelectorAll('input[name="grados"]:checked')).map(el => el.value),
        metodologia:        fd.get('metodologia'),
        escenario:          fd.get('escenario'),
        campos_formativos:  Array.from(formPaso1.querySelectorAll('input[name="campos_formativos"]:checked')).map(el => el.value),
        ejes_articuladores: Array.from(formPaso1.querySelectorAll('input[name="ejes_articuladores"]:checked')).map(el => el.value),
        proposito:          fd.get('proposito'),
        pregunta_generadora: fd.get('pregunta_generadora'),
      };
      step1.classList.add('hidden');
      step2contenidos.classList.remove('hidden');
      renderContenidos();
    });
  }

  // ============================================================
  // PASO 2 — Contenidos y PDA
  // ============================================================

  let paso2Data = {}; // { [campo]: { contenido, pda: { [grado]: texto } } }

  function renderContenidos() {
    const container = document.getElementById('contenidosContainer');
    if (!container) return;

    const campos = paso1Data ? paso1Data.campos_formativos : [];
    const grados = paso1Data ? paso1Data.grados.map(Number).sort((a,b)=>a-b) : [];

    // Guardar valores actuales antes de re-renderizar
    _saveContenidosState();

    container.innerHTML = '';

    if (campos.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm">No hay campos formativos seleccionados.</p>';
      return;
    }

    const fases = paso1Data ? paso1Data.fase : [];

    campos.forEach(function (campo) {
      const saved = paso2Data[campo] || {};
      const div = document.createElement('div');
      div.className = 'campo-contenido-block border border-gray-200 rounded-xl p-5 bg-white';
      div.dataset.campo = campo;

      // Contenido por fase
      let contenidoRows = '';
      if (fases.length <= 1) {
        const fase = fases[0] || '';
        const val = (saved.contenido && typeof saved.contenido === 'object')
          ? (saved.contenido[fase] || '')
          : (saved.contenido || '');
        contenidoRows = `
          <textarea name="contenido_${fase || 'unico'}" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Escribe el contenido para este campo formativo...">${val}</textarea>`;
      } else {
        contenidoRows = `<div class="grid grid-cols-1 md:grid-cols-${Math.min(fases.length, 3)} gap-4">`;
        fases.forEach(function (fase) {
          const val = (saved.contenido && typeof saved.contenido === 'object')
            ? (saved.contenido[fase] || '')
            : '';
          contenidoRows += `
            <div>
              <label class="block text-xs font-semibold text-blue-700 mb-1">${fase}</label>
              <textarea name="contenido_${fase}" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Contenido para ${fase}...">${val}</textarea>
            </div>`;
        });
        contenidoRows += '</div>';
      }

      // PDA por grado
      let pdaRows = '';
      grados.forEach(function (g) {
        const val = (saved.pda && saved.pda[g]) ? saved.pda[g] : '';
        pdaRows += `
          <div>
            <label class="block text-xs font-semibold text-blue-700 mb-1">${g}°</label>
            <textarea name="pda_${g}" rows="3"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="PDA para ${g}°...">${val}</textarea>
          </div>`;
      });

      div.innerHTML = `
        <h3 class="font-bold text-gray-800 mb-4 text-base border-b pb-2">${campo}</h3>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-3">Contenido${fases.length > 1 ? ' por fase' : ''}</label>
          ${contenidoRows}
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-3">Procesos de Desarrollo de Aprendizaje (PDA) por grado</label>
          <div class="grid grid-cols-1 md:grid-cols-${Math.min(grados.length, 3)} gap-4">
            ${pdaRows}
          </div>
        </div>`;

      container.appendChild(div);
    });
  }

  function _saveContenidosState() {
    document.querySelectorAll('.campo-contenido-block').forEach(function (block) {
      const campo = block.dataset.campo;
      if (!campo) return;
      const contenido = {};
      block.querySelectorAll('textarea[name^="contenido_"]').forEach(function (ta) {
        const fase = ta.name.replace('contenido_', '');
        contenido[fase] = ta.value;
      });
      const pda = {};
      block.querySelectorAll('textarea[name^="pda_"]').forEach(function (ta) {
        const grado = ta.name.replace('pda_', '');
        pda[grado] = ta.value;
      });
      paso2Data[campo] = { contenido, pda };
    });
  }

  function collectContenidosData() {
    _saveContenidosState();
    return paso2Data;
  }

  document.getElementById('btnVolverPaso1Desde2')?.addEventListener('click', function () {
    _saveContenidosState();
    step2contenidos.classList.add('hidden');
    step1.classList.remove('hidden');
  });

  document.getElementById('btnIrPaso3')?.addEventListener('click', function () {
    _saveContenidosState();
    step2contenidos.classList.add('hidden');
    step2.classList.remove('hidden');
    if (sessionCounter === 0) {
      agregarSesion();
    } else {
      // Actualizar selects de sesiones existentes si cambió paso 1
      document.querySelectorAll('.session-block').forEach(function (block) {
        const cfSelect = block.querySelector('select[name="campo_formativo"]');
        if (cfSelect) {
          const cf = buildCampoFormativoOptions();
          cfSelect.innerHTML = cf.html;
          cfSelect.disabled = cf.disabled;
        }
        const secSelect = block.querySelector('select[name="momento"]');
        if (secSelect) {
          const prevVal = secSelect.value;
          secSelect.innerHTML = buildSecuenciaOptions();
          if (prevVal && secSelect.querySelector(`option[value="${prevVal}"]`)) {
            secSelect.value = prevVal;
          }
        }
      });
    }
  });

  // ============================================================
  // PASO 3 — Sesiones
  // ============================================================

  // Secuencias por metodología (Paso 2)
  const metodologiaSecuencias = {
    'ABPC': ['1. Identificamos','2. Recuperamos','3. Planificamos','4. Nos acercamos','5. Vamos y volvemos','6. Reorientamos','7. Seguimos','8. Integramos','9. Difundimos','10. Consideramos','11. Avanzamos'],
    'STEAM': ['Fase 1. Introducción al tema','Fase 2. Diseño de investigación','Fase 3. Organizar y estructurar respuestas','Fase 4. Presentación de resultados','Fase 5. Metacognición'],
    'ABP': ['1. Presentemos','2. Recolectemos','3. Formulemos el problema','4. Organicemos la experiencia','5. Vivamos la experiencia','6. Resultados y análisis'],
    'AS': ['Etapa 1. Punto de partida','Etapa 2. Lo que sé y lo que quiero saber','Etapa 3. Organicemos las actividades','Etapa 4. Creatividad en marcha','Etapa 5. Compartimos y evaluamos'],
  };

  function buildSecuenciaOptions() {
    const met = paso1Data ? paso1Data.metodologia : null;
    const opciones = metodologiaSecuencias[met] || [];
    return '<option value="">Selecciona...</option>' +
      opciones.map(o => `<option value="${o}">${o}</option>`).join('');
  }

  function buildCampoFormativoOptions() {
    const campos = paso1Data ? paso1Data.campos_formativos : [];
    if (!campos || campos.length === 0) {
      return { html: '<option value="">Selecciona...</option><option>Lenguajes</option><option>Saberes y Pensamiento Científico</option><option>Ética, Naturaleza y Sociedades</option><option>De lo Humano y lo Comunitario</option>', disabled: false };
    }
    if (campos.length === 1) {
      return { html: `<option value="${campos[0]}" selected>${campos[0]}</option>`, disabled: true };
    }
    return {
      html: '<option value="">Selecciona...</option>' + campos.map(c => `<option value="${c}">${c}</option>`).join(''),
      disabled: false,
    };
  }

  function buildDidacticSection(key, label) {
    const grados = paso1Data ? paso1Data.grados.map(Number).sort((a, b) => a - b) : [];
    const cols = Math.min(grados.length || 2, 3);

    let difCols = '';
    if (grados.length === 0) {
      // Fallback: dos columnas genéricas si no hay grados
      difCols = `
        <div>
          <label class="block text-xs font-semibold text-blue-700 mb-1">Grupo A</label>
          <textarea name="${key}_grado_A" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Actividad para este grupo..."></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold text-blue-700 mb-1">Grupo B</label>
          <textarea name="${key}_grado_B" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Actividad para este grupo..."></textarea>
        </div>`;
    } else {
      grados.forEach(function (g) {
        difCols += `
          <div>
            <label class="block text-xs font-semibold text-blue-700 mb-1">${g}°</label>
            <textarea name="${key}_grado_${g}" rows="3"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Actividad para ${g}°..."></textarea>
          </div>`;
      });
    }

    return `
      <div class="didactic-section border border-gray-100 rounded-xl p-4 bg-gray-50"
           data-section="${key}" data-mode="todos">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span class="font-semibold text-gray-700 text-sm">${label}</span>
          <div class="flex rounded-lg overflow-hidden border border-gray-300 text-xs">
            <button type="button" class="mode-btn-todos px-3 py-1.5 bg-blue-600 text-white font-medium transition">
              Igual para todos
            </button>
            <button type="button" class="mode-btn-dif px-3 py-1.5 bg-white text-gray-600 font-medium transition hover:bg-gray-50">
              Diferenciado
            </button>
          </div>
        </div>
        <div class="mode-todos-panel">
          <textarea name="${key}_todos" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Actividad de ${label.toLowerCase()} para todos los grados..."></textarea>
        </div>
        <div class="mode-dif-panel hidden">
          <div class="grid grid-cols-1 md:grid-cols-${cols} gap-3">
            ${difCols}
          </div>
        </div>
      </div>`;
  }

  function createSessionBlock(num) {
    const div = document.createElement('div');
    div.className = 'session-block border border-gray-200 rounded-xl overflow-hidden';
    div.dataset.num = num;

    div.innerHTML = `
      <button type="button" class="session-toggle w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition text-left">
        <span class="session-label font-semibold text-gray-700">Sesión ${num} — — </span>
        <span class="toggle-icon text-gray-400">▼</span>
      </button>
      <div class="session-body p-5 flex flex-col gap-5">

        <!-- Datos básicos de la sesión -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Duración</label>
            <input type="text" name="duracion" placeholder="50 minutos"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Fecha</label>
            <input type="date" name="fecha"
              class="session-fecha w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Campo formativo</label>
            <select name="campo_formativo"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
              ${(function(){ const r = buildCampoFormativoOptions(); return r.disabled ? 'disabled' : ''; })()}>
              ${buildCampoFormativoOptions().html}
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-gray-500 mb-1">Secuencia</label>
            <select name="momento"
              class="session-momento w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
              ${buildSecuenciaOptions()}
            </select>
          </div>
        </div>

        <!-- Secuencia didáctica -->
        ${buildDidacticSection('inicio', 'Inicio')}
        ${buildDidacticSection('desarrollo', 'Desarrollo')}
        ${buildDidacticSection('cierre', 'Cierre')}

        <!-- Campos adicionales -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">¿Qué tarea se deja?</label>
            <textarea name="tarea" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Tarea para casa..."></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Recursos y material didáctico</label>
            <textarea name="recursos" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Materiales necesarios..."></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Productos esperados</label>
            <textarea name="productos" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="¿Qué producirán los alumnos?"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Criterios de evaluación</label>
            <textarea name="criterios_evaluacion" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="¿Cómo se evaluará?"></textarea>
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
            <textarea name="observaciones" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Notas adicionales..."></textarea>
          </div>
        </div>

        <!-- Botón eliminar -->
        <div class="flex justify-end pt-2 border-t border-gray-100">
          <button type="button" class="btn-eliminar text-red-500 hover:text-red-700 text-sm font-medium transition">
            🗑️ Eliminar sesión
          </button>
        </div>
      </div>`;

    // Acordeón: toggle del cuerpo
    div.querySelector('.session-toggle').addEventListener('click', function () {
      const body = div.querySelector('.session-body');
      const icon = div.querySelector('.toggle-icon');
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      icon.textContent = open ? '▶' : '▼';
    });

    // Actualizar etiqueta del header cuando cambian fecha o momento
    div.querySelector('.session-fecha').addEventListener('change', () => updateLabel(div));
    div.querySelector('.session-momento').addEventListener('change', () => updateLabel(div));

    // Modo didáctico (Igual / Diferenciado) por sección
    div.querySelectorAll('.didactic-section').forEach(section => {
      section.querySelector('.mode-btn-todos').addEventListener('click', function () {
        section.dataset.mode = 'todos';
        section.querySelector('.mode-todos-panel').classList.remove('hidden');
        section.querySelector('.mode-dif-panel').classList.add('hidden');
        this.classList.add('bg-blue-600', 'text-white');
        this.classList.remove('bg-white', 'text-gray-600');
        const dif = section.querySelector('.mode-btn-dif');
        dif.classList.add('bg-white', 'text-gray-600');
        dif.classList.remove('bg-blue-600', 'text-white');
      });
      section.querySelector('.mode-btn-dif').addEventListener('click', function () {
        section.dataset.mode = 'diferenciado';
        section.querySelector('.mode-dif-panel').classList.remove('hidden');
        section.querySelector('.mode-todos-panel').classList.add('hidden');
        this.classList.add('bg-blue-600', 'text-white');
        this.classList.remove('bg-white', 'text-gray-600');
        const tod = section.querySelector('.mode-btn-todos');
        tod.classList.add('bg-white', 'text-gray-600');
        tod.classList.remove('bg-blue-600', 'text-white');
      });
    });

    // Eliminar sesión
    div.querySelector('.btn-eliminar').addEventListener('click', function () {
      if (document.querySelectorAll('.session-block').length === 1) {
        alert('Debe haber al menos una sesión.');
        return;
      }
      div.remove();
      renumber();
    });

    return div;
  }

  function updateLabel(block) {
    const num   = block.dataset.num;
    const fecha = block.querySelector('.session-fecha').value;
    const momento = block.querySelector('.session-momento').value;
    let fechaStr = '';
    if (fecha) {
      const [y, m, d] = fecha.split('-');
      fechaStr = `${d}/${m}/${y.slice(2)}`;
    }
    block.querySelector('.session-label').textContent =
      `Sesión ${num} — ${fechaStr || '—'} — ${momento || '—'}`;
  }

  function renumber() {
    document.querySelectorAll('.session-block').forEach((block, idx) => {
      block.dataset.num = idx + 1;
      updateLabel(block);
    });
  }

  function agregarSesion() {
    sessionCounter++;
    document.getElementById('sesionesContainer').appendChild(createSessionBlock(sessionCounter));
  }

  document.getElementById('btnAgregarSesion')?.addEventListener('click', agregarSesion);

  document.getElementById('btnVolverPaso2')?.addEventListener('click', function () {
    step2.classList.add('hidden');
    step2contenidos.classList.remove('hidden');
    renderContenidos();
  });

  // ============================================================
  // GUARDAR EN SUPABASE
  // ============================================================

  document.getElementById('btnGuardar')?.addEventListener('click', async function () {
    const btn  = this;
    const msgEl = document.getElementById('mensajePaso2');

    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const { data: { user }, error: userError } = await window.sb.auth.getUser();
      if (userError || !user) throw new Error('No hay sesión activa.');

      // Insertar proyecto
      const { data: proyecto, error: pError } = await window.sb
        .from('proyectos')
        .insert({
          maestro_id:          user.id,
          grupo_id:            grupoId,
          titulo:              paso1Data.titulo,
          fecha_inicial:       paso1Data.fecha_inicial,
          fecha_final:         paso1Data.fecha_final,
          fase:                paso1Data.fase,
          grados:              paso1Data.grados,
          metodologia:         paso1Data.metodologia,
          escenario:           paso1Data.escenario,
          campos_formativos:   paso1Data.campos_formativos,
          ejes_articuladores:  paso1Data.ejes_articuladores,
          proposito:           paso1Data.proposito,
          pregunta_generadora: paso1Data.pregunta_generadora,
          contenidos_pda:      collectContenidosData(),
          visible_mercado:     false,
        })
        .select('id')
        .single();

      if (pError) throw pError;

      // Construir payload de sesiones
      const blocks = document.querySelectorAll('.session-block');
      const sesionesPayload = Array.from(blocks).map((block, idx) => {
        const g    = name => block.querySelector(`[name="${name}"]`)?.value.trim() || null;
        const mode = key  => block.querySelector(`.didactic-section[data-section="${key}"]`)?.dataset.mode || 'todos';

        function getDifData(key) {
          const obj = {};
          block.querySelectorAll(`textarea[name^="${key}_grado_"]`).forEach(function (ta) {
            const grado = ta.name.replace(`${key}_grado_`, '');
            obj[grado] = ta.value.trim() || null;
          });
          return Object.keys(obj).length > 0 ? obj : null;
        }

        const mI = mode('inicio');
        const mD = mode('desarrollo');
        const mC = mode('cierre');

        return {
          proyecto_id:          proyecto.id,
          maestro_id:           user.id,
          numero_sesion:        idx + 1,
          duracion:             g('duracion'),
          fecha:                g('fecha') || null,
          campo_formativo:      g('campo_formativo'),
          momento:              g('momento'),
          inicio_todos:         mI === 'todos'        ? g('inicio_todos')   : null,
          inicio_diferenciado:  mI === 'diferenciado' ? getDifData('inicio') : null,
          desarrollo_todos:     mD === 'todos'        ? g('desarrollo_todos'): null,
          desarrollo_diferenciado: mD === 'diferenciado' ? getDifData('desarrollo') : null,
          cierre_todos:         mC === 'todos'        ? g('cierre_todos')   : null,
          cierre_diferenciado:  mC === 'diferenciado' ? getDifData('cierre') : null,
          tarea:                g('tarea'),
          recursos:             g('recursos'),
          productos:            g('productos'),
          criterios_evaluacion: g('criterios_evaluacion'),
          observaciones:        g('observaciones'),
        };
      });

      if (sesionesPayload.length > 0) {
        const { error: sError } = await window.sb.from('sesiones').insert(sesionesPayload);
        if (sError) throw sError;
      }

      msgEl.className = 'mt-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-sm';
      msgEl.textContent = '✅ Proyecto guardado correctamente. Redirigiendo...';
      msgEl.classList.remove('hidden');
      setTimeout(() => { window.location.href = 'planeacion.html'; }, 1800);

    } catch (err) {
      console.error('Error al guardar:', err);
      msgEl.className = 'mt-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm';
      msgEl.textContent = '❌ Error al guardar: ' + (err.message || 'Intenta de nuevo.');
      msgEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '💾 Guardar Proyecto Completo';
    }
  });

});
