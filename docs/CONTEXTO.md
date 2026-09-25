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
> Todas de una vez: `for t in pruebas/*.test.js; do node $t | tail -1; done` (39 suites).
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
  de proyectos activos. Una tarea sin
  `fecha_entrega` vence el siguiente día hábil después de su sesión (`venceTarea`).
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

---

## 5. Stack técnico

- **Frontend:** HTML5 + Tailwind CSS (vía CDN) + **Vanilla JavaScript**. App multipágina
  (cada feature es un `.html` + su `js/*.js`). Sin framework SPA, sin bundler, sin npm.
- **Backend / BD / Auth:** **Supabase** (PostgreSQL). Auth por JWT en localStorage.
- **Seguridad:** Row-Level Security (RLS) en todas las tablas — `auth.uid() = maestro_id`,
  cada maestro solo ve sus datos (multi-tenant).
- **Despliegue:** GitHub → Cloudflare Pages (CI/CD). Entorno local: VS Code Live Server.

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
  `127.0.0.1:5500`, no entrega archivos ocultos), `navegador.js` (Playwright con inicio de
  sesión real; `abrir({ cuenta: 2 })` para la segunda cuenta), `humo.js` (recorre todas las
  pantallas con los dos grupos), `aislamiento.js`, `verificar-*.js` y las carpetas de los
  revisores con sus scripts y evidencias.
- Pruebas automáticas: ver §3.

---

## 6. Modelo de datos (Supabase) — verificado contra el esquema real

### 6.1 Mundo SaaS (datos del maestro, en runtime)

| Tabla | Columnas clave |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `escuela`, `tipo_organizacion`, `grados` (array), `es_multigrado` (bool), `ciclo_escolar`, `descripcion`, `trimestre_actual` (lo usan el alcance de "Hoy", el diagnóstico y la semilla de QA) |
| `alumnos` | `maestro_id`, `grupo_id`, `num_lista` (int), `nombre_completo`, `grado` (smallint 1–6, **NOT NULL**), `estatus` (`activo`, en minúsculas: así escribe y filtra todo el código) |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, **`asistencia_estado`** (text: `presente`/`ausente`/`justificada`) |
| `proyectos` | `maestro_id`, `grupo_id`, `trimestre` (1/2/3), `titulo`, `grados` (array), `fase` (array), `metodologia`, `escenario`, `proposito`, `pregunta_generadora`, `campos_formativos` (array), `ejes_articuladores` (array), `es_multigrado` (bool), `contenidos_pda` (jsonb), `estado` (`borrador`/`activo`/`completado`/`pausado`), `visible_mercado` (bool), `fecha_inicial`, `fecha_final` |
| `sesiones` | `proyecto_id`, `maestro_id`, `numero_sesion`, `duracion` (text, ej. `"90 min"`), `fecha`, `campo_formativo`, `momento`, `inicio_todos`/`desarrollo_todos`/`cierre_todos` (text), `inicio_actividades`/`desarrollo_actividades`/`cierre_actividades`/`cierre_tareas` (jsonb), `inicio_diferenciado`/`desarrollo_diferenciado`/`cierre_diferenciado` (jsonb), `pda_sesion` (jsonb), `recursos` (jsonb), `criterios_evaluacion`, `estado_sesion` (`pendiente`/`activa`/`completada`/`recorrida`), `notas_cierre`, `observaciones` |
| `tareas` | **En desuso (0 filas; nadie la escribe desde 2026-09-23).** Las tareas son `productos_sesion` tipo `tarea`: se revisan en "Hoy" y `tareas.html` las sigue desde ahí. Columnas: `sesion_id`, `proyecto_id`, `grupo_id`, `maestro_id`, `descripcion`, `grado`, `fecha_asignada`, `fecha_revision`, `revisada` |
| `calificaciones` | `alumno_id`, `maestro_id`, `sesion_id`, `proyecto_id`, `grupo_id`, `tipo` (mismo vocabulario que `productos_sesion.tipo` — `tarea`/`trabajo`/`producto_final`/`examen`/`otro` — más `participacion`/`conducta` legacy y `actividad` legacy sin escritores; **con `producto_sesion_id` el trigger `calificaciones_tipo_desde_producto` copia el tipo del producto**), `descripcion`, `calificacion` (numeric 5–10), `entrego` (bool), `fecha`, `grado`, `campo_formativo` (nombre largo). **Nuevo grano (2026-09):** `producto_sesion_id` (FK a `productos_sesion`), `estado_entrega` (`entregado`/`incompleto`/`no_entregado`/`justificado`/`no_aplica`), `nivel` (semáforo), `puntaje` (0–10), `retroalimentacion` (visible a padres), `nota_privada`, `evaluado_en`; índice único parcial `(maestro_id, alumno_id, producto_sesion_id)`. Los tipos `participacion`/`conducta` ya **no se escriben** aquí (ver `registro_diario`) |
| `evaluacion_formativa` | `maestro_id`, `sesion_id`, `alumno_id`, `criterio` (texto), **`origen`** (`automatico` = la dejó el trigger al calificar un producto · `maestro` = la ajustó a mano; el trigger nunca pisa las del maestro), **`sesion_pda_id`** (FK a `sesiones_pda` — obligatorio de facto en filas nuevas: la pantalla lo resuelve siempre, con backfill perezoso para sesiones viejas), `semaforo` (`logrado`/`en_proceso`/`requiere_apoyo`), `observacion`, `fecha` |
| `sesiones_pda` | `sesion_id` (FK `sesiones`, CASCADE), `pda_id` (FK `catalogo_pda`, **nullable** desde B.5 — antes era NOT NULL y un criterio libre reventaba la materialización), `grado` (1–6), `criterio_aplicado`, UNIQUE `(sesion_id, pda_id, grado)` y, para el criterio libre, UNIQUE `(sesion_id, grado, criterio_aplicado)` cuando `pda_id IS NULL`. Espejo estructurado del jsonb `pda_sesion`; lo materializan `js/sesiones-materializar.js` (importador y crear_proyecto) y el backfill perezoso de `evaluacion_formativa.js` |
| `productos_sesion` | Lo calificable de cada sesión: `sesion_id`, `maestro_id`, `tipo` (`trabajo`/`tarea`/`producto_final`/`examen`/`otro`), `nombre`, `descripcion`, `grados` (text[], SIEMPRE orden ascendente), `modalidad` (`compartida`/`diferenciada`), `campo` (**código corto** `LEN`/`SAB`/`ETI`/`DHL`), `orden`, `activo` (false = no cuenta en máximos), `origen` (`importado`/`backfill`/`maestro`/`bot` — `backfill` = producto genérico pendiente de enriquecer con el nombre real), `fecha_entrega` (tareas) |
| `producto_sesion_pda` | N:M `productos_sesion` ↔ `sesiones_pda` (un producto evalúa 1..n PDA del mismo grado) |
| `registro_diario` | Participación y conducta **una vez al día por alumno**, global (no por sesión ni campo): `maestro_id`, `alumno_id`, `fecha`, `participacion` (0–2), `conducta` (0–2), `nota`, UNIQUE `(maestro_id, alumno_id, fecha)`. Se captura en el cierre del día de "Hoy" (valor normal 1); el motor lo reparte entre los campos con sesión ese día (`docs/PRODUCTO-MI-SALON.md` §B.4) |
| `boleta_trimestral` | Boleta por campo formativo: `maestro_id`, `alumno_id`, `ciclo`, `trimestre` (1–3), `campo` (`LEN`/`SAB`/`ETI`/`DHL`/**`GEN`** = fila general), `porcentaje` (0–100), `calificacion` (5–10), `nivel`, `fortalezas`, `areas_oportunidad`, `sugerencias`, `texto_autogenerado` (jsonb: la propuesta de la Capa 1 + `editados` [cuadros que escribió el maestro] + `ia` [redacción de la Capa 2] + `visible` [`reglas`/`ia`]), `editado_manual` (true = el maestro escribió algo en esa fila), `calificacion_confirmada` + `confirmada_en` (la calificación oficial es solo la confirmada), `cerrada` (true = no se recalcula; exige confirmación), UNIQUE `(maestro_id, alumno_id, ciclo, trimestre, campo)`. La boleta de `reportes.js` lee/escribe aquí (autosave on-blur). `calificacion` sale de `calcular_calificacion_boleta` y el trigger `boleta_trimestral_piso_fase` rechaza valores bajo el piso del grado (1° 6; 2° a 6° 5; ver §3) |
| `perfiles` | `id` (= `auth.users.id`), `nombre_completo`, `escuela`, `cct`, `zona`, **`estado`** (text: la entidad federativa de la maestra, con el nombre de `js/entidades.js`; decisión 21), `municipio`, `sexo_docente`, `grados_asignados`, `activo_saas` (acceso a Mi salón). RLS: cada quien la suya |
| `plantillas_sugerencia` | Catálogo global de sugerencias para padres (Capa 1): `clave` PK (`tareas`, `trabajos`, `calidad`, `participacion`, `conducta`, `examen`, `lectura_ppm`, `comprension`, `matematicas` con `{habilidades}`, `cuaderno`, `asistencia`, `pda_mejora`, `pda_apoyo`), `texto`, `descripcion`, `activo`. Lectura para `authenticated`; escritura solo `es_admin()`. Sin pantalla de edición todavía |
| `maestro_ajustes` | PK `maestro_id`; ponderación `peso_tareas`/`peso_trabajos`/`peso_participacion`/`peso_examen`, NOT NULL, DEFAULT 28/28/6/33, CHECK `pesos_con_valor` (los cuatro suman más de 0; `NOT VALID`, desde b10). `peso_conducta` se conserva con DEFAULT 0 pero **no se usa**: la conducta no pondera (LGE art. 21; ver §3). **Sin peso de asistencia** (Acuerdo 10/09/23 art. 7). Onboarding crea la fila solo con `maestro_id` y la BD pone los defaults |
| `examenes` / `respuestas_examen` / `banco_preguntas` | Examen por grupo/trimestre/grado con `preguntas_ids`; cada pregunta de `banco_preguntas` tiene `campo_formativo` → el puntaje del examen se calcula por campo (reportes.js). **Limitación conocida:** `banco_preguntas` no guarda cuánto vale cada pregunta; el máximo por campo se **aproxima** como `valor_total / total_preguntas` por pregunta. No presentarlo como cálculo exacto |
| `evaluacion_diagnostica` | **Fuente única de cuaderno y habilidades básicas.** `maestro_id`, `alumno_id`, `grupo_id`, `momento` (`inicio_ciclo`/`trimestre_1`/`trimestre_2`/`trimestre_3`), `cuaderno` y `matematicas` (jsonb `[{clave, nivel}]`, claves estables de `js/catalogo-habilidades.js`, nivel `logrado`/`en_proceso`/`requiere_apoyo`; un CHECK valida prefijo y nivel), `lectura_ppm`, `lectura_comprension`, `observaciones`, UNIQUE `(maestro_id, alumno_id, momento)`. La fluidez lectora no se guarda: se deriva de `lectura_ppm` + `bandas_ppm` |
| `bandas_ppm` | Catálogo de fluidez lectora por grado, tomado de los Estándares Nacionales de Habilidad Lectora de 2010 (Acuerdo 592, **abrogado**): ya no son estándar vigente, así que la interfaz los rotula **"referencia SEP 2010"** ("Referencia SEP 2010 para 2°: 60 a 84 ppm"; niveles "Requiere apoyo", "Cercano a la referencia", "En la referencia", "Avanzado"). `grado` PK, `requiere_apoyo_max`, `cercano_max`, `estandar_max` (avanzado = mayor); las bandas no cambian. Lectura para `authenticated`. La regla de clasificación y el rótulo viven en `CatalogoHabilidades.clasificarPPM` y `textoReferenciaPPM` |

> **Convención de campos formativos:** las tablas históricas (`calificaciones`,
> `dosificacion_*`, `banco_preguntas`) guardan el nombre largo (`"Lenguajes"`, …); las
> tablas nuevas (`productos_sesion`, `boleta_trimestral`) guardan el código corto
> (`LEN`/`SAB`/`ETI`/`DHL`; el alias histórico `HUM` = `DHL`). La equivalencia vive en un
> único lugar: `js/campos-formativos.js`, y se aplica **al escribir** (importador,
> crear_proyecto, reportes), nunca al leer. Un quinto campo se agregaría ahí y aquí.

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
> grado con `origen='backfill'` + las tareas reales de `cierre_tareas`).

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

---

## 7. Estado de los módulos

| Módulo | Estado | Archivo |
|---|---|---|
| Auth (login/registro) | Completo | `tienda/login.html`, `tienda/js/login.js` (la raíz `index.html` solo reencamina) |
| Selector de secciones (Tienda · Mi Salón · Sala de Maestros), solo para cuentas con `activo_saas`: pestañas en una fila de marca arriba en PC y tablet (≥ 768 px) y barra fija abajo en celular (respeta el área segura; la página gana espacio al final y lo fijo abajo sube). Un solo componente para las tres secciones. Guarda la **última sección** por dispositivo (`localStorage` `jissez.seccion`): el login vuelve ahí (Mi Salón → panel, o alta si no hay grupo; Tienda → portada; Sala → su página; primera vez, Mi Salón; `?next=` válido se respeta), y entrar por la raíz (`index.html`) lleva a Mi Salón o Sala si fue la última, confirmando antes sesión y acceso. `portal.html` (la pantalla de tres tarjetas de la decisión 12) quedó solo como redirección a la última sección. Los compradores sin acceso ven la tienda igual que antes | Completo (2026-09-25; reemplaza al portal del 2026-09-24) | `js/secciones.js`, `js/navbar.js`, `tienda/js/tienda-common.js` (`montarNav`), `tienda/js/login.js`, `index.html`, `portal.html` + `js/portal.js` |
| Sala de Maestros ("Próximamente": espacio para compartir material didáctico entre docentes), protegida como Mi Salón | Página de espera (2026-09-25) | `sala-maestros.html`, `js/sala-maestros.js` |
| Onboarding (crear grupo + alumnos + ciclo + trimestre) | Completo | `onboarding.html` |
| Inicio (resume el día y lleva a "Hoy"; plan de la sesión, "Trabajar hoy", terminar sesión) | Completo (rehecho 2026-09-23, 3.7) | `dashboard.html` |
| **Hoy** (captura diaria: asistencia · tareas vencidas · productos de las sesiones del día · cierre · Trabajar hoy) | Completo (2026-09, B.1) | `hoy.html`, `js/hoy.js` |
| Asistencia (con autosave) | Completo | `asistencia.html` |
| Mi Grupo (CRUD grupo y alumnos) | Completo | `mi-grupo.html` |
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
| Exámenes (aplicar + calificar + auto-calificación por CF) | Completo | `examen.html` |
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
- **Limitaciones conocidas:** el examen por campo es aproximado (ver `examenes`); la calificación de un rubro de participación/conducta depende de que el maestro haga el cierre del día; las sesiones importadas no traen fecha y hay que usar "Trabajar hoy"; los productos `origen='backfill'` tienen nombre genérico hasta el job de enriquecimiento; la presentación de junta compara contra el trimestre anterior solo cuando existe; una tarea sin fecha de entrega vence el siguiente día hábil saltando fines de semana, pero no los días festivos (`dias_no_habiles_extra` no se usa todavía); una boleta cerrada no se puede reabrir desde la interfaz; un proyecto en curso (con sesiones trabajadas o calificaciones) se puede ver en Crear proyecto pero no guardar: guardar vuelve a crear las sesiones y el borrado en cascada se llevaría lo capturado.
- Una fila de `dosificacion_proyectos` (1°-2°, proyecto 1, estado `generado`) no tiene `trimestre`; si se publicara así, el importador crearía un proyecto sin trimestre. El bot debe llenarlo antes de publicarla.
- El rubro de examen se calcula con el examen del grado del alumno (corregido en B.3), pero el máximo por campo sigue siendo aproximado: `banco_preguntas` no guarda el valor de cada pregunta. La boleta lo advierte.
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
