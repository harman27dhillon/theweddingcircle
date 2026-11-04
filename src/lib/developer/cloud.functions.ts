import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const developerCloudBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { cloudBoard } = await import("@/lib/developer/cloud.server");
    return cloudBoard(data.token);
  });

export const developerSaveCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; provider?: unknown; confirm?: unknown; confirmReplace?: unknown; expectedUpdatedAt?: unknown; fields?: unknown };
    const raw = body?.fields && typeof body.fields === "object" ? (body.fields as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.length > 40) continue;
      fields[key] = text(value, 2000);
    }
    return {
      token: text(body?.token, 200),
      provider: text(body?.provider, 40),
      fields,
      confirm: body?.confirm === true,
      confirmReplace: body?.confirmReplace === true,
      expectedUpdatedAt: text(body?.expectedUpdatedAt, 40),
    };
  })
  .handler(async ({ data }) => {
    const { saveCloud } = await import("@/lib/developer/cloud.server");
    return saveCloud(data.token, data.provider, data.fields, data.confirm, data.confirmReplace, data.expectedUpdatedAt);
  });

export const developerTestCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; provider?: unknown; capability?: unknown };
    return { token: text(body?.token, 200), provider: text(body?.provider, 40), capability: text(body?.capability, 40) };
  })
  .handler(async ({ data }) => {
    const { testCloud } = await import("@/lib/developer/cloud.server");
    return testCloud(data.token, data.provider, data.capability);
  });

export const developerRequestCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; service?: unknown; choice?: unknown; confirm?: unknown };
    return {
      token: text(body?.token, 200),
      service: text(body?.service, 40),
      choice: text(body?.choice, 40),
      confirm: body?.confirm === true,
    };
  })
  .handler(async ({ data }) => {
    const { requestCloud } = await import("@/lib/developer/cloud.server");
    return requestCloud(data.token, data.service, data.choice, data.confirm);
  });

export const developerApplyCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; service?: unknown; choice?: unknown; confirm?: unknown; consent?: unknown };
    return {
      token: text(body?.token, 200),
      service: text(body?.service, 40),
      choice: text(body?.choice, 40),
      confirm: body?.confirm === true,
      consent: body?.consent === true,
    };
  })
  .handler(async ({ data }) => {
    const { applyCloud } = await import("@/lib/developer/cloud.server");
    return applyCloud(data.token, data.service, data.choice, data.confirm, data.consent);
  });

export const cloudRuntime = createServerFn({ method: "GET" }).handler(async () => {
  const { cloudPublicRuntime } = await import("@/lib/developer/cloud.server");
  return cloudPublicRuntime();
});

export const registerPushDevice = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { deviceSecret?: unknown; token?: unknown };
    return { deviceSecret: text(body?.deviceSecret, 80), token: text(body?.token, 4096) };
  })
  .handler(async ({ data }) => {
    const { savePushDevice } = await import("@/lib/developer/cloud.server");
    return savePushDevice(data.deviceSecret, data.token);
  });

export const developerDisconnectCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; provider?: unknown; confirm?: unknown };
    return { token: text(body?.token, 200), provider: text(body?.provider, 40), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { disconnectCloud } = await import("@/lib/developer/cloud.server");
    return disconnectCloud(data.token, data.provider, data.confirm);
  });
