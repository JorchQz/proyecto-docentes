-- ============================================================================
-- MI SALÓN PARTE B.0 — correcciones previas (2026-09-22)
-- Aplicadas con apply_migration, una por bloque, en este orden. HISTORIA: manda
-- la BD. Base legal (Acuerdo 10/09/23 SEP, DOF 27/09/2023):
--   art. 9  Fase 3 (1°-2°) enteros 6-10; Fases 4-5 (3°-6°) enteros 5-10, 5 reprobatorio.
--   art. 7 I d  la asistencia es referente, no criterio de acreditación.
-- ============================================================================

-- ── b01_calificacion_boleta_por_fase ────────────────────────────────────────
create or replace function public.piso_calificacion_boleta(p_grado smallint)
returns smallint language sql immutable as $$
  select case when p_grado between 1 and 2 then 6::smallint
              when p_grado between 3 and 6 then 5::smallint end
$$;

create or replace function public.calcular_calificacion_boleta(p_porcentaje numeric, p_grado smallint)
returns smallint language plpgsql immutable as $$
declare v smallint;
begin
  if p_porcentaje is null then return null; end if;
  if p_grado is null or p_grado not between 1 and 6 then
    raise exception 'calcular_calificacion_boleta: grado inválido (%)', p_grado;
  end if;
  v := case when p_porcentaje >= 90 then 10
            when p_porcentaje >= 80 then 9
            when p_porcentaje >= 70 then 8
            when p_porcentaje >= 60 then 7
            when p_porcentaje >= 50 then 6
            else 5 end;
  return greatest(v, public.piso_calificacion_boleta(p_grado));
end $$;

create or replace function public.boleta_trimestral_valida_piso()
returns trigger language plpgsql security invoker set search_path = public as $$
declare g smallint;
begin
  if new.calificacion is null then return new; end if;
  select grado into g from public.alumnos where id = new.alumno_id;
  if g is not null and new.calificacion < public.piso_calificacion_boleta(g) then
    raise exception 'Calificación % inválida para % grado: el mínimo es %', new.calificacion, g, public.piso_calificacion_boleta(g)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists boleta_trimestral_piso_fase on public.boleta_trimestral;
create trigger boleta_trimestral_piso_fase
  before insert or update of calificacion, alumno_id on public.boleta_trimestral
  for each row execute function public.boleta_trimestral_valida_piso();

alter function public.piso_calificacion_boleta(smallint) set search_path = public;
alter function public.calcular_calificacion_boleta(numeric, smallint) set search_path = public;
grant execute on function public.calcular_calificacion_boleta(numeric, smallint) to authenticated;
grant execute on function public.piso_calificacion_boleta(smallint) to authenticated;

-- ── b02_maestro_ajustes_sin_asistencia (0 filas) ────────────────────────────
alter table public.maestro_ajustes drop column peso_asistencia;
alter table public.maestro_ajustes alter column peso_tareas set default 28;
alter table public.maestro_ajustes alter column peso_trabajos set default 28;
alter table public.maestro_ajustes alter column peso_participacion set default 6;
alter table public.maestro_ajustes alter column peso_conducta set default 5;
alter table public.maestro_ajustes alter column peso_examen set default 33;
alter table public.maestro_ajustes alter column peso_tareas set not null;
alter table public.maestro_ajustes alter column peso_trabajos set not null;
alter table public.maestro_ajustes alter column peso_participacion set not null;
alter table public.maestro_ajustes alter column peso_conducta set not null;
alter table public.maestro_ajustes alter column peso_examen set not null;
alter table public.maestro_ajustes add constraint pesos_suman_100
  check (peso_tareas + peso_trabajos + peso_participacion + peso_conducta + peso_examen = 100);

-- ── b03_deprecar_cuaderno_habilidades_y_claves_diagnostica (0 filas) ────────
alter table public.evaluacion_cuaderno rename to zz_deprecated_evaluacion_cuaderno;
alter table public.evaluacion_habilidades_basicas rename to zz_deprecated_evaluacion_habilidades_basicas;

create or replace function public.diagnostica_items_validos(p jsonb, p_prefijo text)
returns boolean language sql immutable set search_path = public as $$
  select p is null or (
    jsonb_typeof(p) = 'array' and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e->>'clave', '') not like p_prefijo || '.%'
         or (e ? 'nivel' and e->'nivel' <> 'null'::jsonb
             and e->>'nivel' not in ('logrado','en_proceso','requiere_apoyo'))
    ))
$$;

alter table public.evaluacion_diagnostica
  add constraint evaluacion_diagnostica_cuaderno_items check (public.diagnostica_items_validos(cuaderno, 'cuaderno')),
  add constraint evaluacion_diagnostica_matematicas_items check (public.diagnostica_items_validos(matematicas, 'mates'));

-- ── b04_bandas_ppm ──────────────────────────────────────────────────────────
create table public.bandas_ppm (
  grado smallint primary key check (grado between 1 and 6),
  requiere_apoyo_max int not null,
  cercano_max int not null,
  estandar_max int not null,
  check (requiere_apoyo_max < cercano_max and cercano_max < estandar_max)
);
insert into public.bandas_ppm values
  (1, 14, 34, 59), (2, 34, 59, 84), (3, 59, 84, 99),
  (4, 84, 99, 114), (5, 99, 114, 124), (6, 114, 124, 134);
alter table public.bandas_ppm enable row level security;
create policy "bandas_ppm lectura" on public.bandas_ppm for select to authenticated using (true);
revoke all on public.bandas_ppm from anon;
grant select on public.bandas_ppm to authenticated;

-- ── b05_alumnos_grado_not_null (18 filas, ninguna con grado nulo) ───────────
alter table public.alumnos alter column grado set not null;
alter table public.alumnos drop constraint alumnos_grado_rango_chk;
alter table public.alumnos add constraint alumnos_grado_rango_chk check (grado between 1 and 6);

-- ── b05b_alumnos_estatus_default_minusculas ─────────────────────────────────
alter table public.alumnos alter column estatus set default 'activo';

-- ── b06_calificaciones_tipo_desde_producto (0 filas) ────────────────────────
alter table public.calificaciones drop constraint calificaciones_tipo_check;
alter table public.calificaciones add constraint calificaciones_tipo_check check (tipo = any (array[
  'tarea','trabajo','producto_final','examen','otro','actividad','participacion','conducta']));

create or replace function public.calificaciones_tipo_desde_producto()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.producto_sesion_id is not null then
    select p.tipo into new.tipo from public.productos_sesion p where p.id = new.producto_sesion_id;
  end if;
  return new;
end $$;

create trigger calificaciones_tipo_desde_producto
  before insert or update of producto_sesion_id, tipo on public.calificaciones
  for each row execute function public.calificaciones_tipo_desde_producto();
