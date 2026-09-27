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

  // Escapar texto para innerHTML. Vive aquí, al alcance de toda la página: los
  // "Criterios sugeridos" del paso 3 la usaban sin tenerla a la vista (ReferenceError).
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Auth sin la comprobación común de js/lectura.js (que detiene la página si no hay red):
  // a media captura se avisa en pantalla y lo capturado se conserva
  function authCaptura() {
    return (window.Lectura && window.Lectura.authDirecto) || window.sb.auth;
  }

  const DRAFT_KEY = 'borradorProyectoActivo';

  // Detección de modo edición (URL ?id=xxx)
  const _urlParams = new URLSearchParams(window.location.search);
  const editProyectoId = _urlParams.get('id');
  let proyectoId = editProyectoId || null;
  // Modo edición: el proyecto y sus sesiones como estaban al abrir, y cuáles ya se trabajaron
  let proyectoOriginal = null;
  let sesionesOriginales = {};   // id -> fila de sesiones
  let trabajadasAlAbrir = {};    // id -> true (con fecha o con calificaciones)
  let hayTrabajo = false;
  // Proyecto nuevo ya insertado en un intento de guardar que falló a medias y no se pudo
  // revertir: el siguiente intento lo reutiliza (antes se creaba otro proyecto)
  let proyectoCreadoId = null;
  let guardando = false;

  // ============================================================
  // PASO 1 — Datos dinámicos
  // ============================================================

  let gradosUsuario = [];
  let grupoId = null;
  let trimestreGrupo = null; // grupos.trimestre_actual del grupo destino: default del selector
  let alumnosGrupo = [];     // alumnos activos del grupo destino ("¿Para quién?")

  // Cargar el grupo activo (js/grupo-activo.js): grados y trimestre salen del MISMO
  // grupo donde se inserta el proyecto. Si la lectura falla, GrupoActivo.cargar detiene la
  // página él mismo (antes se seguía sin grupo: "No hay grados registrados en tu grupo")
  try {
    if (window.sb) {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session) {
        const { grupo } = await window.GrupoActivo.cargar(window.sb, session.user.id);
        if (grupo) {
          grupoId = grupo.id;
          trimestreGrupo = grupo.trimestre_actual || null;
          const rawGrados = grupo.grados;
          if (Array.isArray(rawGrados)) {
            gradosUsuario = rawGrados.map(g => parseInt(g, 10)).filter(Boolean);
          } else if (typeof rawGrados === 'string') {
            gradosUsuario = rawGrados.split(',').map(g => parseInt(g.trim(), 10)).filter(Boolean);
          }
          gradosUsuario.sort((a, b) => a - b);
          // Alumnos activos del grupo: el "¿Para quién?" de cada sesión (js/para-quien.js)
          alumnosGrupo = (await window.Lectura.uno(window.sb
            .from('alumnos')
            .select('id, nombre_completo, num_lista, grado')
            .eq('maestro_id', session.user.id).eq('grupo_id', grupo.id).eq('estatus', 'activo')
            .order('grado').order('num_lista'))) || [];
        }
      }
    }
  } catch (e) {
    window.Lectura.detenerPagina(e);
    return;
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
        gradosCheckboxes.querySelectorAll("input[name='grados']").forEach(c => { if (!c.disabled) c.checked = this.checked; });
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
      cfBox.querySelectorAll("input[name='campos_formativos']").forEach(c => { if (!c.disabled) c.checked = this.checked; });
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
    lbl.className = 'inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none';
    lbl.innerHTML = `<input type="checkbox" name="${name}" value="${value}"
      class="form-checkbox h-5 w-5 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500">
      <span class="text-gray-800">${labelText}</span>`;
    return lbl;
  }

  function makeSelectAll(id, text, handler) {
    const lbl = document.createElement('label');
    lbl.className = 'inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none font-semibold text-blue-700';
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

  // Trimestre: default = trimestre actual del grupo; borrador y edición lo sobreescriben
  const trimestreSelect = document.getElementById('trimestreProyecto');
  if (trimestreSelect && trimestreGrupo) trimestreSelect.value = String(trimestreGrupo);

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

  // Aviso del paso 1 (grados y campos formativos son obligatorios: js/proyecto-edicion.js)
  function avisoPaso1(texto) {
    const el = document.getElementById('mensajePaso1');
    if (!el) return;
    if (!texto) { el.textContent = ''; el.classList.add('hidden'); return; }
    el.textContent = texto;
    el.classList.remove('hidden');
  }

  if (formPaso1) {
    formPaso1.addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(formPaso1);
      const datos = {
        titulo:             String(fd.get('titulo') || '').trim(),
        // Del select (no de FormData): en un proyecto en curso está deshabilitado y FormData lo omite
        trimestre:          parseInt(trimestreSelect ? trimestreSelect.value : fd.get('trimestre'), 10) || null,
        fase:               Array.from(formPaso1.querySelectorAll('input[name="fase"]')).map(el => el.value),
        grados:             Array.from(formPaso1.querySelectorAll('input[name="grados"]:checked')).map(el => el.value),
        metodologia:        fd.get('metodologia'),
        escenario:          window.ProyectoEdicion.escenarioOficial(fd.get('escenario')),
        campos_formativos:  Array.from(formPaso1.querySelectorAll('input[name="campos_formativos"]:checked')).map(el => el.value),
        ejes_articuladores: Array.from(formPaso1.querySelectorAll('input[name="ejes_articuladores"]:checked')).map(el => el.value),
        proposito:          fd.get('proposito'),
        pregunta_generadora: fd.get('pregunta_generadora'),
      };
      const validacion = window.ProyectoEdicion.validarPaso1(datos);
      if (!validacion.ok) {
        avisoPaso1(validacion.error);
        const foco = validacion.foco === 'grados' ? gradosCheckboxes?.querySelector('input')
          : validacion.foco === 'campos' ? formPaso1.querySelector('input[name="campos_formativos"]') : null;
        if (foco && foco.focus) foco.focus();
        return;
      }
      avisoPaso1('');
      paso1Data = datos;
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
  // Fases y grados con que se leyó el catálogo: si cambian en el paso 1, se vuelve a leer
  // (antes quedaba el de la primera vez y faltaban los contenidos y PDA de un grado nuevo)
  let catalogoClave = null;
  let catalogoClavePromesa = null;

  async function cargarCatalogo() {
    const fasesActuales = paso1Data ? paso1Data.fase : [];
    const gradosActuales = paso1Data ? paso1Data.grados.map(Number) : [];
    const clave = window.ProyectoEdicion.claveCatalogo(fasesActuales, gradosActuales);
    if (catalogoCargado && catalogoClave === clave) {
      return { contenidos: catalogoContenidos, pdasCatalogo: catalogoPDA };
    }
    if (catalogoCargaPromise && catalogoClavePromesa !== clave) {
      // Una lectura con otros grados sigue en curso: se espera y se lee la de ahora
      try { await catalogoCargaPromise; } catch (_) { /* se vuelve a leer abajo */ }
      return cargarCatalogo();
    }

    if (!catalogoCargaPromise) {
      catalogoClavePromesa = clave;
      catalogoCargaPromise = (async function () {

        const contenidos = await window.LeerTodo.paginas(function () {
          return window.sb
            .from('catalogo_contenidos')
            .select('id, fase, campo_formativo, contenido, orden')
            .in('fase', fasesActuales)
            .order('orden').order('id');
        });

        // Una escuela unitaria (1° a 6°) pide 1329 PDA: se leen por páginas (js/leer-todo.js)
        const pdasCatalogo = await window.LeerTodo.paginas(function () {
          return window.sb
            .from('catalogo_pda')
            .select('id, contenido_id, grado, pda, criterio_valoracion, orden')
            .in('grado', gradosActuales)
            .order('orden').order('id');
        });

        catalogoContenidos = Array.isArray(contenidos) ? contenidos : [];
        catalogoPDA = Array.isArray(pdasCatalogo) ? pdasCatalogo : [];
        catalogoCargado = true;
        catalogoClave = clave;
        catalogoError = null;

        return { contenidos: catalogoContenidos, pdasCatalogo: catalogoPDA };
      })().catch(function (error) {
        catalogoError = error;
        catalogoCargado = false;
        catalogoClave = null;
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
                class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
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
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
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
            <span class="contenido-chip inline-flex max-w-full items-center gap-1 min-h-[44px] pl-3 pr-0 py-0 rounded-3xl bg-blue-100 text-blue-800 text-sm font-medium" data-contenido-id="${escapeHtml(item.id)}" data-contenido-texto="${escapeHtml(item.contenido || '')}">
              <span class="min-w-0 break-words py-1.5">${escapeHtml(item.contenido || '')}</span>
              <button type="button" class="remove-contenido-btn shrink-0 inline-flex items-center justify-center text-blue-500 hover:text-blue-800 hover:bg-blue-200 h-11 w-11 rounded-full transition" data-id="${escapeHtml(item.id)}" aria-label="Quitar contenido">
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
                    <label class="flex items-start gap-3 min-h-[44px] py-2.5 cursor-pointer">
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
            ? 'min-h-[44px] px-3 py-1 text-sm rounded-lg bg-blue-600 text-white font-medium cursor-pointer'
            : 'min-h-[44px] px-3 py-1 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer';
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
              <div class="contenido-option flex items-center min-h-[44px] px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer" data-id="${escapeHtml(item.id)}" data-texto="${escapeHtml(item.contenido || '')}">
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
          // Se conserva el campo elegido (antes se perdía al volver del paso 2)
          const prevCampo = cfSelect.value;
          const cf = buildCampoFormativoOptions();
          cfSelect.innerHTML = cf.html;
          cfSelect.disabled = cf.disabled;
          if (prevCampo) ponerValorSelect(cfSelect, prevCampo);
        }
        const secSelect = block.querySelector('select[name="momento"]');
        if (secSelect) {
          const prevVal = secSelect.value;
          secSelect.innerHTML = buildSecuenciaOptions();
          if (prevVal) ponerMomento(secSelect, prevVal);
        }
      });
      rebuildAllPdaBlocks();
      aplicarCandados();
      pqRefrescarTodos(); // los grados del paso 1 pudieron cambiar
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

  // Secuencia: los momentos oficiales de cada metodología (ltg_metodologias_estructuras,
  // docs/CONTEXTO.md §2). Se guarda el nombre oficial; lo guardado con los nombres de antes
  // se reconoce al leer (js/proyecto-edicion.js)
  function buildSecuenciaOptions() {
    const met = paso1Data ? paso1Data.metodologia : null;
    const opciones = window.ProyectoEdicion.opcionesSecuencia(met);
    return '<option value="">Selecciona...</option>' +
      opciones.map(o => `<option value="${escapeHtml(o.valor)}">${escapeHtml(o.etiqueta)}</option>`).join('');
  }

  // Pone un valor en un select; si no está entre las opciones, lo agrega (no se pierde lo guardado)
  function ponerValorSelect(select, valor) {
    if (!select || valor == null || valor === '') return;
    const existe = Array.from(select.options).some(function (o) { return o.value === String(valor); });
    if (!existe) {
      const opt = document.createElement('option');
      opt.value = String(valor);
      opt.textContent = String(valor);
      select.appendChild(opt);
    }
    select.value = String(valor);
  }

  function ponerMomento(select, valor) {
    const met = paso1Data ? paso1Data.metodologia : null;
    ponerValorSelect(select, window.ProyectoEdicion.momentoOficial(met, valor));
  }

  function buildCampoFormativoOptions() {
    const campos = paso1Data ? paso1Data.campos_formativos : [];
    if (!campos || campos.length === 0) {
      return { html: '<option value="">Selecciona...</option><option>Lenguajes</option><option>Saberes y Pensamiento Científico</option><option>Ética, Naturaleza y Sociedades</option><option>De lo Humano y lo Comunitario</option>', disabled: false };
    }
    if (campos.length === 1) {
      return { html: `<option value="${escapeHtml(campos[0])}" selected>${escapeHtml(campos[0])}</option>`, disabled: true };
    }
    return {
      html: '<option value="">Elige el campo formativo...</option>' + campos.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join(''),
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
          <button type="button" class="add-item-btn mt-1.5 flex items-center gap-1.5 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg min-h-[44px] px-3 py-1.5 hover:bg-blue-50 transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            ${addLabel}
          </button>
        </div>`;
    }

    /*
      Tareas del cierre "igual para todos": iguales para todos o POR GRADO (2026-09-27: antes las
      tareas por grado solo existían con TODO el cierre diferenciado y, al abrir un proyecto con
      cierre común y tareas por grado, guardar las borraba). Con un solo grado no hay selector.
    */
    function tareasDelCierreTodos() {
      const lista = makeItemList(`${key}_tarea_todos`, 'Tarea para casa...', 'Agregar tarea', 'Tareas para casa');
      if (!grados.length) return lista;
      // Con un solo grado no se ofrece el selector; el bloque existe para no perder las tareas
      // por grado que ya traiga la sesión
      const porGrado = grados.map(function (g) {
        return `<div>${makeItemList(`${key}_tarea_grado_${g}`, `Tarea para ${g}°...`, 'Agregar tarea', `Tareas para casa de ${g}°`)}</div>`;
      }).join('');
      return `
        <div class="tareas-block" data-tareas-mode="todos">
          <div class="flex items-center justify-end mt-3${grados.length < 2 ? ' hidden' : ''}">
            <div class="flex rounded-lg overflow-hidden border border-gray-300 text-xs" role="group" aria-label="Tareas para casa">
              <button type="button" class="tareas-btn-todos min-h-[44px] px-3 py-1.5 bg-blue-600 text-white font-medium transition" aria-pressed="true">Tareas iguales para todos</button>
              <button type="button" class="tareas-btn-grado min-h-[44px] px-3 py-1.5 bg-white text-gray-600 font-medium transition hover:bg-gray-50" aria-pressed="false">Tareas por grado</button>
            </div>
          </div>
          <div class="tareas-todos-panel">${lista}</div>
          <div class="tareas-grado-panel hidden grid grid-cols-1 md:grid-cols-${cols} gap-3">${porGrado}</div>
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
            class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden"
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
            <button type="button" class="mode-btn-todos min-h-[44px] px-3 py-1.5 bg-blue-600 text-white font-medium transition">
              Igual para todos
            </button>
            <button type="button" class="mode-btn-dif min-h-[44px] px-3 py-1.5 bg-white text-gray-600 font-medium transition hover:bg-gray-50">
              Diferenciado
            </button>
          </div>
        </div>
        <div class="mode-todos-panel">
          <div class="flex items-center gap-2 mb-1">
            <button type="button" class="list-format-btn flex items-center gap-1 text-xs min-h-[44px] px-3 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition" data-active="false" title="Activar lista con viñetas (• )">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
              Lista
            </button>
            <span class="at-hint text-xs text-gray-400 hidden">Escribe @ para citar una actividad</span>
          </div>
          <textarea name="${key}_todos" rows="3"
            class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden"
            placeholder="Descripción de ${label.toLowerCase()} para todos los grados..."></textarea>
          ${makeItemList(`${key}_act_todos`, 'Actividad en clase...', 'Agregar actividad', 'Actividades')}
          ${includeTareas ? tareasDelCierreTodos() : ''}
        </div>
        <div class="mode-dif-panel hidden">
          <div class="grid grid-cols-1 md:grid-cols-${cols} gap-3">
            ${difCols}
          </div>
        </div>
        <div class="grupos-trabajo hidden mt-3 border-t border-gray-200 pt-3"></div>
      </div>`;
  }

  /*
    Pasos por GRUPO DE TRABAJO ("Morado", "Círculos"; js/texto-sesion.js): llegan en
    *_actividades.diferenciado con una llave que no es grado (proyectos cargados por nivel,
    scripts/cargar-pp-niveles.js). Se muestran en su propio recuadro, en los dos modos, y se
    guardan igual (ProyectoEdicion.actividadesDeSeccion). Antes se perdían al guardar.
  */
  function pintarGruposTrabajo(section, sectionKey, grupos) {
    const cont = section.querySelector('.grupos-trabajo');
    if (!cont || !grupos || !grupos.length) return;
    cont.innerHTML = '<p class="text-xs font-semibold text-gray-500 mb-1">Por grupo de trabajo</p>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + grupos.map(function (g, i) {
        return `
          <div class="item-list-container" data-key="${sectionKey}_act_grupo_${i}" data-grupo="${escapeHtml(g.llave)}" data-placeholder="Paso de ${escapeHtml(g.llave)}...">
            <p class="text-xs font-semibold text-blue-700 mb-1.5 break-words">${escapeHtml(g.llave)}</p>
            <div class="item-list flex flex-col gap-1.5"></div>
            <button type="button" class="add-item-btn mt-1.5 flex items-center gap-1.5 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg min-h-[44px] px-3 py-1.5 hover:bg-blue-50 transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Agregar paso
            </button>
          </div>`;
      }).join('') + '</div>';
    cont.classList.remove('hidden');
    cont.querySelectorAll('.item-list-container').forEach(function (container, i) {
      conectarListaItems(container);
      (grupos[i].items || []).forEach(function (texto) { agregarRenglon(container, texto); });
    });
  }

  // Los pasos por grupo de trabajo de una sección, en el orden de la pantalla
  function gruposDeSeccion(block, sectionKey) {
    const section = block.querySelector('.didactic-section[data-section="' + sectionKey + '"]');
    if (!section) return [];
    return Array.from(section.querySelectorAll('.grupos-trabajo .item-list-container[data-grupo]')).map(function (c) {
      return {
        llave: c.dataset.grupo,
        items: Array.from(c.querySelectorAll('[name="' + c.dataset.key + '_item"]')).map(function (i) { return i.value.trim(); }).filter(Boolean),
      };
    });
  }

  // Tareas del cierre: modo "todos" o "grado" del cierre igual para todos
  function modoTareasDe(block) {
    const t = block.querySelector('.didactic-section[data-section="cierre"] .tareas-block');
    return t ? (t.dataset.tareasMode || 'todos') : 'todos';
  }
  function ponerModoTareas(block, modo) {
    const t = block.querySelector('.didactic-section[data-section="cierre"] .tareas-block');
    if (!t) return;
    t.dataset.tareasMode = modo === 'grado' ? 'grado' : 'todos';
    const porGrado = t.dataset.tareasMode === 'grado';
    t.querySelector('.tareas-todos-panel')?.classList.toggle('hidden', porGrado);
    t.querySelector('.tareas-grado-panel')?.classList.toggle('hidden', !porGrado);
    [['.tareas-btn-todos', !porGrado], ['.tareas-btn-grado', porGrado]].forEach(function (par) {
      const b = t.querySelector(par[0]);
      if (!b) return;
      b.setAttribute('aria-pressed', par[1] ? 'true' : 'false');
      b.classList.toggle('bg-blue-600', par[1]);
      b.classList.toggle('text-white', par[1]);
      b.classList.toggle('bg-white', !par[1]);
      b.classList.toggle('text-gray-600', !par[1]);
    });
  }
  function tareasPorGradoDeBloque(block) {
    const dif = {};
    block.querySelectorAll('.tareas-grado-panel .item-list-container').forEach(function (c) {
      const m = String(c.dataset.key || '').match(/^cierre_tarea_grado_(.+)$/);
      if (!m) return;
      dif[m[1]] = Array.from(c.querySelectorAll('[name="' + c.dataset.key + '_item"]')).map(function (i) { return i.value.trim(); }).filter(Boolean);
    });
    return dif;
  }

  // Un renglón nuevo en una lista (el mismo que crea "Agregar")
  function agregarRenglon(container, texto) {
    container.querySelector('.add-item-btn')?.click();
    const els = container.querySelectorAll('.item-row textarea, .item-row input');
    if (!els.length) return;
    const last = els[els.length - 1];
    last.value = texto;
    last.dispatchEvent(new Event('input'));
  }

  // "Agregar" y quitar renglones de una lista (Actividades, Tareas, pasos por grupo)
  function conectarListaItems(container) {
    const list = container.querySelector('.item-list');
    const key = container.dataset.key;

    container.querySelector('.add-item-btn').addEventListener('click', function () {
      const placeholder = container.dataset.placeholder || '';
      const newRow = document.createElement('div');
      newRow.className = 'item-row flex gap-2 items-start';
      newRow.innerHTML = `
        <span class="activity-num text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-1 rounded mt-0.5 shrink-0 min-w-[1.75rem] text-center leading-4">1</span>
        <textarea name="${key}_item" rows="1"
          class="flex-1 min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none overflow-hidden break-words"
          placeholder="${escapeHtml(placeholder)}"></textarea>
        <button type="button" class="remove-item-btn inline-flex items-center justify-center text-gray-400 hover:text-red-500 h-11 w-11 -mt-1.5 -mb-3 rounded-full transition shrink-0" aria-label="Eliminar">
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
        opt.className = 'w-full text-left min-h-[44px] px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2';
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
        <span class="toggle-icon text-gray-400 transition-transform duration-200 inline-block"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      <div class="session-body p-5 flex flex-col gap-5">

        <!-- Datos básicos de la sesión -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Duración (opcional)</label>
            <input type="text" name="duracion" placeholder="50 minutos"
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Campo formativo (obligatorio)</label>
            <select name="campo_formativo"
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
              ${(function(){ const r = buildCampoFormativoOptions(); return r.disabled ? 'disabled' : ''; })()}>
              ${buildCampoFormativoOptions().html}
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-gray-500 mb-1">Secuencia</label>
            <select name="momento"
              class="session-momento w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
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
              <input type="file" multiple class="w-full min-h-[44px] text-sm file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 border border-gray-300 rounded-xl px-3 py-2 bg-white">
              <p class="resource-files-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-files-list mt-3 flex flex-wrap gap-2"></div>
            </div>
            <div>
              <div class="text-xs font-semibold text-gray-500 mb-2">Links externos</div>
              <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                <input type="url"
                  class="resource-link-url w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  placeholder="Pega la URL del link...">
                <input type="text"
                  class="resource-link-title w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  placeholder="Nombre del link (opcional)">
                <button type="button"
                  class="resource-link-add min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">
                  Agregar
                </button>
              </div>
              <p class="resource-links-error hidden mt-2 text-sm text-red-600"></p>
              <div class="resource-links-list mt-3 flex flex-wrap gap-2"></div>
            </div>
          </div>` : `
          <textarea name="recursos" rows="2"
            class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
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
                    class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    <option value="">Selecciona PDA para ${grado}°...</option>
                    ${opciones.map(function (pda) {
                      return `<option value="${String(pda.id)}">${String(pda.pda || '')}</option>`;
                    }).join('')}
                  </select>
                  <div id="sugerencia_grado_${grado}" class="hidden text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mt-1"></div>
                  <textarea name="criterio_grado_${grado}" rows="2"
                    class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 mt-2"
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
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Notas adicionales..."></textarea>
          </div>
        </div>

        <!-- Botón eliminar -->
        <div class="flex justify-end pt-2 border-t border-gray-100">
          <button type="button" class="btn-eliminar bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-sm font-bold min-h-[44px] px-4 py-2 rounded-xl transition">
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
          <span class="inline-flex max-w-full items-center gap-2 min-h-[44px] pl-3 pr-0 py-0 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800" data-path="${escapeHtml(archivo.path || '')}">
            <span><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/></svg></span>
            <span class="min-w-0 break-words" title="${escapeHtml(archivo.nombre || '')}">${escapeHtml(etiqueta)}</span>
            <button type="button" class="resource-remove-file shrink-0 inline-flex items-center justify-center text-gray-400 hover:text-red-500 h-11 w-11 rounded-full transition" data-path="${escapeHtml(archivo.path || '')}" aria-label="Eliminar archivo">
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
          <span class="inline-flex max-w-full items-center gap-2 min-h-[44px] pl-3 pr-0 py-0 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800" data-index="${index}">
            <span><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg></span>
            <span class="min-w-0 break-words" title="${escapeHtml(link.url || '')}">${escapeHtml(titulo)}</span>
            <button type="button" class="resource-remove-link shrink-0 inline-flex items-center justify-center text-gray-400 hover:text-red-500 h-11 w-11 rounded-full transition" data-index="${index}" aria-label="Eliminar link">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </span>`;
      }).join('');
      syncRecursosState();
    }

    async function subirArchivo(file) {
      // A media captura: sin red se avisa aquí, sin detener la página (se perdería el proyecto)
      const { data: { user }, error: userError } = await authCaptura().getUser();
      if (userError && window.Lectura && window.Lectura.errorDeRed(userError)) throw new Error('No se pudo comprobar tu sesión. Revisa tu conexión y vuelve a subir el archivo.');
      if (!user) throw new Error('No hay sesión activa para subir archivos.');

      /*
        La clave de Storage no puede llevar acentos, ñ, °, comillas ni otros signos ("Invalid
        key" con «3° 'B'.pdf"): se normaliza con js/clave-archivo.js y el nombre ORIGINAL se
        guarda aparte (archivo.nombre), que es el que se muestra, siempre escapado. Si dos
        nombres quedan con la misma clave, la segunda lleva sufijo ("-2").
      */
      const carpeta = `recursos/${user.id}/${tempRecursosId}/sesion_${num}/`;
      const usadas = archivosSubidos.map(function (a) { return String(a.path || ''); });
      let ruta = carpeta + window.ClaveArchivo.unica(file.name, usadas);
      const pendingChip = document.createElement('span');
      pendingChip.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-100 text-gray-800';
      pendingChip.dataset.pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingChip.innerHTML = `<span><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/></svg></span><span title="${escapeHtml(file.name)}">${escapeHtml(truncarTexto(file.name, 30))} · Subiendo...</span>`;
      recursosFilesList?.appendChild(pendingChip);

      try {
        // Ya existe esa clave en la carpeta (otra pestaña o un intento anterior): otro sufijo
        for (let intento = 0; ; intento++) {
          const { error: uploadError } = await window.sb.storage.from('recursos').upload(ruta, file, { upsert: false });
          if (!uploadError) break;
          const yaExiste = String(uploadError.statusCode || uploadError.status || '') === '409' ||
            /already exists|duplicate/i.test(String(uploadError.message || uploadError.error || ''));
          if (!yaExiste || intento >= 3) throw uploadError;
          usadas.push(ruta);
          ruta = carpeta + window.ClaveArchivo.unica(file.name, usadas);
        }
      } catch (errorSubida) {
        pendingChip.remove(); // no se queda "Subiendo..." para siempre
        throw errorSubida;
      }

      let urlPublica = null;
      try {
        const { data: signedData, error: signedError } = await window.sb.storage.from('recursos').createSignedUrl(ruta, 31536000);
        if (signedError) throw signedError;
        urlPublica = signedData?.signedUrl || null;
      } catch (signedUrlError) {
        mostrarError(recursosFilesError, 'El archivo se subió, pero no se pudo generar el enlace seguro.');
      }

      // El chip definitivo lo pinta renderArchivos (con el nombre original y la ruta escapados)
      pendingChip.remove();
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
    // Al abrir un proyecto guardado (o un borrador) se cargan sus recursos: antes se perdían
    // al volver a guardar (el guardado los dejaba vacíos)
    div._cargarRecursos = function (archivos, links) {
      archivosSubidos = Array.isArray(archivos) ? archivos.slice() : [];
      linksAgregados = Array.isArray(links) ? links.slice() : [];
      renderArchivos();
      renderLinks();
    };

    if (mostrarBloquePda) {
      gradosSesion.forEach(function (grado) {
        conectarSelectorCriterios(div, grado);
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
    div.querySelectorAll('.item-list-container').forEach(conectarListaItems);

    // Tareas del cierre igual para todos: iguales o por grado
    const tareasBlock = div.querySelector('.didactic-section[data-section="cierre"] .tareas-block');
    if (tareasBlock) {
      tareasBlock.querySelector('.tareas-btn-todos').addEventListener('click', function () { ponerModoTareas(div, 'todos'); });
      tareasBlock.querySelector('.tareas-btn-grado').addEventListener('click', function () { ponerModoTareas(div, 'grado'); });
    }

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

    montarParaQuien(div);
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
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
              <option value="">Selecciona PDA para ${grado}°...</option>
              ${opciones.map(function (pda) {
                return `<option value="${escapeHtml(pda.id)}"${String(pda.id) === savedVal ? ' selected' : ''}>${escapeHtml(pda.pda || '')}</option>`;
              }).join('')}
            </select>
            <div id="sugerencia_grado_${grado}" class="hidden text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mt-1"></div>
            <textarea name="criterio_grado_${grado}" rows="2"
              class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 mt-2"
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
        conectarSelectorCriterios(pdaDiv, grado);
      });
    });
  }

  // Sugerencias de criterio desde banco_criterios_pda (las 2-5 variantes reales
  // que la IA ya generó para ese PDA), ordenadas por más usadas. Tocar una la
  // copia al textarea y suma su contador vía RPC. Si el banco no tiene nada,
  // cae al criterio_valoracion del catálogo como antes.
  function conectarSelectorCriterios(scope, grado) {
    const select = scope.querySelector(`[name="pda_select_grado_${grado}"]`);
    const sugerencia = scope.querySelector(`#sugerencia_grado_${grado}`);
    const criterioTextarea = scope.querySelector(`[name="criterio_grado_${grado}"]`);
    if (!select || !sugerencia || !criterioTextarea) return;

    select.addEventListener('change', async function () {
      sugerencia.innerHTML = '';
      sugerencia.classList.add('hidden');
      const pdaId = select.value;
      if (!pdaId) return;

      let variantes = [];
      try {
        // lectura-opcional: solo sugerencias de criterio; si falla se ofrece el del catálogo
        // y nada se guarda con este dato
        const { data } = await window.sb
          .from('banco_criterios_pda')
          .select('id, criterio_texto, uso_count')
          .eq('pda_id', pdaId)
          .order('uso_count', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(6);
        variantes = data || [];
      } catch (_) {}

      const pdaSeleccionado = (catalogoPDA || []).find(function (p) {
        return String(p.id) === String(pdaId);
      });
      // Sesión ya trabajada (sus PDA quedaron fijos): no se ofrecen sugerencias
      if (select.disabled) return;
      if (!variantes.length && pdaSeleccionado && pdaSeleccionado.criterio_valoracion) {
        variantes = [{ id: null, criterio_texto: pdaSeleccionado.criterio_valoracion }];
      }
      if (!variantes.length) return;

      // Autollenar con la variante más usada solo si el maestro no ha escrito nada
      if (!criterioTextarea.value.trim()) {
        criterioTextarea.value = variantes[0].criterio_texto;
      }

      sugerencia.innerHTML =
        '<p class="text-xs font-semibold text-gray-500 mb-1.5">Criterios sugeridos (toca uno para usarlo):</p>' +
        '<div class="flex flex-col gap-1.5">' +
        variantes.map(function (v, i) {
          return '<button type="button" data-criterio-idx="' + i + '" ' +
            'class="text-left text-xs text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2.5 min-h-[44px] hover:border-blue-400 hover:bg-blue-50 transition">' +
            escapeHtml(v.criterio_texto) + '</button>';
        }).join('') +
        '</div>';
      sugerencia.classList.remove('hidden');

      sugerencia.querySelectorAll('button[data-criterio-idx]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const v = variantes[parseInt(btn.dataset.criterioIdx, 10)];
          if (!v) return;
          criterioTextarea.value = v.criterio_texto;
          if (v.id) {
            window.sb.rpc('incrementar_uso_criterio', { p_id: v.id })
              .then(function () {}, function () {});
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

  // ============================================================
  // ¿PARA QUIÉN? — por sesión (decisión de Jorge del 2026-09-26)
  // ============================================================
  /*
    Cada sesión lista lo que va a materializar como producto calificable (el trabajo de cada
    grado y cada tarea del cierre, con SesionesMaterializar.emparejarPlan: la MISMA regla del
    materializador) y la maestra elige para quién es: los de su grado (por omisión), sin alguno,
    o con alumnos de otro grado (js/para-quien.js, el mismo diálogo de Hoy).
      - Los grados del producto NO cambian: los fija el plan (si cambiaran, el materializador ya
        no lo emparejaría). "Para quién" se guarda solo como filas de producto_sesion_alumnos
        (ProductosHoy.filasDeEdicion) con guardar_asignacion_producto, DESPUÉS de materializar.
        Por eso, marcar a todos los de otro grado los incluye uno por uno (en Hoy, un producto
        nuevo con todos los de un grado guarda el grado).
      - La elección va con la clave del materializador (tipo, grados y nombre de la tarea): si la
        maestra cambia el texto de una tarea o los grados después de elegir, ese renglón vuelve
        al predeterminado (los alumnos de su grado).
      - Edición: se muestra lo ya asignado; un alumno con calificación en ese producto sale
        marcado y bloqueado (la base lo revisa otra vez al guardar). En una sesión trabajada se
        cambia el "para quién" de sus productos existentes, con el mismo candado.
      - Lo agregado en Hoy (no es del plan) no se lista: se maneja en Hoy (se dice en una línea).
      - El borrador local guarda la elección (_paraQuien de cada sesión).
    block._paraQuien = { clave: { quieren: { alumnoId: true } } }: solo lo que la maestra cambió.
  */
  let pqProductos = [];      // productos_sesion de las sesiones del proyecto (edición)
  let pqAsignaciones = {};   // { productoId: { alumnoId: modo } }
  let pqCalificaciones = {}; // { "alumnoId|productoId": fila }

  // Lo que ya tienen los productos de estas sesiones (la lectura lanza: sin ella no se sabe
  // quién tiene calificación y no se dibuja nada)
  async function cargarEstadoParaQuien(sesionIds) {
    if (!sesionIds.length) { pqProductos = []; pqAsignaciones = {}; pqCalificaciones = {}; return; }
    const productos = await window.LeerTodo.porLotes(sesionIds, function (lote) {
      return window.sb.from('productos_sesion').select('id, sesion_id, tipo, nombre, grados, activo, created_at')
        .in('sesion_id', lote).order('created_at').order('id');
    });
    const ids = productos.map(function (p) { return p.id; });
    const filas = ids.length ? await window.LeerTodo.porLotes(ids, function (lote) {
      return window.sb.from('producto_sesion_alumnos').select('producto_sesion_id, alumno_id, modo')
        .in('producto_sesion_id', lote).order('producto_sesion_id').order('alumno_id');
    }) : [];
    const cal = ids.length ? await window.LeerTodo.porLotes(ids, function (lote) {
      return window.sb.from('calificaciones').select('id, alumno_id, producto_sesion_id, estado_entrega, nivel, puntaje, retroalimentacion')
        .in('producto_sesion_id', lote).order('id');
    }) : [];
    pqProductos = productos;
    pqAsignaciones = window.AlcanceHoy.indiceAsignaciones(filas);
    pqCalificaciones = window.ParaQuien.indiceCalificaciones(cal);
  }

  // La sesión como la va a guardar el bloque (la trabajada, como está en la base: su plan no cambia)
  function pqSesionDeBloque(block, sesionId) {
    if (block.dataset.trabajada === '1' && sesionId && sesionesOriginales[sesionId]) return sesionesOriginales[sesionId];
    const idx = Array.from(document.querySelectorAll('.session-block')).indexOf(block);
    return Object.assign(payloadDeBloque(block, Math.max(idx, 0), null), { id: sesionId || null });
  }

  function pqRenglones(block, productos, sesionId) {
    if (!paso1Data) return { renglones: [], deHoy: 0 };
    const id = sesionId === undefined ? (block.dataset.sesionId || null) : sesionId;
    const trabajada = block.dataset.trabajada === '1';
    // Una sesión trabajada no se vuelve a materializar: sus productos se hicieron con los grados de antes
    const grados = trabajada && proyectoOriginal ? proyectoOriginal.grados : paso1Data.grados;
    const deSesion = id ? (productos || []).filter(function (p) { return p.sesion_id === id; }) : [];
    return window.ParaQuien.renglonesDeSesion(pqSesionDeBloque(block, id), grados || [], deSesion, { soloConProducto: trabajada });
  }

  function pqEstado(block, r) {
    const elegido = block._paraQuien && block._paraQuien[r.clave];
    const base = r.producto ? (pqAsignaciones[r.producto.id] || {}) : {};
    const asignacion = elegido ? window.ParaQuien.asignacionDe(r.grados, alumnosGrupo, elegido.quieren) : base;
    return {
      tocado: !!elegido,
      base: base,
      asignacion: asignacion,
      marcados: window.ParaQuien.quierenPorOmision(r.grados, alumnosGrupo, asignacion),
      bloqueados: r.producto ? window.ParaQuien.bloqueados(r.producto.id, alumnosGrupo, pqCalificaciones) : {},
    };
  }

  function pqHtml(block) {
    const { renglones, deHoy } = pqRenglones(block, pqProductos);
    if (!alumnosGrupo.length) {
      return '<p class="text-sm text-gray-600">Tu grupo aún no tiene alumnos. Cuando los agregues, en Hoy eliges para quién es cada trabajo o tarea.</p>';
    }
    if (!renglones.length && !deHoy) return '';
    let html = '<p class="text-xs text-gray-500 mb-2">Por omisión, cada trabajo y cada tarea son para los alumnos de su grado. ' +
      'Cámbialo si alguien no lo hace o si un alumno de otro grado trabaja con ese grado. Se guarda al guardar el proyecto.</p>';
    if (renglones.length) {
      html += '<ul class="flex flex-col divide-y divide-gray-200">' + renglones.map(function (r) {
        const e = pqEstado(block, r);
        // Un trabajo con nombre propio (no el genérico "Producto — Sesión N") lo dice
        const nombre = r.producto && r.hueco.tipo === 'trabajo' && r.producto.nombre && !/^Producto — Sesión/.test(r.producto.nombre) ? r.producto.nombre : '';
        return `<li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-800 break-words">${escapeHtml(r.etiqueta + (nombre ? ': ' + nombre : ''))}</p>
              <p class="pq-resumen text-xs text-gray-600 break-words">${escapeHtml(window.ParaQuien.resumen(r.grados, e.asignacion, alumnosGrupo))}${e.tocado ? ' <span class="ml-1 inline-flex items-center rounded-full bg-blue-100 text-blue-800 font-semibold px-2 py-0.5">Por guardar</span>' : ''}</p>
            </div>
            <button type="button" data-pq-clave="${escapeHtml(r.clave)}" aria-label="Cambiar para quién es ${escapeHtml(r.etiqueta)}"
              class="pq-cambiar shrink-0 min-h-[44px] min-w-[44px] px-4 rounded-xl border border-gray-300 bg-white text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600">Cambiar</button>
          </li>`;
      }).join('') + '</ul>';
    }
    if (deHoy) {
      html += '<p class="text-xs text-gray-500 mt-2">' + (deHoy === 1
        ? 'Esta sesión tiene 1 actividad o tarea más (agregada en Hoy o para un grupo de trabajo)'
        : 'Esta sesión tiene ' + deHoy + ' actividades o tareas más (agregadas en Hoy o para un grupo de trabajo)') +
        ': su «para quién» se cambia en Hoy.</p>';
    }
    return html;
  }

  // Vuelve a dibujar la sección solo si cambió (así no se pierde el foco mientras se escribe)
  function pqRefrescar(block) {
    const sec = block._pqSeccion;
    if (!sec) return;
    let html = '';
    try { html = pqHtml(block); } catch (err) { console.error('Para quién:', err); }
    if (html === block._pqHtml) return;
    block._pqHtml = html;
    sec.querySelector('.pq-cuerpo').innerHTML = html;
    sec.classList.toggle('hidden', !html);
  }

  function pqRefrescarTodos() {
    document.querySelectorAll('.session-block').forEach(pqRefrescar);
  }

  function montarParaQuien(block) {
    const sec = document.createElement('div');
    sec.className = 'para-quien-block border border-gray-200 border-l-4 border-l-sky-500 rounded-xl p-4 bg-gray-50';
    sec.innerHTML = '<span class="font-bold text-gray-700 text-sm uppercase tracking-wide block mb-2">¿Para quién?</span><div class="pq-cuerpo"></div>';
    const cierre = block.querySelector('.didactic-section[data-section="cierre"]');
    if (cierre) cierre.after(sec);
    else block.querySelector('.session-body')?.appendChild(sec);
    block._pqSeccion = sec;
    sec.addEventListener('click', function (e) {
      const btn = e.target.closest('.pq-cambiar');
      if (btn) pqCambiar(block, btn.dataset.pqClave, btn);
    });
    // Se recalcula cuando cambian las tareas del cierre (texto, agregar, quitar, modo)
    let espera = null;
    const programar = function (e) {
      if (e && e.target && sec.contains(e.target)) return;
      clearTimeout(espera);
      espera = setTimeout(function () { pqRefrescar(block); }, 250);
    };
    block.addEventListener('input', programar);
    block.addEventListener('change', programar);
    block.addEventListener('click', programar);
    pqRefrescar(block);
  }

  function pqCambiar(block, clave, origen) {
    const r = pqRenglones(block, pqProductos).renglones.find(function (x) { return x.clave === clave; });
    if (!r || !alumnosGrupo.length) return;
    const e = pqEstado(block, r);
    const deGrados = window.ProductosHoy.etiquetaGrados(r.grados);
    window.ParaQuien.elegir({
      origen: origen,
      titulo: '¿Para quién es «' + r.etiqueta + '»?',
      subtitulo: 'Marca a los alumnos que lo hacen. Cada uno sigue en su grado para la boleta.' +
        (deGrados ? (r.hueco.tipo === 'tarea' ? ' La tarea es de ' : ' El trabajo es de ') + deGrados + '.' : '') +
        ' Se guarda al guardar el proyecto.',
      aceptar: 'Listo',
      alumnos: alumnosGrupo,
      marcados: e.marcados,
      bloqueados: e.bloqueados,
      alGuardar: function (quieren) {
        const nueva = window.ParaQuien.asignacionDe(r.grados, alumnosGrupo, quieren);
        block._paraQuien = block._paraQuien || {};
        if (window.ParaQuien.mismaAsignacion(r.grados, alumnosGrupo, nueva, e.base)) delete block._paraQuien[clave];
        else block._paraQuien[clave] = { quieren: quieren };
        // Se dibuja al cerrar el diálogo y el foco regresa al "Cambiar" de ese renglón
        setTimeout(function () {
          pqRefrescar(block);
          const nuevo = Array.from(block.querySelectorAll('.pq-cambiar')).find(function (b) { return b.dataset.pqClave === clave; });
          if (nuevo) nuevo.focus();
        }, 0);
      },
    });
  }

  // Borrador local: { clave: [alumnoId, ...] }
  function pqParaBorrador(block) {
    const r = {};
    Object.keys(block._paraQuien || {}).forEach(function (k) { r[k] = Object.keys(block._paraQuien[k].quieren || {}); });
    return Object.keys(r).length ? r : null;
  }
  function pqDesdeBorrador(d) {
    const r = {};
    Object.keys(d || {}).forEach(function (k) {
      if (!Array.isArray(d[k])) return;
      const q = {};
      d[k].forEach(function (id) { q[id] = true; });
      r[k] = { quieren: q };
    });
    return r;
  }

  function errorParaQuien(err, que, nuevo) {
    const sinRed = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      !!(window.Lectura && window.Lectura.errorDeRed && err && window.Lectura.errorDeRed(err));
    const cola = nuevo
      ? ' Lo que capturaste sigue aquí; vuelve a guardar' + (sinRed ? ' cuando haya señal.' : '.')
      : ' Los demás cambios del proyecto sí quedaron; lo que capturaste sigue aquí: revísalo y vuelve a guardar' + (sinRed ? ' cuando haya señal.' : '.');
    return errorHumano(sinRed
      ? 'Sin señal: no se pudo guardar ' + que + '.' + cola
      : 'No se pudo guardar ' + que + ': ' + String((err && err.message) || 'error desconocido').replace(/\.\s*$/, '') + '.' + cola);
  }

  /*
    Después de materializar: lee los productos de esas sesiones, empareja cada hueco con su
    producto y guarda el "para quién" que la maestra cambió. porSesion: [{ block, sesionId,
    numero }]. nuevo: proyecto recién creado (quien llama revierte todo si esto falla).
  */
  async function guardarParaQuien(porSesion, nuevo) {
    const pendientes = porSesion.filter(function (x) {
      return x.block && x.sesionId && x.block._paraQuien && Object.keys(x.block._paraQuien).length;
    });
    if (!pendientes.length || !alumnosGrupo.length) return;
    let productos;
    try {
      productos = await window.LeerTodo.porLotes(pendientes.map(function (x) { return x.sesionId; }), function (lote) {
        return window.sb.from('productos_sesion').select('id, sesion_id, tipo, nombre, grados, activo, created_at')
          .in('sesion_id', lote).order('created_at').order('id');
      });
    } catch (err) {
      throw errorParaQuien(err, 'para quién es cada trabajo y tarea', nuevo);
    }
    for (const x of pendientes) {
      const renglones = pqRenglones(x.block, productos, x.sesionId).renglones;
      for (const r of renglones) {
        const elegido = x.block._paraQuien[r.clave];
        if (!elegido || !r.producto) continue;
        const filas = window.ProductosHoy.filasDeEdicion(r.producto.grados, alumnosGrupo, elegido.quieren);
        let res;
        try {
          res = await window.sb.rpc('guardar_asignacion_producto', { p_producto: r.producto.id, p_filas: filas });
        } catch (err) {
          res = { error: err };
        }
        if (res && res.error) throw errorParaQuien(res.error, 'para quién es «' + r.etiqueta + '» (sesión ' + x.numero + ')', nuevo);
      }
    }
  }

  // Tras un error al guardar "para quién" en la edición: se vuelve a leer lo guardado (quién ya
  // tiene calificación sale bloqueado); si no se puede, se queda lo de antes y la base vuelve a
  // revisar al guardar
  async function pqRecargar() {
    try {
      await cargarEstadoParaQuien(Array.from(document.querySelectorAll('.session-block'))
        .map(function (b) { return b.dataset.sesionId; }).filter(Boolean));
    } catch (_) { /* se queda lo leído antes */ }
    pqRefrescarTodos();
  }

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
      // La misma regla que payloadDeBloque (ProyectoEdicion): pasos por grupo de trabajo y
      // tareas por grado con el cierre igual para todos también van al borrador
      function getActividades(sectionKey, sectionMode) {
        const dif = {};
        if (sectionMode !== 'todos') {
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
        }
        return window.ProyectoEdicion.actividadesDeSeccion(sectionMode, {
          todos: getItems('[name="' + sectionKey + '_act_todos_item"]'),
          porGrado: dif,
          grupos: gruposDeSeccion(block, sectionKey),
        });
      }
      function getTareas(sectionMode) {
        const dif = {};
        if (sectionMode !== 'todos') {
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
        }
        return window.ProyectoEdicion.tareasDelCierre(sectionMode, modoTareasDe(block), {
          todos: getItems('[name="cierre_tarea_todos_item"]'),
          porGradoDif: dif,
          porGrado: tareasPorGradoDeBloque(block),
        });
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
        _links:                 block._links || [],
        _paraQuien:             pqParaBorrador(block)
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

      if (trimestreSelect && d.trimestre) trimestreSelect.value = String(d.trimestre);

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
        const radio = formPaso1.querySelector(`input[name="escenario"][value="${window.ProyectoEdicion.escenarioOficial(d.escenario)}"]`);
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
    if (trimestreSelect && data.trimestre) trimestreSelect.value = String(data.trimestre);

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
      // "Escolar"/"Comunitario" (los del bot y los que guardaba esta pantalla) = Escuela/Comunidad
      const radio = formPaso1.querySelector('input[name="escenario"][value="' + window.ProyectoEdicion.escenarioOficial(data.escenario) + '"]');
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
      // Si la lectura falla, lanza (la página se detiene); solo si se leyó y no existe se
      // vuelve a Proyectos
      const proyecto = await window.Lectura.uno(window.sb
        .from('proyectos')
        .select('*')
        .eq('id', id)
        .maybeSingle());

      // "Actividades del trimestre" (actividades sueltas, tipo 'sueltas', mi_salon_b17) no es un
      // proyecto que se edite aquí: sus actividades se ven en Proyectos y se pasan a un proyecto
      if (!proyecto || proyecto.tipo === 'sueltas') {
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
        // Proyecto viejo sin trimestre: se propone el actual del grupo y se guarda al editar
        trimestre:           proyecto.trimestre || trimestreGrupo,
        fase:                toArr(proyecto.fase),
        grados:              toArr(proyecto.grados).map(String),
        metodologia:         proyecto.metodologia || '',
        escenario:           window.ProyectoEdicion.escenarioOficial(proyecto.escenario || ''),
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

      /*
        Catálogo, sesiones y calificaciones se leen ANTES de dibujar el paso 3: si alguna
        lectura falla, lanza y la página se detiene con el aviso común. Antes se dibujaba igual
        (sin sesiones salía una sesión en blanco, como si el proyecto no tuviera ninguna).
        Un proyecto iniciado se edita (decisión de Jorge del 2026-09-26): guardar ya no borra
        las sesiones; corrige cada una en su lugar. Una sesión TRABAJADA (con fecha o con
        calificaciones) conserva lo evaluado: campo, PDA y tareas (js/proyecto-edicion.js).
      */
      await cargarCatalogo();
      const sesiones = (await window.Lectura.uno(window.sb
        .from('sesiones')
        .select('*')
        .eq('proyecto_id', id)
        .order('numero_sesion'))) || [];
      const conCalificaciones = await leerSesionesConCalificaciones(id);
      proyectoOriginal = proyecto;
      sesionesOriginales = {};
      trabajadasAlAbrir = {};
      sesiones.forEach(function (s) {
        sesionesOriginales[s.id] = s;
        if (window.ProyectoEdicion.sesionTrabajada(s, conCalificaciones)) trabajadasAlAbrir[s.id] = true;
      });
      hayTrabajo = Object.keys(trabajadasAlAbrir).length > 0;
      // "¿Para quién?": productos de sus sesiones, lo ya asignado y quién tiene calificación
      await cargarEstadoParaQuien(sesiones.map(function (s) { return s.id; }));
      if (hayTrabajo) {
        const aviso = document.getElementById('avisoEnCurso');
        if (aviso) {
          aviso.textContent = 'Este proyecto ya se está trabajando. Puedes agregar sesiones y corregir las que aún no trabajas. ' +
            'En las sesiones ya trabajadas (con fecha o con calificaciones) puedes corregir el texto; su campo formativo, sus PDA y sus tareas quedan como se calificaron. ' +
            'Para agregar en plena clase una actividad o una tarea, usa Hoy.';
          aviso.classList.remove('hidden');
        }
        bloquearPaso1EnCurso(proyecto);
      }

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
      // No se pudo leer el proyecto, su catálogo, sus sesiones o sus calificaciones: aviso
      // común, sin dibujar nada a medias ni dejar guardar (antes regresaba a Proyectos sin decir nada)
      window.Lectura.detenerPagina(err);
    }
  }

  // Sesiones del proyecto con alguna calificación (la lectura lanza: sin ella no se sabe
  // qué está trabajado y no se dibuja nada)
  async function leerSesionesConCalificaciones(idProyecto) {
    const filas = await window.LeerTodo.paginas(function () {
      return window.sb.from('calificaciones').select('sesion_id')
        .eq('proyecto_id', idProyecto).order('id');
    });
    const con = {};
    (filas || []).forEach(function (c) { if (c.sesion_id) con[c.sesion_id] = true; });
    return con;
  }

  /*
    Proyecto en curso: el trimestre queda fijo; los grados y campos que ya tiene no se quitan,
    pero se pueden agregar (decisión de Jorge del 2026-09-26: llega un alumno de 5°, se agrega
    el grado y sus trabajos aparecen solo en las sesiones que faltan; lo trabajado no cambia).
  */
  function bloquearPaso1EnCurso(proyecto) {
    const motivo = 'El proyecto ya se está trabajando: esto queda como se calificó.';
    if (trimestreSelect) { trimestreSelect.disabled = true; trimestreSelect.title = motivo; }
    const gradosGuardados = (Array.isArray(proyecto.grados) ? proyecto.grados : []).map(String);
    gradosCheckboxes?.querySelectorAll("input[name='grados']").forEach(function (cb) {
      if (gradosGuardados.indexOf(cb.value) !== -1) { cb.checked = true; cb.disabled = true; cb.title = motivo; }
    });
    const todosGrados = document.getElementById('selectAllGrados');
    if (todosGrados) { todosGrados.checked = false; }
    const camposGuardados = (Array.isArray(proyecto.campos_formativos) ? proyecto.campos_formativos : []).map(String);
    formPaso1.querySelectorAll('input[name="campos_formativos"]').forEach(function (cb) {
      if (camposGuardados.indexOf(cb.value) !== -1) { cb.disabled = true; cb.title = motivo; }
    });
    const nota = document.getElementById('notaPaso1EnCurso');
    if (nota) nota.classList.remove('hidden');
  }

  function fechaLegible(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return Number(m[3]) + ' de ' + ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
      'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m[2]) - 1];
  }

  /*
    Sesión trabajada: se corrige su texto, pero no lo evaluado. Queda fijo su campo
    formativo, sus PDA y criterios, el modo del cierre y sus tareas; no se elimina.
  */
  function bloquearSesionTrabajada(block) {
    const sesion = sesionesOriginales[block.dataset.sesionId] || {};
    const body = block.querySelector('.session-body');
    if (!body) return;
    if (!body.querySelector('.aviso-trabajada')) {
      const aviso = document.createElement('p');
      aviso.className = 'aviso-trabajada text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3';
      aviso.textContent = (sesion.fecha ? 'Se trabajó el ' + fechaLegible(sesion.fecha) + '. ' : 'Ya tiene calificaciones. ') +
        'Puedes corregir su texto; su campo formativo, sus PDA y sus tareas quedan como se calificaron. ' +
        'Para agregar una actividad o una tarea a esta sesión, hazlo desde Hoy.';
      body.insertBefore(aviso, body.firstChild);
      const etiqueta = block.querySelector('.session-label');
      if (etiqueta && !block.querySelector('.session-trabajada')) {
        const marca = document.createElement('span');
        marca.className = 'session-trabajada ml-3 mr-auto inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5';
        marca.textContent = 'Trabajada';
        etiqueta.after(marca);
      }
    }
    const cf = block.querySelector('select[name="campo_formativo"]');
    if (cf) cf.disabled = true;
    block.querySelectorAll('.pda-block select, .pda-block textarea').forEach(function (el) { el.disabled = true; });
    block.querySelectorAll('.pda-block [id^="sugerencia_grado_"]').forEach(function (el) { el.classList.add('hidden'); });
    const cierre = block.querySelector('.didactic-section[data-section="cierre"]');
    if (cierre) {
      cierre.querySelectorAll('.mode-btn-todos, .mode-btn-dif, .tareas-btn-todos, .tareas-btn-grado').forEach(function (b) {
        b.disabled = true;
        b.classList.add('cursor-not-allowed', 'opacity-60');
      });
      cierre.querySelectorAll('.item-list-container[data-key^="cierre_tarea_"]').forEach(function (lista) {
        lista.querySelectorAll('textarea, input').forEach(function (el) {
          el.readOnly = true;
          el.classList.add('bg-gray-100', 'text-gray-600');
        });
        lista.querySelectorAll('.add-item-btn, .remove-item-btn').forEach(function (b) { b.classList.add('hidden'); });
      });
    }
    const eliminar = block.querySelector('.btn-eliminar');
    if (eliminar) {
      eliminar.classList.add('hidden');
      if (!block.querySelector('.nota-no-eliminar')) {
        const nota = document.createElement('p');
        nota.className = 'nota-no-eliminar text-xs text-gray-500';
        nota.textContent = 'Una sesión ya trabajada no se puede eliminar.';
        eliminar.after(nota);
      }
    }
  }

  function aplicarCandados() {
    document.querySelectorAll('.session-block').forEach(function (block) {
      if (block.dataset.trabajada === '1') bloquearSesionTrabajada(block);
    });
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
      // Sesión ya guardada (modo edición): se corrige en su lugar, no se vuelve a crear
      if (data.id && sesionesOriginales[data.id]) {
        block.dataset.sesionId = data.id;
        if (trabajadasAlAbrir[data.id]) block.dataset.trabajada = '1';
      }

      const set = function (name, val) {
        if (val == null) return;
        const el = block.querySelector('[name="' + name + '"]');
        if (!el) return;
        el.value = val;
        if (el.tagName === 'TEXTAREA') el.dispatchEvent(new Event('input'));
      };
      set('duracion', data.duracion);
      set('observaciones', data.observaciones);
      ponerValorSelect(block.querySelector('select[name="campo_formativo"]'), data.campo_formativo);
      ponerMomento(block.querySelector('select[name="momento"]'), data.momento);
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
              // Los pasos de un grupo de trabajo van en su propio recuadro (abajo)
              if (!window.TextoSesion.esLlaveGrado(gr)) return;
              const items = Array.isArray(entry[1]) ? entry[1] : entry[1] ? [entry[1]] : [];
              if (!items.length) return;
              const listContainer = section.querySelector(
                '.item-list-container[data-key="' + key + '_act_dif_' + gr + '"]');
              if (listContainer) {
                items.forEach(function (texto) { agregarRenglon(listContainer, texto); });
              }
            });
          }
        }
        // Pasos por grupo de trabajo ("Morado"): en los dos modos, en su recuadro
        pintarGruposTrabajo(section, key, window.TextoSesion.gruposDe(actData));
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
        const modoCierre = (data.cierre_actividades && data.cierre_actividades.mode) || 'todos';
        const listaDe = function (v) { return Array.isArray(v) ? v : v ? [v] : []; };
        if (cierreSection && window.ProyectoEdicion.modoTareasAlAbrir(data.cierre_tareas, modoCierre) === 'grado') {
          // Cierre igual para todos con tareas POR GRADO (el bot y los proyectos por nivel)
          ponerModoTareas(block, 'grado');
          Object.entries(data.cierre_tareas.diferenciado || {}).forEach(function (entry) {
            const listContainer = cierreSection.querySelector('.item-list-container[data-key="cierre_tarea_grado_' + entry[0] + '"]');
            if (listContainer) listaDe(entry[1]).forEach(function (texto) { agregarRenglon(listContainer, texto); });
          });
        } else if (cierreSection) {
          if (tareasMode === 'todos' && listaDe(data.cierre_tareas.todos).length) {
            const listContainer = cierreSection.querySelector(
              '.item-list-container[data-key="cierre_tarea_todos"]');
            if (listContainer) {
              listaDe(data.cierre_tareas.todos).forEach(function (texto) { agregarRenglon(listContainer, texto); });
            }
          } else if (tareasMode === 'diferenciado' && data.cierre_tareas.diferenciado) {
            Object.entries(data.cierre_tareas.diferenciado).forEach(function (entry) {
              const gr = entry[0];
              // El bot guarda cada grado como texto; Crear proyecto, como lista
              const items = listaDe(entry[1]);
              if (!items.length) return;
              const listContainer = cierreSection.querySelector(
                '.item-list-container[data-key="cierre_tarea_dif_' + gr + '"]');
              if (listContainer) {
                items.forEach(function (texto) { agregarRenglon(listContainer, texto); });
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

      // Recursos: el borrador los trae como _archivos/_links; la sesión guardada, en recursos
      const recursos = data.recursos && typeof data.recursos === "object" && !Array.isArray(data.recursos) ? data.recursos : {};
      if (block._cargarRecursos) block._cargarRecursos(data._archivos || recursos.archivos || [], data._links || recursos.links || []);
      // "¿Para quién?" elegido en el borrador
      if (data._paraQuien) block._paraQuien = pqDesdeBorrador(data._paraQuien);
      if (block.dataset.trabajada === "1") bloquearSesionTrabajada(block);
    });
    pqRefrescarTodos();
    // Llenar las listas enfoca su último renglón (y la página bajaba hasta ahí): se regresa arriba
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
  }

  document.getElementById('btnGuardarBorrador2')?.addEventListener('click', function () {
    _saveContenidosState();
    saveDraft();
  });
  document.getElementById('btnGuardarBorrador3')?.addEventListener('click', saveDraft);

  // ============================================================
  // GUARDAR EN SUPABASE
  // ============================================================

  // La fila de `sesiones` que dibuja un bloque del paso 3 (sin proyecto_id: lo pone quien guarda)
  function payloadDeBloque(block, idx, userId) {
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

    // Pasos de la sección: los de todo el grupo o por grado (según su modo) y, en los dos modos,
    // los de cada grupo de trabajo ("Morado"), que ya no se pierden al guardar
    function getBlockActividades(sectionKey, sectionMode) {
      const dif = {};
      if (sectionMode !== 'todos') {
        block.querySelectorAll(`[name^="${sectionKey}_act_dif_"]`).forEach(function (input) {
          const m = input.name.match(new RegExp('^' + sectionKey + '_act_dif_(.+)_item$'));
          if (m) {
            const gr = m[1];
            if (!dif[gr]) dif[gr] = [];
            const v = input.value.trim();
            if (v) dif[gr].push(v);
          }
        });
      }
      return window.ProyectoEdicion.actividadesDeSeccion(sectionMode, {
        todos: getItems(`[name="${sectionKey}_act_todos_item"]`),
        porGrado: dif,
        grupos: gruposDeSeccion(block, sectionKey),
      });
    }

    // Tareas: con el cierre diferenciado, las de cada columna; con el cierre igual para todos,
    // iguales para todos o POR GRADO (antes esas se perdían y el materializador las borraba)
    function getBlockTareas(sectionMode) {
      const dif = {};
      if (sectionMode !== 'todos') {
        block.querySelectorAll('[name^="cierre_tarea_dif_"]').forEach(function (input) {
          const m = input.name.match(/^cierre_tarea_dif_(.+)_item$/);
          if (m) {
            const gr = m[1];
            if (!dif[gr]) dif[gr] = [];
            const v = input.value.trim();
            if (v) dif[gr].push(v);
          }
        });
      }
      return window.ProyectoEdicion.tareasDelCierre(sectionMode, modoTareasDe(block), {
        todos: getItems('[name="cierre_tarea_todos_item"]'),
        porGradoDif: dif,
        porGrado: tareasPorGradoDeBloque(block),
      });
    }

    return {
      maestro_id:              userId,
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
      /*
        PDA por grado. Un grado cuya lista no se muestra (el proyecto no trae sus PDA en el paso 2)
        o que no ofrece el PDA que ya tenía la sesión conserva lo guardado: antes se guardaba
        vacío y el materializador quitaba ese PDA de la sesión (ProyectoEdicion.pdaSesionConservando).
      */
      pda_sesion: (function() {
        const original = block.dataset.sesionId && sesionesOriginales[block.dataset.sesionId]
          ? sesionesOriginales[block.dataset.sesionId].pda_sesion : null;
        const leidas = (paso1Data.grados || []).map(function(gr) {
          const gNum = parseInt(gr, 10);
          const select = block.querySelector(`[name="pda_select_grado_${gNum}"]`);
          const antes = (Array.isArray(original) ? original : []).find(function(p) { return p && Number(p.grado) === gNum && p.pda_id; });
          const representable = !!select && (!antes || Array.from(select.options).some(function(o) { return o.value === String(antes.pda_id); }));
          const pdaId = select?.value || null;
          const criterio = block.querySelector(`[name="criterio_grado_${gNum}"]`)?.value?.trim() || null;
          const pda = (catalogoPDA || []).find(function(p) { return p.id === pdaId; });
          return {
            grado: gNum,
            representable: representable,
            entrada: !pdaId && !criterio ? null : { grado: gNum, pda_id: pdaId, pda_texto: pda ? pda.pda : null, criterio_aplicado: criterio },
          };
        });
        return window.ProyectoEdicion.pdaSesionConservando(leidas, original);
      })(),
      observaciones:           g('observaciones'),
    };
  }

  function errorHumano(texto) {
    const e = new Error(texto);
    e.humano = true;
    return e;
  }

  const COLUMNAS_MATERIALIZAR = 'id, numero_sesion, campo_formativo, pda_sesion, cierre_tareas';

  /*
    Proyecto NUEVO, sin proyectos a medias: se inserta el proyecto y luego sus sesiones; si
    algo falla después de crear el proyecto, se borra (en cascada, sus sesiones, productos y
    PDA), como el importador. Si ni eso se pudo (sin red), se recuerda su id y el siguiente
    intento lo reutiliza: nunca quedan dos proyectos por reintentar.
  */
  async function guardarNuevo(user, proyectoPayload, blocks) {
    let idProyecto = proyectoCreadoId;
    if (idProyecto) {
      const { error: upErr } = await window.sb.from('proyectos').update(proyectoPayload).eq('id', idProyecto);
      if (upErr) throw upErr;
      // Lo que quedó del intento anterior (sin trabajar: el proyecto nunca se abrió) se rehace
      const { error: delErr } = await window.sb.from('sesiones').delete().eq('proyecto_id', idProyecto);
      if (delErr) throw delErr;
    } else {
      const { data: proyectoNuevo, error: pError } = await window.sb
        .from('proyectos')
        .insert({ ...proyectoPayload, maestro_id: user.id, grupo_id: grupoId, visible_mercado: false })
        .select('id')
        .single();
      if (pError) throw pError;
      idProyecto = proyectoNuevo.id;
      proyectoCreadoId = idProyecto;
    }
    try {
      const filas = Array.from(blocks).map(function (block, idx) {
        return Object.assign({ proyecto_id: idProyecto }, payloadDeBloque(block, idx, user.id));
      });
      if (filas.length) {
        const { data: sesionesInsertadas, error: sError } = await window.sb
          .from('sesiones').insert(filas).select(COLUMNAS_MATERIALIZAR);
        if (sError) throw sError;
        await window.materializarSesiones(sesionesInsertadas || [], user.id, {
          gradosProyecto: paso1Data.grados || [],
          camposProyecto: paso1Data.campos_formativos || [],
          origenTrabajo: 'maestro',
          origenTarea: 'maestro',
        });
        // "¿Para quién?" que la maestra cambió (si falla, se revierte todo como lo demás)
        await guardarParaQuien((sesionesInsertadas || []).map(function (s) {
          return { block: blocks[Number(s.numero_sesion) - 1], sesionId: s.id, numero: Number(s.numero_sesion) };
        }), true);
      }
    } catch (err) {
      const { error: revErr } = await window.sb.from('proyectos').delete().eq('id', idProyecto);
      if (!revErr) proyectoCreadoId = null;
      throw err;
    }
    return idProyecto;
  }

  /*
    Proyecto que YA EXISTE (también uno iniciado): cada sesión se corrige en su lugar.
      - Se vuelve a revisar al guardar qué está trabajado (otra pestaña o Hoy pudieron
        empezar una sesión después de abrir esta pantalla).
      - Solo se manda PATCH de las sesiones que cambiaron (ProyectoEdicion.cambiosDeSesion).
      - Sesión trabajada: solo su texto (ProyectoEdicion.soloTexto).
      - Sesión sin trabajar: la fila completa y su trazabilidad al día, sin duplicar
        (materializarSesiones es idempotente y en la reedición quita lo que se quitó del plan).
      - Sesión nueva: se inserta; su id queda en el bloque, así un reintento la actualiza en
        vez de insertarla otra vez.
      - Sesión quitada de la pantalla: se borra solo si sigue sin trabajar.
      - Carrera (R24-r08): entre la revisión y la escritura otra pestaña pudo trabajar y
        calificar una sesión. El borrado y el PATCH completo llevan la condición "sin fecha"
        en la misma petición y el materializador vuelve a revisar justo antes de escribir;
        si alguna sesión se quedó fuera, se avisa "Mientras editabas…" y no se dice "guardado".
      - Agregar un grado a un proyecto trabajado (decisión de Jorge del 2026-09-26): sus
        trabajos aparecen solo en las sesiones sin trabajar (se materializan todas las
        pendientes con los grados nuevos); lo trabajado no cambia.
  */
  async function guardarEdicion(user, proyectoPayload, blocks) {
    const PE = window.ProyectoEdicion;
    const actuales = await window.LeerTodo.paginas(function () {
      return window.sb.from('sesiones').select('*')
        .eq('proyecto_id', proyectoId).order('numero_sesion').order('id');
    });
    const conCal = await leerSesionesConCalificaciones(proyectoId);
    const existe = {};
    const originales = (actuales || []).map(function (s) {
      existe[s.id] = s;
      return { id: s.id, trabajada: PE.sesionTrabajada(s, conCal) };
    });
    const lista = Array.from(blocks);
    const bloques = lista.map(function (b) { return { sesionId: b.dataset.sesionId || null }; });
    const plan = PE.planGuardado(originales, bloques, trabajadasAlAbrir);
    const numeroDe = function (id) {
      const i = lista.findIndex(function (b) { return b.dataset.sesionId === id; });
      return i === -1 ? (existe[id] && existe[id].numero_sesion) : i + 1;
    };
    if (plan.trabajadasDesdeQueAbrio.length) {
      throw errorHumano('Mientras editabas, se empezó a trabajar la sesión ' +
        plan.trabajadasDesdeQueAbrio.map(numeroDe).join(', ') +
        ' (en Hoy o en otro dispositivo). Para no cambiar lo que ya se calificó no se guardó nada: recarga la página y vuelve a hacer tus cambios.');
    }
    if (plan.faltanTrabajadas.length) {
      throw errorHumano('Una sesión ya trabajada no se puede eliminar. Recarga la página; no se guardó nada.');
    }
    const perdida = bloques.find(function (b) { return b.sesionId && !existe[b.sesionId]; });
    if (perdida) {
      throw errorHumano('Una de las sesiones ya no existe (¿se borró en otro dispositivo?). Recarga la página; no se guardó nada.');
    }
    // Con algo trabajado: el trimestre no cambia y los grados y campos que ya tenía no se quitan
    const hayTrabajadas = originales.some(function (o) { return o.trabajada; });
    if (hayTrabajadas && proyectoOriginal) {
      const faltan = function (antes, ahora) {
        const a = (ahora || []).map(String);
        return (antes || []).map(String).filter(function (x) { return a.indexOf(x) === -1; });
      };
      if (Number(proyectoOriginal.trimestre) !== Number(proyectoPayload.trimestre) ||
          faltan(proyectoOriginal.grados, proyectoPayload.grados).length ||
          faltan(proyectoOriginal.campos_formativos, proyectoPayload.campos_formativos).length) {
        throw errorHumano('Este proyecto ya se está trabajando: su trimestre no cambia y no se quitan sus grados ni sus campos formativos (sí puedes agregar). Recarga la página; no se guardó nada.');
      }
    }

    // Qué escribir de cada sesión: solo lo que cambió respecto a lo que hay en la base
    const existentes = [];
    const nuevas = [];
    const bloquesNuevos = [];
    lista.forEach(function (block, i) {
      const fila = payloadDeBloque(block, i, user.id);
      const id = block.dataset.sesionId || null;
      if (!id) {
        nuevas.push(Object.assign({ proyecto_id: proyectoId }, fila));
        bloquesNuevos.push(block);
        return;
      }
      const actual = existe[id];
      const trabajada = PE.sesionTrabajada(actual, conCal);
      existentes.push({
        id: id,
        trabajada: trabajada,
        completa: trabajada ? {} : PE.cambiosDeSesion(fila, actual),
        texto: PE.cambiosDeSesion(PE.soloTexto(fila), actual),
        actual: actual,
      });
    });

    const { error: pError } = await window.sb.from('proyectos').update(proyectoPayload).eq('id', proyectoId);
    if (pError) throw pError;

    const r = await PE.guardarSesiones(window.sb, {
      maestroId: user.id,
      proyectoId: proyectoId,
      columnas: COLUMNAS_MATERIALIZAR,
      borrar: plan.borrar,
      existentes: existentes,
      nuevas: nuevas,
    });
    (r.borradas || []).forEach(function (id) { delete sesionesOriginales[id]; });
    (r.insertadas || []).forEach(function (s) {
      // numero_sesion = posición en la pantalla (payloadDeBloque)
      const block = lista[Number(s.numero_sesion) - 1];
      if (block && bloquesNuevos.indexOf(block) !== -1 && !block.dataset.sesionId) block.dataset.sesionId = s.id;
      sesionesOriginales[s.id] = s;
    });

    const paraMaterializar = r.materializar.concat(r.insertadas || []);
    // La fila de antes de cada sesión que ya existía: con ella el materializador quita lo que
    // salió del plan (también la tarea "para todos" de los grados de antes, si se agregó un grado)
    const anteriores = {};
    r.materializar.forEach(function (s) { if (existe[s.id]) anteriores[s.id] = existe[s.id]; });
    let resumen = { omitidas: [], carrera: [] };
    if (paraMaterializar.length) {
      resumen = await window.materializarSesiones(paraMaterializar, user.id, {
        gradosProyecto: proyectoPayload.grados || [],
        gradosProyectoAnterior: proyectoOriginal ? proyectoOriginal.grados : null,
        camposProyecto: proyectoPayload.campos_formativos || [],
        origenTrabajo: 'maestro',
        origenTarea: 'maestro',
        anteriores: anteriores,
        soloSinTrabajar: true,
      });
    }
    // Un reintento parte de lo que ya quedó guardado
    paraMaterializar.forEach(function (s) {
      sesionesOriginales[s.id] = Object.assign({}, sesionesOriginales[s.id] || {}, s);
    });

    /*
      Carrera R25a-r08 (campo, relectura retrasada): la sesión recibió su PATCH completo (campo,
      PDA, tareas) cuando aún no tenía fecha, pero antes de materializar la trabajaron en Hoy y la
      calificaron: el materializador ya no toca sus productos (resumen.omitidas). Para que sesión y
      productos digan lo mismo, se regresa lo evaluado de esa sesión (lo que no es texto) a como
      estaba; el texto sí se queda, como en cualquier sesión trabajada. Si no se pudo regresar, el
      aviso lo dice tal cual.
    */
    const sinRegresar = [];
    for (const id of (resumen.omitidas || [])) {
      if (!r.cambiadas || !r.cambiadas[id]) continue;
      const e = existentes.find(function (x) { return x.id === id; });
      if (!e || !e.actual) continue;
      const vuelta = {};
      Object.keys(e.completa || {}).forEach(function (k) {
        if (!(k in (e.texto || {})) && k in e.actual) vuelta[k] = e.actual[k];
      });
      if (!Object.keys(vuelta).length) continue;
      const { error: vError } = await window.sb.from('sesiones').update(vuelta).eq('id', id).eq('maestro_id', user.id);
      if (vError) { sinRegresar.push(id); continue; }
      sesionesOriginales[id] = Object.assign({}, sesionesOriginales[id] || {}, vuelta);
    }
    if (sinRegresar.length) {
      throw errorHumano('Mientras guardabas, se empezó a trabajar ' + (sinRegresar.length === 1 ? 'la sesión ' : 'las sesiones ') +
        sinRegresar.map(numeroDe).sort(function (a, b) { return a - b; }).join(', ') +
        ' (en Hoy o en otro dispositivo). Su campo formativo, PDA o tareas sí cambiaron, pero sus productos y calificaciones siguieron como estaban. Recarga la página y revísala antes de seguir editando.');
    }

    // "¿Para quién?" que la maestra cambió, ya con los productos materializados (antes de poner
    // los grados nuevos en proyectoOriginal: con los de antes se emparejan las sesiones trabajadas)
    let errorPQ = null;
    try {
      await guardarParaQuien(lista.map(function (block, i) {
        return { block: block, sesionId: block.dataset.sesionId || null, numero: i + 1 };
      }), false);
    } catch (e) { errorPQ = e; }
    if (proyectoOriginal) proyectoOriginal = Object.assign({}, proyectoOriginal, { grados: proyectoPayload.grados });

    // Un error del "para quién" no llega a "guardado": se vuelve a leer lo guardado (quien ya
    // tiene calificación sale bloqueado) y se avisa
    if (errorPQ) await pqRecargar();

    const enCarrera = Array.from(new Set([].concat(r.noBorradas || [], r.soloTexto || [], resumen.omitidas || [], resumen.carrera || [])));
    if (enCarrera.length) {
      throw errorHumano(PE.avisoCarrera(enCarrera.map(numeroDe).sort(function (a, b) { return a - b; })) + (errorPQ ? ' ' + errorPQ.message : ''));
    }
    if (errorPQ) throw errorPQ;
    return proyectoId;
  }

  document.getElementById('btnGuardar')?.addEventListener('click', async function () {
    const btn  = this;
    const msgEl = document.getElementById('mensajePaso2');
    if (guardando) return; // un doble toque no guarda dos veces
    const blocks = document.querySelectorAll('.session-block');

    // Cada sesión necesita su campo formativo (antes se guardaba como Lenguajes en silencio)
    const sinCampo = window.ProyectoEdicion.sesionesSinCampo(Array.from(blocks).map(function (b, i) {
      return { numero_sesion: i + 1, campo_formativo: b.querySelector('[name="campo_formativo"]')?.value || '' };
    }));
    if (!paso1Data || !window.ProyectoEdicion.validarPaso1(paso1Data).ok) {
      msgEl.className = 'mt-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm';
      msgEl.textContent = 'Revisa el paso 1: ' + (paso1Data ? window.ProyectoEdicion.validarPaso1(paso1Data).error : 'faltan los datos generales.');
      msgEl.classList.remove('hidden');
      return;
    }
    if (sinCampo.length) {
      msgEl.className = 'mt-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm';
      msgEl.textContent = (sinCampo.length === 1 ? 'La sesión ' + sinCampo[0] + ' no tiene' : 'Las sesiones ' + sinCampo.join(', ') + ' no tienen') +
        ' campo formativo. Elígelo en la sesión para poder guardar.';
      msgEl.classList.remove('hidden');
      const primera = blocks[sinCampo[0] - 1];
      const sel = primera && primera.querySelector('[name="campo_formativo"]');
      if (primera) {
        const body = primera.querySelector('.session-body');
        if (body && body.classList.contains('hidden')) primera.querySelector('.session-toggle')?.click();
      }
      if (sel && sel.focus) sel.focus();
      return;
    }

    guardando = true;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      // A media captura: sin red se avisa aquí, sin detener la página (se perdería el proyecto)
      const { data: { user }, error: userError } = await authCaptura().getUser();
      if (userError && window.Lectura && window.Lectura.errorDeRed(userError)) throw new Error('No se pudo comprobar tu sesión. Revisa tu conexión y vuelve a guardar; lo que capturaste sigue aquí.');
      if (userError || !user) throw new Error('No hay sesión activa.');

      // Datos del proyecto
      const proyectoPayload = {
        titulo:              paso1Data.titulo,
        trimestre:           paso1Data.trimestre,
        fase:                paso1Data.fase,
        grados:              paso1Data.grados,
        metodologia:         paso1Data.metodologia,
        escenario:           window.ProyectoEdicion.escenarioOficial(paso1Data.escenario),
        campos_formativos:   paso1Data.campos_formativos,
        ejes_articuladores:  paso1Data.ejes_articuladores,
        proposito:           paso1Data.proposito,
        pregunta_generadora: paso1Data.pregunta_generadora,
        es_multigrado:       (paso1Data.grados || []).length > 1,
        contenidos_pda:      collectContenidosData(),
      };

      if (proyectoId) {
        await guardarEdicion(user, proyectoPayload, blocks);
      } else {
        await guardarNuevo(user, proyectoPayload, blocks);
      }

      msgEl.className = 'mt-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-sm';
      msgEl.textContent = 'Proyecto guardado correctamente. Redirigiendo...';
      msgEl.classList.remove('hidden');
      clearDraft();
      setTimeout(() => { window.location.href = 'planeacion.html'; }, 1800);

    } catch (err) {
      // Un aviso ya manejado ("Mientras editabas…") no es un error de la página (R25a)
      if (err && err.humano) console.info('Guardar:', err.message);
      else console.error('Error al guardar:', err);
      msgEl.className = 'mt-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm';
      msgEl.textContent = err && err.humano ? err.message : 'Error al guardar: ' + ((err && err.message) || 'Intenta de nuevo.') + ' Lo que capturaste sigue aquí; puedes volver a guardar.';
      msgEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Guardar proyecto';
      guardando = false;
    }
  });

  // Modo edición: cargar proyecto al abrir la página con ?id=
  if (editProyectoId && window.sb) {
    cargarProyectoParaEdicion(editProyectoId);
  }

});
