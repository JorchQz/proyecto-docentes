-- =============================================================================
-- Tarifario v3 (agosto 2026) — precios de lanzamiento + paquete unitario
-- =============================================================================
--
-- Cambios respecto a v2:
--
--   * Bajan todos los precios (lanzamiento): 1 grado $249/trimestre y $499 el
--     ciclo; multigrado $299 y $599. Add-on de Word: $49 trimestre, $99 ciclo.
--   * Se DESACTIVA la escalada automática por volumen de ventas. Jorge decide
--     a mano cuándo subir (editando este tarifario en un futuro v4). Para que
--     no haya ninguna ruta por la que el precio suba solo:
--       - los tres niveles del ciclo llevan el mismo precio, y
--       - marketplace_lanzamiento.nivel_forzado queda fijado en 1.
--   * Nueva modalidad de precio 'unitaria': el maestro que atiende los 6
--     grados compra en UNA orden todos los combos multigrado de una agrupación
--     (3 de tridocente: 1-2, 3-4, 5-6, o 2 de bidocente: 1-2-3, 4-5-6) con
--     descuento. No existen productos 'unitaria' en marketplace_productos: la
--     Edge Function crear-preferencia-mp arma la orden combinada leyendo esta
--     tarifa, y el frontend la muestra vía marketplace_precio_unitaria().
--
-- Idempotente.
-- =============================================================================

-- ── 1. Admitir la modalidad 'unitaria' en el tarifario ──────────────────────
alter table marketplace_precios
  drop constraint if exists marketplace_precios_modalidad_precio_check;

alter table marketplace_precios
  add constraint marketplace_precios_modalidad_precio_check
  check (modalidad_precio in ('un_grado', 'multigrado', 'unitaria'));

-- ── 2. Tarifas vigentes (precio de lanzamiento, plano) ──────────────────────
insert into marketplace_precios
  (modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable)
values
  -- Trimestre suelto: solo nivel 1.
  ('un_grado',   'trimestre', 1, 249, 49),
  ('multigrado', 'trimestre', 1, 299, 49),
  ('unitaria',   'trimestre', 1, 449, 49),
  -- Ciclo completo: mismo precio en los tres niveles (escalada neutralizada).
  ('un_grado',   'ciclo', 1, 499, 99),
  ('un_grado',   'ciclo', 2, 499, 99),
  ('un_grado',   'ciclo', 3, 499, 99),
  ('multigrado', 'ciclo', 1, 599, 99),
  ('multigrado', 'ciclo', 2, 599, 99),
  ('multigrado', 'ciclo', 3, 599, 99),
  ('unitaria',   'ciclo', 1, 899, 99),
  ('unitaria',   'ciclo', 2, 899, 99),
  ('unitaria',   'ciclo', 3, 899, 99)
on conflict (modalidad_precio, tipo_paquete, nivel) do update
set precio_base = excluded.precio_base,
    precio_addon_editable = excluded.precio_addon_editable;

-- ── 3. Fijar el nivel a mano ────────────────────────────────────────────────
-- Con los niveles idénticos esto es redundante en la práctica, pero deja el
-- estado explícito en el panel admin: el contador de ventas ya no manda.
update marketplace_lanzamiento
set nivel_forzado = 1,
    actualizado_en = now()
where id;

-- ── 4. Precio público del paquete unitario ──────────────────────────────────
-- marketplace_precios tiene RLS solo-admin y la unitaria no tiene productos
-- de los que el catálogo pueda derivar precio, así que se expone SOLO esta
-- lectura puntual. Nunca se cobra desde el cliente: crear-preferencia-mp
-- relee la tabla con service role.
create or replace function marketplace_precio_unitaria(p_tipo_paquete text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'precio_pdf', precio_base,
    'precio_editable', precio_base + precio_addon_editable
  )
  from marketplace_precios
  where modalidad_precio = 'unitaria'
    and tipo_paquete = p_tipo_paquete
    and nivel = 1;
$$;

grant execute on function marketplace_precio_unitaria(text) to anon, authenticated;

-- ── 5. Aplicar el tarifario ─────────────────────────────────────────────────
-- marketplace_aplicar_precios() (definida en v2) no cambia: su CASE solo
-- produce 'un_grado'/'multigrado', así que las filas 'unitaria' no matchean
-- ningún producto y no estorban.
select marketplace_aplicar_precios();
