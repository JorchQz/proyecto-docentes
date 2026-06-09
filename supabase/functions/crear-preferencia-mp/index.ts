// Edge Function: crear-preferencia-mp
//
// Crea una orden 'pendiente' + su item y genera una preferencia de pago en
// Mercado Pago (Checkout Pro). Devuelve el init_point para redirigir al usuario.
//
// POST /functions/v1/crear-preferencia-mp
//   body: { producto_id: uuid, tipo: 'pdf' | 'editable' }
//   header: Authorization: Bearer <access_token del usuario>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "No autenticado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN")!;
    const siteUrl = Deno.env.get("SITE_URL") || "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Sesión inválida" }, 401);
    }
    const user = userData.user;

    const body = await req.json();
    const productoId = body.producto_id;
    const tipo = body.tipo;
    if (!productoId || (tipo !== "pdf" && tipo !== "editable")) {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Obtener producto + precio según tipo.
    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select("id, titulo, precio_pdf, precio_editable, activo")
      .eq("id", productoId)
      .maybeSingle();

    if (prodErr || !producto || !producto.activo) {
      return jsonResponse({ error: "Producto no disponible" }, 404);
    }

    const precio = tipo === "pdf" ? producto.precio_pdf : producto.precio_editable;
    if (precio == null) {
      return jsonResponse(
        { error: "Este producto no tiene precio para esa versión" },
        400,
      );
    }

    // Evitar compra duplicada del mismo tipo.
    const { data: yaTiene } = await admin
      .from("marketplace_accesos")
      .select("id")
      .eq("user_id", user.id)
      .eq("producto_id", productoId)
      .eq("tipo", tipo)
      .maybeSingle();
    if (yaTiene) {
      return jsonResponse({ error: "Ya tienes esta versión", ya_comprado: true }, 409);
    }

    // 1. Crear orden pendiente + item.
    const { data: orden, error: ordErr } = await admin
      .from("marketplace_ordenes")
      .insert({
        user_id: user.id,
        monto_total: precio,
        estado: "pendiente",
        metodo_pago: "mercadopago",
      })
      .select("id")
      .single();

    if (ordErr || !orden) {
      return jsonResponse({ error: "No se pudo crear la orden" }, 500);
    }

    await admin.from("marketplace_orden_items").insert({
      orden_id: orden.id,
      producto_id: productoId,
      tipo,
      precio_unitario: precio,
    });

    // 2. Crear preferencia en Mercado Pago.
    const tipoLabel = tipo === "pdf" ? "PDF" : "Editable (DOCX)";
    const prefBody = {
      items: [
        {
          id: productoId,
          title: producto.titulo + " — " + tipoLabel,
          quantity: 1,
          unit_price: Number(precio),
          currency_id: "MXN",
        },
      ],
      external_reference: orden.id,
      payer: { email: user.email },
      back_urls: {
        success: siteUrl + "/tienda/mis-compras.html?status=approved",
        pending: siteUrl + "/tienda/mis-compras.html?status=pending",
        failure: siteUrl + "/tienda/mis-compras.html?status=failure",
      },
      auto_return: "approved",
      notification_url: supabaseUrl + "/functions/v1/webhook-mercadopago",
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + mpToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prefBody),
    });

    if (!mpResp.ok) {
      const txt = await mpResp.text();
      console.error("MP preference error:", txt);
      // Marcar la orden como fallida para no dejarla colgada.
      await admin
        .from("marketplace_ordenes")
        .update({ estado: "fallido" })
        .eq("id", orden.id);
      return jsonResponse({ error: "No se pudo iniciar el pago" }, 502);
    }

    const pref = await mpResp.json();

    // Guardar el preference_id como referencia.
    await admin
      .from("marketplace_ordenes")
      .update({ referencia_pago: pref.id })
      .eq("id", orden.id);

    return jsonResponse({
      orden_id: orden.id,
      preference_id: pref.id,
      init_point: pref.init_point,
    });
  } catch (err) {
    console.error("crear-preferencia-mp error:", err);
    return jsonResponse(
      { error: "Error interno: " + (err?.message || String(err)) },
      500,
    );
  }
});
