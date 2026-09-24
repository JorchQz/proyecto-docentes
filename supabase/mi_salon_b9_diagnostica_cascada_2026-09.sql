-- Mi salón B.9 — El diagnóstico se borra con su alumno (2026-09-24)
--
-- evaluacion_diagnostica no tenía llaves foráneas a alumnos ni a grupos: al borrar un alumno
-- (o un grupo) su diagnóstico quedaba huérfano. Lo encontró el constructor de las políticas
-- de referencias propias. Se agregan las dos llaves con borrado en cascada, como el resto de
-- las tablas de Mi salón.
-- Aditiva: primero se quitan los diagnósticos huérfanos (su alumno o su grupo ya no existe, así
-- que no pertenecen a nadie visible) y después se agregan las llaves.

delete from public.evaluacion_diagnostica d
 where not exists (select 1 from public.alumnos a where a.id = d.alumno_id)
    or not exists (select 1 from public.grupos g where g.id = d.grupo_id);

alter table public.evaluacion_diagnostica
  drop constraint if exists evaluacion_diagnostica_alumno_id_fkey,
  drop constraint if exists evaluacion_diagnostica_grupo_id_fkey;

alter table public.evaluacion_diagnostica
  add constraint evaluacion_diagnostica_alumno_id_fkey
    foreign key (alumno_id) references public.alumnos(id) on delete cascade,
  add constraint evaluacion_diagnostica_grupo_id_fkey
    foreign key (grupo_id) references public.grupos(id) on delete cascade;

create index if not exists evaluacion_diagnostica_alumno_id_idx on public.evaluacion_diagnostica (alumno_id);
create index if not exists evaluacion_diagnostica_grupo_id_idx on public.evaluacion_diagnostica (grupo_id);
