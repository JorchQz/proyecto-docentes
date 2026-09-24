-- ════════════════════════════════════════════════════════════════════════════
-- Mi salón · b11 · Escala de 2°: de 5 a 10 (decisión 17b de Jorge, 2026-09-24)
--
-- Antes: la escala iba por FASE (Fase 3 = 1° y 2°: enteros de 6 a 10; Fases 4 y 5 =
-- 3° a 6°: de 5 a 10). Jorge decidió (17b, reemplaza a la 17) que 2° pase a 5 a 10,
-- con 5 no aprobatorio, como la boleta DGAIR de 2° ("promovido / no promovido"), las
-- guías de la AEFCM y SEIEM y el proyecto de sentencia de la SCJN (AR 419/2025).
-- 1° sigue de 6 a 10 (se acredita con haberlo cursado). La Fase 3 ya no decide la
-- escala: la decide el GRADO.
--
-- Qué cambia:
--   - piso_calificacion_boleta: 1° → 6; 2° a 6° → 5.
--   - calcular_calificacion_boleta y el trigger boleta_trimestral_piso_fase (función
--     boleta_trimestral_valida_piso) no cambian de lógica: los dos preguntan el piso a
--     piso_calificacion_boleta. Se vuelven a crear igual (create or replace) para que
--     este archivo deje los tres objetos juntos y en su versión vigente.
--   - El CHECK boleta_trimestral_calificacion_check (5 a 10) ya permitía el 5.
--
-- Boletas ya guardadas: nada se reescribe. Bajar el piso solo afloja la regla (una fila
-- de 2° con 6 sigue siendo válida) y las cerradas son inmutables (trigger
-- boleta_trimestral_cerrada_inmutable). Una boleta de 2° cerrada con la escala de 6 a 10
-- sigue mostrando esa escala: la foto del cierre (texto_autogenerado.cierre.alumno.escala)
-- la guardó.
--
-- En el código, la misma regla vive en js/reglas-entidad.js (pisoDeGrado) y todo lo
-- que rotula la escala la toma de ahí.
--
-- Aditivo e idempotente. Aplicado SOLO en pruebas (raoxdxwgsxbqlzdnndly) el 2026-09-24.
-- Producción: aplicarlo junto con el js (si el js llega antes, el selector ofrece 5 en
-- 2° y la base lo rechaza; si la base llega antes, la propuesta de 2° puede ser 5 con
-- los textos viejos de "6 a 10").
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.piso_calificacion_boleta(p_grado smallint)
returns smallint language sql immutable set search_path = public as $$
  select case when p_grado = 1 then 6::smallint
              when p_grado between 2 and 6 then 5::smallint end
$$;

create or replace function public.calcular_calificacion_boleta(p_porcentaje numeric, p_grado smallint)
returns smallint language plpgsql immutable set search_path = public as $$
declare v smallint;
begin
  if p_porcentaje is null then return null; end if;
  if p_grado is null or p_grado not between 1 and 6 then
    raise exception 'calcular_calificacion_boleta: grado inválido (%)', p_grado;
  end if;
  v := case when p_porcentaje >= 90 then 10
            when p_porcentaje >= 80 then 9
            when p_porcentaje >= 70 then 8
            when p_porcentaje >= 60 then 7
            when p_porcentaje >= 50 then 6
            else 5 end;
  return greatest(v, public.piso_calificacion_boleta(p_grado));
end $$;

create or replace function public.boleta_trimestral_valida_piso()
returns trigger language plpgsql security invoker set search_path = public as $$
declare g smallint;
begin
  if new.calificacion is null then return new; end if;
  select grado into g from public.alumnos where id = new.alumno_id;
  if g is not null and new.calificacion < public.piso_calificacion_boleta(g) then
    raise exception 'Calificación % inválida para % grado: el mínimo es %', new.calificacion, g, public.piso_calificacion_boleta(g)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- El trigger boleta_trimestral_piso_fase (before insert or update of calificacion,
-- alumno_id, for each row execute function boleta_trimestral_valida_piso) ya existe y
-- no cambia: usa la función de arriba. No se vuelve a crear.

grant execute on function public.calcular_calificacion_boleta(numeric, smallint) to authenticated;
grant execute on function public.piso_calificacion_boleta(smallint) to authenticated;
