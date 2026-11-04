import type { Guest, Role, Viewer, Wedding } from "@/lib/wedding/types";
import { circleKey } from "./circle-key.ts";
import { SEED_ID } from "./seed.ts";

export type BadgeKind = "gold" | "silver" | "diamond" | "bronze";

export function uid() {
  return crypto.randomUUID();
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim();
}

export function coupleTitle(w: { bride: string; groom: string }) {
  return `${firstName(w.groom)} & ${firstName(w.bride)}`;
}

export function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
}

export function nowLabel() {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date());
}

export function todayISO() {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${n.getFullYear()}-${m}-${d}`;
}

export function slugify(bride: string, groom: string) {
  const base = `${groom}-${bride}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base.slice(0, 48) || "wedding";
}

export function attendingCount(guests: Guest[]) {
  return guests.filter((g) => g.rsvp === "yes" && !g.blocked).reduce((sum, g) => sum + g.count, 0);
}

export function headcount(guests: Guest[]) {
  return guests.reduce((sum, g) => sum + g.count, 0);
}

export function isSampleCircle(w: { illustrated?: boolean; id?: string; slug?: string }) {
  return Boolean(w.illustrated) || w.id === SEED_ID || w.slug === "lila-nico";
}

export function isCircleOwner(w: { slug?: string; illustrated?: boolean; id: string }) {
  if (!w.slug || isSampleCircle({ ...w, slug: w.slug || "" })) return false;
  return Boolean(circleKey(w.slug));
}

/** Typed wedding name must match the title, ignoring case and repeated spaces. */
export function confirmWeddingName(typed: string, title: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const expected = normalize(title);
  return expected.length > 0 && normalize(typed) === expected;
}

export function visibleCircles(
  weddings: Wedding[],
  memberships: { slug: string; email?: string; role?: string }[],
  accountName: string,
  accountEmail: string,
) {
  const email = accountEmail.trim().toLowerCase();
  const name = accountName.trim().toLowerCase();
  return weddings.filter((wedding) => {
    if (isSampleCircle(wedding)) return false;
    const owner = (wedding.ownerEmail || "").trim().toLowerCase();
    const membership = memberships.find((item) => {
      if (item.slug !== wedding.slug) return false;
      const memberEmail = (item.email || "").trim().toLowerCase();
      return !email || !memberEmail || memberEmail === email;
    });
    if (membership) {
      const hostClaim = membership.role === "host";
      if (!(hostClaim && email && owner && owner !== email)) return true;
    }
    if (circleKey(wedding.slug) && (!email || !owner || owner === email)) return true;
    if (email && owner === email) return true;
    if (!name || !Array.isArray(wedding.guests)) return false;
    return wedding.guests.some((guest) => guest.joined && !guest.blocked && guest.name.trim().toLowerCase() === name);
  });
}

export function roleLabel(viewer: { coded?: boolean; role: Role }) {
  if (viewer.coded && viewer.role === "guest") return "Family";
  if (viewer.role === "cohost") return "Co-host";
  if (viewer.role === "host") return "Host";
  if (viewer.role === "planner") return "Planner";
  return "Guest";
}

function codeTail(slug: string) {
  const raw = slug.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
  return (raw + "WXYZ").slice(0, 4);
}

export function compactCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Pull a circle code out of typed, pasted, or labeled text. */
export function normalizeCode(input: string) {
  const upper = input.trim().toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-").replace(/\b(FAMILY|GUEST)\s+([A-Z0-9]{3,})\b/g, "$1-$2");
  const tokens = upper.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) ?? [];
  const preferred =
    [...tokens].reverse().find((token) => /^(FAMILY|GUEST)-[A-Z0-9]{3,}$/.test(token)) ??
    [...tokens].reverse().find((token) => token.includes("-") && token.replace(/-/g, "").length >= 4) ??
    [...tokens].reverse().find((token) => token.length >= 4);
  return preferred ?? "";
}

export function codesOf(w: { slug: string; postingCodes?: { id?: string; code?: string; kind?: string }[] | null }) {
  const raw = Array.isArray(w.postingCodes) ? w.postingCodes : [];
  const list = raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const code = normalizeCode(typeof item.code === "string" ? item.code : "");
    if (code.length < 4) return [];
    const kind = String(item.kind ?? "").toLowerCase() === "guest" ? "guest" as const : "family" as const;
    return [{ id: typeof item.id === "string" && item.id ? item.id : code, code, kind }];
  });
  if (!list.some((item) => item.kind === "family")) list.unshift({ id: `family-${w.slug}`, code: `FAMILY-${codeTail(w.slug)}`, kind: "family" as const });
  if (!list.some((item) => item.kind === "guest")) list.push({ id: `guest-${w.slug}`, code: `GUEST-${codeTail(w.slug)}`, kind: "guest" as const });
  return list;
}

export function codeMatch(w: Wedding, code: string) {
  const clean = normalizeCode(code);
  if (!clean) return undefined;
  const compact = compactCode(clean);
  const hit = codesOf(w).find((item) => item.code === clean || compactCode(item.code) === compact);
  if (hit) return hit;
  if (w.slug && (w.slug.toUpperCase() === clean || compactCode(w.slug) === compact)) {
    return { id: `link-${w.slug}`, code: w.slug.toUpperCase(), kind: "guest" as const };
  }
  return undefined;
}

export function canPost(w: Wedding, viewer: Viewer) {
  if (isSampleCircle(w)) return false;
  if (viewer.weddingId !== w.id || !viewer.name.trim()) return false;
  return viewer.role === "host" || viewer.role === "cohost" || viewer.role === "guest" || viewer.role === "planner";
}

export function canAnnounce(w: Wedding, viewer: Viewer) {
  return canContribute(w, viewer);
}

export function canManage(w: Wedding, viewer: Viewer) {
  if (isSampleCircle(w)) return false;
  return viewer.role === "host" || isCohost(w, viewer);
}

/** Camera broadcast. Family is stored as a coded guest on this phone; the server still checks the member role. */
export function canBroadcast(w: Wedding, viewer: Viewer) {
  if (isSampleCircle(w)) return false;
  if (viewer.weddingId !== w.id || !viewer.name.trim()) return false;
  if (viewer.role === "host" || viewer.role === "cohost") return true;
  return viewer.role === "guest" && Boolean(viewer.coded);
}

export function canHost(viewer: { role: Role }) {
  return viewer.role === "host";
}

export function canPlan(w: Wedding, viewer: Viewer) {
  if (isSampleCircle(w)) return false;
  return viewer.role === "host" || viewer.role === "planner" || isCohost(w, viewer);
}

export function canDownload(w: Wedding, role: Role) {
  return role === "host" || role === "cohost" || w.privacy.download;
}

export function isCohost(_w: Wedding, viewer: { role: Role }) {
  return viewer.role === "cohost";
}

export function canContribute(w: Wedding, viewer: Viewer) {
  if (isSampleCircle(w)) return false;
  if (viewer.role === "host" || viewer.role === "cohost") return true;
  if (viewer.coded) return true;
  return false;
}

export function googleMapsLink(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  const ok =
    host === "maps.google.com" ||
    host === "maps.app.goo.gl" ||
    (host === "google.com" && (path === "/maps" || path.startsWith("/maps/"))) ||
    (host === "goo.gl" && (path === "/maps" || path.startsWith("/maps/")));
  if (!ok) return "";
  return url.toString();
}

export function personMarks(wedding: Wedding, name: string): { crown: boolean; badge: BadgeKind } {
  const key = name.trim().toLowerCase();
  const crown = key === wedding.bride.trim().toLowerCase() || key === wedding.groom.trim().toLowerCase();
  if (key === wedding.hostName.trim().toLowerCase()) return { crown, badge: "gold" };
  if ((wedding.cohostNames ?? []).some((item) => item.toLowerCase() === key)) return { crown, badge: "silver" };
  const guest = wedding.guests.find((item) => item.name.toLowerCase() === key);
  if (guest?.contributor) return { crown, badge: "diamond" };
  return { crown, badge: "bronze" };
}

export function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

/** Time left until local midnight on the wedding date. A date with no clock stays at that midnight. */
export function weddingCountdown(iso: string, now = Date.now()) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d).getTime();
  if (!Number.isFinite(target)) return null;
  const left = target - now;
  if (left <= 0) return { done: true as const };
  const total = Math.floor(left / 1000);
  return {
    done: false as const,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function activityScore(w: Wedding) {
  let score = 0;
  const addText = (text?: string) => {
    if (text?.trim()) score += 2;
  };
  for (const post of w.posts ?? []) {
    if (post.removed) continue;
    addText(post.text);
    score += (post.images?.length ?? 0) * 4;
    const clips = (post.videos?.length ?? 0) || (post.videoLabel ? 1 : 0);
    score += clips * 6;
    if (post.audio?.src) score += 2;
  }
  for (const chat of w.chats ?? []) {
    for (const message of chat.messages ?? []) {
      addText(message.text);
      if (message.image) score += 4;
      if (message.video) score += 6;
    }
  }
  for (const note of w.liveNotes ?? []) {
    addText(note.text);
    if (note.image) score += 4;
    if (note.video) score += 6;
  }
  for (const note of w.beforeNotes ?? []) {
    addText(note.text);
    score += (note.images?.length ?? 0) * 4;
    if (note.video) score += 6;
  }
  score += (w.liveViewers ?? []).length;
  return score;
}

export function rsvpBuckets(guests: Guest[]) {
  const open = guests.filter((guest) => !guest.blocked);
  return {
    accepted: open.filter((guest) => guest.rsvp === "yes").length,
    maybe: open.filter((guest) => guest.rsvp === "maybe").length,
    declined: open.filter((guest) => guest.rsvp === "no").length,
    waiting: open.filter((guest) => guest.rsvp === "pending" || !guest.rsvp).length,
  };
}

export function assignedSide(w: Wedding, name: string, stored?: string): "Bride" | "Groom" | undefined {
  if (stored === "Bride" || stored === "Groom") return stored;
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  const side = w.guests.find((guest) => guest.name.trim().toLowerCase() === key)?.side;
  return side === "Bride" || side === "Groom" ? side : undefined;
}

export function sideTitle(side?: string) {
  if (side === "Bride") return "Bride's side";
  if (side === "Groom") return "Groom's side";
  return "";
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"]);

export function youtubeId(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return "";
  let id = "";
  if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
  else {
    const fromQuery = parsed.searchParams.get("v");
    if (fromQuery) id = fromQuery;
    else {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => part === "embed" || part === "live" || part === "shorts" || part === "v");
      if (marker >= 0) id = parts[marker + 1] ?? "";
    }
  }
  id = id.split(/[?&#]/)[0] ?? "";
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

export function youtubeLinkError(url: string) {
  if (!url.trim()) return "";
  if (youtubeId(url)) return "";
  return "Paste a full YouTube link, such as youtube.com/watch, youtu.be, or youtube.com/live. Playlists and other sites are not supported.";
}

export function cleanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function validPhone(value: string) {
  return /^\d{10}$/.test(cleanPhone(value));
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function hashPassword(password: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function compressImage(file: Blob, onProgress?: (percent: number) => void) {
  return new Promise<string>((resolve, reject) => {
    onProgress?.(8);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That photo could not be used."));
    reader.onload = () => {
      onProgress?.(35);
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const max = 2048;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("That photo could not be used."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        onProgress?.(90);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
        onProgress?.(100);
      };
      img.onerror = () => reject(new Error("That photo could not be used."));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
