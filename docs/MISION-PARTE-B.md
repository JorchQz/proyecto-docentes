# Misión: terminar Mi salón (Parte B) en modo autónomo

**Para:** Code · **De:** Jorge · **Fecha:** 2026-09-23

Guarda este archivo en el repo como `docs/MISION-PARTE-B.md` y trabájalo de principio a fin **sin esperar a Jorge entre bloques**. Hasta hoy, cada bloque pasaba por una revisión independiente (base de datos + navegador real) que hacía otro Claude, y Jorge copiaba y pegaba entre los dos. Eso se acaba: **la revisión independiente ahora la haces tú, con un subagente revisor que no vio cómo construiste nada.** Jorge solo recibe el reporte final.

Esa revisión encontró dos bugs que tus pruebas no vieron (el aviso "propuesta: N" que nunca podía aparecer y el orden de arranque de `hoy.js` que dejaba en blanco dos secciones). Los dos solo se vieron al cargar la página real en un navegador. Por eso el protocolo de la sección 4 es obligatorio, no un extra.

---

## 1. Contexto de dominio (lo que antes aportaba el revisor)

### 1.1 Para quién es
- Maestras de primaria en México bajo la Nueva Escuela Mexicana (NEM), muchas en escuelas multigrado. Caso de referencia: **Fanny**. Sus archivos de trimestres pasados son de un grupo 4°-5°-6°; **su grupo real actual es 1° y 2°** (Fase 3). La prueba final de Jorge será con las actividades reales de ese grupo, así que el caso Fase 3 tiene que quedar impecable.
- Lo que reemplaza: varios Excel por campo, captura a fin de mes, máximos escritos a mano, fortalezas y áreas redactadas desde cero por alumno, y una presentación de junta hecha subiendo los Excel a una IA.
- Lo que hay que conservar de su formato, porque los maestros lo reconocen: fórmula ponderada por campo, semáforo de tres niveles (logrado / en proceso / requiere apoyo), revisión de cuaderno (10 criterios), habilidades básicas (PPM + 8 de matemáticas), observaciones con fortalezas y áreas, y el comparativo trimestre contra trimestre para la junta.
- La unidad de captura es el **producto de la sesión**, no la actividad: los maestros casi no siguen Inicio/Desarrollo/Cierre.

### 1.2 Reglas legales (Acuerdo 10/09/23, SEP — verificado contra el texto del DOF)
- **Art. 4-XI:** la calificación es un juicio del docente. El sistema propone, el maestro confirma. Nada numérico se cierra sin confirmación explícita (ya construido en B.3; no lo rompas).
- **Art. 7:** la asistencia **no** es criterio de acreditación. Nunca pondera. Se muestra solo como dato de referencia.
- **Art. 8:** tres periodos de evaluación por ciclo (trimestres).
- **Art. 9:** Fase 3 (1° y 2°) usa enteros **6 a 10**. Fases 4 y 5 (3° a 6°) usan enteros **5 a 10**; 5 es reprobatoria. Fuente única: `calcular_calificacion_boleta` / `piso_calificacion_boleta` más el trigger `boleta_trimestral_piso_fase`. Ningún reporte convierte por su cuenta.
- La boleta lleva observaciones y sugerencias por campo formativo. Mi salón es **complemento** de la boleta oficial SIGED, no la sustituye; no la presentes como documento oficial de la SEP.
- La SEP no prescribe participación por campo: el registro diario global es válido (ya construido).

### 1.3 Vocabulario y estilo
- Campos: LEN (Lenguajes), SAB (Saberes y Pensamiento Científico), ETI (Ética, Naturaleza y Sociedades), DHL (De lo Humano y lo Comunitario). Nunca "HUM".
- Colores NEM: LEN `#059669`, SAB `#ea580c`, ETI `#7c3aed`, DHL `#0284c7`. Grados en reportes multigrado con badge de color por grado.
- Español de México. **Sin emojis en la UI**, iconos SVG/Lucide.
- Textos para padres: tercera persona, respetuosos, concretos, sin diagnósticos clínicos ni etiquetas ("TDAH", "flojo", "lento"), sin comparar al alumno con otros por nombre.

### 1.4 Multigrado
- Cada alumno solo se califica en productos cuyos `grados` incluyan el suyo; PDA y criterios siempre por grado; máximos por grado.
- Tridocente (bloques de 2 grados) y bidocente (3 grados) no cambian el modelo.

---

## 2. Estado actual (construido y verificado de forma independiente)

Rama `mi-salon-parte-b`, sin push:
- B.0 correcciones previas · B.3 motor único + confirmación del maestro + aviso "propuesta" · B.1 pantalla "Hoy" (asistencia, tareas, productos por sesión, cierre del día) · B.4 reparto de participación · B.5 propagación a `evaluacion_formativa` + pestaña "Avance por PDA" (B.8.4) · FK de `calificaciones` en CASCADE · `sesiones_pda.pda_id` nullable con índice parcial.
- Cuaderno y habilidades viven en `evaluacion_diagnostica` (claves de `js/catalogo-habilidades.js`) y las bandas en `bandas_ppm`. No crees `catalogo_habilidades` ni `evaluacion_habilidades`.

---

## 3. Lo que falta, en orden, con criterio de aceptación

Cada bloque termina solo cuando el revisor (sección 4) da PASS.

### 3.1 Cuenta y datos de QA propios (hazlo primero)
Crea una cuenta de maestro exclusiva para pruebas, con su contraseña en un archivo local ignorado por git (`.env.local` o similar). Así el revisor puede iniciar sesión en el navegador sin la contraseña de Jorge y sin tocar datos reales. Dale al menos: un grupo multigrado **1°-2°** (Fase 3) y otro **3°-4°** o **5°-6°** (Fases 4-5), 3-5 alumnos por grado, un trimestre simulado con sesiones, productos, tareas, asistencia, cierres del día, diagnóstico de cuaderno/habilidades con PPM y un examen. Mezcla perfiles a propósito: alumno sobresaliente, alumno en riesgo, alumno irregular, alumno con PPM bajo, alumno con `justificado`. Todo con prefijo `DEMO`/`QA`.
- Aceptación: el revisor entra con esa cuenta, ve ambos grupos, y la boleta de un alumno de 2° en riesgo sale con piso 6 y la de uno de 4° en riesgo puede salir 5.

### 3.2 B.7 Capa 1 — fortalezas, áreas, sugerencias y "trabajo diario" (reglas, sin IA)
Por alumno y campo, al generar la boleta:
- **Fortalezas:** PDA con nivel predominante `logrado` y al menos 2 evidencias (frase desde el texto del PDA, en tercera persona); rubros de 90 % o más ("Entrega puntualmente sus tareas"); habilidades en `logrado`.
- **Áreas de oportunidad:** PDA en `requiere_apoyo` con al menos 2 evidencias; rubros por debajo de 60 %; habilidades en `requiere_apoyo`; PPM por debajo del estándar de su grado según `bandas_ppm`.
- **Sugerencias:** una plantilla por tipo de área, en un catálogo editable (`plantillas_sugerencia` o equivalente). Ejemplos: PPM bajo → "Practicar lectura en voz alta 10 minutos diarios"; tareas bajo 60 % → "Establecer un horario fijo de tarea en casa".
- **Trabajo diario:** derivado de entrega de tareas y trabajos ("Cumple con tareas y trabajos" / "Entrega sus trabajos en clase pero no trae tareas").
- La asistencia puede mencionarse como observación ("Asistencia irregular"), nunca como algo que baja la calificación.
- Límite de frases por sección (3-4) y sin repetir la misma idea con otras palabras.
- Lo que el maestro edite queda marcado (`editado_manual`) y **nunca** se sobreescribe al regenerar.
- Aceptación: con los perfiles de 3.1, el sobresaliente tiene fortalezas y ninguna área inventada; el alumno en riesgo tiene áreas y sugerencias coherentes; el de PPM bajo recibe la sugerencia de lectura; editar un texto, regenerar y recargar conserva la edición.

### 3.3 B.8.1 Boleta trimestral por alumno (imprimible)
- Datos del alumno y escuela; tabla campo × T1/T2/T3 con la calificación **confirmada** y promedio; observaciones y sugerencias por campo; firmas docente y padre/tutor.
- Secciones de cuaderno y habilidades leyendo de `evaluacion_diagnostica`, con diagnóstico PPM calculado desde `bandas_ppm`.
- Un trimestre sin confirmar se muestra como "pendiente", nunca como número.
- HTML con `@media print`; PDF desde el navegador. Sin librerías pesadas.
- Aceptación: vista previa de impresión en carta sin cortes raros; sin emojis; pisos por fase respetados.

### 3.4 B.8.2 Reporte trimestral detallado por alumno
Equivale a la `Plantilla_Reporte` de Fanny, mejorada: desglose por rubro (obtenido / máximo / %), cuaderno, habilidades con PPM contra banda, avance por PDA, fortalezas, áreas, sugerencias, y **retroalimentaciones destacadas** (las últimas 3-5 no vacías del trimestre). El examen se calcula con la aproximación actual (`valor_total / total_preguntas`) y así se etiqueta: no lo presentes como exacto.

### 3.5 B.8.3 Presentación de grupo para junta de padres
Equivale a `junta_fanny_2T-3T.html`, generada desde datos: portada; panorama (promedio del grupo por trimestre y delta en puntos, cuántos alumnos mejoraron); desempeño por grado con barras trimestre anterior vs actual por alumno; fluidez lectora por alumno contra la banda de su grado; promedio por campo y grado; áreas de atención por reglas (PPM bajo, rubros bajo 60 %, PDA con mayoría en `requiere_apoyo`). Navegación con teclado y táctil; imprimible.
- Con un solo trimestre de datos, la comparación se oculta o dice "sin trimestre anterior"; nada de deltas inventados.
- Es una presentación para padres de todo el grupo: nada de etiquetas negativas asociadas a nombres en pantalla grande. Las áreas de atención por alumno se muestran de forma agregada o con cuidado; decide lo más prudente y documéntalo.

### 3.6 B.8.5 Exportación
CSV y XLSX del concentrado por alumno con las columnas de la hoja `BD_Alumnos` de Fanny (con `DHL`), la calificación confirmada por campo y la asistencia como columna de referencia.

### 3.7 Coherencia y deuda conocida (todo esto entra en "100 % terminado")
- **Concentrado Director** y **Vista Recrea** leen el grano viejo y salen vacíos. Pásalos al motor único / `boleta_trimestral`. El Concentrado dice "usa estos datos para capturar en la plataforma de la SEP": debe mostrar la calificación **confirmada**, marcando lo no confirmado.
- Retira la tarjeta de revisión de tareas del Dashboard (formato viejo, escala 5-10) ahora que "Hoy" la cubre. Inicio debe llevar a "Hoy" o resumirlo, no duplicar la captura.
- `reportes.js` con `.single()` truena para maestros con dos o más grupos. Jorge lo había pospuesto porque no era urgente; ahora que el objetivo es dejarlo completo, corrígelo con un selector de grupo coherente en toda la app.
- Revisa si queda algún otro lugar que escriba o lea `calificaciones` en el grano viejo, o que calcule calificaciones fuera del motor.

### 3.8 B.7 Capa 2 — redacción con IA (opcional, al final)
Botón "Redactar" que manda el JSON de la capa 1 + nombre + grado a Claude y devuelve un párrafo por sección con las reglas de tono de 1.3. **La llave de la API nunca va en el frontend**: función de servidor (Supabase Edge Function) con la llave como secreto. Guarda en `texto_autogenerado`; copia a los campos solo si `editado_manual = false`. Si no existe la llave o el secreto, construye todo, deja el botón detrás de una bandera y anótalo como pendiente para Jorge. No pidas ni inventes llaves.

### 3.9 Documentación
Actualiza `docs/PRODUCTO-MI-SALON.md` para que describa lo que realmente se construyó, y `docs/CONTEXTO.md` con las pruebas, la cuenta de QA (sin la contraseña) y las limitaciones conocidas.

### 3.10 Ensayo final de punta a punta
Con la cuenta de QA, simula un trimestre completo de un grupo 1°-2° como el de Fanny, de principio a fin por la interfaz: importar/crear proyecto → capturar varios días en "Hoy" → cierre del día → diagnóstico → boleta (confirmar y cerrar) → reporte detallado → junta → exportación. Repite lo esencial con un alumno de Fase 4-5. El revisor hace este recorrido, no tú.

---

## 4. Protocolo del ciclo (obligatorio)

### 4.1 El ciclo de cada bloque
1. Plan corto del bloque en `docs/PROGRESO-PARTE-B.md`.
2. Construye. **Usa subagentes en paralelo** donde las piezas no dependan entre sí (por ejemplo boleta, reporte detallado, junta y exportación una vez que exista la capa 1). No pongas a dos subagentes a editar el mismo archivo a la vez.
3. Corre todas las suites de `pruebas/`.
4. Lanza un **subagente revisor nuevo** (sin tu contexto) con solo: el criterio de aceptación del bloque, la sección 1 de este documento, cómo entrar (URL, cuenta de QA) y la instrucción de no confiar en ningún reporte del constructor.
5. Si el revisor da FAIL, corrige y lanza **otro revisor nuevo** (no el mismo). Repite hasta PASS.
6. Con PASS: commit en `mi-salon-parte-b`, marca el bloque en `PROGRESO-PARTE-B.md` con el veredicto y la evidencia, y sigue con el siguiente sin esperar a nadie.

### 4.2 Qué tiene que hacer el revisor siempre
- **Base de datos:** verificar con Supabase MCP (consultas de solo lectura) cada afirmación sobre esquema, constraints, triggers, RLS y conteos.
- **Navegador real:** cargar la página con caché limpia, leer la consola. **Cualquier excepción sin capturar es FAIL**, aunque la pantalla parezca bien. Usa el navegador que tengas (Playwright con Chromium, o Chrome si lo tienes conectado). Si no tienes ninguno, instala Playwright antes de empezar; sin navegador no hay PASS.
- **Persistencia:** hacer una acción, recargar la página completa y comprobar que sigue ahí.
- **Casos límite:** un alumno de Fase 3 y uno de Fase 4-5; aislamiento multigrado (el trabajo de un grado no aparece en otro); un trimestre sin datos; un campo sin evidencias.
- **Aislamiento:** con otra cuenta de maestro, las vistas nuevas devuelven 0 filas del otro maestro.
- **Estilo:** sin emojis, español de México, vista previa de impresión en lo imprimible.
- **Veredicto:** PASS o FAIL con evidencia (consultas, capturas de consola, lo que vio). Nada de "debería funcionar".

### 4.3 Si algo no avanza
Si un bloque falla la revisión 3 veces seguidas por la misma causa, detén ese bloque, documenta el problema en `PROGRESO-PARTE-B.md` y sigue con el siguiente bloque que no dependa de él. Va en el reporte final.

### 4.4 Si se interrumpe la sesión
`docs/PROGRESO-PARTE-B.md` es la memoria. Al retomar, léelo primero y continúa desde el último bloque con PASS.

---

## 5. Límites (no los cruces aunque parezca conveniente)

- **No push a `main` ni merge.** Todo queda en `mi-salon-parte-b`. Eso lo decide Jorge.
- **Supabase es producción.** Migraciones solo aditivas o sobre tablas vacías. Nunca `DELETE`/`UPDATE` sobre filas que no sean tuyas de QA/DEMO. Antes de cerrar cada bloque, confirma que los datos reales no cambiaron (hoy: 18 alumnos, 404 asistencias en la base).
- **No toques `tienda/`** ni el flujo de compra.
- **Nada de secretos en el frontend** ni en git.
- **No tomes decisiones de producto ni legales nuevas.** Ejemplos: agregar "retardo" a asistencia, cambiar los pesos por defecto (28/28/6/5/33), reinterpretar el Acuerdo. Si surge una, elige la opción más conservadora, sigue, y anótala en "Decisiones pendientes para Jorge".
- Borra los datos DEMO de cada bloque al terminarlo; la cuenta y los grupos de QA se quedan para el ensayo final y para el futuro.

---

## 6. Reporte final (lo único que recibe Jorge)

Cuando todo esté en PASS (o documentado como bloqueado), escribe `docs/REPORTE-FINAL-PARTE-B.md` y avísale a Jorge con:
1. Qué quedó construido, bloque por bloque, con el veredicto del revisor y su evidencia.
2. Lista de suites de prueba y su resultado.
3. Decisiones pendientes para Jorge (con la opción que tomaste mientras tanto).
4. Bloques detenidos, si los hubo, y por qué.
5. Cómo probarlo en 10 minutos: URL, cuenta de QA (la contraseña está en el archivo local), y el recorrido.
6. Si en tu opinión la rama está lista para `main`, y qué riesgos ves.

Después de ese reporte, el Claude que revisaba hará una auditoría final independiente antes de que Jorge haga el merge.
