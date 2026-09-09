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
//     · paquete (trimestre/ciclo): 'pdf' o 'editable' (add-on de Word)
//     · proyecto individual (tipo_paquete = 'proyecto'): 'pdf' = sin anexos,
//       'anexos' = con anexos. El Word va incluido en los dos.
//   body paquete unitario:  { combo: 'unitaria',
//                             agrupacion: 'tridocente' | 'bidocente',
//                             tipo_paquete: 'trimestre' | 'ciclo',
//                             trimestre: 1 | 2 | 3,   // solo si tipo_paquete = 'trimestre'
//                             tipo: 'pdf' | 'editable' }
//   body proyecto a la medida: { pedido: { organizacion, grado | grados_combo,
//                                campos_formativos?[], contenido_ids?[], pda_ids?[],
//                                metodologia?, fecha_necesaria?, notas? },
//                                tipo: 'pdf' (sin anexos) | 'anexos' }
//   en todos, opcionales: cupon (código) y acepta_terminos (true cuando el
//   comprador marcó la casilla de Términos y Aviso de Privacidad; se sella en
//   marketplace_ordenes.terminos_aceptados_en).
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
// Rechazar la compra si el comprador no aceptó los Términos. Estuvo en falso
// mientras el checkout con la casilla no estaba servido (para no dejar sin
// pagar a quien tuviera la página vieja); desde el 2026-09-09, con el sitio
// nuevo en línea, es obligatorio. La fecha se sella en la orden.
const EXIGIR_TERMINOS = true;

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
    if (tipo !== "pdf" && tipo !== "editable" && tipo !== "anexos") {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }
    // Código de cupón opcional. Un código inválido NO tumba la compra: la base
    // lo ignora y se cobra el mejor precio disponible sin él.
    const cupon = normalizarCupon(body.cupon);

    // Aceptación de Términos y Aviso de Privacidad (ver EXIGIR_TERMINOS).
    const terminosEn = body.acepta_terminos === true ? new Date().toISOString() : null;
    if (EXIGIR_TERMINOS && !terminosEn) {
      return jsonResponse(
        { error: "Para continuar debes aceptar los Términos y Condiciones y el Aviso de Privacidad.", terminos: true },
        400,
      );
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);

    // Proyecto a la medida: no hay producto todavía, se crea un pedido y la
    // orden apunta a él. Se entrega cuando Jorge lo completa desde el admin.
    if (body.pedido && typeof body.pedido === "object") {
      if (tipo === "editable") return jsonResponse({ error: "Parámetros inválidos" }, 400);
      return await prepararPedidoPersonalizado(admin, user, body, {
        mpToken,
        siteUrl,
        supabaseUrl,
        terminosEn,
        cupon,
      });
    }

    // Paquete unitario (maestro con los 6 grados): una sola orden con todos
    // los combos multigrado de la agrupación elegida, a precio de combo.
    if (body.combo === "unitaria") {
      // El combo es de paquetes: "con anexos" no existe ahí.
      if (tipo === "anexos") return jsonResponse({ error: "Parámetros inválidos" }, 400);
      return await prepararCompraUnitaria(admin, user, body, {
        mpToken,
        siteUrl,
        supabaseUrl,
        terminosEn,
      });
    }

    const productoId = body.producto_id;
    if (!productoId) {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select(
        "id, titulo, precio_pdf, precio_editable, precio_pdf_con_anexos, tiene_anexos, activo, es_prueba, tipo_paquete, proyecto_folder_drive_id, archivo_pdf_drive_id, archivo_docx_drive_id",
      )
      .eq("id", productoId)
      .maybeSingle();

    // Se excluye es_prueba: la función usa service role (ignora la RLS que oculta
    // el producto de prueba), así que sin este filtro alguien con el UUID podría
    // comprar material real al precio simbólico de prueba.
    if (prodErr || !producto || !producto.activo || producto.es_prueba) {
      return jsonResponse({ error: "Producto no disponible" }, 404);
    }

    // Las versiones dependen del producto: el paquete vende el Word como
    // add-on ('editable'); el proyecto individual lo incluye y vende los anexos
    // aparte ('anexos'). Cruzarlas cobraría una versión que no existe.
    const esProyecto = producto.tipo_paquete === "proyecto";
    if (esProyecto ? tipo === "editable" : tipo === "anexos") {
      return jsonResponse({ error: "Esta versión no existe para este producto" }, 400);
    }
    // Un proyecto individual verificado SIN anexos no vende la versión con
    // anexos (la ficha no la ofrece; esto cubre enlaces armados a mano).
    if (esProyecto && tipo === "anexos" && producto.tiene_anexos === false) {
      return jsonResponse({ error: "Este proyecto no incluye anexos imprimibles; elige la versión sin anexos.", sin_anexos: true }, 400);
    }

    // Nunca cobrar por un paquete que no tiene nada que entregar.
    //
    // No basta con mirar los campos: un producto puede tener
    // `proyecto_folder_drive_id` apuntando a una carpeta de Drive todavía
    // vacía. Los paquetes se publican en el catálogo antes de que su material
    // esté cargado, así que comprobamos contra Drive de verdad.
    if (!(await puedeEntregarse(producto, tipo))) {
      return jsonResponse(
        {
          error:
            "Este paquete todavía no está disponible para compra. Estamos terminando de prepararlo.",
          sin_contenido: true,
        },
        409,
      );
    }

    const precioLista = esProyecto
      ? (tipo === "pdf" ? producto.precio_pdf : producto.precio_pdf_con_anexos)
      : (tipo === "pdf" ? producto.precio_pdf : producto.precio_editable);
    if (precioLista == null) {
      return jsonResponse(
        { error: "Este producto no tiene precio para esa versión" },
        400,
      );
    }
    // El importe lo decide la BASE, no este archivo: la misma función que
    // evalúa la vigencia contra now() aplica el redondeo y elige entre la
    // promoción y el cupón. Si todo venció devuelve el precio de lista.
    const resuelto = await precioConPromo(
      admin, Number(precioLista), cupon, user.id,
    );
    if (resuelto == null) {
      return jsonResponse(
        { error: "No pudimos calcular el precio. Vuelve a intentarlo." },
        503,
      );
    }
    const precio = resuelto.precio;

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
      resuelto,
    );
    if (!ordenId) {
      return jsonResponse({ error: "No se pudo crear la orden" }, 500);
    }

    // Archivar pendientes caducadas del usuario (limpieza oportunista).
    await archivarOrdenesCaducadas(admin, user.id, ordenId);
    await sellarTerminos(admin, ordenId, terminosEn);

    // 2. Crear la preferencia en Mercado Pago.
    const tipoLabel = esProyecto
      ? (tipo === "anexos" ? "PDF + Word + anexos" : "PDF + Word")
      : (tipo === "pdf" ? "PDF" : "Editable (Word) + PDF");
    return await crearPreferenciaYResponder(admin, {
      mpToken,
      supabaseUrl,
      siteUrl,
      ordenId,
      itemId: productoId,
      titulo: producto.titulo + " — " + tipoLabel,
      precio,
      failureUrl: siteUrl + "/tienda/checkout?producto_id=" +
        encodeURIComponent(productoId) + "&tipo=" + tipo,
      payerEmail: user.email,
      cupon: resuelto.cuponCodigo,
      cuponMotivo: resuelto.cuponMotivo,
      metadata: {
        orden_id: ordenId,
        producto_id: productoId,
        tipo,
        user_id: user.id,
        cupon: resuelto.cuponCodigo,
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
    /** Cupón que ganó, para que el checkout lo confirme. */
    cupon?: string | null;
    /** Por qué un cupón enviado no se aplicó (no_mejora, agotado, ...). */
    cuponMotivo?: string | null;
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
    // Eco del importe realmente cobrado. El checkout lo compara con lo que
    // tiene pintado y no redirige si difiere: cierra la ventana en la que la
    // promoción o el cupón caducan entre que el comprador ve el precio y pulsa
    // pagar.
    precio: opts.precio,
    cupon: opts.cupon ?? null,
    cupon_motivo: opts.cuponMotivo ?? null,
  });
}

/** Lo que se cobra y de dónde salió el descuento. */
interface PrecioResuelto {
  /** Importe final, ya con promoción o cupón (el mayor de los dos). */
  precio: number;
  /** Cupón que GANÓ, ya normalizado. null si mandó la promoción o la lista. */
  cuponCodigo: string | null;
  /** Pesos entre el precio de lista y lo que se cobra. */
  descuento: number;
  /** Por qué un cupón enviado no se aplicó, para decírselo al comprador. */
  cuponMotivo: string | null;
}

/**
 * Precio que se cobra = precio de lista con el mejor descuento disponible.
 *
 * La decisión vive SOLO en SQL (marketplace_cupon_evaluar, en
 * supabase/marketplace_cupones.sql), que es el mismo núcleo que consulta el
 * checkout al validar un cupón. No se replica aquí a propósito: si la regla
 * existiera en dos sitios, lo mostrado y lo cobrado podrían separarse.
 *
 * El cupón NO se acumula con la promoción: gana el descuento mayor. Si el
 * cupón no mejora, no se estampa en la orden y por tanto no consume un uso.
 *
 * Falla CERRADO (devuelve null): si la RPC no responde no se cobra el precio
 * de lista, porque durante una promoción eso sería cobrar MÁS de lo que el
 * comprador vio en pantalla.
 */
async function precioConPromo(
  admin: Cliente,
  lista: number,
  codigoCupon?: string | null,
  userId?: string | null,
): Promise<PrecioResuelto | null> {
  const { data, error } = await admin.rpc("marketplace_precio_con_cupon", {
    p_precio: lista,
    p_codigo: codigoCupon ?? null,
    p_user_id: userId ?? null,
  });
  if (error) {
    console.error("marketplace_precio_con_cupon falló:", error);
    return null;
  }

  const precio = Number(data?.precio_final);
  if (!Number.isFinite(precio) || precio < 0 || precio > lista) {
    console.error("precio con descuento fuera de rango:", { lista, data });
    return null;
  }

  // Solo se sella el cupón cuando de verdad ganó: es lo que cuenta los usos.
  const aplicado = data?.aplicado === true;
  return {
    precio,
    cuponCodigo: aplicado ? String(data.codigo) : null,
    descuento: lista - precio,
    cuponMotivo: data?.motivo ?? null,
  };
}

/** Normaliza el código tal y como lo hace la base, antes de mandárselo. */
function normalizarCupon(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase().slice(0, 24);
  return c === "" ? null : c;
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
  cfg: { mpToken: string; siteUrl: string; supabaseUrl: string; terminosEn: string | null },
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
  const precioLista = tipo === "pdf"
    ? Number(tarifa.precio_base)
    : Number(tarifa.precio_base) + Number(tarifa.precio_addon_editable);
  // Mismo camino que la compra individual: el descuento vigente lo aplica la
  // base, nunca este archivo. El cupón se descuenta del TOTAL del combo, antes
  // de repartirlo entre los paquetes.
  const resuelto = await precioConPromo(
    admin, precioLista, normalizarCupon(body.cupon), user.id,
  );
  if (resuelto == null) {
    return jsonResponse(
      { error: "No pudimos calcular el precio. Vuelve a intentarlo." },
      503,
    );
  }
  const precioTotal = resuelto.precio;

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
    resuelto,
  );
  if (!ordenId) {
    return jsonResponse({ error: "No se pudo crear la orden" }, 500);
  }
  await archivarOrdenesCaducadas(admin, user.id, ordenId);
  await sellarTerminos(admin, ordenId, cfg.terminosEn);

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
    cupon: resuelto.cuponCodigo,
    cuponMotivo: resuelto.cuponMotivo,
    metadata: {
      orden_id: ordenId,
      cupon: resuelto.cuponCodigo,
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
  resuelto: PrecioResuelto,
): Promise<string | null> {
  const precioTotal = resuelto.precio;
  const precios = repartirPrecio(precioTotal, productoIds.length);

  const { data: pendientes } = await admin
    .from("marketplace_ordenes")
    .select("id, monto_total, cupon_codigo")
    .eq("user_id", userId)
    .eq("estado", "pendiente")
    .eq("metodo_pago", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(20);

  const montos = new Map<string, number>(
    (pendientes || []).map((o: { id: string; monto_total: number }) =>
      [o.id, Number(o.monto_total)]
    ),
  );
  const cupones = new Map<string, string | null>(
    (pendientes || []).map((o: { id: string; cupon_codigo: string | null }) =>
      [o.id, o.cupon_codigo ?? null]
    ),
  );
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
      // Mismo motivo que en reutilizarOCrearOrden(): si el importe cambió, la
      // preferencia de MP asociada a esta orden sigue siendo la vieja por la
      // clave de idempotencia. Se crea una orden nueva.
      if (montos.get(ordenId) !== precioTotal) continue;
      // Y el cupón también: dos cupones distintos pueden dar el mismo importe
      // por casualidad, y la orden quedaría sellada con el que no es.
      if (cupones.get(ordenId) !== resuelto.cuponCodigo) continue;
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
      cupon_codigo: resuelto.cuponCodigo,
      descuento_aplicado: resuelto.descuento,
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

// Combos multigrado válidos y su modalidad: 2 grados = tridocente, 3 = bidocente.
const COMBOS_PEDIDO: Record<string, string> = {
  "1-2": "tridocente", "3-4": "tridocente", "5-6": "tridocente",
  "1-2-3": "bidocente", "4-5-6": "bidocente",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prepara el cobro de un proyecto a la medida.
 *
 * body.pedido: { organizacion: 'completa'|'multigrado', grado?: 1-6,
 *                grados_combo?: '1-2'…, campos_formativos?: [LEN|SAB|ETI|DHL],
 *                contenido_ids?: [uuid], pda_ids?: [uuid], metodologia?,
 *                fecha_necesaria?, notas? }
 * body.tipo:   'pdf' = sin anexos · 'anexos' = con anexos
 *
 * El precio sale de marketplace_personalizados_config (nunca del cliente) y
 * pasa por la misma promoción/cupón que todo. Si el cupo simultáneo está
 * agotado o los pedidos están cerrados, se responde 409 antes de crear nada.
 *
 * El pedido nace en 'pendiente_pago'; procesarPago() lo pasa a 'pendiente'
 * (en cola) cuando Mercado Pago acredita.
 */
async function prepararPedidoPersonalizado(
  admin: Cliente,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> },
  body: Record<string, any>,
  cfg: { mpToken: string; siteUrl: string; supabaseUrl: string; terminosEn: string | null; cupon: string | null },
): Promise<Response> {
  const tipo = String(body.tipo);
  const nivel = tipo === "anexos" ? "con_anexos" : "sin_anexos";
  const pd = body.pedido as Record<string, any>;

  // ── Validación del formulario ─────────────────────────────────────────────
  const organizacion = pd.organizacion === "multigrado" ? "multigrado" : "completa";
  let grados: number[];
  let gradosCombo: string | null = null;
  let modalidad: string | null = null;
  if (organizacion === "multigrado") {
    gradosCombo = String(pd.grados_combo || "");
    modalidad = COMBOS_PEDIDO[gradosCombo] || null;
    if (!modalidad) return jsonResponse({ error: "Elige una combinación de grados válida" }, 400);
    grados = gradosCombo.split("-").map(Number);
  } else {
    const g = Number(pd.grado);
    if (!(g >= 1 && g <= 6)) return jsonResponse({ error: "Elige el grado" }, 400);
    grados = [g];
  }
  // Listas (varios campos, contenidos y PDAs). Se aceptan también las claves en
  // singular por compatibilidad con enlaces viejos.
  const listaDe = (plural: unknown, singular: unknown): string[] => {
    const arr = Array.isArray(plural) ? plural : (singular != null ? [singular] : []);
    return Array.from(new Set(arr.map((v) => String(v))));
  };
  const cfs = listaDe(pd.campos_formativos, pd.campo_formativo).map((c) => c.toUpperCase());
  if (cfs.some((c) => !["LEN", "SAB", "ETI", "DHL"].includes(c))) {
    return jsonResponse({ error: "Campo formativo inválido" }, 400);
  }
  const contenidoIds = listaDe(pd.contenido_ids, pd.contenido_id).filter((v) => UUID_RE.test(v)).slice(0, 12);
  const pdaIds = listaDe(pd.pda_ids, pd.pda_id).filter((v) => UUID_RE.test(v)).slice(0, 30);
  const metodologia = pd.metodologia ? String(pd.metodologia).slice(0, 120) : null;
  const notas = pd.notas ? String(pd.notas).slice(0, 2000) : null;
  const fechaNecesaria = pd.fecha_necesaria && /^\d{4}-\d{2}-\d{2}$/.test(String(pd.fecha_necesaria))
    ? String(pd.fecha_necesaria) : null;
  const nombreCliente = String(
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.nombre_docente)) ||
    user.email || "",
  ).slice(0, 120);

  // ── Cupo, apertura y precio (todo de la base) ─────────────────────────────
  const { data: estado, error: estErr } = await admin.rpc("marketplace_personalizados_estado");
  if (estErr || !estado) {
    return jsonResponse({ error: "No pudimos consultar la disponibilidad. Vuelve a intentarlo." }, 503);
  }
  if (!estado.abierto) {
    return jsonResponse({
      error: estado.mensaje || "Por ahora no estamos recibiendo pedidos a la medida.",
      cerrado: true,
    }, 409);
  }
  if (Number(estado.cupos_disponibles) <= 0) {
    return jsonResponse({
      error: "Por ahora no hay cupo para pedidos a la medida: en cuanto entreguemos uno se libera un lugar.",
      agotado: true,
    }, 409);
  }
  const precioLista = Number(nivel === "con_anexos" ? estado.precio_con_anexos : estado.precio_sin_anexos);
  if (!Number.isFinite(precioLista) || precioLista <= 0) {
    return jsonResponse({ error: "El pedido a la medida no tiene precio configurado" }, 400);
  }
  const resuelto = await precioConPromo(admin, precioLista, cfg.cupon, user.id);
  if (resuelto == null) {
    return jsonResponse({ error: "No pudimos calcular el precio. Vuelve a intentarlo." }, 503);
  }
  const precio = resuelto.precio;

  // ── Reutilizar el intento pendiente o crear pedido + orden ────────────────
  // Mismo criterio que las compras normales: solo se reutiliza si el importe y
  // el cupón coinciden (la preferencia de MP está atada al id de la orden). El
  // formulario se actualiza con lo último que escribió el comprador.
  const campos = {
    nivel, organizacion, grados, grados_combo: gradosCombo, modalidad,
    campos_formativos: cfs, contenido_ids: contenidoIds, pda_ids: pdaIds, metodologia,
    fecha_necesaria: fechaNecesaria, notas, nombre_cliente: nombreCliente,
    precio, updated_at: new Date().toISOString(),
  };

  let pedidoId: string | null = null;
  let ordenId: string | null = null;
  const { data: previos } = await admin
    .from("marketplace_pedidos")
    .select("id, orden_id, marketplace_ordenes!marketplace_pedidos_orden_id_fkey(estado, monto_total, cupon_codigo)")
    .eq("user_id", user.id)
    .eq("estado", "pendiente_pago")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const pv of previos || []) {
    const o: any = pv.marketplace_ordenes;
    if (!o || o.estado !== "pendiente") continue;
    if (Number(o.monto_total) !== precio) continue;
    if ((o.cupon_codigo ?? null) !== resuelto.cuponCodigo) continue;
    pedidoId = pv.id;
    ordenId = pv.orden_id;
    break;
  }

  if (pedidoId && ordenId) {
    await admin.from("marketplace_pedidos").update(campos).eq("id", pedidoId);
  } else {
    const { data: pedido, error: pedErr } = await admin
      .from("marketplace_pedidos")
      .insert({ user_id: user.id, ...campos })
      .select("id, numero_pedido")
      .single();
    if (pedErr || !pedido) {
      console.error("insert pedido falló:", pedErr);
      return jsonResponse({ error: "No se pudo registrar el pedido" }, 500);
    }
    const { data: orden, error: ordErr } = await admin
      .from("marketplace_ordenes")
      .insert({
        user_id: user.id,
        monto_total: precio,
        estado: "pendiente",
        metodo_pago: "mercadopago",
        cupon_codigo: resuelto.cuponCodigo,
        descuento_aplicado: resuelto.descuento,
      })
      .select("id")
      .single();
    if (ordErr || !orden) {
      console.error("insert orden de pedido falló:", ordErr);
      return jsonResponse({ error: "No se pudo crear la orden" }, 500);
    }
    const { error: itemErr } = await admin
      .from("marketplace_orden_items")
      .insert({ orden_id: orden.id, pedido_id: pedido.id, producto_id: null, tipo, precio_unitario: precio });
    if (itemErr) {
      console.error("insert item de pedido falló:", itemErr);
      return jsonResponse({ error: "No se pudo crear la orden" }, 500);
    }
    await admin.from("marketplace_pedidos").update({ orden_id: orden.id }).eq("id", pedido.id);
    pedidoId = pedido.id;
    ordenId = orden.id;
  }

  await archivarOrdenesCaducadas(admin, user.id, ordenId);
  await sellarTerminos(admin, ordenId, cfg.terminosEn);

  const { data: pedidoFinal } = await admin
    .from("marketplace_pedidos").select("numero_pedido").eq("id", pedidoId).single();
  const numero = pedidoFinal?.numero_pedido || "";
  const aula = organizacion === "multigrado"
    ? "Multigrado " + gradosCombo!.split("-").map((n) => n + "°").join("-")
    : grados[0] + "° de Primaria";

  return await crearPreferenciaYResponder(admin, {
    mpToken: cfg.mpToken,
    supabaseUrl: cfg.supabaseUrl,
    siteUrl: cfg.siteUrl,
    ordenId,
    itemId: "pedido-" + pedidoId,
    titulo: "Proyecto a la medida " + numero + " — " + aula + " — " +
      (nivel === "con_anexos" ? "PDF + Word + anexos" : "PDF + Word"),
    precio,
    failureUrl: cfg.siteUrl + "/tienda/checkout?personalizado=1",
    payerEmail: user.email,
    cupon: resuelto.cuponCodigo,
    cuponMotivo: resuelto.cuponMotivo,
    metadata: {
      orden_id: ordenId,
      pedido_id: pedidoId,
      numero_pedido: numero,
      tipo,
      user_id: user.id,
      cupon: resuelto.cuponCodigo,
    },
  });
}

/**
 * Sella en la orden el momento en que el comprador aceptó los Términos. Solo
 * la primera vez: una orden reutilizada conserva la fecha original.
 */
async function sellarTerminos(
  admin: Cliente,
  ordenId: string,
  terminosEn: string | null,
): Promise<void> {
  if (!terminosEn) return;
  const { error } = await admin
    .from("marketplace_ordenes")
    .update({ terminos_aceptados_en: terminosEn })
    .eq("id", ordenId)
    .is("terminos_aceptados_en", null);
  if (error) console.error("sellar términos falló (no bloquea la compra):", error);
}

/**
 * ¿Hay material real que entregar por este paquete?
 *
 * No basta con que exista la carpeta del proyecto: el bot generador crea la
 * estructura de carpetas antes de que se suban los archivos, así que una
 * carpeta de proyecto puede estar vacía. Exigimos un documento descargable
 * (PDF o DOCX) dentro del primer proyecto.
 *
 * Proyecto individual: la carpeta es la del proyecto y el Word va incluido, así
 * que se exigen PDF y DOCX en la raíz; la versión con anexos exige además al
 * menos una subcarpeta. Vender "con anexos" una carpeta sin anexos sería
 * cobrar algo que no existe.
 *
 * Si Drive no responde no bloqueamos la venta: un fallo transitorio de Google
 * no debe costar una compra, y el acceso queda otorgado igual — la descarga
 * funcionará cuando Drive vuelva.
 */
async function puedeEntregarse(
  producto: Record<string, unknown>,
  tipoCompra?: string,
): Promise<boolean> {
  if (producto.archivo_pdf_drive_id || producto.archivo_docx_drive_id) {
    return true;
  }
  const folderId = producto.proyecto_folder_drive_id as string | null;
  if (!folderId) return false;

  try {
    const tipoPaquete = (producto.tipo_paquete || "trimestre") as
      | "trimestre"
      | "ciclo"
      | "proyecto";

    if (tipoPaquete === "proyecto") {
      const hijos = await listDriveFolder(folderId);
      const archivos = hijos.filter((f) => f.mimeType !== FOLDER_MIME);
      const tienePdf = archivos.some((f) => /\.pdf$/i.test(f.name));
      const tieneDocx = archivos.some((f) => /\.docx$/i.test(f.name));
      if (!tienePdf || !tieneDocx) return false;
      if (tipoCompra === "anexos") {
        return hijos.some((f) => f.mimeType === FOLDER_MIME);
      }
      return true;
    }

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
  resuelto: PrecioResuelto,
): Promise<string | null> {
  const precio = resuelto.precio;
  const { data: pendientes } = await admin
    .from("marketplace_ordenes")
    .select("id, monto_total, cupon_codigo")
    .eq("user_id", userId)
    .eq("estado", "pendiente")
    .eq("metodo_pago", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(20);

  const montos = new Map<string, number>(
    (pendientes || []).map((o: { id: string; monto_total: number }) =>
      [o.id, Number(o.monto_total)]
    ),
  );
  const cupones = new Map<string, string | null>(
    (pendientes || []).map((o: { id: string; cupon_codigo: string | null }) =>
      [o.id, o.cupon_codigo ?? null]
    ),
  );
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
      // El precio cambió entre un intento y otro (terminó la promoción, subió
      // el tarifario): NO se reutiliza. Reescribir el monto aquí no serviría,
      // porque la preferencia de MP se pide con X-Idempotency-Key = orden_id y
      // Mercado Pago devolvería la preferencia vieja con el importe viejo. Al
      // pagarse, procesarPago() la rechazaría por importe: dinero cobrado y
      // sin acceso. Con una orden nueva hay id nuevo, clave nueva y
      // preferencia nueva al precio correcto.
      if (montos.get(ordenId) !== precio) continue;
      // El cupón también tiene que ser el mismo: dos cupones distintos pueden
      // dar el mismo importe por casualidad, y la orden quedaría sellada con
      // el que no es (y contaría el uso equivocado).
      if (cupones.get(ordenId) !== resuelto.cuponCodigo) continue;
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
      cupon_codigo: resuelto.cuponCodigo,
      descuento_aplicado: resuelto.descuento,
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
