import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@electric-sql/pglite/dist");
const to = join(root, ".vercel/output/functions/__server.func/_libs");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

await mkdir(to, { recursive: true });
await Promise.all(files.map((name) => copyFile(join(from, name), join(to, name))));
console.log(`[pglite] copied ${files.join(", ")} next to the server bundle`);
