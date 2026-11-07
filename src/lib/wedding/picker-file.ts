/**
 * Chrome on Android revokes a content-URI file when the picker input is cleared.
 * Samsung Internet keeps that file readable. Copy the bytes first, and only on Chrome Android.
 */
export function needsOwnedPickerBytes(ua: string) {
  return /Android/i.test(ua) && /Chrome\/\d+/.test(ua) && !/SamsungBrowser/i.test(ua);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function sniffMediaType(name: string, bytes: Uint8Array) {
  const lower = name.toLowerCase();
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand === "heic" || brand === "heif" || brand === "heix" || brand === "mif1" || brand === "msf1") return brand === "heif" || brand === "mif1" ? "image/heif" : "image/heic";
    return "video/mp4";
  }
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.heic$/.test(lower)) return "image/heic";
  if (/\.heif$/.test(lower)) return "image/heif";
  if (/\.mp4$|\.m4v$/.test(lower)) return "video/mp4";
  if (/\.mov$|\.qt$/.test(lower)) return "video/quicktime";
  if (/\.webm$/.test(lower)) return "video/webm";
  return "";
}

function named(original: string, type: string) {
  const ext = EXT[type] || "";
  const base = original.trim().replace(/[^\w.\- ()]+/g, "").slice(0, 80);
  if (!base) return ext === "mp4" || ext === "mov" || ext === "webm" ? `video.${ext}` : `photo.${ext || "jpg"}`;
  if (ext && !/\.[a-z0-9]{2,5}$/i.test(base)) return `${base}.${ext}`;
  return base;
}

/** Sequential copy. One file is read at a time so a large selection is not decoded together. */
export async function ownPickerFiles(files: File[]) {
  const own = typeof navigator !== "undefined" && needsOwnedPickerBytes(navigator.userAgent || "");
  const ready: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!file) continue;
    if (!own) {
      ready.push(file);
      continue;
    }
    const label = file.name?.trim() ? `"${file.name.trim()}"` : "That file";
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      let type = (file.type || "").split(";")[0].trim().toLowerCase();
      if (!type || type === "application/octet-stream") type = sniffMediaType(file.name || "", head);
      if (!type) {
        errors.push(`${label} is not a supported photo or video. Use JPG, PNG, HEIC, WebP, GIF, MP4, MOV, or WebM.`);
        continue;
      }
      const filename = named(file.name || "", type);
      const stamp = file.lastModified || Date.now();
      // Photos are copied so clearing the picker cannot revoke them. Large videos are detached with slice() so ten files are not all held in memory at once.
      if (file.size > 24 * 1024 * 1024) {
        const detached = new File([file.slice(0, file.size, type)], filename, { type, lastModified: stamp });
        const probe = await detached.slice(0, 1).arrayBuffer();
        if (probe.byteLength === 0) {
          errors.push(`${label} could not be read from the phone. Choose it again.`);
          continue;
        }
        ready.push(detached);
        continue;
      }
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0 || (file.size > 0 && buffer.byteLength !== file.size)) {
        errors.push(`${label} could not be read from the phone. Choose it again.`);
        continue;
      }
      ready.push(new File([buffer], filename, { type, lastModified: stamp }));
    } catch {
      errors.push(`${label} could not be read from the phone. Choose it again.`);
    }
  }
  return { files: ready, errors };
}

const ownedSelections = new WeakMap<File, Promise<File>>();
let copyQueue: Promise<unknown> = Promise.resolve();
/** Start safe phone-file ownership after the preview is queued; share it with Send. */
export function ownSelectedFile(file: File): Promise<File> {
  const cached = ownedSelections.get(file);
  if (cached) return cached;
  const result = copyQueue.then(async () => {
    const owned = await ownPickerFiles([file]);
    if (!owned.files[0]) throw new Error(owned.errors[0] || 'That file could not be read. Choose it again.');
    return owned.files[0];
  });
  copyQueue = result.catch(() => undefined);
  ownedSelections.set(file, result);
  return result;
}
