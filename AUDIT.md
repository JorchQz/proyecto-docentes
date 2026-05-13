# AUDIT.md — Hallazgos de Auditoría (2026-05-12)

## AUDITORÍA NEM (Pedagógica)

### A) Terminología incorrecta o ausente
- Falta término "PDA" en evaluación diaria y reportes — presente solo en crear_proyecto.js:399
- "Fase 3/4/5" sin alinearse a nomenclatura oficial NEM — crear_proyecto.js:52–53
- Ejes articuladores no se usan en evaluación ni reportes (solo en creación)

### B) Funciones pedagógicas faltantes
- Portafolio de evidencias — no existe en ningún módulo
- Rúbricas por PDA — criterio_valoracion en crear_proyecto.js:522 pero sin aplicación en evaluación
- Participación y Conducta — rubros del contexto.md:33 no tienen UI ni tabla en BD
- Autoevaluación y coevaluación — ausentes
- Seguimiento de logro de PDA por alumno — no existe
- Producto final esperado del proyecto — sin campo en BD ni UI
- Evaluación formativa vs. sumativa — sin distinción

### C) Flujo no alineado con NEM
- Sin estructura trimestral: proyectos no tienen campo `trimestre` — tabla proyectos sin esa columna
- Calificación diaria sin desagregación por Campo Formativo completa — dashboard.js:387 puede guardar null
- Evaluación diaria incompleta: faltan UI para Participación y Conducta — dashboard.js:167–177
- Sin validación trimestral (cerrar trimestre y consolidar calificaciones)

### D) Lo que SÍ está bien
- 4 Campos Formativos correctos — crear_proyecto.html:87–90
- Metodologías NEM (ABPC, STEAM, ABP, AS) — crear_proyecto.js:175–180
- 7 Ejes Articuladores correctos — crear_proyecto.html:135–142
- Estructura INICIO/DESARROLLO/CIERRE — dashboard.js:442–480
- PDA por grado en planeación — crear_proyecto.js:520–533

---

## AUDITORÍA FRONTEND/UX

### A) Inconsistencias de patrón
- alert() en vez de showMessage(): section-shell.js:3, :44 | crear_proyecto.js:1433, :1839, :1899 | cuenta.js:3 | mi-grupo.js:3 | onboarding.js:3 | planeacion.js:335, :355
- Modal con innerHTML vs createElement — inconsistente: dashboard.js:967, planeacion.js:258
- Color ring inconsistente: reportes.html usa focus:ring-2, resto no usa ring

### B) Problemas táctiles (Samsung Tab 12.4" landscape)
- nav con overflow-x-auto genera scroll innecesario — navbar.js:87
- Botones < 44px: asistencia.html:25,28 (36x32px) | mi-grupo.html:31 (40px) | mi-grupo.html:66 (36x32px)
- Checkboxes h-5 w-5 (20px) sin padding — asistencia.js:225, crear_proyecto.js
- Botón modal "Confirmar" 42x32px — dashboard.js:982

### C) Wireframe aprobado para stubs
**actividades.html**: Header + filtro estado + grid de cards (proyecto, título, descripción, [Ver][Completar]) + [+ Crear]
**tareas.html**: Header + filtros (Por entregar/Revisadas/Calificadas) + grid de cards (alumno/grupo, fecha, estado badge, [Ver][Calificar]) + [+ Crear]

### D) Bugs visuales
- actividades.html y tareas.html son stubs sin JS asociado
- reportes.html: rounded-md en vez de rounded-lg/xl
- reportes.html: inputs date sin borde explícito
- planeacion.js: abrirModalInicio() puede fallar si proyectoActivoId es null sin feedback visual
- dashboard.js:968: modal se crea/destruye en cada click

---

---

## COMPLETADO EN SESIÓN 2026-05-12

- [x] 10 alert() reemplazados por toasts en section-shell.js, crear_proyecto.js, planeacion.js, cuenta.js, mi-grupo.js, onboarding.js
- [x] Touch targets corregidos: asistencia.html, mi-grupo.html, asistencia.js (checkbox h-7 w-7), dashboard.js
- [x] actividades.html + js/actividades.js implementados (sesiones por proyecto, filtros, actividades por bloque)
- [x] tareas.html + js/tareas.js implementados (extrae cierre_tareas de sesiones, agrupa por sesión, filtros)
- [x] planeacion.js verificado: cargarProyectos(), abrirModalInicio(), pausarProyecto() ya estaban implementados

---

## AUDITORÍA SUPABASE — 2026-05-12

### ✅ Confirmado OK
- FK `sesiones.proyecto_id → proyectos.id` existe → JOINs de actividades.js y tareas.js funcionan
- `asistencias` usa `asistencia_estado` (texto: presente/ausente/justificada) — frontend correcto
- `sesiones.estado_sesion` existe con check constraint ('pendiente','activa','completada','recorrida')
- `proyectos.trimestre` existe
- `proyectos.visible_mercado` existe (marketplace listo)
- Todas las políticas INSERT tienen `WITH CHECK (maestro_id = auth.uid())`
- RLS habilitado en todas las tablas

### 🔴 Bug corregido
- `tareas.js` reescrito: ahora usa tabla `tareas` (no JSONB de sesiones). `dashboard.js` materializa las tareas en esta tabla al cerrar sesiones. La tabla tiene: `descripcion, grado, fecha_asignada, fecha_revision, revisada`

### 🟡 Tablas en BD no conectadas al frontend aún
| Tabla | Datos | Estado |
|-------|-------|--------|
| `tareas` | 0 rows | ✅ Ahora conectada via tareas.js (se llena al cerrar sesiones) |
| `evaluacion_formativa` | 0 rows | Semáforo por alumno/sesión. Sin pantalla. |
| `calificaciones` | 0 rows | Tipos: tarea/actividad/participacion/conducta. Sin pantalla. |
| `registros_diarios` | 0 rows | Sin pantalla. |
| `diagnosticos` | 0 rows | Sin pantalla. |
| `perfiles` | 0 rows | Sin pantalla (datos de maestro). |
| `sesiones_pda` | 0 rows | Duplica `sesiones.pda_sesion` JSONB. Sin pantalla. |
| `proyectos_contenidos` | 0 rows | Duplica `proyectos.contenidos_pda` JSONB. Sin pantalla. |
| `calendario_sep` | 0 rows | Sin pantalla. |
| `ltg_indices` | 93 rows | Índice de LTG. Sin pantalla. |

### 🟡 RLS con políticas duplicadas (no es bug, es redundancia)
- `alumnos`, `grupos`, `proyectos`, `sesiones`, `registros_diarios`, `perfiles` tienen política ALL + políticas CRUD individuales. No afecta seguridad.

## COMPLETADO — 2026-05-12 (sesión 3)
- [x] `dashboard.js`: modal de cierre extendido con sección Participación y Conducta
  - Setter global (aplica a todos con un tap)
  - Filas por alumno con botones táctiles 10/9/8/7/6/5
  - Estado en objeto JS (no DOM-query frágil)
  - `completarSesionDelDia` guarda a tabla `calificaciones` (tipo: participacion + conducta)
  - Tabla `calificaciones` ya tiene columnas correctas (alumno_id, tipo, calificacion, fecha, grado)

## COMPLETADO — 2026-05-13 (sesión 4)
- [x] reportes.html + reportes.js reescritos con 3 pestañas:
  - **Asistencia**: igual que antes pero UI consistente (rounded-xl, py-3 táctil)
  - **Vista Recrea**: promedio por alumno x campo formativo filtrado por trimestre, con exportar CSV con BOM UTF-8
  - **Concentrado Director**: alumnos agrupados en Alto/Medio/Bajo con recuento

## COMPLETADO — 2026-05-13 (sesión 5)
- [x] 3 bugs críticos corregidos:
  - `dashboard.js`: calificaciones insert no bloquea cierre de sesión (non-throwing)
  - `planeacion.js`: revert automático si sesión update falla (evita proyecto activo sin sesión)
  - `planeacion.js`: check de sesiones antes de iniciar proyecto
- [x] `reportes.js`: muestra TODOS los alumnos en Vista Recrea (con "—" si no tienen datos) + null check nombre
- [x] TESTING.md reescrito completo: 13 secciones, edge cases documentados por módulo

## PENDIENTE — Próximas sesiones
- [ ] Actualizar supabase/*.sql para reflejar el esquema real (deuda de documentación)
- [ ] Pantalla de evaluacion_formativa (semáforo por alumno/sesión)
- [ ] Boleta de padres (PDF por alumno desde Reportes)
