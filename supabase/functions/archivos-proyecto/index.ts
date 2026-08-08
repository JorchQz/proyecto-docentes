// Edge Function: archivos-proyecto
//
// Devuelve el árbol de archivos de UN proyecto (o examen) de un paquete comprado,
// para mostrarlo en la biblioteca en línea. Respeta el tier (pdf/editable) y nunca
// expone Drive IDs: cada archivo se identifica por su ruta relativa (path).
//
// GET /functions/v1/archivos-proyecto?acceso_id=<uuid>&proyecto=<n>
//   → { proyecto, codigo, trimestre, es_examen, tipo_acceso,
//       archivos: [{ path, nombre, grupo, ext, ver, descarga }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { mensajeError } from "../_shared/db.ts";
import { listProyectoFolders, puedeEntregarArchivo, walkDriveFolder } from "../_shared/google-drive.ts";

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
    if (!accesoId) return jsonResponse({ error: "Falta acceso_id" }, 400);

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
      .select("tipo_paquete, trimestre, proyecto_folder_drive_id")
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

    const walked = await walkDriveFolder(proyectoFolder.id);

    const archivos = [];
    for (const f of walked) {
      const enRaiz = !f.path.includes("/");
      const e = ext(f.name);
      const esPdf = e === "pdf";

      // Tier: el DOCX es un add-on de todo o nada (ver puedeEntregarArchivo).
      if (!puedeEntregarArchivo(f.name, esEditable)) continue;

      const grupo = enRaiz
        ? (esExamen ? "Examen" : "Planeación")
        : f.path.split("/")[0];

      archivos.push({
        path: f.path,
        nombre: f.name,
        grupo,
        ext: e,
        ver: esPdf,          // solo PDF se ve en línea
        descarga: true,
      });
    }

    // Nombre legible del proyecto (quita prefijo P0X / numeración). El código y
    // el trimestre viajan aparte para que la biblioteca pueda ordenar y agrupar.
    const trimestre = proyectoFolder.trimestre != null
      ? proyectoFolder.trimestre
      : (producto.trimestre != null ? Number(producto.trimestre) : null);
    const nombre = esExamen
      ? (trimestre != null
        ? "Examen del trimestre " + trimestre + " (maestro y alumno)"
        : "Examen del trimestre (maestro y alumno)")
      : (proyectoFolder.name.replace(/^\s*p?\s*0*\d+[\s._-]+/i, "").trim() || proyectoFolder.name);

    return jsonResponse({
      proyecto: nombre,
      codigo: proyectoFolder.codigo,
      trimestre: trimestre,
      es_examen: esExamen,
      tipo_acceso: acceso.tipo,
      archivos,
    });
  } catch (err) {
    console.error("archivos-proyecto error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
