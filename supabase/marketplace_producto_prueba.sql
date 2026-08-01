-- =============================================================================
-- Paquete de prueba para validar cobros reales sin exponerlo al público
-- =============================================================================
--
-- Para comprobar que el cobro funciona de verdad hace falta una compra real:
-- Mercado Pago no permite que el vendedor se compre a sí mismo, y su entorno
-- de pruebas exige cuentas de prueba que piden un código a un correo que no
-- existe. La salida es cobrar de verdad un importe simbólico.
--
-- El paquete tiene que ser COMPRABLE pero INVISIBLE: si apareciera en el
-- catálogo, alguien podría llevarse el material completo por $10.
--
-- `activo = false` no sirve: crear-preferencia-mp exige productos activos.
-- Por eso se marca con `es_prueba` y se excluye en la política de lectura
-- pública. El catálogo usa la clave anónima y deja de verlo; las Edge
-- Functions usan service role y sí pueden cobrarlo por enlace directo.
--
-- Idempotente: se puede volver a ejecutar.
-- =============================================================================

alter table marketplace_productos
  add column if not exists es_prueba boolean not null default false;

comment on column marketplace_productos.es_prueba is
  'Paquete interno de validación de cobros: comprable por enlace directo, oculto del catálogo.';

-- ── Ocultarlo del catálogo público ──────────────────────────────────────────
drop policy if exists "productos publicos legibles" on marketplace_productos;
create policy "productos publicos legibles" on marketplace_productos
  for select using (activo = true and es_prueba = false);

-- ── Que el tarifario no le pise el precio ───────────────────────────────────
-- marketplace_aplicar_precios() reescribe precios por modalidad; sin esto le
-- pondría $399 al paquete de prueba en la primera venta que se acredite.
create or replace function marketplace_aplicar_precios()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nivel smallint;
  v_ventas integer;
  v_filas integer;
begin
  v_nivel := marketplace_nivel_ciclo();
  v_ventas := marketplace_ventas_ciclo();

  update marketplace_productos prod
  set precio_pdf = tar.precio_base,
      precio_editable = tar.precio_base + tar.precio_addon_editable,
      updated_at = now()
  from marketplace_precios tar
  where prod.es_prueba = false
    and tar.modalidad_precio = case
          when prod.organizacion = 'multigrado' then prod.modalidad
          else 'un_grado'
        end
    and tar.tipo_paquete = prod.tipo_paquete
    -- El trimestre no escala: siempre nivel 1.
    and tar.nivel = case when prod.tipo_paquete = 'ciclo' then v_nivel else 1 end
    and (prod.precio_pdf is distinct from tar.precio_base
      or prod.precio_editable is distinct from tar.precio_base + tar.precio_addon_editable);

  get diagnostics v_filas = row_count;

  return jsonb_build_object(
    'nivel', v_nivel,
    'ventas_ciclo', v_ventas,
    'productos_actualizados', v_filas
  );
end;
$$;

-- ── Que no cuente para el escalón de lanzamiento ────────────────────────────
-- Una compra de prueba no es una venta real: no debe acercar el precio al
-- siguiente escalón.
create or replace function marketplace_ventas_ciclo()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(distinct o.id), 0)::integer + coalesce(
           (select ajuste_contador from marketplace_lanzamiento where id), 0)
  from marketplace_ordenes o
  join marketplace_orden_items i on i.orden_id = o.id
  join marketplace_productos p on p.id = i.producto_id
  where o.estado = 'pagado'
    and p.tipo_paquete = 'ciclo'
    and p.es_prueba = false;
$$;

-- ── Crear (o actualizar) el paquete de prueba ───────────────────────────────
-- Reutiliza la carpeta de Drive de 1° Trimestre 1, que sí tiene material: así
-- la prueba valida también la entrega, no solo el cobro.
insert into marketplace_productos (
  titulo, grado, trimestre, tipo_paquete, organizacion, fase,
  num_proyectos, precio_pdf, precio_editable, activo, es_prueba,
  proyecto_folder_drive_id, descripcion
)
select
  'PRUEBA INTERNA — no publicar', 1, 1, 'trimestre', 'completa', 3,
  4, 10, 15, true, true,
  proyecto_folder_drive_id,
  'Paquete de validación de cobros. Oculto del catálogo.'
from marketplace_productos
where organizacion = 'completa' and grado = 1 and trimestre = 1
  and tipo_paquete = 'trimestre' and es_prueba = false
  and not exists (select 1 from marketplace_productos where es_prueba)
limit 1;

select id, titulo, precio_pdf, precio_editable, es_prueba, activo
from marketplace_productos where es_prueba;
