import { saveCircle, fetchCircle, findCircleByCode, deleteCircle, contributeCircle, syncCircle, readCircleAsMember, saveCardTheme, saveWeddingBar } from "@/lib/wedding/circle.functions";
import { circleKey, isDeletedSlug, rememberCircleKey, rememberDeletedSlug } from "@/lib/wedding/circle-key";
import { voiceAttachment } from "@/lib/wedding/capture";
import { codesOf, isSampleCircle, normalizeCode } from "@/lib/wedding/format";
import { cleanPhoto } from "./guest-profile.ts";
import { coupleAccessForPublish } from "@/lib/wedding/couple-access";
import { entryCodeFor, memberKeyFor, memberKeyList, rememberMemberKey } from "@/lib/wedding/member-key";
import { publishWeddingMedia } from "@/lib/wedding/media-sync";
import { useWeddingStore } from "@/lib/wedding/store";
import type { ChatMessage, FeedPost, FunctionEvent, Wedding } from "@/lib/wedding/types";
import { FREE_STORAGE_MESSAGE } from "@/lib/wedding/plan";

function shareable(value?: string) {
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return undefined;
  return value;
}

function packPost(post: FeedPost): FeedPost {
  const { delivery: _delivery, ...rest } = post;
  return {
    ...rest,
    images: post.images.map((src) => shareable(src) ?? "").filter(Boolean),
    videoLabel: shareable(post.videoLabel),
    videos: (post.videos ?? []).flatMap((clip) => {
      const src = shareable(clip.src);
      return src ? [{ src, seconds: clip.seconds }] : [];
    }),
    gallery: (post.gallery ?? []).flatMap((item) => {
      const src = shareable(item.src);
      if (!src || (item.kind !== "image" && item.kind !== "video")) return [];
      return [{ kind: item.kind, src, seconds: item.seconds }];
    }),
    audio: voiceAttachment(post.audio),
  };
}

function pack(wedding: Wedding): Wedding {
  const profiles = wedding.guestProfiles;
  const guestProfiles = profiles
    ? Object.fromEntries(
        Object.entries(profiles).flatMap(([key, profile]) => {
          if (!profile || typeof profile !== "object") return [];
          const photo = cleanPhoto(profile.photo);
          const next = { ...profile };
          if (photo) next.photo = photo;
          else delete next.photo;
          return [[key, next]];
        }),
      )
    : undefined;
  return {
    ...wedding,
    cover: shareable(wedding.cover) ?? "",
    coverVideo: shareable(wedding.coverVideo) ?? "",
    postingCodes: codesOf(wedding),
    coupleAccess: coupleAccessForPublish(wedding.coupleAccess),
    guestProfiles,
    posts: wedding.posts.map(packPost),
    chats: wedding.chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) => {
        const { delivery: _delivery, ...rest } = message;
        return {
          ...rest,
          video: shareable(message.video),
          image: shareable(message.image),
        };
      }),
    })),
    beforeNotes: (wedding.beforeNotes ?? []).map((item) => ({
      ...item,
      images: item.images.map((src) => shareable(src) ?? "").filter(Boolean),
      video: shareable(item.video),
    })),
  };
}

export async function pushCircle(wedding: Wedding): Promise<"ok" | "locked" | "offline"> {
  const editKey = circleKey(wedding.slug);
  if (!editKey || wedding.slug === "lila-nico") return "ok";
  if (isDeletedSlug(wedding.slug)) return "locked";
  try {
    const result = await saveCircle({ data: { slug: wedding.slug, editKey, payload: pack(wedding) } });
    if (result.ok) {
      publishWeddingMedia(wedding);
      return "ok";
    }
    if (result.error === "storage") {
      const { toast } = await import("sonner");
      toast(FREE_STORAGE_MESSAGE);
    }
    return "locked";
  } catch {
    return "offline";
  }
}

/** Writes only the shared theme. Success means the server stored this themeRev. */
export async function pushCardTheme(wedding: Wedding): Promise<"ok" | "denied" | "stale" | "offline"> {
  if (isSampleCircle(wedding) || wedding.slug === "lila-nico") return "denied";
  if (!wedding.cardTheme || !Number(wedding.themeRev)) return "denied";
  const editKey = circleKey(wedding.slug);
  const memberKey = memberKeyFor(wedding.slug);
  if (!editKey && !memberKey) return "denied";
  try {
    const result = await saveCardTheme({
      data: {
        slug: wedding.slug,
        editKey,
        memberKey,
        cardTheme: wedding.cardTheme,
        themeRev: wedding.themeRev,
      },
    });
    if (result.ok && result.cardTheme === wedding.cardTheme) return "ok";
    if (result.error === "denied") return "denied";
    if (result.error === "stale") return "stale";
    return "offline";
  } catch {
    return "offline";
  }
}

/** Writes only the wedding bar. The server allows the host key or a host/co-host member key. */
export async function pushWeddingBar(wedding: Wedding): Promise<"ok" | "denied" | "offline"> {
  if (isSampleCircle(wedding) || wedding.slug === "lila-nico") return "denied";
  const editKey = circleKey(wedding.slug);
  const memberKey = memberKeyFor(wedding.slug);
  if (!editKey && !memberKey) return "denied";
  try {
    const result = await saveWeddingBar({
      data: { slug: wedding.slug, editKey, memberKey, bar: wedding.bar ?? null },
    });
    if (result.ok) return "ok";
    if (result.error === "denied") return "denied";
    return "offline";
  } catch {
    return "offline";
  }
}

export async function loadCircle(slug: string): Promise<Wedding | null> {
  if (slug === "lila-nico") return null;
  return fetchCircle({ data: slug });
}

export async function loadCircleByCode(code: string): Promise<Wedding | null> {
  return findCircleByCode({ data: normalizeCode(code) });
}

export type EraseStatus = "ok" | "denied" | "offline" | "partial";

export async function eraseCircle(wedding: Wedding, keepMedia = false): Promise<{ status: EraseStatus; message?: string }> {
  const editKey = circleKey(wedding.slug);
  if (!editKey || wedding.slug === "lila-nico") return { status: "denied" };
  try {
    const result = await deleteCircle({ data: { slug: wedding.slug, editKey, keepMedia } });
    if (!result.ok) {
      const remote = await fetchCircle({ data: wedding.slug });
      if (remote) return { status: "denied", message: "The host key on this phone does not match the saved wedding." };
      rememberDeletedSlug(wedding.slug);
      return { status: "ok" };
    }
    rememberDeletedSlug(wedding.slug);
    return { status: result.partial ? "partial" : "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message.trim().slice(0, 180) : "";
    return { status: "offline", message: message || undefined };
  }
}

const KEPT = "wc-kept";

export function readKept() {
  if (typeof localStorage === "undefined") return [] as { title: string; sources: string[] }[];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEPT) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const title = String((item as { title?: unknown }).title ?? "").trim().slice(0, 80);
      const sources = Array.isArray((item as { sources?: unknown }).sources)
        ? (item as { sources: unknown[] }).sources.filter((src): src is string => typeof src === "string" && src.length > 0 && !src.startsWith("blob:") && !src.startsWith("data:")).slice(0, 40)
        : [];
      return title ? [{ title, sources }] : [];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberKept(title: string, sources: string[]) {
  if (typeof localStorage === "undefined" || !title.trim()) return;
  const next = [{ title: title.trim().slice(0, 80), sources: sources.filter((src) => src && !src.startsWith("blob:") && !src.startsWith("data:")).slice(0, 40) }, ...readKept().filter((item) => item.title !== title.trim())];
  localStorage.setItem(KEPT, JSON.stringify(next.slice(0, 12)));
}

let restoreGeneration = 0;

export async function restoreMemberships() {
  const started = ++restoreGeneration;
  const refreshed: string[] = [];
  const start = useWeddingStore.getState();
  const email = start.account?.email?.trim().toLowerCase() ?? "";
  const phone = start.account?.phone ?? "";
  const name = start.account?.name ?? "";
  if (!email && !phone.replace(/\D/g, "")) return refreshed;
  let firebaseSession: { status: string; token?: string } = { status: "none" };
  if (typeof window === "undefined") {
    firebaseSession = { status: "unconfigured" };
  } else {
    try {
      const { currentIdToken } = await import("@/lib/wedding/firebase-auth.browser");
      firebaseSession = await currentIdToken(true);
    } catch {
      firebaseSession = { status: "none" };
    }
  }
  if (firebaseSession.status === "unverified" || firebaseSession.status === "error" || firebaseSession.status === "none") return refreshed;
  const { listMyCircles } = await import("@/lib/wedding/roles.functions");
  const listed = await listMyCircles({ data: { email, phone, memberKeys: memberKeyList(), accountId: start.account?.id || "" } });
  if (started !== restoreGeneration) return refreshed;
  const currentEmail = useWeddingStore.getState().account?.email?.trim().toLowerCase() ?? "";
  const currentPhone = useWeddingStore.getState().account?.phone ?? "";
  if (currentEmail !== email || currentPhone !== phone) return refreshed;
  if (!listed.ok) return refreshed;
  if (email) {
    useWeddingStore.setState((state) => ({
      memberships: state.memberships.filter((item) => {
        const memberEmail = (item.email || "").trim().toLowerCase();
        return !memberEmail || memberEmail === email;
      }),
    }));
  }
  const circles = listed.circles?.length
    ? listed.circles
    : listed.slugs.map((slug) => ({ slug, memberKey: "", name: "", role: "guest", editKey: "" }));
  for (const circle of circles) {
    if (started !== restoreGeneration) return refreshed;
    if ((useWeddingStore.getState().account?.email?.trim().toLowerCase() ?? "") !== email) return refreshed;
    if (!circle.slug || circle.slug === "lila-nico" || isDeletedSlug(circle.slug)) continue;
    try {
      const probe = await loadCircleSync(circle.slug);
      if (probe?.deleted) {
        useWeddingStore.getState().purgeDeletedCircle(circle.slug);
        continue;
      }
    } catch {
      /* The membership fetch below still decides whether this circle can be opened. */
    }
    if (circle.memberKey) rememberMemberKey(circle.slug, circle.memberKey);
    if (circle.editKey) rememberCircleKey(circle.slug, circle.editKey);
    const idToken = firebaseSession.status === "token" ? firebaseSession.token || "" : "";
    const remote = circle.memberKey || idToken
      ? await readCircleAsMember({ data: { slug: circle.slug, memberKey: circle.memberKey, idToken } })
      : await fetchCircle({ data: circle.slug });
    if (started !== restoreGeneration) return refreshed;
    if ((useWeddingStore.getState().account?.email?.trim().toLowerCase() ?? "") !== email) return refreshed;
    if (remote && typeof remote === "object" && "circleAccess" in remote && remote.circleAccess === "denied") continue;
    if (remote && "slug" in remote && "id" in remote) {
      const known = useWeddingStore.getState().weddings.some((item) => item.slug === remote.slug || item.id === remote.id);
      if (known) useWeddingStore.getState().applyRemoteCircle(remote);
      else useWeddingStore.getState().adoptCircle(remote);
    }
    useWeddingStore.getState().rememberMembership({
      slug: circle.slug,
      email,
      name: circle.name || name,
      role: circle.role || "guest",
      accountId: start.account?.id || "",
    });
    refreshed.push(circle.slug);
  }
  return refreshed;
}

let openSync: Promise<void> | null = null;
let openSyncAfter = 0;

/** Pull authorized wedding updates when the app opens or returns. Does not block the screen or move media bytes. */
export function syncOpenApp() {
  if (typeof window === "undefined") return Promise.resolve();
  if (openSync) return openSync;
  if (Date.now() < openSyncAfter) return Promise.resolve();
  openSync = (async () => {
    if (!navigator.onLine) return;
    const { flushOutbox } = await import("@/lib/wedding/offline-sync");
    await flushOutbox();
    const refreshed = new Set(await restoreMemberships());
    const slugs = useWeddingStore.getState().weddings
      .map((item) => item.slug)
      .filter((slug) => slug && slug !== "lila-nico" && !refreshed.has(slug))
      .slice(0, 8);
    for (const slug of slugs) {
      if (!navigator.onLine) return;
      const result = await loadCircleSync(slug).catch(() => null);
      if (result?.deleted) {
        useWeddingStore.getState().purgeDeletedCircle(slug);
        continue;
      }
      const remote = result?.wedding;
      if (!remote) continue;
      if (useWeddingStore.getState().weddings.some((item) => item.slug === remote.slug)) {
        useWeddingStore.getState().applyRemoteCircle(remote);
      }
    }
  })().catch(() => {
    openSyncAfter = Date.now() + 15000;
  }).finally(() => {
    openSync = null;
  });
  return openSync;
}

export function startCircleSync() {
  let timer = 0;
  return useWeddingStore.subscribe((state, previous) => {
    if (state.weddings === previous.weddings) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      for (const wedding of useWeddingStore.getState().weddings) {
        if (!circleKey(wedding.slug)) continue;
        const before = previous.weddings.find((item) => item.id === wedding.id);
        if (before && themeFieldsOnly(before, wedding)) continue;
        void pushCircle(wedding);
      }
    }, 700);
  });
}

function themeFieldsOnly(before: Wedding, after: Wedding) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let moved = false;
  for (const key of keys) {
    const left = before[key as keyof Wedding];
    const right = after[key as keyof Wedding];
    if (left === right) continue;
    if (key === "cardTheme" || key === "rev" || key === "themeRev") {
      moved = true;
      continue;
    }
    return false;
  }
  return moved;
}

function memberFor(slug: string) {
  let key = memberKeyFor(slug);
  if (!key) {
    key = crypto.randomUUID().replace(/-/g, "");
    rememberMemberKey(slug, key);
  }
  return key;
}

export async function loadCircleSync(slug: string) {
  if (slug === "lila-nico") return null;
  return syncCircle({ data: { slug, memberKey: memberKeyFor(slug) } });
}

type Activity =
  | { action: "post"; post: FeedPost }
  | { action: "comment"; postId: string; comment: ChatMessage }
  | { action: "chat"; chatId: string; message: ChatMessage }
  | { action: "remove-post"; postId: string }
  | { action: "remove-message"; chatId: string; messageId: string }
  | { action: "save-function"; fn: FunctionEvent }
  | { action: "remove-function"; functionId: string }
  | { action: "profile"; profile: Record<string, unknown> | null; remove?: boolean }
  | { action: "react"; postId: string; kind: "love" | "joy" | "bless" }
  | { action: "atmosphere"; enabled: boolean }
  | { action: "drop-profile"; guestName: string };

export async function pushActivity(wedding: Wedding, name: string, activity: Activity): Promise<"ok" | "failed" | "local" | "offline" | "denied"> {
  if (isSampleCircle(wedding)) return "local";
  try {
    const result = await contributeCircle({
      data: {
        slug: wedding.slug,
        action: activity.action,
        name,
        memberKey: memberFor(wedding.slug),
        code: entryCodeFor(wedding.slug),
        editKey: circleKey(wedding.slug),
        scope: "",
        active: false,
        post: activity.action === "post" ? activity.post : undefined,
        postId: "postId" in activity ? activity.postId : "",
        comment: activity.action === "comment" ? activity.comment : undefined,
        chatId: "chatId" in activity ? activity.chatId : "",
        message: activity.action === "chat" ? activity.message : undefined,
        messageId: activity.action === "remove-message" ? activity.messageId : "",
        fn: activity.action === "save-function" ? activity.fn : undefined,
        functionId: activity.action === "remove-function" ? activity.functionId : "",
        profile: activity.action === "profile" ? activity.profile : undefined,
        remove: activity.action === "profile" ? Boolean(activity.remove) : false,
        kind: activity.action === "react" ? activity.kind : "",
        enabled: activity.action === "atmosphere" ? activity.enabled : false,
        guestName: activity.action === "drop-profile" ? activity.guestName : "",
      },
    });
    return result.ok ? "ok" : /join this wedding|not on the circle|before sharing/i.test(String(result.error || "")) ? "denied" : "failed";
  } catch {
    return "offline";
  }
}

export function signalTyping(slug: string, name: string, scope: string, active: boolean) {
  if (!slug || slug === "lila-nico" || !name.trim()) return;
  const key = memberKeyFor(slug) || memberFor(slug);
  void contributeCircle({
    data: {
      slug,
      action: "typing",
      name,
      memberKey: key,
      code: entryCodeFor(slug),
      editKey: circleKey(slug),
      scope,
      active,
      postId: "",
      chatId: "",
      messageId: "",
    },
  }).catch(() => undefined);
}
