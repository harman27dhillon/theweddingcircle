import { circleKey } from "@/lib/wedding/circle-key";
import { saveCircleMediaPart } from "@/lib/wedding/circle.functions";
import { readMediaBlob } from "@/lib/wedding/media-db";
import type { Wedding } from "@/lib/wedding/types";

const RAW = 600_000;
const MAX_REMOTE = 20 * 1024 * 1024;
const done = new Set<string>();
const jobs = new Map<string, Promise<void>>();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

function refsOf(wedding: Wedding) {
  const refs: string[] = [];
  const push = (value?: string) => {
    if (value?.startsWith("idb:")) refs.push(value);
  };
  push(wedding.cover);
  push(wedding.coverVideo);
  for (const post of wedding.posts) {
    post.images.forEach(push);
    push(post.videoLabel);
    post.videos?.forEach((clip) => push(clip.src));
    push(post.audio?.src);
  }
  for (const chat of wedding.chats) {
    for (const message of chat.messages) {
      push(message.image);
      push(message.video);
    }
  }
  for (const item of wedding.beforeNotes ?? []) {
    item.images.forEach(push);
    push(item.video);
  }
  for (const profile of Object.values(wedding.guestProfiles ?? {})) {
    push(profile?.photo);
  }
  return refs;
}

async function uploadRef(slug: string, ref: string, editKey: string, mediaKey: string): Promise<"ok" | "missing" | "denied"> {
  const blob = await readMediaBlob(ref);
  if (!blob || blob.size <= 0 || blob.size > MAX_REMOTE) return "missing";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const total = Math.max(1, Math.ceil(bytes.byteLength / RAW));
  const id = ref.slice(4);
  const mime = blob.type || "application/octet-stream";
  for (let idx = 0; idx < total; idx += 1) {
    const slice = bytes.subarray(idx * RAW, Math.min(bytes.byteLength, (idx + 1) * RAW));
    const saved = await saveCircleMediaPart({
      data: {
        slug,
        id,
        mime,
        idx,
        total,
        data: bytesToBase64(slice),
        editKey,
        mediaKey,
      },
    });
    if (!saved.ok) {
      if (saved.error === "storage") {
        const { toast } = await import("sonner");
        const { FREE_STORAGE_MESSAGE } = await import("./plan.ts");
        toast(FREE_STORAGE_MESSAGE);
      }
      return "denied";
    }
  }
  return "ok";
}

export async function shareStoredMedia(wedding: Wedding, ref: string): Promise<"shared" | "local" | "failed"> {
  if (!ref.startsWith("idb:")) return "failed";
  if (!wedding.slug || wedding.slug === "lila-nico" || wedding.illustrated) return "local";
  const editKey = circleKey(wedding.slug);
  const mediaKey = wedding.mediaKey ?? "";
  if (editKey.length < 16 && mediaKey.length < 16) return "local";
  const id = ref.slice(4);
  if (done.has(id)) return "shared";
  const result = await uploadRef(wedding.slug, ref, editKey, mediaKey).catch(() => "denied" as const);
  if (result !== "ok") return "failed";
  done.add(id);
  return "shared";
}

export async function forgetSharedMedia(wedding: Wedding, ref: string) {
  if (!ref.startsWith("idb:")) return;
  const id = ref.slice(4);
  done.delete(id);
  const { deleteCircleMedia } = await import("@/lib/wedding/circle.functions");
  await deleteCircleMedia({
    data: { slug: wedding.slug, id, editKey: circleKey(wedding.slug), mediaKey: wedding.mediaKey ?? "" },
  }).catch(() => undefined);
}

export function publishWeddingMedia(wedding: Wedding) {
  if (!wedding.slug || wedding.slug === "lila-nico" || wedding.illustrated) return;
  const editKey = circleKey(wedding.slug);
  const mediaKey = wedding.mediaKey ?? "";
  if (editKey.length < 16 && mediaKey.length < 16) return;
  for (const ref of refsOf(wedding)) {
    const id = ref.slice(4);
    if (done.has(id) || jobs.has(id)) continue;
    const job = uploadRef(wedding.slug, ref, editKey, mediaKey)
      .then((result) => {
        if (result === "ok") done.add(id);
      })
      .catch((error) => {
        console.warn("Saved on this phone. Sharing with the circle will retry.", error);
      })
      .finally(() => {
        jobs.delete(id);
      });
    jobs.set(id, job);
  }
}
