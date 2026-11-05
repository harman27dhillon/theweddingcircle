import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

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
