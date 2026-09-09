-- =============================================================================
-- La administracion de la tienda pasa a la cuenta de Jissez (septiembre 2026)
-- =============================================================================
--
-- es_admin() es la UNICA fuente de verdad para todas las politicas y RPC de
-- administracion (productos, ordenes, precios, promocion, cupones, Drive,
-- pedidos). Cambiar el correo aqui cambia el admin en todo el sistema; no hay
-- que tocar ninguna politica.
--
-- El navegador lleva su espejo en tienda/js/tienda-common.js (ADMIN_EMAIL),
-- que solo decide que enlaces mostrar: la seguridad real es esta funcion.
--
-- Antes: jorgequezadarm@gmail.com (queda como una cuenta normal).
-- Ahora: soporte.jissez@gmail.com (buzon del negocio; recibe tambien los
--        avisos automaticos de pedidos, ver MAIL_ADMIN en las Edge Functions).
--
-- Requisito antes de aplicar: poder iniciar sesion con la cuenta nueva.
-- Idempotente.
-- =============================================================================

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'soporte.jissez@gmail.com';
$$;

comment on function public.es_admin() is
  'Verdadero solo para la cuenta administradora de la tienda (soporte.jissez@gmail.com). Unica fuente de verdad del rol admin.';
