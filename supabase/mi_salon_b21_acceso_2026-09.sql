-- =============================================================================
-- Mi Salón b21: periodos, accesos, interruptor de lanzamiento y modo solo lectura
-- (spec de Jorge "jissez-spec-mi-salon-cobros", 2026-09-26: secciones 2.1, 5.1-5.5, 7.1 y 8)
-- =============================================================================
--
-- ADITIVA: solo crea tablas, funciones, un trigger en auth.users y políticas RESTRICTIVE
-- nuevas. No borra columnas ni datos. Idempotente (se puede volver a correr).
--
-- Qué hace:
--   1. jissez_config (una fila): el interruptor de lanzamiento de Mi Salón
--      (mi_salon_abierto, apagado por defecto) y qué periodo es gratis (2026-2027 T1).
--      La leen todos (también sin sesión, para la tienda); la cambia solo el admin
--      con admin_mi_salon_interruptor().
--   2. mi_salon_periodos: el calendario de periodos (se vende desde, compra tardía,
--      registro, fin de entrega de boletas y vencimiento). Cargado con 2026-2027. La
--      leen todos; la escribe solo el admin (es_admin()).
--   3. mi_salon_accesos: un registro por acceso (gratis_t1, pago, piloto, regalo_admin).
--      El vencimiento NO se guarda: es el `vence` más tardío de sus periodos, leído de
--      mi_salon_periodos (o `vence_fijo`, solo para un regalo con fecha). Si se corrige
--      una fecha del calendario, todos los accesos se ajustan solos.
--      Decisión de Jorge (2026-09-26): NO hay prueba de 14 días. Una cuenta creada
--      después del vencimiento del periodo gratis (18-dic-2026) no recibe acceso: entra
--      en solo lectura hasta que compre.
--   4. Alta automática: trigger AFTER INSERT en auth.users que da el acceso gratis_t1 a
--      toda cuenta creada hasta el vencimiento del periodo gratis, y un respaldo que se lo
--      da a las cuentas que ya existen.
--   5. mi_salon_acceso_vigente(uid, momento), mi_salon_puede_escribir(capturado_en) y el
--      estado para la app (mi_salon_estado(), y la columna calculada perfiles.mi_salon
--      que el candado lee junto con activo_saas en UNA consulta).
--   6. Modo solo lectura EN EL SERVIDOR: políticas RESTRICTIVE de INSERT, UPDATE y DELETE
--      en cada tabla del SaaS que escribe el docente (lista en la sección 6). Sin acceso
--      vigente la escritura falla con el error 42501 y la pista 'mi_salon_solo_lectura'.
--      Capturas sin señal: la cola manda la cabecera x-capturado-en (hora del aparato);
--      se acepta si esa hora cae dentro de un acceso y hoy no han pasado más de 48 horas
--      desde que ese acceso venció. La hora del aparato se acota: no más de 10 minutos en
--      el futuro ni más de 30 días en el pasado.
--   7. RPC security definer: incrementar_uso_criterio revisa el acceso; delete_own_account
--      (versión completa: b19 + b19a + b20 + accesos) sigue funcionando sin acceso.
--   8. Panel de administración: lista de docentes, métricas, dar/quitar acceso, interruptor.
--   9. Correo de bienvenida: mi_salon_correos (una fila por docente y tipo) para que sea
--      idempotente; lo manda la Edge Function bienvenida-mi-salon, solo con Mi Salón abierto.
--
-- Orden de despliegue: esta migración ANTES del frontend (el candado lee perfiles.mi_salon;
-- si la columna no existiera, cae a solo activo_saas, pero la migración va primero).
-- =============================================================================


-- ── 1. Configuración e interruptor de lanzamiento ─────────────────────────────
create table if not exists public.jissez_config (
  id boolean primary key default true,
  mi_salon_abierto boolean not null default false,
  -- La primera vez que se encendió: el correo de bienvenida es solo para cuentas creadas
  -- desde entonces (las que ya existían no lo reciben de golpe)
  mi_salon_abierto_desde timestamptz,
  gratis_ciclo text not null default '2026-2027',
  gratis_periodo text not null default 'T1',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  constraint jissez_config_una_fila check (id)
);
insert into public.jissez_config (id) values (true) on conflict (id) do nothing;

alter table public.jissez_config enable row level security;
drop policy if exists jissez_config_leer on public.jissez_config;
create policy jissez_config_leer on public.jissez_config
  for select to anon, authenticated using (true);
-- Sin políticas de escritura: se cambia con admin_mi_salon_interruptor() (security definer)
revoke insert, update, delete on public.jissez_config from anon, authenticated;
grant select on public.jissez_config to anon, authenticated;

comment on table public.jissez_config is
  'Configuración global de Jissez (una fila). mi_salon_abierto: interruptor de lanzamiento de Mi Salón (spec 2026-09-26). Lectura pública; escritura solo admin por RPC.';


-- ── 2. Periodos ──────────────────────────────────────────────────────────────
create table if not exists public.mi_salon_periodos (
  ciclo text not null check (ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
  periodo text not null check (periodo in ('T1', 'T2', 'T3')),
  orden smallint not null check (orden between 1 and 3),
  venta_desde date not null,
  compra_tardia_desde date not null,
  registro_calificaciones date not null,
  boletas_fin date not null,
  vence date not null,
  actualizado_en timestamptz not null default now(),
  primary key (ciclo, periodo),
  unique (ciclo, orden),
  constraint mi_salon_periodos_orden_fechas check (
    venta_desde <= compra_tardia_desde
    and compra_tardia_desde <= registro_calificaciones
    and registro_calificaciones <= boletas_fin
    and boletas_fin <= vence
  )
);

alter table public.mi_salon_periodos enable row level security;
drop policy if exists mi_salon_periodos_leer on public.mi_salon_periodos;
create policy mi_salon_periodos_leer on public.mi_salon_periodos
  for select to anon, authenticated using (true);
drop policy if exists mi_salon_periodos_admin on public.mi_salon_periodos;
create policy mi_salon_periodos_admin on public.mi_salon_periodos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant select on public.mi_salon_periodos to anon, authenticated;
grant insert, update, delete on public.mi_salon_periodos to authenticated;

create or replace function public.mi_salon_periodos_sello()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists mi_salon_periodos_sello on public.mi_salon_periodos;
create trigger mi_salon_periodos_sello before update on public.mi_salon_periodos
  for each row execute function public.mi_salon_periodos_sello();

-- Calendario 2026-2027 (SEP; spec §2). Si ya estaba, no se pisa lo que el admin corrigió.
insert into public.mi_salon_periodos
  (ciclo, periodo, orden, venta_desde, compra_tardia_desde, registro_calificaciones, boletas_fin, vence)
values
  ('2026-2027', 'T1', 1, '2026-08-31', '2026-10-23', '2026-11-13', '2026-11-26', '2026-12-18'),
  ('2026-2027', 'T2', 2, '2026-11-14', '2027-02-12', '2027-03-05', '2027-03-19', '2027-04-09'),
  ('2026-2027', 'T3', 3, '2027-03-06', '2027-06-11', '2027-07-02', '2027-07-09', '2027-07-30')
on conflict (ciclo, periodo) do nothing;


-- ── 3. Accesos ───────────────────────────────────────────────────────────────
create table if not exists public.mi_salon_accesos (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references auth.users(id) on delete cascade,
  ciclo text not null check (ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
  -- Periodos cubiertos DE ESE CICLO. Una compra tardía del T3 que cubre también el T1 del
  -- ciclo siguiente son DOS filas (una por ciclo, con el mismo pago_id): mientras el ciclo
  -- nuevo no esté cargado en mi_salon_periodos, su fila no suma y el acceso vence
  -- provisionalmente con el T3; al cargarlo, se extiende solo (spec §5.2).
  periodos text[] not null default '{}',
  origen text not null check (origen in ('gratis_t1', 'pago', 'piloto', 'regalo_admin')),
  -- Para el constructor de cobros (Mercado Pago): referencia del pago, monto final, tipo de
  -- precio y producto. El webhook es idempotente con el índice único (pago_id, ciclo).
  pago_id text,
  precio_pagado numeric(10, 2),
  tipo_precio text check (tipo_precio in ('fundador', 'lista', 'cupon')),
  producto text,
  -- Solo para un regalo del admin con fecha propia (por ejemplo, resolver un OXXO tardío)
  vence_fijo date,
  -- Desde cuándo cubre (la hora de captura de una captura sin señal debe caer después)
  desde timestamptz not null default now(),
  notas text,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  constraint mi_salon_accesos_periodos_validos check (periodos <@ array['T1', 'T2', 'T3']::text[]),
  constraint mi_salon_accesos_cubre_algo check (cardinality(periodos) > 0 or vence_fijo is not null)
);
create index if not exists mi_salon_accesos_docente on public.mi_salon_accesos (docente_id);
create unique index if not exists mi_salon_accesos_pago_unico on public.mi_salon_accesos (pago_id, ciclo)
  where pago_id is not null;
-- Un solo gratis_t1 y un solo piloto por docente y ciclo (el alta y el respaldo no duplican)
create unique index if not exists mi_salon_accesos_gratis_unico on public.mi_salon_accesos (docente_id, ciclo)
  where origen = 'gratis_t1';
create unique index if not exists mi_salon_accesos_piloto_unico on public.mi_salon_accesos (docente_id, ciclo)
  where origen = 'piloto';

alter table public.mi_salon_accesos enable row level security;
drop policy if exists mi_salon_accesos_leer on public.mi_salon_accesos;
create policy mi_salon_accesos_leer on public.mi_salon_accesos
  for select to authenticated using (docente_id = auth.uid() or public.es_admin());
-- Sin escritura desde el cliente: la hacen el trigger de alta, los RPC del admin y el
-- webhook de pagos (service role)
revoke insert, update, delete on public.mi_salon_accesos from anon, authenticated;
grant select on public.mi_salon_accesos to authenticated;

comment on table public.mi_salon_accesos is
  'Accesos a Mi Salón (spec 2026-09-26 §5.1). El vencimiento se calcula: mi_salon_vence(acceso) = el vence más tardío de sus periodos en mi_salon_periodos (o vence_fijo). Nunca se borran datos por falta de acceso: sin acceso vigente la cuenta queda en solo lectura.';

-- Vencimiento (fecha) y fin (instante: el día siguiente a las 00:00, hora del centro)
create or replace function public.mi_salon_vence(a public.mi_salon_accesos)
returns date language sql stable set search_path = public as $$
  select greatest(
    (select max(p.vence) from public.mi_salon_periodos p
      where p.ciclo = a.ciclo and p.periodo = any (a.periodos)),
    a.vence_fijo
  );
$$;

create or replace function public.mi_salon_fin(a public.mi_salon_accesos)
returns timestamptz language sql stable set search_path = public as $$
  select ((public.mi_salon_vence(a) + 1)::timestamp at time zone 'America/Mexico_City');
$$;

/*
  ¿La cuenta tenía acceso vigente en ese momento? SECURITY INVOKER a propósito: con la
  sesión de un docente solo ve sus propios accesos (RLS), así que no sirve para averiguar
  el acceso de otra cuenta. Los RPC security definer y el service role ven todo.
*/
create or replace function public.mi_salon_acceso_vigente(p_uid uuid, p_momento timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.mi_salon_accesos a
    where a.docente_id = p_uid
      and a.desde <= p_momento
      and public.mi_salon_fin(a) > p_momento
  );
$$;


-- ── 4. Alta automática: gratis del periodo gratis (2026-2027 T1) ───────────────
/*
  Da el acceso gratis a una cuenta si se creó hasta el vencimiento del periodo gratis
  (jissez_config.gratis_ciclo / gratis_periodo, leído de mi_salon_periodos). Después de esa
  fecha no da nada (decisión de Jorge, 2026-09-26: sin prueba de 14 días). Devuelve true si
  lo dio. No duplica (índice único parcial).
*/
create or replace function public.mi_salon_dar_gratis(p_uid uuid, p_creada timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ciclo text;
  v_periodo text;
  v_vence date;
  v_n integer;
begin
  select c.gratis_ciclo, c.gratis_periodo into v_ciclo, v_periodo from public.jissez_config c where c.id;
  if v_ciclo is null then return false; end if;
  select p.vence into v_vence from public.mi_salon_periodos p where p.ciclo = v_ciclo and p.periodo = v_periodo;
  if v_vence is null then return false; end if;
  if (coalesce(p_creada, now()) at time zone 'America/Mexico_City')::date > v_vence then return false; end if;
  insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, desde, notas)
  values (p_uid, v_ciclo, array[v_periodo], 'gratis_t1', coalesce(p_creada, now()),
          'Automático: cuenta creada durante el periodo gratis')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.mi_salon_dar_gratis(uuid, timestamptz) from public, anon, authenticated;

-- Nunca bloquea el registro: si algo falla, la cuenta se crea igual (y el respaldo de abajo
-- o el admin le dan el acceso)
create or replace function public.mi_salon_alta_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.mi_salon_dar_gratis(new.id, new.created_at);
  exception when others then
    raise warning 'mi_salon_alta_cuenta: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.mi_salon_alta_cuenta() from public, anon, authenticated;

drop trigger if exists mi_salon_alta_cuenta on auth.users;
create trigger mi_salon_alta_cuenta after insert on auth.users
  for each row execute function public.mi_salon_alta_cuenta();

-- Respaldo: las cuentas que ya existen (creadas hasta el vencimiento del periodo gratis)
select public.mi_salon_dar_gratis(u.id, u.created_at) from auth.users u;


-- ── 5. ¿Puede escribir? y el estado para la app ─────────────────────────────────
-- La hora de captura del aparato, de la cabecera x-capturado-en (la pone la cola sin señal,
-- js/bandeja-salida.js). null si no viene o no es una fecha.
create or replace function public.mi_salon_capturado_en()
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-capturado-en';
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

/*
  ¿La cuenta con sesión puede escribir en Mi Salón?
    - Con acceso vigente ahora: sí.
    - Sin él: solo una captura hecha sin señal ANTES de que venciera su acceso y enviada
      dentro de las 48 horas siguientes al vencimiento (spec §5.5). La hora de captura es la
      del aparato (p_capturado_en o la cabecera x-capturado-en) y se acota para que un cliente
      no pueda escribir indefinidamente mintiendo: no más de 10 minutos adelante del reloj
      del servidor, no más de 30 días atrás, y el vencimiento debe haber sido hace menos de 48 h
      (así, lo más que gana quien mienta son esas 48 horas).
    - Sin sesión (anon, o el service role): true; ahí deciden las políticas de siempre (anon
      no escribe nada del SaaS y el service role no pasa por RLS).
*/
create or replace function public.mi_salon_puede_escribir(p_capturado_en timestamptz default null)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cap timestamptz;
begin
  if v_uid is null then return true; end if;
  if public.mi_salon_acceso_vigente(v_uid, now()) then return true; end if;
  v_cap := coalesce(p_capturado_en, public.mi_salon_capturado_en());
  if v_cap is null then return false; end if;
  if v_cap > now() + interval '10 minutes' or v_cap < now() - interval '30 days' then return false; end if;
  return exists (
    select 1 from public.mi_salon_accesos a
    where a.docente_id = v_uid
      and a.desde <= v_cap
      and public.mi_salon_fin(a) > v_cap
      and now() < public.mi_salon_fin(a) + interval '48 hours'
  );
end $$;
grant execute on function public.mi_salon_puede_escribir(timestamptz) to authenticated;

-- Para las políticas: true si puede; si no, LANZA el error de solo lectura (42501 → HTTP 403)
-- con la pista 'mi_salon_solo_lectura', que la app reconoce (js/mi-salon-acceso.js y la cola)
create or replace function public.mi_salon_exigir_escritura()
returns boolean language plpgsql stable set search_path = public as $$
begin
  if public.mi_salon_puede_escribir() then return true; end if;
  raise exception using
    errcode = '42501',
    message = 'Mi Salón está en modo solo lectura: tu acceso terminó. Tus datos están guardados.',
    hint = 'mi_salon_solo_lectura';
end $$;

/*
  Estado del acceso de una cuenta, para la app y el panel:
    { abierto, visible, vigente, tiene_acceso, origen, ciclo, periodos, vence,
      solo_lectura_desde, dias_restantes, piloto, bienvenida_pendiente }
  visible = ve Mi Salón: activo_saas (el candado de siempre, para el piloto), un acceso
  piloto, o Mi Salón abierto (entonces toda cuenta lo ve; sin acceso vigente, en solo lectura).
  Solo la propia cuenta, el admin o el service role.
*/
create or replace function public.mi_salon_estado_de(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
  v_activo boolean;
  v_creada timestamptz;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_vig record;
  v_ult record;
  v_vence date;
  v_piloto boolean;
  v_tiene boolean;
begin
  if p_uid is null then return null; end if;
  if p_uid is distinct from auth.uid() and not public.es_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    return null;
  end if;
  select * into c from public.jissez_config where id;
  select p.activo_saas into v_activo from public.perfiles p where p.id = p_uid;
  select u.created_at into v_creada from auth.users u where u.id = p_uid;

  select a.origen, a.ciclo, a.periodos, public.mi_salon_vence(a) as vence into v_vig
    from public.mi_salon_accesos a
   where a.docente_id = p_uid and a.desde <= now() and public.mi_salon_fin(a) > now()
   order by public.mi_salon_fin(a) desc limit 1;
  select a.origen, a.ciclo, a.periodos, public.mi_salon_vence(a) as vence into v_ult
    from public.mi_salon_accesos a
   where a.docente_id = p_uid and public.mi_salon_vence(a) is not null
   order by public.mi_salon_fin(a) desc limit 1;
  v_vence := v_ult.vence;
  v_tiene := exists (select 1 from public.mi_salon_accesos a where a.docente_id = p_uid);
  v_piloto := exists (select 1 from public.mi_salon_accesos a where a.docente_id = p_uid and a.origen = 'piloto');

  return jsonb_build_object(
    'abierto', coalesce(c.mi_salon_abierto, false),
    'visible', coalesce(v_activo, false) or v_piloto or coalesce(c.mi_salon_abierto, false),
    'vigente', v_vig.origen is not null,
    'tiene_acceso', v_tiene,
    'origen', coalesce(v_vig.origen, v_ult.origen),
    'ciclo', coalesce(v_vig.ciclo, v_ult.ciclo),
    'periodos', to_jsonb(coalesce(v_vig.periodos, v_ult.periodos)),
    'vence', v_vence,
    'solo_lectura_desde', v_vence + 1,
    'dias_restantes', case when v_vence is null then null else v_vence - v_hoy end,
    'piloto', v_piloto,
    'bienvenida_pendiente', coalesce(c.mi_salon_abierto, false)
      and c.mi_salon_abierto_desde is not null
      and v_creada is not null and v_creada >= c.mi_salon_abierto_desde
      and not exists (select 1 from public.mi_salon_correos m where m.docente_id = p_uid and m.tipo = 'bienvenida')
  );
end $$;
revoke all on function public.mi_salon_estado_de(uuid) from public, anon;
grant execute on function public.mi_salon_estado_de(uuid) to authenticated, service_role;


-- ── 9 (antes que el estado la use en tiempo de ejecución). Correos enviados ────
create table if not exists public.mi_salon_correos (
  docente_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  enviado_en timestamptz not null default now(),
  primary key (docente_id, tipo)
);
alter table public.mi_salon_correos enable row level security;
drop policy if exists mi_salon_correos_leer on public.mi_salon_correos;
create policy mi_salon_correos_leer on public.mi_salon_correos
  for select to authenticated using (docente_id = auth.uid() or public.es_admin());
revoke insert, update, delete on public.mi_salon_correos from anon, authenticated;
grant select on public.mi_salon_correos to authenticated;
comment on table public.mi_salon_correos is
  'Correos de Mi Salón ya enviados (uno por docente y tipo: bienvenida, ...). Hace idempotente el envío (Edge Function bienvenida-mi-salon, service role).';

-- Estado de la cuenta con sesión (RPC)
create or replace function public.mi_salon_estado()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.mi_salon_estado_de(auth.uid());
$$;
revoke all on function public.mi_salon_estado() from public, anon;
grant execute on function public.mi_salon_estado() to authenticated;

-- Columna calculada perfiles.mi_salon: el candado (js/saas-guard.js) la lee junto con
-- activo_saas en la MISMA consulta (select=activo_saas,mi_salon)
create or replace function public.mi_salon(p public.perfiles)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.mi_salon_estado_de(p.id);
$$;
revoke all on function public.mi_salon(public.perfiles) from public, anon;
grant execute on function public.mi_salon(public.perfiles) to authenticated;


-- ── 6. Candado de escritura: políticas RESTRICTIVE ─────────────────────────────
/*
  Pone en una tabla las tres políticas restrictivas del acceso:
    INSERT  with check (mi_salon_exigir_escritura())
    UPDATE  using (true) with check (mi_salon_exigir_escritura())   ← con using(true) el
            rechazo es un ERROR, no un "0 filas" silencioso
    DELETE  using (mi_salon_exigir_escritura())                      ← la función lanza el
            error en vez de devolver false, así el borrado tampoco falla en silencio
  Los nombres empiezan con "acceso_" para que Postgres las evalúe ANTES que las demás
  restrictivas (van en orden alfabético): una cuenta sin acceso siempre recibe el aviso de
  solo lectura y no otro error.
  Una tabla NUEVA del SaaS que escriba el docente debe llamarla en su migración:
    select public.mi_salon_candado('public.mi_tabla');
*/
create or replace function public.mi_salon_candado(p_tabla regclass)
returns void language plpgsql set search_path = public as $$
begin
  execute format('drop policy if exists acceso_mi_salon_ins on %s', p_tabla);
  execute format('drop policy if exists acceso_mi_salon_upd on %s', p_tabla);
  execute format('drop policy if exists acceso_mi_salon_del on %s', p_tabla);
  execute format('create policy acceso_mi_salon_ins on %s as restrictive for insert to public '
                 'with check (public.mi_salon_exigir_escritura())', p_tabla);
  execute format('create policy acceso_mi_salon_upd on %s as restrictive for update to public '
                 'using (true) with check (public.mi_salon_exigir_escritura())', p_tabla);
  execute format('create policy acceso_mi_salon_del on %s as restrictive for delete to public '
                 'using (public.mi_salon_exigir_escritura())', p_tabla);
end $$;
revoke all on function public.mi_salon_candado(regclass) from public, anon, authenticated;

/*
  Tablas del SaaS que escribe el docente (revisadas una por una en pg_policies del proyecto
  de pruebas, 2026-09-26). NO llevan candado: perfiles (la cuenta, la entidad y el nombre),
  interes_secciones (avisos de la tienda), marketplace_* (tienda), los catálogos que solo
  escribe el admin o el service role (banco_*, catalogo_*, calendario_sep,
  plantillas_sugerencia, ltg_*, dosificacion_*, ...) y las tablas nuevas de esta migración.
  Con guarda to_regclass: una tabla que aún no exista (calificacion_directa, de "Ponte al
  día") se salta y su migración llama a mi_salon_candado().
*/
do $$
declare
  t text;
begin
  foreach t in array array[
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
  ] loop
    if to_regclass('public.' || t) is not null then
      perform public.mi_salon_candado(('public.' || t)::regclass);
    end if;
  end loop;
end $$;


-- ── 7. RPC security definer ──────────────────────────────────────────────────────
-- Los RPC que escriben con la sesión del docente (guardar_incidencia, agregar_producto_sesion,
-- agregar_actividad_suelta, mover_producto_a_sesion, guardar_asignacion_producto,
-- cerrar_boleta, recalcular_evidencia_pda) son SECURITY INVOKER: sus escrituras pasan por las
-- políticas de arriba y fallan igual sin acceso. Los security definer que escriben datos
-- del docente se revisan aquí:

-- incrementar_uso_criterio (banco compartido de criterios): sin acceso no cuenta el uso
-- (no lanza error: lo llama crear_proyecto sin esperar respuesta)
create or replace function public.incrementar_uso_criterio(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.mi_salon_puede_escribir() then return; end if;
  update public.banco_criterios_pda set uso_count = uso_count + 1 where id = p_id;
end $$;

-- delete_own_account: borrar la cuenta SIEMPRE se permite, con o sin acceso (security
-- definer: no pasa por las políticas de arriba). Versión COMPLETA de b19 + b19a (búsquedas
-- vacías y productos finales) + b20 (calificación directa y Ponte al día, con guarda) + los accesos y
-- correos de Mi Salón. Al fusionar con b20 (Ponte al día) se unen las versiones. Una cuenta con un PAGO de Mi Salón no se borra sola (como las
-- compras de la tienda): es un registro de cobro.
-- @@delete_own_account inicio
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.marketplace_ordenes where user_id = v)
     or exists (select 1 from public.marketplace_accesos where user_id = v)
     or exists (select 1 from public.marketplace_pedidos where user_id = v) then
    raise exception 'Tu cuenta tiene compras registradas en la tienda. Para eliminarla escribe a soporte@jissez.com.'
      using errcode = 'check_violation';
  end if;
  -- Pagos de Mi Salón (b21)
  if to_regclass('public.mi_salon_accesos') is not null then
    if exists (select 1 from public.mi_salon_accesos where docente_id = v and origen = 'pago') then
      raise exception 'Tu cuenta tiene pagos de Mi Salón registrados. Para eliminarla escribe a soporte@jissez.com.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Datos de Mi salón que no se borran en cascada con la cuenta (primero los que dependen de otros)
  delete from public.evaluacion_formativa where maestro_id = v;
  delete from public.calificaciones where maestro_id = v;
  delete from public.registro_diario where maestro_id = v;
  delete from public.boleta_trimestral where maestro_id = v;
  delete from public.evaluacion_diagnostica where maestro_id = v;
  delete from public.tareas where maestro_id = v;
  -- Para quién es cada producto (b17), antes que los productos
  if to_regclass('public.producto_sesion_alumnos') is not null then
    execute 'delete from public.producto_sesion_alumnos where maestro_id = $1' using v;
  end if;
  delete from public.productos_sesion where maestro_id = v;
  delete from public.dias_no_habiles_extra where maestro_id = v;
  delete from public.maestro_ajustes where maestro_id = v;
  delete from public.zz_deprecated_diagnosticos where maestro_id = v;
  -- Incidencias (b13)
  if to_regclass('public.incidencia_alumnos') is not null then
    execute 'delete from public.incidencia_alumnos where maestro_id = $1' using v;
  end if;
  if to_regclass('public.incidencias') is not null then
    execute 'delete from public.incidencias where maestro_id = $1' using v;
  end if;
  -- Calendario del grupo y rol de aseo (b14)
  if to_regclass('public.roles_aseo') is not null then
    execute 'delete from public.roles_aseo where maestro_id = $1' using v;
  end if;
  if to_regclass('public.calendario_ajustes') is not null then
    execute 'delete from public.calendario_ajustes where maestro_id = $1' using v;
  end if;
  -- Listas de cooperación y materiales (b15): valores, columnas y listas (también las cerradas)
  if to_regclass('public.listas_valores') is not null then
    execute 'delete from public.listas_valores where maestro_id = $1' using v;
  end if;
  if to_regclass('public.listas_columnas') is not null then
    execute 'delete from public.listas_columnas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.listas_grupo') is not null then
    execute 'delete from public.listas_grupo where maestro_id = $1' using v;
  end if;
  -- Avisos de secciones por abrir (jissez_interes_secciones)
  if to_regclass('public.interes_secciones') is not null then
    execute 'delete from public.interes_secciones where usuario_id = $1' using v;
  end if;
  -- Exámenes de Mi Salón (b18 y b19): no presentó, respuestas, resultados, preguntas y exámenes
  if to_regclass('public.examen_alumnos') is not null then
    execute 'delete from public.examen_alumnos where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_respuestas') is not null then
    execute 'delete from public.examen_respuestas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_resultados') is not null then
    execute 'delete from public.examen_resultados where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examen_preguntas') is not null then
    execute 'delete from public.examen_preguntas where maestro_id = $1' using v;
  end if;
  if to_regclass('public.examenes_grupo') is not null then
    execute 'delete from public.examenes_grupo where maestro_id = $1' using v;
  end if;
  -- Búsquedas sin resultados de la tienda (b19a: no se borraban; user_id sin llave foránea)
  if to_regclass('public.marketplace_busquedas_vacias') is not null then
    execute 'delete from public.marketplace_busquedas_vacias where user_id = $1' using v;
  end if;
  -- Productos finales (tabla legada, sin pantalla que la escriba; b19a): su llave a grupos no
  -- tiene cascada y hacía fallar el borrado de la cuenta
  if to_regclass('public.productos_finales') is not null then
    execute 'delete from public.productos_finales where maestro_id = $1 or grupo_id in (select id from public.grupos where maestro_id = $1)' using v;
  end if;
  -- Ponte al día (b20, constructor AK; con guarda: la tabla puede no existir todavía)
  if to_regclass('public.calificacion_directa') is not null then
    execute 'delete from public.calificacion_directa where maestro_id = $1' using v;
  end if;
  if to_regclass('public.ponte_al_dia') is not null then
    execute 'delete from public.ponte_al_dia where maestro_id = $1' using v;
  end if;
  -- Accesos y correos de Mi Salón (b21; también se irían en cascada con auth.users)
  if to_regclass('public.mi_salon_correos') is not null then
    execute 'delete from public.mi_salon_correos where docente_id = $1' using v;
  end if;
  if to_regclass('public.mi_salon_accesos') is not null then
    execute 'delete from public.mi_salon_accesos where docente_id = $1' using v;
  end if;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin


-- ── 8. Panel de administración ────────────────────────────────────────────────────
-- Interruptor de lanzamiento. La primera vez que se enciende queda la fecha (correo de
-- bienvenida: solo cuentas creadas desde entonces).
create or replace function public.admin_mi_salon_interruptor(p_abierto boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.jissez_config%rowtype;
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.jissez_config
     set mi_salon_abierto = coalesce(p_abierto, false),
         mi_salon_abierto_desde = case when coalesce(p_abierto, false) and mi_salon_abierto_desde is null
                                       then now() else mi_salon_abierto_desde end,
         actualizado_en = now(),
         actualizado_por = auth.uid()
   where id
  returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.admin_mi_salon_interruptor(boolean) from public, anon;
grant execute on function public.admin_mi_salon_interruptor(boolean) to authenticated;

/*
  ¿Qué cuentas usaron "Ponte al día"? Las que tienen alguna captura con es_historico = true
  (la marca la pone el constructor del registro histórico, b20). Se busca por NOMBRE de
  columna en toda tabla pública que tenga maestro_id y es_historico: así cuenta también
  las tablas que se agreguen después.
*/
create or replace function public.mi_salon_con_historico()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  t text;
begin
  if not public.es_admin() and coalesce(auth.role(), '') <> 'service_role' then return; end if;
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'es_historico'
       and exists (select 1 from information_schema.columns m
                    where m.table_schema = 'public' and m.table_name = c.table_name and m.column_name = 'maestro_id')
       and exists (select 1 from information_schema.tables x
                    where x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE')
  loop
    return query execute format('select distinct maestro_id from public.%I where es_historico is true', t);
  end loop;
end $$;
revoke all on function public.mi_salon_con_historico() from public, anon;
grant execute on function public.mi_salon_con_historico() to authenticated;

/*
  Lista de docentes para el panel: una fila por cuenta con su estado de acceso
  (vigente | por_vencer (vence en 21 días o menos) | solo_lectura), el acceso que manda
  (el vigente que vence más tarde o, sin vigente, el último), todos sus accesos, y las
  marcas para las métricas (grupos, uso de "Ponte al día", boleta del periodo gratis).
*/
create or replace function public.admin_mi_salon_docentes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  c public.jissez_config%rowtype;
  v_orden smallint;
  r jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into c from public.jissez_config where id;
  select p.orden into v_orden from public.mi_salon_periodos p where p.ciclo = c.gratis_ciclo and p.periodo = c.gratis_periodo;

  with hist as (select distinct h as id from public.mi_salon_con_historico() h),
  acc as (
    select a.*, public.mi_salon_vence(a) as vence, public.mi_salon_fin(a) as fin
      from public.mi_salon_accesos a
  ),
  por_docente as (
    select u.id, u.email, u.created_at,
           p.nombre_completo, coalesce(p.activo_saas, false) as activo_saas,
           (select to_jsonb(x) from (
              select a.origen, a.ciclo, a.periodos, a.vence, a.precio_pagado, a.tipo_precio
                from acc a where a.docente_id = u.id and a.desde <= now() and a.fin > now()
               order by a.fin desc limit 1) x) as vigente,
           (select to_jsonb(x) from (
              select a.origen, a.ciclo, a.periodos, a.vence, a.precio_pagado, a.tipo_precio
                from acc a where a.docente_id = u.id and a.vence is not null
               order by a.fin desc limit 1) x) as ultimo,
           (select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'origen', a.origen, 'ciclo', a.ciclo, 'periodos', a.periodos,
               'vence', a.vence, 'vence_fijo', a.vence_fijo, 'precio_pagado', a.precio_pagado,
               'tipo_precio', a.tipo_precio, 'producto', a.producto, 'pago_id', a.pago_id,
               'notas', a.notas, 'creado_en', a.creado_en) order by a.creado_en), '[]'::jsonb)
              from acc a where a.docente_id = u.id) as accesos,
           (select count(*) from public.grupos g where g.maestro_id = u.id) as grupos,
           exists (select 1 from hist h where h.id = u.id) as ponte_al_dia,
           exists (select 1 from public.boleta_trimestral b
                    where b.maestro_id = u.id and b.ciclo = c.gratis_ciclo and b.trimestre = v_orden) as boleta_gratis,
           exists (select 1 from public.boleta_trimestral b
                    where b.maestro_id = u.id and b.ciclo = c.gratis_ciclo and b.trimestre = v_orden and b.cerrada) as boleta_gratis_cerrada
      from auth.users u
      left join public.perfiles p on p.id = u.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'email', d.email, 'nombre', d.nombre_completo, 'creada', d.created_at,
           'activo_saas', d.activo_saas,
           'estado', case
               when d.vigente is null then 'solo_lectura'
               when (d.vigente ->> 'vence')::date - v_hoy <= 21 then 'por_vencer'
               else 'vigente' end,
           'origen', coalesce(d.vigente ->> 'origen', d.ultimo ->> 'origen'),
           'ciclo', coalesce(d.vigente ->> 'ciclo', d.ultimo ->> 'ciclo'),
           'periodos', coalesce(d.vigente -> 'periodos', d.ultimo -> 'periodos'),
           'vence', (select max(a.vence) from acc a where a.docente_id = d.id),
           'precio_pagado', coalesce(d.vigente -> 'precio_pagado', d.ultimo -> 'precio_pagado'),
           'tipo_precio', coalesce(d.vigente ->> 'tipo_precio', d.ultimo ->> 'tipo_precio'),
           'accesos', d.accesos,
           'grupos', d.grupos,
           'ponte_al_dia', d.ponte_al_dia,
           'boleta_gratis', d.boleta_gratis,
           'boleta_gratis_cerrada', d.boleta_gratis_cerrada
         ) order by d.created_at desc), '[]'::jsonb)
    into r
    from por_docente d;
  return jsonb_build_object('hoy', v_hoy, 'config', to_jsonb(c), 'docentes', r);
end $$;
revoke all on function public.admin_mi_salon_docentes() from public, anon;
grant execute on function public.admin_mi_salon_docentes() to authenticated;

/*
  Dar o extender acceso a mano (regalo_admin): por periodos de un ciclo cargado, o hasta una
  fecha (vence_fijo), o ambos. Se SUMA a lo que la cuenta ya tenga (nunca quita nada).
  También sirve para sumar docentes al piloto (p_origen = 'piloto', periodos del ciclo).
*/
create or replace function public.admin_mi_salon_dar_acceso(
  p_email text, p_ciclo text, p_periodos text[], p_vence_fijo date default null,
  p_notas text default null, p_origen text default 'regalo_admin'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_fila public.mi_salon_accesos%rowtype;
  v_periodos text[] := coalesce(p_periodos, '{}');
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_origen not in ('regalo_admin', 'piloto') then
    raise exception 'Desde el panel solo se da acceso de regalo o de piloto' using errcode = '22023';
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_uid is null then raise exception 'No hay una cuenta con ese correo' using errcode = 'P0002'; end if;
  if cardinality(v_periodos) = 0 and p_vence_fijo is null then
    raise exception 'Elige al menos un periodo o una fecha de vencimiento' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_periodos) x
              where not exists (select 1 from public.mi_salon_periodos p where p.ciclo = p_ciclo and p.periodo = x)) then
    raise exception 'Ese periodo no está cargado en el calendario del ciclo %', p_ciclo using errcode = '22023';
  end if;
  if p_vence_fijo is not null and p_vence_fijo < (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha de vencimiento ya pasó' using errcode = '22023';
  end if;
  if p_origen = 'piloto' then
    -- Un solo piloto por ciclo: se amplía el que haya
    update public.mi_salon_accesos
       set periodos = (select array_agg(distinct x order by x) from unnest(periodos || v_periodos) x),
           vence_fijo = greatest(vence_fijo, p_vence_fijo),
           notas = coalesce(p_notas, notas)
     where docente_id = v_uid and ciclo = p_ciclo and origen = 'piloto'
    returning * into v_fila;
    if found then return to_jsonb(v_fila); end if;
  end if;
  insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, vence_fijo, notas, creado_por, desde)
  values (v_uid, p_ciclo, v_periodos, p_origen, p_vence_fijo, nullif(trim(coalesce(p_notas, '')), ''), auth.uid(), now())
  returning * into v_fila;
  return to_jsonb(v_fila);
end $$;
revoke all on function public.admin_mi_salon_dar_acceso(text, text, text[], date, text, text) from public, anon;
grant execute on function public.admin_mi_salon_dar_acceso(text, text, text[], date, text, text) to authenticated;

-- Quitar un acceso dado a mano (regalo o piloto) por error. Los gratis_t1 y los pagos no se
-- quitan desde el panel.
create or replace function public.admin_mi_salon_quitar_acceso(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_origen text;
begin
  if not public.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select origen into v_origen from public.mi_salon_accesos where id = p_id;
  if v_origen is null then raise exception 'Ese acceso no existe' using errcode = 'P0002'; end if;
  if v_origen not in ('regalo_admin', 'piloto') then
    raise exception 'Solo se quitan desde el panel los accesos de regalo o de piloto' using errcode = '22023';
  end if;
  delete from public.mi_salon_accesos where id = p_id;
end $$;
revoke all on function public.admin_mi_salon_quitar_acceso(uuid) from public, anon;
grant execute on function public.admin_mi_salon_quitar_acceso(uuid) to authenticated;

-- PostgREST: que vea las tablas, las funciones y la columna calculada nuevas
notify pgrst, 'reload schema';
