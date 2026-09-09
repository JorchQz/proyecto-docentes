-- =============================================================================
-- Proyectos personalizados (a la medida) — septiembre 2026
-- =============================================================================
--
-- Un maestro o normalista pide un proyecto que el catalogo no tiene. Paga por
-- adelantado (mismo checkout de Mercado Pago), Jorge lo genera con el bot y lo
-- sube a Drive en {grado o combo}/Proyectos Personalizados/{PZ-0001}_{nombre}/,
-- y al marcarlo completado desde el admin (Edge Function completar-pedido) el
-- sistema crea un producto tipo 'proyecto' con esa carpeta, otorga el acceso
-- al cliente y, si Jorge lo marca, lo publica en el catalogo (7.8 del doc).
--
-- Entrega V1 (decision de Jorge): la carpeta la crea Jorge a mano y pega el
-- ID en el admin; no hay escritura en Drive.
--
-- Precios y cupo viven en marketplace_personalizados_config (fila unica), que
-- el admin edita. El precio final lleva promocion y cupon igual que todo.
--
-- Idempotente.
-- =============================================================================

-- ── 1. Configuracion (fila unica) ───────────────────────────────────────────
create table if not exists marketplace_personalizados_config (
  id boolean primary key default true check (id),
  abierto boolean not null default true,
  tope_semanal integer not null default 5 check (tope_semanal >= 0),
  ventana_horas integer not null default 72 check (ventana_horas between 1 and 720),
  precio_sin_anexos numeric(10,2) not null default 120 check (precio_sin_anexos >= 0),
  precio_con_anexos numeric(10,2) not null default 160 check (precio_con_anexos >= 0),
  mensaje_cerrado text,
  actualizado_en timestamptz not null default now()
);
insert into marketplace_personalizados_config (id) values (true) on conflict (id) do nothing;

comment on table marketplace_personalizados_config is
  'Fila unica: cupo semanal, ventana de entrega y precios de los proyectos a la medida. La edita el admin.';

alter table marketplace_personalizados_config enable row level security;
drop policy if exists "admin gestiona config personalizados" on marketplace_personalizados_config;
create policy "admin gestiona config personalizados" on marketplace_personalizados_config
  for all using (es_admin()) with check (es_admin());

-- ── 2. Pedidos ──────────────────────────────────────────────────────────────
create sequence if not exists marketplace_pedidos_seq;

create table if not exists marketplace_pedidos (
  id uuid primary key default gen_random_uuid(),
  -- Numero corto y legible (PZ-0001): es el nombre de la subcarpeta en Drive y
  -- lo que el bot imprime en los links de anexo del personalizado.
  numero_pedido text not null unique default ('PZ-' || lpad(nextval('marketplace_pedidos_seq')::text, 4, '0')),
  user_id uuid not null references auth.users(id),
  orden_id uuid references marketplace_ordenes(id),
  estado text not null default 'pendiente_pago'
    check (estado in ('pendiente_pago', 'pendiente', 'en_proceso', 'completado', 'cancelado')),
  nivel text not null check (nivel in ('sin_anexos', 'con_anexos')),
  organizacion text not null check (organizacion in ('completa', 'multigrado')),
  grados smallint[] not null,
  grados_combo text,
  modalidad text check (modalidad in ('bidocente', 'tridocente')),
  campo_formativo text check (campo_formativo in ('LEN', 'SAB', 'ETI', 'DHL')),
  contenido_id uuid references catalogo_contenidos(id),
  pda_id uuid references catalogo_pda(id),
  metodologia text,
  fecha_necesaria date,
  notas text,
  nombre_cliente text,
  precio numeric(10,2),
  pagado_en timestamptz,
  fecha_compromiso_entrega timestamptz,
  drive_folder_id text,
  producto_id uuid references marketplace_productos(id),
  dosificacion_proyecto_id uuid references dosificacion_proyectos(id),
  completado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table marketplace_pedidos is
  'Pedidos de proyectos a la medida. Estados: pendiente_pago -> pendiente (pagado, en cola) -> en_proceso -> completado; o cancelado.';

create index if not exists marketplace_pedidos_user_idx on marketplace_pedidos (user_id, created_at desc);
create index if not exists marketplace_pedidos_estado_idx on marketplace_pedidos (estado, pagado_en);

alter table marketplace_pedidos enable row level security;
drop policy if exists "usuario ve sus pedidos" on marketplace_pedidos;
create policy "usuario ve sus pedidos" on marketplace_pedidos
  for select using (user_id = auth.uid());
drop policy if exists "admin gestiona pedidos" on marketplace_pedidos;
create policy "admin gestiona pedidos" on marketplace_pedidos
  for all using (es_admin()) with check (es_admin());
-- El ID de carpeta de Drive nunca viaja al navegador del cliente.
revoke select (drive_folder_id) on marketplace_pedidos from anon, authenticated;

-- ── 3. La orden puede llevar un pedido en vez de un producto ────────────────
alter table marketplace_orden_items alter column producto_id drop not null;
alter table marketplace_orden_items add column if not exists pedido_id uuid references marketplace_pedidos(id);
alter table marketplace_orden_items drop constraint if exists marketplace_orden_items_producto_o_pedido;
alter table marketplace_orden_items add constraint marketplace_orden_items_producto_o_pedido
  check (producto_id is not null or pedido_id is not null);

-- ── 4. Estado publico: abierto, cupo, ventana y precios ─────────────────────
-- Cupo = tope semanal menos los pedidos pagados y aun no entregados en los
-- ultimos 7 dias. Si esta agotado, dice cuando se libera el mas viejo.
create or replace function public.marketplace_personalizados_estado()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (select * from marketplace_personalizados_config where id),
  activos as (
    select count(*)::integer as n, min(pagado_en) as mas_viejo
    from marketplace_pedidos
    where estado in ('pendiente', 'en_proceso')
      and pagado_en > now() - interval '7 days'
  )
  select jsonb_build_object(
    'abierto', c.abierto,
    'tope_semanal', c.tope_semanal,
    'cupos_disponibles', greatest(c.tope_semanal - a.n, 0),
    'ventana_horas', c.ventana_horas,
    'precio_sin_anexos', c.precio_sin_anexos,
    'precio_con_anexos', c.precio_con_anexos,
    'mensaje', c.mensaje_cerrado,
    'fecha_reapertura', case when c.tope_semanal - a.n <= 0 and a.mas_viejo is not null
                              then a.mas_viejo + interval '7 days' end
  )
  from c, activos a;
$$;
revoke all on function public.marketplace_personalizados_estado() from public;
grant execute on function public.marketplace_personalizados_estado() to anon, authenticated;

-- ── 5. RPC de administracion ────────────────────────────────────────────────
create or replace function public.admin_listar_pedidos()
returns table (
  id uuid, numero_pedido text, estado text, nivel text, organizacion text,
  grados smallint[], grados_combo text, modalidad text, campo_formativo text,
  contenido text, pda text, metodologia text, fecha_necesaria date, notas text,
  nombre_cliente text, email text, precio numeric, pagado_en timestamptz,
  fecha_compromiso_entrega timestamptz, vencido boolean, drive_folder_id text,
  producto_id uuid, dosificacion_proyecto_id uuid, completado_en timestamptz,
  created_at timestamptz, orden_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  return query
    select p.id, p.numero_pedido, p.estado, p.nivel, p.organizacion,
           p.grados, p.grados_combo, p.modalidad, p.campo_formativo,
           cc.contenido, cp.pda, p.metodologia, p.fecha_necesaria, p.notas,
           p.nombre_cliente, u.email::text, p.precio, p.pagado_en,
           p.fecha_compromiso_entrega,
           (p.estado in ('pendiente', 'en_proceso') and p.fecha_compromiso_entrega is not null
             and now() > p.fecha_compromiso_entrega) as vencido,
           p.drive_folder_id, p.producto_id, p.dosificacion_proyecto_id, p.completado_en,
           p.created_at, p.orden_id
    from marketplace_pedidos p
    left join auth.users u on u.id = p.user_id
    left join catalogo_contenidos cc on cc.id = p.contenido_id
    left join catalogo_pda cp on cp.id = p.pda_id
    where p.estado <> 'pendiente_pago'
    order by
      case p.estado when 'pendiente' then 0 when 'en_proceso' then 1 when 'completado' then 2 else 3 end,
      p.pagado_en desc nulls last, p.created_at desc;
end;
$$;
revoke all on function public.admin_listar_pedidos() from public, anon;
grant execute on function public.admin_listar_pedidos() to authenticated;

-- Cambios de estado manuales: a en_proceso, de vuelta a pendiente, o cancelar.
-- Completar tiene su propia Edge Function (verifica Drive y entrega).
create or replace function public.admin_actualizar_pedido(p_id uuid, p_estado text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  if p_estado not in ('pendiente', 'en_proceso', 'cancelado') then
    raise exception 'Estado no permitido';
  end if;
  update marketplace_pedidos
  set estado = p_estado, updated_at = now()
  where id = p_id and estado in ('pendiente', 'en_proceso');
  if not found then
    raise exception 'El pedido no existe o ya no se puede cambiar';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.admin_actualizar_pedido(uuid, text) from public, anon;
grant execute on function public.admin_actualizar_pedido(uuid, text) to authenticated;

create or replace function public.admin_estado_personalizados()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  select to_jsonb(c) into v from marketplace_personalizados_config c where c.id;
  return v || jsonb_build_object(
    'publico', marketplace_personalizados_estado(),
    'pendientes', (select count(*) from marketplace_pedidos where estado = 'pendiente'),
    'en_proceso', (select count(*) from marketplace_pedidos where estado = 'en_proceso'),
    'vencidos', (select count(*) from marketplace_pedidos
                 where estado in ('pendiente', 'en_proceso') and now() > fecha_compromiso_entrega)
  );
end;
$$;
revoke all on function public.admin_estado_personalizados() from public, anon;
grant execute on function public.admin_estado_personalizados() to authenticated;

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
      tope_semanal = coalesce(p_tope, tope_semanal),
      ventana_horas = coalesce(p_ventana, ventana_horas),
      precio_sin_anexos = coalesce(p_precio_sin, precio_sin_anexos),
      precio_con_anexos = coalesce(p_precio_con, precio_con_anexos),
      mensaje_cerrado = p_mensaje,
      actualizado_en = now()
  where id;
  return admin_estado_personalizados();
end;
$$;
revoke all on function public.admin_guardar_personalizados(boolean, integer, integer, numeric, numeric, text) from public, anon;
grant execute on function public.admin_guardar_personalizados(boolean, integer, integer, numeric, numeric, text) to authenticated;

-- ── 6. El listado de ordenes del admin muestra los pedidos ──────────────────
create or replace function public.admin_listar_ordenes()
returns table(id uuid, estado text, monto_total numeric, metodo_pago text, referencia_pago text,
              created_at timestamptz, user_id uuid, comprador_email text, detalle text,
              cupon_codigo text, descuento_aplicado numeric)
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
                     end,
                     ' · ')
            from marketplace_orden_items it
            left join marketplace_productos pr on pr.id = it.producto_id
            left join marketplace_pedidos pe on pe.id = it.pedido_id
            where it.orden_id = o.id) as detalle,
           o.cupon_codigo, o.descuento_aplicado
    from marketplace_ordenes o
    left join auth.users u on u.id = o.user_id
    order by o.created_at desc;
end;
$$;

-- ── 7. Busquedas sin resultado (9.b del documento) ──────────────────────────
-- El catalogo registra la combinacion de filtros que no encontro proyecto:
-- es la senal de que generar primero. Cualquiera puede insertar; solo el
-- admin lee.
create table if not exists marketplace_busquedas_vacias (
  id uuid primary key default gen_random_uuid(),
  filtros jsonb not null,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table marketplace_busquedas_vacias enable row level security;
drop policy if exists "cualquiera registra busqueda vacia" on marketplace_busquedas_vacias;
create policy "cualquiera registra busqueda vacia" on marketplace_busquedas_vacias
  for insert to anon, authenticated with check (true);
drop policy if exists "admin ve busquedas vacias" on marketplace_busquedas_vacias;
create policy "admin ve busquedas vacias" on marketplace_busquedas_vacias
  for select using (es_admin());
grant insert on marketplace_busquedas_vacias to anon, authenticated;
grant select on marketplace_busquedas_vacias to authenticated;

create or replace function public.admin_busquedas_vacias(p_dias integer default 30)
returns table (filtros jsonb, veces bigint, ultima timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  return query
    select b.filtros, count(*)::bigint, max(b.created_at)
    from marketplace_busquedas_vacias b
    where b.created_at > now() - make_interval(days => coalesce(p_dias, 30))
    group by b.filtros
    order by count(*) desc, max(b.created_at) desc
    limit 100;
end;
$$;
revoke all on function public.admin_busquedas_vacias(integer) from public, anon;
grant execute on function public.admin_busquedas_vacias(integer) to authenticated;

-- ── 8. Los IDs de Drive no se leen desde el navegador (correccion) ─────────
-- rls_hardening_2026-08.sql revocaba SOLO las columnas *_drive_id, pero un
-- REVOKE por columna no surte efecto mientras exista un GRANT de tabla: en la
-- practica anon seguia leyendo proyecto_folder_drive_id. Se quita el permiso
-- de tabla y se conceden explicitamente las columnas publicas (misma idea para
-- marketplace_pedidos.drive_folder_id). Insert/update no cambian.
revoke select on marketplace_productos from anon, authenticated;
grant select (id, titulo, descripcion, grado, fase, campo_formativo, metodologia, escenario, trimestre,
  num_sesiones, precio_pdf, precio_editable, portada_url, activo, dosificacion_proyecto_id, created_at,
  updated_at, tipo_paquete, num_proyectos, organizacion, grados_combo, modalidad, es_prueba,
  precio_pdf_con_anexos, numero_proyecto)
  on marketplace_productos to anon, authenticated;

revoke select on marketplace_pedidos from anon, authenticated;
grant select (id, numero_pedido, user_id, orden_id, estado, nivel, organizacion, grados, grados_combo,
  modalidad, campo_formativo, contenido_id, pda_id, metodologia, fecha_necesaria, notas, nombre_cliente,
  precio, pagado_en, fecha_compromiso_entrega, producto_id, dosificacion_proyecto_id, completado_en,
  created_at, updated_at)
  on marketplace_pedidos to authenticated;
