// Edge Function: webhook-mercadopago
//
// Notificación automática de Mercado Pago. Valida la firma, reconsulta el pago
// real contra la API de MP (nunca confía en el cuerpo recibido) y delega en
// `procesarPago()`, el mismo camino que usa la verificación manual.
//
// POST /functions/v1/webhook-mercadopago
// (La llama Mercado Pago; no lleva JWT de usuario.)
//
// Siempre responde 200 salvo firma inválida: si devolviéramos error, MP
// reintentaría en bucle durante días por un fallo que no se arregla solo.

import { crearAdmin, mensajeError } from "../_shared/db.ts";
import { jsonResponse } from "../_shared/cors.ts";
import {
  consultarPago,
  firmaWebhookValida,
  procesarPago,
} from "../_shared/pagos.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN")!;
    const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET") || undefined;
    const siteUrl = Deno.env.get("SITE_URL") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY") || undefined;

    // MP manda el id del pago de varias formas según la versión de notificación.
    const url = new URL(req.url);
    let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");
    let topic = url.searchParams.get("type") || url.searchParams.get("topic");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.data?.id) paymentId = String(body.data.id);
        if (body?.type) topic = String(body.type);
      } catch (_) {
        // cuerpo vacío o no-JSON: nos quedamos con los query params
      }
    }

    // La firma se valida contra el id que viene en la query (así lo arma MP).
    const idFirmado = url.searchParams.get("data.id") || url.searchParams.get("id") ||
      paymentId;
    if (!(await firmaWebhookValida(req, idFirmado, webhookSecret))) {
      console.error("Firma de webhook inválida", { paymentId, topic });
      return jsonResponse({ error: "Firma inválida" }, 401);
    }

    // Solo nos interesan notificaciones de pago (MP también manda merchant_order).
    if (topic && topic !== "payment") {
      return jsonResponse({ ignored: true, topic });
    }
    if (!paymentId) {
      return jsonResponse({ ignored: true, motivo: "sin payment id" });
    }

    const pago = await consultarPago(paymentId, mpToken);
    if (!pago) {
      return jsonResponse({ error: "No se pudo consultar el pago" });
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);
    const resultado = await procesarPago(admin, pago, { siteUrl, resendKey });

    console.log("webhook procesado", {
      paymentId,
      orden: pago.external_reference,
      statusMp: resultado.statusMp,
      estado: resultado.estado,
      accesos: resultado.accesos,
    });

    return jsonResponse(resultado);
  } catch (err) {
    console.error("webhook-mercadopago error:", err);
    // 200 a propósito: evita reintentos en bucle. El error queda en logs.
    return jsonResponse({ error: mensajeError(err) }, 200);
  }
});
