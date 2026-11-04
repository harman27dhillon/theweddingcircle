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
    parentPostId: text(body.parentPostId, 80),
    recipientKey: text(body.recipientKey, 64),
    body: text(body.body, 500),
    replyTo: text(body.replyTo, 40),
    whisperId: text(body.whisperId, 40),
  };
}

export const listWhispers = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { listWhispersFor } = await import("./whisper.server");
  return listWhispersFor(data);
});

export const sendWhisper = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { sendWhisperFor } = await import("./whisper.server");
  return sendWhisperFor(data);
});

export const revealWhisper = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { revealWhisperFor } = await import("./whisper.server");
  return revealWhisperFor(data);
});

export const deleteWhisper = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { deleteWhisperFor } = await import("./whisper.server");
  return deleteWhisperFor(data);
});
