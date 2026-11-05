import { createServerFn } from "@tanstack/react-start";
import { CHECKS, CONFIG_FIELDS, type Check, type ConfigDraft } from "./model";

function body(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}
function text(input: unknown, limit: number) {
  return typeof input === "string" && input.length <= limit ? input : "";
}

export const developerControlStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { controlSession } = await import("./session.server");
  const session = controlSession();
  if (!session.email) return { ...session, configuration: null };
  const { configurationStatus } = await import("./config.server");
  return { ...session, configuration: await configurationStatus() };
});

export const developerControlLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = body(input);
    return { email: text(data.email, 254), password: text(data.password, 512) };
  })
  .handler(async ({ data }) => {
    const { controlSignIn } = await import("./session.server");
    return controlSignIn(data.email, data.password);
  });

export const developerControlLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { controlSignOut } = await import("./session.server");
  controlSignOut();
});

export const developerControlConfiguration = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = body(input);
    const values = body(data.values);
    const draft: ConfigDraft = {};
    for (const { name } of CONFIG_FIELDS) {
      if (typeof values[name] === "string" && values[name].length > 8192) throw new Error("A configuration value exceeds the allowed length.");
      const value = text(values[name], 8192).trim();
      if (value) draft[name] = value;
    }
    return { clear: data.clear === true, confirm: data.confirm === true, draft };
  })
  .handler(async ({ data }) => {
    const { requireControlSession } = await import("./session.server");
    requireControlSession();
    if (data.clear && !data.confirm) return { ok: false, message: "Confirm removal before clearing the Developer Center configuration." };
    const { stageConfiguration } = await import("./config.server");
    return stageConfiguration(data.draft, data.clear);
  });

export const developerControlCheck = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = body(input);
    const check = CHECKS.find(([id]) => id === data.check)?.[0];
    if (!check) throw new Error("Unknown Developer Center check.");
    return { check, confirm: data.confirm === true };
  })
  .handler(async ({ data }) => {
    const { requireControlSession } = await import("./session.server");
    requireControlSession();
    const check: Check = data.check;
    if (check === "initialize" && !data.confirm) return { ok: false, message: "Confirm schema initialization first." };
    if (check === "api") {
      const { testSupabaseApi } = await import("./config.server");
      return testSupabaseApi();
    }
    const { runDatabaseCheck } = await import("./database.server");
    return runDatabaseCheck(check);
  });
