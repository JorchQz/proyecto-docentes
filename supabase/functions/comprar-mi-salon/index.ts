// Edge Function: comprar-mi-salon  (b22, spec de Jorge 2026-09-26 §3 y §6)
//
// Prepara el cobro de Mi Salón: la BASE cotiza (precio fundador, de lista o con cupón, y qué
// periodos cubre según la fecha) y registra la orden (mi_salon_registrar_orden); aquí solo se
// crea la preferencia de Checkout Pro y se devuelve el init_point. Pago único por producto,
// igual que la tienda: tarjeta, SPEI y efectivo (OXXO), con la misma configuración de cuotas.
// Nada de suscripción ni cobro automático.
//
// El acceso NO se da aquí: lo crea el webhook (webhook-mercadopago → procesarPago →
// procesarPagoMiSalon) cuando llega el pago aprobado.
//
// POST /functions/v1/comprar-mi-salon
//   body: { producto: 'trimestre' | 'resto_ciclo' | 'ciclo', cupon?: string,
//           acepta_terminos: true, nuevo?: boolean }
//     nuevo: true para pagar otra vez cuando hay un pago pendiente (OXXO sin pagar).
//   header: Authorization: Bearer <access_token de la cuenta>
//   → 200 { orden_id, preference_id, init_point, sandbox, precio, cupon, cupon_motivo, vence }
//   → 409 { error, motivo: 'cerrada' | 'ya_cubierto' | 'fuera_de_venta' | 'pago_pendiente' | ..., pendiente? }
//
// Secretos: MP_ACCESS_TOKEN, SITE_URL (https, sin barra final) y los de Supabase.

import { crearAdmin, crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Iguales que en crear-preferencia-mp (la tienda): la preferencia caduca a los 7 días (margen
// para un pago en efectivo) y se ofrecen hasta 12 mensualidades con el banco (no son meses sin
// intereses).
const DIAS_VIGENCIA = 7;
const MAX_MENSUALIDADES = 12;
const PRODUCTOS = ["trimestre", "resto_ciclo", "ciclo"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "No autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN") || "";
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
    if (!mpToken) return jsonResponse({ error: "Falta configurar MP_ACCESS_TOKEN" }, 500);
    if (!siteUrl.startsWith("https://")) {
      return jsonResponse({ error: "SITE_URL debe ser una URL https sin barra final" }, 500);
    }

    const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: "Sesión inválida" }, 401);
    const user = userData.user;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* sin cuerpo */ }
    const producto = String(body.producto || "");
    if (!PRODUCTOS.includes(producto)) return jsonResponse({ error: "Parámetros inválidos" }, 400);
    const cupon = typeof body.cupon === "string" && body.cupon.trim() ? body.cupon.trim().toUpperCase().slice(0, 24) : null;
    if (body.acepta_terminos !== true) {
      return jsonResponse({ error: "Para continuar debes aceptar los Términos y Condiciones y el Aviso de Privacidad.", terminos: true }, 400);
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);
    const { data: reg, error: regErr } = await admin.rpc("mi_salon_registrar_orden", {
      p_uid: user.id,
      p_producto: producto,
      p_cupon: cupon,
      p_terminos_en: new Date().toISOString(),
      p_nuevo: body.nuevo === true,
    });
    if (regErr || !reg) {
      console.error("mi_salon_registrar_orden falló:", regErr);
      return jsonResponse({ error: "No pudimos preparar tu compra. Vuelve a intentarlo." }, 503);
    }
    if (!reg.ok) {
      return jsonResponse({ error: reg.error || "Esta opción no está disponible.", motivo: reg.motivo, pendiente: reg.pendiente ?? null, cotizacion: reg.cotizacion ?? null }, 409);
    }

    const ordenId = String(reg.orden_id);
    const precio = Number(reg.precio);
    const ahora = new Date();
    const vence = new Date(ahora.getTime() + DIAS_VIGENCIA * 24 * 60 * 60 * 1000);
    const regreso = siteUrl + "/tienda/mi-salon-compra?orden=" + encodeURIComponent(ordenId);

    const prefBody = {
      items: [{
        id: "mi-salon-" + producto,
        title: String(reg.titulo || "Mi Salón"),
        description: "Acceso a Mi Salón (Jissez) por periodo escolar",
        category_id: "learnings",
        quantity: 1,
        unit_price: precio,
        currency_id: "MXN",
      }],
      external_reference: ordenId,
      payer: { email: user.email },
      back_urls: { success: regreso, pending: regreso, failure: regreso },
      auto_return: "approved",
      notification_url: supabaseUrl + "/functions/v1/webhook-mercadopago",
      statement_descriptor: "JISSEZ",
      // Todos los medios (cuenta MP, tarjeta, efectivo y SPEI), igual que la tienda
      payment_methods: { installments: MAX_MENSUALIDADES },
      expires: true,
      expiration_date_from: ahora.toISOString(),
      expiration_date_to: vence.toISOString(),
      metadata: { orden_id: ordenId, seccion: "mi_salon", producto, user_id: user.id, cupon: reg.cupon ?? null },
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + mpToken,
        "Content-Type": "application/json",
        // Doble clic: la misma orden da la misma preferencia
        "X-Idempotency-Key": ordenId,
      },
      body: JSON.stringify(prefBody),
    });
    if (!mpResp.ok) {
      console.error("MP preference error (Mi Salón):", mpResp.status, await mpResp.text());
      await admin.from("marketplace_ordenes").update({ estado: "fallido" }).eq("id", ordenId);
      return jsonResponse({ error: "No se pudo iniciar el pago" }, 502);
    }
    const pref = await mpResp.json();
    await admin.from("marketplace_ordenes").update({ referencia_pago: pref.id }).eq("id", ordenId);

    // Credenciales TEST- → sandbox_init_point (igual que la tienda)
    const sandbox = mpToken.startsWith("TEST-");
    return jsonResponse({
      orden_id: ordenId,
      preference_id: pref.id,
      init_point: sandbox ? (pref.sandbox_init_point || pref.init_point) : pref.init_point,
      sandbox,
      // Eco del importe: la página no redirige si difiere de lo que tiene pintado
      precio,
      cupon: reg.cupon ?? null,
      cupon_motivo: reg.cupon_motivo ?? null,
      vence: reg.cotizacion?.vence_acceso ?? null,
    });
  } catch (err) {
    console.error("comprar-mi-salon error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
