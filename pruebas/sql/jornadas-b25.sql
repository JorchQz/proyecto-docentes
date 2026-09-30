-- =============================================================================
-- Prueba SQL: comentarios del día y "Finalizar jornada" (Fase 3 del plan de Fanny, 2026-09-29;
-- supabase/mi_salon_b25_jornada_comentario_2026-10.sql).
--   1. La marca de la nota: un insert sin marcas las recibe todas; un cambio de `nota` sin marca
--      nueva recibe una del servidor; un cambio de participación no toca la marca de la nota; la
--      marca que trae Hoy se respeta.
--   2. jornadas (como el docente, con RLS): inserta solo en SUS grupos y con SU id; una jornada por
--      grupo y día; cerrada_en no cambia al finalizar de nuevo y actualizada_en la pone la base;
--      otra cuenta no la ve, no la cambia ni la borra; anon no ve nada.
--   3. Solo lectura (b21): sin acceso vigente, la jornada se lee pero no se escribe.
--   4. delete_own_account se lleva las jornadas de la cuenta y deja las de las demás.
--   5. El candado: 138 políticas en 46 tablas.
--
-- SOLO en PRUEBAS, dentro de UNA transacción que se deshace (node .qa/constructor-aw/sql-prueba.js
-- pruebas/sql/jornadas-b25.sql). La última consulta: una fila por caso (ok) y el RESUMEN.
-- =============================================================================

create table public.zz_j_resultados (n serial primary key, grupo text, caso text, ok boolean, detalle text);
grant insert, select on public.zz_j_resultados to authenticated;
grant usage on sequence public.zz_j_resultados_n_seq to authenticated;
create function public.zz_j_anotar(p_grupo text, p_caso text, p_ok boolean, p_detalle text default null)
returns void language sql as $$
  insert into public.zz_j_resultados (grupo, caso, ok, detalle) values (p_grupo, p_caso, coalesce(p_ok, false), p_detalle);
$$;
grant execute on function public.zz_j_anotar(text, text, boolean, text) to authenticated, anon;
-- Corre una sentencia y la deshace. → 'ok' o 'SQLSTATE|pista|mensaje'
create function public.zz_j_intentar(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'zz_j_deshacer';
  exception when others then
    if sqlerrm = 'zz_j_deshacer' then return 'ok'; end if;
    declare h text; begin
      get stacked diagnostics h = pg_exception_hint;
      return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
    end;
  end;
end $$;
grant execute on function public.zz_j_intentar(text) to authenticated, anon;
create function public.zz_j_como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
grant execute on function public.zz_j_como(uuid) to authenticated, anon;
-- Lo que ve el rol actual de jornadas (cuántas filas), sin deshacer nada
create function public.zz_j_cuantas(p_donde text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from public.jornadas where ' || p_donde into n;
  return n;
end $$;
grant execute on function public.zz_j_cuantas(text) to authenticated, anon;

-- Dos cuentas de mentira (creadas en septiembre: acceso gratis del T1, pueden escribir), tres grupos
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.jornada1@jissez.test', '2026-09-20', now()),
       ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.jornada2@jissez.test', '2026-09-20', now());
insert into public.grupos (id, maestro_id, nombre, grados, ciclo_escolar) values
  ('00000000-0000-4000-8000-0000000aa001', '00000000-0000-4000-8000-0000000a0001', 'ZZ jornada A', array['3'], '2026-2027'),
  ('00000000-0000-4000-8000-0000000aa002', '00000000-0000-4000-8000-0000000a0001', 'ZZ jornada B', array['4'], '2026-2027'),
  ('00000000-0000-4000-8000-0000000aa003', '00000000-0000-4000-8000-0000000a0002', 'ZZ jornada C', array['1'], '2026-2027');
insert into public.alumnos (id, maestro_id, grupo_id, nombre_completo, grado, num_lista, estatus) values
  ('00000000-0000-4000-8000-0000000ab001', '00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000aa001', 'ZZ ALUMNO A', 3, 1, 'activo');

-- ── 1. La marca de la nota (trigger de b12 ampliado) ─────────────────────────
insert into public.registro_diario (id, maestro_id, alumno_id, fecha, participacion, conducta)
values ('00000000-0000-4000-8000-0000000ac001', '00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000ab001', date '2031-01-05', 1, 1);
select public.zz_j_anotar('marca', 'un insert sin marcas recibe las tres (participación, conducta y nota)',
  (select captura_participacion is not null and captura_conducta is not null and captura_nota is not null from public.registro_diario where id = '00000000-0000-4000-8000-0000000ac001'));
create temp table zz_j_m as select captura_participacion as p, captura_conducta as c, captura_nota as n from public.registro_diario where id = '00000000-0000-4000-8000-0000000ac001';
update public.registro_diario set nota = 'Llegó tarde' where id = '00000000-0000-4000-8000-0000000ac001';
select public.zz_j_anotar('marca', 'cambiar la nota sin marca nueva deja una marca nueva del servidor y no toca las otras',
  (select r.captura_nota is distinct from m.n and r.captura_participacion = m.p and r.captura_conducta = m.c from public.registro_diario r, zz_j_m m where r.id = '00000000-0000-4000-8000-0000000ac001'));
update zz_j_m set n = (select captura_nota from public.registro_diario where id = '00000000-0000-4000-8000-0000000ac001');
update public.registro_diario set participacion = 2 where id = '00000000-0000-4000-8000-0000000ac001';
select public.zz_j_anotar('marca', 'cambiar la participación no toca la marca de la nota (ni la de la conducta) y sí la suya',
  (select r.captura_nota = m.n and r.captura_conducta = m.c and r.captura_participacion is distinct from m.p from public.registro_diario r, zz_j_m m where r.id = '00000000-0000-4000-8000-0000000ac001'));
update public.registro_diario set nota = 'Llegó tarde' where id = '00000000-0000-4000-8000-0000000ac001';
select public.zz_j_anotar('marca', 'escribir la misma nota no mueve su marca',
  (select r.captura_nota = m.n from public.registro_diario r, zz_j_m m where r.id = '00000000-0000-4000-8000-0000000ac001'));
update public.registro_diario set nota = 'Ayudó al grupo', captura_nota = '00000000-0000-4000-8000-00000000cafe' where id = '00000000-0000-4000-8000-0000000ac001';
select public.zz_j_anotar('marca', 'la marca que trae Hoy con su captura se respeta',
  (select captura_nota = '00000000-0000-4000-8000-00000000cafe' from public.registro_diario where id = '00000000-0000-4000-8000-0000000ac001'));
update public.registro_diario set nota = null where id = '00000000-0000-4000-8000-0000000ac001';
select public.zz_j_anotar('marca', 'borrar la nota (sin marca nueva) también deja una marca del servidor',
  (select captura_nota is distinct from '00000000-0000-4000-8000-00000000cafe'::uuid and captura_nota is not null from public.registro_diario where id = '00000000-0000-4000-8000-0000000ac001'));
insert into public.registro_diario (maestro_id, alumno_id, fecha, participacion, conducta, nota, captura_participacion, captura_conducta, captura_nota)
values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000ab001', date '2031-01-06', null, null, 'Faltó por una cita',
        '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000f001');
select public.zz_j_anotar('marca', 'una fila de quien faltó (participación y conducta nulas, con nota) se inserta y respeta las marcas que trae',
  (select participacion is null and conducta is null and nota = 'Faltó por una cita' and captura_nota = '00000000-0000-4000-8000-00000000f001' and captura_participacion = '00000000-0000-4000-8000-000000000000' from public.registro_diario where fecha = date '2031-01-06'));

-- ── 2. jornadas, como el docente ─────────────────────────────────────────────
select public.zz_j_como('00000000-0000-4000-8000-0000000a0001');
set local role authenticated;
insert into public.jornadas (grupo_id, fecha, resumen) values ('00000000-0000-4000-8000-0000000aa001', date '2026-09-29', '{"trabajos": 3}');
select public.zz_j_anotar('jornadas', 'el docente registra la jornada de su grupo (maestro_id sale de su sesión)',
  (select maestro_id = '00000000-0000-4000-8000-0000000a0001' and fecha = date '2026-09-29' and resumen = '{"trabajos": 3}'::jsonb and cerrada_en is not null from public.jornadas where grupo_id = '00000000-0000-4000-8000-0000000aa001'));
select public.zz_j_anotar('jornadas', 'una jornada por grupo y día: la segunda se rechaza (23505)',
  public.zz_j_intentar($q$insert into public.jornadas (grupo_id, fecha) values ('00000000-0000-4000-8000-0000000aa001', date '2026-09-29')$q$) like '23505|%');
select public.zz_j_anotar('jornadas', 'otro día del mismo grupo sí',
  public.zz_j_intentar($q$insert into public.jornadas (grupo_id, fecha) values ('00000000-0000-4000-8000-0000000aa001', date '2026-10-02')$q$) = 'ok');
select public.zz_j_anotar('jornadas', 'no se registra con el id de otro docente (RLS)',
  public.zz_j_intentar($q$insert into public.jornadas (maestro_id, grupo_id, fecha) values ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-0000000aa001', date '2026-10-05')$q$) like '42501|%');
select public.zz_j_anotar('jornadas', 'no se registra en el grupo de otro docente (RLS), ni con su propio id',
  public.zz_j_intentar($q$insert into public.jornadas (grupo_id, fecha) values ('00000000-0000-4000-8000-0000000aa003', date '2026-10-05')$q$) like '42501|%');
create temp table zz_j_t as select cerrada_en as c, actualizada_en as a from public.jornadas where grupo_id = '00000000-0000-4000-8000-0000000aa001' and fecha = date '2026-09-29';
grant select on zz_j_t to authenticated;
update public.jornadas set cerrada_en = timestamptz '2000-01-01 00:00+00', actualizada_en = timestamptz '2000-01-01 00:00+00', resumen = '{"trabajos": 0}'
 where grupo_id = '00000000-0000-4000-8000-0000000aa001' and fecha = date '2026-09-29';
select public.zz_j_anotar('jornadas', 'finalizar de nuevo: cerrada_en no cambia aunque el aparato mande otra hora, actualizada_en la pone la base y el resumen se actualiza',
  (select j.cerrada_en = t.c and j.actualizada_en = now() and j.actualizada_en <> timestamptz '2000-01-01 00:00+00' and j.resumen = '{"trabajos": 0}'::jsonb
     from public.jornadas j, zz_j_t t where j.grupo_id = '00000000-0000-4000-8000-0000000aa001' and j.fecha = date '2026-09-29'));
select public.zz_j_anotar('jornadas', 'el upsert de la app (insert ... on conflict (grupo_id, fecha) do update) funciona',
  public.zz_j_intentar($q$insert into public.jornadas (grupo_id, fecha, resumen) values ('00000000-0000-4000-8000-0000000aa001', date '2026-09-29', '{"a": 1}') on conflict (grupo_id, fecha) do update set resumen = excluded.resumen$q$) = 'ok');
select public.zz_j_anotar('jornadas', 'no se pasa la jornada al grupo de otro docente (RLS en update)',
  public.zz_j_intentar($q$update public.jornadas set grupo_id = '00000000-0000-4000-8000-0000000aa003' where grupo_id = '00000000-0000-4000-8000-0000000aa001' and fecha = date '2026-09-29'$q$) like '42501|%');
select public.zz_j_anotar('jornadas', 'el docente ve su jornada', public.zz_j_cuantas() = 1);
-- Otra cuenta y anon
reset role;
insert into public.jornadas (maestro_id, grupo_id, fecha) values ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-0000000aa003', date '2026-09-29');
select public.zz_j_como('00000000-0000-4000-8000-0000000a0002');
set local role authenticated;
select public.zz_j_anotar('jornadas', 'otra cuenta ve solo la suya', public.zz_j_cuantas() = 1 and public.zz_j_cuantas($$maestro_id = '00000000-0000-4000-8000-0000000a0001'$$) = 0);
update public.jornadas set resumen = '{"robado": true}' where grupo_id = '00000000-0000-4000-8000-0000000aa001';
delete from public.jornadas where grupo_id = '00000000-0000-4000-8000-0000000aa001';
reset role;
select public.zz_j_anotar('jornadas', 'otra cuenta no puede cambiar ni borrar la jornada ajena (0 filas afectadas)',
  (select count(*) = 1 and bool_and(resumen <> '{"robado": true}'::jsonb) from public.jornadas where grupo_id = '00000000-0000-4000-8000-0000000aa001'));
set local role anon;
select public.zz_j_anotar('jornadas', 'sin sesión (anon) no ve nada y no escribe',
  public.zz_j_cuantas() = 0 and public.zz_j_intentar($q$insert into public.jornadas (maestro_id, grupo_id, fecha) values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000aa001', date '2026-11-01')$q$) like '42501|%');
reset role;

-- ── 3. Solo lectura (b21): sin acceso vigente se lee pero no se escribe ──────
delete from public.mi_salon_accesos where docente_id = '00000000-0000-4000-8000-0000000a0001';
select public.zz_j_como('00000000-0000-4000-8000-0000000a0001');
set local role authenticated;
select public.zz_j_anotar('solo lectura', 'sin acceso: la jornada se lee', public.zz_j_cuantas() = 1);
select public.zz_j_anotar('solo lectura', 'sin acceso: registrar una jornada se rechaza con el aviso de solo lectura',
  public.zz_j_intentar($q$insert into public.jornadas (grupo_id, fecha) values ('00000000-0000-4000-8000-0000000aa002', date '2026-10-03')$q$) like '42501|mi_salon_solo_lectura|%');
select public.zz_j_anotar('solo lectura', 'sin acceso: finalizar de nuevo (update) se rechaza',
  public.zz_j_intentar($q$update public.jornadas set resumen = '{}' where grupo_id = '00000000-0000-4000-8000-0000000aa001'$q$) like '42501|mi_salon_solo_lectura|%');
select public.zz_j_anotar('solo lectura', 'sin acceso: borrar la jornada se rechaza',
  public.zz_j_intentar($q$delete from public.jornadas where grupo_id = '00000000-0000-4000-8000-0000000aa001'$q$) like '42501|mi_salon_solo_lectura|%');
select public.zz_j_anotar('solo lectura', 'sin acceso: el comentario del día (registro_diario.nota) tampoco se escribe',
  public.zz_j_intentar($q$update public.registro_diario set nota = 'x' where id = '00000000-0000-4000-8000-0000000ac001'$q$) like '42501|mi_salon_solo_lectura|%');

-- ── 4. Borrar la cuenta se lleva sus jornadas (con o sin acceso) ─────────────
select public.zz_j_anotar('cuenta', 'delete_own_account menciona jornadas con su guarda to_regclass',
  position('to_regclass(''public.jornadas'')' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0
  and position('incidencias_folios' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0);
select public.delete_own_account();
reset role;
select public.zz_j_anotar('cuenta', 'se fueron la cuenta, sus jornadas y su comentario; la jornada de la otra cuenta sigue',
  not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000a0001')
  and not exists (select 1 from public.jornadas where maestro_id = '00000000-0000-4000-8000-0000000a0001')
  and not exists (select 1 from public.registro_diario where maestro_id = '00000000-0000-4000-8000-0000000a0001')
  and exists (select 1 from public.jornadas where maestro_id = '00000000-0000-4000-8000-0000000a0002'));

-- ── 5. El candado en cifras ──────────────────────────────────────────────────
select public.zz_j_anotar('candado', '138 políticas de candado en 46 tablas (jornadas incluida)',
  (select count(*) from pg_policies where policyname like 'acceso_mi_salon%') = 138
  and (select count(distinct tablename) from pg_policies where policyname like 'acceso_mi_salon%') = 46
  and (select count(*) from pg_policies where tablename = 'jornadas' and policyname like 'acceso_mi_salon%') = 3,
  (select count(*) || ' en ' || count(distinct tablename) from pg_policies where policyname like 'acceso_mi_salon%'));

select grupo, caso, ok, detalle from public.zz_j_resultados
union all
select 'RESUMEN', count(*) filter (where not ok) || ' fallas de ' || count(*), count(*) filter (where not ok) = 0, null from public.zz_j_resultados;
