# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SaaS for Mexican primary school teachers following the Nueva Escuela Mexicana model. Targets multi-grade rural schools using Samsung Galaxy Tab S9 FE+ (12.4" landscape). **`docs/CONTEXTO.md` is the single source of truth** for product spec, NEM model, data model and business logic — read it first.

## Development

No build process. Serve files with a local HTTP server (e.g., VS Code Live Server). All code runs directly in the browser.

Manual testing checklist is in `docs/TESTING.md`.

## Architecture

**Multi-page vanilla HTML/JS app** — each feature is a separate `.html` + `js/*.js` pair. No SPA framework, no bundler, no npm.

**Supabase** handles all backend concerns:
- Auth (JWT, stored in localStorage by SDK)
- PostgreSQL database
- Row-Level Security (RLS) — every table enforces `auth.uid() = maestro_id`, so teachers only see their own data. SQL schemas are in `supabase/`.

**Tailwind CSS** via CDN — `style.css` is empty, all styling is utility classes.

### UI conventions (hard rules)

- **NEVER use emojis** anywhere in the UI (or as content icons). Emojis make the product look cheap and AI-generated. This applies to all HTML, JS-rendered markup, button labels, empty states, etc.
- Use **Lucide icons** instead (`https://unpkg.com/lucide@latest`, rendered via `<i data-lucide="name">` + `lucide.createIcons()`). After any dynamic render that inserts icons, call `Tienda.iconos()` (helper in `tienda/js/tienda-common.js`) so the new `<i>` elements are upgraded to SVGs.
- Plain typographic arrows in text (→, ←) are acceptable; pictographic/color emojis are not.

### Key files

- `js/supabase.js` — Supabase client init with hardcoded public URL/anon key
- `js/section-shell.js` — Shared utilities: `bindMainMenu()`, `getTeacherNameFromUser()`
- `js/navbar.js` — Shared nav rendered on every protected page
- `docs/CONTEXTO.md` — Single source of truth: product spec, NEM model, full data model
- `docs/plantilla-proyecto.md` — Printable template for designing projects
- `bot/` — Docs for the external planning-generator bot (writes to `dosificacion_*`)

### Auth & routing flow

```
index.html (login/register)
  → onboarding.html (create group → add students)   [first-time users]
  → dashboard.html                                    [returning users]
    → asistencia.html, mi-grupo.html, reportes.html, crear_proyecto.html, ...
```

Protected pages check session on load and redirect to `index.html` if unauthenticated.

### Data model (core tables)

Full, verified schema is in `docs/CONTEXTO.md §6`. Quick reference:

| Table | Key columns |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `tipo_organizacion`, `grados` (array), `es_multigrado`, `ciclo_escolar` |
| `alumnos` | `grupo_id`, `maestro_id`, `nombre_completo`, `grado` (1–6), `num_lista`, `estatus` |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, `asistencia_estado` (`presente`/`ausente`/`justificada`) |
| `proyectos` | `maestro_id`, `grupo_id`, `titulo`, `trimestre`, `metodologia`, `escenario`, `campos_formativos` (array), `estado`, `contenidos_pda` (jsonb), `visible_mercado` |
| `sesiones` | `proyecto_id`, `numero_sesion`, `momento`, `*_todos`/`*_diferenciado`/`*_actividades`/`cierre_tareas` (jsonb), `pda_sesion`, `estado_sesion` |
| `sesiones_pda`, `productos_sesion`, `producto_sesion_pda` | structured traceability per session: PDAs-by-grade with criteria, and gradable products; materialized by `js/sesiones-materializar.js` on import/create |
| `tareas`, `calificaciones`, `evaluacion_formativa` | runtime data materialized as sessions are closed (see CONTEXTO §6.1); `evaluacion_formativa` rows link to `sesiones_pda` via `sesion_pda_id` |
| `boleta_trimestral`, `registro_diario`, `banco_criterios_pda` | report-card text/grades per campo formativo, daily participation/conduct log, and per-PDA criteria suggestions |

Campo formativo convention: legacy tables store the long name ("Lenguajes", …); new tables (`productos_sesion`, `boleta_trimestral`) store short codes (`LEN`/`SAB`/`ETI`/`DHL`). The mapping lives ONLY in `js/campos-formativos.js` and is applied on write.

### Common JS patterns

- Pages use a single `DOMContentLoaded` listener; state is local to that closure.
- `showMessage(type, text)` / `clearMessage()` for user feedback.
- `getLocalDateISO()` for date handling; attendance uses debounced autosave.
- Form inputs use `inputmode="numeric"` and grades are comma-separated strings (1–6).

## Module status

All 16 modules are complete (auth, onboarding, dashboard, asistencia, mi-grupo, crear_proyecto, planeación, actividades, tareas, reportes with boleta PDF/WhatsApp, mi-cuenta, ajustes, evaluación formativa, evaluación diagnóstica, exámenes, marketplace). Full table and remaining debt in `docs/CONTEXTO.md §7`. The next product phase ("Mi salón" Parte B: daily capture screen, grade engine, auto-generated report texts) is specified in `docs/PRODUCTO-MI-SALON.md` and must NOT be built without Jorge's explicit go-ahead.
