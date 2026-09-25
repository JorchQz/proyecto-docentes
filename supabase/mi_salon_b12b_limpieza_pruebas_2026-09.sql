-- Mi salón B12b: SOLO para el proyecto de PRUEBAS (raoxdxwgsxbqlzdnndly). NO aplicar en producción
-- (allí estas columnas nunca existieron; si se aplicara, no haría nada).
--
-- La versión anterior de la marca (80a4375, nunca publicada) agregó una columna captura_id por fila
-- en calificaciones y registro_diario. La marca por campo (mi_salon_b12_captura_id_2026-09.sql) las
-- sustituye por captura_semaforo / captura_puntaje / captura_retroalimentacion y
-- captura_participacion / captura_conducta; asistencias conserva captura_id (un solo campo).
-- Se quitan para que pruebas vuelva a ser espejo de lo que tendrá producción. Correr DESPUÉS de
-- mi_salon_b12_captura_id_2026-09.sql (que ya quitó el trigger que dependía de ellas).
-- Nada las lee: ni vistas, ni funciones, ni el frontend nuevo.

alter table public.calificaciones  drop column if exists captura_id;
alter table public.registro_diario drop column if exists captura_id;
