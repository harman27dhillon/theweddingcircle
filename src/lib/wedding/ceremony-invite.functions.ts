import { createServerFn } from "@tanstack/react-start";
import type { InviteKind } from "@/lib/wedding/ceremony-invite";

function text(value: unknown, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function kindOf(value: unknown): InviteKind | "" {
  return value === "family" || value === "guest" || value === "bride" || value === "groom" ? value : "";
}

function idsOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 40);
}

export const createCeremonyInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; editKey?: unknown; memberKey?: unknown; accountId?: unknown; codeId?: unknown; kind?: unknown; ceremonyIds?: unknown };
    return {
      slug: text(body?.slug, 80),
      editKey: text(body?.editKey, 80),
      memberKey: text(body?.memberKey, 80),
      accountId: text(body?.accountId, 160),
      codeId: text(body?.codeId, 80),
      kind: kindOf(body?.kind),
      ceremonyIds: idsOf(body?.ceremonyIds),
    };
  })
  .handler(async ({ data }) => {
    const { createCeremonyInvite: create } = await import("@/lib/wedding/ceremony-invite.server");
    return create(data);
  });

export const readCeremonyInvite = createServerFn({ method: "GET" })
  .validator((input: unknown) => text(input, 80))
  .handler(async ({ data }) => {
    const { readCeremonyInvite: read } = await import("@/lib/wedding/ceremony-invite.server");
    return read(data);
  });

export const revokeCeremonyInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => text(input, 80))
  .handler(async ({ data }) => {
    const { revokeCeremonyInvite: revoke } = await import("@/lib/wedding/ceremony-invite.server");
    return revoke(data);
  });

export const enterCeremonyInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; name?: unknown; side?: unknown; memberKey?: unknown; accountId?: unknown };
    return {
      token: text(body?.token, 80),
      name: text(body?.name, 80),
      side: text(body?.side, 20),
      memberKey: text(body?.memberKey, 80),
      accountId: text(body?.accountId, 160),
    };
  })
  .handler(async ({ data }) => {
    const { enterCeremonyInvite: enter } = await import("@/lib/wedding/ceremony-invite.server");
    return enter(data);
  });
