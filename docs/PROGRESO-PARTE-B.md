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

## Bloques

| Bloque | Estado | Revisor | Commit |
|---|---|---|---|
| 3.1 Cuenta y datos de QA (+ grupo activo, adelantado de 3.7) | **PASS** | FAIL #1 (emojis) → **PASS** revisor #2 | ver `git log` |
| 3.2 B.7 Capa 1 (fortalezas, áreas, sugerencias, trabajo diario) | **PASS** | FAIL #1 revisor #2 → **PASS** revisor #3 (32b) | (commit al cerrar la ronda) |
| 3.3 B.8.1 Boleta imprimible | **PASS** | revisor 33b | (commit al cerrar la ronda) |
| 3.4 B.8.2 Reporte detallado | **PASS** | revisor 33b | (commit al cerrar la ronda) |
| 3.5 B.8.3 Junta de padres | **PASS** | revisor 35b | (commit al cerrar la ronda) |
| 3.6 B.8.5 Exportación CSV/XLSX | **PASS** | revisor 35b | (commit al cerrar la ronda) |
| 3.7 Coherencia y deuda | corregido, en re-revisión | FAIL #1 revisor 37b (Tareas: justificados nunca "Revisada") | — |
| 3.8 B.7 Capa 2 (IA) | **PASS** (detrás de bandera: falta el secreto) | revisor 37b | (commit de la ronda) |
| 3.9 Documentación | pendiente | — | — |
| 3.10 Ensayo final | pendiente | — | — |

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

## Aislamiento entre maestros

Segunda cuenta de QA `qa.aislamiento@jissez.com` (contraseña en `.env.local`), con un
grupo vacío. `node .qa/aislamiento.js`: 0 filas de otro maestro en las 16 tablas y vistas
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

(ninguno)
