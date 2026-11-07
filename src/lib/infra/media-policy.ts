export const MEDIA_LIMITS = {
  image: 12 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  audio: 8 * 1024 * 1024,
} as const;

const MIME = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/heic": "image",
  "image/heif": "image",
  "image/avif": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-matroska": "video",
  "video/x-msvideo": "video",
  "video/3gpp": "video",
  "video/mpeg": "video",
  "video/ogg": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
} as const;

export type MediaKind = keyof typeof MEDIA_LIMITS;
export type MediaPurpose = "album" | "chat" | "profile" | "cover";

export function withinRate(recentCount: number, limit = 30) {
  return recentCount < limit;
}

export function mediaObjectKey(weddingId: string, purpose: MediaPurpose, fileName: string, id: string) {
  const wedding = weddingId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  const file = fileName.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^\.+/, "").slice(0, 80) || "file";
  const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  return `weddings/${wedding}/${purpose}/${safeId}-${file}`;
}

export function keyBelongsToWedding(objectKey: string, weddingId: string) {
  const wedding = weddingId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  const key = objectKey.trim();
  if (!wedding || !key || key.includes("..") || key.includes("\\") || key.startsWith("/")) return false;
  return key.startsWith(`weddings/${wedding}/`);
}

export function authorizeMedia(input: {
  role: string;
  member: boolean;
  weddingId: string;
  purpose: MediaPurpose;
  mime: string;
  bytes: number;
  objectKey?: string;
}) {
  if (!input.member) return { ok: false as const, error: "You are not in this wedding." };
  const role = input.role.trim().toLowerCase();
  if (input.purpose === "cover" && role !== "host" && role !== "cohost") {
    return { ok: false as const, error: "Only a host can change that picture." };
  }
  if (role !== "host" && role !== "cohost" && role !== "guest" && role !== "family") {
    return { ok: false as const, error: "You are not in this wedding." };
  }
  const kind = MIME[input.mime.trim().toLowerCase() as keyof typeof MIME];
  if (!kind) return { ok: false as const, error: "That file type is not allowed." };
  if (!Number.isFinite(input.bytes) || input.bytes <= 0 || input.bytes > MEDIA_LIMITS[kind]) {
    return { ok: false as const, error: "That file is empty or too large." };
  }
  if (input.objectKey && !keyBelongsToWedding(input.objectKey, input.weddingId)) {
    return { ok: false as const, error: "That file is not in this wedding." };
  }
  return { ok: true as const, kind };
}
