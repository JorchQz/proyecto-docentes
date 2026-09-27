-- =============================================================================
-- Prueba SQL: la calificación directa cuenta YA como confirmada (decisión de Jorge del
-- 2026-09-26; supabase/mi_salon_b20_registro_historico_2026-09.sql §2b).
--   1. Capturarla (como el docente, con RLS y el candado de b21) deja boleta_trimestral de ese
--      campo con esa calificación, confirmada, sin porcentaje y con el nivel de sus cortes.
--   2. Cambiarla cambia la confirmada.
--   3. Confirmar otro número en la boleta (Reportes) pasa a la directa (espejo).
--   4. Borrarla vuelve al cálculo automático: la boleta deja de estar confirmada.
--   5. Con la boleta cerrada: no se crea, ni se cambia, ni se borra (b23; R27a).
--      Borrar el alumno (cascada) sí pasa aunque su boleta esté cerrada.
--   6. Una confirmada en Reportes SIN directa no cambia con otras escrituras.
--   7. Escala del grado: un 5 en 1° se rechaza (la boleta no se toca).
--   8. Borrar el alumno (cascada) no falla.
--   9. Sin acceso vigente (solo lectura, b21) la directa no se guarda.
--
-- SOLO en PRUEBAS, dentro de UNA transacción que se deshace (node .qa/constructor-an/sql-prueba.js
-- pruebas/sql/calificacion-directa.sql). La última consulta: una fila por caso (ok) y el RESUMEN.
-- =============================================================================

create table public.zz_cd_resultados (n serial primary key, grupo text, caso text, ok boolean, detalle text);
grant insert, select on public.zz_cd_resultados to authenticated;
grant usage on sequence public.zz_cd_resultados_n_seq to authenticated;
create function public.zz_cd_anotar(p_caso text, p_ok boolean, p_detalle text default null)
returns void language sql as $$
  insert into public.zz_cd_resultados (grupo, caso, ok, detalle) values ('directa', p_caso, coalesce(p_ok, false), p_detalle);
$$;
grant execute on function public.zz_cd_anotar(text, boolean, text) to authenticated;
-- Fila de la boleta de un campo, en texto (calificacion|confirmada|porcentaje|nivel|cerrada)
create function public.zz_cd_boleta(p_alumno uuid, p_campo text) returns text language sql as $$
  select coalesce((select coalesce(b.calificacion::text, '-') || '|' || coalesce(b.calificacion_confirmada, false) || '|' ||
                          coalesce(b.porcentaje::text, '-') || '|' || coalesce(b.nivel, '-') || '|' || coalesce(b.cerrada, false)
                     from public.boleta_trimestral b
                    where b.alumno_id = p_alumno and b.ciclo = '2026-2027' and b.trimestre = 1 and b.campo = p_campo), 'sin fila');
$$;
grant execute on function public.zz_cd_boleta(uuid, text) to authenticated;
-- Corre una sentencia y la deshace. → 'ok' o 'SQLSTATE|pista'
create function public.zz_cd_intentar(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'zz_cd_deshacer';
  exception when others then
    if sqlerrm = 'zz_cd_deshacer' then return 'ok'; end if;
    declare h text; begin get stacked diagnostics h = pg_exception_hint; return sqlstate || '|' || coalesce(h, ''); end;
  end;
end $$;
grant execute on function public.zz_cd_intentar(text) to authenticated;

-- Cuenta, grupo y dos alumnos (2° y 1°) de mentira; la cuenta nace con el T1 gratis (b21)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz.cd@jissez.test', now(), now(), now());
insert into public.perfiles (id, nombre_completo, activo_saas) values ('00000000-0000-4000-8000-00000000cd01', 'ZZ directa', true)
  on conflict (id) do update set activo_saas = true;
insert into public.grupos (id, maestro_id, nombre, grados, ciclo_escolar)
values ('00000000-0000-4000-8000-00000000cd02', '00000000-0000-4000-8000-00000000cd01', 'ZZ directa', array[1, 2], '2026-2027');
insert into public.alumnos (id, maestro_id, grupo_id, nombre_completo, grado)
values ('00000000-0000-4000-8000-00000000cd03', '00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', 'ZZ Ana', 2),
       ('00000000-0000-4000-8000-00000000cd04', '00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', 'ZZ Beto', 1);

-- Como el docente (PostgREST): rol authenticated con su JWT
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000cd01', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000cd01', true);
set local role authenticated;

-- 1. Capturarla
insert into public.calificacion_directa (maestro_id, grupo_id, alumno_id, ciclo, trimestre, campo, calificacion)
values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', '00000000-0000-4000-8000-00000000cd03', '2026-2027', 1, 'LEN', 8);
select public.zz_cd_anotar('capturarla la deja confirmada en la boleta (8, sin porcentaje, en proceso)',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN') = '8|true|-|en_proceso|false',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN'));
select public.zz_cd_anotar('confirmada_en queda sellada (trigger de la boleta)',
  (select confirmada_en is not null from public.boleta_trimestral where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'LEN' and trimestre = 1));

-- 2. Cambiarla
update public.calificacion_directa set calificacion = 10
 where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'LEN' and trimestre = 1;
select public.zz_cd_anotar('cambiarla cambia la confirmada (10, logrado)',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN') = '10|true|-|logrado|false',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN'));

-- 3. Confirmar otro número en Reportes (upsert de la boleta, como js/reportes.js)
insert into public.boleta_trimestral (maestro_id, alumno_id, ciclo, trimestre, campo, calificacion, calificacion_confirmada)
values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd03', '2026-2027', 1, 'LEN', 9, true)
on conflict (maestro_id, alumno_id, ciclo, trimestre, campo) do update set calificacion = excluded.calificacion, calificacion_confirmada = true;
select public.zz_cd_anotar('confirmar otro número en la boleta pasa a la directa (espejo)',
  (select calificacion from public.calificacion_directa where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'LEN' and trimestre = 1) = 9
  and public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN') like '9|true|%',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN'));

-- 4. Borrarla: vuelve al cálculo automático
delete from public.calificacion_directa where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'LEN' and trimestre = 1;
select public.zz_cd_anotar('borrarla: la boleta deja de estar confirmada y su número se limpia',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN') = '-|false|-|-|false',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'LEN'));

-- 6. Una confirmada en Reportes sin directa no cambia sola
insert into public.boleta_trimestral (maestro_id, alumno_id, ciclo, trimestre, campo, calificacion, calificacion_confirmada)
values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd03', '2026-2027', 1, 'SAB', 7, true);
select public.zz_cd_anotar('una confirmada en Reportes sin directa sigue igual',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB') like '7|true|%'
  and not exists (select 1 from public.calificacion_directa where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'SAB'),
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB'));
-- ...y una directa sobre ella la reemplaza (la directa ES la confirmada)
insert into public.calificacion_directa (maestro_id, grupo_id, alumno_id, ciclo, trimestre, campo, calificacion)
values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', '00000000-0000-4000-8000-00000000cd03', '2026-2027', 1, 'SAB', 6);
select public.zz_cd_anotar('una directa sobre una confirmada la reemplaza (6, requiere apoyo)',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB') = '6|true|-|requiere_apoyo|false',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB'));

-- 7. Escala del grado: 5 en 1° no
select public.zz_cd_anotar('un 5 en 1° se rechaza (fuera de escala) y la boleta no se toca',
  public.zz_cd_intentar($q$insert into public.calificacion_directa (maestro_id, grupo_id, alumno_id, ciclo, trimestre, campo, calificacion)
    values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', '00000000-0000-4000-8000-00000000cd04', '2026-2027', 1, 'LEN', 5)$q$) like '23514|fuera_de_escala'
  and public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd04', 'LEN') = 'sin fila',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd04', 'LEN'));

-- 5. Boleta cerrada (se cierra como lo hace cerrar_boleta: con la marca de la función)
reset role;
select set_config('mi_salon.cerrando_boleta', 'si', true);
update public.boleta_trimestral set cerrada = true
 where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'SAB' and trimestre = 1;
select set_config('mi_salon.cerrando_boleta', '', true);
set local role authenticated;
select public.zz_cd_anotar('con la boleta cerrada no se cambia (boleta_cerrada)',
  public.zz_cd_intentar($q$update public.calificacion_directa set calificacion = 9
    where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'SAB' and trimestre = 1$q$) like 'P0001|boleta_cerrada',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB'));
select public.zz_cd_anotar('con la boleta cerrada no se borra (boleta_cerrada, b23) y lo entregado no cambia',
  public.zz_cd_intentar($q$delete from public.calificacion_directa
    where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'SAB' and trimestre = 1$q$) = 'P0001|boleta_cerrada'
  and (select count(*) from public.calificacion_directa where alumno_id = '00000000-0000-4000-8000-00000000cd03' and campo = 'SAB' and trimestre = 1) = 1
  and public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB') = '6|true|-|requiere_apoyo|true',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'SAB'));

-- 9. Solo lectura (b21): sin acceso vigente la directa no se guarda
reset role;
update public.mi_salon_accesos set vence_fijo = null, periodos = '{T1}', ciclo = '2025-2026'
 where docente_id = '00000000-0000-4000-8000-00000000cd01';
set local role authenticated;
select public.zz_cd_anotar('sin acceso vigente: la directa no se guarda (mi_salon_solo_lectura)',
  public.zz_cd_intentar($q$insert into public.calificacion_directa (maestro_id, grupo_id, alumno_id, ciclo, trimestre, campo, calificacion)
    values ('00000000-0000-4000-8000-00000000cd01', '00000000-0000-4000-8000-00000000cd02', '00000000-0000-4000-8000-00000000cd03', '2026-2027', 1, 'ETI', 9)$q$) = '42501|mi_salon_solo_lectura',
  public.zz_cd_boleta('00000000-0000-4000-8000-00000000cd03', 'ETI'));

-- 8. Borrar el alumno (cascada, como el dueño de la base) no falla
reset role;
select public.zz_cd_anotar('borrar el alumno con directa (cascada) no falla',
  public.zz_cd_intentar($q$delete from public.alumnos where id = '00000000-0000-4000-8000-00000000cd04'$q$) = 'ok');
select public.zz_cd_anotar('borrar el alumno con directa en una boleta CERRADA (cascada) no falla',
  public.zz_cd_intentar($q$delete from public.alumnos where id = '00000000-0000-4000-8000-00000000cd03'$q$) = 'ok',
  public.zz_cd_intentar($q$delete from public.alumnos where id = '00000000-0000-4000-8000-00000000cd03'$q$));

select grupo, caso, ok, detalle from public.zz_cd_resultados
union all
select 'RESUMEN', count(*) filter (where not ok) || ' fallas de ' || count(*), count(*) filter (where not ok) = 0, null from public.zz_cd_resultados;
