export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** Read Cloudflare Worker bindings first, with process.env as the local fallback. */
export async function serverEnvironment(): Promise<Record<string, string | undefined>> {
  const values: Record<string, string | undefined> = { ...process.env };
  try {
    const runtime = await import("cloudflare:workers");
    for (const [key, value] of Object.entries(runtime.env)) {
      if (typeof value === "string") values[key] = value;
    }
  } catch {
    // Local Node and preview runtimes do not provide Cloudflare bindings.
  }
  return values;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience, gate endpoints and connector-token semantics all
 * key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}
