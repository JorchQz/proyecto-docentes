// Edge Function: previsualizar (pública)
//
// Sirve una muestra del paquete: las primeras 3 páginas del PDF del PRIMER
// proyecto. Sin compra ni sesión. Nunca expone el file ID de Drive.
//
// GET /functions/v1/previsualizar?producto_id=<uuid>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import { downloadDriveFile, listDriveFolder, primerProyectoFolder } from "../_shared/google-drive.ts";
import { normalizarTipoPaquete } from "../_shared/entrega.ts";

const PAGINAS_MUESTRA = 3;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const url = new URL(req.url);
    const productoId = url.searchParams.get("producto_id");
    if (!productoId) return jsonResponse({ error: "Falta producto_id" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: producto, error } = await admin
      .from("marketplace_productos")
      .select("activo, tipo_paquete, proyecto_folder_drive_id")
      .eq("id", productoId)
      .maybeSingle();

    if (error || !producto || !producto.proyecto_folder_drive_id) {
      return jsonResponse({ error: "Producto no disponible" }, 404);
    }
    // Un producto oculto solo se previsualiza para el admin (JWT que pasa
    // es_admin) o con el secreto de mantenimiento: así se generan las
    // imágenes de muestra ANTES de publicar.
    // ¿Quién pide? El admin (JWT que pasa es_admin) o el mantenimiento (secreto).
    // Solo ellos pueden previsualizar un producto oculto y pedir el PDF
    // completo (`completo=1`) para localizar la página de la Sesión 1 al
    // generar las imágenes de muestra.
    const cronSecret = Deno.env.get("CRON_SECRET");
    let autorizado = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const authHeader = req.headers.get("Authorization") || "";
    if (!autorizado && authHeader.startsWith("Bearer ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
      const { data: esAdmin } = await userClient.rpc("es_admin");
      autorizado = esAdmin === true;
    }
    if (!producto.activo && !autorizado) return jsonResponse({ error: "Producto no disponible" }, 404);
    const completo = autorizado && url.searchParams.get("completo") === "1";

    // En un proyecto individual la carpeta del producto ya es la del proyecto.
    const tipoPaquete = normalizarTipoPaquete(producto.tipo_paquete);

    // Primer proyecto del paquete.
    const proyecto = await primerProyectoFolder(producto.proyecto_folder_drive_id, tipoPaquete);
    if (!proyecto) return jsonResponse({ error: "Sin vista previa disponible" }, 404);

    // PDF de planeación dentro de ese proyecto.
    const archivos = await listDriveFolder(proyecto.id);
    const pdfs = archivos.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    // Preferir el PDF de la planeación (por nombre); si no, el primero.
    const pdf = pdfs.find((f) => /planeac|proyecto/i.test(f.name)) || pdfs[0];
    if (!pdf) return jsonResponse({ error: "Sin vista previa disponible" }, 404);

    const fullBytes = await downloadDriveFile(pdf.id);

    // Extraer solo las primeras N páginas (el admin puede pedirlo completo).
    let muestraBytes = fullBytes;
    if (completo) {
      return new Response(fullBytes, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "no-store" },
      });
    }
    try {
      const src = await PDFDocument.load(fullBytes, { ignoreEncryption: true });
      const total = src.getPageCount();
      const n = Math.min(PAGINAS_MUESTRA, total);
      const out = await PDFDocument.create();
      const indices = Array.from({ length: n }, (_, i) => i);
      const paginas = await out.copyPages(src, indices);
      paginas.forEach((p) => out.addPage(p));
      muestraBytes = await out.save();
    } catch (_) {
      // Si no se puede recortar, no servimos el PDF completo (sería regalar el proyecto).
      return jsonResponse({ error: "Vista previa no disponible" }, 404);
    }

    return new Response(muestraBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("previsualizar error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
