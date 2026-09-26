// Edge Function: bienvenida-mi-salon  (spec de Jorge 2026-09-26, §7.1: "Al crear la cuenta")
//
// Manda UNA vez el correo de bienvenida de Mi Salón:
//   "Te damos la bienvenida a Mi Salón. Tu primer trimestre es gratis: tienes acceso completo
//    hasta el [fecha]. Empieza con 'Ponte al día' para capturar lo que ya llevas."
// La fecha sale de la tabla de periodos (mi_salon_periodos, el periodo gratis de jissez_config),
// nunca del código.
//
// POST /functions/v1/bienvenida-mi-salon
//   header: Authorization: Bearer <access_token de la cuenta>
//   → { enviado: boolean, motivo? }
// La llama el login de la tienda (tienda/js/login.js) sin esperar respuesta, solo cuando el
// estado de la cuenta dice bienvenida_pendiente. Aquí se vuelve a decidir todo en el servidor:
//   - Mi Salón ABIERTO (jissez_config.mi_salon_abierto). Con el interruptor apagado no se manda.
//   - La cuenta se creó desde que se abrió Mi Salón (mi_salon_abierto_desde): a las cuentas que
//     ya existían no les llega de golpe.
//   - La cuenta tiene su acceso gratis del periodo gratis (el texto habla de ese regalo). Una
//     cuenta creada después (sin acceso gratis, decisión de Jorge 2026-09-26) no lo recibe.
//   - Correo confirmado.
// Idempotente: antes de enviar se "aparta" la fila (docente_id, 'bienvenida') en
// mi_salon_correos (llave primaria); si ya existía, no se manda otra vez. Si Resend falla, se
// quita la fila para que el siguiente inicio de sesión lo vuelva a intentar.
//
// Secretos: RESEND_API_KEY, MAIL_FROM y SITE_URL (los mismos de los demás correos).

import { crearAdmin, mensajeError } from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  botonCorreo,
  enviarCorreo,
  estiloNota,
  estiloTexto,
  estiloTitulo,
  plantillaCorreo,
} from "../_shared/correo.ts";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

// "2027-04-09" → "9 de abril"
function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Number(m[3]) + " de " + MESES[Number(m[2]) - 1] : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY") || undefined;
    const siteUrl = (Deno.env.get("SITE_URL") || "https://jissez.com").replace(/\/+$/, "");

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "No autenticado" }, 401);
    const admin = crearAdmin(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.slice(7));
    if (userErr || !userData.user) return jsonResponse({ error: "Sesión inválida" }, 401);
    const user = userData.user;

    // 1. Mi Salón abierto y cuenta creada desde entonces
    const { data: cfg, error: cfgErr } = await admin.from("jissez_config")
      .select("mi_salon_abierto, mi_salon_abierto_desde, gratis_ciclo, gratis_periodo").eq("id", true).maybeSingle();
    if (cfgErr) throw cfgErr;
    if (!cfg || !cfg.mi_salon_abierto || !cfg.mi_salon_abierto_desde) return jsonResponse({ enviado: false, motivo: "cerrado" });
    if (new Date(user.created_at).getTime() < new Date(cfg.mi_salon_abierto_desde).getTime()) {
      return jsonResponse({ enviado: false, motivo: "cuenta_anterior" });
    }
    if (!user.email || !user.email_confirmed_at) return jsonResponse({ enviado: false, motivo: "sin_confirmar" });

    // 2. Su acceso gratis y la fecha, de la tabla de periodos
    const { data: gratis } = await admin.from("mi_salon_accesos").select("id")
      .eq("docente_id", user.id).eq("origen", "gratis_t1").eq("ciclo", cfg.gratis_ciclo).limit(1);
    if (!gratis || !gratis.length) return jsonResponse({ enviado: false, motivo: "sin_gratis" });
    const { data: periodo, error: perErr } = await admin.from("mi_salon_periodos").select("vence")
      .eq("ciclo", cfg.gratis_ciclo).eq("periodo", cfg.gratis_periodo).maybeSingle();
    if (perErr) throw perErr;
    if (!periodo || !periodo.vence) return jsonResponse({ enviado: false, motivo: "sin_periodo" });
    const hasta = fechaCorta(periodo.vence);

    // Sin proveedor de correo configurado (por ejemplo, el proyecto de pruebas) no se aparta nada
    if (!resendKey) return jsonResponse({ enviado: false, motivo: "sin_correo_configurado" });

    // 3. Se aparta el envío (una sola vez por cuenta)
    const { data: apartada, error: apErr } = await admin.from("mi_salon_correos")
      .upsert({ docente_id: user.id, tipo: "bienvenida" }, { onConflict: "docente_id,tipo", ignoreDuplicates: true })
      .select("docente_id");
    if (apErr) throw apErr;
    if (!apartada || !apartada.length) return jsonResponse({ enviado: false, motivo: "ya_enviado" });

    // 4. El correo
    const html = plantillaCorreo(`
      <h1 style="${estiloTitulo}">Te damos la bienvenida a Mi Salón</h1>
      <p style="${estiloTexto}">Tu primer trimestre es gratis: tienes acceso completo hasta el ${hasta}.</p>
      <p style="${estiloTexto};margin-top:12px">Empieza con “Ponte al día” para capturar lo que ya llevas.</p>
      ${botonCorreo(siteUrl + "/dashboard", "Entrar a Mi Salón")}
      <p style="${estiloNota}">Mi Salón es la app de Jissez para llevar el día a día de tu grupo con la Nueva Escuela Mexicana: asistencia, trabajos con semáforo y la boleta propuesta al cierre del trimestre.</p>
    `);
    const ok = await enviarCorreo(resendKey, user.email, "Te damos la bienvenida a Mi Salón", html);
    if (!ok) {
      // Se libera para que el siguiente inicio de sesión lo intente de nuevo
      await admin.from("mi_salon_correos").delete().eq("docente_id", user.id).eq("tipo", "bienvenida");
      return jsonResponse({ enviado: false, motivo: "correo_fallo" }, 502);
    }
    return jsonResponse({ enviado: true });
  } catch (err) {
    console.error("bienvenida-mi-salon error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
