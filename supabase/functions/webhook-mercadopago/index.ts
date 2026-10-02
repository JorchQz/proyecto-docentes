// Edge Function: webhook-mercadopago
//
// Notificación automática de Mercado Pago. Valida la firma, reconsulta el pago
// real contra la API de MP (nunca confía en el cuerpo recibido) y delega en
// `procesarPago()`, el mismo camino que usa la verificación manual.
//
// POST /functions/v1/webhook-mercadopago
// (La llama Mercado Pago; no lleva JWT de usuario.)
//
// Códigos de respuesta (R29, decisión de Jorge del 2026-09-26):
//   401 → firma inválida.
//   503 → también si Mercado Pago o la red fallan al consultar el pago (5xx, 429, timeout): no se
//         escribe nada. Un 404 (pago inexistente) es definitivo y sigue en 200.
//   503 → falla pasajera al procesar el pago (la base no respondió: no se pudo leer la orden ni saber
//         si es de Mi Salón, timeout, 5xx de PostgREST, escritura fallida). La orden NO quedó
//         pagada; Mercado Pago reintenta el mismo aviso solo y `procesarPago()` es idempotente, así
//         que el reintento entrega una vez (un acceso, un correo).
//   200 → todo lo demás, también las respuestas definitivas que no se arreglan reintentando: orden
//         desconocida, ya procesada, pago rechazado o pendiente, importe o moneda que no cuadran,
//         notificación que no es de pago, pago que Mercado Pago no devuelve. Un error ahí haría que
//         MP reintentara durante días algo que no cambia.

import { crearAdmin, mensajeError } from "../_shared/db.ts";
import { jsonResponse } from "../_shared/cors.ts";
import {
  consultarPago,
  ErrorMpPasajero,
  firmaWebhookValida,
  procesarPago,
  type ResultadoPago,
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
    // SEGURIDAD: el id de la QUERY es el que MP incluye en el manifiesto firmado.
    // Debe ser también el que se consulta, para que firma y pago sean el MISMO id.
    // El id del body solo se usa como respaldo cuando la query no lo trae.
    const url = new URL(req.url);
    const idQuery = url.searchParams.get("data.id") || url.searchParams.get("id");
    let paymentId = idQuery;
    let topic = url.searchParams.get("type") || url.searchParams.get("topic");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (!paymentId && body?.data?.id) paymentId = String(body.data.id);
        if (body?.type) topic = String(body.type);
      } catch (_) {
        // cuerpo vacío o no-JSON: nos quedamos con los query params
      }
    }

    // Se firma y se consulta el MISMO id (paymentId), no uno de la query y otro
    // del body.
    if (!(await firmaWebhookValida(req, paymentId, webhookSecret))) {
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

    let pago: Record<string, any> | null;
    try {
      pago = await consultarPago(paymentId, mpToken);
    } catch (err) {
      if (!(err instanceof ErrorMpPasajero)) throw err;
      // Mercado Pago (5xx, 429, timeout) o la red fallaron: no se escribió nada; MP reintenta el aviso.
      console.error("webhook: falla pasajera al consultar a Mercado Pago, 503 para que MP reintente", {
        paymentId, error: mensajeError(err),
      });
      return jsonResponse({ ok: false, transitorio: true, error: mensajeError(err) }, 503);
    }
    if (!pago) {
      return jsonResponse({ error: "No se pudo consultar el pago" });
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);
    let resultado: ResultadoPago;
    try {
      resultado = await procesarPago(admin, pago, { siteUrl, resendKey });
    } catch (err) {
      // procesarPago solo lanza por una falla de la base (p. ej. no se pudo saber si la orden es de
      // Mi Salón): la orden quedó sin tocar y reintentar la resuelve.
      console.error("webhook: falla pasajera (excepción), 503 para que MP reintente", {
        paymentId, orden: pago.external_reference, error: mensajeError(err),
      });
      return jsonResponse({ ok: false, transitorio: true, error: mensajeError(err) }, 503);
    }

    if (resultado.transitorio) {
      console.error("webhook: falla pasajera, 503 para que MP reintente", {
        paymentId, orden: pago.external_reference, error: resultado.error,
      });
      return jsonResponse(resultado, 503);
    }

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
    // 200 a propósito (fuera de procesarPago: cuerpo, variables, consulta a MP): evita reintentos en
    // bucle por algo que no se arregla solo. El error queda en logs.
    return jsonResponse({ error: mensajeError(err) }, 200);
  }
});
