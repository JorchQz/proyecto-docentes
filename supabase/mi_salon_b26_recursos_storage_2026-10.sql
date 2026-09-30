-- =============================================================================
-- Mi Salón b26: el bucket `recursos` (archivos de Crear proyecto) solo para la cuenta que los subió
-- (hallazgo del constructor AX del 2026-09-29, confirmado en producción por el coordinador)
-- =============================================================================
--
-- Problema: las tres políticas del bucket privado `recursos` en storage.objects
-- (recursos_select_autenticado, recursos_upload_autenticado, recursos_delete_autenticado) eran
-- para {public} con `bucket_id = 'recursos' and auth.role() = 'authenticated'`: CUALQUIER cuenta
-- con sesión (también un comprador de la tienda) podía listar, descargar, subir y borrar los
-- archivos de cualquier docente.
--
-- Qué hace:
--   1. Quita esas tres políticas.
--   2. Crea SELECT y DELETE solo para la cuenta que subió el archivo. Las rutas son
--        recursos/<uid>/<carpeta>/sesion_N/<archivo>    (dentro del bucket `recursos`)
--      así que (storage.foldername(name))[1] = 'recursos' y [2] = <uid>. El docente sigue viendo
--      y quitando en Crear proyecto los "Archivos que subiste antes"; nadie más los ve.
--   3. NO crea política de INSERT: Mi Salón solo guarda enlaces (decisión de Jorge del
--      2026-09-29; Crear proyecto ya no sube archivos). Sin política, subir falla para todos.
--      Cuando se lance el almacenamiento, la política de la propia cuenta sería (con su UPDATE
--      si hiciera falta sobrescribir):
--
--        create policy "recursos: subida de la propia cuenta" on storage.objects
--          for insert to authenticated
--          with check (bucket_id = 'recursos' and (storage.foldername(name))[2] = auth.uid()::text);
--
-- No toca objetos (los que ya existen se quedan; sus URL firmadas siguen sirviendo hasta que
-- vencen: no pasan por estas políticas), ni el bucket, ni el bucket `assets` ni sus políticas.
-- Idempotente (drop if exists + create). Sin begin/commit: el script de aplicación la envuelve en
-- su transacción. No depende de ninguna otra migración de Mi Salón ni redefine
-- delete_own_account: se puede aplicar sola, en cualquier momento.
-- =============================================================================

drop policy if exists "recursos_select_autenticado" on storage.objects;
drop policy if exists "recursos_upload_autenticado" on storage.objects;
drop policy if exists "recursos_delete_autenticado" on storage.objects;

drop policy if exists "recursos: lectura de la propia cuenta" on storage.objects;
create policy "recursos: lectura de la propia cuenta" on storage.objects
  for select to authenticated
  using (bucket_id = 'recursos' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "recursos: borrado de la propia cuenta" on storage.objects;
create policy "recursos: borrado de la propia cuenta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recursos' and (storage.foldername(name))[2] = auth.uid()::text);

-- Comprobación (solo lectura): debe dar exactamente estas dos filas para `recursos`, ninguna de
-- INSERT ni UPDATE, y ninguna para {public}:
--   select policyname, roles, cmd, qual, with_check from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and (qual like '%recursos%' or with_check like '%recursos%') order by cmd;
--   → "recursos: borrado de la propia cuenta" {authenticated} DELETE
--     "recursos: lectura de la propia cuenta"   {authenticated} SELECT
