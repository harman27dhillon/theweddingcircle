import { createServerFn } from "@tanstack/react-start";

function tokenOf(input: unknown) {
  const token = (input as { token?: unknown })?.token;
  return typeof token === "string" ? token.trim().slice(0, 200) : "";
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const developerDataBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { dataManagerBoard } = await import("@/lib/developer/data-manager.server");
    return dataManagerBoard(data.token);
  });

export const developerDataSave = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; provider?: unknown; pasted?: unknown; confirm?: unknown };
    return { token: tokenOf(body), provider: text(body?.provider, 40), pasted: text(body?.pasted, 4000), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { dataManagerSave } = await import("@/lib/developer/data-manager.server");
    return dataManagerSave(data.token, data.provider, data.pasted, data.confirm);
  });

export const developerDataTest = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; provider?: unknown };
    return { token: tokenOf(body), provider: text(body?.provider, 40) };
  })
  .handler(async ({ data }) => {
    const { dataManagerTest } = await import("@/lib/developer/data-manager.server");
    return dataManagerTest(data.token, data.provider);
  });

export const developerDataInspect = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { dataManagerInspect } = await import("@/lib/developer/data-manager.server");
    return dataManagerInspect(data.token);
  });

export const developerDataTransfer = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; source?: unknown; destination?: unknown; execute?: unknown; confirm?: unknown };
    return {
      token: tokenOf(body),
      source: text(body?.source, 40),
      destination: text(body?.destination, 40),
      execute: body?.execute === true,
      confirm: body?.confirm === true,
    };
  })
  .handler(async ({ data }) => {
    const { dataManagerTransfer } = await import("@/lib/developer/data-manager.server");
    return dataManagerTransfer(data.token, data.source, data.destination, data.execute, data.confirm);
  });

export const developerDataSync = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; confirm?: unknown };
    return { token: tokenOf(body), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { dataManagerSync } = await import("@/lib/developer/data-manager.server");
    return dataManagerSync(data.token, data.confirm);
  });

export const developerDataResume = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; confirm?: unknown };
    return { token: tokenOf(body), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { dataManagerResume } = await import("@/lib/developer/data-manager.server");
    return dataManagerResume(data.token, data.confirm);
  });

export const developerDataActivate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; confirm?: unknown };
    return { token: tokenOf(body), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { dataManagerActivate } = await import("@/lib/developer/data-manager.server");
    return dataManagerActivate(data.token, data.confirm);
  });
