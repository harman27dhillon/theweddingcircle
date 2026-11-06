export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** Nitro attaches the current Worker's bindings before dispatching the request. */
export function workerEnvironment() {
  return (globalThis as { __env__?: Record<string, unknown> }).__env__;
}

/** Read Cloudflare Worker bindings first, with process.env as the local fallback. */
export async function serverEnvironment(): Promise<Record<string, string | undefined>> {
  const values: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(workerEnvironment() ?? {})) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Read the non-string Hyperdrive binding from the Cloudflare Worker runtime. */
export async function hyperdriveConnectionString(): Promise<string | undefined> {
  const binding = workerEnvironment()?.HYPERDRIVE as { connectionString?: unknown } | undefined;
  return typeof binding?.connectionString === "string" && binding.connectionString.trim()
    ? binding.connectionString
    : undefined;
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
