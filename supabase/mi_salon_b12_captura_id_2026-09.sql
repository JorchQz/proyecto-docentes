-- Mi salón B12: marca POR CAMPO para la cola sin señal de "Hoy" (docs/PWA-MI-SALON.md §9.9)
--
-- Sustituye la versión de 80a4375 (una sola columna captura_id por fila y un trigger que la dejaba
-- en null). Esa versión solo llegó al proyecto de PRUEBAS; producción no la tiene.
--
-- Funciona igual en una base limpia (producción) y en pruebas (que ya tenía la versión anterior):
-- todo es "if not exists" / "create or replace" / "drop ... if exists". Aplicada en PRUEBAS
-- (raoxdxwgsxbqlzdnndly). En producción solo con la confirmación de Jorge, y ANTES de publicar el
-- frontend (si el frontend llega antes, Hoy funciona con la regla por contenido y deja un 400 en la
-- consola por cada carga, hasta que se aplique).
--
-- 1. Una marca (uuid, nula, SIN default) por grupo de campos que Hoy escribe junto:
--      asistencias      captura_id                 asistencia_estado
--      registro_diario  captura_participacion      participacion
--                       captura_conducta           conducta
--      calificaciones   captura_semaforo           estado_entrega + nivel (el semáforo implica la entrega)
--                       captura_puntaje            puntaje
--                       captura_retroalimentacion  retroalimentacion
--    No se tocan las filas existentes (quedan con null: "sin marca", Hoy las compara por contenido
--    como caso de transición). RLS no cambia. Sin índice: la condición siempre va con la llave única.
--
-- 2. Trigger BEFORE INSERT OR UPDATE en las tres tablas (search_path vacío, sin SECURITY DEFINER):
--    - UPDATE: por cada grupo, si algún valor del grupo cambió (is distinct from) y la marca del
--      grupo NO cambió, se pone gen_random_uuid() en esa marca: una "marca del servidor" que ningún
--      aparato tiene como propia. Así toda escritura (Asistencia, SQL, la versión anterior de la
--      app...) deja una marca única, y un cambio de ida y vuelta (A → B → A) siempre se nota.
--      Hoy escribe su propia marca nueva en cada captura: se respeta.
--    - INSERT: cada marca que llegue nula recibe gen_random_uuid(). Hoy manda las suyas: la de la
--      captura en los grupos que tocó la maestra y, en los que quedan con su valor por defecto (el
--      relleno 1 y 1 del cierre, el puntaje o la retroalimentación vacíos), la "marca inicial"
--      00000000-0000-4000-8000-000000000000 ("nadie lo ha escrito"). Cualquier escritura posterior
--      de ese grupo la cambia (la de Hoy trae su marca; cualquier otra recibe una del servidor).
--    No hace DML (no hay recursión) y solo toca columnas de marca. Los demás triggers de estas
--    tablas no cambian los valores de los grupos: calificaciones_tipo_desde_producto (BEFORE, solo
--    `tipo`), trg_asistencias_updated_at (BEFORE, solo `updated_at`), propagar_calificacion_a_pda y
--    retirar_evidencia_de_pda (AFTER, escriben evaluacion_formativa por recalcular_evidencia_pda).
--    El orden entre triggers BEFORE (alfabético) no importa por eso.
--
-- Revisado con las columnas nuevas: cerrar_boleta y delete_own_account (no leen ni insertan por
-- posición en estas tablas; delete_own_account solo borra); ninguna pantalla hace `select *` sobre
-- ellas (exportar, boleta, reportes, junta y el motor leen columnas con nombre); no hay vistas.
--
-- 3. Limpieza de la versión anterior (solo existe en pruebas; en producción no hace nada): se
--    quitan sus triggers y su función. Las columnas viejas calificaciones.captura_id y
--    registro_diario.captura_id se quitan APARTE, solo en pruebas:
--    supabase/mi_salon_b12b_limpieza_pruebas_2026-09.sql.

-- ── 1. Columnas ──────────────────────────────────────────────────────────────
alter table public.asistencias     add column if not exists captura_id uuid;
alter table public.registro_diario add column if not exists captura_participacion uuid;
alter table public.registro_diario add column if not exists captura_conducta uuid;
alter table public.calificaciones  add column if not exists captura_semaforo uuid;
alter table public.calificaciones  add column if not exists captura_puntaje uuid;
alter table public.calificaciones  add column if not exists captura_retroalimentacion uuid;

comment on column public.asistencias.captura_id is
  'Marca de la última escritura de asistencia_estado: uuid de una captura de Hoy (generado en el aparato) o del servidor (trigger marca_captura_asistencias). Null: sin cambios desde antes de la marca.';
comment on column public.registro_diario.captura_participacion is
  'Marca de la última escritura de participacion (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca.';
comment on column public.registro_diario.captura_conducta is
  'Marca de la última escritura de conducta (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca.';
comment on column public.calificaciones.captura_semaforo is
  'Marca de la última escritura de estado_entrega/nivel (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca.';
comment on column public.calificaciones.captura_puntaje is
  'Marca de la última escritura de puntaje (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca.';
comment on column public.calificaciones.captura_retroalimentacion is
  'Marca de la última escritura de retroalimentacion (captura de Hoy o del servidor). Null: sin cambios desde antes de la marca.';

-- ── 2. Triggers ──────────────────────────────────────────────────────────────
create or replace function public.marca_captura_asistencias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_id is null then new.captura_id := pg_catalog.gen_random_uuid(); end if;
  else
    if new.asistencia_estado is distinct from old.asistencia_estado
       and new.captura_id is not distinct from old.captura_id then
      new.captura_id := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

create or replace function public.marca_captura_registro_diario()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_participacion is null then new.captura_participacion := pg_catalog.gen_random_uuid(); end if;
    if new.captura_conducta is null then new.captura_conducta := pg_catalog.gen_random_uuid(); end if;
  else
    if new.participacion is distinct from old.participacion
       and new.captura_participacion is not distinct from old.captura_participacion then
      new.captura_participacion := pg_catalog.gen_random_uuid();
    end if;
    if new.conducta is distinct from old.conducta
       and new.captura_conducta is not distinct from old.captura_conducta then
      new.captura_conducta := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

create or replace function public.marca_captura_calificaciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.captura_semaforo is null then new.captura_semaforo := pg_catalog.gen_random_uuid(); end if;
    if new.captura_puntaje is null then new.captura_puntaje := pg_catalog.gen_random_uuid(); end if;
    if new.captura_retroalimentacion is null then new.captura_retroalimentacion := pg_catalog.gen_random_uuid(); end if;
  else
    if (new.estado_entrega is distinct from old.estado_entrega or new.nivel is distinct from old.nivel)
       and new.captura_semaforo is not distinct from old.captura_semaforo then
      new.captura_semaforo := pg_catalog.gen_random_uuid();
    end if;
    if new.puntaje is distinct from old.puntaje
       and new.captura_puntaje is not distinct from old.captura_puntaje then
      new.captura_puntaje := pg_catalog.gen_random_uuid();
    end if;
    if new.retroalimentacion is distinct from old.retroalimentacion
       and new.captura_retroalimentacion is not distinct from old.captura_retroalimentacion then
      new.captura_retroalimentacion := pg_catalog.gen_random_uuid();
    end if;
  end if;
  return new;
end $$;

comment on function public.marca_captura_asistencias() is
  'Mi salón B12: toda escritura de asistencia_estado deja una marca única (la de la captura de Hoy o una del servidor).';
comment on function public.marca_captura_registro_diario() is
  'Mi salón B12: toda escritura de participacion o conducta deja una marca única por campo (la de Hoy o una del servidor).';
comment on function public.marca_captura_calificaciones() is
  'Mi salón B12: toda escritura del semáforo, el puntaje o la retroalimentación deja una marca única por grupo (la de Hoy o una del servidor).';

create or replace trigger asistencias_marca_captura
  before insert or update on public.asistencias
  for each row execute function public.marca_captura_asistencias();

create or replace trigger registro_diario_marca_captura
  before insert or update on public.registro_diario
  for each row execute function public.marca_captura_registro_diario();

create or replace trigger calificaciones_marca_captura
  before insert or update on public.calificaciones
  for each row execute function public.marca_captura_calificaciones();

-- ── 3. Lo de la versión anterior (80a4375; solo en pruebas) ──────────────────
drop trigger if exists asistencias_captura_id on public.asistencias;
drop trigger if exists calificaciones_captura_id on public.calificaciones;
drop trigger if exists registro_diario_captura_id on public.registro_diario;
drop function if exists public.captura_id_sin_marca_nueva();
