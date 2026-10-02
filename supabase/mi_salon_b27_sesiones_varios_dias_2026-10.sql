-- =============================================================================
-- Mi salón B27: sesiones de varios días (Fase 5b del plan de Fanny, 2026-10-02)
--
-- Aditiva e idempotente (add column if not exists / create or replace / drop ... if exists / insert
-- ... on conflict do nothing). Sin begin/commit: el script de aplicación la envuelve en su transacción.
-- No borra ni cambia columnas, filas ni firmas de RPC existentes.
--
-- Hasta hoy una sesión tenía UN día (sesiones.fecha) y esa fecha hacía cuatro cosas: el día en que se
-- trabajó, la fecha de todos sus productos, la bandera "ya empezó" y, en las sueltas, el día de la
-- actividad. Esta migración agrega los datos para que una sesión se trabaje en varios días:
--
--   1. sesiones.terminada_en (date): el día de México en que se terminó la sesión. Null en las
--      terminadas antes de b27 (se usa su `fecha`) y en las que siguen abiertas.
--   2. productos_sesion.fecha_trabajo (date): el día en que se trabajó la actividad. Null quiere decir
--      "por trabajar" en una sesión empezada sin terminar o sin empezar; en una sesión terminada se lee
--      como terminada_en (o fecha si es de antes de b27). En las sueltas es la fecha de su sesión.
--   3. Tabla sesion_dias: los días reales en que se trabajó cada sesión; cerrado_en = ya se confirmó
--      qué actividades se trabajaron ese día.
--   4. sesion_terminada(sesiones): UN solo lugar para "terminada" = completada o con fecha anterior al
--      corte del 2026-09-30 (el CORTE_EN_CURSO de js/sesion-terminar.js; pruebas/dias-sesion.test.js los ata).
--   5. Triggers: sesiones.fecha -> sesion_dias (Trabajar hoy / Quitar de hoy); productos_sesion BEFORE
--      INSERT (el día de la actividad se pone ANTES de calcular es_historico, en la misma función
--      marca_historico_productos de b20); calificaciones AFTER (la primera captura de una actividad
--      sin día le pone el de la captura).
--   6. mover_producto_a_sesion (la de b19a más una línea): la actividad conserva su día.
--   7. Respaldo (idempotente) de lo que ya existe.
--
-- ORDEN: después de b25 (y b26). No depende del frontend: el frontend anterior no lee las columnas
-- nuevas y la cuenta sigue igual. El frontend de la Fase 5b SÍ las necesita (va después de esta).
--
-- REVERSA (a mano; el frontend de la Fase 5b dejaría de funcionar, el anterior no se entera):
--   drop trigger if exists calificaciones_dia_actividad on public.calificaciones;
--   drop trigger if exists sesiones_dias_trabajo on public.sesiones;
--   drop function if exists public.calificaciones_dia_actividad();
--   drop function if exists public.sesiones_dias_trabajo();
--   -- marca_historico_productos: volver a la de mi_salon_b20_registro_historico (create or replace)
--   -- mover_producto_a_sesion: volver a la de mi_salon_b19a_integridad (create or replace)
--   drop table if exists public.sesion_dias;
--   drop function if exists public.sesion_terminada(public.sesiones);
--   alter table public.productos_sesion drop column if exists fecha_trabajo;
--   alter table public.sesiones drop column if exists terminada_en;
-- =============================================================================


-- ── 1 y 2. Columnas ────────────────────────────────────────────────────────────
alter table public.sesiones add column if not exists terminada_en date;
alter table public.productos_sesion add column if not exists fecha_trabajo date;

comment on column public.sesiones.terminada_en is
  'Día de México en que se terminó la sesión (Terminar sesión). Null: terminada antes de b27 (se usa fecha) o aún abierta. mi_salon_b27.';
comment on column public.productos_sesion.fecha_trabajo is
  'Día en que se trabajó la actividad. Null: por trabajar (sesión empezada sin terminar, o sin empezar); en una sesión terminada se lee como terminada_en o, si es anterior a b27, fecha. En las sueltas, la fecha de su sesión. mi_salon_b27.';


-- ── 4. "Terminada" en un solo lugar ────────────────────────────────────────────
create or replace function public.sesion_terminada(s public.sesiones)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(s.estado_sesion = 'completada' or s.fecha < date '2026-09-30', false)
$$;
comment on function public.sesion_terminada(public.sesiones) is
  'Mi salón B27: sesión terminada = completada o con fecha anterior al corte 2026-09-30 (CORTE_EN_CURSO de js/sesion-terminar.js). En curso = con fecha y no terminada.';
grant execute on function public.sesion_terminada(public.sesiones) to authenticated;


-- ── 3. sesion_dias ─────────────────────────────────────────────────────────────
create table if not exists public.sesion_dias (
  id          uuid primary key default gen_random_uuid(),
  sesion_id   uuid not null references public.sesiones (id) on delete cascade,
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fecha       date not null,
  cerrado_en  timestamptz,
  created_at  timestamptz default now(),
  constraint sesion_dias_sesion_fecha_key unique (sesion_id, fecha)
);
comment on table public.sesion_dias is
  'Días reales en que se trabajó una sesión de proyecto. cerrado_en: ya se confirmó qué actividades se trabajaron ese día. mi_salon_b27.';
create index if not exists sesion_dias_maestro_idx on public.sesion_dias (maestro_id, fecha);

alter table public.sesion_dias enable row level security;
drop policy if exists "sesion_dias select propias" on public.sesion_dias;
drop policy if exists "sesion_dias insert propias" on public.sesion_dias;
drop policy if exists "sesion_dias update propias" on public.sesion_dias;
drop policy if exists "sesion_dias delete propias" on public.sesion_dias;
create policy "sesion_dias select propias" on public.sesion_dias
  for select to authenticated using ((select auth.uid()) = maestro_id);
create policy "sesion_dias insert propias" on public.sesion_dias
  for insert to authenticated with check ((select auth.uid()) = maestro_id and public.ref_propia_sesion(sesion_id));
create policy "sesion_dias update propias" on public.sesion_dias
  for update to authenticated using ((select auth.uid()) = maestro_id)
  with check ((select auth.uid()) = maestro_id and public.ref_propia_sesion(sesion_id));
create policy "sesion_dias delete propias" on public.sesion_dias
  for delete to authenticated using ((select auth.uid()) = maestro_id);
grant select, insert, update, delete on public.sesion_dias to authenticated;
revoke all on public.sesion_dias from anon;
select public.mi_salon_candado('public.sesion_dias');


-- ── 5a. sesiones.fecha -> sesion_dias (Trabajar hoy / Quitar de hoy) ───────────
create or replace function public.sesiones_dias_trabajo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select p.tipo into v_tipo from public.proyectos p where p.id = new.proyecto_id;
  if v_tipo is distinct from 'proyecto' then
    return new;
  end if;
  if new.fecha is not null and (tg_op = 'INSERT' or new.fecha is distinct from old.fecha) then
    insert into public.sesion_dias (sesion_id, maestro_id, fecha)
    values (new.id, new.maestro_id, new.fecha)
    on conflict (sesion_id, fecha) do nothing;
  elsif new.fecha is null and tg_op = 'UPDATE' and old.fecha is not null then
    delete from public.sesion_dias where sesion_id = new.id;
    -- Las actividades que nacieron con el día de la sesión (se agregaron mientras se trabajaba) vuelven a "por
    -- trabajar"; la que ya tiene una captura conserva su día (Hoy solo ofrece Quitar de hoy sin calificaciones)
    update public.productos_sesion ps set fecha_trabajo = null
      where ps.sesion_id = new.id and ps.fecha_trabajo is not null
        and not exists (select 1 from public.calificaciones c
                        where c.producto_sesion_id = ps.id
                          and (c.estado_entrega is not null or c.nivel is not null or c.puntaje is not null or c.retroalimentacion is not null));
  end if;
  return new;
end $$;
comment on function public.sesiones_dias_trabajo() is
  'Mi salón B27: de null a un día agrega sesion_dias(sesión, día); de un día a null (Quitar de hoy) borra los días de la sesión. Solo proyectos tipo proyecto.';
revoke all on function public.sesiones_dias_trabajo() from public, anon, authenticated;
drop trigger if exists sesiones_dias_trabajo on public.sesiones;
create trigger sesiones_dias_trabajo
  after insert or update of fecha on public.sesiones
  for each row execute function public.sesiones_dias_trabajo();


-- ── 5b. productos_sesion BEFORE INSERT: el día de la actividad y es_historico ──
-- La de b20 más fecha_trabajo. Un solo trigger (productos_sesion_marca_historico) y un solo orden:
-- primero el día, luego es_historico con ese día.
create or replace function public.marca_historico_productos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ses public.sesiones;
  v_tipo text;
  v_creado date;
  v_dia date;
begin
  if tg_op = 'INSERT' then
    v_creado := public.dia_mexico(coalesce(new.created_at, pg_catalog.now()));
    select * into v_ses from public.sesiones s where s.id = new.sesion_id;
    select p.tipo into v_tipo from public.proyectos p where p.id = v_ses.proyecto_id;

    if new.fecha_trabajo is null and v_ses.id is not null then
      if v_tipo = 'sueltas' then
        new.fecha_trabajo := v_ses.fecha;                       -- la suelta es de un día: el de su sesión
      elsif new.tipo is distinct from 'tarea' and v_ses.fecha is not null and not public.sesion_terminada(v_ses) then
        -- (una tarea de un proyecto no toma día: vence desde que se termina la sesión)
        new.fecha_trabajo := greatest(v_ses.fecha, v_creado);   -- se agrega mientras se trabaja
      end if;                                                   -- sin empezar o terminada: null
    end if;

    v_dia := coalesce(
      new.fecha_trabajo,
      case when v_ses.id is not null and public.sesion_terminada(v_ses)
           then coalesce(v_ses.terminada_en, v_ses.fecha) end);
    new.es_historico := coalesce(new.es_historico, false)
      or (v_dia is not null and v_dia < v_creado);
    new.desde_ponte_al_dia := coalesce(new.desde_ponte_al_dia, false);
  end if;
  return new;
end $$;
comment on function public.marca_historico_productos() is
  'Mi salón B20 + B27: fecha_trabajo de una actividad nueva (suelta: la de su sesión; sesión en curso: hoy; sin empezar o terminada: null) y es_historico (su día es anterior al de su creación).';
revoke all on function public.marca_historico_productos() from public, anon, authenticated;


-- ── 5c. calificaciones AFTER: la primera captura le pone día a la actividad ────
create or replace function public.calificaciones_dia_actividad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ses public.sesiones;
  v_tipo_proy text;
  v_filas integer;
begin
  if new.producto_sesion_id is null or new.fecha is null
     or (new.estado_entrega is null and new.nivel is null and new.puntaje is null and new.retroalimentacion is null) then
    return new;
  end if;
  select s.* into v_ses
    from public.productos_sesion ps join public.sesiones s on s.id = ps.sesion_id
    where ps.id = new.producto_sesion_id and ps.maestro_id = new.maestro_id;
  if v_ses.id is null or v_ses.fecha is null or public.sesion_terminada(v_ses) then
    return new;
  end if;
  select p.tipo into v_tipo_proy from public.proyectos p where p.id = v_ses.proyecto_id;
  if v_tipo_proy is distinct from 'proyecto' then
    return new;
  end if;
  update public.productos_sesion ps
    set fecha_trabajo = new.fecha
    where ps.id = new.producto_sesion_id and ps.maestro_id = new.maestro_id
      and ps.fecha_trabajo is null and ps.tipo is distinct from 'tarea';
  get diagnostics v_filas = row_count;
  if v_filas > 0 then
    insert into public.sesion_dias (sesion_id, maestro_id, fecha)
    values (v_ses.id, new.maestro_id, new.fecha)
    on conflict (sesion_id, fecha) do nothing;
  end if;
  return new;
end $$;
comment on function public.calificaciones_dia_actividad() is
  'Mi salón B27: la primera captura de una actividad (no tarea) de una sesión de proyecto en curso, sin día, le pone fecha_trabajo = calificaciones.fecha y agrega ese día a sesion_dias.';
revoke all on function public.calificaciones_dia_actividad() from public, anon, authenticated;
drop trigger if exists calificaciones_dia_actividad on public.calificaciones;
create trigger calificaciones_dia_actividad
  after insert or update on public.calificaciones
  for each row execute function public.calificaciones_dia_actividad();


-- ── 6. mover_producto_a_sesion: la actividad conserva su día ───────────────────
-- La MISMA de b19a, letra por letra, más una línea (marcada "b27") en el update del producto.
create or replace function public.mover_producto_a_sesion(p_producto uuid, p_sesion uuid, p_fecha_entrega date default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prod public.productos_sesion;
  v_ses_old public.sesiones;
  v_ses_new public.sesiones;
  v_p_old public.proyectos;
  v_p_new public.proyectos;
  v_orden smallint;
  v_nuevo uuid;
  l record;
  c record;
  v_solo boolean;
begin
  select * into v_prod from public.productos_sesion where id = p_producto and maestro_id = auth.uid();
  if v_prod.id is null then raise exception 'La actividad no existe o no es de tu cuenta' using errcode = '42501'; end if;
  select * into v_ses_old from public.sesiones where id = v_prod.sesion_id;
  select * into v_p_old from public.proyectos where id = v_ses_old.proyecto_id;
  select * into v_ses_new from public.sesiones where id = p_sesion and maestro_id = auth.uid();
  if v_ses_new.id is null then raise exception 'La sesión destino no existe o no es de tu cuenta' using errcode = '42501'; end if;
  select * into v_p_new from public.proyectos where id = v_ses_new.proyecto_id;
  if v_p_old.tipo is distinct from 'sueltas' then
    raise exception 'Solo se pasan a un proyecto las actividades sueltas' using errcode = 'P0001';
  end if;
  if v_p_new.tipo is distinct from 'proyecto' or v_p_new.grupo_id is distinct from v_p_old.grupo_id then
    raise exception 'La sesión destino debe ser de un proyecto del mismo grupo' using errcode = 'P0001';
  end if;
  if v_p_new.trimestre is distinct from v_p_old.trimestre then
    raise exception 'La sesión destino debe ser de un proyecto del mismo trimestre (sus calificaciones van a la misma boleta)' using errcode = 'P0001';
  end if;
  if v_ses_new.id = v_ses_old.id then return to_jsonb(v_prod); end if;

  -- PDA: el mismo en la sesión destino (o uno nuevo) y la liga movida
  for l in
    select psp.sesion_pda_id as viejo, sp.pda_id, sp.grado, sp.criterio_aplicado
    from public.producto_sesion_pda psp join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
    where psp.producto_sesion_id = p_producto
  loop
    v_nuevo := null;
    if l.pda_id is not null then
      select id into v_nuevo from public.sesiones_pda where sesion_id = p_sesion and pda_id = l.pda_id and grado = l.grado limit 1;
    else
      select id into v_nuevo from public.sesiones_pda where sesion_id = p_sesion and pda_id is null and grado = l.grado
        and criterio_aplicado is not distinct from l.criterio_aplicado limit 1;
    end if;
    if v_nuevo is null then
      insert into public.sesiones_pda (sesion_id, pda_id, grado, criterio_aplicado)
      values (p_sesion, l.pda_id, l.grado, l.criterio_aplicado) returning id into v_nuevo;
    end if;
    select not exists (select 1 from public.producto_sesion_pda x where x.sesion_pda_id = l.viejo and x.producto_sesion_id <> p_producto)
      into v_solo;
    delete from public.producto_sesion_pda where producto_sesion_id = p_producto and sesion_pda_id = l.viejo;
    insert into public.producto_sesion_pda (producto_sesion_id, sesion_pda_id) values (p_producto, v_nuevo) on conflict do nothing;
    -- Lo que la maestra ajustó a mano en ese PDA se va con la actividad (si el PDA era solo suyo)
    if v_solo then
      update public.evaluacion_formativa ef
        set sesion_pda_id = v_nuevo, sesion_id = p_sesion
        where ef.sesion_pda_id = l.viejo and ef.origen = 'maestro'
          and not exists (select 1 from public.evaluacion_formativa e2
                          where e2.sesion_id = p_sesion and e2.alumno_id = ef.alumno_id and e2.criterio = ef.criterio);
    end if;
  end loop;

  select least(coalesce(max(orden), 0) + 1, 32000) into v_orden from public.productos_sesion where sesion_id = p_sesion;
  -- b19a: la única vía para cambiar productos_sesion.sesion_id (trigger productos_sesion_sesion_fija)
  perform pg_catalog.set_config('jissez.mover_producto', p_producto::text, true);
  update public.productos_sesion
    set sesion_id = p_sesion, orden = v_orden,
        fecha_entrega = case when tipo = 'tarea' then coalesce(fecha_entrega, p_fecha_entrega) else fecha_entrega end,
        fecha_trabajo = coalesce(fecha_trabajo, v_ses_old.fecha) -- b27: la actividad conserva su día
    where id = p_producto
    returning * into v_prod;
  perform pg_catalog.set_config('jissez.mover_producto', '', true); -- b19a

  update public.calificaciones set sesion_id = p_sesion, proyecto_id = v_p_new.id
    where producto_sesion_id = p_producto and maestro_id = auth.uid();

  -- Evidencia: se recalcula en los PDA viejos (sin este producto) y en los nuevos (con él)
  for c in
    select distinct cal.alumno_id, a.grado from public.calificaciones cal join public.alumnos a on a.id = cal.alumno_id
    where cal.producto_sesion_id = p_producto and cal.maestro_id = auth.uid()
  loop
    for l in
      select sp.id from public.sesiones_pda sp where sp.sesion_id = v_ses_old.id and sp.grado = c.grado
    loop
      perform public.recalcular_evidencia_pda(c.alumno_id, l.id, auth.uid());
    end loop;
    for l in
      select psp.sesion_pda_id as id from public.producto_sesion_pda psp join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
      where psp.producto_sesion_id = p_producto and sp.grado = c.grado
    loop
      perform public.recalcular_evidencia_pda(c.alumno_id, l.id, auth.uid());
    end loop;
  end loop;

  -- PDA de la sesión suelta que quedaron sin productos ni evaluaciones: fuera (si no, "Qué le
  -- falta" los pediría como PDA trabajados sin evidencia)
  delete from public.sesiones_pda sp
    where sp.sesion_id = v_ses_old.id
      and not exists (select 1 from public.producto_sesion_pda x where x.sesion_pda_id = sp.id)
      and not exists (select 1 from public.evaluacion_formativa e where e.sesion_pda_id = sp.id);
  -- La sesión suelta sin productos ni evaluaciones ya no existe (no reparte participación ese día)
  if not exists (select 1 from public.productos_sesion where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.evaluacion_formativa where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.sesiones_pda where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.calificaciones where sesion_id = v_ses_old.id) then
    delete from public.sesiones where id = v_ses_old.id;
  end if;

  return to_jsonb(v_prod);
end $$;
revoke all on function public.mover_producto_a_sesion(uuid, uuid, date) from public, anon;
grant execute on function public.mover_producto_a_sesion(uuid, uuid, date) to authenticated;


-- ── 7. Respaldo (idempotente) ──────────────────────────────────────────────────
-- Corre como dueño de la base: no pasa por RLS. Los triggers de productos_sesion que se disparan con
-- estos UPDATE son "before update of activo" (no_quitar_calificado) y "before update of sesion_id"
-- (sesion_fija): ninguno se activa con fecha_trabajo. Nada cambia de otra columna.

-- 7a. Las actividades de las sueltas toman la fecha de su sesión
update public.productos_sesion ps
  set fecha_trabajo = s.fecha
  from public.sesiones s join public.proyectos p on p.id = s.proyecto_id
  where s.id = ps.sesion_id and p.tipo = 'sueltas'
    and ps.fecha_trabajo is null and s.fecha is not null;

-- 7b. Actividades (no tareas) de sesiones de proyecto TERMINADAS: hasta hoy toda sesión era de un día
update public.productos_sesion ps
  set fecha_trabajo = s.fecha
  from public.sesiones s join public.proyectos p on p.id = s.proyecto_id
  where s.id = ps.sesion_id and p.tipo = 'proyecto' and public.sesion_terminada(s)
    and ps.activo is true and ps.tipo is distinct from 'tarea'
    and ps.fecha_trabajo is null and s.fecha is not null;

-- 7c. Sesiones EN CURSO: las actividades con captura toman el primer día de captura; las demás, null
update public.productos_sesion ps
  set fecha_trabajo = c.dia
  from (
    select cal.producto_sesion_id as id, min(cal.fecha) as dia
    from public.calificaciones cal
    where cal.producto_sesion_id is not null and cal.fecha is not null
      and (cal.estado_entrega is not null or cal.nivel is not null or cal.puntaje is not null or cal.retroalimentacion is not null)
    group by cal.producto_sesion_id
  ) c,
  public.sesiones s, public.proyectos p
  where ps.id = c.id and s.id = ps.sesion_id and p.id = s.proyecto_id
    and p.tipo = 'proyecto' and s.fecha is not null and not public.sesion_terminada(s)
    and ps.activo is true and ps.tipo is distinct from 'tarea' and ps.fecha_trabajo is null;

-- 7d. sesion_dias: el día de cada sesión de proyecto con fecha (cerrado si está terminada; abierto si
--     está en curso, para que Hoy pregunte qué se trabajó) más los días de sus actividades
insert into public.sesion_dias (sesion_id, maestro_id, fecha, cerrado_en)
select s.id, s.maestro_id, s.fecha, case when public.sesion_terminada(s) then now() end
from public.sesiones s join public.proyectos p on p.id = s.proyecto_id
where p.tipo = 'proyecto' and s.fecha is not null
on conflict (sesion_id, fecha) do nothing;

insert into public.sesion_dias (sesion_id, maestro_id, fecha, cerrado_en)
select distinct s.id, s.maestro_id, ps.fecha_trabajo, case when public.sesion_terminada(s) then now() end
from public.productos_sesion ps
  join public.sesiones s on s.id = ps.sesion_id
  join public.proyectos p on p.id = s.proyecto_id
where p.tipo = 'proyecto' and ps.fecha_trabajo is not null and ps.tipo is distinct from 'tarea'
on conflict (sesion_id, fecha) do nothing;
