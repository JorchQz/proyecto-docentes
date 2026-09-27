# Mi Salón a producción: pasos exactos (lanzamiento del 12 de octubre de 2026)

Preparado por el constructor AN el 2026-09-26, sobre la rama `mi-salon-parte-b` ya integrada
(registro histórico b20, acceso b21, cobros b22). Producción (`cluvaxxqvhtxxiwctpnl`, jissez.com)
está en `b4c6958` y **no tiene ninguna migración desde `jissez_interes_secciones`**. Todo lo de abajo
se hace **solo con el OK de Jorge**, en este orden. El proyecto de pruebas (`raoxdxwgsxbqlzdnndly`)
ya quedó igual a lo que irá a producción (mismas migraciones, mismo orden, mismo
`delete_own_account`).

Resumen del orden:

1. Migraciones (en una transacción) y el piloto de producción.
2. Secretos de las Edge Functions.
3. Despliegue de las Edge Functions.
4. Cron de los avisos.
5. Despliegue del frontend (push a `main`).
6. El 12 de octubre, con la confirmación de Jorge: encender el interruptor.

Por qué este orden: el frontend nuevo lee columnas y tablas de b20 a b22 (sin ellas, Hoy y Reportes
dicen "No se pudo cargar"); las Edge Functions nuevas llaman funciones de b21 y b22; el cron llama a
una Edge Function que ya debe existir. Mientras el interruptor esté apagado, lo nuevo solo lo ven
las cuentas con `activo_saas` o acceso `piloto`: el público no nota nada.

---

## 0. Antes de empezar

- Respaldo: confirmar en Supabase → Database → Backups que hay un respaldo de hoy (o PITR activo).
- Verificación de integridad de b19a en producción (solo lectura; todo debe dar 0). Está al final de
  `supabase/mi_salon_b19a_integridad_2026-09.sql`, comentada: copiarla y correrla en el editor SQL.
  Si algo no da 0, parar y revisar con Jorge antes de seguir.

## 1. Migraciones

En este orden exacto (cada una es aditiva e idempotente; la última define la versión final de
`delete_own_account`):

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `supabase/jissez_interes_secciones_2026-09.sql` | "Avísame" de las secciones por abrir |
| 2 | `supabase/mi_salon_b16_pda_campo_catalogo_2026-09.sql` | `v_avance_pda` con el campo del catálogo |
| 3 | `supabase/mi_salon_b17_flujo_libre_2026-09.sql` | actividades sueltas, "¿Para quién?", Incompleta |
| 4 | `supabase/mi_salon_b18_examenes_2026-09.sql` | exámenes de Mi Salón |
| 5 | `supabase/mi_salon_b18a_examenes_plantillas_2026-09.sql` | plantillas de examen |
| 6 | `supabase/mi_salon_b19_examenes_cola_2026-09.sql` | exámenes en la cola sin señal |
| 7 | `supabase/mi_salon_b19a_integridad_2026-09.sql` | integridad (producto quitado, mismo grupo) |
| 8 | `supabase/mi_salon_b20_registro_historico_2026-09.sql` | Ponte al día, `es_historico`, calificación directa (ya confirmada en la boleta) |
| 9 | `supabase/mi_salon_b21_acceso_2026-09.sql` | periodos, accesos, T1 gratis a toda cuenta, interruptor (apagado), solo lectura en el servidor |
| 10 | `supabase/mi_salon_b22_cobros_2026-09.sql` | precios, fundador, cupones, órdenes y pagos, avisos, panel; `delete_own_account` FINAL |

Aparte, después de la 10:

| # | Archivo | Qué hace |
|---|---|---|
| 11 | `supabase/mi_salon_b21b_piloto_produccion_2026-09.sql` | acceso `piloto` todo el ciclo a soporte.jissez@gmail.com y a Fanny (sarayval034@gmail.com) |

NO se aplican en producción: `mi_salon_b21c_piloto_pruebas_2026-09.sql` (cuentas QA, solo pruebas)
y `mi_salon_b22_avisos_cron_2026-09.sql` (va en el paso 4).

Cómo aplicarlas (una sola transacción: si una falla, no queda nada a medias):

```
node .qa/aplicar-migraciones-prod.js supabase/jissez_interes_secciones_2026-09.sql supabase/mi_salon_b16_pda_campo_catalogo_2026-09.sql supabase/mi_salon_b17_flujo_libre_2026-09.sql supabase/mi_salon_b18_examenes_2026-09.sql supabase/mi_salon_b18a_examenes_plantillas_2026-09.sql supabase/mi_salon_b19_examenes_cola_2026-09.sql supabase/mi_salon_b19a_integridad_2026-09.sql supabase/mi_salon_b20_registro_historico_2026-09.sql supabase/mi_salon_b21_acceso_2026-09.sql supabase/mi_salon_b22_cobros_2026-09.sql
node .qa/aplicar-migraciones-prod.js supabase/mi_salon_b21b_piloto_produccion_2026-09.sql
```

(o pegarlas una por una, en ese orden, en el editor SQL de producción). La consulta final de b21b
debe devolver dos filas, origen `piloto`, vence `2027-07-30`.

Comprobación después (editor SQL de producción, solo lectura):

```sql
select
  (select mi_salon_abierto from public.jissez_config)                                   as abierto,          -- false
  (select count(*) from public.mi_salon_periodos where ciclo = '2026-2027')             as periodos,         -- 3
  (select count(*) from public.mi_salon_precios where ciclo = '2026-2027')              as precios,          -- 3
  (select count(*) from public.mi_salon_avisos)                                         as avisos,           -- 10
  (select count(*) from auth.users u where not exists (
     select 1 from public.mi_salon_accesos a where a.docente_id = u.id))                as sin_acceso,       -- 0 (hasta el 18-dic)
  (select count(*) from pg_policies where policyname like 'acceso_mi_salon%')           as candados,         -- 3 por tabla del SaaS
  position('mi_salon_ordenes' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0 as borrar_final; -- true
```

## 2. Secretos de las Edge Functions

Supabase → Edge Functions → Secrets (o `supabase secrets list --project-ref cluvaxxqvhtxxiwctpnl`).
Los de la tienda ya existen; confirmar que estén todos:

| Secreto | Lo usan | Nota |
|---|---|---|
| `MP_ACCESS_TOKEN` | comprar-mi-salon, webhook-mercadopago, confirmar-pago | el de la tienda |
| `MP_WEBHOOK_SECRET` | webhook-mercadopago | el de la tienda |
| `SITE_URL` | comprar-mi-salon, avisos-mi-salon, bienvenida-mi-salon, pagos | `https://jissez.com` |
| `RESEND_API_KEY` | correos (bienvenida, avisos, confirmación de pago) | el de la tienda |
| `MAIL_FROM` | correos | el de la tienda |
| `CRON_SECRET` | avisos-mi-salon (y avisos-pedidos) | el mismo que ya usa avisos-pedidos |
| `ANTHROPIC_API_KEY` | redactar-boleta (textos con IA) | **falta**; debe estar antes del 13 de noviembre |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo.

## 3. Despliegue de las Edge Functions

Desde la raíz del repo, con la rama integrada (`supabase/config.toml` ya trae `verify_jwt = false`
para las tres nuevas: validan la sesión o el `CRON_SECRET` por dentro):

```
supabase functions deploy bienvenida-mi-salon --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy comprar-mi-salon    --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-mi-salon     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy redactar-boleta     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy webhook-mercadopago --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy confirmar-pago      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-pedidos      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy completar-pedido    --project-ref cluvaxxqvhtxxiwctpnl
```

- Nuevas: `bienvenida-mi-salon` (b21), `comprar-mi-salon` y `avisos-mi-salon` (b22).
- Otra vez: `redactar-boleta` (exige acceso vigente, b21) y las que importan `_shared/pagos.ts`, que
  cambió (una orden de Mi Salón va por `_shared/mi-salon-pagos.ts`; las de la tienda siguen igual):
  `webhook-mercadopago`, `confirmar-pago`, `avisos-pedidos` y `completar-pedido`.
- La URL del webhook de Mercado Pago no cambia.
- Comprobación: Supabase → Edge Functions muestra las ocho con la versión de hoy; en los registros
  de `webhook-mercadopago`, la siguiente venta de la tienda se procesa como siempre.

## 4. Cron de los avisos

1. Confirmar que Vault tiene el secreto `cron_secret` (lo creó `marketplace_avisos_cron.sql` para
   avisos-pedidos): `select name from vault.secrets where name = 'cron_secret';`. Si no está:
   `select vault.create_secret('<el valor de CRON_SECRET>', 'cron_secret');`
2. Correr `supabase/mi_salon_b22_avisos_cron_2026-09.sql` en el editor SQL de producción (programa
   `avisos-mi-salon-hora`, cada hora al minuto 5).
3. Comprobar: `select jobname, schedule from cron.job where jobname = 'avisos-mi-salon-hora';`

Con el interruptor apagado la función no manda nada (solo envía con Mi Salón abierto, entre las
8:00 y las 21:00 del centro, una vez por cuenta y aviso).

## 5. Despliegue del frontend

Jorge decide fusionar a `main`. El push a `main` publica jissez.com solo (Worker de Cloudflare
"jissez"):

```
git checkout main
git merge --no-ff mi-salon-parte-b
for t in pruebas/*.test.js; do node $t | tail -1; done    # todas deben pasar
git push origin main
```

Después del despliegue (con el interruptor apagado):
- Una compra de la tienda de prueba sigue igual (catálogo, checkout, Mis compras).
- Con la cuenta de soporte (piloto): Inicio, Hoy, Ponte al día, Reportes y la compra
  (`/tienda/mi-salon-compra`) abren sin errores; el panel → Mi Salón muestra el interruptor apagado.
- Una cuenta sin `activo_saas` ni piloto sigue viendo solo la tienda.
- `tienda/conoce-mi-salon` sigue oculta: sin enlaces en la tienda y con `noindex`.

## 6. El 12 de octubre: encender el interruptor (con la confirmación de Jorge)

1. Panel de administración → Mi Salón → "Abrir Mi Salón" (o, en el editor SQL:
   `update public.jissez_config set mi_salon_abierto = true, mi_salon_abierto_desde = coalesce(mi_salon_abierto_desde, now()), actualizado_en = now() where id;`).
   Desde ese momento toda cuenta ve Mi Salón (con el T1 gratis hasta el 18 de diciembre), la tienda
   enlaza la presentación, las cuentas nuevas reciben la bienvenida y la presentación muestra los
   precios de la tabla con "Quedan N lugares".
2. Indexar la presentación (no se enciende con lógica): en un commit aparte, quitar
   `<meta name="robots" content="noindex, nofollow">` de `tienda/conoce-mi-salon.html` y las reglas
   `/tienda/conoce-mi-salon` y `/tienda/conoce-mi-salon.html` de `_headers`; ajustar
   `pruebas/presentaciones.test.js` §1 a "indexada"; push a `main`. La Sala sigue oculta.
3. Aviso de lanzamiento a las cuentas que ya existían: panel → Mi Salón → "Aviso de lanzamiento" → "Enviar aviso
   de lanzamiento" (una vez por cuenta; no a piloto ni a cuentas nuevas, que reciben la bienvenida).
4. Comprobar: una cuenta nueva de prueba ve la bienvenida y "Ponte al día"; el panel cuenta
   "nuevas desde el lanzamiento".

Para apagarlo (si algo sale mal): el mismo botón, o `update public.jissez_config set mi_salon_abierto = false where id;`.
Apagar no quita accesos ni datos.

## Después del lanzamiento (fechas de la spec)

- Antes del 13 de noviembre: `ANTHROPIC_API_KEY` (textos de la boleta con IA).
- Los avisos del 6 y 13 de noviembre, del 30 de noviembre y de diciembre salen solos (cron y tabla
  `mi_salon_avisos`); el panel → Mi Salón → Cobros los muestra por segmento para WhatsApp.
- Antes del 30 de noviembre: revisar precios y cupo fundador en el panel (ya cargados: $199/$299,
  $399/$549, cupo 100).
