// Edge Function: completar-pedido (solo administración)
//
// Entrega un proyecto personalizado. Jorge ya subió la carpeta a Drive
// ({grado o combo}/Proyectos Personalizados/{PZ-0001}_{nombre}/ con PDF y DOCX
// en la raíz y los anexos en subcarpetas S##) y pega aquí su ID. La función:
//
//   1. verifica en Drive que la carpeta tenga PDF y DOCX (y subcarpetas si el
//      pedido es con anexos), para no "entregar" una carpeta vacía;
//   2. crea el producto tipo 'proyecto' con esa carpeta (publicado en el
//      catálogo si `publicar`, oculto si no);
//   3. otorga el acceso al cliente (pdf + editable, + anexos si los pagó), con
//      lo que el proyecto aparece en su biblioteca como cualquier compra;
//   4. marca el pedido como completado y avisa al cliente por correo.
//
// POST /functions/v1/completar-pedido
//   body: { pedido_id, drive_folder_id, publicar: bool,
//           dosificacion_proyecto_id?, titulo? }
//   (el precio de catálogo sale del tarifario, renglón 'proyecto')
//   → { ok: true, producto_id, numero_pedido }
//
// Autorización: el JWT del usuario debe pasar la RPC es_admin().

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { crearAdmin, crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import { FOLDER_MIME, getDriveFile, listDriveFolder } from "../_shared/google-drive.ts";
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

const PRECIO_CATALOGO = { sin_anexos: 80, con_anexos: 120 };

function faseDeGrado(g: number): number {
  return g <= 2 ? 3 : (g <= 4 ? 4 : 5);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "No autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
    const { data: esAdmin, error: adminErr } = await userClient.rpc("es_admin");
    if (adminErr || esAdmin !== true) return jsonResponse({ error: "No autorizado" }, 403);

    const body = await req.json().catch(() => ({}));
    const pedidoId = String(body.pedido_id || "");
    const folderId = String(body.drive_folder_id || "").trim();
    const publicar = body.publicar === true;
    if (!pedidoId || !folderId) return jsonResponse({ error: "Faltan pedido_id o drive_folder_id" }, 400);

    const admin = crearAdmin(supabaseUrl, serviceKey);
    const { data: pedido, error: pedErr } = await admin
      .from("marketplace_pedidos")
      .select("*")
      .eq("id", pedidoId)
      .maybeSingle();
    if (pedErr || !pedido) return jsonResponse({ error: "Pedido no encontrado" }, 404);
    if (pedido.estado === "completado") return jsonResponse({ error: "Este pedido ya se entregó", ya_completado: true }, 409);
    if (pedido.estado !== "pendiente" && pedido.estado !== "en_proceso") {
      return jsonResponse({ error: "El pedido no está pagado o fue cancelado" }, 409);
    }

    // ── 1. La carpeta de Drive tiene lo que se vendió ─────────────────────
    let carpeta;
    try {
      carpeta = await getDriveFile(folderId);
    } catch (_) {
      return jsonResponse({ error: "No se pudo leer esa carpeta en Drive. ¿Está compartida con la cuenta de servicio y el ID es correcto?" }, 400);
    }
    if (carpeta.mimeType !== FOLDER_MIME) return jsonResponse({ error: "El ID no es de una carpeta" }, 400);
    const hijos = await listDriveFolder(folderId);
    const archivos = hijos.filter((f) => f.mimeType !== FOLDER_MIME);
    const tienePdf = archivos.some((f) => /\.pdf$/i.test(f.name));
    const tieneDocx = archivos.some((f) => /\.docx$/i.test(f.name));
    const subcarpetas = hijos.filter((f) => f.mimeType === FOLDER_MIME).length;
    if (!tienePdf || !tieneDocx) {
      return jsonResponse({
        error: "La carpeta debe tener la planeación en PDF y en Word (.docx) en la raíz. " +
          "Encontré: " + (tienePdf ? "PDF" : "sin PDF") + ", " + (tieneDocx ? "Word" : "sin Word") + ".",
        carpeta_incompleta: true,
      }, 409);
    }
    if (pedido.nivel === "con_anexos" && subcarpetas === 0) {
      return jsonResponse({
        error: "El pedido es CON anexos pero la carpeta no tiene subcarpetas S## con anexos.",
        carpeta_incompleta: true,
      }, 409);
    }

    // ── 2. Producto tipo 'proyecto' ───────────────────────────────────────
    const grados: number[] = (pedido.grados || []).map(Number);
    const esMulti = pedido.organizacion === "multigrado";
    const dosifId = body.dosificacion_proyecto_id && String(body.dosificacion_proyecto_id).length > 10
      ? String(body.dosificacion_proyecto_id) : null;
    let nombreProyecto: string | null = null;
    let metodologia: string | null = null;
    let numSesiones: number | null = null;
    if (dosifId) {
      const { data: d } = await admin
        .from("dosificacion_proyectos")
        .select("nombre_proyecto, metodologia, num_sesiones_estimadas")
        .eq("id", dosifId).maybeSingle();
      if (!d) return jsonResponse({ error: "El proyecto del bot indicado no existe" }, 400);
      nombreProyecto = d.nombre_proyecto;
      metodologia = d.metodologia;
      numSesiones = d.num_sesiones_estimadas;
    }
    const aula = aulaDePedido(pedido);
    const titulo = String(body.titulo || "").trim() ||
      (aula + " — " + (nombreProyecto || "Proyecto personalizado " + pedido.numero_pedido));
    // Precio de catálogo del proyecto individual: del tarifario por modalidad
    // (renglón 'proyecto'), igual que los demás sueltos. Nunca del cliente.
    const { data: tarifa } = await admin
      .from("marketplace_precios")
      .select("precio_base, precio_addon_editable")
      .eq("modalidad_precio", esMulti ? "multigrado" : "un_grado")
      .eq("tipo_paquete", "proyecto")
      .eq("nivel", 1)
      .maybeSingle();
    const precioPdf = tarifa ? Number(tarifa.precio_base) : PRECIO_CATALOGO.sin_anexos;
    const precioConAnexos = tarifa
      ? Number(tarifa.precio_base) + Number(tarifa.precio_addon_editable)
      : PRECIO_CATALOGO.con_anexos;

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .insert({
        titulo,
        descripcion: "Proyecto personalizado (" + pedido.numero_pedido + ").",
        grado: grados[0] || 1,
        fase: faseDeGrado(grados[0] || 1),
        campo_formativo: null,
        trimestre: null,
        tipo_paquete: "proyecto",
        num_proyectos: 1,
        numero_proyecto: null,
        organizacion: pedido.organizacion,
        grados_combo: esMulti ? pedido.grados_combo : null,
        modalidad: esMulti ? pedido.modalidad : null,
        metodologia,
        num_sesiones: numSesiones,
        dosificacion_proyecto_id: dosifId,
        proyecto_folder_drive_id: folderId,
        precio_pdf: precioPdf,
        precio_pdf_con_anexos: precioConAnexos,
        precio_editable: null,
        // Publicado solo si Jorge lo marca; si no, lo ve únicamente el cliente
        // (política "comprador ve sus productos"). Con anexos en la carpeta
        // pero pedido sin anexos, el catálogo lo vende igual con anexos.
        activo: publicar,
        es_prueba: false,
        tiene_anexos: subcarpetas > 0,
      })
      .select("id")
      .single();
    if (prodErr || !producto) {
      console.error("insert producto de pedido falló:", prodErr);
      return jsonResponse({ error: "No se pudo crear el producto: " + (prodErr?.message || "") }, 500);
    }

    // ── 3. Acceso del cliente ─────────────────────────────────────────────
    const tipos = pedido.nivel === "con_anexos" ? ["pdf", "editable", "anexos"] : ["pdf", "editable"];
    const { error: accErr } = await admin
      .from("marketplace_accesos")
      .upsert(tipos.map((t) => ({
        user_id: pedido.user_id, producto_id: producto.id, tipo: t, orden_id: pedido.orden_id,
      })), { onConflict: "user_id,producto_id,tipo", ignoreDuplicates: true });
    if (accErr) {
      console.error("accesos de pedido fallaron:", accErr);
      return jsonResponse({ error: "El producto se creó pero no se pudo otorgar el acceso: " + accErr.message }, 500);
    }

    // ── 4. Pedido completado + correo ─────────────────────────────────────
    const ahora = new Date().toISOString();
    await admin
      .from("marketplace_pedidos")
      .update({
        estado: "completado", completado_en: ahora, producto_id: producto.id,
        drive_folder_id: folderId, dosificacion_proyecto_id: dosifId, updated_at: ahora,
      })
      .eq("id", pedidoId);

    let correoEnviado = false;
    try {
      const { data: userRes } = await admin.auth.admin.getUserById(pedido.user_id);
      const email = userRes?.user?.email;
      if (resendKey && email) {
        const html = plantillaCorreo(`
          <h1 style="${estiloTitulo}">Tu proyecto ${escaparHtml(pedido.numero_pedido)} está listo</h1>
          <p style="${estiloTexto}">
            Ya puedes abrirlo desde tu biblioteca: <strong>${escaparHtml(titulo)}</strong>,
            en PDF y en Word editable${pedido.nivel === "con_anexos" ? ", con sus anexos imprimibles" : ""}.
          </p>
          ${botonCorreo(siteUrl + "/tienda/mis-compras", "Abrir mi biblioteca")}
          <p style="${estiloNota}">
            Si algo no corresponde a lo que pediste, responde a este correo y lo revisamos sin costo.
            Tus descargas no caducan.
          </p>
        `);
        correoEnviado = await enviarCorreo(resendKey, email, "Tu proyecto " + pedido.numero_pedido + " está listo — Jissez", html);
      }
    } catch (err) {
      console.error("correo de entrega falló (no bloquea):", err);
    }

    return jsonResponse({
      ok: true,
      producto_id: producto.id,
      numero_pedido: pedido.numero_pedido,
      publicado: publicar,
      correo_enviado: correoEnviado,
      carpeta: carpeta.name,
    });
  } catch (err) {
    console.error("completar-pedido error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
