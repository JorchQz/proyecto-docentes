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
- **Lenguaje (regla de Jorge, 2026-09-26):** Mi Salón es para docentes, hombres y mujeres. En la app,
  los correos, los avisos y la publicidad se dice "docente" o "docentes", nunca solo "maestra" o
  "maestro"; se habla de "tú" y sin palabras con género sobre la persona ("Te damos la bienvenida",
  no "Bienvenida"); tono claro, sin urgencia falsa. No cambian los nombres de tablas y columnas
  (`maestro_id`), los textos legales con "usted" (salvo el género) ni las citas oficiales. "Sala de
  Maestros" sigue como nombre propio (pregunta abierta). Lo vigila `pruebas/lenguaje-docente.test.js`.
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

## 3. Evaluación diaria y calificación trimestral

**Base legal:** Acuerdo 10/09/23 de la SEP (DOF 27/09/2023). El número oficial vive solo
en la boleta, por campo formativo y por periodo (art. 4 VII, art. 8); es un **juicio del
docente** sobre el conjunto de evidencias (art. 4 XI). El Acuerdo no regula el trabajo diario.

**Trabajo diario (formativo)** — la unidad de captura es el **producto** de la sesión
(`productos_sesion`), no la actividad:
- **Tareas y trabajos:** por producto, un **semáforo** `logrado / en_proceso / requiere_apoyo`
  + `retroalimentacion` + estado de entrega; `puntaje` 0–10 es un ajuste fino **opcional**
  (grano en `calificaciones` con `producto_sesion_id`). Se captura en la pantalla "Hoy".
  Nada escribe ya el formato viejo (`calificacion` 5–10 sin producto); si quedara alguna
  fila así, el motor la toma como `calificacion/10` y la boleta lo advierte.
- **Participación y conducta:** una vez al día por alumno, global (no por campo ni sesión),
  en `registro_diario` con valores **0 · 1 · 2**. **La conducta no pondera** (decisión de
  Jorge del 2026-09-24; LGE art. 21: la conducta se informa **aparte** de los resultados):
  se sigue registrando en el cierre del día y aparece en los textos de la boleta (fortalezas
  y áreas) y en los reportes como dato de referencia, rotulada "no pondera", igual que la
  asistencia.
- **Asistencia:** presente / ausente / justificada. **Es solo referencia: nunca pondera**
  (art. 7 I d: "no se considera como un criterio para la acreditación"). La boleta muestra
  el porcentaje de días asistidos aparte.

**Calificación de boleta (oficial)** por campo formativo y trimestre:
- Ponderación en `maestro_ajustes`: tareas / trabajos / participación / examen, default
  **28 / 28 / 6 / 33** (suman 95). Los pesos son relativos: cada rubro vale su peso entre
  la suma de los rubros con datos (con los cuatro, las tareas valen 28/95). Cualquier peso
  puede ser 0. Rubro sin datos: su peso se renormaliza. **La conducta no pondera**: el motor
  le pone peso 0 siempre e ignora `peso_conducta` (la columna se conserva; un peso
  personalizado viejo no se borra) y Ajustes ya no deja darle peso. Las boletas cerradas
  antes del cambio conservan su foto con el peso de conducta que tenía; no se recalculan.
  Migración `supabase/mi_salon_b10_conducta_2026-09.sql` (DEFAULT `peso_conducta` 0; el CHECK
  `pesos_suman_100` se reemplaza por `pesos_con_valor`: los cuatro pesos suman más de 0).
- Porcentaje → calificación con **una sola regla**, la función SQL
  `calcular_calificacion_boleta(porcentaje, grado)`: ≥90→10, 80–89→9, 70–79→8, 60–69→7,
  50–59→6, <50→5, con **piso por grado** (art. 9; decisión 17b de Jorge, 2026-09-24, que
  reemplaza a la 17):
  - **1°: enteros 6–10.** Nunca baja de 6 (1° se acredita con haberlo cursado).
  - **2° a 6°: enteros 5–10; 5 no es aprobatorio.** Antes 2° usaba 6–10 por ser Fase 3; la
    escala ya **no** va por fase (la boleta DGAIR de 2°, la AEFCM, SEIEM y el proyecto de
    sentencia de la SCJN AR 419/2025 dan 5–10 en 2°).
  El trigger `boleta_trimestral_piso_fase` impide guardar un número bajo el piso, venga del
  motor o de un ajuste manual (`piso_calificacion_boleta`: migración
  `supabase/mi_salon_b11_escala_2_2026-09.sql`). En el código la misma regla vive en
  `js/reglas-entidad.js` (selector "Elige", rótulos "Enteros de 5 a 10; 5 no es
  aprobatoria" / "Enteros de 6 a 10; 1° se acredita con haberlo cursado"). Las boletas de 2°
  cerradas antes del cambio no se tocan y siguen mostrando la escala de su foto (6 a 10).
- **Reglas por entidad** (decisión 21): el estado de la maestra se guarda en
  `perfiles.estado` (nombre de `js/entidades.js`, las 32 entidades; obligatorio en el
  onboarding, editable en Mi cuenta; Inicio avisa si falta, sin bloquear). `js/reglas-entidad.js`
  es el punto único donde se activaría la variante de un estado; hoy todas usan la regla
  nacional (escala por grado, acreditación, promedios redondeados a un decimal).
- **Motor único: `js/motor-calificacion.js`** (B.3, 2026-09-22; reemplazó a `calcCF`).
  Lee `productos_sesion` + `calificaciones` (grano nuevo) + `registro_diario` + el examen
  **del grado del alumno**. No hay otra fórmula en ningún `.js`. Valor de un producto:
  `puntaje/10` si lo hay; si no `logrado 1 · en_proceso 0.7 · requiere_apoyo 0.4`;
  `incompleto` sin nivel 0.5; `no_entregado` 0; `justificado`/`no_aplica` y lo aún no
  capturado salen del máximo. Participación y conducta se reparten en partes iguales entre
  los campos con sesión ese día (la conducta se cuenta para textos y reportes, no para el
  porcentaje).
- **Evaluación final del ciclo** (Acuerdo 10/09/23, arts. 7 III b y 9; formato de las
  boletas DGAIR 2024-2025): por campo, T1, T2, T3 y una **final** = promedio de las tres
  calificaciones **confirmadas**, con un entero y un decimal, **redondeado al décimo más
  cercano, con .5 hacia arriba** (decisión de Jorge del 2026-09-24, con la evidencia de la
  maestra piloto: la plataforma de control escolar donde se suben las calificaciones acepta un
  decimal y redondea, 6.67 queda 6.7; antes Mi salón truncaba). **Promedio final de grado** =
  promedio de las cuatro finales ya redondeadas (como la boleta oficial, que muestra las dos),
  redondeado igual. Se cuenta en milésimas enteras, sin coma flotante (6.65 → 6.7,
  6.649 → 6.6, 5.95 → 6.0; 7, 8, 8 → 7.7). La calificación de cada trimestre sigue siendo un
  entero por juicio docente (la app propone y la maestra elige), y los **porcentajes** de logro
  siguen truncados a 2 decimales: de ellos sale la propuesta entera.
  **Acreditación** (decisión 18b): 1° con haber cursado el grado. De 2° a 6°, **"Acredita"**
  si el promedio final de grado y las cuatro finales por campo llegan a 6.0; **"Revisar"** si
  el promedio llega a 6.0 pero algún campo no (con la explicación "Promedio de 6 o más, pero
  {campo} tiene menos de 6. Algunas entidades exigen mínimo 6 en cada campo; confírmalo con
  tu control escolar"; nunca "No acredita" solo por eso); **"No acredita"** si el promedio
  es menor que 6.0. Solo con los tres trimestres de los cuatro campos confirmados; antes, "pendiente" (nunca
  un número parcial como final). Grado: el de la foto del cierre del 3er trimestre si está
  cerrado. Una sola función: `ReporteDatos.finalCiclo` (`js/reporte-datos.js`), que usan la
  boleta imprimible (columna Final), el reporte detallado, la pestaña Boleta de Reportes, el
  Concentrado y la exportación (columnas al final). Los promedios de calificaciones de toda
  la app (general del trimestre en la boleta imprimible, Concentrado y Vista Recrea) también
  se redondean a un decimal. Con calificaciones enteras una final es n, n.3 o n.7: si el
  redondeo sube el promedio de 5.9 a 6.0, algún campo quedó bajo 6 y el resultado es
  "Revisar", no "Acredita". Las boletas cerradas guardan solo sus enteros; la final se
  calcula al mostrarla, así que el cambio no tocó la base.

> **Pruebas automáticas (`pruebas/`, se corren con `node`, sin npm):** no son una suite
> formal, son redes de seguridad para lo que ya se rompió una vez. Cada prueba **extrae
> las funciones del archivo real** en lugar de copiarlas, así que si el código cambia de
> forma la prueba truena.
> Todas de una vez: `for t in pruebas/*.test.js; do node $t | tail -1; done` (76 suites al 2026-09-26).
> - `lanzamiento-integracion` (2026-09-26) — decisiones de Jorge que cruzan b20, b21 y b22: la calificación directa ya confirmada (pantalla del asistente, Reportes, Qué le falta, Exportar y junta; la base, en `pruebas/sql/calificacion-directa.sql`), Ponte al día en un grupo adicional y "Sin clase" como suspensión en `calendario_ajustes`. `bandeja-salida` §13: `capturado_en` en la asistencia nueva de la cola.
> - `lenguaje-docente` (2026-09-26) — ningún texto visible del SaaS, de la tienda de Mi Salón, de las Edge Functions ni de b20-b22 dice "maestra"/"maestro" ni usa palabras con género sobre la persona; lista blanca con su razón (Sala de Maestros, valores guardados, Director(a), etiquetas de archivos de la tienda).
> - `registro-historico` (2026-09-26) — lista pegada (Excel, WhatsApp, compuestos, acentos), días de clase y cuadrícula de asistencia, captura en bloque, calificación directa en el motor y la boleta (escala por grado), reglas `es_historico` (Hoy, Inicio, Tareas, Qué le falta, cumpleaños) y `delete_own_account` de b20.
> - `flujo-libre` (2026-09-26) — regla única de "¿Para quién?" (y el motor con ella), `planAsignacion`, `siguienteDiaDeClase` (CTE, festivos, vacaciones, ajustes, fin de ciclo), `venceTarea`, incompleta/pendiente/completada/sigue incompleta y su valor, sueltas y "Pasar a un proyecto", y los arreglos de R25a. `bandeja-salida` §10: la cola sin señal con las columnas nuevas.
> - `motor-calificacion` — aritmética del motor y conteo de entrega aparte de la calidad;
>   la conducta no pondera (peso 0 aunque los ajustes traigan otro) y cuadre a mano 28/28/6/33.
> - `evaluacion-final` — final por campo, promedio final de grado y acreditación
>   (`ReporteDatos.finalCiclo`): redondeado al décimo (6.65 → 6.7, 6.649 → 6.6), "pendiente" mientras falte algo, 1° siempre
>   acredita, 2° a 6° "Acredita" / "Revisar" (algún campo debajo de 6) / "No acredita"
>   (promedio debajo de 6); y que boleta imprimible, reporte y Concentrado la usan.
> - `reglas-entidad` — escala por grado (1° de 6 a 10, 2° a 6° de 5 a 10) igual que la
>   migración b11, nada decide la escala por fase, las 32 entidades, el selector del
>   onboarding y de Mi cuenta, el aviso de Inicio y los renglones de matemáticas de 2°.
> - `ajustes-peso-efectivo` — la línea "vale X %" de Ajustes (10, 20… 100 ya no salen
>   vacíos) y la frase con los rubros que tienen peso.
> - `aviso-propuesta` — el aviso "propuesta: N" de la boleta.
> - `hoy-filtros`, `hoy-render` — filtros y render multigrado de la pantalla "Hoy".
> - `hoy-arranque` — **ejecuta `hoy.js` completo** contra un DOM y un Supabase falsos
>   (incluye "Trabajar hoy"; acepta la ruta de otra versión para probar una regresión).
> - `avance-pda` — tablas de la pestaña "Avance por PDA".
> - `textos-boleta` — reglas de la Capa 1 (entrega vs calidad, frases por varios campos,
>   plural de sugerencias, marca por cuadro de lo editado).
> - `boleta-arranque` — **ejecuta `reportes.js` completo** y genera una boleta: motor, piso
>   por fase, confirmación y textos propuestos, de punta a punta.
> - `boleta-ia` — convivencia de la Capa 1, lo redactado por la IA y lo escrito por el
>   maestro, con un Supabase falso que imita el upsert de PostgREST (unión de columnas).
> - `reportes-grupo` — Vista Recrea y Concentrado (solo calificaciones confirmadas).
> - `inicio-actividades` — el plan de Inicio lee bien las actividades de "Crear proyecto".
> - `tareas-situacion`, `alcance-hoy` — Tareas cuenta como revisado cualquier estado de
>   entrega; "Hoy", Inicio y Tareas usan el mismo alcance de proyectos, la misma cuenta del
>   cierre del día y leen sin el tope de 1000 filas de Supabase (1080 y 7200 calificaciones).
> - `boleta-imprimible`, `reporte-alumno`, `junta`, `exportar` — render y cálculo de los
>   cuatro reportes de B.8 con datos de ejemplo (confirmada vs "pendiente", pisos,
>   privacidad de la junta, columnas y CSV).
> - `sin-emojis` — ningún emoji ni símbolo tipo emoji en el SaaS (rangos completos).
> - `boleta-cerrada` — **ejecuta `reportes.js` completo** con una boleta cerrada y capturas
>   posteriores: nada se vuelve a guardar ni a proponer (porcentaje, textos, fila GEN y
>   trabajo diario del cierre), más las reglas compartidas de `ReporteDatos`.
> - `lecturas-sin-tope` — revisa el código de `js/`: ninguna lectura de una tabla que crece
>   sin paginar, fuera de una lista de lecturas acotadas (con el filtro exacto que las acota
>   y su razón); y `js/leer-todo.js`.
> - `lecturas-revisan-error` — revisa TODAS las lecturas de `js/`: cada una va en un paginador
>   (que lanza el error), revisa su error, o lleva un comentario `lectura-opcional:` con la
>   razón de que sea seguro seguir sin ese dato (o `error-revisado-en:` si se revisa más
>   adelante). Una lectura nueva que ignore su error hace fallar la prueba.
> - `lecturas-con-error` — ejecuta "Hoy" y la boleta de Reportes completas con cada una de
>   sus lecturas en error: avisan y no escriben nada (antes el cierre del día pisaba lo
>   capturado y la boleta guardaba su propuesta encima de lo confirmado).
> - `sesiones-materializar`, `proyecto-edicion`, `productos-hoy`, `alta-nombres` (2026-09-26) —
>   materialización idempotente y un producto por grado; proyecto iniciado editable, paso 1,
>   guardado sin huérfanos, catálogo, clonar y nombres oficiales; agregar/renombrar/quitar en
>   Hoy, varios proyectos activos e inactivos que no cuentan; nombres con acentos y Ñ y el
>   borrador del alta.
> Variables para probar otra copia: `REPORTES_JS=ruta` (pruebas que leen `reportes.js`).
- **Trazabilidad por PDA (B.5, 2026-09-23):** el maestro califica el producto una vez y
  el trigger `propagar_calificacion_a_pda` deja la evidencia en cada PDA que ese producto
  evalúa (`producto_sesion_pda` → `sesiones_pda`), **solo los del grado del alumno**.
  El semáforo sale de `nivel_desde_calificacion`: el nivel capturado; si no hay, el puntaje
  (≥8 logrado, ≥6 en proceso); `no_entregado` cuenta como `requiere_apoyo`; `justificado`
  y `no_aplica` sin nivel capturado retiran la evidencia (si hay nivel, manda el nivel).
  Borrar la calificación también la retira.
  Lo que el maestro ajusta en la pantalla de evaluación formativa queda con
  `origen = 'maestro'` y ya no se vuelve a pisar.
  La vista **`v_avance_pda`** resume por alumno y PDA: evidencias, nivel predominante,
  conteo por nivel y **tendencia** (primera mitad del trimestre contra la segunda).
  Se ve en Reportes → pestaña "Avance por PDA", por alumno o de todo el grupo.
- **Textos de la boleta, Capa 1 (B.7):** `js/textos-boleta.js` propone fortalezas, áreas
  de oportunidad y sugerencias **por reglas, sin IA**. Nada se afirma con una sola
  evidencia. PDA con al menos 2 evidencias (`v_avance_pda`) → su campo; **hábitos por
  ENTREGA** (tareas entregadas, trabajos terminados, sumando campos) → fila general `GEN`;
  **calidad de lo entregado** (≥2 entregados) y examen → su campo, o una sola frase en `GEN`
  nombrando los campos si aplica a varios; participación, conducta, cuaderno y asistencia
  (solo observación) → `GEN`; lectura → LEN; matemáticas básicas → SAB. "Trabajo diario"
  sale de la entrega, nunca de la calidad. Máximo 4 frases por sección con prioridad al
  aprendizaje; sugerencias del catálogo `plantillas_sugerencia` (en plural si una sirve a
  varios PDA). La propuesta se guarda siempre en `texto_autogenerado`.
  **Lo del maestro manda, cuadro por cuadro:** editar un cuadro lo anota en
  `texto_autogenerado.editados` (y pone `editado_manual`); ese cuadro ya no se vuelve a
  proponer aunque quede vacío (`TextosBoleta.esEditado`, que también usan los reportes y la
  IA). Filas sin esa marca pero con `editado_manual` cuentan como editados los tres.
  "Volver a proponer" es la única forma de reemplazarlo y avisa antes.
  Los PDA en apoyo se **citan** («…») y se recortan en una cláusula completa.
  **Guardado:** varias filas de distinta forma se guardan con un upsert por forma
  (`upsertPorForma` en `reportes.js`): PostgREST usa la unión de columnas y pondría NULL
  en lo que una fila no trae (así se llegaron a borrar textos del maestro).
- **Capa 2, redacción con IA (B.7):** Edge Function `redactar-boleta` (Claude, modelo
  `claude-opus-5`). La llave es el secreto `ANTHROPIC_API_KEY` de las Edge Functions;
  **hoy no existe**, así que `accion: "estado"` responde `configurada: false` y el botón
  "Redactar con IA" no aparece. No se manda el nombre del alumno. Guarda en
  `texto_autogenerado.ia`, copia solo a los cuadros que el maestro no editó y marca
  `texto_autogenerado.visible = "ia"`; la Capa 1 no lo pisa al reabrir la boleta.
- **Reportes (B.8):** todos leen de `js/reporte-datos.js` (motor, calificación oficial =
  la confirmada, textos, diagnóstico): `boleta.html`, `reporte-alumno.html`, `junta.html`,
  `exportar.html`, y en `reportes.html` la Vista Recrea y el Concentrado
  (`js/reportes-grupo.js`). Lo no confirmado es "pendiente" en todos.
- **El maestro confirma el número antes de cerrar** (art. 4 XI): la boleta muestra la
  calificación propuesta en un selector acotado al piso del grado; `boleta_trimestral`
  guarda `calificacion_confirmada` y `confirmada_en`, y el trigger
  `boleta_trimestral_confirmacion` impide `cerrada = true` sin confirmación. Una vez
  confirmada, el motor solo refresca `porcentaje`: no pisa el número del maestro.
- **Boleta cerrada** ("Cerrar boleta" cierra los cuatro campos juntos;
  `ReporteDatos.boletaCerrada`): lo entregado queda fijo en la pantalla de Reportes, la
  boleta imprimible, el reporte detallado, la exportación y la función de IA. Se ve el
  `porcentaje` y la calificación guardados (si hubo capturas después, un aviso lo dice y
  el desglose por criterio muestra los datos de hoy); los textos guardados, también los de
  la fila GEN, que no lleva calificación y por eso no se marca `cerrada`; y el trabajo
  diario, el cuaderno, la lectura (PPM y comprensión), las matemáticas y la asistencia de
  referencia de la foto del cierre (`texto_autogenerado.cierre` de la fila GEN:
  `trabajo_diario`, `diagnostico`, `asistencia`; `ReporteDatos.diagnosticaVisible` y
  `asistenciaVisible`). "Cerrar boleta" no cierra si un cuadro o el trabajo diario no se
  pudieron guardar, aunque después se edite en Diagnóstico. El semáforo
  de cada campo es el guardado. El porcentaje se guarda truncado a 2 decimales (el que se
  ve, truncado a 1, no cambia al cerrar). El porcentaje del cierre y el aviso se ven en Reportes
  y en el reporte detallado (la boleta imprimible y la exportación no muestran porcentajes
  por campo). La presentación de junta no es la boleta: grafica el porcentaje de logro del
  grupo con los datos de hoy. No hay forma de reabrirla desde la interfaz. **En la base:** se
  cierra con la función `cerrar_boleta` (foto y cierre de los cuatro campos en una sola
  transacción: o todo o nada) y el trigger `boleta_trimestral_cerrada_inmutable` rechaza
  cualquier cambio a una fila cerrada o a la fila GEN de una boleta cerrada; la política
  restrictiva `boleta_trimestral_no_borrar_cerrada` impide borrarlas, y el trigger
  `boleta_trimestral_cierre_solo_por_funcion` hace que una fila solo quede `cerrada` dentro
  de `cerrar_boleta` (`supabase/mi_salon_b8_cierre_2026-09.sql`). Borrar un alumno sigue
  llevándose su boleta (el borrado en cascada no pasa por RLS).
- **Dónde se captura:** `hoy.html` (§B.1) — asistencia, tareas vencidas, los productos de
  las sesiones del día y el cierre (participación y conducta). Todo se guarda al toque,
  con cola y reintento: nunca se descarta una captura (se reintenta hasta que vuelva la
  red), "Trabajar hoy" espera a que la cola quede vacía antes de recargar y cerrar la
  página con capturas pendientes pide confirmación. Si una lectura falla, la pantalla lo
  dice y no dibuja ni escribe nada (lo mismo Inicio, la boleta de Reportes, Diagnóstico,
  Evaluación formativa, Exámenes, Ajustes, Asistencia y el candado de acceso, que ya no
  manda a la tienda si solo falló la lectura del perfil). Un guardado que falla también
  se avisa (Diagnóstico, Evaluación formativa, Exámenes, cuadros de la boleta). Diagnóstico
  liga el formulario al alumno cuyos datos muestra: mientras cambia de alumno bloquea los
  controles, y si no pudo guardar al que se deja, no cambia. La retroalimentación de "Hoy"
  se guarda también mientras se escribe. `asistencia.html` marca igual que "Hoy" (Presente,
  Falta, Justificada; sin marcar = sin registro; cada toque guarda solo a ese alumno) y
  marcar una falta retira el 1 y 1 del cierre de ese día. Desde 2026-09-24 toda lectura
  pasa por `js/lectura.js` (lanza el error y el arranque común detiene la página con
  "No se pudo cargar"), y participación y conducta valen el rubro completo con 1 o 2 por día
  (0 vale 0). A un alumno dado de alta tarde solo le cuentan los productos desde su alta. La unidad es el producto, no la
  actividad. En multigrado cada
  alumno solo ve los productos cuyos `grados` incluyen el suyo, agrupados por grado.
  Las sesiones de una planeación no traen fecha: "Trabajar hoy" les pone la de hoy (y las
  activa) y "Quitar de hoy" las regresa sin fecha y pendientes mientras no tengan
  calificaciones ni estén completadas. Inicio (`dashboard.html`) resume el día y lleva a "Hoy"; ya no captura.
  **Alcance:** "Hoy" e Inicio miran los mismos proyectos (`js/alcance-hoy.js`):
  activos, en borrador o pausados, del trimestre actual del grupo, o con `fecha_final` en
  los últimos 30 días (o futura). Tareas lista las tareas de todos los proyectos del grupo
  y, con la misma regla (`AlcanceHoy.incluye`), marca "Quedó sin revisar" las que "Hoy" ya
  no muestra; lo "Por revisar" coincide en las tres. "Trabajar hoy" solo ofrece sesiones
  de proyectos activos: puede haber **varios activos a la vez** (uno por campo formativo,
  2026-09-26) y se ofrece la siguiente pendiente de CADA uno, agrupadas con el nombre del
  proyecto, y cualquier otra pendiente a un toque, sin tope (`ProductosHoy.siguientesPorProyecto`,
  `js/productos-hoy.js`). Inicio muestra una tarjeta compacta por proyecto activo y "Terminar
  sesión" completa solo el proyecto de esa sesión. **En plena clase** (2026-09-26), "Agregar
  actividad o tarea" abre un diálogo: nombre, actividad en clase (`trabajo`) o tarea, campo
  (por omisión el de la sesión), grados (por omisión los de la sesión y el proyecto, con las
  casillas del grupo) y, en tareas, el día en que se revisa (por omisión `venceTarea`); se crea
  con `origen='maestro'`, se liga a los PDA de la sesión de sus grados si es de su campo y
  aparece de inmediato. Cada producto se rotula con sus grados ("· 3°", "· 2° y 3°"), se
  **renombra** y se **quita** (`activo = false`) solo si nadie lo ha calificado (lo revisa en
  pantalla, también lo pendiente de enviar, y en la base). Agregar, renombrar y quitar
  necesitan señal (no van por la cola) y lo dicen. Los inactivos no cuentan: motor, "Qué le
  falta", Tareas, Inicio y reportes leen solo `activo = true`. Una tarea sin
  `fecha_entrega` vence el **siguiente día de clase** después de su sesión (`venceTarea` →
  `CalendarioSEP.siguienteDiaDeClase` con los `calendario_ajustes` del grupo: salta CTE,
  suspensiones, vacaciones y registro de calificaciones; fuera de los ciclos cargados, el
  siguiente lunes a viernes; 2026-09-26, revoca la decisión del 25-sep). Quitar se vuelve a
  revisar justo antes de escribir y la base lo rechaza si hay calificaciones (trigger
  `productos_sesion_no_quitar_calificado`, b17; R25a).
  **Fase 2 (2026-09-26, `supabase/mi_salon_b17_flujo_libre_2026-09.sql`):**
  - **¿Para quién?** Al crear una actividad o tarea (en una sesión o suelta): todo el grupo,
    uno o varios grados, o alumnos que la maestra marca por grado, con "¿con qué grado
    trabajan?" (dos de 3° que trabajan con 2°). Se guarda como `productos_sesion.grados` más
    filas de `producto_sesion_alumnos` (`incluir`/`excluir`; `ProductosHoy.planAsignacion`).
    **Regla única** (`AlcanceHoy.asignadoA`/`recibeProducto`; en SQL `alumno_recibe_producto`):
    recibe si (su grado está en `grados` y no está excluido) o está incluido, más el alta tarde.
    La usan Hoy, Inicio, Tareas, el motor (`misProductos`) y Qué le falta. El alumno sigue en su
    grado oficial para boleta y examen. En Hoy un incluido de otro grado dice "Trabaja con 2°".
    Evidencia de PDA: la propagación ya deja evidencia solo en los PDA **del grado del alumno**
    ligados al producto: si la actividad tiene PDA de su grado, cuenta; si no, no deja evidencia de
    PDA pero su calificación cuenta. "Para quién" de un producto ya creado: agregar siempre; quitar
    solo a quien no tiene calificación (`guardar_asignacion_producto` lo revisa). Producto,
    asignación y PDA se guardan en una transacción (`agregar_producto_sesion`).
  - **Actividades sueltas** (guiar sin obligar): botón "Actividad suelta" en Hoy, Inicio y
    Proyectos (`hoy.html?nueva=suelta`). Van a un proyecto contenedor por grupo y trimestre,
    `proyectos.tipo = 'sueltas'` ("Actividades del trimestre", estado `completado`, `fecha_final`
    = su última fecha), con una sesión por fecha y campo (`agregar_actividad_suelta`); así el
    motor, la boleta, Qué le falta, Tareas e Inicio las cuentan sin cambiar su modelo. No salen en
    Proyectos (tiene su sección), Actividades, "Trabajar hoy", iniciar, duplicar ni Crear proyecto.
    **Pasar a un proyecto** (`mover_producto_a_sesion`, `js/pasar-a-proyecto.js`): a una sesión
    de un proyecto del mismo grupo y trimestre, con calificaciones, asignación, PDA y evidencia;
    la sesión suelta que queda vacía se borra.
    **Fecha pasada (2026-09-26, tarde):** una actividad suelta puede ser de cualquier día del
    trimestre en curso (`ProductosHoy.rangoTrimestre`: del calendario SEP según
    `grupos.trimestre_actual`; hoy siempre cabe) y se califica al momento: la de un día que ya pasó
    entra a Hoy al agregarla y ese mismo día (su producto se creó hoy), y en cualquier momento desde
    Proyectos → Actividades del trimestre → «Calificar» (`hoy.html?calificar=<producto>`). Su
    calificación lleva la fecha del día en que se captura; la actividad cuenta con la fecha de su
    sesión. Un alumno dado de alta el MISMO día que su grupo (el onboarding) no es "alta tarde"
    (`AlcanceHoy.fechaAlta`): recibe también las sueltas de días anteriores a su grupo.
  - **¿Para quién? al planear (2026-09-26):** en Crear proyecto, cada sesión lista los trabajos y
    tareas que materializa (`SesionesMaterializar.huecosDeSesion`/`emparejarPlan`) con su "para
    quién" y un diálogo compartido (`js/para-quien.js`). Los grados del producto los fija el plan;
    la elección se guarda como filas de `producto_sesion_alumnos` (`filasDeEdicion`) con
    `guardar_asignacion_producto` después de materializar. En un proyecto iniciado, un alumno con
    calificación sale bloqueado y la base rechaza quitarlo. Lo agregado en Hoy se cambia en Hoy.
  - **Incompleta → siguiente día de clase:** en actividades en clase, "Incompleta" guarda
    `estado_entrega='incompleto'`, `estado_en_clase='incompleta'` y `revisar_en` (siguiente día de
    clase). "Pendientes de la clase anterior" (Hoy) lista los de `revisar_en <= hoy`, uno por
    alumno: "Lo completó" (con nivel: `completada`, vale ese nivel) o "Sigue incompleta"
    (`sigue_incompleta`, 0.5, sale en Qué le falta); `completado_en` = día en que se revisó. Pasa
    una vez; si el alumno falta, sigue pendiente. Pendiente vale 0.5 (incompleto sin nivel). Las
    tres columnas van en la marca `captura_semaforo` de la cola sin señal. Tareas: estado "Por
    completar"; Inicio: conteo; Qué le falta: "se revisa el {fecha}".
  **Exámenes, "No presentó" y sin señal (b19, 2026-09-26):** por alumno y examen
  (`examen_alumnos.no_presento`): no cuenta ni a favor ni en contra (el motor lo salta aunque tenga
  algo capturado) y cuenta como listo para que el examen quede "Calificado"; capturar algo suyo
  quita la marca. Las capturas de un examen (letra tocada o escaneada, a mano, aciertos por campo,
  No presentó) van por la cola de la tablet (`js/bandeja-salida.js`, tipos `examen_respuesta`,
  `examen_resultado`, `examen_alumno`, cada uno con `_borrar` donde aplica) con marca `captura_id`
  por fila (trigger del servidor para cualquier otra escritura): se guardan sin señal, sobreviven
  a recargar y se envían solas; si otro aparato cambió la fila, se conserva lo suyo y se avisa.
  Crear o editar el examen y sus preguntas sí necesita señal. El lector del QR se precarga al
  abrir «Revisar». Varios exámenes del trimestre se suman (aciertos / preguntas por campo).
  **Cierre del día:** la primera excepción guarda el día de todo el grupo (1 y 1, sin los
  que faltaron); botón "Guardar el cierre de hoy" para días sin excepciones. Hoy e Inicio
  lo cuentan con `AlcanceHoy.resumenCierre`; si faltó todo el grupo, "Nadie asistió hoy".
  **Lecturas sin tope:** Supabase devuelve como máximo 1000 filas por consulta y corta en
  silencio. Toda lectura que pueda crecer con el trimestre va paginada: el motor y
  `js/reporte-datos.js` con su `todas()`, y Hoy, Tareas e Inicio con
  `AlcanceHoy.leerPorLotes` (lotes de 150 ids, páginas de 1000), y las demás pantallas
  (Reportes, Crear proyecto, Exámenes, Actividades) con `js/leer-todo.js`
  (`LeerTodo.paginas`; `porLotes` queda para listas largas de ids). La prueba `pruebas/lecturas-sin-tope.test.js` falla si
  aparece una lectura nueva sin tope; las acotadas por naturaleza (un día, una sesión, un
  alumno) están listadas ahí con su razón.
- **Registro histórico (spec de Jorge del 2026-09-26, §4; `supabase/mi_salon_b20_registro_historico_2026-09.sql`):**
  quien entra a mitad del trimestre se pone al día en una tarde con el asistente **"Ponte al día"**
  (`ponte-al-dia.html`, `js/ponte-al-dia.js`; reglas puras en `js/historico.js`). Se ofrece al crear
  el grupo si el trimestre ya empezó (el alta deja su avance en `ponte_al_dia`; Inicio lo ofrece
  para retomarlo mientras esté "en curso"; "Ya no mostrar" lo salta). Cuatro pasos, todos
  saltables: 1) alumnos, con **lista pegada** de Excel, Word o WhatsApp (`js/lista-pegada.js`,
  también en el alta: separa paterno, materno y nombre(s), detecta el grado y permite poner el
  mismo grado a varios); 2) **asistencia pasada** del inicio del trimestre a ayer con los días de
  clase del calendario SEP y los ajustes del grupo, "todos asistieron" y solo se tocan las faltas
  (mismo modelo que Asistencia); un día marcado **"Sin clase"** se guarda, con confirmación, como
  suspensión en el calendario del grupo (`calendario_ajustes`, tipo `suspension`, motivo "Sin clase
  (marcado en Ponte al día)", `Historico.filasSinClase`) ANTES que la asistencia, deja de contar como
  día de clase en Asistencia, Qué le falta y el Excel, y se quita desde Calendario (decisión de Jorge
  del 2026-09-26); 3) **actividades en bloque** como sueltas del trimestre
  (`agregar_actividades_historicas`, que usa `agregar_actividad_suelta`) y su semáforo en una
  cuadrícula alumno × actividad; exámenes por el camino de "Solo subir resultados"
  (`examen.html?nuevo=resultados&desde=ponte`); 4) **revisar la boleta** (motor y "cómo se calculó").
  **Calificación directa del trimestre** (`calificacion_directa`): por alumno y campo, en la escala
  de su grado (la base la valida con `piso_calificacion_boleta`; no cambia una boleta cerrada). El
  motor la pone en lugar de la calculada (`MotorCalificacion.aplicarDirectas`: sin porcentaje; el de
  las actividades queda aparte) y **cuenta YA como la calificación CONFIRMADA** de la boleta en ese
  campo (decisión de Jorge del 2026-09-26: el docente la eligió al capturarla; no se confirma otra
  vez). Lo hace la base (b20 §2b, triggers SECURITY INVOKER): al crearla o cambiarla,
  `boleta_trimestral` de ese alumno, ciclo, trimestre y campo queda con esa `calificacion`,
  `calificacion_confirmada = true` (sella `confirmada_en`), `porcentaje` null y el `nivel` de sus
  cortes; si el docente confirma otro número en Reportes, la directa lo toma (espejo); al borrarla
  ("Usar el cálculo automático" en Reportes → Boleta o "Automática" en el asistente), la boleta de
  ese campo deja de estar confirmada y vuelve a la propuesta calculada, que el docente confirma. Se
  cambia o se borra mientras la boleta no esté cerrada (cerrada: la base la rechaza y lo entregado no
  se mueve). Como Exportar, la junta y la boleta leen la confirmada de `boleta_trimestral`, la directa
  sale en todas (Exportar solo exporta confirmadas). Se rotula "Capturada directamente" (en el
  asistente, "capturada directamente · confirmada") en Reportes, reporte detallado (solo en
  pantalla), Qué le falta, Recrea/Concentrado y junta; la boleta imprimible no la lleva. Prueba en la
  base: `pruebas/sql/calificacion-directa.sql`.
  **es_historico**: una captura con fecha anterior al día (hora de México) en que se registra
  (`asistencias`, `calificaciones` con `capturado_en`; `productos_sesion` contra su creación),
  marcada por triggers. Con ella: "Incompleta" no pasa a la siguiente clase
  (`AlcanceHoy.cambiosIncompleta` con `historico`), Hoy, Inicio y Tareas no piden revisar tareas
  históricas (`AlcanceHoy.tareaPorRevisar`; Tareas las rotula "Registro histórico"), Hoy no abre
  para calificar lo del asistente (`desde_ponte_al_dia`), Qué le falta solo cuenta lo registrado
  (sin captura, lo histórico o anterior al alta del grupo no se pide), los cumpleaños de Inicio
  siguen siendo de hoy en adelante, la asistencia no genera avisos ni incidencias (no hay nada que
  los genere) y la boleta impresa no muestra la marca. La cola sin señal (`js/bandeja-salida.js`)
  manda `capturado_en` (la hora del aparato) en cada fila NUEVA de asistencia: la lista de Hoy que
  sale al día siguiente no queda como histórica; al editar una fila existente no se manda (la base
  conserva la suya) y las marcas por campo no cambian. En calificaciones ya iba (`evaluado_en`).
  "Ponte al día" también se ofrece al crear un grupo ADICIONAL con el trimestre empezado
  (`onboarding.html?nuevo=1`: el grupo nuevo queda activo y abre el asistente).
- **Campo sin evidencias:** sin propuesta; en la boleta se elige a mano (juicio docente)
  para poder confirmar y cerrar. Boleta cerrada: todo de solo lectura (ver arriba).
- **Evidencia por PDA** (`recalcular_evidencia_pda`): con todas las calificaciones del
  alumno ligadas a ese PDA en la sesión; manda el trabajo (la más baja si hay varias), la
  tarea solo si no hay otra; lo del maestro no se toca.
- **Diagnóstico:** la pantalla abre en el trimestre actual ("T1 · boleta"), el que lee la
  boleta.

Niveles internos de reporte (no oficiales): `≥80 logrado`, `60–79 en_proceso`,
`<60 requiere_apoyo`.

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

### Grupos de trabajo por nivel (2026-09-27, PP-NIVELES de Fanny)
Cuando el grupo trabaja por niveles que no son grados (lectoescritura: Morado, Naranja, Azul;
matemáticas: Círculos, Triángulos, Cuadrados), los niveles sirven SOLO para asignar a cada alumno
lo que la docente revisa: la lista, la asistencia y la boleta siguen por grado.
- **Texto de la sesión:** `*_actividades.diferenciado` (y `*_diferenciado`) aceptan, además de
  las llaves de grado (`"1"` a `"6"`), llaves de **grupo de trabajo** (`"Morado"`, `"Círculos"`,
  `"Morado y Naranja"`). Con `mode: "todos"` pueden convivir los pasos de todo el grupo (`todos`) y
  los de cada grupo (`diferenciado`): `{ "mode": "todos", "todos": [...], "diferenciado":
  { "Morado": [...], "Azul": [...] }, "orden_grupos": ["Morado", "Naranja", "Azul"] }`.
  `orden_grupos` (opcional) guarda el orden, porque jsonb no conserva el de las llaves.
- **Cómo se lee** (`js/texto-sesion.js`, lo usan Inicio, Actividades y Crear proyecto): llave de
  grado → "Grado 1:" (texto de la fase) o "1°:" (pasos y tareas); llave de grupo → tal cual
  ("Morado: …"); primero los pasos de todo el grupo, luego los grados en orden y luego los grupos
  en el orden de `orden_grupos` (sin él, alfabético). Crear proyecto los muestra en el recuadro
  "Por grupo de trabajo" y los guarda igual (antes se perdían al guardar).
- **Orden de la clase = orden de la planeación** (Jorge, 2026-09-27: "respeta siempre el orden de la
  planeación, está estructurada por horarios"). Los pasos por grupo de arriba se leen DESPUÉS de los
  de todo el grupo, así que sacar un paso de `todos` lo cambia de lugar (en PP-NIVELES, "Grupo Azul:
  …" salía después de "Cierre del bloque" y de la "Actividad de reserva"). Por eso PP-NIVELES NO
  mueve pasos: se quedan en `*_todos`, en su lugar y con su redacción ("Grupo Azul: además de su
  tarjeta…", "Grupos Morado y Naranja, al regresar a su lugar: …"); el plan de carga ya no trae
  `texto.*` y el script comprueba que cada fase quede igual que en la dosificación. Las llaves de grupo
  siguen valiendo para otro proyecto que las traiga en `*_diferenciado`. Las sesiones de un día se
  trabajan en el orden del horario (Letras, Números, Nuestro salón): Inicio y Hoy ofrecen siempre la
  sesión pendiente siguiente por número (si el lunes no se trabajó la 3, el martes sigue con la 3).
- **Horario de la planeación:** va en `sesiones.duracion` ("Lunes 28 sep · 8:00 a 9:20 · Letras"; se
  ve en Actividades y en Crear proyecto). Nunca en `fecha`: `fecha` marca la sesión como trabajada.
- **Tareas** (`cierre_tareas`): van **por grado** (las únicas que el materializador convierte en
  productos); con el cierre "igual para todos" se eligen "Tareas iguales para todos" o "Tareas por
  grado" (antes, guardar un proyecto con cierre común y tareas por grado las borraba).
- **Productos:** un trabajo por grupo, con nombre que lo dice ("… · Naranja") y "¿Para quién?"
  alumno por alumno (`producto_sesion_alumnos`). **El alumno se evalúa siempre con los PDA de su
  grado; un trabajo por nivel que incluye alumnos de otro grado se liga también a los PDA de ese
  grado** (decisión de Jorge del 2026-09-27; la evidencia la deja la regla de b5: solo en los PDA
  ligados al producto que son del grado del alumno). Las actividades por nivel no cambian: las manda
  la planeación. En PP-NIVELES, el alumno de 2° que trabaja con los de 1° en Morado (Lenguajes, Ética
  y De lo Humano) y en Triángulos (Saberes) deja su evidencia en los PDA de 2°: esos trabajos van
  ligados a los PDA de 1° y de 2°; el trabajo de 2° de Ética y De lo Humano (sesiones 3, 6, 12 y 15)
  es solo de Azul. La lista de cotejo por nivel (anexo S15-02) queda como registro del docente en
  papel. `scripts/cargar-pp-niveles.js` no carga un plan en que algún alumno reciba en una sesión un
  trabajo sin PDA de su grado. En Hoy, la nota "Trabaja con 1°" sale de los grados de los PDA ligados
  al producto (`AlcanceHoy.trabajaCon`; sin ellos, de los grados del producto): con PDA de su grado no
  hay nota. Se cargan con `scripts/cargar-pp-niveles.js` desde un plan en JSON
  (con nombres de alumnos: vive en `docs/referencia/`, fuera de git); la tabla legible de PP-NIVELES
  está en `docs/referencia/pp-niveles-asignacion.md`.
- **Crear proyecto guarda solo lo que la docente cambió** (R30, 2026-09-27): al abrir, cada sesión
  guarda la fila que armó la pantalla (`block._alAbrir`); al guardar se escriben solo las columnas
  distintas de esa (`ProyectoEdicion.cambiosDeSesion`), también el modo de una sección sin pasos. Un
  texto nunca se guarda como "[object Object]" (`seccionAlAbrir`, `textoDeCampo`). Un grado con 2 o
  más PDA en una sesión (proyectos de la tienda) se muestra "N PDA de 1°" de solo lectura y se conserva
  completo (`pdaSesionConservando`).

---

## 5. Stack técnico

- **Frontend:** HTML5 + Tailwind CSS (vía CDN) + **Vanilla JavaScript**. App multipágina
  (cada feature es un `.html` + su `js/*.js`). Sin framework SPA, sin bundler, sin npm.
- **Backend / BD / Auth:** **Supabase** (PostgreSQL). Auth por JWT en localStorage.
- **Seguridad:** Row-Level Security (RLS) en todas las tablas — `auth.uid() = maestro_id`,
  cada maestro solo ve sus datos (multi-tenant).
- **Despliegue:** GitHub → Cloudflare Pages (CI/CD). Entorno local: VS Code Live Server.
- **App instalable "Jissez MS" (PWA de Mi Salón, 2026-09-25):** `/salon/` es una ruta virtual
  (`_redirects`) que sirve los mismos archivos de la raíz; la app instalada vive ahí
  (`salon.webmanifest`: `scope: /salon/`, `start_url: /salon/hoy?origen=app`, `id: /mi-salon`).
  El service worker (`sw.js`, registrado como `/salon/sw.js` solo desde páginas bajo `/salon/`)
  solo da la página "Sin conexión" (`sin-conexion.html`); no guarda páginas ni datos de
  Supabase. Las páginas de la raíz siguen igual, sin service worker. Detalle y cómo probarlo:
  `docs/PWA-MI-SALON.md` §9.

### 5.1 Cómo se prueba (QA)

- **Cuenta de maestro de QA:** `qa.misalon@jissez.com` (perfil con `activo_saas`), con dos
  grupos multigrado: "QA 1°-2° (Fase 3)" y "QA 3°-4° (Fase 4)", ciclo 2026-2027, 4 alumnos
  por grado con perfiles a propósito (sobresaliente, en riesgo, irregular con
  justificados, PPM bajo; todos con prefijo "QA"). Trimestre 1 con datos; trimestre 2
  vacío a propósito.
- **Segunda cuenta:** `qa.aislamiento@jissez.com`, con un grupo "QA Aislamiento (vacío)",
  para probar que un maestro no ve datos de otro. Los ensayos de punta a punta (3.10) crean
  ahí alumnos y proyectos de prueba y los borran al terminar; `qa.resembrar()` no la toca.
- Las contraseñas **no** están en el repo: viven en `.env.local` (ignorado por git:
  `QA_EMAIL`, `QA_PASSWORD`, `QA2_EMAIL`, `QA2_PASSWORD`).
- **Semilla:** `select qa.resembrar();` (función en el esquema `qa`, no expuesto por el API;
  solo la ejecuta `postgres`) borra y recrea **solo** los datos de la cuenta QA. Código en
  `supabase/qa_semilla.sql`. Nunca toca maestros reales.
- **Herramientas locales** en `.qa/` (ignorado por git): `servidor.js` (estático en
  `127.0.0.1:5500`, no entrega archivos ocultos; emula `/salon/` leyendo `_redirects` como
  Cloudflare), `navegador.js` (Playwright con inicio de
  sesión real; `abrir({ cuenta: 2 })` para la segunda cuenta), `humo.js` (recorre todas las
  pantallas con los dos grupos), `aislamiento.js`, `verificar-*.js` y las carpetas de los
  revisores con sus scripts y evidencias.
- Pruebas automáticas: ver §3.

---

## 6. Modelo de datos (Supabase) — verificado contra el esquema real

### 6.1 Mundo SaaS (datos del maestro, en runtime)

| Tabla | Columnas clave |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `escuela`, `tipo_organizacion`, `grados` (array), `es_multigrado` (bool), `ciclo_escolar`, `descripcion`, `trimestre_actual` (lo usan el alcance de "Hoy", el diagnóstico y la semilla de QA), `director_nombre` (B13, opcional). `escuela` y `director_nombre` son **por grupo** (una maestra puede tener grupos en escuelas distintas); se editan en Mi grupo y van en el encabezado y la firma de las incidencias. Sin CCT por grupo (solo `perfiles.cct`) |
| `alumnos` | `maestro_id`, `grupo_id`, `num_lista` (int), `nombre_completo` (MAYÚSCULAS con acentos y Ñ desde 2026-09-26, `js/nombres-alumno.js`; lo guardado antes no se toca; el alta guarda un borrador en el aparato, `js/alta-borrador.js`), `grado` (smallint 1–6, **NOT NULL**), `estatus` (`activo`, en minúsculas: así escribe y filtra todo el código). **Ficha opcional (B13, sin CURP):** `fecha_nacimiento` (date; la pantalla pide 4 a 16 años), `genero` (`nina`/`nino`/`prefiero_no_decir`, null = sin dato), `tutor_nombre`, `tutor_telefono` (10 dígitos de México sin +52; WhatsApp = `wa.me/52` + el número). Reglas en `js/ficha-alumno.js`; se edita en Mi grupo, no en el onboarding |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, **`asistencia_estado`** (text: `presente`/`ausente`/`justificada`) |
| `proyectos` | `maestro_id`, `grupo_id`, `trimestre` (1/2/3), `titulo`, `grados` (array), `fase` (array), `metodologia`, `escenario`, `proposito`, `pregunta_generadora`, `campos_formativos` (array), `ejes_articuladores` (array), `es_multigrado` (bool), `contenidos_pda` (jsonb), `estado` (`borrador`/`activo`/`completado`/`pausado`), `visible_mercado` (bool), `fecha_inicial`, `fecha_final`, **`tipo`** (b17: `proyecto` = planeación normal; `sueltas` = contenedor "Actividades del trimestre" de las actividades sueltas, uno por grupo y trimestre, índice único parcial; NOT NULL DEFAULT `proyecto`) |
| `sesiones` | `proyecto_id`, `maestro_id`, `numero_sesion`, `duracion` (text, ej. `"90 min"`), `fecha`, `campo_formativo`, `momento`, `inicio_todos`/`desarrollo_todos`/`cierre_todos` (text), `inicio_actividades`/`desarrollo_actividades`/`cierre_actividades`/`cierre_tareas` (jsonb), `inicio_diferenciado`/`desarrollo_diferenciado`/`cierre_diferenciado` (jsonb), `pda_sesion` (jsonb), `recursos` (jsonb), `criterios_evaluacion`, `estado_sesion` (`pendiente`/`activa`/`completada`/`recorrida`), `notas_cierre`, `observaciones` |
| `tareas` | **En desuso (0 filas; nadie la escribe desde 2026-09-23).** Las tareas son `productos_sesion` tipo `tarea`: se revisan en "Hoy" y `tareas.html` las sigue desde ahí. Columnas: `sesion_id`, `proyecto_id`, `grupo_id`, `maestro_id`, `descripcion`, `grado`, `fecha_asignada`, `fecha_revision`, `revisada` |
| `calificaciones` | `alumno_id`, `maestro_id`, `sesion_id`, `proyecto_id`, `grupo_id`, `tipo` (mismo vocabulario que `productos_sesion.tipo` — `tarea`/`trabajo`/`producto_final`/`examen`/`otro` — más `participacion`/`conducta` legacy y `actividad` legacy sin escritores; **con `producto_sesion_id` el trigger `calificaciones_tipo_desde_producto` copia el tipo del producto**), `descripcion`, `calificacion` (numeric 5–10), `entrego` (bool), `fecha`, `grado`, `campo_formativo` (nombre largo). **Nuevo grano (2026-09):** `producto_sesion_id` (FK a `productos_sesion`), `estado_entrega` (`entregado`/`incompleto`/`no_entregado`/`justificado`/`no_aplica`), `nivel` (semáforo), `puntaje` (0–10), `retroalimentacion` (visible a padres), `nota_privada`, `evaluado_en`; índice único parcial `(maestro_id, alumno_id, producto_sesion_id)`. Los tipos `participacion`/`conducta` ya **no se escriben** aquí (ver `registro_diario`). **Integridad (b19a):** el trigger `calificaciones_desde_producto` rechaza escribir en un producto quitado (`activo` false; P0001, hint `producto_inactivo`, que la cola de Hoy trata como definitivo) y copia siempre `sesion_id` y `proyecto_id` del producto; las políticas restrictivas `calificaciones_mismo_grupo_*` exigen que alumno, producto y `grupo_id` sean del mismo grupo |
| `evaluacion_formativa` | `maestro_id`, `sesion_id`, `alumno_id`, `criterio` (texto), **`origen`** (`automatico` = la dejó el trigger al calificar un producto · `maestro` = la ajustó a mano; el trigger nunca pisa las del maestro), **`sesion_pda_id`** (FK a `sesiones_pda` — obligatorio de facto en filas nuevas: la pantalla lo resuelve siempre, con backfill perezoso para sesiones viejas), `semaforo` (`logrado`/`en_proceso`/`requiere_apoyo`), `observacion`, `fecha`. La evidencia va solo a los PDA ligados al producto que son del grado del alumno (b5): el alumno se evalúa siempre con los PDA de su grado; un trabajo por nivel que incluye alumnos de otro grado se liga también a los PDA de ese grado (decisión de Jorge del 2026-09-27) |
| `sesiones_pda` | `sesion_id` (FK `sesiones`, CASCADE), `pda_id` (FK `catalogo_pda`, **nullable** desde B.5 — antes era NOT NULL y un criterio libre reventaba la materialización), `grado` (1–6), `criterio_aplicado`, UNIQUE `(sesion_id, pda_id, grado)` y, para el criterio libre, UNIQUE `(sesion_id, grado, criterio_aplicado)` cuando `pda_id IS NULL`. Espejo estructurado del jsonb `pda_sesion`; lo materializan `js/sesiones-materializar.js` (importador y crear_proyecto) y el backfill perezoso de `evaluacion_formativa.js` |
| `productos_sesion` | Lo calificable de cada sesión: `sesion_id`, `maestro_id`, `tipo` (`trabajo`/`tarea`/`producto_final`/`examen`/`otro`), `nombre`, `descripcion`, `grados` (text[], SIEMPRE orden ascendente), `modalidad` (`compartida`/`diferenciada`), `campo` (**código corto** `LEN`/`SAB`/`ETI`/`DHL`), `orden`, `activo` (false = no cuenta en máximos), `origen` (`importado`/`backfill`/`maestro`/`bot` — `backfill` = producto genérico pendiente de enriquecer con el nombre real), `fecha_entrega` (tareas). `sesion_id` solo cambia con `mover_producto_a_sesion` ("Pasar a un proyecto", trigger `productos_sesion_sesion_fija`, b19a); un producto con calificaciones no se quita (b17) |
| `producto_sesion_pda` | N:M `productos_sesion` ↔ `sesiones_pda` (un producto evalúa 1..n PDA del mismo grado) |
| `producto_sesion_alumnos` | Para quién es un producto además de sus grados (b17, 2026-09-26): `producto_sesion_id` (cascada), `alumno_id` (cascada), `maestro_id`, `modo` (`incluir`/`excluir`), UNIQUE `(producto_sesion_id, alumno_id)`. RLS: propios y del mismo grupo (`ref_asignacion_mismo_grupo`). Regla única en §3 (fase 2). **También nuevas en b17:** `proyectos.tipo` (`proyecto`/`sueltas`, NOT NULL DEFAULT `proyecto`; índice único del contenedor por grupo y trimestre) y `calificaciones.revisar_en`, `estado_en_clase` (`incompleta`/`completada`/`sigue_incompleta`), `completado_en` |
| `registro_diario` | Participación y conducta **una vez al día por alumno**, global (no por sesión ni campo): `maestro_id`, `alumno_id`, `fecha`, `participacion` (0–2), `conducta` (0–2), `nota`, UNIQUE `(maestro_id, alumno_id, fecha)`. Se captura en el cierre del día de "Hoy" (valor normal 1); el motor lo reparte entre los campos con sesión ese día (`docs/PRODUCTO-MI-SALON.md` §B.4) |
| `boleta_trimestral` | Boleta por campo formativo: `maestro_id`, `alumno_id`, `ciclo`, `trimestre` (1–3), `campo` (`LEN`/`SAB`/`ETI`/`DHL`/**`GEN`** = fila general), `porcentaje` (0–100), `calificacion` (5–10), `nivel`, `fortalezas`, `areas_oportunidad`, `sugerencias`, `texto_autogenerado` (jsonb: la propuesta de la Capa 1 + `editados` [cuadros que escribió el maestro] + `ia` [redacción de la Capa 2] + `visible` [`reglas`/`ia`]), `editado_manual` (true = el maestro escribió algo en esa fila), `calificacion_confirmada` + `confirmada_en` (la calificación oficial es solo la confirmada), `cerrada` (true = no se recalcula; exige confirmación), UNIQUE `(maestro_id, alumno_id, ciclo, trimestre, campo)`. La boleta de `reportes.js` lee/escribe aquí (autosave on-blur). `calificacion` sale de `calcular_calificacion_boleta` y el trigger `boleta_trimestral_piso_fase` rechaza valores bajo el piso del grado (1° 6; 2° a 6° 5; ver §3) |
| `perfiles` | `id` (= `auth.users.id`), `nombre_completo`, `escuela`, `cct`, `zona`, **`estado`** (text: la entidad federativa de la maestra, con el nombre de `js/entidades.js`; decisión 21), `municipio`, `sexo_docente`, `grados_asignados`, `activo_saas` (acceso a Mi salón). RLS: cada quien la suya |
| `plantillas_sugerencia` | Catálogo global de sugerencias para padres (Capa 1): `clave` PK (`tareas`, `trabajos`, `calidad`, `participacion`, `conducta`, `examen`, `lectura_ppm`, `comprension`, `matematicas` con `{habilidades}`, `cuaderno`, `asistencia`, `pda_mejora`, `pda_apoyo`), `texto`, `descripcion`, `activo`. Lectura para `authenticated`; escritura solo `es_admin()`. Sin pantalla de edición todavía |
| `maestro_ajustes` | PK `maestro_id`; ponderación `peso_tareas`/`peso_trabajos`/`peso_participacion`/`peso_examen`, NOT NULL, DEFAULT 28/28/6/33, CHECK `pesos_con_valor` (los cuatro suman más de 0; `NOT VALID`, desde b10). `peso_conducta` se conserva con DEFAULT 0 pero **no se usa**: la conducta no pondera (LGE art. 21; ver §3). **Sin peso de asistencia** (Acuerdo 10/09/23 art. 7). Onboarding crea la fila solo con `maestro_id` y la BD pone los defaults |
| `examenes` / `respuestas_examen` / `banco_preguntas` | **Modelo anterior (catálogo).** Desde el 2026-09-26 los exámenes del catálogo se venden en la tienda y **no se ofrecen en Mi Salón** (decisión de Jorge): la pantalla ya no lista plantillas ni las aplica; lo ya aplicado se abre en `examen.html?examen_id=` (`js/examen-anterior.js`) y el motor lo sigue leyendo. Las plantillas (`maestro_id` null) son solo legibles: b18a quitó "reclamar" (UPDATE solo de lo propio). **Limitación:** `banco_preguntas` no guarda cuánto vale cada pregunta; el máximo por campo se **aproxima** como `valor_total / total_preguntas` y así se rotula (solo cuando entra este modelo) |
| `examen_alumnos` | "No presentó" (b19): `examen_id` (cascada), `alumno_id` (cascada), `maestro_id`, `no_presento` bool, `captura_id` (marca de la cola), UNIQUE `(examen_id, alumno_id)`; RLS propios y del mismo grupo que el examen. b19 agrega también `captura_id` a `examen_respuestas` y `examen_resultados` |
| `examenes_grupo` / `examen_preguntas` / `examen_resultados` / `examen_respuestas` | **Exámenes de Mi Salón (b18, 2026-09-26).** `examenes_grupo`: `grupo_id`, `titulo`, `modo` (`resultados` = solo subir aciertos por campo; `propio` = preguntas creadas aquí), `trimestre`, `grados` smallint[] (los que lo presentan; todas las preguntas son para todos ellos), `fecha_aplicacion`, `instrucciones`, `campos_resultados` jsonb (`{"LEN": 10}`). `examen_resultados`: alumno × campo con `preguntas` y `aciertos` (CHECK 0 ≤ aciertos ≤ preguntas). `examen_preguntas`: `tipo` (`opcion_multiple` 2-5 opciones y clave A-E / `verdadero_falso` clave V-F / `completar` clave = respuesta esperada opcional / `abierta`), `campo` (código corto), `orden`. `examen_respuestas`: alumno × pregunta; automáticas `respuesta` A-E/V/F, `*` doble marca, null vacía; a mano `resultado` correcta/parcial/incorrecta; `origen` toque/escaneo/manual. RLS por `maestro_id` y referencias propias del MISMO grupo en las políticas; un examen no cambia de grupo ni de modo (trigger). b19a: una respuesta va al examen de su pregunta y ese examen es `propio` (`examen_respuestas_mismo_examen_*`), y ni una pregunta ni una respuesta cambian de examen (trigger `examen_hijo_examen_fijo`). Cálculo exacto en el motor: aciertos / preguntas por campo, solo lo capturado |
| `interes_secciones` | "Avísame" de las secciones que aún no abren (`jissez_interes_secciones`, 2026-09-26): `usuario_id`, `seccion` (`sala` = Sala de Maestros; `mi_salon` = Mi Salón mientras no tenga precio), `created_at`; UNIQUE `(usuario_id, seccion)`. RLS: cada cuenta inserta, ve y borra lo suyo; nadie actualiza; anon sin permisos. Páginas `tienda/conoce-sala.html` y `tienda/conoce-mi-salon.html` (`tienda/js/interes-seccion.js`); Jorge lee la lista en el editor SQL; `delete_own_account` la borra |
| `evaluacion_diagnostica` | **Fuente única de cuaderno y habilidades básicas.** `maestro_id`, `alumno_id`, `grupo_id`, `momento` (`inicio_ciclo`/`trimestre_1`/`trimestre_2`/`trimestre_3`), `cuaderno` y `matematicas` (jsonb `[{clave, nivel}]`, claves estables de `js/catalogo-habilidades.js`, nivel `logrado`/`en_proceso`/`requiere_apoyo`; un CHECK valida prefijo y nivel), `lectura_ppm`, `lectura_comprension`, `observaciones`, UNIQUE `(maestro_id, alumno_id, momento)`. La fluidez lectora no se guarda: se deriva de `lectura_ppm` + `bandas_ppm` |
| `incidencias` / `incidencia_alumnos` | Registro de sucesos del salón **por grupo** (B13): `maestro_id`, `grupo_id` (CASCADE: borrar el grupo borra sus incidencias), `asunto`, `fecha`, `hora` (opcional), `descripcion`, `acuerdos` (opcional). La puente `incidencia_alumnos` (`incidencia_id`, `alumno_id`, `maestro_id`) guarda los involucrados; borrar un alumno lo quita de sus incidencias (CASCADE en la puente) y la incidencia se conserva. RLS `auth.uid() = maestro_id`; insert/update exigen grupo propio y la puente exige alumno del mismo grupo. Se guarda con `guardar_incidencia()` (security invoker, una transacción). **Folio** (b23, decisión de Jorge del 2026-09-26): `incidencias.folio` = `RDI-<ciclo del grupo>-0001` (Reporte De Incidencia; consecutivo de 4 dígitos por grupo y ciclo), lo pone el servidor al crear (trigger `incidencias_folio` con el contador `incidencias_folios`, bloqueado por fila; índice único `(grupo_id, folio)`); un folio borrado no se reutiliza y no se edita; sale en la lista, en cada hoja impresa (resumen y los dos tantos de cada familia), en el pie de impresión y en el Excel. Pantalla `incidencias.html` (documento imprimible con firmas); hoja «Incidencias» del Excel de Exportar; `delete_own_account` las borra. Migración `supabase/mi_salon_b13_ficha_incidencias_2026-09.sql` |
| `bandas_ppm` | Catálogo de fluidez lectora por grado, tomado de los Estándares Nacionales de Habilidad Lectora de 2010 (Acuerdo 592, **abrogado**): ya no son estándar vigente, así que la interfaz los rotula **"referencia SEP 2010"** ("Referencia SEP 2010 para 2°: 60 a 84 ppm"; niveles "Requiere apoyo", "Cercano a la referencia", "En la referencia", "Avanzado"). `grado` PK, `requiere_apoyo_max`, `cercano_max`, `estandar_max` (avanzado = mayor); las bandas no cambian. Lectura para `authenticated`. La regla de clasificación y el rótulo viven en `CatalogoHabilidades.clasificarPPM` y `textoReferenciaPPM` |
| `calendario_ajustes` | Días que la maestra cambia del calendario oficial SEP para UN grupo (b14, 2026-09-25): `maestro_id`, `grupo_id` (cascada), `fecha`, `tipo` (`suspension`/`festividad_local`/`otro` = sin clase; `con_clase` = sí hay clase aunque el oficial diga que no, LGE art. 87), `motivo` (≤ 140). UNIQUE `(grupo_id, fecha)`. El calendario oficial NO está en la base: vive en `js/calendario-sep.js` (`CICLOS`; un ciclo nuevo es solo datos). La tabla vieja `dias_no_habiles_extra` (por maestro, sin grupo) sigue sin uso |
| `roles_aseo` | Rol de aseo de un grupo en un mes (b14): `grupo_id`, `mes` (primer día), `por_dia` (1-5), `inicia_alumno_id`, `continua`, `siguiente_alumno_id` + `siguiente_num_lista` (con quién sigue el mes siguiente), `asignacion` (jsonb `[{fecha, alumnos:[id]}]` con los cambios a mano). UNIQUE `(grupo_id, mes)`. Reglas en `js/rol-aseo.js` |
| `calificacion_directa` | Registro histórico (b20): calificación del trimestre capturada directamente por alumno y campo: `maestro_id`, `grupo_id`, `alumno_id`, `ciclo`, `trimestre`, `campo` (código corto), `calificacion` (5-10 y la escala del grado), `es_historico` (siempre true), `capturado_en`; UNIQUE `(maestro_id, alumno_id, ciclo, trimestre, campo)`. Propuesta que el motor usa en lugar de la calculada (§3). RLS: propias, grupo propio y alumno de ese grupo. También en b20: `asistencias` y `calificaciones` con `capturado_en` y `es_historico`; `productos_sesion` con `es_historico` y `desde_ponte_al_dia`; `ponte_al_dia` (avance del asistente por grupo: `estado` en_curso/saltado/terminado, `paso`, `pasos_hechos`, `terminado_en`) |
| `listas_grupo` / `listas_columnas` / `listas_valores` | Listas de cooperación y materiales **por grupo** (b15, 2026-09-26): la lista (`nombre` ≤ 80, `fecha`, `descripcion` ≤ 300, `estado` `abierta`/`cerrada`, `activos_al_cerrar`), sus columnas (`tipo` `palomita`/`texto`/`monto`, `monto_esperado` opcional solo en monto) y un valor por columna y alumno (`entregado`, `texto` ≤ 80 o `monto` numeric(9,2) de 0 a 999,999.99; UNIQUE `(columna_id, alumno_id)`). Cerrada = expediente de solo lectura (trigger + RLS; no se borra). Cascada: grupo → listas → columnas → valores; borrar un alumno borra sus valores; darlo de baja los conserva. RLS `auth.uid() = maestro_id` con grupo, lista abierta, columna y alumno del mismo grupo propios. Reglas y resumen (sumas en centavos) en `js/listas.js`; imagen y texto para familias SIN nombres. Hoja «Listas» del Excel; `delete_own_account` las borra. Migración `supabase/mi_salon_b15_listas_2026-09.sql` |

> **Convención de campos formativos:** las tablas históricas (`calificaciones`,
> `dosificacion_*`, `banco_preguntas`) guardan el nombre largo (`"Lenguajes"`, …); las
> tablas nuevas (`productos_sesion`, `boleta_trimestral`) guardan el código corto
> (`LEN`/`SAB`/`ETI`/`DHL`; el alias histórico `HUM` = `DHL`). La equivalencia vive en un
> lugar en el frontend: `js/campos-formativos.js`, y se aplica **al escribir** (importador,
> crear_proyecto, reportes), nunca al leer. En SQL la repite `campo_largo()` (b17), que usa
> `agregar_actividad_suelta` para escribir el nombre largo en
> `sesiones.campo_formativo`; las dos deben ir iguales. Un quinto campo se agregaría en los dos
> y aquí.

> **Catálogo de cuaderno y habilidades:** `js/catalogo-habilidades.js` es el único lugar
> con las claves (`cuaderno.*`, `mates.*`) y sus etiquetas, mismo patrón que
> `campos-formativos.js`. No hay tabla de catálogo: las tablas `catalogo_habilidades` /
> `evaluacion_habilidades` que proponía `PRODUCTO-MI-SALON.md` §B.6 quedaron canceladas
> (2026-09-22).

> **Trimestre de una sesión:** `proyectos.trimestre` es la fuente única de a qué
> trimestre (y por tanto a qué boleta) pertenece una sesión. Lo escriben el importador
> (copia `dosificacion_proyectos.trimestre`) y `crear_proyecto.js` (selector obligatorio
> en el paso 1, precargado con `grupos.trimestre_actual` del grupo destino; desde
> 2026-09-22). Al editar un proyecto sin trimestre se propone el actual del grupo y se
> guarda. Sin backfill: `proyectos` tenía 0 filas al hacer el cambio.

> **Simplificación deliberada (Parte A, 2026-09):** calificar el producto final del
> proyecto usa el mismo grano que todo lo demás (`productos_sesion` tipo
> `producto_final` + una fila en `calificaciones` con nivel/puntaje **global**). El
> desglose criterio por criterio contra los pesos de
> `productos_finales.criterios_evaluacion` NO está soportado todavía: es una extensión
> de Parte B a diseñar cuando haya un caso real, no un olvido.

> Nota: `proyectos` conserva columnas legacy (`nombre`, `campo_formativo`) junto a las
> actuales (`titulo`, `campos_formativos`); el frontend usa las actuales. Al cerrar una
> sesión ya **no** se escribe la tabla `tareas` (en desuso). Al importar o guardar un proyecto, `js/sesiones-materializar.js`
> crea por cada sesión sus `sesiones_pda` y sus `productos_sesion` (un trabajo genérico por
> grado con `origen='backfill'` + las tareas reales de `cierre_tareas`). **Reglas del
> 2026-09-26:** cada grado del proyecto tiene su trabajo en cada sesión aunque no tenga PDA
> elegido (antes los grados salían solo de los PDA); una sesión sin campo toma el del proyecto
> si es uno solo y, si no, no se guarda (antes quedaba como LEN); la materialización es
> idempotente (reintentar o reeditar no duplica) y en una reedición solo borra lo que se
> quitó del plan, nunca un producto con calificaciones, un PDA con evaluación formativa ni lo
> agregado en Hoy.

> **Proyecto iniciado editable (2026-09-26, `js/proyecto-edicion.js`):** en Crear proyecto se
> agregan sesiones y se corrigen las no trabajadas; guardar corrige cada sesión en su lugar
> (ya no las borra y recrea). Una sesión **trabajada** = con fecha o con calificaciones
> ("Iniciar" solo la marca `activa` y no la vuelve trabajada): se corrige su texto (inicio,
> desarrollo, cierre, actividades, recursos, observaciones, duración, secuencia) y quedan fijos
> su campo, sus PDA y criterios, el modo del cierre y sus tareas; no se elimina. Con sesiones
> trabajadas no cambian el trimestre ni los grados del proyecto y sus campos no se quitan.
> Se vuelve a revisar al guardar (si otra pestaña empezó una sesión, no se guarda nada). Un
> proyecto nuevo se guarda sin huérfanos: si falla tras insertar el proyecto, se borra; si no
> se pudo borrar, el reintento lo reutiliza. Paso 1: grados y campos obligatorios. El
> catálogo del paso 2 se vuelve a leer si cambian fases o grados. Clonar copia las sesiones
> (sin fecha, pendientes, sin calificaciones) y las materializa. Escenario con los nombres del
> SaaS (Aula · Escuela · Comunidad; se lee también Escolar/Comunitario) y secuencia con los
> momentos oficiales de `ltg_metodologias_estructuras` (se leen también los nombres viejos
> de la pantalla, "1. Identificamos"…).

> **Tablas deprecadas (renombradas `zz_deprecated_*`, 2026-09, todas con 0 filas):**
> `calificacion_tarea`, `calificacion_trabajo`, `diagnosticos`, `configuracion_calificacion`
> (el código usa `maestro_ajustes`), `registros_diarios` (genérica, sin uso),
> `participacion_jornada` (reemplazada por `registro_diario`), `entregas_producto_final`
> (el producto final se califica vía `productos_sesion`), y desde el 2026-09-22
> `evaluacion_cuaderno` y `evaluacion_habilidades_basicas` (iban por semestre, sin código
> que las usara; las reemplaza `evaluacion_diagnostica`). Migraciones B.0 en
> `supabase/mi_salon_b0_2026-09.sql`.

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
  `pdf` · `editable` (Word, paquetes) · `anexos` (con anexos, proyecto individual).
  `ordenes.terminos_aceptados_en` sella la aceptación legal del checkout.
- `marketplace_accesos` — una fila por (usuario, producto, `tipo`) con `tipo` ∈
  `pdf`/`editable`/`anexos`. Regla única en `_shared/pagos.ts::tiposDeAcceso` y su espejo SQL
  `_accesos_por_tipo`: paquete `pdf`→pdf+anexos, `editable`→editable+pdf+anexos;
  proyecto `pdf`→pdf+editable (Word siempre), `anexos`→pdf+editable+anexos. La fila
  `editable` habilita los .docx (`puedeEntregarArchivo`); la fila `anexos` habilita las
  subcarpetas (`puedeEntregarRuta`), que en paquetes van siempre.
- `marketplace_precios`, `marketplace_promocion`, `marketplace_cupones` — tarifario de
  paquetes, promoción porcentual y cupones. Los proyectos individuales no están en el tarifario:
  su precio vive en la fila y se edita en el admin; la promoción y los cupones se aplican
  encima igual que a los paquetes. Cadena de descuentos (autoridad única:
  `marketplace_cupon_evaluar`, hoy en `supabase/marketplace_cupon_acumulable.sql`):
  **lista → oferta general del ámbito → cupón sobre ese precio**. La oferta tiene ámbitos
  (`aplica_paquetes` / `aplica_proyectos` / `aplica_personalizados`); el cupón aplica siempre
  en los tres, así que un cupón válido siempre consume uso y genera comisión.
- Admin: `es_admin()` (cuenta `soporte.jissez@gmail.com`) es la única fuente del rol. Los
  IDs de Drive (`*_drive_id`, `pedidos.drive_folder_id`) no son legibles desde el navegador:
  el permiso de tabla se sustituyó por columnas explícitas (`marketplace_personalizados.sql` §8).
- Links de anexo impresos por el bot: `anexo.html?aula=<grado|combo>&pr=<1-12>&a=<código>`;
  la Edge Function `anexo` los resuelve con el paquete o con el proyecto individual (por
  `numero_proyecto`) comprado con anexos. Personalizados: `anexo.html?pedido=PZ-0001&a=…`.
- Catálogo público de sueltos: RPC `marketplace_proyectos_publicos(p_id)` (única vía anónima a
  `dosificacion_pdas`, solo sueltos publicados). Ficha `tienda/proyecto.html?id=`.
- **Proyectos personalizados**: `marketplace_pedidos` (número `PZ-0001…`, estados
  `pendiente_pago → pendiente → en_proceso → completado | cancelado`, `fecha_compromiso_entrega`,
  `drive_folder_id`, `producto_id` al entregar), `marketplace_personalizados_config` (fila única:
  `abierto`, `tope_semanal`, `ventana_horas`, precios) y `marketplace_orden_items.pedido_id`
  (ítem sin producto). RPC pública `marketplace_personalizados_estado()`; admin
  `admin_listar_pedidos/actualizar_pedido/estado_personalizados/guardar_personalizados`. Flujo:
  `personalizado.html` → `checkout.html?personalizado=1` → `crear-preferencia-mp` (rama `pedido`)
  → `procesarPago` → `activarPedidosDeOrden` (correos cliente y `MAIL_ADMIN`) → admin "Personalizados"
  → Edge `completar-pedido` (verifica Drive, crea producto `proyecto`, accesos, correo). Carpeta:
  `{grado o combo}/Proyectos Personalizados/PZ-0001_Nombre/`.
- `marketplace_busquedas_vacias` (filtros sin resultado, inserta cualquiera, lee admin) y
  `avisos-pedidos` (Edge, la llama `pg_cron` `avisos-pedidos-diario` a las 14:00 UTC vía `pg_net`
  con el secreto `cron_secret` de Vault): correo de pedidos vencidos o por vencer.
- Legal: `terminos.html`, `privacidad.html`; `marketplace_ordenes.terminos_aceptados_en`.
  `crear-preferencia-mp` tiene `EXIGIR_TERMINOS=false` hasta que el checkout nuevo esté servido.

### 6.5 Acceso a Mi Salón: periodos, accesos, interruptor y solo lectura (b21, 2026-09-26)
Spec de Jorge "Mi Salón, registro histórico, precios y cobros" (2026-09-26) §2, §5, §7.1 y §8.
Migración `supabase/mi_salon_b21_acceso_2026-09.sql`; pruebas SQL `pruebas/sql/mi-salon-acceso.sql`
(corren en pruebas dentro de `begin … rollback`); reglas del cliente en `pruebas/mi-salon-acceso.test.js`.

- **`mi_salon_periodos`** (`ciclo`, `periodo` T1-T3, `orden`, `venta_desde`, `compra_tardia_desde`,
  `registro_calificaciones`, `boletas_fin`, `vence`): el calendario, cargado con 2026-2027 (T1 vence
  18-dic-2026, T2 9-abr-2027, T3 30-jul-2027). Lectura pública; escribe solo `es_admin()` (panel →
  Mi Salón → Calendario de periodos). Un CHECK exige el orden de las fechas.
- **`mi_salon_accesos`** (`docente_id`, `ciclo`, `periodos[]`, `origen` ∈ `gratis_t1` · `pago` ·
  `piloto` · `regalo_admin`, `pago_id`, `precio_pagado`, `tipo_precio` ∈ `fundador` · `lista` ·
  `cupon`, `producto`, `vence_fijo`, `desde`, `notas`). **El vencimiento no se guarda:**
  `mi_salon_vence(acceso)` = el `vence` más tardío de sus periodos en `mi_salon_periodos` (o
  `vence_fijo`, solo para un regalo con fecha); el acceso termina al iniciar el día siguiente, hora
  del centro (`mi_salon_fin`). Una compra que cruza de ciclo son dos filas con el mismo `pago_id`
  (índice único `(pago_id, ciclo)`: el webhook es idempotente); la del ciclo aún no cargado no suma
  y se extiende sola al cargarlo. El cliente solo lee sus filas; escriben el trigger de alta, los RPC
  del admin y el service role (cobros).
- **Alta:** trigger `mi_salon_alta_cuenta` (AFTER INSERT en `auth.users`) da `gratis_t1` a toda
  cuenta creada hasta el vencimiento del periodo gratis (`jissez_config.gratis_ciclo/gratis_periodo`,
  hoy 2026-2027 T1); el respaldo de la migración se lo dio a las cuentas existentes. **Sin prueba de
  14 días (decisión de Jorge, 2026-09-26):** una cuenta creada desde el 19-dic-2026 no recibe acceso:
  entra en solo lectura hasta que compre. Piloto: `piloto` a todo el ciclo (QA en pruebas con b21c;
  soporte y Fanny en producción con `mi_salon_b21b_piloto_produccion_2026-09.sql`, con el OK de Jorge).
- **Interruptor de lanzamiento** (`jissez_config.mi_salon_abierto`, una fila, lectura pública, lo
  cambia solo el admin con `admin_mi_salon_interruptor`). Apagado: todo como antes, Mi Salón solo lo
  ven las cuentas con `activo_saas` o con acceso `piloto`, la presentación sigue sin enlaces y no hay
  correo de bienvenida. Encendido: toda cuenta ve Mi Salón (sin acceso vigente, en solo lectura), la
  tienda enlaza `conoce-mi-salon` (menú y pies, `tienda-common.js`), la presentación ofrece crear la
  cuenta con el T1 gratis y las cuentas creadas desde entonces reciben la bienvenida.
- **`activo_saas` convive así:** sigue siendo la llave manual para VER Mi Salón con el interruptor
  apagado (el piloto, QA). Ya no da permiso de escribir por sí solo: escribir exige acceso vigente.
  Hasta el 18-dic todas las cuentas tienen `gratis_t1`, así que nadie cambia de comportamiento; las
  cuentas del piloto tienen además `piloto` hasta el 30-jul-2027. Para dar Mi Salón a alguien más
  con el interruptor apagado: panel → Mi Salón → Dar acceso → "Piloto".
- **Estado para la app:** columna calculada `perfiles.mi_salon` (jsonb: `abierto`, `visible`,
  `vigente`, `tiene_acceso`, `origen`, `ciclo`, `periodos`, `vence`, `solo_lectura_desde`,
  `dias_restantes`, `piloto`, `bienvenida_pendiente`) que el candado (`js/saas-guard.js`), el login y
  la tienda leen con `activo_saas` en UNA consulta (`select=activo_saas,mi_salon`); RPC
  `mi_salon_estado()`; `mi_salon_acceso_vigente(uid, momento)` (security invoker: cada quien solo ve
  lo suyo). Si la base no tiene la columna, el cliente cae a leer solo `activo_saas`.
- **Solo lectura EN EL SERVIDOR:** políticas RESTRICTIVE `acceso_mi_salon_ins/upd/del` (helper
  `mi_salon_candado(tabla)`) en todas las tablas del SaaS que escribe el docente; sin acceso vigente,
  INSERT/UPDATE/DELETE fallan con 42501 y la pista `mi_salon_solo_lectura` (nunca un "0 filas"
  silencioso). No llevan candado: `perfiles`, `interes_secciones`, la tienda, los catálogos,
  `ponte_al_dia` (el estado del asistente, no es captura) y las tablas de configuración y cobro de
  b21 y b22 (`jissez_config`, `mi_salon_periodos`, `mi_salon_accesos`, `mi_salon_correos`,
  `mi_salon_precios`, `mi_salon_ordenes`, `mi_salon_avisos`: las escriben el admin, los triggers o
  el service role). `calificacion_directa` (b20) sí: está en la lista de b21 y b20 también la llama
  si b21 ya existe. **Una tabla nueva del SaaS debe llamar a
  `select public.mi_salon_candado('public.tabla')` en su migración** (`pruebas/migraciones-orden.test.js`
  lo exige de cada tabla nueva desde interes_secciones). Los RPC que escriben son
  security invoker (pasan por las políticas); `incrementar_uso_criterio` (definer) no cuenta sin
  acceso; `delete_own_account` siempre funciona (salvo una cuenta con compras de la tienda o un PAGO
  de Mi Salón: soporte). Su versión FINAL es la de b22 (§13; la última del orden de producción).
  Nunca se borran datos por falta de pago.
- **Capturas sin señal:** la cola (`js/bandeja-salida.js`) manda en cada envío la cabecera
  `x-capturado-en` con la hora del aparato (y, en la asistencia nueva, también la columna
  `capturado_en` de b20, que decide `es_historico`). Sin acceso vigente, la base acepta la captura si esa hora
  cae dentro de un acceso y no han pasado 48 h desde que ese acceso venció; la hora se acota (no más
  de 10 min en el futuro ni de 30 días atrás), así que mentir con ella da a lo más 48 h. Lo que la base
  rechaza por solo lectura NO sale de la cola: estado `acceso`, aviso en Hoy/Exámenes/las demás
  páginas, y se reintenta al abrir, al volver la red o a primer plano.
- **En la app** (`js/mi-salon-acceso.js`, cargado tras el candado): banner fijo en Inicio ("Tu acceso
  terminó el [fecha]. Tus datos están guardados. Renueva para seguir capturando." → hoy lleva a
  `tienda/conoce-mi-salon.html`; cobros lo cambia a la compra, `MiSalonAcceso.COMPRA`), estado en Mi
  cuenta, aviso corto en las demás páginas y los controles marcados `data-captura` /
  `data-captura-zona` se ven deshabilitados y explican por qué al tocarlos. Un 403 de solo lectura en
  cualquier página (evento `jissez:solo-lectura` de `js/supabase.js`) avisa igual. Imprimir, exportar y
  la presentación siguen; la redacción con IA (`redactar-boleta`) exige acceso vigente.
- **Correo de bienvenida:** Edge `bienvenida-mi-salon` (la pide el login cuando
  `mi_salon.bienvenida_pendiente`); vuelve a decidir en el servidor (Mi Salón abierto, cuenta creada
  desde que se abrió, con `gratis_t1`, correo confirmado), aparta la fila `mi_salon_correos
  (docente_id, 'bienvenida')` antes de enviar (idempotente) y la libera si Resend falla. La fecha sale
  de `mi_salon_periodos`.
- **Panel** (`tienda/admin.html` → Mi Salón, `tienda/js/admin-mi-salon.js`): interruptor, métricas
  (cuentas, nuevas desde el lanzamiento, con grupo, "Ponte al día" = alguna captura con
  `es_historico`, boleta del T1 generada/cerrada, pagos del T2), docentes con origen, periodos, vence,
  monto y tipo de precio, exportación a Excel por estado, dar/extender/quitar acceso (regalo o
  piloto) y el calendario. Precios y cupo fundador: lugar reservado para cobros (b22).
- **Encender el lanzamiento (con el OK de Jorge):** panel → Mi Salón → "Abrir Mi Salón", o en SQL:
  `select public.admin_mi_salon_interruptor(true);` ejecutado como el admin (en el editor SQL de
  Supabase, que no tiene sesión de admin: `update public.jissez_config set mi_salon_abierto = true,
  mi_salon_abierto_desde = coalesce(mi_salon_abierto_desde, now()), actualizado_en = now() where id;`).
  Indexación de las presentaciones (no se puede con lógica: el buscador lee el HTML y la cabecera):
  en el mismo despliegue, quitar `<meta name="robots" content="noindex, nofollow">` de
  `tienda/conoce-mi-salon.html` (y de `tienda/conoce-sala.html` si también se lanza Sala) y las reglas
  `/tienda/conoce-mi-salon`, `/tienda/conoce-mi-salon.html` (y las de `conoce-sala`) de `/_headers`;
  ajustar `pruebas/presentaciones.test.js` §1 a "indexadas".

### 6.6 Cobros de Mi Salón: precios, cobertura, Mercado Pago y avisos (b22, 2026-09-26)
Spec de Jorge §3, §5.2, §6, §7 y §8 (sin prueba de 14 días). Migración
`supabase/mi_salon_b22_cobros_2026-09.sql` (+ `mi_salon_b22_avisos_cron_2026-09.sql`, solo producción);
pruebas SQL `pruebas/sql/mi-salon-cobros.sql` (fechas simuladas, dentro de `begin … rollback`); del
cliente y del camino del pago `pruebas/mi-salon-cobros.test.js`.

- **Precios:** `mi_salon_precios` (`ciclo`, `producto` ∈ trimestre · resto_ciclo · ciclo ·
  paquete_tienda, `precio_lista`, `precio_fundador`, `activo`, `vende_hasta_periodo`), editable en el
  panel (RLS: solo `es_admin()`). 2026-2027: Trimestre $199/$299, Resto del ciclo $399/$549 (se vende
  hasta el registro del T2, 5-mar), Ciclo completo $549/$749 inactivo. `paquete_tienda` cabe en el
  modelo y no se vende. La presentación lee la tabla (`mi_salon_precios_publicos()`, solo con Mi Salón
  abierto); `PRECIOS_MI_SALON` queda en null como lo que se ve apagado.
- **Precio fundador:** cupo en `jissez_config.mi_salon_cupo_fundador` (100). Lugares = cupo − DOCENTES
  distintos que NO son compradores de la tienda con un pago aprobado a precio fundador en el ciclo
  (`mi_salon_lugares_fundador`; decisión de Jorge del 2026-09-26: **los compradores de la tienda no
  ocupan lugar**, van aparte). Tiene fundador un comprador de la tienda (motivo `tienda`, se revisa
  primero, también en su compra siguiente: orden pagada de planeaciones antes de
  `mi_salon_fundador_tienda_hasta`, o de `mi_salon_abierto_desde`; sin lanzamiento, cualquiera) aunque
  no queden lugares, quien ya pagó a fundador en el ciclo ("previo", no ocupa otro lugar), o cualquiera
  mientras queden. Un reembolso libera.
- **Cupones:** los de la tienda, sobre el precio de LISTA (`marketplace_cupon_evaluar` con el ámbito
  `mi_salon`, que nunca lleva la oferta general). Se cobra el más bajo de fundador y cupón, sin sumar;
  **empate → gana el cupón** (decisión de Jorge del 2026-09-26: así el creador cobra su comisión). `cupon_codigo` se sella solo si el cupón fue el aplicado (así cuentan usos y
  comisión); si no, `cupon_referido`.
- **Cobertura** (`mi_salon_cobertura(producto, fecha)`): P = periodo cuya ventana de venta contiene la
  fecha. Trimestre: P, y el siguiente si fecha ≥ P.compra_tardia_desde (el T1 del ciclo siguiente aunque
  no esté cargado: vence provisional con P y se extiende sola al cargarlo). Resto: P..T3. Ciclo: T1-T3.
  No se vende lo que no agrega ningún periodo (`ya_cubierto`) y la compra lo explica
  (`MiSalonCompra.explicarNoDisponible`: "Ya tienes acceso hasta el 18 de diciembre de 2026; desde el
  23 de octubre de 2026 esta compra incluye también el segundo trimestre", con `compra_tardia_desde`
  de la cobertura). Todo desde `mi_salon_periodos`.
- **Orden y pago:** una compra es una fila de `marketplace_ordenes` (monto, estado, cupón, términos) con
  su fila en `mi_salon_ordenes` (producto, cobertura cotizada, tipo de precio, datos del pago pendiente)
  y SIN renglones en `marketplace_orden_items`. Edge `comprar-mi-salon` → `mi_salon_registrar_orden`
  (cotiza en el servidor, reutiliza la pendiente sin pago, avisa si hay un OXXO pendiente) → preferencia
  de Checkout Pro igual que la tienda (12 mensualidades, 7 días, `notification_url` =
  webhook-mercadopago, regreso a `tienda/mi-salon-compra?orden=`). El webhook y confirmar-pago no
  cambiaron: `procesarPago()` (`_shared/pagos.ts`) reconoce la orden de Mi Salón y la manda a
  `procesarPagoMiSalon` → `mi_salon_aplicar_pago` (FOR UPDATE, idempotente con `(pago_id, ciclo)`):
  aprobado → cobertura = cotizada ∪ la del día de aprobación, un acceso `pago` por ciclo SUMADO a lo
  que haya, `precio_pagado`, `tipo_precio`, `producto`; pendiente → "Pago pendiente" con referencia y
  ficha; reembolso → quita los accesos de ese pago. Correo de confirmación una vez por orden
  (`mi_salon_correos` `pago:<orden>`). Mis compras de la tienda no lista las órdenes de Mi Salón.
- **Avisos:** `mi_salon_avisos` (fechas relativas a los periodos, editables; audiencias
  `gratis_vigentes`, `gratis_sin_renovar`, `pago`): T1 gratis 6-nov, 13-nov, 30-nov, 11-dic, 17-dic,
  19-dic; con pago 21, 7 y 1 días antes y el día siguiente al vencimiento. `mi_salon_correos_pendientes`
  junta además el recordatorio de OXXO a las 24 h, la vigencia extendida y el aviso de LANZAMIENTO (una
  vez por cuenta que ya existía al abrir, con el T1 gratis; no piloto ni activo_saas). Edge
  `avisos-mi-salon` (cron cada hora, 8:00-21:00, o el panel con la sesión del admin para el
  lanzamiento); idempotente con `mi_salon_correos`; solo con Mi Salón abierto. En la app, el estado
  (`perfiles.mi_salon`) trae `pago_pendiente` y `aviso` (banner de Inicio que se puede cerrar y Mi
  cuenta).
- **Panel** (`tienda/js/admin-mi-salon-cobros.js`): aviso de lanzamiento, precios, cupo y corte de la
  tienda, pagos (con OXXO pendientes y "no agregó periodos"), métricas y listas de WhatsApp por
  segmento con el texto listo (`admin_mi_salon_cobros`).
- **Llegada con Mi Salón abierto** (decisión de Jorge): quien todavía no usa Mi Salón (sin activo_saas,
  sin piloto, sin grupo ni última sección Mi Salón/Sala) entra a la tienda (catálogo) con un aviso
  discreto; quien ya lo usa, a su última sección.
- **Producción:** los pasos exactos, en orden (migraciones, secretos, Edge Functions, cron, frontend
  e interruptor), están en `docs/PRODUCCION-MI-SALON.md`. La URL del webhook no cambia.
- **Decisiones PENDIENTES de confirmar por Jorge** (quedaron con la opción conservadora del
  constructor AM; se cambian en b22 si Jorge decide otra cosa):
  1. La cobertura de una compra es la que se cotizó MÁS la del día en que se aprueba el pago (un OXXO
     cotizado el 22-oct y pagado el 23-oct cubre también el T2; nunca menos de lo que vio).
  2. El aviso "vence" (`pago_terminado`, `gratis_terminado`) sale al día siguiente del vencimiento.
  3. Los avisos del 6 y del 13 de noviembre llegan a toda cuenta con el T1 gratis vigente (también a
     quien ya pagó el T2).
  4. Con el interruptor apagado, la compra solo la ven las cuentas piloto y con `activo_saas`.
  5. No hay aviso de lanzamiento después del 18 de diciembre (el T1 gratis ya terminó).
  Ya decididas por Jorge el 2026-09-26 (implementadas): los compradores de la tienda con precio
  fundador NO ocupan lugar del cupo; no se vende lo que no agrega periodos y se explica; en empate
  entre cupón y fundador gana el cupón.

---

## 7. Estado de los módulos

| Módulo | Estado | Archivo |
|---|---|---|
| Auth (login/registro) | Completo | `tienda/login.html`, `tienda/js/login.js` (la raíz `index.html` solo reencamina) |
| Selector de secciones (Tienda · Mi Salón · Sala de Maestros), solo para cuentas con `activo_saas`: pestañas en una fila de marca arriba en PC y tablet (≥ 768 px) y barra fija abajo en celular (respeta el área segura; la página gana espacio al final y lo fijo abajo sube). Un solo componente para las tres secciones. Guarda la **última sección** por dispositivo (`localStorage` `jissez.seccion`): el login vuelve ahí (Mi Salón → panel, o alta si no hay grupo; Tienda → portada; Sala → su página; primera vez, Mi Salón; `?next=` válido se respeta), y entrar por la raíz (`index.html`) lleva a Mi Salón o Sala si fue la última, confirmando antes sesión y acceso. `portal.html` (la pantalla de tres tarjetas de la decisión 12) quedó solo como redirección a la última sección. Los compradores sin acceso ven la tienda igual que antes | Completo (2026-09-25; reemplaza al portal del 2026-09-24) | `js/secciones.js`, `js/navbar.js`, `tienda/js/tienda-common.js` (`montarNav`), `tienda/js/login.js`, `index.html`, `portal.html` + `js/portal.js` |
| Sala de Maestros ("Próximamente": espacio para compartir material didáctico entre docentes), protegida como Mi Salón. Decisión de Jorge (2026-09-26): la pestaña no se muestra a nadie mientras la Sala no exista (el selector lleva solo Tienda y Mi Salón; interruptor `SALA_ABIERTA` en `js/secciones.js`); la página sigue, sin acceso desde la navegación | Página de espera (2026-09-25) | `sala-maestros.html`, `js/sala-maestros.js` |
| Onboarding (crear grupo + alumnos + ciclo + trimestre; lista pegada de Excel, Word o WhatsApp) | Completo | `onboarding.html`, `js/lista-pegada.js` |
| Ponte al día (registro histórico: alumnos, asistencia pasada, actividades en bloque, revisar la boleta y calificación directa) | Completo (2026-09-26, b20; en pruebas) | `ponte-al-dia.html`, `js/ponte-al-dia.js`, `js/historico.js` |
| Inicio (resume el día y lleva a "Hoy"; plan de la sesión, "Trabajar hoy", terminar sesión) | Completo (rehecho 2026-09-23, 3.7) | `dashboard.html` |
| **Hoy** (captura diaria: asistencia · tareas vencidas · productos de las sesiones del día · cierre · Trabajar hoy). Desde 2026-09-25 su cola de guardado vive en el dispositivo (IndexedDB `jissez-bandeja`): sobrevive a recargar o cerrar sin red, se reenvía al volver la red, al volver a primer plano y al abrir Hoy; escrituras idempotentes (upsert por llave; calificación con `evaluado_en` = momento de la captura y "gana la más reciente"); solo se reintenta lo de red y lo que la base rechaza se avisa y sale de la cola (una calificación de una actividad que se quitó en otra pantalla: aviso "Esta actividad se quitó en otra pantalla; tu captura no se aplicó" y la actividad sale de la pantalla, b19a). Un error de la base sin traducir (p. ej. falta una migración) se muestra en español y el detalle va a la consola | Completo (2026-09, B.1; cola persistente 2026-09-25) | `hoy.html`, `js/hoy.js`, `js/bandeja-salida.js` |
| **Actividades sueltas** (sin proyecto, "guiar sin obligar"): "Actividad suelta" en Hoy (de cualquier día del trimestre en curso; la de un día pasado se califica al agregarla), guardadas en el contenedor "Actividades del trimestre" (`proyectos.tipo = 'sueltas'`, una sesión por fecha y campo); "Pasar a un proyecto" del mismo grupo y trimestre sin perder calificaciones, asignación ni PDA (`mover_producto_a_sesion`, la única vía para cambiar de sesión un producto); "Calificar" desde la tarjeta "Actividades del trimestre" de Proyectos | En la rama, pendiente de publicar (b17 y b19a) | `js/hoy.js`, `js/productos-hoy.js`, `js/pasar-a-proyecto.js`, `js/planeacion.js` |
| **"¿Para quién?"**: cada actividad o tarea es para todo el grupo, uno o varios grados o los alumnos que se eligen (con "¿Con qué grado trabajan?" solo en ese modo); en Hoy al agregar y en "Para quién" de un producto ya creado (quien ya tiene calificación queda bloqueado), y en Crear proyecto por sesión. El alumno sigue en su grado oficial para la boleta | En la rama, pendiente de publicar (b17) | `js/para-quien.js`, `js/hoy.js`, `js/crear_proyecto.js`, `js/alcance-hoy.js` (`asignadoA`) |
| **Incompleta**: una actividad en clase marcada Incompleta se revisa el siguiente día de clase (calendario SEP y ajustes del grupo) en "Pendientes de la clase anterior": "Lo completó" con el nivel que logró o "Sigue incompleta" (0.5 en el motor); si el alumno faltó, queda pendiente | En la rama, pendiente de publicar (b17) | `js/hoy.js`, `js/calendario-sep.js`, `js/motor-calificacion.js` |
| **App instalable "Jissez MS"** (Mi Salón como PWA en `/salon/`): manifest, íconos, atajos (Pasar lista, Calificar trabajos, Reportes), página "Sin conexión", modo app (la Tienda abre en el navegador; login y cierre de sesión dentro de `/salon/`), botón "Instalar la app" en Inicio y en el menú de la cuenta (Chromium: aviso del navegador; iPhone/iPad: instrucciones) | Completo (2026-09-25, fases 1 y 2.5 de `docs/PWA-MI-SALON.md`) | `salon.webmanifest`, `sw.js`, `sin-conexion.html`, `iconos/`, `js/app-instalada.js` |
| Asistencia (con autosave) | Completo | `asistencia.html` |
| Mi Grupo (CRUD grupo y alumnos; ficha del alumno con WhatsApp al tutor, escuela y director por grupo, niñas y niños en el resumen) | Completo (ficha y director: 2026-09-25, B13) | `mi-grupo.html`, `js/ficha-alumno.js` |
| Incidencias (registro por grupo con alumnos involucrados, editar, eliminar con confirmación, documento imprimible con firmas de docente, director(a) y tutor) | Completo (2026-09-25, B13) | `incidencias.html`, `js/incidencias.js` |
| Calendario escolar SEP 2026-2027 del grupo (vista de mes, hoy y próximo día sin clase, ajustes propios con confirmación, fuente DOF) y rol de aseo (reparto por días de clase, continuidad entre meses, cambios a mano, imagen PNG para WhatsApp, compartir, copiar texto e imprimir). No cambia la asistencia ni el trimestre; desde 2026-09-26 las tareas vencen y lo incompleto se revisa el siguiente día de clase (`siguienteDiaDeClase`, cabecera de `js/calendario-sep.js`) | Completo (2026-09-25, en pruebas) | `calendario.html`, `js/calendario.js`, `js/calendario-sep.js`, `js/rol-aseo.js` |
| Listas de cooperación y materiales (columnas palomita, texto y monto en pesos; resumen y avance; imagen y texto para familias sin nombres; Recordar por WhatsApp; impresión solo para uso docente; cerrar como expediente, reabrir con confirmación; historial por alumno) | Completo (2026-09-26, b15) | `listas.html`, `js/listas.js` |
| Crear Proyecto / Planeación (3 pasos con catálogo SEP) | Completo | `crear_proyecto.html` |
| Planeación (lista de proyectos con filtros + acciones completas) | Completo | `planeacion.html` |
| Actividades | Completo | `actividades.html` |
| Tareas (seguimiento de los productos tipo tarea; la revisión es en "Hoy") | Completo (rehecho 2026-09-23, 3.7) | `tareas.html` |
| Reportes (Asistencia · Vista Recrea · Concentrado · Boleta · Avance por PDA), todo sobre el motor y la calificación confirmada | Completo (2026-09) | `reportes.html`, `js/reportes.js`, `js/reportes-grupo.js` |
| Boleta imprimible por alumno (B.8.1) | Completo (2026-09-23) | `boleta.html`, `js/boleta.js` |
| Reporte detallado por alumno (B.8.2) | Completo (2026-09-23) | `reporte-alumno.html`, `js/reporte-alumno.js` |
| Presentación para la junta de padres (B.8.3) | Completo (2026-09-23) | `junta.html`, `js/junta.js` |
| Exportación CSV/XLSX del concentrado (B.8.5) | Completo (2026-09-23) | `exportar.html`, `js/exportar.js` |
| Redacción de textos con IA (B.7 Capa 2) | Construido, **apagado** hasta que exista el secreto `ANTHROPIC_API_KEY` | Edge `redactar-boleta` |
| Grupo activo (selector en la barra, toda la app) | Completo (2026-09-23) | `js/grupo-activo.js` |
| Mi Cuenta | Completo | `mi-cuenta.html` |
| Ajustes (notificaciones + ponderación de calificaciones) | Completo | `ajustes.html` |
| Evaluación Formativa (semáforo por alumno/sesión, autosave) | Completo; ahora **afina** lo que ya propuso la propagación por PDA | `evaluacion_formativa.html` |
| Evaluación Diagnóstica (cuaderno + lectura + matemáticas, semáforo) | Completo | `evaluacion_diagnostica.html` |
| Exámenes de Mi Salón: solo subir resultados, o crear el examen (4 tipos de pregunta), imprimir examen y hoja de respuestas con QR, revisar con la cámara (lector propio en el navegador; la foto no se sube), tocando o a mano (b18, 2026-09-26); "No presentó" por alumno y las capturas por la misma cola sin señal de Hoy (b19); cada respuesta va al examen de su pregunta (b19a) | Completo (en pruebas) | `examen.html`, `js/examen*.js` |
| Páginas de presentación con "Avísame": Mi Salón (qué es, para qué sirve, cómo se usa, privacidad, preguntas frecuentes; capturas reales con nombres ficticios) y Sala de Maestros | En la rama, pendiente de publicar (`jissez_interes_secciones`) | `tienda/conoce-mi-salon.html`, `tienda/conoce-sala.html`, `tienda/js/interes-seccion.js`, `presentacion/img/` |
| Marketplace (catálogo + filtros + preview + importar) | Completo | `marketplace.html` |
| Tienda: paquetes (catálogo, ficha, checkout MP, biblioteca, anexos, promoción, cupones) | Completo | `tienda/*` |
| Tienda: proyectos individuales (venta con/sin anexos, entrega, admin "Proyectos individuales") | Completo (2026-09, Bloque 1) | `tienda/admin.html`, Edge `admin-proyectos-drive` |
| Tienda: filtro por campo/contenido/PDA + ficha `proyecto.html` + legal | Completo (2026-09, Bloque 2) | `tienda/catalogo.html`, `tienda/proyecto.html`, `tienda/terminos.html`, `tienda/privacidad.html` |
| Tienda: proyectos personalizados (pedidos, cobro, admin, entrega, correos) | Completo (2026-09, Bloque 3) | `tienda/personalizado.html`, Edge `completar-pedido` |
| Tienda: búsquedas sin resultado, aviso diario de vencidos, landing normalistas | Completo (2026-09, Bloque 4) | Edge `avisos-pedidos`, `tienda/practicantes.html` |

### Pendientes / deuda técnica
- El Marketplace muestra estado vacío hasta que el bot publique proyectos con `estado = 'publicado'`.
- `dosificacion_proyectos.proposito` no existe en BD — el importador usa `producto_final` como fallback.
- **Job de enriquecimiento de productos:** los `productos_sesion` con `origen='backfill'` tienen nombre genérico ("Producto — Sesión N · CAMPO"); antes de lanzar Mi salón al público hay que extraer el nombre real del producto de cada sesión (revisar si el texto de `dosificacion_sesiones` permite regex antes de gastar en IA) y actualizar las instrucciones del bot para que llene `dosificacion_sesiones.productos` con el shape de `cierre_tareas`.
- La **Parte B** está construida en la rama `mi-salon-parte-b` (sin merge: lo decide Jorge). Lo construido y sus diferencias con la especificación: `docs/PRODUCTO-MI-SALON.md`; bitácora, veredictos de los revisores y decisiones pendientes: `docs/PROGRESO-PARTE-B.md` y `docs/REPORTE-FINAL-PARTE-B.md`.
- **Decisiones de Jorge del 2026-09-24** (tabla completa en `docs/PROGRESO-PARTE-B.md`): 1 y 2 diarios valen el rubro completo; juicio docente para un alumno sin evidencias; grado y rubros en la foto del cierre; junta y exportación congeladas para boletas cerradas; Asistencia igual que "Hoy"; alta tarde; portal de tres partes para cuentas con acceso (el 2026-09-25 Jorge lo cambió por el selector de secciones: Tienda, Mi Salón y Sala de Maestros; `portal.html` solo redirige); Pixel de Meta fuera del SaaS; políticas que exigen referencias propias. **Siguen pendientes:** "retardo" en asistencia; pantalla para editar `plantillas_sugerencia`; criterios propios de cuaderno y habilidades por maestro; activar la IA (secreto y costo).
- **Limitaciones conocidas:** el examen por campo es aproximado solo con el modelo anterior del catálogo (ver `examenes`); la calificación de un rubro de participación/conducta depende de que el maestro haga el cierre del día; las sesiones importadas no traen fecha y hay que usar "Trabajar hoy"; los productos `origen='backfill'` tienen nombre genérico hasta el job de enriquecimiento; la presentación de junta compara contra el trimestre anterior solo cuando existe; una boleta cerrada no se puede reabrir desde la interfaz; en un proyecto con sesiones trabajadas no se pueden agregar grados (fase 1: conservador); agregar, renombrar o quitar productos en Hoy necesita señal.
- Una fila de `dosificacion_proyectos` (1°-2°, proyecto 1, estado `generado`) no tiene `trimestre`; si se publicara así, el importador crearía un proyecto sin trimestre. El bot debe llenarlo antes de publicarla.
- El rubro de examen se calcula con los exámenes del trimestre del grado del alumno: los de Mi Salón (b18) suman aciertos / preguntas por campo (exacto; solo cuenta lo capturado); el del catálogo anterior, si existe, entra como tantas preguntas como tenía en ese campo y es aproximado (`banco_preguntas` no guarda el valor de cada pregunta). Solo entonces la boleta y los reportes lo rotulan "aproximado".
- Resuelto 2026-09-23 (3.7): Vista Recrea y Concentrado leen la calificación confirmada; la tarjeta vieja de tareas del Dashboard se retiró (Inicio lleva a "Hoy"); el `.single()` de grupos se reemplazó por el grupo activo en toda la app; Hoy, Tareas e Inicio leen calificaciones, productos y sesiones sin el tope de 1000 filas de Supabase (`AlcanceHoy.leerPorLotes`), igual que el motor.
- **Borrado en cascada (corregido en B.3):** `calificaciones` referencia `producto_sesion_id`, `sesion_id` y `proyecto_id` con `ON DELETE CASCADE`. Antes eran `SET NULL` y borrar una sesión o un proyecto con calificaciones fallaba con error 23503 (dos acciones de integridad en conflicto sobre la misma fila). `registro_diario`, `asistencias` y `boleta_trimestral` no cuelgan del proyecto: sobreviven.
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
