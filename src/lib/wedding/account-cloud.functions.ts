import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const publishCircleAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      id: text(body.id, 80),
      name: text(body.name, 80),
      email: text(body.email, 120),
      phone: text(body.phone, 20),
      passwordHash: text(body.passwordHash, 128),
      country: text(body.country, 80),
    };
  })
  .handler(async ({ data }) => {
    const { publishCircleAccount: publish } = await import("./account-cloud.server");
    return publish(data);
  });

export const openCircleAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return { identifier: text(body.identifier, 120), passwordHash: text(body.passwordHash, 128) };
  })
  .handler(async ({ data }) => {
    const { openCircleAccount: open } = await import("./account-cloud.server");
    return open(data);
  });

export const linkFirebaseAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      idToken: text(body.idToken, 4096),
      name: text(body.name, 80),
      country: text(body.country, 80),
      phone: text(body.phone, 20),
    };
  })
  .handler(async ({ data }) => {
    const { linkFirebaseAccount: link } = await import("./account-cloud.server");
    return link(data);
  });
