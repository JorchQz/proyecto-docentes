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
- `js/navbar.js` — Shared nav rendered on every protected page (sidebar / hamburger; loaded in `<head>`)
- `js/secciones.js`, `js/saas-guard.js` — Section switcher (Tienda / Mi Salón / Sala) and the Mi Salón access gate
- `js/bandeja-salida.js` — Offline queue for "Hoy" (IndexedDB, per-field capture marks)
- `js/grupo-activo.js` — The only place that decides the active group (selector in the nav)
- `js/motor-calificacion.js` — The only grade formula; percent → grade conversion happens only in SQL (`calcular_calificacion_boleta`)
- `js/alcance-hoy.js` — Rules shared by "Hoy", Inicio and Tareas (project scope, task due date, day-close count, paged reads past Supabase's 1000-row cap)
- `js/textos-boleta.js`, `js/reporte-datos.js` — Report-card text proposals (Capa 1) and the data layer shared by boleta, reporte, junta and exportación
- `docs/CONTEXTO.md` — Single source of truth: product spec, NEM model, full data model
- `docs/plantilla-proyecto.md` — Printable template for designing projects
- `bot/` — Docs for the external planning-generator bot (writes to `dosificacion_*`)

### Auth & routing flow

jissez.com has three sections: **Tienda** (the public store, `tienda/`), **Mi Salón** (this SaaS) and **Sala de Maestros** (`sala-maestros.html`, "Próximamente"). Only accounts with `perfiles.activo_saas = true` see Mi Salón and Sala (`js/saas-guard.js`); everyone else only sees the store.

```
index.html (root; no content)
  → tienda/index.html                                  [visitors, buyers without Mi Salón]
  → last section on this device (localStorage "jissez.seccion", js/secciones.js)
                                                       [accounts with Mi Salón]
tienda/login.html (login/register; ?next= returns to the origin page)
  → onboarding.html (create group → add students)     [first-time Mi Salón users]
  → dashboard.html (Inicio)                            [returning users]
    → hoy.html, asistencia.html, mi-grupo.html, reportes.html, crear_proyecto.html, ...
```

Protected pages check the session and the Mi Salón access on load; without a session they go to the login, without access to the store.

**Installable app "Jissez MS"** (`docs/PWA-MI-SALON.md`): the same pages served under the virtual path `/salon/` (`_redirects`), with `salon.webmanifest`, `sw.js` (network-first + offline page) and an offline queue for "Hoy" in IndexedDB (`js/bandeja-salida.js`: per-field capture marks, never overwrites another device silently). Links must stay relative so nothing leaves `/salon/`; the store opens outside the app.

**Navigation** (`js/navbar.js`, loaded in `<head>`): left sidebar from 1024 px wide (collapsible), header + hamburger panel + bottom quick-access bar below 1024 px. The section switcher (Tienda / Mi Salón / Sala) is painted only after access is confirmed.

### Data model (core tables)

Full, verified schema is in `docs/CONTEXTO.md §6`. Quick reference:

| Table | Key columns |
|---|---|
| `grupos` | `maestro_id`, `nombre`, `tipo_organizacion`, `grados` (array), `es_multigrado`, `ciclo_escolar`, `escuela`, `director_nombre` (per group) |
| `alumnos` | `grupo_id`, `maestro_id`, `nombre_completo`, `grado` (1–6), `num_lista`, `estatus`; optional ficha: `fecha_nacimiento`, `genero`, `tutor_nombre`, `tutor_telefono` (`js/ficha-alumno.js`) |
| `incidencias`, `incidencia_alumnos` | per-group incident log + involved students; saved via `guardar_incidencia()`; page `incidencias.html` |
| `asistencias` | `maestro_id`, `grupo_id`, `alumno_id`, `fecha`, `asistencia_estado` (`presente`/`ausente`/`justificada`) |
| `proyectos` | `maestro_id`, `grupo_id`, `titulo`, `trimestre`, `metodologia`, `escenario`, `campos_formativos` (array), `estado`, `contenidos_pda` (jsonb), `visible_mercado` |
| `sesiones` | `proyecto_id`, `numero_sesion`, `momento`, `*_todos`/`*_diferenciado`/`*_actividades`/`cierre_tareas` (jsonb), `pda_sesion`, `estado_sesion` |
| `sesiones_pda`, `productos_sesion`, `producto_sesion_pda` | structured traceability per session: PDAs-by-grade with criteria, and gradable products; materialized by `js/sesiones-materializar.js` on import/create |
| `calificaciones`, `evaluacion_formativa`, `tareas` | `calificaciones` is written in "Hoy" as each product is graded; `evaluacion_formativa` is filled by a trigger on grading (plus the teacher's adjustment) and links to `sesiones_pda` via `sesion_pda_id`; `tareas` is deprecated (0 rows, nothing writes it) |
| `boleta_trimestral`, `registro_diario`, `banco_criterios_pda` | report-card text/grades per campo formativo, daily participation/conduct log, and per-PDA criteria suggestions |
| `calendario_ajustes`, `roles_aseo` | per-group adjustments to the official SEP calendar (`js/calendario-sep.js`, data only: attendance % still counts the days the teacher took roll) and the optional cleaning roster; page `calendario.html` |
| `listas_grupo`, `listas_columnas`, `listas_valores` | per-group cooperation/materials lists (checkbox, text, peso amounts); anything shared with families carries NO student names; closed lists are a read-only record; page `listas.html` |

Campo formativo convention: legacy tables store the long name ("Lenguajes", …); new tables (`productos_sesion`, `boleta_trimestral`) store short codes (`LEN`/`SAB`/`ETI`/`DHL`). The mapping lives ONLY in `js/campos-formativos.js` and is applied on write.

### Common JS patterns

- Pages use a single `DOMContentLoaded` listener; state is local to that closure.
- `showMessage(type, text)` / `clearMessage()` for user feedback.
- `getLocalDateISO()` for date handling; attendance uses debounced autosave.
- Form inputs use `inputmode="numeric"` and grades are comma-separated strings (1–6).

## Module status

All 16 modules are complete (auth, onboarding, dashboard, asistencia, mi-grupo, crear_proyecto, planeación, actividades, tareas, reportes with boleta PDF/WhatsApp, mi-cuenta, ajustes, evaluación formativa, evaluación diagnóstica, exámenes, marketplace). Full table and remaining debt in `docs/CONTEXTO.md §7`. "Mi salón" Parte B (daily capture screen "Hoy", grade engine, auto-generated report texts, printable boleta, detailed report, parents' meeting, export) is described in `docs/PRODUCTO-MI-SALON.md`; progress and reviewer verdicts are in `docs/PROGRESO-PARTE-B.md`. Later additions (all published): "Qué le falta" per student, student ficha, school/principal per group, incidents with signatures, notice for families, SEP calendar, cleaning roster, cooperation lists and birthdays.

Deployment: a push to `main` deploys jissez.com automatically (Cloudflare Worker "jissez"); work happens on `mi-salon-parte-b` and each publish, and each SQL migration applied to production, needs Jorge's explicit go-ahead at that moment. Production Supabase is `cluvaxxqvhtxxiwctpnl`; all QA runs against the test project `raoxdxwgsxbqlzdnndly` (never load-test production). New product or legal decisions (weights, attendance states, reading of the Acuerdo, privacy wording) still need Jorge's explicit go-ahead.
