import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const generateWeddingVouchers = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as { token?: unknown; count?: unknown; expiresAt?: unknown } : {};
    const count = typeof body.count === "number" ? body.count : Number(body.count);
    return { token: text(body.token, 200), count: Number.isFinite(count) ? count : 1, expiresAt: text(body.expiresAt, 40) };
  })
  .handler(async ({ data }) => {
    const { generateVouchers } = await import("./vouchers.server");
    return generateVouchers(data.token, data.count, data.expiresAt || null);
  });

export const listWeddingVouchers = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown } | null)?.token, 200) }))
  .handler(async ({ data }) => {
    const { listVouchers } = await import("./vouchers.server");
    return listVouchers(data.token);
  });

export const revokeWeddingVoucher = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as { token?: unknown; id?: unknown } : {};
    return { token: text(body.token, 200), id: text(body.id, 80) };
  })
  .handler(async ({ data }) => {
    const { revokeVoucher } = await import("./vouchers.server");
    return revokeVoucher(data.token, data.id);
  });

export const validateWeddingVoucher = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ code: text((input as { code?: unknown } | null)?.code, 40) }))
  .handler(async ({ data }) => {
    const { validateVoucher } = await import("./vouchers.server");
    return validateVoucher(data.code);
  });

export const redeemWeddingVoucher = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as { code?: unknown; slug?: unknown; editKey?: unknown } : {};
    return { code: text(body.code, 40), slug: text(body.slug, 80), editKey: text(body.editKey, 120) };
  })
  .handler(async ({ data }) => {
    const { redeemVoucher } = await import("./vouchers.server");
    return redeemVoucher(data);
  });
