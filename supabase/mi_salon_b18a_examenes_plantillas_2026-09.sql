-- Mi salón B18a — Las plantillas de examen del catálogo ya no se pueden "reclamar" (R25a, 2026-09-26)
--
-- Solo reemplaza UNA política; no toca filas ni columnas. Se puede correr dos veces. Independiente
-- de b18 (se puede aplicar antes o después). Aplicada SOLO en PRUEBAS (raoxdxwgsxbqlzdnndly).
--
-- El problema: la política UPDATE "examenes reclamar/editar" tenía
--   USING (maestro_id = auth.uid() OR maestro_id IS NULL)  WITH CHECK (maestro_id = auth.uid())
-- así que cualquier cuenta (o una pestaña con el código de antes de R23) podía hacer UPDATE de una
-- plantilla del catálogo (maestro_id null), ponerse como dueña y dejar de mostrarla a las demás.
-- Desde R23 "aplicar" inserta una COPIA y desde el 2026-09-26 el catálogo ya no se ofrece en Mi Salón
-- (se vende en la tienda; decisión de Jorge): ninguna pantalla necesita actualizar una plantilla.
--
-- Ahora: cada maestra solo actualiza SUS exámenes. Las plantillas (maestro_id null) siguen
-- LEGIBLES para todas (política "examenes visibles (propios o plantilla)", sin cambios) y nadie con
-- sesión de maestra las puede editar ni borrar (la de borrar ya era solo maestro_id = auth.uid()).
-- Las administran Jorge o el generador con la llave de servicio (sin RLS).
--
-- La restrictiva examenes_refs_propias_upd (b9: el grupo debe ser propio) se queda igual.

drop policy if exists "examenes reclamar/editar" on public.examenes;
drop policy if exists "examenes editar propios" on public.examenes;
create policy "examenes editar propios" on public.examenes
  as permissive for update to authenticated
  using (maestro_id = (select auth.uid()))
  with check (maestro_id = (select auth.uid()));

-- Verificación (debe dar una sola política de UPDATE permisiva, sin "maestro_id IS NULL"):
-- select policyname, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'examenes' and cmd = 'UPDATE';
