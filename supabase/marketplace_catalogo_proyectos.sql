-- =============================================================================
-- Catalogo publico de proyectos sueltos con sus contenidos y PDAs (sept. 2026)
-- =============================================================================
--
-- El filtro por campo formativo / contenido / PDA del catalogo necesita los
-- PDAs de cada proyecto. Viven en dosificacion_pdas, que solo es legible con
-- sesion (rls_hardening_2026-08.sql). Un visitante sin cuenta debe poder
-- filtrar, asi que esta RPC (security definer) expone ESA informacion y solo
-- esa: los PDAs de los productos tipo 'proyecto' publicados. La dosificacion
-- del resto del catalogo sigue sin exponerse.
--
-- Decision de Jorge (2026-09-09): publico para anonimos, limitado a sueltos
-- publicados.
--
-- p_id = null → todos los sueltos publicados (catalogo).
-- p_id = uuid → solo ese (ficha proyecto.html). Un suelto no publicado devuelve
--               vacio aunque se conozca el id.
--
-- Idempotente.
-- =============================================================================

create or replace function public.marketplace_proyectos_publicos(p_id uuid default null)
returns table (
  id uuid,
  titulo text,
  descripcion text,
  grado integer,
  organizacion text,
  grados_combo text,
  modalidad text,
  trimestre integer,
  numero_proyecto smallint,
  precio_pdf numeric,
  precio_pdf_con_anexos numeric,
  portada_url text,
  nombre_proyecto text,
  metodologia text,
  escenario text,
  num_sesiones_estimadas smallint,
  pdas jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p.id, p.titulo, p.descripcion, p.grado, p.organizacion, p.grados_combo, p.modalidad,
    p.trimestre, p.numero_proyecto, p.precio_pdf, p.precio_pdf_con_anexos, p.portada_url,
    d.nombre_proyecto, d.metodologia, d.escenario, d.num_sesiones_estimadas,
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'cf', x.campo_formativo,
                 'grado', x.grado,
                 'contenido_id', x.contenido_id,
                 'contenido', x.contenido_texto,
                 'pda_id', x.pda_id,
                 'pda', x.pda_texto
               )
               order by x.campo_formativo, x.grado, x.contenido_texto, x.pda_texto)
      from dosificacion_pdas x
      where x.proyecto_dos_id = p.dosificacion_proyecto_id
    ), '[]'::jsonb) as pdas
  from marketplace_productos p
  left join dosificacion_proyectos d on d.id = p.dosificacion_proyecto_id
  where p.tipo_paquete = 'proyecto'
    and p.activo = true
    and p.es_prueba = false
    and (p_id is null or p.id = p_id)
  order by p.organizacion, p.grado, p.grados_combo, p.numero_proyecto;
$$;

revoke all on function public.marketplace_proyectos_publicos(uuid) from public;
grant execute on function public.marketplace_proyectos_publicos(uuid) to anon, authenticated;

comment on function public.marketplace_proyectos_publicos(uuid) is
  'Catalogo publico de proyectos sueltos publicados con sus PDAs (campo, contenido, PDA). Unica via por la que un anonimo lee dosificacion_pdas.';
