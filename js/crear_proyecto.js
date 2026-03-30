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
          gradosUsuario = grupos[0].grados
            .split(',')
            .map(g => parseInt(g.trim(), 10))
            .filter(Boolean);
        }
      }
    }
  } catch (e) {
    console.error('Error cargando grupo:', e);
  }

  // ---------- Checkboxes de Fase (NEM Primaria) ----------
  const faseCheckboxes = document.getElementById('faseCheckboxes');
  const fasesNEM = [
    { val: 'Fase 3', label: 'Fase 3 — Primaria (1° y 2°)' },
    { val: 'Fase 4', label: 'Fase 4 — Primaria (3° y 4°)' },
    { val: 'Fase 5', label: 'Fase 5 — Primaria (5° y 6°)' },
  ];

  if (faseCheckboxes) {
    faseCheckboxes.innerHTML = '';
    faseCheckboxes.appendChild(makeSelectAll('selectAllFase', 'Seleccionar todas las fases', function () {
      faseCheckboxes.querySelectorAll("input[name='fase']").forEach(c => c.checked = this.checked);
    }));
    fasesNEM.forEach(fase => {
      faseCheckboxes.appendChild(makeCheckbox('fase', fase.val, fase.label));
    });
  }

  // ---------- Checkboxes de Grados ----------
  const gradosCheckboxes = document.getElementById('gradosCheckboxes');
  if (gradosCheckboxes) {
    gradosCheckboxes.innerHTML = '';
    if (gradosUsuario.length > 1) {
      gradosCheckboxes.appendChild(makeSelectAll('selectAllGrados', 'Seleccionar todos', function () {
        gradosCheckboxes.querySelectorAll("input[name='grados']").forEach(c => c.checked = this.checked);
      }));
    }
    gradosUsuario.forEach(grado => {
      gradosCheckboxes.appendChild(makeCheckbox('grados', String(grado), `Grado ${grado}`));
    });
  }

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
  const step2 = document.getElementById('step2-sesiones');
  const formPaso1 = document.getElementById('formPaso1');

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
      step2.classList.remove('hidden');
      if (sessionCounter === 0) agregarSesion();
    });
  }

  // ============================================================
  // PASO 2 — Sesiones
  // ============================================================

  function buildDidacticSection(key, label) {
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
          <div class="grid grid-cols-2 gap-3">
            <div>
              <input type="text" class="label-grupo-a w-full px-2 py-1 border border-blue-200 rounded-lg
                text-xs text-blue-700 font-semibold mb-1 bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                value="Grados A" placeholder="Ej: 4°">
              <textarea name="${key}_grado_a" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Actividad para este grupo..."></textarea>
            </div>
            <div>
              <input type="text" class="label-grupo-b w-full px-2 py-1 border border-blue-200 rounded-lg
                text-xs text-blue-700 font-semibold mb-1 bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                value="Grados B" placeholder="Ej: 5° y 6°">
              <textarea name="${key}_grado_b" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Actividad para este grupo..."></textarea>
            </div>
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
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
              <option value="">Selecciona...</option>
              <option>Lenguajes</option>
              <option>Saberes y Pensamiento Científico</option>
              <option>Ética, Naturaleza y Sociedades</option>
              <option>De lo Humano y lo Comunitario</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-gray-500 mb-1">Momento</label>
            <select name="momento"
              class="session-momento w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
              <option value="">Selecciona...</option>
              <option>Presentamos</option>
              <option>Recolectamos</option>
              <option>Formulamos el problema</option>
              <option>Vivimos la experiencia</option>
              <option>Valoramos la experiencia</option>
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
          es_multigrado:       paso1Data.grados.length > 1,
          visible_mercado:     false,
        })
        .select('id')
        .single();

      if (pError) throw pError;

      // Construir payload de sesiones
      const blocks = document.querySelectorAll('.session-block');
      const sesionesPayload = Array.from(blocks).map((block, idx) => {
        const g   = name => block.querySelector(`[name="${name}"]`)?.value.trim() || null;
        const mode = key  => block.querySelector(`.didactic-section[data-section="${key}"]`)?.dataset.mode || 'todos';

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
          inicio_todos:         mI === 'todos'        ? g('inicio_todos')      : null,
          inicio_grado_a:       mI === 'diferenciado' ? g('inicio_grado_a')    : null,
          inicio_grado_b:       mI === 'diferenciado' ? g('inicio_grado_b')    : null,
          desarrollo_todos:     mD === 'todos'        ? g('desarrollo_todos')  : null,
          desarrollo_grado_a:   mD === 'diferenciado' ? g('desarrollo_grado_a'): null,
          desarrollo_grado_b:   mD === 'diferenciado' ? g('desarrollo_grado_b'): null,
          cierre_todos:         mC === 'todos'        ? g('cierre_todos')      : null,
          cierre_grado_a:       mC === 'diferenciado' ? g('cierre_grado_a')    : null,
          cierre_grado_b:       mC === 'diferenciado' ? g('cierre_grado_b')    : null,
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
