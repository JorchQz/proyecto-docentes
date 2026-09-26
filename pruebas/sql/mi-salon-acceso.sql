-- =============================================================================
-- Pruebas SQL del acceso a Mi Salón (b21): vencimiento calculado, gratis del T1 (sin prueba
-- de 14 días), piloto, interruptor, candado de escritura en CADA tabla, tolerancia de 48 h,
-- RPC security definer y borrar la cuenta sin acceso.
--
-- SOLO en el proyecto de PRUEBAS. Todo corre dentro de UNA transacción que se deshace al final:
--     begin;  \i pruebas/sql/mi-salon-acceso.sql  rollback;
-- (el ejecutor .qa-al/sql-prueba.js hace exactamente eso). No deja nada escrito.
-- Resultado: la última consulta devuelve una fila por caso (ok = true/false). Todas deben
-- salir en true; la fila "RESUMEN" cuenta las fallas.
--
-- Cuentas: QA1 (qa.misalon@jissez.com, con datos sembrados) para las escrituras reales; dos
-- cuentas de mentira que se crean y se deshacen para el alta y el interruptor.
-- =============================================================================

create table public.zz_b21_resultados (n serial primary key, grupo text, caso text, ok boolean, detalle text);
grant insert, select on public.zz_b21_resultados to authenticated;
grant usage on sequence public.zz_b21_resultados_n_seq to authenticated;

create function public.zz_b21_anotar(p_grupo text, p_caso text, p_ok boolean, p_detalle text default null)
returns void language sql as $$
  insert into public.zz_b21_resultados (grupo, caso, ok, detalle) values (p_grupo, p_caso, coalesce(p_ok, false), p_detalle);
$$;
grant execute on function public.zz_b21_anotar(text, text, boolean, text) to authenticated;

-- Corre una sentencia y la deshace siempre (subtransacción). → 'ok' o 'SQLSTATE|pista|mensaje'
create function public.zz_b21_intentar(p_sql text)
returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'zz_b21_deshacer';
  exception when others then
    if sqlerrm = 'zz_b21_deshacer' then return 'ok'; end if;
    declare h text; begin
      get stacked diagnostics h = pg_exception_hint;
      return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
    end;
  end;
end $$;
grant execute on function public.zz_b21_intentar(text) to authenticated;

-- Hace de cuenta con sesión (como PostgREST): claims del JWT y rol
create function public.zz_b21_como(p_uid uuid, p_email text, p_headers text default '{}')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.headers', p_headers, true);
end $$;
grant execute on function public.zz_b21_como(uuid, text, text) to authenticated;

-- Las tablas con candado (las mismas que la migración)
create function public.zz_b21_tablas() returns setof text language sql as $$
  select t from unnest(array[
    'actividades_proyecto', 'alumnos', 'asistencias', 'boleta_trimestral', 'calendario_ajustes',
    'calificacion_directa', 'calificaciones', 'dias_no_habiles_extra', 'evaluacion_diagnostica',
    'evaluacion_formativa', 'examen_alumnos', 'examen_preguntas', 'examen_respuestas',
    'examen_resultados', 'examenes', 'examenes_grupo', 'grupos', 'incidencia_alumnos',
    'incidencias', 'listas_columnas', 'listas_grupo', 'listas_valores', 'maestro_ajustes',
    'producto_sesion_alumnos', 'producto_sesion_pda', 'productos_finales', 'productos_sesion',
    'proyectos', 'proyectos_contenidos', 'registro_diario', 'respuestas_examen', 'roles_aseo',
    'sesiones', 'sesiones_pda', 'tareas',
    'zz_deprecated_calificacion_tarea', 'zz_deprecated_calificacion_trabajo',
    'zz_deprecated_configuracion_calificacion', 'zz_deprecated_diagnosticos',
    'zz_deprecated_entregas_producto_final', 'zz_deprecated_evaluacion_cuaderno',
    'zz_deprecated_evaluacion_habilidades_basicas', 'zz_deprecated_participacion_jornada',
    'zz_deprecated_registros_diarios'
  ]) t where to_regclass('public.' || t) is not null;
$$;
grant execute on function public.zz_b21_tablas() to authenticated;

/*
  Intenta INSERT, UPDATE y DELETE en una tabla como la cuenta con sesión (cada uno se deshace).
  INSERT: copia una fila propia (con id nuevo) o, si no hay, una fila con solo maestro_id.
  → jsonb { ins, upd, del } con 'ok' o el error; 'sin_fila' si no hay fila propia que tocar.
  Una tabla sin filas propias de QA1 se prepara antes (sección D): una política permisiva
  de INSERT abierta y sin triggers, para que el INSERT de la fila mínima llegue a las
  políticas restrictivas y se vea SOLO el efecto del candado (todo se deshace al final).
*/
create function public.zz_b21_escrituras(p_tabla text, p_uid uuid)
returns jsonb language plpgsql as $$
declare
  v_tiene_id boolean;
  v_tiene_maestro boolean;
  v_col text;
  v_hay boolean;
  v_ins text; v_upd text; v_del text;
  v_cols text;
begin
  -- Columnas que se pueden insertar (sin las generadas, las de identidad ni el id con default:
  -- la copia recibe un id nuevo)
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols from pg_attribute a
   where a.attrelid = ('public.' || p_tabla)::regclass and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity = '' and not (a.attname = 'id' and a.atthasdef);
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_tabla and column_name = 'id'),
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_tabla and column_name = 'maestro_id')
    into v_tiene_id, v_tiene_maestro;
  select a.attname into v_col from pg_attribute a
   where a.attrelid = ('public.' || p_tabla)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
   order by a.attnum limit 1;
  execute format('select exists (select 1 from public.%I)', p_tabla) into v_hay;
  if v_hay then
    v_ins := public.zz_b21_intentar(format(
      'insert into public.%1$I (%2$s) select %2$s from (select (jsonb_populate_record(null::public.%1$I, to_jsonb(x))).* from public.%1$I x limit 1) y',
      p_tabla, v_cols));
    v_upd := public.zz_b21_intentar(format('update public.%1$I set %2$I = %2$I where ctid = (select ctid from public.%1$I limit 1)', p_tabla, v_col));
    v_del := public.zz_b21_intentar(format('delete from public.%1$I where ctid = (select ctid from public.%1$I limit 1)', p_tabla));
  else
    v_ins := public.zz_b21_intentar(format(
      'insert into public.%1$I (%3$s) select %3$s from (select (jsonb_populate_record(null::public.%1$I, %2$L::jsonb)).*) y', p_tabla,
      case when v_tiene_maestro then jsonb_build_object('maestro_id', p_uid)::text else '{}' end, v_cols));
    v_upd := 'sin_fila';
    v_del := 'sin_fila';
  end if;
  return jsonb_build_object('ins', v_ins, 'upd', v_upd, 'del', v_del);
end $$;
grant execute on function public.zz_b21_escrituras(text, uuid) to authenticated;

-- Deja a una cuenta con un solo acceso de prueba: vence_fijo (null = sin ningún acceso)
create function public.zz_b21_dejar_acceso(p_uid uuid, p_vence date, p_desde timestamptz default '2026-08-31 00:00-06')
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.mi_salon_accesos where docente_id = p_uid;
  if p_vence is not null then
    insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, vence_fijo, desde, notas)
    values (p_uid, '2026-2027', '{}', 'regalo_admin', p_vence, p_desde, 'QA b21 prueba');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Vencimiento calculado desde mi_salon_periodos
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  v date; f timestamptz; a public.mi_salon_accesos;
begin
  select * into a from public.mi_salon_accesos where docente_id = qa1 and origen = 'gratis_t1';
  perform public.zz_b21_anotar('vencimiento', 'gratis_t1 vence el 18-dic-2026 (del calendario)', public.mi_salon_vence(a) = date '2026-12-18', public.mi_salon_vence(a)::text);
  perform public.zz_b21_anotar('vencimiento', 'el fin es el 19-dic 00:00 hora del centro', public.mi_salon_fin(a) = timestamptz '2026-12-19 00:00:00-06', public.mi_salon_fin(a)::text);
  select * into a from public.mi_salon_accesos where docente_id = qa1 and origen = 'piloto';
  perform public.zz_b21_anotar('vencimiento', 'piloto T1-T3 vence el 30-jul-2027', public.mi_salon_vence(a) = date '2027-07-30', public.mi_salon_vence(a)::text);

  -- Se corrige una fecha del calendario: el acceso se ajusta solo
  update public.mi_salon_periodos set vence = '2026-12-21' where ciclo = '2026-2027' and periodo = 'T1';
  select * into a from public.mi_salon_accesos where docente_id = qa1 and origen = 'gratis_t1';
  perform public.zz_b21_anotar('vencimiento', 'al mover el T1 al 21-dic, el gratis vence el 21-dic', public.mi_salon_vence(a) = date '2026-12-21', public.mi_salon_vence(a)::text);
  update public.mi_salon_periodos set vence = '2026-12-18' where ciclo = '2026-2027' and periodo = 'T1';

  -- El más tardío de los periodos cubiertos y vence_fijo
  a.periodos := array['T1', 'T2']; a.vence_fijo := null;
  perform public.zz_b21_anotar('vencimiento', 'T1+T2 → 9-abr-2027', public.mi_salon_vence(a) = date '2027-04-09', public.mi_salon_vence(a)::text);
  a.periodos := array['T2']; a.vence_fijo := date '2027-05-01';
  perform public.zz_b21_anotar('vencimiento', 'T2 con vence_fijo 1-may → 1-may', public.mi_salon_vence(a) = date '2027-05-01', public.mi_salon_vence(a)::text);
  -- Un ciclo que aún no está cargado no suma (compra tardía del T3: vence provisionalmente con el T3)
  a.ciclo := '2027-2028'; a.periodos := array['T1']; a.vence_fijo := null;
  perform public.zz_b21_anotar('vencimiento', 'T1 de 2027-2028 sin cargar → sin vencimiento propio', public.mi_salon_vence(a) is null, coalesce(public.mi_salon_vence(a)::text, 'null'));
  -- Un orden de fechas imposible se rechaza
  perform public.zz_b21_anotar('vencimiento', 'el calendario no acepta vence antes de las boletas',
    public.zz_b21_intentar($q$update public.mi_salon_periodos set vence = '2026-11-01' where ciclo = '2026-2027' and periodo = 'T1'$q$) like '23514|%',
    public.zz_b21_intentar($q$update public.mi_salon_periodos set vence = '2026-11-01' where ciclo = '2026-2027' and periodo = 'T1'$q$));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Alta: gratis_t1 hasta el 18-dic-2026; desde el 19-dic, nada (sin prueba de 14 días)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.b21.oct@jissez.test', '2026-09-20 10:00-06', now()),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.b21.ultimo@jissez.test', '2026-12-18 23:30-06', now()),
         (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.b21.dic19@jissez.test', '2026-12-19 00:30-06', now());
  select count(*) into n from public.mi_salon_accesos where docente_id = u1 and origen = 'gratis_t1' and periodos = array['T1'];
  perform public.zz_b21_anotar('alta', 'cuenta del 20-sep recibe gratis_t1 (trigger)', n = 1, n::text);
  select count(*) into n from public.mi_salon_accesos where docente_id = u2 and origen = 'gratis_t1';
  perform public.zz_b21_anotar('alta', 'cuenta del 18-dic 23:30 (hora del centro) recibe gratis_t1', n = 1, n::text);
  select count(*) into n from public.mi_salon_accesos where docente_id = u3;
  perform public.zz_b21_anotar('alta', 'cuenta del 19-dic no recibe ningún acceso (sin prueba de 14 días)', n = 0, n::text);
  -- El respaldo no duplica
  perform public.mi_salon_dar_gratis(u1, '2026-09-20 10:00-06');
  select count(*) into n from public.mi_salon_accesos where docente_id = u1;
  perform public.zz_b21_anotar('alta', 'el respaldo no duplica el gratis', n = 1, n::text);
  select count(*) into n from public.mi_salon_accesos where origen not in ('gratis_t1', 'pago', 'piloto', 'regalo_admin');
  perform public.zz_b21_anotar('alta', 'no existe ningún origen fuera de gratis_t1, pago, piloto y regalo_admin', n = 0, n::text);
  perform public.zz_b21_anotar('alta', 'el origen "prueba" no se acepta',
    public.zz_b21_intentar(format($q$insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen) values (%L, '2026-2027', '{T1}', 'prueba')$q$, u3)) like '23514|%', null);
  -- Todas las cuentas existentes creadas hasta el 18-dic tienen su gratis
  select count(*) into n from auth.users u
   where (u.created_at at time zone 'America/Mexico_City')::date <= date '2026-12-18'
     and not exists (select 1 from public.mi_salon_accesos a where a.docente_id = u.id and a.origen = 'gratis_t1')
     -- (menos las cuentas de prueba a las que QA les cambió el acceso a propósito)
     and not exists (select 1 from public.mi_salon_accesos a where a.docente_id = u.id and a.notas like 'QA b21%');
  perform public.zz_b21_anotar('alta', 'respaldo: toda cuenta existente tiene gratis_t1', n = 0, n::text);
end $$;

-- Piloto de las cuentas QA
do $$
declare n int;
begin
  select count(*) into n from public.mi_salon_accesos a join auth.users u on u.id = a.docente_id
   where lower(u.email) in ('qa.misalon@jissez.com', 'qa.aislamiento@jissez.com') and a.origen = 'piloto'
     and public.mi_salon_vence(a) = date '2027-07-30';
  perform public.zz_b21_anotar('piloto', 'QA1 y QA2 con piloto hasta el 30-jul-2027', n = 2, n::text);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Interruptor: apagado solo activo_saas o piloto ven Mi Salón; encendido, todas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  u uuid := (select id from auth.users where email = 'zz.b21.oct@jissez.test');
  u3 uuid := (select id from auth.users where email = 'zz.b21.dic19@jissez.test');
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  e jsonb; c jsonb;
begin
  update public.jissez_config set mi_salon_abierto = false, mi_salon_abierto_desde = null where id;
  perform public.zz_b21_como(u, 'zz.b21.oct@jissez.test');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'apagado: cuenta nueva con gratis NO ve Mi Salón', (e ->> 'visible')::boolean = false, e::text);
  perform public.zz_b21_anotar('interruptor', 'apagado: aun así su acceso está vigente (escribe si entra)', (e ->> 'vigente')::boolean = true, e::text);
  perform public.zz_b21_anotar('interruptor', 'apagado: no hay correo de bienvenida pendiente', (e ->> 'bienvenida_pendiente')::boolean = false, e::text);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'apagado: QA1 (activo_saas y piloto) sí ve Mi Salón', (e ->> 'visible')::boolean and (e ->> 'origen') = 'piloto', e::text);

  -- Solo el admin enciende
  perform public.zz_b21_como(u, 'zz.b21.oct@jissez.test');
  perform public.zz_b21_anotar('interruptor', 'una cuenta cualquiera no puede encenderlo',
    public.zz_b21_intentar('select public.admin_mi_salon_interruptor(true)') like '42501|%', null);
  perform public.zz_b21_como(gen_random_uuid(), 'soporte.jissez@gmail.com');
  c := public.admin_mi_salon_interruptor(true);
  perform public.zz_b21_anotar('interruptor', 'el admin lo enciende y queda la fecha', (c ->> 'mi_salon_abierto')::boolean and c ->> 'mi_salon_abierto_desde' is not null, c::text);

  perform public.zz_b21_como(u, 'zz.b21.oct@jissez.test');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'encendido: la cuenta con gratis ve Mi Salón', (e ->> 'visible')::boolean, e::text);
  perform public.zz_b21_anotar('interruptor', 'encendido: cuenta creada ANTES de encender no recibe bienvenida', (e ->> 'bienvenida_pendiente')::boolean = false, e::text);
  perform public.zz_b21_como(u3, 'zz.b21.dic19@jissez.test');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'encendido: cuenta sin acceso (19-dic) ve Mi Salón en solo lectura',
    (e ->> 'visible')::boolean and not (e ->> 'vigente')::boolean and not (e ->> 'tiene_acceso')::boolean, e::text);

  -- Cuenta creada con Mi Salón abierto: bienvenida pendiente hasta que se registra el correo
  reset role;
  update public.jissez_config set mi_salon_abierto_desde = '2026-09-01 00:00-06' where id;
  perform public.zz_b21_como(u, 'zz.b21.oct@jissez.test');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'encendido: cuenta creada después de encender → bienvenida pendiente', (e ->> 'bienvenida_pendiente')::boolean, e::text);
  insert into public.mi_salon_correos (docente_id, tipo) values (u, 'bienvenida');
  e := public.mi_salon_estado();
  perform public.zz_b21_anotar('interruptor', 'con el correo registrado ya no está pendiente (idempotente)', (e ->> 'bienvenida_pendiente')::boolean = false, e::text);
  perform public.zz_b21_anotar('interruptor', 'el mismo correo no se registra dos veces',
    public.zz_b21_intentar(format($q$insert into public.mi_salon_correos (docente_id, tipo) values (%L, 'bienvenida')$q$, u)) like '23505|%', null);

  -- Otra cuenta no ve el estado ajeno
  perform public.zz_b21_como(u3, 'zz.b21.dic19@jissez.test');
  perform public.zz_b21_anotar('interruptor', 'una cuenta no lee el estado de otra', public.mi_salon_estado_de(u) is null, null);

  update public.jissez_config set mi_salon_abierto = false, mi_salon_abierto_desde = null where id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Candado: como QA1 VENCIDA, INSERT/UPDATE/DELETE fallan en CADA tabla con el aviso de
--    solo lectura; como QA1 VIGENTE, el candado no bloquea (otros errores, como un NOT NULL de
--    una fila de prueba incompleta, no son del candado)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  t text; r jsonb; k text; v text; sin_fila int := 0; hay boolean; vacias text[] := '{}';
begin
  -- Tablas sin filas visibles para QA1: se aíslan (ver zz_b21_escrituras)
  perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date + 60);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  set local role authenticated;
  for t in select public.zz_b21_tablas() loop
    execute format('select exists (select 1 from public.%I)', t) into hay;
    if not hay then vacias := vacias || t; end if;
  end loop;
  reset role;
  foreach t in array vacias loop
    execute format('create policy zz_b21_libre on public.%I for insert to public with check (true)', t);
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  perform public.zz_b21_anotar('vencida', 'tablas sin filas de QA1, aisladas para probar el INSERT', true, array_to_string(vacias, ', '));

  -- Vencida hace 5 días (fuera de las 48 h)
  perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date - 5);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  set local role authenticated;
  for t in select public.zz_b21_tablas() loop
    r := public.zz_b21_escrituras(t, qa1);
    foreach k in array array['ins', 'upd', 'del'] loop
      v := r ->> k;
      if v = 'sin_fila' then
        sin_fila := sin_fila + 1;
      else
        perform public.zz_b21_anotar('vencida', t || ' ' || k || ' falla con solo lectura', v like '42501|mi_salon_solo_lectura|%', v);
      end if;
    end loop;
  end loop;
  perform public.zz_b21_anotar('vencida', 'tablas sin fila propia de QA1 (solo se probó INSERT)', sin_fila / 2 = cardinality(vacias), (sin_fila / 2)::text);
  reset role;

  -- Vigente (hasta dentro de 60 días)
  perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date + 60);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  set local role authenticated;
  for t in select public.zz_b21_tablas() loop
    r := public.zz_b21_escrituras(t, qa1);
    foreach k in array array['ins', 'upd', 'del'] loop
      v := r ->> k;
      if v <> 'sin_fila' then
        perform public.zz_b21_anotar('vigente', t || ' ' || k || ' no la bloquea el candado', v not like '%mi_salon_solo_lectura%', v);
      end if;
    end loop;
  end loop;
  reset role;
end $$;

-- Las escrituras "de verdad" de la app (filas completas) pasan con acceso y fallan sin él
do $$
declare
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  al record; v text; sql_asis text;
begin
  select a.id, a.grupo_id into al from public.alumnos a where a.maestro_id = qa1 and a.estatus is distinct from 'baja' limit 1;
  sql_asis := format($q$insert into public.asistencias (maestro_id, grupo_id, alumno_id, fecha, asistencia_estado)
    values (%L, %L, %L, date '2026-08-15', 'presente')$q$,
    qa1, al.grupo_id, al.id);
  perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date + 60);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  set local role authenticated;
  v := public.zz_b21_intentar(sql_asis);
  perform public.zz_b21_anotar('app', 'vigente: guarda una asistencia completa', v = 'ok', v);
  reset role;
  perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date - 5);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  set local role authenticated;
  v := public.zz_b21_intentar(sql_asis);
  perform public.zz_b21_anotar('app', 'vencida: la misma asistencia se rechaza con solo lectura', v like '42501|mi_salon_solo_lectura|%', v);
  -- Leer sigue funcionando
  v := public.zz_b21_intentar('select count(*) from public.alumnos');
  perform public.zz_b21_anotar('app', 'vencida: puede leer', v = 'ok', v);
  -- Su perfil (la cuenta) sí se puede editar
  v := public.zz_b21_intentar(format($q$update public.perfiles set escuela = escuela where id = %L$q$, qa1));
  perform public.zz_b21_anotar('app', 'vencida: puede editar su perfil', v = 'ok', v);
  -- Los RPC que escriben (security invoker) también quedan bloqueados por las políticas
  v := public.zz_b21_intentar(format($q$select public.guardar_incidencia(null, %L::uuid, 'QA b21', current_date, null, 'QA b21 prueba', null, array[%L::uuid])$q$, al.grupo_id, al.id));
  perform public.zz_b21_anotar('app', 'vencida: el RPC guardar_incidencia falla con solo lectura', v like '42501|mi_salon_solo_lectura|%', v);
  v := public.zz_b21_intentar(format($q$select public.agregar_actividad_suelta(%L::uuid, current_date, '{"nombre":"QA b21","campo":"LEN","tipo":"trabajo"}'::jsonb)$q$, al.grupo_id));
  perform public.zz_b21_anotar('app', 'vencida: el RPC agregar_actividad_suelta falla con solo lectura', v like '42501|mi_salon_solo_lectura|%', v);
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Tolerancia de 48 horas para capturas sin señal (cabecera x-capturado-en)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  fin timestamptz;
  function_ok boolean;
begin
  -- Venció ayer: fin = hoy 00:00 (hora del centro); ahora estamos dentro de las 48 h
  perform public.zz_b21_dejar_acceso(qa1, hoy - 1);
  fin := (hoy::timestamp at time zone 'America/Mexico_City');
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
  perform public.zz_b21_anotar('tolerancia', 'sin cabecera: no puede escribir', not public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', fin - interval '3 hours')::text);
  perform public.zz_b21_anotar('tolerancia', 'captura 3 h antes del vencimiento, enviada dentro de 48 h: se acepta', public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_anotar('tolerancia', 'y la escritura real pasa el candado', public.zz_b21_intentar('select public.mi_salon_exigir_escritura()') = 'ok', null);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', fin + interval '1 minute')::text);
  perform public.zz_b21_anotar('tolerancia', 'captura DESPUÉS del vencimiento: se rechaza', not public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', now() + interval '2 hours')::text);
  perform public.zz_b21_anotar('tolerancia', 'hora del aparato en el futuro: se rechaza', not public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', '{"x-capturado-en":"no-es-fecha"}');
  perform public.zz_b21_anotar('tolerancia', 'cabecera que no es fecha: se rechaza', not public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', now() - interval '31 days')::text);
  perform public.zz_b21_anotar('tolerancia', 'hora de hace más de 30 días: se rechaza', not public.mi_salon_puede_escribir(), null);
  -- Antes del inicio del acceso no cuenta
  perform public.zz_b21_dejar_acceso(qa1, hoy - 1, now() - interval '2 days');
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', now() - interval '3 days')::text);
  perform public.zz_b21_anotar('tolerancia', 'captura de antes de que empezara el acceso: se rechaza', not public.mi_salon_puede_escribir(), null);

  -- Venció hace 3 días: fuera de las 48 h, aunque la captura sea de antes
  perform public.zz_b21_dejar_acceso(qa1, hoy - 3);
  fin := ((hoy - 2)::timestamp at time zone 'America/Mexico_City');
  perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com', json_build_object('x-capturado-en', fin - interval '1 hour')::text);
  perform public.zz_b21_anotar('tolerancia', 'captura de antes del vencimiento enviada a los 3 días: se rechaza', not public.mi_salon_puede_escribir(), null);
  perform public.zz_b21_anotar('tolerancia', 'y el candado lanza el aviso de solo lectura',
    public.zz_b21_intentar('select public.mi_salon_exigir_escritura()') like '42501|mi_salon_solo_lectura|%', null);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. RPC security definer y borrar la cuenta
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  qa1 uuid := (select id from auth.users where lower(email) = 'qa.misalon@jissez.com');
  u3 uuid := (select id from auth.users where email = 'zz.b21.dic19@jissez.test');
  crit uuid; antes int; despues int; v text;
begin
  select id, uso_count into crit, antes from public.banco_criterios_pda limit 1;
  if crit is not null then
    perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date - 5);
    perform public.zz_b21_como(qa1, 'qa.misalon@jissez.com');
    set local role authenticated;
    perform public.incrementar_uso_criterio(crit);
    reset role;
    select uso_count into despues from public.banco_criterios_pda where id = crit;
    perform public.zz_b21_anotar('rpc', 'vencida: incrementar_uso_criterio no cuenta', despues = antes, antes || ' → ' || despues);
    perform public.zz_b21_dejar_acceso(qa1, (now() at time zone 'America/Mexico_City')::date + 60);
    set local role authenticated;
    perform public.incrementar_uso_criterio(crit);
    reset role;
    select uso_count into despues from public.banco_criterios_pda where id = crit;
    perform public.zz_b21_anotar('rpc', 'vigente: incrementar_uso_criterio sí cuenta', despues = antes + 1, antes || ' → ' || despues);
  end if;

  -- delete_own_account vigente: la versión completa (b19 + b19a + b21)
  v := pg_get_functiondef('public.delete_own_account'::regproc);
  perform public.zz_b21_anotar('rpc', 'delete_own_account: incluye b19a (búsquedas vacías, productos finales), b20 (calificación directa, Ponte al día) y la guarda de pagos de b21',
    position('marketplace_busquedas_vacias' in v) > 0 and position('productos_finales' in v) > 0
      and position('examenes_grupo' in v) > 0 and position('pagos de Mi Salón' in v) > 0 and position('mi_salon_accesos where docente_id' in v) > 0
      and position('calificacion_directa' in v) > 0 and position('ponte_al_dia' in v) > 0, null);
  -- La cuenta del 19-dic (sin ningún acceso) puede borrarse, y se lleva sus datos de Mi Salón
  insert into public.grupos (maestro_id, nombre, grados, ciclo_escolar) values (u3, 'QA b21 grupo', array['1'], '2026-2027');
  insert into public.mi_salon_correos (docente_id, tipo) values (u3, 'bienvenida');
  perform public.zz_b21_como(u3, 'zz.b21.dic19@jissez.test');
  set local role authenticated;
  perform public.delete_own_account();
  reset role;
  perform public.zz_b21_anotar('rpc', 'sin acceso: delete_own_account borra la cuenta, su grupo y sus correos',
    not exists (select 1 from auth.users where id = u3) and not exists (select 1 from public.grupos where maestro_id = u3)
      and not exists (select 1 from public.mi_salon_correos where docente_id = u3), null);
  -- (se recrea la cuenta del 19-dic para los casos de abajo)
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.b21.dic19@jissez.test', '2026-12-19 00:30-06', now());
  perform public.zz_b21_como(u3, 'zz.b21.dic19@jissez.test');
  set local role authenticated;
  v := public.zz_b21_intentar('select public.delete_own_account()');
  reset role;
  perform public.zz_b21_anotar('rpc', 'sin acceso: delete_own_account funciona', v = 'ok', v);
  -- Con un pago de Mi Salón no se borra sola
  insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, pago_id, precio_pagado, tipo_precio, notas)
  values (u3, '2026-2027', '{T2}', 'pago', 'qa-b21-pago', 199, 'fundador', 'QA b21 prueba');
  set local role authenticated;
  v := public.zz_b21_intentar('select public.delete_own_account()');
  reset role;
  perform public.zz_b21_anotar('rpc', 'con un pago de Mi Salón: delete_own_account pide escribir a soporte', v like '23514|%', v);
  -- El mismo pago no crea dos accesos (idempotencia del webhook)
  perform public.zz_b21_anotar('rpc', 'pago_id repetido en el mismo ciclo se rechaza',
    public.zz_b21_intentar(format($q$insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, pago_id) values (%L, '2026-2027', '{T2}', 'pago', 'qa-b21-pago')$q$, u3)) like '23505|%', null);
  -- El cliente no puede darse acceso
  set local role authenticated;
  v := public.zz_b21_intentar(format($q$insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen) values (%L, '2026-2027', '{T1,T2,T3}', 'regalo_admin')$q$, u3));
  reset role;
  perform public.zz_b21_anotar('rpc', 'una cuenta no puede darse acceso a sí misma', v like '42501|%', v);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Panel: solo el admin; lista con estados
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  qa2 uuid := (select id from auth.users where lower(email) = 'qa.aislamiento@jissez.com');
  d jsonb; x jsonb; v text;
begin
  perform public.zz_b21_como(qa2, 'qa.aislamiento@jissez.com');
  set local role authenticated;
  v := public.zz_b21_intentar('select public.admin_mi_salon_docentes()');
  reset role;
  perform public.zz_b21_anotar('panel', 'una cuenta cualquiera no ve la lista', v like '42501|%', v);
  perform public.zz_b21_como(gen_random_uuid(), 'soporte.jissez@gmail.com');
  d := public.admin_mi_salon_docentes();
  select e into x from jsonb_array_elements(d -> 'docentes') e where e ->> 'id' = qa2::text;
  perform public.zz_b21_anotar('panel', 'la lista trae a QA2 vigente con piloto', x ->> 'estado' = 'vigente' and x ->> 'origen' = 'piloto', x::text);
  x := public.admin_mi_salon_dar_acceso('qa.aislamiento@jissez.com', '2026-2027', null, ((now() at time zone 'America/Mexico_City')::date + 10), 'QA b21 prueba');
  perform public.zz_b21_anotar('panel', 'dar acceso de regalo por fecha', x ->> 'origen' = 'regalo_admin', x::text);
  perform public.zz_b21_anotar('panel', 'dar acceso a un periodo no cargado se rechaza',
    public.zz_b21_intentar($q$select public.admin_mi_salon_dar_acceso('qa.aislamiento@jissez.com', '2027-2028', array['T1'])$q$) like '22023|%', null);
  perform public.zz_b21_anotar('panel', 'quitar un gratis_t1 desde el panel se rechaza',
    public.zz_b21_intentar(format('select public.admin_mi_salon_quitar_acceso(%L)', (select id from public.mi_salon_accesos where docente_id = qa2 and origen = 'gratis_t1'))) like '22023|%', null);
end $$;

-- Cobertura: toda tabla pública con maestro_id y con alguna política de escritura para el
-- docente tiene el candado (salvo las excluidas a propósito)
do $$
declare faltan text;
begin
  select string_agg(c.relname, ', ') into faltan
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('a', 'w', 'd', '*') and p.polpermissive
                 and pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) ~ 'auth\.uid\(\)')
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'acceso_mi_salon_ins')
     and c.relname not in ('perfiles', 'interes_secciones', 'marketplace_ordenes', 'marketplace_orden_items', 'ponte_al_dia', 'zz_b21_resultados');
  perform public.zz_b21_anotar('cobertura', 'ninguna tabla del docente sin candado', faltan is null, coalesce(faltan, '(ninguna)'));
end $$;

insert into public.zz_b21_resultados (grupo, caso, ok, detalle)
select 'RESUMEN', count(*) filter (where not ok) || ' fallas de ' || count(*), count(*) filter (where not ok) = 0, null
  from public.zz_b21_resultados;

select grupo, caso, ok, left(detalle, 160) as detalle from public.zz_b21_resultados order by (grupo = 'RESUMEN'), n;
