import { randomUUID, createHash } from "node:crypto";
import type { App } from "firebase-admin/app";
import type { Sql } from "@/lib/db";
import { parseServiceAccount, redactCloud } from "@/lib/developer/cloud";
import { ensureMediaProviderColumns } from "@/lib/developer/media-destination.server";
import { firebaseRuntimeFromEnv } from "@/lib/infra/config";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";
import { FREE_STORAGE_BYTES, PREMIUM_STORAGE_BYTES } from "@/lib/wedding/plan";

const ALLOWED_MIME = /^(image|video|audio)\/[\w.+-]+$/;
let appPromise: Promise<App | null> | null = null;
let appMark = "";

function safeDetail(error: unknown) {
  const message = error instanceof Error ? error.message : "Firebase Storage refused the request.";
  return redactCloud(message, []).replace(/private[_ ]key/gi, "credential") || "Firebase Storage refused the request.";
}

async function forgetFirebaseApp() {
  appPromise = null;
  appMark = "";
  try {
    const { getApps, deleteApp } = await import("firebase-admin/app");
    const existing = getApps().find((item) => item.name === "wc-firebase");
    if (existing) await deleteApp(existing);
  } catch {
    /* The Admin SDK is unavailable. The cache is already clear. */
  }
}

async function firebaseApp() {
  let runtime: ReturnType<typeof firebaseRuntimeFromEnv>;
  try {
    runtime = firebaseRuntimeFromEnv((await resolvedInfraEnv()).env);
  } catch {
    await forgetFirebaseApp();
    return null;
  }
  const parsed = parseServiceAccount(runtime.serviceAccountJson);
  const bucketName = runtime.storageBucket;
  if (!parsed.ok || !bucketName) {
    await forgetFirebaseApp();
    return null;
  }
  const mark = createHash("sha256").update(`${parsed.projectId}\0${parsed.clientEmail}\0${bucketName}\0${parsed.privateKey}`).digest("hex");
  if (appPromise && appMark === mark) return appPromise;
  appMark = mark;
  const pending = (async () => {
    const { cert, getApps, initializeApp, deleteApp } = await import("firebase-admin/app");
    const existing = getApps().find((item) => item.name === "wc-firebase");
    if (existing) await deleteApp(existing);
    return initializeApp(
      {
        credential: cert({ projectId: parsed.projectId, clientEmail: parsed.clientEmail, privateKey: parsed.privateKey }),
        storageBucket: bucketName,
      },
      "wc-firebase",
    );
  })();
  appPromise = pending.catch(() => null);
  const app = await appPromise;
  if (!app && appMark === mark) {
    appPromise = null;
    appMark = "";
  }
  return app;
}

async function bucket() {
  const app = await firebaseApp();
  if (!app) return null;
  const { getStorage } = await import("firebase-admin/storage");
  return getStorage(app).bucket();
}

function partName(slug: string, id: string, idx: number) {
  return `weddings/${slug}/${id}/${idx}`;
}

export async function firebaseSenderReady() {
  const app = await firebaseApp();
  if (!app?.options.credential) return false;
  try {
    const token = await app.options.credential.getAccessToken();
    return Boolean(token?.access_token);
  } catch {
    return false;
  }
}

export async function probeFirebaseStorage() {
  const store = await bucket();
  if (!store) {
    return { ok: false as const, detail: "Set FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_STORAGE_BUCKET on the server. No file was uploaded, and wedding media stays on this app's library." };
  }
  const name = `wc-connection-tests/${randomUUID()}.txt`;
  const file = store.file(name);
  const body = "wedding-circle-connection-test";
  try {
    await file.save(body, { resumable: false, contentType: "text/plain", metadata: { metadata: { purpose: "connection-test" } } });
    const [got] = await file.download();
    if (got.toString("utf8") !== body) {
      return { ok: false as const, detail: "The disposable test file did not match after download. New uploads stay on this app's library." };
    }
    return { ok: true as const, detail: "A disposable test file was uploaded, read, and deleted. No wedding file was touched." };
  } catch (error) {
    return { ok: false as const, detail: safeDetail(error) };
  } finally {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}

export async function saveFirebaseChunk(
  sql: Sql,
  input: { slug: string; id: string; mime: string; idx: number; total: number; data: string },
  paid: boolean,
) {
  if (!ALLOWED_MIME.test(input.mime)) return { ok: false as const };
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.byteLength < 1) return { ok: false as const };
  const limit = paid ? PREMIUM_STORAGE_BYTES : FREE_STORAGE_BYTES;
  await ensureMediaProviderColumns(sql);
  const library = (await sql<{ bytes: number | string }>`
      select coalesce(sum(length(p.data)), 0) as bytes
      from circle_media_part p
      join circle_media m on m.id = p.id
      where m.slug = ${input.slug}
    `)[0];
    const remote = (await sql<{ bytes: number | string }>`
      select coalesce(sum(r.bytes), 0) as bytes
      from circle_media_remote r
      join circle_media m on m.id = r.id
      where m.slug = ${input.slug} and not (r.id = ${input.id} and r.idx = ${input.idx})
    `)[0];
    const next = Number(library?.bytes ?? 0) + Number(remote?.bytes ?? 0) + bytes.byteLength;
    if (next > limit) return { ok: false as const, error: "storage" as const };
  const store = await bucket();
  if (!store) return { ok: false as const };
  try {
    await store.file(partName(input.slug, input.id, input.idx)).save(bytes, { resumable: false, contentType: input.mime });
  } catch {
    return { ok: false as const };
  }
  const path = `weddings/${input.slug}/${input.id}`;
  await sql`
    insert into circle_media (id, slug, mime, chunks, provider, object_path)
    values (${input.id}, ${input.slug}, ${input.mime}, ${input.total}, ${"firebase"}, ${path})
    on conflict (id) do update set mime = excluded.mime, chunks = excluded.chunks, provider = ${"firebase"}, object_path = excluded.object_path, updated_at = now()
  `;
  await sql`
    insert into circle_media_remote (id, idx, bytes)
    values (${input.id}, ${input.idx}, ${bytes.byteLength})
    on conflict (id, idx) do update set bytes = excluded.bytes
  `;
  return { ok: true as const };
}

export async function readFirebaseChunk(slug: string, id: string, idx: number) {
  const store = await bucket();
  if (!store) return null;
  try {
    const [buf] = await store.file(partName(slug, id, idx)).download();
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function deleteFirebaseChunks(slug: string, id: string, chunks: number) {
  const store = await bucket();
  if (!store) return false;
  const total = Math.min(40, Math.max(1, chunks || 1));
  try {
    for (let idx = 0; idx < total; idx += 1) {
      await store.file(partName(slug, id, idx)).delete({ ignoreNotFound: true });
    }
    return true;
  } catch {
    return false;
  }
}
