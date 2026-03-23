-- Corrige historicos huérfanos en asistencias y fuerza FKs con borrado en cascada.
-- Ejecutar una sola vez en Supabase SQL Editor.

begin;

-- 1) Limpiar asistencias huérfanas (alumno eliminado o grupo eliminado).
delete from public.asistencias s
where not exists (
	select 1
	from public.alumnos a
	where a.id = s.alumno_id
)
or not exists (
	select 1
	from public.grupos g
	where g.id = s.grupo_id
);

-- 2) Alinear maestro_id con el del alumno vivo para evitar inconsistencias antiguas.
update public.asistencias s
set maestro_id = a.maestro_id
from public.alumnos a
where a.id = s.alumno_id
  and s.maestro_id <> a.maestro_id;

-- 3) Re-crear FK de alumno con ON DELETE CASCADE.
alter table public.asistencias
	drop constraint if exists asistencias_alumno_id_fkey;

alter table public.asistencias
	add constraint asistencias_alumno_id_fkey
	foreign key (alumno_id)
	references public.alumnos(id)
	on delete cascade;

-- 4) Re-crear FK de grupo con ON DELETE CASCADE.
alter table public.asistencias
	drop constraint if exists asistencias_grupo_id_fkey;

alter table public.asistencias
	add constraint asistencias_grupo_id_fkey
	foreign key (grupo_id)
	references public.grupos(id)
	on delete cascade;

commit;

-- Verificacion rapida post-fix.
select count(*) as asistencias_huerfanas
from public.asistencias s
left join public.alumnos a on a.id = s.alumno_id
left join public.grupos g on g.id = s.grupo_id
where a.id is null or g.id is null;
