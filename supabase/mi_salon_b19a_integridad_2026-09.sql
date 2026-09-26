-- Mi salón B19a — Integridad de calificaciones, exámenes y actividades; delete_own_account completa
-- (revisores R26a y R26b, 2026-09-26)
--
-- Solo aditiva: funciones, triggers y políticas RESTRICTIVE nuevas; dos funciones reemplazadas
-- (mover_producto_a_sesion, igual a la de b17 más dos líneas, y delete_own_account, la de b19 más
-- dos tablas). No borra ni cambia filas, columnas ni políticas existentes. Se puede correr dos
-- veces ("create or replace" / "drop ... if exists" solo sobre lo que crea este archivo).
-- Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly). En producción, con la confirmación de Jorge.
--
-- ORDEN: va AL FINAL, después de jissez_interes_secciones → b16 → b17 → b18 → b18a → b19. Usa las
-- tablas de b17 (proyectos.tipo, productos_sesion) y de b18/b19 (examen_*), y su delete_own_account
-- es la versión más completa: si después se volviera a correr interes, b17, b18 o b19, habría que
-- correr b19a otra vez (pruebas/migraciones-orden.test.js comprueba que la de b19a contiene todo lo
-- de las anteriores). No depende del frontend: se puede aplicar antes o después de publicarlo (el
-- frontend de b4c6958 escribe filas coherentes y no mueve productos ni preguntas).
--
-- Consulta previa en producción (debe dar 0 en todo; una fila ya incoherente no se podría
-- actualizar después): ver la verificación al final del archivo.
--
-- 1. Calificación en un producto quitado (R26a, c1-carreras b). Una pestaña quita un producto
--    (activo = false) y otra, sin recargar, lo califica: la fila se guardaba en un producto inactivo,
--    sin aviso, y no contaba. Ahora el trigger calificaciones_desde_producto (BEFORE INSERT OR
--    UPDATE) la rechaza con errcode P0001, mensaje «Esta actividad se quitó en otra pantalla; tu
--    captura no se aplicó.» y hint 'producto_inactivo'. La cola sin señal (js/bandeja-salida.js) lo
--    trata como rechazo definitivo (sale de la cola, se avisa) y Hoy quita esa actividad de la
--    pantalla. La fila del producto se lee FOR SHARE: una calificación y un "Quitar" simultáneos
--    se ordenan (el "Quitar" espera y su trigger de b17 ve la calificación, o la calificación espera
--    y ve el producto inactivo).
--
-- 2. Calificación con la sesión y el proyecto viejos (R26a, menor). Si se califica una actividad
--    suelta que otra pantalla ya pasó a un proyecto, la fila traía la sesión y el proyecto del
--    contenedor de sueltas. El mismo trigger toma SIEMPRE sesion_id y proyecto_id del producto.
--
-- 3. Referencias del mismo grupo (R26a, s02-rls-refs; seguridad, con llamadas a la API armadas a
--    mano). Las políticas de b9 ("refs_propias") solo exigen que cada referencia sea de la cuenta;
--    faltaba que fueran del MISMO grupo o examen:
--    a) calificaciones: el alumno y el producto son del mismo grupo, y grupo_id es ese grupo
--       (sin producto: el alumno es del grupo). Esto ya se podía antes de esta rama: desde b9 las
--       políticas de calificaciones solo revisan que alumno, grupo, sesión, proyecto y producto
--       sean propios, no que coincidan entre sí. Políticas RESTRICTIVE calificaciones_mismo_grupo_*.
--    b) examen_respuestas: el examen_id de la fila es el examen de su pregunta, y ese examen es
--       "propio" (no de solo resultados). Políticas RESTRICTIVE examen_respuestas_mismo_examen_*.
--       Además examen_id no cambia (trigger examen_respuestas_examen_fijo).
--    c) examen_preguntas: examen_id no cambia (trigger examen_preguntas_examen_fijo). Una pregunta
--       movida a otro examen dejaba sus respuestas colgando de alumnos de otro grupo.
--    d) productos_sesion.sesion_id solo cambia con mover_producto_a_sesion ("Pasar a un
--       proyecto"), que valida grupo, trimestre y tipo y mueve con él calificaciones, asignación y
--       PDA. La función marca el cambio con una variable local de la transacción
--       (jissez.mover_producto = id del producto) y el trigger productos_sesion_sesion_fija rechaza
--       cualquier otro cambio de sesión. La variable no se puede fijar desde la API (PostgREST solo
--       expone funciones de public; set_config es de pg_catalog) y cada petición es su propia
--       transacción. Ninguna pantalla cambia sesion_id de otro modo (js/sesiones-materializar.js
--       solo actualiza campo y modalidad).
--
-- 4. delete_own_account (R26b): dos huecos que ya había antes de esta rama.
--    - marketplace_busquedas_vacias (user_id) no se borraba: quedaba la fila (el usuario sí se
--      borraba; user_id sin llave foránea).
--    - productos_finales (tabla legada, sin pantalla que la escriba) con grupo_id de la cuenta hacía
--      FALLAR el borrado (productos_finales_grupo_id_fkey sin cascada).
--    Se agregan, cada uno con guarda to_regclass. Es la versión COMPLETA: la de b19 más esas dos.
--    Nota para la fusión: los constructores AK y AL también la redefinen en sus ramas; al unir,
--    la versión final debe contener TODO lo de esta (marcas @@delete_own_account).
--
-- 5. campo_largo(text) (b17) ya no se puede llamar sin sesión (anon/public): solo la usa
--    agregar_actividad_suelta, que corre como authenticated (security invoker).

-- ── 1 y 2. calificaciones: producto activo; sesión y proyecto del producto ──────
create or replace function public.calificaciones_desde_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_activo boolean;
  v_sesion uuid;
  v_proyecto uuid;
begin
  if new.producto_sesion_id is null then
    return new;
  end if;
  -- security invoker: un producto de otra cuenta no se ve aquí (lo rechazan las políticas de b9)
  select ps.activo, ps.sesion_id, s.proyecto_id
    into v_activo, v_sesion, v_proyecto
    from public.productos_sesion ps
    join public.sesiones s on s.id = ps.sesion_id
    where ps.id = new.producto_sesion_id
    for share of ps;
  if not found then
    return new;
  end if;
  if v_activo = false then
    raise exception 'Esta actividad se quitó en otra pantalla; tu captura no se aplicó.'
      using errcode = 'P0001', hint = 'producto_inactivo';
  end if;
  new.sesion_id := v_sesion;
  new.proyecto_id := v_proyecto;
  return new;
end $$;
comment on function public.calificaciones_desde_producto() is
  'Mi salón B19a: una calificación no se guarda en un producto quitado (hint producto_inactivo) y toma siempre la sesión y el proyecto de su producto.';
revoke all on function public.calificaciones_desde_producto() from public, anon, authenticated;

drop trigger if exists calificaciones_desde_producto on public.calificaciones;
create trigger calificaciones_desde_producto
  before insert or update on public.calificaciones
  for each row execute function public.calificaciones_desde_producto();

-- ── 3a. calificaciones: alumno, producto y grupo del mismo grupo ──────────────
create or replace function public.ref_calificacion_mismo_grupo(p_producto uuid, p_alumno uuid, p_grupo uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_producto is null then
    if exists (select 1 from public.alumnos a
               where a.id = p_alumno and a.grupo_id = p_grupo and a.maestro_id = auth.uid()) then
      return true;
    end if;
  elsif exists (
    select 1
    from public.productos_sesion ps
    join public.sesiones s on s.id = ps.sesion_id
    join public.proyectos p on p.id = s.proyecto_id
    join public.alumnos a on a.id = p_alumno
    where ps.id = p_producto and ps.maestro_id = auth.uid() and a.maestro_id = auth.uid()
      and a.grupo_id = p.grupo_id and p.grupo_id = p_grupo
  ) then
    return true;
  end if;
  raise exception 'El alumno no es del grupo de esta actividad' using errcode = '42501';
end $$;
comment on function public.ref_calificacion_mismo_grupo(uuid, uuid, uuid) is
  'Mi salón B19a: el alumno, el producto (su proyecto) y el grupo de una calificación son del mismo grupo.';
revoke all on function public.ref_calificacion_mismo_grupo(uuid, uuid, uuid) from public, anon;
grant execute on function public.ref_calificacion_mismo_grupo(uuid, uuid, uuid) to authenticated;

drop policy if exists calificaciones_mismo_grupo_ins on public.calificaciones;
create policy calificaciones_mismo_grupo_ins on public.calificaciones as restrictive for insert
  to authenticated
  with check (public.ref_calificacion_mismo_grupo(producto_sesion_id, alumno_id, grupo_id));
drop policy if exists calificaciones_mismo_grupo_upd on public.calificaciones;
create policy calificaciones_mismo_grupo_upd on public.calificaciones as restrictive for update
  to authenticated
  using (true)
  with check (public.ref_calificacion_mismo_grupo(producto_sesion_id, alumno_id, grupo_id));

-- ── 3b. examen_respuestas: la pregunta es de ese examen y el examen es "propio" ──
create or replace function public.ref_respuesta_mismo_examen(p_examen uuid, p_pregunta uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.examen_preguntas p
    join public.examenes_grupo e on e.id = p.examen_id
    where p.id = p_pregunta and p.examen_id = p_examen
      and e.modo = 'propio' and e.maestro_id = auth.uid()
  ) then
    return true;
  end if;
  raise exception 'La pregunta no es de este examen' using errcode = '42501';
end $$;
comment on function public.ref_respuesta_mismo_examen(uuid, uuid) is
  'Mi salón B19a: una respuesta va al examen de su pregunta, y ese examen es de preguntas propias (no de solo resultados).';
revoke all on function public.ref_respuesta_mismo_examen(uuid, uuid) from public, anon;
grant execute on function public.ref_respuesta_mismo_examen(uuid, uuid) to authenticated;

drop policy if exists examen_respuestas_mismo_examen_ins on public.examen_respuestas;
create policy examen_respuestas_mismo_examen_ins on public.examen_respuestas as restrictive for insert
  to authenticated
  with check (public.ref_respuesta_mismo_examen(examen_id, pregunta_id));
drop policy if exists examen_respuestas_mismo_examen_upd on public.examen_respuestas;
create policy examen_respuestas_mismo_examen_upd on public.examen_respuestas as restrictive for update
  to authenticated
  using (true)
  with check (public.ref_respuesta_mismo_examen(examen_id, pregunta_id));

-- ── 3b y 3c. Una respuesta o una pregunta no cambia de examen ──────────────────
create or replace function public.examen_hijo_examen_fijo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.examen_id is distinct from old.examen_id then
    if tg_table_name = 'examen_preguntas' then
      raise exception 'Una pregunta no cambia de examen.' using errcode = 'check_violation';
    end if;
    raise exception 'Una respuesta no cambia de examen.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
comment on function public.examen_hijo_examen_fijo() is
  'Mi salón B19a: examen_preguntas.examen_id y examen_respuestas.examen_id no cambian.';
revoke all on function public.examen_hijo_examen_fijo() from public, anon, authenticated;

drop trigger if exists examen_preguntas_examen_fijo on public.examen_preguntas;
create trigger examen_preguntas_examen_fijo
  before update of examen_id on public.examen_preguntas
  for each row execute function public.examen_hijo_examen_fijo();
drop trigger if exists examen_respuestas_examen_fijo on public.examen_respuestas;
create trigger examen_respuestas_examen_fijo
  before update of examen_id on public.examen_respuestas
  for each row execute function public.examen_hijo_examen_fijo();

-- ── 3d. productos_sesion.sesion_id solo cambia con mover_producto_a_sesion ─────
create or replace function public.productos_sesion_sesion_fija()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sesion_id is distinct from old.sesion_id
     and pg_catalog.current_setting('jissez.mover_producto', true) is distinct from new.id::text then
    raise exception 'Una actividad solo cambia de sesión con «Pasar a un proyecto».'
      using errcode = 'check_violation', hint = 'producto_sesion_fija';
  end if;
  return new;
end $$;
comment on function public.productos_sesion_sesion_fija() is
  'Mi salón B19a: productos_sesion.sesion_id solo cambia dentro de mover_producto_a_sesion (variable local jissez.mover_producto).';
revoke all on function public.productos_sesion_sesion_fija() from public, anon, authenticated;

drop trigger if exists productos_sesion_sesion_fija on public.productos_sesion;
create trigger productos_sesion_sesion_fija
  before update of sesion_id on public.productos_sesion
  for each row execute function public.productos_sesion_sesion_fija();

/*
  mover_producto_a_sesion: la MISMA de b17, letra por letra, más dos líneas (marcadas "b19a"):
  antes de cambiar la sesión del producto fija jissez.mover_producto (local a la transacción) y
  después la limpia. Sin esa marca, el trigger productos_sesion_sesion_fija rechaza el cambio.
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
  -- b19a: la única vía para cambiar productos_sesion.sesion_id (trigger productos_sesion_sesion_fija)
  perform pg_catalog.set_config('jissez.mover_producto', p_producto::text, true);
  update public.productos_sesion
    set sesion_id = p_sesion, orden = v_orden,
        fecha_entrega = case when tipo = 'tarea' then coalesce(fecha_entrega, p_fecha_entrega) else fecha_entrega end
    where id = p_producto
    returning * into v_prod;
  perform pg_catalog.set_config('jissez.mover_producto', '', true); -- b19a

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
revoke all on function public.mover_producto_a_sesion(uuid, uuid, date) from public, anon;
grant execute on function public.mover_producto_a_sesion(uuid, uuid, date) to authenticated;

-- ── 5. campo_largo: solo con sesión ─────────────────────────────────────────
revoke all on function public.campo_largo(text) from public, anon;
grant execute on function public.campo_largo(text) to authenticated;

-- ── 4. delete_own_account (versión COMPLETA: la de b19 más marketplace_busquedas_vacias y
--    productos_finales; ver la nota de la fusión arriba) ─────────────────────
-- @@delete_own_account inicio (b19a)
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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- @@delete_own_account fin

-- ── Verificación (correr ANTES de aplicar en producción; todo debe dar 0) ─────
-- select
--   (select count(*) from public.calificaciones c
--      join public.productos_sesion ps on ps.id = c.producto_sesion_id
--      join public.sesiones s on s.id = ps.sesion_id
--      join public.proyectos p on p.id = s.proyecto_id
--      join public.alumnos a on a.id = c.alumno_id
--     where a.grupo_id <> p.grupo_id or c.grupo_id <> p.grupo_id)            as cal_otro_grupo,
--   (select count(*) from public.calificaciones c join public.alumnos a on a.id = c.alumno_id
--     where c.producto_sesion_id is null and a.grupo_id <> c.grupo_id)        as cal_sin_producto_otro_grupo,
--   (select count(*) from public.calificaciones c
--      join public.productos_sesion ps on ps.id = c.producto_sesion_id
--     where not ps.activo)                                                    as cal_en_inactivos,
--   (select count(*) from public.examen_respuestas r
--      join public.examen_preguntas p on p.id = r.pregunta_id
--      join public.examenes_grupo e on e.id = r.examen_id
--     where r.examen_id <> p.examen_id or e.modo <> 'propio')                 as respuestas_otro_examen;
-- (Las columnas sesion_id/proyecto_id desfasadas no bloquean nada: el trigger las corrige en la
-- siguiente escritura de la fila.)
