// Edge Function: admin-proyectos-drive (solo administración)
//
// Detecta los proyectos individuales que se pueden publicar a partir de un paquete
// TRIMESTRAL ya configurado: lista las carpetas P0N de su carpeta de Drive,
// las empareja con dosificacion_proyectos (misma aula, mismo trimestre, mismo
// número continuo) y dice qué contiene cada una (PDF, Word, anexos) y si ya
// existe un producto tipo 'proyecto' para ella. El admin revisa la tabla y
// crea los productos desde el navegador (insert directo con la política
// "admin gestiona productos"), sin pegar 48 IDs de carpeta a mano.
//
// POST /functions/v1/admin-proyectos-drive
//   body: { producto_id: uuid }   ← el paquete de trimestre
//   → { trimestre, organizacion, grado, grados_combo, modalidad, fase,
//       proyectos: [{ codigo, nombre_carpeta, folder_id, numero_proyecto,
//                     tiene_pdf, tiene_docx, num_anexos,
//                     dosificacion: { id, nombre_proyecto, num_sesiones_estimadas, metodologia } | null,
//                     producto: { id, activo, precio_pdf, precio_pdf_con_anexos } | null }] }
//
// Autorización: el JWT del usuario debe pasar la RPC es_admin() (misma fuente
// de verdad que las políticas). Devuelve los IDs de carpeta a propósito: solo
// los ve el admin, que ya los lee hoy vía admin_producto_drive.
//
// Cabecera requerida: Authorization: Bearer <access_token del admin>

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { crearAdmin, crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import {
  codigoDeProyecto,
  FOLDER_MIME,
  listDriveFolder,
  proyectosDeTrimestre,
} from "../_shared/google-drive.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));

    // Autorización: el JWT del admin (RPC es_admin) o, para la verificación
    // masiva de anexos, el secreto de mantenimiento (mismo que el cron).
    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = Deno.env.get("CRON_SECRET");
    const conSecreto = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!conSecreto) {
      if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "No autenticado" }, 401);
      const userClient = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
      const { data: esAdmin, error: adminErr } = await userClient.rpc("es_admin");
      if (adminErr || esAdmin !== true) return jsonResponse({ error: "No autorizado" }, 403);
    }

    const admin = crearAdmin(supabaseUrl, serviceKey);

    // ── Verificación masiva: ¿qué proyectos individuales tienen anexos? ────
    // Recorre los productos tipo 'proyecto' (los que aún no se han verificado,
    // o todos con `todos: true`), mira si su carpeta tiene subcarpetas y guarda
    // tiene_anexos. La ficha solo ofrece "con anexos" cuando es true.
    if (body.verificar_anexos === true) {
      let q = admin
        .from("marketplace_productos")
        .select("id, titulo, proyecto_folder_drive_id, tiene_anexos")
        .eq("tipo_paquete", "proyecto")
        .not("proyecto_folder_drive_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(Math.min(Number(body.limite) || 60, 120));
      if (body.todos !== true) q = q.is("tiene_anexos", null);
      const { data: lista } = await q;
      let con = 0, sin = 0, fallos = 0;
      for (const p of lista || []) {
        try {
          const hijos = await listDriveFolder(p.proyecto_folder_drive_id);
          const tiene = hijos.some((f) => f.mimeType === FOLDER_MIME);
          await admin.from("marketplace_productos").update({ tiene_anexos: tiene }).eq("id", p.id);
          if (tiene) con++; else sin++;
        } catch (err) {
          console.error("verificar anexos falló:", p.titulo, err);
          fallos++;
        }
      }
      const { count } = await admin
        .from("marketplace_productos")
        .select("id", { count: "exact", head: true })
        .eq("tipo_paquete", "proyecto")
        .is("tiene_anexos", null);
      return jsonResponse({ ok: true, revisados: (lista || []).length, con_anexos: con, sin_anexos: sin, fallos, pendientes: count || 0 });
    }

    const productoId = String(body.producto_id || "");
    if (!productoId) return jsonResponse({ error: "Falta producto_id" }, 400);
    const { data: paquete, error: prodErr } = await admin
      .from("marketplace_productos")
      .select("id, tipo_paquete, trimestre, grado, fase, organizacion, grados_combo, modalidad, proyecto_folder_drive_id")
      .eq("id", productoId)
      .maybeSingle();
    if (prodErr || !paquete) return jsonResponse({ error: "Paquete no encontrado" }, 404);
    if (paquete.tipo_paquete !== "trimestre" || !paquete.trimestre) {
      return jsonResponse({ error: "Elige un paquete de TRIMESTRE: es el que contiene las carpetas de proyecto" }, 400);
    }
    if (!paquete.proyecto_folder_drive_id) {
      return jsonResponse({ error: "El paquete no tiene carpeta de Drive configurada" }, 400);
    }

    const t = Number(paquete.trimestre);
    const esMulti = paquete.organizacion === "multigrado";
    // dosificacion_proyectos.grados es text[] ("1","2"); en completa un solo grado.
    const grados: string[] = esMulti
      ? String(paquete.grados_combo || "").split("-").filter(Boolean)
      : [String(paquete.grado)];

    // 1. Carpetas P0N del trimestre en Drive (en orden, sin el examen).
    const carpetas = await proyectosDeTrimestre(paquete.proyecto_folder_drive_id);

    // 2. Proyectos del bot para esa aula y trimestre. `contains` deja pasar
    //    combos más grandes (1-2-3 contiene 1-2): se exige longitud exacta.
    const { data: dosif } = await admin
      .from("dosificacion_proyectos")
      .select("id, numero_proyecto, nombre_proyecto, num_sesiones_estimadas, metodologia, grados, trimestre")
      .eq("trimestre", t)
      .contains("grados", grados)
      .order("numero_proyecto", { ascending: true });
    const dosifAula = (dosif || []).filter((d: any) =>
      Array.isArray(d.grados) && d.grados.length === grados.length
    );

    // 3. Productos sueltos que ya existen para esa aula.
    let q = admin
      .from("marketplace_productos")
      .select("id, numero_proyecto, activo, precio_pdf, precio_pdf_con_anexos, dosificacion_proyecto_id, tiene_anexos")
      .eq("tipo_paquete", "proyecto")
      .eq("organizacion", paquete.organizacion);
    q = esMulti ? q.eq("grados_combo", paquete.grados_combo) : q.eq("grado", paquete.grado);
    const { data: existentes } = await q;
    const porNumero = new Map<number, any>(
      (existentes || []).map((p: any) => [Number(p.numero_proyecto), p]),
    );

    // 4. Contenido de cada carpeta, en paralelo (son 4 listados).
    const contenidos = await Promise.all(carpetas.map((c) => listDriveFolder(c.id)));

    const proyectos = carpetas.map((carpeta, i) => {
      const numero = (t - 1) * 4 + i + 1;
      const hijos = contenidos[i];
      const archivos = hijos.filter((f) => f.mimeType !== FOLDER_MIME);
      const sub = hijos.filter((f) => f.mimeType === FOLDER_MIME);
      const dos = dosifAula.find((d: any) => Number(d.numero_proyecto) === numero) || null;
      const prod = porNumero.get(numero) || null;
      // Al detectar se aprovecha para dejar al día si el producto existente
      // tiene anexos (Jorge puede haber subido las subcarpetas después).
      if (prod && prod.tiene_anexos !== (sub.length > 0)) {
        admin.from("marketplace_productos").update({ tiene_anexos: sub.length > 0 }).eq("id", prod.id)
          .then(({ error }: any) => { if (error) console.error("tiene_anexos:", error); });
      }
      return {
        codigo: codigoDeProyecto(carpeta.name),
        nombre_carpeta: carpeta.name,
        folder_id: carpeta.id,
        numero_proyecto: numero,
        tiene_pdf: archivos.some((f) => /\.pdf$/i.test(f.name)),
        tiene_docx: archivos.some((f) => /\.docx$/i.test(f.name)),
        num_anexos: sub.length,
        dosificacion: dos
          ? {
            id: dos.id,
            nombre_proyecto: dos.nombre_proyecto,
            num_sesiones_estimadas: dos.num_sesiones_estimadas,
            metodologia: dos.metodologia,
          }
          : null,
        producto: prod
          ? {
            id: prod.id,
            activo: !!prod.activo,
            precio_pdf: prod.precio_pdf,
            precio_pdf_con_anexos: prod.precio_pdf_con_anexos,
          }
          : null,
      };
    });

    return jsonResponse({
      trimestre: t,
      organizacion: paquete.organizacion,
      grado: paquete.grado,
      fase: paquete.fase,
      grados_combo: paquete.grados_combo,
      modalidad: paquete.modalidad,
      proyectos,
    });
  } catch (err) {
    console.error("admin-proyectos-drive error:", err);
    return jsonResponse({ error: "Error interno: " + mensajeError(err) }, 500);
  }
});
