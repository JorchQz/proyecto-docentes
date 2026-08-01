# Marketplace de Planeaciones NEM — Guía de despliegue

Esta tienda vende planeaciones (PDF y DOCX) que viven en **Google Drive**. El
comprador nunca ve Drive: descarga desde la plataforma y el PDF/DOCX se entrega
con un **pie de página** con sus datos.

Todo el cobro pasa por **Mercado Pago (Checkout Pro)**, que ofrece por sí solo
cuenta MP, tarjeta, dos tarjetas, efectivo y transferencia SPEI. La entrega es
automática: **no hay confirmación manual en el flujo normal**.

---

## 0. Arquitectura

```
Comprador → tienda/ (HTML/JS) ──┬─► Supabase (catálogo, órdenes, accesos, RLS)
                                 ├─► Edge Function crear-preferencia-mp ─► Mercado Pago
                                 ├─► Edge Function confirmar-pago ─► Mercado Pago (verificación)
                                 ├─► Edge Function descargar-archivo ─► Google Drive (+ pie de página)
                                 └─► Edge Function previsualizar ─► Google Drive (muestra)

Mercado Pago ──(webhook)──► Edge Function webhook-mercadopago ─► otorga accesos
```

### Doble vía de acreditación (importante)

El pago se acredita por **dos caminos independientes** que terminan en la misma
función idempotente (`_shared/pagos.ts → procesarPago`):

1. **Webhook** — MP nos avisa. Es la vía normal.
2. **`confirmar-pago`** — red de seguridad. Se dispara cuando el comprador
   vuelve al sitio y cuando pulsa *"Ya pagué — verificar"*. Consulta el pago
   real en la API de MP y entrega el acceso aunque el webhook nunca haya
   llegado.

Sin la segunda vía, un webhook perdido significa un comprador que pagó y se
quedó sin su paquete. Nunca quites `confirmar-pago`.

### Tiempos de acreditación

| Método | Cuándo llega el acceso |
|---|---|
| Tarjeta / cuenta Mercado Pago | Al instante |
| Efectivo (OXXO y otros) | De horas a 3 días |
| Transferencia SPEI | Minutos a horas |

La UI ya dice esto explícitamente en checkout y en Mis compras. No lo suavices:
prometer "acceso inmediato" en efectivo genera reclamos.

Tablas nuevas: `marketplace_productos`, `marketplace_ordenes`,
`marketplace_orden_items`, `marketplace_accesos` (+ columnas nuevas en `perfiles`).
Todas con RLS. Funciones admin: `es_admin()`, `admin_confirmar_orden()`,
`admin_otorgar_acceso()`, `admin_listar_ordenes()`.

> Las migraciones de BD **ya están aplicadas** en el proyecto `cluvaxxqvhtxxiwctpnl`.

---

## 1. Google Cloud — Service Account para Drive

1. Entra a [Google Cloud Console](https://console.cloud.google.com/) → crea un proyecto (o usa uno existente).
2. **APIs y servicios → Biblioteca →** busca **Google Drive API → Habilitar**.
3. **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio.**
   - Nombre: `marketplace-drive`. Crea y continúa (sin roles especiales). Finaliza.
4. Abre la cuenta de servicio → pestaña **Claves → Agregar clave → Crear nueva → JSON.**
   Se descarga un archivo `*.json`. **Guárdalo bien, no se vuelve a descargar.**
5. Copia el `client_email` del JSON (algo como `marketplace-drive@...iam.gserviceaccount.com`).
6. En **Google Drive**, comparte la carpeta raíz de tus planeaciones con ese
   `client_email` con permiso **Lector**. (Los subarchivos heredan el permiso.)

Estructura sugerida en Drive:
```
/planeaciones-nem/
  /pdfs/        ← PDF base (lo que se entrega con pie de página)
  /editables/   ← DOCX editable
  /previews/    ← muestras de 2-3 páginas (PDF)
  /anexos/      ← materiales complementarios
```

**Cómo obtener el file ID:** clic derecho en el archivo → *Obtener vínculo*. En la
URL `https://drive.google.com/file/d/XXXXXXXX/view`, el `XXXXXXXX` es el file ID.
Eso es lo que pegas en el panel de admin.

---

## 2. Mercado Pago — Credenciales

1. Entra a [Mercado Pago Developers](https://www.mercadopago.com.mx/developers/panel) → tu aplicación.
2. Copia el **Access Token** de **producción** (`APP_USR-...`). Para pruebas usa el de *test*.
3. (Opcional pero recomendado) Configura la **clave secreta de webhooks** para validar firmas.

---

## 3. Configurar secretos de las Edge Functions

En el **Dashboard de Supabase → Edge Functions → Secrets** (o con la CLI), define:

| Secreto | Valor |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido **completo** del JSON de la cuenta de servicio (paso 1.4) |
| `MP_ACCESS_TOKEN` | Access Token de Mercado Pago (paso 2) |
| `MP_WEBHOOK_SECRET` | Clave secreta de webhooks de MP. Si está definida, se **exige** firma válida; si falta, el webhook la omite |
| `SITE_URL` | `https://jissez.com` — **sin** slash final y **con https**. Si no es https, `crear-preferencia-mp` falla a propósito: `auto_return` de MP rechaza back_urls que no lo sean |
| `RESEND_API_KEY` | *(opcional)* Clave de [Resend](https://resend.com) para el correo de confirmación. Sin ella la compra funciona igual, solo no se envía el aviso |
| `MAIL_FROM` | *(opcional)* Remitente del correo. Por defecto `Jissez <no-reply@jissez.com>`. El dominio debe estar verificado en Resend |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya están
> disponibles automáticamente en las Edge Functions; no las definas tú.

Con la CLI sería:
```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat ruta/al/credenciales.json)"
supabase secrets set MP_ACCESS_TOKEN="APP_USR-..."
supabase secrets set SITE_URL="https://tudominio.com"
```

---

## 4. Desplegar las Edge Functions

Las funciones están en `supabase/functions/`. La config de `verify_jwt` está en
`supabase/config.toml` (en `false`: validan identidad por su cuenta).

No hace falta instalar nada: la CLI corre con `npx`.

```bash
npx supabase@latest functions deploy descargar-archivo    --no-verify-jwt
npx supabase@latest functions deploy crear-preferencia-mp --no-verify-jwt
npx supabase@latest functions deploy confirmar-pago       --no-verify-jwt
npx supabase@latest functions deploy previsualizar        --no-verify-jwt
npx supabase@latest functions deploy webhook-mercadopago  --no-verify-jwt
```

> `--no-verify-jwt` es necesario: `webhook-mercadopago` y `previsualizar` son
> públicas, y las demás leen el JWT manualmente para dar errores claros.

Antes de desplegar conviene verificar tipos (evita subir código roto):
```bash
npx deno@latest check supabase/functions/*/index.ts
```

### Registrar el webhook en Mercado Pago
En el panel de MP → **Webhooks**, agrega la URL:
```
https://cluvaxxqvhtxxiwctpnl.supabase.co/functions/v1/webhook-mercadopago
```
Evento: **Pagos** (`payment`). Copia la **clave secreta** que MP muestra ahí y
guárdala como `MP_WEBHOOK_SECRET`.

---

## 5. Activar tu cuenta de administrador

El admin se identifica por email: **jorgequezadarm@gmail.com** (en `es_admin()` y
en `tienda/js/tienda-common.js → ADMIN_EMAIL`). Si cambias de correo, actualiza
ambos lugares.

1. Regístrate en la tienda con ese correo (`tienda/login.html`).
2. Entra a `tienda/admin.html` → verás el panel completo.

---

## 6. Primeros pasos en el admin

1. **Productos**: cada proyecto de `dosificacion_proyectos` aparece listado.
   Haz clic en **Vincular**, pega los **file IDs de Drive** (PDF, DOCX, previews,
   anexos), pon precios y marca **activo**. Guarda → aparece en el catálogo.
2. **Órdenes**: monitoreo. En el flujo normal **no tienes que hacer nada**: los
   pagos se acreditan solos. Una orden en *pendiente* es un pago en efectivo o
   SPEI que el banco aún no confirma, o un intento abandonado (se archiva sola
   a los 8 días). **Confirmar pago** queda solo para casos excepcionales.
3. **Acceso manual**: da acceso a alguien por correo (p. ej. cortesías o ventas
   por fuera).

---

## 7. Si un comprador dice que pagó y no ve su paquete

1. Que entre a **Mis compras** y pulse *"Ya pagué — verificar ahora"*. Eso
   consulta el pago real en MP y entrega el acceso al momento si está aprobado.
2. Si sigue sin aparecer, revisa los logs de `webhook-mercadopago` y
   `confirmar-pago` en el Dashboard de Supabase → Edge Functions → Logs.
3. Comprueba en el panel de MP si el pago está *approved* o aún *pending*
   (efectivo y SPEI tardan). Con `external_reference` localizas la orden.
4. Último recurso: **Acceso manual** en el admin.

---

## 8. Pie de página de los archivos

- **PDF**: se añade en cada hoja `Adquirido por: <nombre> | <correo> | Uso personal,
  no para distribución`. No se puede quitar fácilmente.
- **DOCX**: se inyecta el mismo texto en el pie. El comprador puede borrarlo —
  por eso la versión editable cuesta más.

---

## 9. Pendiente de seguridad importante (recomendación)

Las tablas `dosificacion_proyectos`, `dosificacion_sesiones`, `dosificacion_pdas`,
etc. tienen **RLS deshabilitado** desde antes de este sprint. Eso significa que su
contenido (estructura de la planeación, PDAs, sesiones) es **legible por cualquiera**
vía la API pública de Supabase.

- El **producto que se vende** (PDF/DOCX con formato) está en Drive y protegido por
  los accesos + Edge Function, así que el riesgo de "descarga gratis del producto"
  es bajo.
- Pero la **estructura/contenido** de las planeaciones sí queda expuesta.

Antes de un lanzamiento público amplio conviene decidir una política de RLS para
las tablas `dosificacion_*` (por ejemplo: lectura solo vía Edge Function con
service role, o lectura pública solo de metadatos no sensibles). No se cambió aquí
porque afecta al bot generador y al `marketplace.html` interno del SaaS.

---

## 10. Despliegue del frontend

La tienda es HTML/JS estático. Se sirve igual que el resto del proyecto
(Cloudflare Pages / Live Server). Rutas:
- Entrada pública: `index.html` (raíz) → redirige a `tienda/index.html`.
- El SaaS completo queda oculto; los usuarios con `perfiles.activo_saas = true`
  entran al dashboard tras iniciar sesión en la tienda.
