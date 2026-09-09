-- =============================================================================
-- Cupones de creadores de contenido: cuentas claras (2026-09-09)
-- =============================================================================
--
-- Jorge acuerda con un creador un porcentaje sobre cada venta que entre con
-- su cupon. Para pagarle con cuentas claras hacen falta cuatro cosas que no
-- existian:
--
--   1. FECHA DE PAGO en la orden (pagado_en). El contador de usos ya era
--      derivado de marketplace_ordenes.estado = 'pagado', pero la orden solo
--      tenia created_at: una orden creada el 30 y pagada el 2 caia en el mes
--      equivocado. Un trigger la sella en cuanto el estado pasa a 'pagado',
--      venga de donde venga (webhook, confirmar-pago, confirmacion manual).
--   2. REEMBOLSOS distinguibles. Antes una devolucion dejaba la orden en
--      'fallido' (igual que un pago rechazado) y desaparecia del conteo sin
--      rastro. Ahora queda en 'reembolsado' con reembolsado_en, y el estado de
--      cuenta la muestra como movimiento negativo en el mes de la devolucion.
--   3. ATRIBUCION cuando el cupon no gano. Si el comprador escribio un cupon
--      valido pero la promocion general era mejor, el cupon no se aplica (no
--      consume uso) y hasta hoy no quedaba huella. Ahora se guarda en
--      cupon_referido: el creador trajo la venta aunque no diera el descuento.
--      La comision se calcula sobre las ventas con el cupon APLICADO; las
--      referidas se listan aparte para que Jorge decida.
--   4. LIQUIDACIONES: registro de cada pago hecho al creador, para que el
--      saldo pendiente sea comision generada - lo ya pagado.
--
-- Todo el calculo vive en admin_estado_cuenta_cupon(): una sola autoridad
-- que el panel pinta y exporta a CSV sin sumar nada por su cuenta.
--
-- Idempotente.
-- =============================================================================

-- ── 1. Fechas y atribucion en la orden ──────────────────────────────────────
alter table marketplace_ordenes
  add column if not exists pagado_en timestamptz,
  add column if not exists reembolsado_en timestamptz,
  add column if not exists cupon_referido text;

comment on column marketplace_ordenes.pagado_en is
  'Momento en que la orden paso a pagado (lo sella el trigger). Es la fecha que manda en los estados de cuenta.';
comment on column marketplace_ordenes.reembolsado_en is
  'Momento en que la orden paso a reembolsado (lo sella el trigger).';
comment on column marketplace_ordenes.cupon_referido is
  'Cupon VALIDO que el comprador escribio, aunque no ganara el descuento (la promocion general era mejor). Atribucion para el creador; no cuenta como uso.';

create index if not exists idx_mkt_ordenes_cupon_referido
  on marketplace_ordenes (cupon_referido) where cupon_referido is not null;
create index if not exists idx_mkt_ordenes_pagado_en
  on marketplace_ordenes (pagado_en) where pagado_en is not null;

-- Las ordenes ya pagadas no tienen fecha de pago: la mejor aproximacion es
-- su creacion (tarjeta se acredita al instante; OXXO/SPEI, en dias).
update marketplace_ordenes set pagado_en = created_at
where estado = 'pagado' and pagado_en is null;

create or replace function marketplace_ordenes_sellar_fechas()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'pagado' and (old.estado is distinct from 'pagado') and new.pagado_en is null then
    new.pagado_en := now();
  end if;
  if new.estado = 'reembolsado' and (old.estado is distinct from 'reembolsado') and new.reembolsado_en is null then
    new.reembolsado_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mkt_ordenes_fechas on marketplace_ordenes;
create trigger trg_mkt_ordenes_fechas
  before update of estado on marketplace_ordenes
  for each row execute function marketplace_ordenes_sellar_fechas();

-- ── 2. El creador detras del cupon ──────────────────────────────────────────
alter table marketplace_cupones
  add column if not exists creador_nombre text,
  add column if not exists creador_contacto text,
  add column if not exists comision_porcentaje numeric(5, 2)
    check (comision_porcentaje is null or (comision_porcentaje >= 0 and comision_porcentaje <= 100));

comment on column marketplace_cupones.creador_nombre is 'Creador de contenido al que pertenece el cupon (null = cupon propio).';
comment on column marketplace_cupones.creador_contacto is 'Como pagarle o contactarlo: correo, WhatsApp, CLABE... Solo lo ve el admin.';
comment on column marketplace_cupones.comision_porcentaje is 'Porcentaje sobre lo COBRADO (monto_total) de cada venta pagada con el cupon aplicado.';

-- ── 3. Liquidaciones: lo que ya se le pago al creador ───────────────────────
create table if not exists marketplace_cupon_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  cupon_codigo text not null references marketplace_cupones (codigo) on delete restrict,
  monto numeric(10, 2) not null check (monto > 0),
  fecha_pago date not null default current_date,
  periodo_desde date,
  periodo_hasta date,
  notas text,
  creado_en timestamptz not null default now()
);
comment on table marketplace_cupon_liquidaciones is
  'Pagos hechos a un creador por las ventas de su cupon. Saldo pendiente = comision generada - suma de estas filas.';
create index if not exists idx_mkt_cupon_liq_cupon on marketplace_cupon_liquidaciones (cupon_codigo);

alter table marketplace_cupon_liquidaciones enable row level security;
drop policy if exists "liquidaciones: solo admin" on marketplace_cupon_liquidaciones;
create policy "liquidaciones: solo admin" on marketplace_cupon_liquidaciones
  for all using (es_admin()) with check (es_admin());

-- ── 4. Correo enmascarado (el creador no debe ver a los compradores) ────────
create or replace function marketplace_correo_enmascarado(p_email text)
returns text
language sql
immutable
as $$
  select case
           when p_email is null or position('@' in p_email) = 0 then null
           else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
         end;
$$;

-- ── 5. Estado de cuenta de un cupon ─────────────────────────────────────────
-- Movimientos del periodo (ventas pagadas, reembolsos y ventas referidas sin
-- descuento del cupon), totales del periodo y saldo historico.
create or replace function admin_estado_cuenta_cupon(
  p_codigo text,
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_codigo text;
  c record;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_movs jsonb;
  v_tot jsonb;
  v_generada numeric;
  v_liquidado numeric;
  v_liqs jsonb;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  v_codigo := upper(btrim(coalesce(p_codigo, '')));
  select * into c from marketplace_cupones where codigo = v_codigo;
  if not found then
    raise exception 'Cupón no encontrado';
  end if;

  v_desde := coalesce(p_desde, '-infinity'::timestamptz);
  v_hasta := coalesce(p_hasta, 'infinity'::timestamptz);

  -- Movimientos del periodo.
  with detalle as (
    select o.id as orden_id,
           (select string_agg(
                     case
                       when it.pedido_id is not null then
                         'Proyecto a la medida ' || coalesce(pe.numero_pedido, '') || ' — ' ||
                         (case when pe.nivel = 'con_anexos' then 'con anexos' else 'sin anexos' end)
                       else
                         pr.titulo || ' — ' ||
                         (case
                            when pr.tipo_paquete = 'proyecto' and it.tipo = 'anexos' then 'PDF + Word + anexos'
                            when pr.tipo_paquete = 'proyecto' then 'PDF + Word'
                            when it.tipo = 'editable' then 'Editable (Word)'
                            else 'PDF' end)
                     end, ' · ')
            from marketplace_orden_items it
            left join marketplace_productos pr on pr.id = it.producto_id
            left join marketplace_pedidos pe on pe.id = it.pedido_id
            where it.orden_id = o.id) as detalle,
           marketplace_correo_enmascarado(u.email::text) as comprador
    from marketplace_ordenes o
    left join auth.users u on u.id = o.user_id
    where o.cupon_codigo = v_codigo or o.cupon_referido = v_codigo
  ),
  movs as (
    -- Ventas pagadas con el cupon aplicado (cuentan para la comision).
    select 'venta'::text as tipo, o.pagado_en as fecha, o.id, d.comprador, d.detalle,
           o.monto_total + coalesce(o.descuento_aplicado, 0) as precio_lista,
           coalesce(o.descuento_aplicado, 0) as descuento,
           o.monto_total as monto,
           round(o.monto_total * coalesce(c.comision_porcentaje, 0) / 100, 2) as comision,
           o.estado
    from marketplace_ordenes o join detalle d on d.orden_id = o.id
    where o.cupon_codigo = v_codigo and o.pagado_en is not null
      and o.estado in ('pagado', 'reembolsado')
      and o.pagado_en >= v_desde and o.pagado_en < v_hasta
    union all
    -- Reembolsos: restan en el mes en que se devolvio el dinero.
    select 'reembolso', o.reembolsado_en, o.id, d.comprador, d.detalle,
           o.monto_total + coalesce(o.descuento_aplicado, 0),
           coalesce(o.descuento_aplicado, 0),
           -o.monto_total,
           -round(o.monto_total * coalesce(c.comision_porcentaje, 0) / 100, 2),
           o.estado
    from marketplace_ordenes o join detalle d on d.orden_id = o.id
    where o.cupon_codigo = v_codigo and o.estado = 'reembolsado' and o.reembolsado_en is not null
      and o.reembolsado_en >= v_desde and o.reembolsado_en < v_hasta
    union all
    -- Referidas: el cupon era valido pero no dio el descuento (la promocion
    -- general era mejor). Informativas, sin comision automatica.
    select 'referido', o.pagado_en, o.id, d.comprador, d.detalle,
           o.monto_total + coalesce(o.descuento_aplicado, 0),
           coalesce(o.descuento_aplicado, 0),
           o.monto_total,
           0,
           o.estado
    from marketplace_ordenes o join detalle d on d.orden_id = o.id
    where o.cupon_referido = v_codigo and o.cupon_codigo is distinct from v_codigo
      and o.estado = 'pagado' and o.pagado_en is not null
      and o.pagado_en >= v_desde and o.pagado_en < v_hasta
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', m.tipo, 'fecha', m.fecha, 'orden_id', m.id, 'comprador', m.comprador,
           'detalle', m.detalle, 'precio_lista', m.precio_lista, 'descuento', m.descuento,
           'monto', m.monto, 'comision', m.comision, 'estado', m.estado)
           order by m.fecha, m.tipo), '[]'::jsonb),
         jsonb_build_object(
           'ventas', count(*) filter (where m.tipo = 'venta'),
           'monto_vendido', coalesce(sum(m.monto) filter (where m.tipo = 'venta'), 0),
           'descuento_otorgado', coalesce(sum(m.descuento) filter (where m.tipo = 'venta'), 0),
           'comision_ventas', coalesce(sum(m.comision) filter (where m.tipo = 'venta'), 0),
           'reembolsos', count(*) filter (where m.tipo = 'reembolso'),
           'monto_reembolsado', coalesce(-sum(m.monto) filter (where m.tipo = 'reembolso'), 0),
           'comision_reembolsos', coalesce(-sum(m.comision) filter (where m.tipo = 'reembolso'), 0),
           'comision_neta', coalesce(sum(m.comision) filter (where m.tipo in ('venta', 'reembolso')), 0),
           'referidos', count(*) filter (where m.tipo = 'referido'),
           'monto_referidos', coalesce(sum(m.monto) filter (where m.tipo = 'referido'), 0))
  into v_movs, v_tot
  from movs m;

  -- Saldo historico: comision de todo lo que HOY sigue pagado (un reembolso
  -- ya no esta en 'pagado', asi que se descuenta solo) menos lo liquidado.
  select coalesce(sum(round(o.monto_total * coalesce(c.comision_porcentaje, 0) / 100, 2)), 0)
    into v_generada
  from marketplace_ordenes o
  where o.cupon_codigo = v_codigo and o.estado = 'pagado';

  select coalesce(sum(l.monto), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'monto', l.monto, 'fecha_pago', l.fecha_pago,
           'periodo_desde', l.periodo_desde, 'periodo_hasta', l.periodo_hasta,
           'notas', l.notas, 'creado_en', l.creado_en)
           order by l.fecha_pago desc, l.creado_en desc), '[]'::jsonb)
    into v_liquidado, v_liqs
  from marketplace_cupon_liquidaciones l
  where l.cupon_codigo = v_codigo;

  return jsonb_build_object(
    'cupon', jsonb_build_object(
      'codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'activo', c.activo,
      'descripcion', c.descripcion,
      'creador_nombre', c.creador_nombre, 'creador_contacto', c.creador_contacto,
      'comision_porcentaje', c.comision_porcentaje),
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
    'movimientos', v_movs,
    'totales_periodo', v_tot,
    'historico', jsonb_build_object(
      'ventas_pagadas', (select count(*) from marketplace_ordenes o where o.cupon_codigo = v_codigo and o.estado = 'pagado'),
      'monto_vendido', (select coalesce(sum(o.monto_total), 0) from marketplace_ordenes o where o.cupon_codigo = v_codigo and o.estado = 'pagado'),
      'comision_generada', v_generada,
      'liquidado', v_liquidado,
      'pendiente', v_generada - v_liquidado),
    'liquidaciones', v_liqs
  );
end;
$$;
revoke all on function admin_estado_cuenta_cupon(text, timestamptz, timestamptz) from public, anon;
grant execute on function admin_estado_cuenta_cupon(text, timestamptz, timestamptz) to authenticated;

-- ── 6. Registrar / borrar un pago al creador ────────────────────────────────
create or replace function admin_registrar_liquidacion(
  p_codigo text,
  p_monto numeric,
  p_fecha_pago date default current_date,
  p_periodo_desde date default null,
  p_periodo_hasta date default null,
  p_notas text default null
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
  if not exists (select 1 from marketplace_cupones where codigo = v_codigo) then
    raise exception 'Cupón no encontrado';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;
  insert into marketplace_cupon_liquidaciones (cupon_codigo, monto, fecha_pago, periodo_desde, periodo_hasta, notas)
  values (v_codigo, round(p_monto, 2), coalesce(p_fecha_pago, current_date), p_periodo_desde, p_periodo_hasta,
          nullif(btrim(coalesce(p_notas, '')), ''));
  return admin_estado_cuenta_cupon(v_codigo);
end;
$$;

create or replace function admin_borrar_liquidacion(p_id uuid)
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
  delete from marketplace_cupon_liquidaciones where id = p_id returning cupon_codigo into v_codigo;
  if v_codigo is null then
    raise exception 'Pago no encontrado';
  end if;
  return admin_estado_cuenta_cupon(v_codigo);
end;
$$;

revoke all on function admin_registrar_liquidacion(text, numeric, date, date, date, text) from public, anon;
revoke all on function admin_borrar_liquidacion(uuid) from public, anon;
grant execute on function admin_registrar_liquidacion(text, numeric, date, date, date, text) to authenticated;
grant execute on function admin_borrar_liquidacion(uuid) to authenticated;

-- ── 7. La lista de cupones ya trae al creador y el saldo ────────────────────
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
             'agotado', (c.max_usos is not null and u.usos >= c.max_usos),
             'vigente_ahora', (c.activo
               and (c.vigente_hasta is null or now() < c.vigente_hasta)
               and (c.max_usos is null or u.usos < c.max_usos)))
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

drop function if exists admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text);
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
  p_comision_porcentaje numeric default null
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

  insert into marketplace_cupones as c
    (codigo, tipo, valor, activo, vigente_hasta, max_usos, uno_por_cliente, descripcion,
     creador_nombre, creador_contacto, comision_porcentaje)
  values
    (v_codigo, p_tipo, p_valor, coalesce(p_activo, true), p_vigente_hasta,
     p_max_usos, coalesce(p_uno_por_cliente, true),
     nullif(btrim(coalesce(p_descripcion, '')), ''),
     nullif(btrim(coalesce(p_creador_nombre, '')), ''),
     nullif(btrim(coalesce(p_creador_contacto, '')), ''),
     p_comision_porcentaje)
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
      actualizado_en = now();

  return admin_listar_cupones();
end;
$$;
revoke all on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text, text, text, numeric) from public, anon;
grant execute on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text, text, text, numeric) to authenticated;

-- Un cupon con pagos registrados tampoco se borra (la FK lo impide; el
-- mensaje lo explica).
create or replace function admin_borrar_cupon(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_usos integer;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  v_codigo := upper(btrim(coalesce(p_codigo, '')));
  select count(*)::int into v_usos
  from marketplace_ordenes
  where estado in ('pagado', 'reembolsado') and (cupon_codigo = v_codigo or cupon_referido = v_codigo);
  if v_usos > 0 then
    raise exception 'Este cupón ya aparece en % compra(s): desactívalo en vez de borrarlo, para no perder el historial.', v_usos;
  end if;
  if exists (select 1 from marketplace_cupon_liquidaciones where cupon_codigo = v_codigo) then
    raise exception 'Este cupón tiene pagos registrados al creador: desactívalo en vez de borrarlo.';
  end if;
  delete from marketplace_cupones where codigo = v_codigo;
  return admin_listar_cupones();
end;
$$;
