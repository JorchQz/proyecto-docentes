-- =============================================================================
-- Cupones: tope por monto de comision (2026-09-10)
-- =============================================================================
--
-- Tercera forma de limitar un cupon de creador, junto a la fecha y al numero
-- de usos: un MONTO maximo de comision. En cuanto la comision acumulada (sobre
-- las ventas pagadas con el cupon aplicado) llega o rebasa ese monto, el cupon
-- deja de aceptarse. Como cada comision depende de lo cobrado, la ultima venta
-- puede pasarse un poco del tope: es lo esperado y lo que Jorge pidio ("se
-- desactiva en cuanto se pase la cantidad").
--
-- La comprobacion vive en marketplace_cupon_evaluar(), la unica autoridad
-- que usan el checkout (validar) y el cobro (precio_con_cupon), asi que no
-- puede haber una venta cobrada con un cupon ya agotado por monto. Igual que
-- con max_usos, dos compras simultaneas pueden colarse por una: se acepta.
--
-- Idempotente.
-- =============================================================================

alter table marketplace_cupones
  add column if not exists max_comision numeric(10, 2)
    check (max_comision is null or max_comision > 0);
comment on column marketplace_cupones.max_comision is
  'Tope de comision acumulada (MXN) para el creador. Al llegar o rebasarlo el cupon se agota. Requiere comision_porcentaje.';

-- Comision acumulada de un cupon: solo ordenes HOY pagadas (un reembolso deja
-- de contar solo). Misma formula que el estado de cuenta.
create or replace function marketplace_cupon_comision_acumulada(p_codigo text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(round(o.monto_total * coalesce(c.comision_porcentaje, 0) / 100, 2)), 0)
  from marketplace_cupones c
  left join marketplace_ordenes o
    on o.cupon_codigo = c.codigo and o.estado = 'pagado'
  where c.codigo = upper(btrim(coalesce(p_codigo, '')));
$$;
revoke all on function marketplace_cupon_comision_acumulada(text) from public, anon, authenticated;

-- ── El nucleo, con el tope por monto ────────────────────────────────────────
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
  v_comision numeric;
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

  -- Tope por monto de comision: al llegar o rebasarlo, el cupon se agota.
  if c.max_comision is not null and c.comision_porcentaje is not null then
    v_comision := marketplace_cupon_comision_acumulada(v_codigo);
    if v_comision >= c.max_comision then
      return jsonb_build_object(
        'codigo', v_codigo, 'valido', false, 'aplicado', false,
        'motivo', 'agotado',
        'mensaje', 'Este cupón ya llegó a su límite.',
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

-- ── Lista del admin: tope, acumulado y agotado por monto ────────────────────
create or replace function admin_listar_cupones()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'codigo', c.codigo,
             'tipo', c.tipo,
             'valor', c.valor,
             'activo', c.activo,
             'vigente_hasta', c.vigente_hasta,
             'max_usos', c.max_usos,
             'max_comision', c.max_comision,
             'uno_por_cliente', c.uno_por_cliente,
             'descripcion', c.descripcion,
             'creado_en', c.creado_en,
             'creador_nombre', c.creador_nombre,
             'creador_contacto', c.creador_contacto,
             'comision_porcentaje', c.comision_porcentaje,
             'usos', u.usos,
             'ultimo_uso', u.ultimo,
             'descontado', u.descontado,
             'monto_vendido', u.vendido,
             'reembolsos', u.reembolsos,
             'referidos', u.referidos,
             'comision_generada', u.comision,
             'liquidado', l.liquidado,
             'pendiente', u.comision - l.liquidado,
             'vencido', (c.vigente_hasta is not null and now() >= c.vigente_hasta),
             'agotado_usos', (c.max_usos is not null and u.usos >= c.max_usos),
             'agotado_comision', (c.max_comision is not null and c.comision_porcentaje is not null and u.comision >= c.max_comision),
             'agotado', ((c.max_usos is not null and u.usos >= c.max_usos)
                      or (c.max_comision is not null and c.comision_porcentaje is not null and u.comision >= c.max_comision)),
             'vigente_ahora', (c.activo
               and (c.vigente_hasta is null or now() < c.vigente_hasta)
               and (c.max_usos is null or u.usos < c.max_usos)
               and (c.max_comision is null or c.comision_porcentaje is null or u.comision < c.max_comision)))
           order by c.creado_en desc)
    from marketplace_cupones c
    cross join lateral (
      select count(*) filter (where o.estado = 'pagado' and o.cupon_codigo = c.codigo)::int as usos,
             max(o.pagado_en) filter (where o.estado = 'pagado' and o.cupon_codigo = c.codigo) as ultimo,
             coalesce(sum(o.descuento_aplicado) filter (where o.estado = 'pagado' and o.cupon_codigo = c.codigo), 0) as descontado,
             coalesce(sum(o.monto_total) filter (where o.estado = 'pagado' and o.cupon_codigo = c.codigo), 0) as vendido,
             count(*) filter (where o.estado = 'reembolsado' and o.cupon_codigo = c.codigo)::int as reembolsos,
             count(*) filter (where o.estado = 'pagado' and o.cupon_referido = c.codigo and o.cupon_codigo is distinct from c.codigo)::int as referidos,
             coalesce(sum(round(o.monto_total * coalesce(c.comision_porcentaje, 0) / 100, 2))
                      filter (where o.estado = 'pagado' and o.cupon_codigo = c.codigo), 0) as comision
      from marketplace_ordenes o
      where o.cupon_codigo = c.codigo or o.cupon_referido = c.codigo
    ) u
    cross join lateral (
      select coalesce(sum(monto), 0) as liquidado
      from marketplace_cupon_liquidaciones q where q.cupon_codigo = c.codigo
    ) l
  ), '[]'::jsonb);
end;
$$;
grant execute on function admin_listar_cupones() to authenticated;

-- ── Guardar: con tope por monto ─────────────────────────────────────────────
drop function if exists admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text, text, text, numeric);
create or replace function admin_guardar_cupon(
  p_codigo text,
  p_tipo text,
  p_valor numeric,
  p_activo boolean default true,
  p_vigente_hasta timestamptz default null,
  p_max_usos integer default null,
  p_uno_por_cliente boolean default true,
  p_descripcion text default null,
  p_creador_nombre text default null,
  p_creador_contacto text default null,
  p_comision_porcentaje numeric default null,
  p_max_comision numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  v_codigo := upper(btrim(coalesce(p_codigo, '')));
  if v_codigo !~ '^[A-Z0-9][A-Z0-9._-]{2,23}$' then
    raise exception 'El código debe tener de 3 a 24 caracteres: letras, números, punto, guion o guion bajo. Sin espacios ni acentos.';
  end if;
  if p_tipo not in ('porcentaje', 'monto') then
    raise exception 'El tipo debe ser porcentaje o monto';
  end if;
  if p_comision_porcentaje is not null and (p_comision_porcentaje < 0 or p_comision_porcentaje > 100) then
    raise exception 'La comisión debe estar entre 0 y 100';
  end if;
  if p_max_comision is not null and p_max_comision <= 0 then
    raise exception 'El tope de comisión debe ser mayor que cero';
  end if;
  if p_max_comision is not null and (p_comision_porcentaje is null or p_comision_porcentaje = 0) then
    raise exception 'Para poner un tope de comisión primero define el porcentaje de comisión del creador';
  end if;

  insert into marketplace_cupones as c
    (codigo, tipo, valor, activo, vigente_hasta, max_usos, uno_por_cliente, descripcion,
     creador_nombre, creador_contacto, comision_porcentaje, max_comision)
  values
    (v_codigo, p_tipo, p_valor, coalesce(p_activo, true), p_vigente_hasta,
     p_max_usos, coalesce(p_uno_por_cliente, true),
     nullif(btrim(coalesce(p_descripcion, '')), ''),
     nullif(btrim(coalesce(p_creador_nombre, '')), ''),
     nullif(btrim(coalesce(p_creador_contacto, '')), ''),
     p_comision_porcentaje, p_max_comision)
  on conflict (codigo) do update
  set tipo = excluded.tipo,
      valor = excluded.valor,
      activo = excluded.activo,
      vigente_hasta = excluded.vigente_hasta,
      max_usos = excluded.max_usos,
      uno_por_cliente = excluded.uno_por_cliente,
      descripcion = excluded.descripcion,
      creador_nombre = excluded.creador_nombre,
      creador_contacto = excluded.creador_contacto,
      comision_porcentaje = excluded.comision_porcentaje,
      max_comision = excluded.max_comision,
      actualizado_en = now();

  return admin_listar_cupones();
end;
$$;
revoke all on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text, text, text, numeric, numeric) from public, anon;
grant execute on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text, text, text, numeric, numeric) to authenticated;
