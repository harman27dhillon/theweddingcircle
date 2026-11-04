import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 80) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const weddingLive = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as {
      action?: unknown;
      slug?: unknown;
      peerId?: unknown;
      name?: unknown;
      code?: unknown;
      codes?: unknown;
      to?: unknown;
      kind?: unknown;
      payload?: unknown;
      after?: unknown;
      text?: unknown;
      memberKey?: unknown;
      access?: unknown;
      roster?: unknown;
      stream?: unknown;
      watch?: unknown;
    };
    const codes = Array.isArray(body?.codes) ? body.codes.filter((item): item is string => typeof item === "string").slice(0, 12).map((item) => item.slice(0, 80)) : [];
    return {
      action: text(body?.action, 20),
      slug: text(body?.slug, 80),
      peerId: text(body?.peerId, 80),
      name: text(body?.name, 80),
      code: text(body?.code, 80),
      codes,
      to: text(body?.to, 80),
      kind: text(body?.kind, 20),
      payload: body?.payload ?? null,
      after: typeof body?.after === "number" && body.after > 0 ? Math.floor(body.after) : 0,
      text: text(body?.text, 240),
      memberKey: text(body?.memberKey, 64),
      access: text(body?.access, 500),
      roster: text(body?.roster, 8000),
      stream: text(body?.stream, 80),
      watch: text(body?.watch, 400),
    };
  })
  .handler(async ({ data }) => {
    const { liveRoom } = await import("@/lib/wedding/live-room.server");
    return liveRoom(data);
  });
