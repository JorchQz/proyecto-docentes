# Referencia Supabase — Generador de Planeaciones NEM
Proyecto ID: `cluvaxxqvhtxxiwctpnl` | Ciclo activo: `2025-2026`

> Verificado contra el esquema real. `dosificacion_sesiones` está **alineada al shape nativo
> de `sesiones` del SaaS** (ver `supabase/dosificacion_sesiones_align.sql`), para que importar
> un proyecto comprado al perfil de un maestro sea una copia casi 1:1, sin pérdida de datos.

---

## Mapa de tablas (dos mundos unidos por catálogos)

```
BOT / marketplace                                  SaaS (maestro)
dosificacion_proyectos ──< dosificacion_pdas       proyectos ──< sesiones
        └──< dosificacion_sesiones                                └──< tareas / calificaciones / asistencias (runtime)
                 ├──< dosificacion_sesion_pdas
                 ├──< materiales_sesion
                 └──< sesion_links_ltg
   catalogo_contenidos (247) / catalogo_pda (1329)  ← compartidos por ambos mundos
   ltg_indices (3063) / ltg_metodologias_estructuras (27) / ltg_proyectos_referencia
```

El bot escribe SOLO en el mundo `dosificacion_*`. **Nunca** toca `proyectos`, `sesiones`,
`tareas`, `calificaciones` ni `asistencias` (esos son del maestro / del importador).

---

## TABLAS QUE USA EL BOT

### `dosificacion_proyectos`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK → úsalo como `proyecto_dos_id` |
| ciclo_escolar | text | default `'2025-2026'` (leer del proyecto, no hardcodear) |
| trimestre | smallint | CHECK 1 / 2 / 3 |
| numero_proyecto | smallint | 1–N por grado |
| fase | text | CHECK `'Fase 3'`=1°-2° · `'Fase 4'`=3°-4° · `'Fase 5'`=5°-6° |
| grados | smallint[] | `[1]` o `[4,5,6]` si multigrado |
| nombre_proyecto | text | |
| campos_formativos | text[] | CFs del proyecto |
| ejes_articuladores | text[] | |
| metodologia | text | **NOMBRE COMPLETO** (ver tabla abajo) |
| escenario | text | CHECK `'Aula'` / `'Escolar'` / `'Comunitario'` |
| pregunta_generadora | text | |
| fecha_inicio_estimada / fecha_fin_estimada | date | |
| num_sesiones_estimadas | smallint | default 16 |
| estado | text | CHECK `pendiente → en_generacion → generado → revisado → publicado` |
| notas_revision | text | |

**Valores reales de `metodologia`** (¡nombres completos, no abreviaciones!):
`Aprendizaje Basado en Problemas` · `Proyectos Comunitarios` · `Indagación (STEAM)` · `Aprendizaje Servicio`

### `dosificacion_pdas` — TABLA PRINCIPAL DE CONSULTA
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK = `dos_pda_id` |
| proyecto_dos_id | uuid | FK → dosificacion_proyectos |
| contenido_id | uuid | FK → catalogo_contenidos |
| pda_id | uuid | FK → catalogo_pda |
| grado | smallint | **se filtra por aquí en multigrado** |
| campo_formativo | text | |
| contenido_texto | text | ← texto del contenido (desnormalizado) |
| pda_texto | text | ← texto del PDA (desnormalizado) |
| estado | text | CHECK `pendiente` · `en_sesion` · `cubierto` |
| sesion_numero | smallint | se llena al cubrirlo |

### `dosificacion_sesiones` — shape espejo de `sesiones` del SaaS
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK → necesario para joins, materiales y links |
| proyecto_dos_id | uuid | FK → dosificacion_proyectos |
| numero_sesion | smallint | 1, 2, 3… |
| campo_formativo | text | CF principal de la sesión |
| momento | text | nombre del momento (= `ltg_metodologias_estructuras.momento_nombre`) |
| momento_metodologico | text | alias histórico; puedes llenar ambos igual |
| duracion_minutos | smallint | default 90 |
| inicio_todos / desarrollo_todos / cierre_todos | text | texto del bloque cuando es "igual para todos" |
| inicio_diferenciado / desarrollo_diferenciado / cierre_diferenciado | jsonb | `{"4":"texto","5":"texto"}` |
| inicio_actividades / desarrollo_actividades / cierre_actividades | jsonb | `{mode,todos:[],diferenciado:{}}` |
| cierre_tareas | jsonb | mismo shape que actividades (tareas de casa) |
| pda_sesion | jsonb | `[{grado,pda_id,pda_texto,criterio_aplicado}]` |
| recursos | jsonb | `{"archivos":[],"links":[]}` |
| productos | text[] | productos esperados |
| observaciones | text | |
| estado | text | CHECK `borrador` · `revisado` · `aprobado` (el bot escribe `borrador`) |
| prompt_version / tokens_usados | text / int | telemetría del bot |

#### Regla de los modos por bloque (inicio / desarrollo / cierre)
Cada bloque es **"todos"** o **"diferenciado"**:
- `mode:"todos"` → `*_todos` (text) lleno · `*_diferenciado` = null · `*_actividades.todos` = array.
- `mode:"diferenciado"` → `*_diferenciado` = `{"grado":"texto"}` · `*_todos` = null ·
  `*_actividades.diferenciado` = `{"grado":[actividades]}`.

`cierre_tareas` usa el mismo shape. En multigrado: `{"mode":"diferenciado","todos":null,
"diferenciado":{"4":["tarea 4°"],"5":["tarea 5°"]}}`. **Nunca** texto plano "4°: … | 5°: …"
(el SaaS materializa este JSONB a la tabla `tareas`, una fila por grado).

### `dosificacion_sesion_pdas` — join sesión ↔ PDA
| Columna | Tipo | Notas |
|---|---|---|
| sesion_id | uuid | FK → dosificacion_sesiones |
| dos_pda_id | uuid | FK → dosificacion_pdas |
| criterio_evaluacion | text | criterio de evaluación de ese PDA en esa sesión |

### `sesion_links_ltg` — registro anti-repetición de actividades de libro
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| sesion_id | uuid | FK → dosificacion_sesiones |
| ltg_indice_id | uuid | FK → ltg_indices |
| nombre_libro | text | |
| paginas | text | |
| descripcion | text | |
| link_libro | text | |
| momento | text | CHECK `inicio` · `desarrollo` · `cierre` · `tarea` |

### `ltg_indices` — índice de actividades de libros de texto
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| fase | text | |
| grado | integer | |
| libro | text | |
| titulo | text | |
| pagina | integer | |
| area_tematica / componente / capitulo / tema_padre | text | metadatos |
| tipo_actividad | text | **NULL = referencia** · con valor = actividad física del alumno |
| link | text | URL al libro digital |
| cf_lenguajes / cf_saberes / cf_humano_comunitario / cf_etica_naturaleza | boolean | campos formativos |
| eje_inclusion / eje_pensamiento_critico / eje_interculturalidad / eje_igualdad_genero / eje_vida_saludable / eje_apropiacion_lectura / eje_artes_esteticas | boolean | ejes articuladores |

**Libros con actividades físicas** (`tipo_actividad IS NOT NULL` → trackear uso anti-repetición):
- `Múltiples Lenguajes: Trazos y números` (cuadernillo matemáticas)
- `Múltiples Lenguajes: Trazos y palabras` (cuadernillo lenguaje)

**Libros de referencia** (`tipo_actividad IS NULL` → citar libremente):
- `Nuestros Saberes` · `Nuestros Saberes: México, grandeza y diversidad` ·
  `Cartografía de México y el mundo` · `Múltiples Lenguajes`

### `ltg_metodologias_estructuras` — momentos exactos por metodología (FUENTE DE VERDAD)
Columnas: `metodologia`, `fase_numero`, `fase_nombre`, `momento_numero`, `momento_nombre`, `descripcion`.

| Metodología | Momentos (en orden) |
|---|---|
| **Aprendizaje Basado en Problemas** (6) | Presentemos · Recolectemos · Formulemos el problema · Organicemos la experiencia · Vivamos la experiencia · Resultados y análisis |
| **Proyectos Comunitarios** (11) | Identificación · Recuperación · Planificación · Acercamiento · Comprensión y producción · Reconocimiento · Concreción · Integración · Difusión · Consideraciones · Avances |
| **Indagación (STEAM)** (5) | Introducción al tema / Saberes previos · Diseño y desarrollo de la indagación · Establecer conclusiones · Presentación de resultados y propuesta de acción · Metacognición / Reflexión |
| **Aprendizaje Servicio** (5) | Punto de partida · Lo que sé y lo que quiero saber · Organicemos las actividades · Creatividad en marcha · Compartimos y evaluamos lo aprendido |

> Siempre lee los momentos desde `ltg_metodologias_estructuras` filtrando por la `metodologia`
> exacta del proyecto; no los memorices.

### `materiales_sesion` — anexos y materiales de cada sesión
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| sesion_id | uuid | FK → dosificacion_sesiones |
| proyecto_dos_id | uuid | FK → dosificacion_proyectos |
| codigo | text | convención `ANX-P##-S##-##` (sin constraint en BD) |
| tipo | text | CHECK imagen · hoja_trabajo · cartel · presentacion · video · audio · texto · otro |
| descripcion | text | qué es y para qué sirve |
| herramienta | text | CHECK `gemini_nano_banana` · `gemini_pro` · `claude` · `youtube` · `manual` |
| prompt_generacion | text | texto completo (claude) / prompt (gemini) / URL (youtube) |
| estado | text | CHECK pendiente · generado · subido · vinculado |
| ruta_drive_sugerida | text | ej. `1°/T1/P03/S05/` |
| link_drive / link_youtube / nombre_archivo / notas | text | |

---

## CONSULTAS

### 1. Leer proyecto completo para generar
```sql
SELECT
  dp.id AS proyecto_id, dp.numero_proyecto, dp.nombre_proyecto,
  dp.metodologia, dp.escenario, dp.num_sesiones_estimadas,
  dp.campos_formativos, dp.ejes_articuladores, dp.pregunta_generadora,
  dp.trimestre, dp.grados,
  dpda.id AS dos_pda_id, dpda.grado, dpda.campo_formativo,
  dpda.contenido_texto, dpda.pda_texto
FROM dosificacion_proyectos dp
JOIN dosificacion_pdas dpda ON dpda.proyecto_dos_id = dp.id
WHERE dp.ciclo_escolar   = '2025-2026'
  AND dp.numero_proyecto = [N]
  AND dpda.grado         = [GRADO]
  AND dpda.estado        = 'pendiente'
ORDER BY dpda.campo_formativo, dpda.contenido_texto;
```

### 2. Momentos de la metodología del proyecto
```sql
SELECT momento_numero, momento_nombre, descripcion
FROM ltg_metodologias_estructuras
WHERE metodologia = '[metodologia exacta del proyecto]'
ORDER BY momento_numero;
```

### 3. Actividades de libro disponibles (no usadas) para una sesión
```sql
SELECT li.id, li.titulo, li.libro, li.pagina, li.tipo_actividad, li.link
FROM ltg_indices li
WHERE li.grado = [GRADO]
  AND li.tipo_actividad IS NOT NULL
  AND li.[cf_columna] = true
  AND li.id NOT IN (
    SELECT sll.ltg_indice_id
    FROM sesion_links_ltg sll
    JOIN dosificacion_sesiones ds ON ds.id = sll.sesion_id
    JOIN dosificacion_proyectos dp ON dp.id = ds.proyecto_dos_id
    WHERE dp.ciclo_escolar = '2025-2026'
      AND [GRADO] = ANY(dp.grados)
  )
ORDER BY li.pagina;
```
`[cf_columna]` según el CF: Lenguajes→`cf_lenguajes` · Saberes→`cf_saberes` ·
De lo Humano→`cf_humano_comunitario` · Ética→`cf_etica_naturaleza`.

### 4. Páginas de referencia para citar (sin restricción)
```sql
SELECT li.titulo, li.libro, li.pagina, li.link
FROM ltg_indices li
WHERE li.grado = [GRADO]
  AND li.tipo_actividad IS NULL
  AND li.[cf_columna] = true
ORDER BY li.libro, li.pagina;
```

### 5. Ver qué proyectos faltan por generar
```sql
SELECT numero_proyecto, nombre_proyecto, estado, num_sesiones_estimadas
FROM dosificacion_proyectos
WHERE ciclo_escolar = '2025-2026' AND estado = 'pendiente'
ORDER BY trimestre, numero_proyecto;
```

---

## OPERACIONES AL GUARDAR (tras generar TODAS las sesiones)

### A. (Opcional) Marcar proyecto en progreso
```sql
UPDATE dosificacion_proyectos SET estado = 'en_generacion' WHERE id = '[proyecto_id]';
```

### B. Insertar cada sesión (una por una, guarda el RETURNING id)
```sql
INSERT INTO dosificacion_sesiones (
  proyecto_dos_id, numero_sesion, campo_formativo, momento, momento_metodologico,
  duracion_minutos, estado,
  inicio_todos, inicio_diferenciado, inicio_actividades,
  desarrollo_todos, desarrollo_diferenciado, desarrollo_actividades,
  cierre_todos, cierre_diferenciado, cierre_actividades,
  cierre_tareas, pda_sesion, recursos, productos, observaciones
) VALUES (
  '[proyecto_id]', [numero_sesion], '[campo_formativo]', '[momento]', '[momento]',
  90, 'borrador',
  'Texto inicio para todos | NULL',
  NULL,                                                              -- inicio_diferenciado
  '{"mode":"todos","todos":["Act 1","Pregunta: ¿…?"],"diferenciado":null}'::jsonb,
  NULL,                                                              -- desarrollo_todos
  '{"4":"qué hace 4°","5":"qué hace 5°"}'::jsonb,                   -- desarrollo_diferenciado
  '{"mode":"diferenciado","todos":null,"diferenciado":{"4":["Act 4°"],"5":["Act 5°"]}}'::jsonb,
  'Cierre compartido',
  NULL,
  '{"mode":"todos","todos":["Reflexión"],"diferenciado":null}'::jsonb,
  '{"mode":"diferenciado","todos":null,"diferenciado":{"4":["Tarea 4°"],"5":["Tarea 5°"]}}'::jsonb,
  '[{"grado":4,"pda_id":"uuid","pda_texto":"…","criterio_aplicado":"Criterio 4°"}]'::jsonb,
  '{"archivos":[],"links":[]}'::jsonb,
  ARRAY['Producto esperado'],
  NULL
) RETURNING id;
```

### C. Registrar PDAs cubiertos por esa sesión
```sql
UPDATE dosificacion_pdas
SET estado = 'cubierto', sesion_numero = [numero_sesion]
WHERE id IN ('[dos_pda_id_1]', '[dos_pda_id_2]');
```

### D. Registrar join sesión ↔ PDAs (con criterio)
```sql
INSERT INTO dosificacion_sesion_pdas (sesion_id, dos_pda_id, criterio_evaluacion)
VALUES
  ('[sesion_id]', '[dos_pda_id_1]', '[criterio 1]'),
  ('[sesion_id]', '[dos_pda_id_2]', '[criterio 2]');
```

### E. Registrar actividades de libro usadas (solo `tipo_actividad IS NOT NULL`)
```sql
INSERT INTO sesion_links_ltg
  (sesion_id, ltg_indice_id, nombre_libro, paginas, descripcion, link_libro, momento)
VALUES
  ('[sesion_id]', '[ltg_id]', '[nombre_libro]', '[pagina]', '[descripción]', '[link]', '[inicio|desarrollo|cierre|tarea]');
```

### F. Registrar anexos de la sesión
```sql
INSERT INTO materiales_sesion
  (sesion_id, proyecto_dos_id, codigo, tipo, descripcion,
   herramienta, prompt_generacion, estado, ruta_drive_sugerida, nombre_archivo)
VALUES (
  '[sesion_id]', '[proyecto_id]',
  'ANX-P03-S05-01', '[tipo]', '[descripción]',
  '[herramienta]', '[contenido/prompt/url]', 'pendiente',
  '[1°/T1/P03/S05/]', '[nombre_archivo.ext]'
);
```

### G. Cerrar el proyecto
```sql
UPDATE dosificacion_proyectos SET estado = 'generado' WHERE id = '[proyecto_id]';
```

---

## IMPORTADOR → SaaS (se construye al activar el SaaS; aquí queda especificado)

Al comprar un proyecto, por cada `dosificacion_proyectos`:

1. **`INSERT INTO proyectos`** copiando campos y **traduciendo nombres** (tabla abajo);
   `maestro_id` = comprador, `grupo_id` = su grupo, `visible_mercado=false`,
   `es_multigrado` = `array_length(grados,1) > 1`. Devuelve `proyecto_id`.
2. **`INSERT INTO sesiones`** copiando **1:1** las columnas espejo de `dosificacion_sesiones`,
   con dos ajustes: `momento_metodologico`/`momento` → `sesiones.momento` ·
   `duracion_minutos` (smallint) → `sesiones.duracion` (text, ej. `"90 min"`). Reasignar `proyecto_id`.
3. `materiales_sesion` / `sesion_links_ltg` NO se copian al SaaS (o se exponen como anexos si se decide).

**Traducción de nombres (única fuente de verdad):**
| dosificación | SaaS (`proyectos`) |
|---|---|
| Aprendizaje Basado en Problemas | ABP |
| Proyectos Comunitarios | ABPC |
| Indagación (STEAM) | STEAM |
| Aprendizaje Servicio | AS |
| Aula | Aula |
| Escolar | Escuela |
| Comunitario | Comunidad |

**Mapeo `dosificacion_sesiones` → `sesiones` (todo 1:1 salvo las 2 notas):**
`inicio/desarrollo/cierre_todos`, `*_diferenciado`, `*_actividades`, `cierre_tareas`,
`pda_sesion`, `recursos`, `campo_formativo`, `observaciones`, `numero_sesion` → iguales ·
`momento_metodologico`→`momento` · `duracion_minutos`→`duracion`.

---

## NOTAS DURAS

- **Un proyecto por conversación.** Empieza SIEMPRE con la consulta 1 para leer el estado real;
  nunca asumas qué PDAs están pendientes.
- **Anti-repetición automática.** PDAs `cubierto` no aparecen en la consulta; las actividades
  ya registradas en `sesion_links_ltg` se excluyen de la consulta de disponibles.
- **Multigrado:** si `grados` tiene >1 elemento, consulta PDAs de TODOS los grados y usa los
  modos `diferenciado` por grado en la sesión.
- **JSON válido:** todos los campos jsonb deben ser JSON válido; escapa comillas internas.
- **Orden de guardado:** B (INSERT sesión → id) → C → D → E → F → G. No al revés.
- **El bot nunca escribe** `proyectos`, `sesiones`, `tareas`, `calificaciones`, `asistencias`.
