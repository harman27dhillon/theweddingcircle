import { infraAcceptChunk, infraConfirmUpload, infraDropUnrecorded, infraIssueDownload, infraPrepareDownload, infraPrepareUpload } from "@/lib/infra/infra.functions";
import { UPLOAD_CHUNK_BYTES, encodeUploadPiece, explainBrowserPut, explainUnreachedServer, explainUploadRequestFailure, pieceLength, putSignedObject, retryDelayMs, shouldRelayAfterDirect, uploadPieceCount } from "@/lib/infra/r2-browser";
import type { MediaPurpose } from "@/lib/infra/media-policy";
import { memberKeyFor, rememberMemberKey } from "@/lib/wedding/member-key";
import { parseR2Ref, r2Ref, thumbObjectKey, weddingSlugFromR2Key } from "@/lib/wedding/r2-ref";
import { localThumbUrl, saveLocalThumb } from "@/lib/wedding/media-db";

const fresh = new Map<string, { url: string; until: number }>();

/** Drop a signed view link so the next attempt asks for a fresh one. */
export function dropResolvedMedia(src: string, variant?: "full" | "preview") {
  const key = parseR2Ref(src);
  if (!key) return;
  if (!variant || variant === "preview") fresh.delete(`preview:${key}`);
  if (!variant || variant === "full") fresh.delete(`full:${key}`);
}

export type UploadTiming = {
  originalBytes: number;
  processedBytes: number;
  compressMs: number;
  signMs: number;
  uploadMs: number;
  confirmMs: number;
  totalMs: number;
  mode: "direct" | "relay";
};

const timings: UploadTiming[] = [];

export function recentUploadTimings() {
  return timings.slice();
}

function rememberTiming(timing: UploadTiming) {
  timings.push(timing);
  if (timings.length > 12) timings.shift();
  console.info("[wedding-media]", JSON.stringify(timing));
}

function memberKey(slug: string) {
  const current = memberKeyFor(slug);
  if (/^[A-Za-z0-9_-]{8,80}$/.test(current)) return current;
  const key = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  rememberMemberKey(slug, key);
  return key;
}

function headerName(name: string) {
  const safe = name.replace(/[^\x20-\x7E]/g, "").trim().slice(0, 120);
  return safe || "file";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPiece(input: {
  slug: string;
  memberKey: string;
  purpose: MediaPurpose;
  mime: string;
  fileName: string;
  uploadId: string;
  index: number;
  totalChunks: number;
  totalBytes: number;
  body: Blob;
}) {
  const chunk = encodeUploadPiece(new Uint8Array(await input.body.arrayBuffer()));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await infraAcceptChunk({
        data: {
          slug: input.slug,
          memberKey: input.memberKey,
          purpose: input.purpose,
          mime: input.mime,
          fileName: headerName(input.fileName),
          uploadId: input.uploadId,
          index: input.index,
          totalChunks: input.totalChunks,
          totalBytes: input.totalBytes,
          chunk,
        },
      });
      if (result.ok || attempt === 2) return result;
      const retry = /timeout|temporarily|unavailable|try again/i.test(result.error || "");
      if (!retry) return result;
      await wait(retryDelayMs(attempt));
    } catch (error) {
      lastError = error;
      const unreachable = explainUploadRequestFailure(error);
      if (!unreachable || attempt === 2) {
        if (unreachable) throw new Error(unreachable);
        throw error;
      }
      await wait(retryDelayMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("That file could not be saved.");
}

async function uploadThroughServer(file: File, slug: string, purpose: MediaPurpose, mime: string, onStatus?: (label: string) => void) {
  const totalChunks = uploadPieceCount(file.size);
  if (!totalChunks) throw new Error("That file was empty.");
  const key = memberKey(slug);
  let uploadId = "";
  let objectKey = "";
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * UPLOAD_CHUNK_BYTES;
    const result = await sendPiece({
      slug,
      memberKey: key,
      purpose,
      mime,
      fileName: file.name || "file",
      uploadId,
      index,
      totalChunks,
      totalBytes: file.size,
      body: file.slice(start, start + pieceLength(file.size, index)),
    });
    if (!result.ok) throw new Error(result.error || "Private storage did not keep that file. Nothing else was changed.");
    uploadId = result.uploadId || uploadId;
    objectKey = result.key || objectKey;
    if (index === totalChunks - 1 && !result.done) throw new Error("Private storage did not keep that file. Nothing else was changed.");
    onStatus?.(`Loading ${Math.min(99, Math.round(((index + 1) / totalChunks) * 100))}%`);
  }
  onStatus?.("Loading 100%");
  return objectKey;
}

async function putDirect(url: string, file: File, mime: string, onStatus?: (label: string) => void) {
  let last: { ok: false; status: number; body: string } | { ok: true } = { ok: false, status: 0, body: "" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const put = await putSignedObject(url, file, mime, (ratio) => {
      const percent = Math.min(99, Math.round(ratio * 100));
      if (percent > 0) onStatus?.(`Loading ${percent}%`);
    });
    if (put.ok) return put;
    last = put;
    if (!shouldRelayAfterDirect(put.status) && put.status !== 429 && put.status < 500) return put;
    if (attempt < 2) await wait(retryDelayMs(attempt));
  }
  return last;
}

/** Store one file. A signed direct upload is used when the private bucket allows it. Otherwise the app relays the file. The secret never reaches this file. */
export async function uploadPreparedFile(
  file: File,
  slug: string,
  purpose: MediaPurpose,
  onStatus?: (label: string) => void,
  trace?: { originalBytes: number; compressMs: number },
) {
  const mime = (file.type || "").toLowerCase();
  if (!mime) throw new Error("That file type is not allowed.");
  const started = Date.now();
  onStatus?.("Preparing");
  let key = memberKey(slug);
  const signStarted = Date.now();
  let plan: Awaited<ReturnType<typeof infraPrepareUpload>>;
  try {
    plan = await infraPrepareUpload({
      data: { slug, memberKey: key, purpose, mime, bytes: file.size, fileName: headerName(file.name || "file") },
    });
  } catch (error) {
    const unreachable = explainUploadRequestFailure(error);
    if (unreachable) throw new Error(unreachable);
    throw error;
  }
  if (!plan.ok && plan.error === "You are not in this wedding.") {
    const [{ circleKey }, { useWeddingStore }, { registerHostAuthority }] = await Promise.all([
      import("./circle-key"), import("./store"), import("./role-client"),
    ]);
    const wedding = useWeddingStore.getState().weddings.find((item) => item.slug === slug);
    if (wedding && circleKey(slug).length >= 16) {
      const restored = await registerHostAuthority(wedding);
      if (restored.ok) {
        key = memberKey(slug);
        plan = await infraPrepareUpload({
          data: { slug, memberKey: key, purpose, mime, bytes: file.size, fileName: headerName(file.name || "file") },
        });
      }
    }
  }
  const signMs = Date.now() - signStarted;
  if (!plan.ok) throw new Error(plan.error || "Private storage did not keep that file. Nothing else was changed.");
  if (plan.mode === "direct" && plan.uploadUrl && plan.key) {
    const uploadStarted = Date.now();
    const put = await putDirect(plan.uploadUrl, file, mime, onStatus);
    if (put.ok) {
      const confirmStarted = Date.now();
      let confirmed = await infraConfirmUpload({
        data: { slug, memberKey: key, objectKey: plan.key, purpose, mime, bytes: file.size },
      });
      if (!confirmed.ok) {
        await wait(retryDelayMs(0));
        confirmed = await infraConfirmUpload({
          data: { slug, memberKey: key, objectKey: plan.key, purpose, mime, bytes: file.size },
        });
      }
      if (!confirmed.ok) {
        await infraDropUnrecorded({ data: { slug, memberKey: key, objectKey: plan.key } }).catch(() => undefined);
        throw new Error(confirmed.error || "Private storage did not keep that file. Nothing else was changed.");
      }
      onStatus?.("Loading 100%");
      rememberTiming({
        originalBytes: trace?.originalBytes || file.size,
        processedBytes: file.size,
        compressMs: trace?.compressMs || 0,
        signMs,
        uploadMs: Date.now() - uploadStarted,
        confirmMs: Date.now() - confirmStarted,
        totalMs: Date.now() - started,
        mode: "direct",
      });
      return r2Ref(confirmed.key || plan.key);
    }
    if (!shouldRelayAfterDirect(put.status)) throw new Error(explainBrowserPut(put.status, put.body));
  }
  const uploadStarted = Date.now();
  const objectKey = await uploadThroughServer(file, slug, purpose, mime, onStatus);
  rememberTiming({
    originalBytes: trace?.originalBytes || file.size,
    processedBytes: file.size,
    compressMs: trace?.compressMs || 0,
    signMs,
    uploadMs: Date.now() - uploadStarted,
    confirmMs: 0,
    totalMs: Date.now() - started,
    mode: "relay",
  });
  return r2Ref(objectKey);
}

/** Small feed preview kept on this phone. It is not uploaded, and a failed preview does not remove the photo. */
export async function uploadPreviewBlob(blob: Blob, _slug: string, objectKey: string) {
  if (!thumbObjectKey(objectKey) || blob.size <= 0 || blob.size > 400_000) return;
  await saveLocalThumb(objectKey, blob);
}

/**
 * Signed view link for one wedding object.
 * A future private media domain would be applied here. This never returns a public bucket URL.
 */
export async function resolveR2Media(src: string, variant: "full" | "preview" = "full") {
  const key = parseR2Ref(src);
  if (!key) return { url: "", note: "That file could not be opened." };
  const slug = weddingSlugFromR2Key(key);
  if (!slug) return { url: "", note: "That file is not in this wedding." };
  const cacheKey = `${variant}:${key}`;
  // Device thumbnails take precedence over signed URLs already fetched for this visit.
  if (variant === "preview") {
    const local = await localThumbUrl(key).catch(() => "");
    if (local) return { url: local, note: "" };
  }
  const cached = fresh.get(cacheKey);
  if (cached && cached.until > Date.now()) return { url: cached.url, note: "" };
  const savedKey = memberKeyFor(slug);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(savedKey)) return { url: "", note: "You are not in this wedding." };
  try {
    const result = await infraPrepareDownload({ data: { slug, memberKey: savedKey, objectKey: key, variant } });
    if (!result.ok) return { url: "", note: result.error };
    if (result.downloadUrl) fresh.set(cacheKey, { url: result.downloadUrl, until: Date.now() + 4 * 60 * 1000 });
    return { url: result.downloadUrl, note: "" };
  } catch (error) {
    return { url: "", note: explainUnreachedServer(error) || "That file could not be opened." };
  }
}

export async function issueDownloadPath(src: string, name: string) {
  const key = parseR2Ref(src);
  if (!key) return { ok: false as const, error: "That file could not be downloaded." };
  const slug = weddingSlugFromR2Key(key);
  if (!slug) return { ok: false as const, error: "That file is not in this wedding." };
  const savedKey = memberKeyFor(slug);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(savedKey)) return { ok: false as const, error: "You are not in this wedding." };
  try {
    return await infraIssueDownload({ data: { slug, memberKey: savedKey, objectKey: key, name } });
  } catch (error) {
    return { ok: false as const, error: explainUnreachedServer(error) || "That file could not be downloaded." };
  }
}
