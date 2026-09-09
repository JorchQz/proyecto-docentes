-- =============================================================================
-- Pedidos a la medida: varios campos, contenidos y PDAs por pedido (2026-09-09)
-- =============================================================================
--
-- Jorge pidio que el formulario deje elegir mas de un campo formativo, mas de
-- un contenido y mas de un PDA. Las tres columnas escalares pasan a listas;
-- los pedidos existentes se migran sin perder datos. Los textos para el admin
-- y los correos se resuelven al vuelo contra los catalogos SEP.
--
-- Idempotente.
-- =============================================================================

alter table marketplace_pedidos add column if not exists campos_formativos text[] not null default '{}';
alter table marketplace_pedidos add column if not exists contenido_ids uuid[] not null default '{}';
alter table marketplace_pedidos add column if not exists pda_ids uuid[] not null default '{}';

-- Migrar lo que hubiera en las columnas escalares (una sola vez: solo si la
-- columna vieja sigue existiendo).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'marketplace_pedidos' and column_name = 'campo_formativo') then
    update marketplace_pedidos set
      campos_formativos = case when campo_formativo is not null and campos_formativos = '{}' then array[campo_formativo] else campos_formativos end,
      contenido_ids = case when contenido_id is not null and contenido_ids = '{}' then array[contenido_id] else contenido_ids end,
      pda_ids = case when pda_id is not null and pda_ids = '{}' then array[pda_id] else pda_ids end;
    alter table marketplace_pedidos drop column campo_formativo;
    alter table marketplace_pedidos drop column contenido_id;
    alter table marketplace_pedidos drop column pda_id;
  end if;
end $$;

alter table marketplace_pedidos drop constraint if exists marketplace_pedidos_campos_check;
alter table marketplace_pedidos add constraint marketplace_pedidos_campos_check
  check (campos_formativos <@ array['LEN', 'SAB', 'ETI', 'DHL']::text[]);

comment on column marketplace_pedidos.campos_formativos is 'Codigos LEN/SAB/ETI/DHL elegidos (puede ir vacio).';
comment on column marketplace_pedidos.contenido_ids is 'catalogo_contenidos.id elegidos (puede ir vacio).';
comment on column marketplace_pedidos.pda_ids is 'catalogo_pda.id elegidos (puede ir vacio).';

-- Permisos por columna (la tabla no tiene GRANT de tabla, ver §8 del archivo
-- anterior): las columnas nuevas se conceden explicitamente.
grant select (campos_formativos, contenido_ids, pda_ids) on marketplace_pedidos to authenticated;

-- Textos de contenidos y PDAs de un pedido, para el admin y los correos.
create or replace function public.marketplace_pedido_textos(p_contenidos uuid[], p_pdas uuid[])
returns table (contenidos text[], pdas text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce((select array_agg(c.contenido order by c.campo_formativo, c.orden)
              from catalogo_contenidos c where c.id = any(coalesce(p_contenidos, '{}'))), '{}'),
    coalesce((select array_agg(p.grado || '° · ' || p.pda order by p.grado, p.orden)
              from catalogo_pda p where p.id = any(coalesce(p_pdas, '{}'))), '{}');
$$;
revoke all on function public.marketplace_pedido_textos(uuid[], uuid[]) from public, anon;
grant execute on function public.marketplace_pedido_textos(uuid[], uuid[]) to authenticated, service_role;

-- El listado del admin cambia de forma: hay que soltar la version anterior.
drop function if exists public.admin_listar_pedidos();
create function public.admin_listar_pedidos()
returns table (
  id uuid, numero_pedido text, estado text, nivel text, organizacion text,
  grados smallint[], grados_combo text, modalidad text, campos_formativos text[],
  contenidos text[], pdas text[], metodologia text, fecha_necesaria date, notas text,
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
           p.grados, p.grados_combo, p.modalidad, p.campos_formativos,
           t.contenidos, t.pdas, p.metodologia, p.fecha_necesaria, p.notas,
           p.nombre_cliente, u.email::text, p.precio, p.pagado_en,
           p.fecha_compromiso_entrega,
           (p.estado in ('pendiente', 'en_proceso') and p.fecha_compromiso_entrega is not null
             and now() > p.fecha_compromiso_entrega) as vencido,
           p.drive_folder_id, p.producto_id, p.dosificacion_proyecto_id, p.completado_en,
           p.created_at, p.orden_id
    from marketplace_pedidos p
    left join auth.users u on u.id = p.user_id
    cross join lateral marketplace_pedido_textos(p.contenido_ids, p.pda_ids) t
    where p.estado <> 'pendiente_pago'
    order by
      case p.estado when 'pendiente' then 0 when 'en_proceso' then 1 when 'completado' then 2 else 3 end,
      p.pagado_en desc nulls last, p.created_at desc;
end;
$$;
revoke all on function public.admin_listar_pedidos() from public, anon;
grant execute on function public.admin_listar_pedidos() to authenticated;
