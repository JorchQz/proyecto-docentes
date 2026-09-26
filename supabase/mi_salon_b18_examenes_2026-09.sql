-- Mi salón B18 — Exámenes de Mi Salón (decisiones de Jorge, 2026-09-26)
--
-- Solo aditiva: cuatro tablas nuevas con RLS, una función de trigger nueva y delete_own_account
-- reemplazada (la de jissez_interes_secciones con las líneas de estas tablas; todo lo de b13 en
-- adelante con guarda to_regclass, para que el orden con otras migraciones paralelas no importe).
-- No toca filas existentes ni las tablas viejas (examenes, respuestas_examen, banco_preguntas: el
-- catálogo se vende en la tienda y ya no se muestra en Mi Salón, pero sus datos se conservan y el
-- motor de calificación los sigue leyendo). Se puede correr dos veces ("if not exists" /
-- "create or replace" / políticas con guarda). Va después de jissez_interes_secciones_2026-09.sql.
-- Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de Jorge y
-- ANTES de publicar la pantalla nueva de examen.html (sin las tablas, la página avisa "No se pudo
-- cargar").
--
-- Qué es: la maestra elige, por examen, uno de dos caminos (examenes_grupo.modo):
--
--   'resultados' → "Solo subir resultados". Por campo formativo, cuántas preguntas tenía y
--                  cuántos aciertos sacó cada alumno (examen_resultados: una fila por alumno y
--                  campo). Sirve con cualquier examen: propio, comprado en la tienda o revisado a
--                  mano. campos_resultados guarda la configuración que se ve en la tabla
--                  ({"LEN": 10, "SAB": 8}); cada fila guarda su propio número de preguntas y la
--                  base exige 0 <= aciertos <= preguntas.
--   'propio'     → "Crear su examen en Mi Salón". Preguntas (examen_preguntas) de cuatro tipos:
--                    opcion_multiple  2 a 5 opciones (texto) y clave 'A'..'E'  → se califica sola
--                    verdadero_falso  clave 'V' o 'F'                           → se califica sola
--                    completar        clave opcional = respuesta esperada (guía de la maestra)
--                    abierta          sin clave
--                  Las respuestas (examen_respuestas, una por alumno y pregunta):
--                    automáticas: respuesta 'A'..'E' / 'V' / 'F', '*' = doble marca, null = vacía
--                                 (vale 1 si coincide con la clave; si no, 0)
--                    a mano:      resultado 'correcta' (1) / 'parcial' (0.5) / 'incorrecta' (0);
--                                 sin resultado = aún sin calificar (no cuenta).
--                  origen: 'toque' (captura tocando la letra), 'escaneo' (cámara) o 'manual'.
--
-- Multigrado: grados es la lista de grados que presentan el examen (uno o varios). Todas las
-- preguntas son para todos esos grados; si la maestra quiere preguntas distintas por grado,
-- hace un examen por grado. El alumno cuenta con su grado OFICIAL (alumnos.grado).
--
-- Calificación: el rubro "examen" del motor (js/motor-calificacion.js) por campo formativo =
-- aciertos / preguntas de los exámenes del trimestre de su grado, sumados; con el mismo lugar y
-- peso que antes. Un alumno sin resultados en un examen no se cuenta en ese examen (como un
-- trabajo sin calificar). La conversión porcentaje → calificación sigue solo en SQL.
--
-- Integridad al borrar (lo conservador, documentado):
--   - Borrar un GRUPO borra sus exámenes, preguntas, respuestas y resultados (ON DELETE CASCADE).
--   - Borrar un EXAMEN borra sus preguntas, respuestas y resultados.
--   - Borrar una PREGUNTA borra sus respuestas.
--   - Borrar un ALUMNO (Mi grupo, "Eliminar") borra SUS respuestas y resultados; dar de baja no.
--   - Borrar la CUENTA: delete_own_account borra las cuatro tablas (y la cascada de auth.users
--     también las alcanza).
--
-- RLS: cada maestra solo lo suyo (auth.uid() = maestro_id); al escribir, el examen debe ser de un
-- grupo suyo; la pregunta, de un examen suyo 'propio'; el resultado, de un examen suyo
-- 'resultados' y de un alumno suyo del MISMO grupo; la respuesta, de una pregunta de ese mismo
-- examen y de un alumno suyo del mismo grupo (decisión 4 de Jorge: referencias propias). Un
-- examen no cambia de grupo ni de modo (trigger). Sin acceso anónimo.

-- ── 1. examenes_grupo ───────────────────────────────────────────────────────
create table if not exists public.examenes_grupo (
  id                 uuid primary key default gen_random_uuid(),
  maestro_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id           uuid not null references public.grupos (id) on delete cascade,
  titulo             text not null,
  modo               text not null,
  trimestre          smallint not null,
  grados             smallint[] not null,
  fecha_aplicacion   date,
  instrucciones      text,
  campos_resultados  jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint examenes_grupo_titulo_largo check (char_length(btrim(titulo)) between 1 and 120),
  constraint examenes_grupo_modo_valido check (modo in ('resultados', 'propio')),
  constraint examenes_grupo_trimestre_valido check (trimestre between 1 and 3),
  constraint examenes_grupo_grados_validos
    check (cardinality(grados) between 1 and 6 and grados <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  constraint examenes_grupo_fecha_rango
    check (fecha_aplicacion is null or (fecha_aplicacion >= date '2020-01-01' and fecha_aplicacion < date '2100-01-01')),
  constraint examenes_grupo_instrucciones_largo check (instrucciones is null or char_length(instrucciones) <= 500),
  constraint examenes_grupo_campos_objeto
    check (campos_resultados is null or (modo = 'resultados' and jsonb_typeof(campos_resultados) = 'object'))
);

comment on table public.examenes_grupo is
  'Exámenes de Mi Salón por grupo. modo resultados (solo aciertos por campo: examen_resultados) o propio (preguntas y respuestas: examen_preguntas, examen_respuestas). grados: los que lo presentan. Alimentan el rubro examen del motor.';

create index if not exists examenes_grupo_maestro_grupo_idx on public.examenes_grupo (maestro_id, grupo_id, trimestre);
create index if not exists examenes_grupo_grupo_idx on public.examenes_grupo (grupo_id);

-- ── 2. examen_preguntas ─────────────────────────────────────────────────────
create table if not exists public.examen_preguntas (
  id          uuid primary key default gen_random_uuid(),
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  examen_id   uuid not null references public.examenes_grupo (id) on delete cascade,
  orden       smallint not null default 0,
  tipo        text not null,
  campo       text not null,
  enunciado   text not null,
  opciones    jsonb,
  clave       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint examen_preguntas_orden_rango check (orden between 0 and 999),
  constraint examen_preguntas_tipo_valido check (tipo in ('opcion_multiple', 'verdadero_falso', 'completar', 'abierta')),
  constraint examen_preguntas_campo_valido check (campo in ('LEN', 'SAB', 'ETI', 'DHL')),
  constraint examen_preguntas_enunciado_largo check (char_length(btrim(enunciado)) between 1 and 1000),
  constraint examen_preguntas_opciones_validas check (
    case tipo
      when 'opcion_multiple' then
        jsonb_typeof(opciones) = 'array' and jsonb_array_length(opciones) between 2 and 5
        and clave is not null
        and clave = any ((array['A', 'B', 'C', 'D', 'E'])[1:jsonb_array_length(opciones)])
      when 'verdadero_falso' then opciones is null and clave in ('V', 'F')
      else opciones is null and (clave is null or char_length(clave) <= 200)
    end
  )
);

comment on table public.examen_preguntas is
  'Preguntas de un examen propio: opcion_multiple (2 a 5 opciones, clave A-E) y verdadero_falso (clave V/F) se califican solas; completar (clave = respuesta esperada, opcional) y abierta se califican a mano. campo: LEN/SAB/ETI/DHL.';

create index if not exists examen_preguntas_examen_idx on public.examen_preguntas (examen_id, orden);
create index if not exists examen_preguntas_maestro_idx on public.examen_preguntas (maestro_id);

-- ── 3. examen_resultados ────────────────────────────────────────────────────
create table if not exists public.examen_resultados (
  id          uuid primary key default gen_random_uuid(),
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  examen_id   uuid not null references public.examenes_grupo (id) on delete cascade,
  alumno_id   uuid not null references public.alumnos (id) on delete cascade,
  campo       text not null,
  preguntas   smallint not null,
  aciertos    smallint not null,
  updated_at  timestamptz not null default now(),
  constraint examen_resultados_campo_valido check (campo in ('LEN', 'SAB', 'ETI', 'DHL')),
  constraint examen_resultados_preguntas_rango check (preguntas between 1 and 200),
  constraint examen_resultados_aciertos_rango check (aciertos between 0 and preguntas)
);

comment on table public.examen_resultados is
  'Solo subir resultados: aciertos de un alumno en un campo formativo de un examen (0 <= aciertos <= preguntas).';

create unique index if not exists examen_resultados_examen_alumno_campo_uidx on public.examen_resultados (examen_id, alumno_id, campo);
create index if not exists examen_resultados_alumno_idx on public.examen_resultados (alumno_id);
create index if not exists examen_resultados_maestro_idx on public.examen_resultados (maestro_id);

-- ── 4. examen_respuestas ────────────────────────────────────────────────────
create table if not exists public.examen_respuestas (
  id           uuid primary key default gen_random_uuid(),
  maestro_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  examen_id    uuid not null references public.examenes_grupo (id) on delete cascade,
  pregunta_id  uuid not null references public.examen_preguntas (id) on delete cascade,
  alumno_id    uuid not null references public.alumnos (id) on delete cascade,
  respuesta    text,
  resultado    text,
  origen       text not null default 'toque',
  updated_at   timestamptz not null default now(),
  constraint examen_respuestas_respuesta_valida check (respuesta is null or respuesta in ('A', 'B', 'C', 'D', 'E', 'V', 'F', '*')),
  constraint examen_respuestas_resultado_valido check (resultado is null or resultado in ('correcta', 'parcial', 'incorrecta')),
  constraint examen_respuestas_origen_valido check (origen in ('toque', 'escaneo', 'manual'))
);

comment on table public.examen_respuestas is
  'Respuesta de un alumno a una pregunta de un examen propio. Automáticas: respuesta A-E / V / F, * = doble marca, null = vacía. A mano: resultado correcta (1) / parcial (0.5) / incorrecta (0); null = sin calificar.';

create unique index if not exists examen_respuestas_pregunta_alumno_uidx on public.examen_respuestas (pregunta_id, alumno_id);
create index if not exists examen_respuestas_examen_idx on public.examen_respuestas (examen_id);
create index if not exists examen_respuestas_alumno_idx on public.examen_respuestas (alumno_id);
create index if not exists examen_respuestas_maestro_idx on public.examen_respuestas (maestro_id);

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- Un examen no cambia de grupo ni de modo: sus preguntas, respuestas y resultados son de ese
-- grupo y de ese camino.
create or replace function public.examenes_grupo_antes_de_cambiar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.grupo_id <> old.grupo_id then
    raise exception 'Un examen no cambia de grupo.' using errcode = 'check_violation';
  end if;
  if new.modo <> old.modo then
    raise exception 'Un examen no cambia de camino (resultados o propio).' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.examenes_grupo_antes_de_cambiar() from public, anon, authenticated;

drop trigger if exists examenes_grupo_antes_de_cambiar on public.examenes_grupo;
create trigger examenes_grupo_antes_de_cambiar before update on public.examenes_grupo
  for each row execute function public.examenes_grupo_antes_de_cambiar();

drop trigger if exists examen_preguntas_updated_at on public.examen_preguntas;
create trigger examen_preguntas_updated_at before update on public.examen_preguntas
  for each row execute function public.set_updated_at();
drop trigger if exists examen_resultados_updated_at on public.examen_resultados;
create trigger examen_resultados_updated_at before update on public.examen_resultados
  for each row execute function public.set_updated_at();
drop trigger if exists examen_respuestas_updated_at on public.examen_respuestas;
create trigger examen_respuestas_updated_at before update on public.examen_respuestas
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.examenes_grupo enable row level security;
alter table public.examen_preguntas enable row level security;
alter table public.examen_resultados enable row level security;
alter table public.examen_respuestas enable row level security;

revoke all on public.examenes_grupo from anon;
revoke all on public.examen_preguntas from anon;
revoke all on public.examen_resultados from anon;
revoke all on public.examen_respuestas from anon;
grant select, insert, update, delete on public.examenes_grupo to authenticated;
grant select, insert, update, delete on public.examen_preguntas to authenticated;
grant select, insert, update, delete on public.examen_resultados to authenticated;
grant select, insert, update, delete on public.examen_respuestas to authenticated;

do $$
begin
  -- examenes_grupo: solo los suyos, en un grupo suyo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examenes_grupo' and policyname = 'examenes_grupo_select_propios') then
    create policy examenes_grupo_select_propios on public.examenes_grupo
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examenes_grupo' and policyname = 'examenes_grupo_insert_propios') then
    create policy examenes_grupo_insert_propios on public.examenes_grupo
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examenes_grupo' and policyname = 'examenes_grupo_update_propios') then
    create policy examenes_grupo_update_propios on public.examenes_grupo
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examenes_grupo' and policyname = 'examenes_grupo_delete_propios') then
    create policy examenes_grupo_delete_propios on public.examenes_grupo
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;

  -- examen_preguntas: de un examen suyo con modo 'propio'
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_preguntas' and policyname = 'examen_preguntas_select_propias') then
    create policy examen_preguntas_select_propias on public.examen_preguntas
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_preguntas' and policyname = 'examen_preguntas_insert_propias') then
    create policy examen_preguntas_insert_propias on public.examen_preguntas
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'propio')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_preguntas' and policyname = 'examen_preguntas_update_propias') then
    create policy examen_preguntas_update_propias on public.examen_preguntas
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'propio')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_preguntas' and policyname = 'examen_preguntas_delete_propias') then
    create policy examen_preguntas_delete_propias on public.examen_preguntas
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;

  -- examen_resultados: examen suyo 'resultados' y alumno suyo del MISMO grupo que el examen
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_resultados' and policyname = 'examen_resultados_select_propios') then
    create policy examen_resultados_select_propios on public.examen_resultados
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_resultados' and policyname = 'examen_resultados_insert_propios') then
    create policy examen_resultados_insert_propios on public.examen_resultados
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'resultados'
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_resultados' and policyname = 'examen_resultados_update_propios') then
    create policy examen_resultados_update_propios on public.examen_resultados
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'resultados'
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_resultados' and policyname = 'examen_resultados_delete_propios') then
    create policy examen_resultados_delete_propios on public.examen_resultados
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;

  -- examen_respuestas: pregunta de ese mismo examen (suyo, 'propio') y alumno suyo del mismo grupo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_respuestas' and policyname = 'examen_respuestas_select_propias') then
    create policy examen_respuestas_select_propias on public.examen_respuestas
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_respuestas' and policyname = 'examen_respuestas_insert_propias') then
    create policy examen_respuestas_insert_propias on public.examen_respuestas
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.examen_preguntas p on p.examen_id = e.id
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'propio'
                      and p.id = pregunta_id and p.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_respuestas' and policyname = 'examen_respuestas_update_propias') then
    create policy examen_respuestas_update_propias on public.examen_respuestas
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.examenes_grupo e
                    join public.examen_preguntas p on p.examen_id = e.id
                    join public.alumnos a on a.grupo_id = e.grupo_id
                    where e.id = examen_id and e.maestro_id = (select auth.uid()) and e.modo = 'propio'
                      and p.id = pregunta_id and p.maestro_id = (select auth.uid())
                      and a.id = alumno_id and a.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'examen_respuestas' and policyname = 'examen_respuestas_delete_propias') then
    create policy examen_respuestas_delete_propias on public.examen_respuestas
      for delete to authenticated using ((select auth.uid()) = maestro_id);
  end if;
end $$;

-- ── delete_own_account: también los exámenes de Mi Salón ─────────────────────
-- La de jissez_interes_secciones (que ya cubre b13, b14, b15 e interes_secciones) con las líneas
-- de b18. Todo lo de b13 en adelante con guarda to_regclass: esta versión sirve aunque alguna de
-- esas tablas no exista todavía en la base donde se corre. La migración paralela b17 (asignación
-- por alumno y sueltas, constructor AG) también reemplaza esta función: esta versión ya lleva su
-- línea (producto_sesion_alumnos, con guarda). La que se aplique AL FINAL debe llevar las líneas
-- de ambas: aplicar b18 después de b17, o agregar a b17 las cuatro líneas de exámenes.
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

  -- Datos de Mi salón que no se borran en cascada con la cuenta (primero los que dependen de otros)
  delete from public.evaluacion_formativa where maestro_id = v;
  delete from public.calificaciones where maestro_id = v;
  delete from public.registro_diario where maestro_id = v;
  delete from public.boleta_trimestral where maestro_id = v;
  delete from public.evaluacion_diagnostica where maestro_id = v;
  delete from public.tareas where maestro_id = v;
  -- Asignación por alumno (b17, constructor AG, en paralelo): antes que productos_sesion
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
  -- Exámenes de Mi Salón (b18): respuestas, resultados, preguntas y exámenes
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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
