# Mi salón — Especificación del producto (Parte B)

**Origen:** documento `instrucciones-code-mi-salon-evaluacion.md` de Jorge (2026-09-03), que aprobó la Parte A (limpieza de esquema y trazabilidad, ya ejecutada) y fijó esta Parte B como especificación del producto. **La Parte B no se programa sin instrucción explícita de Jorge.** Se copia aquí tal cual para que viva en el repo.

El orden de implementación está en §B.11. El estado de lo ya construido (Parte A) está en `docs/CONTEXTO.md` §6-§7.

---

## 0. Contexto que necesitas para entender el porqué

### 0.1 Lo que hace hoy una maestra sin Mi salón (caso real: Fanny, grupo multigrado 4°-5°-6°)

Se analizaron sus archivos `Base_de_datos_inicial.xlsx` (T2), `Base_de_datos_final.xlsx` (T3) y la presentación `junta_fanny_2T-3T.html`. Su flujo actual:

1. Lleva un Excel por campo formativo con la lista de alumnos repetida en cada uno.
2. Al final del trimestre concentra todo en una hoja `BD_Alumnos` con estas columnas por alumno:
   - Por cada campo (LEN, SAB, ETI, HUM): `Tareas`, `Trabajos`, `Asist.`, `Part.`, `Cond.`, `Examen` — todos como **conteos** (p. ej. 7 de 15 trabajos).
   - Una fila "VALOR MÁXIMO DEL TRIMESTRE" escrita **a mano** por campo (p. ej. LEN: 8 tareas, 15 trabajos, 34 días de asistencia, 10 participación, 10 conducta, 10 examen).
   - Cuaderno (10 criterios semáforo): orden/limpieza, fecha, título, letra, mayús/minús, signos, acentuación, buen estado, orden por proyecto, margen.
   - Habilidades básicas: `Lectura: PPM` (número), `Lectura: Comprensión` (texto), `Mates: Suma/Resta/Multiplicación/División/Fracciones/Tablas/Lectura de cantidades/Problemas` (semáforo).
   - `Trabajo diario` (texto), `Fortalezas` (texto), `Áreas de oportunidad` (texto) — **redactadas a mano por alumno**.
3. Una hoja `Plantilla_Reporte` con VLOOKUP calcula por campo: Tareas 25 % + Trabajos 25 % + Asistencia 10 % + Participación 5 % + Conducta 5 % + Examen 30 % = 100 %, con `(obtenido / máximo) × peso`.
4. Sube ambos Excel a una IA para generar una presentación HTML para junta de padres: promedio del grupo T2→T3, barras por alumno y grado, PPM por alumno contra rango esperado, promedio por campo y grado, y "áreas de atención".

**Problemas que Mi salón debe eliminar:** captura al final del mes (no día a día); asistencia, participación y conducta copiadas idénticas a los 4 campos porque ella las registra de forma global; máximos tecleados a mano; ningún vínculo con los PDA ni con los productos concretos de cada sesión; fortalezas/áreas escritas desde cero; cero retroalimentación por trabajo.

**Lo que hay que conservar de su formato** (le funciona y es reconocible para maestros): la fórmula ponderada por campo, el semáforo de tres niveles (Logrado / En proceso / Requiere apoyo), la revisión de cuaderno, las habilidades básicas (PPM + operaciones), la sección de observaciones con fortalezas y áreas, y el reporte de avance trimestre a trimestre para la junta.

### 0.2 Marco normativo que fija el formato de salida

- Acuerdo 10/09/23 (SEP): en primaria la calificación por campo formativo se asienta en **números enteros de 6 a 10** por periodo (trimestre), y la boleta lleva **observaciones y sugerencias por cada campo formativo**. Preescolar no lleva números.
- La SEP **no prescribe** registrar participación por campo. Es un insumo del juicio docente; el registro global diario que hace Fanny es válido.
- Vocabulario NEM que ya usa la plataforma: campo formativo (LEN / SAB / ETI / DHL — Fanny usa "HUM" para DHL; **estandariza a DHL** en toda la BD y UI), contenido, PDA, fase, escenario, trimestre.
- Bandas de fluidez lectora (palabras por minuto) que usa Fanny, alineadas a los Estándares Nacionales de Habilidad Lectora de la SEP (una banda por grado; "cercano al estándar" = banda del grado anterior):

| Grado | Requiere apoyo | Cercano al estándar | Estándar | Avanzado |
|---|---|---|---|---|
| 1° | < 15 | 15–34 | 35–59 | > 59 |
| 2° | < 35 | 35–59 | 60–84 | > 84 |
| 3° | < 60 | 60–84 | 85–99 | > 99 |
| 4° | < 85 | 85–99 | 100–114 | > 114 |
| 5° | < 100 | 100–114 | 115–124 | > 124 |
| 6° | < 115 | 115–124 | 125–134 | > 134 |

(Fanny usa 86 en lugar de 85 para 4°; usa la tabla completa y hazla catálogo editable, no la quemes en código.)

### 0.3 Cómo viene la información desde una planeación JISSEZ

Se revisaron `Planeacion_6G_T2_P07.pdf` (un grado) y `Planeacion_4G-5G-6G_T2_P08.pdf` (multigrado). Estructura por sesión:

- Cabecera: número de sesión, **un solo campo formativo por sesión**, momento metodológico, referencias a libros.
- Inicio / Desarrollo / Cierre. En multigrado, **Inicio y Cierre son compartidos** y **Desarrollo es diferenciado por grado** (una columna por grado).
- **Tarea para casa** — una por sesión en un grado; **una por grado** en multigrado.
- Tabla "Recursos y materiales · Producto de la sesión · Evaluación · Criterios" — **una fila por grado** en multigrado. Un producto por sesión es lo normal, pero a veces hay dos (S05 de 6°: "Texto de investigación **y** avance del mapa-cartel"; S08 de 6°: "Reglas del juego **y** cartel de invitación") y a veces cero (S12 multigrado: presentación sin criterio).
- Tabla "Grado · PDA evaluado · Criterio de evaluación" — **1 a 4 PDA por sesión por grado**, cada uno con su criterio redactado. Este es el insumo directo de `sesiones_pda` y del banco de criterios.
- Producto final del proyecto: uno por grado en multigrado (`productos_finales`).

Nota de Fanny: los maestros casi no siguen el guión Inicio/Desarrollo/Cierre; trabajan sobre el **producto de la sesión**. Por eso la unidad de captura en Mi salón es el producto, no la actividad.

**Nota Parte A (2026-09-03):** el "Producto de la sesión" del PDF no existe como dato estructurado en `dosificacion_sesiones` (la columna `productos` está vacía). El importador crea por ahora un producto genérico por grado con `origen='backfill'`; antes de lanzar Mi salón al público debe correrse el job de extracción de nombres reales sobre las filas `origen='backfill'` (revisar primero si el texto de la dosificación permite regex antes de gastar en IA), y el bot debe empezar a llenar la columna `productos` con el mismo shape de `cierre_tareas`.

---

## PARTE B — Especificación del producto

Objetivo en una frase: **el maestro captura día a día, en su teléfono, lo que ya revisa de todos modos (trabajo, tarea, asistencia, participación) y al final del trimestre la boleta, el reporte por alumno y la presentación para la junta salen solos, ligados a los PDA de la planeación.**

### B.1 Pantalla "Hoy" (flujo diario)

Orden del día para el maestro, todo en una pantalla con scroll, controles táctiles ≥ 44 px, iconos Lucide (nunca emojis), estilo Notion/Linear:

1. **Asistencia** (ya existe): lista con presente / falta / retardo / justificada.
2. **Tareas por revisar**: los `productos_sesion` con `tipo='tarea'` cuya `fecha_entrega` es hoy (o pendientes de días anteriores). Grid alumnos × tarea: chips `Entregó · Incompleta · No entregó · Justificada`. En multigrado, la lista se agrupa por grado y cada grado ve su tarea.
3. **Sesiones de hoy**: por cada sesión del día, sus productos. Grid alumnos × producto con:
   - un toque = nivel (semáforo `Logrado / En proceso / Requiere apoyo`, colores del sistema: verde `#059669`, ámbar, rojo),
   - mantener presionado o icono = `puntaje` opcional 0–10 y `retroalimentacion` (con chips rápidos configurables: "Excelente trabajo", "Incompleto", "Mejorar letra", "Revisar ortografía", "No trajo material"…),
   - estado de entrega implícito: tocar un nivel → `entregado`; chip aparte para `no_entregado / justificado / no_aplica`.
   - En multigrado con `modalidad='diferenciada'`, la lista se agrupa por grado y muestra el criterio del grado. Con `compartida`, una sola lista.
   - Botón "Agregar producto" para cuando el maestro pidió algo que no estaba en la planeación (crea `productos_sesion` con `origen='maestro'`).
4. **Cierre del día** (una sola pasada): lista de alumnos con dos toggles de tres estados: participación (`0 · 1 · 2`) y conducta (`0 · 1 · 2`). Valor por defecto `1` para ambos; el maestro solo cambia excepciones. Guarda en `registro_diario`. Opcional: chip "participación destacada" dentro de una sesión concreta, que solo pone `participacion=2` ese día.

Todo se guarda al toque (optimistic UI, upsert), sin botón "guardar". Debe funcionar en móvil con datos de red pobres: cola local en memoria y reintento.

### B.2 Máximos automáticos (elimina la fila "VALOR MÁXIMO" de Fanny)

Por alumno, campo y trimestre:

- `max_trabajos` = número de `productos_sesion` con `tipo='trabajo'`, `activo=true`, `campo=X`, cuya sesión está en el trimestre, y cuyos `grados` contienen el grado del alumno, **menos** los que ese alumno tiene en `no_aplica` o `justificado`.
- `max_tareas` = igual con `tipo='tarea'`.
- `max_asistencia` = días con sesión registrada en el trimestre menos faltas justificadas del alumno. Es global (no por campo); se muestra igual en los 4 campos como hace Fanny, pero se calcula una vez.
- `max_participacion` = `max_conducta` = días con `registro_diario` del alumno × 2.
- `max_examen` = puntaje máximo de la sección del campo en el examen trimestral (confirmado en Parte A: `banco_preguntas.campo_formativo` permite puntaje por campo).

Así en multigrado cada grado tiene sus propios máximos sin que el maestro teclee nada.

### B.3 Motor de calificación por campo

Ponderaciones en `maestro_ajustes` (jsonb `ponderacion`), valor por defecto = el de Fanny: `{tareas:25, trabajos:25, asistencia:10, participacion:5, conducta:5, examen:30}`; deben sumar 100; editables por maestro; validar en UI.

Puntaje de un producto (0–1):
- si hay `puntaje` → `puntaje/10`;
- si no, por `nivel`: `logrado=1.0`, `en_proceso=0.7`, `requiere_apoyo=0.4` (valores en `maestro_ajustes.escala_nivel`, editables);
- `incompleto` sin nivel = 0.5; `no_entregado` = 0; `justificado` / `no_aplica` = se excluye del máximo.

Porcentaje por rubro = `(suma de puntajes / máximo) × peso`. Porcentaje del campo = suma de rubros. Se recalcula en el cliente (JS) desde las tablas base, o en una vista SQL `v_resumen_trimestral` — **prefiere la vista** para que boleta, reporte y presentación lean lo mismo. Persiste el resultado en `boleta_trimestral.porcentaje` al abrir la boleta (mientras `cerrada=false`).

Conversión a calificación oficial (`maestro_ajustes.escala_boleta`, editable), default: `≥90→10, 80–89→9, 70–79→8, 60–69→7, <60→6`. Nivel para reportes internos: `≥80 logrado`, `60–79 en_proceso`, `<60 requiere_apoyo`.

### B.4 Reparto de participación y conducta a los campos

Para cada día con `registro_diario`, el valor del alumno se asigna a los campos de las sesiones trabajadas ese día, en partes iguales entre ellas (un día con sesión LEN y sesión SAB reparte 50 / 50). Días sin sesión registrada no cuentan. Resultado: porcentaje de participación por campo sin captura extra. Si el maestro no registra participación un día, ese día no entra al máximo (no penaliza).

### B.5 Evaluación formativa por PDA (lo que Fanny no podía hacer)

Cada calificación de producto se propaga a los PDA que ese producto evalúa (`producto_sesion_pda`), escribiendo/actualizando `evaluacion_formativa` con `sesion_pda_id`, `nivel` y `criterio` (texto del banco). **El maestro califica una vez y la trazabilidad se llena sola.** La pantalla de evaluación formativa existente queda para ajustar nivel por PDA cuando el maestro quiere ser más fino (un producto con 3 PDA donde el alumno logró 2).

Vista `v_avance_pda` por alumno: PDA, campo, contenido, número de evidencias, nivel predominante, tendencia (primera mitad vs segunda mitad del trimestre).

### B.6 Revisión de cuaderno y habilidades básicas

Un solo modelo para ambas cosas, evaluado por trimestre (o cuando el maestro quiera; se guarda con fecha):

```sql
CREATE TABLE public.catalogo_habilidades (
  clave text PRIMARY KEY,           -- 'cuaderno.orden', 'lectura.ppm', 'mates.fracciones'
  categoria text NOT NULL,          -- 'cuaderno' | 'lectura' | 'matematicas'
  nombre text NOT NULL,
  tipo_valor text NOT NULL CHECK (tipo_valor IN ('nivel','numero','texto')),
  orden smallint, activo boolean DEFAULT true
);
CREATE TABLE public.evaluacion_habilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maestro_id uuid NOT NULL, alumno_id uuid NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  ciclo text NOT NULL, trimestre smallint NOT NULL,
  clave text NOT NULL REFERENCES public.catalogo_habilidades(clave),
  nivel text CHECK (nivel IN ('logrado','en_proceso','requiere_apoyo')),
  valor_num numeric, valor_texto text, fecha date DEFAULT current_date,
  UNIQUE (maestro_id, alumno_id, ciclo, trimestre, clave)
);
```

Catálogo inicial = exactamente la lista de Fanny: cuaderno (orden/limpieza, fecha completa, título de actividad, letra legible, mayúsculas/minúsculas, signos de puntuación, acentuación, buen estado, orden por proyecto, respeta margen), lectura (`ppm` número, `comprension` texto o nivel), matemáticas (suma, resta, multiplicación, división, fracciones, tablas, lectura y escritura de cantidades, problemas). El maestro puede agregar criterios propios (`maestro_id` en el catálogo o tabla `catalogo_habilidades_maestro`; decidir y documentar).

Bandas PPM: tabla `bandas_ppm (grado, requiere_apoyo_max, cercano_max, estandar_max)` con los valores de §0.2; diagnóstico calculado, no capturado. **`evaluacion_diagnostica` ya cubre PPM por momento (confirmado en Parte A): no duplicar — `lectura.ppm` vive ahí y la vista lo une.**

Nota Parte A: `evaluacion_cuaderno` y `evaluacion_habilidades_basicas` (columnas fijas, momento semestral) se conservaron intactas; al construir B.6 se decide si se migran o se deprecan.

### B.7 Fortalezas, áreas de oportunidad y sugerencias automáticas

Generación en dos capas, siempre revisable por el maestro:

**Capa 1 — reglas (sin IA, instantánea), por campo y alumno:**
- Fortalezas: PDA con nivel predominante `logrado` y ≥ 2 evidencias → frase a partir del texto del PDA ("Describe los efectos del calor sobre los objetos a partir de experimentar con ellos") pasada a tercera persona si hace falta. También rubros ≥ 90 % ("Entrega puntualmente sus tareas", "Asistencia regular") y habilidades `logrado`.
- Áreas de oportunidad: PDA `requiere_apoyo` con ≥ 2 evidencias, rubros < 60 % (tareas, asistencia, participación), habilidades `requiere_apoyo`, PPM por debajo del estándar.
- Sugerencias: plantilla por tipo de área (p. ej. PPM bajo → "Practicar lectura en voz alta 10 minutos diarios"; tareas < 60 % → "Establecer un horario fijo de tarea en casa"). Catálogo `plantillas_sugerencia` editable.
- "Trabajo diario" (observación general de Fanny) se deriva: combinación de entrega de tareas y trabajos → frases tipo "Cumple con tareas y trabajos" / "No trae tareas y no termina trabajos en clase".

**Capa 2 — redacción con IA (opcional, botón "Redactar"):** manda a Claude el JSON de la capa 1 + nombre del alumno + grado y pide un párrafo por sección, en español de México, tono respetuoso para padres, sin diagnósticos clínicos ni etiquetas. Guarda en `texto_autogenerado` y copia a los campos de texto solo si `editado_manual = false`.

El maestro siempre puede editar; lo editado no se sobreescribe.

### B.8 Reportes (salidas)

Todos leen de `v_resumen_trimestral`, `v_avance_pda`, `evaluacion_habilidades`, `boleta_trimestral`. Colores del sistema NEM: LEN `#059669`, SAB `#ea580c`, ETI `#7c3aed`, DHL `#0284c7`; fuente `'Segoe UI', Arial, sans-serif`. HTML imprimible (`@media print`) → PDF desde el navegador; no depender de librerías pesadas en móvil.

1. **Boleta trimestral por alumno (oficial)**: datos del alumno y escuela, tabla campo × T1/T2/T3 con calificación 6–10 y promedio, observaciones y sugerencias por campo, firmas. Formato tipo SEP; el maestro lo entrega como complemento de la boleta SIGED.
2. **Reporte trimestral detallado por alumno** (equivale a la `Plantilla_Reporte` de Fanny, mejorada): desempeño por campo con desglose de rubros (obtenido / máximo / %), revisión de cuaderno, habilidades básicas con diagnóstico PPM, avance por PDA (nuevo), observaciones, fortalezas, áreas, sugerencias, y **retroalimentaciones destacadas** del trimestre (últimas 3–5 `retroalimentacion` no vacías).
3. **Presentación de grupo para junta de padres** (equivale a `junta_fanny_2T-3T.html`): portada; panorama (promedio del grupo por trimestre y delta en puntos porcentuales, número de alumnos que mejoraron); desempeño por grado con barras T anterior vs T actual por alumno y badge de delta; fluidez lectora por alumno contra banda de su grado; promedio por campo y grado; áreas de atención generadas por reglas (alumnos con PPM bajo, rubros < 60 %, PDA del grupo con mayoría `requiere_apoyo`). Navegación por slides con teclado y táctil. Se genera desde datos, nunca desde Excel.
4. **Reporte de avance por PDA del grupo** (nuevo): para cada PDA trabajado, distribución de niveles del grupo; sirve al maestro para decidir qué reforzar y a JISSEZ como insumo de dosificación.
5. **Exportación**: CSV/XLSX del concentrado por alumno (mismas columnas que la hoja `BD_Alumnos` de Fanny, con `DHL` en lugar de `HUM`) para maestros que quieran seguir en Excel.

### B.9 Multigrado — reglas resumidas

- `alumnos.grado` obligatorio.
- `productos_sesion.grados` y `modalidad` deciden qué ve cada alumno; un alumno solo puede calificarse en productos cuyos `grados` incluyan el suyo.
- Criterios y PDA siempre por grado (`sesiones_pda.grado`, `banco_criterios_pda.grado`).
- Máximos por grado (B.2), reportes con badge de grado y agrupación por grado (como el HTML de Fanny: 4° ámbar, 5° azul, 6° verde).
- Tridocente (bloques de 2 grados) y bidocente (bloques de 3 grados): no cambia nada del modelo, solo el número de grados en `grados`.

### B.10 Qué NO hacer

- No hagas un módulo de participación por sesión y por campo como registro obligatorio; el registro es diario y global (B.1.4). El chip por sesión es opcional.
- No calcules calificaciones con lógica duplicada en varios `.js`; una vista SQL o un solo módulo `js/motor_calificacion.js`.
- No generes textos de boleta con IA sin que el maestro los vea y pueda editarlos.
- No toques `tienda/` ni el flujo de compra.
- No uses emojis en UI; iconos Lucide.
- No inventes columnas nuevas en `evaluacion_diagnostica` para cosas de boleta.
- No conviertas semáforos a números en la boleta oficial: la boleta lleva la calificación 6–10 del motor; los semáforos son para el reporte detallado.

### B.11 Orden sugerido de implementación de la Parte B (después del GATE)

1. Vista `v_resumen_trimestral` + `maestro_ajustes.ponderacion` + pantalla de ajustes.
2. Pantalla "Hoy": tareas y productos (B.1.2–B.1.3) escribiendo en `calificaciones` con `producto_sesion_id`.
3. Cierre del día → `registro_diario` (B.1.4) y reparto (B.4).
4. Propagación a `evaluacion_formativa` (B.5) + `v_avance_pda`.
5. Habilidades y cuaderno (B.6).
6. Capa 1 de fortalezas/áreas (B.7) → boleta (B.8.1) → reporte detallado (B.8.2).
7. Presentación de grupo (B.8.3) → avance por PDA (B.8.4) → exportación (B.8.5).
8. Capa 2 IA (B.7) al final.

Cada paso se prueba en Live Server con el grupo de prueba multigrado 4°-5°-6° (importar `4G-5G-6G_T2_P08`) y con el de 6° (`6G_T2_P07`) antes de push a `main`.
