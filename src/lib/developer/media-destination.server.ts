import type { Sql } from "@/lib/db";

export async function ensureCloudActive(sql: Sql) {
  await sql`create table if not exists developer_cloud_active (
    service text primary key,
    choice text not null,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
}

export async function ensureMediaProviderColumns(sql: Sql) {
  await sql`alter table circle_media add column if not exists provider text not null default 'library'`;
  await sql`alter table circle_media add column if not exists object_path text not null default ''`;
  await sql`create table if not exists circle_media_remote (
    id text not null,
    idx integer not null,
    bytes integer not null,
    primary key (id, idx)
  )`;
}

export async function activeMediaDestination(sql: Sql) {
  try {
    await ensureCloudActive(sql);
    const rows = await sql<{ choice: string }>`select choice from developer_cloud_active where service = ${"media"} limit 1`;
    return rows[0]?.choice === "firebase_storage" ? "firebase" as const : "library" as const;
  } catch {
    return "library" as const;
  }
}

export async function activeChoice(sql: Sql, service: string) {
  try {
    await ensureCloudActive(sql);
    const rows = await sql<{ choice: string }>`select choice from developer_cloud_active where service = ${service} limit 1`;
    return rows[0]?.choice || "";
  } catch {
    return "";
  }
}
