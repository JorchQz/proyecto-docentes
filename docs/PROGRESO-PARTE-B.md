# Progreso — Mi salón Parte B (modo autónomo)

Memoria de la misión `docs/MISION-PARTE-B.md`. **Al retomar una sesión, leer esto primero** y
seguir desde el último bloque con PASS.

- Rama: `mi-salon-parte-b` (sin push, sin merge).
- Servidor local: `http://localhost:5500` (si no responde: `node .qa/servidor.js`).
- Cuenta de QA: `qa.misalon@jissez.com`; contraseña en `.env.local` (ignorado por git).
- Herramientas de QA en `.qa/` (ignorado por git): `navegador.js` (Playwright, login real),
  `humo.js` (recorre todas las pantallas), `motor-real.js` (motor real contra la base real
  con la sesión de QA).
- Semilla de QA: `supabase/qa_semilla.sql` (idempotente, solo toca la cuenta QA).
- Datos reales que no deben cambiar: 18 alumnos y 404 asistencias fuera de la cuenta QA;
  0 proyectos, calificaciones, boletas, diagnósticos y registros diarios reales.
- **Desde el 2026-09-24 el QA corre contra el proyecto Supabase de pruebas `docentes-pruebas`
  (`raoxdxwgsxbqlzdnndly`)**, no contra producción: misma estructura (61 tablas, 61 funciones,
  117 políticas, 12 triggers, 150 índices, permisos iguales, comparado objeto por objeto),
  catálogos copiados, las dos cuentas QA con sus grupos y la función `redactar-boleta` sin
  llave. El servidor local reescribe al vuelo la dirección de producción por la de pruebas
  (el repo no cambia) y el ayudante de navegador corta cualquier petición a producción.
  Scripts para rehacerlo en `.qa/` (extraer-estructura, aplicar-estructura, copiar-catalogos,
  crear-cuentas-qa, verificar-proyecto-pruebas).

## Bloques

| Bloque | Estado | Revisor | Commit |
|---|---|---|---|
| 3.1 Cuenta y datos de QA (+ grupo activo, adelantado de 3.7) | **PASS** | FAIL #1 (emojis) → **PASS** revisor #2 | ver `git log` |
| 3.2 B.7 Capa 1 (fortalezas, áreas, sugerencias, trabajo diario) | **PASS** | FAIL #1 revisor #2 → **PASS** revisor #3 (32b) | (commit al cerrar la ronda) |
| 3.3 B.8.1 Boleta imprimible | **PASS** | revisor 33b | (commit al cerrar la ronda) |
| 3.4 B.8.2 Reporte detallado | **PASS** | revisor 33b | (commit al cerrar la ronda) |
| 3.5 B.8.3 Junta de padres | **PASS** | revisor 35b | (commit al cerrar la ronda) |
| 3.6 B.8.5 Exportación CSV/XLSX | **PASS** | revisor 35b | (commit al cerrar la ronda) |
| 3.7 Coherencia y deuda | **DETENIDO** (3 FAIL seguidos por la misma causa) | FAIL #1 37b (Tareas: justificados) → FAIL #2 37c (proyecto terminado) → FAIL #3 37d (cierre con faltas) → FAIL #4 37e (lecturas sin paginar en Hoy/Tareas/Inicio; todo el grupo ausente) → FAIL #5 37f (lecturas sin paginar en Reportes: 2.º seguido por esa causa) → FAIL #6 37g (causa nueva: lecturas con error ignoradas) → FAIL #7 37h (misma causa) → FAIL #8 37i (misma causa: 3.º seguido) → **DETENIDO** (ver "Bloques detenidos") | — |
| 3.8 B.7 Capa 2 (IA) | **PASS** (detrás de bandera: falta el secreto) | revisor 37b | (commit de la ronda) |
| 3.9 Documentación | **PASS** | FAIL #1 revisor 39 → FAIL #2 39b → **PASS** revisor 39c | d39ccfe y siguiente |
| 3.10 Ensayo final | **PASS** | FAIL #1 revisor 310 (PDA, cierre del día, boleta sin evidencias, diagnóstico, Inicio) → FAIL #2 310b (excepción en Crear proyecto; boleta cerrada no congelada) → FAIL #3 310c (semáforo y diagnóstico de la boleta cerrada; Hoy perdía capturas al recargar) → FAIL #4 310d (carrera en Diagnóstico) → FAIL #5 310e (guardados de Diagnóstico fuera de orden) → FAIL #6 310f (cierre no atómico; base sin proteger lo cerrado) → FAIL #7 310g (borrar y reinsertar lo cerrado: misma causa, 2.º seguido) → 310h SIN VEREDICTO (base de producción caída) → **PASS** revisor 310i (proyecto de pruebas) | ver `git log` |

## 3.1 Cuenta y datos de QA

**Plan.** Cuenta de maestro exclusiva para QA creada por el API de auth, con perfil
`activo_saas`. Semilla idempotente con dos grupos multigrado (1°-2° Fase 3 y 3°-4° Fase 4),
4 alumnos por grado con perfiles a propósito (sobresaliente, en riesgo, irregular con
justificados, PPM bajo), 12 sesiones pasadas + 2 de hoy, PDA reales del catálogo, trabajos
diferenciados por grado, tareas compartidas, asistencia, cierres del día, diagnóstico y un
examen por grado.

**Adelantado de 3.7 (bloqueaba la aceptación).** El navegador real mostró que con dos
grupos Reportes mandaba al onboarding (`.single()`). Se creó `js/grupo-activo.js`, único
lugar que decide el grupo, con selector en el menú de la barra; lo usan las 12 pantallas
que antes elegían "el primer grupo" cada una a su manera.

**Hallazgos del constructor, ya corregidos.**
- `planeacion.js` ordenaba por `proyectos.updated_at`, columna inexistente: la lista de
  proyectos nunca cargaba (HTTP 400).
- 45 emojis en el SaaS (dashboard, planeación, marketplace, tareas, crear proyecto,
  examen) → iconos SVG o texto.
- "Hoy" mostraba todas las tareas vencidas aunque ya estuvieran revisadas.

**Revisión #1 de 3.1: FAIL.** Criterio central cumplido (piso 6 en 2°, 5 en 4°, datos y
aislamiento correctos), pero quedaban emojis visibles (⏱ ⏸ ▶ ⬇): la primera limpieza solo
buscaba el rango clásico de emoji. Corregido y blindado con `pruebas/sin-emojis.test.js`
(rangos completos). Menores también corregidos: porcentaje con un decimal (49.86 % se veía
"50 %" junto a un 5), la boleta ya no guarda filas vacías ni dice "el sistema propone"
sin propuesta, el selector de grupo aparece en todas las pantallas (Ajustes y Mi cuenta
no lo tenían), `entrego` coherente con el estado, número de lista alfabético en la
semilla. La semilla es ahora `select qa.resembrar();` (esquema `qa`, no expuesto al API,
sin permiso para `authenticated`) y trae 3 sesiones pendientes sin fecha.

**Revisión #2 de 3.1: PASS** (revisor nuevo, `.qa/revisor-b/`). Evidencia: cuenta
confirmada y contraseña fuera de git (`git log -S` sin coincidencias); 2 grupos × 8
alumnos, 272 calificaciones, 192 asistencias, 164 cierres, 16 diagnósticos, 4 exámenes;
Juan Mena (2°) 6/6/7/6 con selector 6-10 y Emilio Nava (4°) 5/5/7/5 con selector 5-10,
iguales a `calcular_calificacion_boleta`; un 5 para 2° lo rechaza el servidor (23514);
15 pantallas × 2 grupos sin excepciones, sin `console.error` y sin emojis; `qa.resembrar()`
solo ejecutable por `postgres`; datos reales intactos (18 alumnos, 404 asistencias).

**Anotado para 3.7.**
- `dashboard.js` guarda asistencia con `onConflict: "alumno_id,fecha"` pero la restricción
  única es `(grupo_id, alumno_id, fecha)` (fallaría con 42P10), y toma el proyecto activo
  sin filtrar por grupo.
- **Hueco de flujo (bloqueante para uso real): ningún flujo asigna `sesiones.fecha`.**
  Crear proyecto, importar, iniciar proyecto y el Dashboard trabajan por
  `estado_sesion = 'activa'`; "Hoy", el reparto de participación y el rango de asistencia
  del motor trabajan por fecha. Una maestra real vería "Hoy" vacío. La semilla de QA lo
  tapaba porque pone fechas por SQL. Solución prevista: en "Hoy", "Trabajar hoy" sobre las
  siguientes sesiones pendientes del proyecto activo (pone `fecha = hoy` y la activa).
- `tareas.html` lee la tabla vieja `tareas` (se llena al cerrar sesión en el Dashboard),
  no los productos tipo tarea.

**Preparado en `.qa/staging/` (se pasa a `js/` al terminar la revisión de 3.1):**
- `textos-boleta.js` v2: participación y conducta solo en la fila general, el 1 diario
  como normal, prioridad al recortar, sugerencias del catálogo `plantillas_sugerencia`.
- `motor-calificacion.js` con `cargarYCalcularGrupo` (un solo camino para alumno y grupo;
  idéntico al actual en 32 alumnos-trimestre reales) y lectura paginada.
- Migraciones aditivas ya aplicadas: `plantillas_sugerencia`, `calcular_calificaciones_boleta`.

## 3.2 Corrección tras el FAIL #1 (revisor #2)

- **B1 (bloqueante): la edición del maestro se borraba al regenerar.** Causa: un solo
  `upsert` con filas de distinta forma; PostgREST usa la unión de columnas y a la fila
  que no trae una le pone NULL. El mismo patrón podía dejar en NULL una calificación
  confirmada. Arreglo: `upsertPorForma` en `js/reportes.js` (un upsert por forma de fila)
  en los guardados numérico y de textos.
- **B2 (bloqueante): trabajo diario y "terminar trabajos" salían de la calidad.** El
  motor ahora cuenta la ENTREGA aparte (`rubros.tareas/trabajos.entrega`: esperados,
  entregados, completos, calidad de lo entregado) sin cambiar la calificación. Los
  hábitos (tareas entregadas, trabajos terminados) se miden por entrega y van a la fila
  general; la calidad de lo entregado es otra frase y exige al menos 2 entregados; una
  frase que aplicaría a varios campos va una vez a la fila general nombrándolos.
- **B3 (bloqueante): vaciar un cuadro no se respetaba.** Marca por cuadro
  (`texto_autogenerado.editados`, `TextosBoleta.esEditado`): lo escrito por el maestro se
  respeta aunque esté vacío, y los otros dos cuadros del campo siguen recibiendo
  propuestas. Lo usan la boleta en Reportes, `ReporteDatos.textoSeccion` (boleta
  imprimible, reporte detallado, exportación) y la función de IA.
- Menores: PDA recortado en la última coma (sin "…a partir de."); asistencia sin afirmar
  causas; sugerencia de PDA en plural si son varios; porcentaje truncado a un decimal
  (49.97 ya no se lee "50.0 %"); cuadros de texto que crecen con su contenido;
  "Quitar de hoy" regresa la sesión a pendiente; descripciones del catálogo alineadas
  y clave nueva `calidad` (migración `b7_plantillas_calidad_y_descripciones`); el
  servidor local ya no entrega archivos ocultos (`.env.local`) y solo escucha en
  127.0.0.1.
- Verificación propia en navegador: `node .qa/verificar-32.js` (22 comprobaciones, todas OK).

**Revisión #3 de 3.2: PASS** (revisor nuevo, `.qa/revisor-32b/`). Evidencia: edición de
dos cuadros de Juan (Fase 3) y Mateo (Fase 4) sobrevive a regenerar y recargar, con
`editados` por cuadro y los demás cuadros intactos; vaciar "Sugerencias" generales se
respeta también en `boleta.html`; con el motor real, entregar todo con calidad baja da
"Cumple…" y la calidad sale aparte; confirmación de Emilio intacta ante un guardado de
formas mezcladas (dos upserts, el de la confirmada sin columna `calificacion`); 16
alumnos: sobresalientes 9 fortalezas y 0 áreas, en riesgo con sugerencia en cada sección
con áreas, PPM bajo con la sugerencia de lectura; catálogo de 13 claves usado de verdad;
segunda cuenta sin acceso; 0 errores de consola; datos reales intactos.
Menores del revisor (se atienden al cerrar la ronda): PDA cortado dentro de una
enumeración ("sistemas óseo."); trabajo diario vaciado no se respeta y su guardado
cambia la fecha del diagnóstico; guardado solo al salir del cuadro; `esc()` sin comillas;
los reportes prefieren la propuesta guardada sobre la recién calculada.

## 3.3–3.6 Reportes (B.8)

**Plan.** Capa de datos compartida `js/reporte-datos.js` (motor único, calificación
oficial = la confirmada, textos del maestro o propuesta de la Capa 1, diagnóstico y
bandas). Cuatro constructores en paralelo, cada uno con sus propios archivos:
`boleta.html` + `js/boleta.js`, `reporte-alumno.html` + `js/reporte-alumno.js`,
`junta.html` + `js/junta.js`, `exportar.html` + `js/exportar.js`, cada uno con su prueba
en `pruebas/`. Reglas comunes en `.qa/briefs/reportes-comun.md`.

- Boleta imprimible: carta vertical en 2 hojas, "pendiente" en todo lo no confirmado,
  aviso de complemento de SIGED, sin escrituras en la BD (registro de peticiones).
- Exportación: 54 columnas en el orden de BD_Alumnos (DHL en vez de HUM), obtenidos del
  motor, calificación confirmada o "pendiente", asistencia solo como referencia; XLSX con
  hojas "Concentrado", "Máximos" y "Léeme" (advierte no recalcular con una plantilla que
  pondere la asistencia). Cuadra con el motor en 224 celdas por grupo y trimestre.

**Revisión de 3.3 y 3.4: PASS** (revisor 33b, `.qa/revisor-33b/`). Evidencia: rubros de
T1 recalculados en SQL por el revisor y coincidentes al decimal (Ana LEN 81.8 %, Juan
19.3/20.5/61.3/22.1 → 6/6/7/6 por el piso, Emilio 5/5/7/5); PPM contra `bandas_ppm`, PDA
contra `v_avance_pda` y retroalimentaciones en el mismo orden que la base; "pendiente" en
todo lo no confirmado (incluidas propuestas guardadas sin confirmar); confirmadas
ajustadas por el docente (Ana LEN 6, Regina ETI 5) con promedio general solo con los 4
campos; PDF carta 2 páginas (boleta) y 6 (reporte) sin cortes; 0 errores de consola y 0
escrituras desde las dos páginas; sin scroll horizontal a 390/800/1280 px; la segunda
cuenta ve "No se encontró a este alumno" y 0 filas.
Menor atendido después del PASS: el reporte detallado impreso mostraba la propuesta sin
confirmar (rotulada); ahora impreso dice "pendiente" y la propuesta queda solo en
pantalla para el docente (`.qa/verificar-reporte-impresion.js`).
Menores anotados para Jorge: habilidades de matemáticas que no aplican a 1°-2° salen "No
evaluada"; el Pixel de Meta está en todas las páginas del SaaS y recibe la URL con el id
del alumno; `boleta_trimestral.updated_at` no se actualiza en UPDATE (sin trigger).

**Revisión de 3.5 y 3.6: PASS** (revisor 35b, `.qa/revisor-35b/`). Evidencia: T1
recalculado por el revisor en SQL sin el motor (pesos 28/28/6/5/33): promedios por
alumno, grado (68.5 / 67.3), grupo (67.9) y por campo idénticos a la junta; áreas de
atención contadas a mano contra la base (lectura 6/8, tareas 2/8, trabajos 2/8, examen
3/8 rotulado aproximado, participación 2/8, convivencia no aparece porque 50 % es lo
normal); "5 de 8 con calificación confirmada" igual a la base; un solo trimestre sin
deltas; navegación con teclado, botones, deslizar real (CDP) y pantalla completa; PDF 9
páginas carta horizontal; nombres ocultos por defecto y áreas siempre agregadas.
Exportación: 54 columnas, las 49 de BD_Alumnos en el mismo orden con DHL; CSV (BOM,
CRLF) y XLSX idénticos; 832 celdas recalculadas por el revisor con 0 diferencias;
calificación confirmada (incluidos ajustes del docente) o "pendiente" aunque haya
propuesta guardada; segunda cuenta sin acceso aun forzando el grupo en localStorage.
Menores atendidos al cerrar la ronda: en la fluidez de la junta, sin nombres, ya no se
muestra el número de lista y los puntos van de menor a mayor (en grupos chicos el número
identificaba a quien caía en la franja baja); el examen se exporta con dos decimales.
Anotados: grado como número (1) y no "1°"; máximos solo en el XLSX.

## 3.7 Coherencia (preparado)

- `js/reportes-grupo.js` (nuevo, con `pruebas/reportes-grupo.test.js`): Vista Recrea y
  Concentrado Director leen la calificación **confirmada** de `boleta_trimestral`; lo no
  confirmado dice "pendiente" (la propuesta solo aparece rotulada). Se quitan
  "Todos los trimestres" y las columnas sueltas de participación y conducta.
- `tareas.html` + `js/tareas.js` (en staging): seguimiento de los productos tipo tarea
  (la tabla vieja `tareas` está vacía y ya nadie la escribe); filtro de grado según el
  grupo; la revisión se captura en Hoy.
- Inicio (`dashboard.js`, en staging): resume el día y lleva a Hoy; ya no captura
  asistencia ni escribe la tabla vieja `tareas` (su upsert usaba un `onConflict` que no
  existe en la base).
- Auditoría: todas las demás escrituras con `onConflict` coinciden con un índice único
  real; los `.single()` que quedan son por id.
- Migraciones de esta fase copiadas al repo: `supabase/mi_salon_b7_b8_2026-09.sql` y
  `supabase/qa_semilla.sql` (ahora la función `qa.resembrar()`, idéntica a la aplicada).
- WhatsApp de la boleta: solo manda calificaciones confirmadas ("pendiente" en lo demás).

## 3.8 Capa 2 con IA (preparado)

- Edge Function `redactar-boleta` desplegada (v1). `estado` dice si existe el secreto
  `ANTHROPIC_API_KEY`; hoy **no existe** → `configurada: false` y el botón no aparece.
  `redactar` lee la propuesta de la Capa 1 desde `texto_autogenerado` (con la sesión del
  maestro, RLS), la manda sin el nombre del alumno (el modelo escribe `{nombre}` y el
  servidor pone el nombre de pila), guarda en `texto_autogenerado.ia` y copia a los
  cuadros solo si `editado_manual = false`. Sin llave responde 503; sin sesión, 401.
- Frontend (staging de `reportes.js`): botón "Redactar con IA" solo si la función dice
  `configurada`; marca "(redactado con IA)"; la Capa 1 ya no pisa lo redactado por la IA
  al reabrir la boleta (solo "Volver a proponer"). Prueba: `boleta-ia.test.js` (en
  staging hasta promover).

**Revisión de 3.7: FAIL #1** (revisor 37b, `.qa/revisor-37b/`). Todo el bloque pasó salvo
un defecto: en `tareas.html` un alumno "Justificada" no contaba como revisado, así que las
tareas S4 y S8 (4 entregado, 2 justificado, 2 no entregado) quedaban "Por revisar" para
siempre mientras "Hoy" ya las daba por revisadas. Lo demás, con evidencia: Vista Recrea y
Concentrado cuadran uno a uno con `boleta_trimestral` (16 alumnos, promedios y ajustes del
docente), Inicio sin captura y con "Tu día" igual a la base, 19 pantallas × 2 grupos sin
errores ni redirecciones, 0 filas de formato viejo y ninguna conversión fuera de la
función SQL.
Corrección: `situacionDe` en `js/tareas.js` cuenta cualquier estado de entrega (también
justificado y no aplica), igual que "Hoy" y el motor; prueba `pruebas/tareas-situacion.test.js`
y `.qa/verificar-37.js` (toda tarea "Por revisar" aparece en "Hoy"; S4 y S8 "Revisada",
en los dos grupos). Menores atendidos: comentario del orden en Tareas; en el Concentrado la
columna por grado dice "x de y con las 4 confirmadas"; "Hoy" ya no ofrece "Quitar de hoy"
en una sesión terminada. Menor anotado (limitación): el plan de Inicio muestra solo las
sesiones del proyecto activo más reciente.

**Revisión #2 de 3.7: FAIL #2** (revisor 37c, `.qa/revisor-37c/`), por otra causa. El
defecto de los justificados quedó corregido (reproducido por la interfaz con S12). Nuevo:
"Hoy" solo leía proyectos activos o en borrador; al terminar la última sesión desde Inicio
el proyecto pasa a "completado" y su tarea (125 de 134 proyectos del bot traen tarea en la
última sesión) y sus productos pendientes desaparecían de "Hoy", mientras Tareas los seguía
pidiendo con "Revisar en Hoy". Lo demás del bloque pasó con evidencia (Vista Recrea y
Concentrado contra `boleta_trimestral` con ajustes del docente, Inicio igual a "Hoy", 19
pantallas × 2 grupos sin errores, 0 filas de formato viejo, regresión de los pulidos OK).
Corrección: una sola regla de alcance, `js/alcance-hoy.js` (proyectos activos, en
borrador o pausados, del trimestre actual del grupo, o terminados en los últimos 30 días),
que usan "Hoy", Inicio y Tareas; "Trabajar hoy" sigue exigiendo proyecto activo. Tareas
solo ofrece "Revisar en Hoy" si "Hoy" la va a mostrar y, si no, lo explica. "Tu día" en
Inicio cuenta también las tareas por revisar con la misma lógica que "Hoy". Concordancia
en Tareas ("1 entregó", "2 justificadas"). Pruebas `pruebas/alcance-hoy.test.js` y
`.qa/verificar-37b.js` (proyecto recién terminado: la tarea sigue en Hoy, Tareas ofrece el
botón, Inicio la cuenta; proyecto viejo de otro trimestre: ninguno la pide).

**Revisión #3 de 3.7: FAIL #3** (revisor 37d, `.qa/revisor-37d/`). Los dos defectos
anteriores quedaron corregidos (reproducidos por la interfaz). Nuevo, introducido por el
cambio del cierre del día de 3.10: "Hoy" ya no espera el cierre de quien faltó, pero Inicio
seguía contando sobre todos ("7 de 8" en ámbar sin forma de ponerlo en verde).
Las tres causas son distintas (no aplica el tope de 3 por la misma causa), pero son de la
misma familia: Hoy, Inicio y Tareas contando lo pendiente con reglas distintas. Por eso,
además de corregir, audité "Tu día" contra "Hoy" renglón por renglón:
- Cierre: Inicio usa la misma regla (sin quienes faltaron) y la misma frase; en verde
  cuando está completo. Concordancia "1 que faltó".
- Productos por calificar: los dos cuentan como calificado el semáforo, el estado de
  entrega o el puntaje (antes un puntaje solo contaba distinto).
- Tareas: Inicio mira las mismas sesiones que "Hoy" (también tareas con fecha de entrega
  en sesiones sin fecha); "Hoy" dice "N alumnos sin revisar" y Tareas/Inicio cuentan tareas,
  con la unidad explícita.
- Tareas: una tarea de un proyecto que "Hoy" ya no mira sale "Quedó sin revisar" (con la
  razón y filtro propio), nunca "Por revisar".
Verificado con `.qa/verificar-cierre-inicio.js`, `.qa/verificar-37b.js`, humo y las 18
suites. Menores anotados: terminar una sesión solo se puede desde Inicio y solo la de hoy
del proyecto activo más reciente; con dos proyectos activos, "Trabajar hoy" de Hoy e Inicio
no ordenan igual.

**Revisión #4 de 3.7: FAIL #4** (revisor 37e, `.qa/revisor-37e/`). Lo de los FAIL #1-#3
quedó corregido. Dos defectos:
1. (bloqueante, causa nueva) Hoy, Tareas e Inicio leían las calificaciones con una sola
   consulta. Supabase corta a 1000 filas en silencio y un trimestre real (decenas de
   productos por 18 alumnos) pasa de 1000: la maestra vería en blanco lo ya calificado.
2. (misma familia que el FAIL #3) Si falta todo el grupo, "Hoy" daba el cierre por
   guardado ("0 de 0", botón deshabilitado) e Inicio lo dejaba en ámbar.
Conteo honesto para la regla de los 3 FAIL: las causas técnicas fueron cuatro distintas
(justificados, alcance, cierre con faltas, paginación), pero el defecto 2 es la variante
extrema del FAIL #3 y los cuatro tienen la misma raíz: tres pantallas que calculaban lo
mismo por separado. Por eso la corrección no parcha cada pantalla, junta las reglas en
`js/alcance-hoy.js`, un solo lugar que usan las tres:
- `leerPorLotes(ids, construir)`: parte los ids en lotes de 150 y lee cada lote en
  páginas de 1000. Hoy (productos y calificaciones), Tareas (sesiones, tareas y
  calificaciones) e Inicio (sesiones, productos y calificaciones) leen así. Si una
  lectura falla, "Hoy" lo dice (antes se quedaba en blanco en silencio) e Inicio muestra
  "no se pudieron leer; ábrelos en Hoy" sin tirar el resto de la pantalla.
- `resumenCierre(total, esperados, guardados)`: la misma cuenta y la misma frase en las
  dos pantallas. Si faltó todo el grupo, "Nadie asistió hoy: no hay cierre que guardar" en
  Hoy y "nadie asistió hoy" en verde en Inicio. Un grupo sin alumnos no se da por cerrado.
Menores del revisor que también se corrigieron: "Hoy" ya no cambia `calificaciones.fecha`
al editar una calificación vieja (la fecha es la del día de captura; `evaluado_en` guarda
el último cambio), y el grupo inicial tiene desempate estable (nombre, id) cuando dos
grupos tienen el mismo `created_at`. Quedan anotados sin cambio: `pisoFase` repetido en JS
(el SQL manda) y el camino legacy del motor (solo para datos anteriores a Parte B).
Pruebas: `pruebas/alcance-hoy.test.js` (1080 y 7200 calificaciones, lotes ≤150, sin
duplicados, error no silencioso, las seis variantes del cierre); `.qa/verificar-37c.js`
en navegador (las tres pantallas piden offset/limit=1000 y lotes ≤150; con todo el grupo
ausente Hoy e Inicio dicen lo mismo y no se guarda cierre; datos restaurados);
verificar-37, verificar-37b, verificar-cierre-inicio, humo y las 18 suites en verde.

**Revisión #5 de 3.7: FAIL #5** (revisor 37f, `.qa/revisor-37f/`; lo cortó el límite de
la API y se reanudó con su contexto). Los cuatro FAIL anteriores quedaron corregidos: con
un PostgREST simulado con tope de 1000 y relleno (2600 calificaciones, 1300 productos),
Hoy, Inicio y Tareas dan lo mismo con y sin relleno, piden `offset` 0/1000/2000 y ningún
lote pasa de 150 ids; por la interfaz, siete pasos (tarea sin revisar, proyecto recién
terminado, faltas, todo el grupo ausente, cierre) dicen lo mismo en las tres pantallas.
Bloqueante, **misma causa que el FAIL #4** (lectura sin paginar) en otras pantallas:
Reportes → Asistencia (1080 asistencias simuladas: la tabla sumaba 1000) y Avance por PDA
del grupo (1120 filas: 120 renglones con un alumno de menos).
Conteo para la regla de los 3 FAIL: son **dos seguidos por la misma causa** (#4 y #5). Por
eso esta vez no corregí solo lo señalado: audité todas las lecturas de `js/` (67 sin tope
explícito), medí el volumen real de las dudosas y encontré tres más que se cortan con uso
real: el catálogo de PDA en Crear proyecto para una escuela unitaria de 1° a 6° (1329
filas; medido contra el Supabase real: sin paginar llegan 1000), las respuestas de un
examen (alumnos × preguntas) y las sesiones de Actividades (crecen ciclo con ciclo).
Corrección: `js/leer-todo.js` (`LeerTodo.paginas` / `porLotes`) en Reportes (asistencia y
avance del grupo), Crear proyecto (catálogo de PDA y contenidos), Exámenes (respuestas) y
Actividades; la prueba `pruebas/lecturas-sin-tope.test.js` revisa el código y falla con
cualquier lectura nueva de una tabla que crece que no vaya paginada ni esté en la lista de
acotadas con su razón (con el código anterior detecta las 7). Evidencia: la simulación
del revisor (`.qa/constructor-37/reportes-tope.js`) da 1080 de 1080 y 1120 de 1120, sin
errores; `.qa/verificar-leer-todo.js` contra el Supabase real, 1329 de 1329.
Menores corregidos: "Hoy" ya no dibuja las secciones si falla la carga (mensaje y
recargar); Inicio cuenta la asistencia solo de alumnos activos.
**Falla mía de partición:** durante esta revisión corrí `.qa/verificar-cierre-boleta.js`,
que escribió sobre un alumno del grupo 1°-2° asignado al revisor (cerró su boleta y cambió
sus tareas por unos segundos antes de restaurarlas). El revisor lo detectó y lo aisló de
su veredicto. Desde aquí, mientras haya un revisor trabajando, no escribo en su partición.

**Revisión #6 de 3.7: FAIL #6** (revisor 37g, `.qa/revisor-37g/`). Lo que habría detenido el
bloque (tercera vez la misma causa) **no apareció**: revisó las 93 lecturas de `js/`, simuló
PostgREST con tope y relleno en 19 pantallas × 2 grupos (36 lecturas de más de 1000 filas
se leyeron completas; las 15 que se cortaron son las acotadas por naturaleza) y midió el
tope real. FAIL #1-#5 reproducidos y corregidos. **Causa nueva:** "Hoy" e Inicio ignoraban
el error de tres lecturas (asistencias, registro_diario, proyectos): decían "nada
pendiente" y, con `registro_diario` en error, el cierre del día pisó en la base el 2 de
participación de una alumna con 1 y 1. Igual que con la paginación, no corregí solo lo
señalado: busqué en toda la app lecturas cuyo error se ignora antes de una escritura y
encontré rutas de pérdida peores:
- **Crear proyecto en modo edición** ("Ver sesiones" de un proyecto activo): guardar borra
  las sesiones y las vuelve a crear; el borrado en cascada se lleva productos,
  calificaciones y evidencias. Con la lectura de sesiones en error guardaba una lista
  vacía. → No se guarda si las sesiones no se pudieron leer, ni si el proyecto ya se está
  trabajando (sesiones con fecha o en curso, o calificaciones): esa pantalla queda de
  consulta. **Decisión pendiente para Jorge:** cómo editar un proyecto en curso sin perder
  nada.
- **Diagnóstico:** con la lectura del alumno en error, el primer toque sobrescribía todo su
  diagnóstico. → No guarda y lo dice.
- **Boleta de Reportes:** con `boleta_trimestral` en error, la propuesta se guardaba encima
  de la calificación confirmada y de los textos del maestro. → Toda lectura (boleta,
  diagnóstico, avance por PDA) se hace antes de escribir; si una falla, no se guarda nada.
- **Evaluación formativa, Exámenes y Ajustes:** con la lectura en error, la captura salía
  vacía (o los pesos de fábrica) y se capturaba encima. → Avisan y no dejan capturar.
- "Hoy" (todas sus lecturas, incluida la de alumnos, que decía "no tiene alumnos") e
  Inicio (asistencia/cierre y tareas: "no se pudieron leer").
Menores atendidos: la prueba `lecturas-sin-tope` ahora exige el filtro exacto de cada
lectura acotada (con `.gte("fecha")` ya no pasa; comprobado con una mutación) y revisa
`banco_criterios_pda`, `dosificacion_sesiones` y `dosificacion_proyectos` (catálogo del
marketplace, ahora paginado); marcar una falta en `asistencia.html` retira el 1 y 1 del
cierre como en "Hoy"; la cola de "Hoy" ya no descarta una captura tras 4 intentos.
Anotados: el motor y `reporte-datos` usan `.in("sesion_id")` sin lotes (revienta con 400
visible entre 500 y 700 sesiones por trimestre; el uso real es ~50); semilla QA con
`proyectos.fase` en null.
Pruebas nuevas: `pruebas/lecturas-con-error.test.js` (Hoy con cada una de sus 7 lecturas
en error y la boleta con cada una de sus 3: avisan y no escriben; con el código anterior
fallan). En navegador, `.qa/verificar-310d.js`: con `registro_diario`, `asistencias` o
`proyectos` en error (500 simulado) Hoy e Inicio lo dicen y no hay escrituras; un proyecto
en curso no se puede guardar ni forzando el clic.

**Revisión #7 de 3.7: FAIL #7** (revisor 37h, `.qa/revisor-37h/`). FAIL #1-#6 no reaparecieron
(barrido de 150 casos pantalla × tabla con 500: Hoy, Tareas, boleta, reporte, junta,
exportar, Formativa, Exámenes y Ajustes avisan y no escriben; red lenta en "Hoy" sin
pérdidas; Hoy/Inicio/Tareas coinciden). **Misma causa que el FAIL #6** (lecturas cuyo
error se ignora) en pantallas que quedaban: Asistencia (un toque tras una lectura fallida
guardó "ausente" a 6 presentes y borró su cierre), Crear proyecto en edición (con el
catálogo en error borraba los PDA de las sesiones), los pesos del maestro en el motor (con
error calculaba con los de fábrica y guardaba esa propuesta), el aviso de Diagnóstico que
se ocultaba y Inicio con la lectura de alumnos en error; más dos de otra causa: la carrera
de Diagnóstico al cambiar de alumno y guardados que fallaban sin aviso.
**Conteo para la regla de los 3 FAIL:** son dos seguidos por la misma causa (#6 y #7). Por
eso la corrección ya no es por pantalla: la prueba nueva
`pruebas/lecturas-revisan-error.test.js` revisa las 91 lecturas de `js/` y falla si alguna
ignora su error sin una razón escrita (`lectura-opcional:`; hoy solo 2: el nombre del
saludo de Inicio y las sugerencias de criterio de Crear proyecto) o sin decir dónde se
revisa (`error-revisado-en:`). Con ella se corrigieron las 13 que quedaban: motor
(pesos), ReporteDatos (perfil, bandas, sugerencias, proyectos de las retroalimentaciones),
Reportes (alumnos; bandas y sugerencias ahora se leen antes de guardar la boleta), boleta
imprimible (alumno ajeno), Inicio (alumnos), el candado de acceso (ya no manda a la tienda
si solo falló la lectura del perfil: dice "No se pudo comprobar tu acceso" y ofrece
reintentar). Además: Asistencia no guarda nada tras una lectura fallida (y su estado se
declaraba después del arranque, lo que borraba el aviso: corregido), Crear proyecto no
guarda sin catálogo y vuelve a comprobar "en curso" AL GUARDAR antes de cualquier
escritura, Diagnóstico liga el formulario al alumno que muestra y bloquea los controles
al cambiar, y los guardados fallidos avisan (Diagnóstico no cambia de alumno si no pudo
guardar; "Cerrar boleta" no cierra con un cuadro sin guardar; cuadros y trabajo diario se
reintentan). Menores: Diagnóstico ya no reescribe la fecha sin cambios; Asistencia solo
lista alumnos activos y solo retira el cierre de faltas marcadas; el aviso de "Eliminar
proyecto" dice que se borran también las calificaciones.
Verificado en navegador con `.qa/verificar-37i.js` (carrera de Diagnóstico con la lectura
retrasada 4 s: el siguiente alumno no cambia; lectura y guardado fallidos en Diagnóstico;
Asistencia; Inicio; pesos en error en la boleta) y `.qa/verificar-37j.js` (Crear proyecto
con el catálogo en error); 22 suites, humo, verificar-37c, 310d y cierre-boleta en verde
(una corrida de verificar-criterios-crear mostró un error pasajero que no se repitió en tres
corridas más).

**Revisión de 3.8: PASS** (revisor 37b). Llave ausente del frontend, de git y de
`.env.local`; función desplegada v2 idéntica al repo; sin llave el botón no aparece (7
boletas, solo llamadas "estado"); sin sesión o con token inválido 401, "redactar" sin
llave 503 antes de tocar datos, GET 405, cuerpo inválido 400, sin 500 en los registros;
con la segunda cuenta 0 filas y un update cambia 0; por código: guarda en
`texto_autogenerado.ia`, copia solo a cuadros no editados, excluye cerradas, 30 s entre
redacciones, sin nombre del alumno.

**Pulidos de la ronda** (tras los PASS de 3.2-3.6, verificados con
`.qa/verificar-pulidos.js`, `verificar-32.js`, `verificar-reporte-impresion.js`, humo y las
16 suites): recorte de PDA solo en comas que abren cláusula (0 frases colgando en los 1329
PDA del catálogo, salvo 2 que vienen así del catálogo); reportes usan la propuesta recién
calculada salvo lo del maestro o lo redactado con IA; trabajo diario vaciado a propósito
se guarda como "" y se respeta en boleta, reporte, exportación y diagnóstico, sin cambiar
la fecha del diagnóstico; los cuadros se guardan también mientras se escribe; `esc()` con
comillas; fluidez de la junta sin número de lista cuando no hay nombres; examen exportado
con dos decimales.

## 3.10 Ensayo final

**Ensayo #1: FAIL** (revisor 310, `.qa/revisor-310/`). Un trimestre completo por la
interfaz con la segunda cuenta (grupo 1°-2° como el de Fanny, 6 alumnos, 2 proyectos
creados en "Crear proyecto", 8 días de captura con reloj simulado) y lo esencial de Fase 4
con Tomás Paz (5 confirmado y cerrado). La cadena funciona y los números cuadran (24
porcentajes calculados a mano, junta y exportación). Bloqueantes encontrados:
1. **Evidencia por PDA corrompida** cuando una sesión tiene trabajo y tarea ligados al
   mismo PDA: gana la última calificación y una tarea "Incompleta" borraba la del trabajo.
   → Migración `b5c_evidencia_pda_con_todos_los_productos`: la evidencia se recalcula con
   todas las calificaciones del alumno ligadas a ese PDA (manda el trabajo, la más baja si
   hay varias; la tarea solo si no hay otra). Recalculada la evidencia QA; los 4 casos del
   ensayo quedaron bien (verificado por SQL).
2. **Cierre del día** decía "todos empiezan en 1" pero solo guardaba a quien se tocaba (el
   motor ignora días sin registro). → La primera excepción guarda el día de todo el grupo
   (1 y 1, sin contar a quienes faltaron) y hay botón "Guardar el cierre de hoy"; marcar
   una falta después retira el cierre por defecto.
3. **Boleta imposible de cerrar** con un campo sin evidencias. → Ese campo ofrece "Elige"
   (juicio docente, dentro de la escala), la barra explica qué falta y confirmar exige los
   cuatro.
4. **Diagnóstico abría en "Inicio de ciclo"** y la boleta lee el del trimestre. → Abre en
   el trimestre actual ("T1 · boleta") y la boleta avisa si falta.
5. **Inicio pintaba "• todos • null"** con proyectos de "Crear proyecto". → Lectura correcta
   de `{mode, todos, diferenciado}` (prueba `pruebas/inicio-actividades.test.js`).
Menores atendidos: boleta para familias sin "Sin registro" (guion neutro); mismo
porcentaje truncado en boleta, reporte y junta; tarea sin fecha de entrega vence el
siguiente día hábil (regla única en `js/alcance-hoy.js`) y "vencía el 14 sep"; boleta
cerrada con textos de solo lectura y sin "Volver a proponer"; redacción de la junta
("logro menor al 60 %" en vez de "terminaron"). Verificado con `.qa/verificar-310.js`
(todas OK, sin errores de consola) y las 18 suites.
Menores anotados para Jorge: productos con nombre genérico y sin forma de renombrarlos;
"Crear proyecto" no filtra el PDA por el campo de la sesión; faltas justificadas cuentan
como asistencia en el dato de referencia; el 5 de Fase 4 no se marca "no acredita" celda
por celda; Mi grupo (lista escondida, textos sin acentos, nombres en mayúsculas sin
acentos); tocar dos veces un semáforo lo borra; tiempos de carga de 5 s en boleta y
reporte y 8.8 s en el primer Inicio.

**Re-ensayo de 3.10: FAIL #2** (revisor 310b, `.qa/revisor-310b/`; lo cortó el límite de
la API y se reanudó con su contexto). Recorrió el trimestre completo con la segunda cuenta
(6 alumnos 1°-2°, 2 proyectos, 5 días en "Hoy", diagnóstico, boleta, imprimible, reporte,
junta, CSV/XLSX) y la Fase 4 con la cuenta QA: los 18 porcentajes calculados a mano
coinciden, pisos, confirmación, "pendiente", privacidad, aislamiento y "Nadie asistió hoy"
correctos. Dos bloqueantes:
1. **Excepción sin capturar en Crear proyecto, paso 3** (`escapeHtml is not defined`): la
   función vivía dentro de otra y los "Criterios sugeridos" nunca aparecían. → Movida al
   alcance de la página. Además revisé todo `js/` con eslint `no-undef` (en `.qa/`, fuera
   de git): no queda ningún identificador sin definir (solo `html2pdf`, que viene del CDN).
   Verificado con `.qa/verificar-criterios-crear.js` (el panel aparece, consola limpia).
2. **La boleta cerrada no quedaba congelada**: el desglose y el porcentaje se recalculaban,
   la fila GEN (que la base no marca cerrada porque no lleva calificación) se reescribía y
   el trabajo diario se calculaba en vivo. → Regla única `ReporteDatos.boletaCerrada` (los
   cuatro campos cerrados) que respetan Reportes, la boleta imprimible, el reporte
   detallado, la exportación y la función de IA (v3 desplegada: responde 409 con la boleta
   cerrada). Al cerrar se guardan primero los cuadros pendientes y se toma una foto del
   trabajo diario en `texto_autogenerado.cierre` de la fila GEN. En pantalla: porcentaje y
   calificación del cierre, aviso si hubo capturas después, textos guardados, nada
   "propuesto". Prueba `pruebas/boleta-cerrada.test.js` (con el `reportes.js` anterior da 8
   fallas) y `.qa/verificar-cierre-boleta.js` en navegador (cerrar, cambiar capturas y
   diagnóstico, regenerar: la base no cambia ninguna fila y la imprimible y el reporte
   muestran lo del cierre).
Los datos de prueba de la segunda cuenta se borraron (queda la cuenta y su grupo) antes
del siguiente ensayo. Menores anotados para Jorge: nombres genéricos de productos;
no hay forma de reabrir una boleta cerrada; un 10 propuesto con una sola evidencia sin
advertencia; Diagnóstico de 1° pide multiplicación y división; "Sesiones de hoy: 2" en
Inicio con una sola tarjeta de plan; botones del cierre que se van de renglón en celular;
ausentes con 1/1 marcado en el cierre (no se guarda); tareas que vencen en día festivo
(`dias_no_habiles_extra` no se usa); acentos en "Aqui si puedes", "Aun no hay";
"1 de 6 alumnos necesitan"; "Agregar producto" con `prompt()`.

**Tercer ensayo de 3.10: FAIL #3** (revisor 310c, `.qa/revisor-310c/`). El recorrido completo
funciona por la interfaz (dos proyectos creados con la segunda cuenta, 12 combinaciones
sesión-grado en Crear proyecto con "Criterios sugeridos" y consola limpia, cinco días en
"Hoy", diagnóstico, boletas confirmadas y cerradas, imprimible, reporte, junta, CSV/XLSX,
Fase 4, T2 vacío, aislamiento); 5 porcentajes a mano cuadran; las 25 filas de boletas
cerradas no cambiaron tras cambiar capturas y diagnóstico. Tres bloqueantes:
1. El reporte detallado de una boleta cerrada recalculaba el **semáforo** del campo. → Es
   el guardado al cerrar.
2. La sección **cuaderno y habilidades** (PPM, comprensión, matemáticas) se leía en vivo
   en la imprimible, el reporte, Reportes y la exportación: la boleta reimpresa decía "50
   ppm · Estándar" junto al texto congelado "por debajo de lo esperado". → Al cerrar se
   guarda también la foto del diagnóstico (`cierre.diagnostico`) y todos la usan
   (`ReporteDatos.diagnosticaVisible`).
3. **"Hoy" perdía capturas**: "Trabajar hoy" recargaba sin esperar la cola (con red lenta,
   6 marcas y solo 5 llegaron). → Espera a que la cola quede vacía, la cola nunca descarta
   y cerrar la página con capturas pendientes pide confirmación. Verificado con latencia
   de 1.5 s: las 8 asistencias llegan antes de recargar.
Menor corregido: el porcentaje subía 0.1 al cerrar (se guardaba redondeado y se muestra
truncado) → se guarda truncado a 2 decimales. Anotados para Jorge: la junta y las columnas
de rubros de la exportación usan los datos de hoy aunque la boleta esté cerrada; ausentes
cuentan como "sin calificar" en los productos del día; la asistencia de referencia solo
cuenta el rango de fechas con sesiones; el primer toque del cierre guarda 1 y 1 también a
quien no tiene asistencia capturada.
Verificado: `pruebas/boleta-cerrada.test.js` y `reporte-alumno.test.js` (foto del
diagnóstico y semáforo del cierre) y `.qa/verificar-cierre-boleta.js` en navegador (PPM
cambiado a 987 después de cerrar: no aparece en imprimible, reporte ni Reportes; semáforo
del cierre).

**Cuarto ensayo de 3.10: FAIL #4** (revisor 310d, `.qa/revisor-310d/`). El trimestre completo
funciona por la interfaz: proyecto creado con PDA por grado y consola limpia, proyecto en
curso de solo consulta, 6 días en "Hoy" con red lenta sin pérdidas, 8 porcentajes a mano
cuadran, pisos, "Elige", edición que sobrevive; boletas cerradas idénticas en la base tras
cambiar capturas y diagnóstico, y sin cambios en Reportes, imprimible, reporte y
exportación (calificación, porcentaje, semáforo, textos, trabajo diario, cuaderno y
habilidades); junta, T2, aislamiento. Bloqueante: **Diagnóstico pisaba el diagnóstico
completo del siguiente alumno** si se tocaba un control antes de que cargara (lo reprodujo
sin simular red lenta). → Corregido (ver FAIL #7 de 3.7, mismo defecto). Importante: la
asistencia de una boleta cerrada seguía cambiando en lo impreso → ahora también va en la
foto del cierre. Menor corregido: la retroalimentación de "Hoy" se perdía al recargar sin
salir del cuadro → se guarda mientras se escribe y cuenta como pendiente. Anotados para
Jorge: tiempos de carga (boleta 5 a 10 s, junta 7.8 s) y los ya conocidos.

**Quinto ensayo de 3.10: FAIL #5** (revisor 310e, `.qa/revisor-310e/`). Recorrido completo por
la interfaz en verde: dos proyectos 1°-2° con PDA por grado y consola limpia, proyectos en
curso de solo consulta, seis días en "Hoy" con red lenta sin pérdidas (retroalimentación
sin salir del cuadro incluida), 18 porcentajes a mano, pisos, "Elige", boletas cerradas
idénticas por md5 tras cambiar niveles, asistencia, cierre, PPM y observaciones (en
pantalla, imprimible, Reportes y exportación), T2 vacío, aislamiento, multigrado, junta
cuadrada a mano. La carrera al cambiar de alumno ya no ocurre. Bloqueante: **Diagnóstico
mandaba un guardado completo por toque sin esperar al anterior**; con red lenta el servidor
los aplicaba fuera de orden y ganaba uno viejo (Supabase lo mostró: el insert 201 llegó
detrás de dos 200). Además, desmarcar todo dejaba "Siguiente" sin responder (regresión
del FAIL #7 de 3.7). **Conteo:** el FAIL #4 y el #5 comparten causa (guardados de
Diagnóstico sin serializar); son dos seguidos; el #3 fue otra (boleta cerrada sin
congelar). Un sexto por la misma causa detendría 3.10.
Corrección: los guardados de Diagnóstico van en serie (cola, como "Hoy"), cada uno con el
estado de la pantalla al salir; si el alumno ya tenía fila y se desmarca todo, se guarda
vacío (la base dice lo que la pantalla) y "Siguiente" avanza; salir con un cambio sin
guardar pregunta. Verificado con `.qa/verificar-310g.js`, determinista (el primer guardado
se retiene 3 s): con el código anterior 3 fallas (la base quedó con 1 de 10 criterios,
"Siguiente" no avanzó), con el nuevo en verde; `.qa/verificar-310f.js` (3 alumnos
capturados rápido con 1.5 s de latencia: todo en la base); 22 suites, humo, 37i, 310d,
cierre-boleta y 37c en verde. Anotados para Jorge: con boleta cerrada, el desglose por
rubro y el avance por PDA del reporte (con aviso), la junta y los rubros de la exportación
usan los datos de hoy; tiempos de carga de 4 a 8 s; asistencia de referencia cuenta solo
días con sesión ("5 de 5" con 6 días de lista); "No hay sesiones pendientes" con dos
proyectos activos; conducta "0.8 / 1.5" en pantalla y "0.75 / 1.5" en el reporte.

**Sexto ensayo de 3.10: FAIL #6** (revisor 310f, `.qa/revisor-310f/`). Diagnóstico y "Hoy" con red
lenta **pasan**: 6 de 6 alumnos iguales entre pantalla y base con red normal, lenta por
CDP y con retrasos aleatorios; vaciar avanza; sin red avisa y guarda al volver; salir con
texto pendiente pregunta. Recorrido completo en verde (proyectos, siete días en "Hoy" con
31 escrituras en red lenta, números a mano, pisos, boletas cerradas idénticas por md5 tras
cambiar todo, T2, multigrado, aislamiento). Bloqueantes, **causa nueva** (no comparte causa
con #4 y #5): **el cierre no era atómico** (cerraba los cuatro campos y DESPUÉS subía la
foto; si la red se caía entre las dos, la boleta quedaba cerrada sin foto y volvía a leer
los datos de hoy, sin forma de repararlo) y **la base no protegía una boleta cerrada** (una
pestaña abierta antes del cierre cambió LEN de 6 a 9 con `cerrada=true`).
Corrección en la base (migración aditiva `b8_cierre_boleta_atomico_inmutable`; no había
boletas reales): función `cerrar_boleta` (security invoker, RLS) que guarda la foto y cierra
los cuatro campos en una transacción y exige los cuatro; trigger
`boleta_trimestral_cerrada_inmutable` que rechaza modificar una fila cerrada o la GEN de una
boleta cerrada. La pantalla cierra con una sola llamada y, si falla o choca con un cierre de
otra pestaña, lo dice y vuelve a dibujar lo que hay en la base. Menores corregidos: un PPM
borrado ya no cuenta como dato; el conteo de "evaluados" no cuenta filas vaciadas;
Diagnóstico dice que las observaciones salen en la boleta como "Trabajo diario"; la cola de
Diagnóstico funde los toques (uno en vuelo y uno esperando) para que "Siguiente" no espere
diez guardados. Verificado con `.qa/verificar-310h.js` (red cortada al cerrar: nada cambia y
lo dice; 3 campos: la función se deshace completa; cierre normal con foto; pestaña vieja no
cambia la calificación y ahora ve la boleta cerrada; la base rechaza modificar fila cerrada
y GEN), 22 suites, humo, cierre-boleta, 310d, 310f, 310g (dos veces), 37i y 37c en verde;
advisors de seguridad sin avisos nuevos. Anotados para Jorge: si la maestra ACEPTA salir con
la cola pendiente se pierde lo que no llegó (el navegador sí avisa); "Hoy" no muestra el
segundo proyecto activo hasta terminar el primero.

**Séptimo ensayo de 3.10: FAIL #7** (revisor 310g, `.qa/revisor-310g/`). Todo el criterio pasa por
la interfaz: cierre de todo o nada (sin red, con 3 campos, con la respuesta perdida), cinco
pestañas viejas, cuadros de texto, "Guardar ajustes", IA y UPDATE directo contra una boleta
cerrada, Diagnóstico y "Hoy" con red lenta (6 de 6 y 8 de 8), Crear proyecto, números a
mano, boletas cerradas idénticas por md5, T2, aislamiento, Fase 4. Bloqueante: con la
sesión del maestro (supabase-js, sin SQL) una boleta cerrada se podía **borrar y volver a
insertar** con otra calificación y `cerrada=true` (el trigger solo cubría UPDATE; la política
era FOR ALL). **Misma causa que el FAIL #6** (la base no protegía del todo lo cerrado): son
dos seguidos; un tercero detendría 3.10.
Corrección (migración aditiva `b8_cierre_boleta_sin_borrar_ni_cerrar_por_fuera`): política
RESTRICTIVA de borrado (no se borra una fila cerrada ni la GEN de una boleta cerrada; RLS y
no trigger para que borrar un alumno y la semilla de QA sigan funcionando) y trigger
`boleta_trimestral_cierre_solo_por_funcion` (una fila solo queda cerrada dentro de
`cerrar_boleta`, con una marca local de su transacción). Menores: si se pierde la respuesta
del cierre, el aviso ya no dice "Nada cambió" sino que muestra cómo quedó; una pestaña vieja
que choca con una boleta cerrada lo dice y se vuelve a dibujar. Verificado con
`.qa/verificar-310h.js` ampliado (borrar fila cerrada o GEN: 0 filas; insertar ya cerrada o
cerrar por UPDATE: rechazado; una fila abierta sí se borra; borrar un alumno con boleta
cerrada funciona y no deja huérfanas), 22 suites, humo, cierre-boleta, 310g, 37i y 310d en
verde; todas las funciones nuevas son `security invoker` con `search_path` fijo.

**Octavo ensayo de 3.10: SIN VEREDICTO** (revisor 310h, `.qa/revisor-310h/`). Se detuvo a la mitad
porque **la base de producción se degradó desde las 18:00 UTC del 2026-09-23** (Auth 504,
conexiones que se agotan, consultas internas triviales de 11 a 15 s; el panel seguía
`ACTIVE_HEALTHY`). Confirmado de forma independiente a las 20:58 UTC. No cuenta para la regla
de los 3 FAIL. Lo que alcanzó a probar, en verde: alta de alumnos, dos proyectos con consola
limpia y proyecto en curso de solo consulta, seis días en "Hoy" (uno con red lenta), tres
pasadas de Diagnóstico (6 de 6), cuatro porcentajes a mano, "Elige", ajustes y textos,
cierre de todo o nada (sin red, 3 campos, respuesta perdida), **20 vías por API contra una
boleta cerrada rechazadas o sin efecto** (UPDATE, upsert, INSERT duplicado, DELETE de campos
y GEN, mover filas, cerrar por fuera), `cerrar_boleta` con campo repetido rechazado, borrar
un alumno con boleta cerrada. Pendiente: pestañas viejas, IA, cambios después del cierre en
los cuatro documentos, reporte, junta, exportación, T2, aislamiento y Fase 4-5. Posible
causa del incidente: agotamiento de recursos de la instancia (IO o CPU); la carga de QA de
hoy (muchas rondas de revisores con navegador) pudo contribuir. Decisión de Jorge:
reiniciar el proyecto o subir el cómputo desde el panel de Supabase.
**Causa confirmada** con las gráficas de Reports → Database que mandó Jorge: la instancia (plan
gratuito, cómputo NANO, 0.5 GB) ya tenía el "memory commitment" en ~1.2 de ~1.26 GB en reposo;
la carga de QA lo subió a 1.40-1.44 GB, creció el swap y la CPU se fue a IOwait. Jorge reinició
el proyecto y se recuperó (datos reales intactos: 18 alumnos, 404 asistencias). Para no repetirlo
se creó el proyecto de pruebas (ver arriba) y el QA ya no toca producción. Los restos del octavo
ensayo en la segunda cuenta de producción se borraron (queda la cuenta y su grupo vacío).

**Noveno ensayo de 3.10: PASS** (revisor 310i, `.qa/revisor-310i/`, 2026-09-24). Primer ensayo en el
proyecto Supabase de pruebas `docentes-pruebas`: el revisor comprobó el entorno
(`verificar-proyecto-pruebas.js` en verde, ninguna petición a producción), sin 5xx ni consultas
lentas y sin excepciones sin capturar en todo el recorrido. Evidencia:
- **Crear proyecto:** dos proyectos 1°-2° por la interfaz (6 sesiones, PDA y criterio por grado),
  paso 3 con consola limpia y "Criterios sugeridos" en las 12 combinaciones; un proyecto en curso
  no se guarda ni quitando el `disabled` a mano.
- **"Hoy":** 7 días con faltas, justificadas, tareas vencidas y cierre del día, con red normal,
  retraso fijo de 1.5 s, aleatorio y tramo sin red: 180 marcas iguales entre pantalla y base.
- **Diagnóstico:** cuatro pasadas (normal, 1.5 s, aleatorio, desmarcar todo): 6 de 6 iguales.
- **Boleta:** 10 porcentajes a mano, pisos de Fase 3, "Elige" en DHL sin evidencias, edición que
  sobrevive; cinco boletas cerradas y una "pendiente".
- **Cierre de todo o nada:** sin red no cambia nada; con la respuesta perdida queda cerrada completa
  con foto; `cerrar_boleta` rechaza 3 campos, campo repetido, GEN y calificación nula.
- **Pestañas viejas:** seis pestañas abiertas antes del cierre (texto, "Guardar ajustes", volver a
  cerrar, "Volver a proponer", trabajo diario, confirmar): la base quedó idéntica por md5 y cada
  una avisó y se dibujó cerrada.
- **API con la sesión del maestro:** 25 vías contra una boleta cerrada (UPDATE, DELETE, INSERT
  cerrada, upsert, cerrar por UPDATE, mover filas, GEN y su foto): rechazadas o sin efecto, 29
  filas idénticas por md5. IA sin llave: 503 y sin botón.
- **Después del cierre:** cambiar capturas, asistencia, diagnóstico, pesos y grado: 25 filas cerradas
  con el mismo md5, imprimible sin una línea distinta en los 5 alumnos, y Reportes, reporte y
  exportación sin cambios en lo entregado.
- **Fase 4:** Mateo y Emilio en riesgo con escala 5 a 10, cerrados; cambios después sin efecto.
- **Casos límite:** T2 vacío, aislamiento multigrado (0 de 329 calificaciones y 0 de 34
  formativas cruzan de grado), aislamiento entre cuentas (0 filas en 19 tablas y vistas, en los
  dos sentidos), 390 px sin desbordes, sin emojis.
- **Junta:** cuadrada a mano (promedios de grupo, por grado, por alumno, LEN de 1°, fluidez).
- **Datos reales de producción** al inicio y al final: 18 alumnos y 404 asistencias; 0 proyectos,
  calificaciones, boletas, diagnósticos y registros diarios.
Anotados para Jorge (REPORTE-FINAL §4, puntos 15 a 19): alumno sin ninguna evidencia no puede
recibir boleta; cambiar el grado después del cierre cambia la imprimible; las políticas no revisan
que el alumno sea del maestro (el revisor creó con `cerrar_boleta` filas propias ligadas a un alumno
de otra cuenta, sin ver ni tocar nada ajeno); alumno dado de alta tarde ve tareas pasadas
pendientes; trabajo diario de una pestaña vieja se guarda en Diagnóstico; boleta de 3 a 5 s.
Al terminar se borraron los datos del ensayo en el proyecto de pruebas (segunda cuenta a su grupo
vacío; cuenta QA resembrada).

## 3.9 Documentación

**Revisión #1 de 3.9: FAIL** (revisor 39, `.qa/revisor-39/`). De 40 afirmaciones
verificadas contra el código y la base, 37 correctas. Falsas o desactualizadas:
1. `CLAUDE.md` (tabla de datos) dice que `tareas`, `calificaciones` y
   `evaluacion_formativa` se materializan al cerrar sesiones. Es falso hoy, pero
   `CLAUDE.md` es de Jorge: no lo cambié por indicación de un revisor. Queda en
   "Decisiones pendientes" con el texto sugerido. El criterio de 3.9 son PRODUCTO y
   CONTEXTO.
2. CONTEXTO §5.1 decía que la segunda cuenta tiene un grupo vacío; tenía los datos del
   ensayo. → Texto corregido (los ensayos crean datos de prueba y se borran al terminar) y
   datos borrados.
3. La lectura de sesiones de "Hoy" no iba paginada. → Paginada.
Menores corregidos: Tareas no mira "los mismos proyectos" (redacción precisa), tres
implementaciones de paginación (ahora documentadas las cuatro, con `js/leer-todo.js`), el
filtro incluye `fecha_final` futura, fluidez de la junta sin número de lista, "Quitar de
hoy" también se oculta con la sesión completada, rótulo del examen solo donde se muestra,
símbolos ✅ fuera de la tabla de módulos. Documentada la boleta cerrada.

**Revisión #2 de 3.9: FAIL #2** (revisor 39b, `.qa/revisor-39b/`). 31 de 32 afirmaciones
correctas; 20 suites en verde; sin secretos (contraseñas de QA buscadas en todo el
historial: 0). Falsa: "la boleta cerrada fija el porcentaje en todos los reportes"; el
reporte detallado seguía mostrando el porcentaje de hoy (simulado en navegador: 19.3 %
junto a la calificación cerrada, sin aviso). Se corrigió el código, no solo el texto:
`campoVisible` en `js/reporte-alumno.js` usa el porcentaje guardado al cerrar y avisa si
hubo capturas después (prueba en `pruebas/reporte-alumno.test.js`: con el código anterior,
3 fallas). Documentos precisados: dónde se ve el porcentaje del cierre, y que la junta
grafica el logro del grupo con los datos de hoy (no es la boleta). Menores corregidos:
festivos y boleta sin reapertura en "Limitaciones conocidas"; `porLotes` sin uso en
pantallas; matiz de `justificado`/`no_aplica` con nivel capturado. Menor para Jorge:
`CLAUDE.md` dice "All 16 modules".

**Revisión #3 de 3.9: PASS** (revisor 39c, `.qa/revisor-39c/`). 44 afirmaciones de
PRODUCTO y CONTEXTO verificadas contra el código y la base, ninguna falsa; en navegador
(solo lectura, escrituras bloqueadas, boleta cerrada simulada con `page.route`): Reportes
y reporte detallado con el porcentaje del cierre y el aviso, imprimible sin porcentajes,
junta sin la cifra del cierre, Hoy e Inicio iguales, IA `configurada:false`; 0 errores de
consola; 20 suites en verde; sin secretos en 182 commits; datos reales iguales. Menores
atendidos después: los textos de una boleta cerrada en el reporte detallado se marcan
"Como se entregó" (no "Propuesta del sistema"); la barra "Boleta cerrada" se mantiene
aunque ya no haya evidencias; `calcular_calificaciones_boleta` descrita con precisión;
`grupos.trimestre_actual` en §6.1. Anotados: despliegue descrito como Cloudflare Pages en
§5 (fuera de §5.1) y las frases de `CLAUDE.md` (de Jorge).

## Aislamiento entre maestros

Segunda cuenta de QA `qa.aislamiento@jissez.com` (contraseña en `.env.local`), con el
grupo "QA Aislamiento (vacío)"; los ensayos 3.10 le crean datos de prueba que se borran al
terminar. `node .qa/aislamiento.js`: 0 filas de otro maestro en las 16 tablas y vistas
de Mi salón; el catálogo global `plantillas_sugerencia` se lee pero no se puede editar.

## Decisiones pendientes para Jorge

1. **Escala de participación y conducta.** En "Hoy" el valor por defecto del día es 1 de 2
   (lo normal; se cambian solo las excepciones), y el motor, siguiendo la especificación
   B.2/B.4, lo puntúa como 50 % de ese rubro. Un alumno "normal" pierde así parte de esos
   pesos (6 % y 5 %). *Mientras tanto:* no se cambió la calificación; en los textos para
   padres el 1 cuenta como normal (solo es área si el promedio baja de 1).
2. **Catálogo de sugerencias:** `plantillas_sugerencia` es global y lo edita el
   administrador; cada maestro puede reescribir la sugerencia en su boleta y lo suyo no se
   pisa. *Mientras tanto:* no hay pantalla para editarlo (se edita por SQL o con una
   pantalla futura de admin).

3. **Redacción con IA (Capa 2):** para activarla falta el secreto `ANTHROPIC_API_KEY` en
   las Edge Functions de Supabase (Jorge decide si se usa y quién paga el consumo).
   *Mientras tanto:* todo construido detrás de esa bandera; sin llave la boleta funciona
   igual con la Capa 1. Modelo `claude-opus-5` con esfuerzo bajo; no se envía el nombre
   del alumno. No hay límite de uso por maestro, solo 30 s entre redacciones de la misma
   boleta.
4. **Nombre del alumno en la presentación de junta:** por defecto se muestra número de
   lista y grado; los nombres solo con un interruptor que la maestra enciende en su
   equipo. Las áreas de atención van siempre agregadas.

5. **Pixel de Meta en el SaaS:** está en todas las páginas con barra (lo pidió Jorge para
   la tienda y se copió al SaaS) y recibe la URL completa, que en los reportes lleva el id
   del alumno (`?alumno=<uuid>`). *Mientras tanto:* no se quitó (decisión de marketing y
   de privacidad); recomendación: dejar el Pixel solo en `tienda/`.
6. **Habilidades de matemáticas por grado:** el catálogo (igual que la hoja de Fanny) no
   dice a qué grados aplica cada habilidad; en 1°-2° la boleta muestra multiplicación,
   división, fracciones y tablas como "No evaluada". *Mientras tanto:* se deja así.

## Bloques detenidos

### 3.7 Coherencia y deuda — DETENIDO (2026-09-23)

**Por qué.** Regla de la misión: tres FAIL seguidos por la misma causa detienen el bloque.
FAIL #6 (revisor 37g), #7 (37h) y #8 (37i) tienen la misma causa: **lecturas cuyo error se
ignora antes de afirmar algo en pantalla o de guardar**. No se lanzó otra revisión de 3.7.

**Lo que sí quedó demostrado** (37i, con ~190 casos de lectura en error en 21 pantallas y
todas las escrituras bloqueadas): Hoy, Tareas, Asistencia, Diagnóstico, Formativa,
Exámenes, Ajustes, todo Reportes, boleta imprimible, reporte, junta y exportación avisan
ante cada lectura fallida salvo la del grupo activo, y ningún caso con lectura fallida
intentó escribir. FAIL #1-#5 no volvieron (Hoy, Inicio y Tareas coinciden; lecturas que
crecen paginadas). Red lenta en Hoy sin pérdidas; carrera de Diagnóstico al cambiar de
alumno corregida; aislamiento entre cuentas.

**Defectos abiertos que dejó el FAIL #8** (todos reproducidos por 37i en
`.qa/revisor-37i/`, ninguno llegó a la base porque bloqueó las escrituras):
Misma causa (lectura con error ignorada):
1. Mi grupo, "Eliminar grupo" con el conteo de alumnos en error: el aviso dice "0 alumnos"
   (`js/mi-grupo.js` `countStudentsByGroupId`).
2. Inicio con la lectura del proyecto activo en error: dice "No tienes ningún proyecto
   activo" (el aviso de `showError` se borra al vaciar `#flowContainer`).
3. Mi grupo con la lista de alumnos en error: "Aún no hay alumnos" y deja dar de alta
   (numeraría desde 1, duplicando números de lista).
4. La lectura del grupo activo (`GrupoActivo.cargar`) en error: Hoy y Reportes lanzan una
   excepción sin atrapar; Proyectos, Exámenes y Actividades muestran los proyectos o
   exámenes de todos los grupos; Crear proyecto y Marketplace dicen "no hay grados" o
   "crea tu grupo".
5. Con la lectura de `perfiles.activo_saas` en error, el candado muestra su aviso pero el
   script de la página sigue y lanza excepciones (Hoy, Crear proyecto, Reportes).
Otras causas:
6. Regresión del FAIL #7 en Diagnóstico: marcar y luego desmarcar un semáforo deja la
   pantalla sin poder avanzar y lo quitado no se guarda (`guardarAlumno` devuelve
   `undefined` cuando no queda nada que guardar).
7. Asistencia: cambiar de fecha con un autoguardado pendiente puede mandar la lista del día
   nuevo con todos en "ausente" (el cambio de fecha no cancela el guardado pendiente).
8. Guardados fallidos sin aviso: propuesta de número y de textos de la boleta; en
   Evaluación formativa quitar un semáforo no se borra en la base; el retiro del cierre en
   Asistencia.
9. Salir con capturas pendientes sin aviso en Diagnóstico (debounce de 800 ms) y en
   Evaluación formativa (solo "Hoy" pregunta).
Menores: "Clonar" en Proyectos nunca funciona (`grupo_id` no viene en el select);
"Iniciar proyecto" con la lectura en error dice "no tiene sesiones"; Formativa y Examen
dicen "no encontrado" cuando falló la lectura.

**Diagnóstico honesto.** La causa no es una pantalla sino un patrón: cada página hace sus
propias lecturas a mano y decide qué hacer con el error. Se corrigió por barridos (primero
Hoy/Inicio, luego las pantallas que capturan, luego las 91 lecturas con una prueba), y cada
revisión encontró la siguiente capa: la prueba `lecturas-revisan-error` solo exige que el
error se mencione después, no que se maneje bien, y no ve a quien llama a
`GrupoActivo.cargar`. **Lo que haría falta** (decisión de diseño para Jorge): una sola
capa de lectura para todas las páginas (como `js/leer-todo.js`, pero para toda lectura) que
lance el error, y un arranque común de página que lo atrape y muestre "no se pudo cargar;
recarga" sin dibujar ni guardar nada; con eso cada pantalla deja de decidir por su cuenta.
Es un cambio transversal a ~20 archivos que no conviene hacer sin revisión.

**Qué depende de 3.7:** nada de los demás bloques en su criterio. 3.10 (ensayo) sigue; lo
que ese ensayo encuentre en el recorrido de la maestra se corrige dentro de 3.10.
