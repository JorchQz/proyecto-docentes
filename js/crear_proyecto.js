document.addEventListener("DOMContentLoaded", async function () {

  function _toast(msg, type) {
    var existing = document.getElementById('_cp_toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = '_cp_toast';
    var bg = type === 'error' ? 'bg-red-600' : 'bg-green-600';
    el.className = 'fixed bottom-4 right-4 z-50 ' + bg + ' text-white px-4 py-3 rounded-xl shadow-lg text-sm';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  const DRAFT_KEY = 'borradorProyectoActivo';

  // Detección de modo edición (URL ?id=xxx)
  const _urlParams = new URLSearchParams(window.location.search);
  const editProyectoId = _urlParams.get('id');
  let proyectoId = editProyectoId || null;

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
  if (!editProyectoId) { checkAndShowDraftBanner(); }

  document.getElementById('btnContinuarBorrador')?.addEventListener('click', restoreDraft);
  document.getElementById('btnDescartarBorrador')?.addEventListener('click', function () {
    clearDraft();
    document.getElementById('borradorBanner')?.classList.add('hidden');
  });
  document.getElementById('btnGuardarBorrador1')?.addEventListener('click', saveDraft);

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
        fase:               Array.from(formPaso1.querySelectorAll('input[name="fase"]')).map(el => el.value),
        grados:             Array.from(formPaso1.querySelectorAll('input[name="grados"]:checked')).map(el => el.value),
        metodologia:        fd.get('metodologia'),
        escenario:          fd.get('escenario'),
        campos_formativos:  Array.from(formPaso1.querySelectorAll('input[name="campos_formativos"]:checked')).map(el => el.value),
        ejes_articuladores: Array.from(formPaso1.querySelectorAll('input[name="ejes_articuladores"]:checked')).map(el => el.value),
        proposito:          fd.get('proposito'),
        pregunta_generadora: fd.get('pregunta_generadora'),
      };
      saveDraft();
      step1.classList.add('hidden');
      step2contenidos.classList.remove('hidden');
      window.scrollTo(0, 0);
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
    window.scrollTo(0, 0);
  });

  document.getElementById('btnIrPaso3')?.addEventListener('click', function () {
    _saveContenidosState();
    saveDraft();
    step2contenidos.classList.add('hidden');
    step2.classList.remove('hidden');
    window.scrollTo(0, 0);
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
      rebuildAllPdaBlocks();
    }

    // Restaurar sesiones del borrador si hay pendientes
    if (restoreDraft._sesiones && restoreDraft._sesiones.length) {
      restoreSessionBlocks(restoreDraft._sesiones);
      restoreDraft._sesiones = null;
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
      inicio:     { border: 'border-l-blue-400', text: 'text-gray-700', bg: 'bg-gray-50' },
      desarrollo: { border: 'border-l-violet-500', text: 'text-gray-700', bg: 'bg-gray-50' },
      cierre:     { border: 'border-l-emerald-500', text: 'text-gray-700', bg: 'bg-gray-50' },
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
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden"
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
          <div class="flex items-center gap-2 mb-1">
            <button type="button" class="list-format-btn flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition" data-active="false" title="Activar lista con viñetas (• )">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
              Lista
            </button>
            <span class="at-hint text-xs text-gray-400 hidden">Escribe @ para citar una actividad</span>
          </div>
          <textarea name="${key}_todos" rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden"
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

  function renumberItems(list) {
    list.querySelectorAll('.item-row').forEach(function (row, i) {
      const badge = row.querySelector('.activity-num');
      if (badge) badge.textContent = i + 1;
    });
  }

  function setupAtMention(textarea, section, sectionKey, listKeySuffix) {
    let dropdown = null;
    const resolvedListKey = sectionKey + (listKeySuffix || '_act_todos');

    function getActivitiesFromSection() {
      const listContainer = section.querySelector('.item-list-container[data-key="' + resolvedListKey + '"]');
      if (!listContainer) return [];
      const items = [];
      listContainer.querySelectorAll('.item-row').forEach(function (row, i) {
        const el = row.querySelector('[name="' + resolvedListKey + '_item"]');
        items.push({ ref: '@actividad_' + (i + 1), text: el ? el.value.trim() : '', num: i + 1 });
      });
      return items;
    }

    function hideDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
    }

    function insertRef(ref, replaceLen) {
      const pos = textarea.selectionStart;
      const val = textarea.value;
      const before = val.slice(0, pos - replaceLen);
      const after = val.slice(pos);
      textarea.value = before + ref + after;
      const newPos = before.length + ref.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    }

    function showDropdown(items, replaceLen) {
      hideDropdown();
      const wrapper = textarea.parentElement;
      if (!wrapper) return;
      if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

      dropdown = document.createElement('div');
      dropdown.className = 'absolute z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-64 max-h-48 overflow-y-auto';
      dropdown.style.top = (textarea.offsetTop + textarea.offsetHeight + 4) + 'px';
      dropdown.style.left = textarea.offsetLeft + 'px';

      items.forEach(function (item) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2';
        opt.innerHTML = '<span class="font-mono text-blue-600 text-xs font-bold shrink-0">' + escapeHtml(item.ref) + '</span>' +
          (item.text
            ? '<span class="text-gray-600 truncate">' + escapeHtml(item.text) + '</span>'
            : '<span class="text-gray-400 italic text-xs">sin texto aún</span>');
        opt.addEventListener('mousedown', function (e) {
          e.preventDefault();
          insertRef(item.ref, replaceLen);
          hideDropdown();
        });
        dropdown.appendChild(opt);
      });

      wrapper.appendChild(dropdown);
    }

    textarea.addEventListener('input', function () {
      const val = this.value;
      const pos = this.selectionStart;
      const textBefore = val.slice(0, pos);
      const atMatch = textBefore.match(/@(\w*)$/);
      if (!atMatch) { hideDropdown(); return; }

      const query = atMatch[1].toLowerCase();
      const activities = getActivitiesFromSection();
      if (!activities.length) { hideDropdown(); return; }

      const filtered = activities.filter(function (a) {
        return a.ref.toLowerCase().includes(query) || a.text.toLowerCase().includes(query);
      });
      if (!filtered.length) { hideDropdown(); return; }

      showDropdown(filtered, atMatch[0].length);
    });

    textarea.addEventListener('keydown', function (e) {
      if (dropdown && e.key === 'Escape') { hideDropdown(); e.preventDefault(); }
    });

    textarea.addEventListener('blur', function () {
      setTimeout(hideDropdown, 200);
    });

    // Mostrar pista del @ cuando hay al menos una actividad
    const hint = section.querySelector('.at-hint');
    const listContainerForHint = section.querySelector('.item-list-container[data-key="' + sectionKey + '_act_todos"]');
    if (hint && listContainerForHint) {
      const observer = new MutationObserver(function () {
        const count = listContainerForHint.querySelectorAll('.item-row').length;
        hint.classList.toggle('hidden', count === 0);
      });
      observer.observe(listContainerForHint, { childList: true, subtree: false });
    }
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
        <div class="border border-gray-200 border-l-4 border-l-amber-500 rounded-xl p-4 bg-gray-50">
          <span class="font-bold text-gray-700 text-sm uppercase tracking-wide block mb-3">Recursos y material didáctico</span>
          ${window.sb ? `
          <div class="space-y-5">
            <div>
              <div class="text-xs font-semibold text-gray-500 mb-2">Archivos</div>
              <input type="file" multiple class="w-full text-sm file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 border border-gray-300 rounded-xl px-3 py-2 bg-white">
              <p class="resource-files-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-files-list mt-3 flex flex-wrap gap-2"></div>
            </div>
            <div>
              <div class="text-xs font-semibold text-gray-500 mb-2">Links externos</div>
              <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                <input type="url"
                  class="resource-link-url w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  placeholder="Pega la URL del link...">
                <input type="text"
                  class="resource-link-title w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  placeholder="Nombre del link (opcional)">
                <button type="button"
                  class="resource-link-add px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">
                  Agregar
                </button>
              </div>
              <p class="resource-links-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-links-list mt-3 flex flex-wrap gap-2"></div>
            </div>
          </div>` : `
          <textarea name="recursos" rows="2"
            class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
            placeholder="Materiales necesarios..."></textarea>`}
        </div>

        ${mostrarBloquePda ? `
        <div class="pda-block border border-gray-200 border-l-4 border-l-rose-400 rounded-xl p-4 bg-gray-50">
          <span class="font-bold text-gray-700 text-sm uppercase tracking-wide block mb-3">
            PDA por grado
          </span>
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
                  <div id="sugerencia_grado_${grado}" class="hidden text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mt-1"></div>
                  <textarea name="criterio_grado_${grado}" rows="2"
                    class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 mt-2"
                    placeholder="Criterio de evaluación para ${grado}°..."></textarea>
                </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Campos adicionales -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
            <textarea name="observaciones" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Notas adicionales..."></textarea>
          </div>
        </div>

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

    // Actualizar etiqueta del header cuando cambia la secuencia
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
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800" data-path="${escapeHtml(archivo.path || '')}">
            <span>📎</span>
            <span title="${escapeHtml(archivo.nombre || '')}">${escapeHtml(etiqueta)}</span>
            <button type="button" class="resource-remove-file inline-flex items-center justify-center text-gray-400 hover:text-red-500 p-0.5 rounded-full transition" data-path="${escapeHtml(archivo.path || '')}" aria-label="Eliminar archivo">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </span>`;
      }).join('');
      syncRecursosState();
    }

    function renderLinks() {
      if (!recursosLinksList) return;
      recursosLinksList.innerHTML = linksAgregados.map(function (link, index) {
        const titulo = link.titulo && String(link.titulo).trim() ? String(link.titulo).trim() : truncarTexto(link.url || '', 30);
        return `
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800" data-index="${index}">
            <span>🔗</span>
            <span title="${escapeHtml(link.url || '')}">${escapeHtml(titulo)}</span>
            <button type="button" class="resource-remove-link inline-flex items-center justify-center text-gray-400 hover:text-red-500 p-0.5 rounded-full transition" data-index="${index}" aria-label="Eliminar link">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </span>`;
      }).join('');
      syncRecursosState();
    }

    async function subirArchivo(file) {
      const { data: { user } } = await window.sb.auth.getUser();
      if (!user) throw new Error('No hay sesión activa para subir archivos.');

      const ruta = `recursos/${user.id}/${tempRecursosId}/sesion_${num}/${file.name}`;
      const pendingChip = document.createElement('span');
      pendingChip.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800';
      pendingChip.dataset.pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingChip.innerHTML = `<span>📎</span><span title="${escapeHtml(file.name)}">${escapeHtml(truncarTexto(file.name, 30))} · Subiendo...</span>`;
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
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800" data-path="${String(ruta)}">
          <span>📎</span>
          <span title="${String(file.name)}">${String(truncarTexto(file.name, 30))}</span>
          <button type="button" class="resource-remove-file inline-flex items-center justify-center text-gray-400 hover:text-red-500 p-0.5 rounded-full transition" data-path="${String(ruta)}" aria-label="Eliminar archivo">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
          </button>
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
      // SEGURIDAD: solo http(s). Evita recursos con esquema javascript: que
      // ejecutarían código (robo de sesión) al hacer clic desde el dashboard.
      if (!/^https?:\/\//i.test(url)) {
        mostrarError(recursosLinksError, 'La URL debe comenzar con http:// o https://.');
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

    // Formato lista y @menciones para secciones didácticas principales
    div.querySelectorAll('.didactic-section').forEach(function (section) {
      const sectionKey = section.dataset.section;
      const mainTextarea = section.querySelector('textarea[name="' + sectionKey + '_todos"]');
      const listBtn = section.querySelector('.list-format-btn');

      if (listBtn && mainTextarea) {
        listBtn.addEventListener('click', function () {
          const active = listBtn.dataset.active === 'true';
          listBtn.dataset.active = String(!active);
          if (!active) {
            listBtn.classList.add('bg-blue-100', 'text-blue-700', 'border-blue-300');
            listBtn.classList.remove('text-gray-500', 'border-gray-200');
          } else {
            listBtn.classList.remove('bg-blue-100', 'text-blue-700', 'border-blue-300');
            listBtn.classList.add('text-gray-500', 'border-gray-200');
          }
        });
        mainTextarea.addEventListener('keydown', function (e) {
          if (listBtn.dataset.active !== 'true' || e.key !== 'Enter') return;
          e.preventDefault();
          const pos = this.selectionStart;
          const val = this.value;
          const insert = '\n• ';
          this.value = val.slice(0, pos) + insert + val.slice(this.selectionEnd);
          const newPos = pos + insert.length;
          this.setSelectionRange(newPos, newPos);
        });
      }

      if (mainTextarea) {
        mainTextarea.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
        setupAtMention(mainTextarea, section, sectionKey);
      }

      // Auto-resize y @-mention para textareas diferenciados por grado
      section.querySelectorAll('textarea[name*="_grado_"]').forEach(function (ta) {
        ta.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
        // Extraer el grado del nombre (ej: "inicio_grado_3" → "3")
        const gradoMatch = ta.name.match(/_grado_(.+)$/);
        if (gradoMatch) {
          setupAtMention(ta, section, sectionKey, '_act_dif_' + gradoMatch[1]);
        }
      });
    });

    // Listas dinámicas (Tareas y Actividades)
    div.querySelectorAll('.item-list-container').forEach(function (container) {
      const list = container.querySelector('.item-list');
      const key = container.dataset.key;

      container.querySelector('.add-item-btn').addEventListener('click', function () {
        const placeholder = container.dataset.placeholder || '';
        const newRow = document.createElement('div');
        newRow.className = 'item-row flex gap-2 items-start';
        newRow.innerHTML = `
          <span class="activity-num text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-1 rounded mt-0.5 shrink-0 min-w-[1.75rem] text-center leading-4">1</span>
          <textarea name="${key}_item" rows="1"
            class="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden break-words"
            placeholder="${placeholder}" style="min-height:2.1rem"></textarea>
          <button type="button" class="remove-item-btn inline-flex items-center justify-center text-gray-400 hover:text-red-500 p-0.5 rounded-full transition mt-1.5 shrink-0" aria-label="Eliminar">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
          </button>`;
        const ta = newRow.querySelector('textarea');
        ta.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
        list.appendChild(newRow);
        renumberItems(list);
        ta.focus();
      });

      list.addEventListener('click', function (e) {
        const btn = e.target.closest('.remove-item-btn');
        if (!btn) return;
        btn.closest('.item-row').remove();
        renumberItems(list);
      });
    });

    // Eliminar sesión
    div.querySelector('.btn-eliminar').addEventListener('click', function () {
      if (document.querySelectorAll('.session-block').length === 1) {
        _toast('Debe haber al menos una sesión.', 'error');
        return;
      }
      div.remove();
      renumber();
    });

    // Auto-resize para todos los textareas del bloque (excepto .item-row que ya tienen el suyo)
    div.querySelectorAll('textarea:not(.item-row textarea)').forEach(function (ta) {
      ta.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
      });
    });

    return div;
  }

  function updateLabel(block) {
    const num   = block.dataset.num;
    const momento = block.querySelector('.session-momento').value;
    block.querySelector('.session-label').textContent =
      `Sesión ${num} — ${momento || '—'}`;
  }

  function renumber() {
    document.querySelectorAll('.session-block').forEach((block, idx) => {
      block.dataset.num = idx + 1;
      updateLabel(block);
    });
  }

  function rebuildAllPdaBlocks() {
    const newTodosLosPdaIds = Array.from(new Set(
      Object.values(paso2Data || {})
        .flatMap(function (cf) { return Array.isArray(cf?.pda_ids) ? cf.pda_ids : []; })
        .map(function (id) { return String(id); })
        .filter(Boolean)
    ));
    const hasCatalog = Array.isArray(catalogoPDA) && catalogoPDA.length > 0;
    const showPda = hasCatalog && newTodosLosPdaIds.length > 0;

    const gradosSesion = Array.from(new Set(
      (paso1Data?.grados || []).map(function (g) { return parseInt(g, 10); }).filter(function (g) { return !Number.isNaN(g); })
    )).sort(function (a, b) { return a - b; });

    document.querySelectorAll('.session-block').forEach(function (block) {
      const sessionBody = block.querySelector('.session-body');
      if (!sessionBody) return;

      // Guardar valores actuales antes de reemplazar
      const savedPda = {};
      const savedCriterio = {};
      gradosSesion.forEach(function (grado) {
        const sel = sessionBody.querySelector(`select[name="pda_select_grado_${grado}"]`);
        if (sel) savedPda[grado] = sel.value;
        const txt = sessionBody.querySelector(`textarea[name="criterio_grado_${grado}"]`);
        if (txt) savedCriterio[grado] = txt.value;
      });

      // Eliminar bloque PDA anterior
      const oldPdaBlock = sessionBody.querySelector('.pda-block');
      if (oldPdaBlock) oldPdaBlock.remove();

      if (!showPda) return;

      // Construir nuevo bloque PDA
      const pdaDiv = document.createElement('div');
      pdaDiv.className = 'pda-block border border-gray-200 border-l-4 border-l-rose-400 rounded-xl p-4 bg-gray-50';

      let innerHtml = `<span class="font-bold text-gray-700 text-sm uppercase tracking-wide block mb-3">PDA por grado</span><div class="space-y-3">`;
      gradosSesion.forEach(function (grado, index) {
        const opciones = (catalogoPDA || []).filter(function (pda) {
          return newTodosLosPdaIds.includes(String(pda.id)) && Number(pda.grado) === Number(grado);
        }).sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });

        const ultimo = index === gradosSesion.length - 1;
        const savedVal = savedPda[grado] || '';
        const savedCrit = savedCriterio[grado] || '';

        innerHtml += `
          <div class="${ultimo ? '' : 'border-b border-gray-100 pb-3 mb-3'}">
            <div class="text-xs font-semibold text-blue-700 mb-2">Grado ${grado}°</div>
            <select name="pda_select_grado_${grado}"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
              <option value="">Selecciona PDA para ${grado}°...</option>
              ${opciones.map(function (pda) {
                return `<option value="${escapeHtml(pda.id)}"${String(pda.id) === savedVal ? ' selected' : ''}>${escapeHtml(pda.pda || '')}</option>`;
              }).join('')}
            </select>
            <div id="sugerencia_grado_${grado}" class="hidden text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mt-1"></div>
            <textarea name="criterio_grado_${grado}" rows="2"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 mt-2"
              placeholder="Criterio de evaluación para ${grado}°...">${escapeHtml(savedCrit)}</textarea>
          </div>`;
      });
      innerHtml += `</div>`;
      pdaDiv.innerHTML = innerHtml;

      // Insertar antes del botón Eliminar
      const eliminarDiv = sessionBody.querySelector('.btn-eliminar')?.closest('div');
      if (eliminarDiv) {
        sessionBody.insertBefore(pdaDiv, eliminarDiv);
      } else {
        sessionBody.appendChild(pdaDiv);
      }

      // Reconectar listener de sugerencia de criterio
      gradosSesion.forEach(function (grado) {
        const select = pdaDiv.querySelector(`[name="pda_select_grado_${grado}"]`);
        const sugerencia = pdaDiv.querySelector(`#sugerencia_grado_${grado}`);
        const criterioTextarea = pdaDiv.querySelector(`[name="criterio_grado_${grado}"]`);
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
    window.scrollTo(0, 0);
    renderContenidos();
  });

  // ============================================================
  // BORRADOR — guardado local (localStorage)
  // ============================================================

  function collectSessionsData() {
    const blocks = document.querySelectorAll('.session-block');
    if (!blocks.length) return [];
    return Array.from(blocks).map(function (block) {
      const g = function (name) {
        return block.querySelector('[name="' + name + '"]')?.value?.trim() || null;
      };
      const mode = function (key) {
        return block.querySelector('.didactic-section[data-section="' + key + '"]')
          ?.dataset.mode || 'todos';
      };
      function getDifData(key) {
        const obj = {};
        block.querySelectorAll('textarea[name^="' + key + '_grado_"]').forEach(function (ta) {
          const grado = ta.name.replace(key + '_grado_', '');
          obj[grado] = ta.value.trim() || null;
        });
        return Object.keys(obj).length > 0 ? obj : null;
      }
      function getItems(selector) {
        return Array.from(block.querySelectorAll(selector))
          .map(function (i) { return i.value.trim(); }).filter(Boolean);
      }
      function getActividades(sectionKey, sectionMode) {
        if (sectionMode === 'todos') {
          return { mode: 'todos',
            todos: getItems('[name="' + sectionKey + '_act_todos_item"]'),
            diferenciado: null };
        }
        const dif = {};
        block.querySelectorAll('[name^="' + sectionKey + '_act_dif_"]')
          .forEach(function (input) {
            const m = input.name.match(
              new RegExp('^' + sectionKey + '_act_dif_(.+)_item$'));
            if (m) {
              const gr = m[1];
              if (!dif[gr]) dif[gr] = [];
              const v = input.value.trim();
              if (v) dif[gr].push(v);
            }
          });
        return { mode: 'diferenciado', todos: null,
          diferenciado: Object.keys(dif).length > 0 ? dif : null };
      }
      function getTareas(sectionMode) {
        if (sectionMode === 'todos') {
          return { mode: 'todos',
            todos: getItems('[name="cierre_tarea_todos_item"]'),
            diferenciado: null };
        }
        const dif = {};
        block.querySelectorAll('[name^="cierre_tarea_dif_"]')
          .forEach(function (input) {
            const m = input.name.match(/^cierre_tarea_dif_(.+)_item$/);
            if (m) {
              const gr = m[1];
              if (!dif[gr]) dif[gr] = [];
              const v = input.value.trim();
              if (v) dif[gr].push(v);
            }
          });
        return { mode: 'diferenciado', todos: null,
          diferenciado: Object.keys(dif).length > 0 ? dif : null };
      }
      const mI = mode('inicio');
      const mD = mode('desarrollo');
      const mC = mode('cierre');
      const pdaSesion = [];
      (paso1Data ? paso1Data.grados || [] : []).forEach(function (gr) {
        const gNum = parseInt(gr, 10);
        const pdaId = block.querySelector('[name="pda_select_grado_' + gNum + '"]')
          ?.value || null;
        const criterio = block.querySelector('[name="criterio_grado_' + gNum + '"]')
          ?.value?.trim() || null;
        if (!pdaId && !criterio) return;
        const pda = (catalogoPDA || []).find(function (p) { return p.id === pdaId; });
        pdaSesion.push({
          grado: gNum,
          pda_id: pdaId,
          pda_texto: pda ? pda.pda : null,
          criterio_aplicado: criterio
        });
      });
      return {
        duracion:               g('duracion'),
        campo_formativo:        g('campo_formativo'),
        momento:                g('momento'),
        inicio_todos:           mI === 'todos' ? g('inicio_todos') : null,
        inicio_diferenciado:    mI === 'diferenciado' ? getDifData('inicio') : null,
        inicio_actividades:     getActividades('inicio', mI),
        desarrollo_todos:       mD === 'todos' ? g('desarrollo_todos') : null,
        desarrollo_diferenciado:mD === 'diferenciado' ? getDifData('desarrollo') : null,
        desarrollo_actividades: getActividades('desarrollo', mD),
        cierre_todos:           mC === 'todos' ? g('cierre_todos') : null,
        cierre_diferenciado:    mC === 'diferenciado' ? getDifData('cierre') : null,
        cierre_actividades:     getActividades('cierre', mC),
        cierre_tareas:          getTareas(mC),
        observaciones:          g('observaciones'),
        pda_sesion:             pdaSesion.length > 0 ? pdaSesion : null,
        _archivos:              block._archivos || [],
        _links:                 block._links || []
      };
    });
  }

  function saveDraft() {
    try {
      const draft = {
        paso1Data: paso1Data,
        paso2Data: paso2Data,
        sesiones: collectSessionsData() || [],
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      const toast = document.getElementById('borradorToast');
      if (toast) {
        toast.classList.remove('hidden');
        clearTimeout(saveDraft._timer);
        saveDraft._timer = setTimeout(function () { toast.classList.add('hidden'); }, 2500);
      }
    } catch (_) {}
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function checkAndShowDraftBanner() {
    const draft = loadDraft();
    if (!draft || !draft.paso1Data) return;
    const banner = document.getElementById('borradorBanner');
    const fechaEl = document.getElementById('borradorFecha');
    if (!banner) return;
    if (fechaEl && draft.savedAt) {
      const fecha = new Date(draft.savedAt);
      fechaEl.textContent = 'Guardado el ' +
        fecha.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) +
        ' a las ' +
        fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }
    banner.classList.remove('hidden');
  }

  function restoreDraft() {
    const draft = loadDraft();
    if (!draft || !draft.paso1Data) return;
    const d = draft.paso1Data;

    if (formPaso1) {
      const tituloInput = formPaso1.querySelector('[name="titulo"]');
      if (tituloInput && d.titulo) tituloInput.value = d.titulo;

      if (d.grados && gradosCheckboxes) {
        gradosCheckboxes.querySelectorAll('input[name="grados"]').forEach(function (cb) {
          cb.checked = d.grados.includes(cb.value);
        });
        renderFaseBadges();
      }

      if (d.metodologia) {
        const radio = formPaso1.querySelector(`input[name="metodologia"][value="${d.metodologia}"]`);
        if (radio) radio.checked = true;
      }

      if (d.escenario) {
        const radio = formPaso1.querySelector(`input[name="escenario"][value="${d.escenario}"]`);
        if (radio) radio.checked = true;
      }

      if (d.campos_formativos) {
        formPaso1.querySelectorAll('input[name="campos_formativos"]').forEach(function (cb) {
          cb.checked = d.campos_formativos.includes(cb.value);
        });
        sugerirMetodologia();
      }

      if (d.ejes_articuladores) {
        formPaso1.querySelectorAll('input[name="ejes_articuladores"]').forEach(function (cb) {
          cb.checked = d.ejes_articuladores.includes(cb.value);
        });
      }

      const proposito = formPaso1.querySelector('[name="proposito"]');
      if (proposito && d.proposito) proposito.value = d.proposito;

      const pregunta = formPaso1.querySelector('[name="pregunta_generadora"]');
      if (pregunta && d.pregunta_generadora) pregunta.value = d.pregunta_generadora;
    }

    if (draft.paso2Data) {
      paso2Data = draft.paso2Data;
    }

    document.getElementById('borradorBanner')?.classList.add('hidden');

    restoreDraft._sesiones = (draft.sesiones && draft.sesiones.length)
      ? draft.sesiones
      : null;
  }

  function populateFormPaso1(data) {
    if (!formPaso1 || !data) return;
    const tituloInput = formPaso1.querySelector('[name="titulo"]');
    if (tituloInput && data.titulo) tituloInput.value = data.titulo;

    if (data.grados && gradosCheckboxes) {
      gradosCheckboxes.querySelectorAll('input[name="grados"]').forEach(function (cb) {
        cb.checked = data.grados.map(String).includes(cb.value);
      });
      renderFaseBadges();
    }
    if (data.metodologia) {
      const radio = formPaso1.querySelector('input[name="metodologia"][value="' + data.metodologia + '"]');
      if (radio) radio.checked = true;
    }
    if (data.escenario) {
      const radio = formPaso1.querySelector('input[name="escenario"][value="' + data.escenario + '"]');
      if (radio) radio.checked = true;
    }
    if (data.campos_formativos) {
      formPaso1.querySelectorAll('input[name="campos_formativos"]').forEach(function (cb) {
        cb.checked = data.campos_formativos.includes(cb.value);
      });
    }
    if (data.ejes_articuladores) {
      formPaso1.querySelectorAll('input[name="ejes_articuladores"]').forEach(function (cb) {
        cb.checked = data.ejes_articuladores.includes(cb.value);
      });
    }
    const proposito = formPaso1.querySelector('[name="proposito"]');
    if (proposito && data.proposito) proposito.value = data.proposito;
    const pregunta = formPaso1.querySelector('[name="pregunta_generadora"]');
    if (pregunta && data.pregunta_generadora) pregunta.value = data.pregunta_generadora;
  }

  async function cargarProyectoParaEdicion(id) {
    const h1 = document.querySelector('header h1');
    const subtitle = document.querySelector('header p');
    if (h1) h1.textContent = 'Cargando proyecto...';

    try {
      const { data: proyecto, error } = await window.sb
        .from('proyectos')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !proyecto) {
        window.location.href = 'planeacion.html';
        return;
      }

      // Normalizar arrays
      function toArr(val) {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string' && val.trim()) return [val];
        return [];
      }

      paso1Data = {
        titulo:              proyecto.titulo || '',
        fase:                toArr(proyecto.fase),
        grados:              toArr(proyecto.grados).map(String),
        metodologia:         proyecto.metodologia || '',
        escenario:           proyecto.escenario || '',
        campos_formativos:   toArr(proyecto.campos_formativos),
        ejes_articuladores:  toArr(proyecto.ejes_articuladores),
        proposito:           proyecto.proposito || '',
        pregunta_generadora: proyecto.pregunta_generadora || '',
      };

      paso2Data = proyecto.contenidos_pda || {};

      // Poblar formulario paso 1 (para cuando el usuario regrese)
      populateFormPaso1(paso1Data);

      // Actualizar encabezado
      if (h1) h1.textContent = 'Editar Proyecto';
      if (subtitle) subtitle.textContent = proyecto.titulo || 'Proyecto sin título';

      // Ocultar banner de borrador
      document.getElementById('borradorBanner')?.classList.add('hidden');

      // Cargar catálogo antes de renderizar sesiones (para PDA selects)
      try { await cargarCatalogo(); } catch (_) {}

      // Cargar sesiones
      const { data: sesiones } = await window.sb
        .from('sesiones')
        .select('*')
        .eq('proyecto_id', id)
        .order('numero_sesion');

      // Ir directo al paso 3
      step1.classList.add('hidden');
      step2contenidos.classList.add('hidden');
      step2.classList.remove('hidden');
      window.scrollTo(0, 0);

      if (sesiones && sesiones.length) {
        restoreSessionBlocks(sesiones);
      } else {
        agregarSesion();
      }

    } catch (err) {
      console.error('Error cargando proyecto:', err);
      window.location.href = 'planeacion.html';
    }
  }

  function restoreSessionBlocks(sesiones) {
    if (!sesiones || !sesiones.length) return;
    const container = document.getElementById('sesionesContainer');
    if (!container) return;
    container.innerHTML = '';
    sessionCounter = 0;

    sesiones.forEach(function (data, idx) {
      sessionCounter++;
      const num = idx + 1;
      const block = createSessionBlock(num);
      container.appendChild(block);

      const set = function (name, val) {
        if (val == null) return;
        const el = block.querySelector('[name="' + name + '"]');
        if (!el) return;
        el.value = val;
        if (el.tagName === 'TEXTAREA') el.dispatchEvent(new Event('input'));
      };
      set('duracion', data.duracion);
      set('observaciones', data.observaciones);
      set('campo_formativo', data.campo_formativo);
      set('momento', data.momento);
      updateLabel(block);

      function restoreSection(key, sectionData, actData, tareasData) {
        if (!sectionData && !actData) return;
        const section = block.querySelector(
          '.didactic-section[data-section="' + key + '"]');
        if (!section) return;

        const mode = (actData && actData.mode) || 'todos';
        if (mode === 'diferenciado') {
          section.querySelector('.mode-btn-dif')?.click();
        } else {
          section.querySelector('.mode-btn-todos')?.click();
        }

        if (mode === 'todos') {
          const ta = section.querySelector('textarea[name="' + key + '_todos"]');
          if (ta && sectionData) {
            ta.value = sectionData;
            ta.dispatchEvent(new Event('input'));
          }
          if (actData && actData.todos && actData.todos.length) {
            const listContainer = section.querySelector(
              '.item-list-container[data-key="' + key + '_act_todos"]');
            if (listContainer) {
              actData.todos.forEach(function (texto) {
                listContainer.querySelector('.add-item-btn')?.click();
                const els = listContainer.querySelectorAll('.item-row textarea, .item-row input');
                if (els.length) {
                  const last = els[els.length - 1];
                  last.value = texto;
                  last.dispatchEvent(new Event('input'));
                }
              });
            }
          }
        } else {
          if (sectionData && typeof sectionData === 'object') {
            Object.entries(sectionData).forEach(function (entry) {
              const ta = section.querySelector(
                'textarea[name="' + key + '_grado_' + entry[0] + '"]');
              if (ta && entry[1]) {
                ta.value = entry[1];
                ta.dispatchEvent(new Event('input'));
              }
            });
          }
          if (actData && actData.diferenciado) {
            Object.entries(actData.diferenciado).forEach(function (entry) {
              const gr = entry[0];
              const items = entry[1];
              if (!items || !items.length) return;
              const listContainer = section.querySelector(
                '.item-list-container[data-key="' + key + '_act_dif_' + gr + '"]');
              if (listContainer) {
                items.forEach(function (texto) {
                  listContainer.querySelector('.add-item-btn')?.click();
                  const els = listContainer.querySelectorAll('.item-row textarea, .item-row input');
                  if (els.length) {
                    const last = els[els.length - 1];
                    last.value = texto;
                    last.dispatchEvent(new Event('input'));
                  }
                });
              }
            });
          }
        }
      }

      restoreSection('inicio',
        data.inicio_todos || data.inicio_diferenciado,
        data.inicio_actividades, null);
      restoreSection('desarrollo',
        data.desarrollo_todos || data.desarrollo_diferenciado,
        data.desarrollo_actividades, null);
      restoreSection('cierre',
        data.cierre_todos || data.cierre_diferenciado,
        data.cierre_actividades, null);

      if (data.cierre_tareas) {
        const tareasMode = data.cierre_tareas.mode || 'todos';
        const cierreSection = block.querySelector(
          '.didactic-section[data-section="cierre"]');
        if (cierreSection) {
          if (tareasMode === 'todos' && data.cierre_tareas.todos?.length) {
            const listContainer = cierreSection.querySelector(
              '.item-list-container[data-key="cierre_tarea_todos"]');
            if (listContainer) {
              data.cierre_tareas.todos.forEach(function (texto) {
                listContainer.querySelector('.add-item-btn')?.click();
                const els = listContainer.querySelectorAll('.item-row textarea, .item-row input');
                if (els.length) {
                  const last = els[els.length - 1];
                  last.value = texto;
                  last.dispatchEvent(new Event('input'));
                }
              });
            }
          } else if (tareasMode === 'diferenciado' && data.cierre_tareas.diferenciado) {
            Object.entries(data.cierre_tareas.diferenciado).forEach(function (entry) {
              const gr = entry[0];
              const items = entry[1];
              if (!items || !items.length) return;
              const listContainer = cierreSection.querySelector(
                '.item-list-container[data-key="cierre_tarea_dif_' + gr + '"]');
              if (listContainer) {
                items.forEach(function (texto) {
                  listContainer.querySelector('.add-item-btn')?.click();
                  const els = listContainer.querySelectorAll('.item-row textarea, .item-row input');
                  if (els.length) {
                    const last = els[els.length - 1];
                    last.value = texto;
                    last.dispatchEvent(new Event('input'));
                  }
                });
              }
            });
          }
        }
      }

      if (data.pda_sesion && data.pda_sesion.length) {
        data.pda_sesion.forEach(function (item) {
          const selectEl = block.querySelector(
            '[name="pda_select_grado_' + item.grado + '"]');
          if (selectEl && item.pda_id) {
            selectEl.value = item.pda_id;
            selectEl.dispatchEvent(new Event('change'));
          }
          if (item.criterio_aplicado) {
            const criterioEl = block.querySelector(
              '[name="criterio_grado_' + item.grado + '"]');
            if (criterioEl) criterioEl.value = item.criterio_aplicado;
          }
        });
      }

      block._archivos = data._archivos || [];
      block._links = data._links || [];
      if (block._links.length) {
        const linksContainer = block.querySelector('.links-chips-container');
        if (linksContainer) {
          block._links.forEach(function (link) {
            const chip = document.createElement('div');
            chip.className =
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ' +
              'bg-green-50 border border-green-100 text-green-800';
            // textContent (no innerHTML) para no ejecutar datos guardados: el
            // título/URL del recurso podría contener HTML malicioso.
            const txtLink = document.createElement('span');
            txtLink.textContent = '🔗 ' + (link.titulo || link.url || '');
            const btnLink = document.createElement('button');
            btnLink.type = 'button';
            btnLink.className = 'remove-link-btn text-gray-400 hover:text-red-500 transition ml-1 text-xs font-bold';
            btnLink.textContent = '✕';
            chip.appendChild(txtLink);
            chip.appendChild(document.createTextNode(' '));
            chip.appendChild(btnLink);
            btnLink.addEventListener('click',
              function () {
                block._links = block._links.filter(function (l) {
                  return l.url !== link.url;
                });
                chip.remove();
              });
            linksContainer.appendChild(chip);
          });
        }
      }
      if (block._archivos.length) {
        const archivosContainer = block.querySelector('.archivos-chips-container');
        if (archivosContainer) {
          block._archivos.forEach(function (archivo) {
            const chip = document.createElement('div');
            chip.className =
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ' +
              'bg-blue-50 border border-blue-100 text-blue-800';
            // textContent (no innerHTML): el nombre del archivo lo controla quien
            // lo sube y podría contener HTML malicioso.
            const txtArch = document.createElement('span');
            txtArch.textContent = '📎 ' + (archivo.nombre || '');
            const btnArch = document.createElement('button');
            btnArch.type = 'button';
            btnArch.className = 'remove-archivo-btn text-gray-400 hover:text-red-500 transition ml-1 text-xs font-bold';
            btnArch.textContent = '✕';
            chip.appendChild(txtArch);
            chip.appendChild(document.createTextNode(' '));
            chip.appendChild(btnArch);
            btnArch.addEventListener('click',
              function () {
                block._archivos = block._archivos.filter(function (a) {
                  return a.path !== archivo.path;
                });
                chip.remove();
              });
            archivosContainer.appendChild(chip);
          });
        }
      }
    });
  }

  document.getElementById('btnGuardarBorrador2')?.addEventListener('click', function () {
    _saveContenidosState();
    saveDraft();
  });
  document.getElementById('btnGuardarBorrador3')?.addEventListener('click', saveDraft);

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

      // Datos del proyecto
      const proyectoPayload = {
        titulo:              paso1Data.titulo,
        fase:                paso1Data.fase,
        grados:              paso1Data.grados,
        metodologia:         paso1Data.metodologia,
        escenario:           paso1Data.escenario,
        campos_formativos:   paso1Data.campos_formativos,
        ejes_articuladores:  paso1Data.ejes_articuladores,
        proposito:           paso1Data.proposito,
        pregunta_generadora: paso1Data.pregunta_generadora,
        contenidos_pda:      collectContenidosData(),
      };

      let proyectoFinalId;

      if (proyectoId) {
        // Modo edición — actualizar proyecto existente
        const { error: pError } = await window.sb
          .from('proyectos')
          .update(proyectoPayload)
          .eq('id', proyectoId);
        if (pError) throw pError;
        proyectoFinalId = proyectoId;
        // Eliminar sesiones anteriores para re-insertarlas
        const { error: delError } = await window.sb
          .from('sesiones')
          .delete()
          .eq('proyecto_id', proyectoId);
        if (delError) throw delError;
      } else {
        // Modo creación — insertar proyecto nuevo
        const { data: proyectoNuevo, error: pError } = await window.sb
          .from('proyectos')
          .insert({ ...proyectoPayload, maestro_id: user.id, grupo_id: grupoId, visible_mercado: false })
          .select('id')
          .single();
        if (pError) throw pError;
        proyectoFinalId = proyectoNuevo.id;
      }

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
            return { mode: 'todos', todos: getItems(`[name="${sectionKey}_act_todos_item"]`), diferenciado: null };
          }
          const dif = {};
          block.querySelectorAll(`[name^="${sectionKey}_act_dif_"]`).forEach(function (input) {
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
            return { mode: 'todos', todos: getItems('[name="cierre_tarea_todos_item"]'), diferenciado: null };
          }
          const dif = {};
          block.querySelectorAll('[name^="cierre_tarea_dif_"]').forEach(function (input) {
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
          proyecto_id:             proyectoFinalId,
          maestro_id:              user.id,
          numero_sesion:           idx + 1,
          duracion:                g('duracion') || '',
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
      clearDraft();
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

  // Modo edición: cargar proyecto al abrir la página con ?id=
  if (editProyectoId && window.sb) {
    cargarProyectoParaEdicion(editProyectoId);
  }

});
