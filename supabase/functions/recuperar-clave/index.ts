// Edge Function: recuperar-clave
//
// Envía el correo de "olvidé mi contraseña" con nuestra plantilla, en español
// y con la marca. Supabase Auth manda el suyo en inglés y sus plantillas
// personalizadas no se aplicaban aunque quedaran guardadas en la configuración
// del proyecto, así que generamos el enlace nosotros y lo enviamos por Resend.
//
// POST /functions/v1/recuperar-clave
//   body: { email: string, redirect_to?: string }
//
// Responde 200 exista o no la cuenta: distinguir revelaría qué correos están
// registrados en la tienda.

import { crearAdmin, mensajeError } from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  botonCorreo,
  enlaceCopiable,
  enviarCorreo,
  estiloNota,
  estiloTexto,
  estiloTitulo,
  plantillaCorreo,
} from "../_shared/correo.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY") || undefined;
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    // SEGURIDAD: redirect_to NO se toma tal cual del cliente. El enlace del correo
    // lleva el token de recuperación; si redirigiera a un dominio ajeno sería una
    // toma de cuenta. Solo se acepta si apunta a nuestro propio sitio.
    const destinoDefault = siteUrl + "/reset-password";
    const pedido = String(body.redirect_to || "");
    const redirectTo = (siteUrl && pedido.startsWith(siteUrl + "/"))
      ? pedido
      : destinoDefault;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Correo inválido" }, 400);
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);

    // generateLink crea el enlace de recuperación SIN enviar correo, que es
    // justo lo que queremos: el envío lo hacemos nosotros.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    // Cuenta inexistente: se responde igual que si existiera.
    if (error || !data?.properties?.action_link) {
      // No se registra el correo para no dejar direcciones de usuarios en logs.
      console.log("recuperar-clave: sin enlace", error?.message);
      return jsonResponse({ ok: true });
    }

    const enlace = data.properties.action_link;

    const html = plantillaCorreo(`
      <h1 style="${estiloTitulo}">Crea una contraseña nueva</h1>
      <p style="${estiloTexto}">
        Pediste recuperar el acceso a tu cuenta de Jissez. Pulsa el botón y elige
        una contraseña nueva.
      </p>
      ${botonCorreo(enlace, "Crear contraseña nueva")}
      <p style="margin:0 0 14px;color:#5b6473;font-size:14px;line-height:1.65">
        El enlace caduca en una hora. Si el botón no funciona, copia esta dirección
        y pégala en tu navegador:
      </p>
      ${enlaceCopiable(enlace)}
      <p style="${estiloNota}">
        <strong style="color:#1c2434">Si no pediste esto</strong>, ignora el correo:
        tu contraseña sigue igual y tus planeaciones siguen en tu cuenta.
      </p>
    `);

    const enviado = await enviarCorreo(
      resendKey,
      email,
      "Recupera el acceso a tu cuenta de Jissez",
      html,
    );
    if (!enviado) {
      console.error("recuperar-clave: no se pudo enviar a", email);
      return jsonResponse(
        { error: "No pudimos enviar el correo. Inténtalo en unos minutos." },
        502,
      );
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("recuperar-clave error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
