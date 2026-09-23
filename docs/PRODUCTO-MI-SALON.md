# Mi salón — Producto (Parte B)

**Estado (2026-09-23):** la Parte B está construida en la rama `mi-salon-parte-b` y cada
bloque pasó por un revisor independiente (detalle, evidencia y veredictos en
`docs/PROGRESO-PARTE-B.md` y `docs/REPORTE-FINAL-PARTE-B.md`). **No está en `main`:** el
merge y el despliegue los decide Jorge.

Este documento describe **lo que realmente se construyó**. La especificación original de
Jorge (2026-09-03) sigue siendo la referencia del porqué; donde lo construido se aparta de
ella se dice aquí y se explica. Datos y tablas: `docs/CONTEXTO.md` §6.

---

## 0. Contexto: por qué existe Mi salón

### 0.1 Lo que hace hoy una maestra sin Mi salón (caso real: Fanny, multigrado)

Se analizaron sus archivos `Base_de_datos_inicial.xlsx` (T2), `Base_de_datos_final.xlsx`
(T3) y la presentación `junta_fanny_2T-3T.html`. Su flujo:

1. Un Excel por campo formativo con la lista de alumnos repetida en cada uno.
2. Al final del trimestre concentra todo en la hoja `BD_Alumnos`: por campo (LEN, SAB, ETI,
   HUM) `Tareas`, `Trabajos`, `Asist.`, `Part.`, `Cond.`, `Examen` como **conteos**, con una
   fila "VALOR MÁXIMO DEL TRIMESTRE" escrita a mano; cuaderno (10 criterios semáforo);
   habilidades básicas (PPM, comprensión, 8 de matemáticas); `Trabajo diario`,
   `Fortalezas` y `Áreas de oportunidad` redactadas a mano.
3. La hoja `Plantilla_Reporte` calcula por campo con pesos fijos (incluida la asistencia).
4. Sube los Excel a una IA para armar la presentación de la junta de padres.

**Lo que Mi salón elimina:** captura al final del mes; asistencia, participación y conducta
copiadas idénticas a los 4 campos; máximos tecleados a mano; ningún vínculo con los PDA ni
con los productos de cada sesión; textos escritos desde cero; cero retroalimentación.

**Lo que conserva de su formato:** la fórmula ponderada por campo, el semáforo de tres
niveles, la revisión de cuaderno, las habilidades básicas, las observaciones con fortalezas
y áreas, y la presentación trimestre a trimestre para la junta.

### 0.2 Marco normativo (Acuerdo 10/09/23 de la SEP)

- **Escala por fase** (art. 9): Fase 3 (1°–2°) enteros de **6 a 10**; Fases 4 y 5 (3°–6°)
  enteros de **5 a 10**, donde 5 no acredita. Lo impone la base de datos (trigger
  `boleta_trimestral_piso_fase`), no solo la pantalla.
- **La asistencia no pondera** (art. 7 I d): se muestra como dato de referencia en todos
  los reportes, nunca como parte de la calificación.
- **Juicio docente** (art. 4 XI): el sistema **propone** la calificación; la oficial es la
  que el maestro **confirma**. Sin confirmar no se puede cerrar la boleta (trigger
  `boleta_trimestral_confirmacion`) y todos los reportes muestran "pendiente".
- La boleta lleva observaciones y sugerencias por campo formativo. Mi salón es
  **complemento** de la boleta oficial (SIGED), no la sustituye, y así lo dice en pantalla.
- Campos: LEN, SAB, ETI y **DHL** (Fanny escribe HUM; se estandarizó a DHL en todo).
- Bandas de fluidez lectora por grado: tabla `bandas_ppm` (editable, no quemada en código).

### 0.3 Cómo llega la información desde una planeación JISSEZ

Cada sesión trae un campo formativo, momento, actividades (compartidas o por grado en
multigrado), tarea, producto y PDA con criterio por grado. El importador y la creación de
proyectos materializan `sesiones_pda`, `productos_sesion` y `producto_sesion_pda`
(`js/sesiones-materializar.js`). La unidad de captura en Mi salón es el **producto**, no la
actividad.

---

## Parte B — lo construido

Objetivo: **el maestro captura día a día lo que ya revisa y al final del trimestre la
boleta, el reporte por alumno, la presentación para la junta y la exportación salen
solos, ligados a los PDA de la planeación.**

### B.1 Pantalla "Hoy" (`hoy.html`, `js/hoy.js`)

Una pantalla con scroll, controles de 44 px o más, sin emojis:

1. **Asistencia**: Presente / Falta / Justificada.
2. **Tareas por revisar**: productos tipo tarea que vencen hoy, más las de días anteriores
   que tengan algún alumno sin revisar. Entregó / Incompleta / No entregó / Justificada.
   En multigrado, agrupadas por grado.
3. **Sesiones de hoy**: por producto, semáforo Logrado / En proceso / Requiere apoyo por
   alumno; "Detalle" abre puntaje 0–10 opcional (manda sobre el semáforo) y
   retroalimentación con frases rápidas. "Agregar producto" para lo que no venía en la
   planeación. Solo aparecen los alumnos de los grados del producto.
4. **Cierre del día**: participación y conducta 0 · 1 · 2 por alumno (valor normal 1; solo
   se tocan excepciones) → `registro_diario`. Al tocar la primera excepción se guarda el día
   de todo el grupo (1 y 1 para los demás, sin contar a quienes faltaron); si no hay
   excepciones, el botón "Guardar el cierre de hoy". Marcar una falta después retira el
   cierre que se había puesto por defecto. Si faltó todo el grupo no hay cierre que guardar
   ("Nadie asistió hoy") y el día no queda pendiente en Inicio.

Una tarea sin fecha de entrega vence el siguiente día hábil después de su sesión (se
revisa en la próxima clase, no el mismo día).

**Trabajar hoy / Quitar de hoy.** Las sesiones de una planeación no traen fecha; "Hoy"
ofrece las siguientes pendientes del proyecto activo y "Trabajar hoy" les pone la fecha de
hoy (así entran a la captura, al reparto de participación y al rango de asistencia).
"Quitar de hoy" las regresa sin fecha y pendientes mientras no tengan calificaciones ni
estén completadas.

Todo se guarda al tocar (cola en memoria con reintento), sin botón de guardar.

*Diferencia con la especificación:* no hay "retardo" en asistencia (agregarlo es una
decisión de producto pendiente para Jorge).

### B.2 Máximos automáticos

El motor calcula por alumno, campo y trimestre cuántos productos le tocaban (por su
grado), sin contar los justificados, los "no aplica" ni los que aún no se revisan. Nadie
teclea máximos. La asistencia no es rubro (no pondera; §0.2), así que no tiene máximo en
la fórmula: se reporta aparte como referencia.

### B.3 Motor de calificación (`js/motor-calificacion.js`, único)

- Rubros y pesos por defecto **28 / 28 / 6 / 5 / 33** (tareas, trabajos, participación,
  conducta, examen), editables por maestro en Ajustes (`maestro_ajustes.peso_*`). Si un
  rubro no tiene datos, su peso se reparte entre los que sí tienen.
- Valor de un producto: puntaje/10 si hay puntaje; si no, por nivel (logrado 1,
  en proceso 0.7, requiere apoyo 0.4); incompleto sin nivel 0.5; no entregado 0;
  justificado / no aplica fuera del máximo.
- El examen por campo es **aproximado** (el banco no guarda el valor de cada pregunta) y
  así se rotula en los reportes que lo muestran (boleta en pantalla, reporte detallado,
  junta y exportación).
- Conversión a calificación: **una sola función SQL** `calcular_calificacion_boleta`
  (≥90→10, ≥80→9, ≥70→8, ≥60→7, ≥50→6, si no 5; y nunca por debajo del piso de la fase).
  Para grupos, `calcular_calificaciones_boleta` hace lo mismo por lote.
- El motor también cuenta la **entrega** aparte de la calidad (esperados, entregados,
  completos): la usan los textos; no cambia la calificación.
- Un solo camino de carga para un alumno y para todo el grupo (lectura paginada).
- Un campo **sin evidencias** en el trimestre no tiene propuesta: en la boleta se elige su
  calificación a mano (juicio docente, dentro de la escala) para poder confirmar y cerrar.
  Una boleta cerrada queda fija en todos los reportes: calificación y porcentaje del
  cierre, los textos guardados (también los generales) y el trabajo diario tal como se
  entregó, aunque después cambien las capturas o el diagnóstico. No se puede reabrir desde
  la interfaz.

*Diferencias:* no hay vista `v_resumen_trimestral`; la regla B.10 permitía "una vista SQL o
un solo módulo" y se eligió el módulo, con la conversión en SQL. La escala de conversión no
es editable por maestro: los pisos son norma. La asistencia no pondera (la especificación
original le daba 10 %).

### B.4 Reparto de participación y conducta

El valor diario del alumno se reparte en partes iguales entre los campos con sesión ese
día; un día sin sesión o sin registro no entra al máximo.

### B.5 Evaluación formativa por PDA

Calificar un producto deja evidencia en los PDA que evalúa (triggers
`propagar_calificacion_a_pda` y `retirar_evidencia_de_pda` sobre `calificaciones`,
`origen = automatico`); el ajuste fino del maestro queda con `origen = maestro` y no se
pisa. La evidencia de un PDA en una sesión se recalcula con **todas** las calificaciones
del alumno ligadas a ese PDA (`recalcular_evidencia_pda`): manda la del trabajo o producto
(la más baja si hay varias) y la de la tarea solo cuenta si no hay otra. La vista `v_avance_pda` (security_invoker) da por alumno y PDA: evidencias, conteo
por nivel, nivel predominante y tendencia. Se ve en Reportes → "Avance por PDA" (por alumno
o de todo el grupo).

### B.6 Cuaderno y habilidades básicas

Viven en `evaluacion_diagnostica` (momento `trimestre_1..3`): cuaderno y matemáticas como
listas clave → nivel, PPM y comprensión. La pantalla abre en el trimestre actual del grupo
("T1 · boleta"), que es el que lee la boleta; "Inicio de ciclo" queda aparte. Las claves y etiquetas están en un solo lugar
(`js/catalogo-habilidades.js`); la fluidez se calcula contra `bandas_ppm`, no se captura.

*Diferencias:* no se crearon `catalogo_habilidades` ni `evaluacion_habilidades`: la
diagnóstica ya existía y se dejó como fuente única (B.0). El maestro todavía no puede
agregar criterios propios.

### B.7 Fortalezas, áreas y sugerencias

**Capa 1 — reglas** (`js/textos-boleta.js`), por campo y una fila general:

- PDA con 2 o más evidencias: logrado → fortaleza (el texto del PDA, recortado en una
  cláusula completa); requiere apoyo → área ("Necesita apoyo para lograr: «…»").
- **Hábitos, por entrega** y en la fila general: tareas entregadas y trabajos terminados
  sumando todos los campos (≥90 % fortaleza, <60 % área). No se mezclan con la calidad.
- **Calidad de lo entregado** (con al menos 2 entregados) y **examen**, por campo. Si la
  misma frase aplicaría a varios campos, va una sola vez en la fila general nombrándolos.
- Participación y conducta (registro global) solo en la fila general; el valor normal del
  día (1 de 2) no es área.
- Lectura (PPM contra la banda del grado, comprensión) → Lenguajes; matemáticas → Saberes;
  cuaderno y asistencia (solo observación) → general.
- **Trabajo diario** sale de la entrega de tareas y trabajos, nunca de la calidad.
- Máximo 4 frases por sección, prioridad a lo que habla del aprendizaje, sin repetir la
  misma idea; cada sugerencia corresponde a un área que sí quedó.
- Sugerencias desde el catálogo editable `plantillas_sugerencia` (global; lo edita el
  administrador).

**Lo que escribe el maestro manda**, cuadro por cuadro: al editar un cuadro se marca en
`texto_autogenerado.editados` y ya no se vuelve a proponer, aunque lo deje vacío. "Volver
a proponer" (con aviso) es la única forma de reemplazarlo.

**Capa 2 — redacción con IA** (Edge Function `redactar-boleta`, botón "Redactar con IA"):
reescribe la propuesta de la Capa 1 en párrafos para las familias. La llave vive solo como
secreto del servidor (`ANTHROPIC_API_KEY`); **sin ese secreto el botón no aparece**.
No se envía el nombre del alumno (el servidor pone el nombre de pila). Guarda en
`texto_autogenerado.ia` y solo copia a los cuadros que el maestro no escribió; la Capa 1
no pisa lo redactado por la IA al reabrir la boleta. Hoy el secreto no existe: está
construido detrás de esa bandera.

### B.8 Reportes

Todos leen de la misma capa (`js/reporte-datos.js`): motor único, calificación oficial =
la confirmada, textos del maestro o propuesta, diagnóstico y bandas. Colores NEM: LEN
`#059669`, SAB `#ea580c`, ETI `#7c3aed`, DHL `#0284c7`. Imprimibles con `@media print`.

1. **Boleta imprimible** (`boleta.html`): datos del alumno y la escuela, campo × T1/T2/T3
   con la calificación confirmada o "pendiente" y promedio de lo confirmado, asistencia de
   referencia, observaciones y sugerencias por campo, cuaderno y habilidades, firmas.
   Carta vertical.
2. **Reporte detallado** (`reporte-alumno.html`): rubros con obtenido / máximo / % y peso,
   calificación confirmada o propuesta rotulada, cuaderno, PPM contra la banda, avance por
   PDA, observaciones y las últimas retroalimentaciones del trimestre.
3. **Junta de padres** (`junta.html`): portada, panorama, barras por grado, fluidez contra
   la banda, promedio por campo y grado, áreas de atención y cierre. Con un solo
   trimestre no hay deltas. **Privacidad:** en pantalla los alumnos aparecen por número de
   lista y grado (en la lámina de fluidez, sin nombres, ni siquiera el número de lista); los
   nombres solo con un interruptor (apagado por defecto) y las áreas de atención siempre
   agregadas.
4. **Avance por PDA** (Reportes → "Avance por PDA").
5. **Exportación** (`exportar.html`): CSV y XLSX con las columnas de `BD_Alumnos` (DHL),
   la calificación confirmada por campo y la asistencia como referencia. El XLSX trae las
   hojas "Máximos" y "Léeme" (advierte no recalcular con una plantilla que pondere la
   asistencia).

Además, en `reportes.html`: **Vista Recrea** (calificación confirmada por alumno y campo,
lista para capturar en SIGED, con "pendiente" en lo no confirmado) y **Concentrado
Director** (niveles por promedio de las 4 calificaciones confirmadas, pendientes aparte y
promedio por grado y campo).

### B.9 Multigrado y grupo activo

Un alumno solo se califica en productos cuyos `grados` incluyen el suyo; PDA, criterios y
máximos por grado. Con dos o más grupos, el maestro elige el grupo en el menú de la barra
(`js/grupo-activo.js`) y toda la app usa ese grupo.

### B.10 Coherencia

- **Inicio** (`dashboard.html`) resume el día y lleva a "Hoy"; ya no captura asistencia
  ni revisa tareas en el formato viejo.
- **Tareas** (`tareas.html`) es seguimiento de los productos tipo tarea (cuándo vencen,
  cuántos alumnos faltan); la revisión se captura en "Hoy". La tabla vieja `tareas` ya no
  se escribe. Un alumno cuenta como revisado con cualquier estado de entrega (también
  justificado o no aplica), igual que en "Hoy" y en el motor.
- **Mismo alcance en Hoy, Inicio y Tareas** (`js/alcance-hoy.js`): "Hoy" e Inicio miran los
  proyectos activos, en borrador o pausados, los del trimestre actual del grupo y los que
  tienen `fecha_final` en los últimos 30 días (o futura); Tareas lista todas las tareas del
  grupo y marca "Quedó sin revisar" las que "Hoy" ya no muestra. Así la tarea de la última sesión de un proyecto recién terminado sigue en "Hoy"
  hasta revisarse, y las tres pantallas coinciden en qué falta. En el mismo archivo viven
  la cuenta del cierre del día (igual en Hoy e Inicio) y la lectura por lotes y páginas que
  evita perder calificaciones cuando un trimestre pasa de 1000 filas.
- Una sola fórmula (motor) y una sola conversión (SQL) en todo el sistema.

### B.11 Qué NO hacer (sigue vigente)

- Participación por sesión y por campo como registro obligatorio (el registro es diario y
  global).
- Calcular calificaciones fuera del motor o convertir porcentaje a calificación en JS.
- Textos con IA que el maestro no vea ni pueda editar; poner la llave en el frontend.
- Tocar `tienda/` o el flujo de compra. Emojis en la UI.
- Columnas nuevas en `evaluacion_diagnostica` para cosas de boleta.
- Mostrar como oficial una calificación que el maestro no confirmó.

---

## Pendiente y decisiones para Jorge

La lista vigente vive en `docs/PROGRESO-PARTE-B.md` ("Decisiones pendientes para Jorge") y
en el reporte final. Resumen: escala de participación y conducta (el 1 diario cuenta como
50 %), catálogo de sugerencias sin pantalla de edición, secreto de la IA, "retardo" en
asistencia, criterios propios de cuaderno y habilidades, y el nombre de productos que
vienen del importador con `origen = 'backfill'`.
