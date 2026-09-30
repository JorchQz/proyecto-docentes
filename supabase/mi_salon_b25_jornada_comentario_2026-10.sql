-- =============================================================================
-- Mi salón B25: comentarios del día y "Finalizar jornada" (Fase 3 del plan de Fanny, 2026-09-29)
--
-- Aditiva e idempotente (if not exists / create or replace / drop ... if exists). Sin begin/commit:
-- el script de aplicación (scripts/aplicar-migraciones-prod.js) la envuelve en su transacción.
--
--   1. registro_diario.captura_nota (uuid, nula, SIN default): la marca de la columna `nota`, que
--      ya existía y nadie usaba. Es el CUARTO grupo de campos que Hoy escribe junto (b12): así el
--      comentario de un alumno no choca con su participación ni su conducta cuando se capturan
--      desde dos aparatos. Las filas existentes quedan con null ("sin marca": Hoy las compara por
--      contenido, igual que b12). El trigger de marcas de b12 se amplía con el grupo de la nota:
--      un cambio de `nota` que no trae marca nueva recibe una del servidor; un insert sin marca,
--      también. Lo demás de la función (participación y conducta) queda igual.
--
--   2. Tabla jornadas: la jornada que el docente finaliza desde Hoy ("Jornada finalizada a las
--      13:20"). Una fila por grupo y día (unique(grupo_id, fecha)); `resumen` es lo que faltaba
--      al finalizar (jsonb). El docente la ve y la escribe solo si el grupo es suyo (RLS) y, sin
--      acceso vigente, es de solo lectura (b21: mi_salon_candado). Un trigger deja `cerrada_en`
--      como la primera vez y pone `actualizada_en` con la hora del servidor (Finalizar de nuevo
--      no deja que el aparato adelante o atrase la hora). Se sigue pudiendo editar el día después
--      de finalizar: la jornada no bloquea nada; más adelante es lo que publica a las familias.
--
--   3. delete_own_account: la versión FINAL (b23 + jornadas, con guarda to_regclass).
--
-- ORDEN: va AL FINAL de las que reemplazan delete_own_account (interes, b16, b17, b18, b18a, b19,
-- b19a, b20, b21, b22, b23, b25). Después de b23 y ANTES del frontend de la Fase 3: el frontend
-- lee registro_diario.captura_nota y escribe en jornadas. Si el frontend llegara antes, Hoy sigue
-- funcionando (compara por contenido, con un 400 en la consola por carga) pero "Finalizar
-- jornada" no puede registrar el día (docs/PRODUCCION-MI-SALON.md, "b25").
-- =============================================================================


-- ── 1. La marca de la nota ─────────────────────────────────────────────────────
alter table public.registro_diario add column if not exists captura_nota uuid;

comment on column public.registro_diario.captura_nota is
  'Marca de la última escritura de nota, el comentario del día (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca. mi_salon_b25.';

-- b12 + el grupo de la nota. Solo toca columnas de marca; sin SECURITY DEFINER, search_path vacío
create or replace function public.marca_captura_registro_diario()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_participacion is null then new.captura_participacion := pg_catalog.gen_random_uuid(); end if;
    if new.captura_conducta is null then new.captura_conducta := pg_catalog.gen_random_uuid(); end if;
    if new.captura_nota is null then new.captura_nota := pg_catalog.gen_random_uuid(); end if;
  else
    if new.participacion is distinct from old.participacion
       and new.captura_participacion is not distinct from old.captura_participacion then
      new.captura_participacion := pg_catalog.gen_random_uuid();
    end if;
    if new.conducta is distinct from old.conducta
       and new.captura_conducta is not distinct from old.captura_conducta then
      new.captura_conducta := pg_catalog.gen_random_uuid();
    end if;
    if new.nota is distinct from old.nota
       and new.captura_nota is not distinct from old.captura_nota then
      new.captura_nota := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

comment on function public.marca_captura_registro_diario() is
  'Mi salón B12 + B25: toda escritura de participacion, conducta o nota deja una marca única por campo (la de Hoy o una del servidor).';

-- El trigger ya existe desde b12; se vuelve a declarar por si esta migración corre sobre una base sin él
create or replace trigger registro_diario_marca_captura
  before insert or update on public.registro_diario
  for each row execute function public.marca_captura_registro_diario();


-- ── 2. Jornadas ────────────────────────────────────────────────────────────────
create table if not exists public.jornadas (
  id             uuid primary key default gen_random_uuid(),
  maestro_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id       uuid not null references public.grupos (id) on delete cascade,
  fecha          date not null,
  cerrada_en     timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  resumen        jsonb not null default '{}'::jsonb,
  constraint jornadas_grupo_fecha_key unique (grupo_id, fecha)
);

comment on table public.jornadas is
  'Jornada finalizada por el docente desde Hoy: una fila por grupo y día. cerrada_en es la primera vez; actualizada_en, la última (Finalizar de nuevo). resumen: lo que faltaba al finalizar. No bloquea editar el día. mi_salon_b25.';

create index if not exists jornadas_maestro_idx on public.jornadas (maestro_id, fecha);

-- Hora del servidor: cerrada_en no cambia al finalizar de nuevo y actualizada_en la pone la base
create or replace function public.jornadas_tiempos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.cerrada_en := pg_catalog.now();
    new.actualizada_en := pg_catalog.now();
  else
    new.cerrada_en := old.cerrada_en;
    new.actualizada_en := pg_catalog.now();
  end if;
  return new;
end $$;

drop trigger if exists jornadas_tiempos on public.jornadas;
create trigger jornadas_tiempos
  before insert or update on public.jornadas
  for each row execute function public.jornadas_tiempos();

alter table public.jornadas enable row level security;

drop policy if exists "jornadas select propias" on public.jornadas;
drop policy if exists "jornadas insert propias" on public.jornadas;
drop policy if exists "jornadas update propias" on public.jornadas;
drop policy if exists "jornadas delete propias" on public.jornadas;

create policy "jornadas select propias" on public.jornadas
  for select to authenticated using ((select auth.uid()) = maestro_id);
-- El grupo tiene que ser suyo: no se registra una jornada en el grupo de otro docente
create policy "jornadas insert propias" on public.jornadas
  for insert to authenticated with check (
    (select auth.uid()) = maestro_id
    and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid())));
create policy "jornadas update propias" on public.jornadas
  for update to authenticated
  using ((select auth.uid()) = maestro_id)
  with check (
    (select auth.uid()) = maestro_id
    and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid())));
create policy "jornadas delete propias" on public.jornadas
  for delete to authenticated using ((select auth.uid()) = maestro_id);

grant select, insert, update, delete on public.jornadas to authenticated;

-- Candado de solo lectura de Mi Salón (b21): sin acceso vigente, la jornada no se escribe
select public.mi_salon_candado('public.jornadas');


-- ── 3. delete_own_account: la versión FINAL (b23 + jornadas) ────────────────────
/*
  ORDEN: va AL FINAL. Varias migraciones reemplazan delete_own_account completa (b10,
  jissez_interes_secciones, b17, b18, b19, b19a, b20, b21, b22, b23 y esta). La que se aplica al
  último es la que queda: esta es la de b23 (todo lo anterior, incluido el contador de folios de
  incidencias) más las jornadas de b25 (también se irían en cascada con los grupos). Cada tabla
  nueva con guarda to_regclass. La prueba pruebas/migraciones-orden.test.js exige todo esto de la
  última del orden.
*/
-- @@delete_own_account inicio (b25: la versión FINAL)
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
  -- Contador de folios de incidencias (b23; también se va en cascada con los grupos)
  if to_regclass('public.incidencias_folios') is not null then
    execute 'delete from public.incidencias_folios where maestro_id = $1' using v;
  end if;
  -- Jornadas finalizadas (b25; también se van en cascada con los grupos)
  if to_regclass('public.jornadas') is not null then
    execute 'delete from public.jornadas where maestro_id = $1' using v;
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

  -- Órdenes de Mi Salón (b22). Una cuenta con órdenes ya se detiene arriba (toda orden de Mi
  -- Salón vive también en marketplace_ordenes); esto queda por si se relaja esa regla. Se van
  -- también en cascada con auth.users.
  if to_regclass('public.mi_salon_ordenes') is not null then
    execute 'delete from public.mi_salon_ordenes where docente_id = $1' using v;
  end if;

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin

-- PostgREST: que vea la columna, la tabla y las funciones nuevas
notify pgrst, 'reload schema';
