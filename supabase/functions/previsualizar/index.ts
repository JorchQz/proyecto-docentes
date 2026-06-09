// Edge Function: previsualizar (pública)
//
// Sirve una muestra del paquete: las primeras 3 páginas del PDF del PRIMER
// proyecto. Sin compra ni sesión. Nunca expone el file ID de Drive.
//
// GET /functions/v1/previsualizar?producto_id=<uuid>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { downloadDriveFile, listDriveFolder, primerProyectoFolder } from "../_shared/google-drive.ts";

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

    if (error || !producto || !producto.activo || !producto.proyecto_folder_drive_id) {
      return jsonResponse({ error: "Producto no disponible" }, 404);
    }

    const tipoPaquete = (producto.tipo_paquete || "trimestre") as "trimestre" | "ciclo";

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

    // Extraer solo las primeras N páginas.
    let muestraBytes = fullBytes;
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
    return jsonResponse({ error: "Error interno: " + (err?.message || String(err)) }, 500);
  }
});
