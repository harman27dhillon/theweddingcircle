import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const saveDeveloperAppearance = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as { token?: unknown; appearance?: unknown } : {};
    return { token: text(body.token, 200), appearance: body.appearance ?? null };
  })
  .handler(async ({ data }) => {
    const { saveAppearance } = await import("@/lib/developer/appearance.server");
    return saveAppearance(data.token, data.appearance);
  });

export const saveDeveloperImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as { token?: unknown; slot?: unknown; mime?: unknown; data?: unknown } : {};
    return {
      token: text(body.token, 200),
      slot: text(body.slot, 80),
      mime: text(body.mime, 40),
      data: typeof body.data === "string" ? body.data.slice(0, 1_800_000) : "",
    };
  })
  .handler(async ({ data }) => {
    const { integrateDeveloperImage } = await import("@/lib/developer/appearance.server");
    return integrateDeveloperImage(data.token, data);
  });
