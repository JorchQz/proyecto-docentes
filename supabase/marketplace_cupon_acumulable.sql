-- =============================================================================
-- El cupon SE SUMA a la oferta general (2026-09-11)
-- =============================================================================
--
-- CAMBIO DE REGLA. Hasta hoy el cupon y la promocion general competian: se
-- cobraba el descuento MAYOR de los dos y, si el cupon no mejoraba, no se
-- aplicaba (motivo 'no_mejora') ni generaba comision para su creador.
--
-- A partir de ahora los dos se encadenan:
--
--      precio de lista
--        -> oferta general del ambito   (marketplace_precio_final)
--        -> cupon sobre ESE precio      (porcentaje o monto fijo)
--
-- Ejemplo con la oferta del 20% y un cupon del 10%:
--      1000  ->  800 (oferta)  ->  720 (cupon)
--
-- Consecuencia buscada: el cupon se aplica SIEMPRE que sea valido, en
-- cualquier producto (paquete, proyecto individual o proyecto personalizado),
-- asi que la orden siempre se sella con `cupon_codigo` y el creador siempre
-- cobra su comision. La categoria "referida" (cupon valido que no daba
-- descuento) deja de producirse; el estado de cuenta la conserva solo para
-- ordenes historicas.
--
-- Lo que NO cambia:
--   - Los ambitos de la oferta general (hoy: paquetes y proyectos si,
--     personalizados no). El cupon si aplica en los tres.
--   - El piso de $10: el precio final nunca baja de ahi.
--   - Los tres limites del cupon: fecha, numero de usos y tope de comision.
--   - "Uno por cliente" y el redondeo hacia abajo a pesos enteros.
--
-- Sustituye a la definicion de marketplace_cupon_evaluar que traen
-- marketplace_cupones.sql, marketplace_promocion_ambitos.sql y
-- marketplace_cupones_tope_comision.sql: si alguno de esos se vuelve a
-- aplicar, hay que reaplicar ESTE despues.
--
-- Idempotente.
-- =============================================================================

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

  -- Punto de partida del cupon: lo que ya se cobraria hoy en este ambito.
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
      'descuento_cupon', 0,
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
      'descuento_cupon', 0,
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
        'descuento_cupon', 0,
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
        'descuento_cupon', 0,
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
      'descuento_cupon', 0,
      'requiere_sesion', false);
  end if;

  -- ── El cupon se encadena: descuenta sobre el precio que ya trae la oferta ──
  v_cupon := case c.tipo
               when 'porcentaje'
                 then marketplace_redondeo_promo(v_promo, c.valor::smallint)
               else v_promo - c.valor
             end;
  v_cupon := greatest(v_cupon, least(v_piso, v_promo));

  -- Salvaguarda: un cupon que no baja nada (valor 0, o el precio ya esta en el
  -- piso) no se gasta. Con el encadenamiento esto ya casi no ocurre.
  if v_cupon >= v_promo then
    return jsonb_build_object(
      'codigo', v_codigo, 'valido', true, 'aplicado', false,
      'motivo', 'no_mejora',
      'mensaje', 'Tu cupón no puede bajar más este precio, así que te lo dejamos intacto para otra compra.',
      'tipo', c.tipo, 'valor', c.valor,
      'precio_lista', p_precio_lista, 'precio_promo', v_promo,
      'precio_cupon', v_cupon, 'precio_final', v_promo,
      'origen', v_origen_base, 'descuento', p_precio_lista - v_promo,
      'descuento_cupon', 0,
      'requiere_sesion', false);
  end if;

  return jsonb_build_object(
    'codigo', v_codigo, 'valido', true, 'aplicado', true, 'motivo', null,
    'mensaje', 'Cupón aplicado.',
    'tipo', c.tipo, 'valor', c.valor,
    'precio_lista', p_precio_lista, 'precio_promo', v_promo,
    'precio_cupon', v_cupon, 'precio_final', v_cupon,
    'origen', 'cupon', 'descuento', p_precio_lista - v_cupon,
    'descuento_cupon', v_promo - v_cupon,
    'requiere_sesion', (c.uno_por_cliente and p_user_id is null));
end;
$$;
revoke all on function marketplace_cupon_evaluar(text, numeric, uuid, text) from public, anon, authenticated;

comment on table marketplace_cupones is
  'Cupones de descuento con codigo. SE SUMAN a la promocion general: el cupon descuenta sobre el precio que ya trae la oferta del ambito. Los usos no se guardan aqui, se cuentan sobre marketplace_ordenes.cupon_codigo.';

-- ── Comprobacion: lista -> oferta -> cupon, en los tres ambitos ─────────────
select 'paquete' as ambito,
       marketplace_cupon_evaluar('ADAMARY10', 1000, null, 'paquete') as r
union all
select 'proyecto',
       marketplace_cupon_evaluar('ADAMARY10', 1000, null, 'proyecto')
union all
select 'personalizado',
       marketplace_cupon_evaluar('ADAMARY10', 160, null, 'personalizado');
