-- =============================================================================
-- Tarifario v2 (agosto 2026) — reemplaza los precios de marketplace_precios.sql
-- =============================================================================
--
-- Cambios respecto a la primera versión:
--
--   * Bidocente y tridocente pasan a costar LO MISMO. El maestro no elige entre
--     uno y otro: le corresponde el que dicte su escuela, así que diferenciar
--     precio no aportaba nada. Se colapsan en una sola modalidad 'multigrado'.
--   * Bajan los precios: 1 grado $349/trimestre y $699 el ciclo de lanzamiento;
--     multigrado $499 y $999.
--
-- Lo demás no cambia: el trimestre y el add-on de Word son fijos, solo el ciclo
-- escala (1-50 / 51-100 / 101+) con un contador combinado y derivado de las
-- ventas reales.
--
-- Idempotente.
-- =============================================================================

-- ── 1. Admitir la modalidad unificada ───────────────────────────────────────
-- Primero se quita la restricción y se borran las tarifas por modalidad
-- separada; solo después se vuelve a poner. Al revés, la restricción nueva
-- choca con las filas 'tridocente'/'bidocente' que aún existen.
alter table marketplace_precios
  drop constraint if exists marketplace_precios_modalidad_precio_check;

delete from marketplace_precios
where modalidad_precio in ('tridocente', 'bidocente');

alter table marketplace_precios
  add constraint marketplace_precios_modalidad_precio_check
  check (modalidad_precio in ('un_grado', 'multigrado'));

-- ── 2. Tarifas vigentes ─────────────────────────────────────────────────────
insert into marketplace_precios
  (modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable)
values
  -- Trimestre suelto: fijo, solo nivel 1.
  ('un_grado',   'trimestre', 1, 349, 69),
  ('multigrado', 'trimestre', 1, 499, 69),
  -- Ciclo completo: escala 1-50 / 51-100 / 101+.
  ('un_grado',   'ciclo', 1,  699, 169),
  ('un_grado',   'ciclo', 2,  799, 169),
  ('un_grado',   'ciclo', 3,  899, 169),
  ('multigrado', 'ciclo', 1,  999, 169),
  ('multigrado', 'ciclo', 2, 1149, 169),
  ('multigrado', 'ciclo', 3, 1299, 169)
on conflict (modalidad_precio, tipo_paquete, nivel) do update
set precio_base = excluded.precio_base,
    precio_addon_editable = excluded.precio_addon_editable;

-- ── 3. Aplicar el tarifario ─────────────────────────────────────────────────
-- Ya no se mira `modalidad`: cualquier paquete multigrado usa la misma tarifa,
-- sea bidocente o tridocente.
create or replace function marketplace_aplicar_precios()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nivel smallint;
  v_ventas integer;
  v_filas integer;
begin
  v_nivel := marketplace_nivel_ciclo();
  v_ventas := marketplace_ventas_ciclo();

  update marketplace_productos prod
  set precio_pdf = tar.precio_base,
      precio_editable = tar.precio_base + tar.precio_addon_editable,
      updated_at = now()
  from marketplace_precios tar
  where prod.es_prueba = false
    and tar.modalidad_precio = case
          when prod.organizacion = 'multigrado' then 'multigrado'
          else 'un_grado'
        end
    and tar.tipo_paquete = prod.tipo_paquete
    -- El trimestre no escala: siempre nivel 1.
    and tar.nivel = case when prod.tipo_paquete = 'ciclo' then v_nivel else 1 end
    and (prod.precio_pdf is distinct from tar.precio_base
      or prod.precio_editable is distinct from tar.precio_base + tar.precio_addon_editable);

  get diagnostics v_filas = row_count;

  return jsonb_build_object(
    'nivel', v_nivel,
    'ventas_ciclo', v_ventas,
    'productos_actualizados', v_filas
  );
end;
$$;

select marketplace_aplicar_precios();
