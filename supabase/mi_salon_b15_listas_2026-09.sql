-- Mi salón B15 — Listas de cooperación y materiales (decisiones de Jorge, 2026-09-26)
--
-- Solo aditiva: tres tablas nuevas con RLS, dos funciones de trigger nuevas y delete_own_account
-- reemplazada (la de b14 con las líneas de las listas; todo con guarda to_regclass). No toca filas
-- existentes. Se puede correr dos veces ("if not exists" / "create or replace" / políticas y
-- constraints con guarda). Va después de b13 y b14 (y de b13a). Aplicada SOLO en PRUEBAS
-- (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de Jorge y ANTES de publicar
-- listas.html (sin las tablas, la página avisa "No se pudo cargar").
--
-- Qué es: una tabla libre por grupo para registrar cuotas, materiales, permisos firmados o tallas.
--
-- 1. listas_grupo: una lista del grupo (nombre, fecha, descripción opcional). estado 'abierta' o
--    'cerrada'. Cerrada = expediente de solo lectura: la base no deja cambiar la lista (trigger),
--    ni sus columnas ni sus valores (RLS), ni borrarla. Reabrir (estado → 'abierta') sí se puede
--    (la pantalla pide confirmación). Al cerrar se guardan los alumnos activos en ese momento
--    (activos_al_cerrar) para que el historial no cambie con altas y bajas posteriores.
-- 2. listas_columnas: las columnas que crea la maestra. tipo:
--      palomita → entregó / no entregó (listas_valores.entregado)
--      texto    → libre, por ejemplo "Talla 8" (listas_valores.texto, hasta 80 caracteres)
--      monto    → pesos con dos decimales (listas_valores.monto); monto_esperado opcional por
--                 alumno: con él la pantalla calcula lo reunido y lo que falta
--    El tipo no cambia después de creada la columna (trigger): los valores ya guardados son de ese
--    tipo.
-- 3. listas_valores: un valor por columna y alumno (índice único). Solo el campo del tipo de su
--    columna (lo exige la política de escritura). Montos de 0 a 999,999.99 con dos decimales.
--
-- Integridad al borrar (lo conservador, documentado):
--   - Borrar un GRUPO borra sus listas, columnas y valores (ON DELETE CASCADE), como su calendario
--     y sus incidencias.
--   - Borrar una LISTA (solo abierta) borra sus columnas y valores.
--   - Borrar un ALUMNO (Mi grupo, "Eliminar") borra SUS valores en todas las listas (cascada); las
--     listas y los valores de los demás se conservan. Es lo mismo que pasa con sus incidencias: el
--     aviso de privacidad promete que eliminar un alumno borra su registro. Una lista cerrada
--     conserva lo de los demás; sus totales ya no cuentan al alumno eliminado.
--   - Dar de BAJA a un alumno (estatus distinto de activo) NO borra nada: su registro se queda.
--   - Borrar la CUENTA: delete_own_account borra las tres tablas (y la cascada de auth.users
--     también las alcanza).
--
-- RLS: cada maestra solo lo suyo (auth.uid() = maestro_id); al escribir, la lista debe ser de un
-- grupo suyo, la columna de una lista suya ABIERTA y el valor de una columna de esa lista y de un
-- alumno suyo del MISMO grupo (decisión 4 de Jorge: referencias propias). Sin acceso anónimo.
--
-- Exportación: js/exportar.js agrega la hoja "Listas" al Excel del concentrado cuando el grupo tiene
-- listas (con nombres: es el archivo de la maestra). La imagen para las familias nunca lleva nombres
-- (js/listas.js).

-- ── 1. listas_grupo ──────────────────────────────────────────────────────────
create table if not exists public.listas_grupo (
  id                uuid primary key default gen_random_uuid(),
  maestro_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grupo_id          uuid not null references public.grupos (id) on delete cascade,
  nombre            text not null,
  fecha             date not null,
  descripcion       text,
  estado            text not null default 'abierta',
  cerrada_at        timestamptz,
  activos_al_cerrar uuid[],
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint listas_grupo_nombre_largo check (char_length(btrim(nombre)) between 1 and 80),
  constraint listas_grupo_descripcion_largo check (descripcion is null or char_length(descripcion) <= 300),
  constraint listas_grupo_estado_valido check (estado in ('abierta', 'cerrada')),
  constraint listas_grupo_fecha_rango check (fecha >= date '2020-01-01' and fecha < date '2100-01-01'),
  constraint listas_grupo_activos_largo check (activos_al_cerrar is null or cardinality(activos_al_cerrar) <= 200)
);

comment on table public.listas_grupo is
  'Listas de cooperación y materiales de un grupo (cuotas, materiales, permisos, tallas). estado abierta|cerrada; cerrada = expediente de solo lectura. activos_al_cerrar: alumnos activos al cerrarla.';

create index if not exists listas_grupo_maestro_grupo_fecha_idx on public.listas_grupo (maestro_id, grupo_id, fecha desc);
create index if not exists listas_grupo_grupo_idx on public.listas_grupo (grupo_id);

-- ── 2. listas_columnas ───────────────────────────────────────────────────────
create table if not exists public.listas_columnas (
  id              uuid primary key default gen_random_uuid(),
  maestro_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lista_id        uuid not null references public.listas_grupo (id) on delete cascade,
  nombre          text not null,
  tipo            text not null,
  monto_esperado  numeric(9, 2),
  orden           smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint listas_columnas_nombre_largo check (char_length(btrim(nombre)) between 1 and 40),
  constraint listas_columnas_tipo_valido check (tipo in ('palomita', 'texto', 'monto')),
  constraint listas_columnas_esperado_valido
    check (monto_esperado is null or (tipo = 'monto' and monto_esperado >= 0 and monto_esperado <= 999999.99)),
  constraint listas_columnas_orden_rango check (orden between 0 and 99)
);

comment on table public.listas_columnas is
  'Columnas de una lista: palomita (entregó / no entregó), texto (libre) o monto (pesos; monto_esperado opcional por alumno).';

create index if not exists listas_columnas_lista_idx on public.listas_columnas (lista_id);
create index if not exists listas_columnas_maestro_idx on public.listas_columnas (maestro_id);

-- ── 3. listas_valores ────────────────────────────────────────────────────────
create table if not exists public.listas_valores (
  id          uuid primary key default gen_random_uuid(),
  maestro_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lista_id    uuid not null references public.listas_grupo (id) on delete cascade,
  columna_id  uuid not null references public.listas_columnas (id) on delete cascade,
  alumno_id   uuid not null references public.alumnos (id) on delete cascade,
  entregado   boolean,
  texto       text,
  monto       numeric(9, 2),
  updated_at  timestamptz not null default now(),
  constraint listas_valores_un_campo check (num_nonnulls(entregado, texto, monto) <= 1),
  constraint listas_valores_texto_largo check (texto is null or char_length(texto) <= 80),
  constraint listas_valores_monto_rango check (monto is null or (monto >= 0 and monto <= 999999.99))
);

comment on table public.listas_valores is
  'Un valor por columna y alumno: entregado (palomita), texto o monto (pesos). Borrar al alumno borra sus valores; darlo de baja no.';

create unique index if not exists listas_valores_columna_alumno_uidx on public.listas_valores (columna_id, alumno_id);
create index if not exists listas_valores_lista_idx on public.listas_valores (lista_id);
create index if not exists listas_valores_alumno_idx on public.listas_valores (alumno_id);
create index if not exists listas_valores_maestro_idx on public.listas_valores (maestro_id);

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- Lista cerrada = solo lectura: no se cambia nada mientras siga cerrada; solo reabrir. Al cerrar
-- se pone cerrada_at; al reabrir se limpian cerrada_at y activos_al_cerrar.
create or replace function public.listas_grupo_antes_de_cambiar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.estado = 'cerrada' and new.estado = 'cerrada' then
    raise exception 'La lista está cerrada: reábrela para cambiarla.' using errcode = 'check_violation';
  end if;
  if new.grupo_id <> old.grupo_id then
    raise exception 'Una lista no cambia de grupo.' using errcode = 'check_violation';
  end if;
  if new.estado = 'cerrada' and old.estado = 'abierta' then
    new.cerrada_at := now();
  elsif new.estado = 'abierta' and old.estado = 'cerrada' then
    new.cerrada_at := null;
    new.activos_al_cerrar := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.listas_grupo_antes_de_cambiar() from public, anon, authenticated;

drop trigger if exists listas_grupo_antes_de_cambiar on public.listas_grupo;
create trigger listas_grupo_antes_de_cambiar before update on public.listas_grupo
  for each row execute function public.listas_grupo_antes_de_cambiar();

-- El tipo de una columna no cambia (sus valores ya son de ese tipo) ni la columna cambia de lista
create or replace function public.listas_columnas_antes_de_cambiar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tipo <> old.tipo then
    raise exception 'El tipo de una columna no se puede cambiar.' using errcode = 'check_violation';
  end if;
  if new.lista_id <> old.lista_id then
    raise exception 'Una columna no cambia de lista.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.listas_columnas_antes_de_cambiar() from public, anon, authenticated;

drop trigger if exists listas_columnas_antes_de_cambiar on public.listas_columnas;
create trigger listas_columnas_antes_de_cambiar before update on public.listas_columnas
  for each row execute function public.listas_columnas_antes_de_cambiar();

drop trigger if exists listas_valores_updated_at on public.listas_valores;
create trigger listas_valores_updated_at before update on public.listas_valores
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.listas_grupo enable row level security;
alter table public.listas_columnas enable row level security;
alter table public.listas_valores enable row level security;

revoke all on public.listas_grupo from anon;
revoke all on public.listas_columnas from anon;
revoke all on public.listas_valores from anon;
grant select, insert, update, delete on public.listas_grupo to authenticated;
grant select, insert, update, delete on public.listas_columnas to authenticated;
grant select, insert, update, delete on public.listas_valores to authenticated;

do $$
begin
  -- listas_grupo: solo las suyas, en un grupo suyo; borrar solo una lista abierta
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_grupo' and policyname = 'listas_grupo_select_propias') then
    create policy listas_grupo_select_propias on public.listas_grupo
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_grupo' and policyname = 'listas_grupo_insert_propias') then
    create policy listas_grupo_insert_propias on public.listas_grupo
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and estado = 'abierta'
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_grupo' and policyname = 'listas_grupo_update_propias') then
    create policy listas_grupo_update_propias on public.listas_grupo
      for update to authenticated
      using ((select auth.uid()) = maestro_id)
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_grupo' and policyname = 'listas_grupo_delete_abiertas') then
    create policy listas_grupo_delete_abiertas on public.listas_grupo
      for delete to authenticated using ((select auth.uid()) = maestro_id and estado = 'abierta');
  end if;

  -- listas_columnas: solo en una lista suya y ABIERTA
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_columnas' and policyname = 'listas_columnas_select_propias') then
    create policy listas_columnas_select_propias on public.listas_columnas
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_columnas' and policyname = 'listas_columnas_insert_abiertas') then
    create policy listas_columnas_insert_abiertas on public.listas_columnas
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_columnas' and policyname = 'listas_columnas_update_abiertas') then
    create policy listas_columnas_update_abiertas on public.listas_columnas
      for update to authenticated
      using (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      )
      with check (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_columnas' and policyname = 'listas_columnas_delete_abiertas') then
    create policy listas_columnas_delete_abiertas on public.listas_columnas
      for delete to authenticated
      using (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      );
  end if;

  -- listas_valores: lista suya y ABIERTA, columna de esa lista con el campo de su tipo, y alumno
  -- suyo del MISMO grupo que la lista
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_valores' and policyname = 'listas_valores_select_propios') then
    create policy listas_valores_select_propios on public.listas_valores
      for select to authenticated using ((select auth.uid()) = maestro_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_valores' and policyname = 'listas_valores_insert_abiertas') then
    create policy listas_valores_insert_abiertas on public.listas_valores
      for insert to authenticated
      with check (
        (select auth.uid()) = maestro_id
        and exists (
          select 1
          from public.listas_grupo l
          join public.listas_columnas c on c.lista_id = l.id
          join public.alumnos a on a.grupo_id = l.grupo_id
          where l.id = listas_valores.lista_id
            and c.id = listas_valores.columna_id
            and a.id = listas_valores.alumno_id
            and l.estado = 'abierta'
            and l.maestro_id = (select auth.uid())
            and c.maestro_id = (select auth.uid())
            and a.maestro_id = (select auth.uid())
            and ((c.tipo = 'palomita' and listas_valores.texto is null and listas_valores.monto is null)
              or (c.tipo = 'texto' and listas_valores.entregado is null and listas_valores.monto is null)
              or (c.tipo = 'monto' and listas_valores.entregado is null and listas_valores.texto is null))
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_valores' and policyname = 'listas_valores_update_abiertas') then
    create policy listas_valores_update_abiertas on public.listas_valores
      for update to authenticated
      using (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      )
      with check (
        (select auth.uid()) = maestro_id
        and exists (
          select 1
          from public.listas_grupo l
          join public.listas_columnas c on c.lista_id = l.id
          join public.alumnos a on a.grupo_id = l.grupo_id
          where l.id = listas_valores.lista_id
            and c.id = listas_valores.columna_id
            and a.id = listas_valores.alumno_id
            and l.estado = 'abierta'
            and l.maestro_id = (select auth.uid())
            and c.maestro_id = (select auth.uid())
            and a.maestro_id = (select auth.uid())
            and ((c.tipo = 'palomita' and listas_valores.texto is null and listas_valores.monto is null)
              or (c.tipo = 'texto' and listas_valores.entregado is null and listas_valores.monto is null)
              or (c.tipo = 'monto' and listas_valores.entregado is null and listas_valores.texto is null))
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listas_valores' and policyname = 'listas_valores_delete_abiertas') then
    create policy listas_valores_delete_abiertas on public.listas_valores
      for delete to authenticated
      using (
        (select auth.uid()) = maestro_id
        and exists (select 1 from public.listas_grupo l
                    where l.id = lista_id and l.maestro_id = (select auth.uid()) and l.estado = 'abierta')
      );
  end if;
end $$;

-- ── delete_own_account: también las listas ───────────────────────────────────
-- La de b14 con las líneas de b15. Todo lo de b13 en adelante con guarda to_regclass: esta versión
-- sirve aunque alguna de esas tablas no exista todavía en la base donde se corre.
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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
