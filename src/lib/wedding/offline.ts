import { isDeletedSlug } from "./circle-key.ts";
import { expiryPhase } from "./lifecycle.ts";
import { parseR2Ref } from "./r2-ref.ts";
import type { Account, ChatMessage, ChatRoom, Wedding } from "@/lib/wedding/types";

export const SHELL_VERSION = "v8";
export const SHELL_CACHE = "wc-precache-v8";
export const MESSAGE_KEEP = 400;
export const OUTBOX_ATTEMPTS = 5;

export type ShellPolicy = "bypass" | "navigate" | "static" | "immutable" | "fresh";

const PRIVATE_PREFIXES = ["/api", "/_server", "/auth", "/src/", "/@", "/node_modules/", "/.vite", "/__vite"];
const WORKER_SCRIPTS = new Set(["/wedding-shell-sw.js", "/firebase-messaging-sw.js"]);
const UI_PREFIXES = ["/card-themes/", "/covers/", "/flora/", "/__grok/"];

/** Hashed Vite output. The URL changes when the file changes, so cache-first is safe. */
export function immutableAsset(pathname: string) {
  return /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(pathname);
}

/** Service-worker fetch policy. Private, live, upload, and media requests are never cached. */
export function shellRequestPolicy(method: string, pathname: string): ShellPolicy {
  if (method !== "GET" && method !== "HEAD") return "bypass";
  const path = (pathname || "/").split("?")[0] || "/";
  if (path.includes("..")) return "bypass";
  if (WORKER_SCRIPTS.has(path)) return "bypass";
  if (PRIVATE_PREFIXES.some((item) => path === item || path.startsWith(item))) return "bypass";
  if (/\.(?:mp4|webm|mov|m4v|m3u8|ts|wav|mp3|ogg|aac)$/i.test(path)) return "bypass";
  if (path.startsWith("/media/") || path.startsWith("/theme-music/")) return "bypass";
  if (immutableAsset(path)) return "immutable";
  if (/\.(?:js|mjs|css)$/i.test(path) && path.startsWith("/assets/")) return "fresh";
  if (/\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|ico)$/i.test(path)) {
    if (path.startsWith("/assets/") || path === "/favicon.svg" || path === "/og.jpg" || path === "/who-said-trophy.png" || UI_PREFIXES.some((item) => path.startsWith(item))) return "static";
    return "bypass";
  }
  return "navigate";
}

/** A hashed asset response may be stored only when it is a real 200 file, never an HTML shell. */
export function shellAssetCacheable(status: number, contentType: string, setCookie = false) {
  if (status !== 200 || setCookie) return false;
  const type = contentType.toLowerCase();
  if (!type || type.includes("text/html")) return false;
  return type.includes("javascript") || type.includes("ecmascript") || type.includes("text/css") || type.includes("image/") || type.includes("font/") || type.includes("application/json") || type.includes("wasm");
}

/** Offline navigation may replay only this exact address. Another route's HTML is never a substitute. */
export function shellOfflineDocument(hasExact: boolean) {
  return hasExact ? "exact" : "offline-shell";
}

export function shellDocumentCacheable(input: { contentType: string; setCookie: boolean; bytes: number; body: string }) {
  if (input.setCookie) return false;
  const type = input.contentType.toLowerCase();
  if (!type.includes("text/html")) return false;
  if (input.bytes <= 0 || input.bytes > 700000) return false;
  const sample = input.body.slice(0, 12000).toLowerCase();
  if (sample.includes("access_token") || sample.includes("refresh_token") || sample.includes("service_role") || sample.includes("authorization: bearer")) return false;
  if (!sample.includes(`wc-shell-${SHELL_VERSION}`)) return false;
  return true;
}

export function ownerScope(account: Pick<Account, "email" | "phone"> | null | undefined) {
  const email = account?.email?.trim().toLowerCase() || "";
  const phone = (account?.phone || "").replace(/\s/g, "");
  if (email) return `email:${email}`.slice(0, 180);
  if (phone) return `phone:${phone}`.slice(0, 180);
  return "device";
}

export function cacheVisible(recordOwner: string, currentOwner: string) {
  return Boolean(recordOwner) && recordOwner === currentOwner;
}

/** A phone copy may refill an open circle. Deleted and fully expired circles stay gone. */
export function snapshotRestorable(
  wedding: { id?: string; slug?: string; expiresAt?: string | null; mediaRetentionUntil?: string | null } | null | undefined,
  nowMs: number,
) {
  if (!wedding?.id) return false;
  if (isDeletedSlug(wedding.slug || "") || isDeletedSlug(wedding.id)) return false;
  return expiryPhase(wedding, nowMs) !== "ended";
}

export function safeMediaRef(value: unknown) {
  if (typeof value !== "string") return "";
  const src = value.trim();
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.length > 400) return "";
  if (src.startsWith("idb:") && /^idb:[0-9a-f-]{36}$/i.test(src)) return src;
  if (src.startsWith("gp:") && src.length < 200 && !src.includes("..") && !src.includes("\\")) return src;
  if (parseR2Ref(src)) return src;
  if (src.startsWith("/") && !src.includes("..")) return src.slice(0, 240);
  if (/^https:\/\//i.test(src)) return src.slice(0, 400);
  return "";
}

/** A cache copy. Invite codes, couple codes, media keys and payments are omitted. */
export function snapshotWedding(wedding: Wedding): Wedding {
  const chats: ChatRoom[] = (wedding.chats ?? []).slice(0, 40).map((chat) => ({
    id: chat.id,
    name: chat.name,
    hint: chat.hint,
    closed: chat.closed,
    messages: (chat.messages ?? []).filter((message) => message?.id).slice(-MESSAGE_KEEP).map((message) => ({
      id: message.id,
      author: message.author,
      text: String(message.text || "").slice(0, 4000),
      atLabel: message.atLabel,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.removed ? { removed: true } : {}),
      ...(message.delivery === "pending" ? { delivery: "pending" as const } : {}),
      ...(safeMediaRef(message.image) ? { image: safeMediaRef(message.image) } : {}),
      ...(safeMediaRef(message.video) ? { video: safeMediaRef(message.video) } : {}),
    })),
  }));
  return {
    ...wedding,
    cover: safeMediaRef(wedding.cover),
    coverVideo: safeMediaRef(wedding.coverVideo),
    postingCodes: [],
    mediaKey: undefined,
    payment: undefined,
    coupleAccess: wedding.coupleAccess
      ? {
          bride: wedding.coupleAccess.bride,
          groom: wedding.coupleAccess.groom,
        }
      : undefined,
    chats,
    posts: (wedding.posts ?? []).slice(0, 80).map((post) => ({
      ...post,
      images: (post.images ?? []).map((src) => safeMediaRef(src)).filter(Boolean),
      delivery: undefined,
    })),
  };
}

const SHELL_POSTS = 24;
const SHELL_CHATS = 8;
const SHELL_MESSAGES = 20;

/** Small localStorage copy. Full threads stay in IndexedDB and on the server. */
export function shellWedding(wedding: Wedding): Wedding {
  return {
    ...wedding,
    cover: safeMediaRef(wedding.cover),
    coverVideo: safeMediaRef(wedding.coverVideo),
    posts: (wedding.posts ?? []).slice(-SHELL_POSTS).map((post) => ({
      ...post,
      text: String(post.text || "").slice(0, 500),
      images: (post.images ?? []).map((src) => safeMediaRef(src)).filter(Boolean).slice(0, 4),
      videos: (post.videos ?? []).flatMap((clip) => {
        const src = safeMediaRef(clip?.src);
        return src ? [{ src, seconds: clip.seconds }] : [];
      }).slice(0, 1),
      gallery: (post.gallery ?? []).flatMap((item) => {
        const src = safeMediaRef(item?.src);
        if (!src || (item.kind !== "image" && item.kind !== "video")) return [];
        return [{ kind: item.kind, src }];
      }).slice(0, 4),
      audio: post.audio && safeMediaRef(post.audio.src) ? { src: safeMediaRef(post.audio.src), seconds: post.audio.seconds } : undefined,
    })),
    chats: (wedding.chats ?? []).slice(0, SHELL_CHATS).map((chat) => ({
      ...chat,
      messages: (chat.messages ?? []).slice(-SHELL_MESSAGES).map((message) => ({
        ...message,
        text: String(message.text || "").slice(0, 500),
        image: safeMediaRef(message.image) || undefined,
        video: safeMediaRef(message.video) || undefined,
      })),
    })),
    beforeNotes: (wedding.beforeNotes ?? []).slice(-12).map((item) => ({
      ...item,
      images: (item.images ?? []).map((src) => safeMediaRef(src)).filter(Boolean).slice(0, 2),
      video: safeMediaRef(item.video) || undefined,
    })),
  };
}

export function mergePendingMessages(server: ChatMessage[], pending: ChatMessage[]) {
  const seen = new Set(server.map((message) => message.id));
  const waiting = pending
    .filter((message) => message?.id && !seen.has(message.id))
    .map((message) => ({ ...message, delivery: "pending" as const }));
  return { messages: [...server, ...waiting], stillPending: waiting };
}

export function decideFlush(input: { online: boolean; attempts: number; denied: boolean }) {
  if (input.denied) return "drop-denied" as const;
  if (!input.online) return "wait" as const;
  if (input.attempts >= OUTBOX_ATTEMPTS) return "give-up" as const;
  return "send" as const;
}

export function duplicateMessageIds(payloads: unknown[]) {
  const dupes: string[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const chats = (payload as { chats?: unknown }).chats;
    if (!Array.isArray(chats)) continue;
    const seen = new Set<string>();
    for (const chat of chats) {
      const messages = (chat as { messages?: unknown })?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const id = (message as { id?: unknown })?.id;
        if (typeof id !== "string" || !id) continue;
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
      }
    }
  }
  return dupes.slice(0, 20);
}
