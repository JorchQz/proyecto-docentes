-- =============================================================================
-- Pruebas SQL de los cobros de Mi Salón (b22): cobertura de cada compra con fechas simuladas,
-- precio fundador (cupo, comprador de la tienda, previo), cupón contra fundador, registro de la
-- orden, pago (OXXO pendiente que se aprueba después, webhook repetido, importe que no cuadra,
-- reembolso), compra que se suma, cuenta vencida que escribe directo contra la base, compra
-- tardía del T3 con el ciclo siguiente sin cargar, avisos del calendario, correos pendientes
-- (idempotentes), estado para la app y panel.
--
-- SOLO en el proyecto de PRUEBAS. Todo corre dentro de UNA transacción que se deshace al final
-- (ejecutor: node .qa-am/sql-prueba.js pruebas/sql/mi-salon-cobros.sql). No deja nada escrito.
-- Resultado: la última consulta devuelve una fila por caso (ok = true/false); todas en true.
--
-- Cuentas: de mentira (zz.b22.*@jissez.test), creadas y deshechas aquí. Se usan fechas de
-- aprobación simuladas (date_approved) y la fecha de cotización (p_fecha).
-- =============================================================================

create table public.zz_b22_resultados (n serial primary key, grupo text, caso text, ok boolean, detalle text);

create function public.zz_b22_anotar(p_grupo text, p_caso text, p_ok boolean, p_detalle text default null)
returns void language sql as $$
  insert into public.zz_b22_resultados (grupo, caso, ok, detalle) values (p_grupo, p_caso, coalesce(p_ok, false), p_detalle);
$$;

-- Corre una sentencia y la deshace siempre. → 'ok' o 'SQLSTATE|pista|mensaje'
create function public.zz_b22_intentar(p_sql text)
returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'zz_b22_deshacer';
  exception when others then
    if sqlerrm = 'zz_b22_deshacer' then return 'ok'; end if;
    declare h text; begin
      get stacked diagnostics h = pg_exception_hint;
      return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
    end;
  end;
end $$;

grant insert, select on public.zz_b22_resultados to authenticated;
grant usage on sequence public.zz_b22_resultados_n_seq to authenticated;
grant execute on function public.zz_b22_anotar(text, text, boolean, text) to authenticated;
grant execute on function public.zz_b22_intentar(text) to authenticated;

-- Cuenta de mentira (el trigger de b21 le da el gratis si se creó hasta el 18-dic)
create function public.zz_b22_cuenta(p_email text, p_creada timestamptz default '2026-09-20 10:00-06')
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(), p_creada, now());
  insert into public.perfiles (id, nombre_completo) values (u, 'ZZ ' || p_email) on conflict (id) do nothing;
  return u;
end $$;

-- Sesión simulada (como PostgREST) y vuelta a la conexión directa
create function public.zz_b22_como(p_uid uuid, p_email text, p_rol text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol, 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;
create function public.zz_b22_sin_sesion() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Pago simulado de Mercado Pago
create function public.zz_b22_pago(p_id text, p_status text, p_monto numeric, p_aprobado text default null,
  p_metodo text default 'visa', p_tipo text default 'credit_card', p_ref text default null, p_ticket text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'status', p_status, 'status_detail', p_status, 'transaction_amount', p_monto,
    'currency_id', 'MXN', 'date_approved', p_aprobado, 'payment_method_id', p_metodo, 'payment_type_id', p_tipo,
    'referencia', p_ref, 'ticket_url', p_ticket);
$$;

-- Quita los accesos de una cuenta y le deja los que se pidan
create function public.zz_b22_limpiar(p_uid uuid) returns void language sql as $$
  delete from public.mi_salon_accesos where docente_id = p_uid;
$$;

-- Estado de partida: Mi Salón apagado, cupo 100, sin corte de tienda, precios de la spec
update public.jissez_config set mi_salon_abierto = false, mi_salon_cupo_fundador = 100, mi_salon_fundador_tienda_hasta = null where id;
update public.mi_salon_precios set precio_lista = 299, precio_fundador = 199, activo = true, vende_hasta_periodo = null where ciclo = '2026-2027' and producto = 'trimestre';
update public.mi_salon_precios set precio_lista = 549, precio_fundador = 399, activo = true, vende_hasta_periodo = 'T2' where ciclo = '2026-2027' and producto = 'resto_ciclo';
update public.mi_salon_precios set precio_lista = 749, precio_fundador = 549, activo = false, vende_hasta_periodo = 'T1' where ciclo = '2026-2027' and producto = 'ciclo';
delete from public.mi_salon_periodos where ciclo <> '2026-2027';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Cobertura con fechas simuladas (spec 5.2)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  c jsonb;
  function_cob text;
begin
  c := public.mi_salon_cobertura('trimestre', '2026-10-22');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 22-oct: solo T1, vence 18-dic',
    c -> 'cobertura' = '[{"ciclo":"2026-2027","periodos":["T1"]}]' and c ->> 'vence' = '2026-12-18' and not (c ->> 'compra_tardia')::boolean, c::text);
  c := public.mi_salon_cobertura('trimestre', '2026-10-23');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 23-oct (compra tardía): T1 y T2, vence 9-abr',
    c -> 'cobertura' = '[{"ciclo":"2026-2027","periodos":["T1","T2"]}]' and c ->> 'vence' = '2027-04-09' and (c ->> 'compra_tardia')::boolean
    and c -> 'siguiente' ->> 'periodo' = 'T2', c::text);
  c := public.mi_salon_cobertura('trimestre', '2026-11-13');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 13-nov (aún ventana del T1, tardía): T1 y T2', c -> 'cobertura' -> 0 -> 'periodos' = '["T1","T2"]', c::text);
  c := public.mi_salon_cobertura('trimestre', '2026-11-14');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 14-nov (ventana del T2, no tardía): solo T2, vence 9-abr',
    c ->> 'periodo' = 'T2' and c -> 'cobertura' -> 0 -> 'periodos' = '["T2"]' and c ->> 'vence' = '2027-04-09', c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-02-11');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 11-feb: solo T2', c -> 'cobertura' -> 0 -> 'periodos' = '["T2"]', c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-02-12');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 12-feb (tardía del T2): T2 y T3, vence 30-jul',
    c -> 'cobertura' -> 0 -> 'periodos' = '["T2","T3"]' and c ->> 'vence' = '2027-07-30', c::text);
  c := public.mi_salon_cobertura('resto_ciclo', '2026-10-01');
  perform public.zz_b22_anotar('cobertura', 'Resto del ciclo en el T1: T1, T2 y T3', c -> 'cobertura' -> 0 -> 'periodos' = '["T1","T2","T3"]' and c ->> 'vence' = '2027-07-30', c::text);
  c := public.mi_salon_cobertura('resto_ciclo', '2027-03-05');
  perform public.zz_b22_anotar('cobertura', 'Resto del ciclo el 5-mar (registro del T2): se vende, T2 y T3',
    (c ->> 'disponible')::boolean and c -> 'cobertura' -> 0 -> 'periodos' = '["T2","T3"]', c::text);
  c := public.mi_salon_cobertura('resto_ciclo', '2027-03-06');
  perform public.zz_b22_anotar('cobertura', 'Resto del ciclo el 6-mar: ya no se vende (solo Trimestre)',
    not (c ->> 'disponible')::boolean and c ->> 'motivo' = 'fuera_de_venta', c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-03-06');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 6-mar: T3', c ->> 'periodo' = 'T3' and c -> 'cobertura' -> 0 -> 'periodos' = '["T3"]', c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-06-10');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 10-jun: solo T3', c -> 'cobertura' = '[{"ciclo":"2026-2027","periodos":["T3"]}]', c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-06-11');
  perform public.zz_b22_anotar('cobertura', 'Trimestre el 11-jun (tardía del T3, 2027-2028 sin cargar): T3 + T1 del ciclo siguiente, vence provisional 30-jul',
    c -> 'cobertura' = '[{"ciclo":"2026-2027","periodos":["T3"]},{"ciclo":"2027-2028","periodos":["T1"]}]'
    and c ->> 'vence' = '2027-07-30' and (c ->> 'provisional')::boolean and not (c -> 'siguiente' ->> 'cargado')::boolean, c::text);
  c := public.mi_salon_cobertura('trimestre', '2027-08-02');
  perform public.zz_b22_anotar('cobertura', 'Después del 30-jul sin calendario nuevo: no hay qué vender', c ->> 'motivo' = 'sin_calendario', c::text);
  c := public.mi_salon_cobertura('trimestre', '2026-08-30');
  perform public.zz_b22_anotar('cobertura', 'Antes del 31-ago (sin periodo de venta): no disponible', c ->> 'motivo' = 'sin_periodo', c::text);
  c := public.mi_salon_cobertura('ciclo', '2026-10-01');
  perform public.zz_b22_anotar('cobertura', 'Ciclo completo inactivo en 2026-2027', c ->> 'motivo' = 'no_se_vende', c::text);
  update public.mi_salon_precios set activo = true where ciclo = '2026-2027' and producto = 'ciclo';
  c := public.mi_salon_cobertura('ciclo', '2026-11-13');
  perform public.zz_b22_anotar('cobertura', 'Ciclo completo activado: se vende hasta el registro del T1 (13-nov) y cubre T1-T3',
    (c ->> 'disponible')::boolean and c -> 'cobertura' -> 0 -> 'periodos' = '["T1","T2","T3"]', c::text);
  c := public.mi_salon_cobertura('ciclo', '2026-11-14');
  perform public.zz_b22_anotar('cobertura', 'Ciclo completo el 14-nov: fuera de venta', c ->> 'motivo' = 'fuera_de_venta', c::text);
  update public.mi_salon_precios set activo = false where ciclo = '2026-2027' and producto = 'ciclo';
  c := public.mi_salon_cobertura('paquete_tienda', '2026-10-01');
  perform public.zz_b22_anotar('cobertura', 'Paquete tienda + Mi Salón: el modelo lo acepta, no se vende', c ->> 'motivo' = 'no_se_vende', c::text);
  -- Una fecha del calendario corregida mueve la cobertura sola
  update public.mi_salon_periodos set compra_tardia_desde = '2026-10-26' where ciclo = '2026-2027' and periodo = 'T1';
  c := public.mi_salon_cobertura('trimestre', '2026-10-23');
  perform public.zz_b22_anotar('cobertura', 'Si la compra tardía del T1 se mueve al 26-oct, el 23-oct ya no es tardía', c -> 'cobertura' -> 0 -> 'periodos' = '["T1"]', c::text);
  update public.mi_salon_periodos set compra_tardia_desde = '2026-10-23' where ciclo = '2026-2027' and periodo = 'T1';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Precio: fundador por cupo, cupo lleno, comprador de la tienda, cupón contra fundador
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  nueva uuid := public.zz_b22_cuenta('zz.b22.nueva@jissez.test', '2026-12-20 10:00-06');  -- sin gratis
  tienda uuid := public.zz_b22_cuenta('zz.b22.tienda@jissez.test');
  tardia uuid := public.zz_b22_cuenta('zz.b22.tiendatarde@jissez.test');
  prod uuid;
  o uuid;
  q jsonb;
  v_cupon50 numeric;
begin
  perform public.zz_b22_anotar('precio', 'cuenta creada el 20-dic no tiene ningún acceso (sin prueba de 14 días)',
    not exists (select 1 from public.mi_salon_accesos where docente_id = nueva), null);
  q := public.mi_salon_cotizar_de(nueva, 'trimestre', null, '2026-12-21');
  perform public.zz_b22_anotar('precio', 'con lugares: precio fundador $199 (motivo cupo)',
    (q ->> 'precio_final')::numeric = 199 and q ->> 'tipo_precio' = 'fundador' and q ->> 'motivo_fundador' = 'cupo' and (q ->> 'disponible')::boolean, q::text);
  perform public.zz_b22_anotar('precio', 'quedan 100 lugares', (q ->> 'lugares_fundador')::int = 100, q ->> 'lugares_fundador');

  update public.jissez_config set mi_salon_cupo_fundador = 0 where id;
  q := public.mi_salon_cotizar_de(nueva, 'trimestre', null, '2026-12-21');
  perform public.zz_b22_anotar('precio', 'cupo lleno: precio de lista $299', (q ->> 'precio_final')::numeric = 299 and q ->> 'tipo_precio' = 'lista' and (q ->> 'lugares_fundador')::int = 0, q::text);
  q := public.mi_salon_cotizar_de(nueva, 'resto_ciclo', null, '2026-12-21');
  perform public.zz_b22_anotar('precio', 'cupo lleno: resto del ciclo a $549', (q ->> 'precio_final')::numeric = 549, q::text);

  -- Comprador de la tienda (orden pagada de planeaciones antes del lanzamiento)
  insert into public.marketplace_productos (titulo, grado, fase, precio_pdf, activo, es_prueba)
  values ('ZZ b22 paquete', 1, 3, 100, false, false) returning id into prod;
  insert into public.marketplace_ordenes (user_id, monto_total, estado, metodo_pago) values (tienda, 100, 'pendiente', 'mercadopago') returning id into o;
  insert into public.marketplace_orden_items (orden_id, producto_id, tipo, precio_unitario) values (o, prod, 'pdf', 100);
  update public.marketplace_ordenes set estado = 'pagado' where id = o;
  q := public.mi_salon_cotizar_de(tienda, 'trimestre', null, '2026-12-21');
  perform public.zz_b22_anotar('precio', 'cupo lleno pero comprador de la tienda: fundador $199 (motivo tienda)',
    (q ->> 'precio_final')::numeric = 199 and q ->> 'motivo_fundador' = 'tienda', q::text);
  -- Una orden pendiente o del producto de prueba no cuenta
  insert into public.marketplace_ordenes (user_id, monto_total, estado, metodo_pago) values (tardia, 100, 'pendiente', 'mercadopago') returning id into o;
  insert into public.marketplace_orden_items (orden_id, producto_id, tipo, precio_unitario) values (o, prod, 'pdf', 100);
  perform public.zz_b22_anotar('precio', 'una compra de la tienda SIN pagar no da fundador', not public.mi_salon_comprador_tienda(tardia), null);
  update public.marketplace_productos set es_prueba = true where id = prod;
  perform public.zz_b22_anotar('precio', 'una compra del producto de prueba no da fundador', not public.mi_salon_comprador_tienda(tienda), null);
  update public.marketplace_productos set es_prueba = false where id = prod;
  -- Corte: compras después del lanzamiento no cuentan
  update public.marketplace_ordenes set estado = 'pagado' where id = o;  -- sella pagado_en = now()
  update public.jissez_config set mi_salon_fundador_tienda_hasta = now() - interval '1 hour' where id;
  perform public.zz_b22_anotar('precio', 'compra de la tienda DESPUÉS del corte: sin fundador de tienda', not public.mi_salon_comprador_tienda(tardia), null);
  perform public.zz_b22_anotar('precio', 'compra de la tienda ANTES del corte: sí', public.mi_salon_comprador_tienda(tienda) = (select pagado_en < now() - interval '1 hour' from public.marketplace_ordenes where user_id = tienda and estado = 'pagado' limit 1), null);
  update public.jissez_config set mi_salon_fundador_tienda_hasta = null where id;
  perform public.zz_b22_anotar('precio', 'sin corte ni lanzamiento: toda compra de la tienda cuenta', public.mi_salon_comprador_tienda(tardia), null);

  -- Cupones de creadores: sobre el precio de LISTA; gana el más bajo sin sumar
  insert into public.marketplace_cupones (codigo, tipo, valor, activo, uno_por_cliente, comision_porcentaje, creador_nombre)
  values ('ZZB22MITAD', 'porcentaje', 50, true, true, 20, 'ZZ creadora'),
         ('ZZB22DIEZ', 'porcentaje', 10, true, true, 20, 'ZZ creadora'),
         ('ZZB22CIEN', 'monto', 100, true, false, 20, 'ZZ creadora'),
         ('ZZB22UNO', 'monto', 30, true, false, 20, 'ZZ creadora');
  update public.marketplace_cupones set max_usos = 1 where codigo = 'ZZB22UNO';
  v_cupon50 := (public.marketplace_cupon_evaluar('ZZB22MITAD', 299, tienda, 'mi_salon') ->> 'precio_final')::numeric;
  q := public.mi_salon_cotizar_de(tienda, 'trimestre', 'ZZB22MITAD', '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'fundador ($199) + cupón 50% sobre lista ($299 → ' || v_cupon50 || '): gana el cupón, sin sumar',
    (q ->> 'precio_final')::numeric = v_cupon50 and v_cupon50 < 199 and v_cupon50 > 99 and q ->> 'tipo_precio' = 'cupon' and q ->> 'cupon_codigo' = 'ZZB22MITAD', q::text);
  q := public.mi_salon_cotizar_de(tienda, 'trimestre', 'ZZB22DIEZ', '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'fundador ($199) + cupón 10% ($269): gana el fundador; el cupón no se aplica (sin comisión) y queda como referido',
    (q ->> 'precio_final')::numeric = 199 and q ->> 'tipo_precio' = 'fundador' and q ->> 'cupon_codigo' is null
    and q ->> 'cupon_referido' = 'ZZB22DIEZ' and q -> 'cupon' ->> 'motivo' = 'fundador_mejor', q::text);
  q := public.mi_salon_cotizar_de(tienda, 'trimestre', 'ZZB22CIEN', '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'empate cupón ($299 − $100 = $199) contra fundador ($199): fundador', q ->> 'tipo_precio' = 'fundador' and q ->> 'cupon_codigo' is null, q::text);
  q := public.mi_salon_cotizar_de(nueva, 'trimestre', 'ZZB22DIEZ', '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'sin fundador (cupo lleno) + cupón 10%: $269 con cupón', (q ->> 'precio_final')::numeric = 269 and q ->> 'tipo_precio' = 'cupon', q::text);
  q := public.mi_salon_cotizar_de(nueva, 'trimestre', 'NOEXISTE', '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'cupón que no existe: precio de lista, motivo inexistente', (q ->> 'precio_final')::numeric = 299 and q -> 'cupon' ->> 'motivo' = 'inexistente', q::text);
  -- La oferta general de la tienda no toca Mi Salón
  insert into public.marketplace_promocion (id, activa, porcentaje, aplica_paquetes) values (true, true, 30, true)
  on conflict (id) do update set activa = true, porcentaje = 30, vigente_desde = null, vigente_hasta = null, aplica_paquetes = true;
  q := public.mi_salon_cotizar_de(nueva, 'trimestre', null, '2026-12-21');
  perform public.zz_b22_anotar('cupon', 'con la oferta general de la tienda activa (30%), Mi Salón sigue a su precio', (q ->> 'precio_final')::numeric = 299, q::text);
  perform public.zz_b22_anotar('cupon', 'la oferta de la tienda sigue aplicando a sus paquetes (sin cambio)', public.marketplace_precio_final(100, 'paquete') < 100, public.marketplace_precio_final(100, 'paquete')::text);
  update public.marketplace_promocion set activa = false where id;
  update public.jissez_config set mi_salon_cupo_fundador = 100 where id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Orden y pago: 22-oct contra 23-oct, OXXO que se aprueba 2 días después, webhook repetido,
--    importe que no cuadra, compra que se suma, reembolso, ya cubierto, venta cerrada
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  d22 uuid := public.zz_b22_cuenta('zz.b22.d22@jissez.test');
  d23 uuid := public.zz_b22_cuenta('zz.b22.d23@jissez.test');
  oxxo uuid := public.zz_b22_cuenta('zz.b22.oxxo@jissez.test');
  suma uuid := public.zz_b22_cuenta('zz.b22.suma@jissez.test');
  cerr uuid := public.zz_b22_cuenta('zz.b22.cerrada@jissez.test');
  r jsonb; r2 jsonb; p jsonb;
  o1 uuid; o2 uuid;
  n int;
  e jsonb;
begin
  update public.perfiles set activo_saas = true where id in (d22, d23, oxxo, suma);  -- ven Mi Salón con el interruptor apagado
  -- Sin su gratis (así el T1 solo sí agrega algo)
  perform public.zz_b22_limpiar(d22);
  perform public.zz_b22_limpiar(d23);

  -- Venta cerrada para el público
  r := public.mi_salon_registrar_orden(cerr, 'trimestre', null, now(), false, '2026-10-22');
  perform public.zz_b22_anotar('orden', 'interruptor apagado: una cuenta del público no puede comprar', r ->> 'motivo' = 'cerrada', r::text);

  -- 22-oct: solo T1
  r := public.mi_salon_registrar_orden(d22, 'trimestre', null, now(), false, '2026-10-22');
  o1 := (r ->> 'orden_id')::uuid;
  perform public.zz_b22_anotar('orden', 'se registra la orden al precio del servidor ($199 fundador)', (r ->> 'ok')::boolean and (r ->> 'precio')::numeric = 199
    and (select monto_total from public.marketplace_ordenes where id = o1) = 199, r::text);
  perform public.zz_b22_anotar('orden', 'la orden no tiene renglones en marketplace_orden_items (la tienda no la entrega)', not exists (select 1 from public.marketplace_orden_items where orden_id = o1), null);
  r2 := public.mi_salon_registrar_orden(d22, 'trimestre', null, now(), false, '2026-10-22');
  perform public.zz_b22_anotar('orden', 'doble clic: se reutiliza la misma orden', r2 ->> 'orden_id' = r ->> 'orden_id', r2 ->> 'orden_id');
  p := public.mi_salon_aplicar_pago(o1, public.zz_b22_pago('zz-b22-1', 'approved', 199, '2026-10-22T12:00:00-06:00'));
  perform public.zz_b22_anotar('22 contra 23', 'compra del 22-oct: acceso pago T1, vence 18-dic',
    p ->> 'estado' = 'pagado' and (p ->> 'accesos_creados')::int = 1 and p ->> 'vence' = '2026-12-18'
    and exists (select 1 from public.mi_salon_accesos where docente_id = d22 and origen = 'pago' and periodos = array['T1'] and pago_id = 'zz-b22-1'
                and precio_pagado = 199 and tipo_precio = 'fundador' and producto = 'trimestre'), p::text);

  -- 23-oct: T1 y T2
  r := public.mi_salon_registrar_orden(d23, 'trimestre', null, now(), false, '2026-10-23');
  o2 := (r ->> 'orden_id')::uuid;
  p := public.mi_salon_aplicar_pago(o2, public.zz_b22_pago('zz-b22-2', 'approved', 199, '2026-10-23T12:00:00-06:00'));
  perform public.zz_b22_anotar('22 contra 23', 'compra del 23-oct: acceso pago T1 y T2, vence 9-abr, compra tardía (incluye el T2)',
    p ->> 'vence' = '2027-04-09' and (p ->> 'compra_tardia')::boolean and p -> 'siguiente' ->> 'periodo' = 'T2'
    and exists (select 1 from public.mi_salon_accesos where docente_id = d23 and periodos = array['T1', 'T2']), p::text);

  -- Webhook repetido: nada nuevo
  p := public.mi_salon_aplicar_pago(o2, public.zz_b22_pago('zz-b22-2', 'approved', 199, '2026-10-23T12:00:00-06:00'));
  select count(*) into n from public.mi_salon_accesos where pago_id = 'zz-b22-2';
  perform public.zz_b22_anotar('idempotencia', 'webhook repetido: ya procesada y un solo acceso', (p ->> 'ya_procesada')::boolean and n = 1, p::text || ' n=' || n);
  -- Aunque la orden se "desmarque", el índice (pago_id, ciclo) no deja duplicar
  update public.marketplace_ordenes set estado = 'pendiente' where id = o2;
  p := public.mi_salon_aplicar_pago(o2, public.zz_b22_pago('zz-b22-2', 'approved', 199, '2026-10-23T12:00:00-06:00'));
  select count(*) into n from public.mi_salon_accesos where pago_id = 'zz-b22-2';
  perform public.zz_b22_anotar('idempotencia', 'el mismo pago otra vez con la orden reabierta: 0 accesos nuevos (índice único)', (p ->> 'accesos_creados')::int = 0 and n = 1, p::text);
  perform public.zz_b22_anotar('idempotencia', 'insertar a mano el mismo pago y ciclo choca con el índice único',
    public.zz_b22_intentar(format($q$insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, pago_id) values (%L, '2026-2027', '{T3}', 'pago', 'zz-b22-2')$q$, d23)) like '23505|%', null);

  -- OXXO pendiente que se aprueba 2 días después
  r := public.mi_salon_registrar_orden(oxxo, 'resto_ciclo', null, now(), false, '2026-11-20');
  o1 := (r ->> 'orden_id')::uuid;
  p := public.mi_salon_aplicar_pago(o1, public.zz_b22_pago('zz-b22-3', 'pending', 399, null, 'oxxo', 'ticket', '9988776655', 'https://www.mercadopago.com.mx/payments/zz/ticket'));
  perform public.zz_b22_anotar('oxxo', 'OXXO generado: la orden queda pendiente y sin acceso nuevo',
    p ->> 'estado' = 'pendiente' and (select estado from public.marketplace_ordenes where id = o1) = 'pendiente'
    and not exists (select 1 from public.mi_salon_accesos where docente_id = oxxo and origen = 'pago'), p::text);
  perform public.zz_b22_anotar('oxxo', 'el estado de la cuenta muestra "Pago pendiente" con la referencia',
    public.mi_salon_pago_pendiente(oxxo) ->> 'referencia' = '9988776655' and public.mi_salon_pago_pendiente(oxxo) ->> 'tipo_metodo' = 'ticket'
    and public.mi_salon_pago_pendiente(oxxo) ->> 'ticket_url' like 'https://%', public.mi_salon_pago_pendiente(oxxo)::text);
  r2 := public.mi_salon_registrar_orden(oxxo, 'trimestre', null, now(), false, '2026-11-20');
  perform public.zz_b22_anotar('oxxo', 'con un pago pendiente no se cobra otro sin preguntar (motivo pago_pendiente)', r2 ->> 'motivo' = 'pago_pendiente', r2::text);
  -- El recordatorio de las 24 horas (con Mi Salón abierto)
  update public.jissez_config set mi_salon_abierto = true where id;
  update public.mi_salon_ordenes set pendiente_desde = now() - interval '25 hours' where orden_id = o1;
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-21') x where x.tipo = 'oxxo:' || o1;
  perform public.zz_b22_anotar('oxxo', 'a las 24 h sin pagarse: recordatorio por correo', n = 1, n::text);
  insert into public.mi_salon_correos (docente_id, tipo) values (oxxo, 'oxxo:' || o1);
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-21') x where x.tipo = 'oxxo:' || o1;
  perform public.zz_b22_anotar('oxxo', 'el recordatorio sale una sola vez', n = 0, n::text);
  update public.jissez_config set mi_salon_abierto = false where id;
  -- Se paga 2 días después
  p := public.mi_salon_aplicar_pago(o1, public.zz_b22_pago('zz-b22-3', 'approved', 399, '2026-11-22T09:30:00-06:00', 'oxxo', 'ticket'));
  perform public.zz_b22_anotar('oxxo', 'aprobado 2 días después: acceso T2 y T3 (se suma al gratis T1), vence 30-jul',
    p ->> 'estado' = 'pagado' and p ->> 'vence' = '2027-07-30'
    and exists (select 1 from public.mi_salon_accesos where docente_id = oxxo and origen = 'pago' and periodos = array['T2', 'T3'])
    and exists (select 1 from public.mi_salon_accesos where docente_id = oxxo and origen = 'gratis_t1'), p::text);
  perform public.zz_b22_anotar('oxxo', 'ya no hay pago pendiente', public.mi_salon_pago_pendiente(oxxo) is null, null);

  -- Importe que no cuadra: no entrega
  r := public.mi_salon_registrar_orden(suma, 'trimestre', null, now(), false, '2026-10-23');
  o1 := (r ->> 'orden_id')::uuid;
  p := public.mi_salon_aplicar_pago(o1, public.zz_b22_pago('zz-b22-4', 'approved', 1, '2026-10-23T12:00:00-06:00'));
  perform public.zz_b22_anotar('pago', 'pago aprobado de $1 para una orden de $199: no entrega', not (p ->> 'ok')::boolean
    and not exists (select 1 from public.mi_salon_accesos where docente_id = suma and origen = 'pago'), p::text);
  -- Compra que se suma a un acceso vigente (gratis T1 + compra tardía T1 y T2)
  p := public.mi_salon_aplicar_pago(o1, public.zz_b22_pago('zz-b22-5', 'approved', 199, '2026-10-23T12:00:00-06:00'));
  select count(*) into n from public.mi_salon_accesos where docente_id = suma;
  perform public.zz_b22_anotar('se suma', 'la compra se suma al gratis vigente: 2 accesos, vence 9-abr, vigencia extendida',
    n = 2 and p ->> 'vence' = '2027-04-09' and p ->> 'vence_antes' = '2026-12-18' and (p ->> 'extendida')::boolean and (p ->> 'agrego')::boolean, p::text);
  -- Ya cubierto: no se vende lo que no agrega nada
  r := public.mi_salon_registrar_orden(suma, 'trimestre', null, now(), false, '2026-11-20');
  perform public.zz_b22_anotar('se suma', 'comprar otra vez el T2 (ya lo tiene): no se vende (ya_cubierto)', r ->> 'motivo' = 'ya_cubierto', r::text);
  e := public.mi_salon_cotizar_de(suma, 'trimestre', null, '2027-02-12');
  perform public.zz_b22_anotar('se suma', 'el 12-feb sí agrega el T3: válido hasta 30-jul', (e ->> 'disponible')::boolean and e ->> 'vence_acceso' = '2027-07-30'
    and e -> 'nuevos' = '[{"ciclo":"2026-2027","periodo":"T3"}]', e::text);

  -- Rechazado
  r := public.mi_salon_registrar_orden(d22, 'resto_ciclo', null, now(), false, '2026-11-20');
  p := public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-6', 'rejected', 399));
  perform public.zz_b22_anotar('pago', 'pago rechazado: orden fallida, sin acceso', p ->> 'estado' = 'fallido' and not exists (select 1 from public.mi_salon_accesos where pago_id = 'zz-b22-6'), p::text);

  -- Reembolso: se quita el acceso de ese pago; los datos no se tocan
  p := public.mi_salon_aplicar_pago(o2, public.zz_b22_pago('zz-b22-2', 'refunded', 199));
  perform public.zz_b22_anotar('reembolso', 'reembolso: orden reembolsada y sin el acceso de ese pago',
    p ->> 'estado' = 'reembolsado' and not exists (select 1 from public.mi_salon_accesos where pago_id = 'zz-b22-2')
    and (select estado from public.marketplace_ordenes where id = o2) = 'reembolsado', p::text);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Lugares fundador: cuentan DOCENTES (no pagos), el previo conserva, el reembolso libera;
--    cupones: la venta de Mi Salón cuenta como uso y genera comisión
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  a uuid := public.zz_b22_cuenta('zz.b22.lugara@jissez.test');
  b uuid := public.zz_b22_cuenta('zz.b22.lugarb@jissez.test');
  cc uuid := public.zz_b22_cuenta('zz.b22.lugarc@jissez.test');
  base int;
  r jsonb; p jsonb; q jsonb;
  oa uuid;
begin
  update public.perfiles set activo_saas = true where id in (a, b, cc);
  update public.jissez_config set mi_salon_cupo_fundador = 100 where id;
  base := public.mi_salon_fundador_usados('2026-2027');
  r := public.mi_salon_registrar_orden(a, 'trimestre', null, now(), false, '2026-10-23');
  oa := (r ->> 'orden_id')::uuid;
  perform public.mi_salon_aplicar_pago(oa, public.zz_b22_pago('zz-b22-a1', 'approved', 199, '2026-10-23T12:00:00-06:00'));
  perform public.zz_b22_anotar('lugares', 'un pago a precio fundador ocupa un lugar', public.mi_salon_fundador_usados('2026-2027') = base + 1
    and public.mi_salon_lugares_fundador('2026-2027') = 100 - (base + 1), public.mi_salon_lugares_fundador('2026-2027')::text);
  -- La misma docente compra otra vez (T3): conserva el fundador y NO ocupa otro lugar
  update public.jissez_config set mi_salon_cupo_fundador = base + 1 where id;  -- cupo lleno
  q := public.mi_salon_cotizar_de(a, 'trimestre', null, '2027-02-12');
  perform public.zz_b22_anotar('lugares', 'cupo lleno, pero ya pagó a precio fundador en el ciclo: sigue con fundador (previo)', q ->> 'motivo_fundador' = 'previo' and (q ->> 'precio_final')::numeric = 199, q::text);
  r := public.mi_salon_registrar_orden(a, 'trimestre', null, now(), false, '2027-02-12');
  perform public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-a2', 'approved', 199, '2027-02-12T12:00:00-06:00'));
  perform public.zz_b22_anotar('lugares', 'dos pagos de la misma docente cuentan como UN lugar', public.mi_salon_fundador_usados('2026-2027') = base + 1, public.mi_salon_fundador_usados('2026-2027')::text);
  q := public.mi_salon_cotizar_de(b, 'trimestre', null, '2026-10-23');
  perform public.zz_b22_anotar('lugares', 'con el cupo lleno otra docente paga precio de lista', q ->> 'tipo_precio' = 'lista' and (q ->> 'lugares_fundador')::int = 0, q::text);
  -- Un reembolso libera el lugar (si fue su única orden fundador pagada)
  update public.jissez_config set mi_salon_cupo_fundador = base + 1 where id;
  perform public.mi_salon_aplicar_pago(oa, public.zz_b22_pago('zz-b22-a1', 'refunded', 199));
  perform public.zz_b22_anotar('lugares', 'reembolso de una: sigue ocupando lugar mientras tenga otro pago fundador', public.mi_salon_fundador_usados('2026-2027') = base + 1, null);

  -- Cupón con usos máximos: la venta de Mi Salón cuenta como uso; comisión
  update public.jissez_config set mi_salon_cupo_fundador = 0 where id;
  r := public.mi_salon_registrar_orden(b, 'trimestre', 'ZZB22UNO', now(), false, '2026-10-23');
  perform public.zz_b22_anotar('cupon', 'orden con cupón: se sella cupon_codigo y el descuento sobre lista',
    (select cupon_codigo from public.marketplace_ordenes where id = (r ->> 'orden_id')::uuid) = 'ZZB22UNO'
    and (select monto_total from public.marketplace_ordenes where id = (r ->> 'orden_id')::uuid) = 269
    and (select tipo_precio from public.mi_salon_ordenes where orden_id = (r ->> 'orden_id')::uuid) = 'cupon', r::text);
  perform public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-b1', 'approved', 269, '2026-10-23T12:00:00-06:00'));
  perform public.zz_b22_anotar('cupon', 'comisión del creador por la venta de Mi Salón (20% de $269)', public.marketplace_cupon_comision_acumulada('ZZB22UNO') = 53.80,
    public.marketplace_cupon_comision_acumulada('ZZB22UNO')::text);
  q := public.mi_salon_cotizar_de(cc, 'trimestre', 'ZZB22UNO', '2026-10-23');
  perform public.zz_b22_anotar('cupon', 'el cupón de un solo uso ya se agotó (el uso fue en Mi Salón)', q -> 'cupon' ->> 'motivo' = 'agotado' and q ->> 'tipo_precio' = 'lista', q::text);
  update public.jissez_config set mi_salon_cupo_fundador = 100 where id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Cuenta vencida que escribe directo contra la base; compra que la reabre
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v uuid := public.zz_b22_cuenta('zz.b22.vencida@jissez.test');
  g uuid;
  r jsonb; res text;
begin
  update public.perfiles set activo_saas = true where id = v;
  insert into public.grupos (maestro_id, nombre, grados, ciclo_escolar) values (v, 'ZZ b22 grupo', array[1], '2026-2027') returning id into g;
  -- Solo un acceso pagado del ciclo anterior (vencido)
  insert into public.mi_salon_periodos (ciclo, periodo, orden, venta_desde, compra_tardia_desde, registro_calificaciones, boletas_fin, vence)
  values ('2025-2026', 'T1', 1, '2025-09-01', '2025-10-24', '2025-11-14', '2025-11-27', '2025-12-19'),
         ('2025-2026', 'T2', 2, '2025-11-15', '2026-02-13', '2026-03-06', '2026-03-20', '2026-04-10'),
         ('2025-2026', 'T3', 3, '2026-03-07', '2026-06-12', '2026-07-03', '2026-07-10', '2026-07-31');
  perform public.zz_b22_limpiar(v);
  insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, pago_id, precio_pagado, tipo_precio, producto, desde)
  values (v, '2025-2026', '{T3}', 'pago', 'zz-b22-viejo', 199, 'fundador', 'trimestre', '2026-03-10');
  perform public.zz_b22_como(v, 'zz.b22.vencida@jissez.test');
  set local role authenticated;
  res := public.zz_b22_intentar(format($q$update public.grupos set nombre = 'ZZ cambiado' where id = %L$q$, g));
  reset role;
  perform public.zz_b22_sin_sesion();
  perform public.zz_b22_anotar('vencida', 'cuenta vencida: escribir directo contra la base falla (42501, mi_salon_solo_lectura)', res like '42501|mi_salon_solo_lectura|%', res);
  -- Compra y pago aprobado hoy: vuelve a escribir
  r := public.mi_salon_registrar_orden(v, 'trimestre', null, now(), false, null);
  perform public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-v1', 'approved', (r ->> 'precio')::numeric, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')));
  perform public.zz_b22_como(v, 'zz.b22.vencida@jissez.test');
  set local role authenticated;
  res := public.zz_b22_intentar(format($q$update public.grupos set nombre = 'ZZ cambiado' where id = %L$q$, g));
  reset role;
  perform public.zz_b22_sin_sesion();
  perform public.zz_b22_anotar('vencida', 'tras pagar (webhook), la misma escritura pasa', res = 'ok', res || ' ' || r::text);
  delete from public.mi_salon_periodos where ciclo = '2025-2026';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Compra tardía del T3 con 2027-2028 sin cargar: vence provisional y se extiende sola
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t uuid := public.zz_b22_cuenta('zz.b22.t3@jissez.test');
  r jsonb; p jsonb;
  n int;
begin
  update public.perfiles set activo_saas = true where id = t;
  r := public.mi_salon_registrar_orden(t, 'trimestre', null, now(), false, '2027-06-11');
  p := public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-t3', 'approved', 199, '2027-06-11T12:00:00-06:00'));
  select count(*) into n from public.mi_salon_accesos where pago_id = 'zz-b22-t3';
  perform public.zz_b22_anotar('T3 tardío', 'dos accesos con el mismo pago (uno por ciclo); el monto va solo en el del ciclo de venta',
    n = 2 and (select precio_pagado from public.mi_salon_accesos where pago_id = 'zz-b22-t3' and ciclo = '2027-2028') is null
    and (select precio_pagado from public.mi_salon_accesos where pago_id = 'zz-b22-t3' and ciclo = '2026-2027') = 199, n::text);
  perform public.zz_b22_anotar('T3 tardío', 'vence provisional el 30-jul-2027', p ->> 'vence' = '2027-07-30' and (p ->> 'provisional')::boolean, p::text);
  insert into public.mi_salon_periodos (ciclo, periodo, orden, venta_desde, compra_tardia_desde, registro_calificaciones, boletas_fin, vence)
  values ('2027-2028', 'T1', 1, '2027-08-30', '2027-10-22', '2027-11-12', '2027-11-25', '2027-12-17'),
         ('2027-2028', 'T2', 2, '2027-11-13', '2028-02-11', '2028-03-03', '2028-03-17', '2028-04-07'),
         ('2027-2028', 'T3', 3, '2028-03-04', '2028-06-09', '2028-06-30', '2028-07-07', '2028-07-28');
  perform public.zz_b22_anotar('T3 tardío', 'al cargar 2027-2028, el acceso se extiende solo al 17-dic-2027', public.mi_salon_vence_max(t) = date '2027-12-17', public.mi_salon_vence_max(t)::text);
  update public.jissez_config set mi_salon_abierto = true where id;
  select count(*) into n from public.mi_salon_correos_pendientes('2027-08-01') x where x.docente_id = t and x.tipo like 'extendida:%';
  perform public.zz_b22_anotar('T3 tardío', 'correo de vigencia extendida (una vez)', n = 1, n::text);
  update public.jissez_config set mi_salon_abierto = false where id;
  -- Con el ciclo nuevo cargado, la ventana del T3 termina donde empieza la venta del T1 nuevo
  perform public.zz_b22_anotar('T3 tardío', 'el 1-ago-2027 (ciclo nuevo cargado) sigue la ventana del T3: T3 + T1 2027-2028',
    public.mi_salon_cobertura('trimestre', '2027-08-01') -> 'cobertura' = '[{"ciclo":"2026-2027","periodos":["T3"]},{"ciclo":"2027-2028","periodos":["T1"]}]',
    (public.mi_salon_cobertura('trimestre', '2027-08-01') -> 'cobertura')::text);
  delete from public.mi_salon_periodos where ciclo = '2027-2028';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Avisos: calendario del T1 gratis y de cuentas con pago, textos, app y correos idempotentes
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  g uuid := public.zz_b22_cuenta('zz.b22.avisog@jissez.test');
  pg uuid := public.zz_b22_cuenta('zz.b22.avisop@jissez.test');
  fechas text;
  a jsonb;
  n int;
  r jsonb;
begin
  select string_agg(x.clave || '=' || x.fecha, ',' order by x.fecha) into fechas from public.mi_salon_avisos_fechas(g, '2026-11-01') x;
  perform public.zz_b22_anotar('avisos', 'calendario del T1 gratis: 6-nov, 13-nov, 30-nov, 11-dic, 17-dic y 19-dic (de la tabla de periodos)',
    fechas = 'gratis_cierre=2026-11-06,gratis_boleta=2026-11-13,gratis_precios=2026-11-30,gratis_7=2026-12-11,gratis_ultimo=2026-12-17,gratis_terminado=2026-12-19', fechas);
  a := public.mi_salon_aviso_app(g, '2026-11-30');
  perform public.zz_b22_anotar('avisos', '30-nov en la app: precios del T2 con fundador',
    a ->> 'texto' = 'Tu acceso gratis termina el 18 de diciembre. Para seguir en el segundo trimestre: $199 el trimestre o $399 el resto del ciclo (precio fundador).', a::text);
  a := public.mi_salon_aviso_app(g, '2026-12-11');
  perform public.zz_b22_anotar('avisos', '11-dic: "termina el viernes 18"', a ->> 'texto' = 'Tu acceso gratis termina el viernes 18. Tus datos se quedan guardados pase lo que pase.', a::text);
  a := public.mi_salon_aviso_app(g, '2026-11-06');
  perform public.zz_b22_anotar('avisos', '6-nov: recordatorio del registro (13 de noviembre)', a ->> 'texto' like 'El 13 de noviembre es el registro de calificaciones.%', a::text);
  a := public.mi_salon_aviso_app(g, '2026-12-20');
  perform public.zz_b22_anotar('avisos', '19-dic en adelante: la app no repite aviso (lo cubre el banner de solo lectura)', a is null, coalesce(a::text, 'null'));
  update public.jissez_config set mi_salon_cupo_fundador = 0 where id;
  a := public.mi_salon_aviso_app(g, '2026-11-30');
  perform public.zz_b22_anotar('avisos', 'sin lugares fundador, el aviso da los precios de lista sin "(precio fundador)"',
    a ->> 'texto' = 'Tu acceso gratis termina el 18 de diciembre. Para seguir en el segundo trimestre: $299 el trimestre o $549 el resto del ciclo.', a::text);
  update public.jissez_config set mi_salon_cupo_fundador = 100 where id;

  -- Cuenta con pago del T2 (vence 9-abr): 21, 7 y 1 días antes y el día siguiente
  update public.perfiles set activo_saas = true where id = pg;
  r := public.mi_salon_registrar_orden(pg, 'trimestre', null, now(), false, '2026-11-20');
  perform public.mi_salon_aplicar_pago((r ->> 'orden_id')::uuid, public.zz_b22_pago('zz-b22-p1', 'approved', 199, '2026-11-20T12:00:00-06:00'));
  select string_agg(x.clave || '=' || x.fecha, ',' order by x.fecha) into fechas from public.mi_salon_avisos_fechas(pg, '2027-03-01') x;
  perform public.zz_b22_anotar('avisos', 'cuenta con pago (vence 9-abr): 19-mar, 2-abr, 8-abr y 10-abr (y, como tuvo el T1 gratis, el recordatorio del registro y la boleta)',
    fechas = 'gratis_cierre=2026-11-06,gratis_boleta=2026-11-13,pago_21=2027-03-19,pago_7=2027-04-02,pago_1=2027-04-08,pago_terminado=2027-04-10', fechas);
  select string_agg(x.clave, ',') into fechas from public.mi_salon_avisos_fechas(pg, '2026-11-25') x where x.clave like 'gratis_sin%' or x.clave in ('gratis_precios', 'gratis_7');
  perform public.zz_b22_anotar('avisos', 'quien ya compró no recibe los avisos de "tu acceso gratis termina"', fechas is null, coalesce(fechas, 'ninguno'));

  -- Correos: solo con Mi Salón abierto, una vez por aviso
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-06') x where x.docente_id = g;
  perform public.zz_b22_anotar('correos', 'Mi Salón apagado: no sale ningún correo', n = 0, n::text);
  update public.jissez_config set mi_salon_abierto = true where id;
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-06') x where x.docente_id = g and x.tipo = 'aviso:gratis_cierre:2026-11-06';
  perform public.zz_b22_anotar('correos', '6-nov con Mi Salón abierto: sale el recordatorio', n = 1, n::text);
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-07') x where x.docente_id = g and x.tipo = 'aviso:gratis_cierre:2026-11-06';
  perform public.zz_b22_anotar('correos', 'si el cron no corrió el 6, sale el 7', n = 1, n::text);
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-08') x where x.docente_id = g and x.tipo = 'aviso:gratis_cierre:2026-11-06';
  perform public.zz_b22_anotar('correos', 'el 8 ya no (no se manda un aviso viejo)', n = 0, n::text);
  insert into public.mi_salon_correos (docente_id, tipo) values (g, 'aviso:gratis_cierre:2026-11-06');
  select count(*) into n from public.mi_salon_correos_pendientes('2026-11-06') x where x.docente_id = g;
  perform public.zz_b22_anotar('correos', 'ya enviado: no se repite (idempotente por docente y aviso)', n = 0, n::text);
  select count(*) into n from public.mi_salon_correos_pendientes('2027-03-19') x where x.docente_id = pg and x.tipo = 'aviso:pago_21:2027-03-19';
  perform public.zz_b22_anotar('correos', 'cuenta con pago: aviso de 21 días el 19-mar', n = 1, n::text);
  select x.texto into fechas from public.mi_salon_correos_pendientes('2027-04-02') x where x.docente_id = pg;
  perform public.zz_b22_anotar('correos', 'texto de 7 días: "termina el viernes 9"', fechas = 'Tu acceso a Mi Salón termina el viernes 9. Tus datos se quedan guardados pase lo que pase.', fechas);
  update public.jissez_config set mi_salon_abierto = false where id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Estado para la app, permisos y panel
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  d uuid := public.zz_b22_cuenta('zz.b22.estado@jissez.test');
  otra uuid := public.zz_b22_cuenta('zz.b22.otra@jissez.test');
  admin_id uuid;
  e jsonb; res text; r jsonb; t jsonb;
  prod uuid; o uuid;
  det text;
begin
  perform public.zz_b22_como(d, 'zz.b22.estado@jissez.test');
  e := public.mi_salon_estado();
  perform public.zz_b22_anotar('estado', 'el estado conserva las llaves de b21 y agrega pago_pendiente y aviso',
    e ?& array['abierto', 'visible', 'vigente', 'tiene_acceso', 'origen', 'ciclo', 'periodos', 'vence', 'solo_lectura_desde', 'dias_restantes', 'piloto', 'bienvenida_pendiente', 'pago_pendiente', 'aviso'], e::text);
  perform public.zz_b22_anotar('estado', 'con Mi Salón apagado no hay aviso en la app', e -> 'aviso' = 'null'::jsonb, e ->> 'aviso');
  -- Una cuenta no cotiza por otra ni registra órdenes
  set local role authenticated;
  res := public.zz_b22_intentar(format($q$select public.mi_salon_cotizar_de(%L, 'trimestre', null, null)$q$, otra));
  perform public.zz_b22_anotar('permisos', 'cotizar por otra cuenta: rechazado', res like '42501|%', res);
  res := public.zz_b22_intentar(format($q$select public.mi_salon_registrar_orden(%L, 'trimestre')$q$, d));
  perform public.zz_b22_anotar('permisos', 'registrar una orden con la sesión (sin service role): rechazado', res like '42501|%', res);
  res := public.zz_b22_intentar(format($q$select public.mi_salon_aplicar_pago(gen_random_uuid(), '{}')$q$));
  perform public.zz_b22_anotar('permisos', 'aplicar un pago con la sesión: rechazado', res like '42501|%', res);
  res := public.zz_b22_intentar($q$insert into public.mi_salon_ordenes (orden_id, docente_id, producto, ciclo, periodo, cobertura, precio_lista, tipo_precio) values (gen_random_uuid(), auth.uid(), 'trimestre', '2026-2027', 'T1', '[]', 1, 'lista')$q$);
  perform public.zz_b22_anotar('permisos', 'escribir mi_salon_ordenes desde el cliente: rechazado', res like '42501|%', res);
  update public.mi_salon_precios set precio_lista = 1;
  perform public.zz_b22_anotar('permisos', 'cambiar precios sin ser admin: no cambia nada (RLS)', (select count(*) from public.mi_salon_precios where precio_lista = 1) = 0, null);
  res := public.zz_b22_intentar($q$select public.admin_mi_salon_cobros()$q$);
  perform public.zz_b22_anotar('permisos', 'panel de cobros sin ser admin: rechazado', res like '42501|%', res);
  t := public.mi_salon_cotizar('trimestre', null);
  perform public.zz_b22_anotar('permisos', 'la cuenta cotiza lo suyo con la sesión', t ->> 'producto' = 'trimestre', t::text);
  reset role;
  perform public.zz_b22_sin_sesion();
  -- Anónimo: precios públicos (apagado: nada)
  perform public.zz_b22_anotar('publico', 'precios públicos con Mi Salón apagado: solo {abierto: false}', public.mi_salon_precios_publicos() = '{"abierto": false}'::jsonb, public.mi_salon_precios_publicos()::text);
  update public.jissez_config set mi_salon_abierto = true where id;
  t := public.mi_salon_precios_publicos();
  perform public.zz_b22_anotar('publico', 'con Mi Salón abierto: Trimestre y Resto del ciclo, lugares fundador', jsonb_array_length(t -> 'productos') = 2
    and t -> 'productos' -> 0 ->> 'producto' = 'trimestre' and (t ->> 'lugares_fundador')::int >= 0, t::text);
  update public.jissez_config set mi_salon_abierto = false where id;

  -- Panel (admin): pagos, segmentos y detalle de la orden en la lista de la tienda
  select id into admin_id from auth.users where email = 'soporte.jissez@gmail.com';
  if admin_id is null then admin_id := public.zz_b22_cuenta('soporte.jissez@gmail.com'); end if;
  update public.perfiles set activo_saas = true where id = d;
  r := public.mi_salon_registrar_orden(d, 'trimestre', null, now(), false, '2026-10-23');
  perform public.zz_b22_como(admin_id, 'soporte.jissez@gmail.com');
  t := public.admin_mi_salon_cobros();
  perform public.zz_b22_anotar('panel', 'el panel lista la orden de Mi Salón con producto, monto y tipo de precio',
    exists (select 1 from jsonb_array_elements(t -> 'pagos') x where x ->> 'orden_id' = r ->> 'orden_id' and (x ->> 'monto')::numeric = 199 and x ->> 'tipo_precio' = 'fundador'), null);
  perform public.zz_b22_anotar('panel', 'segmentos de WhatsApp con texto listo y {url}', jsonb_array_length(t -> 'segmentos') > 0
    and (select bool_and(x ->> 'texto' like '%{url}') from jsonb_array_elements(t -> 'segmentos') x), (select string_agg(x ->> 'clave', ',') from jsonb_array_elements(t -> 'segmentos') x));
  perform public.zz_b22_anotar('panel', 'cupo y lugares en el panel', (t -> 'config' ->> 'cupo_fundador')::int = 100 and t ? 'lugares_fundador', t -> 'config' ->> 'cupo_fundador');
  select x.detalle into det from public.admin_listar_ordenes() x where x.id = (r ->> 'orden_id')::uuid;
  perform public.zz_b22_anotar('panel', 'Órdenes de la tienda: la de Mi Salón dice "Mi Salón — Trimestre 2026-2027"', det = 'Mi Salón — Trimestre 2026-2027', det);
  -- Una orden de la tienda sale igual que antes
  insert into public.marketplace_productos (titulo, grado, fase, precio_pdf, activo, es_prueba) values ('ZZ b22 detalle', 1, 3, 100, false, false) returning id into prod;
  insert into public.marketplace_ordenes (user_id, monto_total, estado, metodo_pago) values (otra, 100, 'pendiente', 'mercadopago') returning id into o;
  insert into public.marketplace_orden_items (orden_id, producto_id, tipo, precio_unitario) values (o, prod, 'editable', 100);
  select x.detalle into det from public.admin_listar_ordenes() x where x.id = o;
  perform public.zz_b22_anotar('panel', 'Órdenes de la tienda: una orden de la tienda sale idéntica', det = 'ZZ b22 detalle — Editable (Word)', det);
  res := public.zz_b22_intentar($q$select public.admin_mi_salon_guardar_fundador(-1)$q$);
  perform public.zz_b22_anotar('panel', 'cupo negativo: rechazado', res like '22023|%', res);
  t := public.admin_mi_salon_guardar_fundador(150, '2026-10-12 00:00-06');
  perform public.zz_b22_anotar('panel', 'el admin cambia el cupo y el corte de la tienda', (t ->> 'mi_salon_cupo_fundador')::int = 150 and t ->> 'mi_salon_fundador_tienda_hasta' is not null, t::text);
  perform public.zz_b22_sin_sesion();
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Aviso de lanzamiento a las cuentas que ya existían (decisión de Jorge, 2026-09-26)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  vieja uuid := public.zz_b22_cuenta('zz.b22.vieja@jissez.test', '2026-09-01 10:00-06');
  piloto uuid := public.zz_b22_cuenta('zz.b22.piloto@jissez.test', '2026-09-01 10:00-06');
  nueva uuid;
  n int;
  t text;
begin
  insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen) values (piloto, '2026-2027', '{T1,T2,T3}', 'piloto');
  select count(*) into n from public.mi_salon_correos_pendientes(null, 'lanzamiento') x where x.docente_id = vieja;
  perform public.zz_b22_anotar('lanzamiento', 'con Mi Salón apagado no sale', n = 0, n::text);
  update public.jissez_config set mi_salon_abierto = true, mi_salon_abierto_desde = now() where id;
  nueva := public.zz_b22_cuenta('zz.b22.despues@jissez.test', now() + interval '1 minute');
  select count(*), min(x.texto) into n, t from public.mi_salon_correos_pendientes(null, 'lanzamiento') x where x.docente_id = vieja;
  perform public.zz_b22_anotar('lanzamiento', 'al encender: un aviso a la cuenta que ya existía, con su T1 gratis hasta el 18 de diciembre',
    n = 1 and t like '%Tu primer trimestre es gratis: tienes acceso completo hasta el 18 de diciembre, sin tarjeta.%', t);
  select count(*) into n from public.mi_salon_correos_pendientes(null, 'lanzamiento') x where x.docente_id in (piloto, nueva);
  perform public.zz_b22_anotar('lanzamiento', 'no al piloto ni a la cuenta nueva (esa recibe la bienvenida)', n = 0, n::text);
  select count(*) into n from public.mi_salon_correos_pendientes(null, null) x where x.docente_id = vieja and x.tipo = 'lanzamiento';
  perform public.zz_b22_anotar('lanzamiento', 'también lo manda el cron', n = 1, n::text);
  insert into public.mi_salon_correos (docente_id, tipo) values (vieja, 'lanzamiento');
  select count(*) into n from public.mi_salon_correos_pendientes(null, 'lanzamiento') x where x.docente_id = vieja;
  perform public.zz_b22_anotar('lanzamiento', 'una sola vez por cuenta (idempotente)', n = 0, n::text);
  delete from public.mi_salon_correos where docente_id = vieja;
  select count(*) into n from public.mi_salon_correos_pendientes('2026-12-19', 'lanzamiento') x where x.docente_id = vieja;
  perform public.zz_b22_anotar('lanzamiento', 'después del 18-dic ya no se manda (el T1 gratis terminó)', n = 0, n::text);
  select count(*) into n from public.mi_salon_correos_pendientes(null, 'lanzamiento') x where x.tipo <> 'lanzamiento';
  perform public.zz_b22_anotar('lanzamiento', 'el botón del panel (solo lanzamiento) no manda otros avisos', n = 0, n::text);
  select string_agg(x.texto, ' ') into t from public.mi_salon_correos_pendientes(null, 'lanzamiento') x;
  perform public.zz_b22_anotar('lenguaje', 'textos sin "maestra" ni "maestro" y sin urgencia falsa', t !~* '(maestr[ao]s?\b|última oportunidad|¡)', left(t, 120));
  update public.jissez_config set mi_salon_abierto = false, mi_salon_abierto_desde = null where id;
end $$;

select grupo, caso, ok, detalle from public.zz_b22_resultados
union all
select 'RESUMEN', count(*) filter (where not ok) || ' fallas de ' || count(*), count(*) filter (where not ok) = 0, null from public.zz_b22_resultados;
