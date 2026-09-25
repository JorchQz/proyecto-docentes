# Mi salón, Parte B — Reporte final

**Para:** Jorge. **Fecha:** 24 de septiembre de 2026. **Publicado:** `mi-salon-parte-b` se unió a `main` (merge directo) y jissez.com se actualizó el 24 de septiembre, con tu autorización; las migraciones de la base se aplicaron antes y producción quedó idéntica a pruebas.

## En una frase

Mi salón quedó terminado: los diez bloques de la Parte B pasaron por revisores independientes
que lo probaron en navegador real y contra la base, y el mismo 24 de septiembre se aplicaron
todas tus decisiones de la encuesta (§4), revisadas otra vez de punta a punta. Todo el QA corre
en el **proyecto de Supabase de pruebas** (§3), no en producción.

- **Ensayo final (3.10):** pasó en su noveno intento. Un trimestre completo de un grupo 1°-2°
  como el de Fanny, por la interfaz, con los números cuadrados a mano.
- **Bloque 3.7:** se había detenido; lo reabriste y quedó terminado con una sola capa de
  lectura para toda la app.
- **Cierre del 24 de septiembre:** cuatro revisores. R1 PASS; R2 FAIL con dos defectos,
  corregidos; R3 FAIL con un defecto de redondeo, corregido; R4 PASS.
- **Acceso:** el SaaS sigue invisible para el público. Solo lo ven `soporte.jissez@gmail.com`,
  Fanny (`sarayval034@gmail.com`, sin datos, empieza desde cero) y las dos cuentas QA.
- **Datos reales en producción:** 2 alumnos y 4 asistencias (tu cuenta), igual al empezar y
  al terminar cada revisión.

---

## 1. Bloques y veredictos

Cada bloque lo revisó un subagente **nuevo**, sin contexto del constructor, con Playwright
(Chromium) y consultas de solo lectura a Supabase. La evidencia completa de cada revisión
está en `docs/PROGRESO-PARTE-B.md` y los scripts y capturas de cada revisor en
`.qa/revisor-*/` (carpeta local, fuera de git).

| Bloque | Veredicto | Intentos |
|---|---|---|
| 3.1 Cuenta y datos de QA (+ grupo activo en toda la app) | **PASS** | FAIL (emojis ⏱ ⏸ ▶ ⬇) → PASS |
| 3.2 Textos de la boleta, Capa 1 (reglas) | **PASS** | FAIL (ediciones borradas, entrega vs calidad, vaciar texto) → PASS |
| 3.3 Boleta imprimible | **PASS** | a la primera |
| 3.4 Reporte detallado por alumno | **PASS** | a la primera |
| 3.5 Presentación para la junta de padres | **PASS** | a la primera |
| 3.6 Exportación CSV / XLSX | **PASS** | a la primera |
| 3.7 Coherencia y deuda conocida | **PASS** (reabierto por Jorge el 24 de septiembre) | Se detuvo tras 8 revisiones: las tres últimas fallaron por lecturas cuyo error se ignora. Jorge pidió terminarlo con una sola capa de lectura (`js/lectura.js`), y el revisor R1 del cierre le dio PASS con 243 lecturas forzadas a fallar |
| 3.8 Redacción con IA (Capa 2) | **PASS** (apagada hasta que exista la llave) | a la primera |
| 3.9 Documentación | **PASS** | FAIL → FAIL → PASS (44 afirmaciones verificadas, ninguna falsa) |
| 3.10 Ensayo final de punta a punta | **PASS** | 7 FAIL (evidencia por PDA, cierre del día, boleta cerrada sin congelar, carreras en Diagnóstico, cierre no atómico, boleta cerrada borrable por API) → 1 sin veredicto (se cayó la base de producción) → PASS en el noveno |

**Bloque 3.7.** Se detuvo el 23 de septiembre: tres revisiones seguidas fallaron por la misma
causa (lecturas cuyo error la pantalla ignora). El 24 lo reabriste. Ahora toda lectura pasa
por `js/lectura.js` y, si falla, la pantalla dice "No se pudo cargar" con Reintentar, sin
dibujar datos parciales ni guardar. El revisor R1 forzó a fallar 243 lecturas en 26 pantallas:
0 excepciones, 0 afirmaciones falsas y 0 escrituras. Los 9 defectos que habían quedado
abiertos ya no se reproducen.

### Lo más importante que encontraron los revisores (y se corrigió)

- **Se borraban textos del maestro** al volver a generar la boleta. Guardar varias filas
  de distinta forma en un solo `upsert` hace que PostgREST ponga NULL en lo que una fila no
  trae. El mismo patrón podía borrar una **calificación confirmada**. Ahora se guarda un
  upsert por forma de fila, con una prueba que imita a PostgREST.
- **"Trabajo diario" confundía entrega con calidad.** Un alumno que entrega todo con
  calidad baja no "deja de terminar sus trabajos". El motor ahora cuenta la entrega aparte,
  sin cambiar la calificación.
- **Vaciar un cuadro a propósito no se respetaba.** Ahora lo que escribe el maestro se
  marca cuadro por cuadro y nunca se vuelve a proponer, aunque quede vacío.
- **Emojis y símbolos tipo emoji** en varias pantallas viejas. Se quitaron todos y hay
  una prueba permanente que los busca en todos los rangos.
- **Reportes con dos grupos** mandaban al onboarding (`.single()`). Ahora hay un solo
  "grupo activo" con selector en la barra, que usa toda la app.
- **Tareas con alumnos justificados** se quedaban "Por revisar" para siempre.
- **Calificaciones perdidas en silencio con volumen real.** Supabase devuelve como máximo
  1000 filas por consulta. "Hoy", Tareas e Inicio leían las calificaciones de una vez, y
  un trimestre real (unas 50 sesiones con 2 a 4 productos y 18 alumnos) pasa de 1000: la
  maestra habría visto en blanco lo que ya calificó. Ahora las tres pantallas leen por
  lotes y páginas, igual que el motor, y una prueba lo comprueba con 1080 y 7200 filas.
- **"Hoy", Inicio y Tareas no decían lo mismo** sobre lo pendiente (proyecto recién
  terminado, cierre del día con faltas o con todo el grupo ausente). Las reglas que
  comparten quedaron en un solo archivo, `js/alcance-hoy.js`.
- **La boleta cerrada no quedaba cerrada.** Primero se recalculaba en pantalla, luego el
  cierre podía quedar a medias si se caía la red, y al final la base permitía modificarla,
  borrarla y volver a insertarla desde otra pestaña o por API. Ahora el cierre es una sola
  transacción (`cerrar_boleta`) que guarda una foto de lo entregado. La base no deja
  modificar, borrar ni cerrar por fuera una boleta cerrada, y todos los documentos leen la
  foto.
- **Capturas perdidas con red lenta** en "Hoy" y Diagnóstico (recargas sin esperar la cola,
  guardados que llegaban fuera de orden). Ahora las dos pantallas guardan en serie y avisan
  si sales con algo pendiente.

---

## 2. Qué se construyó (resumen)

Detalle en `docs/PRODUCTO-MI-SALON.md` (lo construido y sus diferencias con la
especificación) y `docs/CONTEXTO.md` §3, §5.1, §6 y §7.

- **Hoy:** captura diaria (asistencia, tareas, productos con semáforo, retroalimentación,
  cierre del día) y "Trabajar hoy" para las sesiones de una planeación, que no traen fecha.
- **Motor único** de calificación con pesos 28/28/6/5/33, conversión en una sola función
  SQL con piso por fase (6 en 1°-2°, 5 en 3°-6°) y **confirmación del maestro** antes de
  cerrar.
- **Trazabilidad por PDA** automática al calificar, y la vista de avance por PDA.
- **Textos de la boleta** por reglas (fortalezas, áreas, sugerencias, trabajo diario), con
  catálogo editable de sugerencias.
- **Reportes:** boleta imprimible, reporte detallado, presentación para la junta (con
  privacidad por defecto), exportación CSV/XLSX con las columnas de la hoja de Fanny, y
  Vista Recrea y Concentrado con calificaciones confirmadas.
- **IA para redactar** (Edge Function `redactar-boleta`): lista, pero apagada.
- **Inicio** resume el día y lleva a Hoy; **Tareas** da seguimiento a las tareas de las
  sesiones.

**Migraciones aplicadas en producción (todas aditivas o sobre tablas vacías):** B.0, B.3,
B.5 (ya reportadas antes), y en esta fase `b7_plantillas_sugerencia`,
`b8_calificaciones_boleta_por_lote`, `qa_funcion_resembrar` y
`b7_plantillas_calidad_y_descripciones`, `b5c_evidencia_pda_con_todos_los_productos` `b8_cierre_boleta_atomico_inmutable` `b8_cierre_boleta_sin_borrar_ni_cerrar_por_fuera` (cierre de boleta en una transacción; una boleta cerrada no se modifica, no se borra y solo se cierra con «Cerrar boleta»), y con el cierre del 24 de septiembre `mi_salon_b9_referencias_propias_2026-09.sql`, `mi_salon_b9_diagnostica_cascada_2026-09.sql` y la semilla QA actualizada (`qa_semilla.sql`). Copia en `supabase/*.sql`.

**Edge Function nueva desplegada:** `redactar-boleta` (en producción y en el proyecto de pruebas). Sin el secreto no hace nada:
responde "no configurada".

---

## 3. Pruebas

- **34 suites automáticas** (`for t in pruebas/*.test.js; do node $t | tail -1; done`):
  todas pasan. Cubren motor, textos, boleta de punta a punta, IA y Capa 1, los cuatro
  reportes, Vista Recrea y Concentrado, Tareas, Hoy, capa de lectura, Asistencia, portal,
  referencias propias, matemáticas por grado, alta tarde y ausencia de emojis.
- **Verificaciones en navegador** (en `.qa/`, locales): recorrido de humo por las 18
  pantallas con los dos grupos, sin errores de consola; verificaciones de 3.2, de los
  pulidos, de Tareas contra Hoy y de la impresión del reporte.
- **Aislamiento entre maestros** con una segunda cuenta real: 0 filas de otro maestro en
  las 16 tablas y vistas de Mi salón; el catálogo global se lee pero no se edita.
- **Datos reales:** 18 alumnos y 404 asistencias hasta el 24 de septiembre; ese día, con tu
  permiso, se borraron los datos viejos de Fanny (respaldados). Desde entonces: 2 alumnos y 4
  asistencias (tu cuenta), y 0 proyectos, calificaciones y boletas reales, iguales al empezar
  y al terminar cada revisión.

### Incidente del 23 de septiembre y proyecto de pruebas

Ese día **la base de producción se cayó unas horas, y con ella la tienda.** La causa la
confirmamos con las gráficas que mandaste. La instancia es la más chica (plan gratuito,
0.5 GB de RAM) y en reposo ya usaba ~1.2 de ~1.26 GB de memoria comprometida. Doce horas de
revisores con navegador la pasaron del límite: swap, CPU esperando disco y, al final,
PostgREST y Auth sin responder. Se recuperó cuando reiniciaste el proyecto; los datos
reales quedaron intactos.

Para que no se repita, el QA ya no toca producción. Creamos el proyecto
**`docentes-pruebas`** (`raoxdxwgsxbqlzdnndly`) con:

- la misma estructura que producción, comparada objeto por objeto (61 tablas, 61 funciones,
  117 políticas, 12 triggers, 150 índices, permisos);
- solo los catálogos: nada de maestros reales, tienda, pedidos ni cupones;
- las dos cuentas QA;
- la función de IA sin llave.

El servidor local de QA (`node .qa/servidor.js`) sirve la app apuntando a ese proyecto sin
tocar los archivos del repo, y el navegador de pruebas bloquea cualquier petición a
producción. Tu Live Server normal sigue apuntando a producción, como siempre. Los scripts
para rehacer el proyecto de pruebas están en `.qa/`, y las cadenas de conexión, en
`.env.local`.

---

## 4. Decisiones

### Lo que decidiste el 24 de septiembre (ya construido y revisado)

| Tema | Cómo quedó |
|---|---|
| Participación y conducta | 1 (normal) y 2 (destacado) valen el rubro completo; 0 vale 0. El 2 aparece en los textos cuando casi todos los días fueron 2 |
| Alumno sin ninguna evidencia | "Elige" en los cuatro campos (juicio docente, dentro de la escala de su fase); imprimible, reporte y exportación lo indican |
| Grado después del cierre | Grado, fase, escala, estándar de PPM, rubros y avance por PDA van en la foto del cierre |
| Junta y exportación | Para alumnos con boleta cerrada usan la foto; los abiertos siguen en vivo, y la junta lo explica |
| Asistencia | Igual que "Hoy": Presente, Falta, Justificada; sin marcar = sin registro; cada toque guarda a ese alumno |
| Alumno dado de alta tarde | Solo cuenta lo que es desde su alta (pendientes, productos y examen) |
| Matemáticas por grado | Según los programas sintéticos NEM: 1° cuatro habilidades, 2° siete, 3° a 6° las ocho, cada una con su alcance; la exportación dice "No aplica" |
| Referencias propias | Ninguna fila puede apuntar a alumnos, grupos, proyectos o sesiones de otra cuenta (políticas restrictivas); el diagnóstico se borra con su alumno |
| Pixel de Meta | Fuera del SaaS; sigue en la tienda |
| Pantalla principal | `portal.html` con Mi Salón, Tienda y Sala de Maestros "Próximamente", solo para cuentas con acceso; el resto entra directo a la tienda |
| `CLAUDE.md` | Corregida la frase de `tareas`, `calificaciones` y `evaluacion_formativa` |
| Accesos | Solo `soporte.jissez@gmail.com`, Fanny y las cuentas QA. Los datos viejos de Fanny se respaldaron en `.qa/respaldos/` y se borraron |

### Auditoría normativa de la NEM (24 de septiembre, publicada)

Encargaste una investigación sobre evaluación y reportes en la NEM. Antes de cambiar nada, se
verificó contra las fuentes primarias: DOF, DGAIR, SEP, las boletas oficiales de Jalisco y la
investigación de Jalisco y otros estados. Todo está en `docs/referencia/`, local, junto con
los PDF. Lo que quedó publicado:

| Tema | Cómo quedó |
|---|---|
| Escala | 1° de 6 a 10; 2° a 6° de 5 a 10, con 5 no aprobatorio (boleta DGAIR de Jalisco, proyecto de la SCJN, guías de CDMX y Edomex) |
| Evaluación final | Final por campo (promedio de T1 a T3 confirmados, un decimal, truncado), promedio de grado y acreditación, con la nota de que el oficial lo calcula SIGED |
| Acreditación | "Acredita" si el promedio y los cuatro campos llegan a 6. Si solo el promedio llega, la maestra ve "Revisar" y la familia ve "la escuela la confirmará con control escolar" |
| Conducta | Ya no pondera; se informa aparte, como pide el art. 21 de la LGE |
| Matemáticas en 1° y 2° | Tablas como cálculo mental sin memorizar y división como reparto, según el cuaderno oficial de Fase 3 |
| Palabras por minuto | "Referencia SEP 2010", no "estándar" |
| Entidad | Se guarda el estado de cada maestra; las reglas son nacionales hasta que un estado difiera |
| Trimestre | Se cambia en Mi grupo, con una sugerencia del calendario SEP 2026-2027 |
| Nada sin confirmar | Una calificación que queda fuera de la escala (por ejemplo, si se cambia el grado) vuelve a "Elige" y no se puede cerrar |
| Privacidad y seguridad | "Eliminar cuenta" funciona, también en la tienda (con compras, se escribe a soporte); el registro de la tienda pide solo nombre, correo y contraseña; el perfil del comprador ya se guarda; jissez.com ya no publica los archivos internos; el Pixel ya no está donde viaja el token de recuperación |

Revisiones: R5, R6 y R7 dieron FAIL, un defecto cada una, todos corregidos. R8 dio PASS.

### Lo que sigue pendiente

0. **Boleta real de Fanny.** Pídele una foto de una boleta del ciclo pasado, de 2° a 6°, con los
   promedios finales y "Promovido". Con eso se confirma si SIGED trunca o redondea y cómo saca el
   promedio de grado. También sirve una consulta por escrito a Control Escolar de la SEJ
   (33 3030 7500).
0. **Aviso de privacidad:** el borrador está en `docs/legal/`, con marcadores para llenar.
   Revísalo con un abogado antes de publicarlo.
0. **CCT en los materiales:** con el registro corto ya nadie lo captura. Si lo quieres en la
   marca de agua, se puede agregar como dato opcional en Mis compras o en Mi cuenta.

1. **IA para redactar:** falta que crees el secreto `ANTHROPIC_API_KEY` (recordatorio el
   sábado 26). Costo estimado: ~0.05 USD por boleta.
2. **Servidor de producción:** en reposo usa casi toda su memoria. Decidiste no subirlo por
   ahora; si vuelve a caer, es lo primero.
3. **`mates.calculo_mental`:** el programa lo pide en los seis grados; agregarlo cambia el
   formato de la exportación. Conviene validarlo con Fanny.
4. **`CLAUDE.md`, flujo de entrada:** todavía dice index → dashboard; ahora es login → portal.
   No lo cambié sin tu visto bueno.
5. **Ya conocidos, sin cambio:** "retardo" en asistencia; pantalla para editar el catálogo de
   sugerencias; criterios propios por maestro; nombres genéricos de productos del importador;
   editar un proyecto en curso sin perder capturas; los exámenes dependen de que el generador
   los cree (hoy el rubro de examen se reparte).
6. **Detalles que notaría una maestra** (de los revisores, sin bloquear):
   - la asistencia de referencia se muestra con tres redondeos (66.6 %, 67 % y 66.7);
   - la junta puede bajar un punto al cerrar una boleta (promedia la foto truncada);
   - Mi grupo quita números y acentos de los nombres;
   - en "Hoy" los productos del importador tienen nombres genéricos;
   - el primer toque del cierre del día pone 1 y 1 a todo el grupo;
   - volver a tocar la opción marcada la quita en Asistencia pero no en "Hoy";
   - el saludo dice "Docente" en el portal y el nombre del perfil en Inicio;
   - la boleta tarda de 3 a 5 s en Reportes.

---

## 5. Prueba en 10 minutos (tú, con la cuenta de QA)

Cuenta: **qa.misalon@jissez.com** (la contraseña está en `.env.local` de tu equipo; no va
en git). Antes de empezar, si quieres datos frescos: `select qa.resembrar();` en el SQL
Editor (solo toca la cuenta QA). Levanta el sitio con Live Server (o
`node .qa/servidor.js`) y entra por `tienda/login.html`.

1. **Hoy** (`hoy.html`, 2 min): marca asistencia a dos alumnos, califica un producto de la
   sesión con el semáforo y abre "Detalle" para escribir una retroalimentación. En el
   recuadro "¿Trabajarás otra sesión hoy?", pulsa "Trabajar hoy" en una: aparece con sus
   productos para calificarlos.
2. **Cambio de grupo** (30 s): menú de la barra → "QA 3°-4° (Fase 4)". Todo cambia a ese
   grupo.
3. **Boleta** (3 min): Reportes → pestaña Boleta → "QA EMILIO NAVA (en riesgo)", T1 →
   Generar. Mira el selector de calificación: permite 5 (Fase 4). Edita un cuadro de
   texto, pulsa "Generar boleta" otra vez y recarga la página: tu texto sigue ahí con
   "(tuyo)". Pulsa "Confirmar calificaciones" y luego "Boleta para imprimir": la boleta
   muestra los números confirmados; los demás alumnos dicen "pendiente".
4. **Reporte detallado** (1 min): desde la misma pestaña, "Reporte detallado": rubros con
   obtenido, máximo y %, fluidez contra la banda de su grado y avance por PDA.
5. **Junta** (1 min): encabezado de Reportes → "Presentación para la junta". Flechas del
   teclado para avanzar; sin nombres por defecto.
6. **Exportar** (1 min): "Exportar concentrado (CSV / Excel)" → "Descargar Excel (XLSX)". Abre el archivo: hoja
   Concentrado con las columnas de la hoja de Fanny, más Máximos y Léeme.
7. **Vista Recrea** (30 s): pestaña Vista Recrea → T1 → Generar: Emilio con números; el
   resto "pendiente".

Si quieres ver aislamiento: entra con `qa.aislamiento@jissez.com` (contraseña también en
`.env.local`) y confirma que no ves nada de la cuenta QA.

---

## 6. Mi opinión: ¿listo para `main`?

**Sí.** Lo decidiste así: el SaaS sale a `main` pero sigue invisible para el público. Solo
Fanny y soporte tienen acceso, y ella lo prueba al menos dos semanas antes de abrirlo.

**A favor:**
- El recorrido completo de una maestra pasó revisiones independientes una y otra vez, con los
  números cuadrados a mano.
- Una boleta cerrada no cambia por ningún camino.
- Lo que la ley pide está respetado: la maestra confirma, la asistencia no pondera y los pisos
  van por fase.
- Las lecturas fallidas ya no engañan ni escriben.
- Las migraciones son aditivas y se revisaron en producción antes de aplicarse: 0 referencias
  cruzadas y 0 huérfanos.

**Lo que vigilaría:**
- **Fanny empieza en blanco.** Su primera entrada la lleva al portal y de ahí a crear su grupo.
- **La memoria del servidor de producción:** si la tienda vuelve a caer, subir el cómputo es lo
  primero.
- **Los detalles de §4:** la opinión de Fanny sobre ellos es lo que más vale ahora.
