-- Agrega soporte de grado por alumno.
-- Ejecuta este script una sola vez en Supabase SQL Editor.

alter table public.alumnos
add column if not exists grado smallint;

-- Backfill para registros existentes: usa el primer grado configurado en el grupo.
update public.alumnos a
set grado = nullif(trim(split_part(g.grados, ',', 1)), '')::smallint
from public.grupos g
where a.grupo_id = g.id
  and a.grado is null
  and g.grados is not null
  and trim(g.grados) <> '';

-- Validacion de rango.
alter table public.alumnos
drop constraint if exists alumnos_grado_rango_chk;

alter table public.alumnos
add constraint alumnos_grado_rango_chk
check (grado is null or (grado >= 1 and grado <= 6));

create index if not exists alumnos_grupo_grado_idx
on public.alumnos (grupo_id, grado);
