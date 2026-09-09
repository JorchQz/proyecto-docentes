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
| `calificaciones` | `alumno_id`, `maestro_id`, `sesion_id`, `proyecto_id`, `grupo_id`, `tipo` (`tarea`/`actividad`/`participacion`/`conducta`), `descripcion`, `calificacion` (numeric 5–10), `entrego` (bool), `fecha`, `grado`, `campo_formativo` (nombre largo). **Nuevo grano (2026-09):** `producto_sesion_id` (FK a `productos_sesion`, SET NULL), `estado_entrega` (`entregado`/`incompleto`/`no_entregado`/`justificado`/`no_aplica`), `nivel` (semáforo), `puntaje` (0–10), `retroalimentacion` (visible a padres), `nota_privada`, `evaluado_en`; índice único parcial `(maestro_id, alumno_id, producto_sesion_id)`. Los tipos `participacion`/`conducta` ya **no se escriben** aquí (ver `registro_diario`) |
| `evaluacion_formativa` | `maestro_id`, `sesion_id`, `alumno_id`, `criterio` (texto), **`sesion_pda_id`** (FK a `sesiones_pda` — obligatorio de facto en filas nuevas: la pantalla lo resuelve siempre, con backfill perezoso para sesiones viejas), `semaforo` (`logrado`/`en_proceso`/`requiere_apoyo`), `observacion`, `fecha` |
| `sesiones_pda` | `sesion_id` (FK `sesiones`, CASCADE), `pda_id` (FK `catalogo_pda`, nullable si el criterio es libre), `grado` (1–6), `criterio_aplicado`, UNIQUE `(sesion_id, pda_id, grado)`. Espejo estructurado del jsonb `pda_sesion`; lo materializan `js/sesiones-materializar.js` (importador y crear_proyecto) y el backfill perezoso de `evaluacion_formativa.js` |
| `productos_sesion` | Lo calificable de cada sesión: `sesion_id`, `maestro_id`, `tipo` (`trabajo`/`tarea`/`producto_final`/`examen`/`otro`), `nombre`, `descripcion`, `grados` (text[], SIEMPRE orden ascendente), `modalidad` (`compartida`/`diferenciada`), `campo` (**código corto** `LEN`/`SAB`/`ETI`/`DHL`), `orden`, `activo` (false = no cuenta en máximos), `origen` (`importado`/`backfill`/`maestro`/`bot` — `backfill` = producto genérico pendiente de enriquecer con el nombre real), `fecha_entrega` (tareas) |
| `producto_sesion_pda` | N:M `productos_sesion` ↔ `sesiones_pda` (un producto evalúa 1..n PDA del mismo grado) |
| `registro_diario` | Participación y conducta **una vez al día por alumno**, global (no por sesión ni campo): `maestro_id`, `alumno_id`, `fecha`, `participacion` (0–2), `conducta` (0–2), `nota`, UNIQUE `(maestro_id, alumno_id, fecha)`. La captura llega con la pantalla "Hoy" (Parte B); el reparto a campos está definido en `docs/PRODUCTO-MI-SALON.md` §B.4 |
| `boleta_trimestral` | Boleta por campo formativo: `maestro_id`, `alumno_id`, `ciclo`, `trimestre` (1–3), `campo` (`LEN`/`SAB`/`ETI`/`DHL`/**`GEN`** = fila general), `porcentaje` (0–100), `calificacion` (5–10), `nivel`, `fortalezas`, `areas_oportunidad`, `sugerencias`, `texto_autogenerado` (jsonb), `editado_manual` (true = el motor no sobreescribe el texto), `cerrada` (true = no se recalcula), UNIQUE `(maestro_id, alumno_id, ciclo, trimestre, campo)`. La boleta de `reportes.js` lee/escribe aquí (autosave on-blur) |
| `maestro_ajustes` | PK `maestro_id`; ponderación: `peso_tareas`/`peso_trabajos`/`peso_asistencia`/`peso_participacion`/`peso_conducta`/`peso_examen` (defaults en JS: 25/25/10/5/5/30) |
| `examenes` / `respuestas_examen` / `banco_preguntas` | Examen por grupo/trimestre/grado con `preguntas_ids`; cada pregunta de `banco_preguntas` tiene `campo_formativo` → el puntaje del examen **sí se calcula por campo** (reportes.js) |
| `evaluacion_diagnostica` | `maestro_id`, `alumno_id`, `grupo_id`, `momento` (`inicio_ciclo`/`trimestre_1`/`trimestre_2`/`trimestre_3`), `cuaderno` (jsonb), `lectura_ppm`, `lectura_comprension`, `matematicas` (jsonb), `observaciones`, UNIQUE `(maestro_id, alumno_id, momento)` |

> **Convención de campos formativos:** las tablas históricas (`calificaciones`,
> `dosificacion_*`, `banco_preguntas`) guardan el nombre largo (`"Lenguajes"`, …); las
> tablas nuevas (`productos_sesion`, `boleta_trimestral`) guardan el código corto
> (`LEN`/`SAB`/`ETI`/`DHL`; el alias histórico `HUM` = `DHL`). La equivalencia vive en un
> único lugar: `js/campos-formativos.js`, y se aplica **al escribir** (importador,
> crear_proyecto, reportes), nunca al leer. Un quinto campo se agregaría ahí y aquí.

> **Simplificación deliberada (Parte A, 2026-09):** calificar el producto final del
> proyecto usa el mismo grano que todo lo demás (`productos_sesion` tipo
> `producto_final` + una fila en `calificaciones` con nivel/puntaje **global**). El
> desglose criterio por criterio contra los pesos de
> `productos_finales.criterios_evaluacion` NO está soportado todavía: es una extensión
> de Parte B a diseñar cuando haya un caso real, no un olvido.

> Nota: `proyectos` conserva columnas legacy (`nombre`, `campo_formativo`) junto a las
> actuales (`titulo`, `campos_formativos`); el frontend usa las actuales. Las tareas se
> **materializan** en la tabla `tareas` (una fila por grado) al cerrar una sesión, leyendo
> el JSONB `cierre_tareas`. Además, al importar o guardar un proyecto, `js/sesiones-materializar.js`
> crea por cada sesión sus `sesiones_pda` y sus `productos_sesion` (un trabajo genérico por
> grado con `origen='backfill'` + las tareas reales de `cierre_tareas`).

> **Tablas deprecadas (renombradas `zz_deprecated_*`, 2026-09, todas con 0 filas):**
> `calificacion_tarea`, `calificacion_trabajo`, `diagnosticos`, `configuracion_calificacion`
> (el código usa `maestro_ajustes`), `registros_diarios` (genérica, sin uso),
> `participacion_jornada` (reemplazada por `registro_diario`), `entregas_producto_final`
> (el producto final se califica vía `productos_sesion`). Se conservan **intactas**
> `evaluacion_cuaderno` y `evaluacion_habilidades_basicas` (momento semestral) hasta
> construir el modelo B.6 de `docs/PRODUCTO-MI-SALON.md`.

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

### 6.4 Mundo de la tienda (`marketplace_*`, `tienda/`)
Tienda pública en `tienda/` (Jissez). Los documentos viven en Google Drive; la base guarda
metadatos, órdenes y accesos. Migraciones en `supabase/marketplace_*.sql`; el DDL original
de las cuatro tablas centrales se creó directo en la BD (manda la BD).

- `marketplace_productos` — lo que se vende. `tipo_paquete` ∈ `trimestre` (4 proyectos) ·
  `ciclo` (12) · **`proyecto`** (uno suelto, desde 2026-09). `organizacion`
  (`completa`/`multigrado`), `grados_combo`, `modalidad`, `proyecto_folder_drive_id`
  (carpeta del paquete o, en `proyecto`, la carpeta P0N del proyecto), `precio_pdf`,
  `precio_editable` (add-on Word, solo paquetes), `precio_pdf_con_anexos` y
  `numero_proyecto` 1-12 (solo `proyecto`), `dosificacion_proyecto_id` (solo `proyecto`:
  llave del filtro por contenido/PDA), `activo`, `es_prueba`.
- `marketplace_ordenes` / `marketplace_orden_items` — orden y líneas. `items.tipo` ∈
  `pdf` · `editable` (Word, paquetes) · `anexos` (con anexos, proyecto suelto).
  `ordenes.terminos_aceptados_en` sella la aceptación legal del checkout.
- `marketplace_accesos` — una fila por (usuario, producto, `tipo`) con `tipo` ∈
  `pdf`/`editable`/`anexos`. Regla única en `_shared/pagos.ts::tiposDeAcceso` y su espejo SQL
  `_accesos_por_tipo`: paquete `pdf`→pdf+anexos, `editable`→editable+pdf+anexos;
  proyecto `pdf`→pdf+editable (Word siempre), `anexos`→pdf+editable+anexos. La fila
  `editable` habilita los .docx (`puedeEntregarArchivo`); la fila `anexos` habilita las
  subcarpetas (`puedeEntregarRuta`), que en paquetes van siempre.
- `marketplace_precios`, `marketplace_promocion`, `marketplace_cupones` — tarifario de
  paquetes, promoción porcentual y cupones. Los proyectos sueltos no están en el tarifario:
  su precio vive en la fila y se edita en el admin; la promoción y los cupones se aplican
  encima igual que a los paquetes.
- Admin: `es_admin()` (cuenta `soporte.jissez@gmail.com`) es la única fuente del rol.
- Links de anexo impresos por el bot: `anexo.html?aula=<grado|combo>&pr=<1-12>&a=<código>`;
  la Edge Function `anexo` los resuelve con el paquete o con el proyecto suelto (por
  `numero_proyecto`) comprado con anexos.

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
| Tienda: paquetes (catálogo, ficha, checkout MP, biblioteca, anexos, promoción, cupones) | ✅ Completo | `tienda/*` |
| Tienda: proyectos sueltos (venta con/sin anexos, entrega, admin "Proyectos sueltos") | ✅ Completo (2026-09, Bloque 1) | `tienda/admin.html`, Edge `admin-proyectos-drive` |
| Tienda: filtro por campo/contenido/PDA + ficha `proyecto.html` + legal | ⏳ Bloque 2 | — |
| Tienda: proyectos personalizados (pedidos, admin, correos) | ⏳ Bloque 3 | — |

### Pendientes / deuda técnica
- El Marketplace muestra estado vacío hasta que el bot publique proyectos con `estado = 'publicado'`.
- `dosificacion_proyectos.proposito` no existe en BD — el importador usa `producto_final` como fallback.
- **Job de enriquecimiento de productos:** los `productos_sesion` con `origen='backfill'` tienen nombre genérico ("Producto — Sesión N · CAMPO"); antes de lanzar Mi salón al público hay que extraer el nombre real del producto de cada sesión (revisar si el texto de `dosificacion_sesiones` permite regex antes de gastar en IA) y actualizar las instrucciones del bot para que llene `dosificacion_sesiones.productos` con el shape de `cierre_tareas`.
- Participación y conducta ya no se capturan en el cierre de sesión; la pasada de fin de día que escribe `registro_diario` llega con la pantalla "Hoy" (`docs/PRODUCTO-MI-SALON.md` §B.1.4). Mientras tanto esos rubros no alimentan la fórmula (los pesos se renormalizan solos).
- La **Parte B** completa (pantalla "Hoy", máximos automáticos, motor `v_resumen_trimestral`, textos automáticos, reportes nuevos) está especificada en `docs/PRODUCTO-MI-SALON.md` y NO se programa sin instrucción explícita de Jorge.
- Resuelto 2026-09: observaciones de boleta persistentes (tabla `boleta_trimestral`, por campo); esquema real documentado en `supabase/esquema_2026-09.sql` (los `.sql` anteriores quedan como historia).

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
