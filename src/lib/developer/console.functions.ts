import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const developerPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicConfig } = await import("@/lib/developer/console.server");
  return publicConfig();
});

export const developerUnlock = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { email?: unknown; password?: unknown };
    return { email: text(body?.email, 120), password: text(body?.password, 200) };
  })
  .handler(async ({ data }) => {
    const { unlockDeveloper } = await import("@/lib/developer/gate.server");
    return unlockDeveloper(data.email, data.password);
  });

export const developerSaveSample = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; bride?: unknown; groom?: unknown; date?: unknown; city?: unknown; place?: unknown; cover?: unknown };
    return {
      token: text(body?.token, 200),
      bride: text(body?.bride, 80),
      groom: text(body?.groom, 80),
      date: text(body?.date, 20),
      city: text(body?.city, 80),
      place: text(body?.place, 80),
      cover: text(body?.cover, 500_000),
    };
  })
  .handler(async ({ data }) => {
    const { setSampleShowcase } = await import("@/lib/developer/console.server");
    return setSampleShowcase(data.token, data);
  });

export const reportAppError = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { source?: unknown; message?: unknown };
    return { source: text(body?.source, 40), message: text(body?.message, 500) };
  })
  .handler(async ({ data }) => {
    const { noteAppError } = await import("@/lib/developer/console.server");
    return noteAppError(data.source, data.message);
  });
