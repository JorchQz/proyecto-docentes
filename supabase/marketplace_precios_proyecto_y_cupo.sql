-- =============================================================================
-- Proyectos sueltos en el tarifario y cupo simultaneo de personalizados
-- =============================================================================
--
-- 1. Precio de los proyectos sueltos POR MODALIDAD (un grado / multigrado),
--    igual que los paquetes: un renglon 'proyecto' en marketplace_precios en
--    vez de un precio por producto. precio_base = sin anexos;
--    precio_addon_editable = extra CON anexos (el Word va incluido siempre).
--    marketplace_aplicar_precios() los propaga a marketplace_productos como
--    hace con los paquetes, asi que el admin ya no edita precios por fila.
--
-- 2. Cupo de pedidos a la medida SIMULTANEO, no semanal: cupos = tope menos
--    pedidos pagados sin entregar. Al entregar uno se libera un lugar al
--    instante; nadie tiene que esperar "al lunes".
--
-- Idempotente.
-- =============================================================================

-- ── 1. Tarifario: renglon 'proyecto' ────────────────────────────────────────
alter table marketplace_precios drop constraint if exists marketplace_precios_tipo_paquete_check;
alter table marketplace_precios add constraint marketplace_precios_tipo_paquete_check
  check (tipo_paquete in ('trimestre', 'ciclo', 'proyecto'));

insert into marketplace_precios (modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable)
values ('un_grado', 'proyecto', 1, 80, 40), ('multigrado', 'proyecto', 1, 80, 40)
on conflict (modalidad_precio, tipo_paquete, nivel) do nothing;

comment on column marketplace_precios.precio_addon_editable is
  'Paquetes: extra por la version Word. Proyecto suelto: extra por la version CON anexos (el Word va incluido).';

create or replace function public.marketplace_aplicar_precios()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_paquetes integer;
  v_sueltos integer;
begin
  -- Paquetes (trimestre / ciclo): PDF y Word.
  update marketplace_productos prod
  set precio_pdf = tar.precio_base,
      precio_editable = tar.precio_base + tar.precio_addon_editable,
      updated_at = now()
  from marketplace_precios tar
  where prod.es_prueba = false
    and prod.tipo_paquete in ('trimestre', 'ciclo')
    and tar.modalidad_precio = case when prod.organizacion = 'multigrado' then 'multigrado' else 'un_grado' end
    and tar.tipo_paquete = prod.tipo_paquete
    and tar.nivel = 1
    and (prod.precio_pdf is distinct from tar.precio_base
      or prod.precio_editable is distinct from tar.precio_base + tar.precio_addon_editable);
  get diagnostics v_paquetes = row_count;

  -- Proyectos sueltos: sin anexos y con anexos. Word incluido (precio_editable null).
  update marketplace_productos prod
  set precio_pdf = tar.precio_base,
      precio_pdf_con_anexos = tar.precio_base + tar.precio_addon_editable,
      precio_editable = null,
      updated_at = now()
  from marketplace_precios tar
  where prod.es_prueba = false
    and prod.tipo_paquete = 'proyecto'
    and tar.modalidad_precio = case when prod.organizacion = 'multigrado' then 'multigrado' else 'un_grado' end
    and tar.tipo_paquete = 'proyecto'
    and tar.nivel = 1
    and (prod.precio_pdf is distinct from tar.precio_base
      or prod.precio_pdf_con_anexos is distinct from tar.precio_base + tar.precio_addon_editable
      or prod.precio_editable is not null);
  get diagnostics v_sueltos = row_count;

  return jsonb_build_object('productos_actualizados', v_paquetes + v_sueltos,
                            'paquetes', v_paquetes, 'sueltos', v_sueltos);
end;
$$;

create or replace function public.admin_guardar_tarifario(p_tarifas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila jsonb;
  v_mod text;
  v_tipo text;
  v_base numeric;
  v_addon numeric;
  v_vistas text[] := '{}';
  v_faltan text[];
  v_esperadas constant text[] := array[
    'un_grado|trimestre', 'un_grado|ciclo', 'un_grado|proyecto',
    'multigrado|trimestre', 'multigrado|ciclo', 'multigrado|proyecto',
    'unitaria|trimestre', 'unitaria|ciclo'];
  v_aplicado jsonb;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  if jsonb_typeof(p_tarifas) is distinct from 'array' then
    raise exception 'El tarifario debe llegar como lista de renglones';
  end if;

  for v_fila in select * from jsonb_array_elements(p_tarifas) loop
    v_mod   := v_fila ->> 'modalidad_precio';
    v_tipo  := v_fila ->> 'tipo_paquete';
    v_base  := (v_fila ->> 'precio_base')::numeric;
    v_addon := (v_fila ->> 'precio_addon_editable')::numeric;

    if v_mod not in ('un_grado', 'multigrado', 'unitaria')
       or v_tipo not in ('trimestre', 'ciclo', 'proyecto')
       or (v_mod = 'unitaria' and v_tipo = 'proyecto') then
      raise exception 'Renglon desconocido: % / %', v_mod, v_tipo;
    end if;
    if v_base is null or v_addon is null then
      raise exception 'Faltan precios en % / %', v_mod, v_tipo;
    end if;
    if v_base <> floor(v_base) or v_addon <> floor(v_addon) then
      raise exception 'Los precios van en pesos completos, sin centavos (% / %)', v_mod, v_tipo;
    end if;
    if v_base < 10 or v_base > 99999 or v_addon < 0 or v_addon > 99999 then
      raise exception 'Precio fuera de rango en % / %: el PDF va entre 10 y 99999', v_mod, v_tipo;
    end if;

    insert into marketplace_precios
      (modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable)
    select v_mod, v_tipo, n::smallint, v_base, v_addon
    from generate_series(1, case when v_tipo = 'ciclo' then 3 else 1 end) as n
    on conflict (modalidad_precio, tipo_paquete, nivel) do update
    set precio_base = excluded.precio_base,
        precio_addon_editable = excluded.precio_addon_editable;

    v_vistas := v_vistas || (v_mod || '|' || v_tipo);
  end loop;

  select array_agg(e) into v_faltan
  from unnest(v_esperadas) e
  where e <> all (v_vistas);
  if v_faltan is not null then
    raise exception 'Falta el precio de: %', array_to_string(v_faltan, ', ');
  end if;

  v_aplicado := marketplace_aplicar_precios();

  return admin_estado_promocion()
       || jsonb_build_object('productos_actualizados', v_aplicado -> 'productos_actualizados');
end;
$$;

create or replace function public.admin_estado_promocion()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  select jsonb_build_object(
    'activa', p.activa,
    'porcentaje', p.porcentaje,
    'vigente_desde', p.vigente_desde,
    'vigente_hasta', p.vigente_hasta,
    'etiqueta', p.etiqueta,
    'actualizado_en', p.actualizado_en,
    'vigente_ahora',
      coalesce((marketplace_promocion_vigente() ->> 'activa')::boolean, false),
    'previsualizacion', (
      select jsonb_agg(jsonb_build_object(
               'modalidad_precio', t.modalidad_precio,
               'tipo_paquete', t.tipo_paquete,
               'lista_pdf', t.precio_base,
               'addon', t.precio_addon_editable,
               'lista_editable', t.precio_base + t.precio_addon_editable,
               'promo_pdf', marketplace_redondeo_promo(t.precio_base, p.porcentaje),
               'promo_editable', marketplace_redondeo_promo(
                 t.precio_base + t.precio_addon_editable, p.porcentaje))
             order by
               case t.modalidad_precio
                 when 'un_grado' then 1 when 'multigrado' then 2 else 3 end,
               case t.tipo_paquete when 'trimestre' then 1 when 'ciclo' then 2 else 3 end)
      from marketplace_precios t
      where t.nivel = 1
    )
  ) into v
  from marketplace_promocion p where p.id;

  return v;
end;
$$;

-- Aplicar ya a los sueltos existentes.
select marketplace_aplicar_precios();

-- ── 2. Cupo simultaneo de pedidos a la medida ───────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'marketplace_personalizados_config' and column_name = 'tope_semanal') then
    alter table marketplace_personalizados_config rename column tope_semanal to tope_simultaneo;
  end if;
end $$;
comment on column marketplace_personalizados_config.tope_simultaneo is
  'Pedidos pagados y sin entregar que puede haber a la vez. Al entregar uno se libera un lugar.';

create or replace function public.marketplace_personalizados_estado()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (select * from marketplace_personalizados_config where id),
  activos as (
    select count(*)::integer as n
    from marketplace_pedidos
    where estado in ('pendiente', 'en_proceso')
  )
  select jsonb_build_object(
    'abierto', c.abierto,
    'tope_simultaneo', c.tope_simultaneo,
    'en_curso', a.n,
    'cupos_disponibles', greatest(c.tope_simultaneo - a.n, 0),
    'ventana_horas', c.ventana_horas,
    'precio_sin_anexos', c.precio_sin_anexos,
    'precio_con_anexos', c.precio_con_anexos,
    'mensaje', c.mensaje_cerrado
  )
  from c, activos a;
$$;

create or replace function public.admin_guardar_personalizados(
  p_abierto boolean, p_tope integer, p_ventana integer,
  p_precio_sin numeric, p_precio_con numeric, p_mensaje text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  if p_precio_con < p_precio_sin then
    raise exception 'El precio con anexos no puede ser menor que el precio sin anexos';
  end if;
  update marketplace_personalizados_config
  set abierto = coalesce(p_abierto, abierto),
      tope_simultaneo = coalesce(p_tope, tope_simultaneo),
      ventana_horas = coalesce(p_ventana, ventana_horas),
      precio_sin_anexos = coalesce(p_precio_sin, precio_sin_anexos),
      precio_con_anexos = coalesce(p_precio_con, precio_con_anexos),
      mensaje_cerrado = p_mensaje,
      actualizado_en = now()
  where id;
  return admin_estado_personalizados();
end;
$$;
