# Encargo de diseño: Jissez · Mi Salón

> Para Claude Design. Este paquete describe **qué pantallas diseñar** para **Mi Salón**, la
> herramienta diaria de maestras y maestros de primaria de Jissez. El diseño debe verse como parte
> de la misma marca que la tienda Jissez, que ya está diseñada: quien vea la web debe reconocer
> la marca de inmediato.
>
> Adjuntos de este paquete:
> - `capturas/actual/`: cómo se ven hoy las pantallas de Mi Salón, a 1280 px (escritorio) y a
>   390 px (celular). Son la referencia de **contenido y funciones**, no de estilo; el estilo actual
>   es provisional.
> - `capturas/tienda/`: la tienda ya diseñada, que es la referencia de **estilo**.
> - Las capturas son de página completa. En las de celular, la barra de secciones (Tienda · Mi Salón · Sala)
>   aparece a media página por la forma de capturar; en el teléfono va **fija abajo**. Los nombres "QA …"
>   y los grupos son datos de prueba.
> - `marca/`: logos, tokens de color y CSS compartido de la tienda.
> - Junto con este paquete va el paquete de diseño de la tienda (`design_handoff_jissez/`), con los
>   HTML originales de la tienda.

---

## 1. Qué es Mi Salón y quién lo usa

- **Quién:** maestras y maestros de primaria pública en México, bajo la Nueva Escuela Mexicana
  (NEM). Muchas escuelas son rurales y **multigrado**: un grupo con alumnos de 2 o 3 grados
  distintos.
- **Dónde y con qué:** **dentro del aula**, durante la clase, con una laptop, una tablet (Samsung
  Galaxy Tab S9 FE+ de 12.4", en horizontal) o un celular. La conexión suele ser mala. Tienen
  poco tiempo y muchas interrupciones.
- **Para qué:** pasar lista, calificar los trabajos del día con un semáforo, hacer el cierre del
  día (participación y conducta), llevar el diagnóstico y, al final del trimestre, obtener la
  boleta con calificaciones propuestas y textos para las familias, más reportes para la junta de
  padres.
- **La promesa:** dejar los Excel y ahorrar horas. Cada toque cuenta: lo más frecuente (Hoy) debe
  estar a un toque y ser rápido con una mano.
- **Legal:** la calificación es juicio del docente. Mi Salón **propone** y la maestra **confirma**;
  nada numérico se cierra sin su confirmación. Es un complemento de la boleta oficial (SIGED) y no
  la sustituye.

## 2. Marca: la misma que la tienda

Usa exactamente el sistema de la tienda (ver `marca/` y `design_handoff_jissez/README.md` §3).

| Token | Hex | Uso en Mi Salón |
|---|---|---|
| `board` | `#1e3a8a` | Azul pizarrón: barra superior, selección, botones secundarios |
| `board.deep` / `board.soft` | `#16276b` / `#26499f` | Hover y variantes |
| `ink` / `mute` | `#1c2434` / `#5b6473` | Texto principal / secundario |
| `line` | `#e7e6df` | Bordes y divisores |
| `paper` | `#faf9f4` | Fondo cálido de página |
| `action` | `#059669` | Verde: acción principal ("Guardar", "Confirmar", "Cerrar día") |

- **Tipografía:** Inter, títulos en 800–900 con `tracking-tight`.
- **Radios:** 24 px en tarjetas grandes, 16 px en tarjetas e inputs, 12 px en botones.
- **Detalles de marca:** textura de pizarrón (`.board-tex`) y subrayado de gis (`.chalk-u`).

**Colores propios de Mi Salón.** Ya se usan y se mantienen:

- **Campos formativos NEM:**
  - LEN Lenguajes `#059669`
  - SAB Saberes y Pensamiento Científico `#ea580c`
  - ETI Ética, Naturaleza y Sociedades `#7c3aed`
  - DHL De lo Humano y lo Comunitario `#0284c7`
- **Grados:** colores de gis de la tienda. 1° `#f2cf6b`, 2° `#85b8e6`, 3° `#79c8a6`,
  4° `#a99fe0`, 5° `#ef9277`, 6° `#f0b285`. Se usan en insignias de grado en grupos multigrado.
- **Semáforo de desempeño:**
  - Logrado: verde
  - En proceso: ámbar
  - Requiere apoyo: rojo suave

  Debe leerse también sin color: texto o icono, por accesibilidad.

**Reglas duras:**
- **Sin emojis** en ningún lugar: se ve barato. Iconos **Lucide**.
- Español de México.
- Botones y áreas de toque de **al menos 44 px**.
- Responsive real en 1280, 1024 (tablet horizontal), 768 y 390 px, sin scroll horizontal.
- Estilo sobrio tipo Notion/Linear: mucho aire, jerarquía clara y nada recargado.

## 3. Navegación (define esto primero)

- **Selector de secciones de Jissez:** Tienda · Mi Salón · Sala de Maestros ("Próximamente").
  - En PC y tablet: pestañas en la barra superior, junto al logo y la cuenta.
  - En celular: **barra fija abajo** con tres iconos y su etiqueta, como la app de Facebook. Respeta
    la zona segura inferior del teléfono y no tapa botones fijos.
  - Solo lo ven las cuentas con acceso a Mi Salón. Los compradores de la tienda no ven cambios.
- **Sub-navegación de Mi Salón:** Inicio · Hoy · Asistencia · Actividades · Tareas · Reportes ·
  Proyectos, más Mi grupo, Diagnóstico, Evaluación formativa, Exámenes, Ajustes y Mi cuenta en un
  menú. En celular hoy es un carrusel horizontal arriba.
  - Propón la mejor organización para que **Hoy** quede siempre a un toque.
- **Selector de grupo activo:** una maestra puede tener varios grupos. Hoy está en la barra; que
  sea claro en qué grupo está trabajando.
- **Vista de app instalada:** Mi Salón se podrá instalar como app. Al abrirla entra directo a
  Hoy, y dentro de la app se ocultan la tienda y lo que no sirve. Contempla cómo se ve en ese modo.

## 4. Pantallas a diseñar, en orden de prioridad

Para cada pantalla diseña escritorio (1280), tablet horizontal (1024) y celular (390), con sus
**estados**. La columna "Captura actual" dice qué archivo de `capturas/actual/` mirar para el
contenido.

### Prioridad 1: lo de todos los días (en el aula)

| Pantalla | Archivo | Qué hace | Estados a diseñar | Captura actual |
|---|---|---|---|---|
| **Hoy** | `hoy.html` | La pantalla más importante. Asistencia del día (Presente / Falta / Justificada, un toque por alumno), trabajos y tareas del día con semáforo por alumno y grado, retroalimentación opcional, y **cierre del día** (participación y conducta 0/1/2, "Guardar el cierre de hoy"). "Trabajar hoy" agrega una sesión del proyecto. Guardado automático con indicador. | Normal; multigrado (productos agrupados por grado); sin proyecto activo; sin conexión (se guardará al volver); guardando / guardado / error; nadie asistió; día ya cerrado | `hoy-*` |
| **Inicio** | `dashboard.html` | Resumen del día: qué falta (asistencia, cierre, productos por calificar, tareas por revisar), acceso directo a Hoy, proyecto activo y plan de la sesión, avisos (por ejemplo, "elige tu estado") | Normal; día completo; sin proyecto; error "No se pudo cargar" con Reintentar | `inicio-*` |
| **Asistencia** | `asistencia.html` | Lista por fecha, tres opciones por alumno, "Presentes los que faltan", cambio de fecha | Normal; día sin datos; guardando o error | `asistencia-*` |
| **Mi grupo** | `mi-grupo.html` | Alumnos (número de lista, nombre, grado), alta, edición, baja y borrado; editar grupo; **trimestre actual** con sugerencia del calendario SEP | Normal; grupo vacío; multigrado; confirmación de borrado | `mi-grupo-*` |
| **Onboarding** | `onboarding.html` | Primer uso: crear el grupo (nombre, escuela, **estado**, organización, grados, ciclo, trimestre) y dar de alta a los alumnos | Paso 1 y paso 2; errores de validación | `onboarding-*` |

### Prioridad 2: fin de trimestre (boleta y reportes)

| Pantalla | Archivo | Qué hace | Estados a diseñar | Captura actual |
|---|---|---|---|---|
| **Reportes** | `reportes.html` | Pestañas: Asistencia, Vista Recrea, Concentrado, **Boleta** y Avance por PDA. La pestaña **Boleta** es clave: por alumno y trimestre muestra el desglose por campo (rubros, pesos efectivos, porcentaje, semáforo), la **calificación propuesta** (6 a 10 en 1°; 5 a 10 de 2° a 6°) para **confirmar**, textos propuestos editables (fortalezas, áreas de oportunidad y sugerencias por campo; trabajo diario), "Cerrar boleta" y la evaluación final del ciclo (T1, T2, T3, Final, Promedio de grado y Acredita / Revisar / No acredita) | Propuesta sin confirmar; confirmada; **cerrada** (solo lectura); campo sin evidencias ("Elige" por juicio docente); calificación fuera de escala; error de guardado | `reportes-*` |
| **Boleta imprimible** | `boleta.html` | Documento **para las familias**, tamaño carta (2 páginas): datos, calificaciones por campo y trimestre, final, acreditación en lenguaje para familias, observaciones, cuaderno y habilidades, asistencia de referencia, firma | Pantalla y **vista de impresión**; boleta cerrada; alumno de 1° y de 4° | `boleta-*` |
| **Reporte detallado** | `reporte-alumno.html` | Para el docente y la familia: resumen, desempeño por campo con rubros, avance por PDA, fluidez lectora contra la referencia de su grado y evaluación final | Normal; boleta cerrada; impresión | `reporte-*` |
| **Presentación para la junta** | `junta.html` | Diapositivas **16:9** para proyectar en la junta de padres: panorama del grupo, por grado, por campo, fluidez, áreas de atención y comparativo con el trimestre anterior. Sin nombres por defecto (privacidad), con un interruptor para mostrarlos | Diapositivas tipo; con y sin nombres; sin datos | `junta-*` |
| **Exportar** | `exportar.html` | Descarga CSV / Excel del concentrado, con vista previa de la tabla | Normal; mezcla de boletas abiertas y cerradas | `exportar-*` |

### Prioridad 3: planear y dar seguimiento

| Pantalla | Archivo | Qué hace | Captura actual |
|---|---|---|---|
| **Proyectos** | `planeacion.html` | Lista de proyectos del grupo (estado, trimestre, campos), iniciar, clonar, Marketplace y "Nuevo proyecto" | `proyectos-*` |
| **Crear proyecto** | `crear_proyecto.html` | Asistente de varios pasos: datos del proyecto, contenidos y PDA por grado, sesiones con actividades (para todos o diferenciadas por grado), criterios sugeridos y productos | `crear-proyecto-*` |
| **Marketplace (importar)** | `marketplace.html` | Importar planeaciones hechas al grupo, con vista previa de sesiones | `marketplace-*` |
| **Actividades** | `actividades.html` | Plan de la sesión del día por momento | `actividades-*` |
| **Tareas** | `tareas.html` | Seguimiento de tareas: por revisar, vencidas y revisadas | `tareas-*` |

### Prioridad 4: evaluación

| Pantalla | Archivo | Qué hace | Captura actual |
|---|---|---|---|
| **Diagnóstico** | `evaluacion_diagnostica.html` | Por alumno: cuaderno (10 criterios), fluidez lectora (palabras por minuto contra la "referencia SEP 2010" de su grado) y comprensión, habilidades de matemáticas **según su grado** (1°: 4, 2°: 7, 3° a 6°: 8, cada una con su alcance) y observaciones; navegación Anterior / Siguiente entre alumnos | `diagnostico-*` |
| **Evaluación formativa** | `evaluacion_formativa.html` | Semáforo por PDA y por alumno en una sesión, con observaciones | `formativa-*` |
| **Exámenes** | `examen.html` | Lista de exámenes y captura de respuestas por alumno | `examen-*` |

### Prioridad 5: cuenta y secciones

| Pantalla | Archivo | Qué hace | Captura actual |
|---|---|---|---|
| **Ajustes** | `ajustes.html` | Pesos de los rubros (relativos; la conducta no pondera), eliminar cuenta | `ajustes-*` |
| **Mi cuenta** | `mi-cuenta.html` | Nombre, trato (profesora / profesor), estado donde da clases | `mi-cuenta-*` |
| **Sala de Maestros** | `sala-maestros.html` | "Próximamente": espacio para compartir material didáctico entre docentes | `sala-*` |
| **Página de presentación de Mi Salón** (nueva) | — | Para el lanzamiento: qué es, qué resuelve (Excel, horas perdidas, boleta), cómo se ve en el aula, funciones clave, "Instalar la app", precios o suscripción (por definir). Con el mismo lenguaje visual del landing de la tienda | — (ver `capturas/tienda/landing-*`) |

## 5. Componentes y estados comunes (diséñalos una vez)

- **Barra superior** con selector de secciones, grupo activo y cuenta; **barra inferior** en
  celular.
- **Tarjeta de alumno** con número de lista, nombre, insignia de grado y control de un toque.
- **Semáforo** Logrado / En proceso / Requiere apoyo: botones grandes y claros, y marcado sin
  color también.
- **Insignia de campo formativo** (4 colores NEM) e **insignia de grado** (colores de gis).
- **Indicador de guardado:** guardando, guardado, error y **sin conexión (se guardará al volver)**.
- **Aviso de página:** "No se pudo cargar esta página. Revisa tu conexión." con botón Reintentar.
- **Estados vacíos** con una acción clara ("Crea tu primer proyecto", "Da de alta a tus alumnos").
- **Confirmaciones** de acciones irreversibles: cerrar boleta, borrar alumno, eliminar cuenta.
- **Insignias de estado de boleta:** propuesta, confirmada, cerrada, pendiente y "Revisar".

## 6. Qué entregar

Igual que en la tienda: **prototipos HTML hi-fi** con Tailwind (CDN) y los tokens de `marca/`,
iconos Lucide, una página por pantalla y los estados indicados. Los datos son de ejemplo. Usa un
grupo multigrado de 1° y 2° con 8 alumnos y otro de 3° y 4°. Contenidos, nombres de campos y
términos NEM deben ser **exactos**:
- "Procesos de Desarrollo de Aprendizaje (PDA)";
- "Nueva Escuela Mexicana";
- los nombres completos de los campos formativos.
