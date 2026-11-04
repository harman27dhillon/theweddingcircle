import { randomBytes } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { developerSession } from "@/lib/developer/gate.server";
import { BUILTIN_ASSETS, builtinById, isLibraryCategory, type LibraryCategory } from "@/lib/wedding/library-catalog";

const ASSET_ID = /^[a-z0-9-]{2,80}$/;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type LibraryRecord = {
  id: string;
  name: string;
  category: string;
  path: string;
  mime: string;
  active: boolean;
  builtin: boolean;
  replaced: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  circles: number;
  places: string[];
  src: string;
};

function on(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

function stamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function nid() {
  return randomBytes(16).toString("hex");
}

async function ensureLibrary(sql: Sql) {
  await sql`create table if not exists library_assets (
    asset_id text primary key,
    name text not null,
    category text not null,
    public_path text not null unique,
    mime text not null default 'image/jpeg',
    active boolean not null default true,
    builtin boolean not null default false,
    replaced boolean not null default false,
    created_by text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists library_blobs (
    asset_id text primary key references library_assets(asset_id) on delete cascade,
    mime text not null,
    data text not null
  )`;
  await sql`create table if not exists library_retired (
    asset_id text primary key,
    retired_at timestamptz not null default now()
  )`;
  const retired = await sql<{ asset_id: string }>`select asset_id from library_retired`;
  const gone = new Set(retired.map((row) => row.asset_id));
  for (const asset of BUILTIN_ASSETS) {
    if (gone.has(asset.id)) continue;
    const mime = asset.path.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
    await sql`
      insert into library_assets (asset_id, name, category, public_path, mime, active, builtin, replaced, created_by)
      values (${asset.id}, ${asset.name}, ${asset.category}, ${asset.path}, ${mime}, ${true}, ${true}, ${false}, ${"builtin"})
      on conflict (asset_id) do nothing
    `;
  }
}

function cleanImage(mime: string, data: string) {
  const cleanMime = mime === "image/jpg" ? "image/jpeg" : mime;
  if (!IMAGE_MIME.has(cleanMime)) return null;
  const payload = data.replace(/\s/g, "");
  if (payload.length < 32 || payload.length > 900_000 || !/^[A-Za-z0-9+/=]+$/.test(payload)) return null;
  return { mime: cleanMime, data: payload };
}

function cleanName(value: string) {
  const name = value.trim().replace(/\s+/g, " ").slice(0, 60);
  return name.length >= 2 ? name : "";
}

type AssetRow = {
  asset_id: string;
  name: string;
  category: string;
  public_path: string;
  mime: string;
  active: unknown;
  builtin: unknown;
  replaced: unknown;
  created_by: string;
  created_at: unknown;
  updated_at: unknown;
};

function placesFor(row: { asset_id: string; category: string }) {
  const builtin = builtinById(row.asset_id);
  if (builtin) return builtin.places;
  if (row.category === "Backgrounds") return ["Background picker"];
  if (row.category === "Invitations") return ["Invitation picker", "Cover picker"];
  if (row.category === "Wedding covers") return ["Cover picker", "Background picker"];
  return ["Developer library"];
}

function toRecord(row: AssetRow, circles: number): LibraryRecord {
  const updatedAt = stamp(row.updated_at);
  const replaced = on(row.replaced);
  return {
    id: row.asset_id,
    name: row.name,
    category: row.category,
    path: row.public_path,
    mime: row.mime,
    active: on(row.active),
    builtin: on(row.builtin),
    replaced,
    createdBy: row.created_by || "",
    createdAt: stamp(row.created_at),
    updatedAt,
    circles,
    places: placesFor(row),
    src: replaced ? `/api/library/file/${row.asset_id}?v=${encodeURIComponent(updatedAt)}` : row.public_path,
  };
}

async function circleBodies() {
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const sql = await weddingDataSql();
  const rows = await sql<{ body: string }>`select payload::text as body from circles`;
  return rows.map((row) => row.body || "");
}

function countPath(bodies: string[], path: string) {
  const needle = `"${path}"`;
  return bodies.reduce((sum, body) => sum + (body.includes(needle) ? 1 : 0), 0);
}

async function audit(email: string, command: string, interpretation: string, level: string, result: string) {
  const sql = await getSql();
  await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${nid()}, ${email}, ${command.slice(0, 2000)}, ${interpretation.slice(0, 4000)}, ${level}, ${"library"}, ${result.slice(0, 500)})`;
}

async function readRows(sql: Sql) {
  return sql<AssetRow>`
    select asset_id, name, category, public_path, mime, active, builtin, replaced, created_by, created_at, updated_at
    from library_assets
    order by builtin desc, category, name
  `;
}

export async function publicLibrary() {
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await readRows(sql);
  return {
    ok: true as const,
    assets: rows.map((row) => {
      const record = toRecord(row, 0);
      return {
        id: record.id,
        name: record.name,
        category: record.category,
        path: record.path,
        active: record.active,
        builtin: record.builtin,
        replaced: record.replaced,
        updatedAt: record.updatedAt,
        src: record.src,
      };
    }),
  };
}

export async function developerLibrary(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const [rows, bodies] = await Promise.all([readRows(sql), circleBodies()]);
  return {
    ok: true as const,
    note: "Built-in pictures and pictures you add here. Photos guests upload inside a wedding are not in this library and are not deleted from here.",
    assets: rows.map((row) => toRecord(row, countPath(bodies, row.public_path))),
  };
}

export async function createLibraryAsset(token: string, name: string, category: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const label = cleanName(name);
  if (!label) return { ok: false as const, error: "Give the picture a name." };
  if (!isLibraryCategory(category)) return { ok: false as const, error: "Choose a category." };
  const image = cleanImage(mime, data);
  if (!image) return { ok: false as const, error: "Use a JPEG, PNG or WebP under the size limit." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const id = `asset-${randomBytes(8).toString("hex")}`;
  const path = `/library/${id}`;
  await sql`
    insert into library_assets (asset_id, name, category, public_path, mime, active, builtin, replaced, created_by)
    values (${id}, ${label}, ${category}, ${path}, ${image.mime}, ${true}, ${false}, ${true}, ${session.email})
  `;
  await sql`insert into library_blobs (asset_id, mime, data) values (${id}, ${image.mime}, ${image.data})`;
  await audit(session.email, `Add library picture ${label}`, `${category} · ${id}`, "yellow", "added");
  return { ok: true as const, id };
}

export async function replaceLibraryAsset(token: string, assetId: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!ASSET_ID.test(assetId)) return { ok: false as const, error: "That picture could not be found." };
  const image = cleanImage(mime, data);
  if (!image) return { ok: false as const, error: "Use a JPEG, PNG or WebP under the size limit." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await sql<{ asset_id: string; name: string }>`select asset_id, name from library_assets where asset_id = ${assetId} limit 1`;
  if (!rows[0]) return { ok: false as const, error: "That picture could not be found." };
  await sql`
    insert into library_blobs (asset_id, mime, data) values (${assetId}, ${image.mime}, ${image.data})
    on conflict (asset_id) do update set mime = excluded.mime, data = excluded.data
  `;
  await sql`update library_assets set mime = ${image.mime}, replaced = ${true}, updated_at = now() where asset_id = ${assetId}`;
  await audit(session.email, `Replace library picture ${rows[0].name}`, `Same picture id ${assetId}.`, "yellow", "replaced");
  return { ok: true as const, id: assetId };
}

export async function setLibraryAssetActive(token: string, assetId: string, active: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!ASSET_ID.test(assetId)) return { ok: false as const, error: "That picture could not be found." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await sql<{ name: string }>`update library_assets set active = ${active}, updated_at = now() where asset_id = ${assetId} returning name`;
  if (!rows[0]) return { ok: false as const, error: "That picture could not be found." };
  await audit(session.email, `${active ? "Enable" : "Disable"} ${rows[0].name}`, assetId, "green", active ? "active" : "inactive");
  return { ok: true as const };
}

export async function renameLibraryAsset(token: string, assetId: string, name: string, category: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!ASSET_ID.test(assetId)) return { ok: false as const, error: "That picture could not be found." };
  const label = cleanName(name);
  if (!label) return { ok: false as const, error: "Give the picture a name." };
  if (!isLibraryCategory(category)) return { ok: false as const, error: "Choose a category." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await sql<{ asset_id: string }>`
    update library_assets set name = ${label}, category = ${category as LibraryCategory}, updated_at = now()
    where asset_id = ${assetId} returning asset_id
  `;
  if (!rows[0]) return { ok: false as const, error: "That picture could not be found." };
  await audit(session.email, `Rename library picture ${label}`, `${category} · ${assetId}`, "green", "renamed");
  return { ok: true as const };
}

export async function deleteLibraryAsset(token: string, assetId: string, confirm: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!confirm) return { ok: false as const, error: "Confirm before deleting a picture." };
  if (!ASSET_ID.test(assetId)) return { ok: false as const, error: "That picture could not be found." };
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await sql<{ asset_id: string; name: string; public_path: string; builtin: unknown }>`
    select asset_id, name, public_path, builtin from library_assets where asset_id = ${assetId} limit 1
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "That picture could not be found." };
  const circles = countPath(await circleBodies(), row.public_path);
  if (circles > 0) {
    return {
      ok: false as const,
      error: `Used by ${circles} published circle${circles === 1 ? "" : "s"}. Turn it off instead so new circles cannot pick it. Circles that already use it keep the picture.`,
      circles,
    };
  }
  if (on(row.builtin)) {
    await sql`insert into library_retired (asset_id) values (${assetId}) on conflict (asset_id) do nothing`;
  }
  await sql`delete from library_assets where asset_id = ${assetId}`;
  await audit(session.email, `Delete library picture ${row.name}`, assetId, "red", "deleted");
  return { ok: true as const };
}

const SAMPLE_COVER_ID = "sample-cover";
const SAMPLE_COVER_PATH = "/library/sample-cover";

async function writeConfig(sql: Sql, key: string, value: string, email: string) {
  await sql`
    insert into developer_config (key, value, updated_by, updated_at)
    values (${key}, ${value}, ${email}, now())
    on conflict (key) do update set value = ${value}, updated_by = ${email}, updated_at = now()
  `;
}

export async function saveSampleCover(token: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const image = cleanImage(mime, data);
  if (!image) return { ok: false as const, error: "Use a JPEG, PNG or WebP under the size limit." };
  const sql = await getSql();
  await ensureLibrary(sql);
  await sql`
    insert into library_assets (asset_id, name, category, public_path, mime, active, builtin, replaced, created_by)
    values (${SAMPLE_COVER_ID}, ${"Sample wedding cover"}, ${"Sample art"}, ${SAMPLE_COVER_PATH}, ${image.mime}, ${true}, ${false}, ${true}, ${session.email})
    on conflict (asset_id) do update set mime = ${image.mime}, replaced = ${true}, active = ${true}, updated_at = now()
  `;
  await sql`
    insert into library_blobs (asset_id, mime, data) values (${SAMPLE_COVER_ID}, ${image.mime}, ${image.data})
    on conflict (asset_id) do update set mime = excluded.mime, data = excluded.data
  `;
  await sql`delete from library_retired where asset_id = ${SAMPLE_COVER_ID}`;
  await writeConfig(sql, "sampleCover", SAMPLE_COVER_PATH, session.email);
  await audit(session.email, "Update sample wedding cover", SAMPLE_COVER_ID, "yellow", "replaced");
  return { ok: true as const, cover: SAMPLE_COVER_PATH };
}

export async function clearSampleCover(token: string, confirm: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!confirm) return { ok: false as const, error: "Confirm before removing the sample wedding cover." };
  const sql = await getSql();
  await ensureLibrary(sql);
  await sql`delete from library_assets where asset_id = ${SAMPLE_COVER_ID}`;
  await writeConfig(sql, "sampleCover", "", session.email);
  await audit(session.email, "Remove sample wedding cover", "The built-in ceremony photo is used again.", "red", "cleared");
  return { ok: true as const, cover: "" };
}

export async function readLibraryFile(assetId: string) {
  if (!ASSET_ID.test(assetId)) return null;
  const sql = await getSql();
  await ensureLibrary(sql);
  const rows = await sql<{ data: string; mime: string }>`
    select b.data, b.mime
    from library_blobs b
    join library_assets a on a.asset_id = b.asset_id
    where a.asset_id = ${assetId}
    limit 1
  `;
  const row = rows[0];
  if (!row?.data) return null;
  const mime = IMAGE_MIME.has(row.mime) ? row.mime : "image/jpeg";
  return { bytes: Buffer.from(row.data, "base64"), mime };
}
