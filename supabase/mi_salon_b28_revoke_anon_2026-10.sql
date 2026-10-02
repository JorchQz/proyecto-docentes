-- b28: quitar a `anon` los permisos de las tablas de Mi Salón (b16 a b27) que no los necesitan.
--
-- Por qué: el esquema public da permisos a anon por omisión (privilegios por omisión de Supabase). RLS ya impedía el acceso
-- real (sin política para anon: 0 filas o 42501 al escribir), pero un permiso de más es una capa menos. Hallazgo de BB.
--
-- Tablas que SÍ se quedan con anon (SELECT; leen sin sesión, con política explícita para anon; la tienda pública las usa):
--   jissez_config (tienda/js/tienda-common.js, conoce-mi-salon.js), mi_salon_periodos y mi_salon_precios
--   (conoce-mi-salon.js y mi_salon_precios_publicos()). A estas tres solo se les quita lo que no sea SELECT (abajo).
-- Tablas de la tienda (marketplace_*), catálogos (catalogo_*, ltg_*, ...) y vistas v_*: fuera de este alcance, no se tocan.
--
-- Solo quita permisos: no borra datos ni políticas. Idempotente (revoke sobre algo ya revocado no falla).
--
-- Reversa (los grant exactos que había, comprobados en pruebas antes de aplicar):
--   grant delete, insert, references, select, trigger, truncate, update on public.jornadas to anon;
--   grant delete, insert, references, select, trigger, truncate, update on public.mi_salon_avisos to anon;
--   grant references, select, trigger, truncate on public.mi_salon_accesos to anon;
--   grant references, select, trigger, truncate on public.mi_salon_correos to anon;
--   grant references, select, trigger, truncate on public.mi_salon_ordenes to anon;

revoke all on public.jornadas from anon;
revoke all on public.mi_salon_avisos from anon;
revoke all on public.mi_salon_accesos from anon;
revoke all on public.mi_salon_correos from anon;
revoke all on public.mi_salon_ordenes from anon;

-- Las tres que anon sí lee: solo se le deja SELECT (sus políticas para anon son de lectura; escribir ya lo impedía RLS).
revoke delete, insert, update, truncate, references, trigger on public.mi_salon_periodos from anon;
revoke delete, insert, update, truncate, references, trigger on public.mi_salon_precios from anon;
revoke truncate, references, trigger on public.jissez_config from anon;
-- Reversa de estas tres:
--   grant delete, insert, update, truncate, references, trigger on public.mi_salon_periodos to anon;
--   grant delete, insert, update, truncate, references, trigger on public.mi_salon_precios to anon;
--   grant truncate, references, trigger on public.jissez_config to anon;
