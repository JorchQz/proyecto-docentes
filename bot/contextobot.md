# Contexto del Bot Generador de Planeaciones NEM

## ¿Qué es este bot?

Un generador de planeaciones docentes completas para educación primaria mexicana
(Nueva Escuela Mexicana). Opera como un maestro experto: lee los PDAs asignados desde
Supabase, diseña sesiones pedagógicas completas con diferenciación por grado y guarda
todo estructurado en la base de datos.

Documentos hermanos:
- `instrucciones.md` — manual operativo (rol, flujo paso a paso, reglas duras).
- `REFERENCIA_SUPABASE_generador.md` — esquema real, consultas y operaciones de guardado.

---

## Propósito dual (el porqué de guardar todo desde ahora)

**Ahora (fase actual):** generar planeaciones para vender empaquetadas en Google Drive
mientras se termina el SaaS.

**Futuro (transición al SaaS):** los proyectos que el bot almacena en las tablas
`dosificacion_*` se importan al perfil del maestro comprador. El SaaS genera entonces el
control de calificaciones, tareas y seguimiento de PDAs por alumno **sin reprocesar nada**,
porque el bot ya guardó en el mismo formato que el SaaS lee.

**Por eso todo debe quedar almacenado correctamente desde ahora** — el bot es el pipeline de
contenido del marketplace. El plan de negocio: vender la planeación ahora → terminar el SaaS →
ofrecer todo junto (planeaciones + material didáctico + control total del grupo en una sola página).

---

## Stack del proyecto completo

| Herramienta | Rol |
|---|---|
| Supabase | Base de datos (PostgreSQL) |
| Claude | Bot generador de planeaciones (este bot) |
| Gemini Pro / Nano Banana | Generador de materiales visuales e imágenes |
| Google Drive | Almacenamiento de archivos generados |
| Node.js + docx-js | Exportación a Word para la venta actual |

---

## Arquitectura de datos: dos mundos unidos por catálogos

```
BOT / marketplace                                  SaaS (maestro)
dosificacion_proyectos ──< dosificacion_pdas       proyectos ──< sesiones
        └──< dosificacion_sesiones                                └──< tareas / calificaciones / asistencias
                 ├──< dosificacion_sesion_pdas
                 ├──< materiales_sesion
                 └──< sesion_links_ltg
   catalogo_contenidos / catalogo_pda / ltg_*  ← compartidos
```

`dosificacion_sesiones` quedó **alineada al shape nativo de `sesiones`** del SaaS, de modo que
importar = copia casi 1:1 + reasignar dueño + traducir nombres. Detalle en la REFERENCIA.

---

## Flujo del bot paso a paso

```
1. Usuario: "Genera el Proyecto 3 de 4°-5°-6°"
2. Bot consulta dosificacion_proyectos + dosificacion_pdas → metodología, escenario, grados, PDAs pendientes
3. Bot consulta ltg_metodologias_estructuras → momentos exactos de la metodología
4. Bot consulta ltg_indices → actividades de libro disponibles (no usadas)
5. Bot genera el encabezado del proyecto (campos formativos, contenidos y PDAs por grado)
6. Bot distribuye PDAs en sesiones según los momentos de la metodología
7. Bot redacta cada sesión:
   - Secuencia didáctica (inicio/desarrollo/cierre) con lo igual para todos
   - Diferenciación por grado donde aplica
   - Tareas de cierre diferenciadas por grado
   - PDA + criterio de evaluación por grado
8. Bot genera lista de anexos (prompts Gemini / textos Claude / búsqueda de video)
9. Bot guarda en Supabase en orden (ver REFERENCIA, operaciones B→G)
```

---

## Estructura de almacenamiento de la sesión (RESUELTO)

> Antes este documento proponía `secuencia_didactica` + `diferenciacion_grados`. Eso quedó
> **reemplazado** por el shape espejo de `sesiones`, que es lo que el SaaS sabe leer.

Cada sesión se guarda en `dosificacion_sesiones` con columnas separadas por bloque:

- **Igual para todos:** `inicio_todos` / `desarrollo_todos` / `cierre_todos` (text) +
  `*_actividades` con `{"mode":"todos","todos":[...],"diferenciado":null}`.
- **Diferenciado por grado:** `inicio_diferenciado` / `desarrollo_diferenciado` /
  `cierre_diferenciado` (jsonb `{"4":"…","5":"…"}`) + `*_actividades` con
  `{"mode":"diferenciado","todos":null,"diferenciado":{"4":[…],"5":[…]}}`.
- **Tareas:** `cierre_tareas` (jsonb, mismo shape; multigrado = modo diferenciado por grado).
- **PDA + evaluación:** `pda_sesion` (jsonb `[{grado,pda_id,pda_texto,criterio_aplicado}]`).

Para proyectos de un solo grado, usa el modo "todos" en los bloques y un solo grado en
`cierre_tareas`/`pda_sesion`.

---

## Nombres exactos usados en la base de datos

### Metodologías (`dosificacion_proyectos.metodologia`) — nombres completos
`Aprendizaje Basado en Problemas` · `Proyectos Comunitarios` · `Indagación (STEAM)` · `Aprendizaje Servicio`

> La traducción a las abreviaciones del SaaS (`ABP`, `ABPC`, `STEAM`, `AS`) y de escenarios
> (`Escolar`→`Escuela`, `Comunitario`→`Comunidad`) la aplica el **importador**, no el bot.

### Momentos por metodología (fuente: `ltg_metodologias_estructuras`)
- **Aprendizaje Basado en Problemas** (6): Presentemos · Recolectemos · Formulemos el problema ·
  Organicemos la experiencia · Vivamos la experiencia · Resultados y análisis
- **Proyectos Comunitarios** (11): Identificación · Recuperación · Planificación · Acercamiento ·
  Comprensión y producción · Reconocimiento · Concreción · Integración · Difusión · Consideraciones · Avances
- **Indagación (STEAM)** (5): Introducción al tema / Saberes previos · Diseño y desarrollo de la
  indagación · Establecer conclusiones · Presentación de resultados y propuesta de acción · Metacognición / Reflexión
- **Aprendizaje Servicio** (5): Punto de partida · Lo que sé y lo que quiero saber ·
  Organicemos las actividades · Creatividad en marcha · Compartimos y evaluamos lo aprendido

### Escenarios (`dosificacion_proyectos.escenario`)
`Aula` · `Escolar` · `Comunitario`

---

## Código de materiales (`materiales_sesion.codigo`)

Convención (sin constraint en BD): `ANX-P##-S##-##`  ·  ejemplo: `ANX-P03-S05-01`.

### Tabla de decisión herramienta ↔ tipo
| Situación | tipo | herramienta |
|---|---|---|
| Situación problema, cuento, lectura | texto | claude |
| Hoja de ejercicios solo texto | hoja_trabajo | claude |
| Hoja con layout visual, recortable, memorama | hoja_trabajo | gemini_pro |
| Portada, ilustración, tarjetas con imágenes | imagen | gemini_pro / gemini_nano_banana |
| Cartel informativo, mural | cartel | gemini_pro |
| Presentación PPT | presentacion | gemini_pro |
| Video buscado por Gemini en YouTube | video | gemini_pro |
| Video con URL ya conocida | video | youtube |
| Material que hace el maestro a mano | otro | manual |

---

## Decisiones de arquitectura (RESUELTAS)

1. **Tareas en multigrado** → JSONB por grado en `cierre_tareas` (`{mode,todos,diferenciado}`),
   que el SaaS materializa a la tabla `tareas` con columna `grado`. No texto plano.
2. **Ciclo escolar como variable** → el bot lee `ciclo_escolar` del proyecto; no se hardcodea.
3. **Alineación de nombres** → el bot usa los nombres completos de `dosificacion_*`; el importador
   traduce a las abreviaciones del SaaS (tabla en la REFERENCIA).
4. **Mapeo dosificacion_sesiones → sesiones** → 1:1 por columnas espejo (salvo
   `momento_metodologico`→`momento` y `duracion_minutos`→`duracion`). Detalle en la REFERENCIA.
