// Edge Function: ver-archivo
//
// Sirve UN archivo de un paquete comprado, identificándolo por su ruta relativa.
// Aplica el pie de página SOLO a la planeación (raíz del proyecto); anexos y examen
// van limpios. Respeta el tier (el .docx de planeación/examen solo para 'editable').
//
// GET /functions/v1/ver-archivo?acceso_id=<uuid>&proyecto=<n>&path=<ruta>&modo=inline|download
//
// Cabecera requerida: Authorization: Bearer <access_token del usuario>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { downloadDriveFile, listProyectoFolders, walkDriveFolder } from "../_shared/google-drive.ts";
import { aplicarPieDocx, aplicarPiePdf, textoPie } from "../_shared/watermark.ts";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function ext(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "No autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: "Sesión inválida" }, 401);
    const user = userData.user;

    const url = new URL(req.url);
    const accesoId = url.searchParams.get("acceso_id");
    const proyectoIdx = parseInt(url.searchParams.get("proyecto") || "0", 10);
    const path = url.searchParams.get("path") || "";
    const modo = url.searchParams.get("modo") === "download" ? "download" : "inline";
    if (!accesoId || !path) return jsonResponse({ error: "Faltan parámetros" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: acceso, error: accErr } = await admin
      .from("marketplace_accesos")
      .select("id, user_id, producto_id, tipo")
      .eq("id", accesoId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (accErr || !acceso) return jsonResponse({ error: "Acceso no encontrado o no autorizado" }, 403);

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select("tipo_paquete, proyecto_folder_drive_id")
      .eq("id", acceso.producto_id)
      .maybeSingle();
    if (prodErr || !producto || !producto.proyecto_folder_drive_id) {
      return jsonResponse({ error: "Paquete sin carpeta configurada" }, 404);
    }

    const tipoPaquete = (producto.tipo_paquete || "trimestre") as "trimestre" | "ciclo";
    const proyectos = await listProyectoFolders(producto.proyecto_folder_drive_id, tipoPaquete);
    if (proyectoIdx < 0 || proyectoIdx >= proyectos.length) {
      return jsonResponse({ error: "Índice de proyecto inválido" }, 400);
    }
    const proyectoFolder = proyectos[proyectoIdx];
    const esExamen = /examen/i.test(proyectoFolder.name);
    const esEditable = acceso.tipo === "editable";

    // Resolver el archivo por su ruta relativa (sin exponer Drive IDs).
    const walked = await walkDriveFolder(proyectoFolder.id);
    const archivo = walked.find((f) => f.path === path);
    if (!archivo) return jsonResponse({ error: "Archivo no encontrado" }, 404);

    const enRaiz = !archivo.path.includes("/");
    const e = ext(archivo.name);
    const esDocx = e === "docx";
    const esPdf = e === "pdf";
    const esAnexo = !esExamen && !enRaiz;

    // Tier: .docx de planeación/examen solo para editable.
    if (esDocx && !esAnexo && !esEditable) {
      return jsonResponse({ error: "Esta versión requiere la compra editable" }, 403);
    }

    let bytes = await downloadDriveFile(archivo.id);

    // Pie SOLO en la planeación (raíz, no examen, no anexo).
    const aplicaPie = !esExamen && enRaiz;
    if (aplicaPie) {
      const nombre =
        (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.nombre_docente)) ||
        user.email || "Comprador";
      const texto = textoPie(String(nombre), user.email || "");
      if (esPdf) { try { bytes = await aplicarPiePdf(bytes, texto); } catch (_) { /* original */ } }
      else if (esDocx) { try { bytes = await aplicarPieDocx(bytes, texto); } catch (_) { /* original */ } }
    }

    const contentType = MIME[e] || "application/octet-stream";
    const disp = modo === "download" ? "attachment" : "inline";

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": disp + '; filename="' + encodeURIComponent(archivo.name) + '"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("ver-archivo error:", err);
    return jsonResponse({ error: "Error interno: " + (err?.message || String(err)) }, 500);
  }
});
