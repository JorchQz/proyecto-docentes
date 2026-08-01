// Edge Function: crear-preferencia-mp
//
// Prepara el cobro: reutiliza (o crea) una orden pendiente y genera la
// preferencia de Checkout Pro. Devuelve el init_point para redirigir.
//
// Checkout Pro ofrece por sí solo todos los métodos: cuenta de Mercado Pago,
// tarjeta, dos tarjetas, efectivo y transferencia SPEI. No hay que declararlos.
//
// POST /functions/v1/crear-preferencia-mp
//   body: { producto_id: uuid, tipo: 'pdf' | 'editable' }
//   header: Authorization: Bearer <access_token del usuario>

import {
  type Cliente,
  crearAdmin,
  crearClienteUsuario,
  mensajeError,
} from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  FOLDER_MIME,
  listDriveFolder,
  primerProyectoFolder,
} from "../_shared/google-drive.ts";

// La preferencia caduca a los 7 días: da margen de sobra a un pago en efectivo
// (OXXO acredita en horas, a veces 1-3 días) sin dejar órdenes vivas para siempre.
const DIAS_VIGENCIA = 7;
// Órdenes pendientes más viejas que esto ya no pueden cobrarse: se archivan
// para que no salgan eternamente como "en proceso" en Mis compras.
const DIAS_CADUCIDAD_ORDEN = 8;
// Máximo de mensualidades a ofrecer.
const MAX_MSI = 12;

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
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

    if (!mpToken) {
      return jsonResponse({ error: "Falta configurar MP_ACCESS_TOKEN" }, 500);
    }
    if (!siteUrl.startsWith("https://")) {
      // auto_return exige back_urls https válidas; sin esto MP rechaza la preferencia.
      return jsonResponse(
        { error: "SITE_URL debe ser una URL https sin barra final" },
        500,
      );
    }

    const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
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

    const admin = crearAdmin(supabaseUrl, serviceKey);

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select(
        "id, titulo, precio_pdf, precio_editable, activo, tipo_paquete, proyecto_folder_drive_id, archivo_pdf_drive_id, archivo_docx_drive_id",
      )
      .eq("id", productoId)
      .maybeSingle();

    if (prodErr || !producto || !producto.activo) {
      return jsonResponse({ error: "Producto no disponible" }, 404);
    }

    // Nunca cobrar por un paquete que no tiene nada que entregar.
    //
    // No basta con mirar los campos: un producto puede tener
    // `proyecto_folder_drive_id` apuntando a una carpeta de Drive todavía
    // vacía. Los paquetes se publican en el catálogo antes de que su material
    // esté cargado, así que comprobamos contra Drive de verdad.
    if (!(await puedeEntregarse(producto))) {
      return jsonResponse(
        {
          error:
            "Este paquete todavía no está disponible para compra. Estamos terminando de prepararlo.",
          sin_contenido: true,
        },
        409,
      );
    }

    const precio = tipo === "pdf" ? producto.precio_pdf : producto.precio_editable;
    if (precio == null) {
      return jsonResponse(
        { error: "Este producto no tiene precio para esa versión" },
        400,
      );
    }

    // Ya lo compró: no cobrarle dos veces por lo mismo.
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

    // 1. Reutilizar la orden pendiente de este mismo producto+versión.
    //    Sin esto, cada clic en "Pagar" dejaba una orden huérfana que se
    //    quedaba para siempre como "en proceso" en Mis compras.
    const ordenId = await reutilizarOCrearOrden(
      admin,
      user.id,
      productoId,
      tipo,
      Number(precio),
    );
    if (!ordenId) {
      return jsonResponse({ error: "No se pudo crear la orden" }, 500);
    }

    // Archivar pendientes caducadas del usuario (limpieza oportunista).
    await archivarOrdenesCaducadas(admin, user.id, ordenId);

    // 2. Crear la preferencia en Mercado Pago.
    const ahora = new Date();
    const vence = new Date(ahora.getTime() + DIAS_VIGENCIA * 24 * 60 * 60 * 1000);
    const tipoLabel = tipo === "pdf" ? "PDF" : "Editable (Word) + PDF";

    const prefBody = {
      items: [
        {
          id: productoId,
          title: producto.titulo + " — " + tipoLabel,
          description: "Planeación didáctica NEM en formato digital",
          category_id: "learnings",
          quantity: 1,
          unit_price: Number(precio),
          currency_id: "MXN",
        },
      ],
      external_reference: ordenId,
      payer: { email: user.email },
      // Rutas sin ".html": Cloudflare Pages redirige (307) las que lo llevan y,
      // aunque conserva los query params, evitamos el salto de más en el
      // regreso desde Mercado Pago.
      back_urls: {
        success: siteUrl + "/tienda/mis-compras",
        pending: siteUrl + "/tienda/mis-compras",
        failure: siteUrl + "/tienda/checkout?producto_id=" +
          encodeURIComponent(productoId) + "&tipo=" + tipo,
      },
      auto_return: "approved",
      notification_url: supabaseUrl + "/functions/v1/webhook-mercadopago",
      // Lo que el comprador verá en su estado de cuenta bancario.
      statement_descriptor: "JISSEZ",
      // Sin exclusiones a propósito: queremos que se ofrezcan todos los medios
      // (cuenta MP, tarjeta, dos tarjetas, efectivo y SPEI). Enviar un
      // `excluded_payment_types` vacío hace que MP lo guarde como [{"id":""}],
      // así que simplemente no mandamos el campo.
      payment_methods: {
        installments: MAX_MSI,
      },
      expires: true,
      expiration_date_from: ahora.toISOString(),
      expiration_date_to: vence.toISOString(),
      metadata: {
        orden_id: ordenId,
        producto_id: productoId,
        tipo,
        user_id: user.id,
      },
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + mpToken,
        "Content-Type": "application/json",
        // Evita preferencias duplicadas si el usuario da doble clic.
        "X-Idempotency-Key": ordenId,
      },
      body: JSON.stringify(prefBody),
    });

    if (!mpResp.ok) {
      const txt = await mpResp.text();
      console.error("MP preference error:", mpResp.status, txt);
      await admin
        .from("marketplace_ordenes")
        .update({ estado: "fallido" })
        .eq("id", ordenId);
      return jsonResponse({ error: "No se pudo iniciar el pago" }, 502);
    }

    const pref = await mpResp.json();

    await admin
      .from("marketplace_ordenes")
      .update({ referencia_pago: pref.id })
      .eq("id", ordenId);

    // Mercado Pago devuelve dos URLs y usar la equivocada rompe el pago:
    //   credenciales TEST-...   → sandbox_init_point (entorno de pruebas)
    //   credenciales APP_USR-.. → init_point
    // Ojo: un APP_USR- puede pertenecer a un usuario de prueba; en ese caso
    // también va por init_point, pero el comprador NO debe tener sesión con
    // una cuenta real de MP o el pago se rechaza por mezclar entornos.
    const esCredencialSandbox = mpToken.startsWith("TEST-");
    const destino = esCredencialSandbox
      ? (pref.sandbox_init_point || pref.init_point)
      : pref.init_point;

    return jsonResponse({
      orden_id: ordenId,
      preference_id: pref.id,
      init_point: destino,
      sandbox: esCredencialSandbox,
    });
  } catch (err) {
    console.error("crear-preferencia-mp error:", err);
    return jsonResponse(
      { error: "Error interno: " + mensajeError(err) },
      500,
    );
  }
});

/**
 * ¿Hay material real que entregar por este paquete?
 *
 * No basta con que exista la carpeta del proyecto: el bot generador crea la
 * estructura de carpetas antes de que se suban los archivos, así que una
 * carpeta de proyecto puede estar vacía. Exigimos un documento descargable
 * (PDF o DOCX) dentro del primer proyecto.
 *
 * Si Drive no responde no bloqueamos la venta: un fallo transitorio de Google
 * no debe costar una compra, y el acceso queda otorgado igual — la descarga
 * funcionará cuando Drive vuelva.
 */
async function puedeEntregarse(
  producto: Record<string, unknown>,
): Promise<boolean> {
  if (producto.archivo_pdf_drive_id || producto.archivo_docx_drive_id) {
    return true;
  }
  const folderId = producto.proyecto_folder_drive_id as string | null;
  if (!folderId) return false;

  try {
    const tipoPaquete = (producto.tipo_paquete || "trimestre") as
      | "trimestre"
      | "ciclo";
    const proyecto = await primerProyectoFolder(folderId, tipoPaquete);
    if (!proyecto) return false;

    const archivos = await listDriveFolder(proyecto.id);
    return archivos.some((f) =>
      f.mimeType !== FOLDER_MIME && /\.(pdf|docx?)$/i.test(f.name)
    );
  } catch (err) {
    console.error("no se pudo verificar Drive, se permite la compra:", err);
    return true;
  }
}

/**
 * Devuelve el id de la orden pendiente que ya existe para este producto+versión,
 * o crea una nueva. Reutilizar mantiene un solo external_reference por intento
 * de compra, así que los pagos de MP siempre caen en la orden correcta.
 */
async function reutilizarOCrearOrden(
  admin: Cliente,
  userId: string,
  productoId: string,
  tipo: string,
  precio: number,
): Promise<string | null> {
  const { data: pendientes } = await admin
    .from("marketplace_ordenes")
    .select("id")
    .eq("user_id", userId)
    .eq("estado", "pendiente")
    .eq("metodo_pago", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(20);

  const ids = (pendientes || []).map((o: { id: string }) => o.id);
  if (ids.length) {
    const { data: items } = await admin
      .from("marketplace_orden_items")
      .select("id, orden_id")
      .in("orden_id", ids)
      .eq("producto_id", productoId)
      .eq("tipo", tipo)
      .limit(1);

    if (items && items.length) {
      const ordenId = items[0].orden_id;
      // El precio pudo cambiar entre un intento y otro.
      await admin
        .from("marketplace_ordenes")
        .update({ monto_total: precio })
        .eq("id", ordenId);
      await admin
        .from("marketplace_orden_items")
        .update({ precio_unitario: precio })
        .eq("id", items[0].id);
      return ordenId;
    }
  }

  const { data: orden, error: ordErr } = await admin
    .from("marketplace_ordenes")
    .insert({
      user_id: userId,
      monto_total: precio,
      estado: "pendiente",
      metodo_pago: "mercadopago",
    })
    .select("id")
    .single();

  if (ordErr || !orden) {
    console.error("insert orden falló:", ordErr);
    return null;
  }

  const { error: itemErr } = await admin
    .from("marketplace_orden_items")
    .insert({
      orden_id: orden.id,
      producto_id: productoId,
      tipo,
      precio_unitario: precio,
    });
  if (itemErr) {
    console.error("insert item falló:", itemErr);
    return null;
  }

  return orden.id;
}

/**
 * Marca como fallidas las órdenes pendientes cuya preferencia ya caducó en MP.
 * Son intentos que el comprador abandonó; dejarlas vivas ensucia Mis compras.
 */
async function archivarOrdenesCaducadas(
  admin: Cliente,
  userId: string,
  excluirOrdenId: string,
): Promise<void> {
  const limite = new Date(
    Date.now() - DIAS_CADUCIDAD_ORDEN * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await admin
    .from("marketplace_ordenes")
    .update({ estado: "fallido" })
    .eq("user_id", userId)
    .eq("estado", "pendiente")
    .eq("metodo_pago", "mercadopago")
    .lt("created_at", limite)
    .neq("id", excluirOrdenId);
  if (error) {
    console.error("archivar caducadas falló (no bloquea la compra):", error);
  }
}
