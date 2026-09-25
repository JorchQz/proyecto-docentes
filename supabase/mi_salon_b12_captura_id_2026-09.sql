-- Mi salón B12: marca por captura para la cola sin señal de "Hoy" (docs/PWA-MI-SALON.md §9.8)
--
-- ADITIVA. Aplicada en el proyecto de PRUEBAS (raoxdxwgsxbqlzdnndly). En producción solo con la
-- confirmación de Jorge. El frontend funciona igual antes y después de aplicarla: si la columna
-- no existe, js/bandeja-salida.js lo detecta y compara por contenido (la regla anterior).
--
-- 1. Columna captura_id (uuid, nula, SIN default) en asistencias, calificaciones y registro_diario.
--    No toca las filas existentes (quedan con null = "sin marca") ni cambia RLS. Cada escritura de
--    Hoy la llena con un uuid nuevo generado en el aparato; la escritura es condicional sobre la
--    marca que vio la pantalla (siempre junto con la llave única de la fila: no hace falta índice).
-- 2. Trigger BEFORE UPDATE: una escritura que NO pone una marca nueva (Asistencia, Evaluación
--    formativa, otra versión de la app, SQL a mano) deja la fila sin marca. Así la marca solo
--    identifica escrituras de Hoy y nunca queda una marca vieja sobre contenido que cambió otro:
--    sin marca, Hoy compara por contenido (como antes). Los inserts no se tocan.
--
-- Revisado con la columna nueva: calificaciones_tipo_desde_producto, propagar_calificacion_a_pda,
-- retirar_evidencia_de_pda, recalcular_evidencia_pda, set_asistencias_updated_at, cerrar_boleta y
-- delete_own_account no hacen `select *` ni insertan en estas tablas con listas de columnas por
-- posición; no hay vistas sobre ellas; las políticas (propias y refs_propias) no dependen de
-- columnas nuevas. La exportación (js/exportar.js) no lee estas columnas.

alter table public.asistencias     add column if not exists captura_id uuid;
alter table public.calificaciones  add column if not exists captura_id uuid;
alter table public.registro_diario add column if not exists captura_id uuid;

comment on column public.asistencias.captura_id is
  'Marca de la última captura de Hoy (uuid generado en el aparato). Null: escrita por otra pantalla o antes de la marca.';
comment on column public.calificaciones.captura_id is
  'Marca de la última captura de Hoy (uuid generado en el aparato). Null: escrita por otra pantalla o antes de la marca.';
comment on column public.registro_diario.captura_id is
  'Marca de la última captura de Hoy (uuid generado en el aparato). Null: escrita por otra pantalla o antes de la marca.';

create or replace function public.captura_id_sin_marca_nueva()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Quien no pone una marca nueva no puede dejar la de otra captura sobre su cambio
  if new.captura_id is not distinct from old.captura_id then
    new.captura_id := null;
  end if;
  return new;
end $$;

comment on function public.captura_id_sin_marca_nueva() is
  'Mi salón B12: una actualización que no trae una captura_id nueva deja la fila sin marca.';

create or replace trigger asistencias_captura_id
  before update on public.asistencias
  for each row execute function public.captura_id_sin_marca_nueva();

create or replace trigger calificaciones_captura_id
  before update on public.calificaciones
  for each row execute function public.captura_id_sin_marca_nueva();

create or replace trigger registro_diario_captura_id
  before update on public.registro_diario
  for each row execute function public.captura_id_sin_marca_nueva();
