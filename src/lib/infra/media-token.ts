/** Deployed private media Worker. Not an R2 public host. Activation stays a separate switch. */
export const DEPLOYED_MEDIA_GATEWAY_ORIGIN = "https://wedding-circle-media-gateway.labs-circle26.workers.dev";

const TEXT = new TextEncoder();
const KEY_RE = /^weddings\/[a-z0-9-]{3,80}\/(album|chat|profile|cover)\/[a-z0-9][a-z0-9.-]{0,140}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Long enough for a photo grid and for video seeking. A removed guest cannot mint a new one. */
export const MEDIA_TOKEN_TTL_SECONDS = 15 * 60;

/** Sentinel used only by the connection test. It must not be a real wedding object. */
export const GATEWAY_PROBE_KEY = "weddings/gateway-probe/album/probe01-missing.jpg";

export type MediaDisposition = "inline" | "attachment";
export type MediaMethod = "GET" | "HEAD";

export type MediaTokenClaims = {
  slug: string;
  key: string;
  methods: MediaMethod[];
  exp: number;
  disp: MediaDisposition;
  name: string;
};

/** One wedding object key. Encoded dots, slashes, and nulls are refused. */
export function canonicalObjectKey(input: string) {
  const raw = input.trim();
  if (!raw || raw.length > 220) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("%2e") || lower.includes("%5c") || lower.includes("%00") || lower.includes("%2f")) return "";
  if (raw.includes("..") || raw.includes("\\") || raw.includes("//") || raw.includes("\0") || raw.startsWith("/")) return "";
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return "";
  }
  if (value !== raw) return "";
  if (value.includes("..") || value.includes("\\") || value.includes("//") || value.includes("\0") || value.startsWith("/")) return "";
  if (!KEY_RE.test(value)) return "";
  return value;
}

/** https origin only. Public R2 host names are refused. */
export function normalizeGatewayOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return "";
  const host = url.hostname.toLowerCase();
  if (!HOST.test(host)) return "";
  if (host === "r2.dev" || host.endsWith(".r2.dev") || host.endsWith(".r2.cloudflarestorage.com") || host.includes("cloudflarestorage.com")) return "";
  return `https://${host}`;
}

export function cleanGatewayInput(input: { enabled: boolean; origin: string }) {
  const origin = normalizeGatewayOrigin(input.origin);
  if (!input.enabled) return { ok: true as const, enabled: false, origin };
  if (!origin) {
    return {
      ok: false as const,
      error: "The media gateway must be https:// and your own host name. An R2 public domain was not saved, and the bucket was not made public.",
    };
  }
  return { ok: true as const, enabled: true, origin };
}

export function gatewaySecretOk(secret: string) {
  return secret.length >= 32 && secret.length <= 200 && !/\s/.test(secret) && !secret.includes("BEGIN ") && !secret.toLowerCase().includes("r2.dev");
}

/** Membership, wedding key, and a stored object are all required. The browser does not get to assert any of these. */
export function mayIssueViewToken(input: { member: boolean; keyOk: boolean; recorded: boolean }) {
  return input.member && input.keyOk && input.recorded;
}

/** Prefer the Worker. Otherwise keep the existing private path. */
export function chooseMediaUrl(input: { gatewayUrl: string; fallbackUrl: string }) {
  if (input.gatewayUrl.startsWith("https://") && !input.gatewayUrl.includes(".r2.dev") && !input.gatewayUrl.includes("cloudflarestorage.com")) {
    return input.gatewayUrl;
  }
  return input.fallbackUrl;
}

export function mediaGatewayUrl(origin: string, key: string, token: string) {
  const base = normalizeGatewayOrigin(origin);
  const objectKey = canonicalObjectKey(key);
  if (!base || !objectKey || !token || token.includes("\n") || token.includes(" ")) return "";
  const path = objectKey.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${base}/v1/${path}?t=${encodeURIComponent(token)}`;
}

function bytesToB64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("bad");
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function tokenMessage(claims: MediaTokenClaims) {
  const methods = [...new Set(claims.methods)].sort().join(",");
  return ["WC-MEDIA-V1", claims.slug, claims.key, methods, String(claims.exp), claims.disp, claims.name].join("\n");
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", TEXT.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, TEXT.encode(data)));
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function signMediaToken(claims: MediaTokenClaims, secret: string) {
  const key = canonicalObjectKey(claims.key);
  const slug = claims.slug.trim().toLowerCase();
  if (!gatewaySecretOk(secret) || !key || !key.startsWith(`weddings/${slug}/`)) return "";
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return "";
  if (claims.disp !== "inline" && claims.disp !== "attachment") return "";
  if (!claims.methods.length || claims.methods.some((method) => method !== "GET" && method !== "HEAD")) return "";
  if (!Number.isFinite(claims.exp) || claims.exp <= 0) return "";
  if (claims.name.length > 180 || /[\r\n"\\]/.test(claims.name)) return "";
  const body = tokenMessage({ ...claims, slug, key });
  const signature = await hmac(secret, body);
  return `v1.${bytesToB64url(TEXT.encode(body))}.${bytesToB64url(signature)}`;
}

export type MediaTokenProblem = "signature" | "expired" | "malformed";

/** Saved-state label for one gateway field. A placeholder is not saved, and a typed replacement is not saved until the server confirms it. */
export function gatewaySavedStatus(input: { checking: boolean; saved: boolean; dirty: boolean }) {
  if (input.checking) return "Checking" as const;
  if (input.dirty) return "Unsaved changes" as const;
  return input.saved ? "Saved on server" as const : "Missing" as const;
}

/** Verifies a token and names the failure. The secret and the signature are not returned. */
export async function openMediaToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<{ ok: true; claims: MediaTokenClaims } | { ok: false; problem: MediaTokenProblem }> {
  if (!gatewaySecretOk(secret) || !token || token.length > 1800) return { ok: false, problem: "signature" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, problem: "malformed" };
  let body = "";
  let given = new Uint8Array();
  try {
    body = new TextDecoder().decode(b64urlToBytes(parts[1]));
    given = b64urlToBytes(parts[2]);
  } catch {
    return { ok: false, problem: "malformed" };
  }
  const expected = await hmac(secret, body);
  if (!sameBytes(expected, given)) return { ok: false, problem: "signature" };
  const lines = body.split("\n");
  if (lines.length !== 7 || lines[0] !== "WC-MEDIA-V1") return { ok: false, problem: "malformed" };
  const slug = lines[1] || "";
  const key = lines[2] || "";
  const methodsRaw = lines[3] || "";
  const exp = Number(lines[4]);
  const disp = lines[5];
  const name = lines[6] || "";
  if (!Number.isFinite(exp)) return { ok: false, problem: "malformed" };
  if (exp < nowSec) return { ok: false, problem: "expired" };
  if (disp !== "inline" && disp !== "attachment") return { ok: false, problem: "malformed" };
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return { ok: false, problem: "malformed" };
  const canonical = canonicalObjectKey(key);
  if (!canonical || canonical !== key || !key.startsWith(`weddings/${slug}/`)) return { ok: false, problem: "malformed" };
  const methods = methodsRaw.split(",");
  if (!methods.length || methods.some((method) => method !== "GET" && method !== "HEAD") || [...new Set(methods)].sort().join(",") !== methodsRaw) return { ok: false, problem: "malformed" };
  if (name.length > 180 || /[\r\n"\\]/.test(name)) return { ok: false, problem: "malformed" };
  return { ok: true, claims: { slug, key, methods: methods as MediaMethod[], exp, disp: disp as MediaDisposition, name } };
}

export async function verifyMediaToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  const opened = await openMediaToken(token, secret, nowSec);
  return opened.ok ? opened.claims : null;
}

/** Fingerprint stored after a passing test. Not the secret. A new secret no longer matches. */
export async function gatewayMark(origin: string, secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", TEXT.encode(`wc-media-gateway:${origin}:${secret}`));
  return `yes|${origin}|${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20)}`;
}
