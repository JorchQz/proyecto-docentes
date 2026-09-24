-- Mi salón B.9 — Referencias propias en las escrituras (2026-09-24, decisión 4 de Jorge)
--
-- Problema: las políticas de escritura solo revisaban maestro_id = auth.uid(). Un maestro podía
-- crear filas propias que apuntaran al alumno, grupo, proyecto o sesión de OTRO maestro (un
-- revisor cerró con cerrar_boleta la boleta de un alumno ajeno: filas cerradas propias, ligadas
-- a ese alumno, que no se podían borrar). No se filtraba nada, pero dejaba basura y referencias
-- cruzadas.
--
-- Solución: políticas RESTRICTIVE nuevas "for insert" y "for update" (with check) que exigen
-- que cada referencia, cuando no es null, sea del maestro que escribe. Se suman (AND) a las
-- permisivas de siempre; no se borra ni se cambia ninguna política existente.
--
-- Reglas:
-- - Las funciones ref_* son security invoker, stable y con search_path fijo. Buscan por llave
--   primaria (índice) y, si la fila no es del maestro, lanzan un error claro con código 42501
--   en lugar del genérico "new row violates row-level security policy". Con null regresan true
--   (las columnas opcionales siguen siendo opcionales).
-- - Solo afectan a quien pasa por RLS (authenticated/anon). No afectan a qa.resembrar() (corre
--   como dueño de las tablas), a service_role, ni a los borrados: no hay políticas nuevas de
--   delete, y las cascadas de llave foránea no evalúan RLS.
-- - Los triggers propagar_calificacion_a_pda / retirar_evidencia_de_pda llaman a
--   recalcular_evidencia_pda (security invoker), que escribe evaluacion_formativa con el alumno,
--   la sesión y el sesion_pda de la propia calificación: siempre referencias propias.
-- - Plantillas y catálogo: respuestas_examen puede apuntar a un examen propio o a una plantilla
--   (maestro_id null, visible para todos); las entregas viejas, a un producto final propio o de
--   catálogo. Tampoco son de otro maestro.
-- - Tablas sin maestro_id cuya política ya revisaba la referencia (actividades_proyecto,
--   proyectos_contenidos, sesiones_pda, producto_sesion_pda.producto_sesion_id,
--   respuestas_examen.alumno_id) no se tocan en esa columna. producto_sesion_pda.sesion_pda_id
--   y respuestas_examen.examen_id no se revisaban: se agregan.
-- - Tienda (marketplace_*) y catálogos: sin cambios.
--
-- Antes de aplicar en producción, correr la consulta de verificación del final: debe dar 0 en
-- todas las filas (una fila ya cruzada no podría actualizarse después).

-- ---------------------------------------------------------------------------------------------
-- 1. Funciones auxiliares
-- ---------------------------------------------------------------------------------------------

create or replace function public.ref_propia_alumno(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (select 1 from public.alumnos where id = p_id and maestro_id = auth.uid()) then
    return true;
  end if;
  raise exception 'El alumno indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

create or replace function public.ref_propia_grupo(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (select 1 from public.grupos where id = p_id and maestro_id = auth.uid()) then
    return true;
  end if;
  raise exception 'El grupo indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

create or replace function public.ref_propia_proyecto(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (select 1 from public.proyectos where id = p_id and maestro_id = auth.uid()) then
    return true;
  end if;
  raise exception 'El proyecto indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

create or replace function public.ref_propia_sesion(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (select 1 from public.sesiones where id = p_id and maestro_id = auth.uid()) then
    return true;
  end if;
  raise exception 'La sesión indicada no pertenece a tu cuenta' using errcode = '42501';
end $$;

-- sesiones_pda no tiene maestro_id: el dueño es el de su sesión
create or replace function public.ref_propia_sesion_pda(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (
    select 1 from public.sesiones_pda sp
    join public.sesiones s on s.id = sp.sesion_id
    where sp.id = p_id and s.maestro_id = auth.uid()
  ) then
    return true;
  end if;
  raise exception 'El PDA de sesión indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

create or replace function public.ref_propia_producto_sesion(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (select 1 from public.productos_sesion where id = p_id and maestro_id = auth.uid()) then
    return true;
  end if;
  raise exception 'El producto indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

-- Examen propio o plantilla (maestro_id null)
create or replace function public.ref_visible_examen(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (
    select 1 from public.examenes
    where id = p_id and (maestro_id = auth.uid() or maestro_id is null)
  ) then
    return true;
  end if;
  raise exception 'El examen indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

-- Producto final propio o de catálogo (maestro_id null); solo lo usa una tabla deprecada
create or replace function public.ref_visible_producto_final(p_id uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_id is null then return true; end if;
  if exists (
    select 1 from public.productos_finales
    where id = p_id and (maestro_id = auth.uid() or maestro_id is null)
  ) then
    return true;
  end if;
  raise exception 'El producto final indicado no pertenece a tu cuenta' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Políticas restrictivas (una de insert y una de update por tabla)
-- ---------------------------------------------------------------------------------------------
-- drop policy if exists solo sobre los nombres nuevos, para poder reaplicar el archivo.

-- alumnos: grupo
drop policy if exists alumnos_refs_propias_ins on public.alumnos;
create policy alumnos_refs_propias_ins on public.alumnos as restrictive for insert
  with check (public.ref_propia_grupo(grupo_id));
drop policy if exists alumnos_refs_propias_upd on public.alumnos;
create policy alumnos_refs_propias_upd on public.alumnos as restrictive for update
  using (true) with check (public.ref_propia_grupo(grupo_id));

-- asistencias: alumno, grupo
drop policy if exists asistencias_refs_propias_ins on public.asistencias;
create policy asistencias_refs_propias_ins on public.asistencias as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists asistencias_refs_propias_upd on public.asistencias;
create policy asistencias_refs_propias_upd on public.asistencias as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

-- boleta_trimestral: alumno (también lo que escribe cerrar_boleta, que es security invoker)
drop policy if exists boleta_trimestral_refs_propias_ins on public.boleta_trimestral;
create policy boleta_trimestral_refs_propias_ins on public.boleta_trimestral as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id));
drop policy if exists boleta_trimestral_refs_propias_upd on public.boleta_trimestral;
create policy boleta_trimestral_refs_propias_upd on public.boleta_trimestral as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id));

-- calificaciones: alumno, grupo, sesión, proyecto, producto
drop policy if exists calificaciones_refs_propias_ins on public.calificaciones;
create policy calificaciones_refs_propias_ins on public.calificaciones as restrictive for insert
  with check (
    public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id)
    and public.ref_propia_sesion(sesion_id) and public.ref_propia_proyecto(proyecto_id)
    and public.ref_propia_producto_sesion(producto_sesion_id)
  );
drop policy if exists calificaciones_refs_propias_upd on public.calificaciones;
create policy calificaciones_refs_propias_upd on public.calificaciones as restrictive for update
  using (true) with check (
    public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id)
    and public.ref_propia_sesion(sesion_id) and public.ref_propia_proyecto(proyecto_id)
    and public.ref_propia_producto_sesion(producto_sesion_id)
  );

-- evaluacion_diagnostica: alumno, grupo (no tiene llaves foráneas: esto además exige que existan)
drop policy if exists evaluacion_diagnostica_refs_propias_ins on public.evaluacion_diagnostica;
create policy evaluacion_diagnostica_refs_propias_ins on public.evaluacion_diagnostica as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists evaluacion_diagnostica_refs_propias_upd on public.evaluacion_diagnostica;
create policy evaluacion_diagnostica_refs_propias_upd on public.evaluacion_diagnostica as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

-- evaluacion_formativa: alumno, sesión, PDA de sesión (también lo que escribe recalcular_evidencia_pda)
drop policy if exists evaluacion_formativa_refs_propias_ins on public.evaluacion_formativa;
create policy evaluacion_formativa_refs_propias_ins on public.evaluacion_formativa as restrictive for insert
  with check (
    public.ref_propia_alumno(alumno_id) and public.ref_propia_sesion(sesion_id)
    and public.ref_propia_sesion_pda(sesion_pda_id)
  );
drop policy if exists evaluacion_formativa_refs_propias_upd on public.evaluacion_formativa;
create policy evaluacion_formativa_refs_propias_upd on public.evaluacion_formativa as restrictive for update
  using (true) with check (
    public.ref_propia_alumno(alumno_id) and public.ref_propia_sesion(sesion_id)
    and public.ref_propia_sesion_pda(sesion_pda_id)
  );

-- examenes: grupo
drop policy if exists examenes_refs_propias_ins on public.examenes;
create policy examenes_refs_propias_ins on public.examenes as restrictive for insert
  with check (public.ref_propia_grupo(grupo_id));
drop policy if exists examenes_refs_propias_upd on public.examenes;
create policy examenes_refs_propias_upd on public.examenes as restrictive for update
  using (true) with check (public.ref_propia_grupo(grupo_id));

-- productos_finales: grupo
drop policy if exists productos_finales_refs_propias_ins on public.productos_finales;
create policy productos_finales_refs_propias_ins on public.productos_finales as restrictive for insert
  with check (public.ref_propia_grupo(grupo_id));
drop policy if exists productos_finales_refs_propias_upd on public.productos_finales;
create policy productos_finales_refs_propias_upd on public.productos_finales as restrictive for update
  using (true) with check (public.ref_propia_grupo(grupo_id));

-- productos_sesion: sesión
drop policy if exists productos_sesion_refs_propias_ins on public.productos_sesion;
create policy productos_sesion_refs_propias_ins on public.productos_sesion as restrictive for insert
  with check (public.ref_propia_sesion(sesion_id));
drop policy if exists productos_sesion_refs_propias_upd on public.productos_sesion;
create policy productos_sesion_refs_propias_upd on public.productos_sesion as restrictive for update
  using (true) with check (public.ref_propia_sesion(sesion_id));

-- producto_sesion_pda (sin maestro_id): el producto ya lo revisa su política; falta el PDA de sesión
drop policy if exists producto_sesion_pda_refs_propias_ins on public.producto_sesion_pda;
create policy producto_sesion_pda_refs_propias_ins on public.producto_sesion_pda as restrictive for insert
  with check (public.ref_propia_sesion_pda(sesion_pda_id));
drop policy if exists producto_sesion_pda_refs_propias_upd on public.producto_sesion_pda;
create policy producto_sesion_pda_refs_propias_upd on public.producto_sesion_pda as restrictive for update
  using (true) with check (public.ref_propia_sesion_pda(sesion_pda_id));

-- proyectos: grupo
drop policy if exists proyectos_refs_propias_ins on public.proyectos;
create policy proyectos_refs_propias_ins on public.proyectos as restrictive for insert
  with check (public.ref_propia_grupo(grupo_id));
drop policy if exists proyectos_refs_propias_upd on public.proyectos;
create policy proyectos_refs_propias_upd on public.proyectos as restrictive for update
  using (true) with check (public.ref_propia_grupo(grupo_id));

-- registro_diario: alumno
drop policy if exists registro_diario_refs_propias_ins on public.registro_diario;
create policy registro_diario_refs_propias_ins on public.registro_diario as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id));
drop policy if exists registro_diario_refs_propias_upd on public.registro_diario;
create policy registro_diario_refs_propias_upd on public.registro_diario as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id));

-- respuestas_examen (sin maestro_id): el alumno ya lo revisa su política; falta el examen
drop policy if exists respuestas_examen_refs_propias_ins on public.respuestas_examen;
create policy respuestas_examen_refs_propias_ins on public.respuestas_examen as restrictive for insert
  with check (public.ref_visible_examen(examen_id));
drop policy if exists respuestas_examen_refs_propias_upd on public.respuestas_examen;
create policy respuestas_examen_refs_propias_upd on public.respuestas_examen as restrictive for update
  using (true) with check (public.ref_visible_examen(examen_id));

-- sesiones: proyecto
drop policy if exists sesiones_refs_propias_ins on public.sesiones;
create policy sesiones_refs_propias_ins on public.sesiones as restrictive for insert
  with check (public.ref_propia_proyecto(proyecto_id));
drop policy if exists sesiones_refs_propias_upd on public.sesiones;
create policy sesiones_refs_propias_upd on public.sesiones as restrictive for update
  using (true) with check (public.ref_propia_proyecto(proyecto_id));

-- tareas: sesión, proyecto, grupo
drop policy if exists tareas_refs_propias_ins on public.tareas;
create policy tareas_refs_propias_ins on public.tareas as restrictive for insert
  with check (
    public.ref_propia_sesion(sesion_id) and public.ref_propia_proyecto(proyecto_id)
    and public.ref_propia_grupo(grupo_id)
  );
drop policy if exists tareas_refs_propias_upd on public.tareas;
create policy tareas_refs_propias_upd on public.tareas as restrictive for update
  using (true) with check (
    public.ref_propia_sesion(sesion_id) and public.ref_propia_proyecto(proyecto_id)
    and public.ref_propia_grupo(grupo_id)
  );

-- Tablas deprecadas (zz_): siguen con permiso de escritura para authenticated; se cierran igual.
-- sesion_id en las zz_ apunta a dosificacion_sesiones (catálogo compartido): no se revisa.
drop policy if exists zz_calificacion_tarea_refs_propias_ins on public.zz_deprecated_calificacion_tarea;
create policy zz_calificacion_tarea_refs_propias_ins on public.zz_deprecated_calificacion_tarea as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id));
drop policy if exists zz_calificacion_tarea_refs_propias_upd on public.zz_deprecated_calificacion_tarea;
create policy zz_calificacion_tarea_refs_propias_upd on public.zz_deprecated_calificacion_tarea as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id));

drop policy if exists zz_calificacion_trabajo_refs_propias_ins on public.zz_deprecated_calificacion_trabajo;
create policy zz_calificacion_trabajo_refs_propias_ins on public.zz_deprecated_calificacion_trabajo as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id));
drop policy if exists zz_calificacion_trabajo_refs_propias_upd on public.zz_deprecated_calificacion_trabajo;
create policy zz_calificacion_trabajo_refs_propias_upd on public.zz_deprecated_calificacion_trabajo as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id));

drop policy if exists zz_configuracion_calificacion_refs_propias_ins on public.zz_deprecated_configuracion_calificacion;
create policy zz_configuracion_calificacion_refs_propias_ins on public.zz_deprecated_configuracion_calificacion as restrictive for insert
  with check (public.ref_propia_grupo(grupo_id));
drop policy if exists zz_configuracion_calificacion_refs_propias_upd on public.zz_deprecated_configuracion_calificacion;
create policy zz_configuracion_calificacion_refs_propias_upd on public.zz_deprecated_configuracion_calificacion as restrictive for update
  using (true) with check (public.ref_propia_grupo(grupo_id));

drop policy if exists zz_diagnosticos_refs_propias_ins on public.zz_deprecated_diagnosticos;
create policy zz_diagnosticos_refs_propias_ins on public.zz_deprecated_diagnosticos as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists zz_diagnosticos_refs_propias_upd on public.zz_deprecated_diagnosticos;
create policy zz_diagnosticos_refs_propias_upd on public.zz_deprecated_diagnosticos as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

drop policy if exists zz_entregas_producto_final_refs_propias_ins on public.zz_deprecated_entregas_producto_final;
create policy zz_entregas_producto_final_refs_propias_ins on public.zz_deprecated_entregas_producto_final as restrictive for insert
  with check (public.ref_visible_producto_final(producto_final_id));
drop policy if exists zz_entregas_producto_final_refs_propias_upd on public.zz_deprecated_entregas_producto_final;
create policy zz_entregas_producto_final_refs_propias_upd on public.zz_deprecated_entregas_producto_final as restrictive for update
  using (true) with check (public.ref_visible_producto_final(producto_final_id));

drop policy if exists zz_evaluacion_cuaderno_refs_propias_ins on public.zz_deprecated_evaluacion_cuaderno;
create policy zz_evaluacion_cuaderno_refs_propias_ins on public.zz_deprecated_evaluacion_cuaderno as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists zz_evaluacion_cuaderno_refs_propias_upd on public.zz_deprecated_evaluacion_cuaderno;
create policy zz_evaluacion_cuaderno_refs_propias_upd on public.zz_deprecated_evaluacion_cuaderno as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

drop policy if exists zz_evaluacion_habilidades_refs_propias_ins on public.zz_deprecated_evaluacion_habilidades_basicas;
create policy zz_evaluacion_habilidades_refs_propias_ins on public.zz_deprecated_evaluacion_habilidades_basicas as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists zz_evaluacion_habilidades_refs_propias_upd on public.zz_deprecated_evaluacion_habilidades_basicas;
create policy zz_evaluacion_habilidades_refs_propias_upd on public.zz_deprecated_evaluacion_habilidades_basicas as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

drop policy if exists zz_participacion_jornada_refs_propias_ins on public.zz_deprecated_participacion_jornada;
create policy zz_participacion_jornada_refs_propias_ins on public.zz_deprecated_participacion_jornada as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));
drop policy if exists zz_participacion_jornada_refs_propias_upd on public.zz_deprecated_participacion_jornada;
create policy zz_participacion_jornada_refs_propias_upd on public.zz_deprecated_participacion_jornada as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_grupo(grupo_id));

drop policy if exists zz_registros_diarios_refs_propias_ins on public.zz_deprecated_registros_diarios;
create policy zz_registros_diarios_refs_propias_ins on public.zz_deprecated_registros_diarios as restrictive for insert
  with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_proyecto(proyecto_id));
drop policy if exists zz_registros_diarios_refs_propias_upd on public.zz_deprecated_registros_diarios;
create policy zz_registros_diarios_refs_propias_upd on public.zz_deprecated_registros_diarios as restrictive for update
  using (true) with check (public.ref_propia_alumno(alumno_id) and public.ref_propia_proyecto(proyecto_id));

-- ---------------------------------------------------------------------------------------------
-- 3. Verificación previa (solo lectura; correr ANTES de aplicar en producción: todo debe dar 0)
-- ---------------------------------------------------------------------------------------------
-- select 'alumnos.grupo_id' ref, count(*) from alumnos x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'asistencias.alumno_id', count(*) from asistencias x join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'asistencias.grupo_id', count(*) from asistencias x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'boleta.alumno_id', count(*) from boleta_trimestral x join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'calif.alumno_id', count(*) from calificaciones x join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'calif.grupo_id', count(*) from calificaciones x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'calif.sesion_id', count(*) from calificaciones x join sesiones r on r.id = x.sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'calif.proyecto_id', count(*) from calificaciones x join proyectos r on r.id = x.proyecto_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'calif.producto_sesion_id', count(*) from calificaciones x join productos_sesion r on r.id = x.producto_sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'diag.alumno_id', count(*) from evaluacion_diagnostica x left join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'diag.grupo_id', count(*) from evaluacion_diagnostica x left join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'ef.alumno_id', count(*) from evaluacion_formativa x join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'ef.sesion_id', count(*) from evaluacion_formativa x join sesiones r on r.id = x.sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'ef.sesion_pda_id', count(*) from evaluacion_formativa x join sesiones_pda sp on sp.id = x.sesion_pda_id join sesiones r on r.id = sp.sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'examenes.grupo_id', count(*) from examenes x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'pfinales.grupo_id', count(*) from productos_finales x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'psesion.sesion_id', count(*) from productos_sesion x join sesiones r on r.id = x.sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'proyectos.grupo_id', count(*) from proyectos x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'registro.alumno_id', count(*) from registro_diario x join alumnos r on r.id = x.alumno_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'sesiones.proyecto_id', count(*) from sesiones x join proyectos r on r.id = x.proyecto_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'tareas.sesion_id', count(*) from tareas x join sesiones r on r.id = x.sesion_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'tareas.proyecto_id', count(*) from tareas x join proyectos r on r.id = x.proyecto_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'tareas.grupo_id', count(*) from tareas x join grupos r on r.id = x.grupo_id where r.maestro_id is distinct from x.maestro_id
-- union all select 'psp.sesion_pda_id', count(*) from producto_sesion_pda x join productos_sesion ps on ps.id = x.producto_sesion_id join sesiones_pda sp on sp.id = x.sesion_pda_id join sesiones r on r.id = sp.sesion_id where r.maestro_id is distinct from ps.maestro_id
-- union all select 'resp.examen_id', count(*) from respuestas_examen x join alumnos a on a.id = x.alumno_id join examenes r on r.id = x.examen_id where r.maestro_id is not null and r.maestro_id is distinct from a.maestro_id;
