import { canonicalObjectKey, openMediaToken, type MediaMethod, type MediaTokenClaims } from "./media-token.ts";

export type MediaHead = {
  size: number;
  etag: string;
  uploaded: Date;
  contentType: string;
  body?: Uint8Array | ReadableStream<Uint8Array> | null;
};

export type MediaEdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

export type MediaGatewayBinding = {
  secret: string;
  allowedOrigins: string;
  head(key: string): Promise<MediaHead | null>;
  get(key: string, range?: { offset: number; length: number }): Promise<MediaHead | null>;
  /** Set only when authorized edge caching is explicitly selected. Absent means no edge cache. */
  edgeCache?: MediaEdgeCache;
  cachePolicy?: "private" | "no-store" | "authorized";
};

export type GatewayVerdict = {
  usable: boolean;
  state: "disabled" | "incomplete" | "error" | "verified";
  detail: string;
  requirement: string;
};

const PRIVATE_CACHE = "private, no-store";
const BROWSER_CDN_CACHE = "no-store";

/** True only for the exact Worker value that turns on the Cache API. Quotes and case are ignored. */
export function readMediaEdgeCache(value: string | undefined) {
  const token = String(value ?? "").trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return token === "authorized";
}

function originAllowed(list: string, origin: string) {
  if (!origin.startsWith("https://") || origin.includes("*") || origin.includes("\n") || origin.includes("\r")) return false;
  return list.split(",").map((item) => item.trim()).filter(Boolean).includes(origin);
}

function applyCors(headers: Headers, origin: string) {
  if (!origin) return;
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "origin");
}

function baseHeaders(origin = "") {
  const headers = new Headers({
    "cache-control": PRIVATE_CACHE,
    "cdn-cache-control": BROWSER_CDN_CACHE,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-wc-cache": "BYPASS",
  });
  applyCors(headers, origin);
  return headers;
}

function safeType(value: string) {
  const type = value.trim().toLowerCase();
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) return type;
  return "application/octet-stream";
}

function objectHeaders(head: MediaHead, claims: MediaTokenClaims, origin: string) {
  const headers = baseHeaders(origin);
  headers.set("content-type", safeType(head.contentType));
  headers.set("accept-ranges", "bytes");
  headers.set("etag", `"${head.etag.replace(/"/g, "")}"`);
  const name = claims.name.replace(/[^\w.\-]+/g, "").slice(0, 80) || "file";
  headers.set("content-disposition", `${claims.disp === "attachment" ? "attachment" : "inline"}; filename="${name}"`);
  return headers;
}

function responseBody(body: NonNullable<MediaHead["body"]>): BodyInit {
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  return body;
}

function fileName(claims: MediaTokenClaims) {
  return claims.name.replace(/[^\w.\-]+/g, "").slice(0, 80) || "file";
}

function quotedEtag(etag: string) {
  const clean = etag.replace(/^W\//, "").replaceAll("\"", "");
  return clean ? `"${clean}"` : "";
}

/** Browser response. Never public. The zone CDN is told not to store it. */
function browserHeaders(origin: string, claims: MediaTokenClaims, meta: { type: string; size?: string; etag?: string }) {
  const headers = baseHeaders(origin);
  headers.set("content-type", safeType(meta.type));
  headers.set("accept-ranges", "bytes");
  if (meta.size) headers.set("content-length", meta.size);
  const etag = meta.etag ? quotedEtag(meta.etag) : "";
  if (etag) headers.set("etag", etag);
  headers.set("content-disposition", `${claims.disp === "attachment" ? "attachment" : "inline"}; filename="${fileName(claims)}"`);
  return headers;
}

/**
 * Response stored in the Worker Cache API only. It is not returned to the browser.
 * Cloudflare refuses cache.put when Cache-Control is private, no-store, or no-cache.
 */
function workerCacheResponse(file: MediaHead, body: Uint8Array, ttl: number) {
  const headers = new Headers();
  headers.set("content-type", safeType(file.contentType));
  headers.set("content-length", String(body.byteLength));
  const etag = quotedEtag(file.etag);
  if (etag) headers.set("etag", etag);
  headers.set("cache-control", `public, max-age=${ttl}`);
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return new Response(copy.buffer, { status: 200, headers });
}

function cacheTtl(exp: number) {
  return Math.max(1, Math.min(900, exp - Math.floor(Date.now() / 1000)));
}

function cacheableImage(file: MediaHead) {
  return safeType(file.contentType).startsWith("image/") && file.size > 0 && file.size <= 8_000_000;
}

function deny(status: number, origin = "", code = "") {
  const headers = baseHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  const payload: { ok: false; error: string; code?: string } = { ok: false, error: "That file could not be opened." };
  if (code === "signature" || code === "expired" || code === "path" || code === "method") payload.code = code;
  return new Response(JSON.stringify(payload), { status, headers });
}

/** Cache key is the object path only. The signed token is not part of it. */
export function authorizedCacheRequest(url: URL, range = "") {
  const cached = new URL(`${url.origin}${url.pathname}`);
  if (range) cached.searchParams.set("bytes", range);
  return new Request(cached.toString(), { method: "GET" });
}

function keyFromPath(pathname: string) {
  if (!pathname.startsWith("/v1/")) return "";
  const segments = pathname.slice(4).split("/").filter(Boolean);
  if (!segments.length) return "";
  try {
    const joined = segments.map((segment) => decodeURIComponent(segment)).join("/");
    return canonicalObjectKey(joined);
  } catch {
    return "";
  }
}

function etagMatches(header: string, etag: string) {
  const clean = etag.replace(/^W\//, "").replaceAll("\"", "");
  return header.split(",").some((part) => {
    const item = part.trim().replace(/^W\//, "").replaceAll("\"", "");
    return item === "*" || item === clean;
  });
}

function parseRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match || size < 1) return "invalid" as const;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return "invalid" as const;
  const last = Math.min(end, size - 1);
  return { offset: start, length: last - start + 1 };
}

/** Private object reads. A bad token never touches the bucket. Public R2 addresses are not generated here. */
export async function handleMediaGateway(request: Request, binding: MediaGatewayBinding): Promise<Response> {
  const originHeader = request.headers.get("origin") || "";
  const allowed = originAllowed(binding.allowedOrigins, originHeader) ? originHeader : "";
  if (request.method === "OPTIONS") {
    if (originHeader && !allowed) return deny(403);
    const headers = baseHeaders(allowed);
    headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    headers.set("access-control-allow-headers", "range, if-none-match, if-modified-since");
    headers.set("access-control-max-age", "600");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return deny(405, allowed);

  const url = new URL(request.url);
  const key = keyFromPath(url.pathname);
  const method = request.method as MediaMethod;
  const opened = key ? await openMediaToken(url.searchParams.get("t") || "", binding.secret) : null;
  const claims: MediaTokenClaims | null = opened && opened.ok ? opened.claims : null;
  let problem = "";
  if (!key) problem = "path";
  else if (!opened || !opened.ok) problem = opened && opened.problem === "expired" ? "expired" : "signature";
  else if (opened.claims.key !== key) problem = "path";
  else if (!opened.claims.methods.includes(method)) problem = "method";
  if (!claims || problem) return deny(403, allowed, problem || "signature");

  const edge = binding.cachePolicy === "authorized" ? binding.edgeCache : undefined;
  const rangeHeader = request.headers.get("range") || "";
  const cacheRequest = edge && !rangeHeader ? authorizedCacheRequest(url) : null;
  if (edge && cacheRequest && (request.method === "GET" || request.method === "HEAD")) {
    let hit: Response | undefined;
    try {
      hit = await edge.match(cacheRequest);
    } catch {
      hit = undefined;
    }
    if (hit && hit.status === 200 && (request.method === "HEAD" || hit.body)) {
      const headers = browserHeaders(allowed, claims, {
        type: hit.headers.get("content-type") || "",
        size: hit.headers.get("content-length") || undefined,
        etag: hit.headers.get("etag") || undefined,
      });
      headers.set("x-wc-cache", "HIT");
      const inm = request.headers.get("if-none-match");
      const etag = headers.get("etag") || "";
      if (request.method === "GET" && inm && etag && etagMatches(inm, etag)) {
        void hit.body?.cancel();
        return new Response(null, { status: 304, headers });
      }
      if (request.method === "HEAD") {
        void hit.body?.cancel();
        return new Response(null, { status: 200, headers });
      }
      return new Response(hit.body, { status: 200, headers });
    }
  }

  const head = await binding.head(key);
  if (!head) {
    const headers = baseHeaders(allowed);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("x-wc-cache", "BYPASS");
    return new Response(JSON.stringify({ ok: false, error: "That file could not be opened." }), { status: 404, headers });
  }

  const tag = request.headers.get("if-none-match");
  const since = request.headers.get("if-modified-since");
  const sinceTime = since ? Date.parse(since) : Number.NaN;
  const notModified = (tag && etagMatches(tag, head.etag)) || (!tag && !Number.isNaN(sinceTime) && head.uploaded.getTime() <= sinceTime);
  if (notModified) return new Response(null, { status: 304, headers: objectHeaders(head, claims, allowed) });

  if (request.method === "HEAD") {
    const headers = objectHeaders(head, claims, allowed);
    headers.set("content-length", String(head.size));
    headers.set("x-wc-cache", "BYPASS");
    return new Response(null, { status: 200, headers });
  }

  const range = parseRange(request.headers.get("range"), head.size);
  if (range === "invalid") {
    const headers = objectHeaders(head, claims, allowed);
    headers.set("content-range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }
  const file = await binding.get(key, range || undefined);
  if (!file?.body) {
    const headers = baseHeaders(allowed);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("x-wc-cache", "BYPASS");
    return new Response(JSON.stringify({ ok: false, error: "That file could not be opened." }), { status: 404, headers });
  }
  const headers = objectHeaders(file, claims, allowed);
  if (range) {
    const last = range.offset + range.length - 1;
    headers.set("content-range", `bytes ${range.offset}-${last}/${head.size}`);
    headers.set("content-length", String(range.length));
    headers.set("x-wc-cache", "BYPASS");
    return new Response(responseBody(file.body), { status: 206, headers });
  }
  headers.set("content-length", String(file.size));
  const cacheable = Boolean(edge && cacheRequest && request.method === "GET" && cacheableImage(file));
  if (!cacheable || !edge || !cacheRequest) {
    headers.set("x-wc-cache", "BYPASS");
    return new Response(responseBody(file.body), { status: 200, headers });
  }
  const raw = file.body instanceof Uint8Array ? file.body : new Uint8Array(await new Response(file.body).arrayBuffer());
  let storedOk = false;
  try {
    await edge.put(cacheRequest, workerCacheResponse(file, raw, cacheTtl(claims.exp)));
    storedOk = true;
  } catch {
    storedOk = false;
  }
  headers.set("cache-control", PRIVATE_CACHE);
  headers.set("cdn-cache-control", BROWSER_CDN_CACHE);
  headers.set("x-wc-cache", storedOk ? "MISS" : "BYPASS");
  const client = new Uint8Array(raw.byteLength);
  client.set(raw);
  return new Response(client.buffer, { status: 200, headers });
}

function leakedTarget(location: string) {
  const value = location.toLowerCase();
  return value.includes("r2.dev") || value.includes("cloudflarestorage.com");
}

function privateCache(cache: string) {
  const value = cache.toLowerCase();
  return value.includes("private") && !value.includes("public");
}

/** Security verdict for one gateway test. Delivery is not turned on here. */
export function judgeGatewayProbe(input: {
  enabled: boolean;
  origin: string;
  anonymousStatus: number | null;
  anonymousCache: string;
  anonymousLocation: string;
  badStatus: number | null;
  signedStatus: number | null;
  signedCache: string;
  signedLocation: string;
  signedType: string;
}): GatewayVerdict {
  if (!input.enabled) {
    return {
      usable: false,
      state: "disabled",
      detail: "The media gateway is off. Photos and videos still use the existing private path. The bucket was not made public.",
      requirement: "",
    };
  }
  if (!input.origin) {
    return {
      usable: false,
      state: "incomplete",
      detail: "A Worker origin is not saved. The bucket was not made public.",
      requirement: "Enter an https Worker origin. Do not use a public R2 address.",
    };
  }
  const leaked = leakedTarget(input.anonymousLocation) || leakedTarget(input.signedLocation);
  const redirected = (status: number | null) => status != null && status >= 300 && status < 400;
  if (leaked || input.anonymousStatus === 200 || redirected(input.anonymousStatus) || redirected(input.signedStatus) || /public/i.test(input.anonymousCache) || /public/i.test(input.signedCache)) {
    return {
      usable: false,
      state: "error",
      detail: "Anonymous access was not refused, or the response pointed at a public address.",
      requirement: "Do not enable r2.dev. The bucket was not made public.",
    };
  }
  if (input.anonymousStatus !== 401 && input.anonymousStatus !== 403) {
    return {
      usable: false,
      state: "incomplete",
      detail: input.anonymousStatus ? `A request with no token was HTTP ${input.anonymousStatus}, not a refusal.` : "The Worker did not answer the anonymous check.",
      requirement: "The bucket was not made public.",
    };
  }
  if (input.badStatus !== 403) {
    return {
      usable: false,
      state: "incomplete",
      detail: input.badStatus == null ? "The bad-signature check did not return a status." : `A bad signature was HTTP ${input.badStatus}, not 403.`,
      requirement: "The bucket was not made public.",
    };
  }
  const signedType = input.signedType.toLowerCase();
  const signedJson = signedType.includes("application/json") && !signedType.includes("image/") && !signedType.includes("video/");
  if (input.signedStatus === 404 && signedJson && privateCache(input.signedCache)) {
    return {
      usable: true,
      state: "verified",
      detail: "The gateway refused anonymous and bad signatures, accepted a signed probe, and did not serve a file. The bucket was not made public.",
      requirement: "",
    };
  }
  return {
    usable: false,
    state: "incomplete",
    detail: input.signedStatus === 401
      ? "The Worker refused a correctly signed probe. The signing secret does not match. The secret is not shown."
      : input.signedStatus ? `The signed probe was HTTP ${input.signedStatus}.` : "The signed probe did not return a status.",
    requirement: "The bucket was not made public.",
  };
}

export type GatewayCheckResult = "passed" | "failed" | "skipped" | "present" | "missing" | "invalid";

export type GatewayCheck = {
  id: string;
  label: string;
  result: GatewayCheckResult;
  detail: string;
};

export type GatewayReport = {
  verdict: GatewayVerdict;
  stage: string;
  summary: string;
  checks: GatewayCheck[];
};

/** Classifies a transport failure without copying the raw message, which can contain a signed URL. */
export function classifyGatewayTransport(input: { name?: string; code?: string }) {
  const code = `${input.code || ""} ${input.name || ""}`.toLowerCase();
  if (code.includes("timeout") || code.includes("abort")) return { stage: "timeout" as const, detail: "The Worker did not answer before the check timed out." };
  if (code.includes("enotfound") || code.includes("eai_again") || code.includes("enodata")) return { stage: "dns" as const, detail: "DNS for the Worker host failed. Nameservers were not changed." };
  if (code.includes("cert") || code.includes("tls") || code.includes("unable_to") || code.includes("self_signed") || code.includes("depth_zero")) {
    return { stage: "tls" as const, detail: "TLS to the Worker host failed." };
  }
  return { stage: "unreachable" as const, detail: "The Worker URL could not be reached." };
}

/** Names a signed-probe HTTP 403 without the secret or the signature. */
export function signedProbeMismatch(code: string | undefined) {
  if (code === "signature") return "Mismatch: signature. MEDIA_GATEWAY_SECRET on this server does not match the Worker. The secret was not shown.";
  if (code === "expired") return "Mismatch: expiry. The Worker treated the signed probe as expired.";
  if (code === "path") return "Mismatch: object path. The Worker rejected the path on the signed probe.";
  if (code === "method") return "Mismatch: HTTP method. The Worker rejected the method on the signed probe.";
  return "Mismatch: unclassified. The Worker rejected the signed probe before opening the file and did not name the check. A matching MEDIA_GATEWAY_SECRET answers HTTP 404 for this missing probe, not HTTP 403. The usual cause is a different secret on the Worker. The secret was not shown.";
}

function step(id: string, label: string, result: GatewayCheckResult, detail: string): GatewayCheck {
  return { id, label, result, detail };
}

function skipRest(checks: GatewayCheck[], reason: string, ids: ReadonlyArray<readonly [string, string]>) {
  for (const item of ids) checks.push(step(item[0], item[1], "skipped", reason));
}

const LATER = [
  ["reach", "Worker endpoint"],
  ["status", "Worker HTTP status"],
  ["type", "Worker content type"],
  ["binding", "R2 binding"],
  ["origin-allow", "Allowed origin"],
  ["anonymous", "Anonymous access"],
  ["bad-signature", "Invalid signature"],
  ["signed", "Valid signed request"],
  ["private", "Private object"],
] as const;

/** One row per check. The first failed row is the stage. Later rows stay skipped when an earlier step cannot continue. */
export function buildGatewayReport(input: {
  enabled: boolean;
  origin: string;
  originValid: boolean;
  secretPresent: boolean;
  transport: "ok" | "dns" | "tls" | "timeout" | "unreachable" | "skipped";
  anonymousStatus: number | null;
  anonymousType: string;
  anonymousCache: string;
  anonymousLocation: string;
  originAllowed: boolean | null;
  badStatus: number | null;
  signedStatus: number | null;
  signedType: string;
  signedCache: string;
  signedLocation: string;
  signedPrepared?: boolean;
  signedCode?: string;
  headStatus?: number | null;
  postStatus?: number | null;
  expiredStatus?: number | null;
  modifiedStatus?: number | null;
  signedHeadStatus?: number | null;
}): GatewayReport {
  const verdict = judgeGatewayProbe({
    enabled: input.enabled,
    origin: input.originValid ? input.origin : "",
    anonymousStatus: input.anonymousStatus,
    anonymousCache: input.anonymousCache,
    anonymousLocation: input.anonymousLocation,
    badStatus: input.badStatus,
    signedStatus: input.signedStatus,
    signedCache: input.signedCache,
    signedLocation: input.signedLocation,
    signedType: input.signedType,
  });
  const checks: GatewayCheck[] = [];
  checks.push(input.originValid
    ? step("origin", "Worker origin", "present", "The Worker origin is an https host.")
    : input.origin
      ? step("origin", "Worker origin", "invalid", "The Worker origin is not a usable https host. A public R2 address was not accepted.")
      : step("origin", "Worker origin", "missing", "A Worker origin is not saved."));
  checks.push(input.secretPresent
    ? step("secret", "Media Gateway Secret", "present", "MEDIA_GATEWAY_SECRET is saved on the server. The value is not shown.")
    : step("secret", "Media Gateway Secret", "missing", "MEDIA_GATEWAY_SECRET is not saved. The value is not shown."));
  if (!input.enabled && input.transport === "skipped") {
    skipRest(checks, "Not called because the gateway is off.", LATER);
    return { verdict, stage: "disabled", summary: verdict.detail, checks };
  }
  if (!input.originValid || (!input.secretPresent && input.transport === "skipped")) {
    const reason = !input.originValid ? "The origin is not usable." : "The signing secret is missing.";
    skipRest(checks, reason, LATER);
    return { verdict, stage: !input.originValid ? "origin" : "secret", summary: verdict.detail, checks };
  }
  if (input.transport === "skipped") {
    skipRest(checks, "The Worker was not called.", LATER);
    const summary = "The media gateway has not been tested for this secret and host. The bucket was not made public.";
    return {
      verdict: { ...verdict, usable: false, state: "incomplete", detail: summary, requirement: "Run the gateway test after the host points at the Worker, not at public R2." },
      stage: "not_tested",
      summary,
      checks,
    };
  }
  if (input.transport !== "ok") {
    const transport = input.transport === "dns"
      ? "DNS for the Worker host failed. Nameservers were not changed."
      : input.transport === "tls"
        ? "TLS to the Worker host failed."
        : input.transport === "timeout"
          ? "The Worker did not answer before the check timed out."
          : "The Worker URL could not be reached.";
    checks.push(step("reach", "Worker endpoint", "failed", transport));
    skipRest(checks, "Not run because the Worker could not be reached.", LATER.slice(1));
    return {
      verdict: { ...verdict, usable: false, state: "error", detail: transport, requirement: "The bucket was not made public." },
      stage: input.transport,
      summary: transport,
      checks,
    };
  }
  checks.push(step("reach", "Worker endpoint", "passed", "The Worker host answered."));
  const status = input.anonymousStatus;
  checks.push(status == null
    ? step("status", "Worker HTTP status", "failed", "The Worker did not return an HTTP status.")
    : step("status", "Worker HTTP status", "passed", `HTTP ${status}.`));
  const type = input.anonymousType.trim().toLowerCase();
  checks.push(type
    ? step("type", "Worker content type", "passed", type.slice(0, 80))
    : step("type", "Worker content type", "failed", "The Worker did not send a content type."));
  if (status === 503) checks.push(step("binding", "R2 binding", "failed", "The Worker says its private bucket binding is unavailable."));
  else if (status === 401 || status === 403) checks.push(step("binding", "R2 binding", "passed", "The Worker is running. A missing binding would answer HTTP 503 before this check."));
  else checks.push(step("binding", "R2 binding", "skipped", status === 404 ? "HTTP 404 does not show whether the private bucket binding is available." : "The Worker did not say whether the private bucket binding is available."));
  const blocked = checks.some((item) => item.result === "failed" || item.result === "invalid" || item.result === "missing");
  if (blocked) {
    skipRest(checks, "Not run after the Worker response check failed.", LATER.slice(5));
    const failed = checks.find((item) => item.result === "failed" || item.result === "invalid" || item.result === "missing");
    return {
      verdict: { ...verdict, usable: false, state: "error", detail: failed?.detail || verdict.detail, requirement: "The bucket was not made public." },
      stage: failed?.id || "binding",
      summary: failed?.detail || verdict.detail,
      checks,
    };
  }
  if (status === 404) checks.push(step("origin-allow", "Allowed origin", "skipped", "Not checked because the Worker returned HTTP 404."));
  else if (input.originAllowed === true) checks.push(step("origin-allow", "Allowed origin", "passed", "The Worker allowed the app origin."));
  else if (input.originAllowed === false) checks.push(step("origin-allow", "Allowed origin", "failed", "The Worker did not allow the app origin."));
  else checks.push(step("origin-allow", "Allowed origin", "skipped", "The origin check did not finish."));
  const leaked = leakedTarget(input.anonymousLocation) || leakedTarget(input.signedLocation);
  if (leaked || status === 200) checks.push(step("anonymous", "Anonymous access", "failed", "Anonymous access was not refused. A public object or R2 redirect was not accepted."));
  else if (status === 401 || status === 403) checks.push(step("anonymous", "Anonymous access", "passed", `A request with no token was refused (HTTP ${status}).`));
  else checks.push(step("anonymous", "Anonymous access", "failed", status ? `A request with no token was HTTP ${status}, not a refusal.` : "The Worker did not answer the anonymous check."));
  if (input.badStatus === 403) checks.push(step("bad-signature", "Invalid signature", "passed", "A bad signature was refused with HTTP 403."));
  else if (input.badStatus == null) checks.push(step("bad-signature", "Invalid signature", "failed", "The bad-signature check did not return a status."));
  else checks.push(step("bad-signature", "Invalid signature", "failed", `A bad signature was HTTP ${input.badStatus}, not 403.`));
  const signedType = input.signedType.toLowerCase();
  const signedJson = signedType.includes("application/json") && !signedType.includes("image/") && !signedType.includes("video/");
  if (input.signedPrepared === false) checks.push(step("signed", "Valid signed request", "failed", input.secretPresent ? "The signed probe could not be prepared. MEDIA_GATEWAY_SECRET was not shown." : "MEDIA_GATEWAY_SECRET is not on this server, so a valid signed request was not sent."));
  else if (input.signedStatus === 401) checks.push(step("signed", "Valid signed request", "failed", "The Worker refused a correctly signed probe. MEDIA_GATEWAY_SECRET does not match. The secret is not shown."));
  else if (input.signedStatus === 404 && signedJson) checks.push(step("signed", "Valid signed request", "passed", "The Worker accepted the signature and did not serve a file."));
  else if (input.signedStatus === 403) checks.push(step("signed", "Valid signed request", "failed", `The Worker rejected the signed probe. ${signedProbeMismatch(input.signedCode)}`));
  else if (input.signedStatus != null && input.signedStatus >= 300 && input.signedStatus < 400) checks.push(step("signed", "Valid signed request", "failed", `The Worker redirected the signed probe (HTTP ${input.signedStatus}).`));
  else if (input.signedStatus === 200) checks.push(step("signed", "Valid signed request", "failed", "The Worker returned a file for the connection-test key."));
  else checks.push(step("signed", "Valid signed request", "failed", input.signedStatus ? `The signed probe was HTTP ${input.signedStatus}.` : "The signed probe did not return a status."));
  if (leaked) checks.push(step("private", "Private object", "failed", "The response pointed at a public R2 address. The bucket was not changed."));
  else if (input.signedStatus === 404 && signedJson && privateCache(input.signedCache)) checks.push(step("private", "Private object", "passed", "The missing test object stayed private. No file was served."));
  else if (input.signedStatus === 200) checks.push(step("private", "Private object", "failed", "A private test object was served instead of refused."));
  else checks.push(step("private", "Private object", checks.some((item) => item.id === "signed" && item.result === "failed") ? "skipped" : "failed", "The private-object check did not get a private JSON refusal."));
  if (input.headStatus !== undefined) {
    checks.push(input.headStatus === 401 || input.headStatus === 403
      ? step("head", "Anonymous HEAD", "passed", `Anonymous HEAD was refused (HTTP ${input.headStatus}).`)
      : step("head", "Anonymous HEAD", "failed", input.headStatus == null ? "Anonymous HEAD did not return a status." : `Anonymous HEAD was HTTP ${input.headStatus}, not a refusal.`));
  }
  if (input.postStatus !== undefined) {
    checks.push(input.postStatus === 405
      ? step("post", "POST", "passed", "POST was refused with HTTP 405.")
      : step("post", "POST", "failed", input.postStatus == null ? "POST did not return a status." : `POST was HTTP ${input.postStatus}, not 405.`));
  }
  if (input.expiredStatus !== undefined) {
    checks.push(input.expiredStatus === 401 || input.expiredStatus === 403
      ? step("expired", "Expired token", "passed", `An expired token was refused (HTTP ${input.expiredStatus}).`)
      : step("expired", "Expired token", "failed", input.expiredStatus == null ? "The expired-token check was not sent." : `An expired token was HTTP ${input.expiredStatus}, not a refusal.`));
  }
  if (input.modifiedStatus !== undefined) {
    checks.push(input.modifiedStatus === 401 || input.modifiedStatus === 403
      ? step("modified", "Modified object path", "passed", `A token for a different object was refused (HTTP ${input.modifiedStatus}).`)
      : step("modified", "Modified object path", "failed", input.modifiedStatus == null ? "The modified-path check was not sent." : `A token for a different object was HTTP ${input.modifiedStatus}.`));
  }
  if (input.signedHeadStatus !== undefined) {
    const signedHeadOk = input.signedHeadStatus === 404;
    checks.push(signedHeadOk
      ? step("signed-head", "Signed HEAD", "passed", `Signed HEAD returned HTTP ${input.signedHeadStatus}.`)
      : step("signed-head", "Signed HEAD", "failed", input.signedHeadStatus == null ? "Signed HEAD was not sent." : `Signed HEAD was HTTP ${input.signedHeadStatus}.`));
  }
  const failed = checks.find((item) => item.result === "failed" || item.result === "invalid" || item.result === "missing");
  if (!input.enabled) {
    if (!failed && input.transport === "ok") {
      const summary = "Security checks passed. The gateway switch is still off, so photos keep the existing private path. The bucket was not made public.";
      return { verdict: { usable: false, state: "disabled", detail: summary, requirement: "" }, stage: "disabled", summary, checks };
    }
    const summary = `${failed?.detail || verdict.detail} The gateway switch was not turned on. The bucket was not made public.`.replace(/\s+/g, " ").trim();
    return {
      verdict: { usable: false, state: "error", detail: summary, requirement: "The bucket was not made public." },
      stage: failed?.id || input.transport,
      summary,
      checks,
    };
  }
  if (!failed && verdict.state === "verified" && input.originAllowed === true) {
    return { verdict: { ...verdict, usable: true }, stage: "verified", summary: verdict.detail, checks };
  }
  const summary = failed?.detail || verdict.detail;
  return {
    verdict: { ...verdict, usable: false, state: verdict.state === "verified" ? "incomplete" : verdict.state, detail: summary, requirement: verdict.requirement || "The bucket was not made public." },
    stage: failed?.id || "private",
    summary,
    checks,
  };
}
