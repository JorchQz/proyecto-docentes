-- ============================================================================
-- MI SALÓN B.3 — motor de calificación (2026-09-22)
-- La parte SQL del bloque: el paso de confirmación del maestro. El cálculo vive
-- en js/motor-calificacion.js y la conversión en calcular_calificacion_boleta
-- (ver mi_salon_b0_2026-09.sql). HISTORIA: manda la BD.
--
-- Por qué: Acuerdo 10/09/23, art. 4 XI — la calificación es el juicio del docente
-- sobre el conjunto de evidencias, no un cálculo automático. El motor propone; el
-- maestro revisa, ajusta si hace falta y confirma. Sin confirmar no se puede cerrar.
-- ============================================================================

alter table public.boleta_trimestral
  add column calificacion_confirmada boolean not null default false,
  add column confirmada_en timestamptz;

create or replace function public.boleta_trimestral_exige_confirmacion()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.cerrada is true and coalesce(new.calificacion_confirmada, false) = false then
    raise exception 'No se puede cerrar la boleta sin que el maestro confirme la calificación propuesta'
      using errcode = 'check_violation';
  end if;
  if new.calificacion_confirmada is true
     and (tg_op = 'INSERT' or coalesce(old.calificacion_confirmada, false) = false) then
    new.confirmada_en := now();
  end if;
  return new;
end $$;

drop trigger if exists boleta_trimestral_confirmacion on public.boleta_trimestral;
create trigger boleta_trimestral_confirmacion
  before insert or update on public.boleta_trimestral
  for each row execute function public.boleta_trimestral_exige_confirmacion();

-- ── Borrado en cascada de calificaciones (2026-09-22) ───────────────────────
-- Borrar una sesión o un proyecto con calificaciones fallaba con 23503: el SET NULL
-- de sesion_id/proyecto_id competía con el borrado del producto sobre la misma fila.
-- Las tres referencias pasan a CASCADE: una calificación es evidencia de su
-- producto/sesión/proyecto y no sirve de nada sin ellos.
alter table public.calificaciones drop constraint calificaciones_producto_sesion_id_fkey;
alter table public.calificaciones add constraint calificaciones_producto_sesion_id_fkey
  foreign key (producto_sesion_id) references public.productos_sesion(id) on delete cascade;

alter table public.calificaciones drop constraint calificaciones_sesion_id_fkey;
alter table public.calificaciones add constraint calificaciones_sesion_id_fkey
  foreign key (sesion_id) references public.sesiones(id) on delete cascade;

alter table public.calificaciones drop constraint calificaciones_proyecto_id_fkey;
alter table public.calificaciones add constraint calificaciones_proyecto_id_fkey
  foreign key (proyecto_id) references public.proyectos(id) on delete cascade;
