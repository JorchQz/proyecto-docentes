-- =============================================================================
-- Prueba SQL: folio de las incidencias (decisión de Jorge del 2026-09-26;
-- supabase/mi_salon_b23_folio_incidencias_2026-09.sql §1).
--   1. guardar_incidencia (como el docente, con RLS y el candado de b21) asigna
--      RDI-<ciclo del grupo>-0001, 0002... por grupo y ciclo.
--   2. Otro grupo lleva su propio consecutivo.
--   3. Un folio borrado no se reutiliza.
--   4. El folio no se edita (ni directo ni al editar con guardar_incidencia) y el que mande el
--      cliente al crear se ignora.
--   5. El ciclo se normaliza ("2026 - 2027" → 2026-2027) y un ciclo nuevo del grupo empieza en 0001.
--   6. El contador: el docente lo lee (solo el suyo) pero no lo escribe; otra cuenta no lo ve.
--   7. delete_own_account se lleva también el contador.
--   8. Del 9999 se pasa a 10000 (sin cortar dígitos).
-- La concurrencia (dos altas al mismo tiempo) se prueba con dos conexiones en
-- .qa/constructor-ao (el bloqueo de la fila del contador no se ve en una sola transacción).
--
-- SOLO en PRUEBAS, dentro de UNA transacción que se deshace (node .qa/constructor-an/sql-prueba.js
-- pruebas/sql/incidencias-folio.sql). La última consulta: una fila por caso (ok) y el RESUMEN.
-- =============================================================================

create table public.zz_if_resultados (n serial primary key, grupo text, caso text, ok boolean, detalle text);
grant insert, select on public.zz_if_resultados to authenticated;
grant usage on sequence public.zz_if_resultados_n_seq to authenticated;
create function public.zz_if_anotar(p_caso text, p_ok boolean, p_detalle text default null)
returns void language sql as $$
  insert into public.zz_if_resultados (grupo, caso, ok, detalle) values ('folio', p_caso, coalesce(p_ok, false), p_detalle);
$$;
grant execute on function public.zz_if_anotar(text, boolean, text) to authenticated;
-- Corre una sentencia y la deshace. → 'ok' o 'SQLSTATE|pista'
create function public.zz_if_intentar(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'zz_if_deshacer';
  exception when others then
    if sqlerrm = 'zz_if_deshacer' then return 'ok'; end if;
    declare h text; begin
      get stacked diagnostics h = pg_exception_hint;
      return sqlstate || '|' || coalesce(h, '');
    end;
  end;
end $$;
grant execute on function public.zz_if_intentar(text) to authenticated;
create function public.zz_if_como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
grant execute on function public.zz_if_como(uuid) to authenticated;
-- Alta como el docente (guardar_incidencia) → el folio que quedó
create function public.zz_if_alta(p_grupo uuid, p_alumno uuid, p_asunto text) returns text language plpgsql as $$
declare v uuid;
begin
  v := public.guardar_incidencia(null, p_grupo, p_asunto, date '2026-09-25', time '10:00', 'Prueba de folio', null, array[p_alumno]);
  return (select folio from public.incidencias where id = v);
end $$;
grant execute on function public.zz_if_alta(uuid, uuid, text) to authenticated;

-- Dos cuentas de mentira (creadas en septiembre: acceso gratis del T1, pueden escribir), dos grupos
-- de la primera y uno de la segunda, con un alumno cada uno
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.folio1@jissez.test', '2026-09-20', now()),
       ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.folio2@jissez.test', '2026-09-20', now());
insert into public.grupos (id, maestro_id, nombre, grados, ciclo_escolar) values
  ('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0001', 'ZZ folio A', array['3'], '2026-2027'),
  ('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-4000-8000-0000000f0001', 'ZZ folio B', array['4'], '2026 - 2027'),
  ('00000000-0000-4000-8000-0000000f0a03', '00000000-0000-4000-8000-0000000f0002', 'ZZ folio C', array['1'], '2026-2027');
insert into public.alumnos (id, maestro_id, grupo_id, nombre_completo, grado, num_lista, estatus) values
  ('00000000-0000-4000-8000-0000000f0b01', '00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000f0a01', 'ZZ ALUMNO A', 3, 1, 'activo'),
  ('00000000-0000-4000-8000-0000000f0b02', '00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000f0a02', 'ZZ ALUMNO B', 4, 1, 'activo'),
  ('00000000-0000-4000-8000-0000000f0b03', '00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000f0a03', 'ZZ ALUMNO C', 1, 1, 'activo');

select public.zz_if_como('00000000-0000-4000-8000-0000000f0001');
set local role authenticated;

-- 1 y 2. Consecutivo por grupo
select public.zz_if_anotar('grupo A: la primera es RDI-2026-2027-0001 y la segunda 0002',
  public.zz_if_alta('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'ZZ uno') = 'RDI-2026-2027-0001'
  and public.zz_if_alta('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'ZZ dos') = 'RDI-2026-2027-0002',
  (select string_agg(folio, ', ' order by folio) from public.incidencias where grupo_id = '00000000-0000-4000-8000-0000000f0a01'));
select public.zz_if_anotar('grupo B (ciclo escrito "2026 - 2027"): su propio consecutivo, RDI-2026-2027-0001',
  public.zz_if_alta('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-4000-8000-0000000f0b02', 'ZZ B uno') = 'RDI-2026-2027-0001');

-- 3. Un folio borrado no se reutiliza
delete from public.incidencias where grupo_id = '00000000-0000-4000-8000-0000000f0a01' and folio = 'RDI-2026-2027-0002';
select public.zz_if_anotar('borrar la 0002 no libera su número: la siguiente es 0003',
  public.zz_if_alta('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'ZZ tres') = 'RDI-2026-2027-0003');

-- 4. No se edita; el del cliente se ignora
select public.zz_if_anotar('cambiar el folio directo se rechaza (folio_fijo)',
  public.zz_if_intentar($q$update public.incidencias set folio = 'RDI-2026-2027-0099'
    where grupo_id = '00000000-0000-4000-8000-0000000f0a01' and folio = 'RDI-2026-2027-0001'$q$) = 'P0001|folio_fijo');
select public.guardar_incidencia((select id from public.incidencias where grupo_id = '00000000-0000-4000-8000-0000000f0a01' and folio = 'RDI-2026-2027-0001'),
  '00000000-0000-4000-8000-0000000f0a01', 'ZZ uno editada', date '2026-09-24', null, 'Otra descripción', 'Acuerdo', array['00000000-0000-4000-8000-0000000f0b01'::uuid]);
select public.zz_if_anotar('editar con guardar_incidencia conserva el folio',
  exists (select 1 from public.incidencias where asunto = 'ZZ uno editada' and folio = 'RDI-2026-2027-0001'));
insert into public.incidencias (grupo_id, asunto, fecha, descripcion, folio)
values ('00000000-0000-4000-8000-0000000f0a01', 'ZZ con folio del cliente', date '2026-09-25', 'x', 'RDI-2026-2027-0001');
select public.zz_if_anotar('al crear, el folio que manda el cliente se ignora (queda 0004)',
  (select folio from public.incidencias where asunto = 'ZZ con folio del cliente') = 'RDI-2026-2027-0004',
  (select folio from public.incidencias where asunto = 'ZZ con folio del cliente'));

-- 6. El contador
select public.zz_if_anotar('el docente lee su contador (A en 4, B en 1) y no lo puede escribir',
  (select string_agg(ultimo::text, ',' order by ultimo desc) from public.incidencias_folios) = '4,1'
  and public.zz_if_intentar($q$update public.incidencias_folios set ultimo = 0$q$) like '42501|%'
  and public.zz_if_intentar($q$insert into public.incidencias_folios (grupo_id, ciclo, maestro_id, ultimo) values ('00000000-0000-4000-8000-0000000f0a01', '2030-2031', '00000000-0000-4000-8000-0000000f0001', 5)$q$) like '42501|%'
  and public.zz_if_intentar($q$delete from public.incidencias_folios$q$) like '42501|%',
  (select string_agg(ultimo::text, ',' order by ultimo desc) from public.incidencias_folios));
select public.zz_if_como('00000000-0000-4000-8000-0000000f0002');
select public.zz_if_anotar('otra cuenta no ve el contador ni las incidencias de la primera; su grupo empieza en 0001',
  (select count(*) from public.incidencias_folios) = 0 and (select count(*) from public.incidencias) = 0
  and public.zz_if_alta('00000000-0000-4000-8000-0000000f0a03', '00000000-0000-4000-8000-0000000f0b03', 'ZZ C uno') = 'RDI-2026-2027-0001');

-- 5. Ciclo nuevo del grupo: consecutivo nuevo
reset role;
update public.grupos set ciclo_escolar = '2027-2028' where id = '00000000-0000-4000-8000-0000000f0a01';
select public.zz_if_como('00000000-0000-4000-8000-0000000f0001');
set local role authenticated;
select public.zz_if_anotar('el grupo pasa al ciclo 2027-2028: RDI-2027-2028-0001 (las del ciclo anterior conservan el suyo)',
  public.zz_if_alta('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'ZZ ciclo nuevo') = 'RDI-2027-2028-0001'
  and exists (select 1 from public.incidencias where folio = 'RDI-2026-2027-0003'));

-- 8. Más de 9999
reset role;
update public.incidencias_folios set ultimo = 9999 where grupo_id = '00000000-0000-4000-8000-0000000f0a02';
set local role authenticated;
select public.zz_if_anotar('después de la 9999 sigue la 10000 (sin cortar dígitos)',
  public.zz_if_alta('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-4000-8000-0000000f0b02', 'ZZ diez mil') = 'RDI-2026-2027-10000');

-- 7. Borrar la cuenta se lleva el contador
select public.zz_if_anotar('delete_own_account se lleva las incidencias y el contador de folios',
  public.zz_if_intentar('select public.delete_own_account()') = 'ok');
select public.delete_own_account();
reset role;
select public.zz_if_anotar('… y ya no queda nada de la cuenta',
  not exists (select 1 from public.incidencias_folios where maestro_id = '00000000-0000-4000-8000-0000000f0001')
  and not exists (select 1 from public.incidencias where maestro_id = '00000000-0000-4000-8000-0000000f0001')
  and not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000f0001')
  and exists (select 1 from public.incidencias_folios where maestro_id = '00000000-0000-4000-8000-0000000f0002'));

select grupo, caso, ok, detalle from public.zz_if_resultados
union all
select 'RESUMEN', count(*) filter (where not ok) || ' fallas de ' || count(*), count(*) filter (where not ok) = 0, null from public.zz_if_resultados;
