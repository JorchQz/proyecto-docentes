-- =============================================================================
-- Mide el impacto de la migración b27 (sesiones de varios días) ANTES de aplicarla. SOLO LECTURA:
-- una consulta (select) para el editor SQL de producción; no escribe nada y no usa nada de b27 (corre
-- en una base que todavía no la tiene: la regla de "terminada" va escrita aquí).
--
-- Una fila por grupo (y una fila TOTAL al final) con:
--   sesiones_en_curso        sesiones de proyecto empezadas (con fecha, desde el corte 2026-09-30) y sin terminar:
--                            a esas Hoy les preguntará qué se trabajó cada día
--   sesiones_terminadas      sesiones de proyecto con fecha ya terminadas (completada o anteriores al corte)
--   actividades_otro_campo   actividades activas (no tareas) con un campo distinto del de su sesión: la ÚNICA diferencia
--                            aceptada en la calificación (suman participación a SU campo en SU día)
--   respaldo_dia_sueltas     actividades de las sueltas sin día que el respaldo llenaría con la fecha de su sesión
--   respaldo_dia_terminadas  actividades activas (no tareas) de sesiones terminadas que llenaría con su fecha
--   respaldo_dia_en_curso    actividades de sesiones en curso con captura que llenaría con su primer día de captura
--   respaldo_por_trabajar    actividades de sesiones en curso sin captura: quedan sin día ("por trabajar")
--   respaldo_sesion_dias     filas de sesion_dias que crearía (un día por sesión de proyecto con fecha)
--   respaldo_sesion_dias_abiertos  de ellas, las de sesiones en curso (sin cerrar: Hoy preguntará)
--
-- Uso: pegar tal cual en el editor SQL de producción (Supabase) y leer el resultado.
-- =============================================================================
with sesiones_g as (
  select g.id as grupo_id, g.nombre as grupo, s.id as sesion_id, s.fecha, p.tipo,
         s.campo_formativo,
         (s.estado_sesion = 'completada' or s.fecha < date '2026-09-30') as terminada
  from public.grupos g
  join public.proyectos p on p.grupo_id = g.id
  join public.sesiones s on s.proyecto_id = p.id
),
productos_g as (
  select sg.grupo_id, sg.grupo, sg.tipo, sg.sesion_id, sg.fecha, sg.terminada, ps.id as producto_id, ps.tipo as tipo_producto,
         ps.activo,
         (ps.campo is distinct from case sg.campo_formativo
            when 'Lenguajes' then 'LEN'
            when 'Saberes y Pensamiento Científico' then 'SAB'
            when 'Ética, Naturaleza y Sociedades' then 'ETI'
            when 'De lo Humano y lo Comunitario' then 'DHL' end) as otro_campo,
         exists (select 1 from public.calificaciones c
                 where c.producto_sesion_id = ps.id
                   and (c.estado_entrega is not null or c.nivel is not null or c.puntaje is not null or c.retroalimentacion is not null)) as con_captura
  from sesiones_g sg
  join public.productos_sesion ps on ps.sesion_id = sg.sesion_id
),
por_grupo as (
  select sg.grupo_id, sg.grupo,
         count(*) filter (where sg.tipo = 'proyecto' and sg.fecha is not null and not sg.terminada) as sesiones_en_curso,
         count(*) filter (where sg.tipo = 'proyecto' and sg.fecha is not null and sg.terminada)     as sesiones_terminadas,
         count(*) filter (where sg.tipo = 'proyecto' and sg.fecha is not null)                      as respaldo_sesion_dias,
         count(*) filter (where sg.tipo = 'proyecto' and sg.fecha is not null and not sg.terminada) as respaldo_sesion_dias_abiertos
  from sesiones_g sg
  group by sg.grupo_id, sg.grupo
),
productos_por_grupo as (
  select pg.grupo_id,
         count(*) filter (where pg.activo and pg.tipo_producto <> 'tarea' and pg.otro_campo)                                        as actividades_otro_campo,
         count(*) filter (where pg.tipo = 'sueltas' and pg.fecha is not null)                                                       as respaldo_dia_sueltas,
         count(*) filter (where pg.tipo = 'proyecto' and pg.terminada and pg.fecha is not null and pg.activo and pg.tipo_producto <> 'tarea') as respaldo_dia_terminadas,
         count(*) filter (where pg.tipo = 'proyecto' and not pg.terminada and pg.fecha is not null and pg.activo and pg.tipo_producto <> 'tarea' and pg.con_captura)     as respaldo_dia_en_curso,
         count(*) filter (where pg.tipo = 'proyecto' and not pg.terminada and pg.fecha is not null and pg.activo and pg.tipo_producto <> 'tarea' and not pg.con_captura) as respaldo_por_trabajar
  from productos_g pg
  group by pg.grupo_id
),
filas as (
  select g.grupo, g.sesiones_en_curso, g.sesiones_terminadas,
         coalesce(p.actividades_otro_campo, 0) as actividades_otro_campo,
         coalesce(p.respaldo_dia_sueltas, 0) as respaldo_dia_sueltas,
         coalesce(p.respaldo_dia_terminadas, 0) as respaldo_dia_terminadas,
         coalesce(p.respaldo_dia_en_curso, 0) as respaldo_dia_en_curso,
         coalesce(p.respaldo_por_trabajar, 0) as respaldo_por_trabajar,
         g.respaldo_sesion_dias, g.respaldo_sesion_dias_abiertos
  from por_grupo g
  left join productos_por_grupo p on p.grupo_id = g.grupo_id
)
select grupo, sesiones_en_curso, sesiones_terminadas, actividades_otro_campo, respaldo_dia_sueltas, respaldo_dia_terminadas,
       respaldo_dia_en_curso, respaldo_por_trabajar, respaldo_sesion_dias, respaldo_sesion_dias_abiertos
from (
  select 0 as orden, f.* from filas f
  where f.sesiones_en_curso + f.sesiones_terminadas + f.actividades_otro_campo + f.respaldo_dia_sueltas > 0
  union all
  select 1, 'TOTAL', sum(sesiones_en_curso), sum(sesiones_terminadas), sum(actividades_otro_campo), sum(respaldo_dia_sueltas),
         sum(respaldo_dia_terminadas), sum(respaldo_dia_en_curso), sum(respaldo_por_trabajar), sum(respaldo_sesion_dias),
         sum(respaldo_sesion_dias_abiertos)
  from filas
) t
order by orden, sesiones_en_curso desc, grupo;
