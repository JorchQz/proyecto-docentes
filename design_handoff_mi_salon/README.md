# Encargo de diseño: Jissez · Mi Salón y Sala de Maestros

> **Para Claude Design.** Versión 2 (2026-09-26). Sustituye por completo a la versión del
> 2026-09-25: la navegación, varias pantallas y todas las capturas cambiaron.
>
> Este paquete dice **qué pantallas diseñar**, para quién, con qué reglas y qué no debe cambiar.
> El diseño debe verse como parte de la misma marca que la **tienda Jissez**, que ya está
> diseñada (paquete `design_handoff_jissez/`, que va junto a este): quien vea Mi Salón debe
> reconocer la marca de inmediato.

---

## 0. Cómo leer este paquete

| Carpeta | Qué hay |
|---|---|
| `capturas/actual/` | Cómo se ve **hoy** Mi Salón (lo publicado en jissez.com, rama `mi-salon-parte-b`). Una carpeta por pantalla, numeradas en el orden de §6. Son la referencia de **contenido, funciones y estados**, no de estilo: el estilo actual es provisional, salvo la navegación (§5), que ya está decidida. |
| `capturas/tienda/` | La tienda ya diseñada: la referencia de **estilo**. |
| `marca/` | Logos (azul y blanco), `tienda-theme.js` (tokens de Tailwind) y `tienda.css` (textura de pizarrón y subrayado de gis). |
| `../design_handoff_jissez/` | El paquete de diseño de la tienda, con sus HTML originales y su README (tokens en §3). |

**Nombres de archivo:** `pantalla--estado--tamaño.png`. Tamaños:

| Sufijo | Tamaño CSS | Qué representa |
|---|---|---|
| `tablet-horizontal` | 1280 × 800 | La Samsung Galaxy Tab S9 FE+ en horizontal (el aparato principal) y también la PC |
| `tablet-vertical` | 800 × 1280 | La misma tablet en vertical |
| `celular` | 390 × 844 | Un teléfono |

- Las capturas son de **pantalla completa**: la ventana se estiró al alto de la página, así que
  la barra lateral llega hasta abajo y, en celular y tablet vertical, la barra de accesos
  rápidos aparece **al pie** de la imagen (en el aparato va fija abajo de la pantalla).
- Los **menús y diálogos** (carpeta `00-navegacion` y los estados `confirmar-eliminar`,
  `dia-ajuste`, `nueva-lista`, `agregar-columna`) se capturaron **a tamaño de ventana**, como
  se ven en el aparato.
- **Todos los datos son de prueba o ficticios.** Hay dos cuentas de QA:
  - `qa.misalon@jissez.com` con los grupos "QA 1°-2° (Fase 3)" y "QA 3°-4° (Fase 4)". Los
    alumnos se llaman "QA ANA TORRES (sobresaliente)" y similares: el paréntesis es una nota
    de prueba, **no** es parte del diseño.
  - `qa.aislamiento@jissez.com` con el grupo "QA Aislamiento (vacío)" (estados vacíos) y el
    grupo "Diseño 3°-4° (muestra)", con alumnos, incidencias, listas y cumpleaños inventados.
  - Ningún nombre, teléfono ni correo de las capturas es de una persona real.
- La fecha de las capturas es el **sábado 26 de septiembre de 2026**. Por eso "Hoy" no muestra
  sesiones del día.
- Lo que las capturas **no** muestran (diséñalo con la descripción de §6): el Marketplace sale
  vacío ("Catálogo en camino") porque en pruebas no hay planeaciones publicadas; de Crear
  proyecto solo está el paso 1; de la Junta solo la portada (son 9 diapositivas); no hay boleta
  confirmada ni cerrada; la ficha del alumno se edita **dentro de la página** de Mi grupo (no es
  un diálogo).

### Índice de capturas

164 capturas en 26 carpetas. Cada estado está en los tres tamaños, salvo donde se indica.

| Carpeta | Estados | Tamaños |
|---|---|---|
| `00-navegacion/` | barra-lateral, barra-contraida (solo tablet horizontal); encabezado-y-accesos, menu-abierto (tablet vertical y celular); menu-abierto-sala (celular) | los tres, según el estado |
| `01-inicio/` | normal, con-cumpleanos, grupo-vacio | los tres |
| `02-hoy/` | normal, grupo-vacio | los tres |
| `03-asistencia/` | normal | los tres |
| `04-actividades/` | normal | los tres |
| `05-tareas/` | normal | los tres |
| `06-proyectos/` | normal | los tres |
| `07-crear-proyecto/` | paso-1 | los tres |
| `08-marketplace/` | normal (vacío) | los tres |
| `09-diagnostico/` | normal | los tres |
| `10-evaluacion-formativa/` | normal | los tres |
| `11-examenes/` | normal | los tres |
| `12-reportes/` | asistencia, vista-recrea, concentrado, boleta, avance-pda, que-le-falta-grupo, que-le-falta-alumno | los tres |
| `13-boleta-imprimible/` | normal | los tres |
| `14-reporte-alumno/` | normal | los tres |
| `15-junta/` | normal (portada) | los tres |
| `16-exportar/` | normal | los tres |
| `17-mi-grupo/` | normal, con-ficha-y-aviso, ficha-del-alumno, grupo-vacio | los tres |
| `18-incidencias/` | lista, nueva, documento, confirmar-eliminar, vacio | los tres |
| `19-calendario/` | mes, dia-ajuste, cumpleanos, cumpleanos-vacio, rol-de-aseo-sin-generar, rol-de-aseo-generado | los tres |
| `20-listas/` | abiertas, detalle-lista, nueva-lista, agregar-columna, historial, por-alumno, vacio | los tres |
| `21-ajustes/` | normal | los tres |
| `22-mi-cuenta/` | normal | los tres |
| `23-sala-de-maestros/` | proximamente | los tres |
| `24-onboarding/` | paso-1 | los tres |
| `25-app-instalada/` | hoy-en-modo-app, sin-conexion | tablet horizontal y celular |

---

## 1. Qué es el producto

**Jissez** tiene tres secciones con una sola cuenta:

1. **Tienda** (ya diseñada): venta de planeaciones didácticas de la Nueva Escuela Mexicana
   (NEM) para primaria. Es lo único que ven quienes solo compran.
2. **Mi Salón**: la herramienta diaria de la maestra o el maestro para llevar su grupo. Es el
   centro de este encargo.
3. **Sala de Maestros**: un espacio para compartir material didáctico entre docentes. Hoy es
   una página "Próximamente".

**Mi Salón, en una línea:** pasa lista y califica en minutos, y al final del trimestre la
boleta, los reportes y la presentación para la junta de padres salen solos, ligados a los
Procesos de Desarrollo de Aprendizaje (PDA) de la planeación.

Lo que hace:

- **Día a día:** pasar lista, calificar los trabajos y tareas de cada sesión con un semáforo
  (Logrado / En proceso / Requiere apoyo) y hacer el cierre del día (participación y
  conducta). Todo en una sola pantalla: **Hoy**.
- **Planeación:** proyectos del grupo (hechos a mano o importados del Marketplace), con sus
  sesiones, productos y PDA por grado.
- **Evaluación y reportes:** diagnóstico (cuaderno, lectura y matemáticas), exámenes, boleta
  trimestral con calificación **propuesta** que la maestra **confirma**, reporte por alumno,
  "Qué le falta" a cada alumno, presentación para la junta, vista para capturar en la
  plataforma oficial y exportación a Excel.
- **Organización del grupo:** alumnos con su ficha, incidencias con documento para firmar,
  calendario escolar SEP con cumpleaños y rol de aseo, y listas de cooperación y materiales.
- **App instalable** ("Jissez MS", bajo `jissez.com/salon/`): entra directo a Hoy y guarda en
  el aparato lo capturado en Hoy si se va la señal, para enviarlo al volver.

**Legal, en corto:** la calificación es juicio del docente. Mi Salón **propone** y la maestra
**confirma**; nada numérico se cierra sin su confirmación. Es un **complemento** de la boleta
oficial (SIGED), no la sustituye, y así lo dice en pantalla.

---

## 2. Quién lo usa

- **Maestras y maestros de primaria pública en México**, bajo la NEM. El caso de diseño es una
  **maestra rural multigrado**: un solo grupo con alumnos de 2, 3 o más grados en el mismo
  salón (por ejemplo 1° y 2°, o 3° a 6°).
- **Aparato principal: tablet Samsung Galaxy Tab S9 FE+ de 12.4"**, casi siempre en
  **horizontal** (1280 × 800 px CSS) y con el dedo. También la usan en vertical, en celular y
  en PC.
- **Dónde:** dentro del salón, durante la clase, con interrupciones, poco tiempo, a veces con
  una mano y con mala señal. A veces con luz de sol: contraste alto.
- **Qué quiere:** dejar los Excel (hoy repite la lista del grupo en un archivo por campo
  formativo y escribe a mano los máximos y los textos de la boleta) y ahorrar horas. Lo más
  frecuente, **Hoy**, siempre a un toque.

---

## 3. Reglas duras

- **Sin emojis en ningún lugar** (UI, botones, estados vacíos, textos generados). Se ven
  baratos. Iconos **Lucide** (`https://unpkg.com/lucide@latest`). Las flechas tipográficas
  (→, ←) sí se permiten.
- **Áreas de toque de 44 px o más** en todo lo que se toca: botones, pestañas, casillas,
  filas, días del calendario, celdas de las listas.
- **Español de México (es-MX)**: "celular", "alumno", "maestra", "Presente / Falta /
  Justificada", fechas "sábado, 26 de septiembre", pesos "$1,045.70".
- **Estilo sobrio tipo Notion / Linear**: mucho aire, jerarquía clara, nada recargado,
  tarjetas con sombra suave. Paleta de **azul profundo, blanco y verde** (§4).
- **Responsive real** en 1280, 1024, 800 y 390 px, sin scroll horizontal de la página (una
  tabla ancha se desplaza dentro de su tarjeta).
- **Accesible:** el semáforo y los estados se leen también **sin color** (texto o icono);
  foco visible; contraste AA.
- **Términos NEM exactos:** "Procesos de Desarrollo de Aprendizaje (PDA)", "Nueva Escuela
  Mexicana", y los nombres completos de los campos formativos: Lenguajes; Saberes y
  Pensamiento Científico; Ética, Naturaleza y Sociedades; De lo Humano y lo Comunitario.

---

## 4. Marca: la misma que la tienda

Usa el sistema de la tienda (`marca/` y `design_handoff_jissez/README.md` §3).

| Token | Hex | Uso en Mi Salón |
|---|---|---|
| `board` | `#1e3a8a` | Azul pizarrón: encabezados de página, selección, botones secundarios |
| `board.deep` / `board.soft` | `#16276b` / `#26499f` | Barra lateral (`#16276b`), hover y variantes |
| `ink` / `mute` | `#1c2434` / `#5b6473` | Texto principal / secundario |
| `line` | `#e7e6df` | Bordes y divisores |
| `paper` | `#faf9f4` | Fondo cálido de página |
| `action` | `#059669` | Verde: acción principal ("Guardar", "Confirmar", "Guardar el cierre de hoy") y marca de la página actual en el menú |

- **Tipografía:** Inter; títulos en 800-900 con `tracking-tight`.
- **Radios:** 24 px en tarjetas grandes, 16 px en tarjetas e inputs, 12 px en botones.
- **Detalles de marca:** textura de pizarrón (`.board-tex`) y subrayado de gis (`.chalk-u`).

**Colores propios de Mi Salón (se mantienen):**

- **Campos formativos:** LEN Lenguajes `#059669` · SAB Saberes y Pensamiento Científico
  `#ea580c` · ETI Ética, Naturaleza y Sociedades `#7c3aed` · DHL De lo Humano y lo Comunitario
  `#0284c7`.
- **Grados** (colores de gis de la tienda, en insignias de grado): 1° `#f2cf6b`, 2° `#85b8e6`,
  3° `#79c8a6`, 4° `#a99fe0`, 5° `#ef9277`, 6° `#f0b285`.
- **Semáforo:** Logrado verde, En proceso ámbar, Requiere apoyo rojo suave. Siempre con texto.

---

## 5. Navegación y sus cortes (ya decidida y construida)

Aplica a Mi Salón y a Sala de Maestros. La tienda conserva su navegación. Puedes pulir el
estilo, pero **no** la estructura, los cortes ni el orden. Capturas: `00-navegacion/`.

**Corte: 1024 px de ancho.**

### De 1024 px en adelante (tablet horizontal y PC): barra lateral

Barra lateral izquierda de 256 px, azul profundo `#16276b`
(`navegacion--barra-lateral--tablet-horizontal.png`). De arriba abajo:

1. Marca Jissez y el botón para contraer.
2. Selector de secciones **Tienda · Mi Salón · Sala**, con la actual en blanco.
3. **Grupo activo**: selector si hay 2 o más grupos; solo el nombre si hay uno.
4. Menú agrupado, con la página actual marcada con un trazo de gis verde:
   - **Día a día:** Inicio, Hoy, Asistencia, Actividades, Tareas.
   - **Planeación:** Proyectos, Marketplace.
   - **Evaluación y reportes:** Diagnóstico, Exámenes, Reportes.
   - **Grupo:** Mi grupo, Incidencias, Calendario, Listas.
5. Abajo, la **cuenta**: el nombre abre Mi cuenta, Ajustes, Instalar la app (cuando aplica) y
   Cerrar sesión.

- Marca, secciones y grupo quedan fijos arriba. Si el menú no cabe (800 px de alto), **solo
  el menú** se desplaza, con sombra que indica que hay más, y la página actual queda a la vista.
- **Contraída** (`navegacion--barra-contraida--tablet-horizontal.png`): 72 px, solo iconos,
  con tooltip y nombre accesible. Se recuerda en el aparato.

### Debajo de 1024 px (tablet vertical y celular)

- **Encabezado fijo de 56 px:** botón de menú, nombre de la página y grupo activo
  (`navegacion--encabezado-y-accesos--*.png`).
- **Barra de accesos rápidos abajo:** **Hoy, Asistencia, Reportes y Más**, con la activa
  marcada y respetando el área segura del teléfono. "Más" abre el mismo panel que el botón de
  menú.
- **Panel lateral** (`navegacion--menu-abierto--*.png`): secciones, menú completo y cuenta.
  Foco atrapado; Esc y tocar fuera lo cierran; el fondo no se desplaza.
- **Sala de Maestros** tiene un solo destino, así que su barra de abajo lleva solo "Más", en
  el mismo lugar (`navegacion--menu-abierto-sala--celular.png`).

### Reglas que no cambian

- Lo fijo de cada página (avisos de Hoy, pies con botones) empieza después de la barra lateral
  y, en celular, **sube** lo que mide la barra de abajo: nunca queda tapado.
- Sin brincos al cargar: el espacio de la navegación se aparta desde el primer pintado.
- Al imprimir no sale nada de la navegación.
- Dentro de la app instalada (`/salon/`) nada se sale de la app, salvo la Tienda, que se abre
  en el navegador.
- El selector de secciones solo aparece a cuentas con acceso a Mi Salón.

---

## 6. Pantallas a diseñar

Para cada pantalla: **tablet horizontal (1280 × 800), tablet vertical (800 × 1280) y celular
(390 × 844)**, con los estados indicados. Diseña primero la prioridad 1.

Estados que aplican a **todas** las pantallas con datos (no se repiten en cada fila):
cargando; error de lectura ("No se pudo cargar esta página. Revisa tu conexión." con
**Reintentar**, nunca una pantalla vacía que parezca sin datos); guardando / guardado / error
de guardado; sin grupo (lleva al alta).

### Prioridad 1: lo de todos los días, en el aula

| # | Pantalla | Archivo | Propósito | Estados a diseñar | Capturas |
|---|---|---|---|---|---|
| 1 | **Hoy** | `hoy.html` | La pantalla más importante. En una sola página con scroll: 1) **Asistencia** (Presente / Falta / Justificada, un toque por alumno); 2) **Tareas por revisar** (Entregó / Incompleta / No entregó / Justificada; en multigrado, agrupadas por grado); 3) **Sesiones de hoy**: por producto, semáforo por alumno, "Detalle" con puntaje 0-10 opcional y retroalimentación con frases rápidas, "Agregar producto"; 4) **Cierre del día**: participación y conducta 0 · 1 · 2 (valor normal 1; solo se tocan las excepciones) y "Guardar el cierre de hoy". "Trabajar hoy" trae las siguientes sesiones del proyecto. Se guarda al tocar, sin botón de guardar. | Normal; multigrado (productos por grado); sin sesiones hoy / sin proyecto; **sin señal** ("se guardará al volver", aviso fijo abajo); conflicto con otro aparato (aviso); nadie asistió; día ya cerrado; grupo sin alumnos | `02-hoy/` |
| 2 | **Inicio** | `dashboard.html` | Resumen del día y puerta a Hoy: qué falta (asistencia, cierre, productos por calificar, tareas por revisar), proyecto activo y plan de la sesión, **próximos cumpleaños** (una línea discreta en el encabezado: como mucho 3 nombres "y N más", con enlace a Calendario → Cumpleaños), avisos ("elige tu estado") y la tarjeta "Instala Mi Salón como app" al final | Normal; con cumpleaños; día completo; sin proyecto; grupo vacío; error con Reintentar | `01-inicio/` |
| 3 | **Asistencia** | `asistencia.html` | Lista por fecha con tres opciones por alumno, "Presentes los que faltan" y cambio de fecha; mismas reglas que Hoy | Normal; día sin datos; guardando o error | `03-asistencia/` |
| 4 | **Mi grupo** | `mi-grupo.html` | Datos del grupo (nombre, organización, grados, **escuela y director(a) del grupo**, niñas y niños), **trimestre actual** con sugerencia del calendario SEP, **aviso a las familias** (texto listo con Copiar, Compartir por WhatsApp e Imprimir) y alumnos: número de lista, nombre, grado, alta, edición, baja y borrado. La **ficha del alumno** (todo opcional): fecha de nacimiento, género (Niña / Niño / Prefiero no decir), nombre y teléfono del tutor, con botón de WhatsApp al tutor | Normal; con ficha y aviso; editando la ficha; grupo vacío; multigrado; confirmación de borrado (explica que sale de las incidencias) | `17-mi-grupo/` |
| 5 | **Primeros pasos** | `onboarding.html` | Primer uso: crear el grupo (nombre, escuela, **estado**, organización, grados, ciclo, trimestre) y dar de alta a los alumnos | Paso 1; paso 2; errores de validación | `24-onboarding/` |

### Prioridad 2: fin de trimestre (boleta y reportes)

| # | Pantalla | Archivo | Propósito | Estados a diseñar | Capturas |
|---|---|---|---|---|---|
| 6 | **Reportes** | `reportes.html` | Pestañas: **Asistencia**, **Vista Recrea** (calificación confirmada por alumno y campo, para capturar en la plataforma oficial), **Concentrado Director** (evaluación final del ciclo y acreditación), **Boleta**, **Avance por PDA** y **Qué le falta**. La pestaña **Boleta**: por alumno y trimestre, desglose por campo (rubros, pesos efectivos, porcentaje, semáforo), **calificación propuesta** para **confirmar** (6 a 10 en 1°; 5 a 10 de 2° a 6°), textos editables (fortalezas, áreas de oportunidad y sugerencias por campo; trabajo diario), "Cerrar boleta" y evaluación final (T1, T2, T3, Final, Promedio de grado y Acredita / Revisar / No acredita). **Qué le falta:** lista del grupo con la cuenta de pendientes por campo; al tocar un alumno, su detalle (productos sin entregar, PDA en proceso o requiere apoyo, campos sin evidencia, "Revisar" bajo el mínimo de su grado), en tono formativo. En celular las pestañas se desplazan con flechas | Propuesta sin confirmar; confirmada; **cerrada** (solo lectura); campo sin evidencias ("Elige", juicio docente); fuera de escala; Qué le falta del grupo, de un alumno y "Trimestre cerrado"; sin datos | `12-reportes/` |
| 7 | **Boleta imprimible** | `boleta.html` | Documento **para las familias**, carta vertical, 2 páginas: datos, calificaciones por campo y trimestre, final, acreditación en lenguaje para familias, observaciones, cuaderno y habilidades, asistencia de referencia, firmas | Pantalla y **vista de impresión**; cerrada; alumno de 1° y de 4° | `13-boleta-imprimible/` |
| 8 | **Reporte del alumno** | `reporte-alumno.html` | Para la maestra y la familia: resumen, **Qué le falta** (sección 2), desempeño por campo con rubros, avance por PDA, fluidez lectora contra la "referencia SEP 2010" de su grado y evaluación final | Normal; cerrada; impresión (lo que es solo de la maestra no se imprime) | `14-reporte-alumno/` |
| 9 | **Junta de padres** | `junta.html` | Diapositivas **16:9** para proyectar: panorama, por grado, por campo, fluidez, áreas de atención y comparativo con el trimestre anterior. **Sin nombres por defecto**, con un interruptor para mostrarlos | Diapositivas tipo; con y sin nombres; sin datos | `15-junta/` |
| 10 | **Exportar** | `exportar.html` | Descarga CSV / Excel del concentrado (con hojas de Incidencias, Calendario y Listas cuando hay), con vista previa | Normal; boletas abiertas y cerradas mezcladas | `16-exportar/` |

### Prioridad 3: organización del grupo (pantallas nuevas)

| # | Pantalla | Archivo | Propósito | Estados a diseñar | Capturas |
|---|---|---|---|---|---|
| 11 | **Incidencias** | `incidencias.html` | Registro de sucesos del salón por grupo: asunto, fecha y hora, **alumnos involucrados** (uno o varios), descripción y acuerdos. Lista con Ver e imprimir, Editar y Eliminar. **Documento imprimible** con escuela y director(a) del grupo y firmas de docente, director(a) y madre, padre o tutor. Al imprimir para las familias salen **dos tantos por alumno** (ejemplar para el expediente y copia para la familia), cada uno **solo con ese alumno**; con varios alumnos, además, un resumen para el expediente | Lista; vacío; nueva / editar (formulario); documento; confirmar eliminar; aviso si falta la escuela o el director | `18-incidencias/` |
| 12 | **Calendario** | `calendario.html` | Tres pestañas: **Calendario** (calendario escolar SEP 2026-2027 del grupo: vista de mes con colores y leyenda, hoy y el próximo día sin clase, días de clase del ciclo; tocar un día abre un diálogo para marcar un **ajuste propio** del grupo —Suspensión, Festividad local u Otro, o "sí hay clase"— con confirmación; pie con la fuente del DOF), **Cumpleaños** (lista del mes y próximos, con edad; "N alumnos sin fecha de nacimiento"; pastel en los días del mes) y **Rol de aseo (opcional)** (alumnos por día, con quién empieza, "Continuar donde se quedó", "Generar y guardar", vista en lista y en calendario, cambio a mano de un nombre, imagen PNG para WhatsApp, Compartir, Copiar texto e Imprimir) | Mes; diálogo de un día; con ajuste; cumpleaños con datos y vacío; rol sin generar y generado; aviso "el calendario cambió" o "alumnos nuevos sin turno" | `19-calendario/` |
| 13 | **Listas** | `listas.html` | Listas de cooperación y materiales por grupo. Pestañas **Abiertas**, **Historial** (listas cerradas: expediente de solo lectura) y **Por alumno** ("Cumplió en 5 de 6", como referencia, con "Completo / Parcial / Sin registro", nunca "debe"). En una lista: resumen por columna ("Entregaron 17 de 20; faltan 3"), avance, **tabla** de alumnos × columnas que se marca con toques; columnas de tres tipos: **Palomita**, **Texto** y **Monto en pesos** (con cuota opcional). Acciones: Agregar columna, Editar datos, Cerrar lista, Eliminar lista, Reabrir (con confirmación). Salida: **imagen y texto para las familias SIN nombres**, "Recordar por WhatsApp" en privado a cada tutor pendiente, e imprimir la versión con nombres "Solo para la maestra" | Abiertas; vacío; detalle; diálogo de nueva lista; diálogo de columna (tipos); historial; por alumno; lista cerrada | `20-listas/` |

### Prioridad 4: planear y dar seguimiento

| # | Pantalla | Archivo | Propósito | Capturas |
|---|---|---|---|---|
| 14 | **Proyectos** | `planeacion.html` | Proyectos del grupo (estado, trimestre, campos), iniciar, clonar, "Nuevo proyecto" e ir al Marketplace | `06-proyectos/` |
| 15 | **Crear proyecto** | `crear_proyecto.html` | Asistente de 3 pasos: datos del proyecto; contenidos y PDA por grado; sesiones con actividades (para todos o por grado), criterios sugeridos y productos. Un proyecto en curso se abre solo para consulta | `07-crear-proyecto/` |
| 16 | **Marketplace** | `marketplace.html` | Importar planeaciones hechas al grupo, con vista previa de sesiones; estado vacío mientras no haya publicadas | `08-marketplace/` |
| 17 | **Actividades** | `actividades.html` | Plan de la sesión del día por momento | `04-actividades/` |
| 18 | **Tareas** | `tareas.html` | Seguimiento de las tareas: cuándo vencen, cuántos alumnos faltan, "Quedó sin revisar"; la revisión se captura en Hoy | `05-tareas/` |

### Prioridad 5: evaluación

| # | Pantalla | Archivo | Propósito | Capturas |
|---|---|---|---|---|
| 19 | **Diagnóstico** | `evaluacion_diagnostica.html` | Por alumno: cuaderno (10 criterios), fluidez lectora (palabras por minuto contra la "referencia SEP 2010" de su grado) y comprensión, matemáticas **según su grado** (1°: 4 habilidades, 2°: 7, 3° a 6°: 8) y observaciones; Anterior / Siguiente entre alumnos; momento "Inicio de ciclo" o "T1 · boleta" | `09-diagnostico/` |
| 20 | **Evaluación formativa** | `evaluacion_formativa.html` | Semáforo por PDA y por alumno en una sesión, con observaciones. Se llega desde una sesión (no está en el menú) | `10-evaluacion-formativa/` |
| 21 | **Exámenes** | `examen.html` | Lista de exámenes y captura de respuestas por alumno | `11-examenes/` |

### Prioridad 6: cuenta, Sala y app

| # | Pantalla | Archivo | Propósito | Capturas |
|---|---|---|---|---|
| 22 | **Ajustes** | `ajustes.html` | Preferencias de notificación; ponderación de rubros (relativos; la conducta y la asistencia se informan aparte y **no ponderan**); eliminar cuenta | `21-ajustes/` |
| 23 | **Mi cuenta** | `mi-cuenta.html` | Nombre, trato (profesora / profesor), estado donde da clases | `22-mi-cuenta/` |
| 24 | **Sala de Maestros (dentro)** | `sala-maestros.html` | Hoy, "Próximamente". Diseña la página de espera con la navegación de Sala | `23-sala-de-maestros/` |
| 25 | **App instalada y sin conexión** | `/salon/hoy`, `sin-conexion.html` | Cómo se ve Mi Salón abierto como app (sin barra del navegador) y la página "Sin conexión" (con Reintentar y cuántas capturas de Hoy esperan en el aparato) | `25-app-instalada/` |
| 26 | **Presentación de Mi Salón** (nueva) | por definir (sugerido `tienda/mi-salon.html`) | Ver §7.1 | referencia de estilo: `capturas/tienda/landing-*` |
| 27 | **Presentación de Sala de Maestros** (nueva) | por definir (sugerido `tienda/sala-de-maestros.html`) | Ver §7.2 | referencia de estilo: `capturas/tienda/landing-*` |

---

## 7. Páginas de presentación (nuevas, por construir)

Son las **cartas de presentación** de cada sección, igual que la tienda tiene la suya
(`capturas/tienda/landing-*`). Son **públicas** (sin sesión), con la navegación y el pie de la
tienda, el mismo lenguaje visual del landing (pizarrón, gis, tarjetas grandes) y **un solo
llamado a la acción** principal. Diseña tablet horizontal, tablet vertical y celular.

Lo marcado **(por definir)** lo decide Jorge: diséñalo con un lugar claro y un texto de
ejemplo que se note que es provisional.

### 7.1 Mi Salón

- **Qué es.** Promesa en una línea, por ejemplo: "Pasa lista y califica en minutos; la boleta
  se arma sola." Debajo, una frase: la herramienta diaria para tu grupo de primaria, hecha
  para la Nueva Escuela Mexicana y para grupos multigrado.
- **Para qué sirve.** Tres beneficios con capturas reales (Hoy en tablet y en celular):
  1. **Multigrado de verdad:** cada alumno se califica en lo de su grado, con los PDA de su
     grado.
  2. **Boleta NEM que sale sola:** calificación propuesta que tú confirmas, textos de
     fortalezas y áreas por campo formativo, boleta imprimible y "Qué le falta" a cada alumno.
  3. **Reportes para la junta y para tu director:** presentación para proyectar, concentrado,
     vista para capturar en la plataforma oficial y Excel.
  Y una franja con lo demás: asistencia, diagnóstico, exámenes, incidencias con documento
  para firmar, calendario escolar SEP, cumpleaños, rol de aseo y listas de cooperación.
- **Cómo se ve en el aula.** La tablet en horizontal en el escritorio de la maestra; el antes
  (Excel por campo, máximos a mano, textos desde cero) y el después.
- **Cómo adquirirlo.**
  - Hoy Mi Salón es **por invitación** (piloto). Llamado a la acción: **"Pedir acceso"**
    (a dónde lleva: **por definir**).
  - Quien ya compró planeaciones en la tienda lo recibirá **gratis o con promoción**
    (**por definir**).
  - Después será una **suscripción por trimestre o por ciclo escolar**. Precio **por definir**:
    deja el espacio de la tarjeta de precio, con el mismo estilo de las tarjetas de precios
    del landing de la tienda.
  - Con acceso, el llamado cambia a **"Entrar a Mi Salón"**.
- **Cómo usarlo** (4 pasos, como "Elige tu paquete / Paga seguro / Descarga e imprime" de la
  tienda): 1) entra con tu cuenta de Jissez; 2) crea tu grupo y da de alta a tus alumnos;
  3) pasa lista y califica cada día en **Hoy**; 4) al cerrar el trimestre, confirma la boleta
  e imprímela. Más: **instala la app** en tu tablet o celular (Chrome y Samsung Internet:
  botón "Instalar"; iPhone y iPad: Compartir → Agregar a pantalla de inicio).
- **Privacidad en lenguaje simple:** solo tú ves los datos de tus alumnos; lo que se comparte
  con las familias no lleva nombres de otros alumnos; puedes borrar tu cuenta. Enlace al aviso
  de privacidad.
- **Preguntas frecuentes:** ¿funciona en celular y tablet? (sí); ¿hay que instalar algo? (no;
  se puede instalar como app); ¿qué pasa si se va la señal? (lo capturado en Hoy se guarda en
  el aparato y se envía al volver la señal). **No prometas "funciona sin internet"**: solo Hoy
  guarda sin señal. ¿Sustituye la boleta oficial? (no, es un complemento).
- Testimonios: solo con permiso; deja el espacio.

### 7.2 Sala de Maestros

- **Qué es.** Un espacio para compartir material didáctico entre maestras y maestros de
  primaria. **Próximamente.**
- **Para qué sirve.** Encontrar material ya probado en el aula por otras maestras (por grado y
  campo formativo) y compartir el propio. Detalle de funciones: **por definir**.
- **Cómo adquirirlo.** **Por definir** (puede ser incluida con la cuenta o de pago). Mientras
  tanto, la página dice "Próximamente". **No** agregues un formulario para dejar el correo
  sin que Jorge lo decida (sería un dato nuevo para el aviso de privacidad); el llamado puede
  ser "Conoce Mi Salón" o "Ver la tienda".
- **Cómo usarlo.** **Por definir**; diseña la sección con 3 pasos de ejemplo (buscar, usar,
  compartir) marcados como provisionales.
- Mismo esqueleto que la presentación de Mi Salón, para que las tres secciones se vean
  hermanas.

---

## 8. Qué NO debe cambiar

**Flujos**

- **Hoy** es una sola página con las cuatro partes en ese orden (asistencia, tareas, sesiones,
  cierre) y se guarda **al tocar**, sin botón de guardar. Nunca se descarta una captura: sin
  señal se guarda en el aparato y se avisa.
- **Proponer → confirmar → cerrar:** la calificación propuesta no es oficial hasta que la
  maestra la confirma; sin confirmar se muestra "pendiente"; una boleta **cerrada** es de solo
  lectura y no se reabre desde la interfaz. Un campo sin evidencias se elige a mano ("Elige").
- La asistencia y la conducta **no ponderan**: se muestran como referencia, rotuladas así.
- Las acciones irreversibles piden confirmación (cerrar boleta, borrar alumno o grupo,
  eliminar incidencia, eliminar o reabrir lista, eliminar cuenta, cambiar el calendario).
- La navegación de §5 (estructura, cortes y accesos rápidos).
- El rol de aseo es **opcional**: nada fuera de su pestaña lo sugiere.

**Privacidad ("sin nombres en lo que se comparte")**

- Lo que va a **las familias o a un grupo de WhatsApp no lleva nombres de otros alumnos**:
  la imagen y el texto de las listas llevan solo el resumen ("Entregaron 17 de 20; faltan 3"),
  nunca a quién le falta; los recordatorios van en privado a cada tutor.
- Las **incidencias** para las familias salen una hoja por alumno, solo con ese alumno.
- La **junta** se proyecta **sin nombres** por defecto (número de lista y grado); la lámina
  de fluidez no lleva ni el número de lista; las áreas de atención van agregadas.
- Lo que es **solo para la maestra** (impresión de listas con nombres, "Por alumno",
  pendientes de revisión) lo dice en pantalla y no se comparte.
- Tono respetuoso: "Completo / Parcial / Sin registro", nunca "debe" o "no cumplió"; "Qué le
  falta" es formativo, nunca "puntos para sacar 10".
- Nada de datos de salud ni CURP.

**Tamaños táctiles y legibilidad**

- 44 px mínimo en todo lo tocable, incluidas celdas y días del calendario.
- Nada fijo tapa botones: lo fijo abajo sube lo que mide la barra de accesos rápidos.

---

## 9. Piezas compartidas (diséñalas una vez)

- **Navegación:** barra lateral (abierta y contraída), encabezado de 56 px, panel lateral y
  barra de accesos rápidos (§5). Selector de grupo activo.
- **Encabezado de página:** título, grupo y fecha (hoy es una banda azul).
- **Tarjetas:** sección de página (título, contador tipo "0 de 8 capturados", contenido),
  tarjeta de resumen de Inicio, tarjeta de lista y de incidencia.
- **Fila / tarjeta de alumno:** número de lista, nombre, **insignia de grado**, y un control de
  un toque (Presente / Falta / Justificada; semáforo; 0 · 1 · 2).
- **Semáforo** Logrado / En proceso / Requiere apoyo: botones grandes, legibles sin color.
- **Insignias:** campo formativo (4 colores NEM), grado (colores de gis), estado de boleta
  (propuesta, confirmada, cerrada, pendiente, Revisar), "baja", "Solo para la maestra".
- **Tablas:** encabezado fijo, primera columna (alumno) fija al desplazar en horizontal,
  celdas tocables, totales y resumen arriba (Listas, Concentrado, Vista Recrea, Exportar).
- **Pestañas:** con desplazamiento y flechas cuando no caben (Reportes, Calendario, Listas).
- **Diálogos:** título, texto, acciones (Cancelar a la izquierda, acción a la derecha; la
  destructiva en rojo). En celular, de pantalla casi completa o como hoja desde abajo.
- **Avisos fijos:** indicador de guardado (guardando, guardado, error, **sin señal: se
  guardará al volver**), capturas pendientes de Hoy en otras páginas, conflicto con otro
  aparato.
- **Aviso de página:** "No se pudo cargar esta página. Revisa tu conexión." con Reintentar.
- **Estados vacíos** con una sola acción clara ("Da de alta a tus alumnos", "Crea tu primera
  lista", "Registra la primera incidencia", "Crea tu primer proyecto").
- **Hoja imprimible** (carta): boleta, reporte, incidencia, aviso a las familias, listas y rol
  de aseo; en pantalla se ve como hoja y al imprimir sale solo la hoja.
- **Botones de compartir:** Copiar texto, Compartir por WhatsApp (verde), Imagen para
  WhatsApp, Imprimir.

---

## 10. Qué entregar

Igual que en la tienda: **prototipos HTML hi-fi** con Tailwind (CDN) y los tokens de `marca/`,
iconos Lucide, una página por pantalla y los estados indicados en los tres tamaños. Datos de
ejemplo: un grupo multigrado de 1° y 2° con 8 alumnos y otro de 3° y 4°, nombres ficticios.
Contenidos, nombres de campos y términos NEM **exactos** (§3).
