# Guía: Twilio y WhatsApp para el apartado de familias (Fase 6)

Para qué sirve: el tutor entra a jissez.com/familias con su celular y recibe un código de 6 dígitos por WhatsApp (o por
SMS si no tiene WhatsApp). Supabase manda ese código con **Twilio Verify**. Desde marzo de 2024 WhatsApp exige que el
código salga de un **remitente propio** (un número de Jissez registrado en una cuenta de WhatsApp Business), y Meta tiene
que aprobarlo. Eso puede tardar días: por eso conviene empezar ya, mientras se construye la Fase 6.

Haz los pasos 1 a 5 ahora. El paso 6 (conectar con Supabase) lo hacemos juntos cuando la Fase 6 esté lista, porque
activar el inicio de sesión por teléfono en producción antes de tiempo dejaría crear cuentas por celular sin pantalla
para usarlas. **Nunca me mandes por el chat el Auth Token ni otras claves**: se pegan directo en Supabase.

## 1. Un número solo para Jissez
- Consigue un número de celular mexicano que **no** esté registrado en WhatsApp (un chip nuevo es lo más simple). Si ya
  tenía WhatsApp, hay que borrar esa cuenta de WhatsApp antes de registrarlo.
- Debe poder recibir un SMS o una llamada para verificarlo una sola vez. Después no hace falta tener el chip en un
  teléfono, pero guárdalo: si algún día hay que volver a verificar el número, se necesita.
- Comprar un número de Twilio en México también se puede, pero pide trámites (documentos de la empresa) y tarda más.

## 2. Cuenta de Twilio
1. Entra a twilio.com, crea la cuenta con el correo de Jissez y verifica tu correo y tu celular.
2. En la consola, **actualiza la cuenta a pago** (Upgrade) y carga saldo (20 dólares alcanzan para empezar). Con la cuenta
   de prueba solo se puede mandar a números verificados a mano.
3. Anota en un lugar seguro (no en el chat) el **Account SID** y el **Auth Token** (Console → Account Info).

## 3. Meta Business
1. En business.facebook.com crea (o usa) el portafolio de negocio de Jissez, con tu cuenta de Facebook.
2. Recomendado: en Configuración del negocio → Centro de seguridad, inicia la **verificación del negocio** (pide datos
   fiscales o un comprobante con el nombre y domicilio). Sin verificarlo se puede empezar, pero con límites bajos de
   envíos diarios; verificado, los límites suben.

## 4. Remitente de WhatsApp en Twilio
1. Consola de Twilio → Messaging → Senders → **WhatsApp senders** → crear (Self Sign-up).
2. Te pide entrar con Facebook: elige el portafolio de Jissez y crea la cuenta de WhatsApp Business (WABA).
3. Nombre para mostrar: **Jissez**. Meta revisa que el nombre coincida con la marca (el sitio jissez.com ayuda).
4. Escribe el número del paso 1 y verifícalo con el código que llega por SMS o llamada.
5. Espera la aprobación del nombre y del remitente. Twilio y Meta te avisan por correo.

## 5. Servicio de Verify
1. Consola de Twilio → Verify → Services → **Create new**. Nombre: `Jissez` (aparece en el mensaje: "Tu código de
   Jissez es 123456").
2. Activa los canales **SMS** y **WhatsApp**. En la parte de WhatsApp elige el remitente del paso 4 (cuando ya esté
   aprobado).
3. Longitud del código: 6. Vigencia: 10 minutos.
4. Anota el **Verify Service SID** (empieza con `VA`).
5. Si quieres probarlo antes: en la misma pantalla de Verify hay una opción para mandarte un código de prueba a tu
   propio celular por WhatsApp.

Avísame cuando tengas los pasos 4 y 5 aprobados (solo dime "listo", sin claves).

## 6. Conectar con Supabase (lo hacemos juntos con la Fase 6)
En Supabase (producción) → Authentication → Sign In / Providers → **Phone**:
- Activar Phone, proveedor **Twilio Verify**, pegar Account SID, Auth Token y Verify Service SID.
- Authentication → Attack Protection: activar **CAPTCHA** (Cloudflare Turnstile o hCaptcha) y límites de envío por número
  y por hora, para que nadie gaste saldo mandando códigos en masa.
- Las cuentas de familia no entran a Mi Salón ni reciben el T1 gratis (eso lo resuelve el código de la Fase 6).

## Costos aproximados
- Cada verificación con éxito cuesta unos centavos de dólar en Twilio, más la tarifa de Meta por mensaje de autenticación
  por WhatsApp. Por SMS a México sale más caro (alrededor de 0.2 dólares por código).
- Para 16 familias, el arranque cuesta menos de 2 dólares. Después solo se paga cuando alguien vuelve a entrar desde un
  teléfono nuevo, porque la sesión queda abierta en su teléfono.

Fuentes: documentación de Supabase (inicio de sesión por teléfono con Twilio) y de Twilio (Verify WhatsApp, remitente
propio, registro de remitentes con Self Sign-up).
