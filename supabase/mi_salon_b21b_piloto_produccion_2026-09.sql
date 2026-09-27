-- =============================================================================
-- Mi Salón b21b: acceso PILOTO del ciclo 2026-2027 para las cuentas del piloto (PRODUCCIÓN)
-- =============================================================================
--
-- SOLO SE APLICA CON LA CONFIRMACIÓN DE JORGE, después de b21 (mi_salon_b21_acceso_2026-09.sql).
--
-- Da el acceso `piloto` a todo el ciclo 2026-2027 (T1, T2 y T3: vence el 30 de julio de 2027,
-- leído de mi_salon_periodos) a:
--   - soporte.jissez@gmail.com   (la cuenta de soporte / administración)
--   - sarayval034@gmail.com      (Fanny, docente del piloto)
-- Las cuentas QA viven en el proyecto de pruebas (mi_salon_b21c_piloto_pruebas_2026-09.sql).
--
-- Idempotente: si la cuenta ya tiene su piloto del ciclo, se amplía a los tres periodos; si
-- un correo no tiene cuenta, no pasa nada (el resultado dice cuántas filas quedaron).
-- No toca perfiles.activo_saas: esas cuentas ya lo tienen y lo siguen teniendo.
--
-- Para sumar después a otra docente al piloto: panel de administración → Mi Salón → Dar
-- acceso, con "Piloto" (o este mismo SQL con su correo).
-- =============================================================================

with cuentas as (
  select u.id, u.created_at from auth.users u
   where lower(u.email) in ('soporte.jissez@gmail.com', 'sarayval034@gmail.com')
),
ampliadas as (
  update public.mi_salon_accesos a
     set periodos = array['T1', 'T2', 'T3']
    from cuentas c
   where a.docente_id = c.id and a.ciclo = '2026-2027' and a.origen = 'piloto'
  returning a.docente_id
)
insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, desde, notas)
select c.id, '2026-2027', array['T1', 'T2', 'T3'], 'piloto',
       least(c.created_at, timestamptz '2026-08-31 00:00:00-06'), 'Piloto de Mi Salón (b21b)'
  from cuentas c
 where not exists (select 1 from ampliadas x where x.docente_id = c.id)
on conflict do nothing;

-- Comprobación: debe salir una fila por cuenta, origen piloto, vence 2027-07-30
select u.email, a.origen, a.periodos, public.mi_salon_vence(a) as vence
  from public.mi_salon_accesos a join auth.users u on u.id = a.docente_id
 where a.origen = 'piloto' and a.ciclo = '2026-2027'
   and lower(u.email) in ('soporte.jissez@gmail.com', 'sarayval034@gmail.com');
