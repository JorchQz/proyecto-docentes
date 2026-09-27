-- Mi salón B20 — Registro histórico: "Ponte al día", calificación directa del trimestre y la marca
-- es_historico (spec de Jorge del 2026-09-26, jissez-spec-mi-salon-cobros.md §4)
--
-- Solo aditiva: dos tablas nuevas con RLS (calificacion_directa, ponte_al_dia), columnas nuevas en
-- asistencias, calificaciones y productos_sesion, funciones de trigger nuevas, una función nueva
-- (agregar_actividades_historicas) y delete_own_account reemplazada por la versión COMPLETA de b19a
-- más las dos tablas nuevas (con guarda to_regclass). No toca filas existentes (las columnas nuevas
-- nacen con su valor por omisión: false / null). Se puede correr dos veces ("if not exists" /
-- "create or replace" / políticas con guarda). Va DESPUÉS de b17, b18 y b19 (usa sus funciones y
-- tablas). Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de
-- Jorge y ANTES de publicar el frontend (Hoy, Inicio, Tareas, el motor y Ponte al día leen las
-- columnas y tablas nuevas; sin ellas la pantalla dice "No se pudo cargar" y nada se escribe a medias).
--
-- 1. es_historico (spec §4.3). Toda captura con fecha anterior al día en que se crea el registro:
--      asistencias.es_historico    fecha < día de capturado_en
--      calificaciones.es_historico fecha < día de capturado_en (la fecha de una calificación
--                                  histórica es la de su actividad; la de Hoy, el día de captura)
--      productos_sesion.es_historico  la fecha de su sesión < el día en que se creó el producto
--    capturado_en: el momento de la captura (el aparato lo manda; si no, el de la base; en
--    calificaciones, evaluado_en, que la cola de Hoy ya manda con el momento de la captura). El día
--    se cuenta en hora de Ciudad de México, como el resto de la app. La marca se decide al CREAR la
--    fila y ya no cambia al editarla (salvo que cambie su fecha): es de "cuándo se registró".
--    Los triggers la calculan siempre: el cliente no la puede poner a mano (salvo el producto, que
--    marca agregar_actividades_historicas: sus actividades son históricas por definición).
--    Con la marca: "Incompleta pasa a la siguiente clase" no aplica (js/alcance-hoy.js
--    cambiosIncompleta), Hoy/Inicio/Tareas no piden revisar tareas históricas, Qué le falta solo
--    cuenta lo registrado, y la boleta impresa no la muestra (solo lógica interna y métricas).
--    productos_sesion.desde_ponte_al_dia: creado desde el asistente (Hoy no lo abre "para calificar
--    ahora": ya se calificó en la cuadrícula del asistente; y sirve para medir su uso).
--
-- 2. calificacion_directa (spec §4.2): la calificación del trimestre por alumno y campo formativo,
--    capturada directamente (un concentrado en papel o Excel). El motor la toma EN LUGAR de la
--    calculada con las actividades (js/motor-calificacion.js aplicarDirectas) y, por decisión de
--    Jorge del 2026-09-26, cuenta YA como la calificación CONFIRMADA de la boleta en ese campo
--    (boleta_trimestral.calificacion_confirmada, art. 4 XI: el docente la eligió al capturarla; §2b):
--    no se confirma otra vez. Se cambia o se borra mientras la boleta no esté cerrada; borrarla
--    vuelve al cálculo automático (que el docente confirma en Reportes). Aquí no hay porcentaje: es la calificación, y
--    se valida contra la escala del grado del alumno (piso_calificacion_boleta: 1° de 6 a 10; 2° a
--    6° de 5 a 10). Con la boleta de ese trimestre y campo cerrada no se crea ni se cambia (lo
--    entregado no se mueve). Siempre es registro histórico (es_historico = true).
--
-- 3. ponte_al_dia: el avance del asistente por grupo (paso, saltado o terminado) para retomarlo
--    desde Inicio y medir cuántos docentes lo usan (spec §8).
--
-- 4. agregar_actividades_historicas(grupo, items, capturado_en): crea VARIAS actividades sueltas de
--    días pasados en una sola transacción (agregar_actividad_suelta de b17 para cada una) y las
--    marca es_historico y desde_ponte_al_dia.
--
-- 5. delete_own_account: la versión COMPLETA de b19a (b19 + marketplace_busquedas_vacias y
--    productos_finales) más calificacion_directa y ponte_al_dia (con
--    guarda to_regclass). Va después de b19 y b19a; b21 y b22 la vuelven a reemplazar con todo lo de
--    esta más sus tablas (la que queda es la de b22).

-- ── 1. Columnas es_historico y capturado_en ─────────────────────────────────
alter table public.asistencias add column if not exists capturado_en timestamptz;
alter table public.asistencias add column if not exists es_historico boolean not null default false;
alter table public.calificaciones add column if not exists capturado_en timestamptz;
alter table public.calificaciones add column if not exists es_historico boolean not null default false;
alter table public.productos_sesion add column if not exists es_historico boolean not null default false;
alter table public.productos_sesion add column if not exists desde_ponte_al_dia boolean not null default false;

comment on column public.asistencias.capturado_en is
  'Momento en que se capturó por primera vez (el del aparato o el de la base). La fecha de la asistencia va aparte. mi_salon_b20.';
comment on column public.asistencias.es_historico is
  'Registro histórico: su fecha es anterior al día en que se capturó (hora de Ciudad de México). No genera avisos ni incidencias; no se muestra en la boleta. mi_salon_b20.';
comment on column public.calificaciones.capturado_en is
  'Momento en que se capturó por primera vez (el del aparato, evaluado_en o el de la base). mi_salon_b20.';
comment on column public.calificaciones.es_historico is
  'Registro histórico: su fecha (la de la actividad) es anterior al día en que se capturó. mi_salon_b20.';
comment on column public.productos_sesion.es_historico is
  'Actividad histórica: la fecha de su sesión es anterior al día en que se creó. Incompleta no pasa a la siguiente clase y Hoy no la pide como pendiente. mi_salon_b20.';
comment on column public.productos_sesion.desde_ponte_al_dia is
  'Creada desde el asistente Ponte al día (se calificó en su cuadrícula; Hoy no la abre para calificar). mi_salon_b20.';

-- Día en hora de Ciudad de México de un instante
create or replace function public.dia_mexico(p_instante timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (coalesce(p_instante, pg_catalog.now()) at time zone 'America/Mexico_City')::date
$$;
grant execute on function public.dia_mexico(timestamptz) to authenticated;

create or replace function public.marca_historico_asistencias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.capturado_en := coalesce(new.capturado_en, pg_catalog.now());
    new.es_historico := new.fecha < public.dia_mexico(new.capturado_en);
  else
    -- Se decide al crear la fila: editarla no la cambia (salvo que cambie su fecha)
    new.capturado_en := coalesce(old.capturado_en, new.capturado_en);
    if new.fecha is distinct from old.fecha and new.capturado_en is not null then
      new.es_historico := new.fecha < public.dia_mexico(new.capturado_en);
    else
      new.es_historico := old.es_historico;
    end if;
  end if;
  return new;
end $$;

create or replace function public.marca_historico_calificaciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.capturado_en := coalesce(new.capturado_en, new.evaluado_en, pg_catalog.now());
    new.es_historico := new.fecha < public.dia_mexico(new.capturado_en);
  else
    new.capturado_en := coalesce(old.capturado_en, new.capturado_en);
    if new.fecha is distinct from old.fecha and new.capturado_en is not null then
      new.es_historico := new.fecha < public.dia_mexico(new.capturado_en);
    else
      new.es_historico := old.es_historico;
    end if;
  end if;
  return new;
end $$;

-- Producto: histórico si su sesión es de un día anterior al de su creación. Un producto que
-- agregar_actividades_historicas marca (true) se queda así.
create or replace function public.marca_historico_productos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fecha date;
begin
  if tg_op = 'INSERT' then
    select s.fecha into v_fecha from public.sesiones s where s.id = new.sesion_id;
    new.es_historico := coalesce(new.es_historico, false)
      or (v_fecha is not null and v_fecha < public.dia_mexico(coalesce(new.created_at, pg_catalog.now())));
    new.desde_ponte_al_dia := coalesce(new.desde_ponte_al_dia, false);
  end if;
  return new;
end $$;

comment on function public.marca_historico_asistencias() is
  'Mi salón B20: capturado_en y es_historico de una asistencia (fecha anterior al día de su captura). Se decide al crearla.';
comment on function public.marca_historico_calificaciones() is
  'Mi salón B20: capturado_en y es_historico de una calificación (fecha anterior al día de su captura). Se decide al crearla.';
comment on function public.marca_historico_productos() is
  'Mi salón B20: es_historico de un producto (su sesión es de un día anterior al de su creación).';

revoke all on function public.marca_historico_asistencias() from public, anon, authenticated;
revoke all on function public.marca_historico_calificaciones() from public, anon, authenticated;
revoke all on function public.marca_historico_productos() from public, anon, authenticated;

create or replace trigger asistencias_marca_historico
  before insert or update on public.asistencias
  for each row execute function public.marca_historico_asistencias();
create or replace trigger calificaciones_marca_historico
  before insert or update on public.calificaciones
  for each row execute function public.marca_historico_calificaciones();
create or replace trigger productos_sesion_marca_historico
  before insert on public.productos_sesion
  for each row execute function public.marca_historico_productos();

-- ── 2. calificacion_directa ─────────────────────────────────────────────────
create table if not exists public.calificacion_directa (
  id            uuid primary key default gen_random_uuid(),
  maestro_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id      uuid not null references public.grupos (id) on delete cascade,
  alumno_id     uuid not null references public.alumnos (id) on delete cascade,
  ciclo         text not null,
  trimestre     smallint not null check (trimestre between 1 and 3),
  campo         text not null check (campo in ('LEN', 'SAB', 'ETI', 'DHL')),
  calificacion  smallint not null check (calificacion between 5 and 10),
  es_historico  boolean not null default true,
  capturado_en  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.calificacion_directa is
  'Calificación del trimestre capturada directamente por el docente (registro histórico: un concentrado en papel o Excel). Cuenta YA como la confirmada de boleta_trimestral en ese campo (decisión de Jorge del 2026-09-26; trigger calificacion_directa_a_boleta). Se cambia o se borra mientras la boleta no esté cerrada; borrarla vuelve al cálculo automático. mi_salon_b20.';

create unique index if not exists calificacion_directa_uidx on public.calificacion_directa (maestro_id, alumno_id, ciclo, trimestre, campo);
create index if not exists calificacion_directa_grupo_idx on public.calificacion_directa (grupo_id, trimestre);
create index if not exists calificacion_directa_alumno_idx on public.calificacion_directa (alumno_id);

/*
  Validación: el alumno es del grupo; el ciclo es el del grupo (si no llega); la calificación está
  en la escala del grado del alumno (piso_calificacion_boleta, la misma de la boleta); y la boleta
  de ese trimestre y campo no está cerrada. Borrar no se valida: con la boleta cerrada, lo
  entregado sale de su foto y no de aquí.
*/
create or replace function public.calificacion_directa_valida()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grado smallint;
  v_grupo uuid;
  v_ciclo text;
  v_piso smallint;
begin
  select a.grado, a.grupo_id into v_grado, v_grupo from public.alumnos a where a.id = new.alumno_id;
  if v_grupo is null or v_grupo is distinct from new.grupo_id then
    raise exception 'El alumno no es de ese grupo' using errcode = 'P0001';
  end if;
  select g.ciclo_escolar into v_ciclo from public.grupos g where g.id = new.grupo_id;
  if new.ciclo is null or btrim(new.ciclo) = '' then new.ciclo := v_ciclo; end if;
  v_piso := public.piso_calificacion_boleta(v_grado);
  if v_piso is null or new.calificacion < v_piso or new.calificacion > 10 then
    raise exception 'La calificación de %° va de % a 10', v_grado, coalesce(v_piso, 5)
      using errcode = 'check_violation', hint = 'fuera_de_escala';
  end if;
  if exists (select 1 from public.boleta_trimestral b
             where b.maestro_id = new.maestro_id and b.alumno_id = new.alumno_id and b.ciclo = new.ciclo
               and b.trimestre = new.trimestre and b.campo = new.campo and b.cerrada) then
    raise exception 'La boleta de ese trimestre ya está cerrada: no se cambia su calificación'
      using errcode = 'P0001', hint = 'boleta_cerrada';
  end if;
  new.es_historico := true;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.capturado_en := old.capturado_en;
  end if;
  return new;
end $$;

comment on function public.calificacion_directa_valida() is
  'Mi salón B20: la calificación directa va en la escala del grado del alumno y no cambia una boleta cerrada.';
revoke all on function public.calificacion_directa_valida() from public, anon, authenticated;

create or replace trigger calificacion_directa_valida
  before insert or update on public.calificacion_directa
  for each row execute function public.calificacion_directa_valida();

alter table public.calificacion_directa enable row level security;
revoke all on public.calificacion_directa from anon;
grant select, insert, update, delete on public.calificacion_directa to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calificacion_directa' and policyname = 'calificacion_directa_select_propias') then
    create policy calificacion_directa_select_propias on public.calificacion_directa
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calificacion_directa' and policyname = 'calificacion_directa_insert_propias') then
    create policy calificacion_directa_insert_propias on public.calificacion_directa
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g
                    join public.alumnos a on a.grupo_id = g.id
                    where g.id = grupo_id and g.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calificacion_directa' and policyname = 'calificacion_directa_update_propias') then
    create policy calificacion_directa_update_propias on public.calificacion_directa
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g
                    join public.alumnos a on a.grupo_id = g.id
                    where g.id = grupo_id and g.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calificacion_directa' and policyname = 'calificacion_directa_delete_propias') then
    create policy calificacion_directa_delete_propias on public.calificacion_directa
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- Candado de solo lectura de Mi Salón (b21) en la tabla nueva del SaaS. En el orden de producción
-- b21 va DESPUÉS y la incluye en su lista; esto cubre volver a correr b20 con b21 ya aplicada.
-- ponte_al_dia NO lleva candado a propósito: es el avance del asistente, no una captura (se puede
-- ocultar o retomar aun en solo lectura).
do $$
begin
  if to_regprocedure('public.mi_salon_candado(regclass)') is not null then
    perform public.mi_salon_candado('public.calificacion_directa');
  end if;
end $$;

-- ── 2b. La calificación directa cuenta YA como confirmada ─────────────────────
/*
  Decisión de Jorge (2026-09-26): la calificación que el docente captura directamente (Ponte al
  día, paso 4) ES la calificación confirmada de la boleta en ese campo: no hay que confirmarla otra
  vez. Se puede cambiar o borrar mientras la boleta no esté cerrada.
    - Al crearla o cambiarla: boleta_trimestral de ese alumno, ciclo, trimestre y campo queda con
      calificacion = la directa, calificacion_confirmada = true (el trigger de la boleta pone
      confirmada_en), porcentaje null (no sale de las actividades) y nivel por los cortes de la
      conversión (9-10 logrado, 7-8 en proceso, 5-6 requiere apoyo; igual que el motor).
    - Al borrarla: si la boleta de ese campo sigue abierta y confirmada con ESE número, deja de
      estar confirmada y su número se limpia (vuelve al cálculo automático, que el docente confirma
      en Reportes). Una boleta cerrada no se toca (lo entregado no se mueve).
    - Si el docente cambia en Reportes la confirmada de un campo con directa, la directa toma ese
      número (espejo): así "Capturada directamente" nunca muestra otro número que el confirmado.
  pg_trigger_depth() > 1: el espejo de un lado no vuelve a disparar el del otro, y un borrado en
  cascada (alumno o grupo) no toca la boleta (se borra con ellos). SECURITY INVOKER: pasa por RLS y
  por el candado de solo lectura (b21) como cualquier escritura del docente. Exportar, la junta y
  la boleta leen la confirmada de boleta_trimestral, así que la directa ya sale en todas.
*/
create or replace function public.calificacion_directa_a_boleta()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'DELETE' then
    update public.boleta_trimestral b
       set calificacion_confirmada = false, calificacion = null, porcentaje = null, nivel = null
     where b.maestro_id = old.maestro_id and b.alumno_id = old.alumno_id and b.ciclo = old.ciclo
       and b.trimestre = old.trimestre and b.campo = old.campo
       and not coalesce(b.cerrada, false) and b.calificacion_confirmada and b.calificacion = old.calificacion;
    return null;
  end if;
  insert into public.boleta_trimestral
    (maestro_id, alumno_id, ciclo, trimestre, campo, calificacion, porcentaje, nivel, calificacion_confirmada)
  values (new.maestro_id, new.alumno_id, new.ciclo, new.trimestre, new.campo, new.calificacion, null,
          case when new.calificacion >= 9 then 'logrado' when new.calificacion >= 7 then 'en_proceso' else 'requiere_apoyo' end,
          true)
  on conflict (maestro_id, alumno_id, ciclo, trimestre, campo) do update
    set calificacion = excluded.calificacion, porcentaje = null, nivel = excluded.nivel, calificacion_confirmada = true
    where not coalesce(public.boleta_trimestral.cerrada, false)
      and (public.boleta_trimestral.calificacion is distinct from excluded.calificacion
           or not coalesce(public.boleta_trimestral.calificacion_confirmada, false)
           or public.boleta_trimestral.porcentaje is not null);
  return null;
end $$;

comment on function public.calificacion_directa_a_boleta() is
  'Mi salón B20: la calificación directa es la confirmada de boleta_trimestral en su campo (decisión de Jorge del 2026-09-26); borrarla vuelve al cálculo automático si la boleta sigue abierta.';
revoke all on function public.calificacion_directa_a_boleta() from public, anon, authenticated;

drop trigger if exists calificacion_directa_a_boleta on public.calificacion_directa;
create trigger calificacion_directa_a_boleta
  after insert or update of calificacion or delete on public.calificacion_directa
  for each row execute function public.calificacion_directa_a_boleta();

-- Espejo: la confirmada que el docente cambia en Reportes pasa a la directa de ese campo
create or replace function public.boleta_a_calificacion_directa()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.campo not in ('LEN', 'SAB', 'ETI', 'DHL') or not coalesce(new.calificacion_confirmada, false)
     or new.calificacion is null or coalesce(new.cerrada, false) then
    return null;
  end if;
  update public.calificacion_directa d
     set calificacion = new.calificacion, updated_at = now()
   where d.maestro_id = new.maestro_id and d.alumno_id = new.alumno_id and d.ciclo = new.ciclo
     and d.trimestre = new.trimestre and d.campo = new.campo
     and d.calificacion is distinct from new.calificacion;
  return null;
end $$;

comment on function public.boleta_a_calificacion_directa() is
  'Mi salón B20: la confirmada que cambia en la boleta pasa a la calificación directa del mismo campo (si existe).';
revoke all on function public.boleta_a_calificacion_directa() from public, anon, authenticated;

drop trigger if exists boleta_trimestral_a_directa on public.boleta_trimestral;
create trigger boleta_trimestral_a_directa
  after insert or update of calificacion, calificacion_confirmada on public.boleta_trimestral
  for each row execute function public.boleta_a_calificacion_directa();

-- Las directas que ya existían (solo en pruebas; en producción no hay): quedan confirmadas en su
-- boleta abierta, si su número sigue en la escala del grado de hoy del alumno
insert into public.boleta_trimestral
  (maestro_id, alumno_id, ciclo, trimestre, campo, calificacion, porcentaje, nivel, calificacion_confirmada)
select d.maestro_id, d.alumno_id, d.ciclo, d.trimestre, d.campo, d.calificacion, null,
       case when d.calificacion >= 9 then 'logrado' when d.calificacion >= 7 then 'en_proceso' else 'requiere_apoyo' end,
       true
  from public.calificacion_directa d
  join public.alumnos a on a.id = d.alumno_id
 where d.calificacion >= coalesce(public.piso_calificacion_boleta(a.grado), 11)
on conflict (maestro_id, alumno_id, ciclo, trimestre, campo) do update
  set calificacion = excluded.calificacion, porcentaje = null, nivel = excluded.nivel, calificacion_confirmada = true
  where not coalesce(public.boleta_trimestral.cerrada, false)
    and (public.boleta_trimestral.calificacion is distinct from excluded.calificacion
         or not coalesce(public.boleta_trimestral.calificacion_confirmada, false)
         or public.boleta_trimestral.porcentaje is not null);

-- ── 3. ponte_al_dia ─────────────────────────────────────────────────────────
create table if not exists public.ponte_al_dia (
  id            uuid primary key default gen_random_uuid(),
  maestro_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id      uuid not null references public.grupos (id) on delete cascade,
  estado        text not null default 'en_curso' check (estado in ('en_curso', 'saltado', 'terminado')),
  paso          smallint not null default 1 check (paso between 1 and 4),
  pasos_hechos  smallint[] not null default '{}'::smallint[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  terminado_en  timestamptz
);

comment on table public.ponte_al_dia is
  'Avance del asistente Ponte al día por grupo: paso actual, pasos hechos y si se saltó o terminó (se retoma desde Inicio; métricas de uso). mi_salon_b20.';

create unique index if not exists ponte_al_dia_grupo_uidx on public.ponte_al_dia (grupo_id);
create index if not exists ponte_al_dia_maestro_idx on public.ponte_al_dia (maestro_id);

drop trigger if exists ponte_al_dia_updated_at on public.ponte_al_dia;
create trigger ponte_al_dia_updated_at before update on public.ponte_al_dia
  for each row execute function public.set_updated_at();

alter table public.ponte_al_dia enable row level security;
revoke all on public.ponte_al_dia from anon;
grant select, insert, update, delete on public.ponte_al_dia to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ponte_al_dia' and policyname = 'ponte_al_dia_select_propios') then
    create policy ponte_al_dia_select_propios on public.ponte_al_dia
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ponte_al_dia' and policyname = 'ponte_al_dia_insert_propios') then
    create policy ponte_al_dia_insert_propios on public.ponte_al_dia
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ponte_al_dia' and policyname = 'ponte_al_dia_update_propios') then
    create policy ponte_al_dia_update_propios on public.ponte_al_dia
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ponte_al_dia' and policyname = 'ponte_al_dia_delete_propios') then
    create policy ponte_al_dia_delete_propios on public.ponte_al_dia
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- ── 4. Varias actividades de días pasados en una transacción ────────────────
/*
  agregar_actividades_historicas(grupo, items, capturado_en) → [{ producto, sesion, proyecto_id }]
  items: [{ fecha, producto: {tipo, nombre, grados, modalidad, campo}, asignacion: [...], crear: [...] }]
  Cada una con agregar_actividad_suelta (b17: contenedor "Actividades del trimestre", sesión de esa
  fecha y campo, producto con su "para quién" y sus PDA). Todas o ninguna. Las marca
  es_historico (su fecha es anterior al día de captura, que la pantalla ya revisó) y
  desde_ponte_al_dia.
*/
create or replace function public.agregar_actividades_historicas(
  p_grupo uuid, p_items jsonb, p_capturado_en timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  it jsonb;
  r jsonb;
  salida jsonb := '[]'::jsonb;
  ids uuid[] := '{}'::uuid[];
  v_fecha date;
  v_hoy date := public.dia_mexico(p_capturado_en);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay actividades que guardar' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'Guarda a lo más 60 actividades a la vez' using errcode = 'P0001';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_fecha := nullif(it->>'fecha', '')::date;
    if v_fecha is null or v_fecha >= v_hoy then
      raise exception 'Cada actividad del registro histórico debe ser de un día anterior a hoy' using errcode = 'P0001';
    end if;
    r := public.agregar_actividad_suelta(p_grupo, v_fecha, it->'producto',
      coalesce(it->'asignacion', '[]'::jsonb), coalesce(it->'crear', '[]'::jsonb));
    ids := ids || ((r->'producto'->>'id')::uuid);
    salida := salida || jsonb_build_array(r);
  end loop;
  update public.productos_sesion set es_historico = true, desde_ponte_al_dia = true
    where id = any (ids) and maestro_id = auth.uid();
  -- Lo que se devuelve ya trae la marca
  select coalesce(jsonb_agg(
    jsonb_set(x.value, '{producto}', (x.value->'producto') || jsonb_build_object('es_historico', true, 'desde_ponte_al_dia', true))
    order by x.ord), '[]'::jsonb)
    into salida
    from jsonb_array_elements(salida) with ordinality as x(value, ord);
  return salida;
end $$;

comment on function public.agregar_actividades_historicas(uuid, jsonb, timestamptz) is
  'Mi salón B20: varias actividades sueltas de días pasados (registro histórico, Ponte al día) en una transacción.';
revoke all on function public.agregar_actividades_historicas(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.agregar_actividades_historicas(uuid, jsonb, timestamptz) to authenticated;

-- ── 5. delete_own_account (versión COMPLETA de b19a + b20) ──────────────────
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

  -- Búsquedas sin resultados de la tienda (b19a: no se borraban; user_id sin llave foránea)
  if to_regclass('public.marketplace_busquedas_vacias') is not null then
    execute 'delete from public.marketplace_busquedas_vacias where user_id = $1' using v;
  end if;
  -- Productos finales (tabla legada, sin pantalla que la escriba; b19a): su llave a grupos no
  -- tiene cascada y hacía fallar el borrado de la cuenta
  if to_regclass('public.productos_finales') is not null then
    execute 'delete from public.productos_finales where maestro_id = $1 or grupo_id in (select id from public.grupos where maestro_id = $1)' using v;
  end if;
  -- Registro histórico (b20): calificación directa y avance de Ponte al día
  if to_regclass('public.calificacion_directa') is not null then
    execute 'delete from public.calificacion_directa where maestro_id = $1' using v;
  end if;
  if to_regclass('public.ponte_al_dia') is not null then
    execute 'delete from public.ponte_al_dia where maestro_id = $1' using v;
  end if;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin
