// Correos transaccionales de Jissez.
//
// Se envían por Resend en vez de dejarlos a las plantillas de Supabase Auth:
// esas llegan en inglés y sin formato, y los cambios de plantilla no se
// aplicaban aunque quedaran guardados en la configuración del proyecto.
// Mandándolos desde aquí, el diseño y el idioma están bajo nuestro control y
// todos los correos se ven igual.
//
// Todo el CSS va EN LÍNEA a propósito: Gmail y Outlook descartan las hojas de
// estilo, así que un <style> se perdería y el correo llegaría en texto plano.

const BOARD = "#1e3a8a";
const ACTION = "#059669";
const INK = "#1c2434";
const MUTE = "#5b6473";
const PAPER = "#faf9f4";
const LINE = "#e7e6df";

/** Marco común: cabecera con la marca, cuerpo y pie. */
export function plantillaCorreo(contenido: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:20px;overflow:hidden">
        <tr><td style="background:${BOARD};padding:22px 28px">
          <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-.02em">Jissez</span>
          <span style="color:rgba(255,255,255,.7);font-size:13px;margin-left:8px">Planeaciones NEM</span>
        </td></tr>
        <tr><td style="padding:32px 28px">${contenido}</td></tr>
        <tr><td style="background:${PAPER};border-top:1px solid ${LINE};padding:18px 28px">
          <p style="margin:0;color:#8a93a2;font-size:12px;line-height:1.6">
            Correo automático de jissez.com. Si no lo esperabas, puedes ignorarlo.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Botón principal. Va como tabla porque Outlook no respeta el padding de <a>. */
export function botonCorreo(url: string, texto: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0">
    <tr><td style="background:${ACTION};border-radius:12px">
      <a href="${url}" style="display:inline-block;padding:15px 30px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">${texto}</a>
    </td></tr></table>`;
}

/** Enlace en texto, para cuando el cliente de correo bloquea el botón. */
export function enlaceCopiable(url: string): string {
  return `<p style="margin:0 0 22px;padding:12px 14px;background:${PAPER};border:1px solid ${LINE};border-radius:10px;color:${BOARD};font-size:12px;word-break:break-all">${url}</p>`;
}

export const estiloTitulo = `margin:0 0 12px;color:${INK};font-size:22px;font-weight:800`;
export const estiloTexto = `margin:0;color:${MUTE};font-size:15px;line-height:1.65`;
export const estiloNota = `margin:0;color:${MUTE};font-size:14px;line-height:1.65`;

/**
 * Envía por Resend. Devuelve false si no hay clave configurada o si falla:
 * ningún correo debe tumbar la operación que lo dispara.
 */
export async function enviarCorreo(
  resendKey: string | undefined,
  destino: string,
  asunto: string,
  html: string,
): Promise<boolean> {
  if (!resendKey || !destino) return false;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "Jissez <no-reply@jissez.com>",
        to: [destino],
        subject: asunto,
        html,
      }),
    });
    if (!resp.ok) {
      console.error("Resend error:", resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend excepción:", err);
    return false;
  }
}

export function escaparHtml(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
