import { MEDIA_LIMITS, type MediaPurpose } from "@/lib/infra/media-policy";
import { appRuntime } from "@/lib/developer/runtime";
import { parseR2Ref } from "@/lib/wedding/r2-ref";
import { uploadPreparedFile, uploadPreviewBlob } from "@/lib/wedding/r2-upload";
import { needsOwnedPickerBytes } from "@/lib/wedding/picker-file";

export const IMAGE_MAX_EDGE = 2560;
export const IMAGE_QUALITY = 0.82;
export const PREVIEW_EDGE = 480;
let uploadLimit = 3;
export function uploadConcurrency() {
  return uploadLimit;
}
export function setUploadConcurrency(value: number) {
  uploadLimit = Math.min(4, Math.max(1, Math.round(value) || 3));
}

export type PreparedUpload =
  | { kind: "image"; src: string; temporary: false }
  | { kind: "video"; src: string; seconds: number; temporary: false };

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi|3gp|mpeg|mpg|ogv|qt)$/i;

/** One accept list for every photo picker. The stored copy is the private-bucket object, not a Google upload. */
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,image/bmp,image/tiff,image/heic,image/heif,image/avif,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.avif";

/** One accept list for every video picker. */
export const VIDEO_ACCEPT =
  "video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/3gpp,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.mpeg,.mpg,.ogv,.qt";

export const MEDIA_ACCEPT = `${PHOTO_ACCEPT},${VIDEO_ACCEPT}`;

export type MediaKind = "image" | "video";

export function mediaKindOf(file: { type?: string; name?: string }): MediaKind | null {
  const type = (file.type || "").toLowerCase();
  const name = file.name || "";
  const image = type.startsWith("image/") || IMAGE_EXT.test(name);
  const video = type.startsWith("video/") || VIDEO_EXT.test(name);
  if (video && !image) return "video";
  if (image && !video) return "image";
  if (image && video) return type.startsWith("video/") ? "video" : "image";
  return null;
}

export function unsupportedMediaMessage(file: { name?: string }) {
  const name = file.name?.trim();
  const label = name ? `"${name}"` : "That file";
  return `${label} is not a supported photo or video. Use JPG, PNG, HEIC, WebP, GIF, BMP, TIFF, MP4, MOV, WebM, MKV, AVI, or 3GP.`;
}

const UPLOAD_MIME: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "video/mp4": "video/mp4",
  "video/webm": "video/webm",
  "video/quicktime": "video/quicktime",
};

function uploadMime(file: File) {
  const type = UPLOAD_MIME[(file.type || "").toLowerCase()];
  if (type) return type;
  const name = file.name.toLowerCase();
  if (/\.jpe?g$/.test(name)) return "image/jpeg";
  if (/\.png$/.test(name)) return "image/png";
  if (/\.webp$/.test(name)) return "image/webp";
  if (/\.gif$/.test(name)) return "image/gif";
  if (/\.mp4$/.test(name) || /\.m4v$/.test(name)) return "video/mp4";
  if (/\.webm$/.test(name)) return "video/webm";
  if (/\.mov$/.test(name) || /\.qt$/.test(name)) return "video/quicktime";
  return "";
}

export async function prepareUpload(
  file: File,
  onStatus?: (label: string) => void,
  slug?: string,
  purpose: MediaPurpose = "album",
): Promise<PreparedUpload> {
  if (!file || file.size <= 0) throw new Error("That file was empty.");
  const kind = mediaKindOf(file);
  if (!kind) throw new Error(unsupportedMediaMessage(file));
  const runtime = await appRuntime();
  if (!runtime.flags.photoUploads) throw new Error("Photo and video uploads are turned off.");
  if (!slug) throw new Error("Open a wedding before adding a photo or video.");
  if (kind === "image" && file.size > 200_000_000) throw new Error("That photo is larger than 200 MB.");
  if (kind === "video" && file.size > MEDIA_LIMITS.video) throw new Error("That video is larger than 80 MB.");
  if (typeof navigator !== "undefined" && needsOwnedPickerBytes(navigator.userAgent || "")) {
    setUploadConcurrency(2);
    try {
      const probe = await file.slice(0, 1).arrayBuffer();
      if (file.size > 0 && probe.byteLength === 0) throw new Error("That file was empty.");
    } catch (error) {
      if (error instanceof Error && error.message === "That file was empty.") throw error;
      throw new Error("That file could not be read from the phone. Choose it again.");
    }
  }
  const secondsPromise = kind === "video" ? readDuration(file) : Promise.resolve(0);
  onStatus?.("Preparing");
  const compressStarted = typeof performance !== "undefined" ? performance.now() : Date.now();
  const uploadFile = await optimiseUploadFile(file);
  const compressMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - compressStarted);
  const mime = uploadMime(uploadFile);
  if (!mime || (kind === "image" && !mime.startsWith("image/")) || (kind === "video" && !mime.startsWith("video/"))) {
    const heic = /heic|heif/i.test(`${file.type} ${file.name} ${uploadFile.type} ${uploadFile.name}`);
    throw new Error(heic
      ? "This phone could not prepare that HEIC photo. Choose a JPG or PNG instead. Nothing was uploaded."
      : "That file type is not allowed. Use JPG, PNG, WebP, GIF, MP4, MOV, or WebM.");
  }
  if (kind === "image" && uploadFile.size > MEDIA_LIMITS.image) throw new Error("That photo is larger than 12 MB after preparation.");
  const typed = uploadFile.type === mime ? uploadFile : new File([uploadFile], uploadFile.name, { type: mime, lastModified: uploadFile.lastModified });
  const src = await uploadPreparedFile(typed, slug, purpose, onStatus, { originalBytes: file.size, compressMs });
  const parent = parseR2Ref(src);
  if (parent) {
    void previewBlob(kind === "video" ? file : typed).then((blob) => {
      if (blob) return uploadPreviewBlob(blob, slug, parent);
      return undefined;
    }).catch(() => undefined);
  }
  const seconds = await secondsPromise;
  if (kind === "video") return { kind: "video", src, seconds, temporary: false };
  return { kind: "image", src, temporary: false };
}

export const MAX_PHOTOS = 50;
export const MAX_VIDEOS = 5;

export function splitUploadFiles(files: File[], caps = { photos: MAX_PHOTOS, videos: MAX_VIDEOS }) {
  const images: File[] = [];
  const videos: File[] = [];
  for (const file of files) {
    const kind = mediaKindOf(file);
    if (kind === "video") videos.push(file);
    else if (kind === "image") images.push(file);
  }
  return {
    images: images.slice(0, caps.photos),
    videos: videos.slice(0, caps.videos),
    limited: images.length > caps.photos || videos.length > caps.videos,
  };
}

/** Byte progress from the existing uploader status, capped below 100 until the caller confirms success. */
export function uploadProgressPercent(label: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(label);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(99, Math.round(value)));
}

export async function prepareMany(files: File[], onPercent: (percent: number) => void, slug?: string, onFile?: (index: number, label: string) => void) {
  const runtime = await appRuntime();
  if (!runtime.flags.photoUploads) return { items: [], limited: false, errors: ["Photo and video uploads are turned off."], outcomes: [] };
  const { images, videos, limited } = splitUploadFiles(files, {
    photos: Math.min(MAX_PHOTOS, runtime.maxPhotos),
    videos: Math.min(MAX_VIDEOS, runtime.maxVideos),
  });
  const queue = [...images, ...videos];
  const errors: string[] = [];
  for (const file of files) {
    if (!file || file.size <= 0) errors.push("That file was empty.");
    else if (!mediaKindOf(file)) errors.push(unsupportedMediaMessage(file));
  }
  if (queue.length === 0) {
    if (!errors.length) errors.push("Choose a photo or a video.");
    return { items: [], limited, errors, outcomes: [] };
  }
  const items: PreparedUpload[] = new Array(queue.length);
  const outcomes: ({ ok: true; item: PreparedUpload } | { ok: false; error: string })[] = new Array(queue.length);
  let next = 0;
  let finished = 0;
  const workers = Array.from({ length: Math.min(uploadConcurrency(), queue.length) }, async () => {
    while (next < queue.length) {
      const index = next;
      next += 1;
      try {
        items[index] = await prepareUpload(queue[index], (label) => onFile?.(index, label), slug);
        outcomes[index] = { ok: true, item: items[index] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "That file could not be saved.";
        errors.push(message);
        outcomes[index] = { ok: false, error: message };
      }
      finished += 1;
      onPercent(Math.min(99, Math.round((finished / queue.length) * 100)));
    }
  });
  await Promise.all(workers);
  const ready = items.filter((item): item is PreparedUpload => Boolean(item));
  if (ready.length) onPercent(100);
  return { items: ready, limited, errors, outcomes };
}

const KEEP_UNDER = 1_200_000;
const REENCODE_OVER = 6_000_000;

let imageWork: Promise<void> = Promise.resolve();

/** Chrome Android runs out of memory if several photos are decoded together. Other browsers are unchanged. */
function oneImageAtATime<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !needsOwnedPickerBytes(navigator.userAgent || "")) return run();
  const next = imageWork.then(run, run);
  imageWork = next.then(() => undefined, () => undefined);
  return next;
}

function efficientImage(file: File) {
  const type = file.type.toLowerCase();
  return type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp" || /\.(jpe?g|png|webp)$/i.test(file.name);
}

/**
 * Optimise an upload copy. Small or already-efficient photos are left alone.
 * Videos are not re-encoded in the browser (that drops audio and quality).
 * If decoding or encoding fails, or the copy is not smaller, the original is kept.
 */
export async function optimiseUploadFile(file: File): Promise<File> {
  if (mediaKindOf(file) !== "image") return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  const type = file.type.toLowerCase();
  if (type === "image/gif" || /\.gif$/i.test(file.name)) return file;
  if (efficientImage(file) && file.size > 0 && file.size < KEEP_UNDER) return file;
  return oneImageAtATime(async () => {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge < 2) return file;
    if (efficientImage(file) && edge <= IMAGE_MAX_EDGE && file.size < REENCODE_OVER) return file;
    const scale = Math.min(1, IMAGE_MAX_EDGE / edge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const keepAlpha = type === "image/png" || type === "image/webp" || /\.(png|webp)$/i.test(file.name);
    const mime = keepAlpha ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), mime, IMAGE_QUALITY));
    if (!blob) return file;
    const resized = scale < 1;
    if (blob.size >= file.size && !(resized && blob.size <= file.size * 1.15)) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    const ext = mime === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: mime, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
  });
}

async function canvasBlob(source: CanvasImageSource, width: number, height: number, mime: string) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), mime, 0.72));
}

/** A small preview for the feed. The original upload is unchanged if this fails. */
export async function previewBlob(file: File): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const kind = mediaKindOf(file);
  if (kind === "image") {
    return oneImageAtATime(async () => {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      try {
        const edge = Math.max(bitmap.width, bitmap.height);
        const scale = Math.min(1, PREVIEW_EDGE / Math.max(1, edge));
        return await canvasBlob(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale), "image/webp");
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
    });
  }
  if (kind !== "video") return null;
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(blob);
    };
    const timer = window.setTimeout(() => finish(null), 1500);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadeddata = () => {
      const edge = Math.max(video.videoWidth, video.videoHeight);
      if (!edge) {
        finish(null);
        return;
      }
      const scale = Math.min(1, PREVIEW_EDGE / edge);
      void canvasBlob(video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale), "image/webp").then(finish);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function readDuration(file: File) {
  const url = URL.createObjectURL(file);
  return new Promise<number>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (seconds: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(seconds);
    };
    const timer = window.setTimeout(() => finish(0), 1200);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const seconds = Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : 0;
      finish(seconds);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    video.src = url;
  });
}

export function circleMedia(wedding: {
  cover?: string;
  coverVideo?: string;
  posts: { images: string[]; videoLabel?: string; videos?: { src: string }[]; id: string }[];
  chats: { messages: { image?: string; video?: string; id: string }[] }[];
  beforeNotes?: { images: string[]; video?: string; id: string }[];
}) {
  const items: { url: string; name: string }[] = [];
  const push = (url: string | undefined, name: string) => {
    if (!url) return;
    if (url.startsWith("/media/") || url.endsWith(".svg")) return;
    if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("idb:") && !url.startsWith("http") && !url.startsWith("r2:") && !url.startsWith("gp:")) return;
    items.push({ url, name });
  };
  push(wedding.cover, "cover.jpg");
  push(wedding.coverVideo, "cover-video.mp4");
  wedding.posts.forEach((post, index) => {
    post.images.forEach((src, imageIndex) => push(src, `photo-${index + 1}-${imageIndex + 1}.jpg`));
    const clips = post.videos?.map((clip) => clip.src) ?? [];
    clips.forEach((src, clipIndex) => push(src, `video-${index + 1}-${clipIndex + 1}.mp4`));
    if (post.videoLabel && !clips.includes(post.videoLabel)) push(post.videoLabel, `video-${index + 1}.mp4`);
  });
  wedding.chats.forEach((chat) => {
    chat.messages.forEach((message, index) => {
      push(message.image, `chat-photo-${index + 1}.jpg`);
      push(message.video, `chat-video-${index + 1}.mp4`);
    });
  });
  (wedding.beforeNotes ?? []).forEach((item, index) => {
    item.images.forEach((src, imageIndex) => push(src, `before-${index + 1}-${imageIndex + 1}.jpg`));
    push(item.video, `before-video-${index + 1}.mp4`);
  });
  return items;
}
