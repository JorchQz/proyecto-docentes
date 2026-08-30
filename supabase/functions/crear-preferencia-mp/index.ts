// Edge Function: crear-preferencia-mp
//
// Prepara el cobro: reutiliza (o crea) una orden pendiente y genera la
// preferencia de Checkout Pro. Devuelve el init_point para redirigir.
//
// Checkout Pro ofrece por sí solo todos los métodos: cuenta de Mercado Pago,
// tarjeta, dos tarjetas, efectivo y transferencia SPEI. No hay que declararlos.
//
// POST /functions/v1/crear-preferencia-mp
//   body compra individual: { producto_id: uuid, tipo: 'pdf' | 'editable' }
//   body paquete unitario:  { combo: 'unitaria',
//                             agrupacion: 'tridocente' | 'bidocente',
//                             tipo_paquete: 'trimestre' | 'ciclo',
//                             trimestre: 1 | 2 | 3,   // solo si tipo_paquete = 'trimestre'
//                             tipo: 'pdf' | 'editable' }
//   header: Authorization: Bearer <access_token del usuario>

import {
  type Cliente,
  crearAdmin,
  crearClienteUsuario,
  mensajeError,
} from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  carpetaTrimestreDeGrado,
  FOLDER_MIME,
  listDriveFolder,
  proyectosDeTrimestre,
} from "../_shared/google-drive.ts";

// La preferencia caduca a los 7 días: da margen de sobra a un pago en efectivo
// (OXXO acredita en horas, a veces 1-3 días) sin dejar órdenes vivas para siempre.
const DIAS_VIGENCIA = 7;
// Órdenes pendientes más viejas que esto ya no pueden cobrarse: se archivan
// para que no salgan eternamente como "en proceso" en Mis compras.
const DIAS_CADUCIDAD_ORDEN = 8;
// Máximo de mensualidades a ofrecer. NO son meses sin intereses: no hay
// promociones MSI contratadas con Mercado Pago, y el interés lo aplica el
// banco del comprador. El nombre anterior (MAX_MSI) hizo que la web lo
// anunciara como "sin intereses", que era falso.
const MAX_MENSUALIDADES = 12;

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
    const tipo = body.tipo;
    if (tipo !== "pdf" && tipo !== "editable") {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);

    // Paquete unitario (maestro con los 6 grados): una sola orden con todos
    // los combos multigrado de la agrupación elegida, a precio de combo.
    if (body.combo === "unitaria") {
      return await prepararCompraUnitaria(admin, user, body, {
        mpToken,
        siteUrl,
        supabaseUrl,
      });
    }

    const productoId = body.producto_id;
    if (!productoId) {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select(
        "id, titulo, precio_pdf, precio_editable, activo, es_prueba, tipo_paquete, proyecto_folder_drive_id, archivo_pdf_drive_id, archivo_docx_drive_id",
      )
      .eq("id", productoId)
      .maybeSingle();

    // Se excluye es_prueba: la función usa service role (ignora la RLS que oculta
    // el producto de prueba), así que sin este filtro alguien con el UUID podría
    // comprar material real al precio simbólico de prueba.
    if (prodErr || !producto || !producto.activo || producto.es_prueba) {
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
    const tipoLabel = tipo === "pdf" ? "PDF" : "Editable (Word) + PDF";
    return await crearPreferenciaYResponder(admin, {
      mpToken,
      supabaseUrl,
      siteUrl,
      ordenId,
      itemId: productoId,
      titulo: producto.titulo + " — " + tipoLabel,
      precio: Number(precio),
      failureUrl: siteUrl + "/tienda/checkout?producto_id=" +
        encodeURIComponent(productoId) + "&tipo=" + tipo,
      payerEmail: user.email,
      metadata: {
        orden_id: ordenId,
        producto_id: productoId,
        tipo,
        user_id: user.id,
      },
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
 * Crea la preferencia de Checkout Pro y devuelve la respuesta HTTP final.
 * Camino compartido por la compra individual y el paquete unitario.
 */
async function crearPreferenciaYResponder(
  admin: Cliente,
  opts: {
    mpToken: string;
    supabaseUrl: string;
    siteUrl: string;
    ordenId: string;
    itemId: string;
    titulo: string;
    precio: number;
    failureUrl: string;
    payerEmail?: string;
    metadata: Record<string, unknown>;
  },
): Promise<Response> {
  const ahora = new Date();
  const vence = new Date(ahora.getTime() + DIAS_VIGENCIA * 24 * 60 * 60 * 1000);

  const prefBody = {
    items: [
      {
        id: opts.itemId,
        title: opts.titulo,
        description: "Planeación didáctica NEM en formato digital",
        category_id: "learnings",
        quantity: 1,
        unit_price: opts.precio,
        currency_id: "MXN",
      },
    ],
    external_reference: opts.ordenId,
    payer: { email: opts.payerEmail },
    // Rutas sin ".html": Cloudflare Pages redirige (307) las que lo llevan y,
    // aunque conserva los query params, evitamos el salto de más en el
    // regreso desde Mercado Pago.
    back_urls: {
      success: opts.siteUrl + "/tienda/mis-compras",
      pending: opts.siteUrl + "/tienda/mis-compras",
      failure: opts.failureUrl,
    },
    auto_return: "approved",
    notification_url: opts.supabaseUrl + "/functions/v1/webhook-mercadopago",
    // Lo que el comprador verá en su estado de cuenta bancario.
    statement_descriptor: "JISSEZ",
    // Sin exclusiones a propósito: queremos que se ofrezcan todos los medios
    // (cuenta MP, tarjeta, dos tarjetas, efectivo y SPEI). Enviar un
    // `excluded_payment_types` vacío hace que MP lo guarde como [{"id":""}],
    // así que simplemente no mandamos el campo.
    payment_methods: {
      installments: MAX_MENSUALIDADES,
    },
    expires: true,
    expiration_date_from: ahora.toISOString(),
    expiration_date_to: vence.toISOString(),
    metadata: opts.metadata,
  };

  const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + opts.mpToken,
      "Content-Type": "application/json",
      // Evita preferencias duplicadas si el usuario da doble clic.
      "X-Idempotency-Key": opts.ordenId,
    },
    body: JSON.stringify(prefBody),
  });

  if (!mpResp.ok) {
    const txt = await mpResp.text();
    console.error("MP preference error:", mpResp.status, txt);
    await admin
      .from("marketplace_ordenes")
      .update({ estado: "fallido" })
      .eq("id", opts.ordenId);
    return jsonResponse({ error: "No se pudo iniciar el pago" }, 502);
  }

  const pref = await mpResp.json();

  await admin
    .from("marketplace_ordenes")
    .update({ referencia_pago: pref.id })
    .eq("id", opts.ordenId);

  // Mercado Pago devuelve dos URLs y usar la equivocada rompe el pago:
  //   credenciales TEST-...   → sandbox_init_point (entorno de pruebas)
  //   credenciales APP_USR-.. → init_point
  // Ojo: un APP_USR- puede pertenecer a un usuario de prueba; en ese caso
  // también va por init_point, pero el comprador NO debe tener sesión con
  // una cuenta real de MP o el pago se rechaza por mezclar entornos.
  const esCredencialSandbox = opts.mpToken.startsWith("TEST-");
  const destino = esCredencialSandbox
    ? (pref.sandbox_init_point || pref.init_point)
    : pref.init_point;

  return jsonResponse({
    orden_id: opts.ordenId,
    preference_id: pref.id,
    init_point: destino,
    sandbox: esCredencialSandbox,
  });
}

// Combos que forman el paquete unitario, por agrupación.
// Nomenclatura contraintuitiva pero correcta (ver marketplace_precios.sql):
//   tridocente = combos de 2 grados; bidocente = combos de 3 grados.
const COMBOS_UNITARIA: Record<string, string[]> = {
  tridocente: ["1-2", "3-4", "5-6"],
  bidocente: ["1-2-3", "4-5-6"],
};

/**
 * Prepara la compra del paquete unitario: los 3 (o 2) paquetes multigrado de
 * una agrupación en UNA sola orden a precio de combo. La entrega no necesita
 * nada especial: `otorgarAccesosDeOrden()` ya recorre todos los items.
 *
 * El precio sale de marketplace_precios (modalidad_precio = 'unitaria'), hoy
 * plano: siempre nivel 1. Si algún día vuelve la escalada por ventas, aquí
 * habría que consultar el nivel vigente.
 */
async function prepararCompraUnitaria(
  admin: Cliente,
  user: { id: string; email?: string },
  body: Record<string, unknown>,
  cfg: { mpToken: string; siteUrl: string; supabaseUrl: string },
): Promise<Response> {
  const agrupacion = String(body.agrupacion || "");
  const tipoPaquete = String(body.tipo_paquete || "");
  const tipo = String(body.tipo);
  const trimestre = Number(body.trimestre);

  const combosEsperados = COMBOS_UNITARIA[agrupacion];
  if (!combosEsperados || (tipoPaquete !== "trimestre" && tipoPaquete !== "ciclo")) {
    return jsonResponse({ error: "Parámetros inválidos" }, 400);
  }
  if (tipoPaquete === "trimestre" && ![1, 2, 3].includes(trimestre)) {
    return jsonResponse({ error: "Parámetros inválidos" }, 400);
  }

  // Resolver los productos reales del combo. `es_prueba` fuera siempre: con
  // service role la RLS no lo oculta y se colaría al paquete.
  let query = admin
    .from("marketplace_productos")
    .select(
      "id, titulo, grados_combo, activo, es_prueba, tipo_paquete, proyecto_folder_drive_id, archivo_pdf_drive_id, archivo_docx_drive_id",
    )
    .eq("organizacion", "multigrado")
    .eq("modalidad", agrupacion)
    .eq("tipo_paquete", tipoPaquete)
    .eq("activo", true)
    .eq("es_prueba", false);
  if (tipoPaquete === "trimestre") query = query.eq("trimestre", trimestre);
  const { data: productos, error: prodErr } = await query;

  const porCombo = new Map(
    (productos || []).map((p: Record<string, any>) => [p.grados_combo, p]),
  );
  const completo = !prodErr &&
    combosEsperados.every((c) => porCombo.has(c));
  if (!completo) {
    return jsonResponse(
      {
        error:
          "El paquete unitario todavía no está completo para esta opción. Estamos terminando de prepararlo.",
        sin_contenido: true,
      },
      409,
    );
  }
  const elegidos = combosEsperados.map((c) => porCombo.get(c)!);

  // Precio del combo: siempre de la base, nunca del cliente.
  const { data: tarifa } = await admin
    .from("marketplace_precios")
    .select("precio_base, precio_addon_editable")
    .eq("modalidad_precio", "unitaria")
    .eq("tipo_paquete", tipoPaquete)
    .eq("nivel", 1)
    .maybeSingle();
  if (!tarifa) {
    return jsonResponse(
      { error: "Este paquete no tiene precio configurado" },
      400,
    );
  }
  const precioTotal = tipo === "pdf"
    ? Number(tarifa.precio_base)
    : Number(tarifa.precio_base) + Number(tarifa.precio_addon_editable);

  // Ya tiene alguno de los paquetes en esa versión: que no pague doble.
  const productoIds = elegidos.map((p) => p.id as string);
  const { data: yaTiene } = await admin
    .from("marketplace_accesos")
    .select("producto_id")
    .eq("user_id", user.id)
    .in("producto_id", productoIds)
    .eq("tipo", tipo)
    .limit(1);
  if (yaTiene && yaTiene.length) {
    const repetido = elegidos.find((p) => p.id === yaTiene[0].producto_id);
    return jsonResponse(
      {
        error: "Ya tienes " + (repetido?.titulo || "uno de estos paquetes") +
          ". Compra por separado los paquetes que te falten desde el catálogo.",
        ya_comprado: true,
      },
      409,
    );
  }

  // Todos los paquetes del combo deben tener material entregable.
  const entregables = await Promise.all(elegidos.map((p) => puedeEntregarse(p)));
  if (entregables.some((ok) => !ok)) {
    return jsonResponse(
      {
        error:
          "Este paquete todavía no está disponible para compra. Estamos terminando de prepararlo.",
        sin_contenido: true,
      },
      409,
    );
  }

  const ordenId = await reutilizarOCrearOrdenCombo(
    admin,
    user.id,
    productoIds,
    tipo,
    precioTotal,
  );
  if (!ordenId) {
    return jsonResponse({ error: "No se pudo crear la orden" }, 500);
  }
  await archivarOrdenesCaducadas(admin, user.id, ordenId);

  const etiquetaAgrupacion = agrupacion === "tridocente"
    ? "3 paquetes de 2 grados"
    : "2 paquetes de 3 grados";
  const etiquetaPaquete = tipoPaquete === "ciclo"
    ? "Ciclo completo"
    : "Trimestre " + trimestre;
  const tipoLabel = tipo === "pdf" ? "PDF" : "Editable (Word) + PDF";
  const paramsCombo = "combo=unitaria&agrupacion=" + agrupacion +
    "&tipo_paquete=" + tipoPaquete +
    (tipoPaquete === "trimestre" ? "&trimestre=" + trimestre : "") +
    "&tipo=" + tipo;

  return await crearPreferenciaYResponder(admin, {
    mpToken: cfg.mpToken,
    supabaseUrl: cfg.supabaseUrl,
    siteUrl: cfg.siteUrl,
    ordenId,
    itemId: "unitaria-" + agrupacion + "-" + tipoPaquete +
      (tipoPaquete === "trimestre" ? "-t" + trimestre : ""),
    titulo: "Paquete unitario 1° a 6° (" + etiquetaAgrupacion + ") — " +
      etiquetaPaquete + " — " + tipoLabel,
    precio: precioTotal,
    failureUrl: cfg.siteUrl + "/tienda/checkout?" + paramsCombo,
    payerEmail: user.email,
    metadata: {
      orden_id: ordenId,
      combo: "unitaria",
      agrupacion,
      tipo_paquete: tipoPaquete,
      trimestre: tipoPaquete === "trimestre" ? trimestre : null,
      tipo,
      user_id: user.id,
    },
  });
}

/**
 * Reutiliza (o crea) la orden pendiente de un combo. Solo reutiliza una orden
 * cuyo conjunto de items coincide EXACTAMENTE (mismos productos, misma
 * versión, ninguno de más) para no pisar compras individuales pendientes.
 *
 * El precio_unitario se reparte uniforme, con el ajuste de centavos en el
 * primer item para que la suma cuadre con monto_total. El pago se valida
 * contra monto_total, pero items en $0 confundirían soporte y reembolsos.
 */
async function reutilizarOCrearOrdenCombo(
  admin: Cliente,
  userId: string,
  productoIds: string[],
  tipo: string,
  precioTotal: number,
): Promise<string | null> {
  const precios = repartirPrecio(precioTotal, productoIds.length);

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
      .select("id, orden_id, producto_id, tipo")
      .in("orden_id", ids);

    const porOrden = new Map<string, any[]>();
    for (const it of items || []) {
      const lista = porOrden.get(it.orden_id) || [];
      lista.push(it);
      porOrden.set(it.orden_id, lista);
    }

    for (const ordenId of ids) {
      const its = porOrden.get(ordenId) || [];
      const coincide = its.length === productoIds.length &&
        its.every((it) => it.tipo === tipo && productoIds.includes(it.producto_id)) &&
        new Set(its.map((it) => it.producto_id)).size === its.length;
      if (!coincide) continue;

      // El precio pudo cambiar entre un intento y otro.
      await admin
        .from("marketplace_ordenes")
        .update({ monto_total: precioTotal })
        .eq("id", ordenId);
      for (let i = 0; i < productoIds.length; i++) {
        const item = its.find((it) => it.producto_id === productoIds[i]);
        if (item) {
          await admin
            .from("marketplace_orden_items")
            .update({ precio_unitario: precios[i] })
            .eq("id", item.id);
        }
      }
      return ordenId;
    }
  }

  const { data: orden, error: ordErr } = await admin
    .from("marketplace_ordenes")
    .insert({
      user_id: userId,
      monto_total: precioTotal,
      estado: "pendiente",
      metodo_pago: "mercadopago",
    })
    .select("id")
    .single();
  if (ordErr || !orden) {
    console.error("insert orden combo falló:", ordErr);
    return null;
  }

  const { error: itemErr } = await admin
    .from("marketplace_orden_items")
    .insert(productoIds.map((pid, i) => ({
      orden_id: orden.id,
      producto_id: pid,
      tipo,
      precio_unitario: precios[i],
    })));
  if (itemErr) {
    console.error("insert items combo falló:", itemErr);
    return null;
  }

  return orden.id;
}

/**
 * Divide un total en n partes que suman exacto: parte igual para todos y los
 * centavos sobrantes en la primera.
 */
function repartirPrecio(total: number, n: number): number[] {
  const totalCent = Math.round(total * 100);
  const baseCent = Math.floor(totalCent / n);
  const partes = new Array(n).fill(baseCent / 100);
  partes[0] = (totalCent - baseCent * (n - 1)) / 100;
  return partes;
}

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

    if (tipoPaquete === "trimestre") {
      return await trimestreTieneMaterial(folderId);
    }

    // El ciclo promete los tres trimestres. Mirar solo el primer proyecto no
    // basta: un paquete con T1 lleno y T2/T3 vacíos pasaría el filtro y el
    // comprador pagaría 12 proyectos para recibir 4. Se exige que los tres
    // trimestres tengan material. En paralelo, para no alargar el checkout.
    const carpetas = await Promise.all(
      [1, 2, 3].map((t) => carpetaTrimestreDeGrado(folderId, t)),
    );
    if (carpetas.some((c) => !c)) return false;

    const conMaterial = await Promise.all(
      carpetas.map((c) => trimestreTieneMaterial(c!.id)),
    );
    return conMaterial.every(Boolean);
  } catch (err) {
    console.error("no se pudo verificar Drive, se permite la compra:", err);
    return true;
  }
}

/** ¿La carpeta de un trimestre tiene al menos un documento descargable? */
async function trimestreTieneMaterial(trimestreFolderId: string): Promise<boolean> {
  const proyectos = await proyectosDeTrimestre(trimestreFolderId);
  if (!proyectos.length) return false;

  const archivos = await listDriveFolder(proyectos[0].id);
  return archivos.some((f) =>
    f.mimeType !== FOLDER_MIME && /\.(pdf|docx?)$/i.test(f.name)
  );
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
    // Solo se puede reutilizar una orden de EXACTAMENTE un item. Una orden
    // combo (paquete unitario) pendiente también contiene este producto;
    // reutilizarla aquí la dejaría con el monto individual y, al pagarse,
    // entregaría todos sus paquetes al precio de uno.
    const { data: items } = await admin
      .from("marketplace_orden_items")
      .select("id, orden_id, producto_id, tipo")
      .in("orden_id", ids);

    const porOrden = new Map<string, any[]>();
    for (const it of items || []) {
      const lista = porOrden.get(it.orden_id) || [];
      lista.push(it);
      porOrden.set(it.orden_id, lista);
    }

    for (const ordenId of ids) {
      const its = porOrden.get(ordenId) || [];
      if (its.length !== 1) continue;
      if (its[0].producto_id !== productoId || its[0].tipo !== tipo) continue;

      // El precio pudo cambiar entre un intento y otro.
      await admin
        .from("marketplace_ordenes")
        .update({ monto_total: precio })
        .eq("id", ordenId);
      await admin
        .from("marketplace_orden_items")
        .update({ precio_unitario: precio })
        .eq("id", its[0].id);
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
