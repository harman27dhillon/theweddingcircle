import { memberKeyFor, rememberMemberKey } from "./member-key.ts";
import { parseR2Ref } from "./r2-ref.ts";
import { isSenderId } from "./identity.ts";
import type { WeddingGuestProfile } from "./types.ts";

const NAME_LIMIT = 40;
const BIO_LIMIT = 140;
const LINK_LIMIT = 5;
const PHOTO_MAX = 8 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type ProfileDraft = {
  displayName: string;
  photo?: string;
  bio?: string;
  links?: { label?: string; url?: string }[];
  relationship?: string;
  side?: string;
};

export function ownMemberKey(slug: string) {
  const current = memberKeyFor(slug);
  if (/^[A-Za-z0-9_-]{8,64}$/.test(current)) return current;
  const key = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  rememberMemberKey(slug, key);
  return key;
}

export function sanitizeText(value: string, max: number) {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function safeHttpUrl(value: string) {
  const raw = value.trim();
  if (!raw || raw.length > 300) return "";
  if (/^(javascript|data|vbscript|file|blob):/i.test(raw)) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (!url.hostname || url.username || url.password) return "";
  return url.toString();
}

export function cleanPhoto(value?: string) {
  if (!value) return "";
  const src = value.trim();
  if (!src || src.length > 500) return "";
  if (/^(javascript|data|blob|vbscript|file):/i.test(src)) return "";
  if (/^idb:[A-Za-z0-9_-]{8,80}$/.test(src)) return src;
  if (parseR2Ref(src)) return src;
  if (src.startsWith("gp:") && src.length < 200) return src;
  if (src.startsWith("http://") || src.startsWith("https://")) return safeHttpUrl(src);
  return "";
}

export function cleanLinks(links: { label?: string; url?: string }[]) {
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (out.length >= LINK_LIMIT) break;
    const url = safeHttpUrl(link.url ?? "");
    if (!url) continue;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let label = sanitizeText(link.label || "", NAME_LIMIT);
    if (!label) {
      try {
        label = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        label = "Link";
      }
    }
    out.push({ label, url });
  }
  return out;
}

export function prepareProfile(
  draft: ProfileDraft,
  meta: { accountId?: string; joinedName?: string; now?: string } = {},
): { ok: true; profile: WeddingGuestProfile } | { ok: false; error: string } {
  const displayName = sanitizeText(draft.displayName || "", NAME_LIMIT);
  if (!displayName) return { ok: false, error: "Add the name people should see in this wedding." };
  const photo = cleanPhoto(draft.photo);
  if ((draft.photo || "").trim() && !photo) return { ok: false, error: "That photo could not be used. Choose a JPG, PNG, WebP, or GIF." };
  const provided = (draft.links ?? []).filter((link) => (link.url || "").trim());
  if (provided.length > LINK_LIMIT) return { ok: false, error: "You can add up to five links." };
  if (provided.some((link) => !safeHttpUrl(link.url || ""))) return { ok: false, error: "Links must be normal http or https addresses." };
  const links = cleanLinks(provided);
  if (links.length < provided.length) return { ok: false, error: "Remove duplicate links." };
  const bio = sanitizeText(draft.bio || "", BIO_LIMIT);
  const relationship = sanitizeText(draft.relationship || "", NAME_LIMIT);
  const side = draft.side === "Bride" || draft.side === "Groom" ? draft.side : undefined;
  const accountId = meta.accountId && isSenderId(meta.accountId) ? meta.accountId : "";
  const joinedName = sanitizeText(meta.joinedName || "", NAME_LIMIT);
  const profile: WeddingGuestProfile = {
    displayName,
    updatedAt: meta.now || new Date().toISOString(),
  };
  if (photo) profile.photo = photo;
  if (bio) profile.bio = bio;
  if (links.length) profile.links = links;
  if (relationship) profile.relationship = relationship;
  if (side) profile.side = side;
  if (accountId) profile.accountId = accountId;
  if (joinedName) profile.joinedName = joinedName;
  return { ok: true, profile };
}

export function commitProfile(
  current: Record<string, WeddingGuestProfile> | undefined,
  key: string,
  profile: WeddingGuestProfile,
): Record<string, WeddingGuestProfile> | null {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return null;
  const next = { ...(current ?? {}) };
  if (profile.removed) {
    next[key] = { displayName: "", removed: true, updatedAt: profile.updatedAt || new Date().toISOString() };
    return next;
  }
  const displayName = sanitizeText(profile.displayName || "", NAME_LIMIT);
  if (!displayName) return null;
  let accountId = profile.accountId && isSenderId(profile.accountId) ? profile.accountId : "";
  if (accountId) {
    const taken = Object.entries(next).some(([other, row]) => other !== key && !row.removed && row.accountId === accountId);
    if (taken) accountId = "";
  }
  const stored: WeddingGuestProfile = { displayName, updatedAt: profile.updatedAt || new Date().toISOString() };
  const photo = cleanPhoto(profile.photo);
  if (photo) stored.photo = photo;
  const bio = sanitizeText(profile.bio || "", BIO_LIMIT);
  if (bio) stored.bio = bio;
  const links = cleanLinks(profile.links ?? []);
  if (links.length) stored.links = links;
  const relationship = sanitizeText(profile.relationship || "", NAME_LIMIT);
  if (relationship) stored.relationship = relationship;
  if (profile.side === "Bride" || profile.side === "Groom") stored.side = profile.side;
  if (accountId) stored.accountId = accountId;
  const joinedName = sanitizeText(profile.joinedName || "", NAME_LIMIT);
  if (joinedName) stored.joinedName = joinedName;
  next[key] = stored;
  return next;
}

export function mergeProfiles(
  current?: Record<string, WeddingGuestProfile>,
  incoming?: Record<string, WeddingGuestProfile>,
) {
  const left = current ?? {};
  const right = incoming ?? {};
  const out: Record<string, WeddingGuestProfile> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const a = left[key];
    const b = right[key];
    if (!a) {
      if (b) out[key] = b;
      continue;
    }
    if (!b) {
      out[key] = a;
      continue;
    }
    const at = Date.parse(a.updatedAt || "") || 0;
    const bt = Date.parse(b.updatedAt || "") || 0;
    out[key] = bt >= at ? b : a;
  }
  return out;
}

export function dropNamed(current: Record<string, WeddingGuestProfile> | undefined, name: string, now = new Date().toISOString()) {
  const target = name.trim().toLowerCase();
  const next = { ...(current ?? {}) };
  if (!target) return next;
  for (const [key, row] of Object.entries(next)) {
    if (!row || row.removed) continue;
    const names = [row.displayName, row.joinedName ?? ""].map((value) => value.trim().toLowerCase());
    if (names.includes(target)) next[key] = { displayName: "", removed: true, updatedAt: now };
  }
  return next;
}

export function activeProfiles(map?: Record<string, WeddingGuestProfile>) {
  return Object.entries(map ?? {}).filter(([, profile]) => profile && !profile.removed && profile.displayName.trim());
}

export function profileForMessage(
  map: Record<string, WeddingGuestProfile> | undefined,
  author: string | undefined,
  authorId: string | undefined,
) {
  const list = activeProfiles(map);
  if (authorId) {
    const hit = list.find(([, profile]) => profile.accountId === authorId);
    if (hit) return { key: hit[0], profile: hit[1] };
  }
  const name = (author ?? "").trim().toLowerCase();
  if (!name) return null;
  const named = list.filter(([, profile]) => profile.displayName.trim().toLowerCase() === name);
  return named.length === 1 ? { key: named[0][0], profile: named[0][1] } : null;
}

export function localDayKey(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function chatSeparator(
  day: string,
  wedding: { date?: string; functions?: { name?: string; date?: string }[] },
  atmosphere: boolean,
  today = localDayKey(new Date().toISOString()),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  if (atmosphere && wedding.date && day === wedding.date) return "Wedding Day";
  const events = [...new Set(
    (wedding.functions ?? [])
      .filter((item) => item.date === day && (item.name || "").trim())
      .map((item) => (item.name || "").trim()),
  )].slice(0, 2);
  if (events.length) return events.join(" · ");
  if (day === today) return "Today";
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(year, month - 1, date));
}

export function weddingPhase(date: string | undefined, atmosphere: boolean, today = localDayKey(new Date().toISOString())) {
  if (!atmosphere || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unknown" as const;
  if (date === today) return "day" as const;
  return date < today ? "after" as const : "before" as const;
}

export async function storeAvatar(file: File, slug?: string): Promise<{ ok: true; src: string } | { ok: false; error: string }> {
  if (!file || file.size <= 0) return { ok: false, error: "That photo was empty." };
  if (file.size > PHOTO_MAX) return { ok: false, error: "Choose a photo under 8 MB." };
  const type = (file.type || "").toLowerCase();
  const named = /\.(jpe?g|png|webp|gif)$/i.test(file.name || "");
  if (type.startsWith("image/heic") || type.startsWith("image/heif") || /\.hei[cf]$/i.test(file.name || "")) {
    return { ok: false, error: "Save that picture as a JPG or PNG, then try again." };
  }
  if (type && !AVATAR_TYPES.has(type) && !named) return { ok: false, error: "Use a JPG, PNG, WebP, or GIF." };
  if (!type && !named) return { ok: false, error: "Use a JPG, PNG, WebP, or GIF." };
  if (!slug || !/^[a-z0-9-]{3,80}$/.test(slug)) return { ok: false, error: "Open a wedding before adding a profile photo." };
  try {
    const blob = await compressAvatar(file);
    const { uploadPreparedFile } = await import("./r2-upload.ts");
    const src = await uploadPreparedFile(new File([blob], "profile.jpg", { type: "image/jpeg" }), slug, "profile");
    return { ok: true, src };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/denied|notallowed|security/i.test(message)) return { ok: false, error: "Photo permission was denied." };
    if (message) return { ok: false, error: message };
    return { ok: false, error: "That photo could not be saved. Try another picture." };
  }
}

async function compressAvatar(file: File) {
  const bitmap = await loadBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare that photo.");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  if ("close" in bitmap) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob || blob.size <= 0) throw new Error("Could not prepare that photo.");
  return blob;
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* Fall through to an image element. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That photo could not be read."));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1;
    canvas.height = image.naturalHeight || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That photo could not be read.");
    ctx.drawImage(image, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
