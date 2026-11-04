const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "mkv", "avi", "3gp", "qt"]);

function extensionOf(src: string, fallback: string) {
  const path = src.startsWith("r2:") ? src.slice(3) : src;
  const base = path.split("/").pop() || "";
  const ext = base.includes(".") ? (base.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (ext.length >= 2 && ext.length <= 5) return ext;
  return fallback;
}

/** A Downloads filename. The extension stays the real file type, not a forced JPEG. */
export function weddingDownloadName(src: string, index: number) {
  const ext = extensionOf(src, "jpg");
  const video = VIDEO_EXT.has(ext);
  const n = String(Math.max(1, Math.floor(index) || 1)).padStart(3, "0");
  return `WeddingCircle_${video ? "Video" : "Photo"}_${n}.${video ? ext : ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" || ext === "gif" ? ext.replace("jpeg", "jpg") : "jpg"}`;
}

export function safeDownloadName(requested: string, objectKey: string) {
  const cleaned = requested.trim().replace(/[^\w.\-]+/g, "").slice(0, 80);
  if (/^WeddingCircle_(Photo|Video)_\d{3}\.[a-z0-9]{2,5}$/.test(cleaned)) return cleaned;
  return weddingDownloadName(`r2:${objectKey}`, 1);
}

/** Hosts and co-hosts can always save. Everyone else follows the wedding's download switch. */
export function privacyAllowsDownload(payload: unknown, role: string) {
  if (role === "host" || role === "cohost") return true;
  let record: unknown = payload;
  if (typeof payload === "string") {
    try {
      record = JSON.parse(payload) as unknown;
    } catch {
      return false;
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const download = (record as { privacy?: { download?: unknown } }).privacy?.download;
  return download === true;
}

export function contentDisposition(name: string, inline = false) {
  const safe = safeDownloadName(name, "weddings/wedding/album/aa-file.jpg");
  return `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function downloadMime(name: string, fallback = "") {
  const known = fallback.toLowerCase();
  if (known.startsWith("image/") || known.startsWith("video/") || known.startsWith("audio/")) return known;
  const ext = name.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov" || ext === "qt") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function downloadFailure(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    /* The body was not JSON. */
  }
  if (status === 0) return "The download did not reach the app. Nothing was saved.";
  return `The download did not finish (HTTP ${status}). Nothing was saved.`;
}
