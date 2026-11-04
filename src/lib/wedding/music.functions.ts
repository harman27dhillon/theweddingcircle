import { createServerFn } from "@tanstack/react-start";
import { MUSIC_MAX_BASE64 } from "@/lib/wedding/music-library";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Never slice audio. An oversized payload is rejected, not shortened. */
function audioField(value: unknown) {
  if (typeof value !== "string" || !value) return { data: "", tooBig: false };
  if (value.length > MUSIC_MAX_BASE64) return { data: "", tooBig: true };
  return { data: value, tooBig: false };
}

export const developerMusicList = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { developerSession } = await import("@/lib/developer/gate.server");
    const session = await developerSession(data.token);
    if (!session) return { ok: false as const, error: "Developer session required.", tracks: [], limit: 12 };
    const { listMusicTracks } = await import("@/lib/wedding/music-library.server");
    return listMusicTracks();
  });

export const developerMusicCreate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; title?: unknown; mime?: unknown; data?: unknown };
    const audio = audioField(body?.data);
    return { token: text(body?.token, 200), title: text(body?.title, 80), mime: text(body?.mime, 40), ...audio };
  })
  .handler(async ({ data }) => {
    if (data.tooBig) return { ok: false as const, error: "Keep each track under 1.8 MB." };
    const { createMusicTrack } = await import("@/lib/wedding/music-library.server");
    return createMusicTrack(data.token, data.title, data.mime, data.data);
  });

export const developerMusicReplace = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; title?: unknown; mime?: unknown; data?: unknown };
    const audio = audioField(body?.data);
    return {
      token: text(body?.token, 200),
      id: text(body?.id, 80),
      title: text(body?.title, 80),
      mime: text(body?.mime, 40),
      ...audio,
    };
  })
  .handler(async ({ data }) => {
    if (data.tooBig) return { ok: false as const, error: "Keep each track under 1.8 MB." };
    const { replaceMusicTrack } = await import("@/lib/wedding/music-library.server");
    return replaceMusicTrack(data.token, data.id, data.title, data.mime, data.data);
  });

export const developerMusicDelete = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80) };
  })
  .handler(async ({ data }) => {
    const { deleteMusicTrack } = await import("@/lib/wedding/music-library.server");
    return deleteMusicTrack(data.token, data.id);
  });
