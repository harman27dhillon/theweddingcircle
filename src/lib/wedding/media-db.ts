import { parseR2Ref } from "./r2-ref.ts";

const DB_NAME = "wedding-circle-media";
const STORE = "files";

const urls = new Map<string, string>();

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser cannot keep photos and videos."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open photo storage"));
  });
}

export function mediaKey(id: string) {
  return `idb:${id}`;
}

export function cachedMediaUrl(src?: string) {
  if (!src || !src.startsWith("idb:")) return src || "";
  return urls.get(src.slice(4)) || "";
}

export async function saveMediaBlob(blob: Blob) {
  const id = crypto.randomUUID();
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save that file"));
    });
  } finally {
    db.close();
  }
  urls.set(id, URL.createObjectURL(blob));
  return mediaKey(id);
}

export async function deleteMediaBlob(src?: string) {
  if (!src?.startsWith("idb:")) return;
  const id = src.slice(4);
  const known = urls.get(id);
  if (known) {
    URL.revokeObjectURL(known);
    urls.delete(id);
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not delete that file"));
    });
  } finally {
    db.close();
  }
}

export async function readMediaBlob(src?: string) {
  if (!src?.startsWith("idb:")) return null;
  const id = src.slice(4);
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read that file"));
    });
  } finally {
    db.close();
  }
}

async function rememberBlob(id: string, blob: Blob) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save that file"));
    });
  } finally {
    db.close();
  }
  const known = urls.get(id);
  if (known) return known;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

/** Feed thumbnail for one stored photo or video. The key is the private object id, never a cloud URL. */
export function localThumbId(objectKey: string) {
  const key = parseR2Ref(`r2:${objectKey}`);
  if (!key) return "";
  return `r2thumb:${key}`;
}

/** Keep a small preview on this phone. Nothing is uploaded. */
export async function saveLocalThumb(objectKey: string, blob: Blob) {
  const id = localThumbId(objectKey);
  if (!id || blob.size <= 0 || blob.size > 400_000) return "";
  const previous = urls.get(id);
  if (previous) {
    URL.revokeObjectURL(previous);
    urls.delete(id);
  }
  return rememberBlob(id, blob);
}

/** A thumbnail already on this phone, or an empty string. This does not contact storage. */
export async function localThumbUrl(objectKey: string) {
  const id = localThumbId(objectKey);
  if (!id) return "";
  const known = urls.get(id);
  if (known) return known;
  let blob: Blob | null = null;
  try {
    const db = await openDb();
    try {
      blob = await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(id);
        request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("Could not read that preview"));
      });
    } finally {
      db.close();
    }
  } catch {
    return "";
  }
  if (!(blob instanceof Blob) || blob.size <= 0) return "";
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function localMediaProof() {
  const memberKeys: string[] = [];
  const editKeys: string[] = [];
  if (typeof localStorage === "undefined") return { memberKeys, editKeys };
  try {
    const members = JSON.parse(localStorage.getItem("wc-member-keys") || "{}") as Record<string, unknown>;
    for (const value of Object.values(members)) {
      if (typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value)) memberKeys.push(value);
    }
    const circles = JSON.parse(localStorage.getItem("wc-circle-keys") || "{}") as Record<string, unknown>;
    for (const value of Object.values(circles)) {
      if (typeof value === "string" && value.length >= 16 && value.length <= 80) editKeys.push(value);
    }
  } catch {
    /* A missing key just means this browser cannot open a private recording. */
  }
  return { memberKeys: memberKeys.slice(0, 30), editKeys: editKeys.slice(0, 20) };
}

async function pullRemoteBlob(id: string) {
  try {
    const { fetchCircleMediaMeta, fetchCircleMediaPart } = await import("@/lib/wedding/circle.functions");
    const proof = localMediaProof();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const meta = (await fetchCircleMediaMeta({ data: { id, ...proof } })) as { chunks?: number; mime?: string } | null;
      if (meta && meta.chunks && meta.chunks > 0) {
        const pieces: string[] = [];
        let complete = true;
        for (let idx = 0; idx < meta.chunks; idx += 1) {
          const part = (await fetchCircleMediaPart({ data: { id, idx, ...proof } })) as { data?: string } | null;
          if (!part?.data) {
            complete = false;
            break;
          }
          pieces.push(part.data);
        }
        if (complete) return new Blob([decodeBase64(pieces.join(""))], { type: meta.mime || "application/octet-stream" });
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 450));
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveMediaUrl(src?: string) {
  if (!src) return "";
  if (!src.startsWith("idb:")) return src;
  const id = src.slice(4);
  const known = urls.get(id);
  if (known) return known;
  try {
    const db = await openDb();
    try {
      const blob = await new Promise<Blob | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result as Blob | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read that file"));
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        urls.set(id, url);
        return url;
      }
    } finally {
      db.close();
    }
    const remote = await pullRemoteBlob(id);
    if (!remote) return "";
    return rememberBlob(id, remote);
  } catch {
    return "";
  }
}

function saveFromApp(path: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = path;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function readDownload(response: Response, onProgress: (percent: number) => void) {
  const length = Number(response.headers.get("content-length") || 0);
  if (!response.body || !length) return response.blob();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value);
    received += next.value.byteLength;
    onProgress(Math.min(99, Math.round((received / length) * 100)));
  }
  return new Blob(parts.map((part) => part.slice()), { type: response.headers.get("content-type") || "application/octet-stream" });
}

const activeDownloads = new Set<string>();

function keepBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 120_000);
  return href;
}

async function downloadPrivate(src: string, name: string) {
  if (activeDownloads.has(src)) return;
  activeDownloads.add(src);
  const { downloadFailure } = await import("@/lib/wedding/download-name");
  const { issueDownloadPath } = await import("@/lib/wedding/r2-upload");
  const { toast } = await import("sonner");
  try {
    const issued = await issueDownloadPath(src, name);
    if (!issued.ok) {
      toast(issued.error || "That file could not be downloaded.");
      return;
    }
    const filename = "name" in issued && issued.name ? issued.name : name;
    const id = `dl-${filename}`;
    toast(`Downloading ${filename}`, { id });
    const head = await fetch(issued.path, { method: "HEAD" });
    if (!head.ok) {
      toast(downloadFailure(head.status, await head.text().catch(() => "")), { id });
      return;
    }
    const length = Number(head.headers.get("content-length") || 0);
    const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (picker && length > 12 * 1024 * 1024) {
      try {
        const handle = await picker({ suggestedName: filename });
        const response = await fetch(issued.path);
        if (!response.ok || !response.body) {
          toast(downloadFailure(response.status, await response.text().catch(() => "")), { id });
          return;
        }
        await response.body.pipeTo(await handle.createWritable());
        toast(`Downloaded ${filename}`, { id });
        return;
      } catch (error) {
        if (error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError")) {
          toast("The download was not allowed.", { id });
          return;
        }
      }
    }
    if (!length || length > 12 * 1024 * 1024) {
      saveFromApp(issued.path, filename);
      toast(`Downloading ${filename}. It will appear in Downloads when the phone finishes.`, { id });
      return;
    }
    const response = await fetch(issued.path);
    if (!response.ok) {
      toast(downloadFailure(response.status, await response.text().catch(() => "")), { id });
      return;
    }
    const blob = await readDownload(response, (percent) => toast(`Downloading ${filename} ${percent}%`, { id }));
    const href = keepBlob(blob, filename);
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    const canGallery = typeof navigator.share === "function" && Boolean(navigator.canShare?.({ files: [file] }));
    toast(`Downloaded ${filename}`, {
      id,
      action: { label: "Open", onClick: () => window.open(href, "_blank", "noopener") },
      cancel: canGallery ? { label: "Gallery", onClick: () => void navigator.share({ files: [file], title: filename }).catch(() => toast("The photo could not be added to the gallery.")) } : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    toast(message === "Failed to fetch" || message === "Load failed" ? "The download did not reach the app. Nothing was saved." : "That file could not be downloaded.");
  } finally {
    activeDownloads.delete(src);
  }
}

export async function downloadStored(src: string, name: string) {
  if (src.startsWith("r2:")) {
    await downloadPrivate(src, name);
    return;
  }
  if (src.startsWith("gp:")) {
    const media = await import("@/lib/google/upload").then((mod) => mod.resolveGoogleMedia(src, "download"));
    if (!media.url) return;
    const anchor = document.createElement("a");
    anchor.href = media.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  const href = await resolveMediaUrl(src);
  if (!href) return;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function dataUrlToBlob(value: string) {
  const [head, body] = value.split(",");
  const mime = /data:([^;,]+)/.exec(head || "")?.[1] || "application/octet-stream";
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function isCeremony(value: object) {
  const record = value as { name?: unknown; date?: unknown; time?: unknown };
  return typeof record.name === "string" && typeof record.date === "string" && typeof record.time === "string" && /^\d{2}:\d{2}$/.test(record.time);
}

function collectDataUrls(value: unknown, found: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith("data:image/") || value.startsWith("data:video/") || value.startsWith("data:application/") || value.startsWith("data:audio/")) found.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDataUrls(item, found));
    return;
  }
  if (value && typeof value === "object") {
    const ceremony = isCeremony(value);
    for (const [key, item] of Object.entries(value)) {
      if (ceremony && key === "cover") continue;
      collectDataUrls(item, found);
    }
  }
}

function rewrite(value: unknown, dict: Map<string, string>): unknown {
  if (typeof value === "string") return dict.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewrite(item, dict));
  if (value && typeof value === "object") {
    const ceremony = isCeremony(value);
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = ceremony && key === "cover" ? item : rewrite(item, dict);
    }
    return next;
  }
  return value;
}

export async function relocateDataUrls<T>(value: T): Promise<{ next: T; changed: boolean }> {
  const found = new Set<string>();
  collectDataUrls(value, found);
  if (found.size === 0) return { next: value, changed: false };
  const dict = new Map<string, string>();
  for (const dataUrl of found) {
    try {
      dict.set(dataUrl, await saveMediaBlob(dataUrlToBlob(dataUrl)));
    } catch {
      /* keep the original string if this one cannot be moved */
    }
  }
  if (dict.size === 0) return { next: value, changed: false };
  return { next: rewrite(value, dict) as T, changed: true };
}
