-- =============================================================================
-- Mi Salón b21c: acceso PILOTO del ciclo 2026-2027 para las cuentas QA (SOLO PRUEBAS,
-- proyecto raoxdxwgsxbqlzdnndly). En producción se usa b21b.
-- =============================================================================
-- También restaura el piloto de QA2 después de las pruebas de vencimiento: borra los
-- regalos de prueba (notas que empiezan con "QA b21") y deja el piloto con T1, T2 y T3.

delete from public.mi_salon_accesos a
 using auth.users u
 where u.id = a.docente_id
   and lower(u.email) in ('qa.misalon@jissez.com', 'qa.aislamiento@jissez.com')
   and a.notas like 'QA b21%';

with cuentas as (
  select u.id, u.created_at from auth.users u
   where lower(u.email) in ('qa.misalon@jissez.com', 'qa.aislamiento@jissez.com')
),
ampliadas as (
  update public.mi_salon_accesos a
     set periodos = array['T1', 'T2', 'T3'], vence_fijo = null,
         desde = least(a.desde, timestamptz '2026-08-31 00:00:00-06')
    from cuentas c
   where a.docente_id = c.id and a.ciclo = '2026-2027' and a.origen = 'piloto'
  returning a.docente_id
)
insert into public.mi_salon_accesos (docente_id, ciclo, periodos, origen, desde, notas)
select c.id, '2026-2027', array['T1', 'T2', 'T3'], 'piloto',
       least(c.created_at, timestamptz '2026-08-31 00:00:00-06'), 'Piloto de Mi Salón (cuentas QA, b21c)'
  from cuentas c
 where not exists (select 1 from ampliadas x where x.docente_id = c.id)
on conflict do nothing;

select u.email, a.origen, a.periodos, public.mi_salon_vence(a) as vence
  from public.mi_salon_accesos a join auth.users u on u.id = a.docente_id
 where lower(u.email) in ('qa.misalon@jissez.com', 'qa.aislamiento@jissez.com')
 order by u.email, a.origen;
