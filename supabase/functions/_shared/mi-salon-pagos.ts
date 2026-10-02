// Pagos de Mi Salón (b22, spec de Jorge 2026-09-26 §6).
//
// Una compra de Mi Salón es una orden de marketplace_ordenes (como las de la tienda: mismo
// Mercado Pago, mismos cupones) con su fila en mi_salon_ordenes y SIN renglones en
// marketplace_orden_items. `procesarPago()` (pagos.ts) la reconoce con `esOrdenMiSalon()` y la
// manda aquí; las órdenes de la tienda siguen su camino de siempre sin ningún cambio.
//
// Toda la regla vive en la base (supabase/mi_salon_b22_cobros_2026-09.sql,
// mi_salon_aplicar_pago): cobertura según la fecha de aprobación, importe y moneda, acceso por
// ciclo SUMADO a lo que ya tenga, idempotencia con el índice único (pago_id, ciclo), pago
// pendiente de OXXO con su referencia y reembolsos. Aquí solo se extraen los datos del pago de
// Mercado Pago y se manda el correo de confirmación (una sola vez por orden).

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

/** Mismo contrato que ResultadoPago de pagos.ts (para confirmar-pago y el webhook). */
export interface ResultadoPagoMiSalon {
  ok: boolean;
  estado: "pendiente" | "pagado" | "fallido" | "reembolsado";
  yaProcesada?: boolean;
  accesos?: number;
  statusMp?: string;
  detalleMp?: string;
  error?: string;
  transitorio?: boolean;
  miSalon?: Record<string, unknown>;
}

/** Códigos de "la tabla no existe" (Postgres 42P01; PostgREST PGRST205 cuando no está en su caché). */
const TABLA_NO_EXISTE = new Set(["42P01", "PGRST205"]);

/**
 * ¿La orden es de Mi Salón? false SOLO si de verdad no lo es: no tiene fila en mi_salon_ordenes o la
 * tabla no existe (migración b22 sin aplicar). Cualquier otro error (timeout, 503 de PostgREST, red)
 * se LANZA (R27b): antes devolvía false y el pago de Mi Salón se iba por el camino de la tienda, la
 * orden quedaba 'pagado' sin acceso y los reintentos decían yaProcesada. Al lanzar, la orden sigue
 * pendiente y sin tocar. Cómo se repara (R29): el webhook responde 503 y Mercado Pago vuelve a mandar
 * el MISMO aviso por su cuenta; el primer reintento que encuentra la base bien aplica el pago
 * (idempotente: un acceso y un correo). Si mientras tanto la docente vuelve de Mercado Pago o pulsa
 * "Ya pagué, verificar", confirmar-pago lo aplica igual (y si también le falla, responde 500 y
 * puede volver a intentarlo). Antes de R29 el webhook respondía 200 y el aviso se perdía: solo lo
 * reparaba confirmar-pago.
 */
export async function esOrdenMiSalon(admin: Cliente, ordenId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("mi_salon_ordenes")
    .select("orden_id")
    .eq("orden_id", ordenId)
    .maybeSingle();
  if (error) {
    if (TABLA_NO_EXISTE.has(String((error as { code?: string }).code || ""))) return false;
    throw new Error("No se pudo saber si la orden " + ordenId + " es de Mi Salón: " + (error.message || "error"));
  }
  return !!data;
}

/**
 * Lo que la base necesita del pago de Mercado Pago. La referencia del pago en efectivo (OXXO)
 * y la ficha para imprimirla vienen en transaction_details (o en barcode / point_of_interaction
 * según el medio).
 */
// deno-lint-ignore no-explicit-any
export function datosDelPago(pago: Record<string, any>): Record<string, unknown> {
  const td = pago.transaction_details || {};
  const poi = pago.point_of_interaction?.transaction_data || {};
  return {
    id: pago.id != null ? String(pago.id) : null,
    status: String(pago.status || ""),
    status_detail: String(pago.status_detail || ""),
    transaction_amount: pago.transaction_amount,
    currency_id: pago.currency_id,
    date_approved: pago.date_approved || null,
    payment_method_id: pago.payment_method_id || null,
    payment_type_id: pago.payment_type_id || null,
    referencia: td.payment_method_reference_id || pago.barcode?.content || poi.reference || null,
    ticket_url: td.external_resource_url || poi.ticket_url || null,
  };
}

/** Aplica un pago a una orden de Mi Salón (idempotente) y avisa por correo la primera vez. */
export async function procesarPagoMiSalon(
  admin: Cliente,
  // deno-lint-ignore no-explicit-any
  pago: Record<string, any>,
  opts: { siteUrl?: string; resendKey?: string } = {},
): Promise<ResultadoPagoMiSalon> {
  const ordenId = String(pago.external_reference || "");
  const status = String(pago.status || "");
  const detalle = String(pago.status_detail || "");
  // Una orden ya reembolsada no se revive con un aviso viejo (approved, pending...): definitivo, sin
  // llamar a mi_salon_aplicar_pago. El reembolso mismo (refunded / charged_back) sí pasa a la base,
  // que lo aplica de forma idempotente. La regla se decide aquí, sin cambiar SQL.
  if (status !== "refunded" && status !== "charged_back") {
    const { data: o, error: errO } = await admin.from("marketplace_ordenes").select("estado").eq("id", ordenId).maybeSingle();
    if (errO) {
      console.error("No se pudo leer la orden de Mi Salón (falla pasajera):", ordenId, errO);
      return { ok: false, estado: "pendiente", transitorio: true, statusMp: status, detalleMp: detalle, error: "No se pudo leer la orden" };
    }
    if (o && o.estado === "reembolsado") {
      return { ok: true, estado: "reembolsado", yaProcesada: true, statusMp: status, detalleMp: detalle };
    }
  }
  const { data, error } = await admin.rpc("mi_salon_aplicar_pago", {
    p_orden_id: ordenId,
    p_pago: datosDelPago(pago),
  });
  // Las reglas de negocio (orden desconocida, importe o moneda que no cuadran, pago sin id) vuelven
  // DENTRO de data con ok=false y son definitivas. Un error de la llamada (timeout, 5xx de PostgREST,
  // red) es una falla pasajera: la función corre en una transacción, así que no dejó nada a medias,
  // y el webhook responde 503 para que Mercado Pago reintente (R29).
  if (error || !data) {
    console.error("mi_salon_aplicar_pago falló (falla pasajera):", ordenId, error);
    return {
      ok: false,
      estado: "pendiente",
      transitorio: true,
      statusMp: status,
      detalleMp: detalle,
      error: error?.message || "Sin respuesta",
    };
  }
  // deno-lint-ignore no-explicit-any
  const r = data as Record<string, any>;

  // Correo de confirmación: cuando ESTE llamado creó el acceso, o cuando la orden ya estaba aplicada
  // pero el correo nunca quedó apartado (la respuesta de la primera llamada se perdió o el envío
  // falló y se liberó el apartado). El apartado en mi_salon_correos (una fila por orden) evita que
  // un webhook repetido o la verificación manual lo repitan. El correo nunca tumba la entrega.
  if (r.estado === "pagado" && ((!r.ya_procesada && Number(r.accesos_creados) > 0) || r.ya_procesada)) {
    try {
      await avisarPagoMiSalon(admin, ordenId, r, opts);
    } catch (err) {
      console.error("correo de Mi Salón falló (no bloquea el acceso):", err);
    }
  }

  return {
    ok: r.ok !== false,
    estado: r.estado,
    yaProcesada: !!r.ya_procesada,
    accesos: Number(r.accesos_creados) || 0,
    statusMp: status,
    detalleMp: detalle,
    error: r.error || undefined,
    miSalon: { vence: r.vence ?? null, compra_tardia: !!r.compra_tardia, provisional: !!r.provisional },
  };
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];
const ORDINAL: Record<string, string> = { T1: "primer trimestre", T2: "segundo trimestre", T3: "tercer trimestre" };

/** "2027-04-09" → "9 de abril de 2027" */
export function fechaLarga(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Number(m[3]) + " de " + MESES[Number(m[2]) - 1] + " de " + m[1] : "";
}

/** "$199" o "$199.50" */
export function pesos(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "$" + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
}

/** "segundo trimestre" o "primer trimestre del ciclo 2027-2028" (si es de otro ciclo) */
export function nombrePeriodo(sig: { ciclo?: string; periodo?: string } | null | undefined, cicloCompra?: string): string {
  if (!sig || !sig.periodo) return "";
  const base = ORDINAL[sig.periodo] || sig.periodo;
  return sig.ciclo && cicloCompra && sig.ciclo !== cicloCompra ? base + " del ciclo " + sig.ciclo : base;
}

/** Periodos cubiertos: "T1 y T2 del ciclo 2026-2027" o "T3 del ciclo 2026-2027 y T1 del ciclo 2027-2028" */
export function textoCobertura(cob: Array<{ ciclo: string; periodos: string[] }> | null | undefined): string {
  const partes = (cob || []).map((c) => {
    const p = c.periodos || [];
    const lista = p.length <= 1 ? p.join("") : p.slice(0, -1).join(", ") + " y " + p[p.length - 1];
    return lista + " del ciclo " + c.ciclo;
  });
  return partes.length <= 1 ? partes.join("") : partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

const TIPO_PRECIO: Record<string, string> = { fundador: "precio fundador", lista: "precio de lista", cupon: "con cupón" };

/** Correo de confirmación (una sola vez por orden: se aparta la fila en mi_salon_correos). */
async function avisarPagoMiSalon(
  admin: Cliente,
  ordenId: string,
  // deno-lint-ignore no-explicit-any
  r: Record<string, any>,
  opts: { siteUrl?: string; resendKey?: string },
): Promise<void> {
  if (!opts.resendKey || !r.docente_id) return;
  const { data: userRes } = await admin.auth.admin.getUserById(r.docente_id);
  const email = userRes?.user?.email;
  if (!email) return;

  const tipo = "pago:" + ordenId;
  const { data: apartada, error: apErr } = await admin.from("mi_salon_correos")
    .upsert({ docente_id: r.docente_id, tipo }, { onConflict: "docente_id,tipo", ignoreDuplicates: true })
    .select("docente_id");
  if (apErr || !apartada || !apartada.length) return;

  const html = htmlConfirmacion(r, (opts.siteUrl || "").replace(/\/+$/, ""));
  const ok = await enviarCorreo(opts.resendKey, email, "Tu pago de Mi Salón quedó confirmado", html);
  if (!ok) {
    await admin.from("mi_salon_correos").delete().eq("docente_id", r.docente_id).eq("tipo", tipo);
  }
}

/** Cuerpo del correo de confirmación (producto, monto, vigencia y enlace a Mi Salón). */
// deno-lint-ignore no-explicit-any
export function htmlConfirmacion(r: Record<string, any>, siteUrl: string): string {
  const cob = Array.isArray(r.cobertura) ? r.cobertura : [];
  const cicloCompra = cob.length ? cob[0].ciclo : undefined;
  const lineas: string[] = [];
  lineas.push("Producto: " + (r.nombre || "Mi Salón") + (cob.length ? " (" + textoCobertura(cob) + ")" : ""));
  lineas.push("Monto: " + pesos(r.monto) + " MXN" + (TIPO_PRECIO[r.tipo_precio] ? " · " + TIPO_PRECIO[r.tipo_precio] : ""));
  const lista = "<ul style=\"padding-left:18px;margin:16px 0 0;color:#1c2434;font-size:15px;line-height:1.6\">" +
    lineas.map((l) => "<li>" + escaparHtml(l) + "</li>").join("") + "</ul>";
  const extras: string[] = [];
  if (r.compra_tardia && r.siguiente) {
    extras.push("Incluye también el " + nombrePeriodo(r.siguiente, cicloCompra) + " sin costo extra.");
  }
  if (r.provisional) {
    extras.push("Cuando se publique el calendario del ciclo que sigue, tu acceso se extiende solo y te avisamos por correo.");
  }
  if (r.extendida && r.vence_antes) {
    extras.push("Se suma a lo que ya tenías: antes tu acceso terminaba el " + fechaLarga(r.vence_antes) + ".");
  }
  return plantillaCorreo(`
    <h1 style="${estiloTitulo}">Tu pago quedó confirmado</h1>
    <p style="${estiloTexto}">Tu acceso a Mi Salón es válido hasta el <strong>${escaparHtml(fechaLarga(r.vence))}</strong>.</p>
    ${extras.map((t) => `<p style="${estiloTexto};margin-top:10px">${escaparHtml(t)}</p>`).join("")}
    ${lista}
    ${botonCorreo(siteUrl + "/dashboard", "Entrar a Mi Salón")}
    <p style="${estiloNota}">Guarda este correo como comprobante. Tus datos se quedan guardados siempre, también cuando termine tu acceso. Si algo no cuadra, responde a este correo.</p>
  `);
}
