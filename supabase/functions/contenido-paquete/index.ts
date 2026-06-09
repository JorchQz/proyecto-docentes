// Edge Function: contenido-paquete
//
// Devuelve la lista de proyectos de un paquete comprado, para que "Mis compras"
// muestre un botón de descarga por proyecto. Nunca expone Drive IDs.
//
// GET /functions/v1/contenido-paquete?acceso_id=<uuid>
//   → { proyectos: [{ index, nombre }] }
//
// Cabecera requerida: Authorization: Bearer <access_token del usuario>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { listProyectoFolders } from "../_shared/google-drive.ts";

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
    if (!accesoId) return jsonResponse({ error: "Falta acceso_id" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: acceso, error: accErr } = await admin
      .from("marketplace_accesos")
      .select("id, user_id, producto_id")
      .eq("id", accesoId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (accErr || !acceso) {
      return jsonResponse({ error: "Acceso no encontrado o no autorizado" }, 403);
    }

    const { data: producto, error: prodErr } = await admin
      .from("marketplace_productos")
      .select("tipo_paquete, proyecto_folder_drive_id")
      .eq("id", acceso.producto_id)
      .maybeSingle();
    if (prodErr || !producto || !producto.proyecto_folder_drive_id) {
      return jsonResponse({ error: "Paquete sin carpeta configurada" }, 404);
    }

    const tipoPaquete = (producto.tipo_paquete || "trimestre") as "trimestre" | "ciclo";
    const folders = await listProyectoFolders(producto.proyecto_folder_drive_id, tipoPaquete);

    const proyectos = folders.map((f, i) => {
      var raw = f.name || ("Proyecto " + (i + 1));
      var nombre = /examen/i.test(raw)
        ? "Examen del trimestre (maestro y alumno)"
        : (raw.replace(/^\s*p?\s*0*\d+[\s._-]+/i, "").trim() || raw);
      return { index: i, nombre: nombre };
    });

    return jsonResponse({ proyectos });
  } catch (err) {
    console.error("contenido-paquete error:", err);
    return jsonResponse({ error: "Error interno: " + (err?.message || String(err)) }, 500);
  }
});
