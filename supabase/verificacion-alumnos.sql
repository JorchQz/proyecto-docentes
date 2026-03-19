-- Verificacion rapida de integridad para la tabla alumnos.
-- Ejecuta este script en Supabase SQL Editor.

-- 0) Verificar si existe la columna grado en alumnos.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
   and table_name = 'alumnos'
   and column_name = 'grado';

-- 1) Conteo total de alumnos por maestro.
select maestro_id, count(*) as total_alumnos
from public.alumnos
group by maestro_id
order by total_alumnos desc;

-- 2) Conteo de alumnos por grupo.
select maestro_id, grupo_id, count(*) as total_alumnos
from public.alumnos
group by maestro_id, grupo_id
order by maestro_id, grupo_id;

-- 2b) Conteo de alumnos por grupo y grado.
select maestro_id, grupo_id, grado, count(*) as total_alumnos
from public.alumnos
group by maestro_id, grupo_id, grado
order by maestro_id, grupo_id, grado;

-- 3) Detectar posibles duplicados por nombre dentro del mismo grupo.
select maestro_id, grupo_id, lower(trim(nombre_completo)) as nombre_normalizado, count(*) as repeticiones
from public.alumnos
group by maestro_id, grupo_id, lower(trim(nombre_completo))
having count(*) > 1
order by repeticiones desc;

-- 4) Detectar filas huérfanas sin grupo valido.
select a.id, a.maestro_id, a.grupo_id, a.nombre_completo
from public.alumnos a
left join public.grupos g on g.id = a.grupo_id
where g.id is null;

-- 5) Detectar campos clave nulos o vacios.
select id, maestro_id, grupo_id, nombre_completo, num_lista
from public.alumnos
where maestro_id is null
   or grupo_id is null
   or nombre_completo is null
   or trim(nombre_completo) = ''
   or num_lista is null;

-- 6) Ver si hay asistencias apuntando a alumnos inexistentes.
select s.id, s.maestro_id, s.grupo_id, s.alumno_id, s.fecha
from public.asistencias s
left join public.alumnos a on a.id = s.alumno_id
where a.id is null;

-- 7) Grupos multigrado sin grado asignado por alumno.
select a.id, a.maestro_id, a.grupo_id, a.nombre_completo, a.grado, g.grados, g.tipo_organizacion
from public.alumnos a
join public.grupos g on g.id = a.grupo_id
where g.tipo_organizacion <> 'normal'
   and array_length(string_to_array(g.grados, ','), 1) > 1
   and a.grado is null;

-- 8) Alumnos con grado fuera de los grados definidos en su grupo.
select a.id, a.maestro_id, a.grupo_id, a.nombre_completo, a.grado, g.grados
from public.alumnos a
join public.grupos g on g.id = a.grupo_id
where a.grado is not null
   and not exists (
	select 1
	from unnest(string_to_array(g.grados, ',')) as grado_grupo
	where nullif(trim(grado_grupo), '') is not null
	  and nullif(trim(grado_grupo), '')::int = a.grado
   );
