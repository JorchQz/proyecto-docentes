// Edge Function: descargar-archivo
//
// Entrega UN proyecto de un paquete comprado, como ZIP, con marca de agua.
// El acceso es por paquete (marketplace_accesos), pero la descarga es por
// proyecto para mantener cada ZIP pequeño (evita timeouts del Edge runtime).
//
// GET /functions/v1/descargar-archivo?acceso_id=<uuid>&proyecto=<n>
//   - acceso_id: fila de marketplace_accesos (define producto/paquete + tipo)
//   - proyecto:  índice (0-based) del proyecto dentro del paquete
//
// Reglas por extensión dentro del proyecto:
//   - .pdf  → marca de agua en la planeacion, incluido siempre
//   - .docx → SOLO si el acceso es 'editable' (add-on de todo o nada)
//   - otros → tal cual, incluidos siempre
//
// Cabecera requerida: Authorization: Bearer <access_token del usuario>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// zipSync y no zip: la variante asincrona arranca un Web Worker y el runtime
// de las Edge Functions no los admite ("Classic workers are not supported").
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { mensajeError } from "../_shared/db.ts";
import { downloadDriveFile, listProyectoFolders, puedeEntregarArchivo, walkDriveFolder } from "../_shared/google-drive.ts";
import { aplicarPieDocx, aplicarPiePdf, textoPie } from "../_shared/watermark.ts";

function esDocx(name: string): boolean {
  return name.toLowerCase().endsWith(".docx");
}
function esPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "No autenticado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Sesión inválida" }, 401);
    }
    const user = userData.user;

    const url = new URL(req.url);
    const accesoId = url.searchParams.get("acceso_id");
    const proyectoIdx = parseInt(url.searchParams.get("proyecto") || "0", 10);
    if (!accesoId) return jsonResponse({ error: "Falta acceso_id" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Validar acceso del usuario.
    const { data: acceso, error: accErr } = await admin
      .from("marketplace_accesos")
      .select("id, user_id, producto_id, tipo")
      .eq("id", accesoId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (accErr || !acceso) {
      return jsonResponse({ error: "Acceso no encontrado o no autorizado" }, 403);
    }

    // 2. Producto/paquete + carpeta de Drive.
    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select("titulo, tipo_paquete, proyecto_folder_drive_id")
      .eq("id", acceso.producto_id)
      .maybeSingle();
    if (prodErr || !producto) return jsonResponse({ error: "Producto no encontrado" }, 404);
    if (!producto.proyecto_folder_drive_id) {
      return jsonResponse({ error: "Este paquete no tiene carpeta de Drive configurada" }, 404);
    }

    const tipoPaquete = (producto.tipo_paquete || "trimestre") as "trimestre" | "ciclo";

    // 3. Resolver la carpeta del proyecto N dentro del paquete.
    const proyectos = await listProyectoFolders(producto.proyecto_folder_drive_id, tipoPaquete);
    if (!proyectos.length) {
      return jsonResponse({ error: "No se encontraron proyectos en la carpeta del paquete" }, 404);
    }
    if (proyectoIdx < 0 || proyectoIdx >= proyectos.length) {
      return jsonResponse({ error: "Índice de proyecto inválido" }, 400);
    }
    const proyectoFolder = proyectos[proyectoIdx];

    // 4. Recorrer recursivamente la carpeta del proyecto.
    const archivos = await walkDriveFolder(proyectoFolder.id);
    if (!archivos.length) {
      return jsonResponse({ error: "El proyecto no tiene archivos" }, 404);
    }

    const incluirDocx = acceso.tipo === "editable";
    const esItemExamen = /examen/i.test(proyectoFolder.name);
    const nombre =
      (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.nombre_docente)) ||
      user.email || "Comprador";
    const { data: perfil } = await admin
      .from("perfiles")
      .select("cct")
      .eq("id", user.id)
      .maybeSingle();
    const texto = textoPie(String(nombre), perfil?.cct || null);

    // 5. Construir el ZIP.
    //  - Planeación (archivos en la raíz del proyecto): lleva pie de página.
    //  - Anexos (subcarpetas), examen y cuadernillos: SIN pie, los ven los alumnos.
    //  - Excepción: la clave del maestro (nombre con "clave") SÍ lleva pie,
    //    es material exclusivo del docente y el alumno nunca la ve.
    //  - El .docx de cualquiera de ellos, solo con el add-on de Word.
    const entries: Record<string, Uint8Array> = {};
    for (const f of archivos) {
      const enRaiz = !f.path.includes("/");
      const docx = esDocx(f.name);
      const pdf = esPdf(f.name);
      // Tier: el DOCX es un add-on de todo o nada (ver puedeEntregarArchivo).
      if (!puedeEntregarArchivo(f.name, incluirDocx)) continue;

      let bytes = await downloadDriveFile(f.id);

      // Pie SOLO en la planeación (raíz de un proyecto, nunca examen ni anexos),
      // y en la clave del maestro aunque viva en la carpeta del examen.
      const esClave = /clave/i.test(f.name);
      const aplicaPie = esClave || (!esItemExamen && enRaiz);
      if (aplicaPie && pdf) {
        try { bytes = await aplicarPiePdf(bytes, texto); } catch (_) { /* original si falla */ }
      } else if (aplicaPie && docx) {
        try { bytes = await aplicarPieDocx(bytes, texto); } catch (_) { /* original si falla */ }
      }

      entries[f.path] = bytes;
    }

    if (!Object.keys(entries).length) {
      return jsonResponse({ error: "No hay archivos para entregar en este tipo de acceso" }, 404);
    }

    const zipBytes = zipSync(entries, { level: 6 });
    const base = (producto.titulo || "paquete").replace(/[^\w\sáéíóúñ-]/gi, "");
    const carpeta = (proyectoFolder.name || ("proyecto-" + (proyectoIdx + 1))).replace(/[^\w\sáéíóúñ-]/gi, "");
    const nombreZip = base + " - " + carpeta + ".zip";

    return new Response(zipBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="' + encodeURIComponent(nombreZip) + '"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("descargar-archivo error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
