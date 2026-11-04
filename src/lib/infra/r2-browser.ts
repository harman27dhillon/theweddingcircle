/** What the phone can say about a browser PUT. Status 0 means the browser hid R2's answer. */
export const SERVER_PUT_MAX = 3_500_000;
/** One same-origin piece. Small enough that the platform returns an HTTP status instead of resetting the connection. */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;
export const MULTIPART_PART_BYTES = 5 * 1024 * 1024;
export const MEDIA_POST_PATH = "/api/infra/media";
/** Same request path the working connection test already uses. */
export const UPLOAD_REQUEST_PATH = "/_serverFn/";

export function uploadPieceCount(totalBytes: number) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / UPLOAD_CHUNK_BYTES);
}

export function pieceLength(totalBytes: number, index: number) {
  const count = uploadPieceCount(totalBytes);
  if (index < 0 || index >= count) return 0;
  if (index === count - 1) return totalBytes - index * UPLOAD_CHUNK_BYTES;
  return UPLOAD_CHUNK_BYTES;
}

function browserNetworkMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Failed to fetch" || message === "Load failed" || message === "fetch failed" || /NetworkError when attempting to fetch resource/i.test(message)) return message;
  return "";
}

/** The phone's fetch() rejected. There is no HTTP status, so this is not an R2 answer. */
export function explainUploadRequestFailure(error: unknown) {
  const message = browserNetworkMessage(error);
  if (!message) return "";
  return `POST ${UPLOAD_REQUEST_PATH} returned no HTTP status (${message}). The phone never reached the app server, so Cloudflare R2 was not asked to store this piece.`;
}

/** A response arrived. Prefer the server's own error, which is where an R2 refusal is reported. */
export function explainUploadHttp(status: number, body: string) {
  let parsed: { ok?: unknown; error?: unknown } | null = null;
  try {
    parsed = JSON.parse(body) as { ok?: unknown; error?: unknown };
  } catch {
    parsed = null;
  }
  if (parsed && parsed.ok === false && typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  if (parsed && parsed.ok === true) return "";
  const snippet = body.replace(/\s+/g, " ").trim().replace(/[A-Za-z0-9+/_=-]{48,}/g, "[redacted]").slice(0, 160);
  return `POST ${UPLOAD_REQUEST_PATH} answered HTTP ${status} without a storage result.${snippet ? ` ${snippet}` : ""} Cloudflare R2's reply was not in this response.`;
}

/** Standard base64, in small blocks so a phone does not crash on one huge function call. */
export function encodeUploadPiece(bytes: Uint8Array) {
  let binary = "";
  const block = 0x2000;
  for (let index = 0; index < bytes.length; index += block) {
    const end = Math.min(bytes.length, index + block);
    for (let cursor = index; cursor < end; cursor += 1) binary += String.fromCharCode(bytes[cursor] || 0);
  }
  return btoa(binary);
}

export function explainUnreachedServer(error: unknown) {
  const message = browserNetworkMessage(error);
  if (!message) return "";
  return `The app server did not answer (${message}). Cloudflare R2 was not contacted.`;
}

export function explainBrowserPut(status: number, body: string) {
  if (status === 0) {
    return "The browser blocked the upload before Cloudflare R2 stored it. Nothing else was changed.";
  }
  const code = body.match(/<Code>([^<]{1,80})<\/Code>/)?.[1] || "";
  const message = body.match(/<Message>([^<]{1,180})<\/Message>/)?.[1] || "";
  const safeMessage = /secret|key|token|signature=/i.test(message) ? "" : message;
  if (code === "SignatureDoesNotMatch") return "R2 rejected the upload signature (SignatureDoesNotMatch). The secret was not shown. Nothing else was changed.";
  if (code === "AccessDenied") return "R2 refused to store that file (AccessDenied). Nothing else was changed.";
  if (code === "NoSuchBucket" || (status === 404 && !code)) return "R2 did not find that bucket. Nothing else was changed.";
  if (code === "EntityTooLarge" || status === 413) return "R2 refused that file because it is too large. Nothing else was changed.";
  const detail = [code || `HTTP ${status}`, safeMessage].filter(Boolean).join(": ").replace(/\s+/g, " ").slice(0, 180);
  return `R2 refused the upload (${detail}). Nothing else was changed.`;
}

export function retryDelayMs(attempt: number) {
  return 400 * (2 ** Math.max(0, Math.floor(attempt)));
}

/** Status 0 means the browser hid the storage answer. Any real HTTP status is kept and shown. */
export function shouldRelayAfterDirect(status: number) {
  return status === 0;
}

/** PUT one file to a server-issued link. The link is not logged. Content-Type must match the signature. */
export function putSignedObject(url: string, body: Blob, contentType: string, onProgress?: (ratio: number) => void) {
  return new Promise<{ ok: true } | { ok: false; status: number; body: string }>((resolve) => {
    if (!url.startsWith("https://") || !contentType) {
      resolve({ ok: false, status: 0, body: "" });
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 120_000;
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onload = () => {
      const status = xhr.status;
      const text = (xhr.responseText || "").slice(0, 400);
      if (status >= 200 && status < 300) resolve({ ok: true });
      else resolve({ ok: false, status, body: text });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, body: "" });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, body: "" });
    xhr.send(body);
  });
}
