// Edge Function: avisos-mi-salon  (b22, spec de Jorge 2026-09-26 §7; la llama pg_cron cada hora)
//
// Manda por correo los avisos de Mi Salón que tocan hoy. QUÉ se manda y A QUIÉN lo decide la
// base (mi_salon_correos_pendientes): el calendario de avisos (mi_salon_avisos, fechas
// relativas a mi_salon_periodos: nunca fechas escritas en el código), el recordatorio de un
// pago en efectivo (OXXO) que sigue pendiente a las 24 horas, el aviso de vigencia extendida y
// el aviso de lanzamiento a las cuentas que ya existían al encender Mi Salón (decisión de Jorge,
// 2026-09-26). Solo con Mi Salón abierto (la base no devuelve nada con el interruptor apagado).
//
// Idempotente por cuenta y aviso: antes de enviar se aparta la fila (docente_id, tipo) en
// mi_salon_correos (llave primaria); si ya existía, no se manda otra vez. Si Resend falla, se
// quita la fila y la siguiente corrida lo reintenta. Se puede correr cada hora sin repetir nada.
//
// Dos formas de llamarla:
//   1. El cron:   header x-cron-secret: <CRON_SECRET>. Todo lo que toca hoy, entre las 8:00 y
//                 las 21:00 (hora del centro).
//                 body opcional: { simular: true } → solo dice qué saldría (sin apartar ni enviar)
//                                { hoy: 'AAAA-MM-DD' } → los avisos de esa fecha, sin revisar el
//                                                        horario (pruebas o un envío manual)
//   2. El panel:  Authorization: Bearer <sesión de la cuenta admin>, body { solo: 'lanzamiento' }.
//                 Solo el aviso de lanzamiento, en tandas (el panel la llama hasta que no queden).
//                 La base revisa que la sesión sea del admin (es_admin).
//   → { pendientes, enviados, fallidos, omitidos, restantes, fuera_de_horario? }
//
// Programación: supabase/mi_salon_b22_avisos_cron_2026-09.sql.
// Secretos: CRON_SECRET, RESEND_API_KEY, MAIL_FROM, SITE_URL.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { crearAdmin, crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import {
  botonCorreo,
  enviarCorreo,
  escaparHtml,
  estiloNota,
  estiloTexto,
  estiloTitulo,
  plantillaCorreo,
} from "../_shared/correo.ts";

// Tope por corrida (Resend limita las peticiones por segundo); lo demás sale en la siguiente
// hora o en la siguiente tanda del panel
const MAX_POR_CORRIDA = 150;
const MAX_POR_TANDA_PANEL = 40;
const PAUSA_MS = 550;

function horaMexico(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(d));
}

/** Enlace del botón: una ruta del sitio o una dirección completa (la ficha de OXXO). */
export function urlBoton(ruta: string | null | undefined, siteUrl: string): string {
  const r = String(ruta || "/dashboard");
  return /^https:\/\//.test(r) ? r : siteUrl + (r.startsWith("/") ? r : "/" + r);
}

// deno-lint-ignore no-explicit-any
export function htmlAviso(f: Record<string, any>, siteUrl: string): string {
  return plantillaCorreo(`
    <h1 style="${estiloTitulo}">${escaparHtml(f.asunto)}</h1>
    <p style="${estiloTexto}">${escaparHtml(f.texto)}</p>
    ${f.boton_texto ? botonCorreo(urlBoton(f.boton_ruta, siteUrl), f.boton_texto) : ""}
    <p style="${estiloNota}">Aviso de Mi Salón. Tus datos se quedan guardados siempre, también cuando termina tu acceso.</p>
  `);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const siteUrl = (Deno.env.get("SITE_URL") || "https://jissez.com").replace(/\/+$/, "");
    const resendKey = Deno.env.get("RESEND_API_KEY") || undefined;
    const secreto = Deno.env.get("CRON_SECRET");
    const admin = crearAdmin(supabaseUrl, serviceKey);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* sin cuerpo */ }

    const esCron = !!secreto && req.headers.get("x-cron-secret") === secreto;
    const authHeader = req.headers.get("Authorization") || "";
    const esPanel = !esCron && body.solo === "lanzamiento" && authHeader.startsWith("Bearer ");
    if (!esCron && !esPanel) return jsonResponse({ error: "No autorizado" }, 403);

    const simular = esCron && body.simular === true;
    // Fecha a mano (solo con el secreto del cron). Sin ella, hoy y solo en horario.
    const hoy = esCron && typeof body.hoy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.hoy) ? body.hoy : null;

    let lista: Array<Record<string, unknown>>;
    let tope = MAX_POR_CORRIDA;
    if (esPanel) {
      // Con la sesión de la cuenta: la base solo contesta al admin (es_admin, 42501 si no)
      const usuario = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
      const { data, error } = await usuario.rpc("mi_salon_correos_pendientes", { p_solo: "lanzamiento" });
      if (error) return jsonResponse({ error: "No autorizado" }, 403);
      lista = (data || []) as Array<Record<string, unknown>>;
      tope = MAX_POR_TANDA_PANEL;
    } else {
      const hora = horaMexico(new Date());
      if (!simular && !hoy && (hora < 8 || hora >= 21)) return jsonResponse({ fuera_de_horario: true, hora });
      const { data, error } = await admin.rpc("mi_salon_correos_pendientes", hoy ? { p_hoy: hoy } : {});
      if (error) return jsonResponse({ error: error.message }, 500);
      lista = (data || []) as Array<Record<string, unknown>>;
    }
    if (simular) {
      return jsonResponse({ pendientes: lista.length, simulado: lista.map((f) => ({ email: f.email, tipo: f.tipo, asunto: f.asunto })) });
    }
    // Sin proveedor de correo (por ejemplo, el proyecto de pruebas) no se aparta nada
    if (!resendKey) return jsonResponse({ pendientes: lista.length, enviados: 0, restantes: lista.length, motivo: "sin_correo_configurado" });

    let enviados = 0, fallidos = 0, omitidos = 0;
    const tanda = lista.slice(0, tope);
    for (const f of tanda) {
      const { data: apartada, error: apErr } = await admin.from("mi_salon_correos")
        .upsert({ docente_id: f.docente_id, tipo: f.tipo }, { onConflict: "docente_id,tipo", ignoreDuplicates: true })
        .select("docente_id");
      if (apErr || !apartada || !apartada.length) { omitidos++; continue; }
      const ok = await enviarCorreo(resendKey, String(f.email), String(f.asunto), htmlAviso(f, siteUrl));
      if (ok) {
        enviados++;
      } else {
        fallidos++;
        await admin.from("mi_salon_correos").delete().eq("docente_id", f.docente_id).eq("tipo", f.tipo);
      }
      await new Promise((r) => setTimeout(r, PAUSA_MS));
    }
    return jsonResponse({ pendientes: lista.length, enviados, fallidos, omitidos, restantes: Math.max(0, lista.length - tanda.length) + fallidos });
  } catch (err) {
    console.error("avisos-mi-salon error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
