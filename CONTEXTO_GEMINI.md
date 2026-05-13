# Contexto del Proyecto: SaaS NEM para Maestros Mexicanos

## ¿Qué es esta app?

Una plataforma web (SaaS) para maestros de educación primaria en México que trabajan bajo la **Nueva Escuela Mexicana (NEM)**. El objetivo principal es eliminar la carga administrativa: el maestro registra asistencia, tareas, actividades y calificaciones en segundos desde una tablet.

**Hardware objetivo:** Samsung Galaxy Tab S9 FE+ (12.4", landscape, uso táctil)
**Usuarios:** Maestros de escuelas rurales, especialmente bidocentes y multigrado (grupos con 3°, 4°, 5° y 6° combinados)

---

## El Modelo NEM — Conceptos Clave

### Campos Formativos (4 fijos, no son materias)
1. **Lenguajes**
2. **Saberes y Pensamiento Científico**
3. **Ética, Naturaleza y Sociedades**
4. **De lo Humano y lo Comunitario**

### Ejes Articuladores (7 oficiales)
- Inclusión
- Pensamiento Crítico
- Interculturalidad Crítica
- Igualdad de Género
- Vida Saludable
- Apropiación de las Culturas a través de la Lectura y la Escritura
- Artes y Experiencias Estéticas

### Fases (agrupación de grados)
| Fase | Grados |
|------|--------|
| Fase 3 | 1° y 2° |
| Fase 4 | 3° y 4° |
| Fase 5 | 5° y 6° |

### Metodologías de Proyectos NEM
- **ABPC** — Aprendizaje Basado en Proyectos Comunitarios
- **STEAM** — Ciencia, Tecnología, Ingeniería, Arte y Matemáticas
- **ABP** — Aprendizaje Basado en Problemas
- **AS** — Aprendizaje de Servicio

### Estructura de una Sesión
Cada clase/sesión sigue 3 momentos:
1. **INICIO** — activación, exploración de saberes previos
2. **DESARROLLO** — trabajo central del proyecto
3. **CIERRE** — reflexión, síntesis, tarea

### Evaluación Diaria (rubros)
- Asistencia (sí/no)
- Tareas de la clase anterior (calificación 5–10)
- Actividades del proyecto del día (calificación 5–10)
- Participación global del día (5–10, NO por campo formativo)
- Conducta global del día (5–10, NO por campo formativo)

---

## Estructura de un "Proyecto / Planeación" en la App

Un proyecto es la unidad central de planeación. El maestro lo crea en 3 pasos:

### Paso 1 — Datos Generales
```json
{
  "titulo": "Nombre descriptivo del proyecto",
  "grados": [3, 4, 5, 6],
  "fase": ["Fase 4", "Fase 5"],
  "metodologia": "ABPC | STEAM | ABP | AS",
  "escenario": "Contexto o situación que da vida al proyecto",
  "campos_formativos": ["Lenguajes", "Saberes y Pensamiento Científico"],
  "ejes_articuladores": ["Pensamiento Crítico", "Vida Saludable"],
  "proposito": "Qué aprenderán los alumnos al terminar el proyecto",
  "pregunta_generadora": "¿Pregunta detonante que guía el proyecto?"
}
```

### Paso 2 — Contenidos y PDAs por Campo Formativo
```json
{
  "contenidos_pda": {
    "Lenguajes": {
      "contenidos": ["Texto del contenido oficial SEP seleccionado"],
      "pdas": [
        {
          "grado": 5,
          "pda_texto": "Texto literal del PDA de SEP",
          "criterio_valoracion": "Cómo se evalúa este PDA"
        }
      ]
    },
    "Saberes y Pensamiento Científico": {
      "contenidos": ["..."],
      "pdas": [...]
    }
  }
}
```

### Paso 3 — Sesiones
Cada sesión es una clase. Un proyecto tiene N sesiones. Estructura de una sesión:
```json
{
  "numero_sesion": 1,
  "duracion": "90 minutos",
  "campo_formativo": "Lenguajes",
  "momento": "Lunes 14 de abril",
  "inicio_todos": "Texto de la actividad de inicio para todos los grados",
  "inicio_diferenciado": null,
  "inicio_actividades": {
    "mode": "todos",
    "todos": ["Actividad 1 de inicio", "Actividad 2 de inicio"],
    "diferenciado": null
  },
  "desarrollo_todos": "Texto de desarrollo para todos los grados",
  "desarrollo_diferenciado": null,
  "desarrollo_actividades": {
    "mode": "diferenciado",
    "todos": null,
    "diferenciado": {
      "3": ["Actividad específica para 3°"],
      "4": ["Actividad específica para 4°"],
      "5": ["Actividad específica para 5°"],
      "6": ["Actividad específica para 6°"]
    }
  },
  "cierre_todos": "Reflexión de cierre para todos",
  "cierre_diferenciado": null,
  "cierre_actividades": {
    "mode": "todos",
    "todos": ["Actividad de cierre"],
    "diferenciado": null
  },
  "cierre_tareas": {
    "mode": "todos",
    "todos": ["Tarea asignada para la siguiente clase"],
    "diferenciado": null
  },
  "pda_sesion": [
    {
      "grado": 5,
      "pda_texto": "PDA trabajado en esta sesión",
      "criterio_aplicado": "Cómo se evaluará hoy"
    }
  ],
  "recursos": {
    "archivos": [],
    "links": ["https://..."]
  },
  "observaciones": "Notas del maestro sobre esta sesión"
}
```

---

## Notas Importantes sobre Grupos Multigrado

El caso de uso principal es un maestro que tiene **un solo grupo con alumnos de 3°, 4°, 5° y 6° al mismo tiempo** en el mismo salón.

Por eso, las actividades pueden ser:
- **"Todos igual"** (`mode: "todos"`) — la misma instrucción para todos los grados
- **"Diferenciado"** (`mode: "diferenciado"`) — instrucción distinta para cada grado

Una buena planeación multigrado combina ambos: el INICIO suele ser "todos igual" (actividad detonadora conjunta), el DESARROLLO suele ser "diferenciado" (trabajo por nivel), y el CIERRE suele ser "todos igual" (puesta en común).

---

## Base de Datos (Supabase PostgreSQL)

### Tablas principales
| Tabla | Columnas clave | Descripción |
|-------|----------------|-------------|
| `grupos` | `maestro_id`, `nombre`, `tipo_organizacion`, `grados` (array text), `es_multigrado`, `ciclo_escolar` | Un grupo por maestro |
| `alumnos` | `grupo_id`, `maestro_id`, `nombre_completo`, `grado` (1-6), `num_lista`, `estatus` | Alumnos del grupo |
| `asistencias` | `maestro_id`, `alumno_id`, `grupo_id`, `fecha`, `asistencia_estado` ('presente'/'ausente'/'justificada') | Pase de lista diario |
| `proyectos` | `maestro_id`, `grupo_id`, `titulo`, `trimestre` (1/2/3), `estado` ('borrador'/'activo'/'completado'/'pausado'), `campos_formativos` (array), `ejes_articuladores` (array), `grados` (array), `fase` (array), `metodologia`, `escenario`, `proposito`, `pregunta_generadora`, `contenidos_pda` (jsonb), `visible_mercado` (bool) | Planeaciones |
| `sesiones` | `proyecto_id`, `maestro_id`, `numero_sesion`, `campo_formativo`, `momento`, `duracion`, `inicio_todos`, `desarrollo_todos`, `cierre_todos`, `inicio_actividades` (jsonb), `desarrollo_actividades` (jsonb), `cierre_actividades` (jsonb), `cierre_tareas` (jsonb), `inicio_diferenciado` (jsonb), `desarrollo_diferenciado` (jsonb), `cierre_diferenciado` (jsonb), `pda_sesion` (jsonb), `estado_sesion` ('pendiente'/'activa'/'completada'/'recorrida'), `notas_cierre`, `recursos` (jsonb) | Una sesión = una clase |
| `tareas` | `sesion_id`, `proyecto_id`, `grupo_id`, `maestro_id`, `descripcion`, `grado` (nullable), `fecha_asignada`, `fecha_revision`, `revisada` (bool) | Tareas materializadas al cerrar sesión |
| `calificaciones` | `alumno_id`, `maestro_id`, `sesion_id`, `proyecto_id`, `grupo_id`, `tipo` ('tarea'/'actividad'/'participacion'/'conducta'), `calificacion` (5-10), `entrego` (bool), `fecha`, `grado`, `campo_formativo` | Calificaciones diarias |
| `evaluacion_formativa` | `maestro_id`, `sesion_id`, `alumno_id`, `criterio`, `semaforo` ('logrado'/'en_proceso'/'requiere_apoyo'), `observacion`, `fecha` | Evaluación cualitativa por alumno |
| `catalogo_contenidos` | `fase`, `campo_formativo`, `contenido`, `orden` | Catálogo oficial SEP de contenidos |
| `catalogo_pda` | `contenido_id`, `grado` (1-6), `pda`, `criterio_valoracion`, `orden` | Procesos de Desarrollo de Aprendizaje por grado |

### Campo `visible_mercado`
La tabla `proyectos` tiene `visible_mercado: boolean` (default `false`). Esto es la base del **marketplace de planeaciones**: cuando el equipo activa este campo, la planeación aparece disponible para otros maestros.

---

## Estado Actual de los Módulos

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Auth (login/registro) | ✅ Completo | |
| Onboarding (crear grupo + alumnos) | ✅ Completo | |
| Dashboard diario | ✅ Completo | Asistencia → Tareas → Sesión |
| Asistencia | ✅ Completo | Con autosave |
| Mi Grupo | ✅ Completo | CRUD de grupo y alumnos |
| Crear Proyecto / Planeación | ✅ Completo | 3 pasos con catálogo SEP |
| Planeación (lista de proyectos) | ⚠️ Parcial | Falta iniciar/pausar proyectos |
| Reportes de asistencia | ✅ Funcional | Exporta a PDF |
| Actividades | ❌ Sin implementar | Solo placeholder |
| Tareas | ❌ Sin implementar | Solo placeholder |

---

## Oportunidad de Negocio: Marketplace de Planeaciones

La app ya está diseñada con `visible_mercado` en la tabla de proyectos para soportar un catálogo de planeaciones listas para usar. Los maestros rurales tienen poco tiempo para planear; si existiera un banco de proyectos NEM bien elaborados, los comprarían.

**Flujo de negocio proyectado:**
1. El equipo (o maestros expertos) crea planeaciones de calidad usando la misma app
2. Se activa `visible_mercado = true` en esas planeaciones
3. Otros maestros las buscan, previsualizan y las importan a su cuenta
4. El maestro adapta la planeación a sus grados y grupos

**Formato que necesita Gemini para generar una planeación:**
Gemini debe producir un JSON con la estructura exacta de `proyectoPayload` + array de `sesionesPayload` descrita arriba. El proyecto se inserta en `proyectos` con `visible_mercado: true` y `maestro_id` del equipo administrador.

---

## Vocabulario NEM (Términos Oficiales SEP)

| Término | Significado |
|---------|-------------|
| Campo Formativo | Agrupa los aprendizajes (reemplaza "materia") |
| PDA | Proceso de Desarrollo de Aprendizaje (lo que el alumno logrará) |
| Eje Articulador | Tema transversal que cruza todos los campos |
| Fase | Agrupación de grados (Fase 3 = 1°-2°, Fase 4 = 3°-4°, Fase 5 = 5°-6°) |
| Sesión | Una clase dentro de un proyecto |
| Escenario | Contexto o situación real que da sentido al proyecto |
| Pregunta Generadora | Pregunta detonante que guía todo el proyecto |
| Propósito | Lo que se espera que los alumnos aprendan al terminar |
| Trimestre | Período de evaluación (1, 2 o 3 por año escolar) |
| Producto Final | Entregable o demostración de aprendizaje al cierre del proyecto |
