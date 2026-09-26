-- Mi salón B13a: dos correcciones menores de la ficha del alumno (tras R20, 2026-09-26)
--
-- Solo aditiva: reemplaza la función del trigger de b13 (create or replace, misma firma) y agrega un
-- CHECK nuevo. No toca filas. Se puede correr dos veces. Va DESPUÉS de
-- mi_salon_b13_ficha_incidencias_2026-09.sql (si b13 se volviera a correr, regresaría la versión
-- con current_date: correr b13a otra vez). Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly).
--
-- 1. Fecha de nacimiento "no futura" con la fecha de MÉXICO. La versión de b13 comparaba contra
--    current_date, que en Supabase es la fecha UTC: de las 18:00 a las 23:59 de México (UTC-6, sin
--    horario de verano desde 2022) la base ya vive "mañana" y aceptaba como válida una fecha que en
--    México todavía es futura. Ahora compara contra (now() at time zone 'America/Mexico_City')::date.
--
-- 2. Teléfono del tutor con lada válida. b13 exige 10 dígitos; un número de 10 dígitos que empieza
--    con 0 o con 1 no existe en México (las ladas empiezan de 2 a 9) y se guardaba, por ejemplo
--    "1" + 9 dígitos. El CHECK nuevo alumnos_tutor_telefono_lada_valida exige que el primer dígito
--    sea de 2 a 9. La pantalla (js/ficha-alumno.js, normalizarTelefono) ya lo rechaza antes.
--    Antes de aplicarlo: 0 filas lo violaban en pruebas (0 fichas con teléfono) y en producción hay
--    0 fichas. Si al aplicarlo en producción hubiera alguna, el alter falla completo y no cambia
--    nada (se revisa a mano).

-- ── 1. Trigger de la fecha de nacimiento con la fecha de México ─────────────
create or replace function public.alumnos_fecha_nacimiento_no_futura()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.fecha_nacimiento is not null
     and new.fecha_nacimiento > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha de nacimiento no puede ser futura.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.alumnos_fecha_nacimiento_no_futura() from public, anon, authenticated;

-- El trigger ya existe (b13) y apunta a esta función; se recrea igual por si b13a corre sola
drop trigger if exists alumnos_fecha_nacimiento_no_futura on public.alumnos;
create trigger alumnos_fecha_nacimiento_no_futura
  before insert or update of fecha_nacimiento on public.alumnos
  for each row execute function public.alumnos_fecha_nacimiento_no_futura();

-- ── 2. Lada válida en el teléfono del tutor ──────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alumnos_tutor_telefono_lada_valida') then
    alter table public.alumnos add constraint alumnos_tutor_telefono_lada_valida
      check (tutor_telefono is null or tutor_telefono ~ '^[2-9][0-9]{9}$');
  end if;
end $$;

comment on column public.alumnos.tutor_telefono is 'Ficha (opcional): teléfono del tutor, 10 dígitos de México sin +52 y con lada de 2 a 9 (WhatsApp: wa.me/52 + este número).';
