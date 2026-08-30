-- ============================================================================
-- Endurecimiento de seguridad — RLS y privilegios
-- Fecha: 2026-08-08
-- Cubre los hallazgos C1, C2 y M4b de la auditoría de seguridad.
--
-- Contexto:
--   17 tablas del esquema public estaban EXPUESTAS (RLS deshabilitado): cualquiera
--   con la anon key (pública) podía leer, escribir y borrar. Varias contienen datos
--   personales de menores (calificaciones, evaluaciones); otras, ~19k filas de
--   contenido intelectual (banco de preguntas, dosificaciones, materiales).
--
--   Las funciones del bot generador y las Edge Functions usan la SERVICE ROLE, que
--   ignora RLS, así que estas políticas NO las afectan. El cliente (anon/authenticated)
--   queda restringido a lo que corresponde.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Grupo 1 — Contenido compartido generado por el bot: SOLO LECTURA desde cliente.
-- El bot escribe con service role. Sin política de escritura => anon/authenticated
-- no pueden INSERT/UPDATE/DELETE (se elimina el vector de borrado masivo).
-- ----------------------------------------------------------------------------

-- Catálogo visible también para la tienda pública (anon).
alter table public.dosificacion_proyectos enable row level security;
create policy "dosificacion_proyectos legibles"
  on public.dosificacion_proyectos for select to anon, authenticated using (true);

alter table public.dosificacion_sesiones enable row level security;
create policy "dosificacion_sesiones legibles"
  on public.dosificacion_sesiones for select to anon, authenticated using (true);

-- Reference de estructuras metodológicas (ya tenía RLS on pero sin política).
alter table public.ltg_metodologias_estructuras enable row level security;
create policy "ltg_metodologias legibles"
  on public.ltg_metodologias_estructuras for select to anon, authenticated using (true);

-- Contenido de planeación que solo consume el SaaS (maestro autenticado).
alter table public.dosificacion_pdas enable row level security;
create policy "dosificacion_pdas legibles"
  on public.dosificacion_pdas for select to authenticated using (true);

alter table public.dosificacion_sesion_pdas enable row level security;
create policy "dosificacion_sesion_pdas legibles"
  on public.dosificacion_sesion_pdas for select to authenticated using (true);

alter table public.materiales_sesion enable row level security;
create policy "materiales_sesion legibles"
  on public.materiales_sesion for select to authenticated using (true);

alter table public.sesion_links_ltg enable row level security;
create policy "sesion_links_ltg legibles"
  on public.sesion_links_ltg for select to authenticated using (true);

-- Banco de preguntas: material vendible, lo lee el generador de exámenes (SaaS).
alter table public.banco_preguntas enable row level security;
create policy "banco_preguntas legibles"
  on public.banco_preguntas for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- Grupo 2 — Datos privados del maestro (tienen maestro_id directo).
-- Cada maestro solo ve/escribe lo suyo.
-- ----------------------------------------------------------------------------

alter table public.configuracion_calificacion enable row level security;
create policy "configuracion_calificacion propia"
  on public.configuracion_calificacion for all to authenticated
  using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());

alter table public.evaluacion_cuaderno enable row level security;
create policy "evaluacion_cuaderno propia"
  on public.evaluacion_cuaderno for all to authenticated
  using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());

alter table public.evaluacion_habilidades_basicas enable row level security;
create policy "evaluacion_habilidades propia"
  on public.evaluacion_habilidades_basicas for all to authenticated
  using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());

alter table public.participacion_jornada enable row level security;
create policy "participacion_jornada propia"
  on public.participacion_jornada for all to authenticated
  using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());

alter table public.productos_finales enable row level security;
create policy "productos_finales propios"
  on public.productos_finales for all to authenticated
  using (maestro_id = auth.uid()) with check (maestro_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Grupo 3 — exámenes: plantillas (maestro_id NULL) que el maestro "reclama" por
-- UPDATE fijando maestro_id = él mismo. Se preserva ese flujo pero se impide ver
-- o alterar el examen ya asignado a otro maestro.
-- ----------------------------------------------------------------------------

alter table public.examenes enable row level security;
create policy "examenes visibles (propios o plantilla)"
  on public.examenes for select to authenticated
  using (maestro_id = auth.uid() or maestro_id is null);
create policy "examenes reclamar/editar"
  on public.examenes for update to authenticated
  using (maestro_id = auth.uid() or maestro_id is null)
  with check (maestro_id = auth.uid());
create policy "examenes insertar propios"
  on public.examenes for insert to authenticated
  with check (maestro_id = auth.uid());
create policy "examenes borrar propios"
  on public.examenes for delete to authenticated
  using (maestro_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Grupo 4 — Datos privados del maestro sin maestro_id: se resuelve por FK.
-- ----------------------------------------------------------------------------

-- calificacion_tarea / calificacion_trabajo -> por grupo del maestro
alter table public.calificacion_tarea enable row level security;
create policy "calificacion_tarea del maestro"
  on public.calificacion_tarea for all to authenticated
  using (exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = auth.uid()))
  with check (exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = auth.uid()));

alter table public.calificacion_trabajo enable row level security;
create policy "calificacion_trabajo del maestro"
  on public.calificacion_trabajo for all to authenticated
  using (exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = auth.uid()))
  with check (exists (select 1 from public.grupos g where g.id = grupo_id and g.maestro_id = auth.uid()));

-- entregas_producto_final / respuestas_examen -> por alumno del maestro
alter table public.entregas_producto_final enable row level security;
create policy "entregas_producto_final del maestro"
  on public.entregas_producto_final for all to authenticated
  using (exists (select 1 from public.alumnos a where a.id = alumno_id and a.maestro_id = auth.uid()))
  with check (exists (select 1 from public.alumnos a where a.id = alumno_id and a.maestro_id = auth.uid()));

alter table public.respuestas_examen enable row level security;
create policy "respuestas_examen del maestro"
  on public.respuestas_examen for all to authenticated
  using (exists (select 1 from public.alumnos a where a.id = alumno_id and a.maestro_id = auth.uid()))
  with check (exists (select 1 from public.alumnos a where a.id = alumno_id and a.maestro_id = auth.uid()));

-- ============================================================================
-- C2 — perfiles.activo_saas no debe poder auto-activarse desde el cliente.
-- OJO: un REVOKE por columna NO surte efecto si el rol tiene UPDATE a nivel de
-- tabla (implica todas las columnas). Se revoca INSERT/UPDATE de la tabla y se
-- re-otorgan SOLO las columnas editables por el cliente, dejando fuera
-- activo_saas (que solo cambia service role / admin) e id en UPDATE.
-- ============================================================================
revoke insert, update on public.perfiles from authenticated;
revoke insert, update on public.perfiles from anon;

grant insert (id, nombre_completo, escuela, sexo_docente, cct, zona, estado, municipio, grados_asignados)
  on public.perfiles to authenticated;
grant update (nombre_completo, escuela, sexo_docente, cct, zona, estado, municipio, grados_asignados)
  on public.perfiles to authenticated;

-- ============================================================================
-- M4b — El usuario no debe poder crear órdenes ya marcadas como 'pagado'
-- (inflaría el contador de ventas que escala los precios del catálogo y cebaría
-- el botón "Confirmar pago" del admin). Las órdenes reales las crea la Edge
-- Function crear-preferencia-mp con service role.
-- ============================================================================
drop policy if exists "usuario crea sus ordenes" on public.marketplace_ordenes;
create policy "usuario crea sus ordenes"
  on public.marketplace_ordenes for insert to authenticated
  with check (user_id = auth.uid() and estado = 'pendiente');

-- ============================================================================
-- M4 — Las columnas *_drive_id de marketplace_productos no deben ser legibles
-- por el cliente (contradice "el frontend nunca ve un file ID"). El admin las
-- lee vía RPC guardada por es_admin(); las Edge Functions usan service role.
-- (admin.js: el editor llama a admin_producto_drive al abrir el modal.)
-- ============================================================================
revoke select (proyecto_folder_drive_id, archivo_pdf_drive_id, archivo_docx_drive_id,
               archivos_anexos_drive_ids, archivos_preview_drive_ids)
  on public.marketplace_productos from anon, authenticated;

create or replace function public.admin_producto_drive(p_id uuid)
returns table (
  proyecto_folder_drive_id text,
  archivo_pdf_drive_id text,
  archivo_docx_drive_id text,
  archivos_anexos_drive_ids text[],
  archivos_preview_drive_ids text[]
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;
  return query
    select p.proyecto_folder_drive_id, p.archivo_pdf_drive_id, p.archivo_docx_drive_id,
           p.archivos_anexos_drive_ids, p.archivos_preview_drive_ids
    from public.marketplace_productos p
    where p.id = p_id;
end;
$$;

revoke execute on function public.admin_producto_drive(uuid) from public, anon;
grant execute on function public.admin_producto_drive(uuid) to authenticated;

commit;
