-- Mi salón B19 — Exámenes: "No presentó" y la cola sin señal (decisiones de Jorge, 2026-09-26)
--
-- Solo aditiva: una tabla nueva con RLS (examen_alumnos), una columna nueva de marca (captura_id)
-- en examen_respuestas y examen_resultados, tres funciones de trigger nuevas y delete_own_account
-- reemplazada por la versión COMPLETA (la misma, letra por letra, que dejan
-- jissez_interes_secciones, b17 y b18: ver abajo). No toca filas existentes. Se puede correr dos
-- veces ("if not exists" / "create or replace" / políticas con guarda). Va DESPUÉS de b18 (usa sus
-- tablas). Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de
-- Jorge y ANTES de publicar el frontend de exámenes (examen.html lee examen_alumnos y las marcas;
-- sin ellas la pantalla dice "No se pudo cargar" y nada se escribe a medias).
--
-- 1. "No presentó" (examen_alumnos): una fila por examen y alumno, no_presento true/false.
--    - Un alumno que no presentó NO cuenta en ese examen ni a favor ni en contra (el motor,
--      js/motor-calificacion.js aciertosExamenSalon, lo salta aunque tenga algo capturado).
--    - Cuenta como "listo" para que el examen quede "Calificado" (js/examen-modelo.js).
--    - Si después lo presenta, se captura normal: capturar sus respuestas o sus aciertos pone
--      no_presento en false (lo hace la pantalla, por la misma cola).
--    RLS: auth.uid() = maestro_id; al escribir, el examen es suyo y el alumno es suyo y del MISMO
--    grupo que el examen (decisión 4 de Jorge: referencias propias).
--
-- 2. La cola sin señal de Exámenes (js/bandeja-salida.js, la misma de Hoy): cada captura de un
--    examen (respuesta tocada o escaneada, calificación a mano, aciertos por campo, "No presentó")
--    se guarda primero en la tablet (IndexedDB, por cuenta) y se envía sola al volver la señal. Para
--    no pisar lo que otro aparato capturó, se usa la MISMA marca por grupo de campos que Hoy
--    (mi_salon_b12): una columna captura_id por tabla, un solo grupo por fila:
--      examen_respuestas  captura_id  respuesta + resultado + origen
--      examen_resultados  captura_id  aciertos + preguntas
--      examen_alumnos     captura_id  no_presento
--    La pantalla escribe su propia marca nueva (uuid del aparato) en cada captura; cualquier otra
--    escritura que cambie esos campos (otra versión de la app, SQL, el ajuste de preguntas de un
--    campo) recibe del trigger una marca del servidor; un INSERT sin marca recibe una. Así la cola
--    sabe si la fila sigue como la vio la pantalla (se escribe), si la cambió este mismo aparato
--    (gana el último toque) o si la cambió otro (NO se pisa y se avisa).
--    Los triggers no hacen DML y solo tocan captura_id. Los de updated_at (set_updated_at) no
--    cambian esos campos: el orden entre triggers BEFORE no importa.
--
-- 3. delete_own_account: una sola versión COMPLETA, idéntica en jissez_interes_secciones, b17, b18
--    y b19. Todo lo de b13 en adelante va con guarda to_regclass: cualquiera de esos archivos que se
--    aplique AL FINAL deja la función completa, sea cual sea el orden (pruebas/migraciones-orden
--    .test.js lo comprueba). Orden recomendado en producción: jissez_interes_secciones → b16 → b17 →
--    b18 → b18a → b19.

-- ── 1. examen_alumnos ────────────────────────────────────────────────────────
create table if not exists public.examen_alumnos (
  id           uuid primary key default gen_random_uuid(),
  maestro_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  examen_id    uuid not null references public.examenes_grupo (id) on delete cascade,
  alumno_id    uuid not null references public.alumnos (id) on delete cascade,
  no_presento  boolean not null default false,
  captura_id   uuid,
  updated_at   timestamptz not null default now()
);

comment on table public.examen_alumnos is
  'Estado de un alumno en un examen de Mi Salón: no_presento = no lo presentó (no cuenta ni a favor ni en contra; el examen puede quedar Calificado). mi_salon_b19.';
comment on column public.examen_alumnos.captura_id is
  'Marca de la última escritura de no_presento: uuid de una captura de la pantalla (generado en el aparato) o del servidor (trigger). mi_salon_b19.';

create unique index if not exists examen_alumnos_examen_alumno_uidx on public.examen_alumnos (examen_id, alumno_id);
create index if not exists examen_alumnos_alumno_idx on public.examen_alumnos (alumno_id);
create index if not exists examen_alumnos_maestro_idx on public.examen_alumnos (maestro_id);

-- ── 2. Marcas de captura ─────────────────────────────────────────────────────
alter table public.examen_respuestas add column if not exists captura_id uuid;
alter table public.examen_resultados add column if not exists captura_id uuid;

comment on column public.examen_respuestas.captura_id is
  'Marca de la última escritura de respuesta/resultado/origen (captura de la pantalla o del servidor). Null: sin cambios desde antes de la marca. mi_salon_b19.';
comment on column public.examen_resultados.captura_id is
  'Marca de la última escritura de aciertos/preguntas (captura de la pantalla o del servidor). Null: sin cambios desde antes de la marca. mi_salon_b19.';

create or replace function public.marca_captura_examen_respuestas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_id is null then new.captura_id := pg_catalog.gen_random_uuid(); end if;
  else
    if (new.respuesta is distinct from old.respuesta or new.resultado is distinct from old.resultado
        or new.origen is distinct from old.origen)
       and new.captura_id is not distinct from old.captura_id then
      new.captura_id := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

create or replace function public.marca_captura_examen_resultados()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_id is null then new.captura_id := pg_catalog.gen_random_uuid(); end if;
  else
    if (new.aciertos is distinct from old.aciertos or new.preguntas is distinct from old.preguntas)
       and new.captura_id is not distinct from old.captura_id then
      new.captura_id := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

create or replace function public.marca_captura_examen_alumnos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_id is null then new.captura_id := pg_catalog.gen_random_uuid(); end if;
  else
    if new.no_presento is distinct from old.no_presento
       and new.captura_id is not distinct from old.captura_id then
      new.captura_id := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

comment on function public.marca_captura_examen_respuestas() is
  'Mi salón B19: toda escritura de respuesta, resultado u origen deja una marca única (la de la captura o una del servidor).';
comment on function public.marca_captura_examen_resultados() is
  'Mi salón B19: toda escritura de aciertos o preguntas deja una marca única (la de la captura o una del servidor).';
comment on function public.marca_captura_examen_alumnos() is
  'Mi salón B19: toda escritura de no_presento deja una marca única (la de la captura o una del servidor).';

revoke all on function public.marca_captura_examen_respuestas() from public, anon, authenticated;
revoke all on function public.marca_captura_examen_resultados() from public, anon, authenticated;
revoke all on function public.marca_captura_examen_alumnos() from public, anon, authenticated;

create or replace trigger examen_respuestas_marca_captura
  before insert or update on public.examen_respuestas
  for each row execute function public.marca_captura_examen_respuestas();
create or replace trigger examen_resultados_marca_captura
  before insert or update on public.examen_resultados
  for each row execute function public.marca_captura_examen_resultados();
create or replace trigger examen_alumnos_marca_captura
  before insert or update on public.examen_alumnos
  for each row execute function public.marca_captura_examen_alumnos();

drop trigger if exists examen_alumnos_updated_at on public.examen_alumnos;
create trigger examen_alumnos_updated_at before update on public.examen_alumnos
  for each row execute function public.set_updated_at();

-- ── RLS de examen_alumnos ────────────────────────────────────────────────────
alter table public.examen_alumnos enable row level security;
revoke all on public.examen_alumnos from anon;
grant select, insert, update, delete on public.examen_alumnos to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_alumnos' and policyname = 'examen_alumnos_select_propios') then
    create policy examen_alumnos_select_propios on public.examen_alumnos
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_alumnos' and policyname = 'examen_alumnos_insert_propios') then
    create policy examen_alumnos_insert_propios on public.examen_alumnos
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_alumnos' and policyname = 'examen_alumnos_update_propios') then
    create policy examen_alumnos_update_propios on public.examen_alumnos
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_alumnos' and policyname = 'examen_alumnos_delete_propios') then
    create policy examen_alumnos_delete_propios on public.examen_alumnos
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- ── 3. delete_own_account (versión COMPLETA, idéntica en interes_secciones, b17, b18 y b19) ──
-- @@delete_own_account inicio
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
