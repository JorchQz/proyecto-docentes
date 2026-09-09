-- =============================================================================
-- Retiro del escalon de lanzamiento (septiembre 2026)
-- =============================================================================
--
-- APLICAR SOLO DESPUES de desplegar tienda/js/admin.js sin la tarjeta del
-- escalon. Mientras el admin viejo siga servido, admin_estado_precios() y
-- admin_ajustar_lanzamiento() tienen que existir o la pestana Precios revienta.
--
-- Por que borrar y no dejarlo huerfano: marketplace_lanzamiento.nivel_forzado
-- esta hoy en 1. Si alguien lo pone en NULL "a ver que pasa", los precios del
-- ciclo vuelven a escalar solos con las ventas. Codigo muerto que puede subir
-- precios no es codigo muerto.
--
-- Dependencias comprobadas antes de borrar:
--   marketplace_aplicar_precios()  -> ya no llama a nivel/ventas (marketplace_tarifario_2026-09.sql)
--   marketplace_precio_unitaria()  -> lee la COLUMNA nivel = 1, no estas funciones
--   admin_guardar_tarifario()      -> escribe la columna nivel, no estas funciones
--   _shared/pagos.ts               -> solo llama a marketplace_aplicar_precios()
--   tienda/js/*.js                 -> solo admin.js las llamaba
--
-- Para revertir: el cuerpo original de las cuatro funciones y de la tabla esta
-- en supabase/marketplace_precios.sql (secciones 2, 4, 5 y 7).
-- =============================================================================

-- 1. Primero el panel: nadie mas las llama.
drop function if exists admin_ajustar_lanzamiento(smallint, integer);
drop function if exists admin_estado_precios();

-- 2. Despues los calculos.
drop function if exists marketplace_nivel_ciclo();
drop function if exists marketplace_ventas_ciclo();

-- 3. Al final la tabla, cuando ya nadie la lee.
drop table if exists marketplace_lanzamiento;

-- 4. Comprobacion: no debe quedar rastro (0 filas esperadas).
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('marketplace_nivel_ciclo', 'marketplace_ventas_ciclo',
                    'admin_estado_precios', 'admin_ajustar_lanzamiento');

-- NULL esperado.
select to_regclass('public.marketplace_lanzamiento');

-- 5. El tarifario sigue propagandose.
select marketplace_aplicar_precios();
