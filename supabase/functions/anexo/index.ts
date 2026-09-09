// Edge Function: anexo
//
// Resuelve un anexo por COORDENADAS (grado, trimestre, proyecto, código) — un link
// genérico, igual para todos los compradores, que el bot incrusta en la planeación.
// Valida que el usuario en sesión tenga acceso a un producto que cubra ese
// grado/proyecto — paquete trimestral, ciclo, o el proyecto individual comprado
// CON anexos — y sirve el archivo (PDF o imagen) inline o descarga.
//
// GET /functions/v1/anexo?aula=<grado|combo>&pr=<proyecto 1-12>&a=<código>&modo=inline|download
//   pr = número de proyecto CONTINUO del grado (1-12). El trimestre y la posición
//   dentro del trimestre se derivan: t = ceil(pr/4), pos = pr - (t-1)*4.
//   En un proyecto individual, pr coincide con marketplace_productos.numero_proyecto
//   y la carpeta del producto ya es la del proyecto: no hay nada que derivar.
//
// Respuestas 403: { sin_acceso: true } sin ningún producto que cubra el anexo;
// { sin_anexos: true, producto_id } cuando tiene el proyecto individual pero lo
// compró en la versión sin anexos.
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
    // Proyecto personalizado: no tiene coordenadas de grado/trimestre. El bot
    // imprime el número de pedido (anexo.html?pedido=PZ-0001&a=...), que aquí
    // se resuelve al producto que se creó al entregarlo.
    const numeroPedido = (url.searchParams.get("pedido") || "").trim().toUpperCase();

    if (!codigo || (!numeroPedido && (!aula || !(pr >= 1 && pr <= 12)))) {
      return jsonResponse({ error: "Parámetros inválidos" }, 400);
    }
    const esMulti = aula.indexOf("-") !== -1;
    const grado = esMulti ? null : parseInt(aula, 10);
    if (!numeroPedido && !esMulti && !(grado! >= 1 && grado! <= 6)) {
      return jsonResponse({ error: "Aula inválida" }, 400);
    }
    // Derivar trimestre (1-3) y posición del proyecto dentro del trimestre (1-4).
    const t = Math.ceil(pr / 4);
    const p = pr - (t - 1) * 4;

    const admin = createClient(supabaseUrl, serviceKey);

    // El pedido resuelve a su producto; si aún no se entregó, no hay producto.
    let productoDePedido: string | null = null;
    if (numeroPedido) {
      const { data: ped } = await admin
        .from("marketplace_pedidos")
        .select("producto_id")
        .eq("numero_pedido", numeroPedido)
        .maybeSingle();
      productoDePedido = ped?.producto_id || null;
      if (!productoDePedido) {
        return jsonResponse({ error: "Este proyecto todavía no se ha entregado", sin_acceso: true }, 403);
      }
    }

    // ¿El usuario posee un producto que cubra esta aula+proyecto? Un paquete
    // (trimestre exacto, o el ciclo) o el proyecto individual con ese número.
    // Tomamos cualquiera que tenga; los paquetes van primero porque siempre
    // incluyen los anexos.
    const { data: accesos } = await admin
      .from("marketplace_accesos")
      .select("producto_id, tipo, marketplace_productos(grado, trimestre, tipo_paquete, numero_proyecto, proyecto_folder_drive_id, organizacion, grados_combo)")
      .eq("user_id", user.id);

    const tieneFila = (productoId: string, tipo: string) =>
      (accesos || []).some((a: any) => a.producto_id === productoId && a.tipo === tipo);

    let folderTrimestre: string | null = null;
    // Proyecto individual: la carpeta del producto YA es la del proyecto.
    let folderProyectoDirecto: string | null = null;
    let productoMatch: string | null = null;
    // Tiene el proyecto individual pero en la versión sin anexos: se recuerda para
    // responder algo mejor que "no tienes acceso".
    let sueltoSinAnexos: string | null = null;

    for (const ac of accesos || []) {
      const prod: any = ac.marketplace_productos;
      if (!prod || !prod.proyecto_folder_drive_id) continue;
      // Pedido personalizado: solo cuenta el producto de ESE pedido.
      if (productoDePedido) {
        if (ac.producto_id !== productoDePedido) continue;
        if (!tieneFila(ac.producto_id, "anexos")) { sueltoSinAnexos = ac.producto_id; continue; }
        folderProyectoDirecto = prod.proyecto_folder_drive_id;
        productoMatch = ac.producto_id;
        break;
      }
      // Coincidencia de aula según organización.
      if (esMulti) {
        if (prod.organizacion !== "multigrado" || prod.grados_combo !== aula) continue;
      } else {
        if (prod.organizacion === "multigrado" || prod.grado !== grado) continue;
      }
      if (prod.tipo_paquete === "proyecto") {
        if (Number(prod.numero_proyecto) !== pr) continue;
        // La fila 'anexos' es el interruptor de la versión con anexos.
        if (!tieneFila(ac.producto_id, "anexos")) { sueltoSinAnexos = ac.producto_id; continue; }
        folderProyectoDirecto = prod.proyecto_folder_drive_id;
        productoMatch = ac.producto_id;
        break;
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

    if (!folderTrimestre && !folderProyectoDirecto) {
      if (sueltoSinAnexos) {
        return jsonResponse(
          {
            error: "Este proyecto se compró sin anexos",
            sin_anexos: true,
            producto_id: sueltoSinAnexos,
          },
          403,
        );
      }
      return jsonResponse({ error: "No tienes acceso a este material", sin_acceso: true }, 403);
    }

    // El DOCX es un add-on de todo o nada: solo si el usuario posee el tier
    // 'editable' del mismo producto que cubre este anexo. (En el proyecto
    // suelto la fila 'editable' se otorga siempre: el Word va incluido.)
    const esEditable = tieneFila(productoMatch!, "editable");

    // Carpeta del proyecto: directa en el suelto; p (1-4) dentro del trimestre
    // en los paquetes.
    let proyectoFolderId: string;
    if (folderProyectoDirecto) {
      proyectoFolderId = folderProyectoDirecto;
    } else {
      const proyectos = await proyectosDeTrimestre(folderTrimestre!);
      const proyectoFolder = proyectos[p - 1];
      if (!proyectoFolder) return jsonResponse({ error: "Proyecto no encontrado" }, 404);
      proyectoFolderId = proyectoFolder.id;
    }

    // Buscar el archivo cuyo nombre corresponde EXACTAMENTE al código. Se eliminó
    // el fallback por substring: permitía que ?a=Planeacion/Examen resolviera la
    // planeación o el examen completos (fuga de material y del add-on de Word).
    const walked = await walkDriveFolder(proyectoFolderId);
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
