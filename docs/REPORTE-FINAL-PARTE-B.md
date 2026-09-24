# Mi salón, Parte B — Reporte final

**Para:** Jorge. **Fecha:** 24 de septiembre de 2026. **Rama:** `mi-salon-parte-b`
(sin push a `main` ni merge: lo decides tú).

## En una frase

La Parte B quedó construida completa. Cada bloque pasó por un revisor independiente, que
lo probó en navegador real y contra la base. Los datos reales no se tocaron (18 alumnos y
404 asistencias, igual que al empezar). Quedan decisiones de producto que son tuyas.

**El ensayo final (3.10) pasó** en su noveno intento, el 24 de septiembre. El revisor recorrió
por la interfaz un trimestre completo de un grupo 1°-2° como el de Fanny y lo esencial de
Fase 4. Encontró los números cuadrados a mano, 180 marcas de "Hoy" iguales entre pantalla y
base, las boletas cerradas idénticas por md5 después de cambiarlo todo y 25 vías por API
contra una boleta cerrada rechazadas. Ese ensayo corrió en un **proyecto de Supabase de
pruebas**, no en producción (ver §3). El bloque 3.7 quedó detenido y es decisión tuya (ver
abajo).

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
| 3.7 Coherencia y deuda conocida | **DETENIDO** | 8 revisiones; las tres últimas fallaron por la misma causa (lecturas cuyo error se ignora), y la misión manda detener el bloque. Detalle abajo |
| 3.8 Redacción con IA (Capa 2) | **PASS** (apagada hasta que exista la llave) | a la primera |
| 3.9 Documentación | **PASS** | FAIL → FAIL → PASS (44 afirmaciones verificadas, ninguna falsa) |
| 3.10 Ensayo final de punta a punta | **PASS** | 7 FAIL (evidencia por PDA, cierre del día, boleta cerrada sin congelar, carreras en Diagnóstico, cierre no atómico, boleta cerrada borrable por API) → 1 sin veredicto (se cayó la base de producción) → PASS en el noveno |

**Bloques detenidos: 3.7.** La regla de la misión es detener un bloque que falla tres veces
seguidas por la misma causa, y eso pasó: los FAIL #6, #7 y #8 fueron lecturas de Supabase
cuyo error la pantalla ignora (si la lectura falla, la pantalla cree que no hay nada y lo
dice, o guarda encima). Cada ronda se corrigió y la siguiente encontró la capa de abajo. Lo
que sí quedó probado: en ~190 casos de lectura fallida en 21 pantallas, las pantallas que
capturan (Hoy, Tareas, Asistencia, Diagnóstico, Formativa, Exámenes, Ajustes, Reportes y
los cuatro reportes) avisan y ninguna intentó escribir. Lo que queda abierto: la lectura
del grupo activo en error (varias pantallas no la atrapan), Mi grupo ("Eliminar grupo" dice
0 alumnos si falla el conteo), Inicio si falla el proyecto activo, una regresión en
Diagnóstico al desmarcar, una carrera en Asistencia al cambiar de fecha, y algunos guardados
fallidos o salidas con pendientes sin aviso. La lista completa y la propuesta de
solución de fondo (una sola capa de lectura para todas las páginas) están en
`docs/PROGRESO-PARTE-B.md`, sección "Bloques detenidos". **Es una decisión tuya** si se
hace ese cambio transversal antes del merge.

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
`b7_plantillas_calidad_y_descripciones`, `b5c_evidencia_pda_con_todos_los_productos` `b8_cierre_boleta_atomico_inmutable` y `b8_cierre_boleta_sin_borrar_ni_cerrar_por_fuera` (cierre de boleta en una transacción; una boleta cerrada no se modifica, no se borra y solo se cierra con «Cerrar boleta»). Copia en `supabase/*.sql`.

**Edge Function nueva desplegada:** `redactar-boleta` (v3). Sin el secreto no hace nada:
responde "no configurada".

---

## 3. Pruebas

- **22 suites automáticas** (`for t in pruebas/*.test.js; do node $t | tail -1; done`):
  todas pasan. Cubren motor, textos, boleta de punta a punta, IA y Capa 1, los cuatro
  reportes, Vista Recrea y Concentrado, Tareas, Hoy y ausencia de emojis.
- **Verificaciones en navegador** (en `.qa/`, locales): recorrido de humo por las 18
  pantallas con los dos grupos, sin errores de consola; verificaciones de 3.2, de los
  pulidos, de Tareas contra Hoy y de la impresión del reporte.
- **Aislamiento entre maestros** con una segunda cuenta real: 0 filas de otro maestro en
  las 16 tablas y vistas de Mi salón; el catálogo global se lee pero no se edita.
- **Datos reales:** 18 alumnos y 404 asistencias, y 0 proyectos, calificaciones y
  boletas, al empezar y al terminar cada bloque (el último conteo, el 24 de septiembre
  después del ensayo final).

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

## 4. Decisiones pendientes para ti

En cada caso se eligió lo más conservador y el sistema funciona así mientras decides.

1. **Participación y conducta.** El valor normal del día es 1 de 2 y el motor lo cuenta
   como 50 % del rubro (6 % y 5 % de la calificación). Un alumno "normal" pierde parte de
   esos pesos. *Hoy:* la calificación no se cambió; los textos tratan el 1 como normal.
2. **Redacción con IA.** Para activarla hay que crear el secreto `ANTHROPIC_API_KEY` en
   las Edge Functions de Supabase y decidir quién paga el consumo (modelo
   `claude-opus-5`, esfuerzo bajo, una llamada por boleta). No se envía el nombre del
   alumno. No hay límite por maestro (solo 30 s entre redacciones de la misma boleta).
3. **Catálogo de sugerencias** (`plantillas_sugerencia`): es global y hoy solo se edita
   por SQL como administrador; falta una pantalla.
4. **Privacidad en la junta.** Por defecto, número de lista y grado; nombres solo con un
   interruptor. Las áreas de atención van siempre agregadas y en la fluidez, sin nombres,
   ni siquiera va el número de lista. Un revisor sugiere poder ocultar las diapositivas por
   alumno en grupos muy chicos.
5. **Pixel de Meta en el SaaS.** Está en todas las páginas con barra y recibe la URL
   completa, que en los reportes lleva el id del alumno. Recomendación: dejarlo solo en
   `tienda/`.
6. **"Retardo" en asistencia:** no existe (sería decisión de producto).
7. **Habilidades de matemáticas por grado:** en 1°-2° la boleta muestra multiplicación,
   división, fracciones y tablas como "No evaluada" (el catálogo, como la hoja de Fanny,
   no dice a qué grados aplican).
8. **Criterios propios** de cuaderno y habilidades por maestro: no existen todavía.
9. **Productos con nombre genérico** (`origen='backfill'`) del importador: sigue pendiente
   el trabajo de enriquecerlos (ya estaba anotado desde la Parte A).
10. **`CLAUDE.md`** decía que la Parte B no se construye sin tu permiso. Lo actualicé
    en la rama (solo llega a `main` si haces el merge): dice que la Parte B está construida
    en `mi-salon-parte-b`, que el merge lo decides tú y que las decisiones nuevas de
    producto o legales siguen necesitando tu visto bueno. Revísalo antes del merge.
    Un revisor encontró además una frase desactualizada en su tabla de datos: dice que
    `tareas`, `calificaciones` y `evaluacion_formativa` se materializan al cerrar
    sesiones. Hoy `tareas` está en desuso (0 filas, nadie la escribe), `calificaciones`
    se escribe en "Hoy" al tocar cada producto y `evaluacion_formativa` la llena un
    trigger al calificar (más el ajuste del maestro). No la cambié porque `CLAUDE.md` es
    tuyo; sugiero ese texto.
11. **Editar un proyecto en curso.** "Crear proyecto" en modo edición guarda borrando y
    volviendo a crear las sesiones, y el borrado en cascada se llevaría productos,
    calificaciones y evidencias. *Hoy:* un proyecto que ya se está trabajando se abre solo
    para consulta (no se puede guardar). Falta decidir cómo editarlo sin perder nada (por
    ejemplo, actualizar sesión por sesión en lugar de borrar y recrear).
12. **Boleta cerrada y lo que no es boleta.** La boleta cerrada queda fija en todos sus
    documentos, pero la junta y las columnas de rubros de la exportación siguen mostrando
    los datos de hoy. *Hoy:* así está documentado (la junta no es la boleta). Decide si
    también deben congelarse.
13. **Ausentes y cierre del día.** Un alumno que faltó sigue contando como "sin calificar"
    en los productos del día, y el primer toque del cierre guarda 1 y 1 también a quien no
    tiene asistencia capturada (se asume presente). *Hoy:* sin cambio.
14. **La casilla sin marcar en "Asistencia".** En `asistencia.html` (la pantalla vieja de
    lista) una casilla sin marcar se guarda como falta, y cada toque guarda a todo el
    grupo; en "Hoy" un alumno sin marcar queda sin registro. *Hoy:* se dejó como estaba
    (solo se protegió contra lecturas fallidas y el retiro del cierre se limita a faltas
    marcadas). Decide si debe comportarse como "Hoy".
15. **Alumno sin ninguna evidencia en el trimestre** (por ejemplo, uno que llegó tarde). Sus
    cuatro campos salen "—" y no se puede confirmar ni cerrar su boleta. En cambio, un solo
    campo sin evidencias ofrece "Elige" (juicio del docente). *Hoy:* sin cambio. Decide si
    ese alumno también debe poder recibir la calificación por juicio docente.
16. **Cambiar el grado de un alumno después de cerrar su boleta** cambia en la imprimible el
    grado, la fase, la escala y el estándar de PPM. Esos datos se leen en vivo, no de la foto
    del cierre. Es un caso raro y fuera del criterio del ensayo. *Hoy:* sin cambio.
17. **Seguridad de datos entre alumnos.** Las políticas de la base revisan que la fila sea
    del maestro (`maestro_id`), pero no que el alumno también lo sea. Un maestro podría
    crear, con su propia cuenta, filas ligadas al id de un alumno ajeno (el revisor lo hizo
    con `cerrar_boleta`). No ve ni cambia nada del otro maestro, pero quedan filas basura, y
    si la boleta quedó cerrada no se pueden borrar hasta borrar al alumno. Es un patrón de
    todas las tablas, así que lo propongo como mejora aparte: revisar en cada política que
    el `alumno_id` sea del mismo maestro.
18. **Tamaño de la instancia de producción.** En reposo usa casi toda su memoria. Con 4
    maestros activos en el SaaS y la tienda en la misma base, un pico de uso real podría
    repetir la caída del 23. Subir el cómputo (requiere el plan Pro de Supabase) es una
    decisión de costo tuya. Mientras tanto, el QA ya no la carga.
19. **Detalles que notaría una maestra** (del último ensayo, sin bloquear):
    - a un alumno dado de alta tarde, "Hoy" le muestra como pendientes todas las tareas
      pasadas;
    - un "trabajo diario" escrito en una pestaña vieja se guarda en Diagnóstico, aunque ya
      no entra a la boleta cerrada;
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

**Sí, para un piloto controlado con Fanny, después de que hagas tú la prueba de 10 minutos.
No para abrirlo a todos todavía.**

**A favor:**
- El recorrido completo de una maestra de 1°-2°, de crear el proyecto a exportar, pasó una
  revisión independiente sin excepciones en consola.
- Los números cuadran a mano.
- Lo que la ley pide está respetado: la maestra confirma, la asistencia no pondera y los
  pisos van por fase.
- Una boleta cerrada ya no cambia por ningún camino.
- Todas las migraciones ya están en producción y son aditivas, así que el merge solo cambia
  pantallas.

**Lo que pesaría antes de abrirlo:**

1. **El bloque 3.7 quedó detenido.** Las pantallas que capturan avisan cuando una lectura
   falla y no escriben encima. Pero varias pantallas secundarias (selector de grupo, Mi
   grupo, Inicio) todavía pueden mostrar "vacío" en vez de "no se pudo leer". Con buena
   conexión no se nota; con la red de una escuela rural, sí. Te recomiendo hacer la capa de
   lectura única antes de sumar más maestros. Para un piloto con Fanny es un riesgo
   aceptable si ella sabe que un "no hay datos" raro se arregla recargando.
2. **Un merge a `main` se publica solo en jissez.com** y cambia las pantallas de los 4
   maestros reales que hoy tienen acceso al SaaS (entre ellas `asistencia.html` y el
   Inicio). Conviene avisarles o hacerlo en un horario tranquilo.
3. **Decide antes del merge** el Pixel de Meta en el SaaS (punto 5) y revisa el cambio a
   `CLAUDE.md` (punto 10).
4. **La instancia de producción está al límite de memoria** (punto 18). No depende de la
   Parte B, pero es lo que más probablemente tumbe la tienda otra vez.

Si lo haces así (prueba tuya, avisar a los 4 maestros, piloto con Fanny y después la capa de
lectura), el riesgo es bajo y el beneficio para Fanny es inmediato.
