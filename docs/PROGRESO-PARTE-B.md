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
| 3.2 B.7 Capa 1 (fortalezas, áreas, sugerencias, trabajo diario) | corrigiendo | FAIL #1 revisor #2 (ediciones borradas, entrega vs calidad, vaciar texto) | — |
| 3.3 B.8.1 Boleta imprimible | construido (`boleta.html`), falta revisor | — | — |
| 3.4 B.8.2 Reporte detallado | en construcción (subagente) | — | — |
| 3.5 B.8.3 Junta de padres | en construcción (subagente) | — | — |
| 3.6 B.8.5 Exportación CSV/XLSX | construido (`exportar.html`), falta revisor | — | — |
| 3.7 Coherencia y deuda | preparado en `.qa/staging/` (se promueve al cerrar 3.1/3.2) | — | — |
| 3.8 B.7 Capa 2 (IA) | Edge Function desplegada; frontend en `.qa/staging/` | — | — |
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

## Bloques detenidos

(ninguno)
