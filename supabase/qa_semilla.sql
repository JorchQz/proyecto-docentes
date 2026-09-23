-- ============================================================================
-- SEMILLA DE QA — Mi salón (Parte B)
-- Función qa.resembrar() (migración qa_funcion_resembrar). Solo toca datos de la
-- cuenta de QA (qa.misalon@jissez.com): borra todo lo de esa cuenta y lo vuelve a
-- crear. Nunca toca maestros reales. La contraseña de la cuenta vive solo en
-- .env.local (ignorado por git).
--
-- Uso (Supabase MCP execute_sql o SQL Editor):   select qa.resembrar();
--
-- Qué deja:
--   · Grupo "QA 1°-2° (Fase 3)" y grupo "QA 3°-4° (Fase 4)", ciclo 2026-2027, T1.
--   · 4 alumnos por grado con perfiles a propósito:
--       sobresaliente · en riesgo · irregular (con justificados) · PPM bajo
--     (número de lista alfabético dentro de cada grupo).
--   · Un proyecto por grupo con 12 sesiones pasadas (rota LEN/SAB/ETI/DHL), 2
--     sesiones HOY sin capturar y 3 pendientes sin fecha (para "Trabajar hoy"),
--     PDA reales del catálogo por grado, un trabajo diferenciado por grado en cada
--     sesión y tareas compartidas.
--   · Calificaciones por perfil (la evidencia por PDA se propaga sola por trigger),
--     asistencia y cierre del día de cada fecha con sesión, diagnóstico del
--     trimestre (cuaderno, matemáticas, PPM, comprensión) y un examen por grado.
--
-- "Hoy" se calcula en hora de México: la base corre en UTC.
-- ============================================================================

-- Semilla de QA como función (esquema qa, NO expuesto por el API de PostgREST).
-- Solo borra y recrea datos de la cuenta qa.misalon@jissez.com. Uso: select qa.resembrar();
create schema if not exists qa;
revoke all on schema qa from public, anon, authenticated;

create or replace function qa.resembrar() returns void language plpgsql set search_path = public as $fn$
declare
  qa uuid;
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  -- 12 días de clase hábiles antes de hoy (lunes a viernes)
  dias date[];
  d date;
  g record; al record; ses record; prod record;
  gid uuid; pid uuid; sid uuid; spda uuid; prid uuid; tarea_id uuid; exid uuid;
  campos text[] := array['Lenguajes','Saberes y Pensamiento Científico','Ética, Naturaleza y Sociedades',
                         'De lo Humano y lo Comunitario','Lenguajes','Saberes y Pensamiento Científico',
                         'Ética, Naturaleza y Sociedades','De lo Humano y lo Comunitario',
                         'Lenguajes','Saberes y Pensamiento Científico','Lenguajes','Saberes y Pensamiento Científico'];
  cortos text[] := array['LEN','SAB','ETI','DHL','LEN','SAB','ETI','DHL','LEN','SAB','LEN','SAB'];
  i int; n int; k int; lista int := 0; aprob numeric;
  nuevo_id uuid; nuevo_grado smallint;
  nivel text; estado text; asis text; part smallint; cond smallint;
  banda record; ppm int;
  preguntas uuid[];
  ocurr int;
begin
  select id into qa from auth.users where email = 'qa.misalon@jissez.com';
  if qa is null then raise exception 'No existe la cuenta QA'; end if;

  -- ── Limpieza (solo QA) ──────────────────────────────────────────────────
  delete from public.evaluacion_diagnostica where maestro_id = qa;
  delete from public.registro_diario where maestro_id = qa;
  delete from public.asistencias where maestro_id = qa;
  delete from public.boleta_trimestral where maestro_id = qa;
  delete from public.examenes where maestro_id = qa;          -- respuestas en cascada
  delete from public.proyectos where maestro_id = qa;         -- sesiones, productos, calificaciones
  delete from public.alumnos where maestro_id = qa;
  delete from public.grupos where maestro_id = qa;

  insert into public.maestro_ajustes(maestro_id) values (qa) on conflict (maestro_id) do nothing;

  -- ── Calendario: 12 días hábiles hacia atrás desde ayer ──────────────────
  d := hoy - 1;
  dias := array[]::date[];
  while coalesce(array_length(dias, 1), 0) < 12 loop
    if extract(isodow from d) < 6 then dias := array[d] || dias; end if;
    d := d - 1;
  end loop;

  -- ── Grupos y alumnos ────────────────────────────────────────────────────
  create temp table if not exists _qa_alumnos(
    id uuid, grupo_id uuid, grado smallint, perfil text, orden int) on commit drop;
  truncate _qa_alumnos;

  for g in
    select * from (values
      ('QA 1°-2° (Fase 3)', array['1','2'], 1),
      ('QA 3°-4° (Fase 4)', array['3','4'], 2)
    ) as t(nombre, grados, num)
  loop
    insert into public.grupos(maestro_id, ciclo_escolar, nombre, escuela, tipo_organizacion, grados, es_multigrado, trimestre_actual, descripcion)
    values (qa, '2026-2027', g.nombre, 'Escuela QA (datos de prueba)', 'tridocente', g.grados, true, 1,
            'Grupo de QA de Mi salón. No es un grupo real.')
    returning id into gid;

    lista := 0;
    for al in
      select * from (values
        -- grado relativo 1 = primer grado del grupo, 2 = segundo
        (1, 'sobresaliente', 'ANA TORRES'),   (1, 'riesgo', 'LUIS PÉREZ'),
        (1, 'irregular', 'MARÍA SOTO'),       (1, 'ppm_bajo', 'DIEGO RUIZ'),
        (2, 'sobresaliente', 'SOFÍA LARA'),   (2, 'riesgo', 'JUAN MENA'),
        (2, 'irregular', 'ELENA RÍOS'),       (2, 'ppm_bajo', 'PEDRO VEGA')
      ) as t(rel, perfil, nombre)
    loop
      lista := lista + 1;
      insert into public.alumnos(maestro_id, grupo_id, num_lista, nombre_completo, grado, estatus)
      values (qa, gid,
              lista,
              'QA ' || case when g.num = 2 then
                  (array['CAMILA ORTIZ','MATEO CRUZ','VALERIA LUNA','DANIEL ROJAS','REGINA SALAS','EMILIO NAVA','RENATA GIL','TOMÁS PAZ'])[lista]
                else al.nombre end
                || ' (' || replace(replace(al.perfil, 'ppm_bajo', 'PPM bajo'), 'riesgo', 'en riesgo') || ')',
              (g.grados[al.rel])::smallint, 'activo')
      returning id, grado into nuevo_id, nuevo_grado;
      insert into _qa_alumnos values (nuevo_id, gid, nuevo_grado, al.perfil, lista);
    end loop;

    -- ── Proyecto del trimestre ────────────────────────────────────────────
    insert into public.proyectos(maestro_id, grupo_id, titulo, trimestre, grados, campos_formativos, estado,
                                 metodologia, escenario, proposito, es_multigrado, fecha_inicial, fecha_final)
    values (qa, gid, 'QA Proyecto T1 — ' || g.nombre, 1, g.grados,
            array['Lenguajes','Saberes y Pensamiento Científico','Ética, Naturaleza y Sociedades','De lo Humano y lo Comunitario'],
            'activo', 'ABPC', 'Aula', 'Proyecto de datos de prueba para QA.', true, dias[1], hoy)
    returning id into pid;

    -- 12 sesiones pasadas + 2 de hoy (13 = LEN, 14 = SAB), sin capturar + 3 pendientes
    -- SIN fecha (15 = ETI, 16 = DHL, 17 = LEN), como llegan de una planeación real:
    -- sirven para probar "Trabajar hoy".
    for i in 1..17 loop
      insert into public.sesiones(proyecto_id, maestro_id, numero_sesion, fecha, campo_formativo, momento, estado_sesion, duracion)
      values (pid, qa, i,
              case when i <= 12 then dias[i] when i <= 14 then hoy else null end,
              case when i <= 12 then campos[i] when i in (13, 17) then 'Lenguajes' when i = 14 then 'Saberes y Pensamiento Científico' when i = 15 then 'Ética, Naturaleza y Sociedades' else 'De lo Humano y lo Comunitario' end,
              'Desarrollo', case when i <= 12 then 'completada' when i <= 14 then 'activa' else 'pendiente' end, '60 min')
      returning id into sid;

      -- Un trabajo diferenciado por grado, ligado a un PDA real de ese grado y campo.
      -- Se alternan 2 PDA por campo para que haya evidencia repetida.
      ocurr := (select count(*) from generate_series(1, i) s
                where (case when s <= 12 then cortos[s] when s in (13, 17) then 'LEN' when s = 14 then 'SAB' when s = 15 then 'ETI' else 'DHL' end)
                    = (case when i <= 12 then cortos[i] when i in (13, 17) then 'LEN' when i = 14 then 'SAB' when i = 15 then 'ETI' else 'DHL' end));
      for k in 1..2 loop
        spda := null;
        insert into public.sesiones_pda(sesion_id, pda_id, grado, criterio_aplicado)
        select sid, cp.id, (g.grados[k])::int, null
        from public.catalogo_pda cp join public.catalogo_contenidos cc on cc.id = cp.contenido_id
        where cp.grado = (g.grados[k])::int
          and cc.campo_formativo = case when i <= 12 then campos[i] when i in (13, 17) then 'Lenguajes' when i = 14 then 'Saberes y Pensamiento Científico' when i = 15 then 'Ética, Naturaleza y Sociedades' else 'De lo Humano y lo Comunitario' end
        order by cc.orden nulls last, cp.orden nulls last, cp.id
        offset ((ocurr - 1) % 2) limit 1
        returning id into spda;

        insert into public.productos_sesion(sesion_id, maestro_id, tipo, nombre, grados, modalidad, campo, origen, activo, orden)
        values (sid, qa, 'trabajo',
                'QA Trabajo S' || i || ' · ' || (case when i <= 12 then cortos[i] when i in (13, 17) then 'LEN' when i = 14 then 'SAB' when i = 15 then 'ETI' else 'DHL' end) || ' ' || g.grados[k] || '°',
                array[g.grados[k]], 'diferenciada',
                case when i <= 12 then cortos[i] when i in (13, 17) then 'LEN' when i = 14 then 'SAB' when i = 15 then 'ETI' else 'DHL' end,
                'maestro', true, k)
        returning id into prid;
        if spda is not null then
          insert into public.producto_sesion_pda(producto_sesion_id, sesion_pda_id) values (prid, spda);
        end if;
      end loop;

      -- Tarea compartida en las sesiones pares; vence el siguiente día de clase
      if i % 2 = 0 and i <= 12 then
        insert into public.productos_sesion(sesion_id, maestro_id, tipo, nombre, grados, modalidad, campo, origen, activo, orden, fecha_entrega)
        values (sid, qa, 'tarea', 'QA Tarea S' || i || ' · ' || cortos[i], g.grados, 'compartida', cortos[i], 'maestro', true, 3,
                case when i < 12 then dias[i + 1] else hoy end);
      end if;
    end loop;

    -- ── Examen del trimestre por grado (12 preguntas reales del banco) ────
    for k in 1..2 loop
      -- 3 por campo
      select array_agg(id) into preguntas from (
        select id, campo_formativo, row_number() over (partition by campo_formativo order by id) rn
        from public.banco_preguntas
        where grado = (g.grados[k])::int and trimestre = 1
      ) q where rn <= 3;
      insert into public.examenes(grupo_id, maestro_id, ciclo_escolar, trimestre, fase, grado, titulo,
                                  preguntas_ids, total_preguntas, valor_total, estado)
      values (gid, qa, '2026-2027', 1, case when (g.grados[k])::int <= 2 then 'Fase 3' else 'Fase 4' end,
              (g.grados[k])::int, 'QA Examen T1 ' || g.grados[k] || '°',
              preguntas, coalesce(array_length(preguntas, 1), 0), coalesce(array_length(preguntas, 1), 0), 'cerrado')
      returning id into exid;
    end loop;
  end loop;

  -- Número de lista en orden alfabético por grupo (como lo deja "Mi grupo")
  update public.alumnos a set num_lista = o.n
  from (select id, row_number() over (partition by grupo_id order by nombre_completo) n
        from public.alumnos where maestro_id = qa) o
  where a.id = o.id;

  -- ── Evidencias por alumno según su perfil ───────────────────────────────
  for al in select * from _qa_alumnos loop
    -- Trabajos y tareas de sesiones pasadas que le tocan a su grado
    for prod in
      select ps.id, ps.tipo, ps.sesion_id, s.fecha, s.numero_sesion, s.proyecto_id, s.campo_formativo
      from public.productos_sesion ps
      join public.sesiones s on s.id = ps.sesion_id
      join public.proyectos p on p.id = s.proyecto_id
      where p.grupo_id = al.grupo_id and s.numero_sesion <= 12
        and al.grado::text = any(ps.grados)
        -- la tarea que vence hoy queda sin revisar, para la pantalla "Hoy"
        and not (ps.tipo = 'tarea' and ps.fecha_entrega >= hoy)
      order by s.numero_sesion, ps.orden
    loop
      n := prod.numero_sesion;
      nivel := null; estado := 'entregado';
      if prod.tipo = 'trabajo' then
        nivel := case al.perfil
          when 'sobresaliente' then case when n % 5 = 0 then 'en_proceso' else 'logrado' end
          when 'riesgo'        then case when n % 4 = 0 then 'en_proceso' else 'requiere_apoyo' end
          when 'irregular'     then case when n % 3 = 0 then 'requiere_apoyo' when n % 2 = 0 then 'logrado' else 'en_proceso' end
          else                      case when n % 2 = 0 then 'logrado' else 'en_proceso' end end;
        if al.perfil = 'riesgo' and n % 6 = 1 then estado := 'no_entregado'; nivel := null; end if;
        if al.perfil = 'irregular' and n = 7 then estado := 'justificado'; nivel := null; end if;
      else
        estado := case al.perfil
          when 'sobresaliente' then 'entregado'
          when 'riesgo'        then case when n % 6 = 0 then 'incompleto' else 'no_entregado' end
          when 'irregular'     then case when n % 4 = 0 then 'justificado' when n % 4 = 2 then 'entregado' else 'no_entregado' end
          else                      'entregado' end;
        nivel := case when estado = 'entregado' then 'logrado' else null end;
      end if;

      insert into public.calificaciones(maestro_id, alumno_id, grupo_id, proyecto_id, sesion_id, producto_sesion_id,
                                        tipo, nivel, estado_entrega, entrego, grado, campo_formativo, fecha,
                                        retroalimentacion, evaluado_en)
      values (qa, al.id, al.grupo_id, prod.proyecto_id, prod.sesion_id, prod.id,
              prod.tipo, nivel, estado, estado in ('entregado', 'incompleto'), al.grado, prod.campo_formativo, prod.fecha,
              case
                when al.perfil = 'sobresaliente' and n in (3, 9) then 'Excelente trabajo, muy completo y ordenado.'
                when al.perfil = 'riesgo' and n in (2, 8, 11) then 'Le faltó terminar; hay que practicar en casa.'
                when al.perfil = 'irregular' and n = 5 then 'Buen avance respecto a la sesión anterior.'
                when al.perfil = 'ppm_bajo' and n in (4, 10) then 'Revisar la lectura en voz alta antes de entregar.'
                else null end,
              (prod.fecha + time '13:00') at time zone 'America/Mexico_City');
    end loop;

    -- Asistencia y cierre del día en cada fecha con sesión
    foreach d in array dias loop
      i := array_position(dias, d);
      asis := case al.perfil
        when 'riesgo'    then case when i % 3 = 0 then 'ausente' else 'presente' end
        when 'irregular' then case when i % 5 = 0 then 'justificada' when i = 8 then 'ausente' else 'presente' end
        else 'presente' end;
      insert into public.asistencias(maestro_id, grupo_id, alumno_id, fecha, asistencia_estado)
      values (qa, al.grupo_id, al.id, d, asis);

      if asis = 'presente' then
        part := case al.perfil when 'sobresaliente' then 2 when 'riesgo' then (i % 2)::smallint
                               when 'irregular' then 1 else 1 end;
        cond := case al.perfil when 'riesgo' then 1 else 2 end;
        insert into public.registro_diario(maestro_id, alumno_id, fecha, participacion, conducta)
        values (qa, al.id, d, part, cond);
      end if;
    end loop;

    -- Diagnóstico del trimestre: cuaderno, matemáticas, PPM y comprensión
    select * into banda from public.bandas_ppm where grado = al.grado;
    ppm := case al.perfil
      when 'sobresaliente' then banda.estandar_max + 10
      when 'riesgo'        then greatest(banda.requiere_apoyo_max - 6, 5)
      when 'irregular'     then banda.requiere_apoyo_max + 6
      else                      greatest(banda.requiere_apoyo_max - 2, 5) end;

    insert into public.evaluacion_diagnostica(maestro_id, alumno_id, grupo_id, momento, fecha,
                                              cuaderno, matematicas, lectura_ppm, lectura_comprension, observaciones)
    values (qa, al.id, al.grupo_id, 'trimestre_1', dias[12],
      (select jsonb_agg(jsonb_build_object('clave', c.clave, 'nivel',
          case al.perfil
            when 'sobresaliente' then 'logrado'
            when 'riesgo' then case when c.n % 3 = 0 then 'en_proceso' else 'requiere_apoyo' end
            when 'irregular' then case when c.n % 2 = 0 then 'logrado' else 'en_proceso' end
            else case when c.n % 4 = 0 then 'en_proceso' else 'logrado' end end))
       from (select clave, row_number() over () n from unnest(array[
         'cuaderno.orden_limpieza','cuaderno.fecha_completa','cuaderno.titulo_actividad','cuaderno.letra_legible',
         'cuaderno.mayusculas_minusculas','cuaderno.signos_puntuacion','cuaderno.acentuacion','cuaderno.buen_estado',
         'cuaderno.orden_proyecto','cuaderno.respeta_margen']) clave) c),
      -- En 1° y 2° solo se evalúan las habilidades de su nivel: sin multiplicación,
      -- división, fracciones ni tablas.
      (select jsonb_agg(jsonb_build_object('clave', m.clave, 'nivel',
          case al.perfil
            when 'sobresaliente' then 'logrado'
            when 'riesgo' then case when m.n % 2 = 0 then 'requiere_apoyo' else 'en_proceso' end
            when 'irregular' then case when m.n % 3 = 0 then 'requiere_apoyo' else 'logrado' end
            else 'logrado' end))
       from (select clave, row_number() over () n from unnest(
         case when al.grado <= 2 then array['mates.suma','mates.resta','mates.lectura_escritura_cantidades','mates.problemas']
         else array['mates.suma','mates.resta','mates.multiplicacion','mates.division','mates.fracciones',
                    'mates.tablas','mates.lectura_escritura_cantidades','mates.problemas'] end) clave) m),
      ppm,
      case al.perfil when 'sobresaliente' then 'logrado' when 'irregular' then 'en_proceso' else 'requiere_apoyo' end,
      null);

    -- Respuestas del examen de su grado
    aprob := case al.perfil when 'sobresaliente' then 0.9 when 'riesgo' then 0.3 when 'irregular' then 0.6 else 0.7 end;
    select id, preguntas_ids into exid, preguntas from public.examenes
      where maestro_id = qa and grupo_id = al.grupo_id and grado = al.grado limit 1;
    if exid is not null and preguntas is not null then
      insert into public.respuestas_examen(examen_id, alumno_id, pregunta_id, respuesta_alumno, es_correcta, puntos_obtenidos, calificada_por)
      select exid, al.id, q.pid, 'QA',
             ((q.idx + al.orden) % 10) < round(aprob * 10),
             case when ((q.idx + al.orden) % 10) < round(aprob * 10) then 1 else 0 end,
             'automatico'
      from unnest(preguntas) with ordinality as q(pid, idx);
    end if;
  end loop;
end $fn$;

revoke all on function qa.resembrar() from public, anon, authenticated;
