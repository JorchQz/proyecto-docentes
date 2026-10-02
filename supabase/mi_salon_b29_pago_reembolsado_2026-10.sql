-- b29 (2026-10-02, constructor BD): un aviso viejo no revive una orden reembolsada.
--
-- mi_salon_aplicar_pago (b22), dentro de su FOR UPDATE de la orden: si la orden ya está
-- 'reembolsado' y el aviso NO es de reembolso (approved, pending, rejected...), devuelve el
-- resultado definitivo de "ya procesada" sin marcar pagada, sin insertar accesos y sin apartar
-- correo. Cambios respecto a la de b22 (el resto, igual, línea por línea):
--   1. el bloque "b29" de abajo (orden reembolsada);
--   2. la respuesta "ya procesada" de una orden pagada suma 'tipo_precio' y 'cobertura'
--      (cobertura_final) para que el reintento que ve ya_procesada pueda mandar el correo de
--      confirmación completo si el primero nunca salió (Edge _shared/mi-salon-pagos.ts).
-- Misma firma y mismos permisos. Aditiva e idempotente (create or replace), sin tocar datos.
-- Reversa: volver a la definición de supabase/mi_salon_b22_cobros_2026-09.sql (create or replace).

create or replace function public.mi_salon_aplicar_pago(p_orden_id uuid, p_pago jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.marketplace_ordenes%rowtype;
  m public.mi_salon_ordenes%rowtype;
  v_status text := coalesce(p_pago ->> 'status', '');
  v_pago_id text := nullif(p_pago ->> 'id', '');
  v_monto numeric;
  v_moneda text := coalesce(p_pago ->> 'currency_id', '');
  v_fecha date;
  v_aprob jsonb;
  v_cob jsonb;
  v_vence_antes date;
  v_fin_antes timestamptz;
  v_vence date;
  v_prov boolean;
  v_n integer := 0;
  v_k integer;
  g record;
  v_agrego boolean;
  v_nombre text;
  v_quitados integer;
  v_tardia boolean;
begin
  if not public.mi_salon_confiable() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into o from public.marketplace_ordenes where id = p_orden_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'estado', 'pendiente', 'error', 'Orden no encontrada'); end if;
  select * into m from public.mi_salon_ordenes where orden_id = p_orden_id;
  if m.orden_id is null then return jsonb_build_object('ok', false, 'estado', 'pendiente', 'error', 'La orden no es de Mi Salón'); end if;
  select pr.nombre into v_nombre from public.mi_salon_precios pr where pr.ciclo = m.ciclo and pr.producto = m.producto;
  v_nombre := coalesce(v_nombre, m.producto);

  -- Devolución o contracargo: se retira el acceso de ese pago
  if v_status in ('refunded', 'charged_back') then
    update public.marketplace_ordenes set estado = 'reembolsado', referencia_pago = coalesce(v_pago_id, referencia_pago) where id = p_orden_id;
    update public.mi_salon_ordenes set estado_mp = v_status where orden_id = p_orden_id;
    delete from public.mi_salon_accesos where pago_id = coalesce(v_pago_id, m.pago_id) and origen = 'pago' and docente_id = m.docente_id;
    get diagnostics v_quitados = row_count;
    return jsonb_build_object('ok', true, 'estado', 'reembolsado', 'accesos_quitados', v_quitados, 'docente_id', m.docente_id);
  end if;

  -- b29: una orden ya REEMBOLSADA no se revive con un aviso viejo (approved, pending, rejected...).
  -- Resultado definitivo de "ya procesada": no marca pagada, no inserta accesos, no aparta correo.
  -- (El reembolso mismo, refunded / charged_back, se atendió arriba y sigue idempotente.)
  if o.estado = 'reembolsado' then
    return jsonb_build_object('ok', true, 'estado', 'reembolsado', 'ya_procesada', true, 'accesos_creados', 0,
      'docente_id', m.docente_id, 'producto', m.producto, 'nombre', v_nombre, 'monto', o.monto_total);
  end if;

  -- Ya pagada Y aplicada: no se repite nada (webhook repetido, verificación manual después del
  -- webhook). Una orden 'pagado' SIN aprobado_en nunca se aplicó (R27b: el webhook la mandó por el
  -- camino de la tienda tras una falla pasajera) y se aplica ahora; el índice único (pago_id, ciclo)
  -- y aprobado_en, que se pone abajo, mantienen la idempotencia.
  if o.estado = 'pagado' and m.aprobado_en is not null then
    return jsonb_build_object('ok', true, 'estado', 'pagado', 'ya_procesada', true, 'accesos_creados', 0,
      'vence', public.mi_salon_vence_max(m.docente_id), 'docente_id', m.docente_id, 'producto', m.producto,
      'nombre', v_nombre, 'monto', o.monto_total, 'tipo_precio', m.tipo_precio, 'cobertura', m.cobertura_final);
  end if;

  -- Aún sin acreditar (OXXO, SPEI, revisión) o rechazado
  if v_status <> 'approved' then
    update public.marketplace_ordenes
       set estado = case when v_status in ('rejected', 'cancelled') then 'fallido' else 'pendiente' end,
           referencia_pago = coalesce(v_pago_id, referencia_pago)
     where id = p_orden_id;
    update public.mi_salon_ordenes
       set pago_id = coalesce(v_pago_id, pago_id),
           estado_mp = nullif(v_status, ''),
           metodo = coalesce(nullif(p_pago ->> 'payment_method_id', ''), metodo),
           tipo_metodo = coalesce(nullif(p_pago ->> 'payment_type_id', ''), tipo_metodo),
           referencia = coalesce(nullif(p_pago ->> 'referencia', ''), referencia),
           ticket_url = coalesce(nullif(p_pago ->> 'ticket_url', ''), ticket_url),
           pendiente_desde = case when v_status in ('pending', 'in_process', 'authorized')
                                  then coalesce(pendiente_desde, now()) else pendiente_desde end
     where orden_id = p_orden_id;
    return jsonb_build_object('ok', true,
      'estado', case when v_status in ('rejected', 'cancelled') then 'fallido' else 'pendiente' end,
      'docente_id', m.docente_id, 'producto', m.producto, 'nombre', v_nombre, 'monto', o.monto_total);
  end if;

  -- Aprobado: importe y moneda deben cuadrar con la orden
  v_monto := nullif(p_pago ->> 'transaction_amount', '')::numeric;
  if v_moneda <> 'MXN' or v_monto is null or v_monto + 0.01 < o.monto_total then
    update public.marketplace_ordenes set estado = 'pendiente', referencia_pago = coalesce(v_pago_id, referencia_pago) where id = p_orden_id;
    return jsonb_build_object('ok', false, 'estado', 'pendiente', 'docente_id', m.docente_id,
      'error', 'El importe o la moneda del pago no coinciden con la orden');
  end if;
  if v_pago_id is null then
    return jsonb_build_object('ok', false, 'estado', 'pendiente', 'error', 'Pago sin id');
  end if;

  -- "Hoy" = el día en que se aprobó el pago (hora del centro)
  begin
    v_fecha := ((nullif(p_pago ->> 'date_approved', '')::timestamptz) at time zone 'America/Mexico_City')::date;
  exception when others then
    v_fecha := null;
  end;
  v_fecha := coalesce(v_fecha, public.mi_salon_hoy());
  v_aprob := public.mi_salon_cobertura(m.producto, v_fecha);
  v_tardia := m.compra_tardia or (coalesce((v_aprob ->> 'disponible')::boolean, false) and coalesce((v_aprob ->> 'compra_tardia')::boolean, false));

  -- Cobertura final: la cotizada ∪ la del día de aprobación (por ciclo)
  with todos as (
    select e ->> 'ciclo' as ciclo, per as periodo
      from jsonb_array_elements(m.cobertura) e cross join lateral jsonb_array_elements_text(e -> 'periodos') per
    union
    select e ->> 'ciclo', per
      from jsonb_array_elements(case when coalesce((v_aprob ->> 'disponible')::boolean, false) then v_aprob -> 'cobertura' else '[]'::jsonb end) e
      cross join lateral jsonb_array_elements_text(e -> 'periodos') per
  )
  select jsonb_agg(jsonb_build_object('ciclo', t.ciclo, 'periodos', t.periodos) order by t.ciclo)
    into v_cob
    from (select ciclo, jsonb_agg(periodo order by periodo) as periodos from todos group by ciclo) t;

  -- ¿Agrega algo a lo que ya tenía? (para el panel: un pago que no agregó nada se revisa)
  select exists (
    select 1 from jsonb_array_elements(v_cob) e cross join lateral jsonb_array_elements_text(e -> 'periodos') per
     where not exists (select 1 from public.mi_salon_periodos_de(m.docente_id) t where t.ciclo = e ->> 'ciclo' and t.periodo = per))
    into v_agrego;

  v_vence_antes := public.mi_salon_vence_max(m.docente_id);
  select max(public.mi_salon_fin(a)) into v_fin_antes from public.mi_salon_accesos a where a.docente_id = m.docente_id;

  update public.marketplace_ordenes set estado = 'pagado', referencia_pago = v_pago_id where id = p_orden_id;

  -- Un acceso por ciclo; el monto va en el del ciclo de venta (el otro, sin monto, para no contarlo dos veces)
  for g in select e ->> 'ciclo' as ciclo, array(select jsonb_array_elements_text(e -> 'periodos')) as periodos
             from jsonb_array_elements(v_cob) e
  loop
    insert into public.mi_salon_accesos
      (docente_id, ciclo, periodos, origen, pago_id, precio_pagado, tipo_precio, producto, desde, notas)
    values (m.docente_id, g.ciclo, g.periodos, 'pago', v_pago_id,
            case when g.ciclo = m.ciclo then o.monto_total end, m.tipo_precio, m.producto, now(),
            'Mercado Pago, orden ' || p_orden_id::text)
    on conflict (pago_id, ciclo) where pago_id is not null do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  select max(x.vence), bool_or(x.ciclo is null) into v_vence, v_prov
    from jsonb_array_elements(v_cob) e
    cross join lateral jsonb_array_elements_text(e -> 'periodos') per(periodo)
    left join public.mi_salon_periodos x on x.ciclo = e ->> 'ciclo' and x.periodo = per.periodo;

  update public.mi_salon_ordenes
     set pago_id = v_pago_id, estado_mp = 'approved',
         metodo = coalesce(nullif(p_pago ->> 'payment_method_id', ''), metodo),
         tipo_metodo = coalesce(nullif(p_pago ->> 'payment_type_id', ''), tipo_metodo),
         aprobado_en = now(), cobertura_final = v_cob, vence_final = v_vence,
         provisional_final = coalesce(v_prov, false), agrego = v_agrego
   where orden_id = p_orden_id;

  return jsonb_build_object('ok', true, 'estado', 'pagado', 'accesos_creados', v_n,
    'docente_id', m.docente_id, 'producto', m.producto, 'nombre', v_nombre, 'monto', o.monto_total,
    'tipo_precio', m.tipo_precio, 'cobertura', v_cob, 'vence', public.mi_salon_vence_max(m.docente_id),
    'vence_compra', v_vence, 'vence_antes', v_vence_antes,
    'extendida', v_fin_antes is not null and v_fin_antes > now() and public.mi_salon_vence_max(m.docente_id) > v_vence_antes,
    'compra_tardia', v_tardia,
    'siguiente', case when v_tardia then (
        select jsonb_build_object('ciclo', e ->> 'ciclo', 'periodo', per)
          from jsonb_array_elements(v_cob) e cross join lateral jsonb_array_elements_text(e -> 'periodos') per
         order by e ->> 'ciclo' desc, per desc limit 1) end,
    'provisional', coalesce(v_prov, false), 'agrego', v_agrego);
end $$;
revoke all on function public.mi_salon_aplicar_pago(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mi_salon_aplicar_pago(uuid, jsonb) to service_role;
