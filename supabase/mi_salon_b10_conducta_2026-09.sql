-- ════════════════════════════════════════════════════════════════════════════
-- Mi salón · b10 · La conducta sale del número (auditoría NEM, 2026-09-24)
--
-- Decisión de Jorge: la Ley General de Educación (art. 21) pide informar la conducta
-- APARTE de los resultados de la evaluación. Desde ahora la conducta no pondera:
--   - js/motor-calificacion.js le pone peso 0 siempre (su peso se reparte como el de
--     cualquier rubro sin datos) e ignora peso_conducta;
--   - Ajustes ya no deja darle peso ni lo envía al guardar.
-- En la base, lo único que ponderaba la conducta era maestro_ajustes:
--   - DEFAULT peso_conducta = 5  → 0;
--   - CHECK pesos_suman_100 (los cinco pesos suman 100). Con la conducta fuera, los
--     cuatro pesos de fábrica suman 95 (28/28/6/33, que se quedan como están), así que
--     una fila nueva con los DEFAULT ya no cumpliría esa regla. Se reemplaza por
--     pesos_con_valor: los cuatro pesos que cuentan suman más de 0 (el motor los usa
--     en proporción a su suma). NOT VALID: no revisa filas viejas, solo las que se
--     escriban desde ahora.
-- No se borra ninguna columna ni ningún dato: peso_conducta se queda (un peso
-- personalizado que ya exista no se toca; solo se ignora en el cálculo). Las boletas
-- cerradas conservan su foto (texto_autogenerado.cierre) con la conducta que tenía.
-- Ninguna función SQL usa peso_conducta (revisado en pg_proc: 0 funciones mencionan
-- "conducta"); calcular_calificacion_boleta solo convierte porcentaje → calificación.
--
-- Idempotente. Aplicado en pruebas (raoxdxwgsxbqlzdnndly) el 2026-09-24.
-- Producción: aplicarlo ANTES de publicar el js (si no, Ajustes no podría guardar
-- pesos que no sumen 100 con el peso_conducta viejo).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.maestro_ajustes alter column peso_conducta set default 0;

alter table public.maestro_ajustes drop constraint if exists pesos_suman_100;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pesos_con_valor' and conrelid = 'public.maestro_ajustes'::regclass
  ) then
    alter table public.maestro_ajustes add constraint pesos_con_valor
      check (peso_tareas + peso_trabajos + peso_participacion + peso_examen > 0) not valid;
  end if;
end $$;

comment on column public.maestro_ajustes.peso_conducta is
  'Sin uso desde 2026-09-24: la conducta no pondera (LGE art. 21). Se conserva; el motor la ignora.';
