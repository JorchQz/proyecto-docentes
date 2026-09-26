-- Jissez — "Avísame" de las secciones que aún no abren (decisión de Jorge, 2026-09-26)
--
-- Solo aditiva: una tabla nueva con RLS y delete_own_account reemplazada (la versión completa,
-- idéntica en b17, b18 y b19; todo lo de b13 en adelante con guarda to_regclass). No toca filas existentes. Se puede
-- correr dos veces ("if not exists" / "create or replace" / políticas con guarda). Va después de
-- mi_salon_b15_listas_2026-09.sql. Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción,
-- con la confirmación de Jorge y ANTES de publicar las páginas de presentación
-- (tienda/conoce-sala.html y tienda/conoce-mi-salon.html; sin la tabla, el botón dice que no se pudo
-- guardar).
--
-- Qué es: la lista de cuentas que pidieron que se les avise cuando abra una sección.
--   seccion 'sala'     → Sala de Maestros ("Avísame cuando abra", tienda/conoce-sala.html)
--   seccion 'mi_salon' → Mi Salón mientras no tenga precio ("Avísame cuando esté disponible",
--                        tienda/conoce-mi-salon.html)
-- Una fila por cuenta y sección (índice único): pedirlo dos veces no duplica. Quitar el aviso
-- borra la fila.
--
-- Sin escritura anónima, para evitar spam: solo una cuenta con sesión guarda su interés. Quien no
-- tiene sesión inicia sesión o se registra (tienda/login.html?next=...) y regresa.
--
-- RLS: cada cuenta inserta, ve y borra solo lo suyo (auth.uid() = usuario_id); nadie actualiza
-- (no hay nada que cambiar). anon sin permisos. Para leer quién pidió el aviso, Jorge usa el
-- editor SQL de Supabase (rol con acceso total), por ejemplo:
--   select i.seccion, u.email, i.created_at
--   from public.interes_secciones i join auth.users u on u.id = i.usuario_id
--   order by i.seccion, i.created_at;
--
-- Borrar la CUENTA: delete_own_account borra sus filas (y la cascada de auth.users también).

-- ── interes_secciones ───────────────────────────────────────────────────────
create table if not exists public.interes_secciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seccion     text not null,
  created_at  timestamptz not null default now(),
  constraint interes_secciones_seccion_valida check (seccion in ('sala', 'mi_salon'))
);

comment on table public.interes_secciones is
  'Cuentas que pidieron aviso cuando abra una sección de Jissez: sala (Sala de Maestros) o mi_salon (Mi Salón, mientras no tenga precio). Una fila por cuenta y sección.';

create unique index if not exists interes_secciones_usuario_seccion_uidx
  on public.interes_secciones (usuario_id, seccion);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.interes_secciones enable row level security;

revoke all on public.interes_secciones from anon;
revoke all on public.interes_secciones from authenticated;
grant select, insert, delete on public.interes_secciones to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'interes_secciones' and policyname = 'interes_secciones_select_propios') then
    create policy interes_secciones_select_propios on public.interes_secciones
      for select to authenticated using ((select auth.uid()) = usuario_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'interes_secciones' and policyname = 'interes_secciones_insert_propios') then
    create policy interes_secciones_insert_propios on public.interes_secciones
      for insert to authenticated with check ((select auth.uid()) = usuario_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'interes_secciones' and policyname = 'interes_secciones_delete_propios') then
    create policy interes_secciones_delete_propios on public.interes_secciones
      for delete to authenticated using ((select auth.uid()) = usuario_id);
  end if;
end $$;

-- ── delete_own_account: también los avisos ──────────────────────────────────
-- La versión COMPLETA (b10, b13, b14, b15, interes_secciones, b17 y los exámenes de b18/b19), la
-- misma letra por letra que dejan b17, b18 y b19. Todo lo de b13 en adelante con guarda to_regclass:
-- sirve aunque alguna de esas tablas no exista todavía, y el orden de aplicación no importa.
-- @@delete_own_account inicio (versión COMPLETA, idéntica en jissez_interes_secciones, b17, b18 y b19)
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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin
