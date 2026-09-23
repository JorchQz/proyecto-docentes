// Edge Function: redactar-boleta  (Mi salón, B.7 Capa 2)
//
// Convierte las frases que propuso la Capa 1 (reglas, js/textos-boleta.js) en un
// párrafo por sección con redacción cuidada para las familias. La IA solo redacta:
// no decide fortalezas, áreas ni calificaciones; eso ya viene decidido.
//
// POST /functions/v1/redactar-boleta
//   header: Authorization: Bearer <access_token del maestro>
//   body: { accion: "estado" }
//         → { configurada: boolean }  (si existe el secreto ANTHROPIC_API_KEY)
//   body: { accion: "redactar", alumno_id, ciclo, trimestre }
//         → { secciones: [{ campo, copiados: [cuadros] }], modelo }
//
// Qué guarda (con la sesión del maestro, así que RLS aplica):
//   - Siempre: texto_autogenerado.ia = { fortalezas, areas_oportunidad, sugerencias,
//     generado_en, modelo } en cada fila del trimestre que no esté cerrada. Con la
//     boleta cerrada (los cuatro campos) no toca nada: responde 409.
//   - Copia esos textos solo a los cuadros que el maestro no escribió (por cuadro,
//     texto_autogenerado.editados) y marca visible = "ia". Lo del maestro nunca se pisa.
//
// La llave vive solo como secreto de la función (ANTHROPIC_API_KEY). Sin secreto,
// "estado" responde configurada=false y el botón no aparece en la boleta.
//
// Privacidad: a la API no se manda el nombre del alumno. El modelo escribe {nombre}
// y aquí se sustituye por el nombre de pila.

import Anthropic from "npm:@anthropic-ai/sdk";
import { crearClienteUsuario, mensajeError } from "../_shared/db.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MODELO = "claude-opus-5";
const CAMPOS = ["LEN", "SAB", "ETI", "DHL", "GEN"] as const;
const NOMBRE_CAMPO: Record<string, string> = {
  LEN: "Lenguajes",
  SAB: "Saberes y Pensamiento Científico",
  ETI: "Ética, Naturaleza y Sociedades",
  DHL: "De lo Humano y lo Comunitario",
  GEN: "Observaciones generales (asistencia, participación, conducta, lectura, cuaderno, matemáticas)",
};
const TIPOS = ["fortalezas", "areas_oportunidad", "sugerencias"] as const;
const MAX_CARACTERES = 1200;
// Un doble clic no debe pagar dos veces la misma redacción
const SEGUNDOS_ENTRE_REDACCIONES = 30;

const SISTEMA = `Redactas las observaciones de la boleta trimestral de una escuela primaria en México (Nueva Escuela Mexicana), dirigidas a las madres, padres o tutores.

Recibes, por campo formativo, frases que ya decidió un sistema de reglas a partir de lo que la maestra capturó: fortalezas, áreas de oportunidad y sugerencias. Tu trabajo es solo de redacción:
- Convierte cada lista en un párrafo breve (una a tres oraciones), claro, cálido y concreto, en español de México.
- No agregues hechos, calificaciones, porcentajes, diagnósticos ni datos que no estén en la entrada, y no dejes fuera ninguna idea de la entrada.
- Escribe en tercera persona y con respeto. Nada de etiquetas ni diagnósticos (por ejemplo "TDAH", "flojo", "lento") ni comparaciones con otros alumnos.
- Si necesitas nombrar al alumno, escribe exactamente {nombre}; no inventes nombres. Evita adjetivos con género referidos al alumno (prefiere "muestra interés" a "está interesado").
- Los aprendizajes citados entre « » puedes conservarlos o parafrasearlos con fidelidad.
- Si una sección llega vacía, devuélvela como cadena vacía.
- Sin emojis ni viñetas.`;

const ESQUEMA = {
  type: "object",
  properties: {
    secciones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", enum: [...CAMPOS] },
          fortalezas: { type: "string" },
          areas_oportunidad: { type: "string" },
          sugerencias: { type: "string" },
        },
        required: ["campo", "fortalezas", "areas_oportunidad", "sugerencias"],
        additionalProperties: false,
      },
    },
  },
  required: ["secciones"],
  additionalProperties: false,
};

// Defensa extra: la regla del producto es cero emojis en lo que ve la familia
const EMOJIS =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}]/gu;

function limpiar(texto: unknown, nombre: string): string {
  return String(texto ?? "")
    .replace(EMOJIS, "")
    .replaceAll("{nombre}", nombre)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CARACTERES);
}

// "QA JUAN MENA (en riesgo)" → "Juan"; "MARÍA JOSÉ LÓPEZ" → "María"
function nombreDePila(completo: string): string {
  const palabras = String(completo || "")
    .replace(/\(.*?\)/g, " ")
    .split(/\s+/)
    .filter((p) => p && p.toUpperCase() !== "QA");
  const primera = palabras[0] || "";
  if (!primera) return "el alumno";
  return primera.charAt(0).toLocaleUpperCase("es-MX") +
    primera.slice(1).toLocaleLowerCase("es-MX");
}

// Igual que TextosBoleta.esEditado: lo que el maestro escribió en ESE cuadro no se toca.
// Filas anteriores a la marca por cuadro: editado_manual cuenta para los tres.
function esEditado(fila: Record<string, unknown>, tipo: string): boolean {
  if (!fila.editado_manual) return false;
  const texto = (fila.texto_autogenerado || {}) as Record<string, unknown>;
  return Array.isArray(texto.editados) ? (texto.editados as string[]).includes(tipo) : true;
}

function fase(grado: number): string {
  if (grado <= 2) return "Fase 3";
  if (grado <= 4) return "Fase 4";
  return "Fase 5";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "No autenticado" }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const llave = Deno.env.get("ANTHROPIC_API_KEY") || "";

    const sb = crearClienteUsuario(supabaseUrl, anonKey, authHeader);
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Sesión inválida" }, 401);
    }
    const maestroId = userData.user.id;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch (_) {
      return jsonResponse({ error: "Cuerpo inválido" }, 400);
    }

    if (body.accion === "estado") {
      return jsonResponse({ configurada: llave.length > 0 });
    }
    if (body.accion !== "redactar") {
      return jsonResponse({ error: "Acción desconocida" }, 400);
    }
    if (!llave) {
      return jsonResponse({ error: "La redacción con IA no está configurada" }, 503);
    }

    // Mismo requisito que el resto del SaaS: perfil con acceso activo
    const { data: perfil } = await sb.from("perfiles").select("activo_saas")
      .eq("id", maestroId).maybeSingle();
    if (!perfil || !perfil.activo_saas) {
      return jsonResponse({ error: "Tu cuenta no tiene acceso a Mi salón" }, 403);
    }

    const alumnoId = String(body.alumno_id || "");
    const ciclo = String(body.ciclo || "");
    const trimestre = Number(body.trimestre);
    if (!alumnoId || !ciclo || ![1, 2, 3].includes(trimestre)) {
      return jsonResponse({ error: "Faltan alumno, ciclo o trimestre" }, 400);
    }

    // RLS: solo sus alumnos y sus filas de boleta
    const { data: alumno } = await sb.from("alumnos").select("id, nombre_completo, grado")
      .eq("id", alumnoId).eq("maestro_id", maestroId).maybeSingle();
    if (!alumno) return jsonResponse({ error: "Alumno no encontrado" }, 404);

    const { data: filas, error: filasErr } = await sb.from("boleta_trimestral")
      .select("id, campo, cerrada, editado_manual, texto_autogenerado")
      .eq("maestro_id", maestroId).eq("alumno_id", alumnoId)
      .eq("ciclo", ciclo).eq("trimestre", trimestre);
    if (filasErr) throw filasErr;

    // Boleta cerrada (los cuatro campos): lo entregado queda fijo, también la fila GEN,
    // que no lleva calificación y por eso no se marca cerrada
    const cerrada = ["LEN", "SAB", "ETI", "DHL"].every((c) =>
      (filas || []).some((f: Record<string, unknown>) => f.campo === c && f.cerrada)
    );
    if (cerrada) {
      return jsonResponse({ error: "La boleta está cerrada: sus textos ya no se cambian." }, 409);
    }

    const abiertas = (filas || []).filter((f: Record<string, unknown>) =>
      !f.cerrada && (CAMPOS as readonly string[]).includes(String(f.campo)) &&
      f.texto_autogenerado && typeof f.texto_autogenerado === "object"
    );
    if (!abiertas.length) {
      return jsonResponse({
        error: "No hay textos propuestos que redactar. Genera primero la boleta del trimestre.",
      }, 409);
    }

    const recientes = abiertas.some((f: Record<string, unknown>) => {
      const ia = (f.texto_autogenerado as Record<string, Record<string, string>>).ia;
      if (!ia || !ia.generado_en) return false;
      return Date.now() - new Date(ia.generado_en).getTime() < SEGUNDOS_ENTRE_REDACCIONES * 1000;
    });
    if (recientes) {
      return jsonResponse({ error: "Se acaba de redactar esta boleta; espera unos segundos." }, 429);
    }

    // Entrada: solo lo que decidió la Capa 1, sin nombre del alumno
    const entrada = {
      grado: alumno.grado,
      fase: fase(Number(alumno.grado)),
      secciones: abiertas.map((f: Record<string, unknown>) => {
        const t = f.texto_autogenerado as Record<string, string>;
        return {
          campo: f.campo,
          nombre_campo: NOMBRE_CAMPO[String(f.campo)],
          fortalezas: t.fortalezas || "",
          areas_oportunidad: t.areas_oportunidad || "",
          sugerencias: t.sugerencias || "",
        };
      }),
    };

    const cliente = new Anthropic({ apiKey: llave });
    const respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ESQUEMA },
      },
      system: SISTEMA,
      messages: [{
        role: "user",
        content: "Redacta estas secciones de la boleta:\n" + JSON.stringify(entrada),
      }],
    // deno-lint-ignore no-explicit-any
    } as any);

    if (respuesta.stop_reason === "refusal") {
      return jsonResponse({ error: "El servicio de redacción no pudo procesar esta boleta." }, 502);
    }
    if (respuesta.stop_reason === "max_tokens") {
      return jsonResponse({ error: "La redacción quedó incompleta; intenta de nuevo." }, 502);
    }
    // deno-lint-ignore no-explicit-any
    const bloque = (respuesta.content as any[]).find((b) => b.type === "text");
    let salida: { secciones?: Array<Record<string, string>> } = {};
    try {
      salida = JSON.parse(bloque ? bloque.text : "{}");
    } catch (_) {
      return jsonResponse({ error: "La redacción llegó en un formato inesperado." }, 502);
    }

    const nombre = nombreDePila(alumno.nombre_completo);
    const generadoEn = new Date().toISOString();
    const resultado: Array<{ campo: string; copiados: string[] }> = [];

    for (const fila of abiertas) {
      const redactada = (salida.secciones || []).find((s) => s.campo === fila.campo);
      if (!redactada) continue;
      const ia: Record<string, string> = { generado_en: generadoEn, modelo: String(respuesta.model || MODELO) };
      for (const tipo of TIPOS) ia[tipo] = limpiar(redactada[tipo], nombre);

      // Solo a los cuadros que el maestro no escribió
      const copiados = TIPOS.filter((tipo) => !esEditado(fila, tipo));
      const previo = fila.texto_autogenerado as Record<string, unknown>;
      const cambios: Record<string, unknown> = {
        texto_autogenerado: { ...previo, ia, visible: copiados.length ? "ia" : previo.visible || "reglas" },
      };
      for (const tipo of copiados) cambios[tipo] = ia[tipo] || null;
      const { error: updErr } = await sb.from("boleta_trimestral").update(cambios)
        .eq("id", fila.id).eq("maestro_id", maestroId);
      if (updErr) throw updErr;
      resultado.push({ campo: String(fila.campo), copiados });
    }

    return jsonResponse({ secciones: resultado, modelo: respuesta.model || MODELO });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return jsonResponse({ error: "El servicio de redacción está ocupado; intenta en un minuto." }, 429);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("redactar-boleta: la llave de la API no es válida");
      return jsonResponse({ error: "La redacción con IA no está bien configurada." }, 503);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("redactar-boleta: API", err.status, err.message);
      return jsonResponse({ error: "El servicio de redacción no respondió; intenta de nuevo." }, 502);
    }
    console.error("redactar-boleta:", mensajeError(err));
    return jsonResponse({ error: "Error inesperado al redactar" }, 500);
  }
});
