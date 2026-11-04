import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const realtimeSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { action?: unknown; slug?: unknown; ceremonyId?: unknown; memberKey?: unknown; name?: unknown; peerId?: unknown };
    return {
      action: text(body?.action, 20),
      slug: text(body?.slug, 80),
      ceremonyId: text(body?.ceremonyId, 80),
      memberKey: text(body?.memberKey, 80),
      name: text(body?.name, 80),
      peerId: text(body?.peerId, 80),
    };
  })
  .handler(async ({ data }) => {
    const { runRealtimeSession } = await import("@/lib/infra/realtime.server");
    return runRealtimeSession(data);
  });
