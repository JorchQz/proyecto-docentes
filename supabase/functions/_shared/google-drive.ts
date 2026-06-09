// Acceso a Google Drive mediante una Service Account (JWT OAuth2).
//
// Requiere la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON con el contenido
// completo del JSON de credenciales. La carpeta de Drive con las planeaciones
// debe estar COMPARTIDA con el `client_email` de esa cuenta (rol Lector).
//
// El frontend nunca ve un file ID ni una URL de Drive: todo pasa por aquí.

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// Archivo encontrado en un recorrido recursivo, con su ruta relativa.
export interface WalkedFile {
  path: string; // ruta relativa desde la carpeta raíz del recorrido
  id: string;
  name: string;
  mimeType: string;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

let cachedToken: { value: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("Falta la variable GOOGLE_SERVICE_ACCOUNT_JSON");
  return JSON.parse(raw) as ServiceAccount;
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function getDriveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const sa = getServiceAccount();
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claim));
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + "." + base64url(new Uint8Array(signature));

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) throw new Error("No se pudo obtener token de Drive: " + await resp.text());

  const data = await resp.json();
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return cachedToken.value;
}

export async function downloadDriveFile(fileId: string): Promise<Uint8Array> {
  const token = await getDriveAccessToken();
  const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!resp.ok) throw new Error("No se pudo descargar el archivo de Drive (" + resp.status + "): " + await resp.text());
  return new Uint8Array(await resp.arrayBuffer());
}

// Lista los hijos directos de una carpeta.
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const token = await getDriveAccessToken();
  const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
  const fields = encodeURIComponent("files(id,name,mimeType)");
  const url = "https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=" + fields +
    "&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=200&orderBy=name";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!resp.ok) throw new Error("No se pudo listar carpeta de Drive (" + resp.status + "): " + await resp.text());
  const data = await resp.json();
  const files = (data.files || []) as DriveFile[];
  // Orden alfabético estable por nombre (Drive orderBy=name no siempre es consistente con locales).
  files.sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
  return files;
}

function soloCarpetas(files: DriveFile[]): DriveFile[] {
  return files.filter((f) => f.mimeType === FOLDER_MIME);
}

// Heurísticas de nombre para distinguir carpetas dentro del paquete.
// Convención del autor: proyectos "P01 - ...", trimestres "T1"/"Trimestre 1".
function esCarpetaProyecto(name: string): boolean {
  return /^p\s*0*\d+/i.test(name);
}
function esCarpetaTrimestre(name: string): boolean {
  return /^t\s*0*\d+/i.test(name) || /trimestre/i.test(name);
}
function esExamen(name: string): boolean {
  return /examen/i.test(name);
}

// Carpeta de trimestre número `t` (1-3) dentro de la carpeta de un grado.
// Usado para resolver anexos del paquete CICLO por coordenadas.
export async function carpetaTrimestreDeGrado(
  gradoFolderId: string,
  t: number,
): Promise<DriveFile | null> {
  const nivel1 = soloCarpetas(await listDriveFolder(gradoFolderId));
  let tris = nivel1.filter((f) => esCarpetaTrimestre(f.name));
  if (!tris.length) tris = nivel1.filter((f) => !/multigrado/i.test(f.name));
  // tris ya viene ordenado alfanumérico (T1, T2, T3) por listDriveFolder.
  return tris[t - 1] || null;
}

// Solo carpetas de PROYECTO (P0X) dentro de un trimestre. Excluye exámenes.
// Exportada para resolución por coordenadas. Fallback: carpetas que no sean examen.
export async function proyectosDeTrimestre(trimestreFolderId: string): Promise<DriveFile[]> {
  const subs = soloCarpetas(await listDriveFolder(trimestreFolderId));
  const conPatron = subs.filter((f) => esCarpetaProyecto(f.name));
  if (conPatron.length) return conPatron;
  return subs.filter((f) => !esExamen(f.name));
}

// Ítems DESCARGABLES de un trimestre = proyectos (P0X) + examen, en ese orden.
// El examen es parte de la compra del paquete (las reglas por extensión deciden
// qué archivos entra en pdf vs editable).
async function itemsDeTrimestre(trimestreFolderId: string): Promise<DriveFile[]> {
  const subs = soloCarpetas(await listDriveFolder(trimestreFolderId));
  const proyectos = subs.filter((f) => esCarpetaProyecto(f.name));
  const examenes = subs.filter((f) => esExamen(f.name));
  if (proyectos.length) return [...proyectos, ...examenes];
  return subs; // sin convención: devolver todo
}

// Ítems descargables de un paquete, en orden (proyectos + examen por trimestre).
//  - trimestre: ítems dentro de la carpeta del trimestre.
//  - ciclo: por cada trimestre (ordenado) sus ítems, concatenados.
export async function listProyectoFolders(
  bundleFolderId: string,
  tipoPaquete: "trimestre" | "ciclo",
): Promise<DriveFile[]> {
  if (tipoPaquete === "trimestre") {
    return await itemsDeTrimestre(bundleFolderId);
  }

  const nivel1 = soloCarpetas(await listDriveFolder(bundleFolderId));
  let trimestres = nivel1.filter((f) => esCarpetaTrimestre(f.name));
  if (!trimestres.length) {
    trimestres = nivel1.filter((f) => !/multigrado/i.test(f.name));
  }

  const items: DriveFile[] = [];
  for (const tri of trimestres) {
    const its = await itemsDeTrimestre(tri.id);
    for (const it of its) items.push(it);
  }
  return items;
}

// Primera carpeta de PROYECTO del paquete (para la vista previa; nunca el examen).
export async function primerProyectoFolder(
  bundleFolderId: string,
  tipoPaquete: "trimestre" | "ciclo",
): Promise<DriveFile | null> {
  if (tipoPaquete === "trimestre") {
    const p = await proyectosDeTrimestre(bundleFolderId);
    return p.length ? p[0] : null;
  }
  const nivel1 = soloCarpetas(await listDriveFolder(bundleFolderId));
  let trimestres = nivel1.filter((f) => esCarpetaTrimestre(f.name));
  if (!trimestres.length) {
    trimestres = nivel1.filter((f) => !/multigrado/i.test(f.name));
  }
  for (const tri of trimestres) {
    const p = await proyectosDeTrimestre(tri.id);
    if (p.length) return p[0];
  }
  return null;
}

// Recorrido recursivo: devuelve TODOS los archivos (no carpetas) bajo folderId,
// con su ruta relativa preservada (para reconstruir el ZIP con estructura).
export async function walkDriveFolder(folderId: string, prefix = ""): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const hijos = await listDriveFolder(folderId);
  for (const child of hijos) {
    if (child.mimeType === FOLDER_MIME) {
      const sub = await walkDriveFolder(child.id, prefix + child.name + "/");
      for (const f of sub) out.push(f);
    } else {
      out.push({ path: prefix + child.name, id: child.id, name: child.name, mimeType: child.mimeType });
    }
  }
  return out;
}
