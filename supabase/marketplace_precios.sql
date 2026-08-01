-- =============================================================================
-- Precios del marketplace y escalón de lanzamiento
-- =============================================================================
--
-- Reglas de negocio (spec de precios, agosto 2026):
--
--   * El paquete base se entrega en PDF. La versión editable en Word es un
--     ADD-ON que se suma al precio base — no es un precio alternativo.
--   * El trimestre suelto y el add-on tienen precio FIJO: nunca escalan.
--   * Solo el CICLO COMPLETO escala con las ventas, en tres niveles:
--         nivel 1 → ventas 1 a 50
--         nivel 2 → ventas 51 a 100
--         nivel 3 → venta 101 en adelante
--   * El contador es COMBINADO: suma las ventas de ciclo de las tres
--     modalidades y todas suben de nivel a la vez.
--   * El cambio aplica a la siguiente venta, nunca retroactivamente: los
--     precios ya cobrados quedan congelados en marketplace_ordenes.
--
-- Nomenclatura de modalidades (contraintuitiva pero correcta):
--   tridocente = paquete de 2 grados (1°-2°, 3°-4°, 5°-6°)
--   bidocente  = paquete de 3 grados (1°-2°-3°, 4°-5°-6°)
--
-- Idempotente: se puede volver a ejecutar sin romper nada.
-- =============================================================================

-- ── 1. Tarifario ────────────────────────────────────────────────────────────
create table if not exists marketplace_precios (
  modalidad_precio text not null
    check (modalidad_precio in ('un_grado', 'tridocente', 'bidocente')),
  tipo_paquete text not null
    check (tipo_paquete in ('trimestre', 'ciclo')),
  -- El trimestre solo usa el nivel 1: su precio no escala.
  nivel smallint not null check (nivel between 1 and 3),
  precio_base numeric(10, 2) not null check (precio_base >= 0),
  precio_addon_editable numeric(10, 2) not null check (precio_addon_editable >= 0),
  primary key (modalidad_precio, tipo_paquete, nivel)
);

comment on table marketplace_precios is
  'Tarifario. precio_base = versión PDF; el editable cuesta base + add-on.';

-- ── 2. Estado del lanzamiento (fila única) ──────────────────────────────────
create table if not exists marketplace_lanzamiento (
  id boolean primary key default true check (id),
  -- Fuerza un nivel concreto (1-3). NULL = automático por número de ventas.
  nivel_forzado smallint check (nivel_forzado between 1 and 3),
  -- Suma/resta manual al contador, por si hay que corregir algo a mano.
  ajuste_contador integer not null default 0,
  actualizado_en timestamptz not null default now()
);

insert into marketplace_lanzamiento (id) values (true)
on conflict (id) do nothing;

comment on table marketplace_lanzamiento is
  'Control del escalón de precios. nivel_forzado sobrescribe el automático.';

-- ── 3. Tarifas vigentes ─────────────────────────────────────────────────────
-- Se reescriben en cada ejecución para que este archivo sea la fuente de verdad.
insert into marketplace_precios
  (modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable)
values
  -- Trimestre suelto: precio fijo, solo nivel 1.
  ('un_grado',   'trimestre', 1,  399, 69),
  ('tridocente', 'trimestre', 1,  599, 69),
  ('bidocente',  'trimestre', 1,  799, 69),
  -- Ciclo completo: escala 1-50 / 51-100 / 101+.
  ('un_grado',   'ciclo', 1,  649, 169),
  ('un_grado',   'ciclo', 2,  799, 169),
  ('un_grado',   'ciclo', 3,  999, 169),
  ('tridocente', 'ciclo', 1,  999, 169),
  ('tridocente', 'ciclo', 2, 1199, 169),
  ('tridocente', 'ciclo', 3, 1499, 169),
  ('bidocente',  'ciclo', 1, 1349, 169),
  ('bidocente',  'ciclo', 2, 1599, 169),
  ('bidocente',  'ciclo', 3, 1999, 169)
on conflict (modalidad_precio, tipo_paquete, nivel) do update
set precio_base = excluded.precio_base,
    precio_addon_editable = excluded.precio_addon_editable;

-- ── 4. Contador de ventas de ciclo completo ─────────────────────────────────
-- Derivado, no almacenado: siempre refleja la realidad. Una orden reembolsada
-- pasa a 'fallido' y deja de contar sola, sin mantenimiento.
create or replace function marketplace_ventas_ciclo()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(distinct o.id), 0)::integer + coalesce(
           (select ajuste_contador from marketplace_lanzamiento where id), 0)
  from marketplace_ordenes o
  join marketplace_orden_items i on i.orden_id = o.id
  join marketplace_productos p on p.id = i.producto_id
  where o.estado = 'pagado'
    and p.tipo_paquete = 'ciclo';
$$;

-- ── 5. Nivel vigente ────────────────────────────────────────────────────────
create or replace function marketplace_nivel_ciclo()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nivel_forzado from marketplace_lanzamiento where id),
    case
      when marketplace_ventas_ciclo() < 50  then 1::smallint
      when marketplace_ventas_ciclo() < 100 then 2::smallint
      else 3::smallint
    end
  );
$$;

-- ── 6. Aplicar el tarifario a los productos ─────────────────────────────────
-- Escribe el precio vigente en marketplace_productos para que el catálogo lo
-- lea directo: lo que se muestra es exactamente lo que se cobra.
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
  where tar.modalidad_precio = case
          when prod.organizacion = 'multigrado' then prod.modalidad
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

-- ── 7. Panel de administración ──────────────────────────────────────────────
-- Resumen para el admin: en qué número va el contador y qué precios rigen.
create or replace function admin_estado_precios()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nivel smallint;
  v_ventas integer;
  v_forzado smallint;
  v_ajuste integer;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  select nivel_forzado, ajuste_contador into v_forzado, v_ajuste
  from marketplace_lanzamiento where id;

  v_nivel := marketplace_nivel_ciclo();
  v_ventas := marketplace_ventas_ciclo();

  return jsonb_build_object(
    'ventas_ciclo', v_ventas,
    'nivel', v_nivel,
    'nivel_forzado', v_forzado,
    'ajuste_contador', v_ajuste,
    'faltan_para_siguiente',
      case when v_nivel = 1 then 50 - v_ventas
           when v_nivel = 2 then 100 - v_ventas
           else null end,
    'tarifas', (
      select jsonb_agg(t order by t.modalidad_precio, t.tipo_paquete, t.nivel)
      from (
        select modalidad_precio, tipo_paquete, nivel, precio_base,
               precio_addon_editable,
               precio_base + precio_addon_editable as precio_con_editable,
               (tipo_paquete = 'ciclo' and nivel = v_nivel)
                 or (tipo_paquete = 'trimestre' and nivel = 1) as vigente
        from marketplace_precios
      ) t
    )
  );
end;
$$;

-- Ajuste manual de respaldo: forzar nivel y/o corregir el contador.
create or replace function admin_ajustar_lanzamiento(
  p_nivel_forzado smallint default null,
  p_ajuste_contador integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  update marketplace_lanzamiento
  set nivel_forzado = p_nivel_forzado,
      ajuste_contador = coalesce(p_ajuste_contador, ajuste_contador),
      actualizado_en = now()
  where id;

  return marketplace_aplicar_precios();
end;
$$;

-- ── 8. Permisos y RLS ───────────────────────────────────────────────────────
alter table marketplace_precios enable row level security;
alter table marketplace_lanzamiento enable row level security;

-- Sin políticas de lectura pública: el catálogo lee los precios ya aplicados
-- en marketplace_productos. Estas tablas son configuración interna.
drop policy if exists "precios: solo admin" on marketplace_precios;
create policy "precios: solo admin" on marketplace_precios
  for select using (es_admin());

drop policy if exists "lanzamiento: solo admin" on marketplace_lanzamiento;
create policy "lanzamiento: solo admin" on marketplace_lanzamiento
  for select using (es_admin());

revoke all on function marketplace_aplicar_precios() from public, anon;
revoke all on function marketplace_ventas_ciclo() from public, anon;
revoke all on function marketplace_nivel_ciclo() from public, anon;
grant execute on function admin_estado_precios() to authenticated;
grant execute on function admin_ajustar_lanzamiento(smallint, integer) to authenticated;

-- ── 9. Aplicar ya ───────────────────────────────────────────────────────────
select marketplace_aplicar_precios();
