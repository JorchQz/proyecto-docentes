// Lógica compartida de pagos (Mercado Pago).
//
// La usan DOS entradas distintas, y a propósito comparten el mismo camino:
//   - webhook-mercadopago : cuando MP nos avisa (vía automática)
//   - confirmar-pago      : cuando el comprador vuelve al sitio o pulsa
//                           "verificar mi pago" (red de seguridad si el
//                           webhook se retrasa o nunca llega)
//
// Ambas terminan en `procesarPago()`, que es idempotente: se puede llamar
// mil veces con el mismo pago sin duplicar accesos ni correos.

import type { Cliente } from "./db.ts";
import {
  botonCorreo,
  enviarCorreo,
  escaparHtml,
  estiloNota,
  estiloTexto,
  estiloTitulo,
  plantillaCorreo,
} from "./correo.ts";

// Estados que MP puede devolver para un pago.
//   approved   → cobrado, entregar
//   pending / in_process / authorized → aún no acreditado (OXXO, SPEI, revisión)
//   rejected / cancelled → no se cobró
//   refunded / charged_back → se devolvió el dinero: hay que retirar el acceso
export type EstadoOrden = "pendiente" | "pagado" | "fallido";

export interface ResultadoPago {
  ok: boolean;
  estado: EstadoOrden;
  /** true si la orden ya estaba procesada y no se hizo nada nuevo */
  yaProcesada?: boolean;
  /** cuántos accesos quedaron otorgados */
  accesos?: number;
  /** estado crudo que devolvió Mercado Pago, útil para la UI */
  statusMp?: string;
  /** detalle de MP para mostrar mensajes precisos (p. ej. "esperando pago en OXXO") */
  detalleMp?: string;
  error?: string;
}

/** Consulta un pago concreto en la API de Mercado Pago. */
export async function consultarPago(
  paymentId: string,
  mpToken: string,
): Promise<Record<string, any> | null> {
  const resp = await fetch(
    "https://api.mercadopago.com/v1/payments/" + encodeURIComponent(paymentId),
    { headers: { Authorization: "Bearer " + mpToken } },
  );
  if (!resp.ok) {
    console.error("MP payment fetch failed:", paymentId, await resp.text());
    return null;
  }
  return await resp.json();
}

/**
 * Busca el pago más relevante asociado a una orden usando external_reference.
 * Sirve cuando el comprador vuelve al sitio y no traemos payment_id, o cuando
 * pulsa "ya pagué, verificar".
 *
 * Si hay varios intentos, gana el aprobado; si no hay aprobado, el más reciente.
 */
export async function buscarPagoPorOrden(
  ordenId: string,
  mpToken: string,
): Promise<Record<string, any> | null> {
  const url =
    "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=" +
    encodeURIComponent(ordenId);
  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + mpToken },
  });
  if (!resp.ok) {
    console.error("MP payment search failed:", ordenId, await resp.text());
    return null;
  }
  const data = await resp.json();
  const results: Record<string, any>[] = data?.results || [];
  if (!results.length) return null;
  return results.find((p) => p.status === "approved") || results[0];
}

/**
 * Aplica el resultado de un pago de MP sobre una orden: actualiza su estado,
 * otorga (o retira) los accesos y avisa por correo.
 *
 * Idempotente: si la orden ya está pagada no vuelve a otorgar ni a enviar correo.
 */
export async function procesarPago(
  admin: Cliente,
  pago: Record<string, any>,
  opts: { siteUrl?: string; resendKey?: string } = {},
): Promise<ResultadoPago> {
  const ordenId = pago.external_reference;
  const status = String(pago.status || "");
  const detalle = String(pago.status_detail || "");
  const paymentId = pago.id != null ? String(pago.id) : null;

  if (!ordenId) {
    return { ok: false, estado: "pendiente", error: "Pago sin external_reference" };
  }

  const { data: orden } = await admin
    .from("marketplace_ordenes")
    .select("id, estado, user_id, monto_total")
    .eq("id", ordenId)
    .maybeSingle();

  if (!orden) {
    return { ok: false, estado: "pendiente", error: "Orden no encontrada" };
  }

  // ── Devoluciones y contracargos: retirar el acceso ───────────────────────
  if (status === "refunded" || status === "charged_back") {
    await admin
      .from("marketplace_ordenes")
      .update({ estado: "fallido", referencia_pago: paymentId })
      .eq("id", ordenId);
    await admin.from("marketplace_accesos").delete().eq("orden_id", ordenId);
    // Un pedido a la medida devuelto se cancela (si ya estaba entregado, el
    // acceso se acaba de retirar arriba).
    await admin
      .from("marketplace_pedidos")
      .update({ estado: "cancelado", updated_at: new Date().toISOString() })
      .eq("orden_id", ordenId)
      .neq("estado", "cancelado");
    // La venta deja de contar para el escalón de lanzamiento.
    await recalcularPrecios(admin);
    return { ok: true, estado: "fallido", statusMp: status, detalleMp: detalle };
  }

  // ── Ya estaba pagada: no repetir nada ────────────────────────────────────
  if (orden.estado === "pagado") {
    return {
      ok: true,
      estado: "pagado",
      yaProcesada: true,
      statusMp: status || "approved",
    };
  }

  // ── Aún no se acredita (OXXO, SPEI, revisión antifraude) ─────────────────
  if (status !== "approved") {
    const nuevoEstado: EstadoOrden =
      status === "rejected" || status === "cancelled" ? "fallido" : "pendiente";
    await admin
      .from("marketplace_ordenes")
      .update({ estado: nuevoEstado, referencia_pago: paymentId })
      .eq("id", ordenId);
    return { ok: true, estado: nuevoEstado, statusMp: status, detalleMp: detalle };
  }

  // ── Defensa en profundidad: importe y moneda deben coincidir ─────────────
  // Un pago "approved" solo entrega si su importe y moneda cuadran con la orden.
  // Impide que un pago aprobado de otro monto/moneda (precio manipulado, pago
  // cruzado con otro external_reference) libere el paquete.
  const montoPago = Number(pago.transaction_amount);
  const moneda = String(pago.currency_id || "");
  const montoOrden = Number(orden.monto_total);
  if (moneda !== "MXN" || !Number.isFinite(montoPago) || montoPago + 0.01 < montoOrden) {
    console.error("Pago aprobado con importe/moneda que no coincide:", {
      ordenId, montoPago, moneda, montoOrden,
    });
    await admin
      .from("marketplace_ordenes")
      .update({ estado: "pendiente", referencia_pago: paymentId })
      .eq("id", ordenId);
    return {
      ok: false,
      estado: "pendiente",
      statusMp: status,
      error: "El importe o la moneda del pago no coinciden con la orden",
    };
  }

  // ── Pago aprobado: marcar y entregar ─────────────────────────────────────
  await admin
    .from("marketplace_ordenes")
    .update({ estado: "pagado", referencia_pago: paymentId })
    .eq("id", ordenId);

  const accesos = await otorgarAccesosDeOrden(admin, ordenId, orden.user_id);

  // Pedidos a la medida de esta orden: pasan a la cola y se avisa por correo
  // al cliente y al negocio. Nunca bloquea la entrega del resto.
  let pedidosActivados = 0;
  try {
    pedidosActivados = await activarPedidosDeOrden(admin, ordenId, orden.user_id, opts);
  } catch (err) {
    console.error("activar pedidos falló (no bloquea la entrega):", err);
  }

  // Escalón de lanzamiento: si esta venta cruzó los 50 o los 100 paquetes de
  // ciclo, el precio de los ciclos sube a partir de la siguiente compra.
  await recalcularPrecios(admin);

  // El correo nunca debe tumbar la entrega: si falla, queda en logs y ya.
  try {
    await avisarCompraPorCorreo(admin, ordenId, orden.user_id, opts);
  } catch (err) {
    console.error("aviso por correo falló (no bloquea la entrega):", err);
  }

  return { ok: true, estado: "pagado", accesos: accesos + pedidosActivados, statusMp: status };
}

/** Texto corto del aula de un pedido: "3° de Primaria" o "Multigrado 1°-2°". */
export function aulaDePedido(p: { organizacion?: string; grados?: number[]; grados_combo?: string | null }): string {
  if (p.organizacion === "multigrado" && p.grados_combo) {
    return "Multigrado " + p.grados_combo.split("-").map((n) => n + "°").join("-");
  }
  const g = (p.grados || [])[0];
  return g ? g + "° de Primaria" : "Primaria";
}

const NOMBRE_CF: Record<string, string> = {
  LEN: "Lenguajes",
  SAB: "Saberes y Pensamiento Científico",
  ETI: "Ética, Naturaleza y Sociedades",
  DHL: "De lo Humano y lo Comunitario",
};

/** Líneas de resumen de un pedido para los correos (sin HTML). */
export function resumenDePedido(p: Record<string, any>, extra?: { contenidos?: string[] | null; pdas?: string[] | null }): string[] {
  const lineas: string[] = [];
  lineas.push("Aula: " + aulaDePedido(p));
  lineas.push("Versión: " + (p.nivel === "con_anexos" ? "PDF + Word + anexos" : "PDF + Word (sin anexos)"));
  const cfs: string[] = Array.isArray(p.campos_formativos) ? p.campos_formativos : [];
  if (cfs.length) lineas.push("Campos formativos: " + cfs.map((c) => NOMBRE_CF[c] || c).join(", "));
  for (const c of extra?.contenidos || []) lineas.push("Contenido: " + c);
  for (const d of extra?.pdas || []) lineas.push("PDA: " + d);
  if (p.metodologia) lineas.push("Metodología: " + p.metodologia);
  if (p.fecha_necesaria) lineas.push("Lo necesita para: " + p.fecha_necesaria);
  if (p.notas) lineas.push("Notas: " + p.notas);
  return lineas;
}

function fechaLegible(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-MX", {
      timeZone: "America/Mexico_City", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
    });
  } catch (_) {
    return String(iso);
  }
}

/**
 * Pasa a la cola los pedidos a la medida de una orden recién pagada: estado
 * 'pendiente', fecha de pago y fecha compromiso (= ahora + ventana configurada).
 * Avisa al cliente (con la ventana y la garantía) y al negocio (con el detalle
 * para generarlo). Idempotente: solo toca pedidos en 'pendiente_pago'.
 */
export async function activarPedidosDeOrden(
  admin: Cliente,
  ordenId: string,
  userId: string,
  opts: { siteUrl?: string; resendKey?: string },
): Promise<number> {
  const { data: pedidos } = await admin
    .from("marketplace_pedidos")
    .select("id, numero_pedido, nivel, organizacion, grados, grados_combo, campos_formativos, contenido_ids, pda_ids, metodologia, fecha_necesaria, notas, nombre_cliente, precio")
    .eq("orden_id", ordenId)
    .eq("estado", "pendiente_pago");
  if (!pedidos || !pedidos.length) return 0;

  const { data: cfgRow } = await admin
    .from("marketplace_personalizados_config").select("ventana_horas").eq("id", true).maybeSingle();
  const ventana = Number(cfgRow?.ventana_horas) > 0 ? Number(cfgRow!.ventana_horas) : 72;
  const ahora = new Date();
  const compromiso = new Date(ahora.getTime() + ventana * 60 * 60 * 1000).toISOString();

  const { data: userRes } = await admin.auth.admin.getUserById(userId);
  const email = userRes?.user?.email || null;

  let n = 0;
  for (const p of pedidos) {
    const { error } = await admin
      .from("marketplace_pedidos")
      .update({ estado: "pendiente", pagado_en: ahora.toISOString(), fecha_compromiso_entrega: compromiso, updated_at: ahora.toISOString() })
      .eq("id", p.id)
      .eq("estado", "pendiente_pago");
    if (error) { console.error("activar pedido falló:", p.id, error); continue; }
    n++;

    // Textos de contenidos y PDAs para el correo (ids → texto).
    const { data: textos } = await admin.rpc("marketplace_pedido_textos", {
      p_contenidos: p.contenido_ids || [], p_pdas: p.pda_ids || [],
    });
    const t = Array.isArray(textos) ? textos[0] : textos;
    const lineas = resumenDePedido(p, { contenidos: t?.contenidos || [], pdas: t?.pdas || [] });
    const listaHtml = "<ul style=\"padding-left:18px;margin:16px 0 0;color:#1c2434;font-size:15px;line-height:1.6\">" +
      lineas.map((l) => "<li>" + escaparHtml(l) + "</li>").join("") + "</ul>";
    const siteUrl = (opts.siteUrl || "").replace(/\/+$/, "");

    if (opts.resendKey && email) {
      const html = plantillaCorreo(`
        <h1 style="${estiloTitulo}">Recibimos tu pedido ${escaparHtml(p.numero_pedido)}</h1>
        <p style="${estiloTexto}">
          Tu pago quedó confirmado. Ya estamos preparando tu proyecto a la medida y te lo
          entregaremos en tu biblioteca <strong>a más tardar el ${escaparHtml(fechaLegible(compromiso))}</strong>
          (hora del centro). Te avisamos por este correo en cuanto esté listo.
        </p>
        ${listaHtml}
        ${botonCorreo(siteUrl + "/tienda/mis-compras", "Ver mi pedido")}
        <p style="${estiloNota}">
          Si el proyecto no corresponde a lo que pediste, lo revisamos y corregimos sin costo.
          Si no lo entregamos dentro de la ventana comprometida, puedes pedir el reembolso total.
          Este proyecto puede integrarse después al catálogo general.
        </p>
      `);
      await enviarCorreo(opts.resendKey, email, "Recibimos tu pedido " + p.numero_pedido + " — Jissez", html);
    }

    const destinoAdmin = Deno.env.get("MAIL_ADMIN");
    if (opts.resendKey && destinoAdmin) {
      const html = plantillaCorreo(`
        <h1 style="${estiloTitulo}">Nuevo pedido a la medida ${escaparHtml(p.numero_pedido)}</h1>
        <p style="${estiloTexto}">
          Cliente: <strong>${escaparHtml(p.nombre_cliente || "")}</strong> (${escaparHtml(email || "sin correo")}) ·
          pagó $${escaparHtml(String(p.precio ?? ""))} MXN. Entrega comprometida: <strong>${escaparHtml(fechaLegible(compromiso))}</strong>.
        </p>
        ${listaHtml}
        <p style="${estiloNota};margin-top:16px">
          Carpeta sugerida en Drive: <strong>${escaparHtml(aulaDePedido(p))} / Proyectos Personalizados / ${escaparHtml(p.numero_pedido)}_${escaparHtml((p.nombre_cliente || "cliente").split(" ")[0])}</strong>
        </p>
        ${botonCorreo(siteUrl + "/tienda/admin", "Abrir el panel de pedidos")}
      `);
      await enviarCorreo(opts.resendKey, destinoAdmin, "Nuevo pedido a la medida " + p.numero_pedido, html);
    }
  }
  return n;
}

/**
 * Reaplica el tarifario tras un cambio en las ventas.
 *
 * El precio del ciclo completo escala con las ventas acumuladas (1-50, 51-100,
 * 101+). La cuenta y el nivel viven en la base (`marketplace_aplicar_precios`),
 * que reescribe el precio vigente en cada producto para que el catálogo muestre
 * exactamente lo que se va a cobrar.
 *
 * Nunca bloquea la entrega: si falla, el comprador ya pagó y tiene su acceso;
 * el precio se corregirá en la siguiente venta o desde el admin.
 */
async function recalcularPrecios(admin: Cliente): Promise<void> {
  try {
    const { error } = await admin.rpc("marketplace_aplicar_precios");
    if (error) console.error("recalcular precios falló:", error);
  } catch (err) {
    console.error("recalcular precios lanzó excepción:", err);
  }
}

/**
 * Filas de marketplace_accesos que corresponden a un item comprado.
 *
 * Paquetes (trimestre / ciclo), la versión editable incluye todo:
 *   compró 'pdf'      → pdf + anexos
 *   compró 'editable' → editable + pdf + anexos
 *
 * Proyecto suelto (tipo_paquete = 'proyecto'): el Word va SIEMPRE incluido
 * (fila 'editable' de regalo) y lo que se vende aparte son los anexos. La
 * fila 'anexos' es la que leen las funciones de entrega para decidir si se
 * muestran las subcarpetas del proyecto.
 *   compró 'pdf'      → pdf + editable
 *   compró 'anexos'   → pdf + editable + anexos
 */
export function tiposDeAcceso(tipoItem: string, tipoPaquete: string | null): string[] {
  if (tipoPaquete === "proyecto") {
    return tipoItem === "anexos"
      ? ["pdf", "editable", "anexos"]
      : ["pdf", "editable"];
  }
  return tipoItem === "editable"
    ? ["editable", "pdf", "anexos"]
    : ["pdf", "anexos"];
}

/** Otorga los accesos que corresponden a los items de una orden. */
export async function otorgarAccesosDeOrden(
  admin: Cliente,
  ordenId: string,
  userId: string,
): Promise<number> {
  const { data: items } = await admin
    .from("marketplace_orden_items")
    .select("producto_id, tipo, marketplace_productos(tipo_paquete)")
    .eq("orden_id", ordenId);

  const accesos: Array<Record<string, unknown>> = [];
  for (const item of items || []) {
    // Items sin producto (pedidos personalizados) no otorgan acceso aquí: se
    // entregan al completarse el pedido.
    if (!item.producto_id) continue;
    const tipoPaquete = (item as any).marketplace_productos?.tipo_paquete ?? null;
    const tipos = tiposDeAcceso(item.tipo, tipoPaquete);
    for (const t of tipos) {
      accesos.push({
        user_id: userId,
        producto_id: item.producto_id,
        tipo: t,
        orden_id: ordenId,
      });
    }
  }

  if (!accesos.length) return 0;

  const { error } = await admin
    .from("marketplace_accesos")
    .upsert(accesos, {
      onConflict: "user_id,producto_id,tipo",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("upsert de accesos falló:", error);
    return 0;
  }
  return accesos.length;
}

/** Texto de la versión comprada, para correos y resúmenes. */
export function descripcionVersion(tipoItem: string, tipoPaquete: string | null): string {
  if (tipoPaquete === "proyecto") {
    return tipoItem === "anexos"
      ? "Proyecto individual: PDF + Word editable + anexos"
      : "Proyecto individual: PDF + Word editable (sin anexos)";
  }
  return tipoItem === "editable"
    ? "Word editable + PDF + anexos"
    : "PDF + anexos";
}

/**
 * Correo de confirmación al comprador.
 *
 * Opcional: si no hay RESEND_API_KEY configurada simplemente no se envía y la
 * compra sigue su curso. Así el flujo funciona antes de configurar el correo.
 */
async function avisarCompraPorCorreo(
  admin: Cliente,
  ordenId: string,
  userId: string,
  opts: { siteUrl?: string; resendKey?: string },
): Promise<void> {
  const resendKey = opts.resendKey;
  if (!resendKey) return;

  const { data: userRes } = await admin.auth.admin.getUserById(userId);
  const email = userRes?.user?.email;
  if (!email) return;

  const { data: items } = await admin
    .from("marketplace_orden_items")
    .select("tipo, producto_id, marketplace_productos(titulo, tipo_paquete)")
    .eq("orden_id", ordenId);

  // Los pedidos a la medida tienen su propio correo (activarPedidosDeOrden);
  // aquí solo se listan los productos entregados de inmediato.
  const conProducto = (items || []).filter((i: any) => i.producto_id);
  if (!conProducto.length) return;

  const lista = conProducto
    .map((i: any) => {
      const titulo = i.marketplace_productos?.titulo || "Paquete";
      const version = descripcionVersion(i.tipo, i.marketplace_productos?.tipo_paquete ?? null);
      return `<li style="margin-bottom:6px"><strong>${escaparHtml(titulo)}</strong><br><span style="color:#5b6473;font-size:14px">${version}</span></li>`;
    })
    .join("");

  const siteUrl = (opts.siteUrl || "").replace(/\/+$/, "");
  const enlace = siteUrl + "/tienda/mis-compras";

  const html = plantillaCorreo(`
    <h1 style="${estiloTitulo}">Tu compra está lista</h1>
    <p style="${estiloTexto}">
      Confirmamos tu pago. Ya puedes descargar tu material desde tu biblioteca.
    </p>
    <ul style="padding-left:18px;margin:20px 0 0;color:#1c2434;font-size:15px">${lista}</ul>
    ${botonCorreo(enlace, "Ir a mis compras")}
    <p style="${estiloNota}">
      Tus descargas no caducan ni tienen límite. Si algo no funciona, responde a
      este correo.
    </p>
  `);

  await enviarCorreo(resendKey, email, "Tu compra en Jissez está lista", html);
}


/**
 * Valida la firma `x-signature` que Mercado Pago envía en cada webhook.
 *
 * Manifiesto que MP firma:  id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * HMAC-SHA256 con la clave secreta de webhooks del panel de MP.
 *
 * Si no hay secreto configurado devolvemos true (no bloquear antes de que
 * Jorge lo configure). Aun sin firma el webhook es seguro: nunca confía en el
 * cuerpo recibido, siempre reconsulta el pago real contra la API de MP.
 */
export async function firmaWebhookValida(
  req: Request,
  dataId: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true;

  const signature = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id") || "";
  if (!signature) return false;

  let ts = "";
  let v1 = "";
  for (const parte of signature.split(",")) {
    const [k, v] = parte.split("=").map((s) => s.trim());
    if (k === "ts") ts = v;
    if (k === "v1") v1 = v;
  }
  if (!ts || !v1 || !dataId) return false;

  // MP documenta que el id alfanumérico va en minúsculas en el manifiesto.
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifiesto),
  );
  const hex = Array.from(new Uint8Array(firma))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return comparacionSegura(hex, v1);
}

/** Comparación en tiempo constante para no filtrar información por timing. */
function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) {
    dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return dif === 0;
}
