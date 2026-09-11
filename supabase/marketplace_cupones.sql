-- =============================================================================
-- Cupones con codigo propio (septiembre 2026)
-- =============================================================================
--
-- Jorge inventa el codigo, el comprador lo escribe en el checkout. Un cupon es
-- de porcentaje O de monto fijo, nunca de los dos.
--
-- OBSOLETO (2026-09-11): la regla central de abajo YA NO RIGE. El cupon ahora
-- SE SUMA a la promocion general; la definicion vigente de
-- marketplace_cupon_evaluar esta en marketplace_cupon_acumulable.sql y hay que
-- reaplicarla si este archivo se vuelve a ejecutar.
--
-- REGLA ORIGINAL (historica): el cupon NO se acumula con la promocion general. Gana el
-- descuento MAYOR. Si el cupon no mejora lo que el comprador ya tiene delante,
-- no es un error: se le dice que ya tiene el mejor precio y no se le quema el
-- cupon (no se estampa en la orden, asi que no consume un uso).
--
-- LIMITES: fecha de caducidad, numero maximo de usos y uno por cliente. No hay
-- compra minima.
--
-- SIN TABLA DE USOS. El contador es DERIVADO de marketplace_ordenes, igual que
-- hacia marketplace_ventas_ciclo():
--     usos            = ordenes con estado='pagado' y ese cupon_codigo
--     uno por cliente = ese user_id no tiene ya una de esas
-- Un reembolso pone la orden en 'fallido' y libera el uso solo, sin
-- mantenimiento y sin filas huerfanas que limpiar.
--
-- UNA SOLA AUTORIDAD: marketplace_cupon_evaluar() es el nucleo. Lo llaman el
-- validador que ve el comprador y la funcion que decide el importe cobrado, asi
-- que no pueden decir cosas distintas. La regla de redondeo sigue estando una
-- sola vez, en marketplace_redondeo_promo().
--
-- Convencion: comentarios sin acentos (como marketplace_promocion.sql); los
-- textos que lee el comprador si llevan acentos.
--
-- Idempotente.
-- =============================================================================

-- ── 1. Los cupones ──────────────────────────────────────────────────────────
create table if not exists marketplace_cupones (
  -- La PK es el codigo YA normalizado: mayusculas, sin espacios. El check impide
  -- que entre de otra forma por cualquier via, y hace imposible el par de filas
  -- "verano" / "VERANO". Sin acentos ni enye: son codigos que se dictan por
  -- WhatsApp y se teclean a mano.
  codigo text primary key
    check (codigo = upper(btrim(codigo))
       and codigo ~ '^[A-Z0-9][A-Z0-9._-]{2,23}$'),
  tipo text not null check (tipo in ('porcentaje', 'monto')),
  valor numeric(10, 2) not null check (valor > 0),
  -- Porcentaje: entero 1-90, igual que la promocion general.
  constraint cupon_porcentaje_valido
    check (tipo <> 'porcentaje' or (valor between 1 and 90 and valor = floor(valor))),
  -- Monto fijo: pesos completos, igual que el tarifario.
  constraint cupon_monto_valido
    check (tipo <> 'monto' or valor = floor(valor)),
  -- Interruptor de mano, como en la promocion: apaga el cupon al instante.
  activo boolean not null default true,
  -- NULL = no caduca. La fecha es lo que lo apaga solo, sin cron.
  vigente_hasta timestamptz,
  -- NULL = usos ilimitados.
  max_usos integer check (max_usos is null or max_usos > 0),
  uno_por_cliente boolean not null default true,
  -- Nota interna para el panel; el comprador no la ve.
  descripcion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table marketplace_cupones is
  'Cupones de descuento con codigo. No se acumulan con la promocion general: gana el mayor. Los usos no se guardan aqui, se cuentan sobre marketplace_ordenes.cupon_codigo.';

-- ── 2. El cupon que gano, estampado en la orden ─────────────────────────────
alter table marketplace_ordenes
  add column if not exists cupon_codigo text,
  add column if not exists descuento_aplicado numeric(10, 2);

comment on column marketplace_ordenes.cupon_codigo is
  'Cupon que GANO el descuento de esta orden, ya normalizado. NULL si mando la promocion general o el precio de lista. Esta columna ES el contador de usos.';
comment on column marketplace_ordenes.descuento_aplicado is
  'Pesos entre el precio de lista y lo cobrado, venga el descuento de donde venga. Informativo: el importe que manda sigue siendo monto_total.';

-- A proposito SIN clave foranea contra marketplace_cupones: esto es un sello
-- historico, no una referencia viva. Con FK, borrar un cupon reescribiria o
-- bloquearia ordenes ya pagadas.
create index if not exists idx_mkt_ordenes_cupon
  on marketplace_ordenes (cupon_codigo) where cupon_codigo is not null;

-- El cliente no debe poder escribir estas dos columnas. OJO (mismo motivo que
-- en rls_hardening_2026-08.sql C2): un revoke por columna NO surte efecto si el
-- rol tiene INSERT a nivel de tabla, asi que hay que revocar la tabla y volver
-- a otorgar columna por columna. Hoy ningun .js inserta ordenes (las crea
-- crear-preferencia-mp con service role); esto cierra la puerta por si acaso.
revoke insert on marketplace_ordenes from authenticated, anon;
grant insert (user_id, monto_total, estado, metodo_pago, referencia_pago, comprobante_url)
  on marketplace_ordenes to authenticated;

-- ── 3. El nucleo: una sola respuesta para pintar y para cobrar ──────────────
-- Devuelve SIEMPRE las mismas claves, valga o no el cupon:
--   valido    : el codigo existe y esta utilizable por este comprador
--   aplicado  : ademas GANA (mejora el precio que ya tenia delante)
--   motivo    : null | inexistente | agotado | ya_usado | no_mejora
--   origen    : lista | promo | cupon   (de donde sale precio_final)
--
-- Sobre la enumeracion de codigos: se responde lo mismo para "no existe",
-- "apagado" y "vencido", asi que un scraper no aprende cuales existen. Adivinar
-- un codigo activo solo da un descuento que Jorge decidio regalar, y max_usos
-- acota el dano.
create or replace function marketplace_cupon_evaluar(
  p_codigo text,
  p_precio_lista numeric,
  p_user_id uuid
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
  -- Importe minimo cobrable: por debajo de esto Mercado Pago rechaza la
  -- preferencia. Un cupon de monto fijo mas grande que el paquete deja el
  -- precio aqui, no en cero. Los regalos completos van por "Acceso manual".
  v_piso constant numeric := 10;
begin
  if p_precio_lista is null then
    raise exception 'Falta el precio de lista';
  end if;

  -- La promocion general se resuelve con la autoridad que ya existe: misma
  -- vigencia contra now(), mismo redondeo.
  v_promo := marketplace_precio_final(p_precio_lista);
  v_origen_base := case when v_promo < p_precio_lista then 'promo' else 'lista' end;

  v_codigo := nullif(upper(btrim(coalesce(p_codigo, ''))), '');

  -- Sin cupon: la respuesta es la de siempre.
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

  -- Usos: derivados. Solo cuentan las ordenes PAGADAS, asi que un reembolso
  -- libera el uso solo. Dos compradores simultaneos pueden pasarse por uno del
  -- maximo, y esta bien: rechazar el segundo pago seria cobrar sin entregar.
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

  -- Uno por cliente. Sin sesion no se puede comprobar: se deja pasar y se avisa
  -- con requiere_sesion. El checkout crea la cuenta en la misma pantalla, y al
  -- cobrar se vuelve a evaluar con el user_id de verdad.
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

  -- El precio con el cupon. El porcentaje pasa por marketplace_redondeo_promo:
  -- la regla de redondeo existe UNA vez en todo el sistema.
  v_cupon := case c.tipo
               when 'porcentaje'
                 then marketplace_redondeo_promo(p_precio_lista, c.valor::smallint)
               else p_precio_lista - c.valor
             end;
  -- least(piso, lista): si el paquete costara menos que el piso, el cupon no
  -- puede SUBIR el precio.
  v_cupon := greatest(v_cupon, least(v_piso, p_precio_lista));

  -- No se acumula: gana el mayor descuento. Empate incluido: si el cupon no
  -- mejora, no se estampa en la orden y no consume uso.
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

-- El nucleo no lo llama nadie de fuera: las dos envolturas son security definer
-- y lo alcanzan por ser del mismo dueno.
revoke all on function marketplace_cupon_evaluar(text, numeric, uuid)
  from public, anon, authenticated;

-- ── 4. Lo que consulta el navegador al pulsar "Aplicar" ─────────────────────
-- El user_id NO es parametro a proposito: sale de auth.uid(). Si se pudiera
-- pasar, cualquiera podria sondear si otra persona ya uso un cupon.
-- El precio de lista si llega del cliente, y da igual: esto solo pinta. Lo que
-- se cobra lo recalcula crear-preferencia-mp contra la base.
create or replace function marketplace_validar_cupon(
  p_codigo text,
  p_precio_lista numeric
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select marketplace_cupon_evaluar(p_codigo, p_precio_lista, auth.uid());
$$;

-- anon incluido: el checkout deja pagar creando la cuenta en la misma pantalla,
-- y mandar a iniciar sesion para escribir un cupon es donde se pierde la venta.
grant execute on function marketplace_validar_cupon(text, numeric) to anon, authenticated;

-- ── 5. El importe que se cobra ──────────────────────────────────────────────
-- Hermana de marketplace_precio_final(): misma politica de permisos (solo
-- service role) y misma promesa (unica autoridad del importe).
create or replace function marketplace_precio_con_cupon(
  p_precio numeric,
  p_codigo text,
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select marketplace_cupon_evaluar(p_codigo, p_precio, p_user_id);
$$;

revoke all on function marketplace_precio_con_cupon(numeric, text, uuid)
  from public, anon, authenticated;

-- ── 6. Panel de administracion ──────────────────────────────────────────────
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
             'usos', u.usos,
             'ultimo_uso', u.ultimo,
             'descontado', u.descontado,
             'vencido', (c.vigente_hasta is not null and now() >= c.vigente_hasta),
             'agotado', (c.max_usos is not null and u.usos >= c.max_usos),
             'vigente_ahora', (c.activo
               and (c.vigente_hasta is null or now() < c.vigente_hasta)
               and (c.max_usos is null or u.usos < c.max_usos)))
           order by c.creado_en desc)
    from marketplace_cupones c
    cross join lateral (
      select count(*)::int                          as usos,
             max(o.created_at)                      as ultimo,
             coalesce(sum(o.descuento_aplicado), 0) as descontado
      from marketplace_ordenes o
      where o.estado = 'pagado' and o.cupon_codigo = c.codigo
    ) u
  ), '[]'::jsonb);
end;
$$;

create or replace function admin_guardar_cupon(
  p_codigo text,
  p_tipo text,
  p_valor numeric,
  p_activo boolean default true,
  p_vigente_hasta timestamptz default null,
  p_max_usos integer default null,
  p_uno_por_cliente boolean default true,
  p_descripcion text default null
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

  -- Se normaliza aqui, no en el navegador: el navegador es una comodidad, esto
  -- es la garantia. El check de la tabla lo confirma.
  v_codigo := upper(btrim(coalesce(p_codigo, '')));
  if v_codigo !~ '^[A-Z0-9][A-Z0-9._-]{2,23}$' then
    raise exception 'El código debe tener de 3 a 24 caracteres: letras, números, punto, guion o guion bajo. Sin espacios ni acentos.';
  end if;
  if p_tipo not in ('porcentaje', 'monto') then
    raise exception 'El tipo debe ser porcentaje o monto';
  end if;

  insert into marketplace_cupones as c
    (codigo, tipo, valor, activo, vigente_hasta, max_usos, uno_por_cliente, descripcion)
  values
    (v_codigo, p_tipo, p_valor, coalesce(p_activo, true), p_vigente_hasta,
     p_max_usos, coalesce(p_uno_por_cliente, true),
     nullif(btrim(coalesce(p_descripcion, '')), ''))
  on conflict (codigo) do update
  set tipo = excluded.tipo,
      valor = excluded.valor,
      activo = excluded.activo,
      -- Las fechas y el maximo se escriben tal cual llegan, NULL incluido: asi
      -- se puede quitar la caducidad o el limite, no solo cambiarlos.
      vigente_hasta = excluded.vigente_hasta,
      max_usos = excluded.max_usos,
      uno_por_cliente = excluded.uno_por_cliente,
      descripcion = excluded.descripcion,
      actualizado_en = now();

  return admin_listar_cupones();
end;
$$;

-- Borrar solo lo que nunca se uso. Un cupon con ventas es el respaldo de esas
-- ordenes: si desaparece, cupon_codigo apunta a nada y el historial deja de
-- explicarse. Para retirarlo, se desactiva.
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
  where estado = 'pagado' and cupon_codigo = v_codigo;

  if v_usos > 0 then
    raise exception 'Este cupón ya se usó en % compra(s): desactívalo en vez de borrarlo, para no perder el historial.', v_usos;
  end if;

  delete from marketplace_cupones where codigo = v_codigo;
  return admin_listar_cupones();
end;
$$;

revoke all on function admin_listar_cupones() from public, anon;
revoke all on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text) from public, anon;
revoke all on function admin_borrar_cupon(text) from public, anon;
grant execute on function admin_listar_cupones() to authenticated;
grant execute on function admin_guardar_cupon(text, text, numeric, boolean, timestamptz, integer, boolean, text) to authenticated;
grant execute on function admin_borrar_cupon(text) to authenticated;

-- ── 7. Que el cupon se vea en la pestana Ordenes ────────────────────────────
-- Cambia la firma de salida, asi que no vale create or replace: hay que dropear.
drop function if exists admin_listar_ordenes();
create or replace function admin_listar_ordenes()
returns table (
  id uuid, estado text, monto_total numeric, metodo_pago text,
  referencia_pago text, created_at timestamptz, user_id uuid,
  comprador_email text, detalle text,
  cupon_codigo text, descuento_aplicado numeric
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  return query
    select o.id, o.estado, o.monto_total, o.metodo_pago, o.referencia_pago,
           o.created_at, o.user_id, u.email::text as comprador_email,
           (select string_agg(
                     pr.titulo || ' — ' ||
                     (case when it.tipo = 'editable' then 'Editable (Word)' else 'PDF' end),
                     ' · ')
            from marketplace_orden_items it
            join marketplace_productos pr on pr.id = it.producto_id
            where it.orden_id = o.id) as detalle,
           o.cupon_codigo, o.descuento_aplicado
    from marketplace_ordenes o
    left join auth.users u on u.id = o.user_id
    order by o.created_at desc;
end;
$$;

revoke all on function admin_listar_ordenes() from public, anon;
grant execute on function admin_listar_ordenes() to authenticated;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
-- Sin lectura publica de la tabla: el comprador solo ve la evaluacion puntual
-- que devuelve la RPC. Mismo patron que marketplace_precios y marketplace_promocion.
alter table marketplace_cupones enable row level security;

drop policy if exists "cupones: solo admin" on marketplace_cupones;
create policy "cupones: solo admin" on marketplace_cupones
  for select using (es_admin());

-- ── 9. Comprobacion ─────────────────────────────────────────────────────────
-- Sin cupon devuelve exactamente lo de siempre:
select marketplace_cupon_evaluar(null, 249, null);
-- Codigo inventado: falla limpio, sin excepcion.
select marketplace_cupon_evaluar('NOEXISTE', 249, null);
