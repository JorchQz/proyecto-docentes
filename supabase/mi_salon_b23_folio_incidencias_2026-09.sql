-- =============================================================================
-- Mi Salón b23: folio de las incidencias, calificación directa con la boleta cerrada, funciones
-- admin_ sin acceso anónimo y delete_own_account FINAL
-- (decisión de Jorge del 2026-09-26 sobre el folio; menores de los revisores R27a y R27b)
-- =============================================================================
--
-- ADITIVA: agrega una columna (incidencias.folio), una tabla (incidencias_folios), funciones y
-- triggers nuevos, y quita el permiso de ejecutar a anon en las funciones admin_. No borra
-- columnas ni datos. Idempotente (se puede volver a correr). Requiere b13 (incidencias), b20
-- (calificacion_directa), b21 (mi_salon_candado) y b22.
--
-- Qué hace:
--   1. Folio de cada incidencia, formato "RDI-2026-2027-0001" (Jorge, 2026-09-26):
--        RDI = Reporte De Incidencia; el ciclo escolar del GRUPO (grupos.ciclo_escolar); un
--        consecutivo de 4 dígitos propio de cada grupo y ciclo (pasado el 9999 sigue con 5).
--      - Lo asigna el SERVIDOR al crear la incidencia (trigger BEFORE INSERT: cubre
--        guardar_incidencia y cualquier otra alta; lo que mande el cliente se ignora) con un
--        contador por grupo y ciclo (incidencias_folios) que se incrementa con
--        insert ... on conflict do update: la fila del contador queda bloqueada hasta el final
--        de la transacción, así que dos altas al mismo tiempo nunca sacan el mismo número. El
--        índice único (grupo_id, folio) es la última defensa.
--      - Un folio borrado NO se reutiliza (es un registro formal): el contador nunca baja.
--      - No se puede editar: un UPDATE que lo cambie falla (hint 'folio_fijo').
--      - Las incidencias que ya existían reciben su folio en orden de creación (created_at, id)
--        por grupo y ciclo, y el contador queda en el último número asignado.
--   2. Borrar una calificación directa con la boleta de ese trimestre y campo CERRADA se rechaza
--      en el servidor (R27a): antes solo se validaban el alta y el cambio. Los borrados en
--      cascada (alumno o grupo) sí pasan.
--   3. Funciones admin_ (panel de la tienda y de Mi Salón): sin EXECUTE para anon ni PUBLIC
--      (R27b). Revisan es_admin() por dentro, pero no tienen por qué estar expuestas sin sesión.
--      Quien tenía el permiso por authenticated o service_role lo conserva. OJO: Supabase da
--      EXECUTE a anon en cada función nueva de public (privilegios por omisión): una función
--      admin_ nueva debe llevar su propio "revoke ... from public, anon".
--   4. delete_own_account: la versión FINAL (b22 + incidencias_folios).
--
-- ORDEN: iba al final de las que reemplazan delete_own_account (interes, b16, b17, b18, b18a, b19,
-- b19a, b20, b21, b22, b23); desde el 2026-09-29 la versión FINAL es la de b25 (agrega las
-- jornadas). b21b y b22_avisos_cron aparte. Antes que el frontend que muestra el folio.
-- =============================================================================


-- ── 1. Folio de las incidencias ────────────────────────────────────────────────

-- Ciclo del folio: "2026-2027" desde grupos.ciclo_escolar (acepta "2026 - 2027", "2026/2027");
-- si el texto no trae dos años, el ciclo de la fecha (agosto a julio). grupos.ciclo_escolar es
-- NOT NULL, así que lo normal es el del grupo.
create or replace function public.incidencias_ciclo_folio(p_ciclo text, p_fecha date)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select r[1] || '-' || r[2] from regexp_match(coalesce(p_ciclo, ''), '(\d{4})\D+(\d{4})') as r),
    case when extract(month from coalesce(p_fecha, current_date)) >= 8
         then extract(year from coalesce(p_fecha, current_date))::int || '-' || (extract(year from coalesce(p_fecha, current_date))::int + 1)
         else (extract(year from coalesce(p_fecha, current_date))::int - 1) || '-' || extract(year from coalesce(p_fecha, current_date))::int
    end);
$$;
revoke all on function public.incidencias_ciclo_folio(text, date) from public, anon;
grant execute on function public.incidencias_ciclo_folio(text, date) to authenticated;

-- "RDI-2026-2027-0001" (4 dígitos; con 10000 o más, los que haga falta)
create or replace function public.incidencias_texto_folio(p_ciclo text, p_numero integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'RDI-' || p_ciclo || '-' || case when p_numero < 10000 then lpad(p_numero::text, 4, '0') else p_numero::text end;
$$;
revoke all on function public.incidencias_texto_folio(text, integer) from public, anon;
grant execute on function public.incidencias_texto_folio(text, integer) to authenticated;

-- Contador por grupo y ciclo: el último número asignado. Nunca baja (un folio borrado no se
-- reutiliza). Solo lo escribe el trigger (security definer); el docente puede leer el suyo.
create table if not exists public.incidencias_folios (
  grupo_id       uuid not null references public.grupos (id) on delete cascade,
  ciclo          text not null,
  maestro_id     uuid not null references auth.users (id) on delete cascade,
  ultimo         integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (grupo_id, ciclo),
  constraint incidencias_folios_ultimo check (ultimo >= 0),
  constraint incidencias_folios_ciclo check (ciclo ~ '^\d{4}-\d{4}$')
);
comment on table public.incidencias_folios is
  'Último folio de incidencia asignado por grupo y ciclo (RDI-ciclo-0001). Nunca baja: un folio borrado no se reutiliza. Lo escribe solo el trigger incidencias_folio (mi_salon_b23).';
create index if not exists incidencias_folios_maestro_idx on public.incidencias_folios (maestro_id);

alter table public.incidencias_folios enable row level security;
revoke all on public.incidencias_folios from anon, authenticated;
grant select on public.incidencias_folios to authenticated;
drop policy if exists incidencias_folios_select_propios on public.incidencias_folios;
create policy incidencias_folios_select_propios on public.incidencias_folios
  for select to authenticated using ((select auth.uid()) = maestro_id);
-- Candado de solo lectura (b21), como toda tabla del SaaS. El docente no la escribe directo (no
-- tiene permiso); el trigger corre como su dueño.
select public.mi_salon_candado('public.incidencias_folios');

alter table public.incidencias add column if not exists folio text;
comment on column public.incidencias.folio is
  'Folio de la incidencia, RDI-<ciclo del grupo>-<consecutivo de 4 dígitos por grupo y ciclo>. Lo asigna el servidor al crearla (trigger incidencias_folio); no se edita ni se reutiliza. mi_salon_b23.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'incidencias_folio_formato') then
    alter table public.incidencias add constraint incidencias_folio_formato
      check (folio is null or folio ~ '^RDI-\d{4}-\d{4}-\d{4,}$');
  end if;
end $$;
create unique index if not exists incidencias_folio_unico on public.incidencias (grupo_id, folio);

create or replace function public.incidencias_folio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ciclo text;
  v_n integer;
begin
  if tg_op = 'UPDATE' then
    if old.folio is not null and new.folio is distinct from old.folio then
      raise exception 'El folio de una incidencia no se puede cambiar' using errcode = 'P0001', hint = 'folio_fijo';
    end if;
    return new;
  end if;
  -- Alta: el folio lo pone SIEMPRE el servidor (lo que traiga el cliente se ignora)
  select public.incidencias_ciclo_folio(g.ciclo_escolar, new.fecha) into v_ciclo
    from public.grupos g where g.id = new.grupo_id;
  v_ciclo := coalesce(v_ciclo, public.incidencias_ciclo_folio(null, new.fecha));
  insert into public.incidencias_folios as f (grupo_id, ciclo, maestro_id, ultimo)
  values (new.grupo_id, v_ciclo, new.maestro_id, 1)
  on conflict (grupo_id, ciclo) do update set ultimo = f.ultimo + 1, actualizado_en = now()
  returning f.ultimo into v_n;
  new.folio := public.incidencias_texto_folio(v_ciclo, v_n);
  return new;
end $$;
comment on function public.incidencias_folio() is
  'Mi salón B23: asigna el folio RDI-ciclo-0001 al crear una incidencia (contador por grupo y ciclo, con bloqueo) e impide cambiarlo.';
revoke all on function public.incidencias_folio() from public, anon, authenticated;

drop trigger if exists incidencias_folio on public.incidencias;
create trigger incidencias_folio
  before insert or update of folio on public.incidencias
  for each row execute function public.incidencias_folio();

-- Las incidencias que ya existían: folio en orden de creación por grupo y ciclo, después del
-- último que ya tuviera el contador (si esta migración se vuelve a correr, no se repite nada)
with sin_folio as (
  select i.id, i.grupo_id, i.maestro_id, public.incidencias_ciclo_folio(g.ciclo_escolar, i.fecha) as ciclo, i.created_at
    from public.incidencias i
    join public.grupos g on g.id = i.grupo_id
   where i.folio is null
), numeradas as (
  select s.id, s.ciclo,
         coalesce((select f.ultimo from public.incidencias_folios f where f.grupo_id = s.grupo_id and f.ciclo = s.ciclo), 0)
           + row_number() over (partition by s.grupo_id, s.ciclo order by s.created_at, s.id) as n
    from sin_folio s
)
update public.incidencias i
   set folio = public.incidencias_texto_folio(n.ciclo, n.n::int)
  from numeradas n
 where n.id = i.id;

insert into public.incidencias_folios as f (grupo_id, ciclo, maestro_id, ultimo)
select i.grupo_id, substring(i.folio from 5 for 9), (array_agg(i.maestro_id))[1],
       max((regexp_match(i.folio, '(\d+)$'))[1]::int)
  from public.incidencias i
 where i.folio is not null
 group by i.grupo_id, substring(i.folio from 5 for 9)
on conflict (grupo_id, ciclo) do update set ultimo = greatest(f.ultimo, excluded.ultimo), actualizado_en = now();

alter table public.incidencias alter column folio set not null;


-- ── 2. Calificación directa: tampoco se borra con la boleta cerrada ─────────────
/*
  b20 validaba el alta y el cambio (calificacion_directa_valida) pero no el borrado: con la boleta
  de ese trimestre y campo cerrada, borrar la directa se aceptaba (R27a). Ahora se rechaza con el
  mismo mensaje y la misma pista ('boleta_cerrada'). pg_trigger_depth() > 1: los borrados en
  cascada (se borra el alumno o el grupo) no se detienen. delete_own_account borra
  boleta_trimestral antes, así que la cuenta se puede borrar siempre. SECURITY INVOKER: lee la
  boleta con la RLS del docente.
*/
create or replace function public.calificacion_directa_no_borrar_cerrada()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.boleta_trimestral b
             where b.maestro_id = old.maestro_id and b.alumno_id = old.alumno_id and b.ciclo = old.ciclo
               and b.trimestre = old.trimestre and b.campo = old.campo and b.cerrada) then
    raise exception 'La boleta de ese trimestre ya está cerrada: no se borra su calificación'
      using errcode = 'P0001', hint = 'boleta_cerrada';
  end if;
  return old;
end $$;
comment on function public.calificacion_directa_no_borrar_cerrada() is
  'Mi salón B23: la calificación directa no se borra si la boleta de ese trimestre y campo está cerrada (salvo en cascada).';
revoke all on function public.calificacion_directa_no_borrar_cerrada() from public, anon, authenticated;

drop trigger if exists calificacion_directa_no_borrar_cerrada on public.calificacion_directa;
create trigger calificacion_directa_no_borrar_cerrada
  before delete on public.calificacion_directa
  for each row execute function public.calificacion_directa_no_borrar_cerrada();


-- ── 3. Funciones admin_: sin anon ni PUBLIC ──────────────────────────────────────
-- Todas las admin_ de public (admin_ajustar_lanzamiento, admin_confirmar_orden,
-- admin_estado_precios, admin_estado_promocion, admin_guardar_promocion, admin_otorgar_acceso y
-- las demás). Conservan authenticated y service_role si los tenían (el panel entra con sesión).
do $$
declare
  f record;
  v_auth boolean;
  v_srv boolean;
begin
  for f in select p.oid, p.oid::regprocedure::text as firma
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%'
  loop
    v_auth := has_function_privilege('authenticated', f.oid, 'execute');
    v_srv := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.firma);
    if v_auth then execute format('grant execute on function %s to authenticated', f.firma); end if;
    if v_srv then execute format('grant execute on function %s to service_role', f.firma); end if;
  end loop;
end $$;


-- ── 4. delete_own_account: la versión FINAL (b22 + incidencias_folios) ──────────────
/*
  ORDEN: antes de b25, que es la última. Varias migraciones reemplazan delete_own_account completa (b10,
  jissez_interes_secciones, b17, b18, b19, b19a, b20, b21, b22 y esta). La que se aplica al último
  es la que queda (desde b25, esa; esta es la anterior); esta es la de b22 (b19a completa, b20, b21 y la guarda de pagos de Mi Salón,
  mi_salon_ordenes) más el contador de folios de incidencias de b23 (también se iría en cascada con
  los grupos). Cada tabla nueva con guarda to_regclass. La prueba pruebas/migraciones-orden.test.js
  exige todo esto de la última del orden.
*/
-- @@delete_own_account inicio (b23; la versión FINAL es la de b25)
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
  -- Contador de folios de incidencias (b23; también se va en cascada con los grupos)
  if to_regclass('public.incidencias_folios') is not null then
    execute 'delete from public.incidencias_folios where maestro_id = $1' using v;
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

-- PostgREST: que vea la columna, la tabla y las funciones nuevas
notify pgrst, 'reload schema';
