import { sha, enc, type Json } from "../../../packages/contracts/core.ts";
export interface Runtime {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  rpc: (name: string, args: Json) => Promise<any>;
  put: (
    bucket: string,
    path: string,
    bytes: Uint8Array,
    type: string,
  ) => Promise<void>;
  get: (bucket: string, path: string) => Promise<Uint8Array>;
  head: (bucket: string, path: string) => Promise<number>;
  uploadToken: (bucket: string, path: string) => Promise<Json>;
  download: (bucket: string, path: string) => Promise<string>;
}
export function runtime(): Runtime {
  const env = (k: string) => Deno.env.get(k);
  const base = env("SUPABASE_URL")!;
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY")!;
  if (!base || !key) throw Error("SERVER_CONFIG_MISSING");
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  const request = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(base + path, {
      ...init,
      headers: { ...headers, ...init.headers },
    });
    if (!r.ok) throw Error("INTERNAL_STORAGE_OR_DB_" + r.status);
    return r;
  };
  const object = (b: string, p: string) =>
    "/storage/v1/object/" +
    encodeURIComponent(b) +
    "/" +
    p.split("/").map(encodeURIComponent).join("/");
  return {
    env,
    fetch,
    rpc: async (n, args) => {
      if (!/^lab_[a-z_]+$/.test(n)) throw Error("RPC_NOT_ALLOWED");
      const r = await fetch(base + "/rest/v1/rpc/" + n, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw Error(
          /^[A-Z_ :0-9]+$/.test(e.message || "")
            ? e.message
            : "DATABASE_REQUEST_FAILED_" +
                n.toUpperCase() +
                "_" +
                String(e.code || "UNKNOWN").replace(/[^A-Z0-9]/g, ""),
        );
      }
      return r.json();
    },
    put: async (b, p, bytes, type) => {
      await request(object(b, p), {
        method: "POST",
        headers: { "Content-Type": type, "x-upsert": "false" },
        body: bytes as BodyInit,
      });
    },
    get: async (b, p) =>
      new Uint8Array(await (await request(object(b, p))).arrayBuffer()),
    head: async (b, p) =>
      Number(
        (await request(object(b, p), { method: "HEAD" })).headers.get(
          "Content-Length",
        ),
      ),
    uploadToken: async (b, p) =>
      (
        await request("/storage/v1/object/upload/sign/" + b + "/" + p, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).json(),
    download: async (b, p) => {
      const r = await (
        await request("/storage/v1/object/sign/" + b + "/" + p, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"expiresIn":60}',
        })
      ).json();
      return base + "/storage/v1" + r.signedURL;
    },
  };
}
export function b64(a: Uint8Array) {
  let s = "";
  for (const v of a) s += String.fromCharCode(v);
  return btoa(s);
}
export function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export async function crypt(
  rt: Runtime,
  w: string,
  provider: string,
  value: string | Json,
  decrypt = false,
) {
  const secret =
    rt.env("LAB_SECRETS_MASTER_KEY") ||
    (await rt.rpc("lab_runtime_secret", { secret_name: "api_master" }));
  if (!secret) throw Error("MASTER_KEY_NOT_CONFIGURED");
  const bytes = unb64(secret);
  if (bytes.length !== 32) throw Error("MASTER_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const aad = enc.encode(w + ":" + provider + ":v1");
  if (decrypt) {
    const data = value as Json;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(data.nonce), additionalData: aad },
      key,
      unb64(data.ciphertext),
    );
    return new TextDecoder().decode(plain);
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    enc.encode(value as string),
  );
  return {
    version: 1,
    nonce: b64(nonce),
    ciphertext: b64(new Uint8Array(ciphertext)),
  };
}
export async function rawStore(
  rt: Runtime,
  attempt: string,
  value: string,
  direction: string,
) {
  const bytes = enc.encode(value);
  if (bytes.length > 1048576) throw Error("RAW_TOO_LARGE");
  const hash = await sha(bytes);
  const a = await rt.rpc("lab_raw_reserve", {
    attempt,
    bytes_count: bytes.length,
    hash,
    direction,
  });
  await rt.put("raw", a.path, bytes, "application/json");
  const stored = await rt.get("raw", a.path);
  if ((await sha(stored)) !== hash) throw Error("RAW_STORAGE_HASH_MISMATCH");
  await rt.rpc("lab_raw_verified", { asset: a.id });
  return a;
}
export function safeError(error: unknown) {
  const msg = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return msg
    .replace(/(?:sk-|AIza|sb_secret_|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted]")
    .slice(0, 250);
}
