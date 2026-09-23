-- Mi salón B.8 — Cierre de boleta atómico e inmutable (2026-09-23, ensayo 3.10 FAIL #6)
--
-- 1. cerrar_boleta(): guarda la foto del cierre (fila GEN) y cierra los cuatro campos en UNA
--    transacción. Antes eran dos escrituras desde el navegador: si la red se caía entre las
--    dos, la boleta quedaba cerrada sin foto y los reportes volvían a leer los datos de hoy.
-- 2. boleta_trimestral_cerrada_inmutable: una fila cerrada no se modifica, y la fila GEN
--    tampoco una vez cerrados los cuatro campos. Antes una pestaña abierta antes del
--    cierre podía cambiar la calificación de una boleta cerrada.
-- Aditiva: función y trigger nuevos. Al aplicarla no había boletas fuera de las cuentas QA.

create or replace function public.cerrar_boleta(
  p_alumno uuid, p_ciclo text, p_trimestre smallint, p_calificaciones jsonb, p_foto jsonb
) returns void
language plpgsql
security invoker            -- RLS: solo filas del maestro que llama
set search_path = public
as $$
declare
  v_maestro uuid := auth.uid();
  c record;
  n int := 0;
begin
  if v_maestro is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_calificaciones) <> 'array' then
    raise exception 'Calificaciones inválidas' using errcode = 'check_violation';
  end if;

  -- La foto primero: el trigger no deja tocar la fila GEN después de cerrar los campos
  insert into public.boleta_trimestral (maestro_id, alumno_id, ciclo, trimestre, campo, texto_autogenerado)
  values (v_maestro, p_alumno, p_ciclo, p_trimestre, 'GEN', jsonb_build_object('cierre', p_foto))
  on conflict (maestro_id, alumno_id, ciclo, trimestre, campo) do update
    set texto_autogenerado = coalesce(public.boleta_trimestral.texto_autogenerado, '{}'::jsonb)
                             || jsonb_build_object('cierre', p_foto);

  for c in
    select x.campo, x.calificacion
    from jsonb_to_recordset(p_calificaciones) as x(campo text, calificacion smallint)
  loop
    if c.campo not in ('LEN', 'SAB', 'ETI', 'DHL') or c.calificacion is null then
      raise exception 'Calificación inválida para %', c.campo using errcode = 'check_violation';
    end if;
    insert into public.boleta_trimestral
      (maestro_id, alumno_id, ciclo, trimestre, campo, calificacion, calificacion_confirmada, cerrada)
    values (v_maestro, p_alumno, p_ciclo, p_trimestre, c.campo, c.calificacion, true, true)
    on conflict (maestro_id, alumno_id, ciclo, trimestre, campo) do update
      set calificacion = excluded.calificacion, calificacion_confirmada = true, cerrada = true;
    n := n + 1;
  end loop;

  if n <> 4 then
    raise exception 'Para cerrar se necesitan los cuatro campos (llegaron %)', n using errcode = 'check_violation';
  end if;
end $$;

revoke all on function public.cerrar_boleta(uuid, text, smallint, jsonb, jsonb) from public, anon;
grant execute on function public.cerrar_boleta(uuid, text, smallint, jsonb, jsonb) to authenticated;

create or replace function public.boleta_trimestral_cerrada_inmutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.cerrada then
    raise exception 'La boleta está cerrada: ya no se puede modificar' using errcode = 'check_violation';
  end if;
  if old.campo = 'GEN' and (
    select count(*) from public.boleta_trimestral b
    where b.maestro_id = old.maestro_id and b.alumno_id = old.alumno_id
      and b.ciclo = old.ciclo and b.trimestre = old.trimestre
      and b.campo in ('LEN', 'SAB', 'ETI', 'DHL') and b.cerrada
  ) = 4 then
    raise exception 'La boleta está cerrada: ya no se puede modificar' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists boleta_trimestral_cerrada_inmutable on public.boleta_trimestral;
create trigger boleta_trimestral_cerrada_inmutable
  before update on public.boleta_trimestral
  for each row execute function public.boleta_trimestral_cerrada_inmutable();
