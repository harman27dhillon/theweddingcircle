import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function input(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const options = Array.isArray(body.options) ? body.options.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  const optionIds = Array.isArray(body.optionIds) ? body.optionIds.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  return {
    slug: text(body.slug, 80).trim().toLowerCase(),
    memberKey: text(body.memberKey, 64),
    editKey: text(body.editKey, 80),
    name: text(body.name, 80),
    question: text(body.question, 140),
    options,
    optionIds,
    pollId: text(body.pollId, 40),
    label: text(body.label, 80),
    multiple: body.multiple === true,
    anonymous: body.anonymous === true,
    changeVotes: body.changeVotes !== false,
    addOptions: body.addOptions === true,
    results: text(body.results, 20),
    expiresAt: text(body.expiresAt, 40),
  };
}

export const listPolls = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { listPollsFor } = await import("./poll.server");
  return listPollsFor(data);
});

export const createPoll = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { createPollFor } = await import("./poll.server");
  return createPollFor(data);
});

export const votePoll = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { votePollFor } = await import("./poll.server");
  return votePollFor(data);
});

export const addPollOption = createServerFn({ method: "POST" }).validator(input).handler(async ({ data }) => {
  const { addPollOptionFor } = await import("./poll.server");
  return addPollOptionFor(data);
});
