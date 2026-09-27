-- =============================================================================
-- Mi Salón b24 — Evidencia de PDA de un alumno INCLUIDO que trabaja con otro grado
-- (decisión de Jorge del 2026-09-27, proyecto PP-NIVELES de Fanny).
--
-- Caso: un alumno de 2° que esta semana trabaja en el Grupo Morado (lectoescritura) y en
-- Triángulos (matemáticas), con los de 1°. Sus trabajos de esos grupos SÍ cuentan en su boleta
-- de 2° y se evalúa según lo que sabe: con los PDA y criterios de 1° de la sesión. Sus PDA de 2°
-- de Lenguajes y Saberes quedan en proceso (sin evidencia esta semana).
--
-- Antes (b5, b17): la evidencia de PDA se dejaba solo en los PDA ligados al producto que son del
-- GRADO DEL ALUMNO. Un alumno incluido de otro grado en un producto sin PDA de su grado no dejaba
-- evidencia (su calificación sí contaba para la boleta).
--
-- Ahora, UNA regla (pda_de_alumno_en_producto), la usan la propagación y el retiro:
--   1. Los PDA ligados al producto que son de su grado (igual que antes).
--   2. Si el producto no tiene ninguno de su grado y el alumno está INCLUIDO (¿Para quién?,
--      producto_sesion_alumnos.modo = 'incluir'), los PDA ligados al producto: los del grado
--      con que trabaja. Un alumno de ese grado que no está incluido no cambia.
-- La evidencia queda en el sesiones_pda de ese grado (v_avance_pda lo muestra con su PDA y su
-- criterio); el alumno sigue en su grado oficial para la boleta.
--
-- Límite conocido: mover_producto_a_sesion (b19a, "Pasar a un proyecto" de una actividad
-- suelta) sigue recalculando por el grado del alumno; una actividad suelta con un incluido de
-- otro grado que se pasa a un proyecto no mueve esa evidencia (caso raro; se corrige si hace falta).
--
-- Aditiva e idempotente: create or replace de dos funciones de trigger y una función nueva. No
-- cambia tablas ni políticas.
--
-- ORDEN: va DESPUÉS de b23, en la MISMA transacción que las otras migraciones del lanzamiento
-- (docs/PRODUCCION-MI-SALON.md, paso 1); no redefine delete_own_account (la versión final sigue
-- siendo la de b23). Solo con el visto bueno de Jorge.
--
-- Permisos (como b23 con las admin_): pda_de_alumno_en_producto no se ejecuta por anon ni por
-- PUBLIC. La llaman los triggers de calificaciones, que corren con el rol de quien califica
-- (authenticated desde la app, service_role desde una función): esos dos la conservan. Es
-- "security invoker": leída directo, solo ve lo que las políticas RLS le dejan ver a quien la llama.
-- =============================================================================

create or replace function public.pda_de_alumno_en_producto(p_alumno uuid, p_producto uuid)
returns setof uuid
language sql
stable
set search_path = public
as $$
  with suyo as (
    select a.grado from public.alumnos a where a.id = p_alumno
  ), ligados as (
    select psp.sesion_pda_id, sp.grado
    from public.producto_sesion_pda psp
    join public.sesiones_pda sp on sp.id = psp.sesion_pda_id
    where psp.producto_sesion_id = p_producto
  )
  select l.sesion_pda_id from ligados l join suyo s on l.grado = s.grado
  union
  select l.sesion_pda_id from ligados l
  where not exists (select 1 from ligados l2 join suyo s on l2.grado = s.grado)
    and exists (
      select 1 from public.producto_sesion_alumnos x
      where x.producto_sesion_id = p_producto and x.alumno_id = p_alumno and x.modo = 'incluir'
    )
$$;
comment on function public.pda_de_alumno_en_producto(uuid, uuid) is
  'Mi Salón b24: los PDA en que deja evidencia un alumno al calificarle un producto: los de su grado ligados al producto; si no hay y está incluido (¿Para quién?), los ligados al producto (los del grado con que trabaja).';
-- Sin anon ni PUBLIC; los triggers de calificaciones corren como authenticated o service_role
revoke all on function public.pda_de_alumno_en_producto(uuid, uuid) from public, anon;
grant execute on function public.pda_de_alumno_en_producto(uuid, uuid) to authenticated, service_role;

create or replace function public.propagar_calificacion_a_pda()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare r record;
begin
  if new.producto_sesion_id is null then return null; end if;
  for r in select x as sesion_pda_id from public.pda_de_alumno_en_producto(new.alumno_id, new.producto_sesion_id) x
  loop
    perform public.recalcular_evidencia_pda(new.alumno_id, r.sesion_pda_id, new.maestro_id);
  end loop;
  -- Si la calificación cambió de producto, el PDA del producto anterior también se recalcula
  if tg_op = 'UPDATE' and old.producto_sesion_id is distinct from new.producto_sesion_id and old.producto_sesion_id is not null then
    for r in select x as sesion_pda_id from public.pda_de_alumno_en_producto(old.alumno_id, old.producto_sesion_id) x
    loop
      perform public.recalcular_evidencia_pda(old.alumno_id, r.sesion_pda_id, old.maestro_id);
    end loop;
  end if;
  return null;
end $function$;

create or replace function public.retirar_evidencia_de_pda()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare r record;
begin
  if old.producto_sesion_id is null then return null; end if;
  -- Borrar una calificación ya no borra a ciegas: se recalcula con las que quedan
  for r in select x as sesion_pda_id from public.pda_de_alumno_en_producto(old.alumno_id, old.producto_sesion_id) x
  loop
    perform public.recalcular_evidencia_pda(old.alumno_id, r.sesion_pda_id, old.maestro_id);
  end loop;
  return null;
end $function$;
