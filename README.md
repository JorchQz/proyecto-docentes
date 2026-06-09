# SaaS NEM para Docentes

Plataforma web para maestros de primaria en México bajo la **Nueva Escuela Mexicana (NEM)**.
Permite registrar asistencia, tareas, actividades y calificaciones, y planear proyectos por
campo formativo — pensada para tablets en aulas **multigrado** rurales.

## Cómo correrlo

No hay build. Es una app **multipágina** de HTML + Vanilla JS que corre directo en el navegador.
Sírvela con un servidor estático local (p. ej. **Live Server** de VS Code) y abre `index.html`.

El backend es **Supabase** (PostgreSQL + Auth + RLS); el cliente se inicializa en
[js/supabase.js](js/supabase.js) con la URL y anon key públicas.

## Mapa del repositorio

| Ruta | Qué es |
|---|---|
| `*.html` + `js/*.js` | Una página por feature (login, dashboard, asistencia, planeación…) |
| `css/style.css` | Vacío a propósito — el estilo es Tailwind por CDN |
| `supabase/*.sql` | Esquemas SQL (correr en el SQL editor de Supabase) |
| `bot/` | Manual operativo del bot generador de planeaciones (escribe en `dosificacion_*`) |
| **[docs/CONTEXTO.md](docs/CONTEXTO.md)** | **Fuente de verdad** del producto: modelo NEM, metodologías, modelo de datos |
| [docs/plantilla-proyecto.md](docs/plantilla-proyecto.md) | Plantilla imprimible para diseñar proyectos |
| [docs/TESTING.md](docs/TESTING.md) | Checklist de pruebas manuales |
| `docs/referencia/` | Material de referencia (PDFs, xlsx) — **no versionado** (ver `.gitignore`) |
| [CLAUDE.md](CLAUDE.md) | Guía para agentes de IA que trabajan en el repo |

## Documentación

Empieza por **[docs/CONTEXTO.md](docs/CONTEXTO.md)**. Es el único documento de contexto: todo
lo demás lo referencia para evitar contradicciones.
