import { createServerFn } from "@tanstack/react-start";
import type { CoupleAccess } from "@/lib/wedding/types";

function text(value: unknown, max = 80) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function accessOf(value: unknown): CoupleAccess {
  if (!value || typeof value !== "object") return {};
  const body = value as CoupleAccess;
  const seat = (seatValue: CoupleAccess["bride"]) => {
    if (!seatValue || typeof seatValue !== "object") return undefined;
    const accountId = text(seatValue.accountId, 160);
    const name = text(seatValue.name, 80);
    return accountId ? { accountId, name } : undefined;
  };
  const code = (codeValue: CoupleAccess["brideCode"]) => {
    if (!codeValue || typeof codeValue !== "object") return undefined;
    const status = codeValue.status === "active" || codeValue.status === "claimed" || codeValue.status === "revoked" ? codeValue.status : "active";
    return { code: text(codeValue.code, 40), status, claimedBy: text(codeValue.claimedBy, 160) || undefined };
  };
  return {
    bride: seat(body.bride),
    groom: seat(body.groom),
    brideCode: code(body.brideCode),
    groomCode: code(body.groomCode),
  };
}

export const saveCoupleSecrets = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; editKey?: unknown; access?: unknown };
    return { slug: text(body?.slug, 80), editKey: text(body?.editKey, 80), access: accessOf(body?.access) };
  })
  .handler(async ({ data }) => {
    const { saveCoupleSecrets: save } = await import("@/lib/wedding/couple-access.server");
    return save(data);
  });

export const claimCoupleSecret = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { code?: unknown; accountId?: unknown; name?: unknown };
    return { code: text(body?.code, 40), accountId: text(body?.accountId, 160), name: text(body?.name, 80) };
  })
  .handler(async ({ data }) => {
    const { claimCoupleSecret: claim } = await import("@/lib/wedding/couple-access.server");
    return claim(data);
  });
