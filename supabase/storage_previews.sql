-- =============================================================================
-- Vista previa por imágenes: permiso de listado
-- =============================================================================
--
-- Las imágenes de muestra viven en el bucket público `assets`, bajo
-- `previews/<slug>/`. Ser público basta para DESCARGAR una imagen concreta,
-- pero no para LISTAR la carpeta, y el catálogo necesita listar: así Jorge
-- sube las imágenes que quiera (3, 5, 9…) y aparecen solas, sin tener que
-- registrar cada archivo en ningún sitio.
--
-- El permiso se limita a `previews/`: el resto del bucket sigue sin poder
-- enumerarse.
-- =============================================================================

drop policy if exists "previews: listables por cualquiera" on storage.objects;
create policy "previews: listables por cualquiera" on storage.objects
  for select
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = 'previews'
  );
