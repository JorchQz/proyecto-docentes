-- Mi salón B.10 — "Eliminar cuenta" funciona (2026-09-24)
--
-- delete_own_account() solo borraba auth.users, pero 13 tablas apuntan a auth.users sin
-- borrado en cascada (maestro_ajustes, que crea el onboarding, calificaciones, boletas,
-- diagnóstico, registro diario, productos de sesión…): para cualquier maestro que hizo el
-- onboarding, la función fallaba. Lo encontró la revisión de privacidad.
--
-- Ahora borra primero los datos de Mi salón del maestro y después la cuenta (el resto se va
-- en cascada: perfiles, grupos, alumnos, asistencias, proyectos, sesiones).
-- Las cuentas con compras en la tienda NO se borran aquí: los registros de venta pueden
-- tener que conservarse (decisión pendiente de Jorge y su abogado); se pide escribir a
-- soporte. Reemplaza solo esta función; no borra datos de nadie más.

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

  delete from auth.users where id = v;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
