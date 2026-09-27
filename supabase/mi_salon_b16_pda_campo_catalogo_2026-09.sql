-- mi_salon_b16_pda_campo_catalogo_2026-09.sql
-- Estado: aplicada SOLO en pruebas (raoxdxwgsxbqlzdnndly) el 2026-09-26. En producción la aplica
-- el coordinador después de la revisión (decisión de Jorge).
--
-- Por qué: decisión de Jorge del 2026-09-26 sobre "Actividad agregada en Hoy": una actividad de
-- OTRO campo formativo (o fuera de la sesión) puede ligarse a sus propios PDA del catálogo, que se
-- guardan en sesiones_pda de esa sesión. v_avance_pda tomaba el campo formativo de la SESIÓN, así
-- que un PDA de Saberes trabajado en una sesión de Lenguajes salía en Lenguajes en "Avance por
-- PDA" y en "Qué le falta". Ahora el campo es el del CATÁLOGO (catalogo_contenidos del PDA) y, sin
-- PDA de catálogo (solo criterio), el de la sesión, como antes.
--
-- Aditiva: create or replace view con las MISMAS columnas, en el mismo orden y con la misma
-- opción security_invoker = true (RLS de las tablas de abajo). Solo cambia la expresión de
-- campo_formativo en "base". Para PDA del plan, catálogo y sesión coinciden: nada cambia.

create or replace view public.v_avance_pda
with (security_invoker = true) as
 WITH base AS (
         SELECT ef.maestro_id,
            ef.alumno_id,
            ef.semaforo,
            ef.fecha,
            ef.criterio,
            ef.origen,
            sp.pda_id,
            sp.grado,
            s.id AS sesion_id,
            COALESCE(cc.campo_formativo, s.campo_formativo) AS campo_formativo,
            s.numero_sesion,
            p.id AS proyecto_id,
            p.trimestre,
            p.grupo_id,
            cp.pda AS pda_texto,
            cc.contenido,
            COALESCE(sp.pda_id::text, ef.criterio) AS clave_pda,
                CASE ef.semaforo
                    WHEN 'logrado'::text THEN 3
                    WHEN 'en_proceso'::text THEN 2
                    ELSE 1
                END AS valor
           FROM evaluacion_formativa ef
             JOIN sesiones s ON s.id = ef.sesion_id
             JOIN proyectos p ON p.id = s.proyecto_id
             LEFT JOIN sesiones_pda sp ON sp.id = ef.sesion_pda_id
             LEFT JOIN catalogo_pda cp ON cp.id = sp.pda_id
             LEFT JOIN catalogo_contenidos cc ON cc.id = cp.contenido_id
          WHERE ef.semaforo IS NOT NULL
        ), ordenadas AS (
         SELECT base.maestro_id,
            base.alumno_id,
            base.semaforo,
            base.fecha,
            base.criterio,
            base.origen,
            base.pda_id,
            base.grado,
            base.sesion_id,
            base.campo_formativo,
            base.numero_sesion,
            base.proyecto_id,
            base.trimestre,
            base.grupo_id,
            base.pda_texto,
            base.contenido,
            base.clave_pda,
            base.valor,
            row_number() OVER (p_pda ORDER BY base.fecha, base.numero_sesion, base.sesion_id) AS orden,
            count(*) OVER (p_pda) AS total
           FROM base
          WINDOW p_pda AS (PARTITION BY base.maestro_id, base.alumno_id, base.trimestre, base.clave_pda)
        )
 SELECT maestro_id,
    alumno_id,
    grupo_id,
    trimestre,
    clave_pda,
    max(pda_id::text)::uuid AS pda_id,
    max(grado) AS grado,
    max(campo_formativo) AS campo_formativo,
    max(COALESCE(pda_texto, criterio)) AS pda,
    max(contenido) AS contenido,
    count(*) AS evidencias,
    mode() WITHIN GROUP (ORDER BY semaforo) AS nivel_predominante,
    round(avg(valor), 2) AS promedio,
    count(*) FILTER (WHERE semaforo = 'logrado'::text) AS logrados,
    count(*) FILTER (WHERE semaforo = 'en_proceso'::text) AS en_proceso,
    count(*) FILTER (WHERE semaforo = 'requiere_apoyo'::text) AS requiere_apoyo,
    count(*) FILTER (WHERE origen = 'maestro'::text) AS ajustadas_por_el_maestro,
    min(fecha) AS primera_evidencia,
    max(fecha) AS ultima_evidencia,
        CASE
            WHEN count(*) < 2 THEN 'sin_datos'::text
            WHEN avg(valor) FILTER (WHERE orden::numeric > (total::numeric / 2.0)) > avg(valor) FILTER (WHERE orden::numeric <= (total::numeric / 2.0)) THEN 'mejora'::text
            WHEN avg(valor) FILTER (WHERE orden::numeric > (total::numeric / 2.0)) < avg(valor) FILTER (WHERE orden::numeric <= (total::numeric / 2.0)) THEN 'baja'::text
            ELSE 'estable'::text
        END AS tendencia
   FROM ordenadas
  GROUP BY maestro_id, alumno_id, grupo_id, trimestre, clave_pda;
