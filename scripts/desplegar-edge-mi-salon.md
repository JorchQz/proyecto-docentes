# Desplegar las Edge Functions de Mi Salón (paso 3 de `docs/PRODUCCION-MI-SALON.md`)

Solo con el OK de Jorge en ese momento. Se corre desde la raíz del repo, con la rama integrada y
`supabase login` hecho. Nada de esto toca la base: las migraciones (paso 1) ya deben estar aplicadas.

## 0. Antes
```
git rev-parse --short HEAD          # anotar el hash que se despliega
for t in pruebas/*.test.js; do node $t | tail -1; done      # todas deben decir TODAS PASAN
supabase functions list --project-ref cluvaxxqvhtxxiwctpnl   # anotar la versión actual de cada una (para la reversa)
```

## 1. Despliegue, en este orden (las que cobran primero, `comprar-mi-salon` al final)
```
supabase functions deploy webhook-mercadopago --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy confirmar-pago      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-pedidos      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy completar-pedido    --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy redactar-boleta     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy bienvenida-mi-salon --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-mi-salon     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy comprar-mi-salon    --project-ref cluvaxxqvhtxxiwctpnl
```
Si una falla, repetir ESA antes de seguir y no desplegar `comprar-mi-salon` mientras `webhook-mercadopago`
y `confirmar-pago` no estén en la versión nueva.

## 2. Comprobación
```
supabase functions list --project-ref cluvaxxqvhtxxiwctpnl     # las ocho con la fecha de hoy
```
- Supabase → Edge Functions → `webhook-mercadopago` → Logs: la siguiente venta muestra
  `webhook procesado` con `estado: pagado` y respuesta 200.
- Falla pasajera (si ocurre): `webhook: falla pasajera ... 503 para que MP reintente` y, después, otro
  `webhook procesado` (200) para la misma orden. Si una orden se queda con 503 y sin 200:
  `select id, estado, created_at from marketplace_ordenes where estado = 'pendiente' and created_at < now() - interval '6 hours' order by created_at desc limit 20;`
  y pedir "Ya pagué, verificar" (o aplicar el pago con `confirmar-pago`).
- Ninguna orden `pagado` sin acceso: `select o.id from marketplace_ordenes o join mi_salon_ordenes m on m.orden_id = o.id where o.estado = 'pagado' and m.aprobado_en is null;` (0 filas) y, para la tienda,
  `select o.id from marketplace_ordenes o where o.estado = 'pagado' and not exists (select 1 from marketplace_accesos a where a.orden_id = o.id) and not exists (select 1 from mi_salon_ordenes m where m.orden_id = o.id) and not exists (select 1 from marketplace_pedidos p where p.orden_id = o.id);` (0 filas; las órdenes solo de pedido personalizado entregan al completarse el pedido).

## 3. Reversa
Volver a desplegar la versión anterior (sin tocar la base), desde un checkout del commit anterior
al cambio (`2dc7135`, o el hash anotado en el paso 0):
```
git worktree add ../reversa-edge 2dc7135
cd ../reversa-edge
supabase functions deploy webhook-mercadopago --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy confirmar-pago      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-pedidos      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy completar-pedido    --project-ref cluvaxxqvhtxxiwctpnl
```
La versión anterior responde 200 (y pierde el aviso) ante una falla pasajera; `confirmar-pago` lo repara
cuando la persona vuelve o pulsa "Ya pagué, verificar". `comprar-mi-salon` puede quedarse desplegada.
