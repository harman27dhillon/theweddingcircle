import { closeSync, existsSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = join("src", "lib", "wedding", "store.ts");

function climb(start: string) {
  let dir = resolve(start);
  for (let i = 0; i < 14; i += 1) {
    if (existsSync(join(dir, MARKER)) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function canWrite(root: string) {
  // Open the project manifest for writing and close it without changing bytes.
  // A read-only deploy fails here; a live project does not, and Vite does not rebuild.
  try {
    const fd = openSync(join(root, "package.json"), "r+");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

let memo: { root: string; expires: number } | null = null;

/** The real project directory, or null when this process cannot change it. */
export function projectRoot() {
  if (memo && memo.expires > Date.now()) return memo.root;
  const seeds = [process.cwd()];
  if (process.env.PWD) seeds.push(process.env.PWD);
  try {
    seeds.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url is unavailable in this runtime.
  }
  if (existsSync("/workspace/src/lib/wedding/store.ts")) seeds.push("/workspace");
  for (const seed of seeds) {
    const found = climb(seed);
    if (!found || !canWrite(found)) continue;
    memo = { root: found, expires: Date.now() + 15_000 };
    return found;
  }
  memo = null;
  return null;
}

export function projectUnavailableMessage() {
  if (process.env.VERCEL || process.env.GROK_PROJECT_ID) {
    return "Project files are not writable from the published server.";
  }
  return "Project files are not writable from this server. Nothing was changed.";
}
