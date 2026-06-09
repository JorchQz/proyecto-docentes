// Edge Function: webhook-mercadopago
//
// Recibe la notificación IPN de Mercado Pago, confirma el pago consultando la
// API de MP, marca la orden como 'pagado' y otorga los accesos correspondientes.
//
// Regla de accesos al confirmar pago:
//   - compró 'pdf'      → accesos: pdf + anexos
//   - compró 'editable' → accesos: editable + pdf + anexos (incluye todo)
//
// POST /functions/v1/webhook-mercadopago
// (Mercado Pago llama aquí automáticamente; no requiere JWT de usuario.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN")!;

    // MP envía el id del pago de varias formas según la versión de notificación.
    const url = new URL(req.url);
    let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");
    let topic = url.searchParams.get("type") || url.searchParams.get("topic");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.data?.id) paymentId = String(body.data.id);
        if (body?.type) topic = String(body.type);
      } catch (_) {
        // cuerpo vacío o no-JSON: usamos los query params
      }
    }

    // Solo nos interesan notificaciones de pago.
    if (topic && topic !== "payment") {
      return jsonResponse({ ignored: true, topic });
    }
    if (!paymentId) {
      return jsonResponse({ error: "Sin payment id" }, 200); // 200 para que MP no reintente infinito
    }

    // Consultar el pago real en MP.
    const payResp = await fetch(
      "https://api.mercadopago.com/v1/payments/" + paymentId,
      { headers: { Authorization: "Bearer " + mpToken } },
    );
    if (!payResp.ok) {
      console.error("MP payment fetch failed:", await payResp.text());
      return jsonResponse({ error: "No se pudo consultar el pago" }, 200);
    }
    const pago = await payResp.json();

    const ordenId = pago.external_reference;
    const status = pago.status; // approved | pending | rejected | ...
    if (!ordenId) {
      return jsonResponse({ error: "Pago sin external_reference" }, 200);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Idempotencia: si la orden ya está pagada, no repetir.
    const { data: orden } = await admin
      .from("marketplace_ordenes")
      .select("id, estado, user_id")
      .eq("id", ordenId)
      .maybeSingle();

    if (!orden) {
      return jsonResponse({ error: "Orden no encontrada" }, 200);
    }
    if (orden.estado === "pagado") {
      return jsonResponse({ ok: true, already: true });
    }

    if (status !== "approved") {
      const nuevoEstado = status === "rejected" ? "fallido" : "pendiente";
      await admin
        .from("marketplace_ordenes")
        .update({ estado: nuevoEstado })
        .eq("id", ordenId);
      return jsonResponse({ ok: true, estado: nuevoEstado });
    }

    // Pago aprobado: marcar orden + otorgar accesos.
    await admin
      .from("marketplace_ordenes")
      .update({ estado: "pagado", referencia_pago: String(paymentId) })
      .eq("id", ordenId);

    const { data: items } = await admin
      .from("marketplace_orden_items")
      .select("producto_id, tipo")
      .eq("orden_id", ordenId);

    const accesos: Array<Record<string, unknown>> = [];
    for (const item of items || []) {
      const tipos =
        item.tipo === "editable"
          ? ["editable", "pdf", "anexos"]
          : ["pdf", "anexos"];
      for (const t of tipos) {
        accesos.push({
          user_id: orden.user_id,
          producto_id: item.producto_id,
          tipo: t,
          orden_id: ordenId,
        });
      }
    }

    if (accesos.length) {
      // upsert para no duplicar (UNIQUE user_id, producto_id, tipo)
      await admin
        .from("marketplace_accesos")
        .upsert(accesos, { onConflict: "user_id,producto_id,tipo", ignoreDuplicates: true });
    }

    return jsonResponse({ ok: true, accesos: accesos.length });
  } catch (err) {
    console.error("webhook-mercadopago error:", err);
    // 200 para evitar reintentos en bucle de MP; el error queda en logs.
    return jsonResponse({ error: String(err?.message || err) }, 200);
  }
});
