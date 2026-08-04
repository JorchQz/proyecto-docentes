// Edge Function: confirmar-pago
//
// Red de seguridad del flujo de compra. El webhook de Mercado Pago es la vía
// normal, pero puede retrasarse, perderse o fallar; sin esto el comprador paga
// y se queda sin su paquete.
//
// Se llama en dos momentos:
//   1. Al volver de Mercado Pago (mis-compras.html?payment_id=...)
//   2. Cuando el comprador pulsa "Ya pagué — verificar" en un pedido pendiente
//
// Consulta el pago REAL en la API de MP y, si está aprobado, entrega el acceso
// por el mismo camino que el webhook (`procesarPago`, idempotente).
//
// POST /functions/v1/confirmar-pago
//   body: { orden_id?: uuid, payment_id?: string }   (ambos opcionales)
//   header: Authorization: Bearer <access_token del usuario>
//
// Sin parámetros revisa todas las órdenes pendientes del usuario.

import {
  type Cliente,
  crearAdmin,
  crearClienteUsuario,
  mensajeError,
} from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  buscarPagoPorOrden,
  consultarPago,
  procesarPago,
} from "../_shared/pagos.ts";

// Cuántas órdenes pendientes revisamos como máximo en una llamada sin
// parámetros, para no encadenar decenas de peticiones a MP.
const MAX_ORDENES_REVISADAS = 10;

// Margen antes de dar por abandonada una orden sin ningún pago en MP. Amplio a
// propósito: más vale dejarla en proceso de más que cerrarle la compra a
// alguien que sí está pagando.
const HORAS_PARA_DESCARTAR = 2;

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
    const resendKey = Deno.env.get("RESEND_API_KEY") || undefined;

    const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Sesión inválida" }, 401);
    }
    const user = userData.user;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch (_) {
      // sin cuerpo: revisamos todas las pendientes
    }
    const ordenIdPedida = body.orden_id ? String(body.orden_id) : null;
    const paymentIdPedido = body.payment_id ? String(body.payment_id) : null;
    const accion = body.accion ? String(body.accion) : null;

    const admin = crearAdmin(supabaseUrl, serviceKey);

    // ── Cancelar un intento a mano ──────────────────────────────────────────
    // El descarte automático espera 2 horas por prudencia; esto deja al
    // comprador quitar de su lista un intento que sabe que no completó.
    //
    // Cancelar no pierde dinero: si más tarde llegara el pago, `procesarPago`
    // acredita igual y otorga el acceso, venga del webhook o de una
    // verificación posterior.
    if (accion === "cancelar") {
      if (!ordenIdPedida) {
        return jsonResponse({ error: "Falta la orden a cancelar" }, 400);
      }
      if (!(await ordenEsDelUsuario(admin, ordenIdPedida, user.id))) {
        return jsonResponse({ error: "Esa orden no es tuya" }, 403);
      }
      const { data: orden } = await admin
        .from("marketplace_ordenes")
        .select("estado")
        .eq("id", ordenIdPedida)
        .maybeSingle();
      if (orden?.estado === "pagado") {
        return jsonResponse(
          { error: "Esa compra ya está pagada, no se puede cancelar" },
          409,
        );
      }
      await admin
        .from("marketplace_ordenes")
        .update({ estado: "fallido" })
        .eq("id", ordenIdPedida);
      return jsonResponse({
        resultados: [{ orden_id: ordenIdPedida, ok: true, estado: "fallido", statusMp: "cancelada" }],
      });
    }

    // ── Caso 1: viene payment_id (regreso directo desde Mercado Pago) ───────
    if (paymentIdPedido) {
      const pago = await consultarPago(paymentIdPedido, mpToken);
      if (!pago) {
        return jsonResponse({ error: "No se pudo consultar el pago en Mercado Pago" }, 502);
      }
      // Blindaje: el pago debe corresponder a una orden de ESTE usuario.
      const duenio = await ordenEsDelUsuario(admin, pago.external_reference, user.id);
      if (!duenio) {
        return jsonResponse({ error: "Ese pago no corresponde a tu cuenta" }, 403);
      }
      const resultado = await procesarPago(admin, pago, { siteUrl, resendKey });
      return jsonResponse({ resultados: [{ orden_id: pago.external_reference, ...resultado }] });
    }

    // ── Caso 2: órdenes concretas o todas las pendientes del usuario ────────
    let ordenIds: string[] = [];
    if (ordenIdPedida) {
      const duenio = await ordenEsDelUsuario(admin, ordenIdPedida, user.id);
      if (!duenio) {
        return jsonResponse({ error: "Esa orden no es tuya" }, 403);
      }
      ordenIds = [ordenIdPedida];
    } else {
      const { data: pendientes } = await admin
        .from("marketplace_ordenes")
        .select("id")
        .eq("user_id", user.id)
        .eq("estado", "pendiente")
        .eq("metodo_pago", "mercadopago")
        .order("created_at", { ascending: false })
        .limit(MAX_ORDENES_REVISADAS);
      ordenIds = (pendientes || []).map((o: { id: string }) => o.id);
    }

    if (!ordenIds.length) {
      return jsonResponse({ resultados: [], sin_pendientes: true });
    }

    const resultados = [];
    for (const ordenId of ordenIds) {
      const pago = await buscarPagoPorOrden(ordenId, mpToken);
      if (!pago) {
        // Sin ningún pago en MP: o acaba de empezar, o se abandonó el intento.
        const abandonada = await descartarSiAbandonada(admin, ordenId);
        resultados.push({
          orden_id: ordenId,
          ok: true,
          estado: abandonada ? "fallido" : "pendiente",
          statusMp: abandonada ? "abandonada" : "sin_pago",
        });
        continue;
      }
      const resultado = await procesarPago(admin, pago, { siteUrl, resendKey });
      resultados.push({ orden_id: ordenId, ...resultado });
    }

    return jsonResponse({ resultados });
  } catch (err) {
    console.error("confirmar-pago error:", err);
    return jsonResponse(
      { error: "Error interno: " + mensajeError(err) },
      500,
    );
  }
});

/**
 * Cierra los intentos de compra que se abandonaron.
 *
 * Si Mercado Pago no tiene NINGÚN pago para la orden, es que el comprador
 * nunca completó el checkout: incluso pagar en efectivo registra un pago
 * `pending` en cuanto se genera el cupón. Dejar esas órdenes en "en proceso"
 * para siempre hace que el comprador pulse "verificar" una y otra vez sin que
 * nada cambie.
 *
 * Se da un margen por si acaba de empezar y MP todavía no lo registra.
 */
async function descartarSiAbandonada(
  admin: Cliente,
  ordenId: string,
): Promise<boolean> {
  const { data: orden } = await admin
    .from("marketplace_ordenes")
    .select("created_at, estado")
    .eq("id", ordenId)
    .maybeSingle();

  if (!orden || orden.estado !== "pendiente") return false;

  const horas = (Date.now() - new Date(orden.created_at).getTime()) / 3_600_000;
  if (horas < HORAS_PARA_DESCARTAR) return false;

  await admin
    .from("marketplace_ordenes")
    .update({ estado: "fallido" })
    .eq("id", ordenId);
  return true;
}

/** Evita que alguien confirme (o consulte) la orden de otra persona. */
async function ordenEsDelUsuario(
  admin: Cliente,
  ordenId: unknown,
  userId: string,
): Promise<boolean> {
  if (!ordenId) return false;
  const { data } = await admin
    .from("marketplace_ordenes")
    .select("id")
    .eq("id", String(ordenId))
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
