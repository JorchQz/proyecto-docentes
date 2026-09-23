-- ============================================================================
-- MI SALÓN B.5 — propagación a PDA y avance por criterio (2026-09-23)
-- El maestro califica el producto UNA vez y la trazabilidad por PDA se llena sola.
-- HISTORIA: manda la BD.
-- ============================================================================

-- ── De dónde viene cada evidencia ───────────────────────────────────────────
-- 'automatico' la pone el trigger al calificar un producto; 'maestro' la escribió
-- la pantalla de evaluación formativa. El trigger NUNCA pisa lo del maestro.
alter table public.evaluacion_formativa
  add column origen text not null default 'maestro'
  check (origen in ('automatico', 'maestro'));

-- ── Qué semáforo se propaga ─────────────────────────────────────────────────
create or replace function public.nivel_desde_calificacion(p_nivel text, p_puntaje numeric, p_estado text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_nivel is not null then p_nivel
    when p_estado in ('justificado', 'no_aplica') then null
    when p_puntaje is not null then
      case when p_puntaje >= 8 then 'logrado'
           when p_puntaje >= 6 then 'en_proceso'
           else 'requiere_apoyo' end
    when p_estado = 'no_entregado' then 'requiere_apoyo'
    else null end
$$;

create or replace function public.propagar_calificacion_a_pda()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_nivel text;
  v_grado smallint;
  v_fecha date;
begin
  if new.producto_sesion_id is null then return null; end if;

  v_nivel := public.nivel_desde_calificacion(new.nivel, new.puntaje, new.estado_entrega);
  select grado into v_grado from public.alumnos where id = new.alumno_id;
  v_fecha := coalesce(new.fecha, current_date);

  if v_nivel is null then
    delete from public.evaluacion_formativa ef
    where ef.alumno_id = new.alumno_id
      and ef.origen = 'automatico'
      and ef.sesion_pda_id in (
        select psp.sesion_pda_id from public.producto_sesion_pda psp
        join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
        where psp.producto_sesion_id = new.producto_sesion_id and sp.grado = v_grado);
    return null;
  end if;

  insert into public.evaluacion_formativa
    (maestro_id, sesion_id, alumno_id, criterio, sesion_pda_id, semaforo, fecha, origen)
  select new.maestro_id, sp.sesion_id, new.alumno_id,
         coalesce(nullif(sp.criterio_aplicado, ''), cp.pda, 'Criterio de la sesión'),
         sp.id, v_nivel, v_fecha, 'automatico'
  from public.producto_sesion_pda psp
  join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
  left join public.catalogo_pda cp on cp.id = sp.pda_id
  where psp.producto_sesion_id = new.producto_sesion_id
    and sp.grado = v_grado
  on conflict (sesion_id, alumno_id, criterio) do update
    set semaforo = excluded.semaforo,
        sesion_pda_id = excluded.sesion_pda_id,
        fecha = excluded.fecha
    where public.evaluacion_formativa.origen = 'automatico';

  return null;
end $$;

drop trigger if exists propagar_calificacion_a_pda on public.calificaciones;
create trigger propagar_calificacion_a_pda
  after insert or update of nivel, puntaje, estado_entrega, producto_sesion_id on public.calificaciones
  for each row execute function public.propagar_calificacion_a_pda();

create or replace function public.retirar_evidencia_de_pda()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_grado smallint;
begin
  if old.producto_sesion_id is null then return null; end if;
  select grado into v_grado from public.alumnos where id = old.alumno_id;
  delete from public.evaluacion_formativa ef
  where ef.alumno_id = old.alumno_id
    and ef.origen = 'automatico'
    and ef.sesion_pda_id in (
      select psp.sesion_pda_id from public.producto_sesion_pda psp
      join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
      where psp.producto_sesion_id = old.producto_sesion_id and sp.grado = v_grado);
  return null;
end $$;

create trigger retirar_evidencia_de_pda
  after delete on public.calificaciones
  for each row execute function public.retirar_evidencia_de_pda();

grant execute on function public.nivel_desde_calificacion(text, numeric, text) to authenticated;

-- ── Criterio libre (sin PDA del catálogo) ───────────────────────────────────
-- pda_id era NOT NULL, pero los dos escritores (sesiones-materializar.js y el
-- backfill de evaluacion_formativa.js) insertan null cuando el criterio es libre.
alter table public.sesiones_pda alter column pda_id drop not null;
create unique index sesiones_pda_criterio_libre_uniq
  on public.sesiones_pda (sesion_id, grado, criterio_aplicado)
  where pda_id is null;

-- ── Avance por PDA ──────────────────────────────────────────────────────────
-- Una fila por alumno y PDA dentro del trimestre. security_invoker: cada maestro ve
-- solo lo suyo. El campo formativo sale con su nombre largo; la equivalencia a
-- LEN/SAB/ETI/DHL vive en js/campos-formativos.js y se aplica en el frontend.
create or replace view public.v_avance_pda with (security_invoker = true) as
with base as (
  select
    ef.maestro_id, ef.alumno_id, ef.semaforo, ef.fecha, ef.criterio, ef.origen,
    sp.pda_id, sp.grado,
    s.id as sesion_id, s.campo_formativo, s.numero_sesion,
    p.id as proyecto_id, p.trimestre, p.grupo_id,
    cp.pda as pda_texto, cc.contenido,
    coalesce(sp.pda_id::text, ef.criterio) as clave_pda,
    case ef.semaforo when 'logrado' then 3 when 'en_proceso' then 2 else 1 end as valor
  from public.evaluacion_formativa ef
  join public.sesiones s on s.id = ef.sesion_id
  join public.proyectos p on p.id = s.proyecto_id
  left join public.sesiones_pda sp on sp.id = ef.sesion_pda_id
  left join public.catalogo_pda cp on cp.id = sp.pda_id
  left join public.catalogo_contenidos cc on cc.id = cp.contenido_id
  where ef.semaforo is not null
),
ordenadas as (
  select base.*,
    row_number() over (p_pda order by fecha, numero_sesion, sesion_id) as orden,
    count(*) over (p_pda) as total
  from base
  window p_pda as (partition by maestro_id, alumno_id, trimestre, clave_pda)
)
select
  maestro_id, alumno_id, grupo_id, trimestre, clave_pda,
  max(pda_id::text)::uuid as pda_id,
  max(grado) as grado,
  max(campo_formativo) as campo_formativo,
  max(coalesce(pda_texto, criterio)) as pda,
  max(contenido) as contenido,
  count(*) as evidencias,
  mode() within group (order by semaforo) as nivel_predominante,
  round(avg(valor), 2) as promedio,
  count(*) filter (where semaforo = 'logrado') as logrados,
  count(*) filter (where semaforo = 'en_proceso') as en_proceso,
  count(*) filter (where semaforo = 'requiere_apoyo') as requiere_apoyo,
  count(*) filter (where origen = 'maestro') as ajustadas_por_el_maestro,
  min(fecha) as primera_evidencia,
  max(fecha) as ultima_evidencia,
  case
    when count(*) < 2 then 'sin_datos'
    when avg(valor) filter (where orden > total / 2.0) >
         avg(valor) filter (where orden <= total / 2.0) then 'mejora'
    when avg(valor) filter (where orden > total / 2.0) <
         avg(valor) filter (where orden <= total / 2.0) then 'baja'
    else 'estable'
  end as tendencia
from ordenadas
group by maestro_id, alumno_id, grupo_id, trimestre, clave_pda;

grant select on public.v_avance_pda to authenticated;
