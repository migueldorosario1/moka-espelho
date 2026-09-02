/**
 * cloud-s3 — cliente S3 mínimo (SigV4 com Web Crypto) pra backup da
 * memória do Moka na nuvem DO USUÁRIO (Cloudflare R2 / Backblaze B2 /
 * qualquer S3). Roda 100% no navegador — BYO-bucket, igual ao BYOK das
 * chaves de IA: nada passa pela nossa infra.
 *
 * ⚠️ CORS: R2 e B2 exigem regra de CORS no bucket autorizando o domínio
 * do app (métodos GET/PUT/HEAD, header authorization/content-type). O
 * erro típico de CORS aparece aqui como TypeError de rede.
 */

import { endpointOf, regionOf, type CloudConfig } from "./cloud";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

/** Assina e executa UMA requisição S3 (path-style). */
async function s3Fetch(
  c: CloudConfig,
  method: "GET" | "PUT" | "HEAD",
  path: string,
  opts: { body?: string | Uint8Array; query?: string } = {},
): Promise<Response> {
  const endpoint = endpointOf(c).replace(/\/+$/, "");
  const host = endpoint.replace("https://", "");
  const canonicalUri = `/${c.bucket}${path}`.replace(/\/{2,}/g, "/");
  const canonicalQuery = opts.query ?? "";
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, "")}`; // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(opts.body ?? "");

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${regionOf(c)}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${c.secretAccessKey}`).slice().buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmac(kDate, regionOf(c));
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`${endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
    method,
    headers: {
      authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(opts.body !== undefined
        ? { "content-type": typeof opts.body === "string" ? "text/markdown; charset=utf-8" : "application/octet-stream" }
        : {}),
    },
    body: opts.body as BodyInit | undefined,
  });
}

export type CloudTestResult =
  | { ok: true; objects: number }
  | { ok: false; kind: "credencial" | "bucket" | "rede"; detail: string };

/** Testa a configuração listando 1 objeto do bucket. */
export async function testCloud(c: CloudConfig): Promise<CloudTestResult> {
  try {
    const res = await s3Fetch(c, "GET", "", { query: "list-type=2&max-keys=1" });
    if (res.ok) {
      const xml = await res.text();
      const m = xml.match(/<KeyCount>(\d+)<\/KeyCount>/);
      return { ok: true, objects: m ? Number(m[1]) : 0 };
    }
    if (res.status === 403 || res.status === 401) {
      return { ok: false, kind: "credencial", detail: String(res.status) };
    }
    if (res.status === 404 || res.status === 400) {
      return { ok: false, kind: "bucket", detail: String(res.status) };
    }
    return { ok: false, kind: "rede", detail: String(res.status) };
  } catch (err) {
    // fetch bloqueado = quase sempre CORS do bucket (ou endpoint errado)
    return { ok: false, kind: "rede", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Envia um objeto (o backup da memória). */
export async function cloudPut(c: CloudConfig, key: string, content: string): Promise<boolean> {
  try {
    const res = await s3Fetch(c, "PUT", `/${key}`, { body: content });
    return res.ok;
  } catch {
    return false;
  }
}

/** Baixa um objeto (null se não existir / falhar). */
export async function cloudGet(c: CloudConfig, key: string): Promise<string | null> {
  try {
    const res = await s3Fetch(c, "GET", `/${key}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Envia BYTES crus (o arquivo original do livro — sem base64, sem gordura). */
export async function cloudPutBytes(
  c: CloudConfig,
  key: string,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const res = await s3Fetch(c, "PUT", `/${key}`, { body: bytes });
    return res.ok;
  } catch {
    return false;
  }
}

/** Baixa BYTES crus (null se não existir / falhar). */
export async function cloudGetBytes(
  c: CloudConfig,
  key: string,
): Promise<Uint8Array | null> {
  try {
    const res = await s3Fetch(c, "GET", `/${key}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export interface CloudObject {
  key: string;
  size: number;
}

/** Lista objetos do bucket por prefixo (pra achar os backups da estante). */
export async function cloudList(c: CloudConfig, prefix: string): Promise<CloudObject[] | null> {
  try {
    const res = await s3Fetch(c, "GET", "", {
      query: `list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`,
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const objs: CloudObject[] = [];
    const re = /<Contents>([\s\S]*?)<\/Contents>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const size = block.match(/<Size>(\d+)<\/Size>/)?.[1];
      if (key) objs.push({ key, size: size ? Number(size) : 0 });
    }
    return objs;
  } catch {
    return null;
  }
}
