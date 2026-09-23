-- ============================================================================
-- Mi salón Parte B — B.7 (textos) y B.8 (reportes de grupo). Septiembre 2026.
-- Copia de las migraciones aplicadas en producción (aditivas):
--   20260923074936  b7_plantillas_sugerencia
--   20260923075246  b8_calificaciones_boleta_por_lote
--   (siguiente)     b7_plantillas_calidad_y_descripciones
-- ============================================================================

-- ── b7_plantillas_sugerencia ────────────────────────────────────────────────
-- B.7 Capa 1: catálogo editable de sugerencias para padres, una por tipo de área de
-- oportunidad. js/textos-boleta.js lo lee y, si no carga, usa su copia por defecto
-- (mismos textos). Es global: lo edita el administrador (es_admin); cada maestro sigue
-- pudiendo reescribir cualquier sugerencia en su boleta, y lo suyo no se pisa.
create table public.plantillas_sugerencia (
  clave text primary key,
  texto text not null check (length(trim(texto)) > 0),
  descripcion text,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

insert into public.plantillas_sugerencia (clave, texto, descripcion) values
  ('tareas',        'Establecer un horario fijo para hacer la tarea en casa.',                               'Tareas por debajo de 60 %'),
  ('trabajos',      'Revisar juntos, al final del día, que los trabajos hayan quedado completos.',            'Trabajos de clase por debajo de 60 %'),
  ('participacion', 'Invitarle a compartir sus ideas en casa para ganar confianza al hablar en clase.',       'Participación por debajo de 60 %'),
  ('conducta',      'Repasar en casa los acuerdos del salón y reconocer cuando los cumple.',                  'Conducta por debajo de 60 %'),
  ('examen',        'Repasar los contenidos del trimestre con ejercicios cortos antes del examen.',           'Examen por debajo de 60 %'),
  ('lectura_ppm',   'Practicar lectura en voz alta 10 minutos diarios.',                                      'Velocidad lectora (PPM) por debajo del estándar de su grado'),
  ('comprension',   'Después de leer, pedirle que cuente con sus palabras lo que entendió.',                 'Comprensión lectora en requiere apoyo'),
  ('matematicas',   'Practicar con ejercicios cortos y diarios: {habilidades}.',                             'Habilidades matemáticas en requiere apoyo ({habilidades} = la lista)'),
  ('cuaderno',      'Revisar el cuaderno en casa una vez por semana.',                                        'Criterios del cuaderno en requiere apoyo'),
  ('asistencia',    'Avisar a la escuela cuando falte y ponerse al corriente con los trabajos.',             'Asistencia por debajo de 80 % (solo observación, no pondera)'),
  ('pda_mejora',    'Ya muestra avance en este punto: conviene seguir practicándolo en casa.',               'PDA en requiere apoyo pero con tendencia a mejorar'),
  ('pda_apoyo',     'Practicar en casa lo que se trabajó en clase sobre este aprendizaje.',                  'PDA en requiere apoyo');

alter table public.plantillas_sugerencia enable row level security;
create policy "plantillas_sugerencia lectura" on public.plantillas_sugerencia
  for select to authenticated using (true);
create policy "plantillas_sugerencia edicion admin" on public.plantillas_sugerencia
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on public.plantillas_sugerencia from anon;
grant select, insert, update, delete on public.plantillas_sugerencia to authenticated;

-- ── b8_calificaciones_boleta_por_lote ───────────────────────────────────────
-- B.8 Para reportes de grupo (junta, exportación): convertir muchos porcentajes a la vez.
-- No es una regla nueva: llama a calcular_calificacion_boleta, que sigue siendo la única.
create or replace function public.calcular_calificaciones_boleta(p_porcentajes numeric[], p_grados smallint[])
returns smallint[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(public.calcular_calificacion_boleta(t.p, t.g) order by t.i), array[]::smallint[])
  from unnest(p_porcentajes, p_grados) with ordinality as t(p, g, i)
$$;
grant execute on function public.calcular_calificaciones_boleta(numeric[], smallint[]) to authenticated;

-- ── b7_plantillas_calidad_y_descripciones (corrección tras la revisión #2 de 3.2) ──
-- Los hábitos se miden por ENTREGA y la calidad de lo entregado es otra frase, con su
-- propia sugerencia. Solo el catálogo global; ningún dato de maestros.
insert into public.plantillas_sugerencia (clave, texto, descripcion) values
  ('calidad', 'Platicar en casa sobre lo que hace en clase y repasar juntos lo que se le dificulta.',
   'Calidad de los trabajos entregados por debajo de 60 % (al menos 2 entregados)')
on conflict (clave) do nothing;

update public.plantillas_sugerencia set descripcion = 'Entrega de tareas por debajo de 60 % (al menos 2 tareas revisadas)', actualizado_en = now() where clave = 'tareas';
update public.plantillas_sugerencia set descripcion = 'Trabajos terminados por debajo de 60 % (al menos 2 revisados; incompleto no cuenta como terminado)', actualizado_en = now() where clave = 'trabajos';
update public.plantillas_sugerencia set descripcion = 'Participación: promedio por debajo del valor normal del día (1 de 2)', actualizado_en = now() where clave = 'participacion';
update public.plantillas_sugerencia set descripcion = 'Conducta: promedio por debajo del valor normal del día (1 de 2)', actualizado_en = now() where clave = 'conducta';
update public.plantillas_sugerencia set descripcion = 'Examen por debajo de 60 % en uno o más campos', actualizado_en = now() where clave = 'examen';
update public.plantillas_sugerencia set descripcion = 'Varios PDA en requiere apoyo con tendencia a mejorar (en plural: "estos puntos")', actualizado_en = now() where clave = 'pda_mejora';
update public.plantillas_sugerencia set descripcion = 'PDA en requiere apoyo (si son varios, se dice "estos aprendizajes")', actualizado_en = now() where clave = 'pda_apoyo';
