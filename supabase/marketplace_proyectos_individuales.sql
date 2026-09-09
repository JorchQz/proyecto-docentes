-- =============================================================================
-- Venta de proyectos individuales (septiembre 2026)
-- =============================================================================
--
-- Un proyecto suelto es una fila mas de marketplace_productos, no una tabla
-- nueva: tipo_paquete = 'proyecto', num_proyectos = 1, la carpeta de Drive es
-- la del proyecto (P0N) y dosificacion_proyecto_id apunta al proyecto exacto
-- del bot (es la llave del filtro por contenido/PDA del catalogo).
--
-- Precios: precio_pdf = sin anexos, precio_pdf_con_anexos = con anexos. El
-- Word va SIEMPRE incluido (precio_editable queda null). marketplace_aplicar_
-- precios() hace JOIN por tipo_paquete contra el tarifario, asi que estas
-- filas no coinciden con ninguna tarifa y no se reescriben: el precio vive en
-- la fila y se edita desde el admin. La promocion se aplica encima, igual que
-- en los paquetes (marketplace_precio_final / Tienda.precioFinal).
--
-- Compra: el `tipo` de la orden es 'pdf' (sin anexos) o 'anexos' (con anexos).
-- Accesos otorgados (pagos.ts::otorgarAccesosDeOrden):
--   'pdf'    -> pdf + editable
--   'anexos' -> pdf + editable + anexos
-- La fila tipo='anexos' pasa a ser el interruptor real de las subcarpetas del
-- proyecto en las funciones de entrega (antes se otorgaba y nadie la leia).
--
-- Idempotente.
-- =============================================================================

-- ── 1. Tercer tipo de paquete ───────────────────────────────────────────────
alter table marketplace_productos
  drop constraint if exists marketplace_productos_tipo_paquete_check;
alter table marketplace_productos
  add constraint marketplace_productos_tipo_paquete_check
  check (tipo_paquete in ('trimestre', 'ciclo', 'proyecto'));

-- ── 2. Precio con anexos y numero de proyecto ───────────────────────────────
alter table marketplace_productos
  add column if not exists precio_pdf_con_anexos numeric
    check (precio_pdf_con_anexos is null or precio_pdf_con_anexos >= 0);
comment on column marketplace_productos.precio_pdf_con_anexos is
  'Solo tipo_paquete = proyecto: precio con anexos (PDF + Word + anexos). precio_pdf es el precio sin anexos.';

-- Numero CONTINUO del proyecto dentro del grado (1-12: T1 = 1-4, T2 = 5-8,
-- T3 = 9-12). Es el mismo `pr` que el bot imprime en los links de anexo
-- (anexo.html?aula=..&pr=..), asi la Edge Function anexo lo resuelve directo.
-- Null en personalizados (se resuelven por producto, no por coordenadas).
alter table marketplace_productos
  add column if not exists numero_proyecto smallint
    check (numero_proyecto is null or numero_proyecto between 1 and 12);
comment on column marketplace_productos.numero_proyecto is
  'Solo tipo_paquete = proyecto: numero continuo 1-12 dentro del grado o combo. Coincide con el pr de los links de anexo.';

create index if not exists marketplace_productos_tipo_activo_idx
  on marketplace_productos (tipo_paquete, activo);

-- ── 3. La orden admite la version "con anexos" ──────────────────────────────
alter table marketplace_orden_items
  drop constraint if exists marketplace_orden_items_tipo_check;
alter table marketplace_orden_items
  add constraint marketplace_orden_items_tipo_check
  check (tipo in ('pdf', 'editable', 'anexos'));

-- ── 4. Evidencia de aceptacion de Terminos y Aviso de Privacidad ────────────
-- La llena crear-preferencia-mp al crear la orden; el checkout no deja pagar
-- sin marcar la casilla.
alter table marketplace_ordenes
  add column if not exists terminos_aceptados_en timestamptz;
comment on column marketplace_ordenes.terminos_aceptados_en is
  'Momento en que el comprador acepto Terminos y Condiciones y Aviso de Privacidad en el checkout.';

-- ── 5. La via manual de accesos conoce el proyecto suelto ───────────────────
-- admin_confirmar_orden y admin_otorgar_acceso tenian su propia regla
-- (_accesos_por_tipo) que ademas no coincidia con pagos.ts: 'pdf' otorgaba
-- solo 'pdf', sin la fila 'anexos'. Se alinea con tiposDeAcceso() de
-- _shared/pagos.ts, que es la regla de la via automatica:
--   paquete : pdf -> pdf+anexos · editable -> editable+pdf+anexos
--   proyecto: pdf -> pdf+editable · anexos -> pdf+editable+anexos
create or replace function public._accesos_por_tipo(p_tipo text, p_tipo_paquete text default null)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_tipo_paquete = 'proyecto' and p_tipo = 'anexos' then array['pdf','editable','anexos']
    when p_tipo_paquete = 'proyecto' then array['pdf','editable']
    when p_tipo = 'editable' then array['editable','pdf','anexos']
    when p_tipo = 'pdf' then array['pdf','anexos']
    else array[p_tipo]
  end;
$$;

create or replace function public.admin_confirmar_orden(p_orden_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_estado text;
  it record;
  t text;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  select user_id, estado into v_user, v_estado
  from marketplace_ordenes where id = p_orden_id;
  if v_user is null then
    raise exception 'Orden no encontrada';
  end if;

  update marketplace_ordenes set estado = 'pagado' where id = p_orden_id;

  for it in
    select i.producto_id, i.tipo, p.tipo_paquete
    from marketplace_orden_items i
    join marketplace_productos p on p.id = i.producto_id
    where i.orden_id = p_orden_id
  loop
    foreach t in array _accesos_por_tipo(it.tipo, it.tipo_paquete) loop
      insert into marketplace_accesos (user_id, producto_id, tipo, orden_id)
      values (v_user, it.producto_id, t, p_orden_id)
      on conflict (user_id, producto_id, tipo) do nothing;
    end loop;
  end loop;

  return 'ok';
end;
$$;

create or replace function public.admin_otorgar_acceso(p_email text, p_producto_id uuid, p_tipo text)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_user uuid;
  v_tipo_paquete text;
  t text;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email) limit 1;
  if v_user is null then
    raise exception 'No existe un usuario con ese correo';
  end if;

  select tipo_paquete into v_tipo_paquete from marketplace_productos where id = p_producto_id;
  if v_tipo_paquete is null then
    raise exception 'Producto no encontrado';
  end if;
  if (v_tipo_paquete = 'proyecto' and p_tipo = 'editable')
     or (v_tipo_paquete <> 'proyecto' and p_tipo = 'anexos') then
    raise exception 'Esa version no existe para este producto';
  end if;

  foreach t in array _accesos_por_tipo(p_tipo, v_tipo_paquete) loop
    insert into marketplace_accesos (user_id, producto_id, tipo)
    values (v_user, p_producto_id, t)
    on conflict (user_id, producto_id, tipo) do nothing;
  end loop;

  return 'ok';
end;
$$;

-- El listado de ordenes del admin etiqueta la version 'anexos'.
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
                     pr.titulo || ' — ' ||
                     (case
                        when pr.tipo_paquete = 'proyecto' and it.tipo = 'anexos' then 'PDF + Word + anexos'
                        when pr.tipo_paquete = 'proyecto' then 'PDF + Word'
                        when it.tipo = 'editable' then 'Editable (Word)'
                        else 'PDF' end),
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

-- ── 6. El comprador ve lo que compro aunque ya no este publicado ────────────
-- Hasta ahora solo eran legibles los productos activos y no de prueba. Un
-- proyecto personalizado entregado sin publicar (activo = false) no se veria
-- en Mis compras, y un paquete despublicado despues de venderse tampoco.
drop policy if exists "comprador ve sus productos" on marketplace_productos;
create policy "comprador ve sus productos" on marketplace_productos
  for select to authenticated
  using (
    exists (
      select 1 from marketplace_accesos a
      where a.producto_id = marketplace_productos.id
        and a.user_id = auth.uid()
    )
  );
