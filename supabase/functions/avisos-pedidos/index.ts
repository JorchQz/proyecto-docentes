// Edge Function: avisos-pedidos (la llama pg_cron una vez al día)
//
// Revisa los pedidos a la medida pagados y sin entregar y, si hay alguno
// vencido (pasó su fecha comprometida) o por vencer en las próximas 24 h,
// manda UN correo al negocio (MAIL_ADMIN) desde soporte@jissez.com con la
// lista. Si no hay nada que avisar, no manda nada.
//
// Es la parte "que también avise a Jorge" del punto 9.c del documento: el
// badge "Vencido" del admin solo se ve si alguien abre el panel.
//
// POST /functions/v1/avisos-pedidos
//   header: x-cron-secret: <CRON_SECRET>   (lo pone el job de pg_cron)
//   → { vencidos, por_vencer, correo_enviado }
//
// Programación: supabase/marketplace_avisos_cron.sql (8:00 hora del centro).

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { crearAdmin, mensajeError } from "../_shared/db.ts";
import { aulaDePedido } from "../_shared/pagos.ts";
import {
  botonCorreo,
  enviarCorreo,
  escaparHtml,
  estiloNota,
  estiloTexto,
  estiloTitulo,
  plantillaCorreo,
} from "../_shared/correo.ts";

function fecha(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const secreto = Deno.env.get("CRON_SECRET");
    if (!secreto || req.headers.get("x-cron-secret") !== secreto) {
      return jsonResponse({ error: "No autorizado" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const destino = Deno.env.get("MAIL_ADMIN");
    const admin = crearAdmin(supabaseUrl, serviceKey);

    const { data: pedidos, error } = await admin
      .from("marketplace_pedidos")
      .select("numero_pedido, estado, nivel, organizacion, grados, grados_combo, nombre_cliente, fecha_compromiso_entrega")
      .in("estado", ["pendiente", "en_proceso"])
      .not("fecha_compromiso_entrega", "is", null)
      .order("fecha_compromiso_entrega", { ascending: true });
    if (error) return jsonResponse({ error: error.message }, 500);

    const ahora = Date.now();
    const en24h = ahora + 24 * 60 * 60 * 1000;
    const vencidos = (pedidos || []).filter((p) => new Date(p.fecha_compromiso_entrega).getTime() < ahora);
    const porVencer = (pedidos || []).filter((p) => {
      const t = new Date(p.fecha_compromiso_entrega).getTime();
      return t >= ahora && t <= en24h;
    });

    let correoEnviado = false;
    if ((vencidos.length || porVencer.length) && resendKey && destino) {
      const fila = (p: any) =>
        `<li style="margin-bottom:6px"><strong>${escaparHtml(p.numero_pedido)}</strong> · ${escaparHtml(aulaDePedido(p))} · ${
          escaparHtml(p.nombre_cliente || "")
        } · ${p.estado === "en_proceso" ? "en elaboración" : "en cola"} · compromiso ${escaparHtml(fecha(p.fecha_compromiso_entrega))}</li>`;
      const html = plantillaCorreo(`
        <h1 style="${estiloTitulo}">${vencidos.length ? vencidos.length + " pedido(s) vencido(s)" : "Pedidos por vencer"}</h1>
        ${vencidos.length
          ? `<p style="${estiloTexto}">Ya pasó la fecha comprometida. El cliente puede pedir el reembolso total (Términos 6.3):</p>
             <ul style="padding-left:18px;margin:12px 0 0;color:#b91c1c;font-size:15px">${vencidos.map(fila).join("")}</ul>`
          : ""}
        ${porVencer.length
          ? `<p style="${estiloTexto};margin-top:18px">Vencen en las próximas 24 horas:</p>
             <ul style="padding-left:18px;margin:12px 0 0;color:#1c2434;font-size:15px">${porVencer.map(fila).join("")}</ul>`
          : ""}
        ${botonCorreo(siteUrl + "/tienda/admin", "Abrir el panel de pedidos")}
        <p style="${estiloNota}">Aviso automático diario. Solo llega cuando hay algo pendiente.</p>
      `);
      correoEnviado = await enviarCorreo(
        resendKey,
        destino,
        (vencidos.length ? "VENCIDOS: " + vencidos.length + " pedido(s) a la medida" : "Pedidos a la medida por vencer") + " — Jissez",
        html,
      );
    }

    return jsonResponse({ vencidos: vencidos.length, por_vencer: porVencer.length, correo_enviado: correoEnviado });
  } catch (err) {
    console.error("avisos-pedidos error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
