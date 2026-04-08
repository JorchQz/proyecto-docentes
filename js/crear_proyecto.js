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

  // ---------- Checkboxes de Grados (selección primaria) ----------
  const gradosCheckboxes = document.getElementById('gradosCheckboxes');

  function renderGradosCheckboxes() {
    if (!gradosCheckboxes) return;
    gradosCheckboxes.innerHTML = '';
    if (gradosUsuario.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-400';
      p.textContent = 'No hay grados registrados en tu grupo.';
      gradosCheckboxes.appendChild(p);
      return;
    }
    if (gradosUsuario.length > 1) {
      gradosCheckboxes.appendChild(makeSelectAll('selectAllGrados', 'Seleccionar todos', function () {
        gradosCheckboxes.querySelectorAll("input[name='grados']").forEach(c => c.checked = this.checked);
        renderFaseBadges();
      }));
    }
    gradosUsuario.forEach(grado => {
      const lbl = makeCheckbox('grados', String(grado), `${grado}°`);
      lbl.querySelector('input').addEventListener('change', renderFaseBadges);
      gradosCheckboxes.appendChild(lbl);
    });
  }

  // ---------- Fases (derivadas automáticamente de los grados seleccionados) ----------
  const faseCheckboxes = document.getElementById('faseCheckboxes');
  const fasesNEM = ['Fase 3', 'Fase 4', 'Fase 5'];

  function renderFaseBadges() {
    if (!faseCheckboxes) return;
    const gradosSeleccionados = Array.from(
      gradosCheckboxes.querySelectorAll("input[name='grados']:checked")
    ).map(c => parseInt(c.value));

    const fasesActivas = fasesNEM.filter(fase =>
      (faseGradosMap[fase] || []).some(g => gradosSeleccionados.includes(g))
    );

    faseCheckboxes.innerHTML = '';
    if (fasesActivas.length === 0) {
      faseCheckboxes.innerHTML = '<p class="text-sm text-gray-400">Selecciona al menos un grado.</p>';
      return;
    }
    fasesActivas.forEach(fase => {
      const wrapper = document.createElement('div');
      wrapper.className = 'inline-flex items-center gap-2';
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-100 text-blue-800 text-sm font-semibold';
      badge.textContent = fase;
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'fase';
      hidden.value = fase;
      wrapper.appendChild(badge);
      wrapper.appendChild(hidden);
      faseCheckboxes.appendChild(wrapper);
    });
  }

  renderGradosCheckboxes();
  renderFaseBadges();

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
        fase:               Array.from(formPaso1.querySelectorAll('input[name="fase"]')).map(el => el.value),
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

  let paso2Data = {}; // { [campo]: { contenidos_ids: [], pda_ids: [], contenidos_texto: [] } }
  let catalogoContenidos = [];
  let catalogoPDA = [];
  let catalogoCargaPromise = null;
  let catalogoCargado = false;
  let catalogoError = null;
  let renderContenidosToken = 0;

  async function cargarCatalogo() {
    if (catalogoCargado) {
      return { contenidos: catalogoContenidos, pdasCatalogo: catalogoPDA };
    }

    if (!catalogoCargaPromise) {
      catalogoCargaPromise = (async function () {
        const fasesActuales = paso1Data ? paso1Data.fase : [];
        const gradosActuales = paso1Data ? paso1Data.grados.map(Number) : [];

        const { data: contenidos, error: errorContenidos } = await window.sb
          .from('catalogo_contenidos')
          .select('id, fase, campo_formativo, contenido, orden')
          .in('fase', fasesActuales)
          .order('orden');

        if (errorContenidos) throw errorContenidos;

        const { data: pdasCatalogo, error: errorPda } = await window.sb
          .from('catalogo_pda')
          .select('id, contenido_id, grado, pda, criterio_valoracion, orden')
          .in('grado', gradosActuales)
          .order('orden');

        if (errorPda) throw errorPda;

        catalogoContenidos = Array.isArray(contenidos) ? contenidos : [];
        catalogoPDA = Array.isArray(pdasCatalogo) ? pdasCatalogo : [];
        catalogoCargado = true;
        catalogoError = null;

        return { contenidos: catalogoContenidos, pdasCatalogo: catalogoPDA };
      })().catch(function (error) {
        catalogoError = error;
        catalogoCargado = false;
        catalogoContenidos = [];
        catalogoPDA = [];
        throw error;
      }).finally(function () {
        catalogoCargaPromise = null;
      });
    }

    return catalogoCargaPromise;
  }

  async function renderContenidos() {
    const container = document.getElementById('contenidosContainer');
    if (!container) return;

    const token = ++renderContenidosToken;
    const campos = paso1Data ? paso1Data.campos_formativos : [];
    const grados = paso1Data ? paso1Data.grados.map(Number).sort(function (a, b) { return a - b; }) : [];
    const fases = paso1Data ? paso1Data.fase : [];

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function normalizeSavedCampo(saved) {
      const contenidosIds = Array.isArray(saved.contenidos_ids) ? saved.contenidos_ids.map(function (id) { return String(id); }) : [];
      const contenidosTexto = Array.isArray(saved.contenidos_texto) ? saved.contenidos_texto.map(function (texto) { return String(texto); }) : [];
      const pdaIds = Array.isArray(saved.pda_ids) ? saved.pda_ids.map(function (id) { return String(id); }) : [];

      if (contenidosIds.length === 0 && saved.contenido) {
        if (typeof saved.contenido === 'string' && saved.contenido.trim()) {
          contenidosTexto.push(saved.contenido.trim());
        } else if (typeof saved.contenido === 'object') {
          Object.keys(saved.contenido).forEach(function (key) {
            const texto = saved.contenido[key];
            if (typeof texto === 'string' && texto.trim()) {
              contenidosTexto.push(texto.trim());
            }
          });
        }
      }

      if (pdaIds.length === 0 && saved.pda && typeof saved.pda === 'object') {
        Object.keys(saved.pda).forEach(function (key) {
          const valor = saved.pda[key];
          if (Array.isArray(valor)) {
            valor.forEach(function (item) {
              if (item) pdaIds.push(String(item));
            });
          } else if (typeof valor === 'string' && valor.trim()) {
            pdaIds.push(String(valor.trim()));
          }
        });
      }

      return {
        contenidosIds: Array.from(new Set(contenidosIds)),
        contenidosTexto: Array.from(new Set(contenidosTexto.filter(Boolean))),
        pdaIds: Array.from(new Set(pdaIds)),
      };
    }

    function getCatalogoContenidosCampo(campo) {
      return catalogoContenidos.filter(function (item) {
        return String(item.campo_formativo) === String(campo);
      });
    }

    function getCatalogoPdaPorContenidoIds(contenidoIds) {
      const idsSet = new Set(contenidoIds.map(function (id) { return String(id); }));
      return catalogoPDA.filter(function (item) {
        return idsSet.has(String(item.contenido_id));
      });
    }

    function renderFallback(containerRef) {
      const mensaje = '<p class="text-red-600 text-sm font-medium mb-4">No se pudo cargar el catálogo. Puedes escribir los contenidos manualmente.</p>';
      containerRef.innerHTML = mensaje;

      campos.forEach(function (campo) {
        const saved = paso2Data[campo] || {};
        const div = document.createElement('div');
        div.className = 'campo-contenido-block border border-gray-200 rounded-xl p-5 bg-white mb-4';
        div.dataset.campo = campo;
        div.dataset.mode = 'fallback';

        const textosGuardados = Array.isArray(saved.contenidos_texto) ? saved.contenidos_texto : [];
        const pdaTextoGuardado = saved.pda_texto && typeof saved.pda_texto === 'object' ? saved.pda_texto : {};
        const columnas = Math.min(fases.length || 1, 3);

        let contenidoRows = '<div class="grid grid-cols-1 md:grid-cols-' + columnas + ' gap-4">';
        (fases.length > 0 ? fases : ['']).forEach(function (fase, index) {
          contenidoRows += `
            <div>
              <label class="block text-xs font-semibold text-blue-700 mb-1">${escapeHtml(fase || 'Fase')}</label>
              <textarea name="contenido_${escapeHtml(fase || 'unico')}" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Contenido para ${escapeHtml(fase || 'este campo')}...">${escapeHtml(textosGuardados[index] || '')}</textarea>
            </div>`;
        });
        contenidoRows += '</div>';

        let pdaRows = '<div class="grid grid-cols-1 md:grid-cols-' + Math.min(grados.length || 1, 3) + ' gap-4">';
        grados.forEach(function (grado) {
          const val = pdaTextoGuardado[grado] || pdaTextoGuardado[String(grado)] || '';
          pdaRows += `
            <div>
              <label class="block text-xs font-semibold text-blue-700 mb-1">${grado}°</label>
              <textarea name="pda_${grado}" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="PDA para ${grado}°...">${escapeHtml(val)}</textarea>
            </div>`;
        });
        pdaRows += '</div>';

        div.innerHTML = `
          <h3 class="font-bold text-gray-800 mb-4 text-base border-b pb-2">${escapeHtml(campo)}</h3>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-3">Contenido por fase</label>
            ${contenidoRows}
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-3">Procesos de Desarrollo de Aprendizaje (PDA) por grado</label>
            ${pdaRows}
          </div>`;

        containerRef.appendChild(div);
      });
    }

    function renderCatalogoCampo(containerRef, campo) {
      const saved = normalizeSavedCampo(paso2Data[campo] || {});
      const contenidosCampo = getCatalogoContenidosCampo(campo);
      const fasesCampo = Array.isArray(fases) ? fases.map(function (f) { return String(f); }) : [];
      let faseActiva = fasesCampo.length > 0 ? fasesCampo[0] : '';
      let selectedContenidoIds = Array.from(saved.contenidosIds);
      let selectedPdaIds = Array.from(saved.pdaIds);

      if (selectedContenidoIds.length === 0 && saved.contenidosTexto.length > 0) {
        saved.contenidosTexto.forEach(function (texto) {
          const encontrado = contenidosCampo.find(function (item) {
            return String(item.contenido || '').trim() === String(texto || '').trim();
          });
          if (encontrado && !selectedContenidoIds.includes(String(encontrado.id))) {
            selectedContenidoIds.push(String(encontrado.id));
          }
        });
      }

      const div = document.createElement('div');
      div.className = 'campo-contenido-block border border-gray-200 rounded-xl p-5 bg-white mb-4';
      div.dataset.campo = campo;
      div.dataset.mode = 'catalogo';

      div.innerHTML = `
        <h3 class="font-bold text-gray-800 mb-4 text-base border-b pb-2">${escapeHtml(campo)}</h3>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-3">Contenido oficial SEP</label>
          <div class="catalogo-fases flex gap-1 mb-3${fasesCampo.length > 1 ? '' : ' hidden'}"></div>
          <div class="relative">
            <input type="text" placeholder="Buscar contenido oficial SEP..."
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
            <div class="catalogo-dropdown absolute left-0 right-0 mt-1 z-50 bg-white shadow-lg border border-gray-200 rounded-xl hidden max-h-64 overflow-y-auto"></div>
          </div>
          <div class="catalogo-chips mt-3 flex flex-wrap gap-2"></div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-3">Procesos de Desarrollo de Aprendizaje (PDA)</label>
          <div class="catalogo-pda"></div>
        </div>`;

      const input = div.querySelector('input[type="text"]');
      const dropdown = div.querySelector('.catalogo-dropdown');
      const chipsContainer = div.querySelector('.catalogo-chips');
      const pdaContainer = div.querySelector('.catalogo-pda');
      const tabsContainer = div.querySelector('.catalogo-fases');

      function getContenidoSeleccionado() {
        return contenidosCampo.filter(function (item) {
          return selectedContenidoIds.includes(String(item.id));
        });
      }

      function getPdaFiltrados() {
        const contenidoIdsSet = new Set(selectedContenidoIds.map(function (id) { return String(id); }));
        return catalogoPDA.filter(function (item) {
          return contenidoIdsSet.has(String(item.contenido_id)) && grados.includes(Number(item.grado));
        });
      }

      function syncPdaSelection() {
        const validIds = new Set(getPdaFiltrados().map(function (item) { return String(item.id); }));
        selectedPdaIds = selectedPdaIds.filter(function (id) {
          return validIds.has(String(id));
        });
      }

      function renderChips() {
        const seleccionados = getContenidoSeleccionado();
        chipsContainer.innerHTML = seleccionados.map(function (item) {
          return `
            <span class="contenido-chip inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium" data-contenido-id="${escapeHtml(item.id)}" data-contenido-texto="${escapeHtml(item.contenido || '')}">
              <span>${escapeHtml(item.contenido || '')}</span>
              <button type="button" class="remove-contenido-btn inline-flex items-center justify-center text-blue-500 hover:text-blue-800 hover:bg-blue-200 p-0.5 rounded-full transition" data-id="${escapeHtml(item.id)}" aria-label="Quitar contenido">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
              </button>
            </span>`;
        }).join('');
      }

      function renderPdaSection() {
        const pdaFiltrados = getPdaFiltrados();
        if (selectedContenidoIds.length === 0) {
          pdaContainer.innerHTML = '<p class="text-gray-400 text-sm">Selecciona un contenido para ver los PDA</p>';
          return;
        }

        const grupos = {};
        pdaFiltrados.forEach(function (item) {
          const grado = Number(item.grado);
          if (!grados.includes(grado)) return;
          if (!grupos[grado]) grupos[grado] = [];
          grupos[grado].push(item);
        });

        const gradosConPDA = grados.filter(function (grado) {
          return grupos[grado] && grupos[grado].length > 0;
        });

        if (gradosConPDA.length === 0) {
          pdaContainer.innerHTML = '<p class="text-gray-400 text-sm">Selecciona un contenido para ver los PDA</p>';
          return;
        }

        pdaContainer.innerHTML = gradosConPDA.map(function (grado) {
          const items = grupos[grado].slice().sort(function (a, b) {
            return (Number(a.orden) || 0) - (Number(b.orden) || 0);
          });

          return `
            <div class="mb-4 last:mb-0">
              <div class="text-xs font-semibold text-blue-700 mb-2">${grado}°</div>
              <div class="space-y-3">
                ${items.map(function (item) {
                  const checked = selectedPdaIds.includes(String(item.id)) ? 'checked' : '';
                  const criterio = item.criterio_valoracion ? `<div class="text-xs text-gray-400 mt-1">${escapeHtml(item.criterio_valoracion)}</div>` : '';
                  return `
                    <label class="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" name="pda_ids" value="${escapeHtml(item.id)}" data-pda-id="${escapeHtml(item.id)}" class="form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500 mt-0.5" ${checked}>
                      <div class="flex-1">
                        <div class="text-sm text-gray-800">${escapeHtml(item.pda || '')}</div>
                        ${criterio}
                      </div>
                    </label>`;
                }).join('')}
              </div>
            </div>`;
        }).join('');
      }

      function renderTabs() {
        if (!tabsContainer || fasesCampo.length <= 1) return;
        tabsContainer.innerHTML = fasesCampo.map(function (fase) {
          const activa = fase === faseActiva;
          const clases = activa
            ? 'px-3 py-1 text-sm rounded-lg bg-blue-600 text-white font-medium cursor-pointer'
            : 'px-3 py-1 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer';
          return '<button type="button" class="fase-tab ' + clases + '" data-fase="' + escapeHtml(fase) + '">' + escapeHtml(fase) + '</button>';
        }).join('');
      }

      function renderDropdown() {
        const query = String(input.value || '').toLowerCase().trim();
        const resultados = contenidosCampo.filter(function (item) {
          const texto = String(item.contenido || '');
          const pasaFase = !faseActiva || String(item.fase || '') === String(faseActiva);
          const pasaTexto = query === '' || texto.toLowerCase().includes(query);
          return pasaFase && pasaTexto;
        }).slice(0, 8);

        if (resultados.length === 0) {
          dropdown.innerHTML = '<div class="px-3 py-2 text-sm text-gray-400">Sin resultados</div>';
        } else {
          dropdown.innerHTML = resultados.map(function (item) {
            return `
              <div class="contenido-option px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer" data-id="${escapeHtml(item.id)}" data-texto="${escapeHtml(item.contenido || '')}">
                ${escapeHtml(item.contenido || '')}
              </div>`;
          }).join('');
        }

        dropdown.classList.remove('hidden');
      }

      function closeDropdown() {
        dropdown.classList.add('hidden');
      }

      function refresh() {
        syncPdaSelection();
        renderChips();
        renderPdaSection();
      }

      input.addEventListener('input', renderDropdown);
      input.addEventListener('focus', renderDropdown);
      input.addEventListener('blur', function () {
        setTimeout(closeDropdown, 120);
      });

      tabsContainer?.addEventListener('click', function (event) {
        const tab = event.target.closest('.fase-tab');
        if (!tab) return;
        const nuevaFase = String(tab.dataset.fase || '');
        if (!nuevaFase || nuevaFase === faseActiva) return;
        faseActiva = nuevaFase;
        renderTabs();
        renderDropdown();
      });

      dropdown.addEventListener('mousedown', function (event) {
        const option = event.target.closest('.contenido-option');
        if (!option) return;
        event.preventDefault();
        const contenidoId = String(option.dataset.id || '');
        if (contenidoId && !selectedContenidoIds.includes(contenidoId)) {
          selectedContenidoIds.push(contenidoId);
        }
        input.value = '';
        closeDropdown();
        refresh();
      });

      chipsContainer.addEventListener('click', function (event) {
        const btn = event.target.closest('.remove-contenido-btn');
        if (!btn) return;
        const contenidoId = String(btn.dataset.id || '');
        selectedContenidoIds = selectedContenidoIds.filter(function (id) {
          return String(id) !== contenidoId;
        });
        closeDropdown();
        refresh();
      });

      pdaContainer.addEventListener('change', function (event) {
        const checkbox = event.target.closest('input[name="pda_ids"]');
        if (!checkbox) return;
        const pdaId = String(checkbox.value || checkbox.dataset.pdaId || '');
        if (!pdaId) return;
        if (checkbox.checked) {
          if (!selectedPdaIds.includes(pdaId)) selectedPdaIds.push(pdaId);
        } else {
          selectedPdaIds = selectedPdaIds.filter(function (id) {
            return String(id) !== pdaId;
          });
        }
      });

      refresh();
      renderTabs();
      closeDropdown();
      containerRef.appendChild(div);
    }

    if (campos.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm">No hay campos formativos seleccionados.</p>';
      return;
    }

    container.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Cargando catálogo SEP...</p>';

    try {
      await cargarCatalogo();
    } catch (error) {
      // fallback manual
    }

    if (token !== renderContenidosToken) return;

    container.innerHTML = '';

    if (catalogoError) {
      renderFallback(container);
      return;
    }

    campos.forEach(function (campo) {
      renderCatalogoCampo(container, campo);
    });
  }

  function _saveContenidosState() {
    document.querySelectorAll('.campo-contenido-block').forEach(function (block) {
      const campo = block.dataset.campo;
      if (!campo) return;

      if ((block.dataset.mode || 'catalogo') === 'fallback') {
        const contenidosTexto = [];
        block.querySelectorAll('textarea[name^="contenido_"]').forEach(function (ta) {
          const texto = ta.value.trim();
          if (texto) contenidosTexto.push(texto);
        });

        const pdaTexto = {};
        block.querySelectorAll('textarea[name^="pda_"]').forEach(function (ta) {
          const grado = ta.name.replace('pda_', '');
          pdaTexto[grado] = ta.value;
        });

        paso2Data[campo] = {
          contenidos_ids: [],
          pda_ids: [],
          contenidos_texto: contenidosTexto,
          pda_texto: pdaTexto,
        };
        return;
      }

      const contenidosIds = [];
      const contenidosTexto = [];
      block.querySelectorAll('.contenido-chip').forEach(function (chip) {
        const contenidoId = String(chip.dataset.contenidoId || '').trim();
        const contenidoTexto = String(chip.dataset.contenidoTexto || '').trim();
        if (contenidoId) contenidosIds.push(contenidoId);
        if (contenidoTexto) contenidosTexto.push(contenidoTexto);
      });

      const pdaIds = Array.from(block.querySelectorAll('input[name="pda_ids"]:checked')).map(function (input) {
        return String(input.value || input.dataset.pdaId || '').trim();
      }).filter(Boolean);

      paso2Data[campo] = {
        contenidos_ids: Array.from(new Set(contenidosIds)),
        pda_ids: Array.from(new Set(pdaIds)),
        contenidos_texto: Array.from(new Set(contenidosTexto)),
      };
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

  function buildDidacticSection(key, label, includeTareas) {
    const sectionColors = {
      inicio:     { border: 'border-l-blue-400',    text: 'text-blue-800',    bg: 'bg-blue-50' },
      desarrollo: { border: 'border-l-violet-500',  text: 'text-violet-800',  bg: 'bg-violet-50' },
      cierre:     { border: 'border-l-emerald-500', text: 'text-emerald-800', bg: 'bg-emerald-50' },
    };
    const col = sectionColors[key] || { border: 'border-l-gray-400', text: 'text-gray-700', bg: 'bg-gray-50' };

    const grados = paso1Data ? paso1Data.grados.map(Number).sort((a, b) => a - b) : [];
    const cols = Math.min(grados.length || 2, 3);

    function makeItemList(listKey, placeholder, addLabel, sectionLabel) {
      return `
        <div class="item-list-container mt-3 border-t border-gray-200 pt-3" data-key="${listKey}" data-placeholder="${placeholder}">
          <p class="text-xs font-semibold text-gray-500 mb-1.5">${sectionLabel}</p>
          <div class="item-list flex flex-col gap-1.5"></div>
          <button type="button" class="add-item-btn mt-1.5 flex items-center gap-1.5 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            ${addLabel}
          </button>
        </div>`;
    }

    let difCols = '';
    const gradoKeys = grados.length > 0 ? grados : ['A', 'B'];
    gradoKeys.forEach(function (g) {
      const isNum = grados.length > 0;
      difCols += `
        <div>
          <label class="block text-xs font-semibold text-blue-700 mb-1">${isNum ? g + '°' : 'Grupo ' + g}</label>
          <textarea name="${key}_grado_${g}" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="${isNum ? 'Descripción para ' + g + '°...' : 'Descripción para este grupo...'}"></textarea>
          ${makeItemList(`${key}_act_dif_${g}`, isNum ? `Actividad para ${g}°...` : 'Actividad...', 'Agregar actividad', 'Actividades')}
          ${includeTareas ? makeItemList(`${key}_tarea_dif_${g}`, isNum ? `Tarea para ${g}°...` : 'Tarea...', 'Agregar tarea', 'Tareas para casa') : ''}
        </div>`;
    });

    return `
      <div class="didactic-section border border-gray-200 border-l-4 ${col.border} rounded-xl p-4 ${col.bg}"
           data-section="${key}" data-mode="todos">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span class="font-bold ${col.text} text-sm uppercase tracking-wide">${label}</span>
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
            placeholder="Descripción de ${label.toLowerCase()} para todos los grados..."></textarea>
          ${makeItemList(`${key}_act_todos`, 'Actividad en clase...', 'Agregar actividad', 'Actividades')}
          ${includeTareas ? makeItemList(`${key}_tarea_todos`, 'Tarea para casa...', 'Agregar tarea', 'Tareas para casa') : ''}
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

    const gradosSesion = Array.from(new Set((paso1Data?.grados || []).map(function (g) {
      return parseInt(g, 10);
    }).filter(function (g) {
      return !Number.isNaN(g);
    }))).sort(function (a, b) {
      return a - b;
    });

    const todosLosPdaIds = Array.from(new Set(Object.values(paso2Data || {}).flatMap(function (cf) {
      return Array.isArray(cf?.pda_ids) ? cf.pda_ids : [];
    }).map(function (id) {
      return String(id);
    }).filter(Boolean)));

    const hayCatalogoPda = Array.isArray(catalogoPDA) && catalogoPDA.length > 0;
    const mostrarBloquePda = hayCatalogoPda && todosLosPdaIds.length > 0;

    function getPdaOptionsForGrade(grado) {
      return (catalogoPDA || []).filter(function (pda) {
        return todosLosPdaIds.includes(String(pda.id)) && Number(pda.grado) === Number(grado);
      }).sort(function (a, b) {
        return (Number(a.orden) || 0) - (Number(b.orden) || 0);
      });
    }

    div.innerHTML = `
      <button type="button" class="session-toggle w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition text-left">
        <span class="session-label font-semibold text-gray-700">Sesión ${num} — — </span>
        <span class="toggle-icon text-gray-400 transition-transform duration-200 inline-block">▼</span>
      </button>
      <div class="session-body p-5 flex flex-col gap-5">

        <!-- Datos básicos de la sesión -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Duración (opcional)</label>
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
        ${buildDidacticSection('cierre', 'Cierre', true)}

        <!-- Recursos y material didáctico -->
        <div class="border border-gray-200 border-l-4 border-l-amber-500 rounded-xl p-4 bg-amber-50">
          <span class="font-bold text-amber-800 text-sm uppercase tracking-wide block mb-3">Recursos y material didáctico</span>
          ${window.sb ? `
          <div class="space-y-5">
            <div>
              <div class="text-xs font-semibold text-gray-500 mb-2">Archivos</div>
              <input type="file" multiple class="w-full text-sm file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 border border-gray-300 rounded-xl px-3 py-2 bg-white">
              <p class="resource-files-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-files-list mt-3 flex flex-wrap gap-2"></div>
            </div>
            <div>
              <div class="text-xs font-semibold text-gray-500 mb-2">Links externos</div>
              <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                <input type="url"
                  class="resource-link-url w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  placeholder="Pega la URL del link...">
                <input type="text"
                  class="resource-link-title w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  placeholder="Nombre del link (opcional)">
                <button type="button"
                  class="resource-link-add px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition">
                  Agregar
                </button>
              </div>
              <p class="resource-links-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-links-list mt-3 flex flex-wrap gap-2"></div>
            </div>
          </div>` : `
          <textarea name="recursos" rows="2"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            placeholder="Materiales necesarios..."></textarea>`}
        </div>

        <!-- Campos adicionales -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
            <textarea name="observaciones" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Notas adicionales..."></textarea>
          </div>
        </div>

        ${mostrarBloquePda ? `
        <div class="pt-2 border-t border-gray-100">
          <label class="block text-sm font-medium text-gray-700 mb-3">PDA que se trabaja en esta sesión</label>
          <div class="space-y-3">
            ${gradosSesion.map(function (grado, index) {
              const opciones = getPdaOptionsForGrade(grado);
              const ultimo = index === gradosSesion.length - 1;
              return `
                <div class="${ultimo ? '' : 'border-b border-gray-100 pb-3 mb-3'}">
                  <div class="text-xs font-semibold text-blue-700 mb-2">Grado ${grado}°</div>
                  <select name="pda_select_grado_${grado}"
                    class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    <option value="">Selecciona PDA para ${grado}°...</option>
                    ${opciones.map(function (pda) {
                      return `<option value="${String(pda.id)}">${String(pda.pda || '')}</option>`;
                    }).join('')}
                  </select>
                  <div id="sugerencia_grado_${grado}" class="hidden text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-1"></div>
                  <textarea name="criterio_grado_${grado}" rows="2"
                    class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 mt-2"
                    placeholder="Criterio de evaluación para ${grado}°..."></textarea>
                </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Botón eliminar -->
        <div class="flex justify-end pt-2 border-t border-gray-100">
          <button type="button" class="btn-eliminar bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-sm font-bold px-4 py-2 rounded-xl transition">
            Eliminar sesión
          </button>
        </div>
      </div>`;

    // Acordeón: toggle del cuerpo
    div.querySelector('.session-toggle').addEventListener('click', function () {
      const body = div.querySelector('.session-body');
      const icon = div.querySelector('.toggle-icon');
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      icon.style.transform = open ? 'rotate(-90deg)' : '';
    });

    // Actualizar etiqueta del header cuando cambian fecha o momento
    div.querySelector('.session-fecha').addEventListener('change', () => updateLabel(div));
    div.querySelector('.session-momento').addEventListener('change', () => updateLabel(div));

    const recursosFilesInput = div.querySelector('input[type="file"]');
    const recursosFilesList = div.querySelector('.resource-files-list');
    const recursosFilesError = div.querySelector('.resource-files-error');
    const recursosLinkUrl = div.querySelector('.resource-link-url');
    const recursosLinkTitle = div.querySelector('.resource-link-title');
    const recursosLinkAdd = div.querySelector('.resource-link-add');
    const recursosLinksList = div.querySelector('.resource-links-list');
    const recursosLinksError = div.querySelector('.resource-links-error');

    let archivosSubidos = [];
    let linksAgregados = [];
    const tempRecursosId = `temp_${Date.now()}`;

    function syncRecursosState() {
      div._archivos = archivosSubidos;
      div._links = linksAgregados;
    }

    function truncarTexto(texto, limite) {
      const valor = String(texto || '');
      return valor.length > limite ? valor.slice(0, limite - 1) + '…' : valor;
    }

    function mostrarError(elemento, mensaje) {
      if (!elemento) return;
      elemento.textContent = mensaje || '';
      elemento.classList.toggle('hidden', !mensaje);
    }

    function renderArchivos() {
      if (!recursosFilesList) return;
      recursosFilesList.innerHTML = archivosSubidos.map(function (archivo) {
        const etiqueta = truncarTexto(archivo.nombre || '', 30);
        return `
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-50 border border-blue-100 text-blue-800" data-path="${String(archivo.path || '')}">
            <span>📎</span>
            <span title="${String(archivo.nombre || '')}">${String(etiqueta)}</span>
            <button type="button" class="resource-remove-file text-gray-400 hover:text-red-500 transition ml-1 text-xs font-bold" data-path="${String(archivo.path || '')}" aria-label="Eliminar archivo">X</button>
          </span>`;
      }).join('');
      syncRecursosState();
    }

    function renderLinks() {
      if (!recursosLinksList) return;
      recursosLinksList.innerHTML = linksAgregados.map(function (link, index) {
        const titulo = link.titulo && String(link.titulo).trim() ? String(link.titulo).trim() : truncarTexto(link.url || '', 30);
        return `
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-green-50 border border-green-100 text-green-800" data-index="${index}">
            <span>🔗</span>
            <span title="${String(link.url || '')}">${String(titulo)}</span>
            <button type="button" class="resource-remove-link text-gray-400 hover:text-red-500 transition ml-1 text-xs font-bold" data-index="${index}" aria-label="Eliminar link">X</button>
          </span>`;
      }).join('');
      syncRecursosState();
    }

    async function subirArchivo(file) {
      const { data: { user } } = await window.sb.auth.getUser();
      if (!user) throw new Error('No hay sesión activa para subir archivos.');

      const ruta = `recursos/${user.id}/${tempRecursosId}/sesion_${num}/${file.name}`;
      const pendingChip = document.createElement('span');
      pendingChip.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-50 border border-blue-100 text-blue-800';
      pendingChip.dataset.pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingChip.innerHTML = `<span>📎</span><span title="${String(file.name)}">${String(truncarTexto(file.name, 30))} · Subiendo...</span>`;
      recursosFilesList?.appendChild(pendingChip);

      const { error: uploadError } = await window.sb.storage.from('recursos').upload(ruta, file, { upsert: false });
      if (uploadError) throw uploadError;

      let urlPublica = null;
      try {
        const { data: signedData, error: signedError } = await window.sb.storage.from('recursos').createSignedUrl(ruta, 31536000);
        if (signedError) throw signedError;
        urlPublica = signedData?.signedUrl || null;
      } catch (signedUrlError) {
        mostrarError(recursosFilesError, 'El archivo se subió, pero no se pudo generar el enlace seguro.');
      }

      pendingChip.outerHTML = `
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-50 border border-blue-100 text-blue-800" data-path="${String(ruta)}">
          <span>📎</span>
          <span title="${String(file.name)}">${String(truncarTexto(file.name, 30))}</span>
          <button type="button" class="resource-remove-file text-gray-400 hover:text-red-500 transition ml-1 text-xs font-bold" data-path="${String(ruta)}" aria-label="Eliminar archivo">X</button>
        </span>`;

      archivosSubidos.push({ nombre: file.name, path: ruta, url: urlPublica });
      syncRecursosState();
      renderArchivos();
    }

    if (recursosFilesInput) {
      recursosFilesInput.addEventListener('change', async function () {
        mostrarError(recursosFilesError, '');
        const files = Array.from(recursosFilesInput.files || []);
        recursosFilesInput.value = '';
        for (const file of files) {
          try {
            await subirArchivo(file);
          } catch (err) {
            console.error('Error subiendo archivo:', err);
            mostrarError(recursosFilesError, 'No se pudo subir "' + file.name + '". Puedes continuar sin ese archivo.');
          }
        }
      });
    }

    recursosFilesList?.addEventListener('click', async function (event) {
      const btn = event.target.closest('.resource-remove-file');
      if (!btn) return;
      const path = String(btn.dataset.path || '');
      if (!path) return;
      try {
        const { error } = await window.sb.storage.from('recursos').remove([path]);
        if (error) throw error;
        archivosSubidos = archivosSubidos.filter(function (archivo) {
          return String(archivo.path || '') !== path;
        });
        renderArchivos();
      } catch (err) {
        console.error('Error eliminando archivo:', err);
        mostrarError(recursosFilesError, 'No se pudo eliminar el archivo. Intenta de nuevo.');
      }
    });

    recursosLinkAdd?.addEventListener('click', function () {
      mostrarError(recursosLinksError, '');
      const url = String(recursosLinkUrl?.value || '').trim();
      const titulo = String(recursosLinkTitle?.value || '').trim();
      if (!url) {
        mostrarError(recursosLinksError, 'Agrega una URL válida para continuar.');
        return;
      }
      linksAgregados.push({ titulo: titulo, url: url });
      if (recursosLinkUrl) recursosLinkUrl.value = '';
      if (recursosLinkTitle) recursosLinkTitle.value = '';
      renderLinks();
    });

    recursosLinksList?.addEventListener('click', function (event) {
      const btn = event.target.closest('.resource-remove-link');
      if (!btn) return;
      const index = parseInt(btn.dataset.index, 10);
      if (Number.isNaN(index)) return;
      linksAgregados.splice(index, 1);
      renderLinks();
    });

    syncRecursosState();
    renderArchivos();
    renderLinks();

    if (mostrarBloquePda) {
      gradosSesion.forEach(function (grado) {
        const select = div.querySelector(`[name="pda_select_grado_${grado}"]`);
        const sugerencia = div.querySelector(`#sugerencia_grado_${grado}`);
        const criterioTextarea = div.querySelector(`[name="criterio_grado_${grado}"]`);

        if (!select || !sugerencia || !criterioTextarea) return;

        select.addEventListener('change', function () {
          const pdaSeleccionado = (catalogoPDA || []).find(function (p) {
            return String(p.id) === String(select.value);
          });

          if (pdaSeleccionado && pdaSeleccionado.criterio_valoracion) {
            sugerencia.textContent = '💡 Criterio sugerido: ' + pdaSeleccionado.criterio_valoracion;
            sugerencia.classList.remove('hidden');
            criterioTextarea.value = pdaSeleccionado.criterio_valoracion;
          } else {
            sugerencia.textContent = '';
            sugerencia.classList.add('hidden');
          }
        });
      });
    }

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

    // Listas dinámicas (Tareas y Actividades)
    div.querySelectorAll('.item-list-container').forEach(function (container) {
      const list = container.querySelector('.item-list');
      const key = container.dataset.key;

      container.querySelector('.add-item-btn').addEventListener('click', function () {
        const placeholder = container.dataset.placeholder || '';
        const newRow = document.createElement('div');
        newRow.className = 'item-row flex gap-2 items-center';
        newRow.innerHTML = `
          <input type="text" name="${key}_item"
            class="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="${placeholder}">
          <button type="button" class="remove-item-btn text-red-400 hover:text-red-600 p-1 rounded transition" aria-label="Eliminar">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>`;
        list.appendChild(newRow);
        newRow.querySelector('input').focus();
      });

      list.addEventListener('click', function (e) {
        const btn = e.target.closest('.remove-item-btn');
        if (!btn) return;
        btn.closest('.item-row').remove();
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
    const container = document.getElementById('sesionesContainer');
    const num = container.querySelectorAll('.session-block').length + 1;
    container.appendChild(createSessionBlock(num));
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

        function getItems(selector) {
          return Array.from(block.querySelectorAll(selector))
            .map(i => i.value.trim()).filter(Boolean);
        }

        function getBlockActividades(sectionKey, sectionMode) {
          if (sectionMode === 'todos') {
            return { mode: 'todos', todos: getItems(`input[name="${sectionKey}_act_todos_item"]`), diferenciado: null };
          }
          const dif = {};
          block.querySelectorAll(`input[name^="${sectionKey}_act_dif_"]`).forEach(function (input) {
            const m = input.name.match(new RegExp('^' + sectionKey + '_act_dif_(.+)_item$'));
            if (m) {
              const gr = m[1];
              if (!dif[gr]) dif[gr] = [];
              const v = input.value.trim();
              if (v) dif[gr].push(v);
            }
          });
          return { mode: 'diferenciado', todos: null, diferenciado: Object.keys(dif).length > 0 ? dif : null };
        }

        function getBlockTareas(sectionMode) {
          if (sectionMode === 'todos') {
            return { mode: 'todos', todos: getItems('input[name="cierre_tarea_todos_item"]'), diferenciado: null };
          }
          const dif = {};
          block.querySelectorAll('input[name^="cierre_tarea_dif_"]').forEach(function (input) {
            const m = input.name.match(/^cierre_tarea_dif_(.+)_item$/);
            if (m) {
              const gr = m[1];
              if (!dif[gr]) dif[gr] = [];
              const v = input.value.trim();
              if (v) dif[gr].push(v);
            }
          });
          return { mode: 'diferenciado', todos: null, diferenciado: Object.keys(dif).length > 0 ? dif : null };
        }

        return {
          proyecto_id:             proyecto.id,
          maestro_id:              user.id,
          numero_sesion:           idx + 1,
          duracion:                g('duracion') || '',
          fecha:                   g('fecha') || null,
          campo_formativo:         g('campo_formativo'),
          momento:                 g('momento'),
          inicio_todos:            mI === 'todos'        ? g('inicio_todos')        : null,
          inicio_diferenciado:     mI === 'diferenciado' ? getDifData('inicio')     : null,
          inicio_actividades:      getBlockActividades('inicio', mI),
          desarrollo_todos:        mD === 'todos'        ? g('desarrollo_todos')    : null,
          desarrollo_diferenciado: mD === 'diferenciado' ? getDifData('desarrollo') : null,
          desarrollo_actividades:  getBlockActividades('desarrollo', mD),
          cierre_todos:            mC === 'todos'        ? g('cierre_todos')        : null,
          cierre_diferenciado:     mC === 'diferenciado' ? getDifData('cierre')     : null,
          cierre_actividades:      getBlockActividades('cierre', mC),
          cierre_tareas:           getBlockTareas(mC),
          recursos:                {
            archivos: block._archivos || [],
            links: block._links || []
          },
          pda_sesion: (function() {
            const resultado = [];
            (paso1Data.grados || []).forEach(function(g) {
              const gNum = parseInt(g, 10);
              const pdaId = block.querySelector(`[name="pda_select_grado_${gNum}"]`)?.value || null;
              const criterio = block.querySelector(`[name="criterio_grado_${gNum}"]`)?.value?.trim() || null;
              if (!pdaId && !criterio) return;
              const pda = (catalogoPDA || []).find(function(p) { return p.id === pdaId; });
              resultado.push({
                grado: gNum,
                pda_id: pdaId,
                pda_texto: pda ? pda.pda : null,
                criterio_aplicado: criterio
              });
            });
            return resultado.length > 0 ? resultado : null;
          })(),
          observaciones:           g('observaciones'),
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
      btn.textContent = 'Guardar proyecto';
    }
  });

});
