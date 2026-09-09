// Qué partes de un producto le tocan a un comprador.
//
// Los accesos se guardan como filas separadas por `tipo` en marketplace_accesos
// (pdf / editable / anexos), así que "qué compró" es una pregunta a la base,
// no un campo del producto. Este archivo la responde en un solo sitio para que
// anexo, archivos-proyecto, ver-archivo y descargar-archivo no se
// desincronicen.
//
//   paquetes (trimestre / ciclo) → los anexos van siempre incluidos.
//   proyecto suelto              → solo si existe la fila tipo = 'anexos'
//                                  (la versión "con anexos" de la compra).

import type { Cliente } from "./db.ts";
import type { TipoPaquete } from "./google-drive.ts";

export function normalizarTipoPaquete(valor: unknown): TipoPaquete {
  return valor === "ciclo" || valor === "proyecto" ? valor : "trimestre";
}

/** ¿El comprador tiene derecho a las subcarpetas (anexos) de este producto? */
export async function compradorIncluyeAnexos(
  admin: Cliente,
  userId: string,
  productoId: string,
  tipoPaquete: TipoPaquete,
): Promise<boolean> {
  if (tipoPaquete !== "proyecto") return true;
  const { data } = await admin
    .from("marketplace_accesos")
    .select("id")
    .eq("user_id", userId)
    .eq("producto_id", productoId)
    .eq("tipo", "anexos")
    .limit(1);
  return !!(data && data.length);
}
