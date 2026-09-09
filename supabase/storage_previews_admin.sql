-- =============================================================================
-- Vistas previas por imagen de los proyectos individuales (2026-09-09)
-- =============================================================================
--
-- Las imagenes de muestra viven en el bucket publico `assets`, bajo
-- `previews/<slug>/` (paquetes: grado-N / multi-C; proyectos individuales:
-- proyecto-<uuid>). El admin las genera desde la tienda (pestana Proyectos
-- individuales → "Generar vistas previas": convierte el PDF de muestra en
-- JPG con pdf.js y lo sube) y guarda la primera en
-- marketplace_productos.portada_url. Para eso necesita escribir en Storage
-- desde el navegador con su sesion; el resto del bucket sigue cerrado.
--
-- Idempotente.
-- =============================================================================

drop policy if exists "previews: admin sube" on storage.objects;
create policy "previews: admin sube" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = 'previews' and public.es_admin());

drop policy if exists "previews: admin actualiza" on storage.objects;
create policy "previews: admin actualiza" on storage.objects
  for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = 'previews' and public.es_admin())
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = 'previews' and public.es_admin());

drop policy if exists "previews: admin borra" on storage.objects;
create policy "previews: admin borra" on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = 'previews' and public.es_admin());
