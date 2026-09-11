-- =============================================================================
-- Ambitos de la promocion: a que se aplica el descuento (2026-09-09)
-- =============================================================================
--
-- NOTA (2026-09-11): la version de marketplace_cupon_evaluar que trae este
-- archivo compara el cupon contra la promocion (gana el mayor). Esa regla fue
-- sustituida: hoy el cupon SE SUMA a la oferta. Si reaplicas este archivo,
-- reaplica despues marketplace_cupon_acumulable.sql.
--
-- La oferta general ya no es "todo o nada": desde el admin se elige si aplica
-- a los paquetes (trimestre y ciclo, incluida la unitaria), a los proyectos
-- individuales y a los proyectos a la medida. Por defecto aplica a paquetes y
-- proyectos individuales y NO a los personalizados.
--
-- El ambito viaja como texto ('paquete' | 'proyecto' | 'personalizado') por
-- toda la cadena que decide importes:
--
--   marketplace_promocion_vigente()            -> devuelve `ambitos` al publico
--   marketplace_precio_final(precio, ambito)   -> autoridad del importe
--   marketplace_cupon_evaluar(..., ambito)     -> compara cupon contra la promo
--   marketplace_validar_cupon(..., ambito)     -> la que llama el checkout
--   marketplace_precio_con_cupon(..., ambito)  -> la que llama crear-preferencia-mp
--   admin_estado_promocion / admin_guardar_promocion -> los tres interruptores
--
-- Todas las firmas viejas se sustituyen por otras con el ambito al final y
-- valor por defecto 'paquete', asi nada de lo existente cambia de resultado.
-- El espejo en el navegador esta en tienda/js/tienda-common.js (aplicaA).
--
-- Idempotente.
-- =============================================================================

-- ── 1. Interruptores ────────────────────────────────────────────────────────
alter table marketplace_promocion
  add column if not exists aplica_paquetes boolean not null default true,
  add column if not exists aplica_proyectos boolean not null default true,
  add column if not exists aplica_personalizados boolean not null default false;

comment on column marketplace_promocion.aplica_paquetes is 'La promocion aplica a paquetes de trimestre y ciclo (incluida la unitaria).';
comment on column marketplace_promocion.aplica_proyectos is 'La promocion aplica a proyectos individuales.';
comment on column marketplace_promocion.aplica_personalizados is 'La promocion aplica a proyectos a la medida (pedidos).';

-- ── 2. ¿Aplica al ambito? ───────────────────────────────────────────────────
create or replace function marketplace_promocion_aplica(p_ambito text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case coalesce(p_ambito, 'paquete')
             when 'proyecto'      then p.aplica_proyectos
             when 'personalizado' then p.aplica_personalizados
             else p.aplica_paquetes
           end
    from marketplace_promocion p where p.id), false);
$$;
revoke all on function marketplace_promocion_aplica(text) from public, anon;

-- ── 3. Lo que ve el publico ─────────────────────────────────────────────────
create or replace function marketplace_promocion_vigente()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
       when p.activa
        and now() >= coalesce(p.vigente_desde, '-infinity'::timestamptz)
        and now() <  coalesce(p.vigente_hasta,  'infinity'::timestamptz)
       then jsonb_build_object(
              'activa', true,
              'porcentaje', p.porcentaje,
              'etiqueta', p.etiqueta,
              'vigente_hasta', p.vigente_hasta,
              'ambitos', jsonb_build_object(
                'paquetes', p.aplica_paquetes,
                'proyectos', p.aplica_proyectos,
                'personalizados', p.aplica_personalizados))
       else jsonb_build_object('activa', false)
     end
     from marketplace_promocion p where p.id),
    jsonb_build_object('activa', false)
  );
$$;
grant execute on function marketplace_promocion_vigente() to anon, authenticated;

-- ── 4. El importe que se cobra, por ambito ──────────────────────────────────
drop function if exists marketplace_precio_final(numeric);
create or replace function marketplace_precio_final(p_precio numeric, p_ambito text default 'paquete')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_promo jsonb;
begin
  if p_precio is null then return null; end if;
  v_promo := marketplace_promocion_vigente();
  if coalesce((v_promo ->> 'activa')::boolean, false)
     and marketplace_promocion_aplica(p_ambito) then
    return marketplace_redondeo_promo(p_precio, (v_promo ->> 'porcentaje')::smallint);
  end if;
  return p_precio;
end;
$$;
revoke all on function marketplace_precio_final(numeric, text) from public, anon, authenticated;

-- ── 5. Cupon contra promocion, por ambito ───────────────────────────────────
-- Mismo cuerpo que en marketplace_cupones.sql; solo cambia que la promo de
-- referencia se evalua con el ambito.
drop function if exists marketplace_cupon_evaluar(text, numeric, uuid);
create or replace function marketplace_cupon_evaluar(
  p_codigo text,
  p_precio_lista numeric,
  p_user_id uuid,
  p_ambito text default 'paquete'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_codigo text;
  v_usos integer;
  v_promo numeric;
  v_cupon numeric;
  v_origen_base text;
  v_piso constant numeric := 10;
begin
  if p_precio_lista is null then
    raise exception 'Falta el precio de lista';
  end if;

  v_promo := marketplace_precio_final(p_precio_lista, p_ambito);
  v_origen_base := case when v_promo < p_precio_lista then 'promo' else 'lista' end;

  v_codigo := nullif(upper(btrim(coalesce(p_codigo, ''))), '');

  if v_codigo is null then
    return jsonb_build_object(
      'codigo', null, 'valido', false, 'aplicado', false, 'motivo', null,
      'mensaje', '', 'tipo', null, 'valor', null,
      'precio_lista', p_precio_lista, 'precio_promo', v_promo,
      'precio_cupon', null, 'precio_final', v_promo,
      'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
      'requiere_sesion', false);
  end if;

  select * into c from marketplace_cupones where codigo = v_codigo;

  if not found or not c.activo
     or (c.vigente_hasta is not null and now() >= c.vigente_hasta) then
    return jsonb_build_object(
      'codigo', v_codigo, 'valido', false, 'aplicado', false,
      'motivo', 'inexistente',
      'mensaje', 'Ese cupón no existe o ya no está disponible.',
      'tipo', null, 'valor', null,
      'precio_lista', p_precio_lista, 'precio_promo', v_promo,
      'precio_cupon', null, 'precio_final', v_promo,
      'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
      'requiere_sesion', false);
  end if;

  if c.max_usos is not null then
    select count(*)::int into v_usos
    from marketplace_ordenes o
    where o.estado = 'pagado' and o.cupon_codigo = v_codigo;
    if v_usos >= c.max_usos then
      return jsonb_build_object(
        'codigo', v_codigo, 'valido', false, 'aplicado', false,
        'motivo', 'agotado',
        'mensaje', 'Este cupón ya llegó a su límite de usos.',
        'tipo', c.tipo, 'valor', c.valor,
        'precio_lista', p_precio_lista, 'precio_promo', v_promo,
        'precio_cupon', null, 'precio_final', v_promo,
        'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
        'requiere_sesion', false);
    end if;
  end if;

  if c.uno_por_cliente and p_user_id is not null
     and exists (select 1 from marketplace_ordenes o
                 where o.estado = 'pagado'
                   and o.cupon_codigo = v_codigo
                   and o.user_id = p_user_id) then
    return jsonb_build_object(
      'codigo', v_codigo, 'valido', false, 'aplicado', false,
      'motivo', 'ya_usado',
      'mensaje', 'Ya usaste este cupón en una compra anterior.',
      'tipo', c.tipo, 'valor', c.valor,
      'precio_lista', p_precio_lista, 'precio_promo', v_promo,
      'precio_cupon', null, 'precio_final', v_promo,
      'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
      'requiere_sesion', false);
  end if;

  v_cupon := case c.tipo
               when 'porcentaje'
                 then marketplace_redondeo_promo(p_precio_lista, c.valor::smallint)
               else p_precio_lista - c.valor
             end;
  v_cupon := greatest(v_cupon, least(v_piso, p_precio_lista));

  if v_cupon >= v_promo then
    return jsonb_build_object(
      'codigo', v_codigo, 'valido', true, 'aplicado', false,
      'motivo', 'no_mejora',
      'mensaje', 'Ya tienes el mejor precio. El descuento que ya trae este paquete es mayor que el de tu cupón, así que te dejamos el más barato y tu cupón sigue disponible.',
      'tipo', c.tipo, 'valor', c.valor,
      'precio_lista', p_precio_lista, 'precio_promo', v_promo,
      'precio_cupon', v_cupon, 'precio_final', v_promo,
      'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
      'requiere_sesion', false);
  end if;

  return jsonb_build_object(
    'codigo', v_codigo, 'valido', true, 'aplicado', true, 'motivo', null,
    'mensaje', 'Cupón aplicado.',
    'tipo', c.tipo, 'valor', c.valor,
    'precio_lista', p_precio_lista, 'precio_promo', v_promo,
    'precio_cupon', v_cupon, 'precio_final', v_cupon,
    'origen', 'cupon', 'descuento', p_precio_lista - v_cupon,
    'requiere_sesion', (c.uno_por_cliente and p_user_id is null));
end;
$$;
revoke all on function marketplace_cupon_evaluar(text, numeric, uuid, text) from public, anon, authenticated;

drop function if exists marketplace_validar_cupon(text, numeric);
create or replace function marketplace_validar_cupon(
  p_codigo text,
  p_precio_lista numeric,
  p_ambito text default 'paquete'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select marketplace_cupon_evaluar(p_codigo, p_precio_lista, auth.uid(), p_ambito);
$$;
grant execute on function marketplace_validar_cupon(text, numeric, text) to anon, authenticated;

drop function if exists marketplace_precio_con_cupon(numeric, text, uuid);
create or replace function marketplace_precio_con_cupon(
  p_precio numeric,
  p_codigo text,
  p_user_id uuid,
  p_ambito text default 'paquete'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select marketplace_cupon_evaluar(p_codigo, p_precio, p_user_id, p_ambito);
$$;
revoke all on function marketplace_precio_con_cupon(numeric, text, uuid, text) from public, anon, authenticated;

-- ── 6. Panel de administracion ──────────────────────────────────────────────
-- La previsualizacion ya respeta el ambito: un renglon excluido muestra el
-- precio de lista en "Se cobra hoy". Tambien se previsualizan los precios
-- de los pedidos a la medida.
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
    'aplica_paquetes', p.aplica_paquetes,
    'aplica_proyectos', p.aplica_proyectos,
    'aplica_personalizados', p.aplica_personalizados,
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
               'aplica', case when t.tipo_paquete = 'proyecto' then p.aplica_proyectos else p.aplica_paquetes end,
               'promo_pdf', case when (case when t.tipo_paquete = 'proyecto' then p.aplica_proyectos else p.aplica_paquetes end)
                              then marketplace_redondeo_promo(t.precio_base, p.porcentaje)
                              else t.precio_base end,
               'promo_editable', case when (case when t.tipo_paquete = 'proyecto' then p.aplica_proyectos else p.aplica_paquetes end)
                              then marketplace_redondeo_promo(t.precio_base + t.precio_addon_editable, p.porcentaje)
                              else t.precio_base + t.precio_addon_editable end)
             order by
               case t.modalidad_precio
                 when 'un_grado' then 1 when 'multigrado' then 2 else 3 end,
               case t.tipo_paquete when 'trimestre' then 1 when 'ciclo' then 2 else 3 end)
      from marketplace_precios t
      where t.nivel = 1
    ),
    'previsualizacion_personalizados', (
      select jsonb_build_object(
               'lista_sin_anexos', c.precio_sin_anexos,
               'lista_con_anexos', c.precio_con_anexos,
               'aplica', p.aplica_personalizados,
               'promo_sin_anexos', case when p.aplica_personalizados then marketplace_redondeo_promo(c.precio_sin_anexos, p.porcentaje) else c.precio_sin_anexos end,
               'promo_con_anexos', case when p.aplica_personalizados then marketplace_redondeo_promo(c.precio_con_anexos, p.porcentaje) else c.precio_con_anexos end)
      from marketplace_personalizados_config c where c.id
    )
  ) into v
  from marketplace_promocion p where p.id;

  return v;
end;
$$;
grant execute on function admin_estado_promocion() to authenticated;

drop function if exists admin_guardar_promocion(boolean, smallint, timestamptz, timestamptz, text);
create or replace function admin_guardar_promocion(
  p_activa boolean,
  p_porcentaje smallint default null,
  p_vigente_hasta timestamptz default null,
  p_vigente_desde timestamptz default null,
  p_etiqueta text default null,
  p_aplica_paquetes boolean default null,
  p_aplica_proyectos boolean default null,
  p_aplica_personalizados boolean default null
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

  update marketplace_promocion
  set activa                = p_activa,
      porcentaje            = coalesce(p_porcentaje, porcentaje),
      vigente_desde         = p_vigente_desde,
      vigente_hasta         = p_vigente_hasta,
      etiqueta              = coalesce(nullif(btrim(p_etiqueta), ''), etiqueta),
      aplica_paquetes       = coalesce(p_aplica_paquetes, aplica_paquetes),
      aplica_proyectos      = coalesce(p_aplica_proyectos, aplica_proyectos),
      aplica_personalizados = coalesce(p_aplica_personalizados, aplica_personalizados),
      actualizado_en        = now()
  where id;

  return admin_estado_promocion();
end;
$$;
grant execute on function admin_guardar_promocion(boolean, smallint, timestamptz, timestamptz, text, boolean, boolean, boolean) to authenticated;

-- ── 7. Comprobacion ─────────────────────────────────────────────────────────
select marketplace_precio_final(100, 'paquete')       as paquete,
       marketplace_precio_final(100, 'proyecto')      as proyecto,
       marketplace_precio_final(100, 'personalizado') as personalizado,
       marketplace_precio_final(100)                  as por_defecto,
       marketplace_promocion_vigente() -> 'ambitos'   as ambitos;
