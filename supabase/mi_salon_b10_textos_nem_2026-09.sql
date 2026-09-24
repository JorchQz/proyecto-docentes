-- Mi salón B10 · Textos NEM (auditoría normativa del 2026-09-24)
--
-- Los rangos de palabras por minuto de bandas_ppm salen de los Estándares Nacionales de
-- Habilidad Lectora de 2010 (Acuerdo 592, abrogado): ya no son un estándar vigente y en toda
-- la app se rotulan "referencia SEP 2010" (js/catalogo-habilidades.js). La descripción de la
-- plantilla de sugerencia de lectura todavía decía "estándar".
--
-- Aditiva: actualiza SOLO la descripción de la fila de catálogo lectura_ppm. No cambia el
-- texto de la sugerencia, ni las bandas, ni ninguna otra fila. Se puede correr dos veces.

update public.plantillas_sugerencia
   set descripcion = 'Velocidad lectora (PPM) por debajo de la referencia SEP 2010 de su grado',
       actualizado_en = now()
 where clave = 'lectura_ppm'
   and descripcion is distinct from 'Velocidad lectora (PPM) por debajo de la referencia SEP 2010 de su grado';
