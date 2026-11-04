import { circleKey } from "@/lib/wedding/circle-key";
import { deleteMediaBlob } from "@/lib/wedding/media-db";
import { forgetSharedMedia, shareStoredMedia } from "@/lib/wedding/media-sync";
import { pushCircle } from "@/lib/wedding/publish";
import { useWeddingStore } from "@/lib/wedding/store";
import type { AccessRule, Side } from "@/lib/wedding/types";

const sendingIds = new Set<string>();

export async function publishVoiceNote(input: {
  weddingId: string;
  author: string;
  circle: string;
  side?: Side;
  functionId?: string;
  accessRule?: AccessRule;
  blob: Blob;
  seconds: number;
  src?: string;
}) {
  const key = `${input.weddingId}:${input.src || input.blob.size}:${input.seconds}`;
  if (sendingIds.has(key)) return { ok: false, error: "That voice note is already sending.", src: input.src };
  if (input.seconds < 1 || input.blob.size < 200) return { ok: false, error: "That recording was too short.", src: input.src };
  if (input.blob.size > 8_000_000) return { ok: false, error: "That voice note is too large to send.", src: input.src };
  sendingIds.add(key);
  let src = input.src || "";
  try {
    const { saveMediaBlob } = await import("@/lib/wedding/media-db");
    if (!src) src = await saveMediaBlob(input.blob);
    const state = useWeddingStore.getState();
    const wedding = state.weddings.find((item) => item.id === input.weddingId);
    if (!wedding) return { ok: false, error: "That voice note could not be posted.", src };
    if (wedding.posts.some((post) => post.audio?.src === src && !post.removed)) return { ok: true, src };
    let shared = await shareStoredMedia(wedding, src);
    if (shared !== "shared" && circleKey(wedding.slug)) {
      const pushed = await pushCircle(wedding);
      if (pushed === "ok") shared = await shareStoredMedia(wedding, src);
    }
    if (shared === "failed") {
      return { ok: false, error: "That voice note could not be uploaded. It is still here — try again.", src };
    }
    const id = state.addPost(input.weddingId, {
      author: input.author,
      circle: input.circle,
      text: "",
      images: [],
      functionId: input.functionId,
      kind: "audio",
      audio: { src, seconds: input.seconds },
      side: input.side,
      accessRule: input.accessRule,
    });
    if (!id) {
      await forgetSharedMedia(wedding, src).catch(() => undefined);
      await deleteMediaBlob(src).catch(() => undefined);
      return { ok: false, error: "That voice note could not be posted.", src: "" };
    }
    return { ok: true, src };
  } catch {
    return { ok: false, error: "That voice note could not be sent. It is still here — try again.", src };
  } finally {
    sendingIds.delete(key);
  }
}
