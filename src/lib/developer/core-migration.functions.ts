import { createServerFn } from "@tanstack/react-start";

function tokenOf(input: unknown) {
  const token = (input as { token?: unknown })?.token;
  return typeof token === "string" ? token.trim().slice(0, 200) : "";
}

function confirmed(input: unknown) {
  return (input as { confirm?: unknown })?.confirm === true;
}

export const developerCoreBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { coreMigrationBoard } = await import("@/lib/developer/core-migration.server");
    return coreMigrationBoard(data.token);
  });

export const developerCoreInspect = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { inspectCoreMigration } = await import("@/lib/developer/core-migration.server");
    return inspectCoreMigration(data.token);
  });

export const developerCoreProbe = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { probeCoreConnection } = await import("@/lib/developer/core-migration.server");
    return probeCoreConnection(data.token);
  });

export const developerCorePrepare = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { prepareCoreMigration } = await import("@/lib/developer/core-migration.server");
    return prepareCoreMigration(data.token, data.confirm);
  });

export const developerCoreDryRun = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { runCoreMigration } = await import("@/lib/developer/core-migration.server");
    return runCoreMigration(data.token, false, true);
  });

export const developerCoreCopy = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { runCoreMigration } = await import("@/lib/developer/core-migration.server");
    return runCoreMigration(data.token, data.confirm, false);
  });

export const developerCoreValidate = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input) }))
  .handler(async ({ data }) => {
    const { validateCoreMigration } = await import("@/lib/developer/core-migration.server");
    return validateCoreMigration(data.token);
  });

export const developerCoreCutover = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { cutoverCoreMigration } = await import("@/lib/developer/core-migration.server");
    return cutoverCoreMigration(data.token, data.confirm);
  });

export const developerCoreFreeze = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { freezeCoreMigration } = await import("@/lib/developer/core-migration.server");
    return freezeCoreMigration(data.token, data.confirm);
  });

export const developerCoreReverse = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { reverseSyncCoreMigration } = await import("@/lib/developer/core-migration.server");
    return reverseSyncCoreMigration(data.token, data.confirm);
  });

export const developerCoreResume = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { resumeCoreWrites } = await import("@/lib/developer/core-migration.server");
    return resumeCoreWrites(data.token, data.confirm);
  });

export const developerCoreArchive = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { archiveExtraCoreRows } = await import("@/lib/developer/core-migration.server");
    return archiveExtraCoreRows(data.token, data.confirm);
  });

export const developerCoreRollback = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: tokenOf(input), confirm: confirmed(input) }))
  .handler(async ({ data }) => {
    const { rollbackCoreMigration } = await import("@/lib/developer/core-migration.server");
    return rollbackCoreMigration(data.token, data.confirm);
  });
