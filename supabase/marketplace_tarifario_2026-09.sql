-- =============================================================================
-- Tarifario editable a mano (septiembre 2026) -- jubila el escalon de ventas
-- =============================================================================
--
-- El escalon de lanzamiento (nivel 1-3 segun ventas acumuladas de ciclo) se
-- retira. Nunca llego a usarse: desde marketplace_precios_v3.sql los tres
-- niveles llevan el mismo precio y nivel_forzado estaba clavado en 1. Lo unico
-- que se usaba de verdad era propagar el tarifario a los 44 paquetes despues de
-- cada venta y de cada reembolso, y eso se conserva.
--
-- Este archivo es ADITIVO: no borra nada. Las funciones del escalon siguen
-- vivas para que el panel admin desplegado hoy no reviente mientras se sube el
-- nuevo. El borrado va en marketplace_escalon_retiro.sql, DESPUES del deploy.
--
-- Idempotente.
-- =============================================================================

-- ── 1. El nivel deja de significar nada ─────────────────────────────────────
comment on column marketplace_precios.nivel is
  'Vestigio del escalon de lanzamiento (retirado en septiembre de 2026). Se conserva porque forma parte de la clave primaria. admin_guardar_tarifario escribe el mismo precio en los tres niveles y todo lector usa nivel = 1.';

-- ── 2. Aplicar el tarifario, sin nivel ──────────────────────────────────────
-- Mismo nombre y mismo llamador (_shared/pagos.ts::recalcularPrecios, tras cada
-- pago aprobado y cada reembolso). Cambia solo el CASE del nivel por un 1 fijo:
-- ya no hay ninguna via por la que el precio suba solo.
--
-- Se conservan los dos matices de la version viva en la BD, que no estaba en
-- ningun .sql del repo: el filtro es_prueba (el paquete de prueba tiene precio
-- simbolico propio) y la modalidad fija 'multigrado' (si se usara prod.modalidad
-- los 20 paquetes multigrado no matchearian ninguna tarifa y se quedarian sin
-- actualizar, en silencio).
create or replace function marketplace_aplicar_precios()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
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
    and tar.nivel = 1
    and (prod.precio_pdf is distinct from tar.precio_base
      or prod.precio_editable is distinct from tar.precio_base + tar.precio_addon_editable);

  get diagnostics v_filas = row_count;

  -- Se conserva la clave 'productos_actualizados': el admin desplegado hoy la
  -- lee en el toast de admin_ajustar_lanzamiento.
  return jsonb_build_object('productos_actualizados', v_filas);
end;
$$;

-- ── 3. Estado que alimenta TODA la pestana Precios ──────────────────────────
-- Se amplia admin_estado_promocion() en vez de crear un admin_estado_tarifario
-- paralelo: si las dos tarjetas leen la misma fila no pueden contradecirse, y la
-- previsualizacion con descuento se actualiza sola al guardar el tarifario.
-- Cambios: se anade 'addon' (para poder editarlo) y un orden de lectura humano.
create or replace function admin_estado_promocion()
returns jsonb
language plpgsql
security definer
set search_path = public
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
               case t.tipo_paquete when 'trimestre' then 1 else 2 end)
      from marketplace_precios t
      where t.nivel = 1
    )
  ) into v
  from marketplace_promocion p where p.id;

  return v;
end;
$$;

-- ── 4. Guardar el tarifario a mano ──────────────────────────────────────────
-- Entrada: lista de 6 renglones
--   [{"modalidad_precio":"un_grado","tipo_paquete":"trimestre",
--     "precio_base":249,"precio_addon_editable":49}, ...]
--
-- Exige las 6 combinaciones: un envio parcial dejaria un renglon viejo sin
-- avisar, y ese renglon se propaga a los paquetes en la siguiente venta.
create or replace function admin_guardar_tarifario(p_tarifas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    'un_grado|trimestre', 'un_grado|ciclo',
    'multigrado|trimestre', 'multigrado|ciclo',
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
       or v_tipo not in ('trimestre', 'ciclo') then
      raise exception 'Renglon desconocido: % / %', v_mod, v_tipo;
    end if;
    if v_base is null or v_addon is null then
      raise exception 'Faltan precios en % / %', v_mod, v_tipo;
    end if;
    -- Pesos completos: hoy no hay ni un centavo en el tarifario, el redondeo de
    -- la promocion es floor() y los cupones de monto fijo son enteros. Mantener
    -- todo entero evita que aparezca un $198.99 que nadie escribio.
    if v_base <> floor(v_base) or v_addon <> floor(v_addon) then
      raise exception 'Los precios van en pesos completos, sin centavos (% / %)', v_mod, v_tipo;
    end if;
    if v_base < 10 or v_base > 99999 or v_addon < 0 or v_addon > 99999 then
      raise exception 'Precio fuera de rango en % / %: el PDF va entre 10 y 99999', v_mod, v_tipo;
    end if;

    -- El mismo precio en los tres niveles del ciclo: el nivel es vestigio y no
    -- debe quedar ninguna cifra vieja escondida en nivel 2 o 3.
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

  -- Propagar a los 44 paquetes ahora mismo, no en la siguiente venta.
  v_aplicado := marketplace_aplicar_precios();

  return admin_estado_promocion()
       || jsonb_build_object('productos_actualizados',
                             v_aplicado -> 'productos_actualizados');
end;
$$;

revoke all on function admin_guardar_tarifario(jsonb) from public, anon;
grant execute on function admin_guardar_tarifario(jsonb) to authenticated;

-- ── 5. Comprobacion ─────────────────────────────────────────────────────────
select marketplace_aplicar_precios();

select modalidad_precio, tipo_paquete, nivel, precio_base, precio_addon_editable
from marketplace_precios
order by modalidad_precio, tipo_paquete, nivel;
