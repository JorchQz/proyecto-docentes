// Clientes de Supabase para las Edge Functions.
//
// El proyecto no genera tipos de la base (no hay build step), así que sin un
// genérico explícito el checker de Deno resuelve cada tabla a `never` y falla
// todo insert/update. Fijamos un cliente laxo aquí, en un solo lugar, para no
// repetir el mismo escape de tipos en cada función.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
export type DB = any;
export type Cliente = SupabaseClient<DB>;

/** Cliente con service role: salta RLS. Nunca exponerlo al navegador. */
export function crearAdmin(url: string, serviceKey: string): Cliente {
  return createClient<DB>(url, serviceKey);
}

/** Cliente que actúa como el usuario del JWT recibido (respeta RLS). */
export function crearClienteUsuario(
  url: string,
  anonKey: string,
  authHeader: string,
): Cliente {
  return createClient<DB>(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

/** Extrae un mensaje legible de un `catch (err)` tipado como unknown. */
export function mensajeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
