import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

const ACTIONS = new Set(["token", "roster", "leave", "beat"]);

function input(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const action = text(body.action, 20);
  return {
    slug: text(body.slug, 80).trim().toLowerCase(),
    memberKey: text(body.memberKey, 64),
    editKey: text(body.editKey, 80),
    name: text(body.name, 80),
    action: ACTIONS.has(action) ? action : "",
    publish: body.publish === true,
    connectionId: text(body.connectionId, 36),
  };
}

async function run(data: ReturnType<typeof input>) {
  const { runVoice } = await import("./voice-chat.server");
  return runVoice(data);
}

export const issueVoiceToken = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => run({ ...data, action: "token" }));

export const readVoiceRoster = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => run({ ...data, action: "roster" }));

export const leaveVoiceRoom = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => run({ ...data, action: "leave" }));

export const beatVoiceSession = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => run({ ...data, action: "beat" }));
