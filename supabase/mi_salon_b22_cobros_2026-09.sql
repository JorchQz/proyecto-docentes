-- =============================================================================
-- Mi Salón b22: precios, precio fundador, cobertura de cada compra, cobro con Mercado Pago,
-- avisos y panel de cobros
-- (spec de Jorge "jissez-spec-mi-salon-cobros", 2026-09-26: secciones 3, 5.2, 6, 7 y 8)
-- =============================================================================
--
-- ADITIVA: crea tablas y funciones nuevas, agrega dos columnas a jissez_config y reemplaza
-- (create or replace) tres funciones existentes SIN cambiar su resultado para lo que ya había:
--   - marketplace_promocion_aplica(ambito): el ámbito nuevo 'mi_salon' nunca lleva la oferta
--     general de la tienda (los demás ámbitos devuelven lo mismo que antes);
--   - mi_salon_estado_de(uid) (b21): agrega las llaves 'pago_pendiente' y 'aviso' (las demás,
--     iguales);
--   - admin_listar_ordenes() y admin_estado_cuenta_cupon(): el detalle de una orden de Mi Salón
--     (que no tiene renglones en marketplace_orden_items) dice "Mi Salón — ..."; el de las
--     órdenes de la tienda sale idéntico.
-- Idempotente (se puede volver a correr). Requiere b21 (mi_salon_periodos, mi_salon_accesos,
-- jissez_config, mi_salon_correos).
--
-- Decisión de Jorge (2026-09-26): NO hay prueba de 14 días. Una cuenta creada desde el
-- 19-dic-2026 no tiene acceso hasta que compra (b21 ya no le da nada).
--
-- Qué hace:
--   1. jissez_config: cupo de precio fundador (100 por omisión) y la fecha de corte de los
--      compradores de la tienda (sin fecha: la del lanzamiento, mi_salon_abierto_desde).
--   2. mi_salon_precios (ciclo, producto, precio_lista, precio_fundador, activo,
--      vende_hasta_periodo): Trimestre $199/$299, Resto del ciclo $399/$549 (se vende hasta el
--      registro del T2) y Ciclo completo $549/$749 (inactivo en 2026-2027). El producto
--      'paquete_tienda' (planeaciones + Mi Salón, spec 3.1) cabe en el modelo pero no se vende.
--   3. mi_salon_ordenes: la parte de Mi Salón de una orden de marketplace_ordenes (una orden de
--      Mi Salón NO tiene renglones en marketplace_orden_items). Así los cupones de la tienda
--      (usos, "uno por cliente", tope de comisión, estado de cuenta del creador) cuentan igual
--      las ventas de Mi Salón sin tocar su lógica.
--   4. Cobertura de una compra (spec 5.2): mi_salon_periodo_de_venta(fecha) y
--      mi_salon_cobertura(producto, fecha).
--   5. Precio: fundador (cupo, comprador de la tienda o ya fundador en el ciclo), cupón sobre
--      el precio de lista (marketplace_cupon_evaluar con el ámbito 'mi_salon') y el más bajo de
--      los dos, sin sumarlos: mi_salon_cotizar_de(uid, producto, cupón, fecha).
--   6. Registrar la orden (Edge comprar-mi-salon) y aplicar el pago (webhook, idempotente con
--      el índice único (pago_id, ciclo) de mi_salon_accesos).
--   7. Avisos (spec 7): mi_salon_avisos (calendario editable, fechas relativas a la tabla de
--      periodos, sin fechas en el código) y lo que lee la Edge avisos-mi-salon (cron).
--   8. Estado para la app: pago pendiente (OXXO con su referencia) y el aviso del día.
--   9. Panel: precios, cupo fundador, pagos, métricas y listas de WhatsApp por segmento.
--
-- 10. delete_own_account: la versión FINAL (§13). ORDEN: va AL FINAL del orden de producción
--     (interes, b16, b17, b18, b18a, b19, b19a, b20, b21, b22; b21b y b22_avisos_cron aparte).
--
-- Decisiones de Jorge (2026-09-26) sobre cobros: los compradores de la tienda con precio fundador
-- NO ocupan lugar del cupo; en empate entre cupón y fundador gana el cupón; no se vende lo que no
-- agrega periodos (la página lo explica).
--
-- Orden de despliegue: esta migración ANTES que las Edge Functions y el frontend.
-- =============================================================================


-- ── 1. Configuración del precio fundador ─────────────────────────────────────
alter table public.jissez_config
  add column if not exists mi_salon_cupo_fundador integer not null default 100,
  add column if not exists mi_salon_fundador_tienda_hasta timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jissez_config_cupo_fundador_valido') then
    alter table public.jissez_config add constraint jissez_config_cupo_fundador_valido
      check (mi_salon_cupo_fundador between 0 and 100000);
  end if;
end $$;
comment on column public.jissez_config.mi_salon_cupo_fundador is
  'Cupo de precio fundador de Mi Salón (spec 3.2): los primeros N docentes con pago aprobado a precio fundador, por ciclo. Lo cambia el admin (admin_mi_salon_guardar_fundador).';
comment on column public.jissez_config.mi_salon_fundador_tienda_hasta is
  'Corte de "comprador de la tienda" (precio fundador aunque el cupo esté lleno): compras aprobadas antes de esta fecha. Sin fecha: mi_salon_abierto_desde (el lanzamiento); sin lanzamiento, cualquier compra.';


-- ── 2. Precios ───────────────────────────────────────────────────────────────
create table if not exists public.mi_salon_precios (
  ciclo text not null check (ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
  producto text not null check (producto in ('trimestre', 'resto_ciclo', 'ciclo', 'paquete_tienda')),
  nombre text not null,
  descripcion text,
  precio_lista numeric(10, 2) not null check (precio_lista > 0),
  precio_fundador numeric(10, 2),
  activo boolean not null default true,
  -- Se vende hasta el registro de calificaciones de este periodo del ciclo (inclusive).
  -- null: mientras exista un periodo de venta (Trimestre).
  vende_hasta_periodo text check (vende_hasta_periodo in ('T1', 'T2', 'T3')),
  orden smallint not null default 1,
  actualizado_en timestamptz not null default now(),
  primary key (ciclo, producto),
  constraint mi_salon_precios_fundador_valido check (
    precio_fundador is null or (precio_fundador > 0 and precio_fundador <= precio_lista))
);

alter table public.mi_salon_precios enable row level security;
drop policy if exists mi_salon_precios_leer on public.mi_salon_precios;
create policy mi_salon_precios_leer on public.mi_salon_precios
  for select to anon, authenticated using (true);
drop policy if exists mi_salon_precios_admin on public.mi_salon_precios;
create policy mi_salon_precios_admin on public.mi_salon_precios
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant select on public.mi_salon_precios to anon, authenticated;
grant insert, update, delete on public.mi_salon_precios to authenticated;

create or replace function public.mi_salon_precios_sello()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists mi_salon_precios_sello on public.mi_salon_precios;
create trigger mi_salon_precios_sello before update on public.mi_salon_precios
  for each row execute function public.mi_salon_precios_sello();

comment on table public.mi_salon_precios is
  'Precios de Mi Salón por ciclo (spec 3.1). Editables desde el panel (solo es_admin). Resto del ciclo se vende hasta el registro del periodo vende_hasta_periodo; el Ciclo completo no se vende en 2026-2027 (T1 gratis). paquete_tienda: reservado para el ciclo 2027-2028, no se vende todavía.';

-- 2026-2027 (spec 3.1). Si ya estaban, no se pisa lo que el admin corrigió.
insert into public.mi_salon_precios
  (ciclo, producto, nombre, descripcion, precio_lista, precio_fundador, activo, vende_hasta_periodo, orden)
values
  ('2026-2027', 'trimestre', 'Trimestre',
   'Tu trimestre completo, hasta después de la entrega de boletas.', 299, 199, true, null, 1),
  ('2026-2027', 'resto_ciclo', 'Resto del ciclo',
   'Del trimestre en curso hasta el final del ciclo escolar.', 549, 399, true, 'T2', 2),
  ('2026-2027', 'ciclo', 'Ciclo completo',
   'Los tres trimestres del ciclo escolar.', 749, 549, false, 'T1', 3)
on conflict (ciclo, producto) do nothing;


-- ── 3. Órdenes de Mi Salón ─────────────────────────────────────────────────────
create table if not exists public.mi_salon_ordenes (
  orden_id uuid primary key references public.marketplace_ordenes(id) on delete cascade,
  docente_id uuid not null references auth.users(id) on delete cascade,
  producto text not null,
  -- Al cotizar: periodo de venta (P), cobertura y vencimiento que vio la docente
  ciclo text not null,
  periodo text not null,
  cobertura jsonb not null,
  vence_cotizado date,
  compra_tardia boolean not null default false,
  provisional boolean not null default false,
  precio_lista numeric(10, 2) not null,
  precio_fundador numeric(10, 2),
  tipo_precio text not null check (tipo_precio in ('fundador', 'lista', 'cupon')),
  motivo_fundador text check (motivo_fundador in ('cupo', 'tienda', 'previo')),
  -- El pago (lo llena el webhook)
  pago_id text,
  estado_mp text,
  metodo text,
  tipo_metodo text,
  referencia text,
  ticket_url text,
  pendiente_desde timestamptz,
  aprobado_en timestamptz,
  cobertura_final jsonb,
  vence_final date,
  provisional_final boolean,
  agrego boolean,
  creado_en timestamptz not null default now()
);
create index if not exists mi_salon_ordenes_docente on public.mi_salon_ordenes (docente_id);

alter table public.mi_salon_ordenes enable row level security;
drop policy if exists mi_salon_ordenes_leer on public.mi_salon_ordenes;
create policy mi_salon_ordenes_leer on public.mi_salon_ordenes
  for select to authenticated using (docente_id = auth.uid() or public.es_admin());
-- Sin escritura desde el cliente: la hacen mi_salon_registrar_orden y mi_salon_aplicar_pago
-- (service role, desde las Edge Functions)
revoke insert, update, delete on public.mi_salon_ordenes from anon, authenticated;
grant select on public.mi_salon_ordenes to authenticated;

comment on table public.mi_salon_ordenes is
  'Parte de Mi Salón de una orden de marketplace_ordenes (b22). La orden (monto, estado, cupón, pago) vive en marketplace_ordenes como las de la tienda; aquí van el producto, la cobertura cotizada y la del pago aprobado, el tipo de precio y los datos del pago pendiente (OXXO). Una orden de Mi Salón no tiene renglones en marketplace_orden_items.';


-- ── 4. Oferta general de la tienda: nunca en Mi Salón ─────────────────────────
-- Igual que marketplace_promocion_ambitos.sql, más el ámbito 'mi_salon' (siempre false): los
-- precios de Mi Salón son los de su tabla; el cupón se aplica sobre el precio de lista.
create or replace function public.marketplace_promocion_aplica(p_ambito text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_ambito = 'mi_salon' then false else coalesce((
    select case coalesce(p_ambito, 'paquete')
             when 'proyecto'      then p.aplica_proyectos
             when 'personalizado' then p.aplica_personalizados
             else p.aplica_paquetes
           end
    from marketplace_promocion p where p.id), false) end;
$$;
revoke all on function public.marketplace_promocion_aplica(text) from public, anon;


-- ── 5. Cobertura de una compra (spec 5.2) ────────────────────────────────────────
create or replace function public.mi_salon_hoy()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Mexico_City')::date;
$$;

-- ¿Quién llama es de confianza? El service role (Edge Functions) o una conexión directa a la
-- base sin JWT (editor SQL, migraciones). Dentro de una función security definer current_user
-- es el dueño, así que se mira el JWT de la petición: PostgREST siempre lo pone (anon,
-- authenticated o service_role).
create or replace function public.mi_salon_confiable()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role'
      or nullif(current_setting('request.jwt.claims', true), '') is null;
$$;
revoke all on function public.mi_salon_confiable() from public, anon, authenticated;

-- '2026-2027' → '2027-2028'
create or replace function public.mi_salon_ciclo_siguiente(p_ciclo text)
returns text language sql immutable set search_path = '' as $$
  select (split_part(p_ciclo, '-', 1)::int + 1)::text || '-' || (split_part(p_ciclo, '-', 2)::int + 1)::text;
$$;

/*
  P: el periodo cuya ventana de venta contiene la fecha (venta_desde ≤ fecha < venta_desde del
  siguiente periodo CARGADO). El último periodo cargado no tiene fin de ventana.
*/
create or replace function public.mi_salon_periodo_de_venta(p_fecha date)
returns setof public.mi_salon_periodos language sql stable set search_path = public as $$
  select x.ciclo, x.periodo, x.orden, x.venta_desde, x.compra_tardia_desde, x.registro_calificaciones,
         x.boletas_fin, x.vence, x.actualizado_en
    from (select p.*, lead(p.venta_desde) over (order by p.ciclo, p.orden) as sig
            from public.mi_salon_periodos p) x
   where x.venta_desde <= p_fecha and (x.sig is null or p_fecha < x.sig)
   order by x.ciclo desc, x.orden desc
   limit 1;
$$;

/*
  Qué cubre comprar `p_producto` en la fecha `p_fecha` (spec 5.2). Sin datos de la cuenta.
    Trimestre: P; si fecha ≥ P.compra_tardia_desde, también el siguiente (el T1 del ciclo que
               sigue si P es el T3: aunque ese ciclo no esté cargado, se cubre; mientras no se
               cargue, el acceso vence provisionalmente con P y se extiende solo al cargarlo).
    Resto del ciclo: de P al T3 del ciclo de P.
    Ciclo completo: T1, T2 y T3 del ciclo de P.
  El producto debe estar activo en mi_salon_precios para el ciclo de P y, si tiene
  vende_hasta_periodo, la fecha no pasa del registro de calificaciones de ese periodo.
  → { disponible, motivo?, producto, nombre, ciclo, periodo, fecha, compra_tardia_desde, cobertura: [{ciclo, periodos}],
      compra_tardia, siguiente: {ciclo, periodo, cargado} | null, vence, provisional,
      precio_lista, precio_fundador, vende_hasta }
*/
create or replace function public.mi_salon_cobertura(p_producto text, p_fecha date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  P public.mi_salon_periodos%rowtype;
  pr public.mi_salon_precios%rowtype;
  v_hasta date;
  v_sig_ciclo text;
  v_sig_periodo text;
  v_sig_cargado boolean;
  v_tardia boolean := false;
  v_cob jsonb;
  v_vence date;
  v_prov boolean;
  v_base jsonb;
begin
  select * into P from public.mi_salon_periodo_de_venta(p_fecha);
  if P.ciclo is null then
    return jsonb_build_object('disponible', false, 'motivo', 'sin_periodo', 'producto', p_producto, 'fecha', p_fecha);
  end if;
  -- compra_tardia_desde: la página explica una opción que hoy no agrega nada ("desde el 23 de
  -- octubre esta compra incluye también el segundo trimestre")
  v_base := jsonb_build_object('producto', p_producto, 'ciclo', P.ciclo, 'periodo', P.periodo, 'fecha', p_fecha,
    'compra_tardia_desde', P.compra_tardia_desde);
  select * into pr from public.mi_salon_precios where ciclo = P.ciclo and producto = p_producto;
  if pr.ciclo is null or not pr.activo or p_producto = 'paquete_tienda' then
    return v_base || jsonb_build_object('disponible', false, 'motivo', 'no_se_vende');
  end if;
  v_base := v_base || jsonb_build_object('nombre', pr.nombre, 'precio_lista', pr.precio_lista,
    'precio_fundador', pr.precio_fundador);
  if pr.vende_hasta_periodo is not null then
    select x.registro_calificaciones into v_hasta from public.mi_salon_periodos x
     where x.ciclo = P.ciclo and x.periodo = pr.vende_hasta_periodo;
    if v_hasta is null or p_fecha > v_hasta then
      return v_base || jsonb_build_object('disponible', false, 'motivo', 'fuera_de_venta', 'vende_hasta', v_hasta);
    end if;
  end if;

  if P.orden < 3 then
    v_sig_ciclo := P.ciclo;
    v_sig_periodo := 'T' || (P.orden + 1);
  else
    v_sig_ciclo := public.mi_salon_ciclo_siguiente(P.ciclo);
    v_sig_periodo := 'T1';
  end if;
  v_sig_cargado := exists (select 1 from public.mi_salon_periodos x where x.ciclo = v_sig_ciclo and x.periodo = v_sig_periodo);
  -- Pasó el vencimiento de P y no hay calendario para lo que sigue: no hay qué vender todavía
  if p_fecha > P.vence and not v_sig_cargado then
    return v_base || jsonb_build_object('disponible', false, 'motivo', 'sin_calendario');
  end if;

  if p_producto = 'trimestre' then
    v_tardia := p_fecha >= P.compra_tardia_desde;
    if not v_tardia then
      v_cob := jsonb_build_array(jsonb_build_object('ciclo', P.ciclo, 'periodos', jsonb_build_array(P.periodo)));
    elsif v_sig_ciclo = P.ciclo then
      v_cob := jsonb_build_array(jsonb_build_object('ciclo', P.ciclo, 'periodos', jsonb_build_array(P.periodo, v_sig_periodo)));
    else
      v_cob := jsonb_build_array(
        jsonb_build_object('ciclo', P.ciclo, 'periodos', jsonb_build_array(P.periodo)),
        jsonb_build_object('ciclo', v_sig_ciclo, 'periodos', jsonb_build_array(v_sig_periodo)));
    end if;
  elsif p_producto = 'resto_ciclo' then
    select jsonb_build_array(jsonb_build_object('ciclo', P.ciclo, 'periodos', jsonb_agg(x.periodo order by x.orden)))
      into v_cob from public.mi_salon_periodos x where x.ciclo = P.ciclo and x.orden >= P.orden;
  else -- ciclo
    select jsonb_build_array(jsonb_build_object('ciclo', P.ciclo, 'periodos', jsonb_agg(x.periodo order by x.orden)))
      into v_cob from public.mi_salon_periodos x where x.ciclo = P.ciclo;
  end if;

  select max(x.vence),
         bool_or(x.ciclo is null)
    into v_vence, v_prov
    from jsonb_array_elements(v_cob) e
    cross join lateral jsonb_array_elements_text(e -> 'periodos') per(periodo)
    left join public.mi_salon_periodos x on x.ciclo = e ->> 'ciclo' and x.periodo = per.periodo;

  return v_base || jsonb_build_object(
    'disponible', true,
    'cobertura', v_cob,
    'compra_tardia', v_tardia,
    'siguiente', case when v_tardia then jsonb_build_object('ciclo', v_sig_ciclo, 'periodo', v_sig_periodo, 'cargado', v_sig_cargado) end,
    'vence', v_vence,
    'provisional', coalesce(v_prov, false),
    'vende_hasta', v_hasta);
end $$;
grant execute on function public.mi_salon_cobertura(text, date) to anon, authenticated;


-- ── 6. Precio: fundador, cupón y el más bajo ─────────────────────────────────────
-- ¿Compró planeaciones en la tienda antes del corte? (orden pagada que NO es de Mi Salón y
-- con algún renglón que no sea el producto de prueba)
create or replace function public.mi_salon_comprador_tienda(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.marketplace_ordenes o
      cross join (select coalesce(c.mi_salon_fundador_tienda_hasta, c.mi_salon_abierto_desde, 'infinity'::timestamptz) as corte
                    from public.jissez_config c where c.id) k
     where o.user_id = p_uid
       and o.estado = 'pagado'
       and coalesce(o.pagado_en, o.created_at) < k.corte
       and not exists (select 1 from public.mi_salon_ordenes m where m.orden_id = o.id)
       and exists (select 1 from public.marketplace_orden_items i
                     left join public.marketplace_productos p on p.id = i.producto_id
                    where i.orden_id = o.id and (i.pedido_id is not null or coalesce(p.es_prueba, false) = false)));
$$;
revoke all on function public.mi_salon_comprador_tienda(uuid) from public, anon, authenticated;

/*
  Lugares de precio fundador de un ciclo = cupo − DOCENTES distintos con un pago aprobado
  (orden en 'pagado') a precio fundador en ese ciclo. Cuentan docentes y no pagos: quien ya pagó
  a precio fundador conserva el precio en sus compras siguientes del ciclo sin ocupar otro lugar
  (spec 3.2). Un reembolso libera el lugar (la orden deja de estar pagada).
  Decisión de Jorge (2026-09-26): los compradores de la tienda (motivo 'tienda') NO ocupan lugar:
  van aparte. "Quedan N lugares" solo baja con docentes que no compraron en la tienda y pagan a
  precio fundador (motivo 'cupo', o 'previo' en su compra siguiente).
*/
create or replace function public.mi_salon_fundador_usados(p_ciclo text)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct m.docente_id)::int
    from public.mi_salon_ordenes m
    join public.marketplace_ordenes o on o.id = m.orden_id
   where o.estado = 'pagado' and m.tipo_precio = 'fundador' and m.ciclo = p_ciclo
     and m.motivo_fundador is distinct from 'tienda';
$$;

create or replace function public.mi_salon_lugares_fundador(p_ciclo text)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select c.mi_salon_cupo_fundador from public.jissez_config c where c.id), 100)
                     - public.mi_salon_fundador_usados(p_ciclo));
$$;
grant execute on function public.mi_salon_lugares_fundador(text) to anon, authenticated;

-- ¿Tiene derecho a precio fundador en el ciclo? → 'tienda' | 'previo' | 'cupo' | null
-- La tienda va primero: un comprador de la tienda siempre es 'tienda' (también en su segunda
-- compra), así nunca ocupa un lugar del cupo (mi_salon_fundador_usados).
create or replace function public.mi_salon_motivo_fundador(p_uid uuid, p_ciclo text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if p_uid is not null and public.mi_salon_comprador_tienda(p_uid) then return 'tienda'; end if;
  if p_uid is not null and exists (
       select 1 from public.mi_salon_ordenes m join public.marketplace_ordenes o on o.id = m.orden_id
        where m.docente_id = p_uid and m.ciclo = p_ciclo and m.tipo_precio = 'fundador' and o.estado = 'pagado') then
    return 'previo';
  end if;
  if public.mi_salon_lugares_fundador(p_ciclo) > 0 then return 'cupo'; end if;
  return null;
end $$;
revoke all on function public.mi_salon_motivo_fundador(uuid, text) from public, anon, authenticated;

-- Periodos que la cuenta ya tiene (cualquier origen), para no vender lo que ya cubre
create or replace function public.mi_salon_periodos_de(p_uid uuid)
returns table (ciclo text, periodo text) language sql stable security definer set search_path = public as $$
  select distinct a.ciclo, per from public.mi_salon_accesos a cross join lateral unnest(a.periodos) per
   where a.docente_id = p_uid;
$$;
revoke all on function public.mi_salon_periodos_de(uuid) from public, anon, authenticated;

-- Vencimiento más tardío de TODOS los accesos de la cuenta (null si no tiene)
create or replace function public.mi_salon_vence_max(p_uid uuid)
returns date language sql stable security definer set search_path = public as $$
  select max(public.mi_salon_vence(a)) from public.mi_salon_accesos a where a.docente_id = p_uid;
$$;
revoke all on function public.mi_salon_vence_max(uuid) from public, anon, authenticated;

/*
  Cotización completa para una cuenta. La usan la página de compra (mi_salon_cotizar, con la
  sesión), la Edge comprar-mi-salon (al registrar la orden) y los avisos. El precio y la
  cobertura se calculan SIEMPRE aquí, nunca en el cliente.
    - Fundador si tiene derecho (mi_salon_motivo_fundador) y el producto tiene precio fundador.
    - Cupón de la tienda sobre el precio de LISTA (marketplace_cupon_evaluar, ámbito 'mi_salon':
      mismas reglas de vigencia, usos, "uno por cliente" y tope de comisión).
    - Se cobra el más bajo de los dos, sin sumarlos. Empate: gana el CUPÓN (decisión de Jorge del
      2026-09-26: así el creador cobra su comisión, que solo se paga si su cupón se aplicó).
    - No se vende lo que no agrega nada (todos los periodos ya los tiene): motivo 'ya_cubierto'.
  → mi_salon_cobertura(...) + { precio_final, tipo_precio, motivo_fundador, cupon: {...},
     cupon_codigo (el que se aplicó), cupon_referido, descuento, lugares_fundador,
     cupo_fundador, nuevos: [{ciclo, periodo}], agrega, vence_acceso }
*/
create or replace function public.mi_salon_cotizar_de(
  p_uid uuid, p_producto text, p_cupon text default null, p_fecha date default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_fecha date := coalesce(p_fecha, public.mi_salon_hoy());
  q jsonb;
  v_ciclo text;
  v_lista numeric;
  v_fund numeric;
  v_motivo text;
  r jsonb;
  v_cupon_precio numeric;
  v_final numeric;
  v_tipo text;
  v_codigo text;
  v_referido text;
  v_cupon_motivo text;
  v_cupon_msg text;
  v_nuevos jsonb;
  v_vence_max date;
begin
  if p_uid is distinct from auth.uid() and not public.es_admin() and not public.mi_salon_confiable() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  q := public.mi_salon_cobertura(p_producto, v_fecha);
  v_ciclo := q ->> 'ciclo';
  if v_ciclo is not null then
    q := q || jsonb_build_object('lugares_fundador', public.mi_salon_lugares_fundador(v_ciclo),
      'cupo_fundador', (select c.mi_salon_cupo_fundador from public.jissez_config c where c.id));
  end if;
  if not coalesce((q ->> 'disponible')::boolean, false) then return q; end if;

  v_lista := (q ->> 'precio_lista')::numeric;
  v_fund := (q ->> 'precio_fundador')::numeric;
  if v_fund is not null then v_motivo := public.mi_salon_motivo_fundador(p_uid, v_ciclo); end if;

  v_final := v_lista;
  v_tipo := 'lista';
  if v_motivo is not null then
    v_final := v_fund;
    v_tipo := 'fundador';
  end if;

  if nullif(btrim(coalesce(p_cupon, '')), '') is not null then
    r := public.marketplace_cupon_evaluar(p_cupon, v_lista, p_uid, 'mi_salon');
    v_cupon_motivo := r ->> 'motivo';
    v_cupon_msg := r ->> 'mensaje';
    if coalesce((r ->> 'aplicado')::boolean, false) then
      v_cupon_precio := (r ->> 'precio_final')::numeric;
      if v_cupon_precio < v_final or (v_cupon_precio = v_final and v_tipo = 'fundador') then
        v_final := v_cupon_precio;
        v_tipo := 'cupon';
        v_codigo := r ->> 'codigo';
      else
        v_cupon_motivo := 'fundador_mejor';
        v_cupon_msg := 'Tu precio fundador ya es más bajo que el de tu cupón. Te dejamos el más bajo y tu cupón sigue disponible para otra compra.';
      end if;
    end if;
    -- Cupón válido que no fue el que se aplicó: se atribuye al creador sin comisión
    if coalesce((r ->> 'valido')::boolean, false) and v_codigo is null then
      v_referido := r ->> 'codigo';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('ciclo', e ->> 'ciclo', 'periodo', per.periodo)), '[]'::jsonb)
    into v_nuevos
    from jsonb_array_elements(q -> 'cobertura') e
    cross join lateral jsonb_array_elements_text(e -> 'periodos') per(periodo)
   where not exists (select 1 from public.mi_salon_periodos_de(p_uid) t
                      where t.ciclo = e ->> 'ciclo' and t.periodo = per.periodo);
  v_vence_max := public.mi_salon_vence_max(p_uid);

  q := q || jsonb_build_object(
    'precio_final', v_final,
    'tipo_precio', v_tipo,
    'motivo_fundador', v_motivo,
    'cupon', case when r is null then null else jsonb_build_object(
        'codigo', r ->> 'codigo', 'valido', coalesce((r ->> 'valido')::boolean, false),
        'aplicado', v_tipo = 'cupon', 'motivo', v_cupon_motivo, 'mensaje', v_cupon_msg,
        'precio_cupon', v_cupon_precio) end,
    'cupon_codigo', v_codigo,
    'cupon_referido', v_referido,
    'descuento', v_lista - v_final,
    'nuevos', v_nuevos,
    'agrega', jsonb_array_length(v_nuevos) > 0,
    'vence_acceso', greatest(v_vence_max, (q ->> 'vence')::date));
  if jsonb_array_length(v_nuevos) = 0 then
    q := q || jsonb_build_object('disponible', false, 'motivo', 'ya_cubierto');
  end if;
  return q;
end $$;
revoke all on function public.mi_salon_cotizar_de(uuid, text, text, date) from public, anon;
grant execute on function public.mi_salon_cotizar_de(uuid, text, text, date) to authenticated, service_role;

-- Cotización de la cuenta con sesión (página de compra)
create or replace function public.mi_salon_cotizar(p_producto text, p_cupon text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null
              else public.mi_salon_cotizar_de(auth.uid(), p_producto, p_cupon, null) end;
$$;
revoke all on function public.mi_salon_cotizar(text, text) from public, anon;
grant execute on function public.mi_salon_cotizar(text, text) to authenticated;

-- ¿La venta está disponible para esta cuenta? Mi Salón abierto, o la cuenta ya ve Mi Salón
-- con el interruptor apagado (activo_saas o piloto: nunca el público).
create or replace function public.mi_salon_venta_abierta_para(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.mi_salon_abierto from public.jissez_config c where c.id), false)
      or coalesce((select p.activo_saas from public.perfiles p where p.id = p_uid), false)
      or exists (select 1 from public.mi_salon_accesos a where a.docente_id = p_uid and a.origen = 'piloto');
$$;
revoke all on function public.mi_salon_venta_abierta_para(uuid) from public, anon, authenticated;

-- Pago pendiente más reciente (OXXO, SPEI o en revisión) de la cuenta, o null
create or replace function public.mi_salon_pago_pendiente(p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('orden_id', m.orden_id, 'producto', m.producto, 'nombre', coalesce(pr.nombre, m.producto),
           'monto', o.monto_total, 'metodo', m.metodo, 'tipo_metodo', m.tipo_metodo, 'estado_mp', m.estado_mp,
           'referencia', m.referencia, 'ticket_url', m.ticket_url, 'desde', m.pendiente_desde,
           'vence_cotizado', m.vence_cotizado)
    from public.mi_salon_ordenes m
    join public.marketplace_ordenes o on o.id = m.orden_id
    left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto
   where m.docente_id = p_uid and o.estado = 'pendiente' and m.pago_id is not null
     and m.estado_mp in ('pending', 'in_process', 'authorized')
     and m.pendiente_desde > now() - interval '8 days'
   order by m.pendiente_desde desc
   limit 1;
$$;
revoke all on function public.mi_salon_pago_pendiente(uuid) from public, anon, authenticated;

/*
  Todo lo que necesita la página de compra, con la sesión: si la venta está abierta para la
  cuenta, su estado, el pago pendiente y la cotización de cada producto del ciclo de venta.
*/
create or replace function public.mi_salon_opciones(p_cupon text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  P public.mi_salon_periodos%rowtype;
  v_prod jsonb;
begin
  if v_uid is null then return null; end if;
  select * into P from public.mi_salon_periodo_de_venta(public.mi_salon_hoy());
  select coalesce(jsonb_agg(public.mi_salon_cotizar_de(v_uid, pr.producto, p_cupon, null) order by pr.orden), '[]'::jsonb)
    into v_prod
    from public.mi_salon_precios pr
   where pr.ciclo = P.ciclo and pr.activo and pr.producto <> 'paquete_tienda';
  return jsonb_build_object(
    'hoy', public.mi_salon_hoy(),
    'venta_abierta', public.mi_salon_venta_abierta_para(v_uid),
    'ciclo', P.ciclo,
    'periodo', P.periodo,
    'estado', public.mi_salon_estado_de(v_uid),
    'pendiente', public.mi_salon_pago_pendiente(v_uid),
    'lugares_fundador', case when P.ciclo is not null then public.mi_salon_lugares_fundador(P.ciclo) end,
    'productos', v_prod);
end $$;
revoke all on function public.mi_salon_opciones(text) from public, anon;
grant execute on function public.mi_salon_opciones(text) to authenticated;

/*
  Precios para la página de presentación (también sin sesión). Con Mi Salón apagado no dice
  nada ({ abierto: false }): la página sigue con "Precio por anunciar".
*/
create or replace function public.mi_salon_precios_publicos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
  P public.mi_salon_periodos%rowtype;
  v_hoy date := public.mi_salon_hoy();
begin
  select * into c from public.jissez_config where id;
  if not coalesce(c.mi_salon_abierto, false) then return jsonb_build_object('abierto', false); end if;
  select * into P from public.mi_salon_periodo_de_venta(v_hoy);
  if P.ciclo is null then return jsonb_build_object('abierto', true, 'productos', '[]'::jsonb); end if;
  return jsonb_build_object(
    'abierto', true,
    'ciclo', P.ciclo,
    'periodo', P.periodo,
    'lugares_fundador', public.mi_salon_lugares_fundador(P.ciclo),
    'cupo_fundador', c.mi_salon_cupo_fundador,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto', pr.producto, 'nombre', pr.nombre, 'descripcion', pr.descripcion,
               'precio_lista', pr.precio_lista, 'precio_fundador', pr.precio_fundador,
               'vende_ahora', coalesce((cb ->> 'disponible')::boolean, false),
               'vence', cb ->> 'vence', 'compra_tardia', coalesce((cb ->> 'compra_tardia')::boolean, false))
             order by pr.orden)
        from public.mi_salon_precios pr
        cross join lateral (select public.mi_salon_cobertura(pr.producto, v_hoy) as cb) k
       where pr.ciclo = P.ciclo and pr.activo and pr.producto <> 'paquete_tienda'), '[]'::jsonb));
end $$;
grant execute on function public.mi_salon_precios_publicos() to anon, authenticated;


-- ── 7. Registrar la orden (Edge comprar-mi-salon, service role) ───────────────────
/*
  Cotiza en el servidor y deja la orden lista para Mercado Pago:
    - reutiliza la orden pendiente SIN pago de la misma cuenta, producto, ciclo, importe y
      cupón (así un doble clic no deja órdenes huérfanas y la preferencia de MP, atada al id de
      la orden, es la misma);
    - si la cuenta tiene un pago pendiente (OXXO por pagar) y no pidió uno nuevo, avisa
      (motivo 'pago_pendiente') en lugar de cobrarle dos veces;
    - si no, crea marketplace_ordenes (monto, cupón aplicado, atribución, términos) y su fila de
      mi_salon_ordenes con la cotización.
  → { ok, orden_id, precio, titulo, cupon, cupon_motivo, cotizacion } o { ok: false, motivo, ... }
*/
create or replace function public.mi_salon_registrar_orden(
  p_uid uuid, p_producto text, p_cupon text default null, p_terminos_en timestamptz default null,
  p_nuevo boolean default false, p_fecha date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q jsonb;
  v_orden uuid;
  v_precio numeric;
  v_pend jsonb;
  v_titulo text;
begin
  if not public.mi_salon_confiable() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_uid is null then raise exception 'Falta la cuenta' using errcode = '22023'; end if;
  if not public.mi_salon_venta_abierta_para(p_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'cerrada',
      'error', 'La compra de Mi Salón todavía no está disponible.');
  end if;
  q := public.mi_salon_cotizar_de(p_uid, p_producto, p_cupon, p_fecha);
  if not coalesce((q ->> 'disponible')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', q ->> 'motivo', 'cotizacion', q,
      'error', case q ->> 'motivo'
        when 'ya_cubierto' then 'Ya tienes acceso a esos periodos. Esta compra no agregaría nada.'
        when 'fuera_de_venta' then 'Esta opción ya no está a la venta. Elige otra.'
        else 'Esta opción no está disponible por ahora.' end);
  end if;
  v_pend := public.mi_salon_pago_pendiente(p_uid);
  if v_pend is not null and not coalesce(p_nuevo, false) then
    return jsonb_build_object('ok', false, 'motivo', 'pago_pendiente', 'pendiente', v_pend, 'cotizacion', q,
      'error', 'Tienes un pago pendiente de Mi Salón. Si ya pagaste, en cuanto se acredite tu acceso se activa solo.');
  end if;
  v_precio := (q ->> 'precio_final')::numeric;

  select m.orden_id into v_orden
    from public.mi_salon_ordenes m
    join public.marketplace_ordenes o on o.id = m.orden_id
   where m.docente_id = p_uid and o.estado = 'pendiente' and m.pago_id is null
     and m.producto = p_producto and m.ciclo = q ->> 'ciclo' and m.periodo = q ->> 'periodo'
     and m.cobertura = q -> 'cobertura' and m.tipo_precio = q ->> 'tipo_precio'
     and o.monto_total = v_precio and o.cupon_codigo is not distinct from (q ->> 'cupon_codigo')
     and o.created_at > now() - interval '6 days'
   order by o.created_at desc
   limit 1;

  if v_orden is null then
    insert into public.marketplace_ordenes
      (user_id, monto_total, estado, metodo_pago, cupon_codigo, descuento_aplicado, cupon_referido, terminos_aceptados_en)
    values (p_uid, v_precio, 'pendiente', 'mercadopago', q ->> 'cupon_codigo', (q ->> 'descuento')::numeric,
            q ->> 'cupon_referido', p_terminos_en)
    returning id into v_orden;
    insert into public.mi_salon_ordenes
      (orden_id, docente_id, producto, ciclo, periodo, cobertura, vence_cotizado, compra_tardia, provisional,
       precio_lista, precio_fundador, tipo_precio, motivo_fundador)
    values (v_orden, p_uid, p_producto, q ->> 'ciclo', q ->> 'periodo', q -> 'cobertura', (q ->> 'vence')::date,
            coalesce((q ->> 'compra_tardia')::boolean, false), coalesce((q ->> 'provisional')::boolean, false),
            (q ->> 'precio_lista')::numeric, (q ->> 'precio_fundador')::numeric, q ->> 'tipo_precio',
            case when q ->> 'tipo_precio' = 'fundador' then q ->> 'motivo_fundador' end);
  else
    update public.marketplace_ordenes
       set cupon_referido = q ->> 'cupon_referido',
           terminos_aceptados_en = coalesce(terminos_aceptados_en, p_terminos_en)
     where id = v_orden;
  end if;

  -- Intentos de Mi Salón abandonados de la cuenta (más de 8 días): ya no se pueden cobrar
  update public.marketplace_ordenes o set estado = 'fallido'
   where o.user_id = p_uid and o.estado = 'pendiente' and o.id <> v_orden
     and o.created_at < now() - interval '8 days'
     and exists (select 1 from public.mi_salon_ordenes m where m.orden_id = o.id);

  v_titulo := 'Mi Salón — ' || coalesce(q ->> 'nombre', p_producto) || ' (' ||
    (select string_agg((select case when count(*) = 1 then min(per)
                                    else string_agg(per, ', ' order by per) filter (where per < max_per.m) || ' y ' || max(per) end
                          from jsonb_array_elements_text(e -> 'periodos') per
                          cross join (select max(x) as m from jsonb_array_elements_text(e -> 'periodos') x) max_per)
                       || ' del ciclo ' || (e ->> 'ciclo'), ' y ')
       from jsonb_array_elements(q -> 'cobertura') e) || ')';

  return jsonb_build_object('ok', true, 'orden_id', v_orden, 'precio', v_precio, 'titulo', v_titulo,
    'cupon', q ->> 'cupon_codigo', 'cupon_motivo', q -> 'cupon' ->> 'motivo', 'cotizacion', q);
end $$;
revoke all on function public.mi_salon_registrar_orden(uuid, text, text, timestamptz, boolean, date) from public, anon, authenticated;
grant execute on function public.mi_salon_registrar_orden(uuid, text, text, timestamptz, boolean, date) to service_role;


-- ── 8. Aplicar el pago (webhook y verificación, service role) ─────────────────────
/*
  Aplica un pago de Mercado Pago a una orden de Mi Salón. IDEMPOTENTE: el mismo pago (o el
  webhook repetido) nunca crea dos accesos (la orden se bloquea FOR UPDATE, se revisa si ya está
  pagada y el insert usa el índice único (pago_id, ciclo)).
  p_pago: { id, status, status_detail, transaction_amount, currency_id, date_approved,
            payment_method_id, payment_type_id, referencia, ticket_url }
    approved              → valida importe y moneda; cobertura = la cotizada ∪ la del día en que
                            se aprobó (spec 5.2: "hoy" es la fecha del pago aprobado; si la
                            docente cotizó otra cosa, conserva lo que vio); crea un acceso 'pago'
                            por ciclo (el monto va en el del ciclo de venta), SUMADO a lo que ya
                            tenga. La fecha de aprobación es la que da la API de Mercado Pago
                            (el webhook la reconsulta; nunca viene del cliente).
    pending / in_process  → "Pago pendiente" con la referencia (OXXO) y desde cuándo
    rejected / cancelled  → orden fallida
    refunded / charged_back → orden reembolsada y se quitan los accesos de ESE pago (los datos
                            nunca se borran; si no le queda otro acceso, solo lectura)
  → { ok, estado, ya_procesada?, accesos_creados, vence, vence_antes, extendida, compra_tardia,
      provisional, cobertura, producto, nombre, monto, docente_id, agrego, error? }
*/
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

  -- Ya pagada Y aplicada: no se repite nada (webhook repetido, verificación manual después del
  -- webhook). Una orden 'pagado' SIN aprobado_en nunca se aplicó (R27b: el webhook la mandó por el
  -- camino de la tienda tras una falla pasajera) y se aplica ahora; el índice único (pago_id, ciclo)
  -- y aprobado_en, que se pone abajo, mantienen la idempotencia.
  if o.estado = 'pagado' and m.aprobado_en is not null then
    return jsonb_build_object('ok', true, 'estado', 'pagado', 'ya_procesada', true, 'accesos_creados', 0,
      'vence', public.mi_salon_vence_max(m.docente_id), 'docente_id', m.docente_id, 'producto', m.producto,
      'nombre', v_nombre, 'monto', o.monto_total);
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

-- ¿La orden es de Mi Salón? (el webhook decide el camino con esto)
create or replace function public.mi_salon_es_orden(p_orden_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mi_salon_ordenes where orden_id = p_orden_id);
$$;
revoke all on function public.mi_salon_es_orden(uuid) from public, anon, authenticated;
grant execute on function public.mi_salon_es_orden(uuid) to service_role;


-- ── 9. Avisos (spec 7) ───────────────────────────────────────────────────────────
/*
  Calendario de avisos, editable. La fecha de cada aviso es RELATIVA a la tabla de periodos:
    audiencia 'gratis_vigentes'    cuentas con el acceso gratis del periodo gratis y acceso
                                   vigente; fecha = <referencia> del periodo gratis + dias
    audiencia 'gratis_sin_renovar' cuentas con el acceso gratis cuyo acceso más tardío sigue
                                   siendo el del periodo gratis (no han comprado)
    audiencia 'pago'               cuentas cuyo acceso más tardío viene de un pago; fecha =
                                   ese vencimiento + dias (no a un pago provisional de un ciclo
                                   sin cargar: su fecha aún no es la final)
  Textos con {vence} ("18 de diciembre"), {vence_dia} ("viernes 18"), {registro},
  {precio_trimestre}, {precio_resto} y {precio_nota} (" (precio fundador)" o nada), según la
  cuenta. correo: se manda por correo (Edge avisos-mi-salon, una vez por cuenta y aviso);
  en_app: banner en Inicio y aviso en Mi cuenta durante dias_en_app días desde la fecha.
*/
create table if not exists public.mi_salon_avisos (
  clave text primary key,
  audiencia text not null check (audiencia in ('gratis_vigentes', 'gratis_sin_renovar', 'pago')),
  referencia text not null check (referencia in ('registro_calificaciones', 'vence')),
  dias integer not null,
  asunto text not null,
  texto text not null,
  boton_texto text,
  boton_ruta text,
  correo boolean not null default true,
  en_app boolean not null default true,
  dias_en_app integer not null default 7 check (dias_en_app between 1 and 60),
  activo boolean not null default true,
  orden smallint not null default 1,
  constraint mi_salon_avisos_pago_vence check (audiencia <> 'pago' or referencia = 'vence')
);
alter table public.mi_salon_avisos enable row level security;
drop policy if exists mi_salon_avisos_admin on public.mi_salon_avisos;
create policy mi_salon_avisos_admin on public.mi_salon_avisos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.mi_salon_avisos to authenticated;
comment on table public.mi_salon_avisos is
  'Calendario de avisos de Mi Salón (spec 7): fechas relativas a mi_salon_periodos (nunca fechas en el código). Lo usan el estado de la app (banner) y la Edge avisos-mi-salon (correo, cron).';

insert into public.mi_salon_avisos
  (clave, audiencia, referencia, dias, asunto, texto, boton_texto, boton_ruta, correo, en_app, dias_en_app, orden)
values
  ('gratis_cierre', 'gratis_vigentes', 'registro_calificaciones', -7,
   'El {registro} es el registro de calificaciones',
   'El {registro} es el registro de calificaciones. Revisa en “Qué le falta” si algún alumno tiene pendientes.',
   'Entrar a Mi Salón', '/dashboard', true, true, 7, 1),
  ('gratis_boleta', 'gratis_vigentes', 'registro_calificaciones', 0,
   'Tu boleta del primer trimestre ya está lista',
   'Tu boleta del primer trimestre ya está lista. Revísala, imprímela o descarga el concentrado en Excel.',
   'Ver la boleta', '/reportes', true, true, 7, 2),
  ('gratis_precios', 'gratis_sin_renovar', 'vence', -18,
   'Cómo seguir en Mi Salón en el segundo trimestre',
   'Tu acceso gratis termina el {vence}. Para seguir en el segundo trimestre: {precio_trimestre} el trimestre o {precio_resto} el resto del ciclo{precio_nota}.',
   'Ver opciones', '/tienda/mi-salon-compra', true, true, 11, 3),
  ('gratis_7', 'gratis_sin_renovar', 'vence', -7,
   'Tu acceso gratis termina el {vence_dia}',
   'Tu acceso gratis termina el {vence_dia}. Tus datos se quedan guardados pase lo que pase.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, true, 6, 4),
  ('gratis_ultimo', 'gratis_sin_renovar', 'vence', -1,
   'Mañana termina tu acceso gratis',
   'Mañana termina tu acceso gratis. Después podrás ver e imprimir todo, pero no capturar.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, true, 2, 5),
  ('gratis_terminado', 'gratis_sin_renovar', 'vence', 1,
   'Tu acceso gratis terminó; tus datos están guardados',
   'Tu acceso gratis terminó. Tus datos están guardados. Cuando quieras seguir capturando, renueva desde Mi Salón.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, false, 1, 6),
  ('pago_21', 'pago', 'vence', -21,
   'Tu acceso a Mi Salón termina el {vence}',
   'Tu acceso a Mi Salón termina el {vence}. Si quieres seguir capturando después de esa fecha, puedes renovarlo cuando te acomode.',
   'Ver opciones', '/tienda/mi-salon-compra', true, true, 14, 7),
  ('pago_7', 'pago', 'vence', -7,
   'Tu acceso a Mi Salón termina el {vence_dia}',
   'Tu acceso a Mi Salón termina el {vence_dia}. Tus datos se quedan guardados pase lo que pase.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, true, 6, 8),
  ('pago_1', 'pago', 'vence', -1,
   'Mañana termina tu acceso a Mi Salón',
   'Mañana termina tu acceso a Mi Salón. Después podrás ver e imprimir todo, pero no capturar.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, true, 2, 9),
  ('pago_terminado', 'pago', 'vence', 1,
   'Tu acceso a Mi Salón terminó; tus datos están guardados',
   'Tu acceso a Mi Salón terminó. Tus datos están guardados. Cuando quieras seguir capturando, renueva desde Mi Salón.',
   'Renovar mi acceso', '/tienda/mi-salon-compra', true, false, 1, 10)
on conflict (clave) do nothing;

-- "18 de diciembre" / "viernes 18"
create or replace function public.mi_salon_fecha_texto(p_fecha date, p_dia_semana boolean default false)
returns text language sql immutable set search_path = '' as $$
  select case when p_fecha is null then ''
    when p_dia_semana then
      (array['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'])[extract(dow from p_fecha)::int + 1]
      || ' ' || extract(day from p_fecha)::int
    else extract(day from p_fecha)::int || ' de ' ||
      (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
             'octubre', 'noviembre', 'diciembre'])[extract(month from p_fecha)::int]
    end;
$$;

-- "$199" (sin centavos cuando es entero)
create or replace function public.mi_salon_pesos(p numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then '' when p = trunc(p) then '$' || to_char(p, 'FM999,999,990')
              else '$' || to_char(p, 'FM999,999,990.00') end;
$$;

-- Precio que pagaría la cuenta por un producto (fundador si tiene derecho, si no, de lista),
-- sin cupón y sin importar lo que ya tenga. → { precio, fundador } o null
create or replace function public.mi_salon_precio_docente(p_uid uuid, p_producto text, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cb jsonb := public.mi_salon_cobertura(p_producto, p_fecha);
  v_motivo text;
begin
  if cb ->> 'precio_lista' is null then return null; end if;
  if cb ->> 'precio_fundador' is not null then v_motivo := public.mi_salon_motivo_fundador(p_uid, cb ->> 'ciclo'); end if;
  return jsonb_build_object('precio', case when v_motivo is not null then (cb ->> 'precio_fundador')::numeric else (cb ->> 'precio_lista')::numeric end,
    'fundador', v_motivo is not null, 'vende_ahora', coalesce((cb ->> 'disponible')::boolean, false));
end $$;
revoke all on function public.mi_salon_precio_docente(uuid, text, date) from public, anon, authenticated;

-- Llena las variables de un texto de aviso para una cuenta
create or replace function public.mi_salon_aviso_llenar(p_texto text, p_uid uuid, p_vence date, p_registro date, p_hoy date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  t text := coalesce(p_texto, '');
  pt jsonb;
  pr jsonb;
begin
  t := replace(t, '{vence_dia}', public.mi_salon_fecha_texto(p_vence, true));
  t := replace(t, '{vence}', public.mi_salon_fecha_texto(p_vence));
  t := replace(t, '{registro}', public.mi_salon_fecha_texto(p_registro));
  if position('{precio' in t) > 0 then
    pt := public.mi_salon_precio_docente(p_uid, 'trimestre', p_hoy);
    pr := public.mi_salon_precio_docente(p_uid, 'resto_ciclo', p_hoy);
    t := replace(t, '{precio_trimestre}', public.mi_salon_pesos((pt ->> 'precio')::numeric));
    t := replace(t, '{precio_resto}', public.mi_salon_pesos((pr ->> 'precio')::numeric));
    t := replace(t, '{precio_nota}', case when coalesce((pt ->> 'fundador')::boolean, false) then ' (precio fundador)' else '' end);
  end if;
  return t;
end $$;
revoke all on function public.mi_salon_aviso_llenar(text, uuid, date, date, date) from public, anon, authenticated;

/*
  Avisos que le tocan a una cuenta y su fecha (sin filtrar por hoy): una fila por aviso activo
  de su audiencia. Los textos se llenan después (mi_salon_aviso_texto) solo para los que se van
  a mostrar o mandar.
*/
create or replace function public.mi_salon_avisos_fechas(p_uid uuid, p_hoy date)
returns table (clave text, fecha date, vence date, registro date, correo boolean, en_app boolean, dias_en_app integer)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
  G public.mi_salon_periodos%rowtype;
  v_gratis boolean;
  v_vig boolean;
  v_vmax date;
  v_pago boolean;
  v_prov boolean;
  a public.mi_salon_avisos%rowtype;
begin
  select * into c from public.jissez_config where id;
  select * into G from public.mi_salon_periodos x where x.ciclo = c.gratis_ciclo and x.periodo = c.gratis_periodo;
  v_gratis := exists (select 1 from public.mi_salon_accesos x where x.docente_id = p_uid and x.origen = 'gratis_t1' and x.ciclo = c.gratis_ciclo);
  v_vmax := public.mi_salon_vence_max(p_uid);
  v_vig := exists (select 1 from public.mi_salon_accesos x where x.docente_id = p_uid
                    and (x.desde at time zone 'America/Mexico_City')::date <= p_hoy and public.mi_salon_vence(x) >= p_hoy);
  v_pago := exists (select 1 from public.mi_salon_accesos x where x.docente_id = p_uid and x.origen = 'pago' and public.mi_salon_vence(x) = v_vmax);
  v_prov := exists (select 1 from public.mi_salon_accesos x where x.docente_id = p_uid and x.origen = 'pago' and public.mi_salon_vence(x) is null);
  for a in select * from public.mi_salon_avisos x where x.activo order by x.orden loop
    clave := a.clave; correo := a.correo; en_app := a.en_app; dias_en_app := a.dias_en_app; fecha := null;
    if a.audiencia = 'gratis_vigentes' and v_gratis and v_vig and G.ciclo is not null then
      vence := G.vence; registro := G.registro_calificaciones;
      fecha := case a.referencia when 'vence' then G.vence else G.registro_calificaciones end + a.dias;
    elsif a.audiencia = 'gratis_sin_renovar' and v_gratis and G.ciclo is not null and v_vmax = G.vence then
      vence := G.vence; registro := G.registro_calificaciones;
      fecha := case a.referencia when 'vence' then G.vence else G.registro_calificaciones end + a.dias;
    elsif a.audiencia = 'pago' and v_pago and not v_prov and v_vmax is not null then
      vence := v_vmax; registro := null;
      fecha := v_vmax + a.dias;
    end if;
    if fecha is not null then return next; end if;
  end loop;
end $$;
revoke all on function public.mi_salon_avisos_fechas(uuid, date) from public, anon, authenticated;

create or replace function public.mi_salon_aviso_texto(p_clave text, p_uid uuid, p_vence date, p_registro date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('clave', a.clave,
    'asunto', public.mi_salon_aviso_llenar(a.asunto, p_uid, p_vence, p_registro, p_hoy),
    'texto', public.mi_salon_aviso_llenar(a.texto, p_uid, p_vence, p_registro, p_hoy),
    'boton_texto', a.boton_texto, 'boton_ruta', a.boton_ruta)
    from public.mi_salon_avisos a where a.clave = p_clave;
$$;
revoke all on function public.mi_salon_aviso_texto(text, uuid, date, date, date) from public, anon, authenticated;

-- El aviso que la app muestra hoy (el más reciente dentro de su ventana), o null
create or replace function public.mi_salon_aviso_app(p_uid uuid, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, public.mi_salon_hoy());
  f record;
begin
  select * into f from public.mi_salon_avisos_fechas(p_uid, v_hoy) x
   where x.en_app and x.fecha <= v_hoy and v_hoy < x.fecha + x.dias_en_app
   order by x.fecha desc limit 1;
  if f.clave is null then return null; end if;
  return public.mi_salon_aviso_texto(f.clave, p_uid, f.vence, f.registro, v_hoy) || jsonb_build_object('fecha', f.fecha);
end $$;
revoke all on function public.mi_salon_aviso_app(uuid, date) from public, anon, authenticated;

/*
  Correos que tocan HOY (lo lee la Edge avisos-mi-salon, service role; y el admin para ver qué
  saldría). Solo con Mi Salón abierto. Cada fila trae la llave de idempotencia (tipo en
  mi_salon_correos): el cron se puede correr cada hora sin repetir nada.
    - avisos del calendario: fecha ≤ hoy ≤ fecha + 1 (si el cron no corrió un día, sale al
      siguiente; después ya no, para no mandar un "mañana termina" tarde)
    - pago pendiente en efectivo (OXXO) desde hace 24 h o más (hasta 7 días)
    - vigencia extendida: un pago que venció provisional (ciclo sin cargar) y ya se cargó
    - aviso de lanzamiento (decisión de Jorge, 2026-09-26): UNO por cuenta que ya existía al
      encender Mi Salón (creada antes de mi_salon_abierto_desde) y tiene el T1 gratis vigente;
      no a las del piloto ni a las que ya veían Mi Salón (activo_saas). Las cuentas nuevas
      reciben la bienvenida (b21), no este. Sale con el cron o con el botón del panel.
  p_solo: 'lanzamiento' → solo el aviso de lanzamiento (el botón del panel).
  → filas { docente_id, email, tipo, asunto, texto, boton_texto, boton_ruta, datos }
*/
drop function if exists public.mi_salon_correos_pendientes(date);
create or replace function public.mi_salon_correos_pendientes(p_hoy date default null, p_solo text default null)
returns table (docente_id uuid, email text, tipo text, asunto text, texto text, boton_texto text, boton_ruta text, datos jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, public.mi_salon_hoy());
  cfg public.jissez_config%rowtype;
  G public.mi_salon_periodos%rowtype;
  u record;
  f record;
  t jsonb;
begin
  if not public.es_admin() and not public.mi_salon_confiable() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into cfg from public.jissez_config where id;
  if not coalesce(cfg.mi_salon_abierto, false) then return; end if;

  -- Aviso de lanzamiento a las cuentas que ya existían
  select * into G from public.mi_salon_periodos x where x.ciclo = cfg.gratis_ciclo and x.periodo = cfg.gratis_periodo;
  if cfg.mi_salon_abierto_desde is not null and G.ciclo is not null and v_hoy <= G.vence then
    for u in select x.id, x.email::text as email from auth.users x
              where x.email is not null and x.email_confirmed_at is not null
                and x.created_at < cfg.mi_salon_abierto_desde
                and exists (select 1 from public.mi_salon_accesos a where a.docente_id = x.id and a.origen = 'gratis_t1' and a.ciclo = cfg.gratis_ciclo)
                and not exists (select 1 from public.mi_salon_accesos a where a.docente_id = x.id and a.origen = 'piloto')
                and not coalesce((select p.activo_saas from public.perfiles p where p.id = x.id), false)
                and not exists (select 1 from public.mi_salon_correos m where m.docente_id = x.id and m.tipo in ('lanzamiento', 'bienvenida'))
              order by x.created_at loop
      docente_id := u.id; email := u.email; tipo := 'lanzamiento';
      asunto := 'Mi Salón ya está disponible para ti';
      texto := 'Mi Salón, la app de Jissez para llevar el día a día de tu grupo (asistencia, trabajos y boleta), ya está disponible. '
        || 'Tu primer trimestre es gratis: tienes acceso completo hasta el ' || public.mi_salon_fecha_texto(G.vence)
        || ', sin tarjeta. Si ya llevas semanas de clases, empieza con “Ponte al día” para capturar lo que ya llevas.';
      boton_texto := 'Conocer Mi Salón'; boton_ruta := '/tienda/conoce-mi-salon';
      datos := jsonb_build_object('vence', G.vence);
      return next;
    end loop;
  end if;
  if p_solo = 'lanzamiento' then return; end if;

  for u in select x.id, x.email::text as email from auth.users x
            where x.email is not null and x.email_confirmed_at is not null
              and exists (select 1 from public.mi_salon_accesos a where a.docente_id = x.id) loop
    for f in select * from public.mi_salon_avisos_fechas(u.id, v_hoy) y
              where y.correo and y.fecha <= v_hoy and v_hoy <= y.fecha + 1 loop
      if exists (select 1 from public.mi_salon_correos m where m.docente_id = u.id and m.tipo = 'aviso:' || f.clave || ':' || f.fecha) then
        continue;
      end if;
      t := public.mi_salon_aviso_texto(f.clave, u.id, f.vence, f.registro, v_hoy);
      docente_id := u.id; email := u.email; tipo := 'aviso:' || f.clave || ':' || f.fecha;
      asunto := t ->> 'asunto'; texto := t ->> 'texto'; boton_texto := t ->> 'boton_texto'; boton_ruta := t ->> 'boton_ruta';
      datos := jsonb_build_object('clave', f.clave, 'fecha', f.fecha, 'vence', f.vence);
      return next;
    end loop;
  end loop;

  -- Pago en efectivo pendiente desde hace 24 horas o más
  for u in select m.orden_id, m.docente_id, x.email::text as email, o.monto_total, m.referencia, m.ticket_url, m.producto,
                  coalesce(pr.nombre, m.producto) as nombre
             from public.mi_salon_ordenes m
             join public.marketplace_ordenes o on o.id = m.orden_id
             join auth.users x on x.id = m.docente_id
             left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto
            where o.estado = 'pendiente' and m.estado_mp in ('pending', 'in_process') and m.tipo_metodo = 'ticket'
              and m.pendiente_desde <= now() - interval '24 hours' and m.pendiente_desde > now() - interval '7 days'
              and x.email is not null
              and not exists (select 1 from public.mi_salon_correos c where c.docente_id = m.docente_id and c.tipo = 'oxxo:' || m.orden_id) loop
    docente_id := u.docente_id; email := u.email; tipo := 'oxxo:' || u.orden_id;
    asunto := 'Tu pago de Mi Salón sigue pendiente';
    texto := 'Tu pago en efectivo de ' || public.mi_salon_pesos(u.monto_total) || ' para Mi Salón (' || u.nombre ||
      ') todavía no se refleja. Si ya pagaste, puede tardar unas horas; tu acceso se activa solo en cuanto se acredite.' ||
      case when u.referencia is not null then ' Tu referencia de pago es ' || u.referencia || '.' else '' end;
    boton_texto := case when u.ticket_url is not null then 'Ver mi ficha de pago' else 'Ver mi pago' end;
    boton_ruta := coalesce(u.ticket_url, '/tienda/mi-salon-compra');
    datos := jsonb_build_object('orden_id', u.orden_id, 'monto', u.monto_total, 'referencia', u.referencia);
    return next;
  end loop;

  -- Vigencia extendida: el pago cubría un periodo de un ciclo que no estaba cargado; ya se cargó
  for u in select m.orden_id, m.docente_id, x.email::text as email, m.pago_id, coalesce(pr.nombre, m.producto) as nombre
             from public.mi_salon_ordenes m
             join public.marketplace_ordenes o on o.id = m.orden_id
             join auth.users x on x.id = m.docente_id
             left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto
            where o.estado = 'pagado' and m.provisional_final and x.email is not null
              and not exists (select 1 from public.mi_salon_accesos a where a.pago_id = m.pago_id and public.mi_salon_vence(a) is null)
              and not exists (select 1 from public.mi_salon_correos c where c.docente_id = m.docente_id and c.tipo = 'extendida:' || m.orden_id) loop
    docente_id := u.docente_id; email := u.email; tipo := 'extendida:' || u.orden_id;
    asunto := 'Tu acceso a Mi Salón ya tiene su fecha nueva';
    texto := 'Ya está cargado el calendario del ciclo que sigue. Tu compra (' || u.nombre ||
      ') ahora es válida hasta el ' || public.mi_salon_fecha_texto(public.mi_salon_vence_max(u.docente_id)) || ' de ' ||
      extract(year from public.mi_salon_vence_max(u.docente_id))::int || '.';
    boton_texto := 'Entrar a Mi Salón'; boton_ruta := '/dashboard';
    datos := jsonb_build_object('orden_id', u.orden_id, 'vence', public.mi_salon_vence_max(u.docente_id));
    return next;
  end loop;
end $$;
revoke all on function public.mi_salon_correos_pendientes(date, text) from public, anon;
grant execute on function public.mi_salon_correos_pendientes(date, text) to authenticated, service_role;


-- ── 10. Estado para la app: + pago pendiente y aviso del día ─────────────────────
-- Igual que en b21 (mismas llaves), más 'pago_pendiente' (OXXO con su referencia) y 'aviso'
-- (el del calendario que toca hoy; solo con Mi Salón abierto).
create or replace function public.mi_salon_estado_de(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
  v_activo boolean;
  v_creada timestamptz;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_vig record;
  v_ult record;
  v_vence date;
  v_piloto boolean;
  v_tiene boolean;
  v_pend jsonb;
  v_aviso jsonb;
begin
  if p_uid is null then return null; end if;
  if p_uid is distinct from auth.uid() and not public.es_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    return null;
  end if;
  select * into c from public.jissez_config where id;
  select p.activo_saas into v_activo from public.perfiles p where p.id = p_uid;
  select u.created_at into v_creada from auth.users u where u.id = p_uid;

  select a.origen, a.ciclo, a.periodos, public.mi_salon_vence(a) as vence into v_vig
    from public.mi_salon_accesos a
   where a.docente_id = p_uid and a.desde <= now() and public.mi_salon_fin(a) > now()
   order by public.mi_salon_fin(a) desc limit 1;
  select a.origen, a.ciclo, a.periodos, public.mi_salon_vence(a) as vence into v_ult
    from public.mi_salon_accesos a
   where a.docente_id = p_uid and public.mi_salon_vence(a) is not null
   order by public.mi_salon_fin(a) desc limit 1;
  v_vence := v_ult.vence;
  v_tiene := exists (select 1 from public.mi_salon_accesos a where a.docente_id = p_uid);
  v_piloto := exists (select 1 from public.mi_salon_accesos a where a.docente_id = p_uid and a.origen = 'piloto');

  -- b22: cobros. Con guarda: si una parte falla, el estado de siempre sale igual.
  begin
    v_pend := public.mi_salon_pago_pendiente(p_uid);
    if coalesce(c.mi_salon_abierto, false) then v_aviso := public.mi_salon_aviso_app(p_uid, v_hoy); end if;
  exception when others then
    v_pend := null;
    v_aviso := null;
  end;

  return jsonb_build_object(
    'abierto', coalesce(c.mi_salon_abierto, false),
    'visible', coalesce(v_activo, false) or v_piloto or coalesce(c.mi_salon_abierto, false),
    'vigente', v_vig.origen is not null,
    'tiene_acceso', v_tiene,
    'origen', coalesce(v_vig.origen, v_ult.origen),
    'ciclo', coalesce(v_vig.ciclo, v_ult.ciclo),
    'periodos', to_jsonb(coalesce(v_vig.periodos, v_ult.periodos)),
    'vence', v_vence,
    'solo_lectura_desde', v_vence + 1,
    'dias_restantes', case when v_vence is null then null else v_vence - v_hoy end,
    'piloto', v_piloto,
    'bienvenida_pendiente', coalesce(c.mi_salon_abierto, false)
      and c.mi_salon_abierto_desde is not null
      and v_creada is not null and v_creada >= c.mi_salon_abierto_desde
      and not exists (select 1 from public.mi_salon_correos m where m.docente_id = p_uid and m.tipo = 'bienvenida'),
    'pago_pendiente', v_pend,
    'aviso', v_aviso
  );
end $$;
revoke all on function public.mi_salon_estado_de(uuid) from public, anon;
grant execute on function public.mi_salon_estado_de(uuid) to authenticated, service_role;


-- ── 11. Panel de administración: cobros ──────────────────────────────────────────
create or replace function public.admin_mi_salon_guardar_fundador(p_cupo integer, p_tienda_hasta timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_cupo is null or p_cupo < 0 or p_cupo > 100000 then
    raise exception 'El cupo debe ser un número de 0 en adelante' using errcode = '22023';
  end if;
  update public.jissez_config
     set mi_salon_cupo_fundador = p_cupo, mi_salon_fundador_tienda_hasta = p_tienda_hasta,
         actualizado_en = now(), actualizado_por = auth.uid()
   where id
  returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.admin_mi_salon_guardar_fundador(integer, timestamptz) from public, anon;
grant execute on function public.admin_mi_salon_guardar_fundador(integer, timestamptz) to authenticated;

/*
  Todo lo de cobros para el panel: configuración del precio fundador y lugares, precios, pagos
  (todas las órdenes de Mi Salón, con los pendientes de OXXO), métricas y las listas de docentes
  por segmento con el texto listo para WhatsApp ({url} lo pone el panel con la dirección del
  sitio).
*/
create or replace function public.admin_mi_salon_cobros()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
  P public.mi_salon_periodos%rowtype;
  G public.mi_salon_periodos%rowtype;
  v_hoy date := public.mi_salon_hoy();
  v_pagos jsonb;
  v_seg jsonb;
  v_pt numeric;
  v_pr numeric;
  v_lug integer;
  v_nota text;
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into c from public.jissez_config where id;
  select * into P from public.mi_salon_periodo_de_venta(v_hoy);
  select * into G from public.mi_salon_periodos x where x.ciclo = c.gratis_ciclo and x.periodo = c.gratis_periodo;
  v_lug := case when P.ciclo is not null then public.mi_salon_lugares_fundador(P.ciclo) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'orden_id', m.orden_id, 'creada', o.created_at, 'pagado_en', o.pagado_en, 'estado', o.estado,
           'email', u.email, 'nombre', pf.nombre_completo, 'producto', m.producto,
           'nombre_producto', coalesce(pr.nombre, m.producto), 'ciclo', m.ciclo, 'periodo', m.periodo,
           'monto', o.monto_total, 'precio_lista', m.precio_lista, 'tipo_precio', m.tipo_precio,
           'motivo_fundador', m.motivo_fundador, 'cupon', o.cupon_codigo, 'cupon_referido', o.cupon_referido,
           'estado_mp', m.estado_mp, 'metodo', m.metodo, 'tipo_metodo', m.tipo_metodo, 'referencia', m.referencia,
           'pago_id', m.pago_id, 'pendiente_desde', m.pendiente_desde,
           'cobertura', coalesce(m.cobertura_final, m.cobertura), 'vence', coalesce(m.vence_final, m.vence_cotizado),
           'provisional', coalesce(m.provisional_final, m.provisional), 'agrego', m.agrego)
         order by o.created_at desc), '[]'::jsonb)
    into v_pagos
    from public.mi_salon_ordenes m
    join public.marketplace_ordenes o on o.id = m.orden_id
    left join auth.users u on u.id = m.docente_id
    left join public.perfiles pf on pf.id = m.docente_id
    left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto
   where o.estado <> 'fallido' or m.pago_id is not null;

  -- Precios genéricos para los textos de WhatsApp (fundador mientras queden lugares)
  select case when v_lug > 0 then coalesce(precio_fundador, precio_lista) else precio_lista end into v_pt
    from public.mi_salon_precios where ciclo = P.ciclo and producto = 'trimestre';
  select case when v_lug > 0 then coalesce(precio_fundador, precio_lista) else precio_lista end into v_pr
    from public.mi_salon_precios where ciclo = P.ciclo and producto = 'resto_ciclo';
  v_nota := case when v_lug > 0 then ' (precio fundador)' else '' end;

  with cuentas as (
    select u.id, u.email::text as email, coalesce(pf.nombre_completo, '') as nombre, u.phone::text as telefono,
           public.mi_salon_vence_max(u.id) as vmax,
           exists (select 1 from public.mi_salon_accesos a where a.docente_id = u.id and a.origen = 'gratis_t1' and a.ciclo = c.gratis_ciclo) as gratis,
           exists (select 1 from public.mi_salon_accesos a where a.docente_id = u.id and a.desde <= now() and public.mi_salon_fin(a) > now()) as vigente,
           exists (select 1 from public.mi_salon_accesos a where a.docente_id = u.id) as tuvo,
           public.mi_salon_pago_pendiente(u.id) as pend
      from auth.users u left join public.perfiles pf on pf.id = u.id
  ),
  seg as (
    select 'gratis_sin_renovar' as clave, 1 as orden,
           'Primer trimestre gratis, sin renovar' as titulo,
           'Tienen el acceso gratis y todavía no compran. Su acceso termina el ' || public.mi_salon_fecha_texto(G.vence) || '.' as descripcion,
           replace(replace(replace(replace((select a.texto from public.mi_salon_avisos a where a.clave = 'gratis_precios'),
             '{vence}', public.mi_salon_fecha_texto(G.vence)), '{precio_trimestre}', public.mi_salon_pesos(v_pt)),
             '{precio_resto}', public.mi_salon_pesos(v_pr)), '{precio_nota}', v_nota) || E'\n{url}' as texto,
           k.id, k.email, k.nombre, k.telefono, k.vmax
      from cuentas k where k.gratis and k.vmax = G.vence and v_hoy <= G.vence
    union all
    select 'por_vencer:' || k.vmax, 2, 'Acceso por vencer (' || public.mi_salon_fecha_texto(k.vmax) || ')',
           'Su acceso termina en 21 días o menos y no es el del periodo gratis.',
           replace((select a.texto from public.mi_salon_avisos a where a.clave = 'pago_21'), '{vence}', public.mi_salon_fecha_texto(k.vmax)) || E'\n{url}',
           k.id, k.email, k.nombre, k.telefono, k.vmax
      from cuentas k
     where k.vigente and k.vmax - v_hoy between 0 and 21 and not (k.gratis and k.vmax = G.vence)
    union all
    select 'solo_lectura', 3, 'En solo lectura', 'Tuvieron acceso y ya terminó.',
           (select a.texto from public.mi_salon_avisos a where a.clave = 'pago_terminado') || E'\n{url}',
           k.id, k.email, k.nombre, k.telefono, k.vmax
      from cuentas k where k.tuvo and not k.vigente
    union all
    select 'sin_acceso', 4, 'Sin acceso todavía', 'Cuentas creadas después del periodo gratis que no han comprado.',
           'Mi Salón te ayuda a llevar la asistencia, los trabajos y la boleta de tu grupo. Para empezar a capturar, elige tu acceso:' || E'\n{url}',
           k.id, k.email, k.nombre, k.telefono, k.vmax
      from cuentas k where not k.tuvo and coalesce(c.mi_salon_abierto, false)
    union all
    select 'pago_pendiente', 5, 'Pago pendiente (OXXO o SPEI)', 'Generaron su pago y todavía no se acredita.',
           'Tu pago para Mi Salón todavía no se refleja. Si ya pagaste, puede tardar unas horas; tu acceso se activa solo. Si aún no, tu ficha de pago está en tu correo.' || E'\n{url}',
           k.id, k.email, k.nombre, k.telefono, k.vmax
      from cuentas k where k.pend is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('clave', s.clave, 'titulo', s.titulo, 'descripcion', s.descripcion,
           'texto', s.texto, 'docentes', s.docentes) order by s.orden, s.clave), '[]'::jsonb)
    into v_seg
    from (select clave, min(orden) as orden, min(titulo) as titulo, min(descripcion) as descripcion, min(texto) as texto,
                 jsonb_agg(jsonb_build_object('id', id, 'email', email, 'nombre', nombre, 'telefono', telefono, 'vence', vmax)
                           order by nombre, email) as docentes
            from seg group by clave) s;

  return jsonb_build_object(
    'hoy', v_hoy,
    'ciclo', P.ciclo, 'periodo', P.periodo,
    'config', jsonb_build_object('abierto', c.mi_salon_abierto, 'abierto_desde', c.mi_salon_abierto_desde,
      'cupo_fundador', c.mi_salon_cupo_fundador, 'fundador_tienda_hasta', c.mi_salon_fundador_tienda_hasta,
      'corte_tienda', coalesce(c.mi_salon_fundador_tienda_hasta, c.mi_salon_abierto_desde)),
    'lugares_fundador', v_lug,
    'fundador_usados', case when P.ciclo is not null then public.mi_salon_fundador_usados(P.ciclo) end,
    'lanzamiento_pendientes', (select count(*) from public.mi_salon_correos_pendientes(v_hoy, 'lanzamiento')),
    'lanzamiento_enviados', (select count(*) from public.mi_salon_correos m where m.tipo = 'lanzamiento'),
    'precios', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.ciclo, pr.orden) from public.mi_salon_precios pr), '[]'::jsonb),
    'pagos', v_pagos,
    'segmentos', v_seg);
end $$;
revoke all on function public.admin_mi_salon_cobros() from public, anon;
grant execute on function public.admin_mi_salon_cobros() to authenticated;


-- ── 12. Órdenes de la tienda en el panel: detalle de las de Mi Salón ──────────────
-- Mismo cuerpo que el vigente (admin_listar_ordenes), con un coalesce: una orden de Mi Salón
-- no tiene renglones y su detalle sería vacío. Las de la tienda salen idénticas.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.admin_listar_ordenes()'::regprocedure) into v_def;
  if v_def is not null and position('mi_salon_ordenes' in v_def) = 0 then
    v_def := replace(v_def,
      E'            where it.orden_id = o.id) as detalle,',
      E'            where it.orden_id = o.id),\n           (select ''Mi Salón — '' || coalesce(pr.nombre, m.producto) || '' '' || m.ciclo\n              from public.mi_salon_ordenes m left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto\n             where m.orden_id = o.id)) as detalle,');
    v_def := replace(v_def, E'           (select string_agg(\n                     case\n                       when it.pedido_id',
      E'           coalesce((select string_agg(\n                     case\n                       when it.pedido_id');
    if position('coalesce((select string_agg(' in v_def) > 0 and position('mi_salon_ordenes' in v_def) > 0 then
      execute v_def;
    else
      raise notice 'admin_listar_ordenes: no se reconoció el cuerpo; se deja como está';
    end if;
  end if;
exception when undefined_function then
  raise notice 'admin_listar_ordenes no existe; nada que ajustar';
end $$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.admin_estado_cuenta_cupon(text, timestamptz, timestamptz)'::regprocedure) into v_def;
  if v_def is not null and position('mi_salon_ordenes' in v_def) = 0 then
    v_def := replace(v_def,
      E'            where it.orden_id = o.id) as detalle,',
      E'            where it.orden_id = o.id),\n           (select ''Mi Salón — '' || coalesce(pr.nombre, m.producto) || '' '' || m.ciclo\n              from public.mi_salon_ordenes m left join public.mi_salon_precios pr on pr.ciclo = m.ciclo and pr.producto = m.producto\n             where m.orden_id = o.id)) as detalle,');
    v_def := replace(v_def, E'           (select string_agg(\n                     case\n                       when it.pedido_id',
      E'           coalesce((select string_agg(\n                     case\n                       when it.pedido_id');
    if position('coalesce((select string_agg(' in v_def) > 0 and position('mi_salon_ordenes' in v_def) > 0 then
      execute v_def;
    else
      raise notice 'admin_estado_cuenta_cupon: no se reconoció el cuerpo; se deja como está';
    end if;
  end if;
exception when undefined_function then
  raise notice 'admin_estado_cuenta_cupon no existe; nada que ajustar';
end $$;


-- ── 13. delete_own_account: la versión FINAL (b19a + b20 + b21 + b22) ─────────────────
/*
  ORDEN: va AL FINAL. Varias migraciones reemplazan delete_own_account completa (b10,
  jissez_interes_secciones, b17, b18, b19, b19a, b20, b21 y esta). La que se aplica al último es la
  que queda; esta es la de b21 (b19a completa: marketplace_busquedas_vacias y productos_finales; b20:
  calificacion_directa y ponte_al_dia; b21: mi_salon_correos, mi_salon_accesos y la guarda de pagos
  de Mi Salón) más mi_salon_ordenes de b22. Cada tabla nueva con guarda to_regclass. Borrar la cuenta
  SIEMPRE se permite con o sin acceso vigente (security definer); una cuenta con compras de la
  tienda o un pago de Mi Salón no se borra sola (se escribe a soporte). mi_salon_avisos,
  mi_salon_precios y jissez_config son configuración (no son de la cuenta).
  La prueba pruebas/migraciones-orden.test.js exige todo esto de la última del orden.
*/
-- @@delete_own_account inicio (b22: la versión FINAL)
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.marketplace_ordenes where user_id = v)
     or exists (select 1 from public.marketplace_accesos where user_id = v)
     or exists (select 1 from public.marketplace_pedidos where user_id = v) then
    raise exception 'Tu cuenta tiene compras registradas en la tienda. Para eliminarla escribe a soporte@jissez.com.'
      using errcode = 'check_violation';
  end if;
  -- Pagos de Mi Salón (b21)
  if to_regclass('public.mi_salon_accesos') is not null then
    if exists (select 1 from public.mi_salon_accesos where docente_id = v and origen = 'pago') then
      raise exception 'Tu cuenta tiene pagos de Mi Salón registrados. Para eliminarla escribe a soporte@jissez.com.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Datos de Mi salón que no se borran en cascada con la cuenta (primero los que dependen de otros)
  delete from public.evaluacion_formativa where maestro_id = v;
  delete from public.calificaciones where maestro_id = v;
  delete from public.registro_diario where maestro_id = v;
  delete from public.boleta_trimestral where maestro_id = v;
  delete from public.evaluacion_diagnostica where maestro_id = v;
  delete from public.tareas where maestro_id = v;
  -- Para quién es cada producto (b17), antes que los productos
  if to_regclass('public.producto_sesion_alumnos') is not null then
    execute 'delete from public.producto_sesion_alumnos where maestro_id = $1' using v;
  end if;
  delete from public.productos_sesion where maestro_id = v;
  delete from public.dias_no_habiles_extra where maestro_id = v;
  delete from public.maestro_ajustes where maestro_id = v;
  delete from public.zz_deprecated_diagnosticos where maestro_id = v;
  -- Incidencias (b13)
  if to_regclass('public.incidencia_alumnos') is not null then
    execute 'delete from public.incidencia_alumnos where maestro_id = $1' using v;
  end if;
  if to_regclass('public.incidencias') is not null then
    execute 'delete from public.incidencias where maestro_id = $1' using v;
  end if;
  -- Calendario del grupo y rol de aseo (b14)
  if to_regclass('public.roles_aseo') is not null then
    execute 'delete from public.roles_aseo where maestro_id = $1' using v;
  end if;
  if to_regclass('public.calendario_ajustes') is not null then
    execute 'delete from public.calendario_ajustes where maestro_id = $1' using v;
  end if;
  -- Listas de cooperación y materiales (b15): valores, columnas y listas (también las cerradas)
  if to_regclass('public.listas_valores') is not null then
    execute 'delete from public.listas_valores where maestro_id = $1' using v;
  end if;
  if to_regclass('public.listas_columnas') is not null then
    execute 'delete from public.listas_columnas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.listas_grupo') is not null then
    execute 'delete from public.listas_grupo where maestro_id = $1' using v;
  end if;
  -- Avisos de secciones por abrir (jissez_interes_secciones)
  if to_regclass('public.interes_secciones') is not null then
    execute 'delete from public.interes_secciones where usuario_id = $1' using v;
  end if;
  -- Exámenes de Mi Salón (b18 y b19): no presentó, respuestas, resultados, preguntas y exámenes
  if to_regclass('public.examen_alumnos') is not null then
    execute 'delete from public.examen_alumnos where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_respuestas') is not null then
    execute 'delete from public.examen_respuestas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_resultados') is not null then
    execute 'delete from public.examen_resultados where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_preguntas') is not null then
    execute 'delete from public.examen_preguntas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examenes_grupo') is not null then
    execute 'delete from public.examenes_grupo where maestro_id = $1' using v;
  end if;
  -- Búsquedas sin resultados de la tienda (b19a: no se borraban; user_id sin llave foránea)
  if to_regclass('public.marketplace_busquedas_vacias') is not null then
    execute 'delete from public.marketplace_busquedas_vacias where user_id = $1' using v;
  end if;
  -- Productos finales (tabla legada, sin pantalla que la escriba; b19a): su llave a grupos no
  -- tiene cascada y hacía fallar el borrado de la cuenta
  if to_regclass('public.productos_finales') is not null then
    execute 'delete from public.productos_finales where maestro_id = $1 or grupo_id in (select id from public.grupos where maestro_id = $1)' using v;
  end if;
  -- Ponte al día (b20, constructor AK; con guarda: la tabla puede no existir todavía)
  if to_regclass('public.calificacion_directa') is not null then
    execute 'delete from public.calificacion_directa where maestro_id = $1' using v;
  end if;
  if to_regclass('public.ponte_al_dia') is not null then
    execute 'delete from public.ponte_al_dia where maestro_id = $1' using v;
  end if;
  -- Accesos y correos de Mi Salón (b21; también se irían en cascada con auth.users)
  if to_regclass('public.mi_salon_correos') is not null then
    execute 'delete from public.mi_salon_correos where docente_id = $1' using v;
  end if;
  if to_regclass('public.mi_salon_accesos') is not null then
    execute 'delete from public.mi_salon_accesos where docente_id = $1' using v;
  end if;

  -- Órdenes de Mi Salón (b22). Una cuenta con órdenes ya se detiene arriba (toda orden de Mi
  -- Salón vive también en marketplace_ordenes); esto queda por si se relaja esa regla. Se van
  -- también en cascada con auth.users.
  if to_regclass('public.mi_salon_ordenes') is not null then
    execute 'delete from public.mi_salon_ordenes where docente_id = $1' using v;
  end if;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin

-- PostgREST: que vea las tablas y funciones nuevas
notify pgrst, 'reload schema';
