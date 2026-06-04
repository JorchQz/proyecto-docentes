-- Migración aplicada vía MCP el 2026-06-02
-- Realinea dosificacion_sesiones (capa del bot/marketplace) al shape nativo de
-- la tabla `sesiones` del SaaS, para que importar un proyecto comprado sea una
-- copia casi 1:1 sin pérdida de información. Ver bot/CONTRATO_DATOS.md.
-- Seguro: la tabla tenía 0 filas y ningún archivo del repo usa las columnas retiradas.

ALTER TABLE dosificacion_sesiones
  ADD COLUMN IF NOT EXISTS inicio_todos            text,
  ADD COLUMN IF NOT EXISTS desarrollo_todos        text,
  ADD COLUMN IF NOT EXISTS cierre_todos            text,
  ADD COLUMN IF NOT EXISTS inicio_diferenciado     jsonb,   -- { "4": "texto", "5": "texto" }
  ADD COLUMN IF NOT EXISTS desarrollo_diferenciado jsonb,
  ADD COLUMN IF NOT EXISTS cierre_diferenciado     jsonb,
  ADD COLUMN IF NOT EXISTS inicio_actividades      jsonb,   -- { mode, todos:[], diferenciado:{} }
  ADD COLUMN IF NOT EXISTS desarrollo_actividades  jsonb,
  ADD COLUMN IF NOT EXISTS cierre_actividades      jsonb,
  ADD COLUMN IF NOT EXISTS cierre_tareas           jsonb,   -- mismo shape que actividades
  ADD COLUMN IF NOT EXISTS pda_sesion              jsonb,   -- [{grado, pda_id, pda_texto, criterio_aplicado}]
  ADD COLUMN IF NOT EXISTS recursos                jsonb DEFAULT '{"links": [], "archivos": []}'::jsonb,
  ADD COLUMN IF NOT EXISTS observaciones           text,
  ADD COLUMN IF NOT EXISTS momento                 text;    -- alias de momento_metodologico (= sesiones.momento)

ALTER TABLE dosificacion_sesiones
  DROP COLUMN IF EXISTS secuencia_didactica,
  DROP COLUMN IF EXISTS diferenciacion_grados,
  DROP COLUMN IF EXISTS tarea,
  DROP COLUMN IF EXISTS criterios_evaluacion;
