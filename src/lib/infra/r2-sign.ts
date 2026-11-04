import { createHash, createHmac } from "node:crypto";
import { SERVER_PUT_MAX } from "./r2-browser.ts";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export { SERVER_PUT_MAX };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

export function encodePath(path: string) {
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function signS3(input: {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  amzDate: string;
  mode?: "header" | "query";
}) {
  const region = input.region || "auto";
  const payloadHash = input.payloadHash || EMPTY_SHA256;
  const dateStamp = input.amzDate.slice(0, 8);
  const lower: Record<string, string> = {};
  const raw: Record<string, string> = { host: input.host, ...(input.headers || {}) };
  if (input.mode !== "query") {
    raw["x-amz-content-sha256"] = payloadHash;
    raw["x-amz-date"] = input.amzDate;
  }
  for (const [key, value] of Object.entries(raw)) lower[key.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((name) => `${name}:${lower[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = input.query || {};
  const canonicalQuery = Object.keys(query).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`).join("&");
  const canonical = [input.method.toUpperCase(), encodePath(input.path), canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders, headers: lower, canonical };
}

export function presignS3(input: {
  method: "GET" | "PUT" | "HEAD";
  accountId: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;
  expiresSeconds: number;
  contentType?: string;
}) {
  const host = `${input.accountId}.r2.cloudflarestorage.com`;
  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${input.accessKeyId}/${scope}`;
  const extra: Record<string, string> = {};
  const contentType = input.contentType?.trim();
  if (contentType) extra["content-type"] = contentType;
  const signedHeaders = ["host", ...Object.keys(extra)].sort().join(";");
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": input.amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const signed = signS3({
    method: input.method,
    host,
    path: `/${input.bucket}/${input.key}`,
    query,
    headers: extra,
    payloadHash: "UNSIGNED-PAYLOAD",
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: "auto",
    amzDate: input.amzDate,
    mode: "query",
  });
  query["X-Amz-Signature"] = signed.signature;
  const search = Object.keys(query).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`).join("&");
  const path = encodePath(`/${input.bucket}/${input.key}`);
  return { url: `https://${host}${path}?${search}`, signature: signed.signature, signedHeaders };
}

function causeText(error: unknown, depth = 0): string {
  if (!error || depth > 5) return "";
  if (typeof error === "string") return error;
  const err = error as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
  const parts = [err.code, err.message].filter((part) => typeof part === "string") as string[];
  if (err.cause) parts.push(causeText(err.cause, depth + 1));
  if (Array.isArray(err.errors)) {
    for (const item of err.errors) parts.push(causeText(item, depth + 1));
  }
  return parts.join(" ");
}

export function explainR2Transport(error: unknown) {
  const haystack = causeText(error).toLowerCase();
  const code = haystack.match(/\b(?:enotfound|eai_again|econnrefused|enetunreach|ehostunreach|econnreset|enotconn|etimedout|und_err_connect_timeout|err_ssl[a-z0-9_/-]*)\b/i)?.[0] || "";
  if (haystack.includes("enotfound") || haystack.includes("eai_again")) {
    return "DNS could not find this R2 account address. Check that the account id is the 32-character id from the Cloudflare dashboard. No file was uploaded.";
  }
  if (haystack.includes("timedout") || haystack.includes("timeout") || haystack.includes("und_err_connect_timeout")) {
    return "The connection to Cloudflare R2 timed out before any response. No file was uploaded.";
  }
  if (haystack.includes("econnrefused") || haystack.includes("enetunreach") || haystack.includes("ehostunreach") || haystack.includes("econnreset") || haystack.includes("enotconn")) {
    return `The network could not reach Cloudflare R2${code ? ` (${code})` : ""}. No file was uploaded.`;
  }
  if (haystack.includes("handshake") || haystack.includes("eproto") || haystack.includes("err_ssl") || haystack.includes("certificate") || haystack.includes("ssl") || haystack.includes("tls")) {
    return "Cloudflare closed the TLS connection before any access key was sent. This R2 account address has no certificate, so this is not a bad secret, a signature error, or a missing bucket. Confirm R2 is enabled and the account id matches the S3 endpoint. No file was uploaded.";
  }
  const brief = causeText(error).replace(/fetch failed/gi, "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `The R2 connection failed before a response${code ? ` (${code})` : ""}. ${brief} No file was uploaded.`.replace(/\s+/g, " ").trim();
}

export function explainR2Http(status: number, body: string) {
  const code = body.match(/<Code>([^<]{1,80})<\/Code>/)?.[1] || "";
  const message = body.match(/<Message>([^<]{1,180})<\/Message>/)?.[1] || "";
  if (status === 200 || status === 204) return "";
  if (status >= 300 && status < 400) {
    return "R2 redirected this bucket to a different endpoint. The account address may not match the bucket location. No file was uploaded.";
  }
  if (code === "InvalidAccessKeyId" || status === 401 || code === "Unauthorized") return "R2 refused this access key id. The secret was not shown. No file was uploaded.";
  if (code === "SignatureDoesNotMatch") return "R2 rejected the request signature. The secret was not shown. No file was uploaded.";
  if (/access key has length/i.test(message)) return "R2 refused the access key id because it is not a 32-character R2 key. The secret was not shown. No file was uploaded.";
  if (code === "AccessDenied" || status === 403) return "The access key reached R2 but does not have permission for this bucket. No file was uploaded.";
  if (code === "NoSuchKey") return "Private storage did not keep that file. Nothing else was changed.";
  if (code === "NoSuchBucket") return "R2 did not find that bucket on this account. No file was uploaded.";
  if (status === 404) return "R2 did not find that object. Nothing else was changed.";
  if (code === "AuthorizationHeaderMalformed" || code === "InvalidArgument") return "R2 rejected the request before accepting the bucket. The secret was not shown. No file was uploaded.";
  return `R2 answered HTTP ${status}${code ? ` (${code})` : ""}. No file was uploaded.`;
}

export async function probeR2Bucket(input: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
}) {
  const accountId = input.accountId.trim().toLowerCase();
  const bucket = input.bucket.trim();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  try {
    const signed = signS3({
      method: "GET",
      host,
      path: `/${bucket}`,
      query: { location: "" },
      accessKeyId: input.accessKeyId.trim(),
      secretAccessKey: input.secretAccessKey.trim(),
      region: "auto",
      amzDate,
    });
    const response = await fetch(`https://${host}/${encodeURIComponent(bucket)}?location=`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        authorization: signed.authorization,
        "x-amz-content-sha256": signed.headers["x-amz-content-sha256"],
        "x-amz-date": signed.headers["x-amz-date"],
      },
    });
    const body = await response.text().catch(() => "");
    if (response.status !== 200 && response.status !== 204) {
      return { ok: false as const, detail: explainR2Http(response.status, body) };
    }
    return { ok: true as const, detail: "The private bucket accepted a location check. No file was uploaded and no wedding file was moved." };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

const corsReady = new Set<string>();
const corsBlockedUntil = new Map<string, number>();

export function browserUploadCorsXml() {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<CORSConfiguration>`,
    `<CORSRule>`,
    `<AllowedOrigin>*</AllowedOrigin>`,
    `<AllowedMethod>GET</AllowedMethod>`,
    `<AllowedMethod>PUT</AllowedMethod>`,
    `<AllowedMethod>HEAD</AllowedMethod>`,
    `<AllowedHeader>*</AllowedHeader>`,
    `<AllowedHeader>content-type</AllowedHeader>`,
    `<AllowedHeader>Content-Type</AllowedHeader>`,
    `<ExposeHeader>ETag</ExposeHeader>`,
    `<MaxAgeSeconds>3600</MaxAgeSeconds>`,
    `</CORSRule>`,
    `</CORSConfiguration>`,
  ].join("");
}

/** True when some existing rule already lets a browser PUT with a content type. */
export function corsAllowsBrowserPut(xml: string) {
  return xml.toLowerCase().split("</corsrule>").some((rule) => {
    const put = rule.includes("<allowedmethod>put</allowedmethod>");
    const header = rule.includes("<allowedheader>*</allowedheader>") || rule.includes("<allowedheader>content-type</allowedheader>");
    const origin = rule.includes("<allowedorigin>*</allowedorigin>") || /<allowedorigin>https?:\/\//.test(rule);
    return put && header && origin;
  });
}

async function callR2(input: {
  method: "GET" | "PUT" | "HEAD" | "POST" | "DELETE";
  accountId: string;
  bucket: string;
  key?: string;
  query?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  body?: Uint8Array | string;
  contentType?: string;
  contentMd5?: string;
  binary?: boolean;
  now?: Date;
  timeoutMs?: number;
}) {
  const accountId = input.accountId.trim().toLowerCase();
  const bucket = input.bucket.trim();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const raw = typeof input.body === "string" ? Buffer.from(input.body) : input.body ? Buffer.from(input.body) : Buffer.alloc(0);
  const payloadHash = raw.length ? createHash("sha256").update(raw).digest("hex") : EMPTY_SHA256;
  const headers: Record<string, string> = {};
  if (input.contentType) headers["content-type"] = input.contentType;
  if (input.contentMd5) headers["content-md5"] = input.contentMd5;
  const path = input.key ? `/${bucket}/${input.key}` : `/${bucket}`;
  const signed = signS3({
    method: input.method,
    host,
    path,
    query: input.query,
    headers,
    payloadHash,
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKey: input.secretAccessKey.trim(),
    region: "auto",
    amzDate,
  });
  const query = input.query
    ? `?${Object.keys(input.query).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(input.query![key])}`).join("&")}`
    : "";
  const response = await fetch(`https://${host}${encodePath(path)}${query}`, {
    method: input.method,
    redirect: "manual",
    signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    headers: {
      authorization: signed.authorization,
      "x-amz-content-sha256": signed.headers["x-amz-content-sha256"],
      "x-amz-date": signed.headers["x-amz-date"],
      ...(input.contentType ? { "content-type": input.contentType } : {}),
      ...(input.contentMd5 ? { "content-md5": input.contentMd5 } : {}),
    },
    body: input.method === "GET" || input.method === "HEAD" || input.method === "DELETE" ? undefined : raw,
  });
  let text = "";
  let bytes = new Uint8Array();
  if (input.method !== "HEAD") {
    if (input.binary) bytes = new Uint8Array(await response.arrayBuffer());
    else text = await response.text().catch(() => "");
  }
  return { status: response.status, body: text, bytes, etag: response.headers.get("etag") || "" };
}

export async function ensureR2BrowserCors(input: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const mark = `${input.accountId.trim().toLowerCase()}/${input.bucket.trim()}`;
  if (corsReady.has(mark)) return { ok: true as const, detail: "Browser uploads are already allowed. The bucket stays private." };
  const blocked = corsBlockedUntil.get(mark) || 0;
  if (blocked > Date.now()) return { ok: false as const, detail: "Browser uploads are not allowed yet. The bucket stays private." };
  try {
    const current = await callR2({ ...input, method: "GET", query: { cors: "" } });
    if (current.status === 200 && corsAllowsBrowserPut(current.body)) {
      corsReady.add(mark);
      return { ok: true as const, detail: "Browser uploads are already allowed. The bucket stays private." };
    }
    const xml = browserUploadCorsXml();
    const md5 = createHash("md5").update(xml).digest("base64");
    let saved = await callR2({ ...input, method: "PUT", query: { cors: "" }, body: xml, contentType: "application/xml", contentMd5: md5 });
    if (saved.status === 400) {
      saved = await callR2({ ...input, method: "PUT", query: { cors: "" }, body: xml, contentType: "application/xml" });
    }
    if (saved.status !== 200 && saved.status !== 204) {
      const reason = explainR2Http(saved.status, saved.body);
      corsBlockedUntil.set(mark, Date.now() + 10 * 60 * 1000);
      return {
        ok: false as const,
        detail: `${reason} The browser cannot store a file until this private bucket accepts the upload. The bucket was not made public.`,
      };
    }
    corsReady.add(mark);
    corsBlockedUntil.delete(mark);
    return { ok: true as const, detail: "Browser uploads are allowed on this private bucket. No file was made public." };
  } catch (error) {
    corsBlockedUntil.set(mark, Date.now() + 10 * 60 * 1000);
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

export async function putR2Object(input: {
  accountId: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  contentType: string;
  body: Uint8Array;
}) {
  try {
    const result = await callR2({
      method: "PUT",
      accountId: input.accountId,
      bucket: input.bucket,
      key: input.key,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      contentType: input.contentType,
      body: input.body,
      timeoutMs: 30_000,
    });
    if (result.status !== 200 && result.status !== 204) {
      const detail = explainR2Http(result.status, result.body);
      console.error("[r2-put]", result.status, detail);
      return { ok: false as const, detail };
    }
    return { ok: true as const, etag: result.etag };
  } catch (error) {
    const detail = explainR2Transport(error);
    console.error("[r2-put]", detail);
    return { ok: false as const, detail };
  }
}

export async function headR2Object(input: {
  accountId: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  try {
    const result = await callR2({ ...input, method: "HEAD", timeoutMs: 15_000 });
    if (result.status !== 200) return { ok: false as const, detail: explainR2Http(result.status, result.body) };
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

type R2Creds = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export async function getR2Object(input: R2Creds & { key: string }) {
  try {
    const result = await callR2({ ...input, method: "GET", binary: true, timeoutMs: 30_000 });
    if (result.status !== 200) return { ok: false as const, detail: explainR2Http(result.status, result.body) };
    return { ok: true as const, bytes: result.bytes };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

export async function deleteR2Object(input: R2Creds & { key: string }) {
  try {
    const result = await callR2({ ...input, method: "DELETE", timeoutMs: 20_000 });
    if (result.status !== 200 && result.status !== 204 && result.status !== 404) return { ok: false as const, detail: explainR2Http(result.status, result.body) };
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

export async function createR2Multipart(input: R2Creds & { key: string; contentType: string }) {
  try {
    const result = await callR2({ ...input, method: "POST", query: { uploads: "" }, contentType: input.contentType, timeoutMs: 20_000 });
    const uploadId = result.body.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1] || "";
    if ((result.status !== 200 && result.status !== 204) || !uploadId) {
      const detail = explainR2Http(result.status, result.body) || "R2 did not start the upload. No file was stored.";
      console.error("[r2-multipart]", result.status, detail);
      return { ok: false as const, detail };
    }
    return { ok: true as const, uploadId };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

export async function uploadR2Part(input: R2Creds & { key: string; uploadId: string; partNumber: number; body: Uint8Array }) {
  try {
    const result = await callR2({
      ...input,
      method: "PUT",
      query: { partNumber: String(input.partNumber), uploadId: input.uploadId },
      body: input.body,
      timeoutMs: 60_000,
    });
    if (result.status !== 200 || !result.etag) {
      const detail = explainR2Http(result.status, result.body) || "R2 did not accept that piece of the file.";
      console.error("[r2-part]", result.status, detail);
      return { ok: false as const, detail };
    }
    return { ok: true as const, etag: result.etag };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;");
}

export function completeMultipartXml(parts: { n: number; e: string }[]) {
  const body = parts.map((part) => `<Part><PartNumber>${part.n}</PartNumber><ETag>${xmlEscape(part.e)}</ETag></Part>`).join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

export async function completeR2Multipart(input: R2Creds & { key: string; uploadId: string; parts: { n: number; e: string }[] }) {
  const xml = completeMultipartXml(input.parts);
  try {
    const result = await callR2({
      ...input,
      method: "POST",
      query: { uploadId: input.uploadId },
      body: xml,
      contentType: "application/xml",
      timeoutMs: 30_000,
    });
    if (result.status !== 200 && result.status !== 204) {
      const detail = explainR2Http(result.status, result.body);
      console.error("[r2-complete]", result.status, detail);
      return { ok: false as const, detail };
    }
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
}

/** Read one private object without buffering it. The signed link is not logged. */
export async function openR2Read(input: {
  accountId: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  range?: string;
  method?: "GET" | "HEAD";
}) {
  const method = input.method || "GET";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const signed = presignS3({
    method,
    accountId: input.accountId,
    bucket: input.bucket,
    key: input.key,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    amzDate,
    expiresSeconds: 60,
  });
  const headers: Record<string, string> = {};
  if (method === "GET" && input.range && /^bytes=\d+-\d*$/.test(input.range)) headers.range = input.range;
  let response: Response;
  try {
    response = await fetch(signed.url, { method, headers, redirect: "manual" });
  } catch (error) {
    return { ok: false as const, detail: explainR2Transport(error) };
  }
  if (method === "HEAD") {
    if (response.status !== 200) return { ok: false as const, detail: explainR2Http(response.status, "") };
    return {
      ok: true as const,
      body: null,
      status: 200,
      contentType: response.headers.get("content-type") || "",
      contentLength: response.headers.get("content-length") || "",
      contentRange: "",
    };
  }
  if (response.status !== 200 && response.status !== 206) {
    const text = await response.text().catch(() => "");
    return { ok: false as const, detail: explainR2Http(response.status, text) };
  }
  if (!response.body) return { ok: false as const, detail: "Private storage did not send that file." };
  return {
    ok: true as const,
    body: response.body,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    contentLength: response.headers.get("content-length") || "",
    contentRange: response.headers.get("content-range") || "",
  };
}
