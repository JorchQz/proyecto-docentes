-- =============================================================================
-- Un proyecto suelto por proyecto: candado contra duplicados (2026-09-09)
-- =============================================================================
--
-- Un doble clic en "Crear productos seleccionados" del admin duplico cuatro
-- sueltos. Ademas del arreglo en pantalla, la base no admite dos productos
-- tipo 'proyecto' del mismo proyecto del bot ni dos con la misma aula y
-- numero continuo. Los personalizados (numero_proyecto nulo) no entran en el
-- segundo indice; el primero si los cubre si se enlazan al mismo proyecto.
--
-- Idempotente.
-- =============================================================================

-- Limpieza de los duplicados existentes: se conserva el mas antiguo de cada
-- proyecto, siempre que el mas nuevo no tenga compras.
delete from marketplace_productos p
using marketplace_productos q
where p.tipo_paquete = 'proyecto' and q.tipo_paquete = 'proyecto'
  and p.dosificacion_proyecto_id is not null
  and p.dosificacion_proyecto_id = q.dosificacion_proyecto_id
  and p.created_at > q.created_at
  and not exists (select 1 from marketplace_accesos a where a.producto_id = p.id)
  and not exists (select 1 from marketplace_orden_items i where i.producto_id = p.id);

create unique index if not exists marketplace_productos_suelto_dosif_unico
  on marketplace_productos (dosificacion_proyecto_id)
  where tipo_paquete = 'proyecto' and dosificacion_proyecto_id is not null and es_prueba = false;

create unique index if not exists marketplace_productos_suelto_numero_unico
  on marketplace_productos (organizacion, coalesce(grados_combo, ''), grado, numero_proyecto)
  where tipo_paquete = 'proyecto' and numero_proyecto is not null and es_prueba = false;
