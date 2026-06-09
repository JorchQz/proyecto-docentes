# CONTEXTO — SaaS NEM para Docentes (fuente de verdad)

> **Este es el único documento de contexto del producto.** Cualquier otro archivo
> (`CLAUDE.md`, `bot/*`, `docs/plantilla-proyecto.md`) debe **referenciar** este, no
> redefinir conceptos. Si algo se contradice, manda este documento — y para los datos
> que viven en Supabase, manda la base de datos.

---

## 1. Visión del producto

Plataforma web (SaaS) para **maestros de educación primaria en México** que trabajan bajo
la **Nueva Escuela Mexicana (NEM)**. El objetivo es **eliminar la carga administrativa**:
el maestro registra asistencia, tareas, actividades y calificaciones en segundos.

- **Usuario objetivo:** maestros de escuelas rurales, especialmente **bidocentes y
  multigrado** (un solo grupo con alumnos de 3°, 4°, 5° y 6° a la vez en el mismo salón).
  El MVP se modela sobre una maestra rural multigrado, pero la arquitectura es
  **multi-tenant**: cualquier maestro se registra y gestiona solo sus datos.
- **Hardware objetivo:** Samsung Galaxy Tab S9 FE+ (12.4", **landscape**, uso táctil).
  La UI debe ser táctil, con **botones grandes (≥ 44px)** y minimizar el teclado en
  pantalla: preferir botones de un toque (`[Asistió]`, `[Faltó]`, `[10]`, `[9]`, `[8]`).
- **Negocio futuro:** marketplace de planeaciones (ver §8).

---

## 2. Modelo NEM — conceptos clave

### Campos Formativos (4 fijos, reemplazan a las "materias")
1. **Lenguajes**
2. **Saberes y Pensamiento Científico**
3. **Ética, Naturaleza y Sociedades**
4. **De lo Humano y lo Comunitario**

### Ejes Articuladores (7 oficiales, transversales)
Inclusión · Pensamiento Crítico · Interculturalidad Crítica · Igualdad de Género ·
Vida Saludable · Apropiación de las Culturas a través de la Lectura y la Escritura ·
Artes y Experiencias Estéticas

### Fases (agrupación de grados)
| Fase | Grados |
|------|--------|
| Fase 3 | 1° y 2° |
| Fase 4 | 3° y 4° |
| Fase 5 | 5° y 6° |

### Metodologías de proyecto — tabla canónica (única)
El SaaS usa **abreviaciones**; el mundo del bot (`dosificacion_*`) y la tabla de Supabase
usan **nombres completos**. El importador traduce entre ambos. Esta es la equivalencia
oficial:

| Abreviación (SaaS) | Nombre completo (BD / bot) | Significado |
|---|---|---|
| `ABPC` | **Proyectos Comunitarios** | Aprendizaje Basado en Proyectos Comunitarios |
| `STEAM` | **Indagación (STEAM)** | Ciencia, Tecnología, Ingeniería, Arte y Matemáticas |
| `ABP` | **Aprendizaje Basado en Problemas** | Aprendizaje Basado en Problemas |
| `AS` | **Aprendizaje Servicio** | Aprendizaje de Servicio |

**Escenarios** (`Aula` · `Escuela` · `Comunidad` en el SaaS; el bot usa `Aula` · `Escolar`
· `Comunitario`):

| SaaS | BD / bot |
|---|---|
| Aula | Aula |
| Escuela | Escolar |
| Comunidad | Comunitario |

### Momentos por metodología — fuente de verdad: tabla `ltg_metodologias_estructuras`
> Estos nombres salen **directamente de la base de datos** (`SELECT metodologia,
> momento_numero, momento_nombre FROM ltg_metodologias_estructuras ORDER BY
> metodologia, momento_numero`). No los memorices ni los inventes; si cambian en la BD,
> esta tabla se actualiza. El campo `momento` de una sesión solo puede ser uno de estos.

| Metodología (nombre completo) | Momentos en orden |
|---|---|
| **Aprendizaje Basado en Problemas** (`ABP`, 6) | Presentemos · Recolectemos · Formulemos el problema · Organicemos la experiencia · Vivamos la experiencia · Resultados y análisis |
| **Proyectos Comunitarios** (`ABPC`, 11) | Identificación · Recuperación · Planificación · Acercamiento · Comprensión y producción · Reconocimiento · Concreción · Integración · Difusión · Consideraciones · Avances |
| **Indagación (STEAM)** (`STEAM`, 5) | Introducción al tema / Saberes previos · Diseño y desarrollo de la indagación · Establecer conclusiones · Presentación de resultados y propuesta de acción · Metacognición / Reflexión |
| **Aprendizaje Servicio** (`AS`, 5) | Punto de partida · Lo que sé y lo que quiero saber · Organicemos las actividades · Creatividad en marcha · Compartimos y evaluamos lo aprendido |

### Estructura de una sesión (clase)
Cada sesión sigue 3 momentos didácticos:
1. **INICIO** — activación, exploración de saberes previos.
2. **DESARROLLO** — trabajo central del proyecto.
3. **CIERRE** — reflexión, síntesis, **tarea para casa**.

---

## 3. Evaluación diaria

Solo números, escala **5 a 10**. Rubros:
- **Asistencia** (presente / ausente / justificada).
- **Tareas** de la clase anterior (5–10).
- **Actividades** del proyecto del día (5–10), por campo formativo.
- **Participación** global del día (5–10) — **NO** por campo formativo (para ahorrar tiempo).
- **Conducta** global del día (5–10) — **NO** por campo formativo.

Promedios de reporte: redondeo a enteros 5–10, desglosado por campo formativo, agrupable en
niveles **Bajo (5–6) · Medio (7–8) · Alto (9–10)**.

---

## 4. Estructura de un proyecto / planeación (3 pasos)

El maestro crea un proyecto en `crear_proyecto.html` en 3 pasos. La plantilla imprimible
para diseñarlos en papel está en [plantilla-proyecto.md](plantilla-proyecto.md).

**Paso 1 — Datos generales:** título, grados, fase (derivada de los grados), metodología,
escenario, campos formativos (uno o varios), ejes articuladores, propósito, pregunta
generadora.

**Paso 2 — Contenidos y PDA por campo formativo:** por cada campo formativo seleccionado,
contenidos oficiales SEP + un **PDA por grado** con su **criterio de valoración**. El PDA
con criterio es lo que luego habilita el seguimiento y las calificaciones.

**Paso 3 — Sesiones:** N sesiones numeradas. Cada bloque (INICIO/DESARROLLO/CIERRE) es
**"Igual para todos"** (`mode: "todos"`) o **"Diferenciado por grado"**
(`mode: "diferenciado"`). Las tareas para casa van en el CIERRE.

### Modos en multigrado
- **Todos igual** (`mode:"todos"`): `*_todos` (texto) lleno, `*_diferenciado` = null,
  `*_actividades.todos` = array.
- **Diferenciado** (`mode:"diferenciado"`): `*_diferenciado` = `{"4":"…","5":"…"}`,
  `*_todos` = null, `*_actividades.diferenciado` = `{"4":[…],"5":[…]}`.

Una buena planeación multigrado combina ambos: INICIO suele ser "todos" (detonador común),
DESARROLLO suele ser "diferenciado" (trabajo por nivel), CIERRE suele ser "todos" (puesta en
común).

---

## 5. Stack técnico

- **Frontend:** HTML5 + Tailwind CSS (vía CDN) + **Vanilla JavaScript**. App multipágina
  (cada feature es un `.html` + su `js/*.js`). Sin framework SPA, sin bundler, sin npm.
- **Backend / BD / Auth:** **Supabase** (PostgreSQL). Auth por JWT en localStorage.
- **Seguridad:** Row-Level Security (RLS) en todas las tablas — `auth.uid() = maestro_id`,
  cada maestro solo ve sus datos (multi-tenant).
- **Despliegue:** GitHub → Cloudflare Pages (CI/CD). Entorno local: VS Code Live Server.

---

## 6. Modelo de datos (Supabase) — verificado contra el esquema real

### 6.1 Mundo SaaS (datos del maestro, en runtime)

| Tabla | Columnas clave |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `escuela`, `tipo_organizacion`, `grados` (array), `es_multigrado` (bool), `ciclo_escolar`, `descripcion` |
| `alumnos` | `maestro_id`, `grupo_id`, `num_lista` (int), `nombre_completo`, `grado` (smallint 1–6), `estatus` |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, **`asistencia_estado`** (text: `presente`/`ausente`/`justificada`) |
| `proyectos` | `maestro_id`, `grupo_id`, `trimestre` (1/2/3), `titulo`, `grados` (array), `fase` (array), `metodologia`, `escenario`, `proposito`, `pregunta_generadora`, `campos_formativos` (array), `ejes_articuladores` (array), `es_multigrado` (bool), `contenidos_pda` (jsonb), `estado` (`borrador`/`activo`/`completado`/`pausado`), `visible_mercado` (bool), `fecha_inicial`, `fecha_final` |
| `sesiones` | `proyecto_id`, `maestro_id`, `numero_sesion`, `duracion` (text, ej. `"90 min"`), `fecha`, `campo_formativo`, `momento`, `inicio_todos`/`desarrollo_todos`/`cierre_todos` (text), `inicio_actividades`/`desarrollo_actividades`/`cierre_actividades`/`cierre_tareas` (jsonb), `inicio_diferenciado`/`desarrollo_diferenciado`/`cierre_diferenciado` (jsonb), `pda_sesion` (jsonb), `recursos` (jsonb), `criterios_evaluacion`, `estado_sesion` (`pendiente`/`activa`/`completada`/`recorrida`), `notas_cierre`, `observaciones` |
| `tareas` | `sesion_id`, `proyecto_id`, `grupo_id`, `maestro_id`, `descripcion`, `grado` (smallint, nullable), `fecha_asignada`, `fecha_revision`, `revisada` (bool) |
| `calificaciones` | `alumno_id`, `maestro_id`, `sesion_id`, `proyecto_id`, `grupo_id`, `tipo` (`tarea`/`actividad`/`participacion`/`conducta`), `descripcion`, `calificacion` (numeric 5–10), `entrego` (bool), `fecha`, `grado`, `campo_formativo` |
| `evaluacion_formativa` | `maestro_id`, `sesion_id`, `alumno_id`, `criterio`, `semaforo` (`logrado`/`en_proceso`/`requiere_apoyo`), `observacion`, `fecha` |

> Nota: `proyectos` conserva columnas legacy (`nombre`, `campo_formativo`) junto a las
> actuales (`titulo`, `campos_formativos`); el frontend usa las actuales. Las tareas se
> **materializan** en la tabla `tareas` (una fila por grado) al cerrar una sesión, leyendo
> el JSONB `cierre_tareas`.

### 6.2 Catálogos (compartidos por SaaS y bot)
- `catalogo_contenidos` (247 filas) — contenidos oficiales SEP por fase y campo formativo.
- `catalogo_pda` (1329 filas) — PDAs por contenido y grado, con criterio de valoración.
- `ltg_indices` (3063) — índice de actividades de libros de texto (`tipo_actividad IS NULL`
  = referencia para citar; con valor = actividad física, con anti-repetición).
- `ltg_metodologias_estructuras` (27) — **fuente de verdad de los momentos** (ver §2).
- `ltg_proyectos_referencia`.

### 6.3 Mundo del bot / marketplace (`dosificacion_*`)
El bot generador escribe **solo** aquí; nunca toca las tablas del maestro. Detalle operativo
(columnas, consultas y operaciones de guardado) en
[../bot/REFERENCIA_SUPABASE_generador.md](../bot/REFERENCIA_SUPABASE_generador.md).

```
dosificacion_proyectos ──< dosificacion_pdas
        └──< dosificacion_sesiones        (shape espejo de `sesiones` del SaaS)
                 ├──< dosificacion_sesion_pdas
                 ├──< materiales_sesion
                 └──< sesion_links_ltg
```

`dosificacion_sesiones` está **alineada al shape nativo de `sesiones`**, de modo que importar
un proyecto comprado al perfil de un maestro es una copia casi 1:1 (reasignar dueño +
traducir nombres metodología/escenario + `momento_metodologico`/`duracion_minutos` →
`momento`/`duracion`).

---

## 7. Estado de los módulos

| Módulo | Estado | Archivo |
|---|---|---|
| Auth (login/registro) | ✅ Completo | `index.html` |
| Onboarding (crear grupo + alumnos + ciclo + trimestre) | ✅ Completo | `onboarding.html` |
| Dashboard diario (tarjetas guiadas: asistencia → tareas → sesión → cierre → ev. formativa) | ✅ Completo | `dashboard.html` |
| Asistencia (con autosave) | ✅ Completo | `asistencia.html` |
| Mi Grupo (CRUD grupo y alumnos) | ✅ Completo | `mi-grupo.html` |
| Crear Proyecto / Planeación (3 pasos con catálogo SEP) | ✅ Completo | `crear_proyecto.html` |
| Planeación (lista de proyectos con filtros + acciones completas) | ✅ Completo | `planeacion.html` |
| Actividades | ✅ Completo | `actividades.html` |
| Tareas | ✅ Completo | `tareas.html` |
| Reportes (Asistencia · Vista Recrea · Concentrado · Boleta PDF/WhatsApp) | ✅ Completo | `reportes.html` |
| Mi Cuenta | ✅ Completo | `mi-cuenta.html` |
| Ajustes (notificaciones + ponderación de calificaciones) | ✅ Completo | `ajustes.html` |
| Evaluación Formativa (semáforo por alumno/sesión, autosave) | ✅ Completo | `evaluacion_formativa.html` |
| Evaluación Diagnóstica (cuaderno + lectura + matemáticas, semáforo) | ✅ Completo | `evaluacion_diagnostica.html` |
| Exámenes (aplicar + calificar + auto-calificación por CF) | ✅ Completo | `examen.html` |
| Marketplace (catálogo + filtros + preview + importar) | ✅ Completo | `marketplace.html` |

### Pendientes / deuda técnica
- `supabase/*.sql` desactualizados respecto al esquema real (deuda de documentación).
- Observaciones de boleta: "Fortalezas" y "Áreas de Oportunidad" son editables solo antes de imprimir (no se persisten). Para persistirlas se necesitan 2 columnas nuevas en `evaluacion_diagnostica`.
- El Marketplace muestra estado vacío hasta que el bot publique proyectos con `estado = 'publicado'`.
- `dosificacion_proyectos.proposito` no existe en BD — el importador usa `producto_final` como fallback.

---

## 8. Marketplace de planeaciones

La tabla `proyectos` tiene `visible_mercado` (default `false`). Es la base del marketplace:
maestros expertos (o el equipo) crean planeaciones de calidad, se marca
`visible_mercado = true`, y otros maestros las buscan, previsualizan e importan a su cuenta.

El **bot generador** (`bot/`) es el pipeline de contenido: genera planeaciones completas y las
guarda en `dosificacion_*` con el mismo shape que el SaaS lee, para importar sin pérdida.
Plan de negocio: vender planeaciones empaquetadas ahora → terminar el SaaS → ofrecer todo
junto (planeaciones + material + control del grupo).

---

## 9. Vocabulario NEM (términos oficiales SEP)

| Término | Significado |
|---|---|
| Campo Formativo | Agrupa los aprendizajes (reemplaza "materia") |
| PDA | Proceso de Desarrollo de Aprendizaje (lo que el alumno logrará) |
| Eje Articulador | Tema transversal que cruza todos los campos |
| Fase | Agrupación de grados (Fase 3 = 1°-2° · Fase 4 = 3°-4° · Fase 5 = 5°-6°) |
| Sesión | Una clase dentro de un proyecto |
| Momento | Etapa metodológica de la sesión (ver §2) |
| Escenario | Contexto o situación real que da sentido al proyecto |
| Pregunta Generadora | Pregunta detonante que guía todo el proyecto |
| Propósito | Lo que se espera que aprendan los alumnos al terminar |
| Trimestre | Período de evaluación (1, 2 o 3 por ciclo) |
| Producto Final | Entregable o demostración de aprendizaje al cierre |
