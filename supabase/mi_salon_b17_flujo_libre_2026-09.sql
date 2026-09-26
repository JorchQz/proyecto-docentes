-- Mi salón B17 — Flujo libre y asignación por alumno (decisiones de Jorge del 2026-09-26)
--
-- Solo aditiva: una columna nueva en proyectos, tres en calificaciones, una tabla nueva con RLS
-- (producto_sesion_alumnos), funciones nuevas y dos reemplazadas (marca_captura_calificaciones y
-- delete_own_account, que conservan todo lo anterior). No borra filas existentes ni columnas. Se
-- puede correr dos veces ("if not exists" / "create or replace" / políticas con guarda). Va
-- después de b12, b13, b14, b15 y jissez_interes_secciones. Aplicada SOLO en PRUEBAS
-- (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de Jorge y ANTES de publicar el
-- frontend: Hoy, Inicio, Tareas, Proyectos y el motor leen las columnas nuevas (sin ellas la
-- lectura falla y la pantalla dice "No se pudo cargar"; nada se escribe a medias).
--
-- 1. Actividades sueltas (sin proyecto). "Guiar sin obligar": se guardan en un contenedor por
--    grupo y trimestre, un proyecto con tipo = 'sueltas' ("Actividades del trimestre"), con una
--    sesión por fecha y campo formativo. Así el motor, la boleta, Qué le falta, Tareas e Inicio las
--    cuentan sin cambiar su modelo (producto → sesión → proyecto → trimestre), y el reparto de
--    participación del día (motor, §B.4) incluye su campo. El contenedor:
--      - tipo 'sueltas' (los demás proyectos quedan con 'proyecto', el valor por omisión);
--      - estado 'completado' (nunca entra a "Trabajar hoy", a la tarjeta de proyectos activos de
--        Inicio, a iniciar ni a duplicar) y fecha_final = la última fecha de sus sesiones: "Hoy"
--        lo mira con la regla de siempre (trimestre actual o terminado hace menos de 30 días);
--      - uno por grupo y trimestre (índice único parcial).
--    Proyectos, Actividades y Crear proyecto lo excluyen por su tipo.
--    agregar_actividad_suelta() crea (si falta) el contenedor y la sesión del día y campo, y el
--    producto con su "para quién" y sus PDA, todo en una transacción.
--    mover_producto_a_sesion() "pasa a un proyecto" una actividad suelta: el producto con sus
--    calificaciones, su asignación y sus PDA (y la evidencia) a una sesión de un proyecto del mismo
--    grupo y trimestre, sin perder nada.
--
-- 2. Asignación por alumno ("¿Para quién?"). Tabla producto_sesion_alumnos (producto, alumno,
--    modo 'incluir' | 'excluir'). REGLA ÚNICA (espejo de AlcanceHoy.asignadoA en js/alcance-hoy.js):
--      el alumno recibe el producto si (su grado está en productos_sesion.grados y no está
--      excluido) o está incluido; además cuenta la regla del alta tarde (solo en el frontend y el
--      motor, igual que antes).
--    alumno_recibe_producto() es esa regla en SQL (la usa guardar_asignacion_producto para no quitar
--    a un alumno que ya tiene calificación). El alumno sigue en su grado oficial para la boleta y
--    el examen: la asignación solo decide quién recibe el producto.
--    Evidencia de PDA: la propagación (propagar_calificacion_a_pda, b5) ya deja evidencia solo en
--    los PDA del GRADO DEL ALUMNO ligados al producto. Un alumno incluido de otro grado deja
--    evidencia si la actividad tiene PDA elegidos para su grado; si no, no deja evidencia de PDA
--    pero su calificación cuenta igual para la boleta. No hizo falta cambiar la propagación.
--    RLS: auth.uid() = maestro_id; al escribir, el producto y el alumno deben ser propios y del
--    MISMO grupo (el del proyecto de la sesión del producto).
--
-- 3. "Incompleta" en una actividad en clase pasa a revisarse el siguiente día de clase:
--      calificaciones.revisar_en     date  el día de clase en que se revisa (calendario SEP y
--                                          ajustes del grupo: CalendarioSEP.siguienteDiaDeClase)
--      calificaciones.estado_en_clase text 'incompleta' (pendiente de revisar) | 'completada'
--                                          (la revisó y la completó) | 'sigue_incompleta' (la
--                                          revisó y sigue incompleta: definitiva)
--      calificaciones.completado_en  date  el día en que se revisó (cuando la completó o cuando
--                                          se confirmó que sigue incompleta)
--    El valor para la boleta no necesita columnas nuevas: pendiente y "sigue incompleta" son
--    estado_entrega 'incompleto' sin nivel (0.5 en el motor); "lo completó" es 'entregado' con el
--    nivel que logró. Las tres columnas van en el MISMO grupo de marca que el semáforo
--    (captura_semaforo) de la cola sin señal de Hoy (b12): se escriben y deciden juntas.
--
-- 4. delete_own_account: todo lo anterior (b10, b13, b14, b15, interes_secciones) más
--    producto_sesion_alumnos.

-- ── 1. Columnas ──────────────────────────────────────────────────────────────
alter table public.proyectos add column if not exists tipo text not null default 'proyecto';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'proyectos_tipo_valido') then
    alter table public.proyectos add constraint proyectos_tipo_valido check (tipo in ('proyecto', 'sueltas'));
  end if;
end $$;
comment on column public.proyectos.tipo is
  'proyecto = planeación normal · sueltas = contenedor "Actividades del trimestre" (uno por grupo y trimestre; mi_salon_b17).';
create unique index if not exists proyectos_sueltas_grupo_trimestre_uidx
  on public.proyectos (grupo_id, trimestre) where tipo = 'sueltas';

alter table public.calificaciones add column if not exists revisar_en date;
alter table public.calificaciones add column if not exists estado_en_clase text;
alter table public.calificaciones add column if not exists completado_en date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'calificaciones_estado_en_clase_valido') then
    alter table public.calificaciones add constraint calificaciones_estado_en_clase_valido
      check (estado_en_clase is null or estado_en_clase in ('incompleta', 'completada', 'sigue_incompleta'));
  end if;
end $$;
comment on column public.calificaciones.revisar_en is
  'Actividad en clase marcada Incompleta: día de clase en que se revisa (calendario SEP + ajustes del grupo). mi_salon_b17.';
comment on column public.calificaciones.estado_en_clase is
  'incompleta = pendiente de revisar · completada = la completó al revisarla · sigue_incompleta = revisada, sigue incompleta (definitiva). mi_salon_b17.';
comment on column public.calificaciones.completado_en is
  'Día en que se revisó la actividad incompleta (la completó o se confirmó incompleta). mi_salon_b17.';
create index if not exists idx_calificaciones_por_revisar
  on public.calificaciones (maestro_id, revisar_en) where estado_en_clase = 'incompleta';

-- La marca del semáforo (b12) cubre también las columnas nuevas: cualquier escritura que no sea de
-- Hoy y cambie alguna de ellas recibe una marca del servidor (igual que estado_entrega y nivel)
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
    if (new.estado_entrega is distinct from old.estado_entrega or new.nivel is distinct from old.nivel
        or new.revisar_en is distinct from old.revisar_en or new.estado_en_clase is distinct from old.estado_en_clase
        or new.completado_en is distinct from old.completado_en)
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
comment on function public.marca_captura_calificaciones() is
  'Mi salón B12/B17: toda escritura del semáforo (entrega, nivel y la revisión de la incompleta), el puntaje o la retroalimentación deja una marca única por grupo (la de Hoy o una del servidor).';

-- ── 2. Asignación por alumno ─────────────────────────────────────────────────
create table if not exists public.producto_sesion_alumnos (
  id uuid primary key default gen_random_uuid(),
  producto_sesion_id uuid not null references public.productos_sesion(id) on delete cascade,
  alumno_id uuid not null references public.alumnos(id) on delete cascade,
  maestro_id uuid not null references auth.users(id) on delete cascade,
  modo text not null check (modo in ('incluir', 'excluir')),
  created_at timestamptz not null default now()
);
create unique index if not exists producto_sesion_alumnos_uidx on public.producto_sesion_alumnos (producto_sesion_id, alumno_id);
create index if not exists producto_sesion_alumnos_alumno_idx on public.producto_sesion_alumnos (maestro_id, alumno_id);
comment on table public.producto_sesion_alumnos is
  'Para quién es un producto, además de sus grados: incluir (alumno de otro grado o elegido) o excluir (alumno de uno de sus grados que no la hace). Regla única: recibe si (grado en grados y no excluido) o incluido. mi_salon_b17.';

-- El alumno y el producto son del mismo grupo (el del proyecto de la sesión del producto)
create or replace function public.ref_asignacion_mismo_grupo(p_producto uuid, p_alumno uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.productos_sesion ps
    join public.sesiones s on s.id = ps.sesion_id
    join public.proyectos p on p.id = s.proyecto_id
    join public.alumnos a on a.id = p_alumno
    where ps.id = p_producto and ps.maestro_id = auth.uid() and a.maestro_id = auth.uid() and a.grupo_id = p.grupo_id
  ) then
    return true;
  end if;
  raise exception 'El alumno no es del grupo de esta actividad' using errcode = '42501';
end $$;

alter table public.producto_sesion_alumnos enable row level security;
revoke all on public.producto_sesion_alumnos from anon;
grant select, insert, update, delete on public.producto_sesion_alumnos to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'producto_sesion_alumnos' and policyname = 'producto_sesion_alumnos_propios') then
    create policy producto_sesion_alumnos_propios on public.producto_sesion_alumnos
      for all to authenticated using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'producto_sesion_alumnos' and policyname = 'producto_sesion_alumnos_refs_propias_ins') then
    create policy producto_sesion_alumnos_refs_propias_ins on public.producto_sesion_alumnos
      as restrictive for insert to authenticated
      with check (public.ref_propia_producto_sesion(producto_sesion_id) and public.ref_propia_alumno(alumno_id)
                  and public.ref_asignacion_mismo_grupo(producto_sesion_id, alumno_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'producto_sesion_alumnos' and policyname = 'producto_sesion_alumnos_refs_propias_upd') then
    create policy producto_sesion_alumnos_refs_propias_upd on public.producto_sesion_alumnos
      as restrictive for update to authenticated
      using (true)
      with check (public.ref_propia_producto_sesion(producto_sesion_id) and public.ref_propia_alumno(alumno_id)
                  and public.ref_asignacion_mismo_grupo(producto_sesion_id, alumno_id));
  end if;
end $$;

-- La regla única en SQL (espejo de AlcanceHoy.asignadoA)
create or replace function public.alumno_recibe_producto(p_alumno uuid, p_producto uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select case
      when x.modo = 'incluir' then true
      when x.modo = 'excluir' then false
      else a.grado::text = any (ps.grados)
    end
    from public.productos_sesion ps
    join public.alumnos a on a.id = p_alumno
    left join public.producto_sesion_alumnos x on x.producto_sesion_id = ps.id and x.alumno_id = p_alumno
    where ps.id = p_producto
  ), false)
$$;

-- Nombre largo de un campo (código corto → como lo guardan sesiones y calificaciones)
create or replace function public.campo_largo(p_campo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_campo
    when 'LEN' then 'Lenguajes'
    when 'SAB' then 'Saberes y Pensamiento Científico'
    when 'ETI' then 'Ética, Naturaleza y Sociedades'
    when 'DHL' then 'De lo Humano y lo Comunitario'
    when 'HUM' then 'De lo Humano y lo Comunitario'
    else null end
$$;

/*
  guardar_asignacion_producto(producto, filas) — reemplaza el "para quién" de un producto.
  filas: [{ "alumno_id": uuid, "modo": "incluir" | "excluir" }]. Una transacción: borra las que ya
  no van y pone las nuevas. No deja fuera a un alumno que ya tiene calificación capturada en el
  producto (se avisa con su nombre).
*/
create or replace function public.guardar_asignacion_producto(p_producto uuid, p_filas jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nombre text;
begin
  if not exists (select 1 from public.productos_sesion where id = p_producto and maestro_id = auth.uid()) then
    raise exception 'La actividad no existe o no es de tu cuenta' using errcode = '42501';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then p_filas := '[]'::jsonb; end if;

  delete from public.producto_sesion_alumnos x
  where x.producto_sesion_id = p_producto
    and not exists (
      select 1 from jsonb_array_elements(p_filas) f
      where (f->>'alumno_id')::uuid = x.alumno_id and f->>'modo' = x.modo
    );
  insert into public.producto_sesion_alumnos (producto_sesion_id, alumno_id, maestro_id, modo)
  select p_producto, (f->>'alumno_id')::uuid, auth.uid(), f->>'modo'
  from jsonb_array_elements(p_filas) f
  on conflict (producto_sesion_id, alumno_id) do update set modo = excluded.modo;

  select a.nombre_completo into v_nombre
  from public.calificaciones c
  join public.alumnos a on a.id = c.alumno_id
  where c.producto_sesion_id = p_producto and c.maestro_id = auth.uid()
    and (c.estado_entrega is not null or c.nivel is not null or c.puntaje is not null or nullif(c.retroalimentacion, '') is not null)
    and not public.alumno_recibe_producto(c.alumno_id, p_producto)
  limit 1;
  if v_nombre is not null then
    raise exception '% ya tiene calificación en esta actividad: no se puede quitar.', v_nombre using errcode = 'P0001';
  end if;
end $$;

/*
  agregar_producto_sesion(sesion, producto, asignacion, ligar, crear) — agrega una actividad o tarea
  a una sesión, con su "para quién" y sus PDA, en una sola transacción (nunca queda un producto sin
  su asignación: "solo para dos alumnos" sin sus filas sería para nadie, o para todo un grado).
    producto:   { tipo, nombre, grados: [text], modalidad, campo, fecha_entrega }
    asignacion: [{ alumno_id, modo }]
    ligar:      ids de sesiones_pda de ESA sesión
    crear:      [{ pda_id, grado }] del catálogo: se reutiliza el de la sesión o se crea
  → el producto (jsonb). origen 'maestro'; orden = el último de la sesión + 1.
*/
create or replace function public.agregar_producto_sesion(
  p_sesion uuid, p_producto jsonb, p_asignacion jsonb default '[]'::jsonb,
  p_ligar uuid[] default '{}'::uuid[], p_crear jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prod public.productos_sesion;
  v_orden smallint;
  v_spda uuid;
  r record;
begin
  if not exists (select 1 from public.sesiones where id = p_sesion and maestro_id = auth.uid()) then
    raise exception 'La sesión no existe o no es de tu cuenta' using errcode = '42501';
  end if;
  if coalesce(btrim(p_producto->>'nombre'), '') = '' then
    raise exception 'Escribe el nombre de la actividad o de la tarea' using errcode = 'P0001';
  end if;
  select least(coalesce(max(orden), 0) + 1, 32000) into v_orden from public.productos_sesion where sesion_id = p_sesion;

  insert into public.productos_sesion (sesion_id, maestro_id, tipo, nombre, grados, modalidad, campo, fecha_entrega, orden, origen, activo)
  values (
    p_sesion, auth.uid(), p_producto->>'tipo', p_producto->>'nombre',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_producto->'grados', '[]'::jsonb))), '{}'::text[]),
    coalesce(p_producto->>'modalidad', 'compartida'), p_producto->>'campo',
    nullif(p_producto->>'fecha_entrega', '')::date, v_orden, 'maestro', true)
  returning * into v_prod;

  if p_asignacion is not null and jsonb_typeof(p_asignacion) = 'array' and jsonb_array_length(p_asignacion) > 0 then
    insert into public.producto_sesion_alumnos (producto_sesion_id, alumno_id, maestro_id, modo)
    select v_prod.id, (f->>'alumno_id')::uuid, auth.uid(), f->>'modo'
    from jsonb_array_elements(p_asignacion) f
    on conflict (producto_sesion_id, alumno_id) do update set modo = excluded.modo;
  end if;
  -- Para alguien: sin grados, al menos un alumno incluido
  if cardinality(v_prod.grados) = 0 and not exists (
    select 1 from public.producto_sesion_alumnos where producto_sesion_id = v_prod.id and modo = 'incluir') then
    raise exception 'Elige para quién es la actividad' using errcode = 'P0001';
  end if;

  -- PDA de la sesión elegidos
  insert into public.producto_sesion_pda (producto_sesion_id, sesion_pda_id)
  select v_prod.id, sp.id from public.sesiones_pda sp
  where sp.sesion_id = p_sesion and sp.id = any (coalesce(p_ligar, '{}'::uuid[]))
  on conflict do nothing;

  -- PDA del catálogo: el de la sesión para ese grado o uno nuevo
  if p_crear is not null and jsonb_typeof(p_crear) = 'array' then
    for r in select distinct (f->>'pda_id')::uuid as pda_id, (f->>'grado')::int as grado from jsonb_array_elements(p_crear) f loop
      if r.pda_id is null or r.grado is null then continue; end if;
      select id into v_spda from public.sesiones_pda where sesion_id = p_sesion and pda_id = r.pda_id and grado = r.grado limit 1;
      if v_spda is null then
        insert into public.sesiones_pda (sesion_id, pda_id, grado, criterio_aplicado)
        values (p_sesion, r.pda_id, r.grado, null)
        on conflict (sesion_id, pda_id, grado) do nothing
        returning id into v_spda;
        if v_spda is null then
          select id into v_spda from public.sesiones_pda where sesion_id = p_sesion and pda_id = r.pda_id and grado = r.grado limit 1;
        end if;
      end if;
      insert into public.producto_sesion_pda (producto_sesion_id, sesion_pda_id) values (v_prod.id, v_spda) on conflict do nothing;
      v_spda := null;
    end loop;
  end if;

  return to_jsonb(v_prod);
end $$;

/*
  agregar_actividad_suelta(grupo, fecha, producto, asignacion, crear) — una actividad o tarea sin
  proyecto. Crea, si faltan, el contenedor "Actividades del trimestre" del grupo y su trimestre
  actual (tipo 'sueltas') y la sesión de esa fecha y ese campo; después agrega el producto
  (agregar_producto_sesion). fecha: el día en que se trabaja (en una tarea, el día en que se deja).
  → { producto, sesion, proyecto_id }
*/
create or replace function public.agregar_actividad_suelta(
  p_grupo uuid, p_fecha date, p_producto jsonb, p_asignacion jsonb default '[]'::jsonb, p_crear jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  g public.grupos;
  v_trim int;
  v_proy uuid;
  v_sesion public.sesiones;
  v_campo text;
  v_prod jsonb;
begin
  select * into g from public.grupos where id = p_grupo and maestro_id = auth.uid();
  if g.id is null then raise exception 'El grupo no existe o no es de tu cuenta' using errcode = '42501'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de la actividad' using errcode = 'P0001'; end if;
  v_campo := public.campo_largo(p_producto->>'campo');
  if v_campo is null then raise exception 'Elige el campo formativo' using errcode = 'P0001'; end if;
  v_trim := coalesce(g.trimestre_actual, 1);

  -- Uno por grupo y trimestre, aunque dos pantallas lo pidan a la vez
  perform pg_advisory_xact_lock(hashtext('sueltas|' || p_grupo::text));
  select id into v_proy from public.proyectos where grupo_id = p_grupo and tipo = 'sueltas' and trimestre = v_trim limit 1;
  if v_proy is null then
    insert into public.proyectos (maestro_id, grupo_id, trimestre, titulo, tipo, estado, grados, es_multigrado,
                                  fecha_inicial, fecha_final, visible_mercado)
    values (auth.uid(), p_grupo, v_trim, 'Actividades del trimestre', 'sueltas', 'completado', g.grados,
            coalesce(g.es_multigrado, false), p_fecha, p_fecha, false)
    returning id into v_proy;
  else
    update public.proyectos
      set fecha_final = greatest(coalesce(fecha_final, p_fecha), p_fecha),
          fecha_inicial = least(coalesce(fecha_inicial, p_fecha), p_fecha)
      where id = v_proy;
  end if;

  select * into v_sesion from public.sesiones
  where proyecto_id = v_proy and fecha = p_fecha and campo_formativo = v_campo
  order by numero_sesion limit 1;
  if v_sesion.id is null then
    insert into public.sesiones (proyecto_id, maestro_id, numero_sesion, fecha, campo_formativo, estado_sesion)
    values (v_proy, auth.uid(),
            (select coalesce(max(numero_sesion), 0) + 1 from public.sesiones where proyecto_id = v_proy),
            p_fecha, v_campo, 'activa')
    returning * into v_sesion;
  end if;

  v_prod := public.agregar_producto_sesion(v_sesion.id, p_producto, p_asignacion, '{}'::uuid[], p_crear);
  return jsonb_build_object('producto', v_prod, 'sesion', to_jsonb(v_sesion), 'proyecto_id', v_proy);
end $$;

/*
  mover_producto_a_sesion(producto, sesion, fecha_entrega) — "Pasar a un proyecto" una actividad
  suelta, sin perder nada:
    - solo desde el contenedor de sueltas, a una sesión de un proyecto normal del MISMO grupo y
      trimestre (sus calificaciones siguen en la misma boleta);
    - el producto cambia de sesión (con su "para quién", que cuelga del producto);
    - sus calificaciones cambian de sesión y proyecto (conservan todo lo capturado y su marca);
    - sus PDA: en la sesión destino se usa el mismo PDA y grado si ya está, o se crea; la
      evidencia automática se recalcula en los dos lados y lo ajustado a mano por la maestra
      (origen 'maestro') se pasa con él si ese PDA era solo de este producto;
    - una tarea sin fecha de entrega conserva el día en que se revisaba (p_fecha_entrega, que
      calcula la pantalla con el calendario del grupo);
    - la sesión suelta que queda sin productos ni evaluaciones se borra.
*/
create or replace function public.mover_producto_a_sesion(p_producto uuid, p_sesion uuid, p_fecha_entrega date default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prod public.productos_sesion;
  v_ses_old public.sesiones;
  v_ses_new public.sesiones;
  v_p_old public.proyectos;
  v_p_new public.proyectos;
  v_orden smallint;
  v_nuevo uuid;
  l record;
  c record;
  v_solo boolean;
begin
  select * into v_prod from public.productos_sesion where id = p_producto and maestro_id = auth.uid();
  if v_prod.id is null then raise exception 'La actividad no existe o no es de tu cuenta' using errcode = '42501'; end if;
  select * into v_ses_old from public.sesiones where id = v_prod.sesion_id;
  select * into v_p_old from public.proyectos where id = v_ses_old.proyecto_id;
  select * into v_ses_new from public.sesiones where id = p_sesion and maestro_id = auth.uid();
  if v_ses_new.id is null then raise exception 'La sesión destino no existe o no es de tu cuenta' using errcode = '42501'; end if;
  select * into v_p_new from public.proyectos where id = v_ses_new.proyecto_id;
  if v_p_old.tipo is distinct from 'sueltas' then
    raise exception 'Solo se pasan a un proyecto las actividades sueltas' using errcode = 'P0001';
  end if;
  if v_p_new.tipo is distinct from 'proyecto' or v_p_new.grupo_id is distinct from v_p_old.grupo_id then
    raise exception 'La sesión destino debe ser de un proyecto del mismo grupo' using errcode = 'P0001';
  end if;
  if v_p_new.trimestre is distinct from v_p_old.trimestre then
    raise exception 'La sesión destino debe ser de un proyecto del mismo trimestre (sus calificaciones van a la misma boleta)' using errcode = 'P0001';
  end if;
  if v_ses_new.id = v_ses_old.id then return to_jsonb(v_prod); end if;

  -- PDA: el mismo en la sesión destino (o uno nuevo) y la liga movida
  for l in
    select psp.sesion_pda_id as viejo, sp.pda_id, sp.grado, sp.criterio_aplicado
    from public.producto_sesion_pda psp join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
    where psp.producto_sesion_id = p_producto
  loop
    v_nuevo := null;
    if l.pda_id is not null then
      select id into v_nuevo from public.sesiones_pda where sesion_id = p_sesion and pda_id = l.pda_id and grado = l.grado limit 1;
    else
      select id into v_nuevo from public.sesiones_pda where sesion_id = p_sesion and pda_id is null and grado = l.grado
        and criterio_aplicado is not distinct from l.criterio_aplicado limit 1;
    end if;
    if v_nuevo is null then
      insert into public.sesiones_pda (sesion_id, pda_id, grado, criterio_aplicado)
      values (p_sesion, l.pda_id, l.grado, l.criterio_aplicado) returning id into v_nuevo;
    end if;
    select not exists (select 1 from public.producto_sesion_pda x where x.sesion_pda_id = l.viejo and x.producto_sesion_id <> p_producto)
      into v_solo;
    delete from public.producto_sesion_pda where producto_sesion_id = p_producto and sesion_pda_id = l.viejo;
    insert into public.producto_sesion_pda (producto_sesion_id, sesion_pda_id) values (p_producto, v_nuevo) on conflict do nothing;
    -- Lo que la maestra ajustó a mano en ese PDA se va con la actividad (si el PDA era solo suyo)
    if v_solo then
      update public.evaluacion_formativa ef
        set sesion_pda_id = v_nuevo, sesion_id = p_sesion
        where ef.sesion_pda_id = l.viejo and ef.origen = 'maestro'
          and not exists (select 1 from public.evaluacion_formativa e2
                          where e2.sesion_id = p_sesion and e2.alumno_id = ef.alumno_id and e2.criterio = ef.criterio);
    end if;
  end loop;

  select least(coalesce(max(orden), 0) + 1, 32000) into v_orden from public.productos_sesion where sesion_id = p_sesion;
  update public.productos_sesion
    set sesion_id = p_sesion, orden = v_orden,
        fecha_entrega = case when tipo = 'tarea' then coalesce(fecha_entrega, p_fecha_entrega) else fecha_entrega end
    where id = p_producto
    returning * into v_prod;

  update public.calificaciones set sesion_id = p_sesion, proyecto_id = v_p_new.id
    where producto_sesion_id = p_producto and maestro_id = auth.uid();

  -- Evidencia: se recalcula en los PDA viejos (sin este producto) y en los nuevos (con él)
  for c in
    select distinct cal.alumno_id, a.grado from public.calificaciones cal join public.alumnos a on a.id = cal.alumno_id
    where cal.producto_sesion_id = p_producto and cal.maestro_id = auth.uid()
  loop
    for l in
      select sp.id from public.sesiones_pda sp where sp.sesion_id = v_ses_old.id and sp.grado = c.grado
    loop
      perform public.recalcular_evidencia_pda(c.alumno_id, l.id, auth.uid());
    end loop;
    for l in
      select psp.sesion_pda_id as id from public.producto_sesion_pda psp join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
      where psp.producto_sesion_id = p_producto and sp.grado = c.grado
    loop
      perform public.recalcular_evidencia_pda(c.alumno_id, l.id, auth.uid());
    end loop;
  end loop;

  -- PDA de la sesión suelta que quedaron sin productos ni evaluaciones: fuera (si no, "Qué le
  -- falta" los pediría como PDA trabajados sin evidencia)
  delete from public.sesiones_pda sp
    where sp.sesion_id = v_ses_old.id
      and not exists (select 1 from public.producto_sesion_pda x where x.sesion_pda_id = sp.id)
      and not exists (select 1 from public.evaluacion_formativa e where e.sesion_pda_id = sp.id);
  -- La sesión suelta sin productos ni evaluaciones ya no existe (no reparte participación ese día)
  if not exists (select 1 from public.productos_sesion where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.evaluacion_formativa where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.sesiones_pda where sesion_id = v_ses_old.id)
     and not exists (select 1 from public.calificaciones where sesion_id = v_ses_old.id) then
    delete from public.sesiones where id = v_ses_old.id;
  end if;

  return to_jsonb(v_prod);
end $$;

-- ── 3b. "Quitar" un producto con calificaciones: nunca (revisor R25a-r09) ──────
-- Hoy revisa que nadie lo haya calificado antes de abrir el diálogo, pero otra pestaña o aparato
-- puede calificarlo mientras el diálogo está abierto: el producto quedaba inactivo y esa
-- calificación dejaba de contar, sin aviso. La base lo rechaza ahora (la pantalla también vuelve a
-- revisar justo antes). Mensaje en español con la clave 'producto_con_calificaciones' en el hint.
create or replace function public.productos_sesion_no_quitar_calificado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.activo is distinct from false and new.activo = false and exists (
    select 1 from public.calificaciones c
    where c.producto_sesion_id = new.id
      and (c.estado_entrega is not null or c.nivel is not null or c.puntaje is not null or nullif(c.retroalimentacion, '') is not null)
  ) then
    raise exception 'Mientras decidías, se calificó este producto; no se quitó.'
      using errcode = 'P0001', hint = 'producto_con_calificaciones';
  end if;
  return new;
end $$;
comment on function public.productos_sesion_no_quitar_calificado() is
  'Mi salón B17 (R25a-r09): un producto con calificaciones capturadas no se quita (activo = false): su calificación dejaría de contar sin aviso.';
drop trigger if exists productos_sesion_no_quitar_calificado on public.productos_sesion;
create trigger productos_sesion_no_quitar_calificado
  before update of activo on public.productos_sesion
  for each row execute function public.productos_sesion_no_quitar_calificado();

revoke all on function public.ref_asignacion_mismo_grupo(uuid, uuid) from public, anon;
revoke all on function public.alumno_recibe_producto(uuid, uuid) from public, anon;
revoke all on function public.guardar_asignacion_producto(uuid, jsonb) from public, anon;
revoke all on function public.agregar_producto_sesion(uuid, jsonb, jsonb, uuid[], jsonb) from public, anon;
revoke all on function public.agregar_actividad_suelta(uuid, date, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.mover_producto_a_sesion(uuid, uuid, date) from public, anon;
grant execute on function public.ref_asignacion_mismo_grupo(uuid, uuid) to authenticated;
grant execute on function public.alumno_recibe_producto(uuid, uuid) to authenticated;
grant execute on function public.campo_largo(text) to authenticated;
grant execute on function public.guardar_asignacion_producto(uuid, jsonb) to authenticated;
grant execute on function public.agregar_producto_sesion(uuid, jsonb, jsonb, uuid[], jsonb) to authenticated;
grant execute on function public.agregar_actividad_suelta(uuid, date, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.mover_producto_a_sesion(uuid, uuid, date) to authenticated;

-- ── 4. delete_own_account ────────────────────────────────────────────────────
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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
