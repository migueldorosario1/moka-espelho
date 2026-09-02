/**
 * cloud — cofre da configuração de nuvem do usuário (obra MOKA, ordem do
 * Miguel, 31/08: "um espaçozinho pra colocar o token do Cloudflare ou o
 * token do Backblaze" e a memória poder ser usada mais tarde).
 *
 * Suporta os dois provedores S3-compatíveis da casa (Cloudflare R2 e
 * Backblaze B2) e qualquer S3 genérico. As chaves ficam SÓ no aparelho,
 * criptografadas com o mesmo cofre das chaves de IA (AES-GCM).
 */

import { encrypt, decrypt } from "./crypto";

export type CloudProvider = "r2" | "b2" | "s3";

export interface CloudConfig {
  provider: CloudProvider;
  /**
   * O "endereço" do provedor:
   *   r2 → Account ID da Cloudflare (32 hex; endpoint é montado)
   *   b2 → região do bucket (ex.: us-west-004)
   *   s3 → endpoint completo (ex.: s3.us-east-004.amazonaws.com)
   */
  host: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const KEY = "moka.cloud.v1";

export async function saveCloudConfig(c: CloudConfig): Promise<void> {
  try {
    window.localStorage.setItem(KEY, await encrypt(JSON.stringify(c)));
  } catch {
    /* sem storage — config só vive na sessão */
  }
}

export async function loadCloudConfig(): Promise<CloudConfig | null> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(await decrypt(raw)) as CloudConfig;
    if (!parsed?.accessKeyId || !parsed?.secretAccessKey || !parsed?.bucket) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearCloudConfig(): Promise<void> {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* best-effort */ }
}

/**
 * Normaliza o campo "host": aceita TANTO o identificador (Account ID do
 * R2, região do B2) QUANTO o endereço completo copiado do painel — a
 * pessoa cola o "Default" do token e o Moka acha o número sozinho
 * (ordem do Miguel, 31/08: "onde acho o ID? tá complicando").
 */
export function normalizeHost(provider: CloudProvider, raw: string): string {
  let h = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (provider === "r2") {
    const m = h.match(/^([0-9a-f]{32})\.r2\.cloudflarestorage\.com$/i);
    if (m) return m[1].toLowerCase();
  }
  if (provider === "b2") {
    const m = h.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
    if (m) return m[1];
  }
  return h;
}

/** Endpoint HTTPS do provedor (path-style: https://endpoint/bucket/chave). */
export function endpointOf(c: CloudConfig): string {
  const host = normalizeHost(c.provider, c.host);
  if (c.provider === "r2") return `https://${host}.r2.cloudflarestorage.com`;
  if (c.provider === "b2") return `https://s3.${host}.backblazeb2.com`;
  return `https://${host}`;
}

/** Região usada na assinatura SigV4. */
export function regionOf(c: CloudConfig): string {
  if (c.provider === "r2") return "auto";
  if (c.provider === "b2") return normalizeHost("b2", c.host);
  return "us-east-1";
}
