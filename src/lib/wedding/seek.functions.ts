import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function input(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    slug: text(body.slug, 80).trim().toLowerCase(),
    memberKey: text(body.memberKey, 64),
    editKey: text(body.editKey, 80),
    name: text(body.name, 80),
    text: text(body.text, 500),
    eventId: text(body.eventId, 80),
    turnId: text(body.turnId, 80),
  };
}

export const askSeek = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { askSeekMessage } = await import("./seek.server");
    return askSeekMessage(data);
  });

export const shareSeekReply = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { shareSeekMessage } = await import("./seek.server");
    return shareSeekMessage(data);
  });
