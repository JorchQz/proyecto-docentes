-- Mi salón B14 — Calendario escolar por grupo y rol de aseo (2026-09-25, decisión de Jorge)
--
-- Solo aditiva: dos tablas nuevas con RLS y delete_own_account reemplazada (la misma de
-- mi_salon_b10_eliminar_cuenta_2026-09.sql con las líneas nuevas). No toca filas existentes.
-- Se puede correr dos veces ("if not exists" / "create or replace" / políticas con guarda).
-- Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de Jorge y
-- ANTES de publicar calendario.html (sin las tablas, la página avisa "No se pudo cargar").
--
-- 1. calendario_ajustes: los días que la maestra cambia del calendario oficial SEP para UN grupo
--    (el calendario oficial vive en js/calendario-sep.js, no en la base). Una fila por grupo y
--    fecha (índice único). tipo:
--      suspension | festividad_local | otro  → ese día NO hay clase en el grupo
--      con_clase                             → ese día SÍ hay clase aunque el oficial diga que no
--                                              (la autoridad educativa local ajustó el calendario,
--                                              LGE art. 87)
--    motivo: texto libre opcional (hasta 140 caracteres). Quitar un ajuste = borrar la fila.
--
-- 2. roles_aseo: el rol de aseo de un grupo en un mes, guardado para poder reimprimirlo igual.
--    Una fila por grupo y mes (mes = primer día del mes). Guarda la configuración (alumnos por
--    día, con quién empezó, si continuó del mes anterior), el reparto día por día en asignacion
--    (jsonb [{fecha, alumnos: [alumno_id]}], con los cambios a mano ya aplicados) y con quién
--    sigue el mes siguiente (siguiente_alumno_id y su número de lista, por si ese alumno se da de
--    baja o se borra).
--
-- RLS (las dos tablas): cada maestra solo lo suyo (auth.uid() = maestro_id) y, al escribir, solo
-- en un grupo suyo; en roles_aseo, además, los alumnos de inicio y de continuación deben ser
-- alumnos suyos del MISMO grupo (decisión 4 de Jorge: referencias propias). Sin acceso anónimo.
-- Los ids dentro de asignacion no se validan en la base: la pantalla solo los cruza contra los
-- alumnos que la maestra puede leer (uno ajeno saldría como "ya no está en la lista").
--
-- 3. Borrar la CUENTA: delete_own_account borra también calendario_ajustes y roles_aseo (además la
--    cascada de auth.users y de grupos los alcanza). Incluye las líneas de incidencias de
--    mi_salon_b13_ficha_incidencias_2026-09.sql, con guarda to_regclass: esta versión sirve se
--    aplique antes o después de b13. Si b13 se aplica DESPUÉS, su delete_own_account no trae estas
--    tablas, pero la cascada (maestro_id → auth.users on delete cascade) las borra igual.
--
-- 4. Exportación: js/exportar.js agrega la hoja "Calendario" al Excel del concentrado cuando el
--    grupo tiene ajustes (fecha, qué es, motivo). El rol de aseo no se exporta: se guarda como
--    imagen, texto o impresión desde calendario.html.

-- ── 1. calendario_ajustes ────────────────────────────────────────────────────
create table if not exists public.calendario_ajustes (
  id          uuid primary key default gen_random_uuid(),
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id    uuid not null references public.grupos (id) on delete cascade,
  fecha       date not null,
  tipo        text not null,
  motivo      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint calendario_ajustes_tipo_valido
    check (tipo in ('suspension', 'festividad_local', 'otro', 'con_clase')),
  constraint calendario_ajustes_motivo_largo
    check (motivo is null or char_length(motivo) <= 140),
  constraint calendario_ajustes_fecha_rango
    check (fecha >= date '2020-01-01' and fecha < date '2100-01-01')
);

comment on table public.calendario_ajustes is
  'Días que la maestra cambia del calendario oficial SEP (js/calendario-sep.js) para un grupo: suspension/festividad_local/otro = sin clase; con_clase = sí hay clase aunque el oficial diga que no. Una fila por grupo y fecha.';

create unique index if not exists calendario_ajustes_grupo_fecha_uidx on public.calendario_ajustes (grupo_id, fecha);
create index if not exists calendario_ajustes_maestro_idx on public.calendario_ajustes (maestro_id);

drop trigger if exists calendario_ajustes_updated_at on public.calendario_ajustes;
create trigger calendario_ajustes_updated_at before update on public.calendario_ajustes
  for each row execute function public.set_updated_at();

-- ── 2. roles_aseo ────────────────────────────────────────────────────────────
create table if not exists public.roles_aseo (
  id                   uuid primary key default gen_random_uuid(),
  maestro_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id             uuid not null references public.grupos (id) on delete cascade,
  mes                  date not null,
  por_dia              smallint not null default 2,
  inicia_alumno_id     uuid references public.alumnos (id) on delete set null,
  continua             boolean not null default false,
  siguiente_alumno_id  uuid references public.alumnos (id) on delete set null,
  siguiente_num_lista  integer,
  asignacion           jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint roles_aseo_mes_primer_dia check (extract(day from mes) = 1),
  constraint roles_aseo_por_dia_rango check (por_dia between 1 and 5),
  constraint roles_aseo_asignacion_arreglo
    check (jsonb_typeof(asignacion) = 'array' and jsonb_array_length(asignacion) <= 31)
);

comment on table public.roles_aseo is
  'Rol de aseo de un grupo en un mes (mes = primer día). asignacion: [{fecha, alumnos:[alumno_id]}] con los cambios a mano aplicados; siguiente_*: con quién sigue el mes siguiente si la maestra elige continuar.';

create unique index if not exists roles_aseo_grupo_mes_uidx on public.roles_aseo (grupo_id, mes);
create index if not exists roles_aseo_maestro_idx on public.roles_aseo (maestro_id);
create index if not exists roles_aseo_inicia_idx on public.roles_aseo (inicia_alumno_id);
create index if not exists roles_aseo_siguiente_idx on public.roles_aseo (siguiente_alumno_id);

drop trigger if exists roles_aseo_updated_at on public.roles_aseo;
create trigger roles_aseo_updated_at before update on public.roles_aseo
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.calendario_ajustes enable row level security;
alter table public.roles_aseo enable row level security;

revoke all on public.calendario_ajustes from anon;
revoke all on public.roles_aseo from anon;
grant select, insert, update, delete on public.calendario_ajustes to authenticated;
grant select, insert, update, delete on public.roles_aseo to authenticated;

do $$
begin
  -- calendario_ajustes: solo los suyos y solo en un grupo suyo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendario_ajustes' and policyname = 'calendario_ajustes_select_propios') then
    create policy calendario_ajustes_select_propios on public.calendario_ajustes
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendario_ajustes' and policyname = 'calendario_ajustes_insert_propios') then
    create policy calendario_ajustes_insert_propios on public.calendario_ajustes
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendario_ajustes' and policyname = 'calendario_ajustes_update_propios') then
    create policy calendario_ajustes_update_propios on public.calendario_ajustes
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendario_ajustes' and policyname = 'calendario_ajustes_delete_propios') then
    create policy calendario_ajustes_delete_propios on public.calendario_ajustes
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;

  -- roles_aseo: solo los suyos, en un grupo suyo, con alumnos suyos de ese mismo grupo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles_aseo' and policyname = 'roles_aseo_select_propios') then
    create policy roles_aseo_select_propios on public.roles_aseo
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles_aseo' and policyname = 'roles_aseo_insert_propios') then
    create policy roles_aseo_insert_propios on public.roles_aseo
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
        and (inicia_alumno_id is null or exists (select 1 from public.alumnos a
              where a.id = inicia_alumno_id and a.grupo_id = roles_aseo.grupo_id and a.maestro_id = (select auth.uid())))
        and (siguiente_alumno_id is null or exists (select 1 from public.alumnos a
              where a.id = siguiente_alumno_id and a.grupo_id = roles_aseo.grupo_id and a.maestro_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles_aseo' and policyname = 'roles_aseo_update_propios') then
    create policy roles_aseo_update_propios on public.roles_aseo
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
        and (inicia_alumno_id is null or exists (select 1 from public.alumnos a
              where a.id = inicia_alumno_id and a.grupo_id = roles_aseo.grupo_id and a.maestro_id = (select auth.uid())))
        and (siguiente_alumno_id is null or exists (select 1 from public.alumnos a
              where a.id = siguiente_alumno_id and a.grupo_id = roles_aseo.grupo_id and a.maestro_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles_aseo' and policyname = 'roles_aseo_delete_propios') then
    create policy roles_aseo_delete_propios on public.roles_aseo
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- ── 3. delete_own_account ────────────────────────────────────────────────────
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

  -- Datos de Mi salón que no se borran en cascada con la cuenta (primero los que dependen de otros)
  delete from public.evaluacion_formativa where maestro_id = v;
  delete from public.calificaciones where maestro_id = v;
  delete from public.registro_diario where maestro_id = v;
  delete from public.boleta_trimestral where maestro_id = v;
  delete from public.evaluacion_diagnostica where maestro_id = v;
  delete from public.tareas where maestro_id = v;
  delete from public.productos_sesion where maestro_id = v;
  delete from public.dias_no_habiles_extra where maestro_id = v;
  delete from public.maestro_ajustes where maestro_id = v;
  delete from public.zz_deprecated_diagnosticos where maestro_id = v;
  -- Incidencias (b13): solo si ya existen en esta base
  if to_regclass('public.incidencia_alumnos') is not null then
    execute 'delete from public.incidencia_alumnos where maestro_id = $1' using v;
  end if;
  if to_regclass('public.incidencias') is not null then
    execute 'delete from public.incidencias where maestro_id = $1' using v;
  end if;
  -- Calendario del grupo y rol de aseo (b14)
  delete from public.roles_aseo where maestro_id = v;
  delete from public.calendario_ajustes where maestro_id = v;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
