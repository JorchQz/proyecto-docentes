# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SaaS for Mexican primary school teachers following the Nueva Escuela Mexicana model. Targets multi-grade rural schools using Samsung Galaxy Tab S9 FE+ (12.4" landscape). See `contexto.md` for full product specification and business logic.

## Development

No build process. Serve files with a local HTTP server (e.g., VS Code Live Server). All code runs directly in the browser.

Manual testing checklist is in `TESTING.md`.

## Architecture

**Multi-page vanilla HTML/JS app** — each feature is a separate `.html` + `js/*.js` pair. No SPA framework, no bundler, no npm.

**Supabase** handles all backend concerns:
- Auth (JWT, stored in localStorage by SDK)
- PostgreSQL database
- Row-Level Security (RLS) — every table enforces `auth.uid() = maestro_id`, so teachers only see their own data. SQL schemas are in `supabase/`.

**Tailwind CSS** via CDN — `style.css` is empty, all styling is utility classes.

### Key files

- `js/supabase.js` — Supabase client init with hardcoded public URL/anon key
- `js/section-shell.js` — Shared utilities: `bindMainMenu()`, `getTeacherNameFromUser()`
- `contexto.md` — Full product spec, data model, UI/UX requirements

### Auth & routing flow

```
index.html (login/register)
  → onboarding.html (create group → add students)   [first-time users]
  → dashboard.html                                    [returning users]
    → asistencia.html, mi-grupo.html, reportes.html, crear_proyecto.html, ...
```

Protected pages check session on load and redirect to `index.html` if unauthenticated.

### Data model (core tables)

| Table | Key columns |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `nivel` |
| `alumnos` | `grupo_id`, `nombre`, `grado` (1–6) |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, `asistio` |
| `proyectos` | `nombre`, `fecha_inicio`, `fecha_fin`, `metodologia`, `escenario` |

### Common JS patterns

- Pages use a single `DOMContentLoaded` listener; state is local to that closure.
- `showMessage(type, text)` / `clearMessage()` for user feedback.
- `getLocalDateISO()` for date handling; attendance uses debounced autosave.
- Form inputs use `inputmode="numeric"` and grades are comma-separated strings (1–6).

## Modules in progress (stubs only)

`actividades.html`, `tareas.html`, `planeacion.html`, `reportes.html` (partial), `crear_proyecto.js` (form renders but submit not wired up).
