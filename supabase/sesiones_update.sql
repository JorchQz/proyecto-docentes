-- Migración aplicada vía MCP el 2026-04-06
-- Añade actividades y tareas por bloque didáctico; elimina columnas planas antiguas.

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS inicio_actividades    jsonb,
  ADD COLUMN IF NOT EXISTS desarrollo_actividades jsonb,
  ADD COLUMN IF NOT EXISTS cierre_actividades    jsonb,
  ADD COLUMN IF NOT EXISTS cierre_tareas         jsonb;

ALTER TABLE sesiones
  DROP COLUMN IF EXISTS tareas,
  DROP COLUMN IF EXISTS actividades;

-- Estructura de cada columna jsonb de actividades/tareas:
-- Modo "igual para todos":
--   { "mode": "todos", "todos": ["act1", "act2"], "diferenciado": null }
-- Modo "diferenciado":
--   { "mode": "diferenciado", "todos": null, "diferenciado": { "4": ["act1"], "5": ["act2"] } }
