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
    prompt: text(body.prompt, 80),
    text: text(body.text, 200),
    roundId: text(body.roundId, 40),
    statementId: text(body.statementId, 40),
    token: text(body.token, 40),
  };
}

export const startWhoSaidRound = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { startWhoSaid } = await import("./who-said.server");
    return startWhoSaid(data);
  });

export const submitWhoSaidLine = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { submitWhoSaid } = await import("./who-said.server");
    return submitWhoSaid(data);
  });

export const guessWhoSaidAuthor = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { guessWhoSaid } = await import("./who-said.server");
    return guessWhoSaid(data);
  });

export const lockWhoSaidRound = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { lockWhoSaid } = await import("./who-said.server");
    return lockWhoSaid(data);
  });

export const syncWhoSaidRound = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { syncWhoSaid } = await import("./who-said.server");
    return syncWhoSaid(data);
  });
