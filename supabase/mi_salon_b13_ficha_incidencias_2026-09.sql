-- Mi salón B13: ficha del alumno, director del grupo e incidencias (decisiones de Jorge, 2026-09-25)
--
-- Solo aditiva: columnas NULAS nuevas, dos tablas nuevas, una función nueva y delete_own_account
-- reemplazada (la misma de mi_salon_b10_eliminar_cuenta_2026-09.sql con una línea más). No toca
-- filas existentes. Se puede correr dos veces ("if not exists" / "create or replace" / los
-- constraints y políticas se crean solo si faltan).
-- Aplicada en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción solo con la confirmación de Jorge y
-- ANTES de publicar el frontend (Mi grupo lee las columnas nuevas; sin ellas la lista de alumnos
-- no se puede leer).
--
-- 1. Ficha del alumno (todo opcional; SIN CURP, decisión de Jorge):
--      alumnos.fecha_nacimiento  date   entre 1990 y 2100 (la regla fina "edad de primaria" va en la
--                                       pantalla, js/ficha-alumno.js: un CHECK con current_date no es
--                                       inmutable)
--      alumnos.genero            text   'nina' | 'nino' | 'prefiero_no_decir'
--      alumnos.tutor_nombre      text   hasta 120 caracteres
--      alumnos.tutor_telefono    text   exactamente 10 dígitos (México, sin +52: la pantalla lo
--                                       normaliza y el enlace de WhatsApp le antepone 52)
--    El alta rápida del onboarding no cambia (no manda estas columnas).
--
-- 2. Datos de la escuela POR GRUPO (una maestra puede tener grupos en escuelas distintas):
--      grupos.escuela            ya existía (la edita Mi grupo y la escribe el onboarding): se reutiliza
--      grupos.director_nombre    text, nuevo, hasta 120 caracteres
--    CCT por grupo: NO se agrega. grupos no tiene nada parecido (solo perfiles.cct, que es de la
--    maestra, no del grupo); decisión de Jorge: si no existe, no se agrega.
--
-- 3. Incidencias (registro de sucesos del salón), por grupo:
--      incidencias           una fila por suceso: asunto, fecha, hora (opcional), descripción,
--                            acuerdos (opcional), maestro_id, grupo_id
--      incidencia_alumnos    tabla puente (incidencia ↔ alumno), con maestro_id para RLS
--    Se eligió tabla puente y no un arreglo de uuid: con la puente la base garantiza que cada alumno
--    existe (FK) y es del MISMO grupo y de la MISMA maestra (política de insert), y al borrar un alumno
--    su vínculo se va solo; un arreglo no admite FK y dejaría ids huérfanos.
--    Integridad al borrar (lo conservador, documentado):
--      - Borrar un GRUPO borra sus incidencias (ON DELETE CASCADE): son registros de ese grupo,
--        como su asistencia y sus calificaciones.
--      - Borrar un ALUMNO lo quita de las incidencias donde aparece (la fila puente se va en cascada),
--        pero la incidencia NO se borra: puede involucrar a otros alumnos y es el registro del grupo.
--        Así "eliminar alumno" borra sus datos personales (el aviso de privacidad lo promete) sin
--        perder el registro de lo que pasó. Lo que la maestra haya escrito a mano en la descripción
--        no se toca (se avisa en la pantalla y en el borrador del aviso).
--      - Borrar la CUENTA: delete_own_account borra las incidencias de la maestra (y la cascada de
--        auth.users → grupos también las alcanzaría).
--    Guardar (alta y edición) va por la función guardar_incidencia (SECURITY INVOKER: corre con los
--    permisos y la RLS de la maestra) para que la incidencia y su lista de alumnos cambien en UNA
--    transacción: si un alumno no es del grupo, no se guarda nada.
--
-- 4. delete_own_account: además borra incidencia_alumnos e incidencias.
--
-- Revisado con las columnas nuevas: el alta de alumnos de onboarding y de Mi grupo insertan por
-- nombre de columna; GrupoActivo y hoy.js leen grupos con select * (una columna más no estorba);
-- ninguna función SQL inserta en alumnos o grupos por posición; cerrar_boleta no lee estas columnas.
-- La copia de estructura de .qa (extraer-estructura.js) copia todo el esquema public, así que al
-- aplicarse en producción la tabla nueva viaja sola a una base de pruebas nueva.

-- ── 1. Ficha del alumno ──────────────────────────────────────────────────────
alter table public.alumnos add column if not exists fecha_nacimiento date;
alter table public.alumnos add column if not exists genero text;
alter table public.alumnos add column if not exists tutor_nombre text;
alter table public.alumnos add column if not exists tutor_telefono text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alumnos_genero_valido') then
    alter table public.alumnos add constraint alumnos_genero_valido
      check (genero is null or genero in ('nina', 'nino', 'prefiero_no_decir'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alumnos_tutor_telefono_10_digitos') then
    alter table public.alumnos add constraint alumnos_tutor_telefono_10_digitos
      check (tutor_telefono is null or tutor_telefono ~ '^[0-9]{10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alumnos_fecha_nacimiento_rango') then
    alter table public.alumnos add constraint alumnos_fecha_nacimiento_rango
      check (fecha_nacimiento is null or (fecha_nacimiento >= date '1990-01-01' and fecha_nacimiento < date '2100-01-01'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alumnos_tutor_nombre_largo') then
    alter table public.alumnos add constraint alumnos_tutor_nombre_largo
      check (tutor_nombre is null or char_length(tutor_nombre) <= 120);
  end if;
end $$;

comment on column public.alumnos.fecha_nacimiento is 'Ficha (opcional): fecha de nacimiento. La pantalla pide una edad razonable para primaria (js/ficha-alumno.js).';
comment on column public.alumnos.genero is 'Ficha (opcional): nina | nino | prefiero_no_decir. Null = sin dato.';
comment on column public.alumnos.tutor_nombre is 'Ficha (opcional): nombre de la madre, padre o tutor.';
comment on column public.alumnos.tutor_telefono is 'Ficha (opcional): teléfono del tutor, 10 dígitos de México sin +52 (WhatsApp: wa.me/52 + este número).';

-- ── 2. Director del grupo ────────────────────────────────────────────────────
alter table public.grupos add column if not exists director_nombre text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grupos_director_nombre_largo') then
    alter table public.grupos add constraint grupos_director_nombre_largo
      check (director_nombre is null or char_length(director_nombre) <= 120);
  end if;
end $$;

comment on column public.grupos.director_nombre is 'Nombre del director o directora de la escuela de ESTE grupo (firma de las incidencias). Opcional.';

-- ── 3. Incidencias ───────────────────────────────────────────────────────────
create table if not exists public.incidencias (
  id          uuid primary key default gen_random_uuid(),
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id    uuid not null references public.grupos (id) on delete cascade,
  asunto      text not null,
  fecha       date not null,
  hora        time,
  descripcion text not null,
  acuerdos    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint incidencias_asunto_largo check (char_length(btrim(asunto)) between 1 and 150),
  constraint incidencias_descripcion_largo check (char_length(btrim(descripcion)) between 1 and 5000),
  constraint incidencias_acuerdos_largo check (acuerdos is null or char_length(acuerdos) <= 5000),
  constraint incidencias_fecha_rango check (fecha >= date '2000-01-01' and fecha < date '2100-01-01')
);

comment on table public.incidencias is 'Registro de sucesos del salón, por grupo (asunto, fecha y hora, descripción, acuerdos). Los alumnos involucrados, en incidencia_alumnos. Se guarda con guardar_incidencia().';

create index if not exists incidencias_maestro_grupo_fecha_idx on public.incidencias (maestro_id, grupo_id, fecha desc);
create index if not exists incidencias_grupo_idx on public.incidencias (grupo_id);

create table if not exists public.incidencia_alumnos (
  incidencia_id uuid not null references public.incidencias (id) on delete cascade,
  alumno_id     uuid not null references public.alumnos (id) on delete cascade,
  maestro_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (incidencia_id, alumno_id)
);

comment on table public.incidencia_alumnos is 'Alumnos involucrados en cada incidencia. Borrar un alumno lo quita de sus incidencias (cascada) sin borrar la incidencia.';

create index if not exists incidencia_alumnos_alumno_idx on public.incidencia_alumnos (alumno_id);
create index if not exists incidencia_alumnos_maestro_idx on public.incidencia_alumnos (maestro_id);

alter table public.incidencias enable row level security;
alter table public.incidencia_alumnos enable row level security;

-- Sin acceso anónimo (la RLS ya lo impediría; así ni siquiera hay permiso de tabla)
revoke all on public.incidencias from anon;
revoke all on public.incidencia_alumnos from anon;
grant select, insert, update, delete on public.incidencias to authenticated;
grant select, insert, delete on public.incidencia_alumnos to authenticated;

do $$
begin
  -- incidencias: cada maestra solo las suyas, y solo en un grupo suyo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencias' and policyname = 'incidencias_select_propias') then
    create policy incidencias_select_propias on public.incidencias
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencias' and policyname = 'incidencias_insert_propias') then
    create policy incidencias_insert_propias on public.incidencias
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencias' and policyname = 'incidencias_update_propias') then
    create policy incidencias_update_propias on public.incidencias
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencias' and policyname = 'incidencias_delete_propias') then
    create policy incidencias_delete_propias on public.incidencias
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;

  -- incidencia_alumnos: el vínculo solo entre una incidencia y un alumno de la MISMA maestra y del
  -- MISMO grupo. Sin update (se borra y se vuelve a insertar).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencia_alumnos' and policyname = 'incidencia_alumnos_select_propios') then
    create policy incidencia_alumnos_select_propios on public.incidencia_alumnos
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencia_alumnos' and policyname = 'incidencia_alumnos_insert_propios') then
    create policy incidencia_alumnos_insert_propios on public.incidencia_alumnos
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (
          select 1
          from public.incidencias i
          join public.alumnos a on a.grupo_id = i.grupo_id
          where i.id = incidencia_id
            and a.id = alumno_id
            and i.maestro_id = (select auth.uid())
            and a.maestro_id = (select auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidencia_alumnos' and policyname = 'incidencia_alumnos_delete_propios') then
    create policy incidencia_alumnos_delete_propios on public.incidencia_alumnos
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- Guardar una incidencia y su lista de alumnos en UNA transacción (alta si p_id es null; si no,
-- edición). SECURITY INVOKER: la RLS de arriba decide todo (grupo propio, alumnos del grupo).
-- Devuelve el id. Exige al menos un alumno.
create or replace function public.guardar_incidencia(
  p_id uuid,
  p_grupo_id uuid,
  p_asunto text,
  p_fecha date,
  p_hora time,
  p_descripcion text,
  p_acuerdos text,
  p_alumnos uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v uuid := auth.uid();
  v_id uuid;
  v_alumnos uuid[] := coalesce(p_alumnos, '{}'::uuid[]);
begin
  if v is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(v_alumnos) = 0 then
    raise exception 'Elige al menos un alumno' using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.incidencias (maestro_id, grupo_id, asunto, fecha, hora, descripcion, acuerdos)
    values (v, p_grupo_id, btrim(p_asunto), p_fecha, p_hora, btrim(p_descripcion), nullif(btrim(coalesce(p_acuerdos, '')), ''))
    returning id into v_id;
  else
    update public.incidencias
       set asunto = btrim(p_asunto),
           fecha = p_fecha,
           hora = p_hora,
           descripcion = btrim(p_descripcion),
           acuerdos = nullif(btrim(coalesce(p_acuerdos, '')), ''),
           updated_at = now()
     where id = p_id and maestro_id = v and grupo_id = p_grupo_id
    returning id into v_id;
    if v_id is null then
      raise exception 'La incidencia no existe o no es de este grupo' using errcode = 'no_data_found';
    end if;
  end if;

  delete from public.incidencia_alumnos
   where incidencia_id = v_id and not (alumno_id = any (v_alumnos));
  insert into public.incidencia_alumnos (incidencia_id, alumno_id, maestro_id)
  select distinct v_id, x, v from unnest(v_alumnos) as x
  on conflict (incidencia_id, alumno_id) do nothing;

  return v_id;
end $$;

revoke all on function public.guardar_incidencia(uuid, uuid, text, date, time, text, text, uuid[]) from public, anon;
grant execute on function public.guardar_incidencia(uuid, uuid, text, date, time, text, text, uuid[]) to authenticated;

-- ── 4. Eliminar cuenta: también las incidencias ──────────────────────────────
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
  -- Incidencias (B13): la cascada de la cuenta ya las alcanza; se borran explícitamente para que
  -- no dependan de ella
  delete from public.incidencia_alumnos where maestro_id = v;
  delete from public.incidencias where maestro_id = v;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
