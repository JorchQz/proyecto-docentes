-- ============================================================================
-- MI SALÓN — PARTE A (2026-09-03) · SQL ejecutado en la BD viva (cluvaxxqvhtxxiwctpnl)
-- vía MCP apply_migration, en este orden. Este archivo es el registro fiel de lo
-- aplicado; junto con esquema_2026-09.sql documenta el estado real del esquema.
-- Contexto y decisiones: docs/referencia/reporte-fase0-gate-a1.md y
-- docs/PRODUCTO-MI-SALON.md.
-- ============================================================================

-- ── 1.1 (A.2) boleta_trimestral + (A.4) registro_diario ─────────────────────
CREATE TABLE public.boleta_trimestral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maestro_id uuid NOT NULL REFERENCES auth.users(id),
  alumno_id uuid NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  ciclo text NOT NULL,
  trimestre smallint NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  campo text NOT NULL CHECK (campo IN ('LEN','SAB','ETI','DHL','GEN')),
  porcentaje numeric(5,2),
  calificacion smallint CHECK (calificacion BETWEEN 5 AND 10),
  nivel text CHECK (nivel IN ('logrado','en_proceso','requiere_apoyo')),
  fortalezas text,
  areas_oportunidad text,
  sugerencias text,
  texto_autogenerado jsonb,
  editado_manual boolean NOT NULL DEFAULT false,
  cerrada boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (maestro_id, alumno_id, ciclo, trimestre, campo)
);
ALTER TABLE public.boleta_trimestral ENABLE ROW LEVEL SECURITY;
CREATE POLICY boleta_trimestral_propietario ON public.boleta_trimestral
  FOR ALL TO authenticated
  USING (maestro_id = auth.uid()) WITH CHECK (maestro_id = auth.uid());

CREATE TABLE public.registro_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maestro_id uuid NOT NULL REFERENCES auth.users(id),
  alumno_id uuid NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  participacion smallint CHECK (participacion BETWEEN 0 AND 2),
  conducta smallint CHECK (conducta BETWEEN 0 AND 2),
  nota text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (maestro_id, alumno_id, fecha)
);
ALTER TABLE public.registro_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY registro_diario_propietario ON public.registro_diario
  FOR ALL TO authenticated
  USING (maestro_id = auth.uid()) WITH CHECK (maestro_id = auth.uid());

-- ── 1.2 RLS de productos_finales: el catálogo del bot (maestro_id NULL) legible ──
DROP POLICY IF EXISTS "productos_finales propios" ON public.productos_finales;
CREATE POLICY productos_finales_lectura_catalogo ON public.productos_finales
  FOR SELECT TO authenticated
  USING (maestro_id IS NULL OR maestro_id = auth.uid());
CREATE POLICY productos_finales_insert_propio ON public.productos_finales
  FOR INSERT TO authenticated WITH CHECK (maestro_id = auth.uid());
CREATE POLICY productos_finales_update_propio ON public.productos_finales
  FOR UPDATE TO authenticated
  USING (maestro_id = auth.uid()) WITH CHECK (maestro_id = auth.uid());
CREATE POLICY productos_finales_delete_propio ON public.productos_finales
  FOR DELETE TO authenticated USING (maestro_id = auth.uid());

-- ── 1.3 Normalización de productos_finales.criterios_evaluacion ──────────────
-- Formato canónico: [{"criterio","descripcion","peso"}] sumando 100.
-- Respaldo del JSON original en criterios_evaluacion_raw (no destructivo).
-- Los 4 formatos históricos encontrados y su transformación:
--   mapa {nombre: peso|"NN%"} (+descripcion_criterios anidado) -> array
--   objeto único {criterio}                                    -> array de 1, peso 100
--   {criterios: ["a","b"]}                                     -> reparto equitativo (residuo al 1o)
--   arrays con clave "porcentaje"                               -> renombrada a "peso"
-- (El SQL completo quedó en la migración mi_salon_normaliza_criterios_productos_finales.)
-- Verificado tras ejecutar: 0 filas no-array, 0 pesos NULL, 215/215 suman 100.

-- ── 1.4 (A.3) banco_criterios_pda ────────────────────────────────────────────
CREATE TABLE public.banco_criterios_pda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pda_id uuid NOT NULL REFERENCES public.catalogo_pda(id),
  grado integer,
  criterio_texto text NOT NULL,
  origen text DEFAULT 'dosificacion_ia',
  uso_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (pda_id, criterio_texto)
);
CREATE INDEX idx_banco_criterios_pda_pda_id ON public.banco_criterios_pda (pda_id);
ALTER TABLE public.banco_criterios_pda ENABLE ROW LEVEL SECURITY;
CREATE POLICY banco_criterios_lectura ON public.banco_criterios_pda
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.incrementar_uso_criterio(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.banco_criterios_pda SET uso_count = uso_count + 1 WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.incrementar_uso_criterio(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.incrementar_uso_criterio(uuid) TO authenticated;

-- Poblado inicial: 4,008 pares (pda, criterio) distintos cubriendo los 1,329 PDAs
INSERT INTO public.banco_criterios_pda (pda_id, grado, criterio_texto)
SELECT DISTINCT dp.pda_id, cp.grado, trim(dsp.criterio_evaluacion)
FROM public.dosificacion_sesion_pdas dsp
JOIN public.dosificacion_pdas dp ON dp.id = dsp.dos_pda_id
JOIN public.catalogo_pda cp ON cp.id = dp.pda_id
WHERE dsp.criterio_evaluacion IS NOT NULL AND trim(dsp.criterio_evaluacion) <> ''
ON CONFLICT (pda_id, criterio_texto) DO NOTHING;

-- ── 2.0 (A.5) productos_sesion + producto_sesion_pda + nuevo grano de calificaciones ──
CREATE TABLE public.productos_sesion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL REFERENCES public.sesiones(id) ON DELETE CASCADE,
  maestro_id uuid NOT NULL REFERENCES auth.users(id),
  tipo text NOT NULL CHECK (tipo IN ('trabajo','tarea','producto_final','examen','otro')),
  nombre text NOT NULL,
  descripcion text,
  grados text[] NOT NULL,              -- SIEMPRE orden ascendente
  modalidad text NOT NULL CHECK (modalidad IN ('compartida','diferenciada')),
  campo text NOT NULL CHECK (campo IN ('LEN','SAB','ETI','DHL')),
  orden smallint DEFAULT 1,
  activo boolean NOT NULL DEFAULT true,
  origen text NOT NULL DEFAULT 'importado' CHECK (origen IN ('importado','backfill','maestro','bot')),
  fecha_entrega date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_productos_sesion_sesion_id ON public.productos_sesion (sesion_id);
ALTER TABLE public.productos_sesion ENABLE ROW LEVEL SECURITY;
CREATE POLICY productos_sesion_propietario ON public.productos_sesion
  FOR ALL TO authenticated
  USING (maestro_id = auth.uid()) WITH CHECK (maestro_id = auth.uid());

CREATE TABLE public.producto_sesion_pda (
  producto_sesion_id uuid REFERENCES public.productos_sesion(id) ON DELETE CASCADE,
  sesion_pda_id uuid REFERENCES public.sesiones_pda(id) ON DELETE CASCADE,
  PRIMARY KEY (producto_sesion_id, sesion_pda_id)
);
ALTER TABLE public.producto_sesion_pda ENABLE ROW LEVEL SECURITY;
CREATE POLICY producto_sesion_pda_propietario ON public.producto_sesion_pda
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.productos_sesion ps
                 WHERE ps.id = producto_sesion_pda.producto_sesion_id AND ps.maestro_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.productos_sesion ps
                 WHERE ps.id = producto_sesion_pda.producto_sesion_id AND ps.maestro_id = auth.uid()));

ALTER TABLE public.calificaciones
  ADD COLUMN IF NOT EXISTS producto_sesion_id uuid REFERENCES public.productos_sesion(id),
  ADD COLUMN IF NOT EXISTS estado_entrega text CHECK (estado_entrega IS NULL OR estado_entrega IN ('entregado','incompleto','no_entregado','justificado','no_aplica')),
  ADD COLUMN IF NOT EXISTS nivel text CHECK (nivel IS NULL OR nivel IN ('logrado','en_proceso','requiere_apoyo')),
  ADD COLUMN IF NOT EXISTS puntaje numeric(4,1) CHECK (puntaje IS NULL OR (puntaje >= 0 AND puntaje <= 10)),
  ADD COLUMN IF NOT EXISTS retroalimentacion text,
  ADD COLUMN IF NOT EXISTS nota_privada text,
  ADD COLUMN IF NOT EXISTS evaluado_en timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS calificaciones_producto_alumno_uq
  ON public.calificaciones (maestro_id, alumno_id, producto_sesion_id)
  WHERE producto_sesion_id IS NOT NULL;

-- Al reeditar un proyecto se borran/reinsertan sesiones (cascada a productos_sesion);
-- las calificaciones capturadas sobreviven como histórico, igual que con sesion_id.
ALTER TABLE public.calificaciones
  DROP CONSTRAINT calificaciones_producto_sesion_id_fkey,
  ADD CONSTRAINT calificaciones_producto_sesion_id_fkey
    FOREIGN KEY (producto_sesion_id) REFERENCES public.productos_sesion(id) ON DELETE SET NULL;

-- ── Fase 5 (A.6) Deprecación: renombrar, no borrar (todas con 0 filas confirmadas
--    el mismo día). DROP definitivo en un ciclo posterior.
-- Se conservan intactas: evaluacion_cuaderno y evaluacion_habilidades_basicas (hasta B.6).
ALTER TABLE public.calificacion_tarea        RENAME TO zz_deprecated_calificacion_tarea;
ALTER TABLE public.calificacion_trabajo      RENAME TO zz_deprecated_calificacion_trabajo;
ALTER TABLE public.diagnosticos              RENAME TO zz_deprecated_diagnosticos;
ALTER TABLE public.configuracion_calificacion RENAME TO zz_deprecated_configuracion_calificacion;
ALTER TABLE public.registros_diarios         RENAME TO zz_deprecated_registros_diarios;
ALTER TABLE public.participacion_jornada     RENAME TO zz_deprecated_participacion_jornada;
ALTER TABLE public.entregas_producto_final   RENAME TO zz_deprecated_entregas_producto_final;
