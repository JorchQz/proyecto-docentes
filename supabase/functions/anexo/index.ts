// Edge Function: anexo
//
// Resuelve un anexo por COORDENADAS (grado, trimestre, proyecto, código) — un link
// genérico, igual para todos los compradores, que el bot incrusta en la planeación.
// Valida que el usuario en sesión tenga acceso a un paquete que cubra ese grado/trimestre
// (paquete trimestral o ciclo) y sirve el archivo (PDF o imagen) inline o descarga.
//
// GET /functions/v1/anexo?g=<grado>&pr=<proyecto 1-12>&a=<código>&modo=inline|download
//   pr = número de proyecto CONTINUO del grado (1-12). El trimestre y la posición
//   dentro del trimestre se derivan: t = ceil(pr/4), pos = pr - (t-1)*4.
//
// Cabecera requerida: Authorization: Bearer <access_token del usuario>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { mensajeError } from "../_shared/db.ts";
import {
  carpetaTrimestreDeGrado,
  downloadDriveFile,
  proyectosDeTrimestre,
  puedeEntregarArchivo,
  walkDriveFolder,
} from "../_shared/google-drive.ts";
import { aplicarPieDocx, aplicarPiePdf, textoPie } from "../_shared/watermark.ts";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function ext(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
// Nombre base sin extensión, en minúsculas, para comparar con el código.
function base(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/, "");
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
    // "aula" = identificador del grupo: grado ("3") en organización completa,
    // o combinación ("1-2", "1-2-3") en multigrado. Se detecta por el guion.
    const aula = (url.searchParams.get("aula") || url.searchParams.get("g") || "").trim();
    const pr = parseInt(url.searchParams.get("pr") || "", 10);
    const codigo = (url.searchParams.get("a") || "").trim();
    const modo = url.searchParams.get("modo") === "download" ? "download" : "inline";

    if (!aula || !(pr >= 1 && pr <= 12) || !codigo) {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }
    const esMulti = aula.indexOf("-") !== -1;
    const grado = esMulti ? null : parseInt(aula, 10);
    if (!esMulti && !(grado! >= 1 && grado! <= 6)) {
      return jsonResponse({ error: "Aula inválida" }, 400);
    }
    // Derivar trimestre (1-3) y posición del proyecto dentro del trimestre (1-4).
    const t = Math.ceil(pr / 4);
    const p = pr - (t - 1) * 4;

    const admin = createClient(supabaseUrl, serviceKey);

    // ¿El usuario posee un paquete que cubra esta aula+trimestre?
    // (trimestre exacto, o el ciclo). Tomamos cualquiera que tenga.
    const { data: accesos } = await admin
      .from("marketplace_accesos")
      .select("producto_id, tipo, marketplace_productos(grado, trimestre, tipo_paquete, proyecto_folder_drive_id, organizacion, grados_combo)")
      .eq("user_id", user.id);

    let folderTrimestre: string | null = null;
    let productoMatch: string | null = null;
    for (const ac of accesos || []) {
      const prod: any = ac.marketplace_productos;
      if (!prod || !prod.proyecto_folder_drive_id) continue;
      // Coincidencia de aula según organización.
      if (esMulti) {
        if (prod.organizacion !== "multigrado" || prod.grados_combo !== aula) continue;
      } else {
        if (prod.organizacion === "multigrado" || prod.grado !== grado) continue;
      }
      if (prod.tipo_paquete === "trimestre" && prod.trimestre === t) {
        folderTrimestre = prod.proyecto_folder_drive_id;
        productoMatch = ac.producto_id;
        break;
      }
      if (prod.tipo_paquete === "ciclo") {
        const tri = await carpetaTrimestreDeGrado(prod.proyecto_folder_drive_id, t);
        if (tri) { folderTrimestre = tri.id; productoMatch = ac.producto_id; break; }
      }
    }

    if (!folderTrimestre) {
      return jsonResponse({ error: "No tienes acceso a este material", sin_acceso: true }, 403);
    }

    // El DOCX es un add-on de todo o nada: solo si el usuario posee el tier
    // 'editable' del mismo paquete que cubre este trimestre.
    const esEditable = (accesos || []).some(
      (a: any) => a.producto_id === productoMatch && a.tipo === "editable",
    );

    // Carpeta del proyecto p (1-4) dentro del trimestre.
    const proyectos = await proyectosDeTrimestre(folderTrimestre);
    const proyectoFolder = proyectos[p - 1];
    if (!proyectoFolder) return jsonResponse({ error: "Proyecto no encontrado" }, 404);

    // Buscar el archivo cuyo nombre corresponde EXACTAMENTE al código. Se eliminó
    // el fallback por substring: permitía que ?a=Planeacion/Examen resolviera la
    // planeación o el examen completos (fuga de material y del add-on de Word).
    const walked = await walkDriveFolder(proyectoFolder.id);
    const codLow = codigo.toLowerCase();
    const archivo = walked.find((f) => base(f.name) === codLow);
    if (!archivo) return jsonResponse({ error: "Anexo no encontrado" }, 404);

    // Tier: el DOCX requiere el add-on editable (misma regla que ver-archivo).
    if (!puedeEntregarArchivo(archivo.name, esEditable)) {
      return jsonResponse({ error: "Esta versión requiere la compra editable" }, 403);
    }

    const e = ext(archivo.name);
    let bytes = await downloadDriveFile(archivo.id);

    // Pie de trazabilidad SOLO en la planeación (archivo en la raíz del proyecto,
    // que no sea el examen); los anexos van limpios, como en ver-archivo.
    const enRaiz = !archivo.path.includes("/");
    const esExamenArchivo = /examen/i.test(archivo.name);
    if (enRaiz && !esExamenArchivo) {
      const nombre =
        (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.nombre_docente)) ||
        user.email || "Comprador";
      const { data: perfil } = await admin
        .from("perfiles")
        .select("cct")
        .eq("id", user.id)
        .maybeSingle();
      const texto = textoPie(String(nombre), perfil?.cct || null);
      if (e === "pdf") { try { bytes = await aplicarPiePdf(bytes, texto); } catch (_) { /* original */ } }
      else if (e === "docx") { try { bytes = await aplicarPieDocx(bytes, texto); } catch (_) { /* original */ } }
    }

    const contentType = MIME[e] || "application/octet-stream";
    const disp = modo === "download" ? "attachment" : "inline";

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": disp + '; filename="' + encodeURIComponent(archivo.name) + '"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("anexo error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
