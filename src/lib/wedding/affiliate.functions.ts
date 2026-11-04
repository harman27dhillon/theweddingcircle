import { createServerFn } from "@tanstack/react-start";
import { affiliateService } from "@/lib/wedding/affiliate";

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const developerAffiliateBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { affiliateBoard } = await import("@/lib/wedding/affiliate.server");
    return affiliateBoard(data.token);
  });

export const developerSaveAffiliate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; service?: unknown; confirm?: unknown; fields?: unknown };
    const service = affiliateService(text(body?.service, 40));
    const raw = body?.fields && typeof body.fields === "object" ? (body.fields as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    if (service) {
      for (const field of service.fields) fields[field.id] = text(raw[field.id], 256);
    }
    return { token: text(body?.token, 200), service: service?.id ?? "", fields, confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { saveAffiliate } = await import("@/lib/wedding/affiliate.server");
    return saveAffiliate(data.token, data.service, data.fields, data.confirm);
  });

export const developerTestAffiliate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; service?: unknown };
    return { token: text(body?.token, 200), service: text(body?.service, 40) };
  })
  .handler(async ({ data }) => {
    const { testAffiliate } = await import("@/lib/wedding/affiliate.server");
    return testAffiliate(data.token, data.service);
  });
