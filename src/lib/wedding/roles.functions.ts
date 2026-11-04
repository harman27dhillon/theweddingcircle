import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 80) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function codes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 80)).slice(0, 20);
}

export const registerWeddingAuthority = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; editKey?: unknown; email?: unknown; name?: unknown; memberKey?: unknown; familyCodes?: unknown; guestCodes?: unknown; accountId?: unknown };
    return {
      slug: text(body?.slug, 80),
      editKey: text(body?.editKey, 80),
      email: text(body?.email, 120),
      name: text(body?.name, 80),
      memberKey: text(body?.memberKey, 80),
      familyCodes: codes(body?.familyCodes),
      guestCodes: codes(body?.guestCodes),
      accountId: text(body?.accountId, 80),
    };
  })
  .handler(async ({ data }) => {
    const { registerWeddingAuthority: register } = await import("@/lib/wedding/roles.server");
    return register(data);
  });

export const syncWeddingCodes = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; editKey?: unknown; familyCodes?: unknown; guestCodes?: unknown };
    return { slug: text(body?.slug, 80), editKey: text(body?.editKey, 80), familyCodes: codes(body?.familyCodes), guestCodes: codes(body?.guestCodes) };
  })
  .handler(async ({ data }) => {
    const { syncWeddingCodes: sync } = await import("@/lib/wedding/roles.server");
    return sync(data);
  });

export const resolveWeddingRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; email?: unknown; accountId?: unknown };
    return { slug: text(body?.slug, 80), memberKey: text(body?.memberKey, 80), email: text(body?.email, 120), accountId: text(body?.accountId, 80) };
  })
  .handler(async ({ data }) => {
    const { resolveWeddingRole: resolve } = await import("@/lib/wedding/roles.server");
    return resolve(data);
  });

export const claimWeddingRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; email?: unknown; name?: unknown; code?: unknown };
    return {
      slug: text(body?.slug, 80),
      memberKey: text(body?.memberKey, 80),
      email: text(body?.email, 120),
      name: text(body?.name, 80),
      code: text(body?.code, 80),
    };
  })
  .handler(async ({ data }) => {
    const { claimWeddingRole: claim } = await import("@/lib/wedding/roles.server");
    return claim(data);
  });

export const readHostCodes = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; email?: unknown };
    return { slug: text(body?.slug, 80), memberKey: text(body?.memberKey, 80), email: text(body?.email, 120) };
  })
  .handler(async ({ data }) => {
    const { readHostCodes: read } = await import("@/lib/wedding/roles.server");
    return read(data);
  });

function nameList(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 80)).slice(0, max);
}

export const assignCohosts = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; editKey?: unknown; names?: unknown };
    return { slug: text(body?.slug, 80), editKey: text(body?.editKey, 80), names: nameList(body?.names, 2) };
  })
  .handler(async ({ data }) => {
    const { assignCohosts: assign } = await import("@/lib/wedding/roles.server");
    return assign(data);
  });

export const listMyCircles = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { email?: unknown; memberKeys?: unknown; phone?: unknown; accountId?: unknown };
    return { email: text(body?.email, 120), memberKeys: nameList(body?.memberKeys, 30), phone: text(body?.phone, 20), accountId: text(body?.accountId, 80) };
  })
  .handler(async ({ data }) => {
    const { listMyCircles: list } = await import("@/lib/wedding/roles.server");
    return list(data);
  });
